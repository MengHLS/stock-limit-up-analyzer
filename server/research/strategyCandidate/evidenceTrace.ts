/**
 * RESEARCH-006.2 — 研究证据**快照**的抽取与构造（**纯函数、确定性**）。
 *
 * 定位（006.0 §9 / §7.1）：
 *   - `candidate.sourceTraceJson` 是 **provenance snapshot**，**不是** `research_result` 的第二份存储；
 *   - 目的只有一个：未来回答「这条候选当初凭什么」——所以只留**最小充分**的一份 trace；
 *   - 被引用的 `research_result` **会被重算覆盖**（006.0 §4.2 A：`deleteByAnalysis` + 重建），
 *     因此快照是唯一能长期回答该问题的手段。
 *
 * 纪律：
 *   - **只读结论自身的 `evidenceJson`**，不额外拉取 `research_result` / `research_analysis` /
 *     `research_run` 的内容并整体序列化（那是第二份存储，不是快照）；
 *   - 抽取逻辑对**未知/缺失结构**保持沉默（返回 null / 空数组），**绝不猜测、绝不补默认值**；
 *   - 不写入任何时间戳（确定性；行级 `createdAt` 已承担时间语义）。
 *
 * ⚠️ 键名以**真实库结构**为准（2026-09-12 实查 7 行 `research_conclusion.evidenceJson`）：
 *     `{ disclaimer, policy, hypothesisId, hypothesisStatement, primaryAnalysis,
 *        primarySelectionRule, contributingAnalyses, ruleTrace, confidenceBasis,
 *        confidenceIsNotPValue }`，其中 `primaryAnalysis` 可为 `null`，
 *     并保留对 legacy 键 `analyses[].analysisId` 的兼容读取（006.0 §2.2）。
 */

/** `primaryAnalysis` 的结构化抽取结果（缺失即 `null`，不伪造）。 */
export interface ConclusionPrimaryAnalysis {
  analysisId: number | null;
  analysisType: string | null;
  effectLabel: string | null;
  effect: number | null;
  pValue: number | null;
  tStat: number | null;
  sampleCount: number | null;
  minGroupSampleCount: number | null;
  groupCount: number | null;
  directionConsistency: number | null;
}

/** `contributingAnalyses[]` 的结构化抽取结果（裁剪字段，避免快照变成第二份结果存储）。 */
export interface ConclusionContributingAnalysis {
  analysisId: number | null;
  analysisType: string | null;
  effectLabel: string | null;
  effect: number | null;
  pValue: number | null;
  sampleCount: number | null;
}

/** 结论证据的规范化视图（**只描述「看到了什么」**，不做任何解读）。 */
export interface ParsedConclusionEvidence {
  /** `evidenceJson` 是否为对象（null / 字符串 / 数组一律视为「没证据」）。 */
  hasEvidence: boolean;
  /** 真实顶层键（如实记录快照所依据的形状；将来 schema 变化可被察觉）。 */
  topLevelKeys: string[];
  hypothesisStatement: string | null;
  disclaimer: string | null;
  confidenceIsNotPValue: boolean | null;
  primaryAnalysis: ConclusionPrimaryAnalysis | null;
  contributingAnalyses: ConclusionContributingAnalysis[];
  /** legacy 键 `analyses[].analysisId`（006.0 §2.2 记录过该旧形状）。 */
  legacyAnalysisIds: number[];
  ruleTraceCount: number | null;
  policy: unknown;
}

/** 快照中 `contributingAnalyses` 的条数上限（超出即如实标注被截断）。 */
export const SOURCE_TRACE_MAX_CONTRIBUTING = 20;
/** 快照中文本字段（`hypothesisStatement` / `disclaimer`）的长度上限。 */
export const SOURCE_TRACE_MAX_TEXT = 400;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 正整数 id 或 null（`0` / 负数 / 小数 / 字符串一律视为不可用）。 */
function asId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** 截断长文本，并**如实标注**被截断（不静默发生）。 */
export function truncateText(value: string | null, limit = SOURCE_TRACE_MAX_TEXT): string | null {
  if (value === null) return null;
  return value.length <= limit ? value : `${value.slice(0, limit)}…（已截断，原长 ${value.length}）`;
}

function readPrimary(raw: unknown): ConclusionPrimaryAnalysis | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  return {
    analysisId: asId(rec.analysisId),
    analysisType: asString(rec.analysisType),
    effectLabel: asString(rec.effectLabel),
    effect: asNumber(rec.effect),
    pValue: asNumber(rec.pValue),
    tStat: asNumber(rec.tStat),
    sampleCount: asNumber(rec.sampleCount),
    minGroupSampleCount: asNumber(rec.minGroupSampleCount),
    groupCount: asNumber(rec.groupCount),
    directionConsistency: asNumber(rec.directionConsistency),
  };
}

function readContributing(raw: unknown): ConclusionContributingAnalysis[] {
  return asArray(raw)
    .map((item) => {
      const rec = asRecord(item);
      if (!rec) return null;
      return {
        analysisId: asId(rec.analysisId),
        analysisType: asString(rec.analysisType),
        effectLabel: asString(rec.effectLabel),
        effect: asNumber(rec.effect),
        pValue: asNumber(rec.pValue),
        sampleCount: asNumber(rec.sampleCount),
      };
    })
    .filter((x): x is ConclusionContributingAnalysis => x !== null);
}

/** 解析 `research_conclusion.evidenceJson`（领域形态为 `unknown`）。 */
export function parseConclusionEvidence(evidence: unknown): ParsedConclusionEvidence {
  const rec = asRecord(evidence);
  if (!rec) {
    return {
      hasEvidence: false,
      topLevelKeys: [],
      hypothesisStatement: null,
      disclaimer: null,
      confidenceIsNotPValue: null,
      primaryAnalysis: null,
      contributingAnalyses: [],
      legacyAnalysisIds: [],
      ruleTraceCount: null,
      policy: null,
    };
  }
  const ruleTrace = asArray(rec.ruleTrace);
  const legacyIds = asArray(rec.analyses)
    .map((item) => asId(asRecord(item)?.analysisId))
    .filter((x): x is number => x !== null);
  return {
    hasEvidence: true,
    topLevelKeys: Object.keys(rec).sort(),
    hypothesisStatement: asString(rec.hypothesisStatement),
    disclaimer: asString(rec.disclaimer),
    confidenceIsNotPValue: asBoolean(rec.confidenceIsNotPValue),
    primaryAnalysis: readPrimary(rec.primaryAnalysis),
    contributingAnalyses: readContributing(rec.contributingAnalyses),
    legacyAnalysisIds: legacyIds,
    ruleTraceCount: Array.isArray(rec.ruleTrace) ? ruleTrace.length : null,
    policy: rec.policy ?? null,
  };
}

/**
 * 需要反查 Run 的 analysisId 序列（**主分析优先**，去重、保序）。
 *
 * 顺序即优先级：`primaryAnalysis.analysisId` → `contributingAnalyses[].analysisId` → legacy `analyses[].analysisId`。
 * 之所以要用「主优先 + 全量兜底」，是因为 `research_conclusion` **没有 `runId` 列**，
 * 只能靠 evidence 里的 analysisId 两跳解析（006.0 §4.2 E / §8.1）。
 */
export function evidenceAnalysisIdCandidates(parsed: ParsedConclusionEvidence): number[] {
  const ordered: number[] = [];
  const push = (id: number | null): void => {
    if (id !== null && !ordered.includes(id)) ordered.push(id);
  };
  push(parsed.primaryAnalysis?.analysisId ?? null);
  for (const item of parsed.contributingAnalyses) push(item.analysisId);
  for (const id of parsed.legacyAnalysisIds) push(id);
  return ordered;
}

/** Run 溯源解析结果（**如实记录解析过程**，包括失败原因）。 */
export interface RunResolution {
  /** 最终写入的 `sourceResearchRunId`；无法唯一确定即 `null`。 */
  sourceResearchRunId: number | null;
  /** 解析路径（`PRIMARY_ANALYSIS` / `CONTRIBUTING_ANALYSES` / `NONE`）。 */
  path: "PRIMARY_ANALYSIS" | "CONTRIBUTING_ANALYSES" | "NONE";
  /** 参与解析的 analysisId（主优先）。 */
  analysisIds: number[];
  /** 反查到的**去重** runId 集合；长度 != 1 时无法唯一确定。 */
  distinctRunIds: number[];
  /** 在库中查不到的 analysisId（缺失即缺失，不猜）。 */
  missingAnalysisIds: number[];
}

/** 构造写入 `sourceTraceJson` 的快照（`snapshotKind` + 格式版本便于将来兼容读取）。 */
export function buildSourceTrace(input: {
  conclusionId: number;
  experimentId: number;
  hypothesisId?: number | null;
  conclusionType: string;
  conclusionStatus: string;
  confidence?: number | null;
  evidence: ParsedConclusionEvidence;
  runResolution: RunResolution;
}): Record<string, unknown> {
  const { evidence } = input;
  const contributing = evidence.contributingAnalyses.slice(0, SOURCE_TRACE_MAX_CONTRIBUTING);
  return {
    snapshotKind: "research_conclusion_evidence",
    snapshotFormatVersion: 1,
    conclusionId: input.conclusionId,
    experimentId: input.experimentId,
    hypothesisId: input.hypothesisId ?? null,
    conclusionType: input.conclusionType,
    conclusionStatus: input.conclusionStatus,
    confidence: input.confidence ?? null,
    confidenceIsNotPValue: evidence.confidenceIsNotPValue,
    hypothesisStatement: truncateText(evidence.hypothesisStatement),
    primaryAnalysis: evidence.primaryAnalysis,
    contributingAnalyses: contributing,
    contributingAnalysesTruncated:
      evidence.contributingAnalyses.length > SOURCE_TRACE_MAX_CONTRIBUTING,
    contributingAnalysesCount: evidence.contributingAnalyses.length,
    runResolution: {
      sourceResearchRunId: input.runResolution.sourceResearchRunId,
      path: input.runResolution.path,
      analysisIds: input.runResolution.analysisIds,
      distinctRunIds: input.runResolution.distinctRunIds,
      missingAnalysisIds: input.runResolution.missingAnalysisIds,
    },
    evidenceShape: {
      hasEvidence: evidence.hasEvidence,
      topLevelKeys: evidence.topLevelKeys,
      ruleTraceCount: evidence.ruleTraceCount,
      legacyAnalysesKeyUsed: evidence.legacyAnalysisIds.length > 0,
    },
    policy: evidence.policy,
    disclaimer: truncateText(evidence.disclaimer),
    generatedFrom: "research_conclusion.evidenceJson",
  };
}

/**
 * 收集快照中出现的全部 analysisId（供真实性断言 / UI 反查）。
 * ⚠️ 它是**读取辅助**，不参与任何规则、校验或指纹计算。
 */
export function collectTraceAnalysisIds(trace: unknown): number[] {
  const rec = asRecord(trace);
  if (!rec) return [];
  const ids: number[] = [];
  const push = (value: unknown): void => {
    const id = asId(value);
    if (id !== null && !ids.includes(id)) ids.push(id);
  };
  push(asRecord(rec.primaryAnalysis)?.analysisId);
  for (const item of asArray(rec.contributingAnalyses)) push(asRecord(item)?.analysisId);
  for (const id of asArray(asRecord(rec.runResolution)?.analysisIds)) push(id);
  return ids;
}
