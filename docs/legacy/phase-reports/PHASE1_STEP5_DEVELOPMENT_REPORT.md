# Step 5 开发完成报告

## 统一数据质量层 + Canonical Market Data + Feature / Factor Pipeline

> 结论声明：本报告仅陈述开发内容、工程验证与已知问题，**不自行宣告 "STEP 5 PASS"**。
> 是否通过留待独立审计。

目标约束（开发全程遵守）：
- 不重设计 Step 1–4 已验收架构；Step 2（Core）/ Step 3（Strategy）/ Step 4（Risk）全部复用既有实现。
- 不批量新增因子；聚焦「数据基础设施正确性」。
- 所有「历史窗口」只能包含 ≤ 决策时点可见的数据；数据不足显式报告，绝不静默降级。

---

## 第 0 章 现状审计结论（开发输入）

审计（Phase 1，产出 `PHASE0_SOURCE_CODE_AUDIT_REPORT.md` 同源记录）确认以下现状，Step 5 的开发全部针对这些缺口：

| # | 审计发现 | Step 5 处置 |
|---|---|---|
| A1 | `MarketBar`（engine/domain）无 volume / turnoverRate / limitUp / adjustment 字段，价格语义零散 | 建立独立 canonical 类型层，engine 降级路径显式丢弃多余字段 |
| A2 | 数据源仅 Tushare daily 未复权价，但 units（手/千元/%）散落各处、有历史注释矛盾 | `MARKET_DATA_UNITS` 单一常量；`adjustment:"raw"` 显式声明 |
| A3 | 主板判定 `isMainBoardStock` 正则散落 3 处 | 归拢至 `boardRules.classifyBoard`（新增唯一权威） |
| A4 | 涨跌停比例散落为内联 1.099 / 0.901 近似与 `execution.ts` 10% 默认 | 新增 `boardRules.ts` 权威解析，价格纯函数复用 Backtest Core `limitUpPrice/limitDownPrice` |
| A5 | 无 feature / factor 统一契约、注册中心或流水线；统计函数在各文件重复自实现 | `features/` 全新层 + 统计统一至 `shared/quant-stats` |
| A6 | 策略消费数据的「决策时点可见性」靠约定，无强制执行 | `visibleBars()` asOf 过滤 + `MarketBarSeries` 统一访问 |

---

## 第 1 章 数据质量 + Canonical Market Data 层（`server/data/`）

### 1. Canonical Market Bar（统一行情契约）

`server/data/types.ts`：
- `CanonicalMarketBar`：symbol / timestamp(YYYY-MM-DD) / open / high / low / close / preClose / volume / amount / turnoverRate / adjustment。
- **单位显式约定**（`MARKET_DATA_UNITS`）：price=元/股、volume=手(1手=100股)、amount=千元、turnoverRate=%(成交额/流通市值×100)。任何模块禁止自行换算。
- **允许缺失**：字段为 `number | null`，`null` = 数据源明确未提供；禁止 `close || 0` 静默填零。
- **复权口径**：`PriceAdjustment = "raw" | "forward" | "backward"`；系统仅支持 `"raw"`（Tushare daily 未复权），canonical bar 恒为 `"raw"`，禁止混用口径。

### 2. Adapter / Normalizer（统一数据边界）

`server/data/adapter.ts`：
- `toCanonicalBar(row)`：接受「外部行」统一形状（兼容 Tushare 数字行与 DB varchar 行，字段名 stockCode/tradeDate/openPrice/…），数值一律经 `parseNumericPrice` 解析，非法 → `null` 交校验层报告。Strategy / Feature / Backtest Core 不再允许直接解释外部源字段。
- `toEngineMarketBar(bar)`：canonical → Backtest Core `MarketBar`（单位一致：price 元/股、amount 千元）。canonical 独有字段（volume/turnoverRate/adjustment）在 Core 契约不存在，按 Core 契约**显式丢弃**（不携带、不伪造）。

### 3. Validation（数据质量三态）

`server/data/validation.ts`：
- `validateMarketBar(bar)` → `{ status: "VALID"|"WARNING"|"INVALID", issues: [{severity, code, message}] }`。
- `isBarValid(bar)` 布尔便捷；`parseNumericPrice()` 供 adapter 统一解析 varchar/数值。
- 校验项覆盖：字段缺失语义、非正价格、preClose≤0、单位越界（如 volume 为负）等；issue 使用稳定 `code` 供程序化处理。

### 4. 涨停规则唯一权威（Limit-Up Rule Authority）

`server/data/boardRules.ts`：
- `classifyBoard(symbol)` → main / chinext / star / bse / unknown（吸收原散落 3 处的主板/板块正则）。
- `resolveLimitRules(stockCode, stockName?)` → 主板非 ST 10% / ST 5% / 创业板·科创板 20% / 北交所 30%；无法归类或名称不足 → `supported=false`（UNKNOWN），**不得假装支持**。
- `isLimitUpBar / isLimitDownBar(bar, stockName?)`：close 达涨/跌停价即触及；规则不可判定或缺字段 → `null`。
- 价格计算不重复实现：`limitUpPrice/limitDownPrice` **re-export 自 Backtest Core 已验收纯函数**（`engine/execution`），本层仅承载比例判定。

### 5. 统一时间序列访问 + As-Of / Availability

`server/data/series.ts`：
- `visibleBars(bars, decisionDate, decisionPoint)`：按决策时点过滤——
  - `"close"`（收盘后决策）：可见 timestamp ≤ decisionDate 的整根 bar（当日 full bar 已产生）；
  - `"open"`（开盘决策）：仅可见 timestamp < decisionDate 的整根 bar（当日 high/low/close/volume/amount 未产生，整根排除；"开盘决策用昨日收盘序列"为唯一无歧义语义）；
  - 未来 bar（> decisionDate）一律不可见。
- `MarketBarSeries`：单 symbol 升序序列（无序入参内部稳定排序；同日重复 bar 抛「数据质量错误」），提供 `current()/previous(n)/window(n)/has(date)/getByDate()/length/all()`。Feature 层禁止自行 `slice/filter/sort` 判断时间范围，一律经 series 访问。

---

## 第 2 章 Feature / Factor Pipeline（`server/features/`）

### 6. Feature Contract（纯函数契约）

`server/features/contract.ts`：
- `FeatureStatus = "READY" | "INSUFFICIENT_DATA" | "INVALID_DATA"`；**三态**：数据不足→`INSUFFICIENT_DATA`，字段缺失/非法→`INVALID_DATA`，绝不静默降级为 READY、不补零、不用未来数据。
- `FeatureResult`：value + status + requiredBars + availableBars + note。
- `FeatureContext`：series **已由上层按 decisionDate/point 过滤**，只含当时可见数据；附带 stockName（ST 判定用）。
- `FeatureMetadata`：id / version / description / inputFields / availability。
- `FeatureFactory`（注册单元）+ `FeatureInstance`（create(params) 产出、无状态纯函数实例）。

### 7. Feature Registry（注册中心）

`server/features/registry.ts`：
- `FeatureRegistry`：重复注册抛错、未知 id 抛错、`list()` 按 id 字典序稳定返回元数据副本。
- 约束与 Strategy Registry 对齐：不依赖 DB / Network / Date.now / Math.random；不保存跨实例计算状态。
- 导出单例 `featureRegistry`（仅存工厂定义，无计算状态）。

### 8. 基础特征库（Basic Features，不为数量造因子）

`server/features/basic.ts`，`registerBasicFeatures()` 幂等注册 7 个基础特征：
- `sma(N)`：N 日简单移动平均（close，元/股）。
- `return(N)`：close[T]/close[T−N]−1（需 N+1 根收盘价）。
- `avgAmount(N)` / `avgVolume(N)`：N 日平均成交额（千元）/ 成交量（手）。
- `volatility(N)`：滚动日收益样本标准差（近 N 个日收益，未年化；需 N+1 根收盘价且窗口收益数 ≥ 2）。
- `amplitude`：(high−low)/preClose×100（%），与 legacy `technicalFactors.amplitude` 同口径。
- `limitUpHit`：最近可见完整 bar 是否收盘涨停（按 `boardRules` 权威，ST 需 stockName）；1/0/无法判定=null。

只实现「项目真实使用或审计明确要求」的指标；`return1d/returnNd、avgAmountNd、amplitude1d` 对应 legacy 溢价研究与 technicalFactors 量比/振幅的底层口径（详见各因子 header）。

### 9. Feature Snapshot（同 asOf 一致性）

`server/features/snapshot.ts`：
- `FeatureAsOf { decisionDate, decisionPoint }`。
- `FeatureSnapshot { symbol, asOf, features: Record<id, FeatureSnapshotEntry> }`。
- 铁律：快照内所有 feature 值必须来自**同一 symbol、同一 asOf、同一份可见数据切片**；禁止把不同时点计算的特征混入同一快照。

### 10. Feature Pipeline（确定性流水线）

`server/features/pipeline.ts`：
- `runFeaturePipeline({ symbol, stockName?, bars, decisionDate, decisionPoint, features })`：
  `Market Data(raw) → visibleBars(asOf 过滤) → MarketBarSeries → per-feature calculate → FeatureSnapshot`。
- 幂等注册基础特征后执行；无副作用、无全局状态、无未来数据；不修改原始 bars。

### 11. Warm-up / 数据不足语义

- 每个 feature 声明 `requiredBars`（sma/avgAmount/avgVolume=N；return/volatility=N+1；amplitude/limitUpHit=1）。
- `calculate` 首行 `series.length < requiredBars → INSUFFICIENT_DATA`，窗口字段缺失 → `INVALID_DATA`。**无任何静默回退**（见 `features.pipeline.test.ts` 破坏性测试）。

### 12. 迁移与统计统一（Stats Unification + Code Scan）

将散落在业务层的统计自实现**删除**，统一引用 `shared/quant-stats`（Phase 1 Step 1 已建的全系统唯一统计基础；禁各业务文件再造一份）：

| 文件 | 移除的自实现 | 改为引用 |
|---|---|---|
| `server/technicalFactors.ts` | mean / median / skewness / excessKurtosis / neweyWestMeanTStat / sampleStd / rankValues / spearman | `shared/quant-stats`；`spearman` re-export 保兼容 |
| `server/downsideRisk.ts` | average / sampleStandardDeviation / historicalQuantile / 内联偏度·峰度 / 内联年化·夏普 | `mean / sampleStandardDeviation / quantile / skewness / excessKurtosis / annualizedReturnFromEquityCurve / sharpeRatio` |
| `server/factorCombination.ts` | mean / pearsonCorrelation(自实现) | `mean / pearsonCorrelation / spearmanCorrelation / spearman`；re-export 保测试兼容 |
| `server/overfittingGuard.ts` | median 等 | `mean` 等；同时修复 `threshold === null` 时硬过滤分支的无意义比较（decision-time 正确性） |

`vitest.config.ts` 测试收集新增 `shared/**/*.test.ts`。

> 行为说明（Known Issue #1）：`downsideRisk` 的 sharpeRatio 由「几何年化收益/年化波动」口径统一改为 `shared/quant-stats.sharpeRatio` 的**标准算术年化夏普**（mean(daily)/sampleStd(daily)·√252），metric 定义变更已在代码注释与下文 Known Issues 明示；全量回归无新增失败。

### 13. 复权口径处理（Adjustment Handling）

- 系统当前仅 raw（未复权）。`CanonicalMarketBar.adjustment` 恒 `"raw"`。
- `PriceAdjustment` 类型保留 forward/backward 为**未来扩展位**，当前任何代码路径不接受非 raw 输入（adapter 不产 forward/backward；若上游出现将按数据质量报告而非静默混用）。
- engine `MarketBar` 无 adjustment 字段：canonical→engine 降级路径丢弃（设计如此，防回测路径误用未来才引入的复权语义）。

### 14. Strategy Context 向后兼容扩展

- `server/strategy/contract.ts`：`StrategyContext` 新增**可选** `features?: FeatureSnapshot`（与 signalTime 同 asOf）。既有策略不感知、不传即 undefined，行为与旧版完全一致。
- `server/strategy/registry.ts`：`evaluate(...)` 新增可选 `features` 参数并透传进 `strategy.evaluate({ ..., features })`。
- `server/strategy/adapter.ts`：`buildStrategySignalProvider()` 新增可选 `options.buildFeatures?(date)`，按日期构建快照注入；未提供时与旧版完全一致。

---

## 第 3 章 破坏性 / 正确性测试

### 15. Data 层测试（`server/data/data.test.ts`，16 tests）

- adapter 归一化：Tushare 数字行 / DB varchar 行 → canonical（单位、非法数值→null、adjustment=raw）。
- validation：VALID / WARNING / INVALID 三态、稳定 code、isBarValid。
- boardRules：板块分类（主板/创业板/科创板/北交所/unknown）、ST 5% vs 主板 10%、20%/30%、unknown→null；limitUp/limitDown 触及判定与字段缺失→null。
- series：visibleBars "close" / "open" 边界、MarketBarSeries 排序/去重/越界/previous 负数抛错。

### 16. Feature Pipeline 破坏性测试（`server/features/features.pipeline.test.ts`，11 tests）

- **Future Leakage**：修改/删除决策日之后的 bar，快照结果不变。
- **Decision Time**："close" 决策可见当日；"open" 决策当日整根不可见（窗口回退昨日）。
- **Determinism**：相同输入重复计算 100 次逐字段深等。
- **Instance Isolation**：同一工厂不同 params 实例互不影响；registry 单例不残留状态。
- **Warm-up**：bar 数 < requiredBars → INSUFFICIENT_DATA（覆盖 sma/return/avgAmount/volatility/amplitude/limitUpHit）。
- **Registry**：重复注册抛错、未知 id 抛错、list 稳定排序。

### 17. Golden Test 端到端（`server/features/features.golden.test.ts`，3 tests）

全链路 `Raw(Row) → toCanonicalBar → validateMarketBar → runFeaturePipeline(visibleBars → MarketBarSeries → FeatureSnapshot) → registry.evaluate(features) → Strategy Signal → toCoreSignals → runBacktestWithRisk(PositionSizer → RiskManager → Approved Order) → Backtest Core`：
- 数据管道：4+2 根历史+交易日 bar 全 VALID；SIGNAL_DATE(2026-01-06) "close" 决策可见 4 根 → sma/return/avgAmount/volatility/limitUpHit 全 READY，同 asOf、同 availableBars。
- Strategy Context：探针策略真实从 `context.features.sma` 读到值并输出携带 asOf 的信号（证明 features 贯通 registry.evaluate）。
- 全链路：既有 `leaderCandidateBaselineStrategy` 复用 + Risk 层 APPROVE + Backtest Core 3 笔成交，equityCurve 正常——**证明 Step 2/3/4 语义未被破坏、无重写**。

> 开发期修正：golden fixture 原仅 4 个交易日，SIGNAL_DATE 前可见 bar=2，sma(3)/volatility(3) 按 warm-up 语义正确返回 INSUFFICIENT_DATA——这是**正确行为**而非 bug。为使验收场景同时覆盖「候选信号日」与「READY」，为 fixture 前置 2025-12-30/31 两个真实历史交易日（仅进 feature 预热窗口、不进回测窗口），SIGNAL_DATE 可见 4 根，全 feature READY；回测窗口仍为原 4 交易日，语义不变。

---

## 第 4 章 工程验证（Regression）

| 项 | 结果 |
|---|---|
| `npm test` | **475 passed / 15 failed / 490 total**（50 files：44 passed / 6 failed） |
| 新增 STEP 5 测试 | 30/30 全绿（data 16 + features pipeline 11 + golden 3） |
| 既有行为回归 | Step 2 engine / Step 3 strategy / Step 4 risk 无回归（475 = Step 4 基线 445 + STEP 5 新增 30） |
| 15 项失败 | 全部为**既有环境类**（缺 `TUSHARE_TOKEN` / 实时网络超时 / 依赖数据库的集成用例），与 Step 1–4 各期清单完全一致，**无新增失败** |
| `npm run check`（tsc --noEmit） | ✅ exit 0 |
| `npm run build` | ✅ exit 0（vite build + esbuild server bundle） |

失败文件清单（均为环境依赖，非代码缺陷）：`tushare.secret.test.ts`、`tushareTradingCalendar.test.ts`、`marketData.test.ts`、`limitUp.test.ts`、`limitUp.watch.test.ts`、`stockPriceSyncPage.test.ts`。

---

## 第 5 章 文件清单

**新增（`server/data/`）**
- `types.ts` — CanonicalMarketBar / 单位常量 / DataQuality / BarValidationResult
- `adapter.ts` — toCanonicalBar / toEngineMarketBar
- `validation.ts` — validateMarketBar / isBarValid / parseNumericPrice
- `boardRules.ts` — classifyBoard / resolveLimitRules / isLimitUpBar / isLimitDownBar / limitUpPrice·limitDownPrice re-export
- `series.ts` — visibleBars / MarketBarSeries / DecisionPoint
- `index.ts` — barrel
- `data.test.ts` — 16 tests

**新增（`server/features/`）**
- `contract.ts` — FeatureStatus / FeatureResult / FeatureContext / FeatureMetadata / FeatureFactory / FeatureInstance
- `registry.ts` — FeatureRegistry + 单例 featureRegistry
- `basic.ts` — 7 个基础特征工厂 + registerBasicFeatures
- `snapshot.ts` — FeatureSnapshot / FeatureAsOf / FeatureSnapshotEntry
- `pipeline.ts` — runFeaturePipeline
- `index.ts` — barrel
- `features.pipeline.test.ts` — 11 tests（Future Leakage / Decision Time / Determinism / Isolation / Warm-up / Registry）
- `features.golden.test.ts` — 3 tests（端到端全链路）

**修改（向后兼容，不破坏既有语义）**
- `server/strategy/contract.ts` — StrategyContext 可选 `features?: FeatureSnapshot`
- `server/strategy/registry.ts` — evaluate 可选 features 透传
- `server/strategy/adapter.ts` — buildStrategySignalProvider 可选 buildFeatures
- `server/technicalFactors.ts` / `server/downsideRisk.ts` / `server/factorCombination.ts` / `server/overfittingGuard.ts` — 统计统一至 shared/quant-stats（删除 263 行重复实现）+ threshold null 分支修复
- `vitest.config.ts` — 测试收集含 `shared/**/*.test.ts`

**删除**：无。

---

## 第 6 章 已知问题 / 待审计关注点

1. **sharpe 口径统一**：`downsideRisk` 指标由原「CAGR 年化收益 ÷ 年化波动」改为 `shared/quant-stats.sharpeRatio`（标准算术年化：mean(daily)/sampleStd(daily)·√252）。数值与旧口径不同属预期；如 Step 4 验收对该指标有历史断言，需独立审计复核。
2. **`overfittingGuard` threshold=null 分支修复**：为防 `null >= number` 恒 false 造成的隐式过滤，改为显式 `threshold !== null` 守卫；属决策时点正确性修正，建议审计确认与原意图一致。
3. **engine `MarketBar` 无 volume/turnoverRate/adjustment**：canonical→engine 降级为显式丢弃。Feature 层如需 volume/turnoverRate，必须走 canonical 侧，不能从 engine bar 反推。
4. **turnoverRate 恒为 null**：数据源（Tushare daily + 现有 DB）无交易所标准 turnover_rate；按「禁止伪造」原则留空，待上游接入后再填充。
5. **复权**：当前仅 raw；forward/backward 仅为类型扩展位，任何产生非 raw 数据的上游接入前需先扩展 adapter + 校验 + 引擎口径，属后续工作。
6. **15 项环境类测试失败**：与 Step 1–4 完全同源（需 TUSHARE_TOKEN、外网、数据库），非本 Step 引入。
7. **Legacy 近似 1.099/0.901（realisticBacktest）**：行为已被既有测试锁定，本 Step 未回改；boardRules 是新代码的权威口径，两套并存属已知技术债（见 boardRules.ts header 记录）。

---

Step 5 是否 PASS 留给下一阶段独立审计。
