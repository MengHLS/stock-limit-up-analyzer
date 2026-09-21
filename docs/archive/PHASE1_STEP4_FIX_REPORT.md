# Step 4-FIX 修复报告
## Risk & Position Sizing —— P1-F1 / P2-F2 / P2-F3 修复

修复依据：`docs/PHASE1_STEP4_AUDIT_REPORT.md`（独立验收 FAIL，1 项 P1 + 2 项 P2 + 2 项 P3）。
本次修复 P1-F1（阻塞）与 P2-F2、P2-F3。P3-F4（命名错位）、P3-F5（同 symbol 加仓语义）为非阻塞，不在本次范围。

---

## 1. P1-F1（阻塞）— 敞口估值价格口径不一致

**问题**：`runBacktest` 派生 `RiskContext` 时，`equity` 用决策时点（T+1 开盘价）估值，但 `positions[].marketValue` 用上一收盘价（`snapshotPositions()` 的 `marketPrice ?? entryPrice`），两者口径不一致 → `MaxPortfolioExposure` / `MaxSymbolExposure` 低估已有持仓，可突破上限。

**修复**：
- `server/engine/portfolio.ts`：新增 `snapshotPositionsAt(prices)`，按给定价格估值（价格缺失回退最近收盘价/建仓价）；`snapshotPositions()` 改为 `snapshotPositionsAt(new Map())`；`equityAt(prices)` 改为复用 `snapshotPositionsAt(prices)`，使 equity 与持仓市值**共用同一估值口径**（单一事实来源）。
- `server/engine/engine.ts`：派生 `RiskContext` 时 `positions` 由 `snapshotPositions()` 改为 `snapshotPositionsAt(openPrices)`，与 `equityAt(openPrices)` 同源。

**验证**：`risk.fix.test.ts` 两条 —— ① S 持仓 T3 开盘涨至 30，X 被 RESIZE 到 2300 股（修复前 2400），且期末组合敞口 ≤ 50%；② `snapshotPositionsAt` 与 `equityAt` 同源恒等。

---

## 2. P2-F2 — CashPolicy 滑点口径与执行层不一致

**问题**：`CashPolicy` 用 base 滑点 `slippedBuyPrice`，执行层用 `amountAdjustedSlippageBps`（流动性分层，<1 亿 +20bp 等），边界场景风险决策数量可能高于实际成交数量（Portfolio 静默二次截断）。

**修复**：
- `server/engine/execution.ts`：新增 `slippedBuyPriceAdjusted(price, cost, referenceAmount)`，用 `amountAdjustedSlippageBps` + `round` 到 4 位；`NextOpenExecutionModel.execute` 买入分支改复用它（消除内联重复）。
- `server/risk/policies.ts`：`CashPolicy` 改用 `slippedBuyPriceAdjusted(price, context.cost, context.referenceAmount)`，与执行层滑点口径完全一致。

**验证**：`risk.fix.test.ts` 两条 —— ① `slippedBuyPriceAdjusted(10, COST, 500) === 10.03` vs `slippedBuyPrice(10, COST) === 10.01`；② cash=10020 时 CashPolicy 由「修复前 APPROVE 1000」变为「修复后 RESIZE 900」（不再高估）。

---

## 3. P2-F3 — 风险层可选 / Strategy 未接入引擎

**问题**：`runBacktest` 的 `risk` 可选，不传时绕过 RiskManager；Strategy 层未接入引擎（需手动 `toCoreSignals` + 手动传 risk）。

**修复**（三层）：
- `server/engine/domain.ts`：新增 `ReadonlyPortfolioSnapshot`（只读组合快照，cash/equity/openPositionCount/openPositionSymbols）。
- `server/risk/manager.ts`：新增 `buildDefaultRiskManager(config)`，从 `BacktestConfig` 对齐构建 `[LotSize, MaxPositions, MaxPositionExposure(容量), Cash]`。
- `server/engine/engine.ts`：
  - `signalProvider` 签名扩展为 `(date, portfolio: ReadonlyPortfolioSnapshot) => Signal[]`，step 2 收盘后传入当日收盘估值快照（TS 参数逆变，Step 2 旧测试的 `(d) => [...]` 完全兼容）。
  - 新增统一入口 `runBacktestWithRisk`，缺省注入 `buildDefaultRiskManager(config)`，确保「Strategy → PositionSizer → RiskManager → Approved Order Intent」链路必然成立。
- `server/strategy/adapter.ts`：新增 `buildStrategySignalProvider(strategyId, buildDataView, options)`，固化「registry.evaluate → toCoreSignals → signalProvider」桥接。

**验证**：`risk.fix.test.ts` 4 条（buildDefaultRiskManager 的 maxPositions/容量对齐、runBacktestWithRisk 默认注入产生 riskDecisions、缺省 manager 执行资金约束）+ `leaderCandidateBaseline.test.ts` 1 条（buildStrategySignalProvider + runBacktestWithRisk 完整驱动 Strategy→Risk→Core 成交）。

---

## 回归测试

- 新增 `server/risk/risk.fix.test.ts`（9 条）。
- 扩展 `server/strategy/leaderCandidateBaseline.test.ts`（+1 条，11 条）。

---

## 工程验证

| 项 | 结果 |
|---|---|
| typecheck | ✅ exit 0 |
| build | ✅ exit 0 |
| 核心测试（risk/engine/strategy） | ✅ 全绿 |
| 全量测试 | ✅ 439 passed / 15 failed（15 均为既有环境类：缺 TUSHARE_TOKEN、交易日历网络超时、缺 StockPriceSync.tsx 等，与 Step1/2/3 清单完全一致，**无新增失败**） |

---

## 未修复（非阻塞 P3，供后续）

- P3-F4：`MaxPositionExposurePolicy` 命名错位（实为容量约束，violation code 应为 `CAPACITY_EXCEEDED`）。
- P3-F5：`MaxPositionsPolicy` 对同 symbol 加仓 APPROVE，Portfolio 拒绝加仓，两层语义不一致。

---

## 结论

P1-F1（阻塞）与 P2-F2、P2-F3 已修复，回归测试覆盖且全量测试无新增失败、typecheck/build 通过。**READY FOR RE-AUDIT**。
