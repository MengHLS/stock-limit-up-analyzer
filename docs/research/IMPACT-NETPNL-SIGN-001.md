# IMPACT-NETPNL-SIGN-001 — `trades[].netPnl` 符号缺陷的影响分析（**未修，待裁定**）

> 性质：**影响分析为只读**；**修复已按用户裁定实施**（P1 测试锁 → P2 改公式 + 口径标记）。
> 依据：[`RESULT-151PCT-WINNER-CONCENTRATION-001`](RESULT-151PCT-WINNER-CONCENTRATION-001.md) §8（缺陷定性 + 量级吻合）。
> 目的：按 [AGENTS.md](../../AGENTS.md) §5 的要求，在**动代码之前**给出完整影响面与修复方案，等用户裁定。
> 🔴 **执行状态**：P0 排查 ✅ · P1 测试锁 ✅ · P2 修复 ✅ · P3 未做 · **历史 Run 未回填**（按 §6 处置）。
> 结论摘要：**受影响的只有「逐笔盈亏派生」的指标（`profitFactor` / `expectancy` / `winRate` / `concentration` / `returnPct`）；`totalReturnPct` / MaxDD / CAGR / 权益曲线不受影响。**

---

## 1. 缺陷（确定性结论）

`server/backtest/portfolio.ts`：

```ts
// :288（卖出时累加）
open.grossPnL += (fill.basePrice - open.entryBasePrice) * quantity;   // 两条腿都用「无滑点基准价」
// :304（清仓时定案）
const netPnl = open.grossPnL - open.fees - open.slippageAmount;
```

`server/backtest/cost.ts:49-50`：

```ts
export function slippageAmount(price, basePrice, quantity) { return (price - basePrice) * quantity; }  // 有符号
```

而成交价由 `execution.ts:39-42` 构造：

- 买入 `slippedBuyPriceAdjusted` = `base × (1 + bps)` ⇒ `p_buy > b_base` ⇒ 买入滑点 **正**
- 卖出 `slippedSellPriceAdjusted` = `base × (1 − bps)` ⇒ `p_sell < b_base` ⇒ 卖出滑点 **负**

⇒ 代数结论（已推导并验证）：

```
netPnl − 真实现金 = −2 × (p_sell − base_sell) × q = +2 × |卖出侧滑点|
```

**`netPnl` 把卖出侧滑点「减了一个负数」= 又加回来一次，系统性高估。**

**量级吻合（关键佐证）**：差额 ÷ 2 = 18,871；卖出侧名义额 36,974,668
⇒ 隐含卖出滑点 **5.10 bp**，配置 `slippageBps` = **5 bp**（差 2%）。

**双路径闭合检验**：

| 路径 | 值 | 说明 |
|---|---:|---|
| Σ`netPnl`（现状） | 188,837.84 | 高估 |
| 权益增量（`cash + marketValue` 台账） | **151,095.83** | 权威 |
| 差额 | **37,742.01** | = 2 × 卖出侧滑点 |
| 现金口径 `(exit−entry)×q − fees` | 145,746.92 | 比权威值低 **5,349** |
| 该残差 | ≈ 5,349 | = 现金分红（`portfolio.ts:166` `grossPnL += dividendCash`），**合法损益** |

⇒ **两条独立路径收敛到 3.5% 以内，残差可归因于分红。缺陷定性成立。**

## 2. 影响量化（run 6210006 · closed n=1429）

口径 A = 现状 `trades[].netPnl`；口径 B = 现金口径 `(exitPrice−entryPrice)×qty − fees`（不含分红 ⇒ 略低估）。

| 指标 | **A 现状** | **B 现金口径** | Δ | 受影响 |
|---|---:|---:|---:|:--:|
| Σ 逐笔净额 | 188,838 | 145,747 | −43,091 | ✅ |
| 中位单笔 | −281.4 | −309.6 | −28.2 | ✅ |
| **expectancy（均值/笔）** | **+132.15** | **+101.99** | **−30.15（−22.8%）** | ✅ |
| **winRatePct** | **38.56%** | **37.93%** | **−0.63pp**（**9 笔符号翻转**） | ✅ |
| grossProfit | 1,099,650 | 1,081,528 | −18,122 | ✅ |
| grossLoss | 910,812 | 935,781 | +24,969 | ✅ |
| **profitFactor** | **1.2073** | **1.1557** | **−0.0516（−4.3%）** | ✅ |
| averageWinPct | 7.8460 | 7.8473 | +0.0013 | ✅ |
| averageLossPct | −4.1311 | −4.1943 | −0.0632 | ✅ |
| **concentration.top5SharePct** | **329.87%** | **424.55%** | **+94.7 pp** | ✅ |
| **concentration.top10SharePct** | **438.73%** | **563.86%** | **+125.1 pp** | ✅ |
| concentration.maxWin / maxLoss | 44,620.51 / −5,528.09 | 44,539.87 / −5,552.87 | −80.64 / −24.78 | ✅ |
| maxConsecutiveLosses | 17 | 待重算 | — | ✅ |

**复算校验**：A 口径复算 `profitFactor = 1.207329004` vs 持久化 `1.207329003673333` ⇒ **9 位一致**，
`concentration` 复算 `top5 = 329.8663%` vs 持久化 `329.8662891131114%` ⇒ **10 位一致**
⇒ 本表的「现状」列与系统事实一致，Δ 可信。

### 2.1 两个方向相反的后果（都重要）

1. **策略看起来比实际好**：`profitFactor` −4.3%、`expectancy` −22.8%、`winRate` −0.63pp。
2. **集中度看起来比实际轻**：`top5SharePct` **+94.7pp**、`top10SharePct` **+125.1pp**
   ⇒ **真实集中度更极端** ⇒ `RESULT-151PCT-WINNER-CONCENTRATION-001` 的**核心结论被加强**，不是削弱。

## 3. 代码级消费者清单

### 3.1 直接消费 `netPnl`（改则数值变化）

| 文件 | 位置 | 受影响产出 |
|---|---|---|
| `server/backtest/backtestResult.ts` | `:239-263` `computeTradeMetrics` | `winRatePct` / `averageWinPct` / `averageLossPct` / **`profitFactor`** |
| `server/backtest/backtestResult.ts` | `:545-547` | CSV 导出（`netPnl` 列） |
| `server/backtest/metrics.ts` | `:45` `:75-93` | `grossProfit` / `grossLoss` / `averageWin` / `averageLoss` / **`expectancy`** / **`profitFactor`** |
| `server/backtest/portfolio.ts` | `:288` `:304` | **缺陷源头** |
| `server/engine/performance.ts` | `:46` `:78-96` | **legacy** 引擎同名指标 |
| `server/engine/portfolio.ts` | `:202` `:213` | legacy `netPnl`（**另一套公式**，需单独判定是否有同缺陷） |
| `server/realisticBacktest.ts` | `:338` `:344-346` `:684-731` | legacy `netPnl` / `netReturn` / `pnlToEquityRatio` / `winRate` / `profitFactor` |
| `server/paperTrading.ts` | `:645` `:652-653` `:1019-1050` | **纸面交易** `realizedPnL` / `netReturn` / `profitFactor` |
| `server/paperTrading3fTop3Runner/run.ts` | `:143` `:152` `:205` | 纸面前端 `realizedPnL` |
| `server/downsideRisk.ts` | `:462` `:512` `:933-934` `:1034` | `tradeQuality` / `baselineOnlyNetPnl` / `riskPenaltyOnlyNetPnl` |
| `server/leaderCandidateStrategyBacktest.ts` | `:152` `:167` `:254` `:287` `:290` | legacy 回测摘要 |
| `server/research/closedLoop/adapters.ts` | `:107` | 闭环 `backtest` 段 |
| `server/research/tradeQualityMetrics/analyze.ts` | `:20` `:458-461` | `expectancy` / `averageLoss`（**转出口 STEP-8 值，单一真源 ✅**） |
| **`scripts/runStrategyT74FinalEvaluation.mts`** | **`:92-108`** | **`concentrationOf`（top5/top10/maxWin/maxLoss）** —— 注意此指标**不在 `server/` 里** |
| `scripts/runStrategyT74FinalEvaluation.mts` | `:110-123` `:125+` | `maxConsecutiveLosses` / `summary`（winRate） |
| `client/src/components/strategy/StrategyEvaluationTemplate.tsx` | `:26` `:98` `:219` `:237-243` | 前端集中度卡 / Top10% Share 对照 |

#### 3.1b 🔴 修正（2026-10-07 排查）：上表**过度包含** —— 平台里四套记账实现，**三套本来就是对的**

上表按「名字里出现 `netPnl`」列出消费者，但**真正的缺陷只在 `server/backtest/portfolio.ts` 一处**。
其余三套记账**各自独立实现**，且统一采用 **`proceeds − cost basis`** 口径 ——
该口径把两条腿都当现金进出，滑点已含在成交价里，**结构上不可能重复扣减**：

| 记账实现 | 口径 | 是否有缺陷 |
|---|---|---|
| **`server/backtest/portfolio.ts`**（新 Backtest Core） | `grossPnL`（无滑点基准价）− fees − **有符号滑点** | 🔴 **有（已修）** |
| `server/engine/portfolio.ts:187-202`（legacy 引擎） | `realizedPnl = proceeds − costBasis`，`netPnl = Σ realizedPnl` | ✅ **无** |
| `server/realisticBacktest.ts:335-338` | `netPnl = proceeds − position.capitalCost` | ✅ **无** |
| `server/paperTrading.ts:642-645` | `netPnl = proceeds − position.capitalCost` | ✅ **无** |

**验算（legacy）**：买入 `totalEntryCost = p_b·q + buyFees`（+ `cash -= totalEntryCost`）；
卖出 `proceeds = p_s·q − sellFees`；清仓时 `costBasis = totalEntryCost`
⇒ `netPnl = (p_s·q − sellFees) − (p_b·q + buyFees) = (p_s − p_b)·q − fees` = **真实现金损益** ✅

**⇒ 污染范围收窄为「经 `server/backtest/**` 产出的数」**：
`closed_loop_backtest_run` payload（含 run `6210006`）· `parameter_search_result` ·
`search_robustness_result` · `oos_validation` · `walk_forward*` · 由它们派生的 `RESULT-*`。
**不受影响**：legacy `engine/**` 路径（`/backtest` 面板、龙头候选回测）· `realisticBacktest`
（含 combo-backtest 与 `downsideRisk` 归因）· **纸面交易 payload**。

> 生产闭环之所以受影响，是因为 `simulator/engine.ts:42,499` **直接 `new Portfolio(...)`**
> 复用 `backtest/portfolio.ts` ⇒ 修复正好覆盖该路径（这也解释了 run `6210006` 为何有此缺陷）。

#### 3.1c ⚠️ 顺带发现的命名陷阱（**未修，仅登记**）

同名诊断字段 `slippageAmount` 在**两套引擎里符号约定相反**：

| 位置 | 买入 | 卖出 | 语义 |
|---|---|---|---|
| `server/engine/execution.ts:171,179` | `(price − base)` | **`(base − price)`** | **成本为正**（两腿 adverse 均为正） |
| `server/backtest/cost.ts:50` | `(price − base)` | `(price − base)` | **有符号**（卖腿为负） |

缺陷的根源正是「把有符号量的输出直接拿去减」。另：`grossPnL` 的定义也跨引擎不一致 ——
`backtest`（修复后）为**成交价口径**、`engine/portfolio.ts:210` 仍为**无滑点基准价口径**
⇒ legacy 的 `netPnl ≠ grossPnL − fees`。legacy 的 `netPnl` 数值是对的，但**字段语义不一致**
值得登记，避免以后用 `grossPnL − fees` 反推 netPnl 时踩坑。

### 3.2 🔴 `profitFactor` 的**下游传播**（影响面远大于上表）

`profitFactor`（及 `expectancy`）被这些子系统当作**结果指标**持久化或参与挑选：

| 子系统 | 位置 |
|---|---|
| 参数搜索 | `server/research/parameterSearch/executor.ts:600,798,850,1090` · `searchResult.ts:15,53,77,96,219` · `persistence.ts:429,464,485,527` |
| 搜索稳健性 | `server/research/searchRobustness/{types,persistence,analysis,executor,neighborhood}.ts` |
| OOS 验证 | `server/research/oosValidation/{executor,comparison,types}.ts`（`isProfitFactor` / `oosProfitFactor` / delta / ratio） |
| Walk-Forward | `server/research/walkForward/aggregate.ts:39` |
| 实验谱系校验 | `server/research/experimentLineage/validate.ts:168-192`（数值白名单） |
| 路由 / 前端 | `server/paramSearchRouter.ts:917` · `server/research/closedLoop/{types,adapters}.ts` |

### 3.3 ✅ P0 排查已完成：**无任何「判定/择优」使用 `profitFactor` / `expectancy`**

> 结论：**影响级别 = 「指标需重算」，不是「历史策略结论作废」。**
> 参数搜索的择优、稳定区判定、候选产出、稳健性判定、OOS 隔离门禁、WFA 各折 —— **全部不受影响。**

| 层 | 判据实际用到什么 | 证据 |
|---|---|---|
| **参数搜索 · 结果排序/过滤** | **只是能力**，且**默认按 `combinationIndex` 升序** | `parameterSearch/executor.ts:1053`「只提供能力，**不产出「最佳参数」结论**」· `:1098`「**刻意不用收益排序**」· `:1126` `sortBy ?? "combinationIndex"` |
| **参数搜索 · 稳定区判定（产候选的门禁）** | **仅 `totalReturnPct` 与 `maxDrawdownPct`** | `parameterSearch/region.ts:158-159` `returnOk = totalReturnPct >= min` ∧ `drawdownOk = maxDrawdownPct <= max`；`:176-181` 成员排序按 `totalReturnPct` 降序；`:186-195` `verdict` 由合格数 / 坏点率决定 |
| **参数搜索 · 候选产出** | 由 `region.verdict` 决定 ⇒ 间接只用上述两项 | `parameterSearch/candidate.ts:45` `allowed = region.verdict === "stable" \|\| !requireStableCandidates` |
| **稳健性（C-18.1）· 漂移判定** | **仅收益与回撤两个维度** | `robustness/types.ts:87,89`（`RobustnessMetricsView` 比对字段）· `drift.ts:55` 只校验 `["totalReturnPct","maxDrawdownPct"]` · `:163-164` 只算 `returnDriftPct` / `drawdownChangePct` · `:205,212` 只产出这两条比较 |
| **随机化稳健性（C-18.2）/ 过拟合** | 复用 C-18.1 的阈值与漂移类型 | `overfittingDetection/parameterSensitivity.ts`（flags 由同一套漂移阈值产生） |
| **OOS 验证** | 只有**日期/隔离**门禁，**无指标阈值** | `oosValidation/window.ts:108,129`（窗口合法性）· `executor.ts:552-581`（失败态） |
| **全仓 `profitFactor` / `expectancy` 阈值比较** | **0 处** | 正则 `profitFactor\s*[<>]=?\|expectancy\s*[<>]=?` 全 `server/` **0 命中** |
| 参数搜索 · 指标有效性提示 | 要求**六项全为 null** 才提示不可用 ⇒ PF 非 null 时行为不变 | `parameterSearch/searchResult.ts:212-221` `isMetricsFullyUnavailable` |

**判据为何不受影响**：上述所有判定所依赖的 `totalReturnPct` / `maxDrawdownPct` 都来自
**权益台账（`cash + marketValue`）**，而缺陷只污染 `trades[].netPnl` 及其派生（见 §3.4）。

⚠️ **仍需注意（非判定、但会显示错）**：`oosValidation/comparison.ts:60` 与
`walkForward/aggregate.ts:39` 把 `profitFactor` 列入**描述性** delta / 聚合字段；
`searchRobustness` 与 `parameterSearch` 把 `profitFactor` **持久化用于展示与排序**。
这些**数值会过期**，但**不会改变任何结论或产出**。

### 3.4 受影响 vs 不受影响（一句话划分）

> **凡是从「权益台账 / 毛成交额」来的 ⇒ 安全；凡是从「逐笔 `netPnl`」来的 ⇒ 过期。**

### 3.5 明确**不受影响**（明细）

| 口径 | 值 | 为什么不受影响 |
|---|---:|---|
| `totalReturnPct` | **151.0958341843399%** | 出自 `cash + marketValue` 权益台账 |
| `cagrPct` | 12.751001177744058 | 同上 |
| `maxDrawdownPct` | 43.302944323482485 | 同上 |
| `maxDrawdownDurationDays` | 907 | 同上 |
| `finalEquity` | 251095.8341843399 | 同上 |
| `cost` | 90490.12971101009 | = `fees + slippageAmount`（毛额口径，未经过 `netPnl`） |
| `turnover` | 74257667.61599997 | 毛成交额 |
| `tradeCount` / `completedCount` | 1434 / 1429 | 计数 |

**⇒ 「151.0958%」这个数字本身是安全的**；不安全的是它周围那圈派生指标。

## 4. 建议的修复方案（**待裁定，未实施**）

### 4.1 推荐：让 `grossPnL` 直接基于**成交价**

`server/backtest/portfolio.ts`：

```ts
// :288  改为成交价（已含滑点）
open.grossPnL += (fill.price - open.entryPrice) * quantity;
// :304  滑点已含在价格里，不再二次扣减
const netPnl = open.grossPnL - open.fees;
```

此时 `netPnl = (p_sell − p_buy)·q + dividendCash − fees` = **真实现金损益**（已验证定义式）。

- ✅ 改动最小（两行），公式变得可直读
- ✅ `slippageAmount` 保留为**有符号诊断量**（正 = 成本），与 `cost.ts:6`「已计入成交价」的注释一致
- ⚠️ **`grossPnL` 语义变更**：从「不含滑点的毛损益」变为「含滑点的毛损益」。
  它是一个**对外字段**（`types.ts:293`、CSV `:545`），属**契约变更**，必须登记 + 加测试锁。
- ⚠️ 公司行为路径需一并核：`portfolio.ts:163-167` 对 `entryPrice`/`entryBasePrice` 同比例缩放、
  `grossPnL += dividendCash` —— 改后 `dividendCash` 仍应计入，需回归测试覆盖分红笔。

### 4.2 不推荐：只改 `cost.ts#slippageAmount` 的符号

该函数另有 **4 处**消费者（`backtest/audit.ts:51-54`、`research/costModel/compute.ts:70`、
`engine/execution.ts:171,179`、`simulator/engine.ts:919,1226`），改符号会**连带破坏成本审计与成本模型**。

### 4.3 不推荐：拆 buy/sell 两个滑点字段

需新增 `open.buySlippage` / `open.sellSlippage` 并改 `netPnl` 公式，改动比 4.1 大且引入新字段。

## 5. 修复时必须附带的测试锁

| # | 断言 |
|---|---|
| 1 | 单笔已知买/卖价与滑点 ⇒ `netPnl === (exitPrice − entryPrice) × qty − fees`（± 分红） |
| 2 | **全局闭合**：无未平仓的 Run ⇒ `Σ netPnl === finalEquity − initialCapital`（1e-6） |
| 3 | 分红笔回归：持有跨除权日的交易，`netPnl` 含 `dividendCash` 且现金台账同步 |
| 4 | 送转/拆股：`entryPrice`/`quantity` 比例缩放后 `netPnl` 经济等价 |
| 5 | 部分成交：`quantity < requested` 时 `netPnl` 与实际成交量对应 |
| 6 | 破平不变量：`grossPnL` 语义变更后，**同桶次序**不得因浮点变化而改变（对齐 `threeFactorScoreFeatures.ts:149-151` 的 1 ULP 警告） |

## 6. 修复后的重算清单（which persisted values become stale）

| 对象 | 影响 |
|---|---|
| `closed_loop_backtest_run.resultJson` / `summaryJson`（**全部历史 Run**） | PF / winRate / concentration / expectancy / maxConsecutiveLosses 过期 |
| `parameter_search_result` | PF / expectancy 过期；**且若参与择优，最优参数本身可能变** |
| `search_robustness_result` | PF 过期 |
| `oos_validation` | `isProfitFactor` / `oosProfitFactor` / delta / ratio 过期 |
| `walk_forward*` 聚合 | PF 聚合过期 |
| 纸面交易 payload | `realizedPnL` / `netReturn` / `profitFactor` 过期 |
| 前端 | `StrategyEvaluationTemplate.tsx` 集中度卡 / 搜索表 |
| 文档 | 所有含 PF / expectancy / winRate / concentration 的 `RESULT-*` |

**⚠️ 本平台明令禁止「回填历史 Run」（AGENTS.md §5）** ⇒ 修复后**不得修改历史行**；
正确做法是**新老口径并存并显式标注版本**（例如在 payload 里加
`netPnlCaliber: "cash-v2"`），历史行按老口径读、新 Run 按新口径写，并在文档里登记分界。

## 7. 处置建议（按性价比）

| 优先级 | 动作 | 说明 |
|---|---|---|
| ~~**P0**~~ | ~~先核 §3.2 的「参数搜索是否用 PF 择优」~~ | ✅ **已完成（2026-10-07）⇒ 无任何判定/择优使用 PF / expectancy，影响级别止于「指标重算」（见 §3.3）** |
| ~~**P1**~~ | ~~落 §5 的测试锁（**先加测试、后改公式**）~~ | ✅ **已完成**：`tests/server/backtest/netPnlCaliber.test.ts`（8 例）。**修复前 3/8 红，差值恰为 `2 × 卖出侧滑点`（11.0 / 56.0）⇒ 机制被独立确认** |
| ~~**P2**~~ | ~~实施 §4.1，带 `netPnlCaliber` 版本标记~~ | ✅ **已完成**：`portfolio.ts` 两行口径修正 + 删除无用 `entryBasePrice`；`context.ts` 版本 **1 → 2** + `NETPNL_CALIBER = "cash-v2"` + 文案行。契约变更已登记 `CHANGE-AUDIT.md` |
| **P3** | 新 Run 重跑关键策略，对比新旧口径 | ⬜ **未做**（只跑必要的，不批量回填） |

## 8. 裁定结果与落地记录（2026-10-07）

1. **实施 §4.1** —— ✅ **已裁定并执行**（含 `grossPnL` 语义变更，已登记 `CHANGE-AUDIT.md`）。
2. **接受「新老口径并存、不回填」** —— ✅ 已按此执行：两代行靠 `executionPolicyVersion`（1 / 2）区分，
   **未修改任何历史行**（AGENTS.md §5）。
3. ~~是否先做 P0 排查~~ —— ✅ 已完成（见 §3.3）。

### 8.1 落地清单

| 项 | 内容 |
|---|---|
| 缺陷修复 | `server/backtest/portfolio.ts`：`grossPnL` 改成交价口径、`netPnl = grossPnL − fees`、删 `entryBasePrice` |
| 口径标记 | `server/backtest/context.ts`：`BACKTEST_EXECUTION_POLICY_VERSION` **1 → 2**（同时是 cache 判据 ⇒ 旧缓存自然失效）+ `NETPNL_CALIBER = "cash-v2"` + `describeExecutionPolicy()` 文案行 |
| 测试锁 | 新增 `netPnlCaliber.test.ts`（8 例）：单笔口径 · 滑点四象限不变量 · `slippageAmount` 仍为有符号诊断量 · 组合层闭合 `cash − initial ≡ Σ netPnl` · 分红闭合 · 拆股经济等价 · 部分成交 · 未平仓恒 null |
| 既有断言修正 | `backtest2.test.ts`：删除**错误的不变量** `Net = Gross − Fees − Slippage`，改为成交价口径（**测试本身是错的**，理由已写入注释）· `positionSizingExecution.test.ts`：版本断言 v1 → v2 + 新增口径文案断言 |
| 审计 | `docs/architecture/CHANGE-AUDIT.md` 新增 `2026-10-07 · IMPACT-NETPNL-SIGN-001` |

### 8.2 门禁结果

| 门禁 | 结果 |
|---|---|
| `pnpm run check`（tsc --noEmit） | **exit 0 / 0 错**（删除 `entryBasePrice` 未破坏任何引用 ⇒ 证实其确为死字段） |
| 新增锁 `netPnlCaliber.test.ts` | **8 / 8**（修复前 **3 / 8 红**） |
| `pnpm run test:changed` | 52 文件 / 710 例，**49 文件通过**；失败 3 文件 8 例**全为既有红** |
| `node scripts/checkEolDrift.mjs --strict` | **0** |
| 历史数据回填 | **0**（未改任何历史行） |

### 8.3 「零新增失败文件」的**实验证伪**

失败的 3 个文件均为**既有红**，且**不是靠推理、而是靠实验**确认的：

- `limitUp.test.ts` / `limitUp.watch.test.ts`：失败信息为**数据库不可用**，
  且 `docs/step-dataset-002.2-report.md:178` 已把它们登记为环境依赖红。
- `threeFactorTopNStrategyDocument.test.ts`：期望字面量**缺 `recoveryPath` 键**
  （该文件 `recoveryPath` **0 命中**，而 `runWorkbenchAssembly/exitPolicy.ts:86-108` 恒返回该键）。

🔴 **决定性验证**：把本次两处源码改动 `git stash`、在 **HEAD 原逻辑**上重跑这 3 个文件 ⇒
**同样 3 文件 / 8 例失败，且用例名逐条一致**。⇒ **零新增失败文件（已实测，非推断）。**

### 8.4 未做（如实登记）

1. **未回填任何历史 Run**；未重算任何历史 `RESULT-*` 的 PF / expectancy / 集中度（按 §6 处置）。
2. ~~**未判定 `server/engine/portfolio.ts` 的 legacy `netPnl` 是否有同缺陷**~~ ✅ **已判定（2026-10-07）：无缺陷**。
   平台四套记账实现中三套（`engine/portfolio.ts` · `realisticBacktest.ts` · `paperTrading.ts`）
   均用 `proceeds − cost basis` 口径，**结构上免疫**；缺陷只在 `backtest/portfolio.ts` 一处，**已修**。
   污染范围据此收窄，见 §3.1b。**`server/engine/portfolio.ts` 未作任何改动**（无需改）。
3. **未跑新 Run 做新旧口径对比**（P3，按需再做）。
4. 本修复**不改变** `threeFactorContinuousScoreFeatures.ts` 的未接线状态。
5. **未修**同名 `slippageAmount` 的跨引擎符号不一致（§3.1c）—— 属命名/文档问题，
   legacy `netPnl` 数值正确，改动它只会扩大范围；**仅登记**。
