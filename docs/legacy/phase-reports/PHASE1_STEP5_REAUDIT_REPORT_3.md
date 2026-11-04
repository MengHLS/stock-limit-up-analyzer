# STEP 5 INDEPENDENT RE-AUDIT REPORT — ROUND 3 (AFTER FIX-2)

- 审计对象：`stock-limit-up-analyzer` 工作区（FIX-2 之后状态）
- 审计日期：2026-09-05
- 审计方式：完全独立（Quant System Auditor）。未修改任何生产代码 / 测试 / migration / 配置。未 commit / push。
- 目标：验证 STEP 5-FIX-2 DEVELOPMENT REPORT 对 RA-001（P1-F1）与 RA-002（P1-F2）的修复是否真实、可溯源、无回归；并执行 Step2/3/4 回归与破坏性 Future Leakage 验证。
- 证据原则：不采信开发报告声明，全部经源码审计 + grep 溯源 + 独立动态探针交叉验证。

---

## 1. Architecture

FIX-2 后真实存在三层生产入口（源码逐层 grep 可溯源）：

```
client/src/pages/Backtest.tsx:354  & LeaderCandidates.tsx:59
  └─ trpc.sentiment.getLeaderCandidateBacktest.useQuery(...)
       └─ server/routers.ts:1018-1023  getLeaderCandidateBacktest: publicProcedure
            └─ server/routers.ts:1031  saveBacktestRun: protectedProcedure
                 └─ db.getLeaderCandidateBacktest (import 自 "./db", routers.ts:73)
                      └─ server/db.ts:1821-1830  getLeaderCandidateBacktest
                           ├─ loadBacktestBaseContext() (db.ts:1769): records + rawRows + context
                           └─ runLeaderCandidateStrategyBacktest (db.ts:1826)
                                └─ server/leaderCandidateStrategyBacktest.ts:306
                                     ├─ runLeaderCandidateEngineProbe (:312 → :191-229)
                                     │    └─ runStrategyEngineBacktest (:203) ← 生产唯一非测试调用方
                                     │         ├─ toCanonicalBar / validateMarketBar (INVALID 拒收)
                                     │         ├─ runFeaturePipeline(decisionDate, decisionPoint="close")
                                     │         ├─ createFeatureSnapshotBundle
                                     │         ├─ buildStrategySignalProvider({buildFeatures}) (:216-224)
                                     │         ├─ leader-candidate-baseline.evaluate() (featureMode="limit-up-confirm")
                                     │         ├─ runBacktestWithRisk → PositionSizer → RiskManager → Core (:254)
                                     │         └─ decisionLog（只读观测，不参与决策）
                                     └─ buildLeaderCandidateBacktest(…, {realisticSimulationOverride}) (:314)
                                          └─ realisticSimulation = override ?? simulateRealisticTPlus1ToTPlus2 (leaderCandidates.ts:1001-1007)
```

调用方统计（grep，非 *.test.ts）：

| 函数 | 非测试调用方 | 测试调用方 |
|---|---|---|
| `runStrategyEngineBacktest` | `leaderCandidateStrategyBacktest.ts:203`（生产服务） | productionIntegration / strategyBacktest.test |
| `runLeaderCandidateStrategyBacktest` | `db.ts:1826`（生产 DB/Service 层） | productionIntegration.test |
| `runLeaderCandidateEngineProbe` | `leaderCandidateStrategyBacktest.ts:312`（生产服务内部） | productionIntegration.test |
| `db.getLeaderCandidateBacktest` | `routers.ts:1021 / 1031`（trpc 公开/受保护 procedure） | — |
| `buildLeaderCandidateBacktest` | `leaderCandidateStrategyBacktest.ts:314`（override 路径） | 各既有测试（无 override → 默认 legacy 分支） |

结论：FIX-1 时期「runStrategyEngineBacktest 唯一调用方是测试」的孤儿状态已被消除。生产链路 Router → db → Service → Engine 逐层真实可溯源。

**新发现事实**：`runStrategyEngineBacktest` 现在有**唯一的非测试调用方**（leaderCandidateStrategyBacktest.ts:203），且该调用方本身又有唯一生产调用方（db.ts:1826），db 层由 routers 直接调用。整链非测试、非研究，是真实生产执行入口。

## 2. Canonical Market Data

无新增改动（FIX-1 已审）。FIX-2 生产链继续经 `server/data/adapter.ts` `toCanonicalBar` 将 DB 行（LeaderCandidateDailyPriceRow 字段为 RawDailyPriceRow 兼容子集，db.ts loadStockDailyPriceRows 查询列与 adapter 形状一致）归一化为 CanonicalMarketBar。单位链不变：price 元/股、volume 手、amount 千元、turnoverRate 不伪造（null）。`toEngineMarketBar` 降级为 Core MarketBar（date/open/high/low/close/prevClose/amount），不携带 volume/turnoverRate/adjustment。

## 3. Data Adapter

生产 rawRows 来源为 `loadStockDailyPriceRows()`（db.ts:1051）：直接 select `stock_daily_prices` 列，类型与 `RawDailyPriceRow` 完全兼容（open/close 必选可空、其余可选）。`runStrategyEngineBacktest` 对每行执行 `toCanonicalBar`。无任何 Raw→String→DB / Raw→Core 的直通路径新增。

## 4. Data Validation

`validateMarketBar` 在引擎入口对每根 canonical bar 执行；INVALID 行计数后跳过（strategyBacktest.ts:131-135），不进入特征/回测。9 类缺陷测试（data.test.ts 等）与 FIX-1 审计结论一致。生产链 validation 接入位置真实存在于引擎入口（非仅测试）。

## 5. Time-aware Access

`runFeaturePipeline`（snapshotOfSymbol, strategyBacktest.ts:184-194）只接收 `bars` + `decisionDate`，可见窗口由 pipeline 的 asOf 过滤保证。`buildStrategySignalProvider` 的 `buildFeatures: (date) => featuresOfDate(date)` 与 signalTime 严格同 date。无新增时间语义改动。

## 6. As-Of / Availability

新增 `tradingDates` 显式日历（strategyBacktest.ts:147-151）：`显式日历 ∪ 行情日期`，升序并按 start/end 过滤。目的（报告声称）为 T+1 成交不因日历缺位漏成交。独立探针用「日历 D0..D5 ⊃ 行情截止日」验证：信号只在存在候选的 D1/D4 产生；成交只在 T+1（D2/D5）发生；无行情日无虚假信号/成交。生产默认 `decisionPoint="close"`，`isCandidateLimitUpConfirmed` 强制 `snapshot.asOf.decisionDate === signalTime && decisionPoint === "close"`。

## 7. Feature Contract

无改动（FIX-1 已审 PASS）。本次回归确认 registry/basic 测试全绿。

## 8. Feature Registry

无改动（FIX-1 已审 PASS）。本次回归确认 registry 测试全绿。

## 9. Feature Pipeline

`runFeaturePipeline` 的非测试调用方：`strategyBacktest.ts:186`（snapshotOfSymbol，被 featuresOfDate 调用，featuresOfDate 被 buildFeatures 闭包引用，buildFeatures 注入 buildStrategySignalProvider 供生产引擎在真实回测中调用）。**注意**：runFeaturePipeline 仍无「函数级」非测试直接调用方——它的生产调用是经 featuresOfDate → buildFeatures 闭包 → provider 这一链（全部位于非测试生产代码 strategyBacktest.ts 内，且该文件现在被生产服务调用）。这与 FIX-1 时期的差异是决定性的：当时 strategyBacktest.ts 本身是孤儿（无调用方），现在它处在生产入口路径上。

## 10. Feature Snapshot

`createFeatureSnapshotBundle` 被 strategyBacktest.ts:202 调用（featuresOfDate），全部 snapshot 同 (decisionDate=date, decisionPoint)。bundle 按候选 symbol 组织，经 StrategyContext.features 到达策略。无读写混用（只读消费）。

## 11. Warm-up

无改动。limitUpHit requiredBars=1；缺失 → INSUFFICIENT。本次 Missing-Feature 动态验证：删除候选信号日行 → limitUpHit 不可 READY → 候选被排除，不 silent-fallback（详见 §13/§17）。

## 12. Future Leakage

**底层探针（FIX-1，68 断言）仍通过**（features 相关测试全绿）。本轮新增**生产服务/引擎层独立对抗探针**（临时文件，审计后已删除；不依赖 productionIntegration.test 的 helper）：

- Sub A：两个信号日（D1/D4）+ 显式日历 D0..D5（日历 ⊃ 部分行情截止 D3）；扰动 D2..D5 全部 close/high/low/volume/amount（保持 open/preClose）→ **A@D1 决策日志逐条一致、A 仍被确认、A 成交入口（D2/entryPrice/quantity）一致**。
- Sub B：仅扰动 D5（对 D1 与 D4 决策均为未来）→ **decisionLog 逐条一致、confirmedSymbols 一致、成交入口一致**。
- 探针设计陷阱澄清：初版把 D4（X 的真实信号日）一并扰动，X close 被抬到 13.7 后因 `isLimitUpBar` 要求 close 恰好等于涨停价而「不再确认」——这是物理失真导致 X 决策合法变化，**不是未来渗漏**；修正为 Sub A/B 分离后全部通过。productionIntegration TEST 5 只扰动单一信号日的未来日，语义一致且通过。

## 13. Decision-time Leakage

productionIntegration.test 「Decision-time Regression」：decisionPoint="open" 时改写 D1 全天 OHLCV 为极端值（收盘 11.00→50.00）→ decisionLog/trades/confirmedSymbols 与常规完全一致，证明 D1 open 决策不可见 D1 当日 bar。独立探针同时确认生产默认（close 决策）成交日 D2/D5 ≠ 决策日 D1/D4。生产请求内无 signalTime/asOf 与特征时点错配路径。

## 14. Feature Mathematics

无改动。Feature 计算复用 shared/quant-stats（mean/sampleStandardDeviation）。本次未发现 FIX-2 引入的第二套统计实现。

## 15. Limit-Up Rules

无改动。`isLimitUpBar`/boardRules 权威实现沿用（FIX-1 板块动态表已 PASS）。FIX-2 未引入新涨跌停近似。生产特征集 limitUpHit 依赖 isLimitUpBar（ST 名称由 records 提供 stockName，经 buildLeaderCandidatesForDate 视图传入）。

## 16. Adjustment Handling

无改动。toCanonicalBar 恒 `adjustment: "raw"`，limitUpHit 基于 raw preClose/close 判定，无复权价格参与真实涨停判断。

## 17. Strategy Integration（RA-002 核心）

源码链：生产配置 `buildProductionLeaderCandidateStrategyConfig`（leaderCandidateStrategyBacktest.ts:65-72）返回 `{ minScore, maxSignals:5, featureMode:"limit-up-confirm" }`，常量 `LEADER_CANDIDATE_PRODUCTION_FEATURE_MODE = "limit-up-confirm"`（:47）。配置注入 runStrategyEngineBacktest options.strategyConfig（:199,:208）→ buildStrategySignalProvider options.config（strategyBacktest.ts:220）→ registry.evaluate normalizeConfig（保留 confirm，leaderCandidateBaseline.ts:151-154）→ evaluate 的 `featureGateEnabled = config.featureMode === "limit-up-confirm"`（:164）→ `isCandidateLimitUpConfirmed(features!, signalTime, candidate)`（:177）。

**关键审计点：这是生产值而非默认值路径。** 策略 defaultConfig.featureMode = "off"（:60），但生产配置显式传入 "limit-up-confirm"，不依赖默认值；normalizeConfig 只接受字面量 "limit-up-confirm" 否则落回 off——生产常量正是该字面量。非测试文件中传入 "limit-up-confirm" 的位置：leaderCandidateStrategyBacktest.ts:47/70（全仓唯一非测试注入点）。此前的「featureMode 仅测试开 confirm」问题已消除。

Feature 决策影响动态证明（不采信报告）：
- 独立探针（双信号日 6 候选）：仅价格库确认涨停的 A/X 进入 decisionLog/成交；同池未确认的 4 只（U1-U4）绝不成交。
- productionIntegration TEST 4：仅改 B 的 D1 收盘 10.20→11.00 → B 从排除变为纳入成交（confirmedSymbols [A]→[A,B]，decisionLog 1→2）。
- Missing-Feature：删除候选信号日价格行 → 被排除；策略层 features=undefined + confirm → `emptyDecision(insufficientData=true)`、signals=[]（TEST 6 直断）。**无静默降级到 off**。

## 18. P1-F1 Verification（RA-001）— RESOLVED

源码 + grep 溯源证据见 §1。关键判定变化：

1. `runStrategyEngineBacktest` 非测试真实调用方存在（leaderCandidateStrategyBacktest.ts:203）✓
2. `runLeaderCandidateStrategyBacktest` 非测试调用方存在（db.ts:1826）✓
3. `db.getLeaderCandidateBacktest` 由 routers trpc procedure 调用（routers.ts:1021/1031）✓
4. 前端真实 useQuery 该 procedure（Backtest.tsx:354 / LeaderCandidates.tsx:59）✓
5. 主模拟段 legacy 短路：`realisticSimulation = runtime.realisticSimulationOverride ?? simulateRealisticTPlus1ToTPlus2(...)`（leaderCandidates.ts:1001-1007）。生产服务总传 override → 正式主链不再执行 legacy 模拟器。动态证据：生产服务 trades 只含被 Feature 确认的候选（若 override 未生效，legacy 模拟器会按候选池纳入未确认的 U1-U4）。✓
6. FeatureSnapshot 进入 StrategyContext：buildFeatures 闭包 → provider → registry.evaluate(..., features)。✓

**残余（不推翻主链修复，见 §38 RA-011）**：一次正式生产请求内，研究报表段 `downsideRiskResearch`（leaderCandidates.ts:1009 → buildDownsideRiskResearch）的滚动窗口/fullCycle/factor-ablation 实验仍内部调用 `simulateRealisticTPlus1ToTPlus2`（downsideRisk.ts buildExperiments/buildExperimentsWithWindowWeights/buildFactorAblations 中多次调用）。该段与 Feature→Strategy→决策→Order 主链无关（纯研究字段），但严格意义上生产请求内仍有 legacy 模拟执行，且研究字段与引擎产出的 realisticSimulation 口径不同源。

## 19. P1-F2 Verification（RA-002）— RESOLVED

判定依据（全部源码 + 动态）：
1. 生产 featureMode 值为 "limit-up-confirm"（非默认、非测试）——见 §17。
2. 策略在 confirm 下真实读取 context.features 并经 isCandidateLimitUpConfirmed 过滤。
3. Feature 改变生产决策：TEST 4 + 独立探针（§17）。
4. Feature 缺失不静默降级：整体缺失 → insufficientData=true/空决策；逐 symbol 不可判定 → 该候选被排除（TEST 6）。
5. asOf 不匹配 → 候选排除（isCandidateLimitUpConfirmed :123 gate；既有 leaderCandidateBaseline.test 覆盖）。

## 20. P1-F3 Verification — 维持 RESOLVED（无新增绕过）

FIX-2 未触碰 stockPriceSync/写库路径。4 条生产同步路径经 Adapter+Validation（FIX-1 已验）。新生产读路径（loadStockDailyPriceRows）只读，不新增写库。`scripts/backfill_high_volume.ts` 绕过 canonical 的历史问题仍存在（见 §38 RA-003，FIX-2 未处理，已在报告声明范围内）。

## 21. P1-F4 Verification — 维持 RESOLVED

FIX-2 未在 realisticBacktest/paperTrading/Feature/Strategy 层引入 1.099/0.901 执行残留。生产引擎成交价由 Core（next-open, T+1）决定。涨跌停判断唯一权威为 boardRules。

## 22. P2-F1 Verification — 维持 RESOLVED

无重复数值解析函数新增。leaderCandidateStrategyBacktest.ts 全程不重复实现解析（委托 canonical 层）。

## 23. P2-F2 Verification — 维持 RESOLVED

ST 识别规则无改动。生产 Feature 的 ST 判定经 isLimitUpBar（stockName 来自 records 的 buildLeaderCandidatesForDate 视图）。风险提示：rawRows（价格行）不含 stockName，引擎内 limitUpHit 的 ST 判定依赖 view 侧 stockName——若 records 名称与价格行所属标的不一致（如更名），ST 判定跟随 records 名称。既有语义与 limit_up_records 口径一致，未发现新问题。

## 24. P2-F3 Verification — 维持 CODE VERIFIED / RUNTIME BLOCKED

唯一约束迁移 0008 与 runtime fallback 无改动。本环境无 MySQL/TiDB，运行期唯一约束仍无法实测（RA-009）。与上一轮结论一致。

## 25. Step2 Regression — PASS

`server/engine` 全量测试通过（engine.test.ts 29 + engine.fix.test.ts 16 等）。Execution/Portfolio/Trade/Equity/Performance/maxPositions/maxPositionAmountRatio/lotSize 断言全部通过。生产入口固定走 runBacktestWithRisk，未绕过 Core。独立探针确认 lotSize=100 名义请求 → 实际整手成交于 D2/D5 open。

## 26. Step3 Regression — PASS

`server/strategy` 全部通过（contract 10、registry 6、leaderCandidateBaseline 11、strategyBacktest 6、productionIntegration 10）。Strategy Contract/Registry/Signal/Determinism/Isolation 无回归。Feature 输入契约变化未破坏既有调用方（registry.evaluate config 缺省默认 off 保持旧语义）。

## 27. Step4 Regression — PASS

`server/risk` 全部通过（risk.test.ts 35 + risk.fix.test.ts 15）。productionIntegration TEST 8 复验：maxPositions=1 → 3 BUY 意图仅 1 成交；lotSize=200 → 非整手 0 成交；cash<1 手 → 0 成交且 finalPortfolio.cash ≤ 900。Risk 未被 Feature 耦合出新逻辑。

## 28. Determinism — PASS

productionIntegration TEST 7：同 Data/Config/asOf 引擎 100 次深度相等 + 服务 2 次相等。独立探针服务 2 次 JSON 深等。新代码无 Date.now/Math.random/模块级可变状态（仅函数内 viewCache/featureCache）。db.ts 的 Date.now 仅 TTL 缓存失效用，与决策无关（FIX-1 既有）。

## 29. Instance Isolation — PASS

strategyBacktest.ts 内缓存（viewCache/featureCache/barsBySymbol）全部函数局部，每次 runStrategyEngineBacktest 独立。无模块级注册副作用（registerBuiltInStrategies 幂等）。

## 30. Golden Pipeline — PASS

真实生产策略（leader-candidate-baseline，非 featureProbeStrategy）经完整链路：Raw→Canonical→Validation→Feature→Snapshot→Strategy(featureMode=confirm)→Signal→PositionSizer→RiskManager→Approved Order→Backtest Core→T+1 Execution→Portfolio/Equity→Engine Adapter→RealisticBacktestResult→LeaderCandidateBacktestResult。动态证据：独立探针 23/23 + productionIntegration 10/10，成交只在被 Feature 确认的候选、成交日在 T+1、riskDecisions 真实记录（engine.ts:187 注入）。

## 31. Static Audit — PASS

新文件（leaderCandidateStrategyBacktest.ts、productionIntegration.test.ts）与改动文件（strategyBacktest.ts、leaderCandidates.ts、db.ts 相关段）扫描：无 `: any` / `as any` / `@ts-ignore` / `@ts-expect-error` / Date.now / Math.random / fetch / axios / prisma / supabase / 写库 / portfolio.buy / portfolio.sell / createOrder / createFill。唯一观察：leaderCandidateStrategyBacktest.ts:246 用 `as unknown as` 读取 engine 运行时注入的 riskDecisions（engine.ts:187 同款既有模式，非 any，见 §38 RA-012）。

## 32. npm test — 509 passed / 15 failed（与 FIX-2 报告一致）

全量 vitest：`Test Files 47 passed | 6 failed (53)`，`Tests 509 passed | 15 failed (524)`。15 条失败文件与上一轮基线**逐一相同**：marketData.test.ts(4)、limitUp.watch.test.ts(4)、limitUp.test.ts(1)、tushare.secret.test.ts(1)、tushareTradingCalendar.test.ts(3)、stockPriceSyncPage.test.ts(2)。堆栈抽查（marketData: "expected undefined to be '2026-01-10'"——插入后查询返回空，DB 缺失型失败）确认环境失败，非代码回归。净增量 = 499→509（productionIntegration 10 条），无删除既有测试（时间线核对：既有测试文件均 FIX-1 时段修改，FIX-2 仅新增文件）。

## 33. typecheck — PASS

`npx tsc --noEmit` exit 0。

## 34. build — PASS

`npm run build` exit 0（✓ built in 12.52s，dist/index.js 482.0kb，仅既有 chunk 体积提示）。

## 35. lint — N/A

package.json 无 lint 脚本（同前两轮）。

## 36. P0 — 0

无未来数据进入决策、无 Decision-time 泄漏、无 Feature 直接交易、无生产路径时间语义破坏。破坏性 Future Leakage 探针（服务层 Sub A/B + 底层 68 断言 + TEST 5）全部通过。

## 37. P1 — 0

- RA-001（P1-F1）RESOLVED（§18）
- RA-002（P1-F2）RESOLVED（§19）
- P1-F3 / P1-F4 / P2-F1 / P2-F2 / P2-F3：维持 RESOLVED（§20-24）
- Step2/3/4 Regression：PASS（§25-27）

## 38. P2 — 4（含既有未处理项）

| ID | 位置 | 描述 |
|---|---|---|
| RA-011（新增） | leaderCandidates.ts:1009 → downsideRisk.ts buildExperiments/buildExperimentsWithWindowWeights/buildFactorAblations | 正式生产请求内研究报表段（downsideRiskResearch 滚动/fullCycle/factor-ablation）仍多次调用 legacy `simulateRealisticTPlus1ToTPlus2`；研究字段与引擎 realisticSimulation 口径不同源。不影响 Feature→决策→Order 主链，但「生产请求零 legacy 执行」未达成。建议后续将研究实验模拟引擎化，或在字段上明确标注 legacy 口径。 |
| RA-003（既有） | scripts/backfill_high_volume.ts | Raw→String→DB 绕过 canonical（FIX-2 未处理，报告已声明）。 |
| RA-004（既有） | ensureStockDailyPricesUniqueIndex | DDL 失败仅告警继续 upsert（FIX-2 未处理）。 |
| RA-009（既有） | 唯一约束运行期 | 本环境无 DB，仅 CODE VERIFIED（FIX-2 未处理）。 |

## 39. P3 — 5（含既有未处理项）

| ID | 位置 | 描述 |
|---|---|---|
| RA-012（新增） | leaderCandidateStrategyBacktest.ts:246 | `as unknown as` 读 engine 运行时 riskDecisions（engine.ts:187 既有注入模式）；建议 BacktestResult 类型显式声明 riskDecisions 而非运行时注入。 |
| RA-013（新增） | leaderCandidateBaseline.ts evaluate | 逐 symbol Feature INSUFFICIENT → 候选被排除但决策 `insufficientData=false`；仅 features 整体缺失时为 true。状态表达不统一，语义仍安全（不静默买入）。 |
| RA-014（新增） | db.ts:1051 loadStockDailyPriceRows | 全表拉取无分页/时间窗，context TTL 过期后每次全量内存解析；性能风险，功能正确。 |
| RA-005~008/010（既有） | 见 ROUND-2 报告 | boardRules 头注释过时 / schema 冗余索引 / snapshot 只读仅类型层 / limitUpPrice tick / NextOpen 默认 10%。FIX-2 未处理。 |

## 40. FINAL — PASS

**判定范围**：本次为 FIX-2 后第三次独立 Re-audit，判定对象是 RA-001/RA-002 阻塞项的修复质量及是否引入新回归。

通过条件逐项核对：

- P0 = 0 ✓
- P1 = 0 ✓（RA-001 / RA-002 均经源码 + 动态证据消除；无新 P1）
- Future Leakage 全部通过 ✓（服务层破坏性探针 + 底层测试）
- Canonical / Adapter / Validation 真正进入生产 ✓（生产引擎入口强制执行，INVALID 拒收）
- Time-aware / As-Of 正确 ✓（productionIntegration Decision-time Regression + isCandidateLimitUpConfirmed asOf gate + 独立探针）
- Feature Pipeline 真正进入生产 ✓（routers→db→service→engine 真实链路）
- Production Strategy 真正消费 Feature ✓（生产常量 confirm + evaluate 真实读 context.features + Feature 改变生产决策的动态证明）
- Warm-up / Limit-Up Rules / Adjustment / Registry / Snapshot 正确 ✓（维持 + 回归）
- Determinism PASS ✓ / Isolation PASS ✓ / Golden Pipeline PASS ✓（真实生产策略到 Approved Order）
- Step2 Regression PASS ✓ / Step3 Regression PASS ✓ / Step4 Regression PASS ✓
- typecheck PASS ✓ / build PASS ✓ / npm test 无新增 CODE REGRESSION ✓（509/15，15 条环境失败与基线逐一相同）

FINAL = **PASS**

**残余声明（不推翻 PASS，供下一工作项）**：
1. RA-011（P2）：生产请求内研究报表段仍执行 legacy 模拟器，且研究字段口径与引擎 realisticSimulation 不同源——若产品要求「生产请求内零 legacy」，需独立工作项将 downsideRisk 实验段引擎化或标注 legacy。
2. RA-003/RA-004/RA-009（P2）与 RA-005~008/010/012~014（P3）未在本轮范围处理。
3. 本环境无真实 DB：db.getLeaderCandidateBacktest 的 DB 加载段（records/rawRows）未在 CI 运行时直连验证（测试驱动同一代码路径的 production service，测试文件头已注明）；RUNTIME DB VERIFICATION BLOCKED BY ENVIRONMENT，不判自动 PASS，需在部署环境执行一次真实 router 请求复核。

---

*本报告由独立审计产生；审计期间创建的临时探针文件（_audit_fix2_probe.mts、_probe_dbg*.mts）已删除，未修改任何生产代码/测试/配置。*
