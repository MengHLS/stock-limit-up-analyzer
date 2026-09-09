/**
 * STEP DS-V2-FINAL — Research Dataset 分片（分区）构建 CLI。
 *
 * 把数据集窗口按 chunkSize 切成若干时间分片，逐片构建并写入独立行表
 * （rd_rows_<buildKey>），最后流式计算 content-addressed datasetVersion 并落库
 * research_datasets（含 rowsTableName 关联）。避免一次性全量加载 9.8M 行到内存。
 *
 * 用法：
 *   npx tsx scripts/buildDatasetPartitioned.mts --start=2019-01-02 --end=2026-09-04 \
 *     --chunk-size=20 --boards=main,chinext --exclude-st --t-day-condition=firstBoard --data-ready
 *
 * 可选参数：
 *   --name              数据集名（默认 partitioned-dataset）
 *   --start / --end     起止日期（YYYY-MM-DD，含）
 *   --boards            板块（逗号分隔 main,chinext,star,bse；省略=全量不过滤）
 *   --exclude-st        排除 ST/*ST
 *   --t-day-condition   none | limitUp | firstBoard | consecutiveBoard（默认 none）
 *   --chunk-size        每片交易日数（默认 20）
 *   --max-securities    单日最大证券数（默认不限）
 *   --data-ready        声明数据链已就绪（无缺口时 gate=PASS）
 *   --out               报告输出路径（可选，写 JSON）
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildPartitionedDataset } from "../server/researchDataset";
import type { BoardCategory, ResearchDatasetRequest, TDayCondition } from "../server/researchDataset";

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const argv = process.argv.slice(2);
const startDate = readFlag(argv, "start") ?? readFlag(argv, "from") ?? "2019-01-02";
const endDate = readFlag(argv, "end") ?? readFlag(argv, "to") ?? "2026-09-04";
const name = readFlag(argv, "name") ?? "partitioned-dataset";
const boardsRaw = readFlag(argv, "boards") ?? "";
const excludeSt = argv.includes("--exclude-st");
const tDayCondition = (readFlag(argv, "t-day-condition") ?? "none") as TDayCondition;
const chunkSize = Number(readFlag(argv, "chunk-size") ?? "20");
const maxSecuritiesRaw = readFlag(argv, "max-securities");
const dataReady = argv.includes("--data-ready");
const out = readFlag(argv, "out");

const VALID_BOARDS: readonly BoardCategory[] = ["main", "chinext", "star", "bse"];
const boards = boardsRaw
  .split(",")
  .map((b) => b.trim())
  .filter((b) => b.length > 0) as BoardCategory[];
for (const b of boards) {
  if (!VALID_BOARDS.includes(b)) {
    console.error(`非法板块：${b}（允许 ${VALID_BOARDS.join(",")}）`);
    process.exit(1);
  }
}

const request: ResearchDatasetRequest = {
  name,
  startDate,
  endDate,
  asOfPerTradeDate: true,
  universeFilter: {
    boards: boards.length > 0 ? boards : [],
    excludeSt,
    tDayCondition,
  },
};

console.log(`[分片构建] ${startDate} ~ ${endDate}  chunk=${chunkSize}  boards=${boards.length > 0 ? boards.join(",") : "全量"}  excludeSt=${excludeSt}  tDay=${tDayCondition}  dataReady=${dataReady}`);
const startedAt = Date.now();

const result = await buildPartitionedDataset(request, {
  dataReady,
  chunkSize,
  ...(maxSecuritiesRaw ? { maxSecuritiesPerDay: Number(maxSecuritiesRaw) } : {}),
});

const elapsedMs = Date.now() - startedAt;
console.log(`\n[完成] 耗时 ${(elapsedMs / 1000).toFixed(1)}s`);
console.log(`  datasetVersion : ${result.datasetVersion}`);
console.log(`  datasetId      : ${result.datasetId}`);
console.log(`  行表           : ${result.rowsTableName}`);
console.log(`  行数           : ${result.rowCount.toLocaleString()}`);
console.log(`  分片数         : ${result.partitionCount}`);
console.log(`  gate           : ${result.gate}`);
for (const note of result.gateNotes) console.log(`    - ${note}`);

if (out) {
  const path = resolve(out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...result, elapsedMs, request }, null, 2));
  console.log(`\n报告已写：${path}`);
}
