/**
 * RESEARCH-007.1 — 把 Run 540001 的 135 个分析结果整理成 5×5 表格（只读，不重算）。
 *
 * 用法：npx tsx _r0071_summarize.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";

const RUN_ID = 540001;

type Stat = {
  n: number | null;
  mean: number | null;
  median: number | null;
  win: number | null;
  std: number | null;
  dd: number | null;
};

const pct = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
const num = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);

async function main(): Promise<void> {
  const caller = researchEngineRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 1, role: "admin", name: "r0071" } as never,
  });

  const run = await caller.getRun({ runId: RUN_ID });
  const lines: string[] = [];
  lines.push(`# RESEARCH-007.1 — Run ${RUN_ID} 结果汇总（runNo=${run.run.runNo}，status=${run.run.status}，sample=${run.run.sampleCount}）`);
  lines.push("");
  lines.push(`分析总数：${run.analyses.length}`);
  lines.push("");

  // 收集：name → CONDITION 组统计（取 target 对应结果变量那一行的指标）
  const byName = new Map<string, { id: number; status: string; stat: Stat; target: string | null; detail: Record<string, unknown> }>();

  for (const a of run.analyses) {
    const rows = await caller.getAnalysisResults({ analysisId: a.id! });
    const stat: Stat = { n: null, mean: null, median: null, win: null, std: null, dd: null };
    let detail: Record<string, unknown> = {};
    for (const r of rows) {
      const dim = (r.dimension ?? {}) as Record<string, unknown>;
      if (dim.group !== "CONDITION") continue;
      if (r.metricCode === "SAMPLE_COUNT") stat.n = r.metricValue ?? null;
      if (r.metricCode === "MEAN_RETURN") stat.mean = r.metricValue ?? null;
      if (r.metricCode === "MEDIAN_RETURN") stat.median = r.metricValue ?? null;
      if (r.metricCode === "WIN_RATE") stat.win = r.metricValue ?? null;
      if (r.metricCode === "STD_RETURN") stat.std = r.metricValue ?? null;
      if (r.metricCode === "MAX_DRAWDOWN") {
        stat.dd = r.metricValue ?? null;
        detail = (r.details ?? {}) as Record<string, unknown>;
      }
    }
    byName.set(a.name, { id: a.id!, status: a.status, stat, target: a.target ?? null, detail });
  }

  const find = (frag: string) => [...byName.entries()].find(([k]) => k.includes(frag));

  // ---- 组 A：按决策日已回撤 ----
  lines.push("## 组 A｜按决策日「已回撤（相对首板收盘，深度>0）」→ 之后 5 日收益");
  lines.push("");
  lines.push("| 决策日 | 条件样本数 | 均值 | 中位 | 胜率 | 标准差 |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const d of [1, 2, 3, 4, 5]) {
    const hit = find(`T+${d} 已回撤(相对首板收盘)`);
    const s = hit?.[1].stat;
    lines.push(`| T+${d} | ${num(s?.n)} | ${pct(s?.mean)} | ${pct(s?.median)} | ${pct(s?.win, 1)} | ${pct(s?.std)} |`);
  }
  lines.push("");

  // ---- 组 B：5×5 ----
  const BUCKETS = ["0~2%", "2~4%", "4~6%", "6~8%", "8%+"];

  lines.push("## 组 B｜5 × 5 固定桶（**不含**破位资格约束）");
  lines.push("");
  lines.push(`### B1 之后 5 日收益：条件样本数 / 均值 / 中位 / 胜率`);
  lines.push("");
  lines.push(`| 决策日 \\ 回撤桶 | ${BUCKETS.join(" | ")} |`);
  lines.push(`|---|${BUCKETS.map(() => "---:").join("|")}|`);
  for (const d of [1, 2, 3, 4, 5]) {
    const cells = BUCKETS.map((b) => {
      const hit = find(`T+${d} 回撤${b} → 之后5日收益`);
      const s = hit?.[1].stat;
      if (!s) return "—";
      return `${num(s.n)} / ${pct(s.mean)} / ${pct(s.median)} / ${pct(s.win, 1)}`;
    });
    lines.push(`| **T+${d}** | ${cells.join(" | ")} |`);
  }
  lines.push("");

  lines.push(`### B2 之后 5 日收益 · 均值矩阵`);
  lines.push("");
  lines.push(`| 决策日 \\ 回撤桶 | ${BUCKETS.join(" | ")} |`);
  lines.push(`|---|${BUCKETS.map(() => "---:").join("|")}|`);
  for (const d of [1, 2, 3, 4, 5]) {
    const cells = BUCKETS.map((b) => pct(find(`T+${d} 回撤${b} → 之后5日收益`)?.[1].stat.mean));
    lines.push(`| **T+${d}** | ${cells.join(" | ")} |`);
  }
  lines.push("");

  lines.push(`### B3 之后 5 日收益 · 样本数矩阵`);
  lines.push("");
  lines.push(`| 决策日 \\ 回撤桶 | ${BUCKETS.join(" | ")} |`);
  lines.push(`|---|${BUCKETS.map(() => "---:").join("|")}|`);
  for (const d of [1, 2, 3, 4, 5]) {
    const cells = BUCKETS.map((b) => num(find(`T+${d} 回撤${b} → 之后5日收益`)?.[1].stat.n));
    lines.push(`| **T+${d}** | ${cells.join(" | ")} |`);
  }
  lines.push("");

  lines.push(`### B4 之后 5 日最大有利偏移 · 均值矩阵`);
  lines.push("");
  lines.push(`| 决策日 \\ 回撤桶 | ${BUCKETS.join(" | ")} |`);
  lines.push(`|---|${BUCKETS.map(() => "---:").join("|")}|`);
  for (const d of [1, 2, 3, 4, 5]) {
    const cells = BUCKETS.map((b) => pct(find(`T+${d} 回撤${b} → 之后5日最大有利偏移`)?.[1].stat.mean));
    lines.push(`| **T+${d}** | ${cells.join(" | ")} |`);
  }
  lines.push("");

  lines.push(`### B5 之后 5 日最深跌幅 · 均值矩阵`);
  lines.push("");
  lines.push(`| 决策日 \\ 回撤桶 | ${BUCKETS.join(" | ")} |`);
  lines.push(`|---|${BUCKETS.map(() => "---:").join("|")}|`);
  for (const d of [1, 2, 3, 4, 5]) {
    const cells = BUCKETS.map((b) => pct(find(`T+${d} 回撤${b} → 之后5日最深跌幅`)?.[1].stat.mean));
    lines.push(`| **T+${d}** | ${cells.join(" | ")} |`);
  }
  lines.push("");

  lines.push(`### B6 之后 1 日 / 3 日收益 · 均值矩阵`);
  lines.push("");
  for (const t of ["之后1日收益", "之后3日收益"]) {
    lines.push(`**${t}**`);
    lines.push("");
    lines.push(`| 决策日 \\ 回撤桶 | ${BUCKETS.join(" | ")} |`);
    lines.push(`|---|${BUCKETS.map(() => "---:").join("|")}|`);
    for (const d of [1, 2, 3, 4, 5]) {
      const cells = BUCKETS.map((b) => pct(find(`T+${d} 回撤${b} → ${t}`)?.[1].stat.mean));
      lines.push(`| **T+${d}** | ${cells.join(" | ")} |`);
    }
    lines.push("");
  }

  // ---- 组 C：T+5 + eligibility ----
  lines.push("## 组 C｜T+5 加「截至 T+5 未破首板日最低价」(holds_event_low_5d=1) 对照");
  lines.push("");
  lines.push("| 回撤桶 | 条件样本数 | 均值 | 中位 | 胜率 | 对照：组 B 同桶样本数 |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const b of BUCKETS) {
    const hit = find(`T+5 未破首板最低价 且 回撤${b}`);
    const s = hit?.[1].stat;
    const ref = find(`T+5 回撤${b} → 之后5日收益`)?.[1].stat.n;
    lines.push(`| ${b} | ${num(s?.n)} | ${pct(s?.mean)} | ${pct(s?.median)} | ${pct(s?.win, 1)} | ${num(ref)} |`);
  }
  lines.push("");

  // ---- 逐分析原始清单 ----
  lines.push("## 附：逐分析状态");
  lines.push("");
  lines.push("| id | 状态 | 条件样本数 | 名称 |");
  lines.push("|---|---|---:|---|");
  for (const a of run.analyses) {
    const rec = byName.get(a.name);
    lines.push(`| ${a.id} | ${a.status} | ${num(rec?.stat.n)} | ${a.name} |`);
  }

  writeFileSync("_r0071_summary.md", lines.join("\n"));
  console.log(`written _r0071_summary.md (${run.analyses.length} analyses)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
