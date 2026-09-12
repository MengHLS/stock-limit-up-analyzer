/**
 * promoteForm — 转正弹窗的**纯函数**层（RESEARCH-006.4.1-B §8 ~ §15）。
 *
 * 为什么单独放纯函数模块：本机 `agent-browser` / `jsdom` 都不可用 ⇒ 弹窗的**行为**
 * 只能用「与组件同源、可直接 `import` 的纯函数」来验证（`promoteForm.test.ts`）。
 * 组件只负责渲染 + 调这些函数，**不得**在 JSX 里另写一套判断。
 *
 * 🔴 这里做的是 **UX 层检查**，不是业务校验：后端 `promote()` 仍然是唯一权威
 * （§15）。前端检查的作用是「别让用户白跑一次」，不是「替后端把关」。
 *
 * 纪律：
 *   - 「能不能转正」只依据**状态字面量**（`ACCEPTED`），不依据任何本地推导；
 *   - 「执行 Dataset」只依据 **`datasetVersionId`**（`dataset_version.id` 唯一坐标），
 *     label / datasetCode 只用于显示；
 *   - 「READY」判定复用 `createExperimentForm#isUsableVersionStatus`（与 Research 新建实验、
 *     Strategy 基础信息**同一处口径**），不另立一份；
 *   - 提交体**永远不可能**包含 `strategyDefinition` / `definition` / `strategyDocumentJson`
 *     —— 由类型 + 构造流程双重保证（§14）。
 */

import { isUsableVersionStatus } from "./createExperimentForm";

/** 唯一允许转正的状态（后端 `CANDIDATE_NOT_ACCEPTED` 门槛的镜像）。 */
export const PROMOTABLE_STATUS = "ACCEPTED";

/** `false` ⇒ **不显示**可执行的转正入口（§8）。 */
export function isPromotableStatus(status: string | null | undefined): boolean {
  return status === PROMOTABLE_STATUS;
}

/**
 * 明确「不显示转正按钮」的状态清单。
 * ⚠️ 这是**展示规则**的说明性清单，状态机权威在后端；`promoteForm.test.ts` 会断言
 * 它与后端 `RESEARCH_CANDIDATE_STATUSES` 的差集**恰好**是 `ACCEPTED`。
 */
export const NON_PROMOTABLE_STATUSES = [
  "DRAFT",
  "REVIEW",
  "REJECTED",
  "ARCHIVED",
  "CONVERTED",
] as const;

// ---------------------------------------------------------------------------
// 表单状态
// ---------------------------------------------------------------------------

/** 执行 Dataset 的来源方式：继承研究来源 / 显式指定另一个。 */
export type PromoteExecutionMode = "INHERIT" | "OVERRIDE";

export interface PromoteFormState {
  mode: PromoteExecutionMode;
  /** 仅在 `OVERRIDE` 下有效；`dataset_version.id`。 */
  datasetVersionId: number | null;
  /** 仅当「来源 ≠ 执行」时才应填写（§12）。 */
  divergenceReason: string;
}

/** 默认 = 继承研究来源数据集（§10）。 */
export function createDefaultPromoteForm(): PromoteFormState {
  return { mode: "INHERIT", datasetVersionId: null, divergenceReason: "" };
}

/** 候选的研究来源上下文（来自 `get` 的 Dataset 快照；可为 `null` = 提不出）。 */
export interface PromoteSourceContext {
  sourceDatasetVersionId: number | null;
  sourceDatasetLabel: string | null;
}

// ---------------------------------------------------------------------------
// 校验（UX 层）
// ---------------------------------------------------------------------------

export interface PromoteValidation {
  ok: boolean;
  errors: string[];
  /** 校验通过时，「这次转正实际会用哪个 Dataset 版本」。 */
  executionDatasetVersionId: number | null;
  /** 是否构成 divergence（**与后端同一判据**：来源非空 且 与执行不同）。 */
  diverges: boolean;
  /** 是否需要向服务端显式提交 datasetBinding（执行 ≠ 来源时必须提交）。 */
  needsExplicitBinding: boolean;
}

/**
 * 校验转正表单（§15 的三项 UX 检查）。
 *
 * 判据与后端 `promote()` 第 5 步**逐条对齐**：
 *   - 继承模式下来源为空 ⇒ 必然失败（后端 `DATASET_VERSION_INVALID`）⇒ 提前拦住；
 *   - divergence 判据 = `来源 !== null && 执行 !== 来源`（来源为 null 时**不构成**分歧，
 *     因此此时**禁止**填 reason —— 后端会以 `INVALID_INPUT` 拒绝）；
 *   - divergence 时 reason 必须非空（`null` / `""` / 纯空白一律无效）。
 */
export function validatePromoteForm(
  form: PromoteFormState,
  source: PromoteSourceContext,
): PromoteValidation {
  const errors: string[] = [];
  const sourceId = source.sourceDatasetVersionId;

  let executionDatasetVersionId: number | null = null;
  if (form.mode === "INHERIT") {
    if (sourceId === null) {
      errors.push(
        "该候选没有可继承的研究来源 Dataset（证据提不出）⇒ 必须显式选择一个执行 Dataset 版本。",
      );
    } else {
      executionDatasetVersionId = sourceId;
    }
  } else {
    if (form.datasetVersionId === null) {
      errors.push("请选择一个执行 Dataset 版本（只能是 READY 的版本）。");
    } else {
      executionDatasetVersionId = form.datasetVersionId;
    }
  }

  const diverges = executionDatasetVersionId !== null
    && sourceId !== null
    && executionDatasetVersionId !== sourceId;
  const reason = form.divergenceReason.trim();

  if (diverges && reason.length === 0) {
    errors.push("执行 Dataset 与研究来源不同，必须填写「数据集分歧原因」（不能为空或纯空白）。");
  }
  if (!diverges && form.mode === "OVERRIDE" && reason.length > 0) {
    // 来源为空时执行绑定本就与研究无关 ⇒ 后端要求 reason 必须是 NULL。
    errors.push(
      sourceId === null
        ? "该候选没有研究来源 Dataset ⇒ 不存在数据集分歧，请不要填写分歧原因。"
        : "执行 Dataset 与研究来源一致 ⇒ 不存在数据集分歧，请不要填写分歧原因。",
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    executionDatasetVersionId,
    diverges,
    needsExplicitBinding:
      executionDatasetVersionId !== null && executionDatasetVersionId !== sourceId,
  };
}

// ---------------------------------------------------------------------------
// 提交体构造（§14：永远不含 StrategyDefinition）
// ---------------------------------------------------------------------------

/** 与后端 `promote` 入参同形状（**只有**两个键）。 */
export interface PromoteInput {
  candidateId: number;
  overrides?: {
    datasetBinding?: { datasetVersionId: number };
    datasetDivergenceReason?: string;
  };
}

export type PromoteInputBuild =
  | { ok: true; input: PromoteInput }
  | { ok: false; errors: string[] };

/**
 * 构造 `promote` 入参。
 *
 * - 继承（或不构成分歧）时**不提交** `datasetBinding` —— 交给后端按候选快照继承
 *   （客户端不重复实现「继承」这条业务规则）；
 * - 执行 ≠ 来源时提交 `datasetBinding.datasetVersionId`；
 * - 仅 divergence 时提交 `datasetDivergenceReason`（**trim 后**的值）。
 */
export function buildPromoteInput(args: {
  candidateId: number;
  form: PromoteFormState;
  source: PromoteSourceContext;
}): PromoteInputBuild {
  const validation = validatePromoteForm(args.form, args.source);
  if (!validation.ok || validation.executionDatasetVersionId === null) {
    return { ok: false, errors: validation.errors };
  }
  const overrides: PromoteInput["overrides"] = {};
  if (validation.needsExplicitBinding) {
    overrides.datasetBinding = { datasetVersionId: validation.executionDatasetVersionId };
  }
  if (validation.diverges) {
    overrides.datasetDivergenceReason = args.form.divergenceReason.trim();
  }
  const input: PromoteInput = { candidateId: args.candidateId };
  if (overrides.datasetBinding !== undefined || overrides.datasetDivergenceReason !== undefined) {
    input.overrides = overrides;
  }
  return { ok: true, input };
}

// ---------------------------------------------------------------------------
// Dataset 选项（§11：只允许 READY 版本；坐标只认 datasetVersionId）
// ---------------------------------------------------------------------------

/** `datasetRegistry.getDefinition` 返回的版本条目（只取要用的字段）。 */
export interface DatasetVersionLike {
  id: number;
  version: string;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  totalEvents?: number | null;
}

export interface DatasetVersionOption {
  datasetVersionId: number;
  /** 版本 label（`v1` / `v2`）——**仅显示**。 */
  label: string;
  datasetCode: string;
  datasetName: string;
  status: string;
  /** `true` = READY（可被选作执行绑定）。判定复用 `isUsableVersionStatus`。 */
  usable: boolean;
  startDate: string | null;
  endDate: string | null;
  totalEvents: number | null;
  /** 是否为候选的研究来源版本（用于「继承 / 相同」提示）。 */
  isSource: boolean;
}

/**
 * 把某 Dataset 定义下的版本清单折成下拉选项。
 *
 * **不重排、不裁剪**：非 READY 版本照样列出（`usable: false`）——
 * 让用户看见「有这个版本、但还不能用」，而不是消失得让人困惑。
 */
export function buildDatasetVersionOptions(args: {
  datasetName: string;
  datasetCode: string;
  versions: readonly DatasetVersionLike[];
  sourceDatasetVersionId: number | null;
}): DatasetVersionOption[] {
  return args.versions.map(v => ({
    datasetVersionId: v.id,
    label: v.version,
    datasetCode: args.datasetCode,
    datasetName: args.datasetName,
    status: v.status,
    usable: isUsableVersionStatus(v.status),
    startDate: v.startDate ?? null,
    endDate: v.endDate ?? null,
    totalEvents: v.totalEvents ?? null,
    isSource: args.sourceDatasetVersionId !== null && v.id === args.sourceDatasetVersionId,
  }));
}

/** 在已加载的选项里找某版本的 label；找不到即 `null`（不猜）。 */
export function findDatasetVersionLabel(
  options: readonly DatasetVersionOption[],
  datasetVersionId: number | null,
): string | null {
  if (datasetVersionId === null) return null;
  return options.find(o => o.datasetVersionId === datasetVersionId)?.label ?? null;
}

/** 选项的可读标签（下拉展示用；坐标永远是 `datasetVersionId`）。 */
export function datasetOptionLabel(option: DatasetVersionOption): string {
  return `#${option.datasetVersionId} ${option.datasetCode} / ${option.label} ${option.status}`;
}
