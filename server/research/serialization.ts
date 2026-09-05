/**
 * STEP 6.1 — Experiment / Snapshot / Strategy Definition 序列化。
 *
 * 铁律：
 *   serialize → JSON → deserialize 必须保持语义一致；
 *   禁止 undefined → "undefined"、null → "null"、NaN → "NaN"、Infinity → "Infinity"
 *   之类的字符串化污染。
 *
 * 实现说明：JSON.stringify 原生会把 undefined 属性省略、把 NaN/Infinity 静默转成 null。
 * 本层用严格 replacer 拦截非有限数字（避免信息静默丢失）；undefined 由 JSON 语义正常省略
 * （可选字段「未提供」与「省略」语义等价）；null 是合法 JSON 值，原样保留。
 * deserialize 侧对解析结果做结构校验，拒绝非法形态。
 */

import {
  ResearchValidationError,
  validateExperimentSnapshot,
  validateResearchExperiment,
  validateStrategyDefinition,
} from "./experimentValidation";
import type { ResearchStrategyDefinition } from "./strategyContract";
import type { ResearchExperiment, ResearchExperimentSnapshot } from "./types";

/** 严格 replacer：拒绝非有限数字（NaN/Infinity 不得静默转 null）。 */
function strictReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`拒绝序列化非有限数字：${String(value)}`);
  }
  return value;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ResearchValidationError([{ code: "DESERIALIZE_INVALID", path: label, message: `反序列化结果不是对象：${label}` }]);
  }
}

// ---------------------------------------------------------------------------
// Experiment
// ---------------------------------------------------------------------------

export function serializeResearchExperiment(experiment: ResearchExperiment): string {
  return JSON.stringify(experiment, strictReplacer);
}

export function deserializeResearchExperiment(json: string): ResearchExperiment {
  const parsed: unknown = JSON.parse(json);
  assertObject(parsed, "experiment");
  const experiment = parsed as unknown as ResearchExperiment;
  const result = validateResearchExperiment(experiment);
  if (!result.valid) throw new ResearchValidationError(result.issues);
  return experiment;
}

// ---------------------------------------------------------------------------
// Experiment Snapshot
// ---------------------------------------------------------------------------

export function serializeResearchExperimentSnapshot(snapshot: ResearchExperimentSnapshot): string {
  return JSON.stringify(snapshot, strictReplacer);
}

export function deserializeResearchExperimentSnapshot(json: string): ResearchExperimentSnapshot {
  const parsed: unknown = JSON.parse(json);
  assertObject(parsed, "snapshot");
  const snapshot = parsed as unknown as ResearchExperimentSnapshot;
  const result = validateExperimentSnapshot(snapshot);
  if (!result.valid) throw new ResearchValidationError(result.issues);
  return snapshot;
}

// ---------------------------------------------------------------------------
// Strategy Definition
// ---------------------------------------------------------------------------

export function serializeResearchStrategyDefinition(definition: ResearchStrategyDefinition): string {
  return JSON.stringify(definition, strictReplacer);
}

export function deserializeResearchStrategyDefinition(json: string): ResearchStrategyDefinition {
  const parsed: unknown = JSON.parse(json);
  assertObject(parsed, "strategyDefinition");
  const definition = parsed as unknown as ResearchStrategyDefinition;
  const result = validateStrategyDefinition(definition);
  if (!result.valid) throw new ResearchValidationError(result.issues);
  return definition;
}
