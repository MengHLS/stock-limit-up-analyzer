# Quant Trading Platform · Phase 0 Source Code Audit Report

> 项目：`stock-limit-up-analyzer`
> 阶段：Phase 0（只读审计，零代码改动）
> 审计日期：2026-09-05
> 审计原则：所有结论均基于实际源码 + 真实调用链，附文件:行号证据，可逐条回查。禁止任何推断。

---

## 1. Executive Summary

### 1.1 一句话结论

这是一个 **「涨停复盘 + 打板策略研究」系统**，其 point-in-time（时点数据）纪律在候选/连板/技术因子/风险分的主链上做得相当好（基本无未来函数），但距离「成熟量化研究平台」的核心差距不在"算得对不对"，而在 **统计可信度**（DSR 试验数硬编码、Sharpe 双定义、baseline↔riskPenalty 指标错配、OOS 反复曝光）+ **引擎与常量双份维护** + **db.ts / 路由 / 结果类型三处巨石**。

### 1.2 成熟度评分（0–10）

| 维度 | 分数 | 判定依据（关键证据） |
|---|---|---|
| **Data** | 6 | 多源录入+幂等同步+停牌/退市处理较完整；但数值列用 varchar、全表载入≥10处、冷启动 6–20min |
| **Factor** | 6 | 技术因子 PIT 正确、候选评分 Expert Rule 清晰；但评估宇宙=策略过滤后子集、因子评价与选股未隔离 |
| **Strategy** | 5 | Expert Rule 打分(42+24+10+8+16)透明；但参数前后端双份、52/0.35/65 硬编码散落 |
| **Backtest** | 5 | 成交-退出细节完善（滑点分层/一字涨跌停/盘中止损/除权检测）；但涨跌停价硬编码 1.099/0.901、不复权 |
| **Validation** | 3 | IC/ICIR/HAC/分位/衰减/WFA/DSR/PSR/MC 都有；但 DSR 试验数=30 硬编码、Sharpe 双定义、无 PBO、IID bootstrap |
| **Research** | 2 | 无实验台账、无冻结留出集、OOS 被 UI 反复"看着调参"、无参数稳定性热力图 |
| **Paper Trading** | 7 | 前向闭环是系统唯一真正干净的 OOS，机制完整、逐日增量推进 |
| **总体** | **4.5 / 10** | 可用作单策略复盘工具，但**尚不能直接作为可泛化的因子/策略研究平台** |

---

## 2. Current Architecture

### 2.1 真实分层拓扑（含真实文件路径）

```
┌─ 前端 (client/src) ─────────────────────────────────────────────┐
│  App.tsx (路由) → 11 页面 pages/*.tsx                            │
│  Home / Upload / Market / MarketDataInput / StockSync             │
│  LeaderCandidates / Backtest / PaperTrading                      │
│  SentimentAnalysis / SentimentAlerts / OperationLogs             │
│  lib/*.ts（trpc.ts, homeData.ts, orderReturnSort.ts…）            │
│  components/*.tsx（StrategyEvaluationPanel, CorrectStockDialog…）│
└──────────────────────────────┬───────────────────────────────────┘
                               │ tRPC (client/src/lib/trpc.ts)
┌──────────────────────────────▼───────────────────────────────────┐
│ API 层  server/routers.ts (1343行，9 组)                          │
│  auth / records / images / market / sentiment / watchlist         │
│  admin / system / backtest(monkey)                                │
│  ⚠ "sentiment" 组名不副实：实际承载 候选/回测/纸面/同步/停牌     │
└──────────────────────────────┬───────────────────────────────────┘
                               │ 直调
┌──────────────────────────────▼───────────────────────────────────┐
│ Service/编排层  server/db.ts (2079行 上帝文件)                    │
│  DAO + 情绪周期 + 回测编排 + 纸面持久化 混在一起                  │
│  loadBacktestBaseContext (db.ts:1672) 3分钟TTL物化底座            │
└──────────┬───────────────────────────────────────────────────────┘
           │ 唯一编排中枢
┌──────────▼─────────────────── Quant Engine ──────────────────────┐
│ leaderCandidates.ts (1120)  ← 15合1 巨型返回(20+字段)            │
│   ├─ candidateScore (42+24+10+8+16)  Expert Rule                 │
│   ├─ realisticBacktest.ts (667)  批量 T+1→T+2 模拟               │
│   ├─ downsideRisk.ts (1074)      滚动窗口+五策略+消融             │
│   ├─ technicalFactors.ts (686)   RankIC/ICIR/HAC/分位/衰减       │
│   ├─ factorCombination.ts        相关/VIF/中性化/去重             │
│   ├─ factorScore.ts              7维加权评分 + 评级               │
│   ├─ overfittingGuard.ts         DSR/PSR/MC/monkey                │
│   ├─ openExpectation.ts          次日开盘三档预期                 │
│   ├─ sentimentCycle.ts           情绪周期六阶段                   │
│   └─ marketFactors.ts            市场环境因子                     │
│  ⚠ paperTrading.ts (669) 与 realisticBacktest 双引擎镜像重复      │
└──────────┬───────────────────────────────────────────────────────┘
           │ Drizzle ORM (server/db.ts)
┌──────────▼───────────────────────────────────────────────────────┐
│ Database  TiDB Cloud (drizzle/schema.ts，11 张表)                 │
│  users / limit_up_records / uploaded_images / operation_logs      │
│  stock_watchlist / market_data / sentiment_alerts                 │
│  stock_suspension_windows / stock_daily_prices                   │
│  backtest_runs / paper_trading_runs                              │
└──────────┬───────────────────────────────────────────────────────┘
           │ server/tushare.ts (数据拉取)
┌──────────▼───────────────────────────────────────────────────────┐
│ External Data  Tushare API（积分受限：trade_cal 1/min、          │
│  stock_basic 1/h、无 suspend_d）                                  │
│  多源录入：图片OCR(recognition.ts) + 手工录入 + 定时同步          │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈清单

| 层 | 技术 | 证据 |
|---|---|---|
| 前端 | React 19 + Vite 7 + Tailwind4 + shadcn/ui + tRPC client | package.json, client/src |
| 后端 | Node + Express + tRPC 11 | server/routers.ts |
| 数据库 | TiDB Cloud（MySQL 兼容） | drizzle/schema.ts |
| ORM | Drizzle ORM | server/db.ts, drizzle/ |
| API | tRPC（9 组 procedure） | server/routers.ts |
| 数据获取 | Tushare API（HTTP POST JSON） | server/tushare.ts |
| AI/OCR/LLM | server/recognition.ts（OCR）、server/_core/llm.ts、client AIChatBox（未挂载） | 见 §12 |
| 回测 | realisticBacktest + downsideRisk + paperTrading | 见 §8 |
| 因子 | technicalFactors + factorCombination + marketFactors | 见 §5 |
| 策略 | leaderCandidates Expert Rule + 五策略快照 | 见 §10 |
| Paper Trading | paperTrading.ts 前向闭环 | 见 §3 |
| 测试 | vitest（237 通过 + 15 环境类失败） | vitest.config.ts |
| 构建 | tsc + vite build | package.json scripts |

---

## 3. Database Architecture

### 3.1 实体关系（11 张表）

```
users ──< operation_logs (操作审计)
users ──< stock_watchlist (关注)
users ──< backtest_runs / paper_trading_runs (运行快照)

limit_up_records (涨停记录, 核心事实表)
  ├─ stock_daily_prices (日线, 独立按 code+date)
  ├─ stock_suspension_windows (停牌窗口, 按 code)
  ├─ market_data (市场环境, 按 date)
  └─ sentiment_alerts (情绪告警, 按 date)
uploaded_images (图片) ──< limit_up_records (OCR 来源)
```

### 3.2 逐表审计摘要

| 表 | 主键/唯一 | 时间字段 | 关键问题 |
|---|---|---|---|
| users | id | createdAt | 正常 |
| limit_up_records | id; (stockCode,limitUpDate) | limitUpDate, createdAt | **数值列 varchar**(boardCount/流通市值/换手) |
| stock_daily_prices | (stockCode,tradeDate) | tradeDate | 数值列 varchar(open/close/high/low/amount/volume/preClose) |
| market_data | (tradeDate) | tradeDate | 数值列 varchar(turnoverYi/marginBalanceYi) |
| stock_watchlist | (userId,stockCode) | createdAt | note 字段未用 |
| uploaded_images | id | createdAt | 正常 |
| operation_logs | id | createdAt | imageUrl 未用 |
| sentiment_alerts | id | createdAt/tradeDate | 正常 |
| stock_suspension_windows | id | startDate/endDate | 正常 |
| backtest_runs | id | createdAt | **resultJson 存 8MB 级整结果**；paramsHash 建索引但只写不查 |
| paper_trading_runs | id | createdAt | stateJson 存整状态 |

### 3.3 时间字段分类结论（架构问题）

**当前系统未显式区分** event time / trade date / publish time / effective time / created time / updated time。实际存在的时间语义：

| 字段 | 真实语义 | 是否混淆 |
|---|---|---|
| limit_up_records.limitUpDate | **event/trade date**（涨停发生日） | 正确 |
| stock_daily_prices.tradeDate | **trade date** | 正确 |
| market_data.tradeDate | **trade date** | 正确 |
| *.createdAt | **created time**（写入时间） | 正确但无 updatedAt 全局约定 |
| stock_suspension_windows.startDate/endDate | **effective time**（生效区间） | 正确 |
| stock_daily_prices.source / market_data.source | 来源标签（非时间） | 见 §3.4 |

> **架构问题 [T1]**：`sourceUpdatedAt`（market_data）只写不读，无"数据发布时间"与"行情生效时间"的分离。`source` 字段用文本标记"自动同步/真实来源"，但市场因子的 verified 判定逻辑与之失配（见 P1-BUG）。

### 3.4 重复/冗余数据风险

- **重复数据风险**：limit_up_records 与 stock_daily_prices 在"涨停"事实上有重叠，但职责不同（前者是复盘标注，后者是行情回放），不构成硬重复。真正的风险是 stock_daily_prices 与 market_data 的同日多条（缺唯一约束外的防重），依赖 upsert 的幂等键。
- **冗余字段**：`boardCount`（文本列，回测从不读它，代码重算连板）；`sourceUpdatedAt` 只写不读；`paramsHash` 索引弃用；`sourceIsVerified` 因 note 失配永不满足（见 §13 P1-BUG）。

---

## 4. Data Flow（数据血缘）

### 4.1 市场数据链

```
Tushare daily API (server/tushare.ts)
  ↓ 清洗/映射 (stockPriceSync.ts:143/212/312)
stock_daily_prices (stockCode, tradeDate, OHLC+amount+volume+preClose)
  ↓ 聚合 (db.ts:1652/1672 loadBacktestBaseContext, 3min TTL)
context.priceByStockDate (Map<string, DailyPrice>, 11万行)
  ↓ 消费
  ├─ technicalFactors.ts  (换手率/量比/振幅)
  ├─ downsideRisk.ts      (滚动窗口/回撤/风险)
  ├─ realisticBacktest.ts (成交价/止损/除权检测)
  └─ leaderCandidates.ts  (溢价/成功标注)
```

### 4.2 涨停数据链

```
图片/OCR (server/recognition.ts) + 手工录入 + 九阳公社抓取
  ↓ 解析/校正 (server/stockIdentity.ts, routers sentiment.correctStockIdentity)
limit_up_records (涨停事实 + 题材 + 封板时间 + 换手 + 流通市值)
  ↓ 计算 (leaderCandidates.ts)
  ├─ 候选评分 (Expert Rule 42+24+10+8+16)
  ├─ 情绪周期 (sentimentCycle.ts 六阶段)
  ├─ 连板统计 (calculateBoards)
  └─ 回测行构建 (LeaderCandidateBacktestRow, PIT)
  ↓
backtest_runs (resultJson 落库) + 前端展示
```

### 4.3 核心消费关系（Source → Consumer）

| 数据源 | 消费者 | 计算物 |
|---|---|---|
| limit_up_records | leaderCandidates.ts | 候选评分/连板/回测行 |
| stock_daily_prices | technicalFactors/downsideRisk/realisticBacktest | 技术因子/风险/成交 |
| market_data | marketFactors.ts | 市场环境因子 |
| sentiment_alerts | sentimentCycle.ts | 情绪阶段 |
| stock_suspension_windows | db.ts mergeSuspensionWindows | 停牌窗口过滤 |

---

## 5. Factor Inventory（因子清单）

### 5.1 候选评分因子（Expert Rule，leaderCandidates.ts:518-527）

| Factor ID | 名称 | 计算函数 | 输入 | 方向 | 权重 | 类型 |
|---|---|---|---|---|---|---|
| `boards` | 连板高度 | `calculateBoards` | limit_up_records | + | min(boards,6)×7 (封顶42) | **Expert Rule** |
| `sectorCount` | 题材涨停数 | 逐日计数 | limit_up_records | + | min(count,6)×4 (封顶24) | **Expert Rule** |
| `limitUpTime` | 封板时间 | `timeToMinutes` | limitUpTime | − | 10/8/5/2/0 分档 | **Expert Rule** |
| `turnover` | 换手率 | `parseNumeric` | turnover | + | 8/6/4/2/1 分档 | **Expert Rule** |
| `marketCap` | 流通市值 | `calculateMarketCapScore` | circulationValue | 非线性 | 16 分制 | **Expert Rule** |

> **结论**：候选评分是**纯人工设计的 Expert Rule**，权重（7/4/10/8/16）全部人为指定，**不是统计学习得到的因子**。审计规范 §11 要求必须标注，当前代码注释确实标注了"满分42+24+10+8+16"，但**前端与后端未在显式共享常量中声明**（见 P1-7）。

### 5.2 技术面因子（technicalFactors.ts:178-219，PIT 正确）

| Factor ID | 名称 | 公式 | 输入 | Lookback | 方向 | 归一化 |
|---|---|---|---|---|---|---|
| `turnoverRate` | 换手率 | amount/(流通市值×1e5)×100 | amount, circulationValue | 当日 | + | 分位 |
| `volumeRatio` | 量比 | amount/前5日均量 | amount, 前5日 | 5 日 | + | 分位 |
| `amplitude` | 振幅 | (high−low)/preClose×100 | OHLC | 当日 | 混合 | 分位 |

> **PIT 确认**：volumeRatio 显式用 `tradingDates.slice(max(0, idx-5), idx)`（technicalFactors.ts:198），仅取信号日之前日期，**无未来函数**。

### 5.3 下行风险因子（downsideRisk.ts）

- 滚动窗口风险信号 `scoreDownsideRiskSignal`（回撤/波动/高位风险）
- 五策略风险分：baseline / riskPenalty / hardFilter / qualityBlend / qualityGate

### 5.4 市场环境因子（marketFactors.ts）

- 涨停家数、成交额（亿元）、两融余额（亿元）、市场 verified 状态

### 5.5 情绪因子（sentimentCycle.ts）

- 六阶段：冰点试错/修复上升/上升发酵/高位分歧/高位亢奋/高位退潮

### 5.6 因子清单缺口

| 缺口 | 说明 |
|---|---|
| 无财务因子 | 无 PE/PB/ROE/营收增速（数据源未接入） |
| 无公告因子 | 无龙虎榜/公告事件因子 |
| 无影线因子 | 已在上轮 P0 淘汰（上影线占比中性化后 IC 衰减 95.5%，市值代理） |

---

## 6. Factor Evaluation Audit（因子评价逐项）

### 6.1 已实现指标（technicalFactors.ts）

| 指标 | 实现 | 位置 | 公式是否正确 |
|---|---|---|---|
| Rank IC | ✅ | dailyIcs 逐日 Spearman | ✅ |
| Mean IC | ✅ | meanIc | ✅ |
| Median IC | ✅ | medianIc | ✅ |
| IC Std | ✅ | icStd | ✅ |
| **ICIR** | ✅ | `meanIc / icStd` (technicalFactors.ts:431) | ✅ **正确**（未误用 std(daily return)） |
| IC t-stat | ✅ | `meanIc/(icStd/√n)` (433) | ✅ |
| **HAC t-stat** | ✅ | `neweyWestMeanTStat` (100-128) | ✅ Newey-West 正确 |
| p-value | ✅ | 基于 HAC t 正态近似 (436) | ✅ |
| IC positive ratio | ✅ | positiveIcRatio | ✅ |
| IC skew | ✅ | skewness (439) | ⚠ population moment |
| IC kurtosis | ✅ | excessKurtosis (440) | ⚠ 见 §6.3 |

### 6.2 Quintile 分析（technicalFactors.ts:510-553）

已实现 Q1–Q5 五分组，含：样本数、平均收益、中位数收益、胜率、组内 Sharpe、Q5−Q1 spread、单调性判定（monotonic + direction）。

### 6.3 Nonlinear Pattern（technicalFactors.ts:130-169）

已实现 6 形态分类：`monotonic_increasing / monotonic_decreasing / inverted_u / u_shape / threshold / none`，通过 `classifyQuintileShape` 启发式判定。

### 6.4 统计指标正确性问题

| 问题 | 位置 | 严重度 |
|---|---|---|
| **Sharpe 双定义**：downsideRisk 用几何年化 `(期末/期初)^(252/n)−1`，overfittingGuard 用算术 `日均收益/日波动×√252`，两处都叫 Sharpe/IR，同一曲线结果不同 | downsideRisk.ts vs overfittingGuard.ts | P0 |
| 偏度/峰度样本 vs 总体矩混用：technicalFactors 用总体矩（除 n），downsideRisk:420-425 用无偏近似（乘 n/((n-1)(n-2))），术语不统一 | technicalFactors.ts:439 vs downsideRisk.ts:420 | P1 |
| **负 IC 判定正确**：`strength = abs(ICIR)`、`direction = sign(meanIc)`（technicalFactors.ts:227-254），负 IC 未误判为无效 | — | ✅ 通过 |
| `neutralizationSubScore` 两分支都返回 1（icReduction<0 与 <0.2 重叠） | factorScore.ts:87-88 | P2 |

### 6.5 因子评价指标重复

`IC_IR`、`HAC-t`、`p-value` 均从同一 IC 序列导出（冗余但合理）；但 factorScore 的"预测力(strength, 按|ICIR|)"与"显著性(pValue)"两个维度都来自同一 ICIR 的单调函数，阈值 0.1/0.2/0.3 与 0.05/0.1/0.2 高度相关 → **7 维评分实际有效维度约 4 个，存在隐含重复计权**（P1）。

---

## 7. Look-Ahead Bias Audit（未来数据泄漏）

### 7.1 逐项检查结论

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 因子计算 | ✅ PIT 正确（volumeRatio 只用前5日） | technicalFactors.ts:198 |
| 2 | 涨停数据 | ✅ 涨停记录是当日事件快照 | limit_up_records 结构 |
| 3 | 情绪周期 | ✅ 逐日滚动，无未来 | sentimentCycle.ts |
| 4 | 财务数据 | N/A（未接入） | — |
| 5 | 公告数据 | N/A（未接入） | — |
| 6 | 技术指标 | ✅ PIT | technicalFactors.ts |
| 7 | 前收盘价 | ✅ 用 preClosePrice | technicalFactors.ts:211 |
| 8 | 当日收盘价 | ✅ 信号日收盘后才可知，符合 T+1 时序 | realisticBacktest.ts |
| 9 | 次日开盘价 | ✅ 严格 T+1 open 买入 | realisticBacktest.ts:396 |
| 10 | 最高/最低价 | ⚠ 盘中止损用 T+2 当日 low（合理），但开盘止损用 open | realisticBacktest.ts:519-524 |
| 11 | 成交量/额 | ✅ PIT | — |
| 12 | 涨停时间 | ✅ 当日事件 | leaderCandidates.ts |
| 13 | 复权数据 | ⚠ 无真复权，仅 detectExRights 标记 | realisticBacktest.ts:49 |
| 14 | 股票状态 | ⚠ 未来名称泄漏 | 见 7.2 |
| 15 | ST | ⚠ 名称含 ST 判断，未来名称可能泄漏 | stockIdentity.ts:29 |
| 16 | 停牌 | ✅ 停牌窗口 PIT 合并 | db.ts mergeSuspensionWindows |
| 17 | 新股 | ⚠ 上市日期判断靠"无行情即停牌"推断，非真 list_date | stockPriceSync.ts:613 |
| 18 | 涨跌停价格 | ❌ 硬编码 1.099/0.901，无板块区分 | realisticBacktest.ts:402 |

### 7.2 未来数据泄漏清单（详细）

| 文件 | 函数 | 代码逻辑 | 风险 | 严重度 |
|---|---|---|---|---|
| leaderCandidates.ts | `buildLatestStockNameMap` | 用**全量 records**（含未来）取最新名称 | 曾改名/摘帽股票的"名称"元数据轻微超前 | P3 |
| leaderCandidates.ts:836-849 | 交易日序列降级 | 无价格数据时用"有涨停记录的日期"当日历 | 缺涨停的无记录交易日被误当"已过"，下一交易日算错 | P3 |
| realisticBacktest.ts:402/514 | limitUp/limitDown | `*1.099`/`*0.901` 硬编码，无创业板/科创板/北交所/ST 区分 | 交易规则错误（P0 Trading Rule） | P0 |

### 7.3 Information Availability Timeline

```
T-1 Close ── T Open ── T Intraday ── T Close ── T+1 Open ── T+1 Close ── T+2
     │           │           │            │           │            │         │
  preClose   开盘价   封板时间/换手  信号生成   开盘买入    止损/续持   T+2出清
     │           │           │            │           │            │         │
     └── 因子 lookback 边界（只用 ≤T-1）      └── 买入决策只用 T 收盘前信息 ✓
```

**结论**：主链时序纪律良好，唯一实质未来函数风险在**名称映射**（P3）与**交易日历降级**（P3），另有涨跌停价硬编码属于交易规则错误而非未来函数。

---

## 8. A-Share Trading Rule Audit

| 规则 | 当前实现 | 位置 | 判定 |
|---|---|---|---|
| T+1 | ✅ 信号 T 日收盘 → T+1 开盘买入 → T+2 起可卖 | realisticBacktest.ts:206 | ✅ 正确 |
| 涨停 | ❌ 统一 `*1.099`，未区分板块 | realisticBacktest.ts:402 | **P0** |
| 跌停 | ❌ 统一 `*0.901`，未区分板块 | realisticBacktest.ts:514 | **P0** |
| 停牌 | ✅ 停牌窗口合并+跳空检测 | db.ts:740/756 | ✅ |
| ST | ⚠ 仅名称前缀判断，无涨跌幅 5% 特殊处理 | stockIdentity.ts:29 | P1 |
| 新股 | ⚠ 无 list_date，靠"无行情"推断 | stockPriceSync.ts:613 | P1 |
| 上市日期 | ⚠ 同上 | — | P1 |
| 主板 10% | ✅（隐含） | — | ✅ |
| 创业板 20% | ❌ 未实现 | — | **P0** |
| 科创板 20% | ❌ 未实现 | — | **P0** |
| 北交所 30% | ❌ 未实现 | — | **P0** |
| 集合竞价 | ❌ 未实现（默认 open 价即成交） | — | P2 |
| 开盘/收盘成交 | ⚠ 仅 open 买入 + close/止损卖出 | realisticBacktest.ts | P2 |
| 流动性 | ✅ amountAdjustedSlippageBps 分层 | realisticBacktest.ts:159 | ✅ |
| 滑点 | ✅ 基础 10bps + 流动性加成 | realisticBacktest.ts:217 | ✅ |
| 手续费 | ✅ 佣金 0.03% | realisticBacktest.ts:214 | ✅ |
| 印花税 | ✅ 卖出 0.05%（仅卖出） | realisticBacktest.ts:215,296 | ✅ |
| 最低佣金 | ❌ 未实现最低 5 元 | — | P2 |
| 现金限制 | ✅ 资金不足跳过+整手约束 | realisticBacktest.ts:423/429 | ✅ |
| 仓位限制 | ✅ maxPositions + 容量约束 | realisticBacktest.ts:213/425 | ✅ |
| 单票最大仓位 | ✅ maxPositionAmountRatio | realisticBacktest.ts:236 | ✅ |

### 8.1 涨跌停价硬编码风险（P0 Trading Rule Risk）

```typescript
// realisticBacktest.ts:402  买入封板判定
const limitUp = validPrice(row.signalClosePrice) && entryOpenPrice >= row.signalClosePrice * 1.099;
// realisticBacktest.ts:514  卖出跌停判定
const limitDown = validPrice(position.previousClosePrice) && exitPrice <= position.previousClosePrice * 0.901;
// paperTrading.ts:412/516  镜像同款硬编码
```

**问题**：`0.9` / `1.1` / `0.901` / `1.099` 均为硬编码，未按板块（主板±10%、创业板/科创板±20%、北交所±30%、ST±5%）区分。**只要回测池含创业板/科创板/北交所/ST 股票，涨跌停判定即系统性错误**。这是 P0 Trading Rule Risk。

---

## 9. Backtest Engine Audit

### 9.1 Signal → Order → Fill → Position → Portfolio → Return 对应位置

| 环节 | 实现 | 位置 |
|---|---|---|
| Signal 生成 | 候选评分 + 过滤（score≥52 或题材≥3且早封） | leaderCandidates.ts:611-615 |
| Order 产生 | T+1 开盘，按 score 排序选 maxPositions 只 | realisticBacktest.ts:329-391 |
| Order 价格 | `nextOpenPrice`（T+1 开盘价） | realisticBacktest.ts:396 |
| Fill 成交 | 非一字板则必成交（开盘价+滑点） | realisticBacktest.ts:402-447 |
| Position | Map<code::date, Position> | realisticBacktest.ts:141-152 |
| Portfolio | equityCurve 逐日估值 | realisticBacktest.ts:281 |
| Return | netPnl/netReturn/pnlToEquityRatio | realisticBacktest.ts:298-306 |

### 9.2 逐项分析

| 问题 | 答案 |
|---|---|
| Signal 何时生成？ | T 日收盘后（涨停复盘数据） |
| Order 价格？ | T+1 开盘价 + 滑点 |
| 涨停是否成交？ | 可配置 blockLimitUpBuys，默认不阻断；一字板可阻断 |
| 跌停是否成交？ | 可配置 blockLimitDownSells + 一字跌停概率 |
| T+1 如何实现？ | signalDate 与 entryDate=nextDayDate 分离 |
| 资金计算？ | 连续资金账户，cash 累加 |
| 仓位计算？ | equal / scoreWeighted / fixedPercent 三种 |
| 手续费？ | 佣金+过户费（买）、佣金+印花税+过户费（卖） |
| 滑点？ | 基础+流动性分层 |
| 停牌？ | 停牌窗口过滤 + 无行情跳过 |
| 退市？ | 永久无行情 → 永久停牌窗口 |
| 数据缺失？ | missingDataCount 计数跳过 |

### 9.3 未来函数检查（核心）

**"知道当天收盘 → 假设当天收盘买入"型未来函数：未发现。** 买入严格用 T+1 开盘价（nextOpenPrice），卖出用 T+2 及后续收盘/止损价，时序正确。

但存在**除权复权缺口**（P1）：收益用不复权价格，除权日会产生虚假跳空；代码仅用 `detectExRights` 标记（realisticBacktest.ts:49/441），**未做真实复权对齐**，导致除权日样本收益口径存疑（虽已标记但未剔除或修正）。

---

## 10. Strategy Score Audit

### 10.1 分数依赖图

```
boards(×7,封顶42) + sectorCount(×4,封顶24) + limitUpTime(10/8/5/2/0)
      + turnover(8/6/4/2/1) + marketCap(16分制)
                    ↓
              rawScore (0~100, Expert Rule)
                    ↓
              − riskScore × riskPenaltyWeight(0.35)
                    ↓
              netScore = max(0, score − riskPenalty)
                    ↓
        五策略快照：baseline / riskPenalty / hardFilter / qualityBlend / qualityGate
```

### 10.2 分数分类

| 分数 | 类型 | 说明 |
|---|---|---|
| rawScore (42+24+10+8+16) | **Expert Rule** | 人工权重，非统计因子 |
| riskScore (downsideRisk) | **Composite Factor** | 滚动窗口统计 |
| netScore | **Strategy Signal** | Expert + Composite 组合 |
| factorScore (7维) | **Factor Evaluation Score** | 评估用，不参与选股 |

> **结论**：候选评分是 Expert Rule（人工权重 7/4/10/8/16），代码未将其伪装成统计因子，**符合规范要求**。但权重散落在 leaderCandidates.ts:518-527，未提取为共享常量，前端 Backtest.tsx:289 另有一份硬编码默认值，**存在"所见≠所算"风险**（P1-7）。

### 10.3 指标错配（P0）

`buildFinalVerdict` 的 `buildStrategyOverfittingRiskScore`（factorScore.ts:229-231）把 **baseline 的全周期 Sharpe**（overfittingGuard.realSharpe）与 **riskPenalty 的 WFA OOS Sharpe**（walkForwardOosSharpe）相减算衰减：

```typescript
// factorScore.ts:229-231
const decay = (fullCycleSharpe - walkForwardOosSharpe) / fullCycleSharpe;
```

这是**两条不同策略曲线**，其 Sharpe 不可直接比较 → 衰减率结论有误导性（P0-2）。

---

## 11. Factor Combination Audit

### 11.1 已实现（factorCombination.ts）

| 能力 | 实现 | 位置 |
|---|---|---|
| 因子标准化 | ✅ zScore（样本标准差）、quantileRank（0~1） | 342-362 |
| 因子方向 | ✅ 由 meanIc 符号判定 | technicalFactors.ts:240 |
| 因子权重 | ✅ 7维可配置 | factorScore.ts:25-33 |
| 权重来源 | 人工设定（DEFAULT_FACTOR_SCORE_WEIGHTS） | factorScore.ts:25 |
| 重复因子检测 | ✅ findHighlyCorrelatedPairs (|ρ|≥0.7) | 304-315 |
| 高度相关因子 | ✅ deduplicateFactors 贪心去重 | 321-339 |
| Pearson | ✅ correlationMatrix | — |
| Spearman | ✅ spearmanMatrix | 402 |
| VIF | ✅ vif = [R⁻¹]_jj，>5 提示共线 | 403 |
| Cluster | ✅ 语义簇分组 | 408 |
| 中性化 | ✅ 市值中性化（残差化） | 415 |
| double counting | ⚠ 部分：贪心去重有，但评分维度重复计权（见 §6.5） | P1 |

### 11.2 double counting 检查

- **Factor A/B 高度相关仍 A×0.5 + B×0.5**：候选评分中 `sectorCount`（题材涨停数）与 `boards`（连板高度）**存在相关**（连板股往往题材集中），但权重是人工 Expert Rule 而非统计组合，属策略设计而非因子组合缺陷。
- **真正的 double counting**：factorScore 7 维中 predictivePower（|ICIR|）与 significance（p-value，HAC t 的单调函数）对同一信息重复计权（P1）。

---

## 12. Neutralization Audit

| 中性化类型 | 实现状态 | 位置 |
|---|---|---|
| Market Cap Neutralization | ✅ 市值残差化 | factorCombination.ts:368-395 (residualize) |
| Industry Neutralization | ❌ 未实现（只有 sector 题材，无行业分类） | — |
| Beta Neutralization | ❌ 未实现 | — |
| Volatility Neutralization | ❌ 未实现 | — |
| Liquidity Neutralization | ❌ 未实现 | — |

### 12.1 Residualization 正确性

`residualize`（factorCombination.ts:368-395）是**单暴露 OLS**：`value ~ α + β·exposure`，返回残差 `value − (α+β·exposure)`。**实现正确**（是真回归残差，非简单 Factor − Mean）。但仅支持单暴露，多因子联合中性化需扩展。

---

## 13. Factor Decay Audit

### 13.1 已实现

- IC 衰减：`icDecay` 多周期 IC 序列（technicalFactors.ts:93-101 decaySubScore）
- 预测周期字段：`nextClosePremium / nextOpenPremium / secondDayClosePremium / tPlus1CloseToTPlus2CloseReturn`（technicalFactors.ts:225）

### 13.2 预测周期定义正确性

**T 日因子 → 对应 T+1 return**（nextOpenPremium = T+1 open vs T close），实现正确（非"函数名与定义不符"）。衰减评估 `decaySubScore`（factorScore.ts:93-101）检测方向反转与快速衰减。

> **缺失**：未实现标准 IC(1D)/IC(3D)/IC(5D)/IC(10D)/IC(20D)/IC(30D) 六档完整衰减曲线，当前仅按现有字段做 4 个周期点的衰减（P2）。

---

## 14. Stability Audit

### 14.1 已实现

| 维度 | 实现 | 位置 |
|---|---|---|
| Yearly Stability | ✅ yearlyIc 年度切片 + directionConsistent | technicalFactors.ts |
| Phase Stability | ✅ 按情绪六阶段分组 IC | technicalFactors.ts phaseStability |
| Market Regime | ⚠ 仅情绪阶段，无牛/熊/震荡/高低波动 regime | — |
| Emotion Regime | ✅ 六阶段 | sentimentCycle.ts |

### 14.2 缺口

**Insufficient Statistical Validation**：yearly/phase 稳定性只报告"方向一致性"，**未报告每个 regime 的 Sample Count / Mean IC / ICIR / t-stat / p-value / Win Rate**（P1）。规范 §15 明确要求这些统计量，当前只有方向一致性这一单项。

---

## 15. PSR / DSR / Bootstrap Audit

### 15.1 已实现（overfittingGuard.ts）

| 指标 | 实现 | 位置 | 公式 |
|---|---|---|---|
| Raw Sharpe | ✅ | — | 见 §6.4 双定义 |
| PSR | ✅ | probabilisticSharpeRatio | 150-152 |
| DSR | ✅ | deflatedSharpeRatio = SR / E[SR_max] | 103-105 |
| Bootstrap | ✅ IID 有放回 | runReturnBootstrap (215) | 2000 次 |
| Monte Carlo | ✅ | runMonkeyBenchmark (313) | 随机打乱评分 |
| Cost Sensitivity | ✅ | runCostSensitivity | — |

### 15.2 DSR numTrials 来源（P0）

```typescript
// leaderCandidates.ts:1059
const overfittingGuardReport = buildOverfittingGuardReport(realisticSimulation, 30);
```

`numTrials = 30` 是**硬编码**。而实际交互搜索空间 = 5 阈值 × 6 权重 × UI 所有可调参数组合（远超 30）。

> **P0 Research Trial Count Problem**：`expectedMaximumSharpe(30, ...)` 严重低估试验数，DSR 系统性偏乐观。未来必须用 Research Trial Registry 自动记录真实研究次数喂给 DSR。

### 15.3 Bootstrap 类型（P2）

`runReturnBootstrap` 是 **IID Bootstrap**（有放回重抽样日收益，overfittingGuard.ts:215-247），**无 Block Bootstrap**。涨停策略收益具有时间序列相关、波动聚集、情绪周期、连续涨停结构，IID 重抽样会破坏这些自相关 → 置信区间偏窄。

> **Missing Block Bootstrap**：后续应引入 Moving Block Bootstrap 或 Stationary Bootstrap（P2）。

---

## 16. Walk Forward Audit

### 16.1 已实现

| 能力 | 实现 | 位置 |
|---|---|---|
| 滚动窗口 WFA | ✅ 多个滚动窗口，验证段严格在训练段之后 | downsideRisk.ts:696-704 |
| Train/Validation/OOS | ⚠ 部分：70/30 时间切分 + 滚动窗口 | leaderCandidates.ts:962-965 |
| 参数寻优 | ✅ 滚动窗口内 6 权重寻优 | downsideRisk.ts |

### 16.2 OOS 泄漏（P0 Data Leakage）

1. **70/30 切分本身诚实**（leaderCandidates.ts:961-995）。
2. **但最终 30% OOS 切片被反复"看着调参"**：UI 每改一次 minScore/hardRiskThreshold/权重都会重跑并展示该尾段胜率/溢价/分档，`outOfSample*` 字段全部曝光给调参者 → **OOS 逐步变成第二个训练集**，且**无永久冻结留出集**。
3. 因子淘汰/评级用**全样本**统计（factorEvaluation 基于全部 rows，factorCombination 中性化注释自认 in-sample），上轮 P0/P1 决策就是在全样本上做的。

> **结论**：`OOS → 参数优化` 已经发生（通过 UI 反复调参），记录为 **P0 Data Leakage**。

---

## 17. PBO Audit

**PBO（Probability of Backtest Overfitting，Bailey et al. CBCV 方法）不存在**。

全仓搜索 `PBO` / `Probability of Backtest Overfitting` / `Backtest Overfitting` 零命中。

> **Missing Critical Validation Component**（记录，本阶段不实现）。DSR/PSR 只能给出"单一最优策略是否过拟合"的校正，无法回答"整个配置矩阵中是否存在过拟合选择"。PBO 需要：组合配置矩阵（N 个参数组合）、CSCV 交叉验证、logit 拟合。是 Phase 2+ 的验证层补强项。

---

## 18. Parameter Stability Audit

**部分缺失**。

当前仅 `parameterStability`（downsideRisk.ts:145）记录 `kind: "fixed" | "rollingPenaltyWeight"` + `distinctValueCount` + `standardDeviation`，即只报告"权重寻优过程中权重值的离散度"，**未做参数敏感性热力图**（如 threshold 0.8/0.9/1.0/1.1/1.2 的 Sharpe 平台 vs 尖峰）。

> **Missing Parameter Stability Analysis**：无法回答"参数稍微变化策略是否仍然有效"。需新增参数网格敏感性（P2）。

---

## 19. Survivorship Bias Audit

**存在 P0 Survivorship Bias Risk**。

- 股票池 = 涨停记录子集（limit_up_records），**非全市场股票池**。
- 无 `stock_basic`（Tushare 股票列表）接入（grep `stock_basic` 仅在 tushare.ts 的交易日历引用 `000001.SZ` 作日历锚，无全市场股票列表）。
- **退市股票**：仅通过"末笔成交后持续无行情 → 永久停牌窗口"推断（stockPriceSync.ts:613/662），**无真实 list_date/delist_date**。
- **历史上市股票**：无上市日期，新股靠"无行情推断"。
- 情绪周期、市场环境因子、候选评分全部基于"当天有涨停记录"的股票，**退市前未涨停过的股票、以及从未涨停的股票完全不在池内** → 生存者偏差 + 涨停样本选择偏差双重存在。

> **结论**：Stock Universe 由"涨停记录"隐式生成，非当前+历史全市场股票列表，记录 **P0 Survivorship Bias Risk**。

---

## 20. Point-in-Time Data Audit

### 20.1 PIT 合规项（✅）

| 项 | 结论 | 证据 |
|---|---|---|
| 候选评分 | ✅ PIT（用当日记录） | leaderCandidates.ts:510 |
| 连板计算 | ✅ PIT（按目标日回溯） | calculateBoards |
| 技术因子 | ✅ PIT（volumeRatio 只用前5日） | technicalFactors.ts:198 |
| 风险分 | ✅ PIT（滚动窗口在信号日前） | downsideRisk.ts |
| 停牌窗口 | ✅ PIT 合并 | db.ts mergeSuspensionWindows |
| 情绪阶段 | ✅ PIT（逐日滚动） | sentimentCycle.ts |

### 20.2 PIT 违规项（⚠/❌）

| 项 | 问题 | 严重度 |
|---|---|---|
| 股票名称 | buildLatestStockNameMap 用全量（含未来）取名 | P3 |
| 交易日历 | 无价格时用记录日期降级 | P3 |
| 复权 | 不复权，除权跳空仅标记 | P1 |
| 股票状态 | 退市/ST/新股靠无行情推断 | P1 |
| 涨跌停价 | 硬编码无板块区分 | P0 |

---

## 21. Architecture Problems（架构问题汇总）

### 21.1 重复逻辑清单

| 重复项 | 位置 | 次数 |
|---|---|---|
| mean/median/std/偏峰度 | downsideRisk:329-341, technicalFactors:73-93, factorCombination:65-68, overfittingGuard:75-77 | 4 份 |
| NW-HAC | 仅 technicalFactors:100-128（其它处缺） | 1 |
| timeToMinutes | leaderCandidates:352, openExpectation:80 | 2 份 |
| isMainBoardStock | leaderCandidates:342, sentimentCycle:100 | 2 份 |
| readFactorValue/readEvaluableFactorValue | technicalFactors:446, factorCombination:31 | 逐字重复 |
| mergeSuspensionWindows | db.ts:740 vs 带 note 版本 db.ts:756 | 并列重复 |
| **双模拟引擎** | realisticBacktest（批量）vs paperTrading（逐日），成交/退出规则各写一份 | **最高风险** |
| 档位默认表 | server/openExpectation.ts:57, client Backtest.tsx:22 | 双份 |
| 展示统计 | Backtest.tsx:130-141 三档汇总 = 重写 openExpectation:209 | 前后端 |
| 情绪分档 | Market.tsx:347 五档 vs db.ts:1275 七档 | **不一致** |

### 21.2 硬编码参数清单

| 参数 | 值 | 位置 |
|---|---|---|
| 准入分门槛 | 52 | leaderCandidates.ts:614, 前端默认 |
| riskPenaltyWeight | 0.35 | leaderCandidates.ts:559 |
| hardRiskThreshold | 65 | downsideRisk |
| 滚动窗口 | 45/14 | downsideRisk |
| 观察天数 | 5 | — |
| 涨跌停价 | 1.099/0.901 | realisticBacktest.ts:402/514 |
| DSR numTrials | 30 | leaderCandidates.ts:1059 |
| 候选上限 | 20 | leaderCandidates.ts:624 |
| Bootstrap seed | 20260905 | overfittingGuard.ts:215 |

### 21.3 God Function / God Module

| 项 | 说明 | 行数 |
|---|---|---|
| db.ts | DAO+情绪+编排+持久化 | 2079 |
| leaderCandidates.ts | 15 合 1 返回，Result 类型 20+ 字段 | 1120 |
| downsideRisk.ts | 滚动寻优+五策略+消融全塞一文件 | 1074 |
| routers.ts sentiment 组 | 装候选/回测/纸面/同步/停牌 | 1013-1339 |

### 21.4 Hidden Global State / Implicit State

- `backtestBaseContextCache` 模块级缓存（db.ts:1664-1706），3min TTL，无显式失效机制，参数一变需等 TTL 或重启。
- 无全局随机种子管理：monkey benchmark 用固定候选池打乱，bootstrap 用 seed=20260905，但 `hitsDeterministicProbability` 用 hash（确定性），整体随机性**未集中管理**。

### 21.5 Database Access inside Calculation

db.ts 中 `loadBacktestBaseContext` 在计算层直接读库；各引擎函数接收 `context` 参数（priceByStockDate 等）已较好解耦，但编排层 db.ts 仍混入大量聚合 SQL（见 §22 P1-4）。

### 21.6 UI-dependent Quant Calculation

前端 Backtest.tsx 自算三档汇总、胜率、情绪分档（见 §21.1），**UI 承载了部分量化计算**，与服务端重复（P2-5）。

---

## 22. P0 Issues（Critical）

| ID | File | Function | Problem | Risk | Recommendation |
|---|---|---|---|---|---|
| P0-1 | leaderCandidates.ts:1059 | buildOverfittingGuardReport(_, 30) | DSR numTrials=30 硬编码，低估多重检验 | 过拟合判断系统性偏乐观 | 引入 Research Trial Registry 记录真实试验数 |
| P0-2 | factorScore.ts:229-231 | buildStrategyOverfittingRiskScore | baseline 全周期 Sharpe 与 riskPenalty WFA OOS Sharpe 相减 | 两条不同策略曲线不可比，衰减结论误导 | 统一为同策略的全周期 vs OOS 对比 |
| P0-3 | leaderCandidates.ts:961-995 + Backtest 全页 | outOfSample 计算 | OOS 尾 30% 无冻结留出，UI 反复调参曝光 | 测试集污染，OOS 变第二个训练集 | 新增冻结留出集（最后 10% 日期只在最终评级解锁） |
| P0-4 | realisticBacktest.ts vs paperTrading.ts | 双引擎 | 成交/退出规则镜像重复 | 规则漂移，改一处漏一处 | 抽单一 SimEngine，批量=喂全量，纸面=逐日增量 |
| P0-5 | realisticBacktest.ts:402/514/319, paperTrading.ts:412/516 | limitUp/limitDown | 涨跌停价硬编码 1.099/0.901 无板块区分 | 创业板/科创板/北交所/ST 回测系统性错误 | 按板块涨跌幅表计算 limit price |
| P0-6 | leaderCandidates.ts:510, stockIdentity.ts | 股票池 | 股票池=涨停记录子集，无全市场列表+退市/ST/新股状态 | 生存者偏差 + 涨停选择偏差 | 接入 stock_basic(list_status/list_date/delist_date) 建全市场 PIT 宇宙 |
| P0-7 | downsideRisk.ts vs overfittingGuard.ts | Sharpe | 几何年化 vs 算术年化两套定义 | 同一曲线结果不同，结论矛盾 | 统一单一 Sharpe 定义（建议几何年化） |

---

## 23. P1 Issues（High）

| ID | File | Function | Problem | Risk | Recommendation |
|---|---|---|---|---|---|
| P1-1 | db.ts (2079行) | 全文件 | 上帝文件：DAO+情绪+编排+持久化 | 维护困难，改动面大 | 拆 dao/ + research/ |
| P1-2 | routers.ts:1013-1339 | sentiment 组 | 名不副实，装候选/回测/纸面/同步 | 职责混乱 | 拆 candidates/backtest/paperTrading/sync |
| P1-3 | leaderCandidates.ts:133-169 | LeaderCandidateBacktestResult | 15 合 1 巨型结果类型 | 传输 8MB，前端全量拿 | 拆 summary/full 分层，按需订阅 |
| P1-4 | db.ts:1128/1317/963 等 | 多函数 | 全表载入+JS 聚合 ≥10 处 | 性能瓶颈，冷启动 6-20min | 大表分区+单日 where |
| P1-5 | 4 个引擎文件 | mean/median/std 等 | 统计原语 4 份重复 | 改一处漏三处 | 抽 shared/quant-stats.ts |
| P1-6 | db.ts:633 vs marketSync.ts:63 | 市场因子 verified | note 写"自动同步"而 verified 判定要"真实来源：Tushare daily"→ 定时行情行永不 verified | **BUG**：市场因子有效性永远不被认可 | 修正 note 与 verified 判定的一致性 |
| P1-7 | Backtest.tsx:289 等 | 前端默认表单 | 52/0.35/65/45/14/档位表 前后端双份 | 所见≠所算 | 抽 shared/strategy-config.ts 单一事实源 |
| P1-8 | leaderCandidates.ts:611+technicalFactors | 评估宇宙 | 评估 rows=策略过滤后子集 | 因子评估非独立市场 | 评估用全候选（非过滤后）截面 |
| P1-9 | realisticBacktest.ts:49 | detectExRights | 只标记除权跳空不复权 | 除权日收益虚假 | 接入复权因子，收益用后复权价 |
| P1-10 | technicalFactors.ts stability | 阶段/年度稳定性 | 只报方向一致性，无 sample/ICIR/t/p/winrate | Insufficient Statistical Validation | 补全每 regime 统计量 |

---

## 24. P2 Issues（Medium）

| ID | File | Function | Problem | Risk | Recommendation |
|---|---|---|---|---|---|
| P2-1 | cache.ts | 全文件 | 零引用死代码 | 混淆 | 删除 |
| P2-2 | recognition.ts:26 vs stockIdentity.ts | normalizeStockCode | 两版不一致 | 代码校正边界不一致 | 统一一份 |
| P2-3 | schema.ts | 数值列 | 价格/额/量/两融用 varchar | 无法 SQL 排序，读写转换 | 改 DECIMAL/INT |
| P2-4 | db.ts:1786 | resultJson/stateJson | 8MB 级整结果落库+直传 | 存储+网络开销 | 分层裁剪+压缩 |
| P2-5 | Backtest.tsx:130-141, Market.tsx:347 | 前端统计 | 三档汇总/情绪分档前端自算 | 前后端重复+不一致 | import shared |
| P2-6 | db.ts:226, tushare.ts:267-307 | 死函数/不可达分支 | getLimitUpRecordsBySector、tushare 不可达 | 混淆 | 删除 |
| P2-7 | factorScore.ts:87-88 | neutralizationSubScore | <0 与 <0.2 两分支都返回 1 | 逻辑冗余 | 修正分支 |
| P2-8 | overfittingGuard.ts:215 | runReturnBootstrap | 仅 IID bootstrap | 破坏自相关，CI 偏窄 | 加 Moving/Stationary Block Bootstrap |
| P2-9 | technicalFactors.ts | icDecay | 无标准 IC(1/3/5/10/20/30D) 六档 | 衰减曲线不全 | 补全六档 |
| P2-10 | downsideRisk.ts:145 | parameterStability | 无参数网格敏感性热力图 | 无法判断参数平台 vs 尖峰 | 新增参数敏感性 |
| P2-11 | realisticBacktest.ts | 集合竞价/最低佣金 | 未实现 | 交易规则不完整 | 补集合竞价、最低 5 元佣金 |

---

## 25. P3 Issues（Low）

| ID | File | Function | Problem | Risk | Recommendation |
|---|---|---|---|---|---|
| P3-1 | leaderCandidates.ts:451/833 | buildLatestStockNameMap | 用全量（含未来）取名 | 曾改名股票名称轻微超前 | 改为 PIT 名称（当日名称快照） |
| P3-2 | leaderCandidates.ts:836-849 | 交易日历 | 无价格时用记录日期降级 | 缺涨停日误判 | 接入 trade_cal 真日历 |
| P3-3 | Market.tsx:347 vs db.ts:1275 | 情绪分档 | 五档 vs 七档不一致 | 展示不一致 | 统一 shared |
| P3-4 | leaderCandidates.ts:614/624 | 准入分/候选上限 | 52/20 硬编码无常量 | 维护性 | 抽常量 |
| P3-5 | 测试 | 15 个环境类测试 | 缺 token/DB/StockPriceSync.tsx 长期挂账 | CI 混淆 | 补齐环境或标 skip |
| P3-6 | Map.tsx, AIChatBox, ManusDialog | 未引用组件 | 死代码 | 混淆 | 删除或挂载 |

---

## 26. Existing Code Worth Keeping

| 分类 | 代码 | 理由 |
|---|---|---|
| **KEEP（保留）** | leaderCandidates.ts 的 PIT 候选/连板/回测行构建 | 系统价值最高，point-in-time 纪律好 |
| **KEEP** | realisticBacktest.ts 的成交-退出细节（滑点分层/一字涨跌停/盘中止损/除权检测） | 交易规则实现细致 |
| **KEEP** | technicalFactors.ts 的 RankIC/NW-HAC/衰减 + factorCombination 的 VIF/中性化 | 统计实现正确（并入统计库后保留逻辑） |
| **KEEP** | overfittingGuard.ts 的 monkey/cost sensitivity/bootstrap | 合理（DSR 改真实试验数） |
| **KEEP** | paperTrading.ts 前向闭环 | 系统唯一干净 OOS |
| **KEEP** | downsideRisk.ts 滚动窗口寻优框架 | walk-forward 设计正确（只是太重） |
| **KEEP** | 数据库幂等同步 + 停牌窗口 + 代码校正 | 工程基础扎实 |
| **REFACTOR（重构）** | db.ts → dao/ + research/ | 拆上帝文件 |
| **REFACTOR** | routers.ts sentiment 组 → 独立组 | 拆路由 |
| **REFACTOR** | leaderCandidates.ts 结果类型 → 分层 | 拆巨型返回 |
| **REFACTOR** | 统计原语 → shared/quant-stats.ts | 去重 |
| **REPLACE（替换）** | 双模拟引擎 → 单一 SimEngine | 消除镜像重复 |
| **REPLACE** | 涨跌停硬编码 → 板块涨跌幅表 | 修 P0 交易规则 |
| **REPLACE** | 数值 varchar → DECIMAL/INT | 修存储 |
| **DEPRECATE（废弃）** | cache.ts, Map.tsx, AIChatBox, ManusDialog, getLimitUpRecordsBySector, tushare 不可达分支, sourceUpdatedAt, paramsHash 索引 | 死代码/冗余 |

---

## 27. Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ 共享层  shared/                                              │
│  quant-stats.ts（统一统计原语 + 单一 Sharpe）               │
│  strategy-config.ts（52/0.35/65/档位表/观察窗 唯一事实源）  │
│  client-formats.ts（红绿/文案/分档标签）                    │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Data 层                                                      │
│  dao/（按域分文件，纯 SQL，DECIMAL 数值列）                 │
│  market/（行情同步·复权）  records/（涨停录入·识别·校正）   │
│  runs/（回测·纸面持久化，分层裁剪）                         │
│  universe/（全市场 PIT 宇宙：list_status/list_date/delist）  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Factor 层  domain/factors/                                   │
│  技术因子（PIT）· 市场因子 · 情绪因子                       │
│  neutralization（市值/行业/Beta/波动/流动性）               │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Strategy 层  domain/strategy/                                │
│  Expert Rule 打分（权重显式声明） · 信号生成                 │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Backtest 层  engine/sim-engine.ts（唯一成交-退出引擎）       │
│  批量回测 = 一次性喂全量 rows；纸面 = 逐日增量喂同一引擎     │
│  板块涨跌幅表驱动的 limit price                              │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Validation 层  research/                                     │
│  rows-repo（rows 级缓存物化，版本号失效）                    │
│  frozen-holdout.ts（冻结留出集 + 实验台账）                  │
│  factorEval（RankIC/ICIR/HAC/分位/衰减/稳定性）             │
│  overfitting（DSR/PSR/PBO/CSCV/Block Bootstrap）            │
│  walk-forward（滚动窗口 + 参数敏感性热力图）                 │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Research/Paper 层                                            │
│  paper-trading.ts（前向闭环，唯一干净 OOS）                  │
│  forward-validation.ts（前向验证）                           │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ API 层  routers/candidates · backtest · paperTrading ·       │
│  sentiment · sync · admin（按需裁剪，不再整包 8MB）         │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ UI 层  录入域（Home/Upload/Market）· 研究域（LeaderCandidates/│
│  Backtest/PaperTrading）· 运维域（StockSync）               │
│  组件只做渲染；汇总/文案/常量全部来自 shared                 │
└──────────────────────────────────────────────────────────────┘
```

**与目标结构的差距**：当前 `Data → Factor → Strategy → Backtest → Validation → Research → Paper` 中，**Factor 与 Strategy 物理混合在 leaderCandidates.ts**（评估宇宙=策略过滤子集）、**Backtest 双引擎镜像**、**Validation 缺 PBO/CSCV/Block Bootstrap/参数敏感性**、**Research 缺实验台账与冻结留出**。其余层次已具备雏形。

---

## 28. Migration Plan（规划，不执行）

### Phase 1（统计正确性 + 零风险 P0 修复）
1. 抽 `shared/quant-stats.ts`（唯一 mean/median/std/skew/kurt/分位/Spearman/NW-HAC/单一 Sharpe 定义）
2. 修复 P0-7 Sharpe 双定义、P0-2 指标错配、P1-6 marketSync note 失配（一行）
3. 抽 `shared/strategy-config.ts`（52/0.35/65/档位表单一事实源，含版本号）
4. 修复涨跌停硬编码 → 板块涨跌幅表（P0-5）
5. 引入 Research Trial Registry，替换 DSR numTrials=30 硬编码（P0-1）

### Phase 2（结构拆分 + 引擎合并）
6. db.ts → dao/ + research/；routers sentiment 组拆分
7. 双模拟引擎 → 单一 sim-engine.ts
8. leaderCandidates 结果类型分层（summary/full 按需订阅）
9. 数值 varchar → DECIMAL/INT（迁移窗口）
10. rows-repo 缓存物化层（版本号失效）

### Phase 3（验证层补强）
11. frozen-holdout.ts 冻结留出集 + 实验台账
12. PBO/CSCV 验证
13. Block Bootstrap（Moving/Stationary）
14. 参数敏感性热力图
15. 全市场 PIT 宇宙（stock_basic + list_status/list_date/delist_date）消除生存者偏差

### Phase 4（研究平台化）
16. 因子评估与选股决策物理隔离（评估用全候选截面）
17. IC(1/3/5/10/20/30D) 六档衰减曲线
18. 行业/Beta/波动/流动性中性化
19. 复权因子接入 + 集合竞价/最低佣金
20. Paper Trading 前向验证提升为系统评级事实标准

---

## 29. Risk Register

| 风险类别 | 具体风险 | 严重度 | 关联问题 |
|---|---|---|---|
| Data Risk | 数值 varchar、全表载入、冷启动 6-20min | High | P1-4, P2-3 |
| Data Risk | 复权缺失，除权日收益虚假 | High | P1-9 |
| Leakage Risk | OOS 尾 30% 反复曝光，无冻结留出 | **Critical** | P0-3 |
| Leakage Risk | 名称映射用全量（未来） | Low | P3-1 |
| Model Risk | 涨跌停硬编码无板块区分 | **Critical** | P0-5 |
| Model Risk | 生存者偏差（无全市场宇宙） | **Critical** | P0-6 |
| Model Risk | 因子评估宇宙=策略过滤子集 | High | P1-8 |
| Execution Risk | 双引擎镜像规则漂移 | High | P0-4 |
| Execution Risk | 前后端常量双份 | High | P1-7 |
| Overfitting Risk | DSR 试验数硬编码=30 | **Critical** | P0-1 |
| Overfitting Risk | IID bootstrap 破坏自相关 | Medium | P2-8 |
| Overfitting Risk | 无 PBO/CSCV/参数敏感性 | High | §17/18 |
| Architecture Risk | db.ts/路由/结果类型三处巨石 | High | P1-1/2/3 |

---

## 30. Final Recommendation

### 1. 当前项目能否直接作为量化研究平台继续开发？

**不能直接**。作为「单策略复盘工具」可继续使用，但要作为「可泛化的因子/策略研究平台」，必须先解决 5 个 P0 统计真实性问题（DSR 试验数、Sharpe 双定义、指标错配、OOS 泄漏、生存者偏差）和 1 个 P0 交易规则问题（涨跌停硬编码）。这些不解决，任何研究结论都不可信。

### 2. 哪些模块必须重构？

- db.ts（上帝文件）→ dao/ + research/
- 双模拟引擎（realisticBacktest ↔ paperTrading）→ 单一 SimEngine
- leaderCandidates.ts 巨型返回 → 分层
- 涨跌停硬编码 → 板块涨跌幅表
- 统计原语 4 份 → shared/quant-stats.ts

### 3. 哪些模块可以直接保留？

- leaderCandidates.ts 的 PIT 候选/连板/回测行构建
- realisticBacktest.ts 的成交-退出细节
- technicalFactors.ts 的 RankIC/NW-HAC/衰减 + factorCombination 的 VIF/中性化
- overfittingGuard.ts 的 monkey/cost sensitivity/bootstrap
- paperTrading.ts 前向闭环
- 数据库幂等同步 + 停牌窗口 + 代码校正

### 4. 最优先修复哪 5 个问题？

1. **P0-1** DSR numTrials=30 硬编码 → Research Trial Registry
2. **P0-7** Sharpe 双定义 → 统一单一定义
3. **P0-5** 涨跌停硬编码 → 板块涨跌幅表
4. **P0-2** 指标错配（baseline vs riskPenalty Sharpe 相减）
5. **P0-3** OOS 泄漏 → 冻结留出集

### 5. Phase 1 应该具体做什么？

按 §28 Phase 1 执行：先抽 `shared/quant-stats.ts` 统一统计原语与 Sharpe，再修 P0-2/P1-6 两个零风险点，然后抽 `shared/strategy-config.ts` 消除前后端双份常量，接着修涨跌停硬编码，最后引入 Research Trial Registry。这 5 步全部**不动架构**、**不删旧代码**、可逐步验证。

---

> **审计声明**：本报告基于 2026-09-05 时点的源码快照，所有行号可回查。Phase 0 仅执行 READ/ANALYZE/TRACE/REPORT，未修改任何源码/schema/UI/参数/数据库。
