/**
 * RESEARCH-007 — 把 Run 510001 的落库结果整理成可读表（**只搬运、不重算**）。
 *
 * 纪律：本脚本不做任何统计计算，只按 metricCode / dimension 从 `research_result`
 * 里取值并格式化（均值/胜率原样搬运；中位数原样搬运）。
 *
 * 用法：npx tsx _r007_summarize.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";

const RUN_ID = 510001;

type Row = {
  analysisId: number;
  resultType: string;
  metricCode: string;
  metricValue: number | null;
  sampleCount: number | null;
  dimension: Record<string, unknown> | null;
};

const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`;
const num = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : String(v);

function pick(rows: Row[], dimKey: string, dimValue: unknown, code: string): Row | undefined {
  return rows.find(
    (r) => r.metricCode === code && r.dimension !== null && r.dimension[dimKey] === dimValue,
  );
}

async function main(): Promise<void> {
  const caller = researchEngineRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: null,
  });
  const run = await caller.getRun({ runId: RUN_ID });
  const byId = new Map(run.analyses.map((a) => [a.id!, a]));
  const rowsById = new Map<number, Row[]>();
  for (const a of run.analyses) {
    rowsById.set(a.id!, (await caller.getAnalysisResults({ analysisId: a.id! })) as unknown as Row[]);
  }

  const out: string[] = [];
  out.push(`# Run ${RUN_ID} 结果摘要（Dataset Version 390002 / v2 / 23,978 首板事件）`);
  out.push("");
  out.push(
    "口径提醒：所有「之后 N 日收益」都是 **相对 T+d 收盘价**（即假设在回撤日收盘建仓）的分段收益；"
      + "等频分档的档位 1 = 当日相对首板收盘**跌幅最深**的一档，档位 5 = 涨幅最高的一档。"
      + "分档按等频（分位数）切，**不是**固定的 0~2% / 2~4% 宽度。",
  );
  out.push("");

  // ---- 1. Day × Depth（等频 5 档）→ 之后 5 / 10 日收益 ----
  for (const horizon of [5, 10]) {
    out.push(`## 1.${horizon === 5 ? 1 : 2} 回撤日 × 等频深度档 → 之后 ${horizon} 日收益（分组均值搬运）`);
    out.push("");
    out.push(`| 回撤日 | 档位 | 样本 | 平均收益 | 中位收益 | 胜率 | 标准差 |`);
    out.push(`| --- | --- | ---: | ---: | ---: | ---: | ---: |`);
    for (const d of [1, 2, 3, 4, 5]) {
      const a = run.analyses.find(
        (x) => x.name === `首板后回撤·T+${d} 相对首板收盘涨跌幅 5 档 → 之后 ${horizon} 日收益`,
      );
      if (!a) continue;
      const rows = rowsById.get(a.id!) ?? [];
      for (const band of [1, 2, 3, 4, 5]) {
        const n = pick(rows, "windowA", band, "SAMPLE_COUNT");
        out.push(
          `| T+${d} | ${band} | ${num(n?.sampleCount ?? null)} | ${pct(pick(rows, "windowA", band, "MEAN_RETURN")?.metricValue)} | ${pct(pick(rows, "windowA", band, "MEDIAN_RETURN")?.metricValue)} | ${pct(pick(rows, "windowA", band, "WIN_RATE")?.metricValue)} | ${pct(pick(rows, "windowA", band, "STD_RETURN")?.metricValue)} |`,
        );
      }
      const spread = rows.find((r) => r.metricCode === "SPREAD_TOP_BOTTOM");
      const p = rows.find((r) => r.metricCode === "P_VALUE_DIFFERENCE");
      out.push(
        `| T+${d} | 顶档−底档 | — | **${pct(spread?.metricValue)}** | — | — | p=${num(p?.metricValue)} |`,
      );
    }
    out.push("");
  }

  // ---- 2. 固定百分比桶（T+2 / T+3）对比全样本 ----
  out.push(`## 2. 固定百分比回撤桶（相对首板收盘）→ 之后 5 日收益：条件组 vs 全样本`);
  out.push("");
  out.push(`| 回撤日 | 桶 | 条件组样本 | 条件组均值 | 条件组中位 | 条件组胜率 | 差值(条件−全样本) | p |`);
  out.push(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const d of [2, 3]) {
    for (const bucket of ["0~2%", "2~4%", "4~6%", "6~8%", "8%+"]) {
      const a = run.analyses.find(
        (x) => x.name === `首板后回撤·T+${d} 相对首板收盘回撤 ${bucket} → 之后 5 日收益`,
      );
      if (!a) continue;
      const rows = rowsById.get(a.id!) ?? [];
      const cond = pick(rows, "group", "CONDITION", "MEAN_RETURN");
      out.push(
        `| T+${d} | ${bucket} | ${num(cond?.sampleCount ?? null)} | ${pct(cond?.metricValue)} | ${pct(pick(rows, "group", "CONDITION", "MEDIAN_RETURN")?.metricValue)} | ${pct(pick(rows, "group", "CONDITION", "WIN_RATE")?.metricValue)} | ${pct(rows.find((r) => r.metricCode === "DIFFERENCE")?.metricValue)} | ${num(rows.find((r) => r.metricCode === "P_VALUE_DIFFERENCE")?.metricValue)} |`,
      );
    }
  }
  out.push("");

  // ---- 3. 风险侧（等频 5 档）----
  out.push(`## 3. 风险侧：T+2 / T+3 等频深度档 → 之后 5 日最大有利偏移 / 最深跌幅`);
  out.push("");
  out.push(`| 回撤日 | 档位 | 样本 | 平均最大有利偏移 | 平均最深跌幅 |`);
  out.push(`| --- | --- | ---: | ---: | ---: |`);
  for (const d of [2, 3]) {
    const aUp = run.analyses.find(
      (x) => x.name === `首板后回撤·T+${d} 深度5档 → 之后5日最大有利偏移`,
    );
    const aDn = run.analyses.find(
      (x) => x.name === `首板后回撤·T+${d} 深度5档 → 之后5日最深跌幅`,
    );
    const up = aUp ? rowsById.get(aUp.id!) ?? [] : [];
    const dn = aDn ? rowsById.get(aDn.id!) ?? [] : [];
    for (const band of [1, 2, 3, 4, 5]) {
      out.push(
        `| T+${d} | ${band} | ${num(pick(up, "windowA", band, "SAMPLE_COUNT")?.sampleCount ?? null)} | ${pct(pick(up, "windowA", band, "MEAN_RETURN")?.metricValue)} | ${pct(pick(dn, "windowA", band, "MEAN_RETURN")?.metricValue)} |`,
      );
    }
  }
  out.push("");

  // ---- 4. 量比桶 ----
  out.push(`## 4. T+2 当日「已回撤（收盘 < 首板收盘）」且量比落在桶内 → 之后 5 日收益`);
  out.push("");
  out.push(`| 量比桶 | 样本 | 平均收益 | 中位收益 | 胜率 | 差值(条件−全样本) | p |`);
  out.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const bucket of ["<0.5", "0.5~0.8", "0.8~1.0", "1.0~1.5", ">1.5"]) {
    const a = run.analyses.find(
      (x) => x.name === `首板后回撤·T+2 回撤且当日量比 ${bucket} → 之后 5 日收益`,
    );
    if (!a) continue;
    const rows = rowsById.get(a.id!) ?? [];
    const cond = pick(rows, "group", "CONDITION", "MEAN_RETURN");
    out.push(
      `| ${bucket} | ${num(cond?.sampleCount ?? null)} | ${pct(cond?.metricValue)} | ${pct(pick(rows, "group", "CONDITION", "MEDIAN_RETURN")?.metricValue)} | ${pct(pick(rows, "group", "CONDITION", "WIN_RATE")?.metricValue)} | ${pct(rows.find((r) => r.metricCode === "DIFFERENCE")?.metricValue)} | ${num(rows.find((r) => r.metricCode === "P_VALUE_DIFFERENCE")?.metricValue)} |`,
    );
  }
  out.push("");

  out.push(`## 5. 全样本基线（T+2 收盘 → 之后 5 日，来自 450011 的 ALL 组）`);
  const baseRow = (rowsById.get(450011) ?? []).find(
    (r) => r.metricCode === "MEAN_RETURN" && r.dimension?.["group"] === "ALL",
  );
  const baseMed = (rowsById.get(450011) ?? []).find(
    (r) => r.metricCode === "MEDIAN_RETURN" && r.dimension?.["group"] === "ALL",
  );
  const baseWin = (rowsById.get(450011) ?? []).find(
    (r) => r.metricCode === "WIN_RATE" && r.dimension?.["group"] === "ALL",
  );
  out.push(
    `- n = ${num(baseRow?.sampleCount ?? null)}，平均 ${pct(baseRow?.metricValue)}，中位 ${pct(baseMed?.metricValue)}，胜率 ${pct(baseWin?.metricValue)}`,
  );
  out.push("");
  out.push(`## 6. 本 Run 全部分析（${run.analyses.length}）`);
  for (const a of run.analyses) {
    out.push(`- #${a.id} ${a.analysisType} [${a.status}] ${a.name} → target=${a.target ?? "—"}`);
  }
  void byId;

  writeFileSync("_r007_summary.md", out.join("\n"));
  console.log("written _r007_summary.md");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
