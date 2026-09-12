/**
 * 闭环装配层 — 14 阶段装配声明（**唯一权威**）。
 *
 * 每阶段声明四件事：绑定真实模块 / 需要的调用方真实入参 / 需要的同链上游产物 / 已装配的真实入口。
 * 「未装配」也必须写清**确切原因**（`notWiredReason`）——这条表本身就是 D 段的机器可读待办，
 * 而不是一句「暂未实现」。
 *
 * 与 `closedLoop/spec.ts` 的关系：spec 声明**契约**（消费/产出什么 kind、缺 runner 时的
 * reasonCode）；本表声明**装配现状**（真实入参是什么、有没有执行器）。两者职责不重叠。
 */

import { CLOSED_LOOP_STAGE_IDS, type ClosedLoopStageId } from "../closedLoop/types";
import type { ClosedLoopInputSource, ClosedLoopStageWiringRequirement } from "./types";

/** 缺 runner 时的 reasonCode 选择（与 `closedLoop/spec.ts` 的 data 特判保持一致）。 */
export function closedLoopWiringMissingReasonCode(
  stageId: ClosedLoopStageId,
): "CL_DATA_NOT_INJECTED" | "CL_RUNNER_NOT_INJECTED" {
  return stageId === "data" ? "CL_DATA_NOT_INJECTED" : "CL_RUNNER_NOT_INJECTED";
}

/** 一条来源：列出的调用方入参 + 同链上游产物**同时**齐备才算成立。 */
function via(
  inputs: readonly (keyof import("./types").ClosedLoopWiringInputs)[],
  artifacts: readonly import("./types").ClosedLoopWiringArtifactKey[] = [],
): ClosedLoopInputSource {
  return { inputs, artifacts };
}

/** 只依赖上游产物的来源（本阶段无自有入参）。 */
function viaArtifact(
  artifacts: readonly import("./types").ClosedLoopWiringArtifactKey[],
): ClosedLoopInputSource {
  return { artifacts };
}

/** 已装配（真实执行器已就绪）。 */
function wired(
  stageId: ClosedLoopStageId,
  module: string,
  satisfyVia: readonly ClosedLoopInputSource[],
  entryPoints: readonly string[],
): ClosedLoopStageWiringRequirement {
  return { stageId, module, satisfyVia, entryPoints, wired: true, notWiredReason: null };
}

/**
 * 未装配。`reason` 必须回答两个问题：**缺什么**、**为什么现在不装配**。
 * 未装配的阶段不会注册执行器 → 编排器如实发出 `CL_RUNNER_NOT_INJECTED`（不伪造交接）。
 */
function notWired(
  stageId: ClosedLoopStageId,
  module: string,
  reason: string,
  entryPoints: readonly string[] = [],
): ClosedLoopStageWiringRequirement {
  return { stageId, module, satisfyVia: [], entryPoints, wired: false, notWiredReason: reason };
}

/**
 * 14 阶段装配声明。
 *
 * ⚠️ 顺序必须与 `CLOSED_LOOP_STAGE_IDS` 逐项一致（有断言测试守住）。
 */
export const CLOSED_LOOP_STAGE_WIRING_REQUIREMENTS: readonly ClosedLoopStageWiringRequirement[] = [
  wired(
    "data",
    "researchDataset",
    [via(["researchDataset"])],
    [
      "本层不调用任何构建器：直接采用调用方注入的真实 ResearchDataset（避免与 Dataset 侧隐式耦合）。",
      "投影字段：datasetVersion / gate / dataSnapshot.request.{startDate,endDate} / rows.length / universeDefinition.members.length / gateNotes。",
      "builderVersion / rowSchemaVersion 用 researchDataset 的权威常量（不另立数字）。",
    ],
  ),
  wired(
    "research",
    "signalEngine",
    [via(["experimentConfig", "strategyContract", "strategy13"], ["dataset"])],
    [
      "server/research/signalEngine/engine.ts:124  runCandidateEngine(input: CandidateEngineInput): CandidateEvaluationRun",
      "server/research/signalEngine/serialize.ts:41  computeCandidateEvaluationRunFingerprint(record)",
    ],
  ),
  wired(
    "strategy",
    "strategySchema",
    [via(["strategyDocumentInput"])],
    [
      "server/research/strategySchema/map.ts:88   createStrategyDocument(input: StrategyDocumentInput): StrategyDocument",
      "server/research/strategySchema/map.ts:217  createStrategyVersionRecord(input)（可选：提供后才产出 versionRecordFingerprint）",
    ],
  ),
  wired(
    "backtest",
    "simulator",
    [via(["simulationConfig"], ["dataset", "candidateRun"])],
    [
      "server/research/simulator/engine.ts:248     runTradeSimulation(input: TradeSimulationInput): TradeSimulationRun",
      "server/research/closedLoop/adapters.ts:45   summarizeTradeSimulationRun(run) → ClosedLoopBacktestSummary（复用既有适配器，不另写投影）",
    ],
  ),
  // evaluation 有两条合法入参路径（OR）：同链 backtest 的真实产物，或调用方直供的权益曲线。
  wired(
    "evaluation",
    "performanceMetrics + riskAdjustedMetrics + tradeQualityMetrics",
    [viaArtifact(["tradeSimulationRun"]), via(["evaluationInput"])],
    [
      "server/research/performanceMetrics/evaluate.ts:100  evaluatePerformance(input): PerformanceEvaluationRun",
      "server/research/riskAdjustedMetrics/evaluate.ts:83  evaluateRiskAdjustedMetrics(input): RiskAdjustedEvaluationRun",
      "server/research/tradeQualityMetrics/evaluate.ts:87  evaluateTradeQualityMetrics(input): TradeQualityEvaluationRun",
    ],
  ),
  notWired(
    "optimization",
    "parameterSearch + rollingOptimization",
    "模块本身是「参数空间 + 注入式 evaluator」的纯函数（parameterSearch/run.ts:132 runParameterSearch、rollingOptimization/run.ts:148 runRollingOptimization），装配必须自带一个「参数集 → 绩效标量」的 evaluator——那等于在本层再搭一条 dataset→signalEngine→simulator→evaluate 的子链。在候选/回测链尚未端到端验证前装配它，会产出一条**无法被独立复算**的 optimizationRef。待 backtest 链有真实 E2E 证据后再接。",
    ["server/research/parameterSearch/run.ts:132", "server/research/rollingOptimization/run.ts:148"],
  ),
  notWired(
    "robustness",
    "robustness + stochasticRobustness",
    "同 optimization：robustness/evaluate.ts:141 runRobustnessStress 需要扰动清单 + evaluator；stochasticRobustness/run.ts:258 需要基准日收益序列。两者都依赖同一条子链，理由同上。",
    ["server/research/robustness/evaluate.ts:141", "server/research/stochasticRobustness/run.ts:258"],
  ),
  notWired(
    "oos",
    "walkForwardRun + oosIsolation",
    "walkForwardRun/run.ts:287 需要 optimize/test 两个 evaluator 工厂 + 交易日序列 + 切分配置；oosIsolation/run.ts:125 需要 walk-forward 产物与 OOS 权益曲线。依赖链比 optimization 更长，且 IS/OOS 隔离纪律要求切分口径显式声明——装配前必须先定切分契约。",
    ["server/research/walkForwardRun/run.ts:287", "server/research/oosIsolation/run.ts:125"],
  ),
  notWired(
    "overfitting",
    "overfittingDetection + factorAblation",
    "overfittingDetection/run.ts:69 需要「候选 × 分区」指标矩阵（PBO 输入），factorAblation/run.ts:39 需要 IS/OOS 双轨评估器；均依赖 OOS 链先行。",
    ["server/research/overfittingDetection/run.ts:69", "server/research/factorAblation/run.ts:39"],
  ),
  notWired(
    "regime",
    "marketRegime",
    "marketRegime/run.ts:75 runMarketRegimeAnalysis 需要 `RegimeDayFacts[]` 序列（可由 marketRegime/facts.ts:238 buildRegimeDayFactsFromDatasetRows 从数据集行构建）。仅差「facts 装配 + regimeRef 投影（coverage / compositeSummary 需按 compositeKey 聚合 tags）」两件事，是本表中**最易补齐**的一项，留作下一增量。",
    ["server/research/marketRegime/run.ts:75", "server/research/marketRegime/facts.ts:238"],
  ),
  notWired(
    "paper",
    "signalToPnl + paperAccount",
    "signalToPnl/engine.ts:280 runSignalToPnlLoop 需要注入式 `priceSource`（PIT 行级价格回调）与 `tradingCalendar`；paperAccount/run.ts:127 另有独立状态机。价格回调的口径（用哪个价格源、是否复权）必须先定，否则产生的 paperRef 不可复现。",
    ["server/research/signalToPnl/engine.ts:280", "server/research/paperAccount/run.ts:127"],
  ),
  notWired(
    "review",
    "tradeJournal",
    "tradeJournal/drafts.ts:75 buildJournalDraftsFromRun 直接消费 paper 阶段的 SignalToPnlRun（且会复核其指纹）。paper 未装配 ⇒ 本阶段无真实输入可接。",
    ["server/research/tradeJournal/drafts.ts:75", "server/research/tradeJournal/reconcile.ts:190"],
  ),
  notWired(
    "discipline",
    "disciplineFeedback",
    "disciplineFeedback/run.ts:209 buildDisciplineFeedbackRun 消费 review 阶段的 TradeJournalEntry[]。review 未装配 ⇒ 本阶段无真实输入可接。",
    ["server/research/disciplineFeedback/run.ts:209"],
  ),
  wired(
    "finalize",
    "lifecycle",
    [via(["lifecycle"])],
    [
      "**无需本层注册执行器**：编排器在 `runner.finalize === undefined && request.lifecycle !== undefined` 时",
      "走内置路径 closedLoop/lifecycle.ts#attemptClosedLoopLifecycleAdvance（复用 C-21.1 applyLifecycleTransition）。",
      "本表仍要求 `lifecycle` 配置存在——否则编排器以 CL_LIFECYCLE_CONFIG_MISSING 阻塞。",
    ],
  ),
];

/** stageId → 装配声明（非法值抛错，防静默）。 */
export function closedLoopStageWiringRequirement(
  stageId: ClosedLoopStageId,
): ClosedLoopStageWiringRequirement {
  const found = CLOSED_LOOP_STAGE_WIRING_REQUIREMENTS.find((r) => r.stageId === stageId);
  if (found === undefined) {
    throw new Error(`closedLoopWiring: 未知阶段 ${String(stageId)}（装配声明表缺项）`);
  }
  return found;
}

/** 声明表必须与 canonical 阶段链逐项一致（导出供测试断言）。 */
export function assertClosedLoopWiringRequirementsCoverAllStages(): void {
  const declared = CLOSED_LOOP_STAGE_WIRING_REQUIREMENTS.map((r) => r.stageId);
  if (declared.length !== CLOSED_LOOP_STAGE_IDS.length) {
    throw new Error(
      `closedLoopWiring: 装配声明表条目数 ${declared.length} ≠ canonical 阶段数 ${CLOSED_LOOP_STAGE_IDS.length}`,
    );
  }
  for (let i = 0; i < CLOSED_LOOP_STAGE_IDS.length; i++) {
    if (declared[i] !== CLOSED_LOOP_STAGE_IDS[i]) {
      throw new Error(
        `closedLoopWiring: 装配声明表顺序错位（index ${i}：期望 ${CLOSED_LOOP_STAGE_IDS[i]}，实际 ${String(declared[i])}）`,
      );
    }
  }
}
