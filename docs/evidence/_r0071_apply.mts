/**
 * RESEARCH-007.1 — 「首板后有效回撤」校正 + 补齐（默认只预检，不写库）。
 *
 * 纪律：
 *   - **不实现任何统计逻辑**：只把研究问题翻译成**现有 Analysis Domain Model 能表达**的定义，
 *     然后交给引擎自己的 `resolveEngineAnalysisConfig` 做权威预检。
 *   - 变量名一律来自 `listVariables`（真实目录），不猜。
 *   - 口径全部写明在 `definition`/name 里；**不硬编码研究结论**。
 *   - 预检有一项不过 → 整批拒绝（一个都不建）。
 *
 * 用法：
 *   npx tsx _r0071_apply.mts              # 只预检 + 列出待改名分析
 *   npx tsx _r0071_apply.mts --execute    # 改名 + 建 Run + 建分析（不跑引擎）
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";
import { ResearchVariableCatalog } from "../../server/researchEngine/variables";
import { resolveEngineAnalysisConfig } from "../../server/researchEngine/analysisConfig";
import type { ResearchAnalysis } from "../../server/researchCore";

const DATASET_VERSION_ID = 390002;
const EXPERIMENT_ID = 240002;
const PREVIOUS_RUN_ID = 510001;

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

/**
 * 固定业务桶（**非等频**）：以「相对首板收盘的回撤深度」= −future_return_{d}d 定义。
 * `non_pullback`（深度 ≤ 0，即 T+d 收盘 ≥ 首板收盘）**不进任何桶**：
 * 故每桶用 `>= −hi AND < −lo` 两条条件精确刻画，而不是 BETWEEN 闭区间。
 */
const DEPTH_BUCKETS: Array<{ label: string; lo: number; hi: number | null }> = [
  { label: "0~2%", lo: 0.0, hi: 0.02 },
  { label: "2~4%", lo: 0.02, hi: 0.04 },
  { label: "4~6%", lo: 0.04, hi: 0.06 },
  { label: "6~8%", lo: 0.06, hi: 0.08 },
  { label: "8%+", lo: 0.08, hi: null },
];

/** 桶 → 两条条件（AND）：深度 ≥ lo，深度 < hi（8%+ 无上界）。 */
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

/** 5×5 每格要看的视界 / 风险指标（一个 CONDITIONAL 分析只能有一个目标变量）。 */
const CELL_TARGETS: Array<{ suffix: string; label: string; tpl: (d: number) => string }> = [
  { suffix: "5d_ret", label: "之后5日收益", tpl: (d) => `segment_return_${d}_${d + 5}d` },
  { suffix: "1d_ret", label: "之后1日收益", tpl: (d) => `segment_return_${d}_${d + 1}d` },
  { suffix: "3d_ret", label: "之后3日收益", tpl: (d) => `segment_return_${d}_${d + 3}d` },
  { suffix: "5d_max", label: "之后5日最大有利偏移", tpl: (d) => `segment_max_return_${d}_${d + 5}d` },
  { suffix: "5d_dd", label: "之后5日最深跌幅", tpl: (d) => `segment_max_drawdown_${d}_${d + 5}d` },
];

function buildItems(): Item[] {
  const items: Item[] = [];

  // ---- 组 A：按决策日「已回撤」（深度 > 0）→ 之后 5 日收益（无破位资格约束，见报告缺口表）----
  for (const d of [1, 2, 3, 4, 5]) {
    items.push({
      analysisType: "CONDITIONAL",
      name: `${PREFIX}·T+${d} 已回撤(相对首板收盘) → 之后5日收益`,
      target: `segment_return_${d}_${d + 5}d`,
      config: { targetField: `segment_return_${d}_${d + 5}d` },
      conditions: [
        {
          groupNo: 0,
          sortOrder: 0,
          fieldName: `future_return_${d}d`,
          operator: "<",
          value: 0,
          logicalOperator: "AND",
          groupLogicalOperator: "AND",
        },
      ],
    });
  }

  // ---- 组 B：5 × 5 固定桶（核心）----
  for (const d of [1, 2, 3, 4, 5]) {
    for (const b of DEPTH_BUCKETS) {
      for (const t of CELL_TARGETS) {
        items.push({
          analysisType: "CONDITIONAL",
          name: `${PREFIX}·T+${d} 回撤${b.label} → ${t.label}`,
          target: t.tpl(d),
          config: { targetField: t.tpl(d) },
          conditions: depthConditions(d, b, 0),
        });
      }
    }
  }

  // ---- 组 C：T+5 行加「截至 T+5 未破首板日最低价」资格（现有唯一可表达的滚动守护变量）----
  for (const b of DEPTH_BUCKETS) {
    items.push({
      analysisType: "CONDITIONAL",
      name: `${PREFIX}·T+5 未破首板最低价 且 回撤${b.label} → 之后5日收益`,
      target: "segment_return_5_10d",
      config: { targetField: "segment_return_5_10d" },
      conditions: [
        {
          groupNo: 0,
          sortOrder: 0,
          fieldName: "holds_event_low_5d",
          operator: "==",
          value: 1,
          logicalOperator: "AND",
          groupLogicalOperator: "AND",
        },
        ...depthConditions(5, b, 1),
      ],
    });
  }

  return items;
}

/** Run 6 中仍带旧口径名（「深度5档」）的分析：按规格 §二 校正为「相对首板收盘涨跌幅5分位」。 */
function renamePlan(oldName: string): string | null {
  if (!oldName.includes("深度5档")) return null;
  return oldName.replace("深度5档", "相对首板收盘涨跌幅5分位");
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const caller = researchEngineRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 1, role: "admin", name: "r0071" } as never,
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
  lines.push(`# RESEARCH-007.1 批次预检（Dataset Version ${DATASET_VERSION_ID} / ${ctx.versionLabel}）`);
  lines.push("");
  lines.push(`|h 项|值|`);
  lines.push(`|---|---|`);
  lines.push(`| 可用 outcome 视界 | ${ctx.horizons.join(", ")} |`);
  lines.push(`| `+"`holds_event_low_*`"+` 实际存在 | ${ctx.horizons.map((h) => `holds_event_low_${h}d`).join(", ")} |`);
  lines.push(`| path 相对日范围 | ${ctx.pathRelativeDayRange?.min}~${ctx.pathRelativeDayRange?.max} |`);
  lines.push("");

  const items = buildItems();
  lines.push(`## 新批次：${items.length} 个分析`);
  lines.push("");

  let failures = 0;
  items.forEach((item, i) => {
    const fake: ResearchAnalysis = {
      runId: 0,
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
      if (i < 3 || i > items.length - 7) {
        lines.push(`${String(i + 1).padStart(3, "0")}. OK  ${item.name} | target=${item.target}`);
      }
    } catch (e) {
      failures += 1;
      lines.push(`${String(i + 1).padStart(3, "0")}. FAIL ${item.name}`);
      lines.push(`        ${(e as Error).message}`);
    }
  });
  if (items.length > 10) {
    lines.push(`... 中间 ${items.length - 9} 项同构省略（全部按同一模板生成）`);
  }

  lines.push("");
  lines.push(`预检结论：${failures === 0 ? "全部通过" : `${failures} 项未通过`}`);
  lines.push("");
  lines.push(`## 旧分析名称校正（Run ${PREVIOUS_RUN_ID}）`);
  lines.push("");

  const oldAnalyses = await caller.listAnalyses({ runId: PREVIOUS_RUN_ID });
  const renameTargets: Array<{ id: number; from: string; to: string }> = [];
  for (const a of oldAnalyses) {
    const to = renamePlan(a.name);
    if (to) renameTargets.push({ id: a.id!, from: a.name, to });
  }
  lines.push(`命中「深度5档」的分析：${renameTargets.length} 个`);
  for (const r of renameTargets) lines.push(`- ${r.id}：${r.from}\n  → ${r.to}`);
  lines.push("");
  lines.push(`⚠️ \`research_analysis\` 表无 description 列 ⇒ 规格 §二 要求的「写入 Analysis description」不可实现（详见报告）。`);

  if (execute) {
    if (failures > 0) throw new Error("预检未通过，拒绝创建（一个都不建）");

    const runs = await caller.listRuns({ experimentId: EXPERIMENT_ID });
    const running = runs.filter((r) => r.status === "RUNNING");
    if (running.length > 0) {
      throw new Error(`实验 ${EXPERIMENT_ID} 存在 RUNNING 的 Run（${running.map((r) => r.id).join(",")}）⇒ 中止`);
    }

    lines.push("");
    lines.push("## 执行");
    for (const r of renameTargets) {
      await caller.updateAnalysis({ analysisId: r.id, name: r.to });
      lines.push(`- 已改名 ${r.id}`);
    }

    const run = await caller.createRun({
      experimentId: EXPERIMENT_ID,
      config: {
        note: "RESEARCH-007.1 首板后有效回撤校正与补齐（固定桶 5×5；entry=close(T+d)；未含滚动破位资格，见报告）",
      },
    });
    lines.push(`- 已创建 Run：id=${run.id} runNo=${run.runNo}`);

    const batch = await caller.createAnalyses({
      runId: run.id!,
      items: items.map((it) => ({
        analysisType: it.analysisType as never,
        name: it.name,
        ...(it.target !== undefined ? { target: it.target } : {}),
        config: it.config,
        ...(it.conditions !== undefined ? { conditions: it.conditions as never } : {}),
      })),
    });
    lines.push(`- 批量建分析：created=${batch.createdCount} failed=${batch.failedCount}`);
    if (batch.failedCount > 0) lines.push(JSON.stringify(batch.failed, null, 2));
    lines.push(`- analysisIds=${batch.created.map((c) => c.analysisId).join(",")}`);
  }

  writeFileSync("_r0071_batch_plan.md", lines.join("\n"));
  console.log(lines.join("\n"));
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
