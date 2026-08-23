import { describe, expect, it } from "vitest";
import { buildDistinctHighBoardLabels } from "../client/src/lib/highBoardLabels";

describe("buildDistinctHighBoardLabels", () => {
  it("同一股票连续达到6板及以上时仅在阶段最高连板日期标注", () => {
    const labels = buildDistinctHighBoardLabels([
      { date: "2026-08-10", maxBoards: 6, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
      { date: "2026-08-11", maxBoards: 7, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
      { date: "2026-08-12", maxBoards: 8, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
    ]);

    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      date: "2026-08-12",
      labelCodes: ["600001.SH"],
      labelNames: ["主板甲"],
    });
  });

  it("同一最高连板节点的多只股票合并为一次名称标注", () => {
    const labels = buildDistinctHighBoardLabels([
      { date: "2026-08-10", maxBoards: 6, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
      { date: "2026-08-11", maxBoards: 7, stockCodes: ["600001.SH", "600002.SH"], stockNames: ["主板甲", "主板乙"] },
    ]);

    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      date: "2026-08-11",
      labelCodes: ["600001.SH", "600002.SH"],
      labelNames: ["主板甲", "主板乙"],
    });
  });

  it("连续阶段出现同板数最高点时选择较晚日期标注", () => {
    const labels = buildDistinctHighBoardLabels([
      { date: "2026-08-10", maxBoards: 6, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
      { date: "2026-08-11", maxBoards: 8, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
      { date: "2026-08-12", maxBoards: 8, stockCodes: ["600001.SH"], stockNames: ["主板甲"] },
    ]);

    expect(labels[0].date).toBe("2026-08-12");
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
