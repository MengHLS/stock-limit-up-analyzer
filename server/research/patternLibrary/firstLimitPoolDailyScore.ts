/**
 * 首板股票池滚动 3F Top3 策略族。
 *
 * 首板事件日 T 入池，T+1 起每个交易日用 T+1..min(T+N, T+5) 计算滚动 3F；
 * 低于最低分、连续不可评分、硬资格破坏或达到池龄上限时移出。
 *
 * 底层执行面复用 `c6-b4-14`（v1.62.1）的退出、仓位和成本配置；本模块只替换：
 *   - 事件窗触发 → 池化逐日触发；
 *   - 固定 T+5 3F → 逐 N 校准滚动 3F；
 *   - 回踩资格门槛 → 移除；
 *   - T+1..T+5 最大振幅 → 当日可见窗口滚动最大振幅。
 */

import type { StrategyDocument } from "../strategySchema/types";
import { createStrategyDocument } from "../strategySchema/map";
import {
  buildThreeFactorTopNStrategyDocument,
  type BuildThreeFactorTopNStrategyDocumentInput,
} from "./threeFactorTopNStrategy";
import { buildThreeFactorTopNFamilyArmInput } from "./threeFactorTopNFamilies";
import type { FirstLimitPoolDefinition } from "../strategySchema/definition";
import {
  ROLLING_THREE_FACTOR_CALIBRATION_VERSION,
  FIXED_POOL_THREE_FACTOR_FEATURE_ID,
  ROLLING_THREE_FACTOR_FEATURE_ID,
  ROLLING_THREE_FACTOR_FEATURE_VERSION,
} from "../recipeFeatures/rollingThreeFactorScoreFeatures";

export const FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_ID =
  "first-limit-pool-rolling-3f-top3";

export const FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_VERSION = "1.0.0";

export const FIRST_LIMIT_POOL_DAILY_SCORE_FAMILY_ID =
  "rolling-first-limit-pool";

export const FIRST_LIMIT_POOL_DAILY_SCORE_ARM_ID = "rolling-3f-top3-v1";

export const FIRST_LIMIT_POOL_STRATEGY_TYPE = "FIRST_LIMIT_POOL_ROLLING_3F" as const;

export const FIRST_LIMIT_POOL_DEFAULT_AGE_CAP_TRADING_DAYS = 60;
export const FIRST_LIMIT_POOL_DEFAULT_SCORE_INVALIDATION_DAYS = 3;
export const FIRST_LIMIT_POOL_DEFAULT_MINIMUM_SCORE = 0.55;
export const FIRST_LIMIT_POOL_DEFAULT_MAX_OBSERVATION_AMPLITUDE = 0.14;
export const FIRST_LIMIT_POOL_DEFAULT_SCORE_START_RELATIVE_DAY = 1;
export const FIRST_LIMIT_POOL_DEFAULT_SCORE_WINDOW_DAYS = 5;
export const FIRST_LIMIT_POOL_DEFAULT_EXIT_TAIL_TRADING_DAYS = 20;

/** 旧池化面板内存预算；流式池化路径另受活跃成员预算约束。 */
export const FIRST_LIMIT_POOL_DEFAULT_MEMBER_BUDGET = 10_000;
export const FIRST_LIMIT_POOL_DEFAULT_PANEL_ROW_BUDGET = 1_600_000;

export interface BuildFirstLimitPoolDailyScoreDocumentInput {
  readonly datasetVersionId: number;
  readonly datasetLabel: string;
  readonly topN?: number;
  readonly maxPositions?: number;
  readonly maxDailyBuys?: number;
  readonly poolAgeCapTradingDays?: number;
  readonly scoreInvalidationDays?: number;
  readonly minimumScore?: number;
  readonly maxObservationAmplitude?: number;
  readonly scoreStartRelativeDay?: number;
  readonly scoreWindowDays?: number;
  readonly calibrationVersion?: string;
  readonly scoreMode?: "PER_N_CALIBRATED" | "FIXED_BUCKETS";
  readonly allowMultipleMembersPerSecurity?: boolean;
  readonly exitTailTradingDays?: number;
  readonly boardScope?: readonly ("main" | "chinext" | "star" | "bse")[];
  /** ST 永久排除（PIT：事件日 + 池期逐日）；缺省 true。 */
  readonly excludeSt?: boolean;
  /** 再入场策略（冷却 / 成员限次 / 同代码并发上限）；缺省 = 不限制。 */
  readonly reentryPolicy?: {
    readonly securityCooldownTradingDays?: number;
    readonly maxEntriesPerMember?: number;
    readonly maxConcurrentOpenPerCode?: number;
  };
  readonly maxDailyCandidates?: number;
  readonly panelBudgets?: {
    readonly maxMembersPerDay?: number;
    readonly maxPanelRows?: number;
  };
  /** 仅允许调整继承的执行面；池化语义和回踩门槛不可被覆盖。 */
  readonly threeFactorOverrides?: Partial<
    Omit<
      BuildThreeFactorTopNStrategyDocumentInput,
      "topN" | "datasetVersionId" | "datasetLabel" | "strategyVersion" | "requirePullback"
    >
  >;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} 必须是正整数，实际 ${String(value)}。`);
  }
}

/** 构造默认池化滚动 3F 策略版本快照。 */
export function buildFirstLimitPoolDailyScoreDocument(
  input: BuildFirstLimitPoolDailyScoreDocumentInput,
): StrategyDocument {
  const topN = input.topN ?? 3;
  const maxPositions = input.maxPositions ?? 5;
  const maxDailyBuys = input.maxDailyBuys ?? 2;
  const poolAgeCapTradingDays =
    input.poolAgeCapTradingDays ?? FIRST_LIMIT_POOL_DEFAULT_AGE_CAP_TRADING_DAYS;
  const scoreInvalidationDays =
    input.scoreInvalidationDays ?? FIRST_LIMIT_POOL_DEFAULT_SCORE_INVALIDATION_DAYS;
  const minimumScore = input.minimumScore ?? FIRST_LIMIT_POOL_DEFAULT_MINIMUM_SCORE;
  const maxObservationAmplitude =
    input.maxObservationAmplitude ?? FIRST_LIMIT_POOL_DEFAULT_MAX_OBSERVATION_AMPLITUDE;
  const scoreStartRelativeDay =
    input.scoreStartRelativeDay ?? FIRST_LIMIT_POOL_DEFAULT_SCORE_START_RELATIVE_DAY;
  const scoreWindowDays = input.scoreWindowDays ?? FIRST_LIMIT_POOL_DEFAULT_SCORE_WINDOW_DAYS;
  const calibrationVersion =
    input.calibrationVersion ?? ROLLING_THREE_FACTOR_CALIBRATION_VERSION;
  const scoreMode = input.scoreMode ?? "PER_N_CALIBRATED";
  const allowMultipleMembersPerSecurity = input.allowMultipleMembersPerSecurity ?? true;
  const exitTailTradingDays =
    input.exitTailTradingDays ?? FIRST_LIMIT_POOL_DEFAULT_EXIT_TAIL_TRADING_DAYS;
  const maxDailyCandidates = input.maxDailyCandidates ?? topN;
  const boardScope = input.boardScope ?? (["main"] as const);
  // 池化族默认永不交易 ST（PIT：事件日 + 池期逐日）；显式 false 只用于历史对照。
  const excludeSt = input.excludeSt ?? true;

  for (const [value, label] of [
    [topN, "topN"],
    [maxPositions, "maxPositions"],
    [maxDailyBuys, "maxDailyBuys"],
    [poolAgeCapTradingDays, "poolAgeCapTradingDays"],
    [scoreInvalidationDays, "scoreInvalidationDays"],
    [maxDailyCandidates, "maxDailyCandidates"],
    [exitTailTradingDays, "exitTailTradingDays"],
  ] as const) {
    assertPositiveInteger(value, label);
  }
  if (scoreStartRelativeDay !== 1) {
    throw new Error("首板股票池策略：scoreStartRelativeDay 固定为 T+1。");
  }
  if (scoreWindowDays !== 5) {
    throw new Error("首板股票池策略：scoreWindowDays 固定为 5。");
  }
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) {
    throw new Error(`首板股票池策略：minimumScore 必须位于 [0,1]，实际 ${String(minimumScore)}。`);
  }
  if (
    !Number.isFinite(maxObservationAmplitude)
    || maxObservationAmplitude <= 0
    || maxObservationAmplitude >= 1
  ) {
    throw new Error(
      `首板股票池策略：maxObservationAmplitude 必须位于 (0,1)，实际 ${String(maxObservationAmplitude)}。`,
    );
  }
  if (calibrationVersion.trim() === "") {
    throw new Error("首板股票池策略：calibrationVersion 不能为空。");
  }

  const bestCombination = buildThreeFactorTopNFamilyArmInput(
    "c6-b4-14-best-combination",
    "c6b4-14",
    {
      topN,
      datasetVersionId: input.datasetVersionId,
      datasetLabel: input.datasetLabel,
    },
  );

  const base = buildThreeFactorTopNStrategyDocument({
    ...bestCombination,
    strategyVersion: FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_VERSION,
    maxPositions,
    maxDailyBuys,
    ...input.threeFactorOverrides,
    // 池化族显式移除回踩资格门槛；该选择不可被调用方覆盖回 true。
    requirePullback: false,
  });

  const baseDefinition = base.definition;
  if (baseDefinition === undefined) {
    throw new Error("首板股票池策略：底层 3F 文档缺少 definition，拒绝生成不完整版本快照。");
  }

  const firstLimitPool: FirstLimitPoolDefinition = {
    poolPolicyId: FIRST_LIMIT_POOL_DAILY_SCORE_FAMILY_ID,
    admissionEventType: "FIRST_LIMIT_UP",
    admittedRelativeDay: 0,
    boardScope: [...boardScope],
    excludeSt,
    poolAgeCapTradingDays,
    ...(input.reentryPolicy === undefined
      ? {}
      : {
          reentryPolicy: {
            ...(input.reentryPolicy.securityCooldownTradingDays !== undefined
              ? { securityCooldownTradingDays: input.reentryPolicy.securityCooldownTradingDays }
              : {}),
            ...(input.reentryPolicy.maxEntriesPerMember !== undefined
              ? { maxEntriesPerMember: input.reentryPolicy.maxEntriesPerMember }
              : {}),
            ...(input.reentryPolicy.maxConcurrentOpenPerCode !== undefined
              ? { maxConcurrentOpenPerCode: input.reentryPolicy.maxConcurrentOpenPerCode }
              : {}),
          },
        }),
    scorePolicy: "ROLLING_THREE_FACTOR",
    scoreStartRelativeDay,
    scoreWindowDays,
    minimumScore,
    maxObservationAmplitude,
    calibrationVersion:
      scoreMode === "FIXED_BUCKETS"
        ? "FROZEN-BUCKET-CONTRACT-001"
        : calibrationVersion,
    removeBelowMinimumScore: true,
    allowMultipleMembersPerSecurity,
    exitTailTradingDays,
    scoreInvalidationDays,
    scoreAffectsExit: false,
    maxDailyCandidates,
    panelBudgets: {
      maxMembersPerDay:
        input.panelBudgets?.maxMembersPerDay
        ?? FIRST_LIMIT_POOL_DEFAULT_MEMBER_BUDGET,
      maxPanelRows:
        input.panelBudgets?.maxPanelRows
        ?? FIRST_LIMIT_POOL_DEFAULT_PANEL_ROW_BUDGET,
    },
  };

  const definition = {
    ...baseDefinition,
    entry: {
      ...baseDefinition.entry,
      // Core 规则图的可见窗口；池化数据投影本身由 firstLimitPool.poolAgeCapTradingDays 控制。
      observationWindow: {
        start: 1,
        end: 5,
        unit: "TRADING_DAY" as const,
      },
      conditions: [
        ...baseDefinition.entry.conditions.filter(
          condition => condition.id !== "entry-risk-max-amplitude",
        ),
        {
          id: "entry-risk-rolling-max-amplitude",
          field: "bar.rollingMaxAmplitude",
          operator: "LESS_THAN" as const,
          value: maxObservationAmplitude,
          valueType: "CONSTANT" as const,
          enabled: true,
          description: `逐日滚动风控：T+1..当日最大振幅 < ${(maxObservationAmplitude * 100).toFixed(0)}%`,
        },
      ],
      trigger: {
        type: "FIRST_LIMIT_POOL" as const,
        description:
          "首板事件入池后，T+1 起每个有效交易日收盘产生候选，次一交易日开盘成交。",
      },
    },
    firstLimitPool,
  };

  const {
    entryRules: _entryRules,
    exitRules: _exitRules,
    riskRules: _riskRules,
    positionSizing: _positionSizing,
    parameters: _parameters,
    ...baseWithoutLegacyViews
  } = base;

  return createStrategyDocument({
    ...baseWithoutLegacyViews,
    strategyId: FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_ID,
    version: FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_VERSION,
    strategyType: FIRST_LIMIT_POOL_STRATEGY_TYPE,
    name: "首板股票池 · 滚动 3F Top3",
    description:
      `首板事件日入池，T+1 起按逐 N 校准的滚动 3F 分每日排序；低于 ${minimumScore} 立即移池。`
      + `池内成员受 Top${topN} / 最多 ${maxPositions} 仓 / 单日最多 ${maxDailyBuys} 笔约束，`
      + "次一交易日开盘执行。评分只影响买入，退出沿用 v1.62.1 统一退出政策；"
      + `同一证券的多个首板事件允许作为独立成员持仓。池龄上限 ${poolAgeCapTradingDays} 个交易日。`,
    definition,
    recipe: {
      kind: "signalEngine",
      recipeId: scoreMode === "FIXED_BUCKETS"
        ? "first-limit-pool-fixed-3f"
        : "first-limit-pool-rolling-3f",
      point: "close",
      signalFrequency: "daily",
      signalDescription: scoreMode === "FIXED_BUCKETS"
        ? "首板池固定冻结桶 3F 对照：滚动窗口但所有 N 共用原冻结边界"
        : "首板池滚动 3F 合成分：maxAmplitude/meanAmplitude LOW + t1VolumeRatio HIGH，逐 N 校准，等权",
      featureVersions: [
        {
          featureId: scoreMode === "FIXED_BUCKETS"
            ? FIXED_POOL_THREE_FACTOR_FEATURE_ID
            : ROLLING_THREE_FACTOR_FEATURE_ID,
          version: ROLLING_THREE_FACTOR_FEATURE_VERSION,
        },
      ],
      rankingConfig: { higherIsBetter: true },
      selectionConfig: { method: { kind: "topN", n: topN } },
      requiredData: ["OHLCV"],
    },
  } as unknown as StrategyDocument);
}

export interface FirstLimitPoolDailyScoreDetail {
  readonly familyId: string;
  readonly armId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly admissionRule: string;
  readonly earlyScoreStage: string;
  readonly fullScoreStage: string;
  readonly invalidationRule: string;
  readonly ageCapTradingDays: number;
  readonly scoreInvalidationDays: number;
  readonly scoreAffectsExit: false;
  readonly maxDailyCandidates: number;
  readonly minimumScore?: number;
  readonly maxObservationAmplitude?: number;
  readonly calibrationVersion?: string;
  readonly allowMultipleMembersPerSecurity?: boolean;
  readonly panelBudgets: {
    readonly maxMembersPerDay: number;
    readonly maxPanelRows: number;
  };
  readonly errorCodes: readonly string[];
}

export function describeFirstLimitPoolDailyScore(
  input?: {
    readonly poolAgeCapTradingDays?: number;
    readonly scoreInvalidationDays?: number;
    readonly minimumScore?: number;
    readonly maxObservationAmplitude?: number;
    readonly calibrationVersion?: string;
    readonly allowMultipleMembersPerSecurity?: boolean;
    readonly maxDailyCandidates?: number;
    readonly earlyScoreStageEnd?: number;
    readonly fullScoreStart?: number;
    readonly panelBudgets?: {
      readonly maxMembersPerDay?: number;
      readonly maxPanelRows?: number;
    };
  },
): FirstLimitPoolDailyScoreDetail {
  const legacy = input?.earlyScoreStageEnd !== undefined || input?.fullScoreStart !== undefined;
  return {
    familyId: FIRST_LIMIT_POOL_DAILY_SCORE_FAMILY_ID,
    armId: FIRST_LIMIT_POOL_DAILY_SCORE_ARM_ID,
    strategyId: FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_ID,
    strategyVersion: FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_VERSION,
    admissionRule:
      "检测到 FIRST_LIMIT_UP 事件即按 eventId 入池；同一证券的多个首板事件保留为独立池成员。",
    earlyScoreStage: legacy
      ? `T+0..T+${input!.earlyScoreStageEnd}（历史 EARLY_OHLC）`
      : "T+1..T+5：maxAmplitude / meanAmplitude / t1VolumeRatio 逐 N 校准后等权合成。",
    fullScoreStage: legacy
      ? `T+${input!.fullScoreStart} 起（历史 FULL_3F）`
      : "T+5 后固定使用 T+1..T+5 的滚动 3F 分。",
    invalidationRule:
      `低于 ${input?.minimumScore ?? FIRST_LIMIT_POOL_DEFAULT_MINIMUM_SCORE}、连续 `
      + `${input?.scoreInvalidationDays ?? FIRST_LIMIT_POOL_DEFAULT_SCORE_INVALIDATION_DAYS} 个交易日不可评分、`
      + "硬资格线破坏或超过池龄上限即移除；失效当天不再产生新建仓意图。",
    ageCapTradingDays:
      input?.poolAgeCapTradingDays ?? FIRST_LIMIT_POOL_DEFAULT_AGE_CAP_TRADING_DAYS,
    scoreInvalidationDays:
       input?.scoreInvalidationDays ?? FIRST_LIMIT_POOL_DEFAULT_SCORE_INVALIDATION_DAYS,
    scoreAffectsExit: false,
    maxDailyCandidates: input?.maxDailyCandidates ?? 3,
    minimumScore: input?.minimumScore ?? FIRST_LIMIT_POOL_DEFAULT_MINIMUM_SCORE,
    maxObservationAmplitude:
      input?.maxObservationAmplitude ?? FIRST_LIMIT_POOL_DEFAULT_MAX_OBSERVATION_AMPLITUDE,
    calibrationVersion:
      input?.calibrationVersion ?? ROLLING_THREE_FACTOR_CALIBRATION_VERSION,
    allowMultipleMembersPerSecurity: input?.allowMultipleMembersPerSecurity ?? true,
    panelBudgets: {
      maxMembersPerDay:
        input?.panelBudgets?.maxMembersPerDay
        ?? FIRST_LIMIT_POOL_DEFAULT_MEMBER_BUDGET,
      maxPanelRows:
        input?.panelBudgets?.maxPanelRows
        ?? FIRST_LIMIT_POOL_DEFAULT_PANEL_ROW_BUDGET,
    },
    errorCodes: [
      "POOL_AGE_CAP_EXCEEDED",
      "POOL_MEMBER_BUDGET_EXCEEDED",
      "POOL_PANEL_ROW_BUDGET_EXCEEDED",
      "POOL_MEMBER_IDENTITY_NOT_UNIQUE",
      "POOL_SCORE_STAGE_CONFIG_INVALID",
      "POOL_SCORE_BELOW_MINIMUM",
    ],
  };
}
