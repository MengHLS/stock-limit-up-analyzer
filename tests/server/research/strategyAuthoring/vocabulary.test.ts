/**
 * SCOPE-002 §1.4 / §2.3 A1 —— 词表单测。
 *
 * 哨兵价值：证明"前端要的清单"确实从既有注册表来（而不是本模块自造），
 * 且词表是**确定性**的（内容 hash 稳定 ⇒ 前端缓存判定可信）。
 */
import { describe, expect, it } from "vitest";
import { buildStrategyAuthoringVocabulary } from "../../../../server/research/strategyAuthoring/vocabulary";
import { listStrategyAuthoringPresets } from "../../../../server/research/strategyAuthoring/presetRegistry";
import { RUNNER_HOLDING_BRIDGE_STATES } from "../../../../server/research/exitPolicyCommon";
import { STRATEGY_TYPES } from "../../../../server/research/strategySchema/types";
import { STRATEGY_LIFECYCLE_STATUSES } from "../../../../server/research/lifecycle/types";

const vocabulary = buildStrategyAuthoringVocabulary();

describe("buildStrategyAuthoringVocabulary", () => {
  it("确定性：两次构造内容一致（含 vocabularyVersion）", () => {
    const again = buildStrategyAuthoringVocabulary();
    expect(again.vocabularyVersion).toBe(vocabulary.vocabularyVersion);
    expect(again.presets).toEqual(vocabulary.presets);
  });

  it("version 形如 authoring-vocab-sha256:<64hex>", () => {
    expect(vocabulary.vocabularyVersion).toMatch(/^authoring-vocab-sha256:[0-9a-f]{64}$/);
  });

  it("包含 3570001 的退出政策预设与 recipe 预设", () => {
    const ids = vocabulary.presets.map(p => p.presetId);
    expect(ids).toContain("exit:SL-18.1-nh3-5-20");
    expect(ids).toContain("recipe:first-limit-pullback-3f-top3");
  });

  it("runnerStates 与 RUNNER_HOLDING_BRIDGE_STATES 逐项同源（12 项）", () => {
    expect(vocabulary.runnerStates.map(s => s.stateId).sort()).toEqual([...RUNNER_HOLDING_BRIDGE_STATES].sort());
    expect(vocabulary.runnerStates).toHaveLength(12);
  });

  it("strategyTypes / lifecycleStatuses 与既有词表一致", () => {
    expect(vocabulary.strategyTypes).toEqual([...STRATEGY_TYPES]);
    expect(vocabulary.lifecycleStatuses).toEqual([...STRATEGY_LIFECYCLE_STATUSES]);
  });

  it("槽位元数据覆盖 ALL presets 的 slot（无孤儿预设）", () => {
    const declared = new Set(vocabulary.presetSlots.map(s => s.slot));
    for (const preset of vocabulary.presets) expect(declared.has(preset.slot)).toBe(true);
  });

  it("预设摘要与注册表逐条对应（数量 + 高级标记）", () => {
    expect(vocabulary.presets).toHaveLength(listStrategyAuthoringPresets().length);
    expect(vocabulary.presets.filter(p => p.advancedOnly).length).toBeGreaterThan(0);
    expect(vocabulary.presets.filter(p => !p.advancedOnly).length).toBeGreaterThan(0);
  });

  it("★ 每个预设都有「规则式中文名」：非空、且不等于 presetId（不许把 id 糊给用户）", () => {
    for (const preset of vocabulary.presets) {
      expect(preset.displayName.trim(), preset.presetId).not.toBe("");
      expect(preset.displayName, preset.presetId).not.toBe(preset.presetId);
    }
  });

  it("中文名含可读汉字（防「英文 id 换个壳」）", () => {
    for (const preset of vocabulary.presets) {
      expect(/[\u4e00-\u9fa5]/.test(preset.displayName), `${preset.presetId} -> ${preset.displayName}`).toBe(true);
    }
  });

  it("summary 存在（只作 tooltip，不强制渲染）", () => {
    for (const preset of vocabulary.presets) {
      expect(typeof preset.summary, preset.presetId).toBe("string");
    }
  });

  it("3570001 的退出政策中文名自解释（含止损/回撤/均线/持有期四个要点）", () => {
    const preset = vocabulary.presets.find(item => item.presetId === "exit:SL-18.1-nh3-5-20");
    expect(preset?.displayName).toContain("止损");
    expect(preset?.displayName).toContain("回撤");
    expect(preset?.displayName).toContain("均线");
    expect(preset?.displayName).toContain("20日");
  });

  it("RECIPE 预设的参数为空（门槛参数属策略文档 parameters[]，不在预设里重复声明）", () => {
    const recipePresets = vocabulary.presets.filter(p => p.slot === "RECIPE");
    expect(recipePresets.length).toBeGreaterThan(0);
    for (const preset of recipePresets) expect(preset.parameters).toEqual([]);
  });
});