/**
 * STEP 12.6 — Research Dataset：dataset_version 确定性测试（C-12.6.1）。
 */

import { describe, expect, it } from "vitest";
import { computeDatasetVersion, computeRowsFingerprint } from "./version";
import type { NormalizedResearchDatasetRequest, ResearchDatasetRow, UniverseDefinition } from "./types";

const REQUEST: NormalizedResearchDatasetRequest = {
  name: "tradable-daily",
  startDate: "2024-01-02",
  endDate: "2024-01-05",
  asOfPerTradeDate: true,
  asOf: null,
  coreIndexCodes: ["000001.SH", "000300.SH", "399001.SZ", "399006.SZ"],
};

const UNIVERSE: UniverseDefinition = {
  rule: "STEP 11",
  asOfDescription: "逐日 PIT",
  days: [
    { tradeDate: "2024-01-02", isTradingDay: true, members: ["sec_a"], excludedByReason: { NOT_YET_LISTED: 1 } },
  ],
};

function row(overrides: Partial<ResearchDatasetRow> = {}): ResearchDatasetRow {
  return {
    tradeDate: "2024-01-02",
    asOf: "2024-01-02",
    securityId: "sec_a",
    code: "600000.SH",
    securityType: "stock",
    exchange: "SH",
    lifecycleVerdict: "LISTED",
    eligible: true,
    exclusionReason: null,
    st: "NORMAL",
    industryCode: "801780",
    industryName: "银行",
    turnoverRate: 0.5,
    circulationMarketCap: 1_000,
    totalMarketCap: 1_200,
    liquidityAmount: 800,
    liquidityVolume: 200,
    open: 10,
    high: 10.5,
    low: 9.8,
    close: 10.2,
    preClose: 10,
    volume: 200,
    amount: 800,
    corporateActionsEffectiveCount: 0,
    corporateActionsKnownCount: 0,
    indexClose: { "000300.SH": 4010 },
    knowledge: {
      policy: "PIT",
      listing: "KNOWN",
      delisting: "KNOWN",
      tradability: "KNOWN",
      industry: "KNOWN",
      liquidity: "KNOWN",
      price: "KNOWN",
      corporateActions: "KNOWN",
      marketState: "KNOWN",
    },
    ...overrides,
  };
}

describe("computeDatasetVersion", () => {
  it("相同输入 → 相同版本（可复现，字段顺序无关）", () => {
    const v1 = computeDatasetVersion(REQUEST, UNIVERSE, [row()]);
    const v2 = computeDatasetVersion({ ...REQUEST }, { ...UNIVERSE }, [{ ...row() }]);
    expect(v1).toBe(v2);
  });

  it("内容变化 → 版本变化（行价格改变）", () => {
    const v1 = computeDatasetVersion(REQUEST, UNIVERSE, [row()]);
    const v2 = computeDatasetVersion(REQUEST, UNIVERSE, [row({ close: 10.99 })]);
    expect(v1).not.toBe(v2);
  });

  it("请求变化（日期范围 / asOf 口径）→ 版本变化", () => {
    const base = computeDatasetVersion(REQUEST, UNIVERSE, [row()]);
    const dateChanged = computeDatasetVersion(
      { ...REQUEST, endDate: "2024-01-10" },
      UNIVERSE,
      [row()],
    );
    const asOfChanged = computeDatasetVersion(
      { ...REQUEST, asOfPerTradeDate: false, asOf: "2024-02-01" },
      UNIVERSE,
      [row({ asOf: "2024-02-01" })],
    );
    expect(base).not.toBe(dateChanged);
    expect(base).not.toBe(asOfChanged);
  });

  it("universe 变化 → 版本变化", () => {
    const base = computeDatasetVersion(REQUEST, UNIVERSE, [row()]);
    const universeChanged = computeDatasetVersion(REQUEST, { ...UNIVERSE, days: [] }, [row()]);
    expect(base).not.toBe(universeChanged);
  });

  it("版本前缀含 builder/schema 版本，哈希为 16 hex", () => {
    const version = computeDatasetVersion(REQUEST, UNIVERSE, [row()]);
    expect(version).toMatch(/^rd-\d+\.\d+\.\d+-\d+-[0-9a-f]{16}$/);
  });
});

describe("computeRowsFingerprint", () => {
  it("行序列指纹：顺序敏感、内容敏感", () => {
    const a = computeRowsFingerprint([row()]);
    const b = computeRowsFingerprint([row(), row({ securityId: "sec_b" })]);
    expect(a).not.toBe(b);
  });
});
