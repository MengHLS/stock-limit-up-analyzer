/**
 * STEP 20 / C-20.2 — 因子消融与 OOS 退化：与 C-20.1（overfittingDetection）的汇合适配。
 *
 * 背景：C-20.1 `assessOfdOverfitting` 的输入形态 `OfdAssessmentInput` 只接受
 *   pbo / parameterSensitivity / robustnessView 三个槽位（不改既有文件）。本模块的消融
 *   结论要并入 Overfitting 聚合判定，走的是 C-20.1 预留的 `robustnessView` 槽——因此这里
 *   提供**纯投影函数**把 `AblationAssessmentRun` 结构兼容地映射为
 *   `ParameterSensitivityRobustnessView`（type-import 只读），协调者接线方式：
 *
 *   ```ts
 *   import { assessAblationRun, toAblationOfdAssessmentInput } from "../factorAblation";
 *   import { assessOfdOverfitting } from "../overfittingDetection";
 *   const ablationRun = assessAblationRun({ ... 消融请求 ... });
 *   const ofaInput = toAblationOfdAssessmentInput(ablationRun); // OfdAssessmentInput
 *   const ofaRun = assessOfdOverfitting(ofaInput, { assessmentRunId, strategyId, strategyVersion, createdAt });
 *   ```
 *
 *   这样消融结论以**并列记录**形式（robustnessView 槽 + sourceFingerprint=消融记录指纹）
 *   附加到 C-20.1 聚合判定，overfittingDetection 既有文件零改动。
 *
 * 映射语义（诚实声明）：
 *   - axis = "factorAblation"；
 *   - sensitiveCount = 消融记录中的**过拟合信号候选数**（signals.length）——这些是描述性
 *     候选（IS 贡献显著、OOS 转负/趋零），投递给 C-20.1 后若 verdict="sensitive" 会推高
 *     聚合到 OVERFIT；**是否采纳为 OVERFIT 由协调者决定**，本投影不替它下结论；
 *   - stableCount = IS 轨可评估且未被标记信号的成分数（仅描述）；
 *   - verdict = sensitive（有候选）> insufficient（全部非 base 失败）> no-variants（无变体）
 *     > stable（其余）；
 *   - 视图阈值（returnDriftThresholdPct / drawdownWorseningThresholdPct）仅为结构兼容占位，
 *     复用 C-18.1 默认漂移阈值（消融自身阈值在 AblationAssessmentRun.thresholds，以
 *     sourceFingerprint 溯源，不做字段级混写）。
 *
 * 铁律：纯函数、readonly、无 IO；import 只读（type-import + robustness 常量），不改既有文件。
 */

import {
  DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT,
  DEFAULT_RETURN_DRIFT_THRESHOLD_PCT,
} from "../robustness";
import type { AblationAssessmentRun } from "./types";

// 以下仅 type-import C-20.1 的类型形态（编译期擦除，不产生运行时 import）。
import type {
  OfdAssessmentInput,
  ParameterSensitivityRobustnessView,
} from "../overfittingDetection";

/** 消融记录 → C-20.1 robustnessView 槽的结构兼容视图。 */
export function toAblationRobustnessView(
  run: AblationAssessmentRun,
): ParameterSensitivityRobustnessView {
  const nonBaseCount = Math.max(0, run.is.samples.length - 1);
  const sampleCount = nonBaseCount;
  const failedCount = run.is.failedCount;
  const assessedCount = run.is.evaluatedCount;
  const sensitiveCount = run.signals.length;
  const stableCount = run.contributions.filter(
    (entry) => entry.isAssessed && entry.signalCode === null,
  ).length;

  let verdict: ParameterSensitivityRobustnessView["verdict"];
  if (sensitiveCount > 0) {
    verdict = "sensitive";
  } else if (sampleCount === 0) {
    verdict = "no-variants";
  } else if (assessedCount === 0) {
    verdict = "insufficient";
  } else {
    verdict = "stable";
  }

  return {
    axis: "factorAblation",
    verdict,
    baselineSucceeded: run.is.baseSucceeded,
    sensitiveCount,
    stableCount,
    failedCount,
    sampleCount,
    thresholds: {
      returnDriftThresholdPct: DEFAULT_RETURN_DRIFT_THRESHOLD_PCT,
      drawdownWorseningThresholdPct: DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT,
    },
    sourceFingerprint: run.fingerprint,
  };
}

/**
 * 消融记录 → C-20.1 `OfdAssessmentInput`（robustnessView 槽挂接消融结论，
 * pbo / parameterSensitivity 保持 null——它们属 C-20.1 自己的证据，不在这里伪造）。
 */
export function toAblationOfdAssessmentInput(run: AblationAssessmentRun): OfdAssessmentInput {
  return {
    pbo: null,
    parameterSensitivity: null,
    robustnessView: toAblationRobustnessView(run),
  };
}
