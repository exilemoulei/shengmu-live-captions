# 声幕 — 项目指令

## 项目概述

声幕 (Shengmu) 是一个 Chrome MV3 扩展，捕获当前标签页的英文音频，通过本地 WhisperLiveKit 实时识别，再由 DeepSeek API 或本地 Index-Translate-9B 翻译成中文，以浮层字幕和历史记录窗口的形式呈现。所有处理在本机完成。

- **当前版本**：0.4.3（`package.json` 与 `extension/manifest.json` 同步维护）
- **运行环境**：Windows 11，PowerShell 7，Chrome，NVIDIA GPU
- **服务端口**：WhisperLiveKit `8010`、翻译服务 `8013`、Chrome DevTools `9223`

## 架构与模块

### 数据流

```
Chrome tabCapture
    → PCM (AudioWorklet)
    → WebSocket
    → WhisperLiveKit ASR (large-v3-turbo, faster-whisper)
    → 英文文本（实时分段 / 整句完成后翻译）
    → 翻译 API（DeepSeek / OpenAI / 本地 Index-Translate-9B）
    → 中文译文
    → 页面浮层 + 字幕历史窗口 (IndexedDB)
```

### 扩展模块（`extension/`）

按代码量排序，列出职责和关键接口：

| 文件 | 行数 | 职责 |
|------|------|------|
| `service-worker.js` | 1704 | 扩展后台核心：tabCapture 生命周期管理、WebSocket 与 ASR 通信、字幕合并与广播、设置存储、跨 epoch 时间码累加、标签页关闭收尾 |
| `content-overlay.js` | 1217 | 页面浮层 UI：拖动、字号调整、滚轮回看历史（条目快照 + 冻结行）、暂停保留、重新注入防重复 |
| `subtitle.js` | 1020 | 字幕与历史窗口：场次列表、搜索、续看、SRT 导出、增量渲染（追加/滑动/重建） |
| `translation-api.js` | 670 | 翻译 API 客户端：DeepSeek/OpenAI/本地服务端三种 provider、鉴权错误处理、400 重试、用量统计 |
| `offscreen.js` | 592 | offscreen document：维持 WebSocket 长连接（service worker 休眠时不断线） |
| `caption-utils.js` | 482 | 纯函数工具：字幕合并、显示模式选择、设置归一化与迁移、静音碎片行过滤 |
| `popup.js` | 481 | 扩展弹出面板：启动/停止、翻译引擎配置、API Key 管理 |
| `history-db.js` | 181 | IndexedDB 封装：字幕与场次的读写 |
| `history-write-queue.js` | 113 | 历史写入串行化：失败批次保留并自动重试，防止旧写入覆盖新译文 |
| `overlay-history.js` | 94 | 浮层历史回看：增量合并、晚到译文原地刷新、上限裁剪 |
| `pcm-worklet.js` | 37 | AudioWorklet 处理器：将采集到的音频转为 PCM 帧发送 |

### 辅助目录

| 目录 | 说明 |
|------|------|
| `tests/` | 6 个 Node.js 内置 test runner 测试文件，覆盖纯函数、队列、渲染、翻译 API |
| `scripts/` | PowerShell 脚本：启动/停止服务、启动开发浏览器、加载扩展 |
| `paseo/` | Paseo 代理会话记录与评审证据 |
| `chrome-profile/` | 专用 Chrome 配置目录（与日常 Chrome 隔离） |
| `.research/` | 研究脚本、测试产物、WhisperLiveKit 源码与虚拟环境 |
| `test-assets/` | 小型测试音频（tabCapture 干扰测试、LocalVocal TTS 测试句） |
| `logs/` | 服务运行日志（WLK stdout/stderr） |

## 开发与启动

### 环境依赖

本地模型、Python 虚拟环境（`.research/wlk-venv`）和 Chrome 需要已安装。翻译服务启动脚本在 `.research/start_translation_server.ps1`，WhisperLiveKit 可执行文件在 `.research/wlk-venv/Scripts/whisperlivekit-server.exe`。

### 日常开发流程

```powershell
# 1. 启动本地服务（WhisperLiveKit + 翻译）
.\scripts\Start-Services.ps1

# 2. 仅做 ASR（不启动翻译模型，节省显存，用 DeepSeek API 翻译）
.\scripts\Start-Services.ps1 -AsrOnly

# 3. 启动开发浏览器（加载扩展，打开目标页面）
.\scripts\Start-DevBrowser.ps1 -Url 'https://www.youtube.com/'

# 4. 运行单元测试
npm test

# 5. 扩展 JS 语法检查
Get-ChildItem -LiteralPath .\extension -Filter *.js |
    ForEach-Object { node --check $_.FullName }

# 6. 停止所有服务
.\scripts\Stop-Services.ps1
```

### 修改扩展代码后

在 `chrome://extensions` 点击声幕卡片上的"重新加载"，或重新启动 `Start-DevBrowser.ps1`。

### 服务启动参数说明

`Start-Services.ps1` 关键参数：

| 参数 | 默认 | 说明 |
|------|------|------|
| `-WlkPort` | 8010 | WhisperLiveKit 端口 |
| `-TranslationPort` | 8013 | 翻译服务端口 |
| `-AsrOnly` | 关 | 只启动 ASR，不加载翻译模型 |
| `-TranslateOnComplete` | 关 | 整句完成后再翻译（减少回退闪烁，但中文更晚出现） |
| `-PauseSegmentationSeconds` | 1.0 | ASR 静音切分阈值 |
| `-Glossary` | 空 | 术语表文件路径 |

## 端到端验证

### 测试音频

验证用 `.research/quality-samples/` 下的三个 Path of Exile 视频音频：

| 视频 ID | 内容 | 完整文件 | 2 分钟切片 |
|---------|------|----------|------------|
| `Gq2r7x5qgmg` | PoE 发布会 | `Gq2r7x5qgmg-full.webm` (47 MB) | `Gq2r7x5qgmg-poe-24m00-26m00.wav` |
| `vkCu3V81N74` | PoE 实机演示 | `vkCu3V81N74-full.webm` (80 MB) | `vkCu3V81N74-poe-05m15-07m15.wav` |
| `WIuIdulr-K0` | PoE Boss 战 | `WIuIdulr-K0-full.webm` (46 MB) | `WIuIdulr-K0-poe-30m45-32m45.wav` |

每个视频还有对应的 `*-silence.txt`（ffmpeg silencedetect 输出，标记静默段）和 `.en.vtt` 参考字幕。

**选用规则**：
- **快速冒烟/单元测试**：用 2 分钟 wav 切片（`*-poe-*.wav`，各 3.8 MB），适合验证 ASR→翻译→浮层的完整链路
- **长时稳定性/完整评估**：用完整 webm 文件，需要更长时间和更多 GPU 显存
- 视具体情况选择，没有硬性规定必须用哪个

### 验证流程

1. **单元测试通过**
   ```powershell
   npm test
   ```
   确认 6 个测试文件全部通过，覆盖：重连时间码、跨 epoch 合并、SRT 时间轴、缺译识别、历史写入重试、并发写入保护、增量渲染判定、浮层历史合并/刷新/裁剪、翻译 API 请求构造与错误处理。

2. **启动服务 + 浏览器**
   ```powershell
   .\scripts\Start-Services.ps1          # 或 -AsrOnly + DeepSeek API
   .\scripts\Start-DevBrowser.ps1 -Url '<目标视频页面>'
   ```

3. **播放测试音频，开始采集**
   - 在目标页按 `Ctrl+Shift+Y` 打开控制面板，点击"开始实时翻译"
   - 按 `Ctrl+Shift+U` 打开字幕与历史窗口

4. **验证指标**（参考 v0.4.0 基准）
   - 缺译数：0
   - 捕获比中位数：≥ 0.999
   - 字幕延迟：本地链路 1-3 秒
   - GPU 峰值显存：关注是否超出预期

5. **截图留证**
   - 浮层截图（overlay）
   - 历史窗口截图
   - 存入 `paseo/evidence/` 或 `.research/`

### CDP 自动化冒烟

无服务的 UI 冒烟用 `.research/ui-smoke-*.py` 系列脚本，通过 CDP 9223 端口向内容脚本注入伪造 `caption-state` 事件来验证浮层行为。运行前确认：
- 专用 Chrome 启动时加了 `--disable-features=CalculateNativeWinOcclusion`
- 页面 `visibilityState` 为 `visible`

## 常见陷阱与注意事项

### CDP / 自动化

- **窗口遮挡导致 CDP 卡死**：Chrome 窗口被其他前台窗口完全遮挡时，`document.visibilityState` 变成 `hidden`，`Input.dispatchMouseEvent` 会一直不回包（超时）。`Start-DevBrowser.ps1` 本身不带 `--disable-features=CalculateNativeWinOcclusion`，跑 CDP 冒烟脚本时需要手动加。
- **缩放不生效**：本机显示缩放 175%，`Emulation.setDeviceMetricsOverride` 返回成功但不改变布局。需要真实改窗口尺寸时用 `Browser.setWindowBounds`。

### 测试与验证

- **YouTube 冒烟会被广告污染**：YouTube 视频中可能插入广告，广告内容会被一并转写和翻译，不适合作为最终内容验收。v0.3.2 后改用本地 TARGET 音频做最终验证。
- **ASR 偶尔长句**：ASR 有时把很长一段语音切成一句（实测某 2 分钟 PoE 切片被切成 1 句、时长 120.06 秒）。0.4.3 起浮层正文限行：译文 3 行、原文 2 行、上一句 2 行，超出部分顶部裁切 + 渐隐（尾部对齐）；`.caption-shell` 另有 `max-height: min(70vh, 680px)` 兜底，空间不够时优先压缩上一句/原文。浮层历史面板每行限高（译文 2 行 + 省略号、原文单行）。完整文本保留在历史窗口。改动点：`content-overlay.js` 的 `setCaptionText` / `markCaptionOverflow` / `keepStageInViewport`，DOM 里每个字幕 slot 多了一层 `.caption-text`。
- **静音碎片行**：静音/噪声下 ASR 会吐出「7.8.」这类无字母碎片，`caption-utils.js` 的 `isNoiseTranscript(text, duration)` 在 `normalizeCaptionLines` 里统一丢弃：纯标点/符号（`...`、`♪`）无条件丢；小数/时间码形态（`7.8.`、`00:12`）仅当该行时长 ≤ 1.5 秒时丢，否则视为真实口播保留；普通整数（`42`、`2024`）一律保留；时间码缺失/无效（算不出时长）也保留，不把「未知时长」当成「很短」。buffer 没有时长，因此只丢纯符号 buffer。
- **`deliveredRatio` 含义**：捕获到的音频时长与墙钟时长之比，用于判断采集是否持续，不等于 WebSocket 到 ASR 的成功投递率。

### 服务与显存

- **首次启动慢**：Whisper 和翻译模型加载需要时间，明显慢于后续启动。
- **显存管理**：`-AsrOnly` 模式不加载翻译模型，节省显存，适合配合 DeepSeek API 使用。翻译模型（Index-Translate-9B）占用显著显存。
- **端口占用**：`Stop-Services.ps1` 只停止本项目的进程（匹配命令行中的端口和路径），不会误停其他程序。如果端口仍被占用会输出警告。

### 扩展行为

- **浮层滚轮回看**：进入历史回看后，面板锁定当时的行集合与顺序（条目快照），新到达的字幕不会插入。收起后回到实时，最新字幕照常进入。
- **标签页跳转**：跳转后继续采集并同步标题、URL，但需要确认 tabCapture 是否成功迁移。
- **标签页关闭**：只执行一次收尾，保留结束原因并保存最终字幕。
- **页面刷新**：自动重新注入浮层。

### 关键文件位置

| 用途 | 路径 |
|------|------|
| 扩展源码 | `extension/` |
| 单元测试 | `tests/*.test.js` |
| 启动脚本 | `scripts/Start-Services.ps1` |
| 开发浏览器 | `scripts/Start-DevBrowser.ps1` |
| 研究脚本 | `.research/*.py` |
| CDP 冒烟 | `.research/ui-smoke-*.py` |
| 测试音频（PoE） | `.research/quality-samples/*poe*.wav` / `*-full.webm` |
| 测试音频（小型） | `test-assets/` |
| 评审证据 | `paseo/evidence/` |
| 服务日志 | `logs/` |
| Chrome 配置 | `chrome-profile/` |
