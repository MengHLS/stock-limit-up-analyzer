/**
 * RESEARCH-006.2 — Dataset Version **只读端口**的真实实现（走 Dataset Registry）。
 *
 * 为什么需要它：登记候选时必须校验「研究来源 Dataset Version 存在 ∧ READY」（006.0 §11.2 第 4 步），
 * 而校验依据只能是 Registry（006.0 §9：「禁复制 Registry 版本表、禁绕 Registry 直读 `ds_*`」）。
 *
 * 依赖方向：本文件属**桥**，只**依赖** Registry，**不**被 Registry 依赖
 * （由 `importBoundary.test.ts` 守护反向依赖）。
 *
 * 与 `researchEngineRouter` 的既有写法保持一致（`new DbDatasetRegistry()`，惰性连接）。
 */

import { DbDatasetRegistry } from "../../datasetRegistry/db";
import type { DatasetVersionReadPort, DatasetVersionSnapshot } from "./service";

/** 只暴露登记候选 / 转正所需的事实（label / status / datasetId / datasetCode）；不复制 Registry 领域对象。 */
export class RegistryDatasetVersionReadPort implements DatasetVersionReadPort {
  private readonly registry: DbDatasetRegistry;

  constructor(registry: DbDatasetRegistry = new DbDatasetRegistry()) {
    this.registry = registry;
  }

  async getVersionById(datasetVersionId: number): Promise<DatasetVersionSnapshot | undefined> {
    const version = await this.registry.getVersionById(datasetVersionId);
    if (!version) return undefined;
    // RESEARCH-006.3：转正时 `definition.datasets[PRIMARY].datasetId` 需要正确的业务码，
    // 因此这里再读一次对应的 `dataset_definition`（**只读**；仍然不复制 Registry 的任何表）。
    // 读不到 definition 时**不猜**：`datasetCode` 保持缺省，由 promote 响亮拒绝。
    const definition = await this.registry.getDefinitionById(version.datasetId);
    return {
      datasetVersionId: version.id ?? datasetVersionId,
      label: version.version,
      status: version.status,
      datasetId: version.datasetId,
      ...(definition?.datasetCode === undefined ? {} : { datasetCode: definition.datasetCode }),
    };
  }
}
