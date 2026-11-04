/**
 * ROBUSTNESS-001 §10 / §12 — 输入 Validity Gate 与汇总。
 *
 * ## 为什么要有 Gate（而不是「读不到就返回空」）
 *
 * 稳健性分析消费的是**已经算完**的搜索网格。若源 Search Run 没跑完 / 没有结果 /
 * 指标不是 canonical，那么任何「稳定性结论」都是在**不存在的数据**上编出来的。
 * ⇒ 宁可**响亮拒绝**并给出领域码，也不产出看起来正常的报告。
 *
 * ```text
 * ROBUSTNESS_SEARCH_RUN_NOT_COMPLETED   源 Run 不是 COMPLETED
 * ROBUSTNESS_NO_RESULTS                 源 Run 一行结果都没有
 * ROBUSTNESS_NO_COMBINATIONS            源 Run 一行组合都没有
 * ROBUSTNESS_INVALID_RESULT_SOURCE      存在 metricsSource ≠ canonical 的结果
 * ROBUSTNESS_SOURCE_MISMATCH            读到的行不属于该 searchRunId（串线）
 * ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED  参数引用未验证（**标记**，不是拒绝）
 * ```
 *
 * 🔴 最后一条**不是错误**（规格 §12）：它只要求「不要假装参数已被策略使用」，
 *   因此它是 Run 汇总里的一个**标记位**，而不是拒绝理由。
 */

import { ResearchValidationError } from "../experimentValidation";
import { isRobustnessRunStatus } from "./run";
import type { SearchRobustnessSummary } from "./types";

/** Gate 输入（全部已从库读出；本层零 IO）。 */
export interface RobustnessGateInput {
  readonly searchRunId: string;
  readonly sourceStatus: unknown;
  readonly combinationCount: number;
  readonly resultCount: number;
  /** 每条结果的 `metricsSource`（用于分布统计与 canonical 判定）。 */
  readonly metricsSources: readonly string[];
  /** 行归属校验：读到的组合 / 结果行里出现的 `searchRunId` 集合。 */
  readonly observedSearchRunIds: readonly string[];
}

/** 指标来源分布（如实回报，便于用户定位「哪些组合不是 canonical」）。 */
export interface MetricsSourceDistribution {
  readonly canonical: number;
  readonly evaluators: number;
  readonly other: number;
}

/** 统计指标来源分布。 */
export function distributionOfMetricsSources(
  sources: readonly string[],
): MetricsSourceDistribution {
  let canonical = 0;
  let evaluators = 0;
  let other = 0;
  for (const source of sources) {
    if (source === "canonical") canonical += 1;
    else if (source === "evaluators") evaluators += 1;
    else other += 1;
  }
  return { canonical, evaluators, other };
}

/**
 * 断言输入满足建立 Robustness Run 的条件（规格 §10）。
 *
 * 校验顺序固定（报错信息按「最先卡住的那一条」给，避免一次抛 5 条把人淹没）。
 */
export function assertRobustnessGate(input: RobustnessGateInput): void {
  if (!isRobustnessRunStatus(input.sourceStatus)) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_SEARCH_RUN_NOT_COMPLETED",
        path: "sourceSearchRunId",
        message:
          `源 Search Run ${input.searchRunId} 的状态列不是合法状态值（${String(input.sourceStatus)}）`
          + `⇒ 无法确认它已跑完，拒绝建立稳健性分析。`,
      },
    ]);
  }
  if (input.sourceStatus !== "COMPLETED") {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_SEARCH_RUN_NOT_COMPLETED",
        path: "sourceSearchRunId",
        message:
          `源 Search Run ${input.searchRunId} 当前状态为 ${input.sourceStatus}`
          + `（要求 COMPLETED）；未跑完的搜索上做稳定性分析等于在不存在的数据上编结论。`,
      },
    ]);
  }
  const mismatched = input.observedSearchRunIds.filter((id) => id !== input.searchRunId);
  if (mismatched.length > 0) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_SOURCE_MISMATCH",
        path: "sourceSearchRunId",
        message:
          `读到的行里出现了不属于 ${input.searchRunId} 的 searchRunId`
          + `（${[...new Set(mismatched)].join(" / ")}）⇒ 拒绝跨 Search Run 混合结果（规格 §8）。`,
      },
    ]);
  }
  if (input.combinationCount === 0) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_NO_COMBINATIONS",
        path: "sourceSearchRunId",
        message: `源 Search Run ${input.searchRunId} 一行组合都没有 ⇒ 无邻域可言（规格 §10）。`,
      },
    ]);
  }
  if (input.resultCount === 0) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_NO_RESULTS",
        path: "sourceSearchRunId",
        message: `源 Search Run ${input.searchRunId} 没有任何结果行 ⇒ 无事实可分析（规格 §10）。`,
      },
    ]);
  }
  const distribution = distributionOfMetricsSources(input.metricsSources);
  if (distribution.canonical !== input.resultCount) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_INVALID_RESULT_SOURCE",
        path: "sourceSearchRunId",
        message:
          `源结果里只有 ${String(distribution.canonical)} / ${String(input.resultCount)} 条是 canonical`
          + `（evaluators=${String(distribution.evaluators)}，other=${String(distribution.other)}）`
          + `⇒ 要求全部为 canonical，拒绝在非 canonical 口径上做稳定性结论（规格 §10）。`,
      },
    ]);
  }
}

/**
 * 参数引用状态继承（规格 §12）。
 *
 * 继承 PARAMETER-002 的实查事实：「声明为 TUNABLE ≠ 被策略消费」。本函数**不自行判定**，
 * 只按源 Run 的记录如实给出标记与说明。
 */
export function resolveParameterReferenceStatus(input: {
  readonly referenceCheckApplied: boolean | null | undefined;
  readonly unreferencedTunableCodes: readonly string[];
}): { readonly verified: boolean; readonly note: string } {
  const codes = input.unreferencedTunableCodes;
  if (input.referenceCheckApplied === true) {
    return {
      verified: true,
      note:
        codes.length === 0
          ? "源 Search Run 已做死参数筛查（规则图引用检查）：未发现规则图未引用的 TUNABLE 参数。"
          : `源 Search Run 已做死参数筛查，并排除了 ${String(codes.length)} 个规则图未引用的 TUNABLE 参数`
            + `（${codes.join(" / ")}）—— 本次分析不含这些死参数。`,
    };
  }
  return {
    verified: false,
    note:
      "ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED：源 Search Run 未记录死参数筛查结果"
      + `（referenceCheckApplied = ${String(input.referenceCheckApplied ?? null)}，`
      + "历史行落库时还没有该字段）⇒ 本次稳定性结论**不保证**被分析的参数真的被策略消费"
      + "（PARAMETER-002 N-02 实查事实：参数声明在 schema 里 ≠ 决策引擎会读它）。",
  };
}

/** 汇总累加器。 */
export class RobustnessSummaryAccumulator {
  private stable = 0;
  private unstable = 0;
  private insufficientActivity = 0;
  private insufficientNeighborhood = 0;
  private unavailable = 0;
  private incomplete = 0;
  private analyzed = 0;

  /** 记录一条判定。 */
  public add(status: string, neighborhoodIncomplete: boolean): void {
    this.analyzed += 1;
    if (neighborhoodIncomplete) this.incomplete += 1;
    switch (status) {
      case "STABLE":
        this.stable += 1;
        break;
      case "UNSTABLE":
        this.unstable += 1;
        break;
      case "INSUFFICIENT_TRADING_ACTIVITY":
        this.insufficientActivity += 1;
        break;
      case "INSUFFICIENT_NEIGHBORHOOD":
        this.insufficientNeighborhood += 1;
        break;
      default:
        this.unavailable += 1;
        break;
    }
  }

  /** 输出汇总（`sourceCombinationCount` 与参数引用标记由调用方给）。 */
  public finish(input: {
    readonly sourceCombinationCount: number;
    readonly parameterReference: { readonly verified: boolean; readonly note: string };
  }): SearchRobustnessSummary {
    return {
      sourceCombinationCount: input.sourceCombinationCount,
      analyzedCombinationCount: this.analyzed,
      stableCount: this.stable,
      unstableCount: this.unstable,
      insufficientTradingActivityCount: this.insufficientActivity,
      insufficientNeighborhoodCount: this.insufficientNeighborhood,
      sourceResultUnavailableCount: this.unavailable,
      neighborhoodIncompleteCount: this.incomplete,
      parameterReferenceUnverified: !input.parameterReference.verified,
      parameterReferenceNote: input.parameterReference.note,
    };
  }
}
