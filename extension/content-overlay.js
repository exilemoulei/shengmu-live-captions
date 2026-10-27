(() => {
  const existing = globalThis.__shengmuCaptionOverlay;
  if (existing?.refresh) {
    existing.refresh();
    return;
  }

  const DEFAULT_SETTINGS = {
    displayMode: "bilingual",
    fontSize: 34,
    opacity: 0.86,
    overlayEnabled: true
  };
  const MODES = ["bilingual", "chinese", "english"];
  const POSITION_KEY = "overlayPositions";

  let settings = { ...DEFAULT_SETTINGS };
  let runtimeState = null;
  let host = null;
  let shadow = null;
  let stage = null;
  let sourceElement = null;
  let translationElement = null;
  let statusElement = null;
  let modeButton = null;
  let idleTimer = null;
  let positionStore = {};
  let dragState = null;

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function siteKey() {
    return location.hostname || "local";
  }

  function currentModeLabel() {
    return {
      bilingual: "双语",
      chinese: "中文",
      english: "英文"
    }[settings.displayMode] || "双语";
  }

  function statusLabel() {
    if (!runtimeState?.active) {
      return runtimeState.status === "incomplete" ? "有缺译" : "已停止";
    }
    if (runtimeState.status === "reconnecting") return "重连中";
    if (runtimeState.status === "starting") return "准备中";
    if (runtimeState.status === "error") return "异常";
    if (runtimeState.wsConnected) return "实时";
    return "等待服务";
  }

  function buildOverlay() {
    // Extension reloads can leave a detached isolated-world host behind.
    document
      .querySelectorAll("#shengmu-caption-host")
      .forEach((existingHost) => existingHost.remove());
    host = document.createElement("div");
    host.id = "shengmu-caption-host";
    host.style.cssText =
      "all:initial;position:fixed;inset:0;z-index:2147483647;" +
      "pointer-events:none;contain:layout style;";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .stage {
          --translation-size: 34px;
          --overlay-opacity: 0.86;
          position: fixed;
          left: 50%;
          bottom: 8vh;
          width: min(82vw, 1180px);
          min-width: 320px;
          transform: translateX(-50%);
          color: #fffdf4;
          font-family: "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
          pointer-events: none;
          transition: opacity 180ms ease, transform 180ms ease;
        }
        .stage.dragged {
          transform: none;
        }
        .stage[hidden] { display: none; }
        .caption-shell {
          position: relative;
          padding: 18px 22px 16px;
          overflow: hidden;
          border: 1px solid rgba(255, 249, 225, 0.16);
          border-left: 3px solid #e8b84b;
          border-radius: 3px 13px 13px 3px;
          background:
            linear-gradient(105deg, rgba(20, 28, 24, calc(var(--overlay-opacity) + 0.04)), rgba(12, 17, 15, var(--overlay-opacity)));
          box-shadow:
            0 20px 54px rgba(0, 0, 0, 0.42),
            inset 0 1px rgba(255, 255, 255, 0.06);
          backdrop-filter: blur(11px) saturate(0.8);
        }
        .caption-shell::after {
          position: absolute;
          top: 0;
          right: 0;
          width: 38%;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(232, 184, 75, 0.65));
          content: "";
        }
        .source {
          display: none;
          margin-bottom: 7px;
          color: rgba(255, 253, 244, 0.63);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(13px, calc(var(--translation-size) * 0.43), 25px);
          font-weight: 400;
          letter-spacing: 0.01em;
          line-height: 1.38;
          text-shadow: 0 1px 2px #000;
        }
        .source.visible { display: block; }
        .translation {
          color: #fffdf4;
          font-family: "Noto Serif SC", "Songti SC", "SimSun", serif;
          font-size: var(--translation-size);
          font-weight: 700;
          letter-spacing: 0.03em;
          line-height: 1.38;
          text-wrap: balance;
          text-shadow:
            0 2px 2px rgba(0, 0, 0, 0.96),
            0 0 14px rgba(0, 0, 0, 0.48);
          white-space: pre-wrap;
        }
        .translation.pending {
          color: rgba(255, 249, 225, 0.65);
          font-size: calc(var(--translation-size) * 0.72);
          font-weight: 500;
          letter-spacing: 0.08em;
        }
        .translation.failed {
          color: rgba(255, 186, 162, 0.9);
        }
        .translation:empty,
        .source:empty { display: none; }
        .drag-handle {
          position: absolute;
          top: -9px;
          left: 50%;
          width: 68px;
          height: 18px;
          padding: 0;
          transform: translateX(-50%);
          border: 0;
          background: transparent;
          pointer-events: auto;
          cursor: grab;
          opacity: 0;
          transition: opacity 160ms ease;
        }
        .drag-handle::before {
          display: block;
          width: 42px;
          height: 4px;
          margin: 5px auto 0;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.64);
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
          content: "";
        }
        .stage:hover .drag-handle,
        .stage:focus-within .drag-handle { opacity: 1; }
        .drag-handle:active { cursor: grabbing; }
        .toolbar {
          position: absolute;
          top: -35px;
          right: 0;
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px 6px;
          border: 1px solid rgba(255, 249, 225, 0.13);
          border-radius: 7px;
          background: rgba(12, 17, 15, 0.84);
          box-shadow: 0 7px 22px rgba(0, 0, 0, 0.28);
          opacity: 0;
          pointer-events: auto;
          transform: translateY(4px);
          transition: opacity 150ms ease, transform 150ms ease;
          backdrop-filter: blur(9px);
        }
        .stage:hover .toolbar,
        .stage:focus-within .toolbar {
          opacity: 1;
          transform: translateY(0);
        }
        .toolbar button {
          min-width: 28px;
          height: 25px;
          padding: 0 7px;
          border: 0;
          border-radius: 4px;
          background: transparent;
          color: rgba(255, 253, 244, 0.8);
          font: 11px/25px "Microsoft YaHei UI", sans-serif;
          cursor: pointer;
        }
        .toolbar button:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fffdf4;
        }
        .live-chip {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 0 6px;
          color: rgba(255, 253, 244, 0.72);
          font: 700 9px/25px Bahnschrift, sans-serif;
          letter-spacing: 0.1em;
        }
        .live-chip::before {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #d85236;
          box-shadow: 0 0 0 3px rgba(216, 82, 54, 0.14);
          content: "";
        }
        .stage.ended .live-chip::before { background: #7f877f; box-shadow: none; }
        .status-text {
          min-width: 38px;
          padding-right: 4px;
          color: #e8b84b;
          font: 10px/25px "Microsoft YaHei UI", sans-serif;
          text-align: center;
        }
        .divider {
          width: 1px;
          height: 13px;
          margin: 0 2px;
          background: rgba(255, 255, 255, 0.13);
        }
        .translation-error {
          display: none;
          margin-top: 6px;
          color: #ffd0c8;
          font: 10px/1.4 "Microsoft YaHei UI", sans-serif;
        }
        .translation-error.visible { display: block; }
        @media (max-width: 720px) {
          .stage { width: 92vw; bottom: 5vh; }
          .caption-shell { padding: 13px 15px 12px; }
          .toolbar { right: 50%; transform: translate(50%, 4px); }
          .stage:hover .toolbar,
          .stage:focus-within .toolbar { transform: translate(50%, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { transition-duration: 0.01ms !important; }
        }
      </style>
      <section class="stage" aria-live="polite" hidden>
        <button class="drag-handle" type="button" aria-label="拖动字幕位置"></button>
        <div class="toolbar" role="toolbar" aria-label="字幕控制">
          <span class="live-chip">声幕</span>
          <span class="status-text"></span>
          <span class="divider"></span>
          <button type="button" data-action="mode" title="切换字幕显示模式">双语</button>
          <button type="button" data-action="smaller" title="缩小字幕">A−</button>
          <button type="button" data-action="larger" title="放大字幕">A＋</button>
          <button type="button" data-action="monitor" title="打开字幕与历史窗口">记录</button>
          <button type="button" data-action="close" title="隐藏页面浮层">×</button>
        </div>
        <div class="caption-shell">
          <div class="source"></div>
          <div class="translation" role="status"></div>
          <div class="translation-error"></div>
        </div>
      </section>
    `;
    stage = shadow.querySelector(".stage");
    sourceElement = shadow.querySelector(".source");
    translationElement = shadow.querySelector(".translation");
    statusElement = shadow.querySelector(".status-text");
    modeButton = shadow.querySelector('[data-action="mode"]');
    mount();
    bindEvents();
  }

  function mount() {
    if (!host) return;
    const fullscreenElement = document.fullscreenElement;
    const target =
      fullscreenElement && fullscreenElement.tagName !== "VIDEO"
        ? fullscreenElement
        : document.documentElement;
    if (host.parentNode !== target) target.appendChild(host);
  }

  function bindEvents() {
    shadow.querySelector(".drag-handle").addEventListener("pointerdown", (event) => {
      const rect = stage.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      stage.classList.add("dragged");
      event.preventDefault();
    });
    shadow.querySelector(".drag-handle").addEventListener("pointermove", (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const rect = stage.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(window.innerWidth - rect.width - 8, event.clientX - dragState.offsetX)
      );
      const top = Math.max(
        8,
        Math.min(window.innerHeight - rect.height - 8, event.clientY - dragState.offsetY)
      );
      stage.style.left = `${left}px`;
      stage.style.top = `${top}px`;
      stage.style.bottom = "auto";
    });
    const endDrag = (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const rect = stage.getBoundingClientRect();
      const widthRange = Math.max(1, window.innerWidth - rect.width);
      const heightRange = Math.max(1, window.innerHeight - rect.height);
      positionStore[siteKey()] = {
        x: rect.left / widthRange,
        y: rect.top / heightRange
      };
      void chrome.storage.local.set({ [POSITION_KEY]: positionStore });
      dragState = null;
    };
    shadow.querySelector(".drag-handle").addEventListener("pointerup", endDrag);
    shadow.querySelector(".drag-handle").addEventListener("pointercancel", endDrag);

    shadow.querySelector(".toolbar").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "mode") {
        const next = MODES[(MODES.indexOf(settings.displayMode) + 1) % MODES.length];
        void saveSettings({ displayMode: next });
      } else if (action === "smaller" || action === "larger") {
        const delta = action === "smaller" ? -2 : 2;
        void saveSettings({
          fontSize: Math.max(20, Math.min(64, settings.fontSize + delta))
        });
      } else if (action === "monitor") {
        void chrome.runtime.sendMessage({
          target: "background",
          type: "open-monitor"
        });
      } else if (action === "close") {
        void chrome.runtime.sendMessage({
          target: "background",
          type: "hide-overlay"
        });
      }
    });

    window.addEventListener("resize", applyStoredPosition);
    document.addEventListener("fullscreenchange", () => {
      mount();
      applyStoredPosition();
    });
  }

  async function saveSettings(patch) {
    settings = { ...settings, ...patch };
    render();
    try {
      const response = await chrome.runtime.sendMessage({
        target: "background",
        type: "save-settings",
        settings: patch
      });
      if (response?.settings) {
        settings = { ...settings, ...response.settings };
        render();
      }
    } catch {
      // The extension may have been reloaded; keep the local visual update.
    }
  }

  async function loadPosition() {
    try {
      const values = await chrome.storage.local.get(POSITION_KEY);
      positionStore = values[POSITION_KEY] || {};
      applyStoredPosition();
    } catch {
      // Position persistence is optional.
    }
  }

  function applyStoredPosition() {
    if (!stage) return;
    const position = positionStore[siteKey()];
    if (!position) return;
    const rect = stage.getBoundingClientRect();
    const widthRange = Math.max(1, window.innerWidth - rect.width);
    const heightRange = Math.max(1, window.innerHeight - rect.height);
    stage.classList.add("dragged");
    stage.style.left = `${Math.round(Math.max(0, Math.min(1, position.x)) * widthRange)}px`;
    stage.style.top = `${Math.round(Math.max(0, Math.min(1, position.y)) * heightRange)}px`;
    stage.style.bottom = "auto";
  }

  function applyVisualSettings() {
    if (!stage) return;
    stage.style.setProperty("--translation-size", `${settings.fontSize}px`);
    stage.style.setProperty("--overlay-opacity", String(settings.opacity));
    modeButton.textContent = currentModeLabel();
    const sourceVisible =
      settings.displayMode === "bilingual" || settings.displayMode === "english";
    sourceElement.classList.toggle("visible", sourceVisible);
    if (settings.displayMode === "chinese") sourceElement.classList.remove("visible");
  }

  function latestCaption() {
    const current = runtimeState?.current || {};
    const displayCaption = current.displayCaption;
    if (displayCaption) {
      return {
        source: clean(displayCaption.source),
        translation: clean(displayCaption.translation),
        error: clean(displayCaption.error),
        pending: Boolean(displayCaption.pending),
        failed: Boolean(displayCaption.failed)
      };
    }
    const lines = Array.isArray(current.lines) ? current.lines : [];
    const line = [...lines].reverse().find((item) => item?.source || item?.translation);
    const bufferSource = clean(current.bufferSource);
    const bufferTranslation = clean(current.bufferTranslation);
    const source = bufferSource || clean(line?.source);
    const translation = bufferSource
      ? bufferTranslation
      : clean(line?.translation);
    const failed = Boolean(
      line?.translationFailed && !bufferSource && !translation
    );
    return {
      source,
      translation,
      error: clean(current.translationError),
      pending: Boolean(source && !translation && !failed),
      failed
    };
  }

  function render() {
    if (!stage) return;
    applyVisualSettings();
    const active = Boolean(runtimeState?.active);
    const caption = latestCaption();
    stage.classList.toggle("ended", !active);
    statusElement.textContent = statusLabel();

    if (!active && !caption.source && !caption.translation) {
      stage.hidden = true;
      return;
    }
    if (settings.overlayEnabled === false) {
      stage.hidden = true;
      return;
    }
    stage.hidden = false;
    clearTimeout(idleTimer);
    stage.style.opacity = "1";

    if (settings.displayMode === "english") {
      translationElement.textContent = caption.source;
      translationElement.classList.remove("pending", "failed");
      sourceElement.textContent = "";
    } else if (settings.displayMode === "chinese") {
      sourceElement.textContent = "";
      translationElement.textContent = caption.translation;
      translationElement.classList.toggle(
        "pending",
        !caption.translation && !caption.failed
      );
      translationElement.classList.toggle("failed", Boolean(caption.failed));
    } else {
      sourceElement.textContent = caption.source;
      translationElement.textContent = caption.translation;
      translationElement.classList.toggle(
        "pending",
        !caption.translation && !caption.failed
      );
      translationElement.classList.toggle("failed", Boolean(caption.failed));
    }

    const errorElement = shadow.querySelector(".translation-error");
    errorElement.textContent = caption.error;
    errorElement.classList.toggle("visible", Boolean(caption.error));

    if (!active) {
      idleTimer = setTimeout(() => {
        if (stage) stage.style.opacity = "0.35";
      }, 3500);
    }
  }

  function applyMessage(message) {
    if (message.settings) {
      settings = { ...settings, ...message.settings };
    }
    if (message.state) {
      runtimeState = message.state;
    }
    if (message.type === "caption-state" && message.payload) {
      runtimeState = {
        ...(runtimeState || {}),
        ...message.payload
      };
    }
    render();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== "content") return false;
    if (message.type === "init" || message.type === "caption-state") {
      applyMessage(message);
    } else if (message.type === "settings-changed") {
      applyMessage(message);
    } else if (message.type === "hide-overlay") {
      stage.hidden = true;
    } else if (message.type === "session-state") {
      applyMessage(message);
    }
    sendResponse({ ok: true });
    return false;
  });

  async function refresh() {
    if (!host) buildOverlay();
    try {
      const response = await chrome.runtime.sendMessage({
        target: "background",
        type: "content-ready"
      });
      if (response?.ok) {
        if (response.settings) settings = { ...settings, ...response.settings };
        if (response.state) runtimeState = response.state;
        render();
      }
    } catch {
      // The background may be waking up; its normal broadcast will follow.
    }
  }

  globalThis.__shengmuCaptionOverlay = {
    refresh,
    get state() {
      return runtimeState;
    },
    get settings() {
      return settings;
    }
  };

  buildOverlay();
  void loadPosition();
  void refresh();
})();
