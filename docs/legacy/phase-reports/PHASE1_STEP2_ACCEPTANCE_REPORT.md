# Step 2 Backtest Core —— 独立成果验收报告

> 审计身份：独立代码审计员 + 量化回测系统验收工程师
> 审计日期：2026-09-05
> 审计范围：`server/engine/`（domain / execution / portfolio / performance / engine / adapter / index）+ `engine.test.ts` + `shared/quant-stats.ts`
> 审计方式：源码逐行审读 + 独立验收脚本（21 项断言，已运行）+ 完整测试/typecheck/build

---

## 总体结论

# FAIL

核心引擎在**确定性、状态隔离、时间边界、会计恒等、PnL 计算、Sharpe 统一**上全部通过，但存在**一处已确认的未来函数（当日成交额 `amount` 参与 T+1 开盘滑点分层）**，以及**三个在 `BacktestConfig` 中声明但引擎完全未实现的配置项**（`maxPositions`、`maxPositionAmountRatio`、`lotSize`）。这两类问题直接关系"回测结果是否可信"，按验收标准 A「没有发现已确认未来函数」无法成立，故判定 FAIL。

---

## 1. 架构验收 — PASS

数据流清晰且单向：

```
Market Data → signalProvider(Signal) → Engine转Order → ExecutionModel(Fill) → Portfolio(Position/Equity) → Performance → BacktestResult
```

| 检查项 | 结果 | 证据 |
|---|---|---|
| Strategy 是否直接修改 Portfolio | 否 | `signalProvider` 只返回 `Signal[]`，无 Portfolio 引用 |
| Strategy 是否直接修改 cash | 否 | cash 仅存在于 `Portfolio` 私有字段，策略不可见 |
| Strategy 是否自己生成成交 | 否 | 成交由 `ExecutionModel.execute` 产出 |
| Strategy 是否自己计算收益 | 否 | 收益由 `computePerformance` 从 equityCurve/trades 计算 |
| Performance 是否反向依赖 Strategy | 否 | `computePerformance` 只吃 `{equityCurve, trades, initialCapital}` |
| Engine 是否硬编码具体策略 | 否 | 策略通过 `signalProvider` 注入 |

无架构越界问题。

## 2. 未来函数 — FAIL

T+1 规则本身实现正确：信号 T 日收盘产生 → `pendingSignals` 延迟至 T+1 开盘处理 → `ExecutionModel` 只读 `open` 与 `prevClose`，不读 `close/high/low`。

**但发现一处已确认的未来函数：**

- **文件**：`server/engine/execution.ts` 第 139/147 行
- **问题**：`NextOpenExecutionModel.execute` 在 T+1 开盘成交时，调用 `amountAdjustedSlippageBps(cost.slippageBps, bar.amount)`，读取 **T+1 当日全天成交额**做滑点分层。
- **根因**：`MarketBar.amount` 是"当日全天成交额"，在 T+1 **开盘时点**尚不可知；用它决定开盘成交价属于 lookahead。
- **实测**：独立脚本构造同一 T+1 bar，`amount=null` 时买入成交价 10.01，`amount=50000`（千元）时成交价 10.03 —— 成交价被未来成交额改变。
- **影响**：滑点分层（<1亿 +20bp / 1~5亿 +10bp / 5~20亿 +5bp）直接影响成交价与 PnL，幅度虽小但属于核心正确性问题。
- **性质**：与 Legacy `realisticBacktest.ts`（第 293/419 行）行为一致，为**继承缺陷**，非本 Step 新引入。
- **修复**：滑点分层的成交额应改用"信号日 T 的成交额"或"过去 N 日均成交额"（均为成交时点已知信息），而非 T+1 当日额。

## 3. 数据泄漏 — PASS

独立污染测试通过：

- Dataset A（仅 T1/T2/T3）与 Dataset B（T1~T6），均回测至 T3：`trades` 与 `equityCurve` 深度相等（`JSON.stringify` 全等）。
- 增加 `endDate` 之后的 bar（含 999 极端价）不改变结果。

引擎层面无数据泄漏；唯一例外即第 2 节的 `amount`（已单独归类为未来函数）。

## 4. 时间边界 — PASS

- `dates = tradingDates.filter(date >= startDate && date <= endDate)` 严格裁剪。
- `endDate + 1` 数据不参与回测（独立脚本 PASS）。
- `startDate` 前数据不进入信号循环（信号仅在 dates 循环内调用）。
- **提示（P3）**：引擎未提供显式 warm-up / lookback 区间机制。若策略需计算 MA20 等，需依赖 `signalProvider` 闭包自持 `startDate` 之前的历史数据，属策略职责，建议后续在文档明确约定。

## 5. Execution — PASS（数学）/ 含一处未来函数

- Signal ≠ Order ≠ Fill 分离清晰：策略只产 Signal，引擎转 Order（`executionTime = T+1`），ExecutionModel 产 Fill（可拒绝）。
- 涨跌停可成交性判定基于 `prevClose`（`limitUpPrice`/`limitDownPrice`），方向正确。
- 滑点方向正确：买入上浮、卖出下浮。
- 扣分项：`amount` 未来函数（见第 2 节）。

## 6. Portfolio — PASS

- 会计恒等严格成立：独立脚本对 Golden Test 及每笔 equity point 验证 `equity = cash + marketValue`（误差 < 1e-9）。
- Buy：cash 减少（`gross + fees`）、position 增加；Sell：position 减少、cash 增加（`gross - fees`）。
- 资金不足 / 持仓不足 / 重复持仓均拒绝且不改变任何状态（原子性正确）。
- 未出现凭空增减资金或持仓。

## 7. Position — PASS（最小模型）

- `markToMarket` 用最近有效收盘价估值，缺价时回落 `entryPrice`（保守）。
- `unrealizedPnL = marketValue - totalEntryCost`（含费用口径一致）。
- **局限（P3）**：仅支持"每 symbol 一次建仓、一次清仓"（`buy` 拒绝已有持仓；`sell` 支持部分但引擎实际只清仓）。加仓/部分减仓为后续扩展点，接口已按 symbol 隔离。

## 8. Trade — PASS

人工构造 100 股 @10 买入、@11 卖出（默认成本模型），独立脚本复算全部命中：

| 字段 | 期望 | 实测 |
|---|---|---|
| grossPnL | 100.000000 | 100 |
| fees | 10.570449 | 10.570449 |
| slippageAmount | 2.100000 | 2.099999… |
| netPnl | 87.329551 | 87.329551 |
| 恒等 netPnl = grossPnL − fees − slippage | 成立 | 成立（<1e-6） |
| 期末 cash / equity | 100087.329551 | 100087.329551 |

`entryPrice`/`exitPrice` 为含滑点价，`grossPnL` 用 `basePrice`（无滑点基准）计算纯价格差，恒等式因此严格成立。`returnPct = netPnl / totalEntryCost`、`holdingPeriod = exit日−entry日+1`，均数学一致。

## 9. Equity Curve — PASS

- 每个点收盘后记录（`equityPoint` 用当日 close 估值）。
- 无未来价格更新过去 equity（污染测试 PASS）。
- 最后一点正确反映 `cash + 当前持仓市值`。

## 10. PnL — PASS

- Net PnL 恒等式严格成立（见第 8 节）。
- 已平仓交易 netPnl 累加 = 期末 equity − 初始资金（独立脚本验证：`100000 + ΣnetPnl === 100087.329551`）。

## 11. Performance Analytics — PASS

- `totalReturn / CAGR / volatility / Sharpe / maxDrawdown / winRate / profitFactor / averageWin / averageLoss / expectancy / tradeCount` 全部统一在 `computePerformance` 一处计算。
- CAGR 用几何年化（`annualizedReturnFromEquityCurve`），Sharpe 用算术年化，两者分离正确。
- 纯函数、确定性、无副作用。

## 12. Sharpe — PASS

- `sharpeRatio` 仅定义于 `shared/quant-stats.ts`（唯一实现）。
- `server/engine/performance.ts`、`overfittingGuard.ts`、`downsideRisk.ts` 均 import 该统一实现。
- **无第二套 Sharpe**（grep 全仓确认，无其他 `sharpe` 计算公式）。

## 13. 状态隔离 — PASS

- 每次 `runBacktest` 创建独立 `Portfolio` 实例。
- 独立脚本 A/B/A 顺序执行，第一次 A 与第二次 A 的 `trades`/`finalPortfolio` 深度相等，B 不受 A 影响。
- `NextOpenExecutionModel` 无状态（构造参数只读），即使复用同一实例也安全。

## 14. 确定性 — PASS

- `server/engine/` 内无 `Math.random()` / `Date.now()` / `new Date()` / 网络请求（grep 确认，仅出现在注释）。
- `metadata.generatedAt = "deterministic"`（刻意不用真实时间戳）。
- 独立脚本两次运行结果 `JSON.stringify` 全等。

## 15. Legacy 对照 — N/A（附说明）

- `realisticBacktest.ts`（Legacy）与 Core 语义差异巨大：Legacy 含一字涨跌停、盘中止损、除权检测、三档开盘预期门控、`riskManagedHold` 退出状态机、position sizing（equal/scoreWeighted/fixedPercent）。Core 是最小 next-open 模型。
- **直接同案例对照不可行**：两引擎在"买入门控"与"退出规则"上并非同一语义，差异主要来自"Core 尚未迁移的 A 股特定逻辑"（即行为差异，非 bug）。
- 已确认的共享缺陷（`amount` 未来函数、手续费模型、滑点分层）在两引擎中一致，属"行为继承"。
- 建议后续 Step 提供"零费用零滑点、无门控、固定 T+1 买/T+2 卖"的对照夹具后，再做逐笔 diff。

## 16. Tests — 通过 352 / 失败 15

- **Core 相关新增测试全绿**：`server/engine/engine.test.ts`（29 tests）+ `shared/quant-stats.test.ts`（86 tests）= 115 全通过。
- 全仓：**352 通过，15 失败**。
- 15 个失败全部为环境类，与本次 Step 2 无关，逐项如下：

| 失败文件 | 数量 | 原因 |
|---|---|---|
| `limitUp.watch.test.ts` | 4 | 缺 DATABASE_URL（DB 依赖） |
| `marketData.test.ts` | 4 | 缺 DATABASE_URL（DB 依赖） |
| `tushareTradingCalendar.test.ts` | 3 | 网络超时（真实外呼） |
| `stockPriceSyncPage.test.ts` | 2 | 缺 `client/src/pages/StockPriceSync.tsx` 源文件 |
| `tushare.secret.test.ts` | 1 | 缺 TUSHARE_TOKEN |
| `limitUp.test.ts` | 1 | 缺 DATABASE_URL（DB 依赖） |

- **本次修改未引入任何新失败**（engine 与 quant-stats 测试全绿，其余失败与 Step 1 验收时清单一致）。

## 17. Typecheck — PASS

`npx tsc --noEmit` 退出码 0，无类型错误。

## 18. Build — PASS

`npm run build` 成功：vite build（2846 模块）+ esbuild 打包，产出 `dist/public/` 与 `dist/index.js`（408.2kb）。仅有 chunk 体积告警（非错误）。

## 19. 严重问题

### P0
无。

### P1（阻塞 PASS，必须修复）
1. **`maxPositions` 未生效** —— `domain.ts` 声明了 `BacktestConfig.maxPositions`，但 `engine.ts`/`portfolio.ts` 全程未引用。独立脚本实测：`maxPositions=1` 时仍买入 2 只。风控/容量约束缺失，回测会买入现实中不可能持有的仓位数。
2. **`maxPositionAmountRatio` 未生效** —— 同上述，容量约束（单笔 ≤ 当日成交额×比例）未实现。实测 `ratio=0.001` 时应限购 100 股，实际买入 9000 股。
3. **未来函数 `amount`** —— `execution.ts` 用 T+1 当日全天成交额做开盘滑点分层（详见第 2 节），属已确认 lookahead。

### P2
4. **`lotSize` 未校验** —— `CostModel.lotSize` 已定义但买入不校验整手。实测 50 股（非整手）被成功买入，违反 A 股"买入必须整手"规则。

### P3
5. **最小模型局限** —— 每 symbol 仅一次建仓/清仓，无加仓/部分减仓。
6. **无 warm-up 机制** —— lookback 依赖策略闭包自持。
7. **`generatedAt: "deterministic"`** —— 常量字符串，下游若期待真实时间戳需自行处理。
8. **重复 drawdown / 手续费** —— `maxDrawdownFromEquity`（engine）与 `maxDrawdownFromEquities`（downsideRisk）及 `realisticBacktest` 内联实现重复；手续费模型在 `execution`/`realisticBacktest`/`paperTrading` 三处重复。均属 Legacy 保留，迁移策略已声明，可延期统一。

## 20. 一般问题（代码质量 / 架构债务）

- `sell` 支持部分减仓但 `slippageAmount` 累计不按比例结转（当前最小模型只清仓，不触发；若启用部分减仓会出错）。建议后续一并处理。
- 涨跌停默认 `limitUpRatio/limitDownRatio = 0.1`，未覆盖 ST（5%）、创业板/科创板（20%）；虽已留 `LimitRules` 注入点，但默认值不覆盖全市场（Phase 0 已知项）。
- `Portfolio.buy/sell` 未校验 `quantity` 为 `lotSize` 整数倍（与 P2-4 同源）。
- `adapter.ts` 中 `toCoreTrade` 的 `grossPnL` 恒为 `null`、`slippageAmount` 恒为 0、`holdingPeriod` 恒为 `null` —— 桥接是"语义降级"而非等价映射，`computeLegacyPerformance` 的 winRate/profitFactor 等与 Legacy 自算值可能不一致。这是可接受的过渡态，但应文档化"差异边界"。

## 21. 必须修复的问题（FAIL → PASS 清单）

| # | 文件 | 位置 | 原因 | 修复方式 | 验证方式 |
|---|---|---|---|---|---|
| 1 | `engine.ts` | 买入循环 | `maxPositions` 未执行 | 买入前检查 `portfolio.openPositionCount < config.maxPositions`，超出则拒绝该信号 | 单测：`maxPositions=1` + 2 买入信号 → 仅 1 成交 |
| 2 | `engine.ts`/`portfolio.ts` | 买入路径 | `maxPositionAmountRatio` 未执行 | 买入前按 `bar.amount × 1000 × ratio / price` 计算容量上限并向下取整手 | 单测：小成交额 + 大信号 → 数量被容量上限截断 |
| 3 | `execution.ts` | 139/147 | 滑点分层用 T+1 当日 `amount`（未来函数） | 改为用信号日/过去 N 日均成交额（成交时点已知）做分层，或显式在配置中声明"允许事后视角"并关闭该分层 | 单测：固定 T 日 amount，变化 T+1 amount → 成交价不变 |
| 4 | `portfolio.ts`/`engine.ts` | 买入校验 | 非整手买入未被拒 | 买入时校验 `quantity % lotSize === 0` | 单测：50 股买入 → 拒绝 |

## 22. 可以延期的问题

- 最小模型加仓/部分减仓（P3-5）
- warm-up/lookback 显式机制（P3-6）
- Legacy 的 A 股特定逻辑（一字板/盘中止损/除权/三档门控）迁移到 Core（行为差异，需独立 Step）
- 重复 drawdown / 手续费与 Legacy 统一（迁移策略已声明）
- 涨跌停阈值全市场覆盖（Phase 0 遗留）
- `adapter.ts` 语义降级边界文档化

---

### 审计结论一句话

Core 的**框架与数学是正确的**（确定性、隔离、会计恒等、Net PnL 恒等式、Sharpe 统一、时间边界全部经实测通过），但**容量/风控配置未落地 + 一处未来函数**使"回测结果可信度"存疑，故**不通过**；修复清单第 21 节 4 项后即可达到 PASS 门槛。
