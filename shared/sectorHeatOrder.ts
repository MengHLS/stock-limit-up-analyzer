/**
 * 「当日题材热力」排序 —— **唯一实现**（两处共用，禁止各写一套）。
 *
 * 用途：
 *   ① 首页连板梯队：同一「高度」行内，按该股题材在**所选交易日**的涨停家数降序排列，
 *      **与是否断板无关**（不得再把断板格单独排前/排尾）；
 *   ② 首页题材热力日历：行（题材）顺序按**当日**（最新一列）涨停家数降序，
 *      **不是**窗口内合计（合计只作同热度时的次键）。
 *
 * 数据源 = `limitUp.getSectorDistribution` 的单日切片。该接口服务端已走
 * `normalizeSectorName`，与 `limitUp.getBoardRoster` 的题材同名 ⇒ 可直接按字符串查表。
 *
 * 为什么不复用「合计」：合计把窗口内 30 天拉平，热点换题材后排序会滞后；
 * 用户要求「按当日数据」，即行顺序反映**当日**的热度。
 */

/** 题材 → 当日涨停家数。 */
export type SectorHeatLookup = ReadonlyMap<string, number>;

/** 由单日题材分布构建查表（传入 `undefined` / `null` ⇒ 空表，例如所选日期早于热力窗口）。 */
export function buildSectorHeatLookup(
  day: { sectors: readonly { sector: string; count: number }[] } | null | undefined,
): SectorHeatLookup {
  const map = new Map<string, number>();
  for (const item of day?.sectors ?? []) map.set(item.sector, item.count);
  return map;
}

/**
 * 取某题材的当日热度。
 * ⚠️ 缺热度取 **-1** 而不是 0：必须**低于**任何真实热度（哪怕当日 0 家），否则
 * 「窗口内有热度、当日 0 家」（真值 0）会和一个从未出现的题材并列。
 */
export function sectorHeatOf(lookup: SectorHeatLookup, sector: string): number {
  return lookup.get(sector) ?? -1;
}

/**
 * 生成「按当日题材热力降序」的比较器，`Array#sort` 直接可用。
 * 同热度（含两者都缺热度）时按 `tieBreak`；不传 `tieBreak` 视为相等（引擎保持相对次序）。
 */
export function compareBySectorHeat<T extends { sector: string }>(
  lookup: SectorHeatLookup,
  tieBreak?: (a: T, b: T) => number,
): (a: T, b: T) => number {
  return (a, b) => {
    const delta = sectorHeatOf(lookup, b.sector) - sectorHeatOf(lookup, a.sector);
    if (delta !== 0) return delta;
    return tieBreak ? tieBreak(a, b) : 0;
  };
}

/** 便捷包装：返回**新数组**（不改动入参数组），便于 `useMemo` 里安全使用。 */
export function sortBySectorHeat<T extends { sector: string }>(
  items: readonly T[],
  lookup: SectorHeatLookup,
  tieBreak?: (a: T, b: T) => number,
): T[] {
  return [...items].sort(compareBySectorHeat<T>(lookup, tieBreak));
}
