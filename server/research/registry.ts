/**
 * STEP 6.1 — Research Strategy Registry。
 *
 * 最小研究策略注册中心，以 `strategyId@version` 为身份键：
 *   - 同一 strategyId + version 重复注册 → 拒绝；
 *   - 同一 strategyId 的不同 version 可并存（如 leader-candidate@1.0.0 与 @1.1.0）。
 *
 * 约束：
 *   - 注册即校验（非法定义拒绝入 registry）；
 *   - 不依赖 Database / Network / Date.now / Math.random；
 *   - 只保存定义（元数据 + 参数 schema），不保存任何计算状态。
 */

import { normalizeStrategyKey } from "./experimentIdentity";
import { assertValidStrategyDefinition } from "./experimentValidation";
import type { ResearchStrategyDefinition } from "./strategyContract";

export class ResearchStrategyRegistry {
  private readonly byKey = new Map<string, ResearchStrategyDefinition>();

  /** 注册研究策略定义；同 strategyId+version 已存在时抛错。 */
  register(definition: ResearchStrategyDefinition): void {
    assertValidStrategyDefinition(definition);
    const key = normalizeStrategyKey(definition.strategyId, definition.version);
    if (this.byKey.has(key)) {
      throw new Error(`研究策略已注册，拒绝重复注册：${key}`);
    }
    this.byKey.set(key, definition);
  }

  /** 是否已注册指定 strategyId + version。 */
  has(strategyId: string, version: string): boolean {
    return this.byKey.has(normalizeStrategyKey(strategyId, version));
  }

  /** 按 strategyId + version 取定义（返回独立副本）；未知身份抛错。 */
  get(strategyId: string, version: string): ResearchStrategyDefinition {
    const key = normalizeStrategyKey(strategyId, version);
    const definition = this.byKey.get(key);
    if (!definition) {
      throw new Error(`未注册的研究策略：${key}`);
    }
    return structuredClone(definition);
  }

  /** 列出全部定义（按 strategyId@version 字典序稳定排序；返回独立副本）。 */
  list(): ResearchStrategyDefinition[] {
    return Array.from(this.byKey.values())
      .map((definition) => structuredClone(definition))
      .sort((left, right) =>
        normalizeStrategyKey(left.strategyId, left.version)
          .localeCompare(normalizeStrategyKey(right.strategyId, right.version)),
      );
  }
}

/** 全系统单例研究策略注册中心（仅保存定义，无计算状态）。 */
export const researchStrategyRegistry = new ResearchStrategyRegistry();
