/**
 * STEP 18 / C-18.1 — 扰动器①/②：Cost Stress + Slippage Stress（成本/滑点扰动生成）。
 *
 * 定位（对齐 C-14.2 声明层，import 只读）：
 *   - 输入 = 基线 CostModelDeclaration（A_SHARE_DEFAULT_COST_DECLARATION 或自定义），
 *     输出 = 扰动清单（PerturbationItem[]）+ 超限跳过（PerturbationSkip[]）；
 *   - 每条扰动**只改一个成本分量**（佣金 / 印花税 / 过户费 / 市场冲击强度 / 滑点），
 *     归因干净（成本敏感由单一分量触发时可定位）；多分量同时覆盖 = 依次对各分量
 *     调用生成器，或一次性传入多分量倍率（输出仍为逐分量单改变体）。
 *
 * 轴划分：
 *   - generateCostStressVariants     → axis="cost"，扰动佣金/印花税/过户费/冲击强度
 *     （**不含滑点**：滑点属 Slippage Stress 独立轴，见下）；
 *   - generateSlippageStressVariants → axis="slippage"，滑点轴专项（= Cost Stress 的
 *     子集，独立导出便于与其它轴组合 / 独立归因）。支持倍率（×f）与加减档（±X bp）两种。
 *
 * 扰动产物纪律（单测断言）：
 *   - 每条扰动后声明都经 validateCostModelDeclaration 复核，非法（越 C-14.2 值域 /
 *     冲击 maxBps≥coefficient 一致性破坏等）**不产出**而进入 skipped（带原因）；
 *   - 恒含基准自身（×1）：输出首条 isBaseline=true（与倍率清单中的 1 去重，保证
 *     恰一条基准，供漂移对照）；
 *   - 市场冲击「强度」倍率 f 同时缩放 coefficient 与 maxBps（保持 maxBps ≥ coefficient
 *     一致性 ⇒ 校验恒过、且整条冲击曲线等比缩放，语义 = 冲击模型整体加压/减压）；
 *   - name 追加变体 code（审计可见「当前声明来自哪条扰动」）。
 *
 * 铁律：纯函数、确定性（同输入必同输出；迭代序 = 用户给定倍率序）、只读入参、
 * 无 IO / Date.now / Math.random；因子须 > 0 有限（非法因子 → skipped 而非抛错，
 * 退化输入结构化处理）；基线声明非法 → assert 抛 ResearchValidationError（编程错误）。
 */

import type { ResearchValidationResult } from "../experimentValidation";
import {
  assertValidCostModelDeclaration,
  validateCostModelDeclaration,
} from "../costModel/validate";
import type { CostModelDeclaration } from "../costModel/types";
import type {
  PerturbationItem,
  PerturbationSkip,
} from "./types";

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 数值 → 稳定 code 后缀（小数点转下划线，负号转 M；确定性）。 */
function codeNumber(value: number): string {
  return String(value).replace(/\./g, "_").replace(/-/g, "M");
}

/** 结构化克隆声明（变异隔离：不修改入参对象）。 */
function cloneDeclaration(declaration: CostModelDeclaration): CostModelDeclaration {
  // 声明全部字段为 number / boolean / string 字面量（C-14.2 校验保证），JSON round-trip 安全。
  return JSON.parse(JSON.stringify(declaration)) as CostModelDeclaration;
}

/** 校验声明；非法时返回 issue 文本（供 skipped 原因），合法返回 null。 */
function invalidReason(declaration: CostModelDeclaration): string | null {
  const validation: ResearchValidationResult = validateCostModelDeclaration(declaration);
  if (validation.valid) return null;
  return validation.issues.map((issue) => `${issue.code}@${issue.path}`).join("；");
}

/** 构造基准条目（×1；axis 由调用方给定）。 */
function baselineItem<A extends "cost" | "slippage">(
  axis: A,
  declaration: CostModelDeclaration
): PerturbationItem {
  return {
    axis,
    code: "BASELINE",
    label: "基准（原成本声明）",
    isBaseline: true,
    config: cloneDeclaration(declaration),
  } as PerturbationItem;
}

/** 组装单条非基准条目（调用方保证声明合法）。 */
function variantItem<A extends "cost" | "slippage">(
  axis: A,
  code: string,
  label: string,
  declaration: CostModelDeclaration
): PerturbationItem {
  return {
    axis,
    code,
    label,
    isBaseline: false,
    config: declaration,
  } as PerturbationItem;
}

// ---------------------------------------------------------------------------
// Cost Stress（axis = "cost"）
// ---------------------------------------------------------------------------

/** Cost Stress 倍率配置：各成本分量的乘数清单（缺省/空 = 该分量不扰动）。 */
export interface CostStressMultipliers {
  /** 佣金费率倍率（如 [0.5, 1, 2, 5]；默认 万2.5 ×5 = 万12.5，仍在监管上限内）。 */
  readonly commissionRateFactors?: readonly number[];
  /** 印花税率倍率（注意上界 3‰，validate 值域约束）。 */
  readonly stampDutyRateFactors?: readonly number[];
  /** 过户费率倍率。 */
  readonly transferFeeRateFactors?: readonly number[];
  /** 市场冲击强度倍率（同时缩放 marketImpact.coefficient 与 maxBps，保持一致性）。 */
  readonly impactCoefficientFactors?: readonly number[];
}

/** 生成器结果：扰动清单（首条 = 基准）+ 超限/非法变体的跳过记录。 */
export interface CostStressResult {
  /** 扰动清单（axis="cost"；索引 0 恒为 isBaseline 基准条目）。 */
  readonly variants: readonly PerturbationItem[];
  /** 被跳过（越界/非法/重复基准）的变体记录；空 = 无跳过。 */
  readonly skipped: readonly PerturbationSkip[];
}

/**
 * Cost Stress 生成器：对佣金/印花税/过户费/市场冲击强度做倍率扰动。
 * 每条变体只改一个分量；倍率含 1 时与基准去重（基准恒以首条 isBaseline 形式存在）。
 * 基线声明非法 → 抛 ResearchValidationError。
 */
export function generateCostStressVariants(
  baseDeclaration: CostModelDeclaration,
  multipliers: CostStressMultipliers = {}
): CostStressResult {
  assertValidCostModelDeclaration(baseDeclaration);

  const variants: PerturbationItem[] = [baselineItem("cost", baseDeclaration)];
  const skipped: PerturbationSkip[] = [];

  // 分量 → (倍率清单, 字段写入, code 前缀, 中文名, 值域标签)。
  const dimensions: ReadonlyArray<{
    readonly factors: readonly number[] | undefined;
    readonly apply: (declaration: CostModelDeclaration, factor: number) => CostModelDeclaration;
    readonly codePrefix: string;
    readonly dimensionLabel: string;
  }> = [
    {
      factors: multipliers.commissionRateFactors,
      apply: (d, factor) => ({ ...d, commissionRate: d.commissionRate * factor }),
      codePrefix: "COMMISSION",
      dimensionLabel: "佣金费率",
    },
    {
      factors: multipliers.stampDutyRateFactors,
      apply: (d, factor) => ({ ...d, stampDutyRate: d.stampDutyRate * factor }),
      codePrefix: "STAMP_DUTY",
      dimensionLabel: "印花税率",
    },
    {
      factors: multipliers.transferFeeRateFactors,
      apply: (d, factor) => ({ ...d, transferFeeRate: d.transferFeeRate * factor }),
      codePrefix: "TRANSFER_FEE",
      dimensionLabel: "过户费率",
    },
    {
      factors: multipliers.impactCoefficientFactors,
      apply: (d, factor) => ({
        ...d,
        marketImpact: {
          ...d.marketImpact,
          coefficient: d.marketImpact.coefficient * factor,
          maxBps: d.marketImpact.maxBps * factor,
        },
      }),
      codePrefix: "IMPACT_STRENGTH",
      dimensionLabel: "市场冲击强度",
    },
  ];

  for (const dimension of dimensions) {
    if (dimension.factors === undefined || dimension.factors.length === 0) continue;
    for (const factor of dimension.factors) {
      if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) {
        skipped.push({
          code: `${dimension.codePrefix}_INVALID_FACTOR`,
          label: `${dimension.dimensionLabel} ×${String(factor)}`,
          reason: `倍率必须是 > 0 的有限数字，收到 ${String(factor)}`,
        });
        continue;
      }
      if (factor === 1) continue; // 基准由 isBaseline 条目覆盖
      const code = `${dimension.codePrefix}_X${codeNumber(factor)}`;
      const label = `${dimension.dimensionLabel} ×${factor}`;
      const perturbed = dimension.apply(cloneDeclaration(baseDeclaration), factor);
      const name = `${baseDeclaration.name}#${code}`;
      const named = { ...perturbed, name };
      const reason = invalidReason(named);
      if (reason !== null) {
        skipped.push({
          code,
          label,
          reason: `扰动后声明未通过 C-14.2 校验：${reason}`,
        });
        continue;
      }
      variants.push(variantItem("cost", code, label, named));
    }
  }

  return { variants, skipped };
}

// ---------------------------------------------------------------------------
// Slippage Stress（axis = "slippage"）
// ---------------------------------------------------------------------------

/** Slippage Stress 配置：倍率与/或加减档（bp）。 */
export interface SlippageStressOptions {
  /** 滑点倍率（如 [0.5, 1, 2, 5]：0.5 = 减半、2 = 双倍、5 = 5 倍压力）。 */
  readonly factors?: readonly number[];
  /** 滑点加减档（bp，可负；如 [-5, 5, 10]：相对基准滑点 ±5bp / +10bp）。 */
  readonly offsetsBps?: readonly number[];
}

/** 生成器结果：扰动清单（axis="slippage"）+ 跳过记录。 */
export interface SlippageStressResult {
  /** 扰动清单（axis="slippage"；索引 0 恒为 isBaseline 基准条目）。 */
  readonly variants: readonly PerturbationItem[];
  /** 被跳过（负滑点/越界/重复基准）的变体记录；空 = 无跳过。 */
  readonly skipped: readonly PerturbationSkip[];
}

/**
 * Slippage Stress 生成器（Cost Stress 的滑点子集轴）。
 * 扰动后 slippageBps 必须 ∈ [0, 1000]（C-14.2 SLIPPAGE_BPS_MAX）；**绝不 clamp**：
 * 偏移使滑点为负 / 越上界 → 结构化跳过并记录原因。
 * 基线声明非法 → 抛 ResearchValidationError。
 */
export function generateSlippageStressVariants(
  baseDeclaration: CostModelDeclaration,
  options: SlippageStressOptions = {}
): SlippageStressResult {
  assertValidCostModelDeclaration(baseDeclaration);

  const variants: PerturbationItem[] = [baselineItem("slippage", baseDeclaration)];
  const skipped: PerturbationSkip[] = [];

  const baseBps = baseDeclaration.slippageBps;

  const pushIfValid = (code: string, label: string, value: number): void => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      skipped.push({ code, label, reason: "扰动后滑点不是有限数字" });
      return;
    }
    if (value < 0) {
      skipped.push({
        code,
        label,
        reason: `扰动后滑点（${value} bp）为负，C-14.2 校验拒绝；本生成器不 clamp（clamp 会伪造实际应力）`,
      });
      return;
    }
    const perturbed = { ...cloneDeclaration(baseDeclaration), slippageBps: value };
    const named = { ...perturbed, name: `${baseDeclaration.name}#${code}` };
    const reason = invalidReason(named);
    if (reason !== null) {
      skipped.push({ code, label, reason: `扰动后声明未通过 C-14.2 校验：${reason}` });
      return;
    }
    variants.push(variantItem("slippage", code, label, named));
  };

  // 倍率轴
  for (const factor of options.factors ?? []) {
    if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) {
      skipped.push({
        code: "SLIPPAGE_INVALID_FACTOR",
        label: `滑点 ×${String(factor)}`,
        reason: `倍率必须是 > 0 的有限数字，收到 ${String(factor)}`,
      });
      continue;
    }
    if (factor === 1) continue; // 基准由 isBaseline 条目覆盖
    const code = `SLIPPAGE_X${codeNumber(factor)}`;
    pushIfValid(code, `滑点 ×${factor}`, baseBps * factor);
  }

  // 加减档轴（bp）
  for (const offset of options.offsetsBps ?? []) {
    if (typeof offset !== "number" || !Number.isFinite(offset)) {
      skipped.push({
        code: "SLIPPAGE_INVALID_OFFSET",
        label: `滑点 ${String(offset)}bp`,
        reason: `偏移必须是有限数字（bp），收到 ${String(offset)}`,
      });
      continue;
    }
    if (offset === 0) continue; // 基准由 isBaseline 条目覆盖
    const sign = offset > 0 ? "P" : "M";
    const magnitude = Math.abs(offset);
    const code = `SLIPPAGE_OFFSET_${sign}${codeNumber(magnitude)}`;
    pushIfValid(code, `滑点 ${offset > 0 ? "+" : ""}${offset}bp`, baseBps + offset);
  }

  return { variants, skipped };
}
