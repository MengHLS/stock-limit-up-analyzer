/**
 * STEP 14 / C-14.2 — 成本模型：成本模型声明 schema 校验（结构化 issue）。
 *
 * 语义（目标 ② 的交付）：
 *   - 声明是可序列化配置，必须可被机器校验：负费率 / 非有限 / 超界 / 未知字段 /
 *     非整数一手股数等一律产出结构化 issue（code + path + message），绝不静默修正；
 *   - 复用 research 层既有 ResearchValidationIssue / Result / Error 体系
 *     （experimentValidation.ts，与 simulator / signalEngine 一致）；
 *   - 值域上界按 A 股监管/惯例口径文档化（见 BOUND 常量区），防「回测可信」被
 *     荒谬费率破坏。
 *
 * 铁律：纯函数、确定性、只读入参；validate* 不抛错（返回结构化结果），assert* 抛
 * ResearchValidationError。
 */

import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "../experimentValidation";
import type { CostModelDeclaration } from "./types";

// ---------------------------------------------------------------------------
// 值域边界（文档化口径）
// ---------------------------------------------------------------------------

/** 佣金费率上界：监管上限 3‰（A 股现行）。 */
export const COMMISSION_RATE_MAX = 0.003;
/** 印花税率上界：历史宽上限 3‰（现行 0.5‰）。 */
export const STAMP_DUTY_RATE_MAX = 0.003;
/** 过户费率上界：历史宽上限 1‰（现行 0.1‱ = 0.001%）。 */
export const TRANSFER_FEE_RATE_MAX = 0.001;
/** 基础滑点上界：1000bp = 10%（贴近单日涨跌停幅，超此值必为错误）。 */
export const SLIPPAGE_BPS_MAX = 1000;
/** 最低佣金上界（元）。 */
export const MIN_COMMISSION_MAX = 10_000;
/** 一手股数上界。 */
export const LOT_SIZE_MAX = 1_000_000;
/** 冲击系数上界（基点）。 */
export const IMPACT_COEFFICIENT_MAX = 1_000_000;
/** 冲击指数上界（> 2 视为超域外推）。 */
export const IMPACT_EXPONENT_MAX = 2;
/** 冲击上限基点常量（仅为边界用，声明内 maxBps 校验依赖该常量的存在性）。 */
export const IMPACT_MAX_BPS_CAP = 1_000_000;

const ROOT_FIELDS = [
  "name",
  "commissionRate",
  "stampDutyRate",
  "transferFeeRate",
  "slippageBps",
  "lotSize",
  "minCommission",
  "marketImpact",
] as const;

const IMPACT_FIELDS = [
  "enabled",
  "coefficient",
  "exponent",
  "maxBps",
  "maxParticipation",
] as const;

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function result(issues: ResearchValidationIssue[]): ResearchValidationResult {
  return { valid: issues.length === 0, issues };
}

function assertValid(r: ResearchValidationResult): void {
  if (!r.valid) throw new ResearchValidationError(r.issues);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 未知字段检测（防止 JSON 来源的拼写漂移/类型混淆）。 */
function checkUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ResearchValidationIssue[]
): void {
  for (const key of Object.keys(record)) {
    if (!(allowed as readonly string[]).includes(key)) {
      issues.push(
        issue(
          "CM14_UNKNOWN_FIELD",
          `${path}.${key}`,
          `未知字段：允许的字段为 ${allowed.join(" / ")}`
        )
      );
    }
  }
}

/**
 * 数值字段通用校验：必须存在、为有限数字、在 [min, max]（min 缺省 0）。
 */
function checkNumber(
  record: Record<string, unknown>,
  field: string,
  path: string,
  label: string,
  min: number,
  max: number,
  issues: ResearchValidationIssue[],
  options: { readonly integer?: boolean } = {}
): void {
  const value = record[field];
  if (value === undefined) {
    issues.push(
      issue("CM14_FIELD_MISSING", `${path}.${field}`, `${label} 缺失`)
    );
    return;
  }
  if (!isFiniteNumber(value)) {
    issues.push(
      issue(
        "CM14_NOT_FINITE",
        `${path}.${field}`,
        `${label} 必须是有限数字，收到 ${String(value)}`
      )
    );
    return;
  }
  if (value < min || value > max) {
    issues.push(
      issue(
        "CM14_OUT_OF_RANGE",
        `${path}.${field}`,
        `${label}（${value}）超出允许区间 [${min}, ${max}]`
      )
    );
  }
  if (options.integer === true && !Number.isInteger(value)) {
    issues.push(
      issue(
        "CM14_NOT_INTEGER",
        `${path}.${field}`,
        `${label}（${value}）必须是整数`
      )
    );
  }
}

/** 校验市场冲击子模型。 */
function validateMarketImpactParams(
  impact: unknown,
  path: string,
  issues: ResearchValidationIssue[]
): void {
  if (impact === null || typeof impact !== "object" || Array.isArray(impact)) {
    issues.push(
      issue("CM14_IMPACT_INVALID", path, "marketImpact 必须是对象")
    );
    return;
  }
  const params = impact as Record<string, unknown>;
  checkUnknownKeys(params, IMPACT_FIELDS, path, issues);

  const enabled = params.enabled;
  if (typeof enabled !== "boolean") {
    issues.push(
      issue(
        "CM14_IMPACT_ENABLED_INVALID",
        `${path}.enabled`,
        "enabled 必须是布尔"
      )
    );
  }

  checkNumber(params, "coefficient", path, "coefficient", 0, IMPACT_COEFFICIENT_MAX, issues);
  if (isFiniteNumber(params.coefficient) && (params.coefficient as number) <= 0) {
    issues.push(
      issue(
        "CM14_IMPACT_COEFFICIENT_NONPOSITIVE",
        `${path}.coefficient`,
        "coefficient 必须 > 0（0 会让模型恒等于 0，属于关闭意图但未显式 enabled=false）"
      )
    );
  }
  checkNumber(params, "exponent", path, "exponent", 0, IMPACT_EXPONENT_MAX, issues);
  if (isFiniteNumber(params.exponent) && (params.exponent as number) <= 0) {
    issues.push(
      issue(
        "CM14_IMPACT_EXPONENT_NONPOSITIVE",
        `${path}.exponent`,
        "exponent 必须 > 0"
      )
    );
  }
  checkNumber(params, "maxBps", path, "maxBps", 0, IMPACT_MAX_BPS_CAP, issues);
  if (isFiniteNumber(params.maxBps) && (params.maxBps as number) <= 0) {
    issues.push(
      issue(
        "CM14_IMPACT_MAX_BPS_NONPOSITIVE",
        `${path}.maxBps`,
        "maxBps 必须 > 0"
      )
    );
  }
  checkNumber(params, "maxParticipation", path, "maxParticipation", 0, 1, issues);
  if (
    isFiniteNumber(params.maxParticipation) &&
    (params.maxParticipation as number) <= 0
  ) {
    issues.push(
      issue(
        "CM14_IMPACT_MAX_PARTICIPATION_NONPOSITIVE",
        `${path}.maxParticipation`,
        "maxParticipation 必须 ∈ (0, 1]"
      )
    );
  }
  // 一致性：maxBps ≥ coefficient（保证 p ∈ (0,1] 内 min() 上限不静默截断公式结果）。
  if (
    isFiniteNumber(params.maxBps) &&
    isFiniteNumber(params.coefficient) &&
    (params.maxBps as number) < (params.coefficient as number)
  ) {
    issues.push(
      issue(
        "CM14_IMPACT_BOUNDS_INCONSISTENT",
        `${path}.maxBps`,
        `maxBps（${params.maxBps}）必须 ≥ coefficient（${params.coefficient}），` +
          `否则模型在 p ∈ (0,1] 内被 maxBps 静默截断`
      )
    );
  }
}

/** 校验成本模型声明（纯函数，返回结构化结果）。 */
export function validateCostModelDeclaration(
  declaration: CostModelDeclaration | unknown | null | undefined
): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (
    declaration === null ||
    typeof declaration !== "object" ||
    Array.isArray(declaration)
  ) {
    return result([
      issue(
        "CM14_DECLARATION_INVALID",
        "declaration",
        "成本模型声明必须是对象"
      ),
    ]);
  }
  const d = declaration as Record<string, unknown>;
  checkUnknownKeys(d, ROOT_FIELDS, "declaration", issues);

  const name = d.name;
  if (name === undefined) {
    issues.push(issue("CM14_FIELD_MISSING", "declaration.name", "name 缺失"));
  } else if (typeof name !== "string" || name.trim() === "") {
    issues.push(
      issue(
        "CM14_NAME_INVALID",
        "declaration.name",
        "name 必须是非空字符串"
      )
    );
  }

  checkNumber(d, "commissionRate", "declaration", "commissionRate", 0, COMMISSION_RATE_MAX, issues);
  checkNumber(d, "stampDutyRate", "declaration", "stampDutyRate", 0, STAMP_DUTY_RATE_MAX, issues);
  checkNumber(d, "transferFeeRate", "declaration", "transferFeeRate", 0, TRANSFER_FEE_RATE_MAX, issues);
  checkNumber(d, "slippageBps", "declaration", "slippageBps", 0, SLIPPAGE_BPS_MAX, issues);
  checkNumber(d, "minCommission", "declaration", "minCommission", 0, MIN_COMMISSION_MAX, issues);
  checkNumber(d, "lotSize", "declaration", "lotSize", 1, LOT_SIZE_MAX, issues, {
    integer: true,
  });

  validateMarketImpactParams(d.marketImpact, "declaration.marketImpact", issues);

  // 显式负费率保护（数值型费率字段出现负数即失败——回测可信的第一道闸）。
  for (const field of ["commissionRate", "stampDutyRate", "transferFeeRate"] as const) {
    const value = d[field];
    if (isFiniteNumber(value) && (value as number) < 0) {
      issues.push(
        issue(
          "CM14_RATE_NEGATIVE",
          `declaration.${field}`,
          `${field} 不能为负`
        )
      );
    }
  }
  if (isFiniteNumber(d.slippageBps) && (d.slippageBps as number) < 0) {
    issues.push(
      issue(
        "CM14_RATE_NEGATIVE",
        "declaration.slippageBps",
        "slippageBps 不能为负"
      )
    );
  }

  return result(issues);
}

/** 声明非法即抛 ResearchValidationError（含全部 issue 聚合）。 */
export function assertValidCostModelDeclaration(
  declaration: CostModelDeclaration | unknown | null | undefined
): asserts declaration is CostModelDeclaration {
  assertValid(validateCostModelDeclaration(declaration));
}
