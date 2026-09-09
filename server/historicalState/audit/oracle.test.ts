/**
 * STEP 12.5 — PIT / 反泄漏抽样审计：朴素预言机单元测试。
 *
 * 验证预言机（独立于 reconstruct 语义）在合成事实上的期望判定：
 *   身份区间 / master 生命周期 / CA announcementDate PIT / 行业 retrievedAt PIT /
 *   归属过滤（代码复用第二主体不得串入）。全部纯内存、确定性、无 IO。
 */

import { describe, expect, it } from "vitest";
import type { CorporateAction } from "../../corporateActions/types";
import type { IndustryAssignment } from "../../marketData/types";
import type { Security, SecurityIdentifier } from "../../security/types";
import type { SecurityStatusInterval, StatusType } from "../../securityStatus/types";
import type { PitAuditFacts } from "./types";
import {
  naiveActiveCode,
  naiveActiveIdentifierAt,
  naiveEffectiveCaKeys,
  naiveIdentityExpectation,
  naiveIndustryAt,
  naiveKnownCaKeys,
  naiveLifecycleExpectation,
} from "./oracle";

const S1 = "sec_00000000-0000-4000-8000-000000000001";
const D = "2025-06-03"; // 基准交易日

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

function statusInterval(
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

function industry(overrides: Partial<IndustryAssignment> = {}): IndustryAssignment {
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

function action(overrides: Partial<CorporateAction> = {}): CorporateAction {
  return {
    securityId: S1,
    securityCode: "600000.SH",
    actionType: "dividend",
    effectiveDate: "2025-05-30",
    recordDate: null,
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

function facts(overrides: Partial<PitAuditFacts> = {}): PitAuditFacts {
  return {
    security: security(),
    identifiers: [identifier()],
    statusIntervals: [],
    industryRows: [],
    caRows: [],
    priceBar: null,
    liquidity: null,
    indexBars: [],
    coreIndexCodes: [],
    ...overrides,
  };
}

describe("oracle.naiveActiveIdentifierAt", () => {
  it("primary 优先：生效区间内返回 primary", () => {
    const ids = [
      identifier({ identifierType: "sina_symbol", effectiveFrom: "2020-01-01" }),
      identifier({ identifierType: "primary", effectiveFrom: "2020-06-01" }),
    ];
    const active = naiveActiveIdentifierAt(ids, S1, D);
    expect(active?.code).toBe("600000");
    expect(active?.identifierType).toBe("primary");
  });

  it("无 primary 时取别名；区间外为 null", () => {
    const ids = [identifier({ identifierType: "sina_symbol" })];
    expect(naiveActiveIdentifierAt(ids, S1, D)?.identifierType).toBe("sina_symbol");
    expect(naiveActiveIdentifierAt(ids, S1, "2019-06-03")).toBeNull();
  });

  it("code 为 6 位、canonical 拼接正确", () => {
    expect(naiveActiveCode([identifier()], S1, D)).toBe("600000.SH");
    expect(naiveActiveCode([identifier()], S1, "2019-06-03")).toBeNull();
  });

  it("identity 期望字段透传区间与类型", () => {
    const expected = naiveIdentityExpectation([identifier()], S1, D);
    expect(expected).toEqual({
      codeDigits: "600000",
      code: "600000.SH",
      identifierType: "primary",
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
    });
  });
});

describe("oracle.naiveLifecycleExpectation", () => {
  it("master 时间界判词：未上市 / 上市中 / 已退市 / 未知", () => {
    expect(naiveLifecycleExpectation(security({ listedDate: "2025-06-10" }), D)).toBe("NOT_YET_LISTED");
    expect(naiveLifecycleExpectation(security(), D)).toBe("LISTED");
    expect(
      naiveLifecycleExpectation(security({ delistedDate: "2025-05-30" }), D),
    ).toBe("DELISTED");
    // 退市日当天仍视为 LISTED（闭区间语义）。
    expect(
      naiveLifecycleExpectation(security({ delistedDate: "2025-06-03" }), D),
    ).toBe("LISTED");
    expect(naiveLifecycleExpectation(security({ listedDate: null }), D)).toBe("UNKNOWN");
  });
});

describe("oracle CA PIT（announcementDate）", () => {
  it("已生效集合：effectiveDate<=T 且生效日代码归本 security", () => {
    const base = facts({ caRows: [action()] });
    expect(Array.from(naiveEffectiveCaKeys(base, D))).toEqual(["600000.SH|2025-05-30|dividend"]);

    // effectiveDate 晚于 T → 不在生效集。
    const late = facts({ caRows: [action({ effectiveDate: "2025-06-05" })] });
    expect(Array.from(naiveEffectiveCaKeys(late, D))).toEqual([]);
  });

  it("代码复用：生效日不属于本主体的行为不得计入（跨主体防串扰）", () => {
    // owner B 从 2024-06-01 起才拥有 600000.SH；行为生效日 2024-01-10 属 owner A。
    const ownerB = identifier({ effectiveFrom: "2024-06-01" });
    const crossOwner = facts({ identifiers: [ownerB], caRows: [action({ effectiveDate: "2024-01-10" })] });
    expect(Array.from(naiveEffectiveCaKeys(crossOwner, "2025-01-15"))).toEqual([]);

    // 属于 owner B 期间的生效行为 → 计入。
    const owned = facts({ identifiers: [ownerB], caRows: [action({ effectiveDate: "2024-07-10" })] });
    expect(Array.from(naiveEffectiveCaKeys(owned, "2025-01-15"))).toHaveLength(1);
  });

  it("可知集合：announcementDate<=asOf；缺失公告保守不可知；asOf=null 全知=生效集", () => {
    const base = facts({
      caRows: [
        action({ actionType: "dividend", effectiveDate: "2025-05-30", announcementDate: "2025-05-20" }),
        action({ actionType: "transfer", effectiveDate: "2025-05-30", announcementDate: "2025-06-10" }), // 未来公告
        action({ actionType: "bonus_issue", effectiveDate: "2025-05-30", announcementDate: null }), // 缺公告
      ],
    });
    const known = Array.from(naiveKnownCaKeys(base, D, D)).sort();
    expect(known).toEqual(["600000.SH|2025-05-30|dividend"]);

    // asOf 覆盖到未来公告日后 → 该事件可知。
    expect(Array.from(naiveKnownCaKeys(base, D, "2025-06-10"))).toHaveLength(2);

    // 全知视角 → 已生效事件全部「可知」（公告缺失也计入，因为不使用 announcement 过滤）。
    expect(Array.from(naiveKnownCaKeys(base, D, null))).toHaveLength(3);
  });
});

describe("oracle 行业 PIT（retrievedAt）", () => {
  it("retrievedAt<=asOf 才可用；无行→none；重叠→overlap", () => {
    const single = facts({ industryRows: [industry()] }); // retrievedAt 2020-01-01 <= D
    const result = naiveIndustryAt(single, D, D);
    expect(result.kind).toBe("single");
    expect(result.assignment?.industryCode).toBe("801780");
    expect(result.guardExercised).toBe(false);

    const overlap = facts({
      industryRows: [industry(), industry({ industryCode: "801010" })],
    });
    expect(naiveIndustryAt(overlap, D, D).kind).toBe("overlap");
  });

  it("未来回填（retrievedAt>asOf）→ none 且触发 PIT 护栏；asOf=null 全知可见", () => {
    const late = facts({ industryRows: [industry({ retrievedAt: "2026-09-06T00:00:00.000Z" })] });
    const pitView = naiveIndustryAt(late, D, D); // asOf=2025-06-03 < retrieved 2026-09-06
    expect(pitView.kind).toBe("none");
    expect(pitView.guardExercised).toBe(true);

    const fullView = naiveIndustryAt(late, D, null);
    expect(fullView.kind).toBe("single");
  });

  it("区间不覆盖 tradeDate → none（未来才开始生效的行业不得回填过去）", () => {
    const future = facts({
      industryRows: [industry({ effectiveFrom: "2026-08-31" })],
    });
    const result = naiveIndustryAt(future, D, null);
    expect(result.kind).toBe("none");
  });

  it("行业归属代码拥有区间过滤：第二主体不得使用他人区间", () => {
    // owner B 自 2024-06-01 拥有 600000.SH；行业行区间 2020-01-01..2024-05-31 属 owner A。
    const ownerB = identifier({ effectiveFrom: "2024-06-01" });
    const rows = facts({
      identifiers: [ownerB],
      industryRows: [industry({ effectiveTo: "2024-05-31" })],
    });
    const result = naiveIndustryAt(rows, "2024-07-10", "2024-07-10");
    expect(result.kind).toBe("none");
  });
});
