/**
 * ROBUSTNESS-001 §2 / §5 / §6 / §7 — 稳健性分析编排（纯函数：输入已读出的行，零 IO）。
 *
 * ```text
 * 冻结快照 + 源组合 + 源结果
 *        ↓  buildNeighborhoodAxes（§3.2）
 *        ↓  buildSourceIndex（只读索引，不重算 parameterHash）
 *        ↓  逐组合 assessBaseCombination（§6 / §11）
 *        ↓  buildRobustnessMatrix（§7）
 *        ↓  summarizeParameterAnalysis（§5.2 / §13）
 *   RobustnessAnalysisOutcome
 * ```
 *
 * 🔴 本文件**没有**、也**不会**出现：Backtest 调用、canonical metrics 重算、策略文档读取。
 *   全部指标都是源结果行的**冻结副本**（规格 §10 / §21 A/B）。判据由
 *   `tests/server/research/searchRobustness/*.test.ts` 与 E2E 探针共同钉住。
 */

import { mean } from "../../../shared/quant-stats";
import { domainValueKey } from "./domainValues";
import { RobustnessSummaryAccumulator } from "./gate";
import { buildRobustnessMatrix } from "./matrix";
import {
  assessBaseCombination,
  buildNeighborhoodAxes,
  buildSourceIndex,
  computeDispersion,
  summarizeParameterSensitivity,
  type NeighborhoodAxis,
} from "./neighborhood";
import { computeSearchRobustnessParameterFingerprint } from "./run";
import {
  ROBUSTNESS_DISPERSION_METRICS,
  type RobustnessAnalysisInput,
  type RobustnessAnalysisOutcome,
  type RobustnessDispersion,
  type RobustnessDispersionMetric,
  type RobustnessMetricsSnapshot,
  type RobustnessParameterSensitivityVerdict,
  type RobustnessSourceCombination,
  type SearchRobustnessParameterAnalysis,
  type SearchRobustnessResult,
} from "./types";

/** 单参数分析（规格 §5.2 / §13）。 */
function buildParameterAnalysis(input: {
  readonly robustnessRunId: string;
  readonly sourceSearchRunId: string;
  readonly axis: NeighborhoodAxis;
  readonly combinations: readonly RobustnessSourceCombination[];
  readonly results: readonly SearchRobustnessResult[];
}): SearchRobustnessParameterAnalysis {
  const { axis } = input;

  // ① 该参数各取值切片上的基组合（只算「有可用源读数」的，否则切片不成立）。
  const slices = new Map<string, { value: RobustnessSourceCombination["parameters"][string]; samples: RobustnessMetricsSnapshot[]; stable: number; unstable: number }>();
  const resultByHash = new Map<string, SearchRobustnessResult>();
  for (const result of input.results) resultByHash.set(result.parameterHash, result);

  let stableCombinationCount = 0;
  let unstableCombinationCount = 0;
  for (const combination of input.combinations) {
    const result = resultByHash.get(combination.parameterHash);
    if (result === undefined) continue;
    if (result.status === "SOURCE_RESULT_UNAVAILABLE") continue;
    if (result.status === "STABLE") stableCombinationCount += 1;
    if (result.status === "UNSTABLE") unstableCombinationCount += 1;

    const value = combination.parameters[axis.parameter] ?? null;
    const key = domainValueKey(value);
    const slice = slices.get(key);
    if (slice === undefined) {
      slices.set(key, { value, samples: [result.metrics], stable: 0, unstable: 0 });
    } else {
      slice.samples.push(result.metrics);
    }
  }

  // ② 取值维离散度：先按取值取均值，再对「每值均值」做描述性统计。
  const perValueMeans: RobustnessMetricsSnapshot[] = [];
  for (const slice of slices.values()) {
    const aggregate: Record<string, number | null> = {};
    for (const metric of ROBUSTNESS_DISPERSION_METRICS) {
      const values = slice.samples
        .map((sample) => sample[metric])
        .filter((value): value is number => value !== null && Number.isFinite(value));
      aggregate[metric] = mean(values);
    }
    // 仅当至少一个指标在该取值上有样本时才计入，避免把空切片当成 0。
    if (ROBUSTNESS_DISPERSION_METRICS.some((metric) => aggregate[metric] !== null)) {
      perValueMeans.push({
        totalReturnPct: aggregate["totalReturnPct"] ?? null,
        annualizedReturnPct: aggregate["annualizedReturnPct"] ?? null,
        maxDrawdownPct: aggregate["maxDrawdownPct"] ?? null,
        tradeCount: aggregate["tradeCount"] ?? null,
        winRatePct: aggregate["winRatePct"] ?? null,
        profitFactor: aggregate["profitFactor"] ?? null,
      });
    }
  }
  const valueDispersion: readonly RobustnessDispersion[] = computeDispersion(perValueMeans);

  // ③ 敏感性条目：从单组合结果里汇聚该轴的全部条目（一次只动这一个参数）。
  const entries = input.results.flatMap((result) => {
    const found = result.sensitivity.find((item) => item.parameter === axis.parameter);
    return found === undefined ? [] : found.entries;
  });
  const sensitivity = summarizeParameterSensitivity({ axis, entries });

  const verdict: RobustnessParameterSensitivityVerdict =
    sensitivity.measuredCount === 0
      ? "insufficient"
      : entries.some((entry) => entry.withinTolerance === false)
        ? "sensitive"
        : "insensitive";

  const draft: Omit<SearchRobustnessParameterAnalysis, "fingerprint"> = {
    robustnessRunId: input.robustnessRunId,
    sourceSearchRunId: input.sourceSearchRunId,
    parameterName: axis.parameter,
    domainMode: axis.domainMode,
    domainValueCount: axis.values.length,
    numeric: axis.numeric,
    analyzedValueCount: perValueMeans.length,
    stableCombinationCount,
    unstableCombinationCount,
    sensitivity,
    valueDispersion,
    verdict,
  };
  return { ...draft, fingerprint: computeSearchRobustnessParameterFingerprint(draft) };
}

/**
 * 执行一次稳健性分析（纯函数；规格 §2 的完整链条）。
 *
 * 前置条件：调用方已通过 `assertRobustnessGate` 完成输入校验（§10）。本函数不做 IO，
 * 也不重复 gate（gate 需要「源 Run 状态」这类本函数拿不到的事实）。
 */
export function analyzeSearchRobustness(
  input: RobustnessAnalysisInput,
): RobustnessAnalysisOutcome {
  const notes: string[] = [];

  const { axes, notes: axisNotes } = buildNeighborhoodAxes(input.searchSnapshot);
  notes.push(...axisNotes);
  if (axes.length === 0) {
    notes.push(
      "冻结参数空间里没有任何可参与邻域分析的可变参数（TUNABLE + 搜索域）"
        + "⇒ 全部组合都会判为 INSUFFICIENT_NEIGHBORHOOD，矩阵为空；如实登记，不编造邻域。",
    );
  }

  const index = buildSourceIndex({
    combinations: input.combinations,
    results: input.results,
  });

  const missingResultCount = input.combinations.filter(
    (combination) => !index.resultByHash.has(combination.parameterHash),
  ).length;
  if (missingResultCount > 0) {
    notes.push(
      `${String(missingResultCount)} 个源组合没有结果行（未执行 / 被跳过）`
        + "⇒ 这些组合如实判为 SOURCE_RESULT_UNAVAILABLE，**不假设**它们的绩效。",
    );
  }

  const results = input.combinations.map((combination) => {
    const source = index.resultByHash.get(combination.parameterHash);
    return assessBaseCombination({
      robustnessRunId: input.robustnessRunId,
      sourceSearchRunId: input.sourceSearchRunId,
      combination,
      axes,
      index,
      config: input.config,
      metricsSource: source?.metricsSource ?? "missing",
    });
  });

  const parameterAnalyses = axes.map((axis) =>
    buildParameterAnalysis({
      robustnessRunId: input.robustnessRunId,
      sourceSearchRunId: input.sourceSearchRunId,
      axis,
      combinations: input.combinations,
      results,
    }),
  );

  const matrix = buildRobustnessMatrix({
    axes,
    rows: results.map((result) => ({
      parameterHash: result.parameterHash,
      parameters: result.parameters,
      status: result.status,
      stable: result.stable,
      stabilityRatio: result.stabilityRatio,
      totalReturnPct: result.metrics.totalReturnPct,
      tradeCount: result.metrics.tradeCount,
    })),
  });

  const accumulator = new RobustnessSummaryAccumulator();
  for (const result of results) accumulator.add(result.status, result.neighborhoodIncomplete);

  const missingCells = matrix.cells.filter((cell) => cell.status === "MISSING").length;
  const ambiguousCells = matrix.cells.filter((cell) => cell.status === "AMBIGUOUS").length;
  if (missingCells > 0) {
    notes.push(
      `稳定性矩阵有 ${String(missingCells)} 个格子对应的组合不在源 Parameter Search 中`
        + "⇒ 如实标 MISSING，**不做任何插值 / 补值**（规格 §7 / §21 E）。",
    );
  }
  if (ambiguousCells > 0) {
    notes.push(
      `稳定性矩阵有 ${String(ambiguousCells)} 个格子命中多条组合`
        + `（搜索空间含多于两个可变参数；被略过：${matrix.omittedParameters.join(" / ")}）`
        + "⇒ 如实标 AMBIGUOUS，不挑一条当代表。",
    );
  }

  const secondAxis = axes[1];
  notes.push(
    `邻域口径：沿单参数轴 ±1..±${String(input.config.neighborDistance)} 步（轴对齐）；`
      + `稳定性容差 = 收益 ±${String(input.config.returnTolerancePct)} 个百分点 ∧ 回撤 ±${String(input.config.drawdownTolerancePct)} 个百分点；`
      + `判定所需最少有效邻居数 = ${String(input.config.minValidNeighbors)}（口径随 Run 持久化，不随数据变化）。`,
  );
  void secondAxis;

  return {
    results,
    parameterAnalyses,
    matrix,
    summary: accumulator.finish({
      sourceCombinationCount: input.combinations.length,
      parameterReference: { verified: true, note: "" },
    }),
    notes,
  };
}

/** 供 UI / 报告使用的「指标标签」唯一映射（避免前端再写一份中文名）。 */
export const ROBUSTNESS_METRIC_LABELS: Readonly<Record<RobustnessDispersionMetric, string>> = {
  totalReturnPct: "总收益率（%）",
  annualizedReturnPct: "年化收益率（%）",
  maxDrawdownPct: "最大回撤（%）",
  tradeCount: "成交笔数",
  winRatePct: "胜率（%）",
  profitFactor: "盈亏比",
};
