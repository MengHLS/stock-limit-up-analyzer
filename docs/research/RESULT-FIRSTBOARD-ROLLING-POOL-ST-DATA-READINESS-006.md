# RESULT · 首板滚动池历史 ST 数据就绪核查与接入方案

> **用户决策更新（2026-10-11）**：本轮保留 Dataset 780004，暂不重建；此前重建建议属于未执行的历史提案，不是当前必做前置。历史 ST 检查独立处理，报告披露现有数据局限。详见 [保留数据集决策](DECISION-FIRSTBOARD-ROLLING-POOL-KEEP-DATASET-780004.md)。

> 目标标识：`FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006`
> 执行对象：[`GOAL-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md`](GOAL-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md)
> 配套影响方案：[`IMPACT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md`](IMPACT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md)
> 上游证据：`GOAL/PREREG/AUDIT-…-RECOVERY-ST-004`、`PLAN/RESULT/AUDIT-…-RECOVERY-ST-FIX-005`、`RESULT-…-FIX-005-REVERIFY`
> 基线：HEAD **`f8b6810347aa5950d1f9b95eaadc73308b68ac21`**（`f8b6810`）；工作区 **222 项 = 41 tracked-modified + 181 untracked**（含并发会话，**未触碰**）
> 终态：**`NEEDS_DATA_DECISION`**

---

## 0. 先行回答（普通语言，先给结论）

### 0.1 现在到底缺什么？

**缺的是「数据 + 证据」，其次缺一个「适配器」，最后才是「构建逻辑」。** 三者**不是**同一个东西：

| 缺什么 | 具体是什么 | 是否本轮可解 |
|---|---|---|
| **数据** | 覆盖 `2023-11-06 ~ 2025-10-09`（**开跑必需的实测范围**，比 004 主窗口更宽）乃至 `2019-01-02` 起的**逐日 ST/*ST 状态**本身。平台现有 ST 记录只覆盖 734 只证券、且 84.05% 的主窗口证券**一行都没有** | ❌ 需用户裁定来源（本轮禁止采购/批量采集） |
| **证据** | 每条状态记录的**可获知时间**（公告/可得时间）。现有 841 行的 `availability` **全部 `UNKNOWN`**、`retrievedAt` **全部落在 2026-09** ⇒ 严格 PIT 下**窗口内可获知 = 0 条** | ❌ 同上（`retrievedAt` **不能**改写成公告时间） |
| **适配器** | 把「来源 → `SecurityStatusProvider`」的那一层只读投影：批量载入、身份映射、区间索引、时点比较、来源指纹、可知性、冲突优先级、未知原因、缓存失效、契约版本 | ✅ **本轮已给出接口设计 + 合成样例 + 验收清单**（IMPACT §1），**未实现** |
| **构建逻辑** | ① `windows` 续跑跳过 `loadSecurityIndexes()` ⇒ 状态字段静默退化（**已定位并复现**）；② `poolStIndex` 无区间默认 `NORMAL` ⇒ 与「absence ≠ NORMAL」冲突 | ✅ **本轮已给出最小修复边界**（IMPACT §2/§3），**未实现** |

**另外缺一个记录器**：004 目前**没有**逐笔尾部需求观测（`post rd80` vs 理论 `rd94/95` 只能靠旧规则的零暴露**推断**，而 GOAL §6 明确**禁止**这种外推）⇒ IMPACT §5 给出「先加只读派生量再比较」的方法。

### 0.2 已有来源能解决多少？

**结论：能解决 0% 的严格 PIT 结论，但能解决 100% 的「问题定位」。**

- 严格 PIT（004 §4 要求的两个检查时点）：**0 / 1,201,475 格**可核验（`NORMAL` 0 格、窗口内可获知 0 条）
  ⇒ 现有来源**一条候选都放行不了**，`ST_COVERAGE_BLOCKED` 是**必然**结果，不是实现缺陷。
- 但已有来源足以**精确回答**「缺在哪」：本轮的 `status-gap-requests-necessary.csv` 给出
  **开跑必需的 22,041 个 (证券, 日期, 时点) 键**（去重后的**保守集合**，全部 `UNKNOWN`），
  `status-gap-requests.csv` 另给出含归因观察的扩展集合 507,358 格 —— 而不是「约 500 个区间」的粗估。
  这两份清单都是**真实生成的文件**（路径 / SHA-256 / 行数见 §3.9）。
- 平台内**没有**任何可替代来源（实测）：`stock_daily_prices` **没有 `isST` 列**；
  `stock_suspension_windows` 只有 184 行 / 120 只（起点 2025-01-13）；
  `limit_up_records` 只有**当前/当时名称**（`stockName`，如 `ST万邦`）——名称回填历史**被明令禁止**。

### 0.3 最小下一步具体要做什么？

**一步数据决策 + 两件不依赖它的工程修复，可并行：**

1. **（必须先做，需裁定）** 决定 ST 数据来源与范围：交易所逐日风险警示名单 + 实施/撤销公告时间，
   或等价的官方/授权服务。**范围至少是 `2023-11-06 ~ 2025-10-09`**（必需集合实测范围，
   **比主窗口更宽**：暖启动事件日 1,010 格在主窗口之前、1 格拟成交日在主窗口之后），
   而不是只取 `2024-01-02 ~ 2025-09-30`。
   **若坚持只用平台已有 BaoStock 数据 ⇒ 必须补「完整覆盖证明」这一层，
   否则 2,378/2,827 只证券仍只能 `UNKNOWN`**（`baostockStatus.ts` 只产 ST 片段、**不产 NORMAL**）。
   🔴 **开跑必需的补数量不是 507,358 格，而是 22,041 键**（`status-gap-requests-necessary.csv`）；
   507,358 是**含归因观察**的扩展集合，**不应**当作采购量或强制补齐量。
2. **（可立即授权，不依赖 1）** 修构建索引前置条件（IMPACT 动作 3，~1 行 + 测试）
   与 `poolStIndex` 显式政策（IMPACT 动作 4，缺省不变 + 新严格路径）。
3. **（可立即授权，不依赖 1）** 给 004 加**只读尾部记录器**（IMPACT 动作 6），
   让「实际需要多少 rd」由**实测分布**回答，而不是用 `94/95` 当数据定义、也不是用旧规则零暴露外推。
4. **数据到位后再做**：实现 provider 供给端（动作 2）→ 6 账户 SMOKE（含尾部与同输入性能对照）
   → 一次 42 账户 STUDY。**本轮不跑、不写库、不建 Dataset。**

### 0.4 本轮**没有**做什么

**没有**调用 SMOKE/STUDY、**没有**写数据库（0 DDL / 0 DML / 0 migration / 0 写入）、
**没有**构建 Dataset、**没有**创建/覆盖 Run、**没有**修改任何业务/研究语义、**没有**跑 formatter、
**没有** `git reset/stash/commit/checkout`。全部动作 = **只读 SELECT 探针**（48 次查询）
+ **只读需求枚举**（复用 004 权威共享求值器）+ **文档**。

---

## 1. S1：来源与覆盖实查（**本轮自测，非引用旧统计**）

### 1.1 执行记录

| 项 | 值 |
|---|---|
| 探针 | `scripts/_scratch/st-data-readiness006/s1-source-audit.mjs`（只读；`SELECT` / `information_schema`） |
| 输出 | `s1-source-audit.json`（1,054,068 B）+ `s1-source-audit.console.log`（阶段进度） |
| 查询数 / 行数 | **48 次查询**；最慢三项：`postRuleMixAllVersions` 198.1 s、`postFieldMix780004` 128.8 s、`postRuleMix780004` 118.8 s |
| 总耗时 | **798,771 ms（13.3 min）**，其中**全表扫描 `ds_first_limit_pullback_post`（4.72M 行）5 次**（跨地域 TiDB，每次 ≈ 1.8~2.2 min） |
| 说明 | 每格身份/状态判定在 Node 内按 `server/securityStatus/timeline.ts` 与 `db.ts#activeSecurityId` **同口径**重算（首次命中、按 `effectiveFrom` 升序），**不在 SQL 里另写一套口径** |
| DB | TiDB（远端 47.94.112.21:13306），`dateStrings`，连接级只读使用 |

### 1.2 来源与覆盖表（每个来源回答 GOAL §3 的七个维度）

#### 来源 ①：`research_security_status_history`（唯一 ST 源）

| 维度 | 实查结论 |
|---|---|
| **来源与访问方式** | 表 `research_security_status_history`（`drizzle/schema.ts:1067`；12 列）。**写方**：`server/securityStatus/persistence.ts#upsertSecurityStatusIntervals`，仓内唯一生产调用点是 `scripts/backfillStatusLiquidity.ts`（BaoStock 逐股日线 → `server/securityStatus/baostockStatus.ts#inferBaostockStatusIntervals`）。**读方**：`persistence.ts`（`getSecurityStatus*` / `isTradable`）、`datasetRegistry/db.ts#buildSecurityIndex`、`runWorkbenchAssembly/poolStIndex.ts`、`researchDataset/db.ts`、`historicalState/mappers.ts` |
| **历史范围** | ST 维度 **841 行 / 734 证券**；`effectiveFrom` 1998-05-04 ~ 2026-09-04；与主窗口重叠 313 行 / 310 证券，区间长度 min 42 / max 4,268 / avg 702.7 天。**含退市**（`research_securities` 5,552 行含 337 只退市 ⇒ anti-survivorship）；**含改名**（`identifier_history` 5,552 行 1:1 身份/代码） |
| **状态维度** | 明确分维度：`statusType ∈ {LISTING, TRADING, ST, DELISTING, SUSPENSION}`。实测非 ST 维度：`TRADING/TRADING` 5,552 行、`SUSPENSION/SUSPENDED` 9,532 行；**`LISTING` 与 `DELISTING` 维度 0 行** |
| **时间证据** | `effectiveFrom` / `effectiveTo` **有**（date 精度）；**`announcedAt` / `availableAsOf` 列根本不存在**；`availability` 三值枚举存在但 841/841 = `UNKNOWN`；`retrievedAt` 存在但语义是「何时写入本行」——实测 **0 行**满足 `retrievedAt <= 2025-09-30`，全部集中在 `2026-09-06`(23) / `2026-09-07`(783) / `2026-09-09`(35) |
| **穷尽性** | ❌ **不保证**。来源是「逐股日线 `isST===1` 的连续段合并」（`inferStIntervals`），**只产 ST 片段**：无 ST ≡ 未知。主窗口 84.05% 的证券无任何 ST 行；97.43% 的 (证券,交易日) 格无 ST 区间 ⇒ **absence 不能推出非 ST** |
| **信任度** | `confidence` 全部 `medium`（模块注释自认「逐日观测权威，但区间合并/边界含推断成分」）；`source` 全部 `baostock-daily`；**无证据指纹列**；冲突消解由 `timeline.ts#pickLatest` 完成（`effectiveFrom` 新 → confidence 高 → `retrievedAt` 新 → `source` 升序） |
| **使用边界** | 🔴 **不能用于历史买入判定**：`availability=UNKNOWN` + `retrievedAt` 在窗口后一年 ⇒ 严格 PIT 下每条区间都被 `pointInTime.ts#isKnowableBy` 剔除；全知视角下也**永远给不出 NORMAL**（ST 维度 `NORMAL` 行 = 0） |

#### 来源 ②：`research_security_identifier_history`（身份/代码历史，**不是**状态源但决定能否解析）

| 维度 | 实查结论 |
|---|---|
| 来源与访问 | 表 `research_security_identifier_history`（`schema.ts:1029`）。写方：STEP 7.4 回填；读方：`db.ts#activeSecurityId`、`poolStIndex` 的上游身份解析 |
| 历史范围 | 5,552 行 = 5,552 证券 = 5,552 代码（**1:1**）；`effectiveFrom` 1990-12-10 ~ 9999-12-31；`identifierType` 全部 `primary` |
| 状态维度 | 无（纯身份） |
| 时间证据 | `effectiveFrom/effectiveTo` 有；`retrievedAt` 全部 `2026-09-06 19:02:53 ~ 19:03:03`（单批次） |
| 穷尽性 | 覆盖 `research_securities` 全量 5,552（100%） |
| 信任度 | 无重叠区间（`uq_security_identifier_code_effective` 唯一约束 + 应用层 `assertNoOverlap`）；**实测同代码跨身份 = 0 例**（`multiIdentityCodeCount = 0`） |
| 使用边界 | ✅ 可直接用于 PIT 身份解析；**但不得因「当前 0 例」就假设未来不会有跨身份同代码** |

#### 来源 ③：`index_daily`（交易日历唯一来源）

| 维度 | 实查结论 |
|---|---|
| 来源与访问 | `index_daily`（`schema.ts:858`）。读方：`db.ts#loadTradingDays` |
| 历史范围 | 全库 **1,882 个交易日**（2019-01-02 ~ 2026-10-09）；主窗口内 **425 个交易日**（2024-01-02 ~ 2025-09-30） |
| 状态维度 | 无 |
| 时间证据 | `tradeDate`；`retrievedAt` |
| 穷尽性 | 作为**相对日推进**的日历依据足够（构建期 `buildWindowsAndOutcomes` 与 004 的日期映射都用它派生的 `tradeDate`） |
| 信任度 | 唯一日期来源，无冲突 |
| 使用边界 | ✅ 直接可用；**T+1 类语义必须走它，禁止自然日 +1** |

#### 来源 ④：`stock_daily_prices`（自有行情）

| 维度 | 实查结论 |
|---|---|
| 来源与访问 | 8,526,531 行（估算）；13 列 |
| 历史范围 | 全市场日线 |
| 状态维度 | ❌ **无**。列清单实测只有 `stockCode, tradeDate, openPrice, closePrice, preClosePrice, lowPrice, highPrice, volume, amount, source, sourceUpdatedAt, createdAt, updatedAt` —— **没有 `isST`、没有 `tradestratus`** |
| 时间证据 | `sourceUpdatedAt`（采集时间） |
| 穷尽性 | 行情穷尽性与 ST 无关 |
| 信任度 | — |
| 使用边界 | 🔴 **不能**从自有行情重推 ST（AUDIT §1.6 结论本轮独立复核成立） |

#### 来源 ⑤：`stock_suspension_windows`

| 维度 | 实查结论 |
|---|---|
| 来源与访问 | 184 行 / 120 只；`source` 全部 `tushare-daily-infer` |
| 历史范围 | `startDate` 最早 **2025-01-13**；`endDate` 可空（实测 `COALESCE` 上界 `9999-12-31` ⇒ 存在开放窗口） |
| 状态维度 | 仅停牌窗口（**与 ST 不同维度**） |
| 时间证据 | `startDate`/`endDate`；无公告时间 |
| 穷尽性 | ❌ 184 行覆盖 120 只 —— 主窗口 2,827 只的 **4.2%**，且 2025 年前基本没有 |
| 信任度 | `tushare-daily-infer` = 日线缺口反推 |
| 使用边界 | 🔴 **不能**用于历史 ST 判定（维度不同 + 覆盖不足） |

#### 来源 ⑥：`limit_up_records`（涨停记录，含 `stockName`）

| 维度 | 实查结论 |
|---|---|
| 来源与访问 | 100,442 行 / 4,353 只 / **4,677 个不同 `stockName`**；2019-01-02 ~ 2026-10-09 |
| 历史范围 | 覆盖主窗口，但只有涨停日 |
| 状态维度 | ❌ 无 ST 维度，只有**名称字符串** |
| 时间证据 | `limitUpDate` + `createdAt`（**无公告时间、无名称生效区间**） |
| 穷尽性 | 只有涨停日 ⇒ 对状态判定**结构性不足** |
| 信任度 | 名称是**当时采集到的字符串**，没有 name-history 表；实测样本里出现 `ST万邦`（2025-09-30） |
| 使用边界 | 🔴 **禁止**用名称回填历史 ST（`boardRules.ts#isStStock` 的注释与 GOAL §4 都禁止；`server/securityStatus/types.ts` 明令「禁止用 `stock_name.includes("ST")` 作为最终判断」）。**且名称到底是当时名还是当前名，本表无从证明** |

#### 来源 ⑦（新增，本轮发现）：`dataset_build_job`（构建作业时间线）

| 维度 | 实查结论 |
|---|---|
| 来源与访问 | 25 行；`WHERE datasetVersionId = 780004` 命中 **7 行**（`900004`~`900010`） |
| 历史范围 | 2026-10-07 ~ 2026-10-09 |
| 状态维度 | 无（作业状态） |
| 时间证据 | `startedAt` / `completedAt` / `lastCursor`（含 `phase` / `lastTradeDate` / `processedRows` / `completedChunks`） |
| 穷尽性 | 只记作业，不记「哪一行由哪一轮写」 |
| 信任度 | 数据库事实 |
| 使用边界 | ✅ 直接作为**构建期静默降级的机制证据**（见 §4） |

### 1.3 旧 S1 数字的独立复核（**我自己的查询**）

| 指标 | 旧 S1（004 审计） | **本轮实测** | 是否一致 | 查询条件 / 分母 |
|---|---|---|---|---|
| ST 行数 / 证券数 | 841 / 734 | **841 / 734** | ✅ | `WHERE statusType='ST'` |
| ST 行 `availability` | 全部 `UNKNOWN` | **841/841 `UNKNOWN`** | ✅ | 同上，`GROUP BY availability` |
| ST 行 confidence / source | 全部 `medium` / `baostock-daily` | **一致** | ✅ | 同上 |
| `retrievedAt` 范围 | 2026-09-06 ~ 09-09 | **2026-09-06 19:07:53 ~ 2026-09-09 03:01:59** | ✅ | `MIN/MAX(retrievedAt)` |
| 窗口内可获知 ST 行 | 0 | **0** | ✅ | `retrievedAt IS NOT NULL AND retrievedAt <= '2025-09-30 23:59:59'` |
| ST 维度 `NORMAL` 行 | 0 | **0**（全表任意维度亦 0） | ✅ | `statusType='ST' AND statusValue='NORMAL'`；`statusValue='NORMAL'` |
| 主窗口 (证券×日) 格 | 1,201,475 | **1,201,475** = 2,827 证券 × 425 交易日 | ✅ | 宇宙 = 780004 内 `tradeDate ∈ [2024-01-02, 2025-09-30]` 的 distinct symbol（2,827）；日历 = `index_daily` 同区间 distinct `tradeDate`（425） |
| 身份可解析格 | 1,191,913（99.20%） | **1,191,913（99.20%）**；无身份 **9,562（0.80%）** | ✅ | Node 内 `activeSecurityId(symbol, date)`（PIT 首命中） |
| ST 生效格 | 30,855（2.57%） | **30,855（2.57%）** | ✅ | 同上 + 区间覆盖 `effectiveFrom <= d <= effectiveTo` |
| 有 ST 行的证券 | 449（84.05% 无） | **449**（⇒ **2,378 只没有任何 ST 行 = 84.05%**） | ✅ | 同代码的全部身份区间并集 |
| 主窗口事件宇宙 | 18,431 事件 / 2,827 证券 | **18,431 / 2,827** | ✅ | `datasetVersionId=780004 AND tradeDate BETWEEN ...` |
| **rd1..20 检查格** | **366,910** | **368,620**（事件 18,431 / 证券 2,827） | ⚠️ **差 +1,710（+0.47%）** | `post` rd∈[1,20] INNER JOIN 事件并限事件日在主窗口 |
| **ST 区间交集格（「948」）** | **948** | **973**（962 格 `canBuyAtOpen=1` + 11 格 `canBuyAtOpen=0`；`limitRuleUp` 全 0.1；`suspensionStatus` 全 `UNKNOWN`） | ⚠️ **差 +25（+2.6%）** | 同上 + 身份区间 JOIN + `statusType='ST'` 且区间覆盖 `post.tradeDate` |
| post 全表 5% 涨跌停行 | 7,368 / 2019-01-23 ~ 2019-08-28 | **7,368 / 2019-01-23 ~ 2019-08-28** | ✅ | `datasetVersionId=780004 GROUP BY limitRuleUp` |
| post 全表行数 | 4,711,272 / 4,718,640 | **4,711,272（0.1）+ 7,368（0.05）= 4,718,640** | ✅ | 同上 |
| 主窗口 post `limitRuleUp` | 全 0.1 | **全 0.1** | ✅ | 同 §1.4 |
| 构建作业 | `900007/900009` FAILED、`900010` COMPLETED 08:41:38→09:13:48 | **`900004`~`900009` 全 FAILED、`900010` COMPLETED（1,930 s，`processedRows 10,261,516`）** | ⚠️ **更完整**（旧审计未列 `900004`~`900006`、`900008`） | `dataset_build_job WHERE datasetVersionId=780004` |

**差异登记（两处，均不影响结论）**：

| # | 差异 | 最可能原因（**未逐条证明**） |
|---|---|---|
| **D-1** | rd1..20 检查格 366,910（旧）vs **368,620**（本轮） | 分母构造细节不同（旧探针的 SQL 形态未在本轮复用；本轮为 `post rd∈[1,20]` ⋈ 事件 + 事件日限主窗口）。**两者各自内部一致** |
| **D-2** | ST 交集格 948（旧）vs **973**（本轮） | 同上 + 身份解析形态不同（旧探针用 `LEFT JOIN` + `EXISTS` 相关子查询；本轮用集合式 `JOIN` + 区间条件）。🔴 **两套数的证据质量相同**（见 IMPACT §3.6），**结论不变** |

**旧统计与旧探针证据本轮**未被当作新结果引用：上表「本轮实测」列全部来自我自己的 48 次查询
（`s1-source-audit.json`），旧值只作为对照列出现。

### 1.4 主窗口执行面字段的退化实况（本轮实测）

| 指标 | 实测 |
|---|---|
| `ds_first_limit_pullback_post` 总行 | **4,718,640**（rd 1..80） |
| `suspensionSource='PIT_STATUS'`（即索引已预热时写下） | **264,042 行 = 5.60%**（其中 `NOT_SUSPENDED` 263,654 / `SUSPENDED` 882 / 其余小量） |
| `suspensionStatus='UNKNOWN'` | **4,454,598 行 = 94.40%** |
| `limitRuleUp=0.05` | **7,368 行 = 0.156%**，且**全部**落在 `2019-01-23 ~ 2019-08-28` |
| `limitRuleUp=0.10` | 4,711,272 行 |
| 事件表 `limitRuleUp` | **58,983 行全 0.10**（事件日确实非已知 ST，因为 `excludeSt=1` 已按 PIT 剔除 ST/*ST） |
| 主窗口 (rd1..20) 全表 `limitRuleUp` | **全 0.1** |
| 跨版本对照 | `780001` 5% = 52,162 行（2019-01-23~2026-09-04，**贯穿全程**）；`780002` 5,350；`780003` 46,140；`780005` 5,601（2026-03-03~2026-09-04）⇒ **只有 780004 的 5% 带被截断在 2019-08-28** |

⇒ 780004 **不是「旧数据有点脏」，而是「状态派生列在续跑点之后整体退化」**。

---

## 2. S1 结论：`INSUFFICIENT`（四个独立原因，全部实测）

1. **没有 NORMAL**：ST 维度 `NORMAL` 行 = **0**（全表任意维度亦 0）⇒「要求历史 NORMAL」**无满足路径**。
2. **没有可知性**：841/841 行 `availability=UNKNOWN`，`retrievedAt` 全在 2026-09 ⇒ 严格 PIT 下**0 条可知**。
3. **没有穷尽性**：84.05% 的证券无任何 ST 行；97.43% 的格无 ST 区间 ⇒ absence **不能**推出非 ST。
4. **执行面字段与状态事实互相矛盾**：rd1..20 的 **973** 个「平台 ST 区间生效」格里 `limitRuleUp` 全 0.1、`canBuyAtOpen=1`（962 格）

⇒ 与 004/PREREG 的判定**一致**：`ST_COVERAGE_BLOCKED` 是**合规终态**，不是实现缺陷。
**004 的 42 账户收益矩阵在数据到位前不得运行。**

---

## 3. S2：实际生成的最小状态需求与缺口清单（**真实文件**）

### 3.1 生成器与复用（**真实产出，不是「下一步生成」**）

| 项 | 值 |
|---|---|
| 脚本 | `scripts/_scratch/st-data-readiness006/s2-requirement-enumeration.mts` |
| 复用的**权威**接口 | `rollingPoolRecovery/entry.ts#evaluateRecoveryDaysFor`（**唯一**信号求值器）、`rollingPoolRightTail/projection.ts#buildDailyPool` / `#deriveEventFactors`、`rollingPoolEarlyEntry/entry.ts#evaluateEarlyEntry`（经前者间接调用，N=5/L=20）、`rollingPoolRecovery/stGate.ts#evaluateStGate` / `#effectiveAtOf`、`result.ts#GROUPS`（两组冻结规格：`entryFillMaxRd=20`） |
| 复用的**判据顺序** | 与 `experiment.ts#run` 逐条同序：事件扫描（`isFirstLimit` / `boardType='main'` / `market∈{SH,SZ}` / `tradeDate ∈ [2023-11-01, 2025-09-30]`）→ 池构造 → 逐组求值 → 候选行（`trigger.confirmRd === row.eventAge`、`fillRd = confirmRd+1`、`fillRdWithinCap`、`preReturn10 !== null`、`(anchor,confirmRd)` 去重）→ `sortCandidates`（`preReturn10` 降序 → symbol → anchorEventId） |
| **不做** | 不生成买单、不撮合、不计算收益、不读 `outcome` 表、不写库、不把 `UNKNOWN` 当 `NORMAL`、不注入 provider 到正式实验 |

**口径一致性交叉验证（与 004 正式运行的账目逐项吻合）**：

| 项 | 004 复验报告（`RESULT-…-FIX-005-REVERIFY`） | **本轮 S2 实测** | 一致 |
|---|---|---|---|
| 扫描事件 | 58,983 | **58,983** | ✅ |
| `EVENT_OUTSIDE_POOL_WINDOW` | 39,473 | **39,473** | ✅ |
| 进入池的种子 | 19,510 | **19,510** | ✅ |
| `NEVER_IN_WATCH_POOL` | 69 | **69** | ✅ |
| 决策日数 | 496（含执行投影区间） | **425（主窗口 2024-01-02 ~ 2025-09-30）** | — （不同口径：4xx 是执行投影的交易日；425 是池决策日） |
| `NO_POST_BARS` | 0 | **0** | ✅ |
| 唯一证券（需求清单） | — | **2,837** | — |

⇒ 本轮的候选枚举与正式实验**同一套口径**（不是第二套规则）。

### 3.2 读范围与**等价性实测**（GOAL §7「缩短读取范围前证明等价」）

| 项 | 值 |
|---|---|
| 主张 | **post rd1..41 足够**：池构造读 rd1..40（`WATCH_MAX_AGE`）并读 rd+1（≤41）判 `nextOpenExecutable`；确认日 ≤ rd19、成交日 ≤ rd20；修复窗口 `W=[d−5,d−1]` ≤ rd18；`evaluateRecoveryDays` 的观察上界 = `WATCH_MAX_RD = 40` |
| **实测证明** | 同一进程、同一事件集、同一求值器，只改 post 读取上界：**`digest(rd1..41) === digest(rd1..80) === fc5860ee…3f2eb`**；双向差集 **onlyIn41 = 0 / onlyIn80 = 0**；`poolEvents 19,510 = 19,510`；`decisionDates 425 = 425`；`watchPool 19,441 = 19,441` |
| 结论 | ✅ **rd1..41 与 004 正式读的 rd1..80 在本轮候选集上完全等价**（证据 `s2-equivalence-report.json`）。节省的读取量：1,560,800 → **800,200 行**（约 −49%） |

🔴 **边界（独立审计第 64 行指出的重要限定）**：`rd1..41` 只覆盖**买点资格诊断**所需的相对日；
它**不代表**收益回测只需 41 日。收益/退出路径仍需 `rd1..80`（且理论上需 rd94/95，见 IMPACT §5）。

### 3.3 三个需求账户（**互相分账**）

| 账户 | 行数 | 说明 |
|---|---|---|
| **① 事件资格需求** | **58,323** = 19,441 锚点 × 3 子条件 | `EVENT_ELIGIBILITY_EVENT_DAY_ST`（构建期 `resolveStSync`，**日期级、无 asOf**）/ `EVENT_ELIGIBILITY_LISTED_AGE_365`（来源 `research_securities.listedDate`，本轮**未逐锚点回读** ⇒ 该列 `null` = 未测）/ `EVENT_ELIGIBILITY_BOARD_MAIN`（Dataset 行内事实，非状态维度） |
| **② 买入资格需求** | **3,256** = 1,628 原始候选 × 2 时点 | `BUY_ELIGIBILITY_CONFIRM_CLOSE`（1,628 行，`effectiveAt = 确认日T15:00:00`）+ `BUY_ELIGIBILITY_PRE_FILL`（1,628 行，`effectiveAt = 计划成交日T09:15:00`）。**首次 / 重试 / 二次入场共用同一对时点**；日期全部取自事件自身 post 行的真实 `tradeDate`（= 交易日历派生），**没有自然日 +1** |
| **③ 观察日需求** | **780,400** | 求值器实际查询的 (锚点 × rd1..40) 格。其中**仅 1,300 格**是候选确认日（`consumedForEligibility=YES`，即**真正参与资格判定**），**779,100 格**只是被记录进 `days[].buyEligibility` 的归因/证据（`consumedForAttributionOnly=YES`） |
| 合计原始需求 | **841,979** | 58,323 + 3,256 + 780,400 |

🔴 **`post rd > 40` 从未被求值器查询** ⇒ **post80 的 40 个相对日（rd41..80）不是必需数据**；
本账户把「观察日」与「买入时点」分开记账，正是为了避免把全部 post80 误当成必需。

🔴 **本清单**不**包含「执行尾部需求」**：`rd41..80` 与理论 `rd94/95` 属于**行情/市场数据覆盖**需求
（收益与退出路径），不是**状态**需求 ⇒ 单列在 [`IMPACT-…-006.md`](IMPACT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md) §5，
**不混进** `status-gap-requests*.csv`。

**原始价格候选（**不是** Top3）**：`A_STRICT_20 = 328`、`B_RECOVERY_20 = 1,300`，合计 **1,628**。
两组候选都进入需求清单；**Random 与 R 共用同一合法候选宇宙**（同一池、同一可排序集合），
因此本清单即两者的共同覆盖需求（**不是**最终交易清单，Top3 只是其中的排序子集）。

### 3.4 去重后的缺口请求（`status-gap-requests.csv`）

| 项 | 实测 |
|---|---|
| 去重键 | `(symbol, securityId, checkDate, timepoint)` |
| **去重后请求数** | **507,358**（原始 841,979 ⇒ **压缩 60.26%**） |
| 按 `timepoint` | `EVENT_DAY_BUILD_PIT` **19,441** / `CONFIRM_CLOSE_ELIGIBILITY` **486,617** / `PRE_FILL` **1,300** |
| 按 `checkDate` 年份 | 2023: 17,978 / 2024: **264,598** / 2025: 224,782 |
| 日期范围 | **2023-11-02 ~ 2025-12-01**（上界 = 主窗口末事件的 rd≤40 观察日） |
| 唯一证券数 | **2,837** |
| 需求 → (组/锚点) 映射 | `status-gap-requests-map.csv` **841,979 行**（去重**不丢**可追溯性；每行 = (symbol, securityId, checkDate, timepoint, group, anchorEventId, checkPurpose)） |
| 去重键成员数（一格可能被多个 purpose 需要） | `EVENT_ELIGIBILITY_*` 各 19,441；`BUY_ELIGIBILITY_CONFIRM_CLOSE` 1,300；`OBSERVATION_DAY_CONFIRM_GATING` 1,300；`OBSERVATION_DAY_ATTRIBUTION_ONLY` 485,552；`BUY_ELIGIBILITY_PRE_FILL` 1,300 |

### 3.5 **开跑必需集合 vs 扩展集合**（独立审计指出后的**分账修正**）

`status-gap-requests.csv`（507,358 格）把**开跑必需**与**归因扩展**混在一起；
按 GOAL §4「该清单是资格检查所需的保守集合」的分账要求，本轮补出**必需子集**：

| 集合 | 定义 | 格数 | 占比 |
|---|---|---:|---:|
| **开跑必需** | purposes ∈ {`EVENT_ELIGIBILITY_EVENT_DAY_ST`, `EVENT_ELIGIBILITY_LISTED_AGE_365`, `BUY_ELIGIBILITY_CONFIRM_CLOSE`, `BUY_ELIGIBILITY_PRE_FILL`} | **22,041** | **4.34%** |
| 扩展（含归因观察） | 上面 + `OBSERVATION_DAY_*` | 507,358 | 100% |

**必需集合明细**（`status-gap-requests-necessary.csv`，派生视图，**不连库重算**）：

| 项 | 实测 |
|---|---|
| 必需键（去重后） | **22,041** = 事件日 ST **19,441** + 候选确认日收盘 **1,300** + 拟成交日前 **1,300** |
| 日期范围 | **2023-11-06 ~ 2025-10-09** |
| 🔴 **越出主窗口** | **主窗口之前 1,010 格**（2023-11-06~2023-12-29 的**暖启动事件日**）+ **主窗口之后 1 格**（拟成交日 2025-10-09，国庆假期后的下一交易日）⇒ **补数范围不能只取 `2024-01-02 ~ 2025-09-30`** |
| 唯一股票代码 | **2,837** |
| 按年份 | 2023: 1,010 / 2024: 12,463 / 2025: 8,568 |
| 按来源 | 需 **ST 表** 的 2,600 格 + 需 **ST 表与 Security Master 两者** 的 19,441 格（事件日 ST 与上市龄同键） |
| 原子组（已修 `groups` 拼接） | `COMMON` 19,676 / `A_STRICT_20` 656 / `B_RECOVERY_20` 2,600 |
| 三分账（必需集合） | **NORMAL 0 / ST 0 / UNKNOWN 22,041** |
| 缺口原因（必需集合） | `NO_STATUS_FACT` **22,035** + `UNVERIFIED_STATUS_EVIDENCE` **6** |
| 平台区间覆盖（必需集合） | `YES` **6** / `NO` 22,035；平台可知日在检查时刻之前 = 🔴 **0** |
| 归因扩展（**不属开跑必需**） | 纯归因格 **485,317**（= 507,358 − 22,041）；带 `OBSERVATION_DAY_ATTRIBUTION_ONLY` 用途的格 **485,552**（其中 **235** 格同时是必需格 ⇒ 两种计数口径不同，均已列出） |
| `EVENT_ELIGIBILITY_BOARD_MAIN` | **19,441** 行（映射表内）——**不是状态维度**（Dataset 行内事实）⇒ 单独计数，**不进**必需状态键 |
| 映射表逐用途行数 | 事件日 ST 19,441 / 上市龄 19,441 / 板块 19,441 / 确认日收盘 1,628 / 拟成交日前 1,628 / gating 观察 1,300 / 归因观察 779,100 = **841,979** |
| 观察日 gating 覆盖关系 | 1,300 个 gating 观察键**全部**已被候选确认日键覆盖 ⇒ **额外必需键 = 0**（与独立审计一致） |

**独立交叉验证**：并发的独立审计会话（`AUDIT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md`）
用它自己的 Python 解析器得到**同一组数字**：必需 **22,041**、`2023-11-06 ~ 2025-10-09`、2,837 代码、
扩展集合 4.34%、四份 CSV 的 SHA-256 与本报告**逐字一致**。
⇒ 两边独立得出的必需集合一致（本轮的 `necessary-gap-summary.json` 与之相同）。

### 3.6 **NORMAL / ST / UNKNOWN 三分账**（本轮最关键的数字）

| 分账 | 格数 | 占比 | 判定依据 |
|---|---:|---:|---|
| **可核验 NORMAL** | **0** | **0.00%** | ST 维度 `NORMAL` 行 = 0 ⇒ 没有任何显式 NORMAL 证据（absence ≠ NORMAL） |
| **可核验 ST** | **0** | **0.00%** | 841/841 平台行 `confidence=medium` ⇒ 契约下记 `UNVERIFIED`；且窗口内可获知 = 0 |
| **UNKNOWN** | **507,358** | **100.00%** | 见下 |

**UNKNOWN 的缺口原因分账**：

| 原因 | 格数 | 占比 | 含义 |
|---|---:|---:|---|
| `NO_STATUS_FACT` | **504,697** | 99.48% | 该 (证券身份, 检查日) **在平台 ST 表里没有任何区间覆盖** ⇒ 无结论 |
| `UNVERIFIED_STATUS_EVIDENCE` | **2,661** | 0.52% | 平台**有** ST 区间覆盖该检查时刻，但证据强度不是契约要求的 `VERIFIED` |

**平台侧对照（同一批格）**：

| 维度 | 值 |
|---|---|
| `platformStInterval=YES`（平台 ST 区间覆盖该检查时刻） | **2,661**（0.52%） |
| `platformStInterval=NO` | **504,697**（99.48%） |
| 平台可知日在检查时刻**之前**（`platformKnowableAtCheck=YES`） | 🔴 **0** |
| 平台可知日在检查时刻**之后** | **2,661**（全部：这批行的 `retrievedAt` ∈ 2026-09-06 ~ 2026-09-09，检查时刻都在 2023-11 ~ 2025-12） |
| 无区间（不可谈可知性） | 504,697（`null`） |
| 平台证据表 | `stRows 841` / `stSecurities 734` / `availability {UNKNOWN: 841}` / `retrievedAt 2026-09-06 19:07:53 ~ 2026-09-09 03:01:59` / `normalRowsInStDimension 0` |
| 正式门禁（当前注入点 `resolveStatusProvider() === null`） | 全部格 = `UNKNOWN` / `NO_STATUS_PROVIDER` |

🔴 **结论**：**507,358 / 507,358 = 100% 的检查时点在今天无法给出可核验结论**。
即使把平台的 ST 区间**全部当作可信**（放宽到全知视角），也只有 **0.52%** 的格有记录，
而它们**没有一条**在检查时刻可知 ⇒ 严格 PIT 下仍然是 0。

### 3.7 「未扫描字段保持 null」的落实

- `required-status-checks.csv` 的 `listingAgeDays` 列**全部 `null`**（未逐锚点回读 Security Master，
  不写 0、不写猜测值）；`EVENT_ELIGIBILITY_LISTED_AGE_365` 行的 `currentOutcome=UNKNOWN` /
  `reason=LISTED_AGE_NOT_QUERIED_IN_THIS_PASS`。
- `FILL_DATE_UNKNOWN` 行 = **0**（本轮 1,628 个候选全部取到了 `fillDate`），因此没有空的 `checkDate` 行需要伪造。
- `securityId` 只有在身份解析不到时留空并给原因；本轮 507,358 格中
  `securityIdResolveReason = NO_IDENTITY_INTERVAL_AT_CHECK_DATE` 的格 = **0**
  （身份历史覆盖 100% 的证券；注意这与「无状态区间」是两件事）。

### 3.8 S2 执行记录

| 项 | 值 |
|---|---|
| 命令 | `node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs scripts/_scratch/st-data-readiness006/s2-requirement-enumeration.mts --equivalence` |
| 退出码 | **0** |
| 总耗时 | **1,953,960 ms（32.6 min）** |
| 查询数 / 读取行数 | **1,244 次查询 / 2,484,617 行** |
| 耗时构成（实测） | `post` **1,867,472 ms（95.6%）**、`prefix` 52,836 ms、`events` 7,746 ms、`identifierHistory` 156 ms、`stIntervals` 88 ms、`datasetVersion` 30 ms |
| post 读取量 | rd1..41 = **800,200 行**（408 次分块查询）+ 等价性复核 rd1..80 = 1,560,800 行 ⇒ 合计约 2.36M 行（其余为 prefix 58,530 行） |
| 缓存命中 | **无外部缓存**（一次性诊断）；进程内 `diagnoseCell` 按 `(symbol, date, timepoint)` 记忆化 ⇒ 避免对同一格重复调用闸门 |
| 落盘 | 全部直写文件（**未接管道**）；CSV 全部 **LF** |

### 3.9 S2 产物（真实文件）

（全部位于 `scripts/_scratch/st-data-readiness006/`，该目录 **gitignored**；全部 **LF**）

| 文件 | 行数（含表头） | 字节 | SHA-256 |
|---|---:|---:|---|
| `required-status-checks.csv` | **61,580** | 29,078,309 | `f421b1e26503165b64248dd8e48a48fcfe7ec847ee88c643ff5a5e4ee60fb72d` |
| `required-observation-days.csv` | **780,401** | 112,197,914 | `60ccff4d414087711ccaef8295a36899787daa5c136f90d6b46007de3946d4c1` |
| `status-gap-requests.csv` | **507,359** | 163,944,676 | `e7183ceed5e1eb54e6935b3acfaab98b084666bfb29b70b660d828600f0692bc` |
| `status-gap-requests-necessary.csv`（**派生视图**：开跑必需的 22,041 键） | **22,042** | 7,032,445 | `f153f9ff093dc542708fb015a0b569a8825771a609cdaf7582d49fdb18bc8342` |
| `necessary-gap-summary.json`（必需 vs 扩展分账） | 73 | 2,323 | `d74b748b65e5b8a0fff95506c938ae0c8a4f98c8577d244438eda05440bdabc4` |
| `status-gap-requests-map.csv` | **841,980** | 124,946,810 | `077b374b8f37b304598b60293aab4a4c548b9882151157cfc4537fcdee43a46a` |
| `s2-requirement-summary.json` | 6,367 | 119,943 | `338ba56bc5827b260f7d124bbfef77a81578e5c0a5ab252db2174988e58f4f25` |
| `s2-equivalence-report.json` | 24 | 735 | `5c795d02cb1ddac43bc6cda39d899e0372850e8406a83bd0ea990c48add18c31` |
| `s1-source-audit.json` | 2,782 | 1,054,068 | `35acb88bc54751af05062a6298524cfd58753e9d725d2583ae8df848bf024f5d` |

- 列语义与「空值一律写字面量 `null`（`securityId` 例外：留空 + 原因列）」的约定见
  `scripts/_scratch/st-data-readiness006/README.md`。
- 生成器与探针脚本同样在该目录：`s2-requirement-enumeration.mts`、`s1-source-audit.mjs`、
  `hash-deliverables.mjs`、`README.md`。

---

## 4. S4 的两个缺陷：本轮复现的证据（方案见 IMPACT §2/§3）

### 4.1 缺陷 1：`windows` 续跑跳过 `buildEvents` ⇒ 索引未预热

**代码坐标**：`server/datasetRegistry/builder.ts#build`（`checkpoint.phase === "windows"` 分支跳过 `buildEvents`）
⟶ `#buildEvents`（L516 `await io.loadSecurityIndexes()`，**唯一**调用点）⟶ `#buildWindowsAndOutcomes`（**不调用**）
⟶ `server/datasetRegistry/db.ts#DbDatasetBuildIO`（实例级 `readyIndex`，未预热 ⇒ `resolveStSync` 恒 `UNKNOWN`、
停牌恒 `UNKNOWN`、上市龄恒 `null`）⟶ `executionFacts.ts#deriveExecutionFacts`
（`limitUpRatio(code, stStatus, date)`：主板 ST/*ST ⇒ 0.05，**UNKNOWN ⇒ 0.1**）。

**作业时间线（实测）**：

| 作业 | 状态 | `lastCursor.phase` | 断点 | processedRows | 说明 |
|---|---|---|---|---|---|
| `900004` | FAILED | `windows` | 2019-04-02 | 426,688（2,461/60,620 片） | **本作业跑了 events 阶段（索引已预热）并写下前 2,461 片窗口**，随后 `insert into ds_first_limit_pullback_post` 失败 |
| `900005`~`900009` | FAILED | `windows` | 2019-04-02 | 426,688（0 片） | 从 `windows` 断点续跑 ⇒ 跳过预热 ⇒ 快速失败 |
| `900010` | **COMPLETED** | `windows` | 2025-09-26 | **10,261,516**（58,983/60,620 片） | 08:41:38 → 09:13:48 = **1,930 s**；同样跳过预热 ⇒ 此后续写的行**全部退化** |

**与观测的吻合**：`900004` 的断点 2019-04-02 的 rd80 窗口恰好延伸到 **2019-08-28**，与实测 5% 带的上界**逐日吻合**；
`PIT_STATUS` 行只占 5.60%，与「只有预热那一轮写过的前段」吻合。

**诚实边界**：这仍是「**与全部观测一致且机制可复现**」的定位（**未**重跑构建做逐行归属）。
但要下结论不需要逐行归属：**落库字段与平台 ST 记录互相矛盾 ⇒ 不可用作 ST 证据**（AUDIT §1.5 结论本轮复核成立）。

### 4.2 缺陷 2：`poolStIndex` 无区间默认 `NORMAL`

**代码坐标**：`server/runWorkbenchAssembly/poolStIndex.ts#createPoolStIndexFromRows.resolve()`
两处 `return "NORMAL"`（无该证券条目 / 有区间但当日不覆盖）。
**直接消费者**（全仓仅一处运行期消费者链）：
`datasetFromRegistry.ts` L1173/L1175–1186/L1211–1214 ⟶ `pooledDatasetCursor.ts` L144–147（`ResearchDatasetRow.st`）
与 L349–357（池期内 `ST/*ST` 才移池）。
**现有测试契约**：`tests/server/runWorkbenchAssembly/poolStIndex.test.ts` **明确断言**未知证券与区间外均为 `NORMAL`
⇒ 按 GOAL §6，**不得**改这两条断言，必须走显式政策/版本（IMPACT §3.4）。
🔴 **对 004 无影响**：004 走 Dataset 端口 + 自建执行投影，路径上**没有** `poolStIndex`
（`sealRollingPoolExecutionDataset#toRow` 与 `datasetFromRegistry.ts#projectEventRow` 都硬编码 `st: "UNKNOWN"`）。

**「948 格」的证据质量**（GOAL §6 要求先复现再分辨）：本轮实测 **973 格**，
两侧证据都是**低质量**（平台侧 `medium`/`UNKNOWN`/2026-09 采集；数据集侧未预热索引写下的 0.1/`UNKNOWN`）
⇒ 唯一可确定的是「**执行面字段与平台记录不一致，值得修复**」，
**不能**说「其中一方错了」，更不能把这 973 格当作 973 笔交易（它们是「事件 × 相对日」的**检查格**）。

---

## 5. 输入与证据指纹

### 5.1 代码/坐标指纹（本轮**未改动**这些文件）

| 项 | 值 |
|---|---|
| HEAD | `f8b6810347aa5950d1f9b95eaadc73308b68ac21` |
| 工作区 | 222 项（41 tracked-modified + 181 untracked） |
| Dataset | `datasetVersionId = 780004` / `v10-listed365-pre10-post80` / READY / `totalEvents 58,983` / `totalRows 10,320,499` |
| 构建配置 | `dataset_build_config.id = 510004`：`excludeSt=1`、`excludeListedWithinDays=365`、`preWindowDays=10`、`postWindowDays=80`、`outcomeHorizonsJson=[5,10,20]`、`batchSize=1000`、`configVersion=1`；事件 `relativeDay=0/firstBoard`；板块 `main` |
| 策略引用 | `strategy_versions.id = 3600005`，`2.0.0`，指纹 `f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfef3c` |
| ST 闸门契约 | `ST_GATE_CONTRACT_VERSION = "1.1.0"`（FIX-005 / F2 后） |
| 执行资格政策 | `recovery-st-execution-eligibility/1.0.0` |
| 权威求值器（S2 复用） | `research-experiments/shared/rollingPoolRecovery/entry.ts#evaluateRecoveryDaysFor`；池构造 `rollingPoolRightTail/projection.ts#buildDailyPool` / `#deriveEventFactors`；原分支 `rollingPoolEarlyEntry/entry.ts#evaluateEarlyEntry`（N=5 / L=20） |

### 5.2 交付文件指纹（SHA-256 / 行数 / 行尾）

| 文件 | 行数 | SHA-256 |
|---|---:|---|
| `s1-source-audit.json` | 2,782 | `35acb88bc54751af05062a6298524cfd58753e9d725d2583ae8df848bf024f5d` |
| `required-status-checks.csv` | 61,580 | `f421b1e26503165b64248dd8e48a48fcfe7ec847ee88c643ff5a5e4ee60fb72d` |
| `required-observation-days.csv` | 780,401 | `60ccff4d414087711ccaef8295a36899787daa5c136f90d6b46007de3946d4c1` |
| `status-gap-requests.csv` | 507,359 | `e7183ceed5e1eb54e6935b3acfaab98b084666bfb29b70b660d828600f0692bc` |
| `status-gap-requests-map.csv` | 841,980 | `077b374b8f37b304598b60293aab4a4c548b9882151157cfc4537fcdee43a46a` |
| `s2-requirement-summary.json` | 6,367 | `338ba56bc5827b260f7d124bbfef77a81578e5c0a5ab252db2174988e58f4f25` |
| `s2-equivalence-report.json` | 24 | `5c795d02cb1ddac43bc6cda39d899e0372850e8406a83bd0ea990c48add18c31` |
| `status-gap-requests-necessary.csv`（必需集合派生视图） | 22,042 | `f153f9ff093dc542708fb015a0b569a8825771a609cdaf7582d49fdb18bc8342` |
| `necessary-gap-summary.json` | 73 | `d74b748b65e5b8a0fff95506c938ae0c8a4f98c8577d244438eda05440bdabc4` |

生成脚本（同目录，gitignored）：`s1-source-audit.mjs` `242669b1ceef86c02078b026b0705d32cb0cfbbc2f9b60c59b9b94ffbf2e5b7e`、
`s2-requirement-enumeration.mts` `1e667c05fc54cd944c512ecfa459077078de486d6a8d69627a7e9c2df0df810b`、
`derive-necessary-gaps.mjs` `6d7afae1a852e87a1999c368cacf56efb5f5b03cbdd9ea5394c40b466fbd5155`。

（两份交付文档自身的 SHA-256 见任务回执 —— 写入后自指会使本表失效，故不在此引用中间读数。）

---

## 6. 执行耗时与查询计数（纪律记录）

| 阶段 | 耗时 | 查询数 | 行数 | 缓存 |
|---|---|---|---|---|
| S1 来源审计 | **798,771 ms** | 48 | — | 无（一次性；小表身份/状态全量入内存后逐格判定） |
| S2 需求枚举（post rd1..41 + 等价性 rd1..80） | **1,953,960 ms** | **1,244** | **2,484,617** | 无外部缓存；进程内 `diagnoseCell` 按 (symbol,date,timepoint) 记忆化 |
| S2 明细 | post 1,867,472 ms / prefix 52,836 ms / events 7,746 ms / 身份+状态 244 ms | — | post ≈2.36M 行、prefix 58,530 行、events 58,983 行 | — |
| 合计（本轮全部只读探针） | **≈ 45.9 min** | 1,292 | — | — |

**本轮遵守的纪律**：先读元数据与小状态表（`research_security_status_history` 15,925 行、`identifier_history` 5,552 行、
`research_securities` 5,552 行）再枚举行情；行情**一次批量扫描**由两组复用；**不按候选逐笔远程查询**；
只读必要相对日（并把「rd1..41 足够」用**实测等价性**证明）；长输出**直接落盘**（**未接管道**）；
每条查询记录耗时、行数。

**已知偏差**：S1 探针对 `ds_first_limit_pullback_post`（4.72M 行）做了 **5 次全表扫描**
（`postRuleMix780004` / `postRule5pctRows780004` / `postFieldMix780004` / `postRowsCreatedAt` / `postRuleMixAllVersions`）。
后来已把其中 3 次合并为 1 次（`postFieldMix780004`），但第一版脚本已消耗 ≈ 6 min；
**若重跑，可再省约 4 min** —— 如实登记为可优化项。

---

## 7. 未完成项 / 未验证项（如实）

| # | 项 | 状态与原因 |
|---|---|---|
| **U-1** | 交易所公告的可得性、成本、采购可行性 | **未核实**（GOAL 禁止付费与批量采集；本轮未联网核验来源文档） |
| **U-2** | 780004 的**逐行**构建归属（哪一轮写了哪一行） | **未做**（未重跑构建）。机制定位与全部观测一致，但**不是**逐行证明 |
| **U-3** | 新 Dataset 重建的**实测**耗时 | **未测**。唯一实测下界 = `900010` 的 1,930 s（**不含** events 阶段且索引未预热）；全量重建 > 32 min，外推 1~1.5 h，**不是承诺** |
| **U-4** | 004 的真实执行尾部需求分布（`requiredTailRd`） | **未测**：004 **没有**逐笔尾部记录器；IMPACT §5 给出先加观测的方法 |
| **U-5** | provider 在真实数据上的覆盖率 | **未测**：没有来源 ⇒ 无法测 |
| **U-6** | `poolStIndex` 严格政策对旧池化 Run 的影响面 | **未逐一枚举**（结构级论证：`ResearchDatasetRow.st` 参与内容寻址） |
| **U-7** | `LISTING` / `DELISTING` 维度为何 0 行 | 未查（不在本轮范围；影响上市龄/退市的证据链，建议单列） |
| **U-8** | 上市龄的来源核对（GOAL §4 要求之一） | **部分**：来源定位到 `research_securities.listedDate`（5,552 行、`listedDate` 无 NULL、含 337 只退市），但**未逐锚点回读**（⇒ S2 CSV 中该列保持 `null` = 未测，不以 0 冒充） |

---

## 8. 偏差登记（本轮实际发生的）

| # | 偏差 | 处置 |
|---|---|---|
| **V-1** | `948` vs 本轮 `973`、`366,910` vs 本轮 `368,620` | 两处**如实并列**，原因归为分母/身份解析形态差异（**未逐条证明**）；结论不变 |
| **V-2** | `docs/architecture/...` 与代码的**注释级漂移**：`server/securityStatus/types.ts` 的 `AVAILABILITIES` 注释把 `T_PLUS_1` 写成「次一**自然**日」，而 `pointInTime.ts#statusKnowledgeDate` 实现的是**次一交易日**（需要 calendar，无 calendar ⇒ `null` fail-safe），GOAL §3 也要求「真实交易日历」 | 标 **BASELINE_DRIFT**（文档 vs 代码），**本轮只登记不改代码**（改注释属代码文件改动，不在本轮授权内） |
| **V-3** | S1 探针初版对 `post` 表做了 3 次冗余全表扫描（≈6 min） | 已合并为 1 次；如实登记为可优化项（§6） |
| **V-4** | S2 生成器在 `status-gap-requests.csv` 的 `EVENT_DAY_BUILD_PIT` 行里，`effectiveAt` 由 `effectiveAtOf()` 渲染为 `T15:00:00`（仅为逐行格式统一）。构建期该判定实际是**日期级、无 asOf** | 在 `_scratch/.../README.md` 与该行所在文件的列语义里**显式说明**；`checkDate` + `timepoint` 才是权威坐标 |
| **V-5** | 并发的另一个会话在 `scripts/_scratch/st-data-readiness006/` 落了一个 `_peek.mjs`（15:41:40，读取我的 `s1-source-audit.partial.json`） | **未触碰**、未删除；本轮**未**修改任何他人文件 |
| **V-6** | 行尾哨兵 `node scripts/checkEolDrift.mjs --strict` 非 0 | 原因 = 其他会话的未跟踪 CRLF 文件 `_scratch/overlap/probe01_db_state.mjs`（**未触碰、未扩大忽略**）⇒ **不声称全仓绿**（另见 §9） |
| **V-7** | `status-gap-requests.csv` 的 `groups` 列是**非原子拼接**（如 `A_STRICT_20\|A_STRICT_20\|B_RECOVERY_20\|B_RECOVERY_20\|COMMON`） | 由并发的独立审计指出（其 §3 附注）。根因：观察日行的 `group` 传入的是 `gatingGroups.join("\|")`，该字符串又被 `Set` 当作**单个**元素 ⇒ 同一组被重复计入。**本轮未重生成**主产物（重生成会改变已被独立核验的 4 个 SHA-256，代价大于收益），改为在**派生视图** `status-gap-requests-necessary.csv` 里**拆成原子组并去重排序**（实测 `COMMON 19,676 / A_STRICT_20 656 / B_RECOVERY_20 2,600`）。**按 (证券,日期,时点) 的计数不受影响**，只有**按组聚合**受影响 |
| **V-8** | S2 的两趟读取（rd1..41 与 rd1..80）重复读了 rd1..41 | 独立审计指出「首次对照有验证价值，后续不应每次重做」。后续应把一次读入的数据**投影**出两个窗口，或落一份可复用快照（按 datasetVersionId + 相对日 + 日期范围 + 规则/输入指纹做键）。如实登记为**可优化项** |
| **V-9** | 004 **没有**逐笔尾部记录器；本报告只能引旧规则的零暴露 + 理论 rd94/95 | 独立审计第 57 行进一步指出：用**实际持有天数**反推尾部需求会**低估**（缺尾导致的未平仓/截断本身就是需求证据）。已在 IMPACT §5 改为**分离记录**（已观测退出日 / 计划持有上限 / 缺 bar / 不可卖 / 截断 / 未平仓 / Runner 延长触发） |

---

## 9. 工程闸门与"为什么不可能影响行为"

- 本轮只做 **只读 SELECT 探针** + **仓外（gitignored）诊断脚本与清单** + **docs** ⇒
  **不改变任何运行时行为**，因此**不重跑全量测试**（GOAL §8 明文同意）；
  也**未**引入需要类型检查的接口/测试代码（诊断 `.mjs` / `.mts` 均在 `scripts/_scratch/`，不进 `tsc --noEmit` 的构建图）。
- 新文件**一律 LF**；`node scripts/checkEolDrift.mjs --strict` 结果与披露见 §8 V-6。
- 本轮**无架构版本跃迁**；已按规则更新 `docs/architecture/CHANGE-AUDIT.md`（只追加本条）。
- 受影响测试：**无**（零业务代码改动 ⇒ 无受影响测试）。
- 契约/DB/执行影响：**0 契约 / 0 表 / 0 列 / 0 migration / 0 写入 / 0 执行语义变化**。

---

## 10. 独立审计的对照与回应

执行期间，另一个并发会话（Codex）在 `2026-10-11 16:03` 对本轮**中途产物**做了独立核查，
落盘为 [`AUDIT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md`](AUDIT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md)。
本报告与该审计的对照：

| # | 审计意见 | 本报告的处置 |
|---|---|---|
| 1 | 四份 CSV 的 SHA-256 / 行数 | **逐字一致**（审计 §2.3 vs 本报告 §3.9）。审计在 `s2-requirement-summary.json` 落盘**之前**做快照，因此当时未判最终验收 —— 现已补齐 |
| 2 | 必需集合 = **22,041** 键、`2023-11-06 ~ 2025-10-09`、2,837 代码、4.34% | ✅ **采纳并独立复算一致** ⇒ 新增 §3.5 与派生视图 `status-gap-requests-necessary.csv`（`derive-necessary-gaps.mjs`） |
| 3 | 「指纹必须包括判决相关字段（availability/availableAsOf/confidence/覆盖依据/派生协议版本）」 | ✅ **采纳** ⇒ IMPACT §1.2 的行级/索引级指纹定义已补这些字段，并明确**不纳入**每次运行的当前时间 |
| 4 | 「先按实际 `effectiveAt`/`availableAsOf` 过滤，再选冲突记录」（日期级 `resolveSecurityStatus` 会让下午生效的记录遮蔽早上仍有效的记录） | ✅ **采纳** ⇒ IMPACT §1.2 新增「**先过滤、后选冲突**」的强制顺序 + 同日 09:15/15:00 对照测试（§1.5 T8） |
| 5 | 「不能用实际持有天数反推未观测的尾部需求」 | ✅ **采纳** ⇒ IMPACT §5 改为分离记录 7 类证据（V-9） |
| 6 | 「先验证来源可得性，再决定大规模补数与重建」 | ✅ **已在** §7 U-1 与 IMPACT 动作 1（顺序：数据裁定 → provider → SMOKE → STUDY） |
| 7 | 「`groups` 非原子拼接」 | ✅ **采纳**（V-7）：派生视图修正；主产物**未重生成**并说明原因 |
| 8 | 「41 日读范围只涉及买点诊断，不代表收益回测只需 41 日」 | ✅ **采纳** ⇒ §3.2 增加显式限定 |
| 9 | 「S2 两趟读取重复 rd1..41」 | ✅ **登记**（V-8）为可优化项 |
| 10 | 审计自身未验证项：外部分来源可得性、逐行作业归属、尾部条件 | 与本报告 §7 的 U-1/U-2/U-4 **一致**（两边都未把它们当作已完成） |

**未采纳/需说明的一项**：审计建议「不应把 507,358 当作采购量」——本报告**同意**，
但**保留**扩展表作为完整证据（它记录了求值器实际消费的全部观察格），
两者以 §3.5 的分账并列呈现，**不删除**任何一边。

---

## 11. 终态

**`NEEDS_DATA_DECISION`**

- 现有来源**不足以**满足 004 §4 的两个检查时点（严格 PIT 可核验结论 = **0 / 1,201,475 格**）。
- **已完成**：真实来源与覆盖审计（含 7 个维度 × 7 个来源）、旧 S1 数字的独立复核、**真实需求与缺口清单**（§3）、
  provider 接口设计与验收清单、两项构建/池化缺陷的复现证据与最小修复边界、逐项影响方案与可单独审批的动作清单。
- **等待裁定**：ST 数据来源与范围（IMPACT 动作 1）；一旦裁定，动作 2–6 可分别授权、分别验收。
- 交付后**停止**：不自动接入、不写库、不重建、不发起收益研究。
