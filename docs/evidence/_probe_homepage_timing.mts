/**
 * 首页（HOMEPAGE）加载耗时基线探针（**只读**）。
 *
 * 量「首屏慢」到底慢在哪一段，并对比「四指数」三种取数形态：
 *   ① 单只 ×4 **串行**
 *   ② 单只 ×4 **并行 Promise.all**
 *   ③ **单条 SQL + 窗口函数**（partition by indexCode）一次取回四只
 *
 * 性能判据按项目惯例：**交错 ≥3 轮取中位数**（排除 TiDB 冷启动首连假慢、
 * 以及连接池瞬时抖动），不采信单次采样。
 *
 * 用法：npx tsx docs/evidence/_probe_homepage_timing.mts
 */
import "dotenv/config";
import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { getBoardRoster } from "../../server/boardRoster";
import {
  getDailySectorDistribution,
  getDb,
  getDistinctDates,
  getIndexDailySeries,
  getLimitUpWithMarketData,
} from "../../server/db";

const INDEX_CODES = ["000001.SH", "399001.SZ", "000300.SH", "000905.SH"];
const ROUNDS = 3;

/** 单条 SQL + 窗口函数：一次取回多只指数各自最近 N 个交易日。 */
async function getIndexDailySeriesMulti(codes: string[], days: number) {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    select indexCode, tradeDate, open, high, low, close, amount, volume from (
      select indexCode, tradeDate, open, high, low, close, amount, volume,
             row_number() over (partition by indexCode order by tradeDate desc) as rn
      from index_daily
      where indexCode in (${sql.join(
        codes.map((code) => sql`${code}`),
        sql`, `,
      )})
    ) t where rn <= ${days}
    order by indexCode, tradeDate
  `);
  return ((result as unknown as [unknown[]])[0] ?? []) as unknown[];
}

const dates = await getDistinctDates();
const latest = dates[0] ?? "";

type Job = { label: string; fn: () => Promise<unknown[]> };
const jobs: Job[] = [
  { label: "① 单只 getIndexDailySeries ×1 (120)", fn: () => getIndexDailySeries("000001.SH", 120) },
  {
    label: "② 四指数 串行",
    fn: async () => {
      const out: unknown[] = [];
      for (const code of INDEX_CODES) out.push(await getIndexDailySeries(code, 120));
      return out;
    },
  },
  {
    label: "③ 四指数 并行 Promise.all",
    fn: () => Promise.all(INDEX_CODES.map((code) => getIndexDailySeries(code, 120))),
  },
  { label: "④ 四指数 单条窗口函数 SQL", fn: () => getIndexDailySeriesMulti(INDEX_CODES, 120) },
  { label: "⑤ getLimitUpWithMarketData(30)", fn: () => getLimitUpWithMarketData(30) },
  { label: "⑥ getSectorDistribution", fn: () => getDailySectorDistribution() },
  { label: `⑦ getBoardRoster(${latest})`, fn: async () => [await getBoardRoster(latest)] },
];

/** 每轮每个 job 的耗时（ms）。 */
const samples = new Map<string, number[]>();
for (let round = 0; round < ROUNDS; round += 1) {
  for (const job of jobs) {
    const started = performance.now();
    await job.fn();
    const ms = Math.round(performance.now() - started);
    const list = samples.get(job.label) ?? [];
    list.push(ms);
    samples.set(job.label, list);
  }
}

const median = (list: number[]) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

console.log(
  JSON.stringify(
    {
      latestDate: latest,
      rounds: ROUNDS,
      results: jobs.map((job) => {
        const list = samples.get(job.label) ?? [];
        return { label: job.label, samplesMs: list, medianMs: median(list) };
      }),
    },
    null,
    2,
  ),
);
process.exit(0);
