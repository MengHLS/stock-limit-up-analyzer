/**
 * RESEARCH-001 — 领域枚举集中性测试（指令 §17）。
 *
 * 目的：保证 10 类枚举**只有一个权威定义**（`types.ts`），取值集合与指令 §4~§13 完全一致，
 * 且不存在重复项 / 大小写漂移。
 */

import { describe, expect, it } from "vitest";
import {
  RESEARCH_ANALYSIS_STATUSES,
  RESEARCH_ANALYSIS_TYPES,
  RESEARCH_ARTIFACT_STORAGE_TYPES,
  RESEARCH_ARTIFACT_TYPES,
  RESEARCH_CANDIDATE_STATUSES,
  RESEARCH_CONDITION_OPERATORS,
  RESEARCH_CONCLUSION_STATUSES,
  RESEARCH_CONCLUSION_TYPES,
  RESEARCH_EXPERIMENT_STATUSES,
  RESEARCH_GROUP_LOGICAL_OPERATORS,
  RESEARCH_HYPOTHESIS_STATUSES,
  RESEARCH_LOGICAL_OPERATORS,
  RESEARCH_RESULT_TYPES,
  RESEARCH_RUN_STATUSES,
  RESEARCH_TYPES,
} from "./types";

const ALL_ENUMS: Record<string, readonly string[]> = {
  RESEARCH_TYPES,
  RESEARCH_EXPERIMENT_STATUSES,
  RESEARCH_HYPOTHESIS_STATUSES,
  RESEARCH_RUN_STATUSES,
  RESEARCH_ANALYSIS_TYPES,
  RESEARCH_ANALYSIS_STATUSES,
  RESEARCH_CONCLUSION_TYPES,
  RESEARCH_CONCLUSION_STATUSES,
  RESEARCH_CANDIDATE_STATUSES,
  RESEARCH_ARTIFACT_TYPES,
  RESEARCH_ARTIFACT_STORAGE_TYPES,
  RESEARCH_RESULT_TYPES,
  RESEARCH_CONDITION_OPERATORS,
  RESEARCH_LOGICAL_OPERATORS,
  RESEARCH_GROUP_LOGICAL_OPERATORS,
};

describe("Research 领域枚举（集中管理）", () => {
  it("每类枚举无重复取值", () => {
    for (const [name, values] of Object.entries(ALL_ENUMS)) {
      expect(new Set(values).size, `${name} 存在重复项`).toBe(values.length);
    }
  });

  it("每类枚举非空", () => {
    for (const [name, values] of Object.entries(ALL_ENUMS)) {
      expect(values.length, `${name} 为空`).toBeGreaterThan(0);
    }
  });

  it("researchType 覆盖指令 §4 的 8 种", () => {
    expect([...RESEARCH_TYPES]).toEqual([
      "FEATURE",
      "EVENT_STUDY",
      "CONDITIONAL",
      "PATH",
      "REGIME",
      "FACTOR",
      "HYPOTHESIS",
      "CUSTOM",
    ]);
  });

  it("experiment status 覆盖指令 §4 的 6 态", () => {
    expect([...RESEARCH_EXPERIMENT_STATUSES]).toEqual([
      "DRAFT",
      "READY",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "ARCHIVED",
    ]);
  });

  it("hypothesis status 覆盖指令 §5 的 6 态", () => {
    expect([...RESEARCH_HYPOTHESIS_STATUSES]).toEqual([
      "DRAFT",
      "TESTING",
      "SUPPORTED",
      "PARTIALLY_SUPPORTED",
      "REJECTED",
      "INCONCLUSIVE",
    ]);
  });

  it("run status 覆盖指令 §6 的 5 态", () => {
    expect([...RESEARCH_RUN_STATUSES]).toEqual(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);
  });

  it("analysis type 覆盖指令 §7 的 11 种，另加 RESEARCH-004 的 SEGMENT_RELATION", () => {
    expect(RESEARCH_ANALYSIS_TYPES.length).toBe(12);
    expect(RESEARCH_ANALYSIS_TYPES).toContain("QUANTILE");
    expect(RESEARCH_ANALYSIS_TYPES).toContain("STABILITY");
    expect(RESEARCH_ANALYSIS_TYPES).toContain("SEGMENT_RELATION");
  });

  it("conclusion type 覆盖指令 §11 的 4 种", () => {
    expect([...RESEARCH_CONCLUSION_TYPES]).toEqual([
      "SUPPORTED",
      "PARTIALLY_SUPPORTED",
      "REJECTED",
      "INCONCLUSIVE",
    ]);
  });

  it("candidate status 覆盖指令 §12 的 6 态", () => {
    expect([...RESEARCH_CANDIDATE_STATUSES]).toEqual([
      "DRAFT",
      "REVIEW",
      "ACCEPTED",
      "REJECTED",
      "CONVERTED",
      "ARCHIVED",
    ]);
  });

  it("artifact type 覆盖指令 §13 的 6 种", () => {
    expect([...RESEARCH_ARTIFACT_TYPES]).toEqual([
      "REPORT",
      "DATA",
      "CHART",
      "STATISTICS",
      "EXPORT",
      "OTHER",
    ]);
  });

  it("枚举取值一律大写下划线（无小写漂移）", () => {
    // 条件运算符（> / >= / IN …）属符号集合，不适用大写命名规则，单独排除。
    const symbolic = new Set(["RESEARCH_CONDITION_OPERATORS"]);
    for (const [name, values] of Object.entries(ALL_ENUMS)) {
      if (symbolic.has(name)) continue;
      for (const v of values) {
        expect(v, `${name} 含非法取值 ${v}`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  it("条件运算符集合包含指令 §8 列举的比较能力", () => {
    for (const op of [">", ">=", "<", "<=", "==", "!="]) {
      expect(RESEARCH_CONDITION_OPERATORS).toContain(op);
    }
  });

  it("逻辑连接符支持 AND / OR / NOT 与条件组（指令 §8）", () => {
    expect([...RESEARCH_LOGICAL_OPERATORS]).toEqual(["AND", "OR", "NOT"]);
    expect([...RESEARCH_GROUP_LOGICAL_OPERATORS]).toEqual(["AND", "OR"]);
  });
});
