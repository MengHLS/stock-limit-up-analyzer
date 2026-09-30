import { describe, expect, it } from "vitest";
import { validateStrategyDocument } from "../../../server/research/strategySchema";
import {
  ROLLING_POOL_FAMILY_ID,
  materializeStrategyFamily,
} from "../../../server/research/strategyFamilyRegistry";

describe("strategy family registry", () => {
  it("物化滚动池族并继承 v1.62.1 配置", () => {
    const document = materializeStrategyFamily({
      familyId: ROLLING_POOL_FAMILY_ID,
      strategyId: "first-limit-pool-rolling-3f-top3",
      version: "1.0.0",
      name: "首板股票池 · 滚动 3F Top3",
      datasetVersionId: 660001,
      datasetLabel: "v5",
      parameters: {
        topN: 3,
        maxPositions: 5,
        maxDailyBuys: 2,
        poolAgeCapTradingDays: 60,
        minimumScore: 0.55,
        maxObservationAmplitude: 0.14,
        scoreInvalidationDays: 3,
      },
    });

    const validation = validateStrategyDocument(document);
    expect(validation.valid, validation.issues.map(item => item.code).join(",")).toBe(true);
    expect(document.recipe?.recipeId).toBe("first-limit-pool-rolling-3f");
    expect(document.definition?.position.positionTiers?.[2]).toEqual({
      minScore: 0.7167,
      fraction: 0.25,
    });
    expect(document.definition?.firstLimitPool?.scorePolicy).toBe("ROLLING_THREE_FACTOR");
  });

  it("拒绝未知参数与越界值", () => {
    const base = {
      familyId: ROLLING_POOL_FAMILY_ID,
      strategyId: "pool-test",
      version: "1.0.0",
      name: "pool-test",
      datasetVersionId: 660001,
      datasetLabel: "v5",
    } as const;
    expect(() => materializeStrategyFamily({
      ...base,
      parameters: { unknown: 1 },
    })).toThrow("不认识参数");
    expect(() => materializeStrategyFamily({
      ...base,
      parameters: { minimumScore: 2 },
    })).toThrow("不得大于");
  });
});
