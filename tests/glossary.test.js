import assert from "node:assert/strict";
import test from "node:test";

import {
  GLOSSARY_PRESETS,
  MAX_ASR_CONTEXT_CHARS,
  buildAsrContextPrompt,
  buildGlossaryMap,
  buildGlossaryTermPattern,
  collectGlossaryEntries,
  exportGlossaryText,
  matchGlossaryTerms,
  parseGlossaryText,
  serializeWlkGlossary
} from "../extension/glossary.js";

// Fixture terms are the ones named in the Path of Exile transcripts under
// .research/poe-041; the shipped preset dictionaries are intentionally empty.
const POE_FIXTURE = [
  "Path of Exile | Path of Excel | PoE -> 流放之路",
  "Spirit -> 精魂",
  "minion | minions -> 召唤物",
  "sceptre | scepter -> 权杖",
  "Convoking Wand -> 召集法杖",
  "Bone Ring -> 骨环",
  "Orb of Augmentation -> 增幅石",
  "Chaos Orb -> 混沌石",
  "Dominating Blow -> 霸气之击",
  "runesmithing -> 符文锻造",
  "Ezomyte | Isamite -> 艾兹麦",
  "Ascendancy -> 升华",
  "ES -> 能量护盾",
  "SSF -> SSF"
].join("\n");

function poeEntries() {
  return parseGlossaryText(POE_FIXTURE);
}

test("parseGlossaryText accepts arrow, equals, csv and alias syntax", () => {
  const entries = parseGlossaryText(
    [
      "Spirit -> 精魂",
      "Chaos Orb => 混沌石",
      "Divine Orb = 神圣石",
      "Orb of Transmutation,蜕变石",
      "minion | minions ｜ 仆从 -> 召唤物",
      "  # 注释行不产生词条",
      "// 另一种注释",
      "",
      "只有左边 ->",
      "没有分隔符的一行"
    ].join("\n")
  );
  assert.deepEqual(
    entries.map((entry) => entry.sources),
    [
      ["Spirit"],
      ["Chaos Orb"],
      ["Divine Orb"],
      ["Orb of Transmutation"],
      ["minion", "minions", "仆从"]
    ]
  );
  assert.equal(entries[4].target, "召唤物");
});

test("parseGlossaryText drops a pasted CSV header and quoted targets", () => {
  const entries = parseGlossaryText(
    ['source,target', 'Chaos Orb,"混沌石, 通货"', 'Spirit,精魂'].join("\n")
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].target, "混沌石, 通货");
  assert.deepEqual(entries[1], { sources: ["Spirit"], target: "精魂" });
});

test("parseGlossaryText keeps the later line for a duplicated primary source", () => {
  const entries = parseGlossaryText("Chaos Orb -> 混沌石\nchaos orb -> 混沌之石");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].target, "混沌之石");
});

test("collectGlossaryEntries merges presets with custom text and lets custom win", () => {
  // The shipped presets are empty shells, so the count comes from custom text.
  assert.deepEqual(GLOSSARY_PRESETS.poe.entries, []);
  const presetOnly = collectGlossaryEntries({ presetIds: ["poe"] });
  assert.deepEqual(presetOnly, []);

  const merged = collectGlossaryEntries({
    presetIds: ["poe", "does-not-exist"],
    customText: "Spirit -> 精魂\nSpirit -> 精魄魂"
  });
  assert.deepEqual(merged, [{ sources: ["Spirit"], target: "精魄魂" }]);

  const unknown = collectGlossaryEntries({ presetIds: ["nope"] });
  assert.deepEqual(unknown, []);
});

test("matchGlossaryTerms folds English plurals and possessives", () => {
  const entries = poeEntries();
  const plural = matchGlossaryTerms(
    ["scepters are thematically perfect"],
    entries
  );
  assert.deepEqual(plural, [
    { source: "sceptre", target: "权杖", matched: "scepters" }
  ]);

  const scepterPlural = matchGlossaryTerms(["these sceptres"], entries);
  assert.equal(scepterPlural[0]?.target, "权杖");

  const possessive = matchGlossaryTerms(["the minion's damage"], entries);
  assert.equal(possessive[0]?.target, "召唤物");

  const ascendancy = matchGlossaryTerms(["two ascendancies"], entries);
  assert.deepEqual(ascendancy, [
    { source: "Ascendancy", target: "升华", matched: "ascendancies" }
  ]);
});

test("matchGlossaryTerms keeps word boundaries for short terms", () => {
  const entries = poeEntries();
  assert.deepEqual(matchGlossaryTerms(["the best test of it"], entries), []);
  const hit = matchGlossaryTerms(["this ES is fine"], entries);
  assert.deepEqual(hit, [{ source: "ES", target: "能量护盾", matched: "ES" }]);
});

test("matchGlossaryTerms prefers the longest entry and hides the short one", () => {
  const entries = poeEntries();
  const matches = matchGlossaryTerms(
    ["create an orb of augmentation"],
    entries
  );
  assert.deepEqual(matches, [
    {
      source: "Orb of Augmentation",
      target: "增幅石",
      matched: "orb of augmentation"
    }
  ]);

  const chaos = matchGlossaryTerms(["one chaos orb, please"], entries);
  assert.deepEqual(chaos, [
    { source: "Chaos Orb", target: "混沌石", matched: "chaos orb" }
  ]);
});

test("matchGlossaryTerms reports one result per entry and honours maxMatches", () => {
  const entries = poeEntries();
  const repeated = matchGlossaryTerms(
    ["spirit and more spirit", "spirit"],
    entries
  );
  assert.equal(repeated.length, 1);

  const limited = matchGlossaryTerms(
    ["spirit minions sceptres chaos orb"],
    entries,
    2
  );
  assert.equal(limited.length, 2);
  assert.deepEqual(matchGlossaryTerms(["spirit"], entries, 0), []);
});

test("matchGlossaryTerms recovers the Path of Exile ASR failures", () => {
  const entries = poeEntries();

  // "Path of Exile" heard as "Path of Excel" must still resolve to the game.
  const game = matchGlossaryTerms(["welcome back to path of excel"], entries);
  assert.deepEqual(game, [
    { source: "Path of Exile", target: "流放之路", matched: "path of excel" }
  ]);

  // "build" heard as "bill": only the skill gem name is in the glossary, the
  // translator uses the domain hint for the rest of the sentence.
  const skill = matchGlossaryTerms(
    ["a bill that would be similar to dominating blow"],
    entries
  );
  assert.deepEqual(skill, [
    { source: "Dominating Blow", target: "霸气之击", matched: "dominating blow" }
  ]);

  // Homophone alias for a proper noun the ASR keeps mangling.
  const nation = matchGlossaryTerms(
    ["the ancient art of isamite runesmithing"],
    entries
  );
  assert.deepEqual(
    nation.map((entry) => entry.target),
    ["符文锻造", "艾兹麦"]
  );

  const keptAsIs = matchGlossaryTerms(["it is ssf only"], entries);
  assert.deepEqual(keptAsIs, [{ source: "SSF", target: "SSF", matched: "ssf" }]);
});

test("matchGlossaryTerms is safe on empty input", () => {
  assert.deepEqual(matchGlossaryTerms([], poeEntries()), []);
  assert.deepEqual(matchGlossaryTerms(["spirit"], []), []);
  assert.deepEqual(matchGlossaryTerms(null, null), []);
  assert.deepEqual(matchGlossaryTerms(["spirit"], [{ sources: [], target: "" }]), []);
});

test("buildGlossaryMap keys the matched spelling, not the canonical source", () => {
  const entries = poeEntries();
  const matches = matchGlossaryTerms(
    ["back to path of excel with spirit"],
    entries
  );
  assert.deepEqual(buildGlossaryMap(matches), {
    "path of excel": "流放之路",
    spirit: "精魂"
  });
});

test("buildGlossaryTermPattern escapes regex characters", () => {
  const pattern = buildGlossaryTermPattern("Orb of Augmentation");
  assert.equal(
    pattern,
    "(?<![A-Za-z0-9_])Orb\\s+of\\s+Augmentation(?:s|es|['’]s)?(?![A-Za-z0-9_])"
  );
  assert.match("orb of augmentation", new RegExp(pattern, "i"));
  assert.doesNotMatch("orbs of augmentations", new RegExp(pattern, "i"));
  assert.match("costs 2 ex", new RegExp(buildGlossaryTermPattern("2 ex"), "i"));
  assert.match("a+b", new RegExp(buildGlossaryTermPattern("a+b"), "i"));
});

test("buildAsrContextPrompt keeps English sources only and respects the cap", () => {
  const entries = poeEntries();
  const prompt = buildAsrContextPrompt(entries);
  assert.ok(prompt.length <= MAX_ASR_CONTEXT_CHARS);
  assert.match(prompt, /Path of Exile/);
  assert.match(prompt, /Dominating Blow/);
  assert.match(prompt, /SSF/);
  // Chinese targets and the alias list stay out of the ASR prompt.
  assert.doesNotMatch(prompt, /精魂/);
  assert.equal(prompt, buildAsrContextPrompt(entries));

  const short = buildAsrContextPrompt(entries, { maxChars: 20 });
  assert.ok(short.length <= 20);

  const chineseOnly = buildAsrContextPrompt([
    { sources: ["流放之路"], target: "流放之路" }
  ]);
  assert.equal(chineseOnly, "");
});

test("serializeWlkGlossary expands aliases into WLK pairs", () => {
  const serialized = serializeWlkGlossary(poeEntries());
  assert.match(serialized, /Path of Exile -> 流放之路/);
  assert.match(serialized, /Path of Excel -> 流放之路/);
  assert.match(serialized, /; /);
  // WLK splits entries on `;`, so a target must never carry one.
  const cleaned = serializeWlkGlossary([
    { sources: ["Chaos Orb"], target: "混沌石；通货\n第二行" }
  ]);
  assert.equal(cleaned, "Chaos Orb -> 混沌石 通货 第二行");

  const capped = serializeWlkGlossary(poeEntries(), { maxChars: 40 });
  assert.ok(capped.length <= 40);

  assert.equal(serializeWlkGlossary([{ sources: ["A"], target: "" }]), "");
});

test("serializeWlkGlossary skips source terms WhisperLiveKit cannot express", () => {
  // WLK cuts the left side at the first ->, =>, = or `:`, and splits entries on
  // `;`; rewriting those would ship a term that never matches the caption.
  const serialized = serializeWlkGlossary([
    { sources: ["A:B"], target: "一" },
    { sources: ["A;B"], target: "二" },
    { sources: ["A=B"], target: "三" },
    { sources: ["A->B"], target: "四" },
    { sources: ["Clean Term"], target: "五" }
  ]);
  assert.equal(serialized, "Clean Term -> 五");
  for (const source of ["A:B", "A;B", "A=B", "A->B"]) {
    assert.equal(serialized.includes(source), false);
  }
});

test("matchGlossaryTerms lets a longer spelling win over a shorter alias", () => {
  // `PoE` is a short alias of the longer entry; without flattening the pairs it
  // would claim the span that `PoE trading` needs.
  const entries = parseGlossaryText(
    ["Path of Exile expansion | PoE -> 流放之路资料片", "PoE trading -> 流放之路交易"].join(
      "\n"
    )
  );
  const matches = matchGlossaryTerms(["a poe trading guide"], entries);
  assert.deepEqual(matches, [
    { source: "PoE trading", target: "流放之路交易", matched: "poe trading" }
  ]);
  // Only the alias `PoE` occurs here, so that is what the result reports.
  const alias = matchGlossaryTerms(["poe expansion news"], entries);
  assert.deepEqual(alias, [
    {
      source: "Path of Exile expansion",
      target: "流放之路资料片",
      matched: "poe"
    }
  ]);
});

test("parseGlossaryText ignores separators inside a quoted CSV field", () => {
  const entries = parseGlossaryText('"Chaos, Orb",混沌石');
  assert.deepEqual(entries, [
    { sources: ["Chaos, Orb"], target: "混沌石" }
  ]);
  // An unclosed quote swallows the rest of the line: skip it, never guess.
  assert.deepEqual(parseGlossaryText('"Chaos Orb,混沌石'), []);
});

test("export quotes source terms that would be read as line syntax", () => {
  // Every one of these would otherwise be split as a separator, an alias or a
  // comment, silently turning one term into a different entry.
  const entries = [
    { sources: ["A=B"], target: "目标1" },
    { sources: ["A->B"], target: "目标2" },
    { sources: ["A|B"], target: "目标3" },
    { sources: ["#foo"], target: "目标4" },
    { sources: ["//foo"], target: "目标5" },
    { sources: ["Chaos, Orb"], target: "混沌石" }
  ];
  assert.deepEqual(parseGlossaryText(exportGlossaryText(entries)), entries);
  assert.deepEqual(parseGlossaryText(exportGlossaryText(entries, "csv")), [
    { sources: ["A=B"], target: "目标1" },
    { sources: ["A->B"], target: "目标2" },
    { sources: ["A|B"], target: "目标3" },
    { sources: ["#foo"], target: "目标4" },
    { sources: ["//foo"], target: "目标5" },
    { sources: ["Chaos, Orb"], target: "混沌石" }
  ]);
});

test("quoted fields survive an emoji and curly quotes", () => {
  const emoji = String.fromCodePoint(0x1f600);
  const curly = String.fromCharCode(0x201c) + "B|C" + String.fromCharCode(0x201d);
  const entries = [
    { sources: ["Orb" + emoji + ",Chaos"], target: "目标" },
    { sources: ["A " + curly + " D"], target: "弯引号" }
  ];
  // The mask must stay UTF-16 length-aligned, and a curly quote inside a term
  // must not toggle the ASCII field-quote state.
  assert.deepEqual(parseGlossaryText(exportGlossaryText(entries)), entries);
  assert.deepEqual(parseGlossaryText(exportGlossaryText(entries, "csv")), [
    { sources: ["Orb" + emoji + ",Chaos"], target: "目标" },
    { sources: ["A " + curly + " D"], target: "弯引号" }
  ]);
});

test("structured sources keep a literal pipe instead of splitting it", () => {
  const parsed = parseGlossaryText('"Orb|Chaos" -> 宝珠');
  assert.deepEqual(parsed, [{ sources: ["Orb|Chaos"], target: "宝珠" }]);
  // A source with a literal pipe still matches the sentence as one term.
  assert.deepEqual(matchGlossaryTerms(["an orb|chaos drop"], parsed), [
    { source: "Orb|Chaos", target: "宝珠", matched: "orb|chaos" }
  ]);
  assert.equal(exportGlossaryText(parsed), '"Orb|Chaos" -> 宝珠');
});

test("exportGlossaryText round-trips through parseGlossaryText", () => {
  const entries = [
    { sources: ["Chaos Orb", "Chaos"], target: "混沌石" },
    { sources: ["Bone Ring"], target: "骨环, 骸骨戒指" },
    { sources: ["Orb, Lesser"], target: "次级宝珠" }
  ];
  const text = exportGlossaryText(entries);
  assert.deepEqual(parseGlossaryText(text), entries);
  assert.match(text, /"Orb, Lesser" -> 次级宝珠/);
  assert.deepEqual(parseGlossaryText(exportGlossaryText(entries, "csv")), [    { sources: ["Chaos Orb"], target: "混沌石" },
    { sources: ["Chaos"], target: "混沌石" },
    { sources: ["Bone Ring"], target: "骨环, 骸骨戒指" },
    { sources: ["Orb, Lesser"], target: "次级宝珠" }
  ]);

  const csv = exportGlossaryText(entries.slice(0, 2), "csv");
  assert.equal(
    csv,
    'Chaos Orb,混沌石\nChaos,混沌石\nBone Ring,"骨环, 骸骨戒指"'
  );
});
