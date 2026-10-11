# IMPACT · 首板滚动池 ST 数据就绪 —— provider / 构建索引 / 池化状态 / Dataset 分项实施方案

> **用户决策更新（2026-10-11）**：本轮保留 Dataset 780004，暂不重建；此前重建建议属于未执行的历史提案，不是当前必做前置。历史 ST 检查独立处理，报告披露现有数据局限。详见 [保留数据集决策](DECISION-FIRSTBOARD-ROLLING-POOL-KEEP-DATASET-780004.md)。

> 目标标识：`FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006`
> 对应结果报告：[`RESULT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md`](RESULT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md)
> 基线：HEAD **`f8b6810`**；工作区 222 项（41 tracked-modified + 181 untracked，含并发会话）
> 终态：**`NEEDS_DATA_DECISION`**（本文件是**方案**，本轮**未实现**任何一项）
>
> 🔴 **本轮没有实现任何一项**：无代码改动、无 DDL/DML、无 migration、无 `db:push`、无新 Dataset、
> 无 Run、无 SMOKE/STUDY。本文所有「方案」均为**待审批的提案**，SQL 全部是**草案（未执行）**。

---

## 0. 分项、影响面与排序

| # | 分项 | 影响面 | 是否需要**新授权** | 是否阻塞 004 收益矩阵 | 工作量级 |
|---|---|---|---|---|---|
| **A** | ST 状态 provider 接入（S3 设计） | 研究侧新增只读状态投影；**不改** `server/securityStatus/**` 解析语义 | 需要（数据引入/来源裁定） | ✅ **是（唯一硬阻塞）** | 中 |
| **B** | 构建索引前置条件（`windows` 续跑跳过 `loadSecurityIndexes`） | `server/datasetRegistry/builder.ts#build` 的**构建期**索引前置；影响未来所有续跑构建 | 否（纯代码健壮性） | 否（但影响新 Dataset 正确性） | 小 |
| **C** | `poolStIndex` 无区间默认 `NORMAL` | `server/runWorkbenchAssembly/**` 池化读取侧 + `ResearchDatasetRow.st` 内容 | 否（但**改缺省**会影响旧 Run 可复现性 ⇒ 必须走显式政策/版本） | 否（004 走 Dataset 端口，不经此路径） | 小~中 |
| **D** | Dataset 版本决策（780004 是否重建） | `ds_first_limit_pullback_{event,prefix,post,path,outcome}` + 所有绑定 780004 的实验 | ✅ 需要（新 Dataset 构建 = DML 批量写） | 间接（执行面价格字段与 ST 事实互相矛盾） | 大（≈10.3M 行） |
| **E** | `post80` 尾部 vs 理论 `rd94/95`（**单列**） | 004 的期末未平仓/延后卖出观测；不改数据定义 | 否（先加观测） | 否（但决定 S5 披露口径） | 小 |

**排序理由**（按「阻塞研究结论的程度」而非按代码行数）：
**A 是唯一使 004 无法产出收益矩阵的原因**（provider 缺失 ⇒ 每格 `UNKNOWN_BLOCKED`）；
**D 决定 A 落地后能否拿到**正确的执行面价格字段；**B** 决定 D 重建出来的新版本是否可信；
**C** 与 004 无关（004 不经池化游标），但它是**同源的「absence 当成 NORMAL」语义缺陷**，必须单列；
**E** 是 004 自身的观测缺口，不阻塞数据决策。

---

## 1. 分项 A：ST 状态 provider 接入（S3 · **设计 only**）

### 1.1 现状与硬阻塞（实测，见 RESULT §1）

| 事实 | 实测值 |
|---|---|
| 唯一 ST 源 | `research_security_status_history`，`statusType='ST'`：**841 行 / 734 证券** |
| 状态取值 | **全部 `ST`**；`*ST` **0**；`NORMAL` **0**（全表任意维度亦为 0） |
| `availability` | **841/841 = `UNKNOWN`**（`IMMEDIATE` 0、`T_PLUS_1` 0） |
| `confidence` / `source` | 全部 `medium` / `baostock-daily` |
| `retrievedAt` | `2026-09-06 19:07:53` ~ `2026-09-09 03:01:59`（**单批次采集**） |
| 窗口内可获知（`retrievedAt <= 2025-09-30`） | **0 行** |
| 主窗口覆盖 | 2,827 证券 × 425 交易日 = 1,201,475 格；有 ST 区间生效 **30,855 格（2.57%）**；无任何 ST 行 **2,378/2,827 = 84.05%** |
| 平台行的契约强度 | `confidence=medium` ⇒ 在 `stGate.ts` 契约里记 `UNVERIFIED` ⇒ **永远不可能放行** |

⇒ 现状下**任何** provider 实现都只能返回 `UNKNOWN`。**代码修复 ≠ 数据已满足**（FIX-005 §7 同结论）。

### 1.2 接口设计（**不重写价格规则、不重写撮合**）

复用既有唯一闸门契约 `research-experiments/shared/rollingPoolRecovery/stGate.ts`
（`SecurityStatusProvider` / `SecurityStatusFact` / `evaluateStGate`，`ST_GATE_CONTRACT_VERSION = 1.1.0`）。
**新增的只是 provider 的「供给端」**，判决端**一行不改**。

```text
新增（建议放 server/researchExperiments/securityStatusProjection.ts，或 server/securityStatus/provider/**）
  ├─ loadStatusProviderIndex(input): Promise<StatusProviderIndex>   ← 批量载入入口（唯一 IO 点）
  │     input = { statusTypes:["ST"], from, to, securityIds?, asOfSource? }
  │     · 一次带日期范围下推的 SELECT，绝不按候选逐笔查询（GOAL §7 纪律）
  │     · 结果全部驻内存；返回 { facts, sourceFingerprint, coverageBasis, calendarFingerprint }
  ├─ createStatusProvider(index, options): SecurityStatusProvider    ← 注入 experiment.ts#resolveStatusProvider()
  └─ describeProviderProvider(): { providerId, contractVersion, sourceFingerprint, builtAt, coverageBasis }
```

| 设计要求 | 落点与判据 |
|---|---|
| **批量载入/查询入口** | 唯一 IO 点是 `loadStatusProviderIndex`（一次 SELECT + 内存索引）。`statusAt()` **不得**做任何 IO。运行期断言：候选数与查询数**不成正比**（用计数 spy 钉住 `ioQueryCount === 1`） |
| **身份映射** | 复用 `research_security_identifier_history` 的 PIT 语义（`effectiveFrom <= date && (effectiveTo is null or >= date)`，按 `effectiveFrom` 升序取首命中——与 `DbDatasetBuildIO#activeSecurityId` **同形**）。🔴 **不得**用 `research_securities.status`（当前快照）或股票名称回填；同一代码跨身份必须按日期取当时身份（本仓库实测 `multiIdentityCodeCount = 0`，但方案不得依赖该巧合）。解析不到 ⇒ 独立未知原因 `NO_IDENTITY_AT_DATE`（**不是** UNKNOWN 与 ST 的混合） |
| **区间索引** | `Map<securityId, Interval[]>`，按 `effectiveFrom` 升序；同一 `(securityId, statusType, effectiveFrom)` 多行时**复用** `server/securityStatus/timeline.ts#resolveSecurityStatus`（内部 `pickLatest`：`effectiveFrom` 新者优先 → confidence 高者优先 → `retrievedAt` 新者优先 → `source` 升序）。provider **不得**自建第二套冲突消解 |
| **实际时点比较** | `effectiveFrom/To` 与 `availableAsOf` 一律交给 `evaluateStGate` 的 `normalizedIntervalStart/End`（**F2 语义**：日期形式 `from`=当地 00:00、日期形式 `to` 覆盖整日 23:59:59、精确时间不扩展、非法格式拒收）。provider **不得**自己做日期算术 |
| **来源指纹** | ① 行级 `evidenceFingerprint = sha256(securityId, statusType, statusValue, effectiveFrom, effectiveTo, source, retrievedAt, availability, confidence, coverageBasisRef, derivationProtocolVersion)`（前 16 hex，进判决）；② 索引级 `sourceFingerprint = sha256(排序后的行级指纹全集)`，进 Run 的 `frozen-config.json` 与缓存键。🔴 **必须包含判决相关字段**（`availability`/`availableAsOf`、`confidence`、覆盖依据、派生协议版本）——否则「只改可信度或可知时间」会得到**相同**指纹，缓存与留档无法区分（独立审计意见 1，已采纳）；🔴 **不得**包含每次运行的当前时间戳（否则每次运行都不一致、无法对账） |
| **时间语义的顺序（🔴 独立审计意见 2，已采纳）** | **先按实际检查时刻过滤，再选冲突记录**。`server/securityStatus/timeline.ts#resolveSecurityStatus` 是**日期级**接口（`date` 只到天），若先用它选「latest」再交给 09:15 的闸门拒绝，会出现「**当日下午才生效的记录遮蔽早上仍有效的记录**」⇒ 判决错误。因此强制顺序为：<br>① 取该证券**全部**源事实（含 `effectiveFrom/To` 的日内精度与 `availableAsOf`）；<br>② 用**真正的** `effectiveAt` 过滤「区间是否覆盖检查时刻」与「当时是否可知」（F2 语义，`normalizedIntervalStart/End`）；<br>③ **在过滤后的集合上**再复用确定性优先级（`effectiveFrom` 新 → confidence 高 → `retrievedAt` 新 → `source` 升序）；<br>④ 不得为此**悄悄更改**状态权威语义（`timeline.ts` 保持日期级；provider 是**新增**的、日用级别的只读投影）。<br>测试要求：同一交易日 **09:15 与 15:00 两次查询**必须能给出**不同**判决（见 §1.5 T8） |
| **可知性** | `availableAsOf` **只能**取来源自身的公告/可得时间。平台 `baostock-daily` 行只有 `retrievedAt`，其语义是「何时写入本行」⇒ 用它充当可知性会得到「2026-09 才可知」，**正确且必须保留**。任何「把 2026 改写成 2024/2025」的做法**禁止** |
| **冲突优先级** | ① 同一 `(security,date)` 上 ST 与 NORMAL 同时生效 ⇒ 按 `pickLatest`（见上）**确定性**取一；② `confidence` 不足 ⇒ UNKNOWN（失败关闭）；③ 无区间 ⇒ UNKNOWN（**absence ≠ NORMAL**） |
| **未知原因** | provider 只允许产出 `ST_GATE_REASONS` 闭集内的原因（`NO_STATUS_FACT` / `NOT_AVAILABLE_AS_OF` / `NOT_EFFECTIVE_ON_TRADE_DATE` / `NORMAL_INTERVAL_UNBOUNDED` / `UNVERIFIED_STATUS_EVIDENCE` / `PROVIDER_CONTRACT_MISMATCH` / `SYMBOL_MISMATCH` / `INVALID_STATUS_TIME_FORMAT`）。provider 内部原因（如 `NO_IDENTITY_AT_DATE` / `COVERAGE_GAP`）只进**诊断产物**，**不改变判决字面量** |
| **缓存失效** | 缓存键 = `{providerId, contractVersion, sourceFingerprint, intervalRowCount, maxRetrievedAt, identityFingerprint, calendarFingerprint}`。任一项变化 ⇒ 整份失效（**不得**跨不一致坐标复用）。🔴 缓存**不进**持久化 JSON 的函数面（沿用 FIX-005 F1 第 5 条） |
| **契约版本** | 沿用 `1.1.0`；形状变更必须升版（旧版本记 `PROVIDER_CONTRACT_MISMATCH` = UNKNOWN，失败关闭）。Run 的 `frozen-config.json` 必须记录 `providerId + contractVersion + sourceFingerprint + coverageBasis` |
| **判决面** | 只返回 `NORMAL` / `ST` / `UNKNOWN`。**不含**价格规则、不含撮合、不含排序、不读 `ds_*` 执行面字段 |

### 1.3 派生 NORMAL：**有界区间重建协议（待审核，本轮不得实施）**

> GOAL §5 允许**评估**该路线，但明确它是**待审核协议**，**不得**在本轮改变现有状态语义。

**协议（提案）**：`NORMAL` 区间可由「**可信初始状态 + 完整历史变更/公告 + 覆盖证明**」重建，输出**显式、有界**的区间：

1. **覆盖证明（coverage basis）**：来源必须能声明「对某证券、某时间窗，其状态变更**已被穷尽枚举**」。
   可接受的证明形态：交易所逐日 ST/特别处理名单的**完整序列**（可证明当日无 ST = NORMAL），
   或「初始状态名单（截至 T0）+ T0 之后全部实施/撤销公告」的完整变更流。
   **不可接受**：日线 `isST=0` 的缺口反推（`baostockStatus.ts` 模块注释已自认 `tradestratus/isST`
   是权威字段，但**合并成区间是 gap inference**，区间边界不可凭日线确定）。
2. **有界性**：派生出的 NORMAL 区间 `effectiveTo` **不得**为 `null`（`stGate.ts` 第 9 步会把无界阳性区间
   判 `NORMAL_INTERVAL_UNBOUNDED` = UNKNOWN）。区间边界必须由「下一个已证实的变更」或「覆盖窗终点」封闭。
3. **缺失源识别**：必须能枚举「哪些 (证券, 期间) **没有**覆盖依据」⇒ 那些格保持 `UNKNOWN`（**不派生**）。
4. **可知性**：派生区间的 `availableAsOf` = 使其成立的证据（初始名单公布日 / 最后一次相关公告日）的
   **最晚者**；**不得**用 `retrievedAt`、**不得**用未来信息。若来源给不出公告时间 ⇒ `confidence=UNVERIFIED` ⇒ UNKNOWN。
5. **版本化**：派生协议必须自带版本号（如 `derived-normal/0.1.0`）+ 覆盖依据指纹 + 每个区间的
   `derivationEvidence`（哪些源条目使其成立）。协议升版 ⇒ 全部派生区间失效重算。
6. **与当前显式记录契约的兼容**：当前契约要求 **NORMAL 必须有明确记录**（`types.ts`：
   「NORMAL 也必须是显式记录，无记录 ≠ NORMAL」）。派生区间如果要落库，**必须**作为**显式区间行**写入
   （`statusValue='NORMAL'` + 真实 `availability` + 可核验 `source`），**不得**在读取侧隐式补 NORMAL。
   ⇒ 两种兼容路径：
   - **路径 1（推荐先做）**：provider **内存态**派生，不落库；`evidenceFingerprint` 与 `sourceFingerprint`
     进 Run 留档。DB 不改（**0 DDL**），但派生可复现性依赖来源快照（需把来源原始行归档/指纹化）。
   - **路径 2**：把派生 NORMAL 区间**显式落库**（DML 批量写 ⇒ 需单独授权 + 影响报告）。优点是可被现有
     `timeline.ts` / `poolStIndex` 等所有读取方共享；缺点是引入「派生 vs 官方」的记录混合，需要
     `source`（如 `derived-normal@SSE_ST_LIST`）与版本列区分。
7. **完全没有覆盖依据的证券**：保持 `UNKNOWN`（GOAL §5 明文）。

**🔴 禁止项（GOAL §5 逐条）**：
把 2026 年 `retrievedAt` 改写成 2024/2025 年公告时间；批量把 `availability` 改成 `IMMEDIATE`；
用未来的状态变化或事后摘帽信息为历史买入提供当时不可知的证据。

### 1.4 合成样例（provider 供给端验收用；**纯合成、不连 DB**）

| # | 输入（fact / 索引状态） | 检查时刻 | 期望判决 | 理由 |
|---|---|---|---|---|
| A1 | 无任何覆盖依据（索引无该 securityId 条目） | 2025-04-30T09:15:00 | `UNKNOWN` / `NO_STATUS_FACT` | absence ≠ NORMAL |
| A2 | 派生 NORMAL `[2024-01-02, 2024-06-30]`，`availableAsOf=2024-01-02`（公告当日） | 2024-03-01T15:00:00 | `NORMAL` | 有界 + 当时可知 + 区间覆盖 |
| A3 | 同 A2，但检查时刻 `2025-01-02` | 2025-01-02T15:00:00 | `UNKNOWN` / `NOT_EFFECTIVE_ON_TRADE_DATE` | 区间已失效 |
| A4 | NORMAL `effectiveTo = null`（无界） | 2024-03-01T15:00:00 | `UNKNOWN` / `NORMAL_INTERVAL_UNBOUNDED` | 无界阳性不可证伪 |
| A5 | 派生 NORMAL `availableAsOf = 2025-01-01`（事后才公告） | 2024-03-01T15:00:00 | `UNKNOWN` / `NOT_AVAILABLE_AS_OF` | 当时不可知 |
| A6 | NORMAL `[d 00:00:00, d 09:00:00]` | d T09:15:00（PRE_FILL） | `UNKNOWN` / `NOT_EFFECTIVE_ON_TRADE_DATE` | F2 时点语义 |
| A7 | NORMAL `[d 08:00:00, d 23:59:59]` | d T09:15:00 | `NORMAL` | F2 时点语义 |
| A8 | NORMAL 日期形式 `effectiveTo = d` | d T15:00:00（确认日） | `NORMAL` | 日期终点覆盖整日 |
| A9 | 无效格式 `effectiveTo = 2024-1-04` | 任意 | `UNKNOWN` / `INVALID_STATUS_TIME_FORMAT` | 拒收而非字典序放行 |
| A10 | provider `contractVersion = "1.0.0"` | 任意 | `UNKNOWN` / `PROVIDER_CONTRACT_MISMATCH` | 失败关闭 |
| A11 | ST 与 NORMAL 区间重叠于同一格 | 该日 | 与 `resolveSecurityStatus` **同值** | 冲突消解只有一处实现 |
| A12 | 同一代码两个身份、日期各属其一 | 两个日期各查一次 | 各取当时身份；跨身份日期 ⇒ 另一个身份的结果 | 不得跨身份混用 |
| A13 | 平台真实行（`confidence=medium`）直接喂入 | 2025-04-30T15:00:00 | `UNKNOWN` / `UNVERIFIED_STATUS_EVIDENCE` | 现状必然结论 |

### 1.5 测试验收清单（**只补新行为测试，不放松既有断言**）

| # | 测试 | 断言 |
|---|---|---|
| T1 | 合成样例 A1–A13 逐条 | 判决与 reason **逐字**匹配 |
| T2 | 批量载入的 IO 计数 | 索引载入后对 N 个候选的 `statusAt` 调用产生 **0** 次 DB 查询（spy 计数） |
| T3 | 缓存失效 | 改 `sourceFingerprint` / `identityFingerprint` / 日历 ⇒ 命中率归零、判决按新源重算 |
| T4 | 四类「不买」真实撮合回归 | 沿用 `rollingPoolRecoveryStExecutionGate.test.ts`（25 例）与 `StAuxiliaryAssembly.test.ts`（7 例）**不改**，新增 provider 用例后仍全绿 |
| T5 | 结构守卫 | AST/import 守卫：provider 模块**不得** import `server/research/simulator/**`、`server/backtest/**`、价格规则模块（防止把价格规则搬进来） |
| T6 | 契约缺省不变 | 未注入 provider 时（`resolveStatusProvider() === null`）既有 digest 基线**逐字节不变**（复用 `scripts/_scratch/recovery-st-fix005/probe-digest-baseline.mts` 的固定输入） |
| T7 | 覆盖证据产物 | `status-coverage.csv` 的 `UNKNOWN` 格数与 `status-gap-requests.csv` 的去重缺口数**一致**（同一来源，不得两套口径） |
| T8 | **同日 09:15 / 15:00 对照**（独立审计意见 2） | 造两条**同日**事实：`[d 00:00:00, d 09:00:00]` 与 `[d 08:00:00, d 23:59:59]` ⇒ `PRE_FILL(09:15)` 必须判**后者**为 NORMAL、前者为 UNKNOWN；`CONFIRM_CLOSE(15:00)` 必须判后者为 NORMAL。**禁止**先用日期级 latest 选一条再靠闸门拒绝 |
| T9 | **必需集合口径一致**（独立审计意见 2 的统计侧） | provider 就绪后重跑需求枚举 ⇒ `status-gap-requests-necessary.csv` 的必需键数**不减少**（覆盖只增不减），且**新增**的 NORMAL 结论只出现在已覆盖的键上 |

### 1.6 关键不确定项（如实登记）

- **来源可得性**：交易所逐日 ST 名单/实施公告的**完整历史 + 公告时间**是否可得、成本多少，本轮**未联网核验**（GOAL 允许少量权威样例，但不付费、不批量）。
- 平台已有的 `baostockStatus.ts#inferStIntervals` 只产 ST 片段，**不产 NORMAL**；若继续用 BaoStock，必须补「完整覆盖证明」这一层（否则 84% 的证券仍只能 UNKNOWN）。

---

## 2. 分项 B：构建索引前置条件（缺陷 1）

### 2.1 代码证据

```text
server/datasetRegistry/builder.ts#build
  eventCount = checkpoint.phase === "windows"
      ? (await this.io.listEvents(config.datasetVersionId)).length     ← 跳过 buildEvents
      : await this.buildEvents(...)                                     ← 只有这条分支里才有 loadSecurityIndexes()

server/datasetRegistry/builder.ts#buildEvents            L516: await io.loadSecurityIndexes();
server/datasetRegistry/builder.ts#buildWindowsAndOutcomes  ← **不调用** loadSecurityIndexes()

server/datasetRegistry/db.ts#DbDatasetBuildIO
  private readyIndex: SecurityIndex | null = null;         ← 实例级状态，未预热即 null
  #resolveStSync / #resolveSuspensionSync / #resolveListingAgeDaysSync 全部依赖 syncedIndex
  ⇒ 未预热：resolveStSync 恒 "UNKNOWN"、resolveSuspensionSync 恒 "UNKNOWN"、上市龄恒 null

server/datasetRegistry/executionFacts.ts#deriveExecutionFacts
  ratio = limitUpRatio(symbol, stStatus, tradeDate)        ← 主板上 ST/*ST ⇒ 0.05，其余（含 UNKNOWN）⇒ 0.1
  canBuyAtOpen  = barPresent && !SUSPENDED && openAtLimitUp !== true     ← **与 ST 无关**
  canSellAtClose= barPresent && !SUSPENDED && closeAtLimitDown !== true  ← **与 ST 无关**
```

**实测后果**（本文档同目录探针，见 RESULT §1/§4）：
780004 的 `ds_first_limit_pullback_post` 4,718,640 行中，`suspensionSource='PIT_STATUS'` 仅 **264,042 行（5.6%）**，
其余 **4,454,598 行（94.4%）** 是 `suspensionStatus='UNKNOWN'`；`limitRuleUp=0.05` 只有 **7,368 行**且全部落在
`2019-01-23 ~ 2019-08-28`。构建作业时间线与之吻合：

| 作业 | 状态 | 起点 | 断点 | 说明 |
|---|---|---|---|---|
| `900004` | FAILED | 2026-10-08 06:38:30 | `phase=windows, lastTradeDate=2019-04-02`，`processedRows=426,688`，`completedChunks=2,461/60,620` | **本作业跑了 events 阶段（索引已预热）并写了前 2,461 片窗口**，随后在 `nsert into ds_first_limit_pullback_post` 处失败 |
| `900005`~`900009` | FAILED | 06:54–06:57 | 同上，`completedChunks=0` | 从 `windows` 断点续跑 ⇒ **跳过 `buildEvents`** ⇒ 索引未预热 ⇒ 快速失败 |
| `900010` | **COMPLETED** | 08:41:38 → 09:13:48（**1,930 s**） | `processedRows=10,261,516`，`completedChunks=58,983/60,620` | 同样从 `windows` 断点续跑 ⇒ **索引未预热** ⇒ 此后续写的每一行状态字段静默退化 |

⇒ 5% 带（`2019-01-23~2019-08-28`）＝ `900004` 在冷启动窗口里写下的那一段；
其余全部退化为 `0.1` / `UNKNOWN`。**诚实边界**：这是「与全部观测一致、机制可复现」的定位
（**未**重跑构建做逐行归属）；但结论不受影响 —— **落库字段与平台 ST 历史互相矛盾，不可用作 ST 证据**。

### 2.2 最小修复边界（**不改任何判定口径**）

**目标**：首次构建、`events` 续跑、`windows` 续跑、以及任何边界早返回，**四条路径具有一致的索引前置条件**。

**推荐方案（最小）**：把预热**提升到 `build()` 的唯一入口**，使其与阶段分支解耦：

```text
async build(config, reportProgress) {
  const tradingDays = await this.io.loadTradingDays();
  ...
  await this.io.loadSecurityIndexes();          // ← 新增：唯一前置点（幂等；已在 buildEvents 内存在同一调用）
  const eventCount = checkpoint.phase === "windows" ? ... : await this.buildEvents(...);
  ...
}
```

- `DatasetBuildIO#loadSecurityIndexes` 的契约注释已要求「必须在任何 `resolveStSync` 之前调用一次」——
  本方案把它从「某条分支的内部调用」变成**编排层的显式前置**，语义与既有契约一致。
- **幂等**：`DbDatasetBuildIO#loadSecurityIndexes` 已有 `if (this.readyIndex) return;` + `readyPromise` 去重
  ⇒ 重复调用零成本（测试夹具实现需同样幂等）。
- **断点与幂等逻辑不动**：`windows` 分支仍用 `listEvents().length`；`resumeTradeDate` 仍跳过已写入的日期；
  `ON DUPLICATE KEY` 语义不变。
- **边界早返回一致**：`windowStartIdx > windowEndIdx`（空窗口）等早返回此前会跳过 `buildEvents`
  ⇒ 现在**同样**先预热。这里是「防御性一致」而非性能问题（索引载入实测 ~230 ms 量级的小表全量）。

**加一条防御性断言（可选但建议）**：在 `buildWindowsAndOutcomes` 开头断言索引已预热，
否则**响亮抛错**（新增 `DatasetBuildIO#assertSecurityIndexesLoaded?()` 可选方法，或复用
`resolveStSync` 的返回语义做一次性自检）。理由：把「静默降级」变成「响亮失败」——
这正是本次事故的根因（**没有任何断言要求索引已就绪**）。

**明确不做的**：不重算历史行、不回填 780004、不改 `deriveExecutionFacts` 口径、
不改 `isStExcluded` 语义（UNKNOWN 仍放行，但**构建期索引就绪后** UNKNOWN 的语义变成「无可核验记录」而不是「忘了加载」）。

### 2.3 测试（新增行为测试）

| # | 测试 | 断言 |
|---|---|---|
| B1 | **新建 vs `windows` 续跑输出等价** | 同一内存夹具：① 全量构建；② 在 windows 中途快照后以 `phase='windows'` 续跑 ⇒ 两个版本的五表行**逐字节相同**（含 `limitRuleUp` / `suspensionStatus` / `suspensionSource`） |
| B2 | 索引前置顺序 | 夹具记录调用序列 ⇒ 任何 `resolveStSync/resolveSuspensionSync/resolveListingAgeDaysSync` 之前**必有** `loadSecurityIndexes`；`windows` 续跑分支亦然 |
| B3 | 边界早返回 | 空窗口（`windowStartIdx > windowEndIdx`）与 `startDayIdx > windowEndIdx` 两条早返回路径**同样**满足 B2 |
| B4 | `events` 续跑不回归 | 既有 `tests/server/datasetRegistry/builder.test.ts`（resume/幂等/排除 ST）**全绿不改** |
| B5 | 幂等 | 同一配置重复 `build()` ⇒ 行数不变、行内容不变（既有断言的加强用例，**新增**不修改旧断言） |
| B6 | 响亮失败 | 未预热就调用 `buildWindowsAndOutcomes`（若采纳断言）⇒ 抛具名错误而非静默 `UNKNOWN` |

### 2.4 影响面

| 项 | 影响 |
|---|---|
| 旧 Dataset（780001–780005） | **不变**（本方案不改数据；仅影响**未来**构建/续跑） |
| 旧 Run | **不变**（构建期代码路径与运行期实验无关） |
| 幂等/断点 | **不变**（唯一新增是幂等预热 + 可选断言） |
| `dataset_build_job` | 无 schema 变化；续跑语义不变 |
| 建议登记 | `CHANGE-AUDIT.md`（实现细节）+ EXECUTION-FLOW 的构建链小节（若加断言则为新增入口 ⇒ minor） |

---

## 3. 分项 C：`poolStIndex` 无区间默认 `NORMAL`（缺陷 2）

### 3.1 代码证据与直接消费者

```text
server/runWorkbenchAssembly/poolStIndex.ts#createPoolStIndexFromRows
  resolve(securityId, tradeDate) {
    const intervals = bySecurity.get(securityId);
    if (intervals === undefined) return "NORMAL";     ← 🔴 无任何区间 ⇒ NORMAL
    for (...) { if (命中) return interval.status; }
    return "NORMAL";                                  ← 🔴 有区间但当日不覆盖 ⇒ NORMAL
  }
```

**直接消费者（全仓只有一处运行期消费者）**：

| 消费者 | 位置 | 用途 |
|---|---|---|
| `server/runWorkbenchAssembly/datasetFromRegistry.ts` | L1173 `const stIndex = poolPolicy.excludeSt === true ? await loadPoolStIndex() : null` | 仅当池化策略显式 `excludeSt=true` 才载入 |
| 同上 | L1175–1186 事件日过滤 | `stIndex.resolve(canonical, event.tradeDate)` ∈ {ST,*ST} ⇒ 剔除该事件并计 `stExcludedEventCount` |
| 同上 | L1211–1214 `stResolver` | 注入 `createPooledDatasetCursor` |
| `server/runWorkbenchAssembly/pooledDatasetCursor.ts` | L144–147 `toResearchDatasetRow` 的 `st` 字段 | 池化行的 `ResearchDatasetRow.st` |
| 同上 | L349–357 | 池期内 `st ∈ {ST,*ST}` ⇒ `member.retired = true`（当日移池，不再产生买入意图） |

⇒ `NORMAL` 缺省直接污染：**`ResearchDatasetRow.st`（内容寻址）、事件日过滤计数**；
**不**影响「移池」判定（只在 `ST/*ST` 时移池，`NORMAL` 与 `UNKNOWN` 等价）。

### 3.2 现有测试契约（**不得放松**）

```text
tests/server/runWorkbenchAssembly/poolStIndex.test.ts
  · "区间内命中 ST / *ST，区间外与非 ST 取值都视为非 ST"
      expect(index.resolve("sec_a", "2024-01-09")).toBe("NORMAL");   ← 区间外 = NORMAL
  · "未知证券 / NORMAL 取值视为非 ST（与建库 filter#isStExcluded 同口径）"
      expect(index.resolve("sec_unknown","2024-02-01")).toBe("NORMAL");
      expect(index.resolve("sec_b","2024-02-01")).toBe("NORMAL");
```

⇒ 这两条断言**钉住的是旧口径**。按 GOAL §6「只补新行为测试，不能放松既有断言掩盖口径变化」，
**不得**把这两条改成 `UNKNOWN`；正确做法是**新增一条显式政策/路径**，让旧断言在新政策下仍然成立。

### 3.3 为什么不能「全局一行改成 UNKNOWN」

| 后果 | 具体 |
|---|---|
| **旧 Run 不可复现** | `ResearchDatasetRow.st` 是数据集**内容**的一部分；池化读取用它算 `versionSnapshotFingerprint` / 内容寻址串（`computeDatasetVersionStreaming`）。把 84% 的行从 `NORMAL` 改成 `UNKNOWN` ⇒ 同一份输入得到**不同的数据集版本** ⇒ 旧池化 Run 的坐标与留档不再可复算 |
| **统计口径静默变化** | 任何「`st=NORMAL` 计数」「非已知 ST」口径都会变（即便「是否剔除」不变） |
| **风险倒挂** | `UNKNOWN` 在 `isStExcluded` / `universe.ts#excludeSt` / 移池逻辑里与 `NORMAL` **同样放行** ⇒ 改成 UNKNOWN **不会**多剔除任何成员，只增加不确定性标记；真正的风险是「把 absence 当 NORMAL」被下游读成「有 NORMAL 证据」 |
| **与严格契约冲突** | `server/securityStatus/types.ts` 明文「NORMAL 也必须是显式记录，无记录 ≠ NORMAL」⇒ 缺省 `NORMAL` 与该权威契约直接冲突，**是缺陷**，但修复必须**显式**（政策/版本），不能改缺省语义 |

### 3.4 方案：显式政策 + 严格研究路径

```text
server/runWorkbenchAssembly/poolStIndex.ts
  export const POOL_ST_POLICY_VERSION = "pool-st-absence/2.0.0";
  export type PoolStAbsencePolicy = "LEGACY_NORMAL" | "STRICT_UNKNOWN";
  export function createPoolStIndexFromRows(rows, options?: { absencePolicy?: PoolStAbsencePolicy })
      · 缺省 absencePolicy = "LEGACY_NORMAL"  ⇒ 与今天**逐字节相同**（旧测试、旧 Run 不变）
      · "STRICT_UNKNOWN" ⇒ 无区间 / 未覆盖 ⇒ "UNKNOWN"
  export function loadPoolStIndex(options?: { absencePolicy?: PoolStAbsencePolicy })
      · 缓存键必须含 absencePolicy（否则两种政策互相污染进程内缓存）
```

- 严格政策**只**由显式研究路径开启（例如池化请求/装配摘要里的新可选字段，
  并在 Run 留档里记录 `poolStAbsencePolicy` + `POOL_ST_POLICY_VERSION`）。
- 缺省不启用 ⇒ **旧路径缺省行为与已验证指纹不变**（GOAL §6 明确要求）。
- 建议同时给 `PoolStIndex` 加一个显式的 `coverage: { intervalCount, securitiesWithIntervals, unresolvedCount }`
  只读诊断面，让「多少行其实是缺省值」可对账。

### 3.5 逐字段影响（GOAL §6 要求逐项解释）

| 字段 | 由谁产生 | `windows` 续跑退化后的实测 | `poolStIndex` 缺省 NORMAL 的影响 | 修复后应该是什么 |
|---|---|---|---|---|
| **ST** | 构建期 `resolveStSync`（`limitRuleUp` 的输入）+ 读取期 `poolStIndex`/`stResolver` | `limitRuleUp=0.05` 仅 7,368 行（5.6% 窗口带 PIT 状态；94.4% 退化） | `ResearchDatasetRow.st` 84% 假 `NORMAL` | 构建期索引必须就绪（分项 B）；读取期缺省必须显式为政策（分项 C） |
| **涨跌停价格规则** | `deriveExecutionFacts` → `resolveLimitRulesAt(code, date, stStatus)`：主板 ST/*ST ⇒ **0.05**，其余（**含 UNKNOWN**）⇒ 0.1 | 主窗口 4,711,272 行全 0.1（真实 ST 日应为 0.05） | 无（读取期不算涨跌停） | ST 格必须 0.05；UNKNOWN 仍 0.1 但**必须可追溯到原因** |
| **停牌** | `resolveSuspensionSync`（PIT `TRADING`/`SUSPENSION` 维度）；退化 ⇒ `{UNKNOWN,UNKNOWN}` | `NOT_SUSPENDED/PIT_STATUS` 264,042 行；`UNKNOWN` 4,454,598 行 | 无 | 与 ST 同源、同一次预热；缺失 ⇒ UNKNOWN（`deriveExecutionFacts` 的 `tradable` 只排除 `SUSPENDED`，UNKNOWN 会被当成可交易 —— **已知保守性缺口**，需在严格路径单列） |
| **上市龄** | `resolveListingAgeDaysSync`（`research_securities.listedDate`，PIT 身份） | 未预热 ⇒ 恒 `null`（`excludeListedWithinDays=365` 的事件筛选在 `buildEvents` 内，那一段是有索引的） | 无 | 与 ST 同一预热；缺失 ⇒ `null`（不猜） |
| **可买 / 可卖标志** | `deriveExecutionFacts`：`tradable = barPresent && !SUSPENDED`；`canBuyAtOpen = tradable && openAtLimitUp !== true`；`canSellAtClose = tradable && closeAtLimitDown !== true` | 🔴 **`canBuyAtOpen` 只有「停牌 + 开盘涨停」语义，与 ST 无关**（`limitRuleUp` 通过 `limitUpPrice` 间接影响 `openAtLimitUp`/`closeAtLimitDown`） | 无 | 保持「与 ST 无关」的语义；**禁止**把 `canBuyAtOpen` 当 ST 指示器（PREREG §4.2 已禁） |

### 3.6 「948 格」的证据质量分辨（历史审计样例，**不是 948 笔交易**）

- 该数是「主窗口 rd1..20 的 (事件 × 相对日) **检查格**」与平台 ST 区间的**交集格数**，
  **不是**交易数、不是候选数、不是股票数。
- 本轮**独立复测**：rd1..20 检查格 **368,620**（事件 18,431 / 证券 2,827），其中
  平台 ST 区间生效 **973 格**（`limitRuleUp=0.1` 全部；`canBuyAtOpen=1` 962 格、
  `canBuyAtOpen=0` 11 格；`suspensionStatus` 全 `UNKNOWN`）。
  ⇒ 与历史审计的 **948** 相差 **+25（+2.6%）**，分母也相差 +1,710；
  **两套数各自内部一致**，差异来自分母构造（见 RESULT §5 的差异登记），结论不变。
- **证据质量分辨**：交集两侧都是「低质量」——
  ① 平台侧：`confidence=medium`、`availability=UNKNOWN`、`retrievedAt` ∈ 2026-09 ⇒ 严格 PIT 下**不可知**；
  ② 数据集侧：`limitRuleUp=0.1`、`suspensionStatus=UNKNOWN` ⇒ 由**未预热索引**写下的静默降级。
  ⇒ 因此**不能**说「平台说它是 ST、数据集说是正常，所以其中一个错了」——正确的说法是
  **两侧都不是可核验证据**；能确定的只有「数据集的执行面字段与平台记录不一致」这一条**值得修复**。
- **修复前必须先复现并分辨**：本文档已复现（973 格 + 字段组合 + 作业时间线）；
  **逐行归属**（哪一轮写了哪一行）**未做**（未重跑构建），如实登记为未完成项。

---

## 4. 分项 D：Dataset 版本决策

### 4.1 是否必须新版本？（明确判定）

**判定：需要新版本 —— 但只在「同时要跑策略/执行」时是硬需求；对 004 的 ST 闸门本身不是。**

依据（逐条）：

1. `ds_first_limit_pullback_post` 的 `limitUpPrice` / `limitDownPrice` / `limitRuleUp` /
   `limitRuleVersion` / `openAtLimitUp` / `closeAtLimitDown` / `canBuyAtOpen` / `canSellAtClose` /
   `suspensionStatus` 都是**构建时固化**的字段（不变量 I-1），**不可后改**。
2. 主窗口 4,711,272 行按 10% 计算涨跌停价，而真实 ST 日应为 5% ⇒
   ① 真实 5% 涨停开盘日**不会**被标成 `openAtLimitUp` ⇒ `canBuyAtOpen=1`（数据集说可买）；
   ② 真实 5% 跌停收盘日**不会**被标成 `closeAtLimitDown` ⇒ `canSellAtClose=1`（数据集说可卖）。
   ⇒ 这**直接影响撮合**（买入/卖出的可成交判定），不只影响标签。
3. 004 的 ST 闸门**不读**这些字段（它读 `securityStatus` provider）⇒ provider 补齐后 004 的**ST 拒单**是对的；
   但 004 的**成交价/可成交性**仍走这些字段 ⇒ 若 ST 期间持仓需要卖出，`canSellAtClose` 的错误会**污染交易路径**。
4. 因此：**若要产出一份「执行面与 ST 事实一致」的研究结果，必须新版本**；
   若只想验证 ST 闸门与买点机制（少数 ST 日的可卖性误差另行披露），可先在**不改 780004** 的前提下跑，
   但必须把该限制写进结果与披露，**不得**声称执行完全正确。

### 4.2 需重建哪些层 / 规模 / 耗时

| 层 | 行数（780004 实测） | 是否受影响 | 重建 |
|---|---|---|---|
| `ds_first_limit_pullback_event` | **58,983** | `limitRuleUp` 由 `resolveStSync` 决定；事件日全部 0.1（该阶段有索引） | 建议一并重建（口径一致），但**不是**必需的修复项 |
| `ds_first_limit_pullback_prefix` | **647,287** | 无状态字段（纯 OHLCV） | 不必（可原样复用/复制） |
| `ds_first_limit_pullback_post` | **4,718,640** | 🔴 状态与价格规则字段全部受影响 | **必须重建** |
| `ds_first_limit_pullback_path` | **4,718,640** | 由 post 派生（`isBreakout` 等） | **必须重建**（与 post 一致） |
| `ds_first_limit_pullback_outcome` | **176,949** | 由 post 派生（horizon 5/10/20） | **必须重建** |
| 合计 `totalRows` | **10,320,499** | — | 全量重建 ≈ **10.3M 行** |

**耗时（实测 basis，不是承诺）**：
- 唯一一次成功写完整版本的作业 `900010`：**1,930 s（32.2 min）**，`processedRows = 10,261,516`，`completedChunks = 58,983/60,620`。
  ⚠️ 该作业是从 `windows` 断点续跑（**跳过 events 阶段**）且**索引未预热** ⇒
  ① 耗时**不含** events 阶段；② 它写出的行**正是**要修的那些。
- ⇒ 一份**干净的全量重建**（含 events 阶段 + 索引预热）**必然 > 32 min**；
  按同一 `processedRows` 吞吐线性外推约 **1~1.5 h** 量级。
  🔴 这是**外推**，不是实测；**不得**作为承诺（GOAL §7「不承诺倍数提速」同精神）。

### 4.3 与旧输入对账方案

1. **事件宇宙不变**：新版本 `eventId` 集合（排序后）与 780004 **逐字节相同**；`tradeDate` 上下界相同（2019-01-02 ~ 2025-09-26）；`totalEvents == 58,983`。
2. **行数对账**：prefix/post/path/outcome 行数与 780004 相同（除非出现 `barPresent` 口径差异，需逐类列出）。
3. **差分只应出现在状态派生列**：逐行比较 `limitRuleUp` / `limitRuleDown` / `limitRuleVersion` /
   `suspensionStatus` / `suspensionSource` / `limitUpPrice` / `limitDownPrice` /
   `openAtLimitUp` / `closeAtLimitDown` / `canBuyAtOpen` / `canSellAtClose`；输出三张表：
   （a）变化行数、（b）变化格按 (年, limitRuleUp 前后) 的分布、（c）**应为 ST 却仍非 5%** 的残留格数（必须为 0，
   否则说明覆盖仍不完整）。
4. **不得原地改写 780004**（GOAL §6 明文）。新版本用**新 `datasetVersionId`**；780004 保持只读基线。
5. 旧 Run / 旧策略绑定 780004 者**零影响**（新版本是新增坐标）。

### 4.4 DB 变更影响报告（**先判现有表是否足够**）

**结论：本项修复本身不需要 DDL。**
- 重建 Dataset = 往**已存在**的 5 张 `ds_first_limit_pullback_*` 表写**新版本行**（DML 批量写）⇒ 需单独授权，但**无 schema 变化**。
- ST 状态若要落库（分项 A 的路径 2：显式 NORMAL 行）⇒ 也是往已有 `research_security_status_history` **写 DML**，
  `statusValue` 是 varchar、`statusType` 枚举已含 `ST`，**无需 DDL**。

**可选的 DDL（仅当需要「可审计的覆盖证明」时）**——下列为**草案，本轮未执行**：

```sql
-- DRAFT ONLY / NOT EXECUTED
-- Reason: provider 需要逐 (证券, 期间) 的覆盖依据，才能把 absence 与 NORMAL 区分开；
--         现有表只有「状态区间」，没有「来源覆盖声明」的位置。
-- Affected Tables: 新增 research_security_status_coverage（只增不改；无 FK，沿用软引用纪律）
-- Compatibility: 纯新增表 ⇒ 旧代码/旧数据零影响；无读取方在旧路径上依赖它
CREATE TABLE IF NOT EXISTS `research_security_status_coverage` (   -- @guard: table_not_exists
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `securityId` VARCHAR(48) NOT NULL,
  `statusType` VARCHAR(16) NOT NULL,
  `periodFrom` DATE NOT NULL,
  `periodTo` DATE NOT NULL,
  `source` VARCHAR(64) NOT NULL,
  `sourceFingerprint` CHAR(64) NOT NULL,
  `announcedAt` DATETIME NULL,          -- 来源自身的公告/可得时间；NULL = 未知（不得用 retrievedAt 冒充）
  `availability` ENUM('IMMEDIATE','T_PLUS_1','UNKNOWN') NOT NULL,
  `confidence` ENUM('high','medium','low') NOT NULL,
  `retrievedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_ssc_security_period` (`securityId`, `statusType`, `periodFrom`, `periodTo`)
) ENGINE=InnoDB;
-- Rollback: DROP TABLE IF EXISTS `research_security_status_coverage`;（纯新增表，回滚即删表；不触碰任何存量表）
-- Validation: ① apply 两次 ⇒ 第二次 0 executed / 1 skipped（幂等）；② 只读对账：每个
--   (securityId, statusType) 的覆盖区间并集必须覆盖 provider 宣告的窗口，否则该窗口保持 UNKNOWN；
--   ③ 读侧断言：provider 在无 coverage 行时**必须**返回 null（对应测试 T1-A1）。
```

---

## 5. 分项 E：`post80` 尾部 vs 理论 `rd94/95`（**单列，不合并**）

### 5.1 现状

| 项 | 值 | 来源 |
|---|---|---|
| Dataset 物理 post 上界 | `rd80`（`MIN=1 / MAX=80`，实测 4,718,640 行） | 本文档探针 + `getPostRelativeDayRange` |
| 004 的理论需求 | `entryFillMaxRd(20) + RUNNER_EXTEND_HOLDING_DAYS(74) = **94**` | `experiment.ts#run` 的 `REQUIRED_POST_RELATIVE_DAY` 与 `result.ts` 的 `requiredPostRelativeDayForFullRunner` |
| 上一轮（003/旧规则）实测 | `tradesOpenAtEnd=0`、`noExecutionBarCount=0`、`suspendedCannotSellCount=0`、`heldToExtendedCapCount=0`；`runnerTriggerObservability=UNOBSERVABLE` | `_scratch/fbp3/formal-run.json`（AUDIT §3.2） |
| 004 当前的尾部**观测** | **没有**逐笔尾部记录器；只有一条 `log(...)` 警告 + `result.ts` 的说明文本 | 代码实查 |

### 5.2 怎么检查「实际执行尾部需求」（**先加观测，不改数据定义**）

> 🔴 **独立审计意见 3（已采纳）**：**不能**用「实际持有天数」反推未观测的尾部需求 ——
> 那描述的是**已观测路径**；缺尾导致的**未平仓/截断**本身会**低估**本来需要的数据。
> 因此必须把下列 7 类证据**分开记录**，再判尾部是否足够：

| # | 记录项 | 来源 |
|---|---|---|
| 1 | **已观测退出日**（`exitRd`）与退出原因 | 引擎 `Trade.exitTime` / `exitReason` |
| 2 | **策略触发后的计划持有上限**（`plannedHoldingCap` = 冻结政策的 `extendToHoldingDays`/`maxHoldingDays`） | 冻结 Runner 政策 `loadFrozenRunnerPolicyBundle` |
| 3 | **实际缺 bar 次数**（`noExecutionBarCount`） | 撮合时点无 bar |
| 4 | **不可卖（跌停/停牌）导致无法退出**的次数与顺延天数（`suspendedCannotSellCount` / `mtmValidCount`） | 引擎退出循环 |
| 5 | **截断证据**：`exitRd` 是否恰好落在 `post` 物理上界（rd80） | 数据集物理上界 |
| 6 | **期末未平仓**（`tradesOpenAtEnd`）与其「若无截断本应何时退出」的理论下界 | `finalizeOpenTrades` |
| 7 | **Runner 延长触发证据**（`runnerBridgeExtendedToBySecurity` / `heldToExtendedCapCount`） | 引擎（⚠️ 该 Map 目前是**函数局部** ⇒ `UNOBSERVABLE`，需单列契约改动才能观测） |

**判定**：
- `max(已观测退出相对日) = X`、**计划上限** `= L + 74 = 94`、
  **截断/未平仓/不可卖**任一 > 0 ⇒ 尾部**不足**，必须报告而不是推断；
- 只有当 ①–⑦ 全部为零暴露 **且** 已观测退出相对日的**分布上界 < 80** 时，
  才允许说「本轮 post80 足够」——且必须**同时披露**理论需求 94 与实测分布。
- 🔴 **`rd94/95` 不是新数据定义**：它只是 `L + 74` 的**理论上界**；
  也**不得**用旧规则的「post80 零暴露」外推新规则足够（新规则的入场更晚/持有更久 ⇒ 尾部需求**更大**）。

---

## 6. 可单独审批的具体动作清单

> 每项都写明：来源/范围/成本、新增或派生行数、要改的文件与契约、是否必须新 Dataset、验证命令、停止条件。
> 🔴 全部**未执行**；本轮只读 + 文档。

### 动作 1（必须最先）：裁定 ST 数据来源与范围（**数据决策**，不是编码）

| 项 | 内容 |
|---|---|
| 来源/范围 | 交易所（SSE/SZSE）风险警示（ST/*ST）**逐日完整名单 + 实施/撤销公告时间**。范围**至少是必需集合实测的 `2023-11-06 ~ 2025-10-09`**（比 004 主窗口更宽：暖启动事件日在主窗口之前，拟成交日可落到 2025-10-09）；若要支持全部 780004 事件则扩到 `2019-01-02`。或等价的商业/官方历史数据服务 |
| 成本 | **需用户裁定**（本轮未询价、未联网批量采集、未付费）；若坚持只用平台已有 `baostock-daily`，则必须给出「完整覆盖证明」，否则 84% 证券只能 UNKNOWN |
| 新增/派生行数（**保守下界，本轮实测**） | 🔴 **开跑必需 = 22,041 键**（`status-gap-requests-necessary.csv`：事件日 ST 19,441 + 候选确认日收盘 1,300 + 拟成交日前 1,300；其中 19,441 键同时需要 Security Master 的上市龄）。<br>**507,358 格是含归因观察的扩展集合 ⇒ 不应作为采购量或强制补齐量**（必需占 4.34%）。<br>若改为区间压缩：主窗口最小下界 = 310 只有 ST 区间的证券 × 平均 ~2 段 ≈ **千行级**，但**每个无 ST 片段的证券各需一份覆盖依据**（2,378 只 × ≥1 行 ≈ **2.4k+ 行**），「约 500 段即可」的粗估**不可**用于预算 |
| 要改的文件/契约 | **0**（本动作只落数据）；若走 DML 落库则需按分项 A 路径 2 的六项报告 |
| 新 Dataset | **不需要**（状态源与 Dataset 坐标解耦） |
| 验证命令 | `node scripts/_scratch/st-data-readiness006/s1-source-audit.mjs`（只读复测覆盖率）；`pnpm exec tsx scripts/_scratch/recovery-st-fix005/probe-digest-baseline.mts`（缺省不变） |
| 停止条件 | 任一计划检查时点仍无可核验结论 ⇒ 保持 `ST_COVERAGE_BLOCKED`，**不得**用空仓结果评价策略 |

### 动作 2：实现 provider 供给端（只读投影，分项 A）

| 项 | 内容 |
|---|---|
| 来源/范围 | 动作 1 的数据；只读，不写库（路径 1） |
| 新增/派生行数 | **0 数据库行**；内存索引按需载入 |
| 要改的文件/契约 | 新增 `server/researchExperiments/securityStatusProjection.ts`（或 `server/securityStatus/provider/**`）；`experiment.ts#resolveStatusProvider()` 从 `return null` 改为返回真实 provider（**唯一注入点**）；新增测试 §1.5 T1–T7。契约：沿用 `ST_GATE_CONTRACT_VERSION 1.1.0`（形状不变，不升版） |
| 新 Dataset | 不需要 |
| 验证命令 | `pnpm run check`；`pnpm exec vitest run tests/server/researchExperiments/rollingPoolRecoveryStExecutionGate.test.ts tests/server/researchExperiments/rollingPoolRecoveryStAuxiliaryAssembly.test.ts`；新增 provider 测试文件；`pnpm run test:changed`；`node scripts/checkEolDrift.mjs --strict` |
| 停止条件 | `pnpm run check` 非 0；既有 85 例定向测试任一失败；缺省 digest 基线变化 ⇒ 停 |

### 动作 3：构建索引前置条件修复（分项 B）

| 项 | 内容 |
|---|---|
| 来源/范围 | `server/datasetRegistry/builder.ts#build`（唯一文件；可选加 `DatasetBuildIO#assertSecurityIndexesLoaded`） |
| 新增/派生行数 | **0**（不重算历史行） |
| 要改的文件/契约 | `builder.ts`（+1 行前置 + 可选断言）；测试 B1–B6；`CHANGE-AUDIT.md` |
| 新 Dataset | 不需要（修的是**未来**构建） |
| 验证命令 | `pnpm run check`；`pnpm exec vitest run tests/server/datasetRegistry/builder.test.ts`（含新增 B1–B3、B5–B6）；`pnpm run test:changed` |
| 停止条件 | 既有 `builder.test.ts` 任一断言失败（那是契约）；B1 等价性不成立 ⇒ 停 |

### 动作 4：`poolStIndex` 显式政策（分项 C）

| 项 | 内容 |
|---|---|
| 来源/范围 | `server/runWorkbenchAssembly/poolStIndex.ts`（+ 可选：装配摘要/留档字段） |
| 新增/派生行数 | **0**（进程内政策开关） |
| 要改的文件/契约 | `poolStIndex.ts` 新增 `POOL_ST_POLICY_VERSION` + `absencePolicy` 选项（缺省 `LEGACY_NORMAL`）；新测试（严格政策 UNKNOWN + 缓存键含政策 + 缺省逐字节不变）；**不修改** `poolStIndex.test.ts` 既有 3 条断言 |
| 新 Dataset | 不需要 |
| 验证命令 | `pnpm run check`；`pnpm exec vitest run tests/server/runWorkbenchAssembly/poolStIndex.test.ts tests/server/runWorkbenchAssembly/pooledDatasetCursor.test.ts`（若存在） |
| 停止条件 | 旧断言被改动；缺省行为变化 ⇒ 停 |

### 动作 5：决定是否重建 Dataset（分项 D，**大动作**）

| 项 | 内容 |
|---|---|
| 来源/范围 | 780004 的 5 张表；新 `datasetVersionId`；`excludeSt=1 / excludeListedWithinDays=365 / pre10 / post80 / horizons 5,10,20 / main` **不变** |
| 成本 | ≈10.3M 行；耗时**> 32 min（实测下界）**，外推 1~1.5 h（**不是承诺**）；需 `loadSecurityIndexes` 就绪 |
| 新增/派生行数 | 新增 5 表合计 ≈10.3M 行（新版本），**不改** 780004 |
| 要改的文件/契约 | **0 代码**（只跑构建 + 对账脚本）；需按 §4.4 出影响报告并获授权 |
| 新 Dataset | ✅ **是** |
| 验证命令 | 对账脚本（§4.3 三类差分）；`SELECT MIN/MAX(relativeDay)` 断言 1..80；`limitRuleUp=0.05` 行数应等于「区间内 ST 格」数（非 0）；残留「应为 ST 却 10%」= 0 |
| 停止条件 | 事件集合不一致；行数不符；残留 ST 10% 格 > 0 ⇒ 停 |

### 动作 6：004 尾部观测（分项 E）

| 项 | 内容 |
|---|---|
| 来源/范围 | `experiment.ts#deriveAccount` + 结果产物（`tail-requirement.csv`） |
| 新增/派生行数 | 每笔交易 1 行（派生，不入库） |
| 要改的文件/契约 | 研究侧新增产物 + `result.ts` 统计项（**可选字段**，不改判据） |
| 新 Dataset | 不需要 |
| 验证命令 | 6 账户 SMOKE（**需另行授权**，本轮未跑） |
| 停止条件 | 任一暴露计数 > 0 ⇒ 停并报告，不得强平/补价/剔样本 |

---

## 7. 未完成 / 未验证（如实）

| # | 项 | 状态 |
|---|---|---|
| U-1 | 交易所公告可获得性、成本、采购可行性 | **未核实**（本轮不付费、不批量采集） |
| U-2 | 780004 的**逐行**构建归属（哪一轮写哪一行） | **未做**（未重跑构建）；机制定位与全部观测一致 |
| U-3 | 新 Dataset 重建的**实测**耗时 | **未测**（外推 1~1.5 h，非承诺） |
| U-4 | 004 真实执行尾部需求分布 | **未测**（004 无尾部记录器；动作 6 才产出） |
| U-5 | provider 在真实数据上的覆盖率 | **未测**（无来源） |
| U-6 | 严格 `poolStIndex` 政策对旧池化 Run 的实际影响面 | **未逐一枚举**（结构级论证：`st` 内容变化 ⇒ 内容寻址变化） |
| U-7 | 需求枚举的**两趟读取**（rd1..41 与 rd1..80）重复读了 rd1..41 | 独立审计意见：首次对照有验证价值，**后续不应每次重做**。后续应「一次读入 → 投影两个窗口」，或落一份按 `datasetVersionId + 相对日 + 日期范围 + 规则/输入指纹` 键控的可复用快照（GOAL §7 的缓存纪律） |
| U-8 | `rd1..41` 只覆盖**买点资格诊断**，**不代表**收益回测只需 41 日 | 收益/退出路径仍需 `rd1..80`（且理论上需 rd94/95，见 §5）。任何把它当「收益回测读取范围」的推论都是错的 |
| U-9 | 扩展缺口表的 `groups` 列非原子拼接（`A|A|B|B|COMMON`） | 已在派生视图 `status-gap-requests-necessary.csv` 修正为**原子组去重**；主产物**未重生成**（重生成会改动已被独立核验的 SHA-256）。按 (证券,日期,时点) 计数不受影响，**按组聚合**受影响 |
