/**
 * 只读探针：**走真实 tRPC 同构路径**验证「信号漏斗」端到端可取数。
 *
 * 复现前端两步：
 *   1. `getRun` → analyses（name / target / status）
 *   2. `getAnalysisResults` × N → ResultRowLike[]
 * 然后把结果喂给 `buildFunnelIndex` + `summarizeFunnel`（前端纯函数），
 * 打印出**与页面完全一致**的漏斗表。
 *
 * 只读：仅 SELECT。
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { buildFunnelIndex, summarizeFunnel, formatShare } from "../../client/src/components/research/observationFunnel.ts";

const RUN_ID = 570001;

const m = /^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(process.env.DATABASE_URL!);
if (!m) throw new Error("DATABASE_URL 解析失败");
const cfg = {
  user: decodeURIComponent(m[1]),
  password: decodeURIComponent(m[2]),
  host: m[3],
  port: Number(m[4]),
  database: m[5].split("/")[0],
};

const conn = await mysql.createConnection({ ...cfg, ssl: { rejectUnauthorized: false }, connectTimeout: 30_000 });

// --- 1. getRun ---
const [analysesRaw] = await conn.query<any[]>(
  `SELECT id, name, target, status FROM research_analysis WHERE runId = ? ORDER BY id`,
  [RUN_ID],
);
const analyses = analysesRaw.map((a) => ({
  id: Number(a.id),
  name: String(a.name),
  target: a.target === null ? null : String(a.target),
  status: String(a.status),
}));

// --- 2. getAnalysisResults × N ---
const rowsById = new Map<number, any[]>();
for (const a of analyses) {
  const [rows] = await conn.query<any[]>(
    `SELECT resultType, metricCode, metricValue, sampleCount, dimensionJson, resultJson
       FROM research_result WHERE analysisId = ? ORDER BY id`,
    [a.id],
  );
  rowsById.set(
    a.id,
    rows.map((r) => ({
      resultType: r.resultType,
      metricCode: r.metricCode,
      metricValue: r.metricValue === null ? null : Number(r.metricValue),
      sampleCount: r.sampleCount === null ? null : Number(r.sampleCount),
      dimension: r.dimensionJson === null ? null : JSON.parse(String(r.dimensionJson)),
      details: r.resultJson === null ? null : JSON.parse(String(r.resultJson)),
    })),
  );
}

// --- 3. 前端纯函数 ---
const index = buildFunnelIndex(analyses, rowsById);
const summary = summarizeFunnel(index);

console.log(`targetVariable = ${index.targetVariable}`);
console.log(`unclassified   = ${index.unclassified.length}`);
console.log(
  `全样本 ${summary.allSampleCount} · 主链有结果 ${summary.resolvedChain}/${summary.chainSize} · 链末端 ${summary.finalSampleCount}（${formatShare(summary.finalShareOfAll)}）`,
);

console.log("\n===== 主链 =====");
for (const s of index.chain) {
  const shrink = s.shrinkFromPrev === null ? "   —  " : `${(s.shrinkFromPrev * 100).toFixed(1)}%`.padStart(6);
  console.log(
    `${s.label.padEnd(30)} #${s.analysisId}  n=${String(s.conditionSampleCount).padStart(6)}` +
      `  占全样本 ${formatShare(s.shareOfAll).padStart(7)}  保留/父级 ${shrink}` +
      `  均值 ${s.valueDisplay.padStart(8)}  差值 ${s.difference === null ? "—" : s.difference.toFixed(4)}  胜率 ${s.winRateDisplay}`,
  );
}

console.log("\n===== 对照组（平行） =====");
for (const s of index.controls) {
  console.log(
    `${s.label.padEnd(30)} #${s.analysisId}  n=${String(s.conditionSampleCount).padStart(6)}` +
      `  占全样本 ${formatShare(s.shareOfAll).padStart(7)}  均值 ${s.valueDisplay.padStart(8)}  胜率 ${s.winRateDisplay}`,
  );
}

if (index.unclassified.length > 0) {
  console.log("\n===== 未归类 =====");
  for (const u of index.unclassified) console.log(`#${u.analysisId} ${u.analysisName} :: ${u.reason}`);
}

await conn.end();
