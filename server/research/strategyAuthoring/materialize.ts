/**
 * SCOPE-002 §1.3 / §2.3 A3 —— 预设**物化**（纯函数、确定性、无 IO）。
 *
 * 「预设 + 参数」的唯一执行实现：
 *   1. 查预设（`(slot, presetId)`）；
 *   2. 逐参数校验（未知 code / 类型 / min / max / allowedValues）；
 *   3. 克隆 canonical payload，按 RFC 6901 JSON Pointer 写入；
 *   4. 用**既有校验器**复核（`resolveStrategyRecipe` / `exitPolicyDefinitionErrors` / …）。
 *
 * 🔴 三条纪律（SCOPE-002 §0.2）：
 *   - P4：前端只做"选预设 + 填参数"，payload 由本模块产出，前端逐字复制；
 *   - P5：不新增引擎、不新增语义 —— 校验全部委托既有函数；
 *   - 失败**响亮**：任何一步不通过都在 `issues` 里如实报告，绝不返回"看起来能用"的 payload。
 */
import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { resolveStrategyRecipe } from "../recipeRegistry";
import type { StrategyRecipe } from "../strategySchema/types";
import { stopPolicyDefinitionErrors } from "../stopPolicy";
import {
  STRATEGY_EXECUTION_TIMINGS,
  STRATEGY_POSITION_SIZING_METHODS,
  STRATEGY_PRICE_TYPES,
  STRATEGY_SIGNAL_TIMINGS,
} from "../strategySchema/definition";
import {
  capitalRecyclePolicyErrors,
  exitPolicyDefinitionErrors,
  runnerBridgePolicyErrors,
  strongHoldPolicyErrors,
  timeExitPolicyErrors,
} from "../exitPolicyCommon";
import { trailingPolicyDefinitionErrors } from "../trailingPolicy";
import { JsonPointerError, setByPointer } from "./jsonPointer";
import {
  EXIT_BASE_PRESETS,
  findStrategyAuthoringPreset,
  RUNNER_BRIDGE_PRESETS,
  type AtomicStrategyPreset,
  type StrategyAuthoringPreset,
  type StrategyAuthoringSlot,
  type StrategyPresetParameter,
  type StrategyPresetParameterValue,
} from "./presetRegistry";

export const STRATEGY_AUTHORING_ERROR_CODES = [
  "AUTHORING_PRESET_NOT_FOUND",
  "AUTHORING_SLOT_MISMATCH",
  "AUTHORING_PARAMETER_UNKNOWN",
  "AUTHORING_PARAMETER_INVALID",
  "AUTHORING_POINTER_MISSING",
  "AUTHORING_PAYLOAD_INVALID",
  "AUTHORING_RECIPE_UNREGISTERED",
  "AUTHORING_EXIT_BASE_MISSING",
  "AUTHORING_FIELD_PATCH_INVALID",
] as const;
export type StrategyAuthoringErrorCode = (typeof STRATEGY_AUTHORING_ERROR_CODES)[number];

export interface StrategyAuthoringIssue {
  readonly code: StrategyAuthoringErrorCode;
  readonly path: string;
  readonly message: string;
}

export interface MaterializePresetInput {
  readonly slot: StrategyAuthoringSlot;
  readonly presetId: string;
  readonly parameters: Readonly<Record<string, StrategyPresetParameterValue>>;
}

export interface MaterializePresetResult {
  readonly slot: StrategyAuthoringSlot;
  readonly presetId: string;
  /** canonical 结构（不透明；仅当 `issues` 为空时可用）。 */
  readonly payload: unknown;
  readonly resolvedParameters: Readonly<Record<string, StrategyPresetParameterValue>>;
  /** payload 内容指纹（确定性；审计 / 幂等用）。 */
  readonly fingerprint: string;
  readonly issues: readonly StrategyAuthoringIssue[];
}

function deepClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function payloadFingerprint(payload: unknown): string {
  return `preset-payload-sha256:${createHash("sha256").update(canonicalStringify(payload)).digest("hex")}`;
}

/** 参数值是否满足声明（类型 / 范围 / 枚举）。 */
function parameterError(parameter: StrategyPresetParameter, value: unknown): string | null {
  if (parameter.valueType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `必须是有限数字，实际 ${JSON.stringify(value)}`;
    if (parameter.min !== undefined && value < parameter.min) return `不得小于 ${parameter.min}，实际 ${value}`;
    if (parameter.max !== undefined && value > parameter.max) return `不得大于 ${parameter.max}，实际 ${value}`;
    return null;
  }
  if (parameter.valueType === "boolean") {
    return typeof value === "boolean" ? null : `必须是布尔值，实际 ${JSON.stringify(value)}`;
  }
  if (typeof value !== "string") return `必须是字符串，实际 ${JSON.stringify(value)}`;
  if (parameter.allowedValues !== undefined && !parameter.allowedValues.includes(value)) {
    return `必须是 ${parameter.allowedValues.join(" | ")} 之一，实际 ${JSON.stringify(value)}`;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * ③ 仓位补丁的语义校验。
 *
 * 只校验**本文件的补丁确实表达得出来的事**：规模口径在这些取值内、比例在范围内、
 * 持仓数是正整数。真正的权威仍是 `definitionValidation` —— 这里不重写那套规则，
 * 只挡"预设自己就写错了"的情况（预设是我们发的，不该让用户踩到）。
 */
function positionPatchErrors(payload: unknown): string[] {
  if (!isRecord(payload)) return ["POSITION 预设的 payload 必须是对象"];
  const position = payload.position;
  if (!isRecord(position)) return ["POSITION 预设的 payload 必须含 position 对象"];

  const problems: string[] = [];
  const sizingMethod = position.sizingMethod;
  if (typeof sizingMethod !== "string" || !(STRATEGY_POSITION_SIZING_METHODS as readonly string[]).includes(sizingMethod)) {
    problems.push(`sizingMethod 必须是 ${STRATEGY_POSITION_SIZING_METHODS.join(" | ")} 之一，实际 ${JSON.stringify(sizingMethod)}`);
  }
  const maxPositions = position.maxPositions;
  if (typeof maxPositions !== "number" || !Number.isInteger(maxPositions) || maxPositions < 1) {
    problems.push(`maxPositions 必须是 ≥1 的整数，实际 ${JSON.stringify(maxPositions)}`);
  }
  if (position.positionRatio !== undefined) {
    const ratio = position.positionRatio;
    if (typeof ratio !== "number" || !(ratio > 0) || ratio > 1) {
      problems.push(`positionRatio 必须落在 (0,1]，实际 ${JSON.stringify(ratio)}`);
    }
  }
  if (position.fixedAmount !== undefined) {
    const amount = position.fixedAmount;
    if (typeof amount !== "number" || !(amount > 0)) {
      problems.push(`fixedAmount 必须为正数，实际 ${JSON.stringify(amount)}`);
    }
  }
  if ((sizingMethod === "FIXED_RATIO" || sizingMethod === "EQUITY_RATIO") && position.positionRatio === undefined) {
    problems.push(`sizingMethod=${String(sizingMethod)} 必须同时给出 positionRatio`);
  }
  if (sizingMethod === "FIXED_AMOUNT" && position.fixedAmount === undefined) {
    problems.push("sizingMethod=FIXED_AMOUNT 必须同时给出 fixedAmount");
  }
  return problems;
}

/**
 * ④ 成本与成交补丁的语义校验：七项成本假设齐全且非负、成交口径在词表内。
 *
 * 🔴 刻意**不**在这里判"成交不得早于信号"（L6）—— 那是 `definitionValidation` 的规则；
 *    它在保存/运行时照样拦。预设层重复一遍只会造成两处真相。
 */
function costPatchErrors(payload: unknown): string[] {
  if (!isRecord(payload)) return ["COST 预设的 payload 必须是对象"];
  const cost = payload.cost;
  const execution = payload.execution;
  if (!isRecord(cost)) return ["COST 预设的 payload 必须含 cost 对象"];
  if (!isRecord(execution)) return ["COST 预设的 payload 必须含 execution 对象"];

  const problems: string[] = [];
  const nonNegative = [
    "commissionRate", "stampDutyRate", "transferFeeRate", "slippageBps", "minCommission",
  ] as const;
  for (const key of ["initialCapital", ...nonNegative, "lotSize"] as const) {
    const value = cost[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      problems.push(`cost.${key} 必须是有限数字，实际 ${JSON.stringify(value)}`);
    }
  }
  if (typeof cost.initialCapital === "number" && !(cost.initialCapital > 0)) {
    problems.push("cost.initialCapital 必须为正数");
  }
  for (const key of nonNegative) {
    if (typeof cost[key] === "number" && cost[key] < 0) problems.push(`cost.${key} 不得为负`);
  }
  if (typeof cost.lotSize === "number" && (!Number.isInteger(cost.lotSize) || cost.lotSize < 1)) {
    problems.push("cost.lotSize 必须是 ≥1 的整数");
  }
  const whitelist: readonly (readonly [string, readonly string[]])[] = [
    ["signalTiming", STRATEGY_SIGNAL_TIMINGS],
    ["executionTiming", STRATEGY_EXECUTION_TIMINGS],
    ["priceType", STRATEGY_PRICE_TYPES],
  ];
  for (const [key, allowed] of whitelist) {
    const value = execution[key];
    if (typeof value !== "string" || !allowed.includes(value)) {
      problems.push(`execution.${key} 必须是 ${allowed.join(" | ")} 之一，实际 ${JSON.stringify(value)}`);
    }
  }
  return problems;
}

/** 按 slot 选用**既有校验器**；返回人类可读错误串。 */
function semanticErrors(slot: StrategyAuthoringSlot, payload: unknown): string[] {
  switch (slot) {
    case "RECIPE": {
      try {
        resolveStrategyRecipe(payload as StrategyRecipe);
        return [];
      } catch (error) {
        return [error instanceof Error ? error.message : String(error)];
      }
    }
    case "EXIT_POLICY":
    case "EXIT_BASE":
      return exitPolicyDefinitionErrors(payload);
    case "STOP":
      return stopPolicyDefinitionErrors(payload);
    case "TAKE_PROFIT":
      return payload === null ? [] : trailingPolicyDefinitionErrors(payload);
    case "TIME_EXIT":
      return payload === null ? [] : timeExitPolicyErrors(payload);
    case "STRONG_HOLD":
      return payload === null ? [] : strongHoldPolicyErrors(payload);
    case "CAPITAL_RECYCLE":
      return payload === null ? [] : capitalRecyclePolicyErrors(payload);
    case "RUNNER_BRIDGE":
      return payload === null ? [] : runnerBridgePolicyErrors(payload);
    case "POSITION":
      return positionPatchErrors(payload);
    case "COST":
      return costPatchErrors(payload);
    default:
      return [`未知 slot：${String(slot)}`];
  }
}

function findExitBase(presetId: string): AtomicStrategyPreset | null {
  return EXIT_BASE_PRESETS.find(p => p.presetId === presetId) ?? null;
}

function findRunnerBridge(presetId: string): AtomicStrategyPreset | null {
  return RUNNER_BRIDGE_PRESETS.find(p => p.presetId === presetId) ?? null;
}

/** 组合退出政策的默认 payload：基座 → 叠加 runnerBridge → 叠加逐子槽覆盖。 */
function composedExitPolicyPayload(
  preset: Extract<StrategyAuthoringPreset, { kind: "COMPOSITE" }>,
  issues: StrategyAuthoringIssue[],
): unknown {
  const base = findExitBase(preset.composition.base);
  if (base === null) {
    issues.push({
      code: "AUTHORING_EXIT_BASE_MISSING",
      path: "/composition/base",
      message: `组合预设 ${preset.presetId} 引用了不存在的退出基座 ${preset.composition.base}`,
    });
    return null;
  }
  const payload = deepClone(base.payload);
  if (preset.composition.runnerBridge !== null) {
    const bridge = findRunnerBridge(preset.composition.runnerBridge);
    if (bridge === null) {
      issues.push({
        code: "AUTHORING_EXIT_BASE_MISSING",
        path: "/composition/runnerBridge",
        message: `组合预设 ${preset.presetId} 引用了不存在的 runnerBridge 预设 ${preset.composition.runnerBridge}`,
      });
      return null;
    }
    (payload as Record<string, unknown>).runnerBridge = deepClone(bridge.payload);
  }
  for (const [slot, overrideId] of Object.entries(preset.composition.overrides ?? {})) {
    if (overrideId === undefined) continue;
    const override = overrideId === null ? null : findStrategyAuthoringPreset(slot as StrategyAuthoringSlot, overrideId);
    if (override === undefined || override === null) {
      issues.push({
        code: "AUTHORING_PRESET_NOT_FOUND",
        path: `/composition/overrides/${slot}`,
        message: `组合预设 ${preset.presetId} 引用了不存在的覆盖预设 ${String(overrideId)}（slot=${slot}）`,
      });
      return null;
    }
    if (override.kind !== "ATOMIC") {
      issues.push({
        code: "AUTHORING_SLOT_MISMATCH",
        path: `/composition/overrides/${slot}`,
        message: `组合预设 ${preset.presetId} 的覆盖项必须是原子预设：${String(overrideId)}`,
      });
      return null;
    }
    (payload as Record<string, unknown>)[slot] = deepClone(override.payload);
  }
  return payload;
}

/**
 * 物化一个预设。
 *
 * 幂等：同输入 ⇒ 同 `payload` / 同 `fingerprint`（无 `Date.now` / 无随机）。
 */
export function materializePreset(input: MaterializePresetInput): MaterializePresetResult {
  const issues: StrategyAuthoringIssue[] = [];
  const preset = findStrategyAuthoringPreset(input.slot, input.presetId);
  if (preset === null) {
    return {
      slot: input.slot, presetId: input.presetId, payload: null, resolvedParameters: {},
      fingerprint: payloadFingerprint(null),
      issues: [{
        code: "AUTHORING_PRESET_NOT_FOUND", path: "/presetId",
        message: `未找到预设：slot=${input.slot} presetId=${input.presetId}（请刷新词表）`,
      }],
    };
  }

  // 1) 参数校验（未知 code 响亮拒绝，不静默忽略）
  const provided = new Map(Object.entries(input.parameters));
  for (const code of provided.keys()) {
    if (!preset.parameters.some(p => p.code === code)) {
      issues.push({ code: "AUTHORING_PARAMETER_UNKNOWN", path: `/parameters/${code}`, message: `预设 ${preset.presetId} 未声明参数 ${code}` });
    }
  }
  const resolvedParameters: Record<string, StrategyPresetParameterValue> = {};
  for (const parameter of preset.parameters) {
    const raw = provided.has(parameter.code) ? provided.get(parameter.code) : parameter.defaultValue;
    const error = parameterError(parameter, raw);
    if (error !== null) {
      issues.push({ code: "AUTHORING_PARAMETER_INVALID", path: `/parameters/${parameter.code}`, message: `参数 ${parameter.code} ${error}` });
      continue;
    }
    resolvedParameters[parameter.code] = raw as StrategyPresetParameterValue;
  }
  if (issues.length > 0) {
    return {
      slot: input.slot, presetId: input.presetId, payload: null, resolvedParameters,
      fingerprint: payloadFingerprint(null), issues,
    };
  }

  // 2) 构造 payload
  const basePayload = preset.kind === "COMPOSITE"
    ? composedExitPolicyPayload(preset, issues)
    : deepClone(preset.payload);
  if (issues.length > 0) {
    return {
      slot: input.slot, presetId: input.presetId, payload: null, resolvedParameters,
      fingerprint: payloadFingerprint(null), issues,
    };
  }

  // 3) 按 JSON Pointer 写入（路径必须已存在）
  let payload = basePayload;
  for (const parameter of preset.parameters) {
    try {
      payload = setByPointer(payload, parameter.path, resolvedParameters[parameter.code]);
    } catch (error) {
      if (error instanceof JsonPointerError) {
        issues.push({ code: "AUTHORING_POINTER_MISSING", path: parameter.path, message: `参数 ${parameter.code} 的指针无效：${error.message}` });
      } else {
        throw error;
      }
    }
  }
  if (issues.length > 0) {
    return {
      slot: input.slot, presetId: input.presetId, payload: null, resolvedParameters,
      fingerprint: payloadFingerprint(null), issues,
    };
  }

  // 4) 既有校验器复核
  const semantic = semanticErrors(input.slot, payload);
  if (semantic.length > 0) {
    for (const message of semantic) {
      issues.push({
        code: input.slot === "RECIPE"
          ? "AUTHORING_RECIPE_UNREGISTERED"
          : (input.slot === "POSITION" || input.slot === "COST")
            ? "AUTHORING_FIELD_PATCH_INVALID"
            : "AUTHORING_PAYLOAD_INVALID",
        path: "/payload", message,
      });
    }
    return {
      slot: input.slot, presetId: input.presetId, payload: null, resolvedParameters,
      fingerprint: payloadFingerprint(null), issues,
    };
  }

  return {
    slot: input.slot, presetId: input.presetId, payload, resolvedParameters,
    fingerprint: payloadFingerprint(payload), issues: [],
  };
}