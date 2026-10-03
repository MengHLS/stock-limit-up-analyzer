/** SCOPE-002 §1.3.1 / §2.3 A3 —— JSON Pointer 工具单测（含"路径必须已存在"的硬约束）。 */
import { describe, expect, it } from "vitest";
import { encodePointerSegment, getByPointer, parseJsonPointer, setByPointer, JsonPointerError } from "../../../../server/research/strategyAuthoring/jsonPointer";

describe("parseJsonPointer / encodePointerSegment", () => {
  it("RFC 6901：空串 = 整根；`/` 开头按段切分", () => {
    expect(parseJsonPointer("")).toEqual([]);
    expect(parseJsonPointer("/a/b/0")).toEqual(["a", "b", "0"]);
  });

  it("不以 `/` 开头 ⇒ AUTHORING_POINTER_INVALID", () => {
    try {
      parseJsonPointer("a/b");
      throw new Error("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonPointerError);
      expect((error as JsonPointerError).code).toBe("AUTHORING_POINTER_INVALID");
    }
  });

  it("转义往返：`~` → `~0`，`/` → `~1`", () => {
    expect(encodePointerSegment("a/b")).toBe("a~1b");
    expect(encodePointerSegment("c~d")).toBe("c~0d");
    expect(parseJsonPointer("/a~1b/c~0d")).toEqual(["a/b", "c~d"]);
  });
});

describe("getByPointer", () => {
  it("命中对象 / 数组下标", () => {
    const root = { a: { b: [{ c: 1 }] } };
    expect(getByPointer(root, "/a/b/0/c")).toEqual({ found: true, value: 1 });
  });

  it("缺路径 ⇒ found:false（不抛错）", () => {
    expect(getByPointer({ a: 1 }, "/nope")).toEqual({ found: false, value: undefined });
    expect(getByPointer({ a: [] }, "/a/0")).toEqual({ found: false, value: undefined });
  });
});

describe("setByPointer（路径必须已存在）", () => {
  it("写入已存在的叶子", () => {
    const root = { stop: { anchor: { stopRatio: 0.06 } } };
    setByPointer(root, "/stop/anchor/stopRatio", 0.05);
    expect(root.stop.anchor.stopRatio).toBe(0.05);
  });

  it("数组下标已存在时可写", () => {
    const root = { xs: [1, 2] };
    setByPointer(root, "/xs/1", 9);
    expect(root.xs).toEqual([1, 9]);
  });

  it("叶子不存在 ⇒ AUTHORING_POINTER_MISSING（绝不新建）", () => {
    const root = { stop: {} } as Record<string, unknown>;
    expect(() => setByPointer(root, "/stop/anchor/stopRatio", 0.05)).toThrow(JsonPointerError);
    expect((root as any).stop).toEqual({});
  });

  it("父路径不存在 ⇒ AUTHORING_POINTER_MISSING", () => {
    const root = {} as Record<string, unknown>;
    try {
      setByPointer(root, "/a/b", 1);
      throw new Error("应当抛错");
    } catch (error) {
      expect((error as JsonPointerError).code).toBe("AUTHORING_POINTER_MISSING");
    }
    expect(root).toEqual({});
  });

  it("空指针不允许写整根（只能改叶子值）", () => {
    expect(() => setByPointer({ a: 1 }, "", 2)).toThrow(JsonPointerError);
  });
});