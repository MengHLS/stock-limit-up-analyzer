# STEP 9 — Portfolio Architecture（组合架构）

> 交付：Portfolio Engine 架构与会计语义
> 位置：`server/portfolio/`

---

## 一、定位与边界

Portfolio Engine 是一套**与信号/订单/成交模型完全解耦**的组合会计基础，只回答一个问题：

> 「给定资金、持仓与成交，账户的现金、市值、权益、盈亏、费用、税、敞口是多少？」

它与 STEP 8（`server/engine/`）的关系：

```
STEP 8 Backtest Core（server/engine/）          STEP 9 Foundation（本层）
────────────────────────────────────            ───────────────────────────
Signal → Order → Fill → Position → Portfolio     Portfolio Engine（account.ts）
        （回测专用，强耦合 CostModel/execution）        ▲
                                                     │ 接口：PortfolioSnapshot
Risk Layer（server/risk/，预交易风控）             Risk Engine（server/riskEngine/）
```

**关键约束（规范 §十二）**：
- 本层**零 import** `server/engine/` 与 `server/risk/`。
- **不复制** STEP 8 的 `Portfolio` 类到本层（本层是独立的、可复用的会计引擎）。
- 与 STEP 8 通过**接口**（类型契约）连接：`OrderRequest` / `Fill` / `PortfolioSnapshot` 即连接面。

---

## 二、领域模型

### FeeSchedule（费用/税模型，独立于 STEP 8 CostModel）

| 字段 | 说明 |
| --- | --- |
| `commissionRate` | 佣金费率（双边） |
| `minCommission` | 最低佣金（元） |
| `stampDutyRate` | 印花税（仅卖出） |
| `transferFeeRate` | 过户费（双边） |
| `lotSize` | 最小交易单位（买入整手） |

### Fill（成交会计结果）

```
{ symbol, side, quantity, price, grossAmount, fees, tax, netCash, executedAt }
```

`fees` = 佣金 + 过户费；`tax` = 印花税（买入为 0）；`netCash` = 现金净变动（买负卖正）。

### PortfolioSnapshot（组合快照，Risk Engine 唯一输入）

```
{ date, cash, marketValue, equity, realizedPnL, unrealizedPnL, fees, tax, exposure, positions[] }
```

`PositionSnapshot` 含 `quantity / availableQuantity / averageCost / marketPrice / marketValue / unrealizedPnL / realizedPnL / sector?`。

---

## 三、会计模型（确定性）

### 金额口径（人民币元，round2 到分）

| 项 | 公式 |
| --- | --- |
| 佣金 | `max(minCommission, gross × commissionRate)` |
| 过户费 | `gross × transferFeeRate` |
| 印花税 | `gross × stampDutyRate`（仅卖出） |
| 买入费用 | 佣金 + 过户费 |
| 卖出费用 | 佣金 + 过户费 + 印花税 |
| 买入现金 | `−(gross + 买入费用)` |
| 卖出现金 | `gross − 卖出费用` |

### 成本基与盈亏（加权平均成本法）

```
买入：costBasis += gross + 买入费用；quantity += qty
卖出：costBasisRemoved = costBasis × (qty / quantity)
     realized = 卖出净所得 − costBasisRemoved
     costBasis -= costBasisRemoved；quantity -= qty
averageCost = costBasis / quantity        （round4 到 4 位）
unrealizedPnL = marketValue − costBasis
equity = cash + Σ marketValue
exposure = marketValue / equity
```

### T+1 预留

```
PositionState: quantity / availableQuantity / lockedQuantity / costBasis / realizedPnL
买入：quantity += qty; lockedQuantity += qty（availableQuantity 不变）
rollover(nextDate)：availableQuantity += lockedQuantity; lockedQuantity = 0
卖出：仅允许 quantity ≤ availableQuantity
```

---

## 四、Public API

```typescript
class PortfolioAccount {
  constructor(initialCash, options?: { feeSchedule?, currentDate? })
  get cash / fees / tax / openPositionCount / lotSize
  marketValue(): number
  equity(): number
  exposure(): number
  realizedPnL(): number
  unrealizedPnL(): number
  buy(order, price, date?): AccountingResult
  sell(order, price, date?): AccountingResult
  applyFill(fill): AccountingResult        // 桥接 STEP 8 成交复用
  markToMarket(prices): number
  snapshot(date, prices?): PortfolioSnapshot
  rollover(nextDate): void                 // T+1 结算
}
```

---

## 五、确定性保证

1. **纯函数会计**：`accounting.ts` 全部无副作用，无 `Date.now()` / `Math.random()` / 网络。
2. **固定舍入**：金额 `round2`（分）、成本比率 `round4`；股数整数。
3. **确定性排序**：`snapshot()` 持仓按 symbol 升序，Map 迭代统一走 `Array.from`。
4. **状态隔离**：每次回测 new 独立 `PortfolioAccount`，连续运行互不污染。

---

## 六、与 STEP 8 的边界契约

| 连接面 | STEP 8 侧 | 本层侧 | 映射 |
| --- | --- | --- | --- |
| 订单 | `Order`（含 signal/executionTime/orderType） | `OrderRequest`（symbol/side/quantity） | 抽取 symbol/side/quantity |
| 成交 | `Fill`（price/basePrice/fees 单一口径含印花税） | `Fill`（fees/tax 分离） | `applyFill` 适配 |
| 组合 | STEP 8 `Portfolio` 内部状态 | `PortfolioSnapshot` | `snapshot()` 导出 |

> **不复制**：本层不重写 STEP 8 的回测 Portfolio；STEP 8 保持其「回测专用」组合不变。若要 STEP 8 迁移到本层，需在 STEP 8 侧（或独立 adapter 文件）实现上述映射——属后续集成步骤，不在本步骤范围。
