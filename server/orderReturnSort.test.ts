import { describe, expect, it } from "vitest";
import { nextOrderReturnSortDirection, sortOrdersByNetReturn } from "../client/src/lib/orderReturnSort";

describe("订单收益率排序", () => {
  const orders = [
    { id: "pending-a", netReturn: null },
    { id: "profit", netReturn: 12.5 },
    { id: "loss", netReturn: -4.2 },
    { id: "pending-b", netReturn: null },
    { id: "flat", netReturn: 0 },
  ];

  it("按收益率降序排列，且收益待定订单稳定置于末尾", () => {
    expect(sortOrdersByNetReturn(orders, "desc").map((order) => order.id)).toEqual([
      "profit", "flat", "loss", "pending-a", "pending-b",
    ]);
  });

  it("按收益率升序排列，并保持相同空收益订单的原始顺序", () => {
    expect(sortOrdersByNetReturn(orders, "asc").map((order) => order.id)).toEqual([
      "loss", "flat", "profit", "pending-a", "pending-b",
    ]);
  });

  it("在未排序或升序状态点击表头时切换为降序，在降序时切换为升序", () => {
    expect(nextOrderReturnSortDirection("none")).toBe("desc");
    expect(nextOrderReturnSortDirection("asc")).toBe("desc");
    expect(nextOrderReturnSortDirection("desc")).toBe("asc");
  });
});
