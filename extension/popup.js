import {
  DEFAULT_SETTINGS,
  hostnameFromUrl,
  normalizeSettings,
  normalizeWsUrl
} from "./caption-utils.js";

const elements = {
  tabTitle: document.querySelector("#tabTitle"),
  tabUrl: document.querySelector("#tabUrl"),
  statusDot: document.querySelector("#statusDot"),
  statusLabel: document.querySelector("#statusLabel"),
  audioRatio: document.querySelector("#audioRatio"),
  livePreview: document.querySelector("#livePreview"),
  primaryButton: document.querySelector("#primaryButton"),
  primaryLabel: document.querySelector("#primaryLabel"),
  errorMessage: document.querySelector("#errorMessage"),
  displayMode: document.querySelector("#displayMode"),
  fontSize: document.querySelector("#fontSize"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  overlayEnabled: document.querySelector("#overlayEnabled"),
  openPanelOnStart: document.querySelector("#openPanelOnStart"),
  wsUrl: document.querySelector("#wsUrl"),
  probeButton: document.querySelector("#probeButton"),
  serviceResults: document.querySelector("#serviceResults"),
  openMonitor: document.querySelector("#openMonitor"),
  openMonitorFooter: document.querySelector("#openMonitorFooter")
};

let activeTab = null;
let runtimeState = null;
let settings = normalizeSettings(DEFAULT_SETTINGS);
let busy = false;
let fontSaveTimer = null;

function setError(message = "") {
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = !message;
}

function statusPresentation(state) {
  if (!state?.active) {
    if (state?.status === "error") {
      return {
        label: state.detail || "采集异常",
        dotClass: "warning",
        ratio: ""
      };
    }
    if (state?.status === "incomplete") {
      return {
        label: state.detail || "已停止，存在缺译",
        dotClass: "warning",
        ratio: ""
      };
    }
    return { label: "准备就绪", dotClass: "", ratio: "" };
  }
  const status = state.status || "capturing";
  const labels = {
    starting: "正在建立音频采集",
    capturing: state.wsConnected ? "实时翻译中" : "等待字幕服务",
    reconnecting: "字幕服务重连中",
    finished: "正在收尾",
    error: state.detail || "采集异常",
    stopped: "已停止"
  };
  const dotClass = status === "capturing" && state.wsConnected
    ? "live"
    : ["starting", "reconnecting"].includes(status)
      ? "warning"
      : "";
  const ratio = state.audio?.deliveredRatio
    ? `音频 ${Math.round(state.audio.deliveredRatio * 100)}%`
    : "";
  return { label: labels[status] || state.detail || status, dotClass, ratio };
}

function render() {
  const displayTab = runtimeState?.active
    ? { title: runtimeState.tabTitle, url: runtimeState.tabUrl }
    : activeTab;
  elements.tabTitle.textContent = displayTab?.title || "没有可用的标签页";
  elements.tabUrl.textContent = displayTab?.url
    ? hostnameFromUrl(displayTab.url) || displayTab.url
    : "请先打开直播或视频页面";

  const presentation = statusPresentation(runtimeState);
  elements.statusLabel.textContent = presentation.label;
  elements.statusDot.className = `status-dot ${presentation.dotClass}`.trim();
  elements.audioRatio.textContent = presentation.ratio;

  const current = runtimeState?.current;
  const lastLine = current?.lines?.at(-1);
  const preview =
    current?.bufferTranslation ||
    lastLine?.translation ||
    current?.bufferSource ||
    lastLine?.source ||
    "";
  elements.livePreview.textContent = preview;
  elements.livePreview.hidden = !preview;

  const active = Boolean(runtimeState?.active);
  elements.primaryLabel.textContent = active ? "停止当前字幕" : "开始实时翻译";
  elements.primaryButton.classList.toggle("stop", active);
  elements.primaryButton.disabled = busy;

  elements.displayMode.value = settings.displayMode;
  elements.fontSize.value = String(settings.fontSize);
  elements.fontSizeValue.value = String(settings.fontSize);
  elements.overlayEnabled.checked = settings.overlayEnabled;
  elements.openPanelOnStart.checked = settings.openPanelOnStart;
  elements.wsUrl.value = settings.wsUrl;
}

async function refresh() {
  const [tabs, response] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.runtime.sendMessage({ target: "background", type: "get-state" })
  ]);
  activeTab = tabs[0] || null;
  runtimeState = response?.state || null;
  settings = normalizeSettings(response?.settings || DEFAULT_SETTINGS);
  render();
}

async function savePatch(patch) {
  const response = await chrome.runtime.sendMessage({
    target: "background",
    type: "save-settings",
    settings: patch
  });
  if (!response?.ok) throw new Error(response?.error || "保存设置失败");
  settings = normalizeSettings(response.settings);
  render();
}

async function startCapture() {
  setError();
  if (!activeTab?.id) throw new Error("没有找到当前标签页");
  if (!/^https?:/i.test(activeTab.url || "")) {
    throw new Error("此页面不支持标签页音频采集，请打开直播或视频网页");
  }
  await savePatch({ wsUrl: normalizeWsUrl(elements.wsUrl.value) });
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: activeTab.id
  });
  const response = await chrome.runtime.sendMessage({
    target: "background",
    type: "start-capture",
    streamId,
    targetTabId: activeTab.id,
    tabTitle: activeTab.title || "未命名直播",
    tabUrl: activeTab.url || "",
    wsUrl: settings.wsUrl
  });
  if (!response?.ok) throw new Error(response?.error || "采集启动失败");
  if (response.warning) {
    setError(response.warning);
    return;
  }
  setTimeout(() => window.close(), 280);
}

async function stopCapture() {
  const response = await chrome.runtime.sendMessage({
    target: "background",
    type: "stop-capture"
  });
  if (!response?.ok) throw new Error(response?.error || "停止失败");
  await refresh();
}

elements.primaryButton.addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  render();
  try {
    if (runtimeState?.active) {
      await stopCapture();
    } else {
      await startCapture();
    }
  } catch (error) {
    setError(error?.message || String(error));
  } finally {
    busy = false;
    render();
  }
});

elements.displayMode.addEventListener("change", () => {
  void savePatch({ displayMode: elements.displayMode.value }).catch((error) =>
    setError(error.message)
  );
});

elements.fontSize.addEventListener("input", () => {
  const value = Number(elements.fontSize.value);
  elements.fontSizeValue.value = String(value);
  clearTimeout(fontSaveTimer);
  fontSaveTimer = setTimeout(() => {
    void savePatch({ fontSize: value }).catch((error) =>
      setError(error.message)
    );
  }, 180);
});

elements.overlayEnabled.addEventListener("change", () => {
  void savePatch({ overlayEnabled: elements.overlayEnabled.checked }).catch(
    (error) => setError(error.message)
  );
});

elements.openPanelOnStart.addEventListener("change", () => {
  void savePatch({ openPanelOnStart: elements.openPanelOnStart.checked }).catch(
    (error) => setError(error.message)
  );
});

elements.wsUrl.addEventListener("change", () => {
  try {
    elements.wsUrl.value = normalizeWsUrl(elements.wsUrl.value);
    void savePatch({ wsUrl: elements.wsUrl.value }).catch((error) =>
      setError(error.message)
    );
  } catch (error) {
    setError(error.message);
  }
});

elements.probeButton.addEventListener("click", async () => {
  elements.probeButton.disabled = true;
  elements.serviceResults.hidden = false;
  elements.serviceResults.textContent = "正在检查...";
  try {
    const response = await chrome.runtime.sendMessage({
      target: "background",
      type: "probe-services"
    });
    if (!response?.ok) throw new Error(response?.error || "检查失败");
    const labels = { asr: "ASR", translation: "翻译" };
    elements.serviceResults.replaceChildren(
      ...response.services.map((service) => {
        const row = document.createElement("span");
        const name = document.createElement("b");
        name.textContent = labels[service.key] || service.key;
        const state = document.createElement("span");
        state.className = service.ok ? "ok" : "failed";
        state.textContent = service.detail;
        row.append(name, state);
        return row;
      })
    );
  } catch (error) {
    elements.serviceResults.textContent = error.message;
  } finally {
    elements.probeButton.disabled = false;
  }
});

function openMonitor() {
  void chrome.runtime.sendMessage({ target: "background", type: "open-monitor" });
}

elements.openMonitor.addEventListener("click", openMonitor);
elements.openMonitorFooter.addEventListener("click", openMonitor);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "extension-view") return;
  if (message.state) runtimeState = message.state;
  if (message.settings) settings = normalizeSettings(message.settings);
  if (["session-state", "status", "caption-state", "session-ended"].includes(message.type)) {
    render();
  }
});

window.addEventListener("unhandledrejection", (event) => {
  setError(event.reason?.message || String(event.reason));
});

void refresh().catch((error) => setError(error.message));
