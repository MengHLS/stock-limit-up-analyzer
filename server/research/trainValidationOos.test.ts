/**
 * STEP 6.4 — Train / Validation / OOS Evaluation Plan 测试。
 *
 * 覆盖（对应验收 §38 / §39 / §40 + §10 / §25）：
 *   Plan 创建 + 校验 / 语义锁（validationOnly / oosLocked 恒 true）/ fingerprint 确定性 + 敏感性
 *   （改 validationEnd / selectionMetric / costModel）/ 序列化 round-trip / mutation isolation。
 */

import { describe, expect, it } from "vitest";
import type { ResearchDatasetSplit } from "./datasetSplit";
import {
  computeEvaluationPlanFingerprint,
  createResearchEvaluationPlan,
  deserializeResearchEvaluationPlan,
  serializeResearchEvaluationPlan,
  validateResearchEvaluationPlan,
  type ResearchEvaluationPlan,
} from "./trainValidationOos";
import type { ResearchBacktestConfig } from "./types";

const SPLIT: ResearchDatasetSplit = {
  trainStart: "2020-01-01",
  trainEnd: "2023-12-31",
  validationStart: "2024-01-01",
  validationEnd: "2024-12-31",
  oosStart: "2025-01-01",
  oosEnd: "2025-12-31",
};

const COST_MODEL: ResearchBacktestConfig["costModel"] = {
  commissionRate: 0.0001,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00002,
  slippageBps: 20,
  lotSize: 100,
  minCommission: 1,
};

function makePlan(overrides: Partial<Parameters<typeof createResearchEvaluationPlan>[0]> = {}): ResearchEvaluationPlan {
  return createResearchEvaluationPlan({
    strategyId: "leader-candidate-baseline",
    strategyVersion: "1.0.0",
    split: SPLIT,
    selectionMetric: "sharpeRatio",
    selectionDirection: "maximize",
    parameterSpaceFingerprint: "fp-param-space",
    backtestConfig: { initialCapital: 100_000, costModel: COST_MODEL },
    featureConfig: { featureMode: "off" },
    ...overrides,
  });
}

describe("Research Evaluation Plan — 创建与校验", () => {
  it("createResearchEvaluationPlan 派生三段范围 + fingerprint", () => {
    const plan = makePlan();
    expect(plan.split.train).toEqual({ start: "2020-01-01", end: "2023-12-31" });
    expect(plan.split.validation).toEqual({ start: "2024-01-01", end: "2024-12-31" });
    expect(plan.split.oos).toEqual({ start: "2025-01-01", end: "2025-12-31" });
    expect(plan.datasetSplitFingerprint).toBeTruthy();
    expect(plan.validationOnly).toBe(true);
    expect(plan.oosLocked).toBe(true);
    expect(validateResearchEvaluationPlan(plan).valid).toBe(true);
  });

  it("语义锁：validationOnly / oosLocked 设为 false 被拒绝", () => {
    const badValidation = { ...makePlan(), validationOnly: false } as unknown as ResearchEvaluationPlan;
    expect(validateResearchEvaluationPlan(badValidation).valid).toBe(false);
    expect(validateResearchEvaluationPlan(badValidation).issues.some((i) => i.code === "PLAN_VALIDATION_ONLY_VIOLATED")).toBe(true);

    const badOos = { ...makePlan(), oosLocked: false } as unknown as ResearchEvaluationPlan;
    expect(validateResearchEvaluationPlan(badOos).issues.some((i) => i.code === "PLAN_OOS_LOCKED_VIOLATED")).toBe(true);
  });

  it("非法 selectionMetric 被拒绝", () => {
    const bad = { ...makePlan(), selectionMetric: "sortinoRatio" } as unknown as ResearchEvaluationPlan;
    expect(validateResearchEvaluationPlan(bad).valid).toBe(false);
  });
});

describe("Research Evaluation Plan — Fingerprint", () => {
  it("相同 Plan 产生相同指纹（确定性）", () => {
    expect(computeEvaluationPlanFingerprint(makePlan())).toBe(computeEvaluationPlanFingerprint(makePlan()));
  });

  it("只改 validationEnd → 不同指纹", () => {
    const a = makePlan();
    const b = makePlan({ split: { ...SPLIT, validationEnd: "2024-11-30" } });
    expect(computeEvaluationPlanFingerprint(a)).not.toBe(computeEvaluationPlanFingerprint(b));
  });

  it("只改 selectionMetric → 不同指纹", () => {
    const a = makePlan();
    const b = makePlan({ selectionMetric: "maxDrawdownPct", selectionDirection: "minimize" });
    expect(computeEvaluationPlanFingerprint(a)).not.toBe(computeEvaluationPlanFingerprint(b));
  });

  it("只改 costModel → 不同指纹", () => {
    const a = makePlan();
    const b = makePlan({ backtestConfig: { initialCapital: 100_000, costModel: { ...COST_MODEL, minCommission: 9 } } });
    expect(computeEvaluationPlanFingerprint(a)).not.toBe(computeEvaluationPlanFingerprint(b));
  });
});

describe("Research Evaluation Plan — 序列化 / mutation isolation", () => {
  it("serialize → deserialize round-trip 语义一致", () => {
    const plan = makePlan();
    const restored = deserializeResearchEvaluationPlan(serializeResearchEvaluationPlan(plan));
    expect(restored).toEqual(plan);
    expect(restored.split).toEqual(plan.split);
    expect(restored.backtestConfig!.costModel).toEqual(COST_MODEL);
  });

  it("deserialize 返回独立副本：修改 restored 不影响再次 deserialize", () => {
    const plan = makePlan();
    const json = serializeResearchEvaluationPlan(plan);
    const restored1 = deserializeResearchEvaluationPlan(json);
    restored1.backtestConfig!.costModel!.minCommission = 999;
    const restored2 = deserializeResearchEvaluationPlan(json);
    expect(restored2.backtestConfig!.costModel!.minCommission).toBe(1);
  });

  it("createResearchEvaluationPlan 深拷贝 backtestConfig：修改输入不影响 Plan", () => {
    const input = {
      strategyId: "leader-candidate-baseline",
      strategyVersion: "1.0.0",
      split: SPLIT,
      selectionMetric: "sharpeRatio" as const,
      selectionDirection: "maximize" as const,
      parameterSpaceFingerprint: "fp-param-space",
      backtestConfig: { initialCapital: 100_000, costModel: COST_MODEL },
    };
    const plan = createResearchEvaluationPlan(input);
    input.backtestConfig.costModel!.minCommission = 999;
    expect(plan.backtestConfig!.costModel!.minCommission).toBe(1);
  });
});
