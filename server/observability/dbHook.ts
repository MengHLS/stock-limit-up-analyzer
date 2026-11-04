/**
 * PARAMETER-001-PRE — DB 往返统计挂钩（**仅在 `PARAM_PROFILE=1` 时安装**）。
 *
 * ## 为什么用「挂钩连接池」而不是「给每个查询加埋点」
 *
 * R-06 的关键一问是「是否每个决策日重复查询 Dataset / 是否存在 N+1」。这类问题靠**逐处埋点**
 * 回答不了（漏一处就得出结论），只能靠**连接池级别的全量计数**：无论调用方是谁，只要发出 SQL
 * 就被记一次。因此本模块直接包住 drizzle 底层 mysql2 pool 的 `query` / `execute`。
 *
 * ## 语义（必须安全）
 *
 *   - **不改 SQL、不改参数、不改返回**：只旁路计时与计数；
 *   - **同步 / 回调 / Promise 三种调用形态都保留**（mysql2 的 `query` 支持回调式，
 *     drizzle 正是用回调式调用）——包装会原样透传参数与回调；
 *   - **失败也记账**：错误路径同样记录耗时（否则「慢到超时」会被漏统计）；
 *   - 分类 `read` / `write`：按 SQL 首关键字判定（`select|with|show|describe|explain` = read）；
 *   - 只在 `PERF_DB_HOOK_ENABLED` 为真时安装 ⇒ 关闭时**完全不存在**这层包装。
 */

import { PERF_DB_HOOK_ENABLED, perfCount, perfMark } from "./perfProfile";

/** 计数器 / 刻度键（集中定义，避免各处写字面量）。 */
export const DB_COUNTER_ROUND_TRIPS = "db.round_trips";
export const DB_COUNTER_READS = "db.reads";
export const DB_COUNTER_WRITES = "db.writes";
export const DB_MARK_TOTAL_MS = "db.total_ms";
export const DB_MARK_READ_MS = "db.read_ms";
export const DB_MARK_WRITE_MS = "db.write_ms";

const READ_PREFIX = /^\s*(?:select|with|show|describe|desc|explain)\b/i;

function classify(sqlText: string): "read" | "write" {
  return READ_PREFIX.test(sqlText) ? "read" : "write";
}

interface QueryArgs {
  readonly sqlText: string;
  readonly method: "query" | "execute";
}

/** 从 mysql2 调用的第一个参数里抽出 SQL 文本（string | Sql 对象；拿不到就用空串）。 */
function extractSqlText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") {
    const record = value as { sql?: unknown; toSqlString?: unknown };
    if (typeof record.sql === "string") return record.sql;
    if (typeof record.toSqlString === "function") {
      try {
        return String((record.toSqlString as () => unknown).call(value));
      } catch {
        return "";
      }
    }
  }
  return "";
}

function record(args: QueryArgs, elapsedNs: bigint): void {
  const kind = classify(args.sqlText);
  const ms = Number(elapsedNs) / 1e6;
  perfCount(DB_COUNTER_ROUND_TRIPS);
  perfCount(kind === "read" ? DB_COUNTER_READS : DB_COUNTER_WRITES);
  perfMark(DB_MARK_TOTAL_MS, ms);
  perfMark(kind === "read" ? DB_MARK_READ_MS : DB_MARK_WRITE_MS, ms);
}

/**
 * 安装挂钩。返回是否真的安装了（幂等：已装过则不再包一层）。
 *
 * @param client mysql2 pool（= `db.$client`）
 */
export function installDbPerfHook(client: unknown): boolean {
  if (!PERF_DB_HOOK_ENABLED) return false;
  if (client === null || typeof client !== "object") return false;
  const pool = client as Record<string, unknown> & { __paramProfileHooked?: boolean };
  if (pool.__paramProfileHooked === true) return true;

  for (const method of ["query", "execute"] as const) {
    const original = pool[method];
    if (typeof original !== "function") continue;
    const bound = (original as (...a: unknown[]) => unknown).bind(pool);
    pool[method] = function perfWrapped(...args: unknown[]): unknown {
      const sqlText = extractSqlText(args[0]);
      const callbackIndex = args.findIndex((value) => typeof value === "function");
      const startNs = process.hrtime.bigint();
      if (callbackIndex >= 0) {
        const userCallback = args[callbackIndex] as (...cbArgs: unknown[]) => unknown;
        args[callbackIndex] = (...cbArgs: unknown[]): unknown => {
          record({ sqlText, method }, process.hrtime.bigint() - startNs);
          return userCallback(...cbArgs);
        };
        return bound(...args);
      }
      const result = bound(...args);
      if (result !== null && typeof result === "object" && typeof (result as Promise<unknown>).then === "function") {
        return (result as Promise<unknown>).then(
          (value) => {
            record({ sqlText, method }, process.hrtime.bigint() - startNs);
            return value;
          },
          (error: unknown) => {
            record({ sqlText, method }, process.hrtime.bigint() - startNs);
            throw error;
          },
        );
      }
      record({ sqlText, method }, process.hrtime.bigint() - startNs);
      return result;
    };
  }
  pool.__paramProfileHooked = true;
  return true;
}
