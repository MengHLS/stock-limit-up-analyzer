/**
 * datasetPreviewState 单测（STEP DATASET-002.3，任务 §15）。
 *
 * 覆盖：keyset 分页（NEXT/PREV/RESET）、游标栈、版本/表切换清残留、queryKey 稳定性。
 */

import { describe, expect, it } from "vitest";
import {
  currentCursor,
  initialPreviewStack,
  previewQueryKey,
  reducePreviewStack,
  selectPreviewState,
} from "./datasetPreviewState";

describe("datasetPreviewState · keyset 分页状态机", () => {
  it("初始栈 = 首页（cursor null）", () => {
    const stack = initialPreviewStack();
    expect(stack).toEqual([null]);
    expect(currentCursor(stack)).toBeNull();
    expect(selectPreviewState(stack, "c1").pageIndex).toBe(1);
  });

  it("NEXT 压入 nextCursor；PREV 弹出", () => {
    let stack = initialPreviewStack();
    stack = reducePreviewStack(stack, { type: "NEXT", nextCursor: "c1" });
    expect(currentCursor(stack)).toBe("c1");
    expect(selectPreviewState(stack, "c2").canGoPrev).toBe(true);

    stack = reducePreviewStack(stack, { type: "PREV" });
    expect(currentCursor(stack)).toBeNull();
    expect(selectPreviewState(stack, "c1").canGoPrev).toBe(false);
  });

  it("首页 PREV 是 no-op（不越界）", () => {
    const stack = reducePreviewStack(initialPreviewStack(), { type: "PREV" });
    expect(stack).toEqual([null]);
  });

  it("RESET 回到第 1 页（版本切换清残留）", () => {
    let stack = initialPreviewStack();
    stack = reducePreviewStack(stack, { type: "NEXT", nextCursor: "c1" });
    stack = reducePreviewStack(stack, { type: "NEXT", nextCursor: "c2" });
    expect(stack.length).toBe(3);
    const reset = reducePreviewStack(stack, { type: "RESET" });
    expect(reset).toEqual([null]);
    expect(currentCursor(reset)).toBeNull();
  });

  it("canGoNext 由 nextCursor 决定（null → 末页禁 next）", () => {
    const stack = initialPreviewStack();
    expect(selectPreviewState(stack, null).canGoNext).toBe(false);
    expect(selectPreviewState(stack, "c1").canGoNext).toBe(true);
  });

  it("重复 nextCursor 不重复压栈（防抖）", () => {
    let stack = reducePreviewStack(initialPreviewStack(), { type: "NEXT", nextCursor: "c1" });
    stack = reducePreviewStack(stack, { type: "NEXT", nextCursor: "c1" });
    expect(stack).toEqual([null, "c1"]);
  });
});

describe("datasetPreviewState · queryKey 稳定性", () => {
  it("不同 table / versionId / limit / cursor 产生不同 key", () => {
    const a = previewQueryKey("event", 3, 50, null);
    const b = previewQueryKey("path", 3, 50, null);
    const c = previewQueryKey("event", 4, 50, null);
    const d = previewQueryKey("event", 3, 100, null);
    const e = previewQueryKey("event", 3, 50, "c1");
    expect(a).toEqual(["datasetRegistry.preview", "event", 3, 50, null]);
    expect(new Set([JSON.stringify(a), JSON.stringify(b), JSON.stringify(c), JSON.stringify(d), JSON.stringify(e)]).size).toBe(5);
  });

  it("versionId 变化 → key 变化（杜绝旧版本数据残留）", () => {
    const k1 = previewQueryKey("event", 3, 50, null);
    const k2 = previewQueryKey("event", 3, 50, "c1");
    expect(k1).not.toEqual(k2);
  });
});
