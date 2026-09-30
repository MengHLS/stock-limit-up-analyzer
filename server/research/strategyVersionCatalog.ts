/**
 * 统一策略版本目录（只读投影）。
 *
 * 正式版本（`strategy_versions`）是版本存在的唯一来源；闭环回测留档
 * （`closed_loop_backtest_run`）只补该版本最近一次运行事实。
 *
 * 版本选择、版本历史与对比页需要的是同一个问题：「这个策略有哪些可比较的 version？」
 * 本模块只按 `(strategyId, version)` 把留档指标投影到正式版本行上，不写库、不增行。
 */

import type { StrategyVersionCatalogRowDto } from "../../shared/researchContracts";
import type { ClosedLoopBacktestRunRecord } from "../closedLoopBacktestRun/repository";
import type { StrategyVersionSummary } from "./strategyPersistence/contract";
import { compareStrategyVersions } from "./strategySchema/version";
import { getStrategyVersionStudyAnnotation } from "./strategyVersionStudyAnnotations";

export interface StrategyVersionCatalogInput {
  readonly versions: readonly StrategyVersionSummary[];
  /** 已按留档时间倒序传入；同 version 只采用第一条（最新）。 */
  readonly archives: readonly ClosedLoopBacktestRunRecord[];
}

function compareCatalogVersionDesc(left: string, right: string): number {
  try {
    return compareStrategyVersions(right, left);
  } catch {
    return right.localeCompare(left, "en", { numeric: true });
  }
}

function sortCatalogRows(
  rows: readonly StrategyVersionCatalogRowDto[]
): StrategyVersionCatalogRowDto[] {
  return [...rows].sort((left, right) => {
    if (left.isStarred !== right.isStarred) {
      return left.isStarred ? -1 : 1;
    }
    return compareCatalogVersionDesc(left.version, right.version);
  });
}

/**
 * 投影正式版本与留档。
 *
 * `archiveId` / `runId` / 指标描述最新一次留档；没有正式版本行的留档被忽略，
 * 因为保存留档的入口已负责先写正式版本。
 */
export function buildStrategyVersionCatalog(
  input: StrategyVersionCatalogInput
): StrategyVersionCatalogRowDto[] {
  const latestArchiveByVersion = new Map<string, ClosedLoopBacktestRunRecord>();
  for (const archive of input.archives) {
    if (!latestArchiveByVersion.has(archive.strategyVersion)) {
      latestArchiveByVersion.set(archive.strategyVersion, archive);
    }
  }

  // 版本行主键 → 版本号：`parentVersionId` 与 `strategy_versions.id` 同坐标空间，
  // 这里把父 id 解析成可读版本号。父行缺失解析不到时保持 null，调用方按「无父」处理。
  const versionByRowId = new Map<number, string>();
  for (const version of input.versions) {
    if (!versionByRowId.has(version.versionRowId)) {
      versionByRowId.set(version.versionRowId, version.version);
    }
  }

  const rows = new Map<string, StrategyVersionCatalogRowDto>();
  for (const version of input.versions) {
    const archive = latestArchiveByVersion.get(version.version) ?? null;
    rows.set(version.version, {
      strategyId: version.strategyId,
      version: version.version,
      isStarred: version.isStarred,
      versionStatus: version.status,
      versionCreatedAt: version.createdAt,
      fingerprint: version.fingerprint,
      parentVersionId: version.parentVersionId,
      parentVersion:
        version.parentVersionId === null
          ? null
          : versionByRowId.get(version.parentVersionId) ?? null,
      description: version.description,
      datasetVersion: archive?.datasetVersion ?? version.datasetVersion ?? null,
      datasetVersionId:
        archive?.datasetVersionId ?? version.datasetVersionId ?? null,
      archiveId: archive?.id ?? null,
      runId: archive?.runId ?? null,
      archiveCreatedAt: archive?.createdAt ?? null,
      startDate: archive?.startDate ?? null,
      endDate: archive?.endDate ?? null,
      backtestStatus: archive?.status ?? null,
      totalReturnPct: archive?.totalReturnPct ?? null,
      maxDrawdownPct: archive?.maxDrawdownPct ?? null,
      cagrPct: archive?.cagrPct ?? null,
      study: getStrategyVersionStudyAnnotation(
        version.strategyId,
        version.version
      ),
    });
  }

  return sortCatalogRows([...rows.values()]);
}
