/**
 * 统一版本目录：正式版本与回测留档合并的纯逻辑测试。
 *
 * 覆盖口径（服务端唯一合并点）：
 *   - 正式版本字段优先，留档只补运行指标；
 *   - 没有正式版本行的历史留档不进入目录（保存入口负责先物化正式版本）；
 *   - 同一 version 有多条留档时只取最新一条；
 *   - 星标统一来自 strategy_version_star，星标行置顶。
 */

import { describe, expect, it } from "vitest";

import { buildStrategyVersionCatalog } from "../../../server/research/strategyVersionCatalog";
import type { ClosedLoopBacktestRunRecord } from "../../../server/closedLoopBacktestRun/repository";
import type { StrategyVersionSummary } from "../../../server/research/strategyPersistence/contract";

function versionSummary(
  overrides: Partial<StrategyVersionSummary> & { version: string }
): StrategyVersionSummary {
  return {
    strategyId: "s1",
    versionRowId: 1,
    fingerprint: `fp-${overrides.version}`,
    datasetVersion: "v1",
    datasetVersionId: 1,
    universeId: "u1",
    codeVersion: "code-1",
    status: "Draft",
    parentVersionId: null,
    description: null,
    isStarred: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function archive(
  overrides: Partial<ClosedLoopBacktestRunRecord> & { strategyVersion: string }
): ClosedLoopBacktestRunRecord {
  return {
    id: 1,
    runId: `run-${overrides.strategyVersion}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    experimentId: "exp-1",
    strategyId: "s1",
    startDate: "2026-01-01",
    endDate: "2026-06-30",
    isStarred: false,
    status: "COMPLETED",
    executedStageCount: 5,
    blockedStageCount: 0,
    skippedStageCount: 0,
    firstBlockedReasonCode: null,
    datasetVersion: "v1",
    datasetVersionId: 1,
    datasetSource: null,
    datasetSourceNote: null,
    recipeId: null,
    initialCapital: 100_000,
    finalEquity: 120_000,
    tradeCount: 42,
    equityCurvePointCount: 120,
    totalReturnPct: 20,
    maxDrawdownPct: -5,
    cagrPct: 18,
    ...overrides,
  };
}

describe("buildStrategyVersionCatalog", () => {
  it("正式版本字段优先，留档只补运行指标", () => {
    const rows = buildStrategyVersionCatalog({
      versions: [
        versionSummary({
          version: "1.0.0",
          status: "Candidate",
          description: "正式版本",
        }),
      ],
      archives: [
        archive({
          id: 9,
          strategyVersion: "1.0.0",
          status: "COMPLETED",
          totalReturnPct: 33.3,
        }),
      ],
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.versionStatus).toBe("Candidate");
    expect(row.fingerprint).toBe("fp-1.0.0");
    expect(row.archiveId).toBe(9);
    expect(row.totalReturnPct).toBe(33.3);
  });

  it("只有历史留档、没有正式版本的版本不进入目录", () => {
    const rows = buildStrategyVersionCatalog({
      versions: [],
      archives: [
        archive({
          id: 77,
          strategyVersion: "1.62.1",
          status: "COMPLETED",
          totalReturnPct: 12.5,
        }),
      ],
    });

    expect(rows).toHaveLength(0);
  });

  it("同一 version 有多条留档时只取传入的第一条（服务端已按时间倒序传入）", () => {
    const rows = buildStrategyVersionCatalog({
      versions: [versionSummary({ version: "2.0.0" })],
      archives: [
        archive({
          id: 200,
          strategyVersion: "2.0.0",
          createdAt: "2026-06-01T00:00:00.000Z",
          totalReturnPct: 30,
        }),
        archive({
          id: 100,
          strategyVersion: "2.0.0",
          createdAt: "2026-01-01T00:00:00.000Z",
          totalReturnPct: 10,
        }),
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.archiveId).toBe(200);
    expect(rows[0]!.totalReturnPct).toBe(30);
  });

  it("星标行置顶，组内按版本号降序", () => {
    const rows = buildStrategyVersionCatalog({
      versions: [
        versionSummary({ version: "4.0.0" }),
        versionSummary({ version: "3.0.0", isStarred: true }),
        versionSummary({ version: "1.62.1", isStarred: true }),
      ],
      archives: [],
    });

    expect(rows.map(row => row.version)).toEqual(["3.0.0", "1.62.1", "4.0.0"]);
    expect(rows[0]!.isStarred).toBe(true);
    expect(rows[1]!.version).toBe("1.62.1");
  });

  it("使用版本行主键解析父版本号；父行缺失时明确保持 null", () => {
    const rows = buildStrategyVersionCatalog({
      versions: [
        versionSummary({
          version: "1.0.0",
          versionRowId: 10,
          parentVersionId: null,
        }),
        versionSummary({
          version: "1.1.0",
          versionRowId: 11,
          parentVersionId: 10,
        }),
        versionSummary({
          version: "1.2.0",
          versionRowId: 12,
          parentVersionId: 999,
        }),
      ],
      archives: [],
    });

    const byVersion = new Map(rows.map(row => [row.version, row]));
    expect(byVersion.get("1.0.0")?.parentVersion).toBeNull();
    expect(byVersion.get("1.1.0")?.parentVersion).toBe("1.0.0");
    expect(byVersion.get("1.2.0")?.parentVersion).toBeNull();
    expect(byVersion.get("1.1.0")?.parentVersionId).toBe(10);
  });

  it("目录行携带该策略版本对应的模式族研究注解", () => {
    const rows = buildStrategyVersionCatalog({
      versions: [
        versionSummary({
          strategyId: "first-limit-pullback-3f-top3",
          version: "1.62.1",
        }),
      ],
      archives: [],
    });

    expect(rows[0]!.study?.familyId).toBe("c6-b4-14-best-combination");
    expect(rows[0]!.study?.observedResult).toContain("+57.73%");
    expect(rows[0]!.study?.minuteFields[0]?.field).toBe("limitUpTime");
  });

  it("目录记录非 3F 策略时不套用 3F 模式族结论", () => {
    const rows = buildStrategyVersionCatalog({
      versions: [versionSummary({ version: "1.62.1" })],
      archives: [],
    });

    expect(rows[0]!.study).toBeNull();
  });
});
