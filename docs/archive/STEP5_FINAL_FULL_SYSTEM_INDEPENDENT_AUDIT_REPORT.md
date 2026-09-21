# STEP 5-FINAL FULL SYSTEM INDEPENDENT AUDIT REPORT

> 审计身份：全新独立 Quant System Auditor。不采信此前 Step1/2/3/4/5 及任何 Re-audit 的 PASS 结论。
> 审计方法：逐文件读源码 + 全仓 grep + 独立动态探针（tsx 脚本，已删除）+ 全量回归。
> 约束遵守：未修改任何生产代码 / 测试 / migration / 配置；未 commit / push；只记录问题，不修复。

---

## 1. Executive Summary

本次独立审计重新验证了 stock-limit-up-analyzer 是否形成「Raw → Canonical → Validation → Time-aware → Feature → Strategy → Sizer → Risk → Approved Order → Backtest Core → Execution → Portfolio → Performance」的真正闭环。

**结论：闭环成立，无 P0、无 P1。发现 4 项 P2、7 项 P3（均不阻塞）。**

- 生产调用链为**真实代码调用**，逐层可溯源到 file:line（详见 §2）。
- Feature **真实改变**生产 Decision（独立探针：A 涨停确认→成交；B 未确认→排除；B 改涨停→纳入）。
- Future Leakage / Decision-time Leakage 破坏性探针全部通过（修改 T+1/T+2/T+3 OHLCV 不改变 T 决策与 T+1 成交入口）。
- Risk/Sizing 未被生产路径绕过（maxPositions=1→1 单成交；cash<1手→0 成交；lotSize 非整手→0 成交）。
- 全量回归：`npm test` 509 passed / 15 failed（6 files，全部 ENVIRONMENTAL，与历史基线逐一同构，无代码回归）；`npm run check` exit 0；`npm run build` 成功。
- **最重要的一个 P2**（§15 回测语义兼容）：生产 `realisticSimulation` 语义已从 legacy「T+1 开盘买入 + 风险管理退出」变为引擎「T+1 开盘买入 + 持有至期末按市价估值」（long-only 无 SELL），导致 `completedCount`≈0、`winRate`=null。该变化在 FIX-2 报告中被显式记录（Known Issue #3），但 `RealisticBacktestResult` 类型与前端标签未随之更新，字段名仍沿用旧语义。

---

## 2. Production Call Graph（真实调用链，逐层 file:line）

```
routers.ts:1018-1022  sentiment.getLeaderCandidateBacktest (publicProcedure query)
        ↓ (真实生产调用，非 test)
routers.ts:1026-1034  sentiment.saveBacktestRun (protectedProcedure, admin, 同调 db.getLeaderCandidateBacktest)
        ↓
db.ts:1821-1829       getLeaderCandidateBacktest → loadBacktestBaseContext() 加载 records/rawRows/context
        ↓
leaderCandidateStrategyBacktest.ts:306-314  runLeaderCandidateStrategyBacktest
        ↓ 生产配置 buildProductionLeaderCandidateStrategyConfig（featureMode="limit-up-confirm"）
leaderCandidateStrategyBacktest.ts:191-228   runLeaderCandidateEngineProbe
        ↓
strategyBacktest.ts:113-268  runStrategyEngineBacktest
        ├─ 129-140   toCanonicalBar + validateMarketBar（INVALID 拒收）
        ├─ 184-194   runFeaturePipeline（visibleBars asOf 过滤，decisionPoint="close"）
        ├─ 196-213   createFeatureSnapshotBundle（同 asOf 绑定）
        ├─ 216-224   buildStrategySignalProvider({ buildFeatures })
        │              ↓
        │            strategies/leaderCandidateBaseline.ts:157-187 evaluate
        │              └─ 176-178 isCandidateLimitUpConfirmed 真实读取 context.features
        ├─ 254       runBacktestWithRisk
        │              ↓
        │            engine/engine.ts:198-203 runBacktestWithRisk → buildDefaultRiskManager(config)
        │              ↓
        │            engine/engine.ts:59-190  runBacktest
        │                ├─ 80-138   pendingSignals → RiskManager(Sizer?) → execution.execute(T+1 open)
        │                ├─ 149      signalProvider(date, snapshot)（T 收盘后产生信号）
        │                └─ 162      computePerformance（调 shared/quant-stats）
        │              ↓
        │            engine/execution.ts:112-165  NextOpenExecutionModel.execute（只读 open/prevClose）
        │            engine/portfolio.ts:113-223  Portfolio.buy/sell（cash/position/equity 权威）
        │            engine/performance.ts:59-99   computePerformance
        ↓
leaderCandidateStrategyBacktest.ts:235-293  adaptEngineResultToRealisticBacktestResult（仅映射，不重算）
        ↓
leaderCandidateStrategyBacktest.ts:314      buildLeaderCandidateBacktest(..., { realisticSimulationOverride })
leaderCandidates.ts:1001-1002               realisticSimulation = override ?? legacy sim
        ↓
LeaderCandidateBacktestResult → Router Response
```

**证据**：`runStrategyEngineBacktest` 唯一非测试调用方 = `leaderCandidateStrategyBacktest.ts:203`；`runLeaderCandidateStrategyBacktest` 唯一非测试调用方 = `db.ts:1826`；Router 调用方 = `routers.ts:1021/1031`。前端 `client/src/pages/Backtest.tsx` 通过 `trpc.sentiment.getLeaderCandidateBacktest.useQuery` 真实消费。全部确认为非 test-only。

---

## 3. Step1 — Statistics Foundation：**PASS**

- `shared/quant-stats.ts` 仍是唯一统计数学基础层（mean/median/variance/sampleVariance/standardDeviation/sampleStandardDeviation/skewness/excessKurtosis/quantile/percentile/pearson/spearman/rankIC/sharpeRatio/annualizedReturnFromEquityCurve/neweyWestMeanTStat/normal*）。
- 全仓 grep `function (mean|median|variance|sampleVariance|standardDeviation|sampleStandardDeviation|sharpe...)` 唯一命中 = quant-stats.ts。**无第二套生产实现**。
- Sharpe 定义统一：`mean(dailyReturn)/sampleStdDev·√252`（算术年化），n<2/std=0→null（quant-stats.ts:295-302）。
- population vs sample 语义明确：`variance`（/n）vs `sampleVariance`（/n-1），注释明确（quant-stats.ts:53-67）。
- NaN/Infinity/空输入安全：内部 `finite()` 过滤，样本不足返回 null，绝不产 NaN/Infinity。
- 回测 Performance 真实调用统一层：`engine/performance.ts:12-17` import 自 shared/quant-stats；`computePerformance` 内部 `sharpeRatio`/`sampleStandardDeviation`/`mean`/`annualizedReturnFromEquityCurve`（performance.ts:67-96）。
- Feature 未重实现统计：`features/basic.ts:16` import `mean, sampleStandardDeviation` 自 shared/quant-stats。
- **P3 观察（非生产影响）**：`maxDrawdown` 存在 4 处实现（engine/performance.ts:34 权威；downsideRisk.ts:330、overfittingGuard.ts:181 研究；realisticBacktest.ts:641 legacy）。生产路径只用 engine 的 `computePerformance.maxDrawdownPct`，其余为 research/legacy，不影响生产结果。

---

## 4. Step2 — Backtest Core：**PASS**

- Core 是唯一成交/费用/滑点权威：`engine/execution.ts`（费用+滑点唯一）、`engine/portfolio.ts`（cash/position 唯一 mutation）。
- Strategy/Risk/Feature/Sizer/Portfolio 均不直接执行交易（strategy 只产 Signal；risk 只产 Decision；feature 只产 FeatureResult；sizer 只产 propose；portfolio 只应用 Fill）。
- Commission/slippage 单实现：execution.ts `DEFAULT_COST_MODEL` + `buyFees/sellFees/amountAdjustedSlippageBps/slippedBuyPrice*`。Risk 层复用 `buyFees/slippedBuyPriceAdjusted`（policies.ts:24），无第二套。
- maxPositions 生效：portfolio.ts:120-122；风险层 MaxPositionsPolicy（policies.ts:59-78）。独立探针 maxPositions=1 → 3 BUY 意图 / 1 成交 ✓。
- maxPositionAmountRatio 生效：portfolio.ts:127-135（capacityAmount=amount千元×1000×ratio）；CapacityPolicy（policies.ts:89-114）。探针 ✓。
- lotSize 生效：portfolio.ts:114-118（%lotSize!==0 → INVALID_LOT_SIZE）；LotSizePolicy（policies.ts:37-49）。探针 lotSize=200 vs 请求100 → 0 成交 ✓。
- cash 约束含费用：portfolio.ts:138-145（总成本含 minCommission 兜底 `<= cash+1e-8`）；CashPolicy 用 adjusted 滑点估算（policies.ts:189-218）。探针 cash=900 < 1手成本 → 0 成交 ✓。
- T+1 execution 正确：engine.ts:80-139（T 收盘信号 → 下一交易日 open 成交），execution 只读 open/prevClose（execution.ts:141-142），referenceAmount 取信号日（engine.ts:85）。
- 涨跌停不使用错误固定 10% 于生产：Feature 路径 `limitUpHit` 走 boardRules 权威（basic.ts:243 `isLimitUpBar` → boardRules.ts:86-101 主板10%/ST5%/创业科创20%/北交所30%）。**P3 观察**：engine 的 NextOpenExecutionModel 默认 LimitRules=10% 且 blockLimitUpBuy/blockLimitDownSell 默认 false（生产未启用涨停拦截），故固定 10% 未在成交路径实际生效，但生产也未注入 resolveLimitRules（见 §24 P3-2）。
- drawdown 统一：生产用 engine `maxDrawdownFromEquity`（performance.ts:34）。
- Equity curve 与最终 Portfolio 一致：engine.ts:152（equityPoint 收盘 markToMarket）+ 158-159（finalize + markToMarket）。
- Trade 与 Fill 一致：portfolio.ts:203-218（清仓结算 grossPnL/fees/slippage/netPnl 恒等）。

---

## 5. Step3 — Strategy Contract：**PASS**

- Strategy 只产 Signal/Decision（contract.ts:112-119 `evaluate` 纯函数）。
- Strategy 禁止项全部满足：零 DB/Network/Portfolio mutation/Cash mutation/Order/Fill/Execution/Performance（`contract.test.ts:145-148` 源码文本扫描断言禁 import db/tushare/axios/http/fetch/Math.random/Date.now；grep 确认 strategy/ 目录无上述 import）。
- StrategyDefinition/Metadata/Config/Context/Signal/Decision 职责清晰（contract.ts 全文件）。
- leader-candidate-baseline 满足 Strategy→Signal（非 Strategy→Trade）：evaluate 只返回 `{ signals, strategyVersion, insufficientData }`（leaderCandidateBaseline.ts:157-187），评分仍由 Data Provider（buildLeaderCandidatesForDate）完成。

---

## 6. Step4 — Position Sizing / Risk：**PASS（含 1 项 P3 架构观察）**

生产路径 Signal → Sizer? → RiskManager → Approved Order → Backtest Core：

- 生产用 `runBacktestWithRisk`（strategyBacktest.ts:254）→ `buildDefaultRiskManager`（manager.ts:84-91）= LotSizePolicy + MaxPositionsPolicy + CapacityPolicy + CashPolicy。**RiskManager 未被绕过**。
- Reject/Resize/Approve 语义正确：manager.ts:22-67（REJECT 短路、RESIZE 取严格 min、不足一手 INSUFFICIENT_LOT REJECT）。
- 动态探针全部通过（独立脚本，非测试）：maxPositions=1→1 成交；cash<1手→0；lotSize 非整手→0。
- **P3-1（架构观察，非缺陷）**：生产未注入 PositionSizer——`runBacktestWithRisk` 只传 manager，engine.ts:114 `sizer ? sizer.propose(...) : signal.quantity`，故生产实际是「固定数量 100 股」（requestedQuantity=100）这一隐式 Fixed-Quantity 语义，未经过具名的 FixedQuantity/FixedCapital/FixedWeight/RiskCapped sizer。链条未被「绕过」（RiskManager 一定经过），但 Sizer 阶段在生产中退化为默认名义数量。审计 §六「证明生产路径没有绕过 PositionSizer」：技术上 Sizer 是可选层，未注入不属绕过，但建议显式声明。

---

## 7. Step5 — Data / Feature：**PASS**

- CanonicalMarketBar 字段齐全：symbol/timestamp/open/high/low/close/volume/amount/preClose/turnoverRate/limitUp…（data/types.ts:36-59；limitUp/limitDown 由 boardRules 读取侧计算，不在存储 bar 上）。
- 单位统一：price 元/股、volume 手、amount 千元、turnoverRate %（types.ts:7-15 + MARKET_DATA_UNITS）。
- null 不伪造为 0：adapter.ts:32-45 `toCanonicalBar` 用 parseNumericPrice，非法→null；validation.ts:30-32 明确「缺失→WARNING，不静默填零」。
- INVALID 不进入 Feature：strategyBacktest.ts:131-135 `validateMarketBar` INVALID → continue（拒收）。
- raw/adjusted 不混用：adjustment 恒 "raw"（types.ts:58），无 forward/backward 实际使用。

---

## 8. Feature Future Leakage：**PASS**

独立破坏性探针（对信号日 T 修改 T+1/T+2/T+3 的 close/high/low/volume/amount）：

- Feature(T) 不改变、Strategy Decision(T) 不改变、Approved Order(T) 不改变、T+1 Fill Entry 不改变——全部逐字段一致（独立探针「Future leakage」PASS）。
- 机理：`visibleBars`（series.ts:30-40）对 decisionPoint="close" 只含 `timestamp <= decisionDate` 的 bar，未来 bar 不可能进入窗口；`isCandidateLimitUpConfirmed` 强制 `snapshot.asOf.decisionDate === signalTime`（leaderCandidateBaseline.ts:123）。

---

## 9. Decision-time Leakage：**PASS**

- decisionPoint="open" 时 `visibleBars` 只含 `timestamp < decisionDate`（series.ts:35），当日 OHLCV 被整体排除。
- 生产组装点级回归（productionIntegration.test.ts:317-347）与独立推理一致：D1 open 决策改写 D1 全天 OHLCV 不改变决策/成交。测试通过。

---

## 10. Feature → Strategy：**PASS**

- 生产路径 `Router → db → production service → strategy engine → Feature Pipeline → Feature Snapshot → leader-candidate-baseline` 为真实调用（§2）。
- `featureMode="limit-up-confirm"` 来自正式生产 config（leaderCandidateStrategyBacktest.ts:47 `LEADER_CANDIDATE_PRODUCTION_FEATURE_MODE` + :70 `buildProductionLeaderCandidateStrategyConfig`），**非 default**（默认 "off"，leaderCandidateBaseline.ts:60）。
- 独立探针动态验证 Feature 真正改变生产决策：
  - Candidate A（limitUpHit=1）→ 被允许成交；B（not confirmed）→ 排除。
  - 仅改 B 的 Feature（B D1 close 10.20→11.00 涨停）→ B 从排除变为纳入，confirmedSymbols [A]→[A,B]。

---

## 11. Missing Feature Safety：**PASS**

- Feature Snapshot 整体 undefined + featureMode=limit-up-confirm → `emptyDecision(insufficientData=true)`、signals=[]（leaderCandidateBaseline.ts:165-169），**绝不 fallback 到 off**。
- 单个 symbol Feature INVALID/INSUFFICIENT → `isCandidateLimitUpConfirmed` 返回 false → 该 symbol 不产生交易（leaderCandidateBaseline.ts:120-126）。
- 生产级回归 TEST 6（productionIntegration.test.ts:239-258）覆盖；通过。

---

## 12. As-Of / Time Semantics：**PASS**

- Feature Snapshot.asOf 与 strategy signalTime 一致：strategyBacktest.ts:202 `createFeatureSnapshotBundle({ decisionDate: date, decisionPoint }, ...)`，signalProvider 同 date；`isCandidateLimitUpConfirmed` 校验 `decisionDate===signalTime && decisionPoint==="close"`（leaderCandidateBaseline.ts:123）。
- close strategy：T signal → 用 T close → T+1 execution（engine.ts:80-149，entryTime=T+1，探针确认 entryTime=D2）。
- open strategy：不能用 T close/high/low/volume/amount（series.ts:35 排除当日）。
- 无 Date.now/当前系统时间影响决策（grep 确认 engine/strategy/risk/features/data 零 Date.now/Math.random；唯一命中为 db.ts/cache.ts/marketSync/tushare 的 TTL 缓存与业务时间戳，与决策无关）。

---

## 13. Risk → Backtest → Execution：**PASS**

见 §4/§6。生产路径经过 buildDefaultRiskManager → runBacktest → NextOpenExecutionModel（T+1 open）→ Portfolio。动态探针确认 Risk 约束（maxPositions/lotSize/cash）在成交前生效。

---

## 14. Legacy Boundary：**PASS（P2 研究残留，见 §24 P2-2）**

`simulateRealisticTPlus1ToTPlus2` 调用方分类：

| 调用方 | 分类 |
|---|---|
| leaderCandidates.ts:1002（`?? simulateRealistic...` 兜底）| **生产路径被 runtime override 短路**（生产传 realisticSimulationOverride，此分支不执行）|
| downsideRisk.ts:603/630/669/670/760 | Research only（滚动窗口/消融/WFA 实验报表）|
| overfittingGuard.ts:231/269（默认 simulate 形参）| Research only（bootstrap/monkey benchmark）|
| paperTrading.ts:21（仅注释引用）| 注释（非调用）|
| *.test.ts | Test |

legacy 不会决定正式交易/信号/仓位/风控/修改正式 Portfolio/覆盖新引擎结果。**结论：生产主链不依赖 legacy 作为交易模拟引擎**。但生产请求内的研究报表段（buildDownsideRiskResearch + overfittingGuard 默认）仍执行 legacy 模拟（见 §24 P2-2）。

---

## 15. Backtest Semantic Compatibility（本次 FINAL 重点）：**P2（见 §24 P2-1）**

FIX-2 后生产 `realisticSimulation` 语义确已从旧 `simulateRealisticTPlus1ToTPlus2`（T+1 开盘买入 + 风险管理退出：止损/动态止盈/最多持有 N 日）变为引擎「T Signal → T+1 Open Buy → Risk 准入 → 持有至期末按市价估值」（leader-candidate-baseline 为 long-only，无 SELL）。

**独立动态探针证据**（三只候选全部涨停确认）：
```
trades: 3  completedCount: 0  winRate: null  winningTrades: 0
openPositionCount: 3  filledCount: 3
engine trades: 全 openAtEnd=true, netPnl=null
```

判定：
1. 这是**明确设计**而非 accidental regression —— FIX-2 报告 Known Issue #3（§20.3）显式声明了此语义变化。
2. API 字段名未变（completedCount/winRate/winningTrades/averageReturn/profitFactor 仍存在），但**类型 `RealisticBacktestResult` 未加注释说明新语义，前端标签也未更新**（字段名仍暗示「已实现/胜率」旧语义）。
3. totalReturn/maxDrawdown/equityCurve/trades 在新语义下定义一致且正确；completedCount/winRate 在新语义下退化（0/null）但「正确反映无平仓」。

按审计 §十四三档：介于「明确架构迁移但类型未反映」与「文档缺失」之间。因文档已记录（FIX-2）、主指标一致、非 accidental、非「严重失真」，判 **P2**（不判 P1）。**建议**：在 `RealisticBacktestResult` 类型与前端对 completedCount/winRate 补充「引擎买入持有至期末、无平仓 → 常为 0/null」的语义标注，或重命名/派生诚实字段，避免使用者误解。若审计方将「API 名称必须严格保持旧语义」视为硬约束，本项可升级 P1。

---

## 16. API Compatibility：**PASS（含 §24 P2-1 语义标注缺口）**

- `getLeaderCandidateBacktest` 输入参数兼容（backtestOptionsSchema 不变，routers.ts:1018-1022）。
- 输出结构兼容：`LeaderCandidateBacktestResult` / `RealisticBacktestResult` 顶层字段齐全（productionIntegration.test.ts TEST 9 断言 definition/observationDays/totalSamples/successCount/successRate/historicalRows/realisticSimulation/downsideRiskResearch/factorEvaluation/overfittingGuard/finalVerdict/dailyPriceCoverage 及 realisticSimulation 的 assumptions/initialCapital/finalCapital/netProfit/totalReturn/maxDrawdown/tradeCount/filledCount/completedCount/openPositionCount/equityCurve/trades 全在）。
- routers/db/frontend 仍正确消费 realisticSimulation/trades/equityCurve/completedCount/winRate/riskDecisions/signals/summary（前端主详情仅展示 totalReturn/maxDrawdown，语义一致）。
- **P3**：`riskDecisions` 读取用 `as unknown as` 断言（leaderCandidateStrategyBacktest.ts:246），为类型安全缺口（RA-012）。

---

## 17. Data Integrity：**CODE VERIFIED + RUNTIME BLOCKED**

- `stock_daily_prices` 唯一约束 `(stockCode, tradeDate)`：
  - migration `drizzle/0008_peaceful_king_bedlam.sql:1` `ADD CONSTRAINT uq_stock_daily_price_stock_date UNIQUE(stockCode, tradeDate)`；
  - schema `drizzle/schema.ts:94` `uniqueIndex("uq_stock_daily_price_stock_date").on(stockCode, tradeDate)`。
- **CODE VERIFIED**。**RUNTIME BLOCKED**：本环境无真实 DB，无法确认迁移 0008 是否已部署生效。**不判为 PASS**。
- 生产写入路径正确：`stockPriceSync.ts:79-142` `toValidatedStockDailyPriceUpserts` = `toCanonicalBar` + `validateMarketBar`（INVALID/UNPERSISTABLE 拒写、WARNING 留痕、缺失写 DB null 而非 "undefined"/"null"）。4 处同步入口（syncCandidateDailyPrices / ForDate / ForDateRange / ForUpload）均走此校验。
- **P2-3**：`scripts/backfill_high_volume.ts:34-47` 绕过 canonical，直接 `String(price.x)`，可把 null/undefined 写成 "null"/"undefined" 字面量（一次性存量回填脚本，非生产写入路径）。

---

## 18. Determinism：**PASS**

- 独立探针：同一 Data/Config/asOf 连续 100 次运行，Signal/Decision/Order/Fill/Trade/Equity/Performance 深度全等 ✓。
- 代码：engine/strategy/risk/features/data 无 Date.now/Math.random/随机 UUID（grep 确认）。

---

## 19. Instance Isolation：**PASS**

- 连续 Run A / Run B（不同 Config/Data/Feature）互不影响：engine 每次 `new Portfolio`（engine.ts:64）；strategyBacktest 的 viewCache/featureCache 为函数内局部缓存（strategyBacktest.ts:168-172）。
- 模块级 mutable state：strategyRegistry/featureRegistry 为单例，但只存工厂定义（幂等注册、无计算状态）；无 cache leakage / registry mutation / 跨实例 Feature cache。

---

## 20. Golden Pipeline：**PASS（独立动态验证）**

独立探针驱动真实生产服务（`runLeaderCandidateEngineProbe` → `runStrategyEngineBacktest`）跑完整链，逐层验证：

- Feature 改变 → Strategy Decision 改变（confirmedSymbols [A]→[A,B]）✓
- Signal 数量改变 → 最终成交改变（trades [A]→[A,B]）✓
- 未来数据改变 → T 决策不改变 ✓
- 各层结果（canonical→validation→feature→strategy→sizer/risk→core→execution→portfolio→performance→API）真实产出且一致 ✓

---

## 21. Regression

| 命令 | 结果 |
|---|---|
| `npm test` | **509 passed / 15 failed（6 files）**，与历史基线（FIX-2 报告 §15）**逐一同构，无代码回归** |
| `npm run check`（tsc --noEmit）| exit 0 |
| `npm run build`（vite + esbuild）| 成功（2846 模块，dist/index.js 产出）|

15 failed 分类（全部 ENVIRONMENTAL，非 CODE REGRESSION）：

| 文件 | 条数 | 环境原因 |
|---|---|---|
| server/marketData.test.ts | 4 | 依赖真实 MySQL/TiDB（无库）|
| server/limitUp.watch.test.ts | 4 | 依赖真实 DB |
| server/limitUp.test.ts | 1 | 依赖真实 DB |
| server/tushare.secret.test.ts | 1 | 缺 TUSHARE_TOKEN |
| server/tushareTradingCalendar.test.ts | 3 | Tushare 网络超时/密钥受限 |
| server/stockPriceSyncPage.test.ts | 2 | client/src/pages/StockPriceSync.tsx 页面未开发 |

Step2（engine 29 + fix 16）、Step3（contract 10 + registry 6 + leaderCandidateBaseline 10 + strategyBacktest 6）、Step4（risk 35 + fix 15）、Step5（features golden/pipeline 等）、productionIntegration（10）、quant-stats（86）全部通过。

---

## 22. P0 Issues

**无。**

---

## 23. P1 Issues

**无。**

（§15 回测语义兼容经评估判 P2 而非 P1，理由见 §15：明确设计 + 文档已记录 + 主指标一致 + 非 accidental + 非严重失真；若按「API 名称严格保持旧语义」硬约束可升级。）

---

## 24. P2 Issues

**P2-1 — 回测语义兼容缺口（本次重点）**
- Issue：生产 `realisticSimulation` 由 legacy「买入+风险管理退出」变为引擎「买入+持有至期末估值」，completedCount≈0、winRate=null、winningTrades=0。
- Evidence：`leaderCandidateStrategyBacktest.ts:249/274/283`；独立探针 `completedCount:0 winRate:null winningTrades:0 全 openAtEnd=true`；`engine/portfolio.ts:243-266` finalizeOpenTrades 无平仓。
- Root Cause：leader-candidate-baseline 为 long-only 无 SELL 信号；引擎最小模型无退出状态机。
- Required Fix：在 `RealisticBacktestResult` 类型 + 前端对 completedCount/winRate/winningTrades/averageReturn/profitFactor 标注「买入持有至期末估值、常为 0/null」语义，或重命名/派生诚实字段。
- Verification：前端标签检查 + 类型注释 diff 核对。

**P2-2 — 生产请求内研究报表段仍执行 legacy 模拟**
- Issue：`buildLeaderCandidateBacktest` 内 `buildDownsideRiskResearch`（leaderCandidates.ts:1009）与 `overfittingGuard` 默认参数仍调 `simulateRealisticTPlus1ToTPlus2`（downsideRisk.ts:603/630/669/670/760）。
- Evidence：见 §14 调用方分类。
- Root Cause：FIX-2 只替换了顶层 realisticSimulation，研究实验的模拟段未引擎化（FIX-2 已知问题 #1 / RA-011）。
- Required Fix：将风险研究各实验的模拟段也切换为引擎（会改 Step-4 邻近研究语义，需独立评估）。
- Verification：grep 生产请求内 legacy 调用方是否为 0。

**P2-3 — 存量回填脚本绕过 canonical 校验**
- Issue：`scripts/backfill_high_volume.ts:34-47` 直接 `String(price.x)` 写库，可产 "null"/"undefined" 字面量。
- Evidence：脚本源码，无 toCanonicalBar/validateMarketBar 调用。
- Root Cause：一次性脚本未接入 Step5 数据质量层（FIX-2 RA-003）。
- Required Fix：复用 `toValidatedStockDailyPriceUpserts`。
- Verification：脚本 diff 核对。

**P2-4 — DB 唯一约束 runtime 未验证**
- Issue：`(stockCode, tradeDate)` 唯一约束 CODE VERIFIED 但 RUNTIME BLOCKED。
- Evidence：migration 0008 + schema.ts:94；本环境无 DB。
- Required Fix：部署环境执行迁移 0008 后 `SHOW INDEX`/插入重复行核对。
- Verification：真实 DB 探测。

---

## 25. P3 Issues

- **P3-1**：生产未注入具名 PositionSizer（sizer 可选，退化为 fixed 100 股名义数量；engine.ts:114）。
- **P3-2**：NextOpenExecutionModel 默认 LimitRules 固定 10%、blockLimitUpBuy/Down 默认 false，生产未注入 resolveLimitRules（成交路径涨停拦截未启用；Feature 路径已用 boardRules）。
- **P3-3**：maxDrawdown 4 处重复实现（research/legacy），生产用 engine 权威版。
- **P3-4**：`adaptEngineResultToRealisticBacktestResult` 用 `as unknown as` 读 riskDecisions（RA-012）。
- **P3-5**：`qualityIssueCount` 在 runStrategyEngineBacktest 计算后 `void` 丢弃（strategyBacktest.ts:141），INVALID 拒收无日志上报。
- **P3-6**：`generatedAt:"deterministic"`（engine.ts:171）为占位字符串。
- **P3-7**：`minCommission:5` 在生产 Adapter 硬编码（leaderCandidateStrategyBacktest.ts:222，与 DEFAULT_COST_MODEL 一致但非单一来源）。

---

## 26. Final Decision

依据 §24-25 证据与本审计独立动态探针：

- P0 = 0
- P1 = 0
- Step1 = PASS
- Step2 = PASS
- Step3 = PASS
- Step4 = PASS
- Step5 = PASS
- Cross-Stage = PASS

**FINAL = PASS**（附 4 P2 / 7 P3 记录，不阻塞；其中 P2-1 为回测语义兼容的文档/类型标注缺口，建议优先处理）。

本结论仅由本次独立审计的证据（源码逐层溯源 + 全仓 grep + 独立 tsx 动态探针 + 全量回归）决定，不继承任何历史 PASS 声明。未修改任何生产代码/测试/migration/配置。
