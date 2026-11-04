/**
 * STEP 6.1 — Experiment / Strategy Identity。
 *
 * 提供稳定、可审计的身份工具：
 *   - 策略版本身份：`strategyId@version`（同一策略的不同版本可并存，同版本禁止重复）；
 *   - 实验唯一 ID：`EXP-YYYYMMDD-XXXXXXXX`。
 *
 * 确定性说明：
 *   - `normalizeStrategyKey` / `formatExperimentId` 为纯函数；
 *   - `generateExperimentId` 属于「实验元数据」，允许使用当前时间与随机后缀，
 *     不属于交易计算输入，因此不违反研究输入的确定性约束（见 STEP 6.1 契约 §21）。
 */

import { randomBytes } from "node:crypto";

/** 策略版本身份键：`strategyId@version`。 */
export function normalizeStrategyKey(strategyId: string, version: string): string {
  return `${strategyId}@${version}`;
}

/** 解析策略身份键；非 `strategyId@version` 形态返回 null。 */
export function parseStrategyKey(key: string): { strategyId: string; version: string } | null {
  const at = key.lastIndexOf("@");
  if (at <= 0 || at === key.length - 1) return null;
  return { strategyId: key.slice(0, at), version: key.slice(at + 1) };
}

/** 实验 ID 前缀。 */
export const EXPERIMENT_ID_PREFIX = "EXP";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 组装实验 ID（`EXP-YYYYMMDD-XXXXXXXX`）。纯函数、确定性。 */
export function formatExperimentId(date: string, suffix: string): string {
  return `${EXPERIMENT_ID_PREFIX}-${date}-${suffix}`;
}

/**
 * 生成唯一实验 ID。属于实验元数据，允许使用当前时间与随机后缀。
 * 传入 now/suffix 时（测试）为确定性。
 */
export function generateExperimentId(now: Date = new Date(), suffix?: string): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const resolvedSuffix = suffix ?? randomBytes(4).toString("hex").toUpperCase();
  return formatExperimentId(date, resolvedSuffix);
}

/** 实验 ID 是否匹配 `EXP-YYYYMMDD-...` 形态。 */
export function isExperimentIdFormat(id: string): boolean {
  return /^EXP-\d{8}-[A-Za-z0-9]{4,}$/.test(id);
}
