import { describe, expect, it } from "vitest";
import {
  buildSectorHeatLookup,
  compareBySectorHeat,
  isTailSector,
  sectorHeatOf,
  sectorWindowTotalOf,
  sortBySectorHeat,
} from "../../shared/sectorHeatOrder";

/** 单日题材分布切片的形状（= `limitUp.getSectorDistribution` 的 `day`）。 */
const day = (date: string, sectors: Array<[string, number]>) => ({
  date,
  sectors: sectors.map(([sector, count]) => ({ sector, count })),
});

const dedupe = (values: readonly string[]): string[] => [...new Set(values)];

describe("题材次序（连板梯队组内 + 热力图行序共用唯一口径）", () => {
  it("主键 = 当日涨停家数降序；当日 0 家仍排在「从未出现」之前", () => {
    const lookup = buildSectorHeatLookup([day("2026-09-18", [["机器人", 5], ["固态电池", 2], ["房地产", 0]])], "2026-09-18");
    expect(sectorHeatOf(lookup, "机器人")).toBe(5);
    expect(sectorHeatOf(lookup, "房地产")).toBe(0);
    expect(sectorHeatOf(lookup, "查无此题材")).toBe(-1);

    const rows = [{ sector: "查无此题材" }, { sector: "房地产" }, { sector: "固态电池" }, { sector: "机器人" }];
    expect(sortBySectorHeat(rows, lookup).map((row) => row.sector)).toEqual([
      "机器人",
      "固态电池",
      "房地产",
      "查无此题材",
    ]);
  });

  it("次键 = 窗口内合计降序（只在当日热度相同时才轮到它）", () => {
    const lookup = buildSectorHeatLookup(
      [day("2026-09-18", [["A", 3], ["B", 3]]), day("2026-09-17", [["B", 6]])],
      "2026-09-18",
    );
    expect(sectorWindowTotalOf(lookup, "A")).toBe(3);
    expect(sectorWindowTotalOf(lookup, "B")).toBe(9);
    expect(sectorWindowTotalOf(lookup, "查无此题材")).toBe(-1);
    expect(sortBySectorHeat([{ sector: "A" }, { sector: "B" }], lookup).map((row) => row.sector)).toEqual(["B", "A"]);
  });

  it("末键 = 题材名升序（当日热度与窗口合计都相同）", () => {
    const lookup = buildSectorHeatLookup([day("2026-09-18", [["B", 4], ["A", 4]])], "2026-09-18");
    expect(sortBySectorHeat([{ sector: "B" }, { sector: "A" }], lookup).map((row) => row.sector)).toEqual(["A", "B"]);
  });

  it("选到热力窗口之外的日期 ⇒ 当日热度全 -1，次序退化为「合计 → 名称」，且不丢项", () => {
    const lookup = buildSectorHeatLookup([day("2026-09-18", [["A", 3], ["B", 9]])], "2020-01-01");
    expect(sectorHeatOf(lookup, "A")).toBe(-1);
    const rows = [{ sector: "A" }, { sector: "B" }];
    expect(sortBySectorHeat(rows, lookup).map((row) => row.sector)).toEqual(["B", "A"]);
    expect(sortBySectorHeat(rows, lookup)).toHaveLength(2);
    expect(sortBySectorHeat(rows, lookup)).not.toBe(rows);
  });

  it("「其他」兜底桶永远压尾 —— 哪怕它当日热度与窗口合计都最大", () => {
    const lookup = buildSectorHeatLookup([day("2026-09-18", [["其他", 9], ["机器人", 5]])], "2026-09-18");
    expect(sortBySectorHeat([{ sector: "其他" }, { sector: "机器人" }], lookup).map((row) => row.sector)).toEqual([
      "机器人",
      "其他",
    ]);
  });

  it("压尾档内部仍按「当日 → 合计 → 名称」排", () => {
    const lookup = buildSectorHeatLookup(
      [day("2026-09-18", [["其他", 4], ["A", 1]]), day("2026-09-17", [["其他", 6]])],
      "2026-09-18",
    );
    // 「其他」合计 10、当日 4；A 合计 1、当日 1 ⇒ A 前、其他 后（压尾挡在 A 之后）。
    expect(sortBySectorHeat([{ sector: "其他" }, { sector: "A" }], lookup).map((row) => row.sector)).toEqual([
      "A",
      "其他",
    ]);
    expect(sectorWindowTotalOf(lookup, "其他")).toBe(10);
  });

  it("梯队的 tieBreak 只在**同一题材内部**生效：不把不同题材的格子交错开", () => {
    const lookup = buildSectorHeatLookup(
      [day("2026-09-18", [["X", 3], ["Y", 3]]), day("2026-09-17", [["X", 9]])],
      "2026-09-18",
    );
    const rows = [
      { sector: "Y", time: "09:31" },
      { sector: "X", time: "10:05" },
      { sector: "X", time: "09:35" },
    ];
    // X 合计 12 > Y 合计 3 ⇒ X 整块在前；X 内部按封板时间升序（09:35 在 10:05 之前）。
    expect(
      sortBySectorHeat(rows, lookup, (a, b) => a.time.localeCompare(b.time)).map((row) => `${row.sector}#${row.time}`),
    ).toEqual(["X#09:35", "X#10:05", "Y#09:31"]);
  });

  it("🔴 回归（用户报的「对不上」）：同一热度下，梯队去重后的题材次序 == 热力图行序", () => {
    const lookup = buildSectorHeatLookup(
      [
        day("2026-09-18", [["甲", 3], ["乙", 3], ["丙", 3], ["丁", 1]]),
        day("2026-09-17", [["乙", 5], ["丙", 2]]),
      ],
      "2026-09-18",
    );
    // 热力图行序（全部题材按同一比较器排；当日都 3 家的三个题材靠「合计」分开：8 / 5 / 3）
    const heatOrder = sortBySectorHeat(
      ["甲", "乙", "丙", "丁"].map((sector) => ({ sector })),
      lookup,
    ).map((row) => row.sector);
    expect(heatOrder).toEqual(["乙", "丙", "甲", "丁"]);

    // 梯队：同一高度行内每股一格（输入故意乱序、同题材不相邻），去重后必须与热力图**同序**
    const ladder = [
      { sector: "丁", time: "09:31" },
      { sector: "丙", time: "09:35" },
      { sector: "甲", time: "09:40" },
      { sector: "乙", time: "10:05" },
    ];
    const ladderOrder = dedupe(
      sortBySectorHeat(ladder, lookup, (a, b) => a.time.localeCompare(b.time)).map((row) => row.sector),
    );
    expect(ladderOrder).toEqual(heatOrder);
  });

  it("isTailSector 只认兜底桶本身，不做前缀匹配", () => {
    expect(isTailSector("其他")).toBe(true);
    expect(isTailSector("其他题材")).toBe(false);
    expect(isTailSector("机器人")).toBe(false);
  });

  it("同题材同热度视为相等（引擎保持相对次序）", () => {
    const lookup = buildSectorHeatLookup([day("2026-09-18", [["机器人", 1]])], "2026-09-18");
    expect(compareBySectorHeat(lookup)({ sector: "机器人" }, { sector: "机器人" })).toBe(0);
  });
});
