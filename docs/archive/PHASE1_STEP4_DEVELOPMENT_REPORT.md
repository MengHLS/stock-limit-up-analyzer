# Step 4 开发完成报告

## Risk & Position Sizing —— 风险控制与仓位管理层

在 Step 1（统计基础层）、Step 2（Backtest Core）、Step 3（Strategy Contract）之上，
建立统一 **Risk Management Layer** 与 **Position Sizing Layer**。

最终架构：

```
Strategy → Signal / Intent
        → PositionSizer（建议做多少）
        → RiskManager（允许不允许、允许多少）
        → Approved Order Intent
        → Backtest Core（Execution + Portfolio 最终如何成交）
```

四层职责分离：

| 层 | 职责 |
|---|---|
| Strategy | 决定「我想做什么」→ Signal / Intent |
| PositionSizer | 决定「建议做多少」→ proposed quantity |
| RiskPolicy / RiskManager | 决定「允许不允许、允许多少」→ RiskDecision |
| Backtest Core | 决定「最终如何成交」→ Fill / Position |

---

## 1. Risk Policy Contract

新增 `server/risk/contract.ts`，核心类型：

- `OrderIntent`：交易意图（symbol / side / requestedQuantity / signalTime / score / reason）。
- `RiskDecisionKind`：`APPROVE` | `RESIZE` | `REJECT`。
- `RiskViolation`：结构化违规记录（code / message / policy）。
- `RiskDecision`：可解释、可追踪决策（kind / approvedQuantity / requestedQuantity / violations）。
- `RiskPolicy`：纯函数接口 `check(intent, context): RiskDecision`。
- `RiskManager`：组合器接口。
- `PositionSizer`：仓位模型接口 `propose(intent, context): number`。
- `RiskDecisionTrace`：决策追踪记录（requested → proposed → approved + violations）。

## 2. Risk Context

`server/risk/context.ts` 提供 `buildRiskContext`（纯函数），从只读快照派生 `RiskContext`：

- timestamp / equity / cash / availableCash
- positions（只读 RiskPosition[]）/ openPositionCount
- marketPrice / portfolioExposure / symbolExposure
- referenceAmount（信号日成交额，T+1 开盘前已知，防未来函数）
- cost（CostModel）

Risk Layer 自身不访问数据库 / 网络 / Portfolio 可变 API。

## 3. Risk Decision

- `APPROVE`：所有 Policy 通过，数量不变。
- `RESIZE`：存在限制，最终数量 = min(requested, 所有 RESIZE 上限)，向下取整到整手。
- `REJECT`：任一 Policy 拒绝，数量归 0，合并所有违规记录。

## 4. Risk Manager

`server/risk/manager.ts` 的 `composeRiskManager(policies)`：

- 组合多个 Policy 为唯一 Risk Decision Pipeline。
- REJECT 短路（后续 Policy 不再执行）。
- RESIZE 取所有限制的严格最小值，不足一手 → `INSUFFICIENT_LOT` 拒绝。
- 保证「某个 Policy 通过后，另一个 Policy 不会被绕过」。

## 5. Position Sizer

`server/risk/sizing.ts` 实现 4 种仓位模型：

1. **FixedQuantitySizer**：固定 N 股（不做整手修正，非整手交给 LotSizePolicy 拒绝）。
2. **FixedCapitalSizer**：固定资金比例（equity × ratio / price）。
3. **FixedWeightSizer**：固定目标权重（equity × weight / price）。
4. **RiskCappedSizer**：风险封顶（riskBudget / perShareRisk），单笔最大风险金额 ≤ 权益固定比例。

全部向下取整到整手；缺价格返回 0 由 RiskManager 兜底裁决。

## 6. maxPositions 迁移

新增 `MaxPositionsPolicy`（`server/risk/policies.ts`）：

- 开仓数达上限时新 BUY → `REJECT MAX_POSITIONS_EXCEEDED`。
- 已有同 symbol 持仓视为加仓，不新增开仓数。
- 对应 Step 2 的 `maxPositions` 硬约束语义，作为可解释 Policy 表达。

**迁移方式**：`runBacktest` 新增可选 `risk` 参数（`sizer?` + `manager`），
传入后 engine 用 RiskManager 裁决后再成交。**缺省不传时走 Portfolio 会计兜底，行为与 Step 2 完全一致**（Step 2 45 测试回归全绿）。

## 7. maxPositionAmountRatio 迁移

新增 `MaxPositionExposurePolicy`：

- 单笔买入金额 ≤ 参考成交额 × ratio（amount 单位千元 → 元）。
- 超容量 → RESIZE 到容量上限（向下取整整手）；不足一手 → `REJECT CAPACITY_INSUFFICIENT`。
- 参考成交额取信号日（signalTime），成交日开盘前已知，无未来函数。
- ratio=0 表示不限。

## 8. lotSize 迁移

新增 `LotSizePolicy`：

- 买入非整手 → `REJECT INVALID_LOT_SIZE`（合法性校验，非自动修正）。
- 卖出允许非整手（清仓按持仓全额）。

## 9. Cash Constraint

新增 `CashPolicy`：

- 订单总成本（price×quantity + 滑点 + 佣金 + 过户费）≤ availableCash。
- 用含滑点买入价估算，保证「cash >= requiredCash」而非只查 price×quantity。
- 不足 → RESIZE 到可负担最大整手；不足一手 → `REJECT INSUFFICIENT_CASH`。

## 10. Portfolio Exposure

新增 `MaxPortfolioExposurePolicy`：

- 组合总持仓市值 ≤ equity × ratio。
- 超出 → RESIZE；剩余不足以增持一手 → REJECT。

## 11. Symbol Exposure

新增 `MaxSymbolExposurePolicy`：

- 单一标的持仓市值 ≤ equity × ratio。
- 超出 → RESIZE / REJECT。

## 12. Risk Decision Trace

- `RiskDecisionTrace` 记录每笔 BUY 的 requested → proposed → approved 及全部 violations。
- `runBacktest` 传入 `risk` 管道时，结果挂 `riskDecisions` 字段。
- 回测报告可回答「为什么这笔交易最终只有 N 股」。

## 13. Future Leakage 防护

- 所有 Policy 只读显式传入的 RiskContext，无 Date.now / Math.random / 网络 / DB。
- 容量约束用信号日成交额（referenceAmount），成交日开盘前已知。
- 集成测试验证：T+1 成交日 amount 变化不影响风险决策结果。
- 确定性：相同输入两次检查深度相等；Policy 无 module-level mutable state。

---

## 14. 测试

新增 `server/risk/risk.test.ts`，**35 个测试全绿**：

- Risk Policy（11）：maxPositions 拒绝/加仓豁免、maxPositionExposure RESIZE/REJECT/不限、maxPortfolioExposure RESIZE/REJECT、insufficientCash RESIZE/REJECT、lotSize 拒绝/通过。
- Position Sizing（6）：fixed quantity / fixed capital / fixed weight / risk capped / 向下取整 / 缺价格返回 0。
- Decision（5）：全部 APPROVE、任一 REJECT、多个 RESIZE 取 min、RESIZE 后不足一手、REJECT 短路。
- Safety（3）：确定性、未来函数防护、实例隔离。
- Golden Test（3）：完整 Signal → Sizer → RiskManager → Approved Order Intent（人工计算 4000 股 / 400 股 / 非整手拒绝）。
- buildRiskContext（2）：敞口计算、equity≤0 兜底。
- RiskManager + Backtest Core 集成（5）：APPROVE 成交、RESIZE 成交、REJECT 不成交、未来数据污染、确定性。

---

## 新增 / 修改 / 删除文件

**新增文件**：
- `server/risk/contract.ts` — 风险契约核心类型。
- `server/risk/context.ts` — RiskContext 派生。
- `server/risk/sizing.ts` — 4 种仓位模型。
- `server/risk/policies.ts` — 6 个 Risk Policy。
- `server/risk/manager.ts` — RiskManager 组合器。
- `server/risk/index.ts` — 统一入口。
- `server/risk/risk.test.ts` — 35 测试。

**修改文件**：
- `server/engine/engine.ts` — `RunBacktestInput` 新增可选 `risk` 参数；`runBacktest` 接入风险决策管道并记录 `riskDecisions`。
- `server/engine/portfolio.ts` — 新增无副作用 `equityAt(prices)` 方法（供 RiskContext 估值）。

**删除文件**：无。

---

## Legacy 风险逻辑

**已迁移**（在 Risk Layer 中有等价 Policy，engine 可选接入）：
- maxPositions → MaxPositionsPolicy
- maxPositionAmountRatio → MaxPositionExposurePolicy
- lotSize → LotSizePolicy
- cash 约束 → CashPolicy

**未迁移（保留在 Portfolio 会计兜底，职责不同）**：
- `Portfolio.buy()` 内部的约束校验（lotSize / 去重 / maxPositions / 容量 / 资金）仍保留，
  作为「会计不变量」最终权威。Risk Layer 是前置「策略性风险决策」（可解释、可追踪），
  Portfolio 是「会计性兜底」（防任何路径绕过风险层直接产生非法状态）。两者职责不重叠。

**尚未实现（属后续高级风险系统，本 Step 不做）**：
- Kelly / VaR / CVaR / Monte Carlo Risk / Factor Risk Model / Correlation Matrix / Portfolio Optimization / ML Position Sizing / 实盘风控。

---

## 工程验证

- **npm test**：429 通过 + 15 失败（全部为既有环境类：缺 DATABASE_URL / TUSHARE_TOKEN / 网络超时 / StockPriceSync.tsx，与 Step 1/2/3 清单**完全一致，无新增失败**）。
- **npm run typecheck**：✅ exit 0。
- **npm run build**：✅（dist/index.js 408.2kb）。

**Step 2 行为回归**：engine 层 45 测试（engine.test 29 + engine.fix 16）全绿，确认 maxPositions / maxPositionAmountRatio / lotSize 迁移未破坏既有行为。

---

Step 4 是否 PASS 留给下一阶段独立审计。
