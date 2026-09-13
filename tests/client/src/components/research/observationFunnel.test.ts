/**
 * observationFunnel 单测。
 *
 * 覆盖重点是三件事：
 *
 * 1. **归组纪律**：13 条真实分析名必须**全部**能识别出级次（一个都不许漏进 `unclassified`），
 *    且最具体的级（「缩量 + 末日放量」）不能被较宽松的级（「缩量」）先吃掉；
 * 2. **主链 / 对照组的区分**：`nested` 标记必须如实 —— 对照组（已破位 / 未缩量）是
 *    **平行**的，把它标成 `nested` 会让人误以为漏斗在层层减少；
 * 3. **口径纪律与真实数值**：用 Run #570001 的**真实落库数值**做金标准断言 ——
 *    这样一旦有人改坏了 result 行解析（比如把 `MEAN_RETURN` 换成 `MEAN`、
 *    或把 `SAMPLE_COUNT` 的 group 读错），测试立刻红。
 *
 * 不锁定格式化细节（`—` / `+1.23%` 之类由 `researchEngineAdapter` 自己的单测负责）。
 */

import { describe, expect, it } from "vitest";
import {
  buildFunnelIndex,
  formatRatio,
  formatShare,
  summarizeFunnel,
} from "../../../../../client/src/components/research/observationFunnel";
import type {
  FunnelAnalysisLike,
  FunnelStageKind,
} from "../../../../../client/src/components/research/observationFunnel";
import type { ResultRowLike } from "@/adapters/researchEngineAdapter";

// ---------------------------------------------------------------------------
// 构造器
// ---------------------------------------------------------------------------

/** 真实 Run #570001 的 13 条分析（id / name / target 逐字照抄自落库）。 */
const REAL_ANALYSES: FunnelAnalysisLike[] = [
  { id: 540001, name: "观察日·T+3 未破首板最低价（买入条件线） → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540002, name: "观察日·T+3 已破首板最低价（逻辑证伪） → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540003, name: "观察日·T+3 回撤 0~2%（浅回踩）且未破位 → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540004, name: "观察日·T+3 回撤 2~5%（标准回踩）且未破位 → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540005, name: "观察日·T+3 回撤 5%+ 且未破位 → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540006, name: "观察日·T+3 未破位 且 缩量≤50%（缩量洗盘验证） → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540007, name: "观察日·T+3 未破位 且 极致缩量≤30% → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540008, name: "观察日·T+3 未破位 但 未缩量（>50%） → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540009, name: "观察日·T+3 未破位 且 缩量≤50% 且 收盘已高于首板日收盘 → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540010, name: "观察日·T+3 未破位 且 缩量≤50% 且 末日放量（量能比>1） → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540011, name: "观察日·T+3 未破位 且 收盘相对首板日为正（守线 + 翻红） → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540012, name: "观察日·T+2 未破位（早确认） → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
  { id: 540013, name: "观察日·T+5 未破位 且 缩量≤50%（5日窗口） → 之后5日收益", target: "future_return_5d", status: "COMPLETED" },
];

/**
 * 真实落库数值（`_summarize_observation_funnel.mts` 的实测输出，逐字照抄）。
 * 顺序与 `REAL_ANALYSES` 一致：[n, mean, median, win, allN, allMean, diff, tStat]。
 */
const REAL_VALUES: Record<number, readonly [number, number, number, number, number, number, number, number]> = {
  540001: [19080, 0.0397, 0.0111, 0.5518, 23751, 0.0152, 0.0245, 19.18],
  540002: [4664, -0.0849, -0.0909, 0.1565, 23751, 0.0152, -0.1001, -59.96],
  540003: [2377, -0.0108, -0.0162, 0.35, 23751, 0.0152, -0.026, -18.14],
  540004: [3051, -0.0361, -0.0396, 0.1835, 23751, 0.0152, -0.0513, -39.42],
  540005: [2218, -0.073, -0.0741, 0.105, 23751, 0.0152, -0.0882, -53.92],
  540006: [2746, 0.0716, -0.0013, 0.4953, 23751, 0.0152, 0.0564, 15.07],
  540007: [705, 0.212, 0.1848, 0.7688, 23751, 0.0152, 0.1968, 22.31],
  540008: [16334, 0.0343, 0.0124, 0.5613, 23751, 0.0152, 0.0191, 15.29],
  540009: [1376, 0.1898, 0.126, 0.8379, 23751, 0.0152, 0.1746, 31.43],
  540010: [723, 0.178, 0.1442, 0.8313, 23751, 0.0152, 0.1628, 23.38],
  540011: [11427, 0.0923, 0.0557, 0.7789, 23751, 0.0152, 0.0771, 50.11],
  540012: [20527, 0.0305, 0.0049, 0.5199, 23751, 0.0152, 0.0153, 12.16],
  540013: [4482, 0.0556, -0.007, 0.4614, 23751, 0.0152, 0.0404, 15.59],
};

function groupedRow(
  metricCode: string,
  metricValue: number,
  sampleCount: number,
  group: "CONDITION" | "ALL",
  target: string,
): ResultRowLike {
  return {
    resultType: "GROUPED",
    metricCode,
    metricValue,
    sampleCount,
    dimension: { group },
    details: { outcomeVariable: target, variable: "future_return_5d" },
  };
}

function scalarRow(metricCode: string, metricValue: number, target: string): ResultRowLike {
  return {
    resultType: "SCALAR",
    metricCode,
    metricValue,
    sampleCount: null,
    dimension: null,
    details: { outcomeVariable: target, conditionRule: `rule-for-${metricCode}` },
  };
}

/** 用真实数值构造一条分析的完整结果行。 */
function realRows(analysisId: number): ResultRowLike[] {
  const v = REAL_VALUES[analysisId]!;
  const [n, mean, median, win, allN, allMean, diff, t] = v;
  const target = "future_return_5d";
  return [
    groupedRow("MEAN_RETURN", mean, n, "CONDITION", target),
    groupedRow("MEDIAN_RETURN", median, n, "CONDITION", target),
    groupedRow("STD_RETURN", 0.16, n, "CONDITION", target),
    groupedRow("WIN_RATE", win, n, "CONDITION", target),
    groupedRow("SAMPLE_COUNT", n, n, "CONDITION", target),
    groupedRow("MEAN_RETURN", allMean, allN, "ALL", target),
    groupedRow("MEDIAN_RETURN", allMean - 0.005, allN, "ALL", target),
    groupedRow("STD_RETURN", 0.133, allN, "ALL", target),
    groupedRow("WIN_RATE", 0.4742, allN, "ALL", target),
    groupedRow("SAMPLE_COUNT", allN, allN, "ALL", target),
    scalarRow("DIFFERENCE", diff, target),
    scalarRow("RELATIVE_DIFFERENCE", diff / Math.abs(allMean), target),
    scalarRow("T_STAT_DIFFERENCE", t, target),
    scalarRow("P_VALUE_DIFFERENCE", 1e-60, target),
  ];
}

function realRowsById(): Map<number, readonly ResultRowLike[]> {
  const map = new Map<number, readonly ResultRowLike[]>();
  for (const a of REAL_ANALYSES) map.set(a.id, realRows(a.id));
  return map;
}

function kindsOf(stages: readonly { kind: FunnelStageKind }[]): FunnelStageKind[] {
  return stages.map((s) => s.kind);
}

// ---------------------------------------------------------------------------
// 1. 归组纪律
// ---------------------------------------------------------------------------

describe("observationFunnel — 归组纪律", () => {
  it("真实 Run 的 13 条分析全部能归组，一个都不落进 unclassified", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, new Map());
    expect(index.unclassified).toEqual([]);
    expect(index.chain.length + index.controls.length).toBe(13);
  });

  it("主链 11 级 / 对照组 2 级（已破位 + 未缩量）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, new Map());
    expect(index.chain).toHaveLength(11);
    expect(kindsOf(index.controls)).toEqual(["break", "hold_no_shrink"]);
  });

  it("🔴 主链起点「守线」必须在链里，不能掉进对照组（nested 语义 = 属于主链，非「是子集」）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, new Map());
    expect(index.chain[0]!.kind).toBe("hold");
    expect(index.chain[0]!.analysisId).toBe(540001);
    expect(index.controls.some((s) => s.kind === "hold")).toBe(false);
  });

  it("主链严格按「用户思考规则的顺序」排列，与样本量无关", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, new Map());
    expect(kindsOf(index.chain)).toEqual([
      "hold",
      "hold_shallow",
      "hold_standard",
      "hold_deep",
      "hold_shrink",
      "hold_shrink_extreme",
      "hold_shrink_strong",
      "hold_shrink_volume_up",
      "hold_flip_green",
      "hold_early",
      "hold_long",
    ]);
  });

  it("🔴 最具体的级不能被较宽松的级吃掉（缩量+末日放量 vs 缩量）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, new Map());
    const specific = index.chain.find((s) => s.kind === "hold_shrink_volume_up");
    // 「守线 + 缩量 + 末日放量」必须归到 hold_shrink_volume_up (#540010)，而不是 hold_shrink (#540006)
    expect(specific?.analysisId).toBe(540010);
    expect(index.chain.find((s) => s.kind === "hold_shrink")?.analysisId).toBe(540006);
  });

  it("🔴 「守线 + 极致缩量」不能被「守线 + 缩量」先吃掉", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, new Map());
    expect(index.chain.find((s) => s.kind === "hold_shrink_extreme")?.analysisId).toBe(540007);
  });

  it("对照组与主链互斥：nested=false，且 sampleCount 不参与「逐级缩减」计算", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    for (const c of index.controls) {
      expect(c.nested).toBe(false);
      expect(c.shrinkFromPrev).toBeNull();
    }
  });

  it("识别不出的分析名进 unclassified 且带原因（绝不静默丢弃）", () => {
    const index = buildFunnelIndex(
      [{ id: 999, name: "某个无关的分析", target: "future_return_5d", status: "COMPLETED" }],
      new Map(),
    );
    expect(index.chain).toHaveLength(0);
    expect(index.unclassified).toHaveLength(1);
    expect(index.unclassified[0]!.analysisId).toBe(999);
    expect(index.unclassified[0]!.reason.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. 真实数值（金标准）
// ---------------------------------------------------------------------------

describe("observationFunnel — 真实数值（Run #570001 落库金标准）", () => {
  it("🔴 全样本基准 23,751 / 均值 +1.52%（与探针输出逐字一致）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const summary = summarizeFunnel(index);
    expect(summary.allSampleCount).toBe(23751);
    expect(index.chain[0]!.allValue).toBeCloseTo(0.0152, 4);
  });

  it("🔴 ① 守线：n=19,080（80.3%），均值 +3.97%，差值 +2.45pp", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const hold = index.chain.find((s) => s.kind === "hold")!;
    expect(hold.conditionSampleCount).toBe(19080);
    expect(hold.allSampleCount).toBe(23751);
    expect(hold.shareOfAll).toBeCloseTo(19080 / 23751, 6);
    expect(hold.value).toBeCloseTo(0.0397, 4);
    expect(hold.allValue).toBeCloseTo(0.0152, 4);
    expect(hold.difference).toBeCloseTo(0.0245, 4);
    expect(hold.tStat).toBeCloseTo(19.18, 2);
    expect(hold.lowSample).toBe(false);
  });

  it("🔴 ② 守线 + 缩量≤50%：n=2,746（11.6%），均值 +7.16%、胜率 49.53%", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const shrink = index.chain.find((s) => s.kind === "hold_shrink")!;
    expect(shrink.conditionSampleCount).toBe(2746);
    expect(shrink.shareOfAll).toBeCloseTo(2746 / 23751, 6);
    expect(shrink.value).toBeCloseTo(0.0716, 4);
    expect(shrink.difference).toBeCloseTo(0.0564, 4);
  });

  it("🔴 ②a 极致缩量≤30%：n=705（3.0%）—— 「极致缩量」是最高均值的一级之一", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const extreme = index.chain.find((s) => s.kind === "hold_shrink_extreme")!;
    expect(extreme.conditionSampleCount).toBe(705);
    expect(extreme.value).toBeCloseTo(0.212, 4);
    expect(extreme.difference).toBeCloseTo(0.1968, 4);
  });

  it("🔴 全链最优级 = 极致缩量≤30%（+21.2%），高于「缩量+价强」(+18.98%)", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const extreme = index.chain.find((s) => s.kind === "hold_shrink_extreme")!;
    const strong = index.chain.find((s) => s.kind === "hold_shrink_strong")!;
    expect(extreme.value).toBeCloseTo(0.212, 4);
    expect(strong.value).toBeCloseTo(0.1898, 4);
    // 极致缩量是全链均值最高的一级 —— 这条事实必须能被测试钉住
    for (const s of index.chain) {
      if (s.kind === "hold_shrink_extreme") continue;
      expect(extreme.value!).toBeGreaterThanOrEqual(s.value!);
    }
  });

  it("🔴 ③ 守线 + 缩量 + 价强：n=1,376（5.8%），均值 +18.98%、胜率 83.79%", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const strong = index.chain.find((s) => s.kind === "hold_shrink_strong")!;
    expect(strong.conditionSampleCount).toBe(1376);
    expect(strong.value).toBeCloseTo(0.1898, 4);
    expect(strong.winRateDisplay).not.toBe("—");
  });

  it("🔴 ③a 守线 + 缩量 + 末日放量（用户「信号B」）：n=723，均值 +17.80%", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const signalB = index.chain.find((s) => s.kind === "hold_shrink_volume_up")!;
    expect(signalB.conditionSampleCount).toBe(723);
    expect(signalB.value).toBeCloseTo(0.178, 4);
    expect(signalB.difference).toBeCloseTo(0.1628, 4);
  });

  it("🔴 对照组·已破位：n=4,664（19.6%），均值 -8.49%（逻辑证伪成立）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const brk = index.controls.find((s) => s.kind === "break")!;
    expect(brk.conditionSampleCount).toBe(4664);
    expect(brk.value).toBeCloseTo(-0.0849, 4);
    expect(brk.value).toBeLessThan(0);
  });

  it("🔴 对照组·守线但未缩量：n=16,334（68.8%）—— 说明「缩量」才是真正的筛选器", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const noShrink = index.controls.find((s) => s.kind === "hold_no_shrink")!;
    expect(noShrink.conditionSampleCount).toBe(16334);
    // 未缩量的均值（+3.43%）明显低于缩量组（+7.16%）⇒ 缩量条件是有效的
    const shrink = index.chain.find((s) => s.kind === "hold_shrink")!;
    expect(noShrink.value!).toBeLessThan(shrink.value!);
  });

  it("🔴 守线 + 破位 = 全样本（闭集闭环：19080 + 4664 ≈ 23751，差值为缺 T+3 数据的样本）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const hold = index.chain.find((s) => s.kind === "hold")!;
    const brk = index.controls.find((s) => s.kind === "break")!;
    const sum = hold.conditionSampleCount! + brk.conditionSampleCount!;
    // 19080 + 4664 = 23744，全样本 23751 ⇒ 差 7 条（T+3 K 线缺失，引擎已剔除非有限值）
    expect(sum).toBe(23744);
    expect(index.chain[0]!.allSampleCount! - sum).toBe(7);
  });

  it("逐级缩减比：守线 → 缩量 保留 14.4%（这才是「筛掉」的真实力度）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const hold = index.chain.find((s) => s.kind === "hold")!;
    const shrink = index.chain.find((s) => s.kind === "hold_shrink")!;
    // 🔴 分母必须是「守线」(19,080)，不是链里前一个元素「深回撤」(2,218)
    expect(shrink.shrinkFromPrev).toBeCloseTo(2746 / 19080, 6);
    expect(shrink.shrinkFromPrev!).toBeLessThan(0.2);
    expect(shrink.shrinkBaselineLabel).toBe(hold.label);
    // 起点（hold）的父级是全样本 ⇒ 为 null
    expect(hold.shrinkFromPrev).toBeNull();
    expect(hold.parent).toBeNull();
  });

  it("🔴 深浅回撤三级的父级都是「守线」（不是链里前一个），保留比均 <100%", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    for (const kind of ["hold_shallow", "hold_standard", "hold_deep"] as const) {
      const s = index.chain.find((x) => x.kind === kind)!;
      expect(s.parent).toBe("hold");
      expect(s.shrinkBaselineLabel).toBe(index.chain[0]!.label);
      // 子集不可能大于父集 ⇒ 保留比必须 < 100%
      expect(s.shrinkFromPrev!).toBeLessThan(1);
    }
    // 浅+标准+深 ≈ 守线（三桶覆盖全部守线样本，差值为桶边界落空）
    const sum = (["hold_shallow", "hold_standard", "hold_deep"] as const)
      .map((k) => index.chain.find((x) => x.kind === k)!.conditionSampleCount!)
      .reduce((a, b) => a + b, 0);
    expect(sum).toBe(2377 + 3051 + 2218);
    expect(index.chain[0]!.conditionSampleCount! - sum).toBe(19080 - 7646);
  });

  it("父级本 Run 未建分析时回落到前驱，并如实标注比较对象（不静默给错分母）", () => {
    // 只给「守线 + 缩量」，不给「守线」
    const index = buildFunnelIndex(
      [{ id: 1, name: "观察日·T+3 未破位 且 缩量≤50% → 之后5日收益", target: "future_return_5d", status: "COMPLETED" }],
      new Map([[1, realRows(540006)]]),
    );
    const shrink = index.chain.find((s) => s.kind === "hold_shrink")!;
    // 链上没有父级、也没有前驱 ⇒ 退回 null（宁可空着，不编一个分母）
    expect(shrink.shrinkFromPrev).toBeNull();
    expect(shrink.shrinkBaselineLabel).toBeNull();
  });

  it("🔴 T+2 早确认必须没有「保留比」（它是平行窗口变体，样本比守线还多 107.6%）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const early = index.chain.find((s) => s.kind === "hold_early")!;
    const hold = index.chain.find((s) => s.kind === "hold")!;
    // 实测 20,527 > 19,080 ⇒ 它不是「守线」的子集
    expect(early.conditionSampleCount!).toBeGreaterThan(hold.conditionSampleCount!);
    // 因此父级必须是 null（父级是全样本），且不得算出任何「保留比」
    expect(early.parent).toBeNull();
    expect(early.shrinkFromPrev).toBeNull();
    expect(early.shrinkBaselineLabel).toBeNull();
  });

  it("🔴 任何「保留比」都必须 <100%（子集不可能大于父集）—— 全链回归护栏", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    for (const s of [...index.chain, ...index.controls]) {
      if (s.shrinkFromPrev === null) continue;
      expect(s.shrinkFromPrev, `${s.label} 的保留比 ${s.shrinkFromPrev} 不合理`).toBeLessThan(1);
    }
  });

  it("中位数 / 胜率 / 标准差均已解析（不是 —）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    for (const s of index.chain) {
      expect(s.medianDisplay).not.toBe("—");
      expect(s.winRateDisplay).not.toBe("—");
      expect(s.stdDisplay).not.toBe("—");
    }
  });

  it("规则原文从 details.conditionRule 解析出来（可展开查看）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    expect(index.chain[0]!.conditionRule).toBeTruthy();
  });

  it("targetVariable 取自有 target 的分析（全为 future_return_5d）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    expect(index.targetVariable).toBe("future_return_5d");
    expect(index.metricLabel).toBe("future_return_5d");
  });
});

// ---------------------------------------------------------------------------
// 3. 结果缺失 / 口径不一致的保护网
// ---------------------------------------------------------------------------

describe("observationFunnel — 缺结果与口径保护", () => {
  it("还没跑出结果的分析仍出现在漏斗里（status 如实显示，值显示 —）", () => {
    const index = buildFunnelIndex(
      [{ id: 1, name: "观察日·T+3 未破首板最低价（买入条件线） → 之后5日收益", target: "future_return_5d", status: "PENDING" }],
      new Map(),
    );
    expect(index.chain).toHaveLength(1);
    const s = index.chain[0]!;
    expect(s.status).toBe("PENDING");
    expect(s.value).toBeNull();
    expect(s.valueDisplay).toBe("—");
    expect(s.conditionSampleCount).toBeNull();
    expect(s.shareOfAll).toBeNull();
  });

  it("target 与结果行自报的 outcomeVariable 不一致时整行排除（口径保护网）", () => {
    const rows: ResultRowLike[] = [
      groupedRow("MEAN_RETURN", 0.5, 100, "CONDITION", "other_variable"),
      groupedRow("SAMPLE_COUNT", 100, 100, "CONDITION", "other_variable"),
    ];
    const index = buildFunnelIndex(
      [{ id: 1, name: "观察日·T+3 未破首板最低价 → 之后5日收益", target: "future_return_5d", status: "COMPLETED" }],
      new Map([[1, rows]]),
    );
    const s = index.chain[0]!;
    expect(s.value).toBeNull();
    expect(s.excludedRowCount).toBeGreaterThan(0);
  });

  it("summarizeFunnel 在全无结果时给出 null 而非 0（不伪造）", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, new Map());
    const summary = summarizeFunnel(index);
    expect(summary.allSampleCount).toBeNull();
    expect(summary.finalSampleCount).toBeNull();
    expect(summary.finalShareOfAll).toBeNull();
    expect(summary.resolvedChain).toBe(0);
    expect(summary.chainSize).toBe(11);
  });

  it("summarizeFunnel 的链末端取「最后一个有结果的级」", () => {
    const index = buildFunnelIndex(REAL_ANALYSES, realRowsById());
    const summary = summarizeFunnel(index);
    expect(summary.allSampleCount).toBe(23751);
    // 最后一个有结果的主链级 = hold_long (#540013, n=4482)
    expect(summary.finalSampleCount).toBe(4482);
    expect(summary.resolvedChain).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// 4. 格式化
// ---------------------------------------------------------------------------

describe("observationFunnel — 格式化", () => {
  it("formatShare：极小值不显示成 0.0%（保留 <0.05% 标记）", () => {
    expect(formatShare(null)).toBe("—");
    expect(formatShare(0.8)).toBe("80.0%");
    expect(formatShare(0.0001)).toBe("<0.05%");
    expect(formatShare(0.001)).toBe("0.1%");
  });

  it("formatRatio：小比率保留更多精度（避免小样本缩减比失真）", () => {
    expect(formatRatio(null)).toBe("—");
    expect(formatRatio(0.144)).toBe("14.4%");
    expect(formatRatio(0.0012)).toBe("0.1200%");
  });
});
