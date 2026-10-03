# STRATEGY-DEVELOPMENT-TEMPLATE-001

> 目标：以已完整跑通的 **Strategy Version `3570001`** 为参考，把现有能力整理为后续策略可复用的开发模板。
> 本文只描述**已经存在的真实代码**；未为了抽象而新增第二套 simulator / backtest / paper trading engine。
> 回归基线：`3570001` 的 Strategy Definition、结果指标、Paper Trading `6000001` 与 Forward `paper-3570001-forward` 均保持不变。

---

## 0. 结论先行

当前平台已经具备以下通用面：

| 能力 | 通用落点 | 结论 |
| --- | --- | --- |
| Strategy Definition | `server/research/strategySchema/definition.ts` | 已覆盖 dataset / universe / entry / stateFactors / execution / exit / position / risk / parameters；strategyId / version / provenance 在 StrategyDocument / provenance 切面 |
| State / Factor | `server/research/strategySchema/definition.ts` + `server/research/stateFactorRegistry.ts` | 新策略声明 `stateId + version + parameters` 或 `featureId + featureVersion + operator + value`；Runner 不复制状态执行代码 |
| RunnerBridge | `server/research/exitPolicyCommon.ts` + `stateFactorRegistry.ts` + `simulator/engine.ts` | 保留 legacy `state`，新增 `stateCondition`、可配置 `decisionHoldingDays`、PIT `evaluationContext` |
| Research → Strategy | `server/researchExperiments/strategyBridge.ts` + `server/research/strategyCandidate/definitionBuild.ts` | 已有唯一桥：真实 Run → Evidence → Draft → Definition → Strategy Version → Provenance |
| Evaluation | `server/research/strategyEvaluation/**` + `client/src/components/strategy/StrategyEvaluationTemplate.tsx` | canonical backtest / OOS / yearly / drawdown / concentration / cost sensitivity 走同一评估端口 |
| Paper Trading / Forward | `server/paperTradingFramework.ts` + `server/paperTrading3fTop3Runner/**` | 通用 checkpoint / 增量 / 幂等 / no-new-data / error 持久化；3570001 只保留策略适配器 |
| Frontend | `client/src/components/strategy/{StrategyEvaluationTemplate,PaperTradingTemplate}.tsx` | 页面只查询持久化 API；展示区块和格式化逻辑集中复用 |
| 新策略目录 | `research-experiments/template/` | 现有实验模板可直接复制；Strategy Definition 类型模板见 `server/research/strategySchema/template.ts` |

因此，新策略**不需要**实现 simulator、backtest、evaluation、paper trading、forward、前端账户/持仓/收益展示。

---

## 1. 当前完整链路

```text
Research Dataset / Registry
  → Experiment Definition + Runner
  → Experiment Result（Persistence: research_experiment_run + object storage）
  → Observation / Holdout / Confirmatory Gate（独立实验协议）
  → Research Evidence（真实 Run 引用 + canonical digest）
  → Strategy Draft（CandidateSketch 形状）
  → definitionBuild（唯一转换器）
  → StrategyDocument.definition
  → Strategy Version
  → Strategy Research Provenance
  → Backtest
  → Evaluation
  → Paper Trading Historical Seed
  → Forward Paper Trading
  → Frontend
```

### 1.1 逐层责任

| 层 | 输入 | 输出 | 持久化 | 唯一接口 | Strategy-specific | Strategy-generic |
| --- | --- | --- | --- | --- | --- | --- |
| Research Experiment | Dataset 坐标、参数、代码版本 | `ExperimentRunOutcome` | `research_experiment_run` + `result.json` / logs / manifest | `ExperimentRunner` | `experiment.ts` 的取数与计算 | Runner、参数校验、Dataset PIT 契约、结果信封 |
| Observation / Holdout | Experiment + protocol | 结果 Run + gate verdict | Run 表 + result / evidence | `ExperimentEvidenceRunReader` | 实验选择的窗口与证据引用 | Gate 规则、隔离检查、证据解析 |
| Research Evidence | 真实 Run 引用 | `ResearchEvidenceRecord[]` + fingerprint | 冻结进 provenance snapshot | `researchEvidence.ts` | 引用哪些指标 | 真实存在性校验、canonical digest、证据身份 |
| Research → Strategy | Evidence + Draft | `StrategyVersion + provenance` | `strategy_versions` + `strategy_research_provenance` | `createExperimentStrategyBridge` | `entryRule` / `parameterSpace` / `exitRule` / `riskRule` 内容 | 草稿校验、Definition Build、版本幂等、provenance 写入 |
| Strategy Definition | Draft | Canonical `StrategyDefinition` | `strategy_versions.strategyDocumentJson` | `buildStrategyDefinition` | 事件、窗口、状态、阈值、参数 | Schema、规范化、PIT 校验、指纹、投影 |
| Backtest | Strategy Version + Dataset | `TradeSimulationRun` | `closed_loop_backtest_run`（评估/投影留档） | `runTradeSimulation` | 策略文档与参数 | portfolio / execution / cost / audit / T+1 / 权益 |
| Evaluation | Backtest + protocol | canonical metrics / OOS / yearly / drawdown / concentration / cost | evaluation run payload | `evaluateStrategyParameters` / strategy evaluation port | 对照策略与窗口 | 指标口径、OOS 切片、成本敏感性、结果 identity |
| Paper Trading | Historical Seed + Strategy + Dataset | daily signals / fills / positions / exits / account | `closed_loop_backtest_run.result.paperTradingState` | `advancePaperForwardOnce` + strategy adapter | Dataset 构建、选股、模拟器调用、每日投影 | checkpoint、增量、幂等、no-new-data、错误回写 |
| Forward | Historical checkpoint | new daily records + account | `closed_loop_backtest_run.result.paperTradingForwardState` | `createPaperForwardRunner` | 策略 adapter 的增量实现 | load/initialize/advance/save、断点恢复、raw payload |
| Frontend | 持久化 API | 页面 | 不自行落库 | tRPC query | 策略专属列/标签 | Overview、Validation、Account、Position、Runner、Equity 结构 |

---

## 2. Strategy Schema 与具体策略配置的边界

### 2.1 Strategy Schema（通用层）

以下属于 Schema 与平台能力，**不得写入具体策略值**：

- `strategyId` / `version`：StrategyDocument 身份。
- `dataset`：`StrategyDatasetBinding`，只允许引用 Dataset Version，不复制 Dataset 内容。
- `universe`：`StrategyUniverse`，由 Dataset 派生或显式成员声明。
- `entry`：`EventDefinition` + `ObservationWindow` + `ConditionDefinition[]` + `TriggerDefinition`。
- `stateFactors`：`StateConditionDefinition[]` + `FactorConditionDefinition[]`。
- `execution`：signal timing / execution timing / price type / quantity / lot / constraints。
- `exit`：`ExitDefinition` + `ExitPolicyDefinition` + `RunnerHoldingBridgePolicyDefinition`。
- `position`：sizing method / ratio / max positions / exposure。
- `risk`：止损、组合回撤、暴露、集中度等规则。
- `parameter`：FIXED / TUNABLE / DERIVED 参数定义。
- `provenance`：来源 Run、Evidence、digest、sourceKind；独立表 `strategy_research_provenance`。

### 2.2 具体策略配置（Strategy-specific）

以下内容属于某个策略的配置或注册项，**不得写进通用执行分支**：

- `FIRST_LIMIT_UP`、首板语义、具体 Dataset code。
- `NEW_HIGH_3`、`MA10_SLOPE_POSITIVE`、`CLOSE_ABOVE_MA10`。
- `3F Top3`、`T+6`、`hold=5`、`extend=20`。
- 具体止损比例、MA5 / MA10、仓位比例、TopN。
- `3570001` 的 `strategyId`、provenance、paper runId。

其中 `NEW_HIGH_3` 等是**已注册状态的配置引用**，不是通用层的 `if (state === "NEW_HIGH_3")` 分支。

---

## 3. State / Factor 抽象

### 3.1 声明形态

`StrategyDefinition.stateFactors`（可选，缺省不改变既有策略）：

```ts
stateFactors: {
  states: [{
    id: "runner-state",
    stateId: "NEW_HIGH_3",
    version: "1",
    enabled: true,
    evaluationContext: {
      decisionPoint: "CLOSE",
      historyFrom: "ENTRY",
      historyTo: "DECISION",
      requiredData: ["OHLCV"],
      usesForwardData: false
    }
  }],
  factors: [{
    id: "ma10-slope",
    featureId: "ma10Slope",
    featureVersion: "1",
    operator: "GREATER_THAN",
    value: 0,
    valueType: "CONSTANT",
    enabled: true
  }]
}
```

- `StateCondition` 引用状态注册表，适合 `NEW_HIGH_3` / `MA10_SLOPE_POSITIVE` / `CLOSE_ABOVE_MA10`。
- `FactorCondition` 引用既有 feature registry 的 feature id / version，并复用比较算子。
- 状态 / 因子的实现版本变化必须换 `version`，不能原地改义。
- PIT 上下文固定为 `ENTRY..DECISION`，`usesForwardData` 必须为 `false`。

### 3.2 执行实现

`server/research/stateFactorRegistry.ts` 是状态实现的注册表：

- `RUNNER_STATE_DEFINITIONS` 注册已有状态纯函数；
- `evaluateRunnerStateCondition(reference, input)` 统一求值；
- `evaluateRunnerHoldingBridgeStateByRegistry` 供 legacy `state` 复用；
- `evaluateRunnerBridgePolicyState` 同时支持 legacy `state` 与 `stateCondition`。

新增状态只注册一个纯函数，不再修改 simulator 的 `switch`。这也是“声明 + 注册表”而不是“每个策略复制一份执行代码”。

---

## 4. RunnerBridge 泛化

### 4.1 保留的 3570001 兼容形状

```json
{
  "kind": "PIT_RUNNER_HOLDING_BRIDGE",
  "state": "NEW_HIGH_3",
  "decisionHoldingDays": 5,
  "extendToHoldingDays": 20
}
```

Schema 继续接受该形状；`3570001` 的 Definition、Backtest、Evaluation、Paper Trading 结果不因新增字段而改变。

### 4.2 通用形状

```json
{
  "kind": "PIT_RUNNER_HOLDING_BRIDGE",
  "stateCondition": {
    "stateId": "MA10_SLOPE_POSITIVE",
    "version": "1",
    "parameters": {}
  },
  "decisionHoldingDays": 3,
  "extendToHoldingDays": 8,
  "evaluationContext": {
    "decisionPoint": "CLOSE",
    "historyFrom": "ENTRY",
    "historyTo": "DECISION",
    "requiredData": ["OHLCV"],
    "usesForwardData": false
  }
}
```

规则：

- `state` 与 `stateCondition` **恰有其一**；
- `decisionHoldingDays` 为正整数，不再固定为 5；
- `extendToHoldingDays` 必须大于 `decisionHoldingDays`；
- `evaluationContext` 缺省使用 `DEFAULT_RUNNER_EVALUATION_CONTEXT`；
- 校验唯一入口：`server/research/exitPolicyCommon.ts#runnerBridgePolicyErrors`，Strategy Schema / Simulator / Record 复核共用。

### 4.3 生命周期

纯函数 `runnerBridgeLifecycleState` 固定四态：

```text
PENDING
  → STATE_EVALUATION
  → EXTEND
  → NORMAL_EXIT
```

- 持有日 < `decisionHoldingDays`：`PENDING`；
-  == `decisionHoldingDays`：`STATE_EVALUATION`；
-  状态为真：`EXTEND`；
-  状态为假：`NORMAL_EXIT`。

`server/research/simulator/engine.ts` 只在等价条件满足时调用注册表；Paper Trading 投影层复用同一注册表结果，不另写判定。

---

## 5. Research → Strategy 统一模板

正式顺序：

```text
Research Evidence
→ Observation
→ Holdout
→ Confirmatory Gate
→ Strategy Draft
→ Definition Build
→ Strategy Version
→ Provenance
```

### 5.1 后续策略只需要提供

1. `experiment`：`ExperimentDefinition`（取数、计算、参数、Dataset requirement）。
2. `evidence`：`ResearchEvidenceRef[]`，引用**真实存在且 COMPLETED** 的 Run。正式提升通常引用 Observation / Holdout / Gate 证据。
3. `candidate sketch / definition inputs`：`ExperimentStrategyDraft`（`entryRule` / `parameterSpace` / `exitRule` / `riskRule`，如适用）。
4. Dataset 坐标与执行语义。
5. 人类可读的 `strategyId` / version 策略（通常桥的首版为 `1.0.0`）。

### 5.2 通用 Bridge 负责

- 真实 Run 读回与 provenance 冻结；
- evidence 点分路径解析与 digest；
- Holdout / Observation 来源一致性检查；
- Draft → StrategyDefinition / execution assumptions / recipe；
- 创建幂等 Strategy Version；
- 写 `strategy_research_provenance` 并保存来源快照。

### 5.3 `strategyVersionId` / provenance 正式语义

- `strategyVersionId`：`strategy_versions.id`，是 Strategy Version 的**持久化行主键**。
- 执行语义身份：`strategy_versions.fingerprint`，它只覆盖 Definition 等执行语义；证据变化不应伪装成执行语义变化。
- 研究身份：`strategy_research_provenance`：
  - `sourceKind = INDEPENDENT_EXPERIMENT`；
  - `sourceExperimentId = null`（独立实验没有 legacy Research 结论）；
  - `experimentRef` / `experimentVersion` / `experimentResultDigest`；
  - `sourceSnapshotJson` 内冻结真实 Run List 与 gate 结论。
- 在报告、前端和回归脚本中，引用 Strategy 时应同时报告 `strategyVersionId` 与 provenance id / sourceKind，不能只报 version label。
- `3570001` 的正式坐标是：`strategyVersionId=3570001`、`provenanceId=660001`、`sourceKind=INDEPENDENT_EXPERIMENT`、`holdoutRunId=RUN-20261002-BD1D7332`。

---

## 6. 通用 Evaluation 模板

所有策略只提供 **Strategy Version + Dataset**，统一评估以下项目：

| 评估面 | 统一口径 |
| --- | --- |
| Canonical Backtest | 同一 simulator：T+1、整手、成本、停牌/涨跌停约束、权益曲线 |
| OOS / Holdout | 使用同一 full-run 权益曲线切片或独立保留窗口；窗口与 protocol fingerprint 留档 |
| Yearly Metrics | 按自然年切收益、MaxDD、交易数、PF |
| Drawdown | 权益曲线回撤、最大回撤、最长回撤持续时间 |
| Concentration | Top 5% / Top 10% 收益贡献、最大盈/亏、连续亏损 |
| Cost Sensitivity | 标准成本与成本 multiplier 对照；不因敏感性结果重跑参数搜索 |
| Baseline Comparison | 基线版本、提升版本同一 Dataset / window / simulator / cost model |

实现入口：

- 端口：`server/research/strategyEvaluation/evaluate.ts`
- 回测桥：`server/research/strategyEvaluation/backtestBridge.ts`
- 持久化结果读取：`closed_loop_backtest_run`
- 前端通用展示：`client/src/components/strategy/StrategyEvaluationTemplate.tsx`

---

## 7. 通用 Paper Trading / Forward 模板

### 7.1 数据流

```text
Historical Seed
→ Forward State
→ Daily Increment
→ Signal
→ Fill
→ Position
→ Runner
→ Exit
→ Account
```

### 7.2 通用框架

`server/paperTradingFramework.ts` 负责：

- `resolveTradingCalendar()`：只接受适配器声明的真实交易日；
- `tradeDate > lastProcessedTradingDate`：增量推进；
- 无新日期：`WAITING_FOR_NEW_DATA`，不 build / 不 merge，不制造记录；
- `buildIncrement` / `mergeIncrement`：策略适配器提供的真实 simulator 投影；
- 错误：写回 `ERROR + lastError`，不破坏既有 checkpoint；
- `createPaperForwardRunner`：`load → initialize/advance → save`；
- 断点恢复：先读持久化 checkpoint，只有缺行才用历史种子初始化；
- raw payload recovery：由适配器的 `load/save` 端口处理，不在框架内二次解释。

### 7.3 3570001 适配器边界

`server/paperTrading3fTop3Runner/forward.ts` 只提供：

1. Dataset 交易日 / 最新数据日；
2. `buildFirstLimitPullback3FTop3SourceRun` + `runCompositeRunnerBacktest` 的真实执行；
3. `derivePaperTradingDaily` 投影；
4. `mergeForwardDays`。

它**不**实现：日期推进、幂等筛选、checkpoint 读写、no-new-data、错误状态机。这些均已收敛到通用框架。

### 7.4 数据边界

- 每一步只允许使用 `<= 当前处理交易日` 的信息；
- 未到 Runner 判定日的持仓必须是 `PENDING`；
- 扩展投影中晚于数据集声明窗口的行不得当作新交易日；
- 无新数据时不使用历史数据冒充 Forward；
- 真实结果只从持久化 payload 读取。

---

## 8. 前端复用方式

### 8.1 通用页面结构

```text
Strategy Overview
  ├── Strategy Version / StrategyId
  ├── Dataset
  ├── Protocol
  └── Provenance

Research / Validation
  ├── Full
  ├── OOS
  ├── 年度
  ├── Drawdown
  ├── Concentration
  └── Cost Sensitivity

Paper Trading
  ├── 当前账户
  ├── 股票池 / Signal
  ├── 持仓
  ├── Runner
  ├── Exit
  └── Equity
```

### 8.2 复用入口

- 评估：`client/src/components/strategy/StrategyEvaluationTemplate.tsx`
- 模拟盘：`client/src/components/strategy/PaperTradingTemplate.tsx`

页面只做两件事：

1. 调既有持久化 tRPC API；
2. 把 payload 和策略专属列传给通用模板。

示例：`PaperTrading3570001.tsx` 只注入 `3F Top3 排名` 与 `NEW_HIGH_3` 两列；账户、持仓、Runner、Exit、Equity 都由通用模板渲染。`StrategyFinalEvaluation.tsx` 只查询并传 `evaluationDetail`。

**禁止**在页面中写死收益数字、账户数字、策略版本语义、Runner 参数或结果日期。展示字段必须来自持久化 API。

---

## 9. 新策略开发模板

### 9.1 目录模板

复制现有实验模板：

```text
research-experiments/<strategy>/
├── experiment.ts     # Strategy-specific：ExperimentDefinition / 取数 / 计算
├── result.ts         # Strategy-specific：结果 schema / 表格 / 统计 / 图表
├── page.tsx          # Strategy-specific：只读展示，不硬编码业务数字
└── README.md
```

Strategy Definition 模板落在现有 Schema 中：

```text
server/research/strategySchema/template.ts
server/research/strategySchema/definition.ts
```

### 9.2 Strategy Definition 模板

```text
Strategy
├── Dataset
├── Universe
├── Entry
├── State / Factor
├── Runner
├── Exit
├── Position
├── Risk
└── Execution
```

对应字段：

| 模板项 | 代码字段 |
| --- | --- |
| Strategy identity | `StrategyDocument.strategyId` / `.version` |
| Dataset | `StrategyDefinition.datasets[]` / `StrategyDocument.datasetVersionId` |
| Universe | `StrategyDocument.universe` |
| Entry | `StrategyDefinition.entry` |
| State / Factor | `StrategyDefinition.stateFactors` |
| Runner | `ExitPolicyDefinition.runnerBridge` |
| Exit | `StrategyDefinition.exit` |
| Position | `StrategyDefinition.position` |
| Risk | `StrategyDefinition.risk` |
| Execution | `StrategyDefinition.execution` |
| Parameter | `StrategyDefinition.parameters[]` |
| Provenance | `strategy_research_provenance` |

### 9.3 新策略最少需要实现什么

- 一个 Experiment（真实数据、PIT 声明、样本账平）。
- 一个 Strategy-specific Draft / Definition 输入。
- 一个 Dataset 坐标。
- 一组 Evidence 引用（正式提升必须来自真实 Run）。
- 如使用新状态：在 `stateFactorRegistry` 注册一个纯函数声明。
- 前端策略专属列（可只注入 `signalColumns`）。

不需要实现：

- simulator / backtest / portfolio / cost / execution；
- evaluation 指标；
- Paper Trading / Forward 日期推进与 checkpoint；
- Equity / Account / Position / Exit 通用页面；
- 第二个 Runner engine。

---

## 10. 3570001 回归报告

回归脚本：`scripts/verifyStrategy3570001Regression.mts`，命令：`pnpm strategy:verify-3570001`。

本轮实测结果：

| 检查 | 结果 |
| --- | --- |
| `strategy_versions#3570001` | PASS |
| StrategyId / version | `first-limit-pullback-3f-top3-runner-hold20@1.0.0` |
| Dataset | `750001` |
| Runner | `NEW_HIGH_3 / decisionHoldingDays=5 / extendToHoldingDays=20` |
| Provenance | `660001 / INDEPENDENT_EXPERIMENT / RUN-20261002-BD1D7332` |
| Full Return | `129.6860%` |
| MaxDD | `45.0611%` |
| Profit Factor | `1.1853` |
| Baseline 1.62.1 Full Return | `15.7877%` |
| Paper Trading | row `6000001`，407 日，equity `199036.53`，累计 `99.0365%` |
| Forward | `paper-3570001-forward`，当前 `WAITING_FOR_NEW_DATA`，从 6000001 账户继续 |

结论：模板化没有修改 `3570001` 的策略语义，也没有造成历史结果漂移。

---

## 11. 本轮保留为 Strategy-specific / 未继续抽象的部分

以下内容**不应为了形式统一强行重构**，保留现状并记录原因：

- `paperTrading3fTop3Runner`：3570001 的选股、3F Top3、`newHigh3` 投影仍是策略专属；通用 forward 框架已通过适配器复用，未强行把所有列抽象成无类型配置。
- `firstLimitPool`：首板池语义拥有自己的评分 / 移池 / 再入场字段，强行压缩到通用 Entry 会丢失执行语义。
- `strongHold` / `recoveryPath` / `clc2ReversalPath`：这些是已冻结的退出路径研究语义，继续使用现有 exitPolicy 类型；仅把 RunnerBridge 的状态执行做注册表化。
- `3570001` 的 legacy `state` 字段：保持原样，作为历史版本兼容面，不迁移数据库记录。
- 独立实验目录中的具体实验指标和列：属于策略研究内容，不纳入通用 Schema。

这些保留项不阻断新策略模板：新策略可复用平台执行、评估、Paper/Forward 与前端框架，只在策略目录和注册表中实现自己的语义。

---

## 12. 验证命令

```bash
pnpm check
pnpm test -- tests/server/research/runnerBridgeTemplate.test.ts
pnpm test -- tests/server/paperTradingFramework.test.ts
pnpm test -- tests/server/paperTrading3fTop3Runner
pnpm test -- tests/server/research/simulator/simulator.test.ts
pnpm test -- tests/server/research/exitPolicy/exitPolicyDefinition.test.ts
pnpm build
pnpm strategy:verify-3570001
```

最终判定：**已具备“按模板开发下一套策略”的条件。**

### 12.1 本轮实测结果

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | PASS（本任务改动完成后实测；随后并行会话 staged 删除 4 个无关 legacy 文件，当前工作区 tsc 会因该外部改动失败） |
| `pnpm build` | PASS（Vite + server bundle） |
| 新增 RunnerBridge / StateFactor 测试 | PASS |
| 新增 Paper Forward 通用框架测试 | PASS |
| 3570001 / simulator / exitPolicy / Paper 定向测试 | 61 passed |
| 相关 server + client 扫描 | 2433 passed / 3 failed；3 项均为工作区既有的 `recoveryPath: null` 期望未同步，与本次模板化无关 |
| `pnpm strategy:verify-3570001` | 15/15 PASS |

这三项既有失败不涉及 3570001 的数值或本次新增接口；在最终报告中如实保留，不把它们伪装成全绿。
