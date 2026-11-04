import { DbDatasetRegistry } from "../db";
import { DbDatasetDataReader, type DatasetDataReader } from "../query";
import type { DatasetRegistryRepository } from "../registry";
import { DatasetSnapshotStore } from "./store";
import { SnapshotAwareDatasetDataReader } from "./awareReader";
import { DatasetSnapshotTaskManager } from "./taskManager";
import type { FirstLimitPullbackEvent } from "../types";
import {
  defaultDatasetIdentityProvider,
  type DatasetIdentityProvider,
} from "../../runWorkbenchAssembly/datasetIdentityProvider";

export type DatasetMetadataReader = Pick<
  DatasetRegistryRepository,
  "getVersionById" | "getDefinitionById"
>;

let storeCache: DatasetSnapshotStore | null = null;
let metadataReaderCache: DatasetMetadataReader | null = null;
let contentReaderCache: SnapshotAwareDatasetDataReader | null = null;
let taskManagerCache: DatasetSnapshotTaskManager | null = null;

export function defaultDatasetSnapshotStore(): DatasetSnapshotStore {
  storeCache ??= new DatasetSnapshotStore();
  return storeCache;
}

export function defaultDatasetMetadataReader(): DatasetMetadataReader {
  metadataReaderCache ??= new DbDatasetRegistry();
  return metadataReaderCache;
}

export function defaultDatasetContentReader(): SnapshotAwareDatasetDataReader {
  contentReaderCache ??= new SnapshotAwareDatasetDataReader({
    store: defaultDatasetSnapshotStore(),
    dbReader: new DbDatasetDataReader(),
    fallbackIdentityResolver: (
      datasetVersionId: number,
      events: readonly FirstLimitPullbackEvent[],
    ) => defaultDatasetIdentityProvider.resolveSecurityIdsByEvent(datasetVersionId, events),
  });
  return contentReaderCache;
}

export function defaultDatasetSnapshotTaskManager(): DatasetSnapshotTaskManager {
  taskManagerCache ??= new DatasetSnapshotTaskManager({
    store: defaultDatasetSnapshotStore(),
  });
  return taskManagerCache;
}

export interface DatasetContentDependencies {
  store: DatasetSnapshotStore;
  metadataReader: DatasetMetadataReader;
  reader: DatasetDataReader;
  /**
   * 身份映射提供者（事件 → canonical `sec_<uuid>`）。
   *
   * 与 `reader` 同源：有效快照存在时走 `event_identity`，否则回退 DB Identifier History。
   * 直读桥只依赖本接口，不再直接调用 `loadPrimaryIdentifiers`，从而在快照模式下
   * 完全不触碰 Identifier History 表。
   */
  identityProvider: DatasetIdentityProvider;
}

export function defaultDatasetContentDependencies(): DatasetContentDependencies {
  const reader = defaultDatasetContentReader();
  return {
    store: defaultDatasetSnapshotStore(),
    metadataReader: defaultDatasetMetadataReader(),
    reader,
    identityProvider: reader,
  };
}
