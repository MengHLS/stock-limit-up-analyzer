/**
 * STEP DATASET-003B — 筛选口径纯函数测试。
 *
 * 本文件只测「客观市场事实判定 + 筛选语义边界」，不触任何 IO / DB：
 *   - `matchesEventKind` / `matchesEventSpec` / `matchesAnyEventSpec`：三类事件类型的真值表；
 *   - `isBoardAllowed`：空数组 = 不过滤、unknown（null）不入选；
 *   - `isStExcluded`：仅 excludeSt=true 且 PIT 状态为 ST/*ST 才剔除；
 *   - `maxLookbackDays`：负锚点回看深度（warm-up 预算），正数/非法值不放大回看。
 */

import { describe, expect, it } from "vitest";
import {
  BUILD_FILTER_DEFAULTS,
  BUILD_FILTER_LIMITS,
  eventSpecKey,
  isBoardAllowed,
  isStExcluded,
  matchesAnyEventSpec,
  matchesEventKind,
  matchesEventSpec,
  maxLookbackDays,
} from "./filter";
import { DATASET_BOARDS, DATASET_BUILD_FILTER_DEFAULTS } from "@shared/datasetRegistryContracts";

describe("matchesEventKind（事件类型真值表）", () => {
  it("limitUp：只看锚点日是否涨停", () => {
    expect(matchesEventKind("limitUp", true, true)).toBe(true);
    expect(matchesEventKind("limitUp", true, false)).toBe(true);
    expect(matchesEventKind("limitUp", false, true)).toBe(false);
    expect(matchesEventKind("limitUp", false, false)).toBe(false);
  });

  it("firstBoard：锚点日涨停且锚点前一日不涨停", () => {
    expect(matchesEventKind("firstBoard", true, false)).toBe(true);
    expect(matchesEventKind("firstBoard", true, true)).toBe(false); // 连板
    expect(matchesEventKind("firstBoard", false, false)).toBe(false);
    expect(matchesEventKind("firstBoard", false, true)).toBe(false);
  });

  it("consecutiveBoard：锚点日与前一日都涨停", () => {
    expect(matchesEventKind("consecutiveBoard", true, true)).toBe(true);
    expect(matchesEventKind("consecutiveBoard", true, false)).toBe(false);
    expect(matchesEventKind("consecutiveBoard", false, true)).toBe(false);
  });

  it("firstBoard 与 consecutiveBoard 互斥且覆盖「今日涨停」全集", () => {
    for (const prev of [true, false]) {
      expect(matchesEventKind("firstBoard", true, prev) || matchesEventKind("consecutiveBoard", true, prev)).toBe(true);
      expect(matchesEventKind("firstBoard", true, prev) && matchesEventKind("consecutiveBoard", true, prev)).toBe(false);
    }
  });
});

describe("matchesEventSpec / matchesAnyEventSpec（OR 语义）", () => {
  it("单条规格透传 kind 判定", () => {
    expect(matchesEventSpec({ relativeDay: -1, kind: "firstBoard" }, true, false)).toBe(true);
    expect(matchesEventSpec({ relativeDay: 0, kind: "consecutiveBoard" }, true, false)).toBe(false);
  });

  it("任一规格命中即收录（T日首板 OR T-1日涨停）", () => {
    const specs = [
      { relativeDay: 0, kind: "firstBoard" as const },
      { relativeDay: -1, kind: "limitUp" as const },
    ];
    // 今日连板（firstBoard 不中），但锚点前一日涨停（limitUp 中）→ 收录
    expect(matchesAnyEventSpec(specs, true, true)).toBe(true);
    // 今日不涨停 → 全不中
    expect(matchesAnyEventSpec(specs, false, true)).toBe(false);
  });

  it("空规格列表恒不命中（调用方有契约层保证至少 1 条，此处防御）", () => {
    expect(matchesAnyEventSpec([], true, true)).toBe(false);
  });
});

describe("eventSpecKey（去重键）", () => {
  it("同相对日同类型 → 同键；任一不同 → 不同键", () => {
    expect(eventSpecKey({ relativeDay: -1, kind: "firstBoard" })).toBe("-1:firstBoard");
    expect(eventSpecKey({ relativeDay: -1, kind: "firstBoard" })).toBe(eventSpecKey({ relativeDay: -1, kind: "firstBoard" }));
    expect(eventSpecKey({ relativeDay: 0, kind: "firstBoard" })).not.toBe(eventSpecKey({ relativeDay: -1, kind: "firstBoard" }));
    expect(eventSpecKey({ relativeDay: -1, kind: "firstBoard" })).not.toBe(eventSpecKey({ relativeDay: -1, kind: "limitUp" }));
  });
});

describe("isBoardAllowed（Universe 层板块，空数组 = 不过滤）", () => {
  it("空数组放行一切（含 unknown）", () => {
    for (const b of [...DATASET_BOARDS, "unknown", null, undefined]) {
      expect(isBoardAllowed([], b)).toBe(true);
    }
  });

  it("显式选择时按集合放行", () => {
    expect(isBoardAllowed(["main"], "main")).toBe(true);
    expect(isBoardAllowed(["main"], "chinext")).toBe(false);
    expect(isBoardAllowed(["main", "star"], "star")).toBe(true);
  });

  it("显式选择时 unknown（null/undefined/未知板块）不入选", () => {
    expect(isBoardAllowed(["main"], null)).toBe(false);
    expect(isBoardAllowed(["main"], undefined)).toBe(false);
    expect(isBoardAllowed(["main"], "unknown")).toBe(false);
  });
});

describe("isStExcluded（PIT ST 维度）", () => {
  it("excludeSt=false 恒放行", () => {
    for (const st of ["NORMAL", "ST", "*ST", "UNKNOWN", null, undefined]) {
      expect(isStExcluded(false, st)).toBe(false);
    }
  });

  it("excludeSt=true 只剔除 ST/*ST", () => {
    expect(isStExcluded(true, "ST")).toBe(true);
    expect(isStExcluded(true, "*ST")).toBe(true);
    expect(isStExcluded(true, "NORMAL")).toBe(false);
    expect(isStExcluded(true, "UNKNOWN")).toBe(false); // 状态未知不武断剔除
    expect(isStExcluded(true, null)).toBe(false);
  });
});

describe("maxLookbackDays（负锚点回看深度 / warm-up 预算）", () => {
  it("全为 T 日（0）→ 0（但 builder 仍至少预热 1 日用于首板判定）", () => {
    expect(maxLookbackDays([{ relativeDay: 0, kind: "firstBoard" }])).toBe(0);
  });

  it("取负锚点绝对值的最大值", () => {
    expect(maxLookbackDays([
      { relativeDay: 0, kind: "firstBoard" },
      { relativeDay: -3, kind: "limitUp" },
      { relativeDay: -1, kind: "consecutiveBoard" },
    ])).toBe(3);
  });

  it("非有限值按 0 处理，不放大回看预算", () => {
    expect(maxLookbackDays([{ relativeDay: Number.NaN, kind: "firstBoard" }])).toBe(0);
    expect(maxLookbackDays([{ relativeDay: Number.POSITIVE_INFINITY, kind: "firstBoard" }])).toBe(0);
  });

  it("空列表 → 0", () => {
    expect(maxLookbackDays([])).toBe(0);
  });
});

describe("默认值与边界常量（双端同源约束）", () => {
  it("server BUILD_FILTER_DEFAULTS 与 shared DATASET_BUILD_FILTER_DEFAULTS 完全一致", () => {
    expect(BUILD_FILTER_DEFAULTS.boards).toEqual(DATASET_BUILD_FILTER_DEFAULTS.boards);
    expect(BUILD_FILTER_DEFAULTS.excludeSt).toBe(DATASET_BUILD_FILTER_DEFAULTS.excludeSt);
    expect(BUILD_FILTER_DEFAULTS.events).toEqual(DATASET_BUILD_FILTER_DEFAULTS.events);
    expect(BUILD_FILTER_DEFAULTS.preWindowDays).toBe(DATASET_BUILD_FILTER_DEFAULTS.preWindowDays);
    expect(BUILD_FILTER_DEFAULTS.postWindowDays).toBe(DATASET_BUILD_FILTER_DEFAULTS.postWindowDays);
    expect(BUILD_FILTER_DEFAULTS.outcomeHorizons).toEqual(DATASET_BUILD_FILTER_DEFAULTS.outcomeHorizons);
    expect(BUILD_FILTER_DEFAULTS.batchSize).toBe(DATASET_BUILD_FILTER_DEFAULTS.batchSize);
  });

  it("缺省口径 = 全板块 / 含 ST / T 日首板 / t-0..t+20（历史可比性）", () => {
    expect(BUILD_FILTER_DEFAULTS.boards).toEqual([]);
    expect(BUILD_FILTER_DEFAULTS.excludeSt).toBe(false);
    expect(BUILD_FILTER_DEFAULTS.events).toEqual([{ relativeDay: 0, kind: "firstBoard" }]);
    expect(BUILD_FILTER_DEFAULTS.preWindowDays).toBe(0);
    expect(BUILD_FILTER_DEFAULTS.postWindowDays).toBe(20);
  });

  it("相对日上限 0（反未来泄漏：契约层与纯函数层双层禁止正锚点）", () => {
    expect(BUILD_FILTER_LIMITS.relativeDay.max).toBe(0);
    // 上游契约 zod 也不接受正锚点（此处只断言常量口径，schema 侧由契约测试覆盖）
    expect(matchesEventSpec({ relativeDay: -1, kind: "limitUp" }, true, false)).toBe(true);
  });
});
