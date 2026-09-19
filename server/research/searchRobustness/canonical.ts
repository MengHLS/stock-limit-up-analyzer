/**
 * ROBUSTNESS-001 — canonical 序列化 / 指纹 / 有限数守卫（纯函数、确定性）。
 *
 * 🔴 **本文件不是第二套 canonical 实现**：`canonicalStringify` 唯一权威在
 *   `server/researchDataset/version.ts`，此处只做 `import` 复用 + 包一层 sha256。
 *   之所以还在本域放一层，是因为本域的指纹被**两个不同层面**消费
 *   （Run 级 / 单组合结果级），需要一个共用的 `fingerprintOf`，否则两处各写一次
 *   `createHash(...).update(...).digest("hex")` 就是两套实现（口径一旦不一致即静默漂移）。
 *
 * 铁律：`NaN / ±Infinity` 必须在进入指纹前**响亮抛错** —— `canonicalStringify` 会把
 *   `NaN` 静默转成 `null`，那会把「算出来了但是坏的」伪装成「没有这个值」。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";

/** 递归检查非有限数字；发现即抛错（失败响亮，不静默）。 */
export function assertFiniteDeep(value: unknown, path = "record"): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `拒绝含非有限数字 ${String(value)}（${path}）；稳健性分析记录禁止 NaN / Infinity`,
      );
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteDeep(item, `${path}[${index}]`));
    return;
  }
  for (const key of Object.keys(value as object)) {
    assertFiniteDeep((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

/** sha256 十六进制摘要（唯一落点）。 */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * 内容指纹：**除 `fingerprint` 字段外**全部字段的 canonical JSON 摘要。
 *
 * 调用方传入「已计算好 fingerprint 的完整对象」或「不含 fingerprint 的主体」都可以
 * （后者是为写入前的自检场景准备的）。
 */
export function fingerprintOf(record: object): string {
  assertFiniteDeep(record);
  const body: Record<string, unknown> = { ...record };
  delete body["fingerprint"];
  return sha256Hex(canonicalStringify(body));
}

/** canonical 序列化（拒绝 NaN / Infinity；同内容必同串）。 */
export function serializeCanonical(record: unknown): string {
  assertFiniteDeep(record);
  return canonicalStringify(record);
}

const HEX64_RE = /^[0-9a-f]{64}$/;

/** 64 位十六进制指纹形态判定（读库行 / 反序列化共用）。 */
export function isHex64(value: unknown): value is string {
  return typeof value === "string" && HEX64_RE.test(value);
}
