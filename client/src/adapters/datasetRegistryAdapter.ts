/**
 * datasetRegistryAdapter — Dataset Registry 前端 ViewModel 适配层（STEP DATASET-002.3）。
 *
 * 定位（任务 §十二 / §十七）：
 *   - API（tRPC wire DTO，见 `@shared/datasetRegistryContracts`）→ ViewModel → UI；
 *   - UI 不直接消费后端 DTO，也不在 JSX 里做 `as any` / 字段强转 / bigint 兼容；
 *   - 所有 bigint(mode:"number") → number、Date → ISO string、null/undefined 归一、status enum
 *     在此统一收敛；
 *   - **不重算任何量化判定**：status / 统计 / progress 均为后端事实的展示映射，不臆造。
 *
 * 与旧 `datasetAdapter.ts`（Research Dataset 构建器配置）严格分离。
 */

import type {
  DatasetBuildCheckpointSummary,
  DatasetBuildJobDetail,
  DatasetBuildJobListItem,
  DatasetDefinitionListItem,
  DatasetStatistics,
  DatasetVersionListItem,
} from "@shared/datasetRegistryContracts";
import type { DiagnosticError } from "@/components/common";

// ---------------------------------------------------------------------------
// 格式化工具
// ---------------------------------------------------------------------------

/** ISO 时间 → 本地 `YYYY-MM-DD HH:mm`；null/非法 → "—"。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 千分位数字；null → "—"。 */
export function formatCount(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// ViewModel 类型
// ---------------------------------------------------------------------------

export interface DatasetListRowVm {
  id: number;
  datasetCode: string;
  name: string;
  description: string | null;
  datasetType: string;
  status: string;
  versionCount: number;
  latestVersion: string | null;
  latestVersionStatus: string | null;
  updatedAt: string | null;
}

export interface VersionListItemVm {
  id: number;
  datasetId: number;
  version: string;
  status: string;
  dateRange: string;
  featureVersion: string | null;
  sourceVersion: string | null;
  totalEvents: number | null;
  totalRows: number | null;
  createdAt: string | null;
  completedAt: string | null;
}

export interface BuildJobVm {
  id: number;
  datasetVersionId: number;
  jobId: string;
  status: string;
  /** 0..100；无法推断（缺 chunk 信息）时为 null。 */
  progressPercent: number | null;
  processedRows: number | null;
  failedRows: number | null;
  totalChunks: number | null;
  completedChunks: number | null;
  currentChunk: number | null;
  lastSymbol: string | null;
  lastTradeDate: string | null;
  /** lastCursor 的技术摘要（非原始 JSON）。 */
  checkpointSummary: DatasetBuildCheckpointSummary | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface StatisticsVm {
  version: string;
  status: string;
  eventCount: number;
  pathCount: number;
  outcomeCount: number;
  rowCount: number;
  firstDate: string | null;
  lastDate: string | null;
  horizons: number[];
  declaredEvents: number | null;
  declaredRows: number | null;
}

// ---------------------------------------------------------------------------
// DTO → ViewModel 映射
// ---------------------------------------------------------------------------

/** 列表行：Definition + 该定义下全部 Version → 聚合版本元信息。 */
export function buildDatasetListRow(
  definition: DatasetDefinitionListItem,
  versions: DatasetVersionListItem[],
): DatasetListRowVm {
  // 版本按 id 升序来自后端；最新 = 最高 id（最近创建）。
  const latest = versions.length > 0 ? versions[versions.length - 1] : null;
  return {
    id: definition.id,
    datasetCode: definition.datasetCode,
    name: definition.name,
    description: definition.description,
    datasetType: definition.datasetType,
    status: definition.status,
    versionCount: versions.length,
    latestVersion: latest?.version ?? null,
    latestVersionStatus: latest?.status ?? null,
    updatedAt: definition.updatedAt ?? null,
  };
}

export function versionToVm(v: DatasetVersionListItem): VersionListItemVm {
  const dateRange =
    v.startDate && v.endDate ? `${v.startDate} → ${v.endDate}` : v.startDate ? `${v.startDate} → —` : "—";
  return {
    id: v.id,
    datasetId: v.datasetId,
    version: v.version,
    status: v.status,
    dateRange,
    featureVersion: v.featureVersion,
    sourceVersion: v.sourceVersion,
    totalEvents: v.totalEvents,
    totalRows: v.totalRows,
    createdAt: v.createdAt,
    completedAt: v.completedAt,
  };
}

/** 作业进度：优先 chunk 比例；COMPLETED 恒 100；信息不足 → null。 */
function jobProgress(j: DatasetBuildJobListItem): number | null {
  if (j.status === "COMPLETED") return 100;
  if (j.totalChunks !== null && j.totalChunks !== undefined && j.totalChunks > 0 && j.completedChunks !== null && j.completedChunks !== undefined) {
    const pct = Math.round((j.completedChunks / j.totalChunks) * 100);
    return Math.min(100, Math.max(0, pct));
  }
  return null;
}

export function jobToVm(j: DatasetBuildJobListItem | DatasetBuildJobDetail): BuildJobVm {
  const checkpoint = "checkpointSummary" in j ? j.checkpointSummary : null;
  return {
    id: j.id,
    datasetVersionId: j.datasetVersionId,
    jobId: j.jobId,
    status: j.status,
    progressPercent: jobProgress(j),
    processedRows: j.processedRows,
    failedRows: j.failedRows,
    totalChunks: j.totalChunks,
    completedChunks: j.completedChunks,
    currentChunk: j.currentChunk,
    lastSymbol: j.lastSymbol,
    lastTradeDate: j.lastTradeDate,
    checkpointSummary: checkpoint,
    startedAt: j.startedAt,
    updatedAt: j.updatedAt,
    completedAt: j.completedAt,
    errorMessage: j.errorMessage,
  };
}

export function statisticsToVm(s: DatasetStatistics): StatisticsVm {
  return {
    version: s.version,
    status: s.status,
    eventCount: s.actual.eventCount,
    pathCount: s.actual.pathCount,
    outcomeCount: s.actual.outcomeCount,
    rowCount: s.actual.rowCount,
    firstDate: s.actual.firstDate,
    lastDate: s.actual.lastDate,
    horizons: s.actual.horizons,
    declaredEvents: s.declared.totalEvents,
    declaredRows: s.declared.totalRows,
  };
}

// ---------------------------------------------------------------------------
// 错误 → DiagnosticError（复用公共 ErrorState 结构）
// ---------------------------------------------------------------------------

/** 把 tRPC 错误转成可读的 DiagnosticError（不裸抛错误码）。 */
export function rpcErrorToDiagnostic(
  message: string,
  opts: { title?: string; code?: string } = {},
): DiagnosticError {
  return {
    code: opts.code ?? "RPC_ERROR",
    title: opts.title ?? "Dataset Registry 请求失败",
    explanation: "后端查询抛出异常，未能返回数据。",
    suggestions: [
      "确认后端服务与数据库连接正常",
      "确认 URL 中的 ID 正确",
      "查看下方技术详情中的原始错误信息",
    ],
    technical: message,
  };
}
