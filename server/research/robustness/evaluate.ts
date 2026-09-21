/**
 * STEP 18 / C-18.1 — 重估编排器（runRobustnessStress）。
 *
 * 职责：一次鲁棒性请求（request）→ 完整 RobustnessRun 记录：
 *   1. 校验请求（strategy 身份 / runId / createdAt / thresholds / evaluator /
 *      扰动清单：非空、索引 0 = 基准、唯一基准、单轴）；退化输入结构化抛错；
 *   2. 逐扰动配置复核（cost/slippage → C-14.2 assertValidCostModelDeclaration；
 *      execution → C-14.3 assertValidExecutionConstraintDeclaration；
 *      parameter → 可序列化值域检查），非法属编程错误 → 抛错（失败响亮）；
 *   3. 逐扰动注入式评估（evaluator 由调用方提供，本模块不执行 IO / 回测）；
 *      evaluator 抛错 / 返回 failed / 产物非法 → 该扰动转记为 failed 样本
 *      （结构化可见，不静默吞掉——对齐 C-17.1 SearchRun 的样本转记哲学）；
 *   4. 基准条目评估失败 → 漂移无锚点，结构化抛错（RB18_BASELINE_FAILED，
 *      拒绝产出无意义的鲁棒性结论）；
 *   5. assessRobustnessSensitivity → 逐样本判定（漂移/verdict）+ 轴级结论；
 *   6. 组装 RobustnessRun（axis / thresholds / samples / conclusion / createdAt /
 *      fingerprint，内容全自描述可复现）。
 *
 * 确定性纪律：无 Date.now / Math.random / IO；robustnessRunId / createdAt 由调用方
 * 注入；同请求 + 同 evaluator（确定性）必得同记录同指纹。
 */

import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import {
  assertValidCostModelDeclaration,
} from "../costModel/validate";
import {
  assertValidExecutionConstraintDeclaration,
} from "../executionConstraints/validate";
import {
  assessRobustnessSensitivity,
  resolveRobustnessThresholds,
  validateRobustnessMetrics,
  type RobustnessEntryInput,
} from "./drift";
import { computeRobustnessRunFingerprint } from "./serialize";
import { findSerializableConfigProblem } from "./dimension";
import type {
  PerturbationItem,
  RobustnessRequest,
  RobustnessRun,
  RobustnessSampleOutcome,
} from "./types";
import {
  ROBUSTNESS_RUN_RECORD_KIND,
  ROBUSTNESS_RUN_RECORD_VERSION,
} from "./types";

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

/**
 * 参数集可序列化检查（number 有限 / boolean / string / null；拒绝 NaN/Infinity/对象嵌套）。
 *
 * 🔴 遍历逻辑复用泛化层的**唯一实现** `findSerializableConfigProblem`（规格 §2 的适配点 2：
 *    研究侧的不透明变体配置走同一条路径），本函数只做「问题 → 策略侧既有错误码词表」的投影
 *    —— 错误码 / 路径 / 文案与历史**逐字一致**（既有测试即等价性判据）。
 */
function assertSerializableParameterSet(parameterSet: unknown, path: string): void {
  const problem = findSerializableConfigProblem(parameterSet);
  if (problem === null) return;
  if (problem.kind === "NOT_OBJECT") {
    throw new ResearchValidationError([
      issue("RB18_PARAM_CONFIG_INVALID", path, "扰动参数集必须是对象"),
    ]);
  }
  if (problem.kind === "NON_FINITE") {
    throw new ResearchValidationError([
      issue(
        "RB18_PARAM_CONFIG_NON_FINITE",
        `${path}.${problem.key ?? ""}`,
        `扰动参数 ${problem.key} 含非有限数字 ${problem.literal}（禁止 NaN / Infinity）`
      ),
    ]);
  }
  throw new ResearchValidationError([
    issue(
      "RB18_PARAM_CONFIG_TYPE_INVALID",
      `${path}.${problem.key ?? ""}`,
      `扰动参数 ${problem.key} 的类型不受支持（${problem.valueType}）；仅 number | string | boolean | null`
    ),
  ]);
}

/** 复核单条扰动配置（按轴走既有 validate / 参数可序列化检查；非法属编程错误）。 */
function assertValidPerturbationConfig(item: PerturbationItem): void {
  if (item === null || typeof item !== "object") {
    throw new ResearchValidationError([
      issue("RB18_PERTURBATION_INVALID", "perturbations", "扰动条目必须是对象"),
    ]);
  }
  const axisLabel = item.axis;
  switch (item.axis) {
    case "cost":
    case "slippage":
      assertValidCostModelDeclaration(item.config);
      return;
    case "execution":
      assertValidExecutionConstraintDeclaration(item.config);
      return;
    case "parameter":
      assertSerializableParameterSet(item.config, "perturbations.config");
      return;
    default:
      // 运行期防御（类型层面不可能到达）。
      throw new ResearchValidationError([
        issue("RB18_AXIS_UNKNOWN", "perturbations.axis", `未知扰动轴：${String(axisLabel)}`),
      ]);
  }
}

/**
 * 递归冻结（**策略侧与泛化层共用的唯一实现**；泛化层记录同样要求不可变）。
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 执行一次鲁棒性测试，产出完整 RobustnessRun 记录。
 * 退化输入：空扰动清单 / 缺基准 / 基准不在索引 0 / 混轴 / 非法阈值 / 非法配置 /
 * 基准条目评估失败 → 全部结构化抛错（ResearchValidationError），不产出半成品记录。
 */
export function runRobustnessStress(request: RobustnessRequest): RobustnessRun {
  const problems: ResearchValidationIssue[] = [];
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new ResearchValidationError([
      issue("RB18_REQUEST_INVALID", "request", "request 必须是对象"),
    ]);
  }
  for (const field of ["strategyId", "strategyVersion", "robustnessRunId", "createdAt"] as const) {
    const value = (request as unknown as Record<string, unknown>)[field];
    if (typeof value !== "string" || (value as string).trim() === "") {
      problems.push(issue("RB18_REQUEST_FIELD_EMPTY", field, `${field} 必须是非空字符串`));
    }
  }
  if (typeof request.evaluator !== "function") {
    problems.push(issue("RB18_REQUEST_EVALUATOR_INVALID", "evaluator", "evaluator 必须是函数"));
  }
  const thresholds = resolveRobustnessThresholds(request.thresholds);

  const perturbations = request.perturbations;
  if (!Array.isArray(perturbations) || perturbations.length === 0) {
    problems.push(issue("RB18_REQUEST_PERTURBATIONS_EMPTY", "perturbations", "扰动清单不能为空"));
  } else {
    if (perturbations[0]!.isBaseline !== true) {
      problems.push(issue("RB18_BASELINE_NOT_FIRST", "perturbations[0]", "扰动清单索引 0 必须是基准条目（isBaseline=true）"));
    }
    let baselineCount = 0;
    let declaredAxis: string | null = null;
    perturbations.forEach((item, index) => {
      if (item === null || typeof item !== "object") {
        problems.push(issue("RB18_REQUEST_PERTURBATION_INVALID", `perturbations[${index}]`, "扰动条目必须是对象"));
        return;
      }
      if (item.isBaseline === true) baselineCount += 1;
      if (declaredAxis === null) {
        declaredAxis = item.axis;
      } else if (item.axis !== declaredAxis) {
        problems.push(issue("RB18_AXIS_MIXED", `perturbations[${index}]`, `扰动清单混轴：${declaredAxis} 与 ${item.axis}`));
      }
    });
    if (baselineCount !== 1) {
      problems.push(
        issue(
          "RB18_BASELINE_COUNT_INVALID",
          "perturbations",
          `扰动清单基准条目数 = ${baselineCount}（必须恰 1 条且位于索引 0）`
        )
      );
    }
  }
  if (problems.length > 0) {
    throw new ResearchValidationError(problems);
  }

  // 逐扰动配置复核（assert 抛错 = 编程错误，不进入评估）。
  for (const item of perturbations) {
    assertValidPerturbationConfig(item);
  }

  // ---- 逐扰动注入式评估（evaluator 抛错 / 返回 failed / 产物非法 → 样本转记 failed） ----
  const entries: RobustnessEntryInput[] = [];
  for (const item of perturbations) {
    let outcome: RobustnessSampleOutcome;
    try {
      outcome = request.evaluator(item);
    } catch (error) {
      entries.push({
        perturbation: item,
        status: "failed",
        metrics: null,
        error: `评估器抛错：${errorMessage(error)}`,
      });
      continue;
    }
    if (outcome.status === "failed") {
      entries.push({
        perturbation: item,
        status: "failed",
        metrics: null,
        error: outcome.error.trim() === "" ? "评估器返回空错误" : outcome.error,
      });
      continue;
    }
    const metricProblem = validateRobustnessMetrics(outcome.metrics);
    if (metricProblem !== null) {
      entries.push({
        perturbation: item,
        status: "failed",
        metrics: null,
        error: `评估产物非法：${metricProblem}`,
      });
      continue;
    }
    entries.push({
      perturbation: item,
      status: "succeeded",
      metrics: outcome.metrics,
      error: null,
    });
  }

  // 基准条目评估失败在此抛错（漂移无锚点）；正常路径产轴级结论。
  const assessment = assessRobustnessSensitivity(entries, thresholds);

  const body: Omit<RobustnessRun, "fingerprint"> = {
    recordKind: ROBUSTNESS_RUN_RECORD_KIND,
    recordVersion: ROBUSTNESS_RUN_RECORD_VERSION,
    robustnessRunId: request.robustnessRunId,
    strategyId: request.strategyId,
    strategyVersion: request.strategyVersion,
    axis: assessment.conclusion.axis,
    thresholds,
    samples: assessment.samples,
    conclusion: assessment.conclusion,
    createdAt: request.createdAt,
  };
  const fingerprint = computeRobustnessRunFingerprint(body);
  return deepFreeze<RobustnessRun>({ ...body, fingerprint });
}
