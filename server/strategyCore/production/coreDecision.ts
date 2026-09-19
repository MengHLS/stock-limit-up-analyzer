/**
 * STRATEGY-ARCH-002 — Core 决策源（**生产链路上 StrategyRuntime 的唯一接线件**）。
 *
 * ## 它在链路里的位置
 *
 * ```
 * pipeline.runResearchPipeline
 *   └── signalBuilder({ securityId, date, features, bars, point })   ← STEP 10 的既有注入点
 *         └── createCoreDecisionSource(...).signalBuilder
 *               └── StrategyRuntime.evaluate(version, parameterSet, context)   ← 🔴 唯一策略判定
 *                     └── StrategyDecision
 *   └── pipeline 回填 ResearchSignal{ value: features[rankFeatureId] }
 * ```
 *
 * 关键性质：**没有在 pipeline 里新增分支**、**没有复制任何撮合 / 排序 / 选择逻辑**。
 * `signalBuilder` 本来就是 `Strategy13` 的可注入函数（`framework/signal.ts`），
 * 本模块只是把它换成「由 Core 决定要不要出信号」的那一个。
 *
 * ## 🔴 排序值是**消费方**的量，不进 Core（规格 §12 / §13）
 *
 * `StrategyRuntime` 明确不做 ranking（那属于组合 / 执行引擎）。横截面排序由 pipeline 的
 * `rankingConfig` 负责，其输入 `ResearchSignal.value` 取**装配层声明的排序特征**
 * （`StrategyRecipeRuntime` 的 `rankFeatureId` 语义）。本模块据此从 `features` 里取该值：
 * 取不到 ⇒ 返回 `null`（该证券不进候选）—— 与 legacy `makeGatedSignalBuilder` 的行为一致。
 *
 * ## 与 legacy `SignalBuilder` 的语义差异（**必须知道**，详见实施报告 §Legacy/Core 对比）
 *
 * legacy 门槛型配方：**逐日**看「当天是否满足门槛」，满足就出信号（无窗口 / 无触发概念）。
 * Core：`SEQUENCE[EVENT, WINDOW(T+start..T+end, ANY_DAY), TRIGGER]` —— 由**策略文档声明的**
 * `observationWindow` + `trigger` 决定哪一天出信号。⇒ 当文档声明的 trigger 是
 * `FIRST_VALID_DAY` / `NEXT_TRADING_DAY` 时，Core 只在**唯一一天**出信号，而 legacy 会出多次。
 * 这条差异**不是本模块引入的**：它是 legacy 执行侧没有实现自己文档所声明的 trigger。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import type { CanonicalMarketBar, DecisionPoint } from "../../data";
import type { ResearchSignal } from "../../research/framework/contract";
import type { SignalBuilder } from "../../research/framework/signal";
import { directionFromValue } from "../../research/framework/signal";
import type { RelativeDay } from "../types";
import { StrategyRuntime, type RuntimeState } from "../runtime";
import type { StrategyVersion } from "../version";
import type { ParameterSet } from "../parameterResolver";
import type { ResolvedParameterSet } from "../parameterResolver";
import type { StrategyDecision } from "../decision";
import { fingerprintOf } from "../canonical";
import {
  coreDatasetCapability,
  describeAnchorPolicy,
  emptyCoreBarWindow,
  toCoreBarWindow,
  type EventAnchorPolicy,
} from "./barWindow";
import type { ProductionEventResolver } from "./eventSource";

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

export interface CoreDecisionSourceConfig {
  readonly version: StrategyVersion;
  readonly parameterSet: ParameterSet;
  /** 排序特征 id（**取自装配层声明的 recipe**，不是 Core 的概念）。`null` ⇒ 无排序值。 */
  readonly rankFeatureId: string | null;
  /** 决策时点（来自 recipe 的 `point`）。 */
  readonly point: DecisionPoint;
  /** 事件判定器（生产注入；未提供则 Core 会响亮抛错）。 */
  readonly eventResolver?: ProductionEventResolver;
  readonly anchorPolicy?: EventAnchorPolicy;
  /** 事件类型闭集（进能力声明，供兼容性校验比对）。 */
  readonly eventTypes?: readonly string[];
  /**
   * 数据集在事件日之后的真实覆盖深度（整份数据集的最远相对日）。
   *
   * 🔴 缺省**不填**（= 未知 ⇒ 不做视界校验）。逐决策日求值时这个量不可知，
   * 编一个「= 当前相对日」会误杀所有早期决策日；运行级校验请在装配层用整份数据集做一次。
   */
  readonly datasetHorizonRelativeDay?: RelativeDay;
  /** 决策样本留存上限（诊断用，**不参与判定**；缺省 24）。 */
  readonly maxSamples?: number;
}

/** 单条决策的行为面摘要（**有界采样**，仅用于诊断 / 复现对照）。 */
export interface StrategyDecisionSample {
  readonly securityId: string;
  readonly tradeDate: string;
  readonly currentRelativeDay: RelativeDay;
  readonly barCount: number;
  readonly eventCount: number;
  readonly conditionCount: number;
  readonly satisfiedConditionCount: number;
  readonly signalCount: number;
  readonly entryIntentCount: number;
  readonly insufficientData: boolean;
  readonly emitted: boolean;
  readonly rankValue: number | null;
  /** 决策解释（Core 由结构生成，非手写文案）。 */
  readonly explanation: readonly string[];
}

/**
 * 决策摘要（**进 RunRecord 持久化**）。
 *
 * 🔴 为什么是摘要而不是全量决策：一次运行可达 10^5 条决策 × 每条含 ruleTrace ⇒ 全量会
 * 把 `resultJson` 撑到数百 MB。摘要保留**全部计数 + 行为面滚动指纹 + 有界样本**：
 * 「跑出了什么」可逐字节比对（指纹），「为什么」可抽样回看。
 */
export interface StrategyDecisionDigest {
  readonly decisionCount: number;
  readonly emittedSignalCount: number;
  readonly totalSignalCount: number;
  readonly totalEventHitCount: number;
  readonly totalConditionCount: number;
  readonly totalSatisfiedConditionCount: number;
  readonly insufficientDataCount: number;
  readonly droppedNoSignalCount: number;
  readonly droppedMissingRankValueCount: number;
  readonly undecidableAnchorCount: number;
  readonly occurredEventCount: number;
  readonly notOccurredEventCount: number;
  readonly minBarCount: number;
  readonly maxBarCount: number;
  readonly maxRelativeDayObserved: RelativeDay;
  /**
   * 行为面滚动指纹（逐决策 `digest = H(digest ‖ 决策摘要)`）。
   *
   * ⚠️ **不是策略指纹** —— 策略指纹是 `computeDefinitionFingerprint(definition)`
   * （Core `fingerprint.ts`，唯一实现）。本指纹是「这一批决策」的摘要，用于
   * 「同一份配置重跑是否逐字节相同」与「复现是否等价」的判定。
   */
  readonly decisionDigestFingerprint: string;
  readonly samples: readonly StrategyDecisionSample[];
}

export interface CoreDecisionSource {
  readonly signalBuilder: SignalBuilder;
  readonly digest: () => StrategyDecisionDigest;
  readonly resolvedParameterSet: () => ResolvedParameterSet;
  /** 口径说明（进 RunSnapshot notes）。 */
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SAMPLES = 24;

export function createCoreDecisionSource(config: CoreDecisionSourceConfig): CoreDecisionSource {
  const maxSamples = config.maxSamples ?? DEFAULT_MAX_SAMPLES;
  const anchorPolicy = config.anchorPolicy ?? "SERIES_START";

  let decisionCount = 0;
  let emittedSignalCount = 0;
  let totalSignalCount = 0;
  let totalEventHitCount = 0;
  let totalConditionCount = 0;
  let totalSatisfiedConditionCount = 0;
  let insufficientDataCount = 0;
  let droppedNoSignal = 0;
  let droppedMissingRank = 0;
  let minBarCount = Number.POSITIVE_INFINITY;
  let maxBarCount = 0;
  let maxRelativeDayObserved = 0 as RelativeDay;
  const samples: StrategyDecisionSample[] = [];
  let rolling = "";
  let resolvedParameterSet: ResolvedParameterSet | null = null;

  const signalBuilder: SignalBuilder = (input) => {
    const bars: readonly CanonicalMarketBar[] = input.bars ?? [];
    const point: DecisionPoint = input.point ?? config.point;
    const window = toCoreBarWindow(bars, { anchorPolicy });
    if (window.barCount === 0) {
      // 无 bar：不是「今天没信号」，是「拿不到数据」。如实计为数据不足，不出信号。
      insufficientDataCount += 1;
      return null;
    }

    const state: RuntimeState = { positionState: "FLAT", openPositions: 0 };
    const detail = StrategyRuntime.evaluateWithDetail(
      config.version,
      config.parameterSet,
      {
        timestamp: { date: input.date, point },
        instrument: { securityId: input.securityId, code: input.securityId },
        visibleData: window.universe,
        currentRelativeDay: window.currentRelativeDay,
        state,
        datasetCapability: coreDatasetCapability({
          anchorPolicy,
          ...(config.eventTypes !== undefined ? { eventTypes: config.eventTypes } : {}),
          ...(config.datasetHorizonRelativeDay === undefined
            ? {}
            : { horizonRelativeDay: config.datasetHorizonRelativeDay }),
          minBarCount: window.barCount,
        }),
        ...(config.eventResolver !== undefined
          ? {
              resolveEvent: config.eventResolver.resolve,
              // 事件日字段：锚定 bar 的原始值（供 `event.*` 字段引用）。缺 OHLC 时留空
              // —— 需要它的条件会得到 null（不臆造），由条件求值如实体现。
              eventFields: eventFieldsOf(window.universe.bars.find((bar) => bar.relativeDay === 0) ?? null),
            }
          : {}),
      },
      {
        // 生产路径必须跑数据兼容性校验；此处不跳过。
      },
    );

    resolvedParameterSet = detail.resolvedParameters;
    const decision = detail.decision;

    decisionCount += 1;
    if (decision.insufficientData) insufficientDataCount += 1;
    totalSignalCount += decision.signals.length;
    totalEventHitCount += decision.events.length;
    totalConditionCount += decision.conditions.length;
    totalSatisfiedConditionCount += decision.conditions.filter((item) => item.satisfied === true).length;
    minBarCount = Math.min(minBarCount, window.barCount);
    maxBarCount = Math.max(maxBarCount, window.barCount);
    maxRelativeDayObserved = Math.max(maxRelativeDayObserved, window.currentRelativeDay) as RelativeDay;

    const rankValue =
      config.rankFeatureId === null ? null : readFeature(input.features, config.rankFeatureId);

    // 🔴 「**今天**出不出信号」需要独立求一次「昨天是否已经成立」。
    //
    // 实测结论（本轮）：`StrategyDecision.signals[].signalDay` 取的是**本次求值的当前日**，
    // 而 `ruleEvaluation.satisfied` 表达的是「当前决策日及之前，规则图是否已成立」
    // —— 对 `WINDOW(ANY_DAY)` + `FIRST_VALID_DAY` 这类语义，rd=3 求值时「已成立」为真
    // （因为 rd=2 就成立过）。若直接据此出信号，**同一个触发会被后续每个决策日重复消费**
    // （正是 legacy 逐日重复信号的机理）。
    //
    // ⇒ 判据 = 「今天成立 且 昨天尚未成立」= 首个成立日。为此再求一次「截到昨天窗口」的评估。
    //    代价 = 求值次数 ×2；收益 = 与声明语义（`WINDOW` + `TRIGGER`）逐字一致，且**与调用顺序无关**。
    const currentDay = window.currentRelativeDay;
    const satisfiedToday = detail.ruleEvaluation.satisfied;
    const satisfiedBefore =
      currentDay <= 0
        ? false
        : StrategyRuntime.evaluateWithDetail(
            config.version,
            config.parameterSet,
            {
              timestamp: { date: input.date, point },
              instrument: { securityId: input.securityId, code: input.securityId },
              visibleData: {
                bars: window.universe.bars.filter((bar) => bar.relativeDay < currentDay),
                maxRelativeDay: (currentDay - 1) as RelativeDay,
              },
              currentRelativeDay: (currentDay - 1) as RelativeDay,
              state,
              datasetCapability: coreDatasetCapability({
                anchorPolicy,
                ...(config.eventTypes !== undefined ? { eventTypes: config.eventTypes } : {}),
                minBarCount: Math.max(1, window.barCount - 1),
              }),
              ...(config.eventResolver !== undefined
                ? {
                    resolveEvent: config.eventResolver.resolveQuiet,
                    eventFields: eventFieldsOf(window.universe.bars.find((bar) => bar.relativeDay === 0) ?? null),
                  }
                : {}),
            },
            {},
          ).ruleEvaluation.satisfied;

    /**
     * 触发点 = 首个成立日。`FIRST_VALID_DAY` / `NEXT_TRADING_DAY` 这类「单点触发」语义下，
     * 只有 transition（昨天不成立 → 今天成立）才是「今天要买」。
     */
    const firesToday = satisfiedToday && !satisfiedBefore;

    let emitted = false;
    let signal: ResearchSignal | null = null;
    if (firesToday && rankValue !== null) {
      emitted = true;
      emittedSignalCount += 1;
      signal = {
        securityId: input.securityId,
        date: input.date,
        value: rankValue,
        direction: directionFromValue(rankValue),
      };
    } else if (!firesToday) {
      droppedNoSignal += 1;
    } else {
      droppedMissingRank += 1;
    }

    // 滚动指纹：只吃**行为面**（不含时间戳 / 解释文本里的日期无关部分），
    // 同一配置重跑必得同一指纹。
    rolling = fingerprintOf({
      previous: rolling,
      securityId: input.securityId,
      date: input.date,
      currentRelativeDay: window.currentRelativeDay,
      barCount: window.barCount,
      events: decision.events.map((event) => ({ nodeId: event.nodeId, eventType: event.eventType, day: event.occurredAtDay })),
      signals: decision.signals.map((item) => ({ nodeId: item.nodeId, signalDay: item.signalDay, triggerType: item.triggerType })),
      conditions: decision.conditions.map((item) => ({ nodeId: item.nodeId, satisfied: item.satisfied })),
      exitIntents: decision.exitIntents.map((item) => ({ nodeId: item.nodeId, intent: item.intent })),
      entryIntents: decision.entryIntents.map((item) => ({ signalNodeId: item.signalNodeId, intent: item.intent })),
      insufficientData: decision.insufficientData,
      emitted,
    });

    if (samples.length < maxSamples) {
      samples.push({
        securityId: input.securityId,
        tradeDate: input.date,
        currentRelativeDay: window.currentRelativeDay,
        barCount: window.barCount,
        eventCount: decision.events.length,
        conditionCount: decision.conditions.length,
        satisfiedConditionCount: decision.conditions.filter((item) => item.satisfied === true).length,
        signalCount: decision.signals.length,
        entryIntentCount: decision.entryIntents.length,
        insufficientData: decision.insufficientData,
        emitted,
        rankValue,
        explanation: decision.explanation,
      });
    }

    return signal;
  };

  return {
    signalBuilder,
    resolvedParameterSet: () => {
      if (resolvedParameterSet === null) {
        throw new Error(
          "resolvedParameterSet 尚未产生：本决策源至少被求值一次后才有解（拒绝伪造一份「解析结果」）",
        );
      }
      return resolvedParameterSet;
    },
    digest: () => ({
      decisionCount,
      emittedSignalCount,
      totalSignalCount,
      totalEventHitCount,
      totalConditionCount,
      totalSatisfiedConditionCount,
      insufficientDataCount,
      droppedNoSignalCount: droppedNoSignal,
      droppedMissingRankValueCount: droppedMissingRank,
      undecidableAnchorCount: config.eventResolver?.undecidableCount() ?? 0,
      occurredEventCount: config.eventResolver?.occurredCount() ?? 0,
      notOccurredEventCount: config.eventResolver?.notOccurredCount() ?? 0,
      minBarCount: Number.isFinite(minBarCount) ? minBarCount : 0,
      maxBarCount,
      maxRelativeDayObserved,
      decisionDigestFingerprint: rolling,
      samples: [...samples],
    }),
    notes: [
      describeAnchorPolicy(anchorPolicy),
      "决策由 StrategyRuntime.evaluate 产出（唯一执行入口）；排序 / 选择由 pipeline 的既有权衡负责",
      config.datasetHorizonRelativeDay === undefined
        ? "数据集视界未声明 ⇒ 兼容性报告**不做视界校验**（逐决策日该量不可知，编一个会误杀早期决策日）；「读不读得到未来」由 PIT 关卡在访问点拒绝"
        : "数据集视界 = T+" + String(config.datasetHorizonRelativeDay) + "（进兼容性校验）",
      ...(config.eventResolver !== undefined ? config.eventResolver.notes : ["⚠️ 未注入事件判定器：事件型策略会在首次求值时响亮抛错"]),
    ],
  };
}

/** 事件日字段：把锚定 bar 的原始量暴露给 `event.*` 字段引用（缺值不臆造）。 */
function eventFieldsOf(bar: { open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null } | null): Readonly<Record<string, number | null>> {
  if (bar === null) return {};
  return {
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

function readFeature(
  features: Readonly<Record<string, number | null>>,
  featureId: string,
): number | null {
  const value = features[featureId];
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  return value;
}

// ---------------------------------------------------------------------------
// 空决策源（不接线时的显式占位；**不是**静默兜底）
// ---------------------------------------------------------------------------

/** 决策摘要的零值（尚未求值 / 未接线时使用；`decisionDigestFingerprint` 恒为空串）。 */
export function emptyDecisionDigest(): StrategyDecisionDigest {
  return {
    decisionCount: 0,
    emittedSignalCount: 0,
    totalSignalCount: 0,
    totalEventHitCount: 0,
    totalConditionCount: 0,
    totalSatisfiedConditionCount: 0,
    insufficientDataCount: 0,
    droppedNoSignalCount: 0,
    droppedMissingRankValueCount: 0,
    undecidableAnchorCount: 0,
    occurredEventCount: 0,
    notOccurredEventCount: 0,
    minBarCount: 0,
    maxBarCount: 0,
    maxRelativeDayObserved: 0,
    decisionDigestFingerprint: "",
    samples: [],
  };
}

/** 便捷：由决策取「该证券当次是否出信号」（消费方最常用的一问）。 */
export function decisionEmittedSignal(decision: StrategyDecision): boolean {
  return decision.signals.length > 0;
}

/** 供 barWindow 的空窗口单元测试直接引用（避免测试复制粘贴）。 */
export { emptyCoreBarWindow };
