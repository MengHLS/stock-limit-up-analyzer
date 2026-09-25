# 组合因子通用实验模板（COMPOSITE_FACTOR_EXPERIMENT_V1）· 实施报告

> **模板编号**：`COMPOSITE_FACTOR_EXPERIMENT_V1` ｜ **契约**：`CF-V1-001`
> **参照实例**：`first-board-pullback/composite-factor-equal-weight-study`
> **真实 Run**：`RUN-20260925-7837B62B`（`SUCCEEDED` / persisted `True`）
> **Dataset**：`first_limit_pullback` `v5`（id `660001`）
> **计算引擎版本**：`1.0.0` ｜ **表数** 13 ｜ **判定行** 49

---

## 结论前置

1. **模板可用且口径可对拍**：12 因子等权实例的**样本账和参照实验逐项相同**（候选 73003 / 入池 70236 / 剔除 2767，六项剔除原因逐项一致），且 `Top-3 / Top-5 / Top-10`（`OWN` 日集）的**六项点估计与既有 `twelve-factor-topn-ranking-study` 逐位相同**（见 §四，判据 通过）。
2. **合成分本身没有选择力**：`OWN` 日集上 TopN 超额随 N **单调走高**（N3 -0.0428% → N5 0.0173% → N10 0.0361% → N20 0.1007%）；N3 / N5 / N10 的判定全部为 `INCONCLUSIVE`（CI 跨 0）。
3. **唯一 POSITIVE 在最大档**：`N20` 的配对日度超额为 0.1007%，CI95 [0.0040%, 0.2128%] ⇒ `POSITIVE`。⚠️ 本次共 49 个带判定行，α=0.05 下假阳性期望 ≈ 2.5 ⇒ **只能读作探索性**。

---

## 一、实现内容

### 1.1 模板位置与文件地图

| 文件 | 职责 |
|---|---|
| `research-experiments/shared/compositeFactor/types.ts` | 契约常量与类型唯一真源（**零 node 依赖**，页面可安全引用） |
| `.../hash.ts` | `fnv1a32` + **稳定哈希 Bootstrap 种子**（按 `契约\|档位\|日集\|用途` 计算） |
| `.../members.ts` | **成员适配器**：从既有因子目录 + 冻结桶契约适配，`direction` 由 `orientation` 推出 |
| `.../scoring.ts` | 合成内核（纯函数）：方向调整 → 标准化 → 加权 → 合成分 |
| `.../analyse.ts` | 评估层：把合成分当排序键，交给单因子引擎的交易/统计基础能力 |
| `.../assemble.ts` | 结果装配：6 段表 / 统计 / 全量 CSV 产物 / zod 契约 |
| `.../template.ts` | **唯一入口** `defineCompositeFactorExperiment(config)`（装配顺序） |
| `.../README.md` | 与单因子模板的分工、两条硬约束、新增实验两步走 |

### 1.2 五条计算链（与需求逐字对应）

```
Factor Value
  → Direction Adjustment    HIGH 保持 / LOW 取 1 − x（方向来自冻结契约，不在组合里重估）
  → Normalization          BUCKET_POSITIONAL (idx+0.5)/k 或 CROSS_SECTION_PERCENTILE
  → Weight                 EQUAL = 1/n；CUSTOM 已预留（键集合须完全相等 + 有限正数 + 归一化）
  → Composite Score        Σ w·oriented ∈ (0,1)（**不插补**：缺任一成员 ⇒ 整条样本不可评分）
  → Cross-sectional Rank    按决策日（= 首板日 T）分组，同值按 eventId 升序（确定性）
  → TopN                   3 / 5 / 10 / 20（四档静态枚举，全部落进结果）
  → 统一交易引擎            复用 SINGLE_FACTOR_EXPERIMENT_V1（零交易代码重写）
```

### 1.3 冻结坐标（与单因子模板完全一致）

| 项 | 取值 | 本次 Run 实测 |
|---|---|---|
| Universe | 首板回踩候选池（`derive.ts` 唯一实现） | 候选 **73003** / 入池 **70236** |
| 信息截止 | `T+5` 收盘 | 观察窗 `T+1..T+5` |
| 入场 | `T+6` 开盘 | 决策偏移 5 日 |
| 退出 | `T+10` 收盘（不可卖顺延） | — |
| 成本 | 往返 20 bps | 逐笔恒等式 `gross − cost = net` 强制 |
| 仓位 | 等权 | `weightSum = 1` |
| 排名 | 合成分 HIGH（方向已进入成员贡献） | `ranking.key = composite` |
| TopN | 3 / 5 / 10 / 20 | 判定门槛 决策日 ≥ 100 |
| 日集 | `OWN`（≥ 该档 N）/ `FIXED`（≥ 20） | 两者都跑 |
| 基准 | 当日全部候选等权 | 随机 N 的期望恒等于该值 |

### 1.4 两条硬约束（代码强制，不靠注释）

- 🔴 **方向不允许在组合里重估**：`assertMemberDirections()` 要求 `direction` 必须等于由契约 `orientation` 推出的方向，否则抛错。
- 🔴 **不插补**：「缺哪个成员」由**标准化结果**判定，不由原始值判定 —— 这样 `limitGap` 的 `null`（合法 `UNKNOWN` 桶）不会被误判为缺失。

---

## 二、复用能力（**零交易 / 零结果 / 零 PIT 代码重写**）

| 组合模板需要的事 | 复用的既有能力（出处） |
|---|---|
| 按决策日切横截面 + 取前 N | `shared/singleFactor/ranker.ts`（`buildCrossSections` / `selectTopN`） |
| 当日等权组合收益 | `shared/singleFactor/metrics.ts`（`dailyPortfolioReturnsOf`） |
| 当日池等权基准 | `shared/singleFactor/benchmark.ts`（`benchmarkDayNetReturnOf`） |
| 复利净值 / 回撤 / 盈亏比 / 胜率 / 配对超额 | `shared/singleFactor/metrics.ts`（`computeMetrics`） |
| 日期聚类 Moving-Block Bootstrap + 三态判定 | `shared/singleFactor/metrics.ts`（`bootstrapOf` / `verdictOf`） |
| 逐笔成本恒等式 | `shared/singleFactor/positionCost.ts`（`assertTradeCostReconciles`） |
| PIT 交易日 + 统一入场退出 + 逐笔对拍 | `shared/singleFactor/{pitAccess,entryExit}.ts` |
| 样本池 + 12 因子原始值 | `twelve-factor-composite-study/derive.ts`（与 12F / Top-N / 单因子**同一份**） |
| 桶位分 + 方向表 + 因子目录 | `twelve-factor-composite-study/result.ts` + `shared/singleFactor/factorResolver.ts`（适配器，非复制） |
| 公共底座（v5 绑定 / foundation 表 / panel CSV） | `shared/firstBoardPullback/`（由 `manifest.ts` 自动包装） |

**本模板只新增三件事**：① 把「合成分」当排序键交给 `ranker`（无新排序逻辑）；② `OWN` / `FIXED` 两种日集口径 + 4 档 TopN；③ 随机 N 的 Monte-Carlo 分布 + 时间切片。

### 2.1 「复用」的实际落点

```ts
// template.ts：合成分写进单因子样本的 factorValue —— 下游只认这一个排序键
const sample: SingleFactorSample = { …, factorValue: item.compositeScore };
```

⇒ 排序 / 选头 / 交易 / 指标 / 显著性**完全不知道键是合成的**。

### 2.2 「不修改已有 12 因子定义」的兑现方式

`members.ts` 是**适配器**：`label / source / orientation / priorVerified / buckets / valueOf` 全部 import 自既有唯一真源，`bucketScoreOf` 只是对 `bucketPositionalScoreOf(code, value)` 的闭包。**本模板内不存在第二份因子定义**。

### 2.3 一条必要的口径选择（等权的浮点路径）

等权写成 `(Σ x)/n` 而**不是** `Σ (1/n)·x`。两者数学等价，但浮点可差 1 ULP；桶位分只有有限取值 ⇒ 横截面上大量样本**精确同值**，1 ULP 就足以改变同值 `tie-break` 次序，从而改变 TopN 边界上「选中哪几只」。
`twelve-factor-composite-study/compositeScoreOf()` 用的是 `(Σ x)/n`；模板跟它走同一条浮点路径，才使两个实验的点估计**逐位可对拍**（§四 即此判据）。

---

## 三、真实 Run

### 3.1 样本账（守恒校验）

- 候选 **73003** = 入池 **70236** + 剔除 **2767**
- 逐因剔除合计 = 2767（与剔除数相等 ⇒ 守恒）
- 12 因子完备用例 70236；合成分可评估 70236；**不可评估 0**
- 逐成员缺失诊断 `missingByMember` = `{}`

| 剔除原因 | 条数 |
|---|---:|
| `MISSING_PREFIX_PATH` | 1403 |
| `ENTRY_UNFILLABLE` | 726 |
| `MISSING_FACTOR_PATH` | 404 |
| `MISSING_FORWARD_PATH` | 224 |
| `MISSING_FACTOR` | 7 |
| `NO_EXECUTABLE_EXIT` | 3 |

### 3.2 合成分分布（`∈ (0,1)`，加权和）

| count | min | p5 | p50 | p95 | max | mean |
|---:|---:|---:|---:|---:|---:|---:|
| 70236 | 0.117063 | 0.244841 | 0.415873 | 0.562698 | 0.811905 | 0.411455 |

### 3.3 主判据：配对日度超额（`OWN` 日集）

| 档位 | 纳入日数 | 排除日 | 选出笔数 | 组合日均 | 当日池日均 | 超额(日均) | CI95 下 | CI95 上 | 判定 | 日胜率 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| **N3** | 1853 | 0 | 5559 | -0.003942 | -0.003513 | **-0.000428** | -0.002804 | 0.002145 | `INCONCLUSIVE` | 0.467350 |
| **N5** | 1849 | 4 | 9245 | -0.003393 | -0.003566 | **0.000173** | -0.001744 | 0.002080 | `INCONCLUSIVE` | 0.493240 |
| **N10** | 1806 | 47 | 18060 | -0.003338 | -0.003699 | **0.000361** | -0.000938 | 0.001664 | `INCONCLUSIVE` | 0.500000 |
| **N20** | 1511 | 342 | 30220 | -0.002907 | -0.003914 | **0.001007** | 0.000040 | 0.002128 | `POSITIVE` | 0.517538 |

### 3.4 固定日集（跨 N 可比）

| 档位 | 纳入日数 | 排除日 | 选出笔数 | 组合日均 | 超额(日均) | 判定 |
|---|---:|---:|---:|---:|---:|---|
| N3 | 1511 | 342 | 4533 | -0.003853 | 0.000061 | `INCONCLUSIVE` |
| N5 | 1511 | 342 | 7555 | -0.003599 | 0.000315 | `INCONCLUSIVE` |
| N10 | 1511 | 342 | 15110 | -0.003395 | 0.000519 | `INCONCLUSIVE` |
| N20 | 1511 | 342 | 30220 | -0.002907 | 0.001007 | `POSITIVE` |

### 3.5 随机 N 基准（Monte-Carlo，1 000 次）

| 档位 | 日集 | 观测分位 | 随机 P50 | 单侧 p |
|---|---|---:|---:|---:|
| N3 | OWN | 0.3540 | -0.003530 | 0.6460 |
| N3 | FIXED | 0.5150 | -0.003889 | 0.4850 |
| N5 | OWN | 0.5610 | -0.003529 | 0.4390 |
| N5 | FIXED | 0.6240 | -0.003894 | 0.3760 |
| N10 | OWN | 0.7630 | -0.003702 | 0.2370 |
| N10 | FIXED | 0.7910 | -0.003891 | 0.2090 |
| N20 | OWN | 0.9990 | -0.003915 | 0.0010 |
| N20 | FIXED | 1.0000 | -0.003956 | 0.0000 |

> 随机抽 N 只的**期望**恒等于当日池均值 ⇒ 「正超额」= 平均意义上优于随机抽签，**不是**跑赢指数。

### 3.6 时间切片（按年 × 各档，`OWN`）

| 年 | 档位 | 日数 | 组合日均 | 当日池日均 | 超额(日均) | 判定 |
|---|---|---:|---:|---:|---:|---|
| 2019 | N3 | 234 | 0.003577 | 0.000672 | 0.004773 | `INCONCLUSIVE` |
| 2019 | N5 | 232 | 0.002684 | 0.000672 | 0.003768 | `POSITIVE` |
| 2019 | N10 | 210 | -0.000346 | 0.000672 | 0.001245 | `INCONCLUSIVE` |
| 2019 | N20 | 119 | -0.000363 | 0.000672 | -0.000283 | `INCONCLUSIVE` |
| 2020 | N3 | 243 | -0.003791 | -0.003180 | -0.000948 | `INCONCLUSIVE` |
| 2020 | N5 | 241 | -0.003468 | -0.003180 | -0.000139 | `INCONCLUSIVE` |
| 2020 | N10 | 229 | -0.003126 | -0.003180 | 0.001086 | `INCONCLUSIVE` |
| 2020 | N20 | 181 | -0.001613 | -0.003180 | 0.002452 | `INCONCLUSIVE` |
| 2021 | N3 | 243 | 0.000570 | 0.000579 | -0.001439 | `INCONCLUSIVE` |
| 2021 | N5 | 243 | 0.000466 | 0.000579 | -0.001543 | `INCONCLUSIVE` |
| 2021 | N10 | 243 | 0.001529 | 0.000579 | -0.000480 | `INCONCLUSIVE` |
| 2021 | N20 | 238 | 0.000894 | 0.000579 | -0.000343 | `INCONCLUSIVE` |
| 2022 | N3 | 242 | -0.010329 | -0.005890 | -0.003853 | `INCONCLUSIVE` |
| 2022 | N5 | 242 | -0.006910 | -0.005890 | -0.000433 | `INCONCLUSIVE` |
| 2022 | N10 | 241 | -0.006209 | -0.005890 | 0.000310 | `INCONCLUSIVE` |
| 2022 | N20 | 226 | -0.005636 | -0.005890 | 0.002304 | `POSITIVE` |
| 2023 | N3 | 242 | -0.007441 | -0.006320 | -0.001325 | `INCONCLUSIVE` |
| 2023 | N5 | 242 | -0.005675 | -0.006320 | 0.000441 | `INCONCLUSIVE` |
| 2023 | N10 | 238 | -0.005694 | -0.006320 | 0.000249 | `INCONCLUSIVE` |
| 2023 | N20 | 156 | -0.005601 | -0.006320 | 0.001182 | `INCONCLUSIVE` |
| 2024 | N3 | 242 | -0.010559 | -0.002422 | -0.002023 | `INCONCLUSIVE` |
| 2024 | N5 | 242 | -0.008928 | -0.002422 | -0.000392 | `INCONCLUSIVE` |
| 2024 | N10 | 239 | -0.007679 | -0.002422 | 0.000847 | `INCONCLUSIVE` |
| 2024 | N20 | 194 | -0.008371 | -0.002422 | 0.000419 | `INCONCLUSIVE` |
| 2025 | N3 | 243 | -0.001205 | 0.001033 | -0.001534 | `INCONCLUSIVE` |
| 2025 | N5 | 243 | -0.002282 | 0.001033 | -0.002610 | `INCONCLUSIVE` |
| 2025 | N10 | 242 | -0.000196 | 0.001033 | -0.000806 | `INCONCLUSIVE` |
| 2025 | N20 | 237 | 0.000044 | 0.001033 | -0.000037 | `INCONCLUSIVE` |
| 2026 | N3 | 164 | -0.001278 | -0.005954 | 0.004784 | `INCONCLUSIVE` |
| 2026 | N5 | 164 | -0.002516 | -0.005954 | 0.003547 | `INCONCLUSIVE` |
| 2026 | N10 | 164 | -0.005352 | -0.005954 | 0.000711 | `INCONCLUSIVE` |
| 2026 | N20 | 160 | -0.003178 | -0.005954 | 0.002597 | `INCONCLUSIVE` |

### 3.7 Overall（全样本等权，不做任何选择）与决策日诊断

| 项 | 值 |
|---|---:|
| Overall 决策日 | 1853 |
| Overall 样本笔数 | 70236 |
| Overall 逐笔均值 | -0.002564 |
| Overall 胜率 | 0.439048 |
| Overall 累计（复利口径） | -0.999797 |
| Overall 基准累计 | -0.999797 |
| 决策日总数 | 1853 |
| 当日样本 ≥ 3 / 5 / 10 / 20 的日数 | 1853 / 1849 / 1806 / 1511 |
| 当日样本 中位 / 均值 / 最大 | 34.0 / 37.90 / 567 |

### 3.8 结果段与产物

| 表 key | 行数 | 说明 |
|---|---:|---|
| `cf_composition` | 12 | 成员与权重（组合的完整定义） |
| `cf_overall` | 1 | Overall · 全样本等权（不做任何选择） |
| `cf_topn` | 8 | TopN · 各档组合指标（4 档 × 2 日集） |
| `cf_excess` | 8 | Excess · 配对日度超额（主判据） |
| `cf_benchmark` | 8 | Benchmark · 当日池等权 + 随机 N 分布 |
| `cf_time_slice` | 32 | TimeSlice · 按年（OWN 日集） |
| `cf_day_size` | 8 | 决策日样本量诊断 |
| `cf_trades_preview` | 400 | TradeDetails · 逐笔预览（每档前 100 笔，OWN 日集） |
| `foundation_v5_lineage` | 1 | 公共底座坐标 |
| `foundation_sample_accounting` | 7 | 公共底座样本账 |
| `foundation_horizon_sample_accounting` | 124 | 逐持有日样本与右删失 |
| `foundation_entry_aligned_curve` | 248 | 公共逐日净收益曲线 |
| `foundation_anchor_bootstrap` | 86 | 公共底座锚点 Bootstrap |

全量逐笔与日度序列 CSV（gzip，每档 2 个文件，共 8 个）：

- `composite/trades-n3-own.csv.gz`
- `composite/daily-n3-own.csv.gz`
- `composite/trades-n5-own.csv.gz`
- `composite/daily-n5-own.csv.gz`
- `composite/trades-n10-own.csv.gz`
- `composite/daily-n10-own.csv.gz`
- `composite/trades-n20-own.csv.gz`
- `composite/daily-n20-own.csv.gz`

---

## 四、与参照实验的逐位对拍（模板正确性判据）

参照：`first-board-pullback/twelve-factor-topn-ranking-study`（`RUN-20260924-C5D8AC1A`，**独立实现**）。

| 档位 | 字段 | 本模板 | 参照实验 | 逐位相同 |
|---|---|---:|---:|---|
| N3 | 纳入日数 | 1853.0000000000 | 1853.0000000000 | ✅ |
| N3 | 选出笔数 | 5559.0000000000 | 5559.0000000000 | ✅ |
| N3 | 组合日均 | -0.0039416387 | -0.0039416387 | ✅ |
| N3 | 当日池日均 | -0.0035131669 | -0.0035131669 | ✅ |
| N3 | 超额(日均) | -0.0004284717 | -0.0004284717 | ✅ |
| N3 | 日胜率 | 0.4673502428 | 0.4673502428 | ✅ |
| N5 | 纳入日数 | 1849.0000000000 | 1849.0000000000 | ✅ |
| N5 | 选出笔数 | 9245.0000000000 | 9245.0000000000 | ✅ |
| N5 | 组合日均 | -0.0033926512 | -0.0033926512 | ✅ |
| N5 | 当日池日均 | -0.0035658169 | -0.0035658169 | ✅ |
| N5 | 超额(日均) | 0.0001731657 | 0.0001731657 | ✅ |
| N5 | 日胜率 | 0.4932395890 | 0.4932395890 | ✅ |
| N10 | 纳入日数 | 1806.0000000000 | 1806.0000000000 | ✅ |
| N10 | 选出笔数 | 18060.0000000000 | 18060.0000000000 | ✅ |
| N10 | 组合日均 | -0.0033382904 | -0.0033382904 | ✅ |
| N10 | 当日池日均 | -0.0036990403 | -0.0036990403 | ✅ |
| N10 | 超额(日均) | 0.0003607499 | 0.0003607499 | ✅ |
| N10 | 日胜率 | 0.5000000000 | 0.5000000000 | ✅ |

**判据结果：全部逐位相同 ✅**（`N20` 无对应参照档位 —— 参照实验的档位是 `N1/N2/N3/N5/N10/P20`，没有 `N20`）。

⚠️ **CI 端点不要求相同**：本模板用稳定哈希种子，参照实验用游标式种子（`BOOTSTRAP_SEED + 10 × 组合序号`）。点估计与种子无关。

⚠️ **桶词表指纹字面不同但覆盖同一批冻结字段**：本模板 `fnv1a32:f0500413`（按 `code` 排序后规范化，与成员书写顺序无关），参照实验 `fnv1a32:5f1ea76d`（按因子定义顺序）。两者都是 `FROZEN-BUCKET-CONTRACT-001` 的 `code\|orientation\|priorVerified\|buckets` 摘要。

---

## 五、测试结果

| 项 | 结果 |
|---|---|
| `tsc --noEmit --incremental false`（全量 2,506 文件） | **0 错**（基线一致） |
| 新增单测 `tests/server/researchExperiments/compositeFactorEngine.test.ts` | **40 / 40 通过** |
| `manifest.test.ts`（注册清单 / 页面契约） | 9 / 9 通过 |
| 增量测试命中集（`--seed client/src/researchExperiments/pages.ts`） | `compositeFactorEngine` + `manifest` + `exp001FundamentalStudy`(76) + `exp002StabilityValidation`(50) 全绿 |

单测钉住的口径（摘要）：

1. 12 成员方向与契约 `orientation` 一一对应；方向一致性与可用性校验会**响亮失败**；
2. `BUCKET_POSITIONAL` + 12 因子 + 等权 ⇒ 合成分与 12F `compositeScoreOf` **逐位（`toBe`）相等**；
3. 不插补：缺成员 ⇒ 整条不可评分并逐成员登记；`limitGap` 的 `null` 是合法 `UNKNOWN` 桶；
4. 权重：`EQUAL` = 1/n；`CUSTOM` 的四种非法输入全部抛错；
5. 日集 `OWN` / `FIXED` 的账（当日池 < 门槛 ⇒ 整天不纳入且排除原因可见）；
6. 主判据符号 + 日数 < 100 强制 `INSUFFICIENT`；
7. `customPayload` 通过 `compositeFactorSchema`；样本账不守恒抛错、缺成员差额被 `MISSING_COMPOSITE_MEMBER` 补上；
8. 全量 CSV 产物行数与 `tradeCount` 一致；装配确定性（两次 JSON 逐字节相同）。

---

## 六、遗留问题与刻意不做

**刻意不做**：

- ❌ 不做权重优化（`CUSTOM` 接口已预留但本阶段不启用）；
- ❌ 不做归因（合成分是加权和 ⇒ 因子互相掩蔽 / 区间压缩 / 阈值不可归因三条缺陷仍在）；
- ❌ 不做 OOS、不宣称最优、不构成「策略有效」的证据（本 Run 为 `EXPLORATORY`）。

**遗留 / 待裁定**：

1. 🔴 **`FIXED` 日集门槛与参照实验不同**：本模板取「最大档 N」（= 20），参照 Top-N 实验的 `DEEP` 取「≥ 10」。因此跨 N 深度比较的**日集不同**，两边的 `FIXED`/`DEEP` 数值**不可互相引用**。本 Run 未改动这一点（模板口径按需求写成「统一门槛 = 最大档 N」）。
2. ⚠️ **`N20` 没有参照档位**：参照实验档位为 `N1/N2/N3/N5/N10/P20` ⇒ `N20` 的点估计**无法对拍**，只能自证（样本账与日集诊断一致）。
3. ⚠️ **`OWN` 日集下各档日集不同**（N3 1 853 日 / N20 1 511 日）⇒ 直接比较四档均值是拿不同日子比；跨 N 结论必须读 §3.4。
4. ⚠️ **两个模板的 CI 种子机制不同**（稳定哈希 vs 游标式）⇒ CI 端点不可逐位对拍；若后续要统一，须评估「作废已落库 Run 的指纹」的代价。
5. ⚠️ **ROADMAP 编号尚未登记**：本轮零 `ROADMAP.md` 改动。台账下一个可用编号需按「先对远端 + grep 全仓」流程确认后再取（`9cp` 在 2026-09-25 的日志里已被标记为「待用户裁定」）。

---

## 附录 A · 本次 Run 的完整坐标

```json
{
  "runId": "RUN-20260925-7837B62B",
  "experimentId": "first-board-pullback/composite-factor-equal-weight-study",
  "experimentVersion": "1.0.0",
  "experimentCodeDigest": "exp-code-sha256:dddc47efa38f1db23ccc650c925663b943d5659ae213e48cc0de1411562e7a80",
  "status": "COMPLETED",
  "runStatus": "SUCCEEDED",
  "persisted": true,
  "datasetVersionId": 660001,
  "datasetVersionLabel": "v5",
  "startedAt": "2026-09-25T07:10:59.000Z",
  "updatedAt": "2026-09-25T07:21:53.000Z",
  "durationMs": 552468,
  "templateFingerprint": "fnv1a32:c258fe26",
  "bucketFingerprint": "fnv1a32:f0500413",
  "verdictRowCount": 49
}
```

## 附录 B · 复现

```bash
# 静态检查
node node_modules/typescript/bin/tsc --noEmit --incremental false
# 单测
node node_modules/vitest/vitest.mjs run tests/server/researchExperiments/compositeFactorEngine.test.ts
# 运行（页面「独立实验」选 Dataset v5 后点「运行」；或走 tRPC researchExperiments.startRun）
```

---

*本报告的表格数字全部由结果信封机械生成（`gen_cf_report.py` 读 `run_result.json`），未人工转录。*
