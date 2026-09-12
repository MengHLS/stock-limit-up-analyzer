/**
 * RESEARCH-002 — EVENT_STUDY 分析（事件研究）。
 *
 * 输入：event（身份）+ path（逐日相对价格）+ outcome（区间聚合标签）。
 * 输出（每个 horizon 一组，`dimension = { horizon: h }`）：
 *   mean_return / median_return / std_return / win_rate / t_stat / p_value / sample_count
 *   + 区间最大有利偏移（MFE，来自 `max_return_{h}d`）
 *   + 区间最大回撤（MAE，来自 `max_drawdown_{h}d`）
 *   + 突破率 / 平均到突破天数（来自 `is_breakout_{h}d` / `days_to_breakout_{h}d`）
 *
 * 只实现**当前 Dataset 真实具备**的字段：`time_to_target` / `time_to_stop` 需要逐日触价
 * 与本策略的止盈止损线，而 Dataset 未定义任何交易规则，故**不实现**（不虚构）。
 * 与 MFE/MAE 最接近的真实列是 `outcome.daysToBreakout`，本分析以「到突破天数」如实呈现。
 */

import { directionConsistency, metricCalculator } from "../metrics";
import type {
  AnalysisExecutionContext,
  AnalysisExecutionResult,
  AnalysisSummary,
  AnalysisVariableRequirementContext,
  ResolvedEngineAnalysisConfig,
} from "../types";
import { groupedRows, requireAnalysisId, sampleNote, variableValues, type ResultRowDraft } from "./helpers";

/** 每个 horizon 输出的指标码。 */
const PER_HORIZON_METRICS = [
  "SAMPLE_COUNT",
  "MEAN_RETURN",
  "MEDIAN_RETURN",
  "STD_RETURN",
  "WIN_RATE",
  "T_STAT",
  "P_VALUE",
] as const;

/**
 * 该 horizon 的**基础**结果变量（收益序列）——来自 path（`relativeDay = h`），
 * 在 Dataset 的 path 视界范围内必然存在。
 */
function baseVariableFor(horizon: number): string {
  return `future_return_${horizon}d`;
}

/**
 * 该 horizon 的**附加**结果变量（MFE / MAE / 回撤 / 突破）——来自 outcome 表，
 * 而 outcome 只覆盖其自身声明的视界（本项目 = {5,10,20}）。
 * 因此 T+1 / T+3 这类只在 path 中存在的视界**没有**这些列，必须按目录确认后再取用。
 */
function auxiliaryVariablesFor(horizon: number): string[] {
  return [
    `max_return_${horizon}d`,
    `min_return_${horizon}d`,
    `max_drawdown_${horizon}d`,
    `is_breakout_${horizon}d`,
    `days_to_breakout_${horizon}d`,
  ];
}

/** 该 horizon 全部相关变量名（基础 + 附加）。 */
function variableNamesFor(horizon: number): string[] {
  return [baseVariableFor(horizon), ...auxiliaryVariablesFor(horizon)];
}

export const eventStudyExecutor = {
  analysisType: "EVENT_STUDY" as const,

  requiredVariables(config: ResolvedEngineAnalysisConfig, context: AnalysisVariableRequirementContext) {
    const outcomes: string[] = [];
    for (const horizon of config.horizons) {
      // 只请求 Dataset **真实登记**的变量：基础收益序列来自 path，
      // 附加指标来自 outcome，两者视界集合不同，不能无条件要求。
      for (const name of variableNamesFor(horizon)) {
        if (context.catalog.hasOutcome(name)) outcomes.push(name);
      }
    }
    return { features: [], outcomes: [...new Set(outcomes)] };
  },

  async execute(context: AnalysisExecutionContext): Promise<AnalysisExecutionResult> {
    const analysisId = requireAnalysisId(context);
    const { horizons, minSampleCount } = context.config;
    const rows: ResultRowDraft[] = [];
    const perHorizon: Array<{
      horizon: number;
      sampleCount: number;
      meanReturn: number | null;
      winRate: number | null;
      tStat: number | null;
      pValue: number | null;
      mfe: number | null;
      mae: number | null;
      breakoutRate: number | null;
      daysToBreakout: number | null;
    }> = [];
    const notes: string[] = [];

    // 实际装配进来的结果变量（由 requiredVariables 决定，Engine 只加载这些）。
    // 用它来判断「某附加指标是否可取」，而不是假设 outcome 表的视界覆盖了全部 path 视界。
    const loaded = new Set<string>();
    for (const sample of context.samples) {
      for (const key of Object.keys(sample.outcomes)) loaded.add(key);
    }
    const has = (name: string) => loaded.has(name);

    for (const horizon of horizons) {
      const base = baseVariableFor(horizon);
      const names = variableNamesFor(horizon).filter(has);

      const returns = variableValues(context.samples, base, "OUTCOME");
      const mfeValues = has(`max_return_${horizon}d`)
        ? variableValues(context.samples, `max_return_${horizon}d`, "OUTCOME")
        : [];
      const maeValues = has(`min_return_${horizon}d`)
        ? variableValues(context.samples, `min_return_${horizon}d`, "OUTCOME")
        : [];
      const ddValues = has(`max_drawdown_${horizon}d`)
        ? variableValues(context.samples, `max_drawdown_${horizon}d`, "OUTCOME")
        : [];
      const breakoutValues = has(`is_breakout_${horizon}d`)
        ? variableValues(context.samples, `is_breakout_${horizon}d`, "OUTCOME")
        : [];
      const daysToBreakout = has(`days_to_breakout_${horizon}d`)
        ? variableValues(context.samples, `days_to_breakout_${horizon}d`, "OUTCOME")
        : [];

      const missing = auxiliaryVariablesFor(horizon).filter((name) => !has(name));

      const usable = metricCalculator.compute("SAMPLE_COUNT", returns) ?? 0;
      if (usable === 0) {
        notes.push(`T+${horizon}：无任何可用收益样本（Dataset 中该视界数据缺失或未构建），跳过该视口。`);
        continue;
      }
      const low = sampleNote(usable, minSampleCount);
      if (low) notes.push(`T+${horizon}：${low}`);

      // 如实登记「该视界缺少哪些附加指标」——outcome 表只覆盖它自己声明的视界，不虚构。
      if (missing.length > 0) {
        notes.push(
          `T+${horizon}：Dataset 未提供 ${missing.join(" / ")}（这些列来自 outcome 表，` +
            `outcome 只覆盖其声明视界；T+${horizon} 的收益序列来自 path），故不输出对应指标，不虚构。`,
        );
      }

      const details = {
        metricDefinition: null,
        variable: base,
        definition: "path.relativeDay=h 的 closeFromEventClose（事件日收盘 → T+h 收盘收益）。",
        horizon,
        lowSample: usable < minSampleCount,
        availableVariables: names,
        unavailableVariables: missing,
      };

      for (const code of PER_HORIZON_METRICS) {
        const value = code === "SAMPLE_COUNT" ? usable : metricCalculator.compute(code, returns);
        if (value === null) continue;
        rows.push(
          ...groupedRows({
            analysisId,
            metricCode: code,
            dimensionKey: "horizon",
            groups: [{ label: horizon, metricValue: value, sampleCount: usable }],
            details: { ...details, metricDefinition: metricCalculator.definitionOf(code) ?? null },
          }),
        );
      }

      // MFE / MAE / 突破（口径与 returns 不同，用独立 metricCode + 明确 variable）
      const mfe = metricCalculator.compute("MAX_FAVORABLE_EXCURSION", mfeValues);
      const mae = metricCalculator.compute("MAX_ADVERSE_EXCURSION", maeValues);
      const dd = metricCalculator.compute("MAX_DRAWDOWN", ddValues);
      const breakoutRate = metricCalculator.compute("BREAKOUT_RATE", breakoutValues);
      const daysToBreakoutMean = metricCalculator.compute("MEAN_DAYS_TO_BREAKOUT", daysToBreakout);
      for (const [code, value, variable] of [
        ["MAX_FAVORABLE_EXCURSION", mfe, `max_return_${horizon}d`],
        ["MAX_ADVERSE_EXCURSION", mae, `min_return_${horizon}d`],
        ["MAX_DRAWDOWN", dd, `max_drawdown_${horizon}d`],
        ["BREAKOUT_RATE", breakoutRate, `is_breakout_${horizon}d`],
        ["MEAN_DAYS_TO_BREAKOUT", daysToBreakoutMean, `days_to_breakout_${horizon}d`],
      ] as const) {
        if (value === null) continue;
        rows.push(
          ...groupedRows({
            analysisId,
            metricCode: code,
            dimensionKey: "horizon",
            groups: [{ label: horizon, metricValue: value, sampleCount: usable }],
            details: { metricDefinition: metricCalculator.definitionOf(code) ?? null, variable, horizon },
          }),
        );
      }

      perHorizon.push({
        horizon,
        sampleCount: usable,
        meanReturn: metricCalculator.compute("MEAN_RETURN", returns),
        winRate: metricCalculator.compute("WIN_RATE", returns),
        tStat: metricCalculator.compute("T_STAT", returns),
        pValue: metricCalculator.compute("P_VALUE", returns),
        mfe,
        mae,
        breakoutRate,
        daysToBreakout: daysToBreakoutMean,
      });
    }

    // 主视界：样本数最多者优先；并列时取**视界更大**者（覆盖更长的未来窗口，信息更多）。
    // 规则写死在代码里并写入证据，避免「按效应大小事后挑选」。
    const primary = [...perHorizon].sort(
      (a, b) => b.sampleCount - a.sampleCount || b.horizon - a.horizon,
    )[0];
    const consistency = directionConsistency(perHorizon.map((p) => p.meanReturn));

    const summary: AnalysisSummary = {
      analysisType: "EVENT_STUDY",
      effectLabel: primary
        ? `T+${primary.horizon} 未来收益均值（${primary.sampleCount} 个样本）`
        : "事件研究（无可用视界）",
      effect: primary?.meanReturn ?? null,
      pValue: primary?.pValue ?? null,
      tStat: primary?.tStat ?? null,
      sampleCount: context.samples.length,
      minGroupSampleCount: perHorizon.length > 0 ? Math.min(...perHorizon.map((p) => p.sampleCount)) : null,
      groupCount: perHorizon.length,
      directionConsistency: consistency,
      notes: [
        "主视界 = 样本数最多的视界（并列时取视界更大者）；选择规则已写死在代码里并写入证据，非事后挑选。",
        "T_STAT / P_VALUE 使用 Newey-West HAC 稳健统计量 + 正态近似 p 值；事件样本存在重叠视界，独立性假设不严格成立，仅作研究辅助。",
        "时间维度仅实现 Dataset 真实具备的「到突破天数」（outcome.daysToBreakout）；time_to_target / time_to_stop 需要逐日触价与止盈止损规则，Dataset 未定义，故不实现。",
        ...notes,
      ],
    };

    return { rows, summary, diagnostics: { perHorizon } };
  },
};
