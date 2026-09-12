/**
 * RESEARCH-004 — SEGMENT_RELATION 的窗解析 / 可用性 / 重叠守卫单测。
 *
 * 这里锁定的是「错一点就会让结论变成同义反复」的四件事：
 *   1. 窗形态（二元整数、`0 ≤ from < to`）—— 解析器不许把 `[5, 5]` 夹成 `[5, 6]`；
 *   2. 口径合法性 —— 必须在 `SEGMENT_STAT_KINDS` 内；
 *   3. **可用性** —— 映射出的变量名必须真的存在于该 Dataset 的目录里：
 *      `from = 0` 走既有族（`max_return_*` 只有 outcome 视界），`from > 0` 走分段族（受 path 上下界约束）；
 *   4. **重叠守卫 `WINDOW_OVERLAP`** —— 两窗取值区间有交集即拒绝。
 *
 * 目录刻意与真实 Dataset 同构：path = 1..20、outcome = {5,10,20}。
 */

import { describe, expect, it } from "vitest";
import type { ResearchAnalysis } from "../researchCore";
import { resolveEngineAnalysisConfig } from "./analysisConfig";
import { ResearchEngineError } from "./errors";
import { ResearchVariableCatalog } from "./variables";

const catalog = new ResearchVariableCatalog(
  [5, 10, 20],
  Array.from({ length: 20 }, (_, i) => i + 1),
);

function analysis(config: unknown): ResearchAnalysis {
  return {
    id: 4242,
    runId: 1,
    analysisType: "SEGMENT_RELATION",
    name: "分段关系-test",
    config,
    status: "PENDING",
  };
}

function resolve(config: unknown) {
  return resolveEngineAnalysisConfig({ analysis: analysis(config), catalog });
}

/** 取「失败时的错误码」；没有抛错则返回 undefined（断言用，避免 each 里堆 try/catch）。 */
function codeOf(config: unknown): string | undefined {
  try {
    resolve(config);
    return undefined;
  } catch (error) {
    return error instanceof ResearchEngineError ? error.code : `NOT_ENGINE_ERROR:${String(error)}`;
  }
}

/** 合法基准：窗 A = [0,5] 最大跌幅（复用既有 `max_drawdown_5d`），窗 B = [5,20] 分段收益。 */
const VALID = {
  windowA: [0, 5],
  windowAStat: "max_drawdown",
  windowB: [5, 20],
  windowBStat: "return",
  windowBands: 5,
} as const;

describe("SEGMENT_RELATION 窗解析", () => {
  it("合法两窗原样透传，并映射到真实变量名", () => {
    const resolved = resolve(VALID);
    expect(resolved.windowA).toEqual([0, 5]);
    expect(resolved.windowB).toEqual([5, 20]);
    expect(resolved.windowAStat).toBe("max_drawdown");
    expect(resolved.windowBStat).toBe("return");
    expect(resolved.windowBands).toBe(5);
    // 窗参数字段是「已解析配置」的一部分（执行器靠它装配变量，不再自己拼名字）
    expect(resolved.targetVariable).toBeUndefined();
    expect(resolved.featureVariable).toBeUndefined();
  });

  it("窗起点为 0 时复用既有变量族（不另造一套口径）", () => {
    // 窗 A 锚在事件日 ⇒ max_drawdown_5d 必须可用（它来自 outcome 视界 5）
    expect(() => resolve({ ...VALID, windowA: [0, 10], windowAStat: "max_drawdown", windowB: [10, 20] })).not.toThrow();
    // 反之，锚在 T 的 max_return_3d 不存在（outcome 只有 5/10/20）⇒ 具名失败，不静默兜底
    expect(codeOf({ ...VALID, windowA: [0, 3], windowAStat: "max_return", windowB: [3, 20] })).toBe(
      "INVALID_ANALYSIS_CONFIG",
    );
  });

  it("窗形态非法一律具名失败（畸形 / 非整数 / from < 0 / to ≤ from）", () => {
    for (const bad of [
      { windowA: [5] },
      { windowA: "0,5" },
      { windowA: [0.5, 5] },
      { windowA: [-1, 5] },
      { windowA: [5, 5] },
      { windowA: [20, 5] },
    ]) {
      expect(codeOf({ ...VALID, ...bad }), JSON.stringify(bad)).toBe("INVALID_ANALYSIS_CONFIG");
    }
  });

  it("口径必须在 SEGMENT_STAT_KINDS 内", () => {
    expect(codeOf({ ...VALID, windowAStat: "sharpe" })).toBe("INVALID_ANALYSIS_CONFIG");
    expect(codeOf({ ...VALID, windowBStat: undefined })).toBe("INVALID_ANALYSIS_CONFIG");
  });

  it("缺窗不给默认值（替用户猜一个窗等于替他选题）", () => {
    expect(codeOf({ windowB: [5, 20], windowBStat: "return" })).toBe("INVALID_ANALYSIS_CONFIG");
    expect(codeOf({})).toBe("INVALID_ANALYSIS_CONFIG");
  });

  it("分段窗超出真实 path 视界 ⇒ INVALID_ANALYSIS_CONFIG（不返回 null 冒充可用）", () => {
    expect(codeOf({ ...VALID, windowB: [15, 25] })).toBe("INVALID_ANALYSIS_CONFIG");
    expect(codeOf({ ...VALID, windowB: [5, 20], windowA: [0, 5] })).toBeUndefined();
  });

  it("windowBands 必须是 2..100 的整数", () => {
    for (const bands of [1, 0, 101, 2.5, "5"]) {
      expect(codeOf({ ...VALID, windowBands: bands }), String(bands)).toBe("INVALID_ANALYSIS_CONFIG");
    }
    expect(codeOf({ ...VALID, windowBands: 2 })).toBeUndefined();
    expect(codeOf({ ...VALID, windowBands: 100 })).toBeUndefined();
  });
});

describe("SEGMENT_RELATION 重叠守卫（WINDOW_OVERLAP）", () => {
  it("紧邻窗（[0,5] 与 [5,20]）不算重叠 —— 锚点日只提供基准价", () => {
    // 取值区间分别是 [1,5] 与 [6,20]
    expect(codeOf(VALID)).toBeUndefined();
  });

  it("取值区间相交即拒绝，且错误码是 WINDOW_OVERLAP（不是笼统的配置非法）", () => {
    expect(codeOf({ ...VALID, windowA: [0, 10], windowB: [5, 20] })).toBe("WINDOW_OVERLAP");
    // 窗 A 作为「结果窗」在下、窗 B 作为「分组窗」在上的反序排列同样拒绝
    expect(codeOf({ ...VALID, windowA: [5, 20], windowB: [0, 8] })).toBe("WINDOW_OVERLAP");
  });

  it("重叠时错误信息把两个取值区间与建议写法都说清楚", () => {
    try {
      resolve({ ...VALID, windowA: [0, 10], windowB: [5, 20] });
      throw new Error("应当抛错");
    } catch (error) {
      const message = (error as ResearchEngineError).message;
      expect(message).toContain("T+1..T+10");
      expect(message).toContain("T+6..T+20");
      expect(message).toContain("同义反复");
    }
  });

  it("完全分离的窗通过（窗 A 在后段、窗 B 在更后段）", () => {
    expect(
      codeOf({ windowA: [5, 10], windowAStat: "max_drawdown", windowB: [10, 20], windowBStat: "return", windowBands: 3 }),
    ).toBeUndefined();
  });
});
