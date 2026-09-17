/**
 * 运行工作台 — 「参数集 → 绩效标量」**同步**评估器（STEP B 落点③ 的接线件）。
 *
 * ## 为什么必须是同步的
 *
 * 闭环的 `ClosedLoopStageExecutor`（`orchestrator.ts:322` **无 `await`**）与
 * `parameterSearch` / `robustness` 的 `evaluator`（`parameterSearch/types.ts:75`、
 * `robustness/types.ts:305`）**都是同步**的；而 `evaluateStrategyParameters` 是 `async`
 * —— 它要**解析数据集**。⇒ 本模块提供**同步**版本：数据集与策略文档由调用方**已经持有**
 * （闭环内它们就是 `artifacts.dataset` 与 `artifacts.strategyDocument`）。
 *
 * 这正是 `requirements.ts` 那句「装配必须自带一个 evaluator —— 那等于在本层再搭一条子链」
 * 的**技术根因**：它缺的不是「一条子链」，而是「**同步可得的策略侧装配**」。
 *
 * ## 硬纪律
 *
 * 1. **禁第二套**：装配走 `assemble.ts#assembleStrategySide` + `buildClosedLoopWiringInputs`；
 *    撮合与投影走闭环**既有执行器**（`research` / `backtest` / `evaluation` 三支）——
 *    **不手写** dataset→signalEngine→simulator→evaluate。
 * 2. **失败结构化返回**（不抛错）：搜索器契约是 `{status:"failed", error}`，
 *    单个参数集失败**不应中断**整批搜索；但也**绝不编造标量**。
 * 3. `parameterOverrides` 的键必须在文档参数里，否则 `resolveParameters` 抛
 *    `RECIPE_PARAMETER_UNKNOWN` ⇒ 此处转为 `{status:"failed"}`，**不静默忽略**。
 */

import { assembleStrategySide, buildClosedLoopWiringInputs } from "../../runWorkbenchAssembly/assemble";
import type { ResearchDataset } from "../../researchDataset";
import { createClosedLoopStageRunners } from "../closedLoopWiring/executors";
import { createClosedLoopWiringArtifacts } from "../closedLoopWiring/types";
import { runClosedLoop } from "../closedLoop/orchestrator";
import type {
  ClosedLoopEvaluationRef,
  ClosedLoopRunMetadata,
} from "../closedLoop/types";
import type { ParameterSearchEvaluator, ParameterSearchSampleOutcome } from "../parameterSearch/types";
import type { StrategyDocument } from "../strategySchema/types";
import type { ResearchParameterSet } from "../types";
import { STRATEGY_EVALUATION_STAGE_IDS, deriveExperimentId } from "./evaluate";

/**
 * 🔴 子链**与 async 版完全相同**（复用 `evaluate.ts#STRATEGY_EVALUATION_STAGE_IDS`，共 5 阶段）。
 *
 * ⚠️ 曾试图跳过 `data` 阶段（理由：数据集已由调用方持有），**实测失败**：
 * `research` 阶段的 `consumesKind === "datasetSummary"` —— 它消费的是**上游交接产物**
 * （`data` 阶段 EXECUTED 时产出的 `ClosedLoopDatasetSummary`），**不是** `artifacts.dataset`。
 * 只预置 `artifacts.dataset` 而跳过 `data` ⇒ `inputResolved=false` ⇒ 门禁 2 直接拒
 * （报出来是 `CL_UPSTREAM_BLOCKED`，看不出真因）。
 * ⇒ 正确做法：`data` 阶段照跑 —— 它会因 `artifacts.dataset` 已预置而**直接** EXECUTED
 * （`requireDataset` 优先取 `artifacts.dataset`，零 IO），交接产物自然生成。
 */

export interface StrategyParameterEvaluatorInput {
  /** 已构建的数据集（🔴 由调用方**复用** —— 这是「同一份数据跑 N 组参数」的关键）。 */
  readonly dataset: ResearchDataset;
  readonly document: StrategyDocument;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly createdAt: string;
  readonly codeVersion: string;
  /** runId 前缀（便于在日志 / 审计里区分「哪个阶段的评估」）。 */
  readonly runIdPrefix: string;
}

/**
 * 构造**同步**的「参数集 → 绩效标量」评估器
 * （供 `runParameterSearch` / `runRobustnessStress` 注入）。
 *
 * 调用范式：
 * ```ts
 * const evaluator = createStrategyParameterEvaluator({ dataset, document, dateRange, ... });
 * runParameterSearch({ ..., evaluator });   // 搜索器本身不执行 IO / 回测
 * ```
 */
export function createStrategyParameterEvaluator(
  input: StrategyParameterEvaluatorInput,
): ParameterSearchEvaluator {
  return parameterSet => {
    try {
      return evaluateOneParameterSet(input, parameterSet);
    } catch (error) {
      // 契约要求结构化失败（不抛错）：单个参数集失败不应中断整批搜索
      return {
        status: "failed",
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
    }
  };
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

function evaluateOneParameterSet(
  input: StrategyParameterEvaluatorInput,
  parameterSet: ResearchParameterSet,
): ParameterSearchSampleOutcome {
  // -- 1. 同步装配策略侧（唯一实现；此处**不碰数据集**，直接复用调用方那份）--
  const side = assembleStrategySide(
    {
      strategyId: input.document.strategyId,
      strategyVersion: input.document.version,
      startDate: input.dateRange.startDate,
      endDate: input.dateRange.endDate,
      createdAt: input.createdAt,
      codeVersion: input.codeVersion,
      strategyDocument: input.document,
      parameterOverrides: parameterSet,
    },
    input.dataset.datasetVersion,
  );

  // -- 2. 复用闭环既有执行器走 research → backtest → evaluation（**不手写子链**）--
  const artifacts = createClosedLoopWiringArtifacts();
  artifacts.dataset = input.dataset; // 预置 ⇒ 无需 data 阶段
  const wiringInputs = buildClosedLoopWiringInputs(input.dataset, side);
  const stageRunners = createClosedLoopStageRunners(wiringInputs, artifacts, {
    requested: STRATEGY_EVALUATION_STAGE_IDS,
  });

  const resolvedParameters = (side.experimentConfig.parameters ?? {}) as ResearchParameterSet;
  const experimentId = deriveExperimentId(input.document, resolvedParameters, input.createdAt);
  const metadata: ClosedLoopRunMetadata = {
    experimentId,
    strategyId: input.document.strategyId,
    strategyVersion: input.document.version,
    dateRange: { ...input.dateRange },
    datasetVersion: input.dataset.datasetVersion,
    universeVersion: null,
    codeVersion: input.codeVersion,
    costModel: side.costModel,
    executionModel: side.executionModel,
    parameterSet: resolvedParameters,
  };

  const run = runClosedLoop({
    runId: `${input.runIdPrefix}::${experimentId}`,
    createdAt: input.createdAt,
    metadata,
    stageIds: STRATEGY_EVALUATION_STAGE_IDS,
    stageRunners,
  });

  const evaluationStage = run.stages.find(stage => stage.stageId === "evaluation");
  if (evaluationStage === undefined || evaluationStage.state !== "EXECUTED") {
    const blocked = evaluationStage?.blocked ?? null;
    // 🔴 必须把全部非 EXECUTED 阶段带出来：只报「evaluation 未执行」会让人看到「上游已阻塞」
    //    却看不到上游**为什么**阻塞（本次实测就卡在这里 —— 真因是 research 拿不到 datasetSummary 交接）。
    const stageDigest = run.stages
      .filter(stage => stage.state !== "EXECUTED" && stage.state !== "SKIPPED")
      .map(stage =>
        stage.blocked === null
          ? `${stage.stageId}=${stage.state}`
          : `${stage.stageId}=${stage.state}(${stage.blocked.reasonCode}: ${stage.blocked.detail})`,
      )
      .join(" ; ");
    return {
      status: "failed",
      error:
        `evaluation 阶段未执行（state=${evaluationStage?.state ?? "（缺失）"}）` +
        (blocked === null ? "" : `，阻断 ${blocked.reasonCode}：${blocked.detail}`) +
        `\n非 EXECUTED 的阶段：${stageDigest || "（无）"}` ,
    };
  }

  const evaluation = evaluationStage.output as ClosedLoopEvaluationRef | null;
  if (evaluation === null || evaluation.kind !== "evaluationRef") {
    return {
      status: "failed",
      error: `evaluation 阶段产物不是 evaluationRef（实际 ${evaluation === null ? "null" : String(evaluation.kind)}）`,
    };
  }

  // -- 3. 投影为搜索器需要的标量（缺失 ⇒ 结构化失败，**绝不编 0**）--
  const totalReturnPct = evaluation.performance?.totalReturnPct ?? null;
  const maxDrawdownPct = evaluation.performance?.maxDrawdownPct ?? null;
  if (totalReturnPct === null || maxDrawdownPct === null) {
    return {
      status: "failed",
      error: "evaluationRef.performance 缺失 totalReturnPct / maxDrawdownPct（拒绝编造标量）",
    };
  }
  return {
    status: "succeeded",
    metrics: {
      totalReturnPct,
      maxDrawdownPct,
      tradeCount: evaluation.tradeQuality?.completedTradeCount ?? null,
    },
  };
}
