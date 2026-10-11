# S1+S2 GATE · `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` 现有链路审计与只读预检

> 承接 [`GOAL-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md`](GOAL-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md) 与
> [`RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md`](RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md)。
> 基线：HEAD `f8b6810` + 工作区（含并发会话未提交改动；本任务未触碰）。
> 本文件 = 目标 §8 的 **S1 / S2 产出**（只读审计 + 只读预检），**不构成** 正式 Run 或研究结论。

---

## 0. 一句话结论

**S1 通过、S2 通过、执行面有一条必须显式登记的口径取舍。**

- 🔴 **买点规则在权威实现里是全新的**：目标 §4 点名的三个「已有入口」**没有一个**能当本轮的买点
  （`FIRST_LIMIT_PULLBACK_HOLD_SHRINK` 的执行面只有**当日单根** haircut/量比，**没有**「路径全程未破位」；
  `firstLimitPullback3FTopN` 的资格被烙进 rank feature 且 `requirePullback` **默认 true**；
  `BREAKOUT_SUCCESS_RESEARCH` 的 `execution: null`）。规则逐条对应见 §2。
- 🔴 **旧 `signalEligible` 不可沿用的原因已定位到符号级**：它要求 `maxAmp5` 可评估，而
  `makeEventStateAmplitudeFeatures` 的窗口固定 `rd11..15` ⇒ 实际可选下界 **rd15**，
  而本轮买点最早在 **rd3** 触发 ⇒ 照搬旧资格会让 T+10 前候选**恒为空**。
- ✅ **数据入口、退出政策指纹、成本与执行假设、初始资金与账户约束**全部**只读复核通过**（§3）。
- ⚠️ **执行尾部存在有界缺口**：780004 物理 post 上界 `rd80`，而冻结 Runner 最长可续持到约 `rd83`
  ⇒ 结论窗口末端约 3 个交易日无行情。**量化见 §4**，处置见 §5（不改 780004、不自建新 Dataset）。
- ✅ **集成路径已确定且只复用既有权威实现**：`context.composite.baselineDataset` 提供
  **真实证券身份**（`sec_<uuid>::event:<code>@<date>`），`context.dataset` 提供行情，
  执行经 `runCompositeRunnerBacktest` → 既有 `runTradeSimulation`，指标唯一出口 `canonicalMetrics`。
  **不新建引擎、不新建指标出口、不新建策略语义。**

---

## 1. S1 · 资产复用范围与「旧资格为何不适用」

### 1.1 目标 §2 已查事实逐条复核（全部成立）

| 目标陈述 | 复核结果 | 权威符号 |
|---|---|---|
| 原实验是每日收益标签研究，无账户执行、无独立买点 | ✅ 成立 | `research-experiments/first-board-pullback/rolling-pool-right-tail-mvp/experiment.ts#rollingPoolRightTailMvpExperiment` |
| 同股保留最早未过期锚点，后续首板不刷新年龄 | ✅ 成立 | `research-experiments/shared/rollingPoolRightTail/projection.ts#buildDailyPool` |
| 旧信号资格需两因子均可评估，实际下界 rd15 | ✅ 成立（见 §1.2） | `projection.ts#rejectionCodesOf` + `types.ts#SELECTABLE_AGE_LOWER_BOUND` |
| `maxAmp5` 固定读取 rd11..15 | ✅ 成立 | `server/strategyCore/featureRegistry.ts#line.makeEventStateAmplitudeFeatures`（`EVENT_STATE_AMPLITUDE_WINDOW = {start:11,end:15}`） |
| `preReturn10` 固定读取 rd−10/rd−1 | ✅ 成立 | `projection.ts#deriveEventFactors` |
| 权益比例建仓已实现 | ✅ 成立 | `server/research/simulator/plan.ts#applyPositionSizing` 的 `EQUITY_FRACTION`（基数 `currentEquity`）；`engine.ts#runTradeSimulation` |
| 已持仓不重复建仓 | ✅ 成立（但**身份键域是关键**，见 §5.2） | `plan.ts#planDecisionDay` 的 `holdingSet` 分支 |
| 780004 READY / 事件日非 ST / 上市龄≥365 自然日 / 沪深主板 / prefix10 / post80 | ✅ 只读复核通过 | `dataset_version.id=780004` |

### 1.2 旧 `signalEligible` 不可沿用的**符号级**原因

`types.ts#SELECTABLE_AGE_LOWER_BOUND = 15` 不是研究口径选择，而是**特征可得性的直接后果**：

```
EVENT_STATE_AMPLITUDE_WINDOW = { start: 11, end: 15 }        // featureRegistry.ts
⇒ maxAmp5 的决策下界 = rd15
⇒ 旧 signalEligible（两因子均可评估）的实际可选年龄 = rd15..40
```

本轮买点最早 **rd3 收盘确认、rd4 开盘成交**，最晚 **rd9 确认、rd10 成交**
⇒ 若沿用旧 `signalEligible`，**T+10 之前的候选恒为空**，整个续研无法进行。

🔴 **处置**：本轮**另建独立的早期入场资格**（`ENTRY_OBSERVATION` 族），
`maxAmp5` **完全不参与**入场与排序（目标 §3 明确要求）；
旧 `signalEligible` 在旧实验里**逐字节不变**（继续由 `rejectionCodesOf` 产出）。

### 1.3 目标 §4 三个「已有入口」的逐条核验

| 入口 | 实际导出名 / 结论 |
|---|---|
| `patterns/firstLimitPullbackHoldShrink.ts` | **导出名 `FIRST_LIMIT_PULLBACK_HOLD_SHRINK` 正确**。**双重表面**（research + execution 均非 null），非 research-only。<br>执行面 `gates`：`haircut ≤ maxDrawdown`（**默认 0.02** ⟺ `L_d ≥ 0.98·O_d`）、`volumeRatio ≤ maxVolumeRatio`（**默认 0.3**，须显式覆盖为 0.5）、`isBullish`（默认不启用）。<br>🔴 **该文件自己在 header 里登记了不可同构的缺口**：执行侧只有**决策日当日**一根 bar，**无法表达** `min(L_1..L_d)` 的**路径**要求 ⇒ **不能**作为本轮条件 2 的实现。 |
| `patterns/firstLimitPullback3FTopN.ts` | 资格与评分**不在本文件**，被烙进 rank feature：`rankFeature = requirePullback ? "threeFactorComposite" : "threeFactorCompositeNoPullbackGate"`；`gates: []`（无硬门槛，入选 = 分数可算）。<br>🔴 `threeFactorScoreFeatures.ts#threeFactorCompositeScoreOf` 里 `const requirePullback = options.requirePullback ?? true` ⇒ **默认 true 会静默把 3F 回踩门重新变成硬排除**。<br>🔴 更危险的「自然基座」是 `patternLibrary/firstLimitPoolDailyScore.ts`：它**静默注入** `minimumScore=0.55` + `removeBelowMinimumScore=true`（3F 分档失效）、`maxObservationAmplitude=0.14`（**旧入场门**）、`scoreInvalidationDays=3`。**本轮不建立在其之上。** |
| `breakoutSuccessResearch.ts#BREAKOUT_SUCCESS_RESEARCH` | ✅ 确认 `execution: null`（research-only）。且 `is_breakout` 属 **`path` 前视标签层**（`datasetRegistry/path.ts#isBreakout` 用 `bar.high > ref.eventHigh`），`strategySchema/definition.ts` 明文 **禁止 `path.*` 作为信号条件**；比较口径也不同于本规则条件 4（`close > max(H_{d-2},H_{d-1})`）。 |

### 1.4 规则六条件 → 复用/新建映射（**本轮实现依据**）

| # | 规则条件 | 判定 | 依据 |
|---|---|---|---|
| 1 | `∃j∈[1,d-1]` 使 `C_j < C_0` | **新建**（口径可参照） | 最近似实现 `threeFactorScoreFeatures.ts` 的 `hasPullbackInObservationWindow` 是**含当日的窗口布尔**，无法表达 `≤ d−1`（规则 §6 明确禁止用 `S_d` 反推昨天） |
| 2 | `min(L_1..L_d) ≥ 0.98·O_0` | **分裂**：单日可复用 + 路径必须新建 | 单日：`pullbackFeatures.ts#computeHaircutFromEventLow`（`(baseline.open − bar.low)/baseline.open`，**锚点 = 首板开盘**，与规则同源）+ gate `haircut ≤ maxDrawdown`，取 `maxDrawdown = 0.02`。<br>路径：`featureRegistry.ts#DERIVED_BAR_FIELD_TO_FEATURE_ID` **无**累积 `min(low)` 特征 ⇒ 新建 |
| 3 | `S_(d-2) ≥ 3` 且 `S_(d-1) ≥ 3`（四项各 1 分） | **新建** | 全仓**无** 0..4 观察分对象；分项中「缩量 `V_d ≤ 0.5·V_0`」可复用 `featureRegistry.ts#volumeRatio`（须显式把参数从默认 0.3 覆盖为 0.5）；「低点稳定」「收盘改善」无日环比特征 ⇒ 新建 |
| 4 | `C_d > max(H_(d-2), H_(d-1))` | **新建** | 窗口逻辑仅在 **runner 出场**状态里存在（`stateFactorRegistry.ts#RUNNER_STATE_DEFINITIONS["NEW_HIGH_2"]`，且比较的是 **high** 且要求已持仓）⇒ 只作模板；`ConditionDefinition` 右端**无聚合/算术形式**，无法声明式表达 |
| 5 | `V_d ≥ V_(d-1)` | **新建** | `featureRegistry.ts` 只有 `V_d/V_0`（`volumeRatio`），**无** `V_{d-1}` 任何形式 |
| 6 | `d ∈ [3,9]` + T+10 成交截止 + 状态机/原因账 | **部分复用 + 新建** | 复用：`FIRST_LIMIT_POOL` 日触发语义、`poolAgeCapTradingDays`、`T_PLUS_1_OPEN`/`NEXT_OPEN`。<br>新建：`d ∈ [3,9]` 带、**T+10 成交截止**（现有系统内没有任何「入场按 rd 封顶」的概念，`exitTailTradingDays` 是**出场**概念）、`OBSERVING/ARMED/TRIGGERED/HELD` + `INVALIDATED_SUPPORT`/`ENTRY_EXPIRED`/`UNASSESSABLE` + 逐层原因账 |

**结论**：规则在**原语级是新的**；可复用的是**锚点公式（首板开盘）与量比口径**，不是买点本身。

### 1.5 买点候选池与账户约束的**分层**（本轮硬边界）

```
当日池成员（原滚动池锚点，rd1..40）
  → 数据资格（OHLCV 完整 / 非停牌 / 非零量）      ← 只用当日及之前
  → 观察分 S_d（四项分项单列）与状态机              ← 只用当日及之前
  → 触发判定（六条件全成立）                        ← 只用当日及之前
  → 因子可评估（preReturn10 缺失 ⇒ R 与 Random **共同**不进入）
  → 原始买点候选池（两臂**完全相同**）
  → 排序（R = preReturn10 降序）或随机（200 种子）  ← 账户无关
  → 各账户约束（同股持仓 / 同锚点曾买 / 空位 / 现金） ← **账户层**，不回流改候选池
  → 次一交易日开盘撮合（锚点 rd ≤ 10，越界即拒绝）
```

🔴 `inWatchPool` / `signalEligible` / `nextOpenExecutable` 三态分离；第三项是**下一日真实执行结果**，
**绝不参与排名或候选资格**（沿用原实验纪律）。

---

## 2. S2 · 只读数据与权益预检（全部为实测）

### 2.1 数据入口复核（`dataset_version.id = 780004`）

| 项 | 实测值 |
|---|---|
| 状态 / 版本 | **READY** / `v10-listed365-pre10-post80` |
| 区间 | `2019-01-02` ~ `2025-09-26` |
| `totalEvents` / `totalRows` | **58,983** / **10,320,499** |
| 构建口径（库内真实 build config） | `excludeSt=1` · `excludeListedWithinDays=365` · `preWindowDays=10` · `postWindowDays=80` · `boards=["main"]` · 事件 `{rd:0, kind:firstBoard}` |
| post 覆盖 | `relativeDay = 1..80`，**每层恒 58,983 行**（无缺口） |
| post 物理日历 | `2019-01-03` ~ **`2026-01-28`**（1,716 个交易日） |
| 主窗口内事件 | `2023-09-01` ~ `2025-09-26`：**20,370 个事件 / 2,843 只股票** |

### 2.2 冻结退出政策复核（**指纹逐字符一致**）

```
strategy_versions.id = 3600005
  strategyId   = first-limit-pullback-3f-top3-runner-t74
  version      = 2.0.0            status = Draft
  datasetVersionId = 780001
  fingerprint  = f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfef3c
                 ✅ 与目标 §5 声明**逐字符一致**（本次只读复核）
```

`definition.exit`（**本轮唯一继承物**）：

```jsonc
{
  "candidateExitPolicy": "DISABLED",
  "rules": [{
    "id": "exit-unified-policy", "type": "STOP_LOSS", "trigger": "ON_CLOSE", "priority": 0, "enabled": true,
    "policy": {
      "capitalRecycle": null,
      "runnerBridge": { "kind": "PIT_RUNNER_HOLDING_BRIDGE", "state": "NEW_HIGH_3",
                        "decisionHoldingDays": 5, "extendToHoldingDays": 74 },
      "stop": { "anchor": { "kind": "FIXED_PERCENT", "stopRatio": 0.06 }, "confirmation": "INTRADAY",
                "escalation": { "kind": "PEAK_DRAWDOWN", "activationRatio": 0.03, "drawdownRatio": 0.08 } },
      "strongHold": { "atHoldingDays": 5, "extendToHoldingDays": 10, "minReturnRatio": 0.03,
                      "requireAboveMa5": true, "requireAboveMa10": true, "afterExtendedHold": "TIME_EXIT" },
      "takeProfit": { "kind": "MA_CROSS", "fastWindow": 5, "slowWindow": 10, "activationRatio": 0 },
      "timeExit": { "kind": "FIXED_HOLDING_DAYS", "holdingDays": 5 }
    }
  }]
}
```

✅ 与目标 §5 的散文描述**逐条对应**（止损 6% 盘中确认 + 3% 激活后 8% 峰值回撤升级；MA5/MA10 且 activationRatio=0；
基础时间退出 5 日；第 5 日 ≥3% 且高于 MA5/MA10 ⇒ 续持至 10 日；`runnerBridge` NEW_HIGH_3 / 5 / 74）。
**求值优先级、互斥、触发/成交时点一律由既有权威实现决定，本轮不重写求值器。**

### 2.3 成本与账户假设复核（**与目标 §5 逐字段一致**）

```jsonc
"executionAssumptions": {
  "initialCapital": 100000, "maxDailyBuys": 2, "maxPositions": 5, "executionModel": "NEXT_OPEN",
  "costModel": { "commissionRate": 0.00025, "stampDutyRate": 0.0005,
                 "transferFeeRate": 0.00001, "slippageBps": 5,
                 "lotSize": 100, "minCommission": 5 }
}
```

参考 Run `closed_loop_backtest_run.id = 6210006` 复核：`runId = eval-3600005-promoted-t74`、
`strategyId = first-limit-pullback-3f-top3-runner-t74`、`strategyVersion = 2.0.0`、
`datasetVersionId = 780001`、`status = ALL_EXECUTED`、`initialCapital = 100000`、
`finalEquity = 251095.83`（≈ **+151.10%**）。

### 2.4 🔴 本轮**禁止继承**的旧配置（目标 §5 明确列出，已逐条定位）

| 旧配置 | 位置 | 本轮处置 |
|---|---|---|
| 旧入场门（T 日一字板/T 字板排除、`bar.close > 0` 哨兵、`observationMaxAmplitude < 0.14`） | `definition.entry.conditions[3]` | **不继承**：入场完全由本轮的观察买点规则决定 |
| 旧观察窗/触发（`{start:5,end:15}`、`FIRST_VALID_DAY`） | `definition.entry.observationWindow` / `.trigger` | **不继承**：改为买点规则自己的 `d ∈ [3,9]` |
| 3F 评分分档仓位（`score-tiered-equity-fraction`，档位 0.05 / 0.20 / 0.25） | `document.positionSizing` + `definition.position.positionTiers` | **不继承**：改为**统一** `EQUITY_RATIO` / `equity-fraction` = **0.20** |
| 3F 配方（`recipeId=first-limit-pullback-3f-top3`、TopN 3、合成分排序） | `document.recipe` | **不继承**：排序改为 R = `preReturn10` 降序 + Random 对照 |

**唯一继承物 = `definition.exit`（逐字节）+ `executionAssumptions`（逐字节）。**

### 2.5 真实证券身份（实测可行路径）

- 🔴 Dataset 端口给出的 `ExperimentEventRow.symbol` 是**代码**，不是身份：
  `shared/researchExperimentsContracts.ts` 就该字段明文写着「**绝不可**把 `symbol` 当身份用」。
- ✅ **可用的权威身份源已实测存在**：组合执行面的基线投影
  `.cache/research-dataset-3f-top3-v5-660001.jsonl.gz`（`datasetVersion = rd-1.0.0-1-bd57f47cfcecf245`，
  `rowCount = 1,240,693`，`gate = PASS`）的行 `securityId` 形如
  `sec_0243f859-c738-4804-89ab-0559b73dd94f::event:002862.SZ@2019-01-02`
  ⇒ **每个 eventId 都能取到 canonical `sec_<uuid>`**（经 `baseSecurityIdOf` 剥离后缀）。
- ✅ 该对象由平台在 `executionSurface = "COMPOSITE_PORTFOLIO"` 时经 `context.composite` 注入
  （`server/researchExperiments/runner.ts` → `compositeDatasetProvider.build`），
  **实验侧不需要、也不允许直连数据库**。
- ⚠️ 因此本轮的生命周期/身份口径 = **canonical securityId（身份）**；
  逐日 ST 与上市龄仍不在端口内 ⇒ 记 `UNAVAILABLE`（沿用原实验纪律，不伪造）。

### 2.6 🔴 执行尾部覆盖量化（数据门禁）

冻结退出政策下，**T+10 成交 + Runner 最长续持 74 个持有日** ⇒ 最远约落在锚点 **rd83**。

| 事实 | 实测 |
|---|---|
| 780004 物理 post 上界 | **rd80**（全局最晚 date `2026-01-28`） |
| 主窗口最晚事件 | `605155.SH@2025-09-26`（rd1 = 2025-09-29） |
| 该事件 rd10（最晚入场） | `2025-10-20` |
| 该事件 rd74 / rd80 | `2026-01-20` / `2026-01-28` |
| ⇒ rd83 落点 | ≈ `2026-02-02` ⇒ **超出物理日历约 3 个交易日** |
| 受影响的**潜在**事件（rd1 ≥ 2025-09-25） | **119 个**（占主窗口 20,370 的 **0.58%**；`rd1` 名单实测 2025-09-25=56、09-26=28、09-29=35） |
| 实际受影响笔数 | **只能在 S5 预检里实测**（须同时满足：触发买点 ∧ 被选中 ∧ 实际买入 ∧ 达到持有日 ≥ 第 75 天） |

**处置（不改 780004、不自建新 Dataset）**：

1. **不缩短 74 日政策、不在 rd80 强制卖出、不剔除需要长持有的赢家。**
2. 模拟窗口终点 = 数据集物理末端；期末仍未平仓者按**可靠当日收盘价 MTM** 并在报告中单列。
3. 对「本应继续持有但行情已用尽」的持仓，标记 **`DATA_COVERAGE_BLOCKED`**，
   同时报告数量与其 MTM 损益贡献，**不冒充正常期末持仓**。
4. 该缺口**不足以触发新 Dataset 构建**（0.58% 潜在事件、且需多重条件同时命中）；
   若 S5 预检实测显示实际受影响笔数不可忽略，则**停止**并按目标 §6 提交
   「更长 post 的新版本构建影响 + 预计行数」等待明确授权 —— **不自行构建、不改 780004**。

---

## 3. 集成路径（S3 实现依据）

```
context.composite.baselineDataset      → 逐 eventId 的 canonical securityId（身份）
context.dataset (Dataset 端口)          → prefix rd−10..0（preReturn10）+ post rd1..80（行情）
  ↓ 纯投影（复用 round-1 projection）
滚动池 + 观察分 + 六条件触发 + 状态机 + 原因账
  ↓ 排序（R = preReturn10 HIGH）或随机（200 固定种子）
原始买点候选池（两臂相同）
  ↓ 账户层（各账户独立：同股持仓 / 同锚点曾买 / 空位 / 现金 / 20% 权益预算）
CandidateEvaluationRun（sourceRun）
  ↓ 经 compositeRunnerBridge
runCompositeRunnerBacktest  → 既有 assembleRunWorkbenchInputs（唯一映射实现）
                            → 既有 runTradeSimulation（唯一撮合引擎）
  ↓
canonicalMetrics（唯一指标出口）
```

**复用清单**：`buildDailyPool` / `deriveEventFactors`（round-1 投影）、
`findExecutableExit`、`pickUniformRandomSubset`（随机原语）、`dateClusterBootstrap`、`rankResolution`、
`canonicalMetrics`、`runTradeSimulation`、`assembleRunWorkbenchInputs`、`baseSecurityIdOf`。

**明确不新建**：第二套回测引擎、第二套指标出口、第二套 Dataset 注册坐标、
第二套策略语义 / RuleGraph、第二套 3F 或振幅口径。

---

## 4. 本阶段**未做**与**下一步**

### 未做（如实登记）
- ❌ 未执行任何 DDL / DML 批量写 / 数据构建；**未修改 780004 / 历史 Run / 策略版本 3600005**
- ❌ 未启动正式 Run（S5 待 S3/S4 完成）
- ❌ 未新增或修改任何契约字段

### 下一步（按目标 §8 顺序）
1. **S3**：实现早期入场资格 + 观察分/状态机/原因账（纯研究库）→ 执行数据集与 sourceRun 构造 → 实验登记与前端。
2. **S4**：目标 §8 列出的边界测试（T+9→T+10 允许 / T+10→T+11 禁止 / 停牌不跨截止 / 锚点不刷新 /
   `maxAmp5` 不参与 / 同股多事件不重复持仓 / 同锚点已买不再买 / 20% 预算随权益变化且同日基数一致 /
   Runner 尾部缺口响亮失败 / 候选退出禁用 / 随机同池且确定性）。
3. **S5**：预检（账平 / 边界 / 资金 / 确定性）→ 单个正式对照 Run（R + 200 随机账户）。
4. **S6**：`RESULT-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md` + baseline / CHANGE-AUDIT。
