/**
 * STEP 20 / C-20.1 — Overfitting 判定聚合（PBO + 参数敏感性 + 可选鲁棒性结果）。
 *
 * 职责：
 *   - 输入：PBO 结果（C-20.1 内部）+ 参数敏感性结果（C-20.1 内部）+ 可选 C-18.1
 *     RobustnessRun 的最小视图（`ParameterSensitivityRobustnessView`）；
 *   - 规则化聚合判定（priority chain，全部可审计）：
 *       ① `NO_EVAL`        ：全部输入均为 null（未评估）；
 *       ② `INCONCLUSIVE`   ：PBO 与参数敏感性**均**为 INCONCLUSIVE / 不可用；
 *       ③ `OVERFIT`        ：PBO OVERFIT_RISK_HIGH 或 参数敏感性 SENSITIVE
 *                            或 RobustnessRun verdict="sensitive"；
 *       ④ `OVERFIT_RISK`   ：PBO OVERFIT_RISK_MODERATE 或 参数敏感性 INCONCLUSIVE；
 *       ⑤ `NOT_OVERFIT`    ：其余（PBO LOW + 参数稳定性 STABLE）；
 *   - 产出 `OverfittingAssessmentRun`：聚合结论 + reasons + 阈值 + 指纹；
 *   - 不下「策略能否上线」结论（属 C-21 / C-25）；本记录只承载「多信号过拟合风险评估」
 *     的事实快照。
 *
 * 铁律：纯函数、确定性、readonly 入参；runId / createdAt 由调用方注入；
 * 无 IO / Date.now / Math.random；指纹 = canonical SHA-256。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { ResearchValidationError, type ResearchValidationIssue } from "../experimentValidation";
import {
  OVERFITTING_ASSESSMENT_RUN_RECORD_KIND,
  OVERFITTING_ASSESSMENT_RUN_RECORD_VERSION,
  type OfdAssessmentInput,
  type OverfittingAssessmentRun,
  type OverfittingConclusion,
  type ParameterSensitivityConclusion,
  type ParameterSensitivityRobustnessView,
  type OfdPboConclusion,
  type ResolvedOfdPboThresholds,
} from "./types";
import { resolveOfdPboThresholds } from "./pbo";

// ---------------------------------------------------------------------------
// 输入校验
// ---------------------------------------------------------------------------

function assertInputValid(input: OfdAssessmentInput): void {
  const issues: ResearchValidationIssue[] = [];
  if (!input || typeof input !== "object") {
    throw new ResearchValidationError([
      { code: "OFA_INPUT_INVALID", path: "input", message: "OfdAssessmentInput 必须是对象" },
    ]);
  }
  if (
    input.pbo !== null &&
    (typeof input.pbo !== "object" ||
      input.pbo.status !== "computed" ||
      input.pbo.pbo === null ||
      input.pbo.fingerprint === undefined)
  ) {
    // 允许 null；非 null 时仅做最浅形态校验（深校验在 deserialize 时再做）。
    if (input.pbo !== null && (typeof input.pbo !== "object" || !Array.isArray(input.pbo.splitResults))) {
      issues.push({
        code: "OFA_PBO_INVALID",
        path: "pbo",
        message: "pbo 非 null 时必须是合法 OfdPboResult",
      });
    }
  }
  if (
    input.parameterSensitivity !== null &&
    (typeof input.parameterSensitivity !== "object" || !Array.isArray(input.parameterSensitivity.samples))
  ) {
    issues.push({
      code: "OFA_PS_INVALID",
      path: "parameterSensitivity",
      message: "parameterSensitivity 非 null 时必须是合法 ParameterSensitivityResult",
    });
  }
  if (
    input.robustnessView !== null &&
    (typeof input.robustnessView !== "object" ||
      typeof input.robustnessView.verdict !== "string" ||
      typeof input.robustnessView.sourceFingerprint !== "string")
  ) {
    issues.push({
      code: "OFA_ROBUSTNESS_VIEW_INVALID",
      path: "robustnessView",
      message: "robustnessView 非 null 时必须是合法 ParameterSensitivityRobustnessView",
    });
  }
  if (issues.length > 0) throw new ResearchValidationError(issues);
}

// ---------------------------------------------------------------------------
// 判定优先级
// ---------------------------------------------------------------------------

/** PBO + 参数敏感性 + 可选 RobustnessRun → 聚合 conclusion。 */
function deriveConclusion(input: OfdAssessmentInput): OverfittingConclusion {
  const pboInconclusive = input.pbo === null || input.pbo.status !== "computed" || input.pbo.pbo === null;
  const psInconclusive =
    input.parameterSensitivity === null ||
    input.parameterSensitivity.conclusion === "INCONCLUSIVE" ||
    input.parameterSensitivity.conclusion === "NO_VARIANTS";
  const allNull = input.pbo === null && input.parameterSensitivity === null && input.robustnessView === null;
  if (allNull) return "NO_EVAL";

  // ① 主证据均不可用 → INCONCLUSIVE（无论 robustnessView 如何，不替代主证据缺失）。
  if (pboInconclusive && psInconclusive && input.robustnessView === null) {
    return "INCONCLUSIVE";
  }

  // ② 强信号（任一 OVERFIT_RISK_HIGH / SENSITIVE / robust sensitive）→ OVERFIT。
  const pboHigh = input.pbo?.conclusion === "OVERFIT_RISK_HIGH";
  const psSensitive = input.parameterSensitivity?.conclusion === "SENSITIVE";
  const robustSensitive = input.robustnessView?.verdict === "sensitive";
  if (pboHigh || psSensitive || robustSensitive) {
    return "OVERFIT";
  }

  // ③ 中等信号（OVERFIT_RISK_MODERATE 或 PS INCONCLUSIVE）→ OVERFIT_RISK。
  const pboModerate = input.pbo?.conclusion === "OVERFIT_RISK_MODERATE";
  if (pboModerate) {
    return "OVERFIT_RISK";
  }

  // ④ 部分证据不可用但其它证据不全 OK → INCONCLUSIVE（不冒充实证 NOT_OVERFIT）。
  if (pboInconclusive && psInconclusive) {
    // 注：上面已排除 robustView===null；此处意味着 robustView 非 null。
    return "INCONCLUSIVE";
  }

  // ⑤ 其余：所有主证据均 LOW/STABLE → NOT_OVERFIT。
  return "NOT_OVERFIT";
}

/**
 * 构造审计 reasons（按判定优先级倒序，便于人类阅读）。
 */
function buildReasons(
  input: OfdAssessmentInput,
  conclusion: OverfittingConclusion,
): readonly string[] {
  const reasons: string[] = [];
  if (input.pbo !== null) {
    if (input.pbo.status === "computed" && input.pbo.pbo !== null) {
      reasons.push(
        `PBO = ${input.pbo.pbo.toFixed(3)}（${input.pbo.overfitCount}/${input.pbo.evaluatedCombinations} 倒置观察，判定 ${input.pbo.conclusion}）`,
      );
    } else {
      reasons.push(
        `PBO 不可用（status=${input.pbo.status}, reasonCode=${input.pbo.reasonCode ?? "n/a"}）`,
      );
    }
  } else {
    reasons.push("PBO 未提供");
  }
  if (input.parameterSensitivity !== null) {
    const ps = input.parameterSensitivity;
    const m = ps.measure;
    reasons.push(
      `参数敏感性：conclusion=${ps.conclusion}, sensitive=${m.sensitiveNonBaselineCount}/${m.evaluatedNonBaselineCount}, `
        + `maxReturnDrift=${m.maxReturnDriftPct?.toFixed(2) ?? "n/a"}, `
        + `maxDrawdownWorsening=${m.maxDrawdownWorseningPct?.toFixed(2) ?? "n/a"}`,
    );
  } else {
    reasons.push("参数敏感性未提供");
  }
  if (input.robustnessView !== null) {
    const rv = input.robustnessView;
    reasons.push(
      `RobustnessView（轴=${rv.axis}）: verdict=${rv.verdict}, sensitive=${rv.sensitiveCount}/${rv.sampleCount}`,
    );
  } else {
    reasons.push("RobustnessView 未提供（C-18.1 未传入）");
  }
  reasons.push(`聚合结论：${conclusion}`);
  return reasons;
}

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

function computeOverfittingAssessmentRunFingerprint(
  body: Omit<OverfittingAssessmentRun, "fingerprint">,
): string {
  return createHash("sha256").update(canonicalStringify(body), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 执行一次 Overfitting 判定聚合评估，产出 OverfittingAssessmentRun 完整记录。
 *
 * 退化输入：pbo / parameterSensitivity / robustnessView 字段形态非法 → 结构化抛错；
 * 全部输入为 null → NO_EVAL 结论。
 */
export function assessOfdOverfitting(
  input: OfdAssessmentInput,
  meta: {
    readonly assessmentRunId: string;
    readonly strategyId: string;
    readonly strategyVersion: string;
    readonly createdAt: string;
  },
): OverfittingAssessmentRun {
  assertInputValid(input);
  if (
    typeof meta.assessmentRunId !== "string" ||
    meta.assessmentRunId.trim() === "" ||
    typeof meta.strategyId !== "string" ||
    meta.strategyId.trim() === "" ||
    typeof meta.strategyVersion !== "string" ||
    meta.strategyVersion.trim() === "" ||
    typeof meta.createdAt !== "string" ||
    meta.createdAt.trim() === ""
  ) {
    throw new ResearchValidationError([
      {
        code: "OFA_META_INVALID",
        path: "meta",
        message: "assessmentRunId / strategyId / strategyVersion / createdAt 必须是非空字符串",
      },
    ]);
  }

  const thresholds: ResolvedOfdPboThresholds = resolveOfdPboThresholds(input.thresholds);
  const conclusion = deriveConclusion(input);
  const reasons = buildReasons(input, conclusion);

  const body: Omit<OverfittingAssessmentRun, "fingerprint"> = {
    recordKind: OVERFITTING_ASSESSMENT_RUN_RECORD_KIND,
    recordVersion: OVERFITTING_ASSESSMENT_RUN_RECORD_VERSION,
    assessmentRunId: meta.assessmentRunId,
    strategyId: meta.strategyId,
    strategyVersion: meta.strategyVersion,
    pbo: input.pbo,
    parameterSensitivity: input.parameterSensitivity,
    robustnessView: input.robustnessView,
    thresholds,
    conclusion,
    reasons,
    createdAt: meta.createdAt,
  };
  const fingerprint = computeOverfittingAssessmentRunFingerprint(body);
  return { ...body, fingerprint };
}

// Re-export 类型，便于调用方 type-only import。
export type {
  OverfittingConclusion,
  OfdPboConclusion,
  ParameterSensitivityConclusion,
  ParameterSensitivityRobustnessView,
};
