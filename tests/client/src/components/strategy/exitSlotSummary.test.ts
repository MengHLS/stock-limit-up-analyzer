/** P2/P3 —— 槽取值摘要与政策总述的纯函数锁。 */
import { describe, expect, it } from "vitest";
import { compactParameterValue, summarizeExitPolicySlots, summarizeSlotValues } from "@/components/strategy/ExitPolicySlotEditor";
import type { PresetParameter } from "@/components/strategy/PresetEditor";

const num = (code: string, unit: string, value: number): PresetParameter => ({
  code, label: code, description: "", path: "/" + code, valueType: "number", unit, required: true, defaultValue: value,
});

describe("compactParameterValue", () => {
  it("ratio 转百分比 / MULTIPLE 转倍 / TRADING_DAY 转日", () => {
    expect(compactParameterValue(num("stopRatio", "ratio", 0.06), 0.06)).toBe("6%");
    expect(compactParameterValue(num("atrMultiplier", "MULTIPLE", 1.5), 1.5)).toBe("1.5×");
    expect(compactParameterValue(num("holdingDays", "TRADING_DAY", 5), 5)).toBe("5日");
  });
});

describe("summarizeSlotValues", () => {
  it("跳过上下限，最多两项", () => {
    const option = { optionId: "atr", displayName: "ATR", summary: "", parameters: [
      num("atrWindow", "TRADING_DAY", 10), num("atrMultiplier", "MULTIPLE", 1.5), num("minStopRatio", "ratio", 0.04),
    ] };
    expect(summarizeSlotValues(option, { atrWindow: 10, atrMultiplier: 1.5 })).toBe("10日 · 1.5×");
  });
  it("没有参数或没有选中方案时返回空串", () => {
    expect(summarizeSlotValues({ optionId: "off", displayName: "不启用", summary: "", parameters: [] }, {})).toBe("");
    expect(summarizeSlotValues(null, {})).toBe("");
  });
});

describe("summarizeExitPolicySlots", () => {
  const slots = [
    { slotId: "ANCHOR", label: "止损位置", question: "", visibility: "PRIMARY" as const, options: [
      { optionId: "fixed-percent", displayName: "固定百分比", summary: "", parameters: [num("stopRatio", "ratio", 0.06)] },
      { optionId: "off", displayName: "不启用", summary: "", parameters: [] },
    ] },
    { slotId: "TAKE_PROFIT", label: "止盈", question: "", visibility: "PRIMARY" as const, options: [
      { optionId: "ma-cross", displayName: "跌破 MA5/MA10 就走", summary: "", parameters: [] },
    ] },
  ];
  const rec = (slotId: string, optionId: string | null, parameters: Record<string, number> = {}) => ({ slotId, optionId, parameters, atDefaults: true });

  it("按槽表顺序拼，跳过 off 与认不出的槽", () => {
    expect(summarizeExitPolicySlots(slots, [rec("ANCHOR", "fixed-percent", { stopRatio: 0.07 }), rec("TAKE_PROFIT", "ma-cross")]))
      .toBe("固定百分比 7% · 跌破 MA5/MA10 就走");
    expect(summarizeExitPolicySlots(slots, [rec("ANCHOR", "off"), rec("TAKE_PROFIT", null)])).toBe("");
  });
});
