/**
 * RESEARCH-002 — 研究变量目录（**PIT 防线的结构级实现**）。
 *
 * 本文件是全系统「研究变量名 → Dataset 原始列」的唯一映射表，核心设计是把 PIT 安全
 * 从「靠人记得别写错」变成「写错就读不到」：
 *
 *   - `FEATURE_VARIABLES` 的 `resolve` 只能拿到 `FeatureSources`（event + prefix，全部 ≤ T）；
 *   - `OUTCOME_VARIABLES` 的 `resolve` 只能拿到 `OutcomeSources`（path + outcome，全部 > T）；
 *   - 两个 Sources 类型**互不包含**，因此「在特征里写 `path.closeFromEventClose`」在
 *     TypeScript 编译期就不成立；运行期再叠加 `assertFeatureName` 的**具名拒绝**
 *     （把 outcome 变量名当 feature 用 → `VARIABLE_ROLE_VIOLATION`，不静默返回 null）。
 *
 * 与 Dataset 层的对应关系（**复用，不重新定义时间逻辑**）：
 *   - Dataset 物理表分层 event / prefix / post / path / outcome 已经把「≤T / >T」编码进表；
 *   - 本层只是把该分层**照搬到变量解析函数的入参上**，不新增一套 availability 规则。
 *
 * 口径唯一：每个变量都必须写清 `definition`（进结果 metadata 与报告），
 * 避免「同一个名字两种口径」导致研究结论不可复现。
 */

import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../datasetRegistry/types";
import { SEGMENT_STAT_KINDS, type SegmentStatKind } from "../researchCore";
import { engineAssert } from "./errors";
import { sampleStandardDeviation } from "../../shared/quant-stats";

// ---------------------------------------------------------------------------
// 数据源（角色隔离的物理边界）
// ---------------------------------------------------------------------------

/** 特征解析可用数据：**只有 T 及之前**。 */
export interface FeatureSources {
  event: FirstLimitPullbackEvent;
  /** key = prefix.relativeDay（≤ 0）。 */
  prefixBars: ReadonlyMap<number, FirstLimitPullbackRawBar>;
}

/** 结果解析可用数据：**只有 T 之后**（外加 T 日自身作为基准，见 `eventBar`）。 */
export interface OutcomeSources {
  /** key = path.relativeDay（≥ 1）。 */
  pathRows: ReadonlyMap<number, FirstLimitPullbackPath>;
  /** key = outcome.horizon。 */
  outcomeRows: ReadonlyMap<number, FirstLimitPullbackOutcome>;
  /**
   * 事件日本身那根原始 K 线（`prefix.relativeDay = 0`）。
   *
   * 🔴 为什么「结果变量」可以读 T 日：`*FromEventClose` 一族**本来就以 `close(0)` 为基准**
   * （该基准在 Dataset 构建时已固化进各 ratio 列）。把**同一天**的 `low(0)` / `open(0)`
   * 也交给结果侧，只是让「相对涨停日最低价」这类口径可以被表达 —— 数据流向是
   * 「OUTCOME 读 T 日」，而不是「FEATURE 读未来」⇒ **不触碰 PIT 防线**（防线管的是
   * 特征侧不得偷看未来，这里恰好相反）。
   *
   * 需要它的变量必须在定义里显式声明 `needsEventBar: true`，装配层才注入；
   * 该事件缺 D0 行情时为 `undefined`，变量应如实返回 `null`（不臆造基准）。
   */
  readonly eventBar: FirstLimitPullbackRawBar | undefined;
}

// ---------------------------------------------------------------------------
// 定义类型
// ---------------------------------------------------------------------------

export interface FeatureVariableDefinition {
  readonly name: string;
  readonly role: "FEATURE";
  readonly label: string;
  /** 精确口径（进结果 metadata / 报告）。 */
  readonly definition: string;
  readonly unit?: string;
  /** 需要加载的 prefix 相对日（缺省 = 不需要 prefix）。 */
  readonly prefixRelativeDays?: readonly number[];
  readonly resolve: (sources: FeatureSources) => number | null;
}

export interface OutcomeVariableDefinition {
  readonly name: string;
  readonly role: "OUTCOME";
  readonly label: string;
  readonly definition: string;
  readonly unit?: string;
  readonly pathRelativeDays?: readonly number[];
  readonly outcomeHorizons?: readonly number[];
  /**
   * 该结果变量是否以**事件日 K 线**（`prefix.relativeDay = 0`）为比较基准。
   *
   * 设为 `true` 的后果：装配层会把相对日 0 并入 prefix 装载范围，并把该行注入
   * `OutcomeSources.eventBar`；列投影探针同样会带上它（否则 `low` 列会被裁掉，
   * 变量在真实数据上静默变 null —— 这正是本字段必须显式声明、不能靠猜的原因）。
   */
  readonly needsEventBar?: boolean;
  readonly resolve: (sources: OutcomeSources) => number | null;
}

export type ResearchVariableDefinition = FeatureVariableDefinition | OutcomeVariableDefinition;

/** 价格相对量 → 收益率（防除零 + 非有限值；分母 ≤ 0 视为不可用）。 */
function toReturn(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator === null || numerator === undefined) return null;
  if (denominator === null || denominator === undefined || !Number.isFinite(denominator) || denominator <= 0) return null;
  const value = numerator / denominator - 1;
  return Number.isFinite(value) ? value : null;
}

/** prefix 相对日的完整窗口（含闭区间）。 */
function dayWindow(from: number, to: number): number[] {
  const days: number[] = [];
  for (let d = from; d <= to; d += 1) days.push(d);
  return days;
}

/**
 * 价格「等于或高于」比较的绝对容差（元）。
 *
 * 涨停价已四舍五入到分，`bar.open` / `bar.low` 同样是两位小数，理论上应精确相等；
 * 但二进制浮点表示会引入 1e−15 级噪声（如 `0.1 + 0.2 !== 0.3`）。
 * 取 1e−6 元（一分的万分之一）作阈值：远小于任何真实价格变动（最小变动单位 0.01 元），
 * 又足以吸收浮点噪声。
 *
 * 🔴 这里用**绝对**容差而非相对容差：价格量级横跨 1~1000 元，相对阈值会随价格漂移
 * （1 元股上 1e−9 相对容差 ≈ 1e−9 元，千元股上却 ≈ 1e−6 元），无法用一个数同时管住两端。
 */
const PRICE_EPS = 1e-6;

/**
 * `value ≥ limitUpPrice − ε` 时返回 1，否则 0；任一缺失 → `null`（不臆造）。
 * 供「开盘即封板 / 全天未开板」这类**当日形态**判定使用。
 */
function atOrAboveLimit(
  value: number | null | undefined,
  limitUpPrice: number | null | undefined,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (typeof limitUpPrice !== "number" || !Number.isFinite(limitUpPrice)) return null;
  return value >= limitUpPrice - PRICE_EPS ? 1 : 0;
}

// ---------------------------------------------------------------------------
// FEATURE 变量（≤ T；只读 event + prefix）
// ---------------------------------------------------------------------------

/** 固定特征变量（与 horizon 无关）。 */
const FIXED_FEATURE_VARIABLES: readonly FeatureVariableDefinition[] = [
  {
    name: "turnover",
    role: "FEATURE",
    label: "换手率",
    definition: "事件日 T 的换手率（Dataset event.turnover，来自 liquidity_daily.turnoverRate，单位 %）。",
    unit: "%",
    resolve: (s) => s.event.turnover,
  },
  {
    name: "previous_close",
    role: "FEATURE",
    label: "前收盘价",
    definition: "T−1 日收盘价（Dataset event.previousClose，涨停判定基准）。",
    unit: "元",
    resolve: (s) => s.event.previousClose,
  },
  {
    name: "limit_up_price",
    role: "FEATURE",
    label: "涨停价",
    definition: "T 日涨停价（Dataset event.limitUpPrice，四舍五入到分的 exchangeLimitUpPrice 结果）。",
    unit: "元",
    resolve: (s) => s.event.limitUpPrice,
  },
  {
    name: "limit_up_premium",
    role: "FEATURE",
    label: "涨停幅度",
    definition: "event.limitUpPrice / event.previousClose − 1（PIT 感知的涨停比例，ST=5%，主板=10%）。",
    resolve: (s) => toReturn(s.event.limitUpPrice, s.event.previousClose),
  },
  {
    name: "days_since_previous_limit",
    role: "FEATURE",
    label: "距上次涨停天数",
    definition: "Dataset event.daysSincePreviousLimit（首板时 = 距上一个涨停日的交易日数）。",
    unit: "交易日",
    resolve: (s) => s.event.daysSincePreviousLimit,
  },
  {
    name: "historical_limit_count",
    role: "FEATURE",
    label: "历史涨停次数",
    definition: "Dataset event.historicalLimitCount（窗口左边界预热后累计的涨停次数）。",
    unit: "次",
    resolve: (s) => s.event.historicalLimitCount,
  },
  {
    name: "market_cap",
    role: "FEATURE",
    label: "总市值",
    definition: "Dataset event.marketCap（**当前上游 liquidity_daily 该列为 NULL，故实测不可用**）。",
    unit: "元",
    resolve: (s) => s.event.marketCap,
  },
  {
    name: "float_market_cap",
    role: "FEATURE",
    label: "流通市值",
    definition: "Dataset event.floatMarketCap（**当前上游 liquidity_daily 该列为 NULL，故实测不可用**）。",
    unit: "元",
    resolve: (s) => s.event.floatMarketCap,
  },
  {
    name: "pre_close",
    role: "FEATURE",
    label: "事件日收盘（原始）",
    definition: "prefix.relativeDay=0 的收盘价（= 事件日收盘，≤ T，PIT 安全）。",
    unit: "元",
    prefixRelativeDays: [0],
    resolve: (s) => s.prefixBars.get(0)?.close ?? null,
  },
  {
    name: "pre_return_5d",
    role: "FEATURE",
    label: "前5日收益",
    definition: "prefix(rd=−5).close / prefix(rd=0).close − 1（事件日之前的 5 日涨幅）。",
    prefixRelativeDays: [-5, 0],
    resolve: (s) => toReturn(s.prefixBars.get(-5)?.close, s.prefixBars.get(0)?.close),
  },
  {
    name: "pre_return_20d",
    role: "FEATURE",
    label: "前20日收益",
    definition: "prefix(rd=−20).close / prefix(rd=0).close − 1（事件日之前的 20 日涨幅）。",
    prefixRelativeDays: [-20, 0],
    resolve: (s) => toReturn(s.prefixBars.get(-20)?.close, s.prefixBars.get(0)?.close),
  },
  {
    name: "pre_volatility_20d",
    role: "FEATURE",
    label: "前20日日收益波动率",
    definition: "prefix 窗口 rd∈[−20,0] 内逐日简单收益率的**样本标准差**（shared/quant-stats.sampleStandardDeviation）。",
    prefixRelativeDays: dayWindow(-20, 0),
    resolve: (s) => {
      const closes: number[] = [];
      for (let d = -20; d <= 0; d += 1) {
        const bar = s.prefixBars.get(d);
        if (!bar || bar.close === null) return null;
        closes.push(bar.close);
      }
      const returns: number[] = [];
      for (let i = 1; i < closes.length; i += 1) {
        const prev = closes[i - 1]!;
        if (prev <= 0) return null;
        returns.push(closes[i]! / prev - 1);
      }
      return sampleStandardDeviation(returns);
    },
  },
  {
    name: "pre_volume_ratio_5d_20d",
    role: "FEATURE",
    label: "前5日/前20日量比",
    definition: "mean(prefix.volume, rd∈[−5,−1]) / mean(prefix.volume, rd∈[−20,−1])。",
    prefixRelativeDays: dayWindow(-20, -1),
    resolve: (s) => {
      const short: number[] = [];
      const long: number[] = [];
      for (let d = -20; d <= -1; d += 1) {
        const v = s.prefixBars.get(d)?.volume;
        if (v === null || v === undefined) return null;
        long.push(v);
        if (d >= -5) short.push(v);
      }
      if (long.length === 0 || short.length === 0) return null;
      const longMean = long.reduce((a, b) => a + b, 0) / long.length;
      const shortMean = short.reduce((a, b) => a + b, 0) / short.length;
      if (longMean <= 0) return null;
      return shortMean / longMean;
    },
  },
  // ---- 事件日当日形态（全部来自 prefix rd=0 + event.limitUpPrice，≤ T，PIT 安全）----
  //
  // 引入动机（用户研究问题）：「首板涨停，且**不是一字板**，之后…」——
  // 「是不是一字板」是 T 日收盘时点就完全可观测的事实（当日 OHLC 已定），
  // 因此它属于**特征**而不是结果；而「破不破涨停日最低价」要看 T+1..T+h，属于结果。
  // 两者用同一根基准线（事件日最低价）衔接，所以基准本身必须单独暴露成变量。
  {
    name: "event_low_offset",
    role: "FEATURE",
    label: "事件日最低价折价",
    definition:
      "prefix(rd=0).low / prefix(rd=0).close − 1（≤ 0）。因事件日收盘 = 涨停价，"
      + "该值即「当日最低价相对涨停价折让了多少」，是「是否破涨停日最低价」的**基准线**"
      + "（配合 `event_low_margin_{h}d` / `holds_event_low_{h}d` 使用）。",
    prefixRelativeDays: [0],
    resolve: (s) => toReturn(s.prefixBars.get(0)?.low, s.prefixBars.get(0)?.close),
  },
  {
    name: "event_open_offset",
    role: "FEATURE",
    label: "事件日开盘折价",
    definition:
      "prefix(rd=0).open / prefix(rd=0).close − 1（≤ 0）。开盘价相对涨停价的折让；"
      + "= 0 即开盘已封（与 `is_one_word_open` 同源，一为连续量一为 0/1）。",
    prefixRelativeDays: [0],
    resolve: (s) => toReturn(s.prefixBars.get(0)?.open, s.prefixBars.get(0)?.close),
  },
  {
    name: "is_one_word_open",
    role: "FEATURE",
    label: "开盘即封板",
    definition:
      "prefix(rd=0).open ≥ limitUpPrice − 1e−6 时取 1，否则 0；缺数据为 null。"
      + "**1 = 开盘那一刻已在涨停价**（开盘挂单买不到）。口径取「开盘」，是最贴近"
      + "「能不能上车」的判定；若要用更严格的一字板定义见 `is_one_word_hold`。",
    prefixRelativeDays: [0],
    resolve: (s) => atOrAboveLimit(s.prefixBars.get(0)?.open, s.event.limitUpPrice),
  },
  {
    name: "is_one_word_hold",
    role: "FEATURE",
    label: "全天未开板",
    definition:
      "prefix(rd=0).low ≥ limitUpPrice − 1e−6 时取 1，否则 0；缺数据为 null。"
      + "**1 = 盘中从未打开过涨停**。比 `is_one_word_open` 更严格：剔除「开盘即封、"
      + "盘中曾开板」的那些。",
    prefixRelativeDays: [0],
    resolve: (s) => atOrAboveLimit(s.prefixBars.get(0)?.low, s.event.limitUpPrice),
  },
];

/** 特征变量表（name → definition）。 */
export const FEATURE_VARIABLES: Readonly<Record<string, FeatureVariableDefinition>> = Object.freeze(
  Object.fromEntries(FIXED_FEATURE_VARIABLES.map((v) => [v.name, v])),
);

// ---------------------------------------------------------------------------
// OUTCOME 变量（> T；只读 path + outcome）
// ---------------------------------------------------------------------------

/** 结果变量种类（由变量名解析得到）。 */
export const OUTCOME_VARIABLE_KINDS = [
  "future_return",
  "high_return",
  "low_return",
  "volume_ratio",
  "pullback_from_event_high",
  "max_return",
  "min_return",
  "max_drawdown",
  "is_breakout",
  "days_to_breakout",
] as const;
export type OutcomeVariableKind = (typeof OUTCOME_VARIABLE_KINDS)[number];

/** 路径类结果变量（值取自 path 表某个 relativeDay）。 */
const PATH_KIND_FIELD: Record<
  "future_return" | "high_return" | "low_return" | "volume_ratio" | "pullback_from_event_high",
  keyof FirstLimitPullbackPath
> = {
  future_return: "closeFromEventClose",
  high_return: "highFromEventClose",
  low_return: "lowFromEventClose",
  volume_ratio: "volumeRatio",
  pullback_from_event_high: "pullbackFromEventHigh",
};

/** 聚合类结果变量（值取自 outcome 表某个 horizon）。 */
const AGG_KIND_FIELD: Record<"max_return" | "min_return" | "max_drawdown", keyof FirstLimitPullbackOutcome> = {
  max_return: "maxReturn",
  min_return: "minReturn",
  max_drawdown: "maxDrawdown",
};

const PATH_KIND_LABEL: Record<keyof typeof PATH_KIND_FIELD, string> = {
  future_return: "未来收益",
  high_return: "未来最高收益",
  low_return: "未来最低收益",
  volume_ratio: "量比",
  pullback_from_event_high: "自事件日最高点回撤",
};

const PATH_KIND_DEFINITION: Record<keyof typeof PATH_KIND_FIELD, string> = {
  future_return: "path.relativeDay=h 的 closeFromEventClose（相对事件日收盘的收盘收益）。",
  high_return: "path.relativeDay=h 的 highFromEventClose（相对事件日收盘的最高价收益，MFE 路径点）。",
  low_return: "path.relativeDay=h 的 lowFromEventClose（相对事件日收盘的最低价收益，MAE 路径点）。",
  volume_ratio:
    "path.relativeDay=h 的 volumeRatio（当日成交量 / **事件日**成交量）。"
    + "> 1 = 相对事件日放量，< 1 = 缩量，= 1 = 与事件日持平；事件日成交量为 0 时不可算（null）。",
  pullback_from_event_high: "path.relativeDay=h 的 pullbackFromEventHigh（自事件日最高价的回撤幅度）。",
};

const AGG_KIND_LABEL: Record<keyof typeof AGG_KIND_FIELD, string> = {
  max_return: "区间最大收益",
  min_return: "区间最低收益",
  max_drawdown: "区间最大回撤",
};

const AGG_KIND_DEFINITION: Record<keyof typeof AGG_KIND_FIELD, string> = {
  max_return: "outcome.horizon=h 的 maxReturn（[T+1, T+h] 区间内最大有利偏移）。",
  min_return: "outcome.horizon=h 的 minReturn（[T+1, T+h] 区间内最大不利偏移）。",
  max_drawdown: "outcome.horizon=h 的 maxDrawdown（[T+1, T+h] 区间内最大回撤，**负值**）。",
};

/** 布尔 / 计数类结果变量（1/0 与天数；取自 outcome 表真实列）。 */
const FLAG_KIND_LABEL = {
  is_breakout: "是否突破",
  days_to_breakout: "到突破天数",
} as const;

const FLAG_KIND_DEFINITION = {
  is_breakout: "outcome.horizon=h 的 isBreakout（[T+1, T+h] 区间内是否突破事件日高点），映射为 1 / 0。",
  days_to_breakout: "outcome.horizon=h 的 daysToBreakout（突破发生在 T+几，未突破为 null）。",
} as const;

/** 结果变量名模式：`{kind}_{h}d`。 */
const OUTCOME_NAME_RE = /^([a-z_]+)_(\d+)d$/;

/** 解析结果变量名。 */
export function parseOutcomeVariableName(
  name: string,
): { kind: OutcomeVariableKind; horizon: number } | null {
  const m = OUTCOME_NAME_RE.exec(name);
  if (!m) return null;
  const kind = m[1] as OutcomeVariableKind;
  if (!(OUTCOME_VARIABLE_KINDS as readonly string[]).includes(kind)) return null;
  const horizon = Number(m[2]);
  if (!Number.isInteger(horizon) || horizon < 1) return null;
  return { kind, horizon };
}

/**
 * 按可用视界展开结果变量定义。
 *
 * `pathHorizons` 来自 **Dataset 真实的 path.relativeDay 范围**，`outcomeHorizons` 来自
 * **outcome.horizon 的真实取值**：本函数**不会**为不存在的数据造变量（不虚构）。
 */
export function buildOutcomeVariables(
  pathHorizons: readonly number[],
  outcomeHorizons: readonly number[],
): OutcomeVariableDefinition[] {
  const defs: OutcomeVariableDefinition[] = [];
  for (const h of [...pathHorizons].sort((a, b) => a - b)) {
    for (const kind of Object.keys(PATH_KIND_FIELD) as Array<keyof typeof PATH_KIND_FIELD>) {
      const field = PATH_KIND_FIELD[kind];
      defs.push({
        name: `${kind}_${h}d`,
        role: "OUTCOME",
        label: `${PATH_KIND_LABEL[kind]} T+${h}`,
        definition: PATH_KIND_DEFINITION[kind].replace("h", String(h)),
        pathRelativeDays: [h],
        resolve: (s) => {
          const row = s.pathRows.get(h);
          if (!row) return null;
          const value = row[field];
          return typeof value === "number" && Number.isFinite(value) ? value : null;
        },
      });
    }
  }
  for (const h of [...outcomeHorizons].sort((a, b) => a - b)) {
    for (const kind of Object.keys(AGG_KIND_FIELD) as Array<keyof typeof AGG_KIND_FIELD>) {
      const field = AGG_KIND_FIELD[kind];
      defs.push({
        name: `${kind}_${h}d`,
        role: "OUTCOME",
        label: `${AGG_KIND_LABEL[kind]} T+${h}`,
        definition: AGG_KIND_DEFINITION[kind].replace("h", String(h)),
        outcomeHorizons: [h],
        resolve: (s) => {
          const row = s.outcomeRows.get(h);
          if (!row) return null;
          const value = row[field];
          return typeof value === "number" && Number.isFinite(value) ? value : null;
        },
      });
    }
    defs.push({
      name: `is_breakout_${h}d`,
      role: "OUTCOME",
      label: `${FLAG_KIND_LABEL.is_breakout} T+${h}`,
      definition: FLAG_KIND_DEFINITION.is_breakout.replace("h", String(h)),
      outcomeHorizons: [h],
      resolve: (s) => {
        const row = s.outcomeRows.get(h);
        if (!row || row.isBreakout === null || row.isBreakout === undefined) return null;
        return row.isBreakout ? 1 : 0;
      },
    });
    defs.push({
      name: `days_to_breakout_${h}d`,
      role: "OUTCOME",
      label: `${FLAG_KIND_LABEL.days_to_breakout} T+${h}`,
      definition: FLAG_KIND_DEFINITION.days_to_breakout.replace("h", String(h)),
      outcomeHorizons: [h],
      resolve: (s) => {
        const row = s.outcomeRows.get(h);
        if (!row) return null;
        const value = row.daysToBreakout;
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      },
    });
  }
  // 事件日最低价守护族：**视界与 outcome 对齐**而不是 path。理由有两条 ——
  // ① 语义：这类量的用途是「守住支撑位之后看未来结果」，与 `max_drawdown_{h}d` 同属
  //    outcome 视界口径；② 成本：`min` 需要 path 的 1..h **每一行**（不像 outcome 表已预聚合），
  //    h 取满 path 上界会让每个事件多搬 20 行，而研究上并无此需求。
  defs.push(...buildEventLowGuardVariables(outcomeHorizons));
  return defs;
}

// ---------------------------------------------------------------------------
// 事件日最低价守护变量族（用户研究问题：「回撤不破涨停日最低价」）
// ---------------------------------------------------------------------------
//
// 解决的研究问题：「T+1..T+h 这段回撤有没有跌破**事件日当天的最低价**，之后怎么走」。
//
// 为什么必须新增而不是拼现成变量：判定式 `min(low[T+1..T+h]) ≥ low(T)` 是
// **跨字段比较**（左边在 path、右边在事件日 K 线），而条件编辑器的右值只能是常量。
// 于是把整个判定**压成一个变量**，条件侧退化为 `holds_event_low_5d = 1`。
//
// 🔴 两个口径都产出（`low` 盘中 / `close` 收盘）：盘中破位但收盘收回，与整天都在
// 支撑位上方的样本，后续表现可能不同 —— 这是研究问题的一部分，不能替用户选一个。

/** 守护判定的价格口径：`low` = 盘中最低价（最严格），`close` = 收盘价。 */
export const EVENT_LOW_GUARD_BASES = ["low", "close"] as const;
export type EventLowGuardBasis = (typeof EVENT_LOW_GUARD_BASES)[number];

const EVENT_LOW_GUARD_BASIS_LABEL: Record<EventLowGuardBasis, string> = {
  low: "盘中",
  close: "收盘",
};

/** 被取极值的价格序列（写进口径说明；用反引号包裹便于阅读）。 */
const EVENT_LOW_GUARD_BASIS_SERIES: Record<EventLowGuardBasis, string> = {
  low: "min(low[T+1..T+h])",
  close: "min(close[T+1..T+h])",
};

/** 守护布尔变量名：`holds_event_low_{h}d`（盘中）/ `holds_event_low_close_{h}d`（收盘），取值 1/0。 */
export function holdsEventLowVariableName(basis: EventLowGuardBasis, horizon: number): string {
  return basis === "low" ? `holds_event_low_${horizon}d` : `holds_event_low_close_${horizon}d`;
}

/** 守护余量变量名：`event_low_margin_{h}d`（盘中）/ `event_low_margin_close_{h}d`（收盘），连续值。 */
export function eventLowMarginVariableName(basis: EventLowGuardBasis, horizon: number): string {
  return basis === "low" ? `event_low_margin_${horizon}d` : `event_low_margin_close_${horizon}d`;
}

/** 事件日最低价（支撑位基准）；缺失 / 非正 → `null`（不臆造基准线）。 */
function eventLowFloor(s: OutcomeSources): number | null {
  const low = s.eventBar?.low;
  if (typeof low !== "number" || !Number.isFinite(low) || low <= 0) return null;
  return low;
}

/**
 * `[T+1, T+h]` 内被守护口径的**最低价**（绝对价格）。
 *
 * path 各列是「相对事件日收盘」的比率，故先以 `(1 + ratio) × close(0)` 还原成价格，
 * 再与绝对价 `low(0)` 比较 —— 两边同为价格，不存在比率基准混用。
 * `T+1..T+h` 缺任一行 → 整段 `null`（不插补，否则口径随缺失悄悄漂移）。
 */
function guardedExtreme(s: OutcomeSources, horizon: number, basis: EventLowGuardBasis): number | null {
  const base = s.eventBar?.close;
  if (typeof base !== "number" || !Number.isFinite(base) || base <= 0) return null;
  let extreme = Number.POSITIVE_INFINITY;
  for (let day = 1; day <= horizon; day += 1) {
    const row = s.pathRows.get(day);
    if (!row) return null;
    const ratio = basis === "low" ? row.lowFromEventClose : row.closeFromEventClose;
    if (typeof ratio !== "number" || !Number.isFinite(ratio)) return null;
    extreme = Math.min(extreme, (1 + ratio) * base);
  }
  return Number.isFinite(extreme) ? extreme : null;
}

/**
 * 按 outcome 视界展开事件日最低价守护族（每个视界 2 口径 × 2 形态 = 4 个变量）。
 * 消费方若要断言可用性，用 `catalog.hasOutcome(name)`（本族在目录中枚举）。
 */
export function buildEventLowGuardVariables(
  outcomeHorizons: readonly number[],
): OutcomeVariableDefinition[] {
  const defs: OutcomeVariableDefinition[] = [];
  for (const horizon of [...outcomeHorizons].sort((a, b) => a - b)) {
    const pathDays = dayWindow(1, horizon);
    for (const basis of EVENT_LOW_GUARD_BASES) {
      const basisLabel = EVENT_LOW_GUARD_BASIS_LABEL[basis];
      const series = EVENT_LOW_GUARD_BASIS_SERIES[basis];
      defs.push({
        name: holdsEventLowVariableName(basis, horizon),
        role: "OUTCOME",
        label: `${basisLabel}未破事件日最低价 T+${horizon}`,
        definition:
          `1 当且仅当 \`${series}\` ≥ \`low(T)\`（事件日最低价），否则 0；`
          + `T+1..T+${horizon} 缺任一天 → null。`
          + `基准 \`low(T)\` 取自事件日当天的原始 K 线（prefix rd=0）。`
          + `取「1 = 未破」而非「破 = 1」，是为了让条件直接写成 \`= 1\`。`
          + `**该量最早在 T+${horizon} 收盘才可观测**，属未来结果（OUTCOME）：`
          + `拿它筛样本 = 事后条件筛选，不构成 T 日可交易信号。`,
        pathRelativeDays: pathDays,
        needsEventBar: true,
        resolve: (s) => {
          const floor = eventLowFloor(s);
          if (floor === null) return null;
          const extreme = guardedExtreme(s, horizon, basis);
          if (extreme === null) return null;
          return extreme >= floor ? 1 : 0;
        },
      });
      defs.push({
        name: eventLowMarginVariableName(basis, horizon),
        role: "OUTCOME",
        label: `${basisLabel}相对事件日最低价余量 T+${horizon}`,
        definition:
          `\`${series}\` / \`low(T)\` − 1。> 0 = 全程未触及事件日最低价（数值即最近时离支撑位还有多远）；`
          + `≤ 0 = 已跌破（负得越多破得越深）。基准与缺数据规则同 \`${holdsEventLowVariableName(basis, horizon)}\`，`
          + `属未来结果（OUTCOME）。`,
        pathRelativeDays: pathDays,
        needsEventBar: true,
        resolve: (s) => {
          const floor = eventLowFloor(s);
          if (floor === null) return null;
          const extreme = guardedExtreme(s, horizon, basis);
          if (extreme === null) return null;
          const value = extreme / floor - 1;
          return Number.isFinite(value) ? value : null;
        },
      });
    }
  }
  return defs;
}

// ---------------------------------------------------------------------------
// 分段（两窗）结果变量（RESEARCH-004）
//
// 解决的研究问题：「同一根价格路径被切成先后两段，前一段与后一段的表现有什么关系」。
// 现有 95 个结果变量**全部锚定 T 日收盘**（`close(rd)/close(0) − 1`），因此
// 「T+5 → T+20 这一段」根本无法表达 —— 不是数据缺失（path 表本就有逐日 close/high/low），
// 而是变量层没有造。本段把锚点从 T 挪到窗起点 `a`，补上这一族。
//
// 🔴 三条不可动摇的设计约束
//
//   1. **口径与 Dataset 的 `*_hd` 平行**：Dataset 的 `max_drawdown_hd` =
//      `min(close[T+1..T+h]) / close(T) − 1`（相对**锚点**收盘，不是峰谷回撤）。
//      本段的分段口径把锚点换成 `close(a)`、窗口换成 `[a+1, b]`，其余完全平行。
//      两种口径**不同源、不可混称**，因此每个变量的 `definition` 必须把基准写清。
//
//   2. **不进 `listOutcomes()`**（按需构造）：path 相对日 1..20 两两组合 = 190 段 × 4 类
//      ≈ 760 个变量名。塞进目录下拉只会把「变量目录」这件工具变成一个噪音源，
//      并且让 `listVariables` 的响应凭空膨胀 8 倍。消费方按需调用
//      `buildSegmentVariableDefinition(stat, from, to)` 构造。
//
//   3. **窗口必须落在真实视界内**：`from` / `to` 都要能在该 Dataset Version 的
//      `path.relativeDay` 里取到行，否则 `UNKNOWN_VARIABLE`（不静默返回 null）。
//      校验入口是 `ResearchVariableCatalog#segmentWindowUsable`。
// ---------------------------------------------------------------------------

/**
 * 分段变量名：`segment_{stat}_{a}_{b}d`，`1 ≤ a < b`（均为 path 相对日）。
 * 口径清单从 `researchCore/config.ts#SEGMENT_STAT_KINDS`（唯一权威）拼出，
 * 而不是在本文件抄一份字面量 —— 两处各写一份迟早会漂移。
 */
const SEGMENT_NAME_RE = new RegExp(`^segment_(${SEGMENT_STAT_KINDS.join("|")})_(\\d+)_(\\d+)d$`);

export interface ParsedSegmentVariableName {
  stat: SegmentStatKind;
  /** 窗起点相对日（也是基准日：口径一律以 `close(from)` 为分母）。 */
  from: number;
  /** 窗终点相对日（值窗 = `[from+1, to]`）。 */
  to: number;
}

/**
 * 解析分段变量名（形态 + 基本取值校验）。
 * 返回 `null` = 不是分段变量名 或 取值非法（`from < 1` / `to <= from`）；
 * **视界是否真的可用**由目录层判（本函数不接触 Dataset）。
 */
export function parseSegmentVariableName(name: string): ParsedSegmentVariableName | null {
  const m = SEGMENT_NAME_RE.exec(name);
  if (!m) return null;
  const stat = m[1] as SegmentStatKind;
  const from = Number(m[2]);
  const to = Number(m[3]);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 1 || to <= from) return null;
  return { stat, from, to };
}

/** 分段统计各自读取的 path 列（列投影按「变量实际读到的列」自动派生，故列名必须真实存在）。 */
const SEGMENT_FIELD: Record<
  SegmentStatKind,
  "closeFromEventClose" | "highFromEventClose" | "lowFromEventClose"
> = {
  return: "closeFromEventClose",
  max_return: "highFromEventClose",
  min_return: "lowFromEventClose",
  max_drawdown: "closeFromEventClose",
};

const SEGMENT_STAT_LABEL: Record<SegmentStatKind, string> = {
  return: "分段收益",
  max_return: "分段最大有利偏移",
  min_return: "分段最大不利偏移",
  max_drawdown: "分段最大跌幅",
};

/** 口径的中文名（报告 / 结果 metadata / 前端展示共用，避免文案在多处各写一份）。 */
export function segmentStatLabel(stat: SegmentStatKind): string {
  return SEGMENT_STAT_LABEL[stat];
}

const SEGMENT_STAT_DEFINITION: Record<SegmentStatKind, string> = {
  return: "`close(T+b) / close(T+a) − 1`，即以窗起点收盘为基准的分段收益（等价于 [T+a+1, T+b] 逐日收益的连乘 − 1）。",
  max_return: "`max(high[T+a+1..T+b]) / close(T+a) − 1`，窗内相对**窗起点收盘**的最大有利偏移。",
  min_return: "`min(low[T+a+1..T+b]) / close(T+a) − 1`，窗内相对**窗起点收盘**的最大不利偏移。",
  max_drawdown:
    "`min(close[T+a+1..T+b]) / close(T+a) − 1`（**负值**），窗内相对**窗起点收盘**的最大跌幅。"
    + "口径与 Dataset 的 `max_drawdown_{h}d` 平行（后者锚在事件日收盘），两者**不同源、不可混称**。",
};

/** 相对收益列 → 价格水平 `close(x)/close(0)`（= 1 + ratio）；非有限或非正一律不可用。 */
function ratioLevel(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const level = 1 + value;
  return level > 0 ? level : null;
}

/**
 * 构造一个分段结果变量定义（**按需**，不进目录枚举）。
 *
 * 声明 `pathRelativeDays = [from, to]` 全窗口：Engine 据此一次性装载所需相对日，
 * 列投影也据此拿到探针行（缺任一行会让 `resolve` 提前返回 null 而少收集列）。
 */
export function buildSegmentVariableDefinition(
  stat: SegmentStatKind,
  from: number,
  to: number,
): OutcomeVariableDefinition {
  const name = `segment_${stat}_${from}_${to}d`;
  const windowDays = dayWindow(from + 1, to);
  return {
    name,
    role: "OUTCOME",
    label: `${SEGMENT_STAT_LABEL[stat]} T+${from}→T+${to}`,
    definition:
      `${SEGMENT_STAT_DEFINITION[stat]}`
      + `分段锚点 = 窗起点 T+${from}（**不是**事件日 T）⇒ 该量最早在 T+${from} 收盘可观测，`
      + `属未来结果（OUTCOME），不可当作 T 日的 PIT 安全特征。`,
    pathRelativeDays: dayWindow(from, to),
    resolve: (s) => {
      const anchorRow = s.pathRows.get(from);
      if (!anchorRow) return null;
      const anchorLevel = ratioLevel(anchorRow.closeFromEventClose);
      if (anchorLevel === null) return null;

      if (stat === "return") {
        const endRow = s.pathRows.get(to);
        if (!endRow) return null;
        const endLevel = ratioLevel(endRow.closeFromEventClose);
        if (endLevel === null) return null;
        const value = endLevel / anchorLevel - 1;
        return Number.isFinite(value) ? value : null;
      }

      const field = SEGMENT_FIELD[stat];
      const levels: number[] = [];
      for (const day of windowDays) {
        const row = s.pathRows.get(day);
        // 缺任一天 ⇒ 整个分段量不可用（不静默跳过缺失日，否则口径随缺失悄悄漂移）
        if (!row) return null;
        const level = ratioLevel(row[field]);
        if (level === null) return null;
        levels.push(level);
      }
      if (levels.length === 0) return null;
      const extreme = stat === "max_return" ? Math.max(...levels) : Math.min(...levels);
      const value = extreme / anchorLevel - 1;
      return Number.isFinite(value) ? value : null;
    },
  };
}

/** 分段变量名（供外部构造 / 断言；与 `buildSegmentVariableDefinition` 的唯一命名规则同源）。 */
export function segmentVariableName(stat: SegmentStatKind, from: number, to: number): string {
  return `segment_${stat}_${from}_${to}d`;
}

/**
 * 窗 `(from, to)` + 口径 `stat` 对应的结果变量名。
 *
 * 🔴 `from === 0`（锚点在**事件日收盘**）时**复用既有变量族**，绝不为它另造一套口径：
 *   - `return` → `future_return_{to}d`（path 族，1..20）
 *   - 其余 → `max_return / min_return / max_drawdown _{to}d`（outcome 族，仅 {5,10,20}）
 * 这样「T→T+5 的最大回撤」就等于 Dataset 已定的 `max_drawdown_5d`，而不是一个
 * 「看起来一样、算出来略有差别」的第二个口径 —— 那是研究结论不可复现的常见来源。
 *
 * 可用性一律由调用方用 `catalog.hasOutcome(name)` 判定（本函数只负责命名）。
 */
export function windowOutcomeVariableName(stat: SegmentStatKind, from: number, to: number): string {
  if (from === 0) return stat === "return" ? `future_return_${to}d` : `${stat}_${to}d`;
  return segmentVariableName(stat, from, to);
}

/**
 * 窗 `(from, to)` 的**取值区间**（真正被当作数值使用的那几天）。
 * 用于重叠判定：锚点日只提供基准价格，本身不贡献取值。
 */
export function segmentValueWindow(from: number, to: number): [number, number] {
  return [from === 0 ? 1 : from + 1, to];
}

/** 两个闭区间是否有交集。 */
export function rangesOverlap(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

// ---------------------------------------------------------------------------
// 变量目录（统一查询 + 角色校验）
// ---------------------------------------------------------------------------

/** 变量目录：把某个 Dataset Version 的真实可用视界固化下来。 */
export class ResearchVariableCatalog {
  private readonly outcomes: Map<string, OutcomeVariableDefinition>;

  /**
   * 分段窗可用的相对日范围（`path.relativeDay` 的真实取值包围盒）。
   * `null` = 该 Dataset Version 没有任何 path 数据 ⇒ **一切分段变量都不可用**（不虚构）。
   */
  readonly segmentRange: { readonly min: number; readonly max: number } | null;

  constructor(
    /** outcome.horizon 的真实取值（升序）。 */
    readonly outcomeHorizons: readonly number[],
    /** path.relativeDay 的真实可用视界（升序）；缺省 = 无 path 数据。 */
    readonly pathHorizons: readonly number[],
  ) {
    this.outcomes = new Map(buildOutcomeVariables(pathHorizons, outcomeHorizons).map((v) => [v.name, v]));
    const usable = [...pathHorizons]
      .filter((d) => Number.isInteger(d) && d >= 1)
      .sort((a, b) => a - b);
    // 需要至少两个相对日才可能构成一个 `from < to` 的窗。
    this.segmentRange =
      usable.length >= 2 ? { min: usable[0]!, max: usable[usable.length - 1]! } : null;
  }

  /**
   * 分段窗 `[from, to]` 是否落在该 Dataset 的真实 path 视界内。
   * 判据是「起止两端都取得到行」—— 中间缺行由 `resolve` 返回 null 如实反映，不在此处假装可用。
   */
  segmentWindowUsable(from: number, to: number): boolean {
    const range = this.segmentRange;
    if (range === null) return false;
    return (
      Number.isInteger(from) &&
      Number.isInteger(to) &&
      from >= range.min &&
      from < to &&
      to <= range.max
    );
  }

  /** 是否已知特征变量。 */
  hasFeature(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(FEATURE_VARIABLES, name);
  }

  /** 是否已知结果变量（含**按需构造**的分段变量）。 */
  hasOutcome(name: string): boolean {
    if (this.outcomes.has(name)) return true;
    const seg = parseSegmentVariableName(name);
    return seg !== null && this.segmentWindowUsable(seg.from, seg.to);
  }

  /** 全部特征变量名（稳定排序）。 */
  listFeatures(): string[] {
    return Object.keys(FEATURE_VARIABLES).sort();
  }

  /**
   * 全部结果变量名（稳定排序）。
   *
   * 🔴 **不含分段变量**：`path` 相对日两两组合 = 190 个窗 × 4 种口径 ≈ 760 个名字，
   * 枚举进目录会让「变量目录」变成噪音源（并使 `listVariables` 响应膨胀约 8 倍）。
   * 分段变量按需构造 —— 消费方用 `segmentWindowUsable` 校验窗、用
   * `buildSegmentVariableDefinition` 取定义；`hasOutcome` / `resolveOutcome` 都认得它们。
   */
  listOutcomes(): string[] {
    return [...this.outcomes.keys()].sort();
  }

  /**
   * 解析一个**特征**变量名。
   * 若该名字是已知的**结果**变量 → 抛 `VARIABLE_ROLE_VIOLATION`（PIT 违规必须显式失败）。
   */
  resolveFeature(name: string): FeatureVariableDefinition {
    const def = FEATURE_VARIABLES[name];
    if (def) return def;
    engineAssert(
      !this.hasOutcome(name),
      "VARIABLE_ROLE_VIOLATION",
      `变量 "${name}" 是未来结果（OUTCOME），禁止作为 PIT 安全特征（FEATURE）使用`,
      { variable: name, role: "FEATURE" },
    );
    engineAssert(false, "UNKNOWN_VARIABLE", `未登记的特征变量："${name}"`, {
      variable: name,
      role: "FEATURE",
      known: this.listFeatures(),
    });
  }

  /** 解析一个**结果**变量名；若该名字是特征变量 → 抛 `VARIABLE_ROLE_VIOLATION`。 */
  resolveOutcome(name: string): OutcomeVariableDefinition {
    const def = this.outcomes.get(name);
    if (def) return def;

    const seg = parseSegmentVariableName(name);
    if (seg !== null) {
      const range = this.segmentRange;
      engineAssert(
        this.segmentWindowUsable(seg.from, seg.to),
        "UNKNOWN_VARIABLE",
        range === null
          ? `分段变量 "${name}" 不可用：该 Dataset Version 没有任何 path 相对日数据`
          : `分段变量 "${name}" 的窗口超出该 Dataset 的真实 path 视界`
            + `（可用 from ≥ ${range.min}、to ≤ ${range.max} 且 from < to）`,
        { variable: name, role: "OUTCOME", segmentRange: range },
      );
      return buildSegmentVariableDefinition(seg.stat, seg.from, seg.to);
    }

    engineAssert(
      !this.hasFeature(name),
      "VARIABLE_ROLE_VIOLATION",
      `变量 "${name}" 是 PIT 安全特征（FEATURE），不能当作未来结果（OUTCOME）使用`,
      { variable: name, role: "OUTCOME" },
    );
    engineAssert(false, "UNKNOWN_VARIABLE", `未登记的结果变量："${name}"`, {
      variable: name,
      role: "OUTCOME",
      known: this.listOutcomes(),
    });
  }
}

/** 断言「该名字只能当特征用」（供 Analysis 配置校验）。 */
export function assertFeatureVariableName(catalog: ResearchVariableCatalog, name: string): void {
  catalog.resolveFeature(name);
}

/** 断言「该名字只能当结果用」。 */
export function assertOutcomeVariableName(catalog: ResearchVariableCatalog, name: string): void {
  catalog.resolveOutcome(name);
}

// ---------------------------------------------------------------------------
// 维度（分组键；不参与 PIT 判定，但必须来自真实列）
// ---------------------------------------------------------------------------

export const STABILITY_DIMENSION_KEYS = [
  "year",
  "month",
  "quarter",
  "board",
  "market",
  "industry",
  "regime",
] as const;
export type StabilityDimensionKey = (typeof STABILITY_DIMENSION_KEYS)[number];

/** 市场环境标签提供方（STABILITY 的 regime 分组；本项目 marketRegime 模块为未来接入点）。 */
export interface RegimeTagProvider {
  /** 返回该事件日所属的环境标签；无标签返回 null（不编造）。 */
  regimeLabelOf(tradeDate: string): string | null;
}

export function isStabilityDimensionKey(value: string): value is StabilityDimensionKey {
  return (STABILITY_DIMENSION_KEYS as readonly string[]).includes(value);
}

/**
 * 从**真实列**解析分组维度（year / month / quarter / board / market / industry）。
 * `regime` 需外部 `RegimeTagProvider`；无 provider 时返回 `null`（不编造标签）。
 */
export function resolveDimensionValue(
  key: string,
  sources: FeatureSources,
  regimeProvider?: RegimeTagProvider,
): string | number | null {
  const { event } = sources;
  switch (key) {
    case "year": {
      const y = event.tradeDate.slice(0, 4);
      return /^\d{4}$/.test(y) ? Number(y) : null;
    }
    case "month": {
      const m = event.tradeDate.slice(0, 7);
      return /^\d{4}-\d{2}$/.test(m) ? m : null;
    }
    case "quarter": {
      const y = Number(event.tradeDate.slice(0, 4));
      const mm = Number(event.tradeDate.slice(5, 7));
      if (!Number.isInteger(y) || !Number.isInteger(mm) || mm < 1 || mm > 12) return null;
      return `${y}Q${Math.floor((mm - 1) / 3) + 1}`;
    }
    case "board":
      return event.boardType ?? null;
    case "market":
      return event.market ?? null;
    case "industry":
      return event.industryCode ?? null;
    case "regime":
      return regimeProvider ? regimeProvider.regimeLabelOf(event.tradeDate) : null;
    default:
      return null;
  }
}
