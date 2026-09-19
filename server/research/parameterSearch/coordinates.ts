/**
 * PARAMETER-001 — 策略文档 → Dataset 权威坐标解析（**唯一实现**）。
 *
 * ## 为什么单独一个文件
 *
 * 「从策略文档里取主数据集坐标」这段判定原本内联在 `server/paramSearchRouter.ts#resolveStrategyEvaluation`。
 * PARAMETER-001 的创建流程需要**同一判定**（Run 的 FIXED 参数之一 = `datasetVersionId`）。
 * 复制一份 = 制造「两处判定、必然漂移」⇒ 抽到这里，两边都调它。
 *
 * ## 判定顺序（与既有实现逐字一致，未改语义）
 *
 * 1. `document.definition.datasets` 里 `role === "PRIMARY"` 的绑定；
 * 2. 否则取 `datasets[0]`；
 * 3. 否则回落 `document.datasetVersionId`（v1 兼容字段）；
 * 4. 都没有 ⇒ `null`（**不猜**：调用方必须把 null 如实登记为「无绑定坐标」）。
 *
 * 🔴 label 与 id 不是一回事：`document.datasetVersion`（如 `v2` / `rd-…`）**只是显示用 label**，
 *   跨模块唯一权威坐标是 `datasetVersionId`（→ `dataset_version.id`）。
 */

import type { StrategyDocument } from "../strategySchema/types";

/** 解析策略文档绑定的主数据集坐标。 */
export function resolvePrimaryDatasetVersionId(document: StrategyDocument): number | null {
  const datasets = document.definition?.datasets;
  const primary =
    datasets?.find((binding) => binding.role === "PRIMARY") ?? (datasets?.length ? datasets[0] : undefined);
  const resolved = primary?.datasetVersionId ?? document.datasetVersionId ?? null;
  return resolved === undefined ? null : resolved;
}

/** 解析策略文档绑定的主数据集 label（**仅展示**，不是坐标）。 */
export function resolvePrimaryDatasetVersionLabel(document: StrategyDocument): string | null {
  const datasets = document.definition?.datasets;
  const primary =
    datasets?.find((binding) => binding.role === "PRIMARY") ?? (datasets?.length ? datasets[0] : undefined);
  return primary?.datasetVersion ?? document.datasetVersion ?? null;
}
