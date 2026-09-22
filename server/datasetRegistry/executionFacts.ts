import { exchangeLimitDownPrice, exchangeLimitUpPrice } from "../data/boardRules";
import type { StStatus } from "./detection";
import { limitUpRatio } from "./detection";

export const LIMIT_RULE_VERSION = "cn-limit-rules-v1";

export interface SuspensionResolution {
  status: "SUSPENDED" | "NOT_SUSPENDED" | "UNKNOWN";
  source: "PIT_STATUS" | "WINDOW" | "NO_BAR" | "UNKNOWN";
}

export interface ExecutionFactBars {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

export interface ExecutionFacts {
  limitUpPrice: number | null;
  limitDownPrice: number | null;
  limitRuleUp: number | null;
  limitRuleDown: number | null;
  limitRuleVersion: string;
  barPresent: boolean;
  suspensionStatus: SuspensionResolution["status"];
  suspensionSource: SuspensionResolution["source"];
  openAtLimitUp: boolean | null;
  closeAtLimitDown: boolean | null;
  oneWordLimitUp: boolean | null;
  oneWordLimitDown: boolean | null;
  canBuyAtOpen: boolean;
  canSellAtClose: boolean;
}

/**
 * 由原始 OHLC、前收、PIT ST、停牌事实推导执行层字段。
 *
 * 缺 bar / 停牌 / 价格规则无法判定时都采用保守口径：不可买、不可卖，
 * 而不是把未知状态当成可成交。
 */
export function deriveExecutionFacts(args: {
  symbol: string;
  tradeDate: string;
  stStatus: StStatus;
  preClose: number | null;
  bars: ExecutionFactBars;
  suspension: SuspensionResolution;
}): ExecutionFacts {
  const ratio = limitUpRatio(args.symbol, args.stStatus, args.tradeDate);
  const { open, high, low, close } = args.bars;
  const barPresent = open !== null && high !== null && low !== null && close !== null;
  const limitUpPrice =
    ratio !== null && args.preClose !== null && args.preClose > 0
      ? exchangeLimitUpPrice(args.preClose, ratio)
      : null;
  const limitDownPrice =
    ratio !== null && args.preClose !== null && args.preClose > 0
      ? exchangeLimitDownPrice(args.preClose, ratio)
      : null;
  const openAtLimitUp =
    barPresent && limitUpPrice !== null && open !== null
      ? open >= limitUpPrice - 1e-9
      : null;
  const closeAtLimitDown =
    barPresent && limitDownPrice !== null && close !== null
      ? close <= limitDownPrice + 1e-9
      : null;
  const oneWordLimitUp =
    barPresent && limitUpPrice !== null
      ? [open, high, low, close].every(
          (value) => value !== null && Math.abs(value - limitUpPrice) <= 1e-9,
        )
      : null;
  const oneWordLimitDown =
    barPresent && limitDownPrice !== null
      ? [open, high, low, close].every(
          (value) => value !== null && Math.abs(value - limitDownPrice) <= 1e-9,
        )
      : null;
  const tradable =
    barPresent &&
    args.suspension.status !== "SUSPENDED";
  return {
    limitUpPrice,
    limitDownPrice,
    limitRuleUp: ratio,
    limitRuleDown: ratio,
    limitRuleVersion: LIMIT_RULE_VERSION,
    barPresent,
    suspensionStatus: args.suspension.status,
    suspensionSource: args.suspension.source,
    openAtLimitUp,
    closeAtLimitDown,
    oneWordLimitUp,
    oneWordLimitDown,
    canBuyAtOpen: tradable && openAtLimitUp !== true,
    canSellAtClose: tradable && closeAtLimitDown !== true,
  };
}
