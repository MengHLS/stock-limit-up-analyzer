# EXP-002 — Research Robustness / Stability Validation 完整闭环（最终报告）

> **编号**：`9cl`｜ **任务性质**：Implementation / Independent Experiment + Cross-stage Robustness reuse
> **真实 Run**：`RUN-20260921-46934548`（`COMPLETED` / `SUCCEEDED`，`durationMs = 128475`，探针壁钟 133629 ms）
> **Dataset**：`first_limit_pullback` · `datasetVersionId = 390002` · 标签 `v2` · `READY` · 声明事件总数 **23978**（窗口 `2024-09-01 ~ 2026-09-01`）
> **ExperimentDefinition**：`first-board-pullback/stability-validation` · version **`1.0.0`** · `computationVersion = 1.0.0`
> **跨阶段 Robustness 核心运行 id**：`RBM-64E58D4B7AC2D8AC`（`recordKind = MULTI_DIMENSION_ROBUSTNESS_RUN`，`recordVersion = 1`）
> **产物**：**8 个对象**（`result.json` + `manifest.json` + **3 CSV** + **1 SVG** + `artifacts/robustness-run.json` + `logs/run.log`）
>
> 本报告是 EXP-002 的**唯一**报告，按规格 §23 为**单一文件 / 19 项**（§1–§19）。
> 表中每个数字都能在下列落盘证据里逐项查到 —— 报告不含估算、不含复述：
>
> | 证据 | 覆盖什么 |
> | --- | --- |
> | `docs/evidence/_e2e_9cl_exp002_stability_validation.out.json` | **29 步**真机 E2E（信封 / 矩阵 / 重算 / 样本账 / 产物 / MinIO / 页面读端点 / 自清理） |
> | `docs/evidence/_e2e_9cl_exp002_stability_validation.first.out.json` | 同一条 E2E 的**首跑**结果（22 PASS / 7 FAIL —— 见 §19.1） |
> | `docs/evidence/_probe_9cl_exp002_frontend.out.json` | 无头 Edge + CDP 量 DOM 的前端可达性 **56 判据** |
> | `docs/evidence/_probe_9cl_exp002_frontend.prefix.out.json` | 同探针**修复前**结果（1 FAIL ⇒ 产品缺陷，见 §19.2） |
> | `docs/evidence/_probe_9cl_exp002_frontend.extendonly.out.json` | **错修中间态**（2 FAIL ⇒ 判据与修法都被证伪，见 §19.2） |
> | `docs/evidence/_probe_9cl_exp002_frontend.r4.out.json` | 判据未修正时的中间态（1 FAIL） |
> | `docs/evidence/_ops_cleanup_9cl_superseded_runs.out.json` | 中间态 Run 清理对账（3 行 / 24 对象 / 0 残留） |
> | 测试输出（`_scratch`，非仓内） | `tsc --noEmit` / `test:changed` / 定向 `vitest` / `checkEolDrift` 四件套 |

---

## 1. 任务、口径与结论摘要

**任务**：把 EXP-001 的研究条件铺成**条件矩阵**，用**现有 Robustness 的核心方法**（而不是新写一套）
对**同一个 Baseline** 逐变体**真重算**，按**声明容差**判定 `稳定 / 敏感 / 指标不足 / 执行失败`，
并让整条链——`Independent Experiment → EXP-001 Research → EXP-002 Stability Validation → Baseline/Variants
→ Real Recompute → Metrics → Comparison → Stable/Sensitive/Insufficient/Failed → Result+Artifacts → MinIO → Frontend`——
在一个真实 Dataset 上**闭合**（规格 §26）。

**一句话结论**：

1. **闭环成立**（规格 §26 的靶心）。整条链的每一段都有**真机证据**：真库真 Dataset（`390002`，声明 23978）、
   真重算（17 行矩阵 / 16 个非基准变体，逐变体重跑筛选与聚合）、真产物（MinIO 8 对象，逐个 `exists()` 复核 +
   绕开服务层列前缀复核）、真前端（无头 Edge 走完整用户路径并**真点一次「运行」**，56/56 PASS）。
2. **没有第二套 Robustness**（规格 §1.1 / §1.2）。**零新引擎、零新表、零 migration**；
   `server/research/robustness/**` 的既有三个文件被**改小**（为了泛化）而**不是被复制**，
   `ResearchRobustnessEngine` / `ResearchRobustnessEvaluator` / `ResearchRobustnessDrift` **一个都没有被复制**。
3. **本轮真正的交付物是「泛化层」**（3 个新文件 / **1540 行**）：
   `dimension.ts`（502）不透明维度 + 两态指标 + 样本账；`comparison.ts`（333）声明式比较 + **唯一**容差实现；
   `multiDimension.ts`（705）多维矩阵编排 + 序列化 + 确定性指纹。
4. **稳定性结论（如实、不含择优）**：**16 个非基准变体里，0 个敏感 / 15 个稳定 / 1 个指标不足 / 0 个失败**，
   总体判定 = **`insufficient`**（因为有 1 个变体按定义不可用，不是因为有敏感项）。
   涉及变体 0 个 —— 即：**在本轮的三个维度、五个指标、三个声明容差下，没有发现任何一个条件变化足以让结论翻面**。

> ⚠️ 这句话**不是**「策略稳健」的结论。它只说明：**EXP-001 的这组描述统计在 ±1 天的判定时点 / ±10 天的观察窗口 /
> 七个样本子集这几种扰动下没有出现超容差变化**。没有任何显著性检验、没有 OOS、没有交易成本、没有资金约束。
> 详见 §9.4 与 §17。

**必须同时读到的三条限制**：

1. `stable` 是「**未观察到超容差变化**」，不是「**已证明稳定**」—— 容差 0.02 / 0.02 / 0.05 是**研究口径**，
   不是统计显著性的代理；
2. 容差判定是**唯一实现**（`comparison.ts#evaluateTolerance`），因此**容差本身写错会 100% 静默**——
   本轮的兜底是 §11 的**四条对照反证**（尤其是「自检行 delta 必须恰为 0」）；
3. `HORIZON_T5` 的三个比例指标按定义不可用（`h ≤ k` ⇒ 未来窗口为空），本轮**没有**用 0 去冒充它（§9.3）。

---

## 2. 复用而非重建：现有 Robustness 核心的跨阶段消费（规格 §1.1）

上一轮审计（`9ck` / `ROBUSTNESS-CROSS-STAGE-001`）的结论是 **B —— 核心可复用，需要轻量适配**。
本轮就是那次适配的落地。**复用清单（可逐条 grep 核对）**：

| 纪律 | 复用点（既有实现） | 本实验怎么用 |
| --- | --- | --- |
| baseline-first（清单索引 0 = 基准、**恰一条**） | `server/research/robustness/multiDimension.ts` | 直接调 `runMultiDimensionRobustness()` |
| variant 逐条**注入式**评估（核心零 IO、零重算） | 同上（`MultiDimensionRobustnessEvaluator`） | 重算在实验侧做完，核心只做比较与聚合 |
| failed 样本**结构化**（不静默吞） | 同上 | 评估产物非法 ⇒ 该变体 `failed`，错误文案可读 |
| baseline 失败 ⇒ **拒绝产出无锚点结论** | 同上（`RB18X_BASELINE_FAILED`） | 不自行吞掉该错误 |
| 容差判定（**唯一实现**） | `server/research/robustness/comparison.ts#evaluateTolerance` | 实验侧只声明 `metric / tolerance / direction` |
| canonical 内容指纹 | `server/research/robustness/serialize.ts` | 运行 id 与记录指纹都由它派生 |
| 样本账守恒（四桶 / 原因合计） | `server/research/robustness/dimension.ts` | 组装期再复核一遍，不平即抛 |

**唯一入口**是 `research-experiments/robustnessBridge.ts`（**92 行 / 零实现 / 零状态 / 零 IO** 的 re-export 引桥），
分「纯类型段」与「运行时值段」。`page.tsx` / `result.ts` **只许引类型** —— 这一点由
`tests/server/researchExperiments/manifest.test.ts` 的 **AST 级闸门**钉住（不是注释约定）。

**没有做的事（结构性证据）**：全仓不存在第二份 `ResearchRobustnessEngine` / `ResearchRobustnessEvaluator` /
`ResearchRobustnessDrift`；`server/research/stochasticRobustness/**`（C-18.2）与
`server/research/searchRobustness/**`（ROBUSTNESS-001）**零改动**且**零新增引用**。

### 2.1 为什么**不用** `searchRobustness`（这条最容易搞错）

`9ck` 审计实测：`searchRobustness` 的语义是「**零重跑**的冻结结果邻域分析」，与
「Baseline → 改变条件 → **重新计算** → 比较」**执行语义相反**（其 import 黑名单 `RERUN_MODULES` 由静态测试钉死）。
本轮若把它当重算引擎，会得到一个「看起来有输出、实际上什么都没重算」的假闭环 —— 因此**明确不采用**，
并且**没有删除它**（§17 第 10 条）。

---

## 3. 最小泛化：不透明维度 + 两态指标 + 泛化指标快照（规格 §2 / §3）

### 3.1 维度解耦（`dimension.ts`，502 行）

`Dimension` 从「4 个**策略执行**轴」的封闭枚举，泛化为**不透明泛型表达**，同时**保留四轴兼容**
（既有调用方 `runRobustnessStress` 的入参形状未变 ⇒ 既有单测全绿）。

- **不透明**：核心不再知道维度的业务含义，只做「维度 id + 取值集合 + 维度内变体清单」的形状校验；
- **四轴兼容**：既有四个轴常量与类型仍导出，既有调用方零改动；
- **业务语义留在实验侧**：维度标签（`观察日（决策时点 T+k）` / `未来评价窗口 T+h` / `样本条件`）与
  变体 id（`OBS_DAY_T1…T5` / `HORIZON_T5|T10|T20` / `NON_BREAK_OPEN` / `BREAK_OPEN` / `DD_200BP` …）
  **全部由实验目录提供**，核心只按 id 处理。

🔴 **这一条有结构级闸门钉住**（本轮新增，`公共机制 · 12`）：把三个泛化层文件的**代码**（先剔除注释）
逐 token 扫描，禁出现任何研究侧标识符（`first-board` / `nonBreakOpen` / `breakOpen` / `observationDay` /
`evaluationHorizon` / `sampleCondition` / `medianCloseReturn` / `breakoutVsCloseRate` / `limitUpPrice` /
`previousClose` / `BASELINE_T5_H10_ALL` / `OBS_DAY_` / `HORIZON_T` / `DD_200BP` 等 16 项）。
闸门**自身可证伪**：往 `multiDimension.ts` 注入 `'nonBreakOpen'` 立即变红并点名（§19.3 实测）。

### 3.2 指标泛化（规格 §3）

从「**恰 3 个交易标量**」改为 `Record<string, number>`：

- **词表由调用方声明**（本轮 5 个：`sampleCount` / `validSampleCount` / `meanCloseReturn` /
  `medianCloseReturn` / `breakoutVsCloseRate`），核心**不做任何指标名白名单**；
- 指标名有闭集校验（`RB18X_METRIC_NAME_INVALID` / `_DUPLICATE` / `_UNSTABLE`），词表为空即抛
  （`RB18X_METRIC_VOCABULARY_EMPTY`）；
- 声明了却没给值 ⇒ `RB18X_METRIC_MISSING`；给了非有限数 ⇒ `RB18X_METRIC_NON_FINITE`。

### 3.3 「不可用」是**独立一等状态**（本轮最容易做错的一处）

`RobustnessMetricSnapshot = { metrics: Record<string, number>; unavailable: Record<string, string> }`。

🔴 **两边必须恰好覆盖声明词表**（既不能漏、也不能重复），两侧同时出现 ⇒ `RB18X_METRIC_STATE_AMBIGUOUS`；
`unavailable` 有 key 但没有原因 ⇒ `RB18X_METRIC_UNAVAILABLE_REASON_MISSING`。
**这样设计的直接目的**：把「这个指标是 0」与「这个指标不适用」在**类型层**分开 ⇒
**「不得伪造 0」不再是一条纪律，而是一个不可能违反的结构**。

---

## 4. 声明式比较与唯一容差实现（规格 §4）

`comparison.ts`（333 行）提供：

| 导出 | 作用 |
| --- | --- |
| `evaluateTolerance(...)` | **唯一**容差判定实现（`stable` / `sensitive` / `insufficient` / `failed`） |
| `summarizeUnitVerdict(...)` | 把多条指标比较汇总成一个变体判定（**优先级：sensitive > insufficient > stable**） |
| `resolveComparisonSpecs(...)` | 把声明（`metric` / `tolerance` / `direction`）解析成可执行的比较规格 |
| `COMPARISON_DIRECTIONS` | 方向闭集（本轮一律 `both`） |

**比较声明是纯数据**（本轮 3 条：`meanCloseReturn@0.02` / `medianCloseReturn@0.02` /
`breakoutVsCloseRate@0.05`，方向均 `both`），每条比较输出六件套：
`metric` / `baseline` / `variant` / `delta` / `absoluteDelta` / `tolerance` / `verdict`。

🔴 **核心代码里没有任何 `if (metric === "...")` 形式的分支** —— 这一条和第 3 节的结构级闸门是同一个闸门在把关
（研究侧指标名属于禁 token）。想加一个新指标 = 加一行声明 + 在实验侧算出来，**不需要动核心一行代码**。

⚠️ **方向一律双向（`both`）是刻意的**：换条件后收益**暴涨**同样是「结论不稳」的证据，
不能只盯「变差」。这一条写在 `COMPARISON_DIRECTIONS` 的类型注释里，并由单测钉住。

---

## 5. 研究对象身份泛化（规格 §5）

`RobustnessSubject`：`subjectKind`（`"strategy" | "experiment"`）/ `subjectId` / `subjectVersion` /
`subjectRunId: string | null`。

- **向后兼容**：唯一映射点是两个适配器 `subjectFromStrategy(...)` 与 `subjectFromExperiment(...)`
  ⇒ **旧的策略侧结构零改动**（既有单测全绿可证）；
- **本轮实测值**（E2E 步骤 12b）：
  `{"subjectKind":"experiment","subjectId":"first-board-pullback/stability-validation","subjectVersion":"1.0.0","subjectRunId":null}`；
- ⚠️ `subjectRunId = null` 是**刻意的**：平台 Run id 在 `run()` 执行期**尚未生成**，
  如实传 `null` 而不是编一个 id 出来（编一个会让「这份稳定性记录锚在哪次 Run 上」变成假事实）。

> 🔴 **本轮记账**：这条 E2E 判据**第一版是恒假 FAIL** —— 我按 `kind` / `id` / `version` 去读，
> 而真实字段名是 `subjectKind` / `subjectId` / `subjectVersion` / `subjectRunId`。属**判据自身写错**，已修正并登记（§19.1）。

---

## 6. 多维条件矩阵：一个 Run、一个基准（规格 §6）

规格 §6 明确**禁止**「一个维度 = 一个独立 Run 再人工拼接」。原因不是麻烦，而是**统计口径**：
每个 Run 会各自产生一个基准 ⇒ **N 个 Run 的 N 个基准互不可比**，拼出来的矩阵没有统一锚点。

本轮的实现：**一个 Run 内** Baseline（1 行）+ 每个维度含多个 Variant（共 16 行）。

| 维度 | id | 变体数 | 变体 id |
| --- | --- | --- | --- |
| 观察日（决策时点 T+k） | `observationDay` | 5 | `OBS_DAY_T1` … `OBS_DAY_T5` |
| 未来评价窗口 T+h | `evaluationHorizon` | 3 | `HORIZON_T5` / `HORIZON_T10` / `HORIZON_T20` |
| 样本条件 | `sampleCondition` | 8 | `NON_BREAK_OPEN` / `BREAK_OPEN` / `NO_PULLBACK` / `DD_200BP` / `DD_500BP` / `DD_800BP` / `DD_1000BP` / `DD_BELOW_1000BP` |

矩阵总行数 **17 = 1 基准 + 16 非基准变体**（E2E 步骤 5 实测）。

**样本量变化必须被记**：每行的 `sampleSetChanged` 显式标出「该变体与基准的有效样本数是否不同」——
**不同则比较的是不同样本总体，必须显式看见**。逐变体样本账见 `sample_accounting.csv`（§12）。

**自检行（本轮最重要的一个设计）**：`OBS_DAY_T5` 与 `HORIZON_T10` 的配置与基准**完全相同**
（基准 = T+5 决策 · T+10 视界 · 全部样本）⇒ 它们是**自检行**：逐指标 `delta` 必须**恰为 0**、判定必须 `stable`。
一旦重算路径里掺进不该有的状态（缓存串味、上游复用、并发污染），这两行会**立刻不是 0**。
E2E 步骤 7c 实测：`OBS_DAY_T5` 与 `HORIZON_T10` 的三个指标 `delta` 全部 `0`、判定全部 `stable`。

---

## 7. 首个真实实验与研究对象（规格 §7 / §8）

| 项 | 值 |
| --- | --- |
| 实验 id | `first-board-pullback/stability-validation` |
| 版本 | `1.0.0` |
| 页 | `/research-experiments/first-board-pullback/stability-validation` |
| 研究对象 | `first_limit_pullback`（EXP-001 同一研究对象） |
| Dataset | `datasetVersionId = 390002` · `v2` · `READY` · 声明事件 **23978** |
| 数据集窗口 | `2024-09-01 ~ 2026-09-01` |
| 前视数据 | **有意声明** `usesForwardData = true`（稳定性验证必须看决策日之后） |

🔴 **禁止直读数据库裸行情表绕过 Dataset**（规格 §8）：本实验的全部行情访问都经
`ExperimentDatasetAccess`（列投影 = **骨架列 ∪ 声明列** + 相对日白名单），
E2E 步骤 6 实测平台 `datasetFacts` 给出的 `eventScanPolicy = FULL_DATASET`、
`eventScanLimit = 400000`、`maxPostRelativeDayRead = 20`、`barQueryCount = 252`。

⚠️ **两个「分页数」不同口径，不得混用**（这是 §12 之外第二个易错点）：

| 口径 | 值 | 出处 |
| --- | --- | --- |
| **实验自己数的**这一轮扫描分页数 | **12** | `customPayload.candidates.eventPageCount` |
| **平台累计**（含 `loadBars` / `feature(0)` / `observation(n)` 各走一次 `access.events()`） | **24** | `datasetFacts.eventPageCount` |

两者是 `12 × 2` 的关系，**不是矛盾**，是「同一件事被数了两次」—— 与 EXP-001 报告里同名的两个字段同源。

---

## 8. 维度定义（规格 §9）

| 维度 | 取值 | 它要回答的问题 |
| --- | --- | --- |
| **A. 观察日（决策时点）** | T+1 … T+5 | 「早一天 / 晚一天做判断」会不会改变结论 |
| **B. 未来评价窗口** | T+5 / T+10 / T+20 | 「看多远」会不会改变结论 |
| **C. 样本条件** | 全部 / 不破开盘价 / 破开盘价 / 回撤 6 桶 | 结论是不是**只在一个样本子集里成立** |

维度 C 的样本条件与 EXP-001 的判定口径**同源**：

- `NON_BREAK_OPEN` = 截至决策时点**始终未跌破**首板日开盘价；
- `BREAK_OPEN` = 曾跌破（与上者**互补**，二者之和必须 = 基准有效样本）；
- 回撤 6 桶 = `DRAWDOWN_BUCKET_EDGES_BPS = [0, -200, -500, -800, -1000]` 切出的
  `NO_PULLBACK` / `DD_200BP` / `DD_500BP` / `DD_800BP` / `DD_1000BP` / `DD_BELOW_1000BP`
  （**全划分**，六桶之和必须 = 基准有效样本）。

🔴 这两个恒等式是本轮「真重算」的第一条证据（§11 证据一）。

---

## 9. 指标定义与不可用语义（规格 §10）

### 9.1 指标词表（5 个，全部为研究口径）

| 指标 | 含义 | 是否参与容差比较 |
| --- | --- | --- |
| `sampleCount` | 候选样本数（分母） | ❌（只暴露 `sampleSetChanged`） |
| `validSampleCount` | 真正参与统计的样本数（分子） | ❌ |
| `meanCloseReturn` | 平均收盘收益（锚 = 决策日收盘价） | ✅ 容差 `0.02` / `both` |
| `medianCloseReturn` | 中位收盘收益 | ✅ 容差 `0.02` / `both` |
| `breakoutVsCloseRate` | 突破决策日收盘价率 | ✅ 容差 `0.05` / `both` |

规格 §10 的 ≥5 个指标要求（`sampleCount` / `validSampleCount` / `meanCloseReturn` /
`medianCloseReturn` / `breakoutVsCloseRate`）**全部落地**。

### 9.2 容差是研究口径，不是统计显著性

容差 = 「多大幅度算**结论变了**」，**不是**假设检验的临界值。本实验**不做**显著性检验、**不给** p 值。
这条口径**写进了页面**（前端探针 E1 判据：显式写明「容差是研究口径、不是统计显著性」）。

### 9.3 不适用 ⇒ `null` + 原因，**绝不以 0 冒充**（实测）

`HORIZON_T5` 的窗口按定义为空（`h ≤ k`，即「看多远」小于等于「什么时候看」）⇒ 三个比例指标全部不可用。
E2E 步骤 8 实测：

| 项 | 实测 |
| --- | --- |
| `metrics` | `{"sampleCount": 23978, "validSampleCount": 23712}`（**只有**两个计数指标） |
| `unavailable` | 三个比例指标全部命中，原因标签 = **「该变体的未来评价窗口为空（h ≤ k），按定义不存在后续表现」** |
| 比较行判定 | 三个指标全部 `null` / `insufficient` / 原因 = 变体侧不可用 |

⚠️ **下发到前端的是「原因标签」而不是错误码**（`unavailableReasonLabels.EMPTY_FUTURE_WINDOW`）——
错误码是给机器与证据用的，页面给人看的是中文句子。这个区分在 E2E 步骤 8 里显式断言，
因为**第一版判据把「码」当「标签」找，是恒假 FAIL**（§19.1）。

### 9.4 `stable`/`sensitive` 四态计数（实测，§1 结论 4 的原始数据）

| 状态 | 计数 | 含义 |
| --- | --- | --- |
| `stable` | **15** | 该变体所有可比较指标都在容差内 |
| `sensitive` | **0** | 至少一个指标超容差 |
| `insufficient` | **1** | 该变体所有指标都不可用 ⇒ 无从判定 |
| `failed` | **0** | 评估产物非法或被拒 |
| **合计** | **16** | = 非基准变体总数（`16 / 16` 完备） |
| **总体判定** | **`insufficient`** | ⚠️ 因为存在 1 个不可用变体，**不是**因为存在敏感项 |

逐维度：`observationDay` 5/5 stable；`evaluationHorizon` 2 stable + 1 insufficient；
`sampleCondition` 8/8 stable。

---

## 10. Baseline 口径与依据（规格 §11）

**Baseline 必须显式写入 ExperimentDefinition**（不是隐含在代码里），并且**值必须依据 EXP-001 实码确认、不得猜测**。

| 项 | 值 | 依据（EXP-001 实码） |
| --- | --- | --- |
| 决策时点 | **T+5** | EXP-001 参数 `maxObservationDay` 的**缺省值** `5` |
| 未来评价窗口 | **T+10** | EXP-001 缺省视界 `[5, 10, 20]` 中**严格大于 k 的最小值** |
| 样本条件 | **全部样本** | EXP-001 同时给出 `ALL` 与两个分组 ⇒ 「默认」= 不施加子集条件 |
| 变体 id | `BASELINE_T5_H10_ALL` | 命名即口径，可读 |

**口径理由随结果一起下发**（`customPayload.baselineRationale`）⇒ 页面与报告都能读到，
前端探针 **E3 判据**实测「基准口径依据可见（k=5 取自 EXP-001 缺省、h=10 取严格大于 k 的最小声明视界）」= PASS。

🔴 这里有一个**沉默失败模式**：如果 baseline 只是代码里的常量、不写进定义，
那么「基准是谁」在落盘证据里**无从核实**，而所有 delta 都以它为锚 ⇒ 基准错则**全表皆错且无人能知**。

---

## 11. 真重算证据链（规格 §12）

规格 §12 的要求是：**必须真重算**（读 Dataset → 应用 Variant 条件 → 重新筛选 / 聚合 → 重算 metrics → 与 Baseline 比较），
**禁止**读 EXP-001 的 `result.json` 改 label 做差。

「真重算」不能靠代码声称，只能靠**可观测的恒等式与单调性**证明。本轮用**四条**证据：

### 证据一 · 条件划分恒等式（E2E 步骤 7）

```
不破位 15306 + 破位 8114 = 23420  = 基准 ALL 的有效样本数
6 桶 3278 + 2277 + 5319 + 4669 + 2302 + 5575 = 23420  = 基准 ALL 的有效样本数
```

- 破位 / 不破位是**互补二分子集** ⇒ 两者之和**必须**等于基样本数；
- 回撤 6 桶是**全划分** ⇒ 六桶之和**必须**等于基样本数。

⚠️ **这两条恒等式无法通过「复制 EXP-001 结果 + 改 label」满足**：它们要求逐事件重新分组与重新计数，
而 EXP-001 的 `result.json` 里**根本没有**这套分组下的逐变体计数。

### 证据二 · 窗口上界单调性（E2E 步骤 7b）

```
HORIZON_T5 valid = 23712  ≥  基准 valid = 23420  ≥  HORIZON_T20 valid = 22777
```

**方向可推导**：T+5 视界只需要 `rd ≤ 5` 的数据 ⇒ 有效样本**最多**；T+20 需要 `rd ≤ 20` ⇒ **最少**。
如果实现里「复制了旧结果」，这三个数会是**同一个数**；如果实现里窗口上界没生效，这三者也不会呈现单调。
实测严格满足 `23712 ≥ 23420 ≥ 22777`。

### 证据三 · 自检行 delta 恰为 0（E2E 步骤 7c）

`OBS_DAY_T5` 与 `HORIZON_T10` 与基准**同配置** ⇒ 逐指标 `delta` **必须恰为 0**、判定必须 `stable`。实测全部为 `0` / `stable`。

### 证据四 · 对照反证（E2E 步骤 7d）——「比较机制是活的」

只证明「该是 0 的地方是 0」还不够（全 0 也能过）。必须同时证明**该动的地方真的动了**：

| 项 | 实测 | 作用 |
| --- | --- | --- |
| 非 0 变化量行数 | **39 / 48** | 机制真的在做差（不是全 0 空转） |
| 全部比较行数 | **48** | 16 变体 × 3 指标 |
| 超容差行（独立重算） | **0** | 与下方 `verdict = sensitive` 行数**双向一致** |
| `verdict = sensitive` 行数 | **0** | 两个独立口径得到同一答案 |
| 涉及变体 | **0** 个 | — |
| 最大 `|Δ| / 容差` | **0.7489687839548904** | 严格 > 1 才算敏感 ⇒ 距阈值还有余量 |
| 四态计数完备 | `敏感0 / 稳定15 / 不足1 / 失败0 = 16 / 16` | 无遗漏、无重复 |

🔴 **最后一行是本轮的「负向结论也需要证据」的体现**：`sensitive = 0` 有两种可能 ——
「真的都不敏感」或「比较机制根本没跑」。**必须用非 0 的 39 行 delta 把第二种可能性排除掉**。

---

## 12. 样本账：四桶 + 信封两式（规格 §13）

### 12.1 核心四桶（可加划分，本泛化层强制）

```text
candidate = valid + excluded + missing + invalid
eligible  = valid + excluded
归入优先级：missing > invalid > excluded > valid
```

| 桶 | 含义 |
| --- | --- |
| `missing` | 所需数据**整行缺失**（含 `MAX_EVENTS_LIMIT`：被 `maxEvents` 裁掉、从未进入评估） |
| `invalid` | 行在、但 OHLC 不自洽 |
| `excluded` | 数据前提成立，但**不满足该变体的样本条件** |
| `valid` | 真正参与统计 |

**实测（基准变体，E2E 步骤 5b / 5c）**：`candidate = 23978`、`valid = 23420`、`excluded = 0`、
`missing = 356`（`MISSING_WINDOW_BAR`）、`invalid = 202`（`INVALID_WINDOW_OHLC`）。
**17 个变体逐个复核四桶，不平项 = 0**。

### 12.2 信封两式（平台守恒式）与上面的换算是**显式**的

```text
信封 eligible := 核心 validCount              = 23420
信封 excluded := candidate − validCount
              = 核心 (excluded + missing + invalid) = 0 + 356 + 202 = 558
```

**实测（E2E 步骤 5b / 5c）**：`candidate = 23978` / `eligible = 23420` / `excluded = 558` /
`Σ原因 = 558`（`MISSING_WINDOW_BAR = 356` + `INVALID_WINDOW_OHLC = 202`），
且 `信封 eligible == 基准 validCount`、`信封 excluded == candidate − validCount` **两边同时成立**。

🔴 **这是第三个口径陷阱**：把**核心** `eligible` 直接当**信封** `eligible` ⇒
平台闸门 `eligible + excluded === candidate` **当场不平**。两套守恒式**不同义**，换算必须显式做，
并且换算结果要作为**观测事实**落在证据里（而不是「代码里写了所以算过了」）。

### 12.3 样本账在页面与 CSV 里都可见

`sample_accounting.csv`（17 行 + 表头）逐变体给出四桶与三张原因明细；页面有专门的「逐变体样本账」卡片
（前端探针 D8 判据：双口径都在）。

---

## 13. Result Envelope（规格 §14）

**继续使用 Independent Experiment 的动态信封**，**不**新建全局固定 schema。
E2E 步骤 4 实测：信封通过平台校验并落库 ⇒ `tables = stability_matrix | stability_comparison | sample_accounting`，
`charts = delta-by-variant`，`statistics = 14`。

也就是说：**平台侧对本实验一无所知**，它只是在校验「声明了 3 张表、就有 3 张表的列与行」。
新增一个实验仍然只需**复制模板 + 两处各 +1 行**（§17 第 1 条的对照面）。

---

## 14. Artifact 与对象 Key（规格 §15）

### 14.1 声明面（5 个，`customPayload.artifacts`）

| 名字 | 角色 | 内容 | 大小（实测） |
| --- | --- | --- | --- |
| `stability_matrix.csv` | `table` | 逐变体 × 逐指标（含判定与样本量） | 10166 B |
| `stability_comparison.csv` | `table` | 逐变体判定汇总 | 2426 B |
| `sample_accounting.csv` | `table` | 逐变体样本账（含三张原因明细） | 2814 B |
| `stability_overview.svg` | `chart` | 「`\|Δ\| / 容差`」总览（红线 = 1.0） | 14430 B |
| `robustness-run.json` | `artifact` | **核心记录原样**，可离线复核指纹与守恒式 | 54679 B |

平台另外写入 `manifest.json` / `result.json`（129592 B）/ `logs/run.log`（3510 B）。

### 14.2 Object Key 结构

```
experiments/<group>/<key>/runs/<runId>/<role>/<name>
role ∈ tables | charts | logs | artifacts | 根（manifest.json / result.json）
```

E2E 步骤 10b / 10c 实测：

- 7 个产物 Key **逐个 `exists()` 实测存在**（判断依据不是「照抄 Manifest」）；
- **角色段不重复**：`tables/tables/…` 形式的 Key = **0 个**（这是 `9ci` / `9cj` 的真实事故，§19.4）；
- Manifest 索引齐全：`result = 1` / `tables = 3` / `charts = 1` / `artifacts = 2`（其中 `robustness-run.json = 1`）/ `logs = 1`；
  🔴 `tables` 段**不得**含 `.json` 文档 —— 这是 `9cl` 本轮修掉的**平台真缺陷**（§19.2）。

### 14.3 绕开服务层的独立复核

E2E 步骤 10e **绕开服务层**直接列举 MinIO 前缀，实测 **8 个对象真的在桶里**：
`artifacts/robustness-run.json` / `charts/stability_overview.svg` / `logs/run.log` / `manifest.json` /
`result.json` / `tables/sample_accounting.csv` / `tables/stability_comparison.csv` / `tables/stability_matrix.csv`。

### 14.4 读回一致性（E2E 步骤 11 / 11b / 11c）

| 项 | 实测 |
| --- | --- |
| `computationVersion` / `experimentCode` | `1.0.0` / `first-board-pullback/stability-validation`（与声明一致） |
| 三张 CSV 数据行数 | matrix **48** / comparison **17** / accounting **17**（与声明结构一致） |
| SVG | 14430 B，**标签可闭合** |
| `robustness-run.json` | 54679 B，`fingerprint = ddd458d62578b483…`，核心变体数 16 —— **与结果信封一致** |

---

## 15. 前端可达性（规格 §16）

> 项目硬禁令：**「接线完成」≠「用户够得到」** ⇒ 交付前必须按**正常导航**量 DOM。
> 本机 `agent-browser` 不可用 ⇒ 用**无头 Edge + Node `WebSocket` 直连 CDP 量 DOM**（零依赖）。

**探针**：`docs/evidence/_probe_9cl_exp002_frontend.mjs`（918 行），
**完整真实用户路径**：列表页 → 点「打开」→ 实验详情页 → **真点一次「运行」** → 自定义结果页（10 张卡片）
→ 点「打开这一条 Run」→ RunDetail。

**结果：`PASS 56 / FAIL 0 / TOTAL 56 ⇒ ALL PASS`**（新 Run `RUN-20260921-C95B1D47`，`PROBE_EXIT=0`）。

| 组 | 判据 | 关键实测 |
| --- | --- | --- |
| A | 列表页可达非白屏 / 本实验行 / 侧栏「独立实验」可见且**高亮** | 行数 3、`data-active=true`、共 24 个导航项 |
| B | 详情页可达 / 运行按钮可用 / 参数表单 / Dataset 需求声明 | `selectText = v2 · id=390002 · READY · 2024-09-01~2026-09-01`；event 列 + post 相对日白名单可见 |
| C | pending **换文案** / 已持久化 / 无伪成功 / 新 Run id / `manifestKey` 形状 / 自定义页被挂载 | 文案 = 「正在运行实验…（读真实 Dataset、做全量计算、并写入对象存储；可能需要数十秒到数分钟…）」；正文 23996 字符 |
| D | 10 张卡片可见 + 口径与真机一致 | 矩阵 17 行 / 非基准变体 16 / 四态 `稳定15 敏感0 指标不足1 执行失败0` / 总体判定「指标不足」/ 基准行 `BASELINE_T5_H10_ALL` + 有效样本 23420 / 比较声明 3 条（0.02·0.02·0.05·both） |
| D9 | 🔴 **账目缺口双侧互补** | 缺口 0 ⇒「（无缺口）」**可见**且**不得**出现「存在缺口」告警（两侧同时断言） |
| D11 | 数据质量如实登记 | 坏 OHLC bar 1651 根 / 涉及事件 334 个 / 缺窗口行情行 7744 对 |
| D12 | 观察类别 ⊆ 真机支持集合 | 描述性事实 + 局限必须有；无敏感变体时**不得**出现「维度比较 / 值得注意」 |
| D13/D14 | 产物 5 个名字 + 核心运行 id `RBM-64E58D4B7AC2D8AC` 进 DOM | — |
| E | 容差是研究口径 / 不产出最优条件与策略对象 / 基准口径依据可见 | 三条全 PASS |
| F | 点「打开这一条 Run」→ RunDetail / Status·Dataset·Parameters·Result / 产物清单 | `data-experiment-run-detail = RUN-20260921-C95B1D47`；14 个产物操作入口 |
| F5 | 🔴 **Manifest 索引卡三组齐备，JSON 文档不落在 tables 组** | 平台缺陷的回归闸（§19.2） |
| G | 越界措辞**句子级**扫描（结果页 552 句 / RunDetail 4162 句） | offenders = **0 / 0** |
| H | 无 `No procedure found on path` / 无未捕获异常与控制台 error | hits = 0、errors = 0 |

⚠️ **前端探针必须真点一次「运行」**：实验详情页的结果区条件是 `outcome !== null`，
而 `outcome` **只来自本次会话的 `runMutation`** ⇒ 历史 Run **不会**自动渲染自定义结果页
（历史 Run 走 `/…/runs/:runId`，RunDetail **刻意不重建 execution**）。这是 `9ci` 用 15 条假 FAIL 换来的教训，
本轮直接沿用了正确写法。

---

## 16. 禁止实现方式对照（规格 §17 + §1.2 / §1.3 / §8 / §10 / §12）

下表把规格的**禁止性要求**逐条落到**可检查的证据**上（而不是「我们没做」的口头声明）。
§17 的实现相关条目 11 条，加上 §1.2 / §1.3 / §8 / §10 / §12 的禁止性条款，合并去重后共 **13 项**：

| # | 禁止项 | 本轮状态 | 可检查的证据 |
| --- | --- | --- | --- |
| 1 | 新建独立引擎 / 复制 `ResearchRobustnessEngine` / `…Evaluator` / `…Drift` | ✅ 未做 | 全仓无同名第二份实现；`robustness/**` 被**改**而非被复制；`git status` 中无新 engine 文件 |
| 2 | 新建 `robustness_run` / `research_robustness_run` 表 | ✅ 未做 | `git status --porcelain -- drizzle/` 为空；全库仍只有 3 张 `search_robustness_*`（`9ck` 实测） |
| 3 | 新增 migration | ✅ 未做 | `drizzle/**` 零改动；migration 已用至 `0047`，**未增** `0048` |
| 4 | 把研究指标映射成交易指标（如塞进 `totalReturnPct`） | ✅ 未做 | 5 个指标名全部为研究口径；核心词表无白名单、无映射层 |
| 5 | 复制 EXP-001 的 `result.json` 当 Variant | ✅ 未做 | §11 证据一 / 证据二 —— 这两条恒等式 EXP-001 的结果里**不存在** |
| 6 | 只改 label 不重算 | ✅ 未做 | §11 证据三（自检行 delta 恰 0）+ 证据四（39 行非 0 delta、`T5 23712 ≥ 23420 ≥ T20 22777`） |
| 7 | 多 Run 人工拼矩阵 | ✅ 未做 | 一个 Run 内 17 行 / 3 维度 / 共享**同一基准**（E2E 步骤 5）；Run 数 = 1 |
| 8 | 在 Robustness 核心里写首板回踩业务判断 | ✅ 未做 | **结构级闸门**（`公共机制 · 12`，注释剔除后逐 token 扫描，可证伪，见 §19.3） |
| 9 | 删 C-18.1 / C-18.2 | ✅ 未删 | `server/research/robustness/**` 与 `stochasticRobustness/**` 文件均在；既有单测全绿 |
| 10 | 删 `searchRobustness` | ✅ 未删 | `server/research/searchRobustness/**` 零改动；其 `RERUN_MODULES` 黑名单测试仍绿 |
| 11 | 把 `searchRobustness` 当重算引擎 | ✅ 未做 | 它**零新增引用**（§2.1：语义相反：零重跑 vs 必须重跑） |
| 12 | 改 Dataset / Strategy / Parameter Search / Backtest / OOS / WFA 业务语义（§1.3） | ✅ 未做 | 这些域的改动为 0；`shared/researchExperimentsContracts.ts` 只做**向后兼容的加法** |
| 13 | 直读数据库裸行情表绕过 Dataset（§8） | ✅ 未做 | 全部行情访问经 `ExperimentDatasetAccess`（列投影 + 相对日白名单）；E2E 步骤 6 读的是平台 `datasetFacts` |

**唯一改动既有文件的理由（不是为了改而改）**：为了让「研究侧维度与指标」能表达而不新写一套引擎，
`robustness/{dimension,comparison,multiDimension,drift,evaluate,index,serialize}.ts` 做了**泛化**改动 ——
**旧调用方形状不变、旧单测全绿**。这是「复用」的代价，也是「复用」的证据。

---

## 17. 技术债、文档口径与孤儿数据（规格 §18 / §19 / §20）

### 17.1 §18 · P1 技术债（只解决 EXP-002 实际需要的部分）

**已解决（EXP-002 实际需要）**：
`9ck` 审计的 `BD-17` 指出「同一套漂移语义在本仓有**两份实现**」且「参数按轴 switch 散在 router 里」。
本轮**没有**去大改它（那样会为错误的抽象层白做一次，且违反 §25），
但**本文档登记一个结构性约束**：本轮泛化后的 `comparison.ts#evaluateTolerance` 是**新的**唯一容差实现候选，
后续若要回收 `overfittingDetection/parameterSensitivity.ts:159/173` 的重复实现，
**应当以本轮的抽象层为准**（因为它已被一次真实跨阶段消费验证过）——
而不是像 `9ck` 建议的那样「等抽象层定稿」，**抽象层现在已经定稿**。

**未解决（如实登记，不擅自扩范围）**：`9ck` 的 `BD-15` / `BD-16` / `BD-10` / `BD-12` / `BD-14` 全部保持登记状态。
本轮**没有**执行 `BD-17` 的回收 —— 它需要改 `overfittingDetection/**` 与 `paramSearchRouter.ts`（超出 §25 边界）。

### 17.2 §19 · P1-1 文档口径修正（已执行）

修改 `docs/research/EXPERIMENT-CODE-SPEC.md`（+61 / −? 行），新增
**§P.6.1「🔴 Manifest 的索引分组只由 `role` 决定，不看扩展名」**，内容包括：

- 本轮真机事故的完整记录（`.json + role:"artifact"` 落错段的机制）；
- 修复点（`runManifest.ts#inferArtifactDescriptor` 的角色优先级：`result` → `RESULT`；
  `log` → `LOG`；`artifact` → `OTHER`；其余按扩展名）；
- 两个钉死单测（`runPersistence.test.ts`，33 例全绿）；
- **作者侧备忘**：想让 JSON 落在 `artifacts` 段，必须 `role: "artifact"`，不能只靠扩展名。

同时把 `9ck` 登记的 `BD-15`（`EXPERIMENT-CODE-SPEC.md:559` 「本体系不碰 Robustness」的**过度禁止**）
在本轮**一并澄清**：禁的是「**改 / 重做**参数搜索 / Backtest / OOS / Walk-Forward / Robustness **模块本身**」，
研究侧**可以消费其方法** —— 本轮本身就是这条澄清的第一次实践。

### 17.3 §20 · P2-1 孤儿数据（**只登记，不清理**）

`9ck` 审计实测的 9 行孤儿数据（父表 `search_robustness_run` **0 行**，0 FK、无级联）：

| 表 | 行数 |
| --- | --- |
| `search_robustness_result` | **6** |
| `search_robustness_parameter_analysis` | **3** |
| **合计** | **9** |

🔴 **本轮明确不清理生产库的这 9 行**（规格 §20）。理由：它们不是本轮造成的，
清理属于**独立的数据运维任务**，需要一个显式的、带备份与对账的指令；在稳定性验证任务里顺手删数据
是典型的范围外破坏。本报告与 `ROADMAP` 只做**登记**。

### 17.4 本轮新增的技术债（登记）

| 编号 | 内容 | 建议 |
| --- | --- | --- |
| `BD-18` | 🔴 **「泛化层新增能力」尚未进入作者面契约的强清单**（`9ci` 的 `BD-13` 的变体）：本轮改了 `robustness/**` 的公开形状（维度不透明化、指标 `Record<string,number>`、`unavailable` 两态），但**规范里没有一节告诉作者「怎么用」** —— 目前只有 `stability-validation/README.md` 一份**实验级**说明。 | 待裁定：是否在 `EXPERIMENT-CODE-SPEC.md` 增一节「消费跨阶段 Robustness 的唯一入口与四条纪律」 |
| `BD-19` | ⚠️ **`dimension.ts` 文件头曾有一句当时为假的自我声明**（「有静态守卫测试钉住」）。本轮已改为指向真闸门，但**这类「说明书比事实宽」的写法在本仓已多次出现**（`9cj` 9 条判据、`9ck` 措辞精度、本轮 1 条）。 | 待裁定：是否要求新增的「有测试钉住」类声明**必须同时给出测试文件与用例名** |
| `BD-20` | ⚠️ **`9ck` 登记的 `BD-12` 仍未清**：`docs/evidence/README.md` 仍缺 `9cg` / `9ch` 两轮的索引节（本轮只补 `9cl` 自己这一轮）。 | 保持登记（记录优先于代改） |

---

## 18. 测试与真机验证（规格 §21 / §22）

### 18.1 公共机制测试（规格 §21 要求 11 项）

`tests/server/research/robustness/multiDimension.test.ts`（1071 行 / **48 例**）覆盖 **12 个 describe 块**
（规格要求 11 项 + 本轮新增的结构级闸门）：

| # | describe | # | describe |
| --- | --- | --- | --- |
| 1 | baseline 校验（baseline-first） | 7 | 失败样本结构化（不静默吞） |
| 2 | variant 校验 | 8 | 基准失败 ⇒ 拒绝产出无锚点结论 |
| 3 | evaluator 注入（**核心不重算**） | 9 | 样本账守恒（§13） |
| 4 | 指标可扩展（**词表任意声明**） | 10 | 多维矩阵（**一个 Run 一个基准**） |
| 5 | 比较（声明式） | 11 | 确定性指纹与序列化 |
| 6 | 容差判定（**唯一实现**） | 12 | 🔴 **核心不含研究侧业务语义（§17 结构级闸门）** |

### 18.2 EXP-002 测试（规格 §21 要求 11 项）

`tests/server/researchExperiments/exp002StabilityValidation.test.ts`（1270 行 / **50 例**）覆盖 11 个面：

Dataset Version 正确 / PIT 正确（决策时点 + 未来数据的有意声明）/ 无未来数据泄漏（读取上界 = 声明上界）/
baseline 可复现（同输入 ⇒ 同产物）/ **variant 真重算**（不是复制旧结果、不是只改标签）/ sample accounting 平衡 /
Result Envelope（动态信封）/ Artifact manifest / 对象 Key 结构 / Run 状态（含失败路径两条出口）/ 前端最终态（静态闸门）。

### 18.3 🔴「不得只做 mock」的落实方式

规格 §21 明确**不得只做 mock**。落实为**三层**：

| 层 | 手段 | 本轮证据 |
| --- | --- | --- |
| 单测 | 真库可达时走真库；不可达时用 `InMemoryArtifactStorage` 作**唯一替身**，且替身**不被允许**改变被断言的结构 | 48 + 50 例全绿 |
| **真机 E2E** | 真库 + 真 Dataset（`390002`）+ 真 MinIO，经 tRPC 端点跑完整 Run | **29 步全 PASS** |
| **真浏览器** | 无头 Edge + CDP 量 DOM，走完整用户路径并**真点一次运行** | **56 / 56 PASS** |

### 18.4 §22 · 真实运行（已完成，不是计划）

| 项 | 实测 |
| --- | --- |
| Run | `RUN-20260921-46934548` · `COMPLETED` · `outcome = SUCCEEDED` · `durationMs = 128475` |
| Run 生命周期 | `PENDING → RUNNING → COMPLETED`（经 tRPC `run` 端点；前置闸实测在途 0 个） |
| Dataset | `first_limit_pullback` / `390002` / `v2` / `READY` / 声明 23978 |
| 全量扫描 | `eventScanPolicy = FULL_DATASET`、扫描 23978 行 = 候选 23978、`unscannedEventCount = 0`、`droppedByScanLimit = false`、`fullScanVerdict = full`、实验侧分页 12 轮 |
| 产物完整性 | MinIO **8 个对象**（10b 逐个 `exists()` + 10e 绕开服务层列前缀） |
| CSV | matrix 48 行 / comparison 17 行 / accounting 17 行（均含表头） |
| SVG | 14430 B，**标签可闭合** |
| `robustness-run.json` | 54679 B，指纹 `ddd458d62578b483…` 与结果信封一致 |
| 页面读端点 | `getRun` 状态一致 / `getRunResultManifest` 命中 / `getArtifactMetadata` 实测存在（10166 B）/ `listRuns` 2 条含本 Run |
| 自清理 | 删除 1 行 + 8 对象，**残留 Run = 0 / 残留对象 = 0** |

**被保留供人工查看的 Run（2 条，刻意保留）**：

| Run id | 用途 |
| --- | --- |
| `RUN-20260921-A95F5B48` | 后端 E2E **首跑**（22 PASS / 7 FAIL）—— 判据修正的证据 |
| `RUN-20260921-C95B1D47` | 前端探针 **56/56 PASS** 的那一次 |

中间态 Run（`CB9F8DE7` / `8E4115EC` / `356542B0`）已被**白名单式清理脚本**删除：
`deletedRows = [1,1,1]`、`deletedObjects = 24`、`leftoverObjectsInDeletedPrefixes = 0`。
脚本 `docs/evidence/_ops_cleanup_9cl_superseded_runs.mts` **硬编码白名单**，白名单外出现即 `exit 2`
（防止「清理脚本自己删错东西」）。

### 18.5 回归四件套

| 项 | 结果 |
| --- | --- |
| `tsc --noEmit` | **exit 0（0 error）** |
| `pnpm run test:changed` | **2 failed / 24 passed（26 文件）**，`5 failed / 577 passed（582 例）` ⇒ **零新增失败文件**（见下） |
| 定向 `vitest`（6 文件） | **223 例全绿 / exit 0** —— `multiDimension` 48 + `exp002StabilityValidation` 50 + `exp001FundamentalStudy` 76 + `runPersistence` 33 + `manifest.test` 9 + `legacyFreeProductionChain` 7 |
| `node scripts/checkEolDrift.mjs` | 已跟踪文件漂移 **0** / 未跟踪新文件 CRLF **0** |

🔴 **「零新增失败文件」的判据（不是「全绿」）**：失败的是 `tests/server/limitUp.watch.test.ts`（4 例）与
`tests/server/limitUp.test.ts`（1 例），经 `docs/audit/reports/2026-09-09_AUDIT-002_FULL_SYSTEM_CODE_AUDIT_REPORT.md:63-64`
逐字核对，与基线**是同一批环境依赖失败**（无 DB 数据）⇒ 判据成立。
⚠️ 把「全绿」当判据会让这类已知环境失败长期掩盖真回归；本项目的判据是**零新增失败文件**。

---

## 19. 缺陷与判据修正登记 · 台账 · 结论

### 19.1 真机 E2E：首跑 22 PASS / 7 FAIL —— **7 条里 0 条是产品缺陷**

首跑（`_e2e_9cl_exp002_stability_validation.first.out.json`，Run `RUN-20260921-A95F5B48`）7 条 FAIL，
逐条定性后**全部是判据自身写错**：

| # | 判据怎么错的 | 为什么错（必须登记原因，不许只把颜色刷绿） |
| --- | --- | --- |
| 1 | 按 `kind` / `id` / `version` 读核心记录的身份 | 真实字段名是 `subjectKind` / `subjectId` / `subjectVersion` / `subjectRunId`（§5） |
| 2 | 在 `customPayload.candidates` 里找 `eventScanPolicy` | 这个字段**不在**实验的 payload 里，是**平台** `datasetFacts` 的字段（§7） |
| 3 | 把 `unavailable` 当错误码比对 | 下发的是**标签**（中文句子），码只在 `unavailableReasonLabels` 的 key 上（§9.3） |
| 4 | 期望 `HORIZON_T5` 有 3 个指标值 | 它按定义**不可用** ⇒ `metrics` 只有 2 个计数指标，其余进 `unavailable` |
| 5 | 把信封 `eligible` 与核心 `eligible` 当同一个 | 两者**不同义**（§12.2），必须走显式换算 |
| 6 | 按 `robustnessRunId` 前缀猜断言 | 真实值是确定性派生的 `RBM-64E58D4B7AC2D8AC`，不是随机 id |
| 7 | 期望清理后 `listRuns` 为空 | 存在**刻意保留**的两条 Run ⇒ 正确判据是「本 Run 不在列表里且残留对象为 0」 |

**共同病因**：「把**我当时看到的那一行 / 那一种写法**当成契约本身」（与 `9cj` 的 9 条、`9ck` 的 2 条同源）。
修正后重跑 **29 / 29 PASS**。

### 19.2 🔴 产品真缺陷（本轮新发现并修复）：稳定性矩阵卡片的容差 1.0 参考线在页面上**根本不存在**

- **现象**：前端探针 D15 FAIL —— `chartSvgs: 4, toleranceRefLines: 0, hasBars: 48`。
  柱子画了 48 根，但**声称的红色容差线一根都没有**。
- **定性链**：选择器写法正确（recharts 确实渲染 `.recharts-reference-line > line`）→ 源码无条件渲染该元素
  → 根因是 recharts `ReferenceLine.defaultProps.ifOverflow = 'discard'`（`es6/cartesian/ReferenceLine.js:187`），
  `getEndPoints` 越域时 `return null`（`:71-72`）⇒ **整条线被静默丢弃**。
- **错修（已留档取证）**：改成 `ifOverflow="extendDomain"` ⇒ 线**存在**了，但 `y1 = -32.75`
  （画到绘图区上方，**依然看不见**）。根因再深挖：
  `util/DetectReferenceElementsDomain.js:23` 读 `el.props['yAxisId']`，而 **React 元素不含 `defaultProps`**
  ⇒ `undefined === 0` 为假 ⇒ 扩展被跳过、`discard` 检查也被跳过 ⇒ 线被渲染到绘图区外。
  **即：`ifOverflow="extendDomain"` 在本仓是空操作。**
- **正解**：显式 `YAxis domain={[0, ratioAxisMax]}`，其中
  `ratioAxisMax = Math.max(1, ...实际最大比值)` ⇒ **值域恒含 1** ⇒ 参考线必然落在域内。
- **修复后实测**：`refLineStroke = #dc2626`、`refLineDash = 4 3`、`refLineY1 = 8`（∈ [0, 288]）、
  `yTicks = ["0","0.25","0.5","0.75","1"]`、`refLineGroupCount = 1`。
- **三条判据同时钉死**：D15（线与色值存在）/ **D15b**（值域含 1 且线坐标 ∈ [0, surfaceHeight]）/
  **D15c**（卡片文案声称「越过红色虚线（1.0）」⇒ DOM 里**必须**真有这条线）。
  只留「文案说了」而不查 DOM，就是这个缺陷最初能躲过验收的原因。

### 19.3 判据自身写错（前端，2 条）

| # | 判据怎么错的 | 为什么错 |
| --- | --- | --- |
| 1 | 全局 `querySelectorAll('.recharts-surface')` 数图 | 数到 **4** 个 —— 其中 **3** 个是**图例图标**（recharts 的图例图标也是 `Surface`，`DefaultLegendContent.js:143`）。必须按卡片缩小范围 |
| 2 | 用 `.recharts-legend-icon` 类名区分主图 | `legendIconCount = 0` —— recharts **不给图例 `Surface` 任何 `className`**。正确判据 = `closest('.recharts-legend-item') === null` |

**修正后主图判定**：`chartSurfaceCount === 1` ∧ `legendIconCount === 3` ∧ `barCount === 48`。

### 19.4 沿用的既有纪律（本轮被再次验证为「必须」）

| 纪律 | 本轮怎么被验证 |
| --- | --- |
| **产物 `name` 不得含角色段**（`9ci`/`9cj` 事故） | E2E 步骤 10c 实测 `tables/tables/…` 形式 Key = **0 个** |
| **平台缺陷：`.json + role:"artifact"` 落错段**（本轮修） | E2E 步骤 10d 实测 `tables = 3` / `artifacts = 2`（修复前是 `tables = 4`） |
| **`0` 与「不适用」必须分开** | `HORIZON_T5` 三指标 = `null` + 原因，未伪造 0（§9.3） |
| **负向结论也要证据** | `sensitive = 0` 必须配 `非 0 delta 行 = 39` 才算成立（§11 证据四） |
| **探针必须真点一次「运行」** | 探针 C 组直接点了一次，拿到新 Run `RUN-20260921-C95B1D47` |
| **探针改完先 `node --check`** | 本轮一次 `SyntaxError: missing ) after argument list` 源于注释里的反引号（模板串里不得出现反引号） |
| **闸门必须可证伪** | `公共机制 · 12` 注入 `'nonBreakOpen'` 立刻变红并点名（§19.5） |

### 19.5 结构级闸门的**可证伪性**自证

新增的「核心不含研究侧业务语义」闸门**首跑不是绿的** —— 它抓出了**我自己的假阳性**：
token `BASELINE_` 命中了核心**自己的错误码** `RB18X_BASELINE_FAILED`（`multiDimension.ts:282/310/325/439/653/657/661`）。
改 token 为精确的 `BASELINE_T5_H10_ALL` 后 **48 / 48 PASS**。

随后做**注入式可证伪验证**：往 `multiDimension.ts` 注入
`export const __gateFalsifyProbe = "nonBreakOpen";` ⇒ 闸门**立刻变红**并点名
`multiDimension.ts` 出现 `"nonBreakOpen"`（截图为 `_scratch/9cl_gate_falsify.txt`）。
**还原后**（`crlf = 0`、`32278 B` 与注入前逐字节一致）复跑 **48 / 48 PASS、`TEST_EXIT = 0`**。

🔴 **这一闸门同时把 `dimension.ts` 文件头的一句旧自述从「假」变「真」**：
原写「有静态守卫测试钉住」，而当时**并不存在**这样的测试。这正是本仓反复出现的
「**说明书比事实宽**」（`9cj` 9 条判据、`9ck` 措辞精度、本轮 1 条）—— 已登记为 `BD-19`。

### 19.6 台账（规格 §24）

| 台账 | 更新内容 |
| --- | --- |
| `ROADMAP.md` §44 | 「上轮实查」**覆盖式**更新为 `9cl`（`9cj` 条**原样搬运**入 CHANGELOG，非删除） |
| `ROADMAP.md` §44.5 | 队列新增 `9cl` 条；编号台账行：**已用至 `9cl` ⇒ 下一个未占用 `9cm`** |
| `ROADMAP-CHANGELOG.md` | append `9cl` 节（含被覆盖的 `9cj` 条原文） |
| `docs/architecture/CHANGE-AUDIT.md` | append `## 2026-09-21 · 9cl（EXP-002 …）`（10 字段 + `Potential Baseline Drift`） |
| `docs/evidence/README.md` | 新增 `9cl` 节（5 类证据文件 + 重跑命令） |
| `.workbuddy/memory/2026-09-21.md` | append `9cl` 节 |

### 19.7 结论与停止位置

**`EXP-002 = COMPLETE`。** 规格 §26 的验收目标——形成
`Independent Experiment → EXP-001 Research → EXP-002 Stability Validation → Baseline/Variants
→ Real Recompute → Metrics → Comparison → Stable/Sensitive/Insufficient/Failed → Result+Artifacts
→ MinIO → Frontend` **闭环**——已达成。

**目标不是再造 Robustness 模块，而是证明现有 Robustness 核心方法已成为 Research Experiment 的稳定性验证能力。**
本轮的证明方式是：把核心**改小**（泛化）而不是**复制**（新引擎），并让一次真实研究在**同一条链**上跑完。

**规格 §25 的停止条件未触发**：现有 Robustness 的泛化**没有**需要大规模重构
（净增 1540 行泛化层，旧调用方形状不变、旧单测全绿），也**没有**影响
Strategy / Parameter Search / Backtest 的既有语义（这些域的改动为 0）。

**明确没有做的事（如实登记）**：

- ❌ 没有做**显著性检验**、没有 p 值、没有置信区间；
- ❌ 没有 OOS / Walk-Forward / 参数搜索 / 交易成本 / 资金约束；
- ❌ 没有创建任何 Strategy / Candidate / 参数结论 / 排序 / 最优条件；
- ❌ 没有清理生产库的 9 行孤儿数据（只登记，§17.3）；
- ❌ 没有执行 `BD-17` 的重复实现回收（超出 §25 边界）；
- ❌ 没有补 `docs/evidence/README.md` 里 `9cg` / `9ch` 两轮的索引欠账（记录优先于代改，`BD-20`）。

**下一个未占用编号 = `9cm`。**
