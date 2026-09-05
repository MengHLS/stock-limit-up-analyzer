# STEP 5-FIX-2 DEVELOPMENT REPORT

> 范围：修复 Step 5 第二次独立 Re-audit 的 **RA-001（P1-F1）** 与 **RA-002（P1-F2）** 两个阻塞项。
> 任务定义：把已经验收的新链路（Canonical → Validation → Feature → Snapshot → Strategy → Sizer → Risk → Backtest Core）接入**真实生产入口**，并在生产配置显式启用 `featureMode="limit-up-confirm"`。
> 遵守：不重新设计 Step 1-4、不删 legacy realisticBacktest、不改已有 Risk/Sizing/Core 语义、不用 `any`/`as any`/`@ts-ignore`/`@ts-expect-error`、不在 Feature/Strategy/Risk 引入 DB/网络/Portfolio 变更、不建第二套 Feature/Risk/Backtest、不改既有测试期望。

---

# 1. Root Causes Fixed

## RA-001（P1-F1）：Feature Pipeline / Strategy Engine 未进入生产执行链路

**根因**：前一轮修复产出的生产组装点 `runStrategyEngineBacktest`（server/strategy/strategyBacktest.ts）虽然是纯生产代码，但**全仓非测试调用方为 0**——只有测试文件调用它。正式生产入口 `routers.sentiment.getLeaderCandidateBacktest` → `db.getLeaderCandidateBacktest` → `buildLeaderCandidateBacktest` 直接产出报表（其中交易模拟段由 legacy `simulateRealisticTPlus1ToTPlus2` 完成），整条链路从未经过 Feature Pipeline / Strategy Engine / Position Sizer / Risk Manager / Backtest Core。

**修复**：
1. 新增**正式生产服务** `server/leaderCandidateStrategyBacktest.ts`：
   - `runLeaderCandidateStrategyBacktest(records, rawRows, context, options)` —— 调用 `runStrategyEngineBacktest` 跑完整新链路（canonical → validate → `runFeaturePipeline` → `FeatureSnapshotBundle` → `buildStrategySignalProvider({buildFeatures})` → PositionSizer/RiskManager → `runBacktestWithRisk`），再把引擎结果经 **Result Adapter** 映射为既有 `RealisticBacktestResult` 形状；
   - 用该引擎模拟结果作为 `buildLeaderCandidateBacktest(records, options, context, { realisticSimulationOverride })` 的显式覆盖（`server/leaderCandidates.ts` 新增第 4 个可选 runtime 参数；传入时顶层 `realisticSimulation` 不再调用 legacy 模拟器），研究性报表字段（延续率/校准/风险研究/因子评估等）保持既有形状与前端兼容。
2. `server/db.ts`：`getLeaderCandidateBacktest` 改为先加载 `records + rawRows + context`，然后调用上述生产服务。Router 调用链保持不变：
   `routers.ts (query/mutation) → db.getLeaderCandidateBacktest → runLeaderCandidateStrategyBacktest → runStrategyEngineBacktest → … → runBacktestWithRisk`。
3. `runStrategyEngineBacktest` 增加：可选显式交易日历 `tradingDates`（与行情日期取并集，保证 T+1 成交不因日历缺位漏成交）、只读观测 `decisionLog`（策略真实输出的逐日信号日志，用于生产可审计与集成测试断言，不参与决策）。

## RA-002（P1-F2）：Production Strategy 未真实消费 Feature

**根因**：`leader-candidate-baseline` 已具备 `featureMode: "off" | "limit-up-confirm"`，但 `"limit-up-confirm"` 只有测试使用；生产路径从未进入该策略的 Feature 消费分支，也没有任何生产配置显式开启它。

**修复**：生产配置在**生产服务文件中显式固定**，不依赖策略默认值：
- `server/leaderCandidateStrategyBacktest.ts` 导出 `LEADER_CANDIDATE_PRODUCTION_FEATURE_MODE = "limit-up-confirm"`，`buildProductionLeaderCandidateStrategyConfig(options)` 返回 `{ minScore, maxSignals: 5, featureMode: "limit-up-confirm" }`，并作为 `strategyConfig` 传入每次 `runStrategyEngineBacktest`；
- 策略在 `featureMode="limit-up-confirm"` 时经 `isCandidateLimitUpConfirmed` 读取 `context.features`（`FeatureSnapshotBundle.bySymbol[symbol]`，且强制 `snapshot.asOf.decisionDate === signalTime`、`decisionPoint === "close"`），只放行 `limitUpHit READY=1` 的候选；
- Feature 缺失/不可判定 → 该候选被排除；策略在配置了 confirm 但 features 整体缺失时返回 `emptyDecision(insufficientData=true)`，绝不 silent-fallback 到 off。

---

# 2. Production Entry

| 角色 | 文件 | 函数 |
|---|---|---|
| Production Router | `server/routers.ts` | `sentiment.getLeaderCandidateBacktest`（publicProcedure query，L1018-1023）；`sentiment.saveBacktestRun`（protectedProcedure mutation，L1026-1037，同样调用 `db.getLeaderCandidateBacktest`） |
| Production DB/Service 加载层 | `server/db.ts` | `getLeaderCandidateBacktest`（L1821-1831）：加载 records/rawRows/context 后调用生产服务 |
| **Production Service** | `server/leaderCandidateStrategyBacktest.ts` | `runLeaderCandidateStrategyBacktest`（L305-313）|
| Production Strategy Engine | `server/strategy/strategyBacktest.ts` | `runStrategyEngineBacktest`（L96）|

**为什么这是“真实生产调用”而非测试调用**：
- `routers.ts:1021 / 1031` 是 trpc 公开 procedure，被前端页面真实调用（`client/src/pages/Backtest.tsx` `trpc.sentiment.getLeaderCandidateBacktest.useQuery(...)` 与保存历史功能）；
- 该 Router → `db.getLeaderCandidateBacktest` → `runLeaderCandidateStrategyBacktest`（`server/db.ts:1826`）→ `runStrategyEngineBacktest`（`server/leaderCandidateStrategyBacktest.ts:203`）。
- 全仓 `runStrategyEngineBacktest` 现在有非 `*.test.ts` 的真实调用方（`server/leaderCandidateStrategyBacktest.ts:203`）；`runLeaderCandidateStrategyBacktest` 有非测试调用方（`server/db.ts:1826`）。源码搜索可逐层证明。

---

# 3. Production Call Graph

```
routers.ts (sentiment.getLeaderCandidateBacktest / saveBacktestRun)
  ↓ 真实生产调用
db.getLeaderCandidateBacktest                        (server/db.ts)
  ↓ 加载 records（limit_up_records）+ rawRows（stock_daily_prices 原始行）+ context
runLeaderCandidateStrategyBacktest                   (server/leaderCandidateStrategyBacktest.ts)
  ↓ production config: strategyConfig = { minScore, maxSignals:5, featureMode:"limit-up-confirm" }
runStrategyEngineBacktest                            (server/strategy/strategyBacktest.ts)
  ↓ Raw → toCanonicalBar → validateMarketBar (INVALID 拒收)
  ↓ runFeaturePipeline(decisionDate, decisionPoint="close")   → asOf 可见 bar 窗口
  ↓ createFeatureSnapshotBundle → FeatureSnapshotBundle
  ↓ buildStrategySignalProvider({ dataView, buildFeatures }) → StrategyContext.features
  ↓ leader-candidate-baseline.evaluate()  (featureMode="limit-up-confirm"，真实读取 context.features)
  ↓ Signal → PositionSizer → RiskManager → Approved Order Intent
  ↓ runBacktestWithRisk → Backtest Core → Execution(next-open, T+1) → Portfolio/Equity
  ↓ Engine Result Adapter → RealisticBacktestResult（既有 API response 形状）
buildLeaderCandidateBacktest(runtime.realisticSimulationOverride)  → LeaderCandidateBacktestResult（研究报表兼容）
  ↓
LeaderCandidateBacktestResult → Router Response
```

**每一层都是真实代码调用**；未新建第二套 Feature Pipeline / Risk Manager / Backtest Engine（生产服务复用了已审计的 `runFeaturePipeline`、registry 内置策略与 `runBacktestWithRisk`）。

---

# 4. Production Strategy Configuration

- 文件：`server/leaderCandidateStrategyBacktest.ts`
- 常量：`LEADER_CANDIDATE_PRODUCTION_FEATURE_MODE = "limit-up-confirm"`（L47）
- 配置函数：`buildProductionLeaderCandidateStrategyConfig`（L65-72）→ `{ minScore, maxSignals: 5, featureMode: "limit-up-confirm" }`
- 注入位置：`runLeaderCandidateEngineProbe`（L202-224）把该配置作为 `strategyConfig` 传给 `runStrategyEngineBacktest`；`server/db.ts` 的正式入口只会走到这条带显式配置的路径。

**追踪路径**：Production Entry → Production Config → `featureMode = "limit-up-confirm"` → registry normalizeConfig（`leaderCandidateBaseline.ts:151-154` 保留 confirm）→ evaluate 的 feature gate（L164-178）。不是“Production → default(off) → 只有测试开 confirm”。

---

# 5. Production Feature Consumption

- 文件：`server/strategy/strategies/leaderCandidateBaseline.ts`
- 位置：`evaluate` L164-178；`featureGateEnabled` 为 true 时对评分过滤后的候选调用 `isCandidateLimitUpConfirmed(features!, signalTime, candidate)`（L120-126）：
  - 从 `FeatureSnapshotBundle.bySymbol` 取该 symbol 快照；
  - 校验 `snapshot.asOf.decisionDate === signalTime && snapshot.asOf.decisionPoint === "close"`；
  - 仅当 `limitUpHit.status === "READY" && value === 1` 才纳入输出。
- 生产 Provider：`strategyBacktest.ts` 的 `buildFeatures: (date) => featuresOfDate(date)`（L200）与 signalTime 同 asOf，FeatureSnapshotBundle 经 `StrategyContext.features` 到达策略本体。
- 测试证明真实读取：`server/strategy/productionIntegration.test.ts` TEST 1/2/4（见下）。

---

# 6. Feature Decision Test

场景（`server/strategy/productionIntegration.test.ts` TEST 4）：候选 A/B/C 同题材、记录与评分排序完全不变；仅修改价格库输入。

| 组 | Feature 输入（价格库 D1 收盘） | limitUpHit | 生产服务输出（realisticSimulation.trades） |
|---|---|---|---|
| 第一组 | A=11.00（涨停）；B=10.20；C=10.20 | A=1, B=0, C=0 | 仅 A 纳入成交 |
| 第二组 | B 改为 11.00（涨停）；其余不变 | A=1, B=1, C=0 | A 与 B 纳入成交（B 从排除 → 纳入）|

引擎探针同步断言：`confirmedSymbols` 由 `[A]` 变为 `[A,B]`，`decisionLog` 由 1 条变为 2 条。结果：测试通过（`Tests 10 passed`）。这证明 **Feature → Strategy → Production Decision** 是真实链路（生产服务入口）。

---

# 7. Missing Feature Safety

- 生产服务层（TEST 6）：删除 B/C 在信号日 D1 的价格行（保留 A 的 D1 行与 B/C 的 D2 行）→ B/C 因 Feature INSUFFICIENT/缺失被排除，`decisionLog` 与成交均只有 A；若生产静默回退为 off，B/C 会因 D2 行情存在而成交——该用例证明**没有 silent fallback**。
- 策略契约层：`featureMode="limit-up-confirm"` 且 `features=undefined` → `emptyDecision(insufficientData=true)`、`signals=[]`（已在测试中直接断言）。
- asOf 不匹配（`snapshot.asOf.decisionDate !== signalTime` 等）→ `isCandidateLimitUpConfirmed` 返回 false，候选被排除（既有 `leaderCandidateBaseline.test.ts` 覆盖）。

---

# 8. Future Leakage

- 生产服务级回归（TEST 5）：对已确认的 A 与未确认的 C，仅扰动 **D2/D3 的 close/high/low/volume/amount**（open/preClose 不变，成交路径不受影响）后重新运行生产服务：
  - `D1 Decision`（decisionLog）完全一致；
  - `confirmedSymbols / skippedSymbols` 完全一致；
  - `D2 Order`（risk 裁决 approvedQuantity/decision）完全一致；
  - 成交入口（symbol/entryTime/entryPrice/quantity）完全一致；
  - C 的未来 D2/D3 即使变成涨停也不进入 D1 决策（`skippedSymbols` 含 C）。
- 底层探针（既有 `strategyBacktest.test.ts` 用例 4/5）继续通过。

---

# 9. Decision-time

- 生产组装点级回归（`productionIntegration.test.ts` “Decision-time Regression”）：`decisionPoint="open"` 时，A 的 D1 全天 OHLCV 改写为极端值（收盘 11.00 → 50.00）后重新运行，`decisionLog / result.trades / confirmedSymbols` 与常规运行**完全一致**，证明 D1 open 决策不可见 D1 当日 OHLCV（D1 bar 被 asOf 排除）。该用例通过。
- 生产默认决策时点为收盘（D1 close 出信号 → D2 open 成交），`asOf.decisionDate === signalTime`、`decisionPoint === "close"` 由特征管道 `visibleBars` 保证；测试断言成交日(D2) ≠ 特征决策日(D1)。

---

# 10. Risk Integration

生产路径固定经过 `runBacktestWithRisk`（`strategyBacktest.ts:254`），即 **PositionSizer → RiskManager → Approved Order Intent → Backtest Core**，未绕过 maxPositions / lotSize / cash / symbol exposure / portfolio exposure。

生产服务级回归（TEST 8）：
- `maxPositions=1` 且 A/B/C 全部确认涨停 → 3 个 BUY 意图、仅 1 单成交（仓位上限生效）；
- `lotSize=200` 且名义数量 100（非整手）→ 整手约束生效、0 成交；
- `initialCapital=900`（不足以买入 1 手）→ 0 成交、`finalPortfolio.cash <= 900`。
既有 Step 4 测试（`server/risk/risk.test.ts` 35、`risk.fix.test.ts` 15）与 Step 2 引擎测试（`engine.test.ts` 29、`engine.fix.test.ts` 16）全部通过。

---

# 11. Legacy Path

`realisticBacktest.simulateRealisticTPlus1ToTPlus2` 的当前非测试调用方：
- `server/leaderCandidates.ts:1002` —— **已被 runtime override 短路**：正式生产调用（`db.getLeaderCandidateBacktest → runLeaderCandidateStrategyBacktest`）传入 `realisticSimulationOverride`，该分支不执行；仅 legacy/兼容调用方与既有测试走此默认分支；
- `server/downsideRisk.ts`（603/630/669/670/760）—— 风险扣分研究/滚动窗口/fullCycle/walk-forward 等**研究型实验报表**（legacy 兼容用途，§“其它兼容调用方保留”）；
- `server/overfittingGuard.ts`（默认 `simulate` 形参）—— 该模块自身的基准研究；
- `server/paperTrading.ts`（仅注释引用）。

**正式 leader-candidate production path 不再依赖 legacy realisticBacktest 作为交易模拟引擎**：正式入口的 `realisticSimulation` 由 Strategy Engine 产出并经 Adapter 映射。legacy 模拟器保留且仍服务于研究型模块与兼容调用方，但不再处于正式龙头候选回测的主链。

---

# 12. Step2 Regression

`server/engine/engine.test.ts` 29 passed；`engine.fix.test.ts` 16 passed。Execution / Portfolio / Trade / Equity / Performance / maxPositions / maxPositionAmountRatio / lotSize 相关断言全部通过，无回归。

# 13. Step3 Regression

`server/strategy/contract.test.ts` 10、`registry.test.ts` 6、`leaderCandidateBaseline.test.ts` 11、`strategyBacktest.test.ts` 6（生产组装点集成）全部通过。Strategy Contract / Registry / Signal / Determinism / Isolation / Feature 消费均无回归。

# 14. Step4 Regression

`server/risk/risk.test.ts` 35、`risk.fix.test.ts` 15 全部通过。Position Sizer / Risk Manager / APPROVE / RESIZE / REJECT / Exposure / Cash / LotSize 均无回归。

# 15. npm test

`vitest run` 全量结果：**509 passed / 15 failed（6 files）**。修复前基线为 499 passed / 15 failed；本轮净新增 **10 条生产集成测试全部通过**。

15 条失败文件（与基线完全一致，均为环境失败，无代码回归）：
| 文件 | 条数 | 原因 |
|---|---|---|
| `server/marketData.test.ts` | 4 | 依赖真实 MySQL/TiDB（环境无库）|
| `server/limitUp.watch.test.ts` | 4 | 依赖真实 DB |
| `server/limitUp.test.ts` | 1 | 依赖真实 DB |
| `server/tushare.secret.test.ts` | 1 | 缺少 `TUSHARE_TOKEN` |
| `server/tushareTradingCalendar.test.ts` | 3 | Tushare 网络超时/密钥受限 |
| `server/stockPriceSyncPage.test.ts` | 2 | `StockPriceSync.tsx` 页面尚未开发 |

失败文件与失败原因与上一轮基线逐一同构；**无新增 CODE REGRESSION**。

# 16. typecheck

`npm run check`（tsc --noEmit）：**exit 0**。

# 17. build

`npm run build`（vite + esbuild）：**成功**（`✓ built in ~12.7s`，dist/index.js 产出；仅有既有的 chunk 体积提示）。

# 18. lint

N/A —— `package.json` scripts 中没有 lint 脚本（仅有 `format: prettier`）。全仓也未配置 eslint 命令。本轮改动已通过 tsc 严格检查。

# 19. Files Changed

| 文件 | 变更 |
|---|---|
| `server/leaderCandidateStrategyBacktest.ts` | **新增**：正式生产服务 `runLeaderCandidateStrategyBacktest` / `runLeaderCandidateEngineProbe`、生产配置（`LEADER_CANDIDATE_PRODUCTION_FEATURE_MODE="limit-up-confirm"` 等）、Engine Result → RealisticBacktestResult Adapter |
| `server/strategy/strategyBacktest.ts` | `runStrategyEngineBacktest` 增加显式 `tradingDates` 日历（与行情日期并集）；probe 增加只读 `decisionLog`（不参与决策）|
| `server/leaderCandidates.ts` | `buildLeaderCandidateBacktest` 增加可选第 4 参 runtime `{ realisticSimulationOverride? }`；传入时跳过 legacy 顶层模拟器 |
| `server/db.ts` | 新增 `loadStockDailyPriceRows()` 统一加载原始行情行；`BacktestBaseContext` 增加 `rawRows`；`getLeaderCandidateBacktest` 改走 `runLeaderCandidateStrategyBacktest` |
| `server/strategy/productionIntegration.test.ts` | **新增**：10 条生产入口集成测试（end-to-end / Feature 调用 / 生产配置 / Feature 改变决策 / Future Leakage / Missing-Feature 安全 / Determinism / Risk Regression / API 兼容 / Decision-time）|
| `docs/PHASE1_STEP5_FIX2_REPORT.md` | 本报告 |

# 20. Known Issues

（按任务约束只记录，不扩大修复范围）
- **RA-003（P2）** `scripts/backfill_high_volume.ts`：存在与本次无关的已知问题，未处理。
- **RA-004（P2）** `ensureStockDailyPricesUniqueIndex`：唯一索引兜底实现保留上一轮修复，仍有已记录的工程面观察项，未扩大处理。
- **RA-009（P2）** 真实 DB 无法在本环境验证唯一约束是否已生效（需部署环境执行迁移 0008 后核对）。
- **RA-005 / RA-006 / RA-007 / RA-008 / RA-010（P3）** 多个观察项，本轮未处理。
- **新增（真实剩余）**：
  1. 正式生产请求仍会执行 `buildLeaderCandidateBacktest` 的研究报表段，其中 `buildDownsideRiskResearch`（风险扣分/fullCycle/滚动窗口实验）与 `overfittingGuard` 默认参数仍调用 legacy 模拟器——它们属于**研究型分析报表**（legacy 兼容用途，见 §11），但严格意义上仍在一次生产请求内被执行；若要求生产请求内零 legacy 执行，需把风险研究各实验的模拟段也换为引擎（会改动 Step-4 邻近的研究语义，超出本轮范围）。
  2. 生产 Feature 确认门控依赖信号日价格行存在且 `preClose/close` 有效；历史价格覆盖不全的股票会被排除（这是 Feature 门控的预期语义，与现有 `dailyPriceCoverage` 提示一致）。
  3. `realisticSimulation` 语义随引擎切换而变化：成交为“T+1 开盘买入、风险准入、持有至期末按市价估值”（leader-candidate-baseline 无 SELL），因此 `completedCount/winRate` 等“已实现”类统计可能为 0/null，与 legacy 的风险管理持有/止盈止损口径不同；总收益/回撤来自引擎逐日市值权益曲线。已在前端既有字段内表达，未改动 response 形状。

# 21. Audit Risks（下一轮 Re-audit 最可能检查）

1. `runStrategyEngineBacktest` 是否有非测试调用方 —— 现可溯源：`server/leaderCandidateStrategyBacktest.ts:203`；`runLeaderCandidateStrategyBacktest` 调用方 `server/db.ts:1826`；Router 调用方 `server/routers.ts:1021/1031`。
2. 生产配置 `featureMode="limit-up-confirm"` 是否为真实生产值 —— 溯源：`server/leaderCandidateStrategyBacktest.ts:47/70`（非测试文件，非默认值路径）。
3. `context.features` 是否被真实生产 Strategy 消费 —— 溯源：`server/strategy/strategies/leaderCandidateBaseline.ts:177`（`isCandidateLimitUpConfirmed(features!, signalTime, …)`）。
4. 审计 grep `getLeaderCandidateBacktest → realisticBacktest`：正式入口的主交易模拟已不再走 legacy；但生产请求内的**研究报表段**仍含 legacy 模拟（downsideRisk/overfittingGuard），需审计确认“research/compat”分类成立。若要求更严格，可作为后续独立工作项把研究实验模拟也引擎化。
5. 测试是否驱动“真实生产入口”：`productionIntegration.test.ts` 直接驱动 `runLeaderCandidateStrategyBacktest`（生产服务同一代码路径）；`db.getLeaderCandidateBacktest` 因依赖真实 DB 无法在无库环境直连，两者关系已在测试文件头注明。
6. Response 兼容：`realisticSimulation` 仍为 `RealisticBacktestResult` 形状（顶层研究字段不变），Adapter 只映射、不重新执行 legacy；新增字段未破坏既有 tRPC 输出与前端页面。
7. 确定性/隔离：生产服务与引擎均无 Date.now / Math.random / 网络 / 模块级可变状态（唯一 Date.now 命中为 `db.ts` 既有 TTL 缓存，与决策无关）；TEST 7 以 100 次引擎运行 + 2 次完整服务运行深度相等验证。
8. 数据/参数驱动：signalDate/featureDate/decisionDate 全部来自回测输入与显式交易日历，不以系统时间决定；生产特征集固定为 `DEFAULT_PRODUCTION_FEATURES`。

---

**结论声明（按任务要求，不自宣 PASS）：**

RA-001 / RA-002 已按开发目标完成修复：正式生产入口（Router → db.getLeaderCandidateBacktest → runLeaderCandidateStrategyBacktest → runStrategyEngineBacktest）已真实接入 Strategy Engine 新链路，生产配置显式 `featureMode="limit-up-confirm"` 并真实消费 `context.features`，Feature 缺失不静默降级，asOf/Decision-time/Future-Leakage/Risk/Step2-4 回归全部通过，typecheck/build/全量测试无新增代码回归。

**最终是否通过 Step 5 由新的独立 Re-audit Agent 判定。**
