import { describe, expect, it } from "vitest";
import { createCachedDatasetIdentityResolver } from "../../../server/runWorkbenchAssembly/datasetIdentityProvider";
import type { FirstLimitPullbackEvent } from "../../../server/datasetRegistry/types";
import type { SecurityIdentifier } from "../../../server/security/types";

function makeEvent(
  eventId: string,
  symbol: string,
  tradeDate: string
): FirstLimitPullbackEvent {
  return {
    datasetVersionId: 660001,
    eventId,
    symbol,
    tradeDate,
    market: symbol.endsWith(".SH") ? "SH" : "SZ",
    industryCode: null,
    boardType: null,
    previousClose: null,
    limitUpPrice: null,
    limitDownPrice: null,
    limitRuleUp: null,
    limitRuleDown: null,
    limitRuleVersion: null,
    turnover: null,
    limitUpTime: null,
    sector: null,
    keywords: null,
    sourceTurnoverAmount: null,
    sourceCirculationValue: null,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: null,
    marketCap: null,
    floatMarketCap: null,
  };
}

function makeIdentifier(
  securityId: string,
  code: string,
  effectiveFrom: string,
  effectiveTo: string | null
): SecurityIdentifier {
  return {
    securityId,
    exchange: "SZ",
    code,
    identifierType: "primary",
    effectiveFrom,
    effectiveTo,
    source: "fixture",
  };
}

describe("createCachedDatasetIdentityResolver", () => {
  it("loads Identifier History once and still resolves each page by PIT trade date", async () => {
    let loads = 0;
    const identifiers: readonly SecurityIdentifier[] = [
      makeIdentifier("sec_old", "000001", "2000-01-01", "2024-12-31"),
      makeIdentifier("sec_new", "000001", "2025-01-01", null),
    ];
    const resolver = createCachedDatasetIdentityResolver({
      loadIdentifiers: async () => {
        loads += 1;
        return identifiers;
      },
    });

    const first = await resolver(660001, [
      makeEvent("E_OLD", "000001.SZ", "2024-06-03"),
    ]);
    const second = await resolver(660001, [
      makeEvent("E_NEW", "000001.SZ", "2025-03-03"),
    ]);

    expect(loads).toBe(1);
    expect(first.get("E_OLD")).toBe("sec_old");
    expect(second.get("E_NEW")).toBe("sec_new");
  });

  it("retries identifier loading after a failure instead of caching the rejected promise", async () => {
    let loads = 0;
    const identifiers: readonly SecurityIdentifier[] = [
      makeIdentifier("sec_recovered", "000001", "2000-01-01", null),
    ];
    const resolver = createCachedDatasetIdentityResolver({
      loadIdentifiers: async () => {
        loads += 1;
        if (loads === 1) {
          const cause = Object.assign(new Error("connect ETIMEDOUT"), {
            code: "ETIMEDOUT",
          });
          throw new Error(
            "Failed query: select ... from research_security_identifier_history",
            { cause }
          );
        }
        return identifiers;
      },
    });

    await expect(
      resolver(660001, [makeEvent("E_RETRY", "000001.SZ", "2025-03-03")])
    ).rejects.toThrow("Failed query");
    const retried = await resolver(660001, [
      makeEvent("E_RETRY", "000001.SZ", "2025-03-03"),
    ]);

    expect(loads).toBe(2);
    expect(retried.get("E_RETRY")).toBe("sec_recovered");
  });
});
