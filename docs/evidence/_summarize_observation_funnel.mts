/**
 * 只读探针：把 Run #570001 的 13 条 CONDITIONAL 分析汇总成「漏斗表」。
 *
 * 每条分析抽 CONDITION 组的 SAMPLE_COUNT / MEAN_RETURN / MEDIAN_RETURN / WIN_RATE，
 * 以及 DIFFERENCE / T_STAT / P_VALUE，与全样本（ALL 组）对照。
 *
 * 只读：仅 SELECT。
 */
import "dotenv/config";
import mysql from "mysql2/promise";

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

const conn = await mysql.createConnection({
  ...cfg,
  ssl: { rejectUnauthorized: false },
  connectTimeout: 30_000,
});

const [analyses] = await conn.query<any[]>(
  `SELECT id, name, status FROM research_analysis WHERE runId = ? ORDER BY id`,
  [RUN_ID],
);

type Agg = {
  n?: number;
  mean?: number;
  median?: number;
  win?: number;
  allN?: number;
  allMean?: number;
  allWin?: number;
  diff?: number;
  relDiff?: number;
  t?: number;
  p?: number;
};

const pct = (v?: number) => (v === undefined ? "-" : `${(v * 100).toFixed(2)}%`);
const num = (v?: number, d = 4) => (v === undefined ? "-" : v.toFixed(d));

console.log(
  [
    "#id".padEnd(8),
    "n".padStart(7),
    "share".padStart(8),
    "mean".padStart(9),
    "median".padStart(9),
    "win".padStart(7),
    "Δmean".padStart(9),
    "t".padStart(8),
    "p".padStart(9),
    "name",
  ].join(" "),
);
console.log("-".repeat(150));

const rows: Array<Agg & { id: number; name: string }> = [];

for (const a of analyses) {
  const [res] = await conn.query<any[]>(
    `SELECT metricCode, metricValue, dimensionJson
       FROM research_result WHERE analysisId = ?`,
    [a.id],
  );
  const agg: Agg = {};
  for (const r of res) {
    const group = r.dimensionJson ? JSON.parse(r.dimensionJson).group : null;
    const code = r.metricCode as string;
    if (group === "CONDITION") {
      if (code === "SAMPLE_COUNT") agg.n = Number(r.metricValue);
      if (code === "MEAN_RETURN") agg.mean = Number(r.metricValue);
      if (code === "MEDIAN_RETURN") agg.median = Number(r.metricValue);
      if (code === "WIN_RATE") agg.win = Number(r.metricValue);
    } else if (group === "ALL") {
      if (code === "SAMPLE_COUNT") agg.allN = Number(r.metricValue);
      if (code === "MEAN_RETURN") agg.allMean = Number(r.metricValue);
      if (code === "WIN_RATE") agg.allWin = Number(r.metricValue);
    } else {
      if (code === "DIFFERENCE") agg.diff = Number(r.metricValue);
      if (code === "RELATIVE_DIFFERENCE") agg.relDiff = Number(r.metricValue);
      if (code === "T_STAT_DIFFERENCE") agg.t = Number(r.metricValue);
      if (code === "P_VALUE_DIFFERENCE") agg.p = Number(r.metricValue);
    }
  }
  rows.push({ ...agg, id: Number(a.id), name: String(a.name) });

  const share = agg.allN && agg.n !== undefined ? `${((agg.n / agg.allN) * 100).toFixed(2)}%` : "-";
  console.log(
    [
      `#${a.id}`.padEnd(8),
      String(agg.n ?? "-").padStart(7),
      share.padStart(8),
      num(agg.mean).padStart(9),
      num(agg.median).padStart(9),
      pct(agg.win).padStart(7),
      num(agg.diff).padStart(9),
      num(agg.t, 2).padStart(8),
      (agg.p === undefined ? "-" : agg.p === 0 ? "<1e-300" : agg.p.toExponential(2)).padStart(9),
      String(a.name),
    ].join(" "),
  );
}

console.log("\n--- 全样本基准 (ALL) ---");
const base = rows[0];
console.log(`总样本 n=${base?.allN}  mean=${num(base?.allMean)}  winRate=${pct(base?.allWin)}`);

await conn.end();
