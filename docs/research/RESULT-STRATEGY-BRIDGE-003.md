# RESULT-STRATEGY-BRIDGE-003 · 正式 Backtest 路径勘定 + R3 语义定位（**Goal round 2**）

> 🔴 **NON-PLATFORM-FORMAL-RUN** · **零数据库写入** · **零业务代码改动** · Dataset **`780004`** · HEAD **`f8b6810`**
> Goal round **2/256** · 承接 `RESULT-STRATEGY-BRIDGE-002`（R1 ✅ / R2 ✅ 已解除）

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **正式 Backtest 路径已完整勘定**（含唯一先例路径的精确签名）                                            │
│  🔴 **R3 语义已定位**：                                                        │
│     · 「不可卖顺延」在 simulator 中【**不是**显式 DEFER 机制】，而是靠                                │
│       **退出条件的每日重估**结构性实现 ⇒ **需要实测确认**                                              │
│     · `backtest/context.ts#BacktestExecutionPolicy.suspensionPolicy` **无任何消费者**（声明层字段）  │
│     · 「rd80 兜底」**无对应机制** ⇒ 持仓以 `exitTime = null` 收尾                                    │
│  ⬜ **正式 Backtest 仍未跑** —— 需要构造 `ResearchDataset` + `CandidateEvaluationRun`                │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. FACT · 正式 Backtest 路径勘定

### 1.1 全链路（`closed_loop_backtest_run` 的写入路径）

```
策略 + 时间窗
   ↓  server/runWorkbenchAssembly/assemble.ts#assembleRunWorkbenchInputs  (async)
   ↓     └─ 可传入 `researchDataset`（**调用方自备**）⇒ 不必从 DB 拉全量
ClosedLoopWiringInputs
   ↓  server/research/closedLoop/orchestrator.ts#runClosedLoop
四阶段（data / research / backtest / evaluation）
   ↓
closed_loop_backtest_run 持久化（当前库内 463 行）
```

### 1.2 🔴 唯一先例路径（逐字签名）

`server/research/compositeRunner/index.ts#runCompositeRunnerBacktest`

```ts
export interface RunCompositeRunnerBacktestInput {
  dataset: ResearchDataset;                 // ← 调用方自备（可内存构造）
  sourceRun: CandidateEvaluationRun;        // ← 需指纹自洽
  strategyDocument: StrategyDocument;       // ← 🔴 我们的 Variant
  dateRange: { startDate: string; endDate: string };
  datasetVersionId: number;
  codeVersion: string;
  createdAt: string;
  name: string;
  runnerBridge?: RunnerHoldingBridgePolicyDefinition | null;
}
export async function runCompositeRunnerBacktest(input): Promise<{ run: TradeSimulationRun; simulationConfig: SimulationConfig }>
```

内部：`assembleRunWorkbenchInputs({ ..., strategyDocument, datasetVersionId, researchDataset: input.dataset })` → `runTradeSimulation`

**先例**：`research-experiments/first-board-pullback/composite-runner-newhigh3-hold20/experiment.ts` —— 产出 `Strategy Version 3570001` 的评估证据（`5970001` / `5970002`）

### 1.3 🔴 `runTradeSimulation` 的硬前置

`server/research/simulator/engine.ts#runTradeSimulation({ dataset, sourceRun, simConfig })`

| 前置 | 校验 | 位置 |
|---|---|---|
| `assertValidSimulationConfig(simConfig)` | FAIL FAST | L358 |
| `assertValidCandidateEvaluationRun(sourceRun)` | — | L363 |
| `sourceRun.recordKind === "CANDIDATE_EVALUATION_RUN"` | 否则 `SOURCE_KIND_INVALID` | L364-368 |
| `sourceRun.fingerprint === computeCandidateEvaluationRunFingerprint(sourceRun)` | 否则 `SOURCE_FINGERPRINT_MISMATCH` | L370-375 |

**`cursorEngine.ts#runTradeSimulationFromCursor` 同要求 `sourceRun: CandidateEvaluationRun`**

### 1.4 🔴 `runBacktestEngine2`（STEP 8）**不适合**本策略

| 事实 | 影响 |
|---|---|
| `BacktestSpec.executionModel: ExecutionModelId \| ExecutionModel` —— **单一全局执行模型** | 无法在同一次运行中表达「**入场 rd16 `open`**」+「**出场 rd55 `close`**」两种时点 |
| `ExecutionRuleSet` 仅 `{ blockLimitUpBuy, blockLimitDownSell }` | 无退出策略层（无 `TIME_EXIT`） |
| `SignalGenerator(date, portfolio, data)` | 可表达 rd15 决策 + rd16 open 入场（`NEXT_OPEN`），但出场会落到 **rd56 open 而非 rd55 close** |

> ## 🎯 **⇒ 正式回测必须走 `research/simulator`（`runTradeSimulation`）** —— 它是**唯一**带退出策略层（`exitPolicy.timeExit`）的引擎

---

## 2. FACT · R3 语义定位（`rd55 close → 不可卖顺延 → rd80 fallback`）

### 2.1 🔴 `suspensionPolicy` 是**声明层字段，无任何消费者**

全 `server/**` 检索 `"DEFER"|suspensionPolicy` ⇒ **仅 5 处命中，全部在 `server/backtest/context.ts` 内**：

| 位置 | 内容 |
|---|---|
| L45 | 文件头注释（描述默认政策） |
| L76 | 接口声明 `readonly suspensionPolicy: "REJECT" \| "DEFER";` |
| L100 | `DEFAULT_BACKTEST_EXECUTION_POLICY` 取值 `"REJECT"` |
| L109 | 字段名清单 |
| L144 | `describeBacktestExecutionPolicy` 描述串 |

> ## 🔴 **⇒ 不存在读取 `suspensionPolicy` 的执行代码** ⇒ **不能用它来论证「顺延」已实现**

### 2.2 🔴 simulator 的**单笔挂单不重试**

`server/research/simulator/engine.ts`

```ts
L725 : const due = pending.filter(entry => entry.executionTime === date);
L726 : pending = pending.filter(entry => entry.executionTime !== date);   // 🔴 该日到期的挂单【被移出 pending】
L732 : const bar = dayBars.get(entry.securityId);
L733 : if (!bar) {
L734 :   // 停牌：当日非 universe 成员 → 无行 → 无成交（显式拒绝，不静默顺延）。
L735 :   stats.rejectedOrders += 1;
L736 :   stats.byReason.SUSPENDED = (stats.byReason.SUSPENDED ?? 0) + 1;
L744 :   status: "REJECTED",
L745 :   rejectionReason: "SUSPENDED",
L754 :   continue;                                                          // 🔴 不重新入队
```

> ## 🔴 **⇒ 单笔卖单在「不可卖」当日被【终止】（REJECTED 后 `continue`，不重试）**

### 2.3 🔴 那「顺延」从何而来？—— **退出条件的每日重估**

`engine.ts` L548-563 的「跨日保留」是**退出【原因】的保留**（避免后续成交覆盖 `Trade.reason`），**不是订单重试**：

```
L551 : 止损卖单可能因开盘跌停/停牌被拒；该状态必须跨日保留，直到真正清仓。
L557 : 盈利回撤止盈触发后，卖单可能同样因跌停/停牌被拒；触发状态跨日保留，…
```

> ## 📌 **推断（待实测）：`TIME_EXIT(holdingDays = 40)` 的退出条件在 rd55 之后【每天恒为真】**
> ## **⇒ rd55 被拒后，rd56 会重新生成一个新的卖单 ⇒ 结构性等价于「顺延」**
> ## 🔴 **但这是【推断，尚未实测】** —— 本轮**未运行**任何 simulator

### 2.4 🔴 `rd80 兜底`（到数据边界强制结算）—— **无对应机制**

| 层 | 行为 |
|---|---|
| 研究 harness | 至 rd80 仍不可卖 ⇒ **强制按 rd80 `close` 结算** |
| 平台 simulator | 研究口径的「边界强制结算」**无对应 API** |
| 自然结果 | 持仓在数据边界后无 bar ⇒ 每期 `SUSPENDED` 拒绝 ⇒ **回测期末仍持仓**（`Trade.exitTime = null`） |
| 📌 量级 | 该情形**发生频率 0.021%**（`LONG-BOUND-001` F60 闸门：rd75 可卖 99.85% · 顺延 531 · **rd80 兜底 12**） |

---

## 3. 本轮**未完成**（Goal 保持 active）

| # | 待办 | 阻塞点 |
|---|---|---|
| **1** | **R3 小范围实测**（rd55 被拒 → rd56 是否重新发单） | 需构造 `ResearchDataset` + `CandidateEvaluationRun` 才能调用 `runTradeSimulation` |
| **2** | **构造两个 Variant 的 `CandidateEvaluationRun`** | 需 `ResearchDataset`（由 780004 派生）+ 指纹自洽 |
| **3** | **两个 Variant 各跑正式 Backtest** | 依赖 #1 / #2 |
| **4** | **据结果决定是否进入 OOS/WFA** | 依赖 #3 |

**可选的推进路线（下一轮评估）**

| 路线 | 内容 | 代价 |
|---|---|---|
| **A（推荐）** | 新建一个 `research-experiments/first-board-pullback/event-state-long-*` 实验，复用 `composite-runner-newhigh3-hold20` 的装配范式（`dataset` + `sourceRun` + `strategyDocument`）跑两个 Variant | 需新增实验文件（`research-experiments/**`） |
| **B** | 直接以脚本驱动 `runCompositeRunnerBacktest`（`tsc` 编译 → CJS → require） | 仍需自备 `ResearchDataset`；且 `assembleRunWorkbenchInputs` 未导出到稳定 CJS 边界，风险高 |
| **C** | 先只做 R3 的**最小实测**：用 `InMemoryBarStore` + 合成少量 bar 驱动 simulator 的退出重估路径 | 仍需 `CandidateEvaluationRun`；但数据集可极小 ⇒ **代价最低** |

---

## 4. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | 🔴 **「rd55 被拒 ⇒ rd56 重新发单」** —— §2.3 为**推断**，**本轮未实测** |
| **N2** | 🔴 **rd80 兜底**的等价性（平台无对应机制） |
| **N3** | 🔴 两个 Variant 的**任何绩效**（**未跑**） |
| **N4** | ⚠️ 数据集 `canSellAtClose` ↔ simulator 涨跌停/停牌判定的**逐事件等价性**（机制不同） |
| **N5** | ⚠️ `EQUAL_WEIGHT` + `maxPositions=180` 是否逐笔等于研究 `w = 1/180` |
| **N6** | ❌ 研究 harness ↔ 平台 simulator 的逐笔等价性 |
| **N7** | ❌ OOS / WFA / 冲击成本 / `(A) 年度口径缺陷` |

---

## 5. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入** · ✅ **未跑 Backtest / OOS / WFA** · ✅ **未创建 Candidate / Strategy Version** · ✅ **未做权重/仓位/TopN/参数搜索** · ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ 本轮**无新增文件**（仅只读检索）

---

## 6. 下一步（**Goal 保持 active**）

```text
1. 评估路线 A / B / C，选定正式 Backtest 的落地方式（推荐 C 先做 R3 最小实测，再走 A）
2. R3 最小实测：确认「退出条件每日重估 ⇒ 结构性顺延」
3. 两个 Variant 跑正式 Backtest（2019-01-03 ~ 2025-09-26 · 20bps）
4. 据结果决定是否进入 OOS / WFA
```

**本轮在此停止，Goal 继续。**