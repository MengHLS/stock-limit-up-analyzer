/**
 * SCOPE-002 §2.3 A2 —— Dataset 绑定的**只读**解析（供空白草稿写 PRIMARY 绑定用）。
 *
 * 纪律：
 *   - **只读**：只调 Dataset Registry 的既有仓储读方法，不写任何表；
 *   - **不猜**：查不到版本 / 查不到定义 ⇒ 返回 `null`，由调用方响亮报错；
 *   - `datasetId` 取 `dataset_definition.datasetCode`（canonical `StrategyDatasetBinding.datasetId`
 *     的语义，见 `server/research/strategySchema/definition.ts`）。
 */
import { DbDatasetRegistry } from "../../datasetRegistry/db";

export interface ResolvedAuthoringDatasetBinding {
  /** `dataset_definition.datasetCode`（如 `first_limit_pullback`）。 */
  readonly datasetId: string;
  /** 版本 label（仅展示；权威坐标是 `datasetVersionId`）。 */
  readonly datasetVersion: string;
  /** `dataset_version.id` —— 跨模块唯一坐标。 */
  readonly datasetVersionId: number;
  readonly status: "DRAFT" | "BUILDING" | "READY" | "FAILED";
  readonly startDate: string | null;
  readonly endDate: string | null;
}

/** 解析 Dataset Version 坐标；不存在 ⇒ `null`。 */
export async function resolveAuthoringDatasetBinding(
  datasetVersionId: number,
): Promise<ResolvedAuthoringDatasetBinding | null> {
  if (!Number.isInteger(datasetVersionId) || datasetVersionId <= 0) return null;
  const repo = new DbDatasetRegistry();
  const version = await repo.getVersionById(datasetVersionId);
  if (version === undefined || version.id === undefined) return null;
  const definition = await repo.getDefinitionById(version.datasetId);
  if (definition === undefined) return null;
  return {
    datasetId: definition.datasetCode,
    datasetVersion: version.version,
    datasetVersionId: version.id,
    status: version.status,
    startDate: version.startDate ?? null,
    endDate: version.endDate ?? null,
  };
}