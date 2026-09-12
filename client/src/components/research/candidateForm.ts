/**
 * candidateForm — Research → Strategy 候选前端表单**纯函数**（可单测）。
 *
 * 纪律（与 `datasetRegistry/datasetFilterForm` / `research/createExperimentForm` 同一约定）：
 *   - 组件里不写字面量规则，判定与拼装全部下沉到本文件，由单测逐条锁定；
 *   - **默认值归后端**：`buildCreateCandidateInput` 只在「用户确实改过」时才把 `name` / `description`
 *     发给后端，未改动时只发 `{ conclusionId }` —— 前端的预填只是「让用户看见将要发生什么」，
 *     不是把默认值复制一份到前端；
 *   - **不提交后端不允许的字段**：普通编辑的补丁只可能包含 7 个白名单字段
 *     （由 `candidateForm.test.ts` 与后端 `CANDIDATE_EDITABLE_FIELDS` 对表断言，防漂移）；
 *   - **不模拟转换**：状态流转可选项 = 「后端开放的目标（`CANDIDATE_TRANSITION_TARGETS`）
 *     ∩ 当前状态在状态机里允许的迁移（`CANDIDATE_TRANSITIONS`）」，
 *     因此 `CONVERTED` **永远不会**出现在前端可选项里 —— 它只能由 `promote` 产生（006.3 §3）。
 */

import { CANDIDATE_SKETCH_FIELDS } from "@/adapters/strategyCandidateAdapter";
import {
  buildSketchPatch,
  toSketchDrafts,
  type CandidateSketchDrafts,
} from "./candidateSketchForm";

// ---------------------------------------------------------------------------
// Conclusion → Candidate（登记）
// ---------------------------------------------------------------------------

export interface CandidateCreateForm {
  name: string;
  description: string;
}

export interface ConclusionDefaults {
  title: string;
  /** 结论正文 —— 后端缺省 `description` 即引用它（原样，不改写）。 */
  conclusion: string;
}

/**
 * 登记表单初值。
 *
 * 预填 = 后端缺省值（结论标题 / 结论正文），目的是让用户**看见**将会写入什么；
 * 未改动时不会把这些值传给后端（见 `buildCreateCandidateInput`）。
 */
export function createDefaultCandidateForm(conclusion: ConclusionDefaults): CandidateCreateForm {
  return { name: conclusion.title, description: conclusion.conclusion };
}

export function validateCandidateCreateForm(form: CandidateCreateForm): string[] {
  const errors: string[] = [];
  if (form.name.trim().length === 0) {
    errors.push("候选名不能为空（缺省会用结论标题，但清空后必须自己填一个）。");
  }
  return errors;
}

/**
 * 组装 `research.strategyCandidate.createFromConclusion` 的入参。
 *
 * 🔴 只可能产出 `conclusionId` / `name` / `description` 三个键：
 * `experimentId` / `conclusionId` / `sourceDatasetVersionId` / `sourceResearchRunId` /
 * `sourceTraceJson` / `status` **一律由后端负责**，前端拼接它们属于越权（006.4.1 §3）。
 */
export function buildCreateCandidateInput(args: {
  conclusionId: number;
  form: CandidateCreateForm;
  defaults: ConclusionDefaults;
}): { conclusionId: number; name?: string; description?: string } {
  const { conclusionId, form, defaults } = args;
  const name = form.name.trim();
  const description = form.description.trim();
  const input: { conclusionId: number; name?: string; description?: string } = { conclusionId };
  if (name.length > 0 && name !== defaults.title) input.name = name;
  if (description.length > 0 && description !== defaults.conclusion) input.description = description;
  return input;
}

/**
 * 结论是否**允许**登记为候选（仅用于按钮可用性提示）。
 *
 * 🔴 权威判据在后端 `CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES`。
 * 本前端集合由 `candidateForm.test.ts` 与后端常量**逐字对表**断言，
 * 因此不存在「前端口径悄悄漂移」的可能；后端仍然会独立校验一次。
 */
export const CONCLUSION_STATUS_ELIGIBLE_FOR_CANDIDATE = ["DRAFT", "FINAL"] as const;

export function conclusionEligibility(status: string | null | undefined): {
  allowed: boolean;
  reason: string | null;
} {
  if (!status) return { allowed: false, reason: "结论状态未知，请刷新后再试。" };
  if ((CONCLUSION_STATUS_ELIGIBLE_FOR_CANDIDATE as readonly string[]).includes(status)) {
    return { allowed: true, reason: null };
  }
  return {
    allowed: false,
    reason: `结论当前状态为 ${status}，只有 ${CONCLUSION_STATUS_ELIGIBLE_FOR_CANDIDATE.join(" / ")} 允许登记为候选（已被取代的结论不得进入策略链路）。`,
  };
}

// ---------------------------------------------------------------------------
// 草图编辑（普通 update，白名单）
// ---------------------------------------------------------------------------

/**
 * 编辑表单：候选名 / 描述 + 五块**结构化草稿**。
 *
 * 草图不再是 JSON 文本 —— 五块都是强类型、词表有界的结构（权威 `definitionBuild.ts`），
 * 草稿态与 JSON 互转在 `candidateSketchForm.ts`；本文件只负责「候选级」的两个字段
 * （name / description）与白名单纪律。
 */
export interface CandidateEditForm {
  name: string;
  description: string;
  sketch: CandidateSketchDrafts;
}

/**
 * 编辑前的原值。
 *
 * `sketchJson` 必须是**后端返回的原始 JSON**，不能从草稿反推 —— 「有没有改动」要以原始
 * 载荷为基准比，否则「打开编辑、什么都不改、点保存」会写出一次假改动。
 */
export interface CandidateEditOriginal {
  name: string;
  description: string;
  sketchJson: Record<string, unknown>;
}

/** 前端可编辑字段集合（展示用；权威白名单在后端，由测试对表锁定）。 */
export const CANDIDATE_SKETCH_FORM_FIELDS: readonly string[] = CANDIDATE_SKETCH_FIELDS.map((f) => f.key);

/** 五块草图字段键（顺序与后端白名单一致，便于对表）。 */
export function candidateSketchJsonOf(candidate: {
  entryRule?: unknown;
  filterRule?: unknown;
  exitRule?: unknown;
  riskRule?: unknown;
  parameterSpace?: unknown;
}): Record<string, unknown> {
  return {
    entryRule: candidate.entryRule ?? null,
    filterRule: candidate.filterRule ?? null,
    exitRule: candidate.exitRule ?? null,
    riskRule: candidate.riskRule ?? null,
    parameterSpace: candidate.parameterSpace ?? null,
  };
}

/** 表单初值 = 后端原值（**不重算、不补默认**）。 */
export function createDefaultEditForm(candidate: {
  name: string;
  description?: string | null;
  entryRule?: unknown;
  filterRule?: unknown;
  exitRule?: unknown;
  riskRule?: unknown;
  parameterSpace?: unknown;
}): CandidateEditForm {
  return {
    name: candidate.name,
    description: candidate.description ?? "",
    sketch: toSketchDrafts(candidate),
  };
}

/** 编辑前原值（name / description 原文 + 五块原始 JSON）。 */
export function candidateEditOriginalOf(candidate: {
  name: string;
  description?: string | null;
  entryRule?: unknown;
  filterRule?: unknown;
  exitRule?: unknown;
  riskRule?: unknown;
  parameterSpace?: unknown;
}): CandidateEditOriginal {
  return {
    name: candidate.name,
    description: candidate.description ?? "",
    sketchJson: candidateSketchJsonOf(candidate),
  };
}

export type BuildPatchResult =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; errors: string[] };

/**
 * 编辑表单 → `research.strategyCandidate.update` 的 `patch`。
 *
 * 规则（与「手写 JSON 文本框」时代同一组保证，只换了草图的表达方式）：
 *   - **只提交改动过的字段**；
 *   - 只可能产出白名单里的键（name / description / 5 个草图块）；
 *   - 空补丁 → 失败（后端亦拒绝「成功但没变」）；
 *   - 清空 → 提交 `null`（显式清空，不是「未提供」）；
 *   - 🔴 `raw` 块**永不提交** —— 表单表达不了的既有内容不会被就地抹掉。
 */
export function buildUpdateCandidatePatch(
  original: CandidateEditOriginal,
  form: CandidateEditForm,
): BuildPatchResult {
  const errors: string[] = [];
  const patch: Record<string, unknown> = {};

  const name = form.name.trim();
  if (name !== original.name.trim()) {
    if (name.length === 0) errors.push("候选名不能为空。");
    else patch.name = name;
  }

  const description = form.description.trim();
  if (description !== original.description.trim()) {
    patch.description = description.length === 0 ? null : form.description;
  }

  const sketch = buildSketchPatch(original.sketchJson, form.sketch);
  if (sketch.ok) {
    for (const [key, value] of Object.entries(sketch.patch)) patch[key] = value;
  } else if (!(sketch.errors.length === 1 && sketch.errors[0]?.startsWith("草图没有任何字段被修改"))) {
    for (const message of sketch.errors) errors.push(message);
  }

  if (errors.length > 0) return { ok: false, errors };
  if (Object.keys(patch).length === 0) {
    return { ok: false, errors: ["没有任何字段被修改（后端会拒绝空补丁）。"] };
  }
  return { ok: true, patch };
}

// ---------------------------------------------------------------------------
// 状态流转
// ---------------------------------------------------------------------------

/**
 * `transition` 的**可提交**目标状态字面量。
 *
 * 与后端 `CANDIDATE_TRANSITION_TARGETS` 同集合（由测试对表）；给出类型是为了让
 * `trpc...transition({ to })` 在**编译期**就只能是这四个值之一 —— 类型层面的第二道防线。
 */
export type CandidateTransitionTarget = "REVIEW" | "ACCEPTED" | "REJECTED" | "ARCHIVED";

/** 目标状态 → 按钮文案。 */
export const CANDIDATE_TRANSITION_LABELS: Record<CandidateTransitionTarget, string> = {
  REVIEW: "提交复核",
  ACCEPTED: "采纳",
  REJECTED: "否决",
  ARCHIVED: "归档",
};

/** 目标状态 → 一句人话说明（写进确认框，避免用户误点）。 */
export const CANDIDATE_TRANSITION_NOTES: Record<CandidateTransitionTarget, string> = {
  REVIEW: "进入人工复核队列：后续才能被采纳或否决。",
  ACCEPTED: "标记为「研究结论可采纳」。采纳之后才允许转正为 Strategy（转正本身由转正入口执行）。",
  REJECTED: "标记为「不采纳」。候选保留（不会被删除），可继续归档。",
  ARCHIVED: "归档：退出主视图，历史记录保留。",
};

export function transitionTargetLabelOf(target: string): string {
  return (CANDIDATE_TRANSITION_LABELS as Record<string, string>)[target] ?? target;
}

export function transitionTargetNoteOf(target: string): string {
  return (CANDIDATE_TRANSITION_NOTES as Record<string, string>)[target] ?? "按后端状态机执行本次迁移。";
}

/**
 * 当前状态 → **前端可提供的**状态流转目标。
 *
 * 构成 = 「后端 API 开放的目标」∩「状态机在该状态下允许的迁移」。
 * 两份集合都由测试与后端常量对表断言（`candidateForm.test.ts` 的 0-c：**逐状态严格相等**），
 * 所以这里既不会漏掉刚开放的目标，也不会因为状态机调整而漂移；被 API 排除的目标
 * （`CONVERTED`、`REVIEW → DRAFT` 回退）也**结构上不可能出现**（006.4.1 §6）。
 *
 * ⚠️ 为什么要在前端维护这份表：客户端**不能** import 服务端的运行时值
 * （仓库约定跨端只允许 `import type`，否则服务端模块会被打进浏览器包）⇒
 * 「后端权威 + 前端展示」只能靠「本地表 + 对表测试」这一种方式落地。
 */
const FRONTEND_TRANSITION_TARGETS: Record<string, readonly CandidateTransitionTarget[]> = {
  DRAFT: ["REVIEW", "ARCHIVED"],
  REVIEW: ["ACCEPTED", "REJECTED", "ARCHIVED"],
  ACCEPTED: ["ARCHIVED"],
  REJECTED: ["ARCHIVED"],
  CONVERTED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function transitionTargetsFor(
  status: string | null | undefined,
): readonly CandidateTransitionTarget[] {
  if (!status) return [];
  return FRONTEND_TRANSITION_TARGETS[status] ?? [];
}

/** 前端是否认为「这个状态可以转正」（决定是否展示转正入口；真实转正在 Phase B）。 */
export function isPromotableStatus(status: string | null | undefined): boolean {
  return status === "ACCEPTED";
}
