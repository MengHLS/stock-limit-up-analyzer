/**
 * PAPER-TRADING-PERSISTENCE-FIX-001 —— 扩展载荷的**原样**读取（不经旧版闭环 reconcile）。
 *
 * 背景：`closed_loop_backtest_run.resultJson` 现在同时承载两类载荷：
 *   1. 旧版闭环运行结果（需要 `reconcileArchivedClosedLoopResult` 做契约升级）；
 *   2. 本仓后续任务写入的**扩展载荷**（`paperTradingState` / `paperTradingForwardState` /
 *      `evaluationDetail`）——它们并不满足旧闭环 schema，若走 reconcile 会被判为
 *      `result: null`（「留了但读不出来」），尽管 DB 里的 JSON 是完整的。
 *
 * 本模块只做「按 runId 直读 + 原样 JSON 解析」，**不做任何契约解释**：
 *   - 不修改既有摘要列语义；
 *   - 不影响旧闭环 Run 的原读取行为（旧路径保持不变）；
 *   - 空载荷 / 非对象载荷 ⇒ 如实返回 null（不伪造、不抛错）。
 */
import { eq } from "drizzle-orm";
import { closedLoopBacktestRun } from "../../drizzle/schema";
import { getDb } from "../db";

export interface RawArchivedPayload {
  readonly id: number;
  readonly runId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly startDate: string;
  readonly endDate: string;
  /** 原样解析的 `resultJson` 对象（未做任何 schema 解释）。 */
  readonly payload: Record<string, unknown>;
}

/** 纯函数：解析扩展载荷 JSON；空 / 非对象 ⇒ null（不抛错、不伪造）。 */
export function parseRawArchivedPayload(resultJson: string | null | undefined): Record<string, unknown> | null {
  if (resultJson === null || resultJson === undefined || resultJson === "") return null;
  const parsed = JSON.parse(resultJson) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** 按 `runId` 直读扩展载荷（不经旧版 reconcile）。不存在 ⇒ null。 */
export async function getClosedLoopBacktestRunRawResult(
  runId: string,
): Promise<RawArchivedPayload | null> {
  if (typeof runId !== "string" || runId.trim() === "") return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      id: closedLoopBacktestRun.id,
      runId: closedLoopBacktestRun.runId,
      strategyId: closedLoopBacktestRun.strategyId,
      strategyVersion: closedLoopBacktestRun.strategyVersion,
      startDate: closedLoopBacktestRun.startDate,
      endDate: closedLoopBacktestRun.endDate,
      resultJson: closedLoopBacktestRun.resultJson,
    })
    .from(closedLoopBacktestRun)
    .where(eq(closedLoopBacktestRun.runId, runId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  const payload = parseRawArchivedPayload(row.resultJson);
  if (payload === null) return null;
  return {
    id: row.id, runId: row.runId, strategyId: row.strategyId, strategyVersion: row.strategyVersion,
    startDate: row.startDate, endDate: row.endDate, payload,
  };
}
