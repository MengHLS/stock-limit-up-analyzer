/**
 * STEP 23 / C-23.1 — 模拟账户状态机（纯函数，不可变）。
 *
 * 交付：账户/持仓状态机 + 现金/冻结资金原语 + T+1 冻结股解冻 + mark-to-market，
 * 全部返回新状态（不修改入参）。这是「账户状态持续演进」的原子能力，闭环编排
 * （信号→订单→成交→PnL 的逐日驱动）属 C-23.2，本目录不实现。
 *
 * 会计口径（对齐 STEP 8 PositionBook/Portfolio + C-14.2 市场冲击增量）：
 *   - averageEntryPrice：加权平均「含滑点成交价」（不含费用/冲击）；
 *   - totalCostBasis：总成本基 = Σ(成交额 + 现金费用 + 冲击)，用于盈亏结转；
 *   - 买入现金流出 = grossAmount + cashFees + |marketImpact|；
 *   - 卖出现金流入 = grossAmount − cashFees − |marketImpact|；
 *   - 权益恒等式：equity === cash + frozen + Σ marketValue（frozen 只转移不增减权益）。
 *
 * 铁律：纯函数、readonly 入参、无 Date.now/Math.random/IO；非法输入抛
 * PaperAccountError（稳定 code），绝不静默 clamp。
 */

import type { CostModelDeclaration } from "../costModel/types";
import type {
  PaperAccount,
  PaperAccountFill,
  PaperAccountPosition,
  PaperAccountPositionSnapshot,
  PaperCashLedgerEntry,
} from "./types";
import { PAPER_ACCOUNT_ERROR_CODES, PaperAccountError } from "./errors";

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, label: string): void {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_ASOF_INVALID,
      `paperAccount: ${label}（${String(value)}）不是合法 YYYY-MM-DD`
    );
  }
}

function assertFiniteNonNegative(value: number, label: string, code: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new PaperAccountError(
      code,
      `paperAccount: ${label} 必须是非负有限数字，收到 ${String(value)}`
    );
  }
}

/** 持仓数组 → Map（升序，确定性）。 */
function positionsToMap(
  positions: readonly PaperAccountPosition[]
): Map<string, PaperAccountPosition> {
  const map = new Map<string, PaperAccountPosition>();
  for (const position of positions) map.set(position.securityId, position);
  return map;
}

/** Map → 升序持仓数组。 */
function mapToPositions(map: Map<string, PaperAccountPosition>): PaperAccountPosition[] {
  return Array.from(map.values()).sort((a, b) =>
    a.securityId.localeCompare(b.securityId)
  );
}

/** 由持仓算市值合计。 */
function marketValueOf(positions: readonly PaperAccountPosition[]): number {
  return positions.reduce((sum, p) => sum + p.marketValue, 0);
}

/** 断言账户结构不变量（内部；供各原语与校验复用）。 */
function assertAccountInvariants(account: PaperAccount): void {
  assertIsoDate(account.asOf, "asOf");
  assertFiniteNonNegative(
    account.cash,
    "cash",
    PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_NEGATIVE_CASH
  );
  assertFiniteNonNegative(
    account.frozen,
    "frozen",
    PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_NEGATIVE_FROZEN
  );
  const seen = new Set<string>();
  for (const position of account.positions) {
    if (seen.has(position.securityId)) {
      throw new PaperAccountError(
        PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_POSITION_INVALID,
        `paperAccount: 持仓重复 securityId ${position.securityId}`
      );
    }
    seen.add(position.securityId);
    if (position.quantity <= 0) {
      throw new PaperAccountError(
        PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_POSITION_INVALID,
        `paperAccount: 持仓 ${position.securityId} 股数必须为正`
      );
    }
    if (position.availableQuantity + position.frozenQuantity !== position.quantity) {
      throw new PaperAccountError(
        PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_POSITION_INVALID,
        `paperAccount: 持仓 ${position.securityId} 可卖(${position.availableQuantity}) + 冻结(${position.frozenQuantity}) ≠ 总量(${position.quantity})`
      );
    }
    if (position.availableQuantity < 0 || position.frozenQuantity < 0) {
      throw new PaperAccountError(
        PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_POSITION_INVALID,
        `paperAccount: 持仓 ${position.securityId} 可卖/冻结股数不能为负`
      );
    }
  }
  // 升序断言。
  for (let i = 1; i < account.positions.length; i += 1) {
    if (account.positions[i - 1]!.securityId.localeCompare(account.positions[i]!.securityId) >= 0) {
      throw new PaperAccountError(
        PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_POSITION_INVALID,
        `paperAccount: 持仓必须按 securityId 升序`
      );
    }
  }
  const expectedEquity = account.cash + account.frozen + marketValueOf(account.positions);
  if (Math.abs(expectedEquity - account.equity) > 1e-6) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_EQUITY_MISMATCH,
      `paperAccount: equity(${account.equity}) ≠ cash+frozen+marketValue(${expectedEquity})`
    );
  }
}

// ---------------------------------------------------------------------------
// 构造
// ---------------------------------------------------------------------------

export interface CreatePaperAccountInput {
  readonly accountId: string;
  readonly initialCapital: number;
  /** 起始交易日（YYYY-MM-DD）。 */
  readonly asOf: string;
}

/** 创建空模拟账户（纯函数）。 */
export function createPaperAccount(input: CreatePaperAccountInput): PaperAccount {
  if (!input.accountId || typeof input.accountId !== "string") {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_INVALID,
      `paperAccount: accountId 必须是非空字符串`
    );
  }
  if (!Number.isFinite(input.initialCapital) || input.initialCapital <= 0) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_CAPITAL_INVALID,
      `paperAccount: initialCapital 必须是正有限数字，收到 ${String(input.initialCapital)}`
    );
  }
  assertIsoDate(input.asOf, "asOf");

  const account: PaperAccount = {
    accountId: input.accountId,
    initialCapital: input.initialCapital,
    cash: input.initialCapital,
    frozen: 0,
    positions: [],
    realizedPnL: 0,
    equity: input.initialCapital,
    asOf: input.asOf,
  };
  return account;
}

// ---------------------------------------------------------------------------
// T+1 结算（冻结股解冻）
// ---------------------------------------------------------------------------

/** 校验 asOf 推进（交易日只进不退）。 */
function assertAsOfAdvances(previous: string, next: string, label: string): void {
  assertIsoDate(next, label);
  if (next < previous) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_ASOF_INVALID,
      `paperAccount: ${label}（${next}）不能早于账户当前 asOf（${previous}）`
    );
  }
}

/**
 * T+1 结算：把各持仓 frozenQuantity 转为 availableQuantity（新交易日开始时调用）。
 * 返回新账户；asOf 推进到指定交易日（若传入）。权益不变。
 */
export function settlePaperAccountT1(
  account: PaperAccount,
  asOf: string
): PaperAccount {
  assertAccountInvariants(account);
  assertAsOfAdvances(account.asOf, asOf, "asOf");
  const positions = account.positions.map((position) => ({
    ...position,
    availableQuantity: position.availableQuantity + position.frozenQuantity,
    frozenQuantity: 0,
  }));
  const next: PaperAccount = {
    ...account,
    positions,
    asOf,
  };
  return next;
}

// ---------------------------------------------------------------------------
// 冻结资金原语（挂单买单预留）
// ---------------------------------------------------------------------------

export interface PaperCashOperation {
  readonly account: PaperAccount;
  readonly ledgerEntry: PaperCashLedgerEntry;
}

/**
 * 冻结资金：cash -= amount, frozen += amount（买单预留）。
 * FAIL FAST：amount 必须 > 0 且 cash 足够；权益不变。
 */
export function freezePaperCash(
  account: PaperAccount,
  amount: number,
  entryId: string,
  asOf: string,
  description: string,
  orderId?: string
): PaperCashOperation {
  assertAccountInvariants(account);
  assertAsOfAdvances(account.asOf, asOf, "asOf");
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_AMOUNT_NONPOSITIVE,
      `paperAccount: 冻结金额必须为正有限数字，收到 ${String(amount)}`
    );
  }
  if (amount > account.cash) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_FREEZE_EXCEEDS_CASH,
      `paperAccount: 冻结 ${amount} 超过可用现金 ${account.cash}`
    );
  }
  const cash = account.cash - amount;
  const next: PaperAccount = { ...account, cash, frozen: account.frozen + amount, asOf };
  const ledgerEntry: PaperCashLedgerEntry = {
    entryId,
    asOf,
    kind: "FREEZE",
    amount: -amount,
    balanceAfter: cash,
    ...(orderId !== undefined ? { orderId } : {}),
    description,
  };
  return { account: next, ledgerEntry };
}

/**
 * 解冻资金：frozen -= amount, cash += amount。
 * FAIL FAST：amount 必须 > 0 且 frozen 足够；权益不变。
 */
export function unfreezePaperCash(
  account: PaperAccount,
  amount: number,
  entryId: string,
  asOf: string,
  description: string,
  orderId?: string
): PaperCashOperation {
  assertAccountInvariants(account);
  assertAsOfAdvances(account.asOf, asOf, "asOf");
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_AMOUNT_NONPOSITIVE,
      `paperAccount: 解冻金额必须为正有限数字，收到 ${String(amount)}`
    );
  }
  if (amount > account.frozen) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.ACCOUNT_UNFREEZE_EXCEEDS_FROZEN,
      `paperAccount: 解冻 ${amount} 超过冻结资金 ${account.frozen}`
    );
  }
  const cash = account.cash + amount;
  const next: PaperAccount = { ...account, cash, frozen: account.frozen - amount, asOf };
  const ledgerEntry: PaperCashLedgerEntry = {
    entryId,
    asOf,
    kind: "UNFREEZE",
    amount,
    balanceAfter: cash,
    ...(orderId !== undefined ? { orderId } : {}),
    description,
  };
  return { account: next, ledgerEntry };
}

// ---------------------------------------------------------------------------
// 成交应用（买入 / 卖出）
// ---------------------------------------------------------------------------

export interface PaperFillApplication {
  readonly account: PaperAccount;
  readonly ledgerEntry: PaperCashLedgerEntry;
}

/** 成交股数整手校验（一手 = 成本声明 lotSize；缺省回退 C-14.3 DEFAULT_LOT_SIZE=100）。 */
function assertWholeLot(quantity: number, lotSize: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.FILL_QUANTITY_NOT_LOT,
      `paperAccount: 成交股数必须为正有限数字，收到 ${String(quantity)}`
    );
  }
  if (quantity % lotSize !== 0) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.FILL_QUANTITY_NOT_LOT,
      `paperAccount: 成交股数 ${quantity} 必须是 ${lotSize} 的整数倍`
    );
  }
}

function lotSizeOf(costDeclaration: CostModelDeclaration): number {
  const lot = costDeclaration.lotSize;
  return Number.isInteger(lot) && lot > 0 ? lot : 100;
}

/** 买入成交：现金流出 + 加仓/开仓（含费用与冲击计入成本基）。 */
export function applyPaperBuyFill(
  account: PaperAccount,
  fill: PaperAccountFill,
  costDeclaration: CostModelDeclaration,
  entryId: string,
  description: string
): PaperFillApplication {
  assertAccountInvariants(account);
  if (fill.side !== "buy") {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.FILL_SIDE_MISMATCH,
      `paperAccount: applyBuyFill 收到 side=${fill.side} 的成交`
    );
  }
  assertWholeLot(fill.quantity, lotSizeOf(costDeclaration));
  assertAsOfAdvances(account.asOf, fill.timestamp, "fill.timestamp");

  const cost = fill.cost;
  const grossAmount = cost.grossAmount;
  const cashFees = cost.cashFees;
  const impactMagnitude = Math.abs(cost.marketImpact);
  const cashOut = grossAmount + cashFees + impactMagnitude;

  if (cashOut > account.cash + 1e-8) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.CHECK_INSUFFICIENT_CASH,
      `paperAccount: 买入需现金 ${cashOut}，可用 ${account.cash}`
    );
  }

  const map = positionsToMap(account.positions);
  const existing = map.get(fill.securityId);
  const addedCostBasis = grossAmount + cashFees + impactMagnitude;
  if (existing) {
    const newQuantity = existing.quantity + fill.quantity;
    const averageEntryPrice =
      (existing.averageEntryPrice * existing.quantity + fill.price * fill.quantity) /
      newQuantity;
    map.set(fill.securityId, {
      ...existing,
      quantity: newQuantity,
      frozenQuantity: existing.frozenQuantity + fill.quantity,
      averageEntryPrice,
      totalCostBasis: existing.totalCostBasis + addedCostBasis,
    });
  } else {
    map.set(fill.securityId, {
      securityId: fill.securityId,
      quantity: fill.quantity,
      availableQuantity: 0,
      frozenQuantity: fill.quantity,
      averageEntryPrice: fill.price,
      totalCostBasis: addedCostBasis,
      marketPrice: fill.price,
      marketValue: fill.price * fill.quantity,
      unrealizedPnL: fill.price * fill.quantity - addedCostBasis,
      realizedPnL: 0,
    });
  }

  const positions = mapToPositions(map);
  const cash = account.cash - cashOut;
  const next: PaperAccount = {
    ...account,
    cash,
    positions,
    equity: cash + account.frozen + marketValueOf(positions),
    asOf: fill.timestamp,
  };
  const ledgerEntry: PaperCashLedgerEntry = {
    entryId,
    asOf: fill.timestamp,
    kind: "BUY_CASH_OUT",
    amount: -cashOut,
    balanceAfter: cash,
    orderId: fill.orderId,
    fillId: fill.fillId,
    description,
  };
  return { account: next, ledgerEntry };
}

/** 卖出成交：现金流入 + 减仓/清仓（只能卖可卖份额，T+1 冻结不可卖）。 */
export function applyPaperSellFill(
  account: PaperAccount,
  fill: PaperAccountFill,
  costDeclaration: CostModelDeclaration,
  entryId: string,
  description: string
): PaperFillApplication {
  assertAccountInvariants(account);
  if (fill.side !== "sell") {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.FILL_SIDE_MISMATCH,
      `paperAccount: applySellFill 收到 side=${fill.side} 的成交`
    );
  }
  assertWholeLot(fill.quantity, lotSizeOf(costDeclaration));
  assertAsOfAdvances(account.asOf, fill.timestamp, "fill.timestamp");

  const map = positionsToMap(account.positions);
  const position = map.get(fill.securityId);
  if (!position) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.CHECK_NO_POSITION,
      `paperAccount: 无 ${fill.securityId} 持仓，无法卖出`
    );
  }
  if (fill.quantity > position.availableQuantity) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.CHECK_INSUFFICIENT_AVAILABLE,
      `paperAccount: 可卖份额不足，需 ${fill.quantity}，可用 ${position.availableQuantity}（T+1 冻结）`
    );
  }

  const cost = fill.cost;
  const grossAmount = cost.grossAmount;
  const cashFees = cost.cashFees;
  const impactMagnitude = Math.abs(cost.marketImpact);
  const cashIn = grossAmount - cashFees - impactMagnitude;

  const fees = cashFees + impactMagnitude;
  const proceeds = fill.price * fill.quantity - fees;
  const costBasis = position.totalCostBasis * (fill.quantity / position.quantity);
  const realizedPnL = proceeds - costBasis;

  const newQuantity = position.quantity - fill.quantity;
  if (newQuantity <= 0) {
    map.delete(fill.securityId);
  } else {
    map.set(fill.securityId, {
      ...position,
      quantity: newQuantity,
      availableQuantity: position.availableQuantity - fill.quantity,
      totalCostBasis: position.totalCostBasis - costBasis,
      realizedPnL: position.realizedPnL + realizedPnL,
    });
  }

  const positions = mapToPositions(map);
  const cash = account.cash + cashIn;
  const next: PaperAccount = {
    ...account,
    cash,
    positions,
    realizedPnL: account.realizedPnL + realizedPnL,
    equity: cash + account.frozen + marketValueOf(positions),
    asOf: fill.timestamp,
  };
  const ledgerEntry: PaperCashLedgerEntry = {
    entryId,
    asOf: fill.timestamp,
    kind: "SELL_CASH_IN",
    amount: cashIn,
    balanceAfter: cash,
    orderId: fill.orderId,
    fillId: fill.fillId,
    description,
  };
  return { account: next, ledgerEntry };
}

// ---------------------------------------------------------------------------
// 估值 / 权益 / 快照
// ---------------------------------------------------------------------------

/**
 * mark-to-market：按给定估值价更新各持仓 marketPrice/marketValue/unrealizedPnL
 * 并重算权益（估值价缺失时回退成本价）。返回新账户。asOf 可推进。
 */
export function markPaperAccountToMarket(
  account: PaperAccount,
  prices: ReadonlyMap<string, number>,
  asOf?: string
): PaperAccount {
  assertAccountInvariants(account);
  const effectiveAsOf = asOf ?? account.asOf;
  assertAsOfAdvances(account.asOf, effectiveAsOf, "asOf");

  const positions = account.positions.map((position) => {
    const priceValue = prices.get(position.securityId);
    const price =
      priceValue !== undefined && Number.isFinite(priceValue) && priceValue > 0
        ? priceValue
        : position.averageEntryPrice;
    const marketValue = price * position.quantity;
    return {
      ...position,
      marketPrice: price,
      marketValue,
      unrealizedPnL: marketValue - position.totalCostBasis,
    };
  });

  const next: PaperAccount = {
    ...account,
    positions,
    equity: account.cash + account.frozen + marketValueOf(positions),
    asOf: effectiveAsOf,
  };
  return next;
}

/** 计算总权益（cash + frozen + Σ marketValue；恒等于 account.equity）。 */
export function computePaperAccountEquity(account: PaperAccount): number {
  return account.cash + account.frozen + marketValueOf(account.positions);
}

/** 构造某交易日收盘账户截面快照。 */
export function snapshotPaperAccount(
  account: PaperAccount,
  asOf?: string
): PaperAccountPositionSnapshot {
  assertAccountInvariants(account);
  const effectiveAsOf = asOf ?? account.asOf;
  return {
    asOf: effectiveAsOf,
    cash: account.cash,
    frozen: account.frozen,
    marketValue: marketValueOf(account.positions),
    equity: account.equity,
    positions: account.positions.map((position) => ({ ...position })),
  };
}

/** 公开导出不变量断言（供 validate/测试复用）。 */
export function assertValidPaperAccount(account: PaperAccount): void {
  assertAccountInvariants(account);
}
