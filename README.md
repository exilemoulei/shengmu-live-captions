# 声幕 - 实时字幕翻译

捕获 Chrome 标签页的英文音频，通过本地 Whisper ASR 实时识别，并翻译成中文字幕。所有处理在本机完成，无需上传音频到云端。

## 功能特性

- **实时双语字幕**：英文语音识别 + 中文翻译，支持中英双语、仅中文、仅英文三种显示模式
- **页面浮层**：字幕显示在视频页面上方，支持拖动、字号与背景透明度调整、宽度随句长自适应、暂停保留
- **历史回看**：滚轮向上滚动可回看近期字幕，收起后自动恢复实时模式
- **字幕历史窗口**：完整记录所有字幕，支持搜索、续看、SRT 导出
- **多种翻译引擎**：支持 DeepSeek API、OpenAI API、本地 Index-Translate 模型
- **自动重连**：WebSocket 断线自动重连，时间码持续累加
- **智能降噪**：自动过滤静音碎片和噪声，避免无意义字幕
- **一键启动**：控制面板可直接启动/停止本地 ASR 和翻译服务

## 快速启动

### 环境要求

- Windows 11
- Chrome 浏览器
- NVIDIA GPU（用于本地模型推理）
- Node.js（用于启动脚本）

### 启动步骤

1. 启动本地服务（WhisperLiveKit + 翻译服务）：

```powershell
.\scripts\Start-Services.ps1
```

如果只想用 DeepSeek API 翻译，不加载本地翻译模型（节省显存）：

```powershell
.\scripts\Start-Services.ps1 -AsrOnly
```

2. 启动开发浏览器（加载扩展）：

```powershell
.\scripts\Start-DevBrowser.ps1 -Url 'https://www.youtube.com/'
```

3. 在目标页面按 `Ctrl+Shift+Y` 打开控制面板，点击"开始实时翻译"

4. 按 `Ctrl+Shift+U` 打开字幕与历史窗口

### 使用 API 翻译

默认使用 DeepSeek API。在控制面板的"翻译引擎"中填入 API Key 即可。Key 只保存在本机，不会同步或发送给网页。

使用 API 时推荐只启动 ASR：

```powershell
.\scripts\Start-Services.ps1 -AsrOnly
```

### 本地翻译模型

如果不想使用 API，可以使用本地 Index-Translate 模型：

- **9B Q4_K_M**：质量最好，约 5.4 GiB
- **2B IQ4_XS**：省显存，约 1.15 GiB

启动控制服务后，可在控制面板一键启动/停止模型：

```powershell
.\scripts\Start-LocalService.ps1
```

## 安装到日常 Chrome

1. 打开 `chrome://extensions`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择项目目录下的 `extension` 文件夹

更新扩展文件后，在扩展页面点击"重新加载"。

## 使用限制

- 标签页内的所有声音都会被采集，包括广告
- 首次启动需要加载模型，比后续启动慢
- 本地链路延迟通常 1-3 秒，API 翻译还取决于网络
- DRM 保护内容可能无法使用 tabCapture
- 全屏视频时浮层可能不可见，可使用历史窗口查看

## 开发

运行单元测试：

```powershell
npm test
```

检查扩展脚本语法：

```powershell
Get-ChildItem -LiteralPath .\extension -Filter *.js |
    ForEach-Object { node --check $_.FullName }
```

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件
