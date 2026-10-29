---
id: "cdp-input-510a22"
title: "CDP 冒烟在窗口被遮挡时 Input 派发一直不回包；175% 缩放下 setDeviceMetricsOverride 不改变布局"
status: "active"
severity: "medium"
created: "2026-10-29T14:58:43+08:00"
last_seen: "2026-10-29T14:58:43+08:00"
last_verified: "2026-10-29T14:58:43+08:00"
hits: 0
verifications: 1
probe_kind: "manual"
reverify: "1) 检查 scripts/Start-DevBrowser.ps1 是否带 --disable-features=CalculateNativeWinOcclusion（不带即仍可能踩到）。2) 跑脚本前先读 document.visibilityState，hidden 就别指望 Input.dispatchMouseEvent 有回包。3) 缩放类用例改用 Browser.setWindowBounds，不要用 Emulation.setDeviceMetricsOverride（175% 缩放下它返回成功但布局不变）。"
tags:
  - "cdp"
  - "smoke"
  - "display"
anchors:
  - "scripts/Start-DevBrowser.ps1 @ 7c18a96117f9ebfc2b2d5ba247ea885ea58f3d5cc146afa3fcbd71c76287475b"
---
用 CDP 9223 做浮层滚轮/输入冒烟时：

1) 若 Chrome 窗口被其他前台窗口完全遮挡，document.visibilityState 变 hidden，Input.dispatchMouseEvent 会一直不回包（超时），看起来像脚本卡死。启动专用调试 Chrome 要加 --disable-features=CalculateNativeWinOcclusion（scripts/Start-DevBrowser.ps1 本身不带该参数）。
2) 本机显示缩放 175%：Emulation.setDeviceMetricsOverride 返回成功但不改变布局；需要真实改窗口尺寸用 Browser.setWindowBounds。

跑脚本前先断言 visibilityState 为 visible，否则结果不可信。
