import { describe, expect, it } from "vitest";
import { validateStrategyDocument } from "../../../server/research/strategySchema";
import { resolveStrategyRecipeById } from "../../../server/research/recipeRegistry";
import {
  buildThreeFactorTopNStrategyDocument,
  THREE_FACTOR_TOPN_POSITION_RATIO,
  THREE_FACTOR_TOPN_STRATEGY_VERSION,
} from "../../../server/research/patternLibrary/threeFactorTopNStrategy";
import {
  THREE_FACTOR_TOPN_MAX_HOLDING_DAYS,
  THREE_FACTOR_TOPN_STOP_LOSS_RATIO,
} from "../../../server/research/patternLibrary/patterns/firstLimitPullback3FTopN";
import { mapDeclaredExitPolicy } from "../../../server/runWorkbenchAssembly/exitPolicy";
import { mapDeclaredPositionSizing } from "../../../server/runWorkbenchAssembly/assemble";

describe("3F TopN StrategyDocument 装配", () => {
  it.each([3, 5])("Top%i：文档合法、坐标绑定 v5、执行面来自已注册配方", (topN) => {
    const document = buildThreeFactorTopNStrategyDocument({
      topN,
      datasetVersionId: 660001,
      datasetLabel: "v5",
    });
    const validation = validateStrategyDocument(document);
    expect(validation.valid, validation.issues.map(issue => `${issue.code}:${issue.path}`).join(" | ")).toBe(true);

    expect(document.strategyId).toBe(`first-limit-pullback-3f-top${topN}`);
    expect(document.version).toBe(THREE_FACTOR_TOPN_STRATEGY_VERSION);
    expect(document.datasetVersion).toBe("v5");
    expect(document.datasetVersionId).toBe(660001);
    expect(document.definition?.datasets).toEqual([
      expect.objectContaining({
        datasetId: "first_limit_pullback",
        datasetVersion: "v5",
        datasetVersionId: 660001,
        role: "PRIMARY",
      }),
    ]);
    expect(document.definition?.entry.observationWindow).toEqual({
      start: 5,
      end: 15,
      unit: "TRADING_DAY",
    });
    expect(document.definition?.position.maxPositions).toBe(5);
    expect(document.definition?.position).toMatchObject({
      sizingMethod: "FIXED_RATIO",
      positionRatio: THREE_FACTOR_TOPN_POSITION_RATIO,
      maxPositions: 5,
      maxSinglePosition: THREE_FACTOR_TOPN_POSITION_RATIO,
    });
    expect(document.positionSizing).toEqual({
      kind: "fixed-fraction",
      fraction: THREE_FACTOR_TOPN_POSITION_RATIO,
      maxPositions: 5,
    });
    expect(mapDeclaredPositionSizing(document.positionSizing)).toEqual({
      sizingMethod: "FIXED_FRACTION",
      fraction: THREE_FACTOR_TOPN_POSITION_RATIO,
      fixedAmount: null,
    });
    expect(document.executionAssumptions?.backtestConfig).toEqual({
      initialCapital: 100_000,
      maxPositions: 5,
      maxDailyBuys: topN === 3 ? 2 : 3,
    });
    expect(document.definition?.exit.rules).toEqual([
      expect.objectContaining({
        id: "exit-stop-loss",
        type: "STOP_LOSS",
        trigger: "INTRADAY",
        threshold: THREE_FACTOR_TOPN_STOP_LOSS_RATIO,
        thresholdUnit: "RATIO",
        priority: 1,
        enabled: true,
      }),
      expect.objectContaining({
        id: "exit-time-exit",
        type: "TIME_EXIT",
        trigger: "ON_CLOSE",
        threshold: THREE_FACTOR_TOPN_MAX_HOLDING_DAYS,
        thresholdUnit: "TRADING_DAY",
        priority: 2,
        enabled: true,
      }),
    ]);
    expect(mapDeclaredExitPolicy(document.definition?.exit.rules, {})).toEqual({
      stopLossRatio: THREE_FACTOR_TOPN_STOP_LOSS_RATIO,
      takeProfitRatio: null,
      maxHoldingDays: THREE_FACTOR_TOPN_MAX_HOLDING_DAYS,
    });

    const runtime = resolveStrategyRecipeById(document.strategyId);
    expect(document.recipe?.recipeId).toBe(runtime.recipeId);
    expect(document.recipe?.selectionConfig.method).toEqual({ kind: "topN", n: topN });
    expect(document.recipe?.featureVersions).toEqual(
      runtime.features
        .map(feature => ({ featureId: feature.featureId, version: feature.version }))
        .sort((left, right) => left.featureId.localeCompare(right.featureId)),
    );
  });

  it("支持仅用于探针 A/B 的显式窗口和容量覆盖", () => {
    const document = buildThreeFactorTopNStrategyDocument({
      topN: 5,
      datasetVersionId: 660001,
      datasetLabel: "v5",
      observationWindow: { start: 5, end: 9, unit: "TRADING_DAY" },
      maxPositions: 7,
      maxDailyBuys: 4,
    });
    expect(document.definition?.entry.observationWindow.end).toBe(9);
    expect(document.definition?.position.maxPositions).toBe(7);
    expect(document.executionAssumptions?.backtestConfig.maxDailyBuys).toBe(4);
  });
});
