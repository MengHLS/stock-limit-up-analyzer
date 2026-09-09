/**
 * STEP 12.5 — DB 行 → 领域对象映射单元测试（纯映射，无 DB）。
 *
 * 验证：
 *   - varchar 数值列（价格/公司行为/复权因子）→ number，空串/非法/缺失 → null（禁止填零/伪造）；
 *   - double 数值列（流动性/指数）直接透传，null 保持 null；
 *   - Date 时间列 → ISO 8601；可空时间列缺失 → null；
 *   - code 键域 securityId 软引用为 null 时，领域 securityId 落到自然键 securityCode（禁止 null 冒充身份）。
 */

import { describe, expect, it } from "vitest";
import {
  adjustmentFactorRowToFactor,
  corporateActionRowToAction,
  identifierRowToSecurityIdentifier,
  indexDailyRowToBar,
  indexMasterRowToEntry,
  industryRowToAssignment,
  liquidityRowToDaily,
  researchSecurityRowToSecurity,
  statusRowToInterval,
} from "./mappers";

describe("STEP 7.4 行映射", () => {
  it("research_securities 行 → Security（同名字段透传）", () => {
    const security = researchSecurityRowToSecurity({
      securityId: "sec_abc",
      securityType: "stock",
      exchange: "SH",
      currency: "CNY",
      country: "CN",
      status: "listed",
      listedDate: "2020-01-01",
      delistedDate: null,
    } as never);
    expect(security).toEqual({
      securityId: "sec_abc",
      securityType: "stock",
      exchange: "SH",
      currency: "CNY",
      country: "CN",
      status: "listed",
      listedDate: "2020-01-01",
      delistedDate: null,
    });
  });

  it("identifier_history 行 → SecurityIdentifier（code=6 位数字，无后缀）", () => {
    const identifier = identifierRowToSecurityIdentifier({
      securityId: "sec_abc",
      exchange: "SH",
      securityCode: "600000",
      identifierType: "primary",
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
      source: "test",
    } as never);
    expect(identifier.code).toBe("600000");
    expect(identifier.effectiveTo).toBeNull();
    expect(identifier.identifierType).toBe("primary");
  });
});

describe("STEP 7.5 状态行映射", () => {
  it("retrievedAt 为 Date → ISO；为 null → null", () => {
    const withDate = statusRowToInterval({
      securityId: "sec_abc",
      statusType: "TRADING",
      statusValue: "SUSPENDED",
      effectiveFrom: "2025-06-02",
      effectiveTo: "2025-06-06",
      source: "test",
      retrievedAt: new Date("2025-06-07T08:00:00Z"),
      confidence: "high",
      availability: "IMMEDIATE",
    } as never);
    expect(withDate.retrievedAt).toBe("2025-06-07T08:00:00.000Z");

    const withoutDate = statusRowToInterval({
      securityId: "sec_abc",
      statusType: "TRADING",
      statusValue: "TRADING",
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
      source: "test",
      retrievedAt: null,
      confidence: "high",
      availability: "IMMEDIATE",
    } as never);
    expect(withoutDate.retrievedAt).toBeNull();
  });
});

describe("STEP 7.6 行业 / 流动性 / 指数行映射", () => {
  it("industry 行 → IndustryAssignment：领域键 = 自然键 securityCode（软引用 null 不冒充身份）", () => {
    const assignment = industryRowToAssignment({
      securityId: null,
      securityCode: "600000.SH",
      industryCode: "801780",
      industryName: "银行",
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
      source: "test",
      retrievedAt: new Date("2020-01-02T00:00:00Z"),
    } as never);
    expect(assignment.securityId).toBe("600000.SH");
    expect(assignment.industryName).toBe("银行");
    expect(assignment.effectiveTo).toBeNull();
    expect(assignment.retrievedAt).toBe("2020-01-02T00:00:00.000Z");
  });

  it("liquidity 行 → LiquidityDaily：double 数值直接透传，null 保持 null", () => {
    const daily = liquidityRowToDaily({
      securityId: null,
      securityCode: "600000.SH",
      tradeDate: "2025-06-03",
      turnoverRate: 0.5,
      circulationMarketCap: 1_000_000_000_000,
      totalMarketCap: null,
      amount: 800_000,
      volume: 200_000,
      source: "test",
    } as never);
    expect(daily.securityId).toBe("600000.SH");
    expect(daily.turnoverRate).toBe(0.5);
    expect(daily.totalMarketCap).toBeNull();
  });

  it("index_daily 行 → IndexDailyBar；index_master 行 → IndexMasterEntry", () => {
    const bar = indexDailyRowToBar({
      indexCode: "000300.SH",
      tradeDate: "2025-06-03",
      open: 4000,
      high: 4020,
      low: null,
      close: 4010,
      amount: 400_000_000,
      volume: 500_000_000,
      source: "test",
    } as never);
    expect(bar.close).toBe(4010);
    expect(bar.low).toBeNull();

    const entry = indexMasterRowToEntry({
      indexCode: "000300.SH",
      indexName: "沪深300",
      provider: "test",
      providerCode: "000300.SH",
      firstDate: "2005-04-08",
      lastDate: null,
      source: "test",
      retrievedAt: new Date("2020-01-01T00:00:00Z"),
    } as never);
    expect(entry.indexName).toBe("沪深300");
    expect(entry.lastDate).toBeNull();
  });
});

describe("STEP 7.7 公司行为 / 复权因子行映射", () => {
  it("varchar 现金/比例列 → number；空串与缺失 → null（禁止静默填零）", () => {
    const action = corporateActionRowToAction({
      securityId: "sec_abc",
      securityCode: "600000.SH",
      actionType: "dividend",
      effectiveDate: "2025-05-30",
      recordDate: "2025-05-29",
      announcementDate: null,
      cashAmount: "0.5",
      bonusRatio: "",
      transferRatio: null,
      rightsRatio: "0.3",
      rightsPrice: "12.5",
      splitRatio: null,
      source: "test",
      retrievedAt: new Date("2025-06-01T08:00:00Z"),
      description: "10派5元",
    } as never);
    expect(action.cashAmount).toBe(0.5);
    expect(action.bonusRatio).toBeNull(); // 空串 → null
    expect(action.transferRatio).toBeNull();
    expect(action.rightsRatio).toBe(0.3);
    expect(action.announcementDate).toBeNull(); // 缺失保持 null，禁止假设 = effectiveDate
    expect(action.retrievedAt).toBe("2025-06-01T08:00:00.000Z");
  });

  it("adjustment_factors varchar 因子 → number", () => {
    const factor = adjustmentFactorRowToFactor({
      securityCode: "600000.SH",
      effectiveDate: "2025-05-30",
      foreFactor: "1.05",
      backFactor: "0.9523809524",
      source: "test",
      retrievedAt: new Date("2025-06-01T08:00:00Z"),
    } as never);
    expect(factor.foreFactor).toBeCloseTo(1.05, 10);
    expect(factor.backFactor).toBeCloseTo(0.9523809524, 10);
  });

  it("非法数值 → null，绝不抛错或填零", () => {
    const action = corporateActionRowToAction({
      securityCode: "600000.SH",
      actionType: "rights_issue",
      effectiveDate: "2025-05-30",
      recordDate: null,
      announcementDate: null,
      cashAmount: "abc",
      bonusRatio: null,
      transferRatio: null,
      rightsRatio: null,
      rightsPrice: "NaN",
      splitRatio: null,
      source: "test",
      retrievedAt: new Date("2025-06-01T08:00:00Z"),
      description: null,
    } as never);
    expect(action.cashAmount).toBeNull();
    expect(action.rightsPrice).toBeNull();
  });
});
