# 项目进度记录 (PROGRESS.md)

## 2026-10-31 · 0.5.3：术语库基建（解析/匹配/序列化 + 设置字段，不含术语表内容）

设计/验收记录：`paseo/11-glossary-0.5.3.md`。范围由用户拍板：只做基建层，内置 PoE 预设留空壳，popup 面板 / 翻译注入 / ASR context / `-Glossary` 打通留到下一步。

### 已修改文件
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\extension\glossary.js`（新增，443 行）：零 `chrome.*`/DOM 纯函数。`GLOSSARY_PRESETS`（`poe` 空壳 + `domainHint`）、`parseGlossaryText`（`->`/`=>`/`=`/`,`/制表符分隔、`|` 别名、`#`/`//` 注释、引号遮罩（引号内逗号/竖线不切分）、CSV 表头跳过与引号还原、同主拼写后写覆盖）、`collectGlossaryEntries`（预设 + 自定义合并，自定义优先）、`matchGlossaryTerms`（词边界、英文复数/所有格折叠、长词优先 + 字符区间遮挡、每批 ≤24 条、正则缓存）、`buildGlossaryMap`、`buildGlossaryTermPattern`、`buildAsrContextPrompt`（仅 ASCII 英文源词，≤360 字符）、`serializeWlkGlossary`（别名展开成独立 `source -> target`，洗 `;；`，≤4000 字符）、`exportGlossaryText`（text/csv 双格式，均能原样读回）。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\extension\caption-utils.js`：`DEFAULT_SETTINGS` 增 `glossaryEnabled`/`glossaryPresetIds`/`glossaryDomainHint`/`customGlossary`；`normalizeSettings` 增三条归一（未知/重复预设 id 丢弃、领域提示压空白截 120、自定义词条截 32 KB）；新增 `MAX_GLOSSARY_DOMAIN_HINT_CHARS`。术语字段不进 `TAB_ALLOWED_SETTING_KEYS`。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\tests\glossary.test.js`（新增）：21 例，覆盖解析各格式、CSV 表头与引号、覆盖优先级、复数/所有格/`ies`、短词边界（`ES` 不碰 `best`/`test`）、长词遮挡（`Orb of Augmentation` 压 `Orb`）、`maxMatches`、空输入、`poe-041` 真实误听句（`Path of Excel`/`Isamite`/`dominating blow`）、ASR 提示词预算、WLK 序列化清洗与不可表达源词跳过、字面竖线、emoji 与弯引号、text/csv 往返。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\tests\caption-utils.test.js`：+5 例（术语设置默认与非法预设 id、预算截断、`sanitizeSettingsPatch` 拦截术语字段、`settingsForBroadcast` 保留术语字段、`settingsForCaptions` 剥离 `customGlossary`）。
- `extension/service-worker.js`：`broadcastCaptionState` 与 `injectOverlay` 的 init 改用 `settingsForCaptions`，发往标签页的对象不再携带 32 KB 自定义词条（审阅 P2）。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\package.json` `extension/manifest.json`：版本 0.5.2 → 0.5.3。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\AGENTS.md`：首段版本与文档锚点、`npm test` 数量 57→80、分层表加 `glossary.js`、§4 增两条术语库红线。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\paseo\11-glossary-0.5.3.md`（新增）：数据模型、解析/匹配规则、三个序列化器、空壳预设约定、真实语料验证、下一步。

### 已执行验证
- `npm test`：87 项全通过（本次 +26：`tests/glossary.test.js` 21 例 + `tests/caption-utils.test.js` 5 例）。
- `node --check`：`extension/glossary.js`、`extension/caption-utils.js`、`tests/glossary.test.js` 通过。
- 真实语料冒烟（`.research/poe-041/transcripts.md` 66 条英文行 + 对话里列出的 12 条 PoE 词条作 fixture）：10 行命中、11 次命中，含 `Path of Exile`×3 / `Path of Excel`×1 / `runesmithing`×3 / `Isamite`×2 等；1000+ 字符超长行命中 6 条不卡；`buildAsrContextPrompt` 196 字符、`serializeWlkGlossary` 316 字符，均未触顶。
- 已知不命中（设计内）：`sectors are thematically perfect`（实为 `scepters`）不靠别名纠错——`sector` 是真实英文常用词，登记别名会在其他语境误伤，留待「领域提示 + 模型纠偏」。

### 未执行 / 待后续决定
- 术语库下一步 4 项均未做（见 `paseo/11-glossary-0.5.3.md` §8）：`translation-api.js` 注入、`service-worker.js` 传词条与 WS `?context=`、`server.mjs` + `Start-Services.ps1` 的 `-Glossary` 打通与 `-Restart` 判定、popup 术语库面板。
- 预设词库内容（60~100 条）未写；360 字符 ASR 预算装不下全部专名时，需要一个「核心专名优先」的分级字段，待词条内容定稿后再选型（词条级 `core` 标记 vs 预设包级 `asrTerms[]` 短名单）。
- 跨模型审阅（GPT-6 Luna，`review=code review`）两轮完成：首轮无 P0、P1 两条 + P2 三条，全部已修；复审确认可提交，又指出两个引号遮罩边界 P2（emoji 代理对错位、弯引号误当字段引号），一并修掉并补往返用例。审阅第三条 P1（新增测试被 `.gitignore` 忽略、不会随仓库交付）成立，已把 `/tests/` 移出 `.gitignore`，测试随后续提交入库。详见 `paseo/11-glossary-0.5.3.md` §9。
- `.gitignore` 移除 `/tests/`：`tests/` 全部 7 个文件随之入库（此前自 0.4.x 起被忽略）；`paseo/`、`AGENTS.md`、`.research/`、`test-assets/` 仍为本地。
- 未做浏览器实测：本次不含 UI 与运行时链路。`extension/glossary.js` 目前只被 `caption-utils.js` 引入两个常量（预设 id 列表、自定义词条长度上限），匹配与序列化函数尚无运行时调用者，扩展实际行为与 0.5.2 一致。

## 2026-10-31 · 0.5.2：ASR 参数、显示锁、浮层宽度、透明度滑块（Helium 实测）

设计/验收记录：`paseo/10-asr-width-opacity-0.5.2.md`。

### 已修改文件
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\scripts\Start-Services.ps1`：WLK 参数 `--buffer_trimming_sec 4→10`、`--localagreement-beam-size 1→3`、新增 `--confidence-validation`；`--asr-coalesce-min-s` 试过 0.3 后按实测回退 0.5（0.3 会让 54% 的行碎成 “The.” 级片段）。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\scripts\local-service\server.mjs`：`/start` 接受 `translationMode` + `apiTranslationConfigured`；`api` 且已配 Key 时传 `-AsrOnly`（不启 8013），并在模式切换时先停旧服务 / 用 `-Restart` 避免 Start-Services 报错。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\extension\caption-utils.js`：`selectDisplayCaption` 不再让新英文等旧译文（原文槽最新、译文槽保留上一句并置 `pending`）；新增 `normalizeOpacity`（域 `0.05~1`，`0` 不再被吞成默认值）。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\extension\content-overlay.js`：新增 `.caption-stack` 承载工具栏与字幕框，`.stage` 退为定位锚点（`min(68vw, 860px)`）；canvas `measureText` 量宽 + 240~860 px 贴合、变宽立即/变窄延时 420 ms；`.translation.stale`（上一句，同字号降透明）与 `.translation.pending`（空占位）分流；`--overlay-opacity` 联动背景/边框/阴影/`backdrop-filter` 与历史面板。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\extension\popup.html` `popup.js`：新增「不透明度」滑块（180 ms 防抖落库）；本地模型区按 API/本地模式调整文案与启停条件。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\extension\manifest.json` `package.json`：版本 0.5.1 → 0.5.2。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\README.md` `AGENTS.md` `paseo/10-asr-width-opacity-0.5.2.md`：文档与规范同步。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\tests\caption-utils.test.js`：新增/改写 `selectDisplayCaption` 4 例与 `normalizeOpacity` 1 例。

### 已执行验证
- `npm test`：60 项全通过；`node --check` 覆盖 `extension/*.js`、`server.mjs`、`tests/*.js` 全通过；`Start-Services.ps1` PowerShell 解析 0 错误。
- 120 秒固定样本（`vkCu3V81N74-15m00-17m00.wav`）×3 配置，Helium + 扩展 + WLK + 本地 9B：采用配置 24 行、首英文 0.80 s、首中文 1.55 s、译文滞后 P50 1.25 s / P95 2.61 s、结束缺译 0、`Resetting buffer` 0。
- UI 实时采样（`.research/v052-ui-check.py`）：`.caption-shell` 出现 240→860 px 共 18 档随句长变化，`.stage` 固定 860 px；透明度滑块 8% → `blur(0.88px)`、86% → `blur(9.46px)`，`.translation.stale` 在 65/100 采样中生效且与上一句译文一致。

### 未执行 / 待后续决定
- 跨模型审阅（GPT-6 Luna）已完成：无 P0，1 个 P1、6 个 P2；P1 与 5 个 P2 已修并重测，剩 1 个 P2（ASR-only 下 API 失败时 popup 仍显示“实时翻译中”）记入 backlog。详见 `paseo/10-asr-width-opacity-0.5.2.md` §8。
- 最终浏览器复测在 `scripts/Start-DevBrowser.ps1`（Chrome + `chrome-profile`）上完成，未再打断 Helium 里的直播；Helium 侧由用户自行观察。
- 已提交并推送：`defe4fc` `feat(0.5.2): stop dropping ASR audio, hug the caption box, add opacity slider`（`master` → `origin/master`，GPG 签名）。`.research/`、`tests/`、`paseo/`、`AGENTS.md` 在 `.gitignore` 中，这些改动不进版本库。
- 在线直播（Twitch）只做了人眼链路，未作为转写验收源。
- 短行合并（把 “The.” 与下一行合并再翻译）未实现，需单独设计。
- Helium 自带拦截器会挡以标签页方式打开 `chrome-extension://<id>/popup.html`；该标签页若成为活动标签，点“开始”会报“此页面不支持标签页音频采集”。已记入 `.pit`（`tabcapture-97fd44`）。
- `Start-LocalService.ps1` 在本次会话两次出现“服务已起来但 PowerShell 包装进程不返回”（120 s 后才被中断），疑似脚本末尾健康轮询/句柄继承问题，与本次改动无关，未深查。

## 2026-10-31 · 重写项目级 `AGENTS.md`（参照 Sonelis Station `CLAUDE.md` 电报式极简风格）

### 已修改文件
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\AGENTS.md`：砍掉八股套话与顶层巨型四列表，压缩为 63 行（约 3.8 KB，体积缩减超 55%）电报式高密度规范，完整保留命令、代码规则、浮层/降噪阈值、分层表、三处模型同步、节流预算与安全红线。
- `C:\Users\moule\Documents\ChatGPT\实时字幕翻译\PROGRESS.md`：更新进度记录。

### 已执行验证
- `npm test`：57 项测试全部通过（耗时 ~718 ms）。
- `node --check`：全量检查 `extension/*.js`、`scripts/local-service/server.mjs`、`tests/*.test.js` 语法全部通过。
- Phase 4 12 条红线自检：12/12 全部 `PASS`（83 行 ≤ 120 行上限）。

### 未执行 / 待后续决定
- 本地 GPU 端到端启动命令（`.\scripts\Start-Services.ps1`、`.\scripts\Start-LocalService.ps1`、`.\scripts\Start-DevBrowser.ps1`）属于有状态硬件/浏览器服务命令，本次仅做静态脚本路径与参数核对，未拉起常驻进程。
- `package.json` 尚未串联一键 `check` 脚本（当前仅有 `"test": "node --test tests/*.test.js"`），按约定未擅自修改 `package.json`，已在交付报告中给出补齐建议。
