/**
 * STEP 11 / Work G — Corporate Action → Backtest 集成审计：最小语义原语。
 *
 * 本文件提供审计所需的「可复现语义」纯函数，用于回答三个关键问题：
 *   1. PIT 可用性：未来 corporate action 是否可能提前影响 decisionTime？
 *      → 用 `announcementDate`（信息可得时点）做 availability 过滤，而非 `effectiveDate`。
 *   2. 复权对账（reconciliation）：provider 累计因子能否与 semantic 事件反推因子对得上？
 *   3. 有效日过滤：backward 复权只应依赖 `effectiveDate <= decisionTime` 的事件。
 *
 * 约束：纯函数、无 DB、无副作用、不改 raw 价格、不改既有模块。仅作为审计佐证与
 * 上层未来接线时的语义依据，未接入 Backtest 引擎主循环。
 */

import type { CorporateAction } from "./types";

/**
 * 复权对账结果：semantic（事件反推）因子 vs provider（权威累计）因子。
 * 两者都归一化为「单事件前向因子 f」后比较。
 */
export interface ReconciliationResult {
  /** 相对误差是否在容差内。 */
  matches: boolean;
  /** 事件反推的语义前向因子。 */
  semanticFactor: number;
  /** provider 侧的前向因子。 */
  providerFactor: number;
  /** 相对误差 = |semantic - provider| / |provider|。 */
  relativeError: number;
  /** 判定容差。 */
  tolerance: number;
}

/**
 * 对账语义因子与 provider 因子。
 * 相对误差 <= tolerance 视为一致。provider 因子必须为正，否则返回不匹配。
 */
export function reconcileForwardFactor(
  semanticFactor: number,
  providerFactor: number,
  tolerance = 1e-3,
): ReconciliationResult {
  const semanticFinite = Number.isFinite(semanticFactor) && semanticFactor > 0;
  const providerFinite = Number.isFinite(providerFactor) && providerFactor > 0;
  if (!semanticFinite || !providerFinite) {
    return {
      matches: false,
      semanticFactor,
      providerFactor,
      relativeError: Number.POSITIVE_INFINITY,
      tolerance,
    };
  }
  const relativeError = Math.abs(semanticFactor - providerFactor) / Math.abs(providerFactor);
  return { matches: relativeError <= tolerance, semanticFactor, providerFactor, relativeError, tolerance };
}

/**
 * 某 corporate action 在 decisionTime 是否「可知」。
 *
 * 语义：一个事件只有在 `announcementDate <= decisionTime` 时才可被该决策时点得知。
 * `effectiveDate` 只描述「价格何时调整」，不描述「信息何时可得」——两者不可混同。
 *
 * 缺失 announcementDate（null）时**保守视为不可知**（返回 false），杜绝 look-ahead。
 * 这比「假设 announcementDate === effectiveDate」更安全。
 */
export function isCorporateActionKnownAt(
  action: CorporateAction,
  decisionTime: string,
): boolean {
  const announced = action.announcementDate;
  if (announced === null || announced === undefined) return false;
  return announced <= decisionTime;
}

/**
 * 过滤出 decisionTime 时点「已可知」的事件（PIT availability 过滤）。
 * 供未来上层在信号阶段过滤公司行为，防止未来事件泄漏进 decisionTime。
 */
export function filterActionsKnownAt(
  actions: readonly CorporateAction[],
  decisionTime: string,
): CorporateAction[] {
  return actions.filter((action) => isCorporateActionKnownAt(action, decisionTime));
}

/**
 * 过滤出 `effectiveDate <= decisionTime` 的事件集。
 *
 * backward 复权（锚定最早价）在「因子序列形态」上不会因未来事件而重锚，但这一点
 * 单独并不构成 PIT-safe 的充分条件（见 docs/quant-system-contract.md §12）：任何
 * adjusted price 是否可用于 decisionTime，最终取决于构建它所用的 corporate action
 * 数据（事件/因子本身及其 retrievedAt/announcementDate）在该时点是否已可知。
 * 本函数只做「已生效」过滤，不替代 availability 过滤（filterActionsKnownAt）。
 */
export function actionsEffectiveOnOrBefore(
  actions: readonly CorporateAction[],
  decisionTime: string,
): CorporateAction[] {
  return actions.filter((action) => action.effectiveDate <= decisionTime);
}
