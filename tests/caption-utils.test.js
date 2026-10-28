import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSrt,
  isNoiseTranscript,
  lineNeedsTranslation,
  mergeCaptionLines,
  migrateLegacySettings,
  normalizeCaptionLines,
  normalizeSettings,
  planTranscriptDiff,
  sanitizeSettingsPatch,
  selectDisplayCaption,
  settingsForBroadcast,
  shiftTimecode,
  transcriptDuration
} from "../extension/caption-utils.js";

test("normalizeSettings defaults to DeepSeek API and validates its fields", () => {
  const settings = normalizeSettings({});
  assert.equal(settings.translationMode, "api");
  assert.equal(settings.translationProvider, "deepseek");
  assert.equal(settings.translationModel, "deepseek-chat");
  assert.equal(settings.translationBaseUrl, "https://api.deepseek.com/v1");
  assert.equal(settings.translationTranslatePartial, true);
  assert.deepEqual(settings.translationApiKeys, {
    deepseek: "",
    openai: "",
    custom: ""
  });
});

test("local model selection defaults to 9B/large-v3-turbo and rejects unknown ids", () => {
  const defaults = normalizeSettings({});
  assert.equal(defaults.localTranslationModel, "9b-q4km");
  assert.equal(defaults.localAsrModel, "large-v3-turbo");

  const picked = normalizeSettings({
    localTranslationModel: "2b-iq4xs",
    localAsrModel: "medium"
  });
  assert.equal(picked.localTranslationModel, "2b-iq4xs");
  assert.equal(picked.localAsrModel, "medium");

  const invalid = normalizeSettings({
    localTranslationModel: "../../evil.gguf",
    localAsrModel: "whisper-huge"
  });
  assert.equal(invalid.localTranslationModel, "9b-q4km");
  assert.equal(invalid.localAsrModel, "large-v3-turbo");

  // The popup reads settings back through the broadcast helper.
  assert.equal(
    settingsForBroadcast({ localTranslationModel: "2b-iq4xs" })
      .localTranslationModel,
    "2b-iq4xs"
  );
});

test("display mode keeps the dual-line translation option", () => {
  assert.equal(normalizeSettings({ displayMode: "dual" }).displayMode, "dual");
  assert.equal(
    normalizeSettings({ displayMode: "klingon" }).displayMode,
    "bilingual"
  );
  assert.equal(
    settingsForBroadcast({ displayMode: "dual" }).displayMode,
    "dual"
  );
});

test("planTranscriptDiff appends, slides the window, and rebuilds otherwise", () => {
  assert.deepEqual(planTranscriptDiff(["a", "b"], ["a", "b", "c"]), {
    rebuild: false,
    drop: 0
  });
  assert.deepEqual(planTranscriptDiff(["a", "b", "c"], ["b", "c", "d"]), {
    rebuild: false,
    drop: 1
  });
  assert.deepEqual(planTranscriptDiff(["a", "b", "c"], ["a", "b", "c"]), {
    rebuild: false,
    drop: 0
  });
  assert.deepEqual(planTranscriptDiff([], ["a"]), {
    rebuild: false,
    drop: 0
  });
  assert.deepEqual(planTranscriptDiff(["a", "b"], ["x", "y"]), {
    rebuild: true,
    drop: 0
  });
  assert.deepEqual(planTranscriptDiff(["a", "b", "c"], ["a"]), {
    rebuild: true,
    drop: 0
  });
  assert.deepEqual(planTranscriptDiff(["a", "b", "c"], ["b", "x", "c"]), {
    rebuild: true,
    drop: 0
  });
});

test("content scripts cannot redirect translation settings or overwrite keys", () => {
  const patch = {
    displayMode: "chinese",
    fontSize: 40,
    translationMode: "api",
    translationBaseUrl: "https://attacker.example/v1",
    translationApiKeys: { deepseek: "stolen" }
  };
  assert.deepEqual(sanitizeSettingsPatch(patch), {
    displayMode: "chinese",
    fontSize: 40
  });
  assert.deepEqual(
    sanitizeSettingsPatch(patch, { fromExtensionPage: true }),
    patch
  );
});

test("legacy settings migrate to server mode without changing fresh defaults", () => {
  assert.equal(
    migrateLegacySettings({ wsUrl: "ws://127.0.0.1:8010/asr" }).translationMode,
    "server"
  );
  assert.equal(migrateLegacySettings({}).translationMode, "api");
  assert.equal(
    migrateLegacySettings({ translationMode: "api" }).translationMode,
    "api"
  );
});

test("settingsForBroadcast never exposes API keys", () => {
  const publicSettings = settingsForBroadcast({
    translationProvider: "deepseek",
    translationApiKeys: { deepseek: "secret-key", openai: "other-key" }
  });
  assert.equal("translationApiKeys" in publicSettings, false);
  assert.deepEqual(publicSettings.translationApiKeyConfigured, {
    deepseek: true,
    openai: true,
    custom: false
  });
  assert.equal(JSON.stringify(publicSettings).includes("secret-key"), false);
});

test("shiftTimecode converts reconnect-local time to session time", () => {
  assert.equal(shiftTimecode("0:00:12.40", 81.2), "0:01:33.60");
  assert.equal(shiftTimecode("0:00:01.98", 0), "0:00:01.98");
});

test("normalizeCaptionLines keeps IDs stable and shifts display time", () => {
  const normalized = normalizeCaptionLines(
    {
      lines: [
        {
          start: "0:00:05.00",
          end: "0:00:07.25",
          text: "hello",
          translation: "你好"
        }
      ]
    },
    {
      sessionId: "session",
      epochId: "epoch-2",
      epochStartedAt: 12_000,
      sessionStartedAt: 1_000,
      updatedAt: 1
    }
  );

  assert.equal(normalized.lines[0].id, "session:epoch-2:0:00:05.00");
  assert.equal(normalized.lines[0].start, "0:00:16.00");
  assert.equal(normalized.lines[0].end, "0:00:18.25");
  assert.equal(normalized.lines[0].order, 17_000);
  assert.equal(normalized.lines[0].translationPending, false);
});

test("isNoiseTranscript drops short silent-source fragments but keeps real words", () => {
  // Letterless pause fragments: decimal/clock shapes shorter than a spoken word.
  assert.equal(isNoiseTranscript("7.8.", 0.4), true);
  assert.equal(isNoiseTranscript("3.14", 0.9), true);
  assert.equal(isNoiseTranscript("0:12", 1.2), true);
  // Letterless symbols carry no text at all, whatever the duration.
  for (const noise of ["...", "", "   ", "%$#", "-", "♪", "🎵"]) {
    assert.equal(isNoiseTranscript(noise, 10), true, `expected noise: ${noise}`);
  }
  // Unknown duration is not evidence of noise: the line is kept.
  for (const kept of ["7.8.", "3.14", "12:34"]) {
    assert.equal(isNoiseTranscript(kept), false, `expected kept: ${kept}`);
    assert.equal(isNoiseTranscript(kept, null), false, `expected kept: ${kept}`);
    assert.equal(isNoiseTranscript(kept, 0), false, `expected kept: ${kept}`);
    // A long line that happens to be a number is speech.
    assert.equal(isNoiseTranscript(kept, 6), false, `expected speech: ${kept}`);
  }
  for (const real of [
    "Yes.",
    "No",
    "你好",
    "C3PO",
    "Okay!",
    // Plain integers are never dropped: only decimal and clock shapes are noise.
    "42",
    "1,024",
    "2024",
    "The raid starts at 7.8 seconds"
  ]) {
    assert.equal(isNoiseTranscript(real, 0.4), false, `expected speech: ${real}`);
  }
});

test("transcriptDuration refuses missing or reversed timestamps", () => {
  assert.equal(transcriptDuration({ start: "0:00:01.00", end: "0:00:03.50" }), 2.5);
  assert.equal(transcriptDuration({ start: "0:00:03.00", end: "0:00:01.00" }), null);
  assert.equal(transcriptDuration({ start: "0:00:03.00", end: "0:00:03.00" }), null);
  assert.equal(transcriptDuration({}), null);
  assert.equal(transcriptDuration(null), null);
  // One-sided or unparsable timestamps are unknown, not "one second long".
  assert.equal(transcriptDuration({ end: "0:00:01.00" }), null);
  assert.equal(transcriptDuration({ start: "0:00:01.00" }), null);
  assert.equal(transcriptDuration({ start: "abc", end: "0:00:02.00" }), null);
  assert.equal(transcriptDuration({ start: "0:00:01.00", end: "garbage" }), null);
  // Numeric seconds are accepted as well (parseTimecode supports both).
  assert.equal(transcriptDuration({ start: 1, end: 3.5 }), 2.5);
  assert.equal(transcriptDuration({ start: 1, end: Number.NaN }), null);
});

test("normalizeCaptionLines drops short noise lines and keeps untimed numbers", () => {
  const normalized = normalizeCaptionLines(
    {
      lines: [
        // 0.5 s of pause that the ASR rendered as a decimal.
        { start: "0:00:01.00", end: "0:00:01.50", text: "7.8." },
        // Same shape, but six seconds long: real speech, must survive.
        { start: "0:00:03.00", end: "0:00:09.00", text: "3.14" },
        // No timestamps at all, or only one side: unknown duration, never dropped.
        { text: "7.8." },
        { end: "0:00:09.50", text: "7.8." },
        { start: "0:00:09.60", text: "7.8." },
        { start: "0:00:10.00", end: "0:00:12.00", text: "Hello there." }
      ],
      buffer_transcription: "7.8.",
      buffer_translation: ""
    },
    { sessionId: "session", epochId: "epoch-1", epochStartedAt: 1, sessionStartedAt: 1 }
  );

  assert.deepEqual(
    normalized.lines.map((line) => line.source),
    ["3.14", "7.8.", "7.8.", "7.8.", "Hello there."]
  );
  // Buffers have no duration, so a number-shaped buffer is kept as well.
  assert.equal(normalized.bufferSource, "7.8.");
});

test("normalizeCaptionLines marks source-only lines as pending translation", () => {
  const normalized = normalizeCaptionLines(
    {
      lines: [
        {
          start: "0:00:05.00",
          end: "0:00:07.25",
          text: "hello",
          translation: ""
        }
      ]
    },
    { sessionId: "session", epochId: "epoch-1" }
  );

  assert.equal(normalized.lines[0].translationPending, true);
  assert.equal(lineNeedsTranslation(normalized.lines[0]), true);
});

test("selectDisplayCaption keeps the latest translated line while a new buffer is pending", () => {
  const caption = selectDisplayCaption({
    lines: [
      {
        id: "line-1",
        source: "The stable sentence.",
        translation: "稳定的译文。"
      }
    ],
    bufferSource: "A newer unfinished sentence",
    bufferTranslation: ""
  });

  assert.deepEqual(caption, {
    lineId: "line-1",
    source: "The stable sentence.",
    translation: "稳定的译文。",
    error: "",
    pending: false,
    failed: false
  });
});

test("selectDisplayCaption leaves the first pending translation empty", () => {
  const caption = selectDisplayCaption({
    lines: [],
    bufferSource: "First sentence",
    bufferTranslation: ""
  });

  assert.deepEqual(caption, {
    lineId: null,
    source: "First sentence",
    translation: "",
    error: "",
    pending: true,
    failed: false
  });
});

test("selectDisplayCaption marks a permanently failed line as failed, not pending", () => {
  const caption = selectDisplayCaption({
    lines: [
      {
        id: "line-1",
        source: "[MUSIC]",
        translation: "",
        translationFailed: true
      }
    ],
    translationError: "翻译 API 返回了空译文"
  });
  assert.equal(caption.failed, true);
  assert.equal(caption.pending, false);
  assert.match(caption.error, /空译文/);
});

test("mergeCaptionLines keeps reconnected epochs in session order", () => {
  const first = normalizeCaptionLines(
    {
      lines: [{ start: "0:01:20.00", end: "0:01:22.00", text: "first" }]
    },
    {
      sessionId: "session",
      epochId: "epoch-1",
      epochStartedAt: 1_000,
      sessionStartedAt: 1_000
    }
  ).lines;
  const second = normalizeCaptionLines(
    {
      lines: [{ start: "0:00:02.00", end: "0:00:04.00", text: "second" }]
    },
    {
      sessionId: "session",
      epochId: "epoch-2",
      epochStartedAt: 90_000,
      sessionStartedAt: 1_000
    }
  ).lines;

  assert.deepEqual(
    mergeCaptionLines(first, second).map((line) => line.source),
    ["first", "second"]
  );
  assert.equal(second[0].start, "0:01:31.00");
});

test("buildSrt uses continuous timestamps after reconnect", () => {
  const lines = normalizeCaptionLines(
    {
      lines: [
        {
          start: "0:00:01.00",
          end: "0:00:03.00",
          text: "second epoch",
          translation: "第二段"
        }
      ]
    },
    {
      sessionId: "session",
      epochId: "epoch-2",
      epochStartedAt: 121_000,
      sessionStartedAt: 1_000
    }
  ).lines;
  lines[0].order = 122_000;

  assert.match(
    buildSrt(lines),
    /00:02:01,000 --> 00:02:03,000/
  );
});
