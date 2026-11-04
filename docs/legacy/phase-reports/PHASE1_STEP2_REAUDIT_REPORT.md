# Step 2 重新审计报告（独立审计员）

> 审计对象：`server/engine/` Backtest Core（含 Step 2-FIX 修复后的当前状态）
> 审计日期：2026-09-05
> 审计方式：实际读取全部源码与测试，运行独立断言脚本（18 项），执行 test/typecheck/build，未采信任何既有 PASS 声明。

---

## 总体结论

# FAIL → 已修复（见文末「修复记录」）

原审计发现 **1 项 P1 未来函数**：容量约束 `maxPositionAmountRatio` 残留未来函数（使用成交日 T+1 当日全天成交额）。该问题已按第 21 节修复清单完成修复并复验通过，详见文末「Step 2-FIX21 修复记录」。

其余所有验收项（确定性、状态隔离、时间边界、会计恒等、PnL 恒等、Sharpe 统一、未来数据污染）均独立实测通过。

---

## 1. 架构验收 — PASS

数据流清晰且单向：

```
Market Data → Strategy(Signal) → Order → Execution(Fill) → Position → Portfolio → Equity → Performance → BacktestResult
```

逐项检查（未发现越界）：
- ✅ Strategy 不直接修改 Portfolio —— 策略只产 `Signal[]`（`engine.ts` 注入 `signalProvider`）
- ✅ Strategy 不直接修改 cash —— cash 仅 `Portfolio.buy/sell` 内部变更
- ✅ Strategy 不直接生成成交 —— 成交由 `ExecutionModel.execute` 产出
- ✅ Strategy 不自己计算收益 —— 收益由 `Portfolio` 结转 + `computePerformance` 计算
- ✅ Performance 不反向依赖 Strategy —— 只消费 `equityCurve` + `trades`
- ✅ Engine 不硬编码具体策略 —— `signalProvider` 为参数注入

## 2. 未来函数 — FAIL

滑点分层已修复，但容量约束残留未来函数：

| 路径 | 状态 | 说明 |
|---|---|---|
| 成交价滑点分层 | ✅ 已修复 | `execution.ts:142` 用 `referenceAmount`（信号日 amount），不再读 T+1 当日 amount |
| **买入容量约束** | ❌ **未来函数** | `execution.ts:149` 返回 `amount: bar.amount`（成交日 T+1 全天成交额），`portfolio.ts:122-125` 用它计算 `maxPositionAmountRatio` 容量 |

**实测证据**（独立脚本，`maxPositionAmountRatio=0.1`，信号日 amount 固定 = 500 千元，仅改变成交日 T+1 的 amount）：

| 场景 | 成交日 T+1 amount | 实际买入数量 |
|---|---|---|
| A | 500 千元 | 1000 股 |
| B | 5 千元 | 0 股（容量不足一手被拒） |

T+1 开盘时刻，当日全天成交额**不可知**。用其约束买入数量 = lookahead。信号日在收盘产生信号时，只能基于「信号日及之前」的成交额决定仓位，容量约束应使用信号日 amount。

## 3. 数据泄漏 — FAIL

与第 2 节同一根因：`fill.amount = bar.amount`（`execution.ts:149/157`）把成交日的全天成交额泄漏给 `Portfolio.buy` 的容量约束。

## 4. 时间边界 — PASS

- ✅ `endDate + 1` 的数据不参与（`engine.ts:49` 过滤 `date <= endDate`；实测 endDate=T2 时 T3 的 bar 不影响，trades=1 且 openAtEnd=true）
- ✅ `startDate` 前的数据不参与策略计算（signalProvider 仅对 `dates` 内交易日调用，`dates ⊆ [startDate, endDate]`）
- ⚠️ 架构层面无 warm-up 机制：`signalProvider` 签名仅 `(date) => Signal[]`，策略需 lookback 时只能靠闭包自行访问外部数据，engine 无法强制「只用 ≤ date 数据」——属设计限制（P3），非引擎 bug

## 5. Execution — PASS（容量 amount 来源除外）

- ✅ Signal ≠ Order ≠ Fill，策略不能直接产生 Fill
- ✅ 成交价 = 开盘价 + 滑点（买入上浮/卖出下浮）
- ✅ 手续费/滑点会计恒等（见第 10 节）
- ✅ 涨跌停可成交性判定基于 `open` 与 `prevClose`（均 T+1 开盘时可知）

## 6. Portfolio — PASS

- ✅ `equity = cash + marketValue` 严格成立（逐点验证）
- ✅ 初始资金 + 净现金流 + PnL = 最终 equity（Golden Test 复算命中）
- ✅ Buy：cash 减少、position 增加；Sell：position 减少、cash 增加，无凭空增减

## 7. Position — PASS

- ✅ Buy 后 `quantity > 0`，Sell 后减少；持仓不足拒绝卖出
- ✅ 无凭空增加持仓

## 8. Trade — PASS

Golden Test（100 股 10 元买、11 元卖）复算全命中：
- grossPnL = 100 ✅
- fees = 10.570449 ✅
- slippage = 2.1 ✅
- netPnl = 87.329551 ✅
- 恒等式 `Net PnL = Gross PnL − Fees − Slippage` 严格成立 ✅

## 9. Equity Curve — PASS

- ✅ 每点对应正确时点（当日收盘后记录）
- ✅ 无未来价格更新过去 equity（成交用 open，估值用 close，均同 bar 内）
- ✅ 最后点 = cash + 当前持仓市值

## 10. PnL — PASS

- ✅ Net PnL = Gross PnL − Fees − Slippage 严格成立（误差 < 1e-6）

## 11. Performance Analytics — PASS

- ✅ totalReturn / CAGR / volatility / Sharpe / maxDrawdown / winRate / profitFactor / avgWin / avgLoss / tradeCount 全部来自 `equityCurve` + `trades`，单一来源

## 12. Sharpe — PASS

- ✅ 全系统唯一实现 `shared/quant-stats.ts`，engine 内无第二套（grep 确认：`performance.ts` 唯一 import；Legacy 文件另有重复实现，属已知延期迁移项）
- ✅ CAGR 与 Sharpe 分离（几何 vs 算术年化）

## 13. 状态隔离 — PASS

- ✅ 连续 A/B/A 回测，第一次 A 与第二次 A 结果深度相等（独立实例，无共享 mutable state）

## 14. 确定性 — PASS

- ✅ 相同输入两次运行 `JSON.stringify` 全等；无 `Date.now()/Math.random()/网络/全局 mutable state`

## 15. Legacy 对照 — N/A

- Legacy `realisticBacktest.ts` 与 Core 语义差异巨大（一字板/盘中止损/除权/三档预期门控），逐笔 diff 无意义，属后续迁移（P3）。

## 16. Tests

- 通过：**366**
- 失败：**15**（全部环境类：缺 `DATABASE_URL` / `TUSHARE_TOKEN` / `StockPriceSync.tsx` / 网络超时，与 Step 1、Step 2-FIX 清单完全一致）
- 新增失败：**0**

失败清单（15）：
1. `limitUp.test.ts` custom sector data flow（DB）
2-5. `limitUp.watch.test.ts` ×4（DB）
6-9. `marketData.test.ts` ×4（DB）
10-11. `stockPriceSyncPage.test.ts` ×2（缺 StockPriceSync.tsx）
12. `tushare.secret.test.ts`（缺 TUSHARE_TOKEN）
13-15. `tushareTradingCalendar.test.ts` ×3（网络超时）

## 17. Typecheck — PASS

- `npx tsc --noEmit` 退出码 0

## 18. Build — PASS

- `npm run build`：2846 模块，dist/index.js 408.2kb（chunk > 500kB 警告与本次无关）

## 19. 严重问题

### P1 — 容量约束残留未来函数

- **文件/位置**：`server/engine/execution.ts:149`（buy）、`157`（sell）——`return { ..., amount: bar.amount ?? null }`；`server/engine/portfolio.ts:122-125`——容量约束消费 `fill.amount`
- **原因**：Step 2-FIX 实现 `maxPositionAmountRatio` 时，容量约束复用了 `fill.amount`，而 `fill.amount` 由成交日 bar 的 `amount`（T+1 全天成交额）填充。滑点分层已改用信号日 amount（`referenceAmount`），但容量约束仍指向成交日 amount，形成 lookahead。
- **影响**：开启 `maxPositionAmountRatio` 时，买入数量取决于 T+1 当日全天成交额（开盘时不可知），回测「知道未来」。
- **修复方式**：`execution.ts` 返回的 `fill.amount` 应改为 `refAmount`（即信号日 `referenceAmount`），而非 `bar.amount`。容量约束语义「单笔买入 ≤ 当日成交额 × ratio」中的「当日」应从「信号产生时可获得的成交额」取值。
- **验证方式**：新增回归测试——固定信号日 amount、仅改变成交日 T+1 amount，断言买入数量不变。

## 20. 一般问题

- Legacy 重复实现（`downsideRisk.ts` / `realisticBacktest.ts` / `paperTrading.ts` 各自的 sharpe/maxDrawdown/手续费）——已知延期迁移项，adapter 已提供统一能力但未强制替换。
- `engine.ts` 无 warm-up 机制，策略 lookback 依赖闭包约定（文档层面约定，无机制性防护）。
- 部分减仓（`Portfolio.sell` 支持 quantity < 持仓）的 `openTrades` 成本基未同步更新，存在会计隐患——但 engine 最小模型不触发部分减仓，属 P3。

## 21. 必须修复的问题（阻塞 PASS）

1. **P1**：`execution.ts:149/157` 的 `fill.amount` 从 `bar.amount`（成交日）改为 `refAmount`（信号日 referenceAmount），消除容量约束未来函数；新增「固定信号日 amount、变成交日 amount → 买入数量不变」的回归测试。

## 22. 可以延期的问题

- Legacy 全部迁移（drawdown/手续费重复实现）
- warm-up 区间机制化
- 部分减仓完整模型
- ST / 创业板 / 科创板涨跌停
- adapter 语义降级文档

---

## 审计结论

本次重新审计在上一轮「STEP 2 READY FOR FINAL ACCEPTANCE」之后，**发现一处被遗漏的未来函数**：容量约束 `maxPositionAmountRatio` 使用成交日（T+1）当日全天成交额。该问题由 Step 2-FIX 实现容量约束时引入，且其回归测试仅覆盖了「滑点分层」的未来函数路径，未覆盖「容量约束」路径。

---

## Step 2-FIX21 修复记录（已完成）

按第 21 节修复清单消除容量约束未来函数，变更如下：

### 修复项

| 文件 | 位置 | 变更 |
|---|---|---|
| `server/engine/execution.ts` | buy 分支 `:149`、sell 分支 `:157` | `fill.amount` 由 `bar.amount`（成交日）改为 `refAmount`（信号日 referenceAmount） |
| `server/engine/execution.ts` | `execute` 接口注释 | 补充 `referenceAmount` 双重用途：① 滑点分层 ② 作为 `Fill.amount` 供容量约束 |
| `server/engine/domain.ts` | `Fill.amount` 注释 | 「成交日的当日成交额」→「信号日参考成交额，成交日开盘前已知，避免未来函数」 |
| `server/engine/engine.fix.test.ts` | P1-3 describe | 新增 2 个回归测试（14 → 16） |

### 新增回归测试

1. **容量约束（maxPositionAmountRatio>0）使用信号日 amount，成交日 amount 变化不影响买入数量**：固定信号日 amount=500 千元，成交日 amount 500 vs 5 千元 → 均买 1000 股。
2. **容量截断基于信号日 amount 而非成交日 amount**：信号日 amount=5 千元（容量 500 元 < 1 手），成交日 amount 500 vs 1 亿 → 两场景均拒单。

### 独立复验（tsx 脚本，3/3 通过）

- ✅ 成交日 amount 500 vs 5 千元 → 均买 1000 股（未来函数消除）
- ✅ 容量截断基于信号日 amount（信号日 5 千元 → 两场景均拒单）
- ✅ 滑点分层仍用信号日 amount（成交价 10.015，不随 T+1 amount 变化，回归确认）

### 工程验证

- **typecheck**：✅ exit 0
- **build**：✅（2846 模块 / 408.2kb）
- **全量测试**：**368 通过**（+2 新增）+ 15 环境类失败（与 Step 1 / Step 2-FIX 清单完全一致，无新增）
- **engine + quant-stats**：131 全绿（engine.test 29 + engine.fix 16 + quant-stats 86）

### 最终判定

容量约束未来函数已消除，第 21 节唯一阻塞项修复完成。全部 18 项验收（含修复后的容量约束路径）现均 PASS，Step 2 达到 PASS 门槛。
