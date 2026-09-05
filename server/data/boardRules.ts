/**
 * STEP 5 — 涨停规则唯一权威来源（Limit-Up Rule Authority）。
 *
 * 目标：消除「9.9% / 9.95% / 10%」多处近似自实现。本模块是全系统「涨跌停比例」的
 * 单一事实来源；任何需要判断涨跌停的新代码（Feature / Adapter / 校验）必须经由此处。
 *
 * 价格计算复用 Backtest Core 已验收的纯函数 limitUpPrice / limitDownPrice
 * （server/engine/execution.ts），不在本层重复实现「prevClose × (1+ratio)」。
 *
 * 既有实现说明（不回改，仅记录）：
 *   - engine/execution.NextOpenExecutionModel 允许调用方注入 LimitRules（默认 10%）；
 *     真实板块比例应调用 resolveLimitRules 后注入。
 *   - legacy realisticBacktest 使用近似 1.099 / 0.901（±9.9%）且仅回测主板候选，
 *     其行为已被既有测试锁定；本模块是「新代码」的权威口径。
 */

import { limitDownPrice, limitUpPrice } from "../engine/execution";
import type { CanonicalMarketBar } from "./types";

// 价格计算（涨停价/跌停价）的唯一实现来自 Backtest Core，统一在此 re-export，
// 避免其它模块绕过本层重复实现或直接引用 engine 细节。
export { limitUpPrice, limitDownPrice }; // eslint-disable-line no-re-export

/** 板块类别。 */
export type BoardCategory = "main" | "chinext" | "star" | "bse" | "unknown";

/** 涨跌停比例解析结果。supported=false 表示当前信息不足以判定（UNKNOWN/UNSUPPORTED），不得假装支持。 */
export interface LimitRulesResolution {
  /** 板块类别。 */
  board: BoardCategory;
  /** 是否支持判定。unknown 板块 / 无法归类的代码为 false。 */
  supported: boolean;
  /** 涨停比例（如 0.1 = +10%）；supported=false 时为 null。 */
  limitUpRatio: number | null;
  /** 跌停比例（如 0.1 = -10%）；supported=false 时为 null。 */
  limitDownRatio: number | null;
}

/** 从带后缀代码提取纯数字部分（如 "002361.SZ" → "002361"；无后缀则原样返回数字前缀）。 */
export function numericCode(symbol: string): string {
  const match = symbol.match(/^(\d+)/);
  return match ? match[1]! : "";
}

/** 纯按代码前缀归类板块（不含 ST 判断）。 */
export function classifyBoard(symbol: string): BoardCategory {
  const code = numericCode(symbol);
  if (code.length === 0) return "unknown";
  if (/^(300|301)/.test(code)) return "chinext";
  if (/^(688|689)/.test(code)) return "star";
  if (/^(920|43|83|87|88|4|8)/.test(code)) return "bse";
  if (/^(60|000|001|002|003)/.test(code)) return "main";
  return "unknown";
}

/**
 * 股票名称是否属于风险警示（ST/*ST/退市整理）。
 *
 * 严格规则（避免 `/ST|退/` 子串误判普通名称）：
 *   1. 名称前缀为 `ST` 或 `*ST`（A 股风险警示实际格式：ST 后跟中文简称），
 *      且 `ST` 前缀后必须是中文/空（排除 STORE/STAR 这类 ASCII 名称）；
 *   2. 名称含明确退市关键词「退市」（退市整理期/已退市）。
 * 名称缺失时无法判定 → false（交给主板默认比例处理）。
 */
export function isStStock(stockName: string | null | undefined): boolean {
  if (!stockName) return false;
  const name = stockName.trim().toUpperCase();
  if (name.includes("退市")) return true;
  const stPrefix = name.match(/^(\*?ST)(.*)$/);
  if (stPrefix) {
    const rest = stPrefix[2]!.trim();
    if (rest.length === 0) return true; // 纯 "ST"/"*ST"
    // ST 后跟中文（A 股风险警示名称格式），排除 STORE/STAR 等 ASCII 名称
    return !/^[\x00-\x7F]/.test(rest);
  }
  return false;
}

/**
 * 解析一只股票的涨跌停比例。
 * - 主板（60/000/001/002/003）：非 ST 10%，ST/退 5%
 * - 创业板 300/301、科创板 688/689：20%
 * - 北交所：30%
 * - 无法识别代码或名称不足：supported=false（UNKNOWN），返回 null，不得假装支持。
 */
export function resolveLimitRules(stockCode: string, stockName?: string | null): LimitRulesResolution {
  const board = classifyBoard(stockCode);
  switch (board) {
    case "main": {
      const ratio = isStStock(stockName) ? 0.05 : 0.1;
      return { board, supported: true, limitUpRatio: ratio, limitDownRatio: ratio };
    }
    case "chinext":
    case "star":
      return { board, supported: true, limitUpRatio: 0.2, limitDownRatio: 0.2 };
    case "bse":
      return { board, supported: true, limitUpRatio: 0.3, limitDownRatio: 0.3 };
    default:
      return { board, supported: false, limitUpRatio: null, limitDownRatio: null };
  }
}

/**
 * 判断一个 canonical bar 的 close 是否触及涨停价 / 跌停价。
 * 规则：涨停价 = 前收 × (1+ratio)，跌停价 = 前收 × (1−ratio)；close 达到即视为触及。
 * 若板块/规则不可判定，或缺少 preClose / close，返回 null（UNKNOWN），不得假装支持。
 */
export function isLimitUpBar(bar: CanonicalMarketBar, stockName?: string | null): boolean | null {
  const rules = resolveLimitRules(bar.symbol, stockName);
  if (!rules.supported || rules.limitUpRatio === null) return null;
  if (bar.close === null || bar.preClose === null || bar.preClose <= 0) return null;
  return bar.close >= limitUpPrice(bar.preClose, rules.limitUpRatio);
}

/** 判断 bar 的 close 是否触及跌停价。语义同 isLimitUpBar。 */
export function isLimitDownBar(bar: CanonicalMarketBar, stockName?: string | null): boolean | null {
  const rules = resolveLimitRules(bar.symbol, stockName);
  if (!rules.supported || rules.limitDownRatio === null) return null;
  if (bar.close === null || bar.preClose === null || bar.preClose <= 0) return null;
  return bar.close <= limitDownPrice(bar.preClose, rules.limitDownRatio);
}

/** 触及判定入参（供回测/模拟盘等按“价格 vs 前收参考价”直接判断）。 */
export interface PriceLimitCheck {
  stockCode: string;
  stockName?: string | null;
  /** 待判定价格（开盘价/收盘价等）。 */
  price: number | null | undefined;
  /** 前收参考价（涨停/跌停的基准价）。 */
  referencePrice: number | null | undefined;
}

/**
 * 判断给定价格是否触及涨停价（price >= 涨停价）。
 * 板块规则不可判定 / 任一价格缺失或非正 → null（UNKNOWN），调用方不得把它当成 10% 或当成命中。
 */
export function isPriceAtLimitUp(check: PriceLimitCheck): boolean | null {
  const rules = resolveLimitRules(check.stockCode, check.stockName);
  if (!rules.supported || rules.limitUpRatio === null) return null;
  const { price, referencePrice } = check;
  if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) return null;
  if (referencePrice === null || referencePrice === undefined || !Number.isFinite(referencePrice) || referencePrice <= 0) return null;
  return price >= limitUpPrice(referencePrice, rules.limitUpRatio);
}

/** 判断给定价格是否触及跌停价（price <= 跌停价）。规则不可判定 → null。 */
export function isPriceAtLimitDown(check: PriceLimitCheck): boolean | null {
  const rules = resolveLimitRules(check.stockCode, check.stockName);
  if (!rules.supported || rules.limitDownRatio === null) return null;
  const { price, referencePrice } = check;
  if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) return null;
  if (referencePrice === null || referencePrice === undefined || !Number.isFinite(referencePrice) || referencePrice <= 0) return null;
  return price <= limitDownPrice(referencePrice, rules.limitDownRatio);
}
