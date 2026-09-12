/**
 * 闭环装配层 — 真实阶段执行器（装配 `data / research / strategy / backtest / evaluation`）。
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
import { CLOSED_LOOP_STAGE_IDS, closedLoopStageIndex, type ClosedLoopStageId } from "../closedLoop/types";
import type {
  ClosedLoopDatasetSummary,
  ClosedLoopHandoff,
  ClosedLoopResearchSummary,
  ClosedLoopStageExecutor,
  ClosedLoopStageRunnerMap,
  ClosedLoopStrategyDocRef,
} from "../closedLoop/types";
import { RESEARCH_DATASET_BUILDER_VERSION, RESEARCH_DATASET_ROW_SCHEMA_VERSION } from "../../researchDataset/types";
import { evaluatePerformance } from "../performanceMetrics/evaluate";
import { evaluateRiskAdjustedMetrics } from "../riskAdjustedMetrics/evaluate";
import { evaluateTradeQualityMetrics } from "../tradeQualityMetrics/evaluate";
import { runCandidateEngine } from "../signalEngine/engine";
import { computeCandidateEvaluationRunFingerprint } from "../signalEngine/serialize";
import { runTradeSimulation } from "../simulator/engine";
import { createStrategyDocument, createStrategyVersionRecord } from "../strategySchema/map";
import { computeStrategyVersionRecordFingerprint } from "../strategySchema/serialize";
import { closedLoopStageWiringRequirement } from "./requirements";
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
      (runners as Record<string, unknown>)[stageId] = executor;
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
        const run = runTradeSimulation({ dataset, sourceRun, simConfig });
        artifacts.tradeSimulationRun = run;
        // 复用既有适配器做投影（不重写摘要口径）
        return summarizeTradeSimulationRun(run) as ClosedLoopHandoff;
      }) as ClosedLoopStageExecutor<ClosedLoopStageId>;
    }
    case "evaluation": {
      return (() => {
        const backtestRun = artifacts.tradeSimulationRun;
        let backtestFingerprint: string;
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

        // 三个评估器都真实调用；可选参数仅在调用方给出时才传（不替模块决定缺省口径）
        const performance = evaluatePerformance({
          equityCurve,
          ...(trades !== undefined ? { trades } : {}),
          ...(annualizationFactor !== undefined ? { annualizationFactor } : {}),
          ...(drawdownThresholdPct !== undefined ? { drawdownThresholdPct } : {}),
          ...(downsideTarget !== undefined ? { downsideTarget } : {}),
        });
        const riskAdjusted = evaluateRiskAdjustedMetrics({
          equityCurve,
          ...(trades !== undefined ? { trades } : {}),
          ...(annualizationFactor !== undefined ? { annualizationFactor } : {}),
          ...(rfAnnualPct !== undefined ? { rfAnnualPct } : {}),
          ...(downsideTarget !== undefined ? { downsideTarget } : {}),
        });
        const tradeQuality = evaluateTradeQualityMetrics({
          equityCurve,
          ...(trades !== undefined ? { trades } : {}),
          ...(annualizationFactor !== undefined ? { annualizationFactor } : {}),
        });

        // 复用既有适配器组装（含 backtestFingerprint 绑定 + 三节标量投影）
        return composeClosedLoopEvaluationRef({
          backtestFingerprint,
          performance,
          riskAdjusted,
          tradeQuality,
        }) as ClosedLoopHandoff;
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
