import { z } from "zod";
import type { DatasetVersionCounts } from "../query";

export const DATASET_SNAPSHOT_FORMAT_VERSION = 1 as const;
export const DATASET_SNAPSHOT_EXPORTER_VERSION = "1";
export const DATASET_SNAPSHOT_FILE_NAME = "dataset.sqlite";
export const DATASET_SNAPSHOT_MANIFEST_FILE_NAME = "manifest.json";

export interface DatasetSnapshotManifest {
  formatVersion: typeof DATASET_SNAPSHOT_FORMAT_VERSION;
  exporterVersion: string;
  datasetVersionId: number;
  datasetId: number;
  definition: {
    id: number;
    datasetCode: string;
    name: string;
  };
  version: {
    id: number;
    datasetId: number;
    label: string;
    status: "READY";
    startDate: string | null;
    endDate: string | null;
  };
  counts: DatasetVersionCounts;
  firstDate: string | null;
  lastDate: string | null;
  horizons: number[];
  pathRelativeDayRange: { min: number; max: number } | null;
  postRelativeDayRange: { min: number; max: number } | null;
  identityCount: number;
  sqlite: {
    fileName: typeof DATASET_SNAPSHOT_FILE_NAME;
    size: number;
    sha256: string;
  };
  exportedAt: string;
}

const countSchema = z.object({
  eventCount: z.number().int().nonnegative(),
  prefixCount: z.number().int().nonnegative(),
  postCount: z.number().int().nonnegative(),
  pathCount: z.number().int().nonnegative(),
  outcomeCount: z.number().int().nonnegative(),
  rowCount: z.number().int().nonnegative(),
  firstDate: z.string().nullable(),
  lastDate: z.string().nullable(),
  horizons: z.array(z.number().int().nonnegative()),
});

export const datasetSnapshotManifestSchema = z.object({
  formatVersion: z.literal(DATASET_SNAPSHOT_FORMAT_VERSION),
  exporterVersion: z.string().min(1),
  datasetVersionId: z.number().int().positive(),
  datasetId: z.number().int().positive(),
  definition: z.object({
    id: z.number().int().positive(),
    datasetCode: z.string().min(1),
    name: z.string(),
  }),
  version: z.object({
    id: z.number().int().positive(),
    datasetId: z.number().int().positive(),
    label: z.string().min(1),
    status: z.literal("READY"),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
  }),
  counts: countSchema,
  firstDate: z.string().nullable(),
  lastDate: z.string().nullable(),
  horizons: z.array(z.number().int().nonnegative()),
  pathRelativeDayRange: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
  postRelativeDayRange: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
  identityCount: z.number().int().nonnegative(),
  sqlite: z.object({
    fileName: z.literal(DATASET_SNAPSHOT_FILE_NAME),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  }),
  exportedAt: z.string().datetime(),
});

export function parseDatasetSnapshotManifest(value: unknown): DatasetSnapshotManifest {
  return datasetSnapshotManifestSchema.parse(value) as DatasetSnapshotManifest;
}
