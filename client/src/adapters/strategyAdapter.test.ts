/**
 * strategyAdapter 单测（任务 §19：StrategyDocument JSON ↔ Visual Editor 无损往返）。
 *
 * 验证 adapter 的「wire → ViewModel → wire」往返是否保真：已知字段不丢、
 * extra 透传字段（recordKind/recordVersion/recipe/metadata）不丢、
 * nullable 参数显式 defaultValue:null 不丢。
 */

import { describe, expect, it } from "vitest";
import {
  strategyToViewModel,
  viewModelToStrategy,
  ruleConditionText,
  positionSizingLabel,
  emptyRule,
} from "./strategyAdapter";

const DOC = {
  recordKind: "STRATEGY_DOCUMENT",
  recordVersion: 1,
  strategyId: "limit-up-baseline",
  version: "1.0.0",
  name: "涨停候选基线",
  description: "研究链路基线策略",
  universe: { universeId: "research-dataset:rd-1.0.0-1-cffc2a0e66efbf0b" },
  entryRules: [
    { id: "enter-topN", kind: "threshold", field: "candidate.rank", operator: "<=", operand: 5, description: "候选排名 <= 5 进场" },
  ],
  exitRules: [
    { id: "exit-days", kind: "time-based", field: "position.holdingDays", operator: ">=", operand: 3, description: "持有 >= 3 交易日退出" },
  ],
  positionSizing: { kind: "equal-weight", maxPositions: 5 },
  riskRules: [{ id: "risk-max", kind: "state", field: "position.count", operator: "<=", operand: 5, description: "持仓数 <= 5" }],
  parameters: {
    parameters: [
      { name: "topN", type: "number", required: true, defaultValue: 5, min: 1, max: 20, description: "选股数" },
      { name: "minScore", type: "number", required: false, nullable: true, defaultValue: null, description: "分数阈值" },
    ],
  },
  datasetVersion: "rd-1.0.0-1-cffc2a0e66efbf0b",
  executionAssumptions: {
    backtestConfig: { initialCapital: 100000, maxPositions: 5 },
    costModel: { commissionRate: 0.0003, stampDutyRate: 0.001, transferFeeRate: 0.00001, slippageBps: 10, lotSize: 100, minCommission: 5 },
    executionModel: "NEXT_OPEN",
  },
  fingerprint: "c8f0996d95e372e3eba56081ef0df5a607f48313e7e370916d0009af3bcbdb02",
};

describe("strategyAdapter 无损往返", () => {
  it("已知字段往返保真", () => {
    const vm = strategyToViewModel(DOC);
    const out = viewModelToStrategy(vm);

    expect(out.strategyId).toBe("limit-up-baseline");
    expect(out.version).toBe("1.0.0");
    expect(out.name).toBe("涨停候选基线");
    expect(out.description).toBe("研究链路基线策略");
    expect(out.recordKind).toBe("STRATEGY_DOCUMENT");
    expect(out.recordVersion).toBe(1);
    expect(out.datasetVersion).toBe("rd-1.0.0-1-cffc2a0e66efbf0b");
    expect(out.fingerprint).toBe("c8f0996d95e372e3eba56081ef0df5a607f48313e7e370916d0009af3bcbdb02");
  });

  it("extra 透传字段（recipe/metadata）不丢", () => {
    const doc = {
      ...DOC,
      recipe: { kind: "signalEngine", recipeId: "r1", point: "open" },
      metadata: { author: "researcher-a", tags: ["limit-up"] },
    };
    const vm = strategyToViewModel(doc);
    const out = viewModelToStrategy(vm);
    expect(out.recipe).toEqual(doc.recipe);
    expect(out.metadata).toEqual(doc.metadata);
  });

  it("rules 往返保真（field/operator/operand）", () => {
    const vm = strategyToViewModel(DOC);
    const out = viewModelToStrategy(vm);
    expect(out.entryRules).toHaveLength(1);
    expect(out.entryRules[0]).toEqual(DOC.entryRules[0]);
    expect(out.exitRules[0]).toEqual(DOC.exitRules[0]);
    expect(out.riskRules[0]).toEqual(DOC.riskRules[0]);
  });

  it("positionSizing 往返保真", () => {
    const vm = strategyToViewModel(DOC);
    const out = viewModelToStrategy(vm);
    expect(out.positionSizing).toEqual({ kind: "equal-weight", maxPositions: 5 });
  });

  it("nullable 参数显式 defaultValue:null 不丢", () => {
    const vm = strategyToViewModel(DOC);
    const out = viewModelToStrategy(vm);
    const params = (out.parameters as { parameters: Array<Record<string, unknown>> }).parameters;
    const minScore = params.find((p) => p.name === "minScore");
    expect(minScore).toBeDefined();
    expect(minScore).toHaveProperty("defaultValue", null);
  });

  it("costModel 与 executionModel 往返保真", () => {
    const vm = strategyToViewModel(DOC);
    const out = viewModelToStrategy(vm);
    expect((out.executionAssumptions as { costModel: unknown }).costModel).toEqual(DOC.executionAssumptions.costModel);
    expect((out.executionAssumptions as { executionModel: string }).executionModel).toBe("NEXT_OPEN");
    expect((out.executionAssumptions as { backtestConfig: { initialCapital: number } }).backtestConfig.initialCapital).toBe(100000);
  });
});

describe("strategyAdapter 展示 helpers", () => {
  it("ruleConditionText 生成可读条件", () => {
    const vm = strategyToViewModel(DOC);
    expect(ruleConditionText(vm.entryRules[0])).toBe("candidate.rank <= 5");
  });

  it("positionSizingLabel 映射中文标签", () => {
    expect(positionSizingLabel("equal-weight")).toBe("等权分仓");
    expect(positionSizingLabel("fixed-fraction")).toBe("固定比例");
    expect(positionSizingLabel("rank-weighted")).toBe("按排名加权");
  });

  it("emptyRule 生成合法默认规则", () => {
    const r = emptyRule("threshold");
    expect(r.kind).toBe("threshold");
    expect(r.operator).toBe("<=");
    expect(r.operand).toBeNull();
  });
});
