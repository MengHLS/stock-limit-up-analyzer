/**
 * researchEngineAdapter — Research Engine 前端 ViewModel 适配层（RESEARCH-002 前端工作台）。
 *
 * 定位（与 `datasetRegistryAdapter.ts` 同一纪律）：
 *   - API（`researchEngine.*` tRPC 返回的领域对象）→ ViewModel → UI；
 *   - UI **不**直接消费后端对象，也**不**在 JSX 里做字段强转；
 *   - **不重算任何量化判定**：指标数值原样展示，缺失就是缺失（`—`），不补 0、不补均值、
 *     不在前端重算 p 值 / 胜率 / 分组。前端只做「标签 + 单位 + 精度」的展示映射。
 *
 * 关键设计：**指标单位依赖变量语义**。
 *   `MEAN` 本身无单位 —— 作用于 `future_return_5d` 是百分比，作用于 `turnover` 也是百分比，
 *   但作用于 `days_to_breakout_5d` 是天数。因此 `metricUnitOf(code, variableName)` 必须
 *   同时看指标码与变量名；只有「自带单位」的指标码（`WIN_RATE` / `MEAN_RETURN` / `P_VALUE` …）
 *   才可以忽略变量名。这是本文件唯一有实质判断的地方，已在单测中逐条锁定。
 */

import type { DiagnosticError } from "@/components/common";

// ---------------------------------------------------------------------------
// 通用格式化
// ---------------------------------------------------------------------------

/** ISO 时间 → 本地 `YYYY-MM-DD HH:mm`；null / 非法 → "—"。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 千分位整数；null / undefined → "—"。 */
export function formatCount(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

/** 毫秒 → 人类可读（`1,234 ms` / `1.2 s` / `1 m 05 s`）。 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} m ${String(total % 60).padStart(2, "0")} s`;
}

// ---------------------------------------------------------------------------
// 变量语义
// ---------------------------------------------------------------------------

/**
 * 收益型变量（其数值本身是收益率，展示为百分比）。
 * 与后端 `server/researchEngine/variables.ts` 的变量名录对齐；未列出的变量按原值展示。
 */
const RETURN_VARIABLE_PATTERN =
  /^(future_return|high_return|low_return|max_return|min_return|max_drawdown|pullback_from_event_high|pre_return|segment_return|segment_max_return|segment_min_return|segment_max_drawdown)_/;

/** 比例型特征（本身是比率，展示为百分比）。 */
const RATIO_FEATURE_VARIABLES = new Set(["turnover", "pre_volatility_20d", "limit_up_premium"]);

/** 计数 / 天数型变量（展示为整数）。 */
const COUNT_VARIABLES = new Set(["days_since_previous_limit", "historical_limit_count"]);

/** 变量名 → 中文标签（未收录则原样返回变量名，不臆造）。 */
const VARIABLE_LABELS: Record<string, string> = {
  turnover: "换手率",
  previous_close: "前一收盘价",
  limit_up_price: "涨停价",
  limit_up_premium: "封板溢价",
  days_since_previous_limit: "距上次涨停天数",
  historical_limit_count: "历史涨停次数",
  market_cap: "总市值",
  float_market_cap: "流通市值",
  pre_close: "T-1 收盘价",
  pre_return_5d: "前 5 日收益",
  pre_return_20d: "前 20 日收益",
  pre_volatility_20d: "前 20 日波动率",
  pre_volume_ratio_5d_20d: "量比（5 日/20 日）",
};

/** 分段变量的中文名（`segment_{stat}_{a}_{b}d`；锚在窗起点收盘，与 `*_{h}d` 不是同一口径）。 */
const SEGMENT_KIND_LABEL: Record<string, string> = {
  segment_return: "分段收益",
  segment_max_return: "分段最大有利偏移",
  segment_min_return: "分段最大不利偏移",
  segment_max_drawdown: "分段最大跌幅",
};

/**
 * **滞后族**变量的中文名（`{family}_{h}d`，`h` = 事件后第几天）。
 *
 * 提成模块级常量而不是写在 `variableLabelOf` 里：趋势图（`buildVariableSeries`）也要用它
 * 给整条序列起名 —— 「同一族变量」这个判定与「族的中文名」是同一件事，两处各抄一份迟早
 * 会漂移。未登记的族**不臆造**，原样返回族名。
 */
const HORIZON_FAMILY_LABEL: Record<string, string> = {
  future_return: "未来收益",
  high_return: "未来最高收益",
  low_return: "未来最低收益",
  max_return: "区间最大有利偏移",
  min_return: "区间最大不利偏移",
  max_drawdown: "区间最大回撤",
  is_breakout: "是否突破",
  days_to_breakout: "到突破天数",
  pullback_from_event_high: "距事件高点回撤",
  // `volume_ratio_Nd` = 第 N 日成交量 ÷ 事件日成交量（无量纲倍数，**不是百分比**）。
  // 不登记会落到通用分支，行标签显示成「volume_ratio T+1」这种半工程名。
  volume_ratio: "量比",
};

/**
 * 趋势图的**基准线**语义：`volume_ratio` 的「持平」是 1 倍（不是 0），收益类是 0。
 *
 * 基准线画错的代价：量比这种全部为正的序列若按 `y = 0` 当基准，图上「缩量」与「放量」
 * 看起来都是「远高于基准」，方向信息直接丢失。
 */
const FAMILY_BASELINE: Record<string, number> = {
  volume_ratio: 1,
};

export function variableLabelOf(name: string): string {
  if (VARIABLE_LABELS[name]) return VARIABLE_LABELS[name];

  // 分段族：`segment_<stat>_<a>_<b>d`。**先于**通用 `_<n>d` 分支匹配 ——
  // 否则 `segment_return_5_20d` 会被误读成「分段收益_5 → T+20」。
  const segment = /^(segment_[a-z_]+?)_(\d+)_(\d+)d$/.exec(name);
  if (segment) {
    const [, kind, from, to] = segment;
    const kindLabel = SEGMENT_KIND_LABEL[kind!] ?? kind!;
    return `${kindLabel} T+${from}→T+${to}`;
  }

  const parsed = /^([a-z_]+?)_(\d+)d$/.exec(name);
  if (!parsed) return name;
  const [, kind, horizon] = parsed;
  return `${HORIZON_FAMILY_LABEL[kind!] ?? kind!} T+${horizon}`;
}

export function isReturnVariable(name: string): boolean {
  return RETURN_VARIABLE_PATTERN.test(name) || RATIO_FEATURE_VARIABLES.has(name);
}

// ---------------------------------------------------------------------------
// 指标码 → 标签 / 单位 / 精度
// ---------------------------------------------------------------------------

export type MetricUnit = "PERCENT" | "COUNT" | "NUMBER";

/**
 * 指标码 → 中文标签。
 * 与后端 `server/researchEngine/metrics.ts` 的 `label` 保持一致（此处为 front 侧副本，
 * 因为后端 label 未通过 API 暴露；**只有展示文案，不含任何计算**）。
 */
const METRIC_LABELS: Record<string, string> = {
  SAMPLE_COUNT: "样本数",
  MISSING_COUNT: "缺失数",
  MISSING_RATE: "缺失率",
  MEAN: "均值",
  MEAN_RETURN: "平均收益",
  MEDIAN: "中位数",
  MEDIAN_RETURN: "收益中位数",
  STD: "标准差",
  STD_RETURN: "收益标准差",
  VOLATILITY: "波动率",
  MIN: "最小值",
  MAX: "最大值",
  P01: "1% 分位",
  P05: "5% 分位",
  P10: "10% 分位",
  P25: "25% 分位",
  P50: "50% 分位",
  P75: "75% 分位",
  P90: "90% 分位",
  P95: "95% 分位",
  P99: "99% 分位",
  SKEWNESS: "偏度",
  KURTOSIS: "超额峰度",
  WIN_RATE: "胜率",
  PROFIT_FACTOR: "盈亏比",
  AVG_WIN: "平均盈利",
  AVG_LOSS: "平均亏损",
  PAYOFF_RATIO: "盈亏比（均值比）",
  MAX_DRAWDOWN: "区间最大回撤（均值）",
  MAX_FAVORABLE_EXCURSION: "最大有利偏移（均值）",
  MAX_ADVERSE_EXCURSION: "最大不利偏移（均值）",
  DOWNSIDE_DEVIATION: "下行偏差",
  BREAKOUT_RATE: "突破率",
  MEAN_DAYS_TO_BREAKOUT: "平均到突破天数",
  T_STAT: "t 统计量",
  P_VALUE: "双尾 p 值",
  // 「顶底分位差」是 QUANTILE 的术语，用在 SEGMENT_RELATION 的「档」上并不成立 ⇒
  // 改为对两种分档分析都成立的措辞。实际「谁减谁」由引擎写入的 `spreadDefinition` 原样给出。
  SPREAD_TOP_BOTTOM: "最高组 − 最低组",
  DIFFERENCE: "组间差值",
  RELATIVE_DIFFERENCE: "相对差值",
  T_STAT_DIFFERENCE: "组间差 Welch t",
  P_VALUE_DIFFERENCE: "组间差 p 值",
  STABILITY_RATIO: "稳定性比率",
  // RESEARCH-004 —— 配对（同一样本两时段）关系度量
  PAIR_CORRELATION: "配对相关系数",
  PAIR_RANK_CORRELATION: "配对秩相关",
  PAIR_SAMPLE_COUNT: "配对有效样本数",
};

export function metricLabelOf(metricCode: string): string {
  return METRIC_LABELS[metricCode] ?? metricCode;
}

/** 自带单位的指标码（无需变量名即可判定）。 */
const SELF_UNIT: Record<string, MetricUnit> = {
  SAMPLE_COUNT: "COUNT",
  MISSING_COUNT: "COUNT",
  MEAN_DAYS_TO_BREAKOUT: "COUNT",
  PAIR_SAMPLE_COUNT: "COUNT",
  MISSING_RATE: "PERCENT",
  WIN_RATE: "PERCENT",
  BREAKOUT_RATE: "PERCENT",
  STABILITY_RATIO: "PERCENT",
  RELATIVE_DIFFERENCE: "PERCENT",
  MEAN_RETURN: "PERCENT",
  MEDIAN_RETURN: "PERCENT",
  STD_RETURN: "PERCENT",
  VOLATILITY: "PERCENT",
  MAX_DRAWDOWN: "PERCENT",
  MAX_FAVORABLE_EXCURSION: "PERCENT",
  MAX_ADVERSE_EXCURSION: "PERCENT",
  DOWNSIDE_DEVIATION: "PERCENT",
  AVG_WIN: "PERCENT",
  AVG_LOSS: "PERCENT",
  SPREAD_TOP_BOTTOM: "PERCENT",
  DIFFERENCE: "PERCENT",
};

/**
 * 指标 → 单位。
 * @param metricCode 指标码
 * @param variableName 该指标作用的变量名（`DESCRIPTIVE` / 分组统计需要；自带单位的指标可省略）
 */
export function metricUnitOf(metricCode: string, variableName?: string | null): MetricUnit {
  const self = SELF_UNIT[metricCode];
  if (self) return self;
  if (!variableName) return "NUMBER";
  if (COUNT_VARIABLES.has(variableName)) return "COUNT";
  if (isReturnVariable(variableName)) return "PERCENT";
  return "NUMBER";
}

/** 指标小数位（p 值固定 4 位以保证「0.0930 未过门槛」这类判断不被四舍五入抹平）。 */
function metricPrecision(metricCode: string): number {
  if (metricCode === "P_VALUE" || metricCode === "P_VALUE_DIFFERENCE") return 4;
  if (metricCode === "T_STAT" || metricCode === "T_STAT_DIFFERENCE") return 3;
  if (metricCode === "SKEWNESS" || metricCode === "KURTOSIS") return 3;
  return 4;
}

/**
 * 指标数值 → 展示字符串。
 * **null / undefined 一律 "—"**（指标「定义了但算不出来」是合法状态，不得显示为 0）。
 */
export function formatMetricValue(
  metricCode: string,
  value: number | null | undefined,
  variableName?: string | null,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const unit = metricUnitOf(metricCode, variableName);
  if (unit === "COUNT") return formatCount(Math.round(value));
  if (unit === "PERCENT") {
    const pct = value * 100;
    // 极小值不显示成 "0.0000%" 的假零：保留 4 位后仍为 0 → 用更多位标注
    const digits = pct !== 0 && Math.abs(pct) < 0.00005 ? 6 : 4;
    return `${pct.toFixed(digits)}%`;
  }
  return value.toFixed(metricPrecision(metricCode));
}

// ---------------------------------------------------------------------------
// 分组维度 → 可读标签
// ---------------------------------------------------------------------------

/** 条件的组标签（后端写入 `dimensionKey = "group"`）。 */
const GROUP_LABELS: Record<string, string> = {
  ALL: "全样本",
  CONDITION: "满足条件",
};

/** 稳定性维度键 → 中文。 */
const DIMENSION_KEY_LABELS: Record<string, string> = {
  year: "年度",
  month: "月份",
  quarter: "季度",
  board: "板块",
  market: "市场",
  industry: "行业",
  regime: "市场环境",
  /** SEGMENT_RELATION 的窗 A 分档维度（后端 `BAND_DIMENSION_KEY = "windowA"`）。 */
  windowA: "档",
};

export function dimensionKeyLabelOf(key: string): string {
  return DIMENSION_KEY_LABELS[key] ?? key;
}

/**
 * 维度对象 → 分组短标签（表格首列）。
 * 覆盖后端五种真实写法：`{quantile}` / `{horizon}` / `{variable}` / `{group}` / `{<稳定性维度>}`。
 * 无法识别时退化为 `key=value` 的拼接，**绝不返回空串**（避免表格出现空白行）。
 */
export function dimensionLabel(dimension: Record<string, unknown> | null | undefined): string {
  if (!dimension) return "—";
  const keys = Object.keys(dimension);
  if (keys.length === 0) return "—";
  const [key, raw] = [keys[0]!, dimension[keys[0]!]];
  switch (key) {
    case "quantile":
      return `Q${raw}`;
    case "horizon":
      return `T+${raw}`;
    case "variable":
      return variableLabelOf(String(raw));
    case "group":
      return GROUP_LABELS[String(raw)] ?? String(raw);
    default:
      return `${dimensionKeyLabelOf(key)} ${String(raw)}`;
  }
}

/** 维度对象 → 稳定的排序 / 分组键（数值维度按数值排，保证 Q2 在 Q10 之前）。 */
export function dimensionSortKey(dimension: Record<string, unknown> | null | undefined): string {
  if (!dimension) return "";
  const keys = Object.keys(dimension).sort();
  return keys.map((k) => `${k}=${String(dimension[k])}`).join("|");
}

/** 维度中的数值（用于分组排序；非数值维度返回 null）。 */
export function dimensionNumericValue(dimension: Record<string, unknown> | null | undefined): number | null {
  if (!dimension) return null;
  // ⚠️ `windowA`（SEGMENT_RELATION 的窗 A 分档号）必须在此列出：漏掉会让「档 10」排到「档 2」前面
  //    （退化到 `label.localeCompare` 的字符串序）。5 档时看不出问题，10 档才会暴露。
  for (const key of ["quantile", "horizon", "windowA", "year", "month", "quarter"]) {
    const v = dimension[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 分档区间 —— 把「档 3」翻译成「分组变量落在哪个区间」
// ---------------------------------------------------------------------------

/**
 * 分组维度对应的**分组变量名**。
 *
 * 后端两种分档分析的写法不同（不是笔误，是各自 `meta` 的真实结构）：
 *   - QUANTILE → `details.featureVariable`（分档依据的特征变量）；
 *   - SEGMENT_RELATION → `details.windowA.variable`（窗 A 口径映射到的结果变量）。
 */
export function groupVariableOf(
  details: unknown,
  dimension: Record<string, unknown> | null | undefined,
): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  const direct = d.featureVariable;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const windowA = d.windowA;
  if (windowA !== null && typeof windowA === "object") {
    const v = (windowA as Record<string, unknown>).variable;
    if (typeof v === "string" && v.length > 0) return v;
  }
  void dimension;
  return null;
}

/** 分档边界 → 展示串（收益 / 比例型变量转百分数，其余按原值；带正号便于读「涨还是跌」）。 */
function formatGroupBoundary(value: number, variableName: string | null): string {
  if (!Number.isFinite(value)) return "?";
  if (variableName !== null && (isReturnVariable(variableName) || RATIO_FEATURE_VARIABLES.has(variableName))) {
    const pct = value * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

/**
 * 由 `details.cutPoints` + 组号推出该组的**取值区间**文字。
 *
 * 🔴 存在的理由：分档结果的结论文本只能写「第 5 档 − 第 1 档」，而**档号本身不含方向信息** ——
 * 用户无从知道「第 5 档」是「跌得最深的」还是「跌得最浅的」。把区间摊在分组标签下，
 * 「档 5 > +2.01%」这种字面量才让符号可读。
 *
 * 区间端点严格照后端分档规则反解（`band(v) = 1 + |{k : v > percentile(feature, k/G)}|`）：
 *   - 第 1 档：`v ≤ c₀`；中间档：`(c_{k-2}, c_{k-1}]`；第 G 档：`v > c_{G-1}`。
 * `cutPoints` 缺失（非分档类分析）⇒ 返回 null，**不猜**。
 */
export function groupRangeLabelOf(
  details: unknown,
  dimension: Record<string, unknown> | null | undefined,
): string | null {
  if (!details || typeof details !== "object" || !dimension) return null;
  const d = details as Record<string, unknown>;
  const bandRaw = dimension.quantile ?? dimension.windowA;
  if (typeof bandRaw !== "number" || !Number.isInteger(bandRaw)) return null;
  const cutPointsRaw = d.cutPoints;
  if (!Array.isArray(cutPointsRaw)) return null;
  const cutPoints = cutPointsRaw.filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  if (cutPoints.length === 0) return null;

  const variableName = groupVariableOf(details, dimension);
  const groupCount = cutPoints.length + 1;
  const band = bandRaw;
  if (band < 1 || band > groupCount) return null;

  if (band === 1) return `≤ ${formatGroupBoundary(cutPoints[0]!, variableName)}`;
  if (band === groupCount) return `> ${formatGroupBoundary(cutPoints[cutPoints.length - 1]!, variableName)}`;
  const lower = cutPoints[band - 2]!;
  const upper = cutPoints[band - 1]!;
  return `(${formatGroupBoundary(lower, variableName)}, ${formatGroupBoundary(upper, variableName)}]`;
}

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

export interface ExperimentRowVm {
  id: number;
  name: string;
  description: string | null;
  researchType: string;
  status: string;
  datasetVersionId: number;
  sampleCount: number | null;
  createdAt: string | null;
  completedAt: string | null;
}

export function experimentToVm(e: {
  id?: number | undefined;
  name: string;
  description?: string | null | undefined;
  researchType: string;
  status: string;
  datasetVersionId: number;
  sampleCount?: number | null | undefined;
  createdAt?: string | undefined;
  completedAt?: string | null | undefined;
}): ExperimentRowVm {
  return {
    id: e.id ?? 0,
    name: e.name,
    description: e.description ?? null,
    researchType: e.researchType,
    status: e.status,
    datasetVersionId: e.datasetVersionId,
    sampleCount: e.sampleCount ?? null,
    createdAt: e.createdAt ?? null,
    completedAt: e.completedAt ?? null,
  };
}

export interface RunRowVm {
  id: number;
  runNo: number;
  status: string;
  sampleCount: number | null;
  startedAt: string | null;
  completedAt: string | null;
  /** 失败时**必须**冒泡到 UI —— 引擎的可追溯性在这里被用户看见。 */
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  /** 是否已有执行基准快照（= 是否整轮执行过）。增量补跑的前置条件。 */
  hasInputSnapshot: boolean;
  /** 执行批次日志（null = 无记录，见 `RunExecutionBatches` 的版本边界说明）。 */
  executionLog: RunExecutionBatchVm[] | null;
}

/**
 * 执行批次日志的展示形态（1:1 对应后端 `ResearchRunExecutionLogEntry`）。
 * 后端读库时已做结构校验（非法结构会抛错），这里只做展示前的防御性归一。
 */
export interface RunExecutionBatchVm {
  sequence: number;
  mode: string;
  analysisIds: number[];
  sampleCount: number | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  errorCode?: string;
  errorMessage?: string;
  conclusionSkippedReason?: string;
}

/** 批次日志归一：丢掉连最小字段都不齐的条目（正常情况下不会发生）。 */
function toExecutionLogVm(raw: unknown): RunExecutionBatchVm[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RunExecutionBatchVm[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const b = item as Record<string, unknown>;
    if (typeof b.sequence !== "number" || typeof b.status !== "string") continue;
    if (typeof b.startedAt !== "string") continue;
    const vm: RunExecutionBatchVm = {
      sequence: b.sequence,
      mode: typeof b.mode === "string" ? b.mode : "UNKNOWN",
      analysisIds: Array.isArray(b.analysisIds)
        ? b.analysisIds.filter((i): i is number => typeof i === "number")
        : [],
      sampleCount: typeof b.sampleCount === "number" ? b.sampleCount : null,
      status: b.status,
      startedAt: b.startedAt,
      completedAt: typeof b.completedAt === "string" ? b.completedAt : null,
    };
    if (typeof b.errorCode === "string") vm.errorCode = b.errorCode;
    if (typeof b.errorMessage === "string") vm.errorMessage = b.errorMessage;
    if (typeof b.conclusionSkippedReason === "string") {
      vm.conclusionSkippedReason = b.conclusionSkippedReason;
    }
    out.push(vm);
  }
  return out;
}

export function runToVm(r: {
  id?: number | undefined;
  runNo: number;
  status: string;
  sampleCount?: number | null | undefined;
  startedAt?: string | null | undefined;
  completedAt?: string | null | undefined;
  errorCode?: string | null | undefined;
  errorMessage?: string | null | undefined;
  /** 执行基准快照（不可变）。UI 只需要「有没有」——**不**把裸快照漏进视图层。 */
  inputSnapshot?: unknown;
  /** 追加式执行批次日志。 */
  executionLog?: unknown;
}): RunRowVm {
  const startedMs = r.startedAt ? Date.parse(r.startedAt) : NaN;
  const completedMs = r.completedAt ? Date.parse(r.completedAt) : NaN;
  const duration =
    Number.isFinite(startedMs) && Number.isFinite(completedMs) && completedMs >= startedMs
      ? completedMs - startedMs
      : null;
  return {
    id: r.id ?? 0,
    runNo: r.runNo,
    status: r.status,
    sampleCount: r.sampleCount ?? null,
    startedAt: r.startedAt ?? null,
    completedAt: r.completedAt ?? null,
    errorCode: r.errorCode ?? null,
    errorMessage: r.errorMessage ?? null,
    durationMs: duration,
    hasInputSnapshot: r.inputSnapshot !== null && r.inputSnapshot !== undefined,
    executionLog: toExecutionLogVm(r.executionLog),
  };
}

export interface AnalysisRowVm {
  id: number;
  runId: number;
  analysisType: string;
  analysisLabel: string;
  name: string;
  target: string | null;
  status: string;
  createdAt: string | null;
  completedAt: string | null;
}

/** 五类 MVP 分析的中文名（其余类型原样显示，不臆造）。 */
const ANALYSIS_TYPE_LABELS: Record<string, string> = {
  DESCRIPTIVE: "描述统计",
  EVENT_STUDY: "事件研究",
  QUANTILE: "分位分析",
  CONDITIONAL: "条件分析",
  STABILITY: "稳定性分析",
  SEGMENT_RELATION: "分段关系",
};

export function analysisTypeLabelOf(analysisType: string): string {
  return ANALYSIS_TYPE_LABELS[analysisType] ?? analysisType;
}

export function analysisToVm(a: {
  id?: number | undefined;
  runId: number;
  analysisType: string;
  name: string;
  target?: string | null | undefined;
  status: string;
  createdAt?: string | undefined;
  completedAt?: string | null | undefined;
}): AnalysisRowVm {
  return {
    id: a.id ?? 0,
    runId: a.runId,
    analysisType: a.analysisType,
    analysisLabel: analysisTypeLabelOf(a.analysisType),
    name: a.name,
    target: a.target ?? null,
    status: a.status,
    createdAt: a.createdAt ?? null,
    completedAt: a.completedAt ?? null,
  };
}

/** 落库结果行的最小契约（与 `ResearchResult` 对齐，只取展示需要的字段）。 */
export interface ResultRowLike {
  resultType: string;
  metricCode: string;
  metricValue?: number | null | undefined;
  sampleCount?: number | null | undefined;
  dimension?: Record<string, unknown> | null | undefined;
  details?: unknown;
}

/** 单行结果 → 展示行。 */
export interface ResultRowVm {
  metricCode: string;
  label: string;
  value: number | null;
  display: string;
  sampleCount: number | null;
  dimensionLabel: string;
  /** 该指标作用的变量（`details.variable`；缺失则为 null）。 */
  variable: string | null;
  /** 引擎逐行写入的小样本标记（`details.lowSample`）。**必须展示**，不能吞掉。 */
  lowSample: boolean;
  /** 引擎逐行写入的指标口径（`details.metricDefinition` / `details.definition`）。 */
  definition: string | null;
  /**
   * 该分组在**分组变量**上的取值区间（`cutPoints` 反解；仅分档类分析有值）。
   * 例：`> +2.01%` / `(-9.11%, -5.03%]`。非分档分析为 null。
   */
  rangeLabel: string | null;
  /**
   * 差值类结果的**比较口径**（`details.differenceDefinition` / `spreadDefinition`）。
   * 例：`DIFFERENCE = mean(条件样本) − mean(全样本)`。
   * 🔴 必须原样展示：它是「谁减谁」的唯一权威定义，读者据此才知道符号方向。
   */
  comparisonDefinition: string | null;
}

function variableOfDetails(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const v = (details as { variable?: unknown }).variable;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function pickString(details: unknown, keys: readonly string[]): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  for (const key of keys) {
    const v = d[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export function resultRowToVm(row: ResultRowLike): ResultRowVm {
  const variable = variableOfDetails(row.details);
  return {
    metricCode: row.metricCode,
    label: metricLabelOf(row.metricCode),
    value: row.metricValue ?? null,
    display: formatMetricValue(row.metricCode, row.metricValue, variable),
    sampleCount: row.sampleCount ?? null,
    dimensionLabel: dimensionLabel(row.dimension),
    variable,
    lowSample:
      !!row.details && typeof row.details === "object" && (row.details as { lowSample?: unknown }).lowSample === true,
    definition: pickString(row.details, ["metricDefinition", "definition"]),
    rangeLabel: groupRangeLabelOf(row.details, row.dimension),
    comparisonDefinition: pickString(row.details, ["differenceDefinition", "spreadDefinition"]),
  };
}

/**
 * 分组结果 → 按维度聚合的块（每个分组一行）。
 *
 * 注意：**同一分组内不同指标的 sampleCount 可以不同**（真实数据里 `MEAN_RETURN` 的分母是
 * 收益序列长度，`MAX_DRAWDOWN` 的分母是回撤列非空数）。因此这里**逐指标保留自己的 n**，
 * 不用一个「组样本数」覆盖全部 —— 那会伪造分母。
 */
export interface GroupBlockVm {
  key: string;
  label: string;
  /** 原始维度对象（保留，供筛选 / 追溯；UI 不应再自行解析它）。 */
  dimension: Record<string, unknown> | null;
  /** 分组数值（Q/horizon 等；无则 null），用于排序。 */
  numeric: number | null;
  /** 该组内所有指标共有的样本数（全部一致时非 null；不一致或缺失时 null）。 */
  uniformSampleCount: number | null;
  /** 组内任一指标被引擎标记为小样本。 */
  lowSample: boolean;
  /**
   * 该组在分组变量上的取值区间（`cutPoints` 反解）——「档 5」的分组标签下写 `> +2.01%`。
   * 非分档类分析（条件组 / 年度）为 null。
   */
  rangeLabel: string | null;
  metrics: ResultRowVm[];
}

export function buildGroupBlocks(rows: readonly ResultRowLike[]): GroupBlockVm[] {
  const grouped = rows.filter((r) => r.resultType === "GROUPED");
  const buckets = new Map<string, GroupBlockVm>();
  for (const row of grouped) {
    const key = dimensionSortKey(row.dimension);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: dimensionLabel(row.dimension),
        dimension: row.dimension ?? null,
        numeric: dimensionNumericValue(row.dimension),
        uniformSampleCount: null,
        lowSample: false,
        rangeLabel: null,
        metrics: [],
      };
      buckets.set(key, bucket);
    }
    const vm = resultRowToVm(row);
    if (vm.lowSample) bucket.lowSample = true;
    // 同组各行携带同一份 `details`，取第一个非空即可（不去重表里已有字段）
    if (bucket.rangeLabel === null && vm.rangeLabel !== null) bucket.rangeLabel = vm.rangeLabel;
    bucket.metrics.push(vm);
  }
  for (const bucket of buckets.values()) {
    const counts = new Set(bucket.metrics.map((m) => m.sampleCount));
    bucket.uniformSampleCount = counts.size === 1 ? (bucket.metrics[0]?.sampleCount ?? null) : null;
  }
  return [...buckets.values()].sort((a, b) => {
    if (a.numeric !== null && b.numeric !== null) return a.numeric - b.numeric;
    if (a.numeric !== null) return -1;
    if (b.numeric !== null) return 1;
    return a.label.localeCompare(b.label, "zh-Hans-CN");
  });
}

/** 标量结果 → 展示行（`SPREAD_TOP_BOTTOM` / `DIFFERENCE` / `P_VALUE_DIFFERENCE` 等多在此）。 */
export function buildScalarRows(rows: readonly ResultRowLike[]): ResultRowVm[] {
  return rows.filter((r) => r.resultType === "SCALAR").map(resultRowToVm);
}

/** 结果里出现过的全部指标码（保持出现顺序，去重）。 */
export function metricCodesInOrder(rows: readonly ResultRowLike[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (!seen.has(row.metricCode)) {
      seen.add(row.metricCode);
      out.push(row.metricCode);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 一句话结论（从已落库结果里提取，不做任何新统计）
// ---------------------------------------------------------------------------

/**
 * 用于「结论速览」的主指标码（第一个命中的即用；代表该分析的**中心趋势**）。
 *
 * 与 `AnalysisResultsView` 的默认可见列同源。只此一份：两处各写一遍，
 * 迟早会出现「表格按中位数排序、结论按均值排序」这种自相矛盾的展示。
 */
const PRIMARY_METRIC_CODES: readonly string[] = ["MEAN_RETURN", "MEAN", "MEDIAN_RETURN", "MEDIAN"];

/** 结论里的一个「点」（一组在某指标上的取值）。 */
export interface HeadlinePointVm {
  label: string;
  /** 该组在分组变量上的区间（`cutPoints` 反解）；非分档分析为 null。 */
  rangeLabel: string | null;
  value: number;
  display: string;
  sampleCount: number | null;
}

/**
 * 「一句话结论」VM。
 *
 * 🔴 纪律：**只做搬运与措辞，不产生任何新数字**。`spreadValue` / `tStat` / `pValue` 一律取自
 * 引擎已落库的标量结果，`spreadDefinition` 原样带出（引擎写的差值口径是「谁减谁」的唯一定义，
 * 前端**不得**改写 —— 改写了就会出现「表格是条件组−全样本、文案是条件组−对照」这种自相矛盾）。
 *
 * 为什么需要它：分组表只给「每档一个数」，读者要自己在脑子里做减法和排序才能得到结论。
 * 把「哪一组最好 / 好多少 / 显著不显著」提到最前面，是让结果可读性从「查表」变成「读句子」。
 */
export interface ResultHeadlineVm {
  metricCode: string;
  metricLabel: string;
  /** 结论的主语（分档分析 = 最好的那一档；条件分析 = 满足条件的样本）。 */
  primary: HeadlinePointVm;
  /** 结论的参照（分档分析 = 最差的那一档；条件分析 = 全样本）。 */
  reference: HeadlinePointVm;
  /** `primary.value − reference.value`（引擎同口径，未重新计算）。 */
  spreadDisplay: string;
  /** 引擎写入的差值口径文字（`spreadDefinition` / `differenceDefinition`），原样展示。 */
  spreadDefinition: string | null;
  tStat: number | null;
  pValue: number | null;
  sampleCount: number | null;
  /** 分组变量名（把「档」翻回「变量取值」用）。 */
  groupVariable: string | null;
  /** `BANDED` = 按变量分档；`CONDITIONAL` = 条件组 vs 全样本。 */
  kind: "BANDED" | "CONDITIONAL";
}

function scvDetailOf(rows: readonly ResultRowLike[], metricCode: string): Record<string, unknown> | null {
  const row = rows.find((r) => r.resultType === "SCALAR" && r.metricCode === metricCode);
  const d = row?.details;
  return d !== null && d !== undefined && typeof d === "object" ? (d as Record<string, unknown>) : null;
}

/**
 * 允许生成「结论速览」的分组维度键。
 *
 * 只收**有序**维度：分位 / 分档 / 视界 / 时间。「变量」「板块」「行业」是名义分类 ——
 * 它们之间没有「最高减最低」可言（「换手率 vs 成交量」谁高谁低是没有意义的比较），
 * 硬算一个顶底差会凭空造出一个假结论。
 */
const HEADLINE_DIMENSION_KEYS = new Set(["quantile", "windowA", "horizon", "group", "year", "month", "quarter"]);

/**
 * 生成一句话结论。返回 `null` = 该结果不具备「可总结的对照结构」
 * （例如纯描述统计 DESCRIPTIVE、分组少于 2 组）——**不硬凑**。
 */
export function buildHeadline(
  rows: readonly ResultRowLike[],
  blocks: readonly GroupBlockVm[],
): ResultHeadlineVm | null {
  if (blocks.length < 2) return null;
  const firstDimension = blocks[0]?.dimension ?? null;
  const dimensionKey = firstDimension === null ? null : (Object.keys(firstDimension)[0] ?? null);
  if (dimensionKey === null || !HEADLINE_DIMENSION_KEYS.has(dimensionKey)) return null;
  const metricCode = metricCodesInOrder(rows.filter((r) => r.resultType === "GROUPED")).find((c) =>
    PRIMARY_METRIC_CODES.includes(c),
  );
  if (metricCode === undefined) return null;

  const points: HeadlinePointVm[] = [];
  for (const block of blocks) {
    const cell = block.metrics.find((m) => m.metricCode === metricCode);
    if (cell === undefined || cell.value === null) continue;
    points.push({
      label: block.label,
      rangeLabel: block.rangeLabel,
      value: cell.value,
      display: cell.display,
      sampleCount: cell.sampleCount,
    });
  }
  if (points.length < 2) return null;

  const scalarCodes = new Set(rows.filter((r) => r.resultType === "SCALAR").map((r) => r.metricCode));
  const banded = scalarCodes.has("SPREAD_TOP_BOTTOM");
  const conditional = scalarCodes.has("DIFFERENCE");
  const kind: ResultHeadlineVm["kind"] = banded || !conditional ? "BANDED" : "CONDITIONAL";
  const spreadCode = kind === "CONDITIONAL" ? "DIFFERENCE" : "SPREAD_TOP_BOTTOM";

  /**
   * 🔴 「顶 / 底」是**分组变量**的顶底（档位首尾），不是结果值的最高最低。
   *
   * 引擎的 `SPREAD_TOP_BOTTOM = mean(末档) − mean(首档)`（见 `spreadDefinition`）。
   * 若这里贪方便按「结果值最大 / 最小」取两点，非单调分档下就会选到中间档，
   * 于是**文案里的差值**与**表格里的 spread 数字**对不上 —— 展示层自相矛盾比不展示更糟。
   * 所以这里严格复刻引擎口径：末档 − 首档。（`points` 已随 `blocks` 按维度值升序。）
   */
  let primary = points[points.length - 1]!;
  let reference = points[0]!;
  if (kind === "CONDITIONAL") {
    const conditionBlock = blocks.find((b) => b.dimension?.group === "CONDITION");
    const allBlock = blocks.find((b) => b.dimension?.group === "ALL");
    const conditionPoint = points.find((p) => p.label === conditionBlock?.label);
    const allPoint = points.find((p) => p.label === allBlock?.label);
    if (conditionPoint !== undefined && allPoint !== undefined) {
      primary = conditionPoint;
      reference = allPoint;
    }
  }

  const spreadRow = rows.find((r) => r.resultType === "SCALAR" && r.metricCode === spreadCode);
  const detail = scvDetailOf(rows, spreadCode);
  const spreadValue = spreadRow?.metricValue ?? null;
  const tRow = rows.find((r) => r.resultType === "SCALAR" && r.metricCode === "T_STAT_DIFFERENCE");
  const pRow = rows.find((r) => r.resultType === "SCALAR" && r.metricCode === "P_VALUE_DIFFERENCE");

  return {
    metricCode,
    metricLabel: metricLabelOf(metricCode),
    primary,
    reference,
    spreadDisplay:
      spreadValue === null || spreadValue === undefined ? "—" : formatMetricValue(spreadCode, spreadValue),
    spreadDefinition: pickString(detail, ["spreadDefinition", "differenceDefinition"]),
    tStat: tRow?.metricValue ?? null,
    pValue: pRow?.metricValue ?? null,
    sampleCount: spreadRow?.sampleCount ?? null,
    groupVariable: groupVariableOf(detail, null),
    kind,
  };
}

/** 有序序列上的一个点 = 一个滞后日（一族变量里的一个成员）。 */
export interface VariableSeriesPointVm {
  /** 滞后阶数（`volume_ratio_3d` → 3）。 */
  lag: number;
  /** 原始变量名（`volume_ratio_3d`）。 */
  variable: string;
  /** 变量中文名（`量比 T+3`）。 */
  label: string;
  /** 该点上的全部指标（保持分组块内原始顺序）。 */
  metrics: ResultRowVm[];
}

/** 一族有序变量构成的趋势序列（见 `buildVariableSeries`）。 */
export interface VariableSeriesVm {
  /** 变量族前缀（`volume_ratio`）。 */
  family: string;
  /** 变量族中文名（`量比`）。 */
  familyLabel: string;
  /** 趋势图的基准线取值（量比 = 1、收益类 = 0）；`null` = 语义不明，不画基准线。 */
  baseline: number | null;
  /** 全部点，按滞后阶数升序。 */
  points: VariableSeriesPointVm[];
  /** 序列上出现过的指标码（按首次出现顺序）。 */
  metricCodes: string[];
}

/**
 * 一族「**同一变量、不同滞后日**」的结果 —— 横轴是时间，该画折线，不该画分组对比条。
 *
 * 判定（全部满足才返回，否则 `null`，**不硬凑**）：
 *   1. 每个分组块的维度都恰好只有 `variable` 一个键；
 *   2. 变量名都匹配 `{family}_{h}d`，且 `family` 完全相同；
 *   3. 滞后阶数互不重复，且至少 2 个点。
 *
 * 为什么单独走一条路径：`volume_ratio_1d..5d` 的 5 个「组」其实是**同一物理量的 5 个时点**，
 * 用分组条形图呈现会把它拍成一堆并列类别 —— 「逐日衰减」这个唯一的信息就没了。同时这与
 * `HEADLINE_DIMENSION_KEYS` 对 `variable` 的排除**不冲突**：仍然不生成「顶底差」结论，
 * 只是换一种呈现方式。
 */
export function buildVariableSeries(blocks: readonly GroupBlockVm[]): VariableSeriesVm | null {
  if (blocks.length < 2) return null;
  let family: string | null = null;
  const seenLags = new Set<number>();
  const points: VariableSeriesPointVm[] = [];
  for (const block of blocks) {
    const dimension = block.dimension;
    const keys = dimension === null ? [] : Object.keys(dimension);
    if (keys.length !== 1 || keys[0] !== "variable") return null;
    const variable = String(dimension?.["variable"]);
    const parsed = /^([a-z][a-z_]*?)_(\d+)d$/.exec(variable);
    if (!parsed) return null;
    const lag = Number(parsed[2]);
    if (!Number.isInteger(lag) || lag <= 0 || seenLags.has(lag)) return null;
    const fam = parsed[1]!;
    if (family === null) family = fam;
    else if (family !== fam) return null;
    seenLags.add(lag);
    points.push({ lag, variable, label: variableLabelOf(variable), metrics: [...block.metrics] });
  }
  points.sort((a, b) => a.lag - b.lag);

  const metricCodes: string[] = [];
  const seenCodes = new Set<string>();
  for (const point of points) {
    for (const metric of point.metrics) {
      if (seenCodes.has(metric.metricCode)) continue;
      seenCodes.add(metric.metricCode);
      metricCodes.push(metric.metricCode);
    }
  }

  const familyName = family!;
  return {
    family: familyName,
    familyLabel: HORIZON_FAMILY_LABEL[familyName] ?? familyName,
    // 量比这类「1 倍 = 持平」的族必须把基准画在 1；否则缩量/放量看上去都「远高于基准」。
    baseline: FAMILY_BASELINE[familyName] ?? (isReturnVariable(`${familyName}_1d`) ? 0 : null),
    points,
    metricCodes,
  };
}

/**
 * 反推「对照组」均值 —— 条件分析里**被条件挡掉**的那部分样本。
 *
 * 起因：`CONDITIONAL` 分析只落库两组（**条件组** 与 **全样本**），结果里根本没有对照组，
 * 于是「破 vs 不破到底差多少」只能人工心算，而且极容易把「条件组 vs 全样本」误读成
 * 「条件组 vs 对照组」（分母完全不同，观感却只差一个数字）。
 *
 * 🔴 这**不是重新定义口径**，而是把引擎自身就满足的恒等式做一次变形：
 * ```
 *   n_all · M_all = n_c · M_c + (n_all − n_c) · M_rest
 * ⇒ M_rest = (n_all · M_all − n_c · M_c) / (n_all − n_c)
 * ```
 * 前提只有「条件组 ⊆ 全样本，且两者互斥」—— 这正是条件分析的定义，不需要额外假设。
 * 因此结果在数学上是**精确值**，不是估计量。但它对输入敏感：`allMean/allCount` 与
 * `conditionMean/conditionCount` 必须取自**同一个指标**，否则恒等式不成立（调用方保证）。
 *
 * 返回 `null`（宁可缺数，也不给可疑数）：入参非有限数 / 任一计数 ≤ 0 /
 * `conditionCount >= allCount`（没有剩余样本）/ 计算结果非有限。
 */
export function estimateExcludedGroupMean(
  allMean: number | null | undefined,
  allCount: number | null | undefined,
  conditionMean: number | null | undefined,
  conditionCount: number | null | undefined,
): number | null {
  if (typeof allMean !== "number" || !Number.isFinite(allMean)) return null;
  if (typeof conditionMean !== "number" || !Number.isFinite(conditionMean)) return null;
  if (typeof allCount !== "number" || !Number.isFinite(allCount) || allCount <= 0) return null;
  if (typeof conditionCount !== "number" || !Number.isFinite(conditionCount) || conditionCount <= 0) {
    return null;
  }
  const restCount = allCount - conditionCount;
  if (restCount <= 0) return null;
  const restMean = (allCount * allMean - conditionCount * conditionMean) / restCount;
  return Number.isFinite(restMean) ? restMean : null;
}

// ---------------------------------------------------------------------------
// 结论
// ---------------------------------------------------------------------------

/** 结论 `evidence` 的真实结构（由 `server/researchEngine/conclusion.ts#buildEvidence` 写入）。 */
export interface ConclusionPrimaryVm {
  analysisId: number | null;
  analysisType: string | null;
  analysisTypeLabel: string | null;
  effectLabel: string;
  effect: number | null;
  effectDisplay: string;
  pValue: number | null;
  pValueDisplay: string;
  tStat: number | null;
  sampleCount: number | null;
  minGroupSampleCount: number | null;
  groupCount: number | null;
  directionConsistency: number | null;
}

export interface ConclusionRuleVm {
  rule: string;
  /** 规则序号（`R1_样本达标` → `R1`）。 */
  code: string;
  passed: boolean;
  detail: string;
}

export interface ConclusionContributorVm {
  analysisId: number;
  analysisTypeLabel: string;
  effectLabel: string;
  effectDisplay: string;
  pValueDisplay: string;
  sampleCount: number | null;
  notes: string[];
}

export interface ConclusionEvidenceVm {
  disclaimer: string;
  /** 判定阈值口径（可复核，来自后端 `ConclusionPolicy`）。 */
  policy: {
    alpha: number | null;
    materialityAbs: number | null;
    materialityDisplay: string;
    minSampleCount: number | null;
    stabilityMinConsistentRatio: number | null;
  };
  hypothesisStatement: string | null;
  /** `null` = 本次没有任何可用主分析（键存在但值为 null，不是键缺失）。 */
  primaryAnalysis: ConclusionPrimaryVm | null;
  primarySelectionRule: string | null;
  contributingAnalyses: ConclusionContributorVm[];
  ruleTrace: ConclusionRuleVm[];
  confidenceBasis: string;
  /** 是否已由后端显式标注「confidence 不是 p-value」。 */
  confidenceIsNotPValue: boolean;
  /** 与前瞻目标无关的补充说明（历史证据里可能缺省）。 */
  notes: string[];
}

export interface ConclusionVm {
  id: number;
  conclusionType: string;
  title: string;
  conclusion: string;
  confidence: number | null;
  status: string;
  createdAt: string | null;
  evidence: ConclusionEvidenceVm;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function emptyEvidence(): ConclusionEvidenceVm {
  return {
    disclaimer: "",
    policy: {
      alpha: null,
      materialityAbs: null,
      materialityDisplay: "—",
      minSampleCount: null,
      stabilityMinConsistentRatio: null,
    },
    hypothesisStatement: null,
    primaryAnalysis: null,
    primarySelectionRule: null,
    contributingAnalyses: [],
    ruleTrace: [],
    confidenceBasis: "",
    confidenceIsNotPValue: false,
    notes: [],
  };
}

/**
 * 结论 → ViewModel。
 *
 * 兼容两种历史写法：`buildEvidence` 统一前后，键名固定为 `ruleTrace` / `contributingAnalyses`；
 * 但在统一之前落库的「无可用主效应」结论用的是 `trace` / `analyses`。已存数据不改写，
 * 读取侧两种键名都认（新键优先）。
 */
export function conclusionToVm(c: {
  id?: number | undefined;
  conclusionType: string;
  title: string;
  conclusion: string;
  confidence?: number | null | undefined;
  status: string;
  createdAt?: string | undefined;
  evidence?: unknown;
}): ConclusionVm {
  const ev = asRecord(c.evidence);
  if (!ev) {
    return {
      id: c.id ?? 0,
      conclusionType: c.conclusionType,
      title: c.title,
      conclusion: c.conclusion,
      confidence: c.confidence ?? null,
      status: c.status,
      createdAt: c.createdAt ?? null,
      evidence: emptyEvidence(),
    };
  }

  const base = emptyEvidence();
  const policyRec = asRecord(ev.policy) ?? {};
  const materialityAbs = num(policyRec.materialityAbs);
  base.policy = {
    alpha: num(policyRec.alpha),
    materialityAbs,
    materialityDisplay: formatMetricValue("DIFFERENCE", materialityAbs),
    minSampleCount: num(policyRec.minSampleCount),
    stabilityMinConsistentRatio: num(policyRec.stabilityMinConsistentRatio),
  };

  const primaryRec = asRecord(ev.primaryAnalysis);
  base.primaryAnalysis = primaryRec
    ? {
        analysisId: num(primaryRec.analysisId),
        analysisType: str(primaryRec.analysisType),
        analysisTypeLabel: str(primaryRec.analysisType) ? analysisTypeLabelOf(String(primaryRec.analysisType)) : null,
        effectLabel: str(primaryRec.effectLabel) ?? "主效应",
        effect: num(primaryRec.effect),
        effectDisplay: formatMetricValue("DIFFERENCE", num(primaryRec.effect)),
        pValue: num(primaryRec.pValue),
        pValueDisplay: formatMetricValue("P_VALUE", num(primaryRec.pValue)),
        tStat: num(primaryRec.tStat),
        sampleCount: num(primaryRec.sampleCount),
        minGroupSampleCount: num(primaryRec.minGroupSampleCount),
        groupCount: num(primaryRec.groupCount),
        directionConsistency: num(primaryRec.directionConsistency),
      }
    : null;

  const traceRaw = Array.isArray(ev.ruleTrace) ? ev.ruleTrace : Array.isArray(ev.trace) ? ev.trace : [];
  const contributorsRaw = Array.isArray(ev.contributingAnalyses)
    ? ev.contributingAnalyses
    : Array.isArray(ev.analyses)
      ? ev.analyses
      : [];

  return {
    id: c.id ?? 0,
    conclusionType: c.conclusionType,
    title: c.title,
    conclusion: c.conclusion,
    confidence: c.confidence ?? null,
    status: c.status,
    createdAt: c.createdAt ?? null,
    evidence: {
      ...base,
      disclaimer: str(ev.disclaimer) ?? "",
      hypothesisStatement: str(ev.hypothesisStatement),
      primarySelectionRule: str(ev.primarySelectionRule),
      ruleTrace: traceRaw.flatMap((item) => {
        const rec = asRecord(item);
        if (!rec) return [];
        const rule = str(rec.rule) ?? "规则";
        return [
          {
            rule,
            code: /^([A-Z]+\d)/.exec(rule)?.[1] ?? rule,
            passed: rec.passed === true,
            detail: str(rec.detail) ?? "",
          },
        ];
      }),
      contributingAnalyses: contributorsRaw.flatMap((item) => {
        const rec = asRecord(item);
        if (!rec) return [];
        return [
          {
            analysisId: num(rec.analysisId) ?? 0,
            analysisTypeLabel: analysisTypeLabelOf(String(rec.analysisType ?? "")),
            effectLabel: str(rec.effectLabel) ?? "主效应",
            effectDisplay: formatMetricValue("DIFFERENCE", num(rec.effect)),
            pValueDisplay: formatMetricValue("P_VALUE", num(rec.pValue)),
            sampleCount: num(rec.sampleCount),
            notes: strArray(rec.notes),
          },
        ];
      }),
      confidenceBasis: str(ev.confidenceBasis) ?? "",
      confidenceIsNotPValue: ev.confidenceIsNotPValue === true,
      notes: strArray(ev.notes),
    },
  };
}

// ---------------------------------------------------------------------------
// 分析模板（RESEARCH-002C）
// ---------------------------------------------------------------------------

/** 模板清单项的展示形态。 */
export interface AnalysisTemplateVm {
  id: number;
  name: string;
  description: string | null;
  sourceExperimentId: number | null;
  /** 含多少个分析 —— 列表里最该先看到的信息。 */
  itemCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  /** 明细（预览清单用；`sortOrder` 决定顺序由展示层负责）。 */
  items: Array<{
    sortOrder: number;
    analysisType: string;
    name: string;
    target: string | null;
  }>;
}

/**
 * 模板归一。
 *
 * 与批次日志同一种纪律：后端读库时已做结构校验，这里只做展示前的防御性归一 ——
 * **连最小字段都不齐的明细项会被丢掉**，而不是渲染成一行空白让人误以为模板是空的。
 */
export function toAnalysisTemplateVm(raw: unknown): AnalysisTemplateVm | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "number") return null;
  if (typeof t.name !== "string") return null;
  const items: AnalysisTemplateVm["items"] = [];
  if (Array.isArray(t.items)) {
    for (const entry of t.items) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const i = entry as Record<string, unknown>;
      if (typeof i.analysisType !== "string" || typeof i.name !== "string") continue;
      items.push({
        sortOrder: typeof i.sortOrder === "number" ? i.sortOrder : items.length,
        analysisType: i.analysisType,
        name: i.name,
        target: typeof i.target === "string" ? i.target : null,
      });
    }
  }
  items.sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    id: t.id,
    name: t.name,
    description: typeof t.description === "string" ? t.description : null,
    sourceExperimentId: typeof t.sourceExperimentId === "number" ? t.sourceExperimentId : null,
    itemCount: items.length,
    createdAt: typeof t.createdAt === "string" ? t.createdAt : null,
    updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : null,
    items,
  };
}

/** 模板列表归一（丢不掉「整个模板」，只丢掉不完整的模板）。 */
export function toAnalysisTemplateVms(raw: unknown): AnalysisTemplateVm[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(toAnalysisTemplateVm).filter((v): v is AnalysisTemplateVm => v !== null);
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/**
 * tRPC / 引擎错误 → 结构化诊断。
 *
 * 引擎的机器可读错误码（`server/researchEngine/types.ts`）在这里被翻译成「下一步该做什么」，
 * 而不是把 `ANALYSIS_FAILED` 直接甩给用户。
 */
const ENGINE_ERROR_HINTS: Record<string, { title: string; explanation: string; suggestions: string[] }> = {
  DATASET_VERSION_NOT_READY: {
    title: "Dataset 版本尚不可用",
    explanation: "只有状态为 READY（或 FAILED/CANCELLED 之外已就绪）的 Dataset 版本才能参与研究。",
    suggestions: ["到「数据集构建」确认该版本状态", "待构建完成后再创建实验"],
  },
  DATASET_VERSION_NOT_FOUND: {
    title: "Dataset 版本不存在",
    explanation: "实验引用的 datasetVersionId 在 Dataset Registry 中查不到。",
    suggestions: ["在「数据集构建」中确认版本是否存在"],
  },
  NO_ANALYSES: {
    title: "Run 下没有任何分析",
    explanation: "引擎需要至少一个分析定义才能执行。",
    suggestions: ["先在本页「分析」页签新建一个分析", "再点击「运行引擎」"],
  },
  UNKNOWN_ANALYSIS_TYPE: {
    title: "分析类型尚未实现",
    explanation:
      "RESEARCH-002 实现了 DESCRIPTIVE / EVENT_STUDY / QUANTILE / CONDITIONAL / STABILITY，"
      + "RESEARCH-004 增加了 SEGMENT_RELATION（分段关系）。",
    suggestions: ["改为上述类型之一", "IC / DISTRIBUTION / PATH / REGIME 尚未实现，当前不支持"],
  },
  WINDOW_OVERLAP: {
    title: "两个时间窗重叠了",
    explanation:
      "分段关系分析里，窗 B 的取值区间与窗 A 有交集 —— 窗 B 的结果里混进了用来分档的那段行情，"
      + "「后一段的表现」会有一部分是前一段的同义反复，相关系数被机械拉高。引擎因此拒绝执行。",
    suggestions: [
      "把窗 B 的起设为窗 A 的止之后（例如 窗 A = T+0..T+5、窗 B = T+5..T+20）",
      "注意锚点日不计入取值：窗 A 的取值是 T+1..T+5，故窗 B 从 T+5 起是合法的",
    ],
  },
  INVALID_ANALYSIS_CONFIG: {
    title: "分析配置不完整",
    explanation: "该分析类型要求的必填项缺失（如 QUANTILE 需要特征变量 + 目标变量 + 分组数）。",
    suggestions: ["检查分析的变量与分组数配置", "重新保存分析后再运行"],
  },
  UNKNOWN_VARIABLE: {
    title: "变量在当前 Dataset 中不存在",
    explanation: "变量目录由 Dataset 的真实视界推导，不会为不存在的视界发明变量。",
    suggestions: ["改为变量目录中实际列出的变量", "注意 outcome 只覆盖 {5,10,20}，而 path 覆盖 1~20"],
  },
  VARIABLE_ROLE_VIOLATION: {
    title: "变量角色用错",
    explanation: "特征变量只能来自 T 日及之前（event / prefix），结果变量只能来自 T+1 及之后（path / outcome）。",
    suggestions: ["把未来收益类变量放到「目标变量」", "把 T 日可观测的变量放到「特征变量」"],
  },
  DATASET_TOO_LARGE: {
    title: "样本量超出引擎上限",
    explanation: "引擎不把整份 Dataset 读进内存；超出 maxSamples 会明确拒绝而不是拖垮进程。",
    suggestions: ["缩小 Run 的日期范围", "拆分实验分批研究"],
  },
  EMPTY_SAMPLE_SET: {
    title: "样本集为空",
    explanation: "在选定范围 / 条件下没有任何可用事件。",
    suggestions: ["放宽 Run 的日期范围", "检查是否为条件过严"],
  },
  RUN_NOT_PENDING: {
    title: "该 Run 当前不可执行",
    explanation: "只有 PENDING / FAILED / CANCELLED 状态的 Run 可以重新执行（已 COMPLETED 的 Run 不可覆盖）。",
    suggestions: ["新建一个 Run 再执行"],
  },
  REGIME_PROVIDER_UNAVAILABLE: {
    title: "市场环境维度不可用",
    explanation: "regime 分组需要接入合法的 RegimeTagProvider；当前 Dataset 未提供市场环境列。",
    suggestions: ["改用 year / month / board 等可用维度"],
  },
  ANALYSIS_FAILED: {
    title: "分析执行失败",
    explanation: "失败已如实落到 Run 的 errorCode / errorMessage，可在「运行」页签查看。",
    suggestions: ["查看 Run 的错误码定位原因", "修正后新建 Run 重跑"],
  },
  // ---- RESEARCH-002C：批量建分析 / 分析模板 ----
  BATCH_VALIDATION_FAILED: {
    title: "批量创建预检未通过",
    explanation:
      "预检发现的问题会逐项列出，且**一个分析都没有创建**（不是建了一半）。修正清单里的问题后重试即可。",
    suggestions: ["按提示逐项修正预览清单", "条件分析必须先填好条件（空条件等于全样本）"],
  },
  BATCH_TOO_LARGE: {
    title: "单批数量超限",
    explanation: "单次批量创建有数量上限；一次建太多既难核对，也容易在跨境写入上耗时过久。",
    suggestions: ["拆成多批提交", "或把常用组合存成模板分批铺开"],
  },
  TEMPLATE_NOT_FOUND: {
    title: "模板不存在",
    explanation: "该模板可能已被删除。",
    suggestions: ["刷新模板清单", "重新保存一份模板"],
  },
  TEMPLATE_NAME_CONFLICT: {
    title: "模板名已存在",
    explanation: "模板名全局唯一 —— 「一键铺开」时按名字引用必须不歧义。",
    suggestions: ["换一个模板名", "或先删除同名模板"],
  },
  TEMPLATE_VALIDATION_FAILED: {
    title: "模板内容不合法",
    explanation: "模板必须至少含一个分析，且每个分析的名称、类型、条件都要合法。",
    suggestions: ["检查预览清单里是否有被标出的问题项", "条件分析需要填好条件"],
  },
};

export function rpcErrorToDiagnostic(
  message: string | null | undefined,
  options?: { title?: string; technical?: string },
): DiagnosticError {
  const raw = (message ?? "").trim();
  const technical = options?.technical ?? raw;
  // tRPC 把错误消息序列化为 `<原始 message>`；引擎错误码就在开头的方括号或裸词里。
  const codeMatch = /\[([A-Z_]{3,})\]/u.exec(raw);
  const bareMatch = /^([A-Z][A-Z_]{3,})\b/u.exec(raw);
  const code = (codeMatch?.[1] ?? bareMatch?.[1] ?? "").trim();
  const hint = code ? ENGINE_ERROR_HINTS[code] : undefined;
  if (hint) {
    return {
      code,
      title: options?.title ? `${options.title}：${hint.title}` : hint.title,
      explanation: hint.explanation,
      suggestions: hint.suggestions,
      technical,
    };
  }
  return {
    code: code || "RPC_ERROR",
    title: options?.title ?? "请求失败",
    explanation: raw || "后端未返回可读的错误信息。",
    suggestions: ["重试一次", "若持续失败，查看服务端日志中的原始错误"],
    technical,
  };
}
