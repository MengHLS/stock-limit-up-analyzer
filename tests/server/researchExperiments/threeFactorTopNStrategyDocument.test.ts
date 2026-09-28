import { describe, expect, it } from "vitest";
import { validateStrategyDocument } from "../../../server/research/strategySchema";
import { resolveStrategyRecipeById } from "../../../server/research/recipeRegistry";
import {
  buildThreeFactorTopNStrategyDocument,
  THREE_FACTOR_TOPN_COST_MODEL,
  THREE_FACTOR_TOPN_EXCLUDE_OPEN_LIMIT_STRATEGY_VERSION,
  THREE_FACTOR_TOPN_INTRADAY_TRAILING_STRATEGY_VERSION,
  THREE_FACTOR_TOPN_NO_PULLBACK_GATE_STRATEGY_VERSION,
  THREE_FACTOR_TOPN_POSITION_RATIO,
  THREE_FACTOR_TOPN_STRATEGY_VERSION,
} from "../../../server/research/patternLibrary/threeFactorTopNStrategy";
import {
  THREE_FACTOR_TOPN_MAX_HOLDING_DAYS,
  THREE_FACTOR_TOPN_STOP_LOSS_RATIO,
  THREE_FACTOR_TOPN_TRAILING_TAKE_PROFIT_DRAWDOWN_RATIO,
} from "../../../server/research/patternLibrary/patterns/firstLimitPullback3FTopN";
import { mapDeclaredExitPolicy } from "../../../server/runWorkbenchAssembly/exitPolicy";
import { mapDeclaredPositionSizing } from "../../../server/runWorkbenchAssembly/assemble";
import { coreVersionFromDocument } from "../../../server/strategyCore/production/versionFromDocument";

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
      sizingMethod: "EQUITY_RATIO",
      positionRatio: THREE_FACTOR_TOPN_POSITION_RATIO,
      maxPositions: 5,
      maxSinglePosition: THREE_FACTOR_TOPN_POSITION_RATIO,
    });
    expect(document.positionSizing).toEqual({
      kind: "equity-fraction",
      fraction: THREE_FACTOR_TOPN_POSITION_RATIO,
      maxPositions: 5,
    });
    expect(mapDeclaredPositionSizing(document.positionSizing)).toEqual({
      sizingMethod: "EQUITY_FRACTION",
      fraction: THREE_FACTOR_TOPN_POSITION_RATIO,
      fixedAmount: null,
    });
    expect(document.executionAssumptions?.backtestConfig).toEqual({
      initialCapital: 100_000,
      maxPositions: 5,
      maxDailyBuys: topN === 3 ? 2 : 3,
    });
    expect(document.executionAssumptions?.costModel).toEqual(
      THREE_FACTOR_TOPN_COST_MODEL,
    );
    expect(
      2 * THREE_FACTOR_TOPN_COST_MODEL.commissionRate * 10_000
        + THREE_FACTOR_TOPN_COST_MODEL.stampDutyRate * 10_000
        + 2 * THREE_FACTOR_TOPN_COST_MODEL.transferFeeRate * 10_000
        + 2 * THREE_FACTOR_TOPN_COST_MODEL.slippageBps,
    ).toBeCloseTo(20.2, 8);
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
        id: "exit-trailing-take-profit",
        type: "TRAILING_TAKE_PROFIT",
        trigger: "ON_CLOSE",
        threshold: THREE_FACTOR_TOPN_TRAILING_TAKE_PROFIT_DRAWDOWN_RATIO,
        thresholdUnit: "RATIO",
        priority: 2,
        enabled: true,
      }),
      expect.objectContaining({
        id: "exit-time-exit",
        type: "TIME_EXIT",
        trigger: "ON_CLOSE",
        threshold: THREE_FACTOR_TOPN_MAX_HOLDING_DAYS,
        thresholdUnit: "TRADING_DAY",
        priority: 3,
        enabled: true,
      }),
    ]);
    expect(document.definition?.exit.candidateExitPolicy).toBe("DISABLED");
    expect(mapDeclaredExitPolicy(document.definition?.exit.rules, {})).toEqual({
      stopLossRatio: THREE_FACTOR_TOPN_STOP_LOSS_RATIO,
      takeProfitRatio: null,
      maxHoldingDays: THREE_FACTOR_TOPN_MAX_HOLDING_DAYS,
      trailingTakeProfitActivationRatio: 0,
      trailingTakeProfitDrawdownRatio: THREE_FACTOR_TOPN_TRAILING_TAKE_PROFIT_DRAWDOWN_RATIO,
      trailingTakeProfitTrigger: "ON_CLOSE",
      advancedTrailingPolicy: null,
      advancedStopPolicy: null,
      strongHold: null,
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

  it("maxHoldingDays=null 时删除 TIME_EXIT，但保留止损与回撤止盈", () => {
    const document = buildThreeFactorTopNStrategyDocument({
      topN: 3,
      datasetVersionId: 660001,
      datasetLabel: "v5",
      observationWindow: { start: 5, end: 17, unit: "TRADING_DAY" },
      maxHoldingDays: null,
    });
    expect(document.definition?.exit.rules.map(rule => rule.type)).toEqual([
      "STOP_LOSS",
      "TRAILING_TAKE_PROFIT",
    ]);
    expect(mapDeclaredExitPolicy(document.definition?.exit.rules, {})).toEqual({
      stopLossRatio: THREE_FACTOR_TOPN_STOP_LOSS_RATIO,
      takeProfitRatio: null,
      maxHoldingDays: null,
      trailingTakeProfitActivationRatio: 0,
      trailingTakeProfitDrawdownRatio: THREE_FACTOR_TOPN_TRAILING_TAKE_PROFIT_DRAWDOWN_RATIO,
      trailingTakeProfitTrigger: "ON_CLOSE",
      advancedTrailingPolicy: null,
      advancedStopPolicy: null,
      strongHold: null,
    });
  });

  it("stopLossRatio 可显式覆盖，其余正式条件保持不变", () => {
    const document = buildThreeFactorTopNStrategyDocument({
      topN: 3,
      datasetVersionId: 660001,
      datasetLabel: "v5",
      stopLossRatio: 0.08,
    });
    const stop = document.definition?.exit.rules.find(
      rule => rule.type === "STOP_LOSS",
    );
    expect(stop?.threshold).toBe(0.08);
    expect(document.definition?.entry.observationWindow.end).toBe(15);
    expect(document.definition?.exit.rules.map(rule => rule.type)).toEqual([
      "STOP_LOSS",
      "TRAILING_TAKE_PROFIT",
      "TIME_EXIT",
    ]);
  });

  it("strongHold 在第5日强势时延长到第10个持有日", () => {
    const strongHold = {
      atHoldingDays: 5,
      minReturnRatio: 0.03,
      requireAboveMa5: true,
      requireAboveMa10: true,
      extendToHoldingDays: 10,
    } as const;
    const document = buildThreeFactorTopNStrategyDocument({
      topN: 3,
      datasetVersionId: 660001,
      datasetLabel: "v5",
      stopLossRatio: 0.06,
      strongHold,
    });
    expect(document.definition?.exit.strongHold).toEqual(strongHold);
    expect(
      mapDeclaredExitPolicy(
        document.definition?.exit.rules,
        {},
        document.definition?.exit.strongHold,
      )?.strongHold,
    ).toEqual(strongHold);
  });

  it("高级 trailingPolicy 通过文档校验并进入可执行退出政策", () => {
    const document = buildThreeFactorTopNStrategyDocument({
      topN: 3,
      datasetVersionId: 660001,
      datasetLabel: "v5",
      strategyVersion: "1.14.0",
      stopLossRatio: 0.06,
      strongHold: {
        atHoldingDays: 5,
        minReturnRatio: 0.03,
        requireAboveMa5: true,
        requireAboveMa10: true,
        extendToHoldingDays: 10,
      },
      trailingPolicy: {
        kind: "MA_CROSS",
        fastWindow: 5,
        slowWindow: 10,
        activationRatio: 0,
      },
    });
    const validation = validateStrategyDocument(document);
    expect(
      validation.valid,
      validation.issues.map(issue => `${issue.code}:${issue.path}`).join(" | "),
    ).toBe(true);
    expect(mapDeclaredExitPolicy(
      document.definition?.exit.rules,
      {},
      document.definition?.exit.strongHold,
    )).toMatchObject({
      advancedTrailingPolicy: {
        kind: "MA_CROSS",
        fastWindow: 5,
        slowWindow: 10,
        activationRatio: 0,
      },
      stopLossRatio: 0.06,
    });
  });

  it("1.11.0 在事件层排除 T 日一字板与 T 字板", () => {
    const strongHold = {
      atHoldingDays: 5,
      minReturnRatio: 0.03,
      requireAboveMa5: true,
      requireAboveMa10: true,
      extendToHoldingDays: 10,
    } as const;
    const document = buildThreeFactorTopNStrategyDocument({
      topN: 3,
      datasetVersionId: 660001,
      datasetLabel: "v5",
      strategyVersion: THREE_FACTOR_TOPN_EXCLUDE_OPEN_LIMIT_STRATEGY_VERSION,
      stopLossRatio: 0.06,
      strongHold,
      excludeEventDayOpenAtLimit: true,
    });
    const validation = validateStrategyDocument(document);
    expect(
      validation.valid,
      validation.issues.map(issue => `${issue.code}:${issue.path}`).join(" | "),
    ).toBe(true);
    expect(document.version).toBe("1.11.0");
    expect(document.definition?.entry.conditions).toEqual([
      expect.objectContaining({
        id: "entry-exclude-one-word-and-t-word",
        field: "prefix.rd0.open",
        operator: "LESS_THAN",
        value: "prefix.rd0.high",
        valueType: "FIELD_REFERENCE",
        enabled: true,
      }),
      expect.objectContaining({
        id: "entry-sentinel-window",
        field: "bar.close",
      }),
    ]);
    expect(document.definition?.exit.strongHold).toEqual(strongHold);
    const core = coreVersionFromDocument({
      document,
      createdAt: "2026-09-27T00:00:00.000Z",
    });
    expect(core.ok, core.ok ? "" : `${core.reason}: ${core.detail}`).toBe(true);
  });

  it("1.12.0 将盈利回撤止盈改为盘中检查", () => {
    const document = buildThreeFactorTopNStrategyDocument({
      topN: 3,
      datasetVersionId: 660001,
      datasetLabel: "v5",
      strategyVersion: THREE_FACTOR_TOPN_INTRADAY_TRAILING_STRATEGY_VERSION,
      stopLossRatio: 0.06,
      strongHold: {
        atHoldingDays: 5,
        minReturnRatio: 0.03,
        requireAboveMa5: true,
        requireAboveMa10: true,
        extendToHoldingDays: 10,
      },
      excludeEventDayOpenAtLimit: true,
      trailingTakeProfitTrigger: "INTRADAY",
    });
    const trailing = document.definition?.exit.rules.find(
      rule => rule.type === "TRAILING_TAKE_PROFIT",
    );
    expect(document.version).toBe("1.12.0");
    expect(trailing?.trigger).toBe("INTRADAY");
    expect(mapDeclaredExitPolicy(document.definition?.exit.rules, {})).toMatchObject({
      trailingTakeProfitDrawdownRatio:
        THREE_FACTOR_TOPN_TRAILING_TAKE_PROFIT_DRAWDOWN_RATIO,
      trailingTakeProfitTrigger: "INTRADAY",
    });
  });

  it("1.13.0 使用无回踩门槛的 3F 特征变体，并保留盘中回撤止盈", () => {
    const document = buildThreeFactorTopNStrategyDocument({
      topN: 3,
      datasetVersionId: 660001,
      datasetLabel: "v5",
      strategyVersion: THREE_FACTOR_TOPN_NO_PULLBACK_GATE_STRATEGY_VERSION,
      stopLossRatio: 0.06,
      strongHold: {
        atHoldingDays: 5,
        minReturnRatio: 0.03,
        requireAboveMa5: true,
        requireAboveMa10: true,
        extendToHoldingDays: 10,
      },
      excludeEventDayOpenAtLimit: true,
      trailingTakeProfitTrigger: "INTRADAY",
      requirePullback: false,
    });
    const validation = validateStrategyDocument(document);
    expect(
      validation.valid,
      validation.issues.map(issue => `${issue.code}:${issue.path}`).join(" | "),
    ).toBe(true);
    expect(document.version).toBe("1.13.0");
    expect(document.recipe?.recipeId).toBe(
      "first-limit-pullback-3f-top3-no-pullback-gate",
    );
    expect(document.recipe?.featureVersions).toEqual([
      {
        featureId: "threeFactorCompositeScoreNoPullbackGate",
        version: "1.1.0",
      },
    ]);
    const runtime = resolveStrategyRecipeById(document.recipe!.recipeId);
    expect(runtime.features.map(feature => feature.featureId)).toEqual([
      "threeFactorCompositeScoreNoPullbackGate",
    ]);
    expect(document.definition?.exit.rules.find(
      rule => rule.type === "TRAILING_TAKE_PROFIT",
    )?.trigger).toBe("INTRADAY");
  });
});
