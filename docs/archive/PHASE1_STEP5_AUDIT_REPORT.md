# STEP 5 INDEPENDENT AUDIT REPORT

Repository: stock-limit-up-analyzer

> 审计员身份：独立 Quant System Auditor（非开发者）。
> 本报告依据 31 项审计规范逐项执行：源码审计、自建破坏性测试、Future Leakage 测试、Step 2/3/4 回归、数据口径、架构绕过检查。
> 结论依据代码真实状态，不采信开发者自述，不因测试/类型/构建通过而放行。
> （本版为二次审计，取代上一版；上一版中"Golden Test 失败 2/3 且非确定性"的结论经独立复核已不成立，见下。）

---

## 总判定

```
Architecture:           FAIL
Canonical Market Data:  PASS
Data Adapter:           FAIL
Data Validation:        FAIL
Time-aware Access:      PASS
As-Of / Availability:   PASS
Feature Contract:       PASS
Feature Registry:       PASS
Feature Pipeline:       FAIL
Warm-up:                PASS
Future Leakage:         PASS
Feature Mathematics:    PASS
Limit-Up Rules:         FAIL
Adjustment Handling:    PASS
Strategy Integration:   FAIL
Step 2 Regression:      PASS
Step 3 Regression:      PASS
Step 4 Regression:      PASS
Determinism:            PASS
Instance Isolation:     PASS
Golden Pipeline:        FAIL
npm test:               FAIL
typecheck:              PASS
build:                  PASS
lint:                   NOT_AVAILABLE
```

---

## P0 Issues

无。

（库内 Future Leakage 破坏性测试全绿，未发现任何"未来数据进入 Feature(T) / Strategy Decision / Feature 直接交易 / 核心数据时间语义错误导致回测失真"的问题。详见 Future Leakage 章节。）

---

## P1 Issues

### P1-F1 — Feature Pipeline 是孤儿代码，未真正接入生产

- **文件**：`server/features/pipeline.ts`（定义）；`server/strategy/adapter.ts:99-113`（唯一注入点）
- **代码位置**：
  - `runFeaturePipeline` 全仓唯一调用方是 `server/features/features.pipeline.test.ts` 与 `server/features/features.golden.test.ts`（均为测试文件）。
  - `buildStrategySignalProvider` 的 `buildFeatures` 选项**没有任何生产调用方注入实现**。
  - `server/strategy/leaderCandidateBaseline.test.ts:207` 固化 `Strategy→Risk→Core` 链路时调用 `buildStrategySignalProvider` **未传 `buildFeatures`**。
- **为什么是问题**：架构声明 `Raw → … → Feature Pipeline → Feature Snapshot → Strategy Context`，但生产系统没有任何路径触发特征计算。`sma / return / avgAmount / avgVolume / volatility / amplitude / limitUpHit` 七个特征实现"为存在而存在"。
- **复现方式**：
  ```
  grep -rn "runFeaturePipeline" --include="*.ts" server/ client/ | grep -v "\.test\.ts"
  # → 0 条生产调用
  grep -rn "buildFeatures" --include="*.ts" server/ | grep -v "\.test\.ts"
  # → 仅 adapter.ts 接口定义，无生产调用方
  ```
- **推荐修复**：在真实 signalProvider 组装点（backtestPage / paperTrading 的数据提供层）注入 `buildFeatures = (date) => runFeaturePipeline({ ... })`，使特征真正进入策略 context。

### P1-F2 — 核心策略完全绕过 Feature Layer

- **文件**：`server/strategy/strategies/leaderCandidateBaseline.ts:117`
- **代码位置**：`evaluate(context)` 仅解构 `{ signalTime, data, config }`，**从不读取 `context.features`**。
- **为什么是问题**：唯一生产策略（`leader-candidate-baseline`）不消费任何特征。全仓 grep `context.features` 在 `server/strategy/strategies/` 下 0 处匹配——唯一读取 `features` 的是 golden test 里测试专用的 `featureProbeStrategy`。即便修复 F1，特征值也不会影响任何真实策略决策。
- **复现方式**：
  ```
  grep -rn "context.features\|\.features" server/strategy/strategies/
  # → 0 处（策略本体）
  ```
- **推荐修复**：让至少一个生产策略在 `evaluate` 中真实消费 `context.features`（如用 `limitUpHit` 过滤、`avgAmount` 排序、`volatility` 打分）。

### P1-F3 — Data Adapter / Validation 未接入入库路径（数据质量层未生效）

- **文件**：`server/stockPriceSync.ts:132-145, 203-214, 303-314, 408`
- **代码位置**：`fetchTushareDailyPricesByDate` 结果直接 `String(price.openPrice)` 等 map 为 `StockDailyPriceUpsert` 字符串行写库，**不经过 `toCanonicalBar`，也不经过 `validateMarketBar`**。
- **为什么是问题**：
  - OHLC 矛盾（high < max、low > min）、负 amount/volume、缺失 preClose 均可原样落库。
  - `String(undefined) === "undefined"`、`String(null) === "null"`，缺失字段会以垃圾字符串污染 DB，而非 canonical 层的 `null`。
  - 数据质量三态（VALID / WARNING / INVALID）与 `parseNumericPrice` 的严格 null 语义在生产入库路径上形同虚设。
- **复现方式**：阅读 `stockPriceSync.ts` 的 4 处 `.map((price) => ({ ... String(price.x) ... }))`；全仓 grep `toCanonicalBar` / `validateMarketBar`，仅出现在 `data.test.ts` 与 `features.golden.test.ts`，生产入库路径 0 调用。
- **推荐修复**：入库前统一 `toCanonicalBar(row)` + `validateMarketBar(bar)`；`INVALID` 拒写并上报，`WARNING` 记录 provenance；读路径 `leaderCandidates.ts` 复用 `parseNumericPrice`（见 P2-F1）。

### P1-F4 — 涨停规则未统一（生产回测/模拟盘仍用 9.9% 近似）

- **文件**：
  - `server/realisticBacktest.ts:402` `entryOpenPrice >= signalClosePrice * 1.099`
  - `server/realisticBacktest.ts:514,518` `<= previousClosePrice * 0.901`
  - `server/paperTrading.ts:412` `openPrice >= signalClosePrice * 1.099`
  - `server/paperTrading.ts:516,520` `<= previousClosePrice * 0.901`
- **代码位置**：以上均为硬编码 ±9.9% 近似阈值。
- **为什么是问题**：
  - 权威规则 `server/data/boardRules.ts`（主板 10% / ST 5% / 创业板 20% / 科创板 20% / 北交所 30%）**未接入**实际回测/模拟盘路径，其注释明示"不回改，仅记录"。
  - `1.099` 阈值会把主板 9.9% 涨幅（如 10 → 10.99）误判为涨停；`0.901` 同理。且该硬编码完全无法处理 ST/创业板/科创板/北交所的差异化比例。
  - 这直接导致"涨停判断"在真实交易路径上失真（回测失真风险）。
- **复现方式**：主板 `prevClose=10`，`signalClose=10.99`（+9.9%）→ `10.99 >= 10*1.099=10.99` 被判为涨停，而真实涨停线是 `10*1.10=11.00`。
- **推荐修复**：将 `realisticBacktest.ts` / `paperTrading.ts` 的涨跌停判定统一替换为 `resolveLimitRules(code, name)` + `limitUpPrice/limitDownPrice`，消除硬编码。

---

## P2 Issues

### P2-F1 — 读路径重复实现数值解析

- **文件**：`server/leaderCandidates.ts:308-313`
- **位置**：`toPositiveNumber` / `toNonNegativeNumber` 与 `server/data/validation.ts:105` 的 `parseNumericPrice` 语义重复，形成两套解析逻辑。
- **推荐修复**：读路径 `buildLeaderCandidateDailyPriceMap` 统一走 `toCanonicalBar` 或 `parseNumericPrice`。

### P2-F2 — isStStock 正则过宽

- **文件**：`server/data/boardRules.ts:57-60`
- **位置**：`/ST|退/` 会误判任何含 "ST"/"退" 子串的普通名称（如 "STORE" 类）为风险警示。
- **推荐修复**：改为匹配 `^\*?ST` 前缀或显式 `退市` 关键词。

### P2-F3 — stock_daily_prices 缺少 (stockCode, tradeDate) 去重约束

- **文件**：`server/db.ts` 的 `upsertStockDailyPrices` 与对应 schema。
- **位置**：无数据库级唯一约束。`MarketBarSeries` 构造函数（`server/data/series.ts:56-59`）对同一日重复 bar 直接抛错，未来 Feature 层读取若遇重复行将崩溃。
- **推荐修复**：DB 端加 `UNIQUE(stockCode, tradeDate)`，upsert 用 `ON DUPLICATE KEY UPDATE`。

---

## P3 Issues

### P3-F1 — 测试环境失败需记录（ENVIRONMENTAL，非 Step 5 回归）

以下 15 条测试失败与 Step 5 数据/特征层无关，属既有环境问题，按规范记为 ENVIRONMENTAL，不计入 P0/P1：

- `server/marketData.test.ts`（4）— 依赖 MySQL/TiDB 连接，返回空结果。
- `server/limitUp.watch.test.ts`（4）— 依赖 DB。
- `server/limitUp.test.ts`（1，custom sector 持久化）— 依赖 DB。
- `server/tushare.secret.test.ts`（1）— 缺 `TUSHARE_TOKEN` 环境变量。
- `server/tushareTradingCalendar.test.ts`（3）— Tushare 网络/限频超时。
- `server/stockPriceSyncPage.test.ts`（2）— `client/src/pages/StockPriceSync.tsx` 页面文件缺失（未同步查询页尚在开发中，ENOENT）。

---

## 逐项审计结论与依据

### 一、架构（FAIL）
声明链路 `Raw→Adapter→Canonical→Validation→Time-aware→Feature→Snapshot→Strategy→Sizer→Risk→Backtest Core` 的"特征→策略"与"数据校验→入库"两段在**生产路径断开**：Feature 层无生产调用方（F1）、策略不消费特征（F2）、入库不经过校验（F3）。Step 2/4 的 Sizer→Risk→Core 链路正常。

### 二/三/四、P0 Future Leakage / Future Mutation / Future Removal（PASS）
审计员自建破坏性测试（独立脚本，运行后已删除）：
- **Future Mutation Test**：T-3..T+2 构造 `Feature(T)`，将 T+1/T+2 的 close/high/low/volume/amount 极端放大（×100 / ×0.01 / ×1000），`Feature(T)` 逐字节 JSON 一致。
- **Future Removal Test**：T-20..T+20 构造，删除 T+1..T+20 后 `Feature(T)` 一致。
- 覆盖 SMA / Return / AvgAmount / Volatility / LimitUp 五项。
- 结论：库内 `visibleBars` 时间过滤封堵严密，无未来数据泄漏。

### 五、Decision-Time Future Leakage（PASS）
`server/data/series.ts:30-40` 的 `visibleBars`：`point="open"` 时 `timestamp < decisionDate`，整根 T bar 排除；T 的 high/low/close/volume/amount 不可见（比"仅屏蔽当日 high/low/close"更保守，无歧义）。探针验证通过。

### 六、Canonical Data（PASS）
`server/data/types.ts` 统一口径：price 元/股、volume 手、amount 千元、turnoverRate %（成交额/流通市值×100），并以 `MARKET_DATA_UNITS` 常量收敛。全仓仅存在 `amount * 1000`（千元→元）这一处一致的容量换算（`engine/portfolio.ts:131`、`paperTrading.ts:440`、`risk/policies.ts:100`），无 `/10000`、`volume/100` 等隐式换算。无歧义。

### 七、Data Validation（FAIL）
库内校验（`server/data/validation.ts`）正确覆盖全部 5 个 case：
- high < max(open,close,low) → `HIGH_LT_MAX` INVALID
- low > min(open,close,high) → `LOW_GT_MIN` INVALID
- volume < 0 → `NEGATIVE_VOLUME` INVALID
- amount < 0 → `NEGATIVE_AMOUNT` INVALID
- turnoverRate 非法 → `TURNOVER_RATE_OUT_OF_RANGE` INVALID
且无 `|| 0` / `?? 0` 静默填零（validation.ts 与 types.ts 明确禁止，adapter 的 `parseNumericPrice` 返回 null 而非 0）。
但**校验未接入入库路径**（P1-F3），故整体 FAIL。

### 八、Time Series（PASS）
`MarketBarSeries`（`server/data/series.ts`）不可变、按 timestamp 升序、同日重复抛错；`window(count)` 取末尾 count 根（已在 asOf 过滤后的可见切片内），`current()/previous(n)/at(offset)` 语义明确。Feature 层一律经 `series.window()/current()` 访问，无直接 `bars.slice/filter/sort`。

### 九、Feature Contract（PASS）
`server/features/contract.ts` 具备 `id / version / requiredBars / calculate`，且有 `params(config) / availability / status(READY|INSUFFICIENT_DATA|INVALID_DATA)`。契约完整。

### 十、Feature Registry（PASS）
`server/features/registry.ts`：重复注册抛错、未知 id 抛错、`list()` 字典序稳定排序；无 DB/Network/Date.now/Math.random 依赖。

### 十一、Warm-up（PASS）
探针：SMA20 输入 7 根 → `INSUFFICIENT_DATA`，`requiredBars=20 / availableBars=7 / value=null`，无偷偷降级、无补零、无补未来数据。

### 十二、数学正确性（PASS）
手工验证 closes=[10,11,12,13,14]：
- SMA3 = mean([12,13,14]) = 13 ✓
- Return(3) = close[T]/close[T−3] − 1 = 14/11 − 1 ✓
- Volatility(3) = sampleStandardDeviation(近 3 个日收益) ✓
统计函数复用 `shared/quant-stats.ts`（`mean`/`sampleStandardDeviation`），Feature 层未重复实现 mean/std/variance。

### 十三、Limit-Up 规则（FAIL）— 见 P1-F4。

### 十四、市场板块规则（PASS，库内）
`boardRules.ts`：主板 10%、ST 5%、创业板 300/301 20%、科创板 688/689 20%、北交所 30%，无法识别返回 `supported=false`（null），不假装支持。库内正确。

### 十五、复权审计（PASS）
`types.ts` 明确"当前仅未复权 raw"；`toCanonicalBar` 恒置 `adjustment:"raw"`；全仓无 qfq/hfq/adj_factor。收益、涨停判断、Feature、回测统一使用未复权价，无复权/未复权混用。

### 十六、Feature 数学 Future Leakage（PASS）
特征实现无全历史归一化/标准化/排序后再取 T 的模式；窗口均值经 `series.window(count)`（已 asOf 过滤）取末尾窗口，无未来数据参与。

### 十七、Strategy 绕过 Feature Layer（FAIL）— 见 P1-F2。

### 十八、Feature 副作用（PASS）
`server/features/` 下无 `portfolio / createOrder / createFill / buy / sell / RiskManager` 调用（仅测试文件中有 portfolio 夹具）。

### 十九、Feature 外部依赖（PASS）
`server/features/` 下无 `fetch / axios / http / database / prisma / supabase` 依赖。

### 二十、Determinism（PASS）
探针 100 次运行 JSON 深相等；`server/features/`、`server/data/` 无 `Date.now / Math.random`（validation.ts 的 `new Date` 仅用于日期合法性解析，确定性）。golden test 单独运行 3 次均 3/3 通过，无顺序依赖。

### 二十一、Instance Isolation（PASS）
探针：period=20 与 period=60 实例 `requiredBars/params` 互不影响；`FeatureRegistry` 不保存跨实例可变计算状态。

### 二十二、Feature Snapshot（PASS）
`server/features/snapshot.ts` 绑定单一 symbol + 单一 `asOf{decisionDate,decisionPoint}`；pipeline 在同一 `series` 上循环计算所有 feature，共享同一可见切片，无跨时点混入。

### 二十三/二十四/二十五、Step 2/3/4 Regression（PASS）
- Step 2（engine）：`engine.test.ts`(29) + `engine.fix.test.ts`(16) = 45 全过。
- Step 3（strategy）：`contract.test.ts`(10) + `registry.test.ts`(6) + `leaderCandidateBaseline.test.ts`(11) 全过。
- Step 4（risk）：`risk.test.ts`(35) + `risk.fix.test.ts`(15) = 50 全过。
- 策略层只产出 Signal（意图），经 `toCoreSignals` 桥接，不直接交易；`runBacktestWithRisk` 默认注入 RiskManager，无 Risk 绕过。

### 二十六、Golden Pipeline（FAIL）
`features.golden.test.ts` 3/3 通过（机制上 Raw→Adapter→Canonical→Validation→Feature→Snapshot→Strategy→Sizer→Risk→Core 可跑通），但其"全链路"用例使用的是 `leaderCandidateBaseline` 策略，该策略**忽略 features**——Feature Snapshot 虽被计算，却未影响策略决策，存在 Feature bypass。故不构成"无绕过"的完整链路证明。

### 二十七、代码扫描（PASS，库内）
`server/features/` 与 `server/data/` 内：无 `TODO/FIXME/HACK`、无 `@ts-ignore/@ts-expect-error`、无 `as any`、无 `Date.now/Math.random`（日期解析除外）、无 `fetch/axios/http/database/prisma/supabase`、无 `portfolio.buy/sell/createOrder/createFill`、无直接 `bars.slice/filter/sort`（均在 `MarketBarSeries` 内）。

### 二十八、测试
- `npm test`（`vitest run`）：FAIL（475 passed / 15 failed / 6 files failed，全部为 ENVIRONMENTAL，见 P3-F1）
- `typecheck`（`tsc --noEmit`）：PASS（exit 0）
- `build`（`vite build` + esbuild）：PASS（exit 0）
- `lint`：NOT_AVAILABLE（package.json 无 lint script，无 eslint 配置）

---

## FINAL

**FAIL**

**失败根因（按优先级）**：
1. **P1-F1 + P1-F2**：Feature Pipeline 未真正接入，核心策略完全绕过 Feature Layer——Step 5 的"特征基础设施"在真实系统链路中既不生产、也不消费。
2. **P1-F3**：Data Adapter/Validation 未接入入库路径——数据质量三态在生产数据流上未生效。
3. **P1-F4**：涨停规则未统一——生产回测/模拟盘仍用 9.9% 近似，权威 boardRules 未接入。

上述均满足"P1 > 0 → FAIL"判定。**未来数据泄漏（P0）未发现**，库内实现（类型/单位/适配/校验/板块规则/时序/特征数学/Registry/快照/复权/确定性/隔离）经自建破坏性测试全部正确。

**审计员声明**：本次审计仅记录问题、给出修复方向，**未修改任何源码**（自建探针文件已删除）。
