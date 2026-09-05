/**
 * STEP 10 — 实验配置 / 策略契约序列化。
 *
 * 铁律：serialize → JSON → deserialize 保持语义一致；拒绝序列化 NaN/Infinity。
 * 反序列化侧做结构校验，拒绝非法形态。
 */

import { ResearchValidationError } from "../experimentValidation";
import type { ExperimentConfig, StrategyContract } from "./contract";
import { validateExperimentConfig, validateStrategyContract } from "./validation";

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
// Experiment Config
// ---------------------------------------------------------------------------

export function serializeExperimentConfig(config: ExperimentConfig): string {
  return JSON.stringify(config, strictReplacer);
}

export function deserializeExperimentConfig(json: string): ExperimentConfig {
  const parsed: unknown = JSON.parse(json);
  assertObject(parsed, "experimentConfig");
  const config = parsed as unknown as ExperimentConfig;
  const r = validateExperimentConfig(config);
  if (!r.valid) throw new ResearchValidationError(r.issues);
  return config;
}

// ---------------------------------------------------------------------------
// Strategy Contract
// ---------------------------------------------------------------------------

export function serializeStrategyContract(contract: StrategyContract): string {
  return JSON.stringify(contract, strictReplacer);
}

export function deserializeStrategyContract(json: string): StrategyContract {
  const parsed: unknown = JSON.parse(json);
  assertObject(parsed, "strategyContract");
  const contract = parsed as unknown as StrategyContract;
  const r = validateStrategyContract(contract);
  if (!r.valid) throw new ResearchValidationError(r.issues);
  return contract;
}
