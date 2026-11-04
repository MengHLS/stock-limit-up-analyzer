/**
 * STOCK-SELECTION-006 — 选股清单的**展示派生**（纯函数）。
 *
 * 抽出来的原因：页面（含历史明细）要「名称 + 代码 + K 线窗口」三处派生逻辑，
 * 纯函数才能被单测锁住，避免两处渲染漂移。**不做任何 IO**。
 *
 * 口径（如实，不编造）：
 *   - 名称取不到（`null` / 空串）⇒ 显示 `—`，**绝不**用代码冒充名称；
 *   - 代码优先用 `pick.code`（当日生效代码），回退标签，最后才回退 canonical id；
 *   - K 线窗口以**事件日 T0** 为中心（本策略观察窗就在 T0 ~ T0+6）；无事件日 ⇒ 返回 `null`（不可点）。
 */

import type { StockKlineTradeTarget } from "@/components/strategy/StockKlineDialog";

/** 页面渲染所需的最小 pick 形状（与 `StockSelectionPick` 结构兼容）。 */
export interface SelectionPickLike {
  readonly canonicalSecurityId: string;
  readonly code: string | null;
  readonly eventDate: string;
  readonly signalDate: string;
  readonly entryDate: string | null;
}

/** 名称字典条目（`researchRun.securityLabels` 的元素形状）。 */
export interface SecurityLabelLike {
  readonly code: string | null;
  readonly name: string | null;
}

/** 名称展示：缺失 ⇒ `—`（不用代码冒充）。 */
export function pickNameForDisplay(label: SecurityLabelLike | undefined): string {
  const name = label?.name?.trim();
  return name !== undefined && name.length > 0 ? name : "—";
}

/** 代码展示：`pick.code` → 标签代码 → canonical id（层层回退，永不空串）。 */
export function pickCodeForDisplay(pick: SelectionPickLike, label: SecurityLabelLike | undefined): string {
  return pick.code ?? label?.code ?? pick.canonicalSecurityId;
}

/** 被剔除股票的展示形状（与 `StockSelectionExcludedStock` 结构兼容）。 */
export interface ExcludedStockLike {
  readonly canonicalSecurityId: string;
  readonly code: string | null;
  readonly eventDate: string;
}

/**
 * 被剔除股票的 K 线弹窗入参。
 *
 * 与 picks 同一思路（复用交易详情同款组件），但剔除票**没有买入日** ⇒
 * 窗口以**事件日 T0** 为中心（前后各 30 交易日）；无事件日 ⇒ `null`（不可点）。
 */
export function buildKlineTargetForExcludedStock(
  stock: ExcludedStockLike,
  label: SecurityLabelLike | undefined,
): StockKlineTradeTarget | null {
  if (stock.eventDate.length === 0) return null;
  return {
    securityId: stock.canonicalSecurityId,
    code: stock.code ?? label?.code ?? null,
    name: label?.name ?? null,
    entryTime: stock.eventDate,
    exitTime: stock.eventDate,
  };
}

/**
 * 构造 K 线弹窗入参（交易详情同款组件）。
 * 无事件日 ⇒ `null`（调用方应禁用按钮，避免开一个空窗口）。
 */
export function buildKlineTargetForPick(
  pick: SelectionPickLike,
  label: SecurityLabelLike | undefined,
): StockKlineTradeTarget | null {
  if (pick.eventDate.length === 0) return null;
  return {
    securityId: pick.canonicalSecurityId,
    code: pick.code ?? label?.code ?? null,
    name: label?.name ?? null,
    entryTime: pick.eventDate,
    exitTime: pick.entryDate ?? pick.signalDate,
  };
}