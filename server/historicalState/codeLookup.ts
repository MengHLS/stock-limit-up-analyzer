/**
 * FE-2 — 代码 → 候选证券 解析（UI 支持，非 STEP 12.5 领域语义）。
 *
 * 定位：`historicalState.asOf` 以永久身份 securityId（sec_<uuid>）为键，但用户只会输入
 * 6 位代码（如 600000 或 600000.SH）。本模块负责：
 *   1. `parseCodeQuery`（纯函数）：把用户输入解析为 (digits, exchange) 或可读错误；
 *   2. `lookupSecuritiesByCode`（DB）：在 identifier history × security master 上按代码检索候选。
 *
 * 纪律：
 * - **代码可复用**：同一 6 位代码在不同历史时段可能属于不同证券，故返回**候选集**而非单一结果；
 * - **诚实空值**：DB 不可用 / 超时 → 返回 error 说明，不返回空数组冒充「查无此代码」；
 * - **超时兜底**：TiDB 回填期间可能被占满（RU），检索必须带超时（与 dataHealth.liveCounts 同纪律）。
 */

import { and, asc, eq } from "drizzle-orm";
import {
  researchSecurities,
  researchSecurityIdentifierHistory,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { CodeCandidate, CodeExchange } from "../../shared/researchContracts";

/** 解析用户输入 → (digits, exchange)。输入示例：600000 / 600000.SH / 000001.sz。 */
export function parseCodeQuery(
  raw: string,
): { digits: string | null; exchange: CodeExchange | null; error: string | null } {
  const q = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!q) return { digits: null, exchange: null, error: "查询为空" };
  const m = q.match(/^(\d{6})(?:\.(SH|SZ|BJ))?$/);
  if (!m) {
    return {
      digits: null,
      exchange: null,
      error: `无法解析「${raw}」：须为 6 位数字代码（可带 .SH/.SZ/.BJ 后缀，如 600000 或 600000.SH）`,
    };
  }
  return { digits: m[1], exchange: (m[2] ?? null) as CodeExchange | null, error: null };
}

/** 单次检索默认超时（TiDB 回填期间可能被占满 RU）。 */
export const CODE_LOOKUP_TIMEOUT_MS = 15_000;

export type CodeLookupOptions = {
  digits: string;
  exchange: CodeExchange | null;
  limit?: number;
};

export type CodeLookupResult = {
  candidates: CodeCandidate[];
  /** null = 正常返回（可能零候选）；非空 = DB 不可用/超时/失败。 */
  error: string | null;
};

/**
 * 按 6 位代码检索候选证券（identifier history JOIN securities master）。
 * 同一证券多行标识符区间在内存中归并为一条候选（primary 优先、取 effectiveFrom 最大者）。
 */
export async function lookupSecuritiesByCode(
  opts: CodeLookupOptions,
): Promise<CodeLookupResult> {
  const limit = Math.min(opts.limit ?? 20, 50);
  const db = await getDb();
  if (!db) {
    return { candidates: [], error: "DATABASE_URL 未配置或数据库连接不可用" };
  }

  const conds = [eq(researchSecurityIdentifierHistory.securityCode, opts.digits)];
  if (opts.exchange) {
    conds.push(eq(researchSecurityIdentifierHistory.exchange, opts.exchange));
  }

  const started = Date.now();
  try {
    const rows = await Promise.race([
      db
        .select({
          securityId: researchSecurityIdentifierHistory.securityId,
          securityType: researchSecurities.securityType,
          exchange: researchSecurityIdentifierHistory.exchange,
          status: researchSecurities.status,
          listedDate: researchSecurities.listedDate,
          delistedDate: researchSecurities.delistedDate,
          securityCode: researchSecurityIdentifierHistory.securityCode,
          identifierType: researchSecurityIdentifierHistory.identifierType,
          effectiveFrom: researchSecurityIdentifierHistory.effectiveFrom,
          effectiveTo: researchSecurityIdentifierHistory.effectiveTo,
        })
        .from(researchSecurityIdentifierHistory)
        .innerJoin(
          researchSecurities,
          eq(researchSecurities.securityId, researchSecurityIdentifierHistory.securityId),
        )
        .where(and(...conds))
        .orderBy(
          asc(researchSecurityIdentifierHistory.securityId),
          asc(researchSecurityIdentifierHistory.effectiveFrom),
        )
        .limit(limit * 5), // 归并后可能少于 limit，多取若干行防截断
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), CODE_LOOKUP_TIMEOUT_MS),
      ),
    ]);

    if (rows === null) {
      return {
        candidates: [],
        error: `代码检索超时（>${CODE_LOOKUP_TIMEOUT_MS / 1000}s）——TiDB 可能正被回填任务占满，请稍后再试`,
      };
    }

    // 按 securityId 归并：primary 标识符优先，其次取 effectiveFrom 更大者
    const betterId = (
      a: { identifierType: string; effectiveFrom: string } | null,
      b: { identifierType: string; effectiveFrom: string } | null,
    ) => {
      if (!b) return true;
      const aP = a?.identifierType === "primary" ? 1 : 0;
      const bP = b.identifierType === "primary" ? 1 : 0;
      if (aP !== bP) return aP > bP;
      return (a?.effectiveFrom ?? "") > b.effectiveFrom;
    };

    const bySecurity = new Map<string, CodeCandidate & { _idCount: number }>();
    for (const r of rows) {
      const key = r.securityId;
      let entry = bySecurity.get(key);
      if (!entry) {
        entry = {
          securityId: r.securityId,
          securityType: r.securityType,
          exchange: r.exchange,
          status: r.status,
          listedDate: r.listedDate,
          delistedDate: r.delistedDate,
          identifier: null,
          identifierCount: 0,
          _idCount: 0,
        };
        bySecurity.set(key, entry);
      }
      entry._idCount += 1;
      const candidate = {
        securityCode: r.securityCode,
        identifierType: r.identifierType,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
      };
      if (betterId(candidate, entry.identifier)) entry.identifier = candidate;
    }

    const candidates: CodeCandidate[] = Array.from(bySecurity.values())
      .map(({ _idCount, ...c }) => ({ ...c, identifierCount: _idCount }))
      .slice(0, limit);

    return { candidates, error: null };
  } catch (e) {
    return {
      candidates: [],
      error: `代码检索失败：${(e as Error).message}（${Date.now() - started}ms）`,
    };
  }
}
