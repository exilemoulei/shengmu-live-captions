# WhisperLiveKit 实测与方案判断

调研日期：2026-10-21
目标：观看 Twitch / YouTube 英文直播，只采集目标浏览器标签页音频，在独立窗口中显示实时中文字幕，并支持中英双语、完整历史回看和 2-3 秒级延迟。

## 结论

1. **WhisperLiveKit 可以用，而且是目前最符合“标签页音频 + 本地识别 + 中文翻译 + 历史回看”的底座。**
2. **它不是开箱即用的成品。** 当前 Chrome 扩展只是 demo：字幕页就是扩展 popup，没有真正的后台持续采集；前端最多显示最近 200 行，并且每次更新都会强制滚到底部。
3. **真正需要改的是采集壳、窗口和字幕交互，不是语音识别链路。** 服务端、PCM WebSocket、Whisper、说话人分离和完整历史都已经具备。
4. **内置 NLLB-600M 翻译是短板。** 英译中可用，但口语、专有名词和断句错误较明显。建议保留 NLLB 作为离线兜底，同时增加上下文感知的本地 LLM 或低价文本 API 翻译。
5. **如果你要的是马上能用的 Windows 成品，LiveTranslate 比 WhisperLiveKit 完整；但它采集全局系统音频，不满足“只采目标标签页”。** 因此它适合作为 UI/交互参考，不是本项目最终底座。

## 本机实测

测试版本和运行环境：

| 项目 | 结果 |
|---|---|
| WhisperLiveKit | `0.2.26`，commit `363e4f6d029694d9c81ae548beddd9d3c88a3637` |
| Python | 3.11.0，独立虚拟环境 |
| GPU | RTX 4070 SUPER 12 GB |
| PyTorch | `2.14.1+cu130` |
| CUDA | `torch.cuda.is_available() == True` |
| 后端 | `faster-whisper` + CUDA |
| 翻译 | NLLB-200 distilled 600M，`en -> zh` |
| 服务接口 | WebSocket PCM、REST、Web UI 均正常 |

实测结果：

| 配置 | 首个英文片段 | 首个中文片段 | 整句最终中文 | 显存 |
|---|---:|---:|---:|---:|
| `base.en` + NLLB | 首块音频后约 1.2 秒 | 首块音频后约 2.5 秒 | 音频结束后约 0.4 秒 | 较低 |
| `large-v3-turbo` + NLLB | 首块音频后约 1.3 秒 | 首块音频后约 2.8 秒 | 音频结束后约 0.3 秒 | 整卡约 7.0 GB 占用，含其他进程 |

结论：

- 2-3 秒看到中文中间结果是有现实依据的，4070 SUPER 也足够。
- 最终整句仍要等断句或停顿，因此完整句会晚于首个中间结果。
- `--translate-on-complete` 能减少翻译闪烁，但实测中文要等音频结束或停顿后才出现，常超过 3 秒，不适合作为默认模式。
- 在这两段干净测试音频上，`large-v3-turbo` 的英文准确率没有明显优于 `base.en`；真实直播中的口音、背景音乐和噪声才更能体现大模型价值，必须用目标主播的音频复测。

## NLLB 翻译质量

功能已经验证：服务端确实返回中英双语，不只是配置里有一个翻译开关。

但 NLLB-600M 的实际输出暴露了三个问题：

| 英文识别结果 | NLLB 600M 中文 |
|---|---|
| `I'm from the cutter, lying off the coast.` | `我来自切割厂,躺在海岸.` |
| `Concorde returned to its place amidst the tents.` | `康科德回到帐中.` |
| 同一句在流式更新过程中 | 出现 `我来自美国`、`和团回到自己的位置` 等不稳定译文 |

原因不是 Whisper，而是 NLLB 对不完整片段、上下文和固定表达不敏感。继续增大到 NLLB-1.3B 可能略有改善，但仍不能替代上下文翻译。

建议：

- 离线兜底：保留 NLLB 600M，零 API 成本。
- 默认高质量路线：把已提交的英文句子连同最近几轮上下文交给本地 LLM 或 DeepSeek 一类文本 API。
- 不需要把音频上传给云端，只发送文本，隐私和成本都更可控。

DeepSeek 官方当前价格是每百万 tokens 输入 1-2 元、输出 4-8 元，闲时和高峰不同。直播字幕只发送文本，数小时通常也只需要几毛到几元，远低于全量语音识别 API。

来源：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing>

## 当前扩展的实际缺口

### 1. 不是独立字幕窗口

`chrome-extension/manifest.json` 使用：

```json
"action": {
  "default_popup": "live_transcription.html"
}
```

字幕页就是扩展 popup。用户点回直播页后 popup 会失焦关闭，无法作为长期独立字幕窗口，也不能保证采集生命周期。

### 2. 有 offscreen 权限，但没有 offscreen 实现

manifest 声明了 `offscreen`，但扩展没有 background service worker，也没有 offscreen document。当前代码直接在 popup 内调用：

```js
chrome.tabCapture.capture({audio: true}, ...)
```

要稳定持续采集，应改成：

1. popup 只负责选择当前 Twitch / YouTube 标签页并点击“开始”。
2. background service worker 调用 `chrome.tabCapture.getMediaStreamId()`。
3. offscreen document 保持音频流、AudioWorklet 和 WebSocket。
4. popup 和字幕窗口关闭都不影响后台采集，除非用户主动停止。

### 3. 麦克风回退必须删除

当前 tabCapture 失败后会回退到麦克风：

```js
console.log('Tab capture not available, falling back to microphone', tabError);
stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
```

这会在用户不知情时识别环境声音，和需求相反。改造后 tabCapture 失败应直接显示明确错误并提供重试。

### 4. 只渲染最近 200 行

`whisperlivekit/web/live_transcription.js` 中：

```js
const MAX_RENDERED_LINES = 200;
```

服务端 `mode=full` 且 `--retention-seconds 0` 时会保留完整转录，但前端把更早的行替换成 `earlier lines hidden`。

### 5. 每次更新强制滚到底部

```js
transcriptContainer.scrollTo({
  top: transcriptContainer.scrollHeight,
  behavior: "smooth"
});
```

用户向上翻看历史时，下一条字幕会把视图拉回底部，无法正常回看。

### 6. 扩展是 demo 级别

Git history 中扩展是在 `2025-09-25` 以 `demo extension` 引入的，后续没有产品化重构。WhisperLiveKit 主项目非常活跃，但 Chrome 扩展这一层不能按成熟客户端来预期。

## 推荐改造

不 fork WhisperLiveKit 核心代码，保持上游可升级。新增一个薄客户端：

```text
Twitch / YouTube 标签页
        |
        | chrome.tabCapture
        v
Chrome background service worker
        |
        v
Offscreen document
  - 保持音频流
  - AudioWorklet 转 16 kHz PCM
  - WebSocket 发送到 WhisperLiveKit
        |
        v
WhisperLiveKit localhost:8010
  - faster-whisper CUDA
  - 说话人分离（可选）
  - NLLB / 本地 LLM / DeepSeek 翻译
        |
        v
独立字幕窗口
  - 中英双语
  - 完整历史
  - 上滚暂停跟随
  - 回到最新
  - 导出 transcript
```

第一阶段可以先用 `chrome.windows.create()` 创建独立扩展窗口。它没有地址栏、可拖到副屏，足够通过采集卡录入。若必须始终置顶，第二阶段再用 PySide6、Tauri 或 WebView2 包一个原生置顶窗口。

推荐默认配置：

```powershell
wlk serve `
  --host 127.0.0.1 `
  --port 8010 `
  --backend faster-whisper `
  --model large-v3-turbo `
  --language en `
  --target-language zh `
  --pcm-input `
  --retention-seconds 0
```

先用真实直播音频比较 `base.en`、`small.en` 和 `large-v3-turbo`，不要仅凭模型大小决定。若 NLLB 质量不够，再接入文本翻译层。

## 与其他主流路线对比

| 方案 | 音源隔离 | 独立窗口/历史 | 中英双语 | 成本 | 结论 |
|---|---|---|---|---|---|
| Chrome Live Caption / Live Translate | 浏览器音频，基本跟随当前媒体 | 字幕气泡，无完整历史 | 翻译可开，历史弱 | 免费 | 最省事，但体验不满足 |
| YouTube 自动字幕 | 平台字幕 | 播放器内 | 取决于视频 | 免费 | 只适用于已有自动字幕的 YouTube 直播 |
| LiveTranslate | 全局系统音频 | PyQt 悬浮窗，可滚动，自动跟随可关闭；内存中保留 50 条并持久化文本 | 支持 | 软件免费，翻译 API 自付 | 最接近成品，但不满足标签页隔离 |
| WhisperLiveKit | Chrome 标签页 `tabCapture` | 需改造；服务端完整历史 | 支持 | 软件和本地模型免费 | 最符合需求，但需要客户端适配 |
| Soniox / Felo 等云端扩展 | 标签页 | 以页面浮层/侧栏为主 | 支持 | 订阅或额度 | 云端、付费、窗口形态仍不理想 |

社区采用情况：

- 普通用户最先用 Chrome / YouTube 自带能力，因为零安装。
- 中文 Windows 用户中，LiveTranslate 是更接近成品的开源路线：GitHub 约 841 stars，B 站安装演示约 1.74 万播放、890 点赞、440 评论。
- 愿意折腾、且重视音源隔离的用户，会采用 WhisperLiveKit、faster-whisper 一类本地识别底座。
- “无字幕 Twitch 直播 + 观众侧中文字幕 + 独立历史窗口”仍不是一个成熟的大众产品类别。

## 不可解决的边界

`tabCapture` 只能隔离“这个标签页”和“其他应用/标签页”，不能拆分同一路直播音频内部已经混合的声音。

- 游戏声来自另一个应用：可以排除。
- 语音聊天来自另一个应用：可以排除。
- 游戏声或队友语音已经混在主播的 Twitch / YouTube 流里：无法只去掉它们。
- 任何标签页内的广告、提示音和背景音乐都会一起被识别。

## 最终建议

采用 **WhisperLiveKit 服务端 + 自建 offscreen 采集扩展 + 独立字幕窗口**。

这是“只采目标标签页”和“保留完整历史”同时成立的最小改动路线。首版先解决可用性，不重写识别引擎；翻译先保留 NLLB 兜底，并用真实直播评估是否需要接入上下文 LLM。

## 来源

- WhisperLiveKit: <https://github.com/QuentinFuxa/WhisperLiveKit>
- LiveTranslate: <https://github.com/TheDeathDragon/LiveTranslate>
- LiveTranslate B 站演示: <https://www.bilibili.com/video/BV1K2Awz6Euw>
- Chrome Live Caption: <https://support.google.com/chrome/answer/10538231>
- YouTube 自动字幕: <https://support.google.com/youtube/answer/6373554>
- DeepSeek API 价格: <https://api-docs.deepseek.com/zh-cn/quick_start/pricing>
- NLLB-200 distilled 600M 模型卡: <https://huggingface.co/facebook/nllb-200-distilled-600M>
