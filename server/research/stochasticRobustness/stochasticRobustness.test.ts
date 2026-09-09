/**
 * STEP 18 / C-18.2 — 随机化鲁棒性测试（MC / Bootstrap / Trade Order）单测。
 *
 * 覆盖（任务验收 ①-⑥）：
 *   ① 正确性（手算 / 已知分布）：路径统计手算、MaxDD 顺序差异手算、分位摘要与
 *      置信区间按已知数组 [1..10] 手算、百分位中秩口径手算、尾部概率构造校验；
 *   ② 三方法各自语义：MC 分布与基准位置、Bootstrap CI + 描述性显著性（非假设检验）、
 *      Trade Order **总收益顺序不变**（集合依赖）+ **MaxDD 随顺序变化**（路径依赖）；
 *   ③ MC 与 Bootstrap 共用同一有放回抽样核（同 seed 同序列 → 同抽样下标）；
 *   ④ 确定性（同 seed 两次深比较 + 指纹相同；不同 seed 指纹不同）；
 *   ⑤ 退化输入（空序列 / 单点 / 收益 <= -100% / 非法 seed / 非法次数 / 非法 alpha /
 *      缺序列 / 空身份 / 全失败 / 迭代不足）→ 结构化抛错或 inconclusive；
 *   ⑥ round-trip + 篡改拒绝 + 指纹确定性 + evaluator 注入与失败转记。
 */

import { describe, expect, it } from "vitest";
import { ResearchValidationError } from "../experimentValidation";
import {
  assessStochasticBootstrapSignificance,
  generateBootstrapSpecimens,
} from "./bootstrap";
import {
  computeStochasticConfidenceInterval,
  computeStochasticPercentileRank,
  computeStochasticTailProbabilities,
  summarizeStochasticDistribution,
  summarizeStochasticQuantiles,
} from "./distribution";
import { generateMonteCarloSpecimens, resolveStochasticMonteCarloSource } from "./monteCarlo";
import {
  createStochasticPrng,
  permuteStochasticIndexes,
  resampleStochasticIndexesWithReplacement,
  stochasticRandomInt,
} from "./prng";
import {
  runBootstrapRobustness,
  runMonteCarloRobustness,
  runStochasticRobustness,
  runTradeOrderRandomization,
  generateStochasticRobustnessRunId,
  resolveStochasticRunContext,
} from "./run";
import {
  assertValidStochasticRobustnessRun,
  computeStochasticDrawFingerprint,
  computeStochasticInputFingerprint,
  computeStochasticRunFingerprint,
  deserializeStochasticRobustnessRun,
  serializeStochasticRobustnessRun,
  validateStochasticRobustnessRun,
} from "./serialize";
import {
  computeStochasticMaxDrawdownPct,
  computeStochasticPathMetrics,
  validateStochasticMetricsView,
  validateStochasticSeries,
} from "./statistics";
import {
  assertStochasticOrderTotalReturnInvariant,
  computeStochasticTotalReturnSpreadPct,
  generateTradeOrderSpecimens,
} from "./tradeOrder";
import {
  STOCHASTIC_DEFAULT_ITERATIONS,
  STOCHASTIC_METHOD_ORDER_RANDOMIZATION,
  type StochasticMetricsView,
  type StochasticRobustnessRequest,
  type StochasticRobustnessRun,
} from "./types";
import { collectStochasticSensitivityFlags } from "./verdict";

// ---------------------------------------------------------------------------
// helpers / fixtures
// ---------------------------------------------------------------------------

function request(overrides: Partial<StochasticRobustnessRequest> = {}): StochasticRobustnessRequest {
  return {
    strategyId: "strat-limitup-v1",
    strategyVersion: "1.2.0",
    method: "bootstrap",
    seed: 20260907,
    stochasticRunId: "STOCH-BOOT-20260907",
    createdAt: "2026-09-07T04:00:00.000Z",
    iterations: 50,
    minIterationsForVerdict: 10,
    tradeReturns: [0.05, -0.02, 0.03, -0.01, 0.04],
    ...overrides,
  };
}

/** 三笔差异较大的收益（用于顺序依赖手算）：a=+50%, b=-20%, c=-40%。 */
const THREE_TRADES = [0.5, -0.2, -0.4] as const;

// ---------------------------------------------------------------------------
// ① 正确性：路径统计手算
// ---------------------------------------------------------------------------

describe("C-18.2 路径统计（手算）", () => {
  it("复利总收益与最大回撤按手算一致：[+10%, -5%] → 4.5% / 5%", () => {
    const metrics = computeStochasticPathMetrics({
      stepReturns: [0.1, -0.05],
      sourceKind: "dailyReturn",
      annualizationFactor: 252,
      tradeCount: null,
    });
    expect(metrics.totalReturnPct).toBeCloseTo(4.5, 12);
    expect(metrics.maxDrawdownPct).toBeCloseTo(5, 12);
  });

  it("最大回撤依赖顺序：[+50%,-20%,-40%] → 52%，[-20%,+50%,-40%] → 40%（总收益同为 -28%）", () => {
    const orderA = computeStochasticMaxDrawdownPct([0.5, -0.2, -0.4]);
    const orderB = computeStochasticMaxDrawdownPct([-0.2, 0.5, -0.4]);
    expect(orderA).toBeCloseTo(52, 12);
    expect(orderB).toBeCloseTo(40, 12);

    const metricsA = computeStochasticPathMetrics({
      stepReturns: [0.5, -0.2, -0.4],
      sourceKind: "tradeReturn",
      annualizationFactor: 252,
      tradeCount: 3,
    });
    const metricsB = computeStochasticPathMetrics({
      stepReturns: [-0.2, 0.5, -0.4],
      sourceKind: "tradeReturn",
      annualizationFactor: 252,
      tradeCount: 3,
    });
    expect(metricsA.totalReturnPct).toBeCloseTo(-28, 12);
    expect(metricsB.totalReturnPct).toBeCloseTo(-28, 12);
  });

  it("trade 级序列的 Sharpe 不年化（每笔口径），日收益序列按年化因子放大", () => {
    const trade = computeStochasticPathMetrics({
      stepReturns: [0.01, -0.005, 0.02, -0.01],
      sourceKind: "tradeReturn",
      annualizationFactor: 252,
      tradeCount: 4,
    });
    const daily = computeStochasticPathMetrics({
      stepReturns: [0.01, -0.005, 0.02, -0.01],
      sourceKind: "dailyReturn",
      annualizationFactor: 252,
      tradeCount: null,
    });
    expect(trade.sharpe).not.toBeNull();
    expect(daily.sharpe).not.toBeNull();
    // 同序列下 年化 = 每笔 × √252
    expect(daily.sharpe!).toBeCloseTo(trade.sharpe! * Math.sqrt(252), 10);
  });

  it("序列与绩效标量校验：NaN / <=-100% / 长度不足一律拒绝", () => {
    expect(validateStochasticSeries([], "tradeReturns")).toContain("不能为空");
    expect(validateStochasticSeries([0.1], "tradeReturns")).toContain("< 2");
    expect(validateStochasticSeries([-1, 0.1], "tradeReturns")).toContain("-100%");
    expect(validateStochasticSeries([-1.5, 0.1], "tradeReturns")).toContain("-100%");
    expect(validateStochasticSeries([Number.NaN, 0.1], "tradeReturns")).toContain("有限数字");
    expect(validateStochasticSeries([0.1, 0.2], "tradeReturns")).toBeNull();

    expect(validateStochasticMetricsView({
      totalReturnPct: Number.NaN,
      maxDrawdownPct: 1,
      sharpe: null,
      tradeCount: null,
    })).toContain("NaN");
    expect(validateStochasticMetricsView({
      totalReturnPct: 1,
      maxDrawdownPct: -1,
      sharpe: null,
      tradeCount: null,
    })).toContain("不能为负");
    expect(validateStochasticMetricsView({
      totalReturnPct: 1,
      maxDrawdownPct: 1,
      sharpe: null,
      tradeCount: 2,
    })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ① 正确性：PRNG / 抽样核
// ---------------------------------------------------------------------------

describe("C-18.2 PRNG 与抽样核", () => {
  it("mulberry32 同 seed 确定性、输出落在 [0,1)", () => {
    const a = createStochasticPrng(12345);
    const b = createStochasticPrng(12345);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    const c = createStochasticPrng(12346);
    expect(c()).not.toBe(seqA[0]);
  });

  it("stochasticRandomInt 拒绝非法 upper", () => {
    const rng = createStochasticPrng(1);
    expect(() => stochasticRandomInt(rng, 0)).toThrow(/upper/);
    expect(() => stochasticRandomInt(rng, 1.5)).toThrow(/upper/);
  });

  it("有放回抽样：长度 = n、下标落在 [0,n)、同 seed 可复现", () => {
    const drawsA = resampleStochasticIndexesWithReplacement(createStochasticPrng(7), 12);
    const drawsB = resampleStochasticIndexesWithReplacement(createStochasticPrng(7), 12);
    expect(drawsA).toEqual(drawsB);
    expect(drawsA).toHaveLength(12);
    for (const index of drawsA) {
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(12);
    }
  });

  it("无放回置换：结果是 0..n-1 的排列（集合不变、无重复）", () => {
    const order = permuteStochasticIndexes(createStochasticPrng(99), 8);
    expect(order).toHaveLength(8);
    expect([...order].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(order).size).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// ① 正确性：分布摘要 / CI / 百分位 / 尾部概率（已知数组手算）
// ---------------------------------------------------------------------------

describe("C-18.2 分布摘要与置信区间（已知数组 1..10 手算）", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("分位摘要按线性插值手算一致", () => {
    const summary = summarizeStochasticQuantiles(values);
    expect(summary.count).toBe(10);
    expect(summary.mean).toBeCloseTo(5.5, 12);
    expect(summary.min).toBe(1);
    expect(summary.max).toBe(10);
    expect(summary.p05).toBeCloseTo(1.45, 12);
    expect(summary.p25).toBeCloseTo(3.25, 12);
    expect(summary.median).toBeCloseTo(5.5, 12);
    expect(summary.p75).toBeCloseTo(7.75, 12);
    expect(summary.p95).toBeCloseTo(9.55, 12);
    expect(summary.stdDev).not.toBeNull();
  });

  it("95% 置信区间 = [1.225, 9.775]", () => {
    const ci = computeStochasticConfidenceInterval(values, 0.05);
    expect(ci.levelPct).toBeCloseTo(95, 12);
    expect(ci.lower).toBeCloseTo(1.225, 12);
    expect(ci.upper).toBeCloseTo(9.775, 12);
  });

  it("基准百分位采用中秩口径：baseline=5 → 45", () => {
    expect(computeStochasticPercentileRank(values, 5)).toBeCloseTo(45, 12);
    expect(computeStochasticPercentileRank(values, 1)).toBeCloseTo(5, 12);
    expect(computeStochasticPercentileRank(values, null)).toBeNull();
  });

  it("空样本拒绝静默产出（抛错）", () => {
    expect(() => summarizeStochasticQuantiles([])).toThrow(/样本为空/);
    expect(() => computeStochasticConfidenceInterval([], 0.05)).toThrow(/样本为空/);
    expect(() =>
      summarizeStochasticDistribution({
        samples: [],
        baseline: { totalReturnPct: 1, maxDrawdownPct: 1, sharpe: null, tradeCount: null },
        alpha: 0.05,
      })
    ).toThrow(/无成功样本/);
  });

  it("尾部概率按构造值精确计算", () => {
    const samples: StochasticMetricsView[] = [
      { totalReturnPct: -5, maxDrawdownPct: 30, sharpe: -0.5, tradeCount: 3 },
      { totalReturnPct: 5, maxDrawdownPct: 10, sharpe: 0.5, tradeCount: 3 },
      { totalReturnPct: -1, maxDrawdownPct: 25, sharpe: null, tradeCount: 3 },
      { totalReturnPct: 2, maxDrawdownPct: 5, sharpe: 0.1, tradeCount: 3 },
    ];
    const tail = computeStochasticTailProbabilities({ samples, drawdownThresholdPct: 20 });
    expect(tail.probLossPct).toBeCloseTo(50, 12);
    expect(tail.probDrawdownExceedsPct).toBeCloseTo(50, 12);
    expect(tail.drawdownThresholdPct).toBe(20);
    // 3 个有效 sharpe 中 1 个为负
    expect(tail.probNegativeSharpePct).toBeCloseTo((1 / 3) * 100, 12);
  });
});

// ---------------------------------------------------------------------------
// ② Monte Carlo
// ---------------------------------------------------------------------------

describe("C-18.2 Monte Carlo", () => {
  it("源解析：显式 dailyReturn 缺序列 → 响亮失败（不静默降级到 trade）", () => {
    expect(() => resolveStochasticMonteCarloSource({ monteCarloMode: "dailyReturn" })).toThrow(
      /dailyReturns/
    );
    expect(() => resolveStochasticMonteCarloSource({ monteCarloMode: "tradeReturn" })).toThrow(
      /tradeReturns/
    );
    expect(() => resolveStochasticMonteCarloSource({})).toThrow(/缺少收益序列/);
    expect(resolveStochasticMonteCarloSource({ dailyReturns: [0.01, 0.02] }).sourceKind).toBe(
      "dailyReturn"
    );
    expect(resolveStochasticMonteCarloSource({ tradeReturns: [0.01, 0.02] }).sourceKind).toBe(
      "tradeReturn"
    );
  });

  it("MC：样本数 = iterations，分布计数一致，基准落在分布中部", () => {
    const run = runMonteCarloRobustness(
      request({
        method: "monteCarlo",
        monteCarloMode: "tradeReturn",
        tradeReturns: [0.05, -0.02, 0.03, -0.01, 0.04, 0.02, -0.03],
        iterations: 200,
      }) as Omit<StochasticRobustnessRequest, "method">
    );
    expect(run.method).toBe("monteCarlo");
    expect(run.samples).toHaveLength(200);
    expect(run.distribution).not.toBeNull();
    expect(run.distribution!.totalReturnPct.summary.count).toBe(200);
    expect(run.conclusion.successCount).toBe(200);
    expect(run.conclusion.failedCount).toBe(0);
    const percentile = run.distribution!.totalReturnPct.baselinePercentile!;
    expect(percentile).toBeGreaterThan(5);
    expect(percentile).toBeLessThan(95);
  });

  it("MC：全负收益序列 → P(收益<0)=100%、P(MaxDD>20%)=100%", () => {
    const run = runMonteCarloRobustness(
      request({
        method: "monteCarlo",
        monteCarloMode: "dailyReturn",
        dailyReturns: Array.from({ length: 20 }, () => -0.1),
        iterations: 60,
      }) as Omit<StochasticRobustnessRequest, "method">
    );
    expect(run.tailProbabilities!.probLossPct).toBeCloseTo(100, 12);
    expect(run.tailProbabilities!.probDrawdownExceedsPct).toBeCloseTo(100, 12);
  });

  it("MC 与 Bootstrap 共用同一有放回抽样核（同 seed 同序列 → 同抽样下标）", () => {
    const tradeReturns = [0.05, -0.02, 0.03, -0.01, 0.04];
    const mc = generateMonteCarloSpecimens({
      seed: 4242,
      iterations: 5,
      source: tradeReturns,
      sourceKind: "tradeReturn",
      tradeCount: 5,
    });
    const boot = generateBootstrapSpecimens({
      seed: 4242,
      iterations: 5,
      tradeReturns,
      tradeCount: 5,
    });
    expect(mc.map((s) => s.drawIndexes)).toEqual(boot.map((s) => s.drawIndexes));
    expect(mc[0]!.stepReturns).toEqual(boot[0]!.stepReturns);
  });
});

// ---------------------------------------------------------------------------
// ② Bootstrap
// ---------------------------------------------------------------------------

describe("C-18.2 Bootstrap", () => {
  it("全正收益：CI 下界 > 0 → positiveReturnCiAboveZero=true，描述性判定为 within", () => {
    const run = runBootstrapRobustness(
      request({
        method: "bootstrap",
        tradeReturns: [0.02, 0.03, 0.01, 0.04, 0.02, 0.015],
        iterations: 200,
      }) as Omit<StochasticRobustnessRequest, "method">
    );
    expect(run.method).toBe("bootstrap");
    expect(run.bootstrapSignificance).not.toBeNull();
    expect(run.bootstrapSignificance!.positiveReturnCiAboveZero).toBe(true);
    expect(run.distribution!.totalReturnPct.confidenceInterval.lower).toBeGreaterThan(0);
    expect(run.bootstrapSignificance!.descriptiveVerdict).toBe("within_resample_distribution");
    // 描述性声明（不是假设检验承诺）必须出现在说明文本中
    expect(run.bootstrapSignificance!.note).toContain("非假设检验");
    expect(run.bootstrapSignificance!.note).toContain("无 p 值");
  });

  it("基准显著优于重抽样分布时 → above_resample_distribution（描述性，无 p 值）", () => {
    const distribution = summarizeStochasticDistribution({
      samples: Array.from({ length: 50 }, (_, i) => ({
        totalReturnPct: i * 0.1,
        maxDrawdownPct: 1,
        sharpe: 0.1,
        tradeCount: 5,
      })),
      baseline: { totalReturnPct: 99, maxDrawdownPct: 1, sharpe: 0.1, tradeCount: 5 },
      alpha: 0.05,
    });
    const significance = assessStochasticBootstrapSignificance({
      totalReturn: distribution.totalReturnPct,
      alpha: 0.05,
      baselineTotalReturnPct: 99,
    });
    expect(significance.descriptiveVerdict).toBe("above_resample_distribution");
    expect(significance.baselineTotalReturnPercentile).toBeCloseTo(100, 6);
  });
});

// ---------------------------------------------------------------------------
// ② Trade Order Randomization
// ---------------------------------------------------------------------------

describe("C-18.2 Trade Order Randomization", () => {
  it("置换样本：每笔总收益恒定（集合依赖），最大回撤取 40/52 两值（路径依赖）", () => {
    const specimens = generateTradeOrderSpecimens({
      seed: 2026,
      iterations: 40,
      tradeReturns: [...THREE_TRADES],
      tradeCount: 3,
    });
    expect(specimens).toHaveLength(40);
    const totals = new Set<number>();
    const drawdowns = new Set<number>();
    for (const specimen of specimens) {
      const metrics = computeStochasticPathMetrics({
        stepReturns: specimen.stepReturns,
        sourceKind: "tradeReturn",
        annualizationFactor: 252,
        tradeCount: 3,
      });
      totals.add(Number(metrics.totalReturnPct.toFixed(6)));
      drawdowns.add(Number(metrics.maxDrawdownPct.toFixed(6)));
      // 置换：交易集合不变
      expect([...specimen.drawIndexes].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    }
    expect([...totals]).toEqual([-28]);
    expect([...drawdowns].sort((a, b) => a - b)).toEqual([40, 52]);
  });

  it("顺序不变性守卫：spread 超容差 → 响亮失败；极差统计对空样本返回 null", () => {
    const metrics: StochasticMetricsView[] = [
      { totalReturnPct: -28, maxDrawdownPct: 40, sharpe: null, tradeCount: 3 },
      { totalReturnPct: -28.0000000001, maxDrawdownPct: 52, sharpe: null, tradeCount: 3 },
    ];
    expect(() => assertStochasticOrderTotalReturnInvariant(metrics)).not.toThrow();
    expect(() =>
      assertStochasticOrderTotalReturnInvariant([
        { totalReturnPct: -28, maxDrawdownPct: 40, sharpe: null, tradeCount: 3 },
        { totalReturnPct: -20, maxDrawdownPct: 52, sharpe: null, tradeCount: 3 },
      ])
    ).toThrow(/顺序不变性被破坏/);
    expect(() => assertStochasticOrderTotalReturnInvariant([])).toThrow(/无成功样本/);
    expect(computeStochasticTotalReturnSpreadPct([])).toEqual({
      minPct: null,
      maxPct: null,
      spreadPct: null,
    });
  });

  it("基准顺序最幸运（基准回撤 40% < 分布上尾 52%）→ DRAWDOWN_TAIL 敏感", () => {
    const run = runTradeOrderRandomization(
      request({
        method: "orderRandomization",
        tradeReturns: [-0.4, 0.5, -0.2],
        iterations: 60,
        minIterationsForVerdict: 10,
      }) as Omit<StochasticRobustnessRequest, "method">
    );
    expect(run.baseline.maxDrawdownPct).toBeCloseTo(40, 12);
    expect(run.distribution!.maxDrawdownPct.summary.p95).toBeCloseTo(52, 12);
    expect(run.conclusion.flags).toContain("DRAWDOWN_TAIL");
    expect(run.conclusion.verdict).toBe("sensitive");
    expect(run.conclusion.reasonCode).toBe("STOCHASTIC_DRAWDOWN_TAIL");
  });

  it("全部交易同收益（无路径差异）→ 无敏感标签 → stable", () => {
    const run = runTradeOrderRandomization(
      request({
        method: "orderRandomization",
        tradeReturns: [0.01, 0.01, 0.01, 0.01, 0.01],
        iterations: 40,
        minIterationsForVerdict: 10,
      }) as Omit<StochasticRobustnessRequest, "method">
    );
    expect(run.conclusion.flags).toEqual([]);
    expect(run.conclusion.verdict).toBe("stable");
    expect(run.conclusion.reasonCode).toBe("STOCHASTIC_STABLE");
    // 零波动 → Sharpe 为 null → 分布中 sharpe 段为 null（不伪造）
    expect(run.distribution!.sharpe).toBeNull();
  });

  it("敏感标签：CI 跨 0 → RETURN_CI_INCLUDES_ZERO；区间宽度超阈值 → RETURN_DISPERSION", () => {
    const baseline: StochasticMetricsView = {
      totalReturnPct: 0,
      maxDrawdownPct: 5,
      sharpe: null,
      tradeCount: 4,
    };
    const distribution = summarizeStochasticDistribution({
      samples: [
        { totalReturnPct: -8, maxDrawdownPct: 5, sharpe: null, tradeCount: 4 },
        { totalReturnPct: -2, maxDrawdownPct: 5, sharpe: null, tradeCount: 4 },
        { totalReturnPct: 1, maxDrawdownPct: 5, sharpe: null, tradeCount: 4 },
        { totalReturnPct: 9, maxDrawdownPct: 5, sharpe: null, tradeCount: 4 },
      ],
      baseline,
      alpha: 0.05,
    });
    const flags = collectStochasticSensitivityFlags({
      distribution,
      baseline,
      alpha: 0.05,
      thresholds: { returnDriftThresholdPct: 5, drawdownWorseningThresholdPct: 3 },
    });
    expect(flags).toContain("RETURN_CI_INCLUDES_ZERO");
    expect(flags).toContain("RETURN_DISPERSION");
    expect(flags).not.toContain("DRAWDOWN_TAIL");
  });
});

// ---------------------------------------------------------------------------
// ④ 确定性
// ---------------------------------------------------------------------------

describe("C-18.2 确定性", () => {
  const baseArgs = {
    method: "bootstrap" as const,
    tradeReturns: [0.05, -0.02, 0.03, -0.01, 0.04, 0.02, -0.03, 0.01],
    iterations: 120,
    minIterationsForVerdict: 10,
  };

  it("同 seed 两次运行：深比较一致 + 指纹一致", () => {
    const a = runStochasticRobustness(request({ ...baseArgs, seed: 777 }));
    const b = runStochasticRobustness(request({ ...baseArgs, seed: 777 }));
    expect(a).toEqual(b);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toBe(computeStochasticRunFingerprint(a));
  });

  it("不同 seed：指纹不同（抽样轨迹不同）", () => {
    const a = runStochasticRobustness(request({ ...baseArgs, seed: 777 }));
    const c = runStochasticRobustness(request({ ...baseArgs, seed: 778 }));
    expect(a.fingerprint).not.toBe(c.fingerprint);
    expect(a.samples[0]!.drawFingerprint).not.toBe(c.samples[0]!.drawFingerprint);
  });

  it("输入指纹只依赖源序列 + 基准（与 seed / 迭代次数无关）", () => {
    const a = runStochasticRobustness(request({ ...baseArgs, seed: 1 }));
    const b = runStochasticRobustness(request({ ...baseArgs, seed: 2 }));
    expect(a.inputFingerprint).toBe(b.inputFingerprint);
    expect(a.inputFingerprint).toBe(
      computeStochasticInputFingerprint({
        sourceKind: "tradeReturn",
        source: baseArgs.tradeReturns,
        tradeCount: 8,
        baseline: a.baseline,
      })
    );
  });

  it("抽样指纹：同下标序列同指纹，异序列异指纹", () => {
    expect(computeStochasticDrawFingerprint([1, 2, 3])).toBe(
      computeStochasticDrawFingerprint([1, 2, 3])
    );
    expect(computeStochasticDrawFingerprint([1, 2, 3])).not.toBe(
      computeStochasticDrawFingerprint([3, 2, 1])
    );
  });

  it("generateStochasticRobustnessRunId 按方法生成稳定 ID", () => {
    expect(generateStochasticRobustnessRunId("monteCarlo", 7)).toBe("STOCH-MC-7");
    expect(generateStochasticRobustnessRunId("bootstrap", 7)).toBe("STOCH-BOOT-7");
    expect(generateStochasticRobustnessRunId(STOCHASTIC_METHOD_ORDER_RANDOMIZATION, 7)).toBe(
      "STOCH-ORD-7"
    );
  });
});

// ---------------------------------------------------------------------------
// ⑤ 退化输入
// ---------------------------------------------------------------------------

describe("C-18.2 退化输入（FAIL FAST）", () => {
  it("空序列 / 单点序列 → 抛错", () => {
    expect(() => runStochasticRobustness(request({ tradeReturns: [] }))).toThrow(
      ResearchValidationError
    );
    expect(() => runStochasticRobustness(request({ tradeReturns: [0.05] }))).toThrow(
      /< 2/
    );
  });

  it("收益 <= -100% → 抛错（禁止权益归零后除零）", () => {
    expect(() =>
      runStochasticRobustness(request({ tradeReturns: [0.1, -1] }))
    ).toThrow(/-100%/);
  });

  it("非法 seed（非整数 / NaN）→ 抛错", () => {
    expect(() => runStochasticRobustness(request({ seed: 1.5 }))).toThrow(/seed/);
    expect(() => runStochasticRobustness(request({ seed: Number.NaN }))).toThrow(/seed/);
  });

  it("非法迭代次数（0 / -1 / 非整数）→ 抛错", () => {
    expect(() => runStochasticRobustness(request({ iterations: 0 }))).toThrow(/iterations/);
    expect(() => runStochasticRobustness(request({ iterations: -1 }))).toThrow(/iterations/);
    expect(() => runStochasticRobustness(request({ iterations: 10.5 }))).toThrow(/iterations/);
  });

  it("非法 alpha / 年化因子 / 尾部阈值 / minIterations → 抛错", () => {
    expect(() => runStochasticRobustness(request({ alpha: 0 }))).toThrow(/alpha/);
    expect(() => runStochasticRobustness(request({ alpha: 1 }))).toThrow(/alpha/);
    expect(() => runStochasticRobustness(request({ annualizationFactor: 0 }))).toThrow(
      /annualizationFactor/
    );
    expect(() => runStochasticRobustness(request({ tailDrawdownThresholdPct: -1 }))).toThrow(
      /tailDrawdownThresholdPct/
    );
    expect(() => runStochasticRobustness(request({ minIterationsForVerdict: 0 }))).toThrow(
      /minIterationsForVerdict/
    );
  });

  it("bootstrap / orderRandomization 缺 tradeReturns → 抛错（不静默用日收益）", () => {
    expect(() =>
      runStochasticRobustness(
        request({ method: "bootstrap", tradeReturns: undefined, dailyReturns: [0.01, 0.02] })
      )
    ).toThrow(/trade 级收益序列/);
    expect(() =>
      runStochasticRobustness(
        request({ method: "orderRandomization", tradeReturns: undefined, dailyReturns: [0.01, 0.02] })
      )
    ).toThrow(/trade 级收益序列/);
  });

  it("非法 method / 空身份字段 → 抛错", () => {
    expect(() => runStochasticRobustness(request({ method: "unknown" as never }))).toThrow(
      /method/
    );
    expect(() => runStochasticRobustness(request({ strategyId: "  " }))).toThrow(
      /strategyId/
    );
    expect(() => runStochasticRobustness(request({ createdAt: "" }))).toThrow(/createdAt/);
  });

  it("注入的基准绩效非法 → 抛错", () => {
    expect(() =>
      runStochasticRobustness(
        request({
          baseline: { totalReturnPct: Number.NaN, maxDrawdownPct: 1, sharpe: null, tradeCount: null },
        })
      )
    ).toThrow(/基准绩效非法/);
  });

  it("全部迭代评估失败 → inconclusive(INSUFFICIENT_SAMPLES)，distribution 为 null", () => {
    const run = runStochasticRobustness(
      request({ iterations: 20, evaluator: () => { throw new Error("boom"); } })
    );
    expect(run.conclusion.verdict).toBe("inconclusive");
    expect(run.conclusion.reasonCode).toBe("STOCHASTIC_INSUFFICIENT_SAMPLES");
    expect(run.conclusion.successCount).toBe(0);
    expect(run.conclusion.failedCount).toBe(20);
    expect(run.distribution).toBeNull();
    expect(run.tailProbabilities).toBeNull();
    expect(run.samples[0]!.error).toContain("boom");
  });

  it("成功迭代数低于判定门槛 → inconclusive(INSUFFICIENT_ITERATIONS)", () => {
    const run = runStochasticRobustness(
      request({ iterations: 5, minIterationsForVerdict: 30 })
    );
    expect(run.conclusion.verdict).toBe("inconclusive");
    expect(run.conclusion.reasonCode).toBe("STOCHASTIC_INSUFFICIENT_ITERATIONS");
    expect(run.distribution).not.toBeNull();
  });

  it("evaluator 返回非法标量 → 该迭代转记 failed（不静默吞掉）", () => {
    let calls = 0;
    const run = runStochasticRobustness(
      request({
        iterations: 10,
        minIterationsForVerdict: 5,
        evaluator: () => {
          calls += 1;
          return {
            totalReturnPct: calls === 1 ? Number.NaN : 1,
            maxDrawdownPct: 1,
            sharpe: null,
            tradeCount: 5,
          };
        },
      })
    );
    expect(calls).toBe(10);
    expect(run.conclusion.failedCount).toBe(1);
    expect(run.samples[0]!.error).toContain("评估产物非法");
  });
});

// ---------------------------------------------------------------------------
// ② evaluator 注入（不跑回测，仅验证注入语义与样本可达）
// ---------------------------------------------------------------------------

describe("C-18.2 evaluator 注入", () => {
  it("每次迭代调 evaluator 恰一次，且拿到完整 specimen", () => {
    const seen: number[] = [];
    const run = runStochasticRobustness(
      request({
        method: "monteCarlo",
        monteCarloMode: "tradeReturn",
        tradeReturns: [0.05, -0.02, 0.03, -0.01],
        iterations: 12,
        minIterationsForVerdict: 5,
        evaluator: (specimen) => {
          seen.push(specimen.iteration);
          expect(specimen.drawIndexes).toHaveLength(4);
          expect(specimen.stepReturns).toHaveLength(4);
          expect(specimen.method).toBe("monteCarlo");
          return { totalReturnPct: 1, maxDrawdownPct: 2, sharpe: 0.5, tradeCount: 4 };
        },
      })
    );
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(run.conclusion.successCount).toBe(12);
    // 注入口径下分布由 evaluator 决定
    expect(run.distribution!.totalReturnPct.summary.median).toBe(1);
  });

  it("resolveStochasticRunContext：缺省基准由源序列按内置口径计算", () => {
    const context = resolveStochasticRunContext(
      request({ method: "monteCarlo", monteCarloMode: "dailyReturn", dailyReturns: [0.1, -0.05] })
    );
    expect(context.baseline.totalReturnPct).toBeCloseTo(4.5, 12);
    expect(context.baseline.maxDrawdownPct).toBeCloseTo(5, 12);
    expect(context.config.sourceKind).toBe("dailyReturn");
    expect(context.config.confidenceLevelPct).toBeCloseTo(95, 12);
    expect(context.config.thresholds).toEqual({
      returnDriftThresholdPct: 5,
      drawdownWorseningThresholdPct: 3,
    });
    expect(context.config.iterations).toBe(50);
  });

  it("缺省迭代次数常量可用（不写死 500 于测试逻辑）", () => {
    const context = resolveStochasticRunContext(request({ iterations: undefined }));
    expect(context.config.iterations).toBe(STOCHASTIC_DEFAULT_ITERATIONS);
  });
});

// ---------------------------------------------------------------------------
// ⑥ round-trip 与篡改拒绝
// ---------------------------------------------------------------------------

describe("C-18.2 序列化 / 指纹 / 篡改拒绝", () => {
  function sampleRun(): StochasticRobustnessRun {
    return runStochasticRobustness(
      request({
        method: "bootstrap",
        seed: 31415,
        tradeReturns: [0.05, -0.02, 0.03, -0.01, 0.04, 0.02],
        iterations: 80,
        minIterationsForVerdict: 10,
      })
    );
  }

  it("serialize → deserialize 深比较一致（round-trip）", () => {
    const run = sampleRun();
    const json = serializeStochasticRobustnessRun(run);
    const restored = deserializeStochasticRobustnessRun(json);
    expect(restored).toEqual(run);
    expect(validateStochasticRobustnessRun(run).valid).toBe(true);
    expect(() => assertValidStochasticRobustnessRun(restored)).not.toThrow();
  });

  it("篡改 baseline.totalReturnPct → 反序列化拒绝", () => {
    const run = sampleRun();
    const tampered = { ...run, baseline: { ...run.baseline, totalReturnPct: 999 } };
    expect(() =>
      deserializeStochasticRobustnessRun(JSON.stringify(tampered))
    ).toThrow(/指纹不匹配/);
  });

  it("篡改 seed → 反序列化拒绝", () => {
    const run = sampleRun();
    expect(() =>
      deserializeStochasticRobustnessRun(JSON.stringify({ ...run, seed: run.seed + 1 }))
    ).toThrow(/指纹不匹配/);
  });

  it("篡改 conclusion.verdict → 反序列化拒绝", () => {
    const run = sampleRun();
    const tampered = {
      ...run,
      conclusion: { ...run.conclusion, verdict: "stable" as const },
    };
    expect(() => deserializeStochasticRobustnessRun(JSON.stringify(tampered))).toThrow(
      /指纹不匹配/
    );
  });

  it("篡改 samples[0].drawFingerprint → 反序列化拒绝", () => {
    const run = sampleRun();
    const samples = [...run.samples];
    samples[0] = { ...samples[0]!, drawFingerprint: "f".repeat(64) };
    expect(() =>
      deserializeStochasticRobustnessRun(JSON.stringify({ ...run, samples }))
    ).toThrow(/指纹不匹配/);
  });

  it("结构校验能识别字段缺失与非法枚举", () => {
    const run = sampleRun();
    const broken = { ...run, method: "nope" };
    expect(validateStochasticRobustnessRun(broken).valid).toBe(false);
    expect(validateStochasticRobustnessRun(broken).issues[0]!.code).toBe(
      "STOCH18_RUN_METHOD_INVALID"
    );
    expect(validateStochasticRobustnessRun(null).valid).toBe(false);
    expect(validateStochasticRobustnessRun({ ...run, samples: [] }).valid).toBe(true); // 空样本允许（inconclusive），但下项证明记录仍可往返
    expect(validateStochasticRobustnessRun({ ...run, seed: 1.5 }).valid).toBe(false);
    expect(validateStochasticRobustnessRun({ ...run, fingerprint: "zz" }).valid).toBe(false);
  });

  it("记录冻结：不可原地改写", () => {
    const run = sampleRun();
    expect(Object.isFrozen(run)).toBe(true);
    expect(() => {
      (run as { seed: number }).seed = 1;
    }).toThrow();
  });
});
