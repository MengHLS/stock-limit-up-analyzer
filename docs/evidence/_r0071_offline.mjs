/**
 * RESEARCH-007.1 — 离线交叉验证（**只读**，非产品口径）。
 *
 * 目的：产品变量层目前造不出 `holds_event_open_{d}d`（基准 = 事件日开盘价、按决策日滚动），
 * 因此「真正的有效回撤 5×5」无法通过 Analysis Engine 得到。本脚本用**只读 SQL**
 * 直接按研究定义算出该 5×5，作为**离线参考**，用来回答：
 *   ① 数据集里判定所需原料是否齐全（prefix.open / post.low / post.close）；
 *   ② 若补齐变量，5×5 大致长什么样；
 *   ③ 与产品口径（组 B，无破位约束）差多少 —— 量化「破位约束」的影响。
 *
 * ⚠️ 本结果**不是**产品功能产出，不得写入 research_result，也不得当作已验收结论。
 *
 * 用法：node _r0071_offline_mtd.mjs
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { writeFileSync } from "node:fs";

const DV = 390002;
const BUCKETS = [
  { key: "0~2%", lo: 0, hi: 0.02 },
  { key: "2~4%", lo: 0.02, hi: 0.04 },
  { key: "4~6%", lo: 0.04, hi: 0.06 },
  { key: "6~8%", lo: 0.06, hi: 0.08 },
  { key: "8%+", lo: 0.08, hi: null },
];

const conn = await createConnection(process.env.DATABASE_URL);

const [bars] = await conn.query(
  `SELECT eventId, relativeDay, open, high, low, close
     FROM ds_first_limit_pullback_prefix WHERE datasetVersionId = ?`,
  [DV],
);
const [posts] = await conn.query(
  `SELECT eventId, relativeDay, open, high, low, close
     FROM ds_first_limit_pullback_post WHERE datasetVersionId = ?`,
  [DV],
);

/** eventId → { d0: bar, post: Map<rd, bar> } */
const byEvent = new Map();
for (const r of bars) {
  if (r.relativeDay !== 0) continue;
  byEvent.set(r.eventId, { d0: r, post: new Map() });
}
for (const r of posts) {
  const e = byEvent.get(r.eventId);
  if (e) e.post.set(r.relativeDay, r);
}

/** 5×5：key = `${d}|${bucket}` → 样本数组 */
const cells = new Map();
const perDayAll = new Map(); // d → 「已回撤」（depth>0，无破位约束）
const perDayEligible = new Map(); // d → 「未破开盘价 且 已回撤」
let eventsWithD0 = 0;
let missingOpen = 0;

for (const [, e] of byEvent) {
  const d0 = e.d0;
  if (d0.close === null || d0.open === null) {
    missingOpen += 1;
    continue;
  }
  eventsWithD0 += 1;
  let runningLow = Number.POSITIVE_INFINITY;
  for (let d = 1; d <= 5; d += 1) {
    const bar = e.post.get(d);
    if (!bar || bar.low === null) {
      runningLow = Number.NaN; // 数据不完整 ⇒ 该 d 不可判（不插补）
      continue;
    }
    runningLow = Math.min(runningLow, bar.low);
    const eligible = Number.isFinite(runningLow) && runningLow >= d0.open;

    if (bar.close === null) continue;
    const depth = (d0.close - bar.close) / d0.close; // > 0 = 回撤
    if (!(depth > 0)) continue; // non_pullback 不进任何桶

    // 结果：以 T+d 收盘为研究买入价，未来 5 日（rd = d+1 .. d+5）
    const fwd = [];
    for (let k = d + 1; k <= d + 5; k += 1) {
      const b = e.post.get(k);
      if (!b) break;
      fwd.push(b);
    }
    if (fwd.length < 5) continue; // 尾部数据不足 ⇒ 不产生错误收益
    const entry = bar.close;
    const last = fwd[4].close;
    if (last === null) continue;
    const ret5 = last / entry - 1;
    const highs = fwd.map((b) => b.high).filter((x) => x !== null);
    const closes = fwd.map((b) => b.close).filter((x) => x !== null);
    if (highs.length < 5 || closes.length < 5) continue;
    const maxRet = Math.max(...highs) / entry - 1;
    const maxDd = Math.min(...closes) / entry - 1;

    const rec = { eligible, depth, ret5, maxRet, maxDd };
    if (!perDayAll.has(d)) perDayAll.set(d, []);
    perDayAll.get(d).push(rec);
    if (eligible) {
      if (!perDayEligible.has(d)) perDayEligible.set(d, []);
      perDayEligible.get(d).push(rec);
      const b = BUCKETS.find((x) => depth >= x.lo && (x.hi === null ? true : depth <= x.hi) && depth > 0);
      if (b) {
        const key = `${d}|${b.key}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(rec);
      }
    }
  }
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const win = (a) => (a.length ? a.filter((x) => x > 0).length / a.length : null);
const pct = (v, d = 2) => (v === null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);

const L = [];
L.push(`# RESEARCH-007.1 — 离线交叉验证（**非产品口径**，只读 SQL）`);
L.push("");
L.push(`Dataset Version ${DV}｜有 rd=0 行的事件 ${eventsWithD0} 个｜rd=0 缺 open/close ${missingOpen} 个`);
L.push("");

L.push(`## 1. 「破位约束」对样本量的影响（以 T+d 收盘建仓、未来 5 日）`);
L.push("");
L.push(`| 决策日 | 已回撤(无约束) | 未破开盘价 且 已回撤 | 保留比例 |`);
L.push(`|---|---:|---:|---:|`);
for (const d of [1, 2, 3, 4, 5]) {
  const a = perDayAll.get(d)?.length ?? 0;
  const b = perDayEligible.get(d)?.length ?? 0;
  L.push(`| T+${d} | ${a} | ${b} | ${a ? pct(b / a, 1) : "—"} |`);
}
L.push("");

L.push(`## 2. 真·有效回撤 5×5（未破开盘价 且 回撤深度落桶）→ 之后 5 日收益`);
L.push("");
L.push(`| 决策日 \\ 桶 | ${BUCKETS.map((b) => b.key).join(" | ")} |`);
L.push(`|---|${BUCKETS.map(() => "---:").join("|")}|`);
for (const d of [1, 2, 3, 4, 5]) {
  const row = BUCKETS.map((b) => {
    const arr = (cells.get(`${d}|${b.key}`) ?? []).map((x) => x.ret5);
    if (!arr.length) return "—";
    return `${arr.length} / ${pct(mean(arr))} / ${pct(median(arr))} / ${pct(win(arr), 1)}`;
  });
  L.push(`| **T+${d}** | ${row.join(" | ")} |`);
}
L.push("");
L.push(`（格式 = 样本数 / 均值 / 中位 / 胜率）`);
L.push("");

L.push(`## 3. 真·有效回撤 5×5 — 均值矩阵`);
L.push("");
L.push(`| 决策日 \\ 桶 | ${BUCKETS.map((b) => b.key).join(" | ")} |`);
L.push(`|---|${BUCKETS.map(() => "---:").join("|")}|`);
for (const d of [1, 2, 3, 4, 5]) {
  const row = BUCKETS.map((b) => pct(mean((cells.get(`${d}|${b.key}`) ?? []).map((x) => x.ret5))));
  L.push(`| **T+${d}** | ${row.join(" | ")} |`);
}
L.push("");

L.push(`## 4. 真·有效回撤 — 样本数矩阵`);
L.push("");
L.push(`| 决策日 \\ 桶 | ${BUCKETS.map((b) => b.key).join(" | ")} |`);
L.push(`|---|${BUCKETS.map(() => "---:").join("|")}|`);
for (const d of [1, 2, 3, 4, 5]) {
  const row = BUCKETS.map((b) => String((cells.get(`${d}|${b.key}`) ?? []).length));
  L.push(`| **T+${d}** | ${row.join(" | ")} |`);
}
L.push("");

L.push(`## 5. 真·有效回撤 5×5 — 最大有利偏移 / 最深跌幅（均值）`);
L.push("");
for (const [label, field] of [["最大有利偏移", "maxRet"], ["最深跌幅", "maxDd"]]) {
  L.push(`**${label}**`);
  L.push("");
  L.push(`| 决策日 \\ 桶 | ${BUCKETS.map((b) => b.key).join(" | ")} |`);
  L.push(`|---|${BUCKETS.map(() => "---:").join("|")}|`);
  for (const d of [1, 2, 3, 4, 5]) {
    const row = BUCKETS.map((b) => pct(mean((cells.get(`${d}|${b.key}`) ?? []).map((x) => x[field]))));
    L.push(`| **T+${d}** | ${row.join(" | ")} |`);
  }
  L.push("");
}

writeFileSync("_r0071_offline_mtd.md", L.join("\n"));
console.log(L.join("\n"));
await conn.end();
process.exit(0);
