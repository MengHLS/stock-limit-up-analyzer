/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **装配层单元测试**。
 *
 * ## 为什么测装配层而不是整条 `run()`
 *
 * `run()` 只是「解析因子 → 解析候选池 → 装配」三步，其中候选池由公共底座
 * `deriveTwelveFactorSamples()` 承担（其正确性由真实 Run 的样本账把关）。
 * 本文件钉住**装配层与通用基础的口径**，这些地方错了不会报错、只会静默产出错数字：
 *
 * 1. 8 个预定义组合**全部**输出（静默丢一个 = 事后择优）；
 * 2. 排名方向（HIGH 取大 / LOW 取小）与 `rank` / `poolSize`；
 * 3. 当日池 < TopN 时**整天不纳入**（而不是「有几只算几只」）；
 * 4. 逐笔成本恒等式 `net = gross − cost`（与公共底座逐位一致）；
 * 5. 样本账守恒（不守恒必须抛）；
 * 6. `customPayload` 必须能通过 `singleFactorSchema`
 *    （真实 Run 要跑十几分钟才校验 schema，一次失败等于白跑 ⇒ 必须在这里先证明一致）；
 * 7. 全量逐笔 CSV 产物确实被写出且行数正确；
 * 8. 口径确定性（同一份输入两次装配结果完全相同）。
 */

import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  SINGLE_FACTOR_COMBOS,
  SINGLE_FACTOR_CONTRACT_ID,
  SINGLE_FACTOR_TEMPLATE_ID,
  type SingleFactorSample,
  type TopNSize,
} from "../../../research-experiments/shared/singleFactor/types";
import {
  assertTemplateCoordinate,
  ENTRY_DAY,
  EXIT_RELATIVE_DAY,
  ROUND_TRIP_COST_BPS,
} from "../../../research-experiments/shared/singleFactor/coordinate";
import {
  assembleSingleFactorResult,
  singleFactorComboSchema,
  singleFactorSchema,
  TRADE_TABLE_SAMPLE_PER_COMBO,
} from "../../../research-experiments/shared/singleFactor/resultWriter";
import {
  FROZEN_TWELVE_FACTOR_CATALOG,
  factorContractFingerprintOf,
  resolveSingleFactor,
} from "../../../research-experiments/shared/singleFactor/factorResolver";
import {
  maxDrawdownOf,
  profitFactorOf,
  compoundOf,
  winRateOf,
} from "../../../research-experiments/shared/singleFactor/metrics";
import { buildCrossSections, selectTopN } from "../../../research-experiments/shared/singleFactor/ranker";
import type { SingleFactorUniverseResult } from "../../../research-experiments/shared/singleFactor/universe";
import type { ExperimentArtifactFileSpec } from "../../../shared/researchExperimentsContracts";

const COST = ROUND_TRIP_COST_BPS / 10_000;
const DATES = ["2021-01-04", "2021-01-05", "2021-01-06"] as const;
const PER_DAY = 21;

function sampleOf(args: {
  eventId: string;
  decisionDate: string;
  factorValue: number;
  netReturn: number;
}): SingleFactorSample {
  const grossReturn = args.netReturn + COST;
  return {
    eventId: args.eventId,
    stockCode: `60000${args.eventId.slice(-2)}.SH`,
    eventDate: args.decisionDate,
    signalDate: `${args.decisionDate}#T+5`,
    entryDate: `${args.decisionDate}#T+6`,
    exitDate: `${args.decisionDate}#T+10`,
    entryRelativeDay: ENTRY_DAY,
    exitRelativeDay: EXIT_RELATIVE_DAY,
    holdingDays: EXIT_RELATIVE_DAY - ENTRY_DAY + 1,
    entryPrice: 10,
    exitPrice: 10 * (1 + grossReturn),
    grossReturn,
    cost: COST,
    costBps: ROUND_TRIP_COST_BPS,
    netReturn: args.netReturn,
    year: Number(args.decisionDate.slice(0, 4)),
    factorValue: args.factorValue,
  };
}

/** 构造「因子值越大 → 净收益越高」的样本（这样超额符号是确定的）。 */
function buildSamples(
  dates: readonly string[] = DATES,
  perDay: number = PER_DAY
): SingleFactorSample[] {
  const samples: SingleFactorSample[] = [];
  for (const date of dates) {
    for (let index = 1; index <= perDay; index += 1) {
      samples.push(
        sampleOf({
          eventId: `${date}-${String(index).padStart(3, "0")}`,
          decisionDate: date,
          factorValue: index,
          netReturn: index * 0.005,
        })
      );
    }
  }
  return samples;
}

function buildUniverse(
  samples: readonly SingleFactorSample[],
  excludedByReason: Record<string, number> = { NOT_FIRST_LIMIT: 7 }
): SingleFactorUniverseResult {
  const excluded = Object.values(excludedByReason).reduce((sum, value) => sum + value, 0);
  return {
    factor: resolveSingleFactor("turnover"),
    samples,
    eligibleCountBeforeFactorFilter: samples.length,
    candidateCount: samples.length + excluded,
    excludedByReason,
    factorMissingByCode: {},
    datasetEventCount: samples.length + excluded,
    unscannedEventCount: 0,
    duplicateEventIdCount: 0,
    crossSectionPeerCount: samples.length,
    pitObservationRowCount: 0,
    pitExecutionRowCount: 0,
    factorValueMissingCount: 0,
  };
}

type ComboPayload = z.infer<typeof singleFactorComboSchema>;

function comboOf(
  payload: ReturnType<typeof assembleSingleFactorResult>,
  comboId: string
): ComboPayload {
  const parsed = singleFactorSchema.parse(payload.customPayload);
  const found = parsed.combos.find(combo => combo.comboId === comboId);
  if (!found) throw new Error(`未找到组合 ${comboId}`);
  return found;
}

describe("single-factor-v1 · 冻结坐标", () => {
  it("模板坐标不变量成立（入场=信息截止+1 / 退出由持有日推出 / 成本=冻结往返值）", () => {
    expect(() => assertTemplateCoordinate()).not.toThrow();
    expect(ENTRY_DAY).toBe(6);
    expect(EXIT_RELATIVE_DAY).toBe(10);
    expect(ROUND_TRIP_COST_BPS).toBe(20);
  });

  it("组合定义 = 2 方向 × 4 档 = 8 个静态枚举（结构上无法事后择优）", () => {
    expect(SINGLE_FACTOR_COMBOS.map(combo => combo.id)).toEqual([
      "HIGH_N3",
      "HIGH_N5",
      "HIGH_N10",
      "HIGH_N20",
      "LOW_N3",
      "LOW_N5",
      "LOW_N10",
      "LOW_N20",
    ]);
  });
});

describe("single-factor-v1 · 因子目录（冻结契约适配器）", () => {
  it("12 个现有因子全部可解析，且目录项直接引用冻结契约的对象", () => {
    expect(FROZEN_TWELVE_FACTOR_CATALOG.length).toBe(12);
    for (const entry of FROZEN_TWELVE_FACTOR_CATALOG) {
      expect(resolveSingleFactor(entry.code)).toBe(entry);
      expect(entry.buckets.length).toBeGreaterThan(0);
      expect(entry.valueOf).toBeTypeOf("function");
    }
    expect(new Set(FROZEN_TWELVE_FACTOR_CATALOG.map(entry => entry.code)).size).toBe(12);
  });

  it("未登记的因子响亮失败", () => {
    expect(() => resolveSingleFactor("no_such_factor")).toThrow(/未登记的因子/u);
  });

  it("因子指纹逐因子不同（可事后审计口径）", () => {
    const fingerprints = FROZEN_TWELVE_FACTOR_CATALOG.map(factorContractFingerprintOf);
    expect(new Set(fingerprints).size).toBe(12);
    for (const value of fingerprints) expect(value.startsWith("fnv1a32:")).toBe(true);
  });
});

describe("single-factor-v1 · 装配层", () => {
  const samples = buildSamples();
  const universe = buildUniverse(samples);
  const payload = assembleSingleFactorResult({ factor: universe.factor, universe });
  const custom = singleFactorSchema.parse(payload.customPayload);

  it("customPayload 通过 singleFactorSchema（真实 Run 的 schema 校验前置到这里）", () => {
    expect(custom.templateId).toBe(SINGLE_FACTOR_TEMPLATE_ID);
    expect(custom.contractId).toBe(SINGLE_FACTOR_CONTRACT_ID);
    expect(custom.experimentType).toBe("SINGLE_FACTOR");
    expect(custom.factorCode).toBe("turnover");
    expect(custom.coordinate.entryRelativeDay).toBe(ENTRY_DAY);
    expect(custom.observationPolicy.isEntryWindow).toBe(false);
  });

  it("8 个预定义组合全部输出（静默丢一个就是事后择优）", () => {
    expect(custom.combos.length).toBe(SINGLE_FACTOR_COMBOS.length);
    expect(new Set(custom.combos.map(combo => combo.comboId)).size).toBe(8);
  });

  it("样本账平：candidate = eligible + excluded，且逐因原因合计相等", () => {
    const summary = payload.sampleSummary;
    expect(summary.candidateCount).toBe(samples.length + 7);
    expect(summary.eligibleCount).toBe(samples.length);
    expect(summary.excludedCount).toBe(7);
    expect(
      Object.values(summary.excludedByReason).reduce((sum, value) => sum + value, 0)
    ).toBe(7);
  });

  it("样本账不守恒时立刻抛错（不允许悄悄产出一份对不上的结果）", () => {
    expect(() =>
      assembleSingleFactorResult({
        factor: universe.factor,
        universe: { ...universe, excludedByReason: { NOT_FIRST_LIMIT: 5 } },
      })
    ).toThrow(/样本账不守恒/u);
  });

  it("没有任何可排名样本时响亮失败", () => {
    expect(() =>
      assembleSingleFactorResult({
        factor: universe.factor,
        universe: buildUniverse([], { NOT_FIRST_LIMIT: 7 }),
      })
    ).toThrow(/没有任何可排名样本/u);
  });

  it("排名方向正确：HIGH 取因子值最大、LOW 取最小，且超额符号相反", () => {
    const high = comboOf(payload, "HIGH_N3");
    const low = comboOf(payload, "LOW_N3");
    // 21 只里取前 3 ⇒ 高因子值那头
    expect(high.metrics.meanTradeReturn!).toBeGreaterThan(low.metrics.meanTradeReturn!);
    expect(high.metrics.meanTradeReturn!).toBeCloseTo(0.1, 10);
    expect(low.metrics.meanTradeReturn!).toBeCloseTo(0.01, 10);
    expect(high.metrics.excessReturn!).toBeGreaterThan(0);
    expect(low.metrics.excessReturn!).toBeLessThan(0);
    expect(high.dayWinRate).toBe(1);
    expect(low.dayWinRate).toBe(0);
  });

  it("名次与比较基数正确：每个决策日 21 只、Top-3 每天取 3 只 ⇒ 共 9 笔", () => {
    const high = comboOf(payload, "HIGH_N3");
    expect(high.daysIncluded).toBe(DATES.length);
    expect(high.daysExcludedSmall).toBe(0);
    expect(high.picks).toBe(DATES.length * 3);
    expect(high.picksPerDayMedian).toBe(3);
  });

  it("基准 = 当日全部候选等权：21 只全池均值 = 中位因子值那只（0.055）", () => {
    const high = comboOf(payload, "HIGH_N3");
    expect(high.metrics.benchmarkReturn!).toBeCloseTo(
      compoundOf([0.055, 0.055, 0.055])!,
      10
    );
    expect(high.meanDailyBenchmarkReturn!).toBeCloseTo(0.055, 10);
  });

  it("核心指标齐全且可复算：totalReturn 是日度复利、maxDrawdown ≤ 0", () => {
    const high = comboOf(payload, "HIGH_N3");
    const daily = 0.1;
    expect(high.metrics.totalReturn!).toBeCloseTo(
      compoundOf([daily, daily, daily])!,
      10
    );
    expect(high.metrics.grossTotalReturn!).toBeGreaterThan(high.metrics.totalReturn!);
    expect(high.metrics.costDrag!).toBeGreaterThan(0);
    expect(high.metrics.maxDrawdown!).toBeLessThanOrEqual(0);
    expect(high.metrics.tradeCount).toBe(9);
    expect(high.metrics.averageHoldingDays).toBe(5);
    expect(high.metrics.costBps).toBe(ROUND_TRIP_COST_BPS);
    expect(high.metrics.winRate).toBe(1);
    // 9 笔全胜 ⇒ 无亏损交易 ⇒ 盈亏比的分母不存在 ⇒ null（不写 Infinity）
    expect(high.metrics.profitFactor).toBeNull();
  });

  it("日数 < 100 ⇒ 判定必须是 INSUFFICIENT（不允许在小样本上给 POSITIVE）", () => {
    for (const combo of custom.combos) {
      expect(combo.excessVerdict).toBe("INSUFFICIENT");
      expect(combo.portfolioVerdict).toBe("INSUFFICIENT");
    }
  });

  it("当日池 < TopN ⇒ 整天不纳入，且账看得见（daysExcludedSmall）", () => {
    const small = assembleSingleFactorResult({
      factor: universe.factor,
      universe: buildUniverse(buildSamples(DATES, 3)),
    });
    const parsed = singleFactorSchema.parse(small.customPayload);
    const high3 = parsed.combos.find(combo => combo.comboId === "HIGH_N3")!;
    const high5 = parsed.combos.find(combo => combo.comboId === "HIGH_N5")!;
    expect(high3.daysIncluded).toBe(DATES.length);
    expect(high3.daysExcludedSmall).toBe(0);
    expect(high5.daysIncluded).toBe(0);
    expect(high5.daysExcludedSmall).toBe(DATES.length);
    expect(high5.metrics.totalReturn).toBeNull();
    // 组合仍然在结果里（不静默丢弃）
    expect(parsed.combos.length).toBe(8);
  });

  it("表格齐全且行数正确（定义 / 样本流 / 整体 / TopN / 基准 / 超额 / 切片 / 逐笔 / 因子 / 诊断）", () => {
    const tables = payload.tables ?? [];
    const of = (key: string) => tables.find(table => table.key === key)!;
    expect(of("sf_overall_result").rows.length).toBe(8);
    expect(of("sf_topn_result").rows.length).toBe(8);
    expect(of("sf_benchmark_result").rows.length).toBe(8);
    expect(of("sf_excess_result").rows.length).toBe(8);
    expect(of("sf_time_slice_result").rows.length).toBe(8);
    // 每组合保留 min(50, 该组合总笔数)：3 天 × (3/5/10/20) = 9/15/30/60 ⇒ min 后 9+15+30+50 = 104/方向
    expect(of("sf_trade_details").rows.length).toBe(104 * 2);
    expect(TRADE_TABLE_SAMPLE_PER_COMBO).toBe(50);
    expect(of("sf_factor_contract").rows.length).toBeGreaterThan(0);
    expect(of("sf_day_diagnostics").rows.length).toBeGreaterThan(0);
    expect(of("sf_sample_flow").rows.length).toBeGreaterThan(0);
    expect(of("sf_experiment_definition").rows.length).toBeGreaterThan(0);
    expect(payload.charts?.length).toBe(2);
    expect(payload.statistics?.length).toBeGreaterThanOrEqual(8 * 3 + 4);
  });

  it("逐笔明细字段齐全（需求要求的最小字段集）", () => {
    const rows = (payload.tables ?? []).find(
      table => table.key === "sf_trade_details"
    )!.rows;
    const first = rows[0]!;
    for (const field of [
      "stockCode",
      "factorValue",
      "rank",
      "signalDate",
      "entryDate",
      "entryPrice",
      "exitDate",
      "exitPrice",
      "holdingDays",
      "grossReturn",
      "cost",
      "netReturn",
    ]) {
      expect(Object.keys(first)).toContain(field);
      expect(first[field]).not.toBeUndefined();
    }
    // 成本恒等式：net = gross − cost
    for (const row of rows) {
      expect(
        Math.abs(
          (row.grossReturn as number) - (row.cost as number) - (row.netReturn as number)
        )
      ).toBeLessThan(1e-12);
    }
  });

  it("全量逐笔 CSV 产物被写出：gzip、行数 = 8 组合总笔数", () => {
    const emitted: ExperimentArtifactFileSpec[] = [];
    const withArtifact = assembleSingleFactorResult({
      factor: universe.factor,
      universe,
      emitArtifact: spec => emitted.push(spec),
    });
    const artifact = emitted.find(spec => spec.name.endsWith(".csv.gz"));
    expect(artifact).toBeDefined();
    expect(artifact!.contentType).toBe("application/gzip");
    const text = gunzipSync(Buffer.from(artifact!.body as Uint8Array)).toString("utf8");
    const lines = text.trimEnd().split("\n");
    const parsed = singleFactorSchema.parse(withArtifact.customPayload);
    expect(parsed.tradeArtifact.name).toBe(artifact!.name);
    expect(parsed.tradeArtifact.rowCount).toBe(lines.length - 1);
    // 8 组合：N3/N5/N10/N20 各 2 方向 ⇒ 每天(3+5+10+20)×2 = 76 笔 × 3 天
    expect(parsed.tradeArtifact.rowCount).toBe(DATES.length * 76);
    expect(lines[0]).toContain("stockCode");
    expect(lines[0]).toContain("netReturn");
  });

  it("不传 emitArtifact 时不写产物（单测/离线复算场景）", () => {
    expect(() =>
      assembleSingleFactorResult({ factor: universe.factor, universe })
    ).not.toThrow();
  });

  it("确定性：同一份输入两次装配结果完全相同", () => {
    const second = assembleSingleFactorResult({ factor: universe.factor, universe });
    expect(JSON.stringify(second)).toBe(JSON.stringify(payload));
  });
});

describe("single-factor-v1 · 通用基础小件", () => {
  it("横截面按决策日分组，排名确定性（同值按 eventId 升序）", () => {
    const sections = buildCrossSections(
      [
        sampleOf({ eventId: "a-2", decisionDate: "2021-01-04", factorValue: 5, netReturn: 0 }),
        sampleOf({ eventId: "a-1", decisionDate: "2021-01-04", factorValue: 5, netReturn: 0 }),
        sampleOf({ eventId: "a-3", decisionDate: "2021-01-04", factorValue: 9, netReturn: 0 }),
      ],
      "HIGH"
    );
    const section = sections.get("2021-01-04")!;
    expect(section.ranked.map(item => item.sample.eventId)).toEqual([
      "a-3",
      "a-1",
      "a-2",
    ]);
    expect(selectTopN(section, 3 as TopNSize).included).toBe(true);
    expect(selectTopN(section, 20 as TopNSize).included).toBe(false);
  });

  it("指标小件：复利 / 回撤 / 盈亏比 / 胜率", () => {
    expect(compoundOf([0.1, -0.1])).toBeCloseTo(-0.01, 10);
    expect(maxDrawdownOf([0.1, -0.5, 0.2])).toBeCloseTo(-0.5, 10);
    expect(profitFactorOf([0.1, -0.1, 0.2])).toBeCloseTo(3, 10);
    expect(profitFactorOf([0.1, 0.2])).toBeNull();
    expect(winRateOf([0.1, -0.1, 0.2])).toBeCloseTo(2 / 3, 10);
    expect(compoundOf([])).toBeNull();
    expect(maxDrawdownOf([])).toBeNull();
  });
});
