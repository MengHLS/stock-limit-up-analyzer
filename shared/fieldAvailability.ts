/**
 * 历史字段可用性识别（缺失字段的降级依据）。
 *
 * ── 业务背景（实测，2026-09-11 真实库统计）────────────────────────────────
 *   · 2025-11 之前：limit_up_records 共 84,696 行，其中 83,900 行同时缺 sector 与
 *     keywords，2025-06 ~ 2025-09 近乎 100% 缺 limitUpTime / sector / keywords；
 *   · 2025-11 及之后：sector / keywords 缺失 0~1 行，limitUpTime 无缺失。
 * 也就是说「缺字段」不是零星异常，而是**整段历史期未采集**。
 *
 * 旧口径把缺失 sector 交给 normalizeSectorName 兜底成同一个「其他」题材，于是一整天
 * 的缺失记录被聚合成一个几百只的巨型题材：
 *   · 虚增「题材共振」得分（每只都拿到题材分上限）；
 *   · 让「题材支撑不足」的风险扣分永远不触发 —— 缺失被伪装成「题材极强」。
 *
 * ── 本模块的职责 ────────────────────────────────────────────────────────────
 * 只回答「某字段在某信号日是否整体可用」，不做任何静默填补：
 *   · 覆盖率 ≥ readyRatio → 字段可用：个别缺失按「个股异常」处理，沿用原口径扣分；
 *   · 覆盖率 <  readyRatio → 字段整体未采集：缺失按「不可用」处理，不计入风险扣分，
 *                            相关衍生特征改用同日横截面中性值或整体停用。
 *
 * 关键不变量：**缺失不得被当作风险证据，也不得被当作强度证据**。
 */

import { normalizeSectorName } from "./stockDataNormalization";

/** 回测需要识别的可缺失字段。 */
export type FieldCoverageField = "limitUpTime" | "sector" | "keywords";

/** 字段可用性输入（只取识别所需的列）。 */
export type FieldAvailabilityRecord = {
  limitUpDate: string;
  limitUpTime?: string | null;
  sector?: string | null;
  keywords?: string | null;
};

/** 覆盖率达标阈值：达到即视为「该字段整体已采集」。 */
export const FIELD_COVERAGE_READY_RATIO = 0.6;

/** 字段可读标签（用于前端与原因文案）。 */
export const FIELD_COVERAGE_LABELS: Record<FieldCoverageField, string> = {
  limitUpTime: "涨停时间",
  sector: "所属板块",
  keywords: "涨停关键词",
};

/** 字段值是否存在（去空格后非空才算有值）。 */
export function hasFieldValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** 覆盖率是否达标；样本为 0 时视为「无降级证据」。 */
export function isFieldCoverageReady(present: number, total: number, readyRatio = FIELD_COVERAGE_READY_RATIO): boolean {
  if (total <= 0) return true;
  return present / total >= readyRatio;
}

/** 单个信号日的字段覆盖情况。 */
export type FieldCoverageCounts = {
  date: string;
  totalRecords: number;
  limitUpTimeCount: number;
  sectorCount: number;
  keywordsCount: number;
  limitUpTimeRatio: number;
  sectorRatio: number;
  keywordsRatio: number;
  /** 该字段是否整体可用（false = 该日历史数据未采集，缺失需降级）。 */
  limitUpTimeAvailable: boolean;
  sectorAvailable: boolean;
  keywordsAvailable: boolean;
};

const ratioOf = (present: number, total: number): number => (total <= 0 ? 1 : Number((present / total).toFixed(4)));

/** 计算某一信号日的字段覆盖情况（只使用该日记录，PIT 安全）。 */
export function buildFieldCoverage(
  records: ReadonlyArray<Pick<FieldAvailabilityRecord, "limitUpTime" | "sector" | "keywords">>,
  date: string,
  readyRatio = FIELD_COVERAGE_READY_RATIO,
): FieldCoverageCounts {
  const totalRecords = records.length;
  const limitUpTimeCount = records.filter((record) => hasFieldValue(record.limitUpTime)).length;
  const sectorCount = records.filter((record) => hasFieldValue(record.sector)).length;
  const keywordsCount = records.filter((record) => hasFieldValue(record.keywords)).length;
  return {
    date,
    totalRecords,
    limitUpTimeCount,
    sectorCount,
    keywordsCount,
    limitUpTimeRatio: ratioOf(limitUpTimeCount, totalRecords),
    sectorRatio: ratioOf(sectorCount, totalRecords),
    keywordsRatio: ratioOf(keywordsCount, totalRecords),
    limitUpTimeAvailable: isFieldCoverageReady(limitUpTimeCount, totalRecords, readyRatio),
    sectorAvailable: isFieldCoverageReady(sectorCount, totalRecords, readyRatio),
    keywordsAvailable: isFieldCoverageReady(keywordsCount, totalRecords, readyRatio),
  };
}

/** 逐信号日的字段覆盖表。 */
export function buildFieldCoverageByDate(
  records: ReadonlyArray<FieldAvailabilityRecord>,
  readyRatio = FIELD_COVERAGE_READY_RATIO,
): Map<string, FieldCoverageCounts> {
  const byDate = new Map<string, Array<Pick<FieldAvailabilityRecord, "limitUpTime" | "sector" | "keywords">>>();
  for (const record of records) {
    const bucket = byDate.get(record.limitUpDate);
    if (bucket) bucket.push(record);
    else byDate.set(record.limitUpDate, [record]);
  }
  const coverage = new Map<string, FieldCoverageCounts>();
  for (const [date, bucket] of Array.from(byDate)) {
    coverage.set(date, buildFieldCoverage(bucket, date, readyRatio));
  }
  return coverage;
}

/** 按月聚合的覆盖情况（用于前端「数据覆盖」提示）。 */
export type FieldCoverageBucket = {
  bucket: string;
  totalRecords: number;
  limitUpTimeRatio: number;
  sectorRatio: number;
  keywordsRatio: number;
  degradedFields: FieldCoverageField[];
};

/** 回测数据覆盖报告。 */
export type FieldCoverageReport = {
  definition: string;
  readyRatio: number;
  startDate: string | null;
  endDate: string | null;
  totalRecords: number;
  limitUpTimeRatio: number;
  sectorRatio: number;
  keywordsRatio: number;
  /** 整体覆盖率低于阈值、需要在回测中降级处理的字段。 */
  degradedFields: FieldCoverageField[];
  /** 存在降级字段的月份（升序）。 */
  degradedMonths: string[];
  /** 逐月覆盖明细（只保留存在降级字段的月份，避免展示噪声）。 */
  degradedBuckets: FieldCoverageBucket[];
  /** 降级处理说明（写入 API 结果，便于审计与前端展示）。 */
  degradationNotes: string[];
};

function degradedFieldsOf(ratios: Record<FieldCoverageField, number>, readyRatio: number): FieldCoverageField[] {
  return (Object.keys(FIELD_COVERAGE_LABELS) as FieldCoverageField[])
    .filter((field) => ratios[field] < readyRatio)
    .sort();
}

/**
 * 构建回测数据覆盖报告（展示 / 审计用；不参与任何评分与排序）。
 * 注意：本函数按「回测区间内全部记录」聚合，只用于说明历史缺失分布，
 * 具体某日的降级判定必须以 buildFieldCoverageByDate 的逐日结果为准。
 */
export function buildFieldCoverageReport(
  records: ReadonlyArray<FieldAvailabilityRecord>,
  readyRatio = FIELD_COVERAGE_READY_RATIO,
): FieldCoverageReport {
  const totalRecords = records.length;
  const limitUpTimeCount = records.filter((record) => hasFieldValue(record.limitUpTime)).length;
  const sectorCount = records.filter((record) => hasFieldValue(record.sector)).length;
  const keywordsCount = records.filter((record) => hasFieldValue(record.keywords)).length;
  const ratios: Record<FieldCoverageField, number> = {
    limitUpTime: ratioOf(limitUpTimeCount, totalRecords),
    sector: ratioOf(sectorCount, totalRecords),
    keywords: ratioOf(keywordsCount, totalRecords),
  };
  const dates = records.map((record) => record.limitUpDate).filter((date) => hasFieldValue(date)).sort();

  const bucketCounts = new Map<string, { total: number; limitUpTime: number; sector: number; keywords: number }>();
  for (const record of records) {
    const bucket = record.limitUpDate.slice(0, 7);
    const current = bucketCounts.get(bucket) ?? { total: 0, limitUpTime: 0, sector: 0, keywords: 0 };
    current.total += 1;
    if (hasFieldValue(record.limitUpTime)) current.limitUpTime += 1;
    if (hasFieldValue(record.sector)) current.sector += 1;
    if (hasFieldValue(record.keywords)) current.keywords += 1;
    bucketCounts.set(bucket, current);
  }
  const degradedBuckets: FieldCoverageBucket[] = Array.from(bucketCounts.entries())
    .map(([bucket, counts]) => {
      const bucketRatios: Record<FieldCoverageField, number> = {
        limitUpTime: ratioOf(counts.limitUpTime, counts.total),
        sector: ratioOf(counts.sector, counts.total),
        keywords: ratioOf(counts.keywords, counts.total),
      };
      return {
        bucket,
        totalRecords: counts.total,
        limitUpTimeRatio: bucketRatios.limitUpTime,
        sectorRatio: bucketRatios.sector,
        keywordsRatio: bucketRatios.keywords,
        degradedFields: degradedFieldsOf(bucketRatios, readyRatio),
      };
    })
    .filter((bucket) => bucket.degradedFields.length > 0)
    .sort((left, right) => left.bucket.localeCompare(right.bucket));

  const degradedFields = degradedFieldsOf(ratios, readyRatio);
  const degradationNotes: string[] = [];
  if (degradedFields.includes("sector")) {
    degradationNotes.push("所属板块整体缺失的交易日：缺失记录不再聚合为同一个兜底题材，题材家数改用同日已采集题材的中位数中性值，且「题材支撑不足」不再作为风险证据。");
  }
  if (degradedFields.includes("limitUpTime")) {
    degradationNotes.push("涨停时间整体缺失的交易日：封板时间得分维持保守兜底值，「封板偏晚」不再作为风险证据，早封奖励不触发。");
  }
  if (degradedFields.includes("keywords")) {
    degradationNotes.push("涨停关键词整体缺失的交易日：关键词仅用于缺失识别与展示，不参与评分，故不产生额外降级。");
  }

  return {
    definition: "按回测区间统计涨停记录中「涨停时间 / 所属板块 / 涨停关键词」的采集覆盖率；覆盖率低于阈值的字段在该交易日整体降级处理，避免把「未采集」误当作风险或强度证据。",
    readyRatio,
    startDate: dates[0] ?? null,
    endDate: dates[dates.length - 1] ?? null,
    totalRecords,
    limitUpTimeRatio: ratios.limitUpTime,
    sectorRatio: ratios.sector,
    keywordsRatio: ratios.keywords,
    degradedFields,
    degradedMonths: degradedBuckets.map((bucket) => bucket.bucket),
    degradedBuckets,
    degradationNotes,
  };
}

/**
 * 题材字段的降级解析：优先 sector；sector 缺失时用 keywords 的首个主题词兜底。
 *
 * 说明：在本库当前数据上，sector 缺失必然伴随 keywords 缺失（实测 0 例外），
 * 因此该兜底不改变现状；它的作用是覆盖「局部缺列」场景（如某月只补了 keywords），
 * 并防止未来数据源缺列时整段退回「全部并入同一兜底题材」的旧口径。
 */
export type ThemeResolution = {
  /** 可用于聚合的题材名；null 表示确实无法解析。 */
  theme: string | null;
  source: "sector" | "keywords" | "missing";
};

const KEYWORD_SPLIT = /[+＋/、,，;；|]+/;

export function resolveThemeWithFallback(
  record: Pick<FieldAvailabilityRecord, "sector" | "keywords">,
): ThemeResolution {
  if (hasFieldValue(record.sector)) {
    // 复用既有题材归一化（去除 OCR 附带的「*N」计数后缀），保证与旧口径同一命名空间。
    return { theme: normalizeSectorName(record.sector), source: "sector" };
  }
  if (hasFieldValue(record.keywords)) {
    const firstToken = (record.keywords as string)
      .split(KEYWORD_SPLIT)
      .map((token) => normalizeSectorName(token))
      .find((token) => token.length > 0 && token !== "其他");
    if (firstToken) return { theme: firstToken, source: "keywords" };
  }
  return { theme: null, source: "missing" };
}
