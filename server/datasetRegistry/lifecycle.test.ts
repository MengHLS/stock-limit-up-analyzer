/**
 * STEP DATASET-002.4A — 状态机 + 进度纯函数单测（不触 DB）。
 *
 * 覆盖：Version / Build Job 合法与非法转换、terminal 语义、构建进度（0/中间/100/unknown）。
 */

import { describe, expect, it } from "vitest";
import {
  assertJobTransition,
  assertVersionTransition,
  canTransitionJob,
  canTransitionVersion,
  computeBuildProgress,
  DatasetLifecycleError,
  isTerminalJobStatus,
  isVersionBuildable,
} from "./lifecycle";

describe("DATASET-002.4A · Version 状态机", () => {
  it("合法转换：DRAFT→BUILDING→READY；BUILDING→FAILED", () => {
    expect(canTransitionVersion("DRAFT", "BUILDING")).toBe(true);
    expect(canTransitionVersion("BUILDING", "READY")).toBe(true);
    expect(canTransitionVersion("BUILDING", "FAILED")).toBe(true);
  });

  it("重试/重建：FAILED→BUILDING、READY→BUILDING", () => {
    expect(canTransitionVersion("FAILED", "BUILDING")).toBe(true);
    expect(canTransitionVersion("READY", "BUILDING")).toBe(true);
  });

  it("非法转换被拒绝（含 schema 未定义的 CANCELLED/ACTIVE/ARCHIVED）", () => {
    expect(canTransitionVersion("DRAFT", "READY")).toBe(false);
    expect(canTransitionVersion("BUILDING", "BUILDING")).toBe(false);
    expect(canTransitionVersion("READY", "FAILED")).toBe(false);
    expect(canTransitionVersion("FAILED", "READY")).toBe(false);
    // schema 无这些状态，转换表不含它们 → 一律 false
    expect(canTransitionVersion("BUILDING", "CANCELLED" as never)).toBe(false);
    expect(canTransitionVersion("READY", "ACTIVE" as never)).toBe(false);
  });

  it("assertVersionTransition 抛稳定错误码", () => {
    expect(() => assertVersionTransition("DRAFT", "READY")).toThrow(DatasetLifecycleError);
    try {
      assertVersionTransition("DRAFT", "READY");
    } catch (e) {
      expect((e as DatasetLifecycleError).code).toBe("INVALID_VERSION_TRANSITION");
    }
  });

  it("isVersionBuildable：DRAFT/FAILED/READY 可构建，BUILDING 不可", () => {
    expect(isVersionBuildable("DRAFT")).toBe(true);
    expect(isVersionBuildable("FAILED")).toBe(true);
    expect(isVersionBuildable("READY")).toBe(true);
    expect(isVersionBuildable("BUILDING")).toBe(false);
  });
});

describe("DATASET-002.4A · Build Job 状态机", () => {
  it("合法转换：PENDING→RUNNING→COMPLETED/FAILED/CANCELLED；PENDING→CANCELLED", () => {
    expect(canTransitionJob("PENDING", "RUNNING")).toBe(true);
    expect(canTransitionJob("PENDING", "CANCELLED")).toBe(true);
    expect(canTransitionJob("RUNNING", "COMPLETED")).toBe(true);
    expect(canTransitionJob("RUNNING", "FAILED")).toBe(true);
    expect(canTransitionJob("RUNNING", "CANCELLED")).toBe(true);
  });

  it("terminal 状态无出边（COMPLETED/FAILED/CANCELLED）", () => {
    for (const from of ["COMPLETED", "FAILED", "CANCELLED"] as const) {
      for (const to of ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const) {
        expect(canTransitionJob(from, to)).toBe(false);
      }
      expect(isTerminalJobStatus(from)).toBe(true);
    }
    expect(isTerminalJobStatus("PENDING")).toBe(false);
    expect(isTerminalJobStatus("RUNNING")).toBe(false);
  });

  it("非法转换：重复 start / 重复 cancel / 重复 complete / 重复 fail", () => {
    expect(canTransitionJob("RUNNING", "RUNNING")).toBe(false);
    expect(canTransitionJob("CANCELLED", "CANCELLED")).toBe(false);
    expect(canTransitionJob("COMPLETED", "COMPLETED")).toBe(false);
    expect(canTransitionJob("FAILED", "FAILED")).toBe(false);
    expect(canTransitionJob("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransitionJob("PENDING", "COMPLETED")).toBe(false);
    expect(canTransitionJob("PENDING", "FAILED")).toBe(false);
  });

  it("assertJobTransition 抛稳定错误码", () => {
    try {
      assertJobTransition("COMPLETED", "CANCELLED");
    } catch (e) {
      expect((e as DatasetLifecycleError).code).toBe("INVALID_JOB_TRANSITION");
    }
  });
});

describe("DATASET-002.4A · Build Progress", () => {
  it("COMPLETED → 100（无论 chunk 字段）", () => {
    expect(computeBuildProgress({ status: "COMPLETED", totalChunks: null, completedChunks: null })).toBe(100);
    expect(computeBuildProgress({ status: "COMPLETED", totalChunks: 10, completedChunks: 0 })).toBe(100);
  });

  it("0% / 中间 / 100%", () => {
    expect(computeBuildProgress({ status: "RUNNING", totalChunks: 10, completedChunks: 0 })).toBe(0);
    expect(computeBuildProgress({ status: "RUNNING", totalChunks: 10, completedChunks: 5 })).toBe(50);
    expect(computeBuildProgress({ status: "RUNNING", totalChunks: 10, completedChunks: 10 })).toBe(100);
  });

  it("信息不足 → null（不臆造百分比）", () => {
    expect(computeBuildProgress({ status: "RUNNING", totalChunks: null, completedChunks: 5 })).toBeNull();
    expect(computeBuildProgress({ status: "RUNNING", totalChunks: 0, completedChunks: 5 })).toBeNull();
    expect(computeBuildProgress({ status: "RUNNING", totalChunks: 10, completedChunks: null })).toBeNull();
  });

  it("百分比夹取到 0..100（completed 越界）", () => {
    expect(computeBuildProgress({ status: "RUNNING", totalChunks: 10, completedChunks: 15 })).toBe(100);
    expect(computeBuildProgress({ status: "RUNNING", totalChunks: 10, completedChunks: -3 })).toBe(0);
  });
});
