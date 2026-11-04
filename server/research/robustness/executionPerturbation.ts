/**
 * STEP 18 / C-18.1 — 扰动器④：Execution Perturbation（成交/执行约束扰动生成）。
 *
 * 定位（对齐 C-14.3 声明层，import 只读）：
 *   - 输入 = 基线 ExecutionConstraintDeclaration，输出扰动清单（axis="execution"）；
 *   - 可扰动态 = C-14.3 map.ts 能力矩阵中标为 **ENFORCED** 的成交/执行相关轴：
 *       - timing.executionModel     成交时机（默认值域 = 可执行三枚举 NEXT_OPEN /
 *                                    NEXT_CLOSE / VWAP_PROXY；**不含 LIMIT_PRICE**——
 *                                    它在 C-14.1 链映射即 blocker，「声明限价真执行」属伪造，
 *                                    扰动不含不可执行假设）；
 *       - timing.allowPartialFill  部分成交档（false / true）；
 *       - positions.maxPositionCount 并发持仓上限（正整数或 null=不限；控制组合执行容量）。
 *     **不扰动** DECLARED_ONLY 轴（perSecurityEquityCap / totalEquityCap / buyBanned /
 *     sellBanned：声明后 C-14.1 链无法执行，扰动它们 = 扰动「跑不起来的假设」）；
 *   - 每条扰动**只改一个执行轴**（归因干净）；恒含基准自身（首条 isBaseline；
 *     与使该轴 == 基准值的条目去重）；
 *   - 扰动后声明逐条经 C-14.3 validateExecutionConstraintDeclaration 复核，
 *     非法（如并发持仓传 0/负数/非整数）→ 结构化跳过，绝不产出非法声明。
 *
 * 铁律：纯函数、确定性（条目序 = 各子清单用户给定序）、只读入参（变异隔离用展开
 * 构造，不对 readonly 字段赋值）、无 IO / Date.now / Math.random；基线声明非法 →
 * assert 抛 ResearchValidationError；LIMIT_PRICE 属防误用守卫（显式抛错）。
 */

import {
  ResearchValidationError,
  type ResearchValidationResult,
} from "../experimentValidation";
import type { ExecutionModelId } from "../../backtest/types";
import {
  assertValidExecutionConstraintDeclaration,
  validateExecutionConstraintDeclaration,
} from "../executionConstraints/validate";
import type { ExecutionConstraintDeclaration } from "../executionConstraints/types";
import { DEFAULT_EXECUTION_MODELS } from "./types";
import type { PerturbationItem, PerturbationSkip } from "./types";

/** 执行扰动配置（各子清单缺省 = 该轴用默认扰动；空数组 = 该轴不扰动）。 */
export interface ExecutionPerturbationOptions {
  /** 成交时机扰动值域（缺省 = DEFAULT_EXECUTION_MODELS 可执行三枚举；不得含 LIMIT_PRICE）。 */
  readonly executionModels?: readonly ExecutionModelId[];
  /** 部分成交档（如 [false, true]；缺省 = 不扰动该轴）。 */
  readonly allowPartialFillValues?: readonly boolean[];
  /** 并发持仓上限档（正整数；null = 不设上限；缺省 = 不扰动该轴）。 */
  readonly maxPositionCountValues?: readonly (number | null)[];
}

/** 生成器结果：扰动清单（axis="execution"）+ 跳过记录。 */
export interface ExecutionPerturbationResult {
  /** 扰动清单（axis="execution"；索引 0 恒为 isBaseline 基准条目）。 */
  readonly variants: readonly PerturbationItem[];
  /** 被跳过的变体记录（非法执行声明）；空 = 无跳过。 */
  readonly skipped: readonly PerturbationSkip[];
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 校验声明；非法时返回 issue 文本，合法返回 null。 */
function invalidReason(declaration: ExecutionConstraintDeclaration): string | null {
  const validation: ResearchValidationResult =
    validateExecutionConstraintDeclaration(declaration);
  if (validation.valid) return null;
  return validation.issues.map((issue) => `${issue.code}@${issue.path}`).join("；");
}

/** 变体 label：在基线 label 后追加 code（无 label 则仅 code）。 */
function variantLabel(declaration: ExecutionConstraintDeclaration, code: string): string {
  return declaration.label === undefined ? code : `${declaration.label}#${code}`;
}

/** 构造并校验单条扰动条目（合法入 variants，非法入 skipped）。 */
function pushIfValid(
  variants: PerturbationItem[],
  skipped: PerturbationSkip[],
  code: string,
  label: string,
  declaration: ExecutionConstraintDeclaration
): void {
  const reason = invalidReason(declaration);
  if (reason !== null) {
    skipped.push({ code, label, reason: `扰动后声明未通过 C-14.3 校验：${reason}` });
    return;
  }
  variants.push({
    axis: "execution",
    code,
    label,
    isBaseline: false,
    config: declaration,
  });
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * Execution Perturbation 生成器：对成交时机 / 部分成交档 / 并发持仓上限做扰动。
 * options 为空 → 仅返回基准条目。基线声明非法 → 抛 ResearchValidationError；
 * 扰动值域含 LIMIT_PRICE → 抛 ResearchValidationError（防误用守卫）。
 */
export function generateExecutionPerturbationVariants(
  baseDeclaration: ExecutionConstraintDeclaration,
  options: ExecutionPerturbationOptions = {}
): ExecutionPerturbationResult {
  assertValidExecutionConstraintDeclaration(baseDeclaration);

  // 成交时机缺省 = 可执行三枚举（DEFAULT_EXECUTION_MODELS）；显式 [] = 该轴不扰动。
  const requestedModels = options.executionModels ?? DEFAULT_EXECUTION_MODELS;
  if (requestedModels.some((model) => model === "LIMIT_PRICE")) {
    throw new ResearchValidationError([
      {
        code: "RB18_EXEC_MODEL_LIMIT_PRICE",
        path: "executionModels",
        message:
          "LIMIT_PRICE 在 C-14.1 链不可执行（map.ts blocker），不能作为 C-18.1 执行扰动假设",
      },
    ]);
  }

  const variants: PerturbationItem[] = [
    {
      axis: "execution",
      code: "BASELINE",
      label: "基准（原执行声明）",
      isBaseline: true,
      config: JSON.parse(JSON.stringify(baseDeclaration)) as ExecutionConstraintDeclaration,
    },
  ];
  const skipped: PerturbationSkip[] = [];

  // -- 成交时机轴（只改 timing.executionModel，其余字段引用不变 → 变异隔离） --
  for (const model of requestedModels) {
    if (model === baseDeclaration.timing.executionModel) continue; // 基准覆盖
    const code = `EXEC_MODEL_${model}`;
    const declaration: ExecutionConstraintDeclaration = {
      ...baseDeclaration,
      label: variantLabel(baseDeclaration, code),
      timing: { ...baseDeclaration.timing, executionModel: model },
    };
    pushIfValid(variants, skipped, code, `成交时机 → ${model}`, declaration);
  }

  // -- 部分成交档轴 --
  for (const value of options.allowPartialFillValues ?? []) {
    if (typeof value !== "boolean") continue;
    if (value === baseDeclaration.timing.allowPartialFill) continue; // 基准覆盖
    const code = `EXEC_PARTIAL_FILL_${value ? "ON" : "OFF"}`;
    const declaration: ExecutionConstraintDeclaration = {
      ...baseDeclaration,
      label: variantLabel(baseDeclaration, code),
      timing: { ...baseDeclaration.timing, allowPartialFill: value },
    };
    pushIfValid(
      variants,
      skipped,
      code,
      `允许部分成交 → ${value ? "是" : "否"}`,
      declaration
    );
  }

  // -- 并发持仓上限轴 --
  for (const value of options.maxPositionCountValues ?? []) {
    if (value === baseDeclaration.positions.maxPositionCount) continue; // 基准覆盖
    const code =
      value === null ? "EXEC_MAX_POSITIONS_UNLIMITED" : `EXEC_MAX_POSITIONS_${value}`;
    const declaration: ExecutionConstraintDeclaration = {
      ...baseDeclaration,
      label: variantLabel(baseDeclaration, code),
      positions: { ...baseDeclaration.positions, maxPositionCount: value },
    };
    pushIfValid(
      variants,
      skipped,
      code,
      `并发持仓上限 → ${value === null ? "不限" : String(value)}`,
      declaration
    );
  }

  return { variants, skipped };
}
