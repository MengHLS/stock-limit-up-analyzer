/**
 * 跨阶段 Robustness 泛化层 —— 公共机制测试（EXP-002 规格 §21 的前半：**公共机制 11 项**）。
 *
 * | # | 面 | 钉在哪 |
 * | --- | --- | --- |
 * | 1 | baseline 校验 | 索引 0 必须基准 / 恰一条 / 基准的 dimensionId 为 null |
 * | 2 | variant 校验 | 未知维度 / 重复 code / 空 code / 不可序列化 config 一律拒 |
 * | 3 | evaluator 注入（核心零 IO） | 核心**只**消费 evaluator 的返回值，不重算任何东西 |
 * | 4 | metric extensibility | 词表任意声明；未声明指标 / 非有限值 → 结构化 failed（不静默） |
 * | 5 | comparison | 逐指标 delta / verdict；不可用 → insufficient（**不拿 null 当 0**） |
 * | 6 | tolerance | 严格大于、三个方向、非法容差 / 非法 delta 结构化抛错 |
 * | 7 | failed variant | 评估器抛错 / 产物非法 → failed 样本；不影响其余变体与基准 |
 * | 8 | baseline failure | 基准失败 ⇒ `RB18X_BASELINE_FAILED`，拒绝产出无锚点结论 |
 * | 9 | sample accounting | 两条守恒式 + 原因合计，不平即 failed（不静默接受） |
 * | 10 | multi-dimension matrix | 一个 Run 一个基准、多维度共享它；维度结论 / 计数自洽 |
 * | 11 | deterministic fingerprint | 同输入 ⇒ 同指纹 / 逐字节同串；改一个值 ⇒ 变；篡改 ⇒ 拒 |
 *
 * 另外守住 `ROBUSTNESS-CROSS-STAGE-001` 结论 B 的落地判据：
 * C-18.1 的两个固定阈值字段能被**声明式比较**无语义损失替代（§18 P1-3）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ResearchValidationError } from "../../../../server/research/experimentValidation";
import {
  COMPARISON_DIRECTIONS,
  evaluateTolerance,
  resolveComparisonSpecs,
  summarizeUnitVerdict,
  type MetricComparisonSpec,
} from "../../../../server/research/robustness/comparison";
import {
  ROBUSTNESS_SAMPLE_ACCOUNTING_FORMULA,
  assertSampleAccountingBalanced,
  subjectFromExperiment,
  subjectFromStrategy,
  type RobustnessSampleAccounting,
} from "../../../../server/research/robustness/dimension";
import {
  applyDriftThresholds,
  computeRobustnessDrift,
  resolveRobustnessThresholds,
  robustnessComparisonSpecsFromThresholds,
} from "../../../../server/research/robustness/drift";
import {
  MULTI_DIMENSION_RUN_RECORD_KIND,
  MULTI_DIMENSION_RUN_RECORD_VERSION,
  computeMultiDimensionRunFingerprint,
  deserializeMultiDimensionRobustnessRun,
  runMultiDimensionRobustness,
  serializeMultiDimensionRobustnessRun,
  validateMultiDimensionRobustnessRun,
  type MultiDimensionRobustnessRequest,
  type MultiDimensionSampleOutcome,
} from "../../../../server/research/robustness/multiDimension";
import type { RobustnessMetricsView } from "../../../../server/research/robustness/types";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const DIMENSIONS = [
  { id: "observationDay", label: "观察日", valueUnit: "相对日 T+k" },
  { id: "sampleCondition", label: "样本条件" },
] as const;

const METRIC_NAMES = ["sampleCount", "validSampleCount", "meanCloseReturn", "medianCloseReturn"] as const;

const COMPARISONS: readonly MetricComparisonSpec[] = [
  { metric: "meanCloseReturn", label: "平均收益", unit: "比例", tolerance: 0.02, direction: "both" },
  { metric: "medianCloseReturn", label: "中位收益", unit: "比例", tolerance: 0.02, direction: "both" },
];

function accounting(input: {
  candidate: number;
  valid: number;
  excluded?: number;
  missing?: number;
  invalid?: number;
  reason?: string;
}): RobustnessSampleAccounting {
  const excluded = input.excluded ?? 0;
  const missing = input.missing ?? 0;
  const invalid = input.invalid ?? 0;
  return {
    candidateCount: input.candidate,
    eligibleCount: input.valid + excluded,
    validCount: input.valid,
    excludedCount: excluded,
    missingCount: missing,
    invalidCount: invalid,
    excludedByReason: excluded > 0 ? { [input.reason ?? "SAMPLE_CONDITION_NOT_MET"]: excluded } : {},
    accountingFormula: ROBUSTNESS_SAMPLE_ACCOUNTING_FORMULA,
  };
}

/** 基准 + 3 个变体：2 个维度各 1 个 + 1 个与基准同配置（自检行）。 */
function baselineAndVariants(): MultiDimensionRobustnessRequest["variants"] {
  return [
    { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: { k: 5, h: 10 } },
    { dimensionId: "observationDay", code: "K3", label: "k=3", isBaseline: false, config: { k: 3, h: 10 } },
    { dimensionId: "sampleCondition", code: "COND", label: "子集", isBaseline: false, config: { k: 5, h: 10, c: "X" } },
    { dimensionId: "observationDay", code: "SELF", label: "同配置自检", isBaseline: false, config: { k: 5, h: 10 } },
  ];
}

/** 由「变体 code → 指标」的映射构造 evaluator（模拟调用方注入的重算闭包）。 */
function evaluatorOf(
  table: Readonly<Record<string, { mean: number; median: number; valid: number; candidate?: number }>>,
  seen: string[] = []
): (item: { code: string }) => MultiDimensionSampleOutcome {
  return (item) => {
    seen.push(item.code);
    const row = table[item.code];
    if (row === undefined) return { status: "failed", error: `没有为 "${item.code}" 准备评估产物` };
    // 账必须自平：candidate = valid + excluded + missing + invalid；缺省即「无剔除」。
    const candidate = row.candidate ?? row.valid;
    return {
      status: "succeeded",
      metrics: {
        metrics: {
          sampleCount: candidate,
          validSampleCount: row.valid,
          meanCloseReturn: row.mean,
          medianCloseReturn: row.median,
        },
        unavailable: {},
      },
      sampleAccounting: accounting({ candidate, valid: row.valid }),
    };
  };
}

function makeRun(overrides: Partial<MultiDimensionRobustnessRequest> = {}) {
  const seen: string[] = [];
  return {
    seen,
    run: runMultiDimensionRobustness({
      subject: subjectFromExperiment({
        experimentCode: "first-board-pullback/stability-validation",
        experimentVersion: "1.0.0",
      }),
      runId: "RBM-TEST",
      dimensions: [...DIMENSIONS],
      metricNames: [...METRIC_NAMES],
      comparisons: COMPARISONS,
      variants: baselineAndVariants(),
      evaluator: evaluatorOf(
        {
          BASE: { mean: 0.05, median: 0.02, valid: 80 },
          K3: { mean: 0.05, median: 0.02, valid: 80 },
          COND: { mean: 0.11, median: 0.09, valid: 40 },
          SELF: { mean: 0.05, median: 0.02, valid: 80 },
        },
        seen
      ),
      ...overrides,
    }),
  };
}

async function expectCode(fn: () => unknown, code: string): Promise<void> {
  try {
    fn();
    throw new Error(`期望抛出 ${code}，但没有抛出`);
  } catch (error) {
    expect(error).toBeInstanceOf(ResearchValidationError);
    const issues = (error as ResearchValidationError).issues as Array<{ code: string }>;
    expect(issues.map((issue) => issue.code)).toContain(code);
  }
}

// ---------------------------------------------------------------------------
// 1. baseline 校验
// ---------------------------------------------------------------------------

describe("公共机制 · 1. baseline 校验（baseline-first）", () => {
  it("索引 0 必须是基准条目，否则拒", async () => {
    const variants = baselineAndVariants();
    const swapped = [variants[1]!, variants[0]!, variants[2]!, variants[3]!];
    await expectCode(() => makeRun({ variants: swapped }).run, "RB18X_BASELINE_NOT_FIRST");
  });

  it("基准条目多于 / 少于一条都拒", async () => {
    await expectCode(
      () =>
        makeRun({
          variants: [
            { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: { k: 5 } },
            { dimensionId: null, code: "BASE2", label: "第二个基准", isBaseline: true, config: { k: 6 } },
          ],
        }).run,
      "RB18X_BASELINE_COUNT_INVALID"
    );
  });

  it("基准条目的 dimensionId 必须为 null（基准是共享锚点，不属于任何维度）", async () => {
    await expectCode(
      () =>
        makeRun({
          variants: [
            {
              dimensionId: "observationDay",
              code: "BASE",
              label: "基准",
              isBaseline: true,
              config: { k: 5 },
            },
            { dimensionId: "observationDay", code: "K3", label: "k=3", isBaseline: false, config: { k: 3 } },
          ],
        }).run,
      "RB18X_BASELINE_DIMENSION_INVALID"
    );
  });

  it("基准成功时结果里 baseline 单列，且 verdict = baseline、comparisons 为空", () => {
    const { run } = makeRun();
    expect(run.baseline.verdict).toBe("baseline");
    expect(run.baseline.dimensionId).toBeNull();
    expect(run.baseline.comparisons).toEqual([]);
    // 非基准变体**不**出现在 baseline 里
    expect(run.variants.map((item) => item.item.code)).not.toContain("BASE");
  });
});

// ---------------------------------------------------------------------------
// 2. variant 校验
// ---------------------------------------------------------------------------

describe("公共机制 · 2. variant 校验", () => {
  const base = { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} } as const;

  it("变体的 dimensionId 必须 ∈ 维度声明表", async () => {
    await expectCode(
      () =>
        makeRun({
          variants: [base, { dimensionId: "noSuchDim", code: "V", label: "V", isBaseline: false, config: {} }],
        }).run,
      "RB18X_VARIANT_DIMENSION_UNKNOWN"
    );
  });

  it("变体 code 重复 ⇒ 拒", async () => {
    await expectCode(
      () =>
        makeRun({
          variants: [
            base,
            { dimensionId: "observationDay", code: "V", label: "V", isBaseline: false, config: {} },
            { dimensionId: "observationDay", code: "V", label: "V2", isBaseline: false, config: {} },
          ],
        }).run,
      "RB18X_VARIANT_CODE_DUPLICATE"
    );
  });

  it("code / label 为空串 ⇒ 拒", async () => {
    await expectCode(
      () =>
        makeRun({
          variants: [base, { dimensionId: "observationDay", code: "", label: "V", isBaseline: false, config: {} }],
        }).run,
      "RB18X_VARIANT_FIELD_EMPTY"
    );
  });

  it("config 不可 JSON 序列化（函数 / NaN / undefined 叶子）⇒ 拒（不静默丢配置）", async () => {
    await expectCode(
      () =>
        makeRun({
          variants: [
            base,
            {
              dimensionId: "observationDay",
              code: "V",
              label: "V",
              isBaseline: false,
              config: { bad: Number.NaN },
            },
          ],
        }).run,
      "RB18X_VARIANT_CONFIG_NON_FINITE"
    );
    await expectCode(
      () =>
        makeRun({
          variants: [
            base,
            {
              dimensionId: "observationDay",
              code: "V",
              label: "V",
              isBaseline: false,
              config: { fn: (() => 1) as unknown },
            },
          ],
        }).run,
      "RB18X_VARIANT_CONFIG_TYPE_INVALID"
    );
  });

  it("维度声明表为空 / 维度 id 重复 ⇒ 拒", async () => {
    await expectCode(() => makeRun({ dimensions: [] }).run, "RB18X_DIMENSIONS_EMPTY");
    await expectCode(
      () =>
        makeRun({
          dimensions: [
            { id: "d", label: "D1" },
            { id: "d", label: "D2" },
          ],
        }).run,
      "RB18X_DIMENSION_ID_DUPLICATE"
    );
  });
});

// ---------------------------------------------------------------------------
// 3. evaluator 注入（核心零 IO / 零重算）
// ---------------------------------------------------------------------------

describe("公共机制 · 3. evaluator 注入（核心不重算）", () => {
  it("每个变体（含基准）恰好被评估一次，且按声明顺序", () => {
    const { run, seen } = makeRun();
    expect(seen).toEqual(["BASE", "K3", "COND", "SELF"]);
    expect(run.variants).toHaveLength(3);
  });

  it("核心只透传 evaluator 给的指标，不做任何换算 / 再计算", () => {
    const { run } = makeRun();
    const cond = run.variants.find((item) => item.item.code === "COND")!;
    expect(cond.metrics?.metrics.meanCloseReturn).toBe(0.11);
    expect(cond.metrics?.metrics.medianCloseReturn).toBe(0.09);
    expect(cond.sampleAccounting?.validCount).toBe(40);
  });

  it("同配置的自检变体 delta 恰为 0（核心不引入任何额外状态）", () => {
    const { run } = makeRun();
    const self = run.variants.find((item) => item.item.code === "SELF")!;
    expect(self.verdict).toBe("stable");
    for (const comparison of self.comparisons) expect(comparison.delta).toBe(0);
  });

  it("evaluator 不是函数 ⇒ 拒", async () => {
    await expectCode(
      () => makeRun({ evaluator: undefined as unknown as (item: never) => never }).run,
      "RB18X_REQUEST_EVALUATOR_INVALID"
    );
  });
});

// ---------------------------------------------------------------------------
// 4. metric extensibility
// ---------------------------------------------------------------------------

describe("公共机制 · 4. 指标可扩展（词表任意声明）", () => {
  it("词表里可以有任意命名的指标（研究侧自造统计量）", () => {
    const run = runMultiDimensionRobustness({
      subject: subjectFromExperiment({ experimentCode: "g/e", experimentVersion: "1.0.0" }),
      runId: "RBM-EXT",
      dimensions: [...DIMENSIONS],
      metricNames: ["breakoutVsCloseRate", "dd.below-1000bp.count", "medianCloseReturn"],
      comparisons: [
        { metric: "breakoutVsCloseRate", tolerance: 0.05, direction: "both" },
        { metric: "dd.below-1000bp.count", tolerance: 3, direction: "increase" },
      ],
      variants: [
        { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} },
        { dimensionId: "sampleCondition", code: "V", label: "V", isBaseline: false, config: { c: "X" } },
      ],
      evaluator: (item) => ({
        status: "succeeded",
        metrics: {
          metrics: {
            breakoutVsCloseRate: item.code === "BASE" ? 0.34 : 0.35,
            "dd.below-1000bp.count": item.code === "BASE" ? 10 : 18,
            medianCloseReturn: 0.02,
          },
          unavailable: {},
        },
        sampleAccounting: accounting({ candidate: 10, valid: 10 }),
      }),
    });
    const variant = run.variants[0]!;
    expect(variant.verdict).toBe("sensitive"); // 0.35-0.34=0.01 ≤ 0.05 稳，但 18-10=8 > 3 敏感
    expect(variant.comparisons.find((c) => c.metric === "dd.below-1000bp.count")?.verdict).toBe("sensitive");
    expect(variant.comparisons.find((c) => c.metric === "breakoutVsCloseRate")?.verdict).toBe("stable");
  });

  it("快照里出现词表外的指标 ⇒ 该变体 failed（结构化，不静默接受）", () => {
    const run = runMultiDimensionRobustness({
      subject: subjectFromExperiment({ experimentCode: "g/e", experimentVersion: "1.0.0" }),
      runId: "RBM-EXT2",
      dimensions: [...DIMENSIONS],
      metricNames: ["meanCloseReturn", "medianCloseReturn"],
      comparisons: [{ metric: "meanCloseReturn", tolerance: 0.02, direction: "both" }],
      variants: [
        { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} },
        { dimensionId: "sampleCondition", code: "V", label: "V", isBaseline: false, config: {} },
      ],
      evaluator: (item) => ({
        status: "succeeded",
        metrics: {
          metrics:
            item.code === "BASE"
              ? { meanCloseReturn: 0.01, medianCloseReturn: 0.01 }
              : { meanCloseReturn: 0.01, medianCloseReturn: 0.01, notDeclared: 1 },
          unavailable: {},
        },
        sampleAccounting: accounting({ candidate: 10, valid: 10 }),
      }),
    });
    const variant = run.variants[0]!;
    expect(variant.status).toBe("failed");
    expect(variant.error).toContain("RB18X_METRIC_NOT_DECLARED");
    expect(variant.verdict).toBe("failed");
  });

  it("指标值为 NaN / Infinity ⇒ failed（不得用非有限值充当结论）", () => {
    const run = runMultiDimensionRobustness({
      subject: subjectFromExperiment({ experimentCode: "g/e", experimentVersion: "1.0.0" }),
      runId: "RBM-NAN",
      dimensions: [...DIMENSIONS],
      metricNames: ["meanCloseReturn", "medianCloseReturn"],
      comparisons: [{ metric: "meanCloseReturn", tolerance: 0.02, direction: "both" }],
      variants: [
        { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} },
        { dimensionId: "sampleCondition", code: "V", label: "V", isBaseline: false, config: {} },
      ],
      evaluator: (item) => ({
        status: "succeeded",
        metrics: {
          metrics:
            item.code === "BASE"
              ? { meanCloseReturn: 0.01, medianCloseReturn: 0.01 }
              : { meanCloseReturn: Number.NaN, medianCloseReturn: 0.01 },
          unavailable: {},
        },
        sampleAccounting: accounting({ candidate: 10, valid: 10 }),
      }),
    });
    const variant = run.variants[0]!;
    expect(variant.status).toBe("failed");
    expect(variant.error).toContain("RB18X_METRIC_NON_FINITE");
  });

  it("词表里声明的指标既没值也没原因 ⇒ failed（不允许静默少一个指标）", () => {
    const run = runMultiDimensionRobustness({
      subject: subjectFromExperiment({ experimentCode: "g/e", experimentVersion: "1.0.0" }),
      runId: "RBM-MISS",
      dimensions: [...DIMENSIONS],
      metricNames: ["meanCloseReturn", "medianCloseReturn"],
      comparisons: [{ metric: "meanCloseReturn", tolerance: 0.02, direction: "both" }],
      variants: [
        { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} },
        { dimensionId: "sampleCondition", code: "V", label: "V", isBaseline: false, config: {} },
      ],
      evaluator: (item) => ({
        status: "succeeded",
        metrics: {
          metrics:
            item.code === "BASE"
              ? { meanCloseReturn: 0.01, medianCloseReturn: 0.01 }
              : { meanCloseReturn: 0.01 },
          unavailable: {},
        },
        sampleAccounting: accounting({ candidate: 10, valid: 10 }),
      }),
    });
    expect(run.variants[0]!.status).toBe("failed");
    expect(run.variants[0]!.error).toContain("RB18X_METRIC_MISSING");
  });

  it("「指标不可用」走 unavailable + 非空原因（**不是** 0）", () => {
    const run = runMultiDimensionRobustness({
      subject: subjectFromExperiment({ experimentCode: "g/e", experimentVersion: "1.0.0" }),
      runId: "RBM-UNAV",
      dimensions: [...DIMENSIONS],
      metricNames: ["meanCloseReturn", "medianCloseReturn"],
      comparisons: [{ metric: "meanCloseReturn", tolerance: 0.02, direction: "both" }],
      variants: [
        { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} },
        { dimensionId: "sampleCondition", code: "V", label: "V", isBaseline: false, config: {} },
      ],
      evaluator: (item) =>
        item.code === "BASE"
          ? {
              status: "succeeded",
              metrics: { metrics: { meanCloseReturn: 0.01, medianCloseReturn: 0.01 }, unavailable: {} },
              sampleAccounting: accounting({ candidate: 10, valid: 10 }),
            }
          : {
              status: "succeeded",
              metrics: {
                metrics: { medianCloseReturn: 0.01 },
                unavailable: { meanCloseReturn: "该变体的未来评价窗口为空（h ≤ k），按定义不存在后续表现" },
              },
              sampleAccounting: accounting({ candidate: 10, valid: 10 }),
            },
    });
    const variant = run.variants[0]!;
    expect(variant.status).toBe("succeeded");
    const comparison = variant.comparisons.find((c) => c.metric === "meanCloseReturn")!;
    expect(comparison.verdict).toBe("insufficient");
    expect(comparison.variantValue).toBeNull();
    expect(comparison.delta).toBeNull();
    expect(comparison.reason).toContain("变体侧不可用");
    expect(variant.verdict).toBe("insufficient");
  });

  it("不可用原因缺省（空串）⇒ failed", () => {
    const run = runMultiDimensionRobustness({
      subject: subjectFromExperiment({ experimentCode: "g/e", experimentVersion: "1.0.0" }),
      runId: "RBM-UNAV2",
      dimensions: [...DIMENSIONS],
      metricNames: ["meanCloseReturn", "medianCloseReturn"],
      comparisons: [{ metric: "meanCloseReturn", tolerance: 0.02, direction: "both" }],
      variants: [
        { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} },
        { dimensionId: "sampleCondition", code: "V", label: "V", isBaseline: false, config: {} },
      ],
      evaluator: (item) => ({
        status: "succeeded",
        metrics: {
          metrics: item.code === "BASE" ? { meanCloseReturn: 0.01, medianCloseReturn: 0.01 } : { medianCloseReturn: 0.01 },
          unavailable: item.code === "BASE" ? {} : { meanCloseReturn: "  " },
        },
        sampleAccounting: accounting({ candidate: 10, valid: 10 }),
      }),
    });
    expect(run.variants[0]!.status).toBe("failed");
    expect(run.variants[0]!.error).toContain("RB18X_METRIC_UNAVAILABLE_REASON_MISSING");
  });
});

// ---------------------------------------------------------------------------
// 5. comparison
// ---------------------------------------------------------------------------

describe("公共机制 · 5. 比较（声明式）", () => {
  it("比较声明的 metric 必须 ∈ 词表；重复 / 空 / 非法方向一律拒", async () => {
    await expectCode(() => resolveComparisonSpecs([{ metric: "nope", tolerance: 1, direction: "both" }], ["a"]), "RB18X_COMPARISON_METRIC_NOT_DECLARED");
    await expectCode(
      () =>
        resolveComparisonSpecs(
          [
            { metric: "a", tolerance: 1, direction: "both" },
            { metric: "a", tolerance: 2, direction: "both" },
          ],
          ["a"]
        ),
      "RB18X_COMPARISON_METRIC_DUPLICATE"
    );
    await expectCode(() => resolveComparisonSpecs([{ metric: "", tolerance: 1, direction: "both" }], ["a"]), "RB18X_COMPARISON_METRIC_EMPTY");
    await expectCode(
      () => resolveComparisonSpecs([{ metric: "a", tolerance: 1, direction: "sideways" as never }], ["a"]),
      "RB18X_COMPARISON_DIRECTION_INVALID"
    );
    await expectCode(() => resolveComparisonSpecs([], ["a"]), "RB18X_COMPARISON_SPECS_EMPTY");
  });

  it("delta = 变体 − 基准；逐行带样本集合上下文；sampleSetChanged 在有效样本数不同时为 true", () => {
    const { run } = makeRun();
    const cond = run.variants.find((item) => item.item.code === "COND")!;
    const comparison = cond.comparisons.find((c) => c.metric === "meanCloseReturn")!;
    expect(comparison.baselineValue).toBe(0.05);
    expect(comparison.variantValue).toBe(0.11);
    expect(comparison.delta).toBeCloseTo(0.06, 12);
    expect(comparison.absoluteDelta).toBeCloseTo(0.06, 12);
    expect(comparison.baselineSampleCount).toBe(80);
    expect(comparison.variantSampleCount).toBe(40);
    expect(comparison.sampleSetChanged).toBe(true);
  });

  it("单元判定优先级：sensitive > insufficient > stable；anyFailed ⇒ failed", () => {
    const stable = { verdict: "stable" } as never;
    const insufficient = { verdict: "insufficient" } as never;
    const sensitive = { verdict: "sensitive" } as never;
    expect(summarizeUnitVerdict({ anyFailed: false, comparisons: [stable, insufficient] })).toBe("insufficient");
    expect(summarizeUnitVerdict({ anyFailed: false, comparisons: [insufficient, sensitive] })).toBe("sensitive");
    expect(summarizeUnitVerdict({ anyFailed: false, comparisons: [stable] })).toBe("stable");
    expect(summarizeUnitVerdict({ anyFailed: false, comparisons: [] })).toBe("insufficient");
    expect(summarizeUnitVerdict({ anyFailed: true, comparisons: [sensitive] })).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// 6. tolerance
// ---------------------------------------------------------------------------

describe("公共机制 · 6. 容差判定（**唯一实现**）", () => {
  it("严格大于：等于容差算「在容差内」", () => {
    expect(evaluateTolerance(0.02, 0.02, "both")).toBe(false);
    expect(evaluateTolerance(0.0200001, 0.02, "both")).toBe(true);
    expect(evaluateTolerance(-0.02, 0.02, "both")).toBe(false);
    expect(evaluateTolerance(-0.0200001, 0.02, "both")).toBe(true);
  });

  it("三个方向语义：both / increase / decrease（不猜、不倒推）", () => {
    expect(evaluateTolerance(-0.5, 0.1, "both")).toBe(true);
    expect(evaluateTolerance(-0.5, 0.1, "increase")).toBe(false);
    expect(evaluateTolerance(-0.5, 0.1, "decrease")).toBe(true);
    expect(evaluateTolerance(0.5, 0.1, "increase")).toBe(true);
    expect(evaluateTolerance(0.5, 0.1, "decrease")).toBe(false);
    // 容差为 0 ⇒ 任何非零变化都算敏感
    expect(evaluateTolerance(0.0000001, 0, "both")).toBe(true);
    expect(evaluateTolerance(0, 0, "both")).toBe(false);
  });

  it("非法容差 / 非法 delta / 未知方向 ⇒ 结构化抛错", async () => {
    await expectCode(() => evaluateTolerance(1, -1, "both"), "RB18X_TOLERANCE_INVALID");
    await expectCode(() => evaluateTolerance(1, Number.NaN, "both"), "RB18X_TOLERANCE_INVALID");
    await expectCode(() => evaluateTolerance(Number.NaN, 1, "both"), "RB18X_DELTA_NON_FINITE");
    await expectCode(() => evaluateTolerance(1, 1, "up" as never), "RB18X_COMPARISON_DIRECTION_UNKNOWN");
  });

  it("三个方向常量齐备（界面与声明共用同一份）", () => {
    expect([...COMPARISON_DIRECTIONS]).toEqual(["both", "increase", "decrease"]);
  });

  it("🔴 §18 P1-3 判据：C-18.1 的两个固定阈值能被「声明式比较」**无语义损失**替代", () => {
    const thresholds = resolveRobustnessThresholds({});
    const specs = robustnessComparisonSpecsFromThresholds(thresholds);
    // 投影出的两个方向与 C-18.1 的历史语义逐字一致
    expect(specs.map((spec) => [spec.metric, spec.tolerance, spec.direction])).toEqual([
      ["totalReturnPct", thresholds.returnDriftThresholdPct, "both"],
      ["maxDrawdownPct", thresholds.drawdownWorseningThresholdPct, "increase"],
    ]);

    // 对一批边界值，两条路径（`applyDriftThresholds` vs 声明式 `evaluateTolerance`）必须**同判**
    const baseline = { totalReturnPct: 10, maxDrawdownPct: 20, tradeCount: 5 } as RobustnessMetricsView;
    const cases: Array<{ totalReturnPct: number; maxDrawdownPct: number }> = [
      { totalReturnPct: 10, maxDrawdownPct: 20 },
      { totalReturnPct: 10 + thresholds.returnDriftThresholdPct, maxDrawdownPct: 20 },
      { totalReturnPct: 10 + thresholds.returnDriftThresholdPct + 0.000001, maxDrawdownPct: 20 },
      { totalReturnPct: 10 - thresholds.returnDriftThresholdPct - 0.000001, maxDrawdownPct: 20 },
      { totalReturnPct: 10, maxDrawdownPct: 20 + thresholds.drawdownWorseningThresholdPct },
      { totalReturnPct: 10, maxDrawdownPct: 20 + thresholds.drawdownWorseningThresholdPct + 0.000001 },
      { totalReturnPct: 10, maxDrawdownPct: 20 - 5 },
    ];
    for (const item of cases) {
      const variant = { ...item, tradeCount: 5 } as RobustnessMetricsView;
      // 历史路径：两参位置签名（`baselineMetrics, perturbedMetrics`），返回 flag 数组
      const drift = computeRobustnessDrift(baseline, variant);
      const legacy = applyDriftThresholds(drift, thresholds);
      const legacyReturn = legacy.includes("RETURN_DRIFT");
      const legacyDrawdown = legacy.includes("DRAWDOWN_WORSENING");
      // 泛化路径：声明式「指标 + 容差 + 方向」三元组
      const viaSpecs = specs.map((spec) => {
        const delta =
          spec.metric === "totalReturnPct"
            ? variant.totalReturnPct - baseline.totalReturnPct
            : variant.maxDrawdownPct - baseline.maxDrawdownPct;
        return evaluateTolerance(delta, spec.tolerance, spec.direction);
      });
      expect(viaSpecs[0]).toBe(legacyReturn);
      expect(viaSpecs[1]).toBe(legacyDrawdown);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. failed variant
// ---------------------------------------------------------------------------

describe("公共机制 · 7. 失败样本结构化（不静默吞）", () => {
  it("评估器抛错 ⇒ 该变体 failed，且错误文案带原因；其余变体不受影响", () => {
    const { run } = makeRun({
      evaluator: (item) => {
        if (item.code === "COND") throw new Error("数据集读取炸了");
        return evaluatorOf({ K3: { mean: 0.05, median: 0.02, valid: 80 }, SELF: { mean: 0.05, median: 0.02, valid: 80 }, BASE: { mean: 0.05, median: 0.02, valid: 80 } })(item);
      },
    });
    const cond = run.variants.find((item) => item.item.code === "COND")!;
    expect(cond.status).toBe("failed");
    expect(cond.error).toContain("数据集读取炸了");
    expect(cond.metrics).toBeNull();
    expect(cond.comparisons).toEqual([]);
    expect(cond.verdict).toBe("failed");
    // 其余变体照常
    expect(run.variants.find((item) => item.item.code === "K3")!.status).toBe("succeeded");
    expect(run.counts.failedCount).toBe(1);
    expect(run.variants.find((item) => item.item.code === "K3")!.verdict).toBe("stable");
  });

  it("评估器返回 failed 但错误为空 ⇒ 仍给结构化文案（不产生空错误）", () => {
    // 基准必须成功（否则整条 Run 抛 RB18X_BASELINE_FAILED），只让 COND 返回空白错误。
    const base = evaluatorOf({
      BASE: { mean: 0.05, median: 0.02, valid: 80 },
      K3: { mean: 0.05, median: 0.02, valid: 80 },
      COND: { mean: 0.11, median: 0.09, valid: 40 },
      SELF: { mean: 0.05, median: 0.02, valid: 80 },
    });
    const { run } = makeRun({
      evaluator: (item) => (item.code === "COND" ? { status: "failed", error: "   " } : base(item)),
    });
    const cond = run.variants.find((item) => item.item.code === "COND")!;
    expect(cond.status).toBe("failed");
    expect(cond.error).toBe("评估器返回空错误");
    expect(cond.error).not.toBe("");
    expect(cond.error?.trim()).not.toBe("");
  });

  it("评估器返回非法产物（非对象 / status 非法）⇒ failed", () => {
    const { run } = makeRun({
      evaluator: (item) =>
        item.code === "COND"
          ? ({ status: "maybe" } as never)
          : ({
              status: "succeeded",
              metrics: { metrics: { sampleCount: 1, validSampleCount: 1, meanCloseReturn: 0.01, medianCloseReturn: 0.01 }, unavailable: {} },
              sampleAccounting: accounting({ candidate: 1, valid: 1 }),
            } as never),
    });
    expect(run.variants.find((item) => item.item.code === "COND")!.status).toBe("failed");
    expect(run.variants.find((item) => item.item.code === "COND")!.error).toContain("非法产物");
  });
});

// ---------------------------------------------------------------------------
// 8. baseline failure
// ---------------------------------------------------------------------------

describe("公共机制 · 8. 基准失败 ⇒ 拒绝产出无锚点结论", () => {
  it("基准评估失败 ⇒ RB18X_BASELINE_FAILED（不返回任何记录）", async () => {
    await expectCode(
      () =>
        makeRun({
          evaluator: (item) =>
            item.isBaseline
              ? { status: "failed", error: "基准样本全被剔除" }
              : {
                  status: "succeeded",
                  metrics: { metrics: { sampleCount: 1, validSampleCount: 1, meanCloseReturn: 0.01, medianCloseReturn: 0.01 }, unavailable: {} },
                  sampleAccounting: accounting({ candidate: 1, valid: 1 }),
                },
        }).run,
      "RB18X_BASELINE_FAILED"
    );
  });

  it("基准抛错同理 ⇒ RB18X_BASELINE_FAILED", async () => {
    await expectCode(
      () =>
        makeRun({
          evaluator: (item) => {
            if (item.isBaseline) throw new Error("基准炸了");
            return {
              status: "succeeded",
              metrics: { metrics: { sampleCount: 1, validSampleCount: 1, meanCloseReturn: 0.01, medianCloseReturn: 0.01 }, unavailable: {} },
              sampleAccounting: accounting({ candidate: 1, valid: 1 }),
            };
          },
        }).run,
      "RB18X_BASELINE_FAILED"
    );
  });
});

// ---------------------------------------------------------------------------
// 9. sample accounting
// ---------------------------------------------------------------------------

describe("公共机制 · 9. 样本账守恒（§13）", () => {
  it("直接校验：两式都平才通过；不平则结构化抛错", () => {
    expect(() => assertSampleAccountingBalanced(accounting({ candidate: 100, valid: 70, excluded: 20, missing: 5, invalid: 5 }), "a")).not.toThrow();
    expect(() =>
      assertSampleAccountingBalanced(
        { ...accounting({ candidate: 100, valid: 70, excluded: 20, missing: 5, invalid: 5 }), eligibleCount: 95 },
        "a"
      )
    ).toThrow(ResearchValidationError);
  });

  it("评估产物样本账不平 ⇒ 该变体 failed（结构化原因，不静默接受）", () => {
    const broken: RobustnessSampleAccounting = {
      candidateCount: 100,
      eligibleCount: 90,
      validCount: 90,
      excludedCount: 0,
      missingCount: 0,
      invalidCount: 0, // 90 + 0 + 0 ≠ 100 ⇒ 资格层不平
      excludedByReason: {},
      accountingFormula: ROBUSTNESS_SAMPLE_ACCOUNTING_FORMULA,
    };
    const run = runMultiDimensionRobustness({
      subject: subjectFromExperiment({ experimentCode: "g/e", experimentVersion: "1.0.0" }),
      runId: "RBM-ACC",
      dimensions: [...DIMENSIONS],
      metricNames: ["meanCloseReturn", "medianCloseReturn"],
      comparisons: [{ metric: "meanCloseReturn", tolerance: 0.02, direction: "both" }],
      variants: [
        { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} },
        { dimensionId: "sampleCondition", code: "V", label: "V", isBaseline: false, config: {} },
      ],
      evaluator: (item) => ({
        status: "succeeded",
        metrics: { metrics: { meanCloseReturn: 0.01, medianCloseReturn: 0.01 }, unavailable: {} },
        sampleAccounting: item.code === "BASE" ? accounting({ candidate: 10, valid: 10 }) : broken,
      }),
    });
    expect(run.variants[0]!.status).toBe("failed");
    expect(run.variants[0]!.error).toContain("RB18X_SAMPLE_ACCOUNTING_ELIGIBILITY_IMBALANCE");
  });

  it("剔除原因合计 ≠ excludedCount ⇒ 也 failed（「为什么样本变少」不许丢）", () => {
    const bad = { ...accounting({ candidate: 10, valid: 7, excluded: 3 }), excludedByReason: { A: 1 } };
    const run = runMultiDimensionRobustness({
      subject: subjectFromExperiment({ experimentCode: "g/e", experimentVersion: "1.0.0" }),
      runId: "RBM-ACC2",
      dimensions: [...DIMENSIONS],
      metricNames: ["meanCloseReturn", "medianCloseReturn"],
      comparisons: [{ metric: "meanCloseReturn", tolerance: 0.02, direction: "both" }],
      variants: [
        { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} },
        { dimensionId: "sampleCondition", code: "V", label: "V", isBaseline: false, config: {} },
      ],
      evaluator: (item) => ({
        status: "succeeded",
        metrics: { metrics: { meanCloseReturn: 0.01, medianCloseReturn: 0.01 }, unavailable: {} },
        sampleAccounting: item.code === "BASE" ? accounting({ candidate: 10, valid: 10 }) : bad,
      }),
    });
    expect(run.variants[0]!.error).toContain("RB18X_SAMPLE_ACCOUNTING_REASON_SUM_MISMATCH");
  });

  it("缺样本账（null）⇒ failed（每个变体必须给出账目）", () => {
    const run = runMultiDimensionRobustness({
      subject: subjectFromExperiment({ experimentCode: "g/e", experimentVersion: "1.0.0" }),
      runId: "RBM-ACC3",
      dimensions: [...DIMENSIONS],
      metricNames: ["meanCloseReturn", "medianCloseReturn"],
      comparisons: [{ metric: "meanCloseReturn", tolerance: 0.02, direction: "both" }],
      variants: [
        { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} },
        { dimensionId: "sampleCondition", code: "V", label: "V", isBaseline: false, config: {} },
      ],
      evaluator: (item) =>
        item.code === "BASE"
          ? {
              status: "succeeded",
              metrics: { metrics: { meanCloseReturn: 0.01, medianCloseReturn: 0.01 }, unavailable: {} },
              sampleAccounting: accounting({ candidate: 10, valid: 10 }),
            }
          : ({
              status: "succeeded",
              metrics: { metrics: { meanCloseReturn: 0.01, medianCloseReturn: 0.01 }, unavailable: {} },
              sampleAccounting: null,
            } as never),
    });
    expect(run.variants[0]!.status).toBe("failed");
    expect(run.variants[0]!.error).toContain("规格 §13");
  });
});

// ---------------------------------------------------------------------------
// 10. 多维矩阵
// ---------------------------------------------------------------------------

describe("公共机制 · 10. 多维矩阵（一个 Run 一个基准）", () => {
  it("维度结论归因正确，计数自洽（stable+sensitive+insufficient+failed = variantCount）", () => {
    const { run } = makeRun();
    expect(run.dimensions.map((dimension) => dimension.id)).toEqual(["observationDay", "sampleCondition"]);
    const byDim = new Map(run.dimensionConclusions.map((item) => [item.dimensionId, item]));
    expect(byDim.get("observationDay")!.variantCount).toBe(2); // K3 + SELF
    expect(byDim.get("sampleCondition")!.variantCount).toBe(1); // COND
    expect(byDim.get("sampleCondition")!.sensitiveCount).toBe(1);
    expect(byDim.get("sampleCondition")!.sensitiveEntries.map((entry) => entry.code)).toEqual(["COND"]);
    const { stableCount, sensitiveCount, insufficientCount, failedCount, variantCount } = run.counts;
    expect(stableCount + sensitiveCount + insufficientCount + failedCount).toBe(variantCount);
    expect(run.recordKind).toBe(MULTI_DIMENSION_RUN_RECORD_KIND);
    expect(run.recordVersion).toBe(MULTI_DIMENSION_RUN_RECORD_VERSION);
  });

  it("总判定优先级：sensitive > insufficient > failed > stable", () => {
    const { run } = makeRun();
    expect(run.overallVerdict).toBe("sensitive");

    const insufficientOnly = runMultiDimensionRobustness({
      subject: subjectFromExperiment({ experimentCode: "g/e", experimentVersion: "1.0.0" }),
      runId: "RBM-INS",
      dimensions: [...DIMENSIONS],
      metricNames: ["meanCloseReturn", "medianCloseReturn"],
      comparisons: [{ metric: "meanCloseReturn", tolerance: 0.02, direction: "both" }],
      variants: [
        { dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} },
        { dimensionId: "sampleCondition", code: "V", label: "V", isBaseline: false, config: {} },
      ],
      evaluator: (item) => ({
        status: "succeeded",
        metrics:
          item.code === "BASE"
            ? { metrics: { meanCloseReturn: 0.01, medianCloseReturn: 0.01 }, unavailable: {} }
            : { metrics: { medianCloseReturn: 0.01 }, unavailable: { meanCloseReturn: "窗口按定义为空" } },
        sampleAccounting: accounting({ candidate: 10, valid: 10 }),
      }),
    });
    expect(insufficientOnly.overallVerdict).toBe("insufficient");
  });

  it("维度没有变体 ⇒ verdict = no-variants（不是 stable）", () => {
    const run = runMultiDimensionRobustness({
      subject: subjectFromExperiment({ experimentCode: "g/e", experimentVersion: "1.0.0" }),
      runId: "RBM-NOV",
      dimensions: [...DIMENSIONS],
      metricNames: ["meanCloseReturn", "medianCloseReturn"],
      comparisons: [{ metric: "meanCloseReturn", tolerance: 0.02, direction: "both" }],
      variants: [{ dimensionId: null, code: "BASE", label: "基准", isBaseline: true, config: {} }],
      evaluator: () => ({
        status: "succeeded",
        metrics: { metrics: { meanCloseReturn: 0.01, medianCloseReturn: 0.01 }, unavailable: {} },
        sampleAccounting: accounting({ candidate: 10, valid: 10 }),
      }),
    });
    expect(run.counts.variantCount).toBe(0);
    expect(run.overallVerdict).toBe("no-variants");
    for (const conclusion of run.dimensionConclusions) expect(conclusion.verdict).toBe("no-variants");
  });

  it("subject 身份：实验语境允许 subjectRunId=null；策略语境必须为 null", () => {
    const { run } = makeRun();
    expect(run.subject).toEqual({
      subjectKind: "experiment",
      subjectId: "first-board-pullback/stability-validation",
      subjectVersion: "1.0.0",
      subjectRunId: null,
    });
    expect(subjectFromStrategy({ strategyId: "S1", strategyVersion: "2" })).toEqual({
      subjectKind: "strategy",
      subjectId: "S1",
      subjectVersion: "2",
      subjectRunId: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 11. deterministic fingerprint
// ---------------------------------------------------------------------------

describe("公共机制 · 11. 确定性指纹与序列化", () => {
  it("同输入 ⇒ 同指纹、逐字节同串（wall-clock 刻意不注入）", () => {
    const a = makeRun().run;
    const b = makeRun().run;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(serializeMultiDimensionRobustnessRun(a)).toBe(serializeMultiDimensionRobustnessRun(b));
    expect(a.createdAt).toBeNull();
  });

  it("改一个指标值 ⇒ 指纹变", () => {
    const a = makeRun().run;
    const c = makeRun({
      evaluator: evaluatorOf({
        BASE: { mean: 0.05, median: 0.02, valid: 80 },
        K3: { mean: 0.050001, median: 0.02, valid: 80 },
        COND: { mean: 0.11, median: 0.09, valid: 40 },
        SELF: { mean: 0.05, median: 0.02, valid: 80 },
      }),
    }).run;
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it("记录不可变（deepFreeze）：改 baseline 会抛（严格模式）", () => {
    const { run } = makeRun();
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.variants)).toBe(true);
    expect(() => {
      (run as unknown as { runId: string }).runId = "HACK";
    }).toThrow();
  });

  it("结构校验 + 反序列化：合法记录通过；篡改内容被指纹拒", () => {
    const { run } = makeRun();
    const json = serializeMultiDimensionRobustnessRun(run);
    expect(validateMultiDimensionRobustnessRun(JSON.parse(json)).valid).toBe(true);
    const roundTrip = deserializeMultiDimensionRobustnessRun(json);
    expect(roundTrip.fingerprint).toBe(run.fingerprint);

    const tampered = JSON.parse(json) as Record<string, unknown>;
    tampered.fingerprint = "0".repeat(64);
    expect(() => deserializeMultiDimensionRobustnessRun(JSON.stringify(tampered))).toThrow(ResearchValidationError);
    expect(computeMultiDimensionRunFingerprint(run)).toBe(run.fingerprint);
  });

  it("记录种类标签与策略侧**不同**（两套记录形态并存，不互相冒充）", () => {
    expect(MULTI_DIMENSION_RUN_RECORD_KIND).toBe("MULTI_DIMENSION_ROBUSTNESS_RUN");
    expect(MULTI_DIMENSION_RUN_RECORD_KIND).not.toBe("ROBUSTNESS_RUN");
  });
});

// ---------------------------------------------------------------------------
// 12. 核心零业务语义 —— 结构级闸门（规格 §17：「Core 内写首板回踩业务判断」被明禁）
//
// 为什么必须是个**闸门**而不是注释：`dimension.ts` 的文件头**自称**「有静态守卫测试钉住」，
// 但在本轮之前，全仓**没有任何**测试扫描过它 —— 也就是说那句话当时是**假的**。
// 「说明书比事实宽」在本仓已被登记多次（见 `9cj` / `9ck`），补闸门是唯一的修法。
//
// 判据的两条设计要点：
//   1. **必须在「去注释后的代码」上判** —— 因为禁止说明本身就要**写出**这些标识符
//      （`dimension.ts:19-20` 就写着 `nonBreakOpen` / `first-board` / `medianCloseReturn`）。
//      在原文上判会**恒假命中**，把闸门变成一个恒红噪声。
//   2. **必须证明「去注释」这一步有作用** —— 否则若哪天注释被删掉，闸门会因为
//      「反正也匹配不到」而**空转通过**，看起来仍然全绿。故下面第二条用例显式要求
//      「原文含禁词 ∧ 去注释后不含」同时成立。
// ---------------------------------------------------------------------------

const ROBUSTNESS_DIR = path.resolve(process.cwd(), "server/research/robustness");
/** 泛化层三个文件（C-18.1 的既有文件不在其列 —— 它们的词表**本来就是策略的**）。 */
const GENERALIZED_CORE_FILES = ["comparison.ts", "dimension.ts", "multiDimension.ts"];
/** 研究侧标识符（实验 id / 维度 id / 变体 code / 指标名 / 行情列名）。 */
const RESEARCH_TOKENS = [
  "first-board",
  "pullback",
  "nonBreakOpen",
  "breakOpen",
  "observationDay",
  "evaluationHorizon",
  "sampleCondition",
  "medianCloseReturn",
  "breakoutVsCloseRate",
  "limitUpPrice",
  "previousClose",
  // ⚠️ 这里**不能**写 `BASELINE_`：核心自己的错误码就叫 `RB18X_BASELINE_FAILED` /
  //    `RB18X_BASELINE_NOT_FIRST` …，而「baseline-first」**本来就是核心概念**
  //    ⇒ 用前缀会**假阳性**（本闸门第一版就踩了，实测被它自己抓出来）。
  //    要禁的是**本实验那一条具体基准变体的 code**。
  "BASELINE_T5_H10_ALL",
  "OBS_DAY_",
  "HORIZON_T",
  "DD_200BP",
];

/** 去掉块注释（含 JSDoc）与行注释；三个文件里没有「字符串内含 `//`」⇒ 这样去注释是安全的。 */
const codeOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/u, ""))
    .join("\n");

describe("公共机制 · 12. 核心不含研究侧业务语义（§17 结构级闸门）", () => {
  it("🔴 泛化层三个文件的**代码**里不出现任何研究侧标识符", () => {
    for (const file of GENERALIZED_CORE_FILES) {
      const raw = readFileSync(path.join(ROBUSTNESS_DIR, file), "utf8");
      const code = codeOnly(raw);
      for (const token of RESEARCH_TOKENS) {
        expect(
          code.includes(token),
          `${file} 的代码里出现了研究侧标识符 "${token}"（核心不得感知具体研究语义；` +
            "若确需举例，请写在注释里 —— 注释会被本闸门剔除）",
        ).toBe(false);
      }
    }
  });

  it("🔴 「去注释」这一步真的有作用（否则闸门会空转通过）", () => {
    const raw = readFileSync(path.join(ROBUSTNESS_DIR, "dimension.ts"), "utf8");
    // 原文里**必须**含禁词（它就是那句禁止说明）——证明禁词表不是随口写的、确实匹配得到；
    expect(RESEARCH_TOKENS.some((token) => raw.includes(token))).toBe(true);
    // 去注释后必须一个都不含 —— 证明上面的绿不是「匹配不到」换来的。
    expect(RESEARCH_TOKENS.some((token) => codeOnly(raw).includes(token))).toBe(false);
  });

  it("三个文件都真的被读到了（防止路径写错导致闸门对空气生效）", () => {
    for (const file of GENERALIZED_CORE_FILES) {
      const raw = readFileSync(path.join(ROBUSTNESS_DIR, file), "utf8");
      expect(raw.length).toBeGreaterThan(1000);
      expect(raw.includes("export")).toBe(true);
    }
  });
});
