# STEP 5 INDEPENDENT RE-AUDIT REPORT

- 项目：stock-limit-up-analyzer
- 审计轮次：Step 5 第二次独立 Re-audit（FIX 后工作区，未提交基线 commit a315ce0 之上）
- 日期：2026-09-05
- 审计者角色：独立 Quant System Auditor（只读 + 运行验证；**未修改任何生产代码/正式测试/migration/配置**）
- 审计方式：源码审计 + 全仓调用图追踪 + 动态测试 + 自构造破坏性 Future-Leakage / Decision-time / Golden 探针

> 结论预览：**FINAL = FAIL**。P0 = 0；但 P1 = 2（P1-F1、P1-F2 判定为仍 FAIL）。其余技术验证项（Future Leakage、Warm-up、BoardRules、Validation、P1-F3/P1-F4、P2-F1/F2/F3 代码侧、Determinism、Isolation、Step2/3/4 回归、typecheck、build）全部通过；15 条 npm test 失败与第一次审计基线逐项一致，无新增 CODE REGRESSION。

---

## 1. Architecture

当前工作区架构事实（源码证据，非开发报告自述）：

```
生产运行入口（真实 HTTP/调度链路）
  server/_core/index.ts、server/routers.ts、server/paperTradingScheduler.ts
  ├─ 上传/识别/涨停记录：limitUpRecords（OCR）
  ├─ 行情同步：stockPriceSync.ts（4+ 条入库路径）→ db.upsertStockDailyPrices
  ├─ 大盘数据：marketData / marketSync.ts
  └─ 回测 API：routers.getLeaderCandidateBacktest → db.getLeaderCandidateBacktest
        → leaderCandidates.buildLeaderCandidateBacktest → realisticBacktest.simulateRealisticTPlus1ToTPlus2
        （legacy 回测仍为生产页面真实数据源）

新引擎栈（Step2 Core / Step3 Strategy / Step4 Risk / Step5 Data+Feature）
  server/engine、server/strategy、server/risk、server/features、server/data、shared/quant-stats
  └─ 与生产入口的引用关系（grep 全仓，排除 *.test.*）：
       server/_core / routers.ts / paperTradingScheduler.ts → 无任何引用
       runStrategyEngineBacktest → 仅 strategyBacktest.test.ts 调用
       runFeaturePipeline        → 仅 pipeline.ts 定义 + strategyBacktest.ts（仅被测试可达）+ 测试
       buildStrategySignalProvider → 仅 adapter.ts 定义 + strategyBacktest.ts（仅被测试可达）+ 测试
       runBacktestWithRisk       → 仅 engine.ts 定义 + strategyBacktest.ts（仅被测试可达）+ 测试
       真实被生产引用的"新层"文件只有：shared/quant-stats.ts（纯统计）与
       server/data/boardRules.ts（经 realisticBacktest.ts / paperTrading.ts import，
       再经 engine/execution.ts 的 limitUpPrice/limitDownPrice 纯函数）。
```

类型体系：`CanonicalMarketBar`（server/data/types.ts）为唯一 canonical 市场数据形态；`MarketBar`（engine/domain.ts）为 Core 成交口径；`leaderCandidates.ts` 自维护 `LeaderCandidateDailyPrice` 读视图。三层单位一致（见 §2）。

---

## 2. Canonical Market Data

`server/data/types.ts` 明确规定：

| 字段 | 单位 | 来源/口径 |
|---|---|---|
| symbol | 带交易所后缀代码 | e.g. `002361.SZ` / `600001.SH` / `920xxx.BJ` |
| timestamp | 交易日 `YYYY-MM-DD` | dataTime |
| open/high/low/close/preClose | **元/股** | Tushare daily 原义（未复权） |
| volume | **手**（1 手 = 100 股） | Tushare daily vol 原义 |
| amount | **千元** | Tushare daily amount 原义 |
| turnoverRate | **%**（成交额/流通市值×100 项目口径） | 本项目数据源无交易所 turnover_rate → 一律 `null`，禁止伪造 |
| adjustment | 恒为 `"raw"` | 系统唯一支持未复权 |

隐式换算排查（`/100`、`*100`、`/10000`、`*10000`、`*1000`）：
- `engine/execution.ts` `amountAdjustedSlippageBps`：amount（千元）阈值 100_000 = 1 亿元 —— 口径正确。
- `realisticBacktest.ts` 容量约束 `entryAmount * 1000 * ratio`（千元 → 元）—— 显式、正确。
- `risk/policies.ts` CapacityPolicy `amount * 1000 * ratio`（千元 → 元）—— 显式、正确。
- 未发现模块 A 用元、模块 B 用千元而未显式转换的路径。
- `basic.ts` 中 avgAmount 描述与 feature id 均声明 amount 单位千元。

**结论：单位体系统一（PASS）。** 遗留：`MARKET_DATA_UNITS` 有单一常量来源。

---

## 3. Data Adapter

`server/data/adapter.ts`：
- `toCanonicalBar(RawDailyPriceRow)`：DB varchar / Tushare number 统一解析；非法 → `null`（`parseNumericPrice`），不填 0；`turnoverRate: null`、`adjustment: "raw"`。
- `toEngineMarketBar(CanonicalMarketBar)`：降级为 Core `MarketBar`（丢弃 volume/turnover/adjustment，显式注释）。

动态验证（探针 H）：DB/Tushare 行混用 varchar 与 number 均正确归一化；`"abc"`、`"  "`、`null`、`undefined` 均 → `null`。
**PASS。**

---

## 4. Data Validation

`server/data/validation.ts` 三态：
- **VALID**：不变量全满足。
- **WARNING**：可空字段缺失（`FIELD_MISSING`）等——绝不静默升级为 VALID。
- **INVALID**：`NOT_POSITIVE`/`NOT_FINITE`/`HIGH_LT_MAX`/`LOW_GT_MIN`/`HIGH_LT_LOW`/`NEGATIVE_VOLUME`/`NEGATIVE_AMOUNT`/`TURNOVER_RATE_OUT_OF_RANGE`/`EMPTY_SYMBOL`/`INVALID_DATE`。

动态探针（9 类缺陷全测，全部符合预期）：

| 场景 | 结果 |
|---|---|
| high < max(open,close,low) | INVALID → 拒写 |
| low > min(open,close,high) | INVALID → 拒写 |
| volume < 0 | INVALID → 拒写 |
| amount < 0 | INVALID → 拒写 |
| open 缺失 | WARNING；DB NOT NULL → **UNPERSISTABLE 拒写** |
| close 缺失 | 同上 → **UNPERSISTABLE 拒写** |
| preClose 缺失 | 同上 → **UNPERSISTABLE 拒写** |
| 可空字段 null / undefined | WARNING 放行，落库 DB `null`，**留质量 provenance** |
| 正常行 | VALID 入库 |

`toValidatedStockDailyPriceUpserts` 的 `text()` 保证任何字段都不产生 `"undefined"` / `"null"` 字面量（已断言）。
**PASS（生产入库 4 条路径 + 上传补全 + 手动缺失同步均已接入；唯一遗漏见 RA-003）。**

---

## 5. Time-aware Access

`server/data/series.ts`：
- `visibleBars(bars, decisionDate, point)`：`close` → 含 `<= decisionDate` 整根 bar；`open` → 仅 `< decisionDate`（当日整根 bar 不可见，保守且无歧义）。
- `MarketBarSeries`：构造时按 timestamp 稳定升序、**同日重复 bar 抛错**（数据质量铁律）；`current/previous(n)/at/window(n)/getByDate/firstDate/lastDate` 全部基于已排序不可变数组，无 `slice/filter/sort` 自行时间判断的旁路。
- Feature 只允许经 `series` 访问窗口（`basic.ts` 全走 `series.window(count)`）。

**PASS。**

---

## 6. As-Of / Availability

- 决策时点语义集中定义：`DecisionPoint = "close" | "open"`（series.ts）；Feature 元数据带 `availability`。
- 动态验证（探针 C）：
  - `open` 决策可见序列 = `T-3..T-1`，T 当日 bar 完全不可见；
  - 把 T 当日 open/high/low/close/volume/amount 改成天价 → `open` 快照逐字节不变；
  - `open(T)` 的 feature 值与 `close(T-1)` **完全一致**（asOf 本身当然不同，这是快照语义而非渗漏）。
- Golden 层 `featuresOfDate` 与 `signalTime` 严格同 `decisionDate`，`decisionPoint="close"`（strategyBacktest.ts）。
- 策略侧额外断言 `snapshot.asOf.decisionDate === signalTime && decisionPoint === "close"`，不满足即不视为已确认（leaderCandidateBaseline.ts:120-126）。

**PASS。**

---

## 7. Feature Contract

`server/features/contract.ts`：
- `FeatureStatus = "READY" | "INSUFFICIENT_DATA" | "INVALID_DATA"`；
- `FeatureResult`：value + status + requiredBars + availableBars + note；
- `FeatureFactory/Instance/Metadata/Params` 完整，`requiredBars` 随参数派生；
- 铁律注释与类型约束：无 DB/Network/时间/随机；只读入参。

**PASS。**

---

## 8. Feature Registry

`server/features/registry.ts`：
- `register` 重复 id 抛错；`get` 未知 id 抛错；`list` 稳定字典序。
- 动态验证（探针 E）：`register(A); register(A)` 第二次抛错；`get("does-not-exist")` 抛错；A(period=20) 与 B(period=60) 实例参数隔离，互不污染。
- 无 DB/Network/Date.now/Math.random（源码扫描 0 命中）。
- 说明：`pipeline.ts` 每次运行调用 `registerBasicFeatures(featureRegistry)`（幂等，`registry.has` 判重），registry 只保存工厂定义、不保存计算状态，判定为可接受的设计耦合（非问题）。

**PASS。**

---

## 9. Feature Pipeline

`server/features/pipeline.ts`：
- 输入原始 canonical bars → `visibleBars` 过滤 → `MarketBarSeries` → 逐 feature `calculate` → 统一 `asOf` 的 `FeatureSnapshot`。
- 无副作用：不修改入参、不访问 Portfolio/Order/Fill/DB/Network/全局计算状态（静态扫描 0 命中）。
- 生产可调用方：**仅 `server/strategy/strategyBacktest.ts`（见 §18 RA-001，该模块自身无真实生产调用方）**。

**结论：Pipeline 实现正确、未来安全、无副作用；但"进入生产链路"未达成 → 见 P1-F1（FAIL）。**

---

## 10. Feature Snapshot

`server/features/snapshot.ts`：
- `FeatureSnapshot`（symbol + asOf + features）；`FeatureSnapshotBundle`（同 asOf 按 symbol 组织）。
- `createFeatureSnapshotBundle`：任一成员 asOf 与声明不一致即抛错。动态验证（探针 G）：同 asOf OK；混入 D1/D2 成员抛错。
- 只读语义：**类型层面只读（readonly），运行期无 `Object.freeze`**（RA-007，P3）。

**PASS（含 RA-007 P3 备注）。**

---

## 11. Warm-up

动态验证（探针 F）：
- sma20 只有 5/10 bars → `INSUFFICIENT_DATA`，value=`null`，requiredBars=20，availableBars=5/10 —— **不是 0、不是 SMA10、不拷贝最后值、不补未来**。
- `INVALID_DATA`：窗口内 close 字段缺失 → INVALID（既有 features.pipeline.test 亦覆盖）。

**PASS。**

---

## 12. Future Leakage（最高优先级，独立破坏性测试）

自构造 adversarial 探针 + 既有破坏性测试（features.pipeline.test.ts）双重验证，数据 T-4..T+4：
- **A**：正常数据计算 `Feature(T)` 并记录。
- **B**：仅篡改 `T+1/T+2`（及更远的 open/high/low/close/volume/amount 为极端值 0.001/9999…）→ `Feature(T)` 逐字节一致。
- **C**：删除 `T+1` 之后全部 bars → `Feature(T)` 与 A 完全一致。
- 覆盖：sma / return / avgAmount / avgVolume / volatility / amplitude / limitUpHit。

**PASS（T 点计算完全不依赖 T+1/T+2 的任何未来信息；探针 A/B/C 全部通过，探针有效性亦被"D2 视角 vs D1 视角 limitUpHit=1 vs 0"证明）。**

---

## 13. Decision-time Leakage

- 模拟 T 日 09:30（decisionPoint="open"）：可见数据以 T-1 收盘为界；T 当日 open/high/low/close/volume/amount 一律不可见（visibleBars + 探针 C）。
- Golden 层若传入 `asOf=T + decisionPoint=close`，则 T 日整根 bar 可见 —— 这是"收盘后决策"语义，调用方（strategyBacktest）把信号日定义为收盘后，且 T+1 开盘成交，不存在"T 09:30 拿到 T 收盘价"的路径。
- 策略 gate 强制 asOf 对齐（decisionDate===signalTime、point==="close"），API 层面不允许 asOf=T 的 close 进入 T 日 09:30 场景。

**PASS。**

---

## 14. Feature Mathematics

`server/features/basic.ts` 统计一律复用 `shared/quant-stats`：`mean`、`sampleStandardDeviation`；无第二套 variance/std/sampleVariance（全仓 grep `sampleStandardDeviation|sampleVariance` 仅命中 shared 与 basic.ts 的复用点；downsideRisk/factorCombination/technicalFactors/overfittingGuard 的重复实现已在 FIX 前的去重重构中删除并统一 import shared）。

手算动态验证（探针 A，独立断言，未读测试预期）：
- SMA3 = (10.2+10.5+10.4)/3 = 10.36666… ✓
- Return3 = close[T]/close[T−3] − 1 = 10.4/10 − 1 = 0.04 ✓
- AvgAmount3 = 30000 ✓；AvgVolume3 = 3000 ✓
- Volatility3 = sampleStd(3 个日收益) 与 quant-stats 输出逐位一致 ✓（未年化，period+1 bars）
- limitUpHit：close=11（limitUpPrice(10,0.1)）→ READY=1；close=10.99 → 0。

**PASS。**

---

## 15. Limit-Up Rules

权威源已收敛：`server/data/boardRules.ts`（`resolveLimitRules` / `isPriceAtLimitUp` / `isPriceAtLimitDown` / `isLimitUpBar` / `isLimitDownBar`，价格计算 re-export 自 engine/execution 的 `limitUpPrice`/`limitDownPrice`）。

全仓近似常量搜索（排除注释与测试）：**无可执行的 1.099 / 0.901 / 1.10 近似残留**；`realisticBacktest.ts` 与 `paperTrading.ts` 的全部涨跌停判定点（开盘止损 / 追买拦截 / 跌停出清 / 一字跌停 / 一字涨停）均已替换为 `isPriceAtLimitUp/Down(...) === true`。规则不可判定返回 null → 一律视为"不能确认触及"，不做伪 10% 假设。

动态表（探针 D，全过）：

| 板块 | prevClose | 涨停价 | 边界 |
|---|---|---|---|
| 主板非 ST | 10 | 11.00 | 10.99 非涨停 / 11.00 涨停 |
| 主板 ST（5%） | 10 | 10.50 | 10.49 非 / 10.50 是 |
| 创业板 300/301 | 10 | 12.00 | 11.99 非 / 12.00 是 |
| 科创板 688/689 | 10 | 12.00 | 11.99 非 / 12.00 是 |
| 北交所 920/8xx/4xx | 10 | 13.00 | 12.99 非 / 13.00 是 |
| 跌停对称 | 10 | 主板 9.00 / 创业板 8.00 / 北交所 7.00 | 9.01/8.01/7.01 非 |
| 无法归类代码 | - | - | null（不假装支持） |

遗留备注：
- RA-008（P3）：`limitUpPrice = prevClose*(1+ratio)` 未做 0.01 元 tick 舍入；当 prevClose 两位小数 × 比例出现第三位小数时（如 10.12 → 11.132），与交易所"四舍五入到分"的实际涨停价可能差一分（边界错判风险）。该函数为 Step2 已验收实现，本次列为口径待确认项，不影响本审计已按"一致权威"判定的结论。
- RA-010（P3）：新引擎 `NextOpenExecutionModel` 默认 `LimitRules={10%,10%}`（全板块一致），真实板块比例须由调用方注入 `resolveLimitRules` 结果；当前新引擎回测默认 `blockLimitUpBuy=false` 且仅为测试驱动，尚无真实错误决策发生；生产接线时必须注入（见 §18/§30）。

**PASS（含 RA-008/RA-010 备注）。**

---

## 16. Adjustment Handling

- 系统只摄入/存储 **未复权（raw）** 日线（schema 注释"未复权"；canonical `adjustment` 恒为 "raw"）。
- 涨停判定一律基于当日 bar 的 raw `close` 与 raw `preClose`（交易所除权除息后参考价语义），不存在"adjusted close → 真实涨停价"路径。
- 无前复权/后复权摄入管线（Tushare daily 未复权；无 adj_factor 存储），故不存在混用窗口。
- Legacy `realisticBacktest` 的 T+1 追买用 `signalClosePrice` 作 referencePrice（除权日由既有 `detectExRights` 标记样本）—— legacy 口径，非新层问题。

**PASS（在当前"仅 raw"范围内）。**

---

## 17. Strategy Integration

- `leader-candidate-baseline`（唯一内置真实策略）`evaluate` 在 `featureMode="limit-up-confirm"` 时真正读取 `context.features`（leaderCandidateBaseline.ts:157-187），逐候选取 bundle/snapshot 并强制 asOf 对齐；Feature 缺失/未确认 → 不进入输出。
- 当 config 声明需 Feature 但 `features === undefined` → **返回空决策 + insufficientData=true**，绝不静默降级为未过滤输出（动态探针 I 已验证）。
- 策略没有重复自算 SMA/Return/Volatility/Volume/Amount/涨停 —— 需要指标时从 Feature 输入读取。
- `featureMode` 默认 `"off"`：旧语义零影响（兼容性选择）。
- **生产配置问题见 §19 RA-002（默认永远 off + 无生产调用方开启）。**

**实现层 PASS；生产接入层 FAIL（见 RA-002）。**

---

## 18. P1-F1 Verification — Feature Pipeline 是否真正进入生产链路

**必须回答的问题逐项结论：**

1. `runStrategyEngineBacktest` 是否真正被生产代码使用？ → **否**。全仓非测试调用方为 **0**；唯一调用方是 `server/strategy/strategyBacktest.test.ts`。
2. 还是仅仅被 test 使用？ → **是（仅被测试使用）**。
3. `buildStrategySignalProvider` 的 `buildFeatures` 是否存在非测试真实调用方？ → **否**；注入点仅 `strategyBacktest.ts:200`（该函数自身仅被测试可达）。
4. FeatureSnapshot 是否进入 StrategyContext？ → 是（在 `runStrategyEngineBacktest` 内成立）。
5. Strategy 是否真的收到 features？ → 是（同 4，但仅测试驱动路径）。
6. Feature 是否真的影响真实生产策略决策？ → **未发生**：没有任何生产执行路径运行该组装点。
7. 是否存在另外一套旧的 production signal path 绕过 Feature Pipeline？ → **是**：生产 API/回测页的真实路径是 `routers.getLeaderCandidateBacktest → db.getLeaderCandidateBacktest → buildLeaderCandidateBacktest → realisticBacktest`（legacy 五策略实验/前向 paperTrading 均走 legacy），该路径完全不经 Feature Pipeline。新引擎（engine/risk/strategy/features/data 除 boardRules/quant-stats 外）与生产入口零引用（§1）。

**判定：P1-F1 = FAIL（RA-001）**

- 依据（审计规则原文语义）："存在生产函数 ≠ 生产链路已接入"；`strategyBacktest.ts` 正是一个"新增但没有真实调用方的 wrapper"。修复仅把孤儿点从 `runFeaturePipeline` 上移了一层到 `runStrategyEngineBacktest`，后者仍无生产调用方。
- FIX 报告 §11.1 亦自认：暴露 HTTP/页面入口属并行开发线，未完成。这与审计源码结论一致。

---

## 19. P1-F2 Verification — Production Strategy 是否真正消费 Feature

追踪（谁构造 config / 谁注册 / 谁调用 / 传什么 featureMode）：
- `featureMode` 生产代码命中点：仅 `leaderCandidateBaseline.ts`（default `"off"`、normalizeConfig、evaluate 分支）与 `strategyBacktest.ts`（类型注释）。
- 传入 `featureMode:"limit-up-confirm"` 的位置：**全部在测试文件**（strategyBacktest.test.ts）。
- 真实生产路径（routers/db.getLeaderCandidateBacktest/paperTrading）**不经过** leader-candidate-baseline；即使未来接线默认也是 `"off"`。
- 动态验证（探针 I + strategyBacktest.test.ts，行为正确性确认）：同候选池同行情下 `off=3 单 / limit-up-confirm=1 单`；修改价格库输入（B 收盘 10.20→11.00）→ 决策从排除变纳入；`config 需 Feature 但缺失` → `insufficientData=true` 空决策；X 的 D2（未来）涨停不影响 D1 决策。
- 但按审计判定标准："如果只能手动给 test config 而真实 production config 永远是 off → 记录为 P1。" → 精确命中。

**判定：P1-F2 = FAIL（RA-002）**

> 补充：P1-F2 的"静默降级"要求已满足（缺失 Feature 时策略明确 insufficientData/空决策，不会静默降级为未过滤输出）——本项通过的是"缺失保护语义"，FAIL 的是"生产接入"。

---

## 20. P1-F3 Verification — Data Adapter / Validation 是否进入生产入库

- `server/stockPriceSync.ts` 全部入库路径（syncCandidateDailyPrices / syncCandidateDailyPricesForDate / syncCandidateDailyPricesForDateRange / syncCandidateDailyPricesForUpload）与缺失手动同步，均统一经 `toCanonicalBar → validateMarketBar → toValidatedStockDailyPriceUpserts`（INVALID 拒写、UNPERSISTABLE 拒写、WARNING 放行+provenance、可空字段落 DB null）。
- 全仓 `String(price.openPrice)` 等直接字符串写库搜索：`server/` 与正式运行路径 **0 命中**；唯一残留为 **`scripts/backfill_high_volume.ts`**（运维脚本，Raw → String → DB 绕过 canonical/validation，潜在 `"undefined"/"null"` 字面量污染）→ **RA-003（P2）**。
- 9 类缺陷动态验证全部通过（§4）。
- upsert 统一走 `db.upsertStockDailyPrices`（唯一 DB 写入点 db.ts:1018）。

**判定：生产同步运行时路径 = PASS；全仓无绕过目标 = FAIL（遗留 RA-003，P2，非自动运行路径）。**

---

## 21. P1-F4 Verification — 9.9% 硬编码是否退出执行逻辑

- `realisticBacktest.ts` 与 `paperTrading.ts` 全部涨跌停判定替换为 `isPriceAtLimitUp/Down`（§15）；测试边界已按真实权威阈值修正（10.99 伪涨停→11.00），属有意的规则修正而非掩盖。
- 全仓搜索 1.099/0.901：仅注释与测试文字，无可执行近似。
- 无 Feature/Strategy/LeaderCandidates 侧第二套涨停逻辑（grep 证实 ST/比例判定只存在于 boardRules）。

**判定：PASS。**

---

## 22. P2-F1 Verification — 数值解析统一

- `leaderCandidates.ts` 已删除 `toPositiveNumber/toNonNegativeNumber` 局部实现，`buildLeaderCandidateDailyPriceMap` 统一走 `data/validation.parsePositivePrice / parseNonNegativeNumber`；全仓无残留（仅注释）。
- 语义核对：price>0（0/负 → null）、volume≥0、amount≥0 与 canonical validation 一致；读路径"open 与 close 均无效才丢交易日"业务语义保留（leaderCandidates.ts:306-327）。
- 遗留备注：legacy 读 map 把非法值视为缺失（null）而新层 validation 判 INVALID 拒行 —— 两条路径语义不同但各自内部一致，属既有设计（P3 观察项，不计问题）。

**判定：PASS。**

---

## 23. P2-F2 Verification — ST 正则

动态验证（探针 D）：`ST中安/ST 舍得/*ST金洲/退市海润/XX退市整理/纯 ST` → true；`STORE 股份/MYSTAR/南钢股份/华谊兄弟/null/""` → false；`resolveLimitRules("600001.SH","STORE 股份")` → 10%（不误判 ST）。与审计要求完全一致。
- 退市关键词仅 `退市`（退市整理/已退市），未过宽。

**判定：PASS。**

---

## 24. P2-F3 Verification — (stockCode, tradeDate) 唯一约束

代码侧验证（真实 SQL / schema / 逻辑）：
- drizzle schema：`uniqueIndex("uq_stock_daily_price_stock_date").on(stockCode, tradeDate)`（schema.ts）。
- 实际迁移 SQL：`drizzle/0008_peaceful_king_bedlam.sql` 含 `ALTER TABLE stock_daily_prices ADD CONSTRAINT uq_stock_daily_price_stock_date UNIQUE(stockCode, tradeDate)`；0009–0013 均未删除该约束。
- `upsertStockDailyPrices` 的 `ON DUPLICATE KEY UPDATE` 依赖该唯一键，全关键字段覆盖（db.ts:1018-1032）。
- 运行时兜底 `ensureStockDailyPricesUniqueIndex`：幂等、进程内一次；已存在 → 完成；Duplicate entry → 先按最小 id 清理重复再建索引；DDL 失败 → 告警降级不阻塞主路径（RA-004）。

**本环境无 MySQL/TiDB：运行期唯一约束行为无法实测。**

**判定：CODE VERIFIED（schema/migration/upsert/兜底）；RUNTIME DB VERIFICATION = BLOCKED BY ENVIRONMENT。** 按审计规则该项不能自动判 PASS，须在部署环境执行迁移 0008 后复核（RA-009，环境阻塞项）。

---

## 25. Step2 Regression

- `server/engine/*` 全量测试通过（engine.test 29 + engine.fix.test 16 = 45）。
- Feature 接入未改变成交价格/数量/费用/滑点/Portfolio 会计（新引擎与 Step2 语义零改动，strategyBacktest/golden 中 quantity=100、APPROVE、成交价=next-open+滑点 断言通过）。
- 探针 I：`featureMode=off` 时决策与成交集合与旧语义完全一致（3 单），证明 Feature 门控关闭时对 Core 零影响。

**PASS。**

---

## 26. Step3 Regression

- Strategy Contract / Registry / Adapter 测试通过（contract.test 10 + registry.test 6 + leaderCandidateBaseline.test 11）。
- Feature 输入契约收窄为 `FeatureSnapshot | FeatureSnapshotBundle` 后 legacy adapter 行为未破坏（buildLeaderCandidateDataViewForDate 与 toCoreSignals 测试全绿）。
- Strategy 未获得 DB/Network/Portfolio 可变能力（源码静态扫描 0 命中；context 只读）。

**PASS。**

---

## 27. Step4 Regression

- risk.test 35 + risk.fix.test 15 全过；Position Sizer（Fixed Quantity / Fixed Capital / Fixed Weight / Risk Capped）与 RiskManager（APPROVE/RESIZE/REJECT、Max Position、Exposure、Cash、Lot Size）回归通过。
- Feature 未与 Risk 耦合：risk 层无任何 feature import（grep 证实）；Risk 只消费 context（价格/权益/现金/参考成交额/成本）。

**PASS。**

---

## 28. Determinism

- Feature Pipeline 相同输入运行 100 次 → 逐字节一致（探针 J + features.pipeline.test 100 次）。
- `runStrategyEngineBacktest` 相同输入两次运行结果深度相等（strategyBacktest.test #6）。
- 新层源码无 `Date.now/Math.random`（静态扫描 0 命中；engine/features 头注释明确禁止）。生产 legacy 模块的 `Date.now` 仅用于缓存 TTL/日志等，不进 Feature/Strategy/Decision。

**PASS。**

---

## 29. Instance Isolation

- 探针 E：A(config=20) / B(config=60) 交替执行、参数与 requiredBars 互不影响；重新 create(60) 仍为 60。
- 每次 `runBacktest` 创建独立 Portfolio（engine.ts 头注释 + 代码 new Portfolio）；`runStrategyEngineBacktest` 内部缓存为函数局部（viewCache/featureCache）。

**PASS。**

---

## 30. Golden Pipeline

可运行性（独立探针 I 复现，非 mock）：
`Raw rows → toCanonicalBar → validateMarketBar → runFeaturePipeline(close) → FeatureSnapshotBundle → buildStrategySignalProvider(buildFeatures) → leader-candidate-baseline(featureMode=limit-up-confirm) → toCoreSignals → runBacktestWithRisk(默认 RiskManager) → Approved Order → Backtest Core 成交` —— 使用**真实 Production Strategy（leader-candidate-baseline）**而非 featureProbeStrategy；Feature 真实改变决策（1 单 vs 3 单；B 价格变化 → B 纳入）；成交时间 = D1 信号 → D2 开盘（T+1）；quantity=100 全 APPROVE。

**但 Golden Pipeline 目前只在测试驱动下运行**：无生产入口（routers/调度/页面/脚本）调用 `runStrategyEngineBacktest`。逻辑链路完整且正确，但"生产 Golden 链路"尚未接线 —— 该缺口正是 RA-001/RA-002（P1-F1/F2）。

**判定：能力层 PASS / 生产接线 FAIL（并入 P1）。**

---

## 31. Static Audit

全仓搜索（server/features、data、strategy、engine、risk、shared/quant-stats 非测试文件）：
- `TODO / FIXME / HACK`：0。
- `any / as any / @ts-ignore / @ts-expect-error`：0（contract.ts 的 `AnyStrategy` 用 `unknown` 边界，非业务 any）。
- `Date.now / Math.random / new Date(now)`：0（data/validation 的 `new Date(字符串)` 仅做日期格式合法性解析，确定性）。
- `fetch / axios / prisma / supabase / database`：Feature/Strategy/Risk 层 0。
- `portfolio.buy/sell / createOrder / createFill`：仅存在于 engine.ts（Backtest Core 职责：把 Fill 应用到 Portfolio）与 execution 注释；Strategy/Feature/Risk 均 0。
- Feature 层对 bars 只经 `MarketBarSeries.window`，无直接 `bars.slice/filter/sort` 时间窗口旁路。

**PASS。**

---

## 32. npm test

`npx vitest run` 实测：**499 passed / 15 failed（6 files），52 test files（46 passed / 6 failed）**。

15 条失败清单与第一次审计基线**逐一相同**，且失败堆栈均与 Step5 代码无关：

| 文件 | 条数 | 失败根因（堆栈核实） | 判定 |
|---|---|---|---|
| marketData.test.ts | 4 | 写入/读回均返回空（DB 不可用，getDb→null） | ENVIRONMENTAL |
| limitUp.watch.test.ts | 4 | watch 状态写入无效（DB） | ENVIRONMENTAL |
| limitUp.test.ts | 1 | custom sector 持久化 null（DB） | ENVIRONMENTAL |
| tushare.secret.test.ts | 1 | `TUSHARE_TOKEN` 未设置 | ENVIRONMENTAL |
| tushareTradingCalendar.test.ts | 3 | fetch 外部接口 5s 超时（网络/限频） | ENVIRONMENTAL |
| stockPriceSyncPage.test.ts | 2 | `client/src/pages/StockPriceSync.tsx` ENOENT（页面属并行开发线，当前仅 StockSync.tsx） | ENVIRONMENTAL |

**无新增 CODE REGRESSION；Step5 相关 16 个文件 290 项测试全过。**

---

## 33. typecheck

`npx tsc --noEmit` → **exit 0，PASS**。

## 34. build

`npm run build`（vite build + esbuild server bundle）→ **exit 0，PASS**。

## 35. lint

package.json **无 lint script**（未提供 `npm run lint`）→ **N/A**（无法运行；如实记录，不作为通过/失败依据）。

---

## 36. P0

**P0 = 0。**
- 无 Future Leakage（§12 破坏性测试全过）。
- 无未来数据进入 Strategy Decision（§13）。
- Feature 不直接交易（无 portfolio.buy/sell 等，§31）。
- 核心时间语义正确（§5/§6）。
- 无生产数据路径绕过关键时间约束（新数据路径均经 visibleBars/asOf 过滤；legacy 生产路径与新层隔离，其时间语义由 Step1-4 既有审计负责）。

## 37. P1

**P1 = 2（均为 FAIL）：**

| Issue ID | 判定 | 说明 |
|---|---|---|
| RA-001（P1-F1） | **FAIL** | Feature Pipeline 仍未进入真实生产执行链路；`runStrategyEngineBacktest` 唯一调用方是测试文件（§18）。 |
| RA-002（P1-F2） | **FAIL** | 真实生产配置不消费 Feature：`featureMode` 默认永远 `"off"`，且没有任何非测试调用方以 `"limit-up-confirm"` 接线；唯一生产候选策略的决策未在任何真实生产运行中依赖 Feature（§19）。 |

## 38. P2

| Issue ID | Severity | File / 位置 | Root cause / 现象 | 影响 | 建议 |
|---|---|---|---|---|---|
| RA-003 | P2 | `scripts/backfill_high_volume.ts:34-47` | 运维回填脚本对 stock_daily_prices 直接 `String(price.*)` 写库，绕过 `toCanonicalBar/validateMarketBar`；若字段为 null/undefined 将产生 `"undefined"/"null"` 字面量 | 与 P1-F3 "全仓无绕过"目标冲突；会污染 Feature/Data 读取 | 脚本改走 `toValidatedStockDailyPriceUpserts`，或对可空字段显式判空写 null |
| RA-004 | P2 | `server/db.ts:973-1006`（ensureStockDailyPricesUniqueIndex） | DDL 失败仅 `console.warn` 后继续 upsert；若部署库未执行迁移 0008 且运行时 DDL 持续失败，`ON DUPLICATE KEY UPDATE` 将退化为普通 INSERT，重复行会持续写入；重复清理与建索引非事务（进程崩溃窗口） | 无唯一约束时重复写入会破坏 MarketBarSeries 唯一性（抛错）→ Feature 读取崩溃风险 | 部署后执行迁移 0008 复核；DDL 失败且存在重复数据时建议 fail-fast 或持久化告警，不静默继续 |
| RA-009 | P2（环境阻塞） | `drizzle/0008` / `db.ts` | 本环境无 MySQL/TiDB，唯一约束运行期行为无法实测 | P2-F3 只能 CODE VERIFIED，不能自动 PASS | 部署环境执行 `db:push`/迁移后复核唯一约束与幂等覆盖 |

## 39. P3

| Issue ID | File / 位置 | 内容 |
|---|---|---|
| RA-005 | `server/data/boardRules.ts:10-14` | 头部注释称 "legacy realisticBacktest 使用近似 1.099/0.901…行为已被既有测试锁定，不回改"——与当前代码（已全部替换为 isPriceAtLimitUp/Down）矛盾，属过时文档，易误导后续维护。 |
| RA-006 | `drizzle/schema.ts` stock_daily_prices | 冗余非唯一索引 `idx_stock_daily_price_stock_date(stockCode,tradeDate)` 与唯一索引同列重复，徒增写放大；可删除（唯一索引已覆盖该查询）。 |
| RA-007 | `server/features/snapshot.ts` | Snapshot/Bundle "只读"仅在类型层（readonly），运行期无 Object.freeze；若未来策略持有对象引用需注意（当前所有计算方均为新建纯对象）。 |
| RA-008 | `server/engine/execution.ts:95-100` | `limitUpPrice/limitDownPrice` 未按 0.01 元 tick 四舍五入；前收两位小数 × 比例出现第三位小数时与交易所实际涨停价可能存在一分边界差。属 Step2 已验收口径，建议部署前与数据口径复核。 |
| RA-010 | `server/engine/execution.ts:112-125` | NextOpenExecutionModel 默认 LimitRules 为全板块 10%；若新引擎以 `blockLimitUpBuy/Sell` 接入生产且股票含创业板/科创板/北交所，需按 `resolveLimitRules` 注入真实比例（当前默认 block=false 且仅测试驱动，暂无实际错误）。 |

另：Feature pipeline 每次运行向全局单例 `featureRegistry` 幂等注册基础特征（设计耦合，非缺陷）；快照 asOf 中的 decisionDate 在 open(T) 与 close(T-1) 必然不同（这是语义而非渗漏）。

---

## 40. FINAL

判定汇总（依据 §31 审计规则）：

| 条件 | 结果 |
|---|---|
| P0 = 0 | ✅ |
| P1 = 0 | ❌（P1-F1 / P1-F2 仍 FAIL） |
| Future Leakage 全部通过 | ✅ |
| Canonical Data 正确 | ✅ |
| Adapter 正确 | ✅ |
| Validation 真正进入生产 | ✅（server 同步运行时路径；全仓绕过遗留 RA-003 P2） |
| Time-aware / As-of 正确 | ✅ |
| Feature Pipeline 真正进入生产 | ❌（RA-001） |
| Production Strategy 真正消费 Feature | ❌（RA-002） |
| Warm-up 正确 | ✅ |
| Limit-Up Rules 正确 | ✅（含 RA-008 口径备注） |
| Adjustment Handling 正确 | ✅（raw-only 范围） |
| Feature Registry 正确 | ✅ |
| Feature Snapshot 正确 | ✅ |
| Determinism PASS | ✅ |
| Isolation PASS | ✅ |
| Golden Pipeline（能力）PASS /（生产接线）| ❌（并入 RA-001/RA-002） |
| Step2/3/4 Regression PASS | ✅ |
| typecheck PASS / build PASS | ✅ / ✅ |
| npm test 无新增 CODE REGRESSION | ✅（499/15 与基线逐一相同，15 条均 ENVIRONMENTAL） |

**FINAL = FAIL**

- **通过项（值得肯定）**：P1-F3（入库校验）、P1-F4（涨停规则统一）、P2-F1/F2/F3 代码侧、全部 Future-Leakage/Decision-time/Warm-up/Determinism/Isolation/数学正确性/板块动态/回归测试均实证通过；新引擎 Feature 接入的**工程能力已完整且正确**（同一调用路径下 Feature 真实改变决策、无静默降级、无未来渗漏），只差最后一步"真实生产调用"。
- **唯一阻塞项**：P1-F1 与 P1-F2 —— 即 **Feature/新引擎尚未接入任何真实生产执行入口，且无生产配置启用 Feature 门控**。二者同源：把 `runStrategyEngineBacktest` 接线到一个真实生产执行点（如回测 API/页面或 paper trading 前向模拟的替换路径），并在该生产配置中启用 `featureMode: "limit-up-confirm"`（或将 leader-candidate-baseline 的默认 featureMode 改为 limit-up-confirm 并回归旧调用方），同时把 legacy realisticBacktest 生产路径标注为"待迁移"，即可消除 RA-001/RA-002。
- **部署注意**：P2-F3 唯一约束需在真实 DB 执行迁移 0008 并复核；`scripts/backfill_high_volume.ts` 需改走 canonical 校验。

**审计范围声明**：本报告未修改任何生产代码、正式测试、migration 或配置。审计创建临时文件 `_audit_step5_reauth.mts`（独立探针，68 项断言全过）并已在审计结束后删除；未触碰其它文件。工作区既有 `_audit-probe.mts`（第一次审计遗留）未被改动。
