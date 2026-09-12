/**
 * 增量补跑前端门禁单测。
 *
 * 重点：**不可点时必须给出具体原因**，而不是一个没有解释的灰按钮 ——
 * 「Run 已 COMPLETED → 正解是补跑而不是整轮重跑」这条引导，就是这个模块存在的理由。
 */

import { describe, expect, it } from "vitest";
import {
  countRunnableAnalyses,
  incrementalAvailability,
  isRunBusy,
  isRunnableAnalysisStatus,
} from "./incrementalRunForm";

describe("incrementalRunForm — 状态判定", () => {
  it("可补跑状态 = PENDING / FAILED / CANCELLED", () => {
    expect(isRunnableAnalysisStatus("PENDING")).toBe(true);
    expect(isRunnableAnalysisStatus("FAILED")).toBe(true);
    expect(isRunnableAnalysisStatus("CANCELLED")).toBe(true);
    expect(isRunnableAnalysisStatus("COMPLETED")).toBe(false);
    expect(isRunnableAnalysisStatus("RUNNING")).toBe(false);
  });

  it("Run 忙碌状态 = RUNNING", () => {
    expect(isRunBusy("RUNNING")).toBe(true);
    expect(isRunBusy("COMPLETED")).toBe(false);
    expect(isRunBusy("PENDING")).toBe(false);
    expect(isRunBusy("FAILED")).toBe(false);
  });
});

describe("incrementalRunForm — 补跑门禁", () => {
  it("Run 整轮完成 + 分析待跑 + 有基准快照 → 可补跑，且说明「复用基准 / 不重跑 / 不生成结论」", () => {
    const a = incrementalAvailability({
      runStatus: "COMPLETED",
      analysisStatus: "PENDING",
      hasSnapshot: true,
    });
    expect(a.enabled).toBe(true);
    expect(a.hint).toContain("复用");
    expect(a.hint).toContain("不重跑");
    expect(a.hint).toContain("不生成结论");
  });

  it("FAILED / CANCELLED 的分析同样可补跑", () => {
    for (const status of ["FAILED", "CANCELLED"]) {
      expect(
        incrementalAvailability({ runStatus: "COMPLETED", analysisStatus: status, hasSnapshot: true }).enabled,
      ).toBe(true);
    }
  });

  it("RUNNING 的 Run → 不可补跑，原因指明「正在执行中」", () => {
    const a = incrementalAvailability({
      runStatus: "RUNNING",
      analysisStatus: "PENDING",
      hasSnapshot: true,
    });
    expect(a.enabled).toBe(false);
    expect(a.reason).toContain("正在执行中");
  });

  it("已 COMPLETED 的分析 → 不可补跑，原因说清「不覆盖、要重跑请新建 Run」", () => {
    const a = incrementalAvailability({
      runStatus: "COMPLETED",
      analysisStatus: "COMPLETED",
      hasSnapshot: true,
    });
    expect(a.enabled).toBe(false);
    expect(a.reason).toContain("不会覆盖");
    expect(a.reason).toContain("新建 Run");
  });

  it("没有基准快照（从未整轮执行）→ 不可补跑，且引导去点「运行引擎」", () => {
    const a = incrementalAvailability({
      runStatus: "PENDING",
      analysisStatus: "PENDING",
      hasSnapshot: false,
    });
    expect(a.enabled).toBe(false);
    expect(a.reason).toContain("运行引擎");
  });

  it("RUNNING 的判定优先级高于快照缺失（先说最直接的原因）", () => {
    const a = incrementalAvailability({
      runStatus: "RUNNING",
      analysisStatus: "PENDING",
      hasSnapshot: false,
    });
    expect(a.enabled).toBe(false);
    expect(a.reason).toContain("正在执行中");
  });

  it("分析状态非法（RUNNING）→ 不可补跑", () => {
    const a = incrementalAvailability({
      runStatus: "COMPLETED",
      analysisStatus: "RUNNING",
      hasSnapshot: true,
    });
    expect(a.enabled).toBe(false);
    expect(a.reason).toContain("RUNNING");
  });
});

describe("incrementalRunForm — 待补跑计数（Run 卡片引导用）", () => {
  it("只数尚无有效结果的分析", () => {
    expect(
      countRunnableAnalyses("COMPLETED", ["COMPLETED", "PENDING", "FAILED"], true),
    ).toBe(2);
  });

  it("Run 忙碌 / 无快照 → 计 0（避免给出无法执行的引导）", () => {
    expect(countRunnableAnalyses("RUNNING", ["PENDING"], true)).toBe(0);
    expect(countRunnableAnalyses("PENDING", ["PENDING"], false)).toBe(0);
  });

  it("全部完成 → 0", () => {
    expect(countRunnableAnalyses("COMPLETED", ["COMPLETED", "COMPLETED"], true)).toBe(0);
  });
});
