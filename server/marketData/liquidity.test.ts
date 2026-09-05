import { describe, it, expect } from "vitest";
import {
  LIQUIDITY_PROVIDER_CAPABILITIES,
  liquidityFieldAvailability,
  mergeLiquidity,
  normalizeLiquidity,
  validateLiquidity,
  type NormalizedLiquidity,
} from "./liquidity";

describe("liquidity mapping + unit normalization", () => {
  it("tushare-daily-basic：万元→元（×10000），amount/volume 不可提供 → null", () => {
    const result = normalizeLiquidity("tushare-daily-basic", {
      securityId: "002361.SZ",
      tradeDate: "2026-01-05",
      turnoverRate: 5.2,
      circulationMarketCap: 123456.78, // 万元
      totalMarketCap: 200000, // 万元
    });
    expect(result.bar.turnoverRate).toBe(5.2);
    expect(result.bar.circulationMarketCap).toBeCloseTo(123456.78 * 10_000);
    expect(result.bar.totalMarketCap).toBeCloseTo(200000 * 10_000);
    expect(result.bar.amount).toBeNull();
    expect(result.bar.volume).toBeNull();
    expect(result.capability.circulationMarketCap).toBe("AVAILABLE");
    expect(result.capability.amount).toBe("UNAVAILABLE");
  });

  it("baostock-daily：元→千元（×0.001）、股→手（×0.01），市值不可提供 → null", () => {
    const result = normalizeLiquidity("baostock-daily", {
      securityId: "002361.SZ",
      tradeDate: "2026-01-05",
      turnoverRate: 3.1,
      amount: 123_456_789, // 元
      volume: 5_000_000, // 股
    });
    expect(result.bar.turnoverRate).toBe(3.1);
    expect(result.bar.amount).toBeCloseTo(123_456_789 * 0.001);
    expect(result.bar.volume).toBeCloseTo(5_000_000 * 0.01);
    expect(result.bar.circulationMarketCap).toBeNull();
    expect(result.bar.totalMarketCap).toBeNull();
  });

  it("tushare-daily：amount/volume 可提供，换手/市值不可提供", () => {
    const result = normalizeLiquidity("tushare-daily", {
      securityId: "002361.SZ",
      tradeDate: "2026-01-05",
      amount: 1000, // 千元
      volume: 500, // 手
    });
    expect(result.bar.amount).toBe(1000);
    expect(result.bar.volume).toBe(500);
    expect(result.bar.turnoverRate).toBeNull();
  });

  it("非有限数值 → null（不静默填 0）", () => {
    const result = normalizeLiquidity("baostock-daily", {
      securityId: "002361.SZ",
      tradeDate: "2026-01-05",
      amount: Number.NaN,
      turnoverRate: undefined,
    });
    expect(result.bar.amount).toBeNull();
    expect(result.bar.turnoverRate).toBeNull();
  });

  it("mergeLiquidity：后序 provider 只补前序缺失字段，不覆盖已有值", () => {
    const basic = normalizeLiquidity("tushare-daily-basic", {
      securityId: "002361.SZ",
      tradeDate: "2026-01-05",
      turnoverRate: 5.2,
      circulationMarketCap: 100000,
      totalMarketCap: 200000,
    });
    const daily = normalizeLiquidity("baostock-daily", {
      securityId: "002361.SZ",
      tradeDate: "2026-01-05",
      turnoverRate: 9.9, // 不应覆盖 basic 的 5.2
      amount: 123_000_000,
      volume: 1_000_000,
    });
    const merged = mergeLiquidity([basic, daily]);
    expect(merged).not.toBeNull();
    expect(merged!.bar.turnoverRate).toBe(5.2); // 前序优先
    expect(merged!.bar.amount).toBeCloseTo(123_000_000 * 0.001); // 后序补齐
    expect(merged!.bar.volume).toBeCloseTo(1_000_000 * 0.01);
    expect(merged!.sourceByField.turnoverRate).toBe("tushare-daily-basic");
    expect(merged!.sourceByField.amount).toBe("baostock-daily");
  });

  it("liquidityFieldAvailability 聚合多 provider 可提供性", () => {
    const basic = normalizeLiquidity("tushare-daily-basic", { securityId: "002361.SZ", tradeDate: "2026-01-05", turnoverRate: 1, circulationMarketCap: 1, totalMarketCap: 1 });
    const daily = normalizeLiquidity("baostock-daily", { securityId: "002361.SZ", tradeDate: "2026-01-05", turnoverRate: 1, amount: 1, volume: 1 });
    const availability = liquidityFieldAvailability([basic, daily]);
    expect(availability.turnoverRate).toBe("AVAILABLE");
    expect(availability.circulationMarketCap).toBe("AVAILABLE");
    expect(availability.totalMarketCap).toBe("AVAILABLE");
    expect(availability.amount).toBe("AVAILABLE");
    expect(availability.volume).toBe("AVAILABLE");
  });

  it("市值全量仅靠 baostock → 市值 UNAVAILABLE", () => {
    const daily = normalizeLiquidity("baostock-daily", { securityId: "002361.SZ", tradeDate: "2026-01-05", turnoverRate: 1, amount: 1, volume: 1 });
    expect(liquidityFieldAvailability([daily]).circulationMarketCap).toBe("UNAVAILABLE");
  });

  it("validateLiquidity 检出负值与换手率超范围", () => {
    const negative = validateLiquidity({
      securityId: "002361.SZ",
      tradeDate: "2026-01-05",
      turnoverRate: null,
      circulationMarketCap: null,
      totalMarketCap: null,
      amount: -1,
      volume: null,
      source: "test",
    });
    expect(negative.status).toBe("INVALID");

    const turn = validateLiquidity({
      securityId: "002361.SZ",
      tradeDate: "2026-01-05",
      turnoverRate: 9999,
      circulationMarketCap: null,
      totalMarketCap: null,
      amount: null,
      volume: null,
      source: "test",
    });
    expect(turn.status).toBe("INVALID");
  });

  it("validateLiquidity 检出流通市值 > 总市值", () => {
    const result = validateLiquidity({
      securityId: "002361.SZ",
      tradeDate: "2026-01-05",
      turnoverRate: null,
      circulationMarketCap: 200,
      totalMarketCap: 100,
      amount: null,
      volume: null,
      source: "test",
    });
    expect(result.issues.some((issue) => issue.code === "CIRC_MV_GT_TOTAL_MV")).toBe(true);
  });

  it("capability 表显式声明各 provider 能力", () => {
    expect(LIQUIDITY_PROVIDER_CAPABILITIES["baostock-daily"]!.circulationMarketCap).toBe("UNAVAILABLE");
    expect(LIQUIDITY_PROVIDER_CAPABILITIES["tushare-daily-basic"]!.turnoverRate).toBe("AVAILABLE");
  });
});

describe("liquidity 类型完整性", () => {
  it("NormalizedLiquidity 暴露 bar 与 capability", () => {
    const n: NormalizedLiquidity = normalizeLiquidity("tushare-daily", { securityId: "600000.SH", tradeDate: "2026-01-05" });
    expect(n.bar.source).toBe("tushare-daily");
    expect(n.capability.volume).toBe("AVAILABLE");
  });
});
