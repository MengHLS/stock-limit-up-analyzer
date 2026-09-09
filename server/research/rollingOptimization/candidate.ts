/**
 * STEP 17 / C-17.2 — Rolling Optimization：跨窗汇总候选策略产出（kind = "candidate"）。
 *
 * §19 语义：优化结果产出 Candidate Strategies（kind = "candidate"，非 production/final）。
 * 本模块把跨窗一致性判定中 consistent 的参数集物化为独立、可审计、带指纹的候选记录；
 * 不把任何候选推广为生产参数 / 写回 Strategy Config。
 *
 * 产出条件（与一致性结论一致）：
 *   - 仅从 consistent 参数集产出（其在被评估的每个窗口都合格——stable-across-windows）；
 *   - maxCandidates 仅用于限制记录体积（取排序后前 N 个），不改变一致性结论；
 *   - 排序确定性：medianTotalReturnPct 降序、parameterSetKey 升序破平（均值/中位数而非
 *     单窗极值，对齐 region.members 的排序哲学）。
 *
 * 铁律：纯函数、确定性、无 IO；失败响亮（consistent 参数集缺聚合统计属契约破坏 → 抛错）。
 */

import {
  ROLLING_OPTIMIZATION_CANDIDATE_RECORD_KIND,
  ROLLING_OPTIMIZATION_CANDIDATE_RECORD_VERSION,
  type ResolvedRollingStabilityConfig,
  type RollingConsistencyReport,
  type RollingOptimizationCandidate,
} from "./types";
import { computeRollingOptimizationCandidateFingerprint } from "./serialize";

/** buildRollingOptimizationCandidates 输入。 */
export interface BuildRollingCandidatesInput {
  readonly runId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 跨窗一致性报告（consistent 参数集即候选来源）。 */
  readonly report: RollingConsistencyReport;
  /** 解析后的跨窗一致性口径（maxCandidates）。 */
  readonly config: ResolvedRollingStabilityConfig;
}

/** 从 consistent 参数集物化跨窗候选（kind = "candidate"；条件不满足时返回空数组，不抛错）。 */
export function buildRollingOptimizationCandidates(
  input: BuildRollingCandidatesInput,
): RollingOptimizationCandidate[] {
  const consistent = input.report.parameters.filter((stat) => stat.consistent);
  if (consistent.length === 0) return [];

  const ordered = [...consistent].sort((a, b) => {
    const aMed = a.medianTotalReturnPct ?? 0;
    const bMed = b.medianTotalReturnPct ?? 0;
    if (aMed !== bMed) return bMed - aMed;
    return a.parameterSetKey.localeCompare(b.parameterSetKey);
  });
  const capped = input.config.maxCandidates === null
    ? ordered
    : ordered.slice(0, input.config.maxCandidates);

  return capped.map((stat, index) => {
    if (stat.medianTotalReturnPct === null || stat.meanTotalReturnPct === null
      || stat.meanMaxDrawdownPct === null || stat.maxMaxDrawdownPct === null) {
      throw new Error(`buildRollingOptimizationCandidates: consistent 参数集缺合格窗聚合统计（${stat.parameterSetKey}，契约破坏）`);
    }
    const body: Omit<RollingOptimizationCandidate, "fingerprint"> = {
      recordKind: ROLLING_OPTIMIZATION_CANDIDATE_RECORD_KIND,
      recordVersion: ROLLING_OPTIMIZATION_CANDIDATE_RECORD_VERSION,
      candidateId: `${input.runId}-candidate-${index}`,
      strategyKind: "candidate",
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      parameterSet: stat.parameterSet,
      performance: {
        meanTotalReturnPct: stat.meanTotalReturnPct,
        medianTotalReturnPct: stat.medianTotalReturnPct,
        meanMaxDrawdownPct: stat.meanMaxDrawdownPct,
        maxMaxDrawdownPct: stat.maxMaxDrawdownPct,
      },
      consistency: {
        evaluatedWindowCount: stat.evaluatedWindowCount,
        qualifiedWindowCount: stat.qualifiedWindowCount,
        qualifiedWindowIds: [...stat.qualifiedWindowIds],
      },
      runId: input.runId,
    };
    const fingerprint = computeRollingOptimizationCandidateFingerprint(body);
    return { ...body, fingerprint };
  });
}
