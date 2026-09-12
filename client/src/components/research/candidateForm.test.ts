/**
 * candidateForm 测试（纯函数 + **与后端常量对表**）。
 *
 * 本文件最有价值的不是「表单校验」，而是三组**防漂移断言**：
 *   1. 前端可编辑字段集合 ≡ 后端 `CANDIDATE_EDITABLE_FIELDS`；
 *   2. 前端允许登记候选的结论状态 ≡ 后端 `CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES`；
 *   3. 前端提供的状态流转目标 ≡ 后端「API 开放目标 ∩ 状态机允许迁移」，且 `CONVERTED` 永不出现。
 *
 * 前端**必须**在本地维护这三份展示用集合（客户端不能 import 服务端运行时值 ——
 * 仓库约定跨端只允许 `import type`），因此**唯一能防止口径漂移的手段就是本文件**。
 *
 * 草图编辑部分（2-x）在改为**结构化表单**后重写了：保证不变（白名单 / 空补丁拒绝 /
 * 清空 = null / 非法值定位到字段 / 多错一次列全），只把「手写 JSON」换成了「草稿对象」，
 * 并新增一条旧实现不可能有的保证：**表单表达不了的块永不提交**。
 */

import { describe, expect, it } from "vitest";
import {
  CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES,
  CANDIDATE_EDITABLE_FIELDS,
  CANDIDATE_TRANSITION_TARGETS,
} from "../../../../server/research/strategyCandidate/candidateTypes";
import {
  isCandidateTransitionAllowed,
  RESEARCH_CANDIDATE_STATUSES,
} from "../../../../server/researchCore";
import {
  CONCLUSION_STATUS_ELIGIBLE_FOR_CANDIDATE,
  CANDIDATE_SKETCH_FORM_FIELDS,
  buildCreateCandidateInput,
  buildUpdateCandidatePatch,
  conclusionEligibility,
  createDefaultCandidateForm,
  createDefaultEditForm,
  candidateEditOriginalOf,
  isPromotableStatus,
  transitionTargetLabelOf,
  transitionTargetNoteOf,
  transitionTargetsFor,
  validateCandidateCreateForm,
} from "./candidateForm";
import type { CandidateEditForm } from "./candidateForm";
import type { CandidateSketchDrafts, EntryRuleDraft, ExitRuleDraft, RiskRuleDraft } from "./candidateSketchForm";

const conclusion = { title: "首板隔日溢价显著", conclusion: "首板后隔日平均溢价 +2.1%（样本 1065）。" };

describe("与后端常量对表（防漂移）", () => {
  it("0-a) 前端可编辑字段 ≡ 后端 CANDIDATE_EDITABLE_FIELDS", () => {
    // 草图块（本地）+ 候选级字段（name / description）= 后端白名单全集。
    expect([...CANDIDATE_SKETCH_FORM_FIELDS, "name", "description"].sort()).toEqual(
      [...CANDIDATE_EDITABLE_FIELDS].sort(),
    );
  });

  it("0-b) 前端可登记结论状态 ≡ 后端 CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES", () => {
    expect([...CONCLUSION_STATUS_ELIGIBLE_FOR_CANDIDATE]).toEqual([
      ...CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES,
    ]);
  });

  it("0-c) 前端流转目标 ≡ 后端「API 开放目标 ∩ 状态机允许迁移」；CONVERTED 永不出现", () => {
    for (const status of RESEARCH_CANDIDATE_STATUSES) {
      const backendExpected = CANDIDATE_TRANSITION_TARGETS.filter((t) =>
        isCandidateTransitionAllowed(status, t),
      );
      expect([...transitionTargetsFor(status)]).toEqual([...backendExpected]);
      expect([...transitionTargetsFor(status)]).not.toContain("CONVERTED");
    }
  });

  it("0-d) 未收录/空状态一律不给流转入口（不猜）", () => {
    expect(transitionTargetsFor("SOMETHING_NEW")).toEqual([]);
    expect(transitionTargetsFor(null)).toEqual([]);
    expect(transitionTargetsFor(undefined)).toEqual([]);
  });

  it("0-e) REVIEW → DRAFT 后端状态机允许但 API 未开放 ⇒ 前端不得提供", () => {
    expect(isCandidateTransitionAllowed("REVIEW", "DRAFT")).toBe(true);
    expect([...transitionTargetsFor("REVIEW")]).not.toContain("DRAFT");
  });
});

describe("Conclusion → Candidate（登记）", () => {
  it("1-a) 初值 = 后端缺省（结论标题 / 结论正文）", () => {
    expect(createDefaultCandidateForm(conclusion)).toEqual({
      name: conclusion.title,
      description: conclusion.conclusion,
    });
  });

  it("1-b) 用户未改动时**只提交 conclusionId** —— 默认值由后端负责", () => {
    const form = createDefaultCandidateForm(conclusion);
    expect(buildCreateCandidateInput({ conclusionId: 12, form, defaults: conclusion })).toEqual({
      conclusionId: 12,
    });
  });

  it("1-c) 改动候选名 / 描述时才提交对应键", () => {
    const form = { name: "首板溢价（改名）", description: "自定义描述" };
    expect(buildCreateCandidateInput({ conclusionId: 12, form, defaults: conclusion })).toEqual({
      conclusionId: 12,
      name: "首板溢价（改名）",
      description: "自定义描述",
    });
  });

  it("1-d) 入参**永远不含**结构锚 / 来源快照 / 状态（这些由后端负责）", () => {
    const form = { name: "x", description: "y" };
    const input = buildCreateCandidateInput({ conclusionId: 12, form, defaults: conclusion });
    for (const forbidden of [
      "experimentId",
      "status",
      "sourceDatasetVersionId",
      "sourceResearchRunId",
      "sourceTraceJson",
      "strategyDefinitionId",
    ]) {
      expect(Object.keys(input)).not.toContain(forbidden);
    }
  });

  it("1-e) 候选名为空 → 校验失败（不静默用缺省名）", () => {
    expect(validateCandidateCreateForm({ name: "   ", description: "x" })).toHaveLength(1);
    expect(validateCandidateCreateForm({ name: "合法名", description: "x" })).toHaveLength(0);
  });

  it("1-f) 结论资格：DRAFT / FINAL 允许，其余给出原因", () => {
    expect(conclusionEligibility("DRAFT").allowed).toBe(true);
    expect(conclusionEligibility("FINAL").allowed).toBe(true);
    const superseded = conclusionEligibility("SUPERSEDED");
    expect(superseded.allowed).toBe(false);
    expect(superseded.reason).toContain("SUPERSEDED");
    expect(superseded.reason).toContain("不得进入策略链路");
    expect(conclusionEligibility(null).allowed).toBe(false);
  });
});

describe("草图编辑（结构化表单，白名单）", () => {
  /** 一份**能被表单完整表达**的候选（字段名与值都取自后端词表）。 */
  const candidate = {
    name: "首板隔日溢价",
    description: "首板后隔日溢价",
    entryRule: { event: "FIRST_LIMIT_UP", timing: "NEXT_OPEN", extra: {} },
    filterRule: {
      groups: [
        {
          groupNo: 0,
          groupLogicalOperator: "AND",
          conditions: [
            {
              groupNo: 0,
              sortOrder: 0,
              fieldName: "prefix.rd0.close",
              operator: ">=",
              value: 5,
              logicalOperator: "AND",
              groupLogicalOperator: "AND",
            },
          ],
        },
      ],
    },
    exitRule: { stopLoss: 0.05 },
    riskRule: { maxPositions: 5 },
    parameterSpace: { turnoverLow: { type: "number", min: 5, max: 12, step: 1 } },
  };

  function withSketch(form: CandidateEditForm, patch: Partial<CandidateSketchDrafts>): CandidateEditForm {
    return { ...form, sketch: { ...form.sketch, ...patch } };
  }

  function entryDraft(form: CandidateEditForm): EntryRuleDraft {
    const state = form.sketch.entryRule;
    if (state.kind !== "structured") throw new Error("test fixture 期望 entryRule 可结构化");
    return state.draft;
  }

  function exitDraft(form: CandidateEditForm): ExitRuleDraft {
    const state = form.sketch.exitRule;
    if (state.kind !== "structured") throw new Error("test fixture 期望 exitRule 可结构化");
    return state.draft;
  }

  function riskDraft(form: CandidateEditForm): RiskRuleDraft {
    const state = form.sketch.riskRule;
    if (state.kind !== "structured") throw new Error("test fixture 期望 riskRule 可结构化");
    return state.draft;
  }

  it("2-a) 初值 = 后端原值：可表达的块解析成草稿，未填写的块是「未填写」（不是空文本）", () => {
    const form = createDefaultEditForm(candidate);
    expect(entryDraft(form).event).toBe("FIRST_LIMIT_UP");
    expect(entryDraft(form).timing).toBe("NEXT_OPEN");
    expect(riskDraft(form).maxPositions).toBe("5");
    expect(exitDraft(form).stopLoss).toBe("0.05");
    expect(form.sketch.filterRule.kind).toBe("structured");
    expect(form.sketch.parameterSpace.kind).toBe("structured");

    const sparse = createDefaultEditForm({ ...candidate, exitRule: null, parameterSpace: null });
    expect(sparse.sketch.exitRule.kind).toBe("empty");
    expect(sparse.sketch.parameterSpace.kind).toBe("empty");
  });

  it("2-b) 未改动 → 拒绝空补丁（后端亦拒绝）", () => {
    const form = createDefaultEditForm(candidate);
    const result = buildUpdateCandidatePatch(candidateEditOriginalOf(candidate), form);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("没有任何字段被修改");
  });

  it("2-c) 改名 / 清空一块为 null（原本就有值的块才谈得上「清空」）", () => {
    const original = candidateEditOriginalOf(candidate);
    const base = createDefaultEditForm(candidate);
    const form = withSketch({ ...base, name: "新名字" }, { exitRule: { kind: "empty" } });
    const result = buildUpdateCandidatePatch(original, form);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch.name).toBe("新名字");
      expect(result.patch.exitRule).toBeNull();
      expect(Object.keys(result.patch)).not.toContain("riskRule");
      expect(Object.keys(result.patch)).not.toContain("filterRule");
    }
  });

  it("2-d) 清空描述 → 提交 null（显式清空，不是「未提供」）", () => {
    const original = candidateEditOriginalOf(candidate);
    const result = buildUpdateCandidatePatch(original, { ...createDefaultEditForm(candidate), description: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch).toEqual({ description: null });
  });

  it("2-e) 结构化修改 → 提交结构 JSON（只有改动过的块进入补丁）", () => {
    const base = createDefaultEditForm(candidate);
    const form = withSketch(base, {
      riskRule: { kind: "structured", draft: { ...riskDraft(base), maxPositions: "8" } },
    });
    const result = buildUpdateCandidatePatch(candidateEditOriginalOf(candidate), form);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch.riskRule).toEqual({ maxPositions: 8 });
      expect(Object.keys(result.patch)).toEqual(["riskRule"]);
    }
  });

  it("2-f) 草稿里填了非法值 → 错误定位到具体字段（不静默存下去）", () => {
    const base = createDefaultEditForm(candidate);
    const form = withSketch(base, {
      exitRule: { kind: "structured", draft: { ...exitDraft(base), stopLoss: "2" } },
    });
    const result = buildUpdateCandidatePatch(candidateEditOriginalOf(candidate), form);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("止损比例");
      expect(result.errors[0]).toContain("(0,1)");
    }
  });

  it("2-g) 多个字段同时出错 → 一次列全（不挤牙膏）", () => {
    const base = createDefaultEditForm(candidate);
    const form = withSketch(
      { ...base, name: "   " },
      { exitRule: { kind: "structured", draft: { ...exitDraft(base), holdingDays: "-1" } } },
    );
    const result = buildUpdateCandidatePatch(candidateEditOriginalOf(candidate), form);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(2);
      expect(result.errors.join()).toContain("候选名不能为空");
      expect(result.errors.join()).toContain("持有交易日数");
    }
  });

  it("2-h) 补丁键全部落在白名单内（含清空场景）", () => {
    const base = createDefaultEditForm(candidate);
    const form: CandidateEditForm = {
      name: "n",
      description: "d",
      sketch: {
        entryRule: { kind: "empty" },
        filterRule: { kind: "empty" },
        exitRule: { kind: "empty" },
        riskRule: { kind: "structured", draft: { maxPositions: "3", maxPositionWeight: "" } },
        parameterSpace: { kind: "empty" },
      },
    };
    expect(base).toBeDefined();
    const result = buildUpdateCandidatePatch(candidateEditOriginalOf(candidate), form);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const key of Object.keys(result.patch)) {
        expect(CANDIDATE_EDITABLE_FIELDS as readonly string[]).toContain(key);
      }
    }
  });

  it("2-i) 🔴 表单表达不了的块 → 整块只读，且**永不提交**（不静默丢键）", () => {
    const legacy = { ...candidate, riskRule: { maxBoards: 3 } };
    const base = createDefaultEditForm(legacy);
    expect(base.sketch.riskRule.kind).toBe("raw");

    // 只改名字：那个 raw 块不得出现在补丁里（否则等于替用户删掉 maxBoards）。
    const renamed = buildUpdateCandidatePatch(candidateEditOriginalOf(legacy), { ...base, name: "换名" });
    expect(renamed.ok).toBe(true);
    if (renamed.ok) expect(Object.keys(renamed.patch)).toEqual(["name"]);

    // 用户显式「清空」才允许提交 null —— 这是明确的意图，不是静默丢弃。
    const cleared = buildUpdateCandidatePatch(
      candidateEditOriginalOf(legacy),
      withSketch(base, { riskRule: { kind: "empty" } }),
    );
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.patch.riskRule).toBeNull();
  });
});

describe("状态流转文案与转正入口", () => {
  it("4-a) 已收录目标的文案与说明齐备", () => {
    expect(transitionTargetLabelOf("ACCEPTED")).toBe("采纳");
    expect(transitionTargetNoteOf("ACCEPTED")).toContain("转正");
  });

  it("4-b) 未收录目标回退原文 + 通用说明（不编语义）", () => {
    expect(transitionTargetLabelOf("NEW_STATE")).toBe("NEW_STATE");
    expect(transitionTargetNoteOf("NEW_STATE")).toContain("后端状态机");
  });

  it("4-c) 只有 ACCEPTED 展示转正入口（Phase A 不实现转正本身）", () => {
    expect(isPromotableStatus("ACCEPTED")).toBe(true);
    for (const status of ["DRAFT", "REVIEW", "REJECTED", "ARCHIVED", "CONVERTED"]) {
      expect(isPromotableStatus(status)).toBe(false);
    }
  });
});
