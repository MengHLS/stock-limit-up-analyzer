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

export type OrderSortKey = "signalDate" | "netReturn" | "pnlToEquityRatio";

export type SortableOrder = {
  signalDate: string;
  netReturn: number | null;
  pnlToEquityRatio?: number | null;
};

/**
 * 通用订单排序：按信号日（字符串）、收益率或盈亏占资金比（数值）稳定排序。
 * 数值类排序中 null 值（未成交/未出清）始终置于末尾，升序降序均不参与比较，保持原始相对顺序。
 */
export function sortOrdersByKey<T extends SortableOrder>(orders: T[], key: OrderSortKey, direction: OrderReturnSortDirection): T[] {
  if (direction === "none") return orders;

  return orders
    .map((order, index) => ({ order, index }))
    .sort((left, right) => {
      if (key === "signalDate") {
        const difference = direction === "asc"
          ? left.order.signalDate.localeCompare(right.order.signalDate)
          : right.order.signalDate.localeCompare(left.order.signalDate);
        return difference || left.index - right.index;
      }
      const leftValue = key === "netReturn" ? left.order.netReturn : (left.order.pnlToEquityRatio ?? null);
      const rightValue = key === "netReturn" ? right.order.netReturn : (right.order.pnlToEquityRatio ?? null);
      if (leftValue === null && rightValue === null) return left.index - right.index;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      const difference = direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
      return difference || left.index - right.index;
    })
    .map(({ order }) => order);
}

