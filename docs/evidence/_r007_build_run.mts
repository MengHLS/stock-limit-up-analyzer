/**
 * RESEARCH-007 — 「首板后回撤收益特征分析」批次构造 + 预检（默认 --dry-run，只读）。
 *
 * 设计纪律：本脚本**不实现任何统计逻辑**，只是把用户的研究问题翻译成
 * **现有 Analysis Domain Model 能表达的**分析定义，然后交给引擎自己的
 * `resolveEngineAnalysisConfig` 做权威预检 —— 变量名、窗、分档全部来自
 * 真实变量目录（listVariables），不猜、不硬编码研究结论。
 *
 * 用法：
 *   npx tsx _r007_build_run.mts            # 只预检（不写库）
 *   npx tsx _r007_build_run.mts --execute  # 建 Run + 批量建分析（不执行引擎）
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";
import { ResearchVariableCatalog } from "../../server/researchEngine/variables";
import { resolveEngineAnalysisConfig } from "../../server/researchEngine/analysisConfig";
import type { ResearchAnalysis } from "../../server/researchCore";

const DATASET_VERSION_ID = 390002;
const EXPERIMENT_ID = 240002;

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

/** 相对首板收盘价的回撤深度分桶（负值 = 回撤）。固定百分比宽度。 */
const DEPTH_BUCKETS: Array<{ label: string; op: string; value: unknown }> = [
  { label: "0~2%", op: "BETWEEN", value: [-0.02, 0] },
  { label: "2~4%", op: "BETWEEN", value: [-0.04, -0.02] },
  { label: "4~6%", op: "BETWEEN", value: [-0.06, -0.04] },
  { label: "6~8%", op: "BETWEEN", value: [-0.08, -0.06] },
  { label: "8%+", op: "<=", value: -0.08 },
];

/** 回撤当日量比分桶（相对首板日成交量）。 */
const VOLUME_BUCKETS: Array<{ label: string; op: string; value: unknown }> = [
  { label: "<0.5", op: "<", value: 0.5 },
  { label: "0.5~0.8", op: "BETWEEN", value: [0.5, 0.8] },
  { label: "0.8~1.0", op: "BETWEEN", value: [0.8, 1.0] },
  { label: "1.0~1.5", op: "BETWEEN", value: [1.0, 1.5] },
  { label: ">1.5", op: ">", value: 1.5 },
];

function segmentItem(
  name: string,
  d: number,
  to: number,
  stat: "return" | "max_return" | "min_return" | "max_drawdown",
): Item {
  return {
    analysisType: "SEGMENT_RELATION",
    name,
    target: `segment_${stat}_${d}_${to}d`,
    config: {
      windowA: [0, d],
      windowB: [d, to],
      windowAStat: "return",
      windowBStat: stat,
      windowBands: 5,
    },
  };
}

function buildItems(): Item[] {
  const items: Item[] = [];

  // ---- A/B 组：回撤日 × 等频深度档 → 之后 5 / 10 日收益（锚在 T+d 收盘）----
  for (const d of [1, 2, 3, 4, 5]) {
    items.push(
      segmentItem(
        `${PREFIX}·T+${d} 相对首板收盘涨跌幅 5 档 → 之后 5 日收益`,
        d,
        d + 5,
        "return",
      ),
    );
  }
  for (const d of [1, 2, 3, 4, 5]) {
    items.push(
      segmentItem(
        `${PREFIX}·T+${d} 相对首板收盘涨跌幅 5 档 → 之后 10 日收益`,
        d,
        d + 10,
        "return",
      ),
    );
  }

  // ---- C 组：固定百分比回撤桶（用户口径 0~2% / 2~4% / … / 8%+）→ 之后 5 日收益 ----
  for (const d of [2, 3]) {
    for (const bucket of DEPTH_BUCKETS) {
      items.push({
        analysisType: "CONDITIONAL",
        name: `${PREFIX}·T+${d} 相对首板收盘回撤 ${bucket.label} → 之后 5 日收益`,
        target: `segment_return_${d}_${d + 5}d`,
        config: { targetField: `segment_return_${d}_${d + 5}d` },
        conditions: [
          {
            groupNo: 0,
            sortOrder: 0,
            fieldName: `future_return_${d}d`,
            operator: bucket.op,
            value: bucket.value,
          },
        ],
      });
    }
  }

  // ---- D 组：风险侧（最大有利偏移 / 最深跌幅），候选日 T+2 / T+3 ----
  for (const d of [2, 3]) {
    items.push(
      segmentItem(`${PREFIX}·T+${d} 深度5档 → 之后5日最大有利偏移`, d, d + 5, "max_return"),
    );
    items.push(
      segmentItem(`${PREFIX}·T+${d} 深度5档 → 之后5日最深跌幅`, d, d + 5, "max_drawdown"),
    );
  }

  // ---- E 组：回撤当日量比（缩量 / 放量）→ 之后 5 日收益（T+2，含「确已回撤」前置条件）----
  for (const bucket of VOLUME_BUCKETS) {
    items.push({
      analysisType: "CONDITIONAL",
      name: `${PREFIX}·T+2 回撤且当日量比 ${bucket.label} → 之后 5 日收益`,
      target: "segment_return_2_7d",
      config: { targetField: "segment_return_2_7d" },
      conditions: [
        { groupNo: 0, sortOrder: 0, fieldName: "future_return_2d", operator: "<", value: 0 },
        {
          groupNo: 0,
          sortOrder: 1,
          fieldName: "volume_ratio_2d",
          operator: bucket.op,
          value: bucket.value,
        },
      ],
    });
  }

  return items;
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const caller = researchEngineRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 1, role: "admin", name: "r007" } as never,
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

  const items = buildItems();
  const lines: string[] = [];
  lines.push(`# RESEARCH-007 批次预检（Dataset Version ${DATASET_VERSION_ID} / ${ctx.versionLabel}）`);
  lines.push("");
  lines.push(`分析个数：${items.length}`);
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
      // 条件字段可用性（与前端 validateConditionDraft 同源：feature / outcome / dimension）
      for (const c of item.conditions ?? []) {
        const known =
          catalog.hasFeature(c.fieldName) ||
          catalog.hasOutcome(c.fieldName) ||
          ["year", "month", "quarter", "board", "market", "industry"].includes(c.fieldName);
        if (!known) throw new Error(`条件字段 "${c.fieldName}" 不在变量目录中`);
      }
      lines.push(`${String(i + 1).padStart(2, "0")}. ✅ ${item.analysisType} | ${item.name}`);
      lines.push(`     target=${item.target ?? "—"} config=${JSON.stringify(item.config)}`);
      if (item.conditions) lines.push(`     conditions=${JSON.stringify(item.conditions)}`);
    } catch (e) {
      failures += 1;
      lines.push(`${String(i + 1).padStart(2, "0")}. ❌ ${item.analysisType} | ${item.name}`);
      lines.push(`     错误：${(e as Error).message}`);
    }
  });

  lines.push("");
  lines.push(`预检结论：${failures === 0 ? "全部通过" : `${failures} 项未通过`}`);

  if (execute) {
    if (failures > 0) throw new Error("预检未通过，拒绝创建（一个都不建）");
    // 并发写状态纪律：有 Run 在途时不得新建/改状态（会被引擎收尾覆盖，或反过来覆盖引擎）。
    const runs = await caller.listRuns({ experimentId: EXPERIMENT_ID });
    const running = runs.filter((r) => r.status === "RUNNING");
    if (running.length > 0) {
      throw new Error(
        `实验 ${EXPERIMENT_ID} 存在 RUNNING 的 Run（${running.map((r) => r.id).join(",")}）⇒ 按项目纪律中止，不写状态`,
      );
    }
    const run = await caller.createRun({
      experimentId: EXPERIMENT_ID,
      config: {
        note: "RESEARCH-007 首板后回撤收益特征分析（分析编码 first_limit_pullback_return_analysis）",
      },
    });
    lines.push("");
    lines.push(`已创建 Run：id=${run.id} runNo=${run.runNo}`);
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
    lines.push(
      `批量建分析：created=${batch.createdCount} failed=${batch.failedCount}`,
    );
    if (batch.failedCount > 0) lines.push(JSON.stringify(batch.failed, null, 2));
    lines.push(`analysisIds=${batch.created.map((c) => c.analysisId).join(",")}`);
  }

  writeFileSync("_r007_batch_plan.md", lines.join("\n"));
  console.log(lines.join("\n"));
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
