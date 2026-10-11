# RESULT-STRATEGY-BRIDGE-002 · Draft Variant 创建准备：R1 / R2 解除 + R3 可表达性核对

> 🔴 **NON-PLATFORM-FORMAL-RUN**（本轮**未跑正式 Backtest**）· **零数据库写入** · Dataset **`780004`** · HEAD **`f8b6810`**
> 目标（Goal round 1/256）：创建两个 Draft Strategy Variant → 解 R1 → 解 R2 → 小范围核对 R3 → 两 Variant 跑正式 Backtest
> **本轮状态**：**R1 ✅ 解除 · R2 ✅ 解除 · R3 🔄 部分解除（1 项缺口待裁定）· 正式 Backtest【未跑】**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  | 项 | 状态 | 证据 |                                                                                  │
│  |---|---|---|                                                                                      │
│  | **R1** `maxExposure`/`maxSinglePosition` 过校验 | ✅ **解除** | **2/2 Variant 经 `validateCanonicalStrategyDefinition` 实跑 ⇒ 0 issues** | │
│  | **R2** 平台 20bps ≡ 研究口径 | ✅ **解除** | **平台成本模型实算往返 = 20.000000 bps（精确）**，12/12 断言通过 | │
│  | **R3** rd55 → 顺延 → rd80 | 🔄 **部分** | **顺延 / 跌停不可卖【可表达】**；🔴 **rd80 强制结算【无对应机制】** | │
│  | Draft Variant 创建 | 🔄 **定义就绪** | 两份 canonical 定义已构造并通过校验；**尚未落库** | │
│  | 正式 Backtest ×2 | ⬜ **未开始** | 需先完成 R3 小范围核对 | │
│                                                                                                      │
│  **Goal 保持 active** —— 剩余：R3 小范围 Run 核对 + 两个 Variant 的正式 Backtest                            │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. 本轮交付物

| # | 文件 | 内容 |
|---|---|---|
| 1 | `scripts/_scratch/variantDefs.cjs` | **两个 Draft Variant 的 canonical 定义（唯一权威来源）** —— 除排名特征外逐字段相同 |
| 2 | `scripts/_scratch/variantValidate.cjs` | R1：实跑 `validateCanonicalStrategyDefinition` |
| 3 | `scripts/_scratch/variantCost.cjs` | R2：实算平台成本模型的往返 bps |
| 4 | 本报告 | — |

**未改动**：业务 `.ts`（本轮**零业务代码改动**）· DB / Schema / Migration / Dataset · 3570001 · 既有因子定义

---

## 2. R1 解除 · Draft Variant 定义 + 实跑校验

### 2.1 两个 Variant（**除排名特征外逐字段相同**）

| Variant | `featureId` | `rankingConfig` | 方向 |
|---|---|---|---|
| **`event-state-long-maxamp5-top3@1.0.0`** | **`maxAmp5`** | `{ higherIsBetter: false }` | 冻结 `dir = −1` |
| **`event-state-long-avgamp5-top3@1.0.0`** | **`avgAmp5`** | `{ higherIsBetter: false }` | 冻结 `dir = −1` |

**共同字段**（要点）

| 区块 | 值 |
|---|---|
| `datasets` | `first_limit_pullback` · `v10-listed365-pre10-post80` · **`datasetVersionId = 780004`** · `PRIMARY` |
| `entry.event` | `FIRST_LIMIT_UP` · `limitUpRatio 0.1` |
| `entry.observationWindow` | **`{ start: 15, end: 15, unit: "TRADING_DAY" }`** |
| `entry.trigger` | **`LAST_VALID_DAY`** |
| `entry.conditions` | `[]` |
| **`exit.rules`** | **单条 `TIME_EXIT`** · `trigger ON_CLOSE` · **`threshold 40` / `TRADING_DAY`** · `priority 0` · `enabled true` · 🔴 **无 `policy` 对象 ⇒ 无止损 / 无止盈 / 无 runner** |
| `position` | `sizingMethod EQUAL_WEIGHT` · **`maxPositions 180`** · **`maxExposure 1`** · **`maxSinglePosition 1/180** |
| `risk` | `maxPositions 180` · `maxExposure 1` · `maxSinglePosition 1/180` |
| `execution` | `signalTiming T_CLOSE` → `executionTiming T_PLUS_1_OPEN` · `priceType OPEN` · `quantityMethod TARGET_WEIGHT` · `lotSize 100` · `commissionModel/slippageModel BPS` · `executionConstraints ["OPEN_AT_LIMIT_UP_UNFILLED","SUSPENDED_NEXT_OPEN_UNFILLED"]` |
| `parameters` | `[]` |
| `recipe` | `signalEngine` · `point close` · `topN 3` · `featureVersions [{featureId, version:"1.0.0"}]` |

### 2.2 ✅ 实跑校验结果（**生产校验器**）

```
校验器来源 : <build>\research\strategySchema\index.js   （tsc 编译 server/research/strategySchema 为 CJS 后 require）
typeof fn  : function

--- event-state-long-maxamp5-top3@1.0.0 （排名特征 maxAmp5）---
  ok = undefined · issues = 0
  ✅ 0 issues —— R1 对该 Variant 解除
  position   : EQUAL_WEIGHT · maxPositions=180 · maxExposure=1 · maxSinglePosition=0.005555555555555556
  R1 断言    : maxExposure=1 ✅ · maxSinglePosition=1/180 ✅ · 180×(1/180)=1.0 ✅
  exit       : TIME_EXIT/ON_CLOSE/40 TRADING_DAY ⇒ policy 对象 ✅ 不存在（无止损路径）
  entry      : window {15,15} · trigger LAST_VALID_DAY · exit.rules 数 = 1

--- event-state-long-avgamp5-top3@1.0.0 （排名特征 avgAmp5）---
  ✅ 同上，0 issues

=== 结论 ===
  ✅ 2/2 个 Variant 均 0 issues ⇒ R1 解除
```

> ## ✅ **⇒ R1 解除：`maxExposure = 1` · `maxSinglePosition = 1/180 ≈ 0.005556` · `maxPositions = 180` 经生产校验器确认合法**
> ## 📌 **且 `exit.rules` 不含 `policy` 对象 ⇒ 未触发 `ExitPolicyDefinition.stop` 必填约束**（`STRATEGY-BRIDGE-001` §4 的规避策略**实测有效**）

---

## 3. R2 解除 · 平台 20bps ≡ 研究口径（**实算**）

### 3.1 声明与口径

| 项 | 值 |
|---|---|
| `commissionRate` | **2.5 bps / 边**（`0.00025`） |
| **`slippageBps`** | **7.5 bps / 边**（**施加于成交价**，由 `engine/execution.ts` 完成） |
| `stampDutyRate` / `transferFeeRate` / `minCommission` | **0 / 0 / 0** |
| `marketImpact` | **`enabled: false`**（研究口径无冲击成本） |
| `lotSize` | 100 |

### 3.2 ✅ 实算结果

```
--- 1) 声明合法性（生产校验器）---
  ✅ validateCostModelDeclaration ⇒ 0 issues

--- 2) 按平台成交价约定实算单边成本 ---
  buy  price=10.0075 gross=10007.500000 commission=2.501875 stampDuty=0 transferFee=0 slippage=7.500000 impactBps=0 ⇒ totalCostDrag=10.001875 = 10.001875 bps
  sell price=9.9925  gross=9992.500000  commission=2.498125 stampDuty=0 transferFee=0 slippage=-7.500000 impactBps=0 ⇒ totalCostDrag=9.998125  =  9.998125 bps

  单边 buy  = 10.001875 bps
  单边 sell =  9.998125 bps
  🔴 往返合计 = 20.000000 bps   （研究目标 20.000000）

--- 3) R2 断言（12/12 通过）---
  ✅ buy 单边 ≈ 10 bps · ✅ sell 单边 ≈ 10 bps
  ✅ 单边不对称 ≡ 2×c_bps×s_bps/1e4（精确）
  ✅ 往返合计 = 20 bps（**精确**）
  ✅ 市场冲击未启用 · ✅ 印花税 0 · ✅ slippage 符号正确 · ✅ 无最低佣金干扰

--- 4) 与研究的等价性 ---
  研究 net = 0.098000000000   （grossRet − 0.002）
  平台 net = 0.098000000000   （grossRet − 往返bps/1e4）
  ✅ 差 < 1e-12

--- 5) 代数验证 ---
  2 × (2.5 + 7.5) = 20.000000 bps   ✅ 实算往返 ≡ 2×(c_bps + s_bps)
```

> ## ✅ **⇒ R2 解除：平台实算往返 = `20.000000` bps，与研究口径 `gross − 0.002` 【数值等价（差 < 1e-12）】**
> ## 📌 **单边的 ±0.00375bps 不对称是【精确可解释】的**（佣金按**含滑点的 gross** 计 ⇒ `2×c_bps×s_bps/1e4`），**不影响往返合计**

### 3.3 对照：平台 A 股默认声明**不可直接使用**

| 声明 | 实算往返 |
|---|---|
| **本 Variant（研究口径）** | **20.0000 bps** |
| `A_SHARE_DEFAULT_COST_DECLARATION` | ≈ **35.9950 bps**（含印花税 5bp 卖出 + 过户费 + slippage 10bp×2 + 市场冲击） |

> 🔴 **保真度缺口（承接 `STRATEGY-BRIDGE-001` R2）**：研究 20bps 为**平坦成本假设**；本变体 `stampDutyRate = 0` ⇒ **未含 A 股印花税（卖出 0.05%）**。
> 📌 **处置**：**保持与研究口径一致**（不通过改成本参数制造更优结果）⇒ 若正式 Backtest 需真实成本口径，应**另立成本敏感性 Run**，而非改本 Variant 的成本。

---

## 4. R3 核对 · 可执行性语义的可表达性

### 4.1 🔴 结构性发现：数据集列 vs 引擎机制

| 层 | 事实 |
|---|---|
| **Dataset 层** | `ds_first_limit_pullback_post` **有** `canBuyAtOpen` / `canSellAtClose` 列（`datasetRegistry/executionFacts.ts`：`canSellAtClose = tradable && closeAtLimitDown !== true`）· `datasetRegistry/{db,query,types}.ts` 暴露 |
| **`research-experiments/**`** | **大量**消费这两列（约 30+ 个实验程序）—— **研究 harness 口径** |
| 🔴 **正式回测引擎** | `server/research/simulator/**` 与 `server/backtest/**` **完全不消费 `canSellAtClose`** ⇒ **语义需由【引擎自己的机制】重建** |

### 4.2 ✅ 引擎侧对应机制（`server/backtest/context.ts#BacktestExecutionPolicy`）

```ts
export interface BacktestExecutionPolicy {
  readonly tPlus1: boolean;                                  // T+1
  readonly blockLimitUpBuys: boolean;                        // 涨停不可买
  readonly blockLimitDownSells: boolean;                     // 🔴 跌停不可卖 ⇒ 对位 canSellAtClose
  readonly suspensionPolicy: "REJECT" | "DEFER";             // 🔴 停牌：拒单 | 顺延到下一可交易日
  readonly allowPartialFill: boolean;
  readonly zeroVolumePolicy: "REJECT" | "IGNORE";
}
export const DEFAULT_BACKTEST_EXECUTION_POLICY = Object.freeze({
  tPlus1: true, blockLimitUpBuys: true, blockLimitDownSells: true,
  suspensionPolicy: "REJECT",   // 🔴 默认【拒单不顺延】
  allowPartialFill: true, zeroVolumePolicy: "REJECT",
});
```

### 4.3 研究口径 → 引擎机制的逐项映射

| 研究口径 | 引擎机制 | 可表达？ | 备注 |
|---|---|:---:|---|
| **rd16 `open` 入场** | `executionTiming T_PLUS_1_OPEN` + `priceType OPEN` | ✅ | 已在校验通过的 Variant 中 |
| **rd55 `close` 出场（F40）** | `TIME_EXIT` `threshold 40` + `trigger ON_CLOSE` | ✅ | 已在校验通过的 Variant 中 |
| **`canSellAtClose = 1` 时成交** | `blockLimitDownSells: true`（跌停拒卖） | ✅ | **默认已为 true** |
| **不可卖 **⇒** 顺延** | **`suspensionPolicy: "DEFER"`** | ✅ | 🔴 **默认是 `REJECT`（拒单不顺延）⇒ 必须显式声明** |
| **停牌顺延** | 同上（`DEFER`）+ `backtest/engine.ts` 的 `SUSPENDED` 判定 | ✅ | `executionConstraints` 已含 `SUSPENDED_NEXT_OPEN_UNFILLED` |
| 🔴 **rd80 强制结算（fallback）** | 🔴 **未找到对应机制** | 🛑 **否** | 引擎在数据边界后**无「强制按边界价结算」概念** |

### 4.4 🔴 R3 的唯一缺口：rd80 兜底

| 事实 | 说明 |
|---|---|
| 研究 harness | 目标 rd55 不可卖 ⇒ 顺延；**至 rd80 仍不可卖 ⇒ 强制按 rd80 `close` 结算** |
| 数据集边界 | `postWindowDays = 80` ⇒ **rd80 是数据上限** |
| 引擎行为 | 持仓在 rd80 后**无 bar** ⇒ `SUSPENDED` ⇒ **按 `suspensionPolicy` 处理**（`DEFER` 会继续等待 ⇒ 无终点） |
| 🔴 缺口 | **「到达数据边界强制结算」在正式引擎中【无对应机制】** |

**研究证据中的量级**（来自 `RESULT-POST-EVENT-STATE-LONG-BOUND-001` 的 F60 出场闸门，可外推参考）：

| 项 | 值 |
|---|---|
| 在目标 rd 可卖 | **99.85%** |
| 顺延 | 531 |
| **rd80 兜底** | **12（0.021%）** |

> ## 📌 **⇒ rd80 兜底的【发生频率仅 0.021%】**（以 F60 的 rd75 口径测得；F40 的 rd55 口径应更低）
> ## ⚠️ **但【逐位等价】无法在当前引擎表达** ⇒ 需在 Backtest 设置阶段裁定：**(a)** 接受「引擎按 `DEFER` 处理，位置保持至数据边界」；**(b)** 由回测口径层显式补一条边界结算规则（**新增生产能力**）

---

## 5. 尚未完成（**Goal 保持 active**）

| # | 待办 | 说明 |
|---|---|---|
| **1** | **R3 小范围 / 单 Run 核对** | 用小范围（少量决策日）实跑一次，核对 `rd55 close → 不可卖顺延 → rd80 fallback` 的**实际行为**；并据 §4.4 裁定 rd80 口径 |
| **2** | **Draft Variant 落库**（如需要） | 两份定义已通过校验；**是否持久化**按平台既有路径决定 |
| **3** | **两个 Variant 各跑一次正式 Backtest** | 起止 **`2019-01-03 ~ 2025-09-26`** · 20bps 口径 · 不跑 OOS/WFA/参数/仓位/TopN 搜索 |
| **4** | **据结果决定是否进入 OOS/WFA** | 明确的分叉点 |

---

## 6. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | 🔴 两个 Variant 的**任何绩效**（**本轮未跑 Backtest**） |
| **N2** | 🔴 **rd80 兜底**在正式引擎中的**逐位等价**（§4.4；**当前无对应机制**） |
| **N3** | ⚠️ 数据集 `canSellAtClose` ↔ 引擎 `blockLimitDownSells` 的**逐事件等价性**（两者机制不同：前者由 dataset 计算，后者由前收盘价 + 板块幅度计算） |
| **N4** | ⚠️ `EQUAL_WEIGHT` + `maxPositions=180` 在**引擎实际装配**下是否逐笔等于研究的 `w = 1/180`（`backtest/context.ts` 声明口径为 `EQUAL_WEIGHT_CASH_BUDGET`，但**未实跑验证**） |
| **N5** | ❌ 研究 harness ↔ 平台 simulator 的逐笔等价性 |
| **N6** | ❌ 任何 OOS / WFA 结论 |
| **N7** | ❌ 冲击成本 / 容量 |
| **N8** | ❌ `(A) 年度切分口径缺陷`（+0.34%~+1.40%）尚未修复 |

---

## 7. 合规声明

✅ **未跑 Backtest / OOS / WFA** · ✅ **未创建 Candidate / Strategy Version** · ✅ **零数据库写入** · ✅ **零业务代码改动** · ✅ **未做权重 / 仓位 / TopN / 参数搜索** · ✅ **未修改 3570001** · ✅ **未修改既有因子定义 / Schema / Migration / Dataset** · ✅ 新增文件仅落在 `scripts/_scratch/`（gitignore）与 `docs/`

---

## 8. 下一步（**本轮结束后继续，Goal 保持 active**）

```text
1. R3 小范围单 Run：核对 rd55 → 顺延 → rd80 的实际行为，并裁定 rd80 口径
2. 两个 Variant 落库（按平台既有路径）
3. 两个 Variant 各跑正式 Backtest（2019-01-03 ~ 2025-09-26 · 20bps）
4. 据结果决定是否进入 OOS / WFA
```

**本轮在此停止。**