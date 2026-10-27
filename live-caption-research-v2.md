# 实时直播中文字幕调研（观众视角，修订版）

调研日期：2026-10-21
场景：观看 Twitch / YouTube 英文直播，在屏幕上显示实时中文字幕；优先只采集当前浏览器/标签页音频，排除麦克风、语音聊天和游戏声音；独立窗口、可回看历史是目标；英语优先，中英双语为加分项。

## 结论

1. **你的判断成立：这个需求很常见，但没有形成“大家都在用”的观众侧中文字幕成品。**
2. **真正接近主流的是浏览器内置能力，而不是某个付费扩展。**
   Chrome 的 Live Caption / Live Translate 是零安装、零订阅的入口；YouTube 直播则优先使用平台自己的自动字幕。
3. **Twitch 是缺口最大的场景。** Twitch 没有面向观众的通用实时语音识别；没有主播开启字幕时，浏览器和扩展只能自己采集标签页音频再做 ASR。
4. **有用户量的商业扩展只有两类：Felo（约 5 万用户）和 Soniox（约 1 万用户）。** 这只能说明它们“相对知名”，不能说明它们是主流。其他几千到两万用户的付费扩展，不该再作为主方案堆列表。
5. **如果“独立窗口 + 可滚动历史 + 中英双语 + 标签页音频 + 免费”全部都要，当前没有成熟的现成产品。** 最合理的工程底座是 WhisperLiveKit；需要做的是窗口、历史和交互适配，不是重写识别链路。

一句话概括大家实际在用什么：

> YouTube 有字幕就用平台字幕/翻译；Chrome 看无字幕内容就开 Live Caption/Translate；Twitch 没有字幕时，大多数人没有稳定方案，愿意折腾的人才本地跑 Whisper。

## 采用度信号

下表是“有没有人在用”的信号，不是质量排名。Chrome 内置功能没有扩展安装量可比，因此单独标注。

| 方案 | 采用度信号 | 形态 | 费用 | 判断 |
|---|---|---|---|---|
| Chrome Live Caption / Live Translate | Chrome 内置；官方教程和第三方教程播放量最高（约 22.6 万） | 浏览器浮动字幕气泡 | 免费 | 最接近“大家都在用”，但不是完整历史窗 |
| YouTube 直播自动字幕 | 平台内置；仅在创作者开启、频道满足条件时可用 | 播放器字幕 | 免费 | YouTube 首选，不适用于 Twitch |
| Felo Subtitles | Chrome Web Store 约 5 万用户，3.6/5，147 个评分 | 页面字幕、单独 capture 标签页 | 注册赠送约 15 分钟；付费价格不公开 | 扩展里用户量最大，但仍属小众 |
| Soniox | Chrome Web Store 约 1 万用户，4.7/5，但只有 6 个评分 | 页面悬浮字幕、Chrome side panel | 每周免费额度；Pro 19.99 美元/月或 119.99 美元/年 | 技术不错，但不是独立窗口 |
| Live Captions 扩展 | 约 2 万用户，3.4/5，31 个评分 | 页面、side panel、单独窗口 | 翻译按小时付费，5 美元/5 小时起 | 仅作采用度参照，不作为主推荐 |
| WhisperLiveKit | GitHub 约 1.1 万 stars | 本地网页 + Chrome 扩展 | 免费 | 免费本地路线的实际底座 |

补充观察：

- YouTube 上“Chrome 实时字幕”教程约 22.6 万播放，Chrome 官方教程约 12.9 万播放；这说明大量用户首先想到的是浏览器内置功能。
- 中文社区里高播放的内容主要是“YouTube 已有字幕怎么翻译成中文”，而不是“无字幕直播怎么从音频生成字幕”。这类教程依赖平台字幕或字幕文件，不能直接解决 Twitch 无字幕直播。
- Twitch 相关高播放教程大多是 OBS/主播端加字幕，不是观众端方案。社区里也经常把“主播给直播加字幕”和“观众给直播加字幕”混为一谈。

## 方案对比

| 方案 | 音频来源 | 独立窗口/历史 | 英语转中文 | 双字幕 | 费用 | 适配结论 |
|---|---|---|---|---|---|---|
| Chrome Live Caption + Live Translate | Chrome 内播放的音频，通常跟随有声音的标签页 | 可拖动/展开的字幕气泡；没有完整 transcript 历史 | 支持，需在设置中开启 | 不保证 | 免费 | 先实测；适合临时看，不满足完整回看 |
| YouTube 自动字幕 + 平台/字幕扩展 | YouTube 播放器 | 播放器字幕 | 取决于直播是否已有字幕及平台能力 | 取决于工具 | 免费 | 有字幕时最省事；Twitch 不适用 |
| Edge Live Captions | Edge 内音频 | 单独窗口，本地处理 | 官方策略页只描述转写，未给出任意标签页英译中能力 | 不保证 | 免费 | 可作为备选，但功能可用性不稳定 |
| Felo Subtitles | 当前标签页 `tabCapture` | 单独 capture 标签页，可查看/保存 transcript；开成普通 Chrome 标签页，不是系统级悬浮窗 | 支持英译中 | 支持单语/双语 | 免费额度后付费，价格不透明 | 商业 shortcut；先确认窗口和历史体验 |
| Soniox | 当前标签页 `tabCapture` | 页面悬浮字幕 + side panel | 支持 60+ 语言 | 可显示原文/译文 | 免费额度；Pro 19.99 美元/月 | 接受侧边栏再考虑 |
| WhisperLiveKit | 当前标签页 `tabCapture` | 本地网页 transcript，可滚动；需包成独立窗口 | 本地 Whisper + NLLB 支持中文 | 支持原文/译文 | 免费 | 最符合免费和音源要求；需要 UI 适配 |
| Windows 11 实时字幕 | 系统输出音频 | 原生悬浮窗 | 普通 PC 不做英译中；Copilot+ 主要是外语转英文字幕 | 不保证 | 免费 | 音源和翻译都不符合本场景 |
| OBS/主播端字幕插件 | 主播端音频 | 推流画面 | 取决于插件 | 取决于插件 | 不等 | 只能解决主播，不解决观众 |

## 关键方案说明

### 1. Chrome Live Caption / Live Translate

官方帮助：

- <https://support.google.com/chrome/answer/10538231>

已核实：

- 官方页面当前给出 Windows/Mac 的 Live Caption 开关路径。
- 官方页面当前也给出 Windows/Mac 的 Live Translate 开关路径，说明它不是只能在 Chromebook Plus 上使用。
- 音频和字幕识别在本地处理；开启翻译后，字幕文本会发送给 Google 做翻译。
- 字幕显示为可拖动、可展开/收起的气泡，不是完整桌面字幕应用。
- 官方文档没有提供类似 Win11 的完整 transcript、历史滚动、搜索或导出能力。

本机情况：

- 当前 Chrome 版本为 155.0.8059.85。
- 本机 Chrome 配置中 `live_caption_enabled` 和 `live_translate_enabled` 都已经是开启状态，目标语言为 `zh-CN`。
- 这说明至少这台机器已经具备入口；实际 Twitch/YouTube 延迟、翻译质量和气泡行为仍需用真实直播测试。

适配判断：

- **不需要写代码。**
- 如果只是“屏幕上能看懂当前几句”，这是成本最低的方案。
- 如果必须“像 Win11 一样独立窗口并向上滚动查看历史”，它不满足，不能把它包装成最终答案。

### 2. YouTube 自带自动字幕

官方帮助：

- <https://support.google.com/youtube/answer/6373554>

限制：

- 直播自动字幕目前官方标注为 English only。
- 需要频道满足条件并主动开启，且通常要求 normal latency。
- 不是所有直播都有自动字幕，更不是 Twitch 的通用能力。
- 已有字幕的前提下，YouTube 播放器或字幕翻译扩展才有东西可翻译；沉浸式翻译这类工具本身不负责从音频生成字幕。

判断：

- 如果目标直播刚好有 YouTube 自动字幕，这是最省事的路线。
- 如果主播没有开启字幕，或者平台是 Twitch，就不能依赖这条路。

### 3. Felo Subtitles

来源：

- <https://chromewebstore.google.com/detail/ponokiofkijoolhebggofhhibnafebna>
- <https://subtitles.felo.me/>

优点：

- 支持 YouTube Live、Twitch Live 等浏览器直播。
- 使用当前标签页音频，符合“不要把麦克风和游戏声混进来”的方向。
- 支持英文识别和中文翻译，支持单语/双语。
- 有单独 capture 页面，能保留并导出 transcript。

限制：

- 商店约 5 万用户，3.6/5，147 个评分；在这类扩展中最大，但绝对规模仍小。
- 单独 capture 页面本质上是新开的 Chrome 标签页，不是 Win11 那样的系统级独立悬浮窗；要放副屏需要手动拖出窗口。
- 依赖云端服务，音频/文本会离开本机。
- 注册赠送时间有限，官网定价页不直接展示完整价格，付费透明度一般。

判断：

- 如果愿意付费，并且能接受“capture 标签页 + 云端识别”，它是最值得先试的商业扩展。
- 不建议把它称为“大家都在用”；更准确的说法是“这个细分里用户量最大的一个”。

### 4. Soniox

来源：

- <https://chromewebstore.google.com/detail/jhmkmdfdmeibhadmdpnfmohpogimgooc>
- <https://soniox.com/pricing>
- <https://apps.apple.com/us/app/soniox/id1560199731>

优点：

- 支持当前标签页音频。
- 60+ 语言，实时转写和翻译质量口碑不错。
- Chrome 扩展提供页面悬浮字幕和 side panel。
- 免费额度按周补充。
- 官方 API 实时转写约 0.12 美元/小时，翻译包含在同一次调用里，适合自行开发时估算成本。

限制：

- 扩展形态是 side panel/页面悬浮字幕，不是独立历史窗口。
- 商店评分样本只有 6 个，4.7 分不能说明大规模质量。
- 订阅 Pro 约 19.99 美元/月，年付约 119.99 美元。
- 云端处理，需要账号和网络。

判断：

- 接受侧边栏、且想少折腾时可以考虑。
- 不满足“独立窗口 + 完整历史”的硬要求。

### 5. WhisperLiveKit

来源：

- <https://github.com/QuentinFuxa/WhisperLiveKit>

优点：

- Chrome 扩展使用 `tabCapture`，音源隔离方向正确。
- 本地 Whisper 做识别，NLLB 可做英译中，支持原文/译文并排。
- 转录页面可滚动，服务端保留完整转录；前端默认只渲染最近一部分，需要适配完整历史。
- RTX 4070 Super 足够运行 `large-v3-turbo` 一类模型，2-3 秒延迟有现实可行性，但必须实测。
- 软件免费，音频不必上传。

限制：

- 它不是开箱即用的桌面字幕应用，主要是本地 Web 页面 + Chrome 扩展。
- 前端默认自动滚到底部，缺少“用户向上滚动时暂停跟随”的细节。
- 需要增加独立窗口/置顶、历史保留、回到最新、导出等体验。
- NLLB 常用权重是 CC-BY-NC-4.0；个人观看可以，商业分发要注意许可。

判断：

- 这是“免费 + 本地 + 标签页音频 + 可回看”的最合理工程底座。
- 需要改的是外壳和交互，不是识别模型本身。

## 不建议作为主方案

- **Windows 11 自带实时字幕**：默认采系统音频，无法排除浏览器外的游戏声/语音聊天；普通 PC 不能把英语直播翻译成中文。它只适合作为 UI 参考。
- **SakiRinn/LiveCaptions-Translator**：项目成熟度可以，但主要采系统音频，和“只读浏览器标签页”的核心要求冲突。
- **OBS 字幕插件/LocalVocal**：绝大多数是主播推流端方案，不是观众端方案。
- **沉浸式翻译等字幕插件**：依赖已有字幕轨；没有字幕的 Twitch 直播不能靠它生成字幕。
- **几千用户、价格不透明的小众付费扩展**：不再作为主推荐；除非你有明确的使用反馈，否则不值得为它们做调研成本。

## 价格与成本

| 方案 | 公开价格 | 备注 |
|---|---:|---|
| Chrome Live Caption / Live Translate | 免费 | 翻译会把字幕文本发给 Google |
| YouTube 自动字幕 | 免费 | 依赖创作者开启和平台条件 |
| Felo | 注册赠送约 15 分钟；付费价格未公开 | 官网定价页不直接列金额 |
| Soniox Pro | 19.99 美元/月；119.99 美元/年 | 免费额度按周补充 |
| Soniox API | 约 0.12 美元/小时实时转写 | 翻译包含在内；适合自建 |
| WhisperLiveKit | 0 美元 | 只计电费；本地模型下载占空间 |

如果自己做“本地 Whisper + 文本翻译 API”，通常比全实时语音翻译 API 便宜，但需要自己处理断句、延迟、重试和字幕合并。

## 适配判断

### 不需要改代码

- 只需要当前几句英文字幕：先用 Chrome Live Caption。
- 需要英译中，且能接受浏览器气泡：开启 Chrome Live Translate。
- 直播刚好有 YouTube 自动字幕：优先用平台字幕/翻译。
- 能接受云端和 capture 标签页：试 Felo。
- 能接受 side panel：试 Soniox，先用免费额度。

### 需要做二次适配

如果坚持以下组合：

- 只采当前 Twitch/YouTube 标签页；
- 独立窗口，最好始终置顶；
- 能向上滚动查看完整历史；
- 英译中，最好中英双语；
- 免费或低成本；

那么应选择 WhisperLiveKit，改造范围控制在：

1. 用 `chrome --app` 或 Tauri/PySide 把本地转录页包成独立窗口。
2. 增加窗口置顶。
3. 用户向上滚动时暂停自动跟随，提供“回到最新”。
4. 保证完整历史保留，不只渲染最近 200 行。
5. 默认使用 `large-v3-turbo` + NLLB，实测延迟后再决定是否换文本翻译 API。
6. 增加 transcript 导出和刷新后的历史恢复。

## 最终建议

### 路线 A：零成本先验证

1. 打开 `chrome://settings/accessibility`。
2. 确认 Live Caption 和 Live Translate 都开启，目标语言选简体中文。
3. 打开 Twitch/YouTube 英文直播，确保播放器未静音；关闭其他正在发声的标签页。
4. 观察字幕气泡是否能显示、延迟是否可接受、是否能回看历史。

这条路线的价值是：**先判断你是否真的需要完整字幕应用。** 如果 Chrome 的当前行字幕已经够用，就不需要写代码，也不需要买扩展。

### 路线 B：接受商业化 shortcut

先试 Felo 的免费额度，重点验证：

- Twitch 标签页音频能否稳定采集；
- 中文翻译是否比 Chrome 内置更好；
- capture 标签页的历史和导出是否满足观看习惯；
- 付费价格是否值得。

如果只需要侧边栏，Soniox 是第二选择；不要为了“看起来像字幕软件”而买一个自己不会长期用的扩展。

### 路线 C：做自己的本地版本

如果 Chrome 气泡不满足历史要求，而 Felo/Soniox 又不想付费，直接用 WhisperLiveKit 做一层轻量封装。
这条路线的工程量主要在桌面壳和交互，不在语音识别；对你现有的 4070 Super 来说，硬件不是瓶颈。

## 需要你确认的一个点

你是否能接受 Chrome 内置这种“只显示最近几行、不能完整回滚”的字幕气泡？

- 能接受：先不开发，直接用 Chrome 内置方案。
- 不能接受：按 WhisperLiveKit 做独立窗口和完整历史的原型。

## 主要来源

- Chrome Live Caption / Live Translate: <https://support.google.com/chrome/answer/10538231>
- YouTube 自动字幕（含直播限制）: <https://support.google.com/youtube/answer/6373554>
- Microsoft Edge Live Captions 策略说明: <https://learn.microsoft.com/deployedge/microsoft-edge-policies/livecaptionsallowed>
- Felo Subtitles Chrome Web Store: <https://chromewebstore.google.com/detail/ponokiofkijoolhebggofhhibnafebna>
- Felo Subtitles 官网: <https://subtitles.felo.me/>
- Soniox Chrome Web Store: <https://chromewebstore.google.com/detail/jhmkmdfdmeibhadmdpnfmohpogimgooc>
- Soniox API 价格: <https://soniox.com/pricing>
- Soniox App Store 价格: <https://apps.apple.com/us/app/soniox/id1560199731>
- WhisperLiveKit: <https://github.com/QuentinFuxa/WhisperLiveKit>
- Twitch 观众字幕讨论: <https://www.reddit.com/r/Twitch/comments/1uobkcs/closed_captionssubtitles_for_twitch_streams/>
