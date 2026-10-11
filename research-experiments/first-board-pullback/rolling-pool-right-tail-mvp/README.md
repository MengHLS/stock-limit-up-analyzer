# `first-board-pullback/rolling-pool-right-tail-mvp`

> **首板滚动观察池 × 每日右尾识别（最小研究闭环）**
> 规格：[`docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001.md`](../../../docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001.md)
> S1 数据 Gate：[`docs/research/S1-FIRSTBOARD-ROLLING-POOL-ASSET-GATE-001.md`](../../../docs/research/S1-FIRSTBOARD-ROLLING-POOL-ASSET-GATE-001.md)

## 唯一研究问题

在首板触发的**滚动观察池**中，基于**当天收盘可知**的信息，每天按股票选最多 3 个候选，
能否比**同日同池随机**选择提高**从下一日开始的 20 交易日右尾机会**？代价是多少？

**这是研究标签口径，不是平台 `NEXT_OPEN` 策略回测，也不是盈利承诺。**

## 冻结配置

| 项 | 值 |
|---|---|
| Dataset | `780004` · `first_limit_pullback` · `v10-listed365-pre10-post80`（`READY`；`excludeSt=1` · `excludeListedWithinDays=365` · `preWindowDays=10` · `postWindowDays=80`） |
| 板块 / 上市龄 / ST | 沪深主板；**事件日**上市龄 ≥ 365 自然日；**事件日**非 ST（构建期固化） |
| 留池 | `rd1..40`；同 symbol 只保留**最早尚未过期**成员为锚点，其余进 `relatedEventIds`；新首板**不刷新**旧锚点 |
| 可选窗口 | 声明 `rd5..40`；**两主臂与 Random 共用「两因子均可评估」的当日池** ⇒ 有效下界 = `rd15`（`maxAmp5` 的 Core 决策下界）；`rd5..14` 仍留观察账 |
| 每日节奏 | 当日收盘更新状态 / 排名；假设入场在**下一交易日开盘** |
| TopK | ≤ 3（人数不足**不补齐**；不比较 Top5/10） |
| 标签 A（主） | 下一交易日开盘入场，持有 **20 个交易日**；主退出不可卖时顺延到其后首个可卖价，**最多再 10 交易日**；超过上限 ⇒ 上限日收盘 MTM 并标未退出 |
| 标签 B（辅） | 未来 20 日最高价 / 入场价 − 1（**不是可实现收益**） |
| 成本 | 固定往返 **20bps** 主 / **50bps** 敏感性（研究标签诊断，不是账户费率/冲击模型） |
| 三臂 | `R` = `preReturn10` HIGH；`M` = `maxAmp5` LOW；`RANDOM` = 同日同池同人数均匀**无放回** × 200 固定种子 |
| 破平 | 确定性 `symbol` 升序 + `eventId` 升序 |
| 区间 | 逐日配对差 → 日期移动块 bootstrap（block20 主 / block40 敏感性 / 1000 次 / 固定种子）；两预声明主臂用 Bonferroni **97.5% 双侧** |
| 主窗口 | 决策日 `2024-01-02 ~ 2025-09-30` |

## 两个因子的权威来源

| 因子 | 定义 | 实现来源 |
|---|---|---|
| `preReturn10` | `close(rd−1) / close(rd−10) − 1` | 既有冻结定义（`shared/singleFactor/rightTailUniverse.ts` 与 `twelve-factor-composite-study/derive.ts` 两份逐字相同）；本实验只读 `prefix rd −1/−10` |
| `maxAmp5` | `max(链式前收振幅[rd11..15])`，决策时点下界 `rd15` | **Strategy Core 权威实现**：经 [`@experiments/strategyCoreBridge`](../../strategyCoreBridge.ts) 调用 `server/strategyCore/featureRegistry.ts#makeEventStateAmplitudeFeatures` 的 `FeatureDefinition.compute`；**不复制公式** |

`maxAmp5` 的可见性经 **Core 的 PIT 唯一关卡** `createDayScopedBarAccess#barsUpTo(15)` 取 bar，
越界读取会被 Core 记录并由本实验**响亮抛错**。

## 为什么「一次算完、逐日复用」不是偷看未来

`maxAmp5` 的 Core 定义**硬截断在 `rd15`**（`bar.relativeDay <= window.end`）且要求当前 bar 的
`relativeDay >= 15` ⇒ 对任意可选年龄 `a ≥ 15`，取值**完全相同**。
`preReturn10` 只读 `prefix rd ≤ 0`。因此两个排名输入恒 `≤ rd15 ≤ 任意可选年龄`，
「逐日限定到 `decisionDate`」成立。每日账里的 `maxAmp5` 在 `age < 15` 时**记 null**
（当时拿不到），而不是把事后算好的值搬回当时。

## 契约缺口（如实登记，本轮不修）

1. `decisionOffsetDays` 是**单标量** ⇒ 无法表达逐日变化的决策坐标。本实验声明 `40`
   （资格判定的**上界**），逐日坐标由**内存投影**表达。
2. `observation(rd)` 无 `eventId` / 日期参数 ⇒ 逐日池只能从「整层 rd」投影；
   `freezeSelection` 一次性，冻结集 = 候选宇宙而非逐日成员。
3. 逐日 ST / 上市龄不在 Dataset 端口内 ⇒ 事件日非 ST 由构建期保证；
   逐日 ST 记 `UNAVAILABLE`，**未实现每日非 ST 控制**（不伪造）。
4. `rd5..40` 与 Core `maxAmp5` 下界 `rd15` 的交集 = `rd15..40`（规格自己的条款确定，非私改）。

## 产物

| 产物 | 内容 |
|---|---|
| `result.json`（信封） | 三臂摘要、配对差区间、年度片段、判定、覆盖账、年龄直方图 |
| `tables/daily-pool-ledger.csv` | 每日股票级观察账（含拒绝原因、两因子、路径状态、`nextOpenExecutable`） |
| `tables/signal-ledger.csv` | R/M 逐信号标签（NO_FILL / 右删失 / MTM 全部保留） |
| `tables/random-draws.csv` | 200 次随机抽样的逐次成员（种子可复现） |
| `tables/daily-arm-stats.csv` | 逐日逐臂统计（配对差序列的输入） |
| `tables/opportunity-segments.csv` | 唯一机会段（离线合并口径） |
| `artifacts/rolling-pool-config.json` | 冻结配置与坐标 |

## 与其他研究的关系（**不重复**）

- `RESULT-PURE-RIGHT-TAIL-VALIDATION-001`（780003，固定 rd 坐标）已给出
  `preReturn10 HIGH` = 纯右尾暴露、**不是正期望信号**（`ExcessMean` 4/4 为负、左尾更差）。
  本实验沿用其 `STOP` 边界：**只把 R 当右尾暴露读数**，不当正期望选股信号。
- `PLAN-FIRST-LIMIT-POOL-ROLLING-3F-001` / `RESULT-FIRST-LIMIT-POOL-STREAMING-001` 是
  **组合级闭环回测**（v6 / `720001`，`preWindowDays=0` 算不出 `preReturn10`），与本实验
  的**事件级信息研究**不是同一件事，且本实验**不复用其数据集**。
- `RESULT-EVENT-OVERLAP-CLUSTER-001` 证明同日依赖主导（ICC ≈ +0.19、有效 n 远小于事件数）
  ⇒ 本实验**一律**用日期移动块 bootstrap，禁用 `sd/√n`。
