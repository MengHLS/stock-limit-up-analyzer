import type { LeaderCandidateBacktestRow, LeaderCandidateDailyPrice } from "./leaderCandidates";

export type RealisticBacktestOptions = {
  initialCapital?: number;
  maxPositions?: number;
  commissionRate?: number;
  stampDutyRate?: number;
  transferFeeRate?: number;
  slippageBps?: number;
  lotSize?: number;
  blockLimitUpBuys?: boolean;
  blockLimitDownSells?: boolean;
  enableOneWordLimitDownProbability?: boolean;
  oneWordLimitDownSellProbability?: number;
};

export type RealisticTrade = {
  signalDate: string;
  entryDate: string | null;
  exitDate: string | null;
  stockCode: string;
  stockName: string;
  score: number;
  shares: number;
  entryPrice: number | null;
  exitPrice: number | null;
  totalFees: number;
  netPnl: number | null;
  netReturn: number | null;
  status: "filled" | "skipped";
  reason: string | null;
};

export type RealisticEquityPoint = { date: string; equity: number; cash: number; openPositions: number };

export type RealisticBacktestResult = {
  assumptions: {
    initialCapital: number;
    maxPositions: number;
    commissionRate: number;
    stampDutyRate: number;
    transferFeeRate: number;
    slippageBps: number;
    lotSize: number;
    blockLimitUpBuys: boolean;
    blockLimitDownSells: boolean;
    enableOneWordLimitDownProbability: boolean;
    oneWordLimitDownSellProbability: number;
  };
  initialCapital: number;
  finalCapital: number;
  netProfit: number;
  totalReturn: number;
  maxDrawdown: number;
  tradeCount: number;
  /** 已执行买入的订单数，包含回测结束时尚未出清的持仓。 */
  filledCount: number;
  /** 已完成 T+2 收盘出清的订单数，绩效指标仅基于这些订单。 */
  completedCount: number;
  openPositionCount: number;
  totalCandidateCount: number;
  priceAvailableCount: number;
  capacitySkippedCount: number;
  skippedCount: number;
  winningTrades: number;
  winRate: number | null;
  averageReturn: number | null;
  profitFactor: number | null;
  blockedBuyCount: number;
  blockedSellCount: number;
  missingDataCount: number;
  equityCurve: RealisticEquityPoint[];
  trades: RealisticTrade[];
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const rate = (count: number, total: number) => total === 0 ? null : round((count / total) * 100, 1);
  const validPrice = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;

/** 使用订单标识生成稳定抽样值，使概率模式在重复回测时可复现。 */
function hitsDeterministicProbability(key: string, probability: number) {
  if (probability <= 0) return false;
  if (probability >= 100) return true;
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 10_000 < Math.round(probability * 100);
}

export function simulateRealisticTPlus1ToTPlus2(
  rows: LeaderCandidateBacktestRow[],
  options: RealisticBacktestOptions = {},
  priceByStockDate: Map<string, LeaderCandidateDailyPrice> = new Map(),
  tradingDates: string[] = [],
): RealisticBacktestResult {
  const initialCapital = options.initialCapital ?? 100_000;
  const maxPositions = Math.max(1, Math.floor(options.maxPositions ?? 5));
  const commissionRate = options.commissionRate ?? 0.0003;
  const stampDutyRate = options.stampDutyRate ?? 0.0005;
  const transferFeeRate = options.transferFeeRate ?? 0.00001;
  const slippageBps = options.slippageBps ?? 10;
  const lotSize = Math.max(1, Math.floor(options.lotSize ?? 100));
  // 只有日线开盘价、收盘价时无法确认排队成交；默认允许按开盘价成交，严格限制可手动开启。
  const blockLimitUpBuys = options.blockLimitUpBuys ?? false;
  const blockLimitDownSells = options.blockLimitDownSells ?? false;
  const enableOneWordLimitDownProbability = options.enableOneWordLimitDownProbability ?? false;
  const oneWordLimitDownSellProbability = Math.min(100, Math.max(0, options.oneWordLimitDownSellProbability ?? 0));
  const assumptions = {
    initialCapital,
    maxPositions,
    commissionRate,
    stampDutyRate,
    transferFeeRate,
    slippageBps,
    lotSize,
    blockLimitUpBuys,
    blockLimitDownSells,
    enableOneWordLimitDownProbability,
    oneWordLimitDownSellProbability,
  };
  const sortedRows = rows.slice().sort((a, b) => a.nextDayDate.localeCompare(b.nextDayDate) || b.score - a.score || a.stockCode.localeCompare(b.stockCode));
  const entryDates = Array.from(new Set(sortedRows.map((row) => row.nextDayDate))).sort();
  const eventDates = Array.from(new Set([
    ...entryDates,
    ...sortedRows.map((row) => row.secondDayDate).filter((date): date is string => date !== null),
    ...tradingDates,
  ])).sort();
  const candidatesByEntryDate = new Map<string, LeaderCandidateBacktestRow[]>();
  for (const row of sortedRows) candidatesByEntryDate.set(row.nextDayDate, [...(candidatesByEntryDate.get(row.nextDayDate) ?? []), row]);

  let cash = initialCapital;
  const positions = new Map<string, {
    row: LeaderCandidateBacktestRow;
    shares: number;
    entryPrice: number;
    capitalCost: number;
    previousClosePrice: number | null;
    latestValuationPrice: number;
  }>();
  const trades: RealisticTrade[] = [];
  const equityCurve: RealisticEquityPoint[] = [];
  let blockedBuyCount = 0;
  let blockedSellCount = 0;
  let missingDataCount = 0;

  for (const date of eventDates) {
    for (const [key, position] of Array.from(positions.entries())) {
      if (!position.row.secondDayDate || date < position.row.secondDayDate) continue;
      const marketPrice = priceByStockDate.get(`${position.row.stockCode}::${date}`);
      const marketClosePrice = marketPrice?.closePrice ?? null;
      const marketOpenPrice = marketPrice?.openPrice ?? null;
      const exitPrice = date === position.row.secondDayDate
        ? position.row.secondDayClosePrice ?? marketClosePrice
        : marketClosePrice;
      if (!validPrice(exitPrice)) {
        continue;
      }
      position.latestValuationPrice = exitPrice;
      const limitDown = validPrice(position.previousClosePrice) && exitPrice <= position.previousClosePrice * 0.901;
      const oneWordLimitDown = limitDown
        && validPrice(position.previousClosePrice)
        && validPrice(marketOpenPrice)
        && marketOpenPrice <= position.previousClosePrice * 0.901
        && Math.abs(marketOpenPrice - exitPrice) <= position.previousClosePrice * 0.002;
      const oneWordProbabilityFill = oneWordLimitDown
        && enableOneWordLimitDownProbability
        && hitsDeterministicProbability(`${position.row.stockCode}::${position.row.nextDayDate}::${date}`, oneWordLimitDownSellProbability);
      if (blockLimitDownSells && oneWordLimitDown && !oneWordProbabilityFill) {
        blockedSellCount += 1;
        position.previousClosePrice = exitPrice;
        const trade = trades.find((item) => item.stockCode === position.row.stockCode && item.entryDate === position.row.nextDayDate && item.status === "filled");
        if (trade) trade.reason = enableOneWordLimitDownProbability
          ? `一字跌停，保守成交概率${oneWordLimitDownSellProbability}%未命中，继续等待下一实际交易日`
          : date === position.row.secondDayDate
            ? "T+2一字跌停，按严格规则延后至下一实际交易日"
            : "连续一字跌停，继续等待下一实际交易日";
        continue;
      }
      const slippedExit = exitPrice * (1 - slippageBps / 10000);
      const grossExit = slippedExit * position.shares;
      const sellFees = grossExit * (commissionRate + stampDutyRate + transferFeeRate);
      const proceeds = grossExit - sellFees;
      const netPnl = proceeds - position.capitalCost;
      cash += proceeds;
      const trade = trades.find((item) => item.stockCode === position.row.stockCode && item.entryDate === position.row.nextDayDate && item.status === "filled");
      if (trade) {
        trade.exitDate = date;
        trade.exitPrice = round(slippedExit, 4);
        trade.totalFees = round(trade.totalFees + sellFees);
        trade.netPnl = round(netPnl);
        trade.netReturn = round((netPnl / position.capitalCost) * 100);
        trade.reason = oneWordProbabilityFill
          ? `一字跌停保守成交概率${oneWordLimitDownSellProbability}%命中，实际交易日出清`
          : date === position.row.secondDayDate ? null : "跌停后延期至实际交易日出清";
      }
      positions.delete(key);
    }

    const entryRows = candidatesByEntryDate.get(date) ?? [];
    const unavailable = entryRows.filter((row) => !validPrice(row.nextOpenPrice) || !validPrice(row.secondDayClosePrice));
    for (const row of unavailable) {
      missingDataCount += 1;
      const reason = row.secondDayDate === null
        ? "未到T+2实际交易日"
        : !validPrice(row.nextOpenPrice)
          ? "缺少T+1开盘行情"
          : "T+2实际交易日无可用收盘价";
      trades.push({ signalDate: row.date, entryDate: date, exitDate: row.secondDayDate, stockCode: row.stockCode, stockName: row.stockName, score: row.score, shares: 0, entryPrice: null, exitPrice: null, totalFees: 0, netPnl: null, netReturn: null, status: "skipped", reason });
    }
    const overlappingStockRows = entryRows.filter((row) => (
      validPrice(row.nextOpenPrice)
      && validPrice(row.secondDayClosePrice)
      && Array.from(positions.values()).some((position) => position.row.stockCode === row.stockCode)
    ));
    for (const row of overlappingStockRows) {
      trades.push({ signalDate: row.date, entryDate: date, exitDate: row.secondDayDate, stockCode: row.stockCode, stockName: row.stockName, score: row.score, shares: 0, entryPrice: null, exitPrice: null, totalFees: 0, netPnl: null, netReturn: null, status: "skipped", reason: "同一股票已有持仓" });
    }
    const available = entryRows.filter((row) => (
      validPrice(row.nextOpenPrice)
      && validPrice(row.secondDayClosePrice)
      && !Array.from(positions.values()).some((position) => position.row.stockCode === row.stockCode)
    ));
    const slots = Math.max(0, maxPositions - positions.size);
    const selected = available.slice(0, slots);
    const budgetPerPosition = selected.length > 0 ? cash / selected.length : 0;
    for (const row of available) {
      if (selected.includes(row)) continue;
      trades.push({ signalDate: row.date, entryDate: null, exitDate: row.secondDayDate, stockCode: row.stockCode, stockName: row.stockName, score: row.score, shares: 0, entryPrice: null, exitPrice: null, totalFees: 0, netPnl: null, netReturn: null, status: "skipped", reason: slots === 0 ? "超过最大持仓数" : "资金按评分排序优先分配" });
    }
    for (const row of selected) {
      const entryPrice = row.nextOpenPrice!;
      const limitUp = validPrice(row.signalClosePrice) && entryPrice >= row.signalClosePrice * 1.099;
      if (blockLimitUpBuys && limitUp) {
        blockedBuyCount += 1;
        trades.push({ signalDate: row.date, entryDate: date, exitDate: row.secondDayDate, stockCode: row.stockCode, stockName: row.stockName, score: row.score, shares: 0, entryPrice: round(entryPrice), exitPrice: null, totalFees: 0, netPnl: null, netReturn: null, status: "skipped", reason: "T+1开盘接近涨停，按保守规则不可追买" });
        continue;
      }
      const slippedEntry = entryPrice * (1 + slippageBps / 10000);
      const shares = Math.floor(budgetPerPosition / (slippedEntry * (1 + commissionRate + transferFeeRate)) / lotSize) * lotSize;
      if (shares < lotSize) {
        missingDataCount += 1;
        trades.push({ signalDate: row.date, entryDate: date, exitDate: row.secondDayDate, stockCode: row.stockCode, stockName: row.stockName, score: row.score, shares: 0, entryPrice: round(slippedEntry), exitPrice: null, totalFees: 0, netPnl: null, netReturn: null, status: "skipped", reason: "可用资金不足以买入一手" });
        continue;
      }
      const grossEntry = slippedEntry * shares;
      const buyFees = grossEntry * (commissionRate + transferFeeRate);
      const capitalCost = grossEntry + buyFees;
      if (capitalCost > cash) continue;
      cash -= capitalCost;
      const key = `${row.stockCode}::${date}`;
      positions.set(key, {
        row,
        shares,
        entryPrice: slippedEntry,
        capitalCost,
        previousClosePrice: row.nextClosePrice,
        latestValuationPrice: slippedEntry,
      });
      trades.push({ signalDate: row.date, entryDate: date, exitDate: row.secondDayDate, stockCode: row.stockCode, stockName: row.stockName, score: row.score, shares, entryPrice: round(slippedEntry, 4), exitPrice: null, totalFees: round(buyFees), netPnl: null, netReturn: null, status: "filled", reason: null });
    }
    const markedEquity = cash + Array.from(positions.values()).reduce((sum, position) => {
      const closePrice = priceByStockDate.get(`${position.row.stockCode}::${date}`)?.closePrice ?? null;
      if (validPrice(closePrice)) position.latestValuationPrice = closePrice;
      return sum + position.latestValuationPrice * position.shares;
    }, 0);
    equityCurve.push({ date, equity: round(markedEquity), cash: round(cash), openPositions: positions.size });
  }

  for (const position of Array.from(positions.values())) {
    const trade = trades.find((item) => item.stockCode === position.row.stockCode && item.entryDate === position.row.nextDayDate && item.status === "filled");
    if (!trade) continue;
    const valuationDate = eventDates.at(-1) ?? position.row.secondDayDate ?? position.row.nextDayDate;
    if (trade.reason === null) missingDataCount += 1;
    const terminalReason = `回测结束仍持仓，按${valuationDate}收盘价期末估值`;
    trade.reason = trade.reason ? `${trade.reason}；${terminalReason}` : terminalReason;
  }
  const filledTrades = trades.filter((trade) => trade.status === "filled" && trade.netPnl !== null);
  const pnlValues = filledTrades.map((trade) => trade.netPnl!);
  const grossProfit = pnlValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(pnlValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.max(maxDrawdown, peak === 0 ? 0 : ((peak - point.equity) / peak) * 100);
  }
  const finalCapital = equityCurve.at(-1)?.equity ?? initialCapital;
  const capacitySkippedCount = trades.filter((trade) => trade.reason === "超过最大持仓数" || trade.reason === "资金按评分排序优先分配" || trade.reason === "同一股票已有持仓").length;
  const priceAvailableCount = rows.filter((row) => validPrice(row.nextOpenPrice) && validPrice(row.secondDayClosePrice)).length;
  return {
    assumptions,
    initialCapital: round(initialCapital),
    finalCapital: round(finalCapital),
    netProfit: round(finalCapital - initialCapital),
    totalReturn: round(((finalCapital - initialCapital) / initialCapital) * 100),
    maxDrawdown: round(maxDrawdown),
    tradeCount: trades.length,
    filledCount: trades.filter((trade) => trade.status === "filled").length,
    completedCount: filledTrades.length,
    openPositionCount: positions.size,
    totalCandidateCount: rows.length,
    priceAvailableCount,
    capacitySkippedCount,
    skippedCount: trades.filter((trade) => trade.status === "skipped").length,
    winningTrades: filledTrades.filter((trade) => trade.netPnl! > 0).length,
    winRate: rate(filledTrades.filter((trade) => trade.netPnl! > 0).length, filledTrades.length),
    averageReturn: filledTrades.length === 0 ? null : round(filledTrades.reduce((sum, trade) => sum + (trade.netReturn ?? 0), 0) / filledTrades.length),
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : round(grossProfit / grossLoss, 2),
    blockedBuyCount,
    blockedSellCount,
    missingDataCount,
    equityCurve,
    trades,
  };
}
