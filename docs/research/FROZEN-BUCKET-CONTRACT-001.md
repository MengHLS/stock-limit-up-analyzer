# FROZEN-BUCKET-CONTRACT-001 · 十二因子冻结分桶契约

> **状态 = FROZEN（已冻结）** · 生效日期 **2026-09-25**
> **适用对象**：`first-board-pullback/twelve-factor-composite-study`（十二因子等权综合评分，第一版）
> **契约性质**：本文件是**唯一**的桶边界与评分映射来源。实验代码里的常量必须与本文件逐字一致；不一致以本文件为准。
> **零源码改动**：本文件只定义契约，不改任何实验代码。

---

## 1. 契约条款（用户 2026-09-25 裁定，六条）

| 编号 | 条款 | 落地方式 |
|---|---|---|
| **FBC-1** | 12 组分桶边界是**历史研究冻结资产** | 边界一律取自首板侧既有实验（`docs/research/FIRST-BOARD-PULLBACK-EXPERIMENT-CURATION.md` §5.1），**不新造桶** |
| **FBC-2** | 新实验**不得重新估计**边界 | 禁止在实验内做分位/聚类/最优切点搜索；边界只能是本文件 §2 的硬编码常量 |
| **FBC-3** | **不得根据新实验结果修改**边界 | 本版内任何边界改动**一律禁止**；要改必须新开 `FROZEN-BUCKET-CONTRACT-002` 并显式声明（§5） |
| **FBC-4** | **利用原有的独立实验功能** | 作为 `research-experiments/` 正式实验注册（`manifest.ts` + `pages.ts`），走公共底座 `withFirstBoardPullbackFoundation` 与平台 Run 机制，**不写一次性脚本充当实验** |
| **FBC-5** | 新实验结果**必须与原实验横向比较** | 在同一样本 / 同入场退出 / 同成本 / 同 Bootstrap 参数下重算 12 个单因子分桶，并与综合评分对照（§4） |
| **FBC-6** | 同时**输出结果 md 文档** | 结果落 `docs/research/RESULT-12F-COMPOSITE-001.md` |

> **第一版约束**：**等权，不做权重优化**。权重一律 `1/12`，本版不含任何权重搜索、不含因子筛选、不含方向再估计。

---

## 2. 冻结的 12 组分桶（FBC-1 / FBC-2 / FBC-3）

「升序」= 按分桶变量由小到大排列，桶下标 `idx` 从 **0** 起。

| # | 因子 code | 因子名 | 桶边界（升序） | 桶数 `k` | 原实验来源 |
|---|---|---|---|---|---|
| **F1** | `bodyHeight` | 首板实体高度 | `≤0.1%` / `0.1~2%` / `2~4%` / `4~6%` / `6~8%` / `≥8%` | 6 | `first-board-body-study` |
| **F2** | `turnover` | 首板换手率 | `<1%` / `1~2%` / `2~3%` / `3~5%` / `5~10%` / `≥10%` | 6 | `turnover-study` |
| **F3** | `amountPercentile` | 同日横截面成交额分位 | `0~20` / `20~40` / `40~60` / `60~80` / `80~100` | 5 | `dynamic-state-factor-expansion-study` |
| **F4** | `meanAmplitude` | `T+1..T+5` 平均振幅 | `<2%` / `2~4%` / `4~6%` / `6~8%` / `≥8%` | 5 | `post-event-amplitude-study` |
| **F5** | `maxAmplitude` | `T+1..T+5` 最大振幅 | `<8%` / `≥8%` | 2 | `hold-streak-amplitude-t10-study` |
| **F6** | `holdStreak` | 守涨停价 streak（**收盘口径**） | `0` / `1` / `2` / `3` / `4` / `5` | 6 | `limit-up-price-hold-streak-study` |
| **F7** | `t1VolumeRatio` | `T+1` 成交量 ÷ `T` 日成交量 | `<50%` / `50~80%` / `80~120%` / `120~200%` / `≥200%` | 5 | `volume-relationship-dynamic-entry-study` |
| **F8** | `limitGap` | 前次涨停间隔 | `UNKNOWN` / `1~3` / `4~5` / `6~10` / `11~20` / `>20` 交易日 | 6 | `pre-event-context-study` |
| **F9** | `preReturn10` | 前期涨幅 `close(T-1)/close(T-10)-1` | `<-10%` / `-10~-5%` / `-5~0%` / `0~+5%` / `+5~+10%` / `+10~+20%` / `>+20%` | 7 | `pre-event-context-study` |
| **F10** | `drawdownDepth` | `T+1..T+5` 回撤深度（对首板收盘） | `0~-2%` / `-2~-5%` / `-5~-8%` / `-8~-10%` / `<-10%` | 5 | `fundamental-study` / `decision-forward-study` |
| **F11** | `t1OpenGap` | `T+1` 开盘缺口 | `<-5%` / `-5~0%` / `0~+5%` / `+5~+10%` / `≥+10%` | 5 | `dynamic-state-factor-expansion-study` |
| **F12** | `historyLimitCount` | 历史涨停次数 | `0` / `1` / `2` / `3~5` / `6~10` / `>10` | 6 | `dynamic-state-factor-expansion-study` |

**桶总数 `Σk = 64`。**

### 2.1 三处「取值口径」必须同时冻结（否则同一边界会算出不同桶）

| 因子 | 冻结口径 | 理由 |
|---|---|---|
| **F1** | `(close − open) / previousClose`（分母是**前收盘**，不是当日收盘） | 首板日 `close` 恒等于涨停价，用当日收盘作分母会把「实体高度」压成常数量级；`dataset.ts:251` 的 `bodyHeightPreviousClose` 即此口径 |
| **F3** | 取**同日成交额分位**这一个变量（不取换手率 / 振幅 / 实体分位） | 换手率＝F2、实体＝F1、振幅＝F4/F5 **已各自独立成因子**；再取它们的分位会让同一信息被重复计入，破坏「等权」的语义 |
| **F6** | **收盘口径**（`close ≥ limitUpPrice − ε` 连续天数，自 `T+1` 起、遇不满足即断） | 原实验同时有收盘/盘中两口径；契约只冻结收盘口径一个，盘中口径不在本版范围内 |
| **F9** | 窗口冻结为 **`n = 10`**（`close(T-1)/close(T-10)-1`） | 原实验有 T-5/10/20 三个窗口；只取 10 是为让「前期涨幅」只有一个数、可等权，且与 `oversold-gap-reversal-validation` 的冻结条件一致 |

---

## 3. 冻结的评分映射（本版随契约一并冻结）

### 3.1 桶位分（bucket positional score）

```
FBC-SCORE:  score_f(bucket) = (idx + 0.5) / k_f          // idx = 该桶在升序表中的 0 基下标
```

- 用**桶位中点**而非端点，避免 `k=2` 的因子（F5）在 0/1 两端取到极值；
- 与任何收益数字**无关** —— 不含拟合、不含样本内选择（满足 FBC-2 / FBC-3）。

### 3.2 方向表（orientation，冻结）

```
FBC-ORIENT:  oriented_f = (o_f == +1) ? score_f : 1 − score_f
```

`o_f = +1` ⇒ 桶越大分越高；`o_f = −1` ⇒ 桶越小分越高。

| # | 因子 | `o_f` | 方向含义 | 方向证据 | 置信标记 |
|---|---|---|---|---|---|
| F1 | `bodyHeight` | **−1** | 实体越低越优 | `first-board-body-study`：实体分桶过滤是**风控**而非 alpha；§5.4「高实体高分位表现差」 | 先验·有证据 |
| F2 | `turnover` | **−1** | 换手越低越优 | `turnover-study`；§5.4「高换手高分位表现差」 | 先验·有证据 |
| F3 | `amountPercentile` | **−1** | 同日成交额分位越低越优 | `dynamic-state-factor-expansion-study`；§5.4「高成交额同日高分位表现差」 | 先验·有证据 |
| F4 | `meanAmplitude` | **−1** | 振幅越低越优 | ⭐ §5.4「**高振幅是最明确的风险源**」 | 先验·有证据 |
| F5 | `maxAmplitude` | **−1** | 最大振幅越低越优 | 同 F4 | 先验·有证据 |
| F6 | `holdStreak` | **+1** | 守线越久越强（**假设**） | `limit-up-price-hold-streak-study`：连续守涨停价**无稳定正收益** ⇒ 原始证据未支持任何方向 | ⚠️ **先验未验证** |
| F7 | `t1VolumeRatio` | **+1** | 放量越优 | §5.4「`T+1` 缩量差」 | 先验·有证据 |
| F8 | `limitGap` | **+1** | 间隔越长越优（**超跌反弹假设**） | `pre-event-context-study` 假设方向；`oversold-gap-reversal-validation` 的 Holdout = **FAIL** | ⚠️ **先验未验证** |
| F9 | `preReturn10` | **−1** | 前期跌幅越深越优（**超跌反弹假设**） | 同 F8 | ⚠️ **先验未验证** |
| F10 | `drawdownDepth` | **−1** | 回撤越浅越优 | `decision-forward-study` / `fundamental-study`：深破位＝风险 | 先验·有证据 |
| F11 | `t1OpenGap` | **+1** | 缺口越高越优 | §5.4「深度低开差」 | 先验·有证据 |
| F12 | `historyLimitCount` | **−1** | 历史涨停次数越少越优 | §5.4「历史涨停次数越多越差」 | 先验·有证据 |

> ⚠️ **F6 / F8 / F9 三条是「先验未验证方向」**：原实验对它们的结论是「无效 / 不可采信 / Holdout FAIL」。
> 契约**仍然收录**这三个因子（用户要求 12 个），方向取各自**源实验当初要检验的假设方向**，并在此显式标记。
> ⇒ 报告中必须把这 3 个因子的贡献**单独列出**，不得与「有证据方向」的 9 个因子混同陈述。

### 3.3 综合评分（equal-weight，第一版不做权重优化）

```
FBC-COMPOSITE:  composite = (1 / 12) · Σ_{f=1..12} oriented_f        ∈ (0, 1)
```

- **等权**：每个因子权重恰为 `1/12`，无例外；
- **完备用例**：12 个因子**全部非缺失**才计算 `composite`；缺任意一个 ⇒ 该事件不进综合评分样本（缺失数按因子逐项登记在样本账里，**不填 0、不插补**）；
- `composite` 越大 = 按先验方向「越优」。

### 3.4 综合评分分位桶（用于评估，非因子桶）

- 按 `composite` 在样本内的**秩**等分为 **10 档**：`D1` … `D10`（`D10` = composite 最高档）；
- 同时给出 **5 档**（`Q1`…`Q5`）作为单调性读法的稳健性对照；
- 分档边界**每次 Run 内重算**（因为它是样本内排名，不是 FBC-1 的「冻结桶」）⇒ 报告中必须写明「分位档是样本内排名，非冻结边界」。

---

## 4. 横向比较规则（FBC-5）

| 项 | 规则 |
|---|---|
| 对照物 | 12 个单因子各自的 64 个桶，**在同一份样本、同一入场/退出、同一成本、同一 Bootstrap 参数下重算**（不引用不同窗口的历史数字） |
| 主对照量 | ① 单因子「最优桶均值 − 最差桶均值」(`spread_single`)；② 综合评分「`D10` 均值 − `D1` 均值」(`spread_composite`) |
| 判定 | 两侧都必须给**日期聚类 Moving Block Bootstrap 95% CI**；CI 跨 0 ⇒ 记「不确定」。⚠️ `spread` 是**样本内极值**，天然乐观，**不得**直接当作「有效区间」 |
| 定性印证 | 引用 `FIRST-BOARD-PULLBACK-EXPERIMENT-CURATION.md` §5.4 已冻结的结论（明确负向 / 风险向 / 结构性）做交叉核对 |
| 结论限定 | 所有结论带 **`v5` 窗口限定**；`v2~v5` 全为**已读数据**，**不是 OOS** |

---

## 5. 冻结项 / 可变项 / 变更程序（FBC-3 的落地）

### 5.1 本版**冻结**（改任何一项 = 违约）

桶边界与桶数 · 取值口径（§2.1）· 桶位分公式 · 方向表 · 权重（全等权）· 因子集合（恰好这 12 个）· 事件定义 · 入场/退出口径 · 成本口径 · Bootstrap 参数 · 三态判定阈值。

### 5.2 本版**可变**（改需在本文件登记 + 实验 README 声明）

新增/删除视界（holding day 集合）· 输出表格的排版 · 分位档数（10/5 之外再加）· 描述性切片的维度（年份/月份）。

### 5.3 变更程序

1. 任何对 §2 / §3 的修改 ⇒ **必须**新开 `FROZEN-BUCKET-CONTRACT-002.md`（或更高序号），**不得**在本文件内就地改；
2. 新契约必须在实验 `README.md` 顶部与 `customPayload` 里**绑定契约 id**；
3. 历史 Run 的契约版本必须可由 `experimentCodeDigest` 反查 ⇒ 新旧版本结果**不得混引**。

---

## 6. 已知偏离与诚实边界（不藏）

1. **综合评分是加权和**，三条已知缺陷**在本版依然存在**（详见 `PLAN-COMBO-BT-EXP-001.md §6.1`）：① 因子互相掩蔽（`6板×1题材` 与 `1板×6题材` 可能同分）；② 分数区间被压缩；③ 阈值若卡在综合分上，改动无法归因。
   ⇒ 本版**只做描述性统计与横向对比，不做任何归因**；归因走 `PLAN-FACTOR-EXP-001.md` 的 Phase 3（正交性）→ Phase 4（逐层叠加）。
2. **F6 / F8 / F9 的方向是先验未验证的**（§3.2），三者合计占综合评分 `3/12` 的权重 ⇒ 综合评分的绝对水平受它们拖累，报告必须给出「剔除这三个因子后的 9 因子子评分」作对照。
3. **`T+1..T+5` 类因子（F4/F5/F6/F10）要求决策时点晚于 `T+5`** ⇒ 本版入场固定为 **`T+6` 开盘**；这不是原实验的入场点，**不得**与其他实验的入场点结论直接等号相连。
4. **`combo-v1` 与本契约无关**：本契约的 12 个因子运行在首板侧数据集 `v5` 上；`combo-v1` 的 `preWindowDays = 0` ⇒ F8/F9 在组合侧物理缺列。
5. **契约冻结边界 ≠ 边界是对的**：`v2~v5` 全为已读数据 ⇒ 这些边界本身可能含样本内选择；本契约冻结的是「不再动它」，不是「它一定正确」。

---

## 附：本文件的事实来源

- 12 组桶边界与来源实验：`docs/research/FIRST-BOARD-PULLBACK-EXPERIMENT-CURATION.md` §5.1（2026-09-24 策展，逐条附代码坐标）。
- 方向证据：同上 §5.4「证据资产（已知结论，不要重跑）」。
- F1 口径依据：`research-experiments/shared/firstBoardPullback/dataset.ts:250-251`（`bodyHeightClose` / `bodyHeightPreviousClose`）。
- F3 口径依据：`first-board-pullback/dynamic-state-factor-expansion-study/experiment.ts:313-333`（同日分位计算）、`result.ts:214-222`（分位桶）。
- `FBC-4` 的注册坐标：`research-experiments/manifest.ts:22-84`、`client/src/researchExperiments/pages.ts:54-101`、`research-experiments/shared/firstBoardPullback/wrapExperiment.ts:90-139`。
- **编制日期 2026-09-25；本文件零源码改动。**
