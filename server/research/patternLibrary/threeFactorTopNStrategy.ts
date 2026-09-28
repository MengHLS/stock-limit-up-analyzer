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
  THREE_FACTOR_TOPN_TRAILING_TAKE_PROFIT_DRAWDOWN_RATIO,
} from "./patterns/firstLimitPullback3FTopN";
import {
  assertValidTrailingPolicyDefinition,
  describeTrailingPolicy,
  type ResearchTrailingPolicyDefinition,
  type StrongHoldAfterExtendedExitPolicy,
} from "../trailingPolicy";
import type { ExitPolicyDefinition } from "../exitPolicyCommon";

export const THREE_FACTOR_TOPN_STRATEGY_VERSION = "1.9.0";

/** 实验版本：排除 T 日一字板与 T 字板，其余口径沿用 1.10.0 强势续持实验。 */
export const THREE_FACTOR_TOPN_EXCLUDE_OPEN_LIMIT_STRATEGY_VERSION = "1.11.0";

/** 实验版本：将盈利回撤止盈从收盘检查改为盘中检查。 */
export const THREE_FACTOR_TOPN_INTRADAY_TRAILING_STRATEGY_VERSION = "1.12.0";

/** 实验版本：移除「观察窗内必须出现收盘回踩」资格门槛；沿用 1.12.0 的盘中回撤止盈。 */
export const THREE_FACTOR_TOPN_NO_PULLBACK_GATE_STRATEGY_VERSION = "1.13.0";

/** 固定创建时间，保证由本装配生成的策略指纹可复现。 */
export const THREE_FACTOR_TOPN_CREATED_AT = "2026-09-27T00:00:00.000Z";

/**
 * 与研究侧 RESULT-OOS-COMPOSITE-3F-001 冻结的 20 bps 往返成本对齐。
 *
 * 研究侧分解：佣金 2.5 + 滑点 2.5 + 冲击 2.5 bps/边，另收卖出印花税 5 bps。
 * 执行成本模型没有独立 impact 字段，因此把「滑点 + 冲击」合并为 5 bps/边：
 * 佣金 5 + 滑点/冲击 10 + 印花税 5 + 过户费 0.2 = 20.2 bps/往返。
 */
export const THREE_FACTOR_TOPN_COST_MODEL: CostModel = {
  commissionRate: 0.00025,
  stampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
  slippageBps: 5,
  lotSize: 100,
  minCommission: 5,
};

/** 两个 3F TopN 策略共用同一组合容量：最多同时持有 5 只。 */
export const THREE_FACTOR_TOPN_MAX_POSITIONS = 5;

/** 固定仓位比例：每只按决策日收盘总权益的 20% 建仓，不随当日候选数动态均分。 */
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
  /** 实验版本覆盖；未提供 = 正式版本。 */
  readonly strategyVersion?: string;
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
  /** 实验开关：排除 T 日一字板与 T 字板，只保留普通涨停事件。 */
  readonly excludeEventDayOpenAtLimit?: boolean;
  /**
   * true（缺省）= 沿用「首板回踩」资格门槛；false = 1.13.0 变体，
   * 移除「观察窗 T+1..T+5 内必须出现收盘价低于首板日收盘价」的要求。
   */
  readonly requirePullback?: boolean;
  /**
   * 盈利回撤止盈检查时点。缺省 = ON_CLOSE（兼容正式版本）；
   * INTRADAY = 当日开盘/最低价跌破触发线时立即卖出。
   */
  readonly trailingTakeProfitTrigger?: "INTRADAY" | "ON_CLOSE";
  /**
   * 实验覆盖：`null` = 删除 TIME_EXIT；未提供 = 使用模式声明的 5 个交易日。
   * 正式策略不得覆盖，正式交付使用缺省值。
   */
  readonly maxHoldingDays?: number | null;
  /**
   * 实验覆盖：止损比例。未提供 = 模式声明的 5%。
   * 正式策略不得覆盖，正式交付使用缺省值。
   */
  readonly stopLossRatio?: number;
  /** 实验性：第5个持有日强势时延长持有到指定持有日。 */
  readonly strongHold?: {
    readonly atHoldingDays: number;
    readonly minReturnRatio: number;
    readonly requireAboveMa5: boolean;
    readonly requireAboveMa10: boolean;
    readonly extendToHoldingDays: number;
    readonly afterExtendedHold?: StrongHoldAfterExtendedExitPolicy;
    readonly scaleOutRatio?: number | null;
    readonly runnerExitAtHoldingDays?: number | null;
    readonly maxConcurrentRunners?: number | null;
    readonly replacementScoreMargin?: number | null;
  } | null;
  /** 实验性高级收盘移动止盈；与固定回撤止盈二选一。 */
  readonly trailingPolicy?: ResearchTrailingPolicyDefinition | null;
  /** 统一 stop/take-profit/time/strong-hold/capital-recycle 配置。 */
  readonly exitPolicy?: ExitPolicyDefinition | null;
  /** 建仓侧绝对风险过滤（T+1..T+5 观察窗；全部为 PIT 可算的派生 bar 特征）。 */
  readonly entryRiskFilter?: {
    /** 观察窗平均振幅上限（ratio，如 0.08 = 8%）。 */
    readonly maxMeanAmplitude?: number;
    /** 观察窗最大振幅上限（ratio）。 */
    readonly maxMaxAmplitude?: number;
    /** 观察窗最低价相对首板收盘的破位下限（ratio，如 -0.10 = 允许破位 10%）。 */
    readonly minDrawdownFromEventClose?: number;
  };
  /** 实验：按信号评分分档的权益仓位比例（minScore 升序，取命中最高档）。 */
  readonly positionTiers?: readonly { readonly minScore: number; readonly fraction: number }[];
  /** 实验：按当日 rank 分档的权益仓位比例（maxRank 升序，取首个命中档）。 */
  readonly positionRankTiers?: readonly { readonly maxRank: number; readonly fraction: number }[];
  /** 实验参数搜索：把 b4 最大振幅门槛暴露为 TUNABLE 参数（entry condition 走参数引用）。 */
  readonly parameterizedMaxMaxAmplitude?: {
    readonly defaultValue: number;
    readonly min: number;
    readonly max: number;
    readonly step: number;
  };
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
  const requirePullback = input.requirePullback ?? true;
  const recipeId = requirePullback
    ? strategyId
    : `${strategyId}-no-pullback-gate`;
  const maxPositions = input.maxPositions ?? THREE_FACTOR_TOPN_MAX_POSITIONS;
  const maxDailyBuys = input.maxDailyBuys ?? threeFactorTopNMaxDailyBuys(topN);
  const observationWindow = input.observationWindow ?? THREE_FACTOR_TOPN_OBSERVATION_WINDOW;
  const maxHoldingDays =
    input.maxHoldingDays === undefined
      ? THREE_FACTOR_TOPN_MAX_HOLDING_DAYS
      : input.maxHoldingDays;
  if (
    maxHoldingDays !== null &&
    (!Number.isInteger(maxHoldingDays) || maxHoldingDays <= 0)
  ) {
    throw new Error(
      `3F TopN 策略：maxHoldingDays 必须是正整数或 null，实际 ${String(maxHoldingDays)}。`,
    );
  }
  const stopLossRatio = input.stopLossRatio ?? THREE_FACTOR_TOPN_STOP_LOSS_RATIO;
  const trailingTakeProfitTrigger = input.trailingTakeProfitTrigger ?? "ON_CLOSE";
  const trailingPolicy = input.trailingPolicy ?? null;
  const unifiedExitPolicy = input.exitPolicy ?? null;
  const riskFilter = input.entryRiskFilter ?? {};
  for (const [label, value] of [
    ["maxMeanAmplitude", riskFilter.maxMeanAmplitude],
    ["maxMaxAmplitude", riskFilter.maxMaxAmplitude],
  ] as const) {
    if (
      value !== undefined
      && (!Number.isFinite(value) || value <= 0 || value >= 1)
    ) {
      throw new Error(
        `3F TopN 策略：entryRiskFilter.${label} 必须位于 (0,1)，实际 ${String(value)}。`,
      );
    }
  }
  if (
    riskFilter.minDrawdownFromEventClose !== undefined
    && (
      !Number.isFinite(riskFilter.minDrawdownFromEventClose)
      || riskFilter.minDrawdownFromEventClose <= -1
      || riskFilter.minDrawdownFromEventClose >= 0
    )
  ) {
    throw new Error(
      "3F TopN 策略：entryRiskFilter.minDrawdownFromEventClose 必须位于 (-1,0)。",
    );
  }
  const amplitudeParam = input.parameterizedMaxMaxAmplitude;
  if (amplitudeParam !== undefined) {
    for (const value of [
      amplitudeParam.defaultValue,
      amplitudeParam.min,
      amplitudeParam.max,
      amplitudeParam.step,
    ]) {
      if (!Number.isFinite(value) || value <= 0 || value >= 1) {
        throw new Error(
          "3F TopN 策略：parameterizedMaxMaxAmplitude 的数值必须位于 (0,1)，且 step 为正。",
        );
      }
    }
    if (amplitudeParam.min > amplitudeParam.max || amplitudeParam.defaultValue > amplitudeParam.max) {
      throw new Error("3F TopN 策略：parameterizedMaxMaxAmplitude 范围倒挂（min/max/default）。");
    }
  }
  if (unifiedExitPolicy !== null && trailingPolicy !== null) {
    throw new Error("3F TopN 策略：exitPolicy 与 trailingPolicy 不能同时声明。");
  }
  if (trailingPolicy !== null) {
    assertValidTrailingPolicyDefinition(trailingPolicy);
    if (trailingTakeProfitTrigger !== "ON_CLOSE") {
      throw new Error("3F TopN 策略：高级 trailingPolicy 只支持 ON_CLOSE。");
    }
  }
  if (
    !Number.isFinite(stopLossRatio) ||
    stopLossRatio <= 0 ||
    stopLossRatio >= 1
  ) {
    throw new Error(
      `3F TopN 策略：stopLossRatio 必须位于 (0,1)，实际 ${String(stopLossRatio)}。`,
    );
  }
  if (input.strongHold !== undefined && input.strongHold !== null) {
    const strongHold = input.strongHold;
    if (
      !Number.isInteger(strongHold.atHoldingDays) ||
      strongHold.atHoldingDays <= 0 ||
      !Number.isInteger(strongHold.extendToHoldingDays) ||
      strongHold.extendToHoldingDays <= strongHold.atHoldingDays ||
      !Number.isFinite(strongHold.minReturnRatio) ||
      (
        strongHold.afterExtendedHold !== undefined
        && strongHold.afterExtendedHold !== "TIME_EXIT"
        && strongHold.afterExtendedHold !== "TREND"
      ) ||
      (
        strongHold.scaleOutRatio !== undefined
        && strongHold.scaleOutRatio !== null
        && (
          !Number.isFinite(strongHold.scaleOutRatio)
          || strongHold.scaleOutRatio <= 0
          || strongHold.scaleOutRatio >= 1
        )
      ) ||
      (
        strongHold.runnerExitAtHoldingDays !== undefined
        && strongHold.runnerExitAtHoldingDays !== null
        && (
          !Number.isInteger(strongHold.runnerExitAtHoldingDays)
          || strongHold.runnerExitAtHoldingDays <= strongHold.extendToHoldingDays
        )
      ) ||
      (
        strongHold.maxConcurrentRunners !== undefined
        && strongHold.maxConcurrentRunners !== null
        && (
          !Number.isInteger(strongHold.maxConcurrentRunners)
          || strongHold.maxConcurrentRunners <= 0
        )
      ) ||
      (
        strongHold.replacementScoreMargin !== undefined
        && strongHold.replacementScoreMargin !== null
        && (
          !Number.isFinite(strongHold.replacementScoreMargin)
          || strongHold.replacementScoreMargin < 0
        )
      )
    ) {
      throw new Error("3F TopN 策略：strongHold 参数非法。");
    }
    if (
      strongHold.atHoldingDays !== maxHoldingDays
    ) {
      throw new Error(
        "3F TopN 策略：strongHold.atHoldingDays 必须等于 maxHoldingDays。",
      );
    }
  }
  const runtime = resolveStrategyRecipeById(recipeId);
  const recipe = {
    kind: "signalEngine" as const,
    recipeId,
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
    version: input.strategyVersion ?? THREE_FACTOR_TOPN_STRATEGY_VERSION,
    name:
      `首板${requirePullback ? "回踩" : ""} · 3F 综合评分 Top${topN}`
      + (requirePullback ? "" : "（无回踩门槛）"),
    description:
      "首板后第 5 个交易日收盘，按 3F 等权合成分（maxAmplitude LOW + meanAmplitude LOW + "
      + `t1VolumeRatio HIGH）降序排名，取前 ${topN} 名，次日开盘买入；候选评分不触发卖出。`
      + (requirePullback
        ? "候选要求观察窗内出现过收盘回踩，沿用首板回踩资格门槛。"
        : "1.13.0 变体移除「观察窗内必须出现收盘回踩」的候选资格门槛。")
      + (unifiedExitPolicy === null
        ? `退出 = 盘中亏损达 ${(stopLossRatio * 100).toFixed(0)}% 止损 / `
          + (trailingPolicy === null
            ? `盈利后从峰值回撤 ${(THREE_FACTOR_TOPN_TRAILING_TAKE_PROFIT_DRAWDOWN_RATIO * 100).toFixed(0)}% 止盈 / `
            : `收盘移动止盈：${describeTrailingPolicy(trailingPolicy)} / `)
          + (maxHoldingDays === null
            ? "不设时间退出上限。"
            : `持有满 ${maxHoldingDays} 个交易日。`)
        : "退出 = 统一 exitPolicy 配置。")
      + "口径见 "
      + "FROZEN-BUCKET-CONTRACT-001（研究侧唯一落地处）。"
      + `执行容量：最多同时持有 ${maxPositions} 只，单日最多新建仓 ${maxDailyBuys} 只；`
      + `每仓按决策日收盘总权益 ${(THREE_FACTOR_TOPN_POSITION_RATIO * 100).toFixed(0)}% 建仓。`
      + (input.strongHold?.afterExtendedHold === "TREND"
        ? `第 ${input.strongHold.atHoldingDays} 日强势续持后不再按第 ${input.strongHold.extendToHoldingDays} 日固定退出，`
          + (
            input.strongHold.scaleOutRatio === undefined
            || input.strongHold.scaleOutRatio === null
              ? "继续持有到趋势止盈或止损。"
              : `到第 ${input.strongHold.extendToHoldingDays} 日先卖出 ${(input.strongHold.scaleOutRatio * 100).toFixed(0)}%，剩余仓位继续持有到趋势止盈或止损。`
          )
          + (
            input.strongHold.runnerExitAtHoldingDays === undefined
            || input.strongHold.runnerExitAtHoldingDays === null
              ? ""
              : `Runner 最迟在第 ${input.strongHold.runnerExitAtHoldingDays} 日收盘产生退出信号。`
          )
          + (
            input.strongHold.maxConcurrentRunners === undefined
            || input.strongHold.maxConcurrentRunners === null
              ? ""
              : ` 组合同最多保留 ${input.strongHold.maxConcurrentRunners} 个趋势 runner。`
          )
          + (
            input.strongHold.replacementScoreMargin === undefined
            || input.strongHold.replacementScoreMargin === null
              ? ""
              : ` 新候选评分至少高出最弱 runner ${input.strongHold.replacementScoreMargin} 时替换。`
          )
        : "")
      + (input.excludeEventDayOpenAtLimit === true
        ? "T 日一字板与 T 字板在候选事件层排除。"
        : ""),
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
          ...(input.excludeEventDayOpenAtLimit === true
            ? [{
                id: "entry-exclude-one-word-and-t-word",
                field: "prefix.rd0.open",
                operator: "LESS_THAN" as const,
                value: "prefix.rd0.high",
                valueType: "FIELD_REFERENCE" as const,
                enabled: true,
                description:
                  "排除 T 日一字板与 T 字板：两者均满足 open=high；仅保留 open<high 的普通涨停板事件。",
              }]
            : []),
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
          ...(riskFilter.maxMeanAmplitude === undefined ? [] : [{
            id: "entry-risk-mean-amplitude",
            field: "bar.observationMeanAmplitude",
            operator: "LESS_THAN" as const,
            value: riskFilter.maxMeanAmplitude,
            valueType: "CONSTANT" as const,
            enabled: true,
            description:
              `建仓风险过滤：T+1..T+5 平均振幅 < ${(riskFilter.maxMeanAmplitude * 100).toFixed(0)}%`,
          }]),
          ...(riskFilter.maxMaxAmplitude === undefined ? [] : [{
            id: "entry-risk-max-amplitude",
            field: "bar.observationMaxAmplitude",
            operator: "LESS_THAN" as const,
            value: riskFilter.maxMaxAmplitude,
            valueType: "CONSTANT" as const,
            enabled: true,
            description:
              `建仓风险过滤：T+1..T+5 最大振幅 < ${(riskFilter.maxMaxAmplitude * 100).toFixed(0)}%`,
          }]),
          ...(amplitudeParam === undefined ? [] : [{
            id: "entry-risk-max-amplitude-param",
            field: "bar.observationMaxAmplitude",
            operator: "LESS_THAN" as const,
            value: "max_max_amplitude",
            valueType: "PARAMETER_REFERENCE" as const,
            enabled: true,
            description:
              "建仓风险过滤：T+1..T+5 最大振幅 < max_max_amplitude（参数搜索维度）",
          }]),
          ...(riskFilter.minDrawdownFromEventClose === undefined ? [] : [{
            id: "entry-risk-drawdown-depth",
            field: "bar.drawdownFromEventClose",
            operator: "GREATER_THAN" as const,
            value: riskFilter.minDrawdownFromEventClose,
            valueType: "CONSTANT" as const,
            enabled: true,
            description:
              `建仓风险过滤：观察窗最低价相对首板收盘破位 > ${(riskFilter.minDrawdownFromEventClose * 100).toFixed(0)}%`,
          }]),
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
      exit: unifiedExitPolicy === null
        ? {
            candidateExitPolicy: "DISABLED",
            ...(input.strongHold !== undefined && input.strongHold !== null
              ? { strongHold: { ...input.strongHold } }
              : {}),
            rules: [
              {
                id: "exit-stop-loss",
                type: "STOP_LOSS",
                trigger: "INTRADAY",
                threshold: stopLossRatio,
                thresholdUnit: "RATIO",
                priority: 1,
                enabled: true,
                description:
                  `盘中止损：相对建仓成本亏损达 ${(stopLossRatio * 100).toFixed(0)}% 时退出`,
              },
              {
                id: "exit-trailing-take-profit",
                type: "TRAILING_TAKE_PROFIT",
                trigger: trailingPolicy === null ? trailingTakeProfitTrigger : "ON_CLOSE",
                ...(trailingPolicy === null
                  ? {
                      threshold: THREE_FACTOR_TOPN_TRAILING_TAKE_PROFIT_DRAWDOWN_RATIO,
                      thresholdUnit: "RATIO" as const,
                    }
                  : { trailingPolicy }),
                priority: 2,
                enabled: true,
                description:
                  trailingPolicy === null
                    ? `盈利回撤止盈：峰值收益转正后，从最高收盘价回撤达 ${(THREE_FACTOR_TOPN_TRAILING_TAKE_PROFIT_DRAWDOWN_RATIO * 100).toFixed(0)}% `
                      + (trailingTakeProfitTrigger === "INTRADAY"
                        ? "时盘中触发退出"
                        : "时收盘触发，下一交易日开盘退出")
                    : `高级收盘移动止盈：${describeTrailingPolicy(trailingPolicy)}`,
              },
              ...(maxHoldingDays === null
                ? []
                : [{
                    id: "exit-time-exit",
                    type: "TIME_EXIT" as const,
                    trigger: "ON_CLOSE" as const,
                    threshold: maxHoldingDays,
                    thresholdUnit: "TRADING_DAY" as const,
                    priority: 3,
                    enabled: true,
                    description: `时间出场：持有满 ${maxHoldingDays} 个交易日后退出`,
                  }]),
            ],
          }
        : {
            candidateExitPolicy: "DISABLED",
            rules: [{
              id: "exit-unified-policy",
              type: "STOP_LOSS",
              trigger: "ON_CLOSE",
              policy: unifiedExitPolicy,
              priority: 0,
              enabled: true,
              description: "统一退出策略：止损、止盈、时间退出和资本周转由 policy 配置表达。",
            }],
          },
      position: {
        sizingMethod: "EQUITY_RATIO",
        positionRatio: THREE_FACTOR_TOPN_POSITION_RATIO,
        maxPositions,
        maxSinglePosition: THREE_FACTOR_TOPN_POSITION_RATIO,
        ...(input.positionTiers === undefined ? {} : { positionTiers: input.positionTiers }),
        ...(input.positionRankTiers === undefined ? {} : { positionRankTiers: input.positionRankTiers }),
      },
      parameters: amplitudeParam === undefined
        ? []
        : [{
            code: "max_max_amplitude",
            name: "最大振幅阈值",
            dataType: "number" as const,
            parameterRole: "TUNABLE" as const,
            defaultValue: amplitudeParam.defaultValue,
            min: amplitudeParam.min,
            max: amplitudeParam.max,
            step: amplitudeParam.step,
            required: true,
            unit: "ratio",
            description: "观察窗 T+1..T+5 最大振幅上限（b4 参数搜索维度）",
          }],
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
