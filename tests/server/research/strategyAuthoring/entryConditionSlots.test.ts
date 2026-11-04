import { describe, expect, it } from "vitest";

import type { ConditionDefinition, ParameterDefinition } from "../../../../server/research/strategySchema/definition";
import {
  ENTRY_CONDITION_SLOTS,
  ENTRY_CONDITION_SLOT_IDS,
  applyEntryConditionSlot,
  entryConditionSlotIsAtDefaults,
  findEntryConditionSlot,
  findEntryConditionSlotOption,
  hasEntryConditionSlotConditions,
  materializeEntryConditionSlotOption,
  recognizeEntryConditionSlot,
  type EntryConditionSlotDefinitionCarrier,
} from "../../../../server/research/strategyAuthoring/entryConditionSlots";
import { buildStrategyAuthoringVocabulary } from "../../../../server/research/strategyAuthoring/vocabulary";

const SLOT_ID = "TREND_PULLBACK_AFTER_FIRST_LIMIT_UP";
const OPTION_ID = "trend-pullback-after-first-limit-up";
const OFF_OPTION_ID = "off";

const MANUAL_CONDITION: ConditionDefinition = {
  id: "manual-keep",
  field: "bar.close",
  operator: "GREATER_THAN",
  value: 0,
  valueType: "CONSTANT",
  enabled: true,
  description: "manual condition must survive slot apply",
};

const MANUAL_PARAMETER: ParameterDefinition = {
  code: "manualParam",
  name: "手工参数",
  dataType: "number",
  parameterRole: "FIXED",
  defaultValue: 1,
  required: true,
  description: "manual parameter must survive slot apply",
};

function carrier(
  conditions: readonly ConditionDefinition[] = [],
  parameters: readonly ParameterDefinition[] = [],
): EntryConditionSlotDefinitionCarrier {
  return { entry: { conditions }, parameters };
}

function materializedCarrier(parameters: Readonly<Record<string, number>> = {}): EntryConditionSlotDefinitionCarrier {
  const materialized = materializeEntryConditionSlotOption(SLOT_ID, OPTION_ID, parameters);
  expect(materialized.issues).toEqual([]);
  return carrier(materialized.conditions, materialized.parameters);
}

describe("ENTRY_CONDITION slot registry", () => {
  it("declares the stable slot and a trend/off option pair", () => {
    expect(ENTRY_CONDITION_SLOTS.map((slot) => slot.slotId)).toEqual([...ENTRY_CONDITION_SLOT_IDS]);
    expect(ENTRY_CONDITION_SLOT_IDS).toEqual([SLOT_ID]);

    const slot = findEntryConditionSlot(SLOT_ID);
    expect(slot.label).toContain("入场");
    expect(slot.question).toContain("条件");
    expect(slot.options.map((option) => option.optionId)).toEqual([OPTION_ID, OFF_OPTION_ID]);
    expect(findEntryConditionSlotOption(SLOT_ID, OPTION_ID)).not.toBeNull();
    expect(findEntryConditionSlotOption(SLOT_ID, OFF_OPTION_ID)).not.toBeNull();
    expect(() => findEntryConditionSlot("UNKNOWN")).toThrow("ENTRY_CONDITION_SLOT_UNKNOWN");
  });

  it("materializes the fixed condition and parameter contract", () => {
    const result = materializeEntryConditionSlotOption(SLOT_ID, OPTION_ID);

    expect(result.issues).toEqual([]);
    expect(result.conditions.map((condition) => condition.id)).toEqual([
      "entry.trend_pullback.min",
      "entry.trend_pullback.max",
      "entry.trend_pullback.trend",
      "entry.trend_pullback.volume",
      "entry.trend_pullback.bullish",
    ]);
    expect(result.conditions.map((condition) => condition.field)).toEqual([
      "bar.pullbackFromEventPeakClose",
      "bar.pullbackFromEventPeakClose",
      "bar.trendHoldsMa5Ma10",
      "bar.volumeRatio",
      "bar.isBullish",
    ]);
    expect(result.conditions.map((condition) => condition.value)).toEqual([
      "entry_peak_pullback_min",
      "entry_peak_pullback_max",
      1,
      "entry_max_volume_ratio",
      "entry_require_bullish",
    ]);

    expect(result.parameters.map((parameter) => parameter.code)).toEqual([
      "entry_peak_pullback_min",
      "entry_peak_pullback_max",
      "entry_max_volume_ratio",
      "entry_require_bullish",
    ]);
    expect(result.parameters.find((parameter) => parameter.code === "entry_peak_pullback_min")).toMatchObject({
      parameterRole: "FIXED",
      defaultValue: 0.03,
      min: 0,
      max: 0.5,
      step: 0.005,
    });
    expect(result.parameters.find((parameter) => parameter.code === "entry_peak_pullback_max")).toMatchObject({
      parameterRole: "TUNABLE",
      defaultValue: 0.08,
      min: 0.05,
      max: 0.15,
      step: 0.01,
    });
    expect(result.parameters.find((parameter) => parameter.code === "entry_max_volume_ratio")).toMatchObject({
      parameterRole: "TUNABLE",
      defaultValue: 0.5,
      min: 0.1,
      max: 1,
      step: 0.05,
    });
    expect(result.parameters.find((parameter) => parameter.code === "entry_require_bullish")).toMatchObject({
      parameterRole: "TUNABLE",
      defaultValue: 0,
      min: 0,
      max: 1,
      step: 1,
    });
  });

  it("returns explicit issues for unknown options, parameters, and invalid ranges", () => {
    expect(materializeEntryConditionSlotOption(SLOT_ID, "does-not-exist").issues[0]).toContain("OPTION_UNKNOWN");
    expect(materializeEntryConditionSlotOption(SLOT_ID, OPTION_ID, { nope: 1 }).issues[0]).toContain("PARAMETER_UNKNOWN");
    expect(materializeEntryConditionSlotOption(SLOT_ID, OPTION_ID, { entry_peak_pullback_max: 0.09 }).issues).toEqual([]);
    expect(materializeEntryConditionSlotOption(SLOT_ID, OPTION_ID, { entry_peak_pullback_max: 0.2 }).issues[0]).toContain("不得大于");
    expect(materializeEntryConditionSlotOption(SLOT_ID, OPTION_ID, {
      entry_peak_pullback_min: 0.1,
      entry_peak_pullback_max: 0.08,
    }).issues[0]).toContain("RANGE_INVALID");
  });
});

describe("ENTRY_CONDITION recognition", () => {
  it("recognizes the exact materialized option and reads its parameter values", () => {
    const definition = materializedCarrier({ entry_peak_pullback_max: 0.09 });
    const recognized = recognizeEntryConditionSlot(definition, SLOT_ID);

    expect(recognized).toMatchObject({
      optionId: OPTION_ID,
      parameters: {
        entry_peak_pullback_min: 0.03,
        entry_peak_pullback_max: 0.09,
        entry_max_volume_ratio: 0.5,
        entry_require_bullish: 0,
      },
    });
    expect(entryConditionSlotIsAtDefaults(recognized!, SLOT_ID)).toBe(false);
  });

  it("recognizes off only when the slot namespace is completely absent", () => {
    expect(recognizeEntryConditionSlot(carrier(), SLOT_ID)).toEqual({ optionId: OFF_OPTION_ID, parameters: {}, managedConditionIds: [] });
    const definition = materializedCarrier();
    expect(recognizeEntryConditionSlot(carrier(definition.entry.conditions, []), SLOT_ID)).toBeNull();
    expect(recognizeEntryConditionSlot(carrier([], definition.parameters), SLOT_ID)).toBeNull();
  });

  it("does not fuzzy-match partial or extra slot-owned conditions", () => {
    const definition = materializedCarrier();
    const partial = carrier(definition.entry.conditions.slice(0, 2), definition.parameters);
    expect(recognizeEntryConditionSlot(partial, SLOT_ID)).toBeNull();

    const duplicate = carrier([
      ...definition.entry.conditions.slice(0, 4),
      definition.entry.conditions[0]!,
    ], definition.parameters);
    expect(recognizeEntryConditionSlot(duplicate, SLOT_ID)).toBeNull();

    const extra = carrier([
      ...definition.entry.conditions,
      {
        id: "entry.trend_pullback.extra",
        field: "bar.close",
        operator: "GREATER_THAN",
        value: 0,
        valueType: "CONSTANT",
        enabled: true,
      },
    ], definition.parameters);
    expect(recognizeEntryConditionSlot(extra, SLOT_ID)).toBeNull();
  });
});

describe("ENTRY_CONDITION apply ownership", () => {
  it("applies the slot while preserving manual conditions and parameters exactly", () => {
    const base = carrier([MANUAL_CONDITION], [MANUAL_PARAMETER]);
    const first = applyEntryConditionSlot(base, SLOT_ID, OPTION_ID);
    expect(first.issues).toEqual([]);
    expect(first.conditions[0]).toEqual(MANUAL_CONDITION);
    expect(first.parameters[0]).toEqual(MANUAL_PARAMETER);
    expect(first.conditions.filter((condition) => condition.id?.startsWith("entry.trend_pullback."))).toHaveLength(5);
    expect(first.parameters.filter((parameter) => parameter.code.startsWith("entry_"))).toHaveLength(4);
  });

  it("is idempotent for the same selection", () => {
    const first = applyEntryConditionSlot(carrier([MANUAL_CONDITION], [MANUAL_PARAMETER]), SLOT_ID, OPTION_ID);
    const second = applyEntryConditionSlot(carrier(first.conditions, first.parameters), SLOT_ID, OPTION_ID);
    expect(second.issues).toEqual([]);
    expect(second.conditions).toEqual(first.conditions);
    expect(second.parameters).toEqual(first.parameters);
  });

  it("off removes only the slot-owned content", () => {
    const applied = applyEntryConditionSlot(carrier([MANUAL_CONDITION], [MANUAL_PARAMETER]), SLOT_ID, OPTION_ID);
    const off = applyEntryConditionSlot(carrier(applied.conditions, applied.parameters), SLOT_ID, OFF_OPTION_ID);
    expect(off.issues).toEqual([]);
    expect(off.conditions).toEqual([MANUAL_CONDITION]);
    expect(off.parameters).toEqual([MANUAL_PARAMETER]);
  });

  it("rejects parameter declaration conflicts instead of overwriting them", () => {
    const definition = materializedCarrier();
    const conflicting: ParameterDefinition = {
      ...definition.parameters[0]!,
      parameterRole: "TUNABLE",
    };
    const result = applyEntryConditionSlot(carrier([], [conflicting]), SLOT_ID, OPTION_ID);
    expect(result.parameters).toEqual([conflicting]);
    expect(result.issues.some((issue) => issue.includes("PARAMETER_CONFLICT"))).toBe(true);
  });

  it("rejects rewriting a slot code that is already referenced outside the slot", () => {
    const manualReference: ConditionDefinition = {
      id: "manual-entry-peak-max",
      field: "bar.pullbackFromEventPeakClose",
      operator: "LESS_THAN_OR_EQUAL",
      value: "entry_peak_pullback_max",
      valueType: "PARAMETER_REFERENCE",
      enabled: true,
    };
    const result = applyEntryConditionSlot(carrier([manualReference], []), SLOT_ID, OPTION_ID);
    expect(result.conditions).toEqual([manualReference]);
    expect(result.parameters).toEqual([]);
    expect(result.issues.some((issue) => issue.includes("PARAMETER_REFERENCED"))).toBe(true);
  });
});

describe("ENTRY_CONDITION vocabulary and shared contract", () => {
  it("publishes generic summaries without leaking condition templates", () => {
    const vocabulary = buildStrategyAuthoringVocabulary();
    const group = vocabulary.authoringSlotGroups.find((item) => item.group === "ENTRY_CONDITION")!;
    expect(group.slots.map((slot) => slot.slotId)).toEqual([...ENTRY_CONDITION_SLOT_IDS]);
    const slot = group.slots[0]!;
    expect(slot.options.map((option) => option.optionId)).toEqual([OPTION_ID, OFF_OPTION_ID]);
    expect(JSON.stringify(slot)).not.toContain('"conditions"');
    expect(JSON.stringify(slot)).not.toContain('"patch"');
    expect(buildStrategyAuthoringVocabulary().vocabularyVersion).toBe(vocabulary.vocabularyVersion);
  });

  it("exposes the fail-closed predicate only for entry namespaces", () => {
    expect(hasEntryConditionSlotConditions({ entry: { conditions: [{ id: "entry.trend_pullback.min" }] } })).toBe(true);
    expect(hasEntryConditionSlotConditions({ entry: { conditions: [{ id: "manual" }] } })).toBe(false);
    expect(hasEntryConditionSlotConditions({ entry: { conditions: [{ id: "entry.legacy-condition" }] } })).toBe(false);
    expect(hasEntryConditionSlotConditions(undefined)).toBe(false);
  });
});