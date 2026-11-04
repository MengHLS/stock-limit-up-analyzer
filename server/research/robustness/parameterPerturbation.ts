/**
 * STEP 18 / C-18.1 — 扰动器③：Parameter Perturbation（策略参数局部邻域扰动生成）。
 *
 * 定位（与 C-17.1 的关系——依据见下，独立实现不调用其 sampler）：
 *   - 输入 = 基线 ResearchParameterSet（一条**已评估**策略的参数集），对其中**数值**
 *     参数按 ±% / ±档 扰动，输出扰动参数集清单（PerturbationItem[]，axis="parameter"）；
 *   - 与 C-17.1 的关系：C-17.1（parameterSearch）在**参数空间格点上全局搜索**
 *     （grid 全组合 / random seedable 采样）并做稳定区判定，目标是「找到稳定参数区域」；
 *     本扰动是**单基线点上的局部邻域枚举**（star sampling：一次只动一个参数 ± 若干步），
 *     目标是「判定策略是否依赖单一参数取值」。两者共享：ResearchParameterSet 形态、
 *     注入式评估 + canonical 指纹、确定性无随机哲学；但**采样几何不同**（全局格点 vs
 *     局部邻域），故不复用 C-17.1 sampler，独立实现并在文件头显式文档化该决策。
 *
 * 扰动语义：
 *   - percentSteps：p ∈ R，扰动值 = 基值 × (1 + p/100)（相对 ±% 扰动，如 +20 = ×1.2）；
 *   - additiveSteps：a ∈ R，扰动值 = 基值 + a（绝对 ±档，如 ±1 / ±2 档）；
 *   - 恒含基准自身（首条 isBaseline；与使扰动值 == 基值的步（0 / 0%）去重）；
 *   - 每条扰动**只改一个参数的一个档位**（归因干净）；
 *   - 非数值参数（boolean/string/null）被规则点名 → 结构化跳过（不抛错，可审计）；
 *   - 参数缺失 / 值非有限 / 扰动结果非有限 → 结构化跳过。
 *
 * 铁律：纯函数、确定性（变体序 = 规则序 × 步序，用户给定）、只读入参、无 IO /
 * Date.now / Math.random；重复规则（同一参数名两条）→ ResearchValidationError
 * （歧义，失败响亮）；禁止 clamp（越界交由调用方 schema 判断，本层不发明参数值域）。
 */

import { ResearchValidationError } from "../experimentValidation";
import type { ResearchParameterSet } from "../types";
import type { PerturbationItem, PerturbationSkip } from "./types";

// ---------------------------------------------------------------------------
// 规则与结果类型
// ---------------------------------------------------------------------------

/** 单个数值参数的扰动规则（两档可并存；一次只动一个档位）。 */
export interface ParameterPerturbationRule {
  /** 目标数值参数名（须为 ResearchParameterSet 中已存在的 number 值）。 */
  readonly parameterName: string;
  /** 相对 ±% 档（如 [20] = +20%；[-20, 20] = ±20%）。0 恒被跳过（基准覆盖）。 */
  readonly percentSteps?: readonly number[];
  /** 绝对 ±档（如 [-1, 1]；[-5, 5, 10]）。0 恒被跳过（基准覆盖）。 */
  readonly additiveSteps?: readonly number[];
}

/** Parameter Perturbation 配置。 */
export interface ParameterPerturbationOptions {
  /** 扰动规则（参数名不得重复）。 */
  readonly rules: readonly ParameterPerturbationRule[];
}

/** 生成器结果：扰动清单（axis="parameter"）+ 跳过记录。 */
export interface ParameterPerturbationResult {
  /** 扰动清单（axis="parameter"；索引 0 恒为 isBaseline 基准条目）。 */
  readonly variants: readonly PerturbationItem[];
  /** 被跳过的变体记录（非数值参数 / 缺失 / 非法步 / 结果退化）；空 = 无跳过。 */
  readonly skipped: readonly PerturbationSkip[];
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 数值绝对值 → code 后缀（小数点转下划线）。 */
function codeNumber(value: number): string {
  return String(value).replace(/\./g, "_");
}

/** 判定值「稳定字符串相等」（扰动值 == 基值即视为退化，跳过）。 */
function sameNumber(left: number, right: number): boolean {
  return left === right;
}

/** 生成单档扰动参数集（mutation isolation：新对象 + 原值只读）。 */
function perturbedSet(
  base: ResearchParameterSet,
  name: string,
  value: number
): ResearchParameterSet {
  return { ...base, [name]: value };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * Parameter Perturbation 生成器：对基线数值参数做 ±%/±档 局部邻域扰动。
 * rules 为空 → 仅返回基准条目（结构化，供调用方检查）。
 * 重复规则 / rules 非数组 → 抛 ResearchValidationError。
 */
export function generateParameterPerturbationVariants(
  base: ResearchParameterSet,
  options: ParameterPerturbationOptions
): ParameterPerturbationResult {
  if (base === null || typeof base !== "object" || Array.isArray(base)) {
    throw new ResearchValidationError([
      { code: "RB18_PARAM_BASE_INVALID", path: "base", message: "基线参数集必须是对象" },
    ]);
  }
  if (options === null || typeof options !== "object" || !Array.isArray(options.rules)) {
    throw new ResearchValidationError([
      { code: "RB18_PARAM_RULES_INVALID", path: "rules", message: "扰动规则必须是数组" },
    ]);
  }

  const seen = new Set<string>();
  for (const rule of options.rules) {
    if (rule === null || typeof rule !== "object") {
      throw new ResearchValidationError([
        { code: "RB18_PARAM_RULE_INVALID", path: "rules", message: "每条扰动规则必须是对象" },
      ]);
    }
    if (typeof rule.parameterName !== "string" || rule.parameterName.trim() === "") {
      throw new ResearchValidationError([
        { code: "RB18_PARAM_RULE_NAME_EMPTY", path: "rules", message: "规则参数名不能为空" },
      ]);
    }
    if (seen.has(rule.parameterName)) {
      throw new ResearchValidationError([
        {
          code: "RB18_PARAM_RULE_DUPLICATE",
          path: `rules.${rule.parameterName}`,
          message: `同一参数出现多条扰动规则：${rule.parameterName}（歧义，拒绝）`,
        },
      ]);
    }
    seen.add(rule.parameterName);
  }

  const variants: PerturbationItem[] = [
    { axis: "parameter", code: "BASELINE", label: "基准（原参数集）", isBaseline: true, config: { ...base } },
  ];
  const skipped: PerturbationSkip[] = [];

  for (const rule of options.rules) {
    const name = rule.parameterName;
    const baseValue = base[name];
    if (baseValue === null || typeof baseValue !== "number" || !Number.isFinite(baseValue)) {
      skipped.push({
        code: `PARAM_${name}_SKIP`,
        label: `参数 ${name}（扰动）`,
        reason: `参数 ${name} 的基线值不是有限数字（收到 ${String(baseValue)}），无法做 ±%/±档 扰动`,
      });
      continue;
    }

    const tryPush = (
      codeSuffix: string,
      labelText: string,
      newValue: number,
      invalidStepReason: string | null
    ): void => {
      if (invalidStepReason !== null) {
        skipped.push({
          code: `PARAM_${name}_${codeSuffix}`,
          label: labelText,
          reason: invalidStepReason,
        });
        return;
      }
      if (!Number.isFinite(newValue)) {
        skipped.push({
          code: `PARAM_${name}_${codeSuffix}`,
          label: labelText,
          reason: `扰动后参数值不是有限数字（收到 ${String(newValue)}）`,
        });
        return;
      }
      if (sameNumber(newValue, baseValue)) {
        return; // 0% / +0 档：与基准重复，由 isBaseline 条目覆盖
      }
      variants.push({
        axis: "parameter",
        code: `PARAM_${name}_${codeSuffix}`,
        label: labelText,
        isBaseline: false,
        config: perturbedSet(base, name, newValue),
      });
    };

    // 相对 ±% 档
    for (const step of rule.percentSteps ?? []) {
      if (typeof step !== "number" || !Number.isFinite(step)) {
        tryPush("PCT_INVALID", `参数 ${name} ${String(step)}%`, baseValue, `百分比档必须为有限数字，收到 ${String(step)}`);
        continue;
      }
      const sign = step >= 0 ? "P" : "M";
      const magnitude = Math.abs(step);
      const labelStep = step >= 0 ? `+${step}` : `-${Math.abs(step)}`;
      tryPush(
        `PCT_${sign}${codeNumber(magnitude)}`,
        `参数 ${name} ${labelStep}%`,
        baseValue * (1 + step / 100),
        null
      );
    }

    // 绝对 ±档
    for (const step of rule.additiveSteps ?? []) {
      if (typeof step !== "number" || !Number.isFinite(step)) {
        tryPush("ADD_INVALID", `参数 ${name} ${String(step)}`, baseValue, `加减档必须为有限数字，收到 ${String(step)}`);
        continue;
      }
      const sign = step >= 0 ? "P" : "M";
      const magnitude = Math.abs(step);
      const labelStep = step >= 0 ? `+${step}` : `-${Math.abs(step)}`;
      tryPush(`ADD_${sign}${codeNumber(magnitude)}`, `参数 ${name} ${labelStep}`, baseValue + step, null);
    }
  }

  return { variants, skipped };
}
