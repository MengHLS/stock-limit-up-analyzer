/**
 * STEP 6.5 — Validation → OOS Degradation + Overfitting Assessment。
 *
 * 职责边界（Research Analysis Layer）：
 *   - 综合 WFO / Stability / PBO / Validation-OOS degradation，输出**研究层风险判断**；
 *   - 只做「评估 + 报告」，绝不根据评估结果自动修改 Strategy 参数或自动淘汰策略（§四十）；
 *   - 判定为 **rule-based**（§二十八），阈值集中配置（OverfittingThresholds），不散落 magic number；
 *   - Parameter Stability 仅作为 evidence 写入 reasons，**不单独据此定级**（§二十九）。
 *
 * Degradation 公式（§十四，方向一致）：
 *   - maximize（越大越好）：degradation = validationValue - oosMetricValue
 *   - minimize（越小越好）：degradation = oosMetricValue - validationValue
 *   即「degradation > 0」统一表示 OOS 劣于 Validation，与指标方向无关。
 *   相对退化 relativeDegradation = degradation / |validationValue|（validationValue === 0 时不可用 → null）。
 */

import type { ParameterStabilityReport } from "./parameterStability";
import type { PboResult } from "./pbo";
import type { SelectionDirection, SelectionMetric } from "./validationSelection";

/** 过拟合风险等级。 */
export type OverfittingStatus = "low" | "medium" | "high" | "insufficient_data";

/** 风险判定阈值（研究层明确配置，非代码内散落 magic number）。 */
export interface OverfittingThresholds {
  /** PBO >= pboHigh → high。 */
  pboHigh: number;
  /** PBO >= pboMedium → medium。 */
  pboMedium: number;
  /** maxRelativeDegradation >= degradationHigh → high。 */
  degradationHigh: number;
  /** maxRelativeDegradation >= degradationMedium → medium。 */
  degradationMedium: number;
}

/** 默认阈值（文档化的默认，可覆盖）。 */
export const DEFAULT_OVERFITTING_THRESHOLDS: OverfittingThresholds = {
  pboHigh: 0.5,
  pboMedium: 0.25,
  degradationHigh: 1.0,
  degradationMedium: 0.5,
};

/** 单个窗口的 Validation → OOS 退化。 */
export interface ValidationOosWindow {
  windowIndex: number;
  /** Validation 选择指标值（选中候选）。 */
  validationValue: number;
  /** OOS 上同一指标值（OOS failed / 无指标时为 null）。 */
  oosMetricValue: number | null;
  /** 绝对退化（方向一致；正 = OOS 劣于 Validation）。 */
  degradation: number | null;
  /** 相对退化 degradation / |validationValue|；validationValue === 0 时为 null。 */
  relativeDegradation: number | null;
}

/** Validation → OOS 退化分析汇总。 */
export interface ValidationOosAnalysis {
  selectionMetric: SelectionMetric;
  selectionDirection: SelectionDirection;
  windows: ValidationOosWindow[];
  /** 有 OOS 指标的窗口数。 */
  evaluatedWindowCount: number;
  /** 平均绝对退化（方向一致）；无有效窗口时为 null。 */
  averageDegradation: number | null;
  /** 最大相对退化；无有效窗口时为 null。 */
  maxRelativeDegradation: number | null;
  /** OOS 劣于 Validation 的窗口数（relativeDegradation > 0）。 */
  degradedWindowCount: number;
}

/** Validation → OOS 退化分析的输入（单窗口）。 */
export interface ValidationOosWindowInput {
  windowIndex: number;
  validationValue: number;
  oosMetricValue: number | null;
}

/** 过拟合评估结果（§二十七）。 */
export interface OverfittingAssessment {
  status: OverfittingStatus;
  pbo: PboResult | null;
  parameterStability: ParameterStabilityReport | null;
  validationOosAnalysis: ValidationOosAnalysis | null;
  reasons: string[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 计算 Validation → OOS 退化分析（纯函数、确定性）。
 * 输入窗口按 windowIndex 升序；仅对有 OOS 指标的窗口计算退化。
 */
export function analyzeValidationOos(
  windows: readonly ValidationOosWindowInput[],
  selectionMetric: SelectionMetric,
  selectionDirection: SelectionDirection,
): ValidationOosAnalysis {
  if (!Array.isArray(windows)) {
    throw new Error("analyzeValidationOos: windows 必须是数组");
  }

  const analyzed: ValidationOosWindow[] = [];
  for (const w of windows) {
    if (w.oosMetricValue === null || !isFiniteNumber(w.oosMetricValue)) {
      analyzed.push({
        windowIndex: w.windowIndex,
        validationValue: w.validationValue,
        oosMetricValue: null,
        degradation: null,
        relativeDegradation: null,
      });
      continue;
    }
    const degradation = selectionDirection === "maximize"
      ? w.validationValue - w.oosMetricValue
      : w.oosMetricValue - w.validationValue;
    const relativeDegradation = w.validationValue === 0 ? null : degradation / Math.abs(w.validationValue);
    analyzed.push({
      windowIndex: w.windowIndex,
      validationValue: w.validationValue,
      oosMetricValue: w.oosMetricValue,
      degradation,
      relativeDegradation,
    });
  }

  const evaluated = analyzed.filter((w) => w.degradation !== null);
  let averageDegradation: number | null = null;
  let maxRelativeDegradation: number | null = null;
  let degradedWindowCount = 0;

  if (evaluated.length > 0) {
    averageDegradation = evaluated.reduce((sum, w) => sum + (w.degradation as number), 0) / evaluated.length;
    const relativeValues = evaluated
      .map((w) => w.relativeDegradation)
      .filter((value): value is number => value !== null);
    if (relativeValues.length > 0) {
      maxRelativeDegradation = Math.max(...relativeValues);
    }
    degradedWindowCount = evaluated.filter((w) => (w.relativeDegradation ?? 0) > 0).length;
  }

  return {
    selectionMetric,
    selectionDirection,
    windows: analyzed,
    evaluatedWindowCount: evaluated.length,
    averageDegradation,
    maxRelativeDegradation,
    degradedWindowCount,
  };
}

/** 过拟合评估输入。 */
export interface OverfittingAssessmentInput {
  pbo: PboResult | null;
  parameterStability: ParameterStabilityReport | null;
  validationOosAnalysis: ValidationOosAnalysis | null;
  thresholds?: OverfittingThresholds;
}

/**
 * 规则化过拟合评估（§二十八）。
 *
 * 规则（优先级从高到低，全部可审计）：
 *   - **insufficient_data**（最高优先级）：PBO 与 Validation→OOS 退化两项主证据均不可用
 *     （Parameter Stability 仅作 evidence，不足以单独支撑 overfitting 判断）；
 *   - **high**：PBO >= pboHigh，或 maxRelativeDegradation >= degradationHigh（明显 Validation → OOS 崩溃）；
 *   - **medium**：PBO >= pboMedium，或 maxRelativeDegradation >= degradationMedium；
 *   - **low**：其余。
 *
 * Parameter Stability 只作为 evidence 写入 reasons，不单独触发 high/medium（§二十九：参数变化大
 * 可能只是市场 regime 改变，而非过拟合）。返回全新对象，不修改输入（§三十八「不修改输入」）。
 */
export function assessOverfitting(input: OverfittingAssessmentInput): OverfittingAssessment {
  const thresholds = input.thresholds ?? DEFAULT_OVERFITTING_THRESHOLDS;
  const pbo = input.pbo;
  const stability = input.parameterStability;
  const validationOos = input.validationOosAnalysis;

  const pboComputed = pbo !== null && pbo.status === "computed" && pbo.pbo !== null;
  const degradationEvidence = validationOos !== null && validationOos.evaluatedWindowCount > 0;
  const stabilityEvidence = stability !== null && stability.parameters.length > 0;

  const reasons: string[] = [];

  if (pboComputed) {
    reasons.push(`PBO = ${(pbo!.pbo as number).toFixed(3)}（overfit ${pbo!.overfitCount}/${pbo!.evaluatedCombinations}）`);
  } else {
    reasons.push("PBO 不可用（未提供或数据不足）");
  }
  if (degradationEvidence) {
    reasons.push(
      `Validation→OOS 平均退化 ${validationOos!.averageDegradation!.toFixed(4)}，`
      + `最大相对退化 ${(validationOos!.maxRelativeDegradation ?? 0).toFixed(3)}`
      + `（${validationOos!.degradedWindowCount}/${validationOos!.evaluatedWindowCount} 窗口 OOS 劣于 Validation）`,
    );
  } else {
    reasons.push("Validation→OOS 退化分析无有效证据");
  }
  if (stabilityEvidence) {
    const uniqueSummary = stability!.parameters
      .map((p) => `${p.parameterName}:${p.uniqueCount}`)
      .join(",");
    reasons.push(`参数稳定性（唯一取值数）{ ${uniqueSummary} }`);
  } else {
    reasons.push("参数稳定性数据不可用");
  }

  // insufficient_data（最高优先级）：PBO 与 Validation→OOS 退化两项主证据均不可用。
  // Parameter Stability 仅作 evidence，不足以单独支撑 overfitting 判断（§二十九）。
  if (!pboComputed && !degradationEvidence) {
    return { status: "insufficient_data", pbo, parameterStability: stability, validationOosAnalysis: validationOos, reasons };
  }

  // high
  if ((pboComputed && (pbo!.pbo as number) >= thresholds.pboHigh)
    || (degradationEvidence && (validationOos!.maxRelativeDegradation ?? 0) >= thresholds.degradationHigh)) {
    return { status: "high", pbo, parameterStability: stability, validationOosAnalysis: validationOos, reasons };
  }

  // medium
  if ((pboComputed && (pbo!.pbo as number) >= thresholds.pboMedium)
    || (degradationEvidence && (validationOos!.maxRelativeDegradation ?? 0) >= thresholds.degradationMedium)) {
    return { status: "medium", pbo, parameterStability: stability, validationOosAnalysis: validationOos, reasons };
  }

  return { status: "low", pbo, parameterStability: stability, validationOosAnalysis: validationOos, reasons };
}
