/**
 * CLOSED-LOOP-BACKTEST-PERSIST-001 — 闭环运行结果 → 留档摘要（纯函数，无 DB 依赖）。
 *
 * 为什么要单独一层「摘要」：完整 `ClosedLoopRunResult` 单条可达数百 KB（含 500 条成交
 * 明细 + 权益曲线 + 各阶段产出），**列表页不能读它**。本模块把「列表页要展示的那几个
 * 数」抽成扁平结构，与完整结果分开存储（列 / JSON），列表查询因此始终是轻的。
 *
 * 三条纪律：
 *   1. **只搬运，不估计** —— 每个数都直接取自结果里的真实字段；取不到就是 `null`，
 *      绝不补 0、绝不推算（`null` 与 `0` 在这里是不同的事实）；
 *   2. **不抛错** —— 结构缺失一律降级为 `null`（留档不能因为一个字段没取到就整体失败）；
 *   3. **坐标不入摘要** —— `experimentId` / 策略 / 窗口这类坐标由调用方（本次运行入参）
 *      直接写入留档表的独立列，不塞进摘要对象；摘要只承载「从结果里算/取出来的量」。
 */

import type { ClosedLoopRunResult } from "../../shared/researchContracts";

/** 列表页展示所需的扁平摘要（与留档表的结构化列一一对应）。 */
export type ClosedLoopBacktestRunSummary = {
  runId: string;
  status: string;
  executedStageCount: number;
  blockedStageCount: number;
  skippedStageCount: number;
  firstBlockedReasonCode: string | null;
  datasetVersion: string | null;
  datasetVersionId: number | null;
  datasetSource: string | null;
  /** 装配层如实记录的回落原因（如「直读数据集不可撮合」）；未回落为 null。 */
  datasetSourceNote: string | null;
  recipeId: string | null;
  initialCapital: number | null;
  finalEquity: number | null;
  tradeCount: number | null;
  equityCurvePointCount: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 有界数值读取：只接受有限数，其余（含字符串数字）一律 null —— 不做隐式转换。 */
function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * 从 `backtest` 阶段的产出里读交接摘要。
 *
 * 判据（与前端面板同口径）：该阶段 **state=EXECUTED** 且产出 `kind="backtestSummary"`。
 * 不满足即返回 null —— 例如 backtest 被 BLOCKED 时本就没有产生任何成交与曲线。
 */
export function readBacktestStageOutput(
  result: ClosedLoopRunResult,
): Record<string, unknown> | null {
  for (const stage of result.stages) {
    if (stage.stageId !== "backtest" || stage.state !== "EXECUTED") continue;
    const output = asRecord(stage.output);
    if (output === null) return null;
    return asString(output.kind) === "backtestSummary" ? output : null;
  }
  return null;
}

/**
 * 组装留档摘要。
 *
 * 数据来源分工：
 *   - 运行级（状态 / 阶段计数 / 首阻塞码）← `result.overall`；
 *   - 数据来源（dataset 坐标 / 来源 / 配方 / 初始资金）← `result.assembly`（可为 null）；
 *   - 回测产出（期末权益 / 成交笔数 / 曲线点数）← backtest 阶段产出（可为 null）。
 */
export function buildClosedLoopBacktestRunSummary(
  result: ClosedLoopRunResult,
): ClosedLoopBacktestRunSummary {
  const assembly = asRecord(result.assembly);
  const simulation = assembly === null ? null : asRecord(assembly.simulation);
  const backtestOutput = readBacktestStageOutput(result);

  return {
    runId: result.runId,
    status: result.overall.status,
    executedStageCount: result.overall.executedStageCount,
    blockedStageCount: result.overall.blockedStageCount,
    skippedStageCount: result.overall.skippedStageCount,
    firstBlockedReasonCode: asString(result.overall.firstBlockedReasonCode),
    datasetVersion: assembly === null ? null : asString(assembly.datasetVersion),
    datasetVersionId: assembly === null ? null : asFiniteNumber(assembly.datasetVersionId),
    datasetSource: assembly === null ? null : asString(assembly.datasetSource),
    datasetSourceNote: assembly === null ? null : asString(assembly.datasetSourceNote),
    recipeId: assembly === null ? null : asString(assembly.recipeId),
    initialCapital: simulation === null ? null : asFiniteNumber(simulation.initialCapital),
    finalEquity: backtestOutput === null ? null : asFiniteNumber(backtestOutput.finalEquity),
    tradeCount: backtestOutput === null ? null : asFiniteNumber(backtestOutput.tradeCount),
    equityCurvePointCount:
      backtestOutput === null ? null : asFiniteNumber(backtestOutput.equityCurvePointCount),
  };
}
