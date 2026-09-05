# Step 2 最终验收报告（独立审计员 · 第三轮完整复核）

> 审计身份：独立代码审计员 + 量化回测系统验收工程师。
> 审计对象：`server/engine/` Backtest Core 当前状态（含 Step 2-FIX 与 Step 2-FIX21 之后的全部改动）。
> 审计原则：不采信任何历史「完成 / PASS」声明，实际读源码、跑独立验证脚本、执行 test / typecheck / build。

## 总体结论

# PASS

框架、数学、未来函数防护、确定性、状态隔离、容量约束、lotSize、时间边界均经独立脚本与工程验证确认正确。此前三轮审计发现的全部 P1/P2 阻塞项均已修复，且本轮未发现新的阻塞项。

---

## 1. 架构验收
**PASS**

数据流清晰且单向：`Market Data → Strategy(signalProvider) → Signal → Order → ExecutionModel → Fill → Portfolio → Equity → Performance → BacktestResult`。

| 检查项 | 结果 | 证据 |
|---|---|---|
| Strategy 是否直接改 Portfolio | 否 | `engine.ts` signalProvider 只返回 `Signal[]`，无任何 portfolio 引用 |
| Strategy 是否直接改 cash | 否 | cash 仅 `Portfolio` 私有字段 `cashAmount` 可改 |
| Strategy 是否直接生成成交 | 否 | 成交由 `ExecutionModel.execute()` 产出 Fill，策略只给意图 |
| Strategy 是否自己算收益 | 否 | 收益统一在 `performance.ts` / `portfolio.ts` 结算 |
| Performance 是否反向依赖 Strategy | 否 | `computePerformance` 只吃 equityCurve + trades |
| Engine 是否硬编码策略 | 否 | 策略经 `signalProvider` 注入 |

## 2. 未来函数
**PASS**

逐项核对，未发现已确认未来函数：
- 信号时间：`signalProvider(date)` 只接收信号日 `date`，契约限定只读 ≤ date 信息。
- 成交时间：`executionTime = 下一交易日`（T+1），`engine.ts:63` 只处理上一日 `pendingSignals`。
- 成交数据：`NextOpenExecutionModel.execute()` 只读 `bar.open` 与 `bar.prevClose`，**不读 close/high/low/volume**（`execution.ts:134-155`）。
- 滑点分层：改用 `referenceAmount`（信号日 amount），非 T+1 当日全天成交额（`execution.ts:142/146`）。
- 容量约束：`fill.amount = refAmount`（信号日），非成交日 amount（`execution.ts:149/157`）。
- 无 `shift(-1)` / lead / next / lookahead / 完整数组提前计算。

## 3. 数据泄漏
**PASS**

独立脚本「未来数据污染测试」：T1–T3 与 T1–T6 数据集分别截至 T3 回测，`JSON.stringify(trades)` 与最终 equity **完全一致**。增加 endDate 之后 bar（T4 open=999）不改变结果。

## 4. 时间边界
**PASS**

- `engine.ts:49`：`dates = tradingDates.filter(date >= startDate && date <= endDate)`。
- endDate=T2 时 equity 曲线仅 2 点，T4 不参与。
- startDate=T2 时，T1 的信号（信号日被排除）不产生任何交易。

## 5. Execution
**PASS**

Signal ≠ Order ≠ Fill 三段分离。成交价 = 开盘价 ± 滑点，费用/滑点统一在 `CostModel` 结算，满足会计恒等（见 §10）。

## 6. Portfolio
**PASS**

`equity = cash + marketValue` 每个权益点成立。买入扣 cash、增 position；卖出增 cash、减 position，无凭空增减。

## 7. Position
**PASS**

`openPositionCount <= maxPositions` 成立（Portfolio 权威层约束）。卖出超过持仓被拒且现金不变。

## 8. Trade
**PASS**

Golden Test 复算：100 股 10 元买入 → 11 元卖出，`grossPnL=100`、`fees=10.570449`、`slippage=2.1`、`netPnl=87.329551`，数学一致。

## 9. Equity Curve
**PASS**

每个权益点在当日收盘后记录（`engine.ts:86`），不提前；最后一点正确反映 cash + 当前持仓市值。

## 10. PnL
**PASS**

Net PnL = Gross PnL − Fees − Slippage 严格恒等（独立断言 `|netPnl − (grossPnL − fees − slippageAmount)| < 1e-6`）。grossPnL 定义为「纯价格差」（basePrice 差 × 数量）。

## 11. Performance Analytics
**PASS**

totalReturn / CAGR / volatility / Sharpe / maxDrawdown / winRate / profitFactor / averageWin / averageLoss / tradeCount 全部统一从 equityCurve + trades 计算，来源单一。

## 12. Sharpe
**PASS**

全仓 grep 确认 `sharpeRatio` 唯一数学实现 = `shared/quant-stats.ts`，`performance.ts` / `downsideRisk.ts` / `overfittingGuard.ts` 均 import 之，无第二套。CAGR 分离为 `annualizedReturnFromEquityCurve`（几何），注释明确禁止混用。

## 13. 状态隔离
**PASS**

A / B / A 连续执行：B 无交易、两次 A `JSON.stringify` 完全一致、cash 不残留。每次 `runBacktest` new 独立 `Portfolio`。

## 14. 确定性
**PASS**

两次运行 `JSON.stringify` 深度相等。engine 内无 `Date.now()` / `Math.random()` / 网络 / 全局可变状态（grep 仅命中注释）。

## 15. Legacy 对照
**N/A**

`realisticBacktest.ts`（Legacy）与 Core 语义差异大（一字板/盘中止损/除权/三档门控/riskManagedHold），逐笔 diff 无意义；差异来自「Core 尚未迁移的 A 股特定逻辑」，非 bug。Adapter 提供绩效统一桥接，不破坏 Legacy。

## 16. Tests
- **通过**：368（engine.test 29 + engine.fix.test 16 + quant-stats.test 86 + 其余业务测试）
- **失败**：15（全部为既有环境类，与 Step 1 / Step 2-FIX / Step 2-REAUDIT 清单完全一致，**无新增**）：
  - 缺 `DATABASE_URL`：marketData(4) + limitUp.watch(4) + limitUp(1)
  - 缺 `TUSHARE_TOKEN`：tushare.secret(1)
  - 缺 `client/src/pages/StockPriceSync.tsx`：stockPriceSyncPage(2)
  - 网络超时 5s：tushareTradingCalendar(3)

## 17. Typecheck
**PASS**（`tsc --noEmit` 退出码 0）

## 18. Build
**PASS**（vite 构建成功，dist/index.js 408.2kb；chunk 体积告警非错误）

## 19. 严重问题

- **P0**：无
- **P1**：无
- **P2**：无
- **P3（非阻塞，延期）**：
  1. `downsideRisk.ts:330` 仍有 `maxDrawdownFromEquities` 重复实现（Legacy，未迁移）
  2. `portfolio.ts` `openTradesSnapshot()` 硬编码 `openAtEnd: false`（latent，仅在 `allTrades()` 先于 `finalizeOpenTrades()` 调用时才语义不符；engine 主流程永远先 finalize 再 allTrades，故不触发）

## 20. 一般问题

- engine 内无 `any` / TODO / FIXME / `@ts-ignore`（grep 零命中）。
- 最小确定性模型：每 symbol 一次建仓/清仓，加仓/部分减仓为后续扩展点（接口已按 symbol 隔离）。
- `generatedAt = "deterministic"` 为固定占位，无真实时间戳（刻意避免非确定性）。

## 21. 必须修复的问题

无。所有阻塞项已在 Step 2-FIX / Step 2-FIX21 修复，本轮独立复验通过。

## 22. 可以延期的问题

1. 加仓 / 部分减仓完整模型
2. warm-up（lookback 预热）机制
3. Legacy 全部迁移到 Core
4. ST / 创业板 / 科创板涨跌停幅度区分
5. Legacy drawdown / 手续费重复实现清理
6. `openTradesSnapshot()` 的 `openAtEnd` 语义修正

以上均为非阻塞项，不影响「回测结果是否可信」这一第一原则。

---

## 附：本轮独立验证脚本断言结果

独立 tsx 脚本（`audit_step2_final.ts`，已删除）37/37 全通过，覆盖：

| 类别 | 断言数 | 结果 |
|---|---|---|
| Golden Test 会计恒等 + 恒等式 | 8 | PASS |
| 最大回撤 [100,110,105,120,90,100]=25% | 2 | PASS |
| 未来数据污染 T1-T3 vs T1-T6 | 1 | PASS |
| 时间边界（endDate+1 / startDate） | 3 | PASS |
| 状态隔离 A/B/A | 3 | PASS |
| 确定性 | 1 | PASS |
| maxPositions | 2 | PASS |
| maxPositionAmountRatio | 4 | PASS |
| lotSize | 4 | PASS |
| amount lookahead（价格+容量双路径） | 2 | PASS |
| Portfolio 不变量（6 条） | 5 | PASS |
| 卖出超持仓拒绝 | 2 | PASS |
