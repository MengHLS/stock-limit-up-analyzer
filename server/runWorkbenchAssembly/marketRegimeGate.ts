/**
 * MARKET-REGIME-001 — StrategyDocument 的 `definition.marketRegimeFilter` →
 * 执行层 `SimulationConfig.marketRegimeGate` 的**唯一映射实现**
 * （对标 `mapDeclaredPositionSizing` / `mapDeclaredExitPolicy` / `mapDeclaredReentryPolicy`）。
 *
 * 纪律：
 *   - 机械映射，不猜、不补默认：文档没写 ⇒ 返回 undefined（既有行为逐字节不变）；
 *   - 声明了非法值（非 ISO 日期 / 空数组元素 / 重复）⇒ **响亮抛错**，不静默降级成「不限制」；
 *   - 合法集合按升序规范化后返回，保证同一声明必得同一执行面（可复现）。
 */

import type { SimulationConfig } from "../research/simulator/types";
import { LoopRunAssemblyError } from "./errors";

export type DeclaredMarketRegimeGate = NonNullable<SimulationConfig["marketRegimeGate"]>;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 文档声明 → 执行层市场状态闸门。
 *
 * 输入取 `document.definition.marketRegimeFilter`（可为 undefined / null）。
 * 无有效声明（缺省或空集合）⇒ 返回 `undefined`（不产生任何行为变化）。
 */
export function mapDeclaredMarketRegimeGate(declared: unknown): DeclaredMarketRegimeGate | undefined {
  if (declared === undefined || declared === null) return undefined;
  if (typeof declared !== "object" || Array.isArray(declared)) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_MARKET_REGIME_INVALID",
      `marketRegimeFilter 必须是对象，实际 ${JSON.stringify(declared)}。`,
    );
  }
  const record = declared as Record<string, unknown>;
  const rawDates = record.blockedDecisionDates;
  if (rawDates === undefined || rawDates === null) return undefined;
  if (!Array.isArray(rawDates) || rawDates.length === 0) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_MARKET_REGIME_INVALID",
      `marketRegimeFilter.blockedDecisionDates 必须是非空数组，实际 ${JSON.stringify(rawDates)}。`,
    );
  }
  const dates: string[] = [];
  const seen = new Set<string>();
  for (const value of rawDates) {
    if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
      throw new LoopRunAssemblyError(
        "LOOP_RUN_ASSEMBLY_MARKET_REGIME_INVALID",
        `marketRegimeFilter.blockedDecisionDates 元素必须是 YYYY-MM-DD，实际 ${JSON.stringify(value)}。`,
      );
    }
    if (seen.has(value)) {
      throw new LoopRunAssemblyError(
        "LOOP_RUN_ASSEMBLY_MARKET_REGIME_INVALID",
        `marketRegimeFilter.blockedDecisionDates 存在重复日期 ${value}（拒绝歧义输入）。`,
      );
    }
    seen.add(value);
    dates.push(value);
  }
  dates.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const label = record.label;
  if (label !== undefined && (typeof label !== "string" || label.trim() === "")) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_MARKET_REGIME_INVALID",
      `marketRegimeFilter.label 必须是非空字符串，实际 ${JSON.stringify(label)}。`,
    );
  }
  return {
    blockedDecisionDates: dates,
    ...(label === undefined ? {} : { label }),
  };
}
