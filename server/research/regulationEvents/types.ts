/**
 * PATTERN-DISCOVERY-REGULATION-001 — 公开监管/异常交易事件研究的共享类型。
 *
 * 本模块只做事件研究与规则计算，不进入 Strategy/Candidate/Parameter Search。
 * 所有事件都必须保留公告源、公告日和 PIT 可用交易日；禁止用价格异动反推监管事件。
 */

export type RegulationExchange = "SSE" | "SZSE";

export type RegulationEventType =
  | "abnormal_volatility"
  | "severe_abnormal_volatility"
  | "risk_warning"
  | "regulatory_inquiry_or_letter"
  | "verification_after_abnormal"
  | "resumption";

export interface DailyBar {
  tradeDate: string;
  close: number;
  previousClose: number;
  high: number;
  low: number;
  amount?: number | null;
  turnoverRate?: number | null;
}

export interface IndexDailyBar {
  tradeDate: string;
  close: number;
}

export interface SuspensionWindow {
  startDate: string;
  endDate: string;
}

export interface ExchangeRuleVersion {
  id: string;
  exchange: RegulationExchange;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceTitle: string;
  sourceUrl: string;
  sourceVerification: "OFFICIAL_CURRENT" | "ARCHIVE_PENDING";
  mainBoardAbnormalPriceDeviationPct: number;
  mainBoardAbnormalTurnoverRatio: number;
  mainBoardAbnormalCumulativeTurnoverPct: number;
  severeAbnormalOccurrenceCount10d: number;
  severeAbnormalPriceDeviation10dUpPct: number;
  severeAbnormalPriceDeviation10dDownPct: number;
  severeAbnormalPriceDeviation30dUpPct: number;
  severeAbnormalPriceDeviation30dDownPct: number;
  resetRuleText: string;
}

export interface CninfoAnnouncement {
  announcementId: string;
  stockCode: string;
  stockName: string;
  title: string;
  announcementDate: string;
  announcementTime: number;
  announcementType: string | null;
  columnId: string | null;
  pageColumn: string | null;
  pdfUrl: string | null;
  source: "cninfo";
  sourceTimestamp: string;
}

export interface RegulationEvent extends CninfoAnnouncement {
  exchange: RegulationExchange;
  ruleVersionId: string;
  eventTypes: RegulationEventType[];
  primaryEventType: RegulationEventType;
  announcementTradingDate: string | null;
  resetDate: string | null;
  resetDueToResumption: boolean;
  pitNote: string;
}

export interface EventWindowMetrics {
  horizon: number;
  anchorDate: string;
  targetDate: string | null;
  observed: boolean;
  returnPct: number | null;
  mfePct: number | null;
  maePct: number | null;
  close: number | null;
  high: number | null;
  low: number | null;
  amount: number | null;
  turnoverRate: number | null;
  limitUpCount: number | null;
  newHigh: boolean | null;
  reLimitUp: boolean | null;
  maxDrawdownPct: number | null;
}