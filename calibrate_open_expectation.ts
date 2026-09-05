/**
 * 「次日开盘预期三档」默认参数表校准工具。
 *
 * 运行（需 .env 中 DATABASE_URL 指向可达的真实库，可能需数分钟加载全量价格映射）：
 *   npx tsx calibrate_open_expectation.ts
 *
 * 输出 stdout JSON：overall/buckets（每档 n/mean/median/q25/q75/p10/p90/positiveRate/nearLimitUpRate）
 * 与 timeSplit（前 60% 日期校准段 vs 后 40% 验证段的分布稳定性）。
 *
 * 拿到结果后，把每档 median→center、q25→lower、q75→upper 写入两处默认表：
 *   1) server/openExpectation.ts 的 OPEN_EXPECTATION_DEFAULT_TABLE
 *   2) client/src/pages/Backtest.tsx 的 OPEN_EXPECTATION_DEFAULT_CONFIG（保持与服务端一致）
 * 并把本文件头部「经验初值」注释替换为校准日期与样本数。
 */
import "dotenv/config";
import { getLeaderCandidateBacktest } from "./server/db";

const BUCKETS: Array<{ key: string; label: string; from: string; to: string }> = [
  { key: "b_0930_1000", label: "早盘板(09:30-10:00)", from: "09:30:00", to: "10:00:00" },
  { key: "b_1000_1130", label: "上午板(10:00-11:30)", from: "10:00:00", to: "11:30:00" },
  { key: "b_1300_1400", label: "午后板(13:00-14:00)", from: "13:00:00", to: "14:00:00" },
  { key: "b_1400_1500", label: "尾盘板(14:00-15:00)", from: "14:00:00", to: "15:00:00" },
];

const pct = (arr: number[], q: number): number => {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const mean = (arr: number[]) => (arr.length === 0 ? NaN : arr.reduce((s, v) => s + v, 0) / arr.length);
const round = (v: number, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

async function main() {
  const t0 = Date.now();
  const result = await getLeaderCandidateBacktest({});
  const rows = result.historicalRows;
  console.error(`加载完成 ${rows.length} 行, 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const samples: Array<{ date: string; limitUpTime: string; premium: number }> = [];
  for (const row of rows) {
    if (row.limitUpTime == null) continue;
    if (row.nextOpenPremium == null || !Number.isFinite(row.nextOpenPremium)) continue;
    if (row.suspendedAfterSignal) continue;
    if (Math.abs(row.nextOpenPremium) > 30) continue; // 剔除疑似除权/数据异常
    samples.push({ date: row.date, limitUpTime: row.limitUpTime, premium: row.nextOpenPremium });
  }
  samples.sort((a, b) => a.date.localeCompare(b.date) || a.limitUpTime.localeCompare(b.limitUpTime));
  console.error(`有效样本 ${samples.length}`);

  const byBucket = new Map<string, typeof samples>();
  for (const b of BUCKETS) byBucket.set(b.key, []);
  for (const s of samples) {
    const hit = BUCKETS.find((b) => s.limitUpTime >= b.from && s.limitUpTime < b.to) ?? (s.limitUpTime < "09:30:00" ? BUCKETS[0] : BUCKETS[BUCKETS.length - 1]);
    byBucket.get(hit.key)!.push(s);
  }

  const overall = samples.map((s) => s.premium);
  const summarize = (arr: number[]) => ({
    n: arr.length,
    mean: round(mean(arr)),
    median: round(pct(arr, 0.5)),
    q25: round(pct(arr, 0.25)),
    q75: round(pct(arr, 0.75)),
    p10: round(pct(arr, 0.1)),
    p90: round(pct(arr, 0.9)),
    positiveRate: arr.length ? round(arr.filter((v) => v > 0).length / arr.length * 100) : null,
    nearLimitUpRate: arr.length ? round(arr.filter((v) => v >= 9.8).length / arr.length * 100) : null,
  });

  const out: any = {
    appliedMinScore: result.appliedMinScore,
    totalSamples: samples.length,
    overall: summarize(overall),
    buckets: BUCKETS.map((b) => ({ key: b.key, label: b.label, ...summarize(byBucket.get(b.key)!.map((s) => s.premium)) })),
  };

  // 时间切分描述：按信号日前后 60/40 观察两段分布是否稳定
  const dates = Array.from(new Set(samples.map((s) => s.date))).sort();
  const cutIdx = Math.floor(dates.length * 0.6);
  const cutDate = dates[cutIdx];
  const train = samples.filter((s) => s.date <= cutDate);
  const test = samples.filter((s) => s.date > cutDate);
  out.timeSplit = {
    cutDate,
    trainDates: dates.filter((d) => d <= cutDate).length,
    testDates: dates.filter((d) => d > cutDate).length,
    train: summarize(train.map((s) => s.premium)),
    test: summarize(test.map((s) => s.premium)),
    perBucketTest: BUCKETS.map((b) => {
      const arr = byBucket.get(b.key)!.filter((s) => s.date > cutDate).map((s) => s.premium);
      return { key: b.key, ...summarize(arr) };
    }),
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
