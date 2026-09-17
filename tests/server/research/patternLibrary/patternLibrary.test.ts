/**
 * PATTERN-LIBRARY-001 — 交易模式声明库单测。
 *
 * 锁死五件**最容易悄悄错**的事：
 *
 *   1. **迁移等价**：注册表内容与迁移前逐项一致（7 个研究模块键 / 2 个配方 id），
 *      且「守线 + 缩量」配方的门槛行为逐支可辨。全量行为等价另由
 *      `docs/evidence/_probe_pattern_migration_snapshot.mts` 的**逐字节比对**覆盖
 *      （迁移前后均为 50973 B），本文件只钉关键面。
 *   2. **声明库自洽**：id 唯一、门槛引用的特征必须在产出面内、门槛引用的参数必须已声明 ——
 *      这类错误若能溜到运行时，症状是「信号莫名变少」而不是报错。
 *   3. **词表一致性**（本文件是它唯一的落点）：`project.ts` 刻意**不** import
 *      `strategyCandidate/definitionBuild.ts`（否则研究规划域会反向依赖策略候选域），
 *      因此「sketch.event / timing 是否真在策略侧词表里」只能在这里断言。
 *   4. **候选草图投影**：双栖模式能投影；缺 sketch / 纯研究模式必须返回 `null`
 *      （而不是编一个默认窗口）。
 *   5. **`parameterRole` 真正生效**：声明 `role: "fixed"` 的参数投影为 `FIXED`
 *      且**不进搜索空间**（迁移前会被 `buildParameters` 恒置 TUNABLE ⇒ 静默被搜索）。
 */

import { describe, expect, it } from "vitest";
import {
  ALL_TRADING_PATTERNS,
  buildPatternModuleSpecs,
  buildPatternRecipeDefinitions,
  FIRST_LIMIT_PULLBACK_HOLD_SHRINK,
  projectCandidateSketch,
  projectParameterSpace,
  projectRecipeReference,
  projectResearchModule,
  projectSketchParameterSpace,
  requireTradingPattern,
  type TradingPatternSpec,
} from "../../../../server/research/patternLibrary";
import { createDefaultResearchModuleRegistry } from "../../../../server/researchEngine/planner/moduleRegistry";
import {
  PULLBACK_FEATURE_IDS,
  registeredStrategyRecipeIds,
  resolveStrategyRecipe,
  resolveStrategyRecipeById,
} from "../../../../server/research/recipeRegistry";
import { ENTRY_TIMING_TO_EXECUTION } from "../../../../server/research/strategyCandidate/definitionBuild";
import {
  STRATEGY_EVENT_TYPES,
  STRATEGY_TRIGGER_TYPES,
} from "../../../../server/research/strategySchema/definition";

const PULLBACK_RECIPE_ID = "first-limit-pullback-hold-shrink";

// ---------------------------------------------------------------------------
// 1. 迁移等价
// ---------------------------------------------------------------------------

describe("PATTERN-LIBRARY-001 · 注册表由声明库派生（迁移等价）", () => {
  it("研究模块键集合与迁移前一致（7 个）", () => {
    expect(createDefaultResearchModuleRegistry().listKeys()).toEqual([
      "BREAKOUT_SUCCESS_RESEARCH",
      "ENTRY_TIMING_RESEARCH",
      "EVENT_RETURN_RESEARCH",
      "HOLDING_PERIOD_RESEARCH",
      "MARKET_REGIME_STABILITY",
      "PULLBACK_EFFECTIVENESS",
      "STOP_LOSS_RESEARCH",
    ]);
  });

  it("配方 id 集合与迁移前一致（2 个）", () => {
    expect(registeredStrategyRecipeIds()).toEqual([PULLBACK_RECIPE_ID, "leader-candidate-baseline"]);
  });

  it("模块规格数量 = 声明库里带 research 侧的模式数", () => {
    const expected = ALL_TRADING_PATTERNS.filter(pattern => pattern.research !== null).length;
    expect(buildPatternModuleSpecs()).toHaveLength(expected);
    expect(expected).toBe(7);
  });

  it("配方定义数量 = 声明库里带 execution 侧的模式数", () => {
    const expected = ALL_TRADING_PATTERNS.filter(pattern => pattern.execution !== null).length;
    expect(buildPatternRecipeDefinitions()).toHaveLength(expected);
    expect(expected).toBe(2);
  });

  it("回踩模块的三类条件配方数量与 id 序列不变", () => {
    const spec = createDefaultResearchModuleRegistry().require("PULLBACK_EFFECTIVENESS");
    expect(spec.guardRecipes.map(recipe => recipe.id)).toEqual(["guard_open", "guard_low"]);
    expect(spec.controlRecipes.map(recipe => recipe.id)).toEqual(["control_broke_open", "control_broke_low"]);
    expect(spec.refinementRecipes.map(recipe => recipe.id)).toEqual([
      "shrink_50",
      "shrink_30",
      "last_expansion",
      "last_bullish",
      "above_event_close",
      "depth_shallow",
      "depth_normal",
      "depth_deep",
    ]);
  });

  it("回踩模块的展示名走 moduleLabel（不随模式名漂移）", () => {
    const spec = createDefaultResearchModuleRegistry().require("PULLBACK_EFFECTIVENESS");
    expect(spec.label).toBe("回踩有效性研究");
    expect(spec.label).not.toBe(FIRST_LIMIT_PULLBACK_HOLD_SHRINK.label);
  });

  it("守卫条件在求值日合法时产出「窗口布尔 == 1」的行", () => {
    const spec = createDefaultResearchModuleRegistry().require("PULLBACK_EFFECTIVENESS");
    const guard = spec.guardRecipes[0];
    const rows = guard.build({
      offset: 2,
      observationMaxOffset: 5,
      pathHorizons: [1, 2, 3],
      outcomeHorizons: [1, 2, 3, 5],
    });
    expect(rows).toEqual([
      { groupNo: 0, sortOrder: 0, fieldName: "pullback_holds_event_open_2d", operator: "==", value: 1, logicalOperator: "AND", groupLogicalOperator: "AND" },
    ]);
    // 数据集无 post 数据 ⇒ 该配方不支持，返回 null（不降级成无条件分析）
    expect(guard.build({ offset: 2, observationMaxOffset: 0, pathHorizons: [], outcomeHorizons: [] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. 门槛行为（三支可辨）
// ---------------------------------------------------------------------------

describe("PATTERN-LIBRARY-001 · 门槛行为（方向与条件性启用）", () => {
  const baseline = {
    securityId: "sec_test_0001",
    date: "2026-01-05",
    features: { haircutFromEventLow: -0.01, volumeRatio: 0.4, isBullish: 1, momentumFromEventClose: 0.03 },
  };

  it("门槛全过 ⇒ 产出信号（value = 排序特征）", () => {
    const runtime = resolveStrategyRecipeById(PULLBACK_RECIPE_ID);
    const builder = runtime.buildSignalBuilder({ max_volume_ratio: 0.5, max_drawdown: 0.02, require_bullish: 0 });
    const signal = builder(baseline);
    expect(signal).not.toBeNull();
    expect(signal?.value).toBeCloseTo(0.03, 10);
  });

  it("守线失败（回撤超过阈值）⇒ 剔除", () => {
    const runtime = resolveStrategyRecipeById(PULLBACK_RECIPE_ID);
    const builder = runtime.buildSignalBuilder({ max_volume_ratio: 0.5, max_drawdown: 0.02, require_bullish: 0 });
    expect(
      builder({ ...baseline, features: { ...baseline.features, haircutFromEventLow: 0.05 } }),
    ).toBeNull();
  });

  it("缩量失败 ⇒ 剔除", () => {
    const runtime = resolveStrategyRecipeById(PULLBACK_RECIPE_ID);
    const builder = runtime.buildSignalBuilder({ max_volume_ratio: 0.3, max_drawdown: 0.02, require_bullish: 0 });
    expect(
      builder({ ...baseline, features: { ...baseline.features, volumeRatio: 0.9 } }),
    ).toBeNull();
  });

  it("「红盘」门槛仅在 require_bullish >= 1 时启用（条件性启用未被压成恒启用）", () => {
    const runtime = resolveStrategyRecipeById(PULLBACK_RECIPE_ID);
    const nonBullish = { ...baseline, features: { ...baseline.features, isBullish: 0 } };
    // 不要求红盘 ⇒ 非阳线仍可入选
    expect(runtime.buildSignalBuilder({ max_volume_ratio: 0.5, max_drawdown: 0.02, require_bullish: 0 })(nonBullish)).not.toBeNull();
    // 要求红盘 ⇒ 非阳线被剔除
    expect(runtime.buildSignalBuilder({ max_volume_ratio: 0.5, max_drawdown: 0.02, require_bullish: 1 })(nonBullish)).toBeNull();
  });

  it("空参数集 ⇒ 先抛第一个声明参数（与迁移前的取值顺序一致）", () => {
    const runtime = resolveStrategyRecipeById(PULLBACK_RECIPE_ID);
    expect(() => runtime.buildSignalBuilder({})).toThrowError(/max_volume_ratio/);
  });
});

// ---------------------------------------------------------------------------
// 3. 声明库自洽
// ---------------------------------------------------------------------------

describe("PATTERN-LIBRARY-001 · 声明库自洽", () => {
  it("patternId 唯一，且每个模式至少有一侧投影", () => {
    const ids = ALL_TRADING_PATTERNS.map(pattern => pattern.patternId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pattern of ALL_TRADING_PATTERNS) {
      expect(pattern.research !== null || pattern.execution !== null).toBe(true);
    }
  });

  it("research.moduleKey 与 execution.recipeId 各自唯一", () => {
    const moduleKeys = ALL_TRADING_PATTERNS.flatMap(pattern => (pattern.research === null ? [] : [pattern.research.moduleKey]));
    const recipeIds = ALL_TRADING_PATTERNS.flatMap(pattern => (pattern.execution === null ? [] : [pattern.execution.recipeId]));
    expect(new Set(moduleKeys).size).toBe(moduleKeys.length);
    expect(new Set(recipeIds).size).toBe(recipeIds.length);
  });

  it("双栖模式的 patternId 与 recipeId 同域（便于反查）", () => {
    for (const pattern of ALL_TRADING_PATTERNS) {
      if (pattern.research !== null && pattern.execution !== null) {
        expect(pattern.execution.recipeId).toBe(pattern.patternId);
      }
    }
  });

  it("gated 配方的门槛引用特征必须在其产出面内；rankFeature 同理", () => {
    for (const pattern of ALL_TRADING_PATTERNS) {
      const execution = pattern.execution;
      if (execution === null || execution.signalKind !== "gated") continue;
      const produced = new Set(execution.features);
      for (const gate of execution.gates) {
        expect(produced.has(gate.feature)).toBe(true);
      }
      expect(produced.has(execution.rankFeature)).toBe(true);
    }
  });

  it("weighted 配方的权重特征必须非空且不重复", () => {
    for (const pattern of ALL_TRADING_PATTERNS) {
      const execution = pattern.execution;
      if (execution === null || execution.signalKind !== "weighted") continue;
      const keys = execution.weights.map(item => item.feature);
      expect(keys.length).toBeGreaterThan(0);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("门槛引用的参数键必须在 parameters 里声明（含 enabledWhen）", () => {
    for (const pattern of ALL_TRADING_PATTERNS) {
      const execution = pattern.execution;
      if (execution === null || execution.signalKind !== "gated") continue;
      const declared = new Set(execution.parameters.map(item => item.key));
      for (const gate of execution.gates) {
        if (gate.bound.kind === "parameter") expect(declared.has(gate.bound.parameter)).toBe(true);
        if (gate.enabledWhen !== undefined) expect(declared.has(gate.enabledWhen.parameter)).toBe(true);
      }
    }
  });

  it("参数名唯一，且 declaration.name 与 name 字段一致", () => {
    for (const pattern of ALL_TRADING_PATTERNS) {
      const execution = pattern.execution;
      if (execution === null) continue;
      const names = execution.parameters.map(item => item.name);
      expect(new Set(names).size).toBe(names.length);
      for (const item of execution.parameters) {
        expect(item.declaration.name).toBe(item.name);
      }
    }
  });

  it("requireTradingPattern 对未知 id 抛错并列出已声明清单", () => {
    expect(() => requireTradingPattern("no-such-pattern")).toThrowError(/未知交易模式/);
    expect(requireTradingPattern(PULLBACK_RECIPE_ID).patternId).toBe(PULLBACK_RECIPE_ID);
  });
});

// ---------------------------------------------------------------------------
// 4. 词表一致性（project.ts 刻意不做运行时校验，落点在这里）
// ---------------------------------------------------------------------------

describe("PATTERN-LIBRARY-001 · sketch 词表一致性", () => {
  it("每个 sketch.event 都在策略侧事件词表内", () => {
    for (const pattern of ALL_TRADING_PATTERNS) {
      if (pattern.sketch === undefined || pattern.sketch === null) continue;
      expect(STRATEGY_EVENT_TYPES as readonly string[]).toContain(pattern.sketch.event);
    }
  });

  it("每个 sketch.timing 都在入场时点映射表内", () => {
    for (const pattern of ALL_TRADING_PATTERNS) {
      if (pattern.sketch === undefined || pattern.sketch === null) continue;
      expect(Object.keys(ENTRY_TIMING_TO_EXECUTION)).toContain(pattern.sketch.timing);
    }
  });

  it("每个 sketch.trigger 都在策略侧触发词表内", () => {
    for (const pattern of ALL_TRADING_PATTERNS) {
      if (pattern.sketch === undefined || pattern.sketch === null) continue;
      expect(STRATEGY_TRIGGER_TYPES as readonly string[]).toContain(pattern.sketch.trigger);
    }
  });

  it("每个 sketch.observationWindow 的 unit 在策略侧窗口单位词表内", () => {
    for (const pattern of ALL_TRADING_PATTERNS) {
      if (pattern.sketch === undefined || pattern.sketch === null) continue;
      expect(["TRADING_DAY", "CALENDAR_DAY"]).toContain(pattern.sketch.observationWindow.unit);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. 候选草图投影
// ---------------------------------------------------------------------------

describe("PATTERN-LIBRARY-001 · 候选草图投影", () => {
  it("双栖模式可投影：event / timing / window / recipe 齐备", () => {
    const sketch = projectCandidateSketch(FIRST_LIMIT_PULLBACK_HOLD_SHRINK);
    expect(sketch).not.toBeNull();
    expect(sketch?.entryRule.event).toBe("FIRST_LIMIT_UP");
    expect(sketch?.entryRule.timing).toBe("NEXT_OPEN");
    expect(sketch?.entryRule.extra.observationWindow).toEqual({ start: 2, end: 2, unit: "TRADING_DAY" });
    expect(sketch?.entryRule.extra.recipe.recipeId).toBe(PULLBACK_RECIPE_ID);
    expect(sketch?.notes.length).toBeGreaterThan(0);
  });

  it("草图带 `trigger`（漏它会直接让 promote 抛 PROMOTE_SKETCH_INCOMPLETE —— 真机实测）", () => {
    const sketch = projectCandidateSketch(FIRST_LIMIT_PULLBACK_HOLD_SHRINK);
    expect(sketch?.entryRule.extra.trigger).toBe("FIRST_VALID_DAY");
  });

  it("草图自带执行假设与事件参数（文档级默认，与模式正交）", () => {
    const sketch = projectCandidateSketch(FIRST_LIMIT_PULLBACK_HOLD_SHRINK);
    const extra = sketch?.entryRule.extra as Record<string, unknown> | undefined;
    expect(extra?.execution).toBeDefined();
    expect(extra?.position).toBeDefined();
    expect(extra?.risk).toBeDefined();
    expect(extra?.document).toBeDefined();
    expect(extra?.eventParams).toBeDefined();
  });

  it("草图自带 exitRule / riskRule（漏它们 promote 会抛 PROMOTE_SKETCH_INCOMPLETE —— 真机实测）", () => {
    const sketch = projectCandidateSketch(FIRST_LIMIT_PULLBACK_HOLD_SHRINK);
    expect(sketch?.exitRule).toBeDefined();
    expect(sketch?.riskRule).toBeDefined();
    expect(Object.keys(sketch?.exitRule ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(sketch?.riskRule ?? {}).length).toBeGreaterThan(0);
  });

  it("草图缺省时不生成 filterRule（避免把两套条件文法强行互译）", () => {
    const sketch = projectCandidateSketch(FIRST_LIMIT_PULLBACK_HOLD_SHRINK);
    expect(Object.keys(sketch ?? {})).not.toContain("filterRule");
  });

  it("草图的 recipe.featureVersions 与配方真实产出的特征逐项一致", () => {
    const recipe = projectRecipeReference(FIRST_LIMIT_PULLBACK_HOLD_SHRINK);
    const runtime = resolveStrategyRecipeById(PULLBACK_RECIPE_ID);
    expect(recipe).not.toBeNull();
    expect(recipe?.featureVersions.map(item => item.featureId).sort()).toEqual(
      runtime.features.map(feature => feature.featureId).sort(),
    );
    expect(recipe?.featureVersions.map(item => item.featureId)).toContain(PULLBACK_FEATURE_IDS.haircut);
  });

  it("featureVersions 按 featureId 升序（与 StrategyRecipe 契约一致）", () => {
    const recipe = projectRecipeReference(FIRST_LIMIT_PULLBACK_HOLD_SHRINK);
    const ids = recipe?.featureVersions.map(item => item.featureId) ?? [];
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("纯研究模式返回 null（没有可跑配方）", () => {
    const researchOnly = ALL_TRADING_PATTERNS.find(pattern => pattern.execution === null);
    expect(researchOnly).toBeDefined();
    expect(projectCandidateSketch(researchOnly as TradingPatternSpec)).toBeNull();
  });

  it("有执行形态但缺 sketch 的模式返回 null（不编默认窗口）", () => {
    const noSketch: TradingPatternSpec = {
      ...FIRST_LIMIT_PULLBACK_HOLD_SHRINK,
      patternId: "synthetic-no-sketch",
      sketch: null,
    };
    expect(projectCandidateSketch(noSketch)).toBeNull();
  });

  it("投影出的 recipe 能通过装配层解析（这是「进回测」的必经关卡）", () => {
    const sketch = projectCandidateSketch(FIRST_LIMIT_PULLBACK_HOLD_SHRINK);
    const recipe = sketch?.entryRule.extra.recipe;
    expect(recipe).toBeDefined();
    if (recipe === undefined) throw new Error("夹具前提不成立");
    // `resolveStrategyRecipe` 会校验 kind / 已注册 / featureVersions / point / signalFrequency
    // 五项。任一项不符 ⇒ 回测根本起不来（症状是「策略一条信号都没有」或直接抛错）。
    expect(() => resolveStrategyRecipe(recipe)).not.toThrow();
    expect(resolveStrategyRecipe(recipe).recipeId).toBe(PULLBACK_RECIPE_ID);
  });

  it("缺 recipe 的候选（不传 patternId 的旧路径）仍会被装配层兜底 —— 证明这一步是必需的", () => {
    const sketch = projectCandidateSketch(FIRST_LIMIT_PULLBACK_HOLD_SHRINK);
    const recipe = sketch?.entryRule.extra.recipe;
    // 去掉 recipe 后，装配层将落到 DEFAULT_STRATEGY_RECIPE_ID（按涨跌幅取前 5 名）
    // ⇒ 用户研究出来的「守线 + 缩量」条件进不了回测。这正是本轮接线要堵的洞。
    const stripped = { ...recipe, recipeId: "__not_registered__" };
    expect(() => resolveStrategyRecipe(stripped as typeof recipe)).toThrowError(/未在本层注册/);
  });

  it("窗口非法 ⇒ 抛错（而不是夹取或静默放行）", () => {
    const badWindow: TradingPatternSpec = {
      ...FIRST_LIMIT_PULLBACK_HOLD_SHRINK,
      patternId: "synthetic-bad-window",
      sketch: {
        event: "FIRST_LIMIT_UP",
        timing: "NEXT_OPEN",
        observationWindow: { start: 0, end: 2, unit: "TRADING_DAY" },
      },
    };
    expect(() => projectCandidateSketch(badWindow)).toThrowError(/observationWindow 必须满足/);
  });
});

// ---------------------------------------------------------------------------
// 6. parameterRole 生效
// ---------------------------------------------------------------------------

describe("PATTERN-LIBRARY-001 · parameterRole 真正生效", () => {
  it("tunable 参数投影为 TUNABLE，并进搜索空间", () => {
    const space = projectSketchParameterSpace(FIRST_LIMIT_PULLBACK_HOLD_SHRINK);
    expect(space.max_volume_ratio?.parameterRole).toBe("TUNABLE");
    expect(projectParameterSpace(FIRST_LIMIT_PULLBACK_HOLD_SHRINK).parameters).toHaveLength(3);
  });

  it("role=fixed 的参数投影为 FIXED，且**不进**搜索空间（P1-1 的对症修法）", () => {
    const pattern = FIRST_LIMIT_PULLBACK_HOLD_SHRINK;
    const execution = pattern.execution;
    if (execution === null || execution.signalKind !== "gated") throw new Error("夹具前提不成立");
    const frozen: TradingPatternSpec = {
      ...pattern,
      patternId: "synthetic-frozen-param",
      execution: {
        ...execution,
        parameters: execution.parameters.map(item =>
          item.key === "maxVolumeRatio" ? { ...item, role: "fixed" as const } : item,
        ),
      },
    };
    expect(projectSketchParameterSpace(frozen).max_volume_ratio?.parameterRole).toBe("FIXED");
    const names = projectParameterSpace(frozen).parameters.map(item => item.name);
    expect(names).not.toContain("max_volume_ratio");
    expect(names).toEqual(["max_drawdown", "require_bullish"]);
  });

  it("缺 min/max/step 的数值参数不进搜索空间（不猜边界）", () => {
    const space = projectParameterSpace(requireTradingPattern("leader-candidate-baseline"));
    expect(space.parameters).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. 纯执行 / 纯研究模式
// ---------------------------------------------------------------------------

describe("PATTERN-LIBRARY-001 · 单栖模式", () => {
  it("基准配方是纯执行模式：无研究模块，但有可用配方", () => {
    const pattern = requireTradingPattern("leader-candidate-baseline");
    expect(pattern.research).toBeNull();
    expect(projectResearchModule(pattern)).toBeNull();
    expect(projectRecipeReference(pattern)?.recipeId).toBe("leader-candidate-baseline");
  });

  it("纯研究模式：有研究模块，但无配方引用", () => {
    const pattern = requireTradingPattern("event-return-research");
    expect(pattern.execution).toBeNull();
    expect(projectResearchModule(pattern)?.key).toBe("EVENT_RETURN_RESEARCH");
    expect(projectRecipeReference(pattern)).toBeNull();
  });
});
