import { describe, expect, it } from "vitest";
import {
  buildSectorHeatLookup,
  compareBySectorHeat,
  sectorHeatOf,
  sortBySectorHeat,
} from "../../shared/sectorHeatOrder";

/** 单日题材分布切片的形状（= `limitUp.getSectorDistribution` 的 `day`）。 */
const day = (sectors: Array<[string, number]>) => ({
  sectors: sectors.map(([sector, count]) => ({ sector, count })),
});

describe("当日题材热力排序", () => {
  it("按当日涨停家数降序；当日 0 家仍排在「从未出现」之前", () => {
    const lookup = buildSectorHeatLookup(day([["机器人", 5], ["固态电池", 2], ["房地产", 0]]));
    expect(sectorHeatOf(lookup, "机器人")).toBe(5);
    expect(sectorHeatOf(lookup, "房地产")).toBe(0);
    expect(sectorHeatOf(lookup, "查无此题材")).toBe(-1);

    const rows = [
      { sector: "查无此题材" },
      { sector: "房地产" },
      { sector: "固态电池" },
      { sector: "机器人" },
    ];
    expect(sortBySectorHeat(rows, lookup).map((row) => row.sector)).toEqual([
      "机器人",
      "固态电池",
      "房地产",
      "查无此题材",
    ]);
  });

  it("缺该日数据（空表）⇒ 全 -1，顺序交给 tieBreak，且不丢项", () => {
    const lookup = buildSectorHeatLookup(undefined);
    expect(sectorHeatOf(lookup, "机器人")).toBe(-1);
    const rows = [
      { sector: "B", rank: 2 },
      { sector: "A", rank: 1 },
    ];
    expect(sortBySectorHeat(rows, lookup, (a, b) => a.rank - b.rank).map((row) => row.sector)).toEqual(["A", "B"]);
    expect(sortBySectorHeat(rows, lookup)).toHaveLength(2);
  });

  it("同热度内按 tieBreak（梯队用封板时间、热力图用合计）", () => {
    const lookup = buildSectorHeatLookup(day([["机器人", 3], ["固态电池", 3]]));
    const ladder = [
      { sector: "固态电池", stockCode: "600001.SH" },
      { sector: "机器人", stockCode: "000001.SZ" },
    ];
    expect(
      sortBySectorHeat(ladder, lookup, (a, b) => a.stockCode.localeCompare(b.stockCode)).map((row) => row.stockCode),
    ).toEqual(["000001.SZ", "600001.SH"]);

    const heatmap = [
      { sector: "固态电池", total: 9 },
      { sector: "机器人", total: 30 },
    ];
    expect(sortBySectorHeat(heatmap, lookup, (a, b) => b.total - a.total).map((row) => row.sector)).toEqual([
      "机器人",
      "固态电池",
    ]);
  });

  it("比较器不改动入参数组（返回新数组）", () => {
    const lookup = buildSectorHeatLookup(day([["机器人", 1]]));
    const rows = [{ sector: "机器人" }, { sector: "房地产" }];
    const sorted = sortBySectorHeat(rows, lookup);
    expect(rows.map((row) => row.sector)).toEqual(["机器人", "房地产"]);
    expect(sorted).not.toBe(rows);
    expect(compareBySectorHeat(lookup)({ sector: "机器人" }, { sector: "机器人" })).toBe(0);
  });
});
