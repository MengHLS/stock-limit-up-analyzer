# 首板滚动池 · 破位修复再触发 × 每日 ST 硬闸门（`FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004`）

> 实验 id：`first-board-pullback/rolling-pool-recovery-st` · 版本 `1.0.0`
> 目标：[`docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`](../../../docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md)
> S1 审计：[`docs/research/AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`](../../../docs/research/AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md)
> 规则库（**唯一求值实现**）：[`research-experiments/shared/rollingPoolRecovery/`](../../shared/rollingPoolRecovery/)

---

## 0. 🔴 先读这一段：本实验**当前拒绝产出收益矩阵**

S1 审计判定 **ST 逐日状态源不可 PIT 核验**：

| # | 证据 | 实测 |
|---|---|---|
| E1 | 唯一 ST 源无「可获知时间」 | `research_security_status_history` 的 ST 行 `availability` **全为 `UNKNOWN`**；窗口内具备可获知时间的 ST 行 = 0 |
| E2 | 数据集自身字段会放行 ST 日 | 948 个平台判定的 ST 格，`limitRuleUp` 全为 **10%**、`canBuyAtOpen = 1` |
| E3 | 「无 ST 行」≠ NORMAL | 窗口内 2,378 / 2,827（84.05%）symbol 没有任何 ST 行；`inferStIntervals` 只存 ST 片段 |

因此 `run()` 在**任何撮合之前、也在证券身份解析之前**执行 **ST 覆盖闸门**。FIX-005 之后这
条链分成**两段职责**（此前 README / 注释把两段混成一句「候选必须两个时点 NORMAL 才生成意图」，
是超出实现的表述，已纠正）：

| 环节 | 何时 | 用哪些信息 | 作用 |
|---|---|---|---|
| **确认日资格与排序** | 确认日**收盘** | **只用当日及以前可知**的信息（`confirmCloseBuyEligibility`） | 决定谁进候选池 / Top3 / Random 抽样（**不看**次日结论） |
| **成交前拒单** | 真实成交时刻（`PRE_FILL`，当地 09:15） | 成交日当时的状态（`executionEligibilityGate`） | `ST` / `UNKNOWN` ⇒ **取消订单**（不扣现金、不建仓、不计成交次数） |

```text
每个价格信号（R 与 Random 共享同一原始候选池）
  → evaluateStGateForCandidate（确认日收盘资格 + 成交前复查）   ← 覆盖统计 / 可运行性校验
  → summarizeStCoverage(...)
  → 逐组计数 UNKNOWN_BLOCKED 候选 / 逐时点 / 逐原因（+ provider 窗口探针）
  → 闸门未通过 ⇒ 交付覆盖缺口产物 → **正常返回**显式终态 ST_COVERAGE_BLOCKED
  → 闸门通过   ⇒ 证券身份解析 → 买单计划（只按**确认日**资格过滤）
                → runTradeSimulation（**成交前**再判一次 ST ⇒ ST/UNKNOWN 拒单，且不递补）
```

- **不产出**空仓矩阵冒充结论（目标 §4：「不用大面积 UNKNOWN 拒单导致的空仓结果评价新买点」）；
- 终态是**结果的一等状态**，不是异常：`customPayload.status = "ST_COVERAGE_BLOCKED"`、
  `matrixEmitted = false`、`eligibleCount = 0`、**收益类统计一律 `null`（不是 0）**，
  并且**没有**任何交易 / 权益表与图；
- 🔴 **早诊断（FIX-005 / F3）**：provider **明确缺失**时（`resolveStatusProvider() === null`）
  只做**事件扫描**，**不读任何 post rd≥1**（不再为同一个已知缺口重复扫描全量 post80）、
  不 `freezeSelection`、不解析身份、不撮合；未扫描的**候选数与覆盖分母一律 `null`（未测）**，
  **绝不用 `0` 冒充**「查过了、没有候选」。`customPayload.stCoverageBlocked.measurement`
  ∈ `NOT_SCANNED_PROVIDER_ABSENT`（未测）| `MEASURED`（已实测）；schema 强制二者与计数一致
  （未测 ⇒ 全 `null`；已实测 ⇒ 真数字）。
- 交付的产物**只有覆盖缺口**（`context.artifact`，经既有 ArtifactStorage）：
  | 产物 | 内容 |
  |---|---|
  | `st-coverage-gap-summary.json` | 状态字面量、`measurement`、候选 / 逐时点 / 逐原因计数（未测时一律 `null`）、缺失的 provider 身份与探针结果、刻意未产出的读数清单 |
  | `st-early-diagnostic.json` | 早诊断：`scanPlan`（是否读 post、是否冻结、是否撮合）、未测读数清单、下一步数据要求 |
  | `status-coverage.csv` | 逐 symbol / 逐检查时点的来源、status、effectiveFrom/To、availableAsOf、confidence、证据指纹（**缺失留空记 UNKNOWN，绝不伪造**；未测 ⇒ 0 数据行） |
  | `st-coverage-counts.csv` | 逐组 / 逐时点 / 逐原因三分账（NORMAL / ST / UNKNOWN 分开）；未测行计数列**留空** |
  | `st-gap-samples.csv` | 缺口样例（封顶；未测 ⇒ 0 行） |
  | `frozen-config.json` | 冻结配置与 Dataset 坐标（暂停时也交付，便于核对本轮声明） |
- 🔴 **为什么是「正常返回」而不是 `throw`**：平台 Runner 在失败路径**丢弃全部产物**
  （`server/researchExperiments/runner.ts#runDetailed`：`artifactFiles: failure === null ? artifactFiles : []`），
  抛异常会让「先交付覆盖缺口」只剩异常消息里的一段文字。
  `throw new StCoverageBlockedError(summary)` 仍作为「宁可失败也不产出」的直接调用方入口保留
  （`experiment.ts#stCoverageReportOf`）；
- provider 缺省 = `ABSENT_STATUS_PROVIDER`（恒返回 `null`）⇒ 现状下**任何** Run 都会以
  `ST_COVERAGE_BLOCKED` 结束。这是 S3 的**交付内容**，不是缺陷；
- 闸门排在**身份解析（DB）之前**，因此这条纪律可以用**合成 fixture、不连 DB** 的测试钉住
  （`tests/server/researchExperiments/rollingPoolRecoveryStBlocked.test.ts`）；
- 唯一注入点是 `experiment.ts#resolveStatusProvider()`。数据授权补齐后只需让它返回真实
  provider（并另冻版本），其余代码不变。

### 0.1 成交前拒单真的接在撮合链上（FIX-005 / F1）

`evaluateStGateForCandidate` 只能给出**判决**；「已选买单真的被取消」必须发生在**执行层**。
因此引擎（`server/research/simulator/engine.ts#runTradeSimulation`）新增一个**可选**输入：

```ts
SimulationConfig.executionEligibilityGate?: {
  gateId: string;
  policyVersion: string;
  decideBuy(input: { securityId; plannedDate; executionDate; side }): {
    allowed: boolean; status: string; reason: string;
    providerId: string; policyVersion: string;
    evidenceFingerprint: string | null; checkedAt: string; plannedCheckDate: string | null;
  };
}
```

- 研究装配层注入的实现是 `experiment.ts#createStExecutionEligibilityGate(provider)`
  （`policyVersion = recovery-st-execution-eligibility/1.0.0`），在**真实成交时刻**用**同一个**
  `evaluateStGate` 判 `PRE_FILL`；`ST`/`UNKNOWN` ⇒ `allowed=false`；
- 检查发生在**报价 / 现金 / 持仓 / 成本 / 成交计数更新之前**；🔴 只对**买入**生效，
  卖出与已持仓退出**完全不经过**它；
- **缺省不声明** ⇒ 引擎行为与记录**逐字节不变**（`executionEligibilityAudit` 字段不出现；
  由 `rollingPoolRecoveryStExecutionGate.test.ts` 的 digest 常量锁钉住）；
- 逐笔判决写进 `TradeSimulationRun.executionEligibilityAudit`（可序列化，**函数不入 JSON**），
  并在引擎内**硬断言**：任何 `outcome === FILLED` 的买入必须 `status === "NORMAL"`，
  否则**整轮抛错**（不写 false 继续报收益）；研究侧 `st-fill-audit-*.csv` 只收真实成交记录，
  并生成 `execution-eligibility-rejections-*.csv`（股票 / 锚点 / 账户 / **计划 vs 实际检查日** /
  状态 / 原因 / provider / 证据指纹 / 政策版本）。

### 0.2 区间有效性用真正的检查时刻（FIX-005 / F2）

`stGate.ts#evaluateStGate` 此前用 `instantKey(query.tradeDate)`（当日 **00:00**）判区间覆盖，
而可知性用 `query.effectiveAt` ⇒ 日内生效/失效的区间在 09:15 判错。现在**两者都用 `effectiveAt`**，
并把归一化规则显式冻结（生效含、失效含）：

| 写法 | `effectiveFrom` | `effectiveTo` |
|---|---|---|
| `YYYY-MM-DD` | 当地 00:00:00 | **覆盖整日** ⇒ 当地 23:59:59（闭区间含端点） |
| `YYYY-MM-DDTHH:mm:ss` | 原样 | 原样（**精确时间不扩展到整日**） |
| 其它 / 非法日历日 | 拒收 ⇒ `UNKNOWN`（`INVALID_STATUS_TIME_FORMAT`） | 同左 |

时区统一为**中国市场当地时间**（字面量比较，不做时区换算）。语义变更 ⇒
`ST_GATE_CONTRACT_VERSION` 升为 **`1.1.0`**：仍声明 `1.0.0` 的 provider 记
`PROVIDER_CONTRACT_MISMATCH`（= UNKNOWN，失败关闭），而不是被「尽力解释成新语义」。


---

## 1. 唯一研究问题与主比较

> 「首板支撑**破位后暂停买入、止跌修复后重新获得资格**，能否改善右尾覆盖及账户表现？」

| 组 | 破位后 | 买点 |
|---|---|---|
| **A `STRICT_20`** | **永久停买**（继续观察、继续出证据） | 003 的 D：N=5 / T+20 |
| **B `RECOVERY_20`** | 进入 §3.3 **修复分支** | 未破位同 A；破位后 `F` + `W=[d−5,d−1]` 综合分 ≥15 + 确认日突破放量 |

**主靶** = `B_R − A_R`：在**共同且数据资格可核实的锚点宇宙**上，
「至少一笔已完成净收益 ≥+20% 的**唯一锚点数**」覆盖率之差。

- 分母固定为两组共有 + 因子可评估的锚点宇宙（`preReturn10 !== null` 且进入过 rd1..40 观察池），
  **不是**各组成交数（目标 §6 明确禁止）；
- 聚类键 = 每个共同锚点**首次进入观察池**的日期；双臂共享同一日历
  （`pool.decisionDates`，**空日保留**）与同一抽样索引；
- bootstrap = `@experiments/shared/dateClusterBootstrap` 的**唯一**实现，
  1000 次、block20 主 / block40 敏感性、95% 双侧、配对均值差单列。

**事前判据**（`preRegisteredCriteria`，事后不得修改）：两组各 ≥50 个独立 ≥+20% 命中锚点、
主区间下界 > 0、block40 不反向、2024/2025 同靶同向、账户收益与风险未显示相反取舍；
任一条不满足 ⇒ `INSUFFICIENT_EVIDENCE`，**不靠**扩 seed/账户数补足。

---

## 2. 唯一的信号求值实现

`research-experiments/shared/rollingPoolRecovery/`：

| 文件 | 职责 |
|---|---|
| `types.ts` | 冻结常量、`priceState`/`buyEligibility`/`positionState`、逐日证据与评估类型 |
| `entry.ts` | **唯一**求值器 `evaluateRecoveryDays`（A = 003 的 D；B = 原分支 + 修复分支），逐日证据一次性产出 |
| `stGate.ts` | 两时点 ST 闸门、覆盖缺口与 `ST_COVERAGE_BLOCKED` |

**A 组 = 003 的 D，逐字节同义**：确认日**直接取**
`rollingPoolEarlyEntry#evaluateEarlyEntry({ observationDays: 5, entryFillMaxRd: 20 })` 的输出，
本仓库没有第二份 N=5/L=20 的实现；A 组只额外做一件事 —— 首次可靠破位后把该锚点
**永久禁止买入**（`buyDisabled` + 拒因 `ANCHOR_BUY_DISABLED_SUPPORT_BREACHED`），继续观察。

**B 组破位前与原分支给出相同信号**（「未破位分支必须保持同样信号」，目标 §2）。

### §3.3 五条硬约束的落点

| 条件 | 实现 |
|---|---|
| 1. `d ≤ 19`；`W=[d−5,d−1]` 全在最新低点 `p` 之后（`d−5 > p`）；`d` 有效 | `CONFIRM_MAX_RD`；`relativeDay − 5 > localLowRd`；`assessDay` |
| 2. W 每日有效 OHLC + 正量 + 所需前日比较值；无效日**不得跳过拼接** | 无效日 ⇒ 本段中断（`REPAIR_EPISODE_BROKEN_BY_GAP`），下一有效日重开段 + 新低点基准（`REPAIR_EPISODE_RESTARTED_AFTER_GAP`）并重新积累五日 |
| 3. W 与 `d` 都不低于 `F`；`L_d < F` 更新 `p/F` 且**不发信号**；`L_d == F` **不算**新低 | `isNewLocalLow()`（严格小于，带容差） |
| 4. `Q_j` 四项原始值 + `ΣQ_j ≥ 15/20`（**不要求**单日 `Q ≥ 3`） | `repairComponents`（逐日）与 `repairWindowScore`（W 上合计） |
| 5. 确认日 `C_d > max(H_(d−2),H_(d−1))` 且 `V_d ≥ V_(d−1)`；回撤真的发生过；当日非 ST 且因子可评估 | `confirmDayBlockers()` + 两时点 ST 闸门 + `factorAssessableOf` |

- **不要求收复 `0.98·O_0`**；`F` 只是修复分支的参考支撑，**永不作为退出价**（退出是冻结 Runner 政策）；
- `ΣQ_j` 只是**观察证据**，**不进入横截面排序**（排序仍为 `preReturn10` 降序 + symbol/eventId 破平）；
- `repairEpisodeId = anchorEventId + p`（追踪用，**不是**新锚点、**不是**新期限）；
- ST 与账户容量**不能抹掉价格观察历史**：`priceState` 与 `buyEligibility` 分开记录，
  一只票可以同一天 `priceState = SIGNAL_FORMED` 而 `buyEligibility = ST_BLOCKED`。

---

## 3. 账户、排序与退出（目标 §5，全部冻结）

| 项 | 值 |
|---|---|
| 账户 | 每组 `R + randomAccountCount Random`；默认 **20 ⇒ 两组 42**；SMOKE = 2 ⇒ **6** |
| 种子 | `seedIndex = 20261010 + i`（i = 0..N−1；**两组同 i 同 seed** = 同一个「随机账户编号」） |
| 随机 | 当日**相同可排序买点池**、相同选中人数、均匀无放回（`pickUniformRandomSubset`） |
| 排序（R） | `preReturn10` 降序 → symbol 升序 → eventId 升序；每日 Top3 |
| 仓位 | **决策日收盘当前总权益 × 20%**（`EQUITY_FRACTION`，运行期断言 `fraction === 0.2`） |
| 上限 | 持仓 5 / 每日新买 2 / 初始资金 100,000 / 整手 / T+1 |
| 候选退出 | `candidateExitPolicy = "DISABLED"`（运行期断言） |
| 退出政策 | 唯一继承物 `strategy_versions.id = 3600005`（2.0.0，指纹 `f6b61472…ef3c`），经 `loadFrozenRunnerPolicyBundle` + `runnerBridgeOf` 读取并二次核验指纹 |
| 指标 | **唯一出口** `canonicalMetrics` |
| `maxAmp5` | **完全不参与**（`deriveEventFactors(..., () => null)`） |
| 再入场 | 允许（`securityCooldownTradingDays: null` / `maxEntriesPerMember: null` / `maxConcurrentOpenPerCode: 1`） |
| Dataset | `first_limit_pullback` / `v10-listed365-pre10-post80`（参考 id `780004`；运行期以 `facts.datasetVersionId` 为准） |
| 主窗口 | 2024-01-02 ~ 2025-09-30 |

**运行模式由参数翻译、工具绝不自动扩跑**：`resolveRunMode(randomAccountCount)`
⇒ `SMOKE`（2）/ `STUDY`（20）/ `CUSTOM`（其他，含 200）；模式与账户数写进 `customPayload.frozenConfig`
与 `sampleSummary.notes`。扩跑需独立参数记录与**新 Run**，不覆盖 42 账户产物。

---

## 4. 结果结构

`customPayload`（`recoveryStCustomPayloadSchema`）：`frozenConfig`（含 `runMode`）、
`runMode`、`commonAnchorUniverseSize`、`groups[]`（账户指标 + R/pooled-Random 尾块 + 覆盖率 +
逐年前 3/5 日不利波动 + `simulationConfig` 快照 JSON）、`primaryComparison`、`stCoverage`、
`contractGaps`、`sampleSummary`。

`tables`（关键数字必须进信封，页面可能不挂载）：两组读数、主比较 bootstrap、
逐年同靶读数、ST 覆盖闸门；`statistics`：主靶与两组覆盖率、共同宇宙大小、运行模式账户数。

---

## 5. 如实登记的局限（不是疏漏）

1. **A/B 是机制级对照**：同时改变「破位后的局部支撑」与「观察聚合方式」，
   **不能**称为「仅取消永久排除」的单因素效应（目标 §2 已事前声明；与归因报告 §14.4 建议 3
   方向相反，由用户明确指示覆盖）。
2. **ST 源不可 PIT 核验** ⇒ 现状下不产出矩阵（见 §0）。
3. **行情尾部**：组合执行理论上需要约 `rd94`（`L=20 + Runner 续持 74`），Dataset 物理上界 `rd80`；
   S1 审计实测上一轮**零暴露**。本轮**不允许**在 rd80 静默强平、补最后价或事后剔除长持仓；
   一旦出现暴露必须停并报告。
4. **`decisionOffsetDays` 是单标量**（= 20），无法表达滚动池逐日变化的决策坐标 ⇒ 声明的是上界。
5. 2024 / 2025 都是**已见探索窗口**，不是 OOS；没有 PIT 可用的市场状态标签时，熊市效果未验证。

---

## 6. 测试与工具

```bash
# 规则 / 修复分支 / 两时点 ST 闸门 + F2 区间边界（合成 fixture）
npx vitest run tests/server/researchExperiments/rollingPoolRecoverySt.test.ts

# 🔴 ST 覆盖守卫（ST_COVERAGE_BLOCKED）：合成 fixture、**不连 DB**、断言**不产出**交易/权益结果
#    含「未测 ⇒ null（不是 0）」与「早诊断不读 post rd≥1」
npx vitest run tests/server/researchExperiments/rollingPoolRecoveryStBlocked.test.ts

# 🔴 成交前 ST 拒单：走**真实 runTradeSimulation**（不是只查 gate.buyAllowed）
#    隔夜 ST / UNKNOWN / 再入场 / R vs Random / 不递补 rank4 / 持有中转 ST / 缺省 digest 不变 / 日内边界
npx vitest run tests/server/researchExperiments/rollingPoolRecoveryStExecutionGate.test.ts
```

覆盖（目标 §8 关键测试）：A 与 003 的 D 逐日同源；破位后**不再永久删池**；原线**以下**止跌修复触发；
新低重启五日观察；`ΣQ ≥ 15` 且单日 `Q < 3` 可触发 / `ΣQ = 14` 不触发；无效日（停牌 / 缺行 / 零量）
**不能拼接**；`L_t == F` 不算新低；`d ≤ 19` 边界（rd19 允许、rd20 不允许）；
两时点 ST 闸门四类场景（观察中转 ST / 隔夜转 ST / 平仓后再入场 / UNKNOWN）**全部拒买**
且首次、重试、再入场与 R/Random 共用同一闸门；`ST_COVERAGE_BLOCKED` 守卫：
终态字面量 + 未测标记（计数 `null`，不是 0）+ 缺失 provider 身份 + 缺口产物落盘 +
**没有任何**交易 / 权益 / 收益读数；F2 日内边界（09:00 到期 / 08:00 生效 / 精确端点 / 日期终点 /
无效日期拒收 / 契约升版）；F1 真实撮合拒单（不扣款 / 不建仓 / 不计成交次数 / 不递补 /
卖出不受影响 / 缺省逐字节不变）。

全部为**合成 fixture**：不读 Dataset、不连 DB、不跑 Run、不产出矩阵。001/002/003 的复现锁不动。

### 运行工具（**本轮不执行**）

```bash
# S4 6 账户技术预检（不持久化）
node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs \
  tests/tools/rollingPoolRecoveryStRun.mts --mode smoke

# S5 42 账户 EXPLORATORY Run（经既有 startRun 入口持久化）
node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs \
  tests/tools/rollingPoolRecoveryStRun.mts --mode study
```

工具只支持 `smoke`(2 随机/组 ⇒ 6 账户) 与 `study`(20 随机/组 ⇒ 42 账户)，**不自动扩跑**
（200 需独立参数记录 + 新 Run）；输出落 `_scratch/fbp4/`。
在 ST 源补齐之前，两次调用都应落在 `ST_COVERAGE_BLOCKED`，工具以 **exit code 3** 结束
（0 = 产出矩阵；1 = 工程失败；3 = 刻意暂停），并打印缺口摘要。

