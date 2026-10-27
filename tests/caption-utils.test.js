import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSrt,
  lineNeedsTranslation,
  mergeCaptionLines,
  normalizeCaptionLines,
  shiftTimecode
} from "../extension/caption-utils.js";

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
