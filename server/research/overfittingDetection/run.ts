/**
 * STEP 20 / C-20.1 — 过拟合检测（第一批）：主编排入口与运行元数据。
 *
 * 编排：
 *   - `runOverfittingDetection` 是研究链路统一的过拟合检测入口：
 *     1. 计算 PBO（CSCV）；
 *     2. （可选）计算参数敏感性；
 *     3. （可选）消费 C-18.1 RobustnessRun 的最小视图（评估器实现可注入转换）；
 *     4. 聚合判定 `assessOfdOverfitting` → OverfittingAssessmentRun；
 *     5. 注入 assessmentRunId / createdAt（运行元数据）。
 *
 * 边界：
 *   - PBO 强制要求；参数敏感性 / RobustnessView 可选；
 *   - 全部输入为 null → NO_EVAL 结论（不冒充「未过拟合」）；
 *   - runId / createdAt 注入式（缺省运行时由 randomBytes 生成，测试可注入固定值）。
 *
 * 铁律：纯函数、无 IO / Date.now / Math.random；评估器注入式；
 * mutation isolation（不修改入参）。
 */

import { randomBytes } from "node:crypto";
import { ResearchValidationError } from "../experimentValidation";
import { OVERFITTING_ASSESSMENT_RUN_ID_PREFIX } from "./types";
import { assessOfdOverfitting } from "./assess";
import { computeOfdPbo } from "./pbo";
import { computeParameterSensitivity } from "./parameterSensitivity";
import type {
  OfdAssessmentInput,
  OverfittingAssessmentRun,
  ParameterSensitivityInput,
  ParameterSensitivityRobustnessView,
  OfdPboInput,
} from "./types";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 生成 OverfittingAssessmentRun ID（`OFA-YYYYMMDD-XXXXXXXX`）。 */
export function formatOverfittingAssessmentRunId(date: string, suffix: string): string {
  return `${OVERFITTING_ASSESSMENT_RUN_ID_PREFIX}-${date}-${suffix}`;
}

/** 生成 OFA Run ID；测试可注入 suffix。 */
export function generateOverfittingAssessmentRunId(
  now: Date = new Date(),
  suffix?: string,
): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const resolvedSuffix = suffix ?? randomBytes(4).toString("hex").toUpperCase();
  return formatOverfittingAssessmentRunId(date, resolvedSuffix);
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 一次过拟合检测（第一批：PBO + 可选参数敏感性 + 可选 RobustnessView）。
 *
 * **PBO 输入（必填）**：候选 + 分区指标 + 评估指标 + 方向。
 * **参数敏感性输入（可选）**：基础参数集 + 扰动规则 + 注入式评估器。
 * **RobustnessView（可选）**：调用方自 C-18.1 RobustnessRun 投影的最小视图（避免域耦合）。
 *
 * 退化输入：
 *   - 必填字段缺失 / 非对象 → 结构化抛错（OFA_INPUT_INVALID / PBO_*）；
 *   - 评估器抛错 / 返回非法指标 → 对应模块已结构化处理（PS_BASELINE_FAILED 等）。
 */
export function runOverfittingDetection(
  request: {
    readonly strategyId: string;
    readonly strategyVersion: string;
    readonly pboInput: OfdPboInput;
    readonly parameterSensitivity?: ParameterSensitivityInput | null;
    readonly robustnessView?: ParameterSensitivityRobustnessView | null;
    readonly thresholds?: OfdAssessmentInput["thresholds"];
    readonly assessmentRunId?: string;
    readonly createdAt?: string;
  },
): OverfittingAssessmentRun {
  if (!request || typeof request !== "object") {
    throw new ResearchValidationError([
      { code: "OFA_REQUEST_INVALID", path: "request", message: "request 必须是对象" },
    ]);
  }
  for (const field of ["strategyId", "strategyVersion"] as const) {
    if (typeof request[field] !== "string" || (request[field] as string).trim() === "") {
      throw new ResearchValidationError([
        { code: "OFA_REQUEST_FIELD_EMPTY", path: field, message: `${field} 必须是非空字符串` },
      ]);
    }
  }
  if (!request.pboInput || typeof request.pboInput !== "object") {
    throw new ResearchValidationError([
      { code: "OFA_REQUEST_PBO_MISSING", path: "pboInput", message: "pboInput 必填（即使 PBO 暂不可评估也需显式提供）" },
    ]);
  }

  const pbo = computeOfdPbo(request.pboInput);
  const parameterSensitivity = request.parameterSensitivity === undefined || request.parameterSensitivity === null
    ? null
    : computeParameterSensitivity(request.parameterSensitivity);
  const robustnessView = request.robustnessView ?? null;

  const assessmentRunId = request.assessmentRunId ?? generateOverfittingAssessmentRunId();
  const createdAt = request.createdAt ?? new Date().toISOString();

  return assessOfdOverfitting(
    {
      pbo,
      parameterSensitivity,
      robustnessView,
      thresholds: request.thresholds,
    },
    {
      assessmentRunId,
      strategyId: request.strategyId,
      strategyVersion: request.strategyVersion,
      createdAt,
    },
  );
}
