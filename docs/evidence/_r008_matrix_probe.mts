/**
 * RESEARCH-007.2 验收 — 用**真实库**数据跑一遍矩阵视图的纯函数层（只读，不写库）。
 *
 * 目的：本机 `agent-browser` 不可用，无法截图。因此按项目既有验收路径：
 *   真实 tRPC 取数 → 喂给**前端同一套纯函数**（`client/src/components/research/researchMatrix.ts`）
 *   → 打印出页面将会渲染的矩阵，并与已落库结果交叉核对。
 *
 * 用法：npx tsx _r008_matrix_probe.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";
import {
  buildMatrix,
  buildMatrixIndex,
  pickDefaultSelection,
  summarizeRows,
  ALL_PULLBACK_COLUMN,
  type MatrixAnalysisLike,
  type MatrixVm,
} from "../../client/src/components/research/researchMatrix";
import type { ResultRowLike } from "../../client/src/adapters/researchEngineAdapter";

const RUN_ID = 540001;

const pct = (s: string): string => s;

function renderMatrix(vm: MatrixVm): string[] {
  const lines: string[] = [];
  const cols = vm.columns.map((c) => c.label);
  lines.push(`| 决策日 \\ 桶 | ${cols.join(" | ")} |`);
  lines.push(`|---|${cols.map(() => "---:").join("|")}|`);
  for (const row of vm.rows) {
    const cells = row.cells.map((c) => {
      if (c.stats === null) return c.analysisId === null ? "未建" : "无结果";
      const s = c.stats;
      const mark = s.lowSample ? "!" : s.stronglySignificant ? "**" : s.significant ? "*" : "";
      return `${pct(s.valueDisplay)}${mark} (n=${s.conditionSampleCount ?? "—"})`;
    });
    lines.push(`| **${row.rowKey}** | ${cells.join(" | ")} |`);
  }
  return lines;
}

async function main(): Promise<void> {
  const caller = researchEngineRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 1, role: "admin", name: "r008" } as never,
  });

  const detail = await caller.getRun({ runId: RUN_ID });
  const analyses: MatrixAnalysisLike[] = detail.analyses.flatMap((a) =>
    a.id === undefined ? [] : [{ id: a.id, name: a.name, target: a.target ?? null, status: a.status }],
  );

  const index = buildMatrixIndex(analyses);

  const out: string[] = [];
  out.push(`# 矩阵视图端到端验证（Run ${RUN_ID}，只读）`);
  out.push("");
  out.push(`- 分析总数：${analyses.length}`);
  out.push(`- 已归组：${index.entries.length}`);
  out.push(`- 未归类：${index.unclassified.length}`);
  for (const u of index.unclassified) out.push(`  - #${u.analysisId} ${u.analysisName} · ${u.reason}`);
  out.push(`- 口径：${index.scopes.map((s) => `${s.key}(${s.label})`).join(" / ")}`);
  out.push("");
  out.push(`## 指标族（入口按钮）`);
  out.push("");
  out.push(`| key | 名称 | 可归组分析数 |`);
  out.push(`|---|---|---:|`);
  for (const f of index.families) out.push(`| ${f.key} | ${f.label} | ${f.entryCount} |`);
  out.push("");

  const selection = pickDefaultSelection(index)!;
  out.push(`默认选择：口径=${selection.scopeKey} · 指标族=${selection.familyKey}`);
  out.push("");

  const groups: Array<{ scopeKey: string; familyKey: string }> = [
    selection,
    { scopeKey: "BARE", familyKey: "return_1" },
    { scopeKey: "BARE", familyKey: "return_3" },
    { scopeKey: "BARE", familyKey: "max_return_5" },
    { scopeKey: "BARE", familyKey: "max_drawdown_5" },
    { scopeKey: "EVENT_LOW_GUARD", familyKey: "return_5" },
  ];

  for (const g of groups) {
    const entries = index.entries.filter(
      (e) => e.coordinate.scope.key === g.scopeKey && e.coordinate.familyKey === g.familyKey,
    );
    if (entries.length === 0) continue;

    const rowsById = new Map<number, readonly ResultRowLike[]>();
    for (const e of entries) {
      const rows = await caller.getAnalysisResults({ analysisId: e.analysisId });
      rowsById.set(e.analysisId, rows as unknown as ResultRowLike[]);
    }

    const vm = buildMatrix(index, g, rowsById);
    out.push(`## ${vm.scope.key} × ${vm.family.key}（${vm.family.label}）`);
    out.push("");
    out.push(
      `主指标 ${vm.metricCode ?? "—"}（${vm.metricLabel}）· 覆盖 ${vm.coverage.withResult}/${vm.coverage.cells} 格` +
        `（已建 ${vm.coverage.built}，未建 ${vm.coverage.missing}）`,
    );
    out.push("");
    out.push(...renderMatrix(vm));
    out.push("");
    const summaries = summarizeRows(vm);
    out.push(`| 决策日 | 格数 | 样本合计 | 显著为正 | 显著为负 |`);
    out.push(`|---|---:|---:|---:|---:|`);
    for (const s of summaries) {
      out.push(
        `| ${s.rowKey} | ${s.cellCount} | ${s.totalSampleCount ?? "—"} | ${s.positiveSignificant} | ${s.negativeSignificant} |`,
      );
    }
    out.push("");
    out.push(`标注：\`*\` = p<0.05、\`**\` = p<0.01、\`!\` = 引擎标记小样本（不判显著）、\`未建\` = 该 Run 没有这一格。`);
    out.push("");
    out.push(`- ${ALL_PULLBACK_COLUMN} 列是「已回撤（不限幅度）」参照列。`);
    out.push("");
  }

  writeFileSync("_r008_matrix_probe_result.md", out.join("\n"));
  console.log(out.slice(0, 40).join("\n"));
  console.log(`\n…已写入 _r008_matrix_probe_result.md（${out.length} 行）`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
