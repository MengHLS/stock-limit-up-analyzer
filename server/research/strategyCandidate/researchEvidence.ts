/**
 * STRATEGY-RESEARCH-BRIDGE-001 — **Research Evidence 契约**（纯域；零 IO / 零 DB / 零随机）。
 *
 * ## 它解决什么
 *
 * 规格 §4 要求「最小、稳定、可版本化的 Research Evidence 引用能力」，§12 要求
 * 「引用必须指向**真实存在的 Run** / Experiment Version」，§6 要求
 * 「Research Evidence 改变 ⇒ Strategy Version 的**身份**必须能够识别变化」。
 *
 * 本文件只做三件事，且都是**纯函数**：
 *   1. **声明面**：`ResearchEvidenceRef`（作者/调用方给的东西）→ 校验；
 *   2. **解析面**：`ResearchEvidenceRecord`（服务端读回 Run 后**冻结**的事实）；
 *   3. **身份面**：`computeResearchEvidenceFingerprint` —— 证据的**内容指纹**。
 *
 * ## 为什么「证据指纹」不进 `strategy_versions.fingerprint`
 *
 * `strategy_versions.fingerprint` = `computeDefinitionFingerprint(definition)`，它是
 * **执行语义身份**，消费者包括 OOS / Walk-Forward / 参数引用校验。把「研究来源」混进去会让
 * **同一份执行语义**因来源不同而变成两个指纹（OOS 会把它判成「新策略」），并且违反规格 §3
 * 「研究事实与交易规则严格分离」。因此本文件给出的是**证据自己的**指纹：
 *
 * ```text
 * Strategy Version 的可追溯身份 = (执行语义指纹 strategy_versions.fingerprint,
 *                                 研究证据指纹 researchEvidenceFingerprint)
 * ```
 *
 * ⚠️ 两个指纹**同名不同义**，报告与规范必须显式写清（本仓已多次踩过「同名不同义」）。
 *
 * ## 证据为什么是**列表**
 *
 * 规格 §7 / §12 要求首板回踩策略同时引用 **EXP-001 与 EXP-002**，而
 * `strategy_research_provenance` 是 `UNIQUE(strategyVersionId)`（一版本一条）⇒ 一条溯源行里
 * 必须能承载**多条**证据。故证据以列表形态冻结进 `sourceSnapshotJson`（规格 §20：
 * 「如果只是 JSON / snapshot 可以承载，则不要建新表」）。
 *
 * 依赖方向：本文件**只** import 类型与既有 canonical 序列化，不认识 DB / tRPC / MinIO。
 */

import { createHash } from "node:crypto";
import { serializeCanonical } from "../searchRobustness/canonical";

// ---------------------------------------------------------------------------
// 词表
// ---------------------------------------------------------------------------

/**
 * 证据种类（**闭集**）。
 *
 * 它回答的是「引用了这次运行的**哪一部分**」，而不是「这结论对不对」：
 *   - `RESULT_SUMMARY`：结果信封的汇总（样本账 + 统计量）；
 *   - `STABILITY_VERDICT`：稳定性判定（EXP-002 的 stable / sensitive / insufficient / failed）；
 *   - `SAMPLE_ACCOUNTING`：样本账（候选 / 可用 / 剔除及原因）。
 *
 * 🔴 本词表**刻意不含**「最优 / 推荐 / 最佳」这类评价性取值 —— 规格 §17 禁止自动择优。
 */
export const RESEARCH_EVIDENCE_KINDS = [
  "RESULT_SUMMARY",
  "STABILITY_VERDICT",
  "SAMPLE_ACCOUNTING",
] as const;
export type ResearchEvidenceKind = (typeof RESEARCH_EVIDENCE_KINDS)[number];

/** Run ID 形态（唯一权威在 `researchExperiments/persistence/runId.ts`；此处只做**形态**校验）。 */
export const RESEARCH_EVIDENCE_RUN_ID_RE = /^RUN-\d{8}-[0-9A-F]{8}$/u;

/**
 * `reference` 的语法：**点分定位路径**（如 `statistics.meanCloseReturn` / `customPayload.overallVerdict`）。
 *
 * 为什么要求点分路径而不是自由文本：§12 要求「引用必须指向真实存在的东西」，
 * 自由文本无法被任何东西核对；点分路径至少是**可定位的坐标**（能在结果信封里找）。
 */
export const RESEARCH_EVIDENCE_REFERENCE_RE =
  /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/u;

/**
 * 证据指纹前缀。**与执行语义指纹前缀刻意不同**（后者是裸 64 位 hex）——
 * 让「两个指纹不是一回事」在肉眼与 grep 层面都不可混。
 */
export const RESEARCH_EVIDENCE_FINGERPRINT_PREFIX = "evi-sha256";

// ---------------------------------------------------------------------------
// 错误码
// ---------------------------------------------------------------------------

export const RESEARCH_EVIDENCE_ERROR = {
  /** 证据列表为空（至少要引用一条真实 Run —— 空列表回答不了 §6 的任何一问）。 */
  EMPTY: "RESEARCH_EVIDENCE_EMPTY",
  /** `runId` 形态非法（不是 `RUN-YYYYMMDD-XXXXXXXX`）。 */
  RUN_ID_INVALID: "RESEARCH_EVIDENCE_RUN_ID_INVALID",
  /** `evidenceKind` 不在闭集内。 */
  KIND_INVALID: "RESEARCH_EVIDENCE_KIND_INVALID",
  /** `reference` 不是点分定位路径。 */
  REFERENCE_INVALID: "RESEARCH_EVIDENCE_REFERENCE_INVALID",
  /**
   * `reference` 语法合法，但**在这次运行的结果信封里找不到那个坐标**。
   *
   * 🔴 这正是规格 §12「不得虚构 artifact」的落点：只有语法校验时，「引用某个不存在的字段」
   *    与「引用真实字段」在数据上完全同形 —— 加一层**解析**才能把它变成一个结构性事实。
   */
  REFERENCE_UNRESOLVED: "RESEARCH_EVIDENCE_REFERENCE_UNRESOLVED",
  /** 同一条证据（runId + kind + reference）在列表里出现两次。 */
  DUPLICATE: "RESEARCH_EVIDENCE_DUPLICATE",
  /** 声明了 `researchEvidences` 但指纹缺失 / 不一致（声明与事实不符）。 */
  FINGERPRINT_MISMATCH: "RESEARCH_EVIDENCE_FINGERPRINT_MISMATCH",
  /** 多份证据指向**不同** Dataset 版本（策略只能绑定一个执行 Dataset）。 */
  DATASET_MISMATCH: "RESEARCH_EVIDENCE_DATASET_MISMATCH",
} as const;

export type ResearchEvidenceErrorCode =
  (typeof RESEARCH_EVIDENCE_ERROR)[keyof typeof RESEARCH_EVIDENCE_ERROR];

export class ResearchEvidenceError extends Error {
  readonly code: ResearchEvidenceErrorCode;

  constructor(code: ResearchEvidenceErrorCode, message: string) {
    super(message);
    this.name = "ResearchEvidenceError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 声明面
// ---------------------------------------------------------------------------

/**
 * 调用方声明的**一条**证据引用（规格 §4 的最小结构；字段名按本仓既有命名规范）。
 *
 * ⚠️ 这里**没有** `experimentCode` / `experimentVersion` / `datasetVersionId`：
 * 那三项是 `runId` 的**函数**（Run 行里就有），由服务端从**真实 Run** 读回，
 * **不接受调用方自报** —— 否则「引用指向真实 Run」就退化成一句声明。
 */
export interface ResearchEvidenceRef {
  /** `research_experiment_run.runId`（`RUN-YYYYMMDD-XXXXXXXX`）。 */
  readonly runId: string;
  readonly evidenceKind: ResearchEvidenceKind;
  /** 引用了这次运行的哪一部分（点分定位路径）。 */
  readonly reference: string;
  /** 人读备注（可空）。 */
  readonly description?: string;
}

const MAX_REFERENCE_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 512;

function keyOf(ref: ResearchEvidenceRef): string {
  return `${ref.runId}|${ref.evidenceKind}|${ref.reference}`;
}

/**
 * 校验证据引用列表。失败一律 `ResearchEvidenceError`（**响亮失败**，不静默丢弃任何一条）。
 *
 * 校验面（规格 §18.1 要求逐项可测）：
 *   - 空列表 ⇒ `EMPTY`；
 *   - `runId` 非 `RUN-YYYYMMDD-XXXXXXXX` ⇒ `RUN_ID_INVALID`；
 *   - `evidenceKind` 不在闭集 ⇒ `KIND_INVALID`；
 *   - `reference` 不是点分路径 / 超长 ⇒ `REFERENCE_INVALID`；
 *   - 同一 (runId, kind, reference) 重复 ⇒ `DUPLICATE`。
 */
export function assertResearchEvidenceRefs(
  refs: readonly ResearchEvidenceRef[],
): void {
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new ResearchEvidenceError(
      RESEARCH_EVIDENCE_ERROR.EMPTY,
      "至少必须引用一条真实 Run（空证据列表无法回答「这个策略基于哪些研究运行产生」）",
    );
  }
  const seen = new Set<string>();
  for (const [index, ref] of refs.entries()) {
    const at = `evidences[${index}]`;
    if (typeof ref.runId !== "string" || !RESEARCH_EVIDENCE_RUN_ID_RE.test(ref.runId)) {
      throw new ResearchEvidenceError(
        RESEARCH_EVIDENCE_ERROR.RUN_ID_INVALID,
        `${at}.runId 必须是 RUN-YYYYMMDD-XXXXXXXX 形态的真实 Run id（拒绝手写不存在的 id），`
          + `实际：${JSON.stringify(ref.runId)}`,
      );
    }
    if (!(RESEARCH_EVIDENCE_KINDS as readonly string[]).includes(ref.evidenceKind)) {
      throw new ResearchEvidenceError(
        RESEARCH_EVIDENCE_ERROR.KIND_INVALID,
        `${at}.evidenceKind 只能是 ${RESEARCH_EVIDENCE_KINDS.join(" / ")}，`
          + `实际：${JSON.stringify(ref.evidenceKind)}`,
      );
    }
    if (
      typeof ref.reference !== "string"
      || ref.reference.length === 0
      || ref.reference.length > MAX_REFERENCE_LENGTH
      || !RESEARCH_EVIDENCE_REFERENCE_RE.test(ref.reference)
    ) {
      throw new ResearchEvidenceError(
        RESEARCH_EVIDENCE_ERROR.REFERENCE_INVALID,
        `${at}.reference 必须是点分定位路径（如 statistics.meanCloseReturn / customPayload.overallVerdict），`
          + `实际：${JSON.stringify(ref.reference)}`,
      );
    }
    if (ref.description !== undefined) {
      if (typeof ref.description !== "string" || ref.description.length > MAX_DESCRIPTION_LENGTH) {
        throw new ResearchEvidenceError(
          RESEARCH_EVIDENCE_ERROR.REFERENCE_INVALID,
          `${at}.description 必须是不超过 ${MAX_DESCRIPTION_LENGTH} 字符的字符串`,
        );
      }
    }
    const key = keyOf(ref);
    if (seen.has(key)) {
      throw new ResearchEvidenceError(
        RESEARCH_EVIDENCE_ERROR.DUPLICATE,
        `${at} 与前面的证据重复（runId + evidenceKind + reference 相同）：${key}`,
      );
    }
    seen.add(key);
  }
}

/**
 * 在结果信封里**解析**一条 `reference`（点分定位路径）→ 叶子值。
 *
 * 语义：逐段取**自有属性**（`Object.prototype` 上的东西不算命中，避免 `constructor`
 * 这类路径把原型链当成数据）；任一段不存在 ⇒ `REFERENCE_UNRESOLVED`。
 *
 * 为什么必须有这一层：`assertResearchEvidenceRefs` 只能证明「这是一个像坐标的字符串」。
 * 规格 §12 要求「引用必须指向真实存在的东西」——只有真的走一遍结果信封，
 * 「引用了第 3 张表的第 7 行」才会在**引用错了**的时候**失败**，而不是静静地留下一条
 * 谁也核不出来的字符串。这与本仓「结构性事实 > 一句声明」的纪律一致。
 *
 * 返回值可以是 `null`（字段存在但值为 null ⇒ **已解析**）；只有**找不到**才算失败。
 */
export function resolveEvidenceReference(result: unknown, reference: string): unknown {
  const segments = reference.split(".");
  let cursor: unknown = result;
  for (const [index, segment] of segments.entries()) {
    if (cursor === null || typeof cursor !== "object") {
      throw new ResearchEvidenceError(
        RESEARCH_EVIDENCE_ERROR.REFERENCE_UNRESOLVED,
        `reference "${reference}" 在 "${segments.slice(0, index).join(".") || "<root>"}" 处`
          + `已不是对象（实际：${cursor === null ? "null" : typeof cursor}）—— 该坐标不存在`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
      const keys = Object.keys(cursor as Record<string, unknown>);
      const preview = keys.slice(0, 12).join(", ");
      throw new ResearchEvidenceError(
        RESEARCH_EVIDENCE_ERROR.REFERENCE_UNRESOLVED,
        `reference "${reference}" 的坐标段 "${segment}" 不存在`
          + `（在 "${segments.slice(0, index).join(".") || "<root>"}" 的可用键：${preview}`
          + `${keys.length > 12 ? ", …" : ""}）`,
      );
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// 事实面（服务端从真实 Run 读回后**冻结**）
// ---------------------------------------------------------------------------

/**
 * 一条**已核实**的证据（Run 行事实 + 结果摘要指纹）。
 *
 * 全部字段都是**快照值**（零 FK）—— 与 `strategy_research_provenance` 既有纪律一致：
 * Run 行事后被清理，溯源仍能回答「当初引用的是哪一次运行、它的结果摘要是什么」。
 */
export interface ResearchEvidenceRecord {
  /** = `research_experiment_run.experimentId`（`<group>/<key>`）。 */
  readonly experimentCode: string;
  /** = `research_experiment_run.experimentVersion`。 */
  readonly experimentVersion: string;
  readonly runId: string;
  /** = `research_experiment_run.datasetVersionId`。 */
  readonly datasetVersionId: number;
  readonly datasetVersionLabel: string | null;
  readonly evidenceKind: ResearchEvidenceKind;
  readonly reference: string;
  readonly description?: string;
  /** 这次运行结果信封的 canonical 指纹（服务端从**落盘结果**读回后算出）。 */
  readonly resultDigest: string;
  /** 运行结束状态（`COMPLETED` 才被接受；此处如实记录）。 */
  readonly runStatus: string;
  readonly startedAt: string | null;
  readonly durationMs: number | null;
}

/**
 * 证据指纹 = **对证据列表**做 canonical 序列化后取 sha256 前 16 位。
 *
 * 三条性质（规格 §6 的判据，逐条可测）：
 *   ① **确定性**：同一批证据（**与顺序无关** —— 先按稳定键排序）⇒ 同一指纹；
 *   ② **敏感性**：任何一条证据的任一字段变化 ⇒ 指纹变化；
 *   ③ **可复核**：指纹只由证据本身决定，不含时间戳 / 行 id。
 *
 * 🔴 复用 `searchRobustness/canonical` 的 `serializeCanonical` —— **不新造第二套 canonicalizer**
 * （指纹要跨进程 / 跨时间稳定，第二套序列化实现迟早漂移）。
 */
export function computeResearchEvidenceFingerprint(
  records: readonly ResearchEvidenceRecord[],
): string {
  const canonical = [...records]
    .map((record) => ({
      experimentCode: record.experimentCode,
      experimentVersion: record.experimentVersion,
      runId: record.runId,
      datasetVersionId: record.datasetVersionId,
      datasetVersionLabel: record.datasetVersionLabel,
      evidenceKind: record.evidenceKind,
      reference: record.reference,
      resultDigest: record.resultDigest,
    }))
    .sort((a, b) =>
      a.experimentCode === b.experimentCode
        ? a.runId === b.runId
          ? a.reference.localeCompare(b.reference)
          : a.runId.localeCompare(b.runId)
        : a.experimentCode.localeCompare(b.experimentCode),
    );
  return hashPayload(canonical);
}

/** 指纹底层实现（唯一出口；调用方一律走 `computeResearchEvidenceFingerprint`）。 */
function hashPayload(payload: unknown): string {
  const digest = createHash("sha256").update(serializeCanonical(payload)).digest("hex");
  return `${RESEARCH_EVIDENCE_FINGERPRINT_PREFIX}:${digest.slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// 快照编解码（证据列表进 `sourceSnapshotJson` 的唯一读写口）
// ---------------------------------------------------------------------------

/** `sourceSnapshotJson` 里承载证据的键（唯一权威；读取方一律用 `readResearchEvidenceRecords`）。 */
export const RESEARCH_EVIDENCE_SNAPSHOT_KEY = "researchEvidences";
/** 证据指纹在快照里的键。 */
export const RESEARCH_EVIDENCE_FINGERPRINT_KEY = "researchEvidenceFingerprint";

/** 构造要写进 `sourceSnapshotJson` 的证据段（**唯一**构造点）。 */
export function buildResearchEvidenceSnapshot(
  records: readonly ResearchEvidenceRecord[],
): Record<string, unknown> {
  return {
    [RESEARCH_EVIDENCE_SNAPSHOT_KEY]: records.map((record) => ({ ...record })),
    [RESEARCH_EVIDENCE_FINGERPRINT_KEY]: computeResearchEvidenceFingerprint(records),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 从 `sourceSnapshotJson` 读回证据列表。
 *
 * 🔴 **宽容读取**是本仓既有纪律（JSON 列返回类型不稳定：可能是对象、可能是字符串）：
 * 形状不符 / 缺键 ⇒ 返回 `[]`（= 这份溯源不是「带证据列表」的形态，例如旧链路或
 * 未声明证据的独立实验来源）。**不抛错** —— 读路径不因溯源形态旧而失败。
 */
export function readResearchEvidenceRecords(
  sourceSnapshotJson: unknown,
): readonly ResearchEvidenceRecord[] {
  const value = typeof sourceSnapshotJson === "string"
    ? safeParse(sourceSnapshotJson)
    : sourceSnapshotJson;
  if (!isRecord(value)) return [];
  const raw = value[RESEARCH_EVIDENCE_SNAPSHOT_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ResearchEvidenceRecord => {
    if (!isRecord(item)) return false;
    return (
      typeof item.runId === "string"
      && typeof item.experimentCode === "string"
      && typeof item.experimentVersion === "string"
      && typeof item.datasetVersionId === "number"
      && typeof item.evidenceKind === "string"
      && typeof item.reference === "string"
      && typeof item.resultDigest === "string"
    );
  });
}

/** 从 `sourceSnapshotJson` 读回证据指纹；缺失或非字符串 ⇒ `null`（不伪造）。 */
export function readResearchEvidenceFingerprint(sourceSnapshotJson: unknown): string | null {
  const value = typeof sourceSnapshotJson === "string"
    ? safeParse(sourceSnapshotJson)
    : sourceSnapshotJson;
  if (!isRecord(value)) return null;
  const raw = value[RESEARCH_EVIDENCE_FINGERPRINT_KEY];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 校验**已声明**的证据段（供 `assertProvenanceInput` 使用）。
 *
 * ⚠️ 语义是「**声明了就受校验**」而不是「必须声明」：
 * 历史行 / 非证据型溯源不带这些键，行为逐字不变（零回归）；
 * 一旦带上 `researchEvidences`，就必须**自洽**：
 *   - 列表非空、每条形态合法（复用 `assertResearchEvidenceRefs` 的同一批规则）；
 *   - 指纹存在且与列表算出来的**逐字节相等**（否则就是「声明与事实不符」）。
 */
export function assertDeclaredResearchEvidence(snapshot: unknown): void {
  const value = typeof snapshot === "string" ? safeParse(snapshot) : snapshot;
  if (!isRecord(value)) return;
  if (value[RESEARCH_EVIDENCE_SNAPSHOT_KEY] === undefined) return;

  const records = readResearchEvidenceRecords(value);
  if (records.length === 0) {
    throw new ResearchEvidenceError(
      RESEARCH_EVIDENCE_ERROR.EMPTY,
      `${RESEARCH_EVIDENCE_SNAPSHOT_KEY} 已声明但没有一条形态合法的证据`,
    );
  }
  assertResearchEvidenceRefs(
    records.map((record) => ({
      runId: record.runId,
      evidenceKind: record.evidenceKind,
      reference: record.reference,
    })),
  );
  const declared = readResearchEvidenceFingerprint(value);
  const computed = computeResearchEvidenceFingerprint(records);
  if (declared === null) {
    throw new ResearchEvidenceError(
      RESEARCH_EVIDENCE_ERROR.FINGERPRINT_MISMATCH,
      `声明了 ${RESEARCH_EVIDENCE_SNAPSHOT_KEY} 就必须同时给 ${RESEARCH_EVIDENCE_FINGERPRINT_KEY}`,
    );
  }
  if (declared !== computed) {
    throw new ResearchEvidenceError(
      RESEARCH_EVIDENCE_ERROR.FINGERPRINT_MISMATCH,
      `${RESEARCH_EVIDENCE_FINGERPRINT_KEY} 与证据列表算出来的指纹不一致：`
        + `声明 ${declared}，实算 ${computed}`,
    );
  }
}

/**
 * 多份证据必须落在**同一个** Dataset 版本上（否则无法确定策略的执行 Dataset 绑定）。
 * 返回该唯一坐标；列表为空 ⇒ 抛出（由调用方先跑 `assertResearchEvidenceRefs`）。
 */
export function resolveSingleDatasetVersionId(
  records: readonly ResearchEvidenceRecord[],
): number {
  const ids = [...new Set(records.map((record) => record.datasetVersionId))];
  if (ids.length !== 1) {
    throw new ResearchEvidenceError(
      RESEARCH_EVIDENCE_ERROR.DATASET_MISMATCH,
      `多份证据必须来自同一个 Dataset 版本（策略只能绑定一个执行 Dataset），实际：${ids.join(" / ")}`,
    );
  }
  const only = ids[0];
  if (only === undefined) {
    throw new ResearchEvidenceError(
      RESEARCH_EVIDENCE_ERROR.EMPTY,
      "证据列表为空，无法解析 Dataset 版本坐标",
    );
  }
  return only;
}
