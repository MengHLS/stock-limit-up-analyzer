/**
 * ROBUSTNESS-001 §2~§15 — Search-Result Robustness Analysis：类型契约（不可变、可序列化、确定性）。
 *
 * ## 本模块的定位（**为什么是并列兄弟目录，而不是复用 `robustness/`**）
 *
 * 仓库里已有两种「鲁棒性」，且它们**都必须重跑评估**：
 *   - `server/research/robustness/**`（C-18.1）：对一条已评估策略做成本 / 滑点 / 参数 / 执行
 *     四轴**扰动重估** ⇒ 输入是「扰动后的配置」，需要注入式 `RobustnessEvaluator`（即重跑回测）；
 *   - `server/research/stochasticRobustness/**`（C-18.2）：Monte Carlo / Bootstrap / 成交顺序
 *     随机化重估 ⇒ 同样需要评估器回调。
 *
 * 本任务（ROBUSTNESS-001）是**第三种、且语义相反**的一类鲁棒性：
 * > 对 **已经算完** 的 Parameter Search 结果做**冻结快照上的邻域稳定性分析**。
 *
 * 判据（规格 §2 / §21 A/B）：
 *   - 输入**只有** `parameter_search_run` / `parameter_search_combination` / `parameter_search_result`；
 *   - **不重跑 Backtest**、**不重算 canonical metrics**（只做统计与判定）；
 *   - 不重新解释历史搜索（读**冻结快照**，不重读当前 Strategy Version）。
 *
 * ⇒ 与既有两者**并列**（同域不同物），落在 `robustness:` 域下的第三个模块，目录命名对齐
 *   `stochasticRobustness` 的既有范式。**不改** `robustness/**` 一行（那是另一条语义）。
 *
 * ## 继承 PARAMETER-002 的事实（规格 §12）
 *
 * 「参数声明在 schema 里 ≠ 参数被策略消费」（N-02 实查结论）。因此本域**不自行判定**参数是否
 * 被消费，只**继承**源 Search Run 的 `referenceCheckApplied`：
 *   - `true`  ⇒ 源 Run 已做死参数筛查，可用；
 *   - `false` / `null`（历史行无该列）⇒ 结果里必须出现 `parameterReferenceUnverified = true`
 *     标记 `ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED`，**不假装参数已被策略使用**。
 *
 * 铁律：字段全部 readonly；可 JSON 序列化；禁止 NaN / Infinity；确定性（同输入同产物）；
 * 失败响亮（结构化领域码）；**本目录不触 Date.now / Math.random / IO**（时间戳与 id 由调用方注入）。
 */

import type { ParameterSearchRunStatus, ParameterSearchSpaceDefinition } from "../../../shared/parameterSearchContracts";
import type { ResearchParameterValue } from "../types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** Run 记录种类标签（与 C-18.1 的 `ROBUSTNESS_RUN` **刻意不同**，避免两种鲁棒性记录互相误判）。 */
export const SEARCH_ROBUSTNESS_RUN_RECORD_KIND = "SEARCH_ROBUSTNESS_RUN" as const;

/** Run schema 版本：字段语义变更必须递增（禁止原地改写既有含义）。 */
export const SEARCH_ROBUSTNESS_RUN_RECORD_VERSION = 1 as const;

/** Run ID 前缀（`SROB-YYYYMMDD-XXXXXXXX`；风格对齐 `PSRUN` / `ROBUST`）。 */
export const SEARCH_ROBUSTNESS_RUN_ID_PREFIX = "SROB" as const;

/** 单组合结果记录种类标签。 */
export const SEARCH_ROBUSTNESS_RESULT_RECORD_KIND = "SEARCH_ROBUSTNESS_RESULT" as const;

/** 单组合结果 schema 版本。 */
export const SEARCH_ROBUSTNESS_RESULT_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 参数值别名（与既有研究域同域；不新建第二套值域）
// ---------------------------------------------------------------------------

/** 参数取值（唯一权威 = `research/types.ts#ResearchParameterValue`）。 */
export type RobustnessParameterValue = ResearchParameterValue;

// ---------------------------------------------------------------------------
// 分析配置（规格 §5.3：可配置 / 持久化到 Run / 不写死前端 / 不随单次数据动态改变）
// ---------------------------------------------------------------------------

/**
 * 稳定性判定口径。
 *
 * 🔴 纪律（规格 §5.3）：本口径**必须持久化到 Robustness Run**，且**不得**根据某一次
 *   搜索结果动态调整（那会让「稳定性」变成事后拟合的结论）。前端只传递、不解释。
 */
export interface RobustnessAnalysisConfig {
  /**
   * 收益容差（百分点）：邻居 `|totalReturnPct − 基准 totalReturnPct| <= 该值` 视为收益稳定。
   * 缺省 {@link DEFAULT_RETURN_TOLERANCE_PCT}。取值域 `[0, 1000]`。
   */
  readonly returnTolerancePct?: number;
  /**
   * 回撤容差（百分点）：邻居 `|maxDrawdownPct − 基准 maxDrawdownPct| <= 该值` 视为回撤稳定。
   * 缺省 {@link DEFAULT_DRAWDOWN_TOLERANCE_PCT}。取值域 `[0, 1000]`。
   */
  readonly drawdownTolerancePct?: number;
  /**
   * 邻域半径（**步数**，整数 >= 1）：沿单个参数轴取 ±1..±neighborDistance 步。
   * 缺省 {@link DEFAULT_NEIGHBOR_DISTANCE}。
   */
  readonly neighborDistance?: number;
  /**
   * 判定「邻域证据充分」所需的最少**有效**邻居数（整数 >= 1）。
   * 有效 = 组合存在 ∧ 读数可用 ∧ `tradeCount > 0`。
   * 不足 ⇒ `INSUFFICIENT_NEIGHBORHOOD`（**不**判 stable，也**不**判 unstable）。缺省 1。
   */
  readonly minValidNeighbors?: number;
}

/** 解析后的口径（全字段有限、自描述；进入 Robustness Run）。 */
export interface ResolvedRobustnessAnalysisConfig {
  readonly returnTolerancePct: number;
  readonly drawdownTolerancePct: number;
  readonly neighborDistance: number;
  readonly minValidNeighbors: number;
}

/** 收益容差缺省（百分点）。 */
export const DEFAULT_RETURN_TOLERANCE_PCT = 5;

/** 回撤容差缺省（百分点）。 */
export const DEFAULT_DRAWDOWN_TOLERANCE_PCT = 5;

/** 邻域半径缺省（步数）。 */
export const DEFAULT_NEIGHBOR_DISTANCE = 1;

/** 邻域证据充分所需最少有效邻居数缺省。 */
export const DEFAULT_MIN_VALID_NEIGHBORS = 1;

/** 邻域半径上限（防止单次分析展开过多邻居；超出响亮拒绝，不静默夹取）。 */
export const MAX_NEIGHBOR_DISTANCE = 8;

/** 容差上限（百分点）。 */
export const MAX_TOLERANCE_PCT = 1000;

/** 解析后的口径缺省（冻结）。 */
export const DEFAULT_ROBUSTNESS_ANALYSIS_CONFIG: Readonly<ResolvedRobustnessAnalysisConfig> =
  Object.freeze({
    returnTolerancePct: DEFAULT_RETURN_TOLERANCE_PCT,
    drawdownTolerancePct: DEFAULT_DRAWDOWN_TOLERANCE_PCT,
    neighborDistance: DEFAULT_NEIGHBOR_DISTANCE,
    minValidNeighbors: DEFAULT_MIN_VALID_NEIGHBORS,
  });

// ---------------------------------------------------------------------------
// 指标读数（从 parameter_search_result **原样读取**，禁止重算）
// ---------------------------------------------------------------------------

/**
 * 单个组合的指标读数（**源结果行的冻结副本**）。
 *
 * 🔴 全部字段来自 `parameter_search_result` 既有列，本域**不做任何派生计算**
 *   （规格 §10 / §21 B）。缺失一律 `null`，**绝不** `null → 0`。
 */
export interface RobustnessMetricsSnapshot {
  readonly totalReturnPct: number | null;
  readonly annualizedReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly tradeCount: number | null;
  readonly winRatePct: number | null;
  readonly profitFactor: number | null;
}

/** 可做离散度统计的指标（规格 §5.1）。 */
export const ROBUSTNESS_DISPERSION_METRICS = [
  "totalReturnPct",
  "annualizedReturnPct",
  "maxDrawdownPct",
  "tradeCount",
  "winRatePct",
  "profitFactor",
] as const;
export type RobustnessDispersionMetric = (typeof ROBUSTNESS_DISPERSION_METRICS)[number];

/** 单个指标的邻域离散度（描述性统计；`count = 0` 时全部统计字段为 null，不编造 0）。 */
export interface RobustnessDispersion {
  readonly metric: RobustnessDispersionMetric;
  /** 参与统计的样本数（基准 + 有效邻居，均要求 `tradeCount > 0` 且该指标非 null）。 */
  readonly count: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly min: number | null;
  readonly max: number | null;
  /** 总体标准差（与 `shared/quant-stats#standardDeviation` 同口径）。 */
  readonly stdDev: number | null;
  /** 极差 = max − min。 */
  readonly range: number | null;
}

// ---------------------------------------------------------------------------
// 邻域
// ---------------------------------------------------------------------------

/** 邻居条目的可用性判据（**唯一口径**；统计与展示共用，不各写一份）。 */
export type RobustnessNeighborAvailability =
  /** 该组合在源 Search 中不存在（= 缺失格，**禁补值**）。 */
  | "MISSING_COMBINATION"
  /** 组合存在，但源结果失败 / 一行结果都没有。 */
  | "NO_METRICS"
  /** 组合存在且有读数，但 `tradeCount = 0` ⇒ 无交易活动，不当有效样本（规格 §11）。 */
  | "INSUFFICIENT_TRADING_ACTIVITY"
  /**
   * 组合存在、有交易活动，但**容差判定所需的两个指标**（`totalReturnPct` / `maxDrawdownPct`）
   * 任一为 null ⇒ 无法判「在不在容差内」。如实单列，**不**降级成「不稳定」也不降级成「稳定」。
   */
  | "METRICS_INCOMPLETE"
  /** 组合存在、读数完整、有交易活动 ⇒ 计入 `validNeighborCount`。 */
  | "VALID";

/**
 * 单条邻居（**轴对齐**：一次只沿一个参数轴走 ±stepOffset 步）。
 *
 * 🔴 为什么是轴对齐而不是「全维度 ±1 笛卡尔积」：规格 §3.2 的示例是
 *   `entryDay ± 1` / `pullbackDepth ± step` —— 即单轴移动。轴对齐让每条邻居都有明确的
 *   `axis` 归属，敏感性（§5.2）才能按参数归因；全维笛卡尔积在 3 个参数时是 3^3−1=26 条，
 *   且一条邻居同时改变多个参数 ⇒ **归因不干净**（对齐 C-18.1「单一扰动 = 只改一轴」的既有哲学）。
 */
export interface RobustnessNeighbor {
  /** 沿哪个参数轴移动（= 该参数名）。 */
  readonly axis: string;
  /** 步偏移（负数 = 向小值方向；非 0）。 */
  readonly stepOffset: number;
  /** 邻居的参数取值（由**冻结快照的有序取值序列**推得；不是猜的）。 */
  readonly parameters: Readonly<Record<string, RobustnessParameterValue>>;
  /** 邻居组合的稳定身份（`parameterHash`）；组合不存在时为 null。 */
  readonly parameterHash: string | null;
  readonly availability: RobustnessNeighborAvailability;
  readonly metrics: RobustnessMetricsSnapshot | null;
  /** 相对基准的收益变化（百分点）= 邻居 − 基准；不可用为 null。 */
  readonly deltaTotalReturnPct: number | null;
  /** 相对基准的回撤变化（百分点）= 邻居 − 基准（正数 = 回撤更深）；不可用为 null。 */
  readonly deltaMaxDrawdownPct: number | null;
  /** 是否满足双容差（**要求收益与回撤同时**在容差内）；不可用为 null。 */
  readonly withinTolerance: boolean | null;
  /** 不可用的如实原因（`availability !== "VALID"` 时非空）。 */
  readonly unavailableReason: string | null;
}

// ---------------------------------------------------------------------------
// 敏感性（规格 §5.2）
// ---------------------------------------------------------------------------

/**
 * 单个参数轴上的敏感性条目（一次只改这一个参数）。
 *
 * 🔴 枚举 / 布尔参数**只给离散变化**（`relativeChange = null`）—— 对 `"main" → "gem"` 算
 *   「相对变化百分比」是没有意义的（规格 §5.2「对枚举参数只计算离散变化，不制造连续意义」）。
 */
export interface RobustnessSensitivityEntry {
  readonly axis: string;
  readonly stepOffset: number;
  readonly parameterHash: string | null;
  /** 绝对变化（百分点）= 邻居指标 − 基准指标。 */
  readonly absoluteChangePct: number | null;
  /**
   * 相对变化 = 绝对变化 / |基准值|。
   * **仅数值型参数且基准值 ≠ 0 时才有值**；其余为 null（不制造连续意义）。
   */
  readonly relativeChange: number | null;
  readonly withinTolerance: boolean | null;
}

/** 单参数敏感性汇总（面向参数维度；用于 `robustness_parameter_analysis`）。 */
export interface RobustnessParameterSensitivity {
  readonly parameter: string;
  /** 该参数在冻结快照里的搜索域形态（`FIXED` / `ENUM` / `INTEGER_RANGE` / `DECIMAL_RANGE`）。 */
  readonly domainMode: string;
  /** 参数取值是否为数值型（决定是否给相对变化）。 */
  readonly numeric: boolean;
  readonly entries: readonly RobustnessSensitivityEntry[];
  /** 有绝对变化可用的条目数。 */
  readonly measuredCount: number;
  readonly meanAbsoluteChangePct: number | null;
  readonly maxAbsoluteChangePct: number | null;
  readonly meanRelativeChange: number | null;
  readonly maxRelativeChange: number | null;
}

// ---------------------------------------------------------------------------
// 单组合稳定性结论
// ---------------------------------------------------------------------------

/**
 * 单组合的稳定性状态（规格 §6 / §11 / §3.2）。
 *
 * - `STABLE`                        全部有效邻居都在双容差内（且有效邻居数达标）；
 * - `UNSTABLE`                      存在有效邻居超出容差（且有效邻居数达标）；
 * - `INSUFFICIENT_TRADING_ACTIVITY` 基准组合自身 `tradeCount = 0` ⇒ 无交易活动，**不判稳也不判不稳**；
 * - `INSUFFICIENT_NEIGHBORHOOD`     有效邻居数 < `minValidNeighbors`（含 0）⇒ 证据不足；
 * - `SOURCE_RESULT_UNAVAILABLE`     源结果失败 / 指标不可用 ⇒ 无从判定。
 */
export type RobustnessCombinationStatus =
  | "STABLE"
  | "UNSTABLE"
  | "INSUFFICIENT_TRADING_ACTIVITY"
  | "INSUFFICIENT_NEIGHBORHOOD"
  | "SOURCE_RESULT_UNAVAILABLE";

/** 单组合稳健性结果（规格 §15；落 `search_robustness_result` 一行）。 */
export interface SearchRobustnessResult {
  readonly recordKind: typeof SEARCH_ROBUSTNESS_RESULT_RECORD_KIND;
  readonly recordVersion: typeof SEARCH_ROBUSTNESS_RESULT_RECORD_VERSION;
  readonly robustnessRunId: string;
  readonly sourceSearchRunId: string;
  /** 源组合的稳定身份（组合身份唯一权威 = `parameterHash`）。 */
  readonly parameterHash: string;
  /** 源组合序号（展示与稳定排序用，**不作身份**）。 */
  readonly combinationIndex: number;
  readonly parameters: Readonly<Record<string, RobustnessParameterValue>>;
  /** 指标读数（源结果冻结副本；**未重算**）。 */
  readonly metrics: RobustnessMetricsSnapshot;
  /** 源结果的指标来源（`canonical` / `evaluators`；已验证全部为 canonical）。 */
  readonly metricsSource: string;
  readonly status: RobustnessCombinationStatus;
  /** `stable === true` 仅当 `status === "STABLE"`；其余（含证据不足）一律 false，不冒充。 */
  readonly stable: boolean;
  /** 邻域稳定性比例 = `stableNeighborCount / validNeighborCount`；无有效邻居为 null。 */
  readonly stabilityRatio: number | null;
  readonly stableNeighborCount: number;
  readonly validNeighborCount: number;
  /** 冻结空间内**理论上**存在的邻居数（沿各轴 ±1..±distance 步，去重、排除自身）。 */
  readonly expectedNeighborCount: number;
  /** 其中在源 Search 里**真实存在组合**的数量。 */
  readonly presentNeighborCount: number;
  /** 邻域不完整（`presentNeighborCount < expectedNeighborCount`）⇒ 规格 §3.2 的 `NEIGHBORHOOD_INCOMPLETE`。 */
  readonly neighborhoodIncomplete: boolean;
  /** 判定不可用的如实原因（如「源结果失败」「tradeCount=0」「有效邻居 0 < 要求 1」）。 */
  readonly statusReason: string | null;
  readonly neighbors: readonly RobustnessNeighbor[];
  readonly dispersion: readonly RobustnessDispersion[];
  readonly sensitivity: readonly RobustnessParameterSensitivity[];
  /** 内容指纹（sha256；除本字段外全部字段的 canonical JSON 摘要）。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 多参数二维稳定性矩阵（规格 §7 / §18）
// ---------------------------------------------------------------------------

/** 矩阵轴（一个参数的有序取值序列）。 */
export interface RobustnessMatrixAxis {
  readonly parameter: string;
  readonly domainMode: string;
  /** **有序**取值序列（顺序 = 冻结搜索域的取值顺序；不是字典序猜测）。 */
  readonly values: readonly RobustnessParameterValue[];
}

/** 矩阵单元格（**缺失格如实标 `MISSING`，禁补值**）。 */
export interface RobustnessMatrixCell {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly rowValue: RobustnessParameterValue;
  readonly columnValue: RobustnessParameterValue;
  /** 该格组合的 `parameterHash`；不存在为 null；**多命中时为 null**（见 `matchedCount`）。 */
  readonly parameterHash: string | null;
  readonly present: boolean;
  /**
   * 该格组合的稳定性状态。
   * - `MISSING`   该格 (rowValue, columnValue) 在源 Search 里没有对应组合 ⇒ **不补值**；
   * - `AMBIGUOUS` 搜索空间里**多于两个**可变参数 ⇒ 该格命中多条组合，无法唯一归属
   *               （如实标注，不挑一条当代表）。
   */
  readonly status: RobustnessCombinationStatus | "MISSING" | "AMBIGUOUS";
  readonly stable: boolean | null;
  readonly stabilityRatio: number | null;
  readonly totalReturnPct: number | null;
  readonly tradeCount: number | null;
  /** 命中该格的源组合数（0 = 缺失；> 1 = 需配合 `omittedParameters` 解读）。 */
  readonly matchedCount: number;
}

/** 二维稳定性矩阵（规格 §18：单元格显示 stabilityRatio 或 状态；**不做单一颜色好坏表达**）。 */
export interface RobustnessMatrix {
  readonly rowAxis: RobustnessMatrixAxis;
  readonly columnAxis: RobustnessMatrixAxis;
  /** 行优先展开（`rowIndex * columnAxis.values.length + columnIndex`）。 */
  readonly cells: readonly RobustnessMatrixCell[];
  /** 冻结空间里的 TUNABLE 参数总数（> 2 时矩阵只取前两个，其余如实登记在 `omittedParameters`）。 */
  readonly parameterCount: number;
  readonly omittedParameters: readonly string[];
}

// ---------------------------------------------------------------------------
// Run 汇总（规格 §17 Detail）
// ---------------------------------------------------------------------------

/** Run 级汇总（详情页直接消费；全部为**实数**，不含任何「推荐 / 最佳」语义）。 */
export interface SearchRobustnessSummary {
  /** 源 Search Run 的组合总数。 */
  readonly sourceCombinationCount: number;
  /** 源结果可用并进入分析（含判定为证据不足）的组合数。 */
  readonly analyzedCombinationCount: number;
  /** 状态 STABLE 的组合数。 */
  readonly stableCount: number;
  /** 状态 UNSTABLE 的组合数。 */
  readonly unstableCount: number;
  /** 状态 INSUFFICIENT_TRADING_ACTIVITY 的组合数。 */
  readonly insufficientTradingActivityCount: number;
  /** 状态 INSUFFICIENT_NEIGHBORHOOD 的组合数。 */
  readonly insufficientNeighborhoodCount: number;
  /** 状态 SOURCE_RESULT_UNAVAILABLE 的组合数。 */
  readonly sourceResultUnavailableCount: number;
  /** 邻域不完整的组合数（`NEIGHBORHOOD_INCOMPLETE`）。 */
  readonly neighborhoodIncompleteCount: number;
  /** 参数引用未验证（源 Run 未做死参数筛查 / 历史行无该字段）。 */
  readonly parameterReferenceUnverified: boolean;
  /** 判定参数引用未验证的如实原因。 */
  readonly parameterReferenceNote: string;
}

// ---------------------------------------------------------------------------
// Robustness Run（规格 §9 / §14）
// ---------------------------------------------------------------------------

/**
 * 一次稳健性分析的完整记录（**冻结快照**，不随未来策略修改重新解释）。
 *
 * 规格 §9 的硬要求：必须保存 `sourceSearchRunId` / `strategyVersionId` / `datasetVersionId` /
 * 源 Run 的参数空间快照 / 源 Run 的 FIXED 坐标 / `evaluationConfigFingerprint`；
 * 并且**不重新读取当前 Strategy Version**。
 */
export interface SearchRobustnessRun {
  readonly recordKind: typeof SEARCH_ROBUSTNESS_RUN_RECORD_KIND;
  readonly recordVersion: typeof SEARCH_ROBUSTNESS_RUN_RECORD_VERSION;
  readonly robustnessRunId: string;
  /** 唯一输入事实源（规格 §8）。 */
  readonly sourceSearchRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly searchMethod: string;
  /** 源 Run 的**参数空间冻结快照**（原样继承，不重读当前策略版本）。 */
  readonly searchSnapshot: ParameterSearchSpaceDefinition;
  /** 源 Run 的快照指纹（原样继承；用于证明「分析的是哪一份冻结空间」）。 */
  readonly searchSnapshotFingerprint: string;
  /** 源 Run 的 FIXED 坐标快照（原样继承）。 */
  readonly fixedCoordinates: Readonly<Record<string, RobustnessParameterValue>>;
  readonly executionPolicyVersion: number;
  readonly evaluationConfigFingerprint: string;
  /**
   * 源 Search Run 是否做过「死参数」筛查（继承 PARAMETER-002）。
   * `null` = 源 Run 落库时还没有该字段（历史行）⇒ 视为未验证。
   */
  readonly sourceReferenceCheckApplied: boolean | null;
  /** 源 Run 排除掉的死参数 code（继承；空数组 = 无 / 未知）。 */
  readonly sourceUnreferencedTunableCodes: readonly string[];
  /** 稳定性判定口径（**持久化**；不写死前端、不随数据变化）。 */
  readonly analysisConfig: ResolvedRobustnessAnalysisConfig;
  readonly status: ParameterSearchRunStatus;
  readonly summary: SearchRobustnessSummary;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  /** 内容指纹（sha256；除本字段外全部字段的 canonical JSON 摘要）。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 单参数分析（规格 §13 的 `robustness_parameter_analysis`）
// ---------------------------------------------------------------------------

/**
 * 单参数的敏感性判定（**描述性**，不是「该参数好不好」）。
 *
 * - `sensitive`    该参数轴上存在至少一条**有效**邻居超出容差；
 * - `insensitive`  该参数轴上**所有**有效邻居都在容差内（且至少有一条有效邻居）；
 * - `insufficient` 该参数轴上没有任何有效邻居 ⇒ 证据不足。
 */
export type RobustnessParameterSensitivityVerdict =
  | "sensitive"
  | "insensitive"
  | "insufficient";

/** 单参数分析记录（落 `search_robustness_parameter_analysis` 一行）。 */
export interface SearchRobustnessParameterAnalysis {
  readonly robustnessRunId: string;
  readonly sourceSearchRunId: string;
  readonly parameterName: string;
  readonly domainMode: string;
  /** 冻结搜索域里的取值个数。 */
  readonly domainValueCount: number;
  readonly numeric: boolean;
  /** 参与分析的参数取值数（该取值上至少有 1 个被分析过的基组合）。 */
  readonly analyzedValueCount: number;
  /** 该参数各取值切片上，基组合判为 STABLE / UNSTABLE 的数量（**分布**，不是排名）。 */
  readonly stableCombinationCount: number;
  readonly unstableCombinationCount: number;
  /** 该参数轴上的敏感性条目（一次只动这一个参数）。 */
  readonly sensitivity: RobustnessParameterSensitivity;
  /**
   * 该参数**取值维**的指标离散度：每个取值先在其切片内取均值，再对这些"每值均值"做
   * mean / median / min / max / stdDev / range（与单组合的**邻域维**离散度不同层）。
   */
  readonly valueDispersion: readonly RobustnessDispersion[];
  readonly verdict: RobustnessParameterSensitivityVerdict;
  /** 内容指纹（sha256）。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 分析输入（纯函数入口；**不经 DB**）
// ---------------------------------------------------------------------------

/** 源组合（从 `parameter_search_combination` 行读出的最小面）。 */
export interface RobustnessSourceCombination {
  readonly parameterHash: string;
  readonly combinationIndex: number;
  readonly parameters: Readonly<Record<string, RobustnessParameterValue>>;
}

/** 源结果（从 `parameter_search_result` 行读出的最小面）。 */
export interface RobustnessSourceResult {
  readonly parameterHash: string;
  readonly status: string;
  readonly error: string | null;
  readonly metricsSource: string;
  readonly metrics: RobustnessMetricsSnapshot;
}

/** 一次分析的输入（全部已从库读出；本层零 IO）。 */
export interface RobustnessAnalysisInput {
  /** 聚合器身份：本次分析的承接者（恒由调用方注入，保证同输入同产物）。 */
  readonly robustnessRunId: string;
  readonly sourceSearchRunId: string;
  /** 源 Search Run 的**冻结**参数空间快照（规格 §9）。 */
  readonly searchSnapshot: ParameterSearchSpaceDefinition;
  readonly combinations: readonly RobustnessSourceCombination[];
  readonly results: readonly RobustnessSourceResult[];
  readonly config: ResolvedRobustnessAnalysisConfig;
}

/** 分析产物（喂给落库层；纯数据）。 */
export interface RobustnessAnalysisOutcome {
  readonly results: readonly SearchRobustnessResult[];
  /** 单参数分析（规格 §13；每个进入搜索空间的参数一行）。 */
  readonly parameterAnalyses: readonly SearchRobustnessParameterAnalysis[];
  readonly matrix: RobustnessMatrix;
  readonly summary: SearchRobustnessSummary;
  /** 分析过程中的如实说明（缺格 / 跳过原因计数等；不静默）。 */
  readonly notes: readonly string[];
}
