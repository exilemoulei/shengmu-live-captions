import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSrt,
  lineNeedsTranslation,
  mergeCaptionLines,
  migrateLegacySettings,
  normalizeCaptionLines,
  normalizeSettings,
  sanitizeSettingsPatch,
  selectDisplayCaption,
  settingsForBroadcast,
  shiftTimecode
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
