# BACKTEST-001 — Backtest Core 实施报告

> 执行模式：Phase A 映射 → Phase B 一次性实现 + 生产接线 → Phase C 测试 → Phase D 本报告。
> 纪律：禁 `db:push` / `drizzle-kit generate` / 新依赖 / 手改 `_journal.json`。

---

## 1. Executive Summary

**`BACKTEST-001 = NOT COMPLETE`（分项见下）。**

**为什么不是 COMPLETE（如实）**：Phase A 的结论改变了本任务的性质 ——
**Backtest Core 已经存在**，本轮的正当工作不是「新建一个 Core」，而是「补齐缺口 + 接线 +
把它讲清楚」。因此本轮的**实现**是完整且已验收的，但**规格 §29 的 A–L 全矩阵**与
**§30 Legacy 对比**只完成了纯函数可判定的那一半（B/F/G/I/J + A 的等价形式）；
C/D/E/H/L（T+1 / 涨跌停 / 仓位 / 持久化端到端）**由既有测试覆盖，本轮未新增对照**。

| 项 | 状态 |
|---|---|
| Phase A 全链映射 | ✅ 完成（12 问全答，带 `文件:行号`） |
| Phase B 缺口补齐 + 接线 | ✅ 完成（G1/G2/G3 + BacktestContext + OrderIntent + BacktestRunResult + §23 有界载荷） |
| Phase C 测试 | ⚠️ **部分**（新增 19 用例；C/D/E/H/L 依赖既有覆盖，未新增对照） |
| Phase D 报告 | ✅ 本文件 |
| §30 Legacy 对比 | ❌ **未做**（既有 `engineNonEquivalence.test.ts` 已固化「legacy 与 engine 不等价」，本轮未展开） |

---

## 2. Current Backtest Mapping（Phase A 结论）

**🔴 最重要的结论：`server/backtest/**` 就是事实上的 Backtest Core，禁止新建平行目录。**

证据：生产回测 `server/research/simulator/engine.ts:248 runTradeSimulation` **全量复用**
`server/backtest/` 的 `portfolio`（`portfolio.ts:60`）、`position`（`position.ts:33`，T+1 三态账本）、
`execution`（`execution.ts:104-175`，4 种执行模型 + 涨跌停拦截）、`cost`（`cost.ts:14-51`）、
`marketRules`（`marketRules.ts:12-48`）、`audit`（`audit.ts:15-42`）、`types`（`types.ts:28-499`）——
调用点见 `simulator/engine.ts:34,36-40,361,364,376,379,467-471,533-536,703`。

| 层 | 实现位置 | 判定 |
|---|---|---|
| 生产回测编排 | `research/simulator/engine.ts:248` (+ `plan.ts:130`) | **生产唯一** |
| 事件驱动引擎 `runBacktestEngine2` | `backtest/engine.ts:56` | **LEGACY / 生产不可达**（仅 `tests/server/backtest/backtest2.test.ts` 引用；`simulator/engine.ts:19` 注释自认「不复用其主循环」） |
| legacy 逐日模拟 | `realisticBacktest.ts:246 simulateRealisticTPlus1ToTPlus2` | **LEGACY**（由 `leaderCandidateStrategyBacktest` / `downsideRisk` / 前端消费，其解耦计划见 `engine/adapter.ts:4-16`） |
| 持仓 / 现金 / 权益 | `backtest/portfolio.ts:60`、`backtest/position.ts:33` | **EXISTS（唯一实现，两边共用）** |
| 撮合 / 涨跌停 / 停牌 | `backtest/execution.ts:54-64,78-89`、`simulator/engine.ts:448-465` | **EXISTS** |
| 成本（佣金/印花税/过户费/最低佣金/滑点） | `backtest/cost.ts:14-51` | **EXISTS**（六字段全实现） |
| 绩效指标 | `backtest/metrics.ts:56`；生产由闭环 `evaluation` 阶段算（`closedLoopWiring/executors.ts:516-569`） | **DUPLICATED（口径不同，未合并）** |
| `BacktestResult` | `types.ts:401`（legacy 引擎） | 与本轮新增的 `BacktestRunResult` **同域不同形**（已显式登记） |

**未新建 `server/backtestCore/**`** —— 新建只会制造第二套持仓/成本/撮合实现。

---

## 3. Architecture（本轮补齐后的实际形态）

```text
StrategyRuntime.evaluate  →  StrategyDecision            （STRATEGY-ARCH-001/002）
        ↓  deriveOrderIntents()                          ← 本轮新增（§7）
OrderIntent（OPEN_LONG / ADD_LONG / REDUCE_LONG / CLOSE_LONG）
        ↓  （意图 → 既有 Order/plan：simulator/plan.ts:130）
Order → Execution（backtest/execution.ts，含涨跌停/停牌/滑点）→ Fill
        ↓
Position（三态 T+1 账本）→ Portfolio（现金/市值/权益）
        ↓
EquityPoint[] + Trade[]
        ↓  buildBacktestResult() / analyzeEquityCurve() / computeTradeMetrics()   ← 本轮新增（§19/§20）
BacktestRunResult
        ↓  buildBacktestRunPayload()（摘要 + 有界样本 + 全量滚动指纹）              ← 本轮新增（§23）
Persisted Backtest Run（既有 resultJson，零 schema 变更）
```

**分层没有被打破**：新代码不判断任何策略条件（不读 RuleGraph、不看首板/回踩）；
`BacktestContext.policy` / `checkExecutionSemantics` 只做**声明与实现的一致性校验**。

---

## 4. Production Path

| 真实入口 | 本轮改动 |
|---|---|
| `researchRunRouter.loopRun`（`useRealData=true`）→ `assembleRunWorkbenchInputs` → `strategy13.signalBuilder`（Core）→ `runCandidateEngine` → `closedLoopWiring` backtest 阶段 → `runTradeSimulation` | ✅ **已接**：`assemble.ts` 现在**显式传** `executionRules` + `allowPartialFill` |
| 参数搜索 / 走查的同步评估器（`assembleStrategySide`） | ✅ 同一装配函数 ⇒ 同一政策 |

**G1 修复（本轮最重要的一条）**：
Phase A 实测 `assemble.ts:726-734` **不传** `executionRules` ⇒ 走 `marketRules.ts:30-33` 默认
`blockLimitUpBuys / blockLimitDownSells = false` ⇒ **生产回测默认按正常价成交涨停买/跌停卖**
（正是规格 §18 点名的缺陷形态）。现改为显式传**保守口径**
（`DEFAULT_BACKTEST_EXECUTION_POLICY`：T+1 强制、拦涨停买、拦跌停卖、停牌拒单不顺延、允许部分成交），
并把政策文本写进 `assembly.strategyDecisionEngineNote`（同一条 note 已落 Run Record 与前端摘要）。

---

## 5. Execution Semantics（实际采用的规则）

| 规则 | 实现 | 本轮动作 |
|---|---|---|
| 决策时点 | 恒 `close`（`simulator/engine.ts:272-278` 硬校验） | 新增 `checkExecutionSemantics()`：声明不在支持集内 ⇒ **装配层响亮抛错**（`LOOP_RUN_ASSEMBLY_EXECUTION_SEMANTICS_UNSUPPORTED`），不再静默按默认口径跑 |
| 执行时点 | `executionTime = nextDate`（`:662`，T+1 执行） | 支持集 = {`T_CLOSE→T_PLUS_1_OPEN@OPEN`, `T_CLOSE→T_PLUS_1_CLOSE@CLOSE`} |
| 成交价 | T+1 那根 bar：`NEXT_OPEN`→`open`（`execution.ts:107`）/ `NEXT_CLOSE`→`close`（`:116`）/ `VWAP_PROXY`→`amount*10/volume`（`:93-101`） | 未改 |
| **T+1** | ✅ 真实现：`position.ts:61-93` 三态账本（`available`/`frozen`）+ `portfolio.ts:204-213` 不足即拒 `T_PLUS_1` + `simulator/engine.ts:434` 每交易日 settle | 未改（既有测试已固化：`backtest2.test.ts:131-170`、`simulator.test.ts:384-452`） |
| 涨停买 / 跌停卖 | `execution.ts:54-64` 判定、`:82-89` 拦截（`LIMIT_UP` / `LIMIT_DOWN`） | **由默认关闭改为默认开启**（见 §4） |
| 停牌（执行日无行） | `simulator/engine.ts:448-465` 整单 `SUSPENDED` 拒绝、**不顺延** | 政策显式登记为 `REJECT` |
| 成交量为 0 | 无显式规则（仅 `VWAP_PROXY` 要求 `volume>0`，否则回落 OHLC 均值） | **未改**（见 §10 Known Issues） |

---

## 6. Persistence

| 内容 | 保存位置 |
|---|---|
| Backtest Run（一次执行） | `closed_loop_backtest_run` 一行（`runId` 唯一键，幂等 upsert）；**既有表** |
| `StrategyRunSnapshot` | `resultJson.strategyRun.strategyRunSnapshot`（STRATEGY-ARCH-002 已建） |
| `BacktestResult`（本轮对象） | `resultJson`（若调用方落）；**本轮未接进闭环留档**（见 §10） |
| Equity Curve / Trade Ledger | **全量**已在既有 `TradeSimulationRun`（`simulator/types.ts:182-236`）；本轮另提供**有界载荷** `buildBacktestRunPayload()`（摘要 + 均匀抽样 ≤60 + 全量 `equityDigest`/`tradeDigest`） |
| Backtest Config / 执行政策 | `resultJson.assembly`（含 `strategyDecisionEngineNote` 里的政策文本）+ `strategyRun.executionMetadata` |

**§23 规模审计（实测）**：`simulator/engine.ts:422,703,709` 对 `trades` / `equityCurve`
**无 cap / 无采样 / 无截断** ⇒ 一年 × 全市场可达 10^4~10^5 点、随 `resultJson`（longtext）落库。
本轮提供的载荷把「结论可比对（指纹）+ 明细可抽样（≤60）」与「全量是否入库」**解耦**，
调用方可自行决定；**是否把载荷接进闭环留档，留待下一阶段**（见 §10）。

---

## 7. Database Changes

```text
Migration: 0
Tables:    0
Columns:   0
DB Schema Change = 0
```

---

## 8. Existing Data Safety

本轮**未执行任何写库操作**（未起 dev server、未跑真实回测）。构造上守恒：

| 表 | 上一轮实测行数 | 本轮 |
|---|---|---|
| `strategies` | 10 | 未触碰 |
| `strategy_versions` | 11 | 未触碰 |
| `closed_loop_backtest_run` | 6 | 未触碰（历史留档不删改） |
| `dataset_version` | 2 | 未触碰 |

---

## 9. Tests

| 项 | 命令 | 结果 |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **0 error** |
| Backtest Core（新增） | `npx vitest run tests/server/backtest` | **5 文件 / 59 用例 / 0 failed**（新增 `backtestCore.test.ts` 19 用例） |
| §29 A（无交易） | 新增 | ✅ 期末权益 = 初始资金、交易数 0、胜率 `NOT_AVAILABLE` |
| §29 B（单买/卖） | **既有** `backtest2.test.ts`（PnL/佣金/滑点/权益） | ✅ 未重复 |
| §29 C（次日执行 / 无未来函数） | **既有** `backtest2.test.ts`、`simulator.test.ts` | ⚠️ 未新增对照 |
| §29 D（T+1） | **既有** `backtest2.test.ts:131-170`、`simulator.test.ts:384-452` | ⚠️ 未新增对照 |
| §29 E（仓位） | 新增**映射层**测试（G2）；**执行层未新增** | ⚠️ 部分 |
| §29 F/G（费用/滑点） | 新增 §20 交易指标（净 PnL 口径）+ 既有 `backtest2.test.ts` | ✅ 部分 |
| §29 H（涨跌停） | **既有** `backtest2.test.ts`、`simulator.test.ts`（拒绝/可配开关） | ⚠️ 未新增对照（但**默认值已翻转为开启**，属行为变更，见 §10） |
| §29 I（回撤） | 新增：`100→110→105→90→120` ⇒ `−18.18%` | ✅ |
| §29 J（确定性） | 新增：同输入两次 ⇒ 载荷 JSON 逐字节相同（含两个指纹） | ✅ |
| §29 K（Runtime 集成） | **既有**闭环端到端（`executionConstraints.test.ts:772-947` 真调 `runTradeSimulation`） | ⚠️ 未新增「Core 决策 → 成交」对照 |
| §29 L（持久化） | ARCH-002 已覆盖 `strategyRun` 往返；**`BacktestResult` 的往返未新增** | ⚠️ 部分 |
| Build | `npx vite build` | 成功 |
| 全量回归 | `npx vitest run` | 8 失败文件 / 17 用例（基线 8/17 ⇒ **失败集合逐项一致，零新增**）；用例 4304 → **4491** |
| 行尾 | `checkEolDrift` | 0 漂移 |
| §30 Legacy 对比 | — | ❌ **未做** |

---

## 10. Known Issues

| # | 级别 | 说明 |
|---|---|---|
| **B-01** | 🔴 **高（行为变更）** | **涨跌停拦截默认值翻转**：生产此前默认**不拦**（`executionRules` 未传），现默认**拦**。⇒ **历史回测数字不可直接对比**。这是规格 §18 明确要求的修复，但影响面大，必须让用户知情 |
| **B-02** | 🔴 高 | **`positionSizing` 仍未被「执行」**：本轮只做了**映射与如实登记**（`mapPositionSizing`），`positionRatio` / `fixedAmount` 在引擎里**仍无消费者**（实测生产成交预算 = 等权现金预算 ÷ 整手，`pipeline.ts:141` + `plan.ts:267-279`） |
| **B-03** | 🟠 中 | **`BacktestRunResult` / 有界载荷未接进闭环留档**：本轮只交付了纯函数与其测试；`resultJson` 仍只有 ARCH-002 的 `strategyRun` |
| **B-04** | 🟠 中 | **两套指标口径并存**：`backtest/metrics.ts:56` 与闭环 `evaluation` 阶段的 `performanceMetrics`/`riskAdjustedMetrics`/`tradeQualityMetrics` 计算同一批概念但**未合并**（Phase A 判定 DUPLICATED） |
| **B-05** | 🟠 中 | **成交量 = 0 无显式规则**：只有 `VWAP_PROXY` 要求 `volume>0`，其它执行模型不看量 ⇒ 0 成交量日可能按正常价成交 |
| **B-06** | 🟡 低 | **命名歧义**：`types.ts:401 BacktestResult`（legacy 引擎）vs 本轮 `BacktestRunResult`（Core 级）。已显式登记，未合并 |
| **B-07** | 🟡 低 | `runBacktestEngine2`（`engine.ts:56`）**生产不可达**但仍在仓内（仅测试引用）。按规格 §4 **未删除**，其中可迁移的部分（`portfolio`/`position`/`execution`/`cost`）**已被生产复用**，其余（事件驱动主循环）暂无迁移价值 |
| **B-08** | 🟡 低 | `suspensionPolicy: "DEFER"` 目前**未接**（既有引擎只有 `REJECT` 行为）；政策值域已登记，实现在下一阶段 |

---

## 11. Final Readiness

```text
Backtest Core:          READY（server/backtest/** 即 Core；本轮补齐 Context/政策/Intent/Result/有界载荷）
Strategy → Backtest:    READY（判定→意图→撮合→组合→结果的链已打通且可解释；政策已显式化）
Parameter Search:       READY（API 形态已满足 §26：run(strategyVersion, parameterSet, backtestConfig) 可直接循环调用）
```

**下一步是否可以进入 Parameter Search + Evaluation？**

**可以，但必须先决策两件事**：

1. **B-01 是行为变更**：涨跌停拦截由关转开，会让**同一策略的历史数字发生变化**。
   进入参数搜索前应确认这是期望行为（否则搜索出来的最优参数与历史不可比）。
2. **B-02 必须先补或必须先声明**：`positionSizing` 目前只被登记、不被执行 ——
   参数搜索若把 `positionRatio` 当搜索维度，会得到「维度变了、结果不变」的假结论。
   **建议下一阶段第一件事就是让 `mapPositionSizing` 从「登记」升级为「生效」**（或让装配层拒绝不可执行的仓位声明）。

---

## 附录 — 本轮改动文件

**新增**：`server/backtest/context.ts`（BacktestContext / ExecutionPolicy / OrderIntent）、
`server/backtest/backtestResult.ts`（BacktestRunResult / 指标 / §23 有界载荷）、
`tests/server/backtest/backtestCore.test.ts`（19 用例）。

**修改**：`server/backtest/index.ts`（显式点名导出，避免与 `types.ts` 同名歧义）、
`server/runWorkbenchAssembly/assemble.ts`（G1/G2/G3 接线 + 政策文本进摘要）。

**新增探针**：无（Phase A 全部通过代码 + 既有只读探针取证，未新增库探针）。
