/**
 * 3F Top3 正式版本谱系（显式声明，不按版本号相邻关系推断）。
 *
 * 这份映射只描述 `first-limit-pullback-3f-top3` 在已落库的 98 个正式版本之间的真实演进父链：
 *   - `null` = 根版本；
 *   - 值 = 直接父版本号，而不是父版本行 id；
 *   - 每一条都来自既有研究代数 / 回测记录，新增版本时必须显式补一条。
 *
 * 运行时父链仍以 `strategy_versions.parentVersionId` 为权威；本模块只用于一次性安全回填与校验。
 */

export const THREE_FACTOR_TOPN_3_STRATEGY_ID = "first-limit-pullback-3f-top3";

export const THREE_FACTOR_TOPN_3_VERSION_LINEAGE: Readonly<Record<string, string | null>> =
  Object.freeze({
    "1.0.0": null,
    "1.1.0": "1.0.0",
    "1.2.0": "1.1.0",
    "1.3.0": "1.2.0",
    "1.4.0": "1.3.0",
    "1.5.0": "1.4.0",
    "1.6.0": "1.5.0",
    "1.7.0": "1.6.0",
    "1.8.0": "1.7.0",
    "1.9.0": "1.8.0",
    "1.9.1": "1.9.0",
    "1.10.0": "1.9.1",
    "1.11.0": "1.10.0",
    "1.12.0": "1.11.0",
    "1.13.0": "1.12.0",
    "1.14.0": "1.13.0",
    "1.14.1": "1.14.0",
    "1.15.0": "1.14.1",
    "1.16.0": "1.14.1",
    "1.17.0": "1.14.1",
    "1.18.0": "1.14.1",
    "1.19.0": "1.14.1",
    "1.20.0": "1.14.1",
    "1.21.0": null,
    "1.22.0": "1.14.1",
    "1.23.0": "1.22.0",
    "1.23.1": "1.23.0",
    "1.24.0": "1.22.0",
    "1.24.1": "1.24.0",
    "1.25.0": "1.22.0",
    "1.26.0": "1.25.0",
    "1.27.0": "1.26.0",
    "1.27.1": "1.27.0",
    "1.27.2": "1.27.1",
    "1.27.3": "1.27.2",
    "1.28.0": "1.27.3",
    "1.28.1": "1.27.3",
    "1.28.2": "1.27.3",
    "1.28.3": "1.27.3",
    "1.29.0": "1.27.3",
    "1.29.1": "1.27.3",
    "1.29.2": "1.27.3",
    "1.30.0": "1.27.3",
    "1.30.1": "1.27.3",
    "1.30.2": "1.27.3",
    "1.31.0": "1.27.3",
    "1.31.1": "1.27.3",
    "1.31.2": "1.27.3",
    "1.32.0": "1.27.3",
    "1.32.1": "1.27.3",
    "1.33.0": "1.27.3",
    "1.33.1": "1.27.3",
    "1.33.2": "1.27.3",
    "1.34.0": "1.27.3",
    "1.34.1": "1.27.3",
    "1.35.0": "1.27.3",
    "1.36.0": "1.27.3",
    "1.37.0": "1.27.3",
    "1.38.0": "1.27.3",
    "1.39.0": "1.27.3",
    "1.40.0": "1.27.3",
    "1.41.0": "1.27.3",
    "1.42.0": "1.27.3",
    "1.43.0": "1.27.3",
    "1.44.0": "1.43.0",
    "1.44.1": "1.44.0",
    "1.44.2": "1.44.0",
    "1.45.0": "1.27.3",
    "1.46.0": "1.27.3",
    "1.47.0": "1.27.3",
    "1.48.0": "1.27.3",
    "1.49.0": "1.27.3",
    "1.50.0": "1.27.3",
    "1.51.0": "1.27.3",
    "1.52.0": "1.27.3",
    "1.53.0": "1.27.3",
    "1.54.0": "1.27.3",
    "1.55.0": "1.27.3",
    "1.56.0": "1.27.3",
    "1.58.0": "1.44.1",
    "1.58.1": "1.44.1",
    "1.58.2": "1.44.1",
    "1.58.3": "1.44.1",
    "1.58.4": "1.44.1",
    "1.58.5": "1.44.1",
    "1.58.6": "1.44.1",
    "1.58.7": "1.44.1",
    "1.59.0": "1.44.1",
    "1.59.1": "1.44.1",
    "1.59.2": "1.44.1",
    "1.59.3": "1.44.1",
    "1.59.4": "1.44.1",
    "1.59.5": "1.44.1",
    "1.59.6": "1.59.5",
    "1.61.0": "1.59.6",
    "1.61.1": "1.59.6",
    "1.61.2": "1.59.6",
    "1.62.1": "1.59.6",
    // 2026-10-01：唯一的增量 = definition.marketRegimeFilter（决策日封板家数 < 训练段 p33 时不新建仓）。
    "1.63.0": "1.62.1",
  });

export interface VersionLineageRow {
  readonly strategyId: string;
  readonly version: string;
  readonly versionRowId: number;
  readonly parentVersionId: number | null;
}

/**
 * 校验「显式版本谱系 + 实际版本行投影」是否完整、可连接且无环。
 *
 * 该函数是纯逻辑、无副作用：调用方可在写库前先跑完整校验，失败时不做任何 UPDATE。
 */
export function validateVersionLineage(
  lineage: Readonly<Record<string, string | null>>,
  rows: readonly VersionLineageRow[],
  expectedStrategyId: string,
): void {
  const expectedVersions = Object.keys(lineage);
  const expectedVersionSet = new Set(expectedVersions);
  const strategyRows = rows.filter(row => row.strategyId === expectedStrategyId);
  const rowsById = new Map<number, VersionLineageRow>();
  const rowsByVersion = new Map<string, VersionLineageRow>();

  for (const row of rows) {
    if (rowsById.has(row.versionRowId)) {
      throw new Error(`版本行 id 重复：${row.versionRowId}`);
    }
    rowsById.set(row.versionRowId, row);
  }

  for (const row of strategyRows) {
    if (rowsByVersion.has(row.version)) {
      throw new Error(`策略 ${expectedStrategyId} 的版本重复：${row.version}`);
    }
    if (!expectedVersionSet.has(row.version)) {
      throw new Error(`策略 ${expectedStrategyId} 存在未登记谱系的版本：${row.version}`);
    }
    rowsByVersion.set(row.version, row);
  }

  const missingVersions = expectedVersions.filter(version => !rowsByVersion.has(version));
  if (missingVersions.length > 0) {
    throw new Error(`策略 ${expectedStrategyId} 缺少版本：${missingVersions.join(", ")}`);
  }

  for (const version of expectedVersions) {
    const row = rowsByVersion.get(version)!;
    const expectedParentVersion = lineage[version] ?? null;

    if (expectedParentVersion === null) {
      if (row.parentVersionId !== null) {
        throw new Error(`根版本不得有父版本：${version}`);
      }
      continue;
    }
    if (row.parentVersionId === null) {
      throw new Error(`版本缺少父链：${version} -> ${expectedParentVersion}`);
    }
    if (row.parentVersionId === row.versionRowId) {
      throw new Error(`版本父链不能指向自身：${version}`);
    }

    const parentRow = rowsById.get(row.parentVersionId);
    if (parentRow === undefined) {
      throw new Error(`版本父行不存在：${version} -> id=${row.parentVersionId}`);
    }
    if (parentRow.strategyId !== expectedStrategyId) {
      throw new Error(
        `版本父链跨策略：${version} -> ${parentRow.strategyId}@${parentRow.version}`,
      );
    }
    if (parentRow.version !== expectedParentVersion) {
      throw new Error(
        `版本父链与显式谱系不一致：${version} -> ${parentRow.version}，期望 ${expectedParentVersion}`,
      );
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (version: string): void => {
    if (visited.has(version)) return;
    if (visiting.has(version)) {
      throw new Error(`版本父链存在环：${version}`);
    }
    visiting.add(version);
    const parentVersion = lineage[version] ?? null;
    if (parentVersion !== null) visit(parentVersion);
    visiting.delete(version);
    visited.add(version);
  };
  for (const version of expectedVersions) visit(version);
}

export function validateThreeFactorTopN3VersionLineage(
  rows: readonly VersionLineageRow[],
): void {
  validateVersionLineage(
    THREE_FACTOR_TOPN_3_VERSION_LINEAGE,
    rows,
    THREE_FACTOR_TOPN_3_STRATEGY_ID,
  );
}
