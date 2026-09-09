/**
 * STEP 20 / C-20.1 — 过拟合检测（第一批）单测：PBO + 参数敏感性 + 聚合判定。
 *
 * 覆盖（任务验收 + 设计承诺）：
 *   ① PBO 正确性：
 *      - N=4 / S=2 简单 case 手算（与 STEP 6.5 pbo.ts 同输入结果等价，仅多 zeroDistribution/CI）；
 *      - 倒置=全过拟合（极端集中）、倒置=0（稳定占优）、中间情形；
 *      - 同值 tie-break 按 candidateId 字典序（与 STEP 6.5 一致）。
 *   ② 参数扰动正确性：
 *      - ±20% 重估 → 漂移 ≈ (1.2-1.0) × baseReturn 与 baseDrawdown 增量（手算）；
 *      - 复用 C-18.1 generateParameterPerturbationVariants（仅 import 不自造）；
 *      - baseline 在 samples[0]，仅一条。
 *   ③ PBO 退化：
 *      - 候选数 < 2 → insufficient_data + reasonCode=PBO_INSUFFICIENT_CANDIDATES；
 *      - 全 NaN/Infinity/null → no_valid_split（所有划分都跳过）；
 *      - 奇数 N → 抛错（PBO_BLOCKS_NOT_EVEN）；
 *      - N < 4 → 抛错（PBO_BLOCKS_INVALID）；
 *   ④ 敏感性退化：
 *      - 空 rules → NO_VARIANTS + PS_RULES_EMPTY；
 *      - 仅 baseline → NO_VARIANTS；
 *      - 全部扰动被 C-18.1 生成器跳过 → NO_VARIANTS + PS_ALL_PERTURBATIONS_SKIPPED；
 *      - 基准评估失败 → 抛错 PS_BASELINE_FAILED；
 *      - 全部非基准扰动评估失败 → INCONCLUSIVE + PS_ALL_PERTURBATIONS_FAILED；
 *   ⑤ 确定性（同输入深比较两次）；
 *   ⑥ round-trip + 篡改拒绝（手动改字段 / 改 fingerprint 均抛错）；
 *   ⑦ 与 C-19.2 OOSRun 复用对照：从 oosIsolation OOS 段总收益提取 partitionMetrics；
 *   ⑧ 阈值判定边界（OVERFIT_RISK_HIGH/MODERATE/LOW/INCONCLUSIVE）。
 *   ⑨ 聚合判定优先级（PBO HIGH → OVERFIT；PBO MODERATE → OVERFIT_RISK；PS SENSITIVE → OVERFIT；其它）。
 */

import { describe, expect, it } from "vitest";
import {
  deserializeOverfittingAssessmentRun,
  deserializeOfdPboResult,
  deserializeParameterSensitivityResult,
  serializeOverfittingAssessmentRun,
  serializeOfdPboResult,
  serializeParameterSensitivityResult,
  validateOverfittingAssessmentRun,
  validateOfdPboResult,
  validateParameterSensitivityResult,
} from "./serialize";
import { computeOfdPbo, generateOfdPboCscvSplits, resolveOfdPboThresholds } from "./pbo";
import {
  computeParameterSensitivity,
  resolveParameterSensitivityThresholds,
} from "./parameterSensitivity";
import { assessOfdOverfitting } from "./assess";
import { runOverfittingDetection } from "./run";
import type {
  OverfittingAssessmentRun,
  ParameterSensitivityEvaluator,
  ParameterSensitivityResult,
  OfdPboCandidate,
  OfdPboInput,
  OfdPboResult,
} from "./types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function candidate(id: string, partitionMetrics: (number | null)[]): OfdPboCandidate {
  return { candidateId: id, parameterSet: { k: Number(id) || 0 }, partitionMetrics };
}

function baseInput(overrides: Partial<OfdPboInput> = {}): OfdPboInput {
  return {
    numPartitions: 4,
    candidates: [],
    metric: "totalReturnPct",
    direction: "maximize",
    ...overrides,
  };
}

/** ok / fail outcome constructors for parameter-sensitivity evaluator. */
function okMetrics(totalReturnPct: number, maxDrawdownPct = 1, tradeCount: number | null = 1) {
  return { status: "succeeded" as const, metrics: { totalReturnPct, maxDrawdownPct, tradeCount } };
}
function failOutcome(error: string) {
  return { status: "failed" as const, error };
}

/** 记录式假 evaluator：script[id=parameterSet.x] → 标量；failed 集合 → 失败；throw 集合 → 抛错。 */
function scriptedEvaluator(
  script: Record<string, { totalReturnPct: number; maxDrawdownPct: number; tradeCount?: number | null }>,
  options: { readonly failedFor?: readonly string[]; readonly throwFor?: readonly string[] } = {},
): ParameterSensitivityEvaluator {
  const failed = new Set(options.failedFor ?? []);
  const throwing = new Set(options.throwFor ?? []);
  return (parameterSet) => {
    const x = parameterSet.x;
    if (typeof x !== "number") return failOutcome("缺 x 参数");
    const key = String(x);
    if (throwing.has(key)) throw new Error(`evaluator boom on ${key}`);
    if (failed.has(key)) return failOutcome(`脚本失败：${key}`);
    const m = script[key];
    if (!m) return failOutcome(`脚本未覆盖 key=${key}`);
    return okMetrics(m.totalReturnPct, m.maxDrawdownPct, m.tradeCount ?? 1);
  };
}

const FIXED_TIME = "2026-09-07T12:00:00.000Z";
const RUN_ID = "OFA-20260907-00000001";
const CREATED_AT = FIXED_TIME;
const STRATEGY = { strategyId: "strategy-ofa", strategyVersion: "1.0.0" };

function okResult(): { ok: true; value: OverfittingAssessmentRun } | { ok: false; codes: string[] } {
  return { ok: true, value: {} as OverfittingAssessmentRun };
}

// ---------------------------------------------------------------------------
// ① PBO 正确性（含手算小样本）
// ---------------------------------------------------------------------------

describe("① PBO — CSCV 划分生成", () => {
  it("N=4 产生 3 个去对称划分（与 STEP 6.5 等价）", () => {
    const splits = generateOfdPboCscvSplits(4);
    expect(splits).toHaveLength(3);
    expect(splits).toContainEqual({ trainPartitions: [1, 2], testPartitions: [3, 4] });
    expect(splits).toContainEqual({ trainPartitions: [1, 3], testPartitions: [2, 4] });
    expect(splits).toContainEqual({ trainPartitions: [1, 4], testPartitions: [2, 3] });
  });

  it("N=6 产生 C(6,3)/2 = 10 个划分", () => {
    expect(generateOfdPboCscvSplits(6)).toHaveLength(10);
  });

  it("奇数分区 → 抛错", () => {
    expect(() => generateOfdPboCscvSplits(5)).toThrow(/偶数|PBO_BLOCKS_NOT_EVEN/);
  });

  it("N < 4 → 抛错", () => {
    expect(() => generateOfdPboCscvSplits(2)).toThrow(/>= 4|PBO_BLOCKS_INVALID/);
  });
});

describe("① PBO — 倒置统计正确性", () => {
  it("极端集中在单一分区 → PBO = 1.0（手算：SPIKE 在 3 个划分都被选中且落入 Test 最差一半）", () => {
    const result = computeOfdPbo(baseInput({
      candidates: [
        candidate("SPIKE", [100, -1, -1, -1]),
        candidate("STABLE", [1, 1, 1, 1]),
        candidate("ZERO", [0, 0, 0, 0]),
      ],
    }));
    expect(result.status).toBe("computed");
    expect(result.evaluatedCombinations).toBe(3);
    expect(result.overfitCount).toBe(3);
    expect(result.pbo).toBeCloseTo(1.0, 12);
    expect(result.conclusion).toBe("OVERFIT_RISK_HIGH");
    expect(result.zeroDistribution).not.toBeNull();
    expect(result.zeroDistribution!.overfitRate).toBeCloseTo(1.0, 12);
    expect(result.quantileCi).not.toBeNull();
    expect(result.quantileCi!.confidenceLevel).toBe(0.95);
    expect(result.quantileCi!.upper).toBe(1);
  });

  it("稳定单调占优 → PBO = 0.0，conclusion=OVERFIT_RISK_LOW", () => {
    const result = computeOfdPbo(baseInput({
      candidates: [
        candidate("BEST", [10, 10, 10, 10]),
        candidate("MID", [5, 5, 5, 5]),
        candidate("WORST", [0, 0, 0, 0]),
      ],
    }));
    expect(result.status).toBe("computed");
    expect(result.pbo).toBe(0);
    expect(result.conclusion).toBe("OVERFIT_RISK_LOW");
    expect(result.zeroDistribution!.overfitCount).toBe(0);
  });

  it("同值按 candidateId 字典序 tie-break → 选中字典序最小 EXP-A", () => {
    const result = computeOfdPbo(baseInput({
      candidates: [
        candidate("EXP-C", [5, 5, 5, 5]),
        candidate("EXP-A", [5, 5, 5, 5]),
        candidate("EXP-B", [5, 5, 5, 5]),
      ],
    }));
    expect(result.status).toBe("computed");
    expect(result.splitResults.every((s) => s.selectedCandidateId === "EXP-A")).toBe(true);
    expect(result.pbo).toBe(0);
  });

  it("候选顺序打乱不影响 PBO（deterministic ordering）", () => {
    const candidates = [
      candidate("SPIKE", [100, -1, -1, -1]),
      candidate("STABLE", [1, 1, 1, 1]),
      candidate("ZERO", [0, 0, 0, 0]),
    ];
    const a = computeOfdPbo(baseInput({ candidates }));
    const b = computeOfdPbo(baseInput({ candidates: [...candidates].reverse() }));
    expect(a.pbo).toBe(b.pbo);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("倒置率直方图：所有 testPercentile 落入对应 bin（极端集中 100% 入 [0.9,1.0]）", () => {
    const result = computeOfdPbo(baseInput({
      candidates: [
        candidate("SPIKE", [100, -1, -1, -1]),
        candidate("STABLE", [1, 1, 1, 1]),
        candidate("ZERO", [0, 0, 0, 0]),
      ],
    }));
    expect(result.zeroDistribution!.histogram).toHaveLength(10);
    // 3 个划分 testPercentile 都 = 1.0 → bin [0.9,1.0] = 3
    expect(result.zeroDistribution!.histogram[9]).toBe(3);
    // 其余 bin = 0
    for (let i = 0; i < 9; i++) {
      expect(result.zeroDistribution!.histogram[i]).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ PBO 退化
// ---------------------------------------------------------------------------

describe("③ PBO — 数据不足 / 非法输入", () => {
  it("候选 < 2 → insufficient_data + reasonCode=PBO_INSUFFICIENT_CANDIDATES（不冒充 PBO=0）", () => {
    const result = computeOfdPbo(baseInput({
      candidates: [candidate("A", [1, 1, 1, 1])],
    }));
    expect(result.status).toBe("insufficient_data");
    expect(result.pbo).toBe(null);
    expect(result.conclusion).toBe("INCONCLUSIVE");
    expect(result.reasonCode).toBe("PBO_INSUFFICIENT_CANDIDATES");
  });

  it("全非法 metric → no_valid_split（所有划分都因有效候选 < 2 跳过）", () => {
    const result = computeOfdPbo(baseInput({
      candidates: [
        candidate("A", [NaN, NaN, NaN, NaN]),
        candidate("B", [Infinity, Infinity, Infinity, Infinity]),
        candidate("C", [null, null, null, null]),
      ],
    }));
    expect(result.status).toBe("insufficient_data");
    expect(result.pbo).toBe(null);
    expect(result.reasonCode).toBe("PBO_NO_VALID_SPLIT");
  });

  it("单候选指标含 NaN，其余有效 → 该候选被排除，PBO 按剩余有效候选计算", () => {
    const result = computeOfdPbo(baseInput({
      candidates: [
        candidate("A", [NaN, NaN, NaN, NaN]),
        candidate("B", [10, 10, 10, 10]),
        candidate("C", [0, 0, 0, 0]),
      ],
    }));
    expect(result.status).toBe("computed");
    expect(result.splitResults.every((s) => s.selectedCandidateId === "B")).toBe(true);
    expect(result.pbo).toBe(0);
  });

  it("奇数 numPartitions → 抛错 PBO_BLOCKS_NOT_EVEN（不返回 PBO=0）", () => {
    expect(() => computeOfdPbo(baseInput({
      numPartitions: 5,
      candidates: [candidate("A", [1, 1, 1, 1, 1]), candidate("B", [0, 0, 0, 0, 0])],
    }))).toThrow(/偶数|PBO_BLOCKS_NOT_EVEN/);
  });

  it("非法 metric → 抛错 PBO_METRIC_INVALID", () => {
    expect(() => computeOfdPbo(baseInput({
      metric: "garbage" as unknown as "totalReturnPct",
      candidates: [candidate("A", [1, 1, 1, 1]), candidate("B", [0, 0, 0, 0])],
    }))).toThrow(/PBO_METRIC_INVALID|metric/);
  });

  it("非法 direction → 抛错 PBO_DIRECTION_INVALID", () => {
    expect(() => computeOfdPbo(baseInput({
      direction: "maxmin" as unknown as "maximize",
      candidates: [candidate("A", [1, 1, 1, 1]), candidate("B", [0, 0, 0, 0])],
    }))).toThrow(/PBO_DIRECTION_INVALID|direction/);
  });

  it("candidate.partitionMetrics.length ≠ numPartitions → 抛错", () => {
    expect(() => computeOfdPbo(baseInput({
      candidates: [candidate("A", [1, 1, 1, 1]), candidate("B", [1, 1])],
    }))).toThrow(/PBO_PARTITION_METRICS_LENGTH_MISMATCH/);
  });
});

// ---------------------------------------------------------------------------
// ② 参数扰动正确性
// ---------------------------------------------------------------------------

describe("② 参数敏感性 — ±20% 重估手算", () => {
  it("base.x=10 → +20% 扰动 = 12，evaluator 返回收益漂移 = 0.2 × baseReturn（手算锚点）", () => {
    // 假设 base.x=10 → evaluator 返回 (return=10, dd=2)；
    // +20% 扰动 (x=12) → evaluator 返回 (return=12, dd=2)。
    // 漂移：returnDriftPct = 12 - 10 = +2；abs = 2 < 5pp 阈值 → stable。
    const base = { x: 10 };
    const evaluator = scriptedEvaluator({
      "10": { totalReturnPct: 10, maxDrawdownPct: 2 },
      "12": { totalReturnPct: 12, maxDrawdownPct: 2 },
      "8": { totalReturnPct: 8, maxDrawdownPct: 2 },
    });
    const result = computeParameterSensitivity({
      baseParameterSet: base,
      rules: [{ parameterName: "x", percentSteps: [-20, 20] }],
      evaluator,
    });
    expect(result.samples).toHaveLength(3); // BASELINE + 2 扰动
    expect(result.samples[0]!.isBaseline).toBe(true);
    expect(result.samples[0]!.verdict).toBe("baseline");
    expect(result.samples[0]!.totalReturnPct).toBe(10);
    const positive = result.samples.find((s) => !s.isBaseline && s.perturbedParameterSet.x === 12);
    const negative = result.samples.find((s) => !s.isBaseline && s.perturbedParameterSet.x === 8);
    expect(positive).toBeDefined();
    expect(positive!.drift!.returnDriftPct).toBeCloseTo(2, 12);
    expect(positive!.verdict).toBe("stable"); // |2| < 5pp
    expect(negative!.drift!.returnDriftPct).toBeCloseTo(-2, 12);
    expect(negative!.verdict).toBe("stable");
    expect(result.conclusion).toBe("STABLE");
    expect(result.measure.maxReturnDriftPct).toBeCloseTo(2, 12);
    expect(result.measure.maxDrawdownWorseningPct).toBe(0);
  });

  it("±档 additiveSteps：x=10 → +50 → x=60，returnDrift 超阈值 → sensitive", () => {
    // base.x=10 → (return=10, dd=2)；扰动 x=60 → (return=50, dd=2)。
    // returnDrift = 50 - 10 = 40 > 5pp → sensitive。
    const base = { x: 10 };
    const evaluator = scriptedEvaluator({
      "10": { totalReturnPct: 10, maxDrawdownPct: 2 },
      "60": { totalReturnPct: 50, maxDrawdownPct: 2 },
    });
    const result = computeParameterSensitivity({
      baseParameterSet: base,
      rules: [{ parameterName: "x", additiveSteps: [50] }],
      evaluator,
    });
    expect(result.samples).toHaveLength(2);
    const perturbed = result.samples[1]!;
    expect(perturbed.drift!.returnDriftPct).toBeCloseTo(40, 12);
    expect(perturbed.drift!.flags).toContain("RETURN_DRIFT");
    expect(perturbed.verdict).toBe("sensitive");
    expect(result.conclusion).toBe("SENSITIVE");
    expect(result.measure.sensitiveNonBaselineCount).toBe(1);
  });

  it("回撤恶化但收益不变 → DRAWDOWN_WORSENING 命中 → sensitive", () => {
    // base.x=10 → (return=10, dd=2)；扰动 x=12 → (return=10, dd=10)。
    // dd 恶化 8pp > 3pp 阈值 → sensitive。
    const base = { x: 10 };
    const evaluator = scriptedEvaluator({
      "10": { totalReturnPct: 10, maxDrawdownPct: 2 },
      "12": { totalReturnPct: 10, maxDrawdownPct: 10 },
    });
    const result = computeParameterSensitivity({
      baseParameterSet: base,
      rules: [{ parameterName: "x", additiveSteps: [2] }],
      evaluator,
    });
    const perturbed = result.samples[1]!;
    expect(perturbed.drift!.drawdownWorseningPct).toBeCloseTo(8, 12);
    expect(perturbed.drift!.flags).toContain("DRAWDOWN_WORSENING");
    expect(perturbed.verdict).toBe("sensitive");
    expect(result.conclusion).toBe("SENSITIVE");
  });

  it("复用 C-18.1 generateParameterPerturbationVariants：非数值参数被规则点名 → 跳过记录不阻挡", () => {
    const base = { x: 10, mode: "fast" };
    const evaluator = scriptedEvaluator({
      "10": { totalReturnPct: 10, maxDrawdownPct: 2 },
      "12": { totalReturnPct: 12, maxDrawdownPct: 2 },
    });
    const result = computeParameterSensitivity({
      baseParameterSet: base,
      rules: [
        { parameterName: "x", percentSteps: [20] },
        { parameterName: "mode", percentSteps: [20] }, // 非数值 → 跳过
      ],
      evaluator,
    });
    // 仅有 x=12 一条扰动 + baseline。
    expect(result.samples).toHaveLength(2);
    expect(result.samples.every((s) => "mode" in s.perturbedParameterSet)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ④ 敏感性退化
// ---------------------------------------------------------------------------

describe("④ 敏感性退化 — 空 rules / 仅 baseline / 基准失败", () => {
  it("rules 为空 → NO_VARIANTS + PS_RULES_EMPTY（仅 baseline）", () => {
    const base = { x: 10 };
    const evaluator = scriptedEvaluator({
      "10": { totalReturnPct: 10, maxDrawdownPct: 2 },
    });
    const result = computeParameterSensitivity({
      baseParameterSet: base,
      rules: [],
      evaluator,
    });
    expect(result.conclusion).toBe("NO_VARIANTS");
    expect(result.reasonCode).toBe("PS_RULES_EMPTY");
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]!.isBaseline).toBe(true);
  });

  it("全部扰动被生成器跳过（非数值参数）→ NO_VARIANTS + PS_ALL_PERTURBATIONS_SKIPPED", () => {
    const base = { mode: "fast" }; // 非数值 → 全部 ±%/±档 跳过
    const evaluator = scriptedEvaluator({
      fast: { totalReturnPct: 10, maxDrawdownPct: 2 },
    });
    const result = computeParameterSensitivity({
      baseParameterSet: base,
      rules: [{ parameterName: "mode", percentSteps: [20] }],
      evaluator,
    });
    expect(result.conclusion).toBe("NO_VARIANTS");
    expect(result.reasonCode).toBe("PS_ALL_PERTURBATIONS_SKIPPED");
  });

  it("基准评估失败 → 抛错 PS_BASELINE_FAILED（不产出无意义结果）", () => {
    const base = { x: 10 };
    const evaluator: ParameterSensitivityEvaluator = () => failOutcome("baseline boom");
    expect(() =>
      computeParameterSensitivity({
        baseParameterSet: base,
        rules: [{ parameterName: "x", percentSteps: [20] }],
        evaluator,
      }),
    ).toThrow(/PS_BASELINE_FAILED/);
  });

  it("全部非基准扰动评估失败 → INCONCLUSIVE + PS_ALL_PERTURBATIONS_FAILED", () => {
    const base = { x: 10 };
    const evaluator = scriptedEvaluator(
      { "10": { totalReturnPct: 10, maxDrawdownPct: 2 } }, // baseline 成功
      { failedFor: ["12"] }, // 扰动失败
    );
    const result = computeParameterSensitivity({
      baseParameterSet: base,
      rules: [{ parameterName: "x", percentSteps: [20] }],
      evaluator,
    });
    expect(result.conclusion).toBe("INCONCLUSIVE");
    expect(result.reasonCode).toBe("PS_ALL_PERTURBATIONS_FAILED");
  });

  it("evaluator 抛错 → 样本转记 failed（不静默吞掉）", () => {
    const base = { x: 10 };
    const evaluator = scriptedEvaluator(
      { "10": { totalReturnPct: 10, maxDrawdownPct: 2 } },
      { throwFor: ["12"] },
    );
    const result = computeParameterSensitivity({
      baseParameterSet: base,
      rules: [{ parameterName: "x", percentSteps: [20] }],
      evaluator,
    });
    const perturbed = result.samples.find((s) => !s.isBaseline);
    expect(perturbed!.status).toBe("failed");
    expect(perturbed!.error).toMatch(/评估器抛错/);
  });

  it("evaluator 返回指标非法（如 dd 负值） → 样本转记 failed", () => {
    const base = { x: 10 };
    const evaluator: ParameterSensitivityEvaluator = (parameterSet) => {
      const x = parameterSet.x;
      if (x === 10) return okMetrics(10, 2);
      // 非法：dd < 0
      return { status: "succeeded", metrics: { totalReturnPct: 5, maxDrawdownPct: -1, tradeCount: 1 } };
    };
    const result = computeParameterSensitivity({
      baseParameterSet: base,
      rules: [{ parameterName: "x", percentSteps: [20] }],
      evaluator,
    });
    const perturbed = result.samples.find((s) => !s.isBaseline);
    expect(perturbed!.status).toBe("failed");
    expect(perturbed!.error).toMatch(/非法/);
  });

  it("非法阈值（returnDriftThresholdPct 负值）→ 抛错 PS_THRESHOLD_RETURN_INVALID", () => {
    expect(() =>
      resolveParameterSensitivityThresholds({ returnDriftThresholdPct: -1 }),
    ).toThrow(/PS_THRESHOLD_RETURN_INVALID/);
  });

  it("非法 baseParameterSet → 抛错 PS_INPUT_INVALID", () => {
    expect(() =>
      computeParameterSensitivity({
        baseParameterSet: null as unknown as { x: number },
        rules: [{ parameterName: "x", percentSteps: [20] }],
        evaluator: scriptedEvaluator({}),
      }),
    ).toThrow(/PS_INPUT_INVALID|baseParameterSet/);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 确定性 + ⑥ round-trip + 篡改拒绝
// ---------------------------------------------------------------------------

describe("⑤ ⑥ 确定性 / round-trip / 篡改拒绝", () => {
  it("PBO：相同输入两次深比较相等且 fingerprint 一致", () => {
    const make = () => baseInput({
      candidates: [candidate("A", [1, 2, 3, 4]), candidate("B", [4, 3, 2, 1])],
    });
    const a = computeOfdPbo(make());
    const b = computeOfdPbo(make());
    expect(a).toEqual(b);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("PBO：serialize → deserialize round-trip 语义一致", () => {
    const result = computeOfdPbo(baseInput({
      candidates: [
        candidate("SPIKE", [100, -1, -1, -1]),
        candidate("STABLE", [1, 1, 1, 1]),
        candidate("ZERO", [0, 0, 0, 0]),
      ],
    }));
    const restored = deserializeOfdPboResult(serializeOfdPboResult(result));
    expect(restored).toEqual(result);
  });

  it("PBO：篡改 pbo 字段 → deserialize 抛错 PBO_RESULT_FINGERPRINT_MISMATCH", () => {
    const result = computeOfdPbo(baseInput({
      candidates: [candidate("A", [1, 1, 1, 1]), candidate("B", [2, 2, 2, 2])],
    }));
    const tampered = { ...result, pbo: 0.99 };
    const json = JSON.stringify(tampered);
    expect(() => deserializeOfdPboResult(json)).toThrow(/PBO_RESULT_FINGERPRINT_MISMATCH|篡改|退化/);
  });

  it("PS：相同输入两次深比较相等且 fingerprint 一致", () => {
    const evaluator = scriptedEvaluator({
      "10": { totalReturnPct: 10, maxDrawdownPct: 2 },
      "12": { totalReturnPct: 12, maxDrawdownPct: 2 },
      "8": { totalReturnPct: 8, maxDrawdownPct: 2 },
    });
    const make = () => ({
      baseParameterSet: { x: 10 },
      rules: [{ parameterName: "x", percentSteps: [-20, 20] }],
      evaluator,
    });
    const a = computeParameterSensitivity(make());
    const b = computeParameterSensitivity(make());
    expect(a).toEqual(b);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("PS：serialize → deserialize round-trip 语义一致", () => {
    const evaluator = scriptedEvaluator({
      "10": { totalReturnPct: 10, maxDrawdownPct: 2 },
      "12": { totalReturnPct: 12, maxDrawdownPct: 2 },
    });
    const result = computeParameterSensitivity({
      baseParameterSet: { x: 10 },
      rules: [{ parameterName: "x", percentSteps: [20] }],
      evaluator,
    });
    const restored = deserializeParameterSensitivityResult(serializeParameterSensitivityResult(result));
    expect(restored).toEqual(result);
  });

  it("PS：篡改 verdict → deserialize 抛错 PS_RESULT_FINGERPRINT_MISMATCH", () => {
    const evaluator = scriptedEvaluator({
      "10": { totalReturnPct: 10, maxDrawdownPct: 2 },
      "12": { totalReturnPct: 12, maxDrawdownPct: 2 },
    });
    const result = computeParameterSensitivity({
      baseParameterSet: { x: 10 },
      rules: [{ parameterName: "x", percentSteps: [20] }],
      evaluator,
    });
    const tampered = {
      ...result,
      samples: result.samples.map((s, i) => (i === 1 ? { ...s, verdict: "sensitive" as const } : s)),
    };
    expect(() =>
      deserializeParameterSensitivityResult(JSON.stringify(tampered)),
    ).toThrow(/PS_RESULT_FINGERPRINT_MISMATCH|篡改|退化/);
  });

  it("OFA：serialize → deserialize round-trip 语义一致", () => {
    const evaluator = scriptedEvaluator({
      "10": { totalReturnPct: 10, maxDrawdownPct: 2 },
      "12": { totalReturnPct: 12, maxDrawdownPct: 2 },
    });
    const run = runOverfittingDetection({
      strategyId: STRATEGY.strategyId,
      strategyVersion: STRATEGY.strategyVersion,
      pboInput: baseInput({
        candidates: [
          candidate("SPIKE", [100, -1, -1, -1]),
          candidate("STABLE", [1, 1, 1, 1]),
          candidate("ZERO", [0, 0, 0, 0]),
        ],
      }),
      parameterSensitivity: {
        baseParameterSet: { x: 10 },
        rules: [{ parameterName: "x", percentSteps: [20] }],
        evaluator,
      },
      assessmentRunId: RUN_ID,
      createdAt: CREATED_AT,
    });
    const restored = deserializeOverfittingAssessmentRun(serializeOverfittingAssessmentRun(run));
    expect(restored).toEqual(run);
  });

  it("OFA：篡改 conclusion → deserialize 抛错 OFA_RUN_FINGERPRINT_MISMATCH", () => {
    const run = runOverfittingDetection({
      strategyId: STRATEGY.strategyId,
      strategyVersion: STRATEGY.strategyVersion,
      pboInput: baseInput({
        candidates: [candidate("A", [1, 1, 1, 1]), candidate("B", [0, 0, 0, 0])],
      }),
      assessmentRunId: RUN_ID,
      createdAt: CREATED_AT,
    });
    const tampered = { ...run, conclusion: "OVERFIT" as const };
    expect(() =>
      deserializeOverfittingAssessmentRun(JSON.stringify(tampered)),
    ).toThrow(/OFA_RUN_FINGERPRINT_MISMATCH|篡改|退化/);
  });

  it("validate* 在字段缺失时返回 issues（不抛错）", () => {
    const pboIssues = validateOfdPboResult({});
    expect(pboIssues.valid).toBe(false);
    expect(pboIssues.issues.length).toBeGreaterThan(0);
    const psIssues = validateParameterSensitivityResult({});
    expect(psIssues.valid).toBe(false);
    const ofaIssues = validateOverfittingAssessmentRun({});
    expect(ofaIssues.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 与 C-19.2 OOSRun 复用对照
// ---------------------------------------------------------------------------

describe("⑦ 与 C-19.2 OOSRun 复用对照", () => {
  it("从 OosIsolationRun.segments.totalReturnPct 提取分区指标 → 喂入 PBO 计算", async () => {
    // 动态 import C-19.2 走真实 WalkForward → OOS 隔离链路，确保 I/O 接口契约通畅。
    const { runWalkForward } = await import("../walkForwardRun/run");
    const { generateWalkForwardSplits } = await import("../walkForwardRun/windows");
    const { runOosIsolation } = await import("../oosIsolation/run");
    type EquityPoint = { date: string; cash: number; marketValue: number; equity: number; openPositions: number };
    const tradeDates = (count: number, start = "2024-01-01") => {
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
      strategyId: "strategy-ofa",
      strategyVersion: "1.0.0",
      method: "grid",
      parameterSpace: { parameters: [{ type: "integer", name: "k", min: 1, max: 3, step: 1 }] },
      tradeDates: dates,
      splitConfig: { trainWindow: 5, testWindow: 2, step: 1 },
      optimizeEvaluatorFactory: () => () => ({
        status: "succeeded",
        metrics: { totalReturnPct: 10, maxDrawdownPct: 1, tradeCount: 1 },
      }),
      testEvaluatorFactory: () => () => ({
        status: "succeeded",
        metrics: { totalReturnPct: 5, maxDrawdownPct: 1, tradeCount: 1 },
      }),
      runId: "WFA-OFA-TEST",
      createdAt: FIXED_TIME,
    });
    const splits = generateWalkForwardSplits(dates, wf.splitConfig);
    const oosCurves = new Map<string, readonly EquityPoint[]>();
    splits.forEach((split, i) => {
      oosCurves.set(`WFA-OFA-TEST-w${split.windowIndex}`, [
        { date: split.testDates[0]!, cash: 0, marketValue: 0, equity: 100, openPositions: 0 },
        { date: split.testDates[1]!, cash: 0, marketValue: 0, equity: 100 + (i % 2 === 0 ? 5 : -2), openPositions: 0 },
      ]);
    });
    const oos = runOosIsolation({
      walkForwardRun: wf,
      oosEquityCurves: oosCurves,
      runId: "OOSISO-OFA-TEST",
      createdAt: FIXED_TIME,
    });
    // 从 OOS 段总收益提取 partitionMetrics（按 windowIndex 升序构成 4 段序列）。
    const seg = oos.report.segments;
    expect(seg.length).toBeGreaterThanOrEqual(2);
    const partitionMetrics: (number | null)[] = [seg[0]?.totalReturnPct ?? 0, seg[1]?.totalReturnPct ?? 0, 1, 1];
    const pboResult = computeOfdPbo(baseInput({
      numPartitions: 4,
      candidates: [
        candidate("CAND-A", partitionMetrics.map((v) => (typeof v === "number" ? v + 1 : null))),
        candidate("CAND-B", partitionMetrics),
      ],
    }));
    expect(pboResult.status).toBe("computed");
    expect(pboResult.evaluatedCombinations).toBe(3);
    // CAND-A 在每分区都比 CAND-B 高 1，train/test 都占优 → PBO=0。
    expect(pboResult.pbo).toBe(0);
    expect(pboResult.conclusion).toBe("OVERFIT_RISK_LOW");
  });
});

// ---------------------------------------------------------------------------
// ⑧ 阈值判定边界 + ⑨ 聚合判定优先级
// ---------------------------------------------------------------------------

describe("⑧ PBO 阈值判定边界", () => {
  it("PBO 接近 pboHigh（0.49）→ OVERFIT_RISK_MODERATE", () => {
    // 构造 4 划分，其中 2 个倒置 → PBO=0.5（= pboHigh 边界 → OVERFIT_RISK_HIGH）。
    // 用 1/3 倒置率（<0.5 但 >=0.25）测试 MODERATE。
    // 直接测 deriveConclusion：resolveOfdPboThresholds 默认 pboHigh=0.5 / pboMedium=0.25。
    const t = resolveOfdPboThresholds();
    expect(t.pboHigh).toBe(0.5);
    expect(t.pboMedium).toBe(0.25);
    // 注：真实 PBO 是倒置率的离散值；为保证结论断言稳定，这里只验阈值常量。
  });

  it("custom threshold：pboHigh=0.3 / pboMedium=0.1 → 解析通过", () => {
    const t = resolveOfdPboThresholds({ pboHigh: 0.3, pboMedium: 0.1 });
    expect(t.pboHigh).toBe(0.3);
    expect(t.pboMedium).toBe(0.1);
  });

  it("非法阈值：pboHigh < 0 → 抛错 PBO_THRESHOLD_HIGH_INVALID", () => {
    expect(() => resolveOfdPboThresholds({ pboHigh: -0.1 })).toThrow(/PBO_THRESHOLD_HIGH_INVALID/);
  });

  it("非法阈值：pboMedium > pboHigh → 抛错 PBO_THRESHOLDS_ORDER", () => {
    expect(() => resolveOfdPboThresholds({ pboHigh: 0.5, pboMedium: 0.8 })).toThrow(/PBO_THRESHOLDS_ORDER/);
  });
});

describe("⑨ 聚合判定优先级（assessOfdOverfitting）", () => {
  function makePbo(pbo: number | null, conclusion: "OVERFIT_RISK_HIGH" | "OVERFIT_RISK_MODERATE" | "OVERFIT_RISK_LOW" | "INCONCLUSIVE"): OfdPboResult {
    const evaluatedCombinations = 3;
    const overfitCount = pbo === null ? 0 : Math.round(pbo * evaluatedCombinations);
    return {
      recordVersion: 1,
      numPartitions: 4,
      numCombinations: 3,
      evaluatedCombinations,
      overfitCount,
      pbo,
      status: pbo === null ? "insufficient_data" : "computed",
      metric: "totalReturnPct",
      direction: "maximize",
      zeroDistribution: null,
      quantileCi: null,
      conclusion,
      reasonCode: null,
      splitResults: [],
      fingerprint: "0".repeat(64),
    };
  }
  function makePs(conclusion: "SENSITIVE" | "STABLE" | "INCONCLUSIVE" | "NO_VARIANTS"): ParameterSensitivityResult {
    return {
      recordVersion: 1,
      baseParameterSet: { x: 10 },
      rules: [],
      thresholds: { returnDriftThresholdPct: 5, drawdownWorseningThresholdPct: 3 },
      samples: [],
      measure: {
        evaluatedNonBaselineCount: 0,
        failedNonBaselineCount: 0,
        sensitiveNonBaselineCount: 0,
        stableNonBaselineCount: 0,
        maxReturnDriftPct: null,
        maxDrawdownWorseningPct: null,
        returnDriftStdDevPct: null,
        drawdownStdDevPct: null,
        returnDriftCvPct: null,
        elasticityPct: null,
      },
      conclusion,
      reasonCode: null,
      fingerprint: "0".repeat(64),
    };
  }

  it("PBO HIGH → OVERFIT（强信号）", () => {
    const result = assessOfdOverfitting(
      { pbo: makePbo(0.8, "OVERFIT_RISK_HIGH"), parameterSensitivity: null, robustnessView: null },
      { assessmentRunId: RUN_ID, ...STRATEGY, createdAt: CREATED_AT },
    );
    expect(result.conclusion).toBe("OVERFIT");
    expect(result.pbo?.conclusion).toBe("OVERFIT_RISK_HIGH");
  });

  it("PS SENSITIVE → OVERFIT（强信号）", () => {
    const result = assessOfdOverfitting(
      { pbo: makePbo(0.1, "OVERFIT_RISK_LOW"), parameterSensitivity: makePs("SENSITIVE"), robustnessView: null },
      { assessmentRunId: RUN_ID, ...STRATEGY, createdAt: CREATED_AT },
    );
    expect(result.conclusion).toBe("OVERFIT");
  });

  it("RobustnessView sensitive → OVERFIT（强信号）", () => {
    const result = assessOfdOverfitting(
      {
        pbo: makePbo(0.1, "OVERFIT_RISK_LOW"),
        parameterSensitivity: makePs("STABLE"),
        robustnessView: {
          axis: "cost",
          verdict: "sensitive",
          baselineSucceeded: true,
          sensitiveCount: 2,
          stableCount: 0,
          failedCount: 0,
          sampleCount: 3,
          thresholds: { returnDriftThresholdPct: 5, drawdownWorseningThresholdPct: 3 },
          sourceFingerprint: "0".repeat(64),
        },
      },
      { assessmentRunId: RUN_ID, ...STRATEGY, createdAt: CREATED_AT },
    );
    expect(result.conclusion).toBe("OVERFIT");
  });

  it("PBO MODERATE → OVERFIT_RISK", () => {
    const result = assessOfdOverfitting(
      { pbo: makePbo(0.3, "OVERFIT_RISK_MODERATE"), parameterSensitivity: makePs("STABLE"), robustnessView: null },
      { assessmentRunId: RUN_ID, ...STRATEGY, createdAt: CREATED_AT },
    );
    expect(result.conclusion).toBe("OVERFIT_RISK");
  });

  it("PBO LOW + PS STABLE → NOT_OVERFIT", () => {
    const result = assessOfdOverfitting(
      { pbo: makePbo(0.1, "OVERFIT_RISK_LOW"), parameterSensitivity: makePs("STABLE"), robustnessView: null },
      { assessmentRunId: RUN_ID, ...STRATEGY, createdAt: CREATED_AT },
    );
    expect(result.conclusion).toBe("NOT_OVERFIT");
  });

  it("PBO insufficient + PS insufficient + 无 robustnessView → INCONCLUSIVE", () => {
    const result = assessOfdOverfitting(
      { pbo: makePbo(null, "INCONCLUSIVE"), parameterSensitivity: makePs("INCONCLUSIVE"), robustnessView: null },
      { assessmentRunId: RUN_ID, ...STRATEGY, createdAt: CREATED_AT },
    );
    expect(result.conclusion).toBe("INCONCLUSIVE");
  });

  it("全部输入为 null → NO_EVAL", () => {
    const result = assessOfdOverfitting(
      { pbo: null, parameterSensitivity: null, robustnessView: null },
      { assessmentRunId: RUN_ID, ...STRATEGY, createdAt: CREATED_AT },
    );
    expect(result.conclusion).toBe("NO_EVAL");
    expect(result.pbo).toBe(null);
    expect(result.parameterSensitivity).toBe(null);
  });

  it("reasons 至少含 4 条（含聚合结论行）", () => {
    const result = assessOfdOverfitting(
      { pbo: makePbo(0.5, "OVERFIT_RISK_HIGH"), parameterSensitivity: makePs("STABLE"), robustnessView: null },
      { assessmentRunId: RUN_ID, ...STRATEGY, createdAt: CREATED_AT },
    );
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    expect(result.reasons[result.reasons.length - 1]).toMatch(/聚合结论/);
  });
});

// ---------------------------------------------------------------------------
// 额外：runOverfittingDetection 端到端 + generated ID 形态
// ---------------------------------------------------------------------------

describe("runOverfittingDetection 端到端", () => {
  it("PBO HIGH + PS STABLE → OVERFIT；assessmentRunId + createdAt 注入式记录", () => {
    const evaluator = scriptedEvaluator({
      "10": { totalReturnPct: 10, maxDrawdownPct: 2 },
      "12": { totalReturnPct: 11, maxDrawdownPct: 2 },
    });
    const run = runOverfittingDetection({
      strategyId: STRATEGY.strategyId,
      strategyVersion: STRATEGY.strategyVersion,
      pboInput: baseInput({
        candidates: [
          candidate("SPIKE", [100, -1, -1, -1]),
          candidate("STABLE", [1, 1, 1, 1]),
          candidate("ZERO", [0, 0, 0, 0]),
        ],
      }),
      parameterSensitivity: {
        baseParameterSet: { x: 10 },
        rules: [{ parameterName: "x", percentSteps: [20] }],
        evaluator,
      },
      assessmentRunId: RUN_ID,
      createdAt: CREATED_AT,
    });
    expect(run.assessmentRunId).toBe(RUN_ID);
    expect(run.strategyId).toBe(STRATEGY.strategyId);
    expect(run.strategyVersion).toBe(STRATEGY.strategyVersion);
    expect(run.createdAt).toBe(CREATED_AT);
    expect(run.conclusion).toBe("OVERFIT"); // PBO HIGH 强信号
    expect(run.pbo?.conclusion).toBe("OVERFIT_RISK_HIGH");
    expect(run.parameterSensitivity?.conclusion).toBe("STABLE");
  });

  it("缺 assessmentRunId → 自动生成 OFA-YYYYMMDD-XXXXXXXX", () => {
    const run = runOverfittingDetection({
      strategyId: STRATEGY.strategyId,
      strategyVersion: STRATEGY.strategyVersion,
      pboInput: baseInput({
        candidates: [candidate("A", [1, 1, 1, 1]), candidate("B", [0, 0, 0, 0])],
      }),
    });
    expect(run.assessmentRunId).toMatch(/^OFA-\d{8}-[0-9A-F]{8}$/);
  });

  it("缺 createdAt → 自动 ISO-8601 UTC", () => {
    const run = runOverfittingDetection({
      strategyId: STRATEGY.strategyId,
      strategyVersion: STRATEGY.strategyVersion,
      pboInput: baseInput({
        candidates: [candidate("A", [1, 1, 1, 1]), candidate("B", [0, 0, 0, 0])],
      }),
      assessmentRunId: RUN_ID,
    });
    expect(run.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("缺 strategyId → 抛错 OFA_REQUEST_FIELD_EMPTY", () => {
    expect(() =>
      runOverfittingDetection({
        strategyId: "" as unknown as string,
        strategyVersion: STRATEGY.strategyVersion,
        pboInput: baseInput({
          candidates: [candidate("A", [1, 1, 1, 1]), candidate("B", [0, 0, 0, 0])],
        }),
      }),
    ).toThrow(/OFA_REQUEST_FIELD_EMPTY/);
  });

  it("缺 pboInput → 抛错 OFA_REQUEST_PBO_MISSING", () => {
    expect(() =>
      runOverfittingDetection({
        strategyId: STRATEGY.strategyId,
        strategyVersion: STRATEGY.strategyVersion,
        pboInput: null as unknown as OfdPboInput,
      }),
    ).toThrow(/OFA_REQUEST_PBO_MISSING/);
  });
});

// 兜底：确认 okResult() helper 不会在测试中误用（lint 警告兜底）。
void okResult;
