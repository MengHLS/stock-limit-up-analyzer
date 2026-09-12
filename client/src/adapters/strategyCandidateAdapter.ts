/**
 * strategyCandidateAdapter — Research → Strategy 候选（`research.strategyCandidate.*`）前端 ViewModel 适配层。
 *
 * 定位（与 `researchEngineAdapter.ts` / `datasetRegistryAdapter.ts` 同一纪律）：
 *   - API（tRPC 返回的领域对象）→ ViewModel → UI；UI **不**直接消费后端对象，也**不**在 JSX 里做字段强转；
 *   - **不重算任何判定**：状态、来源快照、Dataset 坐标原样展示，缺失就是缺失（`—` / 明说「已不存在」），
 *     不补默认值、不猜 Dataset label、不把候选草图说成「已生成的 StrategyDefinition」；
 *   - **状态文案只做展示映射**：候选状态的语义色统一走 `@/lib/status`，本文件只给中文标签；
 *   - **错误提示由后端 code 驱动**：`candidateErrorDiagnostic` 依据 tRPC 语义 code
 *     （BAD_REQUEST / FORBIDDEN / NOT_FOUND / CONFLICT / PRECONDITION_FAILED）给出可执行解释，
 *     并把后端原文一并展示 —— 前端**不臆造**领域错误码。
 *
 * 术语纪律（RESEARCH-006.4.1 §4）：
 *   `entryRule` / `filterRule` / `exitRule` / `riskRule` / `parameterSpace` 是 **Research Candidate Sketch**
 *   （研究草图），**不是** StrategyDefinition。转正产物只认 `strategyDefinitionId` 与
 *   `research.strategyCandidate.promote` 的返回值。
 */

import type { DiagnosticError } from "@/components/common";

// ---------------------------------------------------------------------------
// 状态标签
// ---------------------------------------------------------------------------

/**
 * 候选六态 → 中文标签。
 *
 * 未收录的状态**回退原文**（不猜、不吞）—— 与 `lib/status.ts` 的 `toneForStatus` 同纪律。
 */
export const CANDIDATE_STATUS_LABELS = {
  DRAFT: "草稿",
  REVIEW: "待复核",
  ACCEPTED: "已采纳",
  REJECTED: "已否决",
  ARCHIVED: "已归档",
  CONVERTED: "已转正",
} as const;

export function candidateStatusLabelOf(status: string | null | undefined): string {
  if (!status) return "—";
  return (CANDIDATE_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

// ---------------------------------------------------------------------------
// 研究草图（Research Candidate Sketch）
// ---------------------------------------------------------------------------

export type CandidateSketchFieldKey =
  | "entryRule"
  | "filterRule"
  | "exitRule"
  | "riskRule"
  | "parameterSpace";

export interface CandidateSketchFieldSpec {
  key: CandidateSketchFieldKey;
  label: string;
  /** 该字段在研究链路里回答什么问题（展示用，不参与任何判定）。 */
  hint: string;
}

/**
 * 草图展示顺序与文案。
 *
 * ⚠️ 这里**不是**「可编辑字段白名单」的第二份定义：白名单的权威在后端
 * （`server/research/strategyCandidate/candidateTypes.ts#CANDIDATE_EDITABLE_FIELDS`），
 * 前端只负责「把后端允许编辑的字段渲染出来」，并由
 * `candidateForm.test.ts` 断言两份集合逐字一致（防漂移）。
 */
export const CANDIDATE_SKETCH_FIELDS: readonly CandidateSketchFieldSpec[] = [
  {
    key: "entryRule",
    label: "入场规则 entryRule",
    hint: "什么条件下认为「机会出现」",
  },
  {
    key: "filterRule",
    label: "过滤规则 filterRule",
    hint: "从候选池里剔除哪些情况",
  },
  {
    key: "exitRule",
    label: "退出规则 exitRule",
    hint: "持仓如何结束（止损 / 止盈 / 时间退出）",
  },
  {
    key: "riskRule",
    label: "风控规则 riskRule",
    hint: "仓位与连板高度等约束",
  },
  {
    key: "parameterSpace",
    label: "参数空间 parameterSpace",
    hint: "留给后续参数搜索的取值域",
  },
];

/**
 * 草图字段值 → 展示文本。
 *
 * - `null` / `undefined` → `null`（**未填写**；由调用方渲染成「未填写」，不是空字符串）；
 * - 对象 / 数组 → 缩进 JSON（原样，不重排字段语义）；
 * - 字符串 → 原文（纯空白视为未填写）；
 * - 其它原始值 → `String(value)`。
 */
export function sketchFieldText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw.trim().length === 0 ? null : raw;
  if (typeof raw === "object") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      // 循环引用等异常：不伪造文本，明说无法展示。
      return "[无法序列化为 JSON]";
    }
  }
  return String(raw as number | boolean | bigint | symbol);
}

// ---------------------------------------------------------------------------
// 视图模型
// ---------------------------------------------------------------------------

export interface CandidateRawLike {
  id?: number | null;
  experimentId: number;
  conclusionId?: number | null;
  name: string;
  description?: string | null;
  status: string;
  strategyDefinitionId?: string | null;
  entryRule?: unknown;
  filterRule?: unknown;
  exitRule?: unknown;
  riskRule?: unknown;
  parameterSpace?: unknown;
  sourceDatasetVersionId?: number | null;
  sourceResearchRunId?: number | null;
  sourceDatasetDivergenceReason?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type CandidateSourceMissingReason = "EXPERIMENT" | "CONCLUSION" | "DATASET_VERSION";

export interface CandidateExperimentSummaryLike {
  id: number;
  name: string;
  status: string;
  datasetVersionId: number;
}

export interface CandidateConclusionSummaryLike {
  id: number;
  title: string;
  conclusionType: string;
  status: string;
  confidence: number | null;
}

export interface CandidateDatasetSummaryLike {
  datasetVersionId: number;
  label: string;
  status: string;
  datasetId: number;
  datasetCode?: string;
}

export interface CandidateDetailViewLike {
  candidate: CandidateRawLike;
  experiment: CandidateExperimentSummaryLike | null;
  conclusion: CandidateConclusionSummaryLike | null;
  dataset: CandidateDatasetSummaryLike | null;
  sourceMissing: readonly CandidateSourceMissingReason[];
}

export interface CandidateSourceVm {
  experiment: CandidateExperimentSummaryLike | null;
  conclusion: CandidateConclusionSummaryLike | null;
  /** `sourceResearchRunId`（可空 = 证据提不出，**如实为空**，不伪造）。 */
  runId: number | null;
  dataset: CandidateDatasetSummaryLike | null;
  /** 来源快照里查不到的项（快照而非 FK 的必然产物）。 */
  missing: CandidateSourceMissingReason[];
  /** 缺失项的诚实说明；无缺失 → `null`。 */
  missingNote: string | null;
}

export interface CandidateSketchItemVm {
  key: CandidateSketchFieldKey;
  label: string;
  hint: string;
  /** 展示文本；`null` = 未填写。 */
  text: string | null;
  present: boolean;
}

export interface CandidateDetailVm {
  id: number | null;
  name: string;
  description: string | null;
  status: string;
  statusLabel: string;
  /** 转正产物（`CONVERTED` 后由后端写入）；`null` = 未转正（合法状态）。 */
  strategyDefinitionId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  source: CandidateSourceVm;
  sketch: CandidateSketchItemVm[];
  /** 研究来源 Dataset ≠ 执行 Dataset 的人可读原因（快照值；`null` = 未声明分歧）。 */
  sourceDatasetDivergenceReason: string | null;
}

export interface CandidateRowVm {
  id: number | null;
  name: string;
  description: string | null;
  status: string;
  statusLabel: string;
  strategyDefinitionId: string | null;
  conclusionId: number | null;
  sourceDatasetVersionId: number | null;
  createdAt: string | null;
}

const MISSING_NOTES: Record<CandidateSourceMissingReason, string> = {
  EXPERIMENT: "来源实验在当前库中已不存在",
  CONCLUSION: "来源结论在当前库中已不存在",
  DATASET_VERSION: "来源 Dataset 版本在 Dataset Registry 中查不到",
};

/**
 * 缺失来源的诚实说明。
 *
 * 来源是**快照值（非 FK）**：上游被删除后候选仍然可读，但必须**如实标注**，
 * 而不是显示成「无来源」或悄悄留空（006.0 §8.3）。
 */
export function sourceMissingNote(
  missing: readonly CandidateSourceMissingReason[] | null | undefined,
): string | null {
  if (!missing || missing.length === 0) return null;
  const parts = missing.map((m) => MISSING_NOTES[m] ?? m);
  return `${parts.join("；")}。候选里保存的是登记当时的快照，不会因此丢失。`;
}

export function buildCandidateSourceVm(view: CandidateDetailViewLike): CandidateSourceVm {
  const missing = [...view.sourceMissing];
  return {
    experiment: view.experiment,
    conclusion: view.conclusion,
    runId:
      view.candidate.sourceResearchRunId === null || view.candidate.sourceResearchRunId === undefined
        ? null
        : view.candidate.sourceResearchRunId,
    dataset: view.dataset,
    missing,
    missingNote: sourceMissingNote(missing),
  };
}

/** 候选详情 → ViewModel。 */
export function candidateToDetailVm(view: CandidateDetailViewLike): CandidateDetailVm {
  const { candidate } = view;
  return {
    id: candidate.id ?? null,
    name: candidate.name,
    description: candidate.description ?? null,
    status: candidate.status,
    statusLabel: candidateStatusLabelOf(candidate.status),
    strategyDefinitionId: candidate.strategyDefinitionId ?? null,
    createdAt: candidate.createdAt ?? null,
    updatedAt: candidate.updatedAt ?? null,
    source: buildCandidateSourceVm(view),
    sketch: CANDIDATE_SKETCH_FIELDS.map((spec) => {
      const text = sketchFieldText(candidate[spec.key]);
      return { key: spec.key, label: spec.label, hint: spec.hint, text, present: text !== null };
    }),
    sourceDatasetDivergenceReason: candidate.sourceDatasetDivergenceReason ?? null,
  };
}

/** 候选列表行（`researchEngine.listCandidates` 的返回项）→ ViewModel。 */
export function candidateToRowVm(row: CandidateRawLike): CandidateRowVm {
  return {
    id: row.id ?? null,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    statusLabel: candidateStatusLabelOf(row.status),
    strategyDefinitionId: row.strategyDefinitionId ?? null,
    conclusionId: row.conclusionId ?? null,
    sourceDatasetVersionId: row.sourceDatasetVersionId ?? null,
    createdAt: row.createdAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// 错误提示（由后端 tRPC code 驱动，不臆造领域码）
// ---------------------------------------------------------------------------

/** 候选 UI 会发起的三个写操作的意图标识（用于给出**针对性**提示）。 */
export type CandidateUiOperation = "CREATE_FROM_CONCLUSION" | "UPDATE_SKETCH" | "TRANSITION";

interface RpcErrorLike {
  message?: unknown;
  data?: unknown;
}

function readRpcCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as RpcErrorLike).data;
  if (!data || typeof data !== "object") return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

function readRpcMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as RpcErrorLike).message;
    if (typeof message === "string" && message.trim().length > 0) return message.trim();
  }
  if (typeof error === "string" && error.trim().length > 0) return error.trim();
  return "";
}

/** tRPC 语义 code → 通用标题（未收录时回退「请求失败」，不猜）。 */
const TRPC_CODE_TITLES: Record<string, string> = {
  BAD_REQUEST: "请求内容不合法",
  UNAUTHORIZED: "未登录",
  FORBIDDEN: "需要管理员权限",
  NOT_FOUND: "找不到对象",
  CONFLICT: "与既有事实冲突",
  PRECONDITION_FAILED: "当前状态不允许这个操作",
  TOO_MANY_REQUESTS: "请求过于频繁",
  PAYLOAD_TOO_LARGE: "请求体过大",
  TIMEOUT: "请求超时",
  INTERNAL_SERVER_ERROR: "服务端错误",
};

/** 操作 → 中文意图（拼进标题，让「哪一步失败」一眼可见）。 */
const OPERATION_TITLES: Record<CandidateUiOperation, string> = {
  CREATE_FROM_CONCLUSION: "登记策略候选",
  UPDATE_SKETCH: "保存候选草图",
  TRANSITION: "候选状态流转",
};

/**
 * 针对「操作 × code」的可执行解释。
 *
 * 只收录**前端确实能给出下一步**的组合；未收录的组合回退到「展示后端原文」，
 * 而不是编一句听起来合理的话。
 *
 * ⚠️ 每一条 hint 都必须对得上后端**真实会发生**的映射（`strategyCandidate/router.ts#toTrpcError`）：
 *   例如「候选已转正 ⇒ 草图不可改」是**不存在**的规则（`update` 只挡结构与来源字段，
 *   不挡状态）⇒ 这类听起来合理的解释一律不许写进来。
 */
const OPERATION_HINTS: Partial<Record<string, string>> = {
  "CREATE_FROM_CONCLUSION:CONFLICT":
    "同一个结论下不允许出现同名候选。请换一个候选名，或打开已存在的候选继续编辑。",
  "CREATE_FROM_CONCLUSION:PRECONDITION_FAILED":
    "登记候选要求：结论状态为 DRAFT / FINAL（已被取代的结论不得进入策略链路），且结论所属实验绑定的 Dataset 版本存在并且是 READY。",
  "CREATE_FROM_CONCLUSION:NOT_FOUND":
    "结论 / 实验 / Dataset 版本有一项查不到了。请回到结论页确认该结论仍在，并到「数据集构建」确认绑定的版本还存在。",
  "CREATE_FROM_CONCLUSION:BAD_REQUEST":
    "入参不合法（例如候选名为空、携带了后端不允许的字段）。建议只提交结论 + 候选名 / 描述。",
  "UPDATE_SKETCH:BAD_REQUEST":
    "只能修改后端允许的 7 个草图字段（name / description / entryRule / filterRule / exitRule / riskRule / parameterSpace），且不能提交空补丁或未知字段。",
  "UPDATE_SKETCH:NOT_FOUND": "候选不存在（可能已被删除）。请返回实验页重新打开。",
  "TRANSITION:CONFLICT":
    "该迁移不在候选状态机允许的路径上，或候选已经是目标状态。注意：CONVERTED（已转正）**不由状态流转产生** —— 它只能由转正入口写入，普通流转一律被拒绝（后端专属码 STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE）。",
  "TRANSITION:BAD_REQUEST":
    "入参不合法：目标状态必须是后端开放的字面量之一（REVIEW / ACCEPTED / REJECTED / ARCHIVED）。",
  "TRANSITION:NOT_FOUND": "候选不存在（可能已被删除）。请返回实验页重新打开。",
};

export function candidateErrorDiagnostic(
  error: unknown,
  operation: CandidateUiOperation,
): DiagnosticError {
  const code = readRpcCode(error);
  const raw = readRpcMessage(error);
  const title = OPERATION_TITLES[operation];
  const codeTitle = code ? (TRPC_CODE_TITLES[code] ?? "请求失败") : null;
  const hint = code ? OPERATION_HINTS[`${operation}:${code}`] : undefined;

  const explanation = hint
    ? raw
      ? `${hint}\n服务端说明：${raw}`
      : hint
    : raw || "后端未返回可读的错误信息。";

  return {
    code: code ?? "RPC_ERROR",
    title: codeTitle ? `${title}失败：${codeTitle}` : `${title}失败`,
    explanation,
    suggestions:
      code === "FORBIDDEN"
        ? ["使用管理员账号登录后重试"]
        : code === "CONFLICT" || code === "PRECONDITION_FAILED"
          ? ["刷新页面确认候选当前状态", "按上面的说明调整后再试一次"]
          : ["重试一次", "若持续失败，查看服务端日志中的原始错误"],
    technical: raw || String(error),
  };
}

// ---------------------------------------------------------------------------
// RESEARCH-006.4.1-B —— 转正（promote）结果
// ---------------------------------------------------------------------------

/**
 * 转正返回体（后端 `PromoteCandidateResult`）的**只读**形状。
 * 字段名逐一对照 `server/research/strategyCandidate/service.ts`，**不猜**。
 */
export interface PromoteResultLike {
  candidateId: number;
  /** `strategies.strategyId`（由候选派生，如 `cand-180001`）。 */
  strategyId: string;
  /** `strategy_versions.id`（权威行锚）。 */
  strategyVersionId: number;
  /** semver（首次转正恒为 `1.0.0`）。 */
  strategyVersion: string;
  provenanceId: number;
  origin: string;
  candidateStatus: string;
  sourceDatasetVersionId: number | null;
  sourceDatasetLabel: string | null;
  executionDatasetVersionId: number;
  datasetDivergence: boolean;
  sourceDatasetDivergenceReason: string | null;
  fingerprint: string;
  /** 🔴 `true` = 本次**没有**新建 Strategy / Version（幂等命中或跨存储恢复）。 */
  idempotent: boolean;
}

export interface PromoteResultVm {
  candidateId: number;
  strategyId: string;
  strategyVersionId: number;
  strategyVersion: string;
  provenanceId: number;
  origin: string;
  idempotent: boolean;
  /** 结果标题 —— **幂等与首次必须不同**（§18：不能把上次的结果说成「新建成功」）。 */
  title: string;
  summary: string;
  sourceDatasetVersionId: number | null;
  sourceDatasetLabel: string | null;
  executionDatasetVersionId: number;
  /** 执行 Dataset 的 label；调用方从已加载的 Registry 清单里带进来，取不到即 `null`（不猜）。 */
  executionDatasetLabel: string | null;
  datasetDivergence: boolean;
  sourceDatasetDivergenceReason: string | null;
  fingerprint: string;
  /** 「查看 Strategy Version」落点（现有策略页 + 坐标查询参数，不新增页面）。 */
  path: string;
}

/**
 * 现有 Strategy 页的坐标式落点。
 *
 * 为什么用查询参数而不是新路由：仓库**只有一个**策略页（`/strategy-editor`），
 * 任务 §17 / §20 明确「不要新增无必要的 Strategy 页面 / 不要新建第二套 Strategy Version 页面」
 * ⇒ 由 `StrategyEditor` 读取这两个参数定位版本。
 */
export function strategyVersionPath(strategyId: string, version: string): string {
  return `/strategy-editor?strategyId=${encodeURIComponent(strategyId)}&version=${encodeURIComponent(version)}`;
}

export interface PromoteResultOptions {
  /** 执行 Dataset 的 label（来自 Dataset Registry 清单）；缺省 `null` = 只显示 `#id`。 */
  executionDatasetLabel?: string | null;
}

export function promoteResultToVm(
  result: PromoteResultLike,
  options: PromoteResultOptions = {},
): PromoteResultVm {
  const executionDatasetLabel = options.executionDatasetLabel ?? null;
  const datasetText =
    executionDatasetLabel === null
      ? `#${result.executionDatasetVersionId}`
      : `#${result.executionDatasetVersionId}（${executionDatasetLabel}）`;
  return {
    candidateId: result.candidateId,
    strategyId: result.strategyId,
    strategyVersionId: result.strategyVersionId,
    strategyVersion: result.strategyVersion,
    provenanceId: result.provenanceId,
    origin: result.origin,
    idempotent: result.idempotent,
    title: result.idempotent ? "该候选已经转正，本次未创建新的 Strategy Version" : "转正成功",
    summary: result.idempotent
      ? `后端命中幂等闸门：复用既有 Strategy ${result.strategyId}@${result.strategyVersion}，`
        + `执行 Dataset ${datasetText}。**没有**产生新的 Strategy / Version / 溯源行。`
      : `已创建 Strategy ${result.strategyId}@${result.strategyVersion}，执行 Dataset ${datasetText}。`,
    sourceDatasetVersionId: result.sourceDatasetVersionId,
    sourceDatasetLabel: result.sourceDatasetLabel,
    executionDatasetVersionId: result.executionDatasetVersionId,
    executionDatasetLabel,
    datasetDivergence: result.datasetDivergence,
    sourceDatasetDivergenceReason: result.sourceDatasetDivergenceReason,
    fingerprint: result.fingerprint,
    path: strategyVersionPath(result.strategyId, result.strategyVersion),
  };
}

// ---------------------------------------------------------------------------
// 006.4.1-B —— 转正错误：领域码 → 可执行解释
// ---------------------------------------------------------------------------

/**
 * 从 tRPC 错误消息里抠出**领域码**。
 *
 * 服务端已把领域码写进 message（`[DOMAIN_CODE] …`，见
 * `server/research/strategyCandidate/router.ts#withDomainCode`），这里用与
 * `researchEngineAdapter#rpcErrorToDiagnostic` **同一个**正则约定读取 ——
 * 两边共用一套协议，不新造。
 *
 * `null` = 消息里没有领域码（例如 zod 传输层拒绝、或非桥的错误）⇒ 调用方回退按 tRPC code 提示。
 */
export function readRpcDomainCode(error: unknown): string | null {
  const match = /\[([A-Z_]{3,})\]/u.exec(readRpcMessage(error));
  return match?.[1] ?? null;
}

export interface PromoteDomainHint {
  title: string;
  explanation: string;
}

/**
 * 转正领域码 → 用户可执行的解释（§11 / §27.4）。
 *
 * 🔴 纪律：**每一条都必须对得上后端真实会发生的映射**，且能给出不同的下一步。
 * 拿不到映射的组合一律回退「展示后端原文」，**不编**一句听起来合理的话。
 *
 * key 用的是后端**真实字面量**（`STRATEGY_CANDIDATE_*`，见
 * `server/research/strategyCandidate/candidateTypes.ts#STRATEGY_CANDIDATE_ERROR`）；
 * `promoteForm.test.ts` 会 import 真常量断言这些 key **全部真实存在**（防抄错 / 防后端改名后静默失效）。
 */
export const PROMOTE_DOMAIN_HINTS: Readonly<Record<string, PromoteDomainHint>> = {
  STRATEGY_CANDIDATE_NOT_ACCEPTED: {
    title: "候选不是「已采纳」状态",
    explanation:
      "只有 ACCEPTED（已采纳）的候选允许转正。请先在候选详情里把状态流转到 ACCEPTED，再执行转正。",
  },
  STRATEGY_CANDIDATE_PROMOTE_SOURCE_INCOMPLETE: {
    title: "候选缺少来源锚",
    explanation:
      "转正要求把来源结论与来源实验写进溯源。该候选的 conclusionId / experimentId 不完整 ⇒ 需要人工核对上游数据，本页无法自行修复。",
  },
  STRATEGY_CANDIDATE_PROMOTE_SKETCH_INCOMPLETE: {
    title: "策略草图缺少必填内容",
    explanation:
      "策略定义必须由草稿生成，缺什么就**回去补什么**（后端绝不补默认值）。请到「编辑候选草图」把入场/退出/风控等必填项补齐后再转正。",
  },
  STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID: {
    title: "策略草图内容不合法",
    explanation:
      "草图字段存在但不被 StrategyDefinition 词表支持（例如用了不支持的算子 / 缺少取值域 / 字段引用写法不对）。请**回去改**草稿里被点到的那一项，而不是在转正时绕过草稿另给定义。",
  },
  STRATEGY_CANDIDATE_PROMOTE_DEFINITION_INVALID: {
    title: "生成出的策略定义未通过校验",
    explanation:
      "由草图构建出的 StrategyDefinition 未通过既有校验（含 Look-Ahead L1–L8 时序规则）。请按服务端说明调整草图的时间语义后再试。",
  },
  STRATEGY_CANDIDATE_DATASET_DIVERGENCE_REASON_REQUIRED: {
    title: "需要填写「数据集分歧原因」",
    explanation:
      "执行 Dataset 与研究来源 Dataset 不同，必须写明人可读的原因（留痕要求）。请补填原因后重试。",
  },
  STRATEGY_CANDIDATE_DATASET_VERSION_NOT_READY: {
    title: "执行 Dataset 版本未就绪",
    explanation:
      "只有 READY 的 Dataset 版本才能作为策略执行绑定。请到「数据集构建」确认该版本构建完成（状态 READY）后重试。",
  },
  STRATEGY_CANDIDATE_DATASET_VERSION_NOT_FOUND: {
    title: "执行 Dataset 版本不存在",
    explanation:
      "指定的 dataset_version.id 在 Dataset Registry 里查不到（不自动创建、也不接受第二套坐标）。请重新选择版本。",
  },
  STRATEGY_CANDIDATE_DATASET_VERSION_INVALID: {
    title: "执行 Dataset 坐标不合法",
    explanation:
      "既没有显式指定执行 Dataset，候选也没有可继承的研究来源 Dataset。请显式选择一个 READY 版本后重试。",
  },
  STRATEGY_CANDIDATE_DATASET_BINDING_INVALID: {
    title: "Dataset 绑定语义冲突",
    explanation:
      "该 Dataset 版本存在但无法解析其业务码等绑定信息。请先到「数据集构建」核对该数据集定义，或换一个版本。",
  },
  STRATEGY_CANDIDATE_PROMOTE_STRATEGY_ID_CONFLICT: {
    title: "派生出的策略 ID 已被占用",
    explanation:
      "由候选派生出的 strategyId 已属于**另一个**策略（同 id 但该版本不存在）。后端拒绝挂靠 ⇒ 需人工核对策略库，本页不要反复重试。",
  },
  STRATEGY_CANDIDATE_PROMOTE_VERSION_CONFLICT: {
    title: "同名版本内容不一致",
    explanation:
      "已存在同名版本但内容指纹不同 ⇒ 违反「版本不可变」，后端拒绝覆盖。请不要重复转正，先核对已有版本。",
  },
  STRATEGY_CANDIDATE_PROMOTE_STATE_INCONSISTENT: {
    title: "候选状态与溯源不一致",
    explanation:
      "候选状态与溯源表记录对不上（例如已是 CONVERTED 却查不到对应策略版本）。这属于需要人工核对的不一致状态，**不要**通过重建候选绕过。",
  },
  STRATEGY_CANDIDATE_PROMOTE_WRITEBACK_FAILED: {
    title: "跨存储写回异常（Strategy 可能已经建出来了）",
    explanation:
      "转正过程中发生跨存储写回异常。请不要创建新 Candidate，当前结果可通过再次执行 Promote 恢复。"
      + "已创建的 Strategy **不会被删除**；再次转正会命中幂等闸门复用同一份结果。",
  },
  STRATEGY_CANDIDATE_INVALID_INPUT: {
    title: "转正入参不合法",
    explanation:
      "只允许提交 candidateId 与极窄的 overrides（datasetBinding.datasetVersionId / datasetDivergenceReason）。"
      + "策略定义永远由服务端从草稿生成，调用方不得提交。",
  },
};

/** 「写回失败」时后端已产出的坐标（§11 要求**必须展示**这三项）。 */
export interface PromoteWritebackDetails {
  strategyId: string | null;
  strategyVersionId: string | null;
  strategyVersion: string | null;
  stage: string | null;
}

/**
 * 从后端消息里解析写回坐标。
 *
 * 服务端 `router.ts#describeDetails` 把 details 拼成 `（key=value / key=value）` 附在 message 末尾；
 * 这里只做**读取**，解析不到就返回 `null`（**绝不**用本地状态补一个看起来对的 id）。
 */
export function parsePromoteWritebackDetails(message: string): PromoteWritebackDetails {
  const pick = (key: string): string | null => {
    const match = new RegExp(`${key}=([^\\s/）)]+)`, "u").exec(message);
    const value = match?.[1];
    return value === undefined || value.length === 0 ? null : value;
  };
  return {
    strategyId: pick("strategyId"),
    strategyVersionId: pick("strategyVersionId"),
    strategyVersion: pick("strategyVersion"),
    stage: pick("stage"),
  };
}

export interface PromoteFailureVm {
  diagnostic: DiagnosticError;
  /** 领域码（服务端未写入 message 时为 `null`）。 */
  domainCode: string | null;
  /** tRPC 语义 code（分类用）。 */
  trpcCode: string | null;
  /** 仅 `PROMOTE_WRITEBACK_FAILED` 有值；其余情况 `null`。 */
  writeback: PromoteWritebackDetails | null;
}

/**
 * 转正失败 → 用户可读诊断。
 *
 * 优先按**领域码**给针对性解释（§27.4 要求各码得到**不同**诊断）；拿不到领域码时回退到
 * tRPC 语义 code 的通用标题 —— 与 `candidateErrorDiagnostic` 同一纪律：不臆造、不吞原文。
 */
export function promoteFailureVm(error: unknown): PromoteFailureVm {
  const trpcCode = readRpcCode(error);
  const raw = readRpcMessage(error);
  const domainCode = readRpcDomainCode(error);
  const hint = domainCode === null ? undefined : PROMOTE_DOMAIN_HINTS[domainCode];
  const writeback =
    domainCode === "STRATEGY_CANDIDATE_PROMOTE_WRITEBACK_FAILED"
      ? parsePromoteWritebackDetails(raw)
      : null;

  const genericTitle = trpcCode ? (TRPC_CODE_TITLES[trpcCode] ?? "请求失败") : "请求失败";
  const title = hint ? `转正失败：${hint.title}` : `转正失败：${genericTitle}`;
  const explanation = hint
    ? raw
      ? `${hint.explanation}\n服务端说明：${raw}`
      : hint.explanation
    : raw || "后端未返回可读的错误信息。";

  return {
    diagnostic: {
      code: domainCode ?? trpcCode ?? "RPC_ERROR",
      title,
      explanation,
      suggestions:
        domainCode === "STRATEGY_CANDIDATE_PROMOTE_WRITEBACK_FAILED"
          ? [
              "再次执行转正（幂等闸门会复用已创建的 Strategy，不会产生第二份）",
              "不要创建新的候选来「重来一次」",
            ]
          : domainCode === "STRATEGY_CANDIDATE_PROMOTE_SKETCH_INCOMPLETE"
            ? ["回到候选详情，把草图缺失项补齐后再转正"]
            : domainCode === "STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID"
              ? ["回到候选详情，修正草图里被点到的那一项"]
              : domainCode === "STRATEGY_CANDIDATE_NOT_ACCEPTED"
                ? ["先把候选流转到 ACCEPTED"]
                : trpcCode === "FORBIDDEN"
                  ? ["使用管理员账号登录后重试"]
                  : ["按上面的说明调整后重试", "若持续失败，查看服务端日志中的原始错误"],
      technical: raw || String(error),
    },
    domainCode,
    trpcCode,
    writeback,
  };
}

// ---------------------------------------------------------------------------
// 006.4.1-B —— Strategy Version 的 Research 溯源视图（只读展示）
// ---------------------------------------------------------------------------

export type ProvenanceMissingUpstream =
  | "SOURCE_CANDIDATE"
  | "SOURCE_CONCLUSION"
  | "SOURCE_EXPERIMENT"
  | "SOURCE_RESEARCH_RUN"
  | "SOURCE_DATASET_VERSION";

/** 后端 `PromotionProvenanceView` 的只读形状。 */
export interface PromotionProvenanceLike {
  strategyId: string;
  version: string;
  strategyVersionId: number | null;
  provenance: {
    id: number;
    origin: string;
    sourceCandidateId: number;
    sourceConclusionId: number;
    sourceExperimentId: number;
    sourceResearchRunId: number | null;
    sourceDatasetVersionId: number | null;
    sourceDatasetLabel: string | null;
    createdAt: string | null;
  } | null;
  executionDatasetVersionId: number | null;
  executionDatasetLabel: string | null;
  sourceDatasetDivergenceReason: string | null;
  missingUpstreams: readonly ProvenanceMissingUpstream[];
}

export interface ProvenanceRowVm {
  label: string;
  /** 展示值；`null` = 后端没有这一项（如实显示「—」，不补 0 / 不猜）。 */
  value: string | null;
  /** 该来源已查不到（快照仍在，只是上游没了）。 */
  missing: boolean;
}

export interface ProvenanceVm {
  strategyId: string;
  version: string;
  strategyVersionId: number | null;
  /** 是否有溯源行。`false` = 未转正 / 非本系统产出（不是错误）。 */
  hasProvenance: boolean;
  originLabel: string;
  rows: ProvenanceRowVm[];
  executionDatasetVersionId: number | null;
  executionDatasetLabel: string | null;
  sourceDatasetDivergenceReason: string | null;
  missingUpstreams: ProvenanceMissingUpstream[];
  /** 上游缺失的诚实说明；无缺失 → `null`。 */
  missingNote: string | null;
}

const MISSING_UPSTREAM_LABELS: Record<ProvenanceMissingUpstream, string> = {
  SOURCE_CANDIDATE: "来源候选",
  SOURCE_CONCLUSION: "来源结论",
  SOURCE_EXPERIMENT: "来源实验",
  SOURCE_RESEARCH_RUN: "来源 Research Run",
  SOURCE_DATASET_VERSION: "来源 Dataset 版本",
};

/**
 * 上游缺失说明。
 *
 * 🔴 措辞纪律（§23）：明说「来源已不存在」**且**明说「这不影响策略本身」——
 * 因为来源是快照值（零 FK），上游被删不该让策略打不开。
 */
export function provenanceMissingNote(
  missing: readonly ProvenanceMissingUpstream[] | null | undefined,
): string | null {
  if (!missing || missing.length === 0) return null;
  const names = missing.map(m => MISSING_UPSTREAM_LABELS[m] ?? m);
  return `${names.join("、")}已不存在（研究上游记录可能已被删除）。`
    + "这不影响该策略的读取与执行 —— 溯源是登记当时的快照，只用于追溯来源。";
}

function textOf(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? String(value) : value;
}

/** 🔴 溯源区的固定免责声明（§13 原话要求**必须显示**）。 */
export const PROVENANCE_DISCLAIMER = "Research Provenance 仅用于来源追溯，不参与 Strategy 执行。";

/** 溯源视图 → ViewModel（**零重算**：只搬运，缺就是缺）。 */
export function promotionProvenanceToVm(view: PromotionProvenanceLike): ProvenanceVm {
  const missingUpstreams = [...view.missingUpstreams];
  const missingSet = new Set<string>(missingUpstreams);
  const p = view.provenance;
  const rows: ProvenanceRowVm[] = p === null
    ? []
    : [
        { label: "来源类型", value: p.origin, missing: false },
        { label: "Source Candidate ID", value: String(p.sourceCandidateId), missing: missingSet.has("SOURCE_CANDIDATE") },
        { label: "Source Conclusion ID", value: String(p.sourceConclusionId), missing: missingSet.has("SOURCE_CONCLUSION") },
        { label: "Source Experiment ID", value: String(p.sourceExperimentId), missing: missingSet.has("SOURCE_EXPERIMENT") },
        { label: "Source Research Run ID", value: textOf(p.sourceResearchRunId), missing: missingSet.has("SOURCE_RESEARCH_RUN") },
        { label: "Source Dataset Version ID", value: textOf(p.sourceDatasetVersionId), missing: missingSet.has("SOURCE_DATASET_VERSION") },
        { label: "Source Dataset Label", value: textOf(p.sourceDatasetLabel), missing: missingSet.has("SOURCE_DATASET_VERSION") },
        { label: "Created At", value: textOf(p.createdAt), missing: false },
      ];
  return {
    strategyId: view.strategyId,
    version: view.version,
    strategyVersionId: view.strategyVersionId,
    hasProvenance: p !== null,
    originLabel: p === null ? "—" : p.origin,
    rows,
    executionDatasetVersionId: view.executionDatasetVersionId,
    executionDatasetLabel: view.executionDatasetLabel,
    sourceDatasetDivergenceReason: view.sourceDatasetDivergenceReason,
    missingUpstreams,
    missingNote: provenanceMissingNote(missingUpstreams),
  };
}
