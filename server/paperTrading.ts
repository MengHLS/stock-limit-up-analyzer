import type {
  LeaderCandidate,
  LeaderCandidateBacktestOptions,
  LeaderCandidateBacktestRow,
  LeaderCandidateDailyPrice,
} from "./leaderCandidates";
import type { PositionSizingStrategy, RealisticBacktestOptions } from "./realisticBacktest";
import type { DownsideRiskStrategyKey } from "./downsideRisk";
import { calculateQualityBlendScoreForRisk, defaultDownsideRiskPenaltyWeight } from "./downsideRisk";
import {
  OPEN_EXPECTATION_DEFAULT_TABLE,
  bucketOfLimitUpTime,
  classifyOpenExpectation,
  formatMissedReason,
  type OpenExpectationTable,
} from "./openExpectation";
import { isPriceAtLimitDown, isPriceAtLimitUp } from "./data/boardRules";

/**
 * 前向纸面交易闭环（四-P1）：真实样本外兜底。
 *
 * 与历史回测（research-legacy 交易模拟器，见 research/legacyTransactionSimulator）的差别在于：
 * 这里是有状态的、逐日推进的增量过程——
 * T 日收盘用「仅 T 日及以前」的信号生成次日准备买入清单 → 下一交易日开盘按真实开盘价成交 →
 * 持仓按风险管理的止盈止损规则逐日追踪出清 → 累积真实前向权益曲线，与历史回测对比。
 *
 * 关键约束：
 * - Point-in-time：候选评分只读 ≤ 信号日的数据，且惩罚权重使用固定值（不做基于未来窗口的自动调参），杜绝未来函数。
 * - 本模块为纯函数，不触碰数据库；持久化由 db.ts 承担。
 *
 * 🔴 与组合回测（realisticBacktest）的口径关系 —— **逐条声明，禁止含混**（2026-09-18 修正）：
 *
 * | 退出规则 | 组合回测 | 前向纸面 |
 * | --- | --- | --- |
 * | 开盘止损（开盘价 ≤ 成本×(1−stopLoss%)） | 有 | **有**（`exitJudgementPhase` 含 open 时；2026-09-18 前**没有**，是 D1 结构性缺陷） |
 * | 收盘止损 | 有 | 有 |
 * | 盘中止损（最低价触及，需开关） | 有 | 有 |
 * | 动态回撤止盈 | 有（仅收盘） | 有（开盘/收盘按 `exitJudgementPhase`） |
 * | 强势续持 / 最多续持 | 有（仅收盘） | 有（仅收盘） |
 * | **组合无条件止损（单票浮亏 > 建仓总权益×N%）** | **无** | **有**（纸面专属，缺省 3%） |
 *
 * ⇒ 默认参数下两端**只在「组合无条件止损」这一条上不同**，且默认就是不同的。
 * 这是**用户明确要求的口径分叉**（只加在纸面、不动回测以免重算全部历史回测数值），
 * 不是遗漏：任何「纸面曲线与回测可比」的表述都必须附带这条差异。
 * 把 `portfolioStopLossPercent` 设为 0 即关闭该规则，可回到「仅剩时点差异」的等价形态。
 */

export type PaperTradingStrategyKey = DownsideRiskStrategyKey;

// ==================== 纸面专属设置（回测侧不消费） ====================
// 这些设置放在运行 options 的 `paperTrading` 块下，而不是塞进 `realistic`：
// `realistic` 是与组合回测**共用**的参数容器，往里加只有纸面认识的字面量，
// 等于制造「回测参数里躺着它不消费的字段」这种最难发现的漂移。边界必须由类型来表达。

/** 止损 / 动态回撤止盈的判定时点。缺省 `both`（开盘与收盘各判一次）。 */
export type PaperTradingExitPhase = "open" | "close" | "both";

export const PAPER_TRADING_EXIT_PHASES = ["open", "close", "both"] as const;

/** 缺省判定时点：开盘 + 收盘（与组合回测「开盘判一次、收盘再判一次」对齐）。 */
export const PAPER_TRADING_DEFAULT_EXIT_PHASE: PaperTradingExitPhase = "both";

/**
 * 缺省「组合无条件止损」阈值（%）。
 *
 * 语义：单笔持仓的浮亏（市值 − 建仓成本，含买入费用）达到「**建仓时账户总权益**」的 3% 时，
 * **无条件**出清 —— 不受「强势续持 / 动态回撤止盈已激活 / 最多续持未到」等豁免影响。
 *
 * 🔴 这是**纸面专属**规则，组合回测侧不存在 ⇒ 默认参数下两端不再逐笔等价。
 * 设 **0 = 关闭**（关闭后回到「与回测仅剩时点差异」的形态）。
 */
export const PAPER_TRADING_DEFAULT_PORTFOLIO_STOP_LOSS_PERCENT = 3;

/** 纸面运行专属设置；缺字段一律按上面的缺省常量解析（旧运行零写库即生效）。 */
export type PaperTradingSettings = {
  exitJudgementPhase?: PaperTradingExitPhase;
  portfolioStopLossPercent?: number;
};

/** 纸面运行的 options：与回测共用同一份基础参数，外加一个纸面专属设置块。 */
export type PaperTradingRunOptions = LeaderCandidateBacktestOptions & {
  paperTrading?: PaperTradingSettings;
};

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
  /**
   * 建仓时账户总权益（现金 + 存续持仓按最近可见收盘估值），**冻结在建仓那一刻**。
   * 这是「组合无条件止损」的分母，与组合回测 `RealisticTrade.pnlToEquityRatio` 同一口径。
   * ⚠️ 2026-09-18 之前落库的持仓没有这个字段（旧 stateJson）⇒ 读取端回落为初始资金（见 db.ts#parsePaperTradingState）。
   */
  equityAtEntry: number;
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
  /** 纸面专属设置（判定时点 / 组合无条件止损阈值）；缺省按 PAPER_TRADING_DEFAULT_* 解析。 */
  paperTrading?: PaperTradingSettings;
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

// ==================== 参数解析（唯一缺省源） ====================
// ⚠️ 缺省值与夹取范围**只能在这里写一次**。此前推进逻辑内联缺省、而页面零处展示生效参数，
// 结果是「真库里 4 条运行全部是硬编码缺省，而没有人知道」——这类『口径漂移』靠纪律防不住，只能靠结构。

/** `realistic` 解析后的确定值（缺省回落 + 夹取已完成）。 */
export type ResolvedPaperRealisticOptions = {
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
  positionSizingStrategy: PositionSizingStrategy;
  fixedPositionPercent: number;
  trailingProfitActivationPercent: number;
  trailingDrawdownPercent: number;
  stopLossPercent: number;
  strongHoldMinReturn: number;
  maxHoldingDays: number;
  minimumExpectedOpenChangePercent: number;
  expectationTierEnabled: boolean;
  expectationTable: OpenExpectationTable;
  blockOneWordLimitUpBuys: boolean;
  enableIntradayStopLoss: boolean;
  maxPositionAmountRatio: number;
};

const clampPercent = (value: number | undefined, fallback: number) => Math.min(100, Math.max(0, value ?? fallback));

/** 解析 `realistic`（缺省回落 + 夹取）。推进逻辑与「生效参数面板」共用，杜绝两套缺省。 */
export function resolvePaperRealisticOptions(realistic: RealisticBacktestOptions): ResolvedPaperRealisticOptions {
  return {
    initialCapital: realistic.initialCapital ?? 100_000,
    maxPositions: Math.max(1, Math.floor(realistic.maxPositions ?? 5)),
    commissionRate: realistic.commissionRate ?? 0.0003,
    stampDutyRate: realistic.stampDutyRate ?? 0.0005,
    transferFeeRate: realistic.transferFeeRate ?? 0.00001,
    slippageBps: realistic.slippageBps ?? 10,
    lotSize: Math.max(1, Math.floor(realistic.lotSize ?? 100)),
    blockLimitUpBuys: realistic.blockLimitUpBuys ?? false,
    blockLimitDownSells: realistic.blockLimitDownSells ?? false,
    enableOneWordLimitDownProbability: realistic.enableOneWordLimitDownProbability ?? false,
    oneWordLimitDownSellProbability: clampPercent(realistic.oneWordLimitDownSellProbability, 0),
    positionSizingStrategy: realistic.positionSizingStrategy ?? "equal",
    fixedPositionPercent: Math.min(100, Math.max(1, realistic.fixedPositionPercent ?? 20)),
    trailingProfitActivationPercent: clampPercent(realistic.trailingProfitActivationPercent, 6),
    trailingDrawdownPercent: clampPercent(realistic.trailingDrawdownPercent, 3),
    stopLossPercent: clampPercent(realistic.stopLossPercent, 5),
    strongHoldMinReturn: clampPercent(realistic.strongHoldMinReturn, 3),
    maxHoldingDays: Math.max(2, Math.floor(realistic.maxHoldingDays ?? 5)),
    minimumExpectedOpenChangePercent: Math.min(100, Math.max(-50, realistic.minimumExpectedOpenChangePercent ?? -2)),
    expectationTierEnabled: realistic.expectationTierEnabled ?? false,
    expectationTable: realistic.expectationTable ?? OPEN_EXPECTATION_DEFAULT_TABLE,
    blockOneWordLimitUpBuys: realistic.blockOneWordLimitUpBuys ?? false,
    enableIntradayStopLoss: realistic.enableIntradayStopLoss ?? false,
    maxPositionAmountRatio: Math.max(0, realistic.maxPositionAmountRatio ?? 0),
  };
}

/**
 * 解析纸面专属设置。
 * 缺字段 ⇒ 按缺省常量（`both` / 3%）⇒ **旧运行零写库即生效**；认不出的值同样回落（不静默变成 undefined）。
 */
export function resolvePaperTradingSettings(settings: PaperTradingSettings | undefined): {
  exitJudgementPhase: PaperTradingExitPhase;
  portfolioStopLossPercent: number;
} {
  const phase = settings?.exitJudgementPhase;
  return {
    exitJudgementPhase: phase === "open" || phase === "close" || phase === "both"
      ? phase
      : PAPER_TRADING_DEFAULT_EXIT_PHASE,
    portfolioStopLossPercent: clampPercent(settings?.portfolioStopLossPercent, PAPER_TRADING_DEFAULT_PORTFOLIO_STOP_LOSS_PERCENT),
  };
}

/** 页面上要展示的「该运行实际生效的参数」。 */
export type PaperTradingEffectiveSettings = {
  exitJudgementPhase: PaperTradingExitPhase;
  portfolioStopLossPercent: number;
  maxPositions: number;
  positionSizingStrategy: PositionSizingStrategy;
  fixedPositionPercent: number;
  stopLossPercent: number;
  strongHoldMinReturn: number;
  maxHoldingDays: number;
  trailingProfitActivationPercent: number;
  trailingDrawdownPercent: number;
  enableIntradayStopLoss: boolean;
  blockLimitUpBuys: boolean;
  blockOneWordLimitUpBuys: boolean;
  blockLimitDownSells: boolean;
  enableOneWordLimitDownProbability: boolean;
  oneWordLimitDownSellProbability: number;
  maxPositionAmountRatio: number;
  /** paramsJson 里**显式写过**的路径（其余为服务端缺省回落）⇒ 页面据此标注「你设的 / 默认的」。 */
  explicitKeys: string[];
};

/**
 * 由运行 options 算出「实际生效的参数」（含缺省回落）。
 * 这是 D2 的根治点：页面不再自己维护一套缺省值去猜服务端。
 */
export function resolveEffectivePaperSettings(options: PaperTradingRunOptions): PaperTradingEffectiveSettings {
  const realistic = options.realistic ?? {};
  const resolved = resolvePaperRealisticOptions(realistic);
  const settings = resolvePaperTradingSettings(options.paperTrading);
  const explicitKeys = [
    ...Object.keys(realistic).map((key) => `realistic.${key}`),
    ...Object.keys(options.paperTrading ?? {}).map((key) => `paperTrading.${key}`),
  ];
  return {
    exitJudgementPhase: settings.exitJudgementPhase,
    portfolioStopLossPercent: settings.portfolioStopLossPercent,
    maxPositions: resolved.maxPositions,
    positionSizingStrategy: resolved.positionSizingStrategy,
    fixedPositionPercent: resolved.fixedPositionPercent,
    stopLossPercent: resolved.stopLossPercent,
    strongHoldMinReturn: resolved.strongHoldMinReturn,
    maxHoldingDays: resolved.maxHoldingDays,
    trailingProfitActivationPercent: resolved.trailingProfitActivationPercent,
    trailingDrawdownPercent: resolved.trailingDrawdownPercent,
    enableIntradayStopLoss: resolved.enableIntradayStopLoss,
    blockLimitUpBuys: resolved.blockLimitUpBuys,
    blockOneWordLimitUpBuys: resolved.blockOneWordLimitUpBuys,
    blockLimitDownSells: resolved.blockLimitDownSells,
    enableOneWordLimitDownProbability: resolved.enableOneWordLimitDownProbability,
    oneWordLimitDownSellProbability: resolved.oneWordLimitDownSellProbability,
    maxPositionAmountRatio: resolved.maxPositionAmountRatio,
    explicitKeys,
  };
}

/**
 * 退出原因的**字面量**前缀表。
 *
 * 🔴 为什么不用 `${phaseLabel}触发止损（…）` 拼串：那样运行期文案一样，但源码里搜不到
 * 「开盘触发止损」这个字面量 —— 而跨文件对拍（`grep -c "开盘触发止损"` 回测 3 / 纸面 0）
 * 正是 D1 当初被发现的方式。**可被 grep 的事实才是可审计的事实**，所以时点前缀必须是字面量。
 */
const HARD_EXIT_PREFIX = {
  开盘: { stop: "开盘触发止损", portfolio: "开盘触发组合止损", trailing: "开盘触发动态回撤止盈" },
  收盘: { stop: "收盘触发止损", portfolio: "收盘触发组合止损", trailing: "收盘触发动态回撤止盈" },
} as const;

export type PaperHardExitInput = {
  /** 「开盘」/「收盘」：决定原因文案前缀（缺省时点由 `exitJudgementPhase` 决定）。 */
  phaseLabel: "开盘" | "收盘";
  /** 判定用价格（开盘阶段 = 开盘价）。盘中止损另有 `enableIntradayStopLoss` 开关，不走本函数。 */
  price: number;
  position: PaperPosition;
  stopLossPercent: number;
  trailingProfitActivationPercent: number;
  trailingDrawdownPercent: number;
  portfolioStopLossPercent: number;
  /** 旧持仓缺 `equityAtEntry`（2026-09-18 前落库）时的兜底分母 = 初始资金。 */
  fallbackEquityBase: number;
};

/**
 * 硬性退出判定（无状态纯函数）：单票比例止损 → 组合无条件止损 → 动态回撤止盈。
 *
 * 「硬性」= 不受「强势续持 / 回撤止盈已激活 / 最多续持未到」等豁免影响，
 * **但仍受「一字跌停卖不出」这一物理约束**（该守卫在调用方，不在本函数）。
 * 返回出清原因；无触发返回 null。
 *
 * 开盘与收盘两个阶段共用本函数 ⇒ 「同一套规则两个阶段各判一次」，不会各自漂移。
 */
export function evaluateHardExitRules(input: PaperHardExitInput): string | null {
  const {
    phaseLabel,
    price,
    position,
    stopLossPercent,
    trailingProfitActivationPercent,
    trailingDrawdownPercent,
    portfolioStopLossPercent,
    fallbackEquityBase,
  } = input;
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(position.entryPrice) || position.entryPrice <= 0) return null;
  const prefix = HARD_EXIT_PREFIX[phaseLabel];

  // ① 单票固定比例止损：文案与组合回测逐字同形（仅前缀的开盘/收盘不同），便于两端对拍。
  const returnPercent = ((price - position.entryPrice) / position.entryPrice) * 100;
  if (returnPercent <= -stopLossPercent) {
    return `${prefix.stop}（${round(returnPercent)}% ≤ -${stopLossPercent}%）`;
  }

  // ② 组合无条件止损（纸面专属）：优先于回撤止盈 —— 先把「亏损封顶」做完，再谈「利润保护」。
  //    分母 = 建仓时账户总权益（与回测 pnlToEquityRatio 同源），冻结在建仓那一刻，不受后续浮盈浮亏与后续买卖影响。
  if (portfolioStopLossPercent > 0) {
    const equityBase = Number.isFinite(position.equityAtEntry) && position.equityAtEntry > 0
      ? position.equityAtEntry
      : fallbackEquityBase;
    if (equityBase > 0) {
      // 浮亏口径 = 市值 − 建仓成本（成本含买入费用）；正数=盈利。
      const portfolioLossPercent = ((price * position.shares - position.capitalCost) / equityBase) * 100;
      if (portfolioLossPercent <= -portfolioStopLossPercent) {
        return `${prefix.portfolio}（该笔浮亏占建仓总权益 ${Math.abs(round(portfolioLossPercent))}%，达 ${portfolioStopLossPercent}% 无条件出清）`;
      }
    }
  }

  // ③ 动态回撤止盈
  const peakClosePrice = position.highestClosePrice;
  if (!Number.isFinite(peakClosePrice) || peakClosePrice <= 0) return null;
  const peakReturnPercent = ((peakClosePrice - position.entryPrice) / position.entryPrice) * 100;
  const drawdownFromPeakPercent = ((price - peakClosePrice) / peakClosePrice) * 100;
  if (peakReturnPercent >= trailingProfitActivationPercent
    && drawdownFromPeakPercent < 0
    && drawdownFromPeakPercent <= -trailingDrawdownPercent) {
    return `${prefix.trailing}（峰值收益${round(peakReturnPercent)}%，${phaseLabel}回撤${round(drawdownFromPeakPercent)}% ≤ -${trailingDrawdownPercent}%）`;
  }
  return null;
}

/**
 * 逐日推进状态机（阶段顺序不可换）：
 * 开盘①已有持仓的硬性退出（止损/回撤止盈，受 `exitJudgementPhase` 控制）
 * → 开盘②成交既有准备清单（释放的现金可参与同日开盘买入）
 * → 收盘更新最高价 + 硬性退出 + 续持类规则（强势续持/最多续持）
 * → 标记市值 → 生成次日准备清单。纯函数，不修改入参。
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

  // 缺省回落 + 夹取只写一次：推进逻辑与「生效参数面板」共用同一个解析器。
  // （D2 的成因正是「页面展示的」与「真正算进去的」各自维护一套缺省值。）
  const resolved = resolvePaperRealisticOptions(realistic);
  const initialCapital = resolved.initialCapital;
  const maxPositions = resolved.maxPositions;
  const commissionRate = resolved.commissionRate;
  const stampDutyRate = resolved.stampDutyRate;
  const transferFeeRate = resolved.transferFeeRate;
  const slippageBps = resolved.slippageBps;
  const lotSize = resolved.lotSize;
  const blockLimitUpBuys = resolved.blockLimitUpBuys;
  const blockLimitDownSells = resolved.blockLimitDownSells;
  const enableOneWordLimitDownProbability = resolved.enableOneWordLimitDownProbability;
  const oneWordLimitDownSellProbability = resolved.oneWordLimitDownSellProbability;
  const positionSizingStrategy = resolved.positionSizingStrategy;
  const fixedPositionPercent = resolved.fixedPositionPercent;
  const trailingProfitActivationPercent = resolved.trailingProfitActivationPercent;
  const trailingDrawdownPercent = resolved.trailingDrawdownPercent;
  const stopLossPercent = resolved.stopLossPercent;
  const strongHoldMinReturn = resolved.strongHoldMinReturn;
  const maxHoldingDays = resolved.maxHoldingDays;
  const minimumExpectedOpenChangePercent = resolved.minimumExpectedOpenChangePercent;
  const expectationTierEnabled = resolved.expectationTierEnabled;
  const expectationTable: OpenExpectationTable = resolved.expectationTable;
  const blockOneWordLimitUpBuys = resolved.blockOneWordLimitUpBuys;
  const enableIntradayStopLoss = resolved.enableIntradayStopLoss;
  const maxPositionAmountRatio = resolved.maxPositionAmountRatio;
  const { exitJudgementPhase, portfolioStopLossPercent } = resolvePaperTradingSettings(input.paperTrading);
  const judgeStopAtOpen = exitJudgementPhase === "open" || exitJudgementPhase === "both";
  const judgeStopAtClose = exitJudgementPhase === "close" || exitJudgementPhase === "both";

  const tradingDateIndex = new Map(tradingDates.map((date, index) => [date, index]));
  const todayIndex = tradingDateIndex.get(today) ?? 0;

  let cash = state.cash;
  let positions: PaperPosition[] = state.positions.map((position) => ({ ...position }));
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

  // ===== 开盘①：先跑已有持仓的退出判定（止损 / 回撤止盈） =====
  // 🔴 顺序不可颠倒，逐条对齐组合回测 `realisticBacktest.ts:352-376`：
  //   1) 退出必须先于买入 —— 开盘止损释放的现金要能参与**同一开盘时点**的候选买入；
  //   2) 退出结算后、买入之前取一次「建仓时账户总权益」—— 当日所有买入共用同一个分母。
  // 2026-09-18 前这里没有这段循环：纸面只有收盘退出，而页面与模块自述都写「开盘触发止损即按开盘出清」
  // ⇒ 声明与实现相反（D1 结构性缺陷）。缺口现在补齐，且判定时点由 `exitJudgementPhase` 决定。
  if (judgeStopAtOpen) {
    const survivors: PaperPosition[] = [];
    for (const position of positions) {
      // 建仓当日不做退出（与收盘段 `todayIndex > entryTradingDateIndex` 同一道闸）。
      if (todayIndex <= position.entryTradingDateIndex) {
        survivors.push(position);
        continue;
      }
      const openPrice = priceByStockDate.get(`${position.stockCode}::${today}`)?.openPrice ?? null;
      if (!validPrice(openPrice)) {
        // 开盘行情缺失：无法判定，顺延到收盘段处理，不臆测成交价。
        survivors.push(position);
        continue;
      }
      const reason = evaluateHardExitRules({
        phaseLabel: "开盘",
        price: openPrice,
        position,
        stopLossPercent,
        trailingProfitActivationPercent,
        trailingDrawdownPercent,
        portfolioStopLossPercent,
        fallbackEquityBase: initialCapital,
      });
      if (reason === null) {
        survivors.push(position);
        continue;
      }
      // 物理约束优先于策略意图：开盘即跌停时报不出货（与回测开盘分支同款守卫），
      // 但**如实写下原因**，不留「今天为什么没动」的黑洞。
      const opensAtLimitDown = isPriceAtLimitDown({
        stockCode: position.stockCode,
        stockName: position.stockName,
        price: openPrice,
        referencePrice: position.previousClosePrice,
        tradeDate: today,
      }) === true;
      if (blockLimitDownSells && opensAtLimitDown) {
        const order = findOrder(position.stockCode, position.entryDate);
        if (order) order.reason = `${reason}；但开盘即跌停，等待收盘确认可成交性`;
        survivors.push(position);
        continue;
      }
      settlePosition(position, today, openPrice, reason);
    }
    positions = survivors;
  }

  // ===== 开盘②：成交既有准备买入清单 =====
  const heldCodes = new Set(positions.map((position) => position.stockCode));
  // 「建仓时账户总权益」：开盘退出已结算、当日买入尚未发生 ⇒ 现金 + 存续持仓按最近可见收盘估值。
  // 与组合回测 `equityAtEntry` 逐字同口径，是组合无条件止损与 pnlToEquityRatio 的共同分母。
  const equityAtEntry = cash + positions.reduce((sum, position) => {
    const valuation = validPrice(position.previousClosePrice) ? position.previousClosePrice : position.entryPrice;
    return sum + valuation * position.shares;
  }, 0);
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
    // 涨跌停判定统一走 boardRules 权威（主板 10% / ST 5% / 创业板·科创板 20% / 北交所 30%），
    // 不再使用 1.099 / 0.901 近似；规则不可判定时视为不能确认触及（null），不做「伪 10%」假设。
    const limitUp = isPriceAtLimitUp({
      stockCode: pending.stockCode,
      stockName: pending.stockName,
      price: openPrice,
      referencePrice: pending.signalClosePrice,
      tradeDate: today,
    }) === true;
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
      // 当日所有买入共用同一分母（回测同款）：组合无条件止损据此判断这笔亏损占组合多少。
      equityAtEntry,
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
    const limitDown = isPriceAtLimitDown({
      stockCode: position.stockCode,
      stockName: position.stockName,
      price: closePrice,
      referencePrice: position.previousClosePrice,
      tradeDate: today,
    }) === true;
    const opensAtLimitDown = isPriceAtLimitDown({
      stockCode: position.stockCode,
      stockName: position.stockName,
      price: marketOpenPrice,
      referencePrice: position.previousClosePrice,
      tradeDate: today,
    }) === true;
    const oneWordLimitDown = limitDown
      && opensAtLimitDown
      && validPrice(marketOpenPrice)
      && validPrice(position.previousClosePrice)
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
    const trailingArmed = peakReturnPercent >= trailingProfitActivationPercent;
    // 硬性退出（单票比例止损 / 组合无条件止损 / 动态回撤止盈）：是否在收盘判定由 exitJudgementPhase 决定。
    let exitTriggerReason: string | null = judgeStopAtClose
      ? evaluateHardExitRules({
        phaseLabel: "收盘",
        price: closePrice,
        position,
        stopLossPercent,
        trailingProfitActivationPercent,
        trailingDrawdownPercent,
        portfolioStopLossPercent,
        fallbackEquityBase: initialCapital,
      })
      : null;
    if (exitTriggerReason === null) {
      // 续持类规则（强势续持 / 最多续持）**永远只在收盘判**：它们本身就是收盘语义，
      // 且判定时点设为「仅开盘」时若把它们也拿掉，持仓将失去收盘退出路径。
      const strongClose = closeReturnPercent >= strongHoldMinReturn
        && (!validPrice(position.previousClosePrice) || closePrice >= position.previousClosePrice);
      if (holdingDays >= maxHoldingDays) {
        exitTriggerReason = `达到最多续持${maxHoldingDays}个交易日`;
      } else if (!trailingArmed && !strongClose) {
        exitTriggerReason = "收盘未满足强势续持条件";
      }
    }
    if (exitTriggerReason === null) {
      position.previousClosePrice = closePrice;
      remainingPositions.push(position);
      continue;
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

/**
 * 推进结果的三态诊断（纯函数、无 IO）。
 *
 * 背景（2026-09-14 实查）：推进集合 = `tradingDates.filter(d => d > lastProcessedDate)`，
 * 而交易日历的**唯一来源**是 `index_daily`（指数日线，项目内没有自动同步任务）。
 * 日历一旦滞后于行情，该集合恒为空 ⇒ 推进变成**静默 no-op**，而调用方（前端 / 盘后调度器）
 * 只看到「成功」。本函数把「已是最新」与「日历落后」显式分开，杜绝「提示成功但结果没动」。
 */
export type PaperTradingAdvanceKind =
  | "advanced"
  | "already-latest"
  | "calendar-stale"
  | "run-not-found"
  | "run-not-active"
  | "database-unavailable";

export type PaperTradingAdvanceDiagnosis = {
  kind: PaperTradingAdvanceKind;
  /** 推进前的最后处理日（未找到运行时为 null）。 */
  lastProcessedDate: string | null;
  /** 本次真正推进过的交易日（升序）。 */
  advancedDates: string[];
  /** 交易日历末端（`index_daily` 在本窗口内的最后一天；无数据时为 null）。 */
  calendarLastDate: string | null;
  /** 已加载行情的末端（候选股日线最后一天）。 */
  marketLastDate: string | null;
  /** 日历是否落后于行情；`kind === "advanced"` 时也可能为 true（只推进了一段）。 */
  calendarStale: boolean;
  /** 人话结论，供 UI / 日志直接展示。 */
  message: string;
};

/** 三态判定（纯函数）：有推进 ⇒ `advanced`；否则再按「日历是否落后」区分空转原因。 */
export function classifyAdvanceKind(input: {
  advancedDates: readonly string[];
  calendarLastDate: string | null;
  marketLastDate: string | null;
}): "advanced" | "already-latest" | "calendar-stale" {
  if (input.advancedDates.length > 0) return "advanced";
  // 日历末端取不到（本窗口内 index_daily 无数据）或落后于行情末端 ⇒ 属环境故障，**不是**「已是最新」。
  if (input.calendarLastDate === null) return "calendar-stale";
  if (input.marketLastDate !== null && input.marketLastDate > input.calendarLastDate) return "calendar-stale";
  return "already-latest";
}

/** 按 kind 生成默认人话文案（纯函数）。 */
function defaultAdvanceMessage(input: {
  kind: PaperTradingAdvanceKind;
  advancedDates: readonly string[];
  lastProcessedDate: string | null;
  calendarLastDate: string | null;
  marketLastDate: string | null;
}): string {
  switch (input.kind) {
    case "advanced": {
      const head = `已推进 ${input.advancedDates.length} 个交易日（${input.advancedDates.join("、")}）`;
      return input.calendarLastDate !== null && input.marketLastDate !== null && input.marketLastDate > input.calendarLastDate
        ? `${head}；但交易日历（指数日线）只到 ${input.calendarLastDate}、行情已到 ${input.marketLastDate}，仍落后 —— 请先同步指数日线`
        : head;
    }
    case "already-latest":
      return input.lastProcessedDate === null
        ? "没有可推进的交易日"
        : `已是最新交易日（${input.lastProcessedDate}），没有新的交易日可推进`;
    case "calendar-stale":
      return input.calendarLastDate === null
        ? "交易日历（指数日线 index_daily）在本窗口内没有数据，无法推进；请先同步指数日线"
        : `交易日历（指数日线）只到 ${input.calendarLastDate}，而行情已到 ${input.marketLastDate ?? "未知"} ⇒ 没有交易日可推进；请先同步指数日线`;
    case "run-not-found":
      return "运行不存在，无法推进";
    case "run-not-active":
      return "运行已暂停或已结束，不能推进（请先恢复为进行中）";
    case "database-unavailable":
      return "数据库不可用，推进未执行";
  }
}

/** 组装诊断（纯函数）；`message` 可覆盖默认文案。 */
export function paperTradingAdvanceDiagnosis(input: {
  kind: PaperTradingAdvanceKind;
  lastProcessedDate?: string | null;
  advancedDates?: readonly string[];
  calendarLastDate?: string | null;
  marketLastDate?: string | null;
  message?: string;
}): PaperTradingAdvanceDiagnosis {
  const advancedDates = [...(input.advancedDates ?? [])];
  const lastProcessedDate = input.lastProcessedDate ?? null;
  const calendarLastDate = input.calendarLastDate ?? null;
  const marketLastDate = input.marketLastDate ?? null;
  return {
    kind: input.kind,
    lastProcessedDate,
    advancedDates,
    calendarLastDate,
    marketLastDate,
    calendarStale: input.kind === "calendar-stale"
      || (calendarLastDate !== null && marketLastDate !== null && marketLastDate > calendarLastDate),
    message: input.message ?? defaultAdvanceMessage({ kind: input.kind, advancedDates, lastProcessedDate, calendarLastDate, marketLastDate }),
  };
}

/**
 * 建运行前置校验失败：最新信号日已**越过交易日历末端** ⇒ 这条运行从创建起就不可能被推进
 * （推进集合按日历取，日历里没有比它更晚的交易日）。宁可在创建时响亮失败，也不留一条永远不动的新运行。
 */
export class PaperTradingCalendarStaleError extends Error {
  readonly code = "PAPER_TRADING_CALENDAR_STALE";

  constructor(
    message: string,
    readonly details: { signalDate: string; calendarLastDate: string | null },
  ) {
    super(message);
    this.name = "PaperTradingCalendarStaleError";
  }
}
