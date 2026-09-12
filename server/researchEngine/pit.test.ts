/**
 * RESEARCH-002 — PIT 安全测试（**必须证明未来数据无法进入特征**）。
 *
 * 三层证明：
 *   1. **命名层**：把结果变量名当特征用 → `resolveFeature` 抛 `VARIABLE_ROLE_VIOLATION`；
 *   2. **装配层**：`buildSampleSet` 申请 `future_return_5d` 作为 FEATURE → 同样抛错（不会静默返回 null）；
 *   3. **数据层**：把 Dataset 中**所有未来数据**（path / outcome）清空后，特征值仍能完整求出 ——
 *      这直接证明特征解析路径**不依赖任何 > T 的数据**（不是靠「记得别写错」）。
 */

import { describe, expect, it } from "vitest";
import { ResearchVariableCatalog } from "./variables";
import { ResearchEngineError } from "./errors";
import { buildSampleSet } from "./sampleSet";
import { buildSyntheticDataset } from "./testFixtures";

const catalog = new ResearchVariableCatalog([5, 10, 20], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

describe("PIT 安全", () => {
  it("命名层：结果变量不能当特征（具名拒绝，不静默 null）", () => {
    for (const outcomeName of ["future_return_5d", "max_return_5d", "max_drawdown_5d"]) {
      try {
        catalog.resolveFeature(outcomeName);
        throw new Error(`应当拒绝 ${outcomeName}`);
      } catch (e) {
        expect(e).toBeInstanceOf(ResearchEngineError);
        expect((e as ResearchEngineError).code).toBe("VARIABLE_ROLE_VIOLATION");
      }
    }
  });

  it("命名层：特征变量不能当结果（反向也拒绝）", () => {
    try {
      catalog.resolveOutcome("turnover");
      throw new Error("应当拒绝 turnover 作为结果变量");
    } catch (e) {
      expect((e as ResearchEngineError).code).toBe("VARIABLE_ROLE_VIOLATION");
    }
  });

  it("装配层：把 T+5 收益当特征申请 → VARIABLE_ROLE_VIOLATION", async () => {
    const ds = buildSyntheticDataset({
      events: [{ index: 0, turnover: 3, futureReturn: () => 0.02 }],
      horizons: [5],
      maxPathDay: 5,
    });
    await expect(
      buildSampleSet({
        reader: ds.reader,
        datasetVersionId: ds.datasetVersionId,
        catalog,
        requirement: { features: ["future_return_5d"], outcomes: [] },
      }),
    ).rejects.toMatchObject({ code: "VARIABLE_ROLE_VIOLATION" });
  });

  it("数据层：清空全部未来数据后，特征仍可完整解析（特征不依赖 > T 数据）", async () => {
    const ds = buildSyntheticDataset({
      events: [
        { index: 0, turnover: 3.5, futureReturn: () => 0.02 },
        { index: 1, turnover: 8.25, futureReturn: () => -0.03 },
      ],
      horizons: [5],
      maxPathDay: 5,
    });
    // 彻底移除未来数据：path / outcome 清空 → outcome 变量应全为 null
    const stripped = buildSyntheticDataset({
      events: [
        { index: 0, turnover: 3.5, futureReturn: () => null },
        { index: 1, turnover: 8.25, futureReturn: () => null },
      ],
      horizons: [5],
      maxPathDay: 5,
    });

    const featureNames = ["turnover", "previous_close", "limit_up_price", "limit_up_premium", "pre_return_5d"];
    const withFuture = await buildSampleSet({
      reader: ds.reader,
      datasetVersionId: ds.datasetVersionId,
      catalog,
      requirement: { features: featureNames, outcomes: ["future_return_5d"] },
      dimensionKeys: ["year", "board"],
    });
    const withoutFuture = await buildSampleSet({
      reader: stripped.reader,
      datasetVersionId: stripped.datasetVersionId,
      catalog,
      requirement: { features: featureNames, outcomes: ["future_return_5d"] },
      dimensionKeys: ["year", "board"],
    });

    // 特征与维度逐字节一致 → 特征不读取任何未来数据
    expect(withoutFuture.samples.map((s) => ({ f: s.features, d: s.dimensions }))).toEqual(
      withFuture.samples.map((s) => ({ f: s.features, d: s.dimensions })),
    );
    // 而结果变量此时确实全为 null（说明「清空」是生效的，不是没生效的假阴性）
    expect(withoutFuture.samples.every((s) => s.outcomes.future_return_5d === null)).toBe(true);
    expect(withFuture.samples.some((s) => s.outcomes.future_return_5d !== null)).toBe(true);
  });

  it("装配层：只加载被申请的变量（未申请的结果列不进内存）", async () => {
    const ds = buildSyntheticDataset({
      events: [{ index: 0, turnover: 3, futureReturn: () => 0.02 }],
      horizons: [5, 10],
      maxPathDay: 10,
    });
    const set = await buildSampleSet({
      reader: ds.reader,
      datasetVersionId: ds.datasetVersionId,
      catalog,
      requirement: { features: ["turnover"], outcomes: ["future_return_5d"] },
    });
    const sample = set.samples[0]!;
    expect(Object.keys(sample.features)).toEqual(["turnover"]);
    expect(Object.keys(sample.outcomes)).toEqual(["future_return_5d"]);
    // 未申请的 prefix 数据 → 不读取 prefix（loadPrefixBars 不被调用）
    expect(ds.reader.callLog.some((c) => c.method === "loadPrefixBars")).toBe(false);
  });
});
