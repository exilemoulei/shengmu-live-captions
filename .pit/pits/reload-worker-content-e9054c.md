---
id: "reload-worker-content-e9054c"
title: "浮层在后台已跑但完全不显示、开关像失效：扩展没整体 reload，旧 worker 只注入 content-overlay.js 导致 HISTORY_API undefined"
status: "active"
severity: "high"
created: "2026-10-29T14:58:33+08:00"
last_seen: "2026-10-29T14:58:33+08:00"
last_verified: "2026-10-29T14:58:33+08:00"
hits: 0
verifications: 1
probe_kind: "manual"
reverify: "1) 症状：popup 说后台已跑，页面上浮层不出现，开关来回切也无反应。2) 到 chrome://extensions 确认不是只刷新了页面——必须整体 reload 扩展，并刷新标签页。3) 0.5.1 起看 popup 浮层开关下的 overlayError 提示（worker 会把注入/init 失败写进 runtimeState.overlayError 并广播）。"
tags:
  - "extension"
  - "overlay"
  - "worker"
signatures:
  - "createHistoryLog"
---
根因：扩展没有整体 reload，service worker 还是旧代码（旧注入文件列表只有 content-overlay.js），而磁盘上的 content-overlay.js 是新的、依赖先执行的 overlay-history.js。于是 HISTORY_API.createHistoryLog 抛 Cannot read properties of undefined (reading 'createHistoryLog')，整个 IIFE 中断，浮层永不创建。

症状很像权限问题，极易误判成没授权 / 没捕获到音频。

绕法：chrome://extensions 整体 reload 扩展 + 刷新目标标签页。0.5.1 起 content-overlay.js 在缺少 ShengmuOverlayHistory 时降级为无滚轮回看，worker 会把注入/init 失败写进 runtimeState.overlayError 并广播给 popup——先看这个字段再猜。
