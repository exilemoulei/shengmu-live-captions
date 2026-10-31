---
id: "tabcapture-97fd44"
title: "扩展页面以标签页形式成为活动标签时，点「开始」报 tabCapture 无法采集"
status: "active"
severity: "medium"
created: "2026-10-31T15:25:34+08:00"
last_seen: "2026-10-31T15:25:34+08:00"
last_verified: "2026-10-31T15:25:34+08:00"
hits: 0
verifications: 1
probe_kind: "manual"
signature_check: "matched"
reverify: "手工复验：打开一个 `chrome-extension://<id>/popup.html` 标签并保持前台 → Ctrl+Shift+Y 打开弹窗 → 点「开始」，应复现该报错；关掉该标签、把视频页切前台后重试，应正常开始采集。"
tags:
  - "tabcapture"
  - "cdp"
  - "helium"
  - "extension"
signatures:
  - "Extension has not been invoked for the current page"
  - "Error starting tab capture"
  - "不支持标签页音频采集"
---
## 现象
点 popup 的「开始实时翻译」后没有浮层，popup 显示「Error starting tab capture」或扩展自己的「此页面不支持标签页音频采集，请打开直播或视频网页」；runtimeState 仍是 inactive/idle。用 CDP 从扩展页面直接调 chrome.tabCapture.getMediaStreamId 时报 `Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.`

## 根因
popup 里 `chrome.tabs.query({active:true, currentWindow:true})` 取的是被打开弹窗那一刻的活动标签。若活动标签本身是 `chrome-extension://<id>/popup.html`（自动化时常把 popup 当标签页打开）或 `chrome://` 页面，tabCapture 既没有 activeTab 授权也不能采集 Chrome 页面，于是直接失败。自动化脚本遗留的扩展页标签会让真实用户下一次点「开始」必然踩到。

## 绕法
1) 关掉所有 `chrome-extension://<id>/...` 与 `chrome://` 标签；2) 把直播/视频页切到前台并确认 `document.visibilityState === "visible"`；3) 用工具栏图标或 Ctrl+Shift+Y 打开真实弹窗再点开始（真实弹窗的 activeTab 就是视频页）；4) 自动化收尾必须关掉自己开的扩展页标签，或改用 Ctrl+Shift+Y 路径。注意 activeTab 授权在标签导航或关闭后失效。
