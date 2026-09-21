# EXP-002 · 首板后回踩条件稳定性验证（`first-board-pullback/stability-validation`）

> **一句话**：把 EXP-001 的研究条件铺成三个维度（决策时点 / 未来评价窗口 / 样本条件），
> 对**同一个 Baseline** 逐变体**真重算**，再按**声明容差**判定
> `稳定 / 敏感 / 指标不足 / 执行失败`。
>
> **不产出**：最优条件、参数候选、排序、策略对象。`sensitive` 是**发现**，不是缺陷。

---

## 一、它复用谁（本实验最重要的设计约束）

本实验**不是**第二套 Robustness 引擎，而是**既有 Robustness 核心方法的一次跨阶段消费**：

| 纪律 | 来源 | 本实验怎么用 |
| --- | --- | --- |
| baseline-first（清单索引 0 = 基准、恰一条） | `server/research/robustness/multiDimension.ts` | 直接调 `runMultiDimensionRobustness()` |
| variant 逐条注入式评估（核心零 IO / 零重算） | 同上（`MultiDimensionRobustnessEvaluator`） | 重算在实验侧做完，核心只做比较与聚合 |
| failed 样本结构化（不静默吞） | 同上 | 评估产物非法 ⇒ 该变体 `failed`，错误文案可读 |
| baseline 失败 ⇒ 拒绝产出无锚点结论 | 同上（`RB18X_BASELINE_FAILED`） | 不自行吞掉该错误 |
| 容差判定（**唯一实现**） | `server/research/robustness/comparison.ts#evaluateTolerance` | 只声明 `metric / tolerance / direction` |
| canonical 内容指纹 | `server/research/robustness/serialize.ts` | 运行 id 与记录指纹都由它派生 |
| 样本账守恒（四桶 / 原因合计） | `server/research/robustness/dimension.ts` | 组装期再复核一遍，不平即抛 |

**唯一入口**是 `@experiments/robustnessBridge`（零实现、零状态的 re-export 引桥）。
`page.tsx` **不得**引它，也**不得**引 `server/**` 运行时。

## 二、绝不这样做（规格 §17 的 11 条里与实现相关的部分）

- ❌ 不新建引擎 / 不复制 `ResearchRobustnessEngine` / `ResearchRobustnessEvaluator` / `ResearchRobustnessDrift`；
- ❌ **不新建表、不新增 migration**：Run 元数据走平台既有的 `research_experiment_run`，
  明细走对象存储（`manifest.json` / `result.json` / **5** 个产物文件）；
- ❌ 不读 EXP-001 的 `result.json` 做差、不只改 label；
- ❌ 不把研究指标伪装成交易指标（不往 `totalReturnPct` 里塞研究口径）；
- ❌ 不在 Robustness 核心里写任何首板回踩业务判断（核心不知道 `first-board-pullback` 是什么）；
- ❌ 不做「一个维度一个独立 Run 再人工拼矩阵」（那样每个 Run 各自产生基准，**不可比**）。

## 三、Baseline（显式声明，不隐含）

| 项 | 值 | 依据（EXP-001 实码） |
| --- | --- | --- |
| 决策时点 | T+5 | EXP-001 参数 `maxObservationDay` 的缺省值 `5` |
| 未来评价窗口 | T+10 | EXP-001 缺省视界 `[5,10,20]` 中**严格大于 k 的最小值** |
| 样本条件 | 全部样本 | EXP-001 同时给出 `ALL` 与两个分组 ⇒ 「默认」= 不施加子集条件 |

口径理由随结果一起下发（`customPayload.baselineRationale`），页面与报告都能读到。

## 四、三个维度（§9）

| 维度 id | 取值 | 问题 |
| --- | --- | --- |
| `observationDay` | T+1 … T+5 | 「晚一天 / 早一天做判断」会不会改变结论 |
| `evaluationHorizon` | T+5 / T+10 / T+20 | 「看多远」会不会改变结论 |
| `sampleCondition` | 全部 / 不破开盘价 / 破开盘价 / 回撤 6 桶 | 结论是不是只在一个样本子集里成立 |

矩阵 = 1 个基准 + **16** 个非基准变体（5 + 3 + 8）。
其中 `OBS_DAY_T5` 与 `HORIZON_T10` 与基准**同配置** ⇒ 它们是**自检行**：
逐指标 `delta` 必须**恰为 0**、判定必须 `stable`。一旦重算路径里掺进不该有的状态，这两行会立刻不是 0。

## 五、指标与容差（§10）

| 指标 | 含义 | 比较容差 | 方向 |
| --- | --- | --- | --- |
| `sampleCount` | 候选样本数（分母） | —（只暴露 `sampleSetChanged`） | — |
| `validSampleCount` | 真正参与统计的样本数（分子） | — | — |
| `meanCloseReturn` | 平均收盘收益（锚 = 决策日收盘价） | `0.02` | `both` |
| `medianCloseReturn` | 中位收盘收益 | `0.02` | `both` |
| `breakoutVsCloseRate` | 突破决策日收盘价率 | `0.05` | `both` |

- 容差是**研究口径**（多大幅度算「结论变了」），**不是**统计显著性 —— 本实验不做假设检验、不给 p 值；
- 方向一律双向：换条件后收益**暴涨**同样是「结论不稳」的证据；
- 不适用 ⇒ `null` + 原因（`EMPTY_FUTURE_WINDOW` / `NO_VALID_SAMPLE`），**绝不以 0 冒充**。
  典型例子：`HORIZON_T5`（`h ≤ k`）的窗口按定义为空 ⇒ 三个比例指标全部不可用。

## 六、样本账（§13）

**核心四桶**（可加划分，归入优先级 `missing > invalid > excluded > valid`）：

```text
candidate = valid + excluded + missing + invalid
eligible  = valid + excluded
```

- `missing`：所需数据**整行缺失**（含 `MAX_EVENTS_LIMIT`：被 `maxEvents` 裁掉、从未进入评估）；
- `invalid`：行在、但 OHLC 不自洽；
- `excluded`：数据前提成立，但不满足该变体的样本条件。

**信封两式**（平台守恒式）与上面**不同义**，结果里做了**显式换算**：

```text
信封 eligible := 核心 validCount
信封 excluded := candidate − validCount = 核心 (excluded + missing + invalid)
```

> ⚠️ 把核心 `eligible` 直接当信封 `eligible` ⇒ 平台闸门 `eligible + excluded === candidate` 当场不平。

## 七、产物（全部经 `context.artifact()`，不往 TiDB 塞明细）

| 名字 | 角色 | 内容 |
| --- | --- | --- |
| `stability_matrix.csv` | table | 逐变体判定矩阵（含判定与样本量） |
| `stability_comparison.csv` | table | 逐变体 × 逐指标的比较明细 |
| `sample_accounting.csv` | table | 逐变体样本账（含三张原因明细） |
| `stability_overview.svg` | chart | 「\|Δ\| / 容差」总览（红线 = 1.0） |
| `robustness-run.json` | artifact | **核心记录原样**，可离线复核指纹与守恒式 |

Object Key = `experiments/<group>/<key>/runs/<runId>/<role>/<name>`。
🔴 `name` 必须是**不含角色段的相对名**（写成 `tables/x.csv` 会落成 `tables/tables/x.csv`）。

平台另外写入 `manifest.json` / `result.json` / `logs/run.log`。

## 八、真实证据在哪

- 本实验的单测：`tests/server/researchExperiments/exp002StabilityValidation.test.ts`（11 个面）；
- 泛化层单测：`tests/server/research/robustness/multiDimension.test.ts`（公共机制 **12** 项 —— 规格 §21 要求的 11 项
  ＋ 新增的「核心不含研究侧业务语义」结构级闸门）；
- 真实 Dataset（`first_limit_pullback` / `390002`）的完整 Run 与浏览器验收：见
  `docs/research/EXP-002-REPORT.md`。
