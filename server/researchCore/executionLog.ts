/**
 * RESEARCH-002 — Run 执行批次日志（`research_run.executionLogJson`）的领域规则。
 *
 * 本模块只做两件事，都是纯函数：
 *   1. **校验 / 解析**：库里的 JSON 必须是结构合法的批次数组 —— 结构不合法要**响亮失败**，
 *      绝不静默降级成空数组（那会把「记录坏了」伪装成「没有记录」）；
 *   2. **批次号推进**：回答「下一次执行是第几批」。这里有一条**版本边界**规则：
 *      `inputSnapshot` 存在但日志为空，说明这条 Run 的 batch 1（全量）发生在日志列生效之前
 *      —— 此时 batch 1 已被视为占用，下一批从 2 起，**不 backfill 伪造一条 batch 1**。
 *
 * 边界：本模块**不写库**、不算统计、不碰执行器。
 */

import { decodeJson } from "./serialization";
import type {
  ResearchRunExecutionLogEntry,
  ResearchRunExecutionMode,
  ResearchRunExecutionStatus,
} from "./types";

const MODES: readonly ResearchRunExecutionMode[] = ["FULL", "INCREMENTAL"];
const STATUSES: readonly ResearchRunExecutionStatus[] = ["RUNNING", "COMPLETED", "FAILED"];

/** 结构非法时抛错（不返回半成品）。 */
export class ResearchExecutionLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchExecutionLogError";
  }
}

/**
 * 断言并收窄为 `ResearchRunExecutionLogEntry[]`。
 *
 * 逐条校验必填字段与取值域；**不**容忍缺字段（缺 `sequence` 的条目无法判断批次顺序）。
 */
export function assertResearchRunExecutionLog(
  value: unknown,
  field = "research_run.executionLogJson",
): ResearchRunExecutionLogEntry[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ResearchExecutionLogError(`${field} 应为数组，实得 ${typeof value}`);
  }
  const out: ResearchRunExecutionLogEntry[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i] as Record<string, unknown> | null;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ResearchExecutionLogError(`${field}[${i}] 应为对象`);
    }
    const seq = raw.sequence;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
      throw new ResearchExecutionLogError(`${field}[${i}].sequence 应为 ≥1 的整数，实得 ${String(seq)}`);
    }
    const mode = raw.mode;
    if (typeof mode !== "string" || !MODES.includes(mode as ResearchRunExecutionMode)) {
      throw new ResearchExecutionLogError(
        `${field}[${i}].mode 应为 ${MODES.join(" / ")}，实得 ${String(mode)}`,
      );
    }
    const status = raw.status;
    if (typeof status !== "string" || !STATUSES.includes(status as ResearchRunExecutionStatus)) {
      throw new ResearchExecutionLogError(
        `${field}[${i}].status 应为 ${STATUSES.join(" / ")}，实得 ${String(status)}`,
      );
    }
    if (!Array.isArray(raw.analysisIds) || raw.analysisIds.some((id) => typeof id !== "number")) {
      throw new ResearchExecutionLogError(`${field}[${i}].analysisIds 应为数字数组`);
    }
    if (typeof raw.startedAt !== "string" || raw.startedAt.length === 0) {
      throw new ResearchExecutionLogError(`${field}[${i}].startedAt 应为非空字符串`);
    }
    if (raw.completedAt !== null && typeof raw.completedAt !== "string") {
      throw new ResearchExecutionLogError(`${field}[${i}].completedAt 应为字符串或 null`);
    }
    if (raw.sampleCount !== null && typeof raw.sampleCount !== "number") {
      throw new ResearchExecutionLogError(`${field}[${i}].sampleCount 应为数字或 null`);
    }

    const entry: ResearchRunExecutionLogEntry = {
      sequence: seq,
      mode: mode as ResearchRunExecutionMode,
      analysisIds: [...(raw.analysisIds as number[])],
      sampleCount: (raw.sampleCount ?? null) as number | null,
      status: status as ResearchRunExecutionStatus,
      startedAt: raw.startedAt,
      completedAt: (raw.completedAt ?? null) as string | null,
    };
    if (typeof raw.errorCode === "string") entry.errorCode = raw.errorCode;
    if (typeof raw.errorMessage === "string") entry.errorMessage = raw.errorMessage;
    if (typeof raw.conclusionSkippedReason === "string") {
      entry.conclusionSkippedReason = raw.conclusionSkippedReason;
    }
    out.push(entry);
  }
  return out;
}

/** 解析库中的 JSON 文本（NULL → undefined，不做空数组伪装）。 */
export function parseResearchRunExecutionLog(
  text: string | null | undefined,
  field = "research_run.executionLogJson",
): ResearchRunExecutionLogEntry[] | undefined {
  const decoded = decodeJson<unknown>(text, field);
  if (decoded === undefined) return undefined;
  return assertResearchRunExecutionLog(decoded, field);
}

/**
 * 下一次执行的批次号。
 *
 * 规则：
 *   - `max(日志中已有的 sequence) + 1`；
 *   - 日志为空但 `inputSnapshot` 已存在 → batch 1 已在列生效之前用掉 → 返回 **2**
 *     （如实承认历史，不 backfill 一条伪造的 batch 1）；
 *   - 两者皆无（全新 Run）→ 返回 **1**。
 */
export function nextExecutionSequence(run: {
  executionLog?: ResearchRunExecutionLogEntry[] | null;
  inputSnapshot?: unknown;
}): number {
  const log = assertResearchRunExecutionLog(run.executionLog ?? null);
  let max = 0;
  for (const entry of log) {
    if (entry.sequence > max) max = entry.sequence;
  }
  if (max > 0) return max + 1;
  const hasSnapshot =
    run.inputSnapshot !== null && run.inputSnapshot !== undefined && run.inputSnapshot !== "";
  return hasSnapshot ? 2 : 1;
}

/** 追加一个批次条目并返回**新数组**（不修改入参；追加式语义）。 */
export function appendExecutionLogEntry(
  run: { executionLog?: ResearchRunExecutionLogEntry[] | null },
  entry: ResearchRunExecutionLogEntry,
): ResearchRunExecutionLogEntry[] {
  const log = assertResearchRunExecutionLog(run.executionLog ?? null);
  const ids = new Set(log.map((e) => e.sequence));
  if (ids.has(entry.sequence)) {
    throw new ResearchExecutionLogError(
      `批次号 ${entry.sequence} 已存在于该 Run 的执行日志中（批次号必须唯一且不跳号）`,
    );
  }
  return [...log, entry];
}

/** 用 `sequence` 就地替换一个条目（仅用于把 RUNNING 批次收敛为终态；不新增条目）。 */
export function settleExecutionLogEntry(
  run: { executionLog?: ResearchRunExecutionLogEntry[] | null },
  sequence: number,
  patch: Partial<Omit<ResearchRunExecutionLogEntry, "sequence" | "mode" | "analysisIds" | "startedAt">>,
): ResearchRunExecutionLogEntry[] {
  const log = assertResearchRunExecutionLog(run.executionLog ?? null);
  let found = false;
  const next = log.map((entry) => {
    if (entry.sequence !== sequence) return entry;
    found = true;
    return { ...entry, ...patch };
  });
  if (!found) {
    throw new ResearchExecutionLogError(`该 Run 的执行日志中不存在批次号 ${sequence}`);
  }
  return next;
}
