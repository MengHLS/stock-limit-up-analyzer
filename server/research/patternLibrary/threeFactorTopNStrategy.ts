/**
 * 3F TopN 策略文档装配。
 *
 * 研究实验探针与正式回测重跑脚本共用这一处装配，避免两套 StrategyDocument 漂移。
 * 本模块只组装已注册配方的声明面，不执行回测、不写数据库。
 */

import type { CostModel } from "../../engine/domain";
import { resolveStrategyRecipeById } from "../recipeRegistry";
import { createStrategyDocument } from "../strategySchema/map";
import type { StrategyDocument } from "../strategySchema/types";
import {
  THREE_FACTOR_TOPN_MAX_HOLDING_DAYS,
  THREE_FACTOR_TOPN_OBSERVATION_WINDOW,
  THREE_FACTOR_TOPN_STOP_LOSS_RATIO,
} from "./patterns/firstLimitPullback3FTopN";

export const THREE_FACTOR_TOPN_STRATEGY_VERSION = "1.6.0";

/** 固定创建时间，保证由本装配生成的策略指纹可复现。 */
export const THREE_FACTOR_TOPN_CREATED_AT = "2026-09-26T00:00:00.000Z";

/** 与研究侧 RESULT-OOS-COMPOSITE-3F-001 保持同一套成本假设。 */
export const THREE_FACTOR_TOPN_COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

/** 两个 3F TopN 策略共用同一组合容量：最多同时持有 5 只。 */
export const THREE_FACTOR_TOPN_MAX_POSITIONS = 5;

/** 固定仓位比例：每只按初始资金的 20% 建仓，不随当日候选数动态均分。 */
export const THREE_FACTOR_TOPN_POSITION_RATIO = 0.2;

/** 单日最多新建仓数：Top3 只买前 2 只，Top5 只买前 3 只。 */
export function threeFactorTopNMaxDailyBuys(topN: number): number {
  if (topN === 3) return 2;
  if (topN === 5) return 3;
  throw new Error(`3F TopN 策略：不支持 topN=${String(topN)}，只登记 Top3 / Top5。`);
}

export function threeFactorTopNStrategyId(topN: number): string {
  if (!Number.isInteger(topN) || topN <= 0) {
    throw new Error(`3F TopN 策略：topN 必须是正整数，实际 ${String(topN)}。`);
  }
  return `first-limit-pullback-3f-top${topN}`;
}

export interface BuildThreeFactorTopNStrategyDocumentInput {
  readonly topN: number;
  readonly datasetVersionId: number;
  readonly datasetLabel: string;
  /** 缺省 = 模式声明窗口。探针 A/B 可显式覆盖，但正式策略必须使用缺省值。 */
  readonly observationWindow?: {
    readonly start: number;
    readonly end: number;
    readonly unit: "TRADING_DAY";
  };
  /** 缺省 = 5；正式策略必须使用缺省值。 */
  readonly maxPositions?: number;
  /** 缺省 = Top3 2 只 / Top5 3 只；正式策略必须使用缺省值。 */
  readonly maxDailyBuys?: number;
}

/**
 * 装配 3F TopN StrategyDocument。
 *
 * 策略执行面全部来自已注册配方；本函数只补齐研究坐标、观察窗口与回测假设。
 */
export function buildThreeFactorTopNStrategyDocument(
  input: BuildThreeFactorTopNStrategyDocumentInput,
): StrategyDocument {
  const { topN, datasetVersionId, datasetLabel } = input;
  const strategyId = threeFactorTopNStrategyId(topN);
  const maxPositions = input.maxPositions ?? THREE_FACTOR_TOPN_MAX_POSITIONS;
  const maxDailyBuys = input.maxDailyBuys ?? threeFactorTopNMaxDailyBuys(topN);
  const observationWindow = input.observationWindow ?? THREE_FACTOR_TOPN_OBSERVATION_WINDOW;
  const runtime = resolveStrategyRecipeById(strategyId);
  const recipe = {
    kind: "signalEngine" as const,
    recipeId: strategyId,
    point: runtime.point,
    signalFrequency: runtime.signalFrequency,
    signalDescription: runtime.signalDescription,
    featureVersions: runtime.features
      .map(feature => ({ featureId: feature.featureId, version: feature.version }))
      .sort((a, b) => a.featureId.localeCompare(b.featureId)),
    rankingConfig: { ...runtime.rankingConfig },
    selectionConfig: { method: { ...runtime.selectionConfig.method } },
    requiredData: [...runtime.requiredData],
  };

  return createStrategyDocument({
    strategyId,
    version: THREE_FACTOR_TOPN_STRATEGY_VERSION,
    name: `首板回踩 · 3F 综合评分 Top${topN}`,
    description:
      "首板后第 5 个交易日收盘，按 3F 等权合成分（maxAmplitude LOW + meanAmplitude LOW + "
      + `t1VolumeRatio HIGH）降序排名，取前 ${topN} 名，次日开盘买入；退出 = 候选退出 / 满 `
      + `${THREE_FACTOR_TOPN_MAX_HOLDING_DAYS} 个交易日 / 盘中亏损达 `
      + `${(THREE_FACTOR_TOPN_STOP_LOSS_RATIO * 100).toFixed(0)}% 止损。口径见 `
      + "FROZEN-BUCKET-CONTRACT-001（研究侧唯一落地处）。"
      + `执行容量：最多同时持有 ${maxPositions} 只，单日最多新建仓 ${maxDailyBuys} 只；`
      + `每仓固定按初始资金 ${(THREE_FACTOR_TOPN_POSITION_RATIO * 100).toFixed(0)}% 建仓。`,
    universe: { universeId: `research-dataset:${datasetLabel}` },
    definition: {
      schemaVersion: "1.0",
      datasets: [
        {
          datasetId: "first_limit_pullback",
          datasetVersion: datasetLabel,
          datasetVersionId,
          role: "PRIMARY",
          note: "本策略绑定的唯一坐标 = dataset_version.id（数仓权威坐标）",
        },
      ],
      entry: {
        event: {
          type: "FIRST_LIMIT_UP",
          params: { limitUpRatio: 0.1 },
          description: "首板（首个涨停板）事件",
        },
        observationWindow,
        conditions: [
          {
            id: "entry-sentinel-window",
            field: "bar.close",
            operator: "GREATER_THAN",
            value: 0,
            valueType: "CONSTANT",
            enabled: true,
            description:
              "恒真价格哨兵：仅用于让观察窗口进入 Core 规则图"
              + "（legacy 词汇无法表达「3F 合成分可算」这类特征门槛）",
          },
        ],
        trigger: {
          type: "FIRST_VALID_DAY",
          description: "观察窗口（T+5）内的首个有效日收盘出信号，次一交易日开盘成交",
        },
      },
      execution: {
        signalTiming: "T_CLOSE",
        executionTiming: "T_PLUS_1_OPEN",
        priceType: "OPEN",
        quantityMethod: "TARGET_WEIGHT",
        lotSize: 100,
        commissionModel: "BPS",
        slippageModel: "BPS",
      },
      exit: {
        rules: [
          {
            id: "exit-stop-loss",
            type: "STOP_LOSS",
            trigger: "INTRADAY",
            threshold: THREE_FACTOR_TOPN_STOP_LOSS_RATIO,
            thresholdUnit: "RATIO",
            priority: 1,
            enabled: true,
            description:
              `盘中止损：相对建仓成本亏损达 ${(THREE_FACTOR_TOPN_STOP_LOSS_RATIO * 100).toFixed(0)}% 时退出`,
          },
          {
            id: "exit-time-exit",
            type: "TIME_EXIT",
            trigger: "ON_CLOSE",
            threshold: THREE_FACTOR_TOPN_MAX_HOLDING_DAYS,
            thresholdUnit: "TRADING_DAY",
            priority: 2,
            enabled: true,
            description: `时间出场：持有满 ${THREE_FACTOR_TOPN_MAX_HOLDING_DAYS} 个交易日后退出`,
          },
        ],
      },
      position: {
        sizingMethod: "FIXED_RATIO",
        positionRatio: THREE_FACTOR_TOPN_POSITION_RATIO,
        maxPositions,
        maxSinglePosition: THREE_FACTOR_TOPN_POSITION_RATIO,
      },
      parameters: [],
      risk: {},
    },
    executionAssumptions: {
      backtestConfig: { initialCapital: 100_000, maxPositions, maxDailyBuys },
      costModel: THREE_FACTOR_TOPN_COST_MODEL,
      executionModel: "NEXT_OPEN",
    },
    datasetVersion: datasetLabel,
    datasetVersionId,
    recipe,
  } as never);
}
