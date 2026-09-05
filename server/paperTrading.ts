import type {
  LeaderCandidate,
  LeaderCandidateBacktestRow,
  LeaderCandidateDailyPrice,
} from "./leaderCandidates";
import type { RealisticBacktestOptions } from "./realisticBacktest";
import type { DownsideRiskStrategyKey } from "./downsideRisk";
import { calculateQualityBlendScoreForRisk, defaultDownsideRiskPenaltyWeight } from "./downsideRisk";
import {
  OPEN_EXPECTATION_DEFAULT_TABLE,
  bucketOfLimitUpTime,
  classifyOpenExpectation,
  formatMissedReason,
  type OpenExpectationTable,
} from "./openExpectation";

/**
 * 前向纸面交易闭环（四-P1）：真实样本外兜底。
 *
 * 与历史回测 `simulateRealisticTPlus1ToTPlus2` 的差别在于：这里是有状态的、逐日推进的增量过程——
 * T 日收盘用「仅 T 日及以前」的信号生成次日准备买入清单 → 下一交易日开盘按真实开盘价成交 →
 * 持仓按风险管理的止盈止损规则逐日追踪出清 → 累积真实前向权益曲线，与历史回测对比。
 *
 * 关键约束：
 * - Point-in-time：候选评分只读 ≤ 信号日的数据，且惩罚权重使用固定值（不做基于未来窗口的自动调参），杜绝未来函数。
 * - 成交与退出规则镜像 realisticBacktest，保证前向曲线与回测口径可比。
 * - 本模块为纯函数，不触碰数据库；持久化由 db.ts 承担。
 */

export type PaperTradingStrategyKey = DownsideRiskStrategyKey;

export type PaperPendingBuy = {
  rank: number;
  stockCode: string;
  stockName: string;
  sector: string;
  boards: number;
  signalDate: string;
  signalClosePrice: number | null;
  /** t 日涨停封板时间，用于次日开盘预期三档分类。 */
  limitUpTime: string | null;
  score: number;
  riskScore: number;
  riskTier: "低风险" | "中风险" | "高风险";
  strategyScore: number;
  reasons: string[];
};

export type PaperPosition = {
  stockCode: string;
  stockName: string;
  signalDate: string;
  entryDate: string;
  entryPrice: number;
  shares: number;
  capitalCost: number;
  /** 上一交易日收盘价，用于一字跌停与「收盘不低于前收」强势续持判断。 */
  previousClosePrice: number | null;
  /** 建仓以来最高收盘价（含建仓价），用于动态回撤止盈。 */
  highestClosePrice: number;
  entryTradingDateIndex: number;
};

export type PaperOrder = {
  signalDate: string;
  stockCode: string;
  stockName: string;
  score: number;
  strategyScore: number;
  riskScore: number;
  riskTier: "低风险" | "中风险" | "高风险";
  entryDate: string | null;
  entryPrice: number | null;
  shares: number;
  totalFees: number;
  exitDate: string | null;
  exitPrice: number | null;
  netPnl: number | null;
  netReturn: number | null;
  status: "filled" | "exited" | "skipped";
  reason: string | null;
};

export type PaperEquityPoint = {
  date: string;
  equity: number;
  cash: number;
  openPositions: number;
};

export type PaperTradingState = {
  cash: number;
  positions: PaperPosition[];
  pendingBuys: PaperPendingBuy[];
  orders: PaperOrder[];
  equityCurve: PaperEquityPoint[];
  lastProcessedDate: string | null;
};

export type PaperTradingDayEvent = {
  date: string;
  filledCount: number;
  exitedCount: number;
  skippedCount: number;
  equity: number;
  cash: number;
  openPositions: number;
  filledOrders: PaperOrder[];
  exitedOrders: PaperOrder[];
  skippedOrders: PaperOrder[];
};

export type PaperTradingAdvanceInput = {
  state: PaperTradingState;
  /** 推进到的交易日（先成交既有准备清单，再收盘出清，再生成次日清单）。 */
  today: string;
  /** 信号日 = today 的候选（用于生成下一交易日准备买入清单）。 */
  signalCandidates: LeaderCandidate[];
  priceByStockDate: Map<string, LeaderCandidateDailyPrice>;
  tradingDates: string[];
  strategyKey: PaperTradingStrategyKey;
  realistic: RealisticBacktestOptions;
  appliedMinScore?: number | null;
  penaltyWeight?: number;
  hardRiskThreshold?: number;
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const validPrice = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value) && value > 0;

/** 与 realisticBacktest 一致的流动性分层滑点（成交额单位千元，<1亿 +20bp、1~5亿 +10bp、5~20亿 +5bp）。 */
function amountAdjustedSlippageBps(baseBps: number, amount: number | null | undefined): number {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) return baseBps;
  if (amount < 100_000) return baseBps + 20;
  if (amount < 500_000) return baseBps + 10;
  if (amount < 2_000_000) return baseBps + 5;
  return baseBps;
}

/** 从候选构造一个最小信号行，供质量复合评分读取（只依赖信号日可见字段）。 */
function candidateToSignalRow(candidate: LeaderCandidate, signalDate: string): LeaderCandidateBacktestRow {
  return {
    stockCode: candidate.stockCode,
    stockName: candidate.stockName,
    sector: candidate.sector,
    boards: candidate.boards,
    score: candidate.score,
    circulationValue: candidate.circulationValue,
    marketCapScore: candidate.marketCapScore,
    sectorCount: candidate.sectorCount,
    limitUpTime: candidate.limitUpTime,
    turnover: candidate.turnover,
    riskScore: candidate.riskScore,
    riskTier: candidate.riskTier,
    riskPenalty: candidate.riskPenalty,
    netScore: candidate.netScore,
    date: signalDate,
    nextDate: signalDate,
    nextDayDate: signalDate,
    secondDayDate: null,
    success: false,
    signalClosePrice: null,
    nextOpenPrice: null,
    nextClosePrice: null,
    nextOpenPremium: null,
    nextClosePremium: null,
    secondDayOpenPrice: null,
    secondDayClosePrice: null,
    secondDayOpenPremium: null,
    secondDayClosePremium: null,
    tPlus1CloseToTPlus2CloseReturn: null,
    tPlus1CloseToTPlus2CloseSuccess: null,
    phase: null,
    maxBoards: null,
  };
}

/**
 * 用「仅信号日可见」的信息，按策略 key 对当日候选评分/过滤/排序，生成下一实际交易日的准备买入清单。
 * 已持有股票被排除，数量受最大持仓数限制。不预设开盘价、成交或资金分配结果。
 */
export function buildForwardPreparedBuys(
  candidates: LeaderCandidate[],
  signalDate: string,
  strategyKey: PaperTradingStrategyKey,
  options: {
    appliedMinScore?: number | null;
    penaltyWeight?: number;
    hardRiskThreshold?: number;
    priceByStockDate?: Map<string, LeaderCandidateDailyPrice>;
  },
  heldCodes: Set<string>,
  maxPositions: number,
): PaperPendingBuy[] {
  const appliedMinScore = options.appliedMinScore ?? null;
  const penaltyWeight = options.penaltyWeight ?? defaultDownsideRiskPenaltyWeight;
  const hardRiskThreshold = options.hardRiskThreshold ?? 0;
  const priceByStockDate = options.priceByStockDate ?? new Map<string, LeaderCandidateDailyPrice>();

  const scored = candidates
    .filter((candidate) => appliedMinScore === null || candidate.score >= appliedMinScore)
    .map((candidate) => {
      const signalRow = candidateToSignalRow(candidate, signalDate);
      const qualityScore = calculateQualityBlendScoreForRisk(signalRow, candidate.riskScore, { priceByStockDate });
      const strategyScore = strategyKey === "riskPenalty"
        ? Math.max(0, round(candidate.score - candidate.riskScore * penaltyWeight))
        : strategyKey === "qualityBlend" || strategyKey === "qualityGate"
          ? qualityScore
          : candidate.score;
      return { candidate, strategyScore, qualityScore };
    });

  const qualityScores = scored.map(({ qualityScore }) => qualityScore).sort((left, right) => left - right);
  const qualityMedian = qualityScores.length === 0
    ? Number.POSITIVE_INFINITY
    : qualityScores.length % 2 === 0
      ? (qualityScores[qualityScores.length / 2 - 1]! + qualityScores[qualityScores.length / 2]!) / 2
      : qualityScores[Math.floor(qualityScores.length / 2)]!;

  const availableSlots = Math.max(0, Math.floor(maxPositions) - heldCodes.size);
  const strategyCandidates = scored
    .filter(({ candidate, strategyScore }) => {
      if (strategyKey === "hardFilter") return candidate.riskScore < hardRiskThreshold;
      if (strategyKey === "qualityGate") return candidate.riskScore < hardRiskThreshold && strategyScore >= qualityMedian;
      return true;
    })
    .filter(({ candidate }) => !heldCodes.has(candidate.stockCode))
    .sort((left, right) => (
      right.strategyScore - left.strategyScore
      || right.candidate.boards - left.candidate.boards
      || right.candidate.sectorCount - left.candidate.sectorCount
      || (left.candidate.limitUpTime ?? "99:99:99").localeCompare(right.candidate.limitUpTime ?? "99:99:99")
      || left.candidate.stockCode.localeCompare(right.candidate.stockCode)
    ));

  return strategyCandidates.slice(0, availableSlots).map(({ candidate, strategyScore }, index) => ({
    rank: index + 1,
    stockCode: candidate.stockCode,
    stockName: candidate.stockName,
    sector: candidate.sector,
    boards: candidate.boards,
    signalDate,
    signalClosePrice: priceByStockDate.get(`${candidate.stockCode}::${signalDate}`)?.closePrice ?? null,
    limitUpTime: candidate.limitUpTime,
    score: candidate.score,
    riskScore: candidate.riskScore,
    riskTier: candidate.riskTier,
    strategyScore,
    reasons: candidate.reasons,
  }));
}

/** 创建初始状态：现金 + 空持仓/订单/曲线。 */
export function createInitialPaperTradingState(initialCapital: number): PaperTradingState {
  return {
    cash: round(initialCapital),
    positions: [],
    pendingBuys: [],
    orders: [],
    equityCurve: [],
    lastProcessedDate: null,
  };
}

/** 创建一条跳过成交的订单（资金/规则原因未成交）。 */
function createSkippedOrder(pending: PaperPendingBuy, entryDate: string, reason: string): PaperOrder {
  return {
    signalDate: pending.signalDate,
    stockCode: pending.stockCode,
    stockName: pending.stockName,
    score: pending.score,
    strategyScore: pending.strategyScore,
    riskScore: pending.riskScore,
    riskTier: pending.riskTier,
    entryDate,
    entryPrice: null,
    shares: 0,
    totalFees: 0,
    exitDate: null,
    exitPrice: null,
    netPnl: null,
    netReturn: null,
    status: "skipped",
    reason,
  };
}

/**
 * 逐日推进状态机：开盘成交既有准备清单 → 收盘更新最高价并止盈止损出清 → 标记市值 → 生成次日准备清单。
 * 返回新状态与当日事件。纯函数，不修改入参。
 */
export function advancePaperTradingDay(input: PaperTradingAdvanceInput): { state: PaperTradingState; events: PaperTradingDayEvent } {
  const {
    state,
    today,
    signalCandidates,
    priceByStockDate,
    tradingDates,
    strategyKey,
    realistic,
    appliedMinScore = null,
    penaltyWeight,
    hardRiskThreshold,
  } = input;

  const initialCapital = realistic.initialCapital ?? 100_000;
  const maxPositions = Math.max(1, Math.floor(realistic.maxPositions ?? 5));
  const commissionRate = realistic.commissionRate ?? 0.0003;
  const stampDutyRate = realistic.stampDutyRate ?? 0.0005;
  const transferFeeRate = realistic.transferFeeRate ?? 0.00001;
  const slippageBps = realistic.slippageBps ?? 10;
  const lotSize = Math.max(1, Math.floor(realistic.lotSize ?? 100));
  const blockLimitUpBuys = realistic.blockLimitUpBuys ?? false;
  const blockLimitDownSells = realistic.blockLimitDownSells ?? false;
  const enableOneWordLimitDownProbability = realistic.enableOneWordLimitDownProbability ?? false;
  const oneWordLimitDownSellProbability = Math.min(100, Math.max(0, realistic.oneWordLimitDownSellProbability ?? 0));
  const positionSizingStrategy = realistic.positionSizingStrategy ?? "equal";
  const fixedPositionPercent = Math.min(100, Math.max(1, realistic.fixedPositionPercent ?? 20));
  const trailingProfitActivationPercent = Math.min(100, Math.max(0, realistic.trailingProfitActivationPercent ?? 6));
  const trailingDrawdownPercent = Math.min(100, Math.max(0, realistic.trailingDrawdownPercent ?? 3));
  const stopLossPercent = Math.min(100, Math.max(0, realistic.stopLossPercent ?? 5));
  const strongHoldMinReturn = Math.min(100, Math.max(0, realistic.strongHoldMinReturn ?? 3));
  const maxHoldingDays = Math.max(2, Math.floor(realistic.maxHoldingDays ?? 5));
  const minimumExpectedOpenChangePercent = Math.min(100, Math.max(-50, realistic.minimumExpectedOpenChangePercent ?? -2));
  const expectationTierEnabled = realistic.expectationTierEnabled ?? false;
  const expectationTable: OpenExpectationTable = realistic.expectationTable ?? OPEN_EXPECTATION_DEFAULT_TABLE;
  const blockOneWordLimitUpBuys = realistic.blockOneWordLimitUpBuys ?? false;
  const enableIntradayStopLoss = realistic.enableIntradayStopLoss ?? false;
  const maxPositionAmountRatio = Math.max(0, realistic.maxPositionAmountRatio ?? 0);

  const tradingDateIndex = new Map(tradingDates.map((date, index) => [date, index]));
  const todayIndex = tradingDateIndex.get(today) ?? 0;

  let cash = state.cash;
  const positions: PaperPosition[] = state.positions.map((position) => ({ ...position }));
  const orders: PaperOrder[] = state.orders.map((order) => ({ ...order }));
  const equityCurve: PaperEquityPoint[] = state.equityCurve.map((point) => ({ ...point }));

  const findOrder = (stockCode: string, entryDate: string) => orders.find((order) => (
    order.stockCode === stockCode && order.entryDate === entryDate && order.status !== "skipped"
  ));

  const filledOrders: PaperOrder[] = [];
  const exitedOrders: PaperOrder[] = [];
  const skippedOrders: PaperOrder[] = [];

  const settlePosition = (position: PaperPosition, date: string, rawExitPrice: number, reason: string | null) => {
    const exitAmount = priceByStockDate.get(`${position.stockCode}::${date}`)?.amount ?? null;
    const exitSlippageBps = amountAdjustedSlippageBps(slippageBps, exitAmount);
    const slippedExit = rawExitPrice * (1 - exitSlippageBps / 10_000);
    const grossExit = slippedExit * position.shares;
    const sellFees = grossExit * (commissionRate + stampDutyRate + transferFeeRate);
    const proceeds = grossExit - sellFees;
    const netPnl = proceeds - position.capitalCost;
    cash += proceeds;
    const order = findOrder(position.stockCode, position.entryDate);
    if (order) {
      order.exitDate = date;
      order.exitPrice = round(slippedExit, 4);
      order.totalFees = round(order.totalFees + sellFees);
      order.netPnl = round(netPnl);
      order.netReturn = round((netPnl / position.capitalCost) * 100);
      order.status = "exited";
      order.reason = reason;
      exitedOrders.push(order);
    }
  };

  // ===== 开盘：成交既有准备买入清单 =====
  const heldCodes = new Set(positions.map((position) => position.stockCode));
  const selectedBuys = state.pendingBuys.slice();
  const scoreTotal = selectedBuys.reduce((sum, pending) => sum + Math.max(pending.strategyScore, 0), 0);
  const budgetByCode = new Map<string, number>();
  for (const pending of selectedBuys) {
    let budget = 0;
    if (positionSizingStrategy === "scoreWeighted") {
      budget = scoreTotal > 0 ? cash * Math.max(pending.strategyScore, 0) / scoreTotal : cash / Math.max(1, selectedBuys.length);
    } else if (positionSizingStrategy === "fixedPercent") {
      budget = initialCapital * fixedPositionPercent / 100;
    } else {
      budget = cash / Math.max(1, selectedBuys.length);
    }
    budgetByCode.set(pending.stockCode, budget);
  }

  for (const pending of selectedBuys) {
    const slots = maxPositions - positions.length;
    const dayPrice = priceByStockDate.get(`${pending.stockCode}::${today}`);
    const openPrice = dayPrice?.openPrice ?? null;
    const highPrice = dayPrice?.highPrice ?? null;
    const lowPrice = dayPrice?.lowPrice ?? null;
    const amount = dayPrice?.amount ?? null;

    if (!validPrice(openPrice)) {
      skippedOrders.push(createSkippedOrder(pending, today, "缺少今日开盘行情"));
      continue;
    }
    const openChange = validPrice(pending.signalClosePrice)
      ? ((openPrice - pending.signalClosePrice) / pending.signalClosePrice) * 100
      : null;
    // 次日开盘预期三档门控：开启时按封板时间分档的期望区间判定「不及预期→放弃」；未开启时退回旧的一刀切阈值。
    const skipByExpectation = expectationTierEnabled
      ? openChange !== null && classifyOpenExpectation(bucketOfLimitUpTime(pending.limitUpTime), openChange, expectationTable) === "misses"
      : openChange !== null && openChange < minimumExpectedOpenChangePercent;
    if (skipByExpectation) {
      const reason = expectationTierEnabled
        ? `${formatMissedReason(openChange!, bucketOfLimitUpTime(pending.limitUpTime), "misses", expectationTable)}，放弃买入`
        : `开盘低于预期（${round(openChange!)}% < ${minimumExpectedOpenChangePercent}%），不买入`;
      skippedOrders.push(createSkippedOrder(pending, today, reason));
      continue;
    }
    const limitUp = validPrice(pending.signalClosePrice) && openPrice >= pending.signalClosePrice * 1.099;
    if (blockLimitUpBuys && limitUp) {
      skippedOrders.push(createSkippedOrder(pending, today, "开盘接近涨停，按保守规则不可追买"));
      continue;
    }
    const oneWordLimitUp = limitUp
      && validPrice(highPrice) && validPrice(lowPrice)
      && Math.abs(highPrice - lowPrice) <= openPrice * 0.002
      && Math.abs(openPrice - highPrice) <= openPrice * 0.002;
    if (blockOneWordLimitUpBuys && oneWordLimitUp) {
      skippedOrders.push(createSkippedOrder(pending, today, "一字涨停封死，无法买入"));
      continue;
    }
    if (heldCodes.has(pending.stockCode)) {
      skippedOrders.push(createSkippedOrder(pending, today, "同一股票已有持仓"));
      continue;
    }
    if (slots <= 0) {
      skippedOrders.push(createSkippedOrder(pending, today, "超过最大持仓数"));
      continue;
    }

    const entrySlippageBps = amountAdjustedSlippageBps(slippageBps, amount);
    const slippedEntry = openPrice * (1 + entrySlippageBps / 10_000);
    const plannedBudget = budgetByCode.get(pending.stockCode) ?? 0;
    const executableBudget = Math.min(plannedBudget, cash);
    let shares = Math.floor(executableBudget / (slippedEntry * (1 + commissionRate + transferFeeRate)) / lotSize) * lotSize;
    if (maxPositionAmountRatio > 0 && validPrice(amount)) {
      const capacityShares = Math.floor((amount * 1000 * maxPositionAmountRatio) / openPrice / lotSize) * lotSize;
      if (capacityShares < shares) shares = capacityShares;
    }
    if (shares < lotSize) {
      skippedOrders.push(createSkippedOrder(pending, today, "可用资金不足以买入一手"));
      continue;
    }
    const grossEntry = slippedEntry * shares;
    const buyFees = grossEntry * (commissionRate + transferFeeRate);
    const capitalCost = grossEntry + buyFees;
    if (capitalCost > cash + 1e-8) {
      skippedOrders.push(createSkippedOrder(pending, today, "可用资金不足以完成买入"));
      continue;
    }
    cash -= capitalCost;
    const position: PaperPosition = {
      stockCode: pending.stockCode,
      stockName: pending.stockName,
      signalDate: pending.signalDate,
      entryDate: today,
      entryPrice: slippedEntry,
      shares,
      capitalCost,
      previousClosePrice: null,
      highestClosePrice: slippedEntry,
      entryTradingDateIndex: todayIndex,
    };
    positions.push(position);
    heldCodes.add(position.stockCode);
    const order: PaperOrder = {
      signalDate: pending.signalDate,
      stockCode: pending.stockCode,
      stockName: pending.stockName,
      score: pending.score,
      strategyScore: pending.strategyScore,
      riskScore: pending.riskScore,
      riskTier: pending.riskTier,
      entryDate: today,
      entryPrice: round(slippedEntry, 4),
      shares,
      totalFees: round(buyFees),
      exitDate: null,
      exitPrice: null,
      netPnl: null,
      netReturn: null,
      status: "filled",
      reason: null,
    };
    orders.push(order);
    filledOrders.push(order);
  }

  // ===== 收盘：更新最高价、止盈止损出清 =====
  const remainingPositions: PaperPosition[] = [];
  for (const position of positions) {
    const dayPrice = priceByStockDate.get(`${position.stockCode}::${today}`);
    const closePrice = dayPrice?.closePrice ?? null;
    if (validPrice(closePrice)) {
      position.highestClosePrice = Math.max(position.highestClosePrice, closePrice);
    }
    const eligible = todayIndex > position.entryTradingDateIndex;
    if (!eligible) {
      // 建仓当日：仅记录收盘价作为下一交易日的「前收」，不做退出。
      position.previousClosePrice = validPrice(closePrice) ? closePrice : position.previousClosePrice;
      remainingPositions.push(position);
      continue;
    }
    if (!validPrice(closePrice)) {
      // 收盘行情缺失，无法出清，顺延到下一实际交易日。
      remainingPositions.push(position);
      continue;
    }
    const marketOpenPrice = dayPrice?.openPrice ?? null;
    const marketLowPrice = dayPrice?.lowPrice ?? null;
    const holdingDays = Math.max(1, todayIndex - position.entryTradingDateIndex + 1);
    const closeReturnPercent = ((closePrice - position.entryPrice) / position.entryPrice) * 100;
    const limitDown = validPrice(position.previousClosePrice) && closePrice <= position.previousClosePrice * 0.901;
    const oneWordLimitDown = limitDown
      && validPrice(position.previousClosePrice)
      && validPrice(marketOpenPrice)
      && marketOpenPrice <= position.previousClosePrice * 0.901
      && Math.abs(marketOpenPrice - closePrice) <= position.previousClosePrice * 0.002;

    if (enableIntradayStopLoss && !oneWordLimitDown) {
      const stopPrice = position.entryPrice * (1 - stopLossPercent / 100);
      if (validPrice(marketLowPrice) && validPrice(marketOpenPrice) && marketOpenPrice > stopPrice && marketLowPrice <= stopPrice) {
        settlePosition(position, today, stopPrice, `盘中触及止损（${round((stopPrice - position.entryPrice) / position.entryPrice * 100)}% ≤ -${stopLossPercent}%）`);
        continue;
      }
    }

    const oneWordProbabilityFill = oneWordLimitDown
      && enableOneWordLimitDownProbability
      && hitsDeterministicProbability(`${position.stockCode}::${position.entryDate}::${today}`, oneWordLimitDownSellProbability);
    if (blockLimitDownSells && oneWordLimitDown && !oneWordProbabilityFill) {
      position.previousClosePrice = closePrice;
      remainingPositions.push(position);
      continue;
    }

    const peakClosePrice = position.highestClosePrice;
    const peakReturnPercent = ((peakClosePrice - position.entryPrice) / position.entryPrice) * 100;
    const drawdownFromPeakPercent = peakClosePrice === 0 ? 0 : ((closePrice - peakClosePrice) / peakClosePrice) * 100;
    const trailingArmed = peakReturnPercent >= trailingProfitActivationPercent;
    let exitTriggerReason: string | null = null;
    if (closeReturnPercent <= -stopLossPercent) {
      exitTriggerReason = `收盘触发止损（${round(closeReturnPercent)}% ≤ -${stopLossPercent}%）`;
    } else if (trailingArmed && drawdownFromPeakPercent < 0 && drawdownFromPeakPercent <= -trailingDrawdownPercent) {
      exitTriggerReason = `动态回撤止盈（峰值收益${round(peakReturnPercent)}%，回撤${round(drawdownFromPeakPercent)}% ≤ -${trailingDrawdownPercent}%）`;
    } else {
      const strongClose = closeReturnPercent >= strongHoldMinReturn
        && (!validPrice(position.previousClosePrice) || closePrice >= position.previousClosePrice);
      if (holdingDays >= maxHoldingDays) {
        exitTriggerReason = `达到最多续持${maxHoldingDays}个交易日`;
      } else if (!trailingArmed && !strongClose) {
        exitTriggerReason = "收盘未满足强势续持条件";
      } else {
        position.previousClosePrice = closePrice;
        remainingPositions.push(position);
        continue;
      }
    }
    settlePosition(position, today, closePrice, oneWordProbabilityFill
      ? `一字跌停保守成交概率${oneWordLimitDownSellProbability}%命中，实际交易日出清`
      : exitTriggerReason);
  }

  // ===== 标记市值 =====
  const markedEquity = cash + remainingPositions.reduce((sum, position) => {
    const closePrice = priceByStockDate.get(`${position.stockCode}::${today}`)?.closePrice ?? null;
    const valuation = validPrice(closePrice) ? closePrice : position.entryPrice;
    return sum + valuation * position.shares;
  }, 0);
  equityCurve.push({ date: today, equity: round(markedEquity), cash: round(cash), openPositions: remainingPositions.length });

  // ===== 生成下一交易日准备清单 =====
  const nextPendingBuys = buildForwardPreparedBuys(
    signalCandidates,
    today,
    strategyKey,
    { appliedMinScore, penaltyWeight, hardRiskThreshold, priceByStockDate },
    new Set(remainingPositions.map((position) => position.stockCode)),
    maxPositions,
  );

  const nextState: PaperTradingState = {
    cash: round(cash),
    positions: remainingPositions,
    pendingBuys: nextPendingBuys,
    orders,
    equityCurve,
    lastProcessedDate: today,
  };

  return {
    state: nextState,
    events: {
      date: today,
      filledCount: filledOrders.length,
      exitedCount: exitedOrders.length,
      skippedCount: skippedOrders.length,
      equity: round(markedEquity),
      cash: round(cash),
      openPositions: remainingPositions.length,
      filledOrders,
      exitedOrders,
      skippedOrders,
    },
  };
}

/** 与 realisticBacktest 一致的确定性概率抽样（订单标识 → 稳定哈希），保证一字跌停成交概率可复现。 */
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

export type PaperTradingSummary = {
  initialCapital: number;
  finalEquity: number;
  netProfit: number;
  totalReturn: number | null;
  maxDrawdown: number | null;
  filledCount: number;
  exitedCount: number;
  openPositionCount: number;
  winningTrades: number;
  winRate: number | null;
  averageReturn: number | null;
  profitFactor: number | null;
  tradingDayCount: number;
};

/** 从状态汇总前向曲线关键指标，供与历史回测对比。 */
export function buildPaperTradingSummary(state: PaperTradingState, initialCapital: number): PaperTradingSummary {
  const finalEquity = state.equityCurve.at(-1)?.equity ?? state.cash;
  const exitedOrders = state.orders.filter((order) => order.status === "exited" && order.netPnl !== null);
  const pnlValues = exitedOrders.map((order) => order.netPnl!);
  const grossProfit = pnlValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(pnlValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));

  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const point of state.equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.max(maxDrawdown, peak === 0 ? 0 : ((peak - point.equity) / peak) * 100);
  }

  return {
    initialCapital: round(initialCapital),
    finalEquity: round(finalEquity),
    netProfit: round(finalEquity - initialCapital),
    totalReturn: initialCapital === 0 ? null : round(((finalEquity - initialCapital) / initialCapital) * 100),
    maxDrawdown: state.equityCurve.length === 0 ? null : round(maxDrawdown),
    filledCount: state.orders.filter((order) => order.status !== "skipped").length,
    exitedCount: exitedOrders.length,
    openPositionCount: state.positions.length,
    winningTrades: exitedOrders.filter((order) => order.netPnl! > 0).length,
    winRate: exitedOrders.length === 0 ? null : round((exitedOrders.filter((order) => order.netPnl! > 0).length / exitedOrders.length) * 100, 1),
    averageReturn: exitedOrders.length === 0 ? null : round(exitedOrders.reduce((sum, order) => sum + (order.netReturn ?? 0), 0) / exitedOrders.length),
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : round(grossProfit / grossLoss, 2),
    tradingDayCount: state.equityCurve.length,
  };
}
