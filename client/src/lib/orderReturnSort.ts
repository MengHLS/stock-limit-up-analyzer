export type OrderReturnSortDirection = "none" | "asc" | "desc";

type ReturnSortableOrder = { netReturn: number | null };

/**
 * 对已有筛选结果按净收益率稳定排序。收益待定的订单始终放在已知收益订单之后，
 * 以免未出清或未成交订单因空值影响策略绩效观察。
 */
export function sortOrdersByNetReturn<T extends ReturnSortableOrder>(orders: T[], direction: OrderReturnSortDirection): T[] {
  if (direction === "none") return orders;

  return orders
    .map((order, index) => ({ order, index }))
    .sort((left, right) => {
      const leftValue = left.order.netReturn;
      const rightValue = right.order.netReturn;
      if (leftValue === null && rightValue === null) return left.index - right.index;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      const difference = direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
      return difference || left.index - right.index;
    })
    .map(({ order }) => order);
}

export function nextOrderReturnSortDirection(direction: OrderReturnSortDirection): Exclude<OrderReturnSortDirection, "none"> {
  return direction === "desc" ? "asc" : "desc";
}
