/**
 * 3F Top3 正式版本谱系校验测试。
 *
 * 该映射是回填脚本的写入依据：正式版本必须一一登记，父行必须同策略，
 * 且只允许 1.0.0 / 1.21.0 两个根。测试同时覆盖缺失版本、意外版本、
 * 自引用、跨策略父行与环等拒绝路径。
 */

import { describe, expect, it } from "vitest";

import {
  THREE_FACTOR_TOPN_3_STRATEGY_ID,
  THREE_FACTOR_TOPN_3_VERSION_LINEAGE,
  validateThreeFactorTopN3VersionLineage,
  validateVersionLineage,
  type VersionLineageRow,
} from "../../../server/research/patternLibrary/threeFactorTopNVersionLineage";

const LINEAGE = THREE_FACTOR_TOPN_3_VERSION_LINEAGE;

function buildValidRows(): VersionLineageRow[] {
  const idByVersion = new Map<string, number>();
  Object.keys(LINEAGE).forEach((version, index) => {
    idByVersion.set(version, (index + 1) * 1000);
  });
  return Object.entries(LINEAGE).map(([version, parentVersion]) => ({
    strategyId: THREE_FACTOR_TOPN_3_STRATEGY_ID,
    version,
    versionRowId: idByVersion.get(version)!,
    parentVersionId: parentVersion === null ? null : idByVersion.get(parentVersion)!,
  }));
}

function rowOf(rows: VersionLineageRow[], version: string): VersionLineageRow {
  const row = rows.find(candidate => candidate.version === version);
  if (row === undefined) throw new Error(`测试缺少版本行：${version}`);
  return row;
}

describe("THREE_FACTOR_TOPN_3_VERSION_LINEAGE", () => {
  it("恰好登记全部正式版本（2026-10-01 起 99 个，含新增 1.63.0），且只有 1.0.0 / 1.21.0 两个根", () => {
    const entries = Object.entries(LINEAGE);
    // 2026-10-01：新增 1.63.0（涨停生态闸门）⇒ 98 → 99。\n    expect(entries).toHaveLength(99);
    expect(entries.filter(([, parent]) => parent === null).map(([version]) => version))
      .toEqual(["1.0.0", "1.21.0"]);
  });

  it("关键最新版本链完整可达两个根之一", () => {
    const expectedChain = [
      "1.62.1",
      "1.59.6",
      "1.59.5",
      "1.44.1",
      "1.44.0",
      "1.43.0",
      "1.27.3",
      "1.27.2",
      "1.27.1",
      "1.27.0",
      "1.26.0",
      "1.25.0",
      "1.22.0",
      "1.14.1",
      "1.14.0",
      "1.13.0",
      "1.12.0",
      "1.11.0",
      "1.10.0",
      "1.9.1",
      "1.9.0",
      "1.8.0",
      "1.7.0",
      "1.6.0",
      "1.5.0",
      "1.4.0",
      "1.3.0",
      "1.2.0",
      "1.1.0",
      "1.0.0",
    ];

    const actualChain: string[] = [];
    let cursor: string | null = "1.62.1";
    while (cursor !== null) {
      actualChain.push(cursor);
      cursor = LINEAGE[cursor] ?? null;
    }
    expect(actualChain).toEqual(expectedChain);
  });

  it("正式行与谱系完全一致时校验通过", () => {
    expect(() => validateThreeFactorTopN3VersionLineage(buildValidRows())).not.toThrow();
  });

  it("拒绝缺失版本行", () => {
    const rows = buildValidRows().filter(row => row.version !== "1.59.5");
    expect(() => validateThreeFactorTopN3VersionLineage(rows))
      .toThrow(/缺少版本：1\.59\.5/);
  });

  it("拒绝未登记谱系的意外版本", () => {
    const rows = buildValidRows();
    rows.push({
      strategyId: THREE_FACTOR_TOPN_3_STRATEGY_ID,
      version: "9.99.9",
      versionRowId: 999_999,
      parentVersionId: rowOf(rows, "1.62.1").versionRowId,
    });
    expect(() => validateThreeFactorTopN3VersionLineage(rows))
      .toThrow(/存在未登记谱系的版本：9\.99\.9/);
  });

  it("拒绝父行缺失", () => {
    const rows = buildValidRows();
    const index = rows.findIndex(row => row.version === "1.62.1");
    rows[index] = { ...rows[index]!, parentVersionId: 888_888 };
    expect(() => validateThreeFactorTopN3VersionLineage(rows))
      .toThrow(/版本父行不存在：1\.62\.1 -> id=888888/);
  });

  it("拒绝自引用父链", () => {
    const rows = buildValidRows();
    const index = rows.findIndex(row => row.version === "1.62.1");
    rows[index] = { ...rows[index]!, parentVersionId: rows[index]!.versionRowId };
    expect(() => validateThreeFactorTopN3VersionLineage(rows))
      .toThrow(/版本父链不能指向自身：1\.62\.1/);
  });

  it("拒绝跨策略父行", () => {
    const rows = buildValidRows();
    // 保留同策略的 1.59.6，另加一个跨策略行并让 1.62.1 指向它，
    // 以覆盖「父行存在但不是同一策略」这一条独立拒绝路径。
    rows.push({
      strategyId: "other-strategy",
      version: "1.59.6",
      versionRowId: 900_001,
      parentVersionId: null,
    });
    const childIndex = rows.findIndex(row => row.version === "1.62.1");
    rows[childIndex] = { ...rows[childIndex]!, parentVersionId: 900_001 };
    expect(() => validateThreeFactorTopN3VersionLineage(rows))
      .toThrow(/版本父链跨策略：1\.62\.1 -> other-strategy@1\.59\.6/);
  });

  it("拒绝谱系环", () => {
    const cyclicLineage: Record<string, string | null> = {
      "1.0.0": "1.1.0",
      "1.1.0": "1.0.0",
    };
    const rows: VersionLineageRow[] = [
      { strategyId: "s1", version: "1.0.0", versionRowId: 1, parentVersionId: 2 },
      { strategyId: "s1", version: "1.1.0", versionRowId: 2, parentVersionId: 1 },
    ];
    expect(() => validateVersionLineage(cyclicLineage, rows, "s1"))
      .toThrow(/版本父链存在环/);
  });
});
