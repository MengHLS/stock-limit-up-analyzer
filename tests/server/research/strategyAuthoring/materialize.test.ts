/**
 * SCOPE-002 §2.3 A3 / §4.4 —— `materializePreset` 单测。
 *
 * 🔴 本文件的核心断言就是全案验收锚点：**预设物化的结果必须与 `3570001` golden 逐字段相等**。
 * 若它失败，说明"前端选预设 + 调参数"产不出 3570001 ⇒ DoD 不成立。
 */
import { describe, expect, it } from "vitest";
import { materializePreset } from "../../../../server/research/strategyAuthoring/materialize";
import { listStrategyAuthoringPresets } from "../../../../server/research/strategyAuthoring/presetRegistry";
import { GOLDEN_3570001 } from "./golden3570001";

const goldenPolicy = (GOLDEN_3570001.definition as any).exit.rules[0].policy as Record<string, unknown>;
const goldenRecipe = GOLDEN_3570001.recipe as Record<string, unknown>;

describe("materializePreset · EXIT_POLICY", () => {
  it("★ 3570001 锚点：exit:SL-18.1-nh3-5-20 无参物化 = golden policy（逐字段）", () => {
    const result = materializePreset({ slot: "EXIT_POLICY", presetId: "exit:SL-18.1-nh3-5-20", parameters: {} });
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual(goldenPolicy);
  });

  it("参数可调：runnerBridge.decisionHoldingDays 改 7 ⇒ payload 跟着变（且仍通过校验）", () => {
    const result = materializePreset({
      slot: "EXIT_POLICY", presetId: "exit:SL-18.1-nh3-5-20",
      parameters: { "runnerBridge.decisionHoldingDays": 7 },
    });
    expect(result.issues).toEqual([]);
    expect((result.payload as any).runnerBridge.decisionHoldingDays).toBe(7);
    expect(result.resolvedParameters["runnerBridge.decisionHoldingDays"]).toBe(7);
  });

  it("runnerBridge.state 的候选项来自 RUNNER_HOLDING_BRIDGE_STATES（12 项）", () => {
    const preset = listStrategyAuthoringPresets().find(p => p.presetId === "exit:SL-18.1-nh3-5-20");
    const stateParam = preset?.parameters.find(p => p.code === "runnerBridge.state");
    expect(stateParam?.allowedValues?.length).toBe(12);
    expect(stateParam?.allowedValues).toContain("NEW_HIGH_3");
  });

  it("同基座但关闭 Runner ⇒ payload 不含 runnerBridge 键（1.62.1 对照形状）", () => {
    const result = materializePreset({ slot: "EXIT_POLICY", presetId: "exit:SL-18.1", parameters: {} });
    expect(result.issues).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(result.payload, "runnerBridge")).toBe(false);
    expect((result.payload as any).stop).toEqual(goldenPolicy.stop);
  });

  it("确定性：同输入两次 ⇒ 同指纹", () => {
    const a = materializePreset({ slot: "EXIT_POLICY", presetId: "exit:SL-18.1-nh3-5-20", parameters: {} });
    const b = materializePreset({ slot: "EXIT_POLICY", presetId: "exit:SL-18.1-nh3-5-20", parameters: {} });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^preset-payload-sha256:[0-9a-f]{64}$/);
  });
});

describe("materializePreset · RECIPE", () => {
  it("★ 3570001 锚点：recipe:first-limit-pullback-3f-top3 = golden recipe（逐字段）", () => {
    const result = materializePreset({ slot: "RECIPE", presetId: "recipe:first-limit-pullback-3f-top3", parameters: {} });
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual(goldenRecipe);
  });
});

describe("materializePreset · 原子槽", () => {
  it("runnerBridge:NH3_DECIDE5_EXTEND20 = golden 的 runnerBridge 段", () => {
    const result = materializePreset({ slot: "RUNNER_BRIDGE", presetId: "runnerBridge:NH3_DECIDE5_EXTEND20", parameters: {} });
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual(goldenPolicy.runnerBridge);
  });

  it("显式关闭：runnerBridge:off ⇒ payload 为 null 且无 issue", () => {
    const result = materializePreset({ slot: "RUNNER_BRIDGE", presetId: "runnerBridge:off", parameters: {} });
    expect(result.issues).toEqual([]);
    expect(result.payload).toBeNull();
  });

  it("stop:SL-18.1 的 stop 段 = golden 的 stop 段", () => {
    const result = materializePreset({ slot: "STOP", presetId: "stop:SL-18.1", parameters: {} });
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual(goldenPolicy.stop);
  });

  it("strongHold 段 = golden 的 strongHold 段", () => {
    const result = materializePreset({ slot: "STRONG_HOLD", presetId: "strongHold:DAY5_TO_10_MIN3PCT_ABOVE_MA5_MA10", parameters: {} });
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual(goldenPolicy.strongHold);
  });

  it("timeExit / takeProfit 段 = golden 对应段", () => {
    expect(materializePreset({ slot: "TIME_EXIT", presetId: "timeExit:FIXED_5", parameters: {} }).payload).toEqual(goldenPolicy.timeExit);
    expect(materializePreset({ slot: "TAKE_PROFIT", presetId: "takeProfit:MA_CROSS_5_10_ACT0", parameters: {} }).payload).toEqual(goldenPolicy.takeProfit);
  });
});

describe("materializePreset · 失败面（响亮拒绝）", () => {
  it("未知 presetId ⇒ AUTHORING_PRESET_NOT_FOUND，payload 不可用", () => {
    const result = materializePreset({ slot: "EXIT_POLICY", presetId: "exit:does-not-exist", parameters: {} });
    expect(result.payload).toBeNull();
    expect(result.issues.map(i => i.code)).toContain("AUTHORING_PRESET_NOT_FOUND");
  });

  it("未声明的参数 code ⇒ AUTHORING_PARAMETER_UNKNOWN（不静默忽略）", () => {
    const result = materializePreset({ slot: "EXIT_POLICY", presetId: "exit:SL-18.1-nh3-5-20", parameters: { "nope.field": 1 } });
    expect(result.payload).toBeNull();
    expect(result.issues.map(i => i.code)).toContain("AUTHORING_PARAMETER_UNKNOWN");
  });

  it("参数值越界 / 不在枚举内 ⇒ AUTHORING_PARAMETER_INVALID", () => {
    const outOfEnum = materializePreset({
      slot: "EXIT_POLICY", presetId: "exit:SL-18.1-nh3-5-20",
      parameters: { "runnerBridge.state": "NOT_A_STATE" },
    });
    expect(outOfEnum.payload).toBeNull();
    expect(outOfEnum.issues.map(i => i.code)).toContain("AUTHORING_PARAMETER_INVALID");

    const outOfRange = materializePreset({
      slot: "EXIT_POLICY", presetId: "exit:SL-18.1-nh3-5-20",
      parameters: { "stop.anchor.stopRatio": 5 },
    });
    expect(outOfRange.payload).toBeNull();
    expect(outOfRange.issues.map(i => i.code)).toContain("AUTHORING_PARAMETER_INVALID");
  });

  it("runnerBridge.extendToHoldingDays 不大于 decisionHoldingDays ⇒ 既有校验器拒绝", () => {
    const result = materializePreset({
      slot: "EXIT_POLICY", presetId: "exit:SL-18.1-nh3-5-20",
      parameters: { "runnerBridge.decisionHoldingDays": 20, "runnerBridge.extendToHoldingDays": 20 },
    });
    expect(result.payload).toBeNull();
    expect(result.issues.map(i => i.code)).toContain("AUTHORING_PAYLOAD_INVALID");
  });
});