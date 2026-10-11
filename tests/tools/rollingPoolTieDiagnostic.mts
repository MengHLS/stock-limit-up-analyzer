/**
 * `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` · 边界并列规模披露（规格 §3「排序破平」）。
 *
 * 规格要求：「确定性 symbol 升序＋eventId；**必须披露边界并列规模**。
 * 不能以不透明 UUID 排序悄悄决定赢家」。
 *
 * 本工具**从正式 Run 自己持久化的每日账**重建逐日候选集（与 Run 内排名用的是同一份
 * `preReturn10` / `maxAmp5` 读数），再用**既有唯一**的 `rankResolution.ts` 原语
 * 给出并列诊断 —— 不复制第二套实现、不重跑研究。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs tests/tools/rollingPoolTieDiagnostic.mts \
 *        --run RUN-20261010-D9210EBC
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { defaultExperimentRunService } from "../../server/researchExperiments/defaults";
import {
  describeRankResolution,
  judgeRankResolution,
  summarizeRankResolution,
  summarizeTieBreakSensitivity,
  type ResolutionDay,
} from "../../research-experiments/shared/singleFactor/rankResolution";

const EXPERIMENT_ID = "first-board-pullback/rolling-pool-right-tail-mvp";
const TOP_K = 3;

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1]! : null;
}

const runId = argValue("--run");
if (runId === null) {
  console.error("用法：--run <runId>");
  process.exit(2);
}

const service = defaultExperimentRunService();
const manifest = await service.readManifest(runId);
if (manifest === null) {
  console.error(`Run ${runId} 没有 Manifest`);
  process.exit(2);
}
const shardEntries = (manifest.tables ?? []).filter((entry) =>
  entry.key.includes("daily-pool-ledger-"),
);
const shardKeys = shardEntries.map((entry) => entry.key).sort();
console.log(`[tie] ledger shards = ${shardKeys.length}`);
for (const entry of shardEntries) {
  console.log(`[tie]   ${entry.key} ${entry.sizeBytes ?? "?"} B`);
}

/** 最小带引号感知的 CSV 解析。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

interface Candidate { readonly eventId: string; readonly value: number; readonly symbol: string }
const byDate = new Map<string, { R: Candidate[]; M: Candidate[] }>();

for (const key of shardKeys) {
  const { body } = await service.readArtifact(runId, key);
  const table = parseCsv(body.toString("utf8").trim());
  const header = table[0]!;
  const indexOf = (name: string): number => header.indexOf(name);
  const iDate = indexOf("date");
  const iSymbol = indexOf("symbol");
  const iEvent = indexOf("anchorEventId");
  const iElig = indexOf("signalEligible");
  const iPre = indexOf("preReturn10");
  const iAmp = indexOf("maxAmp5");
  for (const cells of table.slice(1)) {
    if (cells.length <= 1) continue;
    if (cells[iElig] !== "true") continue;
    const date = cells[iDate]!;
    const pre = Number(cells[iPre]);
    const amp = Number(cells[iAmp]);
    const bucket = byDate.get(date) ?? { R: [], M: [] };
    if (Number.isFinite(pre)) bucket.R.push({ eventId: cells[iEvent]!, value: pre, symbol: cells[iSymbol]! });
    if (Number.isFinite(amp)) bucket.M.push({ eventId: cells[iEvent]!, value: amp, symbol: cells[iSymbol]! });
    byDate.set(date, bucket);
  }
  console.log(`[tie] read ${key}`);
}

const out: Record<string, unknown> = { runId, topK: TOP_K, shardCount: shardKeys.length };
for (const arm of ["R", "M"] as const) {
  const days: ResolutionDay[] = [...byDate.entries()]
    .map(([date, bucket]) => ({
      date,
      candidates: [...bucket[arm]]
        .sort((left, right) =>
          left.symbol.localeCompare(right.symbol) || left.eventId.localeCompare(right.eventId),
        )
        .map((candidate) => ({ eventId: candidate.eventId, value: candidate.value })),
    }))
    .filter((day) => day.candidates.length > 0);
  const summary = summarizeRankResolution({ days, topK: TOP_K });
  const sensitivity = summarizeTieBreakSensitivity({ days, topK: TOP_K });
  const judgement = judgeRankResolution({ summary, sensitivity });
  out[arm] = {
    dayCount: days.length,
    summary,
    sensitivity,
    verdict: judgement.verdict,
    reasons: judgement.reasons,
    description: describeRankResolution(judgement),
  };
  console.log(`\n[${arm}] verdict=${judgement.verdict}`);
  console.log(`  ${describeRankResolution(judgement)}`);
  console.log(`  summary=${JSON.stringify(summary)}`);
  console.log(`  sensitivity=${JSON.stringify(sensitivity)}`);
}

mkdirSync(new URL("../../_scratch/fbpool/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../../_scratch/fbpool/tie-diagnostic.json", import.meta.url),
  JSON.stringify(out, null, 2),
);
console.log("\n[tie] wrote _scratch/fbpool/tie-diagnostic.json");
process.exit(0);
