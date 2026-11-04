/**
 * SCOPE-002 §1.3.1 —— RFC 6901 JSON Pointer 工具（纯函数、无 IO）。
 *
 * 为什么需要它：「预设 + 参数」要能对**任意 canonical payload** 开放有限可调点，
 * 而不必为每个预设写一份专用映射。参数用 JSON Pointer 指向 payload 内部，
 * 物化时按指针写入 —— 预设因此可以只靠**声明**扩展（裁定 Q1/Q2）。
 *
 * 两个硬约束（与 §1.3.1「物化语义」一致）：
 *   1. 🔴 **路径必须已存在**（含中间父节点）。缺路径 ⇒ 抛 `AUTHORING_POINTER_MISSING`，
 *      **绝不新建路径、绝不猜测**；
 *   2. 只写**叶子值**，不替换容器本身（`""` 指针不允许用于写入）。
 */

export const JSON_POINTER_ERROR_CODES = ["AUTHORING_POINTER_INVALID", "AUTHORING_POINTER_MISSING"] as const;
export type JsonPointerErrorCode = (typeof JSON_POINTER_ERROR_CODES)[number];

export class JsonPointerError extends Error {
  readonly code: JsonPointerErrorCode;
  constructor(code: JsonPointerErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "JsonPointerError";
  }
}

/** RFC 6901 解码单段：`~1` → `/`，`~0` → `~`（顺序不可颠倒）。 */
function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** RFC 6901 编码单段：`~` → `~0`，`/` → `~1`（顺序不可颠倒）。 */
export function encodePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * 解析 JSON Pointer。
 * - `""` ⇒ `[]`（整根）；
 * - 非空但首字符不是 `/` ⇒ `AUTHORING_POINTER_INVALID`（RFC 6901 要求）。
 */
export function parseJsonPointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new JsonPointerError("AUTHORING_POINTER_INVALID", `JSON Pointer 必须以 "/" 开头或为空串，实际：${JSON.stringify(pointer)}`);
  }
  return pointer.slice(1).split("/").map(decodePointerSegment);
}

function isContainer(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  return typeof value === "object" && value !== null;
}

function hasKey(container: Record<string, unknown> | readonly unknown[], key: string): boolean {
  if (Array.isArray(container)) {
    if (!/^(0|[1-9]\d*)$/.test(key)) return false;
    const index = Number(key);
    return index < container.length;
  }
  return Object.prototype.hasOwnProperty.call(container, key);
}

function readKey(container: Record<string, unknown> | readonly unknown[], key: string): unknown {
  return Array.isArray(container) ? container[Number(key)] : (container as Record<string, unknown>)[key];
}

export interface JsonPointerLookup {
  readonly found: boolean;
  readonly value: unknown;
}

/** 读取指针处的值；路径不存在 ⇒ `{ found: false, value: undefined }`（不抛错）。 */
export function getByPointer(root: unknown, pointer: string): JsonPointerLookup {
  let cursor: unknown = root;
  for (const segment of parseJsonPointer(pointer)) {
    if (!isContainer(cursor) || !hasKey(cursor, segment)) return { found: false, value: undefined };
    cursor = readKey(cursor, segment);
  }
  return { found: true, value: cursor };
}

/**
 * 写入指针处的值（**路径必须已存在**）。
 *
 * 返回写入后的根（便于调用方按不可变风格重建）。指针为 `""` 或父节点缺失
 * ⇒ `AUTHORING_POINTER_MISSING`；父节点不是容器 ⇒ 同错。
 */
export function setByPointer<T>(root: T, pointer: string, value: unknown): T {
  const segments = parseJsonPointer(pointer);
  if (segments.length === 0) {
    throw new JsonPointerError("AUTHORING_POINTER_MISSING", "不允许用空指针写入整根（只能改叶子值）");
  }
  let cursor: unknown = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    if (!isContainer(cursor) || !hasKey(cursor, segment)) {
      throw new JsonPointerError(
        "AUTHORING_POINTER_MISSING",
        `JSON Pointer 的父路径不存在：${pointer}（缺在 "${segments.slice(0, index + 1).join("/")}"）`,
      );
    }
    cursor = readKey(cursor, segment);
  }
  const leaf = segments[segments.length - 1]!;
  if (!isContainer(cursor) || !hasKey(cursor, leaf)) {
    throw new JsonPointerError("AUTHORING_POINTER_MISSING", `JSON Pointer 指向的叶子不存在：${pointer}`);
  }
  if (Array.isArray(cursor)) {
    (cursor as unknown[])[Number(leaf)] = value;
  } else {
    (cursor as Record<string, unknown>)[leaf] = value;
  }
  return root;
}