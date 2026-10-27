# paseo · 实时字幕翻译迁移工作区

这个目录是 2026-10-27 从 Codex 迁移到 paseo 时建立的需求包，不是第二份可运行代码。

## 为什么功能代码不在 paseo/ 里

Chrome 扩展只能从 `extension/` 加载；把实现复制到 `paseo/` 会产生一份无法直接运行、且迟早与主目录分叉的副本。因此约定：

- 运行代码：`extension/`、`scripts/`、`tests/`（当前仓库，未提交、未推送）。
- 需求文档、mock、评审、验证记录：`paseo/`。

如果之后确实需要隔离分支，可以基于当前工作区另建 worktree；届时把本目录的文档带过去即可。

## 本次需求

给扩展增加翻译 API 接入，默认 DeepSeek，同时保留本地服务端模式。

状态：**实现完成；独立评审完成；40/40 测试通过；真实 DeepSeek + Chrome 2 分钟端到端通过**（全量视频按用户要求不跑）。

## 文件

| 文件 | 内容 |
| --- | --- |
| `00-environment.md` | paseo 环境盘点、skill 安装、MCP 结论、风险 |
| `01-translation-api-design.md` | 架构、数据流、错误处理、安全、改动清单、手工验收 |
| `mock-openai-server.mjs` | 无 Key 联调用的 OpenAI 兼容 mock |
| `02-review.md` | Haiku 独立评审原始结论（快照 35/35） |
| `02-review-fixes.md` | 评审问题逐条修复状态（M1–M4 / S1–S8） |
| `03-verification.md` | 测试/验证记录（40/40） |
| `compare-codex-vs-paseo.md` | Codex 与 paseo 的继续开发评估与推荐分工 |

## 快速开始（无真实 Key）

```powershell
# 1. mock 翻译 API
node paseo/mock-openai-server.mjs

# 2. 只跑 ASR，不加载 9B（可选；首次启动仍需加载 Whisper）
.\scripts\Start-Services.ps1 -AsrOnly

# 3. Chrome + 扩展
.\scripts\Start-DevBrowser.ps1
# 扩展控制面板 → 翻译引擎 → API 翻译 → 自定义兼容 API
# API 地址 http://127.0.0.1:8787/v1，模型 mock-translate
# 点“测试翻译 API”
```

真实 DeepSeek：服务商选 DeepSeek，填 Key，点测试；其余相同。

## 验证命令

```powershell
npm test
Get-ChildItem -LiteralPath .\extension -Filter *.js |
    ForEach-Object { node --check $_.FullName }
```

## 迁移边界

- 不推送 git；改动留在工作区。
- 不修改 `.research`、WhisperLiveKit、llama.cpp、本地模型。
- 不清理或重建 `chrome-profile`。
- 服务/Chrome 端到端测试前先确认用户在场；240 秒冒烟优先，不直接跑长稳定性。
