/**
 * STEP 5 — Data 层测试：Canonical Bar / Adapter / Validation / BoardRules。
 */

import { describe, expect, it } from "vitest";
import {
  classifyBoard,
  isLimitDownBar,
  isLimitUpBar,
  isPriceAtLimitDown,
  isPriceAtLimitUp,
  isStStock,
  limitUpPrice,
  resolveLimitRules,
  toCanonicalBar,
  toEngineMarketBar,
  validateMarketBar,
  type CanonicalMarketBar,
} from "./index";

function bar(overrides: Partial<CanonicalMarketBar> = {}): CanonicalMarketBar {
  return {
    symbol: "600001.SH",
    timestamp: "2026-01-05",
    open: 10,
    high: 10.5,
    low: 9.9,
    close: 10.4,
    preClose: 10,
    volume: 12_000,
    amount: 15_000,
    turnoverRate: null,
    adjustment: "raw",
    ...overrides,
  };
}

describe("BoardRules — 板块与涨跌停规则权威", () => {
  it("主板 60/000/001/002/003 → 10%", () => {
    for (const code of ["600001.SH", "000001.SZ", "002361.SZ"]) {
      const rules = resolveLimitRules(code);
      expect(rules.supported).toBe(true);
      expect(rules.limitUpRatio).toBe(0.1);
      expect(rules.limitDownRatio).toBe(0.1);
    }
  });

  it("创业板 300/301 与科创板 688/689 → 20%", () => {
    expect(resolveLimitRules("300750.SZ").limitUpRatio).toBe(0.2);
    expect(resolveLimitRules("301269.SZ").limitUpRatio).toBe(0.2);
    expect(resolveLimitRules("688981.SH").limitUpRatio).toBe(0.2);
  });

  it("北交所 920 → 30%", () => {
    expect(resolveLimitRules("920xxx.BJ").limitUpRatio).toBe(0.3);
    expect(resolveLimitRules("830799.BJ").limitUpRatio).toBe(0.3);
  });

  it("主板 ST 名称 → 5%；缺名称按非 ST 10%", () => {
    expect(resolveLimitRules("600001.SH", "*ST 示例").limitUpRatio).toBe(0.05);
    expect(resolveLimitRules("600001.SH", "ST示例").limitUpRatio).toBe(0.05);
    expect(resolveLimitRules("600001.SH", null).limitUpRatio).toBe(0.1);
  });

  it("isStStock 严格规则：ST/*ST 前缀与退市关键词命中，普通含 ST/退 子串不误判", () => {
    // 命中：ST 前缀、*ST 前缀、退市关键词
    expect(isStStock("ST中安")).toBe(true);
    expect(isStStock("ST 舍得")).toBe(true);
    expect(isStStock("*ST金洲")).toBe(true);
    expect(isStStock("*ST 新海")).toBe(true);
    expect(isStStock("退市海润")).toBe(true);
    expect(isStStock("XX退市整理")).toBe(true);
    expect(isStStock("ST")).toBe(true);
    // 不命中：含 ST / 退 子串但不是风险警示格式（如 ASCII 名称、中文普通名称）
    expect(isStStock("STORE 股份")).toBe(false);
    expect(isStStock("MYSTOCK")).toBe(false);
    expect(isStStock("南钢股份")).toBe(false);
    expect(isStStock("测试股票")).toBe(false);
    expect(isStStock("华谊兄弟")).toBe(false);
    expect(isStStock(null)).toBe(false);
    expect(isStStock(undefined)).toBe(false);
    expect(isStStock("")).toBe(false);
  });

  it("resolveLimitRules 使用严格 isStStock：STORE 类名称按主板 10% 处理", () => {
    expect(resolveLimitRules("600001.SH", "STORE 股份").limitUpRatio).toBe(0.1);
    expect(resolveLimitRules("600001.SH", "ST中安").limitUpRatio).toBe(0.05);
    expect(resolveLimitRules("600001.SH", "*ST金洲").limitUpRatio).toBe(0.05);
    expect(resolveLimitRules("600001.SH", "退市海润").limitUpRatio).toBe(0.05);
  });

  it("无法识别 → UNSUPPORTED（null），不假装支持", () => {
    const rules = resolveLimitRules("ABC");
    expect(rules.supported).toBe(false);
    expect(rules.limitUpRatio).toBeNull();
    expect(rules.limitDownRatio).toBeNull();
  });

  it("isLimitUpBar / isLimitDownBar：close 达到涨跌停价即判定，无法判定返回 null", () => {
    const upBar = bar({ close: limitUpPrice(10, 0.1) }); // 11
    expect(isLimitUpBar(upBar)).toBe(true);
    expect(isLimitDownBar(upBar)).toBe(false);
    const downBar = bar({ close: 9 }); // < 跌停 9
    expect(isLimitDownBar(downBar)).toBe(true);
    expect(isLimitUpBar(bar({ close: null }))).toBeNull();
    expect(isLimitUpBar(bar({ symbol: "ABC", close: 11 }))).toBeNull();
  });

  it("classifyBoard 基本归类", () => {
    expect(classifyBoard("600001.SH")).toBe("main");
    expect(classifyBoard("300750.SZ")).toBe("chinext");
    expect(classifyBoard("688981.SH")).toBe("star");
    expect(classifyBoard("920001.BJ")).toBe("bse");
    expect(classifyBoard("")).toBe("unknown");
  });

  it("isPriceAtLimitUp/Down：按板块权威阈值而非 9.9% 近似判定", () => {
    // 主板非 ST：10% 涨停价 = 11.00；10.99（+9.9%）不是涨停
    expect(isPriceAtLimitUp({ stockCode: "600001.SH", price: 10.99, referencePrice: 10 })).toBe(false);
    expect(isPriceAtLimitUp({ stockCode: "600001.SH", price: 11, referencePrice: 10 })).toBe(true);
    expect(isPriceAtLimitDown({ stockCode: "600001.SH", price: 9.01, referencePrice: 10 })).toBe(false);
    expect(isPriceAtLimitDown({ stockCode: "600001.SH", price: 9, referencePrice: 10 })).toBe(true);
    // 主板 ST：5%（涨停价 10.50）
    expect(isPriceAtLimitUp({ stockCode: "600001.SH", stockName: "*ST示例", price: 10.5, referencePrice: 10 })).toBe(true);
    expect(isPriceAtLimitUp({ stockCode: "600001.SH", stockName: "*ST示例", price: 10.49, referencePrice: 10 })).toBe(false);
    // 创业板 / 科创板：20%
    expect(isPriceAtLimitUp({ stockCode: "300001.SZ", price: 11.5, referencePrice: 10 })).toBe(false);
    expect(isPriceAtLimitUp({ stockCode: "300001.SZ", price: 12, referencePrice: 10 })).toBe(true);
    expect(isPriceAtLimitUp({ stockCode: "688001.SH", price: 11.99, referencePrice: 10 })).toBe(false);
    expect(isPriceAtLimitUp({ stockCode: "688001.SH", price: 12, referencePrice: 10 })).toBe(true);
    // 北交所：30%
    expect(isPriceAtLimitUp({ stockCode: "920001.BJ", price: 12.99, referencePrice: 10 })).toBe(false);
    expect(isPriceAtLimitUp({ stockCode: "920001.BJ", price: 13, referencePrice: 10 })).toBe(true);
    expect(isPriceAtLimitDown({ stockCode: "920001.BJ", price: 7.01, referencePrice: 10 })).toBe(false);
    expect(isPriceAtLimitDown({ stockCode: "920001.BJ", price: 7, referencePrice: 10 })).toBe(true);
    // 规则/价格不可判定 → null（不得当命中或当 10%）
    expect(isPriceAtLimitUp({ stockCode: "ABC", price: 11, referencePrice: 10 })).toBeNull();
    expect(isPriceAtLimitUp({ stockCode: "600001.SH", price: null, referencePrice: 10 })).toBeNull();
    expect(isPriceAtLimitUp({ stockCode: "600001.SH", price: 11, referencePrice: null })).toBeNull();
  });
});

describe("Adapter — Raw → Canonical Bar", () => {
  it("toCanonicalBar 解析 DB/Tushare 行（varchar 与 number 均兼容）", () => {
    const canonical = toCanonicalBar({
      stockCode: "002361.SZ",
      tradeDate: "2026-01-05",
      openPrice: "10.5",
      closePrice: 11.0,
      highPrice: "11.2",
      lowPrice: "10.3",
      amount: "15000",
      volume: "12000",
      preClosePrice: 10,
    });
    expect(canonical.symbol).toBe("002361.SZ");
    expect(canonical.timestamp).toBe("2026-01-05");
    expect(canonical.open).toBe(10.5);
    expect(canonical.close).toBe(11);
    expect(canonical.amount).toBe(15000);
    expect(canonical.volume).toBe(12000);
    expect(canonical.adjustment).toBe("raw");
    expect(canonical.turnoverRate).toBeNull(); // 原始 turnover_rate 不存在，不伪造
  });

  it("非法数值 → null（不静默填 0）", () => {
    const canonical = toCanonicalBar({ stockCode: "600001.SH", tradeDate: "2026-01-05", openPrice: "abc", closePrice: "   ", preClosePrice: null });
    expect(canonical.open).toBeNull();
    expect(canonical.close).toBeNull();
    expect(canonical.preClose).toBeNull();
  });

  it("toEngineMarketBar 与 Core MarketBar 字段映射（amount 单位一致：千元）", () => {
    const engineBar = toEngineMarketBar(bar());
    expect(engineBar.date).toBe("2026-01-05");
    expect(engineBar.open).toBe(10);
    expect(engineBar.prevClose).toBe(10);
    expect(engineBar.amount).toBe(15_000);
    expect("volume" in engineBar).toBe(false); // Core 契约无 volume
  });
});

describe("Validation — 数据质量三态", () => {
  it("合法 bar → VALID（缺失 turnoverRate 不报警告，其本身为可空字段）", () => {
    const result = validateMarketBar(bar());
    expect(result.status).toBe("VALID");
    expect(result.issues).toHaveLength(0);
  });

  it("symbol 为空 / timestamp 非法 → INVALID", () => {
    expect(validateMarketBar(bar({ symbol: "" })).status).toBe("INVALID");
    expect(validateMarketBar(bar({ timestamp: "2026/01/05" })).status).toBe("INVALID");
    expect(validateMarketBar(bar({ timestamp: "2026-13-01" })).status).toBe("INVALID");
  });

  it("OHLC 非正 → INVALID；字段缺失 → WARNING", () => {
    expect(validateMarketBar(bar({ open: 0 })).status).toBe("INVALID");
    expect(validateMarketBar(bar({ close: -1 })).status).toBe("INVALID");
    expect(validateMarketBar(bar({ high: null })).status).toBe("WARNING");
  });

  it("OHLC 矛盾（high < max / low > min / high < low）→ INVALID", () => {
    expect(validateMarketBar(bar({ high: 10, low: 9, open: 10.2, close: 10.1 })).issues.some((i) => i.code === "HIGH_LT_MAX")).toBe(true);
    expect(validateMarketBar(bar({ low: 10.2, open: 10, close: 10.1, high: 10.5 })).issues.some((i) => i.code === "LOW_GT_MIN")).toBe(true);
    expect(validateMarketBar(bar({ high: 9, low: 10.5, open: 10, close: 10 })).issues.some((i) => i.code === "HIGH_LT_LOW")).toBe(true);
  });

  it("volume / amount 为负 → INVALID", () => {
    expect(validateMarketBar(bar({ volume: -1 })).status).toBe("INVALID");
    expect(validateMarketBar(bar({ amount: -1 })).status).toBe("INVALID");
  });

  it("收盘涨停 → VALID（达到涨停价即判定触及，不误报）", () => {
    const atLimit = bar({ preClose: 10, close: 11, high: 11.2, low: 9.9 });
    expect(validateMarketBar(atLimit).status).toBe("VALID");
    // 涨停判定由 boardRules 权威给出
    expect(isLimitUpBar(bar({ preClose: 10, close: 11 }))).toBe(true);
    expect(isLimitUpBar(bar({ preClose: 10, close: 10.99 }))).toBe(false);
  });

  it("统一数值解析语义：parsePositivePrice / parseNonNegativeNumber 是唯一权威", async () => {
    const { parsePositivePrice, parseNonNegativeNumber, parseNumericPrice } = await import("./index");
    // 正价格：合法正数保留；0/负/非法/空 → null
    expect(parsePositivePrice("10.5")).toBe(10.5);
    expect(parsePositivePrice(11)).toBe(11);
    expect(parsePositivePrice("0")).toBeNull();
    expect(parsePositivePrice("-1")).toBeNull();
    expect(parsePositivePrice("abc")).toBeNull();
    expect(parsePositivePrice(null)).toBeNull();
    expect(parsePositivePrice(undefined)).toBeNull();
    expect(parsePositivePrice("")).toBeNull();
    // 非负数量/金额：0 允许；负/非法/空 → null
    expect(parseNonNegativeNumber("15000")).toBe(15000);
    expect(parseNonNegativeNumber(0)).toBe(0);
    expect(parseNonNegativeNumber("-1")).toBeNull();
    expect(parseNonNegativeNumber("abc")).toBeNull();
    expect(parseNonNegativeNumber(undefined)).toBeNull();
    expect(parseNumericPrice("12.3")).toBe(12.3);
  });
});
