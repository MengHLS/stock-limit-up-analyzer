/**
 * STEP 12.5 — Historical State Reconstruction：纯函数核心单元测试。
 *
 * 覆盖任务 C-12.5.1 的 10 问（身份/上市/退市/行业/可交易/流动性/价格/公司行为/市场状态/可知性）
 * + PIT 无未来泄漏（asOf：CA announcementDate、行业 retrievedAt、状态 T+1 交易日语义）
 * + code 复用归属 + 默认拒绝 + 确定性 + 数据错配即抛错。
 * 全部纯内存、确定性、无网络/时间/随机（沿用 server/security/historicalUniverse.test.ts 范式）。
 */

import { describe, expect, it } from "vitest";
import { buildTradingCalendar } from "../security/tradingCalendar";
import { EXCLUSION_REASONS } from "../security/historicalUniverse";
import {
  resolveSecurityHistoricalState,
  resolveActiveIdentifierAt,
  isCodeOwnedBySecurityAt,
  isCodeIntervalOwnedBySecurity,
} from "./reconstruct";
import type { HistoricalStateInput } from "./types";
import type { Security, SecurityIdentifier } from "../security/types";
import type { SecurityStatusInterval, StatusType } from "../securityStatus/types";
import type { IndustryAssignment, IndexDailyBar, IndexMasterEntry, LiquidityDaily } from "../marketData/types";
import type { CorporateAction } from "../corporateActions/types";
import type { CanonicalMarketBar } from "../data/types";

const S1 = "sec_00000000-0000-4000-8000-000000000001";
const S2 = "sec_00000000-0000-4000-8000-000000000002";

/** 基准交易日（周内、避开节假日）。 */
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
  overrides: Partial<SecurityStatusInterval> & {
    statusType: StatusType;
    statusValue: string;
    effectiveFrom: string;
  },
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

/** 正常上市 + 正常交易的默认状态区间（LISTING=LISTED + TRADING=TRADING）。 */
function tradableIntervals(securityId = S1, listedFrom = "2020-01-01"): SecurityStatusInterval[] {
  return [
    status({ securityId, statusType: "LISTING", statusValue: "LISTED", effectiveFrom: listedFrom }),
    status({ securityId, statusType: "TRADING", statusValue: "TRADING", effectiveFrom: listedFrom }),
  ];
}

/** 600000.SH 的默认行业区间（2020 起至今，retrievedAt 早于 D）。 */
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

function ca(overrides: Partial<CorporateAction> = {}): CorporateAction {
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
    retrievedAt: "2025-06-01T00:00:00.000Z",
    description: null,
    ...overrides,
  };
}

function liquidity(overrides: Partial<LiquidityDaily> = {}): LiquidityDaily {
  return {
    securityId: "600000.SH",
    tradeDate: D,
    turnoverRate: 0.5,
    circulationMarketCap: 1_000_000_000_000,
    totalMarketCap: 1_500_000_000_000,
    amount: 800_000,
    volume: 200_000,
    source: "test",
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

/** 默认完整输入：正常上市、可交易、有行业/价格/流动性/指数（无 CA）。 */
function fullInput(overrides: Partial<HistoricalStateInput> = {}): HistoricalStateInput {
  return {
    security: security(),
    identifiers: [identifier()],
    statusIntervals: tradableIntervals(),
    industryAssignments: [industryAssignment()],
    priceBar: priceBar(),
    liquidity: liquidity(),
    corporateActions: [],
    indexBars: [indexBar()],
    indexMaster: [indexMasterEntry()],
    ...overrides,
  };
}

/** 含周末空档的交易日历（周五 6/6 的下一交易日为周一 6/9）。 */
const CAL = buildTradingCalendar(
  [
    "2025-06-02",
    "2025-06-03",
    "2025-06-04",
    "2025-06-05",
    "2025-06-06",
    "2025-06-09",
    "2025-06-10",
    "2025-06-11",
    "2025-06-12",
    "2025-06-13",
  ],
  "test-cal",
);

describe("STEP 12.5 — 完整状态 10 问", () => {
  it("正常上市可交易日：10 个问题全部得到确定答案", () => {
    const state = resolveSecurityHistoricalState(fullInput(), D);

    // Q1 身份
    expect(state.identity.securityId).toBe(S1);
    expect(state.identity.codeDigits).toBe("600000");
    expect(state.identity.code).toBe("600000.SH");
    expect(state.identity.identifierType).toBe("primary");

    // Q2/Q3 生命周期
    expect(state.lifecycle.verdict).toBe("LISTED");
    expect(state.lifecycle.listing?.statusValue).toBe("LISTED");
    expect(state.lifecycle.delisting).toBeNull();

    // Q5 可交易
    expect(state.tradability.eligible).toBe(true);
    expect(state.tradability.reason).toBeNull();
    expect(state.tradability.trading?.statusValue).toBe("TRADING");
    // 默认装置只有 LISTING/TRADING 维度；ST/DELISTING/SUSPENSION 无已知数据 → 显式 UNKNOWN
    expect(state.tradability.snapshot.unknownDimensions).toEqual(["ST", "DELISTING", "SUSPENSION"]);

    // Q4 行业
    expect(state.industry?.industryName).toBe("银行");
    expect(state.industry?.industryCode).toBe("801780");

    // Q6 流动性 / Q7 价格（日级事实）
    expect(state.liquidity?.turnoverRate).toBe(0.5);
    expect(state.price?.close).toBe(10.2);
    expect(state.price?.adjustment).toBe("raw");

    // Q8 公司行为（无事件 = 已加载但为空）
    expect(state.corporateActions.effectiveOnOrBefore).toEqual([]);
    expect(state.corporateActions.knownAtAsOf).toEqual([]);
    expect(state.knowledge.dimensions.corporateActions).toBe("KNOWN");

    // Q9 市场状态
    expect(state.marketState).toHaveLength(1);
    expect(state.marketState[0]!.indexName).toBe("沪深300");
    expect(state.marketState[0]!.bar.close).toBe(4010);

    // Q10 可知性（缺省 asOf=null → 全知视角）
    expect(state.knowledge.policy).toBe("FULL_KNOWLEDGE");
    expect(state.knowledge.dimensions.identity).toBe("KNOWN");
    expect(state.knowledge.dimensions.listing).toBe("KNOWN");
    expect(state.knowledge.dimensions.tradability).toBe("KNOWN");
    expect(state.knowledge.dimensions.industry).toBe("KNOWN");
    expect(state.knowledge.dimensions.liquidity).toBe("KNOWN");
    expect(state.knowledge.dimensions.price).toBe("KNOWN");
  });

  it("未加载域必须标记 UNKNOWN，禁止默认填充为 KNOWN", () => {
    const state = resolveSecurityHistoricalState(fullInput({ corporateActions: undefined }), D);
    expect(state.knowledge.dimensions.corporateActions).toBe("UNKNOWN");
  });

  it("日历提供时给出 isTradingDay；缺失时为 null", () => {
    const withCal = resolveSecurityHistoricalState(fullInput(), "2025-06-07", { calendar: CAL });
    expect(withCal.query.isTradingDay).toBe(false);
    expect(withCal.query.calendar).toBe("test-cal");

    const noCal = resolveSecurityHistoricalState(fullInput(), D);
    expect(noCal.query.isTradingDay).toBeNull();
    expect(noCal.query.calendar).toBeNull();
  });
});

describe("STEP 12.5 — 生命周期 / 可交易（默认拒绝）", () => {
  it("尚未上市 → NOT_YET_LISTED + 不可交易", () => {
    const input = fullInput({
      security: security({ listedDate: "2025-06-10" }),
      identifiers: [identifier({ effectiveFrom: "2025-06-10" })],
      statusIntervals: tradableIntervals(S1, "2025-06-10"),
      priceBar: null, // 无生效代码时不得携带日级数据
      liquidity: null,
    });
    const state = resolveSecurityHistoricalState(input, "2025-06-03");
    expect(state.lifecycle.verdict).toBe("NOT_YET_LISTED");
    expect(state.tradability.eligible).toBe(false);
    expect(state.tradability.reason).toBe(EXCLUSION_REASONS.NOT_YET_LISTED);
  });

  it("已退市（master 时间界）→ DELISTED + 不可交易 + 无生效代码", () => {
    const input = fullInput({
      security: security({ status: "delisted", delistedDate: "2025-05-30" }),
      identifiers: [identifier({ effectiveTo: "2025-05-30" })],
      priceBar: null,
      liquidity: null,
    });
    const state = resolveSecurityHistoricalState(input, D);
    expect(state.lifecycle.verdict).toBe("DELISTED");
    expect(state.tradability.eligible).toBe(false);
    expect(state.tradability.reason).toBe(EXCLUSION_REASONS.DELISTED);
    expect(state.identity.code).toBeNull();
  });

  it("停牌 → 不可交易 reason=SUSPENDED，但 ST 维度不影响可交易", () => {
    const input = fullInput({
      statusIntervals: [
        ...tradableIntervals(),
        status({ statusType: "SUSPENSION", statusValue: "SUSPENDED", effectiveFrom: "2025-06-02" }),
        status({ statusType: "ST", statusValue: "ST", effectiveFrom: "2020-01-01" }),
      ],
    });
    const state = resolveSecurityHistoricalState(input, D);
    expect(state.tradability.eligible).toBe(false);
    expect(state.tradability.reason).toBe(EXCLUSION_REASONS.SUSPENDED);
    expect(state.tradability.st).toBe("ST");
  });

  it("状态维度全部缺失 → 默认拒绝（TRADING_UNKNOWN），不默认为可交易", () => {
    const state = resolveSecurityHistoricalState(fullInput({ statusIntervals: [] }), D);
    expect(state.tradability.eligible).toBe(false);
    expect(state.tradability.reason).toBe(EXCLUSION_REASONS.TRADING_UNKNOWN);
    expect(state.knowledge.dimensions.tradability).toBe("UNKNOWN");
  });
});

describe("STEP 12.5 — PIT 无未来泄漏（asOf）", () => {
  it("公司行为：仅 announcementDate <= asOf 的事件可知；全知视角不过滤", () => {
    const future = ca({ effectiveDate: D, announcementDate: "2025-06-10" }); // asOf=D 时尚不可知
    const past = ca({ effectiveDate: D, announcementDate: "2025-05-20" });
    const input = fullInput({ corporateActions: [future, past] });

    const pit = resolveSecurityHistoricalState(input, D, { asOf: D });
    expect(pit.corporateActions.policy).toBe("PIT");
    expect(pit.corporateActions.effectiveOnOrBefore).toHaveLength(2);
    expect(pit.corporateActions.knownAtAsOf).toHaveLength(1);
    expect(pit.corporateActions.knownAtAsOf[0]!.announcementDate).toBe("2025-05-20");

    const full = resolveSecurityHistoricalState(input, D); // asOf=null
    expect(full.corporateActions.policy).toBe("FULL_KNOWLEDGE");
    expect(full.corporateActions.knownAtAsOf).toHaveLength(2);
  });

  it("公司行为：未来才生效的事件不计入 effectiveOnOrBefore", () => {
    const later = ca({ effectiveDate: "2025-06-20", announcementDate: "2025-06-10" });
    const state = resolveSecurityHistoricalState(fullInput({ corporateActions: [later] }), D);
    expect(state.corporateActions.effectiveOnOrBefore).toEqual([]);
  });

  it("公司行为：announcementDate 缺失 → 保守视为不可知（PIT）", () => {
    const noAnnounce = ca({ announcementDate: null });
    const state = resolveSecurityHistoricalState(fullInput({ corporateActions: [noAnnounce] }), D, {
      asOf: D,
    });
    expect(state.corporateActions.knownAtAsOf).toEqual([]);
  });

  it("行业：retrievedAt 晚于 asOf 的归属不可见（禁止晚取数据回填历史）", () => {
    const lateIndustry = industryAssignment({ retrievedAt: "2025-06-10T00:00:00.000Z" });
    const input = fullInput({ industryAssignments: [lateIndustry] });

    const pit = resolveSecurityHistoricalState(input, D, { asOf: "2025-06-05" });
    expect(pit.industry).toBeNull();
    expect(pit.knowledge.dimensions.industry).toBe("UNKNOWN");

    const afterFetch = resolveSecurityHistoricalState(input, D, { asOf: "2025-06-10" });
    expect(afterFetch.industry?.industryName).toBe("银行");
    expect(afterFetch.knowledge.dimensions.industry).toBe("KNOWN");
  });

  it("状态 T+1：asOf 早于可知日 → 退市信息不可见（周五生效的 T+1 是周一）", () => {
    // DELISTING=DELISTED 自 2025-06-05（周四）生效，availability=T_PLUS_1 → 可知日 = 下一交易日 2025-06-06（周五）
    const input = fullInput({
      statusIntervals: [
        ...tradableIntervals(),
        status({
          statusType: "DELISTING",
          statusValue: "DELISTED",
          effectiveFrom: "2025-06-05",
          availability: "T_PLUS_1",
        }),
      ],
    });

    // asOf = 2025-06-05（尚未到可知日）→ 仍视为正常上市
    const hidden = resolveSecurityHistoricalState(input, "2025-06-05", { asOf: "2025-06-05", calendar: CAL });
    expect(hidden.tradability.eligible).toBe(true);
    expect(hidden.lifecycle.verdict).toBe("LISTED");
    expect(hidden.knowledge.dimensions.delisting).toBe("UNKNOWN");

    // asOf = 2025-06-06（可知日）→ 退市信息可见
    const visible = resolveSecurityHistoricalState(input, "2025-06-05", { asOf: "2025-06-06", calendar: CAL });
    expect(visible.tradability.eligible).toBe(false);
    expect(visible.tradability.reason).toBe(EXCLUSION_REASONS.DELISTING_DELISTED);
    expect(visible.lifecycle.verdict).toBe("DELISTED");
    expect(visible.knowledge.dimensions.delisting).toBe("KNOWN");
  });
});

describe("STEP 12.5 — 行业数据质量与 code 键守卫", () => {
  it("行业区间重叠 → 抛错（禁止静默挑选）", () => {
    const input = fullInput({
      industryAssignments: [
        industryAssignment(),
        industryAssignment({ effectiveFrom: "2021-01-01", industryName: "错误重叠" }),
      ],
    });
    expect(() => resolveSecurityHistoricalState(input, D)).toThrow(/歧义|重叠/);
  });

  it("priceBar/liquidity 代码与生效代码不一致 → 抛错（禁止静默错配）", () => {
    expect(() =>
      resolveSecurityHistoricalState(fullInput({ priceBar: priceBar({ symbol: "600999.SH" }) }), D),
    ).toThrow(/不一致/);

    expect(() =>
      resolveSecurityHistoricalState(fullInput({ liquidity: liquidity({ securityId: "600999.SH" }) }), D),
    ).toThrow(/不一致/);

    // 无生效代码却传入日级数据 → 同样拒绝
    expect(() =>
      resolveSecurityHistoricalState(
        fullInput({ identifiers: [], priceBar: priceBar() }),
        D,
      ),
    ).toThrow(/不一致/);
  });

  it("无生效代码且未提供 code 键数据 → 不报错，identity.code=null", () => {
    const state = resolveSecurityHistoricalState(
      fullInput({ identifiers: [], priceBar: null, liquidity: null }),
      D,
    );
    expect(state.identity.code).toBeNull();
    expect(state.industry).toBeNull();
    expect(state.price).toBeNull();
    expect(state.liquidity).toBeNull();
  });
});

describe("STEP 12.5 — 确定性排序", () => {
  it("市场状态按 indexCode 升序；公司行为按 (effectiveDate, type, announcement) 确定性排序", () => {
    const input = fullInput({
      indexBars: [
        indexBar({ indexCode: "399006.SZ", close: 3000 }),
        indexBar(),
        indexBar({ indexCode: "000001.SH", close: 3200 }),
      ],
      corporateActions: [
        ca({ actionType: "dividend", effectiveDate: D }),
        ca({ actionType: "bonus_issue", effectiveDate: D }),
        ca({ actionType: "transfer", effectiveDate: "2025-05-20" }),
      ],
    });
    const state = resolveSecurityHistoricalState(input, D);
    expect(state.marketState.map((entry) => entry.indexCode)).toEqual([
      "000001.SH",
      "000300.SH",
      "399006.SZ",
    ]);
    expect(state.corporateActions.effectiveOnOrBefore.map((action) => action.actionType)).toEqual([
      "transfer",
      "bonus_issue",
      "dividend",
    ]);
  });
});

describe("STEP 12.5 — 标识符解析与 code 归属（防代码复用）", () => {
  const idA = identifier(); // S1 拥有 600000 自 2020
  const idB = identifier({ securityId: S2, code: "600000", effectiveFrom: "2010-01-01", effectiveTo: "2019-12-31" }); // 他人早期持有同 code

  it("resolveActiveIdentifierAt 优先 primary；无生效标识符返回 null", () => {
    const history = [
      idA,
      identifier({ identifierType: "sina_symbol", effectiveFrom: "2021-01-01" }),
    ];
    expect(resolveActiveIdentifierAt(history, S1, D)?.code).toBe("600000");
    expect(resolveActiveIdentifierAt(history, S2, D)).toBeNull();
  });

  it("isCodeOwnedBySecurityAt：同一 code 在不同时间段归属不同 security", () => {
    expect(isCodeOwnedBySecurityAt([idA, idB], S2, "600000", "SH", "2015-06-01")).toBe(true);
    expect(isCodeOwnedBySecurityAt([idA, idB], S2, "600000", "SH", D)).toBe(false); // 他人区间已结束
    expect(isCodeOwnedBySecurityAt([idA, idB], S1, "600000", "SH", D)).toBe(true);
  });

  it("isCodeIntervalOwnedBySecurity：区间型归属按重叠判定", () => {
    expect(isCodeIntervalOwnedBySecurity([idA, idB], S2, "600000", "SH", "2015-01-01", "2016-12-31")).toBe(true);
    expect(isCodeIntervalOwnedBySecurity([idA, idB], S2, "600000", "SH", D, null)).toBe(false);
  });
});
