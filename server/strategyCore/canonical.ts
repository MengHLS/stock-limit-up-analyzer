/**
 * STRATEGY-ARCH-001 — canonical JSON + sha256（指纹底座）。
 *
 * 规则（保证「同一语义 ⇒ 同一字节」）：
 *   - 对象键**递归升序**排序（数组顺序**保留**，因为数组顺序在本域有语义）；
 *   - `undefined` 属性的处理：对象中**跳过**（等价于未声明）；数组中由 `null` 占位；
 *   - `number` 必须是有限值（NaN / Infinity 抛错，不静默变 `null`）；
 *   - `function` 一律抛错（函数不属于可序列化面 —— 指纹只覆盖**声明**，不覆盖实现；
 *     实现的变更通过**特征/引擎版本号**体现）；
 *   - 不依赖 `Date.now` / 随机数 / 环境。
 *
 * 纯模块：只用 `node:crypto` 的确定性哈希，无 IO。
 */

import { createHash } from "node:crypto";
import { StrategyCoreError } from "./types";

function encode(value: unknown, path: string): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "number") {
    if (!Number.isFinite(value as number)) {
      throw new StrategyCoreError("CORE_DEFINITION_INVALID", path + " 是非有限数字（" + String(value) + "）");
    }
    return JSON.stringify(value);
  }
  if (type === "string" || type === "boolean") return JSON.stringify(value);
  if (type === "undefined") return "undefined";
  if (type === "function") {
    throw new StrategyCoreError(
      "CORE_DEFINITION_INVALID",
      path + " 是函数 —— canonical JSON 只接受可序列化声明（实现版本通过特征/引擎版本号体现）",
    );
  }
  if (Array.isArray(value)) {
    const items = value.map((item, index) => encode(item === undefined ? null : item, path + "[" + String(index) + "]"));
    return "[" + items.join(",") + "]";
  }
  if (type === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const entries = keys.map((key) => JSON.stringify(key) + ":" + encode(record[key], path + "." + key));
    return "{" + entries.join(",") + "}";
  }
  throw new StrategyCoreError("CORE_DEFINITION_INVALID", path + " 含不可序列化类型 " + type);
}

/** canonical JSON 串（递归键排序；确定性）。 */
export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

/** sha256 十六进制（小写）。 */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 对任意可序列化值取指纹（canonical JSON → sha256）。 */
export function fingerprintOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
