/**
 * STEP 11 / Work G — Portfolio Corporate Action Transformation（最小设计参考实现）。
 *
 * 边界铁律（本审计的核心结论）：
 *   - 价格复权层（engine.ts）：只负责「历史价格连续性」，绝不改持仓/现金。
 *   - 组合公司行为层（本文件）：只负责「真实持仓/现金/成本基变换」，绝不改历史价格。
 *   两层必须保持边界，不能把「送转拆配」简单退化为「价格复权」。
 *
 * 本文件是「最小设计」的纯函数参考，用于证明语义可被精确定义并测试。当前**尚未接入**
 * STEP 8 Portfolio / STEP 9 PortfolioAccount / Backtest 引擎主循环，属 integration gap
 * （详见 STEP_11 审计报告）。
 *
 * 会计约定（A 股，税前、每股口径）：
 *   - 现金分红 dividend：现金 += D × q；股数不变；成本基不变（分红是收益，非资本返还）；
 *     averageCost 不变。
 *   - 送股 bonus / 转增 transfer：股数 ×(1+ratio)；现金不变；成本基不变 → averageCost 摊薄。
 *   - 配股 rights_issue：股数 ×(1+s)；现金 -= s×q×rightsPrice（认购支出）；成本基 += 认购支出。
 *   - 拆股 split（1 拆 N）：股数 ×N；现金不变；成本基不变 → averageCost ÷N。
 *   - 合股 reverse_split（N 合 1）：股数 ÷N；现金不变；成本基不变 → averageCost ×N。
 *   - 公司行为本身不产生已实现盈亏（realizedPnLDelta 恒 0）；已实现盈亏只在真实卖出时结转。
 *
 * 不变量（可测试）：
 *   - 非现金事件（送/转/拆/合）总成本基不变。
 *   - 现金分红使现金增加 D×q，成本基不变，权益在除权日连续。
 *   - 拆/合股后，以复权价卖出所得的已实现盈亏与未拆基准一致（经济等价）。
 */

import type { CorporateAction } from "./types";

/** 持仓会计状态（最小字段：股数 / 成本基 / 均价 / 已实现盈亏）。 */
export interface PositionState {
  /** 总股数（股）。 */
  quantity: number;
  /** 总成本基（含买入费用，元）。 */
  costBasis: number;
  /** 加权平均成本（元/股）。 */
  averageCost: number;
  /** 累计已实现盈亏（元）。 */
  realizedPnL: number;
}

/** 公司行为应用到持仓后的结果。 */
export interface PositionTransformResult {
  /** 变换后持仓（新对象，不修改入参）。 */
  position: PositionState;
  /** 现金净变动（元）：现金分红为正，配股认购为负，其余 0。 */
  cashDelta: number;
  /** 股数净变动（股）：送/转/配/拆为正，合股为负。 */
  shareDelta: number;
  /** 本次公司行为直接产生的已实现盈亏（恒为 0：公司行为不是卖出）。 */
  realizedPnLDelta: number;
  /** 语义说明（审计可读）。 */
  notes: string[];
}

function assertValidPosition(position: PositionState): void {
  if (!Number.isFinite(position.quantity) || position.quantity <= 0) {
    throw new Error("portfolioTransform: quantity 必须为正");
  }
  if (!Number.isFinite(position.costBasis) || position.costBasis < 0) {
    throw new Error("portfolioTransform: costBasis 必须 >= 0");
  }
}

function requireSplitRatio(action: CorporateAction): number {
  const n = action.splitRatio;
  if (n === null || !Number.isFinite(n) || n <= 0) {
    throw new Error(`portfolioTransform: ${action.actionType} 缺 splitRatio 或非法`);
  }
  return n;
}

/**
 * 把一组**同一 effectiveDate** 的事件合并为「一次除权除息」应用到持仓。
 *
 * 语义与 price 复权层的 `computeGroupForwardFactor` 对齐：
 *   - 现金/送/转/配 作用于同一 base 股数（登记日持股），非顺序复利。
 *   - 拆/合股 作为独立乘数叠乘（A 股实际不与送转配同日出现）。
 */
function applySameDayGroupToPosition(
  position: PositionState,
  actions: readonly CorporateAction[],
): PositionTransformResult {
  assertValidPosition(position);
  const baseQ = position.quantity;
  const notes: string[] = [];

  let cash = 0;
  let bonus = 0;
  let transfer = 0;
  let rights = 0;
  let rightsValue = 0;
  let splitMul = 1;

  for (const action of actions) {
    switch (action.actionType) {
      case "dividend":
        cash += action.cashAmount ?? 0;
        break;
      case "bonus_issue":
        bonus += action.bonusRatio ?? 0;
        break;
      case "transfer":
        transfer += action.transferRatio ?? 0;
        break;
      case "rights_issue": {
        const s = action.rightsRatio ?? 0;
        const pr = action.rightsPrice ?? 0;
        rights += s;
        rightsValue += s * pr;
        break;
      }
      case "split":
        splitMul *= requireSplitRatio(action);
        break;
      case "reverse_split":
        splitMul /= requireSplitRatio(action);
        break;
      default:
        // "other" / 未知：保守不变换。
        notes.push(`忽略未识别公司行为类型：${action.actionType}`);
        break;
    }
  }

  const dividendCash = cash * baseQ;
  const subscriptionCost = rightsValue * baseQ;
  const ratioNewShares = (bonus + transfer + rights) * baseQ;

  const newQuantity = baseQ * (1 + bonus + transfer + rights) * splitMul;
  const newCostBasis = position.costBasis + subscriptionCost;

  notes.push(
    `同日事件：现金 ${cash} 元/股、送 ${bonus}、转 ${transfer}、配 ${rights}、拆合乘数 ${splitMul}`,
  );

  return {
    position: {
      quantity: newQuantity,
      costBasis: newCostBasis,
      averageCost: newCostBasis / newQuantity,
      realizedPnL: position.realizedPnL,
    },
    cashDelta: dividendCash - subscriptionCost,
    shareDelta: newQuantity - baseQ,
    realizedPnLDelta: 0,
    notes,
  };
}

/**
 * 应用单一公司行为到持仓（纯函数，返回新对象，不修改入参）。
 * 等价于 `applyCorporateActionsToPosition(position, [action])`。
 */
export function applyCorporateActionToPosition(
  position: PositionState,
  action: CorporateAction,
): PositionTransformResult {
  return applySameDayGroupToPosition(position, [action]);
}

/**
 * 应用一组公司行为到持仓：按 effectiveDate 分组，逐组（逐次除权除息）应用。
 * 跨日事件顺序应用（每生效日一次变换）；同日事件合并为一次。
 */
export function applyCorporateActionsToPosition(
  position: PositionState,
  actions: readonly CorporateAction[],
): PositionTransformResult {
  assertValidPosition(position);
  if (actions.length === 0) {
    return {
      position: { ...position },
      cashDelta: 0,
      shareDelta: 0,
      realizedPnLDelta: 0,
      notes: ["无公司行为"],
    };
  }
  // 按 effectiveDate 分组（复用排序后的稳定分组逻辑）。
  const groups = new Map<string, CorporateAction[]>();
  for (const action of actions) {
    const list = groups.get(action.effectiveDate);
    if (list) list.push(action);
    else groups.set(action.effectiveDate, [action]);
  }
  const sortedGroups = Array.from(groups.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  let current: PositionState = { ...position };
  let cashDelta = 0;
  let shareDelta = 0;
  const allNotes: string[] = [];
  for (const [, groupActions] of sortedGroups) {
    const result = applySameDayGroupToPosition(current, groupActions);
    current = result.position;
    cashDelta += result.cashDelta;
    shareDelta += result.shareDelta;
    allNotes.push(...result.notes);
  }
  return { position: current, cashDelta, shareDelta, realizedPnLDelta: 0, notes: allNotes };
}
