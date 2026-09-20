/**
 * PHASE-D-001 — Evidence → Candidate 确定性派生（编号 `9cb`）的验收测试。
 *
 * 判据设计原则（照本仓既有纪律）：
 *   - **正向**只证明「能派生」，不证明「派生得对」；
 *   - 每条「不该派生」的路径都要有一条**可失败对照**（把该保护去掉 ⇒ 断言必须变红）；
 *   - **跨模块真判据**：派生出的 `filterRule` 必须能被 `definitionBuild` 的字段引用文法接受
 *     （`parseStrategyFieldReference(...).kind !== "unknown"`）—— 否则「派生成功」只是本地自证。
 */

import { describe, expect, it } from "vitest";
import {
  DERIVATION_SKIP_REASONS,
  buildDerivationSnapshot,
  buildSemanticIndex,
  computeDerivationFingerprint,
  deriveCandidateRules,
  emptyDerivation,
  ruleFieldNames,
  snapshotDerivedRuleCount,
  snapshotExplain,
} from "../../../../server/research/strategyCandidate/evidenceDerivation";
import { listPatternSemantics } from "../../../../server/research/patternLibrary/semanticRegistry";
import { parseStrategyFieldReference } from "../../../../server/research/strategySchema/definition";
import type {
  ResearchAnalysisCondition,
  ResearchConclusion,
  ResearchFinding,
} from "../../../../server/researchCore";

// ---------------------------------------------------------------------------
// 夹具（合成；语义变量名取自**真实注册表**，不硬编码）
// ---------------------------------------------------------------------------

const entries = listPatternSemantics();
const firstEntry = entries[0];
if (firstEntry === undefined) throw new Error("语义注册表为空：PHASE-B-001 的声明未加载");
const expanded = firstEntry.expanded;
/** `pullback_hold_depth`（含 strategyProjection = bar.haircutFromEventLow / LTE / max_drawdown）。 */
const holdDepth = expanded.find((e) => e.semanticId === "pullback_hold_depth");
/** `pullback_shrink_ratio`（含 strategyProjection = bar.volumeRatio / LTE / max_volume_ratio）。 */
const shrinkRatio = expanded.find((e) => e.semanticId === "pullback_shrink_ratio");
if (holdDepth === undefined || shrinkRatio === undefined) {
  throw new Error("真实注册表缺少 pullback_hold_depth / pullback_shrink_ratio 语义");
}

const semanticIndex = buildSemanticIndex(entries);
/** Pattern 草图投影出的参数空间（阈值参数必须在其键集合内）。 */
const parameterCodes = new Set(["max_drawdown", "max_volume_ratio"]);

function makeConclusion(overrides: Partial<ResearchConclusion> = {}): ResearchConclusion {
  return {
    id: 660003,
    experimentId: 480003,
    hypothesisId: null,
    conclusionType: "SUPPORTED",
    title: "首板后回踩深度是否影响后续收益？",
    conclusion: "回踩浅的样本后续收益更好。",
    status: "DRAFT",
    findingIds: [90055, 90052],
    ...overrides,
  } as ResearchConclusion;
}

function makeFinding(input: {
  id: number;
  analysisId: number | null;
  findingType?: string;
  excessReturn?: number | null;
  conditionSampleCount?: number | null;
  researchStrength?: number | null;
}): ResearchFinding {
  return {
    id: input.id,
    experimentId: 480003,
    runId: 750003,
    primaryAnalysisId: input.analysisId,
    findingType: input.findingType ?? "EFFECT",
    title: `finding-${input.id}`,
    summary: null,
    status: "DISCOVERED",
    target: "future_return_5d",
    dimension: null,
    effect:
      input.excessReturn === undefined || input.excessReturn === null
        ? null
        : JSON.stringify({
            excessReturn: input.excessReturn,
            buckets: [
              { label: "ALL", metricValue: 0.016, sampleCount: 1065 },
              { label: "CONDITION", metricValue: 0.053, sampleCount: input.conditionSampleCount ?? null },
            ],
          }),
    researchStrength: input.researchStrength ?? 0.95,
  } as unknown as ResearchFinding;
}

function makeCondition(input: {
  analysisId: number;
  fieldName: string;
  operator: string;
  value: unknown;
  groupNo?: number;
  sortOrder?: number;
  logicalOperator?: string;
  groupLogicalOperator?: string;
}): ResearchAnalysisCondition {
  return {
    id: input.analysisId * 100 + (input.sortOrder ?? 0),
    analysisId: input.analysisId,
    groupNo: input.groupNo ?? 0,
    sortOrder: input.sortOrder ?? 0,
    fieldName: input.fieldName,
    operator: input.operator,
    value: input.value,
    logicalOperator: input.logicalOperator ?? "AND",
    groupLogicalOperator: input.groupLogicalOperator ?? "AND",
    createdAt: "2026-09-20T00:00:00.000Z",
  } as ResearchAnalysisCondition;
}

function derive(input: {
  findings: readonly ResearchFinding[];
  conditions: readonly ResearchAnalysisCondition[];
  parameterCodes?: ReadonlySet<string>;
  priority?: unknown;
  conclusion?: ResearchConclusion;
}) {
  const map = new Map<number, ResearchAnalysisCondition[]>();
  for (const condition of input.conditions) {
    const list = map.get(condition.analysisId) ?? [];
    list.push(condition);
    map.set(condition.analysisId, list);
  }
  return deriveCandidateRules({
    conclusion: input.conclusion ?? makeConclusion(),
    findings: input.findings,
    conditionsOf: (analysisId) => map.get(analysisId) ?? [],
    semanticIndex,
    parameterCodes: input.parameterCodes ?? parameterCodes,
    datasetVersionId: 390002,
  });
}

// ---------------------------------------------------------------------------
// 正向：Pattern 语义变量 → 策略侧字段引用
// ---------------------------------------------------------------------------

describe("正向派生", () => {
  it("Pattern 语义变量 ⇒ 策略侧条件（fieldName 含 '.'，阈值=参数引用）", () => {
    const result = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007, excessReturn: 0.0168 })],
      conditions: [
        makeCondition({
          analysisId: 930007,
          fieldName: holdDepth!.name,
          operator: "<=",
          value: 0.05,
        }),
      ],
    });

    expect(result.skipped).toEqual([]);
    expect(result.derivedRules).toHaveLength(1);
    const rule = result.derivedRules[0]!;
    expect(rule.fieldName).toBe("bar.haircutFromEventLow");
    expect(rule.operator).toBe("<=");
    expect(rule.value).toBe("max_drawdown");
    expect(rule.sourceFindingId).toBe(90052);
    expect(rule.sourceAnalysisId).toBe(930007);
    expect(rule.researchVariable).toBe(holdDepth!.name);
    expect(rule.sourcePatternId).toBe(firstEntry.patternId);
    expect(rule.comparison).toBe("LTE");
    expect(rule.researchDirection).toBe("LTE");
    expect(rule.directionMismatch).toBe(false);
    expect(rule.effectExcessReturn).toBeCloseTo(0.0168, 10);

    // 跨模块真判据：派生的引用必须被策略侧文法接受（否则转正必失败）。
    expect(parseStrategyFieldReference(rule.fieldName).kind).not.toBe("unknown");

    expect(ruleFieldNames(result.filterRule)).toEqual(["bar.haircutFromEventLow"]);
    expect(result.filterRule.groups).toHaveLength(1);
    expect(result.filterRule.groups[0]!.groupLogicalOperator).toBe("AND");
  });

  it("多条条件 ⇒ 去重后按 fieldName 升序（确定性），同键保留 findingId 最小者", () => {
    const result = derive({
      findings: [
        makeFinding({ id: 90061, analysisId: 930008 }),
        makeFinding({ id: 90052, analysisId: 930007 }),
      ],
      conditions: [
        // 两个分析给出**同一条**策略侧规则（allow）⇒ 应去重为 1 条，保留 findingId=90052
        makeCondition({ analysisId: 930008, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
        // 另一条不同规则
        makeCondition({
          analysisId: 930007,
          fieldName: shrinkRatio!.name,
          operator: "<=",
          value: 0.5,
          sortOrder: 1,
        }),
      ],
    });

    expect(result.derivedRules).toHaveLength(2);
    expect(result.derivedRules.map((r) => r.fieldName)).toEqual([
      "bar.haircutFromEventLow",
      "bar.volumeRatio",
    ]);
    const holdRule = result.derivedRules.find((r) => r.fieldName === "bar.haircutFromEventLow")!;
    expect(holdRule.sourceFindingId).toBe(90052);
  });

  it("filterRule 的条件顺序与 derivedRules 一致，且 sortOrder 连续（0,1,…）", () => {
    const result = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: shrinkRatio!.name, operator: "<=", value: 0.5, sortOrder: 5 }),
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05, sortOrder: 1 }),
      ],
    });
    const conditions = result.filterRule.groups[0]!.conditions;
    expect(conditions.map((c) => c.sortOrder)).toEqual([0, 1]);
    expect(conditions.map((c) => c.fieldName)).toEqual(["bar.haircutFromEventLow", "bar.volumeRatio"]);
    expect(conditions.every((c) => c.logicalOperator === "AND")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 确定性（D.6）
// ---------------------------------------------------------------------------

describe("确定性", () => {
  it("同输入 ⇒ 同指纹；finding 顺序颠倒亦同（遍历顺序固定）", () => {
    const findings = [
      makeFinding({ id: 90052, analysisId: 930007 }),
      makeFinding({ id: 90061, analysisId: 930008 }),
    ];
    const conditions = [
      makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
      makeCondition({ analysisId: 930008, fieldName: shrinkRatio!.name, operator: "<=", value: 0.5 }),
    ];
    const a = derive({ findings, conditions });
    const b = derive({ findings: [...findings].reverse(), conditions: [...conditions].reverse() });
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.derivedRules.map((r) => r.fieldName)).toEqual(a.derivedRules.map((r) => r.fieldName));
  });

  it("指纹不读时钟：同内容重新构造 ⇒ 指纹逐字节相同", () => {
    const build = () =>
      derive({
        findings: [makeFinding({ id: 90052, analysisId: 930007 })],
        conditions: [
          makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
        ],
      }).fingerprint;
    expect(build()).toBe(build());
  });

  it("指纹对「内容变化」敏感：改 value ⇒ 指纹变（可失败对照）", () => {
    const base = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
      ],
    });
    const changed = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.09 }),
      ],
    });
    expect(changed.fingerprint).not.toBe(base.fingerprint);
  });

  it("computeDerivationFingerprint 是纯函数（同参同值）", () => {
    const derivation = emptyDerivation({ conclusionId: 1, datasetVersionId: 2, findingIds: [3, 4] });
    const again = computeDerivationFingerprint({
      derivationVersion: derivation.derivationVersion,
      patternIds: derivation.patternIds,
      derivedRules: derivation.derivedRules,
      evidence: derivation.evidence,
    });
    expect(again).toBe(derivation.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// 负向（每条都要有可失败对照）
// ---------------------------------------------------------------------------

describe("不可翻译一律如实登记（绝不猜）", () => {
  it("非 Pattern 语义变量（内建观察日变量）⇒ NOT_PATTERN_SEMANTIC_VARIABLE", () => {
    const result = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({
          analysisId: 930007,
          fieldName: "pullback_holds_event_open_2d",
          operator: "==",
          value: 1,
        }),
      ],
    });
    expect(result.derivedRules).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toBe("NOT_PATTERN_SEMANTIC_VARIABLE");
    expect(result.skipped[0]!.sourceFindingId).toBe(90052);
    // 可失败对照：把该变量**当成**语义变量加入索引 ⇒ 不再跳过（证明跳过是这一条判据造成的）
    const forged = buildSemanticIndex([
      { patternId: "forged", expanded: [{ ...holdDepth!, name: "pullback_holds_event_open_2d" }] },
    ]);
    const withForged = deriveCandidateRules({
      conclusion: makeConclusion(),
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditionsOf: () => [
        makeCondition({
          analysisId: 930007,
          fieldName: "pullback_holds_event_open_2d",
          operator: "==",
          value: 1,
        }),
      ],
      semanticIndex: forged,
      parameterCodes,
      datasetVersionId: 390002,
    });
    expect(withForged.derivedRules).toHaveLength(1);
  });

  it("分析没有结构化条件 ⇒ NO_STRUCTURED_CONDITIONS（附对照：加一条条件即派生）", () => {
    const empty = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [],
    });
    expect(empty.derivedRules).toEqual([]);
    expect(empty.skipped[0]!.reason).toBe("NO_STRUCTURED_CONDITIONS");
    expect(empty.filterRule.groups).toEqual([]);

    const nonEmpty = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
      ],
    });
    expect(nonEmpty.derivedRules).toHaveLength(1);
  });

  it("Finding 没有 primaryAnalysisId ⇒ NO_STRUCTURED_CONDITIONS", () => {
    const result = derive({
      findings: [makeFinding({ id: 90052, analysisId: null })],
      conditions: [],
    });
    expect(result.skipped[0]!.reason).toBe("NO_STRUCTURED_CONDITIONS");
    expect(result.skipped[0]!.sourceAnalysisId).toBeNull();
  });

  it("OR 语义 ⇒ LOGICAL_OPERATOR_NOT_EXPRESSIBLE（组内 OR 与多组各一例）", () => {
    const innerOr = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
        makeCondition({
          analysisId: 930007,
          fieldName: shrinkRatio!.name,
          operator: "<=",
          value: 0.5,
          sortOrder: 1,
          logicalOperator: "OR",
        }),
      ],
    });
    expect(innerOr.derivedRules).toEqual([]);
    expect(innerOr.skipped[0]!.reason).toBe("LOGICAL_OPERATOR_NOT_EXPRESSIBLE");

    const multiGroup = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
        makeCondition({
          analysisId: 930007,
          fieldName: shrinkRatio!.name,
          operator: "<=",
          value: 0.5,
          groupNo: 1,
        }),
      ],
    });
    expect(multiGroup.derivedRules).toEqual([]);
    expect(multiGroup.skipped[0]!.reason).toBe("LOGICAL_OPERATOR_NOT_EXPRESSIBLE");

    // 可失败对照：把 OR 改成 AND ⇒ 立即派生（证明跳过确由 OR 造成）
    const allAnd = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
        makeCondition({
          analysisId: 930007,
          fieldName: shrinkRatio!.name,
          operator: "<=",
          value: 0.5,
          sortOrder: 1,
        }),
      ],
    });
    expect(allAnd.derivedRules).toHaveLength(2);
  });

  it("声明要求的阈值参数不在候选参数空间 ⇒ THRESHOLD_PARAM_NOT_DECLARED", () => {
    const result = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
      ],
      parameterCodes: new Set(["max_volume_ratio"]), // 缺 max_drawdown
    });
    expect(result.derivedRules).toEqual([]);
    expect(result.skipped[0]!.reason).toBe("THRESHOLD_PARAM_NOT_DECLARED");
    expect(result.skipped[0]!.detail).toContain("max_drawdown");
  });

  it("skip 原因全部落在闭集内（无第二套字符串）", () => {
    const result = derive({
      findings: [makeFinding({ id: 1, analysisId: 10 })],
      conditions: [
        makeCondition({ analysisId: 10, fieldName: "not_a_semantic_var", operator: "==", value: 1 }),
      ],
    });
    for (const item of result.skipped) {
      expect(DERIVATION_SKIP_REASONS).toContain(item.reason);
    }
  });
});

// ---------------------------------------------------------------------------
// 方向差异：如实登记而非拒绝（本轮修正的核心）
// ---------------------------------------------------------------------------

describe("方向差异必须「派生 + 登记」，不得静默也不得误杀", () => {
  it("研究侧 GTE 与声明 LTE 相反 ⇒ 仍然派生，但 directionMismatch=true 并有可读说明", () => {
    const result = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: ">=", value: 0 }),
      ],
    });
    expect(result.derivedRules).toHaveLength(1);
    const rule = result.derivedRules[0]!;
    expect(rule.researchDirection).toBe("GTE");
    expect(rule.directionMismatch).toBe(true);
    expect(rule.directionNote).toContain("方向不一致");
    expect(rule.operator).toBe("<="); // 执行侧仍按声明
    expect(rule.researchCondition).toContain(">="); // 研究侧原文原样保留

    const snapshot = buildDerivationSnapshot(result);
    expect(snapshot.directionMismatchCount).toBe(1);
    expect(String(snapshot.explain)).toContain("需人工确认");
  });

  it("非比较运算（==）⇒ researchDirection=null 且带说明（不拒绝）", () => {
    const result = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "==", value: 1 }),
      ],
    });
    expect(result.derivedRules).toHaveLength(1);
    expect(result.derivedRules[0]!.researchDirection).toBeNull();
    expect(result.derivedRules[0]!.directionMismatch).toBe(false);
    expect(result.derivedRules[0]!.directionNote).toContain("不是比较运算");
  });

  it("方向一致 ⇒ 无说明（三者可辨，证明判据有牙齿）", () => {
    const same = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
      ],
    });
    expect(same.derivedRules[0]!.directionMismatch).toBe(false);
    expect(same.derivedRules[0]!.directionNote).toBeNull();
    expect(buildDerivationSnapshot(same).directionMismatchCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 快照与读取辅助
// ---------------------------------------------------------------------------

describe("快照", () => {
  it("快照含 derivationVersion / fingerprint / patternIds / 规则与跳过明细", () => {
    const result = derive({
      findings: [makeFinding({ id: 90052, analysisId: 930007 })],
      conditions: [
        makeCondition({ analysisId: 930007, fieldName: holdDepth!.name, operator: "<=", value: 0.05 }),
        makeCondition({
          analysisId: 930007,
          fieldName: "pullback_holds_event_open_2d",
          operator: "==",
          value: 1,
          sortOrder: 1,
        }),
      ],
    });
    const snapshot = buildDerivationSnapshot(result);
    expect(snapshot.derivationVersion).toBe("research-evidence-derivation@1.0.0");
    expect(snapshot.fingerprint).toBe(result.fingerprint);
    expect(snapshot.patternIds).toEqual([firstEntry.patternId]);
    expect(snapshot.derivedRuleCount).toBe(1);
    expect(snapshot.skippedCount).toBe(1);
    // 读取辅助吃的是**整个 sourceTraceJson**（derivation 是它的一个段），不是段本身
    // —— 传错层级时保持沉默（返回 null）而不是读到别人的字段。
    const trace = { snapshotKind: "research_conclusion_evidence", derivation: snapshot };
    expect(snapshotExplain(trace)).toBeTruthy();
    expect(snapshotDerivedRuleCount(trace)).toBe(1);
    expect(snapshotExplain(snapshot)).toBeNull();
  });

  it("没有 Finding ⇒ emptyDerivation（真实反映「没有证据」，不假装派生过）", () => {
    const empty = emptyDerivation({ conclusionId: 1, datasetVersionId: null, findingIds: [] });
    expect(empty.derivedRules).toEqual([]);
    expect(empty.patternIds).toEqual([]);
    expect(empty.filterRule.groups).toEqual([]);
    const snapshot = buildDerivationSnapshot(empty);
    expect(snapshotDerivedRuleCount(snapshot)).toBe(0);
    expect(String(snapshot.explain)).toContain("未派生出任何策略条件");
  });

  it("读取辅助对非快照输入保持沉默（返回 0 / null，不抛）", () => {
    expect(snapshotDerivedRuleCount(null)).toBe(0);
    expect(snapshotDerivedRuleCount({ a: 1 })).toBe(0);
    expect(snapshotExplain(null)).toBeNull();
    expect(snapshotExplain("not-an-object")).toBeNull();
  });
});
