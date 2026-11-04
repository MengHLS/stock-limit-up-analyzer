/**
 * StrategyDocument 的池化再入场策略 → 执行层 `SimulationConfig.reentryPolicy` 的
 * **唯一映射实现**（对标 `mapDeclaredPositionSizing` / `mapDeclaredExitPolicy`）。
 *
 * 纪律：
 *   - 机械映射，不猜、不补默认：文档没写 = 不限制（既有行为逐字节不变）；
 *   - 声明了非法值（非正整数）⇒ **响亮抛错**，不静默降级成「不限制」；
 *   - 只服务池化族（`definition.firstLimitPool`），事件窗策略不携带本字段。
 */

import type { SimulationConfig } from "../research/simulator/types";
import { LoopRunAssemblyError } from "./errors";

export type DeclaredReentryPolicy = NonNullable<SimulationConfig["reentryPolicy"]>;

export const REENTRY_POLICY_KEYS = [
  "securityCooldownTradingDays",
  "maxEntriesPerMember",
  "maxConcurrentOpenPerCode",
] as const;

/**
 * 文档声明 → 执行层再入场策略。
 *
 * 输入取 `document.definition.firstLimitPool.reentryPolicy`（可为 undefined）。
 * 三个字段全部缺失 ⇒ 返回 `undefined`（不产生任何行为变化）。
 */
export function mapDeclaredReentryPolicy(declared: unknown): DeclaredReentryPolicy | undefined {
  if (declared === undefined || declared === null) return undefined;
  if (typeof declared !== "object" || Array.isArray(declared)) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_REENTRY_POLICY_INVALID",
      `reentryPolicy 必须是对象，实际 ${JSON.stringify(declared)}。`,
    );
  }
  const record = declared as Record<string, unknown>;
  const mapped: {
    securityCooldownTradingDays?: number;
    maxEntriesPerMember?: number;
    maxConcurrentOpenPerCode?: number;
  } = {};
  for (const key of REENTRY_POLICY_KEYS) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new LoopRunAssemblyError(
        "LOOP_RUN_ASSEMBLY_REENTRY_POLICY_INVALID",
        `reentryPolicy.${key} 必须是正整数，实际 ${JSON.stringify(value)}。`,
      );
    }
    mapped[key] = value;
  }
  return Object.keys(mapped).length === 0 ? undefined : mapped;
}
