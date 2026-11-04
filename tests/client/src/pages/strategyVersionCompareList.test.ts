import { describe, expect, it } from "vitest";
import {
  compareStrategyVersionDesc,
  selectVisibleVersionRows,
  sortStrategyVersionRowsForDisplay,
  VERSION_COMPARE_PAGE_SIZE,
} from "@/pages/strategyVersionCompareList";

interface Row {
  key: string;
  version: string;
  isStarred: boolean;
}

function row(
  version: string,
  isStarred = false,
): Row {
  return { key: `version-${version}`, version, isStarred };
}

describe("版本回测对比页：列表模式", () => {
  it("版本号按数字段降序（1.10 排在 1.9 之前）", () => {
    expect(compareStrategyVersionDesc("1.10.0", "1.9.0")).toBeLessThan(0);
    expect(compareStrategyVersionDesc("1.9.0", "1.10.0")).toBeGreaterThan(0);
    expect(compareStrategyVersionDesc("1.0.0", "1.0.0")).toBe(0);
  });

  it("加星版本置顶，组内仍按版本号降序", () => {
    const sorted = sortStrategyVersionRowsForDisplay([
      row("3.0.0"),
      row("2.0.0", true),
      row("4.0.0"),
      row("1.0.0", true),
    ]);
    expect(sorted.map(item => item.version)).toEqual([
      "2.0.0",
      "1.0.0",
      "4.0.0",
      "3.0.0",
    ]);
  });

  it("分页模式只返回当前页；展开全部返回所有行", () => {
    const rows = Array.from({ length: 30 }, (_unused, index) =>
      row(`${30 - index}.0.0`),
    );
    expect(
      selectVisibleVersionRows(rows, {
        showAll: false,
        page: 2,
        pageSize: VERSION_COMPARE_PAGE_SIZE,
      }),
    ).toHaveLength(VERSION_COMPARE_PAGE_SIZE);
    expect(
      selectVisibleVersionRows(rows, {
        showAll: false,
        page: 2,
        pageSize: VERSION_COMPARE_PAGE_SIZE,
      })[0]?.version,
    ).toBe("18.0.0");
    expect(
      selectVisibleVersionRows(rows, {
        showAll: true,
        page: 2,
        pageSize: VERSION_COMPARE_PAGE_SIZE,
      }),
    ).toEqual(rows);
  });

  it("星标版本同样参与置顶排序", () => {
    const sorted = sortStrategyVersionRowsForDisplay([
      row("4.0.0"),
      row("1.62.1", true),
      row("3.0.0"),
    ]);
    expect(sorted.map(item => item.version)).toEqual([
      "1.62.1",
      "4.0.0",
      "3.0.0",
    ]);
  });
});
