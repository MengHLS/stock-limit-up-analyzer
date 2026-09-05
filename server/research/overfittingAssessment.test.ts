/**
 * STEP 6.5 — Overfitting Assessment 测试。
 *
 * 覆盖（§三十八 Assessment）：low / medium / high / insufficient_data、reasons、deterministic、
 * 不修改输入、OOS 不参与 Selection（由 degradation 方向公式覆盖）。
 */

import { describe, expect, it } from "vitest";
import {
  analyzeValidationOos,
  assessOverfitting,
  DEFAULT_OVERFITTING_THRESHOLDS,
} from "./overfittingAssessment";
import type { ParameterStabilityReport } from "./parameterStability";
import type { PboResult } from "./pbo";

function pbo(value: number): PboResult {
  return {
    numPartitions: 4,
    numCombinations: 3,
    evaluatedCombinations: 3,
    overfitCount: Math.round(value * 3),
    pbo: value,
    status: "computed",
    metric: "sharpeRatio",
    direction: "maximize",
    fingerprint: "fp-pbo",
    splitResults: [],
  };
}

const stability: ParameterStabilityReport = {
  windowCount: 3,
  parameters: [{ parameterName: "k", parameterType: "integer", windowValues: [1, 2, 3], uniqueValues: [1, 2, 3], frequency: { "1": 1, "2": 1, "3": 1 }, mostCommonValue: 1, mostCommonCount: 1, uniqueCount: 3, dispersion: 0.5 }],
};

describe("Validation → OOS Degradation（方向一致公式）", () => {
  it("maximize：degradation = validation - oos（OOS 更差 → 正）", () => {
    const analysis = analyzeValidationOos(
      [{ windowIndex: 0, validationValue: 2, oosMetricValue: 1 }],
      "sharpeRatio",
      "maximize",
    );
    expect(analysis.windows[0]!.degradation).toBe(1);
    expect(analysis.windows[0]!.relativeDegradation).toBe(0.5);
  });

  it("minimize：degradation = oos - validation（OOS 更差 → 正）", () => {
    const analysis = analyzeValidationOos(
      [{ windowIndex: 0, validationValue: 1, oosMetricValue: 2 }],
      "maxDrawdownPct",
      "minimize",
    );
    expect(analysis.windows[0]!.degradation).toBe(1);
    expect(analysis.windows[0]!.relativeDegradation).toBe(1);
  });

  it("OOS 更好 → degradation 为负", () => {
    const analysis = analyzeValidationOos(
      [{ windowIndex: 0, validationValue: 1, oosMetricValue: 2 }],
      "sharpeRatio",
      "maximize",
    );
    expect(analysis.windows[0]!.degradation).toBe(-1);
  });

  it("OOS 无指标（null）→ degradation 不可用，不参与均值", () => {
    const analysis = analyzeValidationOos(
      [
        { windowIndex: 0, validationValue: 2, oosMetricValue: 1 },
        { windowIndex: 1, validationValue: 2, oosMetricValue: null },
      ],
      "sharpeRatio",
      "maximize",
    );
    expect(analysis.evaluatedWindowCount).toBe(1);
    expect(analysis.averageDegradation).toBe(1);
  });
});

describe("Overfitting Assessment — 风险等级", () => {
  it("无任何证据 → insufficient_data", () => {
    const result = assessOverfitting({ pbo: null, parameterStability: null, validationOosAnalysis: null });
    expect(result.status).toBe("insufficient_data");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("PBO = 1.0 → high", () => {
    const result = assessOverfitting({ pbo: pbo(1.0), parameterStability: stability, validationOosAnalysis: null });
    expect(result.status).toBe("high");
  });

  it("PBO = 0.4 → medium", () => {
    const result = assessOverfitting({ pbo: pbo(0.4), parameterStability: null, validationOosAnalysis: null });
    expect(result.status).toBe("medium");
  });

  it("PBO = 0.1 → low", () => {
    const result = assessOverfitting({ pbo: pbo(0.1), parameterStability: null, validationOosAnalysis: null });
    expect(result.status).toBe("low");
  });

  it("明显 Validation → OOS 崩溃（relativeDegradation >= degradationHigh）→ high", () => {
    const analysis = analyzeValidationOos(
      [{ windowIndex: 0, validationValue: 1, oosMetricValue: -1 }],
      "sharpeRatio",
      "maximize",
    );
    expect(analysis.windows[0]!.relativeDegradation).toBe(2);
    const result = assessOverfitting({ pbo: null, parameterStability: null, validationOosAnalysis: analysis });
    expect(result.status).toBe("high");
  });

  it("中等退化 → medium", () => {
    const analysis = analyzeValidationOos(
      [{ windowIndex: 0, validationValue: 2, oosMetricValue: 1 }],
      "sharpeRatio",
      "maximize",
    );
    expect(analysis.windows[0]!.relativeDegradation).toBe(0.5);
    const result = assessOverfitting({ pbo: null, parameterStability: null, validationOosAnalysis: analysis });
    expect(result.status).toBe("medium");
  });

  it("自定义阈值生效", () => {
    const result = assessOverfitting({
      pbo: pbo(0.6),
      parameterStability: null,
      validationOosAnalysis: null,
      thresholds: { ...DEFAULT_OVERFITTING_THRESHOLDS, pboHigh: 0.9 },
    });
    expect(result.status).toBe("medium");
  });

  it("Parameter Stability 仅作为 evidence，不单独触发 high", () => {
    // 参数变化很大（dispersion 高），但无 PBO 证据、无退化证据 → 不得判 high。
    const highDispersion: ParameterStabilityReport = {
      windowCount: 4,
      parameters: [{
        parameterName: "k", parameterType: "integer", windowValues: [1, 2, 100, 200],
        uniqueValues: [1, 2, 100, 200], frequency: { "1": 1, "2": 1, "100": 1, "200": 1 },
        mostCommonValue: 1, mostCommonCount: 1, uniqueCount: 4, dispersion: 1.5,
      }],
    };
    const result = assessOverfitting({ pbo: null, parameterStability: highDispersion, validationOosAnalysis: null });
    expect(result.status).toBe("insufficient_data"); // 无 PBO/退化证据 → 不足以定级
  });
});

describe("Overfitting Assessment — 确定性 / 不修改输入", () => {
  it("相同输入 → 相同输出（deterministic）", () => {
    const a = assessOverfitting({ pbo: pbo(0.4), parameterStability: stability, validationOosAnalysis: null });
    const b = assessOverfitting({ pbo: pbo(0.4), parameterStability: stability, validationOosAnalysis: null });
    expect(a).toEqual(b);
  });

  it("不修改输入对象", () => {
    const p = pbo(0.4);
    const pboSnapshot = JSON.parse(JSON.stringify(p));
    const analysis = analyzeValidationOos([{ windowIndex: 0, validationValue: 2, oosMetricValue: 1 }], "sharpeRatio", "maximize");
    const analysisSnapshot = JSON.parse(JSON.stringify(analysis));
    assessOverfitting({ pbo: p, parameterStability: stability, validationOosAnalysis: analysis });
    expect(p).toEqual(pboSnapshot);
    expect(analysis).toEqual(analysisSnapshot);
  });
});
