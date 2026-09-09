/**
 * STEP 24 / C-24.2 — 纪律反馈分析：序列化 / 指纹 / 篡改拒绝（纯函数、确定性）。
 *
 * 对齐既有范式（tradeJournal/serialize.ts 等）：
 *   - fingerprint = sha256（canonicalStringify，来自 researchDataset/version 只读复用）；
 *   - 任何 NaN / Infinity 进入记录前直接抛错（assertFiniteRecord，不静默转 null）；
 *   - 反序列化 = JSON 解析 → validate 结构 → 指纹复核（任一步失败响亮抛错）。
 */

import { DFA_ERROR_CODES, DisciplineFeedbackError } from "./errors";
import type { DisciplineFeedbackRun } from "./types";
import { assertValidDisciplineFeedbackRun } from "./validate";
import { assertFiniteRecord, sha256Digest } from "./common";
import { canonicalStringify } from "../../researchDataset/version";

/** 计算记录指纹：除 fingerprint 字段外全部字段的 canonical 摘要。 */
export function computeDisciplineFeedbackRunFingerprint(
  run: DisciplineFeedbackRun | Omit<DisciplineFeedbackRun, "fingerprint">
): string {
  assertFiniteRecord(run, "run");
  const body: Record<string, unknown> = { ...(run as object) };
  delete body.fingerprint;
  return sha256Digest(body);
}

/** 序列化记录（canonical JSON；键字典序，拒绝 NaN/Infinity）。 */
export function serializeDisciplineFeedbackRun(run: DisciplineFeedbackRun): string {
  assertFiniteRecord(run, "run");
  return canonicalStringify(run);
}

/** 解析顶层对象（失败响亮）。 */
function parseTopLevelObject(json: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new DisciplineFeedbackError(
      DFA_ERROR_CODES.INPUT_INVALID,
      `${label}反序列化失败：JSON 解析错误（${(error as Error).message}）`
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DisciplineFeedbackError(DFA_ERROR_CODES.INPUT_INVALID, `${label}反序列化失败：顶层必须是对象`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * 反序列化记录：结构 + 语义校验（validate）→ 指纹复核。任一步失败即抛错，
 * 绝不返回被篡改 / 语义非法的记录。
 */
export function deserializeDisciplineFeedbackRun(json: string): DisciplineFeedbackRun {
  const parsed = parseTopLevelObject(json, "纪律反馈分析记录");
  const run = parsed as unknown as DisciplineFeedbackRun;
  assertValidDisciplineFeedbackRun(run);
  const recomputed = computeDisciplineFeedbackRunFingerprint(run);
  if (run.fingerprint !== recomputed) {
    throw new DisciplineFeedbackError(
      DFA_ERROR_CODES.RUN_FINGERPRINT_MISMATCH,
      `纪律反馈分析记录指纹不匹配：内容已被篡改或退化（期望 ${recomputed}，实际 ${run.fingerprint}）`
    );
  }
  return run;
}
