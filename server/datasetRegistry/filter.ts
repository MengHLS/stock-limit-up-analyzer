/**
 * STEP DATASET-003B — Dataset 构建筛选口径（纯函数，无 IO，确定性）。
 *
 * 定位：筛选语义的**唯一权威实现**，被 lifecycle（配置解析/校验）与 builder（真实取数）共用。
 * 边界铁律：
 *   - 这里只回答「客观市场事实」问题（板块归类 / PIT ST / 涨停形态），不含任何策略语义
 *     （无 buy/sell/signal/stop_loss/position/strategy）；
 *   - 纯函数：同样的输入必然得到同样的输出，不读时钟、不读 DB、不依赖调用顺序。
 *
 * 事件维度语义（与 shared/datasetRegistryContracts.ts B2 节一致）：
 *   `relativeDay` 以「事件日 t」为 0（≤ 0）：
 *     0  → t 日判定（等价 DATASET-001/002 既有口径）
 *     -1 → t-1 日判定（如「T-1 首板，T 日作为观察起点」）
 *   多条规格之间为 OR（任一命中即收录）。
 *
 * 反泄漏：`relativeDay ≤ 0` 保证锚点永远在事件日**当天或之前**，不存在未来锚点；
 *        契约层（zod）同时禁止 positive relativeDay，双层防护。
 */

import type { DatasetBoard, DatasetEventKind, DatasetEventSpec } from "./types";

/**
 * 筛选 + 执行参数默认值（与 shared `DATASET_BUILD_FILTER_DEFAULTS` 同值，
 * 与 lifecycle.BUILD_DEFAULTS 的历史口径一致：事件日首板 / 无前置窗口 / t 后 20 日）。
 */
export const BUILD_FILTER_DEFAULTS = {
  boards: [] as readonly DatasetBoard[],
  excludeSt: false,
  events: [{ relativeDay: 0, kind: "firstBoard" }] as readonly DatasetEventSpec[],
  preWindowDays: 0,
  postWindowDays: 20,
  outcomeHorizons: [5, 10, 20] as readonly number[],
  batchSize: 1000,
} as const;

/** 筛选 / 窗口边界（与 shared `DATASET_BUILD_FILTER_LIMITS` 同值）。 */
export const BUILD_FILTER_LIMITS = {
  preWindowDays: { min: 0, max: 120 },
  postWindowDays: { min: 1, max: 120 },
  relativeDay: { min: -10, max: 0 },
  maxEvents: 6,
} as const;

/** 事件类型判定（给定「锚点日是否涨停」「锚点前一日是否涨停」）。 */
export function matchesEventKind(
  kind: DatasetEventKind,
  limitUpAtAnchor: boolean,
  limitUpAtAnchorPrev: boolean,
): boolean {
  switch (kind) {
    case "limitUp":
      return limitUpAtAnchor;
    case "firstBoard":
      return limitUpAtAnchor && !limitUpAtAnchorPrev;
    case "consecutiveBoard":
      return limitUpAtAnchor && limitUpAtAnchorPrev;
    default:
      return false;
  }
}

/** 单条事件规格是否命中。 */
export function matchesEventSpec(
  spec: DatasetEventSpec,
  limitUpAtAnchor: boolean,
  limitUpAtAnchorPrev: boolean,
): boolean {
  return matchesEventKind(spec.kind, limitUpAtAnchor, limitUpAtAnchorPrev);
}

/** 任一规格命中即收录（OR 语义）。 */
export function matchesAnyEventSpec(
  specs: readonly DatasetEventSpec[],
  limitUpAtAnchor: boolean,
  limitUpAtAnchorPrev: boolean,
): boolean {
  for (const spec of specs) {
    if (matchesEventSpec(spec, limitUpAtAnchor, limitUpAtAnchorPrev)) return true;
  }
  return false;
}

/** 规格去重键（用于规范化去重 / 契约重复校验）。 */
export function eventSpecKey(spec: DatasetEventSpec): string {
  return `${spec.relativeDay}:${spec.kind}`;
}

/**
 * 板块是否放行（**空数组 = 不过滤**，含 unknown 板块）。
 * `board` 为 null（无法归类）时：仅当不过滤才放行 —— 显式选了板块就不收 unknown。
 */
export function isBoardAllowed(boards: readonly DatasetBoard[], board: string | null | undefined): boolean {
  if (boards.length === 0) return true;
  if (board === null || board === undefined) return false;
  return (boards as readonly string[]).includes(board);
}

/** 是否因「排除 ST」而剔除（excludeSt=false 恒放行；PIT st 维度，不看股票名称）。 */
export function isStExcluded(excludeSt: boolean, st: string | null | undefined): boolean {
  if (!excludeSt) return false;
  return st === "ST" || st === "*ST";
}

/**
 * 事件维度需要的最大回看交易日数（锚点相对日的绝对值上限）。
 * 用于判断「窗口首日附近样本是否因前置数据不足而必须剔除」。
 */
export function maxLookbackDays(events: readonly DatasetEventSpec[]): number {
  let max = 0;
  for (const e of events) {
    const rel = Number.isFinite(e.relativeDay) ? Math.trunc(e.relativeDay) : 0;
    max = Math.max(max, Math.abs(Math.min(0, rel)));
  }
  return max;
}
