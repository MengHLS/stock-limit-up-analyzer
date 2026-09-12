/**
 * RESEARCH-002 — Run 执行批次日志规则单测。
 *
 * 重点锁住三件容易被"顺手改坏"的事：
 *   1. **结构非法必须响亮失败**（不能把「记录坏了」静默降级成「没有记录」）；
 *   2. **批次号推进的版本边界**：`inputSnapshot` 存在但日志为空 ⇒ 下一批是 2（不是 1），
 *      因为 batch 1 发生在日志列生效之前 —— 不 backfill 伪造历史；
 *   3. **追加式语义**：append / settle 都返回新数组，不就地修改入参。
 */

import { describe, expect, it } from "vitest";
import {
  ResearchExecutionLogError,
  appendExecutionLogEntry,
  assertResearchRunExecutionLog,
  nextExecutionSequence,
  settleExecutionLogEntry,
} from "./executionLog";
import type { ResearchRunExecutionLogEntry } from "./types";

function entry(overrides: Partial<ResearchRunExecutionLogEntry> = {}): ResearchRunExecutionLogEntry {
  return {
    sequence: 1,
    mode: "FULL",
    analysisIds: [1],
    sampleCount: 100,
    status: "COMPLETED",
    startedAt: "2026-09-11T10:00:00.000Z",
    completedAt: "2026-09-11T10:00:09.000Z",
    ...overrides,
  };
}

describe("assertResearchRunExecutionLog — 结构校验", () => {
  it("null / undefined → 空数组（不是未定义语义）", () => {
    expect(assertResearchRunExecutionLog(null)).toEqual([]);
    expect(assertResearchRunExecutionLog(undefined)).toEqual([]);
  });

  it("非数组 → 抛错（不静默当空）", () => {
    expect(() => assertResearchRunExecutionLog({ sequence: 1 })).toThrow(ResearchExecutionLogError);
    expect(() => assertResearchRunExecutionLog("[]")).toThrow(ResearchExecutionLogError);
  });

  it("缺 sequence / sequence 非正整数 → 抛错", () => {
    expect(() => assertResearchRunExecutionLog([{ ...entry(), sequence: undefined }])).toThrow(
      /sequence/,
    );
    expect(() => assertResearchRunExecutionLog([entry({ sequence: 0 })])).toThrow(/sequence/);
    expect(() => assertResearchRunExecutionLog([entry({ sequence: 1.5 })])).toThrow(/sequence/);
  });

  it("mode / status 越界 → 抛错", () => {
    expect(() => assertResearchRunExecutionLog([{ ...entry(), mode: "PARTIAL" }])).toThrow(/mode/);
    expect(() => assertResearchRunExecutionLog([{ ...entry(), status: "SKIPPED" }])).toThrow(/status/);
  });

  it("analysisIds 非数字数组 → 抛错", () => {
    expect(() => assertResearchRunExecutionLog([{ ...entry(), analysisIds: ["1"] }])).toThrow(
      /analysisIds/,
    );
  });

  it("startedAt 缺失 → 抛错（无法判断批次先后）", () => {
    expect(() => assertResearchRunExecutionLog([{ ...entry(), startedAt: "" }])).toThrow(/startedAt/);
  });

  it("可选字段保留，未知字段丢弃", () => {
    const parsed = assertResearchRunExecutionLog([
      { ...entry({ sequence: 2, mode: "INCREMENTAL" }), conclusionSkippedReason: "X", bogus: 1 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.conclusionSkippedReason).toBe("X");
    expect(Object.keys(parsed[0]!)).not.toContain("bogus");
  });

  it("失败批次：errorCode / errorMessage 保留，sampleCount 可为 null", () => {
    const parsed = assertResearchRunExecutionLog([
      entry({ sequence: 3, status: "FAILED", sampleCount: null, errorCode: "E", errorMessage: "boom" }),
    ]);
    expect(parsed[0]!.status).toBe("FAILED");
    expect(parsed[0]!.sampleCount).toBeNull();
    expect(parsed[0]!.errorCode).toBe("E");
  });
});

describe("nextExecutionSequence — 批次号推进", () => {
  it("全新 Run（无日志、无快照）→ 1", () => {
    expect(nextExecutionSequence({ executionLog: null, inputSnapshot: null })).toBe(1);
  });

  it("🔴 版本边界：有快照但日志为空 → 2（batch 1 已被历史占用，不伪造）", () => {
    expect(
      nextExecutionSequence({ executionLog: null, inputSnapshot: { datasetVersionId: 390001 } }),
    ).toBe(2);
  });

  it("日志最大序号 + 1", () => {
    expect(
      nextExecutionSequence({
        executionLog: [entry({ sequence: 1 }), entry({ sequence: 2, mode: "INCREMENTAL" })],
        inputSnapshot: { datasetVersionId: 390001 },
      }),
    ).toBe(3);
  });

  it("日志序号乱序时取最大值", () => {
    expect(
      nextExecutionSequence({
        executionLog: [entry({ sequence: 3 }), entry({ sequence: 1 })],
        inputSnapshot: null,
      }),
    ).toBe(4);
  });
});

describe("appendExecutionLogEntry — 追加式", () => {
  it("追加到末尾且**不修改入参**", () => {
    const original = [entry({ sequence: 1 })];
    const next = appendExecutionLogEntry(
      { executionLog: original },
      entry({ sequence: 2, mode: "INCREMENTAL" }),
    );
    expect(original).toHaveLength(1); // 入参未被就地修改
    expect(next).toHaveLength(2);
    expect(next[1]!.sequence).toBe(2);
  });

  it("批次号重复 → 抛错（不静默覆盖）", () => {
    expect(() =>
      appendExecutionLogEntry({ executionLog: [entry({ sequence: 2 })] }, entry({ sequence: 2 })),
    ).toThrow(/已存在/);
  });

  it("从空日志追加首个条目", () => {
    expect(appendExecutionLogEntry({ executionLog: null }, entry({ sequence: 1 }))).toHaveLength(1);
  });
});

describe("settleExecutionLogEntry — 收敛批次终态", () => {
  it("按 sequence 就地替换终态字段，不动其它条目", () => {
    const settled = settleExecutionLogEntry(
      { executionLog: [entry({ sequence: 1, status: "RUNNING", completedAt: null, sampleCount: null }), entry({ sequence: 2 })] },
      1,
      { status: "COMPLETED", completedAt: "2026-09-11T11:00:00.000Z", sampleCount: 1130 },
    );
    expect(settled[0]!.status).toBe("COMPLETED");
    expect(settled[0]!.sampleCount).toBe(1130);
    expect(settled[1]!.sequence).toBe(2);
  });

  it("批次号不存在 → 抛错（不静默新增）", () => {
    expect(() => settleExecutionLogEntry({ executionLog: [entry({ sequence: 1 })] }, 9, { status: "FAILED" })).toThrow(
      /不存在/,
    );
  });

  it("settle 后长度不变（只收敛，不追加）", () => {
    const before = [entry({ sequence: 1 })];
    const after = settleExecutionLogEntry({ executionLog: before }, 1, { status: "FAILED" });
    expect(after).toHaveLength(before.length);
  });
});
