/** SCOPE-002 §2.3 A2 —— 空白 canonical 草稿骨架单测（纯函数）。 */
import { describe, expect, it } from "vitest";
import { buildStrategyAuthoringBlank, AUTHORING_DEFAULT_INITIAL_CAPITAL } from "../../../../server/research/strategyAuthoring/blankDraft";
import { DEFAULT_COST_MODEL } from "../../../../server/engine/execution";

describe("buildStrategyAuthoringBlank", () => {
  it("未绑定数据集：datasets 为空、universe 空占位、identity 清空", () => {
    const blank = buildStrategyAuthoringBlank();
    const definition = blank.parts.definition as Record<string, any>;
    expect(definition.datasets).toEqual([]);
    expect(blank.parts.universe.universeId).toBe("");
    expect(blank.parts.identity.strategyId).toBe("");
    expect(blank.parts.identity.name).toBe("");
    expect(blank.parts.identity.strategyType).toBeNull();
    expect(blank.parts.recipe).toBeNull();
  });

  it("绑定数据集：写入 PRIMARY 绑定 + universe 派生", () => {
    const blank = buildStrategyAuthoringBlank({
      datasetBinding: { datasetId: "first_limit_pullback", datasetVersion: "v7", datasetVersionId: 750001 },
    });
    const definition = blank.parts.definition as Record<string, any>;
    expect(definition.datasets).toEqual([
      { role: "PRIMARY", datasetId: "first_limit_pullback", datasetVersion: "v7", datasetVersionId: 750001 },
    ]);
    expect(blank.parts.universe.universeId).toBe("research-dataset:v7");
  });

  it("执行假设使用平台默认成本模型（不把研究专用成本写成默认）", () => {
    const blank = buildStrategyAuthoringBlank();
    expect(blank.parts.executionAssumptions.costModel).toEqual(DEFAULT_COST_MODEL);
    expect(blank.parts.executionAssumptions.backtestConfig.initialCapital).toBe(AUTHORING_DEFAULT_INITIAL_CAPITAL);
  });

  it("骨架结构齐全（各段键存在），供编辑器渲染", () => {
    const definition = buildStrategyAuthoringBlank().parts.definition as Record<string, any>;
    for (const key of ["schemaVersion", "datasets", "entry", "exit", "position", "risk", "execution", "parameters"]) {
      expect(Object.prototype.hasOwnProperty.call(definition, key)).toBe(true);
    }
    expect(definition.entry.event).toBeDefined();
    expect(definition.entry.observationWindow).toBeDefined();
    expect(definition.entry.trigger).toBeDefined();
    expect(Array.isArray(definition.entry.conditions)).toBe(true);
    expect(definition.exit.rules).toEqual([]);
  });

  it("声明「无证据开发草稿」的 notes 与必填段清单", () => {
    const blank = buildStrategyAuthoringBlank();
    expect(blank.notes.join(" ")).toContain("无证据开发草稿");
    expect(blank.requiredSections.map(s => s.key)).toContain("recipe");
    expect(blank.requiredSections.map(s => s.key)).toContain("identity");
  });
});