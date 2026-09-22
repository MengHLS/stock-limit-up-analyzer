/**
 * 闭环装配层 — 真实阶段执行器（装配 `data / research / strategy / backtest / evaluation / optimization`）。
 *
 * 纪律（与 §17「不造假」一致）：
 *   - 每个执行器**只调用真实模块**（`runCandidateEngine` / `createStrategyDocument` /
 *     `runTradeSimulation` / `evaluate*`），不构造任何模拟产物；
 *   - 交接摘要（handoff）的每个字段都从真实产物**投影**而来，能复用既有适配器的就复用
 *     （`summarizeTradeSimulationRun` / `composeClosedLoopEvaluationRef`），本层不重写口径；
 *   - 缺前置产物 → 抛 `ClosedLoopWiringError`（**响亮失败**），绝不返回占位摘要 ——
 *     因为「悄悄产出一个空摘要」比抛错危险得多。
 *
 * 注册策略：**只为「真的能跑」的阶段注册执行器**。未满足入参的阶段不注册 → 编排器如实发出
 * `CL_RUNNER_NOT_INJECTED`。这样 `stageRunners` 表本身就是一句实话。
 */

import type { Trade } from "../../backtest/types";
import type { EquityPoint } from "../../backtest/types";
import {
  composeClosedLoopEvaluationRef,
  summarizeTradeSimulationRun,
} from "../closedLoop/adapters";
// BACKTEST-002（B-04）— canonical Metrics 唯一实现 + 年化基数唯一常量。
import { BACKTEST_ANNUALIZATION_DAYS, canonicalMetrics } from "../../backtest/backtestResult";
import { CLOSED_LOOP_STAGE_IDS, closedLoopStageIndex, type ClosedLoopStageId } from "../closedLoop/types";
import type {
  ClosedLoopDatasetSummary,
  ClosedLoopHandoff,
  ClosedLoopResearchSummary,
  ClosedLoopStageExecutor,
  ClosedLoopStageRunnerMap,
  ClosedLoopStrategyDocRef,
} from "../closedLoop/types";import { RESEARCH_DATASET_BUILDER_VERSION, RESEARCH_DATASET_ROW_SCHEMA_VERSION } from "../../researchDataset/types";
import { evaluatePerformance } from "../performanceMetrics/evaluate";
import { evaluateRiskAdjustedMetrics } from "../riskAdjustedMetrics/evaluate";
import { evaluateTradeQualityMetrics } from "../tradeQualityMetrics/evaluate";
import { runCandidateEngine } from "../signalEngine/engine";
import { computeCandidateEvaluationRunFingerprint } from "../signalEngine/serialize";
import { runTradeSimulation } from "../simulator/engine";
import type { SecurityBoard } from "../simulator/types";
import { buildRegimeDayFactsFromDatasetRows } from "../marketRegime/facts";
import { runMarketRegimeAnalysis } from "../marketRegime/run";
import type { RegimeDayFacts } from "../marketRegime/types";
import type { ClosedLoopOptimizationRef, ClosedLoopRegimeRef } from "../closedLoop/types";
import { runParameterSearch } from "../parameterSearch/run";
import type { CandidateRegionVerdict } from "../parameterSearch/types";
import {
  createStrategyParameterEvaluator,
  type StrategyParameterEvaluatorInput,
} from "../strategyEvaluation/evaluator";
import {
  deriveParameterSpaceFromDocument,
  type ParameterSpaceDerivation,
} from "../strategyEvaluation/parameterSpaceFromDocument";
import { createStrategyDocument, createStrategyVersionRecord } from "../strategySchema/map";
import { computeStrategyVersionRecordFingerprint } from "../strategySchema/serialize";
import { closedLoopStageWiringRequirement } from "./requirements";
// PARAMETER-001-PRE — 性能剖析（默认关闭；`PARAM_PROFILE=1` 才生效）。
import { perfRun } from "../../observability";
import {
  CLOSED_LOOP_ARTIFACT_PRODUCER,
  createClosedLoopWiringArtifacts,
  type ClosedLoopInputSource,
  type ClosedLoopWiringArtifacts,
  type ClosedLoopWiringArtifactKey,
  type ClosedLoopWiringInputs,
} from "./types";

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/** 装配层错误（缺前置产物 / 入参在运行期消失等；消息必须能直接定位到「先跑哪个阶段」）。 */
export class ClosedLoopWiringError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ClosedLoopWiringError";
    this.code = code;
  }
}

function requireArtifact<K extends ClosedLoopWiringArtifactKey>(
  artifacts: ClosedLoopWiringArtifacts,
  key: K,
  consumer: ClosedLoopStageId,
): NonNullable<ClosedLoopWiringArtifacts[K]> {
  const value = artifacts[key];
  if (value === undefined || value === null) {
    throw new ClosedLoopWiringError(
      "CL_WIRING_ARTIFACT_MISSING",
      `装配层：阶段 ${consumer} 需要上游产物 \`${key}\`，但本次运行的产物旁路里没有它。` +
        `请先把产生阶段 ${CLOSED_LOOP_ARTIFACT_PRODUCER[key]} 纳入本次阶段链（且位于 ${consumer} 之前）。`,
    );
  }
  return value as NonNullable<ClosedLoopWiringArtifacts[K]>;
}

// ---------------------------------------------------------------------------
// 交接摘要投影（全部来自真实产物）
// ---------------------------------------------------------------------------

/** data 阶段：把真实 ResearchDataset 投影为 datasetSummary（不构建、不臆造）。 */
export function projectDatasetSummary(dataset: {
  datasetVersion: string;
  gate: string;
  gateNotes: readonly string[];
  rows: readonly { securityId: string; tradeDate: string }[];
  dataSnapshot: { request: { startDate: string; endDate: string } };
}): ClosedLoopDatasetSummary {
  const distinctSecurities = new Set(dataset.rows.map((r) => r.securityId));
  return {
    kind: "datasetSummary",
    handoffVersion: 1,
    // 注入方声明的数据集即视为真实产物；是否可信由 dataset.gate 与 datasetVersion 表达，
    // 本层不替调用方宣称「合成/真实」，因此恒 false（与 dataProvider 约定一致）。
    synthetic: false,
    source: {
      module: "researchDataset",
      moduleRunKind: "RESEARCH_DATASET",
      runId: null,
      fingerprint: dataset.datasetVersion,
    },
    datasetVersion: dataset.datasetVersion,
    gate: dataset.gate as ClosedLoopDatasetSummary["gate"],
    dateRange: {
      startDate: dataset.dataSnapshot.request.startDate,
      endDate: dataset.dataSnapshot.request.endDate,
    },
    builderVersion: RESEARCH_DATASET_BUILDER_VERSION,
    rowSchemaVersion: RESEARCH_DATASET_ROW_SCHEMA_VERSION,
    rowCount: dataset.rows.length,
    universeCount: distinctSecurities.size,
    coverageGaps: dataset.gateNotes,
  };
}

/** 装配层内部：把 data 阶段真正用到的字段类型收窄（保持 projectDatasetSummary 可单测）。 */
function requireDataset(artifacts: ClosedLoopWiringArtifacts, inputs: ClosedLoopWiringInputs) {
  const dataset = artifacts.dataset ?? inputs.researchDataset;
  if (dataset === undefined) {
    throw new ClosedLoopWiringError(
      "CL_WIRING_ARTIFACT_MISSING",
      "装配层：data 阶段需要真实 ResearchDataset（inputs.researchDataset），但未提供。",
    );
  }
  return dataset;
}

// ---------------------------------------------------------------------------
// regime 阶段：日级事实装配 + regimeRef 投影
// ---------------------------------------------------------------------------

/**
 * 由 ResearchDataset 行构建 **日级事实序列**（regime 七维计算的唯一输入单元）。
 *
 * 纪律：
 *   - 按 tradeDate 切片（数据集行已按 (tradeDate, securityId) 升序），**逐日只喂当日行**
 *     —— `buildRegimeDayFactsFromDatasetRows` 内部会对每行做 `assertRowPitInvariant`
 *     （asOf ≠ tradeDate 立即抛错），混日期喂进去会被 FAIL FAST 拒绝；
 *   - 输出按 tradeDate **严格升序且无重复**（`runMarketRegimeAnalysis` 的
 *     `assertRegimeSeriesOrdered` 前置条件）；
 *   - `sentiment` 不注入 ⇒ 情绪维恒为 unassessed（SENTIMENT_SOURCE_MISSING）——如实留空，
 *     绝不启用涨跌停家数代理（代理口径需显式 opt-in，见 facts.ts 的
 *     `REGIME_SENTIMENT_DEFAULT_ALLOW_LIMIT_UP_PROXY` 与 `deriveRegimeSentimentFromLimitUp`）。
 */
export function buildRegimeDayFactsSeries(dataset: {
  rows: readonly import("../../researchDataset/types").ResearchDatasetRow[];
}): readonly RegimeDayFacts[] {
  const rowsByDate = new Map<string, import("../../researchDataset/types").ResearchDatasetRow[]>();
  for (const row of dataset.rows) {
    const bucket = rowsByDate.get(row.tradeDate);
    if (bucket === undefined) {
      rowsByDate.set(row.tradeDate, [row]);
    } else {
      bucket.push(row);
    }
  }
  const dates = [...rowsByDate.keys()].sort();
  return dates.map(tradeDate =>
    buildRegimeDayFactsFromDatasetRows({ tradeDate, rows: rowsByDate.get(tradeDate)! }),
  );
}

/**
 * regime 阶段交接投影：把真实 `MarketRegimeRun` 投影为 `regimeRef`。
 *
 * 覆盖 `guards.ts` 要求的两个必备键（`coverage` / `compositeSummary`）：
 *   - `coverage.assessedDayCount` = 有复合状态的交易日数（tags 中 composite ≠ null）；
 *     `unassessedDayCount` = 其余（含 enableComposite=false 的全部）。
 *   - `compositeSummary` = 按 `compositeKey` **聚合** tags，键升序（确定性）。
 *     复合状态整体缺失的交易日无法归入任何 key ⇒ 只计入 unassessedDayCount，不伪造 key。
 */
export function projectRegimeRef(run: {
  regimeRunId: string;
  datasetVersion: string | null;
  fingerprint: string;
  tags: readonly { composite: { compositeKey: string } | null }[];
}): ClosedLoopRegimeRef {
  const keyCounts = new Map<string, number>();
  let assessedDayCount = 0;
  for (const tag of run.tags) {
    if (tag.composite === null) continue;
    assessedDayCount += 1;
    const key = tag.composite.compositeKey;
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  return {
    kind: "regimeRef",
    handoffVersion: 1,
    synthetic: false,
    source: {
      module: "marketRegime",
      moduleRunKind: "MARKET_REGIME_RUN",
      runId: run.regimeRunId,
      fingerprint: run.fingerprint,
    },
    coverage: {
      assessedDayCount,
      unassessedDayCount: run.tags.length - assessedDayCount,
    },
    compositeSummary: [...keyCounts.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([compositeKey, dayCount]) => ({ compositeKey, dayCount })),
  };
}

// ---------------------------------------------------------------------------
// optimization 阶段：搜索空间派生 + optimizationRef 投影
// ---------------------------------------------------------------------------

/**
 * 闭环 optimization 阶段的**固定采样预算与种子**。
 *
 * 🔴 为什么默认 `random` 而非 `grid`：闭环执行器是**同步**的，每次评估都是一次完整
 * `research → backtest → evaluation` 回测。真实文档（`cand-3600xx`）三参数的全网格是
 * **1240 组**（31 × 20 × 2；实查见 `docs/evidence/_probe_optimization_parameter_space.out.json`），
 * 按每次回测数秒计就是**小时级同步阻塞** —— 那会拖垮整个 Node 事件循环（tRPC 全挂）。
 * ⇒ 闭环内用**固定种子的 random 采样**：确定性可复现、预算可控。
 * 需要全网格时由调用方离线另跑，**不在同步阶段里做**。
 */
const CLOSED_LOOP_OPTIMIZATION_SEED = 17;
const CLOSED_LOOP_OPTIMIZATION_BUDGET = 12;
/** 闭环内不读 package.json / git（与 `assemble.ts:76` 的既有口径一致）。 */
const CLOSED_LOOP_OPTIMIZATION_CODE_VERSION = "unknown";

/**
 * optimization 阶段交接投影：把真实 `ParameterSearchRun` 投影为 `optimizationRef`。
 *
 * 覆盖 `guards.ts:117` 要求的四个必备键（存在性校验；`method` 与 `consistency.status`
 * 另有取值闭集校验）。
 *
 * 🔴 `consistency.note` 是**如实交代本次搜索边界**的唯一位置，因此它必须写清：
 * 评估了多少组 / 全网格多大 / 稳定区 verdict / 产出几个候选，以及
 * **哪些文档声明的参数没有进搜索空间**（逐条原因）。少了最后一句，调用方就无从知道
 * 优化**没覆盖**哪些维度 —— 那正是 P0-2 的病（未收录维度被静默忽略）。
 */
export function projectOptimizationRef(
  run: {
    searchRunId: string;
    fingerprint: string;
    method: "grid" | "random" | "rolling";
    combinationCount: number;
    sampleCount: number;
    region: {
      verdict: CandidateRegionVerdict;
      qualifiedCount: number;
      badPointRatePct: number | null;
    };
    candidates: readonly { readonly parameterSet: Record<string, unknown> }[];
  },
  derivation: ParameterSpaceDerivation,
): ClosedLoopOptimizationRef {
  const searchedKeys = derivation.space.parameters.map(parameter => parameter.name);
  // 候选策略**实际调动**的参数键（无候选 ⇒ 空数组；不用「搜了什么」冒充「候选是什么」）
  const candidateParameterKeys = [
    ...new Set(run.candidates.flatMap(candidate => Object.keys(candidate.parameterSet))),
  ].sort();

  let status: ClosedLoopOptimizationRef["consistency"]["status"];
  if (run.region.verdict === "stable" && run.candidates.length > 0) {
    status = "candidate";
  } else if (run.region.verdict === "degraded-bad-point-rate") {
    status = "degraded";
  } else {
    status = "noStableRegion";
  }

  const budgetNote =
    run.method === "random"
      ? `random 采样 ${run.sampleCount} / 全网格 ${run.combinationCount} 组（固定种子，确定性）`
      : `共评估 ${run.sampleCount} 组`;
  const excludedNote =
    derivation.excluded.length === 0
      ? "全部声明参数均进搜索空间"
      : `未进搜索空间的参数：${derivation.excluded
          .map(item => `${item.name}（${item.reason}）`)
          .join("；")}`;
  const badPointNote =
    run.region.badPointRatePct === null ? "不适用" : `${run.region.badPointRatePct}%`;
  const note =
    `${budgetNote}；稳定区 verdict=${run.region.verdict}、合格 ${run.region.qualifiedCount} 组、`
    + `坏点率 ${badPointNote}、产出候选 ${run.candidates.length} 个`
    + `（搜索键：${searchedKeys.join(" / ") || "无"}）；${excludedNote}`;

  return {
    kind: "optimizationRef",
    handoffVersion: 1,
    synthetic: false,
    source: {
      module: "parameterSearch",
      moduleRunKind: "PARAMETER_SEARCH_RUN",
      runId: run.searchRunId,
      fingerprint: run.fingerprint,
    },
    method: run.method,
    candidateParameterKeys,
    evaluatedCandidateCount: run.sampleCount,
    consistency: { status, note },
  };
}

// ---------------------------------------------------------------------------
// 执行器注册
// ---------------------------------------------------------------------------

/** 构造执行器时的选项。 */
export interface CreateClosedLoopStageRunnersOptions {
  /**
   * 本次请求的阶段集（缺省 = 全 14 阶段）。
   *
   * 只影响「`artifact` 类来源是否算成立」：上游产物必须由**链内且位于之前**的阶段产生。
   * 调用方若把上游产物预先放进 `artifacts`，也可以不传该选项。
   */
  readonly requested?: readonly ClosedLoopStageId[];
}

/** 某来源在**注册期**是否成立（来源内 inputs 与 artifacts 同时要满足）。 */
function registrationSourceSatisfied(
  source: ClosedLoopInputSource,
  inputs: ClosedLoopWiringInputs,
  artifacts: ClosedLoopWiringArtifacts,
  registered: ReadonlySet<ClosedLoopStageId>,
  consumerIndex: number,
): boolean {
  const inputsOk = (source.inputs ?? []).every((key) => {
    const value = inputs[key];
    return value !== undefined && value !== null;
  });
  if (!inputsOk) return false;
  return (source.artifacts ?? []).every((key) => {
    if (artifacts[key] !== undefined && artifacts[key] !== null) return true; // 调用方预置
    const producer = CLOSED_LOOP_ARTIFACT_PRODUCER[key];
    return registered.has(producer) && closedLoopStageIndex(producer) < consumerIndex;
  });
}

/**
 * 创建阶段执行器表。
 *
 * **只为「真的能跑」的阶段注册**：`wired=false` 或入参来源不成立 → 不注册该项，
 * 编排器据此如实发出 `CL_RUNNER_NOT_INJECTED` / `CL_DATA_NOT_INJECTED`。
 *
 * @param inputs    调用方真实入参。
 * @param artifacts 本次运行的产物旁路（缺省新建；同一链必须复用同一份，否则阶段间传不动重对象）。
 */
export function createClosedLoopStageRunners(
  inputs: ClosedLoopWiringInputs,
  artifacts: ClosedLoopWiringArtifacts = createClosedLoopWiringArtifacts(),
  options: CreateClosedLoopStageRunnersOptions = {},
): ClosedLoopStageRunnerMap {
  const requested = options.requested;
  const registered = new Set<ClosedLoopStageId>();
  const runners: ClosedLoopStageRunnerMap = {};

  // 按 canonical 顺序遍历，保证「上游先注册」——产物可得性依赖它
  const order = requested !== undefined ? CLOSED_LOOP_STAGE_IDS.filter((s) => requested.includes(s)) : CLOSED_LOOP_STAGE_IDS;

  for (const stageId of order) {
    const requirement = closedLoopStageWiringRequirement(stageId);
    if (!requirement.wired) continue;
    const index = closedLoopStageIndex(stageId);
    const satisfied = requirement.satisfyVia.some((source) =>
      registrationSourceSatisfied(source, inputs, artifacts, registered, index),
    );
    if (!satisfied) continue;

    const executor = buildExecutor(stageId, artifacts, inputs);
    if (executor !== undefined) {
      // PARAMETER-001-PRE — 每个阶段一个剖析节点（默认关闭 ⇒ 只是一次函数转调）。
      // 嵌套关系天然成立：参数搜索的每个样本会走自己的 research/backtest/evaluation 子链，
      // 因此能在同一棵树里看出「主链一次 + 优化阶段 12 次」的真实倍数。
      (runners as Record<string, unknown>)[stageId] = (ctx: unknown) =>
        perfRun(`stage.${stageId}`, () => (executor as (c: unknown) => unknown)(ctx));
      registered.add(stageId);
    }
  }

  return runners;
}

/** 逐阶段构造执行器（每支只做一件事：调真实模块 + 投影交接 + 写旁路）。 */
function buildExecutor(
  stageId: ClosedLoopStageId,
  artifacts: ClosedLoopWiringArtifacts,
  inputs: ClosedLoopWiringInputs,
): ClosedLoopStageExecutor<ClosedLoopStageId> | undefined {
  switch (stageId) {
    case "data": {
      return (() => {
        const dataset = requireDataset(artifacts, inputs);
        artifacts.dataset = dataset;
        return projectDatasetSummary(dataset) as ClosedLoopHandoff;
      }) as ClosedLoopStageExecutor<ClosedLoopStageId>;
    }
    case "research": {
      return (() => {
        const dataset = requireArtifact(artifacts, "dataset", "research");
        const { experimentConfig, strategyContract, strategy13 } = inputs;
        if (experimentConfig === undefined || strategyContract === undefined || strategy13 === undefined) {
          throw new ClosedLoopWiringError(
            "CL_WIRING_INPUT_MISSING",
            "装配层：research 阶段需要 inputs.experimentConfig / strategyContract / strategy13（三者齐备）。",
          );
        }
        // 真实调用：完整候选引擎（内部逐日驱动 STEP 10 pipeline）
        const run = runCandidateEngine({
          dataset,
          config: experimentConfig,
          strategy: strategyContract,
          strategy13,
        });
        artifacts.candidateRun = run;
        const summary: ClosedLoopResearchSummary = {
          kind: "researchSummary",
          handoffVersion: 1,
          synthetic: false,
          source: {
            module: "signalEngine",
            moduleRunKind: "CANDIDATE_EVALUATION_RUN",
            runId: null,
            fingerprint: run.fingerprint,
          },
          datasetVersion: run.datasetVersion,
          candidateRunFingerprint: run.fingerprint,
          evaluated: {
            // 累计候选名额 = Σ 每日 selected 数（引擎自身的统计口径，不另行求和猜测）
            candidateCount: run.evaluation.totalSelectedSlots,
            decisionDateRange: {
              startDate: run.dateRange.startDate,
              endDate: run.dateRange.endDate,
            },
          },
          notes: [
            `决策日数 = ${run.evaluation.decisionDayCount}；跨日去重入选证券 = ${run.evaluation.distinctSelectedSecurities.length}`,
            `数据集 gate = ${run.datasetGate}（来自 datasetAccess 句柄，非本层判定）`,
          ],
        };
        return summary as ClosedLoopHandoff;
      }) as ClosedLoopStageExecutor<ClosedLoopStageId>;
    }
    case "strategy": {
      return (() => {
        const input = inputs.strategyDocumentInput;
        if (input === undefined) {
          throw new ClosedLoopWiringError(
            "CL_WIRING_INPUT_MISSING",
            "装配层：strategy 阶段需要 inputs.strategyDocumentInput（真实策略本体声明）。",
          );
        }
        const document = createStrategyDocument(input);
        artifacts.strategyDocument = document;
        let versionRecordFingerprint: string | null = null;
        if (inputs.strategyVersionRecordInput !== undefined) {
          // 用真实文档覆盖入参里的 document（版本记录必须绑定刚构造的这一份）
          const record = createStrategyVersionRecord({
            ...inputs.strategyVersionRecordInput,
            document,
          });
          artifacts.strategyVersionRecord = record;
          versionRecordFingerprint = computeStrategyVersionRecordFingerprint(record);
        }
        const ref: ClosedLoopStrategyDocRef = {
          kind: "strategyDocRef",
          handoffVersion: 1,
          synthetic: false,
          source: {
            module: "strategySchema",
            moduleRunKind: "STRATEGY_DOCUMENT",
            runId: null,
            fingerprint: document.fingerprint,
          },
          strategyId: document.strategyId,
          strategyVersion: document.version,
          docFingerprint: document.fingerprint,
          versionRecordFingerprint,
          rules: {
            entryRuleCount: document.entryRules.length,
            exitRuleCount: document.exitRules.length,
            sizingRuleCount: 1, // positionSizing 是单一声明（非规则集），恒 1
            riskRuleCount: document.riskRules.length,
          },
        };
        return ref as ClosedLoopHandoff;
      }) as ClosedLoopStageExecutor<ClosedLoopStageId>;
    }
    case "backtest": {
      return (() => {
        const dataset = requireArtifact(artifacts, "dataset", "backtest");
        const sourceRun = requireArtifact(artifacts, "candidateRun", "backtest");
        const simConfig = inputs.simulationConfig;
        if (simConfig === undefined) {
          throw new ClosedLoopWiringError(
            "CL_WIRING_INPUT_MISSING",
            "装配层：backtest 阶段需要 inputs.simulationConfig（真实交易模拟配置）。",
          );
        }
        const securityBoards: Record<string, SecurityBoard> = {};
        for (const row of dataset.rows) {
          if (securityBoards[row.securityId] !== undefined) continue;
          const code = row.code ?? "";
          securityBoards[row.securityId] = row.exchange === "BJ"
            ? "bse"
            : code.startsWith("688")
              ? "star"
              : code.startsWith("300") || code.startsWith("301")
                ? "gem"
                : "main";
        }
        const run = runTradeSimulation({
          dataset,
          sourceRun,
          simConfig: { ...simConfig, securityBoards },
        });
        artifacts.tradeSimulationRun = run;
        // 复用既有适配器做投影（不重写摘要口径）
        return summarizeTradeSimulationRun(run) as ClosedLoopHandoff;
      }) as ClosedLoopStageExecutor<ClosedLoopStageId>;
    }
    case "evaluation": {
      return (() => {
        const backtestRun = artifacts.tradeSimulationRun;        let backtestFingerprint: string;
        let equityCurve: readonly EquityPoint[];
        let trades: readonly Trade[] | undefined;
        let annualizationFactor: number | undefined;
        let drawdownThresholdPct: number | undefined;
        let downsideTarget: number | undefined;
        let rfAnnualPct: number | undefined;

        if (backtestRun !== undefined) {
          // 首选路径：同链 backtest 的真实产物（指纹与曲线同源，天然绑定）
          backtestFingerprint = backtestRun.fingerprint;
          equityCurve = backtestRun.equityCurve;
          trades = backtestRun.trades;
          ({ annualizationFactor, drawdownThresholdPct, downsideTarget, rfAnnualPct } =
            inputs.evaluationInput ?? {});
        } else {
          // 次选路径：调用方直供（但必须声明曲线来自哪次真实回测）
          const provided = inputs.evaluationInput;
          if (provided === undefined) {
            throw new ClosedLoopWiringError(
              "CL_WIRING_ARTIFACT_MISSING",
              "装配层：evaluation 阶段需要同链 backtest 的真实产物（artifacts.tradeSimulationRun），" +
                "或 inputs.evaluationInput（含 backtestFingerprint + equityCurve）。",
            );
          }
          backtestFingerprint = provided.backtestFingerprint;
          equityCurve = provided.equityCurve;
          trades = provided.trades;
          annualizationFactor = provided.annualizationFactor;
          drawdownThresholdPct = provided.drawdownThresholdPct;
          downsideTarget = provided.downsideTarget;
          rfAnnualPct = provided.rfAnnualPct;
        }

        // ------------------------------------------------------------------
        // BACKTEST-002（B-04）— 年化基数唯一化
        //
        // 🔴 规格 §2A 禁止「Backtest = 252 / Evaluation = 244」这类混合口径。
        //    唯一权威常量在 `backtest/backtestResult.ts`。调用方若显式给出**不同**基数，
        //    这里**响亮抛错**而不是静默改用（静默会让「同一批结果的年化」出现两种含义）。
        // ------------------------------------------------------------------
        if (annualizationFactor !== undefined && annualizationFactor !== BACKTEST_ANNUALIZATION_DAYS) {
          throw new ClosedLoopWiringError(
            "CL_WIRING_ANNUALIZATION_BASIS_MISMATCH",
            "装配层：evaluation 的年化基数必须与 canonical Metrics 一致（" +
              String(BACKTEST_ANNUALIZATION_DAYS) +
              " 交易日/年），实际传入 " +
              String(annualizationFactor) +
              " —— 拒绝同一批结果出现两套年化口径。",
          );
        }
        const effectiveAnnualizationFactor = BACKTEST_ANNUALIZATION_DAYS;

        // ------------------------------------------------------------------
        // BACKTEST-002（B-04）— canonical Metrics（唯一读数面）
        //
        // 锚点取 `simulationConfig.initialCapital`（同链真实配置）；直供路径无该字段时
        // 回落到 `equityCurve[0].equity` —— 与 `performanceMetrics` 的既有锚点口径一致
        // （该等价性已在 `performanceMetrics/analyze.ts:15-17` 文档化）。
        // ------------------------------------------------------------------
        const canonicalAnchor = inputs.simulationConfig?.initialCapital ?? equityCurve[0]?.equity;
        const canonical =
          canonicalAnchor === undefined
            ? undefined
            : canonicalMetrics({
                equityCurve,
                tradeLedger: trades ?? [],
                initialCapital: canonicalAnchor,
              });

        // 三个评估器都真实调用（保留其**非重叠**指标：Sharpe / Sortino / Calmar / 波动率 / 回撤段等）
        const performance = evaluatePerformance({
          equityCurve,
          ...(trades !== undefined ? { trades } : {}),
          annualizationFactor: effectiveAnnualizationFactor,
          ...(drawdownThresholdPct !== undefined ? { drawdownThresholdPct } : {}),
          ...(downsideTarget !== undefined ? { downsideTarget } : {}),
        });
        const riskAdjusted = evaluateRiskAdjustedMetrics({
          equityCurve,
          ...(trades !== undefined ? { trades } : {}),
          annualizationFactor: effectiveAnnualizationFactor,
          ...(rfAnnualPct !== undefined ? { rfAnnualPct } : {}),
          ...(downsideTarget !== undefined ? { downsideTarget } : {}),
        });
        const tradeQuality = evaluateTradeQualityMetrics({
          equityCurve,
          ...(trades !== undefined ? { trades } : {}),
          annualizationFactor: effectiveAnnualizationFactor,
        });

        // 复用既有适配器组装：重叠标量改由 canonical 供给（B-04）。
        return composeClosedLoopEvaluationRef({
          backtestFingerprint,
          performance,
          riskAdjusted,
          tradeQuality,
          ...(canonical !== undefined ? { canonicalMetrics: canonical } : {}),
        }) as ClosedLoopHandoff;
      }) as ClosedLoopStageExecutor<ClosedLoopStageId>;
    }
    case "optimization": {
      return ((ctx) => {
        const dataset = requireArtifact(artifacts, "dataset", "optimization");
        const document = requireArtifact(artifacts, "strategyDocument", "optimization");

        // 1. 搜索空间**只由文档 `parameters` 派生**（未收录维度如实记入 excluded，禁静默丢弃）
        const derivation = deriveParameterSpaceFromDocument(document);
        if (derivation.space.parameters.length === 0) {
          throw new ClosedLoopWiringError(
            "CL_OPTIMIZATION_PARAMETER_SPACE_EMPTY",
            // 🔴 码必须写进 message：编排器只把 `ClosedLoopError` 的 code 原样保留，
            //    其余异常一律归并成 `CL_STAGE_EXECUTION_ERROR`（orchestrator.ts:523-526）
            //    ⇒ 不带码的话，调用方跨编排器后就**无法**知道「这是参数空间的问题」，
            //    而这正是需要调用方回去改文档参数的错误。
            `[CL_OPTIMIZATION_PARAMETER_SPACE_EMPTY] 装配层：optimization 阶段无可搜索参数 —— `
              + `文档 ${document.strategyId}@${document.version} `
              + `声明了 ${derivation.declaredParameterNames.length} 个参数`
              + `（${derivation.declaredParameterNames.join(" / ") || "无"}），`
              + "但没有一个同时具备 min / max / step。逐条原因："
              + (derivation.excluded
                  .map(item => `${item.name} → ${item.reason}`)
                  .join("；") || "（文档未声明任何参数）")
              + "。",
          );
        }

        // 2. 同步评估器：数据集与策略文档都已由上游阶段持有 ⇒ 直接复用（**不重新构建数据集**）
        const evaluatorInput: StrategyParameterEvaluatorInput = {
          dataset,
          document,
          dateRange: {
            startDate: dataset.dataSnapshot.request.startDate,
            endDate: dataset.dataSnapshot.request.endDate,
          },
          createdAt: ctx.createdAt,
          codeVersion: CLOSED_LOOP_OPTIMIZATION_CODE_VERSION,
          runIdPrefix: `OPT-${ctx.runId}`,
        };

        // 3. 真实调用搜索模块（搜索器本身是纯函数，回测由注入的 evaluator 完成）
        const run = runParameterSearch({
          method: "random",
          strategyId: document.strategyId,
          strategyVersion: document.version,
          parameterSpace: derivation.space,
          evaluator: createStrategyParameterEvaluator(evaluatorInput),
          seed: CLOSED_LOOP_OPTIMIZATION_SEED,
          budget: CLOSED_LOOP_OPTIMIZATION_BUDGET,
          searchRunId: `OPT-${ctx.runId}`,
          createdAt: ctx.createdAt,
        });

        // 4. 投影为 optimizationRef（consistency.note 如实交代搜索边界）
        return projectOptimizationRef(run, derivation) as ClosedLoopHandoff;
      }) as ClosedLoopStageExecutor<ClosedLoopStageId>;
    }
    case "regime": {
      return ((ctx) => {
        const dataset = requireArtifact(artifacts, "dataset", "regime");
        // 1. 日级事实序列（逐日切片；行级 PIT 不变量由 facts.ts 逐行断言）
        const series = buildRegimeDayFactsSeries(dataset);
        // 2. 真实调用 C-22.1 编排（纯函数；regimeRunId / createdAt 由阶段上下文注入，
        //    模块自身禁 Date.now）
        const run = runMarketRegimeAnalysis({
          regimeRunId: `REGIME-${ctx.runId}`,
          series,
          datasetVersion: dataset.datasetVersion,
          createdAt: ctx.createdAt,
        });
        // 3. 投影为 regimeRef（coverage 需要按 compositeKey 聚合 tags，见 projectRegimeRef）
        return projectRegimeRef(run) as ClosedLoopHandoff;
      }) as ClosedLoopStageExecutor<ClosedLoopStageId>;
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// 便利入口
// ---------------------------------------------------------------------------

/**
 * 新建一份「入参 + 产物旁路 + 执行器表」三件套（调用方通常需要这三样一起交给 `runClosedLoop`）。
 *
 * ⚠️ 三件套必须成对使用：`artifacts` 是阶段间传重对象的通道，跨运行复用会导致
 * 「读到上一次运行的产物」这种最危险的静默错误，因此这里强制一次创建、一次使用。
 */
export function createClosedLoopWiring(
  inputs: ClosedLoopWiringInputs,
  options: CreateClosedLoopStageRunnersOptions = {},
): {
  readonly inputs: ClosedLoopWiringInputs;
  readonly artifacts: ClosedLoopWiringArtifacts;
  readonly stageRunners: ClosedLoopStageRunnerMap;
} {
  const artifacts = createClosedLoopWiringArtifacts();
  const stageRunners = createClosedLoopStageRunners(inputs, artifacts, options);
  return { inputs, artifacts, stageRunners };
}
