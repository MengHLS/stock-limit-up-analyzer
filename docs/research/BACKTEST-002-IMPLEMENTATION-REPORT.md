# BACKTEST-002 — Backtest Execution Correctness & Result Persistence 实施报告

> 本文件替代此前的 BACKTEST-002 报告（含"未收口版"），是本轮收尾后的**唯一版本**。
> 收尾规格 = `BACKTEST-002 FINAL CLOSEOUT-2`（4 项：B-04 收口 / R-02 schema / B-03 真实 E2E / R-04 zero-volume）。

---

## 1. Executive Summary

**BACKTEST-002 = COMPLETE**（口径见 §13；唯一未收口项是一条**观察级**性能现象，不属本任务验收条件，已如实登记为 R-06）。

| 项 | 本轮之前 | 本轮之后 |
|---|---|---|
| B-01 Execution Policy | ✅ versioned | ✅ 不变（v1） |
| B-02 Position Sizing 真正生效 | ✅ | ✅ 不变（新增 fixed-amount 声明路径） |
| B-03 BacktestResult → `resultJson` | ⚠️ 仅内存级契约测试 | ✅ **真实 Run 端到端 + 真库只读核验**（§7 §9） |
| B-04 Canonical Metrics 唯一 | ❌ 两套口径（年化基数 244 / 252、回撤符号相反、收益率算式不同） | ✅ **三处口径差全部消除**，闭环 evaluation 在真实链路上 `metricsSource = "canonical"`（§3 §4 §5） |
| B-05 zeroVolumePolicy | ✅ | ✅ + **三执行模型端到端测试**（§10） |
| R-02 `fixed-amount` 进 Strategy Schema | ❌ | ✅ 全链开放 + 真实执行测试（§6） |

**本轮真正的产出不是"新增代码"，而是把"两套口径"消灭掉**：BACKTEST-002 声称的"唯一读数面"此前只是**文件层面的唯一**（`canonicalMetrics()` 只有一份实现），但三处口径差让它和闭环 evaluation 算出的数**不是同一个数字**（§4 表）。收尾把它们对齐后，"同一份曲线在任何路径上都得不到第二个数字"才成立（有 10 位小数逐位相等的测试 + 真实 Run 逐项比对）。

---

## 2. B-01 ～ B-08 最终状态

| 编号 | 状态 | 说明 |
|---|---|---|
| **B-01** Execution Policy versioned | ✅ **COMPLETE** | 集中在 `server/backtest/context.ts`；`BACKTEST_EXECUTION_POLICY_VERSION = 1`；政策全文进 Run Record（零 schema 变更）。涨停买 / 跌停卖 = `REJECT`，停牌 = `REJECT`（不顺延）。 |
| **B-02** Position Sizing 真正影响订单 | ✅ **COMPLETE** | `server/research/simulator/plan.ts#applyPositionSizing` 参与成交预算（`min(...)` 只收窄不放大）；链路 = 文档声明 → `mapDeclaredPositionSizing` → `SimulationConfig.positionSizing` → `planDecisionDay`。 |
| **B-03** BacktestRunResult 进 `resultJson` | ✅ **COMPLETE** | 根因 = `loopRun` 丢弃了 `createClosedLoopWiring` 的 `artifacts`（一行解构修复）；真实 Run 端到端 + 真库核验见 §7 §9。 |
| **B-04** Canonical Metrics 唯一 | ✅ **COMPLETE** | 唯一实现 = `server/backtest/backtestResult.ts#canonicalMetrics()`；闭环 `evaluation` 的重叠标量取自它；三处口径差已消（§4）。 |
| **B-05** zero-volume policy | ✅ **COMPLETE** | `zeroVolumePolicy`（默认 `REJECT`）在 `simulator/engine.ts` 的 T+1 执行循环**统一把关**（补上"只有 VWAP_PROXY 看 volume"的漏洞）；三模型端到端测试（§10）。 |
| B-06 `BacktestResult` / `BacktestRunResult` 命名 | ⏸ **DEFERRED**（按规格 §23） | 现状保留：`types.ts:401 BacktestResult`（legacy 引擎对象，生产不可达）与 `backtestResult.ts` 的 `BacktestRunResult`（Core 统一结果）**同域不同形**，已在两处文件头显式登记；`backtest/index.ts` 显式点名导出避免歧义。 |
| B-07 `runBacktestEngine2` 生产不可达 | ⏸ **DEFERRED**（按规格 §23） | 保留 LEGACY 标记，不删。 |
| B-08 `suspensionPolicy = DEFER` | ⏸ **DEFERRED**（按规格 §23） | 生产实际政策 = `REJECT`（不顺延），已由 `describeExecutionPolicy()` 明确记录；不实现 `DEFER`。 |
| **R-02**（＝前一份规格里的 R-03） | ✅ **COMPLETE** | `fixed-amount` 正式进入 Strategy Schema（§6）。 |

---

## 3. Canonical Metrics 最终架构

```
TradeSimulationRun（backtest 阶段真实产物：equityCurve / trades）
        │
        ▼
server/backtest/backtestResult.ts            ← 唯一实现
   ├── canonicalMetrics()        ← 规格 §17 的 8 项（+ 口径 + 交易计数）
   ├── analyzeEquityCurve()      ← 年化复用 shared/quant-stats 原语
   ├── computeTradeMetrics()     ← 期末未平仓不进胜率 / 盈亏比
   ├── backtestRunAmounts…       （数值都在上面两个函数里）
   ├── BACKTEST_ANNUALIZATION_DAYS / _BASIS   ← 年化口径唯一常量 + 可序列化描述
   └── buildBacktestRunPayload()  ← 有界载荷（摘要 + ≤60 样本 + 全量指纹）
        │
        ├──► closed_loop_backtest_run.resultJson.backtest
        └──► ClosedLoopEvaluationRef.canonicalMetrics
                    │
                    ▼
             evaluation 阶段的重叠标量（唯一来源）
                    │
                    ▼
             前端（零改动：既有 adapter 直接读这些字段）
```

**唯一性由两类证据锁住**：
1. **代码层**：`buildBacktestResult()` 内部改走 `canonicalMetrics()`（同源）；`composeClosedLoopEvaluationRef` 的重叠标量在给 canonical 时**一律取它**（含 `null`，即 `NOT_AVAILABLE` 不被评估器数值顶替）。
2. **测试层**：`tests/server/backtest/canonicalMetricsParity.test.ts` 用**两条不同曲线**做交叉验证 —— 让"评估器看 A 曲线、canonical 看 B 曲线"，投影出来的必须是 B 的值，从而证明不存在第二条计算路径。

---

## 4. 年化基数最终选择及理由

### 4.1 选择：**252 交易日/年**（不是偏好，是"异类是我"）

Phase A 全仓实测：**除 BACKTEST-001 自己写的 `244` 外，所有年化路径都已经是 252** ——

| 位置 | 基数 |
|---|---|
| `shared/quant-stats.ts:277` `annualizedReturnFromEquityCurve(..., annualizationTradingDays = 252)` | **252**（全项目唯一原语） |
| `backtest/metrics.ts:57` | 252 |
| `engine/performance.ts:60` | 252 |
| `research/performanceMetrics/analyze.ts:516` / `evaluate.ts:103` | 252 |
| `research/riskAdjustedMetrics/analyze.ts:157/174/194/246` | 252 |
| `research/marketRegime/config.ts:52` | 252（**明写理由**："A 股一年约 242~244 个交易日，252 是国际通行口径…便于跨模块结果可比"） |
| `research/stochasticRobustness/types.ts:441` | 252 |
| `overfittingGuard.ts:188` | 252 |
| `downsideRisk.ts:328` | 252 |
| ~~`backtest/backtestResult.ts:102`（本轮前）~~ | ~~**244**~~ ⇒ **已改为 252** |

⇒ 规格 §2A 要求"Backtest / Evaluation / Parameter Search 同一基数"，而**唯一的异类是 BACKTEST-001 自己**。修自己（1 个文件）比改 8 个既有模块正确。

产物：
```ts
export const BACKTEST_ANNUALIZATION_DAYS = 252;
export const BACKTEST_ANNUALIZATION_BASIS = { type: "TRADING_DAYS", daysPerYear: 252 };
```
口径随指标一起输出（规格 §2C）：`canonicalMetrics().annualizationBasis` → 进载荷 → 进 `evaluationRef`。**消费方不需要知道 252 从哪来。**

### 4.2 收尾时发现并消除的**另外两处**口径差（比基数更隐蔽）

只统一基数是不够的 —— 实测两条路径算出的**不是同一个 double**：

| # | 量 | 收尾前 | 收尾后 | 怎么发现的 |
|---|---|---|---|---|
| 1 | **年化指数分母** | canonical：`244 / 权益点数`（n = 点数） | `252 / (点数 − 1)`，且**改用共享原语** `annualizedReturnFromEquityCurve` | `performanceMetrics/analyze.ts:15-17` 已文档化 `n = 收益区间数 = 权益点数 − 1` |
| 2 | **最大回撤符号** | canonical：**负数**（`min(equity/peak − 1)`） | **正数幅度** `max((peak − equity)/peak) × 100` | 全项目既有口径都是正数（`performanceMetrics.analyzeDrawdown` 的 `depthPct`、`riskAdjusted` 的 `calmar = CAGR/maxDD`、`engine/performance`、`downsideRisk`）；若为负则 calmar 符号直接反了 |
| 3 | **收益率算式形式** | canonical：`((end − start)/start) × 100` | `(end/start − 1) × 100`（与 `performanceMetrics` **逐字符一致**） | 闭环两个既有测试报 `expected 5.3 to be 5.299999999999994` —— 代数等价但**浮点不同** |

第 3 条的价值：**"唯一口径"必须连同算式形式一起统一**，否则同一量在两条路径上仍是两个不同的 double，"唯一读数面"就只剩口号。锚点仍是 `initialCapital`（规格 §18）；因 C-14.1 输出首点 equity == initialCapital，与用 `equityCurve[0].equity` 的结果一致（该等价性已在 `performanceMetrics/analyze.ts:17` 文档化）。

> ⚠️ 逐点 `drawdownPct`（`analyzeEquityCurve().points[].drawdownPct`）**仍是有符号的 ≤ 0**（水下曲线语义）。它与全期标量 `maxDrawdownPct` 是**两个不同的量**，两者都在 JSDoc 里写明了区别，并有独立的测试断言（`backtestCore.test.ts` 同时断言 `maxDrawdownPct ≈ +18.18` 与 `points[3].drawdownPct < 0`）。

---

## 5. Evaluation 接线结果

`server/research/closedLoopWiring/executors.ts` 的 `evaluation` 阶段：

```ts
// ① 年化基数唯一化：调用方给不同基数 ⇒ 响亮抛错（不静默改用）
if (annualizationFactor !== undefined && annualizationFactor !== BACKTEST_ANNUALIZATION_DAYS) {
  throw new ClosedLoopWiringError("CL_WIRING_ANNUALIZATION_BASIS_MISMATCH", …);
}
// ② canonical 唯一读数面（锚点 = simulationConfig.initialCapital；直供路径回落 equityCurve[0].equity）
const canonical = canonicalMetrics({ equityCurve, tradeLedger: trades ?? [], initialCapital: canonicalAnchor });
// ③ 三个评估器仍真实调用（保留其非重叠指标），统一显式传 252
const performance = evaluatePerformance({ …, annualizationFactor: BACKTEST_ANNUALIZATION_DAYS });
// ④ 组装时把 canonical 交给投影层 ⇒ 重叠标量取自 canonical
return composeClosedLoopEvaluationRef({ backtestFingerprint, performance, riskAdjusted, tradeQuality, canonicalMetrics: canonical });
```

`server/research/closedLoop/adapters.ts#composeClosedLoopEvaluationRef`：

| 字段 | 来源（给了 canonical 时） | 未给 canonical 时 |
|---|---|---|
| `performance.totalReturnPct` | canonical `totalReturnPct` | 评估器自身值 |
| `performance.cagrPct` | canonical `annualizedReturnPct` | 评估器自身值 |
| `performance.maxDrawdownPct` | canonical `maxDrawdownPct` | 评估器自身值 |
| `tradeQuality.winRatePct` | canonical `winRatePct` | 评估器自身值 |
| `tradeQuality.profitFactor` | canonical `profitFactor` | 评估器自身值 |
| `tradeQuality.completedTradeCount` | canonical `completedTradeCount` | 评估器自身值 |
| （新增）`canonicalMetrics` / `metricsSource` / `annualizationBasis` | 全新字段 | `canonicalMetrics = null`、`metricsSource = "evaluators"` |

**保留不变**：`riskAdjusted`（Sharpe / Sortino / Calmar）、评估器指纹、`evaluatorsCovered` —— 规格 §17 "不要为了统一而删除已有有业务意义的指标"。**前端零改动**：既有 adapter/UI 直接读这些字段名，因此自动显示 canonical 的数字。

**降级路径如实标记**：未接线（历史留档 / 直供路径未给 canonical）时 `metricsSource = "evaluators"` —— 不假装已统一。

---

## 6. `fixed-amount` 进入 Strategy Schema（R-02）

| 层 | 改动 |
|---|---|
| 类型 | `strategySchema/types.ts`：`POSITION_SIZING_KINDS` += `"fixed-amount"`；判别联合新增 `{ kind: "fixed-amount"; fixedAmount: number; maxPositions: number }` |
| 校验 | `strategySchema/validate.ts`：新增分支 `SCHEMA_POSITION_SIZING_FIXED_AMOUNT_INVALID`（`fixedAmount` 必须为 > 0 的有限数字） |
| legacy 投影 | `strategySchema/legacyViews.ts`：`sizingMethod = FIXED_AMOUNT` → `{ kind: "fixed-amount", fixedAmount }`；**缺金额 ⇒ 抛错**（此前被静默投影成 `fixed-fraction`，等于改写了策略语义） |
| 装配映射 | `runWorkbenchAssembly/assemble.ts`：抽出**具名纯函数** `mapDeclaredPositionSizing()`（此前是内联 IIFE，无法被测试触及）；`fixed-amount` 缺/非法金额 ⇒ `LOOP_RUN_ASSEMBLY_POSITION_SIZING_AMOUNT_INVALID` |
| 前端（最小） | `client/src/adapters/strategyAdapter.ts`（kinds + 解析/序列化 + 标签/说明）、`PositionSizingEditor.tsx`（金额输入框）。**不做 UI 重构** |
| 执行层 | 无需改动 —— `plan.ts#applyPositionSizing` 的 `FIXED_AMOUNT` 分支早已存在（本轮把它接到了声明侧） |

规格 §4 的 7 条要求，逐条有断言（`tests/server/backtest/positionSizingFixedAmountSchema.test.ts`，12 用例）：
✅ 可声明 ✅ 可验证 ✅ 全链可通 ✅ `<= 0` 拒绝 ✅ 缺失拒绝 ✅ 不静默退化成 equal-weight ✅ 真实执行测试（`fixedAmount` 30000 → 60000 ⇒ 下单股数约翻倍；`500` 元 ⇒ 不足一手不建仓，skip 原因 `BUDGET_BELOW_MIN_LOT`）。

---

## 7. B-03 真实 E2E Run 结果

**路径**：`appRouter.createCaller(admin)` → `researchRun.loopRun` → 真库，策略 `cand-360004@1.0.0`（绑定 `dataset_version.id = 390002`）。
**探针**：`docs/evidence/_probe_backtest_closeout_e2e.mts`（**不自清理** —— 规格 §5.1 允许留一条新 Run 作证据）。

**本轮共跑了三次真实 Run**（下表是理解后面所有数字的前提）：

| 轮次 | 窗口 | 耗时 | 内存侧 | 落库 |
|---|---|---|---|---|
| #1 | 2025-01-02~03-31 | **593.3 s** | ✅ `backtest=EXECUTED`、3 笔成交 | ❌ insert 失败（§7.1） |
| #2 | 2025-01-02~01-31（1 个月） | **616.4 s** | ✅ 2 笔成交 | ❌ 同样失败 ⇒ **系统性**，且证明**耗时与请求窗口无关** |
| **#3（保存证据的那一次）** | 2025-01-02~03-31 | **626.7 s** | ✅ 3 笔成交 | ✅ **第 3 次尝试成功**（修复后） |

🔴 **#1 与 #3 是同输入** ⇒ 两次独立运行的 `equityDigest` / `tradeDigest` **逐字节相同**，故下表所有指纹 / 体积 / 数值对 #1 与 #3 同时成立。

| 断言 | 实测 |
|---|---|
| `loopRun` 返回含 `backtest` | ✅ |
| 返回仍含 `strategyRun`（ARCH-002，未被覆盖） | ✅ |
| `stages` 长度 | 14 |
| `backtest` 阶段状态 | `EXECUTED` |
| 真实成交 | **3 笔**（`initialCapital = 100,000`） |
| `evaluation` 阶段状态 | `EXECUTED` |
| `evaluationRef.metricsSource` | **`"canonical"`** |
| 5 个重叠标量 vs `backtest.canonicalMetrics` | **逐项相等**（`totalReturnPct` / `cagrPct` / `maxDrawdownPct` / `winRatePct` / `profitFactor`） |
| `canonicalMetrics.annualizationBasis` | `{ type: "TRADING_DAYS", daysPerYear: 252 }` |
| 有界 | `equitySamples = 57`、`tradeSamples = 3`（均 ≤ 60）；`truncated = {equity:false, trades:false}`；两个 digest 均为 sha256 |
| 明细未全量入库 | `backtest` 段序列化 **10,775 B**；段内**无** `equityCurve` / `tradeLedger` / `trades` / `positions` / `orders` 字段 |
| 指标实例（本次运行） | `totalReturnPct = 4.0838%`、`annualizedReturnPct = 19.736%`、`maxDrawdownPct = 20.348%`、`tradeCount = 3`、`winRatePct = 100`、`profitFactor = NOT_AVAILABLE`（无亏损笔 ⇒ 不编 Infinity） |
| **确定性（跨进程）** | 修复前后两次**独立**真实运行（593.3 s / 626.7 s，同窗口同策略）产出的 `equityDigest` / `tradeDigest` **逐字节相同**（`d208a2d0…` / `b1153182…`）⇒ 同输入 ⇒ 同结果，且与落库值同源 |

### 7.1 🔴 本轮抓出的**真实缺陷**：长运行「留档只尝试一次」⇒ 必然静默丢档

第一次真实 Run 的 `insert` 失败，报错只给了 SQL 与参数、没给原因；**紧随其后的只读 SELECT 首发也失败、重试即成功** ⇒ 判定：计算阶段（593~616 s）完全不碰 DB，结束时池中那条连接已被链路（TiDB Cloud / 本地代理）**静默重置**；而留档是**单次 best-effort**（失败只 `console.warn`）⇒ **长运行每次都静默丢掉留档**，"每次运行都留档"这个承诺在长运行上不成立。

第二次跑（1 个月窗口，**616.4 s**）**同样复现** ⇒ 不是偶发。顺带得到一个反直觉事实：**耗时与请求窗口无关**（3 个月 593.3 s vs 1 个月 616.4 s）⇒ 瓶颈在**数据集装载**（112,920 行），不在逐决策日扫描。

**修法**（`server/researchRunRouter.ts#persistClosedLoopBacktestRun`）：改**有界重试**（≤3 次、线性退避 300/600 ms）。
- 仍是 best-effort、**不抛** —— 把"历史列表少一条"升级成"回测结果丢失"是更坏的交易；
- 幂等由 `runId` 唯一键 + `on duplicate key update` 保证（重试不会堆重复行）；
- 第 ≥2 次成功时打印 `在第 N 次尝试成功`，让"连接被重置"这件事**可见**而不是被吞掉。

> 该缺陷正是 B-03 的验收条件本身（"真实 Run → resultJson 成功"），因此修在**本任务范围内**，不是扩大范围。

**`loopRun` 返回体无异常**：`backtest` 与 `strategyRun` 同时在列。

> 运行结果整体为 `PARTIAL_BLOCKED`（`executedStageCount=6 / blockedStageCount=8`，首阻塞 `CL_RUNNER_NOT_INJECTED` @ `robustness`）—— 这是闭环既有的"执行器未注入即如实阻塞"语义（runnerInjected = data/research/strategy/backtest/evaluation/optimization/regime），**不影响** backtest 与 evaluation 两个阶段都真实 `EXECUTED`。

---

## 8. `resultJson` 实际结构

```jsonc
{
  // …既有字段（runId / createdAt / chainFingerprint / fingerprint / overall / runnerInjected /
  //   stages / blockedSummary / wiring / assembly）一字未动
  "strategyRun": {          // ← ARCH-002 的 StrategyRunSnapshot，原样保留
    "strategyRunSnapshot": { … },
    "strategyDecision": { … },
    "executionMetadata": { … }
  },
  "backtest": {             // ← 本轮（B-03）
    "canonicalMetrics": {
      "totalReturnPct": 4.0838…, "annualizedReturnPct": 19.736…, "maxDrawdownPct": 20.348…,
      "tradeCount": 3, "winRatePct": 100, "averageWinPct": …, "averageLossPct": "NOT_AVAILABLE",
      "profitFactor": "NOT_AVAILABLE", "completedTradeCount": 2, "openAtEndCount": 1,
      "annualizationBasis": { "type": "TRADING_DAYS", "daysPerYear": 252 }
    },
    "summary": { "initialCapital", "finalEquity", "totalReturnPct", "annualizedReturnPct",
                 "maxDrawdownPct", "tradeCount", "winRatePct", "profitFactor",
                 "averageWinPct", "averageLossPct", "openAtEndCount",
                 "equityPointCount": 57, "tradingDayCount": 57 },
    "equitySamples": [ … ≤60 条，均匀抽样、首尾必含 … ],
    "tradeSamples": [ … ≤60 条 … ],
    "truncated": { "equity": false, "trades": false },
    "equityDigest": "<sha256 全量曲线指纹>",
    "tradeDigest": "<sha256 全量台账指纹>",
    "notes": [ … ],
    "executionMetadata": {
      "executionPolicyVersion": 1, "engineVersion": "strategy-core/1.0.0",
      "codeVersion": "<调用方给出或 unknown>", "initialCapital": 100000,
      "sampleLimit": 60, "notes": [ … 政策全文 … ]
    }
  }
}
```

契约：`shared/researchContracts.ts` 新增 `backtestRunPayloadSchema`；`backtest` 为**可选**字段 ⇒ **历史留档不受影响**。`canonicalMetrics` 自述年化口径（规格 §2C）。

---

## 9. DB 新 Run 验证结果（只读核验）

| 项 | 实测 |
|---|---|
| 本次命名域（`%BT002CLOSE%`）留档行数 | **1**（`runId = clrun-20260919075448567`；`datasetSource = registry`） |
| 复核方式 | `BT002_VERIFY_ONLY=1` 只读复核（跳过 10 分钟计算，只读已落库的那一行）⇒ **20 项断言全绿 / `failures = 0`** |
| `resultJson.backtest` | 存在 |
| `resultJson.strategyRun` | 仍存在 |
| `backtest.executionMetadata.executionPolicyVersion` | `1` |
| `backtest.equityDigest` / `tradeDigest` | 均为 sha256（可逐字节比对重跑） |
| 落库 `backtest` 的键集合 | 恰为 `canonicalMetrics / equityDigest / equitySamples / executionMetadata / notes / summary / tradeDigest / tradeSamples / truncated`（9 项，无多余字段） |
| 落库 `backtest` 样本有界 | `equitySamples = 57` / `tradeSamples = 3`（≤ 60） |
| 落库 `annualizationBasis` | `{ type: "TRADING_DAYS", daysPerYear: 252 }` |
| 落库数值 vs 内存侧数值 | `totalReturnPct` / `annualizedReturnPct` / `maxDrawdownPct` / `tradeCount` / `winRatePct` / `profitFactor` **逐项相等**；`equityDigest`/`tradeDigest` 前缀与两次独立运行一致 |
| `resultJson` 整体体积 | **50,407 B**（其中 `backtest` 段 10,775 B；其余为既有的 `stages` 全量交接 + `strategyRun`） |
| `strategies` / `strategy_versions` 行数 | `10` / `11` ⇒ **未变** |
| 既有留档行数 | **6 ⇒ 6**（未增未减） |
| **历史 6 条含 `backtest` 段的行数** | **0** ⇒ 未被回填、未被重算（规格 §7） |

> `Historical Runs: policy version = implicit legacy/v0；No mutation performed`（历史 6 条无 `executionPolicyVersion`，符合规格 §5/§7 的"不回填"要求）。

---

## 10. zero-volume E2E 测试（R-04）

落在既有端到端夹具上（`tests/server/research/executionConstraints/executionConstraints.test.ts`，复用其 `buildDataset` / `runCandidates` / `runTradeSimulation`；仅给 `SeedSpec` 加 `volume?` 覆盖位）：

- **对照组**（执行日 `volume = 100,000`）：`totalFills = 1`、`rejectedOrders = 0` ⇒ 证明"零成交量政策是唯一的拒绝原因"。
- **实验组**（执行日 `volume = 0`）：`totalFills = 0`、`rejectedOrders = 1`、`byReason.NO_LIQUIDITY = 1`；拒单 `rejectionReason = "NO_LIQUIDITY"`、`filledQuantity = 0`、`explanation` 含 `zeroVolumePolicy=REJECT`；**无静默建仓**。
- **逐执行模型跑 `NEXT_OPEN` / `NEXT_CLOSE` / `VWAP_PROXY`** —— 改造前只有 `VWAP_PROXY` 会看 volume（`backtest/execution.ts` 要求 `volume>0` 才用 VWAP，否则回落 OHLC 均值），`NEXT_OPEN` / `NEXT_CLOSE` **完全不看** ⇒ 零成交日会按正常价成交。现由执行前的统一关卡兜住，三个模型一致。

> 实现细节：拒单原因沿用既有词表 `backtest/types.ts:51` 的 `NO_LIQUIDITY`（"无流动性（成交量为 0 / 无有效价格）"），**不新造原因码**；"因为 zeroVolumePolicy 拒的"这层信息由 `explanation` 如实带出（可解释、可检索）。

---

## 11. Regression 测试结果

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0 error** |
| `npx vitest run tests/server/backtest` | **9 文件 / 105 用例 / 0 failed** |
| `npx vitest run tests/server/strategyCore` | **10 文件 / 158 用例 / 0 failed** |
| `npx vitest run tests/server/research/executionConstraints` | **1 文件 / 27 用例 / 0 failed**（新增 zero-volume 1 条） |
| `npx vitest run`（全量） | **基线 8 失败文件 / 17 失败用例 ⇒ 逐项一致（`newFail = NONE`）**；用例总数 **4,304 → 4,538**（文件数 257 → 274） |
| `npx vite build` | 成功 |
| `node scripts/checkEolDrift.mjs` | **0 漂移**（过程中发现 1 处由并行会话引入的 CRLF 漂移，已按哨兵 `--fix` 归一化为 HEAD blob 的 LF，`git diff --numstat` 复核 = 仅本轮的 `+99/-1`） |

基线失败集合（未变，均与本任务无关）：`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `researchCore/candidates.updateBoundary` / `tushare.secret` / `tushareTradingCalendar`。

**判据更新 3 处（均随有意的产品行为变更，非放宽）**：
1. `backtestCore.test.ts`：`maxDrawdownPct` 负数 → **正数幅度**（口径纠正；同时新增逐点 `drawdownPct < 0` 的独立断言）。
2. `backtestPersistence.test.ts`：`canonicalMetrics()` 的键集合断言从"恰等于 8 项规格键"升级为更强的两条（8 项**必须为数值或 NOT_AVAILABLE** + 额外键**只能是登记过的元数据键**）。
3. `backtestCore.test.ts` 默认政策期望值：加 `zeroVolumePolicy`。

---

## 12. 历史 Run 未修改证明

- 历史 6 条 `closed_loop_backtest_run` 行数 **6 → 6**；含 `backtest` 段者 **0**（本轮未回填、未重算、未加 `executionPolicyVersion`）。
- `strategies` / `strategy_versions` 行数 **未变**。
- 全仓**零 migration / 零 `db:push` / 零 `drizzle-kit generate`**；**DB Schema 变更 = 0**。
- 唯一写库动作 = `loopRun` 正常路径产生**一条新 Run**（规格 §5.1 明确允许）。

---

## 13. 剩余问题

| # | 级别 | 问题 | 状态 / 建议 |
|---|---|---|---|
| **R-06** | 🟠 **中（观察级）** | **同一真实 Run 的耗时从 14.3s 变为 593.3s（≈41×）**（同窗口 `2025-01-02~2025-03-31`；14.3s 依据 = `docs/evidence/README.md` 的 `datasetwindow` 条目 2026-09-14 实测）。**已定位到的部分**：`StrategyRuntime.evaluate` 单次 ≈ **381 µs**（20,000 次实测，`_probe_core_eval_perf.mts`）× 真实调用量（每决策日 **2 次**：当日 + 截到昨天）≈ **52s**，只占观测耗时 **8.7%** ⇒ **主因不在 Core 求值层**。剩余 ~541s 落在数据集读取与逐日框架层，**未定位**。**另需注意**：缩短请求窗口（本轮的 1 个月版重跑）**并未显著缩短耗时**，说明瓶颈与请求窗口无关；且当天 `tushare*` 用例整片超时 ⇒ **环境（网络 / DB 链路）因素不可排除**。 | **不阻塞 BACKTEST-002 验收**（正确性与持久化均已验证），但**直接影响 PARAMETER-001 的可行性**（100 组参数 ≈ 16 小时）。建议 PARAMETER-001 开工前先做**一轮 profile**（把总耗时拆到 data / strategy / backtest / evaluation 四个阶段），再决定是否做批量化 / 缓存。 |
| R-07 | 🟡 低 | `positionSizing` 的 `RANK_WEIGHTED` **与等权同口径**（研究侧 `weight` 已是 `1/N`）⇒ **如实降级**，非实现。 | 已在 `mapPositionSizing().note` 与装配摘要里写明；未伪装成"真正排名加权"。 |
| R-08 | 🟡 低 | `averageLossPct` / `profitFactor` 在**全部为盈利笔**时为 `NOT_AVAILABLE`（规格要求不编 `Infinity`）⇒ 界面上会出现 `NOT_AVAILABLE`。 | 口径正确，属**有意**行为；前端若需展示"∞"应在展示层决定，不在指标层伪造。 |
| R-09 | 🟡 低 | `RISK_BASED` 仓位口径**未实现**（执行层响亮抛错）。 | 项目当前无该声明产出口，保持拒绝比静默按等权正确。 |
| R-10 | 🟢 信息 | 一次真实 Run 会因 `robustness` 等阶段未注入执行器而整体 `PARTIAL_BLOCKED`（首阻塞 `CL_RUNNER_NOT_INJECTED`）。 | 属闭环既有的"如实阻塞"语义，**不是**本任务缺陷；但若 Parameter Search 要按 `overall.status` 过滤，需知道 `PARTIAL_BLOCKED` 是常态。 |

> 已解决（本轮）：**R-01**（evaluation 消费 canonical + 年化基数决策）· **R-02/R-03**（`fixed-amount` schema）· **R-04**（zero-volume 端到端）· **R-05**（B-03 真库端到端）。

---

## 14. Final Readiness

| 项 | 判定 |
|---|---|
| **Backtest Core** | **READY** —— 执行政策 versioned 且集中；仓位口径真正参与预算；T+1 / 涨跌停 / 停牌 / 零成交量有明确政策与端到端测试；撮合确定性（同输入 ⇒ 同 payload 逐字节相同）。 |
| **Strategy → Backtest** | **READY** —— `StrategyRuntime.evaluate` 是唯一判定入口；文档声明 → 执行口径 → 订单数量 → 成交 → 持仓 → 权益 → 指标全链已通（真实 Run 实测）。 |
| **Backtest Run Persistence** | **READY** —— `BacktestRunResult` 有界落 `resultJson.backtest`，与 `strategyRun` 并列；真库只读核验通过；round-trip 逐字节无损；历史留档零改动。 |
| **Canonical Metrics** | **READY** —— 唯一实现 + 唯一年化口径（252，含算式形式）+ 口径自述；三条路径（Backtest / 载荷 / 闭环 evaluation）10 位小数逐位相等，真实 Run 逐项比对通过。 |
| **Parameter Search 前置条件** | ⚠️ **READY，但带一条必须处理的前提** —— 逻辑前置已满足（**改参数会真的改结果**，B-02 + R-02 双向证明）。但 **R-06 的单次 Run 耗时（≈10 分钟 / 实测 593s）会让搜索不可行**，开工前必须先做 profile 与批量化。 |

---

## 15. 最终结论

> **BACKTEST-002 = COMPLETE**

- **B-01 / B-02 / B-03 / B-04 / B-05 / R-02 全部 COMPLETE**；B-06 / B-07 / B-08 按规格 §23 DEFERRED（均为"代码整洁"类，不影响正确性）。
- 完成标准逐条对照：Execution Policy versioned ✅ · Position Sizing 真正影响订单 ✅ · **真实 Run → `resultJson.backtest`** ✅ · Canonical Metrics 唯一且 Evaluation 不再自算 ✅ · 年化口径明确且两侧一致 ✅ · `fixed-amount` 进 Schema ✅ · zero-volume 已执行 ✅ · **至少一条真实新 Run 完成 DB 落盘验证** ✅ · 同输入 ⇒ 同 Result ✅ · 改参数 ⇒ 结果真的变 ✅。
- **DB Schema 变更 = 0 · 新增 migration = 0 · 历史数据零修改。**

> **下一阶段：PARAMETER-001 — Parameter Search + Evaluation**
>
> 开工前请先处理 **R-06**：参数搜索会在同一执行路径上跑几百次，而当前单次 Run 实测约 10 分钟（瓶颈未定位，环境因素未排除）⇒ 建议先做一轮阶段级 profile，再决定批量化 / 缓存策略。

**不得再拆分 BACKTEST-003 / BACKTEST-004。**
