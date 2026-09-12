/**
 * RESEARCH-007.1 — 修正 Run 540001 中回撤桶的区间边界（**左开右闭**），并整轮重跑。
 *
 * 为什么要修：首版把桶写成 `depth >= lo AND depth <= hi`（双闭），后果有两条——
 *   ① `future_return_{d}d = 0`（平盘、depth = 0，**不是回撤**）被算进 0~2% 桶；
 *   ② 边界值（如恰好 −2.00%）同时落进两个相邻桶。
 * 实测证据：5 桶样本数相加 10,106 > 组 A「已回撤」的 9,899（多 207）。
 *
 * 修正后的口径（depth = −future_return_{d}d）：
 *   桶 = `depth > lo`（⇔ `future_return < −lo`）**且** `depth <= hi`（⇔ `future_return >= −hi`）。
 *   ⇒ 0~2% 桶下界严格为 `future_return < 0`，平盘样本被排除；相邻桶互斥，8%+ 无上界。
 *
 * 用法：
 *   npx tsx _r0071_fix.mts              # 只打印将要改成的条件（不写库）
 *   npx tsx _r0071_fix.mts --execute    # 改条件（自动删旧结果 + 回退 PENDING）
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";

const EXPERIMENT_ID = 240002;
const RUN_ID = 540001;

type Cond = {
  groupNo: number;
  sortOrder: number;
  fieldName: string;
  operator: string;
  value: unknown;
  logicalOperator: string;
  groupLogicalOperator: string;
};

const BUCKETS: Array<{ key: string; lo: number; hi: number | null }> = [
  { key: "0~2%", lo: 0.0, hi: 0.02 },
  { key: "2~4%", lo: 0.02, hi: 0.04 },
  { key: "4~6%", lo: 0.04, hi: 0.06 },
  { key: "6~8%", lo: 0.06, hi: 0.08 },
  { key: "8%+", lo: 0.08, hi: null },
];

/** 桶条件（左开右闭）：depth > lo 且 depth <= hi。 */
function depthConditions(d: number, b: { lo: number; hi: number | null }, offset: number): Cond[] {
  const conds: Cond[] = [
    {
      groupNo: 0,
      sortOrder: offset,
      fieldName: `future_return_${d}d`,
      operator: "<",
      value: -b.lo,
      logicalOperator: "AND",
      groupLogicalOperator: "AND",
    },
  ];
  if (b.hi !== null) {
    conds.push({
      groupNo: 0,
      sortOrder: offset + 1,
      fieldName: `future_return_${d}d`,
      operator: ">=",
      value: -b.hi,
      logicalOperator: "AND",
      groupLogicalOperator: "AND",
    });
  }
  return conds;
}

const NAME_RE = /T\+(\d+).*?回撤(\d+~\d+%|\d+%\+)/;

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const caller = researchEngineRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 1, role: "admin", name: "r0071" } as never,
  });

  const analyses = await caller.listAnalyses({ runId: RUN_ID });
  const lines: string[] = [];
  lines.push(`# RESEARCH-007.1 桶边界修正（Run ${RUN_ID}）`);
  lines.push("");
  lines.push("口径：桶 = `depth > lo`（`future_return < −lo`）AND `depth <= hi`（`future_return >= −hi`）");
  lines.push("");

  const targets: Array<{ id: number; name: string; d: number; bucket: string; conds: Cond[] }> = [];
  for (const a of analyses) {
    const m = NAME_RE.exec(a.name);
    if (!m) continue;
    const d = Number(m[1]);
    const bucket = BUCKETS.find((b) => b.key === m[2]);
    if (!bucket) continue;
    const isGuarded = a.name.includes("未破首板最低价");
    const conds: Cond[] = isGuarded
      ? [
          {
            groupNo: 0,
            sortOrder: 0,
            fieldName: "holds_event_low_5d",
            operator: "==",
            value: 1,
            logicalOperator: "AND",
            groupLogicalOperator: "AND",
          },
          ...depthConditions(d, bucket, 1),
        ]
      : depthConditions(d, bucket, 0);
    targets.push({ id: a.id!, name: a.name, d, bucket: bucket.key, conds });
  }

  lines.push(`命中回撤桶分析：${targets.length} 个`);
  lines.push("");
  const sample = targets.filter((t) => t.bucket === "0~2%" && t.d === 2).slice(0, 2);
  for (const s of sample) {
    lines.push(`示例 ${s.id}：${s.name}`);
    lines.push("```json");
    lines.push(JSON.stringify(s.conds, null, 2));
    lines.push("```");
  }

  if (execute) {
    lines.push("");
    lines.push("## 执行（会删旧结果 + 回退 PENDING）");
    let ok = 0;
    for (const t of targets) {
      await caller.setAnalysisConditions({
        analysisId: t.id,
        conditions: t.conds as never,
      });
      ok += 1;
      if (ok % 25 === 0) lines.push(`- 已修正 ${ok}/${targets.length}`);
    }
    lines.push(`- 已修正 ${ok}/${targets.length}`);
  }

  writeFileSync("_r0071_fix.md", lines.join("\n"));
  console.log(lines.join("\n").slice(0, 3000));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
