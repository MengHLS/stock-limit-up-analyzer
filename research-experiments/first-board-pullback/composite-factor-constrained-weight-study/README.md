# 受约束组合因子实验组（`composite-factor-constrained-weight-study`）

本目录承载**三个**实验实例（同一模板、同一页面，只差成员集合与权重口径）。
目录里的 `README.md` 是**口径文档**，不是结论文档 —— 结论在
`docs/research/RESULT-COMPOSITE-CONSTRAINED-WEIGHT-001.md`。

## 三个方案

| 方案 | 实验 id | 成员 | 权重 | `weighting.mode` |
|---|---|---|---|---|
| `2F` | `first-board-pullback/composite-factor-2f-amplitude-study` | `maxAmplitude`、`meanAmplitude` | 50% + 50% | `EQUAL` |
| `3F` | `first-board-pullback/composite-factor-3f-amplitude-volume-study` | 上述 + `t1VolumeRatio` | 各 1/3 | `EQUAL` |
| `4F-WEIGHTED` | `first-board-pullback/composite-factor-4f-weighted-study` | 上述 + `limitGap` | 35% + 35% + 15% + 15% | `CUSTOM` |

## 口径（与既有实例逐字一致，**不是**本组新发明的）

```
Universe   = 首板回踩候选池（derive.ts，12 因子完备池；与 12F / Top-N / 单因子共用）
Signal     = T+5 收盘（信息截止）
Entry      = T+6 开盘（canBuyAtOpen === true）
Exit       = T+10 收盘（不可卖则顺延，≤ T+20）
Position   = Equal Weight（组合内部；与成员权重是两件事）
Cost       = 往返 20 bps
Normalize  = BUCKET_POSITIONAL（(idx+0.5)/k，FROZEN-BUCKET-CONTRACT-001 §3.1）
TopN       = 3 / 5 / 10 / 20（静态枚举，**不得跑完再挑**）
DayScopes  = OWN / FIXED
Benchmark  = 当日全部可排名候选等权（= 随机抽 N 的期望）
TimeSlice  = 按年
```

坐标唯一实现在 `shared/singleFactor/coordinate.ts`，模板启动时由
`assertTemplateCoordinate()` 强制核对 ⇒ 与单因子 / 12F / Top-N / 4F 等权基线**逐笔可比**。

## 为什么前两组用 `EQUAL` 而不写成 `CUSTOM {0.5, 0.5}`

「50% + 50%」与「各 1/3」**按构造就是等权**。模板 `EQUAL` 路径走 `(Σ x)/n`
（`scoring.ts` 不变量 4），与四因子等权基线 `RUN-20260925-5B9BD064` 是同一条浮点路径；
换成 `CUSTOM` 会改走 `Σ w·oriented`，可能差 1 ULP，而桶位分让横截面上大量样本**精确同值**
⇒ 1 ULP 就足以改变 `ranker` 的同值 tie-break，改变 TopN 边界上「选中哪几只」。
⇒ 用 `EQUAL` 保证「与基线的差异只能来自成员集合，不可能来自权重代码路径」。
只有第 3 组真正非等权。

## 本组刻意不做

- ❌ 自由 / 连续权重搜索（3 个方案是**事先定好**的，一次跑完、全部输出、**不择优**）；
- ❌ 新增因子、改因子定义 / 桶边界 / 方向（全部经 `shared/compositeFactor/members.ts` 适配器 import，
  `assertMemberDirections()` 结构级强制方向不被重估）；
- ❌ OOS / 新时间窗口（本轮窗口与基线完全相同）；
- ❌ 任何策略结论（整组 `EXPLORATORY`；成员是事后按上一轮已读数据挑的）。

## 已知文案缺陷（本组三个 Run 的信封里都会出现，已在结果报告登记）

`shared/compositeFactor/assemble.ts` 有两处**硬编码 12 因子**的文案：
`customPayload.disclosures` 的「其中 3 个因子的方向属『先验未验证』，合计占 **3/12** 权重」
与 `customPayload.sampleAccounting.notes` 的「**12 因子**完备用例」。

它们对任何非 12 成员实例都不成立。本组三个方案的正确值是：

| 方案 | 先验未验证成员 | 正确占比 |
|---|---|---|
| `2F` | 无（两个成员均 `priorVerified = true`） | 0/2 |
| `3F` | 无 | 0/3 |
| `4F-WEIGHTED` | `limitGap`（`priorVerified = false`） | 15%（1/4 个成员） |

按「只改 `members` / `weighting`」的约束**未修改模板文案**；正确值与缺陷本身都写进结果报告。
