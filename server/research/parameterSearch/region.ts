/**
 * STEP 17 / C-17.1 — 稳定参数区判定（Region Analysis）。
 *
 * 目标（ROADMAP §19）：**不是找历史收益最高参数**，而是找「表现良好且稳定的参数区域」。
 * 本模块对一次搜索的被评样本做确定性聚合，产出候选参数区结论。
 *
 * 算法（聚合口径，参数异构时不做参数空间距离聚类——邻域/聚类待 C-17.2 提供参数度量）：
 *   1. 分类（对成功样本）：
 *        returnOk = totalReturnPct >= analysis.minReturnPct   （收益达标）
 *        ddOk     = maxDrawdownPct <= analysis.maxDrawdownPct  （回撤可控）
 *        qualified（合格/稳定候选）= returnOk && ddOk；
 *        bad point（坏点）= !ddOk（回撤超阈值，**无论收益多高**）；
 *        low return（低收益）= !returnOk && ddOk。
 *      把「高收益但高回撤」的样本排除在候选区外 —— 这是对「单点历史收益最高」的显式拒绝。
 *   2. 候选区 = 全部合格样本（含聚合统计：均值/中位数，非单点极值；与 STEP 6.5
 *      parameterStability 的均值/中位数聚合思路对齐）。
 *   3. 整体坏点率 badPointRatePct = badPointCount / succeededCount。坏点率超过
 *      maxBadPointRatePct → verdict = "degraded-bad-point-rate"（坏点主导说明搜索到的
 *      「表现好」大多以失控回撤为代价，区域稳定性存疑）。坏点率是**区域级**门，候选
 *      区成员自身已逐点过回撤门槛。
 *   4. verdict：
 *        - 无合格样本                → "no-qualified-samples"
 *        - 合格样本 < minQualifiedSamples → "insufficient-qualified-samples"
 *        - 合格样本充足 + 坏点率 <= 上限 → "stable"
 *        - 合格样本充足 + 坏点率 >  上限 → "degraded-bad-point-rate"
 *   5. 候选策略是否产出由调用方（candidate.ts）按 verdict + requireStableCandidates 决定；
 *      本模块只描述区域结论，不选 Top1、不推广生产。
 *
 * 退化输入结构化处理：全部样本失败 / 全部不达标 → no-qualified-samples（不抛错）；
 * 空 evaluatedSamples → no-qualified-samples；配置非法 → resolveRegionAnalysisConfig 返回 issues。
 *
 * 铁律：纯函数、确定性（成员排序确定：totalReturnPct 降序、参数集 canonical 键升序破平）；
 * 禁止 NaN / Infinity（成功样本指标非法属调用方契约破坏，直接抛错）；无 IO。
 */

import type { ResearchValidationIssue } from "../experimentValidation";
import type { ResearchParameterSet } from "../types";
import {
  DEFAULT_REGION_ANALYSIS_CONFIG,
  type CandidateRegionAggregate,
  type CandidateRegionMember,
  type CandidateRegionReport,
  type CandidateRegionVerdict,
  type ParameterSearchEvaluatedSample,
  type RegionAnalysisConfig,
  type ResolvedRegionAnalysisConfig,
} from "./types";

// ---------------------------------------------------------------------------
// 配置解析（缺省补齐 + 校验；返回 issues 不抛错）
// ---------------------------------------------------------------------------

/** 解析稳定区判定口径：缺省补齐 + 形态校验。issues 为空即合法。 */
export function resolveRegionAnalysisConfig(
  config: RegionAnalysisConfig | undefined,
): { readonly config: ResolvedRegionAnalysisConfig; readonly issues: ResearchValidationIssue[] } {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  if (config !== undefined && (config === null || typeof config !== "object" || Array.isArray(config))) {
    issue("REGION_CONFIG_INVALID", "analysis", "analysis 必须是对象");
    return { config: { ...DEFAULT_REGION_ANALYSIS_CONFIG }, issues };
  }

  const minReturnPct = config?.minReturnPct ?? DEFAULT_REGION_ANALYSIS_CONFIG.minReturnPct;
  const maxDrawdownPct = config?.maxDrawdownPct ?? DEFAULT_REGION_ANALYSIS_CONFIG.maxDrawdownPct;
  const maxBadPointRatePct = config?.maxBadPointRatePct ?? DEFAULT_REGION_ANALYSIS_CONFIG.maxBadPointRatePct;
  const minQualifiedSamples = config?.minQualifiedSamples ?? DEFAULT_REGION_ANALYSIS_CONFIG.minQualifiedSamples;
  const maxCandidates = config?.maxCandidates ?? DEFAULT_REGION_ANALYSIS_CONFIG.maxCandidates;
  const requireStableCandidates = config?.requireStableCandidates ?? DEFAULT_REGION_ANALYSIS_CONFIG.requireStableCandidates;

  if (typeof minReturnPct !== "number" || !Number.isFinite(minReturnPct)) {
    issue("REGION_MIN_RETURN_INVALID", "analysis.minReturnPct", "minReturnPct 必须是有限数字");
  }
  if (typeof maxDrawdownPct !== "number" || !Number.isFinite(maxDrawdownPct) || maxDrawdownPct < 0) {
    issue("REGION_MAX_DRAWDOWN_INVALID", "analysis.maxDrawdownPct", "maxDrawdownPct 必须是 >= 0 的有限数字");
  }
  if (
    typeof maxBadPointRatePct !== "number" || !Number.isFinite(maxBadPointRatePct)
    || maxBadPointRatePct < 0 || maxBadPointRatePct > 100
  ) {
    issue("REGION_MAX_BAD_RATE_INVALID", "analysis.maxBadPointRatePct", "maxBadPointRatePct 必须是 0..100 的有限数字");
  }
  if (!Number.isInteger(minQualifiedSamples) || minQualifiedSamples < 1) {
    issue("REGION_MIN_QUALIFIED_INVALID", "analysis.minQualifiedSamples", "minQualifiedSamples 必须是 >= 1 的整数");
  }
  if (maxCandidates !== null && (!Number.isInteger(maxCandidates) || maxCandidates < 1)) {
    issue("REGION_MAX_CANDIDATES_INVALID", "analysis.maxCandidates", "maxCandidates 必须为 null 或 >= 1 的整数");
  }
  if (typeof requireStableCandidates !== "boolean") {
    issue("REGION_REQUIRE_STABLE_INVALID", "analysis.requireStableCandidates", "requireStableCandidates 必须是布尔值");
  }

  return {
    config: {
      minReturnPct,
      maxDrawdownPct,
      maxBadPointRatePct,
      minQualifiedSamples,
      maxCandidates,
      requireStableCandidates,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// 描述统计（均值 / 中位数）
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** 参数集 canonical 键（键排序 + JSON 值），用于成员确定性排序破平。 */
function parameterSetKey(set: ResearchParameterSet): string {
  return Object.keys(set)
    .sort()
    .map((key) => `${JSON.stringify(key)}=${JSON.stringify(set[key])}`)
    .join("|");
}

// ---------------------------------------------------------------------------
// 主分析
// ---------------------------------------------------------------------------

/** 对搜索结果做稳定参数区判定（succeeded 样本分类 + 聚合 + 区域结论）。 */
export function analyzeCandidateRegion(
  evaluatedSamples: readonly ParameterSearchEvaluatedSample[],
  config: ResolvedRegionAnalysisConfig,
): CandidateRegionReport {
  let succeededCount = 0;
  let failedCount = 0;
  let lowReturnCount = 0;
  let badDrawdownCount = 0;
  const members: CandidateRegionMember[] = [];

  for (let index = 0; index < evaluatedSamples.length; index++) {
    const sample = evaluatedSamples[index]!;
    if (sample.status === "failed") {
      failedCount++;
      continue;
    }
    succeededCount++;
    if (sample.totalReturnPct === null || sample.maxDrawdownPct === null) {
      throw new Error(`analyzeCandidateRegion: succeeded 样本缺绩效标量（index=${index}，契约破坏）`);
    }
    const returnOk = sample.totalReturnPct >= config.minReturnPct;
    const drawdownOk = sample.maxDrawdownPct <= config.maxDrawdownPct;
    if (returnOk && drawdownOk) {
      members.push({
        sampleIndex: index,
        parameterSet: sample.parameterSet,
        totalReturnPct: sample.totalReturnPct,
        maxDrawdownPct: sample.maxDrawdownPct,
        tradeCount: sample.tradeCount,
      });
    } else if (drawdownOk) {
      lowReturnCount++;
    } else {
      badDrawdownCount++;
    }
  }

  // 确定性排序：totalReturnPct 降序，参数集 canonical 键升序破平。
  members.sort((left, right) => {
    if (left.totalReturnPct !== right.totalReturnPct) {
      return right.totalReturnPct - left.totalReturnPct;
    }
    return parameterSetKey(left.parameterSet).localeCompare(parameterSetKey(right.parameterSet));
  });

  const qualifiedCount = members.length;
  const badPointRatePct = succeededCount === 0 ? null : (badDrawdownCount / succeededCount) * 100;

  let verdict: CandidateRegionVerdict;
  if (qualifiedCount === 0) {
    verdict = "no-qualified-samples";
  } else if (qualifiedCount < config.minQualifiedSamples) {
    verdict = "insufficient-qualified-samples";
  } else if (badPointRatePct === null || badPointRatePct <= config.maxBadPointRatePct) {
    verdict = "stable";
  } else {
    verdict = "degraded-bad-point-rate";
  }

  // candidatesSuppressed：合格样本充足，但因区域结论非 stable 且 requireStableCandidates
  // 而被抑制候选产出（供审计提示）。合格不足时本来就不产出，不算「被抑制」。
  const candidatesSuppressed =
    qualifiedCount >= config.minQualifiedSamples
    && verdict === "degraded-bad-point-rate"
    && config.requireStableCandidates;

  let aggregate: CandidateRegionAggregate | null = null;
  if (qualifiedCount > 0) {
    aggregate = {
      qualifiedCount,
      meanTotalReturnPct: mean(members.map((member) => member.totalReturnPct)),
      medianTotalReturnPct: median(members.map((member) => member.totalReturnPct)),
      minTotalReturnPct: Math.min(...members.map((member) => member.totalReturnPct)),
      maxTotalReturnPct: Math.max(...members.map((member) => member.totalReturnPct)),
      meanMaxDrawdownPct: mean(members.map((member) => member.maxDrawdownPct)),
      medianMaxDrawdownPct: median(members.map((member) => member.maxDrawdownPct)),
      maxMaxDrawdownPct: Math.max(...members.map((member) => member.maxDrawdownPct)),
    };
  }

  return {
    verdict,
    evaluatedCount: evaluatedSamples.length,
    succeededCount,
    failedCount,
    qualifiedCount,
    lowReturnCount,
    badDrawdownCount,
    badPointRatePct,
    candidatesSuppressed,
    members,
    aggregate,
  };
}
