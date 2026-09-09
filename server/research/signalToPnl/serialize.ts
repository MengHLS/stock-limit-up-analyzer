/**
 * STEP 23 / C-23.2 — 信号→订单→成交→PnL 闭环编排：SignalToPnlRun 序列化 + 指纹防篡改。
 *
 * 铁律（对齐 paperAccount/serialize.ts + executionConstraints/serialize.ts）：
 *   - 序列化用 canonicalStringify（键字典序，来自 researchDataset/version.ts 只读复用），
 *     同内容必同串（与对象键插入序无关）；
 *   - 拒绝 NaN/Infinity（先做 strict 守卫，绝不静默转 null）；
 *   - fingerprint = sha256（十六进制），对「除 fingerprint 外全部字段」的确定性摘要；
 *   - deserialize 先结构复核再指纹复核，任何篡改/字段退化都会抛 SignalToPnlError。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import type { SignalToPnlRun } from "./types";
import { SIGNAL_TO_PNL_ERROR_CODES, SignalToPnlError } from "./errors";
import { assertValidSignalToPnlRun } from "./validate";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** strict 守卫：递归断言不存在非有限数字（NaN/Infinity 不得静默转 null）。 */
function assertFiniteNumbers(value: unknown): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SignalToPnlError(
        SIGNAL_TO_PNL_ERROR_CODES.SERIALIZE_NON_FINITE,
        `signalToPnl: 拒绝序列化非有限数字：${String(value)}`
      );
    }
    return;
  }
  if (typeof value === "string") {
    if (value.length > 0 && !Number.isNaN(Number(value))) {
      // 允许字符串里包含数字字面量（不影响序列化），仅检查 number 字段
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertFiniteNumbers(item);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      assertFiniteNumbers(item);
    }
  }
}

/**
 * 计算记录内容指纹：除 fingerprint 字段外全部字段的 canonical JSON 摘要。
 * record 允许已含 fingerprint（计算时自动忽略），便于反序列化复核。
 */
export function computeSignalToPnlRunFingerprint(
  record: SignalToPnlRun | Omit<SignalToPnlRun, "fingerprint">
): string {
  const { fingerprint: _ignored, ...rest } = record as SignalToPnlRun;
  assertFiniteNumbers(rest);
  return sha256Hex(canonicalStringify(rest));
}

/** 序列化运行记录（canonical JSON；拒绝 NaN/Infinity；不含时间戳/随机数）。 */
export function serializeSignalToPnlRun(record: SignalToPnlRun): string {
  assertFiniteNumbers(record);
  return canonicalStringify(record);
}

/** 反序列化运行记录：结构复核 + fingerprint 完整性校验。 */
export function deserializeSignalToPnlRun(json: string): SignalToPnlRun {
  const parsed: unknown = JSON.parse(json);
  assertValidSignalToPnlRun(parsed);
  const record = parsed as unknown as SignalToPnlRun;
  const recomputed = computeSignalToPnlRunFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_FINGERPRINT_MISMATCH,
      `signalToPnl: 指纹不匹配，记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`
    );
  }
  return record;
}