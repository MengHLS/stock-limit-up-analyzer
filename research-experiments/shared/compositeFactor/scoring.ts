/**
 * COMPOSITE_FACTOR_EXPERIMENT_V1 —— **合成评分内核**（纯函数，唯一的组合算法所在）。
 *
 * ```
 * Factor Value
 *   → Direction Adjustment   （HIGH 保持 / LOW 取 1 − x）
 *   → Normalization          （统一方法：冻结桶位分 或 同日横截面百分位）
 *   → Weight                 （等权；CUSTOM 已预留）
 *   → Composite Score        （Σ w·oriented ∈ (0,1)）
 * ```
 *
 * ## 四条不变量（都由代码强制，不靠注释）
 *
 * 1. **不插补**：任一成员不可评估 ⇒ 该样本**不可评分**（不算分、不填 0、不跳过该成员）。
 *    与 `FROZEN-BUCKET-CONTRACT-001 §3.3` 的「完备用例」逐字一致。
 * 2. **「缺哪个成员」由标准化结果判定**，不由原始值判定。这条看似绕，但它正是
 *    「`limitGap` 的 `null` 是**合法桶** UNKNOWN、不是缺失」这句话的落点 ——
 *    若用「原始值为 null 即缺失」，12 因子等权实例的入池样本数会比 12F 实验少一批，
 *    而少掉的原因完全不可见（静默漂移）。
 * 3. **权重归一化到 Σw = 1** ⇒ 合成分与成员个数无关，永远落在 `(0, 1)`。
 * 4. **等权走「先求和再除以 n」**（`(Σ x)/n`），不写 `Σ (1/n)·x` ——
 *    两者数学等价但浮点可差 1 ULP，而桶位分造成横截面上大量**精确同值**样本，
 *    1 ULP 就足以改变 `ranker` 的同值 tie-break 次序 ⇒ 改变 TopN 边界上的选中股票。
 *    取前者只为一个目的：与 `twelve-factor-composite-study` 的 `compositeScoreOf()`
 *    走同一条浮点路径，使「12 因子等权」实例与既有实验的点估计**逐位可对拍**。
 *
 * ## 顺序为什么是「先标准化再方向调整」
 *
 * 标准化是**值的形态**（把量纲不同的因子变成同一个可加尺度），方向调整是**优劣的语义**。
 * 两者交换顺序在数学上等价（`1 − (idx+0.5)/k` 就是反向桶位分），但先标准化能让留档里的
 * `normalized` 始终是「同一方法、同一尺度」的量，跨成员可直接比较
 * （报告里「哪个成员贡献大」才解释得通）。
 */

import type { TwelveFactorSample } from "../../first-board-pullback/twelve-factor-composite-study/result";
import { quantileOf, round } from "../singleFactor/metrics";
import type {
  CompositeContribution,
  CompositeMember,
  FactorDirection,
  NormalizationMethod,
  WeightingSpec,
} from "./types";

// ---------------------------------------------------------------------------
// 标准化
// ---------------------------------------------------------------------------

/**
 * 同日横截面百分位：`count(peer ≤ value) / N`（peer 含自身）。
 *
 * 与 `twelve-factor-composite-study/derive.ts` 的 `percentileRank` 同法（该函数为私有，
 * 未上提到共享层；此处按既有口径保留一份，**不改变语义**）。
 */
export function crossSectionPercentileOf(
  value: number,
  peers: readonly number[]
): number | null {
  if (peers.length === 0) return null;
  let belowOrEqual = 0;
  for (const peer of peers) if (peer <= value) belowOrEqual += 1;
  return belowOrEqual / peers.length;
}

/** 方向调整：`HIGH` 保持，`LOW` 取 `1 − x`。 */
export function orientValue(
  normalized: number,
  direction: FactorDirection
): number {
  return direction === "HIGH" ? normalized : 1 - normalized;
}

/** 标准化函数：`(原始值) → 标准化值 ∈ [0,1]`；`null` = 该成员在此样本上不可评估。 */
export type Normalizer = (rawValue: number | null) => number | null;

function bucketNormalizerOf(member: CompositeMember): Normalizer {
  const bucketScoreOf = member.bucketScoreOf;
  if (bucketScoreOf === null) {
    throw new Error(
      `成员 ${member.code} 没有冻结桶词表，不能用 BUCKET_POSITIONAL 标准化`
    );
  }
  return value => bucketScoreOf(value);
}

/**
 * 按成员生成标准化函数。
 *
 * ⚠️ `CROSS_SECTION_PERCENTILE` 需要「同日 peer 集合」，因此必须**整批样本一次**算完，
 *    不能逐样本调用；本函数返回一个按样本求值的函数（peer 表在闭包里）。
 */
export function resolveNormalizers(args: {
  members: readonly CompositeMember[];
  normalization: NormalizationMethod;
  samples: readonly TwelveFactorSample[];
}): ReadonlyMap<string, (sample: TwelveFactorSample) => number | null> {
  const result = new Map<string, (sample: TwelveFactorSample) => number | null>();
  for (const member of args.members) {
    if (args.normalization === "BUCKET_POSITIONAL") {
      const normalize = bucketNormalizerOf(member);
      result.set(member.code, sample => normalize(member.valueOf(sample)));
      continue;
    }
    // CROSS_SECTION_PERCENTILE
    const peersByDate = new Map<string, number[]>();
    for (const sample of args.samples) {
      const raw = member.valueOf(sample);
      if (raw === null) continue;
      const peers = peersByDate.get(sample.eventDate);
      if (peers === undefined) peersByDate.set(sample.eventDate, [raw]);
      else peers.push(raw);
    }
    result.set(member.code, sample => {
      const raw = member.valueOf(sample);
      if (raw === null) return null;
      return crossSectionPercentileOf(raw, peersByDate.get(sample.eventDate) ?? []);
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 权重
// ---------------------------------------------------------------------------

export interface ResolvedWeighting {
  readonly spec: WeightingSpec;
  readonly weights: ReadonlyMap<string, number>;
  readonly disclosure: string;
}

/**
 * 解析权重。
 *
 * `EQUAL`：每个成员 `1/n`。
 * `CUSTOM`：键集合必须与成员集合**完全相等**，每个权重必须是**有限正数**，
 * 归一化到 Σw = 1。任何一条不满足都抛错（**不做静默兜底、不做默认 1**）。
 */
export function resolveWeights(args: {
  members: readonly CompositeMember[];
  weighting: WeightingSpec;
}): ResolvedWeighting {
  const codes = args.members.map(member => member.code);
  if (args.weighting.mode === "EQUAL") {
    const each = 1 / codes.length;
    return {
      spec: args.weighting,
      weights: new Map(codes.map((code): [string, number] => [code, each])),
      disclosure: `等权：每个成员 ${codes.length} 分之 1（Σ = 1；本阶段不做权重优化）。`,
    };
  }

  const problems: string[] = [];
  const declared = Object.keys(args.weighting.weights);
  const missing = codes.filter(code => !declared.includes(code));
  const unknown = declared.filter(code => !codes.includes(code));
  if (missing.length > 0) problems.push(`缺少权重：${missing.join(", ")}`);
  if (unknown.length > 0) problems.push(`权重里有未登记成员：${unknown.join(", ")}`);
  const raw = new Map<string, number>();
  for (const code of codes) {
    const value = args.weighting.weights[code];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      problems.push(`${code}: 权重必须是有限正数，收到 ${String(value)}`);
      continue;
    }
    raw.set(code, value);
  }
  const total = [...raw.values()].reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) problems.push("权重合计必须 > 0");
  if (problems.length > 0) {
    throw new Error(`COMPOSITE_FACTOR 自定义权重不合法：\n- ${problems.join("\n- ")}`);
  }
  const weights = new Map<string, number>();
  for (const [code, value] of raw) weights.set(code, value / total);
  return {
    spec: args.weighting,
    weights,
    disclosure:
      `自定义权重（已归一化到 Σ = 1）：` +
      codes.map(code => `${code}=${round(weights.get(code)!, 6)}`).join(", "),
  };
}

// ---------------------------------------------------------------------------
// 合成
// ---------------------------------------------------------------------------

export interface ScoringPlan {
  readonly members: readonly CompositeMember[];
  readonly normalization: NormalizationMethod;
  readonly weights: ReadonlyMap<string, number>;
  readonly weighting: ResolvedWeighting;
  /** 按 `eventId` 取某成员标准化值的函数（已在整批样本上实例化）。 */
  readonly normalizeOf: (member: CompositeMember, sample: TwelveFactorSample) => number | null;
}

export interface ScoredSample {
  readonly sample: TwelveFactorSample;
  readonly compositeScore: number;
  readonly contributions: readonly CompositeContribution[];
}

export interface ScoringOutcome {
  readonly scored: readonly ScoredSample[];
  /** 因「至少一个成员不可评估」被剔除的样本数。 */
  readonly unscorableCount: number;
  /** 按成员登记的「不可评估」次数（用于诊断，不用于剔除逻辑本身）。 */
  readonly missingByMember: Record<string, number>;
}

export function buildScoringPlan(args: {
  members: readonly CompositeMember[];
  normalization: NormalizationMethod;
  weighting: WeightingSpec;
  samples: readonly TwelveFactorSample[];
}): ScoringPlan {
  const weighting = resolveWeights({
    members: args.members,
    weighting: args.weighting,
  });
  const normalizers = resolveNormalizers({
    members: args.members,
    normalization: args.normalization,
    samples: args.samples,
  });
  return {
    members: args.members,
    normalization: args.normalization,
    weights: weighting.weights,
    weighting,
    normalizeOf: (member, sample) => {
      const normalize = normalizers.get(member.code);
      if (!normalize) throw new Error(`成员 ${member.code} 没有标准化函数`);
      return normalize(sample);
    },
  };
}

/**
 * 逐样本算合成分。
 *
 * 复算校验（代码强制，不是注释承诺）：`Σ w·oriented` 必须等于记录下来的
 * `compositeScore`（容差 `1e-12`）。这条恒等式让「合成分是怎么来的」在留档里
 * 可被第三方逐项重算 —— 等权下它等价于 `(Σ x)/n`（不变量 4）。
 */
export function scoreSamples(args: {
  plan: ScoringPlan;
  samples: readonly TwelveFactorSample[];
}): ScoringOutcome {
  const { plan } = args;
  const missingByMember: Record<string, number> = {};
  const scored: ScoredSample[] = [];
  let unscorableCount = 0;

  for (const sample of args.samples) {
    const contributions: CompositeContribution[] = [];
    /** `Σ w·oriented`（自定义权重的直接定义）。 */
    let weighted = 0;
    /**
     * `Σ oriented`（等权时用）。
     *
     * 🔴 等权为什么**不**写 `Σ (1/n)·x` 而是 `(Σ x)/n`：
     *    两者数学等价，但浮点结果可能差 1 ULP。桶位分只有有限个取值 ⇒ 横截面上
     *    大量样本**精确同值**，1 ULP 的差就足以改变 `ranker` 的同值 tie-break 次序
     *    （`eventId` 升序），从而改变 TopN 边界上「选中哪几只」。
     *    `twelve-factor-composite-study` 的 `compositeScoreOf()` 用的是 `(Σ x)/n`；
     *    这里跟它走同一条浮点路径，才能让「12 因子等权」实例与既有 12F / Top-N 实验
     *    的**点估计逐位相同**（这是模板正确性的可证伪判据，见实例 README）。
     */
    let orientedSum = 0;
    let usable = true;
    for (const member of plan.members) {
      const weight = plan.weights.get(member.code);
      if (weight === undefined) {
        throw new Error(`成员 ${member.code} 没有权重（权重与成员集合不一致）`);
      }
      const rawValue = member.valueOf(sample);
      const normalized = plan.normalizeOf(member, sample);
      if (normalized === null) {
        missingByMember[member.code] = (missingByMember[member.code] ?? 0) + 1;
        usable = false;
        contributions.push({
          code: member.code,
          direction: member.direction,
          rawValue,
          normalized: null,
          oriented: null,
          weight,
        });
        continue;
      }
      const oriented = orientValue(normalized, member.direction);
      orientedSum += oriented;
      weighted += weight * oriented;
      contributions.push({
        code: member.code,
        direction: member.direction,
        rawValue,
        normalized,
        oriented,
        weight,
      });
    }
    if (!usable) {
      unscorableCount += 1;
      continue;
    }
    const compositeScore =
      plan.weighting.spec.mode === "EQUAL"
        ? orientedSum / plan.members.length
        : weighted;
    // 留档恒等式：逐项复算必须与合成分一致（等权下 `(Σ x)/n ≈ Σ (1/n)·x`，容差 1e-12）。
    if (Math.abs(weighted - compositeScore) > 1e-12) {
      throw new Error(
        `合成分复算不成立：事件 ${sample.eventId} Σ(w·oriented)=${weighted} ` +
          `≠ compositeScore=${compositeScore}`
      );
    }
    scored.push({ sample, compositeScore, contributions });
  }

  return { scored, unscorableCount, missingByMember };
}

/** 合成分分布摘要（审计用）。 */
export interface CompositeScoreSummary {
  readonly count: number;
  readonly min: number | null;
  readonly p5: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
  readonly mean: number | null;
}

export function summarizeCompositeScores(
  values: readonly number[]
): CompositeScoreSummary {
  if (values.length === 0) {
    return { count: 0, min: null, p5: null, p50: null, p95: null, max: null, mean: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  let sum = 0;
  for (const value of sorted) sum += value;
  const at = (q: number): number | null => {
    const value = quantileOf(sorted, q);
    return value === null ? null : round(value, 10);
  };
  return {
    count: sorted.length,
    min: at(0),
    p5: at(0.05),
    p50: at(0.5),
    p95: at(0.95),
    max: at(1),
    mean: round(sum / sorted.length, 10),
  };
}
