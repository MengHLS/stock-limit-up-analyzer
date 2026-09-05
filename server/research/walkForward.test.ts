/**
 * STEP 6.5 — Walk-Forward Window Generation 测试。
 *
 * 覆盖（§三十八 WFO Window）：Rolling/Expanding 生成、窗口顺序、不重叠、边界、stepSize、
 * insufficient data、invalid config、deterministic fingerprint。
 */

import { describe, expect, it } from "vitest";
import {
  computeWalkForwardConfigFingerprint,
  computeWindowFingerprint,
  generateWalkForwardWindows,
  validateWalkForwardConfig,
  type WalkForwardConfig,
  type WalkForwardWindow,
} from "./walkForward";

const BASE: WalkForwardConfig = {
  mode: "rolling",
  trainSize: 10,
  validationSize: 5,
  oosSize: 5,
  stepSize: 5,
  datasetRange: { start: "2024-01-01", end: "2024-02-09" },
  selectionMetric: "sharpeRatio",
  selectionDirection: "maximize",
};

function makeConfig(overrides: Partial<WalkForwardConfig> = {}): WalkForwardConfig {
  return { ...BASE, ...overrides };
}

describe("WFO Window — Rolling 生成", () => {
  it("正确生成滚动窗口（长度固定、按 stepSize 前进）", () => {
    const windows = generateWalkForwardWindows(makeConfig());
    expect(windows).toHaveLength(5);
    expect(windows[0]).toMatchObject({
      windowIndex: 0,
      trainRange: { start: "2024-01-01", end: "2024-01-10" },
      validationRange: { start: "2024-01-11", end: "2024-01-15" },
      oosRange: { start: "2024-01-16", end: "2024-01-20" },
    });
    expect(windows[1]).toMatchObject({
      windowIndex: 1,
      trainRange: { start: "2024-01-06", end: "2024-01-15" },
      validationRange: { start: "2024-01-16", end: "2024-01-20" },
      oosRange: { start: "2024-01-21", end: "2024-01-25" },
    });
    expect(windows[4].oosRange.end).toBe("2024-02-09");
  });

  it("窗口按时间顺序严格递增（windowIndex 单调）", () => {
    const windows = generateWalkForwardWindows(makeConfig());
    for (let i = 0; i < windows.length; i++) {
      expect(windows[i]!.windowIndex).toBe(i);
      expect(windows[i]!.oosRange.start > windows[i]!.trainRange.start).toBe(true);
    }
  });

  it("每窗口三段严格无重叠", () => {
    for (const w of generateWalkForwardWindows(makeConfig())) {
      expect(w.trainRange.end < w.validationRange.start).toBe(true);
      expect(w.validationRange.end < w.oosRange.start).toBe(true);
    }
  });

  it("相邻窗口 OOS 不重叠", () => {
    const windows = generateWalkForwardWindows(makeConfig());
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i - 1]!.oosRange.end < windows[i]!.oosRange.start).toBe(true);
    }
  });
});

describe("WFO Window — Expanding 生成", () => {
  it("Train 起点固定、终点向前扩展", () => {
    const windows = generateWalkForwardWindows(makeConfig({ mode: "expanding" }));
    expect(windows).toHaveLength(5);
    expect(windows[0].trainRange).toEqual({ start: "2024-01-01", end: "2024-01-10" });
    expect(windows[1].trainRange).toEqual({ start: "2024-01-01", end: "2024-01-15" });
    expect(windows[4].trainRange).toEqual({ start: "2024-01-01", end: "2024-01-30" });
    // Train 起点恒为 datasetRange.start
    for (const w of windows) {
      expect(w.trainRange.start).toBe("2024-01-01");
    }
  });

  it("Expanding Validation/OOS 向前移动", () => {
    const windows = generateWalkForwardWindows(makeConfig({ mode: "expanding" }));
    expect(windows[0].validationRange).toEqual({ start: "2024-01-11", end: "2024-01-15" });
    expect(windows[1].validationRange).toEqual({ start: "2024-01-16", end: "2024-01-20" });
    expect(windows[0].oosRange).toEqual({ start: "2024-01-16", end: "2024-01-20" });
    expect(windows[1].oosRange).toEqual({ start: "2024-01-21", end: "2024-01-25" });
  });
});

describe("WFO Window — 边界与步长", () => {
  it("stepSize > oosSize 时相邻 OOS 之间留有空档（仍不重叠）", () => {
    const windows = generateWalkForwardWindows(makeConfig({ stepSize: 7 }));
    expect(windows.length).toBeGreaterThan(0);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i - 1]!.oosRange.end < windows[i]!.oosRange.start).toBe(true);
    }
  });

  it("单日区间（trainSize=1 等）合法", () => {
    const windows = generateWalkForwardWindows(makeConfig({
      trainSize: 1,
      validationSize: 1,
      oosSize: 1,
      stepSize: 1,
      datasetRange: { start: "2024-01-01", end: "2024-01-10" },
    }));
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0].trainRange.start).toBe(windows[0].trainRange.end);
  });
});

describe("WFO Window — 非法配置 fail fast", () => {
  it("trainSize <= 0 → invalid", () => {
    expect(validateWalkForwardConfig(makeConfig({ trainSize: 0 })).valid).toBe(false);
    expect(() => generateWalkForwardWindows(makeConfig({ trainSize: 0 }))).toThrow();
  });

  it("validationSize <= 0 → invalid", () => {
    expect(validateWalkForwardConfig(makeConfig({ validationSize: 0 })).valid).toBe(false);
  });

  it("oosSize <= 0 → invalid", () => {
    expect(validateWalkForwardConfig(makeConfig({ oosSize: 0 })).valid).toBe(false);
  });

  it("stepSize <= 0 → invalid", () => {
    expect(validateWalkForwardConfig(makeConfig({ stepSize: 0 })).valid).toBe(false);
  });

  it("stepSize < oosSize → invalid（相邻 OOS 会重叠）", () => {
    const result = validateWalkForwardConfig(makeConfig({ stepSize: 4, oosSize: 5 }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "WFO_STEP_LT_OOS")).toBe(true);
  });

  it("非法 mode → invalid", () => {
    expect(validateWalkForwardConfig(makeConfig({ mode: "random" as WalkForwardMode })).valid).toBe(false);
  });

  it("datasetRange 倒序 → invalid", () => {
    expect(validateWalkForwardConfig(makeConfig({
      datasetRange: { start: "2024-02-09", end: "2024-01-01" },
    })).valid).toBe(false);
  });

  it("非法 selectionMetric → invalid", () => {
    expect(validateWalkForwardConfig(makeConfig({ selectionMetric: "bogus" as WalkForwardConfig["selectionMetric"] })).valid).toBe(false);
  });
});

describe("WFO Window — 数据不足 fail fast", () => {
  it("数据集不足以形成第 0 个完整窗口 → 抛错（非空数组）", () => {
    expect(() => generateWalkForwardWindows(makeConfig({
      trainSize: 100,
      validationSize: 20,
      oosSize: 20,
      stepSize: 20,
      datasetRange: { start: "2024-01-01", end: "2024-01-31" },
    }))).toThrow(/不足以形成|WFO_INSUFFICIENT_DATASET/);
  });
});

describe("WFO Window — Fingerprint 确定性", () => {
  function firstWindow(): Omit<WalkForwardWindow, "fingerprint"> {
    const w = generateWalkForwardWindows(makeConfig())[0]!;
    return { windowIndex: w.windowIndex, mode: w.mode, trainRange: w.trainRange, validationRange: w.validationRange, oosRange: w.oosRange };
  }

  it("相同窗口产生相同 fingerprint", () => {
    expect(computeWindowFingerprint(firstWindow())).toBe(computeWindowFingerprint(firstWindow()));
  });

  it("不同窗口产生不同 fingerprint", () => {
    const windows = generateWalkForwardWindows(makeConfig());
    expect(windows[0]!.fingerprint).not.toBe(windows[1]!.fingerprint);
  });

  it("只改 oosRange 结束日期 → 不同 fingerprint", () => {
    const w = firstWindow();
    const changed = { ...w, oosRange: { ...w.oosRange, end: "2024-01-21" } };
    expect(computeWindowFingerprint(w)).not.toBe(computeWindowFingerprint(changed));
  });

  it("config fingerprint 确定性 + 敏感性", () => {
    expect(computeWalkForwardConfigFingerprint(makeConfig())).toBe(computeWalkForwardConfigFingerprint(makeConfig()));
    expect(computeWalkForwardConfigFingerprint(makeConfig())).not.toBe(
      computeWalkForwardConfigFingerprint(makeConfig({ stepSize: 7 })),
    );
    expect(computeWalkForwardConfigFingerprint(makeConfig())).not.toBe(
      computeWalkForwardConfigFingerprint(makeConfig({ selectionMetric: "maxDrawdownPct", selectionDirection: "minimize" })),
    );
  });

  it("重复生成窗口序列完全一致（deterministic）", () => {
    expect(generateWalkForwardWindows(makeConfig())).toEqual(generateWalkForwardWindows(makeConfig()));
  });
});
