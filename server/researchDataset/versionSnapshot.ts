/**
 * STEP 12.6 — Research Dataset 版本快照产物（C-12.6.2）：纯函数、确定性、无 IO。
 *
 * 把 §12 要求的版本信息绑成一个可序列化 artifact：
 *   dataset_version + rows_fingerprint + universe_definition 摘要 + policySet
 *   + data_snapshot 摘要 + builder / rowSchema / policySchema 版本。
 *
 * 确定性纪律（与 version.ts 一致）：artifact 不含 capturedAt 等瞬时字段，
 *   同输入必同 serialize / fingerprint；内容变则 fingerprint 必变。
 * serialize/parse 为纯 stringify/parse round-trip（parse 对结构缺失响亮抛错，不静默降级）。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "./version";
import { RESEARCH_DATASET_BUILDER_VERSION, RESEARCH_DATASET_ROW_SCHEMA_VERSION } from "./types";
import { computePolicySetFingerprint, RESEARCH_DATASET_POLICY_SCHEMA_VERSION } from "./policy";
import type { ResearchDatasetPolicySet } from "./policy";
import type {
  DataSnapshot,
  DomainSnapshot,
  UniverseDefinition,
} from "./types";

/** artifact type 判别值。 */
export const RESEARCH_DATASET_VERSION_SNAPSHOT_TYPE = "research-dataset-version-snapshot" as const;

/** 快照产物 schema 版本（摘要/字段结构变更时递增）。 */
export const RESEARCH_DATASET_VERSION_SNAPSHOT_SCHEMA_VERSION = "1" as const;

/** universe_definition 摘要（小体积、可比较）。 */
export interface UniverseDefinitionSummary {
  rule: string;
  asOfDescription: string;
  /** 交易日数（days.length）。 */
  tradingDayCount: number;
  /** 全部交易日成员行数合计。 */
  memberDayCount: number;
  /** 出现的排除 reason code（去重、升序）。 */
  excludedReasonCodes: readonly string[];
}

/** 单个数据域摘要（不含 note/capturedAt 等易变与长文本）。 */
export interface DomainSnapshotSummary {
  domain: string;
  rowsLoaded: number;
  securitiesCovered: number;
  datesCovered: number;
}

/** data_snapshot 摘要（确定性；capturedAt 属瞬时字段，刻意排除）。 */
export interface DataSnapshotSummary {
  calendarName: string;
  tradingDays: number;
  coverageGapCount: number;
  domains: readonly DomainSnapshotSummary[];
}

/** 版本快照产物（序列化 round-trip 对象）。 */
export interface ResearchDatasetVersionSnapshot {
  artifactType: typeof RESEARCH_DATASET_VERSION_SNAPSHOT_TYPE;
  schemaVersion: typeof RESEARCH_DATASET_VERSION_SNAPSHOT_SCHEMA_VERSION;
  builderVersion: string;
  rowSchemaVersion: string;
  policySchemaVersion: string;
  datasetVersion: string;
  rowsFingerprint: string;
  policySetFingerprint: string;
  universeDefinition: UniverseDefinitionSummary;
  policySet: ResearchDatasetPolicySet;
  dataSnapshot: DataSnapshotSummary;
}

/** UniverseDefinition → 确定性摘要。 */
export function summarizeUniverseDefinition(universeDefinition: UniverseDefinition): UniverseDefinitionSummary {
  const reasons = new Set<string>();
  let memberDayCount = 0;
  for (const day of universeDefinition.days) {
    memberDayCount += day.members.length;
    for (const reason of Object.keys(day.excludedByReason)) reasons.add(reason);
  }
  return {
    rule: universeDefinition.rule,
    asOfDescription: universeDefinition.asOfDescription,
    tradingDayCount: universeDefinition.days.length,
    memberDayCount,
    excludedReasonCodes: Array.from(reasons).sort(),
  };
}

/** DataSnapshot → 确定性摘要（排除瞬时 capturedAt 与长文本 note）。 */
export function summarizeDataSnapshot(dataSnapshot: DataSnapshot): DataSnapshotSummary {
  const domainSummary = (domain: DomainSnapshot): DomainSnapshotSummary => ({
    domain: domain.domain,
    rowsLoaded: domain.rowsLoaded,
    securitiesCovered: domain.securitiesCovered,
    datesCovered: domain.datesCovered,
  });
  return {
    calendarName: dataSnapshot.calendarName,
    tradingDays: dataSnapshot.tradingDays,
    coverageGapCount: dataSnapshot.coverageGaps.length,
    domains: dataSnapshot.domains.map(domainSummary),
  };
}

/** 构建版本快照产物（纯函数）。 */
export function buildDatasetVersionSnapshot(input: {
  datasetVersion: string;
  rowsFingerprint: string;
  universeDefinition: UniverseDefinition;
  dataSnapshot: DataSnapshot;
  policySet: ResearchDatasetPolicySet;
}): ResearchDatasetVersionSnapshot {
  return {
    artifactType: RESEARCH_DATASET_VERSION_SNAPSHOT_TYPE,
    schemaVersion: RESEARCH_DATASET_VERSION_SNAPSHOT_SCHEMA_VERSION,
    builderVersion: RESEARCH_DATASET_BUILDER_VERSION,
    rowSchemaVersion: RESEARCH_DATASET_ROW_SCHEMA_VERSION,
    policySchemaVersion: RESEARCH_DATASET_POLICY_SCHEMA_VERSION,
    datasetVersion: input.datasetVersion,
    rowsFingerprint: input.rowsFingerprint,
    policySetFingerprint: computePolicySetFingerprint(input.policySet),
    universeDefinition: summarizeUniverseDefinition(input.universeDefinition),
    policySet: input.policySet,
    dataSnapshot: summarizeDataSnapshot(input.dataSnapshot),
  };
}

/** canonical 序列化（键字典序；同输入必同输出）。 */
export function serializeVersionSnapshot(snapshot: ResearchDatasetVersionSnapshot): string {
  return canonicalStringify(snapshot);
}

/** 结构合法性断言（缺失/错类型 → 响亮抛错；纯函数）。 */
function assertSnapshotShape(value: unknown, path: string, check: (v: unknown) => boolean): void {
  if (!check(value)) {
    throw new Error(`版本快照产物非法：字段 ${path} 缺失或类型不符`);
  }
}

/** JSON round-trip 解析：结构校验通过后返回对象（失败响亮抛错，不静默降级）。 */
export function parseVersionSnapshot(json: string): ResearchDatasetVersionSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`版本快照产物非法：JSON 解析失败（${(error as Error).message}）`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("版本快照产物非法：顶层必须是对象");
  }
  const record = parsed as Record<string, unknown>;
  assertSnapshotShape(record.artifactType, "artifactType", (v) => v === RESEARCH_DATASET_VERSION_SNAPSHOT_TYPE);
  assertSnapshotShape(record.schemaVersion, "schemaVersion", (v) => v === RESEARCH_DATASET_VERSION_SNAPSHOT_SCHEMA_VERSION);
  for (const key of [
    "builderVersion",
    "rowSchemaVersion",
    "policySchemaVersion",
    "datasetVersion",
    "rowsFingerprint",
    "policySetFingerprint",
  ]) {
    assertSnapshotShape(record[key], key, (v) => typeof v === "string");
  }
  assertSnapshotShape(record.universeDefinition, "universeDefinition", (v) => typeof v === "object" && v !== null);
  assertSnapshotShape(record.policySet, "policySet", (v) => Array.isArray(v));
  assertSnapshotShape(record.dataSnapshot, "dataSnapshot", (v) => typeof v === "object" && v !== null);
  return parsed as ResearchDatasetVersionSnapshot;
}

/** artifact 内容指纹（canonical SHA-256 前 16 hex；同内容必同指纹）。 */
export function computeVersionSnapshotFingerprint(snapshot: ResearchDatasetVersionSnapshot): string {
  const digest = createHash("sha256")
    .update(serializeVersionSnapshot(snapshot), "utf8")
    .digest("hex");
  return digest.slice(0, 16);
}
