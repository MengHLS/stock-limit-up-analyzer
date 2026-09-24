/**
 * 十二因子综合评分 · Top-N 排名可用性研究 —— 装配层单元测试。
 *
 * ## 为什么测的是 `assembleTopNRanking` 而不是整条 `run()`
 *
 * 本实验的 `run()` 只是「取共用样本派生 → 装配」两步；样本派生由
 * `twelve-factor-composite-study/derive.ts` 承担，其正确性由真实 Run 的样本账
 * （候选 73,003 / 入池 70,236）比对把关。本文件专门钉住**装配层**：
 *
 * 1. 排名方向（Top-N 取高分、反转臂取低分）；
 * 2. 日集门槛与 `daysExcludedSmall` 的账；
 * 3. 主判据符号（构造出「收益随评分单调」的样本 ⇒ 超额必须为正）；
 * 4. `customPayload` 必须能通过 `topNRankingSchema`（真实 Run 在**跑完 10 分钟后**
 *    才校验 schema，一次失败等于白跑 ⇒ 必须在这里先证明 schema 与产物一致）；
 * 5. 样本账不守恒必须抛错。
 */

import { describe, expect, it } from "vitest";
import {
  COMPOSITE_RANKING_KEY,
  COMPOSITE_REVERSED_RANKING_KEY,
  DEEP_DAY_MIN_SIZE,
  RANKING_KEYS,
  TOP_N_SPECS,
  assembleTopNRanking,
  topNRankingSchema,
  type AssembleTopNRankingArgs,
} from "../../../research-experiments/first-board-pullback/twelve-factor-topn-ranking-study/result";
import {
  TWELVE_FACTOR_CODES,
  compositeScoreOf,
  type TwelveFactorCode,
  type TwelveFactorSample,
} from "../../../research-experiments/first-board-pullback/twelve-factor-composite-study/result";

/** 6 个落在不同桶里的换手率（turnover 桶边界固定：<1 / <2 / <3 / <5 / <10 / ≥10）。 */
const TURNOVER_VALUES = [0.5, 1.5, 2.5, 4, 7, 15] as const;
/** 同日成交额分位：两个取值 ⇒ 把 6 个桶的组合扩成 12 个样本。 */
const AMOUNT_PERCENTILES = [0.05, 0.95] as const;
const SAMPLES_PER_DAY = TURNOVER_VALUES.length * AMOUNT_PERCENTILES.length;
const DATES = ["2025-01-06", "2025-01-07", "2025-01-08"] as const;

function factorsOf(
  turnover: number,
  amountPercentile: number
): Record<TwelveFactorCode, number | null> {
  const factors = {} as Record<TwelveFactorCode, number | null>;
  for (const code of TWELVE_FACTOR_CODES) factors[code] = 1;
  factors.turnover = turnover;
  factors.amountPercentile = amountPercentile;
  // limitGap 的 UNKNOWN 桶由 null 表达，这里给一个确定的间隔值。
  factors.limitGap = 10;
  return factors;
}

/**
 * 构造「净收益 = 综合评分」的样本：
 * 同日横截面上，评分高的样本收益一定高 ⇒ Top-N 超额必然为正、反转臂必然为负。
 * 这样断言不依赖任何桶边界的具体取值。
 */
function buildSamples(): TwelveFactorSample[] {
  const samples: TwelveFactorSample[] = [];
  for (const date of DATES) {
    let index = 0;
    for (const amountPercentile of AMOUNT_PERCENTILES) {
      for (const turnover of TURNOVER_VALUES) {
        const factors = factorsOf(turnover, amountPercentile);
        const score = compositeScoreOf(factors, TWELVE_FACTOR_CODES);
        expect(score).not.toBeNull();
        samples.push({
          eventId: `${date}-${String(index).padStart(2, "0")}`,
          eventDate: date,
          year: Number(date.slice(0, 4)),
          entryOpen: 10,
          exitPrice: 10,
          netReturn: Math.round(score! * 1e6) / 1e6,
          mfe: 0.05,
          mae: -0.05,
          factors,
        });
        index += 1;
      }
    }
  }
  return samples;
}

function buildArgs(
  samples: readonly TwelveFactorSample[],
  excludedByReason: Record<string, number> = { MISSING_PREFIX_PATH: 3 }
): AssembleTopNRankingArgs {
  const excluded = Object.values(excludedByReason).reduce(
    (sum, value) => sum + value,
    0
  );
  return {
    samples,
    candidateCount: samples.length + excluded,
    exactLimitUpCloseCount: samples.length + excluded,
    excludedByReason,
    factorMissingByCode: {},
    datasetEventCount: samples.length + excluded,
    unscannedEventCount: 0,
    duplicateEventIdCount: 0,
    crossSectionPeerCount: samples.length,
    prefixWindowMissingCount: excluded,
  };
}

describe("twelve-factor-topn-ranking-study · 装配层", () => {
  const samples = buildSamples();
  const payload = assembleTopNRanking(buildArgs(samples));
  const custom = topNRankingSchema.parse(payload.customPayload);

  it("customPayload 通过 topNRankingSchema（真实 Run 的 schema 校验前置到这里）", () => {
    expect(custom.rankingContractId).toBe("TOPN-RANKING-001");
    expect(custom.bucketContractId).toBe("FROZEN-BUCKET-CONTRACT-001");
    expect(custom.bucketFingerprint.startsWith("fnv1a32:")).toBe(true);
    expect(custom.rankingKeys.length).toBe(RANKING_KEYS.length);
    expect(custom.disclosures.length).toBeGreaterThan(0);
  });

  it("样本账平：candidate = eligible + excluded，且逐因原因合计相等", () => {
    const summary = payload.sampleSummary;
    expect(summary.candidateCount).toBe(samples.length + 3);
    expect(summary.eligibleCount).toBe(samples.length);
    expect(summary.excludedCount).toBe(3);
    expect(
      Object.values(summary.excludedByReason).reduce((a, b) => a + b, 0)
    ).toBe(3);
  });

  it("样本账不守恒时立刻抛错（不允许悄悄产出一份对不上的结果）", () => {
    expect(() =>
      assembleTopNRanking({
        ...buildArgs(samples),
        excludedByReason: { MISSING_PREFIX_PATH: 2 },
      })
    ).toThrow(/样本账不守恒/u);
  });

  it("决策日诊断：3 个交易日、每日 12 只，全部达到固定日集门槛", () => {
    expect(custom.dayDiagnostics.daysTotal).toBe(DATES.length);
    expect(custom.dayDiagnostics.daysAtLeast10).toBe(DATES.length);
    expect(custom.dayDiagnostics.daySizeP50).toBe(SAMPLES_PER_DAY);
    expect(custom.dayDiagnostics.daySizeMin).toBe(SAMPLES_PER_DAY);
  });

  it("主判据符号：收益随评分单调 ⇒ 综合评分 Top-N 超额为正、反转臂为负", () => {
    const top5 = custom.headline.find(
      row =>
        row.key === COMPOSITE_RANKING_KEY &&
        row.size === "N5" &&
        row.scope === "OWN"
    )!;
    const reversed5 = custom.headline.find(
      row =>
        row.key === COMPOSITE_REVERSED_RANKING_KEY &&
        row.size === "N5" &&
        row.scope === "OWN"
    )!;
    expect(top5.daysIncluded).toBe(DATES.length);
    expect(top5.excessMean).toBeGreaterThan(0);
    expect(top5.excessCi95Low).toBeGreaterThan(0);
    expect(top5.dayWinRate).toBe(1);
    expect(reversed5.excessMean).toBeLessThan(0);
    expect(reversed5.excessCi95High).toBeLessThan(0);
  });

  it("Top-N 确实取到「高分在前」：N10 每天选出 10 个（共 30 个）、N1 共 3 个", () => {
    const n10 = custom.headline.find(
      row =>
        row.key === COMPOSITE_RANKING_KEY &&
        row.size === "N10" &&
        row.scope === "OWN"
    )!;
    const n1 = custom.headline.find(
      row =>
        row.key === COMPOSITE_RANKING_KEY &&
        row.size === "N1" &&
        row.scope === "OWN"
    )!;
    expect(n10.picks).toBe(DATES.length * 10);
    expect(n1.picks).toBe(DATES.length);
    // 12 只里取 10 ⇒ 头部 10 个的均值必然高于当日池
    const pool = custom.headline.find(
      row =>
        row.key === COMPOSITE_RANKING_KEY &&
        row.size === "N10" &&
        row.scope === "OWN"
    )!;
    expect(pool.portfolioMean!).toBeGreaterThan(pool.poolMean!);
  });

  it("日数 < 100 ⇒ 判定必须是 INSUFFICIENT（不允许在小样本上给 POSITIVE）", () => {
    for (const row of custom.headline) {
      expect(row.excessVerdict).toBe("INSUFFICIENT");
      expect(row.portfolioVerdict).toBe("INSUFFICIENT");
    }
  });

  it("固定日集（≥10）把 6 档锁在同一批决策日上（可横向比较）", () => {
    const deepRows = custom.headline.filter(row => row.scope === "DEEP");
    expect(deepRows.length).toBe(RANKING_KEYS.length * TOP_N_SPECS.length);
    for (const row of deepRows) {
      expect(row.daysIncluded).toBe(DATES.length);
      expect(row.daysExcludedSmall).toBe(0);
    }
  });

  it("本职日集：Top-10 与 Top-20% 门槛不同，但本 fixture 下都纳入全部 3 日", () => {
    const ownRows = custom.headline.filter(row => row.scope === "OWN");
    for (const row of ownRows) {
      expect(row.daysIncluded).toBe(DATES.length);
    }
    // 比例档：12 × 20% ≈ 2 个；固定档 Top-10 ⇒ 10 个
    const ratio = custom.headline.find(
      row =>
        row.key === COMPOSITE_RANKING_KEY &&
        row.size === "P20" &&
        row.scope === "OWN"
    )!;
    expect(ratio.picks).toBe(DATES.length * 2);
  });

  it("表格齐全且行数正确（主表 / 对照矩阵 / 深度曲线 / 随机基准 / 年度 / 日样本量）", () => {
    const tables = payload.tables ?? [];
    const of = (key: string) => tables.find(table => table.key === key)!;
    expect(of("topn_headline").rows.length).toBe(TOP_N_SPECS.length * 2);
    expect(of("topn_key_matrix").rows.length).toBe(
      RANKING_KEYS.length * TOP_N_SPECS.length
    );
    expect(of("topn_depth_curve").rows.length).toBe(20);
    expect(of("topn_random_benchmark").rows.length).toBe(TOP_N_SPECS.length);
    expect(of("topn_yearly").rows.length).toBe(1 * 4);
    expect(of("topn_day_size").rows.length).toBeGreaterThan(0);
    expect(of("topn_day_size_summary").rows.length).toBeGreaterThan(0);
  });

  it("深度曲线在 K ≤ 12 时有值、K > 12 时取不满但仍有日（不出现 NaN）", () => {
    for (const row of custom.depthCurve) {
      expect(row.daysIncluded).toBe(DATES.length);
      if (row.k <= SAMPLES_PER_DAY) {
        expect(row.excessMean).not.toBeNull();
        expect(Number.isFinite(row.excessMean!)).toBe(true);
      }
      expect(row.excessMean === null || Number.isFinite(row.excessMean)).toBe(
        true
      );
    }
  });

  it("随机基准：随机 N 的均值落在当日池附近，实际组合均值高于随机中位", () => {
    const benchmark = custom.randomBenchmark.find(row => row.size === "N5")!;
    expect(benchmark.simulations).toBe(1_000);
    expect(benchmark.daysIncluded).toBe(DATES.length);
    expect(benchmark.randomMean).not.toBeNull();
    expect(benchmark.observed).not.toBeNull();
    expect(benchmark.observed!).toBeGreaterThan(benchmark.randomP50!);
  });

  it("参照自检字段存在且为布尔（合成样本必然与 12F 的参照不一致）", () => {
    expect(custom.referenceCheck.referenceCandidateCount).toBe(73_003);
    expect(custom.referenceCheck.referenceEligibleCount).toBe(70_236);
    expect(custom.referenceCheck.matchesCandidateCount).toBe(false);
    expect(custom.referenceCheck.matchesEligibleCount).toBe(false);
  });

  it("固定日集门槛常量被如实写进 payload（口径可被事后审计）", () => {
    expect(custom.dayGrouping.deepDayMinSize).toBe(DEEP_DAY_MIN_SIZE);
    expect(custom.dayGrouping.minDayCount).toBe(100);
  });
});
