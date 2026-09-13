/**
 * clientPagination 单测。
 *
 * 覆盖重点是**「越界绝不返回空页」**这条硬性质 —— 它是「删行 / 调大每页条数后
 * 表格突然空白」这类缺陷的唯一防线；以及 `totalPages` 在空集合上的取值必须与
 * `PaginationBar` 的 `Math.max(1, totalPages)` 一致（否则两处会各自 `|| 1` 漂移）。
 *
 * 不锁定任何 UI 文案。
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  clampPage,
  pageRangeLabel,
  paginate,
  totalPagesOf,
} from "@/components/research/clientPagination";

const N180 = Array.from({ length: 180 }, (_unused, i) => i + 1);

describe("totalPagesOf", () => {
  it("空集合算 1 页（与 PaginationBar 的 Math.max(1, …) 同源）", () => {
    expect(totalPagesOf(0, 20)).toBe(1);
  });

  it("整除与不整除都向上取整", () => {
    expect(totalPagesOf(40, 20)).toBe(2);
    expect(totalPagesOf(41, 20)).toBe(3);
    expect(totalPagesOf(1, 20)).toBe(1);
  });

  it("180 条 / 每页 20 = 9 页（真实 Run #7 的规模）", () => {
    expect(totalPagesOf(180, DEFAULT_PAGE_SIZE)).toBe(9);
  });

  it("非法 pageSize / totalCount 一律回落到 1 页，不抛异常、不返回 NaN", () => {
    for (const badSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(totalPagesOf(100, badSize)).toBe(1);
    }
    expect(totalPagesOf(Number.NaN, 20)).toBe(1);
    expect(totalPagesOf(-5, 20)).toBe(1);
  });
});

describe("clampPage", () => {
  it("把越界页码夹进 [1, totalPages]", () => {
    expect(clampPage(0, 180, 20)).toBe(1);
    expect(clampPage(-3, 180, 20)).toBe(1);
    expect(clampPage(99, 180, 20)).toBe(9);
  });

  it("合法页码原样返回", () => {
    expect(clampPage(5, 180, 20)).toBe(5);
  });

  it("非法页码（NaN / ±Infinity）一律回落到第 1 页", () => {
    // 注意：Infinity **不**被夹取到末页，而是当垃圾输入处理 —— `Number.isFinite`
    // 为 false 时直接回落首页，语义是「不知道要看第几页就从第一页开始」。
    expect(clampPage(Number.NaN, 180, 20)).toBe(1);
    expect(clampPage(Number.POSITIVE_INFINITY, 180, 20)).toBe(1);
    expect(clampPage(Number.NEGATIVE_INFINITY, 180, 20)).toBe(1);
  });

  it("小数页码向下取整", () => {
    expect(clampPage(3.9, 180, 20)).toBe(3);
  });
});

describe("paginate", () => {
  it("切出首页且行数正确", () => {
    const s = paginate(N180, 1, 20);
    expect(s.rows.length).toBe(20);
    expect(s.rows[0]).toBe(1);
    expect(s.rows[19]).toBe(20);
    expect(s.totalPages).toBe(9);
    expect(s.page).toBe(1);
  });

  it("最后一页只取余下的行（180 = 9×20 恰好整除）", () => {
    const s = paginate(N180, 9, 20);
    expect(s.rows.length).toBe(20);
    expect(s.rows[0]).toBe(161);
    expect(s.rows[19]).toBe(180);
  });

  it("不整除时最后一页取余数", () => {
    const s = paginate(N180, 7, 26);
    expect(s.totalPages).toBe(7);
    expect(s.rows.length).toBe(180 - 6 * 26);
  });

  it("🔴 越界页码被夹取后仍返回真实行，绝不返回空页", () => {
    // 删到只剩 30 条，但 page 仍是旧的第 5 页
    const shrunk = N180.slice(0, 30);
    const s = paginate(shrunk, 5, 20);
    expect(s.page).toBe(2); // 30 条 / 20 = 2 页
    expect(s.rows.length).toBe(10);
    expect(s.rows).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  });

  it("每页条数调大后旧页码同样被夹取", () => {
    const s = paginate(N180, 9, 200); // 200 条一页 ⇒ 只有 1 页
    expect(s.page).toBe(1);
    expect(s.rows.length).toBe(180);
  });

  it("空集合：1 页、0 行、序号为 0", () => {
    const s = paginate([], 1, 20);
    expect(s.rows).toEqual([]);
    expect(s.totalPages).toBe(1);
    expect(s.page).toBe(1);
    expect(s.startIndex).toBe(0);
    expect(s.endIndex).toBe(0);
    expect(s.totalCount).toBe(0);
  });

  it("startIndex / endIndex 是 1-based 且与当前页对齐", () => {
    const first = paginate(N180, 1, 20);
    expect([first.startIndex, first.endIndex]).toEqual([1, 20]);
    const mid = paginate(N180, 3, 20);
    expect([mid.startIndex, mid.endIndex]).toEqual([41, 60]);
    const last = paginate(N180, 9, 20);
    expect([last.startIndex, last.endIndex]).toEqual([161, 180]);
  });

  it("纯函数：不改入参、同输入同输出", () => {
    const input = N180.slice(0, 5);
    const snapshot = [...input];
    const a = paginate(input, 1, 2);
    const b = paginate(input, 1, 2);
    expect(input).toEqual(snapshot);
    expect(a.rows).toEqual(b.rows);
  });

  it("每页条数非法时回落到默认值", () => {
    const s = paginate(N180, 1, 0);
    expect(s.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(s.rows.length).toBe(20);
  });
});

describe("pageRangeLabel", () => {
  it("非空集合给出「第 a ~ b 条 · 共 n 条」", () => {
    const s = paginate(N180, 2, 20);
    expect(pageRangeLabel(s)).toBe("第 21 ~ 40 条 · 共 180 条");
  });

  it("空集合只说条数，不编造区间", () => {
    expect(pageRangeLabel(paginate([], 1, 20))).toBe("共 0 条");
  });
});

describe("常量纪律", () => {
  it("默认每页 20，且档位升序包含默认值", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    const options = [...PAGE_SIZE_OPTIONS];
    expect(options).toContain(DEFAULT_PAGE_SIZE);
    expect(options).toEqual([...options].sort((a, b) => a - b));
  });
});
