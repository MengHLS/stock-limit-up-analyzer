import { describe, expect, it } from "vitest";

import { appRouter } from "../../../../server/routers";
import { STOP_POLICY_EXPERIMENTS } from "../../../../server/research/exitPolicyExperiments";
import { EXIT_POLICY_RULE_ENVELOPE, RECIPE_PRESETS } from "../../../../server/research/strategyAuthoring/presetRegistry";
import {
  EXIT_POLICY_SLOT_IDS,
  exitSlotIsAtDefaults,
  recognizeExitPolicySlot,
} from "../../../../server/research/strategyAuthoring/exitPolicySlots";
import {
  ENTRY_CONDITION_SLOT_IDS,
  recognizeEntryConditionSlot,
  entryConditionSlotIsAtDefaults,
} from "../../../../server/research/strategyAuthoring/entryConditionSlots";
import {
  AUTHORING_SLOT_HANDLERS,
  applyAuthoringSlot,
  listAuthoringSlotGroups,
  recognizeAuthoringSlots,
} from "../../../../server/research/strategyAuthoring/authoringSlotRegistry";
import type { AuthoringTarget } from "../../../../server/research/strategyAuthoring/authoringSlotTypes";
import { buildStrategyAuthoringVocabulary } from "../../../../server/research/strategyAuthoring/vocabulary";
import {
  STRATEGY_EVENT_TYPES,
  STRATEGY_TRIGGER_TYPES,
  type ConditionDefinition,
  type ParameterDefinition,
} from "../../../../server/research/strategySchema/definition";

const baseCtx = { req: {} as never, res: {} as never, user: null };
const publicCaller = appRouter.createCaller(baseCtx);

const EXIT_SLOT = "ANCHOR";
const ENTRY_SLOT = "TREND_PULLBACK_AFTER_FIRST_LIMIT_UP";
const ENTRY_OPTION = "trend-pullback-after-first-limit-up";
const OFF_OPTION = "off";

const MANUAL_CONDITION: ConditionDefinition = {
  id: "manual-keep",
  field: "bar.close",
  operator: "GREATER_THAN",
  value: 0,
  valueType: "CONSTANT",
  enabled: true,
  description: "manual condition must survive generic apply",
};

const MANUAL_PARAMETER: ParameterDefinition = {
  code: "manualParam",
  name: "手工参数",
  dataType: "number",
  parameterRole: "FIXED",
  defaultValue: 1,
  required: true,
  description: "manual parameter must survive generic apply",
};

function target(definition: unknown): AuthoringTarget {
  return {
    recipe: { recipeId: "generic-test" },
    definition,
    executionAssumptions: { backtestConfig: { maxPositions: 5 } },
  };
}

function entryDefinition(): Record<string, unknown> {
  return {
    entry: { conditions: [MANUAL_CONDITION] },
    parameters: [MANUAL_PARAMETER],
    customKey: "keep-me",
  };
}

function exitPolicy() {
  return STOP_POLICY_EXPERIMENTS["SL-00"]!.policy;
}

describe("generic AuthoringSlot registry", () => {
  it("groups all registered slots and keeps global slot ids unique", () => {
    const groups = listAuthoringSlotGroups();
    expect(groups.map((group) => group.group)).toEqual([...AUTHORING_SLOT_HANDLERS.map((handler) => handler.group)]);
    expect(groups.find((group) => group.group === "EXIT_POLICY")!.slots.map((slot) => slot.slotId)).toEqual([...EXIT_POLICY_SLOT_IDS]);
    expect(groups.find((group) => group.group === "ENTRY_CONDITION")!.slots.map((slot) => slot.slotId)).toEqual([...ENTRY_CONDITION_SLOT_IDS]);

    const ids = groups.flatMap((group) => group.slots.map((slot) => slot.slotId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("vocabulary publishes generic groups without exit patches or entry condition templates", () => {
    const vocabulary = buildStrategyAuthoringVocabulary();
    expect(vocabulary.authoringSlotGroups).toEqual(listAuthoringSlotGroups());
    const serialized = JSON.stringify(vocabulary.authoringSlotGroups);
    expect(serialized).not.toContain('"patch"');
    expect(serialized).not.toContain('"conditions"');
  });

});

describe("EXIT generic adapter", () => {
  it("uses the registered SL-00 base policy when the definition has no policy", () => {
    const definition = { exit: { rules: [{ id: "other", type: "STOP_LOSS", trigger: "ON_CLOSE", priority: 1, enabled: true }] } };
    const recognitions = recognizeAuthoringSlots(target(definition)).slots.filter((slot) => slot.group === "EXIT_POLICY");

    for (const slotId of EXIT_POLICY_SLOT_IDS) {
      const expected = recognizeExitPolicySlot(exitPolicy(), slotId);
      const actual = recognitions.find((slot) => slot.slotId === slotId)!;
      expect(actual.optionId).toBe(expected?.optionId ?? null);
      expect(actual.parameters).toEqual(expected?.parameters ?? {});
      expect(actual.atDefaults).toBe(expected === null ? false : exitSlotIsAtDefaults(expected, slotId));
    }
  });

  it("writes the unified policy rule while preserving sibling rules and complete target fields", () => {
    const sibling = { id: "other", type: "STOP_LOSS", trigger: "ON_CLOSE", priority: 1, enabled: true, custom: "keep" };
    const definition = { customDefinition: "keep", exit: { rules: [sibling] } };
    const input = target(definition);
    const result = applyAuthoringSlot(input, EXIT_SLOT, "fixed-percent", { stopRatio: 0.07 });

    expect(result.issues).toEqual([]);
    expect(result.recipe).toEqual(input.recipe);
    expect(result.executionAssumptions).toEqual(input.executionAssumptions);
    const nextDefinition = result.definition as any;
    expect(nextDefinition.customDefinition).toBe("keep");
    expect(nextDefinition.exit.rules).toHaveLength(2);
    expect(nextDefinition.exit.rules[0]).toMatchObject({
      id: EXIT_POLICY_RULE_ENVELOPE.id,
      policy: { stop: { anchor: { kind: "FIXED_PERCENT", stopRatio: 0.07 } } },
    });
    expect(nextDefinition.exit.rules[1]).toEqual(sibling);
  });

  it("returns the original target when an option or parameter is unknown", () => {
    const input = target({ exit: { rules: [{ ...EXIT_POLICY_RULE_ENVELOPE, policy: exitPolicy() }] } });
    const unknownOption = applyAuthoringSlot(input, EXIT_SLOT, "does-not-exist", {});
    const unknownParameter = applyAuthoringSlot(input, EXIT_SLOT, "fixed-percent", { nope: 1 });

    expect(unknownOption.issues.some((issue) => issue.includes("AUTHORING_OPTION_UNKNOWN"))).toBe(true);
    expect(unknownOption.definition).toBe(input.definition);
    expect(unknownParameter.issues.some((issue) => issue.includes("未声明参数"))).toBe(true);
    expect(unknownParameter.definition).toBe(input.definition);
  });
});

describe("ENTRY generic adapter", () => {
  it("writes entry.conditions and parameters while preserving manual content", () => {
    const input = target(entryDefinition());
    const result = applyAuthoringSlot(input, ENTRY_SLOT, ENTRY_OPTION, {});

    expect(result.issues).toEqual([]);
    expect(result.recipe).toEqual(input.recipe);
    expect(result.executionAssumptions).toEqual(input.executionAssumptions);
    const definition = result.definition as any;
    expect(definition.customKey).toBe("keep-me");
    expect(definition.entry.conditions[0]).toEqual(MANUAL_CONDITION);
    expect(definition.entry.conditions.filter((condition: any) => condition.id?.startsWith("entry.trend_pullback."))).toHaveLength(5);
    expect(definition.parameters[0]).toEqual(MANUAL_PARAMETER);
    expect(definition.parameters.map((parameter: any) => parameter.code)).toEqual(expect.arrayContaining([
      "manualParam",
      "entry_peak_pullback_min",
      "entry_peak_pullback_max",
      "entry_max_volume_ratio",
      "entry_require_bullish",
    ]));
  });

  it("recognizes managedConditionIds and supports off without removing manual conditions", () => {
    const applied = applyAuthoringSlot(target(entryDefinition()), ENTRY_SLOT, ENTRY_OPTION, {});
    const recognition = recognizeAuthoringSlots(applied).slots.find((slot) => slot.slotId === ENTRY_SLOT)!;
    expect(recognition.optionId).toBe(ENTRY_OPTION);
    expect(recognition.managedConditionIds).toEqual([
      "entry.trend_pullback.min",
      "entry.trend_pullback.max",
      "entry.trend_pullback.trend",
      "entry.trend_pullback.volume",
      "entry.trend_pullback.bullish",
    ]);

    const off = applyAuthoringSlot(applied, ENTRY_SLOT, OFF_OPTION, {});
    expect(off.issues).toEqual([]);
    const definition = off.definition as any;
    expect(definition.entry.conditions).toEqual([MANUAL_CONDITION]);
    expect(definition.parameters).toEqual([MANUAL_PARAMETER]);
  });

  it("returns the original target for unknown slot, option, and parameter", () => {
    const input = target(entryDefinition());
    const unknownSlot = applyAuthoringSlot(input, "NOPE", ENTRY_OPTION, {});
    const unknownOption = applyAuthoringSlot(input, ENTRY_SLOT, "NOPE", {});
    const unknownParameter = applyAuthoringSlot(input, ENTRY_SLOT, ENTRY_OPTION, { nope: 1 });

    expect(unknownSlot.issues[0]).toContain("AUTHORING_SLOT_UNKNOWN");
    expect(unknownOption.issues[0]).toContain("AUTHORING_OPTION_UNKNOWN");
    expect(unknownParameter.issues[0]).toContain("ENTRY_CONDITION_PARAMETER_UNKNOWN");
    expect(unknownSlot.definition).toBe(input.definition);
    expect(unknownOption.definition).toBe(input.definition);
    expect(unknownParameter.definition).toBe(input.definition);
  });
});

describe("generic router endpoints", () => {
  it("recognize/apply return complete fragments through the public tRPC surface", async () => {
    const input = target(entryDefinition());
    const recognized = await publicCaller.strategyDomain.authoring.recognizeAuthoringSlots({ target: input });
    expect(recognized.slots.some((slot) => slot.group === "ENTRY_CONDITION" && slot.slotId === ENTRY_SLOT)).toBe(true);

    const applied = await publicCaller.strategyDomain.authoring.applyAuthoringSlot({
      target: input,
      slotId: ENTRY_SLOT,
      optionId: ENTRY_OPTION,
      parameters: {},
    });
    expect(applied.issues).toEqual([]);
    expect(applied.recipe).toEqual(input.recipe);
    expect(applied.executionAssumptions).toEqual(input.executionAssumptions);
    expect((applied.definition as any).entry.conditions).toHaveLength(6);
  });
});
describe("generic shared contract", () => {
  it("keeps shared group schema in sync with the registry", async () => {
    const shared = await import("../../../../shared/researchContracts");
    expect(shared.authoringSlotGroupSchema.options).toEqual(AUTHORING_SLOT_HANDLERS.map((handler) => handler.group));
    expect(shared.recognizeAuthoringSlotsInputSchema.safeParse({
      target: target(entryDefinition()),
    }).success).toBe(true);
    expect(shared.applyAuthoringSlotInputSchema.safeParse({
      target: target(entryDefinition()),
      slotId: ENTRY_SLOT,
      optionId: ENTRY_OPTION,
      parameters: {},
    }).success).toBe(true);
    expect(shared.applyAuthoringSlotInputSchema.safeParse({
      target: target(entryDefinition()),
      slotId: "",
      optionId: ENTRY_OPTION,
      parameters: {},
    }).success).toBe(false);
  });

  it("keeps exact recognition helpers available to adapters", () => {
    const definition = entryDefinition();
    expect(recognizeEntryConditionSlot(definition, ENTRY_SLOT)).toEqual({
      optionId: OFF_OPTION,
      parameters: {},
      managedConditionIds: [],
    });
    expect(entryConditionSlotIsAtDefaults({ optionId: OFF_OPTION, parameters: {}, managedConditionIds: [] }, ENTRY_SLOT)).toBe(true);
  });
});
function positionCostTarget(): any {
  return {
    recipe: { recipeId: "position-cost-test" },
    definition: {
      customDefinitionKey: "keep-definition",
      position: {
        sizingMethod: "FIXED_RATIO",
        positionRatio: 0.2,
        maxPositions: 7,
        maxExposure: 0.8,
        customPositionKey: "keep-position",
      },
      execution: {
        signalTiming: "T_CLOSE",
        executionTiming: "T_PLUS_1_OPEN",
        priceType: "OPEN",
        quantityMethod: "AMOUNT",
        lotSize: 100,
        slippageModel: "BPS",
        commissionModel: "BPS",
        customExecutionKey: "keep-execution",
      },
    },
    executionAssumptions: {
      customAssumptionKey: "keep-assumptions",
      executionModel: "NEXT_OPEN",
      costModel: {
        commissionRate: 0.0003,
        stampDutyRate: 0.001,
        transferFeeRate: 0.00001,
        slippageBps: 10,
        lotSize: 100,
        minCommission: 5,
        customCostKey: "keep-cost",
      },
      backtestConfig: {
        initialCapital: 1000000,
        maxPositions: 7,
        maxDailyBuys: 2,
        customBacktestKey: "keep-backtest",
      },
    },
  };
}

function groupSlots(group: "POSITION" | "COST") {
  return listAuthoringSlotGroups().find((item) => item.group === group)?.slots ?? [];
}

describe("POSITION / COST generic adapters", () => {
  it("registers only executable position/cost slots and hides non-executable fields", () => {
    expect(groupSlots("POSITION").map((slot) => slot.slotId)).toEqual(["POSITION_SIZING", "MAX_POSITIONS"]);
    expect(groupSlots("COST").map((slot) => slot.slotId)).toEqual(["COST_MODEL", "EXECUTION_TIMING", "PRICE_TYPE"]);

    const positionCodes = groupSlots("POSITION")
      .flatMap((slot) => slot.options.flatMap((option) => option.parameters.map((parameter) => parameter.code)));
    expect(positionCodes).not.toContain("maxExposure");
    expect(positionCodes).not.toContain("maxSinglePosition");

    const sizingCodes = groupSlots("POSITION")[0]!.options
      .flatMap((option) => option.parameters.map((parameter) => parameter.code));
    expect(sizingCodes).not.toContain("maxPositions");
    const maxPositionsCodes = groupSlots("POSITION")[1]!.options
      .flatMap((option) => option.parameters.map((parameter) => parameter.code));
    expect(maxPositionsCodes).toContain("maxPositions");

    const costModelCodes = groupSlots("COST")[0]!.options
      .flatMap((option) => option.parameters.map((parameter) => parameter.code));
    expect(costModelCodes).toEqual(expect.arrayContaining([
      "initialCapital",
      "commissionRate",
      "stampDutyRate",
      "transferFeeRate",
      "slippageBps",
      "lotSize",
      "minCommission",
    ]));
    expect(costModelCodes).not.toContain("signalTiming");
    expect(costModelCodes).not.toContain("executionTiming");
    expect(costModelCodes).not.toContain("priceType");
    const allCostCodes = groupSlots("COST")
      .flatMap((slot) => slot.options.flatMap((option) => option.parameters.map((parameter) => parameter.code)));
    expect(allCostCodes).not.toContain("slippageModel");
    expect(allCostCodes).not.toContain("commissionModel");
    expect(allCostCodes).not.toContain("quantityMethod");
  });

  it("applies all four position-sizing options and never overwrites maxPositions", () => {
    const cases = [
      { optionId: "fixed-ratio-20", parameters: { positionRatio: 0.3 }, method: "FIXED_RATIO", field: "positionRatio", value: 0.3 },
      { optionId: "equal-weight", parameters: {}, method: "EQUAL_WEIGHT", field: null, value: null },
      { optionId: "fixed-amount-100k", parameters: { fixedAmount: 120000 }, method: "FIXED_AMOUNT", field: "fixedAmount", value: 120000 },
      { optionId: "equity-ratio-10", parameters: { positionRatio: 0.15 }, method: "EQUITY_RATIO", field: "positionRatio", value: 0.15 },
    ] as const;

    for (const testCase of cases) {
      const input = positionCostTarget();
      const result = applyAuthoringSlot(input, "POSITION_SIZING", testCase.optionId, testCase.parameters);
      expect(result.issues).toEqual([]);
      const position = (result.definition as any).position;
      expect(position.sizingMethod).toBe(testCase.method);
      expect(position.maxPositions).toBe(7);
      expect(position.maxExposure).toBe(0.8);
      expect(position.customPositionKey).toBe("keep-position");
      if (testCase.field === null) {
        expect(position.positionRatio).toBeUndefined();
        expect(position.fixedAmount).toBeUndefined();
      } else {
        expect(position[testCase.field]).toBe(testCase.value);
        expect(testCase.field === "positionRatio" ? position.fixedAmount : position.positionRatio).toBeUndefined();
      }
      if (testCase.optionId !== "equal-weight") {
        const recognition = recognizeAuthoringSlots(result).slots.find((slot) => slot.slotId === "POSITION_SIZING")!;
        expect(recognition.optionId).toBe(testCase.optionId);
        expect(recognition.parameters).toEqual(testCase.parameters);
      }
    }
  });

  it("double-writes MAX_POSITIONS, detects conflicts, and preserves unrelated keys", () => {
    const input = positionCostTarget();
    const recognized = recognizeAuthoringSlots(input).slots.find((slot) => slot.slotId === "MAX_POSITIONS")!;
    expect(recognized.optionId).toBe("max-positions");
    expect(recognized.parameters).toEqual({ maxPositions: 7 });

    const applied = applyAuthoringSlot(input, "MAX_POSITIONS", "max-positions", { maxPositions: 9 });
    expect(applied.issues).toEqual([]);
    expect((applied.definition as any).position.maxPositions).toBe(9);
    expect((applied.executionAssumptions as any).backtestConfig.maxPositions).toBe(9);
    expect((applied.definition as any).position.maxExposure).toBe(0.8);
    expect((applied.executionAssumptions as any).backtestConfig.maxDailyBuys).toBe(2);
    expect((applied.executionAssumptions as any).customAssumptionKey).toBe("keep-assumptions");

    input.definition.position.maxPositions = 6;
    const conflict = recognizeAuthoringSlots(input).slots.find((slot) => slot.slotId === "MAX_POSITIONS")!;
    expect(conflict.optionId).toBeNull();
    expect(conflict.managedPaths).toEqual([
      "definition.position.maxPositions",
      "executionAssumptions.backtestConfig.maxPositions",
    ]);
  });

  it("applies COST_MODEL only to real cost fields and preserves execution model declarations", () => {
    const input = positionCostTarget();
    const result = applyAuthoringSlot(input, "COST_MODEL", "a-share-standard-open-1m", {});
    expect(result.issues).toEqual([]);

    const assumptions = result.executionAssumptions as any;
    expect(assumptions.costModel).toMatchObject({
      commissionRate: 0.0003,
      stampDutyRate: 0.001,
      transferFeeRate: 0.00001,
      slippageBps: 10,
      lotSize: 100,
      minCommission: 5,
      customCostKey: "keep-cost",
    });
    expect(assumptions.backtestConfig.initialCapital).toBe(1000000);
    expect(assumptions.backtestConfig.maxPositions).toBe(7);
    expect(assumptions.backtestConfig.customBacktestKey).toBe("keep-backtest");
    expect(assumptions.customAssumptionKey).toBe("keep-assumptions");
    expect((result.definition as any).execution).toMatchObject({
      slippageModel: "BPS",
      commissionModel: "BPS",
      quantityMethod: "AMOUNT",
      customExecutionKey: "keep-execution",
    });

    const recognized = recognizeAuthoringSlots(result).slots.find((slot) => slot.slotId === "COST_MODEL")!;
    expect(recognized.optionId).toBe("a-share-standard-open-1m");
    expect(recognized.atDefaults).toBe(true);
  });

  it("applies EXECUTION_TIMING and PRICE_TYPE only to their owned execution fields", () => {
    const input = positionCostTarget();
    const timed = applyAuthoringSlot(input, "EXECUTION_TIMING", "t-close-to-t-plus-1-close", {});
    expect(timed.issues).toEqual([]);
    expect((timed.definition as any).execution).toMatchObject({
      signalTiming: "T_CLOSE",
      executionTiming: "T_PLUS_1_CLOSE",
      priceType: "OPEN",
      quantityMethod: "AMOUNT",
      slippageModel: "BPS",
    });

    const priced = applyAuthoringSlot(timed, "PRICE_TYPE", "price-type", { priceType: "VWAP" });
    expect(priced.issues).toEqual([]);
    expect((priced.definition as any).execution).toMatchObject({
      signalTiming: "T_CLOSE",
      executionTiming: "T_PLUS_1_CLOSE",
      priceType: "VWAP",
      quantityMethod: "AMOUNT",
      slippageModel: "BPS",
    });
    expect((priced.definition as any).execution.customExecutionKey).toBe("keep-execution");
  });

  it("returns the original complete target for unknown option or parameter", () => {
    const input = positionCostTarget();
    const unknownOption = applyAuthoringSlot(input, "POSITION_SIZING", "unknown", {});
    expect(unknownOption.issues[0]).toContain("AUTHORING_OPTION_UNKNOWN");
    expect(unknownOption.definition).toBe(input.definition);
    expect(unknownOption.executionAssumptions).toBe(input.executionAssumptions);

    const unknownParameter = applyAuthoringSlot(input, "COST_MODEL", "a-share-standard-open-1m", { nope: 1 });
    expect(unknownParameter.issues[0]).toContain("AUTHORING_PARAMETER_UNKNOWN");
    expect(unknownParameter.definition).toBe(input.definition);
    expect(unknownParameter.executionAssumptions).toBe(input.executionAssumptions);
  });
});
function selectionDefinition(): any {
  return {
    customDefinitionKey: "keep-definition",
    entry: {
      event: {
        type: "FIRST_LIMIT_UP",
        params: { limitUpRatio: 0.1, customParam: "keep-event" },
        description: "keep-event-description",
      },
      observationWindow: {
        start: 1,
        end: 5,
        unit: "TRADING_DAY",
        customWindowKey: "keep-window",
      },
      conditions: [MANUAL_CONDITION],
      trigger: {
        type: "FIRST_VALID_DAY",
        params: { customTriggerParam: "keep-trigger" },
        description: "keep-trigger-description",
      },
    },
  };
}

function selectionTarget(): AuthoringTarget {
  return {
    recipe: RECIPE_PRESETS[0]!.payload,
    definition: selectionDefinition(),
    executionAssumptions: { customAssumptionKey: "keep-assumptions" },
  };
}

function selectionSlot(slotId: string) {
  return listAuthoringSlotGroups()
    .find((group) => group.group === "SELECTION")!
    .slots.find((slot) => slot.slotId === slotId)!;
}

function recognizedSelectionSlot(target: AuthoringTarget, slotId: string) {
  return recognizeAuthoringSlots(target).slots.find((slot) => slot.slotId === slotId)!;
}

describe("SELECTION generic adapters", () => {
  it("registers the SELECTION slot set and publishes only option metadata", () => {
    expect(listAuthoringSlotGroups().map((group) => group.group)).toEqual([
      "SELECTION",
      "EXIT_POLICY",
      "ENTRY_CONDITION",
      "POSITION",
      "COST",
    ]);
    expect(selectionSlot("SIGNAL_RECIPE").options.map((option) => option.optionId)).toEqual([
      ...RECIPE_PRESETS.map((preset) => preset.presetId),
      "off",
    ]);
    expect(selectionSlot("EVENT").options.map((option) => option.optionId)).toEqual([...STRATEGY_EVENT_TYPES]);
    expect(selectionSlot("OBSERVATION").options.map((option) => option.optionId)).toEqual([
      "t-plus-1-to-5",
      "t-plus-1-to-10",
      "t-plus-2-to-5",
      "custom",
    ]);
    expect(selectionSlot("TRIGGER").options.map((option) => option.optionId)).toEqual([...STRATEGY_TRIGGER_TYPES]);

    const serialized = JSON.stringify(buildStrategyAuthoringVocabulary().authoringSlotGroups);
    expect(serialized).not.toContain('"patch"');
    expect(serialized).not.toContain('"payload"');
    expect(serialized).not.toContain('"conditions"');
  });

  it("recognizes, applies, and clears SIGNAL_RECIPE without mutating other target fragments", () => {
    const preset = RECIPE_PRESETS[0]!;
    const base: AuthoringTarget = {
      recipe: null,
      definition: { customDefinitionKey: "keep-definition" },
      executionAssumptions: { customAssumptionKey: "keep-assumptions" },
    };

    expect(recognizedSelectionSlot(base, "SIGNAL_RECIPE")).toMatchObject({
      optionId: "off",
      atDefaults: true,
      managedPaths: ["recipe"],
    });

    const applied = applyAuthoringSlot(base, "SIGNAL_RECIPE", preset.presetId, {});
    expect(applied.issues).toEqual([]);
    expect(applied.recipe).toEqual(preset.payload);
    expect(applied.recipe).not.toBe(preset.payload);
    expect(applied.definition).toBe(base.definition);
    expect(applied.executionAssumptions).toBe(base.executionAssumptions);

    const recognized = recognizedSelectionSlot(applied, "SIGNAL_RECIPE");
    expect(recognized.optionId).toBe(preset.presetId);
    expect(recognized.parameters).toEqual({});
    expect(recognized.atDefaults).toBe(true);

    const mismatched = {
      ...base,
      recipe: { ...(preset.payload as Record<string, unknown>), recipeId: "not-registered" },
    };
    expect(recognizedSelectionSlot(mismatched, "SIGNAL_RECIPE").optionId).toBeNull();

    const cleared = applyAuthoringSlot(applied, "SIGNAL_RECIPE", "off", {});
    expect(cleared.issues).toEqual([]);
    expect(cleared.recipe).toBeNull();
    expect(cleared.definition).toBe(applied.definition);
    expect(cleared.executionAssumptions).toBe(applied.executionAssumptions);
    expect(recognizedSelectionSlot(cleared, "SIGNAL_RECIPE").optionId).toBe("off");
  });

  it("applies EVENT type and owned params while preserving descriptions and unknown params", () => {
    const input = selectionTarget();
    const applied = applyAuthoringSlot(input, "EVENT", "FIRST_LIMIT_UP", { limitUpRatio: 0.2 });
    expect(applied.issues).toEqual([]);
    expect(applied.recipe).toBe(input.recipe);
    expect(applied.executionAssumptions).toBe(input.executionAssumptions);
    const event = (applied.definition as any).entry.event;
    expect(event.type).toBe("FIRST_LIMIT_UP");
    expect(event.description).toBe("keep-event-description");
    expect(event.params).toMatchObject({ limitUpRatio: 0.2, customParam: "keep-event" });

    const recognized = recognizedSelectionSlot(applied, "EVENT");
    expect(recognized.optionId).toBe("FIRST_LIMIT_UP");
    expect(recognized.parameters).toEqual({ limitUpRatio: 0.2 });
    expect(recognized.atDefaults).toBe(false);
    expect(recognized.managedPaths).toEqual([
      "definition.entry.event.type",
      "definition.entry.event.params",
    ]);

    const missingOwnedParam = selectionTarget();
    (missingOwnedParam.definition as any).entry.event.params = { customParam: "keep-event" };
    expect(recognizedSelectionSlot(missingOwnedParam, "EVENT").optionId).toBeNull();

    const custom = applyAuthoringSlot(input, "EVENT", "CUSTOM_EVENT", { eventCode: "manual-pattern" });
    expect(custom.issues).toEqual([]);
    const customEvent = (custom.definition as any).entry.event;
    expect(customEvent.type).toBe("CUSTOM_EVENT");
    expect(customEvent.params).toMatchObject({ eventCode: "manual-pattern", customParam: "keep-event" });
    expect(customEvent.params.limitUpRatio).toBeUndefined();

    const unknownParameter = applyAuthoringSlot(input, "EVENT", "FIRST_LIMIT_UP", { nope: 1 });
    expect(unknownParameter.issues[0]).toContain("AUTHORING_PARAMETER_UNKNOWN");
    expect(unknownParameter.definition).toBe(input.definition);
  });

  it("applies OBSERVATION presets and custom windows, then rejects invalid windows", () => {
    const input = selectionTarget();
    const preset = applyAuthoringSlot(input, "OBSERVATION", "t-plus-2-to-5", {});
    expect(preset.issues).toEqual([]);
    expect((preset.definition as any).entry.observationWindow).toEqual({
      start: 2,
      end: 5,
      unit: "TRADING_DAY",
      customWindowKey: "keep-window",
    });
    expect(recognizedSelectionSlot(preset, "OBSERVATION").optionId).toBe("t-plus-2-to-5");

    const customInput = selectionTarget();
    (customInput.definition as any).entry.observationWindow = {
      start: 2,
      end: 8,
      unit: "CALENDAR_DAY",
      customWindowKey: "keep-window",
    };
    const customRecognition = recognizedSelectionSlot(customInput, "OBSERVATION");
    expect(customRecognition.optionId).toBe("custom");
    expect(customRecognition.parameters).toEqual({ start: 2, end: 8, unit: "CALENDAR_DAY" });
    expect(customRecognition.atDefaults).toBe(false);

    const custom = applyAuthoringSlot(customInput, "OBSERVATION", "custom", {
      start: 3,
      end: 9,
      unit: "TRADING_DAY",
    });
    expect(custom.issues).toEqual([]);
    expect((custom.definition as any).entry.observationWindow).toEqual({
      start: 3,
      end: 9,
      unit: "TRADING_DAY",
      customWindowKey: "keep-window",
    });
    expect(recognizedSelectionSlot(custom, "OBSERVATION").optionId).toBe("custom");

    const invalid = selectionTarget();
    (invalid.definition as any).entry.observationWindow = { start: 0, end: 5, unit: "TRADING_DAY" };
    expect(recognizedSelectionSlot(invalid, "OBSERVATION").optionId).toBeNull();

    const invalidInput = selectionTarget();
    const invalidApply = applyAuthoringSlot(invalidInput, "OBSERVATION", "custom", {
      start: 0,
      end: 5,
      unit: "TRADING_DAY",
    });
    expect(invalidApply.issues.some((issue) => issue.includes("AUTHORING_PARAMETER_RANGE"))).toBe(true);
    expect(invalidApply.definition).toBe(invalidInput.definition);
  });

  it("applies and recognizes TRIGGER types while preserving trigger params", () => {
    const input = selectionTarget();
    const applied = applyAuthoringSlot(input, "TRIGGER", "LAST_VALID_DAY", {});
    expect(applied.issues).toEqual([]);
    expect(applied.recipe).toBe(input.recipe);
    expect(applied.executionAssumptions).toBe(input.executionAssumptions);
    expect((applied.definition as any).entry.trigger).toEqual({
      type: "LAST_VALID_DAY",
      params: { customTriggerParam: "keep-trigger" },
      description: "keep-trigger-description",
    });

    const recognized = recognizedSelectionSlot(applied, "TRIGGER");
    expect(recognized.optionId).toBe("LAST_VALID_DAY");
    expect(recognized.parameters).toEqual({});
    expect(recognized.atDefaults).toBe(true);
    expect(recognized.managedPaths).toEqual(["definition.entry.trigger.type"]);

    const invalid = selectionTarget();
    (invalid.definition as any).entry.trigger.type = "not-a-trigger";
    expect(recognizedSelectionSlot(invalid, "TRIGGER").optionId).toBeNull();
  });
});
