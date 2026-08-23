import { describe, expect, it } from "vitest";
import { buildDistinctHighBoardLabels } from "../client/src/lib/highBoardLabels";

describe("buildDistinctHighBoardLabels", () => {
  it("同一股票连续达到6板及以上时仅在首次达到阈值的日期标注", () => {
    const labels = buildDistinctHighBoardLabels([
      { date: "2026-08-10", maxBoards: 6, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
      { date: "2026-08-11", maxBoards: 7, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
      { date: "2026-08-12", maxBoards: 8, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
    ]);

    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      date: "2026-08-10",
      labelCodes: ["600001.SH"],
      labelNames: ["主板甲"],
    });
  });

  it("高连板阶段中新增的股票仍会显示一次名称", () => {
    const labels = buildDistinctHighBoardLabels([
      { date: "2026-08-10", maxBoards: 6, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
      { date: "2026-08-11", maxBoards: 7, stockCodes: ["600001.SH", "600002.SH"], stockNames: ["主板甲", "主板乙"] },
    ]);

    expect(labels).toHaveLength(2);
    expect(labels[1]).toMatchObject({
      date: "2026-08-11",
      labelCodes: ["600002.SH"],
      labelNames: ["主板乙"],
    });
  });

  it("中断后再次达到6板及以上时允许重新标注", () => {
    const labels = buildDistinctHighBoardLabels([
      { date: "2026-08-10", maxBoards: 6, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
      { date: "2026-08-11", maxBoards: 5, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
      { date: "2026-08-12", maxBoards: 6, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
    ]);

    expect(labels.map((item) => item.date)).toEqual(["2026-08-10", "2026-08-12"]);
  });
});
