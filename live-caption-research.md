# 实时直播字幕方案调研

调研日期：2026-10-21
目标：观看 Twitch / YouTube 英文直播，在本机显示实时中文字幕。字幕位于独立窗口，可滚动查看历史；优先只采集当前浏览器标签页音频。

## 结论

1. **最快可用的成品：Live Captions Chrome 扩展。** 当前标签页音频、独立弹窗、可滚动转录、下载历史、原文与译文并排、英语转简体中文都已具备。主要问题是翻译按额度付费，约 0.70-1.00 美元/小时。
2. **长期零订阅费用的首选：WhisperLiveKit。** 已有标签页音频采集、本地 Whisper、NLLB 中英翻译、滚动转录和双语显示。需要少量适配独立窗口体验、历史滚动行为和模型选择。
3. **更接近 Windows 原生体验的候选：fmadore/Live-translation。** 有始终置顶覆盖层、完整转录、历史、搜索、导出，支持按应用及其子进程采集音频。但它只能隔离到浏览器进程，不能严格隔离到某个标签页；本地 Whisper 只翻译成英语，中文翻译需要 Gemini 或 OpenAI API。
4. **不建议作为首选：** Windows 11 自带实时字幕、SakiRinn、Whisperr 桌面版都主要采系统音频；Tablingo、Friskription、xu-0306/live-subtitle 主要提供页面覆盖字幕，不是独立历史窗口。
5. **无法通过软件解决的部分：** 标签页采集只能排除本机其他应用、麦克风和语音聊天。主播已经混进直播流里的游戏声、联机语音和背景音乐，无法再按来源分离，只能依靠 VAD、降噪或人声模型减轻影响。

## 需求匹配

| 方案 | 类型 | 音源隔离 | 独立窗口与历史 | 英语转中文 | 费用 | 判断 |
|---|---|---|---|---|---|---|
| Live Captions 扩展 | 商业 Chrome 扩展 | 当前标签页，严格 | 独立弹窗；滚动转录、下载、最新位置按钮 | 支持，190 种目标语言 | 翻译 5 小时 5 美元、10 小时 8 美元、20 小时 14 美元 | **首选实机验证** |
| Tellus AI | 商业 Chrome 扩展 | 当前标签页 | History-Chat 可调整大小、可滚动；另有页面字幕 | 支持，50+ 语言 | 7 小时 19 美元、14 小时 34 美元、25 小时 60 美元 | 功能匹配但价格偏高 |
| Friskription | 商业 Chrome 扩展 | 当前标签页 | 页面覆盖；历史可导出，不是独立转录窗口 | 支持 | 每周免费 30 分钟；600 分钟 5.99 美元/月；1500 分钟 12.99 美元/月；可自带 API Key | 预算型备选 |
| fmadore/Live-translation | 开源 Windows 应用，MIT | 应用进程树或系统音频，不能严格到标签页 | 始终置顶覆盖层；完整转录标签页、搜索、历史和导出 | 云端 Gemini/OpenAI 支持中文；本地 Whisper 仅译成英语 | 软件免费，自备 API Key | **原生体验最佳，适合作为二次开发底座** |
| WhisperLiveKit | 开源自托管，Apache-2.0 | Chrome 扩展使用当前标签页 | Web 页面转录，可滚动、双语；需包装成独立窗口 | 本地 NLLB 支持简体中文 | 免费 | **免费路线首选** |
| xu-0306/live-subtitle | 开源 Windows 应用 + Chrome 扩展 | 当前标签页 | 页面覆盖；历史能力可配置 | 本地 llama.cpp 或兼容 API | 免费 | 部署比原版 WLK 简单，但窗口形态不符 |
| begin0808/LiveCaption | 开源本地系统，MIT | 当前标签页 | 悬浮字幕，仅保留 0-2 行历史 | SenseVoice + Ollama/DeepSeek/Google 翻译 | 免费或 API 费 | 延迟低，但不是完整转录窗口 |
| SakiRinn/LiveCaptions-Translator | 开源 Windows 应用 | 系统音频 | 独立覆盖层 | 多翻译引擎 | 免费或 API 费 | 成熟，但不符合标签页隔离 |
| Windows 11 实时字幕 | 系统内置 | 默认系统输出 | 原生独立窗口、体验基线 | 普通 PC 不支持翻译；Copilot+ PC 支持中英翻译 | 免费 | 仅作为交互参考 |
| Tablingo | 商业 Chrome 扩展 | HTML5 视频页面 | 页面双语悬浮字幕 | 支持 75 种语言 | 每月免费 10 分钟；9.99 美元/月或 79 美元/年 | 有字幕无独立历史窗口 |
| Whisperr | 商业桌面/扩展 | 桌面版主要用系统音频 | 桌面版可始终置顶 | 100+ 语言 | 免费试用，具体套餐不透明 | 音源和价格均需实测，暂不优先 |

## 第一梯队方案

### 1. Live Captions 扩展

来源：<https://chromewebstore.google.com/detail/live-captions/ckpgjpenbhnkhcalechemlifbcinneen>

优点：

- 直接使用 `tabCapture` 采集当前标签页，和需求最接近。
- 可显示在页面、侧边栏或独立窗口；独立窗口约 375 x 683。
- 窗口内是持续转录，可滚动历史、跳回最新、下载 transcript。
- 支持原文和译文并排、聊天式、字幕式、仅译文四种布局。
- 支持英语到简体中文；免费标准字幕不需要账号，但翻译始终使用付费 Enhanced 服务。
- 额度包不要求订阅，轻度观看成本可控。

缺点：

- 翻译约 0.70-1.00 美元/小时；每天看 2 小时、每月 20 天约需 28 美元。
- 独立窗口是普通 Chrome popup，不是系统级始终置顶；单屏全屏观看时可能被遮挡，建议副屏或 PowerToys Always on Top。
- 依赖云端识别和翻译，录音与字幕文本会发往服务商。
- 扩展声明了广泛站点权限，建议将站点访问限制为 Twitch、YouTube 和必要的直播站点。
- Chrome Web Store 当前约 2 万用户、评分样本少且约 3.4/5，不能只依据商店评分判断质量。
- 不支持 Brave/Opera 的免费字幕路径；优先使用 Chrome 或 Edge。

适配判断：**不需要改代码，先实机试 10 分钟免费翻译额度。** 如果翻译窗口、延迟和全屏行为都能接受，直接使用最省事。

### 2. Tellus AI

来源：<https://chromewebstore.google.com/detail/live-translation-real-tim/aefebdiljiacpomdendfdnapkmjmfkji>

优点：

- 当前标签页音频采集。
- 有正常视频覆盖字幕和可调整大小、可滚动的 History-Chat 转录视图。
- 官方描述约 2.5 秒字幕延迟，符合目标。
- 50+ 语言，支持中英翻译。

缺点：

- 价格明显偏高：19 美元/7 小时、34 美元/14 小时、60 美元/25 小时。
- 免费额度仅每月 5 分钟字幕。
- History-Chat 是否是独立系统窗口仍需安装确认，商店描述只说明它是可调整大小的转录框。

适配判断：不建议先买。可以作为 Live Captions 体验不佳时的付费备选。

### 3. Friskription

来源：<https://friskription.com/pricing>

优点：

- 当前标签页音频，Twitch、YouTube Live 和任意无字幕网页都支持。
- 有说话人标签、历史导出、字幕样式和位置调整。
- 价格是商业方案中最低的：600 分钟 5.99 美元约等于 0.60 美元/小时；1500 分钟 12.99 美元约等于 0.52 美元/小时。
- 每周有 30 分钟免费额度；支持自带 OpenAI、Anthropic 或 ElevenLabs Key。

缺点：

- 主要是页面覆盖字幕，不是类似 Win11 实时字幕的独立转录窗口。
- 自有 Key 模式会增加账号、密钥和供应商配置成本。
- 页面全屏和不同播放器布局可能需要单独适配。

适配判断：如果接受字幕覆盖在视频画面上，这是价格最好的商业方案；不符合当前“独立窗口”要求。

### 4. fmadore/Live-translation

来源：<https://github.com/fmadore/Live-translation>

优点：

- Windows 原生程序，MIT。
- 可按应用及其子进程采集音频，能隔离游戏、麦克风和语音聊天应用。
- 始终置顶、可点击穿透的字幕覆盖层，支持双译文或原文加译文。
- 完整转录不会截断；有搜索、历史、恢复、TXT/Markdown/SRT/WebVTT 导出。
- 转录视图会在用户向上滚动后暂停自动跟随，并提供 Jump to latest。
- 本地 Whisper 转写免费，音频可完全不上传。

缺点：

- 应用级采集会包含该应用的通知，也可能包含同一个浏览器内其他标签页的声音。
- 本地 Whisper 只能翻译成英语，不能本地翻译成中文。
- 中文翻译需使用 Gemini 或 OpenAI，自备 API Key，按供应商价格付费。
- 项目非常新，GitHub 关注度低；界面目前为英语、法语和德语。
- 覆盖层适合阅读当前字幕，完整历史在程序的 Transcript 标签页中，不是 Win11 那种始终独立的转录窗。

适配判断：如果需要 Windows 原生体验，它是最合适的二次开发底座。可增加：严格标签页采集、简体中文界面、本地或低价文本翻译。

## 免费自托管方案

### WhisperLiveKit

来源：<https://github.com/QuentinFuxa/WhisperLiveKit>

已核实能力：

- Chrome 扩展优先调用 `chrome.tabCapture.capture({ audio: true })`，严格采当前标签页。
- 已包含英文识别、NLLB 英译中、原文与译文并排显示、滚动 transcript。
- 服务端保留完整转录数据；前端只把最近 200 行放入 DOM，超过后显示隐藏行提示。
- 当前每次更新都会自动滚到底部，没有“用户上滚后暂停跟随”的逻辑。
- 4070 Super 足以运行 `large-v3`、`large-v3-turbo` 类模型和 NLLB-600M，但 2-3 秒端到端延迟必须实测。

需要适配：

1. 将本地网页用 Chrome `--app` 模式打开，得到无地址栏的独立窗口；或用 Tauri/PySide 做轻量桌面壳。
2. 用 PowerToys Always on Top 补足始终置顶；正式桌面壳可直接调用系统置顶 API。
3. 增加“用户向上滚动时暂停自动跟随”和“回到最新”按钮。
4. 去掉 200 行 DOM 上限，或实现虚拟列表，使两小时直播的历史都能滚动查看。
5. 默认使用 `large-v3-turbo + NLLB-600M`；NLLB 中文质量不够时，增加 DeepSeek 等仅翻译文本的 API。
6. 保存 transcript，避免刷新页面后丢失。

许可注意：WhisperLiveKit 本体是 Apache-2.0；常用 NLLB-600M 权重是 CC-BY-NC-4.0，个人观看没有问题，但不适合封装成商业产品分发。

### xu-0306/live-subtitle

来源：<https://github.com/xu-0306/live-subtitle>

- 已有 Windows x64 预览包和手动加载的 Chrome 扩展。
- 标签页音频、WhisperLiveKit、本地 llama.cpp 翻译、模型管理都已打包。
- 但字幕显示在当前页面，不是独立转录窗口。
- 项目较新、发布包未签名，适合试装，不适合作为唯一长期方案。

### begin0808/LiveCaption

来源：<https://github.com/begin0808/LiveCaption>

- 标签页音频、SenseVoice 本地识别、Ollama/DeepSeek/Google 翻译。
- 有双语悬浮字幕和 0-2 行历史。
- 不是完整转录窗口，且历史容量明显不足。

## 价格对比

以下按 1 小时连续使用计算，价格以调研日公开页面为准。

| 方案 | 价格 | 折算 |
|---|---:|---:|
| Live Captions，5 小时包 | 5 美元 | 1.00 美元/小时 |
| Live Captions，10 小时包 | 8 美元 | 0.80 美元/小时 |
| Live Captions，20 小时包 | 14 美元 | 0.70 美元/小时 |
| Friskription，600 分钟/月 | 5.99 美元 | 0.60 美元/小时 |
| Friskription，1500 分钟/月 | 12.99 美元 | 0.52 美元/小时 |
| Tellus AI，7 小时/月 | 19 美元 | 2.71 美元/小时 |
| Tellus AI，14 小时/月 | 34 美元 | 2.43 美元/小时 |
| Tellus AI，25 小时/月 | 60 美元 | 2.40 美元/小时 |
| 本地 Whisper + NLLB | 0 美元 | 仅电费 |

API 成本参考：

| API | 公开价格 | 折算 |
|---|---:|---:|
| Gemini 3.5 Live Translate | 约 0.0368 美元/分钟 | 约 2.21 美元/小时 |
| OpenAI `gpt-realtime-translate` | 约 0.034 美元/分钟 | 约 2.04 美元/小时 |
| OpenAI 实时转写 | 约 0.017 美元/分钟 | 约 1.02 美元/小时 |
| Deepgram Nova-3 streaming | 约 0.0048-0.0077 美元/分钟 | 约 0.29-0.46 美元/小时 |
| DeepSeek 文本翻译 | 按 token 计 | 只翻字幕时通常远低于语音 API |

如果自行组合“Deepgram 或本地 Whisper 转写 + DeepSeek 文本翻译”，费用可能低于全实时语音翻译 API，但需要额外开发和调延迟。

## 推荐路线

### 路线 A：先用成品，不改代码

1. 安装 Live Captions 扩展，只在 Chrome/Edge 使用。
2. 将扩展站点访问限制在 Twitch 和 YouTube。
3. 打开直播，保持播放器未静音，选择 **Tab audio**。
4. 源语言选 English，目标语言选简体中文。
5. 显示方式选独立 Window，布局选原文与译文 Side by side。
6. 用副屏显示字幕；单屏时用 PowerToys Always on Top。
7. 用免费额度分别测 Twitch 和 YouTube，记录最终字幕延迟、翻译质量、滚动历史和全屏遮挡。

这是当前投入最小、最可能当天可用的方案。

### 路线 B：免费自托管

以 WhisperLiveKit 为基础，只做以下范围明确的改造：

1. 独立窗口与置顶。
2. 上滚暂停跟随、回到最新。
3. 历史保留和导出。
4. 中英双语布局。
5. 模型选择与启动脚本。

不重写识别、VAD、翻译和标签页采集。这样能把工程量控制在界面和打包层。

### 路线 C：Windows 原生体验

以 fmadore/Live-translation 为底座，补严格标签页采集或直接接受浏览器级采集，再接入更便宜的中文文本翻译。它已经解决了始终置顶、历史滚动、搜索、导出和原生音频采集，改造成本可能低于从 WLK 网页封装桌面端。

## 实施前需要接受的边界

- 直播流内已经混合的游戏声、队友语音和背景音乐无法在客户端按来源拆开。
- 任何云端方案都需要上传音频或字幕文本；本地 Whisper 可避免上传音频。
- 翻译成中文时，句末才会出现较稳定的译文；要求低于 1 秒且译文稳定不现实。2-3 秒是合理目标。
- 同一时间最好只让目标浏览器标签页发声，能显著降低误识别。

## 验收清单

| 指标 | 目标 |
|---|---|
| 音源 | 只录当前 Twitch/YouTube 标签页，麦克风和游戏声不进字幕 |
| 最终字幕延迟 | 句末后 2-3 秒内 |
| 中文可读性 | 专有名词、缩写和游戏术语错误可接受，句子主体正确 |
| 双语 | 默认显示英文原文和简体中文译文 |
| 窗口 | 独立窗口，可移动、置顶或放置副屏 |
| 历史 | 向上滚动后不被强制拉到底，可一键回到最新 |
| 稳定性 | 连续观看 1 小时不漏段落、不丢历史 |
| 成本 | 按实际观看小时数计算，可接受 |

## 主要来源

- Live Captions Chrome Web Store: <https://chromewebstore.google.com/detail/live-captions/ckpgjpenbhnkhcalechemlifbcinneen>
- Tellus AI Chrome Web Store: <https://chromewebstore.google.com/detail/live-translation-real-tim/aefebdiljiacpomdendfdnapkmjmfkji>
- Tellus AI: <https://tellusai.app/>
- Friskription: <https://friskription.com/pricing>
- fmadore/Live-translation: <https://github.com/fmadore/Live-translation>
- WhisperLiveKit: <https://github.com/QuentinFuxa/WhisperLiveKit>
- xu-0306/live-subtitle: <https://github.com/xu-0306/live-subtitle>
- begin0808/LiveCaption: <https://github.com/begin0808/LiveCaption>
- SakiRinn/LiveCaptions-Translator: <https://github.com/SakiRinn/LiveCaptions-Translator>
- Microsoft Windows 实时字幕: <https://support.microsoft.com/windows/use-live-captions-to-better-understand-audio-b52da59c-14b8-4031-aeeb-f6a47e6055df>
- Gemini API pricing: <https://ai.google.dev/gemini-api/docs/pricing>
- OpenAI API pricing: <https://platform.openai.com/docs/pricing>
- Deepgram pricing: <https://deepgram.com/pricing>
- DeepSeek pricing: <https://api-docs.deepseek.com/quick_start/pricing>
