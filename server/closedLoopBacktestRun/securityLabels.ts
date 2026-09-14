/**
 * 成交明细「证券名称 + 代码」解析。
 *
 * 背景（2026-09-14 真实库实查，非推断）：
 *   - 闭环回测结果 `trades[].securityId` 是 Research canonical identity **`sec_<uuid>`**，
 *     **不是** 6 位股票代码 —— 直接印进表格用户看不懂（如 `sec_d93df65f-fede-4788-…`）；
 *   - 真实库 60 张表里**没有证券名称主数据表**：`research_securities` 不含 name
 *     （schema 注释明确「name history 与 identifier history 严格独立」），唯一承载
 *     股票名称的列是 `limit_up_records.stockName`。
 *
 * 因此解析是**两步**，且两步都走既有实现、不另造一套：
 *   1. `sec_<uuid>` → 6 位代码：读 `research_security_identifier_history` 的 primary
 *      标识。这条桥的语义与既有 `server/security/engineKeyBridge.ts` 一致（该模块只做
 *      纯函数解析、由调用方提供 history 行），本模块负责取数；
 *   2. 代码 → 名称：`limit_up_records`，复用既有纯函数
 *      `buildLatestStockNameMap`（`shared/stockDataNormalization.ts`）—— 它本就是为
 *      「同一代码 OCR 名称漂移，取最近一次非空名称」而写的。
 *
 * 🔴 覆盖率**不是** 100%，这是数据现实而非实现缺陷：`limit_up_records` 只收录有过涨停
 *    记录的股票（实测 4,324 个 distinct code），而回测 universe 是全市场（5,552 只）
 *    ⇒ 实测 251 个成交代码中 158 个能取到名称。取不到一律返回 `null`，前端显示「—」：
 *    **绝不用代码冒充名称，也绝不猜**。
 */

import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { limitUpRecords, researchSecurityIdentifierHistory } from "../../drizzle/schema";
import { isValidDigits, normalizeSecurityCode } from "../security/code";
import { buildLatestStockNameMap } from "../../shared/stockDataNormalization";

/** 单个证券的展示标签（名称可为空 —— 那是如实的数据缺口）。 */
export type SecurityLabel = {
  securityId: string;
  /** canonical 代码（`6位数字.交易所`，如 `603269.SH`）；无 primary 标识 → null。 */
  code: string | null;
  /** 股票名称（如 `海鸥股份`）；名称源里没有该代码 → null。 */
  name: string | null;
  /** 交易所（SH / SZ / BJ）；无标识 → null。 */
  exchange: string | null;
};

/** identifier history 行的最小投影（仅 primary 标识参与解析）。 */
export type SecurityIdentifierRow = {
  securityId: string;
  exchange: string;
  /** 6 位数字代码（不含交易所后缀）。 */
  code: string;
  identifierType: string;
};

/** 名称源行的最小投影（`limit_up_records` 子集）。 */
export type StockNameRecordRow = {
  stockCode: string;
  stockName: string;
  limitUpDate: string;
  limitUpTime: string | null;
};

/** 单次解析的 securityId 上限（与契约 `securityLabelsInputSchema` 保持一致）。 */
export const SECURITY_LABEL_MAX_IDS = 500;

/**
 * 纯函数：把「标识行 + 名称行」拼成按 `securityIds` 顺序排列的标签数组。
 *
 * 无 DB 依赖、不抛错；任一环节缺失一律降级为 `null` 字段（**不做任何猜测**）。
 * 抽成纯函数是为了能用单测钉住口径，而不用起库。
 */
export function buildSecurityLabels(
  securityIds: readonly string[],
  identifiers: readonly SecurityIdentifierRow[],
  nameRecords: readonly StockNameRecordRow[],
): SecurityLabel[] {
  // 只用 primary 标识建索引；同一 securityId 出现多条时保留**第一条**（实测
  // research_security_identifier_history 每 id 恰一条 primary，无 code reuse）。
  const primaryByIdentity = new Map<string, { code: string; exchange: string }>();
  for (const row of identifiers) {
    if (row.identifierType !== "primary") continue;
    if (!isValidDigits(row.code)) continue;
    if (primaryByIdentity.has(row.securityId)) continue;
    primaryByIdentity.set(row.securityId, { code: row.code, exchange: row.exchange });
  }

  // 复用既有纯函数：同代码取最近一次非空名称。
  const nameByCode = buildLatestStockNameMap(
    nameRecords.map((row) => ({
      stockCode: row.stockCode,
      stockName: row.stockName,
      limitUpDate: row.limitUpDate,
      limitUpTime: row.limitUpTime,
    })),
  );

  return securityIds.map((securityId) => {
    const primary = primaryByIdentity.get(securityId);
    if (!primary) {
      return { securityId, code: null, name: null, exchange: null };
    }
    let code: string | null = null;
    try {
      // 🔴 走 `normalizeSecurityCode`（= parseSecurityCode 的带后缀路径）而非直接拼接：
      // 它会校验「6 位前缀推断的交易所」与 history 的 exchange 是否一致，冲突即抛错
      // ⇒ 宁可置 null 也**不产出一个错误的 canonical 代码**（错代码会顺带查错名称）。
      code = normalizeSecurityCode(`${primary.code}.${primary.exchange}`);
    } catch {
      code = null;
    }
    const name = code === null ? null : nameByCode.get(code) ?? null;
    return { securityId, code, name, exchange: primary.exchange };
  });
}

/** 去重并保持首次出现顺序（避免重复 id 触发无谓的重复查询）。 */
function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * 取数并解析：`sec_<uuid>` 列表 → 标签列表（顺序与入参一致，含未命中的占位项）。
 *
 * 无 DB → 抛错。名称属**展示增强**：调用方（前端 hook）查询失败时降级为「不显示名称」，
 * 不影响回测结果主体 —— 但绝不在服务端把「查不到」伪装成「没有名称」。
 */
export async function loadSecurityLabels(
  securityIds: readonly string[],
): Promise<SecurityLabel[]> {
  const ids = dedupe(securityIds).slice(0, SECURITY_LABEL_MAX_IDS);
  if (ids.length === 0) return [];

  const db = await getDb();
  if (!db) {
    throw new Error("数据库不可用，无法解析证券名称");
  }

  const identifierRows = (await db
    .select({
      securityId: researchSecurityIdentifierHistory.securityId,
      exchange: researchSecurityIdentifierHistory.exchange,
      code: researchSecurityIdentifierHistory.securityCode,
      identifierType: researchSecurityIdentifierHistory.identifierType,
    })
    .from(researchSecurityIdentifierHistory)
    .where(inArray(researchSecurityIdentifierHistory.securityId, ids))) as SecurityIdentifierRow[];

  // 先算出代码，再**只**按这些代码去名称源取数 —— 不整表扫 9.9 万行。
  const identityToCode = new Map<string, string>();
  for (const row of identifierRows) {
    if (row.identifierType !== "primary" || !isValidDigits(row.code)) continue;
    if (identityToCode.has(row.securityId)) continue;
    try {
      identityToCode.set(
        row.securityId,
        normalizeSecurityCode(`${row.code}.${row.exchange}`),
      );
    } catch {
      // 冲突输入：跳过，最终该 id 名称为 null。
    }
  }
  const codes = Array.from(new Set(identityToCode.values()));
  if (codes.length === 0) {
    return buildSecurityLabels(ids, identifierRows, []);
  }

  const nameRows = (await db
    .select({
      stockCode: limitUpRecords.stockCode,
      stockName: limitUpRecords.stockName,
      limitUpDate: limitUpRecords.limitUpDate,
      limitUpTime: limitUpRecords.limitUpTime,
    })
    .from(limitUpRecords)
    .where(inArray(limitUpRecords.stockCode, codes))) as StockNameRecordRow[];

  return buildSecurityLabels(ids, identifierRows, nameRows);
}
