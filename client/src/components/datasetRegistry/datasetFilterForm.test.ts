/**
 * 「构建新版本」筛选面板 — 纯逻辑层单测（STEP DATASET-003B）。
 *
 * 覆盖：默认表单同源、板块勾选、事件行增删改、校验（构建门禁）、wire 载荷整形、摘要文案。
 * 不渲染组件、不触 tRPC / DOM。
 */

import { describe, expect, it } from "vitest";
import {
  DATASET_BOARDS,
  DATASET_BUILD_FILTER_DEFAULTS,
  DATASET_BUILD_FILTER_LIMITS,
} from "@shared/datasetRegistryContracts";
import {
  addEventRow,
  boardOptions,
  buildFilterPayload,
  createDefaultFilterForm,
  describeFilterForm,
  eventKindOptions,
  formatEventRow,
  newEventRowKey,
  parseNumberList,
  relativeDayOptions,
  removeEventRow,
  toggleBoard,
  updateEventRow,
  validateFilterForm,
  type DatasetFilterFormState,
  type FilterEventRow,
} from "./datasetFilterForm";

function form(overrides: Partial<DatasetFilterFormState> = {}): DatasetFilterFormState {
  return { ...createDefaultFilterForm(), ...overrides };
}

function row(relativeDay: string, kind: FilterEventRow["kind"] = "firstBoard"): FilterEventRow {
  return { key: newEventRowKey(), relativeDay, kind };
}

describe("createDefaultFilterForm（与后端权威默认同源）", () => {
  it("默认 = 全板块 / 含 ST / T 日首板 / t-0..t+20", () => {
    const f = createDefaultFilterForm();
    expect(f.boards).toEqual([]);
    expect(f.excludeSt).toBe(false);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]!.relativeDay).toBe("0");
    expect(f.events[0]!.kind).toBe("firstBoard");
    expect(f.preWindowDays).toBe("0");
    expect(f.postWindowDays).toBe("20");
    expect(f.outcomeHorizons).toBe(DATASET_BUILD_FILTER_DEFAULTS.outcomeHorizons.join(","));
    expect(f.batchSize).toBe(String(DATASET_BUILD_FILTER_DEFAULTS.batchSize));
  });

  it("默认表单必须直接通过校验（默认即合法，不能出现「一打开就报错」）", () => {
    expect(validateFilterForm(createDefaultFilterForm())).toBeNull();
  });

  it("每次生成独立行 key（React list key 不冲突）", () => {
    const a = createDefaultFilterForm();
    const b = createDefaultFilterForm();
    expect(a.events[0]!.key).not.toBe(b.events[0]!.key);
  });
});

describe("选项生成", () => {
  it("relativeDayOptions 覆盖 0..min（升序，含 T 日文案）", () => {
    const opts = relativeDayOptions();
    expect(opts[0]).toEqual({ value: "0", label: "T 日（事件日）" });
    expect(opts[opts.length - 1]!.value).toBe(String(DATASET_BUILD_FILTER_LIMITS.relativeDay.min));
    expect(opts).toHaveLength(Math.abs(DATASET_BUILD_FILTER_LIMITS.relativeDay.min) + 1);
    // 不含正数（反未来泄漏）
    expect(opts.every((o) => Number(o.value) <= 0)).toBe(true);
  });

  it("boardOptions / eventKindOptions 与契约枚举一一对应且带中文标签", () => {
    expect(boardOptions().map((o) => o.value)).toEqual([...DATASET_BOARDS]);
    expect(boardOptions().every((o) => o.label.length > 0)).toBe(true);
    expect(eventKindOptions().map((o) => o.value)).toEqual(["firstBoard", "limitUp", "consecutiveBoard"]);
    expect(eventKindOptions().every((o) => o.label.length > 0)).toBe(true);
  });
});

describe("toggleBoard（保持规范顺序、天然去重）", () => {
  it("勾选 / 取消勾选", () => {
    expect(toggleBoard([], "main")).toEqual(["main"]);
    expect(toggleBoard(["main"], "main")).toEqual([]);
    expect(toggleBoard(["main"], "star")).toEqual(["main", "star"]);
  });

  it("结果始终按 DATASET_BOARDS 规范顺序（勾选顺序不影响载荷）", () => {
    let boards = toggleBoard([], "bse");
    boards = toggleBoard(boards, "main");
    boards = toggleBoard(boards, "chinext");
    expect(boards).toEqual(["main", "chinext", "bse"]);
    expect(boards).toEqual(DATASET_BOARDS.filter((b) => boards.includes(b)));
  });

  it("不产生重复项", () => {
    const once = toggleBoard([], "main");
    const twice = toggleBoard(once, "main");
    const thrice = toggleBoard(twice, "main");
    expect(thrice).toEqual(["main"]);
  });
});

describe("事件维度行增删改", () => {
  it("addEventRow 自动挑未使用的组合，避免「一加就重复报错」", () => {
    const rows = [row("0", "firstBoard")];
    const next = addEventRow(rows);
    expect(next).toHaveLength(2);
    const keys = next.map((r) => `${r.relativeDay}:${r.kind}`);
    expect(new Set(keys).size).toBe(2);
    expect(validateFilterForm(form({ events: next }))).toBeNull();
  });

  it("removeEventRow 保底 1 条（不允许删空）", () => {
    const one = [row("0", "firstBoard")];
    expect(removeEventRow(one, one[0]!.key)).toHaveLength(1);
    const two = [row("0", "firstBoard"), row("-1", "limitUp")];
    expect(removeEventRow(two, two[0]!.key)).toHaveLength(1);
  });

  it("updateEventRow 只改目标行", () => {
    const rows = [row("0", "firstBoard"), row("-1", "limitUp")];
    const next = updateEventRow(rows, rows[1]!.key, { relativeDay: "-2" });
    expect(next[0]!.relativeDay).toBe("0");
    expect(next[1]!.relativeDay).toBe("-2");
    expect(next[1]!.kind).toBe("limitUp");
  });

  it("formatEventRow 文案（T 日 / T-n 日）", () => {
    expect(formatEventRow({ relativeDay: "0", kind: "firstBoard" })).toContain("T 日");
    expect(formatEventRow({ relativeDay: "-1", kind: "limitUp" })).toContain("T-1 日");
  });
});

describe("validateFilterForm（构建门禁）", () => {
  it("事件维度为空 → 拒绝（「未完成筛选配置不得构建」）", () => {
    expect(validateFilterForm(form({ events: [] }))).toContain("至少配置一个事件维度");
  });

  it("超过事件维度上限 → 拒绝", () => {
    const many = Array.from({ length: DATASET_BUILD_FILTER_LIMITS.maxEvents + 1 }, (_, i) =>
      row(String(-i), "firstBoard"),
    );
    expect(validateFilterForm(form({ events: many }))).toContain("最多");
  });

  it("相对日非法 / 越界 → 拒绝", () => {
    expect(validateFilterForm(form({ events: [row("", "firstBoard")] }))).toContain("相对日非法");
    expect(validateFilterForm(form({ events: [row("abc", "firstBoard")] }))).toContain("相对日非法");
    expect(validateFilterForm(form({ events: [row("1", "firstBoard")] }))).toContain("相对日须在");
    expect(
      validateFilterForm(
        form({ events: [row(String(DATASET_BUILD_FILTER_LIMITS.relativeDay.min - 1), "firstBoard")] }),
      ),
    ).toContain("相对日须在");
  });

  it("事件维度重复 → 拒绝（与后端 superRefine 同口径）", () => {
    expect(validateFilterForm(form({ events: [row("0", "firstBoard"), row("0", "firstBoard")] }))).toContain(
      "重复",
    );
  });

  it("前后窗口越界 / 非整数 → 拒绝", () => {
    expect(validateFilterForm(form({ preWindowDays: "-1" }))).toContain("t 日之前");
    expect(validateFilterForm(form({ preWindowDays: "999" }))).toContain("t 日之前");
    expect(validateFilterForm(form({ postWindowDays: "0" }))).toContain("t 日之后");
    expect(validateFilterForm(form({ postWindowDays: "" }))).toContain("t 日之后");
  });

  it("结果视界空 / 越界 / 重复 → 拒绝", () => {
    expect(validateFilterForm(form({ outcomeHorizons: "" }))).toContain("至少一个结果视界");
    expect(validateFilterForm(form({ outcomeHorizons: "0" }))).toContain("结果视界须为");
    expect(validateFilterForm(form({ outcomeHorizons: "5,5" }))).toContain("重复");
  });

  it("批大小非法 → 拒绝", () => {
    expect(validateFilterForm(form({ batchSize: "0" }))).toContain("批大小");
    expect(validateFilterForm(form({ batchSize: "abc" }))).toContain("批大小");
  });

  it("合法组合（板块 + 排除 ST + 多事件 + 前置窗口）→ 通过", () => {
    const ok = form({
      boards: ["main", "chinext"],
      excludeSt: true,
      events: [row("0", "firstBoard"), row("-1", "consecutiveBoard")],
      preWindowDays: "5",
      postWindowDays: "20",
    });
    expect(validateFilterForm(ok)).toBeNull();
  });
});

describe("buildFilterPayload（表单 → wire）", () => {
  it("数字字符串转 number，事件按相对日升序，视界去重升序", () => {
    const payload = buildFilterPayload(
      form({
        boards: ["main"],
        excludeSt: true,
        events: [row("0", "firstBoard"), row("-3", "limitUp"), row("-1", "consecutiveBoard")],
        preWindowDays: "5",
        postWindowDays: "20",
        outcomeHorizons: "20,5,10,5",
        batchSize: "500",
      }),
    );
    expect(payload).toEqual({
      boards: ["main"],
      excludeSt: true,
      events: [
        { relativeDay: -3, kind: "limitUp" },
        { relativeDay: -1, kind: "consecutiveBoard" },
        { relativeDay: 0, kind: "firstBoard" },
      ],
      preWindowDays: 5,
      postWindowDays: 20,
      outcomeHorizons: [5, 10, 20],
      batchSize: 500,
    });
  });

  it("默认表单 → 与后端权威默认等值载荷", () => {
    expect(buildFilterPayload(createDefaultFilterForm())).toEqual({
      boards: [],
      excludeSt: false,
      events: [{ relativeDay: 0, kind: "firstBoard" }],
      preWindowDays: 0,
      postWindowDays: 20,
      outcomeHorizons: [...DATASET_BUILD_FILTER_DEFAULTS.outcomeHorizons],
      batchSize: DATASET_BUILD_FILTER_DEFAULTS.batchSize,
    });
  });

  it("payload 必须能被同一校验放过（校验与整形口径一致）", () => {
    const f = createDefaultFilterForm();
    expect(validateFilterForm(f)).toBeNull();
    const p = buildFilterPayload(f);
    expect(p.events.length).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(p.preWindowDays)).toBe(true);
  });
});

describe("parseNumberList", () => {
  it("忽略空白项并转数字", () => {
    expect(parseNumberList("5, 10 ,20")).toEqual([5, 10, 20]);
    expect(parseNumberList("  ")).toEqual([]);
    expect(parseNumberList("")).toEqual([]);
  });
});

describe("describeFilterForm（唯一文案来源）", () => {
  it("默认摘要含全板块 / 含ST / T日首板 / t-0..t+20", () => {
    const s = describeFilterForm(createDefaultFilterForm());
    expect(s).toContain("全板块");
    expect(s).toContain("含ST");
    expect(s).toContain("t-0..t+20");
  });

  it("自定义摘要反映板块 / 排除ST / 多事件", () => {
    const s = describeFilterForm(
      form({
        boards: ["main", "chinext"],
        excludeSt: true,
        events: [row("0", "firstBoard"), row("-1", "limitUp")],
        preWindowDays: "5",
      }),
    );
    expect(s).toContain("排除ST");
    expect(s).toContain("t-5..t+20");
    expect(s.split("+").length).toBeGreaterThan(1);
  });
});
