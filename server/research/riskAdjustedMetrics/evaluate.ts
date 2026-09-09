/**
 * STEP 16 / C-16.2 — 策略评价·风险调整指标：评估器装配与序列化。
 *
 * 职责：
 *   - evaluateRiskAdjustedMetrics：把（equityCurve, trades, 口径参数）→ 不可变、
 *     带双指纹的 RiskAdjustedEvaluationRun 总记录；computeRiskAdjustedMetrics
 *     （analyze.ts）只算指标，本层负责输入绑定指纹与记录内容指纹。
 *   - 输入绑定指纹复用 C-16.1 evaluate.ts 的 computeInputFingerprint（同载荷：
 *     equityCurve + trades? 的确定性 sha256），保证同曲线在同任务间指纹一致。
 *   - 序列化：JSON round-trip，拒绝 NaN/±Infinity；反序列化重算 fingerprint 复核。
 *
 * 铁律（对齐 performanceMetrics/evaluate.ts 与 simulator/serialize.ts）：
 *   - 无 Date.now / Math.random / IO；同输入必得同记录、同指纹。
 *   - fingerprint = sha256（十六进制），对「除 fingerprint 外全部字段」的确定性 JSON 摘要。
 *   - 返回记录深冻结（不可变）。输入 equityCurve / trades 只读不改。
 */

import { createHash } from "node:crypto";
import { computeInputFingerprint } from "../performanceMetrics/evaluate";
import { computeRiskAdjustedMetrics } from "./analyze";
import type { RiskAdjustedEvaluationInput, RiskAdjustedEvaluationRun } from "./types";
import {
  RISK_ADJUSTED_EVALUATION_RUN_KIND,
  RISK_ADJUSTED_EVALUATION_RUN_RECORD_VERSION,
} from "./types";

// ---------------------------------------------------------------------------
// 确定性 JSON 与指纹
// ---------------------------------------------------------------------------

/** 严格 replacer：拒绝非有限数字（NaN/±Infinity 不得静默转 null）。 */
function strictReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(
      `riskAdjustedMetrics: 拒绝序列化非有限数字：${String(value)}`
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
 * 计算记录内容指纹：除 fingerprint 字段外全部字段的确定性 JSON 摘要。
 * record 允许已含 fingerprint（计算时自动忽略），便于反序列化复核。
 */
export function computeRiskAdjustedRunFingerprint(
  record: Omit<RiskAdjustedEvaluationRun, "fingerprint"> | RiskAdjustedEvaluationRun
): string {
  return sha256Hex(JSON.stringify(record, fingerprintReplacer));
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 评估一次 equityCurve / trades（C-14.1 TradeSimulationRun 产物）的风险调整比率，
 * 产出不可变、带双指纹的 RiskAdjustedEvaluationRun。
 *
 * 口径参数缺省：annualizationFactor=252（交易日/年）、rfAnnualPct=0（无风险年利率 %）、
 * downsideTarget=0（日收益小数，超额收益空间）。
 */
export function evaluateRiskAdjustedMetrics(
  input: RiskAdjustedEvaluationInput
): RiskAdjustedEvaluationRun {
  const annualizationFactor = input.annualizationFactor ?? 252;
  const rfAnnualPct = input.rfAnnualPct ?? 0;
  const downsideTarget = input.downsideTarget ?? 0;

  // 解析后的有效参数回灌（computeRiskAdjustedMetrics 会校验参数与曲线，非法即抛错）。
  const effective: RiskAdjustedEvaluationInput = {
    equityCurve: input.equityCurve,
    annualizationFactor,
    rfAnnualPct,
    downsideTarget,
    ...(input.trades !== undefined ? { trades: input.trades } : {}),
  };

  const metrics = computeRiskAdjustedMetrics(effective);
  const curve = effective.equityCurve;
  const inputFingerprint = computeInputFingerprint({
    equityCurve: curve,
    ...(effective.trades !== undefined ? { trades: effective.trades } : {}),
  });

  const body: Omit<RiskAdjustedEvaluationRun, "fingerprint"> = {
    recordKind: RISK_ADJUSTED_EVALUATION_RUN_KIND,
    recordVersion: RISK_ADJUSTED_EVALUATION_RUN_RECORD_VERSION,
    annualizationFactor,
    rfAnnualPct,
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
  const fingerprint = computeRiskAdjustedRunFingerprint(body);
  return deepFreeze<RiskAdjustedEvaluationRun>({ ...body, fingerprint });
}

// ---------------------------------------------------------------------------
// 序列化 / 反序列化
// ---------------------------------------------------------------------------

/** 序列化评估记录（拒绝 NaN/Infinity；不含时间戳/随机数，同记录必同串）。 */
export function serializeRiskAdjustedEvaluationRun(
  record: RiskAdjustedEvaluationRun
): string {
  return JSON.stringify(record, strictReplacer);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`riskAdjustedMetrics: 反序列化结果不是对象：${label}`);
  }
}

/** 轻量结构复核（形态 + fingerprint 完整性）。 */
export function assertValidRiskAdjustedEvaluationRun(
  record: unknown
): asserts record is RiskAdjustedEvaluationRun {
  assertObject(record, "riskAdjustedEvaluationRun");
  if (record.recordKind !== RISK_ADJUSTED_EVALUATION_RUN_KIND) {
    throw new Error(
      `riskAdjustedMetrics: recordKind=${String(record.recordKind)} 不是 ${RISK_ADJUSTED_EVALUATION_RUN_KIND}`
    );
  }
  if (record.recordVersion !== RISK_ADJUSTED_EVALUATION_RUN_RECORD_VERSION) {
    throw new Error(
      `riskAdjustedMetrics: recordVersion=${String(record.recordVersion)} 不受支持（期望 ${RISK_ADJUSTED_EVALUATION_RUN_RECORD_VERSION}）`
    );
  }
  assertObject(record.metrics, "riskAdjustedEvaluationRun.metrics");
  if (typeof record.fingerprint !== "string" || record.fingerprint.length === 0) {
    throw new Error("riskAdjustedMetrics: 记录缺 fingerprint");
  }
}

/**
 * 反序列化评估记录：结构复核 + fingerprint 完整性校验。
 * 任何字段被篡改 / 数值退化都会导致指纹不匹配而抛错。
 */
export function deserializeRiskAdjustedEvaluationRun(
  json: string
): RiskAdjustedEvaluationRun {
  const parsed: unknown = JSON.parse(json);
  assertValidRiskAdjustedEvaluationRun(parsed);
  const record = parsed;
  const recomputed = computeRiskAdjustedRunFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new Error(
      `riskAdjustedMetrics: 指纹不匹配，记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`
    );
  }
  return record;
}
