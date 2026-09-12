/**
 * RESEARCH-004 — SEGMENT_RELATION 分析（分段 / 两窗关系）。
 *
 * ## 回答什么问题
 *
 * 「同一根价格路径被切成先后两段：**前一段**的表现，与**后一段**的表现是什么关系？」
 * 例如「T+1~T+5 的最大跌幅」与「T+5~T+20 的收益」。
 *
 * 现有分析类型都表达不了它：
 *   - QUANTILE 的 `featureField` 必须是 FEATURE（≤ T），拿 `max_drawdown_5d` 当分组键会
 *     被 `VARIABLE_ROLE_VIOLATION` 拒掉（它确实不是 T 日可观测的量）；
 *   - CONDITIONAL 只能表达「满足 / 不满足」，且只输出「全样本 vs 条件组」两组，
 *     做不出「窗 A 分档 → 窗 B 逐档统计」的交叉表。
 *
 * ## 三条口径纪律
 *
 *   1. **分组算法与 QUANTILE 同源**：切点用 `percentile` 线性插值、相同值不劈开
 *      （直接复用 `computeCutPoints` / `assignQuantileGroups`，不另写一份分档规则）；
 *   2. **配对是唯一配对口径**：两侧同时有限才成对（`alignedPairs`），任一侧缺失即整对丢弃，
 *      **不插补** —— 插补会凭空造出相关性；
 *   3. **重叠的窗根本不该跑到这里**：`[a+1,b]` 与 `[c+1,d]` 有交集时配置校验会先以
 *      `WINDOW_OVERLAP` 拒掉（见 `analysisConfig.ts`）。本执行器仍会再断言一次，
 *      因为「窗不重叠」是这个分析结论可解释的**前提**，不能只靠上游一处把关。
 *
 * ## 它不回答什么
 *
 * 结论一律是**统计关系**，不是交易信号。窗 A 的统计量虽然在 T+a 收盘可观测，但决策点
 * 已经后移；本分析不判断「T+a 买入是否赚钱」——那属于回测层的职责。
 */

import { ResearchResultError } from "../../researchCore";
import { metricCalculator } from "../metrics";
import { rangesOverlap, segmentValueWindow } from "../variables";
import type {
  AnalysisExecutionContext,
  AnalysisExecutionResult,
  AnalysisSummary,
  AnalysisVariableRequirementContext,
  ResolvedEngineAnalysisConfig,
} from "../types";
import { assignedWindowVariables, type AssignedWindow } from "../segmentWindows";
import { groupedRows, requireAnalysisId, sampleNote, scalarRow, type ResultRowDraft } from "./helpers";
import { assignQuantileGroups, computeCutPoints, monotonicConsistency } from "./quantile";

/** 每档输出的指标码（窗 B 为「最大跌幅」类口径时不产出 WIN_RATE，见 `perBandMetrics`）。 */
const BAND_METRICS_BASE = ["SAMPLE_COUNT", "MEAN_RETURN", "MEDIAN_RETURN", "STD_RETURN"] as const;

/** 窗 A 分档在结果里的维度键（写入 `research_result.dimensionJson`）。 */
const BAND_DIMENSION_KEY = "windowA";

/** 从已解析配置取出两个窗；缺失即配置非法（此处只做防御性断言，不兜底造窗）。 */
function windowsOf(config: ResolvedEngineAnalysisConfig, analysisId: number): AssignedWindow[] {
  const windows = assignedWindowVariables(config);
  if (windows === null) {
    throw new ResearchResultError(
      `SEGMENT_RELATION 缺少完整的窗配置（analysisId=${analysisId}）：窗 A / 窗 B 的起止相对日与口径都必须给全，`
        + "且不得指望引擎替你补一个默认窗。",
    );
  }
  return windows;
}

export const segmentRelationExecutor = {
  analysisType: "SEGMENT_RELATION" as const,

  requiredVariables(config: ResolvedEngineAnalysisConfig, _context: AnalysisVariableRequirementContext) {
    const required = assignedWindowVariables(config);
    if (required === null) return { features: [], outcomes: [] };
    return { features: [], outcomes: required.map((w) => w.variable) };
  },

  async execute(context: AnalysisExecutionContext): Promise<AnalysisExecutionResult> {
    const analysisId = requireAnalysisId(context);
    const { minSampleCount } = context.config;
    const [windowA, windowB] = windowsOf(context.config, analysisId);
    if (windowA === undefined || windowB === undefined) {
      throw new ResearchResultError("SEGMENT_RELATION 需要恰好两个窗（窗 A 分组、窗 B 结果）");
    }

    // ---- 前提：两窗取值区间不得重叠（结论可解释性的硬前提，独立再断言一次）----
    const valueA = segmentValueWindow(windowA.window[0], windowA.window[1]);
    const valueB = segmentValueWindow(windowB.window[0], windowB.window[1]);
    if (rangesOverlap(valueA, valueB)) {
      throw new ResearchResultError(
        `SEGMENT_RELATION 拒绝执行：两窗取值区间重叠（窗 A T+${valueA[0]}..T+${valueA[1]}、`
          + `窗 B T+${valueB[0]}..T+${valueB[1]}）。共享 K 线会让结论变成同义反复。`,
      );
    }

    // ---- 配对（窗 A 值, 窗 B 值；两侧同时有限）----
    const xs: Array<number | null> = [];
    const ys: Array<number | null> = [];
    for (const sample of context.samples) {
      const a = sample.outcomes[windowA.variable];
      const b = sample.outcomes[windowB.variable];
      xs.push(typeof a === "number" && Number.isFinite(a) ? a : null);
      ys.push(typeof b === "number" && Number.isFinite(b) ? b : null);
    }
    const pairIndexes: number[] = [];
    for (let i = 0; i < xs.length; i += 1) {
      if (xs[i] !== null && ys[i] !== null) pairIndexes.push(i);
    }
    const pairXs = pairIndexes.map((i) => xs[i]!);
    const pairYs = pairIndexes.map((i) => ys[i]!);

    // ---- 窗 A 分档（与 QUANTILE 同一分档规则）----
    const cutPoints = computeCutPoints(pairXs, windowB.bands);
    const bandIds = assignQuantileGroups(pairXs, cutPoints);
    const byBand = new Map<number, number[]>();
    for (let i = 0; i < bandIds.length; i += 1) {
      const band = bandIds[i]!;
      const list = byBand.get(band);
      if (list === undefined) byBand.set(band, [pairYs[i]!]);
      else list.push(pairYs[i]!);
    }
    const bandLabels = [...byBand.keys()].sort((a, b) => a - b);

    // ---- 每档统计 ----
    const rows: ResultRowDraft[] = [];
    const notes: string[] = [];
    const bandSummaries: Array<{ label: number; sampleCount: number; mean: number | null; median: number | null; winRate: number | null }> = [];

    // 窗 B 口径是「跌幅」类极值口径时，「胜率（> 0 占比）」不具解读意义 ⇒ 不产出该行。
    const winRateMeaningful = windowB.stat !== "max_drawdown";
    const perBandMetrics = winRateMeaningful
      ? [...BAND_METRICS_BASE, "WIN_RATE"]
      : [...BAND_METRICS_BASE];
    if (!winRateMeaningful) {
      notes.push(
        `窗 B 口径为「${windowB.statLabel}」，是跌幅类极值口径 —— 「取值 > 0 的占比」不构成通常意义上的胜率，`
          + "故不产出 WIN_RATE（列出来只会诱导错误解读）。"
          + `另需注意：该口径**并非恒为负** —— 取值窗 [T+${windowB.window[0] + 1}, T+${windowB.window[1]}] 不含锚点日`
          + `T+${windowB.window[0]}，价格整段上行时窗内最低收盘仍可能高于锚点收盘。`,
      );
    }

    const meta = {
      windowA: { window: windowA.window, stat: windowA.stat, variable: windowA.variable },
      windowB: { window: windowB.window, stat: windowB.stat, variable: windowB.variable },
      valueWindowA: valueA,
      valueWindowB: valueB,
      requestedBands: windowB.bands,
      actualBands: bandLabels.length,
      cutPoints,
      pairCount: pairXs.length,
      excludedForMissing: context.samples.length - pairXs.length,
      bandingRule:
        "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
      pairingRule: "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
      overlapGuard: "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
      spreadDefinition: "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
    };

    for (const label of bandLabels) {
      const bandValues = byBand.get(label)!;
      const low = sampleNote(bandValues.length, minSampleCount);
      if (low) notes.push(`第 ${label} 档：${low}`);
      const groupDetails = {
        ...meta,
        band: label,
        lowSample: bandValues.length < minSampleCount,
      };
      for (const code of perBandMetrics) {
        const value = code === "SAMPLE_COUNT" ? bandValues.length : metricCalculator.compute(code, bandValues);
        if (value === null) continue;
        rows.push(
          ...groupedRows({
            analysisId,
            metricCode: code,
            dimensionKey: BAND_DIMENSION_KEY,
            groups: [{ label, metricValue: value, sampleCount: bandValues.length }],
            details: { ...groupDetails, metricDefinition: metricCalculator.definitionOf(code) ?? null },
          }),
        );
      }
      bandSummaries.push({
        label,
        sampleCount: bandValues.length,
        mean: metricCalculator.compute("MEAN_RETURN", bandValues),
        median: metricCalculator.compute("MEDIAN_RETURN", bandValues),
        winRate: winRateMeaningful ? metricCalculator.compute("WIN_RATE", bandValues) : null,
      });
    }

    // ---- 配对关系度量（同一样本两时段如何共变）----
    for (const code of ["PAIR_CORRELATION", "PAIR_RANK_CORRELATION", "PAIR_SAMPLE_COUNT"] as const) {
      const value = metricCalculator.computePaired(code, xs, ys);
      if (value === null) continue;
      rows.push(
        scalarRow({
          analysisId,
          metricCode: code,
          metricValue: value,
          sampleCount: pairXs.length,
          details: { ...meta, metricDefinition: metricCalculator.definitionOf(code) ?? null },
        }),
      );
    }

    // ---- 顶底档差与组间差检验 ----
    const bottom = bandLabels[0];
    const top = bandLabels[bandLabels.length - 1];
    const canCompare = bandLabels.length >= 2 && bottom !== undefined && top !== undefined;
    const bottomValues = canCompare ? byBand.get(bottom!)! : [];
    const topValues = canCompare ? byBand.get(top!)! : [];

    let spread: number | null = null;
    let diffT: number | null = null;
    let diffP: number | null = null;
    if (canCompare) {
      spread = metricCalculator.computeBinary("SPREAD_TOP_BOTTOM", topValues, bottomValues);
      diffT = metricCalculator.computeBinary("T_STAT_DIFFERENCE", topValues, bottomValues);
      diffP = metricCalculator.computeBinary("P_VALUE_DIFFERENCE", topValues, bottomValues);
    }

    for (const [code, value] of [
      ["SPREAD_TOP_BOTTOM", spread],
      ["T_STAT_DIFFERENCE", diffT],
      ["P_VALUE_DIFFERENCE", diffP],
    ] as const) {
      if (value === null) continue;
      rows.push(
        scalarRow({
          analysisId,
          metricCode: code,
          metricValue: value,
          sampleCount: topValues.length + bottomValues.length,
          details: {
            ...meta,
            metricDefinition: metricCalculator.definitionOf(code) ?? null,
            topBand: top ?? null,
            bottomBand: bottom ?? null,
            topMean: canCompare ? metricCalculator.compute("MEAN_RETURN", topValues) : null,
            bottomMean: canCompare ? metricCalculator.compute("MEAN_RETURN", bottomValues) : null,
          },
        }),
      );
    }
    if (!canCompare) {
      notes.push(
        `实际分档数 ${bandLabels.length} < 2（窗 A 取值大量并列，切点未产生有效分隔），`
          + "故不产出顶底档差与组间差检验。",
      );
    }

    if (bandLabels.length > 0 && bandLabels.length < windowB.bands) {
      notes.push(`窗 A 取值并列导致实际档数 ${bandLabels.length} 少于请求的 ${windowB.bands}（未静默补齐）。`);
    }
    if (meta.excludedForMissing > 0) {
      notes.push(`${meta.excludedForMissing} 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。`);
    }

    const summary: AnalysisSummary = {
      analysisType: "SEGMENT_RELATION",
      effectLabel:
        `窗 A（T+${windowA.window[0]}..${windowA.window[1]} ${windowA.statLabel}）`
        + `第 ${top ?? "?"} 档 − 第 ${bottom ?? "?"} 档 的 窗 B（T+${windowB.window[0]}..${windowB.window[1]} ${windowB.statLabel}）均值差`,
      effect: spread,
      pValue: diffP,
      tStat: diffT,
      sampleCount: pairXs.length,
      minGroupSampleCount:
        bandLabels.length > 0 ? Math.min(...bandLabels.map((l) => byBand.get(l)!.length)) : null,
      groupCount: bandLabels.length,
      directionConsistency: monotonicConsistency(
        bandLabels.map((l) => metricCalculator.compute("MEAN_RETURN", byBand.get(l)!)),
      ),
      notes: [
        meta.bandingRule,
        meta.pairingRule,
        meta.overlapGuard,
        meta.spreadDefinition,
        "本分析只给**统计关系**：窗 A 统计量虽在 T+"
          + `${windowA.window[1]} 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；`
          + "交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；"
          + "PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，"
          + "且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
        ...notes,
      ],
    };

    return { rows, summary, diagnostics: { meta, bandSummaries } };
  },
};
