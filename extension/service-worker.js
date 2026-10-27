import {
  DEFAULT_SETTINGS,
  EMPTY_RUNTIME_STATE,
  HISTORY_CHANGED_KEY,
  RUNTIME_STATE_KEY,
  SETTINGS_KEY,
  lineChanged,
  lineNeedsTranslation,
  mergeCaptionLines,
  normalizeCaptionLines,
  normalizeSettings,
  normalizeWsUrl
} from "./caption-utils.js";
import {
  countHistoryLines,
  createHistorySession,
  getHistoryLines,
  updateHistorySession,
  upsertHistoryLines
} from "./history-db.js";
import { HistoryWriteQueue } from "./history-write-queue.js";

const OFFSCREEN_URL = "offscreen.html";
const MONITOR_URL = "subtitle.html";
const LINE_FLUSH_DELAY_MS = 700;
const STATE_PERSIST_DELAY_MS = 350;

let settingsCache = { ...DEFAULT_SETTINGS };
let runtimeState = structuredClone(EMPTY_RUNTIME_STATE);
let initializationPromise = null;
let currentEpochLines = [];
let statePersistTimer = null;
let finalizingPromise = null;
let knownLineSignatures = new Map();
let pendingStopDetail = "";
let lastHistoryWriteError = "";

function safeClone(value) {
  return value == null ? value : structuredClone(value);
}

function compactRuntimeState() {
  return {
    ...safeClone(runtimeState),
    current: {
      ...safeClone(runtimeState.current),
      lines: (runtimeState.current?.lines || []).slice(-120)
    }
  };
}

function initialize() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const [localValues, sessionValues] = await Promise.all([
      chrome.storage.local.get([SETTINGS_KEY]),
      chrome.storage.session.get([RUNTIME_STATE_KEY])
    ]);
    try {
      settingsCache = normalizeSettings(localValues[SETTINGS_KEY] || {});
    } catch {
      settingsCache = { ...DEFAULT_SETTINGS };
      await chrome.storage.local.set({ [SETTINGS_KEY]: settingsCache });
    }
    if (!localValues[SETTINGS_KEY]) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: settingsCache });
    }
    if (sessionValues[RUNTIME_STATE_KEY]) {
      runtimeState = {
        ...structuredClone(EMPTY_RUNTIME_STATE),
        ...sessionValues[RUNTIME_STATE_KEY],
        current: {
          ...structuredClone(EMPTY_RUNTIME_STATE.current),
          ...(sessionValues[RUNTIME_STATE_KEY].current || {})
        }
      };
    }
    await updateBadge();
    if (runtimeState.active && !(await hasOffscreenDocument())) {
      await finalizeSession(
        "error",
        "浏览器后台采集页面已中断，请重新开始",
        { quiet: true }
      );
    }
  })();
  return initializationPromise;
}

async function getSettings() {
  await initialize();
  return { ...settingsCache };
}

async function saveSettings(patch) {
  await initialize();
  settingsCache = normalizeSettings({ ...settingsCache, ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: settingsCache });
  await broadcastToExtension({
    type: "settings-changed",
    settings: safeClone(settingsCache)
  });
  await applyOverlaySetting();
  return safeClone(settingsCache);
}

async function persistRuntimeState(immediate = false) {
  if (!immediate) {
    clearTimeout(statePersistTimer);
    statePersistTimer = setTimeout(() => {
      statePersistTimer = null;
      void chrome.storage.session.set({
        [RUNTIME_STATE_KEY]: compactRuntimeState()
      });
    }, STATE_PERSIST_DELAY_MS);
    return;
  }
  clearTimeout(statePersistTimer);
  statePersistTimer = null;
  await chrome.storage.session.set({
    [RUNTIME_STATE_KEY]: compactRuntimeState()
  });
}

async function updateBadge() {
  if (runtimeState.active) {
    await chrome.action.setBadgeBackgroundColor({ color: "#c6412c" });
    await chrome.action.setBadgeText({
      text: runtimeState.status === "reconnecting" ? "..." : "REC"
    });
    await chrome.action.setTitle({
      title: runtimeState.detail || "声幕正在采集标签页音频"
    });
  } else {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "声幕 - 实时字幕翻译" });
  }
}

async function broadcastToExtension(message) {
  try {
    await chrome.runtime.sendMessage({
      target: "extension-view",
      ...message,
      state: compactRuntimeState()
    });
  } catch {
    // No extension view is open.
  }
}

async function sendToTab(message) {
  if (!runtimeState.tabId) return false;
  try {
    await chrome.tabs.sendMessage(runtimeState.tabId, {
      target: "content",
      ...message
    });
    return true;
  } catch {
    return false;
  }
}

async function broadcastCaptionState() {
  await sendToTab({
    type: "caption-state",
    payload: {
      active: runtimeState.active,
      status: runtimeState.status,
      detail: runtimeState.detail,
      lineCount: runtimeState.lineCount,
      wsConnected: runtimeState.wsConnected,
      updatedAt: runtimeState.updatedAt,
      current: safeClone(runtimeState.current)
    },
    settings: safeClone(settingsCache)
  });
}

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "Capture one tab, play its audio, and stream PCM to local captions."
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
}

async function messageOffscreen(message) {
  await ensureOffscreenDocument();
  try {
    return await chrome.runtime.sendMessage({
      target: "offscreen",
      ...message
    });
  } catch (error) {
    throw new Error(`无法联系音频采集页面：${error?.message || error}`);
  }
}

async function injectOverlay(tabId = runtimeState.tabId) {
  if (!tabId) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-overlay.js"]
    });
  } catch (error) {
    console.warn("声幕页面浮层注入失败", error);
    return false;
  }
  try {
    await chrome.tabs.sendMessage(tabId, {
      target: "content",
      type: "init",
      settings: safeClone(settingsCache),
      state: compactRuntimeState()
    });
  } catch {
    // The injected script can request the latest state after initialization.
  }
  return true;
}

async function hideOverlay() {
  await sendToTab({ type: "hide-overlay" });
}

async function applyOverlaySetting() {
  if (!runtimeState.tabId) return;
  if (settingsCache.overlayEnabled) {
    const injected = await injectOverlay(runtimeState.tabId);
    if (!injected && runtimeState.active) {
      runtimeState.detail = "页面浮层不可用，可在字幕窗口中继续观看";
      await broadcastToExtension({ type: "session-state" });
    }
    await broadcastCaptionState();
  } else {
    await hideOverlay();
  }
}

async function findMonitorTab() {
  const monitorUrl = chrome.runtime.getURL(MONITOR_URL);
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => (tab.url || "").startsWith(monitorUrl)) || null;
}

async function openMonitorWindow(options = {}) {
  await initialize();
  const query = options.welcome ? "?welcome=1" : "";
  const url = chrome.runtime.getURL(`${MONITOR_URL}${query}`);
  const existing = await findMonitorTab();
  if (existing?.id) {
    await chrome.windows.update(existing.windowId, { focused: true });
    if (existing.url !== url && existing.id) {
      await chrome.tabs.update(existing.id, { url, active: true });
    }
    return existing;
  }
  const created = await chrome.windows.create({
    url,
    type: "popup",
    width: 1160,
    height: 760,
    left: 80,
    top: 60,
    focused: true
  });
  return created;
}

async function notifyHistoryChanged(sessionId) {
  await chrome.storage.local.set({ [HISTORY_CHANGED_KEY]: Date.now() });
  await broadcastToExtension({
    type: "history-changed",
    sessionId
  });
}

async function commitHistoryBatch(lines) {
  const bySession = new Map();
  for (const line of lines || []) {
    if (!line?.sessionId) continue;
    if (!bySession.has(line.sessionId)) bySession.set(line.sessionId, []);
    bySession.get(line.sessionId).push(line);
  }

  for (const [sessionId, sessionLines] of bySession) {
    await upsertHistoryLines(sessionLines);
    const count = await countHistoryLines(sessionId);
    const lastLine = [...sessionLines]
      .filter((line) => line.source || line.translation)
      .sort((left, right) => (left.order || 0) - (right.order || 0))
      .at(-1);
    const isCurrentSession = sessionId === runtimeState.sessionId;
    if (isCurrentSession) runtimeState.lineCount = count;
    const patch = {
      lineCount: count,
      preview: lastLine?.translation || lastLine?.source || ""
    };
    if (isCurrentSession) {
      patch.status = runtimeState.active ? "capturing" : runtimeState.status;
    }
    await updateHistorySession(sessionId, patch);
    if (isCurrentSession) {
      if (lastHistoryWriteError) {
        lastHistoryWriteError = "";
        if (runtimeState.detail.startsWith("字幕历史写入失败")) {
          runtimeState.detail = "字幕历史已恢复写入";
        }
      }
      await persistRuntimeState(true);
      await broadcastToExtension({ type: "line-count", lineCount: count });
    }
  }
}

function handleHistoryWriteError(error) {
  lastHistoryWriteError = error?.message || String(error);
  console.error("声幕历史字幕写入失败", error);
  if (!runtimeState.active) return;
  runtimeState.detail = `字幕历史写入失败，正在重试：${lastHistoryWriteError}`;
  runtimeState.updatedAt = Date.now();
  void persistRuntimeState();
  void broadcastToExtension({
    type: "status",
    status: {
      state: runtimeState.status,
      detail: runtimeState.detail,
      wsConnected: runtimeState.wsConnected
    }
  });
}

const historyWriteQueue = new HistoryWriteQueue({
  writeBatch: commitHistoryBatch,
  debounceMs: LINE_FLUSH_DELAY_MS,
  onError: handleHistoryWriteError
});

async function flushPendingHistory(force = false) {
  if (!force) {
    historyWriteQueue.schedule();
    return;
  }
  await historyWriteQueue.flush({ drain: true });
}

async function summarizeHistorySession(sessionId) {
  const lines = await getHistoryLines(sessionId);
  const ordered = [...lines].sort(
    (left, right) => (left.order || 0) - (right.order || 0)
  );
  const lastLine = ordered.at(-1);
  return {
    lineCount: ordered.length,
    translationMissing: ordered.filter(lineNeedsTranslation).length,
    preview: lastLine?.translation || lastLine?.source || ""
  };
}

async function resetSessionMemory() {
  currentEpochLines = [];
  knownLineSignatures.clear();
}

async function startSession(message) {
  await initialize();
  if (runtimeState.active) {
    await stopSession({ quiet: true });
  }

  let wsUrl;
  try {
    wsUrl = normalizeWsUrl(message.wsUrl || settingsCache.wsUrl);
  } catch (error) {
    throw new Error(error?.message || String(error));
  }
  settingsCache = normalizeSettings({ ...settingsCache, wsUrl });
  await chrome.storage.local.set({ [SETTINGS_KEY]: settingsCache });

  const sessionId = crypto.randomUUID();
  const startedAt = Date.now();
  const metadata = {
    id: sessionId,
    startedAt,
    title: message.tabTitle || "未命名直播",
    url: message.tabUrl || "",
    tabId: message.targetTabId ?? null,
    wsUrl,
    status: "starting",
    lineCount: 0,
    preview: ""
  };
  await resetSessionMemory();
  await createHistorySession(metadata);
  pendingStopDetail = "";

  runtimeState = {
    ...structuredClone(EMPTY_RUNTIME_STATE),
    active: true,
    status: "starting",
    detail: "正在建立音频采集",
    sessionId,
    tabId: message.targetTabId ?? null,
    tabTitle: metadata.title,
    tabUrl: metadata.url,
    startedAt,
    updatedAt: startedAt,
    current: structuredClone(EMPTY_RUNTIME_STATE.current)
  };
  await persistRuntimeState(true);
  await updateBadge();
  await broadcastToExtension({
    type: "session-state",
    session: metadata
  });
  await notifyHistoryChanged(sessionId);

  let result;
  try {
    result = await messageOffscreen({
      type: "start-capture",
      sessionId,
      targetTabId: message.targetTabId,
      streamId: message.streamId,
      wsUrl
    });
    if (!result?.ok) throw new Error(result?.error || "音频采集启动失败");
  } catch (error) {
    await finalizeSession("error", error?.message || String(error), {
      quiet: true
    });
    throw error;
  }

  if (settingsCache.overlayEnabled) {
    await injectOverlay(runtimeState.tabId);
  }
  let warning = "";
  if (settingsCache.openPanelOnStart) {
    try {
      await openMonitorWindow();
    } catch (error) {
      warning = `字幕窗口未能自动打开：${error?.message || error}`;
      runtimeState.detail = warning;
      runtimeState.updatedAt = Date.now();
      await persistRuntimeState(true);
      await broadcastToExtension({ type: "session-state" });
    }
  }
  return { ok: true, sessionId, warning };
}

async function finalizeSession(status, detail, options = {}) {
  if (finalizingPromise) return finalizingPromise;
  finalizingPromise = (async () => {
    const sessionId = runtimeState.sessionId;
    let finalStatus = status;
    let finalDetail = detail || runtimeState.detail;
    let lineCount = runtimeState.lineCount || 0;
    let translationMissing = 0;
    let preview =
      runtimeState.current?.lines?.at(-1)?.translation ||
      runtimeState.current?.lines?.at(-1)?.source ||
      "";

    try {
      try {
        await flushPendingHistory(true);
      } catch (error) {
        finalStatus = "error";
        finalDetail = `字幕历史写入失败：${error?.message || error}`;
      }

      if (sessionId) {
        try {
          const summary = await summarizeHistorySession(sessionId);
          lineCount = summary.lineCount;
          translationMissing = summary.translationMissing;
          preview = summary.preview || preview;
          if (translationMissing > 0 && finalStatus === "stopped") {
            finalStatus = "incomplete";
            finalDetail =
              `${finalDetail}；${translationMissing} 条字幕缺少译文`;
          }
          await updateHistorySession(sessionId, {
            endedAt: Date.now(),
            status: finalStatus,
            lineCount,
            translationMissing,
            preview
          });
        } catch (error) {
          finalStatus = "error";
          finalDetail = `字幕历史收尾失败：${error?.message || error}`;
        }
      }
    } finally {
      runtimeState.active = false;
      runtimeState.status = finalStatus;
      runtimeState.detail = finalDetail || runtimeState.detail;
      runtimeState.wsConnected = false;
      runtimeState.lineCount = lineCount;
      runtimeState.translationMissing = translationMissing;
      runtimeState.updatedAt = Date.now();
      try {
        await persistRuntimeState(true);
        await updateBadge();
      } catch (error) {
        console.error("声幕运行状态收尾失败", error);
      }
      if (!options.quiet) {
        await broadcastToExtension({
          type: "session-ended",
          status: finalStatus,
          detail: runtimeState.detail
        });
        await broadcastCaptionState();
      }
      if (sessionId) await notifyHistoryChanged(sessionId);
      pendingStopDetail = "";
    }
  })();
  try {
    return await finalizingPromise;
  } finally {
    finalizingPromise = null;
  }
}

async function stopSession(options = {}) {
  await initialize();
  if (!runtimeState.active && !(await hasOffscreenDocument())) {
    return { ok: true, alreadyStopped: true };
  }
  if (runtimeState.active) {
    pendingStopDetail = options.detail || "标签页音频采集已停止";
  }
  try {
    if (await hasOffscreenDocument()) {
      await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "stop-capture",
        quiet: true
      });
    }
  } catch (error) {
    console.warn("声幕停止采集时出现错误", error);
  }
  await finalizeSession(
    options.status || "stopped",
    pendingStopDetail || options.detail || "标签页音频采集已停止",
    { quiet: options.quiet === true }
  );
  return { ok: true };
}

async function handleStatusReport(message) {
  if (
    message.sessionId &&
    runtimeState.sessionId &&
    message.sessionId !== runtimeState.sessionId
  ) {
    return;
  }
  const status = message.status || {};
  if (!runtimeState.active) return;
  runtimeState.status = status.state || runtimeState.status;
  runtimeState.detail = status.detail || runtimeState.detail;
  runtimeState.wsConnected = Boolean(status.wsConnected);
  runtimeState.audio = status.audio || runtimeState.audio;
  runtimeState.captureInfo = status.captureInfo || runtimeState.captureInfo;
  runtimeState.updatedAt = status.updatedAt || Date.now();
  await persistRuntimeState();
  await updateBadge();
  await broadcastToExtension({ type: "status", status: safeClone(status) });
  await broadcastCaptionState();

  if (status.state === "error" && status.fatal && runtimeState.active) {
    await stopSession({
      status: "error",
      detail: status.detail || "字幕服务发生致命错误"
    });
    return;
  }
  if (status.state === "stopped" && runtimeState.active) {
    await finalizeSession(
      "stopped",
      pendingStopDetail || status.detail || "采集已停止"
    );
  }
}

async function refreshSourceMetadata(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  const title = String(tab.title || runtimeState.tabTitle || "未命名直播");
  const url = String(tab.url || runtimeState.tabUrl || "");
  if (title === runtimeState.tabTitle && url === runtimeState.tabUrl) return;

  runtimeState.tabTitle = title;
  runtimeState.tabUrl = url;
  runtimeState.updatedAt = Date.now();
  if (runtimeState.sessionId) {
    await updateHistorySession(runtimeState.sessionId, {
      title,
      url,
      updatedAt: runtimeState.updatedAt
    });
  }
  await persistRuntimeState(true);
  await broadcastToExtension({ type: "session-state" });
}

async function handleTranscriptUpdate(message) {
  if (!runtimeState.active || message.sessionId !== runtimeState.sessionId) return;
  const updatedAt = Date.now();
  const normalized = normalizeCaptionLines(message.data, {
    sessionId: message.sessionId,
    epochId: message.epochId,
    epochStartedAt: message.epochStartedAt,
    sessionStartedAt: runtimeState.startedAt,
    updatedAt
  });
  currentEpochLines = normalized.lines;

  for (const rawLine of normalized.lines) {
    const previous = knownLineSignatures.get(rawLine.id);
    const line =
      previous?.source === rawLine.source &&
      previous.translation &&
      !rawLine.translation
        ? {
            ...rawLine,
            translation: previous.translation,
            translationPending: false
          }
        : rawLine;
    const signature = `${line.source}\u0000${line.translation}`;
    if (lineChanged(previous, line) || previous?.signature !== signature) {
      historyWriteQueue.enqueue([line]);
      knownLineSignatures.set(line.id, { ...line, signature });
    }
  }

  runtimeState.status =
    runtimeState.status === "reconnecting" ? "capturing" : runtimeState.status;
  runtimeState.wsConnected = true;
  runtimeState.updatedAt = updatedAt;
  runtimeState.current = {
    lines: mergeCaptionLines([], normalized.lines, 120),
    bufferSource: normalized.bufferSource,
    bufferTranslation: normalized.bufferTranslation,
    translationError: normalized.translationError,
    epochId: message.epochId || null
  };

  await persistRuntimeState();
  await broadcastToExtension({
    type: "caption-state",
    current: safeClone(runtimeState.current),
    epochId: message.epochId,
    lineCount: runtimeState.lineCount
  });
  await broadcastCaptionState();
  await flushPendingHistory(false);
}

async function handleAudioStats(message) {
  if (message.sessionId && message.sessionId !== runtimeState.sessionId) return;
  runtimeState.audio = message.audio || runtimeState.audio;
  runtimeState.updatedAt = Date.now();
  await broadcastToExtension({
    type: "audio-stats",
    audio: safeClone(runtimeState.audio)
  });
  await persistRuntimeState();
}

async function probeServices() {
  const settings = await getSettings();
  let wsHost = "127.0.0.1";
  let wsPort = "8010";
  let healthProtocol = "http:";
  try {
    const wsUrl = new URL(settings.wsUrl);
    wsHost = wsUrl.hostname;
    wsPort = wsUrl.port || (wsUrl.protocol === "wss:" ? "443" : "80");
    healthProtocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  } catch {
    // Keep local defaults; settings validation normally prevents this path.
  }
  const requests = [
    fetch(`${healthProtocol}//${wsHost}:${wsPort}/health`, {
      signal: AbortSignal.timeout(1600)
    }).then(async (response) => ({
      key: "asr",
      ok: response.ok,
      detail: response.ok ? "ASR 服务在线" : `HTTP ${response.status}`
    })),
    fetch("http://127.0.0.1:8013/health", {
      signal: AbortSignal.timeout(1600)
    }).then(async (response) => ({
      key: "translation",
      ok: response.ok,
      detail: response.ok ? "翻译服务在线" : `HTTP ${response.status}`
    }))
  ];
  const results = await Promise.allSettled(requests);
  return results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      key: index === 0 ? "asr" : "translation",
      ok: false,
      detail: "未连接"
    };
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  void initialize().then(async () => {
    if (details.reason === "install") {
      await openMonitorWindow({ welcome: true });
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  void initialize();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      await initialize();
      const fromOffscreen = message?.source === "offscreen";
      const toBackground = message?.target === "background";
      const toContent = message?.target === "content";

      if (fromOffscreen) {
        if (message.type === "status-report") {
          await handleStatusReport(message);
        } else if (message.type === "transcript-update") {
          await handleTranscriptUpdate(message);
        } else if (message.type === "audio-stats") {
          await handleAudioStats(message);
        }
        sendResponse({ ok: true });
        return;
      }

      if (toContent) {
        sendResponse({ ok: true });
        return;
      }

      if (!toBackground) {
        sendResponse({ ok: false });
        return;
      }

      if (message.type === "start-capture") {
        sendResponse(await startSession(message));
      } else if (message.type === "stop-capture") {
        sendResponse(await stopSession());
      } else if (message.type === "get-state") {
        sendResponse({
          ok: true,
          state: compactRuntimeState(),
          settings: safeClone(settingsCache)
        });
      } else if (message.type === "get-settings") {
        sendResponse({ ok: true, settings: safeClone(settingsCache) });
      } else if (message.type === "save-settings") {
        sendResponse({
          ok: true,
          settings: await saveSettings(message.settings || {})
        });
      } else if (message.type === "open-monitor") {
        await openMonitorWindow();
        sendResponse({ ok: true });
      } else if (message.type === "toggle-overlay") {
        const next = !settingsCache.overlayEnabled;
        const saved = await saveSettings({ overlayEnabled: next });
        sendResponse({ ok: true, settings: saved, enabled: next });
      } else if (message.type === "show-overlay") {
        const saved = await saveSettings({ overlayEnabled: true });
        sendResponse({ ok: true, settings: saved });
      } else if (message.type === "hide-overlay") {
        const saved = await saveSettings({ overlayEnabled: false });
        sendResponse({ ok: true, settings: saved });
      } else if (message.type === "refresh-overlay") {
        const injected = await injectOverlay();
        sendResponse({ ok: injected });
      } else if (message.type === "content-ready") {
        sendResponse({
          ok: true,
          state: compactRuntimeState(),
          settings: safeClone(settingsCache)
        });
      } else if (message.type === "probe-services") {
        sendResponse({ ok: true, services: await probeServices() });
      } else {
        sendResponse({ ok: false, error: `未知消息：${message.type}` });
      }
    } catch (error) {
      console.error("声幕后台错误", error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open_caption_window") {
    void openMonitorWindow();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (runtimeState.active && tabId === runtimeState.tabId) {
    void stopSession({ detail: "直播标签页已关闭" });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== runtimeState.tabId || !runtimeState.active) return;
  if (
    !changeInfo.title &&
    !changeInfo.url &&
    changeInfo.status !== "complete"
  ) {
    return;
  }
  void (async () => {
    await refreshSourceMetadata(tabId);
    if (changeInfo.status === "complete") {
      if (settingsCache.overlayEnabled) {
        await injectOverlay(tabId);
      }
      await broadcastCaptionState();
    }
  })();
});

void initialize();
