/**
 * PHASE-B-001 — Pattern 受控语义声明槽：验收测试（编号 `9ca`）。
 *
 * 覆盖 B.12 的四类：**正向**（合法 Pattern → 正确展开）、**负向**（未知 field / 未知 operator /
 * 未来 availability / 非法 window / 非法 mutation → 全部 reject）、**一致性**（研究侧语义 ==
 * 策略侧语义）、**PIT**（T / T+1 / T+2 的可用性行为）。
 *
 * 另含两条**可失败对照**（否则「修好了」只是一句没有对照的声明）：
 *   1. `samePointAvailability` 的 `availableAt.date` 恒为 `1990-01-01` ⇒ 对任何决策日都不会触发
 *      泄漏守卫（护栏空转）；
 *   2. 新可用性用**真实决策日** + 投影期 offset 检查，在「声明窗口晚于决策日」时**真的会拒绝**。
 */

import { describe, expect, it } from "vitest";
import {
  expandPatternSemantics,
  isAggregatingOperator,
  validateSemanticDeclaration,
  type PatternSemanticDeclaration,
} from "../../../../shared/patternSemantics";
import {
  PatternSemanticsError,
  buildPatternSemanticEntries,
  findPatternSemantics,
  listExpandedPatternSemantics,
  semanticAvailableFromOffset,
} from "../../../../server/research/patternLibrary/semanticRegistry";
import { ALL_TRADING_PATTERNS } from "../../../../server/research/patternLibrary/patterns";
import { projectSemanticsToResearch } from "../../../../server/researchEngine/semanticProjection";
import {
  assertProjectionWithinDecisionDay,
  availabilityFromDeclaredOffset,
  projectSemanticsToStrategy,
} from "../../../../server/research/patternLibrary/strategyProjection";
import { samePointAvailability } from "../../../../server/research/recipeRegistryAtoms";
import { compareDecisionTime } from "../../../../server/research/framework/leakage";

const PATTERN_ID = "first-limit-pullback-hold-shrink";

function declaration(partial: Partial<PatternSemanticDeclaration>): PatternSemanticDeclaration {
  return {
    semanticId: "probe_depth",
    label: "探针深度",
    definition: "测试用：窗口内最低价相对 T 日开盘价的回撤深度",
    source: "POST_BAR",
    field: "low",
    aggregation: "MIN",
    windowDays: 2,
    availableFromOffset: 2,
    intent: { question: "测试问题" },
    ...partial,
  } as PatternSemanticDeclaration;
}

describe("PHASE-B-001 · 正向：真实 Pattern 清单 → 正确展开", () => {
  it("首板回踩模式声明了 2 条语义，展开名规范、可用性 = 窗口末端", () => {
    const entry = findPatternSemantics(PATTERN_ID);
    expect(entry).toBeDefined();
    expect(entry!.version).toBe("1.0.0");
    expect(entry!.expanded.map((e) => e.name)).toEqual([
      "pat_pullback_hold_depth_2d",
      "pat_pullback_shrink_ratio_2d",
    ]);
    for (const item of entry!.expanded) {
      expect(item.role).toBe("OBSERVATION");
      expect(item.availableFromOffset).toBe(item.windowDays);
      expect(item.strategyProjection).not.toBeNull();
    }
    expect(entry!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("算子白名单外的一律不是聚合算子（白名单是有限的）", () => {
    expect(isAggregatingOperator("MIN")).toBe(true);
    expect(isAggregatingOperator("EQ")).toBe(false);
  });
});

describe("PHASE-B-001 · 负向：非法声明逐条拒绝", () => {
  const cases: Array<[string, PatternSemanticDeclaration, string]> = [
    ["未知 operator", declaration({ aggregation: "CORRELATE" as never }), "UNKNOWN_OPERATOR"],
    ["聚合算子缺 windowDays", declaration({ windowDays: undefined }), "WINDOW_REQUIRED_MISSING"],
    ["单点取值却给了 windowDays", declaration({ aggregation: undefined, windowDays: 3, availableFromOffset: 0 }), "WINDOW_NOT_ALLOWED"],
    ["POST_BAR 的可用性不等于窗口末端", declaration({ availableFromOffset: 1 }), "AVAILABILITY_MISMATCHES_WINDOW"],
    ["POST_BAR 声称 availableFromOffset=0", declaration({ availableFromOffset: 0 }), "AVAILABILITY_MISMATCHES_WINDOW"],
    ["EVENT_BAR 却声明了未来可用性", declaration({ source: "EVENT_BAR", aggregation: undefined, windowDays: undefined, availableFromOffset: 1 }), "INVALID_AVAILABILITY"],
    ["返回来源被投影成策略条件", declaration({ source: "OUTCOME", aggregation: undefined, windowDays: undefined, availableFromOffset: 1, strategyProjection: { featureId: "x", comparison: "LTE", thresholdParam: "t" } }), "OUTCOME_SOURCE_AS_CONDITION"],
    ["semanticId 非 snake_case", declaration({ semanticId: "Probe-Depth" }), "INVALID_SEMANTIC_ID"],
  ];

  for (const [name, decl, code] of cases) {
    it(`${name} ⇒ ${code}`, () => {
      const issues = validateSemanticDeclaration(decl);
      expect(issues.map((i) => i.code)).toContain(code);
      // 非法声明**不进入**展开产物（否则会被下游当成可用语义）
      const { expanded } = expandPatternSemantics([decl]);
      expect(expanded).toHaveLength(0);
    });
  }

  it("同一批里 semanticId 重复 ⇒ DUPLICATE_SEMANTIC_ID", () => {
    const d = declaration({});
    const { expanded, issues } = expandPatternSemantics([d, { ...d }]);
    expect(expanded).toHaveLength(1);
    expect(issues.map((i) => i.code)).toContain("DUPLICATE_SEMANTIC_ID");
  });
});

describe("PHASE-B-001 · 唯一性与不可变性（B.9）", () => {
  it("同一 patternId + version 重复注册 ⇒ SEMANTIC_REDEFINITION", () => {
    const pattern = ALL_TRADING_PATTERNS.find((p) => p.patternId === "event-return-research")!;
    const duplicated = {
      ...pattern,
      semantics: { version: "9.9.9", declarations: [declaration({})] },
    };
    const twice = [duplicated, { ...duplicated }];
    expect(() => buildPatternSemanticEntries(twice)).toThrow(PatternSemanticsError);
    try {
      buildPatternSemanticEntries(twice);
    } catch (e) {
      expect((e as PatternSemanticsError).code).toBe("SEMANTIC_REDEFINITION");
    }
  });

  it("两个 Pattern 抢同一 semanticId ⇒ SEMANTIC_ID_COLLISION", () => {
    const a = ALL_TRADING_PATTERNS.find((p) => p.patternId === "event-return-research")!;
    const b = ALL_TRADING_PATTERNS.find((p) => p.patternId === "entry-timing-research")!;
    const withSemantics = (p: typeof a, version: string) => ({
      ...p,
      semantics: { version, declarations: [declaration({ semanticId: "shared_probe" })] },
    });
    try {
      buildPatternSemanticEntries([withSemantics(a, "1.0.0"), withSemantics(b, "1.0.0")]);
      throw new Error("应当拒绝");
    } catch (e) {
      expect((e as PatternSemanticsError).code).toBe("SEMANTIC_ID_COLLISION");
    }
  });

  it("非法声明 ⇒ INVALID_SEMANTIC_DECLARATION（注册期就拒绝，不留到执行期）", () => {
    const a = ALL_TRADING_PATTERNS.find((p) => p.patternId === "event-return-research")!;
    try {
      buildPatternSemanticEntries([
        { ...a, semantics: { version: "1.0.0", declarations: [declaration({ aggregation: "BOGUS" as never })] } },
      ]);
      throw new Error("应当拒绝");
    } catch (e) {
      expect((e as PatternSemanticsError).code).toBe("INVALID_SEMANTIC_DECLARATION");
    }
  });

  it("产物被深冻结：运行期 mutate 不能改变语义（同 Pattern 恒同语义）", () => {
    const entry = findPatternSemantics(PATTERN_ID)!;
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.expanded)).toBe(true);
    expect(Object.isFrozen(entry.expanded[0])).toBe(true);
    const before = entry.expanded[0]!.availableFromOffset;
    expect(() => {
      (entry.expanded[0] as unknown as Record<string, unknown>).availableFromOffset = 99;
    }).toThrow();
    expect(entry.expanded[0]!.availableFromOffset).toBe(before);
  });
});

describe("PHASE-B-001 · 研究投影（B.6）", () => {
  const expanded = listExpandedPatternSemantics();

  it("数据集视界覆盖 ⇒ 产出观察日变量定义，且带自己的 resolve", () => {
    const r = projectSemanticsToResearch({
      expanded,
      postRelativeDayRange: { min: 1, max: 20 },
      decisionOffsetDays: null,
    });
    expect(r.rejections).toHaveLength(0);
    expect(r.definitions.map((d) => d.name)).toEqual([
      "pat_pullback_hold_depth_2d",
      "pat_pullback_shrink_ratio_2d",
    ]);
    expect(r.definitions[0]!.postRelativeDays).toEqual([1, 2]);
    const value = r.definitions[0]!.resolve({
      postBars: new Map([
        [1, { relativeDay: 1, low: 10.5 } as never],
        [2, { relativeDay: 2, low: 10.0 } as never],
      ]),
      eventBar: undefined,
    } as never);
    expect(value).toBe(10.0);
  });

  it("数据集 post 视界不足 ⇒ OUT_OF_DATASET_RANGE（不静默 null）", () => {
    const r = projectSemanticsToResearch({
      expanded,
      postRelativeDayRange: { min: 1, max: 1 },
      decisionOffsetDays: null,
    });
    expect(r.definitions).toHaveLength(0);
    expect(r.rejections.map((x) => x.code)).toEqual(["OUT_OF_DATASET_RANGE", "OUT_OF_DATASET_RANGE"]);
  });

  it("声明窗口晚于决策日 ⇒ AFTER_DECISION_DAY（复用 R1 的判定日契约）", () => {
    const r = projectSemanticsToResearch({
      expanded,
      postRelativeDayRange: { min: 1, max: 20 },
      decisionOffsetDays: 1,
    });
    expect(r.definitions).toHaveLength(0);
    expect(r.rejections.map((x) => x.code)).toEqual(["AFTER_DECISION_DAY", "AFTER_DECISION_DAY"]);
  });

  it("核心目录之外的名字仍然被拒绝（白名单没有被放开）", () => {
    // 未声明的语义名不在目录里 ⇒ 由 `hasObservation` 挡住（此处用注册表侧断言同一事实）
    expect(semanticAvailableFromOffset("pat_not_declared_2d")).toBeNull();
    expect(semanticAvailableFromOffset("pat_pullback_hold_depth_2d")).toBe(2);
  });
});

describe("PHASE-B-001 · 策略投影与两侧一致性（B.7 / B.10）", () => {
  const expanded = listExpandedPatternSemantics();
  const point = "close" as const;
  const decisionDate = "2026-09-18";

  it("同一份声明 → 策略特征，可用性日期取**真实决策日**（不再是 1990-01-01）", () => {
    const r = projectSemanticsToStrategy({ expanded, point, decisionDate, decisionOffsetDays: 2 });
    expect(r.rejections).toHaveLength(0);
    expect(r.features.map((f) => f.featureId)).toEqual(["haircutFromEventLow", "volumeRatio"]);
    for (const f of r.features) {
      expect(f.availability.availableAt.date).toBe(decisionDate);
      expect(f.availability.requiredDataThrough.date).toBe(decisionDate);
    }
    // 研究侧差异如实带出（不抹平）
    expect(r.features[0]!.noteAboutResearchDifference).toContain("累积整窗");
  });

  it("声明窗口晚于决策日 ⇒ AFTER_DECISION_DAY（这是**可失败**的护栏）", () => {
    const r = projectSemanticsToStrategy({ expanded, point, decisionDate, decisionOffsetDays: 1 });
    expect(r.features).toHaveLength(0);
    expect(r.rejections.map((x) => x.code)).toEqual(["AFTER_DECISION_DAY", "AFTER_DECISION_DAY"]);
    expect(() => assertProjectionWithinDecisionDay("x", 2, 1)).toThrow(/晚于决策日/);
    expect(() => assertProjectionWithinDecisionDay("x", 2, null)).toThrow(/未声明决策日/);
  });

  it("一致性：研究侧与策略侧来自同一份 expanded ⇒ semanticId / 名字一一对应（无双写 SoT）", () => {
    const research = projectSemanticsToResearch({
      expanded,
      postRelativeDayRange: { min: 1, max: 20 },
      decisionOffsetDays: 2,
    });
    const strategy = projectSemanticsToStrategy({ expanded, point, decisionDate, decisionOffsetDays: 2 });
    expect(research.definitions.map((d) => d.name)).toEqual(
      strategy.features.map((f) => expanded.find((e) => e.semanticId === f.semanticId)!.name),
    );
    // 两侧的可用性上界也一致
    for (const f of strategy.features) {
      const item = expanded.find((e) => e.semanticId === f.semanticId)!;
      expect(item.availableFromOffset).toBe(f.availability.declaredOffset);
    }
  });

  it("只声明研究意图、没有执行侧投影 ⇒ MISSING_STRATEGY_PROJECTION（不臆造执行口径）", () => {
    const { expanded: onlyResearch } = expandPatternSemantics([declaration({})]);
    const r = projectSemanticsToStrategy({ expanded: onlyResearch, point, decisionDate, decisionOffsetDays: 2 });
    expect(r.features).toHaveLength(0);
    expect(r.rejections.map((x) => x.code)).toEqual(["MISSING_STRATEGY_PROJECTION"]);
  });
});

describe("PHASE-B-001 · PIT 与「可失败对照」（B.8）", () => {
  it("🔴 对照：旧 samePointAvailability 的日期恒为 1990-01-01 ⇒ 对任何决策日都不触发泄漏守卫", () => {
    const legacy = samePointAvailability("close");
    expect(legacy.availableAt.date).toBe("1990-01-01");
    expect(legacy.requiredDataThrough.date).toBe("1990-01-01");
    // 用框架自己的比较器：1990-01-01 永远不会晚于任何真实决策日 ⇒ 守卫空转
    for (const date of ["2026-09-18", "2019-01-02", "1990-01-01"]) {
      expect(compareDecisionTime(legacy.availableAt, { date, point: "close" })).toBeLessThanOrEqual(0);
      expect(compareDecisionTime(legacy.requiredDataThrough, { date, point: "close" })).toBeLessThanOrEqual(0);
    }
  });

  it("新可用性用真实决策日 ⇒ 声称「晚于决策日才可知」时**会**被比较器抓到", () => {
    const later = availabilityFromDeclaredOffset("close", "2026-09-21", 2);
    expect(compareDecisionTime(later.availableAt, { date: "2026-09-18", point: "close" })).toBeGreaterThan(0);
  });

  it("T / T+1 / T+2 的可用性行为：EVENT_BAR 可声明；POST_BAR 在 d=1 被拒、d=2 通过", () => {
    const eventBar = declaration({
      semanticId: "disclosed_on_event",
      source: "EVENT_BAR",
      aggregation: undefined,
      windowDays: undefined,
      availableFromOffset: 0,
    });
    const { expanded: e1, issues: i1 } = expandPatternSemantics([eventBar]);
    expect(i1).toHaveLength(0);
    expect(e1[0]!.availableFromOffset).toBe(0);

    const postBar = declaration({});
    const { expanded: e2 } = expandPatternSemantics([postBar]);
    expect(
      projectSemanticsToResearch({ expanded: e2, postRelativeDayRange: { min: 1, max: 20 }, decisionOffsetDays: 1 })
        .rejections.map((x) => x.code),
    ).toEqual(["AFTER_DECISION_DAY"]);
    expect(
      projectSemanticsToResearch({ expanded: e2, postRelativeDayRange: { min: 1, max: 20 }, decisionOffsetDays: 2 })
        .definitions,
    ).toHaveLength(1);
  });
});
