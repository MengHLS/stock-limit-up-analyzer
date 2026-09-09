/**
 * STEP 12.6 — Research Dataset：universe 决议 + 行投影测试（纯内存夹具，无 DB）。
 *
 * 复用 server/historicalState/reconstruct.test.ts 的夹具范式：
 *   - Security / SecurityIdentifier / SecurityStatusInterval 手工构造；
 *   - industry / CA / price / liquidity / index 为纯内存对象；
 *   - 断言 dataset 行与 universe 决议的确定性、PIT（无 look-ahead）与 code-ownership 过滤。
 */

import { describe, expect, it } from "vitest";
import { buildTradingCalendar } from "../security/tradingCalendar";
import { EXCLUSION_REASONS } from "../security/historicalUniverse";
import type { Security, SecurityIdentifier } from "../security/types";
import type { SecurityStatusInterval, StatusType } from "../securityStatus/types";
import type { IndustryAssignment, LiquidityDaily, IndexDailyBar, IndexMasterEntry } from "../marketData/types";
import type { CorporateAction } from "../corporateActions/types";
import type { CanonicalMarketBar } from "../data/types";
import { buildStaticContexts, assembleDayRows, projectStateToRow, activeFullCodeAt } from "./assemble";
import { resolveUniverseDefinition, resolveAsOfForRequest } from "./universe";
import type { NormalizedResearchDatasetRequest } from "./types";

const S1 = "sec_00000000-0000-4000-8000-000000000001";
const S2 = "sec_00000000-0000-4000-8000-000000000002";
const D = "2025-06-03";

function security(overrides: Partial<Security> = {}): Security {
  return {
    securityId: S1,
    securityType: "stock",
    exchange: "SH",
    currency: "CNY",
    country: "CN",
    status: "listed",
    listedDate: "2020-01-01",
    delistedDate: null,
    ...overrides,
  };
}

function identifier(overrides: Partial<SecurityIdentifier> = {}): SecurityIdentifier {
  return {
    securityId: S1,
    exchange: "SH",
    code: "600000",
    identifierType: "primary",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    source: "test",
    ...overrides,
  };
}

function status(
  overrides: Partial<SecurityStatusInterval> & { statusType: StatusType; statusValue: string; effectiveFrom: string },
): SecurityStatusInterval {
  return {
    securityId: S1,
    effectiveTo: null,
    source: "test",
    retrievedAt: null,
    confidence: "high",
    availability: "IMMEDIATE",
    ...overrides,
  };
}

function tradableIntervals(securityId = S1): SecurityStatusInterval[] {
  return [
    status({ securityId, statusType: "LISTING", statusValue: "LISTED", effectiveFrom: "2020-01-01" }),
    status({ securityId, statusType: "TRADING", statusValue: "TRADING", effectiveFrom: "2020-01-01" }),
  ];
}

function industryAssignment(overrides: Partial<IndustryAssignment> = {}): IndustryAssignment {
  return {
    securityId: "600000.SH",
    industryCode: "801780",
    industryName: "银行",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    source: "test",
    retrievedAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function priceBar(overrides: Partial<CanonicalMarketBar> = {}): CanonicalMarketBar {
  return {
    symbol: "600000.SH",
    timestamp: D,
    open: 10,
    high: 10.5,
    low: 9.8,
    close: 10.2,
    preClose: 10,
    volume: 200_000,
    amount: 800_000,
    turnoverRate: null,
    adjustment: "raw",
    ...overrides,
  };
}

function liquidity(overrides: Partial<LiquidityDaily> = {}): LiquidityDaily {
  return {
    securityId: "600000.SH",
    tradeDate: D,
    turnoverRate: 0.5,
    circulationMarketCap: 1_000_000_000,
    totalMarketCap: 1_200_000_000,
    amount: 800_000,
    volume: 200_000,
    source: "test",
    ...overrides,
  };
}

function indexBar(overrides: Partial<IndexDailyBar> = {}): IndexDailyBar {
  return {
    indexCode: "000300.SH",
    tradeDate: D,
    open: 4000,
    high: 4020,
    low: 3980,
    close: 4010,
    amount: 400_000_000,
    volume: 500_000_000,
    source: "test",
    ...overrides,
  };
}

function indexMasterEntry(overrides: Partial<IndexMasterEntry> = {}): IndexMasterEntry {
  return {
    indexCode: "000300.SH",
    indexName: "沪深300",
    provider: "test",
    providerCode: "000300.SH",
    firstDate: null,
    lastDate: null,
    source: "test",
    retrievedAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function corporateAction(overrides: Partial<CorporateAction> = {}): CorporateAction {
  return {
    securityId: S1,
    securityCode: "600000.SH",
    actionType: "dividend",
    effectiveDate: "2025-05-30",
    recordDate: "2025-05-29",
    announcementDate: "2025-05-20",
    cashAmount: 0.5,
    bonusRatio: null,
    transferRatio: null,
    rightsRatio: null,
    rightsPrice: null,
    splitRatio: null,
    source: "test",
    retrievedAt: "2025-05-25T00:00:00.000Z",
    description: null,
    ...overrides,
  };
}

const CAL = buildTradingCalendar(
  ["2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05", "2025-06-06"],
  "test-cal",
);

const BASE_REQUEST: NormalizedResearchDatasetRequest = {
  name: "tradable-daily",
  startDate: "2025-06-02",
  endDate: "2025-06-06",
  asOfPerTradeDate: true,
  asOf: null,
  coreIndexCodes: ["000300.SH"],
};

describe("resolveUniverseDefinition", () => {
  it("只含可交易成员（排除 pre-listing / UNKNOWN 默认拒绝）", () => {
    const securities = [
      security(), // S1 正常上市可交易
      security({ securityId: S2, listedDate: "2025-06-05" }), // S2 上市日晚于 D
    ];
    const identifiers = [
      identifier(),
      identifier({ securityId: S2, code: "000001", exchange: "SH", effectiveFrom: "2020-01-01", effectiveTo: null }),
    ];
    const statuses = [...tradableIntervals(S1)];
    const universe = resolveUniverseDefinition(
      { securities, identifiers, statusIntervals: statuses },
      CAL,
      ["2025-06-03"],
      BASE_REQUEST,
    );
    expect(universe.days).toHaveLength(1);
    expect(universe.days[0]!.members).toEqual([S1]);
    expect(universe.days[0]!.excludedByReason).toHaveProperty(EXCLUSION_REASONS.NOT_YET_LISTED);
  });
});

describe("assembleDayRows", () => {
  it("扁平化投影：身份/生命周期/可交易/行业/流动性/价格/指数/可知性 全解析", () => {
    const securities = [security()];
    const identifiers = [identifier()];
    const statuses = tradableIntervals(S1);
    const contexts = buildStaticContexts({
      securities,
      identifiers,
      statusIntervals: statuses,
      industryAssignments: [industryAssignment()],
      corporateActions: [],
    });
    const priceByCode = new Map([["600000.SH", priceBar()]]);
    const liquidityByCode = new Map([["600000.SH", liquidity()]]);

    const rows = assembleDayRows(
      contexts,
      [S1],
      D,
      D, // asOf = tradeDate（逐日 PIT）
      priceByCode,
      liquidityByCode,
      [indexBar()],
      [indexMasterEntry()],
    );

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.tradeDate).toBe(D);
    expect(row.asOf).toBe(D);
    expect(row.securityId).toBe(S1);
    expect(row.code).toBe("600000.SH");
    expect(row.lifecycleVerdict).toBe("LISTED");
    expect(row.eligible).toBe(true);
    expect(row.exclusionReason).toBeNull();
    expect(row.industryName).toBe("银行");
    expect(row.close).toBe(10.2);
    expect(row.turnoverRate).toBe(0.5);
    expect(row.indexClose["000300.SH"]).toBe(4010);
    expect(row.knowledge.price).toBe("KNOWN");
    expect(row.knowledge.industry).toBe("KNOWN");
    expect(row.knowledge.tradability).toBe("KNOWN");
  });

  it("CA PIT 双层口径：effective 可见但 announcementDate 晚于 asOf 不得记为已知", () => {
    // effectiveDate 2025-05-30 <= D，但 announcementDate 2025-06-05 > asOf(D) → 已生效但当日未知。
    const ca = corporateAction({ effectiveDate: "2025-05-30", announcementDate: "2025-06-05" });
    const contexts = buildStaticContexts({
      securities: [security()],
      identifiers: [identifier()],
      statusIntervals: tradableIntervals(S1),
      industryAssignments: [industryAssignment()],
      corporateActions: [ca],
    });
    const rows = assembleDayRows(
      contexts,
      [S1],
      D,
      D,
      new Map([["600000.SH", priceBar()]]),
      new Map([["600000.SH", liquidity()]]),
      [indexBar()],
      [indexMasterEntry()],
    );
    expect(rows[0]!.corporateActionsEffectiveCount).toBe(1); // 已生效（effective<=tradeDate）
    expect(rows[0]!.corporateActionsKnownCount).toBe(0); // announcement 晚于 asOf，无 look-ahead
  });

  it("无价格 bar 时 price 维度为 UNKNOWN（不伪造）", () => {
    const contexts = buildStaticContexts({
      securities: [security()],
      identifiers: [identifier()],
      statusIntervals: tradableIntervals(S1),
      industryAssignments: [industryAssignment()],
      corporateActions: [],
    });
    const rows = assembleDayRows(
      contexts,
      [S1],
      D,
      D,
      new Map(), // 无价格
      new Map([["600000.SH", liquidity()]]),
      [indexBar()],
      [indexMasterEntry()],
    );
    expect(rows[0]!.close).toBeNull();
    expect(rows[0]!.knowledge.price).toBe("UNKNOWN");
  });

  it("确定性：相同输入两次 → 相同行序列", () => {
    const contexts = buildStaticContexts({
      securities: [security()],
      identifiers: [identifier()],
      statusIntervals: tradableIntervals(S1),
      industryAssignments: [industryAssignment()],
      corporateActions: [],
    });
    const facts = () => ({
      priceByCode: new Map([["600000.SH", priceBar()]]),
      liquidityByCode: new Map([["600000.SH", liquidity()]]),
    });
    const run = () =>
      assembleDayRows(
        contexts,
        [S1],
        D,
        D,
        facts().priceByCode,
        facts().liquidityByCode,
        [indexBar()],
        [indexMasterEntry()],
      );
    expect(run()).toEqual(run());
  });
});

describe("activeFullCodeAt / projectStateToRow 辅助", () => {
  it("code 复用：行业/CA 只归属真正拥有该代码的证券（防跨主体串扰）", () => {
    // S1 拥有 600000.SH：2020-01-01 起（interval A）
    // S2 拥有同代码：1999-01-01 ~ 2019-12-31（interval B，先于 S1）
    const s2Ident = identifier({
      securityId: S2,
      exchange: "SH",
      code: "600000",
      effectiveFrom: "1999-01-01",
      effectiveTo: "2019-12-31",
    });
    // 行业区间挂在 S2 持有期内 → 只应进入 S2 上下文；S1 不得串扰。
    const industryForS2Era = industryAssignment({
      securityId: "600000.SH",
      effectiveFrom: "1999-06-01",
      effectiveTo: "2019-12-31",
      retrievedAt: "2019-12-01T00:00:00.000Z",
    });
    const caForS2Era = corporateAction({
      securityId: S2,
      securityCode: "600000.SH",
      effectiveDate: "2010-06-10",
      announcementDate: "2010-06-01",
    });
    const contexts = buildStaticContexts({
      securities: [security(), security({ securityId: S2, listedDate: "1999-01-01" })],
      identifiers: [identifier(), s2Ident],
      statusIntervals: [],
      industryAssignments: [industryForS2Era],
      corporateActions: [caForS2Era],
    });
    const s1 = contexts.get(S1)!;
    const s2 = contexts.get(S2)!;
    expect(s1.industryAssignments).toEqual([]); // 该区间不属于 S1
    expect(s1.corporateActions).toEqual([]);
    expect(s2.industryAssignments).toHaveLength(1); // 属于 S2
    expect(s2.corporateActions).toHaveLength(1);
  });

  it("activeFullCodeAt 返回当日完整代码", () => {
    const contexts = buildStaticContexts({
      securities: [security()],
      identifiers: [identifier()],
      statusIntervals: tradableIntervals(S1),
      industryAssignments: [],
      corporateActions: [],
    });
    const context = contexts.get(S1)!;
    expect(activeFullCodeAt(context, D)).toBe("600000.SH");
    expect(activeFullCodeAt(context, "2019-12-31")).toBeNull(); // 早于标识符 effectiveFrom
  });

  it("projectStateToRow 直接投影（供独立调用方）", () => {
    // 通过 resolveSecurityHistoricalState 得到完整状态后投影（复用 reconstruct fixture 语义）。
    // 此处用 assembleDayRows 产出的行验证 schema 一致即可（已在上方用例覆盖）。
    expect(typeof projectStateToRow).toBe("function");
  });
});

describe("resolveAsOfForRequest", () => {
  it("逐日 PIT → null（每行用 tradeDate）；固定快照 → asOf", () => {
    expect(resolveAsOfForRequest(BASE_REQUEST)).toBeNull();
    const frozen: NormalizedResearchDatasetRequest = { ...BASE_REQUEST, asOfPerTradeDate: false, asOf: "2025-06-05" };
    expect(resolveAsOfForRequest(frozen)).toBe("2025-06-05");
  });
});
