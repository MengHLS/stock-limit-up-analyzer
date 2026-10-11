# AUDIT · `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004` S1 基线 / 性能 / 状态覆盖审计

> 执行对象：[`GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`](GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md) §8 的 S1 行
> 性能方案：[`PLAN-ROLLING-POOL-EXECUTION-PERFORMANCE-001.md`](PLAN-ROLLING-POOL-EXECUTION-PERFORMANCE-001.md)
> 研究依据：[归因报告 §14](RESULT-FIRSTBOARD-ROLLING-POOL-LOSS-ATTRIBUTION-001.md#14-结果复核与结论边界2026-10-11)、[003 协议](GOAL-FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003.md)、[003 真实结果](RESULT-FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003.md)
> **本审计只读**：无代码改动、无 DDL/DML、无新 Dataset、无实验 Run。全部探针为 `SELECT`/`SHOW`，落在 `_scratch/fbp4/`（gitignored）。
> 定位一律用「路径 + 符号名」；行号仅作辅助（`server/**` 高频编辑，行号漂移不算 drift）。
>
> **版本说明**：本文件在并发会话已落盘的 S1 草稿基础上**独立复核并扩写**。原草稿的 E1/E2/E3 结论经复核**成立**；
> 其中「948 格矛盾未解释」一项本轮**已定位到具体代码机制**（见 §1.5），并**修正**了一处关于端口越界行为的描述（见 §4.4）。

---

## 0. 结论先行

| 项 | 结论 |
|---|---|
| **ST 闸门** | 🔴 **`INSUFFICIENT`** —— 目标 §4 要求的两个检查时点（确认日收盘 / 真实成交前）**都不存在可 PIT 核验的 NORMAL 或 ST 结论** |
| **收益矩阵** | 🔴 按目标 §4 默认条款 **SUSPENDED**：不得用「大面积 UNKNOWN 拒单导致的空仓结果」评价新买点 |
| **行情尾部** | 🟢 本轮 42 账户矩阵**沿用现有证据足够**（上一轮真实引擎计数零暴露），但**不得**在 rd80 强平 / 补最后价 / 事后剔除长持仓 |
| **性能** | 🟡 有端到端实测（2,013,888 ms / 1,005 账户），**没有**阶段级分解 ⇒ 不得承诺任何倍数提速 |
| **最小 Scope** | 已给出（§6）；`server/**` 执行语义、001/002/003 实验、策略 3600005 **不得改动** |

---

## 1. 🔴 ST 硬闸门判定（最高优先级）

### 1.1 判定：`INSUFFICIENT`

目标 §4 要求「所有实际成交必须带状态证据，ST/*ST 成交数和无证据成交数均为 0」。
实测：**该证据在平台内不存在**，且在两种读法下分别归零：

| 读法 | 可核验 NORMAL 的格 | 可核验 ST 的格 | 结果 |
|---|---:|---:|---|
| **全知视角**（`asOf = null`，＝现有构建路径 `resolveStSync` 的做法） | **0 / 1,201,475 = 0.00%** | 30,855 / 1,201,475 = 2.57% | 97.43% 只能记 UNKNOWN ⇒ 全部拒单 ⇒ 空仓 |
| **严格 PIT**（`asOf = 检查时点`，目标 §4 要求的读法） | **0 = 0.00%** | **0 = 0.00%** | 100% UNKNOWN ⇒ 全部拒单 ⇒ 空仓 |

两种读法都不可用：**全知视角漏掉 97.43% 的 NORMAL 证据（会放行真 ST 日）**；**严格 PIT 一个结论都给不出**。

### 1.2 证据表（全部实测，来源见括号）

| # | 证据 | 实测值 | 来源 |
|---|---|---|---|
| E1 | `research_security_status_history` 中 `statusType='ST'` 的行 | **841 行 / 734 symbols** | `_scratch/fbp4/stProbe1.out.json` |
| E2 | 上述 841 行的 `statusValue` 分布 | **全部 `ST`；`NORMAL` = 0 行；`*ST` = 0 行** | 同上 |
| E3 | 上述 841 行的 `availability` 分布 | **全部 `UNKNOWN`（841/841）**；`confidence` 全部 `medium`；`source` 全部 `baostock-daily` | 同上 |
| E4 | 上述 841 行的 `retrievedAt` 范围 | **`2026-09-06 19:07:53` ~ `2026-09-09 03:01:59`**（`createdAt` 同为 2026-09-06..09） | `stProbe1` / `stProbe5` |
| E5 | `retrievedAt <= 2025-09-30`（窗口内可获知）的 ST 行 | **0** | `stProbe3` `stKnowableInWindow` |
| E6 | 主窗口（2024-01-02 ~ 2025-09-30，`index_daily` 实测 **425 个交易日**）× 主窗口事件宇宙 **2,827 symbols** 的 (symbol, date) 格 | **1,201,475 格**；身份可解析 1,191,913（99.20%），无身份 9,562（0.80%） | `stProbe2` `cellCoverage` |
| E7 | 其中**确有 ST 区间生效**的格 | **30,855 格 = 2.57%** | 同上 |
| E8 | 其中**无任何 ST 区间**的格（⇒ 只能 UNKNOWN） | **1,170,620 格 = 97.43%** | 同上 |
| E9 | 主窗口 2,827 symbols 中**没有任何 ST 行**的 | **2,378 个 = 84.05%**（有 ST 行 449 个） | `stProbe2` `universeStSymbols` |
| E10 | 严格 PIT 复现（真实代码）：`getSecurityStatus(sec_d60a7a54…, '2025-04-30', {asOf:'2025-04-30'})` | `resolved.ST = undefined`，`ST ∈ unknownDimensions` | `_scratch/fbp4/resolveProbe.out.txt` |
| E11 | 同一格 `asOf = null` | `resolved.ST = {statusValue:"ST", effectiveFrom:"2025-04-30", effectiveTo:"2026-09-04"}` | 同上 |
| E12 | 真实构建解析器（预热后）`DbDatasetBuildIO#resolveStSync('600519.SH','2025-06-02')` | **`UNKNOWN`**（不是 `NORMAL`） | `_scratch/fbp4/coldIndexProbe.out.txt` |
| E13 | 重叠主窗口的 ST 区间规模 | 313 行 / 310 symbols；区间长度 min 43 / max 4,269 / avg 703.7 天 | `stProbe3` |
| E14 | ST 维度 `NORMAL` 行总数（全表） | **0** | `stProbe2` `normalRows` |

**E10 是决定性的**：`server/securityStatus/pointInTime.ts#statusKnowledgeDate` 对 `availability === "UNKNOWN"` 回退到
`interval.retrievedAt.slice(0,10)`，而全部 ST 行的 `retrievedAt` 都在 **2026-09**。
`server/securityStatus/timeline.ts#resolveSecurityStatus` 在 `asOf !== null` 时用
`server/securityStatus/pointInTime.ts#isKnowableBy` 逐条过滤 ⇒ **只要 `asOf` 落在研究窗口内，每一条 ST 区间都被剔除**。
⇒ 严格 PIT 下 `resolved.ST` 恒为 `undefined`，`ST ∈ unknownDimensions`。按目标 §4「未知拒绝」，**任何候选都无法通过资格检查**。

**E12 是第二个致命点**：即使退让到「全知视角」，`DbDatasetBuildIO#resolveStSync` 也**永远不可能返回 `NORMAL`** ——
它走 `stValueToStStatus(snapshot.resolved.ST?.statusValue)`，而 ST 维度从未写入 `NORMAL` 行（E14、E2）。
所以「历史 NORMAL 要求」在现有数据下**没有满足路径**：要么 `ST`（拒单），要么 `UNKNOWN`（拒单）。

### 1.3 逐日 ST 状态的精确 API 契约（目标 §4 第 1 项要求）

| 入口（路径 + 符号名） | 输入 | 输出 | 未知时的行为 |
|---|---|---|---|
| `server/securityStatus/timeline.ts#resolveSecurityStatus` | `intervals`、`securityId`、`date`、`options?{asOf, calendar}` | `SecurityStatusSnapshot` | 无已知数据的维度进入 `unknownDimensions`，**不默认填充** |
| `server/securityStatus/persistence.ts#getSecurityStatus` | `securityId`、`date`、`options?{asOf}` | `SecurityStatusSnapshot` | DB 不可用 ⇒ 全未知快照（不抛错、不伪造） |
| `server/securityStatus/persistence.ts#isTradable` | 同上 | `boolean` | `server/securityStatus/timeline.ts#isTradableFromSnapshot`：TRADING 维度缺失或 ≠ `TRADING` ⇒ **`false`** |
| `server/securityStatus/persistence.ts#getSecurityStatusIntervals` | `securityId` | `SecurityStatusInterval[]`（升序） | DB 不可用 ⇒ `[]` |
| `server/securityStatus/persistence.ts#getSecurityStatusIntervalsInRange` | `securityId`、`from`、`to` | 区间重叠集合 | 同上 |
| `server/securityStatus/pointInTime.ts#statusKnowledgeDate` | `interval`、`calendar?` | 可知日 / `null` | `UNKNOWN` 且无 `retrievedAt` ⇒ `null`；`T_PLUS_1` 无日历 ⇒ `null`（fail-safe） |
| `server/securityStatus/pointInTime.ts#isKnowableBy` | `interval`、`asOf`、`calendar?` | `boolean` | 可知日 `null` ⇒ **`false`** |
| `server/datasetRegistry/db.ts#DbDatasetBuildIO.resolveStSync` | `symbol`、`tradeDate` | `"NORMAL"｜"ST"｜"*ST"｜"UNKNOWN"` | 无区间 / 无身份 ⇒ `UNKNOWN`；**无 `asOf` 参数 ⇒ 无 PIT 过滤** |
| `server/datasetRegistry/db.ts#DbDatasetBuildIO.resolveSuspensionSync` | 同上 | `{status, source}` | 不可判 ⇒ `{status:"UNKNOWN", source:"UNKNOWN"}` |
| `server/runWorkbenchAssembly/poolStIndex.ts#createPoolStIndexFromRows` / `#loadPoolStIndex` | 区间行 / 无 | `PoolStIndex` | 🔴 **`resolve()` 在无区间时返回 `"NORMAL"`** —— 与目标 §4「absence ≠ NORMAL」**直接冲突** |

**语义要点**（写进 S2/S3 必须遵守）：
1. `server/securityStatus/types.ts#STATUS_VALUES.ST = ["NORMAL","ST","*ST"]` 并注明「NORMAL 也必须是显式记录，无记录 ≠ NORMAL」；`SecurityStatusSnapshot.unknownDimensions` 是唯一权威的「不知道」出口。
2. `availability` 三值 `IMMEDIATE / T_PLUS_1 / UNKNOWN` 刻意区分「生效 / 可知 / 采集」；`SecurityStatusInterval.retrievedAt` 的注释是「何时写入本行」，**不是**公告时间。
3. `server/securityStatus/baostockStatus.ts#inferStIntervals` 只由 `isST === 1` 的连续段生成 ST 片段，`availability` 硬编码 `UNKNOWN`、`confidence` 硬编码 `medium`；**它不产生 NORMAL 片段**，所以「无 ST 片段」在数据上等价于「未知」。
4. `server/securityStatus/baostockStatus.ts` 的模块注释已自认：`tradestatus`/`isST` 是 provider 权威字段，但**合并成区间是 gap inference**，区间边界（含公告生效日）无法仅凭日线确定。
5. `server/securityStatus/suspensionAdapter.ts#suspensionWindowsToStatusIntervals` 同样是 `availability: "UNKNOWN"`、`retrievedAt: null`。

### 1.4 实验真正会走到的 ST 读路径（目标 §4 第 2 项要求）

**结论：实验侧目前没有任何 ST 读路径。** 端口面**完全没有**状态维度。

| 环节（路径 + 符号名） | 签名 / 语义 | ST 事实 |
|---|---|---|
| `server/researchExperiments/datasetPort.ts#createRegistryExperimentDatasetPort` → `ExperimentDatasetAccess` | `events()` / `eventPages()` / `feature(rd)` / `observation(rd)` | 只暴露 `ds_first_limit_pullback_{event,prefix,post}` 三表；**无 ST 维度** |
| `server/researchExperiments/rollingPoolExecutionSupport.ts#sealRollingPoolExecutionDataset` → `toRow` | 把投影行封成 `ResearchDataset` | 🔴 **`st: "UNKNOWN"` 硬编码**（注释自认「逐日 ST 事实不在 Dataset 端口内」） |
| `server/runWorkbenchAssembly/datasetFromRegistry.ts#projectEventRow` | Registry 事件行 → `ResearchDatasetRow` | 🔴 **`st: "UNKNOWN"` 硬编码**（`lifecycleVerdict` 同样 `UNKNOWN`） |
| `server/research/compositeRunner/index.ts`（行 810 附近） | 合成执行面行 | 🔴 **`st: "UNKNOWN"` 硬编码** |
| `server/datasetRegistry/db.ts#DbDatasetBuildIO.resolveStSync` | 构建期 PIT ST | 4 个调用点全在**构建期**，实验侧不可达 |
| `server/datasetRegistry/builder.ts#buildEvents` | 调用 `resolveStSync`：涨停比例判定、`isStExcluded`、事件行装配 | 仅构建期 |
| `server/datasetRegistry/builder.ts#buildWindowsAndOutcomes` | 调用 `deriveExecutionFacts({stStatus})` 填 post 行 | 仅构建期 |
| `server/researchDataset/assemble.ts`（`st: state.tradability.st`） | 唯一能把真实 ST 写进 `ResearchDatasetRow` 的地方 | 走 `researchDatasetRouter` 建库路径，**不是**实验端口 |
| `ResearchDatasetRow.st` 的消费者 | `server/researchDataset/universe.ts`（`excludeSt`）、`server/researchDataset/tDayFilter.ts`、`server/researchDataset/pullback.ts`、`server/runWorkbenchAssembly/poolProjection.ts` | 读到的恒为 `UNKNOWN` |
| `server/datasetRegistry/executionFacts.ts#deriveExecutionFacts` | 收 `stStatus`，**只用于 `limitUpRatio`** 推导涨跌停价 | 目标 §4 的警告成立：`canBuyAtOpen` **只有停牌 + 开盘涨停语义**，与 ST 无关 |
| `server/datasetRegistry/filter.ts#isStExcluded` | `st === "ST" ｜｜ st === "*ST"` 才剔除 | `UNKNOWN` **放行** ⇒ 事件级「非 ST」只是「非*已知* ST」 |

⇒ **S3 必须新增一个只读状态投影/执行资格接口**（目标 §4 明确授权），并显式记录契约版本与缺省旧行为。

### 1.5 🔴 新发现：948 格矛盾的根因已定位（原草稿记为「未解释」）

**现象**：主窗口 366,910 个「rd 1..20 检查格」中，**948 格**落在平台 ST 历史判定确属 ST 的区间内，
但这 948 格的 `ds_first_limit_pullback_post.limitRuleUp` **全部为 0.1（10%）**、`canBuyAtOpen` 存在且为 1。
整个主窗口 1,429,771 行 post 的 `limitRuleUp` **全部 0.1**，`suspensionStatus`/`suspensionSource` **全部 `UNKNOWN`**。

**根因（代码机制，可复现）**：

```
server/datasetRegistry/builder.ts#build
  checkpoint.phase === "windows"
    ? (await this.io.listEvents(...)).length      ← 跳过 buildEvents
    : await this.buildEvents(...)                  ← 只有这条分支里才有 loadSecurityIndexes()
```

* `await io.loadSecurityIndexes()` **唯一**出现在 `server/datasetRegistry/builder.ts#buildEvents` 内
  （`server/datasetRegistry/builder.ts` 的 `DatasetBuildIO` 契约注释也要求「必须在任何 `resolveStSync` 之前调用一次」）。
* `server/datasetRegistry/builder.ts#buildWindowsAndOutcomes` **不调用**它。
* `server/datasetRegistry/db.ts#DbDatasetBuildIO` 的 `readyIndex` 是**实例级**状态；未预热时
  `syncedIndex === null` ⇒ `activeSecurityId` 恒 `null` ⇒ `statusIntervalsFor` 恒 `[]` ⇒
  `resolveStSync` 恒 `UNKNOWN`、`resolveSuspensionSync` 恒 `UNKNOWN`、`resolveListingAgeDaysSync` 恒 `null`。
* `server/datasetRegistry/builder.ts#buildWindowsAndOutcomes` 的续跑跳过条件是
  `event.tradeDate <= resumeTradeDate` ⇒ **续跑点之前、由带索引的那一轮写下的行不会被覆盖**。

**实证（全部只读）**：

| 观测 | 结果 | 来源 |
|---|---|---|
| 未预热 `DbDatasetBuildIO#resolveStSync` | `600265.SH@2025-04-30` / `600289.SH@2025-05-06` / `000752.SZ@2025-06-02` / `600519.SH@2025-06-02` **全部 `UNKNOWN`**；`resolveSuspensionSync` 全部 `UNKNOWN`；上市龄全部 `null` | `_scratch/fbp4/coldIndexProbe.out.txt` |
| 预热后同一批 | `600265.SH@2025-04-30 → ST`、`600289.SH@2025-05-06 → ST`、`000752.SZ@2025-06-02 → ST`；停牌 `NOT_SUSPENDED/PIT_STATUS` | 同上 |
| 落库的 post 行 | `600265.SH` 在 `2025-04-30`、`05-06`、`05-07`…（均在 `2025-04-30 → 2026-09-04` ST 区间内）**全部 `limitRuleUp = 0.1`** | `stProbe8` `p600265_2025` |
| `000004.SZ`（§14.5 要求 1 的场景） | ST 区间 `2025-04-30 → 2026-06-22`；rd11..22 的 post 行 `limitRuleUp` **全部 0.1**、`canBuyAtOpen = 1` | `_scratch/fbp4/verify000004.mjs` |
| 全库 5% 涨跌停带 | 仅 **7,368 行 / 61 symbols / 2019-01-23 ~ 2019-08-28**；其余 4,711,272 行全 10% | `stProbe3` `postRuleMix780004` |
| 时间线 | 780004 全部 event/post/prefix 行 `createdAt` 均为 **2026-10-08**；ST 行 `createdAt` 为 **2026-09-06..09**（更早） | `stProbe8`、`stProbe5` |
| 构建作业 | `dataset_build_job`：`900007`/`900009` **FAILED**（insert 失败），游标 `phase:"windows"`、`lastTradeDate:"2019-04-02"`；`900010` **COMPLETED** `08:41:38 → 09:13:48`，`totalChunks 60,620`、`completedChunks 58,983`、`processedRows 10,261,516` | `stProbe7` |

**解释**：`2019-01-23 ~ 2019-08-28` 的 5% 行 = 早先**跑过 Phase 1（带索引）**的那一轮写下的；
`lastTradeDate = 2019-04-02` 的事件的 rd80 窗口恰好延伸到 ~2019-08-28，与 5% 行的日期上界吻合。
此后从 `windows` 断点续跑的 COMPLETED 作业**没有 `loadSecurityIndexes()`**，
于是续跑点之后的每一行都退化为 10% / `UNKNOWN`。

**诚实边界**：我**没有**重跑一次构建来逐行归属「哪一轮写了哪一行」，因此上述是
「**与全部观测一致且机制可复现**」的定位，不是逐行证明。**但结论不受影响**：
无论根因归属如何，**落库的 780004 执行面字段与平台 ST 历史互相矛盾，不可用作 ST 证据**。

**对 004 的影响（重要）**：这不是「旧数据有点脏」而已 ——
* `server/datasetRegistry/builder.ts#buildEvents`（事件级 `excludeSt`）**用的是带索引的那一轮结果**，所以 58,983 个事件
  的 `limitRuleUp` 全为 0.1、事件日确实非已知 ST；**事件宇宙是可信的**。
* 但 post 行的 `limitRuleUp` / `canBuyAtOpen` / 停牌字段**整体不可信**（主窗口 1,429,771 行）。
* 因此「用 `limitRule` 当逐日 PIT ST 指示器」这条替代路线被**彻底证伪**（原草稿的结论，本轮独立复核成立）。
* 且这是一条**构建期静默降级**：`server/datasetRegistry/builder.ts#build` 在跳过 Phase 1 时
  没有任何断言/告警要求索引已就绪。属 S3 应修的最小健壮性缺口（**本轮不修**，只登记）。

### 1.6 补数影响报告（需另行授权的数据引入）

| # | 要求 | 现状 | 影响 |
|---|---|---|---|
| 1 | 每个 (securityId, tradeDate) 有**显式 NORMAL 或 ST** 结论 | ST 维度 `NORMAL` 行 = **0** | 「历史 NORMAL required」无满足路径 |
| 2 | 结论带**可获知时间**且 ≤ 检查时点 | 841/841 行 `availability=UNKNOWN`，`retrievedAt` ∈ 2026-09 ⇒ 严格 PIT 下 **0** 条可知 | 资格检查与成交前检查都无法成立 |
| 3 | 覆盖具备**穷尽性证据** | 主窗口 97.43% 的格无 ST 区间；2,378/2,827（84.05%）symbol 无任何 ST 行 | absence ≠ NORMAL；这些格只能记 UNKNOWN |
| 4 | 区分 **生效时间 / 公告可获知时间 / 采集时间** | 只有 `effectiveFrom/To` + `retrievedAt`（单批采集） | 目标 §4 明令禁止把 `retrievedAt` 当历史公告时间 |
| 5 | 解释并修正 **948 格矛盾**与主窗口 5% 带整体缺失 | 根因已定位（§1.5），未修 | 现有 `limitRule*` 不可作 ST 代理；需重建或补写 |
| 6 | 决定无覆盖 symbol 的处置 | 未定 | 目标 §4：用户确认接受特定覆盖子集后**须另冻版本、披露删样本影响** |

**需要什么数据 / 从哪里来 / 多少行 / 如何证明**：

1. **数据**：逐 (证券, 交易日) 的 ST 状态观测，字段至少
   `securityId, tradeDate, statusValue ∈ {NORMAL, ST, *ST}, effectiveFrom, effectiveTo, source, announcedAt, availableAsOf, confidence, evidenceFingerprint`。
2. **来源**：交易所（SSE/SZSE）逐日 ST/特别处理名单与实施公告（含公告日期）；或
   BaoStock `query_history_k_data_plus` 的权威字段 `isST` + `tradestratus`（平台已有 provider：
   `server/marketData/providers/baostockSession.ts`）。**注意**：`stock_daily_prices` 的列
   （`openPrice/closePrice/preClosePrice/lowPrice/highPrice/volume/amount`）**不落 `isST`**，
   所以不能从平台自有行情表重推 —— 必须新取数。
3. **规模估算**：
   * 主窗口最小可行集：**2,827 symbols × 425 交易日 ≈ 1.20M** 个逐日观测；
   * 覆盖 780004 全事件宇宙（3,248 symbols，2019-01-02 ~ 2025-09-26 约 1,650 交易日）：**≈ 5.4M** 个观测；
   * 若改为「显式 NORMAL 区间」压缩存储：主窗口需 `ST 区间数 + NORMAL 区间数` ≈ 313 + ~500 ≈ **千行级**即可覆盖
     （但**必须**同时正确填写 `availability`，否则严格 PIT 仍然归零 —— 见 §1.5/E10）。
   * 落库方式二选一：**(a)** 扩展现有 `research_security_status_history`（**无需 DDL**，只需补写 NORMAL 行 +
     正确的 `availability`）；**(b)** 新增逐日状态表（**需 DDL + 批量 DML ⇒ 目标 §1 要求另行影响报告与明确授权**）。
4. **什么验证能证明它**：
   * 对主窗口全部 (symbol, date) 格做穷尽性断言：`UNKNOWN 格 = 0`，且每格带非空 `availableAsOf ≤ 检查时点`；
   * 独立预言机交叉验证（抽样比对交易所公告日期 vs `effectiveFrom`，并核对 `announcedAt` 与 `availableAsOf` 的先后）；
   * 与 `server/data/boardRules.ts#resolveLimitRulesAt` 对账：ST 格必须得到 5% 涨跌停比，并与重建后的 post 行一致；
   * 在**同一冻结输入**上重跑 ST 闸门，断言「ST/*ST 成交数 = 0 且无证据成交数 = 0」且**非空组合**。

**⇒ 按目标 §4 默认条款：在补数完成并另行授权前，S5 的 42 账户收益矩阵 SUSPENDED。**

---

## 2. 基线、指纹与工作区

| 项 | 值 |
|---|---|
| HEAD | **`f8b6810347aa5950d1f9b95eaadc73308b68ac21`**（`f8b6810`，2026-10-07 16:43:04 +0800，`docs: 归档区统一入口表（INDEX §11）+ 清理 15 个零字节证据文件`） |
| 工作区 | **203 项 = 35 tracked-modified + 168 untracked**（含并发会话产物；完整清单落 `_scratch/fbp4/git-status.txt`） |
| 本轮改动 | **0** —— 本审计未修改任何受跟踪文件；新增仅 `_scratch/fbp4/**`（gitignored）与本文件 |
| 策略引用 | `strategy_versions.id = 3600005`，版本 `2.0.0`，指纹 `f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfef3c`（沿用目标 §5） |
| 上一轮实验代码指纹 | `exp-code-sha256:0a26c6b2b96beab5a1bf6ecaf45a583c6a2c39b8f2a49a56f46dd18f212901ef`（`RUN-20261010-572243F5`） |

**审计范围内的文件指纹（SHA-256 前 16 hex；`server/securityStatus/**` 8 个文件全部 CLEAN）**：

| 文件 | 指纹 | git |
|---|---|---|
| `server/securityStatus/types.ts` | `e739f0df7c32fa97` | CLEAN |
| `server/securityStatus/validation.ts` | `163aa76ad5a9c41f` | CLEAN |
| `server/securityStatus/pointInTime.ts` | `3e9689ada3951251` | CLEAN |
| `server/securityStatus/timeline.ts` | `48b4ce30854d460d` | CLEAN |
| `server/securityStatus/suspensionAdapter.ts` | `0d5354c8c92b8831` | CLEAN |
| `server/securityStatus/persistence.ts` | `6a9aa268a8ad9146` | CLEAN |
| `server/securityStatus/baostockStatus.ts` | `d6cfc577a63d9c55` | CLEAN |
| `server/securityStatus/index.ts` | `1431b6bdee0dd4f0` | CLEAN |
| `server/datasetRegistry/db.ts` | `97dbcd85a5451b38` | CLEAN |
| `server/datasetRegistry/builder.ts` | `416b4e7c05d4a919` | CLEAN |
| `server/datasetRegistry/executionFacts.ts` | `ce3a29491962c1a8` | CLEAN |
| `server/datasetRegistry/detection.ts` | `9427907dca20fc30` | CLEAN |
| `server/datasetRegistry/filter.ts` | `ff4cdeedb2e8d368` | CLEAN |
| `server/runWorkbenchAssembly/poolStIndex.ts` | `ae6a67f221dad71f` | CLEAN |
| `server/researchExperiments/datasetPort.ts` | `7d8095cb2be4dfa7` | CLEAN |
| `server/researchDataset/assemble.ts` | `c8086995a9b86340` | CLEAN |
| `server/runWorkbenchAssembly/assemble.ts` | `bcaa42b9077fe365` | 🔴 **M**（并发会话） |
| `research-experiments/manifest.ts` | `2c302907815173ed` | 🔴 **M**（并发会话） |
| `server/researchExperiments/rollingPoolExecutionSupport.ts` | `576ee08fe85efc9e` | 🔴 **?? 未跟踪**（003 实现只在工作区） |
| `server/researchExperiments/frozenRunnerExitPolicy.ts` | `85a161e56f57add1` | 🔴 **?? 未跟踪** |
| `tests/tools/rollingPoolObservationWindowRun.mts` | `78a0d7c6470b1a71` | 🔴 **?? 未跟踪** |

**并发会话产物中与本任务直接相关、本轮未触碰的**（`git status --porcelain`）：
`server/runWorkbenchAssembly/{assemble.ts,datasetFromRegistry.ts}`、
`server/datasetRegistry/runner.ts`、`server/research/compositeRunner/index.ts`、
`server/researchExperiments/compositeDatasetProvider.ts`、`server/backtest/{portfolio.ts,context.ts}`、
`server/researchRunRouter.ts`、`shared/researchExperimentsContracts.ts`、
`research-experiments/{manifest.ts,compositeRunnerBridge.ts}`、`client/src/researchExperiments/pages.ts`，
以及未跟踪的 `research-experiments/first-board-pullback/rolling-pool-*/`、
`research-experiments/shared/rollingPool{RightTail,EarlyEntry,LossAttribution,Recovery}/`、
`docs/research/{GOAL,PLAN,PREREG,RESULT,S1}-*` 系列。

> ⚠️ **并发冲突提示**：`docs/research/AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`（本文件）、
> `docs/research/PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`（S2）、
> `research-experiments/shared/rollingPoolRecovery/`（S3 部分实现）与
> `tests/server/researchExperiments/rollingPoolRecoverySt.test.ts`（S3 测试）
> **在本次审计开始前已由并发会话创建**。S1 之外已有进展，编排方需据此协调。

---

## 3. 行情尾部覆盖（目标 §4 第 3 段）

### 3.1 Dataset 坐标（实测）

| 项 | 实测值 |
|---|---|
| 坐标 | `dataset_version.id = 780004`（`datasetId = 120001`），version `v10-listed365-pre10-post80`，`status = READY` |
| 窗口 | `startDate 2019-01-02` ~ `endDate 2025-09-26`；`totalEvents 58,983`；`totalRows 10,320,499` |
| 构建配置 | `dataset_build_config` id `510004`：`excludeSt=1`、`excludeListedWithinDays=365`、`preWindowDays=10`、`postWindowDays=80`、`outcomeHorizons=[5,10,20]`、`batchSize=1000`、`configVersion=1` |
| 构建事件规格 | `dataset_build_config_event` → `relativeDay=0` / `eventKind=firstBoard` |
| 构建板块 | `dataset_build_config_board` → `main`（唯一） |
| **post 相对日** | **rd 1..80**，4,718,640 行 / 58,983 事件 ⇒ `getPostRelativeDayRange(780004) = {min:1, max:80}` |
| prefix 相对日 | rd −10..0，647,287 行 |
| outcome 相对日 | horizon 5..20，176,949 行 |
| 全库 post 上界 | 780001/780002/780003/780004/780005 **全部 rd80** |
| 事件涨停幅度 | 58,983 事件**全部** `limitRuleUp = 0.1`（5% 格 0、20% 格 0） |
| 主窗口事件宇宙 | 2024-01-02 ~ 2025-09-30 内 **18,431 事件 / 2,827 symbols** |

### 3.2 `getPostRelativeDayRange` 类事实与「rd94 vs rd80」

* 实现：`server/datasetRegistry/query.ts#DbDatasetDataReader.getPostRelativeDayRange` = `MIN/MAX(relativeDay)` over
  `ds_first_limit_pullback_post`（另有内存实现与
  `server/datasetRegistry/snapshot/sqliteReader.ts` 同签名实现）。
* 目标 §4：T+20 成交 + 74 日续持 ≈ 需要 **rd94/95**；780004 物理上界 **rd80** ⇒ **缺口 rd81..94 真实存在**。
* **上一轮实测（本轮已独立复核，非采信）**：Run `RUN-20261010-572243F5` 的
  `customPayload.coverage`：

| 字段 | 值 |
|---|---|
| `tradesTotal` / `tradesCompleted` | **232,827 / 232,827** |
| `tradesOpenAtEnd` | **0** |
| `noExecutionBarCount` | **0** |
| `suspendedCannotSellCount` | **0** |
| `mtmValidCount` | **0** |
| `heldToExtendedCapCount` | **0** |
| `runnerBridgeExitReasonCount` | **0** |
| `requiredPostRelativeDayForFullRunner` / `physicalPostMaxRelativeDay` | **94 / 80** |
| `firstObservedTradingDate` / `lastObservedTradingDate` | `2024-01-02` / `2026-01-19` |
| `runnerTriggerObservability` | **`UNOBSERVABLE`** |

* 语义核对（代码级，不靠启发式）：`server/backtest/portfolio.ts#finalizeOpenTrades` 会把期末未平仓交易
  以 `openAtEnd: true` 推入 `completedTrades` ⇒ **`tradesOpenAtEnd = 0` 是「1005 个账户在模拟期末一个未平仓仓位都没有」**，
  不是「分类启发式恰好为 0」。
* `lastObservedTradingDate = 2026-01-19` > `dataset_version.endDate = 2025-09-26`，原因是
  **`ds_first_limit_pullback_post` 存的是每个事件的真实 `tradeDate`**：最后事件 2025-09-26 的 rd80 落在 2026-01 上旬。
  ⇒ 物理覆盖不是「截到 2025-09-26」，而是「每个事件各自 rd1..80」。
* 为什么缺口没暴露：五组 R 臂平均持有期极短（组 A `rAverageHoldingPeriod = 5.53` 个交易日），
  `heldToExtendedCapCount = 0` ⇒ **没有任何一笔需要 Runner 续持到 74 持有日**。
  诚实边界：`runnerTriggerObservability = UNOBSERVABLE`（`server/research/simulator/engine.ts` 的
  `runnerBridgeExtendedToBySecurity` 是函数局部 `Map`）⇒ 不能声称「Runner 从未触发」。

### 3.3 结论

**本轮 42 账户矩阵沿用现有证据足够**（与上一轮同一口径、同一 Dataset、同一执行政策，且缺口零暴露）。
但仍必须遵守目标 §4：**不得**在 rd80 静默强平、**不得**补最后价、**不得**事后剔除长持仓；
若实际出现暴露（`tradesOpenAtEnd > 0` 或 `noExecutionBarCount > 0` 或 `heldToExtendedCapCount > 0`），
**停并报告**，不改口径。S5 报告中须并列披露 `requiredPostRelativeDayForFullRunner=94` 与
`physicalPostMaxRelativeDay=80`。

### 3.4 `resolveEventWindowExitTailTradingDays` 的影响面（目标 §4 明确要求说清）

`server/runWorkbenchAssembly/assemble.ts#resolveEventWindowExitTailTradingDays`：

* 对池化策略（`document.definition.firstLimitPool != null`）**直接返回 0**；
* 否则只从 `definition.exit.rules` 派生 `maxHoldingDays`，再看 `policy.strongHold` 的
  `extendToHoldingDays / runnerExitAtHoldingDays`，**完全不读 `policy.runnerBridge`**；
* 返回值 = `effectiveMaxHoldingDays + EVENT_WINDOW_EXIT_TAIL_DEFERRAL_BUFFER(=20)`，再经
  `server/runWorkbenchAssembly/assemble.ts#clampEventWindowExitTailTradingDays` 夹到
  `postMaxRelativeDay − observationWindowEnd − 1`。

**判断**：该限制作用于 **`runWorkbenchAssembly` 游标/重建装配路径**
（`server/runWorkbenchAssembly/datasetFromRegistry.ts`、`server/research/simulator/cursorEngine.ts`）。
本系列 003/004 实验走的是 **Dataset 端口路径**：`sealRollingPoolExecutionDataset` 把
`ds_first_limit_pullback_post` 的 rd1..80 行封成一个合法 `ResearchDataset`，再调用
`server/research/simulator/engine.ts#runTradeSimulation`，**不经过 `resolveEventWindowExitTailTradingDays`**。
⇒ **该「派生根窗 30」不影响 Dataset 端口路径**，因此不影响 004 的实验。

⚠️ 但**不能**因此说端口「自行声明视界不受约束」（原草稿此处不准，本轮修正）：
`server/researchExperiments/datasetPort.ts#assertRequirementRelativeDaysWithinHorizon`（由
`server/researchExperiments/runner.ts` 在运行前调用）对「声明的 rd 超出该版本真实视界」是
**响亮抛错 `EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE`**（注释：「夹取等于悄悄改窄研究范围，故拒绝」），
**不是**静默返回 `[]`。`observation(rd)` 只在 `selectedEventIds.size === 0` 时返回 `[]`。
⇒ 想读 rd>80 **读不到**，必须换 Dataset 版本；这是**结构级**约束，正因如此 §3.2 的缺口只能靠
「实测零暴露 + 如实披露」处理。

---

## 4. 性能（目标 §7 + 性能方案）

### 4.1 方案要求的动作（`PLAN-ROLLING-POOL-EXECUTION-PERFORMANCE-001.md` §3 分档）

| 档 | 动作 | 是否本轮必做 | 等价性要求 |
|---|---|---|---|
| 1 | **缩小矩阵与预检**：004 `SMOKE = 两组 ×(R+2)=6`、`STUDY = 两组 ×(R+20)=42`；**移除完整矩阵重复预检** | ✅ 必做 | 无需 digest 证明；但 42 vs 1,005 只是工作量变化（≈4.2%），**不得**推算 24 倍提速 |
| 2 | **输入/投影复用**：同 Run 只扫描/冻结一次；ST 历史一次加载；逐日观察/修复证据、各组 R 排序、执行投影各一次构建 | ✅ 必做 | **必须**通过同一输入等价验证；且不得为提速只读 20 天退出行情 |
| 3 | **复用权威装配**：审计 `runCompositeRunnerBacktest` → `assembleRunWorkbenchInputs`，提供最小「装配配置」入口或复用可证明同配置的装配运行 | ✅ 必做 | **必须**输入等价证明；不得复制默认成本/退出配置，不得另造撮合器；旧 API 结果不变 |
| 4 | 索引与 prepared 缓存：`sealRollingPoolExecutionDataset` 的逐日 `rows.filter` 改一次日期索引；run 作用域不可变 prepared 输入 | ⚠️ 仅改实测热点 | **必须**等价验证；候选 `sourceRun` 指纹仍逐账户验证；缓存须能失效 |
| 5 | 内容寻址 checkpoint（按账户）+ 稳定汇总 | ⚠️ 按收益/成本决定 | **必须**验证冷/热、完整/断点恢复一致；正式结果只由完整 42 账户形成 |
| 6 | 可选 ≤2 worker 并行 | ⚠️ 仅在 profile 确认 CPU 热点后 | 每 worker 同一权威引擎、独立状态/seed；`Promise.all` 外包同步 CPU **不算**并行 |

**需要输入等价证明的**：档 2、3、4、5、6 —— 即所有复用/缓存/并行项。
判据见方案 §5：同 6 账户输入下逐账户比较
**信号/排序、`simulationConfig`、订单/拒单及原因、成交价/量/费、交易与权益 digest、
`canonicalMetrics`、再入场链、ST 审计**；忽略字段（计时/生成时间/RunID）须**列具体白名单**。
**明确禁止**：拿 1,005 旧账户与 42 新账户的耗时之比冒称引擎加速；以放松 ST/数据检查或退出政策换取提速。

### 4.2 上一轮正式 Run 的实测耗时（来源：`_scratch/fbp3/{precheck.log,formal.log,formal-run.json}`）

| 项 | 实测值 |
|---|---|
| 预检端到端（`--mode precheck`，1,005 账户） | **2,056.2 s**（34.27 min），产物 **67** |
| 正式端到端（`--mode formal`） | **2,066.3 s**（34.44 min） |
| 正式 Run `durationMs` | **2,013,888 ms**（33.56 min）；`startedAt 2026-10-10T14:22:55.656Z` → `finishedAt 2026-10-10T14:56:29.544Z` |
| 产物数 | Run `summary.artifactCount = 70`；`_scratch/fbp3/manifest.json` 实测 **66 tables + 2 artifacts + 0 charts = 68**（差额为 manifest/result 自身计数口径） |
| 事件扫描 | `eventCount 58,983`、`selectedEventCount 19,510`、`eventScanPolicy FULL_DATASET`、`eventScanLimit 400,000`、`eventPageCount 60`、`eventScanTruncated false` |
| 冻结选集 | 19,510（剔除 `EVENT_OUTSIDE_POOL_WINDOW 39,473`、`NEVER_IN_WATCH_POOL 69`） |
| 行情读取 | `prefixRowCount 176,650`、`postRowCount 1,560,800`、`maxPostRelativeDayRead 80`、`barQueryCount 890` |
| 身份解析 | `identifiers = 5,552`；已解析 **19,510**；无法解析 **0** |
| 执行投影 | 证券 **1,899**、行 **151,774**（`amount` 有效 151,513）、交易日 **496**（`2024-01-02 ~ 2026-01-19`）、bar 值冲突 **0** |
| 逐账户 | 5 组 × 201 = **1,005** 个账户引擎运行；全矩阵 **232,827** 笔交易 |
| 逐组 R 臂 | A/B/C/D/E 已平仓 255/334/285/144/144；全部 `INSUFFICIENT_EVIDENCE` |

### 4.3 时间去哪里了（**没有**阶段分解 —— 必须如实说）

* `formal.log` / `precheck.log` **只有 8 条 post 进度行与 5 条组完成行，全部无时间戳**；
  `formal-run.json` 的 `execution` 只暴露 `startedAt / finishedAt / durationMs` 三个标量。
* ⇒ **不存在**「查询 / 撮合 / 统计 / 持久化」的阶段占比。方案 §1 的判断（「当前没有可信的阶段分解，不能据此承诺 2 倍或 10 倍提速」）**成立**。
* 可用的**派生界**（明确标注为派生，不是实测）：

| 派生量 | 值 | 说明 |
|---|---|---|
| 每账户引擎运行均摊 | **≈ 2.00 s**（2,013,888 ms / 1,005） | 含 201 个账户 × 5 组 |
| 每笔交易均摊 | **≈ 8.65 ms**（2,013,888 / 232,827） | 含撮合 + 逐日状态 |
| 账户 × 交易日 | 1,005 × 496 ≈ **498,480 账户日** | 逐日循环下界 |
| 事件扫描 + 投影 + 身份解析 + 装配 | **上界 2,013,888 ms 减去全部账户撮合** | 无法进一步拆分 |

* 唯一可确认的**结构性**浪费（方案 §1 表格已列，代码可读）：
  `research-experiments/first-board-pullback/rolling-pool-observation-window/experiment.ts` 的逐账户循环里，
  **每组额外装配并运行一个随后丢弃的 R**（`result.ts#CONTRACT_GAPS` 自认：为取权威 `simulationConfig` 而跑一次并丢弃）
  ⇒ 1,005 账户里有 **5 次纯浪费的装配运行**；以及
  `server/researchExperiments/rollingPoolExecutionSupport.ts#sealRollingPoolExecutionDataset` 的
  `universeDays` 用 `rows.filter(...)` 对每个交易日做**全行扫描**（O(日数 × 行数)）。
  这两处**是代码可见的重复工作，不等同于已测定的耗时主因**（方案 §1 原话）。

### 4.4 剖析器接口（方案 §2 要求「先建立可比基线」）

`server/observability/perfProfile.ts`：

* 开关在**模块导入前**读一次环境变量：`PARAM_PROFILE=1`（其余值/不设 = 关闭）；
  `PARAM_PROFILE_OUT=<path>`、`PARAM_PROFILE_STDOUT=1`、`PARAM_PROFILE_MIN_MS=<n>`、`PARAM_PROFILE_DB=1`。
* 入口：`perfRun` / `perfRunAsync` / `perfBegin` / `perfEnd` / `perfCount` / `perfMark`；
  报告：`perfSnapshot()` / `formatPerfReport()` / `emitPerfReport()` / `perfReset()`。
* 🔴 **它刻意不挂 `process.on("exit")`** ⇒ 探针必须在 `finally` 里**显式**调用 `emitPerfReport()`（或自己 `perfSnapshot()` 落盘）。
  方案 §2 的「不假设设置 OUT 后自动导出」正是指这一点。
* Windows 上按 AGENTS：用 PowerShell 环境赋值或脚本启动参数，**不要**在 npm 脚本里写前置环境变量赋值。
* 实测：`_scratch` 下**不存在**任何 perf 产物 ⇒ 上一轮**未开剖析**，冷/热基线、DB 往返数、RSS 峰值全部缺失。

**⇒ S4 的性能对照必须先补这一步**（6 账户固定输入 + 保留未优化开关作对照 + 重复热基准 2 次验证波动）。

---

## 5. 真实入口（目标 §8 S1 要求）

| 环节 | 入口（路径 + 符号名） |
|---|---|
| 实验作者面 | `research-experiments/first-board-pullback/<id>/experiment.ts`（导出 `ExperimentDefinition`，`run(context)`）+ 同目录 `result.ts` / `page.tsx` / `README.md` |
| **实验注册** | `research-experiments/manifest.ts#EXPERIMENT_DEFINITIONS`（import + 数组项）；绑定 780004 的实验还需加入同文件 `FOUNDATION_EXEMPT_EXPERIMENT_IDS`（否则被 `withFirstBoardPullbackFoundation` 要求 `v5`） |
| 页面注册 | `client/src/researchExperiments/pages.ts`（`pageKey → 组件`）；模式分组 `client/src/pages/researchExperiments/experimentModes.ts` |
| Runner | `server/researchExperiments/defaults.ts#defaultExperimentRunner` → `server/researchExperiments/runner.ts#runDetailed` / `#run` / `#prepare`；运行前调用 `server/researchExperiments/datasetPort.ts#assertRelativeDaysWithinHorizon` 与 `#assertRequirementRelativeDaysWithinHorizon` |
| Run 服务 | `server/researchExperiments/defaults.ts#defaultExperimentRunService` → `server/researchExperiments/persistence/runService.ts#start` / `#execute` |
| 产物持久化 | `server/researchExperiments/persistence/artifactPublisher.ts` + `server/researchExperiments/persistence/runManifest.ts`（`ArtifactStorage`，唯一出口） |
| Dataset 端口 | `server/researchExperiments/datasetPort.ts#createRegistryExperimentDatasetPort` → `ExperimentDatasetAccess{events, eventPages, feature, observation}` + `freezeSelection` |
| 执行投影封装 | `server/researchExperiments/rollingPoolExecutionSupport.ts#sealRollingPoolExecutionDataset` / `#resolveRollingPoolSecurityIds` |
| 撮合引擎 | `server/research/simulator/engine.ts#runTradeSimulation`（游标版 `server/research/simulator/cursorEngine.ts#runTradeSimulationFromCursor`） |
| 指标唯一出口 | `server/backtest/backtestResult.ts#canonicalMetrics` |
| 冻结 Runner 政策 | `server/researchExperiments/frozenRunnerExitPolicy.ts#loadFrozenRunnerPolicyBundle` / `#runnerBridgeOf` |
| 零实现桥（`research-experiments/**` 触达 `server/**` 的唯一通道） | `research-experiments/compositeRunnerBridge.ts` |
| 工具入口 | `tests/tools/rollingPoolObservationWindowRun.mts`（`--mode precheck｜formal`，模式分支需在 004 改为独立 `smoke｜study`） |

---

## 6. S3 的最小 Scope（拟议）

**新增**：

1. `research-experiments/first-board-pullback/rolling-pool-recovery-st/`
   （`experiment.ts` / `result.ts` / `page.tsx` / `README.md`）。
2. `research-experiments/shared/rollingPoolRecovery/**`
   —— **唯一**信号求值实现（原 `N=5 / L=20` 分支 + 破位后五日综合修复分支），
   输出逐日证据供归因直接消费（目标 §3.2「代码必须只有一个信号求值实现」）。
3. **ST 资格投影（最小只读接口）** —— 二选一，必须在 S2 冻结并显式记录**契约版本 + 缺省旧行为**：
   * (a) 在 `shared/researchExperimentsContracts.ts` 增加声明式 ST 面，由
     `server/researchExperiments/datasetPort.ts#createAccess` 实现；
   * (b) 新增 `server/researchExperiments/securityStatusProjection.ts`，
     返回 `{statusValue: "NORMAL"|"ST"|"*ST"|"UNKNOWN", availableAsOf, evidenceFingerprint}`，
     底层复用 `server/securityStatus/persistence.ts#getSecurityStatus` 与
     `server/securityStatus/pointInTime.ts#isKnowableBy`。
   🔴 **在 ST 源补齐前，任何实现都只能返回 `UNKNOWN_BLOCKED`**（目标 §4「未知拒绝」）。
4. 登记面 3 处：`research-experiments/manifest.ts`、`client/src/researchExperiments/pages.ts`、
   `client/src/pages/researchExperiments/experimentModes.ts`（+ 相应分档测试计数）。
5. 工具：`tests/tools/rollingPoolRecoveryStRun.mts`（`--mode smoke｜study`，独立模式，**不复用 003 的 precheck/formal 分支**）。

**明确不得改动**：

* `research-experiments/first-board-pullback/rolling-pool-{right-tail-mvp,early-entry-runner,observation-window}/**`
  （001/002/003 实验文件）与其复现锁 `tests/server/researchExperiments/rollingPool*.test.ts`；
* `server/**` 的**执行语义**：`server/research/simulator/engine.ts#runTradeSimulation`、
  `server/backtest/portfolio.ts`、`Trade` 契约、`server/backtest/backtestResult.ts#canonicalMetrics`；
* `server/securityStatus/**` 的**解析语义**（新增只读调用者可以；改 `resolveSecurityStatus` /
  `statusKnowledgeDate` 的语义不可以）；
* 策略 `3600005`（`strategy_versions.id`）与其指纹、历史 Run、780004 的内容与 `datasetVersionId` 坐标；
* 旧 001/002/003 的 `equityDigest` / `tradeDigest`。

**已知的既有隐患（登记，不在 S3 顺手修）**：
`server/runWorkbenchAssembly/poolStIndex.ts#createPoolStIndexFromRows` 在无区间时返回 `"NORMAL"`，
与目标 §4「absence ≠ NORMAL」冲突。若 004 的闸门复用它，会**静默放行**。S3 必须**不复用**它，或先修正其缺省值。

---

## 7. GAPS / BLOCKED（如实）

| # | 缺口 | 状态 | 影响 |
|---|---|---|---|
| **G1** | **ST 逐日状态源不可 PIT 核验**（E1–E14、§1.5） | 🔴 **BLOCKED** | **S5 收益矩阵 SUSPENDED**；S4/S5 的 ST 闸门无法在真实数据上通过验收 |
| G2 | ST 维度**从未写入 `NORMAL`** ⇒ 闸门无满足路径 | 🔴 BLOCKED | 即使不看 PIT，`resolveStSync` 也永远给不出 `NORMAL` |
| G3 | 主窗口 **97.43%** 的格无 ST 区间；**84.05%** 的 symbol 无任何 ST 行 | 待补数 | absence ≠ NORMAL；这些格只能记 `UNKNOWN` |
| G4 | **948 格矛盾 + 主窗口 5% 涨跌停带整体缺失** | 根因已定位（§1.5），未修 | 数据集 `limitRule*` / `canBuyAtOpen` **不可**用作 ST 代理 |
| G5 | 构建期**静默降级**：`windows` 断点续跑跳过 `loadSecurityIndexes()` 且无断言 | 已登记，未修 | 任何续跑的 Dataset 构建都可能得到全 `UNKNOWN` 的状态字段 |
| G6 | 阶段级耗时分解缺失；`_scratch` 无任何 perf 产物 | 待 profile | **不得**承诺任何倍数提速 |
| G7 | 策略需要 rd94，Dataset 只到 rd80 | 已知；上轮**实测零暴露** | 本轮沿用；若出现暴露须**停并报告**，不得强平/补价/剔样本 |
| G8 | `runnerTriggerObservability = UNOBSERVABLE` | 契约限制 | Runner 的因果贡献**未被量化**，不得声称「从未触发」 |
| G9 | 端口**完全没有** ST 面；`sealRollingPoolExecutionDataset#toRow` 与 `datasetFromRegistry.ts#projectEventRow` 硬编码 `st: "UNKNOWN"` | 待 S3 | 闸门必须新增只读接口，不能从现有字段推 |
| G10 | 并发会话已在 S1 之外推进（S2 预注册、`research-experiments/shared/rollingPoolRecovery/`、`rollingPoolRecoverySt.test.ts` 已存在） | ⚠️ 协调项 | 编排方需确认 S2 冻结的 ST 来源与本节 G1 结论一致 |
| G11 | 未确定：本审计未对 780004 重跑构建，故 §1.5 的行级归属是「机制一致」而非逐行证明 | 诚实边界 | 结论（字段不可作 ST 证据）不受影响 |

**本审计未能确定的**：
1. §1.5 中「哪一次构建作业写了哪一行 post」的**逐行归属**（未重跑构建）。
2. 阶段级耗时构成（无剖析产物，无法回溯测量）。
3. 交易所公告可获知时间的可得性（未联网核验数据源，仅确认平台内不存在该字段）。
4. 780004 之外其他 Dataset 版本（780001/780002/780003/780005）的 post 行是否同样受 G5 影响
   （本轮只对 780004 做了规则分布实测；780003 为 `FAILED`，其余未测）。

---

## 8. 建议的下一步顺序

1. **先解决 G1/G2/G3**（需用户授权数据引入）——在 ST 源补齐且可 PIT 核验前，**不运行收益矩阵**。
2. 与 G1 并行可做的**不依赖 ST 结果**的工程项：
   * S2 预注册（收益可见前落盘；须把 G1 结论与「无覆盖 ⇒ `UNKNOWN_BLOCKED`」写进冻结条件）；
   * S3 的修复规则 + ST 闸门实现 + **合成 fixture 测试**（证明「ST 日买点 / 隔夜转 ST / 再入场 ST / UNKNOWN」四类均不买入，
     即使真实覆盖为 0 也能通过工程验收）；
   * S4 的 `server/observability/perfProfile.ts` 冷/热基线（6 账户）。
3. G1 解除后：S4 6 账户 SMOKE（含 digest 等价）→ S5 42 账户 EXPLORATORY Run → S6 报告。
4. 独立登记（不在 004 的 Scope 内）：G4/G5 的构建期修复 —— 需要自己的影响报告与授权。

---

## 9. 执行结果复核（2026-10-11）

> 用户要求查看本轮执行结果。复核对象为本审计、预注册、004实验外壳/规则、`_scratch/fbp4/`只读探针与验证日志。只追加审计说明，不改业务代码、历史Run、Dataset或预注册。

### 9.1 完成范围与收益、性能证据

目前完成的是S1审计、S2预注册及S3规则/外壳和合成测试。ROADMAP明确S4六账户SMOKE及S5四十二账户研究均未执行；未找到004真实收益报告或矩阵产物。新工具具备显式 `ST_COVERAGE_BLOCKED` / `matrixEmitted=false` 收口，不能把平台通用 `SUCCEEDED` 等同于收益研究已完成。

最新`verify2-st-tests.log`显示两文件40例通过（规则28例、阻断外壳12例），不是此前审计记录的24例。测试只证明被覆盖的合成路径；正向真实撮合与成交前ST检查尚未验收。新工具已区分6/42账户模式；没有优化前后同输入基准、真实STUDY耗时或引擎提速证据。

### 9.2 P1：成交前ST结果尚未进入实际拒单链

`rolling-pool-recovery-st/experiment.ts#run` 在候选阶段调用 `evaluateStGateForCandidate` 并保存两时点结论；覆盖摘要将已核验ST作为拒绝状态而非UNKNOWN阻塞。随后构建 `plannableByDate` 时仅检查 `row.confirmCloseBuyEligibility === NORMAL`，没有将 `gate.preFill` 的拒绝送入执行环节。

`buildSourceRun` 直接把已选候选转为long意图；`runTradeSimulation`使用既有配置，执行投影仍通过 `sealRollingPoolExecutionDataset` 写 `st=UNKNOWN`，未注入004成交时点状态。真实交易结束后才把 `gate.buyAllowed` 写进 `fillStAudit`，未见ST违规成交断言或拒单。因此昨日NORMAL、今日ST的订单在补齐provider后仍可能成交。

标记 **BASELINE_DRIFT**：README和代码注释「没有两时点NORMAL的候选不生成意图」「数据补齐后其余代码不变」超过实际实现。当前缺省provider阻塞全部矩阵，所以这是**被数据阻塞遮住的实现缺口**，不是已证实发生的违规交易。

修复验收：确认日排序仅依赖确认时点信息；已选订单在成交前经权威执行资格接口读取当时状态并取消。不能用次日ST在前日排序前删股票后让第4名替补。需增加真实撮合端到端用例：隔夜ST、再次入场ST、UNKNOWN均无成交、无扣现金、无成功次数；保留真实拒单原因。仅检查纯函数返回false不足以完成。

### 9.3 P1：ST区间使用午夜而非实际检查时刻

`rollingPoolRecovery/stGate.ts#evaluateStGate` 在区间有效性比较中使用 `instantKey(query.tradeDate)`，把检查时点变成00:00；`availableAsOf`比较才使用 `query.effectiveAt`。契约支持日内effectiveFrom/To，故有真实边界错误。

仓外探针 `_scratch/fbp4/review-st-instant-boundary.mts`（纯合成，不连DB）复现：

| PRE_FILL检查时刻 | NORMAL区间 | 当前结果 | 正确边界判断 |
|---|---|---|---|
| 2024-01-04 09:15 | 当日00:00至09:00 | NORMAL / VERIFIED_NORMAL | 此区间已失效，不能据此放行 |
| 同上 | 当日08:00至23:59:59 | UNKNOWN / NOT_EFFECTIVE_ON_TRADE_DATE | 此区间已生效，可结合来源证据放行 |

修复应按真正检查时刻判有效性，并明确只有日期的结束边界如何解释（整日闭区间或次日零点开区间）。增加到期、生效、日界线和隔夜变更测试。当前仅记录问题，没有改业务口径或测试。

### 9.4 数据与行情审计的结论边界

- ST覆盖不足的判定由本地状态表及解析路径支持；841个ST片段、NORMAL行0、可知性UNKNOWN不能支撑严格NORMAL资格。采集日期晚不表示历史公众直到2026年才知悉，准确表述是**平台缺少历史可知性证据**；不能修改retrievedAt或给所有区间强填IMMEDIATE。
- 948为rd1..20观察/检查格与平台ST区间的交集，**不是948笔实际买入**。其区间源有medium/UNKNOWN局限，执行字段与已有记录不一致已值得修复，旧交易是否受影响须逐笔对应后统计。
- §1.5「事件宇宙可信」只能限定为构建路径排除了**解析为ST/*ST**的事件。`datasetRegistry/filter.ts#isStExcluded` 对UNKNOWN放行，NORMAL又无明确记录，因此不能升级成全部事件日已严格证明非ST。
- §0/§3.3「本轮沿用上轮零暴露即足够」标记 **BASELINE_DRIFT**。修复规则新增的信号和持仓路径不同，不能从旧规则最长持仓/零暴露保证新矩阵post80覆盖足够。保持理论rd94/95和不可卖尾部的检查，缺口需合法续接或明确阻塞，不能按旧Run推断完成。
- 补数规模的笛卡儿1.20M格可作为广覆盖估计，但不是唯一最小执行方案。优先生成两组冻结价格信号所需的symbol/日期/检查时点清单，批量读取有明确NORMAL/ST观测和时点证据的来源。即使压缩为区间，2,378个没有ST片段的symbol也需要各自覆盖依据；「约500个NORMAL区间/千行即可覆盖全部2,827symbols」的粗估不可直接用于实施预算。

### 9.5 建议继续顺序

1. 先补9.2、9.3的执行接线和边界测试，维持旧001/002/003缺省行为不变；同步新增接口的架构影响。
2. 输出按研究所需时点去重的ST数据补齐清单、来源可知性验证和写入影响；涉及批量写入或新Dataset时按用户授权边界执行。原构建windows续跑未预热状态索引的缺口单列修复，保留旧Dataset、通过新版本验证，不直接覆盖780004。
3. 数据前置未满足时仍可做不依赖收益的fixture/profile和输入准备优化；已明确无provider的重复运行不应为了再次证明阻塞而重新读取全量post80，快速诊断需诚实标记未统计的候选数，不伪造计数。
4. 状态和行情闸门满足后完成6账户SMOKE及同输入性能等价对照，再运行一次42账户研究。届时才回答修复买点是否改善右尾，以及实际耗时减少多少。

本轮复核没有收益或提速结论；没有运行004、修改策略/执行代码或写数据库。
