/**
 * 只读探针：STEP B 落点③ —— 闭环 `optimization` 阶段的**真实行为取证**。
 *
 * 验五件事（都是「不跑就不知道」的）：
 *   1. `optimization` 阶段能否在**真实策略文档 + 真实数据集**上跑通（6 阶段链，走真实闭环）；
 *   2. 搜索空间是否**只由文档 `parameters` 派生**（含被排除参数与原因）；
 *   3. 采样是否真的按注入的 `seed` / `budget` 发生（`evaluatedCandidateCount` / `combinationCount`）；
 *   4. 交接产物 `optimizationRef` 是否通过 `guards` 的四键 + 取值闭集校验（EXECUTED 即证明）；
 *   5. 负例：**声明了参数但没有一个可搜索**的文档 ⇒ `optimization` 必须**响亮抛错**
 *      `CL_OPTIMIZATION_PARAMETER_SPACE_EMPTY`，且**不产出**半截产物。
 *
 * 本探针只读库（select）+ 只调纯装配 / 闭环路径，**不写任何表**。
 * 用法：./node_modules/.bin/tsx docs/evidence/_probe_step_b_optimization_stage.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { assembleRunWorkbenchInputs } from "../../server/runWorkbenchAssembly/assemble";
import { createClosedLoopWiring } from "../../server/research/closedLoopWiring/executors";
import { runClosedLoop } from "../../server/research/closedLoop/orchestrator";
import type {
  ClosedLoopEvaluationRef,
  ClosedLoopOptimizationRef,
  ClosedLoopRunMetadata,
  ClosedLoopRun,
  ClosedLoopStageId,
} from "../../server/research/closedLoop/types";
import {
  deriveExperimentId,
  STRATEGY_EVALUATION_STAGE_IDS,
} from "../../server/research/strategyEvaluation";
import { deriveParameterSpaceFromDocument } from "../../server/research/strategyEvaluation/parameterSpaceFromDocument";
import type { ResearchDataset } from "../../server/researchDataset/types";
import type { ResearchParameterSet } from "../../server/research/types";
import type { StrategyDocument } from "../../server/research/strategySchema/types";

const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };
const CODE_VERSION = "probe";
const CREATED_AT = "2026-09-17T00:00:00.000Z";

/** 6 阶段链 = 评估端口的 5 阶段 + optimization（复用既有常量，不另立阶段表）。 */
const STAGE_IDS: readonly ClosedLoopStageId[] = [...STRATEGY_EVALUATION_STAGE_IDS, "optimization"];
out["stageIds"] = [...STAGE_IDS];

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }, null, 2));
  process.exit(1);
}

function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function summarizeDerivation(doc: StrategyDocument): Record<string, unknown> {
  const derived = deriveParameterSpaceFromDocument(doc);
  return {
    spaceParameterCount: derived.space.parameters.length,
    spaceParameters: derived.space.parameters,
    excluded: derived.excluded,
    declaredParameterNames: derived.declaredParameterNames,
  };
}

// ---------------------------------------------------------------------------
// 标的：能搜索的文档（主用例） + 声明了参数但均不可搜索的文档（负例）
// ---------------------------------------------------------------------------
const rows = await db.execute(
  sql`select id, strategyId, version, strategyDocumentJson from strategy_versions order by id`,
);
const list = (rows as unknown as [Array<Record<string, unknown>>])[0] ?? [];

let searchable: { id: number; doc: StrategyDocument } | null = null;
let unsearchable: { id: number; doc: StrategyDocument } | null = null;
for (const r of list) {
  let doc: StrategyDocument;
  try {
    doc = JSON.parse(String(r["strategyDocumentJson"])) as StrategyDocument;
  } catch {
    continue;
  }
  const derived = deriveParameterSpaceFromDocument(doc);
  if (searchable === null && derived.space.parameters.length > 0) {
    searchable = { id: Number(r["id"]), doc };
    continue;
  }
  // 负例标的：**声明了参数**但一个都不可搜索 —— 比「一个参数都没有」更能证明「不替你猜界」
  if (unsearchable === null && derived.declaredParameterNames.length > 0 && derived.space.parameters.length === 0) {
    unsearchable = { id: Number(r["id"]), doc };
  }
}

if (searchable === null) {
  console.log(JSON.stringify({ ...out, error: "库里没有「可派生搜索空间」的策略文档，无法取证" }, null, 2));
  process.exit(1);
}
const searchableTarget = searchable;
out["searchableDocument"] = {
  id: searchableTarget.id,
  strategyId: searchableTarget.doc.strategyId,
  version: searchableTarget.doc.version,
  derivation: summarizeDerivation(searchableTarget.doc),
};
out["unsearchableDocument"] = unsearchable === null
  ? null
  : {
      id: unsearchable.id,
      strategyId: unsearchable.doc.strategyId,
      version: unsearchable.doc.version,
      derivation: summarizeDerivation(unsearchable.doc),
    };

// ---------------------------------------------------------------------------
// 数据集：必须用已落库 READY（重建的小数据集 gate=INCONCLUSIVE，会被门禁正确拦住）
// ---------------------------------------------------------------------------
const dvRows = await db.execute(
  sql`select id, version, startDate, endDate from dataset_version
      where status = 'READY' order by id desc limit 3`,
);
const dvList = (dvRows as unknown as [Array<Record<string, unknown>>])[0] ?? [];
const chosen = dvList[0];
if (chosen === undefined) {
  console.log(JSON.stringify({ ...out, error: "库里没有 status=READY 的数据集，无法取证" }, null, 2));
  process.exit(1);
}
const chosenDatasetVersionId = Number(chosen["id"]);
const dsEnd = String(chosen["endDate"]);
const dateRange = { startDate: shiftDays(dsEnd, -10), endDate: dsEnd };
out["probeWindow"] = { ...dateRange, fromDatasetVersionId: chosenDatasetVersionId, datasetEnd: dsEnd };

// ---------------------------------------------------------------------------
// 通用：装配 → 6 阶段链 → runClosedLoop
// ---------------------------------------------------------------------------
interface ChainOutcome {
  readonly datasetVersion: string;
  readonly datasetSource: string;
  readonly registeredStages: readonly string[];
  readonly run: ClosedLoopRun | null;
  readonly thrown: { readonly message: string } | null;
}

async function runSixStageChain(
  doc: StrategyDocument,
  injectedDataset: ResearchDataset | undefined,
): Promise<ChainOutcome> {
  const assembled = await assembleRunWorkbenchInputs({
    strategyId: doc.strategyId,
    strategyVersion: doc.version,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    createdAt: CREATED_AT,
    codeVersion: CODE_VERSION,
    strategyDocument: doc,
    ...(injectedDataset !== undefined
      ? { researchDataset: injectedDataset }
      : { datasetVersionId: chosenDatasetVersionId, dataReady: true }),
  });

  const resolvedParameters = (assembled.inputs.experimentConfig?.parameters ?? {}) as ResearchParameterSet;
  const metadata: ClosedLoopRunMetadata = {
    // 🔴 用**唯一实现**派生（禁自编）：§28 要求实验身份形如 EXP-YYYYMMDD-XXXXXXXX，
    //    编排器会当场拒绝不合规的 id（首次探针就因此被拒 —— 这是正确行为）。
    experimentId: deriveExperimentId(doc, resolvedParameters, CREATED_AT),
    strategyId: doc.strategyId,
    strategyVersion: doc.version,
    dateRange: { ...dateRange },
    datasetVersion: assembled.dataset.datasetVersion,
    universeVersion: null,
    codeVersion: CODE_VERSION,
    costModel: assembled.assembly.simulation.costModel,
    executionModel: assembled.assembly.simulation.executionModel,
    parameterSet: resolvedParameters,
  };

  const { stageRunners } = createClosedLoopWiring(assembled.inputs, { requested: STAGE_IDS });
  const registeredStages = Object.keys(stageRunners);

  try {
    const run = runClosedLoop({
      runId: `PROBE-OPT::${doc.strategyId}`,
      createdAt: CREATED_AT,
      metadata,
      stageIds: STAGE_IDS,
      stageRunners,
    });
    return {
      datasetVersion: assembled.dataset.datasetVersion,
      datasetSource: assembled.assembly.datasetSource,
      registeredStages,
      run,
      thrown: null,
    };
  } catch (error) {
    return {
      datasetVersion: assembled.dataset.datasetVersion,
      datasetSource: assembled.assembly.datasetSource,
      registeredStages,
      run: null,
      thrown: { message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
    };
  }
}

// ---------------------------------------------------------------------------
// 主用例
// ---------------------------------------------------------------------------
{
  const started = Date.now();
  const outcome = await runSixStageChain(searchableTarget.doc, undefined);
  const elapsedMs = Date.now() - started;
  if (outcome.run === null) {
    out["mainCase"] = { ok: false, elapsedMs, thrown: outcome.thrown };
  } else {
    const stages = outcome.run.stages.map(stage => ({
      stageId: stage.stageId,
      state: stage.state,
      reasonCode: stage.blocked?.reasonCode ?? null,
    }));
    const optimizationStage = outcome.run.stages.find(stage => stage.stageId === "optimization");
    const ref = (optimizationStage?.output ?? null) as ClosedLoopOptimizationRef | null;
    const evaluationRef = (outcome.run.stages.find(s => s.stageId === "evaluation")?.output ?? null) as
      | ClosedLoopEvaluationRef
      | null;
    out["mainCase"] = {
      ok: true,
      elapsedMs,
      datasetVersion: outcome.datasetVersion,
      datasetSource: outcome.datasetSource,
      registeredStages: outcome.registeredStages,
      stages,
      executedStageCount: stages.filter(s => s.state === "EXECUTED").length,
      optimizationStageState: optimizationStage?.state ?? null,
      optimizationRef: ref === null
        ? null
        : {
            kind: ref.kind,
            handoffVersion: ref.handoffVersion,
            synthetic: ref.synthetic,
            source: ref.source,
            method: ref.method,
            candidateParameterKeys: ref.candidateParameterKeys,
            evaluatedCandidateCount: ref.evaluatedCandidateCount,
            consistency: ref.consistency,
          },
      /** 被 evaluate 的候选数是否等于注入预算（12）。 */
      evaluatedCountMatchesBudget: ref?.evaluatedCandidateCount === 12,
      /** consistency.note 是否如实交代了搜索边界（含「未进搜索空间」段）。 */
      noteMentionsSearchScope: ref === null ? null : ref.consistency.note.includes("搜索键"),
      evaluationBaselineTotalReturnPct: evaluationRef?.performance?.totalReturnPct ?? null,
    };
  }
}

// ---------------------------------------------------------------------------
// 负例：声明了参数但一个都不可搜索 ⇒ 必须响亮抛错
// ---------------------------------------------------------------------------
{
  if (unsearchable === null) {
    out["negativeCase"] = { skipped: "库里没有「声明了参数但均不可搜索」的文档" };
  } else {
    const outcome = await runSixStageChain(unsearchable.doc, undefined);
    out["negativeCase"] = {
      strategyId: unsearchable.doc.strategyId,
      registeredStages: outcome.registeredStages,
      runThrew: outcome.thrown !== null,
      errorCodeMatched: outcome.thrown !== null
        && outcome.thrown.message.includes("CL_OPTIMIZATION_PARAMETER_SPACE_EMPTY"),
      /** 抛错时是否**没有**产出 run（禁半截产物）。 */
      producedNoRun: outcome.run === null,
      throwMessageHead: outcome.thrown === null ? null : outcome.thrown.message.slice(0, 1000),
    };
  }
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);
