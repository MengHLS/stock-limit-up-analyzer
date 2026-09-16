/**
 * RESEARCH-FINDING-001 — Finding 领域规则（**不落任何统计实现**）。
 *
 * 边界：
 *   - 本文件只做**域规则**：阈值策略 / 分级 / 强度合成 / 状态机 / 结构校验；
 *   - **不含**任何统计计算（属 `server/researchEngine/finding/`）、不读 DB、不碰 Dataset；
 *   - 与 `researchCore/candidates.ts` 同一纪律：把「什么算合法」收敛到一处，
 *     让 Engine / Repository / Router 三方共用同一条判据。
 *
 * 🔴 本文件的输出是**研究优先级**，不是策略评分（任务书 §14）。
 */

import {
  RESEARCH_FINDING_STATUSES,
  RESEARCH_FINDING_TYPES,
  RESEARCH_SAMPLE_GRADES,
  RESEARCH_STRENGTH_GRADES,
  type ResearchFinding,
  type ResearchFindingStatus,
  type ResearchFindingType,
  type ResearchSampleGrade,
  type ResearchStrengthGrade,
} from "./types";

// ---------------------------------------------------------------------------
// 免责声明（与 ConclusionBuilder 同一立场：自动发现只是研究辅助）
// ---------------------------------------------------------------------------

export const FINDING_DISCLAIMER =
  "⚠️ 自动发现仅为**研究辅助**，不等同于统计显著性或交易有效性；"
  + "研究强度只是**研究优先级**指标，不是策略评分、不构成任何买卖建议。"
  + "任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立。";

// ---------------------------------------------------------------------------
// 判定策略（全部可覆盖，且会原样快照进 `research_finding.policyJson`）
// ---------------------------------------------------------------------------

/**
 * Finding 判定策略。
 *
 * 为什么要配置化：任务书 §7 明确「这些阈值必须配置化，不要硬编码在 UI」；
 * 且阈值必须随 Finding **快照落库**，否则事后改阈值会让历史 Finding 变得不可复核。
 */
export interface FindingPolicy {
  /** §7 样本充分性分级阈值（与任务书建议值一致）。 */
  sampleWeak: number;
  sampleMedium: number;
  sampleStrong: number;
  /** 「有实际意义的差异」的最小绝对量（收益口径，0.005 = 0.5%）。 */
  materialityAbs: number;
  /** §10 视界「有效」判据：|该视界效应| ≥ 峰值 × 该比例 ⇒ 计入有效视界区间。 */
  horizonEffectiveRatio: number;
  /** §10 / §11 方向一致性下限。 */
  consistencyMin: number;
  /** §11 稳定性判定所需的最少时间切片数（不足则**不做**稳定性判定，如实置 null）。 */
  stabilityMinSlices: number;
  /** §9 单调性判定所需的最少档位数。 */
  monotonicMinBuckets: number;
  /** §14 五维加权（必须和为 1；缺失维度按「重归一化」处理，不补 0 惩罚）。 */
  weights: {
    effect: number;
    sample: number;
    stability: number;
    horizon: number;
    monotonicity: number;
  };
  /** §14 研究强度分级阈值。 */
  strengthMedium: number;
  strengthStrong: number;
}

export const DEFAULT_FINDING_POLICY: FindingPolicy = Object.freeze({
  sampleWeak: 100,
  sampleMedium: 300,
  sampleStrong: 1000,
  materialityAbs: 0.005,
  horizonEffectiveRatio: 0.6,
  consistencyMin: 0.6,
  stabilityMinSlices: 2,
  monotonicMinBuckets: 4,
  weights: { effect: 0.3, sample: 0.2, stability: 0.2, horizon: 0.15, monotonicity: 0.15 },
  strengthMedium: 0.45,
  strengthStrong: 0.7,
});

export class ResearchFindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchFindingError";
  }
}

/** 解析策略（默认 + 覆盖），并做基本合法性校验。 */
export function resolveFindingPolicy(override?: Partial<FindingPolicy> | null): FindingPolicy {
  const policy: FindingPolicy = {
    ...DEFAULT_FINDING_POLICY,
    ...(override ?? {}),
    weights: { ...DEFAULT_FINDING_POLICY.weights, ...(override?.weights ?? {}) },
  };
  const { sampleWeak, sampleMedium, sampleStrong } = policy;
  if (!(sampleWeak < sampleMedium && sampleMedium < sampleStrong)) {
    throw new ResearchFindingError(
      "样本阈值必须严格递增（sampleWeak < sampleMedium < sampleStrong）",
    );
  }
  if (!(policy.consistencyMin > 0 && policy.consistencyMin <= 1)) {
    throw new ResearchFindingError("consistencyMin 须落在 (0, 1]");
  }
  if (policy.stabilityMinSlices < 2) {
    throw new ResearchFindingError("stabilityMinSlices 至少为 2（单切片无法谈稳定性）");
  }
  if (policy.monotonicMinBuckets < 3) {
    throw new ResearchFindingError("monotonicMinBuckets 至少为 3（少于 3 档无法谈单调）");
  }
  const w = policy.weights;
  const sum = w.effect + w.sample + w.stability + w.horizon + w.monotonicity;
  if (sum <= 0) throw new ResearchFindingError("weights 之和必须为正");
  return policy;
}

// ---------------------------------------------------------------------------
// §7 样本分级
// ---------------------------------------------------------------------------

/**
 * 样本充分性分级。
 *
 * ⚠️ 这只是**研究质量提示**，不是统计显著性的替代品（任务书 §7 原文）。
 */
export function classifySampleGrade(sampleCount: number, policy: FindingPolicy): ResearchSampleGrade {
  if (!Number.isFinite(sampleCount) || sampleCount < 0) {
    throw new ResearchFindingError(`非法 sampleCount：${String(sampleCount)}`);
  }
  if (sampleCount < policy.sampleWeak) return "INSUFFICIENT";
  if (sampleCount < policy.sampleMedium) return "WEAK";
  if (sampleCount < policy.sampleStrong) return "MEDIUM";
  return "STRONG";
}

export function isResearchSampleGrade(value: string): value is ResearchSampleGrade {
  return (RESEARCH_SAMPLE_GRADES as readonly string[]).includes(value);
}

export function isResearchStrengthGrade(value: string): value is ResearchStrengthGrade {
  return (RESEARCH_STRENGTH_GRADES as readonly string[]).includes(value);
}

export function isResearchFindingType(value: string): value is ResearchFindingType {
  return (RESEARCH_FINDING_TYPES as readonly string[]).includes(value);
}

export function isResearchFindingStatus(value: string): value is ResearchFindingStatus {
  return (RESEARCH_FINDING_STATUSES as readonly string[]).includes(value);
}

/**
 * 样本强度分 [0,1]（对数刻度：1000 样本 = 1.0，100 = 0.0）。
 * 用对数而非线性，是为了避免「10 万样本」把其它四个维度完全压平。
 */
export function sampleStrengthOf(sampleCount: number, policy: FindingPolicy): number {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) return 0;
  const lo = Math.log10(Math.max(2, policy.sampleWeak));
  const hi = Math.log10(Math.max(policy.sampleStrong, policy.sampleWeak + 1));
  const v = (Math.log10(sampleCount) - lo) / (hi - lo);
  return clamp01(v);
}

/**
 * 效应强度分 [0,1]。
 *
 * 判据：以 `materialityAbs` 为「刚够有意义」的 0.5 分位，`materialityAbs × 4` 封顶为 1.0。
 * 为什么不用绝对收益：不同变量量纲不同，绝对阈值没有可比性。
 */
export function effectStrengthOf(absEffect: number | null, policy: FindingPolicy): number {
  if (absEffect === null || !Number.isFinite(absEffect)) return 0;
  const m = policy.materialityAbs;
  if (m <= 0) return 0;
  const v = 0.5 + 0.5 * ((absEffect - m) / (m * 3));
  return clamp01(v);
}

// ---------------------------------------------------------------------------
// §14 研究强度合成
// ---------------------------------------------------------------------------

export interface ResearchStrengthParts {
  effectStrength?: number | null;
  sampleStrength?: number | null;
  stabilityStrength?: number | null;
  horizonConsistency?: number | null;
  monotonicityStrength?: number | null;
}

export interface ResearchStrengthResult {
  effectStrength: number | null;
  sampleStrength: number | null;
  stabilityStrength: number | null;
  horizonConsistency: number | null;
  monotonicityStrength: number | null;
  researchStrength: number | null;
  grade: ResearchStrengthGrade | null;
}

/**
 * 合成研究强度。
 *
 * 🔴 关键设计：**缺失维度按「重归一化」处理，而不是补 0**。
 * 理由：`stability` / `monotonicity` 在数据不足时**结构性不可用**（如只有 1 个年度切片），
 * 补 0 会把「没测」当成「测出来很差」，从而系统性压低这类 Finding —— 那是**不实**的。
 * 只有当**全部**维度都不可用时，才返回 null（= 无法评估）。
 */
export function composeResearchStrength(
  parts: ResearchStrengthParts,
  policy: FindingPolicy = DEFAULT_FINDING_POLICY,
): ResearchStrengthResult {
  const dims: Array<{ key: keyof FindingPolicy["weights"]; value: number | null }> = [
    { key: "effect", value: normalize01(parts.effectStrength) },
    { key: "sample", value: normalize01(parts.sampleStrength) },
    { key: "stability", value: normalize01(parts.stabilityStrength) },
    { key: "horizon", value: normalize01(parts.horizonConsistency) },
    { key: "monotonicity", value: normalize01(parts.monotonicityStrength) },
  ];

  const available = dims.filter((d) => d.value !== null);
  let total: number | null = null;
  if (available.length > 0) {
    let wsum = 0;
    let acc = 0;
    for (const d of available) {
      const w = policy.weights[d.key];
      wsum += w;
      acc += w * (d.value as number);
    }
    total = wsum > 0 ? clamp01(acc / wsum) : null;
  }

  return {
    effectStrength: parts.effectStrength ?? null,
    sampleStrength: parts.sampleStrength ?? null,
    stabilityStrength: parts.stabilityStrength ?? null,
    horizonConsistency: parts.horizonConsistency ?? null,
    monotonicityStrength: parts.monotonicityStrength ?? null,
    researchStrength: total,
    grade: total === null ? null : gradeOfStrength(total, policy),
  };
}

export function gradeOfStrength(value: number, policy: FindingPolicy): ResearchStrengthGrade {
  if (value >= policy.strengthStrong) return "STRONG";
  if (value >= policy.strengthMedium) return "MEDIUM";
  return "WEAK";
}

// ---------------------------------------------------------------------------
// §13 状态机
// ---------------------------------------------------------------------------

/**
 * 允许的状态转移。
 *
 * 🔴 「不要让系统自动把所有 Finding 标记为 SUPPORTED」：
 *    引擎**只能**写 `DISCOVERED`；`SUPPORTED` / `WEAK` / `CONTRADICTED` / `REJECTED`
 *    只能来自**用户 review**。`REJECTED` 是终态（人明确否定，不再复活）。
 */
export const FINDING_STATUS_TRANSITIONS: Record<ResearchFindingStatus, readonly ResearchFindingStatus[]> = {
  DISCOVERED: ["REVIEWED", "REJECTED"],
  REVIEWED: ["SUPPORTED", "WEAK", "CONTRADICTED", "REJECTED"],
  SUPPORTED: ["WEAK", "CONTRADICTED", "REJECTED"],
  WEAK: ["SUPPORTED", "CONTRADICTED", "REJECTED"],
  CONTRADICTED: ["REVIEWED", "WEAK", "REJECTED"],
  REJECTED: [],
};

export function isFindingTransitionAllowed(
  from: ResearchFindingStatus,
  to: ResearchFindingStatus,
): boolean {
  if (from === to) return true; // 幂等 no-op
  return FINDING_STATUS_TRANSITIONS[from].includes(to);
}

export function assertFindingTransition(from: ResearchFindingStatus, to: ResearchFindingStatus): void {
  if (!isResearchFindingStatus(from)) {
    throw new ResearchFindingError(`非法 Finding 源状态：${String(from)}`);
  }
  if (!isResearchFindingStatus(to)) {
    throw new ResearchFindingError(`非法 Finding 目标状态：${String(to)}`);
  }
  if (!isFindingTransitionAllowed(from, to)) {
    throw new ResearchFindingError(
      `非法的 Finding 状态转移：${from} → ${to}（允许：${FINDING_STATUS_TRANSITIONS[from].join(" / ") || "无（终态）"}）`,
    );
  }
}

// ---------------------------------------------------------------------------
// 结构校验
// ---------------------------------------------------------------------------

/**
 * 校验 Finding 的**结构合法性**（不含统计判断）。
 *
 * 硬规则：
 *   - `experimentId` 必填（Finding 必须挂在实验下）；
 *   - **必须有 Result provenance**：`primaryAnalysisId` 与 `sourceResultIds` **至少一个非空**
 *     —— 防止「凭空产生发现」；
 *   - `findingType` / `status` 必须在闭集内；
 *   - `title` 非空。
 */
export function assertResearchFinding(finding: Omit<ResearchFinding, "id" | "createdAt" | "updatedAt">): void {
  if (!Number.isInteger(finding.experimentId) || finding.experimentId <= 0) {
    throw new ResearchFindingError(`非法 experimentId：${String(finding.experimentId)}`);
  }
  if (!isResearchFindingType(finding.findingType)) {
    throw new ResearchFindingError(`非法 findingType：${String(finding.findingType)}`);
  }
  if (!isResearchFindingStatus(finding.status)) {
    throw new ResearchFindingError(`非法 Finding 状态：${String(finding.status)}`);
  }
  if (typeof finding.title !== "string" || finding.title.trim().length === 0) {
    throw new ResearchFindingError("Finding title 不能为空");
  }
  const hasAnalysis = typeof finding.primaryAnalysisId === "number" && finding.primaryAnalysisId > 0;
  const hasResults = Array.isArray(finding.sourceResultIds) && finding.sourceResultIds.length > 0;
  if (!hasAnalysis && !hasResults) {
    throw new ResearchFindingError(
      "Finding 必须保留 Result provenance：primaryAnalysisId 与 sourceResultIds 至少一个非空"
      + "（禁止脱离 Result 独立存在）",
    );
  }
  if (finding.runId !== null && finding.runId !== undefined) {
    if (!Number.isInteger(finding.runId) || finding.runId <= 0) {
      throw new ResearchFindingError(`非法 runId：${String(finding.runId)}`);
    }
  }
}

/** 引擎写入口的额外约束：引擎**只能**产出 `DISCOVERED`。 */
export function assertEngineFindingCreationStatus(status: ResearchFindingStatus): void {
  if (status !== "DISCOVERED") {
    throw new ResearchFindingError(
      `Finding Engine 只能写入 DISCOVERED（实得 ${status}）——`
      + "SUPPORTED / WEAK / CONTRADICTED / REJECTED 只能由用户 review 流转",
    );
  }
}

// ---------------------------------------------------------------------------
// 渲染（供报告 / 前端复用；不是求值器）
// ---------------------------------------------------------------------------

export function renderFindingPolicy(policy: FindingPolicy): string {
  const w = policy.weights;
  return `样本分级 ${policy.sampleWeak}/${policy.sampleMedium}/${policy.sampleStrong}，`
    + `materialityAbs=${policy.materialityAbs}，`
    + `一致性下限=${policy.consistencyMin}，`
    + `权重 effect=${w.effect}/sample=${w.sample}/stability=${w.stability}/horizon=${w.horizon}/monotonicity=${w.monotonicity}，`
    + `分级 MEDIUM≥${policy.strengthMedium} / STRONG≥${policy.strengthStrong}`;
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** null / 非有限值 ⇒ null（= 该维度**不可用**，而非 0 分）。 */
function normalize01(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) return null;
  return clamp01(v);
}
