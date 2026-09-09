import { describe, it, expect } from "vitest";
import { parseBaostockStockDaily } from "./providers/baostock";
import {
  getBackfilledSecurityCodes,
  liquidityBarToInsert,
  liquidityDailyIdempotencyKey,
} from "./liquidityStorage";
import { validateLiquidity } from "./liquidity";

describe("liquidityStorage（幂等键 + bar→insert 映射）", () => {
  it("幂等键与唯一约束 (securityCode, tradeDate) 对齐", () => {
    expect(liquidityDailyIdempotencyKey("600000.SH", "2026-01-05")).toBe("600000.SH|2026-01-05");
  });

  it("liquidityBarToInsert：securityCode 作自然键，securityId 软引用，市值 null 透传", () => {
    const bars = parseBaostockStockDaily(
      [{ date: "2026-01-05", open: "10", high: "11", low: "9.9", close: "10.5", volume: "1000000", amount: "123000000", turn: "3.1", tradestatus: "1", isST: "0" }],
      "600000.SH",
    );
    const insert = liquidityBarToInsert(bars[0]!, "600000.SH", "sec_abc");
    expect(insert.securityCode).toBe("600000.SH");
    expect(insert.securityId).toBe("sec_abc");
    expect(insert.tradeDate).toBe("2026-01-05");
    expect(insert.circulationMarketCap).toBeNull();
    expect(insert.totalMarketCap).toBeNull();
    expect(insert.source).toBe("baostock-daily");
  });

  it("liquidityBarToInsert：未知 securityId 时为 null", () => {
    const bars = parseBaostockStockDaily(
      [{ date: "2026-01-05", open: "10", high: "11", low: "9.9", close: "10.5", volume: "1000000", amount: "123000000", turn: "3.1", tradestatus: "1" }],
      "600000.SH",
    );
    const insert = liquidityBarToInsert(bars[0]!, "600000.SH");
    expect(insert.securityId).toBeNull();
  });
});

describe("单位换算复用（WORK E 链路不自行乘除，走 normalizeLiquidity）", () => {
  it("parseBaostockStockDaily：元→千元（×0.001）、股→手（×0.01）、turn 原样 %、市值 null", () => {
    const bars = parseBaostockStockDaily(
      [{ date: "2026-01-05", open: "10", high: "11", low: "9.9", close: "10.5", volume: "5000000", amount: "123456789", turn: "0.084554", tradestatus: "1", isST: "0" }],
      "600000.SH",
    );
    const bar = bars[0]!;
    expect(bar.turnoverRate).toBeCloseTo(0.084554); // % 原样
    expect(bar.amount).toBeCloseTo(123_456_789 * 0.001); // 元 → 千元
    expect(bar.volume).toBeCloseTo(5_000_000 * 0.01); // 股 → 手
    expect(bar.circulationMarketCap).toBeNull(); // UNAVAILABLE
    expect(bar.totalMarketCap).toBeNull();
    // 换算结果必须通过 validateLiquidity（无负值/换手超范围）
    expect(validateLiquidity(bar).status).not.toBe("INVALID");
  });

  it("空数值字段 → null（不静默填 0）", () => {
    const bars = parseBaostockStockDaily(
      [{ date: "2026-01-05", open: "", high: "", low: "", close: "", volume: "", amount: "", turn: "", tradestatus: "0", isST: "0" }],
      "600000.SH",
    );
    const bar = bars[0]!;
    expect(bar.volume).toBeNull();
    expect(bar.amount).toBeNull();
    expect(bar.turnoverRate).toBeNull();
  });
});

describe("getBackfilledSecurityCodes（resume 读取）", () => {
  it("无库环境下返回空集（不抛错）", async () => {
    // 未配置 DATABASE_URL 时 getDb() 返回 null，应降级为空集
    const codes = await getBackfilledSecurityCodes();
    expect(codes).toBeInstanceOf(Set);
  });
});
