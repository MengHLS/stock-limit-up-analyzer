/**
 * 通用 AuthoringSlot registry。
 *
 * 所有槽 id 必须在整个 registry 内全局唯一；识别与应用都只从这里查找 handler。
 * registry 不拼装策略内容，只验证归属、汇总识别结果并执行 fail-closed。
 */
import {
  AUTHORING_SLOT_HANDLERS,
} from "./authoringSlotAdapters";

export { AUTHORING_SLOT_HANDLERS };
import type {
  AuthoringApplyResult,
  AuthoringRecognitionItem,
  AuthoringRecognitionResult,
  AuthoringSlotGroupSummary,
  AuthoringSlotHandler,
  AuthoringTarget,
} from "./authoringSlotTypes";

function assertUniqueSlotIds(handlers: readonly AuthoringSlotHandler[]): void {
  const seen = new Map<string, string>();
  for (const handler of handlers) {
    for (const slotId of handler.slotIds) {
      const existing = seen.get(slotId);
      if (existing !== undefined) {
        throw new Error(`AUTHORING_SLOT_ID_DUPLICATE: ${slotId} (${existing}, ${handler.group})`);
      }
      seen.set(slotId, handler.group);
    }
  }
}

assertUniqueSlotIds(AUTHORING_SLOT_HANDLERS);

export function listAuthoringSlotGroups(): readonly AuthoringSlotGroupSummary[] {
  return AUTHORING_SLOT_HANDLERS.map((handler) => ({
    group: handler.group,
    label: handler.label,
    slots: handler.summaries,
  }));
}

export function findAuthoringSlotHandler(slotId: string): AuthoringSlotHandler | null {
  return AUTHORING_SLOT_HANDLERS.find((handler) => handler.slotIds.includes(slotId)) ?? null;
}

export function recognizeAuthoringSlots(target: AuthoringTarget): AuthoringRecognitionResult {
  const slots: AuthoringRecognitionItem[] = [];
  for (const handler of AUTHORING_SLOT_HANDLERS) {
    slots.push(...handler.recognize(target));
  }
  return { slots };
}

function originalTarget(target: AuthoringTarget): AuthoringApplyResult {
  return {
    recipe: target.recipe,
    definition: target.definition,
    executionAssumptions: target.executionAssumptions,
    issues: [],
  };
}

export function applyAuthoringSlot(
  target: AuthoringTarget,
  slotId: string,
  optionId: string,
  parameters: Readonly<Record<string, number | boolean | string>>,
): AuthoringApplyResult {
  const handler = findAuthoringSlotHandler(slotId);
  if (handler === null) {
    return {
      ...originalTarget(target),
      issues: [`AUTHORING_SLOT_UNKNOWN: ${slotId}`],
    };
  }

  const result = handler.apply(target, slotId, optionId, parameters);
  if (result.issues.length > 0) {
    return {
      recipe: target.recipe,
      definition: target.definition,
      executionAssumptions: target.executionAssumptions,
      issues: [...result.issues],
    };
  }
  return {
    recipe: result.recipe,
    definition: result.definition,
    executionAssumptions: result.executionAssumptions,
    issues: [],
  };
}