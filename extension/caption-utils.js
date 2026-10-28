import {
  DEFAULT_TRANSLATION_MODE,
  DEFAULT_TRANSLATION_PROVIDER,
  DEFAULT_TRANSLATION_TIMEOUT_MS,
  normalizeTranslationSettings
} from "./translation-api.js";

export const SETTINGS_KEY = "settings";
export const RUNTIME_STATE_KEY = "runtimeState";
export const HISTORY_CHANGED_KEY = "historyRevision";

export const DEFAULT_SETTINGS = Object.freeze({
  wsUrl: "ws://127.0.0.1:8010/asr?target_language=zh",
  displayMode: "bilingual",
  fontSize: 34,
  opacity: 0.86,
  overlayEnabled: true,
  openPanelOnStart: true,
  autoScroll: true,
  translationMode: DEFAULT_TRANSLATION_MODE,
  translationProvider: DEFAULT_TRANSLATION_PROVIDER,
  translationBaseUrl: "https://api.deepseek.com/v1",
  translationModel: "deepseek-chat",
  translationApiKeys: Object.freeze({}),
  translationTranslatePartial: true,
  translationTimeoutMs: DEFAULT_TRANSLATION_TIMEOUT_MS
});

export const EMPTY_RUNTIME_STATE = Object.freeze({
  active: false,
  status: "idle",
  detail: "等待开始",
  sessionId: null,
  epochId: null,
  tabId: null,
  tabTitle: "",
  tabUrl: "",
  startedAt: null,
  updatedAt: null,
  wsConnected: false,
  lineCount: 0,
  audio: null,
  translation: null,
  current: {
    lines: [],
    bufferSource: "",
    bufferTranslation: "",
    translationError: "",
    epochId: null
  }
});

// "dual" keeps the previous translated line above the current one, so a
// sentence cut in two by the ASR segmenter still reads continuously.
const DISPLAY_MODES = new Set(["bilingual", "dual", "chinese", "english"]);

// Content scripts only need presentation settings. Translation/API settings
// must come from an extension page so a page-side script cannot redirect the
// stored API key to another endpoint.
const TAB_ALLOWED_SETTING_KEYS = new Set([
  "displayMode",
  "fontSize",
  "opacity",
  "overlayEnabled",
  "openPanelOnStart",
  "autoScroll"
]);

export function sanitizeSettingsPatch(patch, { fromExtensionPage = false } = {}) {
  const value = patch && typeof patch === "object" ? patch : {};
  if (fromExtensionPage) return value;
  const safe = {};
  for (const [key, entry] of Object.entries(value)) {
    if (TAB_ALLOWED_SETTING_KEYS.has(key)) safe[key] = entry;
  }
  return safe;
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeSettings(value = {}) {
  const displayMode = DISPLAY_MODES.has(value.displayMode)
    ? value.displayMode
    : DEFAULT_SETTINGS.displayMode;
  const translation = normalizeTranslationSettings(value);
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    wsUrl: normalizeWsUrl(value.wsUrl || DEFAULT_SETTINGS.wsUrl),
    displayMode,
    fontSize: Math.round(clamp(Number(value.fontSize) || DEFAULT_SETTINGS.fontSize, 20, 64)),
    opacity: clamp(Number(value.opacity) || DEFAULT_SETTINGS.opacity, 0.25, 1),
    overlayEnabled: value.overlayEnabled !== false,
    openPanelOnStart: value.openPanelOnStart !== false,
    autoScroll: value.autoScroll !== false,
    translationMode: translation.mode,
    translationProvider: translation.provider,
    translationBaseUrl: translation.baseUrl,
    translationModel: translation.model,
    translationApiKeys: translation.apiKeys,
    translationTranslatePartial: translation.translatePartial,
    translationTimeoutMs: translation.timeoutMs
  };
}

/**
 * 0.3.x settings predate translationMode and used the WhisperLiveKit
 * translation server. Preserve that behavior on upgrade; a fresh install
 * (empty object) keeps the new API/DeepSeek default.
 */
export function migrateLegacySettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const settings = normalizeSettings(source);
  if (Object.keys(source).length > 0 && source.translationMode === undefined) {
    settings.translationMode = "server";
  }
  return settings;
}

/**
 * Settings that are safe to send to content scripts and extension views.
 * API keys stay in the background service worker and are never broadcast.
 */
export function settingsForBroadcast(value = {}) {
  const normalized = normalizeSettings(value);
  const { translationApiKeys = {}, ...safe } = normalized;
  return {
    ...safe,
    translationApiKeyConfigured: Object.fromEntries(
      Object.keys(translationApiKeys).map((provider) => [
        provider,
        Boolean(translationApiKeys[provider])
      ])
    )
  };
}

export function normalizeWsUrl(value) {
  let url;
  try {
    url = new URL(String(value || DEFAULT_SETTINGS.wsUrl).trim());
  } catch {
    throw new Error("WebSocket 地址格式不正确");
  }
  if (!["ws:", "wss:"].includes(url.protocol)) {
    throw new Error("WebSocket 地址必须以 ws:// 或 wss:// 开头");
  }
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/asr";
  }
  if (!url.searchParams.has("target_language")) {
    url.searchParams.set("target_language", "zh");
  }
  return url.toString();
}

export function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function getTranslationText(line) {
  const translation = line?.translation;
  if (typeof translation === "string") {
    return cleanText(translation);
  }
  if (translation && typeof translation === "object") {
    return cleanText(translation.text);
  }
  return "";
}

export function selectDisplayCaption(current = {}) {
  const lines = Array.isArray(current.lines) ? current.lines : [];
  const reversedLines = [...lines].reverse();
  const latestLine = reversedLines.find((line) => line?.source || line?.translation);
  const translatedLine = reversedLines.find((line) => getTranslationText(line));
  const bufferSource = cleanText(current.bufferSource);
  const bufferTranslation = cleanText(current.bufferTranslation);
  const bufferIsComplete = Boolean(bufferSource && bufferTranslation);

  let source = "";
  let translation = "";
  let lineId = null;
  let failed = false;
  if (bufferIsComplete) {
    source = bufferSource;
    translation = bufferTranslation;
  } else if (translatedLine) {
    lineId = translatedLine.id || null;
    source = cleanText(translatedLine.source) || getTranslationText(translatedLine);
    translation = getTranslationText(translatedLine);
  } else {
    lineId = latestLine?.id || null;
    source = bufferSource || cleanText(latestLine?.source);
    translation = bufferSource
      ? bufferTranslation
      : getTranslationText(latestLine);
    failed = Boolean(
      !bufferSource && latestLine?.translationFailed && !translation
    );
  }

  return {
    lineId,
    source,
    translation,
    error: cleanText(current.translationError),
    pending: Boolean(source && !translation && !failed),
    failed
  };
}

export function parseTimecode(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  const match = String(value ?? "").trim().match(
    /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/
  );
  if (!match) return 0;
  const [, hours = "0", minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function shiftTimecode(value, offsetSeconds) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const shifted = parseTimecode(text) + Math.max(0, Number(offsetSeconds) || 0);
  const totalCentiseconds = Math.round(shifted * 100);
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return (
    `${hours}:${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}.` +
    String(centiseconds).padStart(2, "0")
  );
}

export function formatClock(value) {
  const seconds = Math.max(0, Math.floor(parseTimecode(value)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function normalizeCaptionLines(data, options = {}) {
  const sessionId = String(options.sessionId || "");
  const epochId = String(options.epochId || "epoch");
  const epochStartedAt = Number(options.epochStartedAt) || Date.now();
  const sessionStartedAt = Number(options.sessionStartedAt) || 0;
  const epochOffsetSeconds =
    sessionStartedAt > 0
      ? Math.max(0, (epochStartedAt - sessionStartedAt) / 1000)
      : 0;
  const sourceLines = Array.isArray(data?.lines) ? data.lines : [];
  const lines = [];
  const seen = new Map();

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index] || {};
    if (Number(line.speaker) === -2) continue;
    const source = cleanText(line.text);
    const translation = getTranslationText(line);
    if (!source && !translation) continue;
    const rawStart = String(line.start || "");
    const rawEnd = String(line.end || "");
    const start = shiftTimecode(rawStart, epochOffsetSeconds);
    const end = shiftTimecode(rawEnd, epochOffsetSeconds);
    const relativeOrder = parseTimecode(rawStart) * 1000;
    const baseKey = `${epochId}:${rawStart || `line-${index}`}`;
    const key = `${sessionId}:${baseKey}`;
    const previous = seen.get(key);
    const normalized = {
      id: key,
      sessionId,
      epochId,
      start,
      end,
      source,
      translation,
      translationPending: Boolean(source && !translation),
      speaker: Number.isFinite(Number(line.speaker)) ? Number(line.speaker) : 1,
      detectedLanguage: line.detected_language || line.detectedLanguage || "en",
      order: epochStartedAt + relativeOrder,
      updatedAt: Number(options.updatedAt) || Date.now()
    };

    if (previous) {
      const previousIndex = lines.indexOf(previous);
      lines[previousIndex] = normalized;
      seen.set(key, normalized);
    } else {
      seen.set(key, normalized);
      lines.push(normalized);
    }
  }

  return {
    lines,
    bufferSource: cleanText(data?.buffer_transcription || data?.bufferSource),
    bufferTranslation: cleanText(data?.buffer_translation || data?.bufferTranslation),
    translationError: cleanText(data?.translation_error || data?.translationError),
    status: data?.status || "active_transcription",
    remainingTranscription: Number(data?.remaining_time_transcription) || 0
  };
}

export function mergeCaptionLines(existingLines, incomingLines, limit = 20000) {
  const merged = new Map();
  for (const line of existingLines || []) {
    if (line?.id) merged.set(line.id, line);
  }
  for (const line of incomingLines || []) {
    if (!line?.id) continue;
    const previous = merged.get(line.id);
    merged.set(line.id, previous ? { ...previous, ...line } : line);
  }
  const result = [...merged.values()].sort(
    (left, right) => (left.order || 0) - (right.order || 0)
  );
  return result.length > limit ? result.slice(result.length - limit) : result;
}

/**
 * Decides how to update an append-only transcript list.
 *
 * The live caption page keeps a window of the newest rows, so a new line can
 * either be appended at the end or push the oldest row out of the window. Any
 * other change (filter, session switch, reordering) needs a full rebuild.
 */
export function planTranscriptDiff(previousIds = [], nextIds = []) {
  const previous = Array.isArray(previousIds) ? previousIds : [];
  const next = Array.isArray(nextIds) ? nextIds : [];
  let drop = 0;
  if (previous.length > 0 && next.length > 0) {
    drop = previous.indexOf(next[0]);
    if (drop < 0) return { rebuild: true, drop: 0 };
  }
  if (next.length < previous.length - drop) {
    return { rebuild: true, drop: 0 };
  }
  const aligned = previous
    .slice(drop)
    .every((id, index) => id === next[index]);
  return aligned ? { rebuild: false, drop } : { rebuild: true, drop: 0 };
}

export function lineChanged(previous, next) {
  if (!previous) return true;
  return (
    previous.source !== next.source ||
    previous.translation !== next.translation ||
    previous.start !== next.start ||
    previous.end !== next.end
  );
}

export function lineNeedsTranslation(line) {
  return Boolean(cleanText(line?.source)) && !getTranslationText(line);
}

export function formatSrtTimestamp(value) {
  const totalMilliseconds = Math.max(0, Math.round(Number(value) || 0));
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")},` +
    String(milliseconds).padStart(3, "0")
  );
}

export function buildSrt(lines) {
  const ordered = [...(lines || [])].sort(
    (left, right) => (left.order || 0) - (right.order || 0)
  );
  const cues = [];
  let index = 1;
  let previousEnd = 0;

  for (const line of ordered) {
    const startSeconds = Math.max(previousEnd, parseTimecode(line.start));
    const parsedEnd = parseTimecode(line.end);
    let endSeconds = Math.max(startSeconds + 0.45, parsedEnd);
    if (endSeconds - startSeconds > 12) {
      endSeconds = startSeconds + 12;
    }
    const text = cleanText(line.translation || line.source);
    if (!text) continue;
    cues.push(
      `${index}\n${formatSrtTimestamp(startSeconds * 1000)} --> ` +
      `${formatSrtTimestamp(endSeconds * 1000)}\n${text}\n`
    );
    previousEnd = endSeconds + 0.03;
    index += 1;
  }
  return cues.join("\n");
}

export function safeFileStem(value) {
  return cleanText(value || "caption")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 80) || "caption";
}

export function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
