/**
 * STEP 20 / C-20.2 — 因子消融与 OOS 退化单测。
 *
 * 覆盖（任务验收 + 设计承诺）：
 *   ① 消融几何正确性：REMOVE_SINGLE / LEAVE_ONE_OUT 全谱变体 / CUMULATIVE_REMOVE /
 *      FORWARD_ADD 四种模式的 base + 变体集合 / active·removed·added / marginalTarget；
 *   ② 消融正确性（手算小样本）：3 成分 base 收益已知，剔除一个后差值手算贡献；
 *      sample 层绝对差/相对差/受影响数值核对；
 *   ③ LEAVE_ONE_OUT 全集：对全部成分逐一剔除，贡献排序（显式非 argmax，并列确定性）；
 *   ④ IS/OOS 双轨对照：构造「IS 强贡献 + OOS 无/反向贡献」断言过拟合信号触发
 *      （ABL_IS_POS_OOS_NEG / ABL_IS_POS_OOS_NEUTRAL），阈值参数化生效；
 *   ⑤ 确定性：同输入两次深比较（记录 + fingerprint + serialize 相同）；
 *   ⑥ 退化输入：空成分集 / 单成分 / 未知 mode / 非法 order / evaluator 抛错 / base 失败 /
 *      全部变体失败 / 阈值非法 / 指标非法 —— 分别抛错或显式 unassessed + reasonCode；
 *   ⑦ round-trip + 篡改拒绝（改字段 / 改 fingerprint 均抛错）；
 *   ⑧ 与 C-20.1 汇合适配：toAblationRobustnessView 视图计数 + toAblationOfdAssessmentInput
 *      喂 assessOfdOverfitting（OVERFIT 与 INCONCLUSIVE 两类）；
 *   ⑨ 与 C-19.2 OosIsolationRun 复用对照：真实 walk-forward → OOS 隔离报告派生 OOS 求值，
 *      IS 正贡献 + OOS 无贡献 → 信号触发；
 *   ⑩ Run ID 与便捷入口。
 */

import { describe, expect, it } from "vitest";
import { ResearchValidationError } from "../experimentValidation";
import {
  buildAblationVariants,
  resolveAblationOrder,
} from "./variants";
import {
  assessAblationRun,
  resolveAblationThresholds,
} from "./assess";
import {
  computeAblationAssessmentRunFingerprint,
  deserializeAblationAssessmentRun,
  serializeAblationAssessmentRun,
  validateAblationAssessmentRun,
} from "./serialize";
import {
  formatAblationRunId,
  generateAblationRunId,
  runAblationAssessment,
} from "./run";
import { toAblationOfdAssessmentInput, toAblationRobustnessView } from "./adapt";
import { verifyAblationOosDiscipline } from "./discipline";
import { assessOfdOverfitting } from "../overfittingDetection/assess";
import type {
  AblationAssessmentRun,
  AblationEvaluator,
  AblationMetricsView,
  AblationRequest,
  AblationTarget,
} from "./types";

// ===========================================================================
// helpers
// ===========================================================================

function comp(id: string, kind: AblationTarget["kind"] = "factor", label?: string): AblationTarget {
  return { targetId: id, kind, label: label ?? id };
}

const C3: readonly AblationTarget[] = [
  comp("f_mom", "factor", "动量因子"),
  comp("f_val", "factor", "估值因子"),
  comp("f_liq", "factor", "流动性因子"),
];

const FIXED_TIME = "2026-09-07T12:00:00.000Z";
const RUN_ID = "ABL-20260907-TEST0001";
const STRATEGY = { strategyId: "strategy-abl", strategyVersion: "1.0.0" };

function metrics(totalReturnPct: number, maxDrawdownPct = 1, tradeCount: number | null = 1): AblationMetricsView {
  return { totalReturnPct, maxDrawdownPct, tradeCount };
}

function ok(totalReturnPct: number, maxDrawdownPct = 1, tradeCount: number | null = 1) {
  return { status: "succeeded" as const, metrics: metrics(totalReturnPct, maxDrawdownPct, tradeCount) };
}

/** 记录式假 evaluator：key = variant.code → 标量；failedFor/throwFor 按 code。 */
function codeEvaluator(
  script: Record<string, AblationMetricsView>,
  options: { readonly failedFor?: readonly string[]; readonly throwFor?: readonly string[] } = {},
): AblationEvaluator {
  const failed = new Set(options.failedFor ?? []);
  const throwing = new Set(options.throwFor ?? []);
  return (variant) => {
    if (throwing.has(variant.code)) throw new Error(`evaluator boom on ${variant.code}`);
    if (failed.has(variant.code)) return { status: "failed", error: `脚本失败：${variant.code}` };
    const m = script[variant.code];
    if (!m) return { status: "failed", error: `脚本未覆盖 code=${variant.code}` };
    return { status: "succeeded", metrics: m };
  };
}

/** 标准 REMOVE_SINGLE IS 脚本：base=20；剔除 f_mom→12（贡献 8）/ f_val→15（贡献 5）/ f_liq→18（贡献 2）。 */
function standardIsScript(): Record<string, AblationMetricsView> {
  return {
    BASE_FULL: metrics(20, 5, 10),
    ABL_REMOVE_f_mom: metrics(12, 10, 8),
    ABL_REMOVE_f_val: metrics(15, 6, 9),
    ABL_REMOVE_f_liq: metrics(18, 4, 9),
  };
}

/** 标准请求构造（mode REMOVE_SINGLE，IS 脚本如上，无 OOS）。 */
function standardRequest(overrides: Partial<AblationRequest> = {}): AblationRequest {
  return {
    strategyId: STRATEGY.strategyId,
    strategyVersion: STRATEGY.strategyVersion,
    components: C3,
    mode: "REMOVE_SINGLE",
    isEvaluator: codeEvaluator(standardIsScript()),
    ablationRunId: RUN_ID,
    createdAt: FIXED_TIME,
    ...overrides,
  };
}

function errorCodesOf(call: () => unknown): string[] {
  try {
    call();
  } catch (error) {
    if (error instanceof ResearchValidationError) {
      return error.issues.map((entry) => entry.code);
    }
    if (error instanceof Error) return [error.message];
  }
  return [];
}

function entryOf(run: AblationAssessmentRun, targetId: string) {
  const entry = run.contributions.find((item) => item.targetId === targetId);
  if (entry === undefined) throw new Error(`找不到贡献条目 ${targetId}`);
  return entry;
}

// ===========================================================================
// ① 消融几何正确性（四种模式）
// ===========================================================================

describe("① 消融几何正确性", () => {
  it("REMOVE_SINGLE：3 成分 → base + 3 变体；base 激活全集，每个变体恰剔除一个成分", () => {
    const variants = buildAblationVariants({ mode: "REMOVE_SINGLE", components: C3 });
    expect(variants).toHaveLength(4);
    expect(variants[0]).toMatchObject({
      variantIndex: 0, isBase: true, code: "BASE_FULL", marginalTargetId: null,
      activeIds: ["f_mom", "f_val", "f_liq"], removedIds: [], addedIds: [],
    });
    expect(variants[1]).toMatchObject({
      variantIndex: 1, isBase: false, code: "ABL_REMOVE_f_mom", marginalTargetId: "f_mom",
      activeIds: ["f_val", "f_liq"], removedIds: ["f_mom"],
    });
    expect(variants[2]!.marginalTargetId).toBe("f_val");
    expect(variants[3]!.marginalTargetId).toBe("f_liq");
  });

  it("LEAVE_ONE_OUT：与 REMOVE_SINGLE 同几何（全谱逐出，仅 mode 标签不同），对每个成分恰好一个剔除变体", () => {
    const loo = buildAblationVariants({ mode: "LEAVE_ONE_OUT", components: C3 });
    const single = buildAblationVariants({ mode: "REMOVE_SINGLE", components: C3 });
    expect(loo).toHaveLength(single.length);
    // 几何等同：active/removed/added/marginal 一一对应（mode 标签刻意不同，用于审计区分用途）。
    expect(loo.map((variant) => ({
      code: variant.code, isBase: variant.isBase, activeIds: variant.activeIds,
      removedIds: variant.removedIds, addedIds: variant.addedIds, marginalTargetId: variant.marginalTargetId,
    }))).toEqual(single.map((variant) => ({
      code: variant.code, isBase: variant.isBase, activeIds: variant.activeIds,
      removedIds: variant.removedIds, addedIds: variant.addedIds, marginalTargetId: variant.marginalTargetId,
    })));
    const marginalIds = loo.slice(1).map((variant) => variant.marginalTargetId).sort();
    expect(marginalIds).toEqual(["f_liq", "f_mom", "f_val"]);
    loo.slice(1).forEach((variant) => expect(variant.removedIds).toHaveLength(1));
    expect(loo[0]!.isBase).toBe(true);
  });

  it("CUMULATIVE_REMOVE：按 order 逐层累积去除，removedIds 前缀递增、active 递减", () => {
    const variants = buildAblationVariants({
      mode: "CUMULATIVE_REMOVE", components: C3, order: ["f_val", "f_mom", "f_liq"],
    });
    expect(variants).toHaveLength(4);
    expect(variants[1]).toMatchObject({
      code: "ABL_CUM_1_f_val", removedIds: ["f_val"], activeIds: ["f_mom", "f_liq"], marginalTargetId: "f_val",
    });
    expect(variants[2]).toMatchObject({
      code: "ABL_CUM_2_f_mom", removedIds: ["f_val", "f_mom"], activeIds: ["f_liq"], marginalTargetId: "f_mom",
    });
    expect(variants[3]).toMatchObject({
      code: "ABL_CUM_3_f_liq", removedIds: ["f_val", "f_mom", "f_liq"], activeIds: [], marginalTargetId: "f_liq",
    });
  });

  it("CUMULATIVE_REMOVE：order 缺省 = components 顺序（文档承诺）", () => {
    const variants = buildAblationVariants({ mode: "CUMULATIVE_REMOVE", components: C3 });
    expect(variants.map((variant) => variant.marginalTargetId)).toEqual([null, "f_mom", "f_val", "f_liq"]);
  });

  it("FORWARD_ADD：base=空模型，按 order 逐层加入，addedIds=新成分、active 前缀递增", () => {
    const variants = buildAblationVariants({
      mode: "FORWARD_ADD", components: C3, order: ["f_mom", "f_val", "f_liq"],
    });
    expect(variants).toHaveLength(4);
    expect(variants[0]).toMatchObject({ code: "BASE_EMPTY", isBase: true, activeIds: [] });
    expect(variants[1]).toMatchObject({
      code: "ABL_FWD_1_f_mom", addedIds: ["f_mom"], activeIds: ["f_mom"], marginalTargetId: "f_mom",
    });
    expect(variants[2]).toMatchObject({
      code: "ABL_FWD_2_f_val", addedIds: ["f_val"], activeIds: ["f_mom", "f_val"], marginalTargetId: "f_val",
    });
    expect(variants[3]).toMatchObject({
      code: "ABL_FWD_3_f_liq", addedIds: ["f_liq"], activeIds: ["f_mom", "f_val", "f_liq"], marginalTargetId: "f_liq",
    });
  });
});

// ===========================================================================
// ② 消融正确性（手算小样本）+ ③ LEAVE_ONE_OUT 全集贡献排序
// ===========================================================================

describe("②③ 消融贡献正确性（手算）+ LOO 全集排序", () => {
  it("REMOVE_SINGLE 手算：剔除贡献 = base−剔除后；f_mom=8 / f_val=5 / f_liq=2；排名唯一确定", () => {
    const run = assessAblationRun(standardRequest());
    expect(run.is.samples).toHaveLength(4);
    expect(run.is.samples[0]).toMatchObject({
      status: "succeeded", variant: { isBase: true },
      absoluteDeltaPct: null, relativeDeltaPct: null,
    });
    expect(entryOf(run, "f_mom").isContributionPct).toBe(8);
    expect(entryOf(run, "f_val").isContributionPct).toBe(5);
    expect(entryOf(run, "f_liq").isContributionPct).toBe(2);

    // 排序：IS 贡献降序 → f_mom(8) > f_val(5) > f_liq(2)
    expect(run.contributions.map((entry) => entry.targetId)).toEqual(["f_mom", "f_val", "f_liq"]);
    expect(run.contributions.map((entry) => entry.isRank)).toEqual([1, 2, 3]);
    // 显式非单点 argmax：完整清单（此处只是断言前一名正确，不表达「只看前一名」）
    expect(run.contributions[0]).toMatchObject({ targetId: "f_mom", isRank: 1 });

    // maxDD 变化 = 变体 maxDD − base maxDD（原始呈现）
    expect(entryOf(run, "f_mom").isMaxDrawdownDeltaPct).toBe(5); // 10 − 5
    expect(entryOf(run, "f_val").isMaxDrawdownDeltaPct).toBe(1);
    expect(entryOf(run, "f_liq").isMaxDrawdownDeltaPct).toBe(-1);
  });

  it("sample 层绝对差/相对差核对（相对该轨 base）：f_mom 剔除后 12−20 → −8pp / −40%", () => {
    const run = assessAblationRun(standardRequest());
    const mom = run.is.samples.find((sample) => sample.variant.code === "ABL_REMOVE_f_mom");
    expect(mom).toBeDefined();
    expect(mom!.absoluteDeltaPct).toBe(-8);
    expect(mom!.relativeDeltaPct).toBeCloseTo(-40, 6);
    const liq = run.is.samples.find((sample) => sample.variant.code === "ABL_REMOVE_f_liq");
    expect(liq!.absoluteDeltaPct).toBe(-2);
    expect(liq!.relativeDeltaPct).toBeCloseTo(-10, 6);
  });

  it("LEAVE_ONE_OUT 全集：3 个留一变体全被评估、贡献排序正确、失败为 0", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      mode: "LEAVE_ONE_OUT",
      isEvaluator: codeEvaluator(standardIsScript()),
    });
    expect(run.is.samples).toHaveLength(4);
    expect(run.is.evaluatedCount).toBe(3);
    expect(run.is.failedCount).toBe(0);
    expect(run.contributions.map((entry) => entry.targetId)).toEqual(["f_mom", "f_val", "f_liq"]);
  });

  it("CUMULATIVE_REMOVE 手算：增量损失 = 该步上一变体 − 本变体（9 / 5 / 5，并列按 targetId 字典序）", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      mode: "CUMULATIVE_REMOVE",
      order: ["f_val", "f_mom", "f_liq"],
      isEvaluator: codeEvaluator({
        BASE_FULL: metrics(20, 5, 10),
        ABL_CUM_1_f_val: metrics(15, 6, 9),
        ABL_CUM_2_f_mom: metrics(6, 10, 6),
        ABL_CUM_3_f_liq: metrics(1, 12, 2),
      }),
    });
    expect(entryOf(run, "f_val").isContributionPct).toBe(5); // 20−15
    expect(entryOf(run, "f_mom").isContributionPct).toBe(9); // 15−6
    expect(entryOf(run, "f_liq").isContributionPct).toBe(5); // 6−1
    // 并列 5：f_liq 与 f_val 同分 → targetId 升序 f_liq 在前
    expect(run.contributions.map((entry) => [entry.targetId, entry.isContributionPct, entry.isRank]))
      .toEqual([
        ["f_mom", 9, 1],
        ["f_liq", 5, 2],
        ["f_val", 5, 3],
      ]);
  });

  it("FORWARD_ADD 手算：增量贡献 = 本变体 − 上一变体（base=空模型 2）", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      mode: "FORWARD_ADD",
      order: ["f_mom", "f_val", "f_liq"],
      isEvaluator: codeEvaluator({
        BASE_EMPTY: metrics(2, 3, 1),
        ABL_FWD_1_f_mom: metrics(10, 5, 4),
        ABL_FWD_2_f_val: metrics(16, 6, 7),
        ABL_FWD_3_f_liq: metrics(18, 7, 9),
      }),
    });
    expect(entryOf(run, "f_mom").isContributionPct).toBe(8); // 10−2
    expect(entryOf(run, "f_val").isContributionPct).toBe(6); // 16−10
    expect(entryOf(run, "f_liq").isContributionPct).toBe(2); // 18−16
    expect(run.contributions.map((entry) => entry.targetId)).toEqual(["f_mom", "f_val", "f_liq"]);
    const base = run.is.samples[0]!;
    expect(base.variant.code).toBe("BASE_EMPTY");
    expect(run.is.samples[1]!.absoluteDeltaPct).toBe(8); // 10−2 相对空模型
  });
});

// ===========================================================================
// ④ IS/OOS 双轨对照：过拟合信号候选
// ===========================================================================

describe("④ IS/OOS 双轨：过拟合信号候选触发", () => {
  /** OOS 脚本：base=5；剔除 f_mom→8（OOS 贡献 −3，反向）；f_val→4.6（OOS 贡献 +0.4，趋零）；f_liq→4.4（+0.6，>ceiling 不触发）。 */
  function signalOosScript(): Record<string, AblationMetricsView> {
    return {
      BASE_FULL: metrics(5, 2, 4),
      ABL_REMOVE_f_mom: metrics(8, 1, 3),
      ABL_REMOVE_f_val: metrics(4.6, 2.5, 3),
      ABL_REMOVE_f_liq: metrics(4.4, 2.2, 3),
    };
  }

  it("IS 强贡献 + OOS 反向 → ABL_IS_POS_OOS_NEG；OOS 趋零 → ABL_IS_POS_OOS_NEUTRAL；OOS 仍有贡献 → 不触发", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      oosEvaluator: codeEvaluator(signalOosScript()),
    });
    expect(run.oos).not.toBeNull();
    expect(run.oosAssessed).toBe(true);
    expect(run.unassessedReasonCode).toBeNull();
    // OOS 贡献核对（浮点用 closeTo）
    expect(entryOf(run, "f_mom").oosContributionPct).toBe(-3); // 5−8
    expect(entryOf(run, "f_val").oosContributionPct).toBeCloseTo(0.4, 9); // 5−4.6
    expect(entryOf(run, "f_liq").oosContributionPct).toBeCloseTo(0.6, 9); // 5−4.4
    // 信号：默认 floor=1 → 三个 IS 贡献均 > 1；f_mom 反向、f_val 趋零、f_liq > 0.5 不触发
    expect(run.signals).toHaveLength(2);
    expect(run.signals.map((signal) => [signal.targetId, signal.code])).toEqual([
      ["f_mom", "ABL_IS_POS_OOS_NEG"],
      ["f_val", "ABL_IS_POS_OOS_NEUTRAL"],
    ]);
    expect(entryOf(run, "f_mom").signalCode).toBe("ABL_IS_POS_OOS_NEG");
    expect(entryOf(run, "f_val").signalCode).toBe("ABL_IS_POS_OOS_NEUTRAL");
    expect(entryOf(run, "f_liq").signalCode).toBeNull();
  });

  it("自定义阈值 floor=6：只有 IS 贡献 > 6 的成分才进入信号候选", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      thresholds: { isContributionFloorPct: 6, oosNeutralCeilingPct: 0.5 },
      oosEvaluator: codeEvaluator(signalOosScript()),
    });
    expect(run.signals.map((signal) => signal.targetId)).toEqual(["f_mom"]);
    expect(run.signals[0]!.code).toBe("ABL_IS_POS_OOS_NEG");
  });

  it("无 OOS 轨：oos=null + unassessedReasonCode=ABL_NO_OOS_TRACK，信号为空（诚实留白不编造）", () => {
    const run = assessAblationRun(standardRequest());
    expect(run.oos).toBeNull();
    expect(run.oosAssessed).toBe(false);
    expect(run.unassessedReasonCode).toBe("ABL_NO_OOS_TRACK");
    expect(run.signals).toHaveLength(0);
    // 贡献仍可算 IS 侧
    expect(entryOf(run, "f_mom").isContributionPct).toBe(8);
    expect(entryOf(run, "f_mom").oosContributionPct).toBeNull();
    expect(entryOf(run, "f_mom").oosAssessed).toBe(false);
  });

  it("IS 贡献为负的成分不触发信号（「回测好、泛化差」需 IS 显著为正）；IS 正贡献 + OOS 零贡献仍触发 NEUTRAL", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      isEvaluator: codeEvaluator({
        BASE_FULL: metrics(20, 5, 10),
        ABL_REMOVE_f_mom: metrics(25, 8, 8), // 剔除反而更好 → IS 贡献 −5
        ABL_REMOVE_f_val: metrics(15, 6, 9), // IS 贡献 +5
        ABL_REMOVE_f_liq: metrics(18, 4, 9), // IS 贡献 +2
      }),
      oosEvaluator: codeEvaluator({
        BASE_FULL: metrics(5, 2, 4),
        ABL_REMOVE_f_mom: metrics(5, 1, 3), // OOS 无贡献 0
        ABL_REMOVE_f_val: metrics(5, 2.5, 3), // OOS 无贡献 0
        ABL_REMOVE_f_liq: metrics(5, 2.2, 3), // OOS 无贡献 0
      }),
    });
    expect(entryOf(run, "f_mom").isContributionPct).toBe(-5);
    expect(entryOf(run, "f_mom").oosContributionPct).toBe(0);
    // 负 IS 贡献的成分不进信号候选；IS 正贡献 + OOS 零贡献的两个成分触发 NEUTRAL
    expect(entryOf(run, "f_mom").signalCode).toBeNull();
    expect(run.signals.map((signal) => [signal.targetId, signal.code])).toEqual([
      ["f_val", "ABL_IS_POS_OOS_NEUTRAL"],
      ["f_liq", "ABL_IS_POS_OOS_NEUTRAL"],
    ]);
  });

  it("OOS 全部非 base 变体失败 → unassessedReasonCode=ABL_NO_OOS_VARIANTS、信号为空、oosAssessed=false", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      oosEvaluator: codeEvaluator(standardIsScript(), {
        failedFor: ["ABL_REMOVE_f_mom", "ABL_REMOVE_f_val", "ABL_REMOVE_f_liq"],
      }),
    });
    expect(run.oos).not.toBeNull();
    expect(run.oos!.evaluatedCount).toBe(0);
    expect(run.oos!.failedCount).toBe(3);
    expect(run.unassessedReasonCode).toBe("ABL_NO_OOS_VARIANTS");
    expect(run.oosAssessed).toBe(false);
    expect(run.signals).toHaveLength(0);
  });
});

// ===========================================================================
// ⑤ 确定性
// ===========================================================================

describe("⑤ 确定性（同输入深比较）", () => {
  it("同请求两次运行 → 记录 toEqual、fingerprint 相同、serialize 相同", () => {
    const runA = assessAblationRun(standardRequest());
    const runB = assessAblationRun(standardRequest());
    expect(runB).toEqual(runA);
    expect(runB.fingerprint).toBe(runA.fingerprint);
    expect(serializeAblationAssessmentRun(runB)).toBe(serializeAblationAssessmentRun(runA));
  });

  it("带 OOS 轨的确定性：同一 IS/OOS 脚本两次运行 fingerprint 一致", () => {
    const request = {
      ...standardRequest(),
      oosEvaluator: codeEvaluator({
        BASE_FULL: metrics(5, 2, 4),
        ABL_REMOVE_f_mom: metrics(8, 1, 3),
        ABL_REMOVE_f_val: metrics(4.6, 2.5, 3),
        ABL_REMOVE_f_liq: metrics(4.4, 2.2, 3),
      }),
    };
    const runA = assessAblationRun(request);
    const runB = assessAblationRun(request);
    expect(runA.fingerprint).toBe(runB.fingerprint);
    expect(runA).toEqual(runB);
  });
});

// ===========================================================================
// ⑥ 退化输入与 FAIL FAST
// ===========================================================================

describe("⑥ 退化输入（FAIL FAST 或显式 unassessed）", () => {
  it("空成分集 → ABL_COMPONENTS_EMPTY", () => {
    const codes = errorCodesOf(() => assessAblationRun(standardRequest({ components: [] })));
    expect(codes).toContain("ABL_COMPONENTS_EMPTY");
  });

  it("单成分 → ABL_COMPONENTS_TOO_FEW（响亮抛错，不做无对照归因）", () => {
    const codes = errorCodesOf(() =>
      assessAblationRun(standardRequest({ components: [comp("f_mom")] })));
    expect(codes).toContain("ABL_COMPONENTS_TOO_FEW");
  });

  it("成分 targetId 重复 → ABL_COMPONENT_ID_DUPLICATE", () => {
    const codes = errorCodesOf(() =>
      assessAblationRun(standardRequest({
        components: [comp("f_mom"), comp("f_mom"), comp("f_val")],
      })));
    expect(codes).toContain("ABL_COMPONENT_ID_DUPLICATE");
  });

  it("未知 mode → ABL_MODE_INVALID", () => {
    const codes = errorCodesOf(() =>
      assessAblationRun(standardRequest({ mode: "NOT_A_MODE" as never })));
    expect(codes).toContain("ABL_MODE_INVALID");
  });

  it("CUMULATIVE_REMOVE 非法 order：长度不符 / 未知 id / 重复 → 对应 ABL_ORDER_* 抛错", () => {
    expect(errorCodesOf(() =>
      assessAblationRun(standardRequest({ mode: "CUMULATIVE_REMOVE", order: ["f_mom"] })))
    ).toContain("ABL_ORDER_LENGTH_INVALID");
    expect(errorCodesOf(() =>
      assessAblationRun(standardRequest({ mode: "CUMULATIVE_REMOVE", order: ["f_mom", "f_val", "f_unknown"] })))
    ).toContain("ABL_ORDER_UNKNOWN_ID");
    expect(errorCodesOf(() =>
      assessAblationRun(standardRequest({ mode: "CUMULATIVE_REMOVE", order: ["f_mom", "f_mom", "f_val"] })))
    ).toContain("ABL_ORDER_DUPLICATE");
  });

  it("FORWARD_ADD 合法 order 通过；resolveAblationOrder 对不需要 order 的模式返回 null", () => {
    expect(resolveAblationOrder("REMOVE_SINGLE", C3, ["f_mom"])).toBeNull();
    expect(resolveAblationOrder("FORWARD_ADD", C3)).toEqual(["f_mom", "f_val", "f_liq"]);
    expect(resolveAblationOrder("CUMULATIVE_REMOVE", C3, ["f_val", "f_mom", "f_liq"]))
      .toEqual(["f_val", "f_mom", "f_liq"]);
  });

  it("isEvaluator 非函数 → ABL_EVALUATOR_INVALID", () => {
    const codes = errorCodesOf(() =>
      assessAblationRun(standardRequest({ isEvaluator: undefined as never })));
    expect(codes).toContain("ABL_EVALUATOR_INVALID");
  });

  it("IS 轨 base 评估失败 → 抛错 ABL_IS_BASE_FAILED", () => {
    const codes = errorCodesOf(() =>
      assessAblationRun(standardRequest({
        isEvaluator: codeEvaluator(standardIsScript(), { failedFor: ["BASE_FULL"] }),
      })));
    expect(codes).toContain("ABL_IS_BASE_FAILED");
  });

  it("IS 轨 base 抛错 → 抛错 ABL_IS_BASE_FAILED", () => {
    const codes = errorCodesOf(() =>
      assessAblationRun(standardRequest({
        isEvaluator: codeEvaluator(standardIsScript(), { throwFor: ["BASE_FULL"] }),
      })));
    expect(codes).toContain("ABL_IS_BASE_FAILED");
  });

  it("OOS 轨 base 失败 → 抛错 ABL_OOS_BASE_FAILED（IS 正常）", () => {
    const codes = errorCodesOf(() =>
      assessAblationRun(standardRequest({
        oosEvaluator: codeEvaluator(standardIsScript(), { failedFor: ["BASE_FULL"] }),
      })));
    expect(codes).toContain("ABL_OOS_BASE_FAILED");
  });

  it("IS 轨全部非 base 变体失败 → ABL_NO_IS_VARIANTS（贡献全 null、无信号）", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      isEvaluator: codeEvaluator(standardIsScript(), {
        failedFor: ["ABL_REMOVE_f_mom", "ABL_REMOVE_f_val", "ABL_REMOVE_f_liq"],
      }),
      oosEvaluator: codeEvaluator(standardIsScript()),
    });
    expect(run.is.evaluatedCount).toBe(0);
    expect(run.unassessedReasonCode).toBe("ABL_NO_IS_VARIANTS");
    expect(run.contributions.every((entry) => entry.isAssessed === false)).toBe(true);
    expect(run.signals).toHaveLength(0);
  });

  it("单个变体抛错被转记 failed，不影响其它变体贡献", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      isEvaluator: codeEvaluator(standardIsScript(), { throwFor: ["ABL_REMOVE_f_val"] }),
    });
    expect(run.is.failedCount).toBe(1);
    expect(run.is.evaluatedCount).toBe(2);
    const failedSample = run.is.samples.find((sample) => sample.variant.code === "ABL_REMOVE_f_val");
    expect(failedSample!.status).toBe("failed");
    expect(failedSample!.error).toContain("评估器抛错");
    expect(entryOf(run, "f_val").isAssessed).toBe(false);
    expect(entryOf(run, "f_val").isContributionPct).toBeNull();
    expect(entryOf(run, "f_mom").isContributionPct).toBe(8); // 不受影响
  });

  it("阈值非法：floor <= 0 或 ceiling < 0 → 抛错 ABL_THRESHOLD_*；合法解析通过", () => {
    expect(errorCodesOf(() => resolveAblationThresholds({ isContributionFloorPct: 0 })))
      .toContain("ABL_THRESHOLD_FLOOR_INVALID");
    expect(errorCodesOf(() => resolveAblationThresholds({ oosNeutralCeilingPct: -0.1 })))
      .toContain("ABL_THRESHOLD_CEILING_INVALID");
    expect(errorCodesOf(() => resolveAblationThresholds({ isContributionFloorPct: NaN })))
      .toContain("ABL_THRESHOLD_FLOOR_INVALID");
    expect(resolveAblationThresholds()).toEqual({ isContributionFloorPct: 1, oosNeutralCeilingPct: 0.5 });
    expect(resolveAblationThresholds({ isContributionFloorPct: 3, oosNeutralCeilingPct: 0.2 }))
      .toEqual({ isContributionFloorPct: 3, oosNeutralCeilingPct: 0.2 });
  });

  it("评估产物非法：maxDD 为负的非 base 变体 → 转记 failed；base 为负 → ABL_IS_BASE_FAILED", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      isEvaluator: codeEvaluator({
        BASE_FULL: metrics(20, 5, 10),
        ABL_REMOVE_f_mom: { totalReturnPct: 12, maxDrawdownPct: -1, tradeCount: 1 },
        ABL_REMOVE_f_val: metrics(15, 6, 9),
        ABL_REMOVE_f_liq: metrics(18, 4, 9),
      }),
    });
    expect(run.is.failedCount).toBe(1);
    expect(entryOf(run, "f_mom").isContributionPct).toBeNull();

    const baseBad = codeEvaluator({
      BASE_FULL: { totalReturnPct: 20, maxDrawdownPct: -1, tradeCount: 1 },
      ABL_REMOVE_f_mom: metrics(12, 10, 8),
      ABL_REMOVE_f_val: metrics(15, 6, 9),
      ABL_REMOVE_f_liq: metrics(18, 4, 9),
    });
    expect(errorCodesOf(() => assessAblationRun({ ...standardRequest(), isEvaluator: baseBad })))
      .toContain("ABL_IS_BASE_FAILED");
  });
});

// ===========================================================================
// ⑦ round-trip + 篡改拒绝
// ===========================================================================

describe("⑦ round-trip + 篡改拒绝", () => {
  function signalRun(): AblationAssessmentRun {
    return assessAblationRun({
      ...standardRequest(),
      oosEvaluator: codeEvaluator({
        BASE_FULL: metrics(5, 2, 4),
        ABL_REMOVE_f_mom: metrics(8, 1, 3),
        ABL_REMOVE_f_val: metrics(4.6, 2.5, 3),
        ABL_REMOVE_f_liq: metrics(4.4, 2.2, 3),
      }),
    });
  }

  it("serialize → deserialize toEqual + validate 通过 + fingerprint 复核一致", () => {
    const run = signalRun();
    const json = serializeAblationAssessmentRun(run);
    const validation = validateAblationAssessmentRun(JSON.parse(json));
    expect(validation.valid).toBe(true);
    const back = deserializeAblationAssessmentRun(json);
    expect(back).toEqual(run);
    expect(computeAblationAssessmentRunFingerprint(back)).toBe(back.fingerprint);
  });

  it("篡改字段（strategyVersion）→ 反序列化抛指纹不匹配", () => {
    const json = serializeAblationAssessmentRun(signalRun());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed.strategyVersion = "9.9.9";
    expect(() => deserializeAblationAssessmentRun(JSON.stringify(parsed)))
      .toThrow(/ABL_RUN_FINGERPRINT_MISMATCH/);
  });

  it("篡改 fingerprint 本身 → 反序列化抛指纹不匹配", () => {
    const json = serializeAblationAssessmentRun(signalRun());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed.fingerprint = "0".repeat(64);
    expect(() => deserializeAblationAssessmentRun(JSON.stringify(parsed)))
      .toThrow(/ABL_RUN_FINGERPRINT_MISMATCH/);
  });

  it("结构退化：recordKind / mode 被改 → 结构校验 issue（先于指纹）", () => {
    const json = serializeAblationAssessmentRun(signalRun());
    const kindBad = JSON.parse(json) as Record<string, unknown>;
    kindBad.recordKind = "SOMETHING_ELSE";
    expect(validateAblationAssessmentRun(kindBad).valid).toBe(false);

    const modeBad = JSON.parse(json) as Record<string, unknown>;
    modeBad.mode = "FORWARD"; // 非法字面量（不在 ABLATION_MODES 内）
    expect(validateAblationAssessmentRun(modeBad).valid).toBe(false);
  });

  it("记录深冻结：attempt 修改返回记录的 components 数组 → 抛 TypeError（不可变）", () => {
    const run = signalRun();
    expect(() => {
      (run as unknown as { components: AblationTarget[] }).components.push(comp("f_zzz"));
    }).toThrow();
  });
});

// ===========================================================================
// ⑧ 与 C-20.1 汇合适配
// ===========================================================================

describe("⑧ 与 C-20.1（overfittingDetection）汇合适配", () => {
  it("有信号 → toAblationRobustnessView verdict=sensitive、sensitiveCount=signals 数、axis=factorAblation", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      oosEvaluator: codeEvaluator({
        BASE_FULL: metrics(5, 2, 4),
        ABL_REMOVE_f_mom: metrics(8, 1, 3),
        ABL_REMOVE_f_val: metrics(4.6, 2.5, 3),
        ABL_REMOVE_f_liq: metrics(4.4, 2.2, 3),
      }),
    });
    const view = toAblationRobustnessView(run);
    expect(view.axis).toBe("factorAblation");
    expect(view.verdict).toBe("sensitive");
    expect(view.sensitiveCount).toBe(2);
    expect(view.sampleCount).toBe(3);
    expect(view.sourceFingerprint).toBe(run.fingerprint);
    expect(view.baselineSucceeded).toBe(true);
  });

  it("toAblationOfdAssessmentInput → assessOfdOverfitting：含信号 → 聚合 OVERFIT", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      oosEvaluator: codeEvaluator({
        BASE_FULL: metrics(5, 2, 4),
        ABL_REMOVE_f_mom: metrics(8, 1, 3),
        ABL_REMOVE_f_val: metrics(4.6, 2.5, 3),
        ABL_REMOVE_f_liq: metrics(4.4, 2.2, 3),
      }),
    });
    const input = toAblationOfdAssessmentInput(run);
    expect(input.pbo).toBeNull();
    expect(input.parameterSensitivity).toBeNull();
    expect(input.robustnessView).not.toBeNull();

    // 走 C-20.1 真实聚合判定（import 只读，不改其文件），确保接口契约通畅。
    const ofa = assessOfdOverfitting(input, {
      assessmentRunId: "OFA-ABL-TEST",
      strategyId: STRATEGY.strategyId,
      strategyVersion: STRATEGY.strategyVersion,
      createdAt: FIXED_TIME,
    });
    expect(ofa.conclusion).toBe("OVERFIT");
    expect(ofa.reasons.some((reason) => reason.includes("factorAblation"))).toBe(true);
  });

  it("无信号 → verdict=stable；pbo/ps 缺省喂入 → 聚合 INCONCLUSIVE（诚实不冒充 NOT_OVERFIT）", () => {
    const run = assessAblationRun(standardRequest()); // 无 OOS 轨 → signals 空
    const view = toAblationRobustnessView(run);
    expect(view.verdict).toBe("stable");

    const ofa = assessOfdOverfitting(toAblationOfdAssessmentInput(run), {
      assessmentRunId: "OFA-ABL-TEST2",
      strategyId: STRATEGY.strategyId,
      strategyVersion: STRATEGY.strategyVersion,
      createdAt: FIXED_TIME,
    });
    expect(ofa.conclusion).toBe("INCONCLUSIVE");
  });
});

// ===========================================================================
// ⑨ 与 C-19.2 OosIsolationRun 复用对照
// ===========================================================================

describe("⑨ 与 C-19.2 OosIsolationRun 复用对照（真实 walk-forward → OOS 隔离报告派生 OOS 求值）", () => {
  it("OOS evaluator 从真实 OosIsolationRun.report 派生：IS 强贡献 + OOS 无贡献 → 信号触发", async () => {
    // 走真实 WalkForward → OOS 隔离链路（动态 import 确保与 C-19.2 契约通畅）。
    const { runWalkForward } = await import("../walkForwardRun/run");
    const { generateWalkForwardSplits } = await import("../walkForwardRun/windows");
    const { runOosIsolation } = await import("../oosIsolation/run");

    const tradeDates = (count: number, start = "2024-01-01"): string[] => {
      const out: string[] = [];
      const cursor = new Date(`${start}T00:00:00Z`);
      for (let i = 0; i < count; i++) {
        out.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return out;
    };
    const dates = tradeDates(12);
    const wf = runWalkForward({
      strategyId: "strategy-abl",
      strategyVersion: "1.0.0",
      method: "grid",
      parameterSpace: { parameters: [{ type: "integer", name: "k", min: 1, max: 3, step: 1 }] },
      tradeDates: dates,
      splitConfig: { trainWindow: 5, testWindow: 2, step: 1 },
      optimizeEvaluatorFactory: () => () => ok(10, 1, 1),
      testEvaluatorFactory: () => () => ok(5, 1, 1),
      runId: "WFA-ABL-TEST",
      createdAt: FIXED_TIME,
    });
    const splits = generateWalkForwardSplits(dates, wf.splitConfig);
    const oosCurves = new Map<string, readonly { date: string; cash: number; marketValue: number; equity: number; openPositions: number }[]>();
    splits.forEach((split, index) => {
      oosCurves.set(`WFA-ABL-TEST-w${split.windowIndex}`, [
        { date: split.testDates[0]!, cash: 0, marketValue: 0, equity: 100, openPositions: 0 },
        { date: split.testDates[1]!, cash: 0, marketValue: 0, equity: index % 2 === 0 ? 105 : 98, openPositions: 0 },
      ]);
    });
    const oosRun = runOosIsolation({
      walkForwardRun: wf,
      oosEquityCurves: oosCurves,
      runId: "OOSISO-ABL-TEST",
      createdAt: FIXED_TIME,
    });

    // OOS 轨求值从真实 OosIsolationRun 报告派生：每个变体取 OOS 段评估均值（read-only）。
    const report = oosRun.report;
    const derivedOosReturn = report.oosSegmentAggregate.meanTotalReturnPct ?? report.walkForwardAggregate.meanTestTotalReturnPct;
    expect(derivedOosReturn).not.toBeNull();

    const isScript = standardIsScript();
    const oosScript: Record<string, AblationMetricsView> = {};
    for (const code of Object.keys(isScript)) {
      oosScript[code] = metrics(derivedOosReturn as number, 1, 1);
    }
    const run = assessAblationRun({
      ...standardRequest(),
      isEvaluator: codeEvaluator(isScript),
      oosEvaluator: codeEvaluator(oosScript),
      thresholds: { isContributionFloorPct: 1, oosNeutralCeilingPct: 0.5 },
    });
    // IS 贡献强为正（8/5/2），OOS 各变体绩效相同 → OOS 贡献均为 0 → 全部触发 NEUTRAL 信号候选
    expect(run.signals).toHaveLength(3);
    expect(run.signals.every((signal) => signal.code === "ABL_IS_POS_OOS_NEUTRAL")).toBe(true);
    // OosIsolationRun 记录本身可用（指纹完整、隔离纪律通过）——复用对照的证据。
    expect(oosRun.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(oosRun.discipline.passed).toBe(true);
  });
});

// ===========================================================================
// ⑩ Run ID 与便捷入口
// ===========================================================================

describe("⑩ Run ID 与便捷入口", () => {
  it("formatAblationRunId / generateAblationRunId（注入 suffix 确定性）", () => {
    expect(formatAblationRunId("20260907", "ABCD1234")).toBe("ABL-20260907-ABCD1234");
    const id = generateAblationRunId(new Date("2026-09-07T00:00:00Z"), "ABCD1234");
    expect(id).toBe("ABL-20260907-ABCD1234");
    expect(generateAblationRunId(new Date("2026-01-05T00:00:00Z"), "AABBCCDD")).toBe("ABL-20260105-AABBCCDD");
    // 无 suffix → 随机 8 位大写 hex（格式断言，非内容）
    const auto = generateAblationRunId(new Date("2026-09-07T00:00:00Z"));
    expect(auto).toMatch(/^ABL-20260907-[0-9A-F]{8}$/);
  });

  it("runAblationAssessment：注入 ablationRunId/createdAt 直通；缺省自动补全且确定字段格式", () => {
    const withMeta = runAblationAssessment({
      strategyId: STRATEGY.strategyId,
      strategyVersion: STRATEGY.strategyVersion,
      components: C3,
      mode: "REMOVE_SINGLE",
      isEvaluator: codeEvaluator(standardIsScript()),
      ablationRunId: "ABL-20260907-CUSTOM",
      createdAt: FIXED_TIME,
    });
    expect(withMeta.ablationRunId).toBe("ABL-20260907-CUSTOM");
    expect(withMeta.createdAt).toBe(FIXED_TIME);

    const auto = runAblationAssessment({
      strategyId: STRATEGY.strategyId,
      strategyVersion: STRATEGY.strategyVersion,
      components: C3,
      mode: "REMOVE_SINGLE",
      isEvaluator: codeEvaluator(standardIsScript()),
    });
    expect(auto.ablationRunId).toMatch(/^ABL-\d{8}-[0-9A-F]{8}$/);
    expect(auto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ===========================================================================
// ⑪ OOS 只读纪律审计（verifyAblationOosDiscipline）
// ===========================================================================

describe("⑪ OOS 只读纪律审计（机器检查）", () => {
  it("有 OOS 轨且两轨对齐 → passed=true、tracksAligned=true、orderFixed=true", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      oosEvaluator: codeEvaluator({
        BASE_FULL: metrics(5, 2, 4),
        ABL_REMOVE_f_mom: metrics(8, 1, 3),
        ABL_REMOVE_f_val: metrics(4.6, 2.5, 3),
        ABL_REMOVE_f_liq: metrics(4.4, 2.2, 3),
      }),
    });
    const audit = verifyAblationOosDiscipline(run);
    expect(audit.oosTrackPresent).toBe(true);
    expect(audit.variantCount).toBe(4);
    expect(audit.tracksAligned).toBe(true);
    expect(audit.targetSetsIdentical).toBe(true);
    expect(audit.orderFixedBeforeEvaluation).toBe(true);
    expect(audit.signalsDoNotDriveOrder).toBe(true);
    expect(audit.passed).toBe(true);
    expect(audit.violations).toEqual([]);
  });

  it("无 OOS 轨 → oosTrackPresent=false，纪律审计通过（vacuously：无事可违）", () => {
    const run = assessAblationRun(standardRequest());
    const audit = verifyAblationOosDiscipline(run);
    expect(audit.oosTrackPresent).toBe(false);
    expect(audit.tracksAligned).toBe(true);
    expect(audit.targetSetsIdentical).toBe(true);
    expect(audit.passed).toBe(true);
  });

  it("反序列化后篡改 OOS 变体（code 与 IS 不一致）→ 审计拦截（tracksAligned=false、violations 非空）", () => {
    const run = assessAblationRun({
      ...standardRequest(),
      oosEvaluator: codeEvaluator({
        BASE_FULL: metrics(5, 2, 4),
        ABL_REMOVE_f_mom: metrics(8, 1, 3),
        ABL_REMOVE_f_val: metrics(4.6, 2.5, 3),
        ABL_REMOVE_f_liq: metrics(4.4, 2.2, 3),
      }),
    });
    const json = serializeAblationAssessmentRun(run);
    const parsed = JSON.parse(json) as unknown as AblationAssessmentRun;
    // 篡改：OOS 轨样本[1] 的 code 指向另一个变体（模拟归档内容被破坏）。
    const oosSamples = parsed.oos!.samples as unknown as { variant: { code: string; variantIndex: number } }[];
    oosSamples[1]!.variant.code = "ABL_REMOVE_f_val"; // 本应 ABL_REMOVE_f_mom
    const audit = verifyAblationOosDiscipline(parsed);
    expect(audit.tracksAligned).toBe(false);
    expect(audit.passed).toBe(false);
    expect(audit.violations.length).toBeGreaterThan(0);
  });
});
