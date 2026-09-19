/**
 * PHASE-A-001 —— 研究报告产物回填 / 重生成 CLI（**同一份生成逻辑，不另起一套**）。
 *
 * 为什么需要它：`ResearchEngine.run()` 收口时会自动产出报告，但那只能覆盖**今后**的 Run。
 * 库里已经存在 15 条 COMPLETED 的历史 Run 在其执行时报告能力还不存在，
 * 需要一次性回填，否则「A-1 一个完成的 Run 对应一个最终 REPORT Artifact」对历史数据不成立。
 *
 * 本脚本只做三件事：遍历目标 Run → 调 `generateResearchReport`（与引擎同一个函数）→ 打印处置结果。
 * 它**不重算任何研究结果**：真正的投影在 `server/researchEngine/report/generator.ts`（纯函数）。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/generateResearchReport.mts --runId 750003
 *   node node_modules/tsx/dist/cli.mjs scripts/generateResearchReport.mts --runId 750003 --runId 750001
 *   node node_modules/tsx/dist/cli.mjs scripts/generateResearchReport.mts --experimentId 480003
 *   node node_modules/tsx/dist/cli.mjs scripts/generateResearchReport.mts --all-completed
 *   node node_modules/tsx/dist/cli.mjs scripts/generateResearchReport.mts --runId 750003 --dryRun
 *
 * 幂等：同一 Run 重复执行 ⇒ `outcome = REUSED`，`research_artifact` 行数**不增加**。
 * 退出码：0 = 全部成功；1 = 至少一个 Run 失败（逐条打印失败原因，不中断其余）。
 */

import "dotenv/config";
import { createDbResearchRepositories } from "../server/researchCore";
import { DbDatasetRegistry } from "../server/datasetRegistry/db";
import { RegistryResearchDatasetReader } from "../server/researchEngine/datasetReader";
import { generateResearchReport } from "../server/researchEngine/report";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const runIds: number[] = [];
let experimentId: number | null = null;
let allCompleted = false;
let dryRun = false;

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]!;
  if (arg === "--runId") {
    const value = Number(argv[i + 1]);
    if (!Number.isInteger(value) || value <= 0) {
      console.error(`--runId 需要正整数，收到：${argv[i + 1]}`);
      process.exit(2);
    }
    runIds.push(value);
    i += 1;
  } else if (arg === "--experimentId") {
    const value = Number(argv[i + 1]);
    if (!Number.isInteger(value) || value <= 0) {
      console.error(`--experimentId 需要正整数，收到：${argv[i + 1]}`);
      process.exit(2);
    }
    experimentId = value;
    i += 1;
  } else if (arg === "--all-completed") {
    allCompleted = true;
  } else if (arg === "--dryRun") {
    dryRun = true;
  } else if (arg === "--help" || arg === "-h") {
    console.log(
      [
        "用法：",
        "  --runId <id>          指定 Run（可重复）",
        "  --experimentId <id>   该实验下全部 COMPLETED 的 Run",
        "  --all-completed       全库全部 COMPLETED 的 Run",
        "  --dryRun              只装配 + 投影，不落库（用于验证正文/checksum）",
      ].join("\n"),
    );
    process.exit(0);
  } else {
    console.error(`未知参数：${arg}`);
    process.exit(2);
  }
}

if (runIds.length === 0 && experimentId === null && !allCompleted) {
  console.error("必须指定 --runId / --experimentId / --all-completed 之一（--help 查看用法）");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 装配（与 `server/researchEngineRouter.ts` 的默认实例同一构造方式）
// ---------------------------------------------------------------------------

const repos = createDbResearchRepositories();
const reader = new RegistryResearchDatasetReader({ registryRepo: new DbDatasetRegistry() });
const deps = { repos, reader };

/** 解析目标 Run 集合（只取 COMPLETED —— 报告只建立在已完成的 Run 上）。 */
async function resolveTargets(): Promise<Array<{ runId: number; experimentId: number }>> {
  const explicit = new Set<number>(runIds);
  const targets = new Map<number, { runId: number; experimentId: number }>();

  if (explicit.size > 0) {
    for (const runId of explicit) {
      const run = await repos.runs.getById(runId);
      if (!run) {
        console.error(`⚠️ 跳过 Run ${runId}：不存在`);
        continue;
      }
      targets.set(runId, { runId, experimentId: run.experimentId });
    }
  }

  if (experimentId !== null || allCompleted) {
    const experiments =
      experimentId !== null
        ? [await repos.experiments.getById(experimentId)].filter((e) => e !== undefined)
        : await repos.experiments.list();
    for (const experiment of experiments) {
      const runs = await repos.runs.list({ experimentId: experiment.id! });
      for (const run of runs) {
        if (run.id === undefined) continue;
        if (explicit.has(run.id)) continue;
        if (run.status !== "COMPLETED") continue;
        targets.set(run.id, { runId: run.id, experimentId: run.experimentId });
      }
    }
  }

  return [...targets.values()].sort((a, b) => a.runId - b.runId);
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

const targets = await resolveTargets();
if (targets.length === 0) {
  console.log("没有匹配的 Run（仅处理 COMPLETED）。");
  process.exit(0);
}

console.log(`目标 Run ${targets.length} 条${dryRun ? "（dryRun：不落库）" : ""}。`);

let ok = 0;
let failed = 0;
const summary: Array<Record<string, unknown>> = [];

for (const target of targets) {
  try {
    if (dryRun) {
      const { loadReportSource } = await import("../server/researchEngine/report/service");
      const { buildResearchReport } = await import("../server/researchEngine/report/generator");
      const { source } = await loadReportSource(deps, target.runId);
      const draft = buildResearchReport(source);
      summary.push({
        runId: target.runId,
        experimentId: target.experimentId,
        outcome: "DRY_RUN",
        checksum: draft.checksum,
        bodyBytes: draft.metadata.report.bytes,
        analysisIds: draft.metadata.analysisIds.length,
        findingIds: draft.metadata.findingIds.length,
        conclusionId: draft.metadata.conclusionId,
        patternIds: draft.metadata.patternIds,
        unresolvedTraceFields: draft.metadata.unresolvedTraceFields,
        warnings: draft.warnings,
      });
      console.log(
        `  [dryRun] run=${target.runId} checksum=${draft.checksum.slice(0, 12)}… `
        + `bytes=${draft.metadata.report.bytes} analysis=${draft.metadata.analysisIds.length} `
        + `finding=${draft.metadata.findingIds.length} conclusion=${draft.metadata.conclusionId ?? "—"}`,
      );
    } else {
      const result = await generateResearchReport(deps, target.runId);
      summary.push({
        runId: target.runId,
        experimentId: target.experimentId,
        outcome: result.outcome,
        artifactId: result.artifact.id ?? null,
        checksum: result.checksum,
        bodyBytes: result.bodyBytes,
        supersededArtifactIds: result.supersededArtifactIds,
        warnings: result.warnings,
      });
      console.log(
        `  [${result.outcome}] run=${target.runId} artifact=#${result.artifact.id ?? "?"} `
        + `checksum=${result.checksum.slice(0, 12)}… bytes=${result.bodyBytes}`
        + (result.supersededArtifactIds.length > 0
          ? ` superseded=${result.supersededArtifactIds.map((id) => `#${id}`).join(",")}`
          : ""),
      );
    }
    ok += 1;
  } catch (e) {
    failed += 1;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`  [FAILED] run=${target.runId}：${message}`);
    summary.push({ runId: target.runId, experimentId: target.experimentId, outcome: "FAILED", error: message });
  }
}

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), dryRun, ok, failed, summary }, null, 2));
process.exit(failed > 0 ? 1 : 0);
