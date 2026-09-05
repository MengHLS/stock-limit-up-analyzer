/**
 * STEP 10 — Strategy Research Framework 测试。
 *
 * 覆盖（对应 STEP 10 完成标准）：
 *   - strategy version（契约校验 + 版本不可变）
 *   - experiment serialization（round-trip）
 *   - universe as-of（getUniverse 按日期，缺失 FAIL FAST，不回退当前列表）
 *   - feature availability（声明校验 + 泄漏守卫）
 *   - signal generation（value/direction/confidence、特征缺失 → null）
 *   - ranking（cross-sectional、NaN/missing、ties、winsorization）
 *   - selection（topN / topPercentile）
 *   - missing data（FAIL FAST + 剔除）
 *   - NaN（校验/序列化拒绝）
 *   - determinism（相同输入 → 相同输出）
 *   - look-ahead rejection（availableAt > decisionTime → 拒绝）
 */

import { describe, expect, it } from "vitest";

import type { CanonicalMarketBar } from "../../data";
import type { CostModel } from "../../engine/domain";
import {
  compareDecisionTime,
  LeakageGuard,
  LookAheadError,
  StaticUniverseProvider,
  MapUniverseProvider,
  deserializeExperimentConfig,
  deserializeStrategyContract,
  directionFromValue,
  makeBarFeatureProvider,
  makeWeightedSignalBuilder,
  rankSignals,
  runResearchPipeline,
  sameDayAvailability,
  selectCandidates,
  serializeExperimentConfig,
  serializeStrategyContract,
  validateExperimentConfig,
  validateRankingConfig,
  validateResearchSignal,
  validateSelectionConfig,
  validateStrategyContract,
  winsorize,
  type DecisionTime,
  type ExperimentConfig,
  type FeatureProvider,
  type RankInput,
  type ResearchDataSource,
  type ResearchPipelineInput,
  type StrategyContract,
} from "./index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

function bar(symbol: string, timestamp: string, close: number, amount = 1000): CanonicalMarketBar {
  return {
    symbol,
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    preClose: close,
    volume: 100,
    amount,
    turnoverRate: null,
    adjustment: "raw",
  };
}

function closeFeatureProvider(decisionTime: DecisionTime): FeatureProvider {
  return makeBarFeatureProvider({
    featureId: "lastClose",
    version: "1.0.0",
    availability: sameDayAvailability(decisionTime, "close", "close"),
    compute: (bars) => (bars.length > 0 ? (bars[bars.length - 1]!.close) : null),
  });
}

function makeStrategy(requiredData: readonly string[] = ["OHLCV"]): StrategyContract {
  return {
    strategyId: "leader-candidate-research",
    strategyVersion: "1.0.0",
    name: "龙头候选研究策略",
    description: "仅用于 STEP 10 框架测试。",
    parameters: { parameters: [{ name: "topN", type: "number", required: true, min: 1 }] },
    requiredData,
    signalFrequency: "daily",
  };
}

function makeConfig(strategy: StrategyContract, randomSeed = 42): ExperimentConfig {
  return {
    datasetVersion: "dataset-v1",
    strategyId: strategy.strategyId,
    strategyVersion: strategy.strategyVersion,
    parameters: { topN: 2 },
    universe: { universeId: "test-universe" },
    dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
    costModel: COST_MODEL,
    randomSeed,
  };
}

function makeDataSource(barsBySymbol: Record<string, readonly CanonicalMarketBar[]>, availableData: readonly string[] = ["OHLCV"]): ResearchDataSource {
  return {
    availableData,
    getBars: (securityId) => barsBySymbol[securityId] ?? null,
  };
}

const DECISION_TIME: DecisionTime = { date: "2026-01-02", point: "close" };

// ---------------------------------------------------------------------------
// Strategy Contract
// ---------------------------------------------------------------------------

describe("Strategy Contract", () => {
  it("通过完整契约校验", () => {
    expect(validateStrategyContract(makeStrategy()).valid).toBe(true);
  });

  it("拒绝空 strategyVersion（版本不可变）", () => {
    const result = validateStrategyContract({ ...makeStrategy(), strategyVersion: "" });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "STRATEGY_VERSION_EMPTY")).toBe(true);
  });

  it("拒绝非法 signalFrequency", () => {
    const result = validateStrategyContract({ ...makeStrategy(), signalFrequency: "hourly" as never });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "STRATEGY_SIGNAL_FREQUENCY_INVALID")).toBe(true);
  });

  it("拒绝含空串或缺失的 requiredData", () => {
    const emptyEntry = validateStrategyContract({ ...makeStrategy(), requiredData: [""] });
    expect(emptyEntry.valid).toBe(false);
    expect(emptyEntry.issues.some((i) => i.code === "STRATEGY_REQUIRED_DATA_INVALID")).toBe(true);

    const missing = validateStrategyContract({ ...makeStrategy(), requiredData: undefined as never });
    expect(missing.valid).toBe(false);
    expect(missing.issues.some((i) => i.code === "STRATEGY_REQUIRED_DATA_INVALID")).toBe(true);
  });

  it("版本字符串序列化 round-trip 后保持不变", () => {
    const original = makeStrategy();
    const restored = deserializeStrategyContract(serializeStrategyContract(original));
    expect(restored.strategyVersion).toBe("1.0.0");
    expect(restored).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Experiment Serialization
// ---------------------------------------------------------------------------

describe("Experiment Config serialization", () => {
  it("round-trip 保持语义一致", () => {
    const config = makeConfig(makeStrategy());
    const restored = deserializeExperimentConfig(serializeExperimentConfig(config));
    expect(restored).toEqual(config);
  });

  it("拒绝序列化 NaN", () => {
    const config = { ...makeConfig(makeStrategy()), randomSeed: Number.NaN };
    expect(() => serializeExperimentConfig(config)).toThrow();
  });

  it("拒绝非整数 randomSeed", () => {
    const result = validateExperimentConfig({ ...makeConfig(makeStrategy()), randomSeed: 1.5 });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "CONFIG_RANDOM_SEED_INVALID")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Universe as-of
// ---------------------------------------------------------------------------

describe("Universe as-of", () => {
  it("StaticUniverseProvider 返回排序去重成员", () => {
    const universe = new StaticUniverseProvider("u1", ["B", "A", "A"]);
    expect(universe.getUniverse("2026-01-01")).toEqual(["A", "B"]);
  });

  it("MapUniverseProvider 按 as-of 日期返回成员", () => {
    const universe = new MapUniverseProvider("u1", {
      "2026-01-02": ["A", "B"],
      "2026-01-03": ["A", "C"],
    });
    expect(universe.getUniverse("2026-01-02")).toEqual(["A", "B"]);
    expect(universe.getUniverse("2026-01-03")).toEqual(["A", "C"]);
  });

  it("MapUniverseProvider 无当日成员定义时 FAIL FAST，不回退当前列表", () => {
    const universe = new MapUniverseProvider("u1", { "2026-01-02": ["A"] });
    expect(() => universe.getUniverse("2026-01-04")).toThrow(/禁止回退到当前股票列表/);
  });
});

// ---------------------------------------------------------------------------
// Feature availability + Leakage Guard
// ---------------------------------------------------------------------------

describe("Feature availability + Leakage Guard", () => {
  it("compareDecisionTime 正确比较 open/close 与跨日", () => {
    expect(compareDecisionTime({ date: "2026-01-02", point: "open" }, { date: "2026-01-02", point: "close" })).toBe(-1);
    expect(compareDecisionTime({ date: "2026-01-02", point: "close" }, { date: "2026-01-02", point: "close" })).toBe(0);
    expect(compareDecisionTime({ date: "2026-01-03", point: "open" }, { date: "2026-01-02", point: "close" })).toBe(1);
  });

  it("availableAt <= decisionTime 通过泄漏守卫", () => {
    const availability = sameDayAvailability(DECISION_TIME, "close", "close");
    expect(() => LeakageGuard.assertNoLookAhead("f", availability, DECISION_TIME)).not.toThrow();
  });

  it("availableAt > decisionTime 拒绝（未来函数）", () => {
    const availability = {
      requiredDataThrough: DECISION_TIME,
      availableAt: { date: "2026-01-03", point: "open" } as DecisionTime,
    };
    expect(() => LeakageGuard.assertNoLookAhead("f", availability, DECISION_TIME)).toThrow(LookAheadError);
  });

  it("requiredDataThrough > decisionTime 拒绝（数据尚未可得）", () => {
    const availability = {
      requiredDataThrough: { date: "2026-01-03", point: "close" } as DecisionTime,
      availableAt: DECISION_TIME,
    };
    expect(() => LeakageGuard.assertNoLookAhead("f", availability, DECISION_TIME)).toThrow(LookAheadError);
  });
});

// ---------------------------------------------------------------------------
// Signal generation
// ---------------------------------------------------------------------------

describe("Signal generation", () => {
  it("加权构造器产出 value + direction", () => {
    const builder = makeWeightedSignalBuilder({ a: 1, b: -1 });
    const signal = builder({ securityId: "A", date: "2026-01-02", features: { a: 10, b: 4 } });
    expect(signal).toEqual({ securityId: "A", date: "2026-01-02", value: 6, direction: "long" });
  });

  it("value < 0 → short；value = 0 → neutral", () => {
    expect(directionFromValue(-1)).toBe("short");
    expect(directionFromValue(0)).toBe("neutral");
    expect(directionFromValue(1)).toBe("long");
  });

  it("权重特征缺失 → null（禁止静默填零）", () => {
    const builder = makeWeightedSignalBuilder({ a: 1, b: 1 });
    expect(builder({ securityId: "A", date: "2026-01-02", features: { a: 10, b: null } })).toBeNull();
  });

  it("信号 value 非有限被校验拒绝", () => {
    const result = validateResearchSignal({ securityId: "A", date: "2026-01-02", value: Number.NaN, direction: "long" });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "SIGNAL_VALUE_NOT_FINITE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

describe("Ranking (cross-sectional)", () => {
  it("基础横截面排序（higherIsBetter）", () => {
    const input: RankInput[] = [
      { securityId: "A", value: 10 },
      { securityId: "B", value: 30 },
      { securityId: "C", value: 20 },
    ];
    const ranked = rankSignals(input, { higherIsBetter: true, tieBreaking: "stable" });
    expect(ranked.find((r) => r.securityId === "B")!.rank).toBe(1);
    expect(ranked.find((r) => r.securityId === "C")!.rank).toBe(2);
    expect(ranked.find((r) => r.securityId === "A")!.rank).toBe(3);
    expect(ranked.find((r) => r.securityId === "B")!.percentile).toBeCloseTo(1, 10);
    expect(ranked.find((r) => r.securityId === "A")!.percentile).toBeCloseTo(1 / 3, 10);
  });

  it("higherIsBetter=false 时值越小 rank 越优", () => {
    const ranked = rankSignals(
      [
        { securityId: "A", value: 10 },
        { securityId: "B", value: 20 },
      ],
      { higherIsBetter: false },
    );
    expect(ranked.find((r) => r.securityId === "A")!.rank).toBe(1);
    expect(ranked.find((r) => r.securityId === "B")!.rank).toBe(2);
  });

  it("并列值 average 平均秩", () => {
    const ranked = rankSignals(
      [
        { securityId: "A", value: 10 },
        { securityId: "B", value: 10 },
        { securityId: "C", value: 20 },
      ],
      { higherIsBetter: true, tieBreaking: "average" },
    );
    expect(ranked.find((r) => r.securityId === "C")!.rank).toBe(1);
    expect(ranked.find((r) => r.securityId === "A")!.rank).toBeCloseTo(2.5, 10);
    expect(ranked.find((r) => r.securityId === "B")!.rank).toBeCloseTo(2.5, 10);
  });

  it("并列值 stable 稳定顺序", () => {
    const ranked = rankSignals(
      [
        { securityId: "A", value: 10 },
        { securityId: "B", value: 10 },
        { securityId: "C", value: 20 },
      ],
      { higherIsBetter: true, tieBreaking: "stable" },
    );
    expect(ranked.find((r) => r.securityId === "A")!.rank).toBe(2);
    expect(ranked.find((r) => r.securityId === "B")!.rank).toBe(3);
  });

  it("NaN/missing exclude：不参与也不给秩", () => {
    const ranked = rankSignals(
      [
        { securityId: "A", value: 10 },
        { securityId: "B", value: null },
        { securityId: "C", value: Number.NaN },
        { securityId: "D", value: 5 },
      ],
      { higherIsBetter: true, missingPolicy: "exclude" },
    );
    expect(ranked.find((r) => r.securityId === "A")!.rank).toBe(1);
    expect(ranked.find((r) => r.securityId === "D")!.rank).toBe(2);
    expect(ranked.find((r) => r.securityId === "B")!.rank).toBeNull();
    expect(ranked.find((r) => r.securityId === "C")!.rank).toBeNull();
  });

  it("NaN/missing rankLast：排在有效值之后", () => {
    const ranked = rankSignals(
      [
        { securityId: "A", value: 10 },
        { securityId: "B", value: null },
        { securityId: "D", value: 5 },
      ],
      { higherIsBetter: true, missingPolicy: "rankLast" },
    );
    expect(ranked.find((r) => r.securityId === "A")!.rank).toBe(1);
    expect(ranked.find((r) => r.securityId === "D")!.rank).toBe(2);
    expect(ranked.find((r) => r.securityId === "B")!.rank).toBe(3);
  });

  it("winsorization 缩尾夹住极值", () => {
    const ranked = rankSignals(
      [
        { securityId: "A", value: 1 },
        { securityId: "B", value: 2 },
        { securityId: "C", value: 100 },
      ],
      { higherIsBetter: true, tieBreaking: "stable", winsorization: { lowerQuantile: 0, upperQuantile: 0.5 } },
    );
    // 有限值 [1,2,100]，median=2 → 100 被夹为 2。
    expect(ranked.find((r) => r.securityId === "C")!.winsorizedValue).toBe(2);
    expect(ranked.find((r) => r.securityId === "C")!.value).toBe(100);
  });

  it("winsorize 独立函数夹取极值", () => {
    expect(winsorize([1, 2, 100], 0, 0.5)).toEqual([1, 2, 2]);
  });

  it("重复 securityId 抛错", () => {
    expect(() =>
      rankSignals(
        [
          { securityId: "A", value: 1 },
          { securityId: "A", value: 2 },
        ],
        { higherIsBetter: true },
      ),
    ).toThrow(/重复 securityId/);
  });

  it("校验拒绝非法 ranking 配置", () => {
    expect(validateRankingConfig({ higherIsBetter: true, winsorization: { lowerQuantile: 0.8, upperQuantile: 0.2 } }).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe("Selection", () => {
  const ranked = rankSignals(
    [
      { securityId: "A", value: 40 },
      { securityId: "B", value: 30 },
      { securityId: "C", value: 20 },
      { securityId: "D", value: 10 },
    ],
    { higherIsBetter: true },
  );

  it("topN 取前 n", () => {
    const selected = selectCandidates(ranked, { method: { kind: "topN", n: 2 } });
    expect(selected.map((c) => c.securityId)).toEqual(["A", "B"]);
  });

  it("topPercentile 按分位截取", () => {
    const selected = selectCandidates(ranked, { method: { kind: "topPercentile", pct: 0.5 } });
    // n=4，percentile = 1, 0.75, 0.5, 0.25 → 保留 percentile >= 0.5 的前三名。
    expect(selected.map((c) => c.securityId)).toEqual(["A", "B", "C"]);
  });

  it("缺失/NaN 绝不选中", () => {
    const withMissing = rankSignals(
      [
        { securityId: "A", value: 10 },
        { securityId: "B", value: null },
      ],
      { higherIsBetter: true, missingPolicy: "rankLast" },
    );
    const selected = selectCandidates(withMissing, { method: { kind: "topN", n: 2 } });
    expect(selected.map((c) => c.securityId)).toEqual(["A"]);
  });

  it("校验拒绝非法 selection 配置", () => {
    expect(validateSelectionConfig({ method: { kind: "topN", n: 0 } }).valid).toBe(false);
    expect(validateSelectionConfig({ method: { kind: "topPercentile", pct: 1.5 } }).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

describe("Research Pipeline", () => {
  const strategy = makeStrategy();
  const config = makeConfig(strategy);
  const universe = new StaticUniverseProvider("test-universe", ["A", "B", "C", "D"]);
  const dataSource = makeDataSource({
    A: [bar("A", "2026-01-01", 10), bar("A", "2026-01-02", 12)],
    B: [bar("B", "2026-01-01", 20), bar("B", "2026-01-02", 25)],
    C: [bar("C", "2026-01-01", 30), bar("C", "2026-01-02", 18)],
    D: [bar("D", "2026-01-01", 5), bar("D", "2026-01-02", 6)],
  });
  const featureProviders = [closeFeatureProvider(DECISION_TIME)];
  const signalBuilder = makeWeightedSignalBuilder({ lastClose: 1 });
  const rankingConfig = { higherIsBetter: true } as const;
  const selectionConfig = { method: { kind: "topN", n: 2 } } as const;

  function buildInput(): ResearchPipelineInput {
    return {
      strategy,
      config,
      decisionTime: DECISION_TIME,
      universe,
      featureProviders,
      signalBuilder,
      rankingConfig,
      selectionConfig,
      dataSource,
    };
  }

  it("端到端：Universe → Features → Signal → Ranking → Selection → Position Intent", () => {
    const result = runResearchPipeline(buildInput());
    // closes: A=12, B=25, C=18, D=6 → 排序 B(1), C(2), A(3), D(4)。
    expect(result.signals.map((s) => s.securityId).sort()).toEqual(["A", "B", "C", "D"]);
    expect(result.ranked.find((r) => r.securityId === "B")!.rank).toBe(1);
    expect(result.selected.map((c) => c.securityId)).toEqual(["B", "C"]);
    expect(result.positionIntents).toHaveLength(2);
    expect(result.positionIntents[0]!.weight).toBeCloseTo(0.5, 10);
    expect(result.positionIntents[1]!.weight).toBeCloseTo(0.5, 10);
    expect(result.dropped).toEqual([]);
  });

  it("determinism：相同输入两次运行输出一致", () => {
    const first = runResearchPipeline(buildInput());
    const second = runResearchPipeline(buildInput());
    expect(first).toEqual(second);
  });

  it("missing data：requiredData 不在数据源 → FAIL FAST", () => {
    const strictStrategy = makeStrategy(["OHLCV", "Turnover"]);
    const input = { ...buildInput(), strategy: strictStrategy, config: makeConfig(strictStrategy) };
    expect(() => runResearchPipeline(input)).toThrow(/所需数据域缺失：Turnover/);
  });

  it("look-ahead rejection：特征 availableAt > decisionTime → 抛错", () => {
    const lookAheadProvider = makeBarFeatureProvider({
      featureId: "nextOpen",
      version: "1.0.0",
      availability: {
        requiredDataThrough: { date: "2026-01-03", point: "open" },
        availableAt: { date: "2026-01-03", point: "open" },
      },
      compute: () => 1,
    });
    const input = { ...buildInput(), featureProviders: [lookAheadProvider] };
    expect(() => runResearchPipeline(input)).toThrow(LookAheadError);
  });

  it("无 bars 的证券被剔除并记录原因", () => {
    const input = buildInput();
    const withGap = { ...input, dataSource: makeDataSource({ ...dataSource, D: undefined as never }) };
    // D 无数据 → NO_BARS。
    const result = runResearchPipeline(withGap);
    expect(result.dropped.some((d) => d.securityId === "D" && d.reason === "NO_BARS")).toBe(true);
  });

  it("未来 bar 不泄漏进特征值", () => {
    // FUT 在决策日（01-02 close）之后还有 01-03 的 bar，特征只能用 01-02 及以前。
    const universeWithFut = new StaticUniverseProvider("test-universe", ["FUT"]);
    const dataSourceWithFut = makeDataSource({
      FUT: [bar("FUT", "2026-01-02", 100), bar("FUT", "2026-01-03", 999)],
    });
    const input = { ...buildInput(), universe: universeWithFut, dataSource: dataSourceWithFut };
    const result = runResearchPipeline(input);
    expect(result.signals.find((s) => s.securityId === "FUT")!.value).toBe(100);
  });
});
