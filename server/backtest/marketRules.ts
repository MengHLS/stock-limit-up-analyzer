/**
 * STEP 8 — Market Rule / Execution Rule（A 股规则注入层）。
 *
 * 引擎不得把未来规则硬编码进核心循环；A 股规则（T+1、涨跌停、一手股数、停牌、
 * 现金约束、成交量约束、手续费、印花税、滑点）统一经规则对象注入。
 * 接口定义在 types.ts（领域契约），本文件提供 A 股默认实现与解析辅助。
 */

import { isStStock, resolveLimitRulesAt } from "../data/boardRules";
import type { ExecutionRuleContext, ExecutionRuleSet, MarketRuleSet, PriceLimit, Security } from "./types";

/** 默认 A 股市场规则：T+1，一手 100 股，主板 ±10% / 创业板·科创板 ±20% / 北交所 ±30%。 */
export const DEFAULT_MARKET_RULES: MarketRuleSet = {
  tPlus1: true,
  lotSize: 100,
  resolvePriceLimit(security: Security, tradeDate = "9999-12-31"): PriceLimit | null {
    const stStatus =
      security.stStatus ??
      (isStStock(security.name) ? "ST" : "NORMAL");
    const rules = resolveLimitRulesAt(security.securityId, tradeDate, stStatus);
    return rules.supported
      ? {
          limitUpRatio: rules.limitUpRatio!,
          limitDownRatio: rules.limitDownRatio!,
        }
      : null;
  },
};

/** 默认执行规则：不拦截涨跌停（与既有生产 NextOpenExecutionModel 默认一致）。 */
export const DEFAULT_EXECUTION_RULES: ExecutionRuleSet = {
  blockLimitUpBuy: false,
  blockLimitDownSell: false,
};

/** 按标的板块把市场/执行规则解析为执行模型可消费的上下文。 */
export function resolveExecutionRuleContext(
  security: Security,
  marketRules: MarketRuleSet,
  executionRules: ExecutionRuleSet,
  tradeDate?: string,
): ExecutionRuleContext {
  const limit = marketRules.resolvePriceLimit(security, tradeDate) ?? {
    limitUpRatio: 0,
    limitDownRatio: 0,
  };
  return {
    limitUpRatio: limit.limitUpRatio,
    limitDownRatio: limit.limitDownRatio,
    blockLimitUpBuy: executionRules.blockLimitUpBuy,
    blockLimitDownSell: executionRules.blockLimitDownSell,
  };
}
