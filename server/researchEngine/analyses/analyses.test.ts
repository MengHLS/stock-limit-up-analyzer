/**
 * RESEARCH-002 — 五类 Analysis 执行器测试。
 *
 * 覆盖（指令 §17）：
 *   DESCRIPTIVE：mean / median / std / percentile
 *   EVENT_STUDY：T+1 / T+3 / T+5
 *   QUANTILE   ：5 / 10 分位、空数据、边界并列
 *   CONDITIONAL：单条件 / AND 条件 / 空条件
 *   STABILITY  ：year 分组 / regime 分组
 */

import { describe, expect, it } from "vitest";
import type { ResearchAnalysis, ResearchConditionSet } from "../../researchCore";
import { buildSampleSet } from "../sampleSet";
import { createDefaultAnalysisExecutorRegistry } from "./registry";
import { resolveEngineAnalysisConfig } from "../analysisConfig";
import { ResearchVariableCatalog } from "../variables";
import { buildSyntheticDataset, linearEvents, type SyntheticEventSpec } from "../testFixtures";
import type { AnalysisExecutionContext, ResolvedEngineAnalysisConfig } from "../types";

const registry = createDefaultAnalysisExecutorRegistry();

/**
 * 变量目录**刻意与真实 Dataset 保持同构**（这一点很关键）：
 *   - path 视界 = 1..20      （物理表 `ds_*_path.relativeDay` 的真实范围）
 *   - outcome 视界 = {5,10,20}（物理表 `ds_*_outcome.horizon` 的真实取值）
 *
 * 两者**不相等**：`future_return_*` 来自 path，`max_return_* / min_return_* /
 * max_drawdown_* / is_breakout_* / days_to_breakout_*` 来自 outcome。
 * 早前这里把 outcome 视界写成 [1,3,5,10,20]（比真实数据宽松），
 * 因而掩盖了「T+1 / T+3 没有 outcome 聚合列」这一类真实缺陷 —— 不要再改回去。
 */
const REAL_PATH_HORIZONS = Array.from({ length: 20 }, (_, i) => i + 1);
const REAL_OUTCOME_HORIZONS = [5, 10, 20];
const catalog = new ResearchVariableCatalog(REAL_OUTCOME_HORIZONS, REAL_PATH_HORIZONS);

function analysis(type: ResearchAnalysis["analysisType"], config: unknown, id = 777): ResearchAnalysis {
  return { id, runId: 1, analysisType: type, name: `${type}-test`, config, status: "PENDING" };
}

/**
 * 完整走 Engine 的执行路径（配置解析 → 变量需求 → 最小化装配 → 执行），
 * 不自己造样本，保证测的是真实链路。
 */
async function run(
  type: ResearchAnalysis["analysisType"],
  config: Record<string, unknown>,
  events: readonly SyntheticEventSpec[],
  options: { horizons?: readonly number[]; maxPathDay?: number; conditionSet?: ResearchConditionSet; regimeProvider?: (d: string) => string | null } = {},
) {
  const ds = buildSyntheticDataset({
    events,
    horizons: options.horizons ?? [5, 10, 20],
    maxPathDay: options.maxPathDay ?? 20,
  });
  const analysisRow = analysis(type, config);
  const executor = registry.require(type);
  const resolved: ResolvedEngineAnalysisConfig = resolveEngineAnalysisConfig({
    analysis: analysisRow,
    catalog,
    ...(options.regimeProvider ? { regimeProvider: { regimeLabelOf: options.regimeProvider } } : {}),
  });
  const conditionSet = options.conditionSet ?? { groups: [] };
  const requirement = executor.requiredVariables(resolved, { catalog, conditionSet });
  const set = await buildSampleSet({
    reader: ds.reader,
    datasetVersionId: ds.datasetVersionId,
    catalog,
    requirement,
    dimensionKeys: requirement.dimensions ?? [],
    ...(options.regimeProvider
      ? { regimeProvider: { regimeLabelOf: options.regimeProvider } }
      : {}),
  });
  const context: AnalysisExecutionContext = {
    analysis: analysisRow,
    config: resolved,
    datasetVersionId: ds.datasetVersionId,
    samples: set.samples,
    horizons: ds.context.horizons,
    conditionSet,
  };
  const result = await executor.execute(context);
  return { ds, resolved, requirement, result };
}

describe("DESCRIPTIVE", () => {
  it("输出 mean / median / std / percentile 且结构化落 dimension=variable", async () => {
    const events: SyntheticEventSpec[] = [1, 2, 3, 4, 5].map((v, i) => ({
      index: i,
      turnover: v,
      futureReturn: () => null,
    }));
    const { result } = await run("DESCRIPTIVE", { variables: ["turnover"] }, events);

    const byCode = new Map(result.rows.map((r) => [r.metricCode, r]));
    expect(byCode.get("MEAN")!.metricValue).toBeCloseTo(3, 10);
    expect(byCode.get("MEDIAN")!.metricValue).toBeCloseTo(3, 10);
    expect(byCode.get("STD")!.metricValue).toBeCloseTo(Math.sqrt(2.5), 10);
    expect(byCode.get("P50")!.metricValue).toBeCloseTo(3, 10);
    expect(byCode.get("SAMPLE_COUNT")!.metricValue).toBe(5);
    expect(byCode.get("MISSING_COUNT")!.metricValue).toBe(0);
    expect(byCode.get("MEAN")!.dimension).toEqual({ variable: "turnover" });
    expect(result.summary.effect).toBeNull();
  });

  it("缺失值如实计入 missing_count / missing_rate（不当 0）", async () => {
    const events: SyntheticEventSpec[] = [
      { index: 0, turnover: 1, futureReturn: () => null },
      { index: 1, turnover: null, futureReturn: () => null },
      { index: 2, turnover: 3, futureReturn: () => null },
      { index: 3, turnover: null, futureReturn: () => null },
    ];
    const { result } = await run("DESCRIPTIVE", { variables: ["turnover"] }, events);
    const byCode = new Map(result.rows.map((r) => [r.metricCode, r]));
    expect(byCode.get("SAMPLE_COUNT")!.metricValue).toBe(2);
    expect(byCode.get("MISSING_COUNT")!.metricValue).toBe(2);
    expect(byCode.get("MISSING_RATE")!.metricValue).toBeCloseTo(0.5, 10);
    expect(byCode.get("MEAN")!.metricValue).toBeCloseTo(2, 10);
  });
});

describe("EVENT_STUDY", () => {
  it("T+1 / T+3 / T+5 各自成组，均值与手算一致", async () => {
    const ret: Record<number, number> = { 1: 0.01, 3: 0.03, 5: 0.05 };
    const events: SyntheticEventSpec[] = [0, 1].map((i) => ({
      index: i,
      turnover: 5,
      futureReturn: (h) => ret[h] ?? null,
    }));
    const { result } = await run("EVENT_STUDY", { horizons: [1, 3, 5] }, events, { horizons: [1, 3, 5], maxPathDay: 10 });
    const means = result.rows.filter((r) => r.metricCode === "MEAN_RETURN");
    expect(means.map((r) => r.dimension)).toEqual([{ horizon: 1 }, { horizon: 3 }, { horizon: 5 }]);
    expect(means.map((r) => r.metricValue)).toEqual([0.01, 0.03, 0.05]);
    expect(result.summary.effect).toBeCloseTo(0.05, 10); // 主视界 = 样本并列时取视界最大者
  });

  it("MFE / MAE / 突破率来自 Dataset 真实列，且注明时间维度只实现 daysToBreakout", async () => {
    const events: SyntheticEventSpec[] = [0, 1, 2].map((i) => ({
      index: i,
      turnover: 5,
      futureReturn: (h) => (h === 5 ? 0.02 + i * 0.01 : null),
    }));
    const { result } = await run("EVENT_STUDY", { horizons: [5] }, events, { horizons: [5], maxPathDay: 5 });
    const codes = new Set(result.rows.map((r) => r.metricCode));
    expect(codes.has("MAX_FAVORABLE_EXCURSION")).toBe(true);
    expect(codes.has("MAX_ADVERSE_EXCURSION")).toBe(true);
    expect(codes.has("MAX_DRAWDOWN")).toBe(true);
    expect(codes.has("BREAKOUT_RATE")).toBe(true);
    expect(result.summary.notes.join(" ")).toContain("time_to_target");
  });

  it("无可用视界时不产出假数据，并在 notes 中说明", async () => {
    const events: SyntheticEventSpec[] = [{ index: 0, turnover: 5, futureReturn: () => null }];
    const { result } = await run("EVENT_STUDY", { horizons: [5] }, events, { horizons: [5], maxPathDay: 5 });
    expect(result.rows).toHaveLength(0);
    expect(result.summary.effect).toBeNull();
    expect(result.summary.notes.join(" ")).toContain("无任何可用收益样本");
  });

  it("回归：T+1/T+3 只存在于 path（无 outcome 聚合列）时不得失败，也不得虚构 MFE/MAE", async () => {
    // 真实 Dataset 形态：outcome 只覆盖 {5,10,20}，而 path 覆盖 1..20。
    // 早前实现会无条件要求 max_return_1d → 引擎在解析需求阶段直接 UNKNOWN_VARIABLE 失败。
    const ret: Record<number, number> = { 1: 0.01, 3: 0.03, 5: 0.05 };
    const events: SyntheticEventSpec[] = [0, 1, 2].map((i) => ({
      index: i,
      turnover: 5,
      futureReturn: (h) => ret[h] ?? null,
    }));

    const { result, requirement } = await run("EVENT_STUDY", { horizons: [1, 3, 5] }, events, {
      horizons: REAL_OUTCOME_HORIZONS,
      maxPathDay: 20,
    });

    // 需求里不得出现 Dataset 未登记的变量
    expect(requirement.outcomes).not.toContain("max_return_1d");
    expect(requirement.outcomes).not.toContain("max_return_3d");
    expect(requirement.outcomes).toContain("max_return_5d");

    // 三个视界的收益均值都要真实产出（来自 path）
    const means = result.rows.filter((r) => r.metricCode === "MEAN_RETURN");
    expect(means.map((r) => r.dimension)).toEqual([{ horizon: 1 }, { horizon: 3 }, { horizon: 5 }]);
    // 用 toBeCloseTo 而非 toEqual：均值内部走浮点求和，(0.05*3)/3 会得到 0.05000000000000001
    expect(means[0]!.metricValue).toBeCloseTo(0.01, 10);
    expect(means[1]!.metricValue).toBeCloseTo(0.03, 10);
    expect(means[2]!.metricValue).toBeCloseTo(0.05, 10);

    // MFE / MAE 只在 T+5 存在（outcome 有该视界），不得为 T+1/T+3 编造
    const mfeHorizons = result.rows
      .filter((r) => r.metricCode === "MAX_FAVORABLE_EXCURSION")
      .map((r) => (r.dimension as { horizon: number }).horizon);
    expect(mfeHorizons).toEqual([5]);

    // 缺失必须被如实记录（可追溯，不是静默丢弃）
    expect(result.summary.notes.join(" ")).toContain("Dataset 未提供");
    expect(result.summary.notes.join(" ")).toContain("max_return_1d");
  });
});

describe("QUANTILE", () => {
  it("10 分位：分组、每组统计与顶底分位差", async () => {
    const { result } = await run(
      "QUANTILE",
      { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10, minSampleCount: 1 },
      linearEvents(100),
    );
    const spread = result.rows.find((r) => r.metricCode === "SPREAD_TOP_BOTTOM")!;
    expect(spread.metricValue).toBeGreaterThan(0.05);
    expect(spread.details).toMatchObject({ requestedGroups: 10, actualGroups: 10, topGroup: 10, bottomGroup: 1 });
    const q10 = result.rows.find((r) => r.metricCode === "MEAN_RETURN" && JSON.stringify(r.dimension) === '{"quantile":10}');
    const q1 = result.rows.find((r) => r.metricCode === "MEAN_RETURN" && JSON.stringify(r.dimension) === '{"quantile":1}');
    expect(q10!.metricValue!).toBeGreaterThan(q1!.metricValue!);
    expect(result.summary.effect).toBeCloseTo(spread.metricValue!, 10);
  });

  it("5 分位：分组数 = 5", async () => {
    const { result } = await run(
      "QUANTILE",
      { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 5, minSampleCount: 1 },
      linearEvents(50),
    );
    expect(result.summary.groupCount).toBe(5);
  });

  it("空数据：不产出任何分组，且不产出顶底差（不编造 0）", async () => {
    const events: SyntheticEventSpec[] = [0, 1].map((i) => ({ index: i, turnover: null, futureReturn: () => null }));
    const { result } = await run("QUANTILE", { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10 }, events, { horizons: [5], maxPathDay: 5 });
    expect(result.rows).toHaveLength(0);
    expect(result.summary.effect).toBeNull();
    expect(result.summary.groupCount).toBe(0);
  });

  it("边界并列：相同特征值不被劈开，实际分组数如实少于请求值", async () => {
    // 50 个事件只有 2 个不同 turnover 取值 → 切点全部落在同一值附近，分组必然退化
    const events: SyntheticEventSpec[] = Array.from({ length: 50 }, (_, i) => ({
      index: i,
      turnover: i < 25 ? 5 : 9,
      futureReturn: (h) => (h === 5 ? (i < 25 ? 0.01 : 0.05) : null),
    }));
    const { result } = await run("QUANTILE", { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10 }, events, { horizons: [5], maxPathDay: 5 });
    expect(result.summary.groupCount).toBe(2);
    const spread = result.rows.find((r) => r.metricCode === "SPREAD_TOP_BOTTOM")!;
    expect(spread.metricValue).toBeCloseTo(0.04, 10);
    expect(result.summary.notes.join(" ")).toContain("并列");
    // 每个分组内部的特征值必须完全一致（未被劈开）
    expect(result.summary.minGroupSampleCount).toBe(25);
  });
});

describe("CONDITIONAL", () => {
  const events: SyntheticEventSpec[] = Array.from({ length: 40 }, (_, i) => ({
    index: i,
    turnover: i + 1,
    futureReturn: (h) => (h === 5 ? (i + 1 >= 8 && i + 1 <= 15 ? 0.08 : 0.01) : null),
  }));

  function conditionSet(conditions: Array<{ field: string; op: string; value: unknown; logical?: string }>): ResearchConditionSet {
    return {
      groups: [
        {
          groupNo: 0,
          groupLogicalOperator: "AND",
          conditions: conditions.map((c, i) => ({
            groupNo: 0,
            sortOrder: i,
            fieldName: c.field,
            operator: c.op as never,
            value: c.value as never,
            logicalOperator: (c.logical ?? "AND") as never,
            groupLogicalOperator: "AND" as never,
          })),
        },
      ],
    };
  }

  it("单条件：条件组 vs 全样本 + 差值 / 相对差值 / 组间检验", async () => {
    const { result } = await run(
      "CONDITIONAL",
      { targetField: "future_return_5d", minSampleCount: 1 },
      events,
      { horizons: [5], maxPathDay: 5, conditionSet: conditionSet([{ field: "turnover", op: ">=", value: 8 }]) },
    );
    const all = result.rows.find((r) => r.metricCode === "MEAN_RETURN" && r.dimension?.group === "ALL")!;
    const cond = result.rows.find((r) => r.metricCode === "MEAN_RETURN" && r.dimension?.group === "CONDITION")!;
    // 全样本：8 个 0.08 + 32 个 0.01 → 0.024
    expect(all.metricValue).toBeCloseTo((8 * 0.08 + 32 * 0.01) / 40, 10);
    expect(cond.sampleCount).toBe(33);
    const diff = result.rows.find((r) => r.metricCode === "DIFFERENCE")!;
    expect(diff.metricValue).toBeCloseTo(cond.metricValue! - all.metricValue!, 10);
    expect(result.rows.some((r) => r.metricCode === "RELATIVE_DIFFERENCE")).toBe(true);
    expect(result.rows.some((r) => r.metricCode === "P_VALUE_DIFFERENCE")).toBe(true);
    expect(result.rows.some((r) => r.metricCode === "MAX_DRAWDOWN")).toBe(true);
  });

  it("AND 条件：区间过滤（turnover BETWEEN 8 AND 15）", async () => {
    const { result } = await run(
      "CONDITIONAL",
      { targetField: "future_return_5d", minSampleCount: 1 },
      events,
      {
        horizons: [5],
        maxPathDay: 5,
        conditionSet: conditionSet([
          { field: "turnover", op: ">=", value: 8 },
          { field: "turnover", op: "<=", value: 15, logical: "AND" },
        ]),
      },
    );
    const cond = result.rows.find((r) => r.metricCode === "MEAN_RETURN" && r.dimension?.group === "CONDITION")!;
    expect(cond.sampleCount).toBe(8);
    expect(cond.metricValue).toBeCloseTo(0.08, 10);
  });

  it("空条件：显式失败（不静默退化成「等于全样本」）", async () => {
    await expect(
      run("CONDITIONAL", { targetField: "future_return_5d" }, events, { horizons: [5], maxPathDay: 5, conditionSet: { groups: [] } }),
    ).rejects.toThrow(/没有任何条件/);
  });

  it("回归：目标是 path 独有视界（无对应 outcome 回撤列）时不得失败", async () => {
    // future_return_3d 来自 path，但 outcome 只覆盖 {5,10,20} → 不存在 max_drawdown_3d。
    // 早前 requiredVariables 会无条件要求它，导致引擎在解析需求阶段 UNKNOWN_VARIABLE 失败。
    // 注意必须自带 T+3 有值的样本（共享 fixture 只在 h=5 有值）。
    const local: SyntheticEventSpec[] = Array.from({ length: 40 }, (_, i) => ({
      index: i,
      turnover: i + 1,
      futureReturn: (h) => 0.001 * (i + 1) * (h / 3),
    }));
    const { result, requirement } = await run(
      "CONDITIONAL",
      { targetField: "future_return_3d", minSampleCount: 1 },
      local,
      {
        horizons: REAL_OUTCOME_HORIZONS,
        maxPathDay: 20,
        conditionSet: conditionSet([{ field: "turnover", op: ">=", value: 5 }]),
      },
    );
    expect(requirement.outcomes).toContain("future_return_3d");
    expect(requirement.outcomes).not.toContain("max_drawdown_3d");
    // 目标收益本身有数据 → 组间差必须真实产出
    expect(result.rows.some((r) => r.metricCode === "DIFFERENCE")).toBe(true);
    // 没有回撤列就不产出回撤指标，而不是编造 0
    expect(result.rows.some((r) => r.metricCode === "MAX_DRAWDOWN")).toBe(false);
  });

  it("维度条件（market）也能求值", async () => {
    const mixed: SyntheticEventSpec[] = Array.from({ length: 20 }, (_, i) => ({
      index: i,
      turnover: 5,
      market: i < 10 ? "SZ" : "SH",
      futureReturn: (h) => (h === 5 ? (i < 10 ? 0.02 : 0.06) : null),
    }));
    const { result } = await run(
      "CONDITIONAL",
      { targetField: "future_return_5d", minSampleCount: 1 },
      mixed,
      { horizons: [5], maxPathDay: 5, conditionSet: conditionSet([{ field: "market", op: "==", value: "SH" }]) },
    );
    const cond = result.rows.find((r) => r.metricCode === "MEAN_RETURN" && r.dimension?.group === "CONDITION")!;
    expect(cond.sampleCount).toBe(10);
    expect(cond.metricValue).toBeCloseTo(0.06, 10);
  });
});

describe("STABILITY", () => {
  it("year 分组：跨年方向一致性", async () => {
    const events: SyntheticEventSpec[] = [
      { index: 0, turnover: 5, tradeDate: "2023-03-01", futureReturn: (h) => (h === 5 ? 0.02 : null) },
      { index: 1, turnover: 5, tradeDate: "2023-08-01", futureReturn: (h) => (h === 5 ? 0.03 : null) },
      { index: 2, turnover: 5, tradeDate: "2024-03-01", futureReturn: (h) => (h === 5 ? -0.01 : null) },
    ];
    const { result } = await run(
      "STABILITY",
      { targetField: "future_return_5d", stabilityDimension: "year", minSampleCount: 1 },
      events,
      { horizons: [5], maxPathDay: 5 },
    );
    const means = result.rows.filter((r) => r.metricCode === "MEAN_RETURN");
    expect(means.map((r) => r.dimension)).toEqual([{ year: 2023 }, { year: 2024 }, { year: "ALL" }]);
    expect(means[0]!.metricValue).toBeCloseTo(0.025, 10);
    expect(means[1]!.metricValue).toBeCloseTo(-0.01, 10);
    const ratio = result.rows.find((r) => r.metricCode === "STABILITY_RATIO")!;
    // 两个期间：2023 (+0.025) 与整体 (+0.0075) 同号，2024 (−0.01) 异号 → 1/2
    expect(ratio.metricValue).toBeCloseTo(0.5, 10);
  });

  it("回归：只有 1 个分组时不产出 STABILITY_RATIO（单组恒为 1，会被误读为「高度稳定」）", async () => {
    // 真实场景：Dataset Version 只覆盖一个月 / 一个板块时，year、board 维度都只有 1 组。
    const events: SyntheticEventSpec[] = [
      { index: 0, turnover: 5, tradeDate: "2026-08-03", futureReturn: (h) => (h === 5 ? 0.02 : null) },
      { index: 1, turnover: 6, tradeDate: "2026-08-04", futureReturn: (h) => (h === 5 ? 0.03 : null) },
      { index: 2, turnover: 7, tradeDate: "2026-08-05", futureReturn: (h) => (h === 5 ? 0.04 : null) },
    ];
    const { result } = await run(
      "STABILITY",
      { targetField: "future_return_5d", stabilityDimension: "year", minSampleCount: 1 },
      events,
      { horizons: [5], maxPathDay: 5 },
    );
    expect(result.rows.some((r) => r.metricCode === "STABILITY_RATIO")).toBe(false);
    expect(result.summary.directionConsistency).toBeNull();
    expect(result.summary.groupCount).toBe(1);
    expect(result.summary.notes.join(" ")).toContain("无法评估跨期稳定性");
    // 整体均值仍然真实产出
    expect(result.rows.some((r) => r.metricCode === "MEAN_RETURN")).toBe(true);
  });

  it("regime 分组：未注入标签源 → REGIME_PROVIDER_UNAVAILABLE（绝不用近似标签冒充）", () => {
    expect(() =>
      resolveEngineAnalysisConfig({
        analysis: analysis("STABILITY", { targetField: "future_return_5d", stabilityDimension: "regime" }),
        catalog,
      }),
    ).toThrow(/regime/);
  });

  it("regime 分组：注入标签源后可用", async () => {
    const events: SyntheticEventSpec[] = [
      { index: 0, turnover: 5, tradeDate: "2024-01-02", futureReturn: (h) => (h === 5 ? 0.05 : null) },
      { index: 1, turnover: 5, tradeDate: "2024-01-03", futureReturn: (h) => (h === 5 ? 0.04 : null) },
      { index: 2, turnover: 5, tradeDate: "2024-01-04", futureReturn: (h) => (h === 5 ? -0.02 : null) },
      { index: 3, turnover: 5, tradeDate: "2024-01-05", futureReturn: (h) => (h === 5 ? -0.03 : null) },
    ];
    const { result } = await run(
      "STABILITY",
      { targetField: "future_return_5d", stabilityDimension: "regime", minSampleCount: 1 },
      events,
      {
        horizons: [5],
        maxPathDay: 5,
        regimeProvider: (d) => (d <= "2024-01-03" ? "risk_on" : "risk_off"),
      },
    );
    const means = result.rows.filter((r) => r.metricCode === "MEAN_RETURN");
    expect(means.map((r) => r.dimension)).toEqual([{ regime: "risk_off" }, { regime: "risk_on" }, { regime: "ALL" }]);
    expect(means[0]!.metricValue).toBeCloseTo(-0.025, 10);
    expect(means[1]!.metricValue).toBeCloseTo(0.045, 10);
    // 两个环境：risk_on 与整体 (+0.01) 同号，risk_off 异号 → 1/2
    expect(result.summary.directionConsistency).toBeCloseTo(0.5, 10);
  });
});

describe("Registry 派发", () => {
  it("已实现的 6 类分析均已注册；未实现类型具名失败", () => {
    expect(registry.listTypes()).toEqual([
      "CONDITIONAL",
      "DESCRIPTIVE",
      "EVENT_STUDY",
      "QUANTILE",
      "SEGMENT_RELATION",
      "STABILITY",
    ]);
    expect(() => registry.require("IC")).toThrow(/未在 RESEARCH-002 中实现/);
  });

  it("重复注册被拒绝", () => {
    expect(() => registry.register(registry.require("DESCRIPTIVE"))).toThrow(/已注册/);
  });
});

// ---------------------------------------------------------------------------
// SEGMENT_RELATION（RESEARCH-004）—— 「前一段行情」与「后一段行情」的关系
//
// 关注点不是「能不能跑」，而是三件容易做错的事：
//   1. 声明装载的变量名与 metadata 记的变量名必须**是同一个**（不许声明 A、读 B）；
//   2. 分档沿用 QUANTILE 的规则（相同值不劈开），配对只用两侧同时有限的样本；
//   3. 重叠守卫在配置层之外**再断言一次** —— 上游把关被挪走时不能静默放过。
// ---------------------------------------------------------------------------

describe("SEGMENT_RELATION", () => {
  /**
   * 40 个事件、路径线性上行：`base` 越大 → 窗 A（T→T+5 最大跌幅）越接近 0，
   * 窗 B（T+5→T+20 分段收益）越大。两者与 `base` 同序 ⇒ 秩相关应为 +1。
   */
  function linearSegmentEvents(count = 40): SyntheticEventSpec[] {
    return Array.from({ length: count }, (_, i) => {
      const base = (i + 1) / 100;
      return { index: i, turnover: i + 1, futureReturn: (h: number) => base * (h / 20) };
    });
  }

  const BASE_CONFIG = {
    windowA: [0, 5],
    windowAStat: "max_drawdown",
    windowB: [5, 20],
    windowBStat: "return",
    windowBands: 5,
    minSampleCount: 1,
  };

  function resolvedOf(config: Record<string, unknown>): ResolvedEngineAnalysisConfig {
    return resolveEngineAnalysisConfig({ analysis: analysis("SEGMENT_RELATION", config), catalog });
  }

  function contextOf(config: ResolvedEngineAnalysisConfig): AnalysisExecutionContext {
    return {
      analysis: analysis("SEGMENT_RELATION", BASE_CONFIG),
      config,
      datasetVersionId: 1,
      samples: [],
      horizons: [5, 10, 20],
      conditionSet: { groups: [] },
    };
  }

  it("变量需求 = 两个真实变量名（窗 A 复用既有族、窗 B 用分段族）", () => {
    const requirement = registry
      .require("SEGMENT_RELATION")
      .requiredVariables(resolvedOf(BASE_CONFIG), { catalog, conditionSet: { groups: [] } });
    expect(requirement.features).toEqual([]);
    expect(requirement.outcomes).toEqual(["max_drawdown_5d", "segment_return_5_20d"]);
  });

  it("缺窗时需求为空（执行器不替用户猜一个窗）", () => {
    const executor = registry.require("SEGMENT_RELATION");
    const noWindow = { ...resolvedOf(BASE_CONFIG), windowA: undefined };
    expect(executor.requiredVariables(noWindow as ResolvedEngineAnalysisConfig, {
      catalog,
      conditionSet: { groups: [] },
    })).toEqual({ features: [], outcomes: [] });
    // 真跑起来则具名失败，而不是「静默跑出一个空结果」
    return expect(executor.execute(contextOf(noWindow as ResolvedEngineAnalysisConfig))).rejects.toThrow(
      /缺少完整的窗配置/,
    );
  });

  it("分档 + 配对：逐档统计窗 B、同一样本两段行情的共变，以及顶底档差", async () => {
    const { result, requirement } = await run("SEGMENT_RELATION", BASE_CONFIG, linearSegmentEvents());

    const byCode = (code: string) => result.rows.filter((r) => r.metricCode === code);
    // 40 个事件两侧都完整 ⇒ 配对样本 40，且没被「缺失」吃掉
    expect(byCode("PAIR_SAMPLE_COUNT")).toHaveLength(1);
    expect(byCode("PAIR_SAMPLE_COUNT")[0]!.metricValue).toBe(40);
    expect(byCode("PAIR_RANK_CORRELATION")[0]!.metricValue).toBeCloseTo(1, 10);
    expect(byCode("PAIR_CORRELATION")[0]!.metricValue!).toBeGreaterThan(0.95);

    // 分档：5 档，每档都产出 MEAN_RETURN / MEDIAN_RETURN / STD_RETURN / WIN_RATE / SAMPLE_COUNT
    expect(result.summary.groupCount).toBe(5);
    const means = byCode("MEAN_RETURN");
    expect(means.map((r) => r.dimension)).toEqual([
      { windowA: 1 },
      { windowA: 2 },
      { windowA: 3 },
      { windowA: 4 },
      { windowA: 5 },
    ]);
    for (const row of means) expect(row.sampleCount).toBe(8);
    expect(byCode("WIN_RATE")).toHaveLength(5);

    // 单调递增 ⇒ 方向一致性 1，且顶底档差为正
    expect(result.summary.directionConsistency).toBeCloseTo(1, 10);
    const spread = byCode("SPREAD_TOP_BOTTOM")[0]!.metricValue!;
    expect(spread).toBeGreaterThan(0);
    expect(result.summary.effect).toBeCloseTo(spread, 12);

    // 声明装载的变量与 metadata 记的变量必须一致（防「声明 A、实际读 B」）
    expect(requirement.outcomes).toEqual(["max_drawdown_5d", "segment_return_5_20d"]);
    const meta = result.diagnostics!.meta as {
      windowA: { variable: string; window: [number, number] };
      windowB: { variable: string; window: [number, number] };
      valueWindowA: [number, number];
      valueWindowB: [number, number];
      pairCount: number;
      excludedForMissing: number;
      actualBands: number;
    };
    expect(meta.windowA.variable).toBe("max_drawdown_5d");
    expect(meta.windowB.variable).toBe("segment_return_5_20d");
    expect(meta.valueWindowA).toEqual([1, 5]);
    expect(meta.valueWindowB).toEqual([6, 20]);
    expect(meta.pairCount).toBe(40);
    expect(meta.excludedForMissing).toBe(0);
    expect(meta.actualBands).toBe(5);
    expect(result.summary.effectLabel).toContain("窗 A");
    expect(result.summary.effectLabel).toContain("窗 B");
  });

  it("缺失不插补：任一侧缺失即整对丢弃，且如实说明被排除的样本数", async () => {
    const events = linearSegmentEvents();
    // 每 8 个事件里掐掉一个路径末端 ⇒ 该事件的分段收益为 null（少了 T+20 这一天）
    for (const index of [3, 7]) {
      const original = events[index]!.futureReturn;
      events[index] = { ...events[index]!, futureReturn: (h) => (h === 20 ? null : original(h)) };
    }
    const { result } = await run("SEGMENT_RELATION", BASE_CONFIG, events);

    const pairCount = result.rows.find((r) => r.metricCode === "PAIR_SAMPLE_COUNT")!.metricValue;
    expect(pairCount).toBe(38);
    const meta = result.diagnostics!.meta as { excludedForMissing: number };
    expect(meta.excludedForMissing).toBe(2);
    expect(result.summary.notes.join(" ")).toContain("缺失不冒充有效样本");
  });

  it("窗 B 口径为「最大跌幅」时不产出 WIN_RATE（「> 0 占比」不是胜率）", async () => {
    const { result } = await run(
      "SEGMENT_RELATION",
      { ...BASE_CONFIG, windowBStat: "max_drawdown" },
      linearSegmentEvents(),
    );
    expect(result.rows.some((r) => r.metricCode === "WIN_RATE")).toBe(false);
    expect(result.summary.notes.join(" ")).toContain("不产出 WIN_RATE");
  });

  it("执行器自己再断言一次不重叠：上游把关被绕过时也不静默出结论", async () => {
    const tampered: ResolvedEngineAnalysisConfig = { ...resolvedOf(BASE_CONFIG), windowA: [0, 10] };
    await expect(registry.require("SEGMENT_RELATION").execute(contextOf(tampered))).rejects.toThrow(/重叠/);
  });

  it("样本不足两档时不产出顶底档差，并如实说明（不假装算出了差异）", async () => {
    // 窗 A 取值全部相同 ⇒ 切点无法分隔，实际只有 1 档
    const flat: SyntheticEventSpec[] = Array.from({ length: 10 }, (_, i) => ({
      index: i,
      turnover: i + 1,
      futureReturn: (h: number) => (h === 5 ? 0.05 : 0.3 * (h / 20)),
    }));
    const { result } = await run("SEGMENT_RELATION", BASE_CONFIG, flat);
    expect(result.summary.groupCount).toBe(1);
    expect(result.rows.some((r) => r.metricCode === "SPREAD_TOP_BOTTOM")).toBe(false);
    expect(result.summary.effect).toBeNull();
    expect(result.summary.notes.join(" ")).toContain("不产出顶底档差");
  });
});
