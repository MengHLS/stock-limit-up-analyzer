/** COMPOSITE-RUNNER-DATASET-PROVIDER-001 —— 基线投影读取（文件 IO 刻意留在本模块外，
 *  以满足 `manifest.test.ts` 对 `server/researchExperiments/**` 的「不做文件系统发现」约束）。 */
import fs from "node:fs";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import type { ResearchDataset } from "./index";

const BASELINE_CACHE_GZ = path.resolve(".cache", "research-dataset-3f-top3-v5-660001.jsonl.gz");
const BASELINE_CACHE_META = BASELINE_CACHE_GZ + ".meta.json";

interface BaselineCacheMeta {
  datasetVersion: string;
  rowCount: number;
  universeDefinition: ResearchDataset["universeDefinition"];
  policySet: ResearchDataset["policySet"];
  dataSnapshot: ResearchDataset["dataSnapshot"];
  gate: ResearchDataset["gate"];
  gateNotes: ResearchDataset["gateNotes"];
}

/** 读基线 3f-top3 投影（与 PROMOTE-001 / HORIZON-001 同一工件）。 */
export async function loadCompositeBaselineProjection(): Promise<ResearchDataset> {
  const meta = JSON.parse(fs.readFileSync(BASELINE_CACHE_META, "utf8")) as BaselineCacheMeta;
  const rows: ResearchDataset["rows"][number][] = [];
  const reader = createInterface({ input: createReadStream(BASELINE_CACHE_GZ).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of reader) {
    if (line.trim() === "") continue;
    rows.push(JSON.parse(line));
  }
  if (rows.length !== meta.rowCount) {
    throw new Error(`compositeRunner: 基线投影缓存行数不符（${rows.length} ≠ ${meta.rowCount}）`);
  }
  return {
    datasetVersion: meta.datasetVersion,
    universeDefinition: meta.universeDefinition,
    policySet: meta.policySet,
    dataSnapshot: meta.dataSnapshot,
    rows: rows as ResearchDataset["rows"],
    gate: meta.gate,
    gateNotes: meta.gateNotes,
  };
}
