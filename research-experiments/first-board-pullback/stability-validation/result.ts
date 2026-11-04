/**
 * EXP-002 · `first-board-pullback/stability-validation` —— 结果结构与组装。
 *
 * | 文件 | 回答的问题 |
 * | --- | --- |
 * | `experiment.ts` | 稳定性验证**研究什么、怎么算**（取数 + 逐变体重算 + 调用跨阶段 Robustness 核心） |
 * | `result.ts` | 结果**长什么样**（自有 schema + 表格 / 统计 / 图表 / 产物组装） |
 *
 * ## 这个实验在验证什么
 *
 * EXP-001（`first-board-pullback/fundamental-study`）给出了「首板后 T+1…T+20 的路径统计」，
 * 但它**只回答了一次**：在**一组**默认研究条件下（默认观察日 / 默认视界 / 全部样本）
 * 结论长什么样。研究结论要能用，还必须回答：**换一组同样合理的条件，结论会不会变？**
 *
 * 这正是 `ROBUSTNESS-CROSS-STAGE-001` 审计认定的跨阶段通用方法：
 *
 * ```text
 * Baseline → 改变合理条件 → 重新计算 → 比较 → 判断稳定性
 * ```
 *
 * 于是 EXP-002 **复用既有 Robustness 方法**（不新写一套研究侧引擎），把三个维度铺成一个矩阵：
 *
 * | 维度 | 变体 |
 * | --- | --- |
 * | `observationDay`（决策时点 T+k） | k = 1…5 |
 * | `evaluationHorizon`（未来评价窗口 T+h） | h = 5 / 10 / 20 |
 * | `sampleCondition`（样本条件） | 全部 / 不破开盘价 / 破开盘价 / 回撤深度 6 桶 |
 *
 * ## 三个红线（规格 §12 / §17 / §9）
 *
 *   1. **真重算**：每个变体都从 Dataset 的原始行情**重新筛选 / 重新聚合 / 重新算指标**；
 *      **绝不**读 EXP-001 的 `result.json` 做差、也绝不只改标签；
 *   2. **不伪造**：「算不出来」走 `unavailable` + 原因，**不得**用 0 兜底；
 *   3. **口径不重复定义**：条件与派生量的定义**复用 EXP-001 的实现**
 *      （`deriveSample` / `buildDrawdownBuckets` / `isValidOhlc`），
 *      本文件只负责「把变体铺开、把账记清、把结果画出来」。
 */

import { z } from "zod";
import type {
  ExperimentCell,
  ExperimentResultPayload,
  ExperimentResultTable,
} from "@shared/researchExperimentsContracts";
import type {
  MetricComparisonSpec,
  RobustnessDimension,
  RobustnessVariantItem,
} from "@experiments/robustnessBridge";
import {
  DECLARED_POST_RELATIVE_DAYS,
  MAX_DECLARED_POST_RELATIVE_DAY,
  buildArtifacts,
  deriveSample,
  type StudyArtifactFile,
  type StudyBar,
  type StudySample,
  type StudyTable,
  type StudyTableColumn,
  type SampleDerived,
} from "../fundamental-study/result";

/**
 * 计算口径版本 —— 改任何一处计算 / 变体定义 / 容差声明都要升它。
 * 它同时进 `descriptor.version` 与 `customPayload.computationVersion`（后者是 `z.literal`），
 * 只改一处 ⇒ `resultSchema` 立刻校验失败。
 */
export const COMPUTATION_VERSION = "1.0.0";

/** 本实验的全局唯一 id（= `descriptor.id` = 目录路径）。 */
export const EXPERIMENT_CODE = "first-board-pullback/stability-validation";

/** 数据坐标：与 EXP-001 同数据集语义（版本 390002 由 Run 的入参选择，不在代码里写死）。 */
export const DATASET_CODE = "first_limit_pullback";

/** 与 EXP-001 一致地声明全量扫描（`FULL_DATASET` ⇒ 生效上限 = 平台硬阀）。 */
export const EVENT_SCAN_POLICY = "FULL_DATASET" as const;

/** 与 EXP-001 一致的视界上界（post rd 1…20）。 */
export { DECLARED_POST_RELATIVE_DAYS, MAX_DECLARED_POST_RELATIVE_DAY };

// ---------------------------------------------------------------------------
// 一、Baseline（规格 §11：**不允许隐含**，必须写进 ExperimentDefinition）
// ---------------------------------------------------------------------------

/**
 * 本实验的 Baseline = EXP-001 的**默认研究条件**（逐条对应，不猜）：
 *
 * | 项 | 值 | 依据（EXP-001 实码） |
 * | --- | --- | --- |
 * | 决策时点 T+k | **k = 5** | `fundamental-study/experiment.ts:95` 参数 `maxObservationDay` 的 `defaultValue = 5` |
 * | 未来评价窗口 T+h | **h = 10** | 由「`futureHorizons` 缺省 `[5,10,20]`」派生：取**严格大于 k 的最小声明视界**（k=5 时 T+5 按决策时点口径**按定义不可用**，见 `result.ts#deriveSample` 的 `horizon <= k → unavailable`） |
 * | 样本条件 | **全部样本（ALL）** | EXP-001 的路径 / 对照表同时给 `ALL` 与两个分组 ⇒ 「默认」= 不施加子集条件 |
 * | 数据集 | `first_limit_pullback`（Run 选择版本） | 与 EXP-001 同语义代码 |
 *
 * 🔴 `h = 10` 不是「随手挑的」：它是**从 EXP-001 的两个缺省值确定性派生**的结果
 *    （k=5 之上最小的已声明视界）。这一条同时被登记进 `notes`，页面与报告都能读到。
 */
export const BASELINE_SPEC = Object.freeze({
  decisionDay: 5,
  horizon: 10,
  sampleCondition: "ALL",
});

/** Baseline 的 horizon 为什么是 10（进结果与页面的口径说明）。 */
export const BASELINE_HORIZON_RATIONALE =
  "k = 5 取自 EXP-001 参数 maxObservationDay 的缺省值 5；" +
  "h = 10 取自 EXP-001 缺省视界 [5, 10, 20] 中「严格大于 k 的最小值」" +
  "（决策时点口径下 h ≤ k 表示窗口为空，按定义不可用，不算作缺失）。样本条件缺省 = 全部样本。";

// ---------------------------------------------------------------------------
// 二、维度与变体（规格 §9）
// ---------------------------------------------------------------------------

export const DIMENSION_OBSERVATION_DAY = "observationDay";
export const DIMENSION_EVALUATION_HORIZON = "evaluationHorizon";
export const DIMENSION_SAMPLE_CONDITION = "sampleCondition";

/** 维度声明表（本 Run 的全部维度；变体必须落在其中）。 */
export const STABILITY_DIMENSIONS: readonly RobustnessDimension[] = Object.freeze([
  {
    id: DIMENSION_OBSERVATION_DAY,
    label: "观察日（决策时点 T+k）",
    description:
      "把「什么时候算已经看清楚了」这件事挪动：投资结论必须对「晚一天 / 早一天做判断」不敏感。",
    valueUnit: "相对日 T+k",
  },
  {
    id: DIMENSION_EVALUATION_HORIZON,
    label: "未来评价窗口 T+h",
    description:
      "把「看多远」挪动：结论必须对评价窗口的长度不敏感（短视界与长视界不应给出方向相反的答案）。",
    valueUnit: "相对日 T+h",
  },
  {
    id: DIMENSION_SAMPLE_CONDITION,
    label: "样本条件",
    description:
      "把「研究哪些样本」挪动：结论必须对样本子集的定义不敏感（若只在某个子集成立，那就是条件结论）。",
    // 该维度的取值是**类别码**（不是数值连续量）⇒ 刻意不给 `valueUnit`，而不是编一个单位。
  },
]);

/** 样本条件码（`ALL` = 不施加子集条件 = Baseline）。 */
export const SAMPLE_CONDITIONS = [
  "ALL",
  "NON_BREAK_OPEN",
  "BREAK_OPEN",
  "NO_PULLBACK",
  "DD_200BP",
  "DD_500BP",
  "DD_800BP",
  "DD_1000BP",
  "DD_BELOW_1000BP",
] as const;
export type SampleConditionCode = (typeof SAMPLE_CONDITIONS)[number];

/**
 * 样本条件标签。
 *
 * 🔴 回撤桶的措辞与边界**照 EXP-001 的 `buildDrawdownBuckets`**（`[下界, 上界)` 半开区间，
 *    边界 bps 缺省 `[0, -200, -500, -800, -1000]`），本表只做**人读翻译**，不定义边界。
 */
export const SAMPLE_CONDITION_LABELS: Readonly<Record<SampleConditionCode, string>> = Object.freeze({
  ALL: "全部样本（不施加子集条件）",
  NON_BREAK_OPEN: "截至决策日始终未跌破首板日开盘价",
  BREAK_OPEN: "截至决策日曾跌破首板日开盘价",
  NO_PULLBACK: "未回踩（截至决策日累计最低价 ≥ 首板日收盘价）",
  DD_200BP: "回撤 2%~0%（含 -2%，不含 0）",
  DD_500BP: "回撤 5%~2%",
  DD_800BP: "回撤 8%~5%",
  DD_1000BP: "回撤 10%~8%",
  DD_BELOW_1000BP: "回撤超过 10%",
});

/** 一个变体的**声明**（口径 + 不透明配置；`config` 是给 Robustness 核心看的那一份）。 */
export interface StabilityVariantSpec {
  readonly dimensionId: string | null;
  readonly code: string;
  readonly label: string;
  readonly decisionDay: number;
  readonly horizon: number;
  readonly sampleCondition: SampleConditionCode;
}

function variantLabel(decisionDay: number, horizon: number, condition: SampleConditionCode): string {
  return `T+${decisionDay} 决策 · T+${horizon} 视界 · ${SAMPLE_CONDITION_LABELS[condition]}`;
}

function spec(args: {
  dimensionId: string | null;
  code: string;
  decisionDay: number;
  horizon: number;
  sampleCondition: SampleConditionCode;
}): StabilityVariantSpec {
  return { ...args, label: variantLabel(args.decisionDay, args.horizon, args.sampleCondition) };
}

/** Baseline 变体（`dimensionId = null`：基准是共享锚点，不属于任何维度）。 */
export const BASELINE_VARIANT_SPEC: StabilityVariantSpec = Object.freeze(
  spec({
    dimensionId: null,
    code: `BASELINE_T${BASELINE_SPEC.decisionDay}_H${BASELINE_SPEC.horizon}_ALL`,
    decisionDay: BASELINE_SPEC.decisionDay,
    horizon: BASELINE_SPEC.horizon,
    sampleCondition: "ALL",
  })
);

/**
 * 非基准变体（**按维度声明顺序**，不按任何数值排序）。
 *
 * 🔴 两个变体与 Baseline **同配置**（维度 A 的 k=5、维度 B 的 h=10）——
 *    它们刻意保留，作为**自检行**：与基准同配置 ⇒ `delta` 必须恰为 0、verdict 必须 `stable`。
 *    这比任何「我相信重算是对的」都硬：一旦重算路径里掺进了不该有的状态，
 *    这两行会立刻不是 0。
 */
export const VARIANT_SPECS: readonly StabilityVariantSpec[] = Object.freeze([
  // ---- 维度 A：观察日 ----
  ...([1, 2, 3, 4, 5] as const).map((day) =>
    spec({
      dimensionId: DIMENSION_OBSERVATION_DAY,
      code: `OBS_DAY_T${day}`,
      decisionDay: day,
      horizon: BASELINE_SPEC.horizon,
      sampleCondition: "ALL",
    })
  ),
  // ---- 维度 B：未来评价窗口 ----
  ...([5, 10, 20] as const).map((horizon) =>
    spec({
      dimensionId: DIMENSION_EVALUATION_HORIZON,
      code: `HORIZON_T${horizon}`,
      decisionDay: BASELINE_SPEC.decisionDay,
      horizon,
      sampleCondition: "ALL",
    })
  ),
  // ---- 维度 C：样本条件 ----
  ...(
    [
      "NON_BREAK_OPEN",
      "BREAK_OPEN",
      "NO_PULLBACK",
      "DD_200BP",
      "DD_500BP",
      "DD_800BP",
      "DD_1000BP",
      "DD_BELOW_1000BP",
    ] as const
  ).map((condition) =>
    spec({
      dimensionId: DIMENSION_SAMPLE_CONDITION,
      code: `COND_${condition}`,
      decisionDay: BASELINE_SPEC.decisionDay,
      horizon: BASELINE_SPEC.horizon,
      sampleCondition: condition,
    })
  ),
]);

/** 声明 → 核心条目（**索引 0 = 基准**，与 C-18.1 的 baseline-first 纪律一致）。 */
export function toVariantItem(v: StabilityVariantSpec, isBaseline: boolean): RobustnessVariantItem {
  return {
    dimensionId: isBaseline ? null : v.dimensionId,
    code: v.code,
    label: v.label,
    isBaseline,
    config: {
      decisionDay: v.decisionDay,
      horizon: v.horizon,
      sampleCondition: v.sampleCondition,
    },
  };
}

/** 核心输入用的完整变体清单（索引 0 = 基准）。 */
export const VARIANT_ITEMS: readonly RobustnessVariantItem[] = Object.freeze([
  toVariantItem(BASELINE_VARIANT_SPEC, true),
  ...VARIANT_SPECS.map((v) => toVariantItem(v, false)),
]);

/** spec 反查（评估器按 code 取回口径）。 */
export function specOf(code: string): StabilityVariantSpec {
  if (code === BASELINE_VARIANT_SPEC.code) return BASELINE_VARIANT_SPEC;
  const found = VARIANT_SPECS.find((v) => v.code === code);
  if (found === undefined) throw new Error(`未知变体 code "${code}"（不在 VARIANT_SPECS 里）`);
  return found;
}

/**
 * **自检行**：配置与 Baseline **逐字段相同**的变体。
 *
 * 它们存在的唯一目的是**证伪**：同一份数据经过同一套配置，`delta` 必须**恰好为 0**、
 * verdict 必须 `stable`。一旦重算路径里掺进了不该有的状态（缓存串味、遍历顺序依赖、
 * 上一次迭代残留的累加器…），这两行会立刻不再为 0 —— 比任何「我相信重算是干净的」都硬。
 *
 * `OBS_DAY_T5`（维度 A 的 k=5）与 `HORIZON_T10`（维度 B 的 h=10）都与 Baseline 同配置：
 * 前者证明「维度 A 里确实有一步是不动的」，后者证明「维度 B 里也一样」。
 */
export const SELF_CHECK_VARIANT_CODES: readonly string[] = Object.freeze(["OBS_DAY_T5", "HORIZON_T10"]);

/** 从一个变体 spec 取「它需要哪些相对日」的上界（口径见 `experiment.ts` 的 eligibility 说明）。 */
export function requiredMaxRelativeDayOf(v: StabilityVariantSpec): number {
  return Math.max(v.decisionDay, v.horizon);
}

// ---------------------------------------------------------------------------
// 三、指标词表与比较声明（规格 §10 / §4）
// ---------------------------------------------------------------------------

/**
 * 指标词表（本 Run 的**唯一**指标来源）。
 *
 * `sampleCount` = 候选样本数（分母，逐变体相同）；`validSampleCount` = 真正参与统计的样本数
 * （分子）。两者刻意都留着 —— 只看分子会让「样本量掉了一半」这件事看起来像「结论更稳了」。
 */
export const METRIC_NAMES: readonly string[] = Object.freeze([
  "sampleCount",
  "validSampleCount",
  "meanCloseReturn",
  "medianCloseReturn",
  "breakoutVsCloseRate",
]);

/** 不参与比较的指标（进词表但不声明容差；原因见 `COMPARISON_SPEC_NOTES`）。 */
export const METRIC_UNAVAILABLE_REASONS = Object.freeze({
  NO_VALID_SAMPLE: "该变体没有可用样本（有效样本数 = 0），指标无从计算",
  EMPTY_FUTURE_WINDOW: "该变体的未来评价窗口为空（h ≤ k），按定义不存在后续表现",
});

/**
 * 比较声明（规格 §4）：**研究口径，不是统计显著性**。
 *
 * 容差取值与其依据：三个指标都是**比例量纲**，因此容差也用比例表达。
 *   - 收益类（均值 / 中位数）容差 **0.02（2 个百分点）**：小于 2pp 的差异在样本内波动尺度内；
 *   - 突破率容差 **0.05（5 个百分点）**：比率类统计量的抽样波动天然更大。
 *
 * 🔴 方向一律 `both` —— 与 C-18.1 的 `RETURN_DRIFT` 同一条理由：扰动应当**不显著改变**结论，
 *    「因为换了条件而收益暴涨」同样是结论不稳的证据。
 */
export const COMPARISON_SPECS: readonly MetricComparisonSpec[] = Object.freeze([
  { metric: "meanCloseReturn", label: "平均收盘收益", unit: "比例", tolerance: 0.02, direction: "both" },
  { metric: "medianCloseReturn", label: "中位收盘收益", unit: "比例", tolerance: 0.02, direction: "both" },
  { metric: "breakoutVsCloseRate", label: "突破决策日收盘价率", unit: "比例", tolerance: 0.05, direction: "both" },
]);

/** 容差声明的口径说明（进结果；「容差从哪来」必须是可读的，不是魔法数字）。 */
export const COMPARISON_SPEC_NOTES: readonly string[] = Object.freeze([
  "容差是**研究口径**（多大幅度的变化算「结论变了」），不是统计显著性检验：本实验不做假设检验，也不给 p 值。",
  "方向一律双向：换条件后收益暴涨同样是「结论不稳」的证据（与 C-18.1 的 RETURN_DRIFT 同一条理由）。",
  "sampleCount / validSampleCount 进指标词表但**不声明比较容差** —— 样本量是设计属性不是结论；" +
    "它相对基准的变化通过逐行 sampleSetChanged 暴露（样本集合变了却直接当同一总体比，才是要堵的失真）。",
]);

// ---------------------------------------------------------------------------
// 四、剔除 / 不可用原因（闭集；账目可解释的前提）
// ---------------------------------------------------------------------------

/**
 * 剔除 / 数据问题原因闭集（**每个码自带它属于哪个桶**）。
 *
 * 桶 = `RobustnessSampleAccounting` 的四桶里除 `valid` 以外的三个：
 *
 * | 桶 | 含义 | 守恒式 |
 * | --- | --- | --- |
 * | `missing` | 所需数据**整行缺失**（并不是「值非法」） | candidate = eligible + missing + invalid |
 * | `invalid` | 行在、但 OHLC 不自洽（非有限 / 非正 / 高低倒挂） | 同上 |
 * | `excluded` | 数据前提成立，但**不满足该变体的样本条件** | eligible = valid + excluded |
 *
 * 🔴 归入优先级（**顺序即口径**）：`missing` > `invalid` > `excluded` > `valid`。
 *    一个事件可能既有缺又有坏，但**只能落一个桶** —— 否则 `candidate` 会被重复计数，
 *    「candidate = valid + excluded + missing + invalid」这条可加划分当场失效。
 *
 * 🔴 与 EXP-001 的口径**刻意不同**（EXP-001 的逐视界账里 missing / invalid 可重叠）：
 *    那边是「数据质量诊断」，这里是「矩阵里逐变体可比」，两者不得混用；
 *    EXP-001 那份仍然照原样产出，本实验不改它。
 *
 * ⚠️ `h ≤ k`（未来评价窗口为空）**不是**剔除原因 —— 那是**指标不可用**，
 *    见 `METRIC_UNAVAILABLE_REASONS.EMPTY_FUTURE_WINDOW`。把它当剔除会把
 *    「窗口按定义不存在」误报成「样本被丢了」。
 */
export const EXCLUSION_REASONS = Object.freeze({
  MAX_EVENTS_LIMIT: {
    bucket: "missing",
    label: "超出本次运行的 maxEvents 上限，从未进入评估（数据在本轮范围外）",
  },
  MISSING_EVENT_DAY_BAR: { bucket: "missing", label: "缺首板日（rd=0）行情行" },
  MISSING_LIMIT_UP_PRICE: { bucket: "missing", label: "缺首板日涨停价字段 limitUpPrice" },
  MISSING_WINDOW_BAR: { bucket: "missing", label: "该变体所需窗口内有整行行情缺失" },
  INVALID_EVENT_DAY_OHLC: { bucket: "invalid", label: "首板日 OHLC 非法（非有限 / 非正 / 高低倒挂）" },
  INVALID_WINDOW_OHLC: { bucket: "invalid", label: "该变体所需窗口内有行但 OHLC 非法（或行身份缺失）" },
  SAMPLE_CONDITION_NOT_MET: { bucket: "excluded", label: "数据前提成立，但不满足该变体的样本条件" },
} as const);
export type ExclusionReasonCode = keyof typeof EXCLUSION_REASONS;
export type ExclusionBucket = (typeof EXCLUSION_REASONS)[ExclusionReasonCode]["bucket"];

/** 原因码 → 人读标签（进结果 `exclusionReasonLabels`；页面与报告同一份）。 */
export const EXCLUSION_REASON_LABELS: Readonly<Record<ExclusionReasonCode, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(EXCLUSION_REASONS).map(([code, meta]) => [code, meta.label])
  ) as Record<ExclusionReasonCode, string>
);

/** 未登记的原因码一律拒绝（账目不可解释 = 结论不可信）。 */
export function isExclusionReasonCode(code: string): code is ExclusionReasonCode {
  return Object.prototype.hasOwnProperty.call(EXCLUSION_REASONS, code);
}

/** 原因码 → 它所属的桶（写错桶会让守恒式静默失衡，因此只允许从闭集里取）。 */
export function exclusionBucketOf(code: ExclusionReasonCode): ExclusionBucket {
  return EXCLUSION_REASONS[code].bucket;
}

/** 报告的观察项类别（与 EXP-001 同一枚举语义）。 */
export const OBSERVATION_KINDS = ["DESCRIPTIVE", "COMPARATIVE", "POTENTIAL_SIGNAL", "LIMITATION"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

// ---------------------------------------------------------------------------
// 五、自有结果 schema（`resultSchema`；与组装函数同文件，防漂移）
// ---------------------------------------------------------------------------

const metricSnapshotSchema = z.object({
  metrics: z.record(z.string(), z.number()),
  unavailable: z.record(z.string(), z.string()),
});

const accountingSchema = z.object({
  candidateCount: z.number().int().nonnegative(),
  eligibleCount: z.number().int().nonnegative(),
  validCount: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  excludedByReason: z.record(z.string(), z.number().int().nonnegative()),
  missingByReason: z.record(z.string(), z.number().int().nonnegative()),
  invalidByReason: z.record(z.string(), z.number().int().nonnegative()),
  accountingFormula: z.string().min(1),
});

const comparisonSchema = z.object({
  metric: z.string().min(1),
  label: z.string().min(1),
  unit: z.string().nullable(),
  baselineValue: z.number().nullable(),
  variantValue: z.number().nullable(),
  delta: z.number().nullable(),
  absoluteDelta: z.number().nullable(),
  tolerance: z.number().nonnegative(),
  direction: z.enum(["both", "increase", "decrease"]),
  verdict: z.enum(["stable", "sensitive", "insufficient"]),
  reason: z.string().nullable(),
  baselineSampleCount: z.number().int().nonnegative().nullable(),
  variantSampleCount: z.number().int().nonnegative().nullable(),
  excludedSampleCount: z.number().int().nonnegative().nullable(),
  sampleSetChanged: z.boolean().nullable(),
});

const variantResultSchema = z.object({
  /** 基准不属于任何维度 ⇒ `null`（**不是空字符串占位**）；非基准变体必须有非空维度 id。 */
  dimensionId: z.string().nullable(),
  code: z.string().min(1),
  label: z.string().min(1),
  decisionDay: z.number().int().min(1),
  horizon: z.number().int().min(1),
  sampleCondition: z.enum(SAMPLE_CONDITIONS),
  status: z.enum(["succeeded", "failed"]),
  verdict: z.enum(["baseline", "stable", "sensitive", "insufficient", "failed"]),
  metrics: metricSnapshotSchema.nullable(),
  accounting: accountingSchema.nullable(),
  error: z.string().nullable(),
  comparisons: z.array(comparisonSchema),
  configFingerprint: z.string().min(1),
});

const dimensionConclusionSchema = z.object({
  dimensionId: z.string().min(1),
  label: z.string().min(1),
  variantCount: z.number().int().nonnegative(),
  stableCount: z.number().int().nonnegative(),
  sensitiveCount: z.number().int().nonnegative(),
  insufficientCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  verdict: z.enum(["sensitive", "stable", "insufficient", "failed", "no-variants"]),
  sensitiveEntries: z.array(z.object({ code: z.string(), label: z.string() })),
});

/** 本实验自有结果结构（`result.customPayload`）。 */
export const stabilityValidationCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  experimentCode: z.literal(EXPERIMENT_CODE),
  experimentVersion: z.string().min(1),
  /** 跨阶段 Robustness 核心产出的运行 id 与内容指纹（可复核「这份矩阵是哪一次算的」）。 */
  robustnessRunId: z.string().min(1),
  robustnessFingerprint: z.string().min(1),
  baseline: variantResultSchema,
  baselineRationale: z.string().min(1),
  dimensions: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      description: z.string().optional(),
      valueUnit: z.string().nullable().optional(),
    })
  ),
  metricNames: z.array(z.string().min(1)),
  comparisonSpecs: z.array(
    z.object({
      metric: z.string().min(1),
      label: z.string().optional(),
      unit: z.string().optional(),
      tolerance: z.number().nonnegative(),
      direction: z.enum(["both", "increase", "decrease"]),
    })
  ),
  comparisonSpecNotes: z.array(z.string()),
  variants: z.array(variantResultSchema),
  dimensionConclusions: z.array(dimensionConclusionSchema),
  counts: z.object({
    variantCount: z.number().int().nonnegative(),
    stableCount: z.number().int().nonnegative(),
    sensitiveCount: z.number().int().nonnegative(),
    insufficientCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
  }),
  overallVerdict: z.enum(["sensitive", "stable", "insufficient", "failed", "no-variants"]),
  candidates: z.object({
    datasetEventCount: z.number().int().nonnegative().nullable(),
    scannedRowCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    duplicateEventIdCount: z.number().int().nonnegative(),
    /** 账目缺口：数据集声明总数 − 本轮候选数（`null` = 不可知，**不等于 0**）。 */
    unscannedEventCount: z.number().int().nonnegative().nullable(),
    /** 是否真的存在账目缺口（**判据是缺口本身，不是「触达上限」**）。 */
    droppedByScanLimit: z.boolean(),
    eventPageCount: z.number().int().nonnegative(),
  }),
  dataQuality: z.object({
    invalidOhlcBarCount: z.number().int().nonnegative(),
    invalidOhlcAffectedEventCount: z.number().int().nonnegative(),
    missingWindowBarCount: z.number().int().nonnegative(),
    /** 独立于构造路径的反查：被剔的坏 Bar 有没有混进任何可用窗口（恒应为 0）。 */
    invalidOhlcUsedInWindowCount: z.number().int().nonnegative(),
  }),
  exclusionReasonLabels: z.record(z.string(), z.string()),
  unavailableReasonLabels: z.record(z.string(), z.string()),
  sampleConditionLabels: z.record(z.string(), z.string()),
  /**
   * **本次执行声明写出的产物索引**（名字 / 角色 / 标签 / MIME）。
   *
   * 🔴 刻意**只声明、不声称**：字节是否真的在对象存储里，权威判据是 `manifest.json`
   *    （平台在 Run 详情里给出，含体积与存在性实测）。这里存在的理由只有一个 ——
   *    实验页面只能拿到 `outcome`（**不含 manifest**），若不下发这份索引，
   *    页面上就完全看不见「本实验产出了哪些 CSV / SVG / JSON」。
   *    也刻意**不带 `body`**：把产物字节塞进 `result.json` 会把一次 Run 的结果体撑大。
   */
  artifacts: z.array(
    z.object({
      name: z.string().min(1),
      role: z.enum(["table", "chart", "log", "artifact"]),
      label: z.string().optional(),
      description: z.string().optional(),
      contentType: z.string().optional(),
    })
  ),
  observations: z.array(
    z.object({
      kind: z.enum(OBSERVATION_KINDS),
      text: z.string().min(1),
    })
  ),
  notes: z.array(z.string()),
});
export type StabilityValidationCustomPayload = z.infer<typeof stabilityValidationCustomPayloadSchema>;

// ---------------------------------------------------------------------------
// 六、表格（信封与 CSV 同源）
// ---------------------------------------------------------------------------

const DISPLAY_DIGITS = 6;
const RATIO_UNIT = "比例";

function ratioColumn(key: string, label: string): StudyTableColumn {
  return { key, label, unit: RATIO_UNIT, digits: DISPLAY_DIGITS, align: "RIGHT" };
}
function intColumn(key: string, label: string): StudyTableColumn {
  return { key, label, align: "RIGHT" };
}
function textColumn(key: string, label: string): StudyTableColumn {
  return { key, label, align: "LEFT" };
}

/** 逐变体评估结果（`result.ts` 内部结构；由 `experiment.ts` 的评估器产出）。 */
export interface VariantEvaluation {
  readonly spec: StabilityVariantSpec;
  readonly status: "succeeded" | "failed";
  readonly metrics: { metrics: Record<string, number>; unavailable: Record<string, string> } | null;
  readonly accounting: {
    candidateCount: number;
    eligibleCount: number;
    validCount: number;
    excludedCount: number;
    missingCount: number;
    invalidCount: number;
    excludedByReason: Record<string, number>;
    accountingFormula: string;
  } | null;
  readonly error: string | null;
}

/** 表 1 · `stability_matrix`（规格 §16：Dimension / Variant / Sample Count / Metric / Baseline / Variant / Delta / Tolerance / Verdict）。 */
export function buildStabilityMatrixTable(args: {
  variants: readonly VariantResultRow[];
  comparisons: readonly ComparisonRow[];
}): StudyTable {
  const byCode = new Map(args.variants.map((item) => [item.code, item]));
  const rows: Array<Record<string, ExperimentCell>> = [];
  for (const comparison of args.comparisons) {
    const variant = byCode.get(comparison.variantCode);
    if (variant === undefined) continue;
    rows.push({
      dimension: variant.dimensionLabel,
      variantCode: variant.code,
      variantLabel: variant.label,
      decisionDay: variant.decisionDay,
      horizon: variant.horizon,
      sampleCondition: variant.sampleCondition,
      metric: comparison.metric,
      sampleCount: variant.validSampleCount,
      baselineValue: comparison.baselineValue,
      variantValue: comparison.variantValue,
      delta: comparison.delta,
      tolerance: comparison.tolerance,
      verdict: comparison.verdict,
      reason: comparison.reason,
      sampleSetChanged: comparison.sampleSetChanged,
    });
  }
  return {
    key: "stability_matrix",
    title: "稳定性矩阵（逐变体 × 逐指标）",
    description:
      "每行 = 一个变体的一个指标相对**同一基准**的变化与判定。" +
      "delta 为「变体 − 基准」（同量纲：比例）；tolerance = 声明容差；" +
      "verdict ∈ stable / sensitive / insufficient（insufficient = 该指标不可用，未伪造数值）。" +
      "sampleSetChanged = 该变体与基准的有效样本数是否不同（不同则比较的是不同样本总体，必须显式看见）。",
    columns: [
      textColumn("dimension", "维度"),
      textColumn("variantCode", "变体"),
      textColumn("variantLabel", "变体说明"),
      intColumn("decisionDay", "决策时点 T+k"),
      intColumn("horizon", "视界 T+h"),
      textColumn("sampleCondition", "样本条件"),
      intColumn("sampleCount", "有效样本数"),
      textColumn("metric", "指标"),
      ratioColumn("baselineValue", "基准值"),
      ratioColumn("variantValue", "变体值"),
      ratioColumn("delta", "变化量"),
      ratioColumn("tolerance", "容差"),
      textColumn("verdict", "判定"),
      textColumn("reason", "不可用原因"),
      textColumn("sampleSetChanged", "样本集合变化"),
    ],
    rows,
  };
}

/** 表 2 · `stability_comparison`（逐变体一行的人读汇总）。 */
export function buildStabilityComparisonTable(variants: readonly VariantResultRow[]): StudyTable {
  const rows: Array<Record<string, ExperimentCell>> = variants.map((variant) => ({
    dimension: variant.dimensionLabel,
    variantCode: variant.code,
    variantLabel: variant.label,
    verdict: variant.verdict,
    stableMetricCount: variant.stableMetricCount,
    sensitiveMetricCount: variant.sensitiveMetricCount,
    insufficientMetricCount: variant.insufficientMetricCount,
    sensitiveMetrics: variant.sensitiveMetrics.join(" / "),
    sampleSetChanged: variant.sampleSetChanged,
    note: variant.note,
  }));
  return {
    key: "stability_comparison",
    title: "逐变体判定汇总",
    description:
      "每行 = 一个变体（按声明顺序，**不按任何数值排序 = 不做隐式评级**）。" +
      "sensitive 优先于 insufficient 优先于 stable（敏感性是正面发现，必须先被看见）。",
    columns: [
      textColumn("dimension", "维度"),
      textColumn("variantCode", "变体"),
      textColumn("variantLabel", "变体说明"),
      textColumn("verdict", "判定"),
      intColumn("stableMetricCount", "稳定指标数"),
      intColumn("sensitiveMetricCount", "敏感指标数"),
      intColumn("insufficientMetricCount", "指标不足数"),
      textColumn("sensitiveMetrics", "触发敏感的指标"),
      textColumn("sampleSetChanged", "样本集合变化"),
      textColumn("note", "备注"),
    ],
    rows,
  };
}

/** 表 3 · `sample_accounting`（规格 §13：结论到底用了多少样本）。 */
export function buildSampleAccountingTable(variants: readonly VariantResultRow[]): StudyTable {
  const joinReasons = (map: Record<string, number>): string =>
    Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, count]) => `${code}=${count}`)
      .join(" / ");
  const rows: Array<Record<string, ExperimentCell>> = variants.map((variant) => ({
    dimension: variant.dimensionLabel,
    variantCode: variant.code,
    candidateCount: variant.candidateCount,
    eligibleCount: variant.eligibleCount,
    validCount: variant.validCount,
    excludedCount: variant.excludedCount,
    missingCount: variant.missingCount,
    invalidCount: variant.invalidCount,
    excludedByReason: joinReasons(variant.excludedByReason),
    missingByReason: joinReasons(variant.missingByReason),
    invalidByReason: joinReasons(variant.invalidByReason),
  }));
  return {
    key: "sample_accounting",
    title: "逐变体样本账",
    description:
      "互斥划分：candidate = valid + excluded + missing + invalid；eligible = valid + excluded。" +
      "归入优先级 missing > invalid > excluded > valid。" +
      "（⚠️ 这是**核心四桶**口径；平台信封的 eligible 是「参与统计的样本数」= 本表的 valid，" +
      "两套守恒式不同义，换算见 result.sampleSummary 的 notes。）" +
      "（EXP-001 的逐视界账里 missing / invalid 可重叠 —— 那是数据质量诊断口径，与本表的可加划分不同，不得混用。）",
    columns: [
      textColumn("dimension", "维度"),
      textColumn("variantCode", "变体"),
      intColumn("candidateCount", "候选"),
      intColumn("eligibleCount", "资格成立"),
      intColumn("validCount", "有效"),
      intColumn("excludedCount", "条件剔除"),
      intColumn("missingCount", "缺数据"),
      intColumn("invalidCount", "数据非法"),
      textColumn("excludedByReason", "条件剔除明细"),
      textColumn("missingByReason", "缺数据明细"),
      textColumn("invalidByReason", "数据非法明细"),
    ],
    rows,
  };
}

// ---------------------------------------------------------------------------
// 七、组装辅助结构（页面 / 图 / CSV 共用一份口径）
// ---------------------------------------------------------------------------

/** 逐变体展示行（从核心记录投影；**只保留展示所需字段**，不做任何二次判定）。 */
export interface VariantResultRow {
  readonly dimensionId: string;
  readonly dimensionLabel: string;
  readonly code: string;
  readonly label: string;
  readonly decisionDay: number;
  readonly horizon: number;
  readonly sampleCondition: SampleConditionCode;
  readonly status: "succeeded" | "failed";
  readonly verdict: "baseline" | "stable" | "sensitive" | "insufficient" | "failed";
  readonly candidateCount: number;
  readonly eligibleCount: number;
  readonly validCount: number;
  readonly excludedCount: number;
  readonly missingCount: number;
  readonly invalidCount: number;
  /** 条件剔除原因 → 条数（`Σ = excludedCount`）。 */
  readonly excludedByReason: Record<string, number>;
  /** 缺数据原因 → 条数（`Σ = missingCount`；「为什么样本变少」的唯一诊断线索，**禁丢**）。 */
  readonly missingByReason: Record<string, number>;
  /** 数据非法原因 → 条数（`Σ = invalidCount`）。 */
  readonly invalidByReason: Record<string, number>;
  readonly validSampleCount: number;
  /** 核心层产出的指标取值（**只含已声明词表里的指标**，`sampleCount` / `validSampleCount` 由样本账给出）。 */
  readonly metricValues: Record<string, number>;
  /** 指标 → 不可用原因（**不适用绝不以 0 冒充**）。 */
  readonly unavailableReasons: Record<string, string>;
  /** 变体配置指纹（核心口径：canonical JSON 的 sha256 前缀 + 长度标记）。 */
  readonly configFingerprint: string;
  readonly stableMetricCount: number;
  readonly sensitiveMetricCount: number;
  readonly insufficientMetricCount: number;
  readonly sensitiveMetrics: string[];
  readonly sampleSetChanged: boolean | null;
  readonly note: string;
}

/** 逐比较行（矩阵表数据源）。 */
export interface ComparisonRow {
  readonly variantCode: string;
  readonly metric: string;
  readonly baselineValue: number | null;
  readonly variantValue: number | null;
  readonly delta: number | null;
  readonly tolerance: number;
  readonly verdict: "stable" | "sensitive" | "insufficient";
  readonly reason: string | null;
  readonly sampleSetChanged: boolean | null;
}

/** 基线展示（页面总览）。 */
export interface BaselineView {
  readonly code: string;
  readonly label: string;
  readonly decisionDay: number;
  readonly horizon: number;
  readonly sampleCondition: SampleConditionCode;
  readonly metrics: Record<string, number>;
  readonly unavailable: Record<string, string>;
  /** 基准变体的配置指纹（由核心层给出，**不允许实验自己编**）。 */
  readonly configFingerprint: string;
}

// ---------------------------------------------------------------------------
// 八、组装结果信封
// ---------------------------------------------------------------------------

/** `assembleStabilityValidationResult` 的入参（由 `experiment.ts` 提供）。 */
export interface AssembleStabilityArgs {
  readonly experimentVersion: string;
  readonly robustnessRunId: string;
  readonly robustnessFingerprint: string;
  readonly baseline: BaselineView;
  readonly variants: readonly VariantResultRow[];
  readonly comparisons: readonly ComparisonRow[];
  readonly dimensionConclusions: readonly {
    dimensionId: string;
    label: string;
    variantCount: number;
    stableCount: number;
    sensitiveCount: number;
    insufficientCount: number;
    failedCount: number;
    verdict: string;
    sensitiveEntries: readonly { code: string; label: string }[];
  }[];
  readonly counts: {
    variantCount: number;
    stableCount: number;
    sensitiveCount: number;
    insufficientCount: number;
    failedCount: number;
  };
  readonly overallVerdict: string;
  readonly candidates: {
    datasetEventCount: number | null;
    scannedRowCount: number;
    candidateCount: number;
    duplicateEventIdCount: number;
    unscannedEventCount: number | null;
    droppedByScanLimit: boolean;
    eventPageCount: number;
  };
  readonly dataQuality: {
    invalidOhlcBarCount: number;
    invalidOhlcAffectedEventCount: number;
    missingWindowBarCount: number;
    invalidOhlcUsedInWindowCount: number;
  };
  readonly observations: readonly { kind: ObservationKind; text: string }[];
  readonly notes: readonly string[];
  /** 本次执行声明写出的产物索引（**不带字节**；权威索引仍是 `manifest.json`）。 */
  readonly artifacts: readonly {
    name: string;
    role: "table" | "chart" | "log" | "artifact";
    label?: string;
    description?: string;
    contentType?: string;
  }[];
}

/** 比例 → 展示用百分数（**只用于人读文本**；结构里的值一律保持比例）。 */
function pct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(2)}%`;
}

/** 组装本实验的结果载荷（表格 / 统计 / 图表 / 自有结构 + 如实样本账）。 */
export function assembleStabilityValidationResult(args: AssembleStabilityArgs): ExperimentResultPayload {
  const {
    baseline,
    variants,
    comparisons,
    counts,
    candidates,
    dataQuality,
    overallVerdict,
  } = args;
  const baselineRow = variants.find((variant) => variant.verdict === "baseline");
  if (baselineRow === undefined) {
    throw new Error("结果组装失败：变体列表里没有基准行（verdict=baseline）");
  }
  for (const variant of variants) {
    if (variant.verdict === "baseline") continue;
    if (variant.dimensionId.length === 0) {
      throw new Error(`结果组装失败：非基准变体 "${variant.code}" 没有维度 id（§6 要求变体必须归属维度）`);
    }
    if (variant.status === "succeeded" && variant.configFingerprint.length === 0) {
      throw new Error(`结果组装失败：变体 "${variant.code}" 配置指纹为空（必须由核心层给出）`);
    }
  }
  // 逐变体账目守恒（§13）：**组装期自己再验一遍**，不依赖核心层「已经验过」的承诺。
  for (const variant of variants) {
    const sum = (map: Record<string, number>): number => Object.values(map).reduce((a, b) => a + b, 0);
    const problems: string[] = [];
    if (variant.validCount + variant.excludedCount !== variant.eligibleCount) {
      problems.push(
        `eligible(valid+excluded)=${variant.validCount + variant.excludedCount} ≠ eligibleCount ${variant.eligibleCount}`
      );
    }
    if (
      variant.validCount + variant.excludedCount + variant.missingCount + variant.invalidCount !==
      variant.candidateCount
    ) {
      problems.push(
        `valid+excluded+missing+invalid=${variant.validCount + variant.excludedCount + variant.missingCount + variant.invalidCount} ≠ candidateCount ${variant.candidateCount}`
      );
    }
    if (variant.eligibleCount + variant.missingCount + variant.invalidCount !== variant.candidateCount) {
      problems.push(
        `eligible+missing+invalid=${variant.eligibleCount + variant.missingCount + variant.invalidCount} ≠ candidateCount ${variant.candidateCount}`
      );
    }
    if (sum(variant.excludedByReason) !== variant.excludedCount) {
      problems.push(`ΣexcludedByReason=${sum(variant.excludedByReason)} ≠ excludedCount ${variant.excludedCount}`);
    }
    if (sum(variant.missingByReason) !== variant.missingCount) {
      problems.push(`ΣmissingByReason=${sum(variant.missingByReason)} ≠ missingCount ${variant.missingCount}`);
    }
    if (sum(variant.invalidByReason) !== variant.invalidCount) {
      problems.push(`ΣinvalidByReason=${sum(variant.invalidByReason)} ≠ invalidCount ${variant.invalidCount}`);
    }
    for (const code of [
      ...Object.keys(variant.excludedByReason),
      ...Object.keys(variant.missingByReason),
      ...Object.keys(variant.invalidByReason),
    ]) {
      if (!isExclusionReasonCode(code)) problems.push(`未登记的原因码 "${code}"`);
    }
    if (problems.length > 0) {
      throw new Error(`结果组装失败：变体 "${variant.code}" 的样本账不平 —— ${problems.join("；")}`);
    }
  }

  const exclusionReasonLabels: Record<string, string> = { ...EXCLUSION_REASON_LABELS };
  const tableMatrix = buildStabilityMatrixTable({ variants, comparisons });
  const tableComparison = buildStabilityComparisonTable(variants);
  const tableAccounting = buildSampleAccountingTable(variants);

  const metricLabelOf = new Map(COMPARISON_SPECS.map((spec) => [spec.metric, spec.label ?? spec.metric]));
  const compareSeries = COMPARISON_SPECS.map((spec) => ({
    key: spec.metric,
    label: metricLabelOf.get(spec.metric) ?? spec.metric,
    points: variants
      .filter((variant) => variant.verdict !== "baseline")
      .map((variant) => {
        const row = comparisons.find((item) => item.variantCode === variant.code && item.metric === spec.metric);
        return { x: variant.code, y: row === undefined ? null : row.delta };
      }),
  }));

  const customPayload: StabilityValidationCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    experimentCode: EXPERIMENT_CODE,
    experimentVersion: args.experimentVersion,
    robustnessRunId: args.robustnessRunId,
    robustnessFingerprint: args.robustnessFingerprint,
    baseline: {
      dimensionId: null,
      code: baseline.code,
      label: baseline.label,
      decisionDay: baseline.decisionDay,
      horizon: baseline.horizon,
      sampleCondition: baseline.sampleCondition,
      status: "succeeded",
      verdict: "baseline",
      metrics: { metrics: baseline.metrics, unavailable: baseline.unavailable },
      accounting: {
        candidateCount: baselineRow.candidateCount,
        eligibleCount: baselineRow.eligibleCount,
        validCount: baselineRow.validCount,
        excludedCount: baselineRow.excludedCount,
        missingCount: baselineRow.missingCount,
        invalidCount: baselineRow.invalidCount,
        excludedByReason: baselineRow.excludedByReason,
        missingByReason: baselineRow.missingByReason,
        invalidByReason: baselineRow.invalidByReason,
        accountingFormula: ACCOUNTING_FORMULA,
      },
      error: null,
      comparisons: [],
      configFingerprint: baseline.configFingerprint,
    },
    baselineRationale: BASELINE_HORIZON_RATIONALE,
    dimensions: STABILITY_DIMENSIONS.map((dimension) => ({
      id: dimension.id,
      label: dimension.label,
      ...(dimension.description !== undefined ? { description: dimension.description } : {}),
      valueUnit: dimension.valueUnit ?? null,
    })),
    metricNames: [...METRIC_NAMES],
    comparisonSpecs: COMPARISON_SPECS.map((spec) => ({
      metric: spec.metric,
      ...(spec.label !== undefined ? { label: spec.label } : {}),
      ...(spec.unit !== undefined ? { unit: spec.unit } : {}),
      tolerance: spec.tolerance,
      direction: spec.direction,
    })),
    comparisonSpecNotes: [...COMPARISON_SPEC_NOTES],
    variants: variants.map((variant) => {
      const rows = comparisons.filter((item) => item.variantCode === variant.code);
      return {
        dimensionId: variant.dimensionId,
        code: variant.code,
        label: variant.label,
        decisionDay: variant.decisionDay,
        horizon: variant.horizon,
        sampleCondition: variant.sampleCondition,
        status: variant.status,
        verdict: variant.verdict,
        metrics:
          variant.status === "succeeded"
            ? {
                metrics: {
                  sampleCount: variant.candidateCount,
                  validSampleCount: variant.validCount,
                  ...variant.metricValues,
                },
                unavailable: { ...variant.unavailableReasons },
              }
            : null,
        accounting: {
          candidateCount: variant.candidateCount,
          eligibleCount: variant.eligibleCount,
          validCount: variant.validCount,
          excludedCount: variant.excludedCount,
          missingCount: variant.missingCount,
          invalidCount: variant.invalidCount,
          excludedByReason: variant.excludedByReason,
          missingByReason: variant.missingByReason,
          invalidByReason: variant.invalidByReason,
          accountingFormula: ACCOUNTING_FORMULA,
        },
        error: variant.status === "failed" ? variant.note : null,
        comparisons: rows.map((row) => ({
          metric: row.metric,
          label: metricLabelOf.get(row.metric) ?? row.metric,
          unit: RATIO_UNIT,
          baselineValue: row.baselineValue,
          variantValue: row.variantValue,
          delta: row.delta,
          absoluteDelta: row.delta === null ? null : Math.abs(row.delta),
          tolerance: row.tolerance,
          direction: COMPARISON_SPECS.find((s) => s.metric === row.metric)?.direction ?? "both",
          verdict: row.verdict,
          reason: row.reason,
          baselineSampleCount: baselineRow.validSampleCount,
          variantSampleCount: variant.validSampleCount,
          excludedSampleCount: variant.excludedCount,
          sampleSetChanged: row.sampleSetChanged,
        })),
        configFingerprint: variant.configFingerprint,
      };
    }),
    dimensionConclusions: args.dimensionConclusions.map((item) => ({
      dimensionId: item.dimensionId,
      label: item.label,
      variantCount: item.variantCount,
      stableCount: item.stableCount,
      sensitiveCount: item.sensitiveCount,
      insufficientCount: item.insufficientCount,
      failedCount: item.failedCount,
      verdict: item.verdict as "sensitive" | "stable" | "insufficient" | "failed" | "no-variants",
      sensitiveEntries: item.sensitiveEntries.map((entry) => ({ code: entry.code, label: entry.label })),
    })),
    counts: { ...counts },
    overallVerdict: overallVerdict as StabilityValidationCustomPayload["overallVerdict"],
    candidates: { ...candidates },
    dataQuality: { ...dataQuality },
    exclusionReasonLabels,
    unavailableReasonLabels: { ...METRIC_UNAVAILABLE_REASONS },
    sampleConditionLabels: { ...SAMPLE_CONDITION_LABELS },
    artifacts: args.artifacts.map((item) => ({
      name: item.name,
      role: item.role,
      ...(item.label !== undefined ? { label: item.label } : {}),
      ...(item.description !== undefined ? { description: item.description } : {}),
      ...(item.contentType !== undefined ? { contentType: item.contentType } : {}),
    })),
    observations: args.observations.map((item) => ({ kind: item.kind, text: item.text })),
    notes: [...args.notes],
  };

  const readableNote =
    `总体判定 = ${overallVerdict}・敏感 ${counts.sensitiveCount} / 稳定 ${counts.stableCount} / ` +
    `指标不足 ${counts.insufficientCount} / 执行失败 ${counts.failedCount}（共 ${counts.variantCount} 个非基准变体）`;

  return {
    // 信封样本账 = **基线变体口径**（逐变体账见 sample_accounting.csv 与 customPayload.variants[]）。
    //
    // 🔴 两套守恒式**并存但不同义**，这里刻意做一次显式换算，不许含糊：
    //    - 平台信封：`eligible = 参与统计的样本数`、`excluded = candidate − eligible`
    //      ⇒ `eligible + excluded === candidate`；
    //    - 核心四桶：`candidate = eligible + missing + invalid`、`eligible = valid + excluded`
    //      ⇒ 核心的 `eligible` 是「数据资格成立」（含条件未满足的样本），**不等于**信封的 eligible。
    //    于是映射为：信封 eligible := 核心 validCount；信封 excluded := 核心 excluded+missing+invalid。
    //    （若把核心 eligible 直接当信封 eligible，平台闸门 `eligible + excluded === candidate`
    //     会当场不平 —— 这正是两套口径必须显式换算的理由。）
    sampleSummary: {
      candidateCount: baselineRow.candidateCount,
      eligibleCount: baselineRow.validCount,
      excludedCount: baselineRow.candidateCount - baselineRow.validCount,
      excludedByReason: {
        ...baselineRow.excludedByReason,
        ...baselineRow.missingByReason,
        ...baselineRow.invalidByReason,
      },
      notes: [
        "本信封的样本账 = **Baseline 变体（T+" + String(baseline.decisionDay) + " 决策 · T+" +
          String(baseline.horizon) + " 视界 · 全部样本）** 的口径；逐变体账见 sample_accounting.csv。",
        "信封口径（平台守恒式）：eligible = 参与统计的样本数 = 核心四桶的 validCount；" +
          "excluded = candidate − eligible = 核心的 excluded + missing + invalid。" +
          "核心四桶（可加划分）见 customPayload.baseline.accounting 与逐变体账。",
        "账目公式：" + ACCOUNTING_FORMULA,
        readableNote,
        args.candidates.unscannedEventCount === null
          ? "数据集未声明事件总数 ⇒ 账目缺口不可知（null ≠ 0）"
          : `数据集声明事件 ${String(args.candidates.datasetEventCount)} / 本轮候选 ${args.candidates.candidateCount} / 账目缺口 ${args.candidates.unscannedEventCount}`,
      ],
    },
    tables: [tableMatrix, tableComparison, tableAccounting].map(toEnvelopeTable),
    statistics: [
      {
        code: "baseline_decision_day",
        label: "基准决策时点",
        value: baseline.decisionDay,
        unit: "相对日 T+k",
        digits: 0,
      },
      {
        code: "baseline_horizon",
        label: "基准未来评价窗口",
        value: baseline.horizon,
        unit: "相对日 T+h",
        digits: 0,
      },
      {
        code: "baseline_valid_sample_count",
        label: "基准有效样本数",
        value: baselineRow.validSampleCount,
        unit: "个事件",
        digits: 0,
        sampleCount: baselineRow.validSampleCount,
      },
      {
        code: "variant_count",
        label: "非基准变体数",
        value: counts.variantCount,
        unit: "个",
        digits: 0,
      },
      {
        code: "sensitive_variant_count",
        label: "敏感变体数",
        value: counts.sensitiveCount,
        unit: "个",
        digits: 0,
      },
      {
        code: "stable_variant_count",
        label: "稳定变体数",
        value: counts.stableCount,
        unit: "个",
        digits: 0,
      },
      {
        code: "insufficient_variant_count",
        label: "指标不足变体数",
        value: counts.insufficientCount,
        unit: "个",
        digits: 0,
      },
      {
        code: "failed_variant_count",
        label: "执行失败变体数",
        value: counts.failedCount,
        unit: "个",
        digits: 0,
      },
      {
        code: "candidate_event_count",
        label: "候选事件数",
        value: candidates.candidateCount,
        unit: "个",
        digits: 0,
      },
      {
        code: "unscanned_event_count",
        label: "账目缺口（未扫描到的事件数）",
        value: candidates.unscannedEventCount,
        unit: "个",
        digits: 0,
        note:
          candidates.unscannedEventCount === null
            ? "数据集未声明事件总数 ⇒ 不可知（null ≠ 0）"
            : candidates.droppedByScanLimit
              ? "⚠️ 存在账目缺口：数据集声明的事件没有全部进入候选"
              : "本轮候选 = 数据集声明量（无缺口）",
      },
      {
        code: "invalid_ohlc_used_in_window_count",
        label: "坏 Bar 混入可用窗口次数",
        value: dataQuality.invalidOhlcUsedInWindowCount,
        unit: "次",
        digits: 0,
        note: "独立于构造路径的反查；必须为 0（否则「坏 Bar 不得进未来收益」这条纪律已被破坏）",
      },
      {
        code: "baseline_mean_close_return",
        label: "基准平均收盘收益（T+" + String(baseline.horizon) + " 视界）",
        value: baseline.metrics.meanCloseReturn ?? null,
        unit: RATIO_UNIT,
        digits: DISPLAY_DIGITS,
        sampleCount: baselineRow.validSampleCount,
        note: `= ${pct(baseline.metrics.meanCloseReturn ?? null)}；锚 = 决策日 T+${String(baseline.decisionDay)} 收盘价`,
      },
      {
        code: "baseline_median_close_return",
        label: "基准中位收盘收益",
        value: baseline.metrics.medianCloseReturn ?? null,
        unit: RATIO_UNIT,
        digits: DISPLAY_DIGITS,
        sampleCount: baselineRow.validSampleCount,
        note: `= ${pct(baseline.metrics.medianCloseReturn ?? null)}`,
      },
      {
        code: "baseline_breakout_vs_close_rate",
        label: "基准突破决策日收盘价率",
        value: baseline.metrics.breakoutVsCloseRate ?? null,
        unit: RATIO_UNIT,
        digits: DISPLAY_DIGITS,
        sampleCount: baselineRow.validSampleCount,
        note: `= ${pct(baseline.metrics.breakoutVsCloseRate ?? null)}`,
      },
    ],
    charts: [
      {
        key: "delta-by-variant",
        title: "逐变体的指标变化量（相对基准）",
        description:
          "y = 变体指标 − 基准指标（比例量纲）。缺值为 null = 该指标不可用（**不是 0**）。" +
          "横轴按变体声明顺序，不按数值排序。",
        kind: "BAR" as const,
        xLabel: "变体",
        yLabel: "变化量（比例）",
        series: compareSeries,
      },
    ],
    customPayload,
  };
}

/** 账目公式文本（唯一来源：`experiment.ts` 与页面都从常量取，不各写一份）。 */
export const ACCOUNTING_FORMULA =
  "candidate = valid + excluded + missing + invalid；eligible = valid + excluded；" +
  "归入优先级 missing > invalid > excluded > valid（互斥划分、可加）";

/** `StudyTable` → 信封表格（展示位收敛；与 CSV 同源）。 */
export function toEnvelopeTable(table: StudyTable): ExperimentResultTable {
  return {
    key: table.key,
    title: table.title,
    description: table.description,
    columns: table.columns.map((column) => ({
      key: column.key,
      label: column.label,
      ...(column.unit !== undefined ? { unit: column.unit } : {}),
      ...(column.digits !== undefined ? { digits: column.digits } : {}),
      align: column.align,
    })),
    rows: table.rows.map((row) => {
      const out: Record<string, ExperimentCell> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key] = typeof value === "number" && Number.isFinite(value) ? roundTo(value, DISPLAY_DIGITS) : value;
      }
      return out;
    }),
  };
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// 九、产物（规格 §15）：3 张 CSV + 1 张 SVG，全部经 `context.artifact()` 落对象存储
// ---------------------------------------------------------------------------

/** 容差比面板图（`stability_overview.svg`）：逐变体「|Δ| / 容差」，1.0 即容差线。 */
function renderToleranceRatioSvg(args: {
  title: string;
  subtitle: string;
  categories: readonly string[];
  series: readonly { label: string; values: Array<number | null>; color: string }[];
}): string {
  const width = 1360;
  const panelHeight = 190;
  const headerHeight = 64;
  const padLeft = 210;
  const padRight = 40;
  const panelPadTop = 34;
  const panelPadBottom = 46;
  const height = headerHeight + args.series.length * panelHeight + 24;
  const plotW = width - padLeft - padRight;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${svgEscape(args.title)}">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(
    `<text x="${24}" y="26" font-family="sans-serif" font-size="15" font-weight="600" fill="#111827">${svgEscape(args.title)}</text>`,
  );
  parts.push(
    `<text x="24" y="46" font-family="sans-serif" font-size="10" fill="#6b7280">${svgEscape(args.subtitle)}</text>`,
  );

  args.series.forEach((series, seriesIndex) => {
    const top = headerHeight + seriesIndex * panelHeight;
    const plotH = panelHeight - panelPadTop - panelPadBottom;
    parts.push(
      `<text x="24" y="${top + 18}" font-family="sans-serif" font-size="12" font-weight="600" fill="#111827">${svgEscape(series.label)}</text>`,
    );
    parts.push(
      `<rect x="${padLeft}" y="${top + panelPadTop}" width="${plotW}" height="${plotH}" fill="none" stroke="#e5e7eb"/>`,
    );
    const values = series.values.filter((value): value is number => value !== null && Number.isFinite(value));
    const maxRatio = values.length === 0 ? 1 : Math.max(1.2, ...values.map((value) => Math.min(value, 4)));
    // 容差线（1.0）恒定可见；> 1 即在图上有可见越线。
    const yOf = (ratio: number): number =>
      top + panelPadTop + plotH - (Math.min(ratio, maxRatio) / maxRatio) * plotH;
    const toleranceY = yOf(1);
    parts.push(
      `<line x1="${padLeft}" y1="${toleranceY.toFixed(2)}" x2="${padLeft + plotW}" y2="${toleranceY.toFixed(2)}" stroke="#dc2626" stroke-dasharray="4 3"/>`,
    );
    parts.push(
      `<text x="${padLeft - 8}" y="${(toleranceY + 3).toFixed(2)}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#dc2626">1.0（容差线）</text>`,
    );
    parts.push(
      `<text x="${padLeft - 8}" y="${(top + panelPadTop + 9).toFixed(2)}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#6b7280">${maxRatio.toFixed(2)}×</text>`,
    );
    parts.push(
      `<text x="${padLeft - 8}" y="${(top + panelPadTop + plotH).toFixed(2)}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#6b7280">0×</text>`,
    );

    const slot = args.categories.length === 0 ? plotW : plotW / args.categories.length;
    const barW = Math.max(4, slot * 0.62);
    const zeroY = top + panelPadTop + plotH;
    args.categories.forEach((category, catIndex) => {
      const ratio = series.values[catIndex] ?? null;
      const x = padLeft + slot * catIndex + (slot - barW) / 2;
      if (ratio !== null && Number.isFinite(ratio)) {
        const y = yOf(ratio);
        const barHeight = Math.max(1, zeroY - y);
        const crossed = ratio > 1;
        parts.push(
          `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${barHeight.toFixed(2)}" fill="${crossed ? "#dc2626" : "#94a3b8"}" opacity="0.9"/>`,
        );
        parts.push(
          `<text x="${(x + barW / 2).toFixed(2)}" y="${(y - 4).toFixed(2)}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#374151">${ratio.toFixed(2)}×</text>`,
        );
      } else {
        parts.push(
          `<text x="${(x + barW / 2).toFixed(2)}" y="${(zeroY - 6).toFixed(2)}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#9ca3af">n/a</text>`,
        );
      }
      if (seriesIndex === args.series.length - 1) {
        parts.push(
          `<text x="${(padLeft + slot * catIndex + slot / 2).toFixed(2)}" y="${(top + panelHeight - 30).toFixed(2)}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#374151">${svgEscape(category)}</text>`,
        );
      }
    });
  });

  parts.push(
    `<text x="24" y="${height - 10}" font-family="sans-serif" font-size="9" fill="#6b7280">纵轴 = |变体 − 基准| ÷ 声明容差（无量纲）；红色虚线 = 1.0 = 容差线；n/a = 该指标不可用（不伪造数值）。颜色只表示「是否越线」，与涨跌无关。</text>`,
  );
  parts.push("</svg>");
  return parts.join("\n");
}

function svgEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 组装产物清单（3 张 CSV + 1 张 SVG；与信封里的表 / 图**同源**）。
 *
 * 🔴 `name` 是 Run 前缀下的**相对名字**、且**不含角色段** —— Object Key =
 *    `…/runs/{runId}/{role}/{name}`：写成 `tables/x.csv` 且 `role: "table"`
 *    会落成 `tables/tables/x.csv`（EXP-001 真机实测踩过）。这里复用 EXP-001 的
 *    `buildArtifacts`（表 → `${table.key}.csv`，图 → 显式名字 + `role: "chart"`）。
 */
export function buildStabilityArtifacts(args: {
  tables: readonly StudyTable[];
  variants: readonly VariantResultRow[];
  comparisons: readonly ComparisonRow[];
  baseline: BaselineView;
  counts: AssembleStabilityArgs["counts"];
}): StudyArtifactFile[] {
  const overview = renderToleranceRatioSvg({
    title: "EXP-002 · 稳定性总览：逐变体的 |Δ| / 容差",
    subtitle:
      `基准：T+${args.baseline.decisionDay} 决策 · T+${args.baseline.horizon} 视界 · 样本条件 ${args.baseline.sampleCondition}。` +
      `总体判定 ${args.counts.sensitiveCount > 0 ? "sensitive" : args.counts.insufficientCount > 0 ? "insufficient" : args.counts.failedCount > 0 ? "failed" : "stable"}` +
      `；敏感 ${args.counts.sensitiveCount} / 稳定 ${args.counts.stableCount} / 不足 ${args.counts.insufficientCount} / 失败 ${args.counts.failedCount}` +
      "。红柱 = |Δ| 越过容差（比值 > 1.0）；柱高上限 4.0× 截断显示。",
    categories: args.variants.filter((variant) => variant.verdict !== "baseline").map((variant) => variant.code),
    series: COMPARISON_SPECS.map((spec) => ({
      label: spec.label ?? spec.metric,
      color: "#475569",
      values: args.variants
        .filter((variant) => variant.verdict !== "baseline")
        .map((variant) => {
          const row = args.comparisons.find((item) => item.variantCode === variant.code && item.metric === spec.metric);
          if (row === undefined || row.delta === null || spec.tolerance <= 0) return null;
          return Math.abs(row.delta) / spec.tolerance;
        }),
    })),
  });

  return buildArtifacts(args.tables, [
    {
      name: "stability_overview.svg",
      label: "稳定性总览（SVG）",
      description:
        "逐变体 × 逐指标的「|Δ| / 容差」面板图：在红色虚线上方 = 该指标相对基准的变化超过声明容差。",
      body: overview,
    },
  ]);
}

/** 供页面读取的稳定导出（避免页面自己再实现一遍投影）。 */
export function variantRowsOfPayload(payload: unknown): VariantResultRow[] {
  const custom = payload as { variants?: VariantResultRow[] } | null;
  return Array.isArray(custom?.variants) ? custom!.variants! : [];
}

/** 供页面读取：逐比较行（矩阵表已在 `result.tables` 里，这里供自定义视图用）。 */
export function comparisonRowsOfPayload(payload: unknown): ComparisonRow[] {
  const custom = payload as { variants?: Array<{ code: string; comparisons?: ComparisonRow[] }> } | null;
  if (!Array.isArray(custom?.variants)) return [];
  return custom!.variants!.flatMap((variant) =>
    Array.isArray(variant.comparisons) ? variant.comparisons.map((row) => ({ ...row, variantCode: variant.code })) : []
  );
}

/** 导出派生工具（页面统计卡用；与核心同源，不另算一套）。 */
export { deriveSample as deriveSampleForSummary };
export type { StudyBar };
