/**
 * STEP 6.3 — Parameter Space Contract（参数空间）。
 *
 * Parameter Space 只负责「描述允许搜索的参数范围」，不负责生成组合（见 combinationGenerator）、
 * 不负责执行实验（见 sweepService）。它是 Sweep 的输入契约，与 STEP 6.1 的
 * ResearchParameterSchema（策略自身参数契约）是两种不同层面的概念：
 *   - ResearchParameterSchema 描述「策略需要哪些参数、类型与取值约束」；
 *   - ParameterSpace 描述「本次扫描要在哪些参数上、以怎样的取值集合做实验」。
 *
 * 边界铁律：
 *   - 禁止 NaN / Infinity / 隐式类型转换进入本层任何对象；
 *   - 校验为纯函数，返回结构化结果（不抛错），另提供 assert* 便捷入口；
 *   - 不依赖 Database / Network / Date.now / Math.random。
 */

import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "./experimentValidation";

/** 数值型参数（浮点）：从 min 到 max，步长 step（step > 0）。 */
export interface SweepNumberParameter {
  type: "number";
  name: string;
  min: number;
  max: number;
  step: number;
}

/** 整数型参数：从 min 到 max（均为整数），步长 step（正整数）。 */
export interface SweepIntegerParameter {
  type: "integer";
  name: string;
  min: number;
  max: number;
  step: number;
}

/** 布尔型参数：values 缺省为 [true, false]（顺序稳定）。 */
export interface SweepBooleanParameter {
  type: "boolean";
  name: string;
  /** 可选显式取值集合（保持给定顺序）；缺省 [true, false]。 */
  values?: boolean[];
}

/** 枚举型参数：保持定义顺序（不 sort，顺序本身可能是研究实验定义的一部分）。 */
export interface SweepEnumParameter {
  type: "enum";
  name: string;
  values: string[];
}

/** 参数空间里的单个参数定义（判别联合）。 */
export type SweepParameterDefinition =
  | SweepNumberParameter
  | SweepIntegerParameter
  | SweepBooleanParameter
  | SweepEnumParameter;

/** 参数空间：一组（名称唯一）的参数定义。 */
export interface ParameterSpace {
  parameters: SweepParameterDefinition[];
}

function sweepIssue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

/**
 * 校验参数空间。全部校验为纯函数，返回结构化结果。
 * 覆盖：参数名非空唯一；number 的 min/max/step finite、min<=max、step>0；
 * integer 的 min/max/step 为整数、min<=max、step>0；enum 非空且无重复；
 * boolean values（若提供）为布尔数组且无重复。
 */
export function validateParameterSpace(space: ParameterSpace): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!space || typeof space !== "object" || !Array.isArray(space.parameters)) {
    return { valid: false, issues: [sweepIssue("PARAMETER_SPACE_INVALID", "parameterSpace", "parameterSpace.parameters 必须是数组")] };
  }

  const seen = new Set<string>();
  for (const param of space.parameters) {
    if (!param || typeof param !== "object") {
      issues.push(sweepIssue("SWEEP_PARAM_INVALID", "parameterSpace", "参数定义必须是对象"));
      continue;
    }

    const rawType = (param as { type?: unknown }).type;
    const path = `parameterSpace.${typeof param.name === "string" ? param.name : "<unnamed>"}`;

    if (typeof param.name !== "string" || param.name.trim() === "") {
      issues.push(sweepIssue("SWEEP_PARAM_NAME_EMPTY", "parameterSpace", "参数名不能为空"));
      continue;
    }
    if (seen.has(param.name)) {
      issues.push(sweepIssue("SWEEP_PARAM_NAME_DUPLICATE", path, `参数名重复：${param.name}`));
      continue;
    }
    seen.add(param.name);

    switch (rawType) {
      case "number": {
        const { min, max, step } = param as SweepNumberParameter;
        if (!Number.isFinite(min)) issues.push(sweepIssue("SWEEP_PARAM_MIN_NOT_FINITE", `${path}.min`, "min 必须是有限数字（禁止 NaN / Infinity）"));
        if (!Number.isFinite(max)) issues.push(sweepIssue("SWEEP_PARAM_MAX_NOT_FINITE", `${path}.max`, "max 必须是有限数字（禁止 NaN / Infinity）"));
        if (!Number.isFinite(step) || step <= 0) issues.push(sweepIssue("SWEEP_PARAM_STEP_INVALID", `${path}.step`, "step 必须是 > 0 的有限数字"));
        if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
          issues.push(sweepIssue("SWEEP_PARAM_MIN_MAX_ORDER", path, `min(${min}) 不能大于 max(${max})`));
        }
        break;
      }
      case "integer": {
        const { min, max, step } = param as SweepIntegerParameter;
        if (!Number.isInteger(min)) issues.push(sweepIssue("SWEEP_PARAM_MIN_NOT_INTEGER", `${path}.min`, "min 必须是整数"));
        if (!Number.isInteger(max)) issues.push(sweepIssue("SWEEP_PARAM_MAX_NOT_INTEGER", `${path}.max`, "max 必须是整数"));
        if (!Number.isInteger(step) || step <= 0) issues.push(sweepIssue("SWEEP_PARAM_STEP_INVALID", `${path}.step`, "step 必须是 > 0 的整数"));
        if (Number.isInteger(min) && Number.isInteger(max) && min > max) {
          issues.push(sweepIssue("SWEEP_PARAM_MIN_MAX_ORDER", path, `min(${min}) 不能大于 max(${max})`));
        }
        break;
      }
      case "boolean": {
        const { values } = param as SweepBooleanParameter;
        if (values !== undefined) {
          if (!Array.isArray(values) || values.some((value) => typeof value !== "boolean")) {
            issues.push(sweepIssue("SWEEP_PARAM_VALUES_INVALID", `${path}.values`, "boolean values 必须是布尔数组"));
          } else if (new Set(values).size !== values.length) {
            issues.push(sweepIssue("SWEEP_PARAM_VALUES_DUPLICATE", `${path}.values`, "boolean values 不得重复"));
          }
        }
        break;
      }
      case "enum": {
        const { values } = param as SweepEnumParameter;
        if (!Array.isArray(values) || values.length === 0) {
          issues.push(sweepIssue("SWEEP_PARAM_VALUES_EMPTY", `${path}.values`, "enum values 必须非空"));
        } else if (values.some((value) => typeof value !== "string" || value.trim() === "")) {
          issues.push(sweepIssue("SWEEP_PARAM_VALUES_INVALID", `${path}.values`, "enum values 每项必须是非空字符串"));
        } else if (new Set(values).size !== values.length) {
          issues.push(sweepIssue("SWEEP_PARAM_VALUES_DUPLICATE", `${path}.values`, "enum values 不得重复"));
        }
        break;
      }
      default:
        issues.push(sweepIssue("SWEEP_PARAM_TYPE_INVALID", `${path}.type`, `非法参数类型：${String(rawType)}`));
    }
  }

  return { valid: issues.length === 0, issues };
}

/** 断言参数空间合法，否则抛 ResearchValidationError。 */
export function assertValidParameterSpace(space: ParameterSpace): void {
  const result = validateParameterSpace(space);
  if (!result.valid) throw new ResearchValidationError(result.issues);
}
