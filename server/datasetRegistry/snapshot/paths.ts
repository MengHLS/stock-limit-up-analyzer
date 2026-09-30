import path from "node:path";
import {
  DATASET_SNAPSHOT_FILE_NAME,
  DATASET_SNAPSHOT_MANIFEST_FILE_NAME,
} from "./manifest";

export const DEFAULT_DATASET_SNAPSHOT_ROOT = path.join(".cache", "datasets");

export function datasetSnapshotRoot(cwd = process.cwd()): string {
  const configured = process.env.DATASET_SNAPSHOT_DIR?.trim();
  if (!configured) return path.resolve(cwd, DEFAULT_DATASET_SNAPSHOT_ROOT);
  return path.resolve(cwd, configured);
}

export function datasetSnapshotVersionDir(
  datasetVersionId: number,
  cwd = process.cwd(),
): string {
  return path.join(datasetSnapshotRoot(cwd), String(datasetVersionId));
}

export function datasetSnapshotSqlitePath(datasetVersionId: number, cwd = process.cwd()): string {
  return path.join(
    datasetSnapshotVersionDir(datasetVersionId, cwd),
    DATASET_SNAPSHOT_FILE_NAME,
  );
}

export function datasetSnapshotManifestPath(datasetVersionId: number, cwd = process.cwd()): string {
  return path.join(
    datasetSnapshotVersionDir(datasetVersionId, cwd),
    DATASET_SNAPSHOT_MANIFEST_FILE_NAME,
  );
}

export function isTemporarySnapshotDirectory(name: string): boolean {
  return name.startsWith(".tmp-");
}
