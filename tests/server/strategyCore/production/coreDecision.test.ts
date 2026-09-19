/**
 * STRATEGY-ARCH-002 — Core 决策源：正常运行 / 指纹稳定性 / 复现 / Legacy 对比（规格 §14.3 A–F、§15）。
 *
 * 🔴 本文件的「Legacy vs Core」一节的判据**刻意不是「两者相等」**：
 * 实测两者**确实不等**（详见实施报告 §7 / §9），差异已被定位到具体一行语义。
 * 断言写的是「差异的形状」，这样任何一侧被改回去都会立刻变红。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../../server/data";
import {
  StrategyRuntime,
  applyDefinitionChange,
  createStrategyVersion,
  type StrategyCoreDefinition,
} from "../../../../server/strategyCore";
import {
  createCoreDecisionSource,
  createDatasetEventResolver,
  toCoreBarWindow,
} from "../../../../server/strategyCore/production";
import { makeGatedSignalBuilder } from "../../../../server/research/framework/gatedSignal";
import {
  PULLBACK_FEATURE_IDS,
  buildPullbackFeatureProviders,
} from "../../../../server/research/recipeRegistryAtoms";
import { FIXED_CREATED_AT, makePullbackDefinition, makeVersion } from "../_fixtures";

// ---------------------------------------------------------------------------
// 夹具：事件窗（rd0 = 首板日涨停；rd1 缩量不足 + 阴线；rd2/rd3 全部门槛通过）
// ---------------------------------------------------------------------------

function marketBar(
  date: string,
  values: { open: number; high: number; low: number; close: number; preClose: number; volume: number },
): CanonicalMarketBar {
  return {
    symbol: "600001.SH",
    timestamp: date,
    open: values.open,
    high: values.high,
    low: values.low,
    close: values.close,
    preClose: values.preClose,
    volume: values.volume,
    amount: values.volume * 100,
    turnoverRate: null,
    adjustment: "raw",
  } as unknown as CanonicalMarketBar;
}

const EVENT_WINDOW: readonly CanonicalMarketBar[] = [
  marketBar("2026-09-10", { open: 10, high: 11, low: 10, close: 11, preClose: 10, volume: 200_000 }),
  marketBar("2026-09-11", { open: 11, high: 11, low: 10.6, close: 10.8, preClose: 11, volume: 80_000 }),
  marketBar("2026-09-12", { open: 10.9, high: 11.3, low: 10.4, close: 11.2, preClose: 10.8, volume: 60_000 }),
  marketBar("2026-09-15", { open: 11.2, high: 11.6, low: 10.9, close: 11.5, preClose: 11.2, volume: 55_000 }),
];

/** 决策日 rd=k 时的可见 bar（**已 as-of 过滤**，由 pipeline 负责）。 */
function visibleThrough(k: number): readonly CanonicalMarketBar[] {
  return EVENT_WINDOW.slice(0, k + 1);
}

function rollingBars(): {
  readonly k: number;
  readonly bars: readonly CanonicalMarketBar[];
}[] {
  return EVENT_WINDOW.map((_, index) => ({ k: index, bars: visibleThrough(index) }));
}

function makeSource(input: {
  definition?: StrategyCoreDefinition;
  parameterSet?: Record<string, number | boolean | string>;
  version?: string;
  name?: string;
}) {
  const definition = input.definition ?? makePullbackDefinition();
  const version =
    input.version === undefined
      ? makeVersion(definition, input.name === undefined ? {} : { name: input.name })
      : createStrategyVersion({
          strategyId: "first-limit-pullback",
          version: input.version,
          definition,
          metadata: { name: input.name ?? "首板回踩" },
          createdAt: FIXED_CREATED_AT,
          status: "PUBLISHED",
        });
  const parameterSet = input.parameterSet ?? { max_volume_ratio: 0.5 };
  const eventResolver = createDatasetEventResolver({
    eventAnchored: true,
    eventTypes: ["FIRST_LIMIT_UP"],
    limitUpRatio: 0.1,
    declaredBy: "test",
  });
  const source = createCoreDecisionSource({
    version,
    parameterSet,
    rankFeatureId: "isBullish",
    point: "close",
    eventResolver,
    eventTypes: ["FIRST_LIMIT_UP"],
  });
  return { version, parameterSet, eventResolver, source };
}

/** 跑一遍全部决策日，返回「出信号的日子」与信号值。 */
function runAllDays(source: ReturnType<typeof makeSource>["source"]): {
  readonly emittedDays: number[];
  readonly values: (number | null)[];
} {
  const emittedDays: number[] = [];
  const values: (number | null)[] = [];
  for (const { k, bars } of rollingBars()) {
    // 逐日可见窗口：pipeline 的语义就是「决策日当天 as-of 过滤后的 bars」
    const features: Record<string, number | null> = {};
    for (const provider of buildPullbackFeatureProviders("close")) {
      features[provider.featureId] = provider.compute({
        securityId: "600001.SH",
        decisionTime: { date: bars[bars.length - 1]!.timestamp, point: "close" },
        data: { symbol: "600001.SH", bars },
      });
    }
    const signal = source.signalBuilder({
      securityId: "600001.SH",
      date: bars[bars.length - 1]!.timestamp,
      features,
      bars,
      point: "close",
    });
    if (signal !== null) {
      emittedDays.push(k);
      values.push(signal.value);
    }
  }
  return { emittedDays, values };
}

// ---------------------------------------------------------------------------

describe("Test A — 正常运行：evaluate / Decision / Digest 三件齐备", () => {
  it("rd2（首个全门槛成立日）出信号；rd1 / rd3 不出（FIRST_VALID_DAY 语义）", () => {
    const { source } = makeSource({});
    const run = runAllDays(source);
    expect(run.emittedDays).toEqual([2]);
    const digest = source.digest();
    expect(digest.decisionCount).toBe(4);
    expect(digest.emittedSignalCount).toBe(1);
    expect(digest.occurredEventCount).toBe(4);
    expect(digest.decisionDigestFingerprint).not.toBe("");
    expect(digest.samples.length).toBe(4);
    expect(digest.maxRelativeDayObserved).toBe(3);
    expect(digest.minBarCount).toBe(1);
  });

  it("事件不成立（锚定日不涨停）⇒ 一条信号都不出，且判定可辨（notOccurred≠undecidable）", () => {
    const { source } = makeSource({});
    const notLimitUp = [
      marketBar("2026-09-10", { open: 10, high: 10.3, low: 9.9, close: 10.1, preClose: 10, volume: 200_000 }),
      ...EVENT_WINDOW.slice(1),
    ];
    const features: Record<string, number | null> = {};
    const signal = source.signalBuilder({
      securityId: "600001.SH",
      date: notLimitUp[1]!.timestamp,
      features,
      bars: notLimitUp.slice(0, 2),
      point: "close",
    });
    expect(signal).toBeNull();
    expect(source.digest().notOccurredEventCount).toBe(1);
    expect(source.digest().undecidableAnchorCount).toBe(0);
  });

  it("无 bar ⇒ 计「数据不足」而不是「今天没信号」（可辨）", () => {
    const { source } = makeSource({});
    const signal = source.signalBuilder({
      securityId: "600001.SH",
      date: "2026-09-15",
      features: {},
      bars: [],
      point: "close",
    });
    expect(signal).toBeNull();
    expect(source.digest().insufficientDataCount).toBe(1);
    expect(source.digest().droppedNoSignalCount).toBe(0);
  });

  it("排序特征缺失 ⇒ 有信号但不出（计入 droppedMissingRankValue，不与「无信号」混淆）", () => {
    const { source } = makeSource({});
    const signal = source.signalBuilder({
      securityId: "600001.SH",
      date: "2026-09-12",
      features: { isBullish: null },
      bars: visibleThrough(2),
      point: "close",
    });
    expect(signal).toBeNull();
    expect(source.digest().droppedMissingRankValueCount).toBe(1);
    expect(source.digest().droppedNoSignalCount).toBe(0);
  });

  it("未注入事件判定器 ⇒ 首次求值即响亮抛错（不静默 false）", () => {
    const definition = makePullbackDefinition();
    const version = makeVersion(definition);
    const source = createCoreDecisionSource({
      version,
      parameterSet: { max_volume_ratio: 0.5 },
      rankFeatureId: "isBullish",
      point: "close",
      eventTypes: ["FIRST_LIMIT_UP"],
    });
    expect(() =>
      source.signalBuilder({
        securityId: "600001.SH",
        date: "2026-09-12",
        features: { isBullish: 1 },
        bars: visibleThrough(2),
        point: "close",
      }),
    ).toThrowError(/尚未注入事件判定器/);
  });
});

describe("Test B/C/D/E — 指纹与快照的稳定性（行为面）", () => {
  it("Test B：同版本 + 同参数 + 同数据 ⇒ 定义指纹与决策摘要指纹都逐字节相同", () => {
    const first = makeSource({});
    const second = makeSource({});
    runAllDays(first.source);
    runAllDays(second.source);
    expect(first.version.fingerprint).toBe(second.version.fingerprint);
    const a = first.source.digest();
    const b = second.source.digest();
    expect(a.decisionDigestFingerprint).toBe(b.decisionDigestFingerprint);
    expect(a.emittedSignalCount).toBe(b.emittedSignalCount);
    expect(a.totalConditionCount).toBe(b.totalConditionCount);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  it("Test C：改策略定义（窗口 end 5→6 之外的行为面）⇒ 定义指纹改变", () => {
    const base = makeSource({});
    const changed = makeSource({ definition: makePullbackDefinition({ includeBullishCondition: false }) });
    expect(base.version.fingerprint).not.toBe(changed.version.fingerprint);
  });

  it("Test C2：改定义后「哪些日出信号」也真的变了（指纹变化对应行为变化，不是纯哈希抖动）", () => {
    const withoutBullish = makeSource({ definition: makePullbackDefinition({ includeBullishCondition: false }) });
    expect(runAllDays(withoutBullish.source).emittedDays).toEqual([1]);
  });

  it("Test D：只改**行为参数** ⇒ 定义指纹不变（参数是运行级坐标），但参数本身可辨", () => {
    const loose = makeSource({ parameterSet: { max_volume_ratio: 0.5 } });
    const tight = makeSource({ parameterSet: { max_volume_ratio: 0.15 } });
    expect(loose.version.fingerprint).toBe(tight.version.fingerprint);
    expect(runAllDays(loose.source).emittedDays).toEqual([2]);
    // 阈值收紧到 0.15 后 rd2/rd3 都不满足缩量 ⇒ 一条都不出
    expect(runAllDays(tight.source).emittedDays).toEqual([]);
  });

  it("Test E：只改非行为元数据（name）⇒ 指纹不变", () => {
    const a = makeSource({ name: "首板回踩 A" });
    const b = makeSource({ name: "首板回踩 B（改名不改行为）" });
    expect(a.version.fingerprint).toBe(b.version.fingerprint);
    expect(a.version.metadata.name).not.toBe(b.version.metadata.name);
  });
});

describe("Test F — 复现：同一份配置重跑 ⇒ 决策摘要逐字节相同", () => {
  it("重跑（含重新构造版本对象）⇒ decisionDigestFingerprint 相等", () => {
    const first = makeSource({});
    const second = makeSource({});
    runAllDays(first.source);
    runAllDays(second.source);
    expect(first.source.digest().decisionDigestFingerprint).toBe(
      second.source.digest().decisionDigestFingerprint,
    );
    expect(first.source.resolvedParameterSet().values).toEqual(second.source.resolvedParameterSet().values);
  });

  it("由定义变更产生新版本（applyDefinitionChange）⇒ 旧版本对象本身不变（不可变可断言）", () => {
    const base = makeSource({});
    const changed = applyDefinitionChange(base.version, {
      nextDefinition: makePullbackDefinition({ includeBullishCondition: false }),
      bump: "patch",
      createdAt: FIXED_CREATED_AT,
    });
    expect(changed.kind).toBe("new-version");
    if (changed.kind === "new-version") {
      expect(changed.version.version).toBe("1.0.1");
      expect(changed.version.parentVersionId).toBe("first-limit-pullback@1.0.0");
      // 旧版本对象**未被原地修改**：指纹仍是构造时的那个
      expect(base.version.version).toBe("1.0.0");
      expect(base.version.fingerprint).toBe(makeSource({}).version.fingerprint);
      expect(changed.version.fingerprint).not.toBe(base.version.fingerprint);
    }
    // 行为等价的变更 ⇒ 幂等，不产生空版本
    if (changed.kind === "new-version") {
      const same = applyDefinitionChange(changed.version, {
        nextDefinition: makePullbackDefinition({ includeBullishCondition: false }),
        bump: "patch",
        createdAt: FIXED_CREATED_AT,
      });
      expect(same.kind).toBe("unchanged");
    }
  });
});

describe("§15 — Legacy vs Core 同日对比（**差异必须被定位**，不是抹平）", () => {
  /**
   * legacy 门槛**对齐文档声明的条件**（守线 = haircut ≤ 0 即「未破首板日开盘价」、缩量 ≤ 0.5、红盘）
   * —— 这样两侧唯一的差异就只剩「窗口 / 触发」这一条，差异可被精确定位。
   */
  const legacyGates = [
    { kind: "lte" as const, featureId: PULLBACK_FEATURE_IDS.haircut, bound: 0, label: "守线" },
    { kind: "lte" as const, featureId: PULLBACK_FEATURE_IDS.volumeRatio, bound: 0.5, label: "缩量" },
    { kind: "gte" as const, featureId: PULLBACK_FEATURE_IDS.isBullish, bound: 1, label: "红盘" },
  ];

  function legacyEmittedDays(): number[] {
    const builder = makeGatedSignalBuilder({
      gates: legacyGates,
      rankFeatureId: PULLBACK_FEATURE_IDS.momentum,
    });
    const days: number[] = [];
    for (const { k, bars } of rollingBars()) {
      const features: Record<string, number | null> = {};
      for (const provider of buildPullbackFeatureProviders("close")) {
        features[provider.featureId] = provider.compute({
          securityId: "600001.SH",
          decisionTime: { date: bars[bars.length - 1]!.timestamp, point: "close" },
          data: { symbol: "600001.SH", bars },
        });
      }
      const signal = builder({
        securityId: "600001.SH",
        date: bars[bars.length - 1]!.timestamp,
        features,
        bars,
        point: "close",
      });
      if (signal !== null) days.push(k);
    }
    return days;
  }

  it("两侧的**首个有效日**一致（Core 的 FIRST_VALID_DAY 就是 legacy 的第一个满足日）", () => {
    const legacyDays = legacyEmittedDays();
    const coreDays = runAllDays(makeSource({}).source).emittedDays;
    expect(legacyDays[0]).toBe(coreDays[0]);
    expect(coreDays[0]).toBe(2);
  });

  it("差异形状被钉死：legacy 逐日出信号 [2,3]，Core 只在首个有效日出 [2]", () => {
    const legacyDays = legacyEmittedDays();
    const coreDays = runAllDays(makeSource({}).source).emittedDays;
    expect(legacyDays).toEqual([2, 3]);
    expect(coreDays).toEqual([2]);
    // 差异原因：legacy 门槛型配方**没有实现**自己文档声明的 observationWindow + trigger，
    // 逐日看当天门槛；Core 按文档语义（WINDOW + TRIGGER）只在一个决策日出信号。
    expect(legacyDays.length).toBeGreaterThan(coreDays.length);
  });
});

describe("StrategyRuntime 仍为唯一执行入口（接线不改 Core 契约）", () => {
  it("决策源内部走 StrategyRuntime.evaluate（用 evaluateWithDetail 的产物字段佐证）", () => {
    const { source } = makeSource({});
    runAllDays(source);
    // rd0 只有一根 bar（窗口 1..0 为空）⇒ 挑一个真正进入窗口求值的决策样本
    const sample = source.digest().samples.find((item) => item.currentRelativeDay >= 1)!;
    expect(sample.conditionCount).toBeGreaterThan(0);
    expect(sample.explanation.length).toBeGreaterThan(0);
    // 未接线时 evaluate 由外部直接调用也应得到同一形状
    const direct = StrategyRuntime.evaluate(
      makeVersion(makePullbackDefinition()),
      { max_volume_ratio: 0.5 },
      {
        timestamp: { date: "2026-09-12", point: "close" },
        instrument: { securityId: "600001.SH", code: "600001.SH" },
        visibleData: toCoreBarWindow(visibleThrough(2)).universe,
        currentRelativeDay: 2,
        resolveEvent: () => true,
        datasetCapability: {
          frequency: "1D",
          availableFields: ["open", "high", "low", "close", "volume"],
          availableDomains: ["OHLCV"],
          eventTypes: ["FIRST_LIMIT_UP"],
          availableHistory: 3,
        },
        state: { positionState: "FLAT", openPositions: 0 },
      },
    );
    expect(direct.strategyId).toBe("first-limit-pullback");
    expect(Array.isArray(direct.signals)).toBe(true);
  });
});
