/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007` §4 —— **已知 ST 标签索引**（服务侧唯一实现）。
 *
 * ## 这个模块做什么
 *
 * **一次性**读取平台已有的 ST 维度历史（`research_security_status_history`，`statusType = 'ST'`）
 * 与所需的**证券身份映射**（`research_security_identifier_history`，primary），在内存里建一个
 * 「$(symbol, 检查日) \to$ 标签读数」的**只读索引**，供研究层经桥接注入消费。
 *
 * 🔴 研究层（`research-experiments/**` 的实验作者函数）**不直连 SQL**；只有本模块读库，
 *    并且**只读**（`SELECT`；0 DDL / 0 DML / 0 migration / 0 写入）。
 *
 * ## 🔴 本轮对来源的解读边界（逐条落实目标 §4）
 *
 * - **不伪造 `availableAsOf`**：本表**没有**该列，索引**不构造**任何可获知时间。
 * - **不修改 `availability` / `confidence`**：原样保留并进入证据指纹与产物。
 * - **不把缺席派生成 `NORMAL`**：无区间覆盖 ⇒ `UNKNOWN`（`NO_STATUS_FACT`）。
 * - **不把采集时间当公告时间**：`retrievedAt` 只作留档，**不参与**判定。
 * - **边界 / 重叠无法判断 ⇒ `UNKNOWN`**（冲突区间、非法时间写法、非法状态取值）。
 * - **用该日期对应的证券身份**判定（`resolveSecurityIdByEngineKey` 的 PIT 区间匹配），
 *   **不用今天的名称**，**不用行情涨跌停字段**。
 * - 身份解析不到 ⇒ `UNKNOWN`（`IDENTITY_*`）；**绝不凭空生成 `securityId`**。
 *
 * ## 与严格契约的关系
 *
 * 本模块**不**产出 `SecurityStatusFact`（那需要 `availableAsOf`，见上），因此它
 * **不**用于严格闸门 `evaluateStGate`（严格契约 1.1.0 **保持不变**）；
 * 它是**另一个有版本的资格决策**（`recovery-known-st-only/1.0.0`）的来源。
 */

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { researchSecurityStatusHistory } from "../../drizzle/schema";
import { getDb } from "../db";
import { loadPrimaryIdentifiers } from "../runWorkbenchAssembly/datasetIdentityProvider";
import { canonicalCode, parseSecurityCode } from "../security/code";
import { resolveSecurityIdByEngineKey } from "../security/engineKeyBridge";
import type { SecurityIdentifier } from "../security/types";
import {
  type KnownStLabelFact,
  type KnownStLabelIndexPort,
  type KnownStLabelObservation,
  type KnownStLabelReason,
} from "@experiments/shared/rollingPoolRecovery";

/** 来源标识（唯一 ST 源）。 */
export const KNOWN_ST_LABEL_SOURCE_ID = "research_security_status_history#statusType=ST";

/** 本索引读取的表（留档用）。 */
export const KNOWN_ST_LABEL_TABLES_READ: readonly string[] = Object.freeze([
  "research_security_status_history",
  "research_security_identifier_history",
]);

// ---------------------------------------------------------------------------
// 时间与取值规范化（**只做字面量比较**：ST 区间是 date 精度）
// ---------------------------------------------------------------------------

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 合法日历日（`YYYY-MM-DD`）⇒ true；其它写法（含 `2024-13-45`）⇒ false。 */
function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** 状态取值 ⇒ 标签（**不可识别** ⇒ `null`，绝不猜测）。 */
function labelKindOfStatusValue(statusValue: string): "ST" | "NORMAL" | null {
  const normalized = statusValue.trim().toUpperCase().replace(/\s+/gu, "");
  if (normalized === "NORMAL" || normalized === "NON_ST" || normalized === "NONST") return "NORMAL";
  if (normalized === "ST" || normalized === "*ST" || normalized === "SST" || normalized === "S*ST") return "ST";
  return null;
}

const CONFIDENCE_RANK: Readonly<Record<string, number>> = Object.freeze({ high: 3, medium: 2, low: 1 });

// ---------------------------------------------------------------------------
// 索引构造
// ---------------------------------------------------------------------------

interface SourceInterval {
  readonly securityId: string;
  readonly statusValue: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly source: string;
  readonly confidence: string;
  readonly availability: string;
  readonly retrievedAt: string | null;
  readonly evidenceFingerprint: string;
}

/** 证据指纹：对**判决相关字段**做确定性摘要（**不含**当前时间、不含任何派生猜测）。 */
function evidenceFingerprintOf(row: {
  readonly securityId: string;
  readonly statusValue: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly source: string;
  readonly confidence: string;
  readonly availability: string;
  readonly retrievedAt: string | null;
}): string {
  const hash = createHash("sha256");
  hash.update(`known-st-label/v1\u0000${row.securityId}\u0000${row.statusValue}`);
  hash.update(`\u0000${row.effectiveFrom}\u0000${row.effectiveTo ?? "null"}`);
  hash.update(`\u0000${row.source}\u0000${row.confidence}\u0000${row.availability}`);
  hash.update(`\u0000${row.retrievedAt ?? "null"}`);
  return hash.digest("hex");
}

/** 来源指纹：全部区间行按确定性顺序摘要（同一份来源两次读取必须得到同一指纹）。 */
function sourceFingerprintOf(intervals: readonly SourceInterval[]): string {
  const hash = createHash("sha256");
  hash.update(`known-st-label-index/v1\u0000rows=${intervals.length}\n`);
  const sorted = [...intervals].sort(
    (left, right) =>
      left.securityId.localeCompare(right.securityId)
      || left.effectiveFrom.localeCompare(right.effectiveFrom)
      || left.statusValue.localeCompare(right.statusValue),
  );
  for (const interval of sorted) hash.update(`${interval.evidenceFingerprint}\n`);
  return hash.digest("hex");
}

function intervalCovers(interval: SourceInterval, checkDate: string): boolean {
  if (interval.effectiveFrom > checkDate) return false;
  return interval.effectiveTo === null || checkDate <= interval.effectiveTo;
}

/** 同一天多个覆盖区间 ⇒ 选「最新且最可信」者（与 `securityStatus/timeline.ts#pickLatest` 同序）。 */
function pickLatest(candidates: readonly SourceInterval[]): SourceInterval {
  const sorted = [...candidates].sort((left, right) => {
    if (left.effectiveFrom !== right.effectiveFrom) return left.effectiveFrom < right.effectiveFrom ? 1 : -1;
    const byConfidence = (CONFIDENCE_RANK[right.confidence] ?? 0) - (CONFIDENCE_RANK[left.confidence] ?? 0);
    if (byConfidence !== 0) return byConfidence;
    const leftRetrieved = left.retrievedAt ?? "";
    const rightRetrieved = right.retrievedAt ?? "";
    if (leftRetrieved !== rightRetrieved) return leftRetrieved < rightRetrieved ? 1 : -1;
    return left.source.localeCompare(right.source);
  });
  return sorted[0]!;
}

function factOf(interval: SourceInterval): KnownStLabelFact {
  return {
    statusValue: interval.statusValue,
    effectiveFrom: interval.effectiveFrom,
    effectiveTo: interval.effectiveTo,
    source: interval.source,
    confidence: interval.confidence,
    availability: interval.availability,
    retrievedAt: interval.retrievedAt,
    evidenceFingerprint: interval.evidenceFingerprint,
  };
}

function observationOf(args: {
  readonly symbol: string;
  readonly checkDate: string;
  readonly kind: "KNOWN_ST" | "EXPLICIT_NORMAL" | "UNKNOWN";
  readonly reason: KnownStLabelReason;
  readonly securityId: string | null;
  readonly fact?: KnownStLabelFact | null;
}): KnownStLabelObservation {
  return {
    symbol: args.symbol,
    checkDate: args.checkDate,
    kind: args.kind,
    reason: args.reason,
    securityId: args.securityId,
    fact: args.fact ?? null,
  };
}

/**
 * **一次性**载入已知 ST 标签索引。
 *
 * 🔴 只读（`SELECT`）：0 DDL / 0 DML / 0 migration / 0 写入。
 * 🔴 平台**没有**可 PIT 核验的逐日状态（006 §2 实测）⇒ 本索引是**历史标签排查**，
 *    **不是**严格 PIT provider；调用方必须显式声明这是探索性政策。
 */
export async function loadKnownStLabelIndex(): Promise<KnownStLabelIndexPort> {
  const db = await getDb();
  const identifiers: readonly SecurityIdentifier[] = await loadPrimaryIdentifiers();

  const stRows = db === null
    ? []
    : await db
      .select({
        securityId: researchSecurityStatusHistory.securityId,
        statusValue: researchSecurityStatusHistory.statusValue,
        effectiveFrom: researchSecurityStatusHistory.effectiveFrom,
        effectiveTo: researchSecurityStatusHistory.effectiveTo,
        source: researchSecurityStatusHistory.source,
        retrievedAt: researchSecurityStatusHistory.retrievedAt,
        confidence: researchSecurityStatusHistory.confidence,
        availability: researchSecurityStatusHistory.availability,
      })
      .from(researchSecurityStatusHistory)
      .where(eq(researchSecurityStatusHistory.statusType, "ST"));

  const intervals: SourceInterval[] = stRows.map((row) => ({
    securityId: row.securityId,
    statusValue: row.statusValue,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    source: row.source,
    confidence: row.confidence,
    availability: row.availability,
    retrievedAt: toIsoOrNull(row.retrievedAt),
    evidenceFingerprint: evidenceFingerprintOf({
      securityId: row.securityId,
      statusValue: row.statusValue,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      source: row.source,
      confidence: row.confidence,
      availability: row.availability,
      retrievedAt: toIsoOrNull(row.retrievedAt),
    }),
  }));

  // 身份索引：engineKey ⇒ 该代码的全部身份区间（PIT 匹配交给唯一实现）。
  const byEngineKey = new Map<string, SecurityIdentifier[]>();
  for (const identifier of identifiers) {
    let engineKey: string;
    try {
      engineKey = canonicalCode({ digits: identifier.code, exchange: identifier.exchange });
    } catch {
      continue;
    }
    const list = byEngineKey.get(engineKey);
    if (list === undefined) byEngineKey.set(engineKey, [identifier]);
    else list.push(identifier);
  }

  const bySecurityId = new Map<string, SourceInterval[]>();
  for (const interval of intervals) {
    const list = bySecurityId.get(interval.securityId);
    if (list === undefined) bySecurityId.set(interval.securityId, [interval]);
    else list.push(interval);
  }

  const availabilityCounts: Record<string, number> = {};
  const confidenceCounts: Record<string, number> = {};
  let explicitNormalRowCount = 0;
  for (const interval of intervals) {
    availabilityCounts[interval.availability] = (availabilityCounts[interval.availability] ?? 0) + 1;
    confidenceCounts[interval.confidence] = (confidenceCounts[interval.confidence] ?? 0) + 1;
    if (labelKindOfStatusValue(interval.statusValue) === "NORMAL") explicitNormalRowCount += 1;
  }

  const lookup = (input: {
    readonly symbol: string;
    readonly checkDate: string;
  }): KnownStLabelObservation => {
    const { symbol, checkDate } = input;
    if (!isValidDateOnly(checkDate)) {
      return observationOf({
        symbol, checkDate, kind: "UNKNOWN", reason: "INVALID_CHECK_DATE", securityId: null,
      });
    }
    let engineKey: string;
    try {
      engineKey = canonicalCode(parseSecurityCode(symbol));
    } catch {
      return observationOf({
        symbol, checkDate, kind: "UNKNOWN", reason: "IDENTITY_UNPARSEABLE", securityId: null,
      });
    }
    const segments = byEngineKey.get(engineKey);
    if (segments === undefined) {
      return observationOf({
        symbol, checkDate, kind: "UNKNOWN", reason: "IDENTITY_UNRESOLVED", securityId: null,
      });
    }
    const resolved = resolveSecurityIdByEngineKey(segments, engineKey, checkDate);
    if (!resolved.ok) {
      return observationOf({
        symbol,
        checkDate,
        kind: "UNKNOWN",
        reason: resolved.reason === "AMBIGUOUS" ? "IDENTITY_AMBIGUOUS" : "IDENTITY_UNRESOLVED",
        securityId: null,
      });
    }
    const covering = (bySecurityId.get(resolved.securityId) ?? []).filter((interval) =>
      intervalCovers(interval, checkDate),
    );
    if (covering.length === 0) {
      // 🔴 缺席 ≠ NORMAL：平台 ST 维度**没有** NORMAL 行 ⇒ 无覆盖只能是「无结论」。
      return observationOf({
        symbol, checkDate, kind: "UNKNOWN", reason: "NO_STATUS_FACT", securityId: resolved.securityId,
      });
    }
    // 任一时间写法不可识别 / 非法日历日 ⇒ 不可判断（不得靠字典序恰好落在区间内）。
    const invalid = covering.find(
      (interval) =>
        !isValidDateOnly(interval.effectiveFrom)
        || (interval.effectiveTo !== null && !isValidDateOnly(interval.effectiveTo)),
    );
    if (invalid !== undefined) {
      return observationOf({
        symbol,
        checkDate,
        kind: "UNKNOWN",
        reason: "INVALID_INTERVAL_TIME_FORMAT",
        securityId: resolved.securityId,
        fact: factOf(invalid),
      });
    }
    const kinds = new Set(covering.map((interval) => labelKindOfStatusValue(interval.statusValue)));
    if (kinds.has(null)) {
      const unknown = covering.find((interval) => labelKindOfStatusValue(interval.statusValue) === null)!;
      return observationOf({
        symbol,
        checkDate,
        kind: "UNKNOWN",
        reason: "UNRECOGNIZED_STATUS_VALUE",
        securityId: resolved.securityId,
        fact: factOf(unknown),
      });
    }
    if (kinds.size > 1) {
      // 同一天既 ST 又 NORMAL ⇒ 边界/重叠无法判断 ⇒ UNKNOWN（目标 §4）。
      return observationOf({
        symbol,
        checkDate,
        kind: "UNKNOWN",
        reason: "CONFLICTING_INTERVALS_UNDECIDABLE",
        securityId: resolved.securityId,
        fact: factOf(pickLatest(covering)),
      });
    }
    const chosen = pickLatest(covering);
    const kind = labelKindOfStatusValue(chosen.statusValue);
    return observationOf({
      symbol,
      checkDate,
      kind: kind === "ST" ? "KNOWN_ST" : "EXPLICIT_NORMAL",
      reason: kind === "ST"
        ? "KNOWN_ST_INTERVAL_COVERS_CHECK_DATE"
        : "EXPLICIT_NORMAL_INTERVAL_COVERS_CHECK_DATE",
      securityId: resolved.securityId,
      fact: factOf(chosen),
    });
  };

  return Object.freeze({
    sourceId: KNOWN_ST_LABEL_SOURCE_ID,
    sourceFingerprint: sourceFingerprintOf(intervals),
    rowCount: intervals.length,
    securityCount: bySecurityId.size,
    identifierRowCount: identifiers.length,
    availabilityCounts: Object.freeze(availabilityCounts),
    confidenceCounts: Object.freeze(confidenceCounts),
    explicitNormalRowCount,
    tablesRead: KNOWN_ST_LABEL_TABLES_READ,
    lookup,
  } satisfies KnownStLabelIndexPort);
}
