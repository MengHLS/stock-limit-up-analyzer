/**
 * P5 本地用量计数行为锁。
 *
 * 三件必须钉死的事：**只写本地**（无网络）、**计入正确**（方案次数 / 改了几项）、
 * **读不出来就承认读不出来**（形状不符 ⇒ null，不拿一份半成品糊弄调用方）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  authoringUsageAgeDays,
  clearAuthoringUsage,
  readAuthoringUsage,
  recordPresetUsage,
} from "@/components/strategy/authoringUsageLog";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  } as Storage;
}

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
});

function withStorage(): void {
  (globalThis as { window?: unknown }).window = { localStorage: fakeStorage() };
}

describe("authoringUsageLog（P5 本地计数）", () => {
  it("1) 没有记录 / 无 window ⇒ 读出来是 null（不造假数据）", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(readAuthoringUsage()).toBeNull();
    withStorage();
    expect(readAuthoringUsage()).toBeNull();
  });

  it("2) 记一次方案选择：计数 +1，首末时间与 slot 都落上", () => {
    withStorage();
    recordPresetUsage("RECIPE", "recipe:a", 0, "2026-10-03T00:00:00.000Z");
    const log = readAuthoringUsage();
    expect(log?.slots.RECIPE?.selections["recipe:a"]).toBe(1);
    expect(log?.firstRecordedAt).toBe("2026-10-03T00:00:00.000Z");
    expect(log?.lastRecordedAt).toBe("2026-10-03T00:00:00.000Z");
  });

  it("3) 同一方案记两次 ⇒ 2；再换一个方案 ⇒ 两个键各自计数", () => {
    withStorage();
    recordPresetUsage("POSITION", "position:a", 0, "2026-10-03T00:00:00.000Z");
    recordPresetUsage("POSITION", "position:a", 0, "2026-10-03T00:01:00.000Z");
    recordPresetUsage("POSITION", "position:b", 0, "2026-10-03T00:02:00.000Z");
    const slots = readAuthoringUsage()?.slots.POSITION;
    expect(slots?.selections["position:a"]).toBe(2);
    expect(slots?.selections["position:b"]).toBe(1);
    expect(readAuthoringUsage()?.lastRecordedAt).toBe("2026-10-03T00:02:00.000Z");
  });

  it("4) 参数改动：改了几项就累加几项；0 项不算一次改参数", () => {
    withStorage();
    recordPresetUsage("COST", "cost:a", 0, "2026-10-03T00:00:00.000Z");
    recordPresetUsage("COST", "cost:a", 3, "2026-10-03T00:01:00.000Z");
    recordPresetUsage("COST", "cost:a", 2, "2026-10-03T00:02:00.000Z");
    const slots = readAuthoringUsage()?.slots.COST;
    expect(slots?.parameterEditSessions).toBe(2);
    expect(slots?.parameterEditCount).toBe(5);
  });

  it("5) 多个 slot 互不干扰（同一 presetId 在不同 slot 下各自计数）", () => {
    withStorage();
    recordPresetUsage("RECIPE", "same-id", 0, "2026-10-03T00:00:00.000Z");
    recordPresetUsage("COST", "same-id", 0, "2026-10-03T00:00:00.000Z");
    const log = readAuthoringUsage();
    expect(log?.slots.RECIPE?.selections["same-id"]).toBe(1);
    expect(log?.slots.COST?.selections["same-id"]).toBe(1);
  });

  it("6) 形状不符的记录当作「没有」：不半解析、不半信半疑地当成有效计数", () => {
    withStorage();
    const store = (globalThis as { window: { localStorage: Storage } }).window.localStorage;
    store.setItem("stock-limit-up-analyzer:strategy-authoring:usage", JSON.stringify({ version: 99, slots: {} }));
    expect(readAuthoringUsage()).toBeNull();
    store.setItem("stock-limit-up-analyzer:strategy-authoring:usage", "not json");
    expect(readAuthoringUsage()).toBeNull();
  });

  it("7) clear 之后回到 null（用户能删掉这份历史）", () => {
    withStorage();
    recordPresetUsage("RECIPE", "recipe:a", 0, "2026-10-03T00:00:00.000Z");
    clearAuthoringUsage();
    expect(readAuthoringUsage()).toBeNull();
  });

  it("8) 攒了几天：firstRecordedAt → now 的天数；没有记录 ⇒ null", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(authoringUsageAgeDays("2026-10-20T00:00:00.000Z")).toBeNull();
    withStorage();
    recordPresetUsage("RECIPE", "recipe:a", 0, "2026-10-03T00:00:00.000Z");
    expect(authoringUsageAgeDays("2026-10-17T00:00:00.000Z")).toBe(14);
  });

  it("9) 只写本地：模块源码里不得出现任何网络调用", () => {
    const src = readFileSync(path.join(ROOT, "client/src/components/strategy/authoringUsageLog.ts"), "utf8");
    // 只扫**代码**：注释里出现这些词（比如说明"本仓没有 sendBeacon"）不算违规。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of ["fetch(", "sendBeacon", "XMLHttpRequest", "WebSocket"]) {
      expect(code.includes(forbidden), forbidden).toBe(false);
    }
    expect(code).toContain("localStorage");
  });
});
