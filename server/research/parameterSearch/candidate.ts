/**
 * STEP 17 / C-17.1 — 候选策略产出（Candidate Strategies builder）。
 *
 * §19 语义：优化结果产出 **Candidate Strategies**（kind = "candidate"，非 production/final）。
 * 本模块不把任何候选推广为生产参数 / 写回 Strategy Config；只负责把稳定候选区成员物化为
 * 独立、可审计、带指纹的候选策略记录。
 *
 * 产出条件（与区域结论一致）：
 *   - 合格样本数 >= analysis.minQualifiedSamples；
 *   - verdict === "stable"，或 requireStableCandidates === false（此时 degraded 区域也产出，
 *     但记录仍保留 degraded 结论供调用方把关）；
 *   - maxCandidates 用于限制记录体积（取排序后前 N 个合格成员），不改变区域聚合结论。
 *
 * 铁律：纯函数、确定性、无 IO；失败响亮（成员缺指标 / 下标越界属契约破坏 → 抛错）。
 */

import {
  PARAMETER_SEARCH_CANDIDATE_RECORD_KIND,
  PARAMETER_SEARCH_CANDIDATE_RECORD_VERSION,
  type CandidateRegionReport,
  type ParameterSearchCandidateStrategy,
  type ResolvedRegionAnalysisConfig,
} from "./types";
import { computeParameterSearchCandidateFingerprint } from "./serialize";

/** buildCandidateStrategies 输入。 */
export interface BuildCandidateStrategiesInput {
  readonly searchRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 区域结论（合格成员即候选来源）。 */
  readonly region: CandidateRegionReport;
  /** 解析后的稳定区判定口径。 */
  readonly config: ResolvedRegionAnalysisConfig;
}

/** 从稳定候选区物化候选策略（kind = "candidate"；条件不满足时返回空数组，不抛错）。 */
export function buildCandidateStrategies(
  input: BuildCandidateStrategiesInput,
): ParameterSearchCandidateStrategy[] {
  const { region, config } = input;
  if (region.qualifiedCount === 0) return [];
  if (region.qualifiedCount < config.minQualifiedSamples) return [];

  const allowed = region.verdict === "stable" || !config.requireStableCandidates;
  if (!allowed) return [];

  const members = config.maxCandidates === null
    ? region.members
    : region.members.slice(0, config.maxCandidates);

  return members.map((member, index) => {
    const body: Omit<ParameterSearchCandidateStrategy, "fingerprint"> = {
      recordKind: PARAMETER_SEARCH_CANDIDATE_RECORD_KIND,
      recordVersion: PARAMETER_SEARCH_CANDIDATE_RECORD_VERSION,
      candidateId: `${input.searchRunId}-candidate-${index}`,
      strategyKind: "candidate",
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      parameterSet: member.parameterSet,
      performance: {
        totalReturnPct: member.totalReturnPct,
        maxDrawdownPct: member.maxDrawdownPct,
        tradeCount: member.tradeCount,
      },
      searchRunId: input.searchRunId,
      sampleIndex: member.sampleIndex,
    };
    const fingerprint = computeParameterSearchCandidateFingerprint(body);
    return { ...body, fingerprint };
  });
}
