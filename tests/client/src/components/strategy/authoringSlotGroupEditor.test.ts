import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  humanAuthoringParameterValue,
  summarizeAuthoringSlots,
  summarizeAuthoringSlotValues,
  type AuthoringGroupSlotDto,
  type AuthoringGroupSlotRecognitionDto,
} from "@/components/strategy/AuthoringSlotGroupEditor";
import type { PresetParameter } from "@/components/strategy/authoringSlotParameter";

function parameter(overrides: Partial<PresetParameter> = {}): PresetParameter {
  return {
    code: "p",
    label: "参数",
    description: "",
    path: "position.p",
    valueType: "number",
    required: false,
    defaultValue: 0,
    ...overrides,
  };
}

const SLOT: AuthoringGroupSlotDto = {
  slotId: "MAX_POSITIONS",
  label: "最大持仓数",
  question: "最多同时持有几只？",
  visibility: "PRIMARY",
  options: [
    {
      optionId: "max-5",
      displayName: "最多 5 只",
      summary: "最多同时持有 5 只",
      parameters: [parameter({ code: "maxPositions", label: "最大持仓数", valueType: "number", unit: "COUNT", defaultValue: 5 })],
    },
    {
      optionId: "off",
      displayName: "不设置",
      summary: "",
      parameters: [],
    },
  ],
};

describe("AuthoringSlotGroupEditor 纯函数与结构锁", () => {
  it("ratio / 金额 / bp / 天数只做显示换算，不改 canonical 值", () => {
    expect(humanAuthoringParameterValue(parameter({ valueType: "number", unit: "RATIO" }), 0.08)).toBe("8%");
    expect(humanAuthoringParameterValue(parameter({ valueType: "number", unit: "CNY" }), 100000)).toBe("100,000 元");
    expect(humanAuthoringParameterValue(parameter({ valueType: "number", unit: "BPS" }), 5)).toBe("5 bp");
    expect(humanAuthoringParameterValue(parameter({ valueType: "number", unit: "TRADING_DAY" }), 3)).toBe("3 个交易日");
  });

  it("summary 跳过认不出与 off 的槽，不伪造方案", () => {
    const recognitions: readonly AuthoringGroupSlotRecognitionDto[] = [
      { slotId: "MAX_POSITIONS", optionId: "max-5", parameters: { maxPositions: 5 }, atDefaults: true },
      { slotId: "OTHER", optionId: null, parameters: {}, atDefaults: false },
      { slotId: "OFF", optionId: "off", parameters: {}, atDefaults: true },
    ];
    expect(summarizeAuthoringSlotValues(SLOT.options[0]!, { maxPositions: 5 })).toBe("5 个");
    expect(summarizeAuthoringSlots([SLOT], recognitions)).toBe("最多 5 只 · 5 个");
  });

  it("组件只渲染服务端参数，不出现模型类编辑控件或服务端拼装函数", () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, "../../../../../client/src/components/strategy/AuthoringSlotGroupEditor.tsx"),
      "utf8",
    );
    for (const hook of [
      "data-authoring-slot-group=",
      "data-authoring-slot=",
      "data-authoring-slot-select=",
      "data-authoring-slot-value=",
      "data-authoring-slot-params-toggle=",
      "data-authoring-slot-empty",
      "data-authoring-slot-unrecognized=",
      "data-authoring-slot-group-summary=",
    ]) {
      expect(source.includes(hook), hook).toBe(true);
    }
    expect(source).toContain("本表单不识别（保持原样）");
    expect(source).not.toContain("slippageModel");
    expect(source).not.toContain("commissionModel");
    expect(source).not.toContain("materialize");
    expect(source).not.toContain("applyDefinitionFieldPatch");
    expect(source).not.toContain("from \"server/");
  });
});
