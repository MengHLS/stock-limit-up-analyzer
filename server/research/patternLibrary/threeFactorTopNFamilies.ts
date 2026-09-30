/**
 * 3F TopN 模式族的可执行注册表。
 *
 * 这里的每一个族不是说明文字，而是「族 id → 可执行 BuildThreeFactorTopNStrategyDocumentInput
 * 补丁」的唯一权威映射；文档一律复用 buildThreeFactorTopNStrategyDocument 生成，
 * 避免族注解、回测脚本与正式版本出现三套参数定义。
 *
 * 未能在留档中恢复到具体参数值的族，必须显式标为 HISTORICAL_ONLY，
 * 不静默落回 3F 默认值。
 */

import {
  buildThreeFactorTopNStrategyDocument,
  type BuildThreeFactorTopNStrategyDocumentInput,
} from "./threeFactorTopNStrategy";
import type { StrategyDocument } from "../strategySchema/types";
import { getExitPolicyExperiment } from "../exitPolicyExperiments";
import type { ResearchTrailingPolicyDefinition } from "../trailingPolicy";

export const THREE_FACTOR_TOPN_FAMILY_IDS = [
  "early-execution-baseline",
  "cost-position-correction",
  "strong-hold-extension",
  "event-board-filter",
  "intraday-drawdown-exit",
  "no-pullback-gate",
  "trailing-take-profit",
  "runner-scale-out",
  "stop-policy-sweep",
  "entry-risk-filter-b",
  "tiered-position-sizing-c",
  "zero-low-score-allocation",
  "c6-b4-14-best-combination",
  "early-non-3f-comparison",
] as const;

export type ThreeFactorTopNFamilyId = (typeof THREE_FACTOR_TOPN_FAMILY_IDS)[number];

export type ThreeFactorTopNFamilyExecutability =
  | "EXECUTABLE"
  | "HISTORICAL_ONLY";

export interface ThreeFactorTopNFamilyTunableParameter {
  readonly name:
    | "maxMaxAmplitude"
    | "maxMeanAmplitude"
    | "minDrawdownFromEventClose"
    | "stopLossRatio";
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly note: string;
}

export interface ThreeFactorTopNFamilyDefinition {
  readonly familyId: ThreeFactorTopNFamilyId;
  readonly familyLabel: string;
  readonly minVersion: string;
  readonly maxVersion: string;
  readonly executability: ThreeFactorTopNFamilyExecutability;
  /** 不可执行时必须给出具体原因；可执行时为 null。 */
  readonly historicalOnlyReason: string | null;
  /** 该族在 3F TopN 上可覆写的维度参数；空数组表示族差异不通过参数搜索暴露。 */
  readonly tunableParameters: readonly ThreeFactorTopNFamilyTunableParameter[];
  /** 该族的留档证据来源，便于追溯参数取值的出处。 */
  readonly evidenceSources: readonly string[];
  /** 可执行族的具体构建输入补丁；HISTORICAL_ONLY 族为 null。 */
  readonly inputPatch: ThreeFactorTopNFamilyInputPatch | null;
  /**
   * 该族在留档里出现过的具体版本 arm。每个 arm 都携带写死的 strategyVersion
   * 与执行补丁，是回测脚本、回填脚本与版本详情共享的唯一 arm 定义。
   * HISTORICAL_ONLY 族为空数组。
   */
  readonly arms: readonly ThreeFactorTopNFamilyArm[];
}

/**
 * 族补丁只表达族独有的执行维度；topN / datasetVersionId / datasetLabel
 * 属于调用坐标，由调用方提供，不写死在族定义里。
 */
export type ThreeFactorTopNFamilyInputPatch = Omit<
  BuildThreeFactorTopNStrategyDocumentInput,
  "topN" | "datasetVersionId" | "datasetLabel"
>;

export interface BuildThreeFactorTopNFamilyCoordinates {
  readonly topN: number;
  readonly datasetVersionId: number;
  readonly datasetLabel: string;
}

/**
 * 族内某个留档 arm 的完整可执行定义。
 *
 * `inputPatch` 已经叠加上族共享补丁（`ThreeFactorTopNFamilyDefinition.inputPatch`），
 * 因此 `buildThreeFactorTopNFamilyArmInput` 只需拼接调用坐标即可还原脚本原有行为。
 */
export interface ThreeFactorTopNFamilyArm {
  readonly armId: string;
  /** 留档里使用的具体语义版本，例如 1.58.3。 */
  readonly strategyVersion: string;
  readonly label: string;
  readonly description: string;
  /** 该 arm 的完整构建补丁，已包含族共享补丁。 */
  readonly inputPatch: ThreeFactorTopNFamilyInputPatch;
}

/** 某个研究集合对一个 arm 的引用；`alias` 为脚本 CLI 暴露的名字（缺省等于 armId）。 */
export interface ThreeFactorTopNStudyMember {
  readonly familyId: ThreeFactorTopNFamilyId;
  readonly armId: string;
  readonly alias?: string;
}

export interface ThreeFactorTopNStudyDefinition {
  readonly studyId: string;
  readonly studyLabel: string;
  readonly members: readonly ThreeFactorTopNStudyMember[];
}

type NumberTunable = NonNullable<
  BuildThreeFactorTopNStrategyDocumentInput["tunables"]
>["maxMaxAmplitude"];

const STRONG_HOLD_5_TO_10 = {
  atHoldingDays: 5,
  minReturnRatio: 0.03,
  requireAboveMa5: true,
  requireAboveMa10: true,
  extendToHoldingDays: 10,
} as const;

/**
 * 1.58–1.62 组合族共享的 v1.44.1 退出链（SL-18.1 已在退出政策实验中登记）。
 * 每次调用返回新对象，避免调用方意外改写共享引用。
 */
function sharedBestExitPolicy() {
  return getExitPolicyExperiment("SL-18.1").policy;
}

function sharedCombinationPatch(): ThreeFactorTopNFamilyInputPatch {
  return {
    stopLossRatio: 0.06,
    strongHold: { ...STRONG_HOLD_5_TO_10 },
    excludeEventDayOpenAtLimit: true,
    exitPolicy: sharedBestExitPolicy(),
  };
}

/**
 * 缺省臂（同族代表臂）：把族补丁原样升级为第一个 arm，保证族级构建与
 * 「第一个 arm」在数值上完全一致，脚本可无痛切换到 arm API。
 */
function defaultArm(
  armId: string,
  strategyVersion: string,
  label: string,
  description: string,
  patch: ThreeFactorTopNFamilyInputPatch,
): ThreeFactorTopNFamilyArm {
  return { armId, strategyVersion, label, description, inputPatch: patch };
}

/** 在族共享补丁之上叠加 arm 独有维度，得到该 arm 的完整构建补丁。 */
function withBase(
  base: ThreeFactorTopNFamilyInputPatch,
  override: ThreeFactorTopNFamilyInputPatch,
): ThreeFactorTopNFamilyInputPatch {
  return {
    ...base,
    ...override,
    ...(override.entryRiskFilter === undefined
      ? {}
      : { entryRiskFilter: { ...(base.entryRiskFilter ?? {}), ...override.entryRiskFilter } }),
    ...(override.tunables === undefined
      ? {}
      : { tunables: { ...(base.tunables ?? {}), ...override.tunables } }),
  };
}

/** 构造一个 B/C 族组合 arm：共享组合补丁 + 风险过滤 + 仓位分档。 */
function combinationArm(
  armId: string,
  strategyVersion: string,
  label: string,
  description: string,
  override: ThreeFactorTopNFamilyInputPatch,
): ThreeFactorTopNFamilyArm {
  return defaultArm(
    armId,
    strategyVersion,
    label,
    description,
    withBase(sharedCombinationPatch(), override),
  );
}

/** 构造一个只用共享组合补丁、不叠加额外维度的 arm。 */
function combinationFamilyArm(
  armId: string,
  strategyVersion: string,
  label: string,
  description: string,
  positionPatch: Pick<ThreeFactorTopNFamilyInputPatch, "positionTiers" | "positionRankTiers">,
): ThreeFactorTopNFamilyArm {
  return combinationArm(armId, strategyVersion, label, description, positionPatch);
}

const MA_CROSS_TRAILING: ResearchTrailingPolicyDefinition = {
  kind: "MA_CROSS",
  fastWindow: 5,
  slowWindow: 10,
  activationRatio: 0,
};

const C6_POSITION_TIERS = [
  { minScore: 0, fraction: 0.05 },
  { minScore: 0.55, fraction: 0.2 },
  { minScore: 0.7167, fraction: 0.25 },
] as const;

const C7_POSITION_TIERS = [
  { minScore: 0, fraction: 0 },
  { minScore: 0.55, fraction: 0.2 },
  { minScore: 0.7167, fraction: 0.25 },
] as const;

const C8_POSITION_TIERS = [
  { minScore: 0, fraction: 0 },
  { minScore: 0.55, fraction: 0.2 },
  { minScore: 0.7167, fraction: 0.3 },
] as const;

const C9_POSITION_TIERS = [
  { minScore: 0, fraction: 0 },
  { minScore: 0.55, fraction: 0.15 },
  { minScore: 0.7167, fraction: 0.25 },
] as const;

const DEFINITIONS: readonly ThreeFactorTopNFamilyDefinition[] = [
  {
    familyId: "early-execution-baseline",
    familyLabel: "早期执行基线族",
    minVersion: "1.0.0",
    maxVersion: "1.6.0",
    executability: "HISTORICAL_ONLY",
    historicalOnlyReason:
      "1.0.0–1.6.0 属事件身份/除权/容量修复期，留档代码快照与当前 3F 执行面不一致，"
      + "无法在现构建器中还原为可执行参数；横向比较前必须先 fresh rerun。",
    tunableParameters: [],
    evidenceSources: ["strategyVersionStudyAnnotations: early-execution-baseline"],
    inputPatch: null,
    arms: [],
  },
  {
    familyId: "cost-position-correction",
    familyLabel: "仓位与成本矫正族",
    minVersion: "1.7.0",
    maxVersion: "1.9.1",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [
      {
        name: "stopLossRatio",
        defaultValue: 0.06,
        min: 0.03,
        max: 0.12,
        step: 0.01,
        note: "该族留档采用固定 6% 止损，并在停止候选退出后成为后续止损搜索的控制组。",
      },
    ],
    evidenceSources: [
      "strategyVersionStudyAnnotations: cost-position-correction",
      "exitPolicyExperiments: SL-00 fixed-6-intraday-control",
    ],
    inputPatch: {
      stopLossRatio: 0.06,
    },
    arms: [
      defaultArm(
        "sl-00",
        "1.7.0",
        "cost-position-correction-fixed-6",
        "仓位与成本矫正族留档：固定 6% 止损与统一往返成本。",
        { stopLossRatio: 0.06 },
      ),
    ],
  },
  {
    familyId: "strong-hold-extension",
    familyLabel: "强势续持延长族",
    minVersion: "1.10.0",
    maxVersion: "1.10.0",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [],
    evidenceSources: [
      "strategyVersionStudyAnnotations: strong-hold-extension",
      "threeFactorTopNStrategy: strongHold.atHoldingDays=5 / extendToHoldingDays=10",
    ],
    inputPatch: {
      strongHold: { ...STRONG_HOLD_5_TO_10 },
    },
    arms: [
      defaultArm(
        "strong-hold-5-to-10",
        "1.10.0",
        "strong-hold-extension",
        "强势持仓由第 5 日延长到第 10 日。",
        { strongHold: { ...STRONG_HOLD_5_TO_10 } },
      ),
    ],
  },
  {
    familyId: "event-board-filter",
    familyLabel: "事件形态过滤族",
    minVersion: "1.11.0",
    maxVersion: "1.11.0",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [],
    evidenceSources: [
      "strategyVersionStudyAnnotations: event-board-filter",
      "threeFactorTopNStrategy: excludeEventDayOpenAtLimit",
    ],
    inputPatch: {
      excludeEventDayOpenAtLimit: true,
    },
    arms: [
      defaultArm(
        "exclude-open-limit",
        "1.11.0",
        "event-board-filter",
        "排除 T 日一字板与 T 字板。",
        { excludeEventDayOpenAtLimit: true },
      ),
    ],
  },
  {
    familyId: "intraday-drawdown-exit",
    familyLabel: "盘中盈利回撤止盈族",
    minVersion: "1.12.0",
    maxVersion: "1.12.0",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [],
    evidenceSources: [
      "strategyVersionStudyAnnotations: intraday-drawdown-exit",
      "threeFactorTopNStrategy: trailingTakeProfitTrigger=INTRADAY",
    ],
    inputPatch: {
      trailingTakeProfitTrigger: "INTRADAY",
    },
    arms: [
      defaultArm(
        "intraday-trailing-take-profit",
        "1.12.0",
        "intraday-drawdown-exit",
        "盈利回撤止盈改为盘中检查。",
        { trailingTakeProfitTrigger: "INTRADAY" },
      ),
    ],
  },
  {
    familyId: "no-pullback-gate",
    familyLabel: "回踩门槛移除族",
    minVersion: "1.13.0",
    maxVersion: "1.13.0",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [],
    evidenceSources: [
      "strategyVersionStudyAnnotations: no-pullback-gate",
      "threeFactorTopNStrategy: requirePullback=false",
    ],
    inputPatch: {
      requirePullback: false,
    },
    arms: [
      defaultArm(
        "no-pullback-gate",
        "1.13.0",
        "no-pullback-observation-gate",
        "移除观察窗内必须出现收盘回踩的门槛。",
        { requirePullback: false },
      ),
    ],
  },
  {
    familyId: "trailing-take-profit",
    familyLabel: "移动止盈族",
    minVersion: "1.14.0",
    maxVersion: "1.21.0",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [],
    evidenceSources: [
      "strategyVersionStudyAnnotations: trailing-take-profit",
      "run3FTopNTrailingPolicyStudy: ma5-ma10-close / atr10-chandelier-2p5 / "
        + "risk-multiple-lock-2r-3r / profit-giveback-one-third / three-day-swing-low / "
        + "parabolic-sar-close / ma5-atr10-floor-hybrid",
    ],
    inputPatch: {
      // 族内包含 7 个 arm；默认导出与最佳留档口径一致的 MA5/MA10 收盘确认移动止盈。
      trailingPolicy: MA_CROSS_TRAILING,
    },
    arms: [
      defaultArm(
        "ma",
        "1.14.0",
        "ma5-ma10-close",
        "MA5/MA10 收盘确认移动止盈。",
        { trailingPolicy: MA_CROSS_TRAILING },
      ),
      defaultArm(
        "legacy_ma_control",
        "1.14.1",
        "legacy-ma-fixed-6-control",
        "MA5/MA10 收盘确认叠加固定 6% 止损的历史控制臂。",
        { trailingPolicy: MA_CROSS_TRAILING },
      ),
      defaultArm(
        "atr",
        "1.15.0",
        "atr10-chandelier-2p5",
        "Chandelier 2.5×ATR10 移动止盈。",
        {
          trailingPolicy: {
            kind: "ATR_CHANDELIER",
            atrWindow: 10,
            atrMultiplier: 2.5,
            activationRatio: 0,
          },
        },
      ),
      defaultArm(
        "rlock",
        "1.16.0",
        "risk-multiple-lock-2r-3r",
        "2R/3R 风险倍数利润锁。",
        {
          trailingPolicy: {
            kind: "R_MULTIPLE",
            lockLadder: [
              { triggerR: 2, lockR: 1 },
              { triggerR: 3, lockR: 2 },
            ],
          },
        },
      ),
      defaultArm(
        "giveback",
        "1.17.0",
        "profit-giveback-one-third",
        "利润回吐三分之一止盈。",
        {
          trailingPolicy: {
            kind: "PROFIT_GIVEBACK",
            activationRatio: 0.05,
            givebackFraction: 1 / 3,
          },
        },
      ),
      defaultArm(
        "swing",
        "1.18.0",
        "three-day-swing-low",
        "3 日结构低点移动止盈。",
        {
          trailingPolicy: {
            kind: "SWING_LOW",
            lookbackDays: 3,
            activationRatio: 0,
          },
        },
      ),
      defaultArm(
        "sar",
        "1.19.0",
        "parabolic-sar-close",
        "Parabolic SAR 收盘确认移动止盈。",
        {
          trailingPolicy: {
            kind: "PARABOLIC_SAR",
            step: 0.02,
            maxStep: 0.2,
            activationRatio: 0,
          },
        },
      ),
      defaultArm(
        "hybrid",
        "1.20.0",
        "ma5-atr10-floor-hybrid",
        "MA5 + ATR10 地板混合移动止盈。",
        {
          trailingPolicy: {
            kind: "HYBRID",
            fastWindow: 5,
            atrWindow: 10,
            atrMultiplier: 2.5,
            floorRatio: 0.01,
            activationRatio: 0.03,
          },
        },
      ),
    ],
  },
  {
    familyId: "runner-scale-out",
    familyLabel: "趋势 Runner 与减仓族",
    minVersion: "1.22.0",
    maxVersion: "1.26.0",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [],
    evidenceSources: [
      "strategyVersionStudyAnnotations: runner-scale-out",
      "run3FTopNTrailingPolicyStudy: scale50=1.23.1 / scale75=1.24.1 / "
        + "runner2=1.25.0 / replace=1.26.0",
    ],
    inputPatch: {
      observationWindow: { start: 5, end: 19, unit: "TRADING_DAY" },
      trailingPolicy: MA_CROSS_TRAILING,
      strongHold: {
        ...STRONG_HOLD_5_TO_10,
        afterExtendedHold: "TREND",
        scaleOutRatio: 0.5,
        runnerExitAtHoldingDays: 14,
      },
    },
    arms: [
      defaultArm(
        "ma_trend",
        "1.22.0",
        "ma-trend-after-strong-hold",
        "强势续持到期后按 MA 趋势持有，不主动减仓。",
        {
          observationWindow: { start: 5, end: 19, unit: "TRADING_DAY" },
          trailingPolicy: MA_CROSS_TRAILING,
          strongHold: {
            ...STRONG_HOLD_5_TO_10,
            afterExtendedHold: "TREND",
          },
        },
      ),
      defaultArm(
        "scale50",
        "1.23.1",
        "ma-trend-scale-out-50",
        "趋势到期减仓 50%，其余持有到第 14 日。",
        {
          observationWindow: { start: 5, end: 19, unit: "TRADING_DAY" },
          trailingPolicy: MA_CROSS_TRAILING,
          strongHold: {
            ...STRONG_HOLD_5_TO_10,
            afterExtendedHold: "TREND",
            scaleOutRatio: 0.5,
            runnerExitAtHoldingDays: 14,
          },
        },
      ),
      defaultArm(
        "scale75",
        "1.24.1",
        "ma-trend-scale-out-75",
        "趋势到期减仓 75%，其余持有到第 14 日。",
        {
          observationWindow: { start: 5, end: 19, unit: "TRADING_DAY" },
          trailingPolicy: MA_CROSS_TRAILING,
          strongHold: {
            ...STRONG_HOLD_5_TO_10,
            afterExtendedHold: "TREND",
            scaleOutRatio: 0.75,
            runnerExitAtHoldingDays: 14,
          },
        },
      ),
      defaultArm(
        "runner2",
        "1.25.0",
        "ma-trend-runner-limit-2",
        "趋势 runner 最多并发 2 个，其余持有到第 14 日。",
        {
          observationWindow: { start: 5, end: 19, unit: "TRADING_DAY" },
          trailingPolicy: MA_CROSS_TRAILING,
          strongHold: {
            ...STRONG_HOLD_5_TO_10,
            afterExtendedHold: "TREND",
            runnerExitAtHoldingDays: 14,
            maxConcurrentRunners: 2,
          },
        },
      ),
      defaultArm(
        "replace",
        "1.26.0",
        "ma-trend-runner-replacement",
        "趋势 runner 可被更高分候选替换（分数差 0.03）。",
        {
          observationWindow: { start: 5, end: 19, unit: "TRADING_DAY" },
          trailingPolicy: MA_CROSS_TRAILING,
          strongHold: {
            ...STRONG_HOLD_5_TO_10,
            afterExtendedHold: "TREND",
            runnerExitAtHoldingDays: 14,
            maxConcurrentRunners: 2,
            replacementScoreMargin: 0.03,
          },
        },
      ),
    ],
  },
  {
    familyId: "stop-policy-sweep",
    familyLabel: "止损政策族",
    minVersion: "1.27.0",
    maxVersion: "1.56.0",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [
      {
        name: "stopLossRatio",
        defaultValue: 0.06,
        min: 0.03,
        max: 0.12,
        step: 0.01,
        note: "该族围绕固定比例/ATR/结构低点做止损语义搜索；默认取历史最优 SL-18.1（峰值回撤 8%）。",
      },
    ],
    evidenceSources: [
      "strategyVersionStudyAnnotations: stop-policy-sweep",
      "exitPolicyExperiments: SL-18.1",
      "strategyVersionStudyAnnotations: 1.44.1 = +27.96% / PF 1.0909",
    ],
    inputPatch: {
      stopLossRatio: 0.06,
      strongHold: { ...STRONG_HOLD_5_TO_10 },
      exitPolicy: sharedBestExitPolicy(),
    },
    arms: [
      defaultArm(
        "sl-18-1",
        "1.44.1",
        "stop-policy-sl-18-1",
        "止损政策族留档：SL-18.1 峰值回撤 8% 统一退出链。",
        {
          stopLossRatio: 0.06,
          strongHold: { ...STRONG_HOLD_5_TO_10 },
          exitPolicy: sharedBestExitPolicy(),
        },
      ),
    ],
  },
  {
    familyId: "entry-risk-filter-b",
    familyLabel: "入场风险过滤 B 族",
    minVersion: "1.58.0",
    maxVersion: "1.58.7",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [
      {
        name: "maxMaxAmplitude",
        defaultValue: 0.12,
        min: 0.08,
        max: 0.2,
        step: 0.01,
        note: "b4 的最大振幅 <12% 是 B 族唯一优于 v1.44.1 的候选，因此作为族默认值。",
      },
      {
        name: "maxMeanAmplitude",
        defaultValue: 0.08,
        min: 0.04,
        max: 0.15,
        step: 0.01,
        note: "b1 的平均振幅 <8% 保留了该族另一条可覆写维度。",
      },
      {
        name: "minDrawdownFromEventClose",
        defaultValue: -0.1,
        min: -0.2,
        max: -0.04,
        step: 0.01,
        note: "b6 允许相对首板收盘破位 10%；与 maxMeanAmplitude 组合即 b8。",
      },
    ],
    evidenceSources: [
      "backfill3FTopNStrategyVersions: b1–b8",
      "strategyVersionStudyAnnotations: 1.58.3 = +30.21% / PF 1.0954",
    ],
    inputPatch: {
      ...sharedCombinationPatch(),
      entryRiskFilter: { maxMaxAmplitude: 0.12 },
    },
    arms: [
      combinationArm(
        "b1",
        "1.58.0",
        "mean-amp-under-8",
        "观察窗平均振幅 < 8%。",
        { entryRiskFilter: { maxMeanAmplitude: 0.08 } },
      ),
      combinationArm(
        "b2",
        "1.58.1",
        "mean-amp-under-7",
        "观察窗平均振幅 < 7%。",
        { entryRiskFilter: { maxMeanAmplitude: 0.07 } },
      ),
      combinationArm(
        "b3",
        "1.58.2",
        "mean-amp-under-6",
        "观察窗平均振幅 < 6%。",
        { entryRiskFilter: { maxMeanAmplitude: 0.06 } },
      ),
      combinationArm(
        "b4",
        "1.58.3",
        "max-amp-under-12",
        "观察窗最大振幅 < 12%。",
        { entryRiskFilter: { maxMaxAmplitude: 0.12 } },
      ),
      combinationArm(
        "b5",
        "1.58.4",
        "max-amp-under-10",
        "观察窗最大振幅 < 10%。",
        { entryRiskFilter: { maxMaxAmplitude: 0.1 } },
      ),
      combinationArm(
        "b6",
        "1.58.5",
        "drawdown-gt-minus-10",
        "观察窗最低价相对首板收盘破位不超过 -10%。",
        { entryRiskFilter: { minDrawdownFromEventClose: -0.1 } },
      ),
      combinationArm(
        "b7",
        "1.58.6",
        "drawdown-gt-minus-8",
        "观察窗最低价相对首板收盘破位不超过 -8%。",
        { entryRiskFilter: { minDrawdownFromEventClose: -0.08 } },
      ),
      combinationArm(
        "b8",
        "1.58.7",
        "mean-amp-8-and-dd-minus-10",
        "平均振幅 < 8% 且破位不超过 -10%。",
        {
          entryRiskFilter: {
            maxMeanAmplitude: 0.08,
            minDrawdownFromEventClose: -0.1,
          },
        },
      ),
    ],
  },
  {
    familyId: "tiered-position-sizing-c",
    familyLabel: "分层仓位 C 族",
    minVersion: "1.59.0",
    maxVersion: "1.59.6",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [],
    evidenceSources: [
      "backfill3FTopNStrategyVersions: c1–c6",
      "strategyVersionStudyAnnotations: 1.59.5 c6 = +42.24% / PF 1.1139；"
        + "1.59.6 c6+b4 = +46.74% / PF 1.1229",
    ],
    inputPatch: {
      ...sharedCombinationPatch(),
      positionTiers: C6_POSITION_TIERS,
    },
    arms: [
      combinationFamilyArm(
        "c1",
        "1.59.0",
        "score-tier-20-10-5",
        "score≥0.7167 20%；0.55~0.7167 10%；低于 0.55 5%。",
        {
          positionTiers: [
            { minScore: 0, fraction: 0.05 },
            { minScore: 0.55, fraction: 0.1 },
            { minScore: 0.7167, fraction: 0.2 },
          ],
        },
      ),
      combinationFamilyArm(
        "c2",
        "1.59.1",
        "score-tier-20-5",
        "score≥0.7167 20%；低于 0.7167 5%。",
        {
          positionTiers: [
            { minScore: 0, fraction: 0.05 },
            { minScore: 0.7167, fraction: 0.2 },
          ],
        },
      ),
      combinationFamilyArm(
        "c3",
        "1.59.2",
        "score-tier-20-10",
        "score≥0.65 20%；低于 0.65 10%。",
        {
          positionTiers: [
            { minScore: 0, fraction: 0.1 },
            { minScore: 0.65, fraction: 0.2 },
          ],
        },
      ),
      combinationFamilyArm(
        "c4",
        "1.59.3",
        "rank-tier-20-15-10",
        "rank1 20%；rank2 15%；rank3+ 10%。",
        {
          positionRankTiers: [
            { maxRank: 1, fraction: 0.2 },
            { maxRank: 2, fraction: 0.15 },
            { maxRank: 999, fraction: 0.1 },
          ],
        },
      ),
      combinationFamilyArm(
        "c5",
        "1.59.4",
        "score-tier-low5-mid20-high20",
        "score≥0.7167 20%；0.55~0.7167 20%；低于 0.55 5%。",
        {
          positionTiers: [
            { minScore: 0, fraction: 0.05 },
            { minScore: 0.55, fraction: 0.2 },
            { minScore: 0.7167, fraction: 0.2 },
          ],
        },
      ),
      combinationFamilyArm(
        "c6",
        "1.59.5",
        "score-tier-low5-mid20-high25",
        "score≥0.7167 25%；0.55~0.7167 20%；低于 0.55 5%。",
        {
          positionTiers: C6_POSITION_TIERS,
        },
      ),
      combinationArm(
        "c6b4",
        "1.59.6",
        "c6-plus-b4-max-amp-12",
        "c6 分档仓位（高25/中20/低5）+ 最大振幅<12%。",
        {
          entryRiskFilter: { maxMaxAmplitude: 0.12 },
          positionTiers: C6_POSITION_TIERS,
        },
      ),
    ],
  },
  {
    familyId: "zero-low-score-allocation",
    familyLabel: "低分归零族",
    minVersion: "1.61.0",
    maxVersion: "1.61.2",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [],
    evidenceSources: [
      "backfill3FTopNStrategyVersions: c7/c8/c9",
      "strategyVersionStudyAnnotations: 1.61.x = +17.85% / +25.63% / +11.04%",
    ],
    inputPatch: {
      ...sharedCombinationPatch(),
      entryRiskFilter: { maxMaxAmplitude: 0.12 },
      positionTiers: C7_POSITION_TIERS,
    },
    arms: [
      combinationArm(
        "c7",
        "1.61.0",
        "c6b4-low0-high25-mid20",
        "c6+b4：高25%/中20%/低0%。",
        {
          entryRiskFilter: { maxMaxAmplitude: 0.12 },
          positionTiers: C7_POSITION_TIERS,
        },
      ),
      combinationArm(
        "c8",
        "1.61.1",
        "c6b4-low0-high30-mid20",
        "c6+b4：高30%/中20%/低0%。",
        {
          entryRiskFilter: { maxMaxAmplitude: 0.12 },
          positionTiers: C8_POSITION_TIERS,
        },
      ),
      combinationArm(
        "c9",
        "1.61.2",
        "c6b4-low0-high25-mid15",
        "c6+b4：高25%/中15%/低0%。",
        {
          entryRiskFilter: { maxMaxAmplitude: 0.12 },
          positionTiers: C9_POSITION_TIERS,
        },
      ),
    ],
  },
  {
    familyId: "c6-b4-14-best-combination",
    familyLabel: "c6+b4-14 当前最佳组合族",
    minVersion: "1.62.1",
    maxVersion: "1.62.1",
    executability: "EXECUTABLE",
    historicalOnlyReason: null,
    tunableParameters: [
      {
        name: "maxMaxAmplitude",
        defaultValue: 0.14,
        min: 0.12,
        max: 0.2,
        step: 0.01,
        note: "当前最佳组合的实际装配值；放宽到 14% 以保留更多中等波动候选。",
      },
    ],
    evidenceSources: [
      "backfill3FTopNStrategyVersions: c6b4-14 = 1.62.1",
      "strategyVersionStudyAnnotations: 1.62.1 = +57.73% / DD 47.96% / PF 1.1366",
      "docs/evidence closed-loop: 1.62.1 totalReturnPct 57.73303907407019",
    ],
    inputPatch: {
      ...sharedCombinationPatch(),
      entryRiskFilter: { maxMaxAmplitude: 0.14 },
      positionTiers: C6_POSITION_TIERS,
    },
    arms: [
      combinationArm(
        "c6b4-14",
        "1.62.1",
        "c6-b4-max-amp-14",
        "c6 分档仓位（高25/中20/低5）+ 最大振幅<14%。",
        {
          entryRiskFilter: { maxMaxAmplitude: 0.14 },
          positionTiers: C6_POSITION_TIERS,
        },
      ),
    ],
  },
  {
    familyId: "early-non-3f-comparison",
    familyLabel: "早期非 3F 对照族",
    minVersion: "1.0.0",
    maxVersion: "1.0.0",
    executability: "HISTORICAL_ONLY",
    historicalOnlyReason:
      "cand-* / first-board-pullback 属早期策略或候选结构，不是 3F TopN 配方，"
      + "无法映射为 BuildThreeFactorTopNStrategyDocumentInput；不得与 3F 版本混算。",
    tunableParameters: [],
    evidenceSources: ["strategyVersionStudyAnnotations: early-non-3f-comparison"],
    inputPatch: null,
    arms: [],
  },
];

const DEFINITIONS_BY_ID: ReadonlyMap<string, ThreeFactorTopNFamilyDefinition> =
  new Map(DEFINITIONS.map(definition => [definition.familyId, definition]));

export function listThreeFactorTopNFamilyDefinitions(): readonly ThreeFactorTopNFamilyDefinition[] {
  return DEFINITIONS;
}

export function resolveThreeFactorTopNFamily(
  familyId: string,
): ThreeFactorTopNFamilyDefinition | null {
  return DEFINITIONS_BY_ID.get(familyId) ?? null;
}

/**
 * 把族补丁拼成完整构建输入；非 3F 或历史快照族直接抛错，
 * 不静默使用 3F 默认值。
 */
export function buildThreeFactorTopNFamilyInput(
  familyId: string,
  coordinates: BuildThreeFactorTopNFamilyCoordinates,
): BuildThreeFactorTopNStrategyDocumentInput {
  const definition = resolveThreeFactorTopNFamily(familyId);
  if (definition === null) {
    throw new Error(`未知的 3F TopN 模式族：${familyId}`);
  }
  if (definition.inputPatch === null) {
    throw new Error(
      `3F TopN 模式族 ${familyId} 不可执行：${definition.historicalOnlyReason ?? "无可用参数"}。`,
    );
  }
  return {
    topN: coordinates.topN,
    datasetVersionId: coordinates.datasetVersionId,
    datasetLabel: coordinates.datasetLabel,
    ...definition.inputPatch,
  };
}

/** 生成族对应的 StrategyDocument；始终复用 canonical builder。 */
export function buildThreeFactorTopNFamilyDocument(
  familyId: string,
  coordinates: BuildThreeFactorTopNFamilyCoordinates,
): StrategyDocument {
  return buildThreeFactorTopNStrategyDocument(
    buildThreeFactorTopNFamilyInput(familyId, coordinates),
  );
}

/**
 * 把族声明的可覆写维度提升为文档的 TUNABLE 参数声明。
 * 仅当补丁里存在对应执行条件时才声明，避免出现无法消费的参数。
 */
export function buildThreeFactorTopNFamilyParameterizedInput(
  familyId: string,
  coordinates: BuildThreeFactorTopNFamilyCoordinates,
  overrides?: Partial<Record<ThreeFactorTopNFamilyTunableParameter["name"], number>>,
): BuildThreeFactorTopNStrategyDocumentInput {
  const input = buildThreeFactorTopNFamilyInput(familyId, coordinates);
  const definition = resolveThreeFactorTopNFamily(familyId);
  if (definition === null || definition.inputPatch === null) {
    throw new Error(`3F TopN 模式族 ${familyId} 不可参数化。`);
  }

  const riskFilter: {
    maxMaxAmplitude?: number;
    maxMeanAmplitude?: number;
    minDrawdownFromEventClose?: number;
  } = { ...(input.entryRiskFilter ?? {}) };
  const tunables: {
    maxMaxAmplitude?: NumberTunable;
    maxMeanAmplitude?: NumberTunable;
    minDrawdownFromEventClose?: NumberTunable;
    stopLossRatio?: NumberTunable;
  } = {};
  let stopLossRatio = input.stopLossRatio;

  for (const parameter of definition.tunableParameters) {
    const declared = {
      defaultValue: parameter.defaultValue,
      min: parameter.min,
      max: parameter.max,
      step: parameter.step,
    };
    const value = overrides?.[parameter.name] ?? parameter.defaultValue;
    if (value < parameter.min || value > parameter.max) {
      throw new Error(
        `3F TopN 模式族 ${familyId} 参数 ${parameter.name}=${String(value)} 超出范围 `
        + `[${String(parameter.min)}, ${String(parameter.max)}]。`,
      );
    }
    if (parameter.name === "stopLossRatio") {
      stopLossRatio = value;
      tunables.stopLossRatio = declared;
      continue;
    }
    riskFilter[parameter.name] = value;
    tunables[parameter.name] = declared;
  }

  const hasRiskFilterDimension =
    riskFilter.maxMaxAmplitude !== undefined
    || riskFilter.maxMeanAmplitude !== undefined
    || riskFilter.minDrawdownFromEventClose !== undefined;

  return {
    ...input,
    ...(stopLossRatio === undefined ? {} : { stopLossRatio }),
    ...(hasRiskFilterDimension ? { entryRiskFilter: riskFilter } : {}),
    ...(Object.keys(tunables).length === 0 ? {} : { tunables }),
  };
}

export function buildThreeFactorTopNFamilyParameterizedDocument(
  familyId: string,
  coordinates: BuildThreeFactorTopNFamilyCoordinates,
  overrides?: Partial<Record<ThreeFactorTopNFamilyTunableParameter["name"], number>>,
): StrategyDocument {
  return buildThreeFactorTopNStrategyDocument(
    buildThreeFactorTopNFamilyParameterizedInput(familyId, coordinates, overrides),
  );
}

// ---------------------------------------------------------------------------
// 族内 arm
// ---------------------------------------------------------------------------

const ARMS_BY_FAMILY: ReadonlyMap<string, ReadonlyMap<string, ThreeFactorTopNFamilyArm>> =
  new Map(
    DEFINITIONS.map(definition => [
      definition.familyId,
      new Map(definition.arms.map(arm => [arm.armId, arm])),
    ]),
  );

/** 列出某族登记的全部留档 arm；未知族返回空数组。 */
export function listThreeFactorTopNFamilyArms(
  familyId: string,
): readonly ThreeFactorTopNFamilyArm[] {
  return resolveThreeFactorTopNFamily(familyId)?.arms ?? [];
}

/** 解析族内某个 arm；未知族或未知 arm 返回 null。 */
export function resolveThreeFactorTopNFamilyArm(
  familyId: string,
  armId: string,
): ThreeFactorTopNFamilyArm | null {
  return ARMS_BY_FAMILY.get(familyId)?.get(armId) ?? null;
}

/**
 * 研究集合：把「某次研究都跑哪些 arm、用什么 CLI 别名」固化为注册表事实，
 * 让入口脚本只引用 studyId，不再自持 arm 列表。成员顺序即脚本默认顺序。
 */
const STUDIES: readonly ThreeFactorTopNStudyDefinition[] = [
  {
    studyId: "entry-study",
    studyLabel: "3F Top3 建仓策略研究",
    members: [
      ...["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"].map(armId => ({
        familyId: "entry-risk-filter-b" as const,
        armId,
      })),
      { familyId: "c6-b4-14-best-combination", armId: "c6b4-14" },
      { familyId: "zero-low-score-allocation", armId: "c7" },
      { familyId: "zero-low-score-allocation", armId: "c8" },
      { familyId: "zero-low-score-allocation", armId: "c9" },
      { familyId: "tiered-position-sizing-c", armId: "c6b4" },
      { familyId: "tiered-position-sizing-c", armId: "c5" },
      { familyId: "tiered-position-sizing-c", armId: "c6" },
      { familyId: "tiered-position-sizing-c", armId: "c1" },
      { familyId: "tiered-position-sizing-c", armId: "c2" },
      { familyId: "tiered-position-sizing-c", armId: "c3" },
      { familyId: "tiered-position-sizing-c", armId: "c4" },
    ],
  },
  {
    studyId: "trailing-policy-study",
    studyLabel: "3F Top3 移动止盈政策研究",
    members: [
      { familyId: "trailing-take-profit", armId: "ma", alias: "ma" },
      { familyId: "trailing-take-profit", armId: "legacy_ma_control", alias: "legacy_ma_control" },
      { familyId: "trailing-take-profit", armId: "atr", alias: "atr" },
      { familyId: "trailing-take-profit", armId: "rlock", alias: "rlock" },
      { familyId: "trailing-take-profit", armId: "giveback", alias: "giveback" },
      { familyId: "trailing-take-profit", armId: "swing", alias: "swing" },
      { familyId: "trailing-take-profit", armId: "sar", alias: "sar" },
      { familyId: "trailing-take-profit", armId: "hybrid", alias: "hybrid" },
      { familyId: "runner-scale-out", armId: "ma_trend", alias: "ma_trend" },
      { familyId: "runner-scale-out", armId: "scale50", alias: "scale50" },
      { familyId: "runner-scale-out", armId: "scale75", alias: "scale75" },
      { familyId: "runner-scale-out", armId: "runner2", alias: "runner2" },
      { familyId: "runner-scale-out", armId: "replace", alias: "replace" },
    ],
  },
] as const;

const STUDIES_BY_ID: ReadonlyMap<string, ThreeFactorTopNStudyDefinition> = new Map(
  STUDIES.map(study => [study.studyId, study]),
);

/** 列出全部研究集合；顺序即注册表声明顺序。 */
export function listThreeFactorTopNStudies(): readonly ThreeFactorTopNStudyDefinition[] {
  return STUDIES;
}

/** 解析研究集合；未知 studyId 返回 null。 */
export function resolveThreeFactorTopNStudy(
  studyId: string,
): ThreeFactorTopNStudyDefinition | null {
  return STUDIES_BY_ID.get(studyId) ?? null;
}

/**
 * 把研究集合成员解析成「族定义 + arm 定义」，一次校验成员引用的族与 arm 都存在。
 * 注册表内部出现悬空引用时立即抛错，避免研究脚本静默少跑。
 */
export function resolveThreeFactorTopNStudyMembers(
  studyId: string,
): readonly {
  readonly alias: string;
  readonly familyId: ThreeFactorTopNFamilyId;
  readonly family: ThreeFactorTopNFamilyDefinition;
  readonly arm: ThreeFactorTopNFamilyArm;
}[] {
  const study = resolveThreeFactorTopNStudy(studyId);
  if (study === null) {
    throw new Error(`未知的 3F TopN 研究集合：${studyId}`);
  }
  return study.members.map(member => {
    const family = resolveThreeFactorTopNFamily(member.familyId);
    const arm = resolveThreeFactorTopNFamilyArm(member.familyId, member.armId);
    if (family === null || arm === null) {
      throw new Error(
        `3F TopN 研究集合 ${studyId} 引用了不存在的 arm：${member.familyId}/${member.armId}`,
      );
    }
    return {
      alias: member.alias ?? member.armId,
      familyId: member.familyId,
      family,
      arm,
    };
  });
}

/**
 * 把族内 arm 补丁拼成完整构建输入。arm 补丁已包含族共享补丁，
 * 这里只补调用坐标；未知族/arm 或 HISTORICAL_ONLY 族直接抛错。
 */
export function buildThreeFactorTopNFamilyArmInput(
  familyId: string,
  armId: string,
  coordinates: BuildThreeFactorTopNFamilyCoordinates,
): BuildThreeFactorTopNStrategyDocumentInput {
  const definition = resolveThreeFactorTopNFamily(familyId);
  if (definition === null) {
    throw new Error(`未知的 3F TopN 模式族：${familyId}`);
  }
  const arm = resolveThreeFactorTopNFamilyArm(familyId, armId);
  if (arm === null) {
    throw new Error(`3F TopN 模式族 ${familyId} 没有 arm=${armId}。`);
  }
  return {
    topN: coordinates.topN,
    datasetVersionId: coordinates.datasetVersionId,
    datasetLabel: coordinates.datasetLabel,
    strategyVersion: arm.strategyVersion,
    ...arm.inputPatch,
  };
}

/** 生成族内 arm 对应的 StrategyDocument；始终复用 canonical builder。 */
export function buildThreeFactorTopNFamilyArmDocument(
  familyId: string,
  armId: string,
  coordinates: BuildThreeFactorTopNFamilyCoordinates,
): StrategyDocument {
  return buildThreeFactorTopNStrategyDocument(
    buildThreeFactorTopNFamilyArmInput(familyId, armId, coordinates),
  );
}

// ---------------------------------------------------------------------------
// 版本详情投影
// ---------------------------------------------------------------------------

/** 版本详情里每条关键取值的来源标签。 */
export type ThreeFactorTopNFamilyDetailSignalSource = "TUNABLE" | "FIXED" | "ASSEMBLY";

export interface ThreeFactorTopNFamilyDetailSignal {
  readonly label: string;
  readonly value: string;
  readonly stage: string;
  readonly effect: string;
  readonly source: ThreeFactorTopNFamilyDetailSignalSource;
}

/**
 * 把一个族的权威定义投影成版本详情可直接展示的关键取值清单。
 *
 * 数值来自 `inputPatch`：`tunableParameters` 里声明的维度标为 TUNABLE，
 * 其余显式执行补丁标为 ASSEMBLY；HISTORICAL_ONLY 族只回到原因说明。
 */
export function describeThreeFactorTopNFamily(
  familyId: string,
): readonly ThreeFactorTopNFamilyDetailSignal[] {
  const definition = resolveThreeFactorTopNFamily(familyId);
  if (definition === null || definition.inputPatch === null) {
    return [];
  }
  return describeThreeFactorTopNFamilyPatch(
    definition.inputPatch,
    new Set(definition.tunableParameters.map(item => item.name)),
  );
}

/**
 * 把一个 arm 的完整补丁投影成版本详情可直接展示的关键取值。
 *
 * arm 的补丁已包含族共享补丁，因此这里只负责格式化和来源标注；
 * 不复制族定义，也不读取构建后的文档。
 */
export function describeThreeFactorTopNFamilyArm(
  familyId: string,
  armId: string,
): readonly ThreeFactorTopNFamilyDetailSignal[] {
  const definition = resolveThreeFactorTopNFamily(familyId);
  const arm = resolveThreeFactorTopNFamilyArm(familyId, armId);
  if (definition === null || arm === null) {
    return [];
  }
  return describeThreeFactorTopNFamilyPatch(
    arm.inputPatch,
    new Set(definition.tunableParameters.map(item => item.name)),
  );
}

function describeThreeFactorTopNFamilyPatch(
  patch: ThreeFactorTopNFamilyInputPatch,
  tunableNames: ReadonlySet<ThreeFactorTopNFamilyTunableParameter["name"]>,
): readonly ThreeFactorTopNFamilyDetailSignal[] {
  const signals: ThreeFactorTopNFamilyDetailSignal[] = [];

  if (patch.stopLossRatio !== undefined) {
    signals.push({
      label: "stopLossRatio",
      value: `${(patch.stopLossRatio * 100).toFixed(2)}%`,
      stage: "止损",
      effect: "持仓跌破固定止损线后退出。",
      source: tunableNames.has("stopLossRatio") ? "TUNABLE" : "ASSEMBLY",
    });
  }

  if (patch.strongHold !== undefined && patch.strongHold !== null) {
    const hold = patch.strongHold;
    const segments = [`第 ${hold.atHoldingDays} 日`];
    if (hold.extendToHoldingDays !== undefined) {
      segments.push(`延长至第 ${hold.extendToHoldingDays} 日`);
    }
    if (hold.afterExtendedHold !== undefined) {
      segments.push(`到期后 ${hold.afterExtendedHold}`);
    }
    if (hold.scaleOutRatio !== undefined && hold.scaleOutRatio !== null) {
      segments.push(`到期减仓 ${(hold.scaleOutRatio * 100).toFixed(0)}%`);
    }
    if (hold.runnerExitAtHoldingDays !== undefined && hold.runnerExitAtHoldingDays !== null) {
      segments.push(`runner 截止第 ${hold.runnerExitAtHoldingDays} 日`);
    }
    signals.push({
      label: "strongHold",
      value: segments.join(" / "),
      stage: "持仓延期",
      effect: "满足续持条件的仓位不按 TIME_EXIT 退出，而是按族策略继续持有或减仓。",
      source: "ASSEMBLY",
    });
  }

  if (patch.excludeEventDayOpenAtLimit === true) {
    signals.push({
      label: "excludeEventDayOpenAtLimit",
      value: "启用",
      stage: "事件过滤",
      effect: "T 日开盘即涨停的一字板 / T 字板被排除，建仓前生效。",
      source: "ASSEMBLY",
    });
  }

  if (patch.trailingTakeProfitTrigger !== undefined) {
    signals.push({
      label: "trailingTakeProfitTrigger",
      value: patch.trailingTakeProfitTrigger,
      stage: "止盈触发",
      effect:
        patch.trailingTakeProfitTrigger === "INTRADAY"
          ? "盈利回撤止盈改为盘中最低价击穿触发线即卖出，不等收盘确认。"
          : "盈利回撤止盈按收盘确认触发。",
      source: "ASSEMBLY",
    });
  }

  if (patch.requirePullback !== undefined) {
    signals.push({
      label: "requirePullback",
      value: String(patch.requirePullback),
      stage: "候选资格",
      effect: patch.requirePullback
        ? "要求观察窗内出现收盘回踩才准入。"
        : "移除观察窗内的收盘回踩门槛，扩大候选池。",
      source: "ASSEMBLY",
    });
  }

  if (patch.trailingPolicy !== undefined && patch.trailingPolicy !== null) {
    signals.push({
      label: "trailingPolicy",
      value: describeTrailingPolicy(patch.trailingPolicy),
      stage: "移动止盈",
      effect: "用收盘确认的移动止盈规则替换固定回撤；读取持仓期最高价、均线与波动率。",
      source: "ASSEMBLY",
    });
  }

  if (patch.observationWindow !== undefined) {
    signals.push({
      label: "observationWindow",
      value: `第 ${patch.observationWindow.start}–${patch.observationWindow.end} 个交易日`,
      stage: "观察窗",
      effect: "入场条件只读取该窗口内的回踩、振幅和破位特征。",
      source: "ASSEMBLY",
    });
  }

  if (patch.positionTiers !== undefined) {
    signals.push({
      label: "positionTiers",
      value: patch.positionTiers
        .map(tier => `≥${(tier.minScore * 100).toFixed(2)} 分 → ${(tier.fraction * 100).toFixed(0)}%`)
        .join(" / "),
      stage: "建仓仓位",
      effect: "按候选 score 命中最高档决定权益比例，替换默认固定仓位。",
      source: "ASSEMBLY",
    });
  }

  if (patch.positionRankTiers !== undefined) {
    signals.push({
      label: "positionRankTiers",
      value: patch.positionRankTiers
        .map(tier => `rank ≤${tier.maxRank} → ${(tier.fraction * 100).toFixed(0)}%`)
        .join(" / "),
      stage: "建仓仓位",
      effect: "改用当日 rank 分档，rank 越靠前仓位越高。",
      source: "ASSEMBLY",
    });
  }

  const riskFilter = patch.entryRiskFilter;
  if (riskFilter?.maxMaxAmplitude !== undefined) {
    signals.push({
      label: "entryRiskFilter.maxMaxAmplitude",
      value: `<${(riskFilter.maxMaxAmplitude * 100).toFixed(0)}%`,
      stage: "入场风险过滤",
      effect: "观察窗历史最高振幅超过阈值的候选被拒绝，限制单票波动暴露。",
      source: tunableNames.has("maxMaxAmplitude") ? "TUNABLE" : "ASSEMBLY",
    });
  }
  if (riskFilter?.maxMeanAmplitude !== undefined) {
    signals.push({
      label: "entryRiskFilter.maxMeanAmplitude",
      value: `<${(riskFilter.maxMeanAmplitude * 100).toFixed(0)}%`,
      stage: "入场风险过滤",
      effect: "观察窗平均振幅高于阈值的候选被拒绝。",
      source: tunableNames.has("maxMeanAmplitude") ? "TUNABLE" : "ASSEMBLY",
    });
  }
  if (riskFilter?.minDrawdownFromEventClose !== undefined) {
    signals.push({
      label: "entryRiskFilter.minDrawdownFromEventClose",
      value: `${(riskFilter.minDrawdownFromEventClose * 100).toFixed(0)}%`,
      stage: "入场风险过滤",
      effect: "观察窗最低价相对首板收盘的破位超过阈值时拒绝入场。",
      source: tunableNames.has("minDrawdownFromEventClose") ? "TUNABLE" : "ASSEMBLY",
    });
  }

  if (patch.exitPolicy !== undefined) {
    signals.push({
      label: "exitPolicy",
      value: "SL-18.1 统一退出链",
      stage: "退出装配",
      effect: "沿用止损政策搜索的最优/控制链，统一 stop / takeProfit / timeExit / strongHold / capitalRecycle。",
      source: "ASSEMBLY",
    });
  }

  return signals;
}

function describeTrailingPolicy(policy: ResearchTrailingPolicyDefinition): string {
  switch (policy.kind) {
    case "MA_CROSS":
      return `MA${policy.fastWindow}/MA${policy.slowWindow} 收盘确认（激活 ${(policy.activationRatio * 100).toFixed(0)}%）`;
    case "ATR_CHANDELIER":
      return `Chandelier ${String(policy.atrMultiplier)}×ATR${policy.atrWindow}`;
    case "R_MULTIPLE":
      return `R 倍利润锁 ${policy.lockLadder
        .map(rung => `${String(rung.triggerR)}R→${String(rung.lockR)}R`)
        .join(" / ")}`;
    case "PROFIT_GIVEBACK":
      return `利润回吐 ${(policy.givebackFraction * 100).toFixed(0)}%`;
    case "SWING_LOW":
      return `${policy.lookbackDays} 日结构低点`;
    case "PARABOLIC_SAR":
      return `Parabolic SAR 收盘确认（step ${String(policy.step)} / max ${String(policy.maxStep)}）`;
    case "HYBRID":
      return `MA${policy.fastWindow} + ATR${policy.atrWindow} ${String(policy.atrMultiplier)}× 地板混合`;
  }
}
