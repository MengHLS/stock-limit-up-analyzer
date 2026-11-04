/**
 * STRATEGY-ARCH-001 — Feature Registry（规格 §8）。
 *
 * 解决的问题（对照 legacy）：
 *   - 特征 id 是**散落的常量对象**（`PULLBACK_FEATURE_IDS` / `PCT_CHANGE_FEATURE_ID`），
 *     没有统一注册表 ⇒ 新增特征要改多处；
 *   - **没有 `lookback` 声明** ⇒ 无法判断数据够不够；
 *   - `availability` 被恒置成远古日期（`EPOCH_FLOOR_DATE = "1990-01-01"`）
 *     ⇒ `LeakageGuard` **恒通过**（守卫形同虚设）。
 *
 * 本模块给出：
 *   FeatureDefinition { featureId, version, inputs, lookback, leakage, compute }
 *   FeatureRegistry   { get / list / has / resolveRequirements }
 *
 * 🔴 `leakage` 声明是**相对当前 bar** 的（不是绝对日期）：
 *   - `usesForwardData` 必须为 `false`（为 true 的特征是「未来结果类」变量，
 *     **不允许被注册为策略特征**，注册表直接拒绝）；
 *   - `dataThroughRelativeDay` 必须 `<= 0`（0 = 只需当前 bar；-n = 需要前 n 根）；
 *   - `availableAtPoint`：`close` 的特征在 `open` 时点的决策中不可用（守卫会拒）。
 *
 * ⇒ 未来函数防护**落在声明上且可被静态判定**，不再依赖「恒为远古日期」的假声明。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random；`compute` 必须是纯函数。
 */

import {
  STRATEGY_CORE_ERROR_CODES,
  StrategyCoreError,
  validationIssue,
  type CoreValidationIssue,
  type CoreValue,
  type EvaluationTime,
  type RelativeDay,
  type StrategyCoreErrorCode,
} from "./types";
import type { VisibleBar } from "./temporal";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 泄漏声明（相对当前 bar；唯一权威）。 */
export interface FeatureLeakageDeclaration {
  /** 是否使用未来数据（**策略特征必须为 false**；未来结果类变量不得作为策略特征）。 */
  readonly usesForwardData: boolean;
  /** 该特征完整计算所需数据的最远相对日（相对当前 bar；必须 <= 0）。 */
  readonly dataThroughRelativeDay: RelativeDay;
  /** 该特征在当日哪个时点可用。 */
  readonly availableAtPoint: "open" | "close";
}

/**
 * 特征可见历史模式。
 *
 * - `TRAILING_BARS`：既有语义，Runtime 按 `lookback` 截取最后 N 根可见 bar。
 * - `EVENT_TO_CURRENT`：Runtime 传入 `barsUpTo(当前日)` 的**完整可见序列**；
 *   特征自行决定从事件日（relativeDay=0）还是更早的 prefix 历史开始读取。
 *
 * `historyMode` 缺省等价于 `TRAILING_BARS`，因此旧特征无需增加字段即可保持行为不变。
 */
export const FEATURE_HISTORY_MODES = ["TRAILING_BARS", "EVENT_TO_CURRENT"] as const;
export type FeatureHistoryMode = (typeof FEATURE_HISTORY_MODES)[number];
export const DEFAULT_FEATURE_HISTORY_MODE: FeatureHistoryMode = "TRAILING_BARS";

/** 特征计算输入（由 Runtime 按 `historyMode` 准备）。 */
export interface FeatureComputeContext {
  /** 决策时点。 */
  readonly asOf: EvaluationTime;
  /**
   * 升序可见 bar，**最后一根 = 当前 bar**。
   * `TRAILING_BARS` 长度 >= `lookback`；`EVENT_TO_CURRENT` 为当前日及之前的完整可见序列。
   */
  readonly bars: readonly VisibleBar[];
  /** 事件日 bar（相对日 0）；不在可见范围时为 null。 */
  readonly eventDayBar: VisibleBar | null;
  /** 事件日字段读取（`event.limitUpPrice` 等）。 */
  readonly eventField: (field: string) => CoreValue;
  /** 已解析参数。 */
  readonly parameters: Readonly<Record<string, CoreValue>>;
}

/** 特征定义。 */
export interface FeatureDefinition {
  readonly featureId: string;
  readonly version: string;
  /** 消费的数据列 / 域（可读性 + 审计用）。 */
  readonly inputs: readonly string[];
  /** 需要的历史 bar 根数（**含当前 bar**；>= 1）。 */
  readonly lookback: number;
  /**
   * 可见历史如何交给 `compute`。缺省 = `TRAILING_BARS`（旧特征行为不变）。
   * `EVENT_TO_CURRENT` 由 Runtime 传入完整 `barsUpTo(当前日)`，不按 `lookback` 截断。
   */
  readonly historyMode?: FeatureHistoryMode;
  readonly leakage: FeatureLeakageDeclaration;
  readonly description?: string;
  /** 纯函数：给定可见数据求特征值；数据不足 ⇒ 返回 null（**不臆造**）。 */
  readonly compute: (context: FeatureComputeContext) => CoreValue;
}

/** 特征需求（Strategy 只声明这一面；实现来自注册表）。 */
export interface FeatureRequirement {
  readonly featureId: string;
  readonly version: string;
}

/** 特征注册表。 */
export interface FeatureRegistry {
  has(featureId: string): boolean;
  get(featureId: string): FeatureDefinition | null;
  list(): readonly FeatureDefinition[];
  /** 解析需求：登记且版本一致 ⇒ 返回定义；否则抛错（不静默用别的版本）。 */
  resolve(requirement: FeatureRequirement): FeatureDefinition;
}

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

function validateFeatureDefinition(definition: FeatureDefinition): readonly CoreValidationIssue[] {
  const issues: CoreValidationIssue[] = [];
  const at = "feature." + definition.featureId;
  if (definition.featureId.trim() === "") {
    issues.push(validationIssue("FEATURE_NOT_REGISTERED", at, "featureId 不能为空"));
  }
  if (definition.version.trim() === "") {
    issues.push(validationIssue("FEATURE_VERSION_MISMATCH", at, "version 不能为空"));
  }
  if (!Number.isInteger(definition.lookback) || definition.lookback < 1) {
    issues.push(validationIssue("FEATURE_LOOKBACK_INSUFFICIENT", at, "lookback 必须是 >= 1 的整数"));
  }
  if (
    definition.historyMode !== undefined
    && !(FEATURE_HISTORY_MODES as readonly string[]).includes(definition.historyMode)
  ) {
    issues.push(
      validationIssue(
        "CORE_DEFINITION_INVALID",
        at + ".historyMode",
        "historyMode 必须是 TRAILING_BARS / EVENT_TO_CURRENT 之一，实际 " + String(definition.historyMode),
      ),
    );
  }
  if (definition.leakage.usesForwardData) {
    issues.push(
      validationIssue(
        "LEAKAGE_LOOK_AHEAD",
        at + ".leakage",
        "usesForwardData=true 的特征是「未来结果类」变量，禁止注册为策略特征（规格 §15）",
      ),
    );
  }
  if (definition.leakage.dataThroughRelativeDay > 0) {
    issues.push(
      validationIssue(
        "LEAKAGE_LOOK_AHEAD",
        at + ".leakage",
        "dataThroughRelativeDay=" + String(definition.leakage.dataThroughRelativeDay) + " > 0 ⇒ 需要未来数据，禁止注册为策略特征",
      ),
    );
  }
  return issues;
}

/**
 * 创建注册表（**数据驱动**：新增特征只是往 `definitions` 里加一项，不需要改本模块任何代码）。
 * 重复 featureId / 非法定义 ⇒ 响亮抛错（不静默后者覆盖前者）。
 */
export function createFeatureRegistry(definitions: readonly FeatureDefinition[]): FeatureRegistry {
  const map = new Map<string, FeatureDefinition>();
  for (const definition of definitions) {
    const issues = validateFeatureDefinition(definition);
    if (issues.length > 0) {
      const first = issues[0] as CoreValidationIssue;
      // 🔴 用**第一条 issue 自己的 code**（而不是把所有的都标成 FEATURE_NOT_REGISTERED）：
      //    否则「lookback 非法」「声明了未来依赖」这类问题会被误报成「未注册」，排错时误导。
      const code = (STRATEGY_CORE_ERROR_CODES as readonly string[]).includes(first.code)
        ? (first.code as StrategyCoreErrorCode)
        : "FEATURE_NOT_REGISTERED";
      throw new StrategyCoreError(code, issues.map((i) => i.path + ": " + i.message).join(" | "), {
        featureId: definition.featureId,
        firstIssue: first.code,
        issueCount: issues.length,
      });
    }
    if (map.has(definition.featureId)) {
      throw new StrategyCoreError(
        "FEATURE_VERSION_MISMATCH",
        "特征 id 重复注册：" + definition.featureId + "（禁止后者静默覆盖前者）",
      );
    }
    map.set(definition.featureId, Object.freeze(definition));
  }
  const list = Object.freeze([...map.values()].sort((a, b) => (a.featureId < b.featureId ? -1 : a.featureId > b.featureId ? 1 : 0)));
  return {
    has: (featureId: string) => map.has(featureId),
    get: (featureId: string) => map.get(featureId) ?? null,
    list: () => list,
    resolve: (requirement: FeatureRequirement) => {
      const found = map.get(requirement.featureId);
      if (found === undefined) {
        throw new StrategyCoreError(
          "FEATURE_NOT_REGISTERED",
          "特征 " + requirement.featureId + " 未在 FeatureRegistry 注册（已注册：" + list.map((d) => d.featureId).join("、") + "）",
          { featureId: requirement.featureId },
        );
      }
      if (found.version !== requirement.version) {
        throw new StrategyCoreError(
          "FEATURE_VERSION_MISMATCH",
          "特征 " + requirement.featureId + " 版本不一致：策略声明 " + requirement.version + "，注册表为 " + found.version,
          { declared: requirement.version, registered: found.version },
        );
      }
      return found;
    },
  };
}

// ---------------------------------------------------------------------------
// 常用工具
// ---------------------------------------------------------------------------

function lastBar(bars: readonly VisibleBar[]): VisibleBar | null {
  return bars.length === 0 ? null : (bars[bars.length - 1] as VisibleBar);
}

/** 无未来依赖的特征声明（`dataThroughRelativeDay` 缺省 0）。 */
export function sameBarLeakage(
  availableAtPoint: "open" | "close" = "close",
  dataThroughRelativeDay: RelativeDay = 0,
): FeatureLeakageDeclaration {
  return { usesForwardData: false, dataThroughRelativeDay, availableAtPoint };
}

// ---------------------------------------------------------------------------
// 内置特征（指标）
// ---------------------------------------------------------------------------

export const BUILTIN_FEATURE_VERSION = "1.0.0";

/** 简单移动平均（收盘价）。 */
export function makeSmaFeature(window: number): FeatureDefinition {
  return {
    featureId: "ma" + String(window),
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["close"],
    lookback: window,
    leakage: sameBarLeakage("close", 0),
    description: window + " 日收盘简单移动平均",
    compute: (context) => {
      const bars = context.bars.slice(-window);
      if (bars.length < window) return null;
      let sum = 0;
      for (const bar of bars) {
        if (bar.close === null) return null;
        sum += bar.close;
      }
      return sum / window;
    },
  };
}

/** 指数移动平均（收盘价）。 */
export function makeEmaFeature(window: number): FeatureDefinition {
  return {
    featureId: "ema" + String(window),
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["close"],
    lookback: window,
    leakage: sameBarLeakage("close", 0),
    description: window + " 日收盘指数移动平均",
    compute: (context) => {
      const bars = context.bars.slice(-window);
      if (bars.length < window) return null;
      const alpha = 2 / (window + 1);
      let value: number | null = null;
      for (const bar of bars) {
        if (bar.close === null) return null;
        value = value === null ? bar.close : alpha * bar.close + (1 - alpha) * value;
      }
      return value;
    },
  };
}

/** 相对强弱指标（Wilder 平滑的简化实现：等权平均涨跌幅）。 */
export function makeRsiFeature(window: number): FeatureDefinition {
  return {
    featureId: "rsi" + String(window),
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["close"],
    lookback: window + 1,
    leakage: sameBarLeakage("close", 0),
    description: window + " 日相对强弱指标（0~100）",
    compute: (context) => {
      const bars = context.bars.slice(-(window + 1));
      if (bars.length < window + 1) return null;
      let gains = 0;
      let losses = 0;
      for (let index = 1; index < bars.length; index += 1) {
        const current = bars[index] as VisibleBar;
        const previous = bars[index - 1] as VisibleBar;
        if (current.close === null || previous.close === null) return null;
        const change = current.close - previous.close;
        if (change >= 0) gains += change;
        else losses += -change;
      }
      if (gains + losses === 0) return 50;
      if (losses === 0) return 100;
      const rs = gains / losses;
      return 100 - 100 / (1 + rs);
    },
  };
}

/** 平均真实波幅（ATR；Wilder 简化实现）。 */
export function makeAtrFeature(window: number): FeatureDefinition {
  return {
    featureId: "atr" + String(window),
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["high", "low", "close"],
    lookback: window + 1,
    leakage: sameBarLeakage("close", 0),
    description: window + " 日平均真实波幅",
    compute: (context) => {
      const bars = context.bars.slice(-(window + 1));
      if (bars.length < window + 1) return null;
      const ranges: number[] = [];
      for (let index = 1; index < bars.length; index += 1) {
        const current = bars[index] as VisibleBar;
        const previous = bars[index - 1] as VisibleBar;
        if (current.high === null || current.low === null || previous.close === null) return null;
        const trueRange = Math.max(
          current.high - current.low,
          Math.abs(current.high - previous.close),
          Math.abs(current.low - previous.close),
        );
        ranges.push(trueRange);
      }
      if (ranges.length === 0) return null;
      return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
    },
  };
}

/** 当日涨跌幅 `close / preClose - 1`。 */
export function makePctChangeFeature(): FeatureDefinition {
  return {
    featureId: "pctChange",
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["close", "preClose"],
    lookback: 1,
    leakage: sameBarLeakage("close", 0),
    description: "当日涨跌幅（需要 preClose）",
    compute: (context) => {
      const bar = lastBar(context.bars);
      if (bar === null || bar.close === null || bar.preClose === null || bar.preClose === undefined || bar.preClose === 0) {
        return null;
      }
      return bar.close / bar.preClose - 1;
    },
  };
}

// ---------------------------------------------------------------------------
// 事件相对特征（对齐 legacy 口径；基准改为**显式事件日 bar**）
// ---------------------------------------------------------------------------

/**
 * 🔴 与 legacy 的关键差别：legacy 的 `eventBaselineOf(bars)` 直接取 `bars[0]` 当作首板日
 * （文件自述「窗口左边界未预热时特征会偏 —— 已知限制」）。core 改为使用
 * `context.eventDayBar`（相对日 0 的 bar），**基准缺失即返回 null**，不再假定 `bars[0]`。
 */
export function makePullbackFeatures(): readonly FeatureDefinition[] {
  const baselineOpen = (context: FeatureComputeContext): number | null => {
    const event = context.eventDayBar;
    if (event === null || event.open === null) return null;
    if (event.open === 0) return null;
    return event.open;
  };

  const haircut: FeatureDefinition = {
    featureId: "haircutFromEventLow",
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["low", "event.open"],
    lookback: 1,
    leakage: sameBarLeakage("close", 0),
    description: "回撤深度：(事件日开盘 − 当前 bar 最低) / 事件日开盘；> 0 表示跌破事件日开盘",
    compute: (context) => {
      const base = baselineOpen(context);
      if (base === null) return null;
      const bar = lastBar(context.bars);
      if (bar === null || bar.low === null) return null;
      return (base - bar.low) / base;
    },
  };

  const volumeRatio: FeatureDefinition = {
    featureId: "volumeRatio",
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["volume", "event.volume"],
    lookback: 1,
    leakage: sameBarLeakage("close", 0),
    description: "量能比：当前 bar 成交量 / 事件日成交量（< 1 为缩量）",
    compute: (context) => {
      const event = context.eventDayBar;
      if (event === null || event.volume === null || event.volume === 0) return null;
      const bar = lastBar(context.bars);
      if (bar === null || bar.volume === null) return null;
      return bar.volume / event.volume;
    },
  };

  const isBullish: FeatureDefinition = {
    featureId: "isBullish",
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["open", "close"],
    lookback: 1,
    leakage: sameBarLeakage("close", 0),
    description: "当日阳线：收盘 > 开盘 取 1，否则 0",
    compute: (context) => {
      const bar = lastBar(context.bars);
      if (bar === null || bar.open === null || bar.close === null) return null;
      return bar.close > bar.open ? 1 : 0;
    },
  };

  const momentum: FeatureDefinition = {
    featureId: "momentumFromEventClose",
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["close", "event.close"],
    lookback: 1,
    leakage: sameBarLeakage("close", 0),
    description: "当前收盘相对事件日收盘涨幅：close / event.close − 1",
    compute: (context) => {
      const event = context.eventDayBar;
      if (event === null || event.close === null || event.close === 0) return null;
      const bar = lastBar(context.bars);
      if (bar === null || bar.close === null) return null;
      return bar.close / event.close - 1;
    },
  };

  return [haircut, volumeRatio, isBullish, momentum];
}

/** 入场轴：首板后趋势峰值回撤所需的特征 id（稳定 id / version）。 */
export const EVENT_PEAK_PULLBACK_FEATURE_IDS = {
  peakCloseSinceEvent: "peakCloseSinceEvent",
  pullbackFromEventPeakClose: "pullbackFromEventPeakClose",
  trendHoldsMa5Ma10: "trendHoldsMa5Ma10",
} as const;

function finiteClose(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 为 `EVENT_TO_CURRENT` 取事件日到当前日的完整可见序列。
 *
 * 这里刻意不回退到 prefix bar：峰值回撤的基准是 T0 收盘，prefix 只服务于 MA10 的历史预热。
 */
function eventToCurrentBars(context: FeatureComputeContext): readonly VisibleBar[] | null {
  const current = lastBar(context.bars);
  if (current === null || current.relativeDay < 0) return null;
  const event = context.eventDayBar;
  if (event === null || event.relativeDay !== 0) return null;
  const bars = context.bars.filter(
    (bar) => bar.relativeDay >= 0 && bar.relativeDay <= current.relativeDay,
  );
  if (bars.length === 0 || bars[0]?.relativeDay !== 0) return null;
  return bars;
}

function peakCloseOf(bars: readonly VisibleBar[]): number | null {
  let peak = Number.NEGATIVE_INFINITY;
  for (const bar of bars) {
    if (!finiteClose(bar.close)) return null;
    peak = Math.max(peak, bar.close);
  }
  return Number.isFinite(peak) && peak > 0 ? peak : null;
}

/**
 * 入场轴：首板后趋势峰值回撤特征。
 *
 * - `peakCloseSinceEvent` = max(close[T0..T])，包含事件日，不含 prefix；
 * - `pullbackFromEventPeakClose` = (peak − currentClose) / peak，新高时为 0；
 * - `trendHoldsMa5Ma10` = close > MA10 且 MA5 > MA10；MA 使用当前日及之前的完整可见序列，
 *   因此首板日前 prefix bar 会参与 MA5 / MA10 预热。
 *
 * 三个特征都声明 `EVENT_TO_CURRENT`，Runtime 不按固定 lookback 截断；数据不足 / 缺失返回 null。
 */
export function makeEventPeakPullbackFeatures(): readonly FeatureDefinition[] {
  const leakage = sameBarLeakage("close", 0);

  const peakCloseSinceEvent: FeatureDefinition = {
    featureId: EVENT_PEAK_PULLBACK_FEATURE_IDS.peakCloseSinceEvent,
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["close", "relativeDay"],
    lookback: 1,
    historyMode: "EVENT_TO_CURRENT",
    leakage,
    description: "事件日到当前日的滚动最高收盘价（含事件日 T0）",
    compute: (context) => {
      const bars = eventToCurrentBars(context);
      return bars === null ? null : peakCloseOf(bars);
    },
  };

  const pullbackFromEventPeakClose: FeatureDefinition = {
    featureId: EVENT_PEAK_PULLBACK_FEATURE_IDS.pullbackFromEventPeakClose,
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["close", "relativeDay"],
    lookback: 1,
    historyMode: "EVENT_TO_CURRENT",
    leakage,
    description: "当前收盘相对事件日以来最高收盘的回撤幅度；当前新高为 0",
    compute: (context) => {
      const bars = eventToCurrentBars(context);
      if (bars === null) return null;
      const peak = peakCloseOf(bars);
      const current = lastBar(bars);
      if (peak === null || current === null || !finiteClose(current.close)) return null;
      const value = (peak - current.close) / peak;
      return Number.isFinite(value) ? value : null;
    },
  };

  const trendHoldsMa5Ma10: FeatureDefinition = {
    featureId: EVENT_PEAK_PULLBACK_FEATURE_IDS.trendHoldsMa5Ma10,
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["close", "relativeDay"],
    lookback: 10,
    historyMode: "EVENT_TO_CURRENT",
    leakage,
    description: "收盘 > MA10 且 MA5 > MA10（MA 可使用事件日前 prefix 历史）",
    compute: (context) => {
      const current = lastBar(context.bars);
      const event = context.eventDayBar;
      if (current === null || current.relativeDay < 0 || event === null || event.relativeDay !== 0) return null;
      const bars = context.bars
        .filter((bar) => bar.relativeDay <= current.relativeDay)
        .slice(-10);
      if (bars.length < 10) return null;
      for (const bar of bars) {
        if (!finiteClose(bar.close)) return null;
      }
      const currentClose = current.close;
      if (!finiteClose(currentClose)) return null;
      const last5 = bars.slice(-5);
      const ma5 = last5.reduce((sum, bar) => sum + (bar.close as number), 0) / 5;
      const ma10 = bars.reduce((sum, bar) => sum + (bar.close as number), 0) / 10;
      if (!Number.isFinite(ma5) || !Number.isFinite(ma10)) return null;
      return currentClose > ma10 && ma5 > ma10 ? 1 : 0;
    },
  };

  return [peakCloseSinceEvent, pullbackFromEventPeakClose, trendHoldsMa5Ma10];
}

/**
 * 3F 建仓风险过滤用的观察窗特征（T+1..T+5）。
 *
 * 口径与 `research/recipeFeatures/threeFactorScoreFeatures.ts` 的振幅链式前收算法一致：
 * runningPreClose 从事件日收盘起逐根更新，禁止另立公式。
 */
export interface ObservationWindowFeatures {
  /** T+1..T+5 平均振幅：(high-low)/runningPreClose 的均值。 */
  readonly meanAmplitude: number;
  /** T+1..T+5 最大振幅。 */
  readonly maxAmplitude: number;
  /** (观察窗最低 low − 事件日收盘) / 事件日收盘；负数 = 跌破事件收盘。 */
  readonly drawdownFromEventClose: number;
}

function observationWindowFeatureValues(
  context: FeatureComputeContext,
): ObservationWindowFeatures | null {
  const event = context.eventDayBar;
  if (event === null || event.close === null || event.close <= 0) return null;
  let post = context.bars.filter(
    bar => bar.relativeDay >= 1 && bar.relativeDay <= 5,
  );
  if (post.length < 5) return null;
  if (post.length !== 5) {
    post = context.bars.slice(-5);
    if (post.length < 5) return null;
  }

  let runningPreClose = event.close;
  let sum = 0;
  let max = Number.NEGATIVE_INFINITY;
  let minLow = Number.POSITIVE_INFINITY;
  for (const bar of post) {
    if (bar.high === null || bar.low === null || bar.close === null) return null;
    const amplitude = (bar.high - bar.low) / runningPreClose;
    if (!Number.isFinite(amplitude)) return null;
    sum += amplitude;
    max = Math.max(max, amplitude);
    minLow = Math.min(minLow, bar.low);
    runningPreClose = bar.close;
  }
  if (!Number.isFinite(minLow)) return null;
  return {
    meanAmplitude: sum / 5,
    maxAmplitude: max,
    drawdownFromEventClose: (minLow - event.close) / event.close,
  };
}

export function makeObservationWindowFeatures(): readonly FeatureDefinition[] {
  const leakage = sameBarLeakage("close", -4);
  const fromValues = (
    featureId: string,
    pick: (raw: ObservationWindowFeatures) => number,
  ): FeatureDefinition => ({
    featureId,
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["high", "low", "close"],
    lookback: 5,
    leakage,
    description: `${featureId}：T+1..T+5 观察窗风险特征（与 3F 振幅口径一致）`,
    compute: (context) => {
      const raw = observationWindowFeatureValues(context);
      return raw === null ? null : pick(raw);
    },
  });
  return [
    fromValues("observationMeanAmplitude", raw => raw.meanAmplitude),
    fromValues("observationMaxAmplitude", raw => raw.maxAmplitude),
    fromValues("drawdownFromEventClose", raw => raw.drawdownFromEventClose),
  ];
}

/**
 * 池化滚动风控：T+1..min(当前日,T+5) 的最大振幅。
 *
 * 与事件窗 `observationMaxAmplitude` 使用同一链式前收公式，但允许在 T+1..T+5 之间逐日计算。
 */
export function makeRollingObservationWindowFeatures(): readonly FeatureDefinition[] {
  const rollingMaxAmplitude: FeatureDefinition = {
    featureId: "rollingMaxAmplitude",
    version: BUILTIN_FEATURE_VERSION,
    inputs: ["high", "low", "close"],
    lookback: 1,
    leakage: sameBarLeakage("close", 0),
    description: "T+1..min(当前日,T+5) 最大振幅（链式前收）",
    compute: (context) => {
      const event = context.eventDayBar;
      if (event === null || event.close === null || event.close <= 0) return null;
      const post = context.bars
        .filter(bar => bar.relativeDay >= 1 && bar.relativeDay <= 5)
        .sort((left, right) => left.relativeDay - right.relativeDay);
      if (post.length === 0) return null;
      let runningPreClose = event.close;
      let max = Number.NEGATIVE_INFINITY;
      for (const bar of post) {
        if (bar.high === null || bar.low === null || bar.close === null) return null;
        const amplitude = (bar.high - bar.low) / runningPreClose;
        if (!Number.isFinite(amplitude)) return null;
        max = Math.max(max, amplitude);
        runningPreClose = bar.close;
      }
      return Number.isFinite(max) ? max : null;
    },
  };
  return [rollingMaxAmplitude];
}

/** 特征 id → legacy `bar.<field>` 派生字段名的映射（**唯一权威**；未登记即拒绝）。 */
export const DERIVED_BAR_FIELD_TO_FEATURE_ID: Readonly<Record<string, string>> = Object.freeze({
  volumeRatio: "volumeRatio",
  haircutFromEventLow: "haircutFromEventLow",
  isBullish: "isBullish",
  momentumFromEventClose: "momentumFromEventClose",
  observationMeanAmplitude: "observationMeanAmplitude",
  observationMaxAmplitude: "observationMaxAmplitude",
  rollingMaxAmplitude: "rollingMaxAmplitude",
  drawdownFromEventClose: "drawdownFromEventClose",
  peakCloseSinceEvent: EVENT_PEAK_PULLBACK_FEATURE_IDS.peakCloseSinceEvent,
  pullbackFromEventPeakClose: EVENT_PEAK_PULLBACK_FEATURE_IDS.pullbackFromEventPeakClose,
  trendHoldsMa5Ma10: EVENT_PEAK_PULLBACK_FEATURE_IDS.trendHoldsMa5Ma10,
});

/** 默认注册表（内置指标 + 事件相对特征 + 涨跌幅）。 */
export const DEFAULT_INDICATOR_WINDOWS = [5, 10, 20, 60] as const;
export const DEFAULT_EMA_WINDOWS = [12, 26] as const;
export const DEFAULT_RSI_WINDOWS = [14] as const;
export const DEFAULT_ATR_WINDOWS = [14] as const;

export function createDefaultFeatureRegistry(): FeatureRegistry {
  const definitions: FeatureDefinition[] = [];
  for (const window of DEFAULT_INDICATOR_WINDOWS) definitions.push(makeSmaFeature(window));
  for (const window of DEFAULT_EMA_WINDOWS) definitions.push(makeEmaFeature(window));
  for (const window of DEFAULT_RSI_WINDOWS) definitions.push(makeRsiFeature(window));
  for (const window of DEFAULT_ATR_WINDOWS) definitions.push(makeAtrFeature(window));
  definitions.push(...makePullbackFeatures());
  definitions.push(...makeEventPeakPullbackFeatures());
  definitions.push(...makeObservationWindowFeatures());
  definitions.push(...makeRollingObservationWindowFeatures());
  definitions.push(makePctChangeFeature());
  return createFeatureRegistry(definitions);
}

/** 惰性单例（避免顶层常量跨模块互相 import 造成「tsc 绿但运行时报 xxx is not a function」）。 */
let defaultRegistryCache: FeatureRegistry | null = null;

export function getDefaultFeatureRegistry(): FeatureRegistry {
  defaultRegistryCache ??= createDefaultFeatureRegistry();
  return defaultRegistryCache;
}
