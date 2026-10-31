# 项目进度记录 (PROGRESS.md)

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
- 未提交、未 `git push`；`.research/`、`tests/`、`paseo/`、`AGENTS.md` 在 `.gitignore` 中，改动不会进版本库。
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
