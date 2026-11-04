/**
 * STEP 22 / C-22.1 — Market Regime 体系：类型契约（唯一权威来源）。
 *
 * 目标（ROADMAP §24）：建立 Market Regime 体系，回答
 *
 * > 策略到底在哪些市场环境有效？
 *
 * 而不是只看总体收益。七类环境维度（§24 列举）：
 *   trend / volatility / liquidity / breadth / sentiment / indexState / limitUpEnv。
 *
 * 本目录是**纯模块**：不可变、可序列化、确定性；无 DB / 无 Date.now / 无 Math.random /
 * 无 IO。时间戳（createdAt）与运行身份（regimeRunId）一律由调用方注入。
 *
 * 设计要点：
 *   - **PIT 纪律**：每个标签只由「T 及之前」的日级事实计算。回看窗取 [T−N+1 .. T]
 *     （含 T，**绝不居中、绝不前向**）；日级事实自带 asOf，且强制 asOf === tradeDate
 *     （与 datasetAccess/invariants.ts 的逐日 PIT 不变量同一语义，本模块 import 复用
 *     其断言函数，不重写）。请求一个不在序列中的 asOf → 响亮抛错（FAIL FAST），
 *     绝不「就近取一天」。
 *   - **数据不足语义**：窗口不足 / 基准缺失 / 情绪源缺失 → 该维显式 `unassessed`
 *     + 稳定 reasonCode，**绝不默认归类为中性**（中性也是一种标签，编造即污染归因）。
 *   - **复合状态**：七维可组合成 compositeKey；任一维 unassessed 时该维在 key 中
 *     显式编码为 `NA:<reasonCode>`，避免「缺维」伪装成某个具体状态。
 *   - **归因**：本模块**不跑任何回测**。表现数据（逐日 returnPct）由调用方注入，
 *     本模块只做确定性分组聚合（见 attribution.ts）。
 *
 * 复用而非重写（真实复用清单）：
 *   - `shared/quant-stats`：mean / median / sampleStandardDeviation（唯一样本标准差）；
 *   - `server/data/boardRules`：resolveLimitRules / isPriceAtLimitUp / isPriceAtLimitDown
 *     （涨停规则唯一权威来源，禁止自造 9.9% 近似）；
 *   - `server/research/datasetAccess/invariants`：assertRowPitInvariant（行级 PIT 断言）；
 *   - `server/researchDataset/version`：canonicalStringify（键字典序 canonical JSON）；
 *   - `server/research/experimentLineage/types`：REGIME_UNASSESSED_REASON_CODE
 *     （未评估占位机器码，单一事实来源）。
 *
 * 铁律：全部字段 readonly；数值有限（NaN / ±Infinity 在校验层拒绝）；可 JSON 序列化；
 * 失败响亮；fingerprint = canonical SHA-256。
 */

import type { MonthlyReturnEntry } from "../tradeQualityMetrics/types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化 / 反序列化判别，防止类型混淆）。 */
export const MARKET_REGIME_RUN_RECORD_KIND = "MARKET_REGIME_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const MARKET_REGIME_RUN_RECORD_VERSION = 1 as const;

/** MarketRegimeRun ID 前缀（`REGIME-YYYYMMDD-XXXXXXXX`，风格对齐 C-18.1 ROBUST）。 */
export const MARKET_REGIME_RUN_ID_PREFIX = "REGIME" as const;

// ---------------------------------------------------------------------------
// 七维环境维度
// ---------------------------------------------------------------------------

/**
 * 七类环境维度（ROADMAP §24 顺序固定；compositeKey 拼接顺序即此顺序）。
 */
export const REGIME_DIMENSION_IDS = [
  "trend",
  "volatility",
  "liquidity",
  "breadth",
  "sentiment",
  "indexState",
  "limitUpEnv",
] as const;

/** 单个环境维度 id。 */
export type RegimeDimensionId = (typeof REGIME_DIMENSION_IDS)[number];

/** 维度中文名（审计/报告用，不参与计算）。 */
export const REGIME_DIMENSION_LABELS: Readonly<Record<RegimeDimensionId, string>> = Object.freeze({
  trend: "趋势",
  volatility: "波动率",
  liquidity: "流动性",
  breadth: "市场宽度",
  sentiment: "市场情绪",
  indexState: "指数状态",
  limitUpEnv: "涨停环境",
});

// ---------------------------------------------------------------------------
// 各维标签值域（确定性离散分类，禁止自由文本）
// ---------------------------------------------------------------------------

/** 趋势：上涨 / 震荡 / 下跌。 */
export type RegimeTrendLabel = "up" | "down" | "sideways";

/** 波动率：低 / 中 / 高（年化波动率分档）。 */
export type RegimeVolatilityLabel = "low" | "mid" | "high";

/** 流动性：低（缩量）/ 中（平量）/ 高（放量）。 */
export type RegimeLiquidityLabel = "low" | "mid" | "high";

/** 市场宽度：普涨（broad）/ 分化（mixed）/ 普跌（narrow）。 */
export type RegimeBreadthLabel = "broad" | "mixed" | "narrow";

/** 市场情绪：risk_on（亢奋）/ neutral（中性）/ risk_off（避险）。 */
export type RegimeSentimentLabel = "risk_on" | "neutral" | "risk_off";

/** 指数状态：均线上方 / 均线附近 / 均线下方（相对回看窗均线）。 */
export type RegimeIndexStateLabel = "above_ma" | "near_ma" | "below_ma";

/** 涨停环境：hot（赚钱效应强）/ normal（常态）/ cold（低迷）。 */
export type RegimeLimitUpEnvLabel = "hot" | "normal" | "cold";

/** 维度 → 标签值域映射（供泛型收窄）。 */
export interface RegimeLabelMap {
  readonly trend: RegimeTrendLabel;
  readonly volatility: RegimeVolatilityLabel;
  readonly liquidity: RegimeLiquidityLabel;
  readonly breadth: RegimeBreadthLabel;
  readonly sentiment: RegimeSentimentLabel;
  readonly indexState: RegimeIndexStateLabel;
  readonly limitUpEnv: RegimeLimitUpEnvLabel;
}

/** 取维度对应的标签类型。 */
export type RegimeLabelOf<K extends RegimeDimensionId> = RegimeLabelMap[K];

/** 各维合法标签全集（校验器使用；顺序即文档顺序）。 */
export const REGIME_LABEL_SETS: Readonly<Record<RegimeDimensionId, readonly string[]>> =
  Object.freeze({
    trend: Object.freeze(["up", "down", "sideways"]),
    volatility: Object.freeze(["low", "mid", "high"]),
    liquidity: Object.freeze(["low", "mid", "high"]),
    breadth: Object.freeze(["broad", "mixed", "narrow"]),
    sentiment: Object.freeze(["risk_on", "neutral", "risk_off"]),
    indexState: Object.freeze(["above_ma", "near_ma", "below_ma"]),
    limitUpEnv: Object.freeze(["hot", "normal", "cold"]),
  });

// ---------------------------------------------------------------------------
// unassessed 语义（数据不足 / 数据缺失 → 显式未评估，绝不伪造中性标签）
// ---------------------------------------------------------------------------

/** unassessed reasonCode 白名单（稳定机器码）。 */
export const REGIME_UNASSESSED_REASON_CODES = {
  /** 回看窗交易日数不足（含 asOf 日之前无数据）。 */
  INSUFFICIENT_HISTORY: "REGIME_INSUFFICIENT_HISTORY",
  /** 维度所需数据缺失（基准收盘缺失 / 成交额缺失 / 横截面为空等）。 */
  DATA_MISSING: "REGIME_DATA_MISSING",
  /** 情绪数据源缺失（项目当前未回填情绪类数据；代理口径默认关闭）。 */
  SENTIMENT_SOURCE_MISSING: "REGIME_SENTIMENT_SOURCE_MISSING",
  /** 基准指数在窗口内无任何可用收盘价。 */
  BENCHMARK_MISSING: "REGIME_BENCHMARK_MISSING",
  /** 横截面样本数为 0（无法计算宽度 / 涨停环境等横截面统计量）。 */
  NO_CROSS_SECTION: "REGIME_NO_CROSS_SECTION",
} as const;

/** unassessed reasonCode 类型。 */
export type RegimeUnassessedReasonCode =
  (typeof REGIME_UNASSESSED_REASON_CODES)[keyof typeof REGIME_UNASSESSED_REASON_CODES];

/** 值是否为合法 unassessed reasonCode。 */
export function isRegimeUnassessedReasonCode(value: string): value is RegimeUnassessedReasonCode {
  return (Object.values(REGIME_UNASSESSED_REASON_CODES) as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// 日级事实（PIT：每交易日只携带当日及当日之前可知的信息）
// ---------------------------------------------------------------------------

/** 单只证券的当日快照（供横截面聚合；字段缺失 = null，禁止填零）。 */
export interface RegimeSecuritySnapshot {
  readonly securityId: string;
  /** 当日生效完整代码（如 600000.SH）；无生效标识符为 null（无法判定板块涨跌停比例）。 */
  readonly code: string | null;
  readonly close: number | null;
  readonly preClose: number | null;
  /** 成交额（与 ResearchDatasetRow.amount 同单位：千元）。 */
  readonly amount: number | null;
  /** 换手率（%）。 */
  readonly turnoverRate: number | null;
  /** 风险警示状态（决定主板涨跌停比例 10% vs 5%）。 */
  readonly st: "NORMAL" | "ST" | "*ST" | "UNKNOWN";
}

/** 指数日线最小集（只需 close；指数无涨跌停概念）。 */
export interface RegimeIndexBar {
  readonly indexCode: string;
  readonly close: number | null;
}

/**
 * 市场情绪事实（**项目当前无此数据源**，见 config.allowSentimentLimitUpProxy）。
 *
 * 语义：A 股情绪的常用横截面代理 —— 涨停家数 / 跌停家数 / 最高连板高度 / 炸板家数。
 * 该组数据当前**未回填**（ROADMAP §44.1 无对应表），故默认必须由调用方显式提供；
 * 未提供时该维恒为 unassessed（reasonCode=SENTIMENT_SOURCE_MISSING），
 * 除非显式开启「用涨跌停家数代理」并承担口径限制（见 config.ts 文档）。
 */
export interface RegimeSentimentFacts {
  readonly limitUpCount: number;
  readonly limitDownCount: number;
  /** 最高连板高度（板）；不可得为 null。 */
  readonly maxConsecutiveBoard: number | null;
  /** 炸板家数（盘中涨停、收盘未封住）；不可得为 null。 */
  readonly brokenBoardCount: number | null;
}

/**
 * 单个交易日的「市场事实」（regime 计算的最小输入单元）。
 *
 * PIT 铁律：asOf 必须 === tradeDate（逐日快照语义）；由 buildRegimeDayFacts 强制。
 * 全部横截面量只统计**当日**快照，不含任何未来信息。
 */
export interface RegimeDayFacts {
  readonly tradeDate: string;
  /** 该日事实的可获得时点，恒等于 tradeDate（PIT 不变量）。 */
  readonly asOf: string;
  /** 核心指数收盘（indexCode → close；缺失指数不出现在键中）。 */
  readonly indexCloses: Readonly<Record<string, number>>;
  /** 可判定涨跌的证券数（close 与 preClose 均有效且 > 0）。 */
  readonly sampleSize: number;
  /** 上涨家数（close > preClose）。 */
  readonly advancingCount: number;
  /** 下跌家数（close < preClose）。 */
  readonly decliningCount: number;
  /** 平盘家数（close === preClose；含停牌未变动者，由调用方决定是否纳入）。 */
  readonly unchangedCount: number;
  /** 涨停家数（收盘价触及涨停价，规则来自 server/data/boardRules）。 */
  readonly limitUpCount: number;
  /** 跌停家数。 */
  readonly limitDownCount: number;
  /** 涨跌停可判定证券数（板块规则 supported 且价格齐备）；为 0 时涨停环境不可评估。 */
  readonly limitClassifiableCount: number;
  /** 全市场成交额合计（千元；无有效成交额为 null）。 */
  readonly totalAmount: number | null;
  /** 全市场换手率均值（%；无有效值为 null）。 */
  readonly meanTurnoverRate: number | null;
  /** 情绪事实；null = 数据源缺失（该维 unassessed）。 */
  readonly sentiment: RegimeSentimentFacts | null;
}

// ---------------------------------------------------------------------------
// 标签
// ---------------------------------------------------------------------------

/** 回看窗描述（含 asOf 日在内的闭区间 [startDate, endDate]，endDate === asOf）。 */
export interface RegimeLookbackWindow {
  readonly startDate: string;
  readonly endDate: string;
  /** 实际取到的交易日数（<= requiredTradingDayCount）。 */
  readonly tradingDayCount: number;
  /** 配置要求的回看交易日数（不足 → unassessed INSUFFICIENT_HISTORY）。 */
  readonly requiredTradingDayCount: number;
}

/** 已评估标签（含透明回显的诊断量，供人工复核与下游二次计算）。 */
export interface RegimeAssessedTag<L extends string> {
  readonly kind: "assessed";
  readonly dimension: RegimeDimensionId;
  readonly label: L;
  readonly tradeDate: string;
  readonly asOf: string;
  readonly lookbackWindow: RegimeLookbackWindow;
  /** 参与计算的样本量（收盘价点数 / 交易日数 / 家数，按维度语义）。 */
  readonly sampleSize: number;
  /** 该维诊断量（键稳定、值有限；null = 该项不可得）。 */
  readonly metrics: Readonly<Record<string, number | null>>;
}

/** 未评估标签（数据不足 / 缺失；**绝不降级为中性**）。 */
export interface RegimeUnassessedTag {
  readonly kind: "unassessed";
  readonly dimension: RegimeDimensionId;
  readonly reasonCode: RegimeUnassessedReasonCode;
  readonly reason: string;
  readonly tradeDate: string;
  readonly asOf: string;
  /** 窗口不可确定（如 asOf 之前无任何交易日）时为 null。 */
  readonly lookbackWindow: RegimeLookbackWindow | null;
  readonly sampleSize: number;
}

/** 单维标签 = 已评估 | 未评估。 */
export type RegimeDimensionTag<L extends string> = RegimeAssessedTag<L> | RegimeUnassessedTag;

/** 类型守卫：标签是否已评估（未评估 = unassessed，绝不降级为中性）。 */
export function isRegimeTagAssessed<L extends string>(
  tag: RegimeDimensionTag<L>,
): tag is RegimeAssessedTag<L> {
  return tag.kind === "assessed";
}

/** 取标签值（unassessed 返回 null；调用方必须自行处理 null，禁止 ?? "neutral"）。 */
export function regimeTagLabel(tag: RegimeAnyDimensionTag): string | null {
  return tag.kind === "assessed" ? tag.label : null;
}

/** 七维标签集合（键入安全：每维标签类型固定）。 */
export type RegimeDimensionTagMap = {
  readonly [K in RegimeDimensionId]: RegimeDimensionTag<RegimeLabelOf<K>>;
};

/** 任意维标签（遍历用）。 */
export type RegimeAnyDimensionTag = RegimeDimensionTag<string>;

// ---------------------------------------------------------------------------
// 复合状态
// ---------------------------------------------------------------------------

/**
 * 复合 regime 状态（七维组合）。
 *
 * compositeKey 拼接规则（确定性、可逆解析）：
 *   - 按 REGIME_DIMENSION_IDS 固定顺序；
 *   - assessed 维贡献 `<dim>=<label>`，unassessed 维贡献 `<dim>=NA:<reasonCode>`；
 *   - 以 `|` 连接；维度子集（options.dimensions）可裁剪。
 */
export interface RegimeCompositeState {
  readonly compositeKey: string;
  /** 参与拼装的维度顺序（默认全七维）。 */
  readonly dimensionOrder: readonly RegimeDimensionId[];
  readonly assessedDimensionCount: number;
  readonly unassessedDimensionCount: number;
}

/** 单个交易日的完整 regime 标签组。 */
export interface RegimeDayTags {
  readonly tradeDate: string;
  readonly asOf: string;
  readonly trend: RegimeDimensionTag<RegimeTrendLabel>;
  readonly volatility: RegimeDimensionTag<RegimeVolatilityLabel>;
  readonly liquidity: RegimeDimensionTag<RegimeLiquidityLabel>;
  readonly breadth: RegimeDimensionTag<RegimeBreadthLabel>;
  readonly sentiment: RegimeDimensionTag<RegimeSentimentLabel>;
  readonly indexState: RegimeDimensionTag<RegimeIndexStateLabel>;
  readonly limitUpEnv: RegimeDimensionTag<RegimeLimitUpEnvLabel>;
  /** 复合状态；由 computeRegimeDayTags 装配（options.enableComposite=false 时为 null）。 */
  readonly composite: RegimeCompositeState | null;
}

// ---------------------------------------------------------------------------
// 归因（表现数据由调用方注入；本模块不跑回测）
// ---------------------------------------------------------------------------

/** 单日策略表现样本（调用方注入；returnPct 为当日收益 %）。 */
export interface RegimePerformanceSample {
  readonly tradeDate: string;
  readonly returnPct: number;
}

/** 归因分组维度：复合状态 | 单维。 */
export type RegimeAttributionGroupBy = "composite" | RegimeDimensionId;

/** 单个 regime 分组的聚合表现。 */
export interface RegimeAttributionGroup {
  /** 分组键（compositeKey 或 `<dim>=<label>`；unassessed 日归入 UNASSESSED 组）。 */
  readonly regimeKey: string;
  /** 落入该组的交易日数。 */
  readonly sampleCount: number;
  /** 组内累计收益（%）= Π(1 + r/100) − 1，再 ×100（复利口径）。 */
  readonly cumulativeReturnPct: number;
  /** 组内日均收益（%，算术平均）。 */
  readonly meanReturnPct: number;
  /** 组内日收益中位数（%）。 */
  readonly medianReturnPct: number | null;
  /** 组内上涨日占比（%；r > 0 计胜；r === 0 不计胜但计入分母）。 */
  readonly winRatePct: number | null;
  readonly bestReturnPct: number;
  readonly worstReturnPct: number;
  /** 该组样本数占已匹配样本数的比例（%）。 */
  readonly shareOfSamplesPct: number;
}

/**
 * 归因报告（纯聚合，不产生任何策略结论）。
 *
 * 未匹配样本（该交易日无 regime 标签，或该维 unassessed）**显式计数 + reasonCode 直方图**，
 * 绝不静默丢弃（丢弃会把「样本外/缺数据日」伪装成不存在）。
 */
export interface RegimeAttributionReport {
  readonly groupBy: RegimeAttributionGroupBy;
  readonly totalSampleCount: number;
  readonly matchedSampleCount: number;
  readonly unmatchedSampleCount: number;
  /** 未匹配原因直方图（reasonCode → 天数；无 regime 标签的日期记 NO_REGIME_TAG）。 */
  readonly unmatchedByReasonCode: Readonly<Record<string, number>>;
  /** 分组（按 regimeKey 升序，确定性）。 */
  readonly groups: readonly RegimeAttributionGroup[];
  /** 最好组与最差组累计收益之差（百分点）；分组数 < 2 时为 null。 */
  readonly spreadPct: number | null;
}

// ---------------------------------------------------------------------------
// MarketRegimeRun（一次 regime 分析的完整记录）
// ---------------------------------------------------------------------------

/** unassessed 统计（Run 级）。 */
export interface RegimeUnassessedStats {
  /** 标签总数 = tags.length × 7。 */
  readonly totalTagCount: number;
  /** 其中 unassessed 的数量。 */
  readonly totalUnassessedCount: number;
  /** 按维度统计 unassessed 数（七维齐全，0 也要出现）。 */
  readonly byDimension: Readonly<Record<RegimeDimensionId, number>>;
  /** 按 reasonCode 统计（仅出现过的 code 出现在键中）。 */
  readonly byReasonCode: Readonly<Record<string, number>>;
}

/** 覆盖区间。 */
export interface RegimeCoverage {
  /** 首个交易日（tags 为空时为 null）。 */
  readonly startDate: string | null;
  /** 末个交易日（tags 为空时为 null）。 */
  readonly endDate: string | null;
  readonly tradingDayCount: number;
}

// ---------------------------------------------------------------------------
// 维度配置（缺省值与依据见 config.ts；此处只定义形态）
// ---------------------------------------------------------------------------

/** 趋势配置（可缺省，由 resolveRegimeTrendConfig 补齐）。 */
export interface RegimeTrendConfig {
  /** 回看交易日数（含 asOf 日）。缺省 20（≈ 1 个月）。 */
  readonly lookbackTradingDays?: number;
  /** 上涨判定阈值（窗口总收益 %，>= 该值为 up）。缺省 5。 */
  readonly upThresholdPct?: number;
  /** 下跌判定阈值（窗口总收益 % 的**绝对值**；<= −该值为 down）。缺省 5。 */
  readonly downThresholdPct?: number;
}

/** 解析后趋势配置。 */
export interface ResolvedRegimeTrendConfig {
  readonly lookbackTradingDays: number;
  readonly upThresholdPct: number;
  readonly downThresholdPct: number;
}

/** 波动率配置。 */
export interface RegimeVolatilityConfig {
  readonly lookbackTradingDays?: number;
  /** 年化交易日数（年化波动率 = 日标准差 × √factor）。缺省 252。 */
  readonly annualizationFactor?: number;
  /** 低波动上界（年化 %，<= 为 low）。缺省 15。 */
  readonly lowThresholdPct?: number;
  /** 高波动下界（年化 %，>= 为 high）。缺省 30。 */
  readonly highThresholdPct?: number;
  /** 最少日收益样本数（不足 → unassessed）。缺省 5。 */
  readonly minSampleSize?: number;
}

/** 解析后波动率配置。 */
export interface ResolvedRegimeVolatilityConfig {
  readonly lookbackTradingDays: number;
  readonly annualizationFactor: number;
  readonly lowThresholdPct: number;
  readonly highThresholdPct: number;
  readonly minSampleSize: number;
}

/** 流动性口径。 */
export type RegimeLiquidityMetric = "amount" | "turnoverRate";

/** 流动性配置。 */
export interface RegimeLiquidityConfig {
  readonly lookbackTradingDays?: number;
  /** 度量口径：amount=全市场成交额、turnoverRate=全市场换手率均值。缺省 amount。 */
  readonly metric?: RegimeLiquidityMetric;
  /** 放量倍数（当日 / 窗口均值 >= 该值为 high）。缺省 1.2。 */
  readonly highRatio?: number;
  /** 缩量倍数（当日 / 窗口均值 <= 该值为 low）。缺省 0.8。 */
  readonly lowRatio?: number;
}

/** 解析后流动性配置。 */
export interface ResolvedRegimeLiquidityConfig {
  readonly lookbackTradingDays: number;
  readonly metric: RegimeLiquidityMetric;
  readonly highRatio: number;
  readonly lowRatio: number;
}

/** 市场宽度配置。 */
export interface RegimeBreadthConfig {
  /** 平滑窗口交易日数（逐日 advanceRatio 的均值）。缺省 5（≈ 1 周）。 */
  readonly lookbackTradingDays?: number;
  /** 普涨阈值（窗口平均上涨家数占比 >= 该值为 broad）。缺省 0.6。 */
  readonly broadThreshold?: number;
  /** 普跌阈值（<= 该值为 narrow）。缺省 0.4。 */
  readonly narrowThreshold?: number;
  /** 单日最小可判定家数（低于该值的交易日不参与平滑）。缺省 10。 */
  readonly minDailySampleSize?: number;
}

/** 解析后市场宽度配置。 */
export interface ResolvedRegimeBreadthConfig {
  readonly lookbackTradingDays: number;
  readonly broadThreshold: number;
  readonly narrowThreshold: number;
  readonly minDailySampleSize: number;
}

/** 市场情绪配置。 */
export interface RegimeSentimentConfig {
  readonly lookbackTradingDays?: number;
  /** risk_on 阈值（情绪得分 >= 该值）。缺省 0.3。 */
  readonly riskOnThreshold?: number;
  /** risk_off 阈值（情绪得分 <= −该值）。缺省 0.3。 */
  readonly riskOffThreshold?: number;
  /**
   * 是否允许用「涨跌停家数净占比」代理情绪（缺省 false）。
   *
   * 关闭（默认）时：未提供 RegimeSentimentFacts 的交易日 → 该维 unassessed
   * （reasonCode=REGIME_SENTIMENT_SOURCE_MISSING），**绝不拿涨停环境冒充情绪**。
   */
  readonly allowSentimentLimitUpProxy?: boolean;
}

/** 解析后市场情绪配置。 */
export interface ResolvedRegimeSentimentConfig {
  readonly lookbackTradingDays: number;
  readonly riskOnThreshold: number;
  readonly riskOffThreshold: number;
  readonly allowSentimentLimitUpProxy: boolean;
}

/** 指数状态配置。 */
export interface RegimeIndexStateConfig {
  /** 均线回看交易日数。缺省 60（≈ 1 季）。 */
  readonly lookbackTradingDays?: number;
  /** 均线噪声缓冲带（偏离 % 绝对值 < 该值为 near_ma）。缺省 3。 */
  readonly bandPct?: number;
}

/** 解析后指数状态配置。 */
export interface ResolvedRegimeIndexStateConfig {
  readonly lookbackTradingDays: number;
  readonly bandPct: number;
}

/** 涨停环境配置。 */
export interface RegimeLimitUpEnvConfig {
  /** 平滑窗口交易日数。缺省 5。 */
  readonly lookbackTradingDays?: number;
  /** 火热阈值（窗口平均涨停家数占比 % >= 该值为 hot）。缺省 2。 */
  readonly hotThresholdPct?: number;
  /** 低迷阈值（% <= 该值为 cold）。缺省 0.5。 */
  readonly coldThresholdPct?: number;
  /** 单日最小可判定家数。缺省 10。 */
  readonly minDailySampleSize?: number;
}

/** 解析后涨停环境配置。 */
export interface ResolvedRegimeLimitUpEnvConfig {
  readonly lookbackTradingDays: number;
  readonly hotThresholdPct: number;
  readonly coldThresholdPct: number;
  readonly minDailySampleSize: number;
}

/** 七维配置（全可缺省）。 */
export interface RegimeConfigSet {
  /** 年化交易日数（缺省 252；被 volatility.annualizationFactor 缺省继承）。 */
  readonly annualizationFactor?: number;
  readonly benchmarkIndexCode?: string;
  readonly trend?: RegimeTrendConfig;
  readonly volatility?: RegimeVolatilityConfig;
  readonly liquidity?: RegimeLiquidityConfig;
  readonly breadth?: RegimeBreadthConfig;
  readonly sentiment?: RegimeSentimentConfig;
  readonly indexState?: RegimeIndexStateConfig;
  readonly limitUpEnv?: RegimeLimitUpEnvConfig;
}

/** 解析后的七维配置集合（进入记录，保证自描述可复现）。 */
export interface ResolvedRegimeConfigSet {
  readonly annualizationFactor: number;
  readonly benchmarkIndexCode: string;
  readonly trend: ResolvedRegimeTrendConfig;
  readonly volatility: ResolvedRegimeVolatilityConfig;
  readonly liquidity: ResolvedRegimeLiquidityConfig;
  readonly breadth: ResolvedRegimeBreadthConfig;
  readonly sentiment: ResolvedRegimeSentimentConfig;
  readonly indexState: ResolvedRegimeIndexStateConfig;
  readonly limitUpEnv: ResolvedRegimeLimitUpEnvConfig;
}

/**
 * 一次 Market Regime 分析的完整记录（不可变、可 JSON 序列化、带指纹）。
 *
 * 内容：身份 + 口径（解析后配置全集）+ 覆盖区间 + 逐日七维标签 + unassessed 统计
 * + 标签序列指纹 + 可选归因（表现数据注入）+ 创建时间（注入）+ 内容指纹。
 */
export interface MarketRegimeRun {
  readonly recordKind: typeof MARKET_REGIME_RUN_RECORD_KIND;
  readonly recordVersion: typeof MARKET_REGIME_RUN_RECORD_VERSION;
  /** 运行 ID（调用方注入，保证确定性）。 */
  readonly regimeRunId: string;
  /** 绑定的 Research Dataset 版本（可空 = 未绑定，显式 null 不猜）。 */
  readonly datasetVersion: string | null;
  /** 基准指数代码（趋势/波动/指数状态使用该指数收盘）。 */
  readonly benchmarkIndexCode: string;
  /** 本次运行的解析后配置（自描述，可复现）。 */
  readonly configs: ResolvedRegimeConfigSet;
  readonly coverage: RegimeCoverage;
  /** 逐交易日标签（按 tradeDate 升序）。 */
  readonly tags: readonly RegimeDayTags[];
  readonly unassessedStats: RegimeUnassessedStats;
  /** 标签序列指纹（sha256，覆盖 tags 全体；防标签序列被篡改）。 */
  readonly tagSequenceFingerprint: string;
  /** 归因报告（未提供表现样本时为 null）。 */
  readonly attribution: RegimeAttributionReport | null;
  /** 记录创建时间（ISO-8601 UTC；调用方注入，非复现输入）。 */
  readonly createdAt: string;
  /** 内容指纹（sha256 十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 适配接口相关类型（C-16.3 / C-13.3 接线）
// ---------------------------------------------------------------------------

/**
 * 连续同状态区间（供 C-16.3 TradeQualityRegimeSegmentPerformance 填充）。
 */
export interface RegimeContiguousSegment {
  /** 区间 regime 键（compositeKey 或 `<dim>=<label>`）。 */
  readonly regimeId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly tradingDayCount: number;
}

/** 月度收益提供者（由 C-16.3 侧注入；本模块不计算收益）。 */
export type RegimeMonthlyReturnProvider = (
  tradeDate: string,
) => readonly MonthlyReturnEntry[] | undefined;
