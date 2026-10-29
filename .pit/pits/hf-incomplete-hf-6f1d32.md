---
id: "hf-incomplete-hf-6f1d32"
title: "HF 下载在本地代理下卡死（.incomplete 不增长）：需 HF_HUB_DISABLE_XET=1 走普通 HTTP"
status: "active"
severity: "high"
created: "2026-10-29T14:58:33+08:00"
last_seen: "2026-10-29T14:58:33+08:00"
last_verified: "2026-10-29T14:58:33+08:00"
hits: 0
verifications: 1
probe_kind: "manual"
reverify: "1) 观察缓存里 *.incomplete 文件大小是否停止增长（faster-whisper 首次下 medium 曾 600 秒只到 439MB 并卡在 402MB）。2) 带 HF_HUB_DISABLE_XET=1 重跑同一模型：普通 HTTP 可续传、明显更快（1.5GB 约 63 秒）。3) 确认 scripts/Start-Services.ps1 启动 WhisperLiveKit 前仍设置该变量；手动跑 whisperlivekit-server 或直接调 huggingface_hub 时也要自己带上。"
tags:
  - "hf"
  - "proxy"
  - "whisper"
anchors:
  - "scripts/Start-Services.ps1 @ 68c6452fc97eb0c8d071b79e5ec996351dbd89368db670d661ebad9440307ad7"
---
本机代理 127.0.0.1:7897 下 Hugging Face 的 Xet 传输会卡死：faster-whisper 首次下载 medium 模型时，600 秒只下到 439 MB 且不再增长（缓存 .incomplete 停在 402 MB）。

设 HF_HUB_DISABLE_XET=1 改走普通 HTTP 后，同一模型 1.5 GB 在 63 秒内下完（支持续传）。

scripts/Start-Services.ps1 启动 WhisperLiveKit 前已设该变量；手动起 whisperlivekit-server 或直接调 huggingface_hub 时也要带上。

判据：HF 下载停住不动（尤其 .incomplete 不再增长）先设这个变量重试，而不是提高超时。
