/**
 * STRATEGY-ARCH-002 — 生产接线层：bar 窗口锚定 + 事件判定器。
 *
 * 判据取向：**行为面**（同一输入 ⇒ 同一结论），而不是断言内部结构。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../../server/data";
import { StrategyCoreError } from "../../../../server/strategyCore";
import {
  DEFAULT_EVENT_ANCHOR_POLICY,
  coreDatasetCapability,
  createDatasetEventResolver,
  describeAnchorPolicy,
  emptyCoreBarWindow,
  toCoreBarWindow,
} from "../../../../server/strategyCore/production";
import type {
  EventOccurrenceResolver,
  RuntimeContext,
} from "../../../../server/strategyCore";

function barOf(
  date: string,
  values: Partial<
    Pick<
      CanonicalMarketBar,
      "open" | "high" | "low" | "close" | "preClose" | "volume" | "amount"
    >
  >
): CanonicalMarketBar {
  return {
    symbol: "600001.SH",
    timestamp: date,
    open: values.open ?? 10,
    high: values.high ?? 10.5,
    low: values.low ?? 9.8,
    close: values.close ?? 10.2,
    preClose: values.preClose ?? 10,
    volume: values.volume ?? 100_000,
    amount: values.amount ?? 1_000_000,
    turnoverRate: null,
    adjustment: "raw",
  } as unknown as CanonicalMarketBar;
}

/** 事件窗：rd0 = 首板日（涨停），rd1..rd3 = 观察日。 */
const EVENT_WINDOW: readonly CanonicalMarketBar[] = [
  barOf("2026-09-10", {
    open: 10,
    close: 11,
    preClose: 10,
    volume: 200_000,
    low: 10,
  }),
  barOf("2026-09-11", {
    open: 11,
    close: 10.8,
    preClose: 11,
    volume: 80_000,
    low: 10.6,
  }),
  barOf("2026-09-12", {
    open: 10.9,
    close: 11.2,
    preClose: 10.8,
    volume: 60_000,
    low: 10.4,
  }),
  barOf("2026-09-15", {
    open: 11.2,
    close: 11.5,
    preClose: 11.2,
    volume: 55_000,
    low: 10.9,
  }),
];

function contextWith(bars: readonly CanonicalMarketBar[]): RuntimeContext {
  const window = toCoreBarWindow(bars);
  return {
    timestamp: {
      date: bars[bars.length - 1]?.timestamp ?? "2026-09-15",
      point: "close",
    },
    instrument: { securityId: "600001.SH", code: "600001.SH" },
    visibleData: window.universe,
    currentRelativeDay: window.currentRelativeDay,
    state: { positionState: "FLAT", openPositions: 0 },
  };
}

describe("barWindow — 锚定策略与相对日", () => {
  it("默认锚定 = SERIES_START，且 relativeDay 恒为序列下标（0 = 事件日）", () => {
    const window = toCoreBarWindow(EVENT_WINDOW);
    expect(window.anchorPolicy).toBe(DEFAULT_EVENT_ANCHOR_POLICY);
    expect(window.anchorPolicy).toBe("SERIES_START");
    expect(window.barCount).toBe(4);
    expect(window.universe.bars.map(bar => bar.relativeDay)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(window.universe.bars.map(bar => bar.date)).toEqual([
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-15",
    ]);
    expect(window.eventDayDate).toBe("2026-09-10");
    expect(window.currentRelativeDay).toBe(3);
    expect(window.maxRelativeDay).toBe(3);
  });

  it("空序列 ⇒ 空窗口（不是「相对日 0 的一根假 bar」）", () => {
    const window = toCoreBarWindow([]);
    expect(window.universe.bars).toHaveLength(0);
    expect(window.barCount).toBe(0);
    expect(window.eventDayDate).toBeNull();
    expect(window).toEqual(emptyCoreBarWindow(DEFAULT_EVENT_ANCHOR_POLICY));
  });

  it("未登记的锚定策略 ⇒ 响亮抛错（不猜口径）", () => {
    expect(() =>
      toCoreBarWindow(EVENT_WINDOW, { anchorPolicy: "NOPE" as never })
    ).toThrowError(/未登记的事件锚定策略/);
  });

  it("说明文案里如实登记了「窗口左边界未预热会偏」这条边界", () => {
    expect(describeAnchorPolicy("SERIES_START")).toContain("eventBaselineOf");
    expect(describeAnchorPolicy("SERIES_START")).toContain("偏");
  });

  it("能力声明如实：1D / OHLCV / 不编造 eventCount", () => {
    const capability = coreDatasetCapability({
      anchorPolicy: "SERIES_START",
      eventTypes: ["FIRST_LIMIT_UP"],
      maxRelativeDay: 3,
      minBarCount: 4,
    });
    expect(capability.frequency).toBe("1D");
    expect(capability.availableDomains).toEqual(["OHLCV"]);
    expect(capability.availableHistory).toBe(4);
    // 「事件数未知」必须是**缺省**，而不是 0 —— 0 会让 minEvents 校验得出「不满足」的假结论。
    expect("eventCount" in capability).toBe(false);
  });
});

describe("eventSource — 事件判定器（生产注入）", () => {
  const base = {
    eventAnchored: true,
    eventTypes: ["FIRST_LIMIT_UP"],
    limitUpRatio: 0.1,
    declaredBy: "test",
  } as const;

  function resolve(
    resolver: EventOccurrenceResolver,
    bars: readonly CanonicalMarketBar[]
  ): boolean {
    return resolver("FIRST_LIMIT_UP", {}, contextWith(bars));
  }

  it("锚定日是分价涨停（close 等于四舍五入后的 preClose×1.1）⇒ 事件发生", () => {
    const source = createDatasetEventResolver({ ...base });
    expect(resolve(source.resolve, EVENT_WINDOW)).toBe(true);
    expect(source.occurredCount()).toBe(1);
    expect(source.notOccurredCount()).toBe(0);
    expect(source.undecidableCount()).toBe(0);
  });

  it("不足 10% 的分价涨停保留，高于涨停价的异常值不算事件", () => {
    const slightBelowTen = [
      barOf("2026-09-10", { close: 2.56, preClose: 2.33 }),
    ];
    const aboveLimit = [barOf("2026-09-10", { close: 2.57, preClose: 2.33 })];
    expect(
      resolve(createDatasetEventResolver({ ...base }).resolve, slightBelowTen)
    ).toBe(true);
    expect(
      resolve(createDatasetEventResolver({ ...base }).resolve, aboveLimit)
    ).toBe(false);
  });

  it("锚定日未涨停 ⇒ 明确「未发生」（false，且与「无法判定」分开计数）", () => {
    const notLimitUp = [
      barOf("2026-09-10", { close: 10.2, preClose: 10 }),
      barOf("2026-09-11", { close: 10.3, preClose: 10.2 }),
    ];
    const source = createDatasetEventResolver({ ...base });
    expect(resolve(source.resolve, notLimitUp)).toBe(false);
    expect(source.notOccurredCount()).toBe(1);
    expect(source.undecidableCount()).toBe(0);
  });

  it("锚定 bar 缺 preClose ⇒ 记「无法判定」并返回 false（与 legacy 基准缺失即剔除一致）", () => {
    const broken = [
      barOf("2026-09-10", { close: 11, preClose: 0 }),
      barOf("2026-09-11", { close: 10.8, preClose: 11 }),
    ];
    const source = createDatasetEventResolver({ ...base });
    expect(resolve(source.resolve, broken)).toBe(false);
    expect(source.undecidableCount()).toBe(1);
    expect(source.notOccurredCount()).toBe(0);
  });

  it("文档未声明 limitUpRatio ⇒ 不做涨停校验（不替它猜 10%）", () => {
    const notLimitUp = [barOf("2026-09-10", { close: 10.01, preClose: 10 })];
    const source = createDatasetEventResolver({ ...base, limitUpRatio: null });
    expect(resolve(source.resolve, notLimitUp)).toBe(true);
    expect(source.notes.join(" ")).toContain("不做涨停校验");
    // 「首板性不在本窗口可验证」必须如实登记
    expect(source.notes.join(" ")).toContain("首板性");
  });

  it("未声明的事件类型 ⇒ 响亮抛错（不静默 false）", () => {
    const source = createDatasetEventResolver({ ...base });
    expect(() =>
      source.resolve("SECOND_LIMIT_UP", {}, contextWith(EVENT_WINDOW))
    ).toThrowError(StrategyCoreError);
  });

  it("窗口里没有 rd 0 ⇒ 响亮抛错（锚定不成立）", () => {
    const source = createDatasetEventResolver({ ...base });
    const window = toCoreBarWindow(EVENT_WINDOW);
    const noRdZero: RuntimeContext = {
      ...contextWith(EVENT_WINDOW),
      visibleData: {
        bars: window.universe.bars.filter(bar => bar.relativeDay !== 0),
      },
    };
    expect(() => source.resolve("FIRST_LIMIT_UP", {}, noRdZero)).toThrowError(
      /没有相对日 0 的 bar/
    );
  });

  it("非事件窗数据集 ⇒ 构造即拒（不是静默不判定）", () => {
    expect(() =>
      createDatasetEventResolver({ ...base, eventAnchored: false })
    ).toThrowError(/eventAnchored=false/);
  });

  it("事件类型闭集为空 ⇒ 构造即拒", () => {
    expect(() =>
      createDatasetEventResolver({ ...base, eventTypes: [] })
    ).toThrowError(/事件类型闭集/);
  });

  it("limitUpRatio 非法 ⇒ 构造即拒", () => {
    expect(() =>
      createDatasetEventResolver({ ...base, limitUpRatio: -0.1 })
    ).toThrowError(/limitUpRatio/);
  });
});
