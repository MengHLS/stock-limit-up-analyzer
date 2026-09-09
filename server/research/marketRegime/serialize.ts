/**
 * STEP 22 / C-22.1 — Market Regime：序列化 / 指纹 / 校验（纯函数、确定性）。
 *
 * 铁律（对齐 researchDataset/version.ts 的 canonical 范式）：
 *   - 指纹与序列化使用按键字典序排序的 canonical JSON（canonicalStringify，
 *     import 自 server/researchDataset/version.ts，**只读复用**不重写）；
 *   - 任何 NaN / Infinity 在进入指纹前直接抛错（绝不静默转 null）；
 *   - fingerprint = sha256（除 fingerprint 字段外全部字段的 canonical JSON 摘要）；
 *   - deserialize：JSON → 结构校验 → 指纹复核，防篡改 / 防字段退化；
 *   - **PIT 不变量进校验**：每条标签 asOf 必须 === tradeDate（冻结快照面板行会
 *     被拒，防止「用今天的知识给历史贴标签」的记录流入研究链路）。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { resolveRegimeConfigSet } from "./config";
import { RegimeAnalysisError, assertRegimeFiniteRecord } from "./errors";
import { REGIME_ISO_DATE_RE } from "./dates";
import {
  MARKET_REGIME_RUN_RECORD_KIND,
  MARKET_REGIME_RUN_RECORD_VERSION,
  REGIME_DIMENSION_IDS,
  REGIME_LABEL_SETS,
  isRegimeUnassessedReasonCode,
} from "./types";
import type {
  MarketRegimeRun,
  RegimeAnyDimensionTag,
  RegimeDayTags,
  RegimeDimensionId,
  RegimeUnassessedStats,
} from "./types";

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

/** 标签序列指纹（sha256；覆盖 tags 全体，防标签序列被篡改）。 */
export function computeRegimeTagSequenceFingerprint(tags: readonly RegimeDayTags[]): string {
  assertRegimeFiniteRecord(tags, "tags");
  return createHash("sha256").update(canonicalStringify(tags), "utf8").digest("hex");
}

/** Run 内容指纹：除 fingerprint 字段外全部字段的 canonical JSON 摘要。 */
export function computeMarketRegimeRunFingerprint(
  run: Omit<MarketRegimeRun, "fingerprint"> | MarketRegimeRun,
): string {
  assertRegimeFiniteRecord(run, "run");
  const body: Record<string, unknown> = { ...(run as Record<string, unknown>) };
  delete body.fingerprint;
  return createHash("sha256").update(canonicalStringify(body), "utf8").digest("hex");
}

/** 序列化 Run（canonical JSON；拒绝 NaN/Infinity；同内容必同串）。 */
export function serializeMarketRegimeRun(run: MarketRegimeRun): string {
  assertRegimeFiniteRecord(run, "run");
  return canonicalStringify(run);
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/** 校验问题（确定性列表，按检查顺序）。 */
export interface RegimeValidationIssue {
  readonly code: string;
  readonly message: string;
}

function issue(code: string, message: string): RegimeValidationIssue {
  return { code, message };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function checkDate(value: unknown, label: string, issues: RegimeValidationIssue[]): void {
  if (typeof value !== "string" || !REGIME_ISO_DATE_RE.test(value)) {
    issues.push(issue("REGIME_INVALID_DATE", `${label} 必须是 YYYY-MM-DD 字符串，实际 ${String(value)}`));
  }
}

/** 统计标签序列的 unassessed 分布（校验与 Run 构建共用，单一实现）。 */
export function computeRegimeUnassessedStats(tags: readonly RegimeDayTags[]): RegimeUnassessedStats {
  const byDimension: Record<string, number> = {};
  for (const dimension of REGIME_DIMENSION_IDS) byDimension[dimension] = 0;
  const byReasonCode: Record<string, number> = {};
  let totalUnassessedCount = 0;
  let totalTagCount = 0;
  for (const day of tags) {
    for (const dimension of REGIME_DIMENSION_IDS) {
      const tag = day[dimension] as RegimeAnyDimensionTag;
      totalTagCount += 1;
      if (tag.kind === "unassessed") {
        totalUnassessedCount += 1;
        byDimension[dimension] = (byDimension[dimension] ?? 0) + 1;
        byReasonCode[tag.reasonCode] = (byReasonCode[tag.reasonCode] ?? 0) + 1;
      }
    }
  }
  return {
    totalTagCount,
    totalUnassessedCount,
    byDimension: byDimension as RegimeUnassessedStats["byDimension"],
    byReasonCode,
  };
}

/** 校验单条维度标签。 */
function checkDimensionTag(
  tag: unknown,
  dimension: RegimeDimensionId,
  tradeDate: string,
  path: string,
  issues: RegimeValidationIssue[],
): void {
  if (tag === null || typeof tag !== "object") {
    issues.push(issue("REGIME_TAG_INVALID", `${path} 缺失或非对象`));
    return;
  }
  const value = tag as Record<string, unknown>;
  if (value.dimension !== dimension) {
    issues.push(
      issue("REGIME_TAG_DIMENSION_MISMATCH", `${path}.dimension=${String(value.dimension)} 与键 ${dimension} 不一致`),
    );
  }
  if (value.tradeDate !== tradeDate) {
    issues.push(issue("REGIME_TAG_DATE_MISMATCH", `${path}.tradeDate=${String(value.tradeDate)} 与所在日 ${tradeDate} 不一致`));
  }
  // PIT 不变量：asOf 必须 === tradeDate
  if (value.asOf !== tradeDate) {
    issues.push(
      issue(
        "REGIME_ASOF_INVARIANT_VIOLATION",
        `${path}.asOf=${String(value.asOf)} != tradeDate=${tradeDate}（逐日 PIT 不变量）`,
      ),
    );
  }
  if (value.kind === "assessed") {
    const label = value.label;
    if (typeof label !== "string" || !REGIME_LABEL_SETS[dimension].includes(label)) {
      issues.push(
        issue("REGIME_LABEL_INVALID", `${path}.label=${String(label)} 不属于 ${dimension} 值域 [${REGIME_LABEL_SETS[dimension].join(", ")}]`),
      );
    }
    if (!Number.isInteger(value.sampleSize) || (value.sampleSize as number) < 0) {
      issues.push(issue("REGIME_SAMPLE_SIZE_INVALID", `${path}.sampleSize 必须是 >= 0 的整数`));
    }
    return;
  }
  if (value.kind === "unassessed") {
    const reasonCode = value.reasonCode;
    if (typeof reasonCode !== "string" || !isRegimeUnassessedReasonCode(reasonCode)) {
      issues.push(issue("REGIME_REASON_CODE_INVALID", `${path}.reasonCode=${String(reasonCode)} 不是合法机器码`));
    }
    if (!isNonEmptyString(value.reason)) {
      issues.push(issue("REGIME_REASON_EMPTY", `${path}.reason 必须是非空字符串（未评估必须说明原因）`));
    }
    return;
  }
  issues.push(issue("REGIME_TAG_KIND_INVALID", `${path}.kind=${String(value.kind)} 必须是 assessed | unassessed`));
}

/** 结构化校验 Run（返回问题列表；空数组 = 通过）。 */
export function validateMarketRegimeRun(record: unknown): readonly RegimeValidationIssue[] {
  const issues: RegimeValidationIssue[] = [];
  if (record === null || typeof record !== "object") {
    return [issue("REGIME_RECORD_INVALID", "记录缺失或非对象")];
  }
  const run = record as Record<string, unknown>;

  if (run.recordKind !== MARKET_REGIME_RUN_RECORD_KIND) {
    issues.push(issue("REGIME_KIND_INVALID", `recordKind=${String(run.recordKind)} 必须为 ${MARKET_REGIME_RUN_RECORD_KIND}`));
  }
  if (run.recordVersion !== MARKET_REGIME_RUN_RECORD_VERSION) {
    issues.push(issue("REGIME_VERSION_INVALID", `recordVersion=${String(run.recordVersion)} 必须为 ${String(MARKET_REGIME_RUN_RECORD_VERSION)}`));
  }
  if (!isNonEmptyString(run.regimeRunId)) {
    issues.push(issue("REGIME_RUN_ID_EMPTY", "regimeRunId 必须是非空字符串（调用方注入，禁止空值冒充身份）"));
  }
  if (run.datasetVersion !== null && !isNonEmptyString(run.datasetVersion)) {
    issues.push(issue("REGIME_DATASET_VERSION_INVALID", "datasetVersion 必须是 null 或非空字符串"));
  }
  if (!isNonEmptyString(run.benchmarkIndexCode)) {
    issues.push(issue("REGIME_BENCHMARK_EMPTY", "benchmarkIndexCode 必须是非空字符串"));
  }
  if (!isNonEmptyString(run.createdAt)) {
    issues.push(issue("REGIME_CREATED_AT_EMPTY", "createdAt 必须是非空 ISO 字符串（调用方注入）"));
  }

  // -- 配置：重新解析并与记录值比对（catch 非法阈值 / 字段漂移）--
  try {
    const resolved = resolveRegimeConfigSet(run.configs as never);
    if (canonicalStringify(resolved) !== canonicalStringify(run.configs)) {
      issues.push(
        issue("REGIME_CONFIGS_NOT_RESOLVED", "configs 与解析结果不一致（含非法阈值或多余/缺失字段）"),
      );
    }
  } catch (error) {
    issues.push(issue("REGIME_CONFIGS_INVALID", `configs 非法：${(error as Error).message}`));
  }

  // -- tags --
  const tags = run.tags;
  if (!Array.isArray(tags)) {
    issues.push(issue("REGIME_TAGS_INVALID", "tags 必须是数组"));
    return issues;
  }
  tags.forEach((day, index) => {
    const path = `tags[${index}]`;
    if (day === null || typeof day !== "object") {
      issues.push(issue("REGIME_TAG_DAY_INVALID", `${path} 缺失或非对象`));
      return;
    }
    const value = day as Record<string, unknown>;
    const tradeDate = value.tradeDate;
    if (typeof tradeDate !== "string") {
      issues.push(issue("REGIME_TAG_DAY_INVALID", `${path}.tradeDate 缺失`));
      return;
    }
    checkDate(tradeDate, `${path}.tradeDate`, issues);
    if (value.asOf !== tradeDate) {
      issues.push(issue("REGIME_ASOF_INVARIANT_VIOLATION", `${path}.asOf != tradeDate（逐日 PIT 不变量）`));
    }
    if (index > 0) {
      const previous = (tags[index - 1] as Record<string, unknown>).tradeDate;
      if (typeof previous === "string" && previous >= tradeDate) {
        issues.push(issue("REGIME_SERIES_NOT_ORDERED", `${path}.tradeDate=${tradeDate} 未严格晚于前一日 ${previous}`));
      }
    }
    for (const dimension of REGIME_DIMENSION_IDS) {
      checkDimensionTag(value[dimension], dimension, tradeDate, `${path}.${dimension}`, issues);
    }
    const composite = value.composite as Record<string, unknown> | null | undefined;
    if (composite !== null && composite !== undefined) {
      if (typeof composite.compositeKey !== "string" || composite.compositeKey.length === 0) {
        issues.push(issue("REGIME_COMPOSITE_KEY_EMPTY", `${path}.composite.compositeKey 必须是非空字符串`));
      }
      if (!Array.isArray(composite.dimensionOrder)) {
        issues.push(issue("REGIME_COMPOSITE_ORDER_INVALID", `${path}.composite.dimensionOrder 必须是数组`));
      }
      const assessed = composite.assessedDimensionCount;
      const unassessed = composite.unassessedDimensionCount;
      if (typeof assessed !== "number" || typeof unassessed !== "number" || assessed + unassessed !== 7) {
        issues.push(issue("REGIME_COMPOSITE_COUNT_INVALID", `${path}.composite 已评估+未评估维度数必须 = 7`));
      }
    }
  });

  // -- coverage --
  const coverage = run.coverage as Record<string, unknown> | undefined;
  if (coverage === null || typeof coverage !== "object") {
    issues.push(issue("REGIME_COVERAGE_INVALID", "coverage 缺失或非对象"));
  } else {
    if (tags.length === 0) {
      if (coverage.startDate !== null || coverage.endDate !== null) {
        issues.push(issue("REGIME_COVERAGE_INVALID", "tags 为空时 coverage.startDate/endDate 必须为 null"));
      }
    } else {
      const first = (tags[0] as Record<string, unknown>).tradeDate;
      const last = (tags[tags.length - 1] as Record<string, unknown>).tradeDate;
      if (coverage.startDate !== first || coverage.endDate !== last) {
        issues.push(issue("REGIME_COVERAGE_MISMATCH", `coverage 与 tags 端点不一致（${String(coverage.startDate)}~${String(coverage.endDate)} vs ${String(first)}~${String(last)}）`));
      }
    }
    if (coverage.tradingDayCount !== tags.length) {
      issues.push(issue("REGIME_COVERAGE_COUNT_MISMATCH", `coverage.tradingDayCount=${String(coverage.tradingDayCount)} != tags.length=${tags.length}`));
    }
  }

  // -- unassessedStats --
  const expected = computeRegimeUnassessedStats(tags as unknown as readonly RegimeDayTags[]);
  const stats = run.unassessedStats as Record<string, unknown> | undefined;
  if (stats === null || typeof stats !== "object") {
    issues.push(issue("REGIME_STATS_INVALID", "unassessedStats 缺失或非对象"));
  } else {
    if (canonicalStringify(stats) !== canonicalStringify(expected)) {
      issues.push(issue("REGIME_STATS_MISMATCH", "unassessedStats 与 tags 实际统计不一致（防统计造假）"));
    }
  }

  // -- 标签序列指纹 --
  if (typeof run.tagSequenceFingerprint === "string" && run.tagSequenceFingerprint.length > 0) {
    if (run.tagSequenceFingerprint !== computeRegimeTagSequenceFingerprint(tags as unknown as readonly RegimeDayTags[])) {
      issues.push(issue("REGIME_TAG_FINGERPRINT_MISMATCH", "tagSequenceFingerprint 与 tags 内容不匹配（标签序列被篡改）"));
    }
  } else {
    issues.push(issue("REGIME_TAG_FINGERPRINT_EMPTY", "tagSequenceFingerprint 必须是非空 sha256 十六进制串"));
  }

  // -- attribution（可空；非空时做一致性检查）--
  const attribution = run.attribution as Record<string, unknown> | null | undefined;
  if (attribution !== null && attribution !== undefined) {
    if (typeof attribution !== "object") {
      issues.push(issue("REGIME_ATTRIBUTION_INVALID", "attribution 必须是对象或 null"));
    } else {
      const groups = attribution.groups;
      if (!Array.isArray(groups)) {
        issues.push(issue("REGIME_ATTRIBUTION_GROUPS_INVALID", "attribution.groups 必须是数组"));
      } else {
        let matched = 0;
        let previousKey: string | null = null;
        groups.forEach((group, index) => {
          const value = group as Record<string, unknown>;
          const key = value.regimeKey;
          if (typeof key !== "string" || key.length === 0) {
            issues.push(issue("REGIME_ATTRIBUTION_KEY_INVALID", `attribution.groups[${index}].regimeKey 必须是非空字符串`));
            return;
          }
          if (previousKey !== null && previousKey >= key) {
            issues.push(issue("REGIME_ATTRIBUTION_NOT_SORTED", `attribution.groups 必须按 regimeKey 严格升序（${previousKey} → ${key}）`));
          }
          previousKey = key;
          if (!Number.isInteger(value.sampleCount) || (value.sampleCount as number) <= 0) {
            issues.push(issue("REGIME_ATTRIBUTION_COUNT_INVALID", `attribution.groups[${index}].sampleCount 必须是 > 0 的整数`));
          } else {
            matched += value.sampleCount as number;
          }
        });
        if (attribution.matchedSampleCount !== matched) {
          issues.push(issue("REGIME_ATTRIBUTION_MATCH_MISMATCH", `attribution.matchedSampleCount=${String(attribution.matchedSampleCount)} != 各组 sampleCount 之和=${matched}`));
        }
        const unmatched = attribution.unmatchedSampleCount;
        const total = attribution.totalSampleCount;
        if (typeof unmatched === "number" && typeof total === "number" && unmatched + matched !== total) {
          issues.push(issue("REGIME_ATTRIBUTION_TOTAL_MISMATCH", "attribution: matched + unmatched != totalSampleCount"));
        }
      }
    }
  }

  // -- 内容指纹 --
  if (typeof run.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(run.fingerprint)) {
    issues.push(issue("REGIME_FINGERPRINT_INVALID", "fingerprint 必须是 64 位 sha256 十六进制串"));
  } else if (issues.length === 0) {
    const recomputed = computeMarketRegimeRunFingerprint(record as MarketRegimeRun);
    if (recomputed !== run.fingerprint) {
      issues.push(issue("REGIME_FINGERPRINT_MISMATCH", "fingerprint 与记录内容不匹配（记录被篡改）"));
    }
  }

  return issues;
}

/** 断言 Run 合法（非法即抛错，FAIL FAST）。 */
export function assertValidMarketRegimeRun(record: unknown): asserts record is MarketRegimeRun {
  const issues = validateMarketRegimeRun(record);
  if (issues.length > 0) {
    throw new RegimeAnalysisError(
      "REGIME_RECORD_INVALID",
      `marketRegime: MarketRegimeRun 校验失败（${issues.length} 项）：` +
        issues.map((item) => `[${item.code}] ${item.message}`).join("；"),
    );
  }
}

/** 反序列化：JSON → 结构校验 → 指纹复核（防篡改）。 */
export function deserializeMarketRegimeRun(json: string): MarketRegimeRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new RegimeAnalysisError(
      "REGIME_RECORD_INVALID",
      `marketRegime: 反序列化失败，JSON 非法：${(error as Error).message}`,
    );
  }
  assertValidMarketRegimeRun(parsed);
  return parsed;
}
