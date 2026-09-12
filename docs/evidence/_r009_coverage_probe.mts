/**
 * RESEARCH-007 覆盖审计 — 只读。
 *
 * 目的：回答「Run 540001 是不是分析少了很多？」——把 135 个批量分析按
 *   口径(BARE / EVENT_LOW_GUARD) × 决策日(T+1..T+5) × 列(参照列 + 5 桶) × 指标族(5)
 * 摊开成格子，逐格给出「有 / 无」，并算出「完整笛卡尔积」应有几条。
 *
 * 口径解析**复用前端同一套纯函数**（researchMatrix.ts），不另写一套规则，
 * 否则审计结论与被审计对象可能口径不一致。
 *
 * 用法：npx tsx _r009_coverage_probe.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";
import {
  ALL_PULLBACK_COLUMN,
  DEPTH_BUCKET_ORDER,
  parseMatrixCoordinate,
  type MatrixAnalysisLike,
  type MatrixCoordinate,
} from "../../client/src/components/research/researchMatrix";

const RUN_ID = 540001;

const DAYS = [1, 2, 3, 4, 5];
const COLUMNS: readonly string[] = [ALL_PULLBACK_COLUMN, ...DEPTH_BUCKET_ORDER];
const FAMILIES = ["return_1", "return_3", "return_5", "max_return_5", "max_drawdown_5"] as const;
const FAMILY_LABEL: Record<string, string> = {
  return_1: "之后1日收益",
  return_3: "之后3日收益",
  return_5: "之后5日收益",
  max_return_5: "之后5日最大有利偏移",
  max_drawdown_5: "之后5日最深跌幅",
};
const SCOPES = ["BARE", "EVENT_LOW_GUARD"] as const;
const SCOPE_LABEL: Record<string, string> = {
  BARE: "无资格约束",
  EVENT_LOW_GUARD: "加「未破首板最低价」资格",
};

function cellKey(day: number, columnKey: string): string {
  return `${day}|${columnKey}`;
}

async function main(): Promise<void> {
  const caller = researchEngineRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 1, role: "admin", name: "r009" } as never,
  });

  const detail = await caller.getRun({ runId: RUN_ID });
  const analyses: MatrixAnalysisLike[] = detail.analyses.flatMap((a) =>
    a.id === undefined ? [] : [{ id: a.id, name: a.name, target: a.target ?? null, status: a.status }],
  );

  const out: string[] = [];
  const push = (s = ""): void => void out.push(s);

  push(`# Run ${RUN_ID} 覆盖审计（只读）`);
  push();
  push(`- 分析总数：${analyses.length}`);
  push(`- Run 状态：${detail.run.status}`);
  push();

  // ---- 解析 ----
  const byScopeFamily = new Map<string, Map<string, { analysisId: number; name: string; target: string }>>();
  const unclassified: string[] = [];
  const familyCount = new Map<string, number>();
  const scopeCount = new Map<string, number>();

  for (const a of analyses) {
    const parsed = parseMatrixCoordinate(a);
    if (!parsed.ok) {
      unclassified.push(`#${a.id} ${a.name} · ${parsed.reason}`);
      continue;
    }
    const c: MatrixCoordinate = parsed.coordinate;
    const sfKey = `${c.scope.key}|${c.familyKey}`;
    if (!byScopeFamily.has(sfKey)) byScopeFamily.set(sfKey, new Map());
    const grid = byScopeFamily.get(sfKey)!;
    const k = cellKey(c.day, c.columnKey);
    if (grid.has(k)) {
      unclassified.push(`#${a.id} ${a.name} · 重复格（同格已有 #${grid.get(k)!.analysisId}）`);
      continue;
    }
    grid.set(k, { analysisId: a.id, name: a.name, target: c.target });
    familyCount.set(c.familyKey, (familyCount.get(c.familyKey) ?? 0) + 1);
    scopeCount.set(c.scope.key, (scopeCount.get(c.scope.key) ?? 0) + 1);
  }

  push(`- 可归组：${analyses.length - unclassified.length}`);
  push(`- 未能归组：${unclassified.length}`);
  for (const u of unclassified) push(`  - ${u}`);
  push();

  // ---- 轴与笛卡尔积 ----
  const fullTotal = SCOPES.length * DAYS.length * COLUMNS.length * FAMILIES.length;
  push(`## 轴定义`);
  push();
  push(`| 轴 | 取值 | 个数 |`);
  push(`|---|---|---:|`);
  push(`| 口径 | 无资格约束 / 加「未破首板最低价」资格 | ${SCOPES.length} |`);
  push(`| 决策日 | T+1 ~ T+5 | ${DAYS.length} |`);
  push(`| 列 | 已回撤(不限幅度) + 0~2% / 2~4% / 4~6% / 6~8% / 8%+ | ${COLUMNS.length} |`);
  push(`| 指标族 | 之后1日 / 之后3日 / 之后5日收益、5日最大有利偏移、5日最深跌幅 | ${FAMILIES.length} |`);
  push(`| **完整笛卡尔积** | ${SCOPES.length} × ${DAYS.length} × ${COLUMNS.length} × ${FAMILIES.length} | **${fullTotal}** |`);
  push();
  push(`实际建了 **${analyses.length}** 条 ⇒ 差 **${fullTotal - analyses.length}** 条。`);
  push();

  // ---- 逐 (口径 × 族) 的格子存在性 ----
  push(`## 覆盖矩阵（✔ = 有该分析 / · = 没有）`);
  push();
  for (const scope of SCOPES) {
    for (const fam of FAMILIES) {
      const grid = byScopeFamily.get(`${scope}|${fam}`);
      const haveCol = COLUMNS.filter((c) => DAYS.some((d) => grid?.has(cellKey(d, c))));
      push(`### ${SCOPE_LABEL[scope]} × ${FAMILY_LABEL[fam]}　已有 ${grid?.size ?? 0} 格 / 应有 ${DAYS.length * COLUMNS.length} 格`);
      push();
      const head = ["决策日", ...COLUMNS];
      push(`| ${head.join(" | ")} |`);
      push(`|${head.map(() => "---").join("|")}|`);
      for (const d of DAYS) {
        const cells = COLUMNS.map((c) => (grid?.has(cellKey(d, c)) ? "✔" : "·"));
        push(`| **T+${d}** | ${cells.join(" | ")} |`);
      }
      push();
      if (haveCol.length > 0 && haveCol.length < COLUMNS.length) {
        push(`> 该组只覆盖这些列：${haveCol.join(" / ")}`);
        push();
      }
    }
  }

  // ---- 汇总：按族 / 按口径 ----
  push(`## 按指标族汇总`);
  push();
  push(`| 指标族 | 实建条数 | 若补齐（2 口径 × 5 天 × 6 列） | 缺口 |`);
  push(`|---|---:|---:|---:|`);
  for (const fam of FAMILIES) {
    const have = familyCount.get(fam) ?? 0;
    push(`| ${FAMILY_LABEL[fam]} \`${fam}\` | ${have} | ${SCOPES.length * DAYS.length * COLUMNS.length} | ${SCOPES.length * DAYS.length * COLUMNS.length - have} |`);
  }
  push();
  push(`| 口径 | 实建条数 |`);
  push(`|---|---:|`);
  for (const s of SCOPES) push(`| ${SCOPE_LABEL[s]} | ${scopeCount.get(s) ?? 0} |`);
  push();

  // ---- 原始清单 ----
  push(`## 原始清单（按 口径 → 族 → 决策日 → 列 排序）`);
  push();
  for (const scope of SCOPES) {
    for (const fam of FAMILIES) {
      const grid = byScopeFamily.get(`${scope}|${fam}`);
      if (!grid || grid.size === 0) continue;
      push(`### ${SCOPE_LABEL[scope]} × ${FAMILY_LABEL[fam]}（${grid.size}）`);
      push();
      push(`| 决策日 | 列 | 分析 | target | 分析名 |`);
      push(`|---|---|---|---|---|`);
      for (const d of DAYS) {
        for (const c of COLUMNS) {
          const e = grid.get(cellKey(d, c));
          if (!e) continue;
          push(`| T+${d} | ${c} | #${e.analysisId} | \`${e.target}\` | ${e.name} |`);
        }
      }
      push();
    }
  }

  writeFileSync("_r009_coverage_probe_result.md", out.join("\n"));
  console.log(out.slice(0, 90).join("\n"));
  console.log(`\n…已写入 _r009_coverage_probe_result.md（${out.length} 行）`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
