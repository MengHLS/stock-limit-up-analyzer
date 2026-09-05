/**
 * STEP 11 / Work C — Historical Tradable Universe 集成测试。
 * 覆盖任务要求的 15 项必需用例 + 确定性排序 + PIT（含 calendar 感知 T+1）+ default deny。
 * 全部纯内存、确定性、无网络/时间/随机。
 */

import { describe, expect, it } from "vitest";
import { buildTradingCalendar } from "./tradingCalendar";
import {
  EXCLUSION_REASONS,
  getHistoricalTradableSecurityIds,
  getHistoricalTradableUniverse,
  resolveHistoricalUniverse,
  type HistoricalUniverseInput,
} from "./historicalUniverse";
import { statusKnowledgeDate } from "../securityStatus/pointInTime";
import type { Security, SecurityIdentifier } from "./types";
import type { SecurityStatusInterval, StatusType } from "../securityStatus/types";

const S1 = "sec_00000000-0000-4000-8000-000000000001";
const S2 = "sec_00000000-0000-4000-8000-000000000002";
const S3 = "sec_00000000-0000-4000-8000-000000000003";

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
    securityId: string;
    statusType: StatusType;
    statusValue: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
  },
): SecurityStatusInterval {
  return {
    effectiveTo: null,
    source: "test",
    retrievedAt: null,
    confidence: "high",
    availability: "IMMEDIATE",
    ...overrides,
  };
}

/** 正常上市且可交易的证券（LISTING=LISTED + TRADING=TRADING）。 */
function tradableIntervals(securityId: string, listedFrom = "2020-01-01"): SecurityStatusInterval[] {
  return [
    status({ securityId, statusType: "LISTING", statusValue: "LISTED", effectiveFrom: listedFrom }),
    status({ securityId, statusType: "TRADING", statusValue: "TRADING", effectiveFrom: listedFrom }),
  ];
}

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

function input(overrides: Partial<HistoricalUniverseInput> = {}): HistoricalUniverseInput {
  return {
    securities: [],
    identifiers: [],
    statusIntervals: [],
    calendar: CAL,
    ...overrides,
  };
}

function ids(members: { securityId: string }[]): string[] {
  return members.map((m) => m.securityId);
}

describe("Historical Tradable Universe — 必需用例", () => {
  it("案例1：尚未上市 → 剔除 NOT_YET_LISTED", () => {
    const sec = security({ securityId: S1, listedDate: "2025-06-01" });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1, effectiveFrom: "2025-06-01" })],
      statusIntervals: tradableIntervals(S1, "2025-06-01"),
    });
    const result = resolveHistoricalUniverse(uni, "2025-05-01");
    expect(result.members).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]!.reason).toBe(EXCLUSION_REASONS.NOT_YET_LISTED);
  });

  it("案例2：正常上市 → 成员", () => {
    const sec = security({ securityId: S1, listedDate: "2020-01-01" });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1, effectiveFrom: "2020-01-01" })],
      statusIntervals: tradableIntervals(S1),
    });
    const result = resolveHistoricalUniverse(uni, "2025-03-01");
    expect(ids(result.members)).toEqual([S1]);
    expect(result.excluded).toHaveLength(0);
  });

  it("案例3：已退市 → 剔除 DELISTED", () => {
    const sec = security({ securityId: S1, listedDate: "2015-01-01", delistedDate: "2024-12-31", status: "delisted" });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1, effectiveFrom: "2015-01-01", effectiveTo: "2024-12-31" })],
      statusIntervals: tradableIntervals(S1, "2015-01-01"),
    });
    expect(resolveHistoricalUniverse(uni, "2025-01-01").members).toHaveLength(0);
    expect(resolveHistoricalUniverse(uni, "2025-01-01").excluded[0]!.reason).toBe(EXCLUSION_REASONS.DELISTED);
    // 退市当日（最后一个可交易日，含）仍为成员。
    expect(ids(resolveHistoricalUniverse(uni, "2024-12-31").members)).toEqual([S1]);
  });

  it("案例4：暂停交易 → 剔除 SUSPENDED", () => {
    const sec = security({ securityId: S1 });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1 })],
      statusIntervals: [
        ...tradableIntervals(S1),
        status({ securityId: S1, statusType: "SUSPENSION", statusValue: "SUSPENDED", effectiveFrom: "2025-05-01", effectiveTo: "2025-05-10" }),
      ],
    });
    expect(resolveHistoricalUniverse(uni, "2025-05-05").members).toHaveLength(0);
    expect(resolveHistoricalUniverse(uni, "2025-05-05").excluded[0]!.reason).toBe(EXCLUSION_REASONS.SUSPENDED);
  });

  it("案例5：恢复交易 → 成员", () => {
    const sec = security({ securityId: S1 });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1 })],
      statusIntervals: [
        ...tradableIntervals(S1),
        status({ securityId: S1, statusType: "SUSPENSION", statusValue: "SUSPENDED", effectiveFrom: "2025-05-01", effectiveTo: "2025-05-10" }),
      ],
    });
    expect(ids(resolveHistoricalUniverse(uni, "2025-05-11").members)).toEqual([S1]);
  });

  it("案例6：ST → 仍可交易（信息维度，不阻断），st=ST", () => {
    const sec = security({ securityId: S1 });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1 })],
      statusIntervals: [
        ...tradableIntervals(S1),
        status({ securityId: S1, statusType: "ST", statusValue: "ST", effectiveFrom: "2025-01-01" }),
      ],
    });
    const result = resolveHistoricalUniverse(uni, "2025-03-01");
    expect(ids(result.members)).toEqual([S1]);
    expect(result.members[0]!.st).toBe("ST");
  });

  it("案例7：*ST → 仍可交易，st=*ST", () => {
    const sec = security({ securityId: S1 });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1 })],
      statusIntervals: [
        ...tradableIntervals(S1),
        status({ securityId: S1, statusType: "ST", statusValue: "*ST", effectiveFrom: "2025-01-01" }),
      ],
    });
    const result = resolveHistoricalUniverse(uni, "2025-03-01");
    expect(ids(result.members)).toEqual([S1]);
    expect(result.members[0]!.st).toBe("*ST");
  });

  it("案例8：suspension UNKNOWN → 不阻断（负向维度，无停牌即放行）", () => {
    const sec = security({ securityId: S1 });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1 })],
      statusIntervals: tradableIntervals(S1), // 无 SUSPENSION 记录
    });
    const result = resolveHistoricalUniverse(uni, "2025-03-01");
    expect(ids(result.members)).toEqual([S1]);
    expect(result.members[0]!.snapshot.unknownDimensions).toContain("SUSPENSION");
  });

  it("案例9：status UNKNOWN（无任何状态）→ 剔除 TRADING_UNKNOWN（default deny）", () => {
    const sec = security({ securityId: S1 });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1 })],
      statusIntervals: [], // 完全无状态
    });
    const result = resolveHistoricalUniverse(uni, "2025-03-01");
    expect(result.members).toHaveLength(0);
    expect(result.excluded[0]!.reason).toBe(EXCLUSION_REASONS.TRADING_UNKNOWN);
  });

  it("案例10：security code reuse — 同代码不同 security 按日期正确解析，不混淆", () => {
    const oldSec = security({ securityId: S1, exchange: "SZ", listedDate: "2010-01-01", delistedDate: "2020-12-31", status: "delisted" });
    const newSec = security({ securityId: S2, exchange: "SZ", listedDate: "2022-06-01" });
    const uni = input({
      securities: [oldSec, newSec],
      identifiers: [
        identifier({ securityId: S1, exchange: "SZ", code: "000777", effectiveFrom: "2010-01-01", effectiveTo: "2020-12-31" }),
        identifier({ securityId: S2, exchange: "SZ", code: "000777", effectiveFrom: "2022-06-01" }),
      ],
      statusIntervals: [
        ...tradableIntervals(S1, "2010-01-01"),
        ...tradableIntervals(S2, "2022-06-01"),
      ],
    });
    expect(ids(resolveHistoricalUniverse(uni, "2015-01-01").members)).toEqual([S1]);
    expect(ids(resolveHistoricalUniverse(uni, "2023-01-01").members)).toEqual([S2]);
    // 代码复用区间之间（退市后、再上市前）两者皆不可交易。
    expect(resolveHistoricalUniverse(uni, "2021-06-01").members).toHaveLength(0);
  });

  it("案例11：identifier history — 同一 security 换代码仍为同一 security_id", () => {
    const sec = security({ securityId: S1, exchange: "SZ" });
    const uni = input({
      securities: [sec],
      identifiers: [
        identifier({ securityId: S1, exchange: "SZ", code: "000001", effectiveFrom: "2015-06-01", effectiveTo: "2024-02-29" }),
        identifier({ securityId: S1, exchange: "SZ", code: "000002", effectiveFrom: "2024-03-01" }),
      ],
      statusIntervals: tradableIntervals(S1, "2015-06-01"),
    });
    const before = resolveHistoricalUniverse(uni, "2023-12-31");
    const after = resolveHistoricalUniverse(uni, "2024-03-01");
    expect(before.members[0]!.securityId).toBe(S1);
    expect(before.members[0]!.code).toBe("000001");
    expect(after.members[0]!.securityId).toBe(S1);
    expect(after.members[0]!.code).toBe("000002");
  });

  it("案例12：delisted stock — 历史日期可交易，退市后剔除（survivorship-safe）", () => {
    const sec = security({ securityId: S1, exchange: "SZ", listedDate: "2012-01-01", delistedDate: "2019-12-31", status: "delisted" });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1, exchange: "SZ", code: "000999", effectiveFrom: "2012-01-01", effectiveTo: "2019-12-31" })],
      statusIntervals: tradableIntervals(S1, "2012-01-01"),
    });
    expect(ids(resolveHistoricalUniverse(uni, "2018-06-01").members)).toEqual([S1]);
    expect(resolveHistoricalUniverse(uni, "2023-01-01").members).toHaveLength(0);
  });

  it("案例13：historical date — 历史 universe ≠ 当前 universe", () => {
    const delisted = security({ securityId: S1, exchange: "SH", listedDate: "2010-01-01", delistedDate: "2020-12-31", status: "delisted" });
    const current = security({ securityId: S2, exchange: "SZ", listedDate: "2021-01-01" });
    const uni = input({
      securities: [delisted, current],
      identifiers: [
        identifier({ securityId: S1, exchange: "SH", code: "600001", effectiveFrom: "2010-01-01", effectiveTo: "2020-12-31" }),
        identifier({ securityId: S2, exchange: "SZ", code: "000002", effectiveFrom: "2021-01-01" }),
      ],
      statusIntervals: [...tradableIntervals(S1, "2010-01-01"), ...tradableIntervals(S2, "2021-01-01")],
    });
    const historical = ids(resolveHistoricalUniverse(uni, "2019-01-01").members);
    const now = ids(resolveHistoricalUniverse(uni, "2024-01-01").members);
    expect(historical).toEqual([S1]);
    expect(now).toEqual([S2]);
    expect(historical).not.toEqual(now);
  });

  it("案例14：asOf — 未来才可知的退市不泄漏到过去（T+1 + calendar）", () => {
    // LISTING=DELISTED 于周五生效，T+1 才可知（下一交易日 = 周一 2025-06-09）。
    const sec = security({ securityId: S1, listedDate: "2020-01-01", delistedDate: null });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1 })],
      statusIntervals: [
        status({ securityId: S1, statusType: "TRADING", statusValue: "TRADING", effectiveFrom: "2020-01-01" }),
        status({ securityId: S1, statusType: "LISTING", statusValue: "DELISTED", effectiveFrom: "2025-06-06", availability: "T_PLUS_1" }),
      ],
    });
    // asOf=生效当日：退市尚不可知 → 仍可交易。
    expect(ids(resolveHistoricalUniverse(uni, "2025-06-06", { asOf: "2025-06-06" }).members)).toEqual([S1]);
    // asOf=下一交易日：退市可知 → 剔除。
    expect(resolveHistoricalUniverse(uni, "2025-06-06", { asOf: "2025-06-09" }).members).toHaveLength(0);
    // asOf=null（全知）→ 剔除。
    expect(resolveHistoricalUniverse(uni, "2025-06-06").members).toHaveLength(0);
  });

  it("案例15：security isolation — 状态互不串扰", () => {
    const a = security({ securityId: S1, exchange: "SH", listedDate: "2020-01-01" });
    const b = security({ securityId: S2, exchange: "SZ", listedDate: "2020-01-01" });
    const uni = input({
      securities: [a, b],
      identifiers: [
        identifier({ securityId: S1, exchange: "SH", code: "600001", effectiveFrom: "2020-01-01" }),
        identifier({ securityId: S2, exchange: "SZ", code: "000001", effectiveFrom: "2020-01-01" }),
      ],
      statusIntervals: [
        ...tradableIntervals(S1),
        ...tradableIntervals(S2),
        // 仅 S1 停牌。
        status({ securityId: S1, statusType: "SUSPENSION", statusValue: "SUSPENDED", effectiveFrom: "2025-05-01", effectiveTo: "2025-05-10" }),
      ],
    });
    const result = resolveHistoricalUniverse(uni, "2025-05-05");
    expect(ids(result.members)).toEqual([S2]); // 只有 S2 可交易
    expect(result.excluded.map((e) => e.securityId)).toEqual([S1]);
    expect(result.excluded[0]!.reason).toBe(EXCLUSION_REASONS.SUSPENDED);
  });
});

describe("边界与确定性", () => {
  it("上市边界：listedDate 当日（含）即成员，前一日剔除", () => {
    const sec = security({ securityId: S1, listedDate: "2025-01-15" });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1, effectiveFrom: "2025-01-15" })],
      statusIntervals: tradableIntervals(S1, "2025-01-15"),
    });
    expect(ids(resolveHistoricalUniverse(uni, "2025-01-15").members)).toEqual([S1]);
    expect(resolveHistoricalUniverse(uni, "2025-01-14").excluded[0]!.reason).toBe(EXCLUSION_REASONS.NOT_YET_LISTED);
  });

  it("退市边界：delistedDate 当日（含）即成员，次一日剔除", () => {
    const sec = security({ securityId: S1, listedDate: "2015-01-01", delistedDate: "2025-06-30" });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1, effectiveFrom: "2015-01-01", effectiveTo: "2025-06-30" })],
      statusIntervals: tradableIntervals(S1, "2015-01-01"),
    });
    expect(ids(resolveHistoricalUniverse(uni, "2025-06-30").members)).toEqual([S1]);
    expect(resolveHistoricalUniverse(uni, "2025-07-01").excluded[0]!.reason).toBe(EXCLUSION_REASONS.DELISTED);
  });

  it("LISTING UNKNOWN：无 listedDate 且 LISTING 维度缺失 → 剔除 LISTING_UNKNOWN", () => {
    const sec = security({ securityId: S1, listedDate: null });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1 })],
      statusIntervals: [status({ securityId: S1, statusType: "TRADING", statusValue: "TRADING", effectiveFrom: "2020-01-01" })],
    });
    expect(resolveHistoricalUniverse(uni, "2025-03-01").excluded[0]!.reason).toBe(EXCLUSION_REASONS.LISTING_UNKNOWN);
  });

  it("无生效标识符 → 剔除 NO_ACTIVE_IDENTIFIER", () => {
    const sec = security({ securityId: S1 });
    const uni = input({
      securities: [sec],
      identifiers: [], // 无任何标识符
      statusIntervals: tradableIntervals(S1),
    });
    expect(resolveHistoricalUniverse(uni, "2025-03-01").excluded[0]!.reason).toBe(EXCLUSION_REASONS.NO_ACTIVE_IDENTIFIER);
  });

  it("确定性排序：按 exchange → code → securityId", () => {
    const sh = security({ securityId: S1, exchange: "SH", listedDate: "2020-01-01" });
    const sz = security({ securityId: S2, exchange: "SZ", listedDate: "2020-01-01" });
    const sz2 = security({ securityId: S3, exchange: "SZ", listedDate: "2020-01-01" });
    const uni = input({
      securities: [sz2, sh, sz], // 乱序输入
      identifiers: [
        identifier({ securityId: S1, exchange: "SH", code: "600000", effectiveFrom: "2020-01-01" }),
        identifier({ securityId: S2, exchange: "SZ", code: "000001", effectiveFrom: "2020-01-01" }),
        identifier({ securityId: S3, exchange: "SZ", code: "000002", effectiveFrom: "2020-01-01" }),
      ],
      statusIntervals: [...tradableIntervals(S1), ...tradableIntervals(S2), ...tradableIntervals(S3)],
    });
    const members = resolveHistoricalUniverse(uni, "2025-03-01").members;
    // SH 在前；SZ 内按 code 000001 < 000002。
    expect(members.map((m) => m.securityId)).toEqual([S1, S2, S3]);
  });

  it("getHistoricalTradableSecurityIds 返回确定性有序 id 列表", () => {
    const sec = security({ securityId: S1 });
    const uni = input({
      securities: [sec],
      identifiers: [identifier({ securityId: S1 })],
      statusIntervals: tradableIntervals(S1),
    });
    expect(getHistoricalTradableSecurityIds(uni, "2025-03-01")).toEqual([S1]);
    expect(getHistoricalTradableUniverse(uni, "2025-03-01").map((m) => m.securityId)).toEqual([S1]);
  });

  it("isTradingDay 与 T+1 交易日语义", () => {
    expect(CAL.isTradingDay("2025-06-06")).toBe(true);
    expect(CAL.isTradingDay("2025-06-07")).toBe(false); // 周六
    expect(CAL.nextTradingDay("2025-06-06")).toBe("2025-06-09"); // 跳过周末
    expect(CAL.previousTradingDay("2025-06-09")).toBe("2025-06-06");
    expect(CAL.nextTradingDay("2025-06-13")).toBeNull();
    expect(CAL.previousTradingDay("2025-06-02")).toBeNull();
  });

  it("calendar 感知 T+1：状态知识日用下一交易日而非 calendar+1", () => {
    const interval = status({
      securityId: S1,
      statusType: "ST",
      statusValue: "ST",
      effectiveFrom: "2025-06-06", // 周五
      availability: "T_PLUS_1",
    });
    // 无 calendar：fail-safe 返回 null（禁止退回自然日 calendar+1）。
    expect(statusKnowledgeDate(interval)).toBeNull();
    // 有 calendar：下一交易日 = 周一 06-09。
    expect(statusKnowledgeDate(interval, CAL)).toBe("2025-06-09");
  });
});

