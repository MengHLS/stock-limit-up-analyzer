/**
 * STEP 12.6 — Research Dataset 持久化（P2-T1 / G2）。
 *
 * 把 buildResearchDataset 的产物落库到 research_datasets 表，实现「数据集可持久化、可复现、可追溯」：
 *   - datasetId = DS-<datasetVersion>（内容指纹派生，唯一且确定性）；
 *   - 版本快照（versionSnapshotJson）经 buildDatasetVersionSnapshot 绑定 version/fingerprint/policySet/摘要，
 *     可 round-trip（serialize → parse）且含快照指纹（versionSnapshotFingerprint）；
 *   - rowsFingerprint / policySetFingerprint 独立可校验（同输入同输出，P2-T2 一致性比对）。
 *
 * 幂等纪律：同 datasetVersion（内容指纹）已存在则返回已有记录（replayed=true），不产生重复行；
 *   DB 不可用（getDb()=null）时抛错，不伪造成功。
 */

import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { researchDatasets } from "../../drizzle/schema";
import { computeRowsFingerprint } from "./version";
import { computePolicySetFingerprint } from "./policy";
import type { ResearchDatasetPolicy } from "./policy";
import {
  buildDatasetVersionSnapshot,
  computeVersionSnapshotFingerprint,
  serializeVersionSnapshot,
} from "./versionSnapshot";
import type {
  DataSnapshot,
  NormalizedResearchDatasetRequest,
  ResearchDataset,
  UniverseDefinition,
} from "./types";

/** 持久化结果（供 CLI / 报告引用）。 */
export interface PersistedResearchDataset {
  datasetId: string;
  datasetVersion: string;
  rowCount: number;
  gate: string;
  /** 标准行内容指纹（SHA-256 前 32 hex）。 */
  rowsFingerprint: string;
  /** 9 类 policy 内容指纹（SHA-256 前 16 hex）。 */
  policySetFingerprint: string;
  /** 版本快照产物指纹（SHA-256 前 16 hex）。 */
  versionSnapshotFingerprint: string;
  /** true = 该 datasetVersion 已存在，本次为幂等回放（未新增行）。 */
  replayed: boolean;
}

/** 由内容指纹版本派生稳定数据集身份。 */
export function buildDatasetId(datasetVersion: string): string {
  return `DS-${datasetVersion}`;
}

/** 把 Research Dataset 产物落库（幂等）。 */
export async function persistResearchDataset(dataset: ResearchDataset): Promise<PersistedResearchDataset> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用，无法持久化 Research Dataset");

  const datasetVersion = dataset.datasetVersion;
  const datasetId = buildDatasetId(datasetVersion);
  const rowsFingerprint = computeRowsFingerprint(dataset.rows);
  const policySetFingerprint = computePolicySetFingerprint(dataset.policySet);
  const versionSnapshot = buildDatasetVersionSnapshot({
    datasetVersion,
    rowsFingerprint,
    universeDefinition: dataset.universeDefinition,
    dataSnapshot: dataset.dataSnapshot,
    policySet: dataset.policySet,
  });
  const versionSnapshotJson = serializeVersionSnapshot(versionSnapshot);
  const versionSnapshotFingerprint = computeVersionSnapshotFingerprint(versionSnapshot);

  // 幂等：同 datasetId 已存在则返回已有，不重复插入。
  const existing = await db
    .select({ id: researchDatasets.id })
    .from(researchDatasets)
    .where(eq(researchDatasets.datasetId, datasetId))
    .limit(1);
  if (existing.length > 0) {
    return {
      datasetId,
      datasetVersion,
      rowCount: dataset.rows.length,
      gate: dataset.gate,
      rowsFingerprint,
      policySetFingerprint,
      versionSnapshotFingerprint,
      replayed: true,
    };
  }

  const request = dataset.dataSnapshot.request;
  await db.insert(researchDatasets).values({
    datasetId,
    datasetVersion,
    name: request.name,
    startDate: request.startDate,
    endDate: request.endDate,
    asOfPerTradeDate: request.asOfPerTradeDate ? "true" : "false",
    asOf: request.asOf,
    rowsFingerprint,
    policySetFingerprint,
    versionSnapshotFingerprint,
    versionSnapshotJson,
    dataSnapshotJson: JSON.stringify(dataset.dataSnapshot),
    universeDefinitionJson: JSON.stringify(dataset.universeDefinition),
    rowCount: dataset.rows.length,
    gate: dataset.gate,
    gateNotesJson: JSON.stringify(dataset.gateNotes),
  });

  return {
    datasetId,
    datasetVersion,
    rowCount: dataset.rows.length,
    gate: dataset.gate,
    rowsFingerprint,
    policySetFingerprint,
    versionSnapshotFingerprint,
    replayed: false,
  };
}

/** 已持久化数据集列表条目（摘要，不含 rows）。 */
export interface ListedResearchDataset {
  datasetId: string;
  datasetVersion: string;
  name: string;
  startDate: string;
  endDate: string;
  rowCount: number;
  gate: string;
  /** 分片行表名（rd_rows_<buildKey>）；null = 非分片构建。 */
  rowsTableName: string | null;
  createdAt: string;
}

/** 列出已持久化数据集（按 createdAt 倒序；DB 不可用返回空，不伪造）。 */
export async function listResearchDatasets(limit = 50): Promise<ListedResearchDataset[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      datasetId: researchDatasets.datasetId,
      datasetVersion: researchDatasets.datasetVersion,
      name: researchDatasets.name,
      startDate: researchDatasets.startDate,
      endDate: researchDatasets.endDate,
      rowCount: researchDatasets.rowCount,
      gate: researchDatasets.gate,
      rowsTableName: researchDatasets.rowsTableName,
      createdAt: researchDatasets.createdAt,
    })
    .from(researchDatasets)
    .orderBy(desc(researchDatasets.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    datasetId: row.datasetId,
    datasetVersion: row.datasetVersion,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    rowCount: row.rowCount,
    gate: row.gate,
    rowsTableName: row.rowsTableName ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  }));
}

// ---------------------------------------------------------------------------
// 分片（分区）构建落库
// ---------------------------------------------------------------------------

/** 分片构建落库入参（rows 已写入行表，此处仅落元数据 + 指纹 + 行表关联）。 */
export interface PersistPartitionedInput {
  request: NormalizedResearchDatasetRequest;
  universeDefinition: UniverseDefinition;
  dataSnapshot: DataSnapshot;
  policySet: readonly ResearchDatasetPolicy[];
  datasetVersion: string;
  rowsFingerprint: string;
  /** 该数据集对应的分片行表名（rd_rows_<buildKey>）。 */
  rowsTableName: string;
  rowCount: number;
  gate: string;
  gateNotes: readonly string[];
}

/** 分片构建落库（幂等：同 datasetVersion 已存在则返回已有，不重复插入）。 */
export async function persistPartitionedDataset(
  input: PersistPartitionedInput,
): Promise<{ datasetId: string; replayed: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用，无法持久化 Research Dataset");

  const datasetId = buildDatasetId(input.datasetVersion);
  const policySetFingerprint = computePolicySetFingerprint(input.policySet);
  const versionSnapshot = buildDatasetVersionSnapshot({
    datasetVersion: input.datasetVersion,
    rowsFingerprint: input.rowsFingerprint,
    universeDefinition: input.universeDefinition,
    dataSnapshot: input.dataSnapshot,
    policySet: input.policySet,
  });
  const versionSnapshotJson = serializeVersionSnapshot(versionSnapshot);
  const versionSnapshotFingerprint = computeVersionSnapshotFingerprint(versionSnapshot);

  // 幂等：同 datasetId 已存在则返回已有，不重复插入。
  const existing = await db
    .select({ id: researchDatasets.id })
    .from(researchDatasets)
    .where(eq(researchDatasets.datasetId, datasetId))
    .limit(1);
  if (existing.length > 0) {
    return { datasetId, replayed: true };
  }

  const request = input.request;
  await db.insert(researchDatasets).values({
    datasetId,
    datasetVersion: input.datasetVersion,
    name: request.name,
    startDate: request.startDate,
    endDate: request.endDate,
    asOfPerTradeDate: request.asOfPerTradeDate ? "true" : "false",
    asOf: request.asOf,
    rowsFingerprint: input.rowsFingerprint,
    policySetFingerprint,
    versionSnapshotFingerprint,
    versionSnapshotJson,
    dataSnapshotJson: JSON.stringify(input.dataSnapshot),
    universeDefinitionJson: JSON.stringify(input.universeDefinition),
    rowCount: input.rowCount,
    gate: input.gate,
    gateNotesJson: JSON.stringify(input.gateNotes),
    rowsTableName: input.rowsTableName,
  });

  return { datasetId, replayed: false };
}
