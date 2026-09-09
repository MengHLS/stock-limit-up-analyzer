/**
 * STEP DS-V2-FINAL — 分片（分区）构建正确性测试。
 *
 * 核心不变量：分片构建（标准行 JSON 落表 → 流式读回 → 流式指纹）必须与一次性
 * （全量进内存 → 一次性指纹）产出完全一致的 datasetVersion / rowsFingerprint。
 * 这是「内容寻址身份」在分片路径下成立的前提。
 */

import { describe, expect, it } from "vitest";
import {
  computeDatasetVersion,
  computeDatasetFingerprintsStreaming,
  computeDatasetVersionStreaming,
  computeRowsFingerprint,
  computeRowsFingerprintStreaming,
  canonicalStringify,
} from "./version";
import { computeBuildKey, rowsTableName } from "./buildKey";
import type {
  NormalizedResearchDatasetRequest,
  ResearchDatasetRow,
  UniverseDefinition,
} from "./types";

function makeRow(tradeDate: string, securityId: string, close: number | null = null): ResearchDatasetRow {
  return {
    tradeDate,
    asOf: tradeDate,
    securityId,
    code: `${securityId.split(".")[0]}.${securityId.split(".")[1]}`,
    securityType: "stock",
    exchange: securityId.endsWith(".SH") ? "SH" : "SZ",
    lifecycleVerdict: "LISTED",
    eligible: true,
    exclusionReason: null,
    st: "NORMAL",
    industryCode: "C39",
    industryName: "计算机",
    turnoverRate: 1.2345,
    circulationMarketCap: 1_000_000_000,
    totalMarketCap: 2_000_000_000,
    liquidityAmount: 500_000,
    liquidityVolume: 100_000,
    open: close === null ? null : close - 0.5,
    high: close === null ? null : close + 1,
    low: close === null ? null : close - 1,
    close,
    preClose: close === null ? null : close - 0.1,
    volume: 123456,
    amount: 987654,
    corporateActionsEffectiveCount: 0,
    corporateActionsKnownCount: 0,
    indexClose: { "000300.SH": 4000.5, "000001.SH": 3000.25 },
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
  };
}

const REQUEST: NormalizedResearchDatasetRequest = {
  name: "partitioned-test",
  startDate: "2025-01-02",
  endDate: "2025-01-08",
  asOfPerTradeDate: true,
  asOf: null,
  coreIndexCodes: ["000001.SH", "000300.SH", "399001.SZ", "399006.SZ"],
  universeFilter: {
    boards: ["main", "chinext"],
    excludeSt: true,
    tDayCondition: "firstBoard",
    pullback: null,
  },
};

const UNIVERSE: UniverseDefinition = {
  rule: "test-rule",
  asOfDescription: "逐日 PIT",
  days: [
    { tradeDate: "2025-01-02", isTradingDay: true, members: ["600000.SH", "300001.SZ"], excludedByReason: { BOARD_EXCLUDED_star: 3 } },
    { tradeDate: "2025-01-03", isTradingDay: true, members: ["600000.SH"], excludedByReason: {} },
  ],
};

describe("computeBuildKey", () => {
  it("同请求同 buildKey（确定性）", () => {
    expect(computeBuildKey(REQUEST)).toBe(computeBuildKey(REQUEST));
  });

  it("不同请求不同 buildKey", () => {
    const other = { ...REQUEST, name: "other-name" };
    expect(computeBuildKey(other)).not.toBe(computeBuildKey(REQUEST));
  });

  it("buildKey 为 16 位 hex，表名格式正确", () => {
    const key = computeBuildKey(REQUEST);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(rowsTableName(key)).toBe(`rd_rows_${key}`);
  });

  it("非法 buildKey 抛错（防注入）", () => {
    expect(() => rowsTableName("bad;DROP TABLE")).toThrow();
    expect(() => rowsTableName("ABCDEF")).toThrow(/非法/);
  });
});

describe("流式指纹 == 一次性指纹", () => {
  const rows: ResearchDatasetRow[] = [
    makeRow("2025-01-02", "600000.SH", 10.0),
    makeRow("2025-01-02", "300001.SZ", 20.0),
    makeRow("2025-01-03", "600000.SH", 10.5),
  ];

  it("computeDatasetVersionStreaming === computeDatasetVersion", () => {
    expect(computeDatasetVersionStreaming(REQUEST, UNIVERSE, rows)).toBe(
      computeDatasetVersion(REQUEST, UNIVERSE, rows),
    );
  });

  it("computeRowsFingerprintStreaming === computeRowsFingerprint", () => {
    expect(computeRowsFingerprintStreaming(rows)).toBe(computeRowsFingerprint(rows));
  });

  it("computeDatasetFingerprintsStreaming（异步）与一次性一致", async () => {
    async function* asyncRows() {
      for (const row of rows) yield row;
    }
    const got = await computeDatasetFingerprintsStreaming(REQUEST, UNIVERSE, asyncRows());
    expect(got.datasetVersion).toBe(computeDatasetVersion(REQUEST, UNIVERSE, rows));
    expect(got.rowsFingerprint).toBe(computeRowsFingerprint(rows));
  });

  it("空 rows 也一致", () => {
    expect(computeDatasetVersionStreaming(REQUEST, UNIVERSE, [])).toBe(
      computeDatasetVersion(REQUEST, UNIVERSE, []),
    );
    expect(computeRowsFingerprintStreaming([])).toBe(computeRowsFingerprint([]));
  });
});

describe("JSON round-trip 不改变指纹（分片落表关键）", () => {
  const rows: ResearchDatasetRow[] = [
    makeRow("2025-01-02", "600000.SH", 10.0),
    makeRow("2025-01-02", "300001.SZ", null), // 含 null 字段
  ];

  it("round-trip 后 canonicalStringify 一致", () => {
    for (const row of rows) {
      const roundTripped = JSON.parse(JSON.stringify(row)) as ResearchDatasetRow;
      expect(canonicalStringify(roundTripped)).toBe(canonicalStringify(row));
    }
  });

  it("round-trip 后整体 rowsFingerprint 一致", () => {
    const roundTripped = rows.map((r) => JSON.parse(JSON.stringify(r)) as ResearchDatasetRow);
    expect(computeRowsFingerprint(roundTripped)).toBe(computeRowsFingerprint(rows));
  });
});
