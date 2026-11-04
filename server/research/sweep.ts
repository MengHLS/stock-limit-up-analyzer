/**
 * STEP 6.3 — Experiment Batch / Sweep Result / Summary 模型 + Fingerprint。
 *
 * 职责边界：
 *   - ExperimentBatch 记录「一批 Experiment 是根据什么参数空间产生的」；
 *   - SweepResult 是「一个 Experiment 的执行结果 + 完整参数集」的可追溯视图；
 *   - SweepSummary 是「一批运行的总数 / 成功 / 失败 / 取消」汇总；
 *   - parameterSpaceFingerprint 是研究审计辅助（canonical SHA-256），不是 Experiment ID 的替代品；
 *   - sortSweepResults 只排序，不自动选 Top1 / 不写回 Strategy Config（排序 ≠ 自动优化）。
 *
 * 本模块不实现任何 Backtest / 交易 / 成交逻辑。
 */

import { createHash, randomBytes } from "node:crypto";
import type { PerformanceMetrics } from "../engine/domain";
import { assertValidParameterSpace, type ParameterSpace, type SweepParameterDefinition } from "./parameterSpace";
import type { ResearchParameterSet } from "./types";

// ---------------------------------------------------------------------------
// Batch 身份与状态
// ---------------------------------------------------------------------------

/** Batch 状态（沿用 STEP 6.2 小写约定；cancelled 保留位，本阶段顺序执行不实现主动取消）。 */
export type SweepBatchStatus = "created" | "running" | "completed" | "failed" | "cancelled";

/** 批 ID 前缀。 */
export const BATCH_ID_PREFIX = "BATCH";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 组装批 ID（`BATCH-YYYYMMDD-XXXXXXXX`）。纯函数、确定性。 */
export function formatBatchId(date: string, suffix: string): string {
  return `${BATCH_ID_PREFIX}-${date}-${suffix}`;
}

/** 生成唯一批 ID；注入 suffix 时（测试）为确定性。属于批元数据，允许随机后缀。 */
export function generateBatchId(now: Date = new Date(), suffix?: string): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const resolvedSuffix = suffix ?? randomBytes(4).toString("hex").toUpperCase();
  return formatBatchId(date, resolvedSuffix);
}

/** 一次参数扫描批次：记录策略身份 + 参数空间快照 + 生成的 Experiment 列表 + 状态。 */
export interface ExperimentBatch {
  batchId: string;
  strategyId: string;
  strategyVersion: string;
  /** 冻结的参数空间快照（可追溯「当时到底搜了哪些参数」）。 */
  parameterSpace: ParameterSpace;
  /** 参数空间 canonical fingerprint（研究审计辅助）。 */
  parameterSpaceFingerprint: string;
  /** 该批次生成的 Experiment ID 列表（顺序 = 组合生成顺序）。 */
  experimentIds: string[];
  status: SweepBatchStatus;
  createdAt: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Sweep Result / Summary
// ---------------------------------------------------------------------------

/** 单条 Sweep 结果状态（映射自 Run 终态；「未运行/取消」为 cancelled）。 */
export type SweepResultStatus = "succeeded" | "failed" | "cancelled";

/** 单条 Sweep 结果：完整参数集 + 运行身份 + 状态 + 指标（可审计追溯）。 */
export interface SweepResult {
  experimentId: string;
  runId?: string;
  parameterSet: ResearchParameterSet;
  status: SweepResultStatus;
  /** 成功时的绩效指标（复用引擎 PerformanceMetrics，不重实现统计）。 */
  metrics?: PerformanceMetrics;
  /** 失败时的错误信息。 */
  error?: string;
}

/** 批运行汇总：总数 / 成功 / 失败 / 取消。 */
export interface SweepSummary {
  batchId: string;
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
}

// ---------------------------------------------------------------------------
// Fingerprint（canonical SHA-256）
// ---------------------------------------------------------------------------

/** 单个参数定义的 canonical 表示：键按字典序排序，值原样保留。 */
function canonicalizeDefinition(param: SweepParameterDefinition): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(param).sort(([left], [right]) => left.localeCompare(right)),
  );
}

/**
 * 参数空间 canonical fingerprint（SHA-256）。
 * 仅对参数空间做 canonical 序列化（参数顺序有意义，定义内键排序）；
 * 与 strategyId / strategyVersion 分离存储，不作为 batchId / Experiment ID 的替代品。
 */
export function computeParameterSpaceFingerprint(space: ParameterSpace): string {
  const canonical = { parameters: space.parameters.map(canonicalizeDefinition) };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// ---------------------------------------------------------------------------
// 参数空间序列化（持久化用）
// ---------------------------------------------------------------------------

/** 严格 replacer：拒绝非有限数字（NaN/Infinity 不得静默转 null）。 */
function strictReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`拒绝序列化非有限数字：${String(value)}`);
  }
  return value;
}

/** 序列化参数空间（持久化 snapshot 用）。 */
export function serializeParameterSpace(space: ParameterSpace): string {
  return JSON.stringify(space, strictReplacer);
}

/** 反序列化参数空间（结构校验，非法抛 ResearchValidationError）。 */
export function deserializeParameterSpace(json: string): ParameterSpace {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("反序列化参数空间失败：结果不是对象");
  }
  const space = parsed as ParameterSpace;
  assertValidParameterSpace(space);
  return space;
}

// ---------------------------------------------------------------------------
// 排序（排序 ≠ 自动优化）
// ---------------------------------------------------------------------------

/** 排序选项：指标 + 方向（desc 默认 = 值越大越靠前；drawdown 类指标请显式 asc）。 */
export interface SortSweepResultsOptions {
  metric: keyof PerformanceMetrics;
  direction?: "asc" | "desc";
}

/**
 * 按指定指标排序 Sweep 结果（返回新数组，不修改入参）。
 * 缺失 / 非有限 / null 指标确定性排在末尾；同值保持原始相对顺序（稳定排序）。
 * 注意：本函数仅排序，绝不自动选择 Top1、绝不写回 Strategy Config / 生产参数。
 */
export function sortSweepResults(results: readonly SweepResult[], options: SortSweepResultsOptions): SweepResult[] {
  const { metric, direction = "desc" } = options;
  const numeric = (value: number | null | undefined): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
  };

  return [...results].sort((left, right) => {
    const leftValue = numeric(left.metrics?.[metric]);
    const rightValue = numeric(right.metrics?.[metric]);
    if (leftValue === null && rightValue === null) return 0;
    if (leftValue === null) return 1; // null 排后
    if (rightValue === null) return -1;
    if (leftValue < rightValue) return direction === "asc" ? -1 : 1;
    if (leftValue > rightValue) return direction === "asc" ? 1 : -1;
    return 0;
  });
}
