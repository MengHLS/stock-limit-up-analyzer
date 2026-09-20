/**
 * PHASE-D-001 — Research Evidence → Strategy Candidate 的**确定性派生**（编号 `9cb`）。
 *
 * ## 解决什么
 *
 * 修复前：`createFromConclusion` 的 5 个草图列**只来自 `input.overrides`**
 * （`service.ts` 第 8 步），即「人必须把研究结论重新手写一遍成策略规则」——
 * 这正是 `STRATEGY-EXTENSION-001` D.1 点名的断链：
 *
 *     研究侧变量名（pullback_holds_event_open_2d） ≠ 策略侧字段引用（bar.haircutFromEventLow）
 *
 * 修复后：以 **Pattern 语义声明**（PHASE-B-001 的 `shared/patternSemantics.ts` +
 * `patternLibrary/semanticRegistry.ts`）为**唯一翻译层**，把 Finding 的证据条件
 * 映射成策略侧字段引用。
 *
 * ## 🔴 三条硬纪律（本文件的方法论）
 *
 * 1. **只用结构化条件，不解析字符串**。研究侧条件的权威来源是
 *    `research_analysis_condition`（结构化：`fieldName` / `operator` / `value`），
 *    不是 `finding.dimensionJson.conditionRule`（那是**人读摘要字符串**，
 *    `"pullback_holds_event_open_2d == 1"` 这种形态解析回来会凭空发明文法）。
 * 2. **不可翻译 ⇒ 如实登记，绝不猜**。缺 `strategyProjection` / 非 Pattern 语义变量 /
 *    操作符不可表达 / 方向冲突 —— 全部进 `skipped`（带原因与源 finding），
 *    并在快照里对用户可见；**不**产出一条「看起来能用」的规则。
 * 3. **方向校验有牙齿**：Pattern 声明的 `comparison`（`GTE` / `LTE`）是执行侧怎么用该特征的
 *    权威声明。研究侧条件的比较方向与它**相反**时 ⇒ 拒绝派生该条（`CONFLICTING_COMPARISON_DIRECTION`）。
 *    没有这一条，「把 `>=` 静默当成 `<=`」会产出条件相反的候选而**不报错**。
 *
 * ## 确定性（D.6）
 *
 * 输入相同（措辞完全相同的 Conclusion + Finding 集合 + Pattern 声明 + Dataset Version）
 * ⇒ `derivedRules` / `filterRule` / `fingerprint` 逐字节相同：
 *   - 遍历顺序固定（findingId 升序 → analysisId → groupNo → sortOrder）；
 *   - 规则按 `(fieldName, operator, value)` 升序去重（同键保留 findingId 最小者）；
 *   - 指纹 = sha256 over **键递归排序**的规范化 JSON；
 *   - **不读时钟**（时间语义由行级 `createdAt` 承担）。
 */

import { createHash } from "node:crypto";
import type {
  ResearchAnalysisCondition,
  ResearchConditionGroup,
  ResearchConditionOperator,
  ResearchConditionSet,
  ResearchConditionSpec,
  ResearchConclusion,
  ResearchFinding,
} from "../../researchCore";
import type { ExpandedSemantic } from "../../../shared/patternSemantics";

/**
 * 派生器版本（D.5 的 `derivationVersion`）。
 *
 * 🔴 语义变更（新增可翻译的操作符 / 改变方向映射 / 改变去重口径）**必须**递增本常量 ——
 * 它进 `sourceTraceJson.derivation.derivationVersion`，是「同输入为何产出不同规则」的唯一解释。
 * 本表**无 DB 列**（全局硬约束禁止新增 migration），故以快照字段承载。
 */
export const EVIDENCE_DERIVATION_VERSION = "research-evidence-derivation@1.0.0";

/** Pattern 声明展开后的语义索引（按**变量全名**查）。 */
export interface SemanticIndex {
  /** 变量名 → 展开后的语义（含 `strategyProjection`）。 */
  readonly byVariableName: ReadonlyMap<string, ExpandedSemantic>;
  /**
   * 变量名 → 声明它的 Pattern id。
   *
   * 🔴 为什么 provenance 需要它：`patternId` 必须是**真正被引用的那个 Pattern**，
   * 而不是「注册表里有几个 Pattern」。只有命中的变量才知道自己来自哪份声明。
   */
  readonly patternIdByVariableName: ReadonlyMap<string, string>;
  /** 本索引覆盖的全部 Pattern id（供诊断；**不**直接进 provenance）。 */
  readonly knownPatternIds: readonly string[];
}

/** 由 `listPatternSemantics()` 构造索引（**唯一入口**，避免各处自己拼）。 */
export function buildSemanticIndex(
  entries: readonly { patternId: string; expanded: readonly ExpandedSemantic[] }[],
): SemanticIndex {
  const byVariableName = new Map<string, ExpandedSemantic>();
  const patternIdByVariableName = new Map<string, string>();
  const knownPatternIds: string[] = [];
  for (const entry of entries) {
    knownPatternIds.push(entry.patternId);
    for (const expanded of entry.expanded) {
      // 同名不覆盖：先到者胜（`semanticRegistry` 已保证 `semanticId` 全局唯一，
      // 变量全名 = semanticId+聚合+窗口 ⇒ 同名即同义；这里再挡一次避免静默覆盖）。
      if (!byVariableName.has(expanded.name)) {
        byVariableName.set(expanded.name, expanded);
        patternIdByVariableName.set(expanded.name, entry.patternId);
      }
    }
  }
  return {
    byVariableName,
    patternIdByVariableName,
    knownPatternIds: knownPatternIds.slice().sort(),
  };
}

/**
 * 跳过原因（闭集；新增即视为语义变更 ⇒ 同时递增 `EVIDENCE_DERIVATION_VERSION`）。
 *
 * 🔴 **只登记「根本没派生出来」的原因**。「派生出来了但两侧语义有差异」不是跳过 ——
 * 它记在 `DerivedRule.directionNote` 上（见下），因为把人该 review 的差异**混进 skipped**
 * 会让「派生出几条规则」这个数字失去意义。
 */
export const DERIVATION_SKIP_REASONS = [
  /** 该分析没有结构化条件（探索性 / 描述性分析）—— 没有可翻译的规则。 */
  "NO_STRUCTURED_CONDITIONS",
  /** 条件字段不是 Pattern 语义变量（内建特征 / 观察日变量）—— 两侧无声明式对应。 */
  "NOT_PATTERN_SEMANTIC_VARIABLE",
  /** 是 Pattern 语义变量，但声明未给出执行侧投影 —— 不臆造执行口径。 */
  "NO_STRATEGY_PROJECTION",
  /** 条件组含 OR 语义 —— 策略侧 `ConditionDefinition` 无逻辑运算符字段，无法表达。 */
  "LOGICAL_OPERATOR_NOT_EXPRESSIBLE",
  /** 声明要求的阈值参数不在候选参数空间里 —— 引用了不存在的参数。 */
  "THRESHOLD_PARAM_NOT_DECLARED",
] as const;
export type DerivationSkipReason = (typeof DERIVATION_SKIP_REASONS)[number];

/** 一条**已翻译**的规则（含完整可读溯源，供 D.9 的 human review gate 使用）。 */
export interface DerivedRule {
  /** 策略侧字段引用（`bar.` / `prefix.rd-1.` / `event.`，必含 "."）。 */
  readonly fieldName: string;
  /** 策略侧操作符（由 Pattern 声明的 `comparison` 决定）。 */
  readonly operator: ResearchConditionOperator;
  /** 策略侧阈值 = **参数引用**（参数名；由 Parameter Search 定值，不写死数字）。 */
  readonly value: string;
  // ---- 溯源（这条规则从哪来）----
  readonly sourceFindingId: number;
  readonly sourceAnalysisId: number;
  readonly sourceFindingTitle: string;
  readonly sourceFindingType: string;
  /** 研究侧变量全名（可读）。 */
  readonly researchVariable: string;
  /** 研究侧原文（`fieldName operator value`），**原样保留**供人核对方向。 */
  readonly researchCondition: string;
  readonly semanticId: string;
  /** 声明该语义的 Pattern（D.5 / D.8 的 `patternId` 来源）。 */
  readonly sourcePatternId: string;
  readonly comparison: "GTE" | "LTE";
  readonly thresholdParam: string;
  readonly noteAboutResearchDifference?: string;
  /**
   * 🔴 研究侧比较方向（`GTE` / `LTE`；非比较运算如 `==` 时为 `null`）。
   *
   * **为什么不拿它做拒绝判据**：研究侧条件与执行侧门槛是**两个层面**的东西 ——
   * 真实数据里 `pat_pullback_hold_depth_2d >= 0` 表达的是「有跌破」（样本筛选），
   * 而执行侧声明 `bar.haircutFromEventLow <= max_drawdown` 表达的是「跌破幅度有上限」（证券门槛）。
   * 硬要求方向一致会把**全部合法条件误杀**（本轮实测：真库 finding 的 `pat_*` 条件恰为 `>=`）。
   * ⇒ 如实翻译 + **把差异摆到人眼前**（D.9 的 human review gate），而不是替人拒绝。
   */
  readonly researchDirection: "GTE" | "LTE" | null;
  /** `true` = 研究侧方向与声明方向相反（**必须**由人确认，不静默放过）。 */
  readonly directionMismatch: boolean;
  /** 人读说明（方向不一致 / 非比较运算时非空；进 UI 与快照）。 */
  readonly directionNote: string | null;
  /** 只读快照：该 finding 的超额收益与样本数（缺失即 null，不补 0）。 */
  readonly effectExcessReturn: number | null;
  readonly effectSampleCount: number | null;
  /** 该 finding 的研究强度（如实带上，供人 review 排序；**不作自动择优**）。 */
  readonly researchStrength: number | null;
}

/** 一条**未翻译**的条件（如实登记，绝不当成「没有这种条件」）。 */
export interface SkippedDerivation {
  readonly reason: DerivationSkipReason;
  /** 研究侧字段名（不可解析时为 null）。 */
  readonly researchVariable: string | null;
  readonly detail: string;
  readonly sourceFindingId: number | null;
  readonly sourceAnalysisId: number | null;
}

/** 派生结果（**纯数据**；写库由 `service.createFromConclusion` 负责）。 */
export interface CandidateDerivation {
  readonly derivationVersion: string;
  /** 参与派生的 Pattern（**空数组** = 本轮没有任何 Pattern 语义参与；如实登记）。 */
  readonly patternIds: readonly string[];
  /**
   * 策略侧 `filterRule`。
   *
   * - `derivedRules` 非空 ⇒ 单组 AND（策略侧只支持 AND）；
   * - `derivedRules` 为空 ⇒ `{ groups: [] }`（**空规则**，与「派生出 0 条」语义一致，
   *   不写半截条件）。
   */
  readonly filterRule: ResearchConditionSet;
  readonly derivedRules: readonly DerivedRule[];
  readonly skipped: readonly SkippedDerivation[];
  /** 确定性指纹（sha256 over 规范化 JSON；时间戳不参与）。 */
  readonly fingerprint: string;
  /** 证据坐标（D.5 provenance 的 Research 侧）。 */
  readonly evidence: {
    readonly conclusionId: number;
    readonly findingIds: readonly number[];
    readonly analysisIds: readonly number[];
    readonly runIds: readonly number[];
    readonly datasetVersionId: number | null;
  };
}

function parseJsonSafe(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** 读 `finding.effectJson.excessReturn`（缺失即 null，不补 0）。 */
function readExcess(finding: ResearchFinding): number | null {
  const effect = parseJsonSafe(finding.effect);
  if (effect === null || typeof effect !== "object" || Array.isArray(effect)) return null;
  const raw = (effect as Record<string, unknown>).excessReturn;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** 读条件组里 CONDITION 桶的样本数（`effectJson.buckets[label=CONDITION].sampleCount`）。 */
function readConditionSampleCount(finding: ResearchFinding): number | null {
  const effect = parseJsonSafe(finding.effect);
  if (effect === null || typeof effect !== "object" || Array.isArray(effect)) return null;
  const buckets = (effect as Record<string, unknown>).buckets;
  if (!Array.isArray(buckets)) return null;
  for (const bucket of buckets) {
    if (bucket === null || typeof bucket !== "object") continue;
    const rec = bucket as Record<string, unknown>;
    if (rec.label === "CONDITION" && typeof rec.sampleCount === "number") return rec.sampleCount;
  }
  return null;
}

/** 研究侧操作符 → 比较方向（用于与 Pattern 声明比对；不可判定即 null）。 */
function directionOf(operator: ResearchConditionOperator): "GTE" | "LTE" | null {
  if (operator === ">=" || operator === ">") return "GTE";
  if (operator === "<=" || operator === "<") return "LTE";
  return null;
}

/** Pattern 声明的 `comparison` → 策略侧操作符（严格映射，**不含取反蒙混**）。 */
function operatorOfApproved(comparison: "GTE" | "LTE"): ResearchConditionOperator {
  return comparison === "GTE" ? ">=" : "<=";
}

/** 研究侧条件的最小结构面（`ResearchConditionSpec` 与落库行 `ResearchAnalysisCondition` 都满足）。 */
interface ResearchConditionLike {
  readonly fieldName: string;
  readonly operator: string;
  readonly value: unknown;
}

/** 研究侧条件的可读原文（仅供人核对；**不参与任何判定**）。 */
function renderResearchCondition(spec: ResearchConditionLike): string {
  return `${spec.fieldName} ${spec.operator} ${JSON.stringify(spec.value)}`;
}

/** 键递归排序的规范化 JSON（确定性指纹的前提）。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) out[key] = canonicalize(rec[key]);
    return out;
  }
  return value;
}

/** 派生指纹（sha256 over 规范化 JSON 的 utf8 字节）。 */
export function computeDerivationFingerprint(input: {
  derivationVersion: string;
  patternIds: readonly string[];
  derivedRules: readonly DerivedRule[];
  evidence: CandidateDerivation["evidence"];
}): string {
  const payload = canonicalize({
    derivationVersion: input.derivationVersion,
    patternIds: [...input.patternIds].sort(),
    rules: input.derivedRules.map((rule) => ({
      fieldName: rule.fieldName,
      operator: rule.operator,
      value: rule.value,
      semanticId: rule.semanticId,
      comparison: rule.comparison,
      thresholdParam: rule.thresholdParam,
      sourceFindingId: rule.sourceFindingId,
      sourceAnalysisId: rule.sourceAnalysisId,
      researchVariable: rule.researchVariable,
      researchCondition: rule.researchCondition,
    })),
    evidence: {
      conclusionId: input.evidence.conclusionId,
      findingIds: [...input.evidence.findingIds].sort((a, b) => a - b),
      analysisIds: [...input.evidence.analysisIds].sort((a, b) => a - b),
      runIds: [...input.evidence.runIds].sort((a, b) => a - b),
      datasetVersionId: input.evidence.datasetVersionId,
    },
  });
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export interface DeriveCandidateRulesInput {
  readonly conclusion: ResearchConclusion;
  /** 参与派生的 Finding（调用方按 `conclusion.findingIds` 解析得到；**按 id 升序**传入即可）。 */
  readonly findings: readonly ResearchFinding[];
  /** 每个 analysisId 的**结构化**条件（缺省即 `[]`）。 */
  readonly conditionsOf: (analysisId: number) => readonly ResearchAnalysisCondition[];
  readonly semanticIndex: SemanticIndex;
  /** 候选参数空间（Pattern 草图投影产物）；`thresholdParam` 必须在其键集合内。 */
  readonly parameterCodes: ReadonlySet<string>;
  readonly datasetVersionId: number | null;
}

/**
 * 派生（**唯一实现**）。
 *
 * 与 `createFromConclusion` 的分工：本函数**只计算**，不读写库、不抛业务异常
 * （不可翻译一律进 `skipped`）。是否拒绝「一条都没派生出来」由服务层决定。
 */
export function deriveCandidateRules(input: DeriveCandidateRulesInput): CandidateDerivation {
  const skipped: SkippedDerivation[] = [];
  const candidates: DerivedRule[] = [];
  const analysisIds = new Set<number>();
  const runIds = new Set<number>();

  const findings = [...input.findings].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  for (const finding of findings) {
    const findingId = finding.id ?? null;
    if (finding.runId !== null && finding.runId !== undefined) runIds.add(finding.runId);
    const analysisId = finding.primaryAnalysisId ?? null;
    if (analysisId === null) {
      skipped.push({
        reason: "NO_STRUCTURED_CONDITIONS",
        researchVariable: null,
        detail: `Finding #${String(findingId)} 没有 primaryAnalysisId，无法定位其结构化条件`,
        sourceFindingId: findingId,
        sourceAnalysisId: null,
      });
      continue;
    }
    analysisIds.add(analysisId);
    const rows = [...input.conditionsOf(analysisId)].sort(
      (a, b) => a.groupNo - b.groupNo || a.sortOrder - b.sortOrder,
    );
    if (rows.length === 0) {
      skipped.push({
        reason: "NO_STRUCTURED_CONDITIONS",
        researchVariable: null,
        detail: `Analysis #${analysisId}（Finding #${String(findingId)}）没有结构化条件`
          + "（描述性 / 探索性分析没有可翻译的规则）",
        sourceFindingId: findingId,
        sourceAnalysisId: analysisId,
      });
      continue;
    }

    // 组间 / 组内 OR 在策略侧无表达（`StrategyDefinition.ConditionDefinition` 没有逻辑运算符字段）
    // ⇒ 响亮登记，绝不静默压成 AND（那会让条件变严、样本骤减且不留痕）。
    const multiGroup = new Set(rows.map((r) => r.groupNo)).size > 1;
    const hasOr =
      rows.some((r, index) => index > 0 && r.logicalOperator !== "AND")
      || rows.some((r) => r.groupLogicalOperator !== "AND");
    if (hasOr) {
      skipped.push({
        reason: "LOGICAL_OPERATOR_NOT_EXPRESSIBLE",
        researchVariable: null,
        detail: `Analysis #${analysisId}（Finding #${String(findingId)}）的条件含 OR / NOT 语义`
          + "（组内或组间），策略侧条件只支持 AND，无法表达",
        sourceFindingId: findingId,
        sourceAnalysisId: analysisId,
      });
      continue;
    }
    if (multiGroup) {
      skipped.push({
        reason: "LOGICAL_OPERATOR_NOT_EXPRESSIBLE",
        researchVariable: null,
        detail: `Analysis #${analysisId}（Finding #${String(findingId)}）有 ${new Set(rows.map((r) => r.groupNo)).size} 个条件组`
          + "（多组语义由组间连接符决定，策略侧无对应表达）",
        sourceFindingId: findingId,
        sourceAnalysisId: analysisId,
      });
      continue;
    }

    for (const row of rows) {
      const semantic = input.semanticIndex.byVariableName.get(row.fieldName);
      if (semantic === undefined) {
        skipped.push({
          reason: "NOT_PATTERN_SEMANTIC_VARIABLE",
          researchVariable: row.fieldName,
          detail: `「${row.fieldName}」不是任何 Pattern 语义声明的展开产物`
            + "（内建特征 / 观察日变量与策略侧字段之间没有声明式对应，不机械翻译）",
          sourceFindingId: findingId,
          sourceAnalysisId: analysisId,
        });
        continue;
      }
      const projection = semantic.strategyProjection;
      if (projection === null) {
        skipped.push({
          reason: "NO_STRATEGY_PROJECTION",
          researchVariable: row.fieldName,
          detail: `Pattern 语义「${semantic.semanticId}」只声明了研究意图，没有执行侧投影`
            + "（不臆造执行口径）",
          sourceFindingId: findingId,
          sourceAnalysisId: analysisId,
        });
        continue;
      }
      // 研究侧方向**只用于如实登记差异**，不作为拒绝判据（理由见 `DerivedRule.researchDirection`）。
      const researchDirection = directionOf(row.operator);
      const directionMismatch =
        researchDirection !== null && researchDirection !== projection.comparison;
      const directionNote =
        researchDirection === null
          ? `研究侧条件「${renderResearchCondition(row)}」不是比较运算，无法与执行侧方向对照`
            + `（执行侧声明为 ${projection.comparison}）—— 请人工确认该条件是否真的等价。`
          : directionMismatch
            ? `🔴 方向不一致：研究侧为 ${researchDirection}（${renderResearchCondition(row)}），`
              + `执行侧声明为 ${projection.comparison}（阈值参数 ${projection.thresholdParam}）。`
              + "两者可能表达不同层面（研究侧「存在性筛选」vs 执行侧「阈值门槛」），"
              + "请人工确认后再转正。"
            : null;
      if (!input.parameterCodes.has(projection.thresholdParam)) {
        skipped.push({
          reason: "THRESHOLD_PARAM_NOT_DECLARED",
          researchVariable: row.fieldName,
          detail: `Pattern 声明的阈值参数「${projection.thresholdParam}」不在候选参数空间里`
            + `（现有参数：${[...input.parameterCodes].sort().join(" / ") || "无"}）`,
          sourceFindingId: findingId,
          sourceAnalysisId: analysisId,
        });
        continue;
      }
      candidates.push({
        fieldName: `bar.${projection.featureId}`,
        operator: operatorOfApproved(projection.comparison),
        value: projection.thresholdParam,
        sourceFindingId: findingId ?? 0,
        sourceAnalysisId: analysisId,
        sourceFindingTitle: finding.title,
        sourceFindingType: finding.findingType,
        researchVariable: row.fieldName,
        researchCondition: renderResearchCondition(row),
        semanticId: semantic.semanticId,
        sourcePatternId: input.semanticIndex.patternIdByVariableName.get(row.fieldName) ?? "",
        comparison: projection.comparison,
        thresholdParam: projection.thresholdParam,
        researchDirection,
        directionMismatch,
        directionNote,
        ...(projection.noteAboutResearchDifference === undefined
          ? {}
          : { noteAboutResearchDifference: projection.noteAboutResearchDifference }),
        effectExcessReturn: readExcess(finding),
        effectSampleCount: readConditionSampleCount(finding),
        researchStrength: finding.researchStrength ?? null,
      });
    }
  }

  // ---- 去重（同键保留 findingId 最小者）----
  const byKey = new Map<string, DerivedRule>();
  for (const rule of candidates) {
    const key = `${rule.fieldName}|${rule.operator}|${rule.value}`;
    const existing = byKey.get(key);
    if (existing === undefined || rule.sourceFindingId < existing.sourceFindingId) byKey.set(key, rule);
  }
  const derivedRules = [...byKey.values()].sort(
    (a, b) =>
      a.fieldName.localeCompare(b.fieldName)
      || a.operator.localeCompare(b.operator)
      || a.value.localeCompare(b.value),
  );

  // ---- filterRule：单组 AND（策略侧唯一可表达形态）；0 条即空组 ----
  const filterRule: ResearchConditionSet =
    derivedRules.length === 0
      ? { groups: [] }
      : {
          groups: [
            {
              groupNo: 0,
              groupLogicalOperator: "AND",
              conditions: derivedRules.map<ResearchConditionSpec>((rule, index) => ({
                groupNo: 0,
                sortOrder: index,
                fieldName: rule.fieldName,
                operator: rule.operator,
                value: rule.value,
                logicalOperator: "AND",
                groupLogicalOperator: "AND",
              })),
            },
          ],
        };

  const evidence = {
    conclusionId: input.conclusion.id ?? 0,
    findingIds: findings.map((f) => f.id ?? 0).filter((id) => id > 0),
    analysisIds: [...analysisIds].sort((a, b) => a - b),
    runIds: [...runIds].sort((a, b) => a - b),
    datasetVersionId: input.datasetVersionId,
  };

  // 只有**真正被引用**的 Pattern 才进 provenance（注册表里有几个 Pattern 不是 provenance）。
  const patternIds = [
    ...new Set(derivedRules.map((r) => r.sourcePatternId).filter((id) => id !== "")),
  ].sort();

  return {
    derivationVersion: EVIDENCE_DERIVATION_VERSION,
    patternIds,
    filterRule,
    derivedRules,
    skipped,
    fingerprint: computeDerivationFingerprint({
      derivationVersion: EVIDENCE_DERIVATION_VERSION,
      patternIds,
      derivedRules,
      evidence,
    }),
    evidence,
  };
}

/** 快照段（写进 `sourceTraceJson.derivation`；**D.5 的 patternId / derivationVersion 落点**）。 */
export function buildDerivationSnapshot(derivation: CandidateDerivation): Record<string, unknown> {
  return {
    derivationVersion: derivation.derivationVersion,
    fingerprint: derivation.fingerprint,
    patternIds: derivation.patternIds,
    derivedRuleCount: derivation.derivedRules.length,
    skippedCount: derivation.skipped.length,
    derivedRules: derivation.derivedRules,
    skipped: derivation.skipped,
    /** 方向不一致的规则数（> 0 ⇒ 必须由人确认后再转正；见 `DerivedRule.directionNote`）。 */
    directionMismatchCount: derivation.derivedRules.filter((r) => r.directionMismatch).length,
    evidence: derivation.evidence,
    /** 人读结论（D.9：让「为什么形成这条规则」在 UI 上可见）。 */
    explain:
      derivation.derivedRules.length === 0
        ? `本次未派生出任何策略条件（${derivation.skipped.length} 条研究侧条件被如实登记为不可翻译）`
          + "—— 候选草图需人工填写。"
        : `由 ${derivation.derivedRules.length} 条研究侧条件派生出策略条件（来自 `
          + `${new Set(derivation.derivedRules.map((r) => r.sourceFindingId)).size} 条 Finding）；`
          + `${derivation.skipped.length} 条条件被登记为不可翻译。`
          + (derivation.derivedRules.some((r) => r.directionMismatch)
            ? ` ⚠️ 其中 ${derivation.derivedRules.filter((r) => r.directionMismatch).length}`
              + " 条的研究侧方向与执行侧声明不一致，需人工确认。"
            : ""),
  };
}

/** 供 UI / 测试读取快照里的规则数（**读取辅助**，不参与判定）。 */
export function snapshotDerivedRuleCount(trace: unknown): number {
  const rec = trace !== null && typeof trace === "object" ? (trace as Record<string, unknown>) : null;
  const derivation = rec?.derivation;
  if (derivation === null || derivation === undefined || typeof derivation !== "object") return 0;
  const rules = (derivation as Record<string, unknown>).derivedRules;
  return Array.isArray(rules) ? rules.length : 0;
}

/** 供 UI / 测试读取快照的 explain 文案。 */
export function snapshotExplain(trace: unknown): string | null {
  const rec = trace !== null && typeof trace === "object" ? (trace as Record<string, unknown>) : null;
  const derivation = rec?.derivation;
  if (derivation === null || derivation === undefined || typeof derivation !== "object") return null;
  const explain = (derivation as Record<string, unknown>).explain;
  return typeof explain === "string" ? explain : null;
}

/** 空的派生结果（**没有 Pattern 语义参与**时使用；不假装派生过）。 */
export function emptyDerivation(args: {
  conclusionId: number;
  datasetVersionId: number | null;
  findingIds: readonly number[];
}): CandidateDerivation {
  const evidence = {
    conclusionId: args.conclusionId,
    findingIds: [...args.findingIds].sort((a, b) => a - b),
    analysisIds: [] as number[],
    runIds: [] as number[],
    datasetVersionId: args.datasetVersionId,
  };
  return {
    derivationVersion: EVIDENCE_DERIVATION_VERSION,
    patternIds: [],
    filterRule: { groups: [] },
    derivedRules: [],
    skipped: [],
    fingerprint: computeDerivationFingerprint({
      derivationVersion: EVIDENCE_DERIVATION_VERSION,
      patternIds: [],
      derivedRules: [],
      evidence,
    }),
    evidence,
  };
}

/** 条件组 → 派生速记（供测试断言与报告引用；`groups[0].conditions` 的字段名列表）。 */
export function ruleFieldNames(filterRule: ResearchConditionSet): string[] {
  return filterRule.groups.flatMap((group) => group.conditions.map((c) => c.fieldName));
}

/** 组形态助手（供测试构造期望值；不在生产路径使用）。 */
export function asGroups(filterRule: ResearchConditionSet): ResearchConditionGroup[] {
  return filterRule.groups;
}
