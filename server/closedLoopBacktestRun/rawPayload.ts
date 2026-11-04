/**
 * PAPER-TRADING-PERSISTENCE-FIX-001 / SCOPE-002 S7 —— 扩展载荷的**原样**读取（不经旧版闭环 reconcile）。
 *
 * 背景：`closed_loop_backtest_run.resultJson` 现在同时承载两类载荷：
 *   1. 旧版闭环运行结果（需要 `reconcileArchivedClosedLoopResult` 做契约升级）；
 *   2. 本仓后续任务写入的**扩展载荷**（`paperTradingState` / `paperTradingForwardState` /
 *      `evaluationDetail`）——它们并不满足旧闭环 schema，若走 reconcile 会被判为
 *      `result: null`（「留了但读不出来」），尽管 DB 里的 JSON 是完整的。
 *
 * 本模块只做「按坐标直读 + 原样 JSON 解析」，**不做任何契约解释**：
 *   - 不修改既有摘要列语义；
 *   - 不影响旧闭环 Run 的原读取行为（旧路径保持不变）；
 *   - 空载荷 / 非对象载荷 ⇒ 如实返回 null（不伪造、不抛错）。
 */
import { and, desc, eq, like, inArray, type SQL } from "drizzle-orm";
import { closedLoopBacktestRun } from "../../drizzle/schema";
import { getDb } from "../db";

export interface RawArchivedPayload {
  readonly id: number;
  readonly runId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 留档所属任务 id（同一任务的多条运行共享它，例如"评估 = 基线 + 提升版"）。 */
  readonly experimentId: string | null;
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

const RAW_COLUMNS = {
  id: closedLoopBacktestRun.id,
  runId: closedLoopBacktestRun.runId,
  strategyId: closedLoopBacktestRun.strategyId,
  strategyVersion: closedLoopBacktestRun.strategyVersion,
  experimentId: closedLoopBacktestRun.experimentId,
  startDate: closedLoopBacktestRun.startDate,
  endDate: closedLoopBacktestRun.endDate,
  resultJson: closedLoopBacktestRun.resultJson,
} as const;

function toRaw(row: {
  id: number; runId: string; strategyId: string; strategyVersion: string;
  experimentId: string | null; startDate: string; endDate: string; resultJson: string | null;
}): RawArchivedPayload | null {
  const payload = parseRawArchivedPayload(row.resultJson);
  if (payload === null) return null;
  return {
    id: row.id, runId: row.runId, strategyId: row.strategyId, strategyVersion: row.strategyVersion,
    experimentId: row.experimentId, startDate: row.startDate, endDate: row.endDate, payload,
  };
}

/** 按 `runId` 直读扩展载荷（不经旧版 reconcile）。不存在 ⇒ null。 */
export async function getClosedLoopBacktestRunRawResult(
  runId: string,
): Promise<RawArchivedPayload | null> {
  if (typeof runId !== "string" || runId.trim() === "") return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select(RAW_COLUMNS).from(closedLoopBacktestRun)
    .where(eq(closedLoopBacktestRun.runId, runId)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toRaw(row);
}

/**
 * SCOPE-002 S7 —— 按坐标**批量**直读原样载荷（供"任意策略版本"的评估 / 模拟盘端点使用）。
 *
 * 只做过滤与排序，不做契约解释；空载荷行被丢弃（不伪造）。返回按 `id` 倒序（新的在前）。
 */
export async function listClosedLoopBacktestRunRawResults(filter: {
  readonly strategyId?: string;
  readonly strategyVersion?: string;
  readonly experimentId?: string;
  readonly runIdPrefix?: string;
  readonly limit?: number;
} = {}): Promise<readonly RawArchivedPayload[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (filter.strategyId !== undefined) conditions.push(eq(closedLoopBacktestRun.strategyId, filter.strategyId));
  if (filter.strategyVersion !== undefined) conditions.push(eq(closedLoopBacktestRun.strategyVersion, filter.strategyVersion));
  if (filter.experimentId !== undefined) conditions.push(eq(closedLoopBacktestRun.experimentId, filter.experimentId));
  if (filter.runIdPrefix !== undefined) conditions.push(like(closedLoopBacktestRun.runId, `${filter.runIdPrefix}%`));
  const limit = Number.isInteger(filter.limit) && (filter.limit ?? 0) > 0 ? (filter.limit as number) : 200;
  const query = db.select(RAW_COLUMNS).from(closedLoopBacktestRun);
  const rows = await (conditions.length > 0 ? query.where(and(...conditions)) : query)
    .orderBy(desc(closedLoopBacktestRun.id))
    .limit(limit);
  return rows.map(toRaw).filter((row): row is RawArchivedPayload => row !== null);
}

/** 便于同一任务内的多条运行一次性读回（如"评估 = 基线 + 提升版"）。 */
export async function listClosedLoopBacktestRunRawResultsByExperiment(
  experimentId: string,
  limit = 50,
): Promise<readonly RawArchivedPayload[]> {
  if (experimentId.trim() === "") return [];
  return listClosedLoopBacktestRunRawResults({ experimentId, limit });
}

/** 便于按一组 id 精确读回（保持入参顺序由调用方决定）。 */
export async function listClosedLoopBacktestRunRawResultsByIds(
  ids: readonly number[],
): Promise<readonly RawArchivedPayload[]> {
  const clean = ids.filter(id => Number.isInteger(id) && id > 0);
  if (clean.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select(RAW_COLUMNS).from(closedLoopBacktestRun)
    .where(inArray(closedLoopBacktestRun.id, [...clean]))
    .orderBy(desc(closedLoopBacktestRun.id));
  return rows.map(toRaw).filter((row): row is RawArchivedPayload => row !== null);
}