/**
 * RESEARCH-002 — Research Engine 真实 Dataset 端到端验收（**禁止 Mock**）。
 *
 * 对应指令 §15「一个真实端到端验收案例」与 §20「至少一个真实 Dataset 端到端运行成功」。
 *
 * 流程：
 *   Dataset Version（真实 TiDB，first_limit_pullback 的 READY 版本）
 *     → Experiment「首板换手率与未来5日收益研究」
 *     → Hypothesis「换手率不同区间的首板股票，未来5日收益存在系统性差异。」
 *     → Run（PENDING）
 *     → Analysis（QUANTILE：turnover → future_return_5d，10 分位）
 *     → ResearchEngine.run()：真实读 Dataset → 计算 → 落 Result → 生成 Conclusion
 *     → 全部经 Repository 查回（证明可追溯）
 *
 * 额外可选分析（--all）：DESCRIPTIVE / EVENT_STUDY / CONDITIONAL / STABILITY，
 * 用于在真实数据上验证 5 种分析全部可用。
 *
 * 用法：
 *   npx tsx scripts/verifyResearchEngine.mts                 # 仅 QUANTILE（指令 §15 的验收案例）
 *   npx tsx scripts/verifyResearchEngine.mts --all           # 5 种分析全跑
 *   npx tsx scripts/verifyResearchEngine.mts --keep          # 保留落库数据（默认跑完清理）
 *   npx tsx scripts/verifyResearchEngine.mts --version=390001
 *
 * 产出：
 *   - 控制台摘要（真实样本量 / 耗时 / 分位组明细 / 结论）
 *   - docs/research/RESEARCH-002-e2e-evidence.json（可复核的原始证据）
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDbResearchRepositories, type ResearchRepositories } from "../server/researchCore";
import { DbDatasetRegistry } from "../server/datasetRegistry/db";
import { RegistryResearchDatasetReader } from "../server/researchEngine/datasetReader";
import { ResearchEngine } from "../server/researchEngine/engine";
import { ResearchVariableCatalog } from "../server/researchEngine/variables";
import { percentile } from "../shared/quant-stats";

// ---------------------------------------------------------------------------
// CLI

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const RUN_ALL = flag("all");
const KEEP = flag("keep");
const DATASET_CODE = "first_limit_pullback";
const EXPERIMENT_NAME = "首板换手率与未来5日收益研究";
const HYPOTHESIS_STATEMENT = "换手率不同区间的首板股票，未来5日收益存在系统性差异。";

const EVIDENCE_PATH = resolve("docs/research/RESEARCH-002-e2e-evidence.json");

const t0 = Date.now();
const log = (...parts: unknown[]) => console.log(...parts);

// ---------------------------------------------------------------------------
// 清理（leaf-first；无 DB 外键，必须显式按依赖顺序删）

async function cleanupExperiment(repos: ResearchRepositories, experimentId: number): Promise<number> {
  let deleted = 0;
  const withRuns = await repos.relationships.getExperimentWithRuns(experimentId);
  for (const run of withRuns?.runs ?? []) {
    const withAnalyses = await repos.relationships.getRunWithAnalyses(run.id!);
    for (const analysis of withAnalyses?.analyses ?? []) {
      await repos.results.deleteByAnalysis(analysis.id!);
      await repos.conditions.deleteByAnalysis(analysis.id!);
      for (const metric of await repos.metrics.listByAnalysis(analysis.id!)) {
        await repos.metrics.delete(metric.id!);
      }
      await repos.analyses.delete(analysis.id!);
      deleted += 1;
    }
    await repos.runs.delete(run.id!);
    deleted += 1;
  }
  for (const hypothesis of await repos.hypotheses.listByExperiment(experimentId)) {
    await repos.hypotheses.delete(hypothesis.id!);
    deleted += 1;
  }
  for (const conclusion of await repos.conclusions.list({ experimentId })) {
    await repos.conclusions.delete(conclusion.id!);
    deleted += 1;
  }
  for (const candidate of await repos.candidates.list({ experimentId })) {
    await repos.candidates.delete(candidate.id!);
    deleted += 1;
  }
  await repos.experiments.delete(experimentId);
  deleted += 1;
  return deleted;
}

/** 同名 Experiment 视为上一次残留 → 先清理，保证脚本可重复执行。 */
async function purgeExisting(repos: ResearchRepositories): Promise<number> {
  const existing = await repos.experiments.list({});
  let purged = 0;
  for (const experiment of existing) {
    if (experiment.name !== EXPERIMENT_NAME) continue;
    purged += await cleanupExperiment(repos, experiment.id!);
  }
  return purged;
}

// ---------------------------------------------------------------------------
// Main

async function main() {
  const repos = createDbResearchRepositories();
  const registryRepo = new DbDatasetRegistry();
  const reader = new RegistryResearchDatasetReader({ registryRepo });

  // ---- 0. 选定真实 Dataset Version ----
  const definition = await registryRepo.getDefinitionByCode(DATASET_CODE);
  if (!definition?.id) throw new Error(`未找到 Dataset 定义：${DATASET_CODE}`);
  const allVersions = await registryRepo.listVersions(definition.id);
  const readyVersions = allVersions.filter((v) => v.status === "READY");

  const explicit = arg("version");
  const version = explicit
    ? readyVersions.find((v) => String(v.id) === explicit)
    : [...readyVersions].sort((a, b) => Number(b.totalEvents ?? 0) - Number(a.totalEvents ?? 0))[0];

  if (!version?.id) {
    throw new Error(
      `Dataset ${DATASET_CODE} 没有可用的 READY 版本。现有版本：${allVersions
        .map((v) => `${v.id}:${v.version}:${v.status}`)
        .join(", ")}`,
    );
  }

  log("=".repeat(78));
  log("RESEARCH-002 — Research Engine 真实 Dataset 端到端验收");
  log("=".repeat(78));
  log(`Dataset            : ${definition.datasetCode} (${definition.name})`);
  log(`Dataset Version    : ${version.id} / ${version.version} / ${version.status}`);
  log(`日期区间           : ${String(version.startDate)} → ${String(version.endDate)}`);
  log(`声明事件数         : ${version.totalEvents}`);
  log("");

  const context = await reader.getVersionContext(version.id);
  if (!context) throw new Error(`读取 Dataset Version 上下文失败：${version.id}`);
  log(`真实事件数         : ${context.totalEvents}`);
  log(`outcome 视界       : [${context.horizons.join(", ")}]`);
  log(`path 相对日范围    : [${context.pathRelativeDayRange?.min}, ${context.pathRelativeDayRange?.max}]`);
  log("");

  // 变量目录：视界来自 Dataset 真实值
  const pathHorizons = context.pathRelativeDayRange
    ? Array.from(
        { length: context.pathRelativeDayRange.max - context.pathRelativeDayRange.min + 1 },
        (_, i) => context.pathRelativeDayRange!.min + i,
      )
    : [];
  const catalog = new ResearchVariableCatalog(context.horizons, pathHorizons);
  log(`可用特征变量       : ${catalog.listFeatures().length} 个`);
  log(`可用结果变量       : ${catalog.listOutcomes().length} 个（含 path 推导视界）`);

  // ---- 清理上一次残留 ----
  const purged = await purgeExisting(repos);
  if (purged > 0) log(`\n已清理同名 Experiment 残留实体：${purged} 行`);

  // ---- 1. Experiment ----
  const experiment = await repos.experiments.create({
    datasetVersionId: version.id,
    name: EXPERIMENT_NAME,
    description: "RESEARCH-002 验收案例：首板股票的换手率与未来 5 日收益关系（分位研究）。",
    researchType: "FEATURE",
  });
  log(`\n[1] Experiment 已创建 id=${experiment.id} status=${experiment.status}`);

  // ---- 2. Hypothesis ----
  const hypothesis = await repos.hypotheses.create({
    experimentId: experiment.id!,
    name: "H1 — 换手率分位与未来 5 日收益",
    statement: HYPOTHESIS_STATEMENT,
    nullHypothesis: "换手率各分位组的未来 5 日收益无系统性差异（首尾分位差 = 0）。",
    alternativeHypothesis: "换手率首尾分位组的未来 5 日收益存在显著差异（首尾分位差 ≠ 0）。",
  });
  log(`[2] Hypothesis 已创建 id=${hypothesis.id}`);

  // ---- 3. Run ----
  const run = await repos.runs.create({ experimentId: experiment.id!, runNo: 1 });
  log(`[3] Run 已创建 id=${run.id} status=${run.status}`);

  // ---- 4. Analyses ----
  const analysisSpecs: Array<{
    analysisType: string;
    name: string;
    target: string | null;
    config: unknown;
    conditions?: Array<{
      groupNo: number;
      sortOrder: number;
      fieldName: string;
      operator: string;
      value: unknown;
    }>;
  }> = [
    {
      analysisType: "QUANTILE",
      name: "换手率十分位 → 未来5日收益",
      target: "future_return_5d",
      config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10 },
    },
  ];

  if (RUN_ALL) {
    analysisSpecs.push(
      {
        analysisType: "DESCRIPTIVE",
        name: "描述统计：换手率 / 未来5日收益",
        target: null,
        config: { variables: ["turnover", "future_return_5d"], quantileGroups: 10 },
      },
      {
        analysisType: "EVENT_STUDY",
        name: "事件研究：T+1 / T+3 / T+5",
        target: null,
        config: { targetField: "future_return_5d", horizons: [1, 3, 5] },
      },
      {
        analysisType: "CONDITIONAL",
        name: "条件研究：换手率 3%~10% 首板",
        target: "future_return_5d",
        config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10 },
        conditions: [
          { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 3 },
          { groupNo: 0, sortOrder: 1, fieldName: "turnover", operator: "<=", value: 10 },
        ],
      },
      {
        // 注意：本 Dataset Version 只覆盖一个月（见运行输出），
        // 因此 year / month 维度会退化为单组（STABILITY_RATIO 无法计算 → null，如实反映）。
        // 这里用 board 维度，才能在真实数据上检验「多组稳定性」的执行路径确实工作。
        analysisType: "STABILITY",
        name: "稳定性：按板块分组",
        target: "future_return_5d",
        config: { targetField: "future_return_5d", stabilityDimension: "board" },
      },
    );
  }

  const analyses = [];
  for (const spec of analysisSpecs) {
    const analysis = await repos.analyses.create({
      runId: run.id!,
      analysisType: spec.analysisType as never,
      name: spec.name,
      target: spec.target,
      config: spec.config,
    });
    if (spec.conditions) {
      await repos.conditions.replaceForAnalysis(
        analysis.id!,
        spec.conditions.map((c) => ({ ...c, logicalOperator: "AND", groupLogicalOperator: "AND" })),
      );
    }
    analyses.push(analysis);
    log(`[4] Analysis 已创建 id=${analysis.id} type=${spec.analysisType} name=${spec.name}`);
  }

  // ---- 5. 执行引擎 ----
  log("\n[5] 执行 ResearchEngine.run() …");
  const engine = new ResearchEngine({ repos, reader });
  const engineStarted = Date.now();
  const result = await engine.run({ experimentId: experiment.id!, runId: run.id! });
  const engineMs = Date.now() - engineStarted;

  log(`    完成：status 由引擎落库，耗时 ${engineMs} ms`);
  log(`    真实样本量 sampleCount = ${result.sampleCount}`);
  log(`    结果行数 resultCount   = ${result.resultCount}`);
  log(`    结论 conclusionId      = ${result.conclusionId} (${result.conclusionType})`);
  log(`\n    耗时分解（真实测量）：`);
  log(`      Dataset 装配（分页读事件 + 批量读 path/outcome + 维度） : ${result.sampleBuildMs} ms`);
  for (const a of result.analyses) {
    log(`      ${a.analysisType.padEnd(12)} id=${a.analysisId} ${a.status}  ${a.durationMs} ms  (${a.resultCount} 行)`);
  }
  const analysisTotal = result.analyses.reduce((s, a) => s + a.durationMs, 0);
  log(`      分析合计 ${analysisTotal} ms / 引擎总计 ${result.durationMs} ms`);

  // ---- 6. 查回验证（证明可追溯）----
  log("\n[6] 通过 Repository 查回（证明全链路可追溯）");
  const runBack = await repos.runs.getById(run.id!);
  const experimentBack = await repos.experiments.getById(experiment.id!);
  log(`    Run.status            = ${runBack?.status}`);
  log(`    Run.sampleCount       = ${runBack?.sampleCount}`);
  log(`    Run.startedAt         = ${String(runBack?.startedAt)}`);
  log(`    Run.completedAt       = ${String(runBack?.completedAt)}`);
  log(`    Run.errorCode         = ${String(runBack?.errorCode)}`);
  log(`    Experiment.status     = ${experimentBack?.status}`);
  log(`    Experiment.sampleCount= ${experimentBack?.sampleCount}`);

  const snapshot = runBack?.inputSnapshot as { variables?: unknown; analysisTypes?: unknown } | undefined;
  log(`    inputSnapshot.variables  = ${JSON.stringify(snapshot?.variables)}`);
  log(`    inputSnapshot.analyses   = ${JSON.stringify(snapshot?.analysisTypes)}`);

  // ---- 7. 分位组明细（真实研究输出）----
  const evidence: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    dataset: {
      datasetCode: definition.datasetCode,
      datasetName: definition.name,
      datasetVersionId: version.id,
      versionLabel: version.version,
      status: version.status,
      startDate: version.startDate,
      endDate: version.endDate,
      totalEvents: context.totalEvents,
      horizons: context.horizons,
      pathRelativeDayRange: context.pathRelativeDayRange,
    },
    experiment: { id: experiment.id, name: experiment.name, researchType: experiment.researchType },
    hypothesis: { id: hypothesis.id, statement: hypothesis.statement },
    run: {
      id: run.id,
      status: runBack?.status,
      sampleCount: runBack?.sampleCount,
      errorCode: runBack?.errorCode ?? null,
      engineDurationMs: engineMs,
      totalScriptMs: null as number | null,
    },
    engineResult: result,
    analyses: [] as unknown[],
  };

  for (const analysis of analyses) {
    const bundle = await repos.relationships.getAnalysisBundle(analysis.id!);
    const results = await repos.results.list({ analysisId: analysis.id! });
    log(`\n--- Analysis ${analysis.id} (${analysis.analysisType}) ---`);
    log(`    状态=${bundle?.analysis.status}  结果行数=${results.length}`);

    // 分组明细（维度可能是 quantile / horizon / variable / group）。
    // 每个指标各自带 sampleCount —— 同一分组的**不同指标分母可能不同**
    // （例如 CONDITIONAL 的 MEAN_RETURN 用非空收益样本、MAX_DRAWDOWN 用非空回撤样本），
    // 因此逐指标保存 n，展示时以 SAMPLE_COUNT 为准，并把分母不一致如实标注出来。
    const groupRows = results.filter((r) => r.resultType === "GROUPED");
    const byGroup = new Map<string, Map<string, { value: number | null; n: number | null }>>();
    for (const row of groupRows) {
      const label = groupLabel(row.dimension);
      const bucket = byGroup.get(label) ?? new Map<string, { value: number | null; n: number | null }>();
      bucket.set(row.metricCode, { value: row.metricValue ?? null, n: row.sampleCount ?? null });
      byGroup.set(label, bucket);
    }
    for (const [label, metrics] of [...byGroup.entries()].sort()) {
      const first = [...metrics.values()][0];
      const n = metrics.get("SAMPLE_COUNT")?.n ?? first?.n ?? null;
      const mean = metrics.get("MEAN_RETURN")?.value ?? metrics.get("MEAN")?.value ?? null;
      const med = metrics.get("MEDIAN_RETURN")?.value ?? metrics.get("MEDIAN")?.value ?? null;
      const win = metrics.get("WIN_RATE")?.value ?? null;
      log(
        `      ${label.padEnd(10)} n=${String(n).padStart(4)}  mean=${fmt(mean)}  median=${fmt(med)}  winRate=${fmt(win)}`,
      );
      const distinct = [...new Set([...metrics.values()].map((m) => String(m.n)))];
      if (distinct.length > 1) {
        log(
          `      ${" ".repeat(10)} ⚠️ 同组内不同指标的样本数不一致（${distinct.join(" / ")}）——各指标在自己的可用样本上计算，比较时须注意分母`,
        );
      }
    }

    // 标量指标
    for (const row of results.filter((r) => r.resultType === "SCALAR")) {
      log(`      [SCALAR] ${row.metricCode} = ${fmt(row.metricValue)}  (n=${row.sampleCount ?? "-"})`);
    }

    evidence.analyses.push({
      analysisId: analysis.id,
      analysisType: analysis.analysisType,
      name: analysis.name,
      target: analysis.target,
      config: analysis.config,
      status: bundle?.analysis.status,
      resultCount: results.length,
      groupedSummary: Object.fromEntries(
        [...byGroup.entries()].sort().map(([label, metrics]) => [
          label,
          Object.fromEntries([...metrics.entries()].map(([code, m]) => [code, m.value])),
        ]),
      ),
      groupedSampleCounts: Object.fromEntries(
        [...byGroup.entries()].sort().map(([label, metrics]) => [
          label,
          Object.fromEntries([...metrics.entries()].map(([code, m]) => [code, m.n])),
        ]),
      ),
      scalarResults: results
        .filter((r) => r.resultType === "SCALAR")
        .map((r) => ({ metricCode: r.metricCode, metricValue: r.metricValue, sampleCount: r.sampleCount, details: r.details })),
    });
  }

  // ---- 8. 结论 ----
  const conclusions = await repos.conclusions.list({ experimentId: experiment.id! });
  log("\n[8] Conclusion");
  for (const conclusion of conclusions) {
    log(`    类型       : ${conclusion.conclusionType}`);
    log(`    标题       : ${conclusion.title}`);
    log(`    置信(主观) : ${conclusion.confidence}`);
    log(`    结论       :`);
    for (const line of String(conclusion.conclusion).split("\n")) log(`      ${line}`);
    log(`    证据       :`);
    const evidenceText =
      typeof conclusion.evidence === "string"
        ? conclusion.evidence
        : JSON.stringify(conclusion.evidence, null, 2);
    for (const line of evidenceText.split("\n")) log(`      ${line}`);
  }

  // ---- 8b. 独立复核：手工重算首尾分位差（不依赖引擎代码路径）----
  const check = await independentRecompute(reader, version.id, context.horizons);
  log("\n[8b] 独立复核（脱离引擎，直接读物理表复算）");
  log(`    全样本 n=${check.n}  均值=${fmt(check.mean)}`);
  log(`    分位数边界 ${JSON.stringify(check.cutPoints.map((c) => round(c, 4)))}`);
  log(`    首组 mean=${fmt(check.bottomMean)} (n=${check.bottomN})`);
  log(`    尾组 mean=${fmt(check.topMean)} (n=${check.topN})`);
  log(`    首尾差 = ${fmt(check.spread)}`);
  evidence.independentRecompute = check;

  // ---- 9. PIT 说明 ----
  log("\n[9] PIT 安全性");
  log(`    QUANTILE 特征 turnover 仅来自 event/prefix（rd ≤ 0），结果 future_return_5d 来自 path（rd ≥ 1）`);
  log(`    结构与类型双保险：FeatureSources / OutcomeSources 互斥（见 server/researchEngine/variables.ts）`);

  // ---- 收尾 ----
  evidence.run && ((evidence.run as Record<string, unknown>).totalScriptMs = Date.now() - t0);
  evidence.conclusions = conclusions.map((c) => ({
    id: c.id,
    conclusionType: c.conclusionType,
    title: c.title,
    conclusion: c.conclusion,
    evidence: c.evidence,
    confidence: c.confidence,
  }));
  evidence.elapsedMs = Date.now() - t0;

  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2), "utf8");
  log(`\n证据已写入：${EVIDENCE_PATH}`);

  if (KEEP) {
    log(`\n--keep：保留落库数据 experimentId=${experiment.id}`);
  } else {
    const removed = await cleanupExperiment(repos, experiment.id!);
    log(`\n已清理验收数据：${removed} 行（Experiment ${experiment.id} 及其全部下游实体）`);
    const afterExp = await repos.experiments.getById(experiment.id!);
    const afterRuns = await repos.runs.list({ experimentId: experiment.id! });
    log(`    清理后校验：experiment=${afterExp ? "仍存在" : "已删除"}  runs=${afterRuns.length}`);
  }

  log(`\n总耗时 ${Date.now() - t0} ms`);
  const failures = result.analyses.filter((a) => a.status === "FAILED");
  if (failures.length > 0) {
    log(`\n❌ 有 ${failures.length} 个分析失败`);
    process.exitCode = 1;
  } else {
    log("\n✅ RESEARCH-002 真实 Dataset 端到端验收通过");
  }
}

/**
 * 独立复核：不经引擎/分位实现，直接从物理表复算首尾分位差。
 * 用 percentile 同一定义（groups=10 的第 1..9 个十分位切点）分组，验证引擎输出可被复现。
 */
async function independentRecompute(
  reader: RegistryResearchDatasetReader,
  datasetVersionId: number,
  horizons: readonly number[],
) {
  const pageSize = 5000;
  let cursor: string | null = null;
  const pairs: Array<{ f: number; y: number }> = [];
  for (;;) {
    const page = await reader.loadEventPage({
      datasetVersionId,
      limit: pageSize,
      cursor,
    });
    const eventIds = page.items.map((e) => e.eventId);
    const features = new Map(page.items.map((e) => [e.eventId, e.turnover]));
    const paths = await reader.loadPaths({ datasetVersionId, eventIds, relativeDays: [5] });
    const closeByEvent = new Map(paths.map((p) => [p.eventId, p.closeFromEventClose]));
    for (const eventId of eventIds) {
      const f = features.get(eventId);
      const y = closeByEvent.get(eventId);
      if (typeof f === "number" && Number.isFinite(f) && typeof y === "number" && Number.isFinite(y)) {
        pairs.push({ f, y });
      }
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }

  const sorted = [...pairs].sort((a, b) => a.f - b.f);
  const groups = 10;
  const cutPoints = Array.from({ length: groups - 1 }, (_, k) => percentile(sorted.map((p) => p.f), ((k + 1) / groups) * 100));
  const bucket = (v: number) => 1 + cutPoints.filter((c) => v > c).length;
  const byGroup = new Map<number, number[]>();
  for (const p of sorted) {
    const g = bucket(p.f);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(p.y);
  }
  const labels = [...byGroup.keys()].sort((a, b) => a - b);
  const bottom = byGroup.get(labels[0]!)!;
  const top = byGroup.get(labels[labels.length - 1]!)!;
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return {
    n: pairs.length,
    mean: avg(pairs.map((p) => p.y)),
    cutPoints,
    actualGroups: labels.length,
    groupSizes: Object.fromEntries(labels.map((l) => [l, byGroup.get(l)!.length])),
    bottomN: bottom.length,
    topN: top.length,
    bottomMean: avg(bottom),
    topMean: avg(top),
    spread: avg(top) - avg(bottom),
    horizons,
  };
}

const fmt = (v: unknown): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(6) : "-";
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * 分组维度 → 可读标签。
 * `groupedResults` 落库结构是 `{ [dimensionKey]: label }`，
 * 各分析用的 key 不同（quantile / horizon / variable / group / board / year ...），
 * 因此按「单键对象」通用处理，只对 quantile / horizon 做展示美化。
 */
function groupLabel(dimension: unknown): string {
  const dim = dimension as Record<string, unknown> | null;
  if (!dim) return "-";
  const keys = Object.keys(dim);
  if (keys.length !== 1) return JSON.stringify(dim);
  const key = keys[0]!;
  const value = dim[key];
  if (key === "quantile") return `Q${value}`;
  if (key === "horizon") return `T+${value}`;
  return String(value);
}

main().catch((error) => {
  console.error("\n❌ 端到端验收失败：", error);
  process.exitCode = 1;
});
