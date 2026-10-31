# 术语库框架（`extension/glossary.js`）实战问题记录

本文记录在基于现有 `extension/glossary.js` 框架构建《流放之路 1 & 2》（Path of Exile）313 条官方解包术语库过程中暴露出的框架问题、实测影响及当前规避方式。本次仅记录问题与词表层面的规避，未改动框架逻辑。

---

## 问题总览

| 编号 | 严重度 | 所在函数 / 模块 | 问题简述 | 当前词表规避手段 |
| --- | --- | --- | --- | --- |
| 1 | 高 | `buildAsrContextPrompt` | 把 `sources[1..]` 中的同音错词（如 `Path of Excel`、`Isamite`）一并注入 Whisper `initial_prompt`，反向诱导 ASR 听错并浪费预算 | 前排词条尽量少挂错误拼写，仅保留必测项 |
| 2 | 高 | `buildAsrContextPrompt` | 360 字符预算无优先级概念，仅按 `entries` 数组顺序硬截断，仅能容纳前 ~25 个词 | 将最易被 Whisper 听错的专有名词手工排在 `entries` 最前面 |
| 3 | 中 | `serializeWlkGlossary` | 4000 字符上限在展开所有别名后仅能容纳约 180~200 对词条，300+ 条规模词库的后半截在 WLK 本地翻译兜底模式下被静默丢弃 | 按实战高频度三梯队排序，保证前 160 条覆盖核心通货、职业升华与核心机制 |
| 4 | 中 | `buildGlossaryTermPattern` | 词尾变形正则仅支持 `-s/-es/-ies/-'s`，不支持 `-f -> -ves`、拉丁复数、过去分词 `-ed` 以及 `Orb of X -> Orbs of X` 前置中心词复数 | 在 `sources` 数组中手工补齐 `Staves`、`Quarterstaves`、`Foci`、`Ignited`、`Frozen` 等变形别名 |
| 5 | 中 | `matchGlossaryTerms` | 无多义词（Polysemy）门控与大小写/词性区分，单字日常英语词（如 `Spark`、`Grace`、`Hit`、`Return`）会无条件命中口语并挤占每批 24 条上限 | 预设库剔除纯日常基础英语单字，仅收录专有名词、复合词或无歧义机制词 |
| 6 | 低 | `GLOSSARY_PRESETS` | 单一 `poe` 预设无法区分 PoE 1 与 PoE 2 同英文名、不同官译的词条（如 `Sceptre` 在一代为“短杖”、二代为“权杖”；`Focus` 在一代为“专注”、二代为“法器”） | 优先采用二代及当前直播高频官译，或在译名中兼顾 |
| 7 | 低 | `matchGlossaryTerms` / `PATTERN_CACHE` | 每次翻译批次（含流式未定稿每 450 ms 一次）都对全量预设词条重跑 `normalizeEntries` 与全表展开排序；拼写总数超 2000 时 `PATTERN_CACHE.clear()` 整表清空抖动 | 控制预设词条在 313 条（341 个拼写），远低于 2000 缓存上限 |

---

## 详细分析与后续改进建议

### 1. 同音纠错别名反向污染 Whisper 解码（`buildAsrContextPrompt`）

- **现象**：词条 `sources` 数组的设计是“第一个为主拼写 `sources[0]`，后续为 ASR 常见误听别名 `sources[1..]`”（例如 `["Path of Exile", "Path of Excel", "PoE"]`、`["Ezomyte", "Isamite"]`）。但 `buildAsrContextPrompt` 遍历了 `entry.sources` 的所有元素并拼入 `?context=`。
- **后果**：faster-whisper 的 `initial_prompt` 用于偏置英文解码概率。把错误拼写 `Path of Excel`、`Isamite` 塞进 `initial_prompt`，反而会提高 Whisper 输出错词的概率，同时挤占 360 字符预算。
- **改进建议**：`buildAsrContextPrompt` 应当**只读取每个词条的主拼写 `entry.sources[0]`**（或仅读取显式标记为正确英文专名的拼写），绝不能把同音误听词喂给 ASR。

### 2. 360 字符 ASR 热词预算缺乏核心词分级（`buildAsrContextPrompt`）

- **现象**：`MAX_ASR_CONTEXT_CHARS = 360` 扣掉 `, ` 分隔符后只能容纳约 25~30 个英文词。现有实现从 `entries[0]` 顺序累加，超长即跳过后续词条。
- **后果**：若词表按字母序或普通分类排列，前 360 字符会被 `Chaos Orb`、`Divine Orb` 这类 Whisper 本来就不会听错的常见英文词占满，而真正需要热词偏置的瓦尔克拉斯专名（`Wraeclast`、`Kalguuran`、`Ezomyte`、`Sekhemas`、`Kalandra`、`Chayula`、`Xesht`）反而排在后面进不去。
- **改进建议**：在预设包上增加独立的 `asrTerms` 精选热词列表，或为词条增加 `asr: true` 标记，专门喂给 `buildAsrContextPrompt`。

### 3. 本地 WLK 兜底模式下的 4000 字符静默截断（`serializeWlkGlossary`）

- **现象**：`serializeWlkGlossary` 将所有别名展开为独立的 `source -> target` 对，以 `; ` 连接并在 4000 字符处直接返回。
- **后果**：平均每个 `source -> target; ` 占 20~24 字符，4000 字符最多容纳约 180~200 个拼写。对于 313 条（含别名 341 个拼写，完整展开约 6900 字符）的《流放之路》词库，排在后面的约一半词条在 WLK `--openai-translation-glossary` 模式下不会生效（在线 API 与本地 `llama-server` 走 `matchGlossaryTerms` 动态按句注入，不受此影响）。
- **改进建议**：在打通 `service-worker.js` 到本地服务的下一步中，取消启动参数静态全量传参，统一改为在 `service-worker.js` 侧用 `matchGlossaryTerms` 按句匹配后再注入翻译请求。

### 4. 英文词形还原（Lemmatisation）与复合词内部复数盲区（`buildGlossaryTermPattern`）

- **现象**：当前正则只在整个词条末尾拼 `(?:s|es|['’]s)?` 或辅音 `y -> (?:y|ies|y['’]s)`。
- **四个盲区**：
  1. `-f / -fe` 变 `-ves`：`Staff -> Staves`、`Quarterstaff -> Quarterstaves`、`Wolf -> Wolves` 无法自动匹配；
  2. 不规则复数：`Focus -> Foci`（PoE 2 副手法器分类名为 `Foci`）、`Magus -> Magi` 无法自动匹配；
  3. 动词分词状态词：`Ignite -> Ignited`、`Freeze -> Frozen`、`Shock -> Shocked`、`Chill -> Chilled`、`Corrupt -> Corrupted`、`Electrocution -> Electrocuted` 无法自动匹配；
  4. `A of B` 复合名词复数：英语中 `Orb of Augmentation` 的复数是 `Orbs of Augmentation`（`s` 加在中心词 `Orb` 后，而非末尾 `Augmentation` 后），当前正则只能在词尾匹配 `Orb of Augmentations`。
- **改进建议**：后续可在 `buildGlossaryTermPattern` 中支持：
  - `f/fe` 结尾自动生成 `(?:f|fe|ves)`；
  - 对 `^([A-Za-z]+)(\s+of\s+.+)$` 结构的词条，允许第一个单词带可选 `s`（即 `Orbs? of ...`）。

### 5. 单字多义词抢占每批 24 条配额并污染日常口语（`matchGlossaryTerms`）

- **现象**：PoE 中存在大量与日常基础英语完全重合的单字术语（如 `Hit -> 击中`、`Kill -> 击杀`、`Return -> 返回`、`Spark -> 电球`、`Arc -> 电弧`、`Grace -> 优雅`、`Pride -> 尊严`、`Wrath -> 雷霆`、`Anger -> 愤怒`、`Hatred -> 憎恨`、`Determination -> 坚定`、`Link -> 连接`、`Split -> 分裂`、`Fork -> 分叉`、`Pierce -> 穿透`）。
- **后果**：
  1. 直播口语中只要出现 `"I will return soon"`、`"hit the button"`、`"a spark of"`，就会被强行注入 `{ "return": "返回", "hit": "击中", "spark": "电球" }`，导致大模型译文生硬甚至张冠李戴；
  2. 长句中此类高频基础词极易出现 10+ 次，直接把 `MAX_GLOSSARY_MATCHES = 24` 的配额吃光，导致真正难译的专有名词（因长度较短排在后面时）被挤出配额。
- **改进建议**：
  - 词表层面严禁收录纯基础英语单字；
  - 框架层面可支持“大小写敏感词条”（如仅大写 `Spark` / `Grace` 才命中，或要求搭配上下文触发词），并在 `matchGlossaryTerms` 中让高专名度词条优先于通用词条。

### 6. PoE 1 与 PoE 2 同名术语的官译分歧（`GLOSSARY_PRESETS`）

- **现象**：同一英文术语在《流放之路 1》（`poedb.tw/cn`）与《流放之路 2》（`poe2db.tw/cn`）解包中存在不同官方译名：
  - `Sceptre`：PoE 1 为 `短杖`，PoE 2 为 `权杖`；
  - `Focus`：PoE 1 为技能机制 `专注`，PoE 2 为副手装备 `法器`；
  - `Tailwind`：PoE 1 为 `流顺之风`，PoE 2 为 `提速尾流`；
  - `Arcane Surge`：PoE 1 为 `秘能波动` / `秘术增强`，PoE 2 为 `秘术增强`；
  - `Culling Strike`：PoE 1 常译 `扑杀` / `终结`，PoE 2 官译 `终结`。
- **改进建议**：后续若用户需要严格区分一代与二代，可将预设拆分为 `poe1` 与 `poe2` 两个可独立勾选的预设包，或提供基础包 + 二代覆盖包。

---

## 0.5.4 复核：313 条规模下各问题的状态

0.5.4 把预设词库从 97 条扩到 313 条并统一为国服解包译名，同时跑了一遍复核。逐条结论：

| 编号 | 0.5.4 状态 | 说明 |
| --- | --- | --- |
| 1 同音别名污染 Whisper | **已修** | `buildAsrContextPrompt` 只读 `sources[0]`；新增测试断言 `Path of Excel` 与 `Isamite` 不出现在 `?context=` |
| 2 360 字符无优先级 | **已规避** | 词库顺序即优先级：前 34 条专名占 357 字符，职业词被挤到第 35 条之后；测试断言 `Wraeclast`/`Ezomyte`/`Kalguuran`/`Kalandra`/`Xesht`/`Sekhemas` 必须在内 |
| 3 4000 字符截断 | **仍存在，已量化** | 313 条含别名展开后 3989 字符 / 199 对，覆盖前约 150 条词条；后半截只在本地兜底翻译模式下失效，API 与按句注入不受限 |
| 4 正则变形盲区 | **已规避** | 显式补 `Quarterstaves`、`Staves`、`Foci`、`Ignited`、`Frozen`、`Chilled`、`Shocked`、`Electrocuted`；未改 `buildGlossaryTermPattern` |
| 5 多义单字抢配额 | **已规避** | 词表层面剔除 `Hit`/`Kill`/`Life`/`Mana`/`Spark`/`Arc` 等；`Chill`/`Shock`/`Freeze`/`Ignite`/`Impale`/`Fortify` 因机制义强保留；`Breach`/`Expedition`/`Harvest`/`Ritual`/`Legion`/`Rage` 这类「赛季名与日常词同形」的保留项，用 `tests/glossary.test.js` 的 `trades everyday polysemy` 用例把误命中行为写死，避免误以为存在领域门控 |
| 6 一二代同名不同译 | **已定口径** | 统一按 PoE 2 优先（`Quarterstaff` 节杖、`Harvest` 庄园、`Ritual` 驱灵仪式、`Focus` 法器），未拆预设包 |
| 7 每次翻译重跑归一与排序 | **仍存在，未触发** | 313 条（341 个拼写）远低于 `PATTERN_CACHE` 的 2000 条上限，`clear()` 抖动不会发生 |

数据侧新增约束（写进项目级规范）：译名唯一判据是 `poedb.tw/cn` 与 `poe2db.tw/cn` 的条目页 `<title>`；分类页取同站导航；概念词用含该机制的技能/关键字页正文佐证；取不到中文标题的词不收。词库清单与判据细节见 `paseo/12-poe-glossary-0.5.4.md`。
