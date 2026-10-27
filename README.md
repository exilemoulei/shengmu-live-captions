# 声幕 - 实时字幕翻译

捕获当前 Chrome 标签页的英文音频，使用本地 faster-whisper 实时识别，并通过 Index-Translate-9B 翻译成中文。字幕显示在视频页面浮层中，完整记录保存在扩展本地 IndexedDB 中。

## 已实现

- 仅采集当前标签页，不采集其他标签页或系统全局音频。
- 英文 ASR + 中文翻译，支持双语、仅中文、仅英文三种显示模式。
- 页面浮层支持拖动、字号调整、显示开关和暂停后保留。
- 字幕与历史窗口支持场次列表、搜索、续看、复制文本和 SRT 导出。
- WebSocket 断线自动重连，重连后的时间码继续累加，不会回到 `00:00`。
- 页面刷新后自动重新注入浮层；标签页跳转后继续采集并同步标题、URL。
- 标签页关闭时只执行一次收尾，保留结束原因并保存最终字幕。
- 历史字幕写入串行化，失败批次会保留并自动重试，避免旧写入覆盖新译文。
- 停止时检查缺译字幕；正常停止但存在缺译时标记为 `incomplete`，不再静默当作完整结果。
- 所有识别、翻译和历史数据都在本机处理。

## 快速启动

本地模型、虚拟环境和 Chrome 需要已经安装；当前工作区的 `.research` 已包含这些依赖。

```powershell
Set-Location -LiteralPath '<项目目录>'
.\scripts\Start-Services.ps1
.\scripts\Start-DevBrowser.ps1 -Url 'https://www.youtube.com/'
```

`Start-DevBrowser.ps1` 使用项目专用 Chrome 配置目录 `chrome-profile`，与日常 Chrome 配置隔离。首次启动可自行登录需要账号的站点。

在目标视频页按 `Ctrl+Shift+Y` 打开声幕控制面板，点击“开始实时翻译”。按 `Ctrl+Shift+U` 打开字幕与历史窗口。

默认使用实时分段翻译，以优先满足 2-3 秒字幕延迟。若更在意减少译文回退闪烁，可以改用整句完成后再翻译的模式，但中文会明显更晚出现：

```powershell
.\scripts\Start-Services.ps1 -TranslateOnComplete
```

停止服务：

```powershell
.\scripts\Stop-Services.ps1
```

## 安装到日常 Chrome

如果不想使用项目专用 Chrome：

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目目录下的 `extension` 文件夹。

更新扩展文件后，在 `chrome://extensions` 中点击声幕卡片上的“重新加载”。

## 使用限制

- 标签页内已经混合的声音无法单独排除，例如视频中播放的广告会一并转写和翻译。
- DRM 受保护内容是否允许 `tabCapture` 取决于浏览器和站点。
- 首次启动需要加载 Whisper 和翻译模型，通常明显慢于后续启动。
- 字幕延迟主要来自语音停顿、ASR、翻译和网络服务；当前实测本地链路通常为 1-3 秒。
- 原生 `<video>` 元素自身进入全屏时，网页浮层可能不可见；可改用“声幕 - 字幕与历史”窗口查看。
- `deliveredRatio` 表示捕获到的音频时长与墙钟时长之比，用于判断采集是否持续，不等于 WebSocket 到 ASR 的成功投递率。

## 开发验证

```powershell
npm test
```

单元测试覆盖重连时间码、跨 epoch 合并、SRT 时间轴、缺译识别，以及历史写入失败重试、并发写入和旧写入覆盖保护。扩展脚本可用以下命令做语法检查：

```powershell
Get-ChildItem -LiteralPath .\extension -Filter *.js |
    ForEach-Object { node --check $_.FullName }
```

v0.3.2 使用本地 TARGET 音频完成了一次 60 秒 Chrome 端到端验证：21 条历史字幕、最终缺译 0、场次状态 `stopped`、最长字幕 5.12 秒、音频捕获比中位数 `0.99968`；字幕窗口和页面浮层均已实际截图检查。此前的 YouTube 冒烟轮次被广告内容污染，不作为最终内容验收。

服务日志写入 `logs`，Chrome 专用配置写入 `chrome-profile`，研究脚本和测试产物写入 `.research`，均不纳入版本控制。
