/**
 * 开盘买入策略的「次日开盘预期」三档分类模型。
 *
 * 思路：t 日涨停封板时间越早，市场对该股次日（t+1）开盘高开的预期越强。
 * 因此不再用全局固定阈值（如旧的一刀切 -2%），而是先按封板时间把样本分档，
 * 每个档位用真实历史 T+1 开盘溢价分布校准出「期望中心(median)/下界(q25)/上界(q75)」，
 * 再用实际 t+1 开盘溢价与该档位的期望区间比较，得到三档：
 *   - exceeds  次日超预期：openPremium >  upper —— 竞价强于按封板时间的应有预期
 *   - meets    次日符合预期：lower ≤ openPremium ≤ upper —— 与预期相符
 *   - misses   次日不及预期：openPremium <  lower —— 弱于预期
 *
 * 决策（回测/纸面交易统一）：超预期 → 买入；符合预期 → 按既有规则买入；
 * 不及预期 → 放弃买入（不占资金、不占仓位）。一字板/近涨停无法成交等既有门控仍生效。
 *
 * 全部数据均为 point-in-time：封板时间与信号日收盘价在 t 日盘后可见，
 * 开盘溢价比较发生在 t+1 开盘，不引用任何未来数据。
 */

export type OpenExpectationBucketKey = "early" | "morning" | "afternoon" | "late" | "unknown";

export type OpenExpectationTier = "exceeds" | "meets" | "misses";

export type OpenExpectationBand = {
  /** 期望中心（%）：档位内历史 T+1 开盘溢价中位数。 */
  center: number;
  /** 区间下界（%）：低于此视为「次日不及预期」。 */
  lower: number;
  /** 区间上界（%）：高于此视为「次日超预期」。 */
  upper: number;
  /** 校准样本数。 */
  calibrationSampleSize?: number;
};

export type OpenExpectationTable = {
  early: OpenExpectationBand;
  morning: OpenExpectationBand;
  afternoon: OpenExpectationBand;
  late: OpenExpectationBand;
  /** 封板时间缺失或无法归档的兜底档位，使用全样本分布。 */
  unknown: OpenExpectationBand;
};

export type OpenExpectationBucketMeta = {
  key: OpenExpectationBucketKey;
  label: string;
  /** 可读区间描述。 */
  rangeLabel: string;
};

/**
 * 默认期望表（%）：期望中心 = 档位内 T+1 开盘溢价中位数，下界/上界 = q25/q75。
 * 注意：以下为【经验初值】——按 A 股打板经验设定的保守占位参数。
 * 真实库校准待执行：`npx tsx calibrate_open_expectation.ts`（见该文件头部说明），
 * 校准后将本表与 client Backtest.tsx 的 OPEN_EXPECTATION_DEFAULT_CONFIG 一并回填。
 * 无论默认值如何，buildLeaderCandidateBacktest 结果都会回显实际使用的档位表，保证可审计。
 */
export const OPEN_EXPECTATION_DEFAULT_TABLE: OpenExpectationTable = {
  early: { center: 3.2, lower: 1.2, upper: 5.4 },
  morning: { center: 1.6, lower: -0.8, upper: 4.2 },
  afternoon: { center: 0.4, lower: -2.2, upper: 3.0 },
  late: { center: -0.2, lower: -2.8, upper: 2.4 },
  unknown: { center: 1.2, lower: -2.0, upper: 4.4 },
};

export const OPEN_EXPECTATION_BUCKETS: OpenExpectationBucketMeta[] = [
  { key: "early", label: "早盘板", rangeLabel: "09:30–10:00" },
  { key: "morning", label: "上午板", rangeLabel: "10:00–11:30" },
  { key: "afternoon", label: "午后板", rangeLabel: "13:00–14:00" },
  { key: "late", label: "尾盘板", rangeLabel: "14:00–15:00" },
  { key: "unknown", label: "封板时间缺失", rangeLabel: "无法归档" },
];

export const OPEN_EXPECTATION_TIER_META: Record<OpenExpectationTier, { label: string; short: string }> = {
  exceeds: { label: "次日超预期", short: "超预期" },
  meets: { label: "次日符合预期", short: "符合预期" },
  misses: { label: "次日不及预期", short: "不及预期" },
};

/** HH:mm:ss → 当日分钟数（09:30:00=570）。无法解析返回 null。 */
export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 把涨停封板时间归入预期分档（<09:30 视为早盘板，>15:00 视为尾盘板，缺失归 unknown）。 */
export function bucketOfLimitUpTime(time: string | null | undefined): OpenExpectationBucketKey {
  const minutes = timeToMinutes(time);
  if (minutes === null) return "unknown";
  if (minutes < 600) return "early";      // < 10:00
  if (minutes < 690) return "morning";    // < 11:30
  if (minutes < 780) return "unknown";    // 午间休市 11:30–13:00 不应出现封板记录
  if (minutes < 840) return "afternoon";  // < 14:00
  return "late";                          // ≥ 14:00（含收盘前）
}

/**
 * 用样本（每项含分档 key 与 T+1 开盘溢价 %）构建期望表。
 * 中心 = 中位数；下界 = q25；上界 = q75；样本不足 minSample 的档位中心仍取中位数，
 * 但区间做保守收窄回退：无足够样本时返回 null（调用方决定回退）。
 */
export function buildOpenExpectationTable(
  samples: Array<{ bucket: OpenExpectationBucketKey; openPremium: number }>,
  options?: { minSample?: number; clampMinWidth?: number },
): OpenExpectationTable {
  const minSample = options?.minSample ?? 30;
  const clampMinWidth = options?.clampMinWidth ?? 1.0;
  const groups = new Map<OpenExpectationBucketKey, number[]>();
  for (const meta of OPEN_EXPECTATION_BUCKETS) groups.set(meta.key, []);
  for (const sample of samples) groups.get(sample.bucket)?.push(sample.openPremium);

  const percentile = (arr: number[], q: number): number => {
    const sorted = [...arr].sort((a, b) => a - b);
    if (sorted.length === 0) return NaN;
    const position = (sorted.length - 1) * q;
    const lo = Math.floor(position);
    const hi = Math.ceil(position);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
  };
  const medianOf = (arr: number[]) => percentile(arr, 0.5);

  const buildBand = (arr: number[]): OpenExpectationBand => {
    const n = arr.length;
    const center = medianOf(arr);
    if (n < minSample || !Number.isFinite(center)) {
      return { center, lower: Number.NaN, upper: Number.NaN, calibrationSampleSize: n };
    }
    let lower = percentile(arr, 0.25);
    let upper = percentile(arr, 0.75);
    if (upper - lower < clampMinWidth) {
      const pad = (clampMinWidth - (upper - lower)) / 2;
      lower -= pad;
      upper += pad;
    }
    return { center: round2(center), lower: round2(lower), upper: round2(upper), calibrationSampleSize: n };
  };

  const buildAll = (all: number[]): OpenExpectationBand => buildBand(all);
  const allPremiums: number[] = samples.map((sample) => sample.openPremium);
  const unknownBand = buildAll(allPremiums);

  const table = {} as OpenExpectationTable;
  for (const meta of OPEN_EXPECTATION_BUCKETS) {
    const arr = groups.get(meta.key) ?? [];
    const band = meta.key === "unknown" ? unknownBand : buildBand(arr);
    // 样本不足的档位用全样本带宽回退（仍保留该档位自身的中位数作为中心，避免档位信息丢失）。
    if (!Number.isFinite(band.lower) || !Number.isFinite(band.upper)) {
      table[meta.key] = {
        center: Number.isFinite(band.center) ? round2(band.center) : Number.isFinite(unknownBand.center) ? unknownBand.center : 0,
        lower: Number.isFinite(band.lower) ? band.lower : Number.isFinite(unknownBand.lower) ? unknownBand.lower : -2,
        upper: Number.isFinite(band.upper) ? band.upper : Number.isFinite(unknownBand.upper) ? unknownBand.upper : 2,
        calibrationSampleSize: band.calibrationSampleSize,
      };
    } else {
      table[meta.key] = band;
    }
  }
  return table;
}

/** 判定一档：openPremium 为 t+1 实际开盘溢价（相对信号日收盘，%）。 */
export function classifyOpenExpectation(
  bucket: OpenExpectationBucketKey,
  openPremium: number,
  table: OpenExpectationTable,
): OpenExpectationTier {
  const band = table[bucket] ?? table.unknown;
  if (!Number.isFinite(band.lower) || !Number.isFinite(band.upper)) return "meets";
  if (openPremium < band.lower) return "misses";
  if (openPremium > band.upper) return "exceeds";
  return "meets";
}

/** 组装跳过原因文案（统一回测与纸面交易输出）。 */
export function formatMissedReason(
  openPremium: number,
  bucket: OpenExpectationBucketKey,
  tier: OpenExpectationTier,
  table: OpenExpectationTable,
): string {
  const band = table[bucket] ?? table.unknown;
  const bucketLabel = OPEN_EXPECTATION_BUCKETS.find((item) => item.key === bucket)?.label ?? "未知档位";
  return `次日不及预期（${bucketLabel}期望下界 ${round2(band.lower)}%，实际开盘溢价 ${round2(openPremium)}%）`;
}

/** 分档汇总：某档位下成交/放弃笔数与已出清订单的收益特征。 */
export type OpenExpectationTierOutcome = {
  tier: OpenExpectationTier;
  tierLabel: string;
  /** 该档位全部候选（含可成交与不可成交）中进入该档的数量。 */
  candidateCount: number;
  /** 放弃买入笔数（misses 为规则放弃；其他档位也可因一字/近涨停等门控跳过）。 */
  skippedCount: number;
  /** 实际买入笔数。 */
  filledCount: number;
  /** 已出清笔数。 */
  completedCount: number;
  /** 已出清订单平均净收益率（%），样本不足为 null。 */
  averageNetReturn: number | null;
  /** 已出清订单胜率（%）。 */
  winRate: number | null;
};

export function summarizeOpenExpectationTiers(
  items: Array<{ tier: OpenExpectationTier; status: "filled" | "skipped"; netReturn: number | null; closed: boolean }>,
): OpenExpectationTierOutcome[] {
  const tiers: OpenExpectationTier[] = ["exceeds", "meets", "misses"];
  return tiers.map((tier) => {
    const group = items.filter((item) => item.tier === tier);
    const filled = group.filter((item) => item.status === "filled");
    const completed = filled.filter((item) => item.closed);
    const returns = completed.map((item) => item.netReturn).filter((value): value is number => value !== null);
    return {
      tier,
      tierLabel: OPEN_EXPECTATION_TIER_META[tier].label,
      candidateCount: group.length,
      skippedCount: group.length - filled.length,
      filledCount: filled.length,
      completedCount: completed.length,
      averageNetReturn: returns.length > 0 ? round2(returns.reduce((sum, value) => sum + value, 0) / returns.length) : null,
      winRate: returns.length > 0 ? round2((returns.filter((value) => value > 0).length / returns.length) * 100) : null,
    };
  });
}

const round2 = (value: number) => Number(value.toFixed(2));
