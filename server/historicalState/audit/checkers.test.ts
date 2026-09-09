/**
 * STEP 12.5 — PIT / 反泄漏抽样审计：纯检查器单元测试。
 *
 * 验证 runSampleChecks 能检出各类反泄漏违规（对「重建状态」做篡改模拟回归缺陷）：
 *   干净基线 → 0 FAIL；身份错配 / master 生命周期错配 / 退市后可交易 /
 *   行业未来回填泄漏 / 行业遗漏 / CA 未来公告 look-ahead / CA 遗漏 / CA 已生效多装 /
 *   价格日期错位 / 市场状态集缺失 / 可知性标记矛盾 / PIT 维度倒退（asOf 增大反而丢失）。
 * 全部纯内存、确定性、无 IO。
 */

import { describe, expect, it } from "vitest";
import type { CorporateAction } from "../../corporateActions/types";
import type { CanonicalMarketBar } from "../../data/types";
import type { IndustryAssignment, IndexDailyBar, LiquidityDaily } from "../../marketData/types";
import type { Security, SecurityIdentifier } from "../../security/types";
import type { SecurityStatusInterval, StatusType } from "../../securityStatus/types";
import { resolveSecurityHistoricalState } from "../reconstruct";
import type { HistoricalStateInput, SecurityHistoricalState } from "../types";
import { CHECK_IDS, runSampleChecks } from "./checkers";
import type { PitAuditFacts, PitAuditSample, PitSampleVerdict } from "./types";

const S1 = "sec_00000000-0000-4000-8000-000000000001";
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

function tradableIntervals(): SecurityStatusInterval[] {
  return [
    status({ statusType: "LISTING", statusValue: "LISTED", effectiveFrom: "2020-01-01" }),
    status({ statusType: "TRADING", statusValue: "TRADING", effectiveFrom: "2020-01-01" }),
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

function ca(overrides: Partial<CorporateAction> = {}): CorporateAction {
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

function priceBar(overrides: Partial<CanonicalMarketBar> = {}): CanonicalMarketBar {
  return {
    symbol: "600000.SH",
    timestamp: D,
    open: 10,
    high: 10.5,
    low: 9.8,
    close: 10.2,
    preClose: 10,
    volume: 100000,
    amount: 102000,
    turnoverRate: 1.2,
    adjustment: "raw",
    ...overrides,
  };
}

function liquidity(overrides: Partial<LiquidityDaily> = {}): LiquidityDaily {
  return {
    securityId: "600000.SH",
    tradeDate: D,
    turnoverRate: 1.2,
    circulationMarketCap: 2e10,
    totalMarketCap: 3e10,
    amount: 102000,
    volume: 100000,
    source: "test",
    ...overrides,
  };
}

function indexBar(): IndexDailyBar {
  return {
    indexCode: "000300.SH",
    tradeDate: D,
    open: 4000,
    high: 4020,
    low: 3980,
    close: 4010,
    amount: 1e8,
    volume: 1e7,
    source: "test",
  };
}

/** 干净输入：全部维度齐备且无 PIT 冲突。 */
function cleanInput(overrides: Partial<HistoricalStateInput> = {}): HistoricalStateInput {
  return {
    security: security(),
    identifiers: [identifier()],
    statusIntervals: tradableIntervals(),
    industryAssignments: [industryAssignment()],
    priceBar: priceBar(),
    liquidity: liquidity(),
    corporateActions: [ca()],
    indexBars: [indexBar()],
    indexMaster: [{ indexCode: "000300.SH", indexName: "沪深300", provider: "test", providerCode: "000300", firstDate: null, lastDate: null, source: "test", retrievedAt: "2020-01-01T00:00:00.000Z" }],
    ...overrides,
  };
}

/** 与 cleanInput 对齐的独立事实。 */
function cleanFacts(overrides: Partial<PitAuditFacts> = {}): PitAuditFacts {
  return {
    security: security(),
    identifiers: [identifier()],
    statusIntervals: tradableIntervals(),
    industryRows: [industryAssignment()],
    caRows: [ca()],
    priceBar: priceBar(),
    liquidity: liquidity(),
    indexBars: [indexBar()],
    coreIndexCodes: ["000300.SH"],
    ...overrides,
  };
}

function sample(overrides: Partial<PitAuditSample> = {}): PitAuditSample {
  return {
    sampleId: "RANDOM_ACTIVE:t1",
    bucket: "RANDOM_ACTIVE",
    securityId: S1,
    tradeDate: D,
    asOf: D,
    ...overrides,
  };
}

function buildPair(input: HistoricalStateInput): { pit: SecurityHistoricalState; full: SecurityHistoricalState } {
  return {
    pit: resolveSecurityHistoricalState(input, D, { asOf: D }),
    full: resolveSecurityHistoricalState(input, D, { asOf: null }),
  };
}

function issuesOf(input: HistoricalStateInput, facts: PitAuditFacts): PitSampleVerdict {
  return runSampleChecks(sample(), facts, buildPair(input));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("checkers.clean", () => {
  it("干净基线：12 项检查全 PASS、无 FAIL", () => {
    const verdict = issuesOf(cleanInput(), cleanFacts());
    expect(verdict.issues).toEqual([]);
    expect(verdict.industryPitGuardExercised).toBe(false);
  });

  it("退市日之后的样本：master 判 DELISTED、不可交易（survivorship 正向）", () => {
    const input = cleanInput({
      security: security({ status: "delisted", delistedDate: "2025-05-30" }),
      identifiers: [identifier({ effectiveTo: "2025-05-30" })],
      statusIntervals: [],
      industryAssignments: undefined,
      priceBar: null,
      liquidity: null,
      corporateActions: undefined,
      indexBars: [],
      indexMaster: undefined,
    });
    const facts = cleanFacts({
      security: security({ status: "delisted", delistedDate: "2025-05-30" }),
      identifiers: [identifier({ effectiveTo: "2025-05-30" })],
      statusIntervals: [],
      industryRows: [],
      caRows: [],
      priceBar: null,
      liquidity: null,
      indexBars: [],
    });
    const verdict = issuesOf(input, facts);
    expect(verdict.issues).toEqual([]);
  });
});

describe("checkers 泄漏检测（篡改状态模拟回归缺陷）", () => {
  it("IDENTITY_CODE：身份代码被替换", () => {
    const pair = buildPair(cleanInput());
    pair.pit.identity.codeDigits = "999999";
    pair.pit.identity.code = "999999.SH";
    const verdict = runSampleChecks(sample(), cleanFacts(), pair);
    expect(verdict.issues.some((issue) => issue.checkId === "IDENTITY_CODE")).toBe(true);
  });

  it("LIFECYCLE_MASTER：master 已退市但重建判 LISTED", () => {
    const input = cleanInput({
      security: security({ status: "delisted", delistedDate: "2025-05-30" }),
      identifiers: [identifier({ effectiveTo: "2025-05-30" })],
      statusIntervals: [],
      industryAssignments: undefined,
      priceBar: null,
      liquidity: null,
      corporateActions: undefined,
      indexBars: [],
      indexMaster: undefined,
    });
    const facts = cleanFacts({
      security: security({ status: "delisted", delistedDate: "2025-05-30" }),
      identifiers: [identifier({ effectiveTo: "2025-05-30" })],
      statusIntervals: [],
      industryRows: [],
      caRows: [],
      priceBar: null,
      liquidity: null,
      indexBars: [],
    });
    const pair = buildPair(input);
    pair.pit.lifecycle.verdict = "LISTED";
    const verdict = runSampleChecks(sample(), facts, pair);
    expect(verdict.issues.some((issue) => issue.checkId === "LIFECYCLE_MASTER")).toBe(true);
  });

  it("TRADABILITY_MASTER_BOUND：上市前被错误放行为可交易", () => {
    const input = cleanInput({
      security: security({ listedDate: "2025-06-10" }),
      identifiers: [identifier({ effectiveFrom: "2025-06-10" })],
      statusIntervals: [status({ statusType: "TRADING", statusValue: "TRADING", effectiveFrom: "2025-06-10" })],
      industryAssignments: undefined,
      priceBar: null,
      liquidity: null,
      corporateActions: [],
      indexBars: [],
      indexMaster: undefined,
    });
    const facts = cleanFacts({
      security: security({ listedDate: "2025-06-10" }),
      identifiers: [identifier({ effectiveFrom: "2025-06-10" })],
      statusIntervals: [status({ statusType: "TRADING", statusValue: "TRADING", effectiveFrom: "2025-06-10" })],
      industryRows: [],
      caRows: [],
      priceBar: null,
      liquidity: null,
      indexBars: [],
    });
    const pair = buildPair(input);
    pair.pit.tradability.eligible = true;
    const verdict = runSampleChecks(sample(), facts, pair);
    expect(verdict.issues.some((issue) => issue.checkId === "TRADABILITY_MASTER_BOUND")).toBe(true);
  });

  it("INDUSTRY_PIT：未来回填（retrievedAt>asOf）泄漏进重建结果", () => {
    const late = industryAssignment({ retrievedAt: "2026-09-06T00:00:00.000Z" });
    const input = cleanInput({ industryAssignments: [late] });
    const facts = cleanFacts({ industryRows: [late] });
    const pair = buildPair(input); // PIT 视角 industry 应为 null
    expect(pair.pit.industry).toBeNull();
    pair.pit.industry = {
      industryCode: late.industryCode,
      industryName: late.industryName,
      effectiveFrom: late.effectiveFrom,
      effectiveTo: late.effectiveTo,
      source: late.source,
    };
    const verdict = runSampleChecks(sample(), facts, pair);
    expect(verdict.issues.some((issue) => issue.checkId === "INDUSTRY_PIT")).toBe(true);
    expect(verdict.industryPitGuardExercised).toBe(true);
  });

  it("INDUSTRY_PIT：应可知的行业被遗漏（重建返回 null）", () => {
    const pair = buildPair(cleanInput()); // PIT 视角 industry = 银行
    pair.pit.industry = null;
    const verdict = runSampleChecks(sample(), cleanFacts(), pair);
    expect(verdict.issues.some((issue) => issue.checkId === "INDUSTRY_PIT")).toBe(true);
  });

  it("CA_KNOWN_SET：look-ahead——未来公告事件进入 PIT 可知集", () => {
    const pair = buildPair(cleanInput());
    pair.pit.corporateActions.knownAtAsOf.push(ca({ actionType: "transfer", announcementDate: "2025-07-01" }));
    const verdict = runSampleChecks(sample(), cleanFacts(), pair);
    expect(verdict.issues.some((issue) => issue.checkId === "CA_KNOWN_SET")).toBe(true);
  });

  it("CA_KNOWN_SET：遗漏——已公告事件未进入可知集", () => {
    const pair = buildPair(cleanInput());
    pair.pit.corporateActions.knownAtAsOf = pair.pit.corporateActions.knownAtAsOf.filter(
      (item) => item.actionType !== "dividend",
    );
    const verdict = runSampleChecks(sample(), cleanFacts(), pair);
    expect(verdict.issues.some((issue) => issue.checkId === "CA_KNOWN_SET")).toBe(true);
  });

  it("CA_EFFECTIVE_SET：未来生效事件被装入已生效集", () => {
    const pair = buildPair(cleanInput());
    pair.pit.corporateActions.effectiveOnOrBefore.push(ca({ actionType: "transfer", effectiveDate: "2025-06-20" }));
    const verdict = runSampleChecks(sample(), cleanFacts(), pair);
    expect(verdict.issues.some((issue) => issue.checkId === "CA_EFFECTIVE_SET")).toBe(true);
  });

  it("PRICE_DAY：价格日期错位", () => {
    const pair = buildPair(cleanInput());
    pair.pit.price = priceBar({ timestamp: "2025-06-04" });
    const verdict = runSampleChecks(sample(), cleanFacts(), pair);
    expect(verdict.issues.some((issue) => issue.checkId === "PRICE_DAY")).toBe(true);
  });

  it("MARKET_STATE_DAY：市场状态缺失（有指数行但重建为空）", () => {
    const pair = buildPair(cleanInput());
    pair.pit.marketState = [];
    const verdict = runSampleChecks(sample(), cleanFacts(), pair);
    expect(verdict.issues.some((issue) => issue.checkId === "MARKET_STATE_DAY")).toBe(true);
  });

  it("KNOWLEDGE_CONSISTENCY：可知性标记与结果矛盾", () => {
    const input = cleanInput({ priceBar: null, liquidity: null });
    const facts = cleanFacts({ priceBar: null, liquidity: null });
    const pair = buildPair(input);
    pair.pit.knowledge.dimensions.price = "KNOWN"; // 无价格却标 KNOWN
    const verdict = runSampleChecks(sample(), facts, pair);
    expect(verdict.issues.some((issue) => issue.checkId === "KNOWLEDGE_CONSISTENCY")).toBe(true);
  });

  it("PIT_SUBSET_DIMS：asOf 增大后已解析维度倒退", () => {
    const pair = buildPair(cleanInput());
    delete pair.full.tradability.snapshot.resolved.TRADING;
    const verdict = runSampleChecks(sample(), cleanFacts(), pair);
    expect(verdict.issues.some((issue) => issue.checkId === "PIT_SUBSET_DIMS")).toBe(true);
  });

  it("INDUSTRY_GROWTH：asOf 增大后行业消失", () => {
    const pair = buildPair(cleanInput());
    pair.full.industry = null;
    const verdict = runSampleChecks(sample(), cleanFacts(), pair);
    expect(verdict.issues.some((issue) => issue.checkId === "INDUSTRY_GROWTH")).toBe(true);
  });
});

describe("checkers 稳定性", () => {
  it("CHECK_IDS 与实现一致（汇总聚合所需）", () => {
    expect(Array.from(new Set(CHECK_IDS)).length).toBe(CHECK_IDS.length);
    expect(CHECK_IDS).toContain("CA_KNOWN_SET");
    expect(CHECK_IDS).toContain("INDUSTRY_PIT");
  });

  it("同一输入两次检查结果一致（确定性）", () => {
    const pair = buildPair(cleanInput());
    const a = runSampleChecks(sample(), cleanFacts(), pair);
    const b = runSampleChecks(sample(), cleanFacts(), clone(pair));
    expect(b.issues).toEqual(a.issues);
  });
});
