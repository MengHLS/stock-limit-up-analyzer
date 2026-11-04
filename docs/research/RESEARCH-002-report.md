# RESEARCH-002 — Research Engine MVP 交付报告

> **任务**：在 RESEARCH-001 已完成的 Research 持久层（10 张 `research_*` 表 + `server/researchCore/` Domain/Repository）之上，实现**真正的 Research Engine**：读 Dataset → 执行分析 → 计算指标 → 落结果 → 生成结论。
> **日期**：2026-09-10
> **结论一句话**：Research Engine MVP 已在**真实 TiDB Dataset（version 390001，1130 个首板事件）**上端到端跑通，Experiment → Run → Analysis → Metric → Result → Conclusion 全链路可经 Repository 查回；PIT 边界由类型系统 + 运行时断言双重保障并有测试证明；TypeScript 类型检查通过；既有测试零回归。

---

## 1. Executive Summary

### 1.1 交付物

| 类别 | 内容 |
|---|---|
| 实现代码 | `server/researchEngine/` **21 个文件 / 4,156 行**（不含测试） |
| API 层 | `server/researchEngineRouter.ts` 428 行（17 个 tRPC 端点，已注册进 `appRouter`） |
| 测试 | **8 个文件 / 103 个测试全过**（`server/researchEngine/` 7 个 + `server/researchEngineRouter.test.ts`） |
| 真实 E2E | `scripts/verifyResearchEngine.mts` 529 行 + 证据 `docs/research/RESEARCH-002-e2e-evidence.json` |
| 类型检查 | `npx tsc --noEmit` **exit 0** |
| 回归 | `server/datasetRegistry` + `server/researchCore` + `shared` 既有测试**零新增失败** |

### 1.2 验收条件对照（§20）

| 验收项 | 结果 |
|---|---|
| 至少一个真实 Dataset 端到端运行成功 | ✅ Dataset Version **390001**（`first_limit_pullback` v1，READY，2026-08-01 → 2026-08-31，1130 事件） |
| PIT 测试通过 | ✅ `pit.test.ts` 5 例；含「抹掉全部未来数据 → 特征逐字节不变」证明 |
| API 验证通过 | ✅ `researchEngineRouter.test.ts` 18 例（注册/权限/链路/错误码映射） |
| TypeScript 类型检查通过 | ✅ `tsc --noEmit` exit 0 |
| 现有测试无回归 | ✅ 见 §11 |
| 5 类分析全部实现且真实运行 | ✅ 5/5 在真实数据上 `COMPLETED` |

### 1.3 真实数据上的研究产出（QUANTILE 验收案例）

假设：**「换手率不同区间的首板股票，未来5日收益存在系统性差异。」**

| 分位 | n | 未来5日收益均值 | 中位数 | 胜率 |
|---|---|---|---|---|
| Q1（换手率最低） | 107 | **+3.0402%** | +0.4714% | 50.47% |
| Q2 | 106 | +3.2302% | +0.8037% | 54.72% |
| Q3 | 107 | +1.4809% | −0.4566% | 49.53% |
| Q4 | 106 | +1.2412% | −0.1539% | 49.06% |
| Q5 | 107 | +2.3961% | −0.7353% | 47.66% |
| Q6 | 106 | +2.3007% | −0.9502% | 45.28% |
| Q7 | 106 | +1.7034% | −0.1888% | 49.06% |
| Q8 | 107 | **−0.3130%** | −1.1260% | 43.93% |
| Q9 | 106 | +1.0777% | −1.7549% | 46.23% |
| Q10（换手率最高） | 107 | **−0.0383%** | −0.5525% | 47.66% |

**顶底分位差 `SPREAD_TOP_BOTTOM` = −3.0785%**（Q10 − Q1），Welch t = −1.6799，p = 0.0930，n = 214。

结论：**首板换手率越高，未来 5 日收益越低**（方向为负），但：
- p = 0.0930 > α = 0.05 → **未通过统计门槛**；
- 分位均值**不单调**（Q2 最高、Q8 为负）→ 方向一致性仅 0.667；
- 自动结论 `PARTIALLY_SUPPORTED`，主观置信度 0.5833（**明确声明不是 p-value**）。

> ⚠️ 该结论仅为**研究辅助**，且该 Dataset Version 仍基于 DATASET-003B P1 修复前的旧涨停口径（见 §14）。**不得**据此产出交易结论。

---

## 2. Existing Architecture Reuse（复用既有架构）

### 2.1 复用的既有资产

| 既有资产 | 复用方式 | 是否重写 |
|---|---|---|
| `shared/quant-stats.ts` | 全部统计量（mean/median/variance/std/skew/kurtosis/quantile/percentile/Newey-West/normalCdf…） | ❌ **零重写** |
| `server/datasetRegistry/query.ts` | `DatasetDataReader` 分页读 + **新增批量读**（见 §4） | 增量扩展，未改既有语义 |
| `server/datasetRegistry/db.ts` | `DbDatasetRegistry` 读 `dataset_version` / `dataset_definition` | ❌ 只读复用 |
| `server/researchCore/` | 10 张表 Domain 类型 + `ResearchRepositories` + 软引用校验 | ❌ 只读复用 |
| `server/routers.ts` | 注册 `researchEngine` 子路由 | 增量 2 行 |

### 2.2 刻意**不**做的事

- **不合并** `server/researchEngine` 进 `server/research/index.ts` barrel（`server/research` 是 STEP 6~22 的**策略/回测链路**，与本研究链路正交；合并会造成命名与语义污染）。已核实 barrel 中无 `researchCore` / `researchEngine` 导出。
- **不改** `drizzle/meta/_journal.json`（该项目自 migration 0024 起停维护；RESEARCH-002 无需新表，故完全不触碰，避免伪造 journal）。
- **不动** Dataset 的任何物理表（`ds_*`）。
- **不做** IC / RankIC、因子搜索、ML、自动策略生成、Parameter Search、Backtest、OOS、WFO、Robustness（§1 明确排除项）。

---

## 3. Research Engine Architecture（分层与派发）

### 3.1 分层落位（§3）

```
ResearchEngine                engine.ts            10 步编排 + 生命周期 + 失败落库
  └─ ResearchDatasetReader    datasetReader.ts     唯一数据入口（无散落 SQL）
      └─ AnalysisExecutorRegistry  analyses/registry.ts   按 analysisType 派发
          ├─ DescriptiveExecutor   analyses/descriptive.ts
          ├─ EventStudyExecutor    analyses/eventStudy.ts
          ├─ QuantileExecutor      analyses/quantile.ts
          ├─ ConditionalExecutor   analyses/conditional.ts
          └─ StabilityExecutor     analyses/stability.ts
              └─ MetricCalculator  metrics.ts        全系统唯一指标实现
  └─ ResearchResultWriter     researchCore/results.ts 结构化落库（复用）
      └─ ConclusionBuilder    conclusion.ts        规则式结论 + evidence
```

**派发模式**：`AnalysisExecutorRegistry`（register / require / has / listTypes），重复注册被拒绝；未注册类型 → `UNKNOWN_ANALYSIS_TYPE`。五个分析各自独立文件，**未堆进一个巨型 `research-engine.ts`**。

### 3.2 10 步执行流程（§4）

| 步骤 | 实现要点 |
|---|---|
| 1 Load Experiment | 不存在 → `EXPERIMENT_NOT_FOUND` |
| 2 Load Run | 不存在 / 归属不符 / 状态不可执行 → `RUN_NOT_FOUND` / `RUN_EXPERIMENT_MISMATCH` / `RUN_NOT_PENDING` |
| 3 Validate Dataset Version | 不存在 → `DATASET_VERSION_NOT_FOUND`；非 READY → `DATASET_VERSION_NOT_READY`（**禁止用未就绪版本研究**） |
| 4 Load Analyses | 空 → `NO_ANALYSES` |
| 5 Resolve Dataset input | 变量目录来自 Dataset **真实视界**；逐分析解析配置 + 校验变量角色，**全部在 RUNNING 之前完成** |
| 6 Assemble sample | `buildSampleSet`：keyset 分页事件 + 每页一次批量 `IN (...)` 读 prefix/path/outcome + 维度解析 |
| 7 Execute analyses | 逐分析 `RUNNING → COMPLETED`；**单分析失败 → 该分析 FAILED 并中止本次运行** |
| 8 Calculate metrics | 全部经 `MetricCalculator`（无分析内自实现） |
| 9 Generate conclusion | `buildConclusion`（规则式、保守、带免责声明） |
| 10 Update status | Run `COMPLETED` + `inputSnapshot` 落库（可追溯） |

### 3.3 生命周期与失败可追溯性（本次修复）

`PENDING → RUNNING → COMPLETED`；失败 → `FAILED` + `errorCode` / `errorMessage`。

**本次 E2E 暴露并修复的真实缺陷**：原实现的失败回写以 `runStarted`（已进入 RUNNING）为条件，导致**预检失败**（配置非法、Dataset 未就绪等）时 Run 永久停在 `PENDING` —— 用户只看到「没跑」，看不到「为什么没跑」，违反 §22 的**可追溯**要求。

修复：引入 `runIdentified`（Run 已确认存在、归属正确、状态可执行）。此后任何失败都落 FAILED + errorCode；并用 `startedAt` 区分两类失败：

| 情形 | status | startedAt | errorCode | Experiment |
|---|---|---|---|---|
| 预检拒绝（配置非法 / Dataset 未就绪） | FAILED | **null** | 具体码（如 `INVALID_ANALYSIS_CONFIG`） | 保持原状态（修正后可重跑） |
| 执行中崩溃 | FAILED | 有值 | `ANALYSIS_FAILED` / `INTERNAL_ERROR` | FAILED |
| 无法归因（Run 不存在 / 不归属 / 状态不可执行） | **不改写** | — | — | — |

最后一行是刻意的：状态不可执行的 Run（如已 `COMPLETED`）**绝不能**被一次误点改写。

---

## 4. Dataset Reader（统一读取层，§5）

### 4.1 契约

`ResearchDatasetReader`（`datasetReader.ts`）—— Research 侧**唯一**数据入口：

```ts
getVersionContext(datasetVersionId): Promise<ResearchDatasetVersionContext | null>
loadEventPage(query): Promise<ResearchEventPage>      // keyset 分页，按 (tradeDate, eventId)
loadOutcomes(query):  Promise<FirstLimitPullbackOutcome[]>   // 批量 IN (eventIds)
loadPaths(query):     Promise<FirstLimitPullbackPath[]>
loadPrefixBars(query):Promise<FirstLimitPullbackRawBar[]>
```

真实实现 `RegistryResearchDatasetReader` **组合**（compose）既有 `DatasetDataReader`，不复制任何读取逻辑。

### 4.2 对既有读取层的增量扩展（`server/datasetRegistry/query.ts`）

新增（**纯增量，既有分页语义一字未改**）：

- `loadOutcomesBatch` / `loadPathsBatch` / `loadRawBarsBatch(role, …)`
- `getPathRelativeDayRange(datasetVersionId)`

要点：
- `datasetVersionId` **始终下推到 SQL**（满足 §5「必须遵守 datasetVersionId 边界」）；
- 空 `eventIds` **直接返回 `[]`，不发 SQL**；
- 缺表（如某 Dataset 无 prefix）→ `isTableMissingError` → `[]`，不抛错；
- `InMemoryDatasetDataReader` 同步实现，保证测试与真实实现语义一致。

### 4.3 三条硬约束的落法

| 约束 | 落法 |
|---|---|
| Research 不得复制 / 修改 Dataset | Reader 只做 `SELECT`；无任何 `INSERT/UPDATE/DELETE` 指向 `ds_*`（测试断言） |
| 不得散落 SQL | 全部读取经 Reader；Analysis 内**零 SQL** |
| 必须遵守 `datasetVersionId` 边界 | 所有查询签名强制携带，且真实实现下推 |

---

## 5. Analysis Implementations（5 类分析）

### 5.1 DESCRIPTIVE（§7）

- 指标：`SAMPLE_COUNT` / `MISSING_COUNT` / `MISSING_RATE` / `MEAN` / `MEDIAN` / `STD` / `MIN` / `MAX` / `P01 P05 P10 P25 P50 P75 P90 P95 P99` / `SKEWNESS` / `KURTOSIS`
- 落库：`resultType=GROUPED`，`dimension = { variable: "<名字>" }` → **结构化**，非塞 JSON
- 缺失值：`null` 直接跳过指标（**不冒充 0**），并如实记 `MISSING_COUNT` / `MISSING_RATE`

### 5.2 EVENT_STUDY（§8）

- 逐 horizon 一组（`dimension = { horizon: h }`）：`SAMPLE_COUNT` / `MEAN_RETURN` / `MEDIAN_RETURN` / `STD_RETURN` / `WIN_RATE` / `T_STAT` / `P_VALUE`
- 附加（仅当 Dataset 真实具备）：`MAX_FAVORABLE_EXCURSION`(MFE) / `MAX_ADVERSE_EXCURSION`(MAE) / `MAX_DRAWDOWN` / `BREAKOUT_RATE` / `MEAN_DAYS_TO_BREAKOUT`
- 主视界选取规则**写死在代码里并写入证据**（样本数最多 → 并列取视界更大者），避免「按效应大小事后挑选」
- `T_STAT` / `P_VALUE` 用 Newey-West HAC + 正态近似，并在 notes 声明「事件样本视界重叠，独立性假设不严格成立」
- **明确不实现** `time_to_target` / `time_to_stop`：Dataset 未定义任何交易规则（止盈止损线），强行实现即为编造数据。与 MFE/MAE 最接近的真实列是 `outcome.daysToBreakout`，已如实呈现。

**本次 E2E 暴露并修复的真实缺陷**：`requiredVariables` 曾**无条件**要求 `max_return_{h}d` 等 5 个附加变量。但：
- `future_return_{h}d` 来自 **path**（`relativeDay` 1..20）
- `max_return_*` / `min_return_*` / `max_drawdown_*` / `is_breakout_*` / `days_to_breakout_*` 来自 **outcome**（本项目只覆盖 `{5,10,20}`）

因此配置 T+1 / T+3 时引擎在**解析需求阶段**直接 `UNKNOWN_VARIABLE` 崩溃。修复：按变量目录过滤，只请求真实登记的变量；缺失项在 notes 中如实登记（`unavailableVariables`），**不静默丢弃、不虚构指标**。

> 该缺陷此前被测试掩盖：测试夹具的变量目录把 outcome 视界写成 `[1,3,5,10,20]`，比真实数据更宽松。已把夹具目录改为**与真实 Dataset 同构**（path 1..20 / outcome {5,10,20}）并加注「不要再改回去」。

### 5.3 QUANTILE（§9）

- 分组规则（写入 metadata + 代码注释）：`group(v) = 1 + |{k : v > percentile(feature, k/G)}|`
  → **相同特征值永不落入不同分组**（并列不劈开）
- 实际分组数可能 < G（大量并列跨越切点时），此时在 notes 与 metadata 的 `requestedGroups` / `actualGroups` 中**明示不一致**，**不静默补齐**
- 顶底差定义**显式落库**：`SPREAD_TOP_BOTTOM = mean(最高分位组) − mean(最低分位组)`；实际分组数 < 2 时**不产出该指标**（返回 null），而非编造 0
- 同组附加：`T_STAT_DIFFERENCE`（Welch）/ `P_VALUE_DIFFERENCE`；`directionConsistency` = 单调一致性

### 5.4 CONDITIONAL（§10）

- 支持**单条件**与**多条件 AND**；条件算子复用 `RESEARCH_CONDITION_OPERATORS`（`> >= < <= == != IN NOT_IN BETWEEN IS_NULL IS_NOT_NULL`）
- 输出 `ALL` 组与 `CONDITION` 组各自的指标，再输出 `DIFFERENCE` / `RELATIVE_DIFFERENCE` / `T_STAT_DIFFERENCE` / `P_VALUE_DIFFERENCE`
- **空条件集 → 显式失败**（`CONDITIONAL 分析没有任何条件…`），不静默退化成「等于全样本」
- 条件字段必须可解析（特征 / 维度 / 已加载结果变量之一），否则具名失败
- 同族缺陷同步修复：`drawdownVariableFor(target)` 曾无条件要求 `max_drawdown_{h}d`；目标为 path 独有视界（如 `future_return_3d`）时会崩。现按目录确认存在后才请求。

### 5.5 STABILITY（§11）

- 维度枚举**读取既有项目定义**（`STABILITY_DIMENSION_KEYS` = `year / month / quarter / board / market / industry / regime`），映射到 Dataset 真实列（`board→event.boardType`、`market→event.market`、`industry→event.industryCode`），**不重新发明枚举**
- 逐组输出 `SAMPLE_COUNT` / `MEAN_RETURN` / `MEDIAN_RETURN` / `WIN_RATE` + `ALL` 组 + `STABILITY_RATIO`
- `STABILITY_RATIO` 定义落库：各子区间均值符号与整体均值符号一致的占比 [0,1]
- `regime` 维度：**必须注入 `RegimeTagProvider`**，否则 `REGIME_PROVIDER_UNAVAILABLE`。刻意**不**把既有 `server/research/marketRegime22` 的小写标签集（`up/down/sideways` 等）改造成臆造的 `STRONG/NEUTRAL/WEAK` 枚举
- **本次 E2E 暴露并修复的真实缺陷**：单组时 `directionConsistency` 恒为 `1.0`，会被误读为「高度稳定」。现与 QUANTILE 保持一致：**分组数 < 2 → 不产出 `STABILITY_RATIO`**（null），并如实说明「无法评估跨期稳定性」。真实数据上 v1 恰好只有 1 个板块（`main`）→ 该修复直接生效。

---

## 6. Metric Implementations（指标唯一实现，§12）

- 全部指标经 **`MetricCalculator`**（`metrics.ts`）单一入口；Analysis 内**零**自实现 mean / median / winRate（有测试守卫）
- 底层统计**全部复用 `shared/quant-stats.ts`**，零重写
- 约定：**`null` = 样本不足 / 不可计算**，绝不返回 `NaN` / `Infinity`，也绝不冒充 0

| 类别 | 指标码 |
|---|---|
| 基础 | `MEAN` `MEDIAN` `STD` `MIN` `MAX` `SAMPLE_COUNT` `MISSING_COUNT` `MISSING_RATE` |
| 收益 | `MEAN_RETURN` `MEDIAN_RETURN` `STD_RETURN` `WIN_RATE` `PROFIT_FACTOR` `MAX_DRAWDOWN` |
| 分位 | `P01 P05 P10 P25 P50 P75 P90 P95 P99` |
| 形态 | `SKEWNESS` `KURTOSIS` |
| 统计检验 | `T_STAT` `P_VALUE`（Newey-West HAC + 正态近似）；`T_STAT_DIFFERENCE` `P_VALUE_DIFFERENCE`（Welch） |
| 二元/比较 | `SPREAD_TOP_BOTTOM` `DIFFERENCE` `RELATIVE_DIFFERENCE` |
| 事件形态 | `MAX_FAVORABLE_EXCURSION` `MAX_ADVERSE_EXCURSION` `BREAKOUT_RATE` `MEAN_DAYS_TO_BREAKOUT` |
| 稳定性 | `STABILITY_RATIO` |

语义澄清（已写入 `definitionOf`）：
- `WIN_RATE` = 严格 `> 0` 占比（不含 0）
- `PROFIT_FACTOR` = 无亏损样本时返回 **null**（不是无穷大）
- `MAX_DRAWDOWN` = **事件级回撤均值**，**不是**权益曲线最大回撤
- 每个指标的 `definition` 文本随结果行落库（`details.metricDefinition`），可复核口径

---

## 7. PIT Safety（§6）

### 7.1 结构性防线（编译期）

变量解析器接收**互斥**的两个类型：

```ts
interface FeatureSources { event; prefixBars; }   // rd ≤ 0，仅 PIT 安全
interface OutcomeSources { pathRows; outcomeRows; } // rd ≥ 1，仅未来标签
```

特征变量只拿得到 `FeatureSources`，结果变量只拿得到 `OutcomeSources` —— **写错即编译错误**，而不是靠 review 发现。

### 7.2 运行时防线

- `ResearchVariableCatalog.resolveFeature` / `resolveOutcome`：角色反用 → `VARIABLE_ROLE_VIOLATION`（具名失败，不返回 undefined 蒙混）
- 变量名不存在 → `UNKNOWN_VARIABLE`（附 known 列表）
- Engine 在执行前遍历 `requirement.features / outcomes` 逐个过目录

### 7.3 与 Dataset 既有 PIT 约束的关系

**不重新实现** Dataset 的 PIT 逻辑，而是**镜像**其结构事实：
- `prefix` 物理表本身**没有**任何未来列 → FeatureSources 只暴露 `prefixBars`
- `path.relativeDay ≥ 1` → 所有 path 派生变量只出现在 OutcomeSources
- 视界来自 Dataset **真实值**（`outcome.horizon` 与 `path.relativeDay` 范围）；目录**绝不为不存在的视界发明变量**（测试断言 `_21d` / `_25d` 不存在）

### 7.4 测试证明（§17 硬性要求）

`server/researchEngine/pit.test.ts`（5 例）包含关键证明：

> **把样本中所有未来数据（path / outcome）整体抹掉，重算特征 —— 特征值必须逐字节完全一致。**

其他守卫：结果变量不能当特征（`VARIABLE_ROLE_VIOLATION`）、特征不能当结果、`market_cap` / `float_market_cap` 在上游全 NULL 时**如实返回 null**（不隐藏列、不编造）。

---

## 8. Result Persistence（结果落库，§13）

- 结构化列：`analysisId` / `resultType`(SCALAR·GROUPED·SERIES) / `dimension`(JSON) / `metricCode` / `metricValue` / `sampleCount`
- 复杂信息 → `details`（`result_json`）：口径定义、切点、缺失原因、变量来源、`requestedGroups`/`actualGroups` 等
- **禁止全塞 JSON**：核心数值一律走结构化列（可 SQL 聚合、可排序、可筛选）
- Engine 重跑同一 Analysis 时 **先 `deleteByAnalysis` 再整批写入** → 幂等重写，不追加（有测试）
- `inputSnapshot`（Run 落库）记录：`datasetVersionId` / `datasetCode` / 版本标签 / 日期区间 / 变量需求（features·outcomes·dimensions）/ 分析类型清单 / 快照时间 → **完整可追溯**

---

## 9. Conclusion Logic（结论生成，§14）

### 9.1 规则式、保守、可审计

`ConclusionPolicy`（可覆盖，默认值随 `getConclusionPolicy` 端点暴露给前端）：

| 参数 | 默认 | 含义 |
|---|---|---|
| `alpha` | 0.05 | 统计门槛 |
| `materialityAbs` | 0.005 | 最小实际效应（0.5%） |
| `minSampleCount` | 30 | 最小样本量 |
| `stabilityMinConsistentRatio` | 0.6 | 方向一致性下限 |
| `strongSampleMultiple` | 2 | 「样本充裕」倍数 |

主分析选取：**固定优先级** `QUANTILE > CONDITIONAL > EVENT_STUDY > STABILITY`（写死，**不是**按效应大小挑选）。

判定顺序（短路 R1~R5）→ `SUPPORTED` / `PARTIALLY_SUPPORTED` / `REJECTED` / `INCONCLUSIVE`。

### 9.2 防夸大（三重）

1. **每份结论与证据都内嵌免责声明**（原文落库）：
   > ⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。
2. `confidence` 为**主观置信度**，并显式标注 `confidenceIsNotPValue: true` + `confidenceBasis`（说明每一分怎么来的）
3. `evidence` 记录：命中的每条规则 + 通过/未通过 + 实际数值与阈值 → 可逐条复核

### 9.3 真实数据上的结论（示例）

```
类型：PARTIALLY_SUPPORTED    主观置信：0.5833（不是 p-value）

关键量：Q10 − Q1 的 future_return_5d 均值差 = -0.0308；p = 0.0930；t = -1.6799；
        样本 1065（最小分组 106）；方向一致性 0.667。

1. [通过]   R2_样本达标      —— 总样本 1065（门槛 30），最小分组 106（门槛 30）
2. [通过]   R3_最小实际效应  —— |效应| = 0.0308，阈值 0.005
3. [未通过] R4_统计量达标    —— p = 0.0930，alpha = 0.05
4. [通过]   R5_方向稳定      —— 一致性 0.667，下限 0.6
```

**R4 未通过即如实给出 `PARTIALLY_SUPPORTED`** —— 引擎没有把 p=0.093 讲成「显著」。

---

## 10. API（§16）

遵循项目既有 tRPC 风格（对齐 `datasetRegistry/router.ts`）：`publicProcedure` 只读 / `adminProcedure` 写与执行；`buildResearchEngineRouter(deps)` 工厂 + 默认实例。

| 端点 | 类型 | 说明 |
|---|---|---|
| `researchEngine.listVariables` | query | 变量目录（features / outcomes / dimensions + 不可用维度及原因） |
| `researchEngine.createExperiment` / `listExperiments` / `getExperiment` | mutation/query | Experiment（`getExperiment` 返 experiment + runs + hypotheses + conclusions + datasetVersion） |
| `researchEngine.createHypothesis` | mutation | 假设 |
| `researchEngine.createRun` / `listRuns` / `getRun` | mutation/query | Run |
| `researchEngine.runEngine` | mutation（admin） | **执行引擎**（可覆盖 `conclusionPolicy`） |
| `researchEngine.createAnalysis` / `listAnalyses` / `getAnalysis` / `getAnalysisResults` | mutation/query | 分析 + 条件 + 指标登记 + 结果查询 |
| `researchEngine.setAnalysisConditions` | mutation（admin） | 整批替换条件（改后需重跑） |
| `researchEngine.listConclusions` / `listCandidates` / `getConclusionPolicy` | query | 结论 / 候选 / 阈值口径 |

已注册：`server/routers.ts` → `appRouter.researchEngine`。

**领域错误 → 稳定 tRPC code 映射**（`toTrpcError`）：

| 引擎码 | tRPC code |
|---|---|
| `EXPERIMENT_NOT_FOUND` / `RUN_NOT_FOUND` / `DATASET_VERSION_NOT_FOUND` | `NOT_FOUND` |
| `RUN_NOT_PENDING` / `RUN_EXPERIMENT_MISMATCH` | `CONFLICT` |
| `DATASET_VERSION_NOT_READY` / `REGIME_PROVIDER_UNAVAILABLE` / `EMPTY_SAMPLE_SET` / `DATASET_TOO_LARGE` | `PRECONDITION_FAILED` |
| `INVALID_ANALYSIS_CONFIG` / `UNKNOWN_VARIABLE` / `VARIABLE_ROLE_VIOLATION` / `UNKNOWN_ANALYSIS_TYPE` / `NO_ANALYSES` | `BAD_REQUEST` |
| 其他 | `INTERNAL_SERVER_ERROR` |

---

## 11. Test Results（§17）

### 11.1 本次新增测试

```
server/researchEngine/metrics.test.ts                 15 例
server/researchEngine/variables.test.ts                7 例
server/researchEngine/pit.test.ts                      5 例   ← PIT 硬性证明
server/researchEngine/conditionEvaluator.test.ts      11 例
server/researchEngine/conclusion.test.ts              12 例
server/researchEngine/engine.test.ts                  15 例
server/researchEngine/analyses/analyses.test.ts       21 例
server/researchEngineRouter.test.ts                   18 例
────────────────────────────────────────────────────────────
小计                                    8 文件 / 104 例 全过

前端工作台（§16）
client/src/adapters/researchEngineAdapter.test.ts     26 例
client/src/components/research/createExperimentForm.test.ts  16 例
client/src/components/research/createAnalysisForm.test.ts    31 例
────────────────────────────────────────────────────────────
小计                                    3 文件 /  73 例 全过
```

### 11.2 覆盖对照（§17 要求）

| §17 要求 | 覆盖 |
|---|---|
| Engine 派发 | `UNKNOWN_ANALYSIS_TYPE`、registry 重复注册拒绝 |
| Engine 成功 | 全链路 → 结论，结果可查回 |
| Engine 失败 | `ANALYSIS_FAILED`；预检失败 → Run FAILED + errorCode + `startedAt=null`；不可归因 → 不改写状态 |
| Dataset Reader | 分页装配、版本下推、空 id 不发 SQL、缺表返回 `[]` |
| Descriptive | mean / median / std / percentile、缺失值不计 0 |
| Event study | T+1/T+3/T+5；**outcome 视界 ⊂ path 视界时不崩且不虚构** |
| Quantile | 5 / 10 分位、空数据、边界并列（同值不劈开、实际组数诚实） |
| Conditional | 单条件 / AND 条件 / 空条件显式失败；**path 独有目标视界不崩** |
| Stability | year 分组 / regime 分组；**单组不产出 STABILITY_RATIO** |
| **PIT** | **抹掉未来数据 → 特征逐字节不变** |
| API | 17 端点注册 + 权限 + 链路 + 错误码映射 |

### 11.3 回归

| 范围 | 结果 |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `server/researchEngine` + `server/researchEngineRouter.test.ts` | **8 文件 / 104 例全过** |
| `server/datasetRegistry` + `server/researchCore` + `shared` | **19 文件 / 376 例全过** |
| 前端 `client/src/adapters` + `client/src/components/research` | **5 文件 / 97 例全过** |
| 全链路聚焦（引擎 + 前端 + dataset + researchCore + shared） | **32 文件 / 577 例全过** |
| 全量 `npx vitest run` | **197 文件 / 2913 例**（2897 通过 / 16 失败） |

本次相对实施前：全量 **+3 文件 / +74 例**（前端 3 个测试文件 73 例 + `conclusion.test.ts` 新增 1 例）；**失败数恒为 16，且落在同样的 8 个既有环境依赖文件上 —— 零新增失败**。

> 上表为**前端工作台交付时点**（§16）的快照。RESEARCH-002A（维护服务 + 工作台可维护性）完成后的复核结果见 **§17.8**（204 文件 / 3010 例，失败集合不变）。

### 全量失败的 8 个文件 —— **全部为既有环境依赖失败，与 RESEARCH-002 零交集**

```
server/dataHealth.test.ts              （FE-1 认证证据读取，依赖 docs/step12-evidence 快照与真实 DB）
server/image.uploadAndRecognize.test.ts
server/limitUp.test.ts
server/limitUp.watch.test.ts
server/marketData.test.ts              （直连真实业务表）
server/researchRunRouter.test.ts       （legacy STEP 6.x research_runs 复数表）
server/tushare.secret.test.ts          （Tushare token 限制）
server/tushareTradingCalendar.test.ts  （Tushare trade_cal 限频 1 次/分钟）
```

**与 RESEARCH-001 基线逐字一致**（该基线记录为「178 文件 / 2720 tests 通过，8 个失败文件全为既有环境依赖失败」）。
文件数 197 = 186（基线总数）+ 11（本次新增：引擎测试 8 + 前端测试 3）；用例数 +193（引擎侧 119 + 前端侧 74）→ **失败数恒为 16、文件恒为同样 8 个 → 零新增失败**。

### 11.4 测试过程中发现并修复的实现缺陷（7 项；另第 8 项见 §17.7）

引擎的测试与真实 E2E 各暴露了一半，说明「合成夹具 + 真实数据」双轨测试是必要的；第 7 项由**构建前端消费侧**时反向暴露：

1. **预检失败不落库** → Run 永久 `PENDING`（可追溯性缺陷，§3.3）
2. **EVENT_STUDY 无条件要求 outcome 聚合变量** → T+1/T+3 崩溃（§5.2）
3. **CONDITIONAL 无条件要求回撤变量** → path 独有目标视界崩溃（§5.4）
4. **STABILITY 单组恒为 1.0** → 误读为「高度稳定」（§5.5）
5. **测试夹具变量目录比真实数据宽松** → 掩盖缺陷 2/3；已改为与真实 Dataset 同构（§5.2）
6. **报告脚本的分组样本数被后序指标覆盖** → CONDITIONAL 中 `MEAN_RETURN`(n=1065) 与 `MAX_DRAWDOWN`(n=1127) 分母不同，展示时被覆盖成错误分母；已改为逐指标记录 n 并显式标注分母不一致
7. **`conclusion.evidence` 在两个分支下形状不一致** → 无主分析分支写 `trace`/`analyses`，主分支写 `ruleTrace`/`contributingAnalyses`，下游需两套解析器；已抽出单一构造入口 `buildEvidence()`，并加回归测试断言两分支键集相同（§16.5）

> 第 8 项（**条件载荷组号断号**）由「编辑既有条件」路径反向暴露，属**新建路径**上的既有缺陷，详见 §17.7。

---

## 12. Real Dataset E2E Evidence（§15）

### 12.1 验收案例（严格按 §15 指定）

| 项 | 值 |
|---|---|
| Dataset | `first_limit_pullback`（首板回踩），definition id **120001** |
| Dataset Version | **390001** / v1 / **READY**，2026-08-01 → 2026-08-31，声明事件 **1130** |
| Experiment | 「首板换手率与未来5日收益研究」 |
| Hypothesis | 「换手率不同区间的首板股票，未来5日收益存在系统性差异。」 |
| Run | runNo 1，`PENDING → RUNNING → COMPLETED` |
| Analysis | QUANTILE：feature `turnover` → outcome `future_return_5d`，**10 分位**（另加 DESCRIPTIVE / EVENT_STUDY / CONDITIONAL / STABILITY 共 5 个） |

### 12.2 真实运行结果

```
真实事件数  1130        outcome 视界  [5,10,20]      path 相对日  [1,20]
可用特征变量 13 个       可用结果变量 95 个（含 path 推导视界）

实验编排：Experiment → Hypothesis → Run → 5 × Analysis
Engine：  sampleCount = 1130   resultCount = 138   conclusionType = PARTIALLY_SUPPORTED
落库查回：Run.status = COMPLETED，Experiment.status = COMPLETED，errorCode = null
          inputSnapshot.variables = {turnover} × {future_return_1d/3d/5d, max/min/maxdd/breakout/days @5d} × {board}
```

| Analysis | 状态 | 结果行数 | 关键数值 |
|---|---|---|---|
| QUANTILE | COMPLETED | 53 | 顶底差 **−0.030785**，t = −1.679856，p = 0.092985，n = 214 |
| DESCRIPTIVE | COMPLETED | 38 | turnover 均值 7.3161（n=1130）；future_return_5d 均值 0.016105（n=1065） |
| EVENT_STUDY | COMPLETED | 26 | T+1 +1.0592%（n=1127）；T+3 +1.8594%（n=1126）；T+5 +1.6105%（n=1065） |
| CONDITIONAL | COMPLETED | 16 | 换手率∈[3,10]：ALL +1.6105% / COND +1.4894%，DIFFERENCE −0.1211%，p = 0.832852 |
| STABILITY | COMPLETED | 5 | 按板块分组只有 1 组（`main`）→ **不产出 STABILITY_RATIO**（如实说明无法评估） |

### 12.3 独立复核（脱离引擎代码路径）

脚本内实现了一段**不使用引擎/分位实现**的复算：直接读物理表 → 自行算十分位切点 → 自行分组 → 算首尾差。

```
全样本 n = 1065   均值 = 0.016105
切点 [2.1766, 3.0257, 3.8720, 4.7603, 5.7416, 6.8942, 8.0766, 10.1120, 13.9834]
首组 mean = +0.030402 (n=107)    尾组 mean = −0.000383 (n=107)
首尾差 = −0.030785
```

**与引擎输出完全一致（−0.030785）** → 引擎结果可被独立复现，不是黑箱。

### 12.4 可追溯性证明

全部实体均经 `ResearchRepositories` 查回（非直接 SQL 断言）：
`getExperiment`（含 runs / hypotheses / conclusions / datasetVersion）、`getRun`、`getAnalysis`（bundle）、`getAnalysisResults`、`listConclusions`。

### 12.5 「Dataset 零改动」实测验证（§19 禁止项）

任务前后各实查一次 `ds_*` 物理表行数，**逐字节一致**：

```
             任务前       任务后
event        1130    →    1130
path        15876    →    15876
outcome      3390    →    3390
```

Run 结束后 `research_experiment / hypothesis / run / analysis / result / conclusion` 六表计数**全部为 0**（验收数据已按 leaf-first 清理干净），确认引擎**只读 Dataset、只写自己的 `research_*` 表**。

### 12.6 证据产物

- `docs/research/RESEARCH-002-e2e-evidence.json` —— 完整原始证据（Dataset 元信息、变量、每个分析的逐组数值 + 逐指标样本数、标量指标、结论全文与规则明细、独立复核、耗时）
- `scripts/verifyResearchEngine.mts` —— 可重复执行的验收脚本（跑完默认清理落库数据，`--keep` 保留）

### 12.7 重复运行一致性复核

收尾阶段对同一脚本做了**独立复跑**（全新进程 / 同一 Dataset Version / 同一配置），用于区分「结果稳定」与「偶发通过」：

| 项 | 运行 A | 运行 B（复跑） | 判定 |
|---|---|---|---|
| `sampleCount` | 1130 | 1130 | 一致 |
| `resultCount` | 138 | 138 | 一致 |
| 结论类型 | `PARTIALLY_SUPPORTED` | `PARTIALLY_SUPPORTED` | 一致 |
| QUANTILE 顶底差（引擎） | `-0.030784914547101534` | `-0.030784914547101534` | **逐位一致** |
| QUANTILE 顶底差（独立复算） | `-0.030785` | `-0.030785` | 一致 |
| 引擎耗时 | 27,523 ms | 16,846 ms | 波动（见 §13.1） |

复核后再次实测 `research_*` 六表计数全部为 0、`ds_*` 行数不变 —— 复跑同样**零残留、零改动**。

> 附：复跑期间曾出现一次后台实例以 `RC=4` 退出且无任何标准输出（同一日志文件被并发实例争写）。经查该退出**未产生任何副作用**：`research_*` 仍为 0、`ds_*` 未变、证据 JSON 由干净的那次运行完整写入。此处如实记录，不作修饰。

---

## 13. Performance（§18）

### 13.1 真实耗时分解（1130 事件 / 5 个分析，**两次独立运行对比**）

同一脚本、同一 Dataset Version（390001）、同一配置，先后跑两次（进程全新，均走真实 TiDB）：

| 阶段 | 运行 A | 运行 B | 波动 |
|---|---|---|---|
| Dataset 装配（分页读事件 + 批量读 path/outcome + 维度解析） | 9,645 ms | **1,353 ms** | **7.1×** |
| QUANTILE（53 行） | 2,072 ms | 1,850 ms | 1.1× |
| DESCRIPTIVE（38 行） | 2,122 ms | 1,553 ms | 1.4× |
| EVENT_STUDY（26 行） | 2,198 ms | 1,628 ms | 1.3× |
| CONDITIONAL（16 行） | 1,724 ms | 1,561 ms | 1.1× |
| STABILITY（5 行） | 1,654 ms | 1,628 ms | 1.0× |
| 分析合计 | 9,770 ms | **8,220 ms** | 1.2× |
| 结论生成 + 138 行结果落库 + 状态更新 | ~8,108 ms | ~7,273 ms | 1.1× |
| **引擎总计** | **27,523 ms** | **16,846 ms** | **1.6×** |

**关键观察（比单次数字更有说服力）**：两次运行**统计产物逐位一致** —— `sampleCount = 1130`、`resultCount = 138`、结论 `PARTIALLY_SUPPORTED`、顶底差 `-0.030784914547101534`（独立复算同样为 `-0.030785`）。**波动的只有耗时，不是结果**：波动集中在「装配」这一**往返次数最多**的阶段（7.1×），而每个分析稳定在 1.5~2.2 s。这说明耗时由**网络往返**主导，与计算量无关 —— 与 §13.2 的结论互相印证。

（运行 A 期间另有后台 E2E 实例并发（见 §12.7），跨境带宽存在争用，是装配阶段 9.6 s 的合理来源；此处按实测原样记录，不修饰。）

### 13.2 性能结论：**延迟受限，不是算力受限**

- 单个分析内**纯计算**在毫秒级；每分析约 1.5~2.2 s 几乎全是 **TiDB 跨境往返**（`scripts/_rtt_probe` 实测单次 RTT ≈ 0.5 s）
- 因此优化方向是**减少往返次数**，而非优化算法 —— 运行 B 在装配阶段往返更顺，总耗时直接腰斩到 16.8 s，而结果一字未变

### 13.3 已落实的性能措施

| 措施 | 落实 |
|---|---|
| 不整表加载 | keyset 分页（默认 2000 事件/页），非 OFFSET 全量拉取 |
| 按版本查询 | `datasetVersionId` 全部下推 SQL |
| 批量读取 | 每页一次 `IN (eventIds)` 读 outcome/path，**不做 N+1** |
| 最小化装配 | 只加载被请求的变量与相对日/视界（union 去重后一次装载） |
| 规模化护栏 | `DEFAULT_MAX_SAMPLES = 200_000` 超出 → `DATASET_TOO_LARGE` |
| 真实计时 | `sampleBuildMs` + 逐分析 `durationMs` + `durationMs` 全部落库/返回，**不是估算** |

### 13.4 后续优化点（非本任务范围）

- 结果落库 138 行仍偏慢 → 可评估更大批次 / 多值 `INSERT`
- 装配阶段可按需并行化跨表批量读（当前串行）

---

## 14. Known Limitations（已知限制，诚实清单）

### 14.1 🔴 上游数据口径（**最重要**）

- **DATASET-003B P1 涨停口径修复后 `ds_*` 重建仍未执行**。因此本次验收所用的 `ds_first_limit_pullback_*` 仍是**旧口径**数据（封板样本系统性漏判约 **38.03%**）。
- 后果：§12 的所有研究数值**只能在"引擎可用"意义上成立**，**不得**据此产出任何策略结论。（与 §19 铁律一致。）
- 表结构已就位，重建无需改 DDL —— 属数据侧动作，非本任务范围。

### 14.2 🟠 Dataset Version 390001 的窗口与覆盖限制

| 限制 | 实测 | 影响 |
|---|---|---|
| 时间跨度仅 **1 个月**（2026-08-01 → 08-31） | `dataset_version.startDate/endDate` | `year` / `month` / `quarter` 维度退化为单组 → **时间维度稳定性无法评估** |
| 板块只有 **1 个**（`main`） | STABILITY 按 `board` 分组仅 1 组 | 跨板块稳定性同样无法评估 |
| `marketCap` / `floatMarketCap` **1130/1130 全 NULL** | 实查 TiDB | 依赖市值/流通盘的特征（`market_cap` / `float_market_cap`）**恒返回 null** |
| `industryCode` 1069/1130 NULL | 实查 TiDB（P4 行业 `effectiveFrom` 单点问题的下游后果） | `industry` 维度绝大多数样本不可用 |

变量目录**如实暴露**这些变量并返回 `null`，而不是隐藏列或编造值。

### 14.3 🟡 引擎能力边界

| 项 | 状态 |
|---|---|
| `time_to_target` / `time_to_stop` | **未实现**（Dataset 无交易规则），已在 notes 声明 |
| `regime` 维度 | **需注入 `RegimeTagProvider`**，否则 `REGIME_PROVIDER_UNAVAILABLE`（不臆造标签） |
| `market_cap` / `float_market_cap` 变量 | 已登记但当前恒 null（上游限制） |
| 同组内不同指标的样本分母可能不同 | 已如实标注；**未强制对齐分母**（如 CONDITIONAL 中 `MEAN_RETURN` n=1065 vs `MAX_DRAWDOWN` n=1127）。比较时须注意 |
| `T_STAT` / `P_VALUE` | Newey-West + **正态近似**；事件视界重叠 → 独立性假设不严格成立，仅作研究辅助。**未做多重比较校正** |
| `confidence` | **主观**，不是 p-value（已显式标注） |
| Experiment 状态机 | 预检失败时 Experiment 保持原状态（仅 Run FAILED）——刻意设计，便于修正后重跑 |

### 14.4 🟡 工程债（非本任务引入）

- `drizzle/meta/_journal.json` 自 migration 0024 起停维护 → `drizzle-kit generate` / `npm run db:push` 仍不可用（须先重建 baseline）。本任务**未新增迁移**，故未触碰。
- `research_experiment` 与 legacy `research_experiments`（STEP 6.x）**仅差一个 s** —— 长期命名混淆风险，建议后续统一。
- Drizzle 无 DB 外键 + `delete` **不级联** → 删除 Experiment 会留下孤儿 Run/Analysis/Result。E2E 脚本已实现 leaf-first 手动清理；**产品化需要补级联**。
- 全量 vitest 存在**环境性既有失败**（`server/marketData.test.ts` 等直连真实业务表的旧测试），与本任务零交集。

---

## 15. RESEARCH-003 Recommendation（下一步建议）

### 15.1 前置（必须先做，否则研究结论无意义）

1. **先执行 DATASET-003B 的 P1 涨停口径修复 + 重建 `ds_*`（smoke / v1 / v2）**。
   这是所有后续研究的**前置硬门槛**：当前旧口径漏判约 38% 封板样本，任何分位/事件结论都建立在有偏样本上。

### 15.2 数据侧（解锁当前不可用的分析）

2. **补 `liquidity_daily.totalMarketCap` / `circulationMarketCap`（当前 9,015,158 行全 NULL）** → 解锁市值/流通盘特征与筛选。
3. **修 `industry` 的 `effectiveFrom` 单点问题（P4）** → 解锁行业维度的 PIT 正确分组与稳定性分析。
4. 考虑构建一个**跨年（≥2 年）、跨板块**的研究用 Dataset Version，使 `year` / `month` / `board` 稳定性分析真正可评估。

### 15.3 引擎侧（在稳定数据上再做）

5. **补充时间维度事件研究**：待 Dataset 定义交易规则（止盈/止损线）后实现 `time_to_target` / `time_to_stop`。
6. **接入 `RegimeTagProvider`**：把 `server/research/marketRegime22` 的既有七维 regime 体系接成合法标签源，解锁 `regime` 分组（而不是再造一套枚举）。
7. **对齐组内指标分母**：让同一 group 下各指标在同一可用样本集上计算（或显式输出两套分母）。
8. **结论策略可配置化落地**：把 `ConclusionPolicy` 持久化为 Experiment 级配置，便于复现与审计。

### 15.4 明确**不**建议现在做

- ❌ 基于当前旧口径 `ds_*` 做 IC / 因子搜索 / 参数搜索 / 回测 / OOS
- ❌ 让 Research Engine 反向修改 Dataset 或直接产出策略/回测（§19 铁律）
- ❌ 把 `confidence` 当作统计显著性使用

---

## 16. Front-end Workbench（研究前端工作台）

> **范围声明**：本节仅为 RESEARCH-002 引擎的**消费侧**（浏览 / 触发 / 查看）。**未触碰 Dataset 侧任何代码**（`ds_*` 未重建、`DATASET-003B` P1 未启动），与 §15.1 的硬门槛互不冲突。

### 16.1 分层落位（§17 前端约定）

严格遵循项目既有前端分层 `API (tRPC DTO) → Adapter → ViewModel → UI`，UI 不直接消费后端 DTO、不在 JSX 里做字段强转。参考实现对齐 `client/src/adapters/datasetRegistryAdapter.ts`。

```
client/src/adapters/researchEngineAdapter.ts        ← 唯一的展示契约层（DTO → VM）
client/src/components/research/createExperimentForm.ts   ← 表单纯函数（校验 + 载荷构造）
client/src/components/research/createAnalysisForm.ts     ← 同上（含条件构造）
client/src/components/research/*.tsx                     ← 6 个纯展示组件
client/src/pages/research/{ResearchList,ResearchDetail}.tsx  ← 页面
```

### 16.2 三条「不造假」防线（本次前端的主要设计目标）

| 风险 | 后端事实 | 前端做法 |
|---|---|---|
| **指标单位二义性** | `MEAN` 作用在 `turnover` 是百分比、在 `market_cap` 是绝对数、在 `days_to_breakout_5d` 是「天」 | `metricUnitOf(code, variableName)`：先查自单位码表（`WIN_RATE`/`MEAN_RETURN`/`SAMPLE_COUNT`…），否则**按变量名判定**，判不出返回 `NUMBER` 而**不猜** |
| **缺失值伪装成 0** | 引擎对不可算指标写 `metricValue=null` | `formatMetricValue` 对 `null`/`undefined`/`NaN`/`Infinity` 一律返回 `—`；绝不 fallback 到 0。结果的页脚显式说明 `—` 语义 |
| **编造统一分母** | 同组内各指标样本数**合法地不同**（例：`MEAN_RETURN` n=1065 vs `MAX_DRAWDOWN` n=1127） | 分组表格**逐指标**保留各自的 `n=`；仅当组内权重一致时才显示统一 `uniformSampleCount`，否则显示琥珀色徽标「各组分母不一致，逐指标标注样本数」 |

以上三条均有单测锁定（`researchEngineAdapter.test.ts`，26 例），其中分母一致性用例：

```ts
it("逐指标保留各自的样本数，分母不一致时不给统一的「组样本数」", () => {
  const rows = [
    { resultType:"GROUPED", metricCode:"MEAN_RETURN",  metricValue:0.01,  sampleCount:1065, dimension:{group:"ALL"} },
    { resultType:"GROUPED", metricCode:"MAX_DRAWDOWN", metricValue:-0.05, sampleCount:1127, dimension:{group:"ALL"} },
  ];
  const [block] = buildGroupBlocks(rows);
  expect(block!.uniformSampleCount).toBeNull();          // 不一致 → 不给统一值
  expect(block!.metrics.map((m) => m.sampleCount)).toEqual([1065, 1127]);
});
```

### 16.3 类型安全的枚举镜像（防静默漂移）

前端选项列表用 `satisfies` 约束在后端枚举上，后端枚举一变前端**编译期即失败**，而不是运行时静默少一个选项：

```ts
export const RESEARCH_TYPE_OPTIONS = [
  { value: "QUANTILE", label: "分位收益" }, /* …8 项… */
] as const satisfies ReadonlyArray<{ value: ResearchType; label: string; hint: string }>;

export const ANALYSIS_TYPE_OPTIONS = [
  { value: "QUANTILE", label: "分位数分析", primaryPriority: 1 }, /* …5 项… */
] as const satisfies ReadonlyArray<{ value: ResearchAnalysisType; … }>;
```

`primaryPriority` 显式镜像后端 `PRIMARY_PRIORITY = ["QUANTILE","CONDITIONAL","EVENT_STUDY","STABILITY"]`，让「主分析怎么选」在 UI 上可见（避免用户以为按效应大小挑）。

### 16.4 UI 上的「诚实降级」清单

- **不可用 Dataset Version 可见但禁用**：选项来自 `getDefinition.versions`，非 `READY` 的版本**照常列出**并标注真实状态（如 `BUILDING`），只是不可选 —— 而不是悄悄过滤掉让人以为版本不存在。
- **`PARTIALLY_SUPPORTED` 渲染为 warning 而非 success**：它有方向证据但未过门槛，落在 `client/src/lib/status.ts` 的全局色表里（§12 规定页面不得自带颜色）。
- **分析级 `notes` 从结论证据里取**：`AnalysisSummary.notes` 不单独持久化，只写到 `evidence.contributingAnalyses[].notes`。前端在**结论面板**里呈现（如「实际分组只有 1 组，无法评估跨期稳定性」），不在分析页假装有数据。
- **引擎错误码 → 可读诊断**：`rpcErrorToDiagnostic` 覆盖 12 个引擎码，兼容 `CODE:` 与 `[CODE]` 两种形态，给出标题 / 解释 / 建议。
- **执行链路页显式展示 `errorCode` / `errorMessage`**：Run 失败可追溯，不用去翻服务端日志。

### 16.5 与后端契约对齐时修的**真实后端缺陷**

构建消费侧时暴露出 `server/researchEngine/conclusion.ts` 的 `evidence` **在两个分支下形状不同**（无主分析分支手写 `{disclaimer,policy,trace,analyses}`，主分支写 `{…,ruleTrace,contributingAnalyses}`），下游被迫写两套解析器。已抽出单一构造入口 `buildEvidence()`，两分支共用；`primary: null` 表示「本次无主分析」而非键缺失。回归测试锁定：

```ts
it("evidence 形状在两个分支间保持一致（单一构造入口）", () => {
  expect(Object.keys(degraded.evidence).sort()).toEqual(Object.keys(normal.evidence).sort());
  expect(degraded.evidence.primaryAnalysis).toBeNull();
  expect(normal.evidence.primaryAnalysis).not.toBeNull();
});
```

### 16.6 真实 DB 只读契约核对（`scripts/checkResearchWorkbenchApi.mts`）

**24 项断言全过**（`researchEngineRouter.createCaller(...)` 只读调用，零写入）。关键「不虚构」不变量：

```
✅ future_return_{h}d 覆盖 path 全部相对日 1~20
✅ 聚合类结果变量没有为 outcome 未覆盖的视界发明（不虚构）
✅ 聚合类结果变量在 outcome 覆盖的视界上确实存在
✅ unavailableDimensions 显式列出 regime 并给出原因（不是悄悄消失）
✅ 不存在的 Dataset Version → NOT_FOUND
```

真实版本上下文（页面所有字段来源）：

```json
{"datasetVersionId":390001,"datasetId":120001,"datasetCode":"first_limit_pullback",
 "datasetName":"首板回踩","versionLabel":"v1","status":"READY","startDate":"2026-08-01",
 "endDate":"2026-08-31","totalEvents":1130,"horizons":[5,10,20],"pathRelativeDayRange":{"min":1,"max":20}}
```

### 16.7 构建产物安全性

生产构建后 grep 服务端专有标识符（`engineAssert` / `FEATURE_VARIABLES` / `PIT 安全特征` / `neweyWestMeanTStat` / `ds_first_limit_pullback`）在 `dist/public/assets/*.js` 中**全部未出现**，确认无服务端运行时代码泄漏到客户端 bundle。

### 16.8 前端验收

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| 前端新增测试（`client/src/adapters` + `client/src/components/research`） | **97 例全过** |
| `npx vite build` | **RC=0**，✓ 2983 modules transformed |
| 真实 DB 只读契约核对 | **24/24 PASS** |

---

## 17. Engine Maintenance & Workbench Maintainability（RESEARCH-002A）

本节记录 RESEARCH-002 交付后的**补齐**工作。范围由用户明确界定：**只写代码、只用既有接口，不触碰 `ds_*` 物理表与 dataset 页面**。因此本节全部内容**零数据依赖**：无迁移、无回填、无 Dataset 重建。

### 17.1 缺口审计：为什么是「可维护性」而不是「算法」

以**代码与 schema 为证据**（不采信 ROADMAP 文字）审计后，缺口分布如下：

| 缺口 | 证据 | 影响 |
|---|---|---|
| 引擎 17 个端点**零 update / delete** | `server/researchEngineRouter.ts` 全为 create/list/get/run | 只能新建，**无法删除或纠错**；实验与产物只增不减 |
| 仓储层能力**已就绪但不可达** | `server/researchCore/repository/contract.ts:151-239` 已定义全套 `update` / `delete` / `replaceForAnalysis` / `deleteByAnalysis` | 数据层能力被 API 层挡住，属纯浪费 |
| 级联删除规则**只存在于测试脚本** | `scripts/verifyResearchEngine.mts#cleanupExperiment` | 产品化不可达：用户删不掉实验 |
| 改口径**不清旧产物** | `setAnalysisConditions` 原语义仅替换条件行 | **静默不实**：UI 继续展示「用旧口径算出的数字」，比抛错更危险 |
| 运行闭环未装配 | `server/researchRunRouter.ts:114` 硬编码 `executorBound = false` | 「策略 → 跑研究」链路断在 UI 上 |
| 前端零导出 / 零删除 / 零条件编辑 | 工作台只有「新建」与「运行引擎」 | 实验一旦建错只能改数据库 |
| `listCandidates` 无消费方 | 端点存在，前端未用 | 后续「研究 → 策略」阶段的写入位不可见 |

结论：算法层已完整，缺口集中在 **①可维护性 ②运行闭环 ③维度/导出**。本节做 ①，③的一部分（候选 Tab / 结论导出）；②留待 D 段。

### 17.2 服务端维护服务 `server/researchEngine/maintenance.ts`（465 行）

导出：`MaintenanceDeletionCounts`、`DeleteRunResult`、`InvalidateAnalysisResult`、`ResearchConditionDraft`、`analysisIdsReferencedByConclusionEvidence`、`deleteAnalysisCascade`、`deleteRunCascade`、`deleteExperimentCascade`、`deleteHypothesisCascade`、`invalidateAnalysis`、`replaceConditionsAndInvalidate`、`describeDeletionCounts`。

**为什么独立成模块而不是塞进 router**：级联删除是**领域规则**（leaf-first），router 只应做入参校验与错误映射。放进 router 会让同一条规则在多个端点里各写一遍。

**执行中拒绝删除**（`assertNotRunning`）：`RUNNING` 状态下删父行，会让飞行中的写入落到已删实体上（幽灵行）。因此返回新错误码 `DELETE_CONFLICT`，由 router 映射为 tRPC `CONFLICT`，文案明确提示「请等待执行结束，或先置为 CANCELLED」。

### 17.3 「结论归属」的精确判定（本次最关键的诚实性设计）

`research_conclusion` **没有 `runId`**，只有 `experimentId` + `hypothesisId`。所以「删 Run 时该不该删某条结论」不能靠猜，必须从结论的 `evidence` 里**精确提取 `analysisId`**：

```
primaryAnalysis.analysisId  ∪  contributingAnalyses[].analysisId  ∪  analyses[].analysisId（旧键兼容）
```

据此与被删 Run 下的分析集合求交：命中 → 删除；**提不出任何 analysisId → 不删，并计入 `unattributedConclusions` 上报**。设计立场是**宁可留下可疑数据，也不越界删除**；前端把该计数如实回显（「另有 N 条结论无法判定归属，已保留」）。

`analysisIdsReferencedByConclusionEvidence` 对**不认识的形状直接返回空数组**（`asRecord` 守卫），不做 `?? 0` 之类的兜底 —— 猜错会删掉别人的结论。

### 17.4 改口径 = 让旧产物失效（不是静默替换）

`setAnalysisConditions` 新语义（顺序不可颠倒）：

1. **守卫**：Analysis 不存在 → `ANALYSIS_NOT_FOUND`；`RUNNING` → `DELETE_CONFLICT`；
2. **替换**：`conditions.replaceForAnalysis(...)`；
3. **失效**：删除该分析按旧口径算出的全部结果行 → 删除证据指向它的结论 → 把 Analysis 与其 Run **回退为 `PENDING`**。

第 3 步的「回退 PENDING」是关键设计：它让既有 `runEngine` 的 `RUN_NOT_PENDING` 前置**恰好放行重跑**，因此**不需要新增任何重跑入口** —— 表面积更小，且与既有状态机自洽。返回值 `InvalidateAnalysisResult` 携带 `deletedResults` / `deletedConclusions` / `runId`，供 UI 如实回显。

### 17.5 Router 端点：+7（全部 adminProcedure）

`updateExperiment`（白名单 patch：仅 `name` / `description`；**schema 中根本没有 `datasetVersionId` 键** → 数据集创建即冻结，换数据集等于换研究，应新建实验；空 patch → `BAD_REQUEST`）、`deleteExperiment`、`updateHypothesis`、`deleteHypothesis`、`deleteRun`、`updateAnalysis`、`deleteAnalysis`。

错误映射补充：`HYPOTHESIS_NOT_FOUND` / `ANALYSIS_NOT_FOUND` → `NOT_FOUND`；`DELETE_CONFLICT` → `CONFLICT`。

### 17.6 前端工作台可维护性接线（沿用 §17 分层，不在 JSX 里强转）

**新增**
```
client/src/components/research/ConditionGroupsEditor.tsx   共享条件组编辑器（从 CreateAnalysisDialog 抽出）
client/src/components/research/ConfirmDeleteButton.tsx     统一破坏性操作确认（AlertDialog + 后果清单 + 真实计数回显）
client/src/components/research/ExperimentActions.tsx       实验重命名 / 删除
client/src/components/research/AnalysisConditionEditor.tsx 编辑既有条件（回填 → 校验 → 替换 → 如实回显失效后果）
client/src/components/research/CandidatesPanel.tsx         候选列表 + 「为什么通常是空的」诚实空态
```

**修改**：`createAnalysisForm.ts` 新增 `conditionGroupsToPayload` / `validateConditionGroups` / `conditionPayloadToDraftGroups`（新建与编辑**共用同一载荷构造器**，杜绝「新建拦得住、编辑拦不住」）；`CreateAnalysisDialog.tsx` 改用共享编辑器；`ConclusionPanel.tsx` 加结论 JSON 导出（显式标注 `exportKind: "CLIENT_SIDE_API_SNAPSHOT"`，是接口响应快照而非报告）；`ResearchDetail.tsx` 加实验级操作、Run 删除列、分析「编辑条件 + 删除」列、策略候选 Tab。

**删除的诚实性**：`ConfirmDeleteButton` 本身**不做任何数据推断** —— 会删掉什么由调用方按后端语义写进 `consequence`，删完回显服务端返回的真实 summary。

### 17.7 顺带修掉的一个真实缺陷：条件载荷**组号断号**

修 `setAnalysisConditions` 的编辑路径时反向暴露了**新建路径**上的缺陷。

- **后端约束**（`server/researchCore/conditions.ts:181-183`）：`assertConditionSet` 要求**组号唯一且连续 0..n-1**，否则抛「条件组号不连续，缺少 N」。写库路径 `repository/db.ts#replaceForAnalysis:649` 真的会调用它。
- **缺陷**：`conditionGroupsToPayload` 原实现用**草稿下标**当 `groupNo`，而「整组一个字都没填」的空组不产出任何行 → 一旦空组在**前或在中间**，载荷就变成缺 0（或缺 1）的形状，被后端直接拒。
- **可达性**：用户新建 CONDITIONAL 分析（默认第 1 组为空），先去填第 2 组，保存即触发。
- **修法**：组号按**有效组**重排为连续 0..n-1；组内 `sortOrder` 按有效条件紧凑编号（后端只要求组内唯一，不要求连续）。
- **附带收益**：紧凑编号使「草稿 → 载荷」与「载荷 → 草稿」互为规范形，**往返幂等** —— 用户「打开编辑、什么都不改、点保存」不会改动库里任何口径（已加回归测试）。
- **附带发现**：原测试把错误行为**写成了期望**（`expect(rows[0]).toMatchObject({ groupNo: 1 })` 配一个空的第 1 组）。已改正为 `groupNo: 0` 并注明原因。这类「测试固化缺陷」比缺陷本身更值得警惕 —— 它会让修复看起来像回归。

### 17.8 验收

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `server/researchEngine/maintenance.test.ts` | **19 例全过**（新增） |
| `server/researchEngineRouter.test.ts` | **29 例全过**（含 7 个新端点契约 + 维护端点鉴权） |
| 聚焦回归（researchEngine + researchCore + router + adapters + research 组件） | **19 文件 / 326 例全过** |
| `client/src/components/research` | **60 例全过**（含 14 例新增载荷往返 / 校验） |
| `npx vite build` | **RC=0**，✓ 2995 modules transformed |
| 全量 `npx vitest run` | **204 文件 / 3010 例**（2994 通过 / 16 失败） |

**零新增失败**：16 个失败与 8 个失败文件**与 §11.3 记录的基线逐字一致**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `researchRunRouter` / `tushare.secret` / `tushareTradingCalendar`），全部为既有环境依赖失败，与本段改动零交集。
文件总数 197 → 204 的差额来自**本段之外的并行工作流**（board-height 风控 / leader-candidate / backtestPage 等测试文件），非本段引入。

### 17.9 ⚠️ 本节发现的既有缺陷（未修，需决策）

`server/dataHealth.test.ts` 与 `server/researchRunRouter.test.ts` 各有 1 例失败，**同源且非本段引入**：

```
docs/researchReadyGate/research_ready_gate.json  (capturedAt 2026-09-09T15:07:48Z)
  researchReady = true   ← G4 = PASS
  G0 = PASS | G1 = GAP（industry effectiveFrom 单点）| G2 = PASS
  G3 = GAP（生产引擎退出策略未实现）  | G4 = PASS | G5 = GAP（paper_trades 等表缺失）
```

这两个测试是在 `RESEARCH_READY=FALSE` 时期写的（断言 `G4=GAP` / `verdict=DATASET_NOT_READY`），而 gate 快照已于 **2026-09-09** 重新认证为 `researchReady=true` → 测试**相对快照过期**。

**2026-09-11 19:45 更新（D 段落地后）**：`server/researchRunRouter.test.ts` 一侧**已消解**——readiness 改为真实探测后该文件重写为 17 例，其中一例是**显式漂移探测器**（断言 `datasetGate.researchReady === true` 且 `verdict === "EXECUTOR_NOT_BOUND"`，并注明「若此断言失败说明快照已重新生成，请同步更新 ROADMAP §44 与 dataHealth 期望，**而不是改回断言**」）。`server/dataHealth.test.ts`（断言 `G4=GAP` / `researchReady=false`）**仍 1 例失败且未修**。

本报告不擅自改动 gate 快照，也不改 `dataHealth` 测试期望 —— 二者都属「用改测试来掩盖状态变化」的高危动作。**遗留待裁**：快照该重认证回 FALSE，还是 `dataHealth` 期望该更新。

---

## 18. Closed-Loop Wiring & Run Workbench（RESEARCH-002A · D 段）

### 18.1 目标与边界

补齐「研究引擎 → 闭环运行 → 前端工作台」这条链路的**可执行性**：此前 14 阶段闭环只有契约与编排器，**没有阶段执行器装配**，`researchRun.readiness` 硬编码 `executorBound=false`，FE-4 运行工作台由 `emptyRunResult()` 占位。

**数据边界（用户明确要求）**：只写代码、只用既有接口；**不触碰 `ds_*` 物理表、不改 dataset 页面、不做 DATASET-003B、不重跑认证**。因此 `data` 阶段**不调用** Dataset 构建器，而是采用调用方注入的真实 `ResearchDataset`。

### 18.2 装配层设计（`server/research/closedLoopWiring/`）

| 文件 | 职责 |
| --- | --- |
| `types.ts` | `ClosedLoopWiringInputs` / `ClosedLoopInputSource` / `ClosedLoopWiringArtifacts` / `CLOSED_LOOP_ARTIFACT_PRODUCER` / 覆盖率形状 |
| `requirements.ts` | **14 阶段装配声明表（唯一权威）**：模块 / `satisfyVia` / 真实入口坐标 / 未装配的确切原因 |
| `coverage.ts` | `assessClosedLoopWiringCoverage(inputs, requested?)` 纯函数探测（零 IO） |
| `executors.ts` | 6 个真实阶段执行器 + `createClosedLoopStageRunners` / `createClosedLoopWiring` |
| `index.ts` | 出口 |

**关键语义：入参来源 = 来源之间 OR、来源内 AND。**

```
satisfyVia: ClosedLoopInputSource[]
  ClosedLoopInputSource = { inputs?: keyof ClosedLoopWiringInputs[]; artifacts?: ClosedLoopWiringArtifactKey[] }
```

- **来源之间 OR**：有多条合法路径的阶段（如 `evaluation`）任一成立即可；
- **来源内 AND**：同一条来源里列出的入参**与**上游产物**必须同时齐备**。

#### 🔴 18.2.1 测试抓出的真实缺陷：来源内误写成 OR

原实现的 `ClosedLoopInputSource` 是「inputs 或 artifacts」的判别联合，`coverage`/`executors` 都按「二者取一」判定。后果：`research` 阶段声明的是「三件入参 **+** dataset 产物」，但只要 `dataset` 产物可得（`data` 阶段在链内），该阶段就被判定为可覆盖、**执行器被注册**——直到运行期执行器内部才发现 `experimentConfig` / `strategyContract` / `strategy13` 缺失并抛 `CL_WIRING_INPUT_MISSING`。

这正是本项目最忌讳的一类错误：**把「缺配置」伪装成「执行失败」**（调用方会去查执行器，而真正的问题是入参没给）。该缺陷由 D1 的集成测试抓到（报错文本直接点出 `research 阶段需要 inputs.experimentConfig / strategyContract / strategy13（三者齐备）`）。

修法：`ClosedLoopInputSource` 改为 `{ inputs?, artifacts? }`（**来源内 AND**），`requirements.ts` 改用具名构造器 `via(inputs, artifacts)` / `viaArtifact(artifacts)`，`coverage.ts#evaluateSource` 与 `executors.ts#registrationSourceSatisfied` 同步改为 inputs + artifacts 双检。

配套回归（3 例，锁定双向）：
- 「只有 dataset 产物、缺三件入参」→ `research` **不覆盖也不注册**（`missingInputs` 三项、`missingArtifacts` 空）；
- 「只有三件入参、链内无 data」→ `research` 缺 `dataset` 产物；
- 「`evaluation` 多来源 OR 仍成立」→ artifact 路径断时 input 路径单独成立。

### 18.3 装配现状（声明表即待办清单）

**已装配 6 阶段**：

| 阶段 | 模块 | 准入条件 | 真实调用 |
| --- | --- | --- | --- |
| `data` | researchDataset | `inputs.researchDataset` | 投影（**不构建**） |
| `research` | signalEngine | 三件入参 **+** `artifacts.dataset` | `runCandidateEngine` |
| `strategy` | strategySchema | `inputs.strategyDocumentInput` | `createStrategyDocument`（+ 可选 `createStrategyVersionRecord`） |
| `backtest` | simulator | `inputs.simulationConfig` **+** `artifacts.dataset` + `artifacts.candidateRun` | `runTradeSimulation` |
| `evaluation` | 三套评估器 | `artifacts.tradeSimulationRun` **或** `inputs.evaluationInput` | `evaluatePerformance` / `evaluateRiskAdjustedMetrics` / `evaluateTradeQualityMetrics` |
| `finalize` | lifecycle | `inputs.lifecycle` | **无需注册**：编排器内置路径 `attemptClosedLoopLifecycleAdvance` |

**留白 8 阶段**（每条都写明「缺什么 + 为什么现在不装 + 真实入口坐标」）：

| 阶段 | 不装配的理由（摘要） |
| --- | --- |
| `optimization` | 需要「参数集 → 绩效标量」evaluator ⇒ 等于在本层再搭一条 `dataset→signalEngine→simulator→evaluate` 子链；在候选/回测链未端到端验证前装配会产出**无法独立复算**的 `optimizationRef` |
| `robustness` | 同 `optimization`（扰动清单 + evaluator / 基准日收益序列） |
| `oos` | `walkForwardRun` 需 optimize/test 双 evaluator + 交易日序列 + 切分配置；**IS/OOS 隔离纪律要求先定切分契约** |
| `overfitting` | 需「候选 × 分区」指标矩阵（PBO 输入）/ IS-OOS 双轨评估器 ⇒ 依赖 OOS 链先行 |
| `regime` | 仅差「facts 装配 + `regimeRef` 投影（按 compositeKey 聚合 tags）」两件事 ⇒ **最易补齐**，留作下一增量 |
| `paper` | 需注入式 `priceSource`（PIT 行级价格回调）+ `tradingCalendar`；**价格口径（用哪个源、是否复权）必须先定** |
| `review` | `buildJournalDraftsFromRun` 直接消费 paper 阶段产物且会复核其指纹 ⇒ paper 未装配则无真实输入 |
| `discipline` | 消费 review 阶段 `TradeJournalEntry[]` ⇒ review 未装配则无真实输入 |

### 18.4 覆盖率探测的边界声明（重要）

`assessClosedLoopWiringCoverage` 判定的是 **「本层执行器已装配（`wired`）∧ 该阶段闭包入参可得（`satisfyVia`）」**，**不包含**编排器对 `ClosedLoopStageInputById`（同链前驱产出）的交接要求。后者以 `loopRun` 返回的 `stages[].blocked` 为准。

具体差异举例：只给 `evaluationInput`、链内无 `backtest` 时，`evaluation` 执行器**可注册**，但若没有 `backtestSummary` 交接，编排器仍会阻塞。`researchRun.loopRun` 用**成对校验**（`evaluationInput` ⇒ 必须同时给 `backtestSummarySeed`）把这条差异在 API 层消解掉，使 `CL_MISSING_UPSTREAM_HANDOFF` 在该端点下**不可达**（有测试锁定）。

### 18.5 readiness 真实探测

`server/researchRunRouter.ts` 的 `executorBound` 不再硬编码：

```ts
const wiring = probeWiringAtRest();       // = toWiringSummary({})
const executorBound = wiring.executorBound; // = assessClosedLoopWiringCoverage({}).executorBound
```

`readiness` 输出新增 `wiring`（`requestedStages` / `wiredStages` / `unwiredStages` / `coveredStages` / `uncoveredStages` / `executorBound`）。未就绪措辞由 `describeWiringGap(wiring)` 生成，**点名哪 8 个阶段尚无执行器**，不再说含糊的「待数据域认证后集成」。

零入参下 `coveredStages = []`（没有任何阶段入参可得）⇒ `executorBound = false` ⇒ **不冒充 READY**，`canRun=false`。

### 18.6 闭环运行端点 `researchRun.loopRun`

`mutation`，**无状态**（不写库、不落 run 记录、不改任何状态）。

输入（`closedLoopRunInputSchema`）：`runId?` / `createdAt?` / `experimentId` / `strategyId` / `strategyVersion` / `dateRange` / `datasetVersion?` / `universeVersion?` / `codeVersion?` / `executionModel?` / `parameterSet?` / `stageIds?` / `evaluationInput?` / `backtestSummarySeed?` / `lifecycle?`。

输出（`closedLoopRunResultSchema`）：`runId` / `createdAt` / `chainFingerprint` / `fingerprint` / `overall`（status + 三态计数 + firstBlockedReasonCode + synthetic + note）/ `runnerInjected` / `stages`（14 行：state / outputKind / 交接指纹 / output / blocked）/ `blockedSummary` / `wiring`。

**两条防伪绑定**：

1. **`evaluationInput` 必须与 `backtestSummarySeed` 成对出现**。理由有两层：(a) `backtestFingerprint` **只取 `seed.fingerprint`**，不接受调用方另填 —— 权益曲线必须声明「来自哪次真实回测」，本层不推算；(b) 编排器要求 `evaluation` 消费 `backtestSummary` 交接。违反 → `BAD_REQUEST`。
2. **`backtestSummarySeed` 与链内 `backtest` 阶段互斥**（种子要求其产生阶段不在 `stageIds` 内）→ 冲突即 `BAD_REQUEST`，**不静默丢种子**。

**未注入的入参一律不注入** ⇒ 对应阶段不注册执行器 ⇒ 编排器如实 `BLOCKED`。故「UI 上点运行」永远不会得到一份凭空捏造的全绿结果。

**可复现**：`runId` 可由 `createdAt` 确定性派生（同 `createdAt` → 同 `runId`）；同输入两次运行 → `chainFingerprint` 逐位一致（有测试）。

### 18.7 前端接线（FE-4）

| 层 | 产物 |
| --- | --- |
| API | `researchRun.loopRun`（已注册 `appRouter`） |
| Adapter | `client/src/adapters/closedLoopRunAdapter.ts` |
| ViewModel | `ClosedLoopRunViewModel`（全链概要 / 计数 / 装配覆盖 / 阶段行 / 评估标量）；`closedLoopRunToRunResult(vm)` → 既有 `RunResultViewModel` |
| UI | `ClosedLoopRunResultPanel`（新）+ `RunConfigPanel`（增 `onRun`/`running`/`runError`）+ `RunWorkbenchTab`（真实接线） |

**Adapter 的零计算纪律**：

- 评估标量**只**从 `evaluation` 阶段 `EXECUTED` 的 `output`（`kind === "evaluationRef"`）直搬；三节（`performance` / `riskAdjusted` / `tradeQuality`）全缺 → 返回 `null`（**不返回「全 null 的伪标量对象」**，避免 UI 误判「有结果」）；
- 缺字段 → `null`，**不填 0、不推算**；
- 未知阶段状态 → `"UNKNOWN"`（**不猜成 `EXECUTED`**）；
- 非对象 / 无 `runId` → `null`（调用方保持空态）；
- `closedLoopRunToRunResult` 的字段对应是**改名直搬**，逐条列在代码注释里（`cagrPct → annualizedReturnPct`、`sharpeRatio → sharpe`、`completedTradeCount → tradeCount`），无换算；
- `deriveExperimentId` 只生成 **§28 谱系锚点标识符**（`EXP-YYYYMMDD-XXXXXXXX`，FNV-1a 32bit），确定性、跨运行稳定，**非业务数值**。

**按钮不再锁死**：`RunConfigPanel` 的「运行策略」由 `readiness.canRun` 门控改为「是否注入 `onRun`」门控。理由是发起的是**真实执行**——入参齐备的阶段真跑、其余如实 `BLOCKED`，本身具诊断价值；若继续用 `executorBound=false` 锁死，工作台永远是空壳。未就绪原因改在 Tooltip 提示，**不阻断发起**。

### 18.8 验收

| 项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **exit 0** |
| `server/research/closedLoopWiring/closedLoopWiring.test.ts` | **31 例全过** |
| `server/researchRunRouter.test.ts` | **17 例全过**（原 2 例 → 17 例） |
| `client/src/adapters/closedLoopRunAdapter.test.ts` | **17 例全过**（新增） |
| `client/src` 全量 | **10 文件 / 172 例全过** |
| 聚焦批次（router + wiring + dataHealth + researchEngine + researchCore + engineRouter） | **17 文件 / 276 例**，唯一失败为 §17.3 已记录的 gate 快照冲突（`dataHealth.test.ts`，非本次引入） |
| `npx vite build` | **RC=0**（2995 → **2997 modules**） |

### 18.9 本段未做（诚实边界）

- **未装配 8 阶段**（见 18.3 表；`regime` 为下一增量首选）；
- **不做数据集构建**：`data` 阶段只接受注入的真实 `ResearchDataset`（避免与 Dataset 侧隐式耦合）；因此从 UI 发起的运行在 `data` 阶段必然 `CL_DATA_NOT_INJECTED`；
- **不落库**：`loopRun` 不持久化 run 记录（是否落账由调用方决定）；
- **不触碰** `ds_*` 物理表、dataset 页面、认证快照；**未修** `dataHealth.test.ts` 的 gate 期望（数据域治理，待裁定）。

---

## 19. Incremental Run（增量补跑，RESEARCH-002B）

### 19.1 触发这个功能的问题（真实用户卡点，实录）

用户操作序列：**建 Run → 加分析 → 点「运行引擎」**（Run 变 `COMPLETED`）→ **又加了一个分析** → 找不到能跑它的按钮。

实查数据库印证了这个死结：

| 对象 | 状态 |
|---|---|
| `research_run` 180001 | `COMPLETED`（1130 样本，19:57:48→19:57:57） |
| 分析 180001 `QUANTILE` | `COMPLETED`（53 行结果） |
| 分析 180002 `EVENT_STUDY` | `PENDING`（0 行结果） |
| 分析 180003 `CONDITIONAL` | `PENDING`（0 行结果） |

两条守卫把「运行引擎」按钮锁死，且**前后端各一份**：

- 前端 `RunEngineButton.tsx`：`executable = PENDING | FAILED | CANCELLED`；
- 后端 `engine.ts`：`RUN_NOT_PENDING` ——「只有 PENDING / FAILED / CANCELLED 可执行」。

设计意图（页面文案也这么写）是「已 COMPLETED 的 Run 不会被覆盖，需要重跑请新建 Run」。**但这条路走不通**：分析挂在 `runId` 上，新建 Run 是**空容器**，而系统没有「把上一个 Run 的分析继承过来」的能力，`updateAnalysis` 也不支持改 `runId`。于是用户被夹在中间 —— 这正是本段要补的能力。

### 19.2 语义选择：为什么不是「允许 COMPLETED 重跑」

最直觉的修法（放开 `COMPLETED` 允许重跑）被否决，因为 `engine.run()` 是**整轮执行**：它 `for (const analysis of analyses)` 遍历该 Run 下**全部**分析，且 `resetExistingResults = true` 会先删旧结果再写新的。放开守卫等于让「加一个分析」变成「悄悄重写全部已有结果」，破坏「结果不可覆盖」。按铁律的优先级（正确性 > 数据真实性 > PIT > **可复现性**），这条路不可取。

最终选定**增量补跑**：只补算「尚无有效结果」（`PENDING / FAILED / CANCELLED`）的分析，**不重跑已完成的**。

### 19.3 三条硬约束（缺一即不成立）

**① 基准必须冻结复用。** `Dataset Version + 日期窗口` 一律取自 `run.inputSnapshot`，**不取** Experiment / Run 的当前配置。理由：`buildSampleSet` 的事件集只由「Dataset Version + 日期窗口」决定（它**不按条件过滤事件**，变量只是投影列），所以复用冻结窗口 ⇒ 补跑结果与原批次**同一基准、可比**。

> 这条有回归测试守着：整轮执行后把 Run 配置的日期窗口改到一个**不可能有事件**的区间（2099 年），再补跑 —— 若实现错误地读「当前配置」，会装配出 0 个样本直接 `EMPTY_SAMPLE_SET`；实得 `sampleCount` 与原批次一致。

变量投影 = 原批次并集 ∪ 目标分析需求（并上新变量不改变事件集，只加列）。快照缺失 / `datasetVersionId` 不可用 → `RUN_SNAPSHOT_MISSING`，**不猜一个基准出来**。

**② 增量事实必须显式落库。** `inputSnapshot` 的语义由 RESEARCH-001 定死为「执行时真实落定的快照，**事后不得修改**」，所以不能往里写。新增 `research_run.executionLogJson`（与 `configJson` / `inputSnapshotJson` 同风格的**追加式**批次日志），每批一条：

```ts
{ sequence, mode: "FULL" | "INCREMENTAL", analysisIds, sampleCount, status, startedAt, completedAt, errorCode?, conclusionSkippedReason? }
```

不记这笔，读者会把「一条 Run 分 2 批跑了 3 个分析」误读成「只跑过一批」——那是静默不实。

**版本边界（如实声明，不 backfill）**：本列生效**之前**已存在的 Run，其 batch 1（整轮）只体现在 `inputSnapshot` 里，日志自 batch 2 起。`nextExecutionSequence()` 因此有条规则：**日志为空但快照存在 ⇒ 下一批是 2**，不伪造一条 batch 1。

**③ 增量批次不生成结论 —— 且原因是可证明的，不是偷懒。** 结论需要该 Run **全部**分析的 `AnalysisSummary`；而 `AnalysisSummary`（effect / pValue / tStat / directionConsistency…）是**执行期产物、未落库**，`research_result` 里也没有（`diagnostics` 明确不落 `result_json`）。因此 `runIncremental` 无法重建**已跳过**分析的历史摘要 ⇒ 拼不出完整结论。返回 `conclusionId = null` + `conclusionSkippedReason`，并**保留**既有结论不动（其证据未被改写）。

### 19.4 实现清单

| 层 | 文件 | 内容 |
|---|---|---|
| DB | `drizzle/0032_research_run_execution_log.sql` | `ALTER TABLE research_run ADD COLUMN IF NOT EXISTS executionLogJson longtext NULL`（TiDB 支持且幂等，已实测） |
| DB | `scripts/applyResearchRunExecutionLog.mjs` | apply + 17 项断言（列存在/类型/可空 + 12 个既有列未动 + 行数与逐行数据不变断言） |
| 领域 | `server/researchCore/executionLog.ts` | 结构校验（非法**响亮失败**，不降级成空数组）、`nextExecutionSequence`、`appendExecutionLogEntry`、`settleExecutionLogEntry`（后两者返回新数组，不就地改） |
| 领域 | `types.ts` / `repository/db.ts` / `repository/inMemory.ts` | `ResearchRunExecutionLogEntry` 类型 + 双向映射（内存替身做**深拷贝**，阻断调用方持引用改写内部状态） |
| 引擎 | `server/researchEngine/engine.ts` | 抽出共用执行核心（`buildCatalog` / `loadConditionSets` / `resolveAnalyses` / `executeAnalyses`）；`run()` 追加 batch 1；新增 `runIncremental()` |
| 路由 | `server/researchEngineRouter.ts` | `researchEngine.runIncremental`（adminProcedure）；新错误码映射（`RUN_ALREADY_RUNNING` / `ANALYSIS_NOT_RUNNABLE` / `NO_RUNNABLE_ANALYSES` / `DATASET_VERSION_DRIFT` → CONFLICT；`RUN_SNAPSHOT_MISSING` → PRECONDITION_FAILED；`ANALYSIS_NOT_IN_RUN` → BAD_REQUEST） |
| 前端 | `components/research/incrementalRunForm.ts` | **纯函数**门禁：什么时候能补跑、不能补跑时**具体原因**是什么 |
| 前端 | `components/research/RunIncrementalButton.tsx` | 分析行内「补跑」按钮（带禁用原因 tooltip + 执行证据弹窗 + 「本批次不生成结论」明示） |
| 前端 | `components/research/RunExecutionBatches.tsx` | Run 卡片的「执行批次」表 |
| 前端 | `adapters/researchEngineAdapter.ts` | `RunRowVm` 增加 `hasInputSnapshot`（派生布尔，**不把裸 `unknown` 快照漏给视图层**）与 `executionLog` 归一 |
| 前端 | `RunEngineButton.tsx` | Run 已 COMPLETED 且有待补跑分析时，tooltip 直接指出「请点行内『补跑』」而非只说状态不允许；并补 `getAnalysisResults` / `listConclusions` 缓存失效 |

### 19.5 增量补跑的状态与终态规则

| 维度 | 规则 |
|---|---|
| 预检（Run） | 存在、属于该 Experiment、`status !== RUNNING`（`RUN_ALREADY_RUNNING`） |
| 预检（基准） | `inputSnapshot` 可用且 `datasetVersionId === experiment.datasetVersionId`（否则 `DATASET_VERSION_DRIFT`，防御性断言——正常路径下 experiment 的 `datasetVersionId` 创建即冻结不可改） |
| 预检（目标） | 非空（`NO_RUNNABLE_ANALYSES`）；每个 id 属于该 Run（`ANALYSIS_NOT_IN_RUN`）；状态 ∈ PENDING/FAILED/CANCELLED（`ANALYSIS_NOT_RUNNABLE`） |
| 执行中 | `run.status = RUNNING`、`experiment.status = RUNNING`，日志追加 `RUNNING` 条目 |
| 成功 | 该 Run 全部分析 COMPLETED ⇒ Run `COMPLETED`；否则 Run `PENDING`（还有活没干）。Experiment 同理：全完成 → `COMPLETED`，否则**回滚到补跑前的状态**（不臆造新状态） |
| 失败 | Run `FAILED` + `errorCode` / `errorMessage`（沿用既有「失败必落库」纪律）；批次条目**收敛为 FAILED**（不留 `RUNNING` 悬挂）；Experiment 回滚到补跑前的状态；**此前批次的结果原样保留** |
| 批次号 | 单调递增、不跳号；**失败批次也占用序号**（`1 COMPLETED / 2 FAILED / 3 COMPLETED`），可重入 |

**删分析的悬空引用（刻意保留）**：`deleteAnalysisCascade` **不**清理 `executionLog` 里引用该 analysisId 的历史条目。批次日志是追加式的历史事实（「第 2 批当时执行了这些分析」），删掉分析不会让这条历史变假；反过来改写条目才会破坏 append-only 可追溯纪律。消费方需容忍「日志里的 id 查不到分析」。

### 19.6 验收

见 §19.7 与附录 B 的复现命令。

### 19.7 验收结果

| 项 | 结果 |
|---|---|
| `node scripts/applyResearchRunExecutionLog.mjs` | **PASS** — 17 项断言，0 失败（含「既有 Run 的 status / inputSnapshot / sampleCount 逐行不变」） |
| `executionLog.test.ts`（新增） | **18 例通过** |
| `engineIncremental.test.ts`（新增） | **14 例通过** |
| `incrementalRunForm.test.ts`（新增） | **12 例通过** |
| `researchEngineRouter.test.ts` | 29 → **32 例通过**（新增 3 例：真实路由补跑链路、无快照 → PRECONDITION_FAILED、已完成/无可补跑 → CONFLICT） |
| `server/researchEngine` + `server/researchCore` | **234 例全过**（重构 `run()` 抽出共用核心后零回归） |
| `verifyResearchEngine.mts --all`（真实 TiDB） | 见 §12 / 附录 B |

### 19.8 本段未做（诚实边界）

- **增量不刷新结论**（原因见 19.3③）。要产出反映全部分析的新结论，需**整轮重跑**或新建 Run。若将来要支持「增量后重建结论」，前置条件是**把 `AnalysisSummary` 落库**（新增列或表），使已跳过分析的历史摘要可重建 —— 这是本段刻意留下的下一个增量；
- **不 backfill 历史批次**：本列生效前的 Run 其 batch 1 只体现在 `inputSnapshot` 中；
- **未加并发锁**：`RUN_ALREADY_RUNNING` 是**读-判-写**，不是原子占位；两个并发请求理论上仍可同时通过（这与既有整轮 `runEngine` 的并发特性同源，不是本段引入的新类别）；
- **未触碰** Dataset 侧（`ds_*` 物理表、dataset 页面、认证快照）。

---

## 20. Batch Analysis Authoring（批量建分析，RESEARCH-002C）

### 20.1 触发这个功能的问题（真实用户卡点，实录）

引擎能跑之后，用户的下一句原话是：

> 「现在初步看起来分析研究是能用了，但是我需要手动建立很多分析，有没有什么办法可以减少这个过程」

「重复劳动」有两个来源，且**互相叠加**：

1. **服务端一次只收一个分析**：`createAnalysis` 的入参是单个 `createAnalysisItemSchema`，前端特征 / 目标 / 视界均为**单选**控件；
2. **建完还要单独点「补跑」**：`createRun` 只创建不执行，且没有 worker 消费 `PENDING` Run；`RUN_NOT_PENDING` 守卫又禁止覆盖 `COMPLETED`，所以新增分析必须走 `runIncremental`。

于是「5 个特征 × 3 个视界 + 1 个稳定性 × 3 维度」这类组合，现状是 **N 轮表单往返 + N 次补跑**。

> **本次范围界定（用户拍板）**：只做 A / B / D 三条路线（矩阵 / 标准套件 / 跨实验模板），
> 且 **只创建、不自动补跑** —— 建完由用户自己点「补跑」。C 路线（复制已有分析）本次不做。

### 20.2 三条交付路线

| 路线 | 交互 | 落点 |
|---|---|---|
| **A. 批量矩阵创建** | 勾分析类型 × 填特征/多目标/多视界 → 一次提交展开成 N 个分析 | `BatchAnalysisDialog`「矩阵展开」Tab |
| **B. 一键标准研究套件** | 选特征 + 目标 → 一键铺开「描述 + 分位 + 条件 + 事件 + 稳定性」 | 同对话框「标准套件」Tab |
| **D. 跨实验分析模板** | 把当前这批分析存成命名模板，在别的 Run 上「一键铺开」 | 同对话框「我的模板」Tab + 4 个模板端点 |

**关键架构决策 —— 三条路线共用同一条落库路径：**

- 标准套件**不另写生成逻辑**，它只是「用预设值填 `BatchMatrixFormState`」，交给与矩阵**同一个** `expandAnalysisMatrix` 展开。避免出现「套件的口径」与「矩阵的口径」两套实现、日后悄悄分叉。
- 模板展开（`applyAnalysisTemplate`）与矩阵批量**都调用 `createAnalysesBatch`**，因此预检整批拒绝 / 部分失败如实回显 / 失败补偿删除**自动继承**，不需要在模板侧重复实现一遍。

### 20.3 两条设计纪律（错了就会留下半成品）

1. **预检整批拒绝，不产半成品**：`assertBatchCreateItems` 在写库**之前**跑完 `preflightBatchCreateItems`，任一项不合法即 `BATCH_VALIDATION_FAILED`，**一个都不建**（消息显式写明「未创建任何分析」+ 前 10 项明细），用户修完再提交。空批次 / 名称空或超 200 / 类型未实现 / CONDITIONAL 缺有效条件，都属此类。
2. **执行期部分失败如实回显 + 补偿删除**：逐项 `analyses.create` → 条件走 `conditions.replaceForAnalysis`。某项中途失败时**补偿删除**刚建的分析（先删条件再删分析），并计入 `failed`（带 `index` + 原始错误消息）。补偿本身再失败时**如实标注**「⚠️ 回滚该项失败：…」，绝不静默吞掉。因此 `created` 列表里的每一项都保证「**有 id 就能跑**」。

### 20.4 刻意不重复实现条件结构校验

组的连续性 / 组内 `sortOrder` 唯一 / 值的元数等**结构性**合法性，唯一权威是 `assertConditionSet`（由 `conditions.replaceForAnalysis` 在写入时执行）。批量路径**只做预检级别的「有没有条件」判断**（`fieldName.trim() !== ""`），不去重造第二份结构校验 —— 否则两份规则迟早不一致。

### 20.5 模板的形状（两表而非单 JSON）

沿用 DATASET-003B 的纪律，模板用**头 + 明细两表**（`research_analysis_template` / `research_analysis_template_item`）而非单 JSON 列：

- 明细需要**确定性顺序**（复现性）+ 可索引检索；头表需要**唯一约束**（名字是「一键铺开」的不歧义引用基础）。

**唯一例外**：明细的**条件**用 `conditionsJson`（配置快照）—— 它既不需要被索引、也不需要唯一约束，为它再建第三张表只会让模板读取变成三表 join。**口径不降级**：展开成真分析时，条件**仍写 `research_analysis_condition` 关系表**。

### 20.6 错误码与映射

新增 5 个领域错误码，路由映射如下：

| 错误码 | tRPC code | 触发 |
|---|---|---|
| `BATCH_VALIDATION_FAILED` | `BAD_REQUEST` | 批量预检未通过（整批拒绝） |
| `BATCH_TOO_LARGE` | `BAD_REQUEST` | 单批超 `MAX_BATCH_CREATE_ITEMS`（200） |
| `TEMPLATE_NOT_FOUND` | `NOT_FOUND` | apply / delete 的模板不存在 |
| `TEMPLATE_NAME_CONFLICT` | `CONFLICT` | 模板名已存在 |
| `TEMPLATE_VALIDATION_FAILED` | `BAD_REQUEST` | 模板内容非法 / 明细为空 |

### 20.7 新增端点

| 端点 | 鉴权 | 说明 |
|---|---|---|
| `researchEngine.createAnalyses` | admin | 批量建分析（`{ runId, items[] }`），**只创建不执行** |
| `researchEngine.listAnalysisTemplates` | **public** | 列出全部模板（含明细，不分页） |
| `researchEngine.createAnalysisTemplate` | admin | 存模板（重名 → `CONFLICT`） |
| `researchEngine.deleteAnalysisTemplate` | admin | 删模板（显式先删明细） |
| `researchEngine.applyAnalysisTemplate` | admin | 模板展开成某 Run 下的批量分析（**不自动执行**） |

`createAnalysisItemSchema` 被**单建与批量共用**，避免两处 schema 漂移。

### 20.8 验收结果

| 项 | 结果 |
|---|---|
| `node scripts/applyResearchAnalysisTemplate.mjs` | **PASS** — 34 项断言，0 失败（列 / 类型 / `varchar(120)` / 唯一约束 / 索引 / 零外键 + 10 张既有 research 表行数不变）；`--check` 幂等重放 PASS |
| `batchCreate.test.ts`（新增） | **16 例通过**（预检 / 上限 / 补偿删除 / 回滚失败如实标注 / 边界不误伤） |
| `analysisBatchForm.test.ts`（新增，前端） | **27 例通过**（矩阵基数 / 不静默少建 / 上限截断 / payload / 套件 / 模板预览 / 校验） |
| `inMemory.test.ts` | 32 → **38 例**（新增模板仓储 6 例：排序 / trim / 重名 / list / 先删明细 / 深拷贝隔离） |
| `researchEngineRouter.test.ts` | 32 → **43 例**（端点契约 + anon 鉴权 + 批量建分析 5 例 + 模板 6 例） |
| 聚焦回归（25 文件） | **450 例全过** |
| `npx tsc --noEmit` | **exit 0** |

### 20.9 实现过程中发现并修复的缺陷

**路由错误码映射漏接（2 例失败暴露）**：`createAnalysisTemplate` / `deleteAnalysisTemplate` / `applyAnalysisTemplate` 里 `throw new ResearchEngineError(...)` **直接抛**，没走 `toTrpcError`。tRPC 不自动映射领域错误 ⇒ 一律落 `INTERNAL_SERVER_ERROR`。修法：把这几处 `throw` 改为 `toTrpcError(new ResearchEngineError(...))`，与文件内其余 9 个 catch 分支的既有约定对齐。**教训**：新增端点时，领域错误只能在 catch 里 `toTrpcError(e)`，或显式 `toTrpcError(new ...)` —— 直接 `throw` 领域错误不改 tRPC code。

### 20.10 本段未做（诚实边界）

- **不自动补跑**（用户明确选择「只创建，我自己点补跑」）：批量建完仍是 `PENDING`，需显式触发整轮执行或增量补跑；
- **不做 C 路线（复制已有分析）**：方案里已说明其价值与成本，本次未选；
- **不触碰** Dataset 侧（`ds_*` 物理表、dataset 页面）。

---

## 附录 A：新增/修改文件清单

**新增（实现）**
```
server/researchEngine/types.ts                 265
server/researchEngine/errors.ts                 39
server/researchEngine/variables.ts             548   ← PIT 防火墙 + 变量目录
server/researchEngine/metrics.ts               422   ← 指标唯一实现
server/researchEngine/conditionEvaluator.ts    133
server/researchEngine/datasetReader.ts         255
server/researchEngine/sampleSet.ts             191
server/researchEngine/analysisConfig.ts        165
server/researchEngine/conclusion.ts            268
server/researchEngine/engine.ts                417   ← 10 步编排
server/researchEngine/testFixtures.ts          188
server/researchEngine/index.ts                  32
server/researchEngine/analyses/helpers.ts       76
server/researchEngine/analyses/descriptive.ts  160
server/researchEngine/analyses/eventStudy.ts   237
server/researchEngine/analyses/quantile.ts     247
server/researchEngine/analyses/conditional.ts  257
server/researchEngine/analyses/stability.ts    178
server/researchEngine/analyses/registry.ts      65
server/researchEngine/analyses/index.ts         13
server/researchEngineRouter.ts                 428
server/researchEngine/index.ts             → total 4,156（实现）/ +428（API）
```

**新增（测试 / 脚本）**
```
server/researchEngine/metrics.test.ts           126
server/researchEngine/variables.test.ts         106
server/researchEngine/pit.test.ts               119
server/researchEngine/conditionEvaluator.test.ts 133
server/researchEngine/conclusion.test.ts        124
server/researchEngine/engine.test.ts            380
server/researchEngine/analyses/analyses.test.ts 434
server/researchEngineRouter.test.ts             429
scripts/verifyResearchEngine.mts                529
scripts/checkResearchWorkbenchApi.mts           只读真实 DB 契约核对（24 断言）
docs/research/RESEARCH-002-e2e-evidence.json
docs/research/RESEARCH-002-report.md            （本文）
```

**新增（前端工作台，§16）**
```
client/src/adapters/researchEngineAdapter.ts                 展示契约层（DTO → VM）
client/src/adapters/researchEngineAdapter.test.ts      26 例
client/src/components/research/createExperimentForm.ts       表单纯函数
client/src/components/research/createExperimentForm.test.ts  16 例
client/src/components/research/createAnalysisForm.ts         表单纯函数（含条件构造）
client/src/components/research/createAnalysisForm.test.ts    31 例
client/src/components/research/CreateExperimentDialog.tsx
client/src/components/research/CreateAnalysisDialog.tsx
client/src/components/research/AnalysisResultsView.tsx
client/src/components/research/ConclusionPanel.tsx
client/src/components/research/RunEngineButton.tsx
client/src/components/research/VariableCatalogCard.tsx
client/src/components/research/index.ts
client/src/pages/research/ResearchList.tsx
client/src/pages/research/ResearchDetail.tsx
client/src/pages/research/index.ts
```

**新增（RESEARCH-002A 维护层 + 工作台可维护性，§17）**
```
server/researchEngine/maintenance.ts                        465  ← 级联删除 + 失效标记（领域规则）
server/researchEngine/maintenance.test.ts                   431 / 19 例
client/src/components/research/ConditionGroupsEditor.tsx    275  ← 共享条件组编辑器
client/src/components/research/ConfirmDeleteButton.tsx       99  ← 统一破坏性确认（后果清单 + 真实计数回显）
client/src/components/research/ExperimentActions.tsx        158  ← 实验重命名 / 级联删除
client/src/components/research/AnalysisConditionEditor.tsx   186  ← 编辑既有条件（替换 + 失效）
client/src/components/research/CandidatesPanel.tsx           84  ← 候选 Tab（诚实空态）
```

**新增（RESEARCH-002A · D 段）**
```
server/research/closedLoopWiring/types.ts            闭环装配入参 / 来源 / 产物旁路 / 覆盖率形状
server/research/closedLoopWiring/requirements.ts     14 阶段装配声明表（唯一权威；含未装配原因）
server/research/closedLoopWiring/coverage.ts         assessClosedLoopWiringCoverage（纯函数，零 IO）
server/research/closedLoopWiring/executors.ts        6 个真实阶段执行器 + 装配工厂
server/research/closedLoopWiring/index.ts            出口
server/research/closedLoopWiring/closedLoopWiring.test.ts          28 → 31 例
client/src/adapters/closedLoopRunAdapter.ts          闭环结果 → ViewModel（零计算）
client/src/adapters/closedLoopRunAdapter.test.ts     17 例
client/src/components/strategy/ClosedLoopRunResultPanel.tsx  运行结果面板（概要 + 标量 + 轨迹）
```

**修改（RESEARCH-002A · D 段）**
```
server/researchRunRouter.ts        ~ executorBound 由硬编码 false 改为真实探测（assessClosedLoopWiringCoverage）
                                   + readiness 输出 wiring 明细；未就绪措辞改为点名缺口阶段
                                   + 新增 loopRun（mutation）：createClosedLoopWiring → runClosedLoop
                                   + 两条防伪绑定（evaluationInput↔seed 成对；seed↔链内 backtest 互斥）
server/researchRunRouter.test.ts   2 → 17 例（readiness 真实探测 + loopRun 真跑/阻塞/可复现/契约）
shared/researchContracts.ts        + CLOSED_LOOP_STAGE_ID_VALUES（契约单测守护）
                                   + closedLoopWiringSummarySchema / closedLoopDateRangeSchema
                                   + closedLoopBacktestSummarySeedSchema / closedLoopLifecycleInputSchema
                                   + closedLoopRunInputSchema / closedLoopRunResultSchema
                                   ~ researchRunReadinessSchema + wiring 字段
                                   ~ 区块按依赖顺序拆分（修 3 处 block-scoped 前向引用）
client/src/components/strategy/RunConfigPanel.tsx   + onRun / running / runError；按钮不再被 canRun 锁死
client/src/components/strategy/index.ts             + ClosedLoopRunResultPanel 导出
client/src/pages/StrategyEditor.tsx                 ~ RunWorkbenchTab 由 emptyRunResult() 占位改真实接线
client/src/lib/status.ts                            + 闭环语义色（EXECUTED/BLOCKED/ALL_EXECUTED/PARTIAL_BLOCKED/NO_STAGE_EXECUTED）
```

**修改（RESEARCH-002A）**
```
server/researchEngine/types.ts           + DELETE_CONFLICT 错误码
server/researchEngine/index.ts           + export * from "./maintenance"
server/researchEngineRouter.ts           + 7 个维护端点（update/delete × Experiment/Hypothesis/Run/Analysis）
                                         + HYPOTHESIS_NOT_FOUND / ANALYSIS_NOT_FOUND → NOT_FOUND
                                         + DELETE_CONFLICT → CONFLICT
                                         ~ setAnalysisConditions 改为「替换 + 让旧产物失效」
server/researchEngineRouter.test.ts      + 7 端点契约 + 维护端点鉴权 + 「替换后旧产物失效」改写
client/src/components/research/createAnalysisForm.ts
                                         + conditionGroupsToPayload（组号连续化，修断号缺陷）
                                         + conditionPayloadToDraftGroups / validateConditionGroups
client/src/components/research/createAnalysisForm.test.ts   31 → 44 例（含往返幂等 + 组号连续性）
client/src/components/research/CreateAnalysisDialog.tsx     改用共享编辑器，移除内联条件 UI
client/src/components/research/ConclusionPanel.tsx          + 结论 JSON 导出（显式标注为接口快照）
client/src/components/research/index.ts                     + 5 个导出
client/src/pages/research/ResearchDetail.tsx                + 实验操作 / Run 删除 / 分析编辑与删除 / 候选 Tab
```

**修改（增量，向后兼容）**
```
server/datasetRegistry/query.ts       + 批量读取（loadOutcomesBatch / loadPathsBatch /
                                        loadRawBarsBatch / getPathRelativeDayRange）
server/researchCore/results.ts        + RESEARCH-002 指标码；scalarResult 支持 metricValue=null
server/researchCore/config.ts         + ResolvedAnalysisConfig（修掉 optional 类型漏洞）
server/researchEngine/conclusion.ts   + 抽出 buildEvidence() 单一构造入口（修 evidence 两分支形状不一致）
server/researchEngine/conclusion.test.ts  + 1 例锁定 evidence 形状一致
server/routers.ts                     + 注册 researchEngine 路由（2 行）
client/src/lib/status.ts              + Research 状态色（TESTING/SUPPORTED/PARTIALLY_SUPPORTED/FINAL/SUPERSEDED）
client/src/App.tsx                    + /research 与 /research/:experimentId 路由
client/src/components/AppShell.tsx    + 侧边栏「研究实验」入口
```

**新增（增量补跑 · RESEARCH-002B）**
```
drizzle/0032_research_run_execution_log.sql                      research_run 追加 executionLogJson
scripts/applyResearchRunExecutionLog.mjs                         apply + 17 项断言（幂等 / --dry-run / --check）
server/researchCore/executionLog.ts                              执行日志纯函数（校验 / 批次号推进 / append / settle）
server/researchCore/executionLog.test.ts                         18 例
server/researchEngine/engineIncremental.test.ts                  14 例（6 个 describe）
client/src/components/research/incrementalRunForm.ts             补跑门禁纯函数（enabled / reason / hint / 可补跑计数）
client/src/components/research/incrementalRunForm.test.ts        12 例
client/src/components/research/RunIncrementalButton.tsx          分析行内「补跑」按钮（禁用原因 + 执行证据 + 未生成结论提示）
client/src/components/research/RunExecutionBatches.tsx           Run 卡片「执行批次」表 + skippedConclusionNotes()
```

**修改（增量补跑 · RESEARCH-002B）**
```
drizzle/schema.ts                       + researchRun.executionLogJson（longtext，附口径注释）
server/researchCore/types.ts            + ResearchRunExecutionMode / ExecutionStatus / ExecutionLogEntry
                                        ~ ResearchRun + executionLog
server/researchCore/index.ts            + export * from "./executionLog"
server/researchCore/repository/db.ts           ~ mapRun / create / update 支持 executionLog
server/researchCore/repository/inMemory.ts     ~ 执行日志一律深拷贝返回（阻断外部改写内部状态）
server/researchEngine/types.ts          + 7 个错误码 + IncrementalInput / IncrementalResult
server/researchEngine/engine.ts         ~ 抽出 buildCatalog / loadConditionSets / resolveAnalyses /
                                          executeAnalyses 四个共用核心，run() 与 runIncremental() 共用
                                        + runIncremental()（复用冻结基准 / 只补跑可跑分析 / 不建结论）
server/researchEngine/maintenance.ts    + 注释：刻意不清理日志中悬空 analysisId（append-only 纪律）
server/researchEngineRouter.ts          + runIncremental 端点 + 4 个错误码映射（CONFLICT / PRECONDITION_FAILED / BAD_REQUEST）
server/researchEngineRouter.test.ts     29 → 32 例
client/src/adapters/researchEngineAdapter.ts  + RunExecutionBatchVm / toExecutionLogVm()；RunRowVm + hasInputSnapshot / executionLog
client/src/components/research/RunEngineButton.tsx   + runnableAnalysisCount；COMPLETED 时指向行内「补跑」；Tooltip + 缓存失效
client/src/components/research/index.ts              + 4 个导出
client/src/pages/research/ResearchDetail.tsx         + 行内「补跑」按钮 + Run 卡片「执行批次」区块
docs/research/RESEARCH-002-report.md                 + §19（19.1–19.8）
```

**新增（批量建分析 · RESEARCH-002C）**
```
drizzle/0033_research_analysis_template.sql                     模板头 + 明细两表 + 2 索引（含口径注释）
scripts/applyResearchAnalysisTemplate.mjs                       apply + 34 项断言（幂等 / --dry-run / --check）
server/researchEngine/batchCreate.ts                            批量预检 + 整批拒绝 + 补偿删除（单一落库路径）
server/researchEngine/batchCreate.test.ts                       16 例（6 个 describe）
server/researchEngine/templates.ts                              模板 Draft 校验 + 明细 ⇄ 批量项双向转换
client/src/components/research/analysisBatchForm.ts             矩阵展开 / 标准套件 / 模板预览 / 校验（纯函数）
client/src/components/research/analysisBatchForm.test.ts        27 例
client/src/components/research/BatchAnalysisDialog.tsx          三 Tab 批量建分析对话框（建前摊开清单）
```

**修改（批量建分析 · RESEARCH-002C）**
```
drizzle/schema.ts                            + researchAnalysisTemplate / researchAnalysisTemplateItem（+ 4 个类型导出）
server/researchEngine/types.ts               + 5 个错误码 + ResearchBatchAnalysisItem / ResearchBatchCreateResult
server/researchEngine/index.ts               + export * from "./batchCreate" / "./templates"
server/researchCore/types.ts                 + ResearchAnalysisTemplate（Item）—— 含「条件为何允许 JSON」注释
server/researchCore/repository/contract.ts   + ResearchAnalysisTemplateRepository / Input；ResearchRepositories + templates
server/researchCore/repository/db.ts         + templates 实现（loadTemplateItems 批量取明细避免 N+1；删模板先删明细）
server/researchCore/repository/inMemory.ts   + cloneJson 深拷贝；templates 实现（列表按 name 排序）
server/researchCore/repository/errors.ts     + TEMPLATE_NOT_FOUND 引用错误
server/researchCore/repository/inMemory.test.ts  32 → 38 例
server/researchEngineRouter.ts               + createAnalyses + 4 个模板端点；createAnalysisItemSchema 单建/批量共用
                                             ~ 4 处「直接 throw 领域错误」改为 toTrpcError（修错误码漏映射）
server/researchEngineRouter.test.ts          32 → 43 例
client/src/adapters/researchEngineAdapter.ts + AnalysisTemplateVm / toAnalysisTemplateVm(s)；+ 5 条错误提示
client/src/components/research/index.ts      + analysisBatchForm / BatchAnalysisDialog 导出
client/src/pages/research/ResearchDetail.tsx ~ 分析卡片并列「新建分析」与「批量建分析」
docs/research/RESEARCH-002-report.md         + §20（20.1–20.10）
```

## 附录 B：复现命令

```bash
# 1) 类型检查
npx tsc --noEmit

# 2) 引擎 + API 测试
npx vitest run server/researchEngine server/researchEngineRouter.test.ts

# 2b) 维护层（级联删除 / 失效标记）+ 工作台前端
npx vitest run server/researchEngine/maintenance.test.ts client/src/components/research

# 2c) 聚焦全链路回归（RESEARCH-002A 验收口径，19 文件 / 326 例）
npx vitest run client/src/components/research client/src/adapters \
  server/researchEngine server/researchEngineRouter.test.ts server/researchCore

# 2d) D 段：闭环装配 + router + 前端 adapter（17 例 + 31 例 + 17 例）
npx vitest run server/research/closedLoopWiring server/researchRunRouter.test.ts \
  client/src/adapters/closedLoopRunAdapter.test.ts

# 2e) D 段聚焦批次（17 文件 / 276 例；唯一失败为 gate 快照冲突，非本段引入）
npx vitest run server/researchRunRouter.test.ts server/research/closedLoopWiring \
  server/dataHealth.test.ts server/researchEngine server/researchCore \
  server/researchEngineRouter.test.ts

# 2f) 增量补跑（RESEARCH-002B）：执行日志 + 引擎 + 路由 + 前端门禁
node scripts/applyResearchRunExecutionLog.mjs         # apply，17 项断言
npx vitest run server/researchCore/executionLog.test.ts server/researchEngine/engineIncremental.test.ts \
  server/researchEngineRouter.test.ts client/src/components/research/incrementalRunForm.test.ts

# 2g) 批量建分析（RESEARCH-002C）：迁移 + 引擎 + 仓储 + 路由 + 前端纯函数
node scripts/applyResearchAnalysisTemplate.mjs        # apply，34 项断言（--check 幂等重放）
npx vitest run server/researchEngine/batchCreate.test.ts server/researchCore/repository/inMemory.test.ts \
  server/researchEngineRouter.test.ts client/src/components/research/analysisBatchForm.test.ts

# 3) 真实 Dataset 端到端验收（默认跑完清理；--keep 保留落库数据）
npx tsx scripts/verifyResearchEngine.mts              # 仅 QUANTILE（§15 验收案例）
npx tsx scripts/verifyResearchEngine.mts --all        # 5 类分析全跑
npx tsx scripts/verifyResearchEngine.mts --all --keep # 保留数据便于人工核查
npx tsx scripts/verifyResearchEngine.mts --version=390001
```

## 附录 C：RESEARCH-002A 的边界声明（不做什么）

本节（§17 / §18）严格限定在「**代码**」范围内，以下**明确未做**，且不是遗漏：

- **不触碰 `ds_*` 物理表**、不重建 dataset version、不动 `datasetRegistry` 的筛选口径；
- **不动 dataset 页面**（`client/src/pages/dataset/**`、dataset 组件、Dataset Registry 相关 UI）；
- **不改 `docs/researchReadyGate/research_ready_gate.json`**：该快照已 `researchReady=true`，与 `dataHealth` 既有期望相反（§17.9 / §18.9）。**改快照或改测试都属于用动作掩盖状态**，需先决策「快照是否该重认证」；
- **`data` 阶段不构建数据集**（§18.9）：只接受调用方注入的真实 `ResearchDataset`，避免与 Dataset 侧隐式耦合 ⇒ 从 UI 发起的运行在 `data` 阶段必然 `CL_DATA_NOT_INJECTED`（这是如实状态，不是缺陷）；
- **`loopRun` 不落库**：不持久化 run 记录、不推进生命周期状态（`lifecycle` 仅作为 finalize 阶段的**意图入参**交给编排器，是否落账由调用方决定）；
- **未装配 8 个阶段**（§18.3 表）：这些阶段在本层**没有执行器**，编排器会如实 `CL_RUNNER_NOT_INJECTED`；其中 `regime` 为下一增量首选。
