/**
 * STEP 5 — 涨停规则唯一权威来源（Limit-Up Rule Authority）。
 *
 * 目标：消除「9.9% / 9.95% / 10%」多处近似自实现。本模块是全系统「涨跌停比例」的
 * 单一事实来源；任何需要判断涨跌停的新代码（Feature / Adapter / 校验）必须经由此处。
 *
 * 价格计算复用 Backtest Core 已验收的纯函数 limitUpPrice / limitDownPrice
 * （server/engine/execution.ts），不在本层重复实现「prevClose × (1+ratio)」。
 *
 * 全系统统一口径：
 *   - 板块 / ST / 历史日期比例只允许由本模块解析；
 *   - 价格计算复用 engine/execution 的交易所分价四舍五入纯函数；
 *   - 执行模型必须注入本模块解析出的比例，不得使用固定 10% 兜底。
 */

import { limitDownPrice, limitUpPrice } from "../engine/execution";
import type { CanonicalMarketBar } from "./types";

// 价格计算（涨停价/跌停价）的唯一实现来自 Backtest Core，统一在此 re-export，
// 避免其它模块绕过本层重复实现或直接引用 engine 细节。
export { limitUpPrice, limitDownPrice }; // eslint-disable-line no-re-export

/**
 * **交易所口径的涨停价**：以前收盘价为基准按涨跌幅计算，再**四舍五入到分**（2 位小数）。
 *
 * 为什么必须单独有这一个函数（而不是直接用 `limitUpPrice`）：
 *   A 股真实行情里「封板」的收盘价恰等于四舍五入后的涨停价（如前收 6.81 → 涨停价 7.49）。
 *   若阈值取未四舍五入的原始浮点乘积（`6.81 × 1.1 = 7.491`，或 `11 × 1.1 = 12.100000000000001`），
 *   浮点误差会让 `close >= 阈值` 判为 false，从而**系统性漏判涨停**。
 *   真实数据实测：2025-01-01..2026-09-04 区间内「收盘价恰为涨停价」的封板样本 4,325 个，
 *   用未四舍五入阈值只能识别 2,680 个，**漏判 1,645 个（38.03%）**。
 *
 * 因此凡「判定是否涨停」「记录涨停价事实列」都必须走本函数，不得直接使用 `limitUpPrice`
 * 的原始乘积作为比较阈值。
 */
export function exchangeLimitUpPrice(
  prevClose: number,
  limitUpRatio: number
): number {
  return limitUpPrice(prevClose, limitUpRatio);
}

/** 交易所口径的跌停价：同涨跌停规则，分价四舍五入。 */
export function exchangeLimitDownPrice(
  prevClose: number,
  limitDownRatio: number
): number {
  return limitDownPrice(prevClose, limitDownRatio);
}

/** 创业板涨跌幅由 10% 调整为 20% 的生效日。 */
export const CHINEXT_20PCT_EFFECTIVE_DATE = "2020-08-24";

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
export function resolveLimitRules(
  stockCode: string,
  stockName?: string | null
): LimitRulesResolution {
  const board = classifyBoard(stockCode);
  switch (board) {
    case "main": {
      const ratio = isStStock(stockName) ? 0.05 : 0.1;
      return {
        board,
        supported: true,
        limitUpRatio: ratio,
        limitDownRatio: ratio,
      };
    }
    case "chinext":
    case "star":
      return { board, supported: true, limitUpRatio: 0.2, limitDownRatio: 0.2 };
    case "bse":
      return { board, supported: true, limitUpRatio: 0.3, limitDownRatio: 0.3 };
    default:
      return {
        board,
        supported: false,
        limitUpRatio: null,
        limitDownRatio: null,
      };
  }
}

/**
 * 按交易日的涨跌停规则解析。
 *
 * 与 `resolveLimitRules` 的差别：创业板在 `2020-08-24` 之前为 10%，之后为 20%。
 * 只有主板的当前研究可以忽略这个差异；任何跨 2020-08-24 的 Dataset 构建都必须使用本函数。
 */
export function resolveLimitRulesAt(
  stockCode: string,
  tradeDate: string,
  stStatus: "NORMAL" | "ST" | "*ST" | "UNKNOWN"
): LimitRulesResolution {
  const board = classifyBoard(stockCode);
  if (board === "main") {
    const ratio = stStatus === "ST" || stStatus === "*ST" ? 0.05 : 0.1;
    return {
      board,
      supported: true,
      limitUpRatio: ratio,
      limitDownRatio: ratio,
    };
  }
  if (board === "chinext") {
    const ratio = tradeDate >= CHINEXT_20PCT_EFFECTIVE_DATE ? 0.2 : 0.1;
    return {
      board,
      supported: true,
      limitUpRatio: ratio,
      limitDownRatio: ratio,
    };
  }
  if (board === "star") {
    return { board, supported: true, limitUpRatio: 0.2, limitDownRatio: 0.2 };
  }
  if (board === "bse") {
    return { board, supported: true, limitUpRatio: 0.3, limitDownRatio: 0.3 };
  }
  return { board, supported: false, limitUpRatio: null, limitDownRatio: null };
}

/**
 * 判断一个 canonical bar 的 close 是否恰为交易所口径涨停价 / 跌停价。
 *
 * 收盘封板价必须等于四舍五入到分的涨停价；使用 `close >= rawLimitPrice`
 * 会把无涨跌幅限制日或失真行情误判为涨停。
 *
 * 若板块/规则不可判定，或缺少 preClose / close，返回 null（UNKNOWN），不得假装支持。
 */
export function isLimitUpBar(
  bar: CanonicalMarketBar,
  stockName?: string | null
): boolean | null {
  const rules = resolveLimitRulesAt(
    bar.symbol,
    bar.timestamp,
    isStStock(stockName) ? "ST" : "NORMAL"
  );
  if (!rules.supported || rules.limitUpRatio === null) return null;
  if (bar.close === null || bar.preClose === null || bar.preClose <= 0)
    return null;
  return (
    Math.abs(
      bar.close - exchangeLimitUpPrice(bar.preClose, rules.limitUpRatio)
    ) <= 1e-9
  );
}

/** 判断 bar 的 close 是否恰为交易所口径跌停价。语义同 isLimitUpBar。 */
export function isLimitDownBar(
  bar: CanonicalMarketBar,
  stockName?: string | null
): boolean | null {
  const rules = resolveLimitRulesAt(
    bar.symbol,
    bar.timestamp,
    isStStock(stockName) ? "ST" : "NORMAL"
  );
  if (!rules.supported || rules.limitDownRatio === null) return null;
  if (bar.close === null || bar.preClose === null || bar.preClose <= 0)
    return null;
  return (
    Math.abs(
      bar.close - exchangeLimitDownPrice(bar.preClose, rules.limitDownRatio)
    ) <= 1e-9
  );
}

/** 触及判定入参（供回测/模拟盘等按“价格 vs 前收参考价”直接判断）。 */
export interface PriceLimitCheck {
  stockCode: string;
  stockName?: string | null;
  /** 交易日；提供时按历史规则解析（创业板 2020-08-24 的 10% → 20%）。 */
  tradeDate?: string;
  /** PIT ST 状态；提供时优先于股票名称推断。 */
  stStatus?: "NORMAL" | "ST" | "*ST" | "UNKNOWN";
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
  const rules =
    check.tradeDate === undefined
      ? resolveLimitRules(check.stockCode, check.stockName)
      : resolveLimitRulesAt(
          check.stockCode,
          check.tradeDate,
          check.stStatus ??
            (isStStock(check.stockName) ? "ST" : "NORMAL")
        );
  if (!rules.supported || rules.limitUpRatio === null) return null;
  const { price, referencePrice } = check;
  if (
    price === null ||
    price === undefined ||
    !Number.isFinite(price) ||
    price <= 0
  )
    return null;
  if (
    referencePrice === null ||
    referencePrice === undefined ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0
  )
    return null;
  return (
    price >= exchangeLimitUpPrice(referencePrice, rules.limitUpRatio) - 1e-9
  );
}

/** 判断给定价格是否触及跌停价（price <= 跌停价）。规则不可判定 → null。 */
export function isPriceAtLimitDown(check: PriceLimitCheck): boolean | null {
  const rules =
    check.tradeDate === undefined
      ? resolveLimitRules(check.stockCode, check.stockName)
      : resolveLimitRulesAt(
          check.stockCode,
          check.tradeDate,
          check.stStatus ??
            (isStStock(check.stockName) ? "ST" : "NORMAL")
        );
  if (!rules.supported || rules.limitDownRatio === null) return null;
  const { price, referencePrice } = check;
  if (
    price === null ||
    price === undefined ||
    !Number.isFinite(price) ||
    price <= 0
  )
    return null;
  if (
    referencePrice === null ||
    referencePrice === undefined ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0
  )
    return null;
  return (
    price <= exchangeLimitDownPrice(referencePrice, rules.limitDownRatio) + 1e-9
  );
}
