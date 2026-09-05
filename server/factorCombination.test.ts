import { describe, expect, it } from "vitest";
import {
  buildFactorCorrelationMatrix,
  buildFactorClusters,
  buildFactorNeutralizationReport,
  buildSpearmanCorrelationMatrix,
  buildVif,
  deduplicateFactors,
  effectiveNumberOfFactors,
  extractFactorValueMatrix,
  pearsonCorrelation,
  quantileRank,
  residualize,
  spearmanCorrelation,
  zScore,
} from "./factorCombination";
import type { FactorCorrelationMatrix } from "./factorCombination";
import type { CombinationFactorKey } from "./factorCombination";
import type { LeaderCandidateBacktestRow } from "./leaderCandidates";

function makeRow(overrides: Partial<LeaderCandidateBacktestRow> = {}): LeaderCandidateBacktestRow {
  return {
    stockCode: "600001.SH",
    stockName: "测试股",
    sector: "题材",
    boards: 2,
    score: 60,
    circulationValue: "50",
    marketCapScore: 12,
    date: "2026-08-18",
    nextDate: "2026-08-19",
    nextDayDate: "2026-08-19",
    secondDayDate: "2026-08-20",
    success: false,
    signalClosePrice: 10,
    nextOpenPrice: 10.5,
    nextClosePrice: 11,
    nextOpenPremium: 5,
    nextClosePremium: 10,
    secondDayOpenPrice: 11,
    secondDayClosePrice: 11.5,
    secondDayOpenPremium: 10,
    secondDayClosePremium: 15,
    tPlus1CloseToTPlus2CloseReturn: 4.55,
    tPlus1CloseToTPlus2CloseSuccess: true,
    ...overrides,
  };
}

describe("pearsonCorrelation", () => {
  it("完全正相关为 1，完全负相关为 -1", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 6);
    expect(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 6);
  });
  it("缺失样本被跳过", () => {
    expect(pearsonCorrelation([1, null, 3, 4], [2, 99, 6, 8])).toBeCloseTo(1, 6);
  });
  it("样本不足或变差为零返回 null", () => {
    expect(pearsonCorrelation([1, 2], [3, 4])).toBeNull();
    expect(pearsonCorrelation([5, 5, 5], [1, 2, 3])).toBeNull();
  });
});

describe("extractFactorValueMatrix + 相关性矩阵", () => {
  it("提取技术因子与候选因子，并正确计算相关性", () => {
    const rows = [
      makeRow({ stockCode: "600010.SH", boards: 1, sectorCount: 2, technicalFactors: { turnoverRate: 1, volumeRatio: 2, amplitude: 3 } }),
      makeRow({ stockCode: "600011.SH", boards: 2, sectorCount: 4, technicalFactors: { turnoverRate: 2, volumeRatio: 4, amplitude: 6 } }),
      makeRow({ stockCode: "600012.SH", boards: 3, sectorCount: 6, technicalFactors: { turnoverRate: 3, volumeRatio: 6, amplitude: 9 } }),
      makeRow({ stockCode: "600013.SH", boards: 4, sectorCount: 8, technicalFactors: { turnoverRate: 4, volumeRatio: 8, amplitude: 12 } }),
    ];
    const matrix = extractFactorValueMatrix(rows);
    expect(matrix.values.turnoverRate).toEqual([1, 2, 3, 4]);
    expect(matrix.values.boards).toEqual([1, 2, 3, 4]);

    const correlation = buildFactorCorrelationMatrix(matrix);
    const idx = (key: string) => correlation.keys.indexOf(key as never);
    expect(correlation.matrix[idx("turnoverRate")]![idx("boards")]).toBeCloseTo(1, 6);
  });
});

describe("deduplicateFactors", () => {
  it("高度相关因子按优先级保留，冗余被移除", () => {
    // 构造：turnoverRate 与 volumeRatio 完全相关（|ρ|=1），boards 独立
    const rows = [
      makeRow({ stockCode: "600010.SH", boards: 4, technicalFactors: { turnoverRate: 1, volumeRatio: 2, amplitude: 5 } }),
      makeRow({ stockCode: "600011.SH", boards: 1, technicalFactors: { turnoverRate: 2, volumeRatio: 4, amplitude: 7 } }),
      makeRow({ stockCode: "600012.SH", boards: 3, technicalFactors: { turnoverRate: 3, volumeRatio: 6, amplitude: 9 } }),
      makeRow({ stockCode: "600013.SH", boards: 2, technicalFactors: { turnoverRate: 4, volumeRatio: 8, amplitude: 11 } }),
    ];
    const matrix = extractFactorValueMatrix(rows);
    const correlation = buildFactorCorrelationMatrix(matrix);
    const kept = deduplicateFactors(correlation, 0.7, ["turnoverRate", "volumeRatio", "boards"]);
    // turnoverRate 优先保留，volumeRatio 与其相关被移除；boards 独立保留
    expect(kept).toContain("turnoverRate");
    expect(kept).toContain("boards");
    expect(kept).not.toContain("volumeRatio");
  });
});

describe("zScore / quantileRank / residualize", () => {
  it("z-score 标准化均值 0 标准差 1，缺失保持 null", () => {
    const result = zScore([2, 4, 6, 8, null]);
    expect(result[4]).toBeNull();
    const present = result.slice(0, 4) as number[];
    const meanValue = present.reduce((sum, value) => sum + value, 0) / present.length;
    expect(meanValue).toBeCloseTo(0, 6);
  });
  it("分位归一化到 0~1 区间", () => {
    const result = quantileRank([1, 2, 3, 4]);
    expect(result[0]).toBe(0);
    expect(result[3]).toBe(1);
  });
  it("residualize 移除线性暴露，残差与暴露不相关", () => {
    // value = 2 * exposure + 3，中性化后残差应接近 0（线性关系被移除）
    const exposure = [1, 2, 3, 4, 5];
    const values = exposure.map((value) => 2 * value + 3);
    const residuals = residualize(values, exposure) as number[];
    residuals.forEach((value) => expect(value).toBeCloseTo(0, 6));
  });
});

describe("buildFactorNeutralizationReport", () => {
  it("输出相关性矩阵、去重建议与中性化因子", () => {
    const rows = [
      makeRow({ stockCode: "600010.SH", boards: 4, marketCapScore: 4, technicalFactors: { turnoverRate: 1, volumeRatio: 2, amplitude: 3 } }),
      makeRow({ stockCode: "600011.SH", boards: 1, marketCapScore: 10, technicalFactors: { turnoverRate: 2, volumeRatio: 4, amplitude: 6 } }),
      makeRow({ stockCode: "600012.SH", boards: 3, marketCapScore: 12, technicalFactors: { turnoverRate: 3, volumeRatio: 6, amplitude: 9 } }),
      makeRow({ stockCode: "600013.SH", boards: 2, marketCapScore: 16, technicalFactors: { turnoverRate: 4, volumeRatio: 8, amplitude: 12 } }),
    ];
    const report = buildFactorNeutralizationReport(rows);
    expect(report.correlationMatrix.keys.length).toBeGreaterThan(0);
    expect(report.deduplicatedKeys).toContain("boards");
    expect(report.neutralizedTechnicalFactors.turnoverRate).toBeDefined();
    expect(report.spearmanMatrix.keys.length).toBe(report.correlationMatrix.keys.length);
    expect(report.effectiveNumber).not.toBeNull();
    expect(report.clusters.length).toBeGreaterThan(0);
    expect(report.neutralizationIc.length).toBe(3);
  });
});

describe("spearmanCorrelation + Spearman 矩阵", () => {
  it("单调非线性关系 Spearman=1，而 Pearson<1", () => {
    // 指数关系：完全单调但非线性，Spearman 秩相关应为 1。
    const x = [1, 2, 3, 4, 5];
    const y = x.map((value) => value ** 2);
    expect(spearmanCorrelation(x, y)).toBeCloseTo(1, 6);
    expect(pearsonCorrelation(x, y)!).toBeLessThan(1);
  });
  it("Spearman 相关矩阵与 Pearson 矩阵同形状", () => {
    const rows = [
      makeRow({ stockCode: "600010.SH", boards: 1, sectorCount: 2, technicalFactors: { turnoverRate: 1, volumeRatio: 2, amplitude: 3 } }),
      makeRow({ stockCode: "600011.SH", boards: 2, sectorCount: 4, technicalFactors: { turnoverRate: 2, volumeRatio: 4, amplitude: 6 } }),
      makeRow({ stockCode: "600012.SH", boards: 3, sectorCount: 6, technicalFactors: { turnoverRate: 3, volumeRatio: 6, amplitude: 9 } }),
      makeRow({ stockCode: "600013.SH", boards: 4, sectorCount: 8, technicalFactors: { turnoverRate: 4, volumeRatio: 8, amplitude: 12 } }),
    ];
    const matrix = extractFactorValueMatrix(rows);
    const spearmanMatrix = buildSpearmanCorrelationMatrix(matrix);
    const idx = (key: string) => spearmanMatrix.keys.indexOf(key as never);
    expect(spearmanMatrix.matrix[idx("turnoverRate")]![idx("boards")]).toBeCloseTo(1, 6);
  });
});

describe("buildVif", () => {
  it("高度相关因子 VIF 远大于 1，独立因子 VIF≈1", () => {
    const keys: CombinationFactorKey[] = ["turnoverRate", "volumeRatio", "boards"];
    const correlation: FactorCorrelationMatrix = {
      keys,
      labels: { turnoverRate: "换手率", volumeRatio: "量比", boards: "连板高度" } as FactorCorrelationMatrix["labels"],
      matrix: [
        [1, 0.99, 0],
        [0.99, 1, 0],
        [0, 0, 1],
      ],
    };
    const vif = buildVif(correlation);
    expect(vif.turnoverRate!).toBeGreaterThan(5);
    expect(vif.volumeRatio!).toBeGreaterThan(5);
    expect(vif.boards!).toBeCloseTo(1, 2);
  });
  it("奇异矩阵返回全 null", () => {
    const keys: CombinationFactorKey[] = ["turnoverRate", "volumeRatio"];
    const correlation: FactorCorrelationMatrix = {
      keys,
      labels: { turnoverRate: "换手率", volumeRatio: "量比" } as FactorCorrelationMatrix["labels"],
      matrix: [[1, 1], [1, 1]],
    };
    const vif = buildVif(correlation);
    expect(vif.turnoverRate).toBeNull();
    expect(vif.volumeRatio).toBeNull();
  });
});

describe("effectiveNumberOfFactors", () => {
  it("完全独立 → EN=因子数；完全相关 → EN=1", () => {
    const keys: CombinationFactorKey[] = ["turnoverRate", "volumeRatio", "boards"];
    const labels = { turnoverRate: "a", volumeRatio: "b", boards: "c" } as FactorCorrelationMatrix["labels"];
    const independent: FactorCorrelationMatrix = { keys, labels, matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
    const collinear: FactorCorrelationMatrix = { keys, labels, matrix: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] };
    expect(effectiveNumberOfFactors(independent)).toBeCloseTo(3, 3);
    expect(effectiveNumberOfFactors(collinear)).toBeCloseTo(1, 3);
  });
});

describe("buildFactorClusters", () => {
  it("同簇内高度相关的因子被标记为冗余", () => {
    const keys: CombinationFactorKey[] = ["boards", "sectorCount", "marketCapScore"];
    const correlation: FactorCorrelationMatrix = {
      keys,
      labels: { boards: "连板高度", sectorCount: "题材支撑", marketCapScore: "流通市值评分" } as FactorCorrelationMatrix["labels"],
      matrix: [
        [1, 0.9, 0],
        [0.9, 1, 0],
        [0, 0, 1],
      ],
    };
    const clusters = buildFactorClusters(correlation);
    const sentiment = clusters.find((cluster) => cluster.cluster === "Sentiment")!;
    expect(sentiment.keys).toEqual(expect.arrayContaining(["boards", "sectorCount"]));
    expect(sentiment.redundant).toBe(true);
    const size = clusters.find((cluster) => cluster.cluster === "Size")!;
    expect(size.redundant).toBe(false);
  });
});
