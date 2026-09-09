/**
 * STEP 25 / C-25.1 — Closed Loop：序列化 / 指纹 / round-trip（确定性、防篡改）。
 *
 * - canonicalStringify：复用 researchDataset/version.ts（全系统同一 canonical 语义）；
 * - sha256Hex：node:crypto（同既有模块 serialize 范式）；
 * - computeClosedLoopRunFingerprint / computeClosedLoopChainFingerprint：
 *   fingerprint 覆盖除自身外全部字段；chainFingerprint 覆盖 stages+blocked+request+
 *   metadata+overall（全链审计锚点）；
 * - serialize/deserialize + verify：round-trip 篡改拒绝。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import type { ClosedLoopRun } from "./types";

export { canonicalStringify };

/** sha256（utf8 → hex）。 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** 由对象体计算 sha256 指纹（canonical 序列化后哈希）。 */
export function computeFingerprintOfBody(body: unknown): string {
  return sha256Hex(canonicalStringify(body));
}

/** 深冻结（复制后冻结；不冻结调用方共享对象）。 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** 由 run body（不含 fingerprint）计算内容指纹。 */
export function computeClosedLoopRunFingerprint(body: Omit<ClosedLoopRun, "fingerprint">): string {
  return computeFingerprintOfBody(body);
}

/** 由「审计载荷」计算全链指纹（stages + blockedSummary + request + metadata + overall）。 */
export function computeClosedLoopChainFingerprint(payload: {
  stages: ClosedLoopRun["stages"];
  blockedSummary: ClosedLoopRun["blockedSummary"];
  request: ClosedLoopRun["request"];
  metadata: ClosedLoopRun["metadata"];
  overall: ClosedLoopRun["overall"];
}): string {
  return computeFingerprintOfBody(payload);
}

/** 序列化 run（JSON；含 fingerprint 供复核）。 */
export function serializeClosedLoopRun(run: ClosedLoopRun): string {
  return JSON.stringify(run);
}

/** 反序列化 run（可选 verify：指纹不符响亮抛错）。 */
export function deserializeClosedLoopRun(json: string, options?: { verify?: boolean }): ClosedLoopRun {
  const parsed = JSON.parse(json) as ClosedLoopRun;
  if (options?.verify !== false) {
    const expected = parsed.fingerprint;
    const { fingerprint: _ignored, ...rest } = parsed;
    const recomputed = computeClosedLoopRunFingerprint(rest as Omit<ClosedLoopRun, "fingerprint">);
    if (recomputed !== expected) {
      throw new Error(`closedLoop: 反序列化复核失败——run 内容指纹与记录 fingerprint 不一致（可能被篡改或字段退化）`);
    }
  }
  return parsed;
}
