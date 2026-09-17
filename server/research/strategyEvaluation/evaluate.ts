/**
 * 运行工作台 — 「策略回测评估端口」（STEP B 落点① **唯一实现**）。
 *
 * ## 解决的问题（审计报告 P0-2 / P0-3）
 *
 * 参数搜索 / 走查 / 市场状态分组 / 绩效看板此前**只调 legacy `getLeaderCandidateBacktest`**：
 * `strategyId` 仅作记录标签、参数只认 8 个 legacy 字段、**未收录维度被静默忽略**
 * ⇒「策略评价 / 绩效 / 参数共通复用」**不成立**。
 *
 * 而闭环链里 `optimization` / `robustness` / `oos` / `overfitting` 四阶段恒 `notWired`，
 * `closedLoopWiring/requirements.ts` 写明的理由是：它们需要一个「**参数集 → 绩效标量**」的 evaluator，
 * 而「装配必须自带 evaluator」等于**在本层再搭一条 dataset→signalEngine→simulator→evaluate 的子链**。
 *
 * ⇒ 本模块就是**那一条**子链（唯一实现）。四阶段的共同前置，也是参数搜索的统一评估器。
 *
 * ## 硬纪律（改本文件前先读）
 *
 * 1. **禁第二套口径**：本模块**不重写任何计算** —— 装配走 `assembleRunWorkbenchInputs`；
 *    撮合与投影走闭环**既有**执行器（`closedLoopWiring/executors.ts` 的 data / research /
 *    strategy / backtest / evaluation 五支）；指标走既有 `performanceMetrics` /
 *    `riskAdjustedMetrics` / `tradeQualityMetrics`。本模块只做「串起来 + 把标量取出来」。
 * 2. **复用而非重搭**：经 `createClosedLoopWiring` + `runClosedLoop` 走一遍**真实阶段链**，
 *    而不是手写 dataset→engine→simulator→evaluate —— 后者会产出**无法被独立复算**的标量。
 * 3. **禁伪造**：任一必需阶段未 `EXECUTED` ⇒ **响亮抛错**，绝不返回半截标量
 *    （那会让调用方误以为评估成功 —— 本项目最难发现的一类错）。
 * 4. **参数覆写是唯一入口**：模式为「同一份策略文档 × 不同 `parameterOverrides`」。
 *    覆写键必须存在于 `document.parameters`，否则由 `resolveParameters` 抛
 *    `RECIPE_PARAMETER_UNKNOWN`（拒绝「以为某维度参与寻优、实际被丢掉」）。
 */

import { createHash } from "node:crypto";
import { assembleRunWorkbenchInputs } from "../../runWorkbenchAssembly/assemble";
import type { ResearchDataset } from "../../researchDataset";
import type { EquityPoint } from "../../backtest/types";
import { createClosedLoopWiring, ClosedLoopWiringError } from "../closedLoopWiring/executors";
import { runClosedLoop } from "../closedLoop/orchestrator";
import type {
  ClosedLoopEvaluationRef,
  ClosedLoopRunMetadata,
  ClosedLoopStageId,
} from "../closedLoop/types";
import type { StrategyDocument } from "../strategySchema/types";
import type { ResearchParameterSet } from "../types";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/**
 * 评估端口跑的子链 —— **`CLOSED_LOOP_STAGE_IDS` 的前 5 项**（canonical 保序子集）。
 *
 * 为什么恰好这 5 个：
 *   - `data` 提供数据集；`research` 产出 `candidateRun`；`backtest` 真调 `runTradeSimulation`；
 *   - `evaluation` 真调三个 `evaluate*` 并合成 `evaluationRef`（= 本端口的输出）；
 *   - `strategy` 在 canonical 序里位于 `research` 与 `backtest` 之间，且装配层已提供其入参
 *     （`strategyDocumentInput`）⇒ 一并跑上，保持与「运行工作台」同源的阶段序，不跳段。
 *
 * ⚠️ `optimization` / `robustness` / `oos` / `overfitting` **不在此子链内** ——
 * 它们反过来**消费**本端口（见模块头「解决的问题」），若纳入则成环。
 */
export const STRATEGY_EVALUATION_STAGE_IDS: readonly ClosedLoopStageId[] = [
  "data",
  "research",
  "strategy",
  "backtest",
  "evaluation",
];

// ---------------------------------------------------------------------------
// 契约
// ---------------------------------------------------------------------------

export interface StrategyEvaluationRequest {
  /**
   * 策略文档（**真实读出** `strategy_versions.strategyDocumentJson` 的结果）。
   *
   * 显式传入而不是本端口自己查库 —— 「读哪一版」由调用方决定（与装配层同一纪律）。
   */
  readonly strategyDocument: StrategyDocument;
  /**
   * 本次运行的**参数覆写**（缺省 = 全部取文档 `defaultValue`）。
   *
   * 🔴 键必须存在于 `document.parameters`，否则抛 `RECIPE_PARAMETER_UNKNOWN`。
   */
  readonly parameterOverrides?: ResearchParameterSet;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly createdAt: string;
  readonly codeVersion: string;
  readonly datasetVersionId?: number;
  readonly datasetSourcePolicy?: "prefer-registry" | "rebuild";
  readonly dataReady?: boolean;
  readonly maxTradingDays?: number;
  readonly maxSecuritiesPerDay?: number;
  /**
   * 🔴 **注入已构建数据集**：参数搜索会调本端口 **N 次**（N = 参数组合数）。
   * 每次都重新解析（重建是分钟级）⇒ N × 分钟级，实际不可用
   * ⇒ 调用方先建一次、再复用 N 次（复用时 `datasetSource` 如实标成 `injected`）。
   */
  readonly dataset?: ResearchDataset;
  /** 实验 id（缺省由策略身份 + 参数覆写**确定性**派生，见 `deriveExperimentId`）。 */
  readonly experimentId?: string;
}

/** 单个阶段的真实状态（供调用方如实展示「哪一环没跑」）。 */
export interface StrategyEvaluationStageState {
  readonly stageId: ClosedLoopStageId;
  readonly state: string;
  readonly reasonCode: string | null;
  readonly detail: string | null;
}

export interface StrategyEvaluationResult {
  readonly experimentId: string;
  readonly runId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** **本次实际使用的参数集**（= 装配层解析结果，含覆写与 `defaultValue`）。 */
  readonly parameterSet: ResearchParameterSet;
  readonly datasetVersion: string;
  /** `registry` / `rebuild` / `injected`（复用事实不伪装）。 */
  readonly datasetSource: string;
  readonly datasetRowCount: number;
  /**
   * 本次使用的数据集（**原样返回**，供调用方在后续评估里复用）。
   *
   * 🔴 参数搜索的调用范式：第 1 次**不带** `dataset`（由本端口解析 / 构建）⇒ 从结果取回；
   * 后续 N-1 次把它作为 `dataset` 传入 ⇒ 跳过一切解析（`datasetSource` 如实变成 `injected`）。
   * 没有这一项，注入路径对调用方**不可用**（拿到不数据集就没法复用）。
   */
  readonly dataset: ResearchDataset;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  /**
   * **主输出**：与闭环 `evaluation` 阶段**同一份**标量（同源取出，不另行计算）。
   *
   * 含 `performance`（总收益 / CAGR / 最大回撤）、`riskAdjusted`（Sharpe / Sortino / Calmar）、
   * `tradeQuality`（胜率 / 盈亏比 / 完成交易数），以及 `backtestFingerprint`（绑定到具体那次撮合）。
   */
  readonly evaluation: ClosedLoopEvaluationRef;
  readonly backtestFingerprint: string;
  /**
   * 本次撮合的**权益曲线**（来自同链 `backtest` 阶段的真实产物，`artifacts.tradeSimulationRun`）。
   *
   * 为什么必须带出来：走查（walk-forward）要把逐窗权益曲线**拼接**成样本外曲线；
   * 只给标量的话，调用方只能自己再跑一遍回测拿曲线 —— 那正是「第二套子链」。
   */
  readonly equityCurve: readonly EquityPoint[];
  readonly stages: readonly StrategyEvaluationStageState[];
}

// ---------------------------------------------------------------------------
// 公开入口
// ---------------------------------------------------------------------------

/**
 * 评估「某份策略文档 × 某组参数」的绩效标量（走真实闭环前 5 阶段）。
 *
 * 抛错条件（全部响亮）：装配失败（缺成本模型 / 执行模型 / 回测配置）、参数覆写非法、任一必需阶段未 `EXECUTED`。
 */
export async function evaluateStrategyParameters(
  request: StrategyEvaluationRequest,
): Promise<StrategyEvaluationResult> {
  const document = request.strategyDocument;
  const experimentId =
    request.experimentId ?? deriveExperimentId(document, request.parameterOverrides, request.createdAt);
  const runId = `STRATEGY-EVAL::${experimentId}`;

  // -- 1. 装配（复用装配层；注入数据集时它跳过一切解析）--
  const assembled = await assembleRunWorkbenchInputs({
    strategyId: document.strategyId,
    strategyVersion: document.version,
    startDate: request.dateRange.startDate,
    endDate: request.dateRange.endDate,
    createdAt: request.createdAt,
    codeVersion: request.codeVersion,
    strategyDocument: document,
    ...(request.parameterOverrides !== undefined ? { parameterOverrides: request.parameterOverrides } : {}),
    ...(request.datasetVersionId !== undefined ? { datasetVersionId: request.datasetVersionId } : {}),
    ...(request.datasetSourcePolicy !== undefined ? { datasetSourcePolicy: request.datasetSourcePolicy } : {}),
    ...(request.dataReady !== undefined ? { dataReady: request.dataReady } : {}),
    ...(request.maxTradingDays !== undefined ? { maxTradingDays: request.maxTradingDays } : {}),
    ...(request.maxSecuritiesPerDay !== undefined ? { maxSecuritiesPerDay: request.maxSecuritiesPerDay } : {}),
    ...(request.dataset !== undefined ? { researchDataset: request.dataset } : {}),
  });

  const parameterSet = (assembled.inputs.experimentConfig?.parameters ?? {}) as ResearchParameterSet;

  // -- 2. 走真实阶段链（复用既有执行器；本端口不手写 dataset→engine→simulator→evaluate）--
  const metadata: ClosedLoopRunMetadata = {
    experimentId,
    strategyId: document.strategyId,
    strategyVersion: document.version,
    dateRange: { ...request.dateRange },
    datasetVersion: assembled.dataset.datasetVersion,
    universeVersion: null,
    codeVersion: request.codeVersion,
    costModel: assembled.assembly.simulation.costModel,
    executionModel: assembled.assembly.simulation.executionModel,
    parameterSet,
  };

  const { artifacts, stageRunners } = createClosedLoopWiring(assembled.inputs, {
    requested: STRATEGY_EVALUATION_STAGE_IDS,
  });

  const run = runClosedLoop({
    runId,
    createdAt: request.createdAt,
    metadata,
    stageIds: STRATEGY_EVALUATION_STAGE_IDS,
    stageRunners,
  });

  const stages: readonly StrategyEvaluationStageState[] = run.stages.map(stage => ({
    stageId: stage.stageId,
    state: stage.state,
    reasonCode: stage.blocked?.reasonCode ?? null,
    detail: stage.blocked?.detail ?? null,
  }));

  // -- 3. evaluation 必须真跑过（禁返回半截标量）--
  const evaluationStage = run.stages.find(stage => stage.stageId === "evaluation");
  if (evaluationStage === undefined || evaluationStage.state !== "EXECUTED") {
    const blocked = evaluationStage?.blocked ?? null;
    // 🔴 必须把**全部阶段状态**带出来：只报「evaluation 未执行」会让人看到「上游已阻塞」
    //    却看不到上游**为什么**阻塞（本次实测就卡在这里 —— 真正原因是 `data` 阶段未注册执行器）。
    const stageDigest = run.stages
      .filter(stage => stage.state !== "EXECUTED" || stage.stageId === "evaluation")
      .map(stage =>
        stage.blocked === null
          ? `${stage.stageId}=${stage.state}`
          : `${stage.stageId}=${stage.state}(${stage.blocked.reasonCode}: ${stage.blocked.detail})`,
      )
      .join(" ; ");
    throw new ClosedLoopWiringError(
      "STRATEGY_EVALUATION_STAGE_NOT_EXECUTED",
      `评估端口：阶段 \`evaluation\` 未执行（state=${evaluationStage?.state ?? "（缺失）"}）。` +
        (blocked === null
          ? ""
          : `阻断原因 ${blocked.reasonCode}：${blocked.detail}` +
            (blocked.errorMessage !== null ? `（${blocked.errorMessage}）` : "")) +
        `\n非 EXECUTED 的阶段：${stageDigest || "（无）"}` +
        `\n拒绝返回半截标量 —— 那会让调用方误以为评估成功。`,
    );
  }

  const evaluation = evaluationStage.output as ClosedLoopEvaluationRef | null;
  if (evaluation === null || evaluation.kind !== "evaluationRef") {
    throw new ClosedLoopWiringError(
      "STRATEGY_EVALUATION_OUTPUT_INVALID",
      `评估端口：evaluation 阶段产物不是 \`evaluationRef\`（实际 ${evaluation === null ? "null" : String(evaluation.kind)}）。`,
    );
  }

  return {
    experimentId,
    runId,
    strategyId: document.strategyId,
    strategyVersion: document.version,
    parameterSet,
    datasetVersion: assembled.dataset.datasetVersion,
    datasetSource: assembled.assembly.datasetSource,
    datasetRowCount: assembled.assembly.datasetRowCount,
    dataset: assembled.dataset,
    dateRange: { ...request.dateRange },
    evaluation,
    backtestFingerprint: evaluation.backtestFingerprint,
    // 同链 backtest 阶段的真实产物（未产出则空数组 —— 不伪造）
    equityCurve: artifacts.tradeSimulationRun?.equityCurve ?? [],
    stages,
  };
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/**
 * 确定性派生实验 id（`EXP-YYYYMMDD-XXXXXXXX`，与 C-13.3 validator 同形态）。
 *
 * 🔴 为什么派生而不是随机 / 要求调用方必填：参数搜索会调本端口 **N 次**，
 * 「同一策略 + 同一组参数」必须得到**同一个 id**（否则结果无法复现、也无法去重）。
 * 因此摘要只吃「策略身份 + 覆写键值（排序后）」—— 不含时间戳、不含随机数。
 */
export function deriveExperimentId(
  document: StrategyDocument,
  overrides: ResearchParameterSet | undefined,
  createdAt: string,
): string {
  const datePart = createdAt.slice(0, 10).replace(/-/g, "");
  const overrideKey = Object.keys(overrides ?? {})
    .sort()
    .map(name => `${name}=${String((overrides ?? {})[name])}`)
    .join(",");
  const digest = createHash("sha256")
    .update(`${document.strategyId}@${document.version}|${overrideKey}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `EXP-${datePart}-${digest}`;
}
