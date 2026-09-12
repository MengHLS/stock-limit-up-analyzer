/**
 * RESEARCH-002 — 变量目录测试（含角色隔离与口径登记）。
 */

import { describe, expect, it } from "vitest";
import type {
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../datasetRegistry/types";
import {
  EVENT_LOW_GUARD_BASES,
  FEATURE_VARIABLES,
  ResearchVariableCatalog,
  buildEventLowGuardVariables,
  buildOutcomeVariables,
  buildSegmentVariableDefinition,
  eventLowMarginVariableName,
  holdsEventLowVariableName,
  parseOutcomeVariableName,
  parseSegmentVariableName,
  rangesOverlap,
  resolveDimensionValue,
  segmentStatLabel,
  segmentValueWindow,
  segmentVariableName,
  windowOutcomeVariableName,
} from "./variables";
import { ResearchEngineError } from "./errors";
import { buildSyntheticDataset, type SyntheticEventSpec } from "./testFixtures";

const catalog = new ResearchVariableCatalog([5, 10, 20], [1, 5, 10]);

describe("变量目录", () => {
  it("每个特征变量都写明了口径与角色（不许有名字没口径）", () => {
    for (const [name, def] of Object.entries(FEATURE_VARIABLES)) {
      expect(def.name, name).toBe(name);
      expect(def.role).toBe("FEATURE");
      expect(def.definition.length, `${name} 缺少口径说明`).toBeGreaterThan(8);
    }
  });

  it("结果变量由真实视界展开（path 1/5/10 + outcome 5/10/20）", () => {
    const names = catalog.listOutcomes();
    expect(names).toContain("future_return_1d");
    expect(names).toContain("future_return_5d");
    expect(names).toContain("max_drawdown_20d");
    expect(names).toContain("is_breakout_10d");
    expect(names).toContain("days_to_breakout_5d");
    // 不该出现在数据集里的视界不能凭空存在
    expect(names).not.toContain("future_return_7d");
    expect(names).not.toContain("future_return_30d");
  });

  it("结果变量名解析：kind + horizon", () => {
    expect(parseOutcomeVariableName("future_return_5d")).toEqual({ kind: "future_return", horizon: 5 });
    expect(parseOutcomeVariableName("max_drawdown_20d")).toEqual({ kind: "max_drawdown", horizon: 20 });
    expect(parseOutcomeVariableName("turnover")).toBeNull();
    expect(parseOutcomeVariableName("unknown_5d")).toBeNull();
    expect(parseOutcomeVariableName("future_return_0d")).toBeNull();
  });

  it("只按真实视界造变量（不虚构不存在的数据）", () => {
    const defs = buildOutcomeVariables([1], [5]);
    const names = defs.map((d) => d.name).sort();
    expect(names).toEqual(
      [
        "days_to_breakout_5d",
        "event_low_margin_5d",
        "event_low_margin_close_5d",
        "future_return_1d",
        "high_return_1d",
        "holds_event_low_5d",
        "holds_event_low_close_5d",
        "is_breakout_5d",
        "low_return_1d",
        "max_drawdown_5d",
        "max_return_5d",
        "min_return_5d",
        "pullback_from_event_high_1d",
        "volume_ratio_1d",
      ].sort(),
    );
  });

  it("未登记的变量名 → UNKNOWN_VARIABLE", () => {
    expect(() => catalog.resolveFeature("nope")).toThrow(ResearchEngineError);
    try {
      catalog.resolveFeature("nope");
    } catch (e) {
      expect((e as ResearchEngineError).code).toBe("UNKNOWN_VARIABLE");
    }
    try {
      catalog.resolveOutcome("future_return_7d");
    } catch (e) {
      expect((e as ResearchEngineError).code).toBe("UNKNOWN_VARIABLE");
    }
  });

  it("维度取值来自真实列（year / month / quarter / board / market）", () => {
    const ds = buildSyntheticDataset({
      events: [{ index: 0, turnover: 5, futureReturn: () => 0.01, tradeDate: "2025-07-15", boardType: "chinext", market: "SZ" }],
      horizons: [5],
    });
    const sources = {
      event: ds.events[0]!,
      prefixBars: new Map(),
    };
    expect(resolveDimensionValue("year", sources)).toBe(2025);
    expect(resolveDimensionValue("month", sources)).toBe("2025-07");
    expect(resolveDimensionValue("quarter", sources)).toBe("2025Q3");
    expect(resolveDimensionValue("board", sources)).toBe("chinext");
    expect(resolveDimensionValue("market", sources)).toBe("SZ");
    // 未提供标签源 → regime 返回 null（不编造标签）
    expect(resolveDimensionValue("regime", sources)).toBeNull();
    expect(resolveDimensionValue("regime", sources, { regimeLabelOf: () => "risk_on" })).toBe("risk_on");
    expect(resolveDimensionValue("unknown_dim", sources)).toBeNull();
  });

  it("ms 级极端月份不产生非法 quarter", () => {
    const ds = buildSyntheticDataset({
      events: [{ index: 0, turnover: 1, futureReturn: () => 0, tradeDate: "2025-12-31" }],
      horizons: [5],
    });
    expect(resolveDimensionValue("quarter", { event: ds.events[0]!, prefixBars: new Map() })).toBe("2025Q4");
  });
});

// ---------------------------------------------------------------------------
// RESEARCH-004 —— 分段（两窗）结果变量
//
// 现有 95 个结果变量全部锚定 T 日收盘，因此「T+5 → T+20 这一段」无法表达。
// 这一族把锚点挪到窗起点，属**未来结果**（窗起点收盘即可观测，但仍晚于 T）。
// ---------------------------------------------------------------------------

describe("分段结果变量（RESEARCH-004）", () => {
  it("名字解析只认 segment_{stat}_{a}_{b}d，且 a ≥ 1、b > a", () => {
    expect(parseSegmentVariableName("segment_return_5_20d")).toEqual({ stat: "return", from: 5, to: 20 });
    expect(parseSegmentVariableName("segment_max_drawdown_1_2d")).toEqual({
      stat: "max_drawdown",
      from: 1,
      to: 2,
    });
    // b ≤ a / a < 1 / 口径不存在 / 根本不是分段名 —— 一律 null，交给调用方具名失败
    expect(parseSegmentVariableName("segment_return_20_5d")).toBeNull();
    expect(parseSegmentVariableName("segment_return_0_5d")).toBeNull();
    expect(parseSegmentVariableName("segment_sharpe_1_5d")).toBeNull();
    expect(parseSegmentVariableName("future_return_5d")).toBeNull();
  });

  it("命名唯一规则：from = 0 复用既有变量族，绝不另造第二套口径", () => {
    expect(windowOutcomeVariableName("return", 0, 5)).toBe("future_return_5d");
    expect(windowOutcomeVariableName("max_drawdown", 0, 5)).toBe("max_drawdown_5d");
    expect(windowOutcomeVariableName("return", 5, 20)).toBe("segment_return_5_20d");
    expect(windowOutcomeVariableName("max_drawdown", 5, 20)).toBe(segmentVariableName("max_drawdown", 5, 20));
    expect(segmentStatLabel("max_drawdown")).toContain("跌幅");
  });

  it("取值区间：锚点日只提供基准价（from = 0 时取值从 1 起）", () => {
    expect(segmentValueWindow(0, 5)).toEqual([1, 5]);
    expect(segmentValueWindow(5, 20)).toEqual([6, 20]);
    // 紧邻窗不算重叠；一旦相交就必须被拒
    expect(rangesOverlap(segmentValueWindow(0, 5), segmentValueWindow(5, 20))).toBe(false);
    expect(rangesOverlap(segmentValueWindow(0, 10), segmentValueWindow(5, 20))).toBe(true);
    expect(rangesOverlap([6, 20], [1, 5])).toBe(false);
    expect(rangesOverlap([1, 5], [1, 5])).toBe(true);
  });

  it("目录：分段变量按需构造（不进 listOutcomes），越界即 UNKNOWN_VARIABLE", () => {
    expect(catalog.listOutcomes().some((n) => n.startsWith("segment_"))).toBe(false);
    expect(catalog.segmentRange).toEqual({ min: 1, max: 10 });
    expect(catalog.hasOutcome("segment_return_5_10d")).toBe(true);
    // 超出该版本 path 视界 / 起点为 0（那属于既有族，不是分段族）
    expect(catalog.hasOutcome("segment_return_5_20d")).toBe(false);
    expect(catalog.hasOutcome("segment_return_0_5d")).toBe(false);

    const def = catalog.resolveOutcome("segment_return_5_10d");
    expect(def.role).toBe("OUTCOME");
    expect(def.pathRelativeDays).toEqual([5, 6, 7, 8, 9, 10]);
    expect(def.definition).toContain("分段锚点 = 窗起点");
    expect(def.definition).toContain("不可当作 T 日的 PIT 安全特征");

    expect(() => catalog.resolveOutcome("segment_return_5_20d")).toThrow(ResearchEngineError);
    // 分段量是 OUTCOME：当特征用必须被 PIT 角色校验挡住
    expect(() => catalog.resolveFeature("segment_return_5_10d")).toThrow(/PIT 安全特征/);
  });

  /** 窗起点在 5、峰值在 10 的路径：让四种口径的值互不相同，便于逐一核对。 */
  const bumpReturn = (h: number) => 0.01 * (h <= 10 ? h : 20 - h);

  function pathRowsOf(): Map<number, FirstLimitPullbackPath> {
    const ds = buildSyntheticDataset({
      events: [{ index: 0, turnover: 1, futureReturn: bumpReturn }],
      horizons: [5, 20],
      maxPathDay: 20,
    });
    const map = new Map<number, FirstLimitPullbackPath>();
    for (const row of ds.paths) map.set(row.relativeDay, row);
    return map;
  }

  const wideCatalog = new ResearchVariableCatalog(
    [5, 20],
    Array.from({ length: 20 }, (_, i) => i + 1),
  );

  function valueOf(name: string, pathRows: ReturnType<typeof pathRowsOf>): number | null {
    return wideCatalog.resolveOutcome(name).resolve({ pathRows, outcomeRows: new Map() });
  }

  it("取值口径：锚在窗起点收盘，relativeDays 含锚点日；四种口径互不相同", () => {
    const pathRows = pathRowsOf();
    // 基准 close(5) 水平 = 1.05，峰值 close(10) = 1.10，窗末 close(12) = 1.08
    expect(valueOf("segment_return_5_12d", pathRows)).toBeCloseTo(1.08 / 1.05 - 1, 10);
    expect(valueOf("segment_max_return_5_12d", pathRows)).toBeCloseTo(1.1 / 1.05 - 1, 10);
    // low = level − 0.01 ⇒ 最低出现在窗末
    expect(valueOf("segment_min_return_5_12d", pathRows)).toBeCloseTo(1.05 / 1.05 - 1, 10);
    // max_drawdown 用的是 close（不是 high/low），最低 close 在窗首
    expect(valueOf("segment_max_drawdown_5_12d", pathRows)).toBeCloseTo(1.06 / 1.05 - 1, 10);
  });

  it("缺任一天 ⇒ 整个分段量为 null（不按剩余日平滑过去，口径不随缺失漂移）", () => {
    const full = pathRowsOf();
    const missingPeak = new Map(full);
    missingPeak.delete(10);
    // 只依赖两端点的口径仍可用
    expect(valueOf("segment_return_5_12d", missingPeak)).not.toBeNull();
    // 扫窗口径必须整段可用 ⇒ null，而不是「少算一天」
    expect(valueOf("segment_max_return_5_12d", missingPeak)).toBeNull();
    expect(valueOf("segment_max_drawdown_5_12d", missingPeak)).toBeNull();

    const missingAnchor = new Map(full);
    missingAnchor.delete(5);
    expect(valueOf("segment_return_5_12d", missingAnchor)).toBeNull();
    expect(valueOf("segment_max_return_5_12d", missingAnchor)).toBeNull();
  });

  it("定义对象可独立构造，且名字与解析器互逆", () => {
    const def = buildSegmentVariableDefinition("min_return", 7, 19);
    expect(def.name).toBe("segment_min_return_7_19d");
    expect(parseSegmentVariableName(def.name)).toEqual({ stat: "min_return", from: 7, to: 19 });
    expect(def.pathRelativeDays?.[0]).toBe(7);
    expect(def.pathRelativeDays?.at(-1)).toBe(19);
  });
});

// ---------------------------------------------------------------------------
// 事件日形态特征 + 最低价守护族
//
// 研究问题：「首板涨停、**不是一字板**，T+1..T+5 回撤**不破涨停日最低价**，
// 对应的 T+20 收益是多少；回撤那几天的量能关系如何」。
//
// 为什么必须新增变量（而不是拼现成的）：
//   - 「破没破」是**跨字段比较**（path 的极值 vs 事件日 low），而条件编辑器的右值
//     只能是常量 ⇒ 判定必须整体压成一个变量，条件侧退化为 `holds_event_low_5d = 1`；
//   - 事件日 low 存在 prefix rd=0，结果侧原本拿不到 ⇒ 定义须声明 `needsEventBar`，
//     装配层才会把 rd=0 并入装载范围并注入 `OutcomeSources.eventBar`。
// ---------------------------------------------------------------------------

describe("事件日形态特征与最低价守护族", () => {
  const guardCatalog = new ResearchVariableCatalog([5, 10, 20], [1, 5, 10]);

  /**
   * 取一个事件的 feature / outcome 数据源。
   * fixture 的 D0 形状：`open = close = limitUpPrice`、`low = close − 0.05`；
   * path 第 d 天：`lowFromEventClose = ret − 0.01`、`closeFromEventClose = ret`。
   */
  function sourcesOf(spec: SyntheticEventSpec) {
    const ds = buildSyntheticDataset({ events: [spec], horizons: [5], maxPathDay: 5 });
    const prefixBars = new Map<number, FirstLimitPullbackRawBar>();
    for (const bar of ds.prefixBars) prefixBars.set(bar.relativeDay, bar);
    const pathRows = new Map<number, FirstLimitPullbackPath>();
    for (const row of ds.paths) pathRows.set(row.relativeDay, row);
    const outcomeRows = new Map<number, FirstLimitPullbackOutcome>();
    for (const row of ds.outcomes) outcomeRows.set(row.horizon, row);
    return {
      feature: { event: ds.events[0]!, prefixBars },
      outcome: { pathRows, outcomeRows, eventBar: prefixBars.get(0) },
    };
  }

  const featureOf = (name: string, sources: ReturnType<typeof sourcesOf>): number | null =>
    guardCatalog.resolveFeature(name).resolve(sources.feature);
  const outcomeOf = (name: string, sources: ReturnType<typeof sourcesOf>): number | null =>
    guardCatalog.resolveOutcome(name).resolve(sources.outcome);

  const base: SyntheticEventSpec = { index: 0, turnover: 5, futureReturn: () => 0.01 };

  it("事件日形态：开盘价 = 涨停价 ⇒ 开盘即封；low < 涨停价 ⇒ 当日曾开板", () => {
    const s = sourcesOf(base);
    expect(featureOf("is_one_word_open", s)).toBe(1);
    expect(featureOf("is_one_word_hold", s)).toBe(0);
    // 两个折价都以**事件日收盘**（= 涨停价）为分母
    expect(featureOf("event_open_offset", s)).toBeCloseTo(0, 12);
    expect(featureOf("event_low_offset", s)).toBeCloseTo(-0.05 / 10, 12);
  });

  it("缺 D0 行情 ⇒ 形态特征与守护族一律 null（不臆造基准线）", () => {
    const s = sourcesOf(base);
    const noBar = { ...s.outcome, eventBar: undefined };
    expect(guardCatalog.resolveOutcome("holds_event_low_5d").resolve(noBar)).toBeNull();
    expect(guardCatalog.resolveOutcome("event_low_margin_5d").resolve(noBar)).toBeNull();
    const noPrefix = {
      event: s.feature.event,
      prefixBars: new Map<number, FirstLimitPullbackRawBar>(),
    };
    expect(FEATURE_VARIABLES.is_one_word_open!.resolve(noPrefix)).toBeNull();
    expect(FEATURE_VARIABLES.is_one_word_hold!.resolve(noPrefix)).toBeNull();
  });

  it("全程守住事件日最低价 ⇒ 1，余量 = 极值/低位 − 1 > 0", () => {
    const s = sourcesOf(base);
    // low(d) = (1 + 0.01 − 0.01) × 10 = 10；floor = 9.95
    expect(outcomeOf("holds_event_low_5d", s)).toBe(1);
    expect(outcomeOf("holds_event_low_close_5d", s)).toBe(1);
    expect(outcomeOf("event_low_margin_5d", s)).toBeCloseTo(10 / 9.95 - 1, 10);
  });

  it("两个口径会给出**不同**结论：盘中破、收盘守住", () => {
    // ret = −0.4% ⇒ close(5) = 9.96 ≥ 9.95（收盘守住）；low(5) = 9.86 < 9.95（盘中已破）
    const s = sourcesOf({ index: 0, turnover: 5, futureReturn: () => -0.004 });
    expect(outcomeOf("holds_event_low_close_5d", s)).toBe(1);
    expect(outcomeOf("holds_event_low_5d", s)).toBe(0);
    expect(outcomeOf("event_low_margin_5d", s)).toBeCloseTo(9.86 / 9.95 - 1, 10);
    expect(outcomeOf("event_low_margin_close_5d", s)).toBeCloseTo(9.96 / 9.95 - 1, 10);
  });

  it("缺任一天 ⇒ 整个守护量为 null（不按剩余天数平滑过去）", () => {
    const s = sourcesOf(base);
    const partial = new Map(s.outcome.pathRows);
    partial.delete(3);
    const broken = { ...s.outcome, pathRows: partial };
    expect(guardCatalog.resolveOutcome("holds_event_low_5d").resolve(broken)).toBeNull();
    expect(guardCatalog.resolveOutcome("event_low_margin_5d").resolve(broken)).toBeNull();
  });

  it("守护族是 OUTCOME：当特征用必须被 PIT 角色校验挡住", () => {
    expect(() => guardCatalog.resolveFeature("holds_event_low_5d")).toThrow(/PIT 安全特征/);
    expect(() => guardCatalog.resolveFeature("event_low_margin_5d")).toThrow(/PIT 安全特征/);
  });

  it("逐日量比取自 path.volumeRatio，视界跟随 path 而非 outcome", () => {
    expect(guardCatalog.listOutcomes()).toContain("volume_ratio_1d");
    expect(guardCatalog.listOutcomes()).toContain("volume_ratio_10d");
    // path 只到 10 ⇒ 即使 outcome 有 20 也不存在 volume_ratio_20d
    expect(guardCatalog.listOutcomes()).not.toContain("volume_ratio_20d");
    const s = sourcesOf(base);
    expect(outcomeOf("volume_ratio_5d", s)).toBe(1);
  });

  it("命名规则与定义对象自洽（每个守护变量都声明了 needsEventBar）", () => {
    expect(holdsEventLowVariableName("low", 5)).toBe("holds_event_low_5d");
    expect(holdsEventLowVariableName("close", 5)).toBe("holds_event_low_close_5d");
    expect(eventLowMarginVariableName("low", 5)).toBe("event_low_margin_5d");
    expect(eventLowMarginVariableName("close", 10)).toBe("event_low_margin_close_10d");
    expect([...EVENT_LOW_GUARD_BASES]).toEqual(["low", "close"]);

    const defs = buildEventLowGuardVariables([5]);
    expect(defs.map((d) => d.name).sort()).toEqual(
      [
        "event_low_margin_5d",
        "event_low_margin_close_5d",
        "holds_event_low_5d",
        "holds_event_low_close_5d",
      ].sort(),
    );
    for (const def of defs) {
      expect(def.needsEventBar, def.name).toBe(true);
      expect(def.pathRelativeDays).toEqual([1, 2, 3, 4, 5]);
      expect(def.definition).toContain("最低价");
    }
    // 只为真实视界造变量
    expect(buildEventLowGuardVariables([10]).map((d) => d.name)).not.toContain("holds_event_low_5d");
  });
});
