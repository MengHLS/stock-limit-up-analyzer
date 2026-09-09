/**
 * STEP 12 — Engine Compatibility Key Bridge（GAP-ENG-KEY）。
 *
 * 背景：Research canonical identity 是 `sec_<uuid>`（research_securities.securityId），
 * 而 DB HistoricalBarStore / 回测引擎的键是引擎兼容键 `stockCode`（如 600000.SH，
 * 见 server/backtest/dbBarStore.ts：`Security.securityId 字段当前装的是自然键 stockCode`）。
 * 两者不是字段重命名，而是不同 key-space —— 必须经 Identifier History 做显式桥接。
 *
 * 本模块实现双向确定性桥接（纯函数，PIT-safe，asOf-aware）：
 *   1. resolveEngineKeyAt(history, securityId, asOf)
 *        研究 canonical identity → 引擎兼容键（stockCode）
 *   2. resolveSecurityIdByEngineKey(history, engineKey, asOf)
 *        引擎兼容键（stockCode）→ canonical securityId
 *
 * 约束（对齐契约 §3 Identifier History / §2 Security Identity）：
 *   - 同一 code 可在不同（非重叠）历史区间对应不同 security_id（code reuse）；
 *     解析必须带 asOf，禁止返回"当前"猜测。
 *   - 若在 asOf 找不到任何生效区间 → 拒绝（返回 null 结构，绝不猜测）。
 *   - 若在 asOf 出现多个重叠匹配（identifier history 数据错误）→ 抛错，不静默取第一个。
 *   - engineKey 必须是 canonical stockCode（`6位数字.交易所`），解析失败即抛错。
 *
 * 注意：本模块只做「解析」，不绑定任何引擎；把解析结果接入 DbBarStore /
 * research pipeline 需在真实 identifier history 数据回填后（DATA-PENDING）进行。
 */

import { parseSecurityCode, canonicalCode } from "./code";
import { intervalContains } from "./identifierHistory";
import type { Exchange, SecurityIdentifier } from "./types";

/** as-of 解析成功结果。 */
export interface EngineKeyResolution {
  ok: true;
  /** canonical security_id（sec_<uuid>）。 */
  securityId: string;
  /** 引擎兼容键（canonical stockCode，如 600000.SH）。 */
  engineKey: string;
  /** 6 位数字代码（primary identifier 在 asOf 生效的代码）。 */
  code: string;
  exchange: Exchange;
  /** 解析基准日。 */
  asOf: string;
}

/** as-of 解析失败原因（显式区分，不静默 fallback）。 */
export type EngineKeyFailure =
  | { ok: false; reason: "NO_IDENTIFIER" }
  | { ok: false; reason: "AMBIGUOUS"; matches: number };

export type EngineKeyLookup = EngineKeyResolution | EngineKeyFailure;
/**
 * canonical security_id → 引擎兼容键（stockCode），asOf-aware。
 * - 无生效区间 → NO_IDENTIFIER
 * - 同 securityId 在 asOf 有多个生效 primary 区间（数据错误）→ AMBIGUOUS
 */
export function resolveEngineKeyAt(
  history: readonly SecurityIdentifier[],
  securityId: string,
  asOf: string,
): EngineKeyLookup {
  const matches = history.filter(
    (identifier) =>
      identifier.securityId === securityId &&
      identifier.identifierType === "primary" &&
      intervalContains(identifier.effectiveFrom, identifier.effectiveTo, asOf),
  );
  if (matches.length === 0) return { ok: false, reason: "NO_IDENTIFIER" };
  if (matches.length > 1) return { ok: false, reason: "AMBIGUOUS", matches: matches.length };
  const identifier = matches[0]!;
  const engineKey = canonicalCode({ digits: identifier.code, exchange: identifier.exchange });
  return {
    ok: true,
    securityId,
    engineKey,
    code: identifier.code,
    exchange: identifier.exchange,
    asOf,
  };
}

/**
 * 引擎兼容键（stockCode，如 600000.SH / 000001.SZ）→ canonical security_id，asOf-aware。
 * 同一 code 在不同区间被不同 security 复用（code reuse）时，asOf 落在哪个区间就解析到谁。
 * - engineKey 非法 → 抛错（不静默猜测）。
 * - 无生效区间 → NO_IDENTIFIER
 * - 多行指向不同 security_id（数据错误）→ AMBIGUOUS
 */
export function resolveSecurityIdByEngineKey(
  history: readonly SecurityIdentifier[],
  engineKey: string,
  asOf: string,
): EngineKeyLookup {
  const parsed = parseSecurityCode(engineKey);
  const matches = history.filter(
    (identifier) =>
      identifier.exchange === parsed.exchange &&
      identifier.code === parsed.digits &&
      intervalContains(identifier.effectiveFrom, identifier.effectiveTo, asOf),
  );
  if (matches.length === 0) return { ok: false, reason: "NO_IDENTIFIER" };
  const securityIds = Array.from(new Set(matches.map((identifier) => identifier.securityId)));
  if (securityIds.length > 1) {
    return { ok: false, reason: "AMBIGUOUS", matches: matches.length };
  }
  const securityId = securityIds[0]!;
  return { ok: true, securityId, engineKey: canonicalCode(parsed), code: parsed.digits, exchange: parsed.exchange, asOf };
}
