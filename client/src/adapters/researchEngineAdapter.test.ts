/**
 * researchEngineAdapter 测试。
 *
 * 重点不是「格式化字符串长什么样」，而是三条**会造假**的风险点：
 *   1. 指标单位必须同时看指标码与变量名 —— 否则 `MEAN` 作用于 `turnover` 会被当成裸数值；
 *   2. 缺失值必须显示为 `—` —— 否则「算不出」会被读成 0；
 *   3. 分组样本数必须**逐指标**保留 —— 否则 `MEAN_RETURN`(n=1065) 会被 `MAX_DRAWDOWN`(n=1127)
 *      的分母覆盖，伪造出一致性。
 */

import { describe, expect, it } from "vitest";
import {
  buildGroupBlocks,
  buildHeadline,
  buildScalarRows,
  buildVariableSeries,
  conclusionToVm,
  dimensionLabel,
  dimensionSortKey,
  estimateExcludedGroupMean,
  experimentToVm,
  formatDuration,
  formatMetricValue,
  groupRangeLabelOf,
  groupVariableOf,
  isReturnVariable,
  metricLabelOf,
  metricUnitOf,
  analysisTypeLabelOf,
  resultRowToVm,
  rpcErrorToDiagnostic,
  runToVm,
  variableLabelOf,
  type GroupBlockVm,
  type ResultRowVm,
} from "./researchEngineAdapter";

describe("researchEngineAdapter — 指标单位与格式化", () => {
  it("自带单位的指标码不依赖变量名", () => {
    expect(metricUnitOf("WIN_RATE")).toBe("PERCENT");
    expect(metricUnitOf("MEAN_RETURN")).toBe("PERCENT");
    expect(metricUnitOf("MAX_DRAWDOWN")).toBe("PERCENT");
    expect(metricUnitOf("SAMPLE_COUNT")).toBe("COUNT");
    expect(metricUnitOf("MISSING_COUNT")).toBe("COUNT");
    expect(metricUnitOf("P_VALUE")).toBe("NUMBER");
    expect(metricUnitOf("T_STAT")).toBe("NUMBER");
  });

  it("无单位指标码必须看变量名（同一 MEAN 在不同变量上单位不同）", () => {
    expect(metricUnitOf("MEAN", "future_return_5d")).toBe("PERCENT");
    expect(metricUnitOf("MEAN", "turnover")).toBe("PERCENT");
    expect(metricUnitOf("MEAN", "market_cap")).toBe("NUMBER");
    expect(metricUnitOf("MEAN", "days_to_breakout_5d")).toBe("NUMBER");
    expect(metricUnitOf("MEDIAN", "max_drawdown_10d")).toBe("PERCENT");
    // 缺变量名时保守取 NUMBER，不猜测
    expect(metricUnitOf("MEAN")).toBe("NUMBER");
  });

  it("收益型变量识别覆盖后端全部收益变量族", () => {
    for (const name of [
      "future_return_5d",
      "high_return_5d",
      "low_return_5d",
      "max_return_5d",
      "min_return_5d",
      "max_drawdown_5d",
      "pullback_from_event_high_5d",
      "pre_return_20d",
    ]) {
      expect(isReturnVariable(name), name).toBe(true);
    }
    expect(isReturnVariable("days_to_breakout_5d")).toBe(false);
    expect(isReturnVariable("market_cap")).toBe(false);
    expect(isReturnVariable("is_breakout_5d")).toBe(false);
  });

  it("百分比 / 计数 / 统计量各自格式化；null 一律显示 —（不显示 0）", () => {
    expect(formatMetricValue("MEAN_RETURN", 0.030402, "future_return_5d")).toBe("3.0402%");
    expect(formatMetricValue("MEAN_RETURN", -0.000383, "future_return_5d")).toBe("-0.0383%");
    expect(formatMetricValue("SPREAD_TOP_BOTTOM", -0.0307849145)).toBe("-3.0785%");
    expect(formatMetricValue("P_VALUE", 0.093)).toBe("0.0930");
    expect(formatMetricValue("T_STAT", -1.6799123)).toBe("-1.680");
    expect(formatMetricValue("SAMPLE_COUNT", 107)).toBe("107");
    expect(formatMetricValue("SAMPLE_COUNT", 1130)).toBe("1,130");
    expect(formatMetricValue("MEAN", 1234567.89, "market_cap")).toBe("1234567.8900");

    expect(formatMetricValue("MEAN_RETURN", null, "future_return_5d")).toBe("—");
    expect(formatMetricValue("SAMPLE_COUNT", undefined)).toBe("—");
    expect(formatMetricValue("MEAN", Number.NaN, "turnover")).toBe("—");
    expect(formatMetricValue("MEAN", Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("极小非零百分比不被显示成假零", () => {
    expect(formatMetricValue("MEAN_RETURN", 0.0000001, "future_return_5d")).not.toBe("0.0000%");
  });

  it("标签：指标中文名 / 变量中文名；未收录原样返回不臆造", () => {
    expect(metricLabelOf("SPREAD_TOP_BOTTOM")).toBe("最高组 − 最低组");
    expect(metricLabelOf("P_VALUE_DIFFERENCE")).toBe("组间差 p 值");
    expect(metricLabelOf("SOME_FUTURE_CODE")).toBe("SOME_FUTURE_CODE");
    expect(variableLabelOf("turnover")).toBe("换手率");
    expect(variableLabelOf("future_return_5d")).toBe("未来收益 T+5");
    expect(variableLabelOf("days_to_breakout_10d")).toBe("到突破天数 T+10");
    expect(variableLabelOf("unknown_var")).toBe("unknown_var");
    expect(analysisTypeLabelOf("QUANTILE")).toBe("分位分析");
    expect(analysisTypeLabelOf("IC")).toBe("IC");
  });

  it("时长格式化", () => {
    expect(formatDuration(842)).toBe("842 ms");
    expect(formatDuration(18_500)).toBe("18.5 s");
    expect(formatDuration(125_000)).toBe("2 m 05 s");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("researchEngineAdapter — 分组维度", () => {
  it("五种真实维度写法都能渲染成可读标签", () => {
    expect(dimensionLabel({ quantile: 3 })).toBe("Q3");
    expect(dimensionLabel({ horizon: 5 })).toBe("T+5");
    expect(dimensionLabel({ variable: "turnover" })).toBe("换手率");
    expect(dimensionLabel({ group: "ALL" })).toBe("全样本");
    expect(dimensionLabel({ group: "CONDITION" })).toBe("满足条件");
    expect(dimensionLabel({ board: "main" })).toBe("板块 main");
    expect(dimensionLabel({ year: 2023 })).toBe("年度 2023");
    expect(dimensionLabel(null)).toBe("—");
    expect(dimensionLabel({})).toBe("—");
  });

  it("维度排序键稳定且与键顺序无关", () => {
    expect(dimensionSortKey({ quantile: 2 })).toBe("quantile=2");
    expect(dimensionSortKey({ a: 1, b: 2 })).toBe(dimensionSortKey({ b: 2, a: 1 }));
  });

  it("Q2 必须排在 Q10 之前（数值排序，不是字符串排序）", () => {
    const rows = [
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: 0.01, sampleCount: 10, dimension: { quantile: 10 } },
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: 0.02, sampleCount: 10, dimension: { quantile: 2 } },
    ];
    expect(buildGroupBlocks(rows).map((b) => b.label)).toEqual(["Q2", "Q10"]);
  });
});

describe("researchEngineAdapter — 结果行 / 分组块", () => {
  it("逐指标保留各自的样本数，分母不一致时不给统一的「组样本数」", () => {
    const rows = [
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: 0.01, sampleCount: 1065, dimension: { group: "ALL" } },
      { resultType: "GROUPED", metricCode: "MAX_DRAWDOWN", metricValue: -0.05, sampleCount: 1127, dimension: { group: "ALL" } },
    ];
    const [block] = buildGroupBlocks(rows);
    expect(block!.uniformSampleCount).toBeNull();
    expect(block!.metrics.map((m) => m.sampleCount)).toEqual([1065, 1127]);
  });

  it("全部指标样本数一致时才给出统一的组样本数", () => {
    const rows = [
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: 0.01, sampleCount: 107, dimension: { quantile: 1 } },
      { resultType: "GROUPED", metricCode: "WIN_RATE", metricValue: 0.6, sampleCount: 107, dimension: { quantile: 1 } },
    ];
    expect(buildGroupBlocks(rows)[0]!.uniformSampleCount).toBe(107);
  });

  it("标量行与分组行分离（顶底差 / p 值差值走 SCALAR）", () => {
    const rows = [
      { resultType: "SCALAR", metricCode: "SPREAD_TOP_BOTTOM", metricValue: -0.030784914547101534, sampleCount: 214 },
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: 0.03, sampleCount: 107, dimension: { quantile: 1 } },
    ];
    expect(buildScalarRows(rows).map((r) => r.metricCode)).toEqual(["SPREAD_TOP_BOTTOM"]);
    expect(buildScalarRows(rows)[0]!.display).toBe("-3.0785%");
    expect(buildGroupBlocks(rows)).toHaveLength(1);
  });

  it("结果行读取 details.variable 以决定单位；缺失变量时不猜", () => {
    const withVar = resultRowToVm({
      resultType: "GROUPED",
      metricCode: "MEAN",
      metricValue: 0.05,
      sampleCount: 10,
      dimension: { variable: "turnover" },
      details: { variable: "turnover" },
    });
    expect(withVar.display).toBe("5.0000%");
    expect(withVar.variable).toBe("turnover");

    const withoutVar = resultRowToVm({
      resultType: "GROUPED",
      metricCode: "MEAN",
      metricValue: 0.05,
      sampleCount: 10,
      dimension: { variable: "turnover" },
      details: null,
    });
    expect(withoutVar.display).toBe("0.0500");
  });

  it("指标值为 null 的合法结果行显示 —，不显示 0", () => {
    const row = resultRowToVm({ resultType: "SCALAR", metricCode: "PROFIT_FACTOR", metricValue: null, sampleCount: 0 });
    expect(row.display).toBe("—");
    expect(row.value).toBeNull();
  });
});

describe("researchEngineAdapter — 分档区间与结论速览", () => {
  // 真实落库形态：analysis 390003（SEGMENT_RELATION，5 档，窗 A = max_drawdown_5d）
  const CUT_POINTS = [
    -0.09112707917498335,
    -0.05031446540880508,
    -0.01952017093014926,
    0.02007224272854557,
  ];
  const segmentDetails = (band: number) => ({
    windowA: { window: [0, 5], stat: "max_drawdown", variable: "max_drawdown_5d" },
    windowB: { window: [5, 20], stat: "return", variable: "segment_return_5_20d" },
    cutPoints: CUT_POINTS,
    band,
    spreadDefinition: "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
  });

  it("分档端点反解：首档 ≤、末档 >、中间为左开右闭（与 band(v) 规则同源）", () => {
    expect(groupRangeLabelOf(segmentDetails(1), { windowA: 1 })).toBe("≤ -9.11%");
    expect(groupRangeLabelOf(segmentDetails(2), { windowA: 2 })).toBe("(-9.11%, -5.03%]");
    expect(groupRangeLabelOf(segmentDetails(3), { windowA: 3 })).toBe("(-5.03%, -1.95%]");
    expect(groupRangeLabelOf(segmentDetails(4), { windowA: 4 })).toBe("(-1.95%, +2.01%]");
    expect(groupRangeLabelOf(segmentDetails(5), { windowA: 5 })).toBe("> +2.01%");
  });

  it("区间把「第 5 档」翻成「跌幅最小」—— 档号本身不含方向，靠它才读得懂符号", () => {
    // 该分析的真实结论是「第 5 档 − 第 1 档 = -1.8%」；不知道档 5 是「还涨着」那批就会读反
    expect(groupRangeLabelOf(segmentDetails(5), { windowA: 5 })).toBe("> +2.01%");
    expect(groupRangeLabelOf(segmentDetails(1), { windowA: 1 })).toBe("≤ -9.11%");
  });

  it("非分档分组（条件组 / 变量 / 板块）不产出区间，不臆造", () => {
    expect(groupRangeLabelOf({ cutPoints: CUT_POINTS }, { group: "ALL" })).toBeNull();
    expect(groupRangeLabelOf({ cutPoints: CUT_POINTS }, { variable: "turnover" })).toBeNull();
    expect(groupRangeLabelOf({}, { quantile: 1 })).toBeNull();
    expect(groupRangeLabelOf({ cutPoints: CUT_POINTS }, null)).toBeNull();
    expect(groupRangeLabelOf(null, { quantile: 1 })).toBeNull();
    // 档号越界（cutPoints 有 4 个 ⇒ 最多 5 档）
    expect(groupRangeLabelOf(segmentDetails(6), { windowA: 6 })).toBeNull();
  });

  it("QUANTILE 的区间单位由特征变量决定（比例型特征 → 百分数）", () => {
    const details = { featureVariable: "turnover", cutPoints: [0.1, 0.2] };
    expect(groupVariableOf(details, null)).toBe("turnover");
    expect(groupRangeLabelOf(details, { quantile: 1 })).toBe("≤ +10.00%");
    expect(groupRangeLabelOf(details, { quantile: 3 })).toBe("> +20.00%");
  });

  it("buildHeadline 对分档分析给出顶底档与引擎写入的差值口径", () => {
    const rows = [
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: 0.0019419179666773296, sampleCount: 4589, dimension: { windowA: 1 }, details: segmentDetails(1) },
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: 0.00416355646658756, sampleCount: 4590, dimension: { windowA: 2 }, details: segmentDetails(2) },
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: -0.0003830971429942907, sampleCount: 4587, dimension: { windowA: 3 }, details: segmentDetails(3) },
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: -0.000757980497246701, sampleCount: 4589, dimension: { windowA: 4 }, details: segmentDetails(4) },
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: -0.016080241622309414, sampleCount: 4589, dimension: { windowA: 5 }, details: segmentDetails(5) },
      { resultType: "SCALAR", metricCode: "SPREAD_TOP_BOTTOM", metricValue: -0.018022159588986744, sampleCount: 9178, details: segmentDetails(0) },
      { resultType: "SCALAR", metricCode: "T_STAT_DIFFERENCE", metricValue: -4.542184582850737, sampleCount: 9178, details: segmentDetails(0) },
      { resultType: "SCALAR", metricCode: "P_VALUE_DIFFERENCE", metricValue: 0.000005572819082200198, sampleCount: 9178, details: segmentDetails(0) },
    ];
    const headline = buildHeadline(rows, buildGroupBlocks(rows))!;
    expect(headline.kind).toBe("BANDED");
    expect(headline.metricLabel).toBe("平均收益");
    // 顶底 = **分组变量**的末档与首档（不是结果值的最高最低 —— 本例结果值最高其实在档 2）
    expect(headline.primary.label).toBe("档 5");
    expect(headline.primary.rangeLabel).toBe("> +2.01%");
    expect(headline.reference.label).toBe("档 1");
    expect(headline.reference.rangeLabel).toBe("≤ -9.11%");
    expect(headline.spreadDisplay).toBe("-1.8022%");
    // 🔴 文案里的差值必须与表格里的 spread 数字**同口径**（末档 − 首档），否则展示层自相矛盾
    expect(headline.primary.value - headline.reference.value).toBeCloseTo(-0.018022159588986744, 12);
    expect(headline.spreadDefinition).toContain("SPREAD_TOP_BOTTOM");
    expect(headline.groupVariable).toBe("max_drawdown_5d");
    expect(headline.tStat).toBeCloseTo(-4.542184582850737, 10);
  });

  it("buildHeadline 对条件分析把「满足条件」当主语、「全样本」当参照（差值口径原样带出）", () => {
    const details = {
      outcomeVariable: "future_return_20d",
      conditionRule: "holds_event_low_5d == 1",
      totalSampleCount: 23033,
      conditionSampleCount: 16158,
      differenceDefinition: "DIFFERENCE = mean(条件样本) − mean(全样本)。",
    };
    const rows = [
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: 0.01290959940552959, sampleCount: 23033, dimension: { group: "ALL" }, details },
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: 0.0518597591784172, sampleCount: 16158, dimension: { group: "CONDITION" }, details },
      { resultType: "SCALAR", metricCode: "DIFFERENCE", metricValue: 0.038950159772887606, sampleCount: 16158, details },
    ];
    const headline = buildHeadline(rows, buildGroupBlocks(rows))!;
    expect(headline.kind).toBe("CONDITIONAL");
    expect(headline.primary.label).toBe("满足条件");
    expect(headline.primary.display).toBe("5.1860%");
    expect(headline.reference.label).toBe("全样本");
    expect(headline.reference.display).toBe("1.2910%");
    expect(headline.spreadDisplay).toBe("3.8950%");
    // 🔴 口径必须来自引擎：本系统**不产出对照组**，差值一律是「条件组 − 全样本」
    expect(headline.spreadDefinition).toContain("条件样本");
  });

  it("名义分类维度（变量 / 板块 / 行业）不做顶底差 —— 无序维度之间没有「差值」可言", () => {
    const rows = [
      { resultType: "GROUPED", metricCode: "MEAN", metricValue: 1.39, sampleCount: 23917, dimension: { variable: "volume_ratio_1d" }, details: { variable: "volume_ratio_1d" } },
      { resultType: "GROUPED", metricCode: "MEAN", metricValue: 0.85, sampleCount: 23751, dimension: { variable: "volume_ratio_5d" }, details: { variable: "volume_ratio_5d" } },
    ];
    expect(buildHeadline(rows, buildGroupBlocks(rows))).toBeNull();
  });

  it("分组不足 2 组时不硬凑结论", () => {
    const rows = [
      { resultType: "GROUPED", metricCode: "MEAN_RETURN", metricValue: 0.01, sampleCount: 10, dimension: { group: "ALL" } },
    ];
    expect(buildHeadline(rows, buildGroupBlocks(rows))).toBeNull();
  });
});

describe("researchEngineAdapter — 对照组反推", () => {
  /**
   * 核心：`n_all·M_all = n_c·M_c + n_rest·M_rest` 的恒等变形。
   * 用能整除的字面量，免得浮点误差掩盖公式错误。
   */
  it("按恒等式反推「不满足条件」那组的均值", () => {
    // 100 个样本整体均值 1%；其中 30 个（条件组）均值 5%
    // ⇒ 剩余 70 个 = (100×0.01 − 30×0.05) / 70 = (1 − 1.5)/70 = −0.5/70
    expect(estimateExcludedGroupMean(0.01, 100, 0.05, 30)).toBeCloseTo(-0.5 / 70, 12);
  });

  it("条件组均值与全样本相同时，反推值也相同（不会凭空造出差异）", () => {
    expect(estimateExcludedGroupMean(0.02, 200, 0.02, 50)).toBeCloseTo(0.02, 12);
  });

  it("反推值可无损还原全样本均值（round-trip）", () => {
    const all = 0.031;
    const allN = 1234;
    const cond = -0.087;
    const condN = 517;
    const rest = estimateExcludedGroupMean(all, allN, cond, condN);
    expect(rest).not.toBeNull();
    const restN = allN - condN;
    expect((cond * condN + (rest as number) * restN) / allN).toBeCloseTo(all, 12);
  });

  it("没有剩余样本（条件组 ≥ 全样本）时返回 null，而不返回 0 或自身", () => {
    expect(estimateExcludedGroupMean(0.01, 100, 0.01, 100)).toBeNull();
    expect(estimateExcludedGroupMean(0.01, 100, 0.01, 120)).toBeNull();
  });

  it("计数缺失或非正时返回 null（宁可缺数，也不给可疑数）", () => {
    expect(estimateExcludedGroupMean(0.01, 100, 0.01, null)).toBeNull();
    expect(estimateExcludedGroupMean(0.01, 100, 0.01, 0)).toBeNull();
    expect(estimateExcludedGroupMean(0.01, null, 0.01, 30)).toBeNull();
    expect(estimateExcludedGroupMean(0.01, 100, 0.01, -5)).toBeNull();
  });

  it("均值缺失或非有限数时返回 null", () => {
    expect(estimateExcludedGroupMean(null, 100, 0.05, 30)).toBeNull();
    expect(estimateExcludedGroupMean(0.01, 100, undefined, 30)).toBeNull();
    expect(estimateExcludedGroupMean(Number.NaN, 100, 0.05, 30)).toBeNull();
    expect(estimateExcludedGroupMean(0.01, 100, Number.POSITIVE_INFINITY, 30)).toBeNull();
  });
});

/**
 * 一族「同一变量、不同滞后日」的结果（`volume_ratio_1d..5d`）必须被识别为**有序序列**，
 * 即横轴是时间而不是并列类别；且它的基准线是 **1 倍**（量比的「持平」），不是 0。
 * 基准画错 / 不识别，都会让「逐日缩量」这个唯一信息在图上消失。
 */
describe("researchEngineAdapter — 有序变量序列（趋势图）", () => {
  const vm = (metricCode: string, value: number | null, sampleCount = 100): ResultRowVm => ({
    metricCode,
    label: metricLabelOf(metricCode),
    value,
    display: formatMetricValue(metricCode, value, "volume_ratio_1d"),
    sampleCount,
    dimensionLabel: "",
    variable: null,
    lowSample: false,
    definition: null,
    rangeLabel: null,
    comparisonDefinition: null,
  });

  const block = (variable: string, metrics: ResultRowVm[] = []): GroupBlockVm => ({
    key: `variable=${variable}`,
    label: variableLabelOf(variable),
    dimension: { variable },
    numeric: null,
    uniformSampleCount: 100,
    lowSample: false,
    rangeLabel: null,
    metrics,
  });

  it("volume_ratio 的中文名已登记（防回归成「volume_ratio T+1」这种半工程名）", () => {
    expect(variableLabelOf("volume_ratio_1d")).toBe("量比 T+1");
    expect(variableLabelOf("volume_ratio_5d")).toBe("量比 T+5");
  });

  it("量比族：识别为有序序列，基准线 = 1，点按滞后阶数升序", () => {
    const series = buildVariableSeries([
      block("volume_ratio_2d"),
      block("volume_ratio_1d"),
      block("volume_ratio_5d"),
    ]);
    expect(series).not.toBeNull();
    expect(series!.family).toBe("volume_ratio");
    expect(series!.familyLabel).toBe("量比");
    expect(series!.baseline).toBe(1);
    expect(series!.points.map((p) => p.lag)).toEqual([1, 2, 5]);
    expect(series!.points.map((p) => p.label)).toEqual(["量比 T+1", "量比 T+2", "量比 T+5"]);
    expect(series!.points[0]!.variable).toBe("volume_ratio_1d");
  });

  it("收益族的基准线是 0（不是 1）", () => {
    const series = buildVariableSeries([block("future_return_5d"), block("future_return_20d")]);
    expect(series!.baseline).toBe(0);
    expect(series!.familyLabel).toBe("未来收益");
    expect(series!.points.map((p) => p.label)).toEqual(["未来收益 T+5", "未来收益 T+20"]);
  });

  it("指标码去重且保持首次出现顺序", () => {
    const series = buildVariableSeries([
      block("volume_ratio_1d", [vm("MEDIAN", 1.4), vm("MEAN", 1.77)]),
      block("volume_ratio_2d", [vm("MEAN", 1.59), vm("MEDIAN", 1.11), vm("SKEWNESS", 21.5)]),
    ]);
    expect(series!.metricCodes).toEqual(["MEDIAN", "MEAN", "SKEWNESS"]);
  });

  it("族不一致 / 变量名不是滞后族 / 混入分组维度 → 不认（宁可不出图，也不乱出）", () => {
    expect(buildVariableSeries([block("volume_ratio_1d"), block("turnover")])).toBeNull();
    expect(
      buildVariableSeries([block("volume_ratio_1d"), block("pullback_from_event_high")]),
    ).toBeNull();
    expect(
      buildVariableSeries([
        block("volume_ratio_1d"),
        { ...block("volume_ratio_2d"), dimension: { group: "ALL" } },
      ]),
    ).toBeNull();
  });

  it("滞后重复 / 少于 2 个点 → null", () => {
    expect(buildVariableSeries([block("volume_ratio_1d")])).toBeNull();
    expect(buildVariableSeries([block("volume_ratio_1d"), block("volume_ratio_1d")])).toBeNull();
    expect(buildVariableSeries([])).toBeNull();
  });
});

describe("researchEngineAdapter — 实验 / Run", () => {
  it("runToVm 由起止时间算时长；失败原因必须冒泡", () => {
    const vm = runToVm({
      id: 7,
      runNo: 2,
      status: "FAILED",
      startedAt: "2026-09-11T00:00:00.000Z",
      completedAt: "2026-09-11T00:00:12.500Z",
      errorCode: "ANALYSIS_FAILED",
      errorMessage: "QUANTILE 执行失败",
    });
    expect(vm.durationMs).toBe(12_500);
    expect(vm.errorCode).toBe("ANALYSIS_FAILED");
    expect(vm.errorMessage).toContain("QUANTILE");
  });

  it("预检拒绝（从未 startedAt）时长为 null，而不是 0", () => {
    const vm = runToVm({ id: 8, runNo: 1, status: "FAILED", startedAt: null, completedAt: null });
    expect(vm.durationMs).toBeNull();
  });

  it("experimentToVm 归一 null 字段", () => {
    const vm = experimentToVm({
      id: 1,
      name: "首板换手率与未来5日收益研究",
      researchType: "FEATURE",
      status: "COMPLETED",
      datasetVersionId: 390001,
    });
    expect(vm.description).toBeNull();
    expect(vm.sampleCount).toBeNull();
    expect(vm.datasetVersionId).toBe(390001);
  });
});

describe("researchEngineAdapter — 结论 evidence", () => {
  const realEvidence = {
    disclaimer: "⚠️ 自动结论仅为研究辅助……",
    policy: { alpha: 0.05, materialityAbs: 0.005, minSampleCount: 30, stabilityMinConsistentRatio: 0.6, strongSampleMultiple: 2 },
    hypothesisId: 2,
    hypothesisStatement: "换手率不同区间的首板股票，未来5日收益存在系统性差异。",
    primaryAnalysis: {
      analysisId: 12,
      analysisType: "QUANTILE",
      effectLabel: "Q10 − Q1 的未来5日收益均值差",
      effect: -0.030784914547101534,
      pValue: 0.093,
      tStat: -1.6799123,
      sampleCount: 1070,
      minGroupSampleCount: 107,
      groupCount: 10,
      directionConsistency: 0.667,
    },
    primarySelectionRule: "按 QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY 的固定优先级选择主分析",
    contributingAnalyses: [
      { analysisId: 12, analysisType: "QUANTILE", effect: -0.0308, effectLabel: "顶底差", pValue: 0.093, sampleCount: 1070, notes: ["样本量 107 低于门槛"] },
    ],
    ruleTrace: [
      { rule: "R2_样本达标", passed: true, detail: "总样本 1070" },
      { rule: "R4_统计量达标", passed: false, detail: "p = 0.0930，alpha = 0.05" },
    ],
    confidenceBasis: "基础 0.30；+0.133 方向一致性 × 0.20",
    confidenceIsNotPValue: true,
  };

  it("解析真实 evidence：阈值口径 / 主效应 / 规则轨迹 / 免责声明全部落位", () => {
    const vm = conclusionToVm({
      id: 3,
      conclusionType: "PARTIALLY_SUPPORTED",
      title: "自动结论（PARTIALLY_SUPPORTED）",
      conclusion: "正文……",
      confidence: 0.5833,
      status: "FINAL",
      evidence: realEvidence,
    });
    expect(vm.evidence.policy.alpha).toBe(0.05);
    expect(vm.evidence.policy.materialityDisplay).toBe("0.5000%");
    expect(vm.evidence.primaryAnalysis!.effectDisplay).toBe("-3.0785%");
    expect(vm.evidence.primaryAnalysis!.pValueDisplay).toBe("0.0930");
    expect(vm.evidence.primaryAnalysis!.analysisTypeLabel).toBe("分位分析");
    expect(vm.evidence.ruleTrace.map((r) => r.code)).toEqual(["R2", "R4"]);
    expect(vm.evidence.ruleTrace[1]!.passed).toBe(false);
    expect(vm.evidence.contributingAnalyses[0]!.notes).toHaveLength(1);
    expect(vm.evidence.confidenceIsNotPValue).toBe(true);
    expect(vm.evidence.disclaimer.length).toBeGreaterThan(0);
  });

  it("主分析为 null（证据不足分支）不崩，且仍保留阈值与轨迹", () => {
    const vm = conclusionToVm({
      id: 4,
      conclusionType: "INCONCLUSIVE",
      title: "证据不足",
      conclusion: "无法评估……",
      confidence: 0,
      status: "FINAL",
      evidence: {
        disclaimer: "免责声明",
        policy: realEvidence.policy,
        hypothesisId: 2,
        hypothesisStatement: "H",
        primaryAnalysis: null,
        contributingAnalyses: [],
        ruleTrace: [{ rule: "R1_有可用主效应", passed: false, detail: "3 个分析均未产出可比较主效应" }],
        confidenceBasis: "证据不足",
        confidenceIsNotPValue: true,
      },
    });
    expect(vm.evidence.primaryAnalysis).toBeNull();
    expect(vm.evidence.ruleTrace[0]!.code).toBe("R1");
    expect(vm.evidence.policy.minSampleCount).toBe(30);
  });

  it("兼容统一之前落库的旧键名（trace / analyses）", () => {
    const vm = conclusionToVm({
      conclusionType: "INCONCLUSIVE",
      title: "旧结论",
      conclusion: "……",
      status: "FINAL",
      evidence: {
        disclaimer: "免责声明",
        policy: realEvidence.policy,
        trace: [{ rule: "R1_有可用主效应", passed: false, detail: "无" }],
        analyses: [{ analysisId: 1, analysisType: "QUANTILE", effect: 0.01, pValue: 0.5, sampleCount: 100, notes: [] }],
      },
    });
    expect(vm.evidence.ruleTrace).toHaveLength(1);
    expect(vm.evidence.contributingAnalyses).toHaveLength(1);
  });

  it("evidence 缺失 / 非对象时返回空壳而不是抛错（老数据兼容）", () => {
    for (const evidence of [null, undefined, "not-an-object", 42]) {
      const vm = conclusionToVm({
        conclusionType: "INCONCLUSIVE",
        title: "t",
        conclusion: "c",
        status: "FINAL",
        evidence,
      });
      expect(vm.evidence.primaryAnalysis).toBeNull();
      expect(vm.evidence.ruleTrace).toEqual([]);
    }
  });
});

describe("researchEngineAdapter — 错误诊断", () => {
  it("引擎错误码被翻译成「下一步做什么」，而非裸抛错误码", () => {
    const d = rpcErrorToDiagnostic("UNKNOWN_VARIABLE: 变量 future_return_7d 不存在");
    expect(d.code).toBe("UNKNOWN_VARIABLE");
    expect(d.suggestions.length).toBeGreaterThan(0);
    expect(d.technical).toContain("future_return_7d");
  });

  it("支持 [CODE] 包裹形式", () => {
    expect(rpcErrorToDiagnostic("[DATASET_TOO_LARGE] 超出上限").code).toBe("DATASET_TOO_LARGE");
  });

  it("未知错误退化为通用 RPC_ERROR，不臆造建议", () => {
    const d = rpcErrorToDiagnostic("fetch failed");
    expect(d.code).toBe("RPC_ERROR");
    expect(d.explanation).toContain("fetch failed");
  });

  it("空消息也有可读解释", () => {
    expect(rpcErrorToDiagnostic("").explanation.length).toBeGreaterThan(0);
    expect(rpcErrorToDiagnostic(null).title.length).toBeGreaterThan(0);
  });
});
