/**
 * RESEARCH-002 — 分析配置解析与校验。
 *
 * 职责：
 *   - 把 `research_analysis.configJson`（+ 实验级 `analysisDefaults`）解析为 Engine 内部形态；
 *   - **在进入任何计算之前**完成变量角色校验（用反角色 → `VARIABLE_ROLE_VIOLATION`）；
 *   - 按分析类型校验必填项（缺失 → `INVALID_ANALYSIS_CONFIG`），**不静默补一个看似合理的默认值**。
 *
 * 为什么校验必须前置：如果等到计算完才发现「turnover 其实是个未来变量」，
 * 结果已经落库、Run 已经 COMPLETED —— 那就等于让 PIT 违规留下了"看起来正常"的证据。
 */

import { resolveAnalysisConfig, SEGMENT_STAT_KINDS, type ResearchAnalysis, type ResearchAnalysisConfig, type SegmentStatKind } from "../researchCore";
import { engineAssert } from "./errors";
import {
  isStabilityDimensionKey,
  rangesOverlap,
  segmentValueWindow,
  windowOutcomeVariableName,
} from "./variables";
import type { RegimeTagProvider, ResearchVariableCatalog } from "./variables";
import type { ResolvedEngineAnalysisConfig } from "./types";

/** 解析入参。 */
export interface ResolveEngineConfigInput {
  analysis: ResearchAnalysis;
  /** 实验级默认（`ResearchExperiment.config.analysisDefaults`）。 */
  defaults?: Partial<ResearchAnalysisConfig> | null;
  catalog: ResearchVariableCatalog;
  /** STABILITY 需要 regime 分组时是否提供了标签源。 */
  regimeProvider?: RegimeTagProvider;
}

/** 把未知值收窄为对象（非法形态一律视为空配置，由必填校验兜底报错）。 */
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 解析 + 校验。
 *
 * 各分析类型的必填项：
 *   - DESCRIPTIVE：`variables` 非空（或退化为 `featureField` / `targetField` 单变量）；
 *   - EVENT_STUDY：`targetVariable` 可缺省（按 horizons 自动展开 `future_return_{h}d`）；
 *   - QUANTILE：`featureField` + `targetField` 必填；
 *   - CONDITIONAL：`targetField` 必填（条件来自 `research_analysis_condition` 表）；
 *   - STABILITY：`targetField` 必填；`stabilityDimension` 缺省 `year`。
 */
export function resolveEngineAnalysisConfig(input: ResolveEngineConfigInput): ResolvedEngineAnalysisConfig {
  const { analysis, defaults, catalog, regimeProvider } = input;
  const explicit = asObject(analysis.config) as Partial<ResearchAnalysisConfig>;
  const resolved = resolveAnalysisConfig(defaults ?? null, explicit);
  const type = analysis.analysisType;

  const variables = Array.isArray(resolved.variables) ? resolved.variables.filter((v) => typeof v === "string") : [];
  const stabilityDimension = resolved.stabilityDimension ?? "year";
  const extra: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(resolved.extra ?? {})) extra[k] = v;

  // ---- 分段（两窗）关系：窗解析 + 可用性 + 重叠守卫（RESEARCH-004）----
  const segmentWindow = resolveSegmentWindows({ analysis, catalog, resolved, type });

  // ---- 变量角色校验（前置，任何计算之前）----
  if (resolved.targetField !== undefined) catalog.resolveOutcome(resolved.targetField);
  if (resolved.featureField !== undefined) catalog.resolveFeature(resolved.featureField);
  for (const name of variables) {
    // DESCRIPTIVE 允许混合特征与结果；名字必须在**任一**角色中登记，否则 UNKNOWN_VARIABLE。
    if (!catalog.hasFeature(name) && !catalog.hasOutcome(name)) {
      engineAssert(false, "UNKNOWN_VARIABLE", `未登记的变量："${name}"`, { variable: name, analysisType: type });
    }
  }

  // ---- 按类型校验必填 ----
  switch (type) {
    case "DESCRIPTIVE": {
      const effective = variables.length > 0
        ? variables
        : [resolved.featureField, resolved.targetField].filter((v): v is string => typeof v === "string");
      engineAssert(
        effective.length > 0,
        "INVALID_ANALYSIS_CONFIG",
        "DESCRIPTIVE 分析必须提供 `variables`（或 featureField / targetField 单变量形态）",
        { analysisId: analysis.id ?? null },
      );
      break;
    }
    case "QUANTILE": {
      engineAssert(
        typeof resolved.featureField === "string" && resolved.featureField.length > 0,
        "INVALID_ANALYSIS_CONFIG",
        "QUANTILE 分析必须提供 `featureField`（分组依据的特征变量）",
        { analysisId: analysis.id ?? null },
      );
      engineAssert(
        typeof resolved.targetField === "string" && resolved.targetField.length > 0,
        "INVALID_ANALYSIS_CONFIG",
        "QUANTILE 分析必须提供 `targetField`（结果变量）",
        { analysisId: analysis.id ?? null },
      );
      engineAssert(
        Number.isInteger(resolved.quantileGroups) && resolved.quantileGroups >= 2,
        "INVALID_ANALYSIS_CONFIG",
        `QUANTILE 的 quantileGroups 必须是 ≥ 2 的整数（实得 ${String(resolved.quantileGroups)}）`,
        { analysisId: analysis.id ?? null },
      );
      break;
    }
    case "CONDITIONAL": {
      engineAssert(
        typeof resolved.targetField === "string" && resolved.targetField.length > 0,
        "INVALID_ANALYSIS_CONFIG",
        "CONDITIONAL 分析必须提供 `targetField`（比较用的结果变量）",
        { analysisId: analysis.id ?? null },
      );
      break;
    }
    case "STABILITY": {
      engineAssert(
        typeof resolved.targetField === "string" && resolved.targetField.length > 0,
        "INVALID_ANALYSIS_CONFIG",
        "STABILITY 分析必须提供 `targetField`（结果变量）",
        { analysisId: analysis.id ?? null },
      );
      engineAssert(
        isStabilityDimensionKey(stabilityDimension),
        "INVALID_ANALYSIS_CONFIG",
        `STABILITY 的 stabilityDimension 非法："${stabilityDimension}"`,
        { analysisId: analysis.id ?? null },
      );
      if (stabilityDimension === "regime") {
        engineAssert(
          regimeProvider !== undefined,
          "REGIME_PROVIDER_UNAVAILABLE",
          "STABILITY 指定按 regime 分组，但当前未接入市场环境标签源（Dataset 未提供 regime 列）。"
            + "不会以「看起来像」的标签冒充，请改为 year / month / board / market 分组，或注入 RegimeTagProvider。",
          { analysisId: analysis.id ?? null },
        );
      }
      break;
    }
    case "EVENT_STUDY": {
      engineAssert(
        resolved.horizons.length > 0,
        "INVALID_ANALYSIS_CONFIG",
        "EVENT_STUDY 必须提供至少一个 horizon",
        { analysisId: analysis.id ?? null },
      );
      break;
    }
    case "SEGMENT_RELATION": {
      // 窗的形状 / 取值 / 可用性 / 重叠全部已在 resolveSegmentWindows 里断言完毕；
      // 此处只声明「它必须存在」，避免有人把断言挪走后这里静默放过。
      engineAssert(
        segmentWindow !== null,
        "INVALID_ANALYSIS_CONFIG",
        "SEGMENT_RELATION 缺少可用的窗配置（窗 A / 窗 B 都要给出起止相对日与口径）",
        { analysisId: analysis.id ?? null },
      );
      break;
    }
    default:
      // 其余类型未在 MVP 实现（IC / DISTRIBUTION / CORRELATION / PATH / REGIME / SIGNIFICANCE）
      engineAssert(
        false,
        "UNKNOWN_ANALYSIS_TYPE",
        `分析类型 ${type} 未在 RESEARCH-002 MVP 中实现`,
        { analysisType: type },
      );
  }

  return {
    quantileGroups: resolved.quantileGroups,
    horizons: [...resolved.horizons].sort((a, b) => a - b),
    minSampleCount: resolved.minSampleCount,
    ...(resolved.targetField !== undefined ? { targetVariable: resolved.targetField } : {}),
    ...(resolved.featureField !== undefined ? { featureVariable: resolved.featureField } : {}),
    variables,
    stabilityDimension,
    ...(resolved.dimensionKey !== undefined ? { dimensionKey: resolved.dimensionKey } : {}),
    ...(segmentWindow !== null
      ? {
          windowA: segmentWindow.a.window,
          windowB: segmentWindow.b.window,
          windowAStat: segmentWindow.a.stat,
          windowBStat: segmentWindow.b.stat,
          windowBands: segmentWindow.bands,
        }
      : {}),
    extra,
  };
}

// ---------------------------------------------------------------------------
// SEGMENT_RELATION —— 窗解析与重叠守卫
// ---------------------------------------------------------------------------

interface ResolvedSegmentWindow {
  a: { window: [number, number]; stat: SegmentStatKind; variable: string };
  b: { window: [number, number]; stat: SegmentStatKind; variable: string };
  bands: number;
}

/**
 * 解析并校验 SEGMENT_RELATION 的两个窗。
 *
 * 校验项（任何一项不过 → 具名失败，绝不静默夹取或换一个「差不多」的窗）：
 *   1. 窗形态：二元整数元组，`from ≥ 0`、`to > from`；
 *   2. 口径合法性：必须在 `SEGMENT_STAT_KINDS` 内；
 *   3. **可用性**：映射出来的变量名必须真的在该 Dataset 变量目录里 ——
 *      `from = 0` 走既有变量族（`max_return_*` 等只有视界 {5,10,20}），
 *      `from > 0` 走分段族（受 path 相对日上下界约束）；
 *   4. **重叠守卫**：两窗取值区间不得有交集 → 否则 `WINDOW_OVERLAP`。
 *
 * 第 4 项是本分析存在的意义之一：若窗 B 与窗 A 共享 K 线，「前一段回撤大 → 后一段收益差」
 * 会有一部分是同义反复，相关系数被机械拉高，结论就不再是对市场的陈述。
 */
function resolveSegmentWindows(input: {
  analysis: ResearchAnalysis;
  catalog: ResearchVariableCatalog;
  resolved: ReturnType<typeof resolveAnalysisConfig>;
  type: string;
}): ResolvedSegmentWindow | null {
  const { analysis, catalog, resolved, type } = input;
  if (type !== "SEGMENT_RELATION") return null;
  const analysisId = analysis.id ?? null;

  const parseWindow = (
    raw: unknown,
    label: "窗 A" | "窗 B",
  ): { window: [number, number]; stat: SegmentStatKind; variable: string } => {
    engineAssert(
      Array.isArray(raw) && raw.length === 2,
      "INVALID_ANALYSIS_CONFIG",
      `SEGMENT_RELATION 的${label}必须是 [起, 止] 二元相对日数组`,
      { analysisId, windowLabel: label, raw },
    );
    const from = Number((raw as unknown[])[0]);
    const to = Number((raw as unknown[])[1]);
    engineAssert(
      Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to > from,
      "INVALID_ANALYSIS_CONFIG",
      `SEGMENT_RELATION 的${label}非法：需要整数且 0 ≤ 起 < 止（实得 ${String(from)} / ${String(to)}）`,
      { analysisId, from, to },
    );

    const statRaw = label === "窗 A" ? resolved.windowAStat : resolved.windowBStat;
    engineAssert(
      typeof statRaw === "string" && (SEGMENT_STAT_KINDS as readonly string[]).includes(statRaw),
      "INVALID_ANALYSIS_CONFIG",
      `SEGMENT_RELATION 的${label}口径缺失或非法（可用：${SEGMENT_STAT_KINDS.join(" / ")}）`,
      { analysisId, windowLabel: label, stat: statRaw },
    );
    const stat = statRaw as SegmentStatKind;

    const variable = windowOutcomeVariableName(stat, from, to);
    engineAssert(
      catalog.hasOutcome(variable),
      "INVALID_ANALYSIS_CONFIG",
      `SEGMENT_RELATION 的${label}在该 Dataset 上不可用：`
        + `窗 (${from}, ${to}) + 口径 ${stat} 映射到的变量 "${variable}" 不存在。`
        + (from === 0
          ? `窗起点为 0（锚在事件日收盘）时复用既有变量族 —— 该族只有 path 相对日 1..20`
            + `（future_return_*）与 outcome 视界 ${catalog.outcomeHorizons.join("/")}（max_return / min_return / max_drawdown）。`
          : `分段族的可用相对日为 ${catalog.segmentRange ? `${catalog.segmentRange.min}..${catalog.segmentRange.max}` : "无（该版本没有 path 数据）"}。`),
      { analysisId, windowLabel: label, from, to, stat, variable },
    );

    return { window: [from, to], stat, variable };
  };

  const a = parseWindow(resolved.windowA, "窗 A");
  const b = parseWindow(resolved.windowB, "窗 B");

  const valueA = segmentValueWindow(a.window[0], a.window[1]);
  const valueB = segmentValueWindow(b.window[0], b.window[1]);
  engineAssert(
    !rangesOverlap(valueA, valueB),
    "WINDOW_OVERLAP",
    `SEGMENT_RELATION 的两个窗取值区间重叠：窗 A 取值 T+${valueA[0]}..T+${valueA[1]}、`
      + `窗 B 取值 T+${valueB[0]}..T+${valueB[1]}。`
      + `两者共享 K 线时，窗 B 的结果里混进了用来分组的那段行情，`
      + `相关系数与组间差会有一部分是「同义反复」而非对市场的陈述 ⇒ 本次执行被拒绝。`
      + `请把窗 B 的起点设在窗 A 的终点之后（例如 窗 A = [0, 5]、窗 B = [5, 20]）。`,
    { analysisId, valueWindowA: valueA, valueWindowB: valueB },
  );

  const bands = resolved.windowBands;
  engineAssert(
    Number.isInteger(bands) && bands >= 2 && bands <= 100,
    "INVALID_ANALYSIS_CONFIG",
    `SEGMENT_RELATION 的 windowBands 必须是不小于 2、不大于 100 的整数（实得 ${String(bands)}）`,
    { analysisId, windowBands: bands },
  );

  return { a, b, bands };
}
