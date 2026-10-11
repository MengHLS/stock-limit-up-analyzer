# S1+S2 GATE · `FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003` 原链路审计与数据/协议冻结

> 承接 [`GOAL-FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003.md`](GOAL-FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003.md)；
> 被审计对象 = [`RESULT-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md`](RESULT-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md)
> 与正式 Run `RUN-20261010-4BFF13C2` 及其产物。
> 基线：HEAD `f8b6810` + 工作区（`git status --porcelain`：35 个已跟踪文件改动 / 3721 insertions + 157 个未跟踪；
> 含多会话并发改动，**本轮未覆盖任何并发会话文件**）。

---

## 1. S1 · 七项偏差审计（逐项证据 + 处置）

审计方式：**代码实读 + 正式 Run 产物核对**（`_scratch/fbpool2/formal-run.json`，runId/status/`durationMs 1678458`
与报告头逐字一致），**不凭报告文字判断**。

| # | 偏差 | 判定 | 证据（符号级） | 处置 |
|---|---|---|---|---|
| 1 | 账户执行前截断后续触发 | **REAL** | `rolling-pool-early-entry-runner/experiment.ts` 候选池循环：`const earliest = evaluation.triggers[0]` … `if (trigger.confirmRd !== earliest.confirmRd) { bumpIdentity("RETRY_TRIGGER_SKIPPED"); continue; }`。规则库本身**已返回全部**确认日（`types.ts#EarlyEntryEvaluation.triggers` 注释「返回**全部**而非只取首个」）。丢失 **176 / 840 = 20.95%** 原始触发日 | 003 **不再截断**：保留每个确认日一行候选，改由**账户层**（持仓 + 再入场政策）裁决；计数保留为诊断 |
| 2 | `amount` 未投影 | **缺陷 REAL，但「端口不提供」的归因 FALSE** | `ds_first_limit_pullback_post.amount` 实测存在（`double`，单位**千元**）；`server/researchExperiments/datasetPort.ts#COLUMN_TABLES` 的列白名单**就是 drizzle 表对象**，`assertDeclaredColumns` 只校验列是否存在于该表；既有实验 `dynamic-state-factor-expansion-study/experiment.ts` **已在 observation 层声明 `amount`**；下游全链已通（`rollingPoolExecutionSupport.ts#toRow` → `datasetAccess/bars.ts#rowToCanonicalBar` → `engine.ts` `amountBySecurity` → `plan.ts#referenceAmount` → `NextExecutionModel` → `engine/execution.ts#amountAdjustedSlippageBps`） | 003 **声明并透传**：`requiredColumns.observation += "amount"`、`PoolBar += amount`（纯增量）、`normalizeBar` 读它、执行投影行 `amount: bar.amount`（不再 `null`）⇒ **恢复流动性分层滑点（<1 亿 +20bps）** |
| 3 | Runner 计数错误 | **REAL，且 (i)/(ii) 不可观测** | `collectTradeFacts` 用 `holdingPeriod >= 74` 反推「Runner 触发」。权威状态机 `stateFactorRegistry.ts#runnerBridgeLifecycleState`（`PENDING→STATE_EVALUATION→EXTEND/NORMAL_EXIT`）**未被引擎调用**；引擎唯一消费点 `engine.ts` 的 `runnerBridgeExtendedToBySecurity` 是**函数局部 Map**，除平仓 `delete` 外**不写审计、不进任何记录字段**。`Trade.reason` 仅在**真的走到** 74 日时留 `` `Runner Bridge持有满74个交易日` `` 字符串；`audit.fills` **无 `reason` 字段** | 003 **如实报告不可观测**（目标 §5 明确允许「没有观测接口则报告不可观测，不能用最长持仓反推没触发」）：只报「持有到 74 日的笔数」，并显式声明 (i) 触发 / (ii) 触发后提前退出**无法区分**；**不改 `Trade`**（避免执行语义面变更，见 §3） |
| 4 | 非配对日期重采样 | **REAL** | `shared/dateClusterBootstrap.ts#movingBlockBootstrapDifference` 的 `resampleMean(positive,…) − resampleMean(negative,…)` **每次各自抽块起点**；两臂 `clusterize()` 的日期宇宙不同；返回对象**不含 `quantiles`** ⇒ 置信水平无法自证 | 003 新增**配对**函数（共享块索引 + 分子/分母同步 + `zeroDenominatorIterations` + 回写 `quantiles`），**旧函数逐字节不变**（现有 3 个调用点零漂移） |
| 5 | 年度判据用错靶 | **REAL 且实质性改变裁决路径** | `judgeVerdict` 的 `positiveYears` 比较的是 `rReturnPct`（**账户年度权益收益**）vs `randomMedianReturnPct`，而事前主判据是 **≥+20% 已平仓比例差**。002 实测两者方向确实不同（2024 R −6.7777% vs 中位 −6.5905%；2025 R +2.3419% vs 中位 −13.7433%） | 003：`YearlyComparisonRow` 增补分年**尾率靶**字段，同向判据改用 `tail20RateDifference > 0`，且**只用 2024/2025**；账户年度收益移到另报表 |
| 6 | 正常期末持仓等同数据不足 | **REAL** | `isDataCoverageBlocked(trade) = trade.openAtEnd === true`；而 `portfolio.ts#finalizeOpenTrades` 对所有未平仓统一 `reason = "回测结束仍持仓"`（常量，**不区分原因**） | 003：三分（`MTM_VALID` / `NO_EXECUTION_BAR` / `SUSPENDED_CANNOT_SELL`）+ **显式声明为启发式**（引擎不暴露该区分），不把有效期末 MTM 计入数据缺口 |
| 7 | 报告与正式产物不一致 | **REAL（4 处漂移 D1–D4）** | D1 随机均值 `−6.40%` 不可复现（产物全窗 mean **−17.9033%** / p50 **−18.8096%**）；D2 文档写「97.5%」实为 **95% 双侧**（且载荷无 `quantiles` 无法自证）；D3 「Runner 从未触发」超出载荷支持（见 #3）；D4 未披露该原语**非配对** | 已按 AGENTS §2 登记 `BASELINE_DRIFT` 并**就地更正 `RESULT-…-002.md`（新增 §15 更正记录）**；**历史 Run 不回填、产物不改** |

### 1.1 两条架构决策（避免不必要的授权往返）

**决策 ①：E 组的次数键 → 用平台**自己的**事件作用域身份，不改引擎。**

```
securityId := sec_<uuid>::event:<symbol>@<eventDate>     （server/eventIdentity.ts#eventScopedSecurityId）
```

- `server/research/panelIdentity.ts#panelCodeOf` 会把 `::event:` 剥回**代码** ⇒
  `maxConcurrentOpenPerCode = 1` 仍然表达「**同真实股票并发上限 1**」（含跨锚点）；
- `maxEntriesPerMember = 1`（仅 E 组）恰好表达「**同锚点最多一次成功建仓**」；
  合法锚点切换后是新事件身份 ⇒ **不会被误伤**（目标 §3.1/§3.3 的红线）；
- 这是**平台既有约定**（`datasetFromRegistry.ts` 与组合执行面都用它）。
  round-002 改用 canonical **base id** 才是偏离——它为了补上「同股并发」而牺牲了「按锚点计数」的表达能力。
- ⇒ **零契约改动、零引擎改动**。实测 A/B/C/D = `{cooldown:null, maxEntriesPerMember:null, maxConcurrentOpenPerCode:1}`；
  E = `{cooldown:null, maxEntriesPerMember:1, maxConcurrentOpenPerCode:1}`。

**决策 ②：Runner/覆盖口径 → 报告不可观测，不改 `Trade`。**

目标 §5 已明确允许「没有观测接口则报告不可观测」。改 `Trade` 属**执行语义面**
（`server/backtest/*`、`server/engine/*`、`shared/researchContracts.ts` zod、
`simulator/{types,validate,serialize}` 与运行指纹语义版本需同步），
按 AGENTS §5 需先出影响分析并取得**明确授权**。本轮**不改**，改为如实披露 + 启发式三分。

> 这两条决策把「需要授权的项」从 3 个降到 **1 个**（只剩数据构建，见 §2.4）。

---

## 2. S2 · 数据与协议冻结

### 2.1 Dataset 真实坐标（只读核验）

| 项 | 实测 |
|---|---|
| `datasetVersionId` | **780004** |
| `datasetCode` / label / 状态 | `first_limit_pullback` / `v10-listed365-pre10-post80` / **READY** |
| 事件区间 / 事件数 / 总行数 | `2019-01-02` ~ `2025-09-26` / **58,983** / **10,320,499** |
| 构建口径（`filterDefinitionJson` 原文） | `{builder:"first_limit_pullback", configVersion:1, events:[{rd:0,kind:"firstBoard"}], preWindowDays:10, **postWindowDays:80**, pathHorizon:80, outcomeHorizons:[5,10,20], batchSize:1000}` |
| 宇宙口径（`universeDefinitionJson` 原文） | `{universe:"all-a-shares", source:"stock_daily_prices", boards:["main"], excludeSt:true, excludeListedWithinDays:365}` |
| post 覆盖 | `relativeDay = 1..80`，**每层恒 58,983 行**（无缺口）；物理日历最晚 `2026-01-28` |
| 主决策窗口 | 2024-01-02 ~ 2025-09-30（**已观察过的历史窗口，属探索性续研，不是新 OOS**） |

### 2.2 五组矩阵（**冻结**）

| 组 | N | L | 确认日 d | 最早成交 | 再入场政策 | 用途 |
|---|---:|---:|---|---|---|---|
| A | 2 | 10 | 3..9 | T+4 | SIGNAL_REENTRY | 原期限参照（**已允许再入场**，故**不是** 002 的精确重跑） |
| B | 2 | 20 | 3..19 | T+4 | SIGNAL_REENTRY | 只观察**期限延长**的影响 |
| C | 3 | 20 | 4..19 | T+5 | SIGNAL_REENTRY | 三日观察对照 |
| D | 5 | 20 | 6..19 | T+7 | SIGNAL_REENTRY | 五日观察**主配置** |
| E | 5 | 20 | 6..19 | T+7 | **SINGLE_ENTRY** | 与 D 同买点，量化**禁止再入场**的代价 |

**不变项**（目标 §3.2 明令）：`0.98·O_0` 守线、`0.50·V_0` 缩量、四项等权、`S_j >= 3`、
**突破参照恒为前两日高点**（不随 N 变）、池 rd1..40、TopK 3、
方向 `preReturn10 HIGH`、200 固定种子（`20261010 + i`）、五组各 201 账户 = **1005 个独立账户**。

### 2.3 🔴 执行尾部覆盖（**本轮唯一的数据门禁**）

T+20 入场 + 74 日 Runner 的真实视界（**按真实引擎计数核验，非代理**）：

```
成交 rd_f <= L = 20
持有日 k 对应 rd = rd_f + (k - 1)          （持有日 1 = 成交日；portfolio.ts#holdingDaysBetween = max(1, x-e+1)）
Runner 上界 74 ⇒ 最远 rd = 20 + 73 = 93    （rd93 收盘出信号，NEXT_OPEN 于 rd94 成交）
再加平台自身 +20 不可卖顺延约定 ⇒ 约 rd 114
```

| 项 | 值 |
|---|---|
| 引擎可读 `maxRd` 公式 | `endRd + 1 + exitTailTradingDays`（`datasetFromRegistry.ts#createEventWindowDatasetCursor` 等三处同一口径） |
| 策略需要的 post 上界 | **≥ rd94（rd95 安全；保留 +20 顺延则 rd114）** ⇒ `exitTailTradingDays ≥ 74` |
| 780004 实际提供 | **rd 80** ⇒ `rd80 = 持有日 61`，**距 74 差 13 个持有日** |
| 构建契约上限 | `server/datasetRegistry/filter.ts#postWindowDays = {min:1, max:120}` ⇒ 95 / 114 **均合法** |

**两组独立数字（实测）**：

| 口径 | 值 |
|---|---|
| 主窗口事件数（2024-01-02~2025-09-30） | **18,431**（2,827 只股票；数据集最晚事件 2025-09-26，故窗口末日无事件） |
| rd80 行存在率 | **100%** |
| 在 780004 **自身封存日历**内可走到 rd95 的事件 | **17,800 / 18,431 = 96.58%** |
| **在封存日历内被截断（够不到 rd95）** | **631 / 18,431 = 3.42%**；截断分界 = **2025-09-05**（其 rd80 = 2026-01-07），首个被截断事件日 = 2025-09-08 |
| 字面口径「rd80 < 2026-01-28」 | 18,396 / 18,431 = **99.81%**（其余 35 个事件 rd80 恰为 2026-01-28） |

🔴 **关键澄清（避免把版本边界误当成数据边界）**：`2026-01-28` **只是 780004 自己的封存上界**
（= 最晚事件 2025-09-26 + 80 个交易日），**不是原始行情边界**。
`stock_daily_prices` 覆盖 `2019-01-02 ~ 2026-10-09`（1,882 个交易日），**在 2026-01-28 之后仍有 165 个交易日**
⇒ **全部 58,983 个事件物理上都能拿到 rd81..95**，只是 780004 的 post 表没有落这些层。
⇒ 因此「截断」是**版本深度问题**，不是数据源问题；构建新版本可以让**所有**主窗口事件都拿到 rd95。

⚠️ **不能用「002 实测最长持仓 17 日」推断足够**（目标 §5 明令）——
002 的 `runnerExtensionReachedTrades = 0` 只说明「没有一笔持有到 74 日」，
且 **Runner 是否触发本身不可观测**（§1 #3）。**必须按真实引擎计数在 S5 预检里实测**。

**与本实验读取路径的关系**：本实验经 **Dataset 端口** `context.dataset.observation(rd)` 读行情
（该路径**无容量守卫**，越界返回 `[]`），再把行封成 `ResearchDataset` 交给 `runTradeSimulation`。
因此平台游标路径上的第二个限制（`resolveEventWindowExitTailTradingDays` **不读 `runnerBridge.extendToHoldingDays`**
⇒ 官方装配的派生根窗为 30 → `maxRd = endRd+31`）**不作用于本实验**；
它只影响经 `createEventWindowDatasetCursor` 的路径。**本实验的视界完全由自己声明的 `postRelativeDays` 决定。**

### 2.4 新 Dataset 构建影响（**需要单独授权；未获授权前不构建**）

| 项 | 内容 |
|---|---|
| 来源版本 | 780004（`firstLimitPullback`，`configVersion:1`，`dataset_build_config.id=510004`） |
| 拟改字段 | `postWindowDays: 80 → 95`（**建议 `pathHorizon` 保持 80**：目标 §6 要求「只有执行尾部延长」；同时抬高会再加 ≈385 MB） |
| 事件一致性 | 宇宙与事件口径**逐字节不变** ⇒ 事件集合仍为 **58,983**（可验证：集合差 = 0） |
| 特征一致性 | `preWindowDays:10` 不变 ⇒ prefix（rd−10..0，647,287 行）**逐字节不变**（可验证） |
| 新增行数 | **15 层 × 58,983 = 884,745**（每层结构上恰好 58,983 行；post 由 4,718,640 → 5,603,385） |
| 总行数估计 | 10,320,499 → **11,205,244**（+8.6%） |
| 存储估计 | `information_schema` 实测 `ds_first_limit_pullback_post` ≈ **513.9 B/行**（279.9 B data + 234.0 B index）⇒ **≈ 455 MB**（数据 ≈248 MB + 索引 ≈207 MB） |
| 预计耗时 | 按增量 15/80 估计 ≈ 原构建的 19%（原构建耗时应以 `dataset_build_job` 日志为准；780004 行的 `createdAt/completedAt` 时钟注记异常，不作为依据） |
| 写入范围 | **新增** `dataset_version` 一行 + `ds_first_limit_pullback_post`（及 `_path`/`_outcome` 若同步）的**新版本行**；**不改** 780004 任何行、不改 schema、不删数据 |
| 验证方案 | ① 事件集合差 = 0；② prefix rd−10/0 **逐行相等**；③ **post rd1..80 与 780004 逐行相等**（内容一致性硬证据）；④ rd81..95 每层行数 = 58,983；⑤ 覆盖到 2026-10-09；⑥ `status=READY` 后才可用于正式 Run |
| 回滚方案 | 新版本行独立存在；回滚 = 不使用该 `datasetVersionId`（可再标 `RETIRED`），**780004 不受影响** |
| 授权问题 | 🔴 **请明确授权「按上述配置构建 `postWindowDays=95` 的新数据集版本」**；未获授权则**不构建**，并按 §2.3 在 S5 预检中**实测实际缺口**：若实测无任何一笔需要 rd>80，则以证据说明已执行的政策被数据完整支持；若实测有，则**停在授权问题**并如实报告受影响笔数与组别 |

### 2.5 P3 入选边界分辨力预检项（冻结）

对**最终触发候选池**（不是池成员）逐组报告：不同取值数、最大取值占比、边界并列规模、破平键及含义。
若排序实质由任意破平键决定 ⇒ **停止排序效应实验并报告**，不临时换因子。

### 2.6 协议指纹与可重放性

- 旧版本重放：`rolling-pool-early-entry-runner`（002）与 `rolling-pool-right-tail-mvp`（001）**保持可精确重放**——
  规则库的 `N`/`L` 走**可选入参 + 缺省 = 旧值**；`PoolBar.amount` 为纯增量字段（旧实验不声明 ⇒ 恒 `null` 且不读）。
- 全矩阵在**一个正式 Run** 内执行，保存各组完整指标、交易账、权益账与再入场账。

---

## 3. 本轮**不做**（边界声明）

- ❌ 不改 `server/**` 的任何执行语义（含不改 `Trade`）；两处需要的可观测性按目标 §5 **报告为不可观测**。
- ❌ 不构建新 Dataset（**等 §2.4 的授权**）；不改 780004；不在 rd80 强平；不用最后价格伪装当日行情；不事后剔除长持仓股票。
- ❌ 不改历史 Run、旧实验版本、不可变策略版本；不回填 002 产物。
- ❌ 不追加 4 日/7 日/T+30 或任何参数搜索；矩阵冻结为 A–E 五组。
