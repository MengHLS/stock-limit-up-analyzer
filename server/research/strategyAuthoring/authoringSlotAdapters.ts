/**
 * 现有 EXIT_POLICY / ENTRY_CONDITION 的通用 AuthoringSlot 适配器。
 *
 * 适配器不改写两侧的业务语义：
 *   - EXIT_POLICY 继续调用 exitPolicySlots.ts 的 recognize / apply；
 *   - ENTRY_CONDITION 继续调用 entryConditionSlots.ts 的 recognize / apply。
 * 本文件只负责定位完整 definition 中的片段、调用旧实现，并把结果写回完整片段。
 */
import { STOP_POLICY_EXPERIMENTS } from "../exitPolicyExperiments";
import type { ExitPolicyDefinition } from "../exitPolicyCommon";
import { EXIT_POLICY_RULE_ENVELOPE } from "./presetRegistry";
import {
  EXIT_POLICY_SLOT_IDS,
  applyExitPolicySlot,
  exitSlotIsAtDefaults,
  findExitPolicySlot,
  findExitPolicySlotOption,
  recognizeExitPolicySlot,
  type ExitPolicySlotDefinition,
  type ExitPolicySlotId,
} from "./exitPolicySlots";
import {
  ENTRY_CONDITION_SLOT_IDS,
  applyEntryConditionSlot,
  entryConditionSlotIsAtDefaults,
  findEntryConditionSlot,
  findEntryConditionSlotOption,
  recognizeEntryConditionSlot,
  type EntryConditionSlotDefinition,
  type EntryConditionSlotDefinitionCarrier,
} from "./entryConditionSlots";
import type { StrategyPresetParameter, StrategyPresetParameterValue } from "./presetRegistry";
import { POSITION_COST_AUTHORING_SLOT_HANDLERS } from "./positionCostAdapters";
import { SELECTION_AUTHORING_SLOT_HANDLERS } from "./selectionAdapters";
import type {
  AuthoringApplyResult,
  AuthoringParameterValue,
  AuthoringParameters,
  AuthoringRecognitionItem,
  AuthoringSlotHandler,
  AuthoringSlotOptionSummary,
  AuthoringSlotSummary,
  AuthoringTarget,
} from "./authoringSlotTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExitPolicy(value: unknown): value is ExitPolicyDefinition {
  return isRecord(value) && isRecord(value.stop);
}

function isEntryConditionCarrier(value: unknown): value is EntryConditionSlotDefinitionCarrier {
  if (!isRecord(value)) return false;
  const entry = value.entry;
  return isRecord(entry) && Array.isArray(entry.conditions) && Array.isArray(value.parameters);
}

/** 把独立 policy 包装成通用 target，仅供兼容旧退出端点使用。 */
export function exitPolicyAuthoringTarget(policy: unknown): AuthoringTarget {
  return {
    recipe: null,
    definition: {
      exit: {
        rules: [{ ...EXIT_POLICY_RULE_ENVELOPE, policy }],
      },
    },
    executionAssumptions: {},
  };
}

/**
 * 从完整 definition 找第一份 policy 载体。
 *
 * 返回 `unknown | null` 而不是已校验类型：调用方必须区分「没有 policy」与
 * 「有 policy 但形状非法」。前者才允许落到 SL-00 base；后者必须保持 unrecognized。
 */
export function exitPolicyFromDefinition(definition: unknown): unknown | null {
  if (!isRecord(definition) || !isRecord(definition.exit) || !Array.isArray(definition.exit.rules)) return null;
  for (const rule of definition.exit.rules) {
    if (isRecord(rule) && isRecord(rule.policy)) return rule.policy;
  }
  return null;
}

function baseExitPolicy(): ExitPolicyDefinition | null {
  const policy = STOP_POLICY_EXPERIMENTS["SL-00"]?.policy;
  return policy !== undefined && isExitPolicy(policy) ? policy : null;
}

/** 保留其它 rule 的顺序和 rule 扩展键，把统一 policy 写回 definition.exit.rules。 */
export function definitionWithExitPolicy(
  definition: unknown,
  policy: ExitPolicyDefinition,
): { readonly definition: unknown; readonly issues: readonly string[] } {
  if (!isRecord(definition)) {
    return { definition, issues: ["AUTHORING_DEFINITION_INVALID: definition 必须是对象"] };
  }
  if (definition.exit !== undefined && !isRecord(definition.exit)) {
    return { definition, issues: ["AUTHORING_EXIT_INVALID: definition.exit 必须是对象"] };
  }

  const exit = isRecord(definition.exit) ? { ...definition.exit } : {};
  const rules = Array.isArray(exit.rules) ? [...exit.rules] : [];
  const ruleId = EXIT_POLICY_RULE_ENVELOPE.id;
  const existingIndex = rules.findIndex((rule) => isRecord(rule) && rule.id === ruleId);
  const nextRule = existingIndex >= 0 && isRecord(rules[existingIndex])
    ? { ...rules[existingIndex], ...EXIT_POLICY_RULE_ENVELOPE, policy }
    : { ...EXIT_POLICY_RULE_ENVELOPE, policy };

  if (existingIndex >= 0) rules[existingIndex] = nextRule;
  else rules.unshift(nextRule);

  return {
    definition: { ...definition, exit: { ...exit, rules } },
    issues: [],
  };
}

function exitSlotSummary(slot: ExitPolicySlotDefinition): AuthoringSlotSummary {
  return {
    slotId: slot.slotId,
    label: slot.label,
    question: slot.question,
    visibility: slot.visibility,
    options: slot.options.map((option): AuthoringSlotOptionSummary => ({
      optionId: option.optionId,
      displayName: option.displayName,
      summary: option.summary,
      parameters: option.parameters,
    })),
  };
}

function entrySlotSummary(slot: EntryConditionSlotDefinition): AuthoringSlotSummary {
  return {
    slotId: slot.slotId,
    label: slot.label,
    question: slot.question,
    visibility: slot.visibility,
    options: slot.options.map((option): AuthoringSlotOptionSummary => ({
      optionId: option.optionId,
      displayName: option.displayName,
      summary: option.summary,
      parameters: option.parameters.map((parameter): StrategyPresetParameter => ({
        code: parameter.code,
        label: parameter.name,
        description: parameter.description ?? "",
        path: parameter.code,
        valueType: parameter.dataType === "number" ? "number" : parameter.dataType === "boolean" ? "boolean" : "string",
        ...(parameter.unit !== undefined ? { unit: parameter.unit } : {}),
        ...(parameter.min !== undefined ? { min: parameter.min } : {}),
        ...(parameter.max !== undefined ? { max: parameter.max } : {}),
        ...(parameter.step !== undefined ? { step: parameter.step } : {}),
        ...(parameter.allowedValues !== undefined ? { allowedValues: parameter.allowedValues } : {}),
        required: parameter.required,
        defaultValue: (parameter.defaultValue ?? 0) as StrategyPresetParameterValue,
      })),
    })),
  };
}

function exitSummaries(): readonly AuthoringSlotSummary[] {
  return EXIT_POLICY_SLOT_IDS.map((slotId) => exitSlotSummary(findExitPolicySlot(slotId)));
}

function entrySummaries(): readonly AuthoringSlotSummary[] {
  return ENTRY_CONDITION_SLOT_IDS.map((slotId) => entrySlotSummary(findEntryConditionSlot(slotId)));
}

function exitRecognition(
  target: AuthoringTarget,
): readonly AuthoringRecognitionItem[] {
  const candidate = exitPolicyFromDefinition(target.definition);
  const policy = candidate === null ? baseExitPolicy() : (isExitPolicy(candidate) ? candidate : null);
  return EXIT_POLICY_SLOT_IDS.map((slotId): AuthoringRecognitionItem => {
    if (policy === null) {
      return {
        group: "EXIT_POLICY",
        slotId,
        optionId: null,
        parameters: {},
        atDefaults: false,
        managedPaths: ["exit.rules[].policy"],
      };
    }
    try {
      const recognized = recognizeExitPolicySlot(policy, slotId);
      if (recognized === null) {
        return {
          group: "EXIT_POLICY",
          slotId,
          optionId: null,
          parameters: {},
          atDefaults: false,
          managedPaths: ["exit.rules[].policy"],
        };
      }
      return {
        group: "EXIT_POLICY",
        slotId,
        optionId: recognized.optionId,
        parameters: recognized.parameters,
        atDefaults: exitSlotIsAtDefaults(recognized, slotId),
        managedPaths: ["exit.rules[].policy"],
      };
    } catch {
      return {
        group: "EXIT_POLICY",
        slotId,
        optionId: null,
        parameters: {},
        atDefaults: false,
        managedPaths: ["exit.rules[].policy"],
      };
    }
  });
}

function entryRecognition(
  target: AuthoringTarget,
): readonly AuthoringRecognitionItem[] {
  return ENTRY_CONDITION_SLOT_IDS.map((slotId): AuthoringRecognitionItem => {
    if (!isEntryConditionCarrier(target.definition)) {
      return { group: "ENTRY_CONDITION", slotId, optionId: null, parameters: {}, atDefaults: false };
    }
    try {
      const recognized = recognizeEntryConditionSlot(target.definition, slotId);
      if (recognized === null) {
        return { group: "ENTRY_CONDITION", slotId, optionId: null, parameters: {}, atDefaults: false };
      }
      return {
        group: "ENTRY_CONDITION",
        slotId,
        optionId: recognized.optionId,
        parameters: recognized.parameters,
        atDefaults: entryConditionSlotIsAtDefaults(recognized, slotId),
        managedConditionIds: recognized.managedConditionIds,
      };
    } catch {
      return { group: "ENTRY_CONDITION", slotId, optionId: null, parameters: {}, atDefaults: false };
    }
  });
}

function issueResult(target: AuthoringTarget, issues: readonly string[]): AuthoringApplyResult {
  return { ...target, issues: [...issues] };
}

function normalizeParameters(
  parameters: AuthoringParameters,
): Readonly<Record<string, StrategyPresetParameterValue>> {
  return Object.fromEntries(
    Object.entries(parameters).map(([code, value]): [string, AuthoringParameterValue] => [code, value]),
  );
}

export const exitAuthoringSlotHandler: AuthoringSlotHandler = {
  group: "EXIT_POLICY",
  label: "出场",
  summaries: exitSummaries(),
  slotIds: [...EXIT_POLICY_SLOT_IDS],
  recognize: exitRecognition,
  apply(target, slotId, optionId, parameters) {
    if (!EXIT_POLICY_SLOT_IDS.some((candidate) => candidate === slotId)) {
      return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: EXIT_POLICY/${slotId}`]);
    }
    const exitSlotId = slotId as ExitPolicySlotId;
    const option = findExitPolicySlotOption(exitSlotId, optionId);
    if (option === null) {
      return issueResult(target, [`AUTHORING_OPTION_UNKNOWN: EXIT_POLICY/${slotId}/${optionId}`]);
    }

    const candidate = exitPolicyFromDefinition(target.definition);
    if (candidate !== null && !isExitPolicy(candidate)) {
      return issueResult(target, ["AUTHORING_EXIT_POLICY_INVALID: definition.exit.rules 中已有 policy，但形状非法"]);
    }
    const base = candidate ?? baseExitPolicy();
    if (base === null) {
      return issueResult(target, ["AUTHORING_EXIT_BASE_POLICY_MISSING: 缺少可用的 SL-00 基准政策"]);
    }

    let result: { readonly policy: ExitPolicyDefinition; readonly issues: readonly string[] };
    try {
      result = applyExitPolicySlot(base, exitSlotId, optionId, normalizeParameters(parameters));
    } catch (error) {
      return issueResult(target, [error instanceof Error ? error.message : String(error)]);
    }
    if (result.issues.length > 0) return issueResult(target, result.issues);

    const written = definitionWithExitPolicy(target.definition, result.policy);
    if (written.issues.length > 0) return issueResult(target, written.issues);
    return { ...target, definition: written.definition, issues: [] };
  },
};

export const entryConditionAuthoringSlotHandler: AuthoringSlotHandler = {
  group: "ENTRY_CONDITION",
  label: "入场",
  summaries: entrySummaries(),
  slotIds: [...ENTRY_CONDITION_SLOT_IDS],
  recognize: entryRecognition,
  apply(target, slotId, optionId, parameters) {
    if (!ENTRY_CONDITION_SLOT_IDS.some((candidate) => candidate === slotId)) {
      return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: ENTRY_CONDITION/${slotId}`]);
    }
    if (!isEntryConditionCarrier(target.definition)) {
      return issueResult(target, ["AUTHORING_ENTRY_CONDITION_DEFINITION_INVALID: definition 必须含 entry.conditions 与 parameters"]);
    }
    try {
      if (findEntryConditionSlotOption(slotId, optionId) === null) {
        return issueResult(target, [`AUTHORING_OPTION_UNKNOWN: ENTRY_CONDITION/${slotId}/${optionId}`]);
      }
    } catch (error) {
      return issueResult(target, [error instanceof Error ? error.message : String(error)]);
    }

    let result: ReturnType<typeof applyEntryConditionSlot>;
    try {
      result = applyEntryConditionSlot(
        target.definition,
        slotId,
        optionId,
        normalizeParameters(parameters),
      );
    } catch (error) {
      return issueResult(target, [error instanceof Error ? error.message : String(error)]);
    }
    if (result.issues.length > 0) return issueResult(target, result.issues);

    const definition = {
      ...target.definition,
      entry: { ...target.definition.entry, conditions: result.conditions },
      parameters: result.parameters,
    };
    return { ...target, definition, issues: [] };
  },
};

export const AUTHORING_SLOT_HANDLERS: readonly AuthoringSlotHandler[] = [
  ...SELECTION_AUTHORING_SLOT_HANDLERS,
  exitAuthoringSlotHandler,
  entryConditionAuthoringSlotHandler,
  ...POSITION_COST_AUTHORING_SLOT_HANDLERS,
];