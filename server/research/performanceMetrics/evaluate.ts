/**
 * STEP 16 / C-16.1 — 策略评价·收益/风险/回撤指标：评估器装配与序列化。
 *
 * 职责：
 *   - evaluatePerformance：把（equityCurve, trades, 口径参数）→ 不可变、带指纹的
 *     PerformanceEvaluationRun 总记录；computePerformanceMetrics（analyze.ts）只算
 *     指标，本层负责输入绑定指纹（inputFingerprint）与记录内容指纹（fingerprint）。
 *   - 序列化：JSON round-trip，拒绝 NaN/±Infinity（绝不静默转 null）；
 *     反序列化时重算 fingerprint 复核，防篡改/防字段退化。
 *
 * 铁律（对齐 simulator/serialize.ts）：
 *   - 无 Date.now / Math.random / IO；同输入必得同记录、同指纹；
 *   - fingerprint = sha256（十六进制），对「除 fingerprint 外全部字段」的确定性 JSON 摘要。
 *   - 返回记录深冻结（不可变）。输入 equityCurve / trades 只读不改。
 *
 * 扩展面（供 C-16.2 / C-16.3）：
 *   - C-16.2 需要与 Sharpe/Sortino/Calmar 一致口径，可从 analyze.ts 直接复用
 *     日收益序列等纯函数；记录形如 PerformanceEvaluationRun，后续任务可在同目录
 *     追加自己的记录种类，或在本记录 metrics 之上叠加（本任务不预埋空字段，
 *     由协调者统一编排避免并行冲突）。
 */

import { createHash } from "node:crypto";
import { computePerformanceMetrics } from "./analyze";
import type {
  PerformanceEvaluationInput,
  PerformanceEvaluationRun,
} from "./types";
import {
  PERFORMANCE_EVALUATION_RUN_KIND,
  PERFORMANCE_EVALUATION_RUN_RECORD_VERSION,
} from "./types";

// ---------------------------------------------------------------------------
// 确定性 JSON 与指纹
// ---------------------------------------------------------------------------

/** 严格 replacer：拒绝非有限数字（NaN/±Infinity 不得静默转 null）。 */
function strictReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(
      `performanceMetrics: 拒绝序列化非有限数字：${String(value)}`
    );
  }
  return value;
}

/** 记录指纹 replacer：剔除 fingerprint 自身，防止自引用。 */
function fingerprintReplacer(key: string, value: unknown): unknown {
  if (key === "fingerprint") return undefined;
  return strictReplacer(key, value);
}

/** sha256 十六进制摘要。 */
function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 深冻结（评估产物不可变）。 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * 输入绑定指纹：对（equityCurve, trades?）的确定性 sha256。
 * 评估结果凭此绑定到具体输入曲线，防止「指标与来源脱钩」。
 */
export function computeInputFingerprint(input: PerformanceEvaluationInput): string {
  const payload: Record<string, unknown> = { equityCurve: input.equityCurve };
  if (input.trades !== undefined) payload.trades = input.trades;
  return sha256Hex(JSON.stringify(payload, strictReplacer));
}

/**
 * 计算记录内容指纹：除 fingerprint 字段外全部字段的确定性 JSON 摘要。
 * record 允许已含 fingerprint（计算时自动忽略），便于反序列化复核。
 */
export function computePerformanceEvaluationRunFingerprint(
  record: Omit<PerformanceEvaluationRun, "fingerprint"> | PerformanceEvaluationRun
): string {
  return sha256Hex(JSON.stringify(record, fingerprintReplacer));
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 评估一次 equityCurve / trades（C-14.1 TradeSimulationRun 产物），
 * 产出不可变、带双指纹的 PerformanceEvaluationRun。
 *
 * 口径参数缺省：annualizationFactor=252（交易日/年）、drawdownThresholdPct=5（%）、
 * downsideTarget=0（日收益小数）。
 */
export function evaluatePerformance(
  input: PerformanceEvaluationInput
): PerformanceEvaluationRun {
  const annualizationFactor = input.annualizationFactor ?? 252;
  const drawdownThresholdPct = input.drawdownThresholdPct ?? 5;
  const downsideTarget = input.downsideTarget ?? 0;

  // 解析后的有效参数回灌（computePerformanceMetrics 会校验参数与曲线，非法即抛错）。
  const effective: PerformanceEvaluationInput = {
    equityCurve: input.equityCurve,
    annualizationFactor,
    drawdownThresholdPct,
    downsideTarget,
    ...(input.trades !== undefined ? { trades: input.trades } : {}),
  };

  const metrics = computePerformanceMetrics(effective);
  const curve = effective.equityCurve;
  const inputFingerprint = computeInputFingerprint(effective);

  const body: Omit<PerformanceEvaluationRun, "fingerprint"> = {
    recordKind: PERFORMANCE_EVALUATION_RUN_KIND,
    recordVersion: PERFORMANCE_EVALUATION_RUN_RECORD_VERSION,
    annualizationFactor,
    drawdownThresholdPct,
    downsideTarget,
    input: {
      equityCurvePointCount: curve.length,
      startDate: curve[0]!.date,
      endDate: curve[curve.length - 1]!.date,
      tradeCount: effective.trades === undefined ? null : effective.trades.length,
    },
    inputFingerprint,
    metrics,
  };
  const fingerprint = computePerformanceEvaluationRunFingerprint(body);
  return deepFreeze<PerformanceEvaluationRun>({ ...body, fingerprint });
}

// ---------------------------------------------------------------------------
// 序列化 / 反序列化
// ---------------------------------------------------------------------------

/** 序列化评估记录（拒绝 NaN/Infinity；不含时间戳/随机数，同记录必同串）。 */
export function serializePerformanceEvaluationRun(
  record: PerformanceEvaluationRun
): string {
  return JSON.stringify(record, strictReplacer);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`performanceMetrics: 反序列化结果不是对象：${label}`);
  }
}

/** 轻量结构复核（形态 + fingerprint 完整性）。 */
export function assertValidPerformanceEvaluationRun(record: unknown): asserts record is PerformanceEvaluationRun {
  assertObject(record, "performanceEvaluationRun");
  if (record.recordKind !== PERFORMANCE_EVALUATION_RUN_KIND) {
    throw new Error(
      `performanceMetrics: recordKind=${String(record.recordKind)} 不是 ${PERFORMANCE_EVALUATION_RUN_KIND}`
    );
  }
  if (record.recordVersion !== PERFORMANCE_EVALUATION_RUN_RECORD_VERSION) {
    throw new Error(
      `performanceMetrics: recordVersion=${String(record.recordVersion)} 不受支持（期望 ${PERFORMANCE_EVALUATION_RUN_RECORD_VERSION}）`
    );
  }
  assertObject(record.metrics, "performanceEvaluationRun.metrics");
  if (typeof record.fingerprint !== "string" || record.fingerprint.length === 0) {
    throw new Error("performanceMetrics: 记录缺 fingerprint");
  }
}

/**
 * 反序列化评估记录：结构复核 + fingerprint 完整性校验。
 * 任何字段被篡改 / 数值退化都会导致指纹不匹配而抛错。
 */
export function deserializePerformanceEvaluationRun(json: string): PerformanceEvaluationRun {
  const parsed: unknown = JSON.parse(json);
  assertValidPerformanceEvaluationRun(parsed);
  const record = parsed;
  const recomputed = computePerformanceEvaluationRunFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new Error(
      `performanceMetrics: 指纹不匹配，记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`
    );
  }
  return record;
}
