/**
 * RESEARCH-007.3 — Run 540001 覆盖补齐（A 档：**零产品代码**，纯领域层）。
 *
 * 背景：Run 540001 实建 135 条，`_r009_coverage_probe_result.md` 审计出矩阵视图里
 * 存在两类**假缺口**（不是引擎造不出来，只是当初没建）：
 *
 *   A-1（20 条）口径「无资格约束」× **参照列「已回撤(不限幅度)」** × 4 族 × T+1~T+5
 *              （原批次只有 `return_5` 一族配了参照列，其余 4 族的参照列整列缺失）
 *   A-2（25 条）口径「未破首板最低价」× T+5 × (4 族 × 5 桶 + 5 族 × 参照列)
 *              （原批次该口径只有 `return_5` × 5 桶，其余族整表空）
 *
 * 合计 45 条 ⇒ Run 540001 由 135 → 180 条。
 *
 * 🔴 本批**不触碰**的（性质不同，不可混淆）：
 *   - 「破位资格 × T+1~T+4」**现在造不出来**：变量层只有 `holds_event_low_{5,10,20}d`
 *     （视界取自 Dataset 的 outcomeHorizons=[5,10,20]），没有 1d~4d；且
 *     `EVENT_LOW_GUARD_BASES = ["low","close"]` 无 `"open"`。⇒ 属 B 档，须改
 *     `server/researchEngine/variables.ts`，会热重启杀在途 Run，另排期。
 *   - 视界 10 日 / 20 日族（C 档）**本批不做**：用户 2026-09-13 明确「10 日与 20 日不关键」。
 *
 * 纪律：
 *   - 不实现任何统计逻辑：只把研究问题翻译成**现有 Analysis Domain Model 能表达**的定义，
 *     再交给引擎自己的 `resolveEngineAnalysisConfig` 做权威预检。
 *   - 变量名一律来自 `listVariables`（真实目录），不猜。
 *   - 预检有一项不过 → 整批拒绝（一个都不建）。
 *   - **补跑走 `runIncremental`**（不覆盖已 COMPLETED 的 135 条结果、不生成结论）。
 *
 * 用法：
 *   npx tsx _r010_backfill_apply.mts              # 只预检（默认，不写库）
 *   npx tsx _r010_backfill_apply.mts --execute    # 写入 Run 540001（仍不跑引擎）
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";
import { ResearchVariableCatalog } from "../../server/researchEngine/variables";
import { resolveEngineAnalysisConfig } from "../../server/researchEngine/analysisConfig";
import type { ResearchAnalysis } from "../../server/researchCore";

const DATASET_VERSION_ID = 390002;
const EXPERIMENT_ID = 240002;
const TARGET_RUN_ID = 540001;

type Cond = {
  groupNo: number;
  sortOrder: number;
  fieldName: string;
  operator: string;
  value: unknown;
  logicalOperator?: string;
  groupLogicalOperator?: string;
};
type Item = {
  analysisType: string;
  name: string;
  target?: string;
  config: Record<string, unknown>;
  conditions?: Cond[];
};

const PREFIX = "首板后回撤";

/** 固定业务桶（**非等频**），口径同 RESEARCH-007.1：`depth = −future_return_{d}d`，`depth ∈ (lo, hi]`。 */
const DEPTH_BUCKETS: Array<{ label: string; lo: number; hi: number | null }> = [
  { label: "0~2%", lo: 0.0, hi: 0.02 },
  { label: "2~4%", lo: 0.02, hi: 0.04 },
  { label: "4~6%", lo: 0.04, hi: 0.06 },
  { label: "6~8%", lo: 0.06, hi: 0.08 },
  { label: "8%+", lo: 0.08, hi: null },
];

/** 桶 → 两条 AND 条件：`future_return <= −lo` 且 `future_return > −hi`（8%+ 无上界）。 */
function depthConditions(d: number, b: { lo: number; hi: number | null }, offset: number): Cond[] {
  const conds: Cond[] = [
    {
      groupNo: 0,
      sortOrder: offset,
      fieldName: `future_return_${d}d`,
      operator: "<=",
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
      operator: ">",
      value: -b.hi,
      logicalOperator: "AND",
      groupLogicalOperator: "AND",
    });
  }
  return conds;
}

/** 指标族（一个 CONDITIONAL 分析只能有一个目标变量）。顺序对齐 `researchMatrix.ts` 的族序。 */
const FAMILIES: Array<{ key: string; label: string; tpl: (d: number) => string }> = [
  { key: "return_1", label: "之后1日收益", tpl: (d) => `segment_return_${d}_${d + 1}d` },
  { key: "return_3", label: "之后3日收益", tpl: (d) => `segment_return_${d}_${d + 3}d` },
  { key: "return_5", label: "之后5日收益", tpl: (d) => `segment_return_${d}_${d + 5}d` },
  { key: "max_return_5", label: "之后5日最大有利偏移", tpl: (d) => `segment_max_return_${d}_${d + 5}d` },
  { key: "max_drawdown_5", label: "之后5日最深跌幅", tpl: (d) => `segment_max_drawdown_${d}_${d + 5}d` },
];

/** 原批次已配好参照列的族（⇒ 参照列不重复建）。 */
const FAMILIES_WITH_EXISTING_REFERENCE = new Set(["return_5"]);
/** A-1/A-2 需要补参照列的族。 */
const FAMILIES_NEEDING_REFERENCE = FAMILIES.filter((f) => !FAMILIES_WITH_EXISTING_REFERENCE.has(f.key));
/** 原批次该口径下已建桶列的族（⇒ 桶列不重复建）。 */
const FAMILIES_WITH_EXISTING_GUARD_BUCKETS = new Set(["return_5"]);
/** A-2 需要补桶列的族。 */
const FAMILIES_NEEDING_GUARD_BUCKETS = FAMILIES.filter((f) => !FAMILIES_WITH_EXISTING_GUARD_BUCKETS.has(f.key));

/** 「已回撤(不限幅度)」= 参考列的准入条件：`future_return_{d}d < 0`（深度 > 0）。 */
function pullbackOnlyCondition(d: number, offset: number): Cond {
  return {
    groupNo: 0,
    sortOrder: offset,
    fieldName: `future_return_${d}d`,
    operator: "<",
    value: 0,
    logicalOperator: "AND",
    groupLogicalOperator: "AND",
  };
}

/** 滚动守护资格：截至 T+5 未破首板日最低价（变量层现有唯一可表达的守护变量）。 */
function guardCondition(offset: number): Cond {
  return {
    groupNo: 0,
    sortOrder: offset,
    fieldName: "holds_event_low_5d",
    operator: "==",
    value: 1,
    logicalOperator: "AND",
    groupLogicalOperator: "AND",
  };
}

function buildItems(): Item[] {
  const items: Item[] = [];

  // ---- A-1：无资格约束 × 参照列「已回撤(不限幅度)」× 4 族 × T+1~T+5 = 20 ----
  for (const d of [1, 2, 3, 4, 5]) {
    for (const f of FAMILIES_NEEDING_REFERENCE) {
      items.push({
        analysisType: "CONDITIONAL",
        name: `${PREFIX}·T+${d} 已回撤(相对首板收盘) → ${f.label}`,
        target: f.tpl(d),
        config: { targetField: f.tpl(d) },
        conditions: [pullbackOnlyCondition(d, 0)],
      });
    }
  }

  // ---- A-2a：未破首板最低价 × T+5 × 参照列 × 5 族 = 5 ----
  for (const f of FAMILIES) {
    items.push({
      analysisType: "CONDITIONAL",
      name: `${PREFIX}·T+5 未破首板最低价 且 已回撤(相对首板收盘) → ${f.label}`,
      target: f.tpl(5),
      config: { targetField: f.tpl(5) },
      conditions: [guardCondition(0), pullbackOnlyCondition(5, 1)],
    });
  }

  // ---- A-2b：未破首板最低价 × T+5 × 5 桶 × 4 族 = 20 ----
  for (const f of FAMILIES_NEEDING_GUARD_BUCKETS) {
    for (const b of DEPTH_BUCKETS) {
      items.push({
        analysisType: "CONDITIONAL",
        name: `${PREFIX}·T+5 未破首板最低价 且 回撤${b.label} → ${f.label}`,
        target: f.tpl(5),
        config: { targetField: f.tpl(5) },
        conditions: [guardCondition(0), ...depthConditions(5, b, 1)],
      });
    }
  }

  return items;
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const caller = researchEngineRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 1, role: "admin", name: "r010" } as never,
  });

  const vars = await caller.listVariables({ datasetVersionId: DATASET_VERSION_ID });
  const ctx = vars.datasetVersion;
  const catalog = new ResearchVariableCatalog(
    ctx.horizons,
    ctx.pathRelativeDayRange
      ? Array.from(
          { length: ctx.pathRelativeDayRange.max - ctx.pathRelativeDayRange.min + 1 },
          (_, i) => ctx.pathRelativeDayRange!.min + i,
        )
      : [],
  );

  const lines: string[] = [];
  lines.push(`# RESEARCH-007.3 Run ${TARGET_RUN_ID} 覆盖补齐预检（Dataset Version ${DATASET_VERSION_ID} / ${ctx.versionLabel}）`);
  lines.push("");
  lines.push(`|h 项|值|`);
  lines.push(`|---|---|`);
  lines.push(`| 可用 outcome 视界 | ${ctx.horizons.join(", ")} |`);
  lines.push(`| ` + "`holds_event_low_*`" + ` 实际存在 | ${ctx.horizons.map((h) => `holds_event_low_${h}d`).join(", ")} |`);
  lines.push(`| path 相对日范围 | ${ctx.pathRelativeDayRange?.min}~${ctx.pathRelativeDayRange?.max} |`);
  lines.push("");

  const items = buildItems();
  lines.push(`## 待补批次：${items.length} 个分析`);
  lines.push("");
  lines.push(
    `构成：A-1 参照列 ${FAMILIES_NEEDING_REFERENCE.length} 族 × 5 天 = ${FAMILIES_NEEDING_REFERENCE.length * 5}；` +
      `A-2a 加资格参照列 ${FAMILIES.length} 族 × 1 = ${FAMILIES.length}；` +
      `A-2b 加资格桶列 ${FAMILIES_NEEDING_GUARD_BUCKETS.length} 族 × ${DEPTH_BUCKETS.length} 桶 = ${FAMILIES_NEEDING_GUARD_BUCKETS.length * DEPTH_BUCKETS.length}`,
  );
  lines.push("");

  let failures = 0;
  items.forEach((item, i) => {
    const fake: ResearchAnalysis = {
      runId: TARGET_RUN_ID,
      analysisType: item.analysisType as never,
      name: item.name,
      target: item.target ?? null,
      config: item.config,
      status: "PENDING",
    };
    try {
      resolveEngineAnalysisConfig({ analysis: fake, catalog });
      for (const c of item.conditions ?? []) {
        const known =
          catalog.hasFeature(c.fieldName) ||
          catalog.hasOutcome(c.fieldName) ||
          ["year", "month", "quarter", "board", "market", "industry"].includes(c.fieldName);
        if (!known) throw new Error(`条件字段 "${c.fieldName}" 不在变量目录中`);
      }
      lines.push(`${String(i + 1).padStart(3, "0")}. OK  ${item.name} | target=${item.target}`);
    } catch (e) {
      failures += 1;
      lines.push(`${String(i + 1).padStart(3, "0")}. FAIL ${item.name}`);
      lines.push(`        ${(e as Error).message}`);
    }
  });

  lines.push("");
  lines.push(`预检结论：${failures === 0 ? "全部通过" : `${failures} 项未通过`}`);

  // ---- 现状核对：Run 状态 / 分析数 / 重名 ----
  const existing = await caller.listAnalyses({ runId: TARGET_RUN_ID });
  const names = new Set(existing.map((a) => a.name));
  const dupes = items.filter((it) => names.has(it.name));
  const runs = await caller.listRuns({ experimentId: EXPERIMENT_ID });

  lines.push("");
  lines.push(`## 实验 ${EXPERIMENT_ID} 的 Run 现状`);
  lines.push("");
  lines.push(`| Run | runNo | status | 分析数 |`);
  lines.push(`|---|---:|---|---:|`);
  const allAnalyses = (await Promise.all(runs.map((r) => caller.listAnalyses({ runId: r.id! })))).map((a) => a.length);
  runs.forEach((r, i) => {
    lines.push(`| ${r.id} | ${r.runNo} | ${r.status} | ${allAnalyses[i]} |`);
  });
  const running = runs.filter((r) => r.status === "RUNNING");
  lines.push("");
  lines.push(`RUNNING 的 Run：${running.length === 0 ? "无 ✅" : running.map((r) => r.id).join(",") + " ❌"}`);
  lines.push("");
  lines.push(`## 重名检测（对 Run ${TARGET_RUN_ID} 现有 ${existing.length} 条）`);
  lines.push("");
  lines.push(dupes.length === 0 ? `无重名 ✅` : `重名 ${dupes.length} 条 ❌\n` + dupes.map((d) => `- ${d.name}`).join("\n"));

  const blocked = failures > 0 || dupes.length > 0 || running.length > 0;

  if (execute) {
    if (blocked) throw new Error("预检未通过（失败项/重名/在途 Run），拒绝创建（一个都不建）");
    lines.push("");
    lines.push("## 执行");
    const batch = await caller.createAnalyses({
      runId: TARGET_RUN_ID,
      items: items.map((it) => ({
        analysisType: it.analysisType as never,
        name: it.name,
        ...(it.target !== undefined ? { target: it.target } : {}),
        config: it.config,
        ...(it.conditions !== undefined ? { conditions: it.conditions as never } : {}),
      })),
    });
    lines.push(`- 批量建分析：created=${batch.createdCount} failed=${batch.failedCount}`);
    if (batch.failedCount > 0) lines.push("```json\n" + JSON.stringify(batch.failed, null, 2) + "\n```");
    lines.push(`- analysisIds=${batch.created.map((c) => c.analysisId).join(",")}`);
    const after = await caller.listAnalyses({ runId: TARGET_RUN_ID });
    lines.push(`- 建后 Run ${TARGET_RUN_ID} 分析数 = ${after.length}`);
    lines.push("");
    lines.push("下一步：`npx tsx _r010_backfill_run.mts`（runIncremental，只补 PENDING，不覆盖已完成的 135 条）");
  }

  writeFileSync("_r010_backfill_plan.md", lines.join("\n"));
  console.log(lines.join("\n"));
  process.exit(blocked ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
