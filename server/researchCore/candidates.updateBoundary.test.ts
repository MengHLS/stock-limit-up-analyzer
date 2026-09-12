/**
 * RESEARCH-006.1 — Candidate 普通 update 的**写入边界**测试（纯函数层）。
 *
 * 边界分两类（依据 006.0 §10.1 + 006.1 §15/§16/§17）：
 *   - ① **硬拒**：`experimentId` / `conclusionId` / 4 个 `source*`
 *     —— 结构锚与历史事实快照，只能由未来的 `createFromConclusion` / `promote` 写入；
 *   - ② **状态机守卫**：`status` / `strategyDefinitionId`
 *     —— 不是「放开」，而是取值必须过 `assertCandidateTransition` +
 *     `assertCandidateConversionCoherence`；API 层（006.2）还须把它们从通用 update 白名单摘出。
 *
 * ⚠️ 本 STEP **不重构**既有状态迁移路径：RESEARCH-001 验收测试已把
 * 「create → REVIEW → ACCEPTED → CONVERTED 经 update 完成」写进断言，改动它即改变既有行为。
 */

import { describe, expect, it } from "vitest";
import {
  RESEARCH_CANDIDATE_GUARDED_TRANSITION_FIELDS,
  RESEARCH_CANDIDATE_IMMUTABLE_FIELDS,
  ResearchCandidateError,
  assertCandidateUpdatePatchKeys,
} from "./candidates";

describe("Candidate 普通 update 写入边界（RESEARCH-006.1）", () => {
  it("硬拒字段清单 = 结构锚 + 来源快照，逐项与 006.0 §7.1 对齐", () => {
    expect([...RESEARCH_CANDIDATE_IMMUTABLE_FIELDS].sort()).toEqual(
      [
        "conclusionId",
        "experimentId",
        "sourceDatasetDivergenceReason",
        "sourceDatasetVersionId",
        "sourceResearchRunId",
        "sourceTraceJson",
      ].sort(),
    );
  });

  it("状态机守卫字段清单 = status + strategyDefinitionId", () => {
    expect([...RESEARCH_CANDIDATE_GUARDED_TRANSITION_FIELDS].sort()).toEqual([
      "status",
      "strategyDefinitionId",
    ]);
  });

  it("两个清单无交集（不存在「既硬拒又守卫」的字段）", () => {
    const immutable = new Set<string>(RESEARCH_CANDIDATE_IMMUTABLE_FIELDS);
    const overlap = RESEARCH_CANDIDATE_GUARDED_TRANSITION_FIELDS.filter((f) => immutable.has(f));
    expect(overlap).toEqual([]);
  });

  it("只含草图字段的 patch 通过", () => {
    expect(() =>
      assertCandidateUpdatePatchKeys({
        name: "首板回踩不破开盘价",
        description: "x",
        entryRule: { event: "FIRST_LIMIT_UP" },
        filterRule: {},
        exitRule: {},
        riskRule: {},
        parameterSpace: {},
      }),
    ).not.toThrow();
  });

  it("空 patch 通过", () => {
    expect(() => assertCandidateUpdatePatchKeys({})).not.toThrow();
  });

  it("状态机守卫字段不在硬拒清单内（由状态机守卫，不由本断言拦）", () => {
    for (const field of RESEARCH_CANDIDATE_GUARDED_TRANSITION_FIELDS) {
      expect(() => assertCandidateUpdatePatchKeys({ [field]: "x" })).not.toThrow();
    }
  });

  it.each([...RESEARCH_CANDIDATE_IMMUTABLE_FIELDS])("硬拒字段 %s 越界即抛错并点名", (field) => {
    expect(() => assertCandidateUpdatePatchKeys({ [field]: "x" })).toThrow(ResearchCandidateError);
    expect(() => assertCandidateUpdatePatchKeys({ [field]: "x" })).toThrow(new RegExp(field));
  });

  it("值为 undefined 的越界键不算越界（与 TS 可选字段语义一致）", () => {
    expect(() => assertCandidateUpdatePatchKeys({ experimentId: undefined })).not.toThrow();
  });

  it("多个越界键一次性全部点名", () => {
    try {
      assertCandidateUpdatePatchKeys({ sourceDatasetVersionId: 1, experimentId: 2 });
      throw new Error("应当抛错");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("sourceDatasetVersionId");
      expect(message).toContain("experimentId");
    }
  });
});
