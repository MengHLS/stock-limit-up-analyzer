/**
 * 「题材次序」—— **唯一实现**（两处共用，禁止各写一套）。
 *
 * 用途：
 *   ① 首页连板梯队：同一「高度」行内，按该股题材的**题材次序**排列，**与是否断板无关**
 *      （不得再把断板格单独排前/排尾）；兜底桶「其他」**永远压尾**；
 *   ② 首页题材热力日历：行（题材）顺序**同一段代码**（因此同一个题材在两处的相对位置一致）。
 *
 * 🔴 两处的次级键必须**逐级相同**（2026-09-19 用户指出：「现在相同热度的题材，排序和下面的题材热力图排序不同，
 * 导致对不上」）⇒ 次序由 `compareSectorOrder` **单点定义**，两处都只调它：
 *   ① 非压尾档在前（`TAIL_SECTORS`）→ ② **当日**涨停家数降序 → ③ **窗口内合计**降序 → ④ **题材名**升序。
 * ④ 用 `localeCompare` 兜底 ⇒ 这是**全序**（题材名不可能重复），两处的相对次序**不可能**分叉。
 * 梯队另加「封板时间 → 代码」作 `tieBreak`，它只在**同一题材内部**生效 —— 所以同一题材的格子依然挨在一起、
 * 组内仍按封板时间升序，**不会**因为引入次级键被打散。
 *
 * 数据源 = `limitUp.getSectorDistribution`（当日切片与窗口合计同出一源）。该接口服务端已走
 * `normalizeSectorName`，与 `limitUp.getBoardRoster` 的题材同名 ⇒ 可直接按字符串查表。
 *
 * 为什么**不**拿「合计」当主键：合计把窗口内 30 天拉平，热点换题材后排序会滞后；
 * 用户要求「按当日数据」⇒ 主键是**当日**热度，合计只作**同热度时的次键**。
 */

/** 单日题材分布切片（= `limitUp.getSectorDistribution` 的 `day`）。 */
export type SectorHeatDay = { date: string; sectors: readonly { sector: string; count: number }[] };

/** 题材 → 当日家数（`null` = 该题材在所选日期没出现）+ 窗口内合计。 */
export type SectorHeatEntry = { dayCount: number | null; windowTotal: number };

/** 题材 → 热度条目。 */
export type SectorHeatLookup = ReadonlyMap<string, SectorHeatEntry>;

/**
 * 「兜底桶」题材 —— **无论当日热度多高，都排在最后**（2026-09-19 用户要求在首页连板梯队里把
 * 「其他」放到每个高度的末尾）。
 *
 * 为什么单独占一档：`normalizeSectorName`（`@shared/stockDataNormalization`）的缺省值就是「其他」，
 * 它代表**无题材归属**的个股，不是真实热点；但家数往往不少，纯按热度排会挤到组内最前、把真热点
 * 挤下去 ⇒ 让它不参与热度名次，整体压到组内末尾。压尾档**内部**仍按「当日 → 合计 → 名称」排。
 */
export const TAIL_SECTORS: readonly string[] = ["其他"];

/** 是否属于压尾题材（兜底桶）。精确匹配 —— 上游题材名已由 `normalizeSectorName` 去空白。 */
export function isTailSector(sector: string): boolean {
  return TAIL_SECTORS.includes(sector);
}

/**
 * 由「窗口内逐日题材分布」+「所选日期」构建查表：两个键都来自**同一遍扫描**（避免两处各算一遍而分叉）。
 * `date` 不在 `days` 里（例如选到热力窗口之外）⇒ 所有 `dayCount` 保持 `null`（热度 -1）。
 */
export function buildSectorHeatLookup(
  days: readonly SectorHeatDay[] | null | undefined,
  date: string | null | undefined,
): SectorHeatLookup {
  const map = new Map<string, SectorHeatEntry>();
  const ensure = (sector: string): SectorHeatEntry => {
    const found = map.get(sector);
    if (found) return found;
    const created: SectorHeatEntry = { dayCount: null, windowTotal: 0 };
    map.set(sector, created);
    return created;
  };

  for (const day of days ?? []) {
    for (const item of day.sectors) ensure(item.sector).windowTotal += item.count;
  }
  for (const item of (days ?? []).find((day) => day.date === date)?.sectors ?? []) {
    ensure(item.sector).dayCount = item.count;
  }
  return map;
}

/**
 * 取某题材的**当日**热度。
 * ⚠️ 缺该日数据取 **-1** 而不是 0：必须**低于**任何真实热度（当日「0 家」的真值就是 0），
 * 否则「窗口内有热度、当日没出现」会和一个从未出现的题材并列。
 */
export function sectorHeatOf(lookup: SectorHeatLookup, sector: string): number {
  return lookup.get(sector)?.dayCount ?? -1;
}

/** 取某题材的**窗口内合计**（只在当日热度相同时才轮到它）。缺该题材 ⇒ -1（同样低于真实合计 0）。 */
export function sectorWindowTotalOf(lookup: SectorHeatLookup, sector: string): number {
  return lookup.get(sector)?.windowTotal ?? -1;
}

/**
 * **题材次序 —— 全项目唯一口径**（连板梯队组内 + 热力图行序共用）。
 * ① 非压尾档在前 → ② 当日热度降序 → ③ 窗口合计降序 → ④ 题材名升序。
 */
export function compareSectorOrder(lookup: SectorHeatLookup, a: string, b: string): number {
  const tail = Number(isTailSector(a)) - Number(isTailSector(b));
  if (tail !== 0) return tail;
  const day = sectorHeatOf(lookup, b) - sectorHeatOf(lookup, a);
  if (day !== 0) return day;
  const total = sectorWindowTotalOf(lookup, b) - sectorWindowTotalOf(lookup, a);
  if (total !== 0) return total;
  return a.localeCompare(b);
}

/**
 * 生成「按题材次序升序」的比较器，`Array#sort` 直接可用。
 * `tieBreak` **只在同一题材内部**生效（梯队用它排封板时间 / 代码）；不传视为相等（引擎保持相对次序）。
 */
export function compareBySectorHeat<T extends { sector: string }>(
  lookup: SectorHeatLookup,
  tieBreak?: (a: T, b: T) => number,
): (a: T, b: T) => number {
  return (a, b) => {
    const bySector = compareSectorOrder(lookup, a.sector, b.sector);
    if (bySector !== 0) return bySector;
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
