/**
 * STEP 23 / C-23.1 — 模拟账户：订单 → 成交的约束检查 + 六维贴近实盘能力矩阵。
 *
 * 核心职责（贴近实盘的 Execution / Risk 两维）：
 *   - checkPaperOrder：把「订单 → 成交」的账户层约束检查做成确定性纯函数，检查
 *     一手股数（100 整数倍）、涨跌停拒单、停牌拒单、T+1 可卖、资金不足、并发持仓
 *     上限、单票/总仓位占比上限、禁买/禁卖标的集。合法返回 ok，非法返回稳定
 *     rejectionCode（不抛裸错），并把「本次实际执行的约束轴」写入 enforcedAxes，
 *     「声明但仅记录的约束轴」写入 recordedOnlyAxes，供成交流审计。
 *   - describePaperAccountConstraintEnforcement：账户层六维能力矩阵，如实声明哪些
 *     约束在账户层强制执行、哪些仅记录不强制执行（诚实 blocker，绝不冒充）。
 *
 * 与 C-14.3 的差距判定（诚实，见 describe 函数注释）：
 *   C-14.3 describeExecutionConstraintCoverage 针对 **C-14.1 plan 层**（无逐仓市值、
 *   无标的级过滤点）标 blocker 的轴 = perSecurityEquityCap / totalEquityCap /
 *   buyBanned / sellBanned。但账户层（C-23.1）**有逐仓市值与标的级检查点**，故这
 *   四轴在账户层是**可强制执行的**——这是能力差异，本目录如实声明 ENFORCED。
 *   而 timing.executionModel（成交时机）与 LIMIT_PRICE（限价撮合）依赖执行模型/
 *   逐单委托价，账户层只收「成交结果」，仍为 RECORDED_ONLY（不强制执行）。
 *
 * 涨跌停口径（显式引用，不重写）：
 *   复用 STEP 8 backtest/execution#limitState 的判定（engine/execution 的
 *   limitUpPrice/limitDownPrice，prevClose × (1 ± ratio)，不四舍五入到分），
 *   幅度解析复用 DEFAULT_MARKET_RULES.resolvePriceLimit（main ±10% / gem·star ±20% /
 *   bse ±30%），板块来自 C-14.3 声明 marketClaims.boards（缺省 main）。
 *
 * 铁律：纯函数、readonly 入参、无 IO/Date.now/Math.random。
 */

import type { Security } from "../../backtest/types";
import { DEFAULT_MARKET_RULES } from "../../backtest/marketRules";
import { limitDownPrice, limitUpPrice } from "../../engine/execution";
import { computeTradeCost } from "../../backtest/cost";
import { toEngineCostModel } from "../costModel/mappers";
import type { CostModelDeclaration } from "../costModel/types";
import type { ExecutionConstraintDeclaration } from "../executionConstraints/types";
import type {
  PaperAccount,
  PaperAccountOrder,
  PaperFillConstraintHits,
} from "./types";
import { PAPER_ACCOUNT_ERROR_CODES, PaperAccountError } from "./errors";

// ---------------------------------------------------------------------------
// 六维能力矩阵（诚实 blocker）
// ---------------------------------------------------------------------------

/** 六维（贴近实盘六维，对齐 ROADMAP §25 STEP 23）。 */
export type PaperSixDimension = "Signal" | "Position" | "Execution" | "Risk" | "Capital" | "Cost";

/** 账户层约束落地状态。 */
export type PaperEnforcementState = "ENFORCED" | "RECORDED_ONLY" | "NOT_DECLARED";

/** 账户层能力矩阵条目。 */
export interface PaperAccountConstraintEnforcementItem {
  /** 稳定轴标识（对齐 C-14.3 describeExecutionConstraintCoverage 的 key）。 */
  readonly key: string;
  /** 中文标签。 */
  readonly label: string;
  /** 所属六维。 */
  readonly dimension: PaperSixDimension;
  /** 账户层落地状态：ENFORCED=强制执行；RECORDED_ONLY=声明但仅记录；NOT_DECLARED=未设。 */
  readonly enforcement: PaperEnforcementState;
  /** 执行点 / 为何仅记录（人类可读）。 */
  readonly detail: string;
}

function item(
  key: string,
  label: string,
  dimension: PaperSixDimension,
  enforcement: PaperEnforcementState,
  detail: string
): PaperAccountConstraintEnforcementItem {
  return { key, label, dimension, enforcement, detail };
}

/**
 * 描述一份 C-14.3 执行约束声明在**账户层**的逐轴可执行性（纯函数）。
 */
export function describePaperAccountConstraintEnforcement(
  declaration: ExecutionConstraintDeclaration
): readonly PaperAccountConstraintEnforcementItem[] {
  const p = declaration.positions;
  const r = declaration.restrictions;
  const t = declaration.timing;
  return [
    // -- Signal 维（注入式记录，不做生成） --
    item("signal.source", "信号来源", "Signal", "RECORDED_ONLY",
      "信号由调用方注入（PaperSignalSource），账户层只记录不做生成（C-23.2 编排）"),

    // -- Position 维（持仓状态机 + T+1） --
    item("position.stateMachine", "持仓状态机", "Position", "ENFORCED",
      "开仓/加仓/减仓/清仓纯函数原语（applyPaperBuyFill/applyPaperSellFill）"),
    item("position.tPlus1", "T+1 冻结股", "Position", "ENFORCED",
      "当日买入进入 frozenQuantity，settlePaperAccountT1 次日解冻"),

    // -- Execution 维（订单 → 成交约束） --
    item("execution.lotSize", "一手股数（100 整数倍）", "Execution", "ENFORCED",
      "checkPaperOrder 校验 quantity % lotSize === 0（复用 C-14.3 DEFAULT_LOT_SIZE=100）"),
    item("execution.blockLimitUpBuy", "开盘涨停禁买", "Execution", "ENFORCED",
      "checkPaperOrder 按 STEP 8 limitState 口径拒单（LIMIT_UP）"),
    item("execution.blockLimitDownSell", "开盘跌停禁卖", "Execution", "ENFORCED",
      "checkPaperOrder 按 STEP 8 limitState 口径拒单（LIMIT_DOWN）"),
    item("execution.suspension", "停牌拒单", "Execution", "ENFORCED",
      "执行日无有效开盘/前收 → SUSPENDED（对齐 marketClaims.suspensionMode=REJECT_NO_BAR）"),
    item("execution.executionModel", "成交时机", "Execution", "RECORDED_ONLY",
      "成交时机（NEXT_OPEN/NEXT_CLOSE/VWAP_PROXY）由执行模型决定，账户层只收成交价"),
    item("execution.allowPartialFill", "允许部分成交", "Execution", "RECORDED_ONLY",
      "部分成交裁决属执行层，账户层按整单应用成交"),
    item("execution.limitPrice", "限价撮合", "Execution",
      t.executionModel === "LIMIT_PRICE" ? "RECORDED_ONLY" : "NOT_DECLARED",
      "LIMIT_PRICE 需逐单委托价撮合，账户层不提供撮合（requestedPrice 仅记录）"),

    // -- Risk 维（仓位上限 / 单票上限 / 总敞口 / 禁买禁卖） --
    item("risk.maxPositionCount", "并发持仓数上限", "Risk",
      p.maxPositionCount === null ? "NOT_DECLARED" : "ENFORCED",
      "checkPaperOrder 新开仓时校验持仓数（MAX_POSITIONS_REACHED）"),
    item("risk.perSecurityEquityCap", "单票权益占比上限", "Risk",
      p.perSecurityEquityCap === null ? "NOT_DECLARED" : "ENFORCED",
      "账户层有逐仓市值，买后单票市值/权益占比校验（C-14.1 plan 层无此能力）"),
    item("risk.totalEquityCap", "总仓位权益占比上限", "Risk",
      p.totalEquityCap === null ? "NOT_DECLARED" : "ENFORCED",
      "账户层有总权益，买后总仓位市值/权益占比校验（C-14.1 plan 层无此能力）"),
    item("risk.buyBanned", "禁买标的集", "Risk",
      r.buyBanned.length === 0 ? "NOT_DECLARED" : "ENFORCED",
      "账户层订单级检查点按标的过滤买入"),
    item("risk.sellBanned", "禁卖标的集", "Risk",
      r.sellBanned.length === 0 ? "NOT_DECLARED" : "ENFORCED",
      "账户层订单级检查点按标的过滤卖出"),

    // -- Capital 维（现金账本 + 冻结资金） --
    item("capital.initialCapital", "初始资金", "Capital", "ENFORCED",
      "createPaperAccount 起始现金 = initialCapital"),
    item("capital.cashLedger", "现金账本", "Capital", "ENFORCED",
      "每笔资金变动产出 PaperCashLedgerEntry（可追溯）"),
    item("capital.frozen", "冻结资金", "Capital", "ENFORCED",
      "freezePaperCash/unfreezePaperCash 挂单预留原语"),

    // -- Cost 维（五维成本分解复用 C-14.2） --
    item("cost.breakdown", "五维成本分解", "Cost", "ENFORCED",
      "复用 C-14.2 computeFillCostBreakdown（佣金/印花/过户/滑点/冲击）"),
  ];
}

// ---------------------------------------------------------------------------
// 涨跌停判定（复用 STEP 8 口径）
// ---------------------------------------------------------------------------

/** securityId → 板块（缺省 main）。 */
function boardOf(declaration: ExecutionConstraintDeclaration, securityId: string): Security["board"] {
  return declaration.marketClaims.boards[securityId] ?? "main";
}

/** 涨跌停幅度解析（复用 STEP 8 DEFAULT_MARKET_RULES）。 */
function priceLimitOf(declaration: ExecutionConstraintDeclaration, securityId: string): {
  readonly limitUpRatio: number;
  readonly limitDownRatio: number;
} {
  const board = boardOf(declaration, securityId);
  return DEFAULT_MARKET_RULES.resolvePriceLimit({ securityId, board }) ?? {
    limitUpRatio: 0,
    limitDownRatio: 0,
  };
}

// ---------------------------------------------------------------------------
// 订单 → 成交约束检查
// ---------------------------------------------------------------------------

/** 订单约束检查输入（全部由调用方在「执行日开盘前」已知信息装配，PIT 安全）。 */
export interface PaperOrderCheckInput {
  readonly order: PaperAccountOrder;
  readonly account: PaperAccount;
  readonly declaration: ExecutionConstraintDeclaration;
  readonly costDeclaration: CostModelDeclaration;
  /** 执行日市场快照（涨跌停/停牌判定）。 */
  readonly market: {
    /** 执行日开盘价。 */
    readonly open: number | null;
    /** 前收盘价。 */
    readonly prevClose: number | null;
  };
  /** 当前估值价（securityId → 元，仓位占比检查用）。 */
  readonly prices: ReadonlyMap<string, number>;
}

/** 订单约束检查结果（合法/拒绝 + 约束命中快照）。 */
export interface PaperOrderCheckResult {
  /** 是否通过全部账户层约束。 */
  readonly ok: boolean;
  /** 拒绝时非 null（稳定 code）。 */
  readonly rejectionCode: string | null;
  /** 拒绝/通过的中文说明。 */
  readonly reason: string;
  /** 本次检查实际执行的账户层约束轴 key（含触发拒绝的轴，供审计）。 */
  readonly enforcedAxes: readonly string[];
  /** 本次检查中「声明但账户层仅记录」的约束轴 key（诚实 blocker）。 */
  readonly recordedOnlyAxes: readonly string[];
}

function rejected(
  code: string,
  reason: string,
  enforcedAxes: readonly string[],
  recordedOnlyAxes: readonly string[]
): PaperOrderCheckResult {
  return { ok: false, rejectionCode: code, reason, enforcedAxes, recordedOnlyAxes };
}

function passed(
  reason: string,
  enforcedAxes: readonly string[],
  recordedOnlyAxes: readonly string[]
): PaperOrderCheckResult {
  return { ok: true, rejectionCode: null, reason, enforcedAxes, recordedOnlyAxes };
}

/** 账户层仅记录（不强制执行）的约束轴 key（诚实 blocker，用于成交审计）。 */
const RECORDED_ONLY_AXES: readonly string[] = [
  "execution.executionModel",
  "execution.allowPartialFill",
  "execution.limitPrice",
  "signal.source",
];

/**
 * 检查订单能否在账户层通过（纯函数，不修改任何状态，不抛裸错）。
 *
 * 检查顺序（对齐 FAIL FAST 纪律，先规则后资金）：
 *   1. 股数 100 整数倍（lotSize）；
 *   2. 方向 longOnly（卖出必须有持仓）；
 *   3. 禁买/禁卖标的集；
 *   4. 停牌（无有效开盘/前收）；
 *   5. 涨跌停拦截（blockLimitUpBuy / blockLimitDownSell）；
 *   6. 并发持仓数上限（新开仓）；
 *   7. 单票/总仓位权益占比上限（买后）；
 *   8. 资金充足（买入，含费用估算）；
 *   9. T+1 可卖份额（卖出）。
 */
export function checkPaperOrder(input: PaperOrderCheckInput): PaperOrderCheckResult {
  const { order, account, declaration, costDeclaration } = input;
  const lotSize = declaration.lot.lotSize;
  const recordedOnly = RECORDED_ONLY_AXES;

  // 1. 股数整手。
  if (!Number.isInteger(order.quantity) || order.quantity <= 0 || order.quantity % lotSize !== 0) {
    return rejected(
      PAPER_ACCOUNT_ERROR_CODES.ORDER_QUANTITY_NOT_LOT,
      `目标股数 ${order.quantity} 必须是 ${lotSize} 的整数倍`,
      ["execution.lotSize"],
      recordedOnly
    );
  }

  // 2. 方向 longOnly：卖出必须有持仓。
  const position = account.positions.find((p) => p.securityId === order.securityId);
  if (order.side === "sell" && !position) {
    return rejected(
      PAPER_ACCOUNT_ERROR_CODES.CHECK_NO_POSITION,
      `无 ${order.securityId} 持仓，无法卖出`,
      [],
      recordedOnly
    );
  }

  // 3. 禁买/禁卖标的集。
  const buyBanned = declaration.restrictions.buyBanned;
  const sellBanned = declaration.restrictions.sellBanned;
  if (order.side === "buy" && buyBanned.includes(order.securityId)) {
    return rejected(
      PAPER_ACCOUNT_ERROR_CODES.CHECK_BUY_BANNED,
      `${order.securityId} 在禁买列表`,
      ["risk.buyBanned"],
      recordedOnly
    );
  }
  if (order.side === "sell" && sellBanned.includes(order.securityId)) {
    return rejected(
      PAPER_ACCOUNT_ERROR_CODES.CHECK_SELL_BANNED,
      `${order.securityId} 在禁卖列表`,
      ["risk.sellBanned"],
      recordedOnly
    );
  }

  // 4. 停牌（无有效开盘/前收 → REJECT_NO_BAR）。
  const { open, prevClose } = input.market;
  if (
    open === null ||
    prevClose === null ||
    !Number.isFinite(open) ||
    !Number.isFinite(prevClose) ||
    open <= 0 ||
    prevClose <= 0
  ) {
    return rejected(
      PAPER_ACCOUNT_ERROR_CODES.CHECK_SUSPENDED,
      `${order.securityId} 执行日无有效行情（停牌/无 bar），拒绝成交`,
      ["execution.suspension"],
      recordedOnly
    );
  }

  // 5. 涨跌停拦截（复用 STEP 8 limitState 口径）。
  const limit = priceLimitOf(declaration, order.securityId);
  const up = limitUpPrice(prevClose, limit.limitUpRatio);
  const down = limitDownPrice(prevClose, limit.limitDownRatio);
  const isLimitUp = open >= up;
  const isLimitDown = open <= down;
  if (order.side === "buy" && declaration.restrictions.blockLimitUpBuy && isLimitUp) {
    return rejected(
      PAPER_ACCOUNT_ERROR_CODES.CHECK_LIMIT_UP,
      `${order.securityId} 开盘触及涨停，禁止追买`,
      ["execution.blockLimitUpBuy"],
      recordedOnly
    );
  }
  if (order.side === "sell" && declaration.restrictions.blockLimitDownSell && isLimitDown) {
    return rejected(
      PAPER_ACCOUNT_ERROR_CODES.CHECK_LIMIT_DOWN,
      `${order.securityId} 开盘触及跌停，禁止卖出`,
      ["execution.blockLimitDownSell"],
      recordedOnly
    );
  }

  if (order.side === "buy") {
    const enforced: string[] = ["execution.lotSize", "execution.suspension"];
    if (declaration.restrictions.blockLimitUpBuy) enforced.push("execution.blockLimitUpBuy");

    // 6. 并发持仓数上限（仅新开仓受限）。
    const isNewPosition = !position;
    const maxPositionCount = declaration.positions.maxPositionCount;
    if (maxPositionCount !== null) {
      enforced.push("risk.maxPositionCount");
      if (isNewPosition && account.positions.length >= maxPositionCount) {
        return rejected(
          PAPER_ACCOUNT_ERROR_CODES.CHECK_MAX_POSITIONS_REACHED,
          `并发持仓已达上限 ${maxPositionCount}`,
          enforced,
          recordedOnly
        );
      }
    }

    // 7. 仓位权益占比上限（买后，用估值价估算市值）。
    const perCap = declaration.positions.perSecurityEquityCap;
    const totalCap = declaration.positions.totalEquityCap;
    const price = input.prices.get(order.securityId) ?? open;
    const buyNotional = price * order.quantity;
    const currentMarketValue = account.positions.reduce((s, p) => s + p.marketValue, 0);
    const equity = account.equity;
    if (perCap !== null) {
      enforced.push("risk.perSecurityEquityCap");
      const positionAfter = (position?.marketValue ?? 0) + buyNotional;
      if (positionAfter > perCap * equity) {
        return rejected(
          PAPER_ACCOUNT_ERROR_CODES.CHECK_PER_SECURITY_CAP_EXCEEDED,
          `买入后 ${order.securityId} 市值占比 ${(positionAfter / equity).toFixed(4)} 超过单票上限 ${perCap}`,
          enforced,
          recordedOnly
        );
      }
    }
    if (totalCap !== null) {
      enforced.push("risk.totalEquityCap");
      const totalAfter = currentMarketValue + buyNotional;
      if (totalAfter > totalCap * equity) {
        return rejected(
          PAPER_ACCOUNT_ERROR_CODES.CHECK_TOTAL_CAP_EXCEEDED,
          `买入后总仓位占比 ${(totalAfter / equity).toFixed(4)} 超过总仓上限 ${totalCap}`,
          enforced,
          recordedOnly
        );
      }
    }

    // 8. 资金充足（含费用估算，用开盘价作为预估成交价，对齐 C-14.1 预算口径）。
    enforced.push("capital.cashLedger");
    const gross = open * order.quantity;
    const engineCost = toEngineCostModel(costDeclaration);
    const fees = computeTradeCost("buy", gross, engineCost).total;
    if (gross + fees > account.cash + 1e-8) {
      return rejected(
        PAPER_ACCOUNT_ERROR_CODES.CHECK_INSUFFICIENT_CASH,
        `买入需 ${gross + fees}（含费用 ${fees}），可用现金 ${account.cash}`,
        enforced,
        recordedOnly
      );
    }

    return passed("订单通过账户层全部约束检查", enforced, recordedOnly);
  }

  // sell 分支。
  const enforced: string[] = ["execution.lotSize", "execution.suspension"];
  if (declaration.restrictions.blockLimitDownSell) enforced.push("execution.blockLimitDownSell");

  // 9. T+1 可卖份额（卖出只能卖可卖）。
  enforced.push("position.tPlus1");
  if (order.quantity > position!.availableQuantity) {
    return rejected(
      PAPER_ACCOUNT_ERROR_CODES.CHECK_INSUFFICIENT_AVAILABLE,
      `可卖份额不足，需 ${order.quantity}，可用 ${position!.availableQuantity}（T+1 冻结）`,
      enforced,
      recordedOnly
    );
  }

  return passed("订单通过账户层全部约束检查", enforced, recordedOnly);
}

/** 便捷：非法订单抛出（供需要 FAIL FAST 的调用方）。 */
export function assertPaperOrderCheckable(input: PaperOrderCheckInput): void {
  const result = checkPaperOrder(input);
  if (!result.ok) {
    throw new PaperAccountError(
      result.rejectionCode ?? PAPER_ACCOUNT_ERROR_CODES.ORDER_INVALID,
      result.reason
    );
  }
}

/** 由检查结果构造成交约束命中快照（供 PaperAccountFill.constraintHits）。 */
export function toPaperFillConstraintHits(
  result: PaperOrderCheckResult
): PaperFillConstraintHits {
  return {
    enforced: result.enforcedAxes,
    recordedOnly: result.recordedOnlyAxes,
  };
}
