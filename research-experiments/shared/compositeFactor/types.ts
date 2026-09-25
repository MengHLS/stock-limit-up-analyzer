/**
 * COMPOSITE_FACTOR_EXPERIMENT_V1 —— 组合因子通用实验模板：**契约常量与类型**（唯一真源）。
 *
 * ## 这个模板是什么
 *
 * `SINGLE_FACTOR_EXPERIMENT_V1`（`shared/singleFactor/**`）已经把「横截面排序 → 取 TopN →
 * 统一入场退出 → 等权 → 对标当日池」这一整套**交易与结果基础能力**做完了。
 * 本模板**不重复**其中任何一件，只补上单因子模板没有的那一件事：
 *
 * ```
 * 多个因子 → 方向调整 → 统一标准化 → 加权 → 合成分 → 用合成分当排序键
 * ```
 *
 * 之后把合成分**当作单因子模板里的 `factorValue`** 交给它 ——
 * 排序（`ranker`）、仓位与成本（`positionCost`）、基准（`benchmark`）、
 * 指标与显著性（`metrics`）、PIT（`pitAccess`）、入场退出与逐笔对拍（`entryExit`）
 * 全部**原样复用**，本模板一行都不重写。
 *
 * ## 冻结口径（与 SINGLE_FACTOR_EXPERIMENT_V1 完全一致）
 *
 * ```
 * experimentType  = COMPOSITE_FACTOR
 * Universe        = 首板回踩候选池（= 12F 入池池，唯一实现在 derive.ts）
 * T               = 首板日（rd = 0）
 * Observation     = T+1 .. T+5            ← 观察窗，**不是**重复买入窗
 * Signal          = T+5 收盘（信息截止）
 * Entry           = T+6 开盘（`canBuyAtOpen === true`）
 * Exit            = T+10 收盘（不可卖则顺延到其后第一个可卖日，≤ T+20）
 * Position        = Equal Weight
 * Cost            = 往返 20 bps
 * Ranking         = 按 Composite Score 排名（Composition 内部已按成员方向调整；
 *                   单因子模板的 HIGH / LOW 由**成员方向**承担，见 §一）
 * TopN            = 3 / 5 / 10 / 20（四档**都必须跑**）
 * Benchmark       = 当日全部符合条件的候选股票（等权）
 * TimeSlice       = 按年
 * ```
 *
 * 🔴 坐标**不是**本模板新发明的：入场 `T+6` / 退出 `T+10` / 成本 `20 bps` 的唯一实现在
 * `shared/singleFactor/coordinate.ts`（它自己又指向 `FROZEN-BUCKET-CONTRACT-001`），
 * 因此组合因子实验结果与单因子 / 12F / Top-N 三个实验**逐笔可比**。
 */

import type { SingleFactorCatalogEntry } from "../singleFactor/factorResolver";
import type {
  SingleFactorComboResult,
  SingleFactorMetrics,
  SingleFactorSample,
  SingleFactorTrade,
} from "../singleFactor/types";

// ---------------------------------------------------------------------------
// 一、模板身份
// ---------------------------------------------------------------------------

/** 模板编号（写进 `customPayload.templateId`，事后可审计「这批实验用的是哪一版模板」）。 */
export const COMPOSITE_FACTOR_TEMPLATE_ID = "COMPOSITE_FACTOR_EXPERIMENT_V1";
/** 实验类型（模板要求 `experimentType = COMPOSITE_FACTOR`）。 */
export const COMPOSITE_FACTOR_EXPERIMENT_TYPE = "COMPOSITE_FACTOR";
/** 本模板自己的契约编号（合成口径：方向 / 标准化 / 权重 / 排名），与 FBC-001（分桶口径）区分。 */
export const COMPOSITE_FACTOR_CONTRACT_ID = "CF-V1-001";

/**
 * 计算引擎版本（改动口径必须升）。
 *
 * 🔴 放在 `types.ts` 而不是 `assemble.ts`：`types.ts` **不依赖任何 node 内置模块**，
 *    因此实例的 `page.tsx` 可以安全地从 `result.ts` 取到它（浏览器 bundle 里不能出现 `node:zlib`）。
 */
export const COMPUTATION_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// 二、成员方向（factor direction）
// ---------------------------------------------------------------------------

/**
 * 成员方向。
 *
 * - `HIGH` = 该因子**值越大越优** ⇒ 方向调整后「大的得高分」；
 * - `LOW`  = 该因子**值越小越优** ⇒ 方向调整后「小的得高分」。
 *
 * 🔴 与 `SINGLE_FACTOR_EXPERIMENT_V1` 的 `RankingDirection`（HIGH / LOW）**同名同义**：
 *    单因子模板用它决定排序方向，本模板用它决定**成员贡献的方向调整**。
 *    两者不是两套语义，而是同一件事在「单一排序键」与「合成键」两种形态下的落点。
 */
export const FACTOR_DIRECTIONS = ["HIGH", "LOW"] as const;
export type FactorDirection = (typeof FACTOR_DIRECTIONS)[number];

export const FACTOR_DIRECTION_LABELS: Readonly<Record<FactorDirection, string>> = {
  HIGH: "HIGH（因子值越大越优）",
  LOW: "LOW（因子值越小越优）",
};

/** 方向 ⇒ 符号。`+1` 保持标准化值，`-1` 取 `1 − 标准化值`。 */
export function directionSignOf(direction: FactorDirection): 1 | -1 {
  return direction === "HIGH" ? 1 : -1;
}

// ---------------------------------------------------------------------------
// 三、统一标准化（normalization）
// ---------------------------------------------------------------------------

/**
 * 标准化方法（**统一**：一次 Run 内所有成员用同一种）。
 *
 * | 方法 | 定义 | 取值范围 | 适用 |
 * | --- | --- | --- | --- |
 * | `BUCKET_POSITIONAL` | `(idx + 0.5) / k`，桶位中点（FBC §3.1） | `(0, 1)` | 已有冻结桶词表的因子（12 个现有因子） |
 * | `CROSS_SECTION_PERCENTILE` | `count(同日 peer ≤ v) / N` | `(0, 1]` | 尚无冻结桶的新因子 |
 *
 * 🔴 两种方法都**只做「同一个值 → 同一个分」的单调映射**，不引入任何拟合、不搜索参数
 *    （沿用 FBC-2 / FBC-3 的「不重估边界」纪律）。
 * ⚠️ 跨方法不可比：换方法等于换排序键，结果必须重新跑，不得与旧 Run 混引。
 */
export const NORMALIZATION_METHODS = [
  "BUCKET_POSITIONAL",
  "CROSS_SECTION_PERCENTILE",
] as const;
export type NormalizationMethod = (typeof NORMALIZATION_METHODS)[number];

export const NORMALIZATION_LABELS: Readonly<Record<NormalizationMethod, string>> = {
  BUCKET_POSITIONAL: "冻结桶位分 (idx+0.5)/k（FROZEN-BUCKET-CONTRACT-001 §3.1）",
  CROSS_SECTION_PERCENTILE: "同日横截面百分位 count(peer ≤ v)/N",
};

/**
 * 模板默认标准化方法。
 *
 * 🔴 默认必须取 `BUCKET_POSITIONAL`：只有它与 12F / Top-N 两个既有实验的评分口径**逐位相同**，
 *    因此「12 因子等权」实例的结果可与 `first-board-pullback/twelve-factor-topn-ranking-study`
 *    的对应档位**逐位对拍**（模板正确性的判据，见实例 README）。
 */
export const DEFAULT_NORMALIZATION_METHOD: NormalizationMethod = "BUCKET_POSITIONAL";

// ---------------------------------------------------------------------------
// 四、权重（weighting）
// ---------------------------------------------------------------------------

export const WEIGHTING_MODES = ["EQUAL", "CUSTOM"] as const;
export type WeightingMode = (typeof WEIGHTING_MODES)[number];

/** 等权：每个成员 `1/n`（第一阶段**只用**这一种）。 */
export interface EqualWeighting {
  readonly mode: "EQUAL";
}

/**
 * 自定义权重：**接口已预留，第一阶段不启用**。
 *
 * 契约（`resolveWeights` 强制，违反即响亮失败）：
 * - 键集合必须与成员集合**完全相等**（少一个 / 多一个都抛错）；
 * - 每个权重必须是**有限正数**（`0` 与负数都不接受 —— 权重为 0 等于偷偷删因子）；
 * - 归一化到 Σw = 1 后使用（因此「权重 3:1」与「0.75:0.25」等价）。
 */
export interface CustomWeighting {
  readonly mode: "CUSTOM";
  readonly weights: Readonly<Record<string, number>>;
}

export type WeightingSpec = EqualWeighting | CustomWeighting;

export const DEFAULT_WEIGHTING: WeightingSpec = { mode: "EQUAL" };

// ---------------------------------------------------------------------------
// 五、TopN 与组合档位
// ---------------------------------------------------------------------------

/** TopN 档位（**固定四档**；不得改成「跑完再挑」）。与单因子模板逐字一致。 */
export const COMPOSITE_TOP_N_SIZES = [3, 5, 10, 20] as const;
export type CompositeTopNSize = (typeof COMPOSITE_TOP_N_SIZES)[number];

/**
 * 组合档位 = 4 档 TopN（`N3` / `N5` / `N10` / `N20`）。
 *
 * 🔴 与单因子模板的差别：单因子要跑 2 方向 × 4 档 = 8 个组合（方向是那个实验的问题）；
 *    本模板的方向已经进入**成员的方向调整**，合成分只有一个（越大越优），
 *    所以档位只有 TopN 一维 = 4 个，全部静态枚举、全部落进结果。
 */
export interface CompositeCombo {
  /** 档位 id，形如 `N3`。 */
  readonly id: string;
  readonly size: CompositeTopNSize;
  readonly label: string;
}

export const COMPOSITE_COMBOS: readonly CompositeCombo[] =
  COMPOSITE_TOP_N_SIZES.map(size => ({
    id: `N${size}`,
    size,
    label: `Top-${size}`,
  }));

export function comboIdOfSize(size: CompositeTopNSize): string {
  return `N${size}`;
}

/**
 * 日集口径。
 *
 * - `OWN`（默认，与 SINGLE_FACTOR_EXPERIMENT_V1 一致）：当日可用样本 ≥ 该档的 N 才纳入该档；
 * - `FIXED`：所有档位共用同一日集（当日可用样本 ≥ 最大档 N）。
 *
 * 🔴 为什么要两种：`OWN` 下 N3 与 N20 的日集**不同**，直接比较两档的均值是拿两份不同的日子比。
 *    「跨 N 的深度比较」必须在 `FIXED` 日集上读。这不是新算法，而是把
 *    `twelve-factor-topn-ranking-study` 已有的 OWN / DEEP 两口径登记进模板。
 */
export const DAY_SCOPES = ["OWN", "FIXED"] as const;
export type CompositeDayScope = (typeof DAY_SCOPES)[number];

export const DAY_SCOPE_LABELS: Readonly<Record<CompositeDayScope, string>> = {
  OWN: "本职日集（当日可用样本 ≥ 该档 N）",
  FIXED: `固定日集（当日可用样本 ≥ ${COMPOSITE_TOP_N_SIZES[COMPOSITE_TOP_N_SIZES.length - 1]}）`,
};

// ---------------------------------------------------------------------------
// 六、成员（member）
// ---------------------------------------------------------------------------

/**
 * 组合模板要求的最小成员声明：**一个 code + 一个方向**。
 *
 * 🔴 「不修改已有 12 因子定义」这条要求的兑现方式：本接口**不携带**任何因子定义
 *    （边界、`bucketOf`、原始值算法都不在这里），它只是「把契约里已有的那条因子
 *    按某个方向纳入组合」这一句话。定义仍然只有一份，在
 *    `twelve-factor-composite-study/result.ts`（FROZEN-BUCKET-CONTRACT-001 的唯一落地处）。
 */
export interface CompositeMemberSpec {
  readonly code: string;
  readonly direction: FactorDirection;
  /** 冻结契约的方向位（`+1` = 桶越大分越高）；缺省由 `direction` 推出。 */
  readonly orientation?: 1 | -1;
}

/** 一个可被组合模板使用的成员（= 声明 + 从冻结契约适配来的取值函数）。 */
export interface CompositeMember extends Required<CompositeMemberSpec> {
  readonly label: string;
  readonly source: string;
  readonly priorVerified: boolean;
  /** 冻结桶标签（升序）；仅留档。 */
  readonly buckets: readonly string[];
  /** 成员契约指纹（`code|orientation|priorVerified|buckets`）。 */
  readonly contractFingerprint: string;
  /**
   * 原始因子值。
   *
   * 🔴 类型**直接复用**单因子引擎的目录项签名（`SingleFactorCatalogEntry["valueOf"]`），
   *    而不是另写一个等价签名 —— 否则两个模板的成员抽象会随时间各走一条路。
   */
  readonly valueOf: SingleFactorCatalogEntry["valueOf"];
  /**
   * 桶位分（`BUCKET_POSITIONAL`）；`null` = 该成员没有冻结桶词表
   * ⇒ 用 `BUCKET_POSITIONAL` 跑会**响亮失败**（不是静默跳过）。
   */
  readonly bucketScoreOf: ((value: number | null) => number | null) | null;
}

// ---------------------------------------------------------------------------
// 七、模板配置
// ---------------------------------------------------------------------------

export interface CompositeTemplateSpec {
  readonly templateId: typeof COMPOSITE_FACTOR_TEMPLATE_ID;
  readonly experimentType: typeof COMPOSITE_FACTOR_EXPERIMENT_TYPE;
  readonly contractId: typeof COMPOSITE_FACTOR_CONTRACT_ID;
  readonly members: readonly CompositeMemberSpec[];
  readonly normalization: NormalizationMethod;
  readonly weighting: WeightingSpec;
  readonly topNSizes: readonly CompositeTopNSize[];
  readonly dayScopes: readonly CompositeDayScope[];
}

export function defineCompositeTemplateSpec(
  input: Omit<
    CompositeTemplateSpec,
    "templateId" | "experimentType" | "contractId" | "topNSizes" | "dayScopes"
  > &
    Partial<Pick<CompositeTemplateSpec, "topNSizes" | "dayScopes">>
): CompositeTemplateSpec {
  return {
    templateId: COMPOSITE_FACTOR_TEMPLATE_ID,
    experimentType: COMPOSITE_FACTOR_EXPERIMENT_TYPE,
    contractId: COMPOSITE_FACTOR_CONTRACT_ID,
    members: input.members,
    normalization: input.normalization,
    weighting: input.weighting,
    topNSizes: input.topNSizes ?? COMPOSITE_TOP_N_SIZES,
    dayScopes: input.dayScopes ?? DAY_SCOPES,
  };
}

// ---------------------------------------------------------------------------
// 八、合成过程的中间量（审计用）
// ---------------------------------------------------------------------------

/** 一个成员对某个样本的贡献（**留档**：证明合成分是怎么来的，可逐项复核）。 */
export interface CompositeContribution {
  readonly code: string;
  readonly direction: FactorDirection;
  /** 原始因子值（`null` = 该样本在此成员上不可评估 ⇒ 整条样本不可评分）。 */
  readonly rawValue: number | null;
  /** 标准化后的值（**未做**方向调整）。 */
  readonly normalized: number | null;
  /** 方向调整后的值（`HIGH` 保持，`LOW` 取 `1 − normalized`）。 */
  readonly oriented: number | null;
  /** 本次 Run 生效的权重（已归一化，Σw = 1）。 */
  readonly weight: number;
}

/**
 * 组合样本 = 单因子样本 + 合成分。
 *
 * 🔴 `factorValue`（继承自 `SingleFactorSample`）**就是** `compositeScore` ——
 *    这是「复用单因子引擎」的实际落点：下游的排序 / 选头 / 交易 / 指标全部
 *    只认 `factorValue` 这一个排序键，因此它们不需要知道「这是合成的」。
 */
export interface CompositeSample extends SingleFactorSample {
  /** 合成分 ∈ (0, 1)。 */
  readonly compositeScore: number;
  /** 逐成员贡献（顺序 = 模板成员顺序）。 */
  readonly contributions: readonly CompositeContribution[];
}

/**
 * 组合档位的结果行 = 单因子档位结果**去掉 `trades`**。
 *
 * 逐笔明细不进 `customPayload`（4 档 × 上万笔会把结果信封撑爆），
 * 而是走「有界预览表 + 全量 CSV 产物」（见 `trades.ts`）。
 */
export type CompositeComboRow = Omit<SingleFactorComboResult, "trades">;

// ---------------------------------------------------------------------------
// 九、结果各段（Overall / TopN / Benchmark / Excess / TimeSlice）
// ---------------------------------------------------------------------------

/** Overall = **全样本**（不做任何选择）的等权组合指标。 */
export interface CompositeOverallSummary {
  readonly daysIncluded: number;
  readonly trades: number;
  readonly metrics: SingleFactorMetrics;
}

/** 基准（配对口径）= 与某档 TopN **同日集**的当日池等权。 */
export interface CompositeBenchmarkRow {
  readonly comboId: string;
  readonly sizeLabel: string;
  readonly scope: CompositeDayScope;
  readonly daysIncluded: number;
  /** 当日池等权组合的**日度均值**（净）——与 TopN 的 `portfolioMean` 同一量纲，可直接相减。 */
  readonly benchmarkMean: number | null;
  /** 当日池等权组合的**累计**净收益（复利，与 Overall 同构造）。 */
  readonly benchmarkTotalReturn: number | null;
  /** Monte-Carlo 随机 N 基准：观测值落在随机分布的哪个分位。 */
  readonly randomPercentile: number | null;
  readonly randomP50: number | null;
  readonly impliedPValue: number | null;
  readonly simulations: number;
}

/** 超额（**主判据**）= 配对日度超额 `组合日收益 − 当日池日收益`。 */
export interface CompositeExcessRow {
  readonly comboId: string;
  readonly sizeLabel: string;
  readonly scope: CompositeDayScope;
  readonly daysIncluded: number;
  readonly excessMean: number | null;
  readonly excessCi95Low: number | null;
  readonly excessCi95High: number | null;
  readonly verdict: SingleFactorComboResult["excessVerdict"];
  readonly dayWinRate: number | null;
}

/** 时间切片（按年）：同一年内 池 / 各档 的组合与超额。 */
export interface CompositeTimeSliceRow {
  readonly year: number;
  readonly comboId: string;
  readonly sizeLabel: string;
  readonly daysIncluded: number;
  readonly portfolioMean: number | null;
  readonly benchmarkMean: number | null;
  readonly excessMean: number | null;
  readonly excessCi95Low: number | null;
  readonly excessCi95High: number | null;
  readonly verdict: SingleFactorComboResult["excessVerdict"];
}

/** 决策日样本量诊断。 */
export interface CompositeDayDiagnostics {
  readonly daysTotal: number;
  readonly daysAtLeast3: number;
  readonly daysAtLeast5: number;
  readonly daysAtLeast10: number;
  readonly daysAtLeast20: number;
  readonly daySizeP50: number | null;
  readonly daySizeMean: number | null;
  readonly daySizeMax: number | null;
}

/** 逐笔明细的索引（明细本体在 CSV 产物里）。 */
export interface CompositeTradeIndexRow {
  readonly comboId: string;
  readonly sizeLabel: string;
  readonly scope: CompositeDayScope;
  readonly tradeCount: number;
  /** 预览表里实际放了几行（有界）。 */
  readonly previewRows: number;
}

/** 与既有实验的参照核对（只作自检与披露，不作为断言）。 */
export interface CompositeReferenceCheck {
  readonly referenceExperimentId: string;
  readonly referenceCandidateCount: number;
  readonly actualCandidateCount: number;
  readonly matchesCandidateCount: boolean;
  readonly referenceEligibleCount: number;
  readonly actualEligibleCount: number;
  readonly matchesEligibleCount: boolean;
}

export type { SingleFactorTrade, SingleFactorMetrics };
