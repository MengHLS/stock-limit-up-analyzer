/**
 * createExperimentForm — 「新建研究实验」表单状态与校验（纯函数，无 React 依赖）。
 *
 * 纪律（与 `components/datasetRegistry/datasetFilterForm.ts` 一致）：
 *   - 后端仍是唯一权威：本文件只做「尽早反馈」，**不放松**任何后端约束；
 *   - 枚举不在此处重新发明：`ResearchType` 由 `import type` 取自后端，选项数组用
 *     `satisfies` 做编译期穷尽校验 —— 后端枚举一变，这里会**编译失败**而不是静默漂移；
 *   - 「可用版本」只有 READY 一种状态：`server/researchEngine/engine.ts` 对非 READY 版本
 *     直接抛 `DATASET_VERSION_NOT_READY`，所以前端在选择阶段就把它挡掉，而不是让用户白跑一次。
 */

import type { ResearchType } from "../../../../server/researchCore";

/** 研究类型选项（穷尽 `ResearchType`；`satisfies` 保证不多不少）。 */
export const RESEARCH_TYPE_OPTIONS = [
  { value: "FEATURE", label: "特征研究", hint: "单一特征与未来收益的关系" },
  { value: "EVENT_STUDY", label: "事件研究", hint: "事件发生后的收益路径" },
  { value: "CONDITIONAL", label: "条件研究", hint: "满足特定条件时的表现差异" },
  { value: "PATH", label: "路径研究", hint: "事件后逐日路径形态" },
  { value: "REGIME", label: "环境研究", hint: "不同市场环境下的差异" },
  { value: "FACTOR", label: "因子研究", hint: "多因子组合（需后续能力）" },
  { value: "HYPOTHESIS", label: "假设驱动研究", hint: "先有假设再选分析" },
  { value: "CUSTOM", label: "自定义", hint: "其他研究意图" },
] as const satisfies ReadonlyArray<{ value: ResearchType; label: string; hint: string }>;

/** 引擎当前只接受 READY 版本（与后端断言同源）。 */
export const RESEARCH_USABLE_VERSION_STATUSES = ["READY"] as const;

/** 研究类型 → 中文标签（未收录原样返回，不臆造）。 */
export function researchTypeLabelOf(researchType: string): string {
  return RESEARCH_TYPE_OPTIONS.find((o) => o.value === researchType)?.label ?? researchType;
}

export function isUsableVersionStatus(status: string): boolean {
  return (RESEARCH_USABLE_VERSION_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// 表单状态
// ---------------------------------------------------------------------------

export interface CreateExperimentFormState {
  /** 选择的 Dataset 定义（字符串保存，避免 input 的 number/string 之争）。 */
  datasetId: string;
  datasetVersionId: string;
  name: string;
  description: string;
  researchType: ResearchType;
  /** 可选：同时登记一条假设（验收案例要求 Hypothesis 与 Experiment 一起产生）。 */
  hypothesisName: string;
  hypothesisStatement: string;
}

export function createDefaultExperimentForm(): CreateExperimentFormState {
  return {
    datasetId: "",
    datasetVersionId: "",
    name: "",
    description: "",
    researchType: "FEATURE",
    hypothesisName: "",
    hypothesisStatement: "",
  };
}

// ---------------------------------------------------------------------------
// 版本推荐
// ---------------------------------------------------------------------------

export interface VersionOptionLike {
  id: number;
  version: string;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  totalEvents?: number | null;
}

/**
 * 在候选版本中推荐一个默认可用的版本：
 *   1. 只考虑 READY（其余状态引擎会拒绝）；
 *   2. 优先事件数最多的（样本量是研究的第一约束）；
 *   3. 事件数相同或缺失时，取 id 最大（通常是最新构建）。
 * 没有任何 READY 版本时返回 null —— **不推荐不可用版本**。
 */
export function recommendVersionId(versions: readonly VersionOptionLike[]): number | null {
  const usable = versions.filter((v) => isUsableVersionStatus(v.status));
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => {
    const ea = a.totalEvents ?? -1;
    const eb = b.totalEvents ?? -1;
    if (eb !== ea) return eb - ea;
    return b.id - a.id;
  });
  return sorted[0]!.id;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export interface ExperimentFormContext {
  /** 选中定义下的全部版本（含不可用状态，用于给出「为什么不能选」的具体原因）。 */
  versions: readonly VersionOptionLike[];
  /** 是否已选中一个 Dataset 定义。 */
  definitionSelected: boolean;
}

/**
 * 校验并返回**可执行**的错误清单（空数组 = 通过）。
 * 错误文案面向用户，说明「下一步该做什么」，而不是复述字段名。
 */
export function validateExperimentForm(
  state: CreateExperimentFormState,
  context: ExperimentFormContext,
): string[] {
  const errors: string[] = [];

  if (!state.datasetId) {
    errors.push("请先选择数据集");
    return errors;
  }
  if (!context.definitionSelected) {
    errors.push("数据集信息尚未加载完成，请稍候");
    return errors;
  }

  const usable = context.versions.filter((v) => isUsableVersionStatus(v.status));
  if (usable.length === 0) {
    errors.push(
      context.versions.length === 0
        ? "该数据集下还没有任何版本，请先到「数据集构建」创建并构建版本"
        : "该数据集下没有 READY 状态的版本，只有 READY 版本可用于研究，请先完成构建",
    );
  }

  if (!state.datasetVersionId) {
    errors.push("请选择 Dataset 版本");
  } else {
    const picked = context.versions.find((v) => String(v.id) === state.datasetVersionId);
    if (!picked) {
      errors.push("所选版本不属于当前数据集，请重新选择");
    } else if (!isUsableVersionStatus(picked.status)) {
      errors.push(`版本 ${picked.version} 当前状态为 ${picked.status}，只有 READY 版本可用于研究`);
    }
  }

  if (!state.name.trim()) {
    errors.push("请填写实验名称");
  } else if (state.name.trim().length > 200) {
    errors.push("实验名称不能超过 200 个字符");
  }

  // 假设要么不填，要么必须同时有名称与陈述（半填的假设会污染结论链路）
  const hasHypothesisName = state.hypothesisName.trim().length > 0;
  const hasHypothesisStatement = state.hypothesisStatement.trim().length > 0;
  if (hasHypothesisStatement && !hasHypothesisName) {
    errors.push("填写了假设陈述，请同时填写假设名称");
  }
  if (hasHypothesisName && !hasHypothesisStatement) {
    errors.push("填写了假设名称，请同时填写假设陈述");
  }

  return errors;
}

// ---------------------------------------------------------------------------
// payload
// ---------------------------------------------------------------------------

export interface CreateExperimentInput {
  datasetVersionId: number;
  name: string;
  researchType: ResearchType;
  description?: string;
}

export function toExperimentInput(state: CreateExperimentFormState): CreateExperimentInput {
  const description = state.description.trim();
  return {
    datasetVersionId: Number(state.datasetVersionId),
    name: state.name.trim(),
    researchType: state.researchType,
    ...(description ? { description } : {}),
  };
}

export interface CreateHypothesisInput {
  experimentId: number;
  name: string;
  statement: string;
}

/** 未填假设时返回 null（调用方据此跳过 hypothesis 创建）。 */
export function toHypothesisInput(
  state: CreateExperimentFormState,
  experimentId: number,
): CreateHypothesisInput | null {
  const name = state.hypothesisName.trim();
  const statement = state.hypothesisStatement.trim();
  if (!name || !statement) return null;
  return { experimentId, name, statement };
}

/**
 * 从假设陈述生成一个默认假设名（仅在用户未填名称时使用，**不覆盖**用户输入）。
 * 取首句并截断，避免超长名称。
 */
export function suggestHypothesisName(statement: string, fallback = "假设 1"): string {
  const first = statement.split(/[。；;\n]/)[0]?.trim() ?? "";
  if (!first) return fallback;
  return first.length <= 60 ? first : `${first.slice(0, 57)}…`;
}
