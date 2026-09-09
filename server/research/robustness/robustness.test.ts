/**
 * STEP 18 / C-18.1 — 鲁棒性测试（扰动重估）单测。
 *
 * 覆盖（任务验收 ①-⑨）：
 *   ① Cost Stress：滑点/费率倍率扰动产物正确 + 每条扰动后声明通过 C-14.2 validate +
 *      含 ×1 基准（isBaseline 恰一条且索引 0）；
 *   ② Slippage Stress 独立轴（滑点变体只改 slippageBps，其它成本分量不动；轴=slippage）；
 *   ③ Parameter Perturbation：数值参数 ±% / ±档 枚举正确（值/轴/基准）；
 *   ④ Execution Perturbation 扰动集（成交时机/部分成交/并发持仓；validate 全过）；
 *   ⑤ 重估编排：每扰动调 evaluator 恰一次并传入对应扰动配置（记录调用）；
 *   ⑥ 漂移判定：「成本×5 → 收益大降」标记敏感；「参数 ±20% → 绩效稳定」判不敏感；
 *   ⑦ RobustnessRun 记录 round-trip + 篡改拒绝 + fingerprint 完整；
 *   ⑧ 确定性（两次深比较）；
 *   ⑨ 退化输入（空扰动 / 缺基准 / 混轴 / 非法阈值 / 基线声明非法 / 基准评估失败 /
 *      全部扰动失败 / 超限跳过不 clamp / 重复参数规则）。
 */

import { describe, expect, it } from "vitest";
import { A_SHARE_DEFAULT_COST_DECLARATION } from "../costModel";
import { assertValidCostModelDeclaration } from "../costModel";
import { createExecutionConstraintDeclaration } from "../executionConstraints";
import { assertValidExecutionConstraintDeclaration } from "../executionConstraints";
import { ResearchValidationError } from "../experimentValidation";
import {
  computePerturbationConfigFingerprint,
  computeRobustnessRunFingerprint,
  deserializeRobustnessRun,
  serializeRobustnessRun,
  validateRobustnessRun,
} from "./serialize";
import { generateCostStressVariants, generateSlippageStressVariants } from "./costStress";
import { generateParameterPerturbationVariants } from "./parameterPerturbation";
import { generateExecutionPerturbationVariants } from "./executionPerturbation";
import { runRobustnessStress } from "./evaluate";
import {
  applyDriftThresholds,
  assessRobustnessSensitivity,
  classifyRobustnessSample,
  computeRobustnessDrift,
  resolveRobustnessThresholds,
} from "./drift";
import { DEFAULT_EXECUTION_MODELS } from "./types";
import type {
  CostModelDeclaration,
  ExecutionConstraintDeclaration,
  PerturbationItem,
  PerturbationSkip,
  ResearchParameterSet,
  RobustnessEvaluator,
  RobustnessMetricsView,
  RobustnessRun,
} from "./types";
import type { ExecutionModelId } from "../../backtest/types";

// ---------------------------------------------------------------------------
// 测试 fixture 与 helpers
// ---------------------------------------------------------------------------

function copyCostDecl(): CostModelDeclaration {
  return JSON.parse(JSON.stringify(A_SHARE_DEFAULT_COST_DECLARATION)) as CostModelDeclaration;
}

function baseExecDecl(): ExecutionConstraintDeclaration {
  return createExecutionConstraintDeclaration({
    label: "BASE_EXEC",
    initialCapital: 1_000_000,
  });
}

const BASE_PARAMS: ResearchParameterSet = {
  lookback: 20,
  scoreThreshold: 60,
  mode: "fast",
};

function ok(totalReturnPct: number, maxDrawdownPct: number, tradeCount: number | null = 1) {
  return { status: "succeeded" as const, metrics: { totalReturnPct, maxDrawdownPct, tradeCount } };
}

function fail(error: string) {
  return { status: "failed" as const, error };
}

/** 执行 thunk 并返回其抛出的 ResearchValidationError 的 issue code 列表（无抛错 → 空）。 */
function throwCodes(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ResearchValidationError) {
      return error.issues.map((issue) => issue.code);
    }
    return [String((error as Error)?.message ?? error)];
  }
  return [];
}

/** 记录式假 evaluator：script[code] → 指标；failedFor 集合内的 code → failed；可按 code 抛错。 */
function scriptedEvaluator(
  script: Record<string, RobustnessMetricsView>,
  options: { readonly failedFor?: readonly string[]; readonly throwFor?: readonly string[] } = {}
): { evaluator: RobustnessEvaluator; calls: Array<{ code: string; config: unknown }> } {
  const calls: Array<{ code: string; config: unknown }> = [];
  const failed = new Set(options.failedFor ?? []);
  const throwing = new Set(options.throwFor ?? []);
  const evaluator: RobustnessEvaluator = (item) => {
    calls.push({ code: item.code, config: JSON.parse(JSON.stringify(item.config)) });
    if (throwing.has(item.code)) {
      throw new Error(`evaluator boom on ${item.code}`);
    }
    if (failed.has(item.code)) {
      return fail(`评估失败（脚本）：${item.code}`);
    }
    const metrics = script[item.code];
    if (metrics === undefined) {
      return fail(`脚本未覆盖 code=${item.code}`);
    }
    return ok(metrics.totalReturnPct, metrics.maxDrawdownPct, metrics.tradeCount);
  };
  return { evaluator, calls };
}

/** 手动构造某轴扰动条目（供退化输入测试）。 */
function costItem(config: CostModelDeclaration, code = "MANUAL_COST", isBaseline = false): PerturbationItem {
  return { axis: "cost", code, label: `手动成本 ${code}`, isBaseline, config };
}
function execItem(config: ExecutionConstraintDeclaration, code = "MANUAL_EXEC", isBaseline = false): PerturbationItem {
  return { axis: "execution", code, label: `手动执行 ${code}`, isBaseline, config };
}

function allCostValid(declarations: ReadonlyArray<{ config: CostModelDeclaration }>): void {
  for (const entry of declarations) {
    expect(() => assertValidCostModelDeclaration(entry.config)).not.toThrow();
  }
}

const RUN_ID = "ROBUST-20260907-00000001";
const CREATED_AT = "2026-09-07T01:00:00.000Z";
const STRATEGY = { strategyId: "strategy-x", strategyVersion: "1.0.0" };

// ---------------------------------------------------------------------------
// ① Cost Stress：倍率扰动 + validate + ×1 基准
// ---------------------------------------------------------------------------

describe("① Cost Stress — 倍率扰动 / validate / ×1 基准", () => {
  it("滑点 ×5（含 ×0.5/×1/×2/×5 清单）→ 基准×1 恰一条且索引 0，扰动声明 validate 全过", () => {
    const base = copyCostDecl();
    const { variants, skipped } = generateSlippageStressVariants(base, {
      factors: [0.5, 1, 2, 5],
    });
    expect(skipped).toEqual([]);
    expect(variants).toHaveLength(4); // ×1 由基准覆盖，不与 ×1 重复
    expect(variants[0]!.isBaseline).toBe(true);
    expect(variants[0]!.code).toBe("BASELINE");
    expect(variants.filter((item) => item.isBaseline)).toHaveLength(1);

    const codes = variants.map((item) => item.code);
    expect(codes).toEqual(["BASELINE", "SLIPPAGE_X0_5", "SLIPPAGE_X2", "SLIPPAGE_X5"]);
    const slippageValues = variants.map((item) =>
      item.axis === "slippage" ? item.config.slippageBps : -1
    );
    expect(slippageValues).toEqual([10, 5, 20, 50]); // 10×0.5 / 10×1 / 10×2 / 10×5
    allCostValid(variants as Array<{ config: CostModelDeclaration }>);
  });

  it("佣金 ×2 / 印花税 ×0.5 生成正确：每条只改对应分量、其余与基准一致，validate 通过", () => {
    const base = copyCostDecl();
    const { variants, skipped } = generateCostStressVariants(base, {
      commissionRateFactors: [2],
      stampDutyRateFactors: [0.5],
    });
    expect(skipped).toEqual([]);
    expect(variants).toHaveLength(3); // BASELINE + COMMISSION_X2 + STAMP_DUTY_X0_5
    const commission = variants.find((item) => item.code === "COMMISSION_X2");
    expect(commission?.axis).toBe("cost");
    if (commission?.axis === "cost") {
      expect(commission.config.commissionRate).toBeCloseTo(0.00025 * 2, 12);
      expect(commission.config.stampDutyRate).toBe(0.0005); // 未扰动
      expect(commission.config.slippageBps).toBe(10);
    }
    const stamp = variants.find((item) => item.code === "STAMP_DUTY_X0_5");
    if (stamp?.axis === "cost") {
      expect(stamp.config.stampDutyRate).toBeCloseTo(0.0005 * 0.5, 12);
      expect(stamp.config.commissionRate).toBe(0.00025); // 未扰动
    }
    allCostValid(variants as Array<{ config: CostModelDeclaration }>);
  });

  it("市场冲击强度 ×2 同时缩放 coefficient 与 maxBps（保持 maxBps≥coefficient 一致性），validate 通过", () => {
    const base = copyCostDecl();
    const { variants } = generateCostStressVariants(base, { impactCoefficientFactors: [2] });
    const impact = variants.find((item) => item.code === "IMPACT_STRENGTH_X2");
    expect(impact?.axis).toBe("cost");
    if (impact?.axis === "cost") {
      expect(impact.config.marketImpact.coefficient).toBe(80); // 40 × 2
      expect(impact.config.marketImpact.maxBps).toBe(400); // 200 × 2（同倍率防截断）
      expect(impact.config.marketImpact.enabled).toBe(true);
      expect(impact.config.slippageBps).toBe(10); // 不误伤其它分量
    }
    assertValidCostModelDeclaration(impact?.config);
  });

  it("×1 出现在倍率清单时与基准去重（恰一条 isBaseline），成本声明 name 标注变体 code", () => {
    const base = copyCostDecl();
    const { variants } = generateCostStressVariants(base, {
      commissionRateFactors: [1, 2],
    });
    expect(variants).toHaveLength(2); // BASELINE + COMMISSION_X2（×1 不重复）
    expect(variants.filter((item) => item.isBaseline)).toHaveLength(1);
    const commission = variants.find((item) => item.code === "COMMISSION_X2");
    if (commission?.axis === "cost") {
      expect(commission.config.name).toBe(`${base.name}#COMMISSION_X2`);
    }
  });
});

// ---------------------------------------------------------------------------
// ② Slippage Stress 独立轴
// ---------------------------------------------------------------------------

describe("② Slippage Stress — 独立轴（加减档 + 只改滑点）", () => {
  it("加减档 ±5bp / +10bp 生成正确：轴=slippage、只改 slippageBps、代码 P/M 规范", () => {
    const base = copyCostDecl(); // slippageBps = 10
    const { variants, skipped } = generateSlippageStressVariants(base, {
      offsetsBps: [-5, 5, 10],
    });
    expect(skipped).toEqual([]);
    expect(variants.map((item) => item.code)).toEqual([
      "BASELINE",
      "SLIPPAGE_OFFSET_M5",
      "SLIPPAGE_OFFSET_P5",
      "SLIPPAGE_OFFSET_P10",
    ]);
    const values = variants.map((item) => (item.axis === "slippage" ? item.config.slippageBps : -1));
    expect(values).toEqual([10, 5, 15, 20]);
    for (const item of variants) {
      expect(item.axis).toBe("slippage");
      if (item.axis === "slippage") {
        // 只改滑点：佣金/印花税/过户费/冲击全部保持基准
        expect(item.config.commissionRate).toBe(0.00025);
        expect(item.config.stampDutyRate).toBe(0.0005);
        expect(item.config.marketImpact.coefficient).toBe(40);
      }
    }
    allCostValid(variants as Array<{ config: CostModelDeclaration }>);
  });

  it("倍率扰动同时给 ±：Slippage 生成器空 options → 仅基准（结构化）", () => {
    const base = copyCostDecl();
    const { variants, skipped } = generateSlippageStressVariants(base, {});
    expect(skipped).toEqual([]);
    expect(variants).toHaveLength(1);
    expect(variants[0]!.isBaseline).toBe(true);
  });

  it("Cost Stress 与 Slippage Stress 相互独立（成本扰动不动滑点、滑点扰动不动费率）", () => {
    const base = copyCostDecl();
    const costOnly = generateCostStressVariants(base, { commissionRateFactors: [2] });
    const slipOnly = generateSlippageStressVariants(base, { factors: [2] });
    for (const item of costOnly.variants) {
      expect(item.axis).toBe("cost");
      if (item.axis === "cost") expect(item.config.slippageBps).toBe(10);
    }
    for (const item of slipOnly.variants) {
      expect(item.axis).toBe("slippage");
      if (item.axis === "slippage") expect(item.config.commissionRate).toBe(0.00025);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ Parameter Perturbation
// ---------------------------------------------------------------------------

describe("③ Parameter Perturbation — ±% / ±档 枚举", () => {
  it("scoreThreshold ±20% → 60 → 48 / 72；代码/轴/基准正确", () => {
    const { variants, skipped } = generateParameterPerturbationVariants(BASE_PARAMS, {
      rules: [{ parameterName: "scoreThreshold", percentSteps: [-20, 20] }],
    });
    expect(skipped).toEqual([]);
    expect(variants.map((item) => item.code)).toEqual([
      "BASELINE",
      "PARAM_scoreThreshold_PCT_M20",
      "PARAM_scoreThreshold_PCT_P20",
    ]);
    expect(variants[0]!.isBaseline).toBe(true);
    const minus = variants[1]!;
    const plus = variants[2]!;
    expect(minus.axis).toBe("parameter");
    if (minus.axis === "parameter") expect(minus.config.scoreThreshold).toBe(48);
    if (plus.axis === "parameter") expect(plus.config.scoreThreshold).toBe(72);
    // 未扰动参数保持
    if (plus.axis === "parameter") {
      expect(plus.config.lookback).toBe(20);
      expect(plus.config.mode).toBe("fast");
    }
  });

  it("lookback ±1 档（additive，含 0）→ 19 / 21；0 档由基准覆盖不重复", () => {
    const { variants, skipped } = generateParameterPerturbationVariants(BASE_PARAMS, {
      rules: [{ parameterName: "lookback", additiveSteps: [-1, 0, 1] }],
    });
    expect(skipped).toEqual([]);
    expect(variants.map((item) => item.code)).toEqual([
      "BASELINE",
      "PARAM_lookback_ADD_M1",
      "PARAM_lookback_ADD_P1",
    ]);
    const plus = variants[2]!;
    if (plus.axis === "parameter") expect(plus.config.lookback).toBe(21);
    const minus = variants[1]!;
    if (minus.axis === "parameter") expect(minus.config.lookback).toBe(19);
  });

  it("非数值参数被规则点名 → 结构化跳过（非抛错），并给出原因", () => {
    const { variants, skipped } = generateParameterPerturbationVariants(BASE_PARAMS, {
      rules: [{ parameterName: "mode", percentSteps: [10] }],
    });
    expect(variants).toHaveLength(1); // 仅基准
    expect(skipped).toHaveLength(1);
    const skip = skipped[0] as PerturbationSkip;
    expect(skip.reason).toContain("不是有限数字");
  });

  it("重复规则（同一参数名两条）→ ResearchValidationError", () => {
    const run = () =>
      generateParameterPerturbationVariants(BASE_PARAMS, {
        rules: [
          { parameterName: "lookback", additiveSteps: [1] },
          { parameterName: "lookback", percentSteps: [10] },
        ],
      });
    expect(run).toThrow(ResearchValidationError);
    expect(throwCodes(run)).toContain("RB18_PARAM_RULE_DUPLICATE");
  });
});

// ---------------------------------------------------------------------------
// ④ Execution Perturbation
// ---------------------------------------------------------------------------

describe("④ Execution Perturbation — 成交时机 / 部分成交 / 并发持仓", () => {
  it("默认可执行时机 + 部分成交档 + 并发持仓档 → 扰动集正确且 validate 全过", () => {
    const base = baseExecDecl(); // NEXT_OPEN / allowPartialFill=false / maxPositions=null
    const { variants, skipped } = generateExecutionPerturbationVariants(base, {
      executionModels: DEFAULT_EXECUTION_MODELS,
      allowPartialFillValues: [false, true],
      maxPositionCountValues: [5, 10, null],
    });
    expect(skipped).toEqual([]);
    expect(variants.map((item) => item.code)).toEqual([
      "BASELINE",
      "EXEC_MODEL_NEXT_CLOSE",
      "EXEC_MODEL_VWAP_PROXY",
      "EXEC_PARTIAL_FILL_ON",
      "EXEC_MAX_POSITIONS_5",
      "EXEC_MAX_POSITIONS_10",
    ]);
    expect(variants.filter((item) => item.isBaseline)).toHaveLength(1);
    for (const item of variants) {
      expect(item.axis).toBe("execution");
      assertValidExecutionConstraintDeclaration(
        (item as PerturbationItem & { axis: "execution" }).config
      );
    }
    const close = variants.find((item) => item.code === "EXEC_MODEL_NEXT_CLOSE");
    if (close?.axis === "execution") {
      expect(close.config.timing.executionModel).toBe("NEXT_CLOSE");
      expect(close.config.timing.allowPartialFill).toBe(false); // 只改时机
      expect(close.config.positions.maxPositionCount).toBeNull();
    }
    const five = variants.find((item) => item.code === "EXEC_MAX_POSITIONS_5");
    if (five?.axis === "execution") {
      expect(five.config.positions.maxPositionCount).toBe(5);
      expect(five.config.timing.executionModel).toBe("NEXT_OPEN"); // 只改并发
    }
  });

  it("LIMIT_PRICE 属防误用守卫 → ResearchValidationError", () => {
    const run = () =>
      generateExecutionPerturbationVariants(baseExecDecl(), {
        executionModels: [...DEFAULT_EXECUTION_MODELS, "LIMIT_PRICE" as ExecutionModelId],
      });
    expect(run).toThrow(ResearchValidationError);
    expect(throwCodes(run)).toContain("RB18_EXEC_MODEL_LIMIT_PRICE");
  });

  it("非法并发持仓档（0）→ 结构化跳过（不产出非法执行声明）", () => {
    const { variants, skipped } = generateExecutionPerturbationVariants(baseExecDecl(), {
      executionModels: [], // 显式关闭默认成交时机扰动，只测并发持仓轴
      maxPositionCountValues: [0],
    });
    expect(variants).toHaveLength(1); // 仅基准
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toContain("未通过 C-14.3 校验");
  });
});

// ---------------------------------------------------------------------------
// ⑤ 重估编排：每扰动 evaluator 恰一次 + 传入扰动配置
// ---------------------------------------------------------------------------

describe("⑤ runRobustnessStress — evaluator 调用契约", () => {
  function sensitivityRun(items: readonly PerturbationItem[], script: Record<string, RobustnessMetricsView>) {
    const { evaluator, calls } = scriptedEvaluator(script);
    const run = runRobustnessStress({
      ...STRATEGY,
      perturbations: items,
      evaluator,
      robustnessRunId: RUN_ID,
      createdAt: CREATED_AT,
    });
    return { run, calls };
  }

  it("evaluator 对每条扰动（含基准）恰调用一次，传入的 config 与条目一致", () => {
    const base = copyCostDecl();
    const { variants } = generateSlippageStressVariants(base, { factors: [0.5, 2, 5] });
    const script: Record<string, RobustnessMetricsView> = {
      BASELINE: { totalReturnPct: 25, maxDrawdownPct: 8, tradeCount: 40 },
      SLIPPAGE_X0_5: { totalReturnPct: 26, maxDrawdownPct: 8, tradeCount: 40 },
      SLIPPAGE_X2: { totalReturnPct: 22, maxDrawdownPct: 9, tradeCount: 40 },
      SLIPPAGE_X5: { totalReturnPct: 10, maxDrawdownPct: 15, tradeCount: 40 },
    };
    const { run, calls } = sensitivityRun(variants, script);
    expect(calls).toHaveLength(variants.length);
    expect(run.samples).toHaveLength(variants.length);
    calls.forEach((call, index) => {
      expect(call.code).toBe(variants[index]!.code);
      expect(call.config).toEqual(variants[index]!.config);
    });
    // 首次调用必须是基准
    expect(calls[0]!.code).toBe("BASELINE");
  });

  it("evaluator 抛错 / 返回 failed / 产物非法 → 对应样本转记 failed，其余照常评估", () => {
    const base = copyCostDecl();
    const { variants } = generateCostStressVariants(base, {
      commissionRateFactors: [2, 5],
    });
    const { evaluator, calls } = scriptedEvaluator(
      {
        BASELINE: { totalReturnPct: 20, maxDrawdownPct: 8, tradeCount: 30 },
        COMMISSION_X2: { totalReturnPct: 18, maxDrawdownPct: 8, tradeCount: 30 },
        COMMISSION_X5: { totalReturnPct: 5, maxDrawdownPct: 12, tradeCount: 30 },
      },
      { throwFor: ["COMMISSION_X2"] }
    );
    const run = runRobustnessStress({
      ...STRATEGY,
      perturbations: variants,
      evaluator,
      robustnessRunId: RUN_ID,
      createdAt: CREATED_AT,
    });
    expect(calls).toHaveLength(3);
    const failedSample = run.samples.find((sample) => sample.perturbation.code === "COMMISSION_X2");
    expect(failedSample?.status).toBe("failed");
    expect(failedSample?.error).toContain("评估器抛错");
    expect(failedSample?.verdict).toBe("failed");
    const baseline = run.samples[0]!;
    expect(baseline.verdict).toBe("baseline");
    expect(baseline.status).toBe("succeeded");
    // 抛错样本不计入成功数；COMMISSION_X5 正常敏感
    expect(run.conclusion.failedCount).toBe(1);
    expect(run.conclusion.verdict).toBe("sensitive");
  });
});

// ---------------------------------------------------------------------------
// ⑥ 漂移判定：敏感 vs 稳定
// ---------------------------------------------------------------------------

describe("⑥ 漂移判定 — 成本×5 敏感 / 参数±20% 稳定", () => {
  it("构造「成本×5 → 收益大降」：漂移超阈值 → 样本 sensitive + 结论轴归因 cost", () => {
    const baselineMetrics: RobustnessMetricsView = {
      totalReturnPct: 25,
      maxDrawdownPct: 6,
      tradeCount: 40,
    };
    const stressedMetrics: RobustnessMetricsView = {
      totalReturnPct: 2, // Δ = -23pp（远超默认 5pp 阈值）
      maxDrawdownPct: 22, // 恶化 16pp（远超默认 3pp）
      tradeCount: 40,
    };
    const drift = computeRobustnessDrift(baselineMetrics, stressedMetrics);
    expect(drift.returnDriftPct).toBe(-23);
    expect(drift.drawdownWorseningPct).toBe(16);
    const flags = applyDriftThresholds(drift, resolveRobustnessThresholds());
    expect(flags).toEqual(["RETURN_DRIFT", "DRAWDOWN_WORSENING"]);

    const classification = classifyRobustnessSample({
      isBaseline: false,
      status: "succeeded",
      metrics: stressedMetrics,
      baselineMetrics,
      thresholds: resolveRobustnessThresholds(),
    });
    expect(classification.verdict).toBe("sensitive");
    expect(classification.drift?.flags).toContain("RETURN_DRIFT");

    // 端到端：假 evaluator 让 SLIPPAGE_X5 收益崩盘
    const base = copyCostDecl();
    const { variants } = generateSlippageStressVariants(base, { factors: [5] });
    const script: Record<string, RobustnessMetricsView> = {
      BASELINE: baselineMetrics,
      SLIPPAGE_X5: stressedMetrics,
    };
    const run = runRobustnessStress({
      ...STRATEGY,
      perturbations: variants,
      evaluator: scriptedEvaluator(script).evaluator,
      robustnessRunId: RUN_ID,
      createdAt: CREATED_AT,
    });
    expect(run.axis).toBe("slippage");
    expect(run.samples[1]!.verdict).toBe("sensitive");
    expect(run.conclusion.verdict).toBe("sensitive");
    expect(run.conclusion.sensitiveEntries.map((entry) => entry.code)).toEqual(["SLIPPAGE_X5"]);
  });

  it("构造「参数 ±20% → 绩效稳定」：漂移未超阈值 → stable + 结论 stable", () => {
    const { variants } = generateParameterPerturbationVariants(BASE_PARAMS, {
      rules: [{ parameterName: "scoreThreshold", percentSteps: [-20, 20] }],
    });
    const script: Record<string, RobustnessMetricsView> = {
      BASELINE: { totalReturnPct: 18, maxDrawdownPct: 7, tradeCount: 25 },
      PARAM_scoreThreshold_PCT_M20: { totalReturnPct: 17.5, maxDrawdownPct: 7, tradeCount: 25 },
      PARAM_scoreThreshold_PCT_P20: { totalReturnPct: 18.4, maxDrawdownPct: 7.5, tradeCount: 25 },
    };
    const run = runRobustnessStress({
      ...STRATEGY,
      perturbations: variants,
      evaluator: scriptedEvaluator(script).evaluator,
      robustnessRunId: RUN_ID,
      createdAt: CREATED_AT,
    });
    expect(run.samples[1]!.verdict).toBe("stable");
    expect(run.samples[2]!.verdict).toBe("stable");
    expect(run.conclusion.verdict).toBe("stable");
    expect(run.conclusion.sensitiveCount).toBe(0);
  });

  it("回撤改善（恶化方向为负）不判敏感；仅收益小漂移 + 回撤恶化超阈值 → 仍判敏感", () => {
    const thresholds = resolveRobustnessThresholds({ returnDriftThresholdPct: 5, drawdownWorseningThresholdPct: 3 });
    // 回撤改善 4pp：不算恶化 → 无 flag
    const improve = computeRobustnessDrift(
      { totalReturnPct: 20, maxDrawdownPct: 10, tradeCount: 1 },
      { totalReturnPct: 21, maxDrawdownPct: 6, tradeCount: 1 }
    );
    expect(improve.drawdownWorseningPct).toBe(0);
    expect(applyDriftThresholds(improve, thresholds)).toEqual([]);
    // 收益漂移 1pp（<5）但回撤恶化 4pp（>3）→ DRAWDOWN_WORSENING
    const ddOnly = computeRobustnessDrift(
      { totalReturnPct: 20, maxDrawdownPct: 10, tradeCount: 1 },
      { totalReturnPct: 19, maxDrawdownPct: 14, tradeCount: 1 }
    );
    expect(applyDriftThresholds(ddOnly, thresholds)).toEqual(["DRAWDOWN_WORSENING"]);
  });
});

// ---------------------------------------------------------------------------
// ⑦ RobustnessRun 记录：round-trip / 篡改拒绝 / fingerprint
// ---------------------------------------------------------------------------

describe("⑦ RobustnessRun 记录 — round-trip / 篡改 / fingerprint", () => {
  function sampleRun(): RobustnessRun {
    const base = copyCostDecl();
    const { variants } = generateCostStressVariants(base, { commissionRateFactors: [2] });
    const script: Record<string, RobustnessMetricsView> = {
      BASELINE: { totalReturnPct: 20, maxDrawdownPct: 6, tradeCount: 30 },
      COMMISSION_X2: { totalReturnPct: 18, maxDrawdownPct: 7, tradeCount: 30 },
    };
    return runRobustnessStress({
      ...STRATEGY,
      perturbations: variants,
      evaluator: scriptedEvaluator(script).evaluator,
      robustnessRunId: RUN_ID,
      createdAt: CREATED_AT,
    });
  }

  it("serialize → deserialize 完全 round-trip（含 samples/conclusion/thresholds/createdAt）", () => {
    const run = sampleRun();
    const json = serializeRobustnessRun(run);
    const restored = deserializeRobustnessRun(json);
    expect(restored).toEqual(run);
    expect(restored.fingerprint).toBe(run.fingerprint);
    expect(restored.samples).toHaveLength(2);
    expect(restored.samples[0]!.perturbation.isBaseline).toBe(true);
    expect(restored.createdAt).toBe(CREATED_AT);
  });

  it("fingerprint = sha256 canonical（64 hex）；重算一致；篡改 metrics → 反序列化抛错", () => {
    const run = sampleRun();
    expect(run.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(computeRobustnessRunFingerprint(run)).toBe(run.fingerprint);
    expect(validateRobustnessRun(run).valid).toBe(true);

    const tampered: RobustnessRun = {
      ...run,
      samples: run.samples.map((sample, index) =>
        index === 1
          ? { ...sample, metrics: { ...sample.metrics!, totalReturnPct: 99 } }
          : sample
      ) as RobustnessRun["samples"],
    };
    const json = JSON.stringify(tampered);
    expect(() => deserializeRobustnessRun(json)).toThrow(ResearchValidationError);
    expect(throwCodes(() => deserializeRobustnessRun(json))).toContain(
      "RB18_RUN_FINGERPRINT_MISMATCH"
    );
  });

  it("样本 configFingerprint 与扰动后配置指纹一致（独立可复算）", () => {
    const run = sampleRun();
    for (const sample of run.samples) {
      expect(sample.configFingerprint).toBe(
        computePerturbationConfigFingerprint(sample.perturbation)
      );
    }
  });

  it("结构篡改（轴混写 / 索引 0 非基准）→ validateRobustnessRun 报 issue", () => {
    const run = sampleRun();
    const badAxis = { ...run, axis: "execution" as const };
    expect(validateRobustnessRun(badAxis).valid).toBe(false);

    const notFirstBaseline: RobustnessRun = {
      ...run,
      samples: [run.samples[1]!, run.samples[0]!] as RobustnessRun["samples"],
    };
    const validation = validateRobustnessRun(notFirstBaseline);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("RB18_RUN_BASELINE_NOT_FIRST");
  });
});

// ---------------------------------------------------------------------------
// ⑧ 确定性
// ---------------------------------------------------------------------------

describe("⑧ 确定性 — 同输入必同输出", () => {
  it("同基线 + 同配置两次生成 → 变体清单深相等", () => {
    const base = copyCostDecl();
    const first = generateSlippageStressVariants(base, { factors: [0.5, 2, 5], offsetsBps: [-3, 3] });
    const second = generateSlippageStressVariants(base, { factors: [0.5, 2, 5], offsetsBps: [-3, 3] });
    expect(first).toEqual(second);
  });

  it("两次 runRobustnessStress（确定性假 evaluator）→ 记录与 fingerprint 完全一致", () => {
    const build = (): RobustnessRun => {
      const base = copyCostDecl();
      const { variants } = generateSlippageStressVariants(base, { factors: [2, 5] });
      const script: Record<string, RobustnessMetricsView> = {
        BASELINE: { totalReturnPct: 20, maxDrawdownPct: 6, tradeCount: 30 },
        SLIPPAGE_X2: { totalReturnPct: 18, maxDrawdownPct: 7, tradeCount: 30 },
        SLIPPAGE_X5: { totalReturnPct: 9, maxDrawdownPct: 14, tradeCount: 30 },
      };
      return runRobustnessStress({
        ...STRATEGY,
        perturbations: variants,
        evaluator: scriptedEvaluator(script).evaluator,
        robustnessRunId: RUN_ID,
        createdAt: CREATED_AT,
      });
    };
    const first = build();
    const second = build();
    expect(second).toEqual(first);
    expect(serializeRobustnessRun(second)).toBe(serializeRobustnessRun(first));
  });
});

// ---------------------------------------------------------------------------
// ⑨ 退化输入 / 结构化处理
// ---------------------------------------------------------------------------

describe("⑨ 退化输入 — 空扰动 / 缺基准 / 混轴 / 非法基线 / 失败路径", () => {
  it("空扰动清单 → runRobustnessStress 抛 RB18_REQUEST_PERTURBATIONS_EMPTY", () => {
    const { evaluator } = scriptedEvaluator({});
    const run = () =>
      runRobustnessStress({
        ...STRATEGY,
        perturbations: [],
        evaluator,
        robustnessRunId: RUN_ID,
        createdAt: CREATED_AT,
      });
    expect(run).toThrow(ResearchValidationError);
    expect(throwCodes(run)).toContain("RB18_REQUEST_PERTURBATIONS_EMPTY");
  });

  it("扰动清单只有基准无变体 → 合法 run，结论 no-variants", () => {
    const base = copyCostDecl();
    const { variants } = generateSlippageStressVariants(base, {});
    const script: Record<string, RobustnessMetricsView> = {
      BASELINE: { totalReturnPct: 20, maxDrawdownPct: 6, tradeCount: 30 },
    };
    const run = runRobustnessStress({
      ...STRATEGY,
      perturbations: variants,
      evaluator: scriptedEvaluator(script).evaluator,
      robustnessRunId: RUN_ID,
      createdAt: CREATED_AT,
    });
    expect(run.samples).toHaveLength(1);
    expect(run.conclusion.verdict).toBe("no-variants");
  });

  it("混轴（execution 基准 + cost 变体）→ RB18_AXIS_MIXED", () => {
    const execBase = baseExecDecl();
    const costBase = copyCostDecl();
    const items: PerturbationItem[] = [
      execItem(execBase, "BASELINE", true),
      costItem(costBase, "MANUAL_COST"),
    ];
    const { evaluator } = scriptedEvaluator({});
    const run = () =>
      runRobustnessStress({
        ...STRATEGY,
        perturbations: items,
        evaluator,
        robustnessRunId: RUN_ID,
        createdAt: CREATED_AT,
      });
    expect(run).toThrow(ResearchValidationError);
    expect(throwCodes(run)).toContain("RB18_AXIS_MIXED");
  });

  it("非法基线成本声明（佣金超出 C-14.2 上界）→ assert 抛 ResearchValidationError（CM14 code）", () => {
    const invalid = { ...copyCostDecl(), commissionRate: 0.5 } as CostModelDeclaration;
    const { evaluator } = scriptedEvaluator({});
    const run = () =>
      runRobustnessStress({
        ...STRATEGY,
        perturbations: [costItem(invalid, "BASELINE", true)],
        evaluator,
        robustnessRunId: RUN_ID,
        createdAt: CREATED_AT,
      });
    expect(run).toThrow(ResearchValidationError);
    expect(throwCodes(run)).toContain("CM14_OUT_OF_RANGE");
  });

  it("基准条目评估失败 → RB18_BASELINE_FAILED（漂移无锚点）", () => {
    const base = copyCostDecl();
    const { variants } = generateSlippageStressVariants(base, { factors: [2] });
    const { evaluator } = scriptedEvaluator(
      { SLIPPAGE_X2: { totalReturnPct: 10, maxDrawdownPct: 8, tradeCount: 1 } },
      { failedFor: ["BASELINE"] }
    );
    const run = () =>
      runRobustnessStress({
        ...STRATEGY,
        perturbations: variants,
        evaluator,
        robustnessRunId: RUN_ID,
        createdAt: CREATED_AT,
      });
    expect(run).toThrow(ResearchValidationError);
    expect(throwCodes(run)).toContain("RB18_BASELINE_FAILED");
  });

  it("非法阈值（负值）→ resolveRobustnessThresholds 抛 RB18_THRESHOLD_RETURN_INVALID", () => {
    expect(() => resolveRobustnessThresholds({ returnDriftThresholdPct: -1 })).toThrow(ResearchValidationError);
  });

  it("全部扰动评估失败（基准成功）→ 结论 insufficient，不产出敏感误判", () => {
    const base = copyCostDecl();
    const { variants } = generateSlippageStressVariants(base, { factors: [2, 5] });
    const { evaluator } = scriptedEvaluator(
      { BASELINE: { totalReturnPct: 20, maxDrawdownPct: 6, tradeCount: 30 } },
      { failedFor: ["SLIPPAGE_X2", "SLIPPAGE_X5"] }
    );
    const run = runRobustnessStress({
      ...STRATEGY,
      perturbations: variants,
      evaluator,
      robustnessRunId: RUN_ID,
      createdAt: CREATED_AT,
    });
    expect(run.conclusion.verdict).toBe("insufficient");
    expect(run.conclusion.sensitiveCount).toBe(0);
    expect(run.samples.filter((sample) => sample.status === "failed")).toHaveLength(2);
  });

  it("滑点偏移为负（不 clamp）→ 结构化 skipped + variants 仅基准", () => {
    const base = { ...copyCostDecl(), slippageBps: 3, name: "LOW_SLIP" };
    const { variants, skipped } = generateSlippageStressVariants(base, { offsetsBps: [-5] });
    expect(variants).toHaveLength(1); // 只有基准（3-5 = -2 < 0，拒绝而非 clamp）
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.code).toBe("SLIPPAGE_OFFSET_M5");
    expect(skipped[0]!.reason).toContain("为负");
  });

  it("assessRobustnessSensitivity 直接调用：空 entries → RB18_ENTRIES_EMPTY；缺基准 → RB18_BASELINE_MISSING", () => {
    const thresholds = resolveRobustnessThresholds();
    expect(() => assessRobustnessSensitivity([], thresholds)).toThrow(ResearchValidationError);
    const base = copyCostDecl();
    const { variants } = generateSlippageStressVariants(base, { factors: [2] });
    const noBaseline = variants
      .filter((item) => !item.isBaseline)
      .map((item) => ({ perturbation: item, status: "succeeded" as const, metrics: { totalReturnPct: 10, maxDrawdownPct: 5, tradeCount: 1 }, error: null }));
    expect(() => assessRobustnessSensitivity(noBaseline, thresholds)).toThrow(ResearchValidationError);
  });
});
