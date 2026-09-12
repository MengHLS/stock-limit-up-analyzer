/**
 * STEP DATASET-001 — 首板事件检测测试（§14 首板定义 + §38.9 Future Leakage）。
 */

import { describe, expect, it } from "vitest";
import {
  advanceSymbolLimitState,
  classifyLimitDay,
  computeEventId,
  INITIAL_SYMBOL_LIMIT_STATE,
  isLimitUpClose,
  limitUpRatio,
} from "./detection";

describe("detection: 涨停比例（复用 boardRules 口径，不硬编码 +10%）", () => {
  it("主板非 ST 10%、ST/*ST 5%", () => {
    expect(limitUpRatio("600001.SH", "NORMAL")).toBe(0.1);
    expect(limitUpRatio("000001.SZ", "ST")).toBe(0.05);
    expect(limitUpRatio("002001.SZ", "*ST")).toBe(0.05);
  });
  it("创业板/科创板 20%、北交所 30%", () => {
    expect(limitUpRatio("300001.SZ", "NORMAL")).toBe(0.2);
    expect(limitUpRatio("688001.SH", "NORMAL")).toBe(0.2);
    expect(limitUpRatio("920001.BJ", "NORMAL")).toBe(0.3);
  });
  it("unknown 板块不可判 → null", () => {
    expect(limitUpRatio("999999.XX", "NORMAL")).toBeNull();
  });
});

describe("detection: 涨停判定（交易所口径，四舍五入到分）", () => {
  it("close ≥ 涨停价 = 涨停；1 分钱之差不算", () => {
    expect(isLimitUpClose(11.0, 10.0, 0.1)).toBe(true); // 10 → 11.00 恰好
    expect(isLimitUpClose(10.99, 10.0, 0.1)).toBe(false); // 差 1 分
    expect(isLimitUpClose(null, 10.0, 0.1)).toBe(false);
    expect(isLimitUpClose(11.0, null, 0.1)).toBe(false);
    expect(isLimitUpClose(11.0, 10.0, null)).toBe(false);
  });

  it("回归：封板收盘价恰为「四舍五入到分」的涨停价时必须判为涨停（浮点误差不得漏判）", () => {
    // 真实行情样本（2025-2026 实测）：前收 11.61 → 涨停价 12.77；
    // 未四舍五入的原始乘积 11.61 × 1.1 = 12.771 > 12.77，旧实现会漏判。
    expect(11.61 * 1.1).toBeGreaterThan(12.77);
    expect(isLimitUpClose(12.77, 11.61, 0.1)).toBe(true);

    // 前收 6.81 → 涨停价 7.49（原始乘积 7.491）
    expect(isLimitUpClose(7.49, 6.81, 0.1)).toBe(true);

    // 前收 11 → 涨停价 12.10（原始乘积 12.100000000000001）
    expect(11 * 1.1).toBeGreaterThan(12.1);
    expect(isLimitUpClose(12.1, 11, 0.1)).toBe(true);

    // 创业板 20%：前收 10.01 → 涨停价 12.01（原始乘积 12.012）
    expect(isLimitUpClose(12.01, 10.01, 0.2)).toBe(true);
    // ST 5%：前收 1.01 → 涨停价 1.06（原始乘积 1.0605）
    expect(isLimitUpClose(1.06, 1.01, 0.05)).toBe(true);
  });

  it("回归：低于涨停价 1 分仍判否（修正不得放松判定口径）", () => {
    expect(isLimitUpClose(12.76, 11.61, 0.1)).toBe(false);
    expect(isLimitUpClose(7.48, 6.81, 0.1)).toBe(false);
    expect(isLimitUpClose(12.09, 11, 0.1)).toBe(false);
    expect(isLimitUpClose(12.0, 10.01, 0.2)).toBe(false);
    expect(isLimitUpClose(1.05, 1.01, 0.05)).toBe(false);
  });

  it("回归：超出涨停价（异常/除权失真数据）仍判为涨停（用 ≥ 而非 =）", () => {
    expect(isLimitUpClose(13.5, 11.61, 0.1)).toBe(true);
  });
});

describe("detection: 首板判定（首板 = 今日涨停且昨日未涨停）", () => {
  const idx = new Map<string, number>([
    ["2024-01-02", 0],
    ["2024-01-03", 1],
    ["2024-01-04", 2],
    ["2024-01-05", 3],
  ]);

  it("窗口首日涨停 → 首板（T-1 无数据视作非连板）", () => {
    const c = classifyLimitDay(INITIAL_SYMBOL_LIMIT_STATE, "2024-01-02", true, idx);
    expect(c.isFirstLimit).toBe(true);
    expect(c.previousLimitDate).toBeNull();
    expect(c.historicalLimitCount).toBe(0);
  });

  it("连板：昨日涨停 + 今日涨停 → 非首板", () => {
    const prev = advanceSymbolLimitState(INITIAL_SYMBOL_LIMIT_STATE, "2024-01-02", true);
    const c = classifyLimitDay({ ...prev, prevTradingDayLimitUp: true }, "2024-01-03", true, idx);
    expect(c.isFirstLimit).toBe(false);
  });

  it("隔日再涨停 → 首板，且 daysSincePreviousLimit 正确", () => {
    // 1/2 涨停，1/3 未涨停，1/4 再涨停 → 1/4 是首板，距上次涨停 2 个交易日
    const s1 = advanceSymbolLimitState(INITIAL_SYMBOL_LIMIT_STATE, "2024-01-02", true);
    const s2 = advanceSymbolLimitState(s1, "2024-01-03", false);
    const c = classifyLimitDay({ ...s2, prevTradingDayLimitUp: false }, "2024-01-04", true, idx);
    expect(c.isFirstLimit).toBe(true);
    expect(c.previousLimitDate).toBe("2024-01-02");
    expect(c.daysSincePreviousLimit).toBe(2);
    expect(c.historicalLimitCount).toBe(1);
  });

  it("eventId 确定性且唯一于 (symbol, tradeDate)", () => {
    expect(computeEventId("600001.SH", "2024-01-02")).toBe("600001.SH@2024-01-02");
    expect(computeEventId("600001.SH", "2024-01-02")).toBe(computeEventId("600001.SH", "2024-01-02"));
  });
});

describe("detection: Future Leakage（§38.9）", () => {
  it("首板判定只依赖 close/preClose/截至 T 日的滚动状态，不读取未来", () => {
    // 构造：T 日涨停、T+1 也涨停。T 日的首板判定结果与 T+1 完全无关。
    const idx = new Map<string, number>([["D0", 0], ["D1", 1]]);
    const t0 = classifyLimitDay(INITIAL_SYMBOL_LIMIT_STATE, "D0", true, idx);
    // 即便 T+1 也涨停，T 日仍是首板（判定在 T 日完成，不向后看）
    expect(t0.isFirstLimit).toBe(true);
  });
});
