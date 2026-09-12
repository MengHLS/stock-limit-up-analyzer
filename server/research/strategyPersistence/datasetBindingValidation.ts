/**
 * STEP STRATEGY-004 — Strategy Dataset Binding **引用完整性**（唯一实现，纯领域 + 只读端口）。
 *
 * 断点背景（AUDIT-DRS-001 §8 断点①）：
 *   Strategy 侧 Dataset 绑定此前只做「`rd-…` 字符串格式」校验，任何形状合法的字符串都能落库 ——
 *   即「Strategy 保存成功但 Dataset Binding 实际无效」。本模块把校验升级为
 *   「查真实 Dataset Registry，必须存在 且 READY 且与 datasetId 一致」。
 *
 * 🔴 纪律（SPEC §2.1 B / §5 / §6）：
 *   - **只读**：只调用 Dataset Registry 的只读读取接口（`getVersionById` / `getDefinitionById`），
 *     **禁止**自动创建 Dataset、自动补 Dataset、绕过 Registry 直接读 `ds_*` 物理表；
 *   - **不新增第二套读取实现**：`port` 结构上由 Dataset Registry 既有 Repository 直接满足，
 *     本模块只负责「取回事实 → 判定 → 抛出结构化错误」；
 *   - **失败响亮**：不满足即抛 `StrategyDatasetBindingError`，绝不静默降级 / 绝不写半个绑定；
 *   - **legacy 兼容分支保留**：`datasetVersionId` 缺省（= 旧 `rd-…` 绑定）不做 DB 校验，
 *     这是显式的兼容路径，不是「校验通过」——意图是把旧绑定与「已校验坐标」区分开。
 *
 * 事务边界（SPEC §5「校验与持久化同一一致性边界」）：
 *   本函数被 `DbStrategyRepository.saveVersion` 在**数据库事务内**调用（见 db.ts），
 *   因此不存在「校验通过后、写入前 Dataset Version 被删/降级」的时间窗。
 *
 * 错误码（SPEC §2.1 B，至少三类）：
 *   DATASET_VERSION_NOT_FOUND  → `dataset_version` 无此行（id 不存在 / 已被删除）
 *   DATASET_VERSION_NOT_READY  → 行存在但 status ≠ READY（DRAFT / BUILDING / FAILED）
 *   DATASET_BINDING_INVALID    → 行存在且 READY，但绑定语义冲突（datasetId 不属于该版本 /
 *                                label 与 Registry 的 version 不一致 / 坐标形态非法）
 */

import type { StrategyDocument } from "../strategySchema/types";
import { isValidDatasetVersionId } from "../strategySchema/definition";

/** Dataset Binding 引用完整性错误码（对外稳定契约；测试与前端按码分支）。 */
export const STRATEGY_DATASET_BINDING_ERROR_CODES = [
  "DATASET_VERSION_NOT_FOUND",
  "DATASET_VERSION_NOT_READY",
  "DATASET_BINDING_INVALID",
] as const;
export type StrategyDatasetBindingErrorCode = (typeof STRATEGY_DATASET_BINDING_ERROR_CODES)[number];

/** 可用于研究的 Dataset Version 状态（唯一口径：`dataset_version.status === READY`）。 */
export const DATASET_VERSION_READY_STATUS = "READY";

// ---------------------------------------------------------------------------
// 只读端口（由 Dataset Registry 既有 Repository 直接满足，不新增实现）
// ---------------------------------------------------------------------------

/** `dataset_version` 的只读事实切片。 */
export interface DatasetVersionReference {
  readonly id?: number;
  /** → `dataset_definition.id`。 */
  readonly datasetId: number;
  /** 版本 label（`v1` / `v2`）。 */
  readonly version: string;
  /** DRAFT / BUILDING / READY / FAILED。 */
  readonly status: string;
}

/** `dataset_definition` 的只读事实切片。 */
export interface DatasetDefinitionReference {
  readonly id?: number;
  /** 稳定语义代码（`first_limit_pullback`）。 */
  readonly datasetCode: string;
}

/**
 * Dataset Registry 只读端口。
 *
 * `DatasetRegistryRepository`（server/datasetRegistry/registry.ts）结构上直接满足本接口，
 * 因此生产代码传入既有的 `DbDatasetRegistry` 即可 —— 不新增 SQL、不新增第二套读取实现。
 */
export interface DatasetVersionReferencePort {
  getVersionById(id: number): Promise<DatasetVersionReference | undefined>;
  getDefinitionById(id: number): Promise<DatasetDefinitionReference | undefined>;
}

// ---------------------------------------------------------------------------
// 请求 / 问题
// ---------------------------------------------------------------------------

/** 一条待校验的 Dataset 坐标（来自「definition 绑定」或「doc 级 PRIMARY 镜像」）。 */
export interface DatasetBindingCheckRequest {
  /** 错误定位路径（`definition.datasets[0]` / `datasetVersionId`）。 */
  readonly path: string;
  /** 绑定角色（PRIMARY / VALIDATION / OOS）；doc 级镜像固定 PRIMARY。 */
  readonly role: string;
  /**
   * 绑定声明的 `datasetId`。
   * 缺省 = 该层未声明 datasetId（doc 级镜像只有坐标），此时跳过「同属一个 Dataset」交叉校验。
   */
  readonly datasetId?: string;
  /** 绑定声明的 Dataset Version label（`v2`）。 */
  readonly datasetVersionLabel: string;
  /** Dataset Registry 权威坐标；缺省 = legacy `rd-…` 兼容分支（不做 DB 校验）。 */
  readonly datasetVersionId: number | undefined;
}

export interface DatasetBindingIssue {
  readonly code: StrategyDatasetBindingErrorCode;
  readonly path: string;
  readonly message: string;
}

/** Dataset Binding 校验失败（结构化；`code` = 首条 issue 的错误码）。 */
export class StrategyDatasetBindingError extends Error {
  readonly code: StrategyDatasetBindingErrorCode;
  readonly issues: readonly DatasetBindingIssue[];

  constructor(issues: readonly DatasetBindingIssue[]) {
    super(
      "Strategy Dataset Binding 引用完整性校验失败：" +
      issues.map((item) => `[${item.code}] ${item.path} — ${item.message}`).join("；"),
    );
    this.name = "StrategyDatasetBindingError";
    this.code = issues[0]?.code ?? "DATASET_BINDING_INVALID";
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// 语义判定（纯函数）
// ---------------------------------------------------------------------------

/**
 * `datasetId` 与 Registry `datasetCode` 是否指同一 Dataset。
 *
 * 兼容 `ds_{datasetCode}` 历史写法（旧 Dataset 命名 `ds_first_limit_pullback` 对应
 * Registry 的 `first_limit_pullback`）——**只**在刻度前缀上宽容，不做模糊匹配。
 */
export function datasetCodesMatch(bindingDatasetId: string, registryDatasetCode: string | null | undefined): boolean {
  if (typeof registryDatasetCode !== "string" || registryDatasetCode === "") return false;
  return bindingDatasetId === registryDatasetCode || bindingDatasetId === `ds_${registryDatasetCode}`;
}

/** 由 StrategyDocument 收集全部待校验坐标（definition 绑定为权威来源；无 definition 时退到 doc 级镜像）。 */
export function collectStrategyDatasetBindingRequests(document: StrategyDocument): DatasetBindingCheckRequest[] {
  const requests: DatasetBindingCheckRequest[] = [];
  const definition = document.definition;
  if (definition !== undefined && definition !== null) {
    definition.datasets.forEach((binding, index) => {
      requests.push({
        path: `definition.datasets[${index}]`,
        role: binding.role,
        datasetId: binding.datasetId,
        datasetVersionLabel: binding.datasetVersion,
        datasetVersionId: binding.datasetVersionId,
      });
    });
    return requests;
  }
  // 无 Canonical definition 的历史 / UI 文档：只有 doc 级 PRIMARY 镜像可校验。
  if (document.datasetVersionId !== undefined && document.datasetVersionId !== null) {
    requests.push({
      path: "datasetVersionId",
      role: "PRIMARY",
      datasetVersionLabel: document.datasetVersion,
      datasetVersionId: document.datasetVersionId,
    });
  }
  return requests;
}

/** 单条坐标判定（lookup 为已取回的事实；纯函数，无 IO）。 */
export function evaluateDatasetBinding(
  request: DatasetBindingCheckRequest,
  version: DatasetVersionReference | undefined,
  definition: DatasetDefinitionReference | undefined,
): DatasetBindingIssue[] {
  const id = request.datasetVersionId;
  const label = `${request.path}（${request.role}）`;

  if (id === undefined || id === null) {
    // legacy rd-… 兼容分支：不做引用完整性校验（保留旧行为，绝不冒充「已校验」）。
    return [];
  }
  if (!isValidDatasetVersionId(id)) {
    return [{
      code: "DATASET_BINDING_INVALID",
      path: request.path,
      message: `datasetVersionId 必须是正整数（dataset_version.id），实际：${String(id)}`,
    }];
  }
  if (version === undefined) {
    return [{
      code: "DATASET_VERSION_NOT_FOUND",
      path: request.path,
      message: `Dataset Version 不存在：dataset_version.id=${id}（${label}）；` +
        "Strategy 不会自动创建 / 自动补 Dataset，请先在 Dataset Registry 构建该版本",
    }];
  }
  if (version.status !== DATASET_VERSION_READY_STATUS) {
    return [{
      code: "DATASET_VERSION_NOT_READY",
      path: request.path,
      message: `Dataset Version 未就绪：dataset_version.id=${id} 当前 status=${String(version.status)}，` +
        `只有 ${DATASET_VERSION_READY_STATUS} 可用于策略绑定`,
    }];
  }

  const issues: DatasetBindingIssue[] = [];
  // 交叉校验 1：label 必须等于 Registry 的 version（防「id=390002 却写 v1」的虚假绑定）。
  if (request.datasetVersionLabel !== version.version) {
    issues.push({
      code: "DATASET_BINDING_INVALID",
      path: request.path,
      message: `datasetVersion label 与 Dataset Registry 不一致：绑定写 ${JSON.stringify(request.datasetVersionLabel)}，` +
        `dataset_version.id=${id} 实际 version=${JSON.stringify(version.version)}`,
    });
  }
  // 交叉校验 2：声明的 datasetId 必须属于该 Dataset Version 的 Dataset Definition。
  if (request.datasetId !== undefined && request.datasetId !== "") {
    const registryCode = definition?.datasetCode ?? null;
    if (registryCode === null) {
      issues.push({
        code: "DATASET_BINDING_INVALID",
        path: request.path,
        message: `无法解析 Dataset Version 所属 Dataset：dataset_definition.id=${version.datasetId} 不存在`,
      });
    } else if (!datasetCodesMatch(request.datasetId, registryCode)) {
      issues.push({
        code: "DATASET_BINDING_INVALID",
        path: request.path,
        message: `交叉绑定：绑定 datasetId=${JSON.stringify(request.datasetId)} 不属于 dataset_version.id=${id} ` +
          `（该版本属于 datasetId=${version.datasetId} / datasetCode=${JSON.stringify(registryCode)}）`,
      });
    }
  }
  return issues;
}

/**
 * 断言全部 Dataset 坐标合法（存在 / READY / label 一致 / datasetId 属于该版本）。
 *
 * - 只读取每个**不同** ds 坐标一次（去重，避免同一版本被多个 role 绑定时重复查询）；
 * - 任一 issue → 抛 `StrategyDatasetBindingError`（含全部 issue，绝不只报第一条）；
 * - 无请求 / 全部为 legacy → 不产生任何 IO 与错误。
 */
export async function assertStrategyDatasetBindings(
  requests: readonly DatasetBindingCheckRequest[],
  port: DatasetVersionReferencePort,
): Promise<void> {
  const ids = new Set<number>();
  for (const request of requests) {
    if (request.datasetVersionId !== undefined && request.datasetVersionId !== null) {
      ids.add(request.datasetVersionId);
    }
  }
  if (ids.size === 0) return;

  const versions = new Map<number, DatasetVersionReference | undefined>();
  const definitions = new Map<number, DatasetDefinitionReference | undefined>();
  for (const id of ids) {
    const version = await port.getVersionById(id);
    versions.set(id, version);
    if (version !== undefined && !definitions.has(version.datasetId)) {
      definitions.set(version.datasetId, await port.getDefinitionById(version.datasetId));
    }
  }

  const issues: DatasetBindingIssue[] = [];
  for (const request of requests) {
    const id = request.datasetVersionId;
    if (id === undefined || id === null) continue;
    const version = versions.get(id);
    issues.push(...evaluateDatasetBinding(
      request,
      version,
      version === undefined ? undefined : definitions.get(version.datasetId),
    ));
  }
  if (issues.length > 0) throw new StrategyDatasetBindingError(issues);
}
