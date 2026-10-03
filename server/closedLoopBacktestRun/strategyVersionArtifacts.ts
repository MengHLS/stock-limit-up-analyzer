/**
 * SCOPE-002 S7 —— **按任意策略版本坐标**取回"评估 / 模拟盘"留档（纯选择 + 只读查询）。
 *
 * 为什么需要它：原先 `researchRun.getFinalEvaluation` / `getPaperTrading3570001` 是
 * **写死 runId** 的专项端点（只有 3570001 能用）。S7 要把这两个能力变成任何策略版本可用的
 * 通用能力（并收敛进策略详情页 Tab）。
 *
 * 纪律：
 *   - **只搬运、不重算**：`evaluationDetail` / `paperTradingState` / `paperTradingForwardState`
 *     一律原样返回；
 *   - **不伪造**：查不到 ⇒ `null`（不用空对象冒充"没有结果"）；
 *   - **不新建读取语义**：底层统一走 `listClosedLoopBacktestRunRawResults`（原样载荷，不经旧 reconcile）。
 */
import type { RawArchivedPayload } from "./rawPayload";
import { listClosedLoopBacktestRunRawResults } from "./rawPayload";

export interface StrategyVersionCoordinates {
  readonly strategyId: string;
  readonly strategyVersion: string;
}

export interface StrategyVersionEvaluationArtifacts {
  readonly baseline: RawArchivedPayload | null;
  readonly promoted: RawArchivedPayload | null;
  readonly evaluationDetail: unknown;
}

export interface StrategyVersionPaperTradingArtifacts {
  readonly state: unknown | null;
  readonly forward: unknown | null;
  /** 取到 `state` 的那条留档（便于前端展示 runId / 时间）；缺失 ⇒ null。 */
  readonly stateRun: RawArchivedPayload | null;
  readonly forwardRun: RawArchivedPayload | null;
}

function matches(row: RawArchivedPayload, coords: StrategyVersionCoordinates): boolean {
  return row.strategyId === coords.strategyId && row.strategyVersion === coords.strategyVersion;
}

function hasEvaluationDetail(row: RawArchivedPayload): boolean {
  return (row.payload as { evaluationDetail?: unknown }).evaluationDetail !== undefined
    && (row.payload as { evaluationDetail?: unknown }).evaluationDetail !== null;
}

/**
 * 纯函数：从一批原样留档里挑出「提升版 + 同任务基线」。
 *
 * - `promoted` = **坐标匹配**且带 `evaluationDetail` 的那条；
 * - `baseline` = 与 `promoted` **同 `experimentId`**、但坐标不同的那条（同一任务的对照组）；
 *   同任务多条候选时取**最旧**的一条（`rows` 已按 id 倒序）⇒ 结果稳定、可复现；
 * - `evaluationDetail` 取 `promoted` 优先，缺则取 `baseline`。
 */
export function selectStrategyVersionEvaluation(
  rows: readonly RawArchivedPayload[],
  coords: StrategyVersionCoordinates,
): StrategyVersionEvaluationArtifacts {
  const withDetail = rows.filter(hasEvaluationDetail);
  const promoted = withDetail.find(row => matches(row, coords)) ?? null;
  let baseline: RawArchivedPayload | null = null;
  if (promoted !== null && promoted.experimentId !== null) {
    const siblings = withDetail.filter(row =>
      row.experimentId === promoted.experimentId
      && row.id !== promoted.id
      && !(row.strategyId === promoted.strategyId && row.strategyVersion === promoted.strategyVersion),
    );
    baseline = siblings.length > 0 ? siblings[siblings.length - 1]! : null;
  }
  const evaluationDetail =
    (promoted?.payload as { evaluationDetail?: unknown } | null)?.evaluationDetail
    ?? (baseline?.payload as { evaluationDetail?: unknown } | null)?.evaluationDetail
    ?? null;
  return { baseline, promoted, evaluationDetail };
}

/** 纯函数：取该坐标下最新的模拟盘状态与最新的前向状态（各自可缺失）。 */
export function selectStrategyVersionPaperTrading(
  rows: readonly RawArchivedPayload[],
  coords: StrategyVersionCoordinates,
): StrategyVersionPaperTradingArtifacts {
  const scoped = rows.filter(row => matches(row, coords));
  const stateRun = scoped.find(row => {
    const value = (row.payload as { paperTradingState?: unknown }).paperTradingState;
    return value !== undefined && value !== null;
  }) ?? null;
  const forwardRun = scoped.find(row => {
    const value = (row.payload as { paperTradingForwardState?: unknown }).paperTradingForwardState;
    return value !== undefined && value !== null;
  }) ?? null;
  return {
    state: stateRun === null ? null : (stateRun.payload as { paperTradingState?: unknown }).paperTradingState ?? null,
    forward: forwardRun === null ? null : (forwardRun.payload as { paperTradingForwardState?: unknown }).paperTradingForwardState ?? null,
    stateRun,
    forwardRun,
  };
}

/** 只读：按坐标加载评估留档（会补读同 `experimentId` 的对照组）。 */
export async function loadStrategyVersionEvaluation(
  coords: StrategyVersionCoordinates,
): Promise<StrategyVersionEvaluationArtifacts> {
  const byCoords = await listClosedLoopBacktestRunRawResults({
    strategyId: coords.strategyId,
    strategyVersion: coords.strategyVersion,
    limit: 100,
  });
  const promoted = byCoords.find(hasEvaluationDetail) ?? null;
  if (promoted?.experimentId === undefined || promoted?.experimentId === null) {
    return selectStrategyVersionEvaluation(byCoords, coords);
  }
  const byExperiment = await listClosedLoopBacktestRunRawResults({
    experimentId: promoted.experimentId,
    limit: 100,
  });
  // 合并（去重）后走同一个纯选择器，保证"选择规则只有一份"。
  const merged = [...byExperiment, ...byCoords.filter(row => !byExperiment.some(other => other.id === row.id))];
  return selectStrategyVersionEvaluation(merged, coords);
}

/** 只读：按坐标加载模拟盘留档。 */
export async function loadStrategyVersionPaperTrading(
  coords: StrategyVersionCoordinates,
): Promise<StrategyVersionPaperTradingArtifacts> {
  const rows = await listClosedLoopBacktestRunRawResults({
    strategyId: coords.strategyId,
    strategyVersion: coords.strategyVersion,
    limit: 100,
  });
  return selectStrategyVersionPaperTrading(rows, coords);
}