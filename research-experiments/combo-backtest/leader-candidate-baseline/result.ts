import { z } from "zod";
import type {
  ExperimentCell,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";

export const COMPUTATION_VERSION = "1.0.0";
export const MAX_HOLDING_DAYS = 30;

export interface PortfolioTrade {
  signalDate: string;
  entryDate: string;
  exitDate: string | null;
  stockCode: string;
  score: number;
  boards: number;
  sector: string;
  shares: number;
  entryPrice: number;
  exitPrice: number | null;
  netPnl: number | null;
  netReturn: number | null;
  exitReason: string | null;
}

export interface PortfolioMetric {
  initialCapital: number;
  finalEquity: number;
  netProfit: number;
  totalReturn: number;
  maxDrawdown: number;
  filledCount: number;
  closedCount: number;
  openPositionCount: number;
  winningTrades: number;
  winRate: number | null;
  averageReturn: number | null;
  profitFactor: number | null;
}

export const portfolioTradeSchema = z.object({
  signalDate: z.string().min(1),
  entryDate: z.string().min(1),
  exitDate: z.string().nullable(),
  stockCode: z.string().min(1),
  score: z.number(),
  boards: z.number().int().positive(),
  sector: z.string(),
  shares: z.number().int().nonnegative(),
  entryPrice: z.number(),
  exitPrice: z.number().nullable(),
  netPnl: z.number().nullable(),
  netReturn: z.number().nullable(),
  exitReason: z.string().nullable(),
});

export const leaderCandidateBaselineSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  rule: z.object({
    entry: z.literal("T+1_OPEN"),
    exit: z.literal("RISK_MANAGED_HOLD"),
    maxPositions: z.literal(5),
    maxHoldingDays: z.literal(MAX_HOLDING_DAYS),
  }),
  source: z.object({
    sourceBacktest: z.literal("leader-candidate-baseline"),
    sourceSignals: z.number().int().nonnegative(),
    sourceKnownSignals: z.number().int().nonnegative(),
    missingSourceSignals: z.number().int().nonnegative(),
  }),
  portfolio: z.object({
    initialCapital: z.number(),
    finalEquity: z.number(),
    netProfit: z.number(),
    totalReturn: z.number(),
    maxDrawdown: z.number(),
    filledCount: z.number().int().nonnegative(),
    closedCount: z.number().int().nonnegative(),
    openPositionCount: z.number().int().nonnegative(),
    winningTrades: z.number().int().nonnegative(),
    winRate: z.number().nullable(),
    averageReturn: z.number().nullable(),
    profitFactor: z.number().nullable(),
  }),
  notes: z.array(z.string()),
});

export type LeaderCandidateBaselinePayload = z.infer<
  typeof leaderCandidateBaselineSchema
>;

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function roundNullable(value: number | null, digits = 2): number | null {
  return value === null ? null : round(value, digits);
}

function tradeRow(trade: PortfolioTrade): Record<string, ExperimentCell> {
  return {
    signalDate: trade.signalDate,
    entryDate: trade.entryDate,
    exitDate: trade.exitDate,
    stockCode: trade.stockCode,
    score: trade.score,
    boards: trade.boards,
    sector: trade.sector,
    shares: trade.shares,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    netPnl: roundNullable(trade.netPnl),
    netReturn: roundNullable(trade.netReturn),
    exitReason: trade.exitReason,
  };
}

export function assembleLeaderCandidateBaselineResult(args: {
  totalSignals: number;
  sourceKnownSignals: number;
  missingSourceSignals: number;
  metric: PortfolioMetric;
  trades: readonly PortfolioTrade[];
  equityCurve: ReadonlyArray<{ date: string; equity: number }>;
  excludedByReason: Record<string, number>;
  candidateCount: number;
  eligibleCount: number;
}): ExperimentResultPayload {
  const customPayload: LeaderCandidateBaselinePayload = {
    computationVersion: COMPUTATION_VERSION,
    rule: {
      entry: "T+1_OPEN",
      exit: "RISK_MANAGED_HOLD",
      maxPositions: 5,
      maxHoldingDays: MAX_HOLDING_DAYS,
    },
    source: {
      sourceBacktest: "leader-candidate-baseline",
      sourceSignals: args.totalSignals,
      sourceKnownSignals: args.sourceKnownSignals,
      missingSourceSignals: args.missingSourceSignals,
    },
    portfolio: {
      initialCapital: args.metric.initialCapital,
      finalEquity: args.metric.finalEquity,
      netProfit: args.metric.netProfit,
      totalReturn: args.metric.totalReturn,
      maxDrawdown: args.metric.maxDrawdown,
      filledCount: args.metric.filledCount,
      closedCount: args.metric.closedCount,
      openPositionCount: args.metric.openPositionCount,
      winningTrades: args.metric.winningTrades,
      winRate: args.metric.winRate,
      averageReturn: args.metric.averageReturn,
      profitFactor: args.metric.profitFactor,
    },
    notes: [
      "只读取 Dataset 中已冻结的客观行情与来源事实，不直接访问 limit_up_records / stock_daily_prices。",
      "候选评分、组合资金分配和动态止盈 / 止损 / 强势续持退出均在 Experiment 层重建。",
      "该实验来源于原 /backtest 的 leader-candidate-baseline 主模式，不包含五策略研究面板。",
    ],
  };

  const metricRows: Array<Record<string, ExperimentCell>> = [
    { label: "初始资金", value: args.metric.initialCapital, unit: "元" },
    { label: "期末权益", value: args.metric.finalEquity, unit: "元" },
    { label: "累计收益", value: args.metric.totalReturn, unit: "%" },
    { label: "最大回撤", value: args.metric.maxDrawdown, unit: "%" },
    { label: "实际成交", value: args.metric.filledCount, unit: "笔" },
    { label: "已平仓", value: args.metric.closedCount, unit: "笔" },
    { label: "期末持仓", value: args.metric.openPositionCount, unit: "笔" },
    { label: "已平仓胜率", value: args.metric.winRate, unit: "%" },
    { label: "盈亏比", value: args.metric.profitFactor, unit: null },
  ];

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      excludedCount: args.candidateCount - args.eligibleCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 主板、来源记录存在且具备 T+1 开盘行情的事件。",
        "资金不足、满仓和不可买入属于执行结果，不计入样本剔除。",
      ],
    },
    statistics: [
      {
        code: "portfolio_total_return",
        label: "组合累计收益",
        value: args.metric.totalReturn,
        unit: "%",
        digits: 2,
      },
      {
        code: "portfolio_max_drawdown",
        label: "最大回撤",
        value: args.metric.maxDrawdown,
        unit: "%",
        digits: 2,
      },
      {
        code: "portfolio_trade_count",
        label: "实际成交",
        value: args.metric.filledCount,
        unit: "笔",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "portfolio_metrics",
        title: "组合资金回测",
        description:
          "初始资金 100000 元，最多 5 个持仓，等权分仓。",
        columns: [
          { key: "label", label: "指标", align: "LEFT" },
          { key: "value", label: "数值", align: "RIGHT" },
          { key: "unit", label: "单位", align: "LEFT" },
        ],
        rows: metricRows,
      },
      {
        key: "portfolio_trades",
        title: "模拟订单",
        description:
          "T+1 开盘买入；持仓不再进入当日候选池后，于下一可卖开盘退出。",
        columns: [
          { key: "signalDate", label: "信号日", align: "LEFT" },
          { key: "entryDate", label: "入场日", align: "LEFT" },
          { key: "exitDate", label: "退出日", align: "LEFT" },
          { key: "stockCode", label: "股票", align: "LEFT" },
          { key: "score", label: "评分", align: "RIGHT" },
          { key: "boards", label: "板数", align: "RIGHT" },
          { key: "sector", label: "题材", align: "LEFT" },
          { key: "shares", label: "股数", align: "RIGHT" },
          { key: "entryPrice", label: "买入价", align: "RIGHT" },
          { key: "exitPrice", label: "卖出价", align: "RIGHT" },
          { key: "netPnl", label: "净盈亏", unit: "元", align: "RIGHT" },
          { key: "netReturn", label: "收益率", unit: "%", align: "RIGHT" },
          { key: "exitReason", label: "退出原因", align: "LEFT" },
        ],
        rows: args.trades.map(tradeRow),
      },
    ],
    charts: [
      {
        key: "portfolio_equity",
        title: "组合权益曲线",
        description: "按交易日收盘市值估值，包含期末未平仓持仓。",
        kind: "LINE",
        xLabel: "日期",
        yLabel: "权益",
        unit: "元",
        series: [
          {
            key: "equity",
            label: "组合权益",
            points: args.equityCurve.map(point => ({
              x: point.date,
              y: point.equity,
            })),
          },
        ],
      },
    ],
    customPayload,
  };
}
