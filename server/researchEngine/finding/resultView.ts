/**
 * RESEARCH-FINDING-001 B4 —— Result 行 → 有序分组序列（**纯函数，无统计计算**）。
 *
 * 输入：某 Analysis 的 `research_result` 行（Repository 已读好）。
 * 输出：`AnalysisSeries`（有序档位 / 基准行 / 标量指标 / provenance id）。
 *
 * 口径来源（全部来自**真库实测**，见 `docs/evidence/_probe_finding_result_shapes.out.txt`）：
 *   - QUANTILE      `dimension = { quantile: <组号 1..G> }`，`details.cutPoints` 给出真实边界；
 *   - CONDITIONAL   `dimension = { group: "ALL" | "CONDITION" }`；
 *   - EVENT_STUDY   `dimension = { horizon: <h> }`（h 为**数字**）；
 *   - STABILITY     `dimension = { <dimensionKey>: <切片值> }`，另有一行 `label = "ALL"`；
 *   - DESCRIPTIVE   `dimension = { variable: <变量名> }`，指标码是 `MEAN`（不是 `MEAN_RETURN`）。
 *
 * 🔴 本文件**不做任何统计**：只做「取值 / 排序 / 拼标签 / 收集 id」。
 *    任何 mean / 相关 / 一致性一律走 `researchEngine/metrics.ts` 的唯一实现。
 */

import type { ResearchAnalysisType, ResearchResult } from "../../researchCore";
import type { AnalysisSeries, OrderedBucket, SeriesBenchmark, SeriesScalar } from "./types";

/** 表示「整体 / 全样本」的标签（各分析共用约定）。 */
const WHOLE_SAMPLE_LABELS: ReadonlySet<string> = new Set(["ALL"]);

/**
 * 该分析类型下「档位主指标」的 metricCode。
 *
 * 为什么不统一成 `MEAN_RETURN`：DESCRIPTIVE 是对**任意变量**做分布统计，
 * 它输出的是通用 `MEAN`（真库实测），硬要它用 `MEAN_RETURN` 会让描述统计永远取不到值。
 */
export function metricPreferenceFor(analysisType: ResearchAnalysisType): string {
  return analysisType === "DESCRIPTIVE" ? "MEAN" : "MEAN_RETURN";
}

/**
 * DESCRIPTIVE 的档位是「变量名」，**不构成自然顺序**，因此只能当**基准提供者**，
 * 不能拿去做单调性 / 峰谷判定。其余类型的第一版都按有序关系评估。
 */
export function isAssessableType(analysisType: ResearchAnalysisType): boolean {
  return (
    analysisType === "QUANTILE" ||
    analysisType === "CONDITIONAL" ||
    analysisType === "EVENT_STUDY" ||
    analysisType === "STABILITY"
  );
}

/** 取 dimension 对象的唯一键（真库中每行只有一个键）。多键时取字典序首个并如实标注。 */
export function dimensionKeyOf(dimension: Record<string, unknown> | null | undefined): string | null {
  if (dimension === null || dimension === undefined) return null;
  const keys = Object.keys(dimension);
  if (keys.length === 0) return null;
  return keys.sort()[0] ?? null;
}

/** 取 details（可能为 null / 非对象）→ 浅对象。 */
function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * 切点是否**严格递增**。
 *
 * 为什么关键：`is_one_word_hold` 这类 0/1 特征做 10 分位时，真库 cutPoints 是
 * `[0,0,0,0,0,0,0,0,0]`（实测）。此时 Q1..Q9 的特征区间都是同一个点，
 * **档位顺序不再代表特征量级** —— 在这种退化分组上宣判「单调 / 峰谷」就是虚假发现。
 */
export function isStrictlyIncreasing(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    if (!(values[i]! > values[i - 1]!)) return false;
  }
  return values.length >= 2;
}

/** 数值格式化（不定单位 —— 变量量纲未知，**不臆造 `%`**）。 */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "?";
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e6)) return v.toExponential(2);
  return v.toFixed(4);
}

/**
 * 由 `cutPoints` 还原每组区间文字。
 * 退化切点（非严格递增）→ 一律返回 null（**不编造区间**）。
 */
export function buildRangeTexts(cutPoints: unknown, groupCount: number): Array<string | null> {
  const out: Array<string | null> = new Array(Math.max(0, groupCount)).fill(null);
  if (!Array.isArray(cutPoints) || cutPoints.length === 0) return out;
  const cuts = cutPoints.filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  if (cuts.length !== cutPoints.length) return out;
  if (!isStrictlyIncreasing(cuts)) return out;
  for (let g = 1; g <= groupCount; g += 1) {
    const lo = g === 1 ? null : cuts[g - 2];
    const hi = g === groupCount ? null : cuts[g - 1];
    let text: string;
    if (lo === null && hi !== null) text = `< ${fmt(hi)}`;
    else if (lo !== null && hi === null) text = `>= ${fmt(lo)}`;
    else if (lo !== null && hi !== null) text = `[${fmt(lo)}, ${fmt(hi)})`;
    else text = "全域";
    out[g - 1] = text;
  }
  return out;
}

/** 档位排序键：数值型按数值，其余按「自然序」（数字感知）字符串比较（与 STABILITY 分析同口径）。 */
function orderKey(raw: string | number): { numeric: number | null; text: string } {
  if (typeof raw === "number" && Number.isFinite(raw)) return { numeric: raw, text: String(raw) };
  const asNum = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  if (Number.isFinite(asNum) && String(asNum) === String(raw)) return { numeric: asNum, text: String(raw) };
  return { numeric: null, text: String(raw) };
}

function compareRaw(a: string | number, b: string | number): number {
  const ka = orderKey(a);
  const kb = orderKey(b);
  if (ka.numeric !== null && kb.numeric !== null) return ka.numeric - kb.numeric;
  return ka.text.localeCompare(kb.text, "zh-Hans-CN", { numeric: true });
}

/**
 * 解析分析序列。返回 null 表示「该分析没有任何可消费的 Result」（引擎据此记 skip 原因）。
 */
export function parseAnalysisSeries(args: {
  analysisId: number;
  analysisType: ResearchAnalysisType;
  target: string | null;
  results: ReadonlyArray<ResearchResult>;
}): AnalysisSeries | null {
  const { analysisId, analysisType, target, results } = args;
  if (results.length === 0) return null;

  const primaryCode = metricPreferenceFor(analysisType);

  // ---- 1. 定位分组维度键（以主指标行优先，避免被 details-only 行带偏） ----
  let dimensionKey: string | null = null;
  for (const r of results) {
    if (r.metricCode !== primaryCode) continue;
    const key = dimensionKeyOf(r.dimension);
    if (key !== null) {
      dimensionKey = key;
      break;
    }
  }
  if (dimensionKey === null) {
    for (const r of results) {
      const key = dimensionKeyOf(r.dimension);
      if (key !== null) {
        dimensionKey = key;
        break;
      }
    }
  }

  // ---- 2. 按 dimension 取值聚合 ----
  interface Agg {
    raw: string | number;
    metricValue: number | null;
    medianReturn: number | null;
    winRate: number | null;
    sampleCount: number | null;
    resultIds: number[];
  }
  const byLabel = new Map<string, Agg>();
  const scalars = new Map<string, SeriesScalar>();
  let meta: Record<string, unknown> = {};

  for (const r of results) {
    const id = r.id;
    if (id === undefined) continue;
    if (Object.keys(meta).length === 0) {
      const d = asRecord(r.details);
      if (Object.keys(d).length > 0) meta = d;
    }
    const dim = r.dimension ?? null;
    if (dim === null || dimensionKey === null) {
      // 标量行（SCALAR / dimension 缺失）
      const prev = scalars.get(r.metricCode);
      if (prev === undefined) {
        scalars.set(r.metricCode, {
          metricCode: r.metricCode,
          metricValue: r.metricValue ?? null,
          sampleCount: r.sampleCount ?? null,
          resultIds: [id],
        });
      } else {
        prev.resultIds.push(id);
        if (prev.metricValue === null && r.metricValue !== null && r.metricValue !== undefined) {
          prev.metricValue = r.metricValue;
        }
      }
      continue;
    }
    const rawValue = dim[dimensionKey];
    if (rawValue === undefined) continue;
    const raw: string | number =
      typeof rawValue === "number" || typeof rawValue === "string" ? rawValue : String(rawValue);
    const key = String(raw);
    let agg = byLabel.get(key);
    if (agg === undefined) {
      agg = {
        raw,
        metricValue: null,
        medianReturn: null,
        winRate: null,
        sampleCount: null,
        resultIds: [],
      };
      byLabel.set(key, agg);
    }
    agg.resultIds.push(id);
    const medianCode = analysisType === "DESCRIPTIVE" ? "MEDIAN" : "MEDIAN_RETURN";
    if (r.metricCode === primaryCode) {
      if (r.metricValue !== null && r.metricValue !== undefined) agg.metricValue = r.metricValue;
      if (r.sampleCount !== null && r.sampleCount !== undefined) agg.sampleCount = r.sampleCount;
    } else if (r.metricCode === medianCode) {
      if (r.metricValue !== null && r.metricValue !== undefined) agg.medianReturn = r.metricValue;
    } else if (r.metricCode === "WIN_RATE") {
      if (r.metricValue !== null && r.metricValue !== undefined) agg.winRate = r.metricValue;
    } else if (r.metricCode === "SAMPLE_COUNT") {
      if (r.metricValue !== null && r.metricValue !== undefined) agg.sampleCount = r.metricValue;
    }
  }

  const allAggs = [...byLabel.values()];
  const wholeAggs = allAggs.filter((a) => WHOLE_SAMPLE_LABELS.has(String(a.raw)));
  const bucketAggs = allAggs.filter((a) => !WHOLE_SAMPLE_LABELS.has(String(a.raw)));
  bucketAggs.sort((a, b) => compareRaw(a.raw, b.raw));

  // ---- 3. 区间文字（仅 QUANTILE 可从 cutPoints 还原）----
  const cutPoints = analysisType === "QUANTILE" ? meta["cutPoints"] : undefined;
  const rangeTexts = analysisType === "QUANTILE" ? buildRangeTexts(cutPoints, bucketAggs.length) : [];

  const buckets: OrderedBucket[] = bucketAggs.map((a, i) => {
    const short = analysisType === "QUANTILE" ? `Q${String(a.raw)}` : String(a.raw);
    const rangeText = rangeTexts[i] ?? null;
    return {
      position: i + 1,
      label: rangeText === null ? short : `${short} ${rangeText}`,
      rawLabel: a.raw,
      rangeText,
      metricValue: a.metricValue,
      medianReturn: a.medianReturn,
      winRate: a.winRate,
      sampleCount: a.sampleCount,
      resultIds: [...a.resultIds].sort((x, y) => x - y),
    };
  });

  const whole = wholeAggs.length > 0 ? wholeAggs.reduce((best, cur) => (cur.resultIds.length > best.resultIds.length ? cur : best)) : null;
  const benchmark: SeriesBenchmark | null =
    whole === null
      ? null
      : {
          label: String(whole.raw),
          metricValue: whole.metricValue,
          sampleCount: whole.sampleCount,
          resultIds: [...whole.resultIds].sort((x, y) => x - y),
        };

  return {
    analysisId,
    analysisType,
    target,
    dimensionKey: dimensionKey ?? "(none)",
    buckets,
    benchmark,
    scalars,
    meta,
    allResultIds: results.map((r) => r.id).filter((x): x is number => x !== undefined).sort((x, y) => x - y),
    assessable: isAssessableType(analysisType),
  };
}
