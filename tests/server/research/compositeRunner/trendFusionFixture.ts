/**
 * P0 趋势融合的**共享测试夹具**（组合层排序融合 + provider 并集装载两处测试共用）。
 *
 * 设计目标：构造一个**融合会改变选中集合**的最小组合数据集 —— 否则
 * 「融合臂选中了控制臂没选中的事件」这条公平性场景根本无法被测试覆盖。
 *
 * 四条候选的振幅相同（high/low 对称 ±0.5%）⇒ 3F 排序完全由 t1VolumeRatio 决定：
 *   - sec-a-high3f：3F 最高（量比 3 ⇒ 最高桶），趋势最弱（连续阴跌）；
 *   - sec-b-4th：3F 第四，趋势中等；
 *   - sec-c-mid：3F 第三，趋势强；
 *   - sec-d-low3f：3F 最低（量比 0.3 ⇒ 最低桶），趋势最强（创新高）。
 * ⇒ 纯 3F 的 Top3 = [a, b, c]；50% 融合 = [d, c, b]（a 被挤出、d 被选入）。
 */
import {
  buildCompositeEvents,
  buildCompositeSourceRun,
  COMPOSITE_RUNNER_MAX_AMPLITUDE,
} from "../../../../server/research/compositeRunner/index";
import type {
  ResearchDataset,
  ResearchDatasetRow,
} from "../../../../server/researchDataset/types";

export const TRADING_DAYS: readonly string[] = [
  "2026-03-02",
  "2026-03-03",
  "2026-03-04",
  "2026-03-05",
  "2026-03-06",
  "2026-03-07",
  "2026-03-08",
  "2026-03-09",
  "2026-03-10",
];

/** 决策日 = rd 5（3F 首次可算日）。 */
export const DECISION_DAY = TRADING_DAYS[5]!;
export const EVENT_DAY = TRADING_DAYS[0]!;
const EVENT_DATE = "2026-03-02";
export const LAST_TRADING_DAY = TRADING_DAYS[TRADING_DAYS.length - 1]!;

export interface CandidateSpec {
  readonly key: string;
  /** 事件日 → 决策日的 6 个收盘价（rd 0..5）。 */
  readonly closes: readonly number[];
  /** T+1 成交量 / T 日成交量（决定 3F 的 t1VolumeRatio 桶位）。 */
  readonly t1VolumeRatio: number;
}

export const TREND_FUSION_CANDIDATES: readonly CandidateSpec[] = [
  { key: "sec-a-high3f", closes: [10, 9.8, 9.6, 9.5, 9.4, 9.3], t1VolumeRatio: 3 },
  { key: "sec-b-4th", closes: [10, 9.9, 9.9, 9.9, 9.9, 9.9], t1VolumeRatio: 1.5 },
  { key: "sec-c-mid", closes: [10, 9.7, 9.8, 9.9, 10.0, 10.1], t1VolumeRatio: 1 },
  { key: "sec-d-low3f", closes: [10, 9.6, 9.7, 9.9, 10.2, 10.5], t1VolumeRatio: 0.3 },
];

/**
 * 每个候选一个**独立代码**：provider 会用 `eventId`（= `代码@事件日`）去读扩展行，
 * 若四条候选共用同一代码，事件 id 会退化成同一个，并集断言就失去意义。
 */
const CODE_BY_KEY: Readonly<Record<string, string>> = {
  "sec-a-high3f": "000001.SZ",
  "sec-b-4th": "000002.SZ",
  "sec-c-mid": "000003.SZ",
  "sec-d-low3f": "000004.SZ",
};

export function codeOf(key: string): string {
  const code = CODE_BY_KEY[key];
  if (code === undefined) throw new Error(`夹具没有登记 ${key} 的代码`);
  return code;
}

export function securityIdOf(key: string): string {
  return `${key}::event:${codeOf(key)}@${EVENT_DATE}`;
}

/** 与 provider 内部同构的事件 id 提取（供并集断言复用）。 */
export function eventIdOfSecurityId(securityId: string): string {
  const marker = "::event:";
  const index = securityId.indexOf(marker);
  return index < 0 ? securityId : securityId.slice(index + marker.length);
}

export function rowOf(
  securityId: string,
  tradeDate: string,
  close: number,
  volume: number,
): ResearchDatasetRow {
  const half = close * 0.005;
  return {
    tradeDate,
    asOf: tradeDate,
    securityId,
    code: securityId.split("::event:")[1]!.split("@")[0]!,
    securityType: "STOCK",
    exchange: "SZ",
    lifecycleVerdict: "LISTED",
    eligible: true,
    exclusionReason: null,
    st: "NORMAL",
    industryCode: null,
    industryName: null,
    turnoverRate: null,
    circulationMarketCap: null,
    totalMarketCap: null,
    liquidityAmount: null,
    liquidityVolume: null,
    open: close,
    high: close + half,
    low: close - half,
    close,
    preClose: close,
    volume,
    amount: close * volume,
    corporateActionsEffectiveCount: 0,
    corporateActionsKnownCount: 0,
    indexClose: {},
    knowledge: {
      policy: "PIT",
      listing: "KNOWN",
      delisting: "KNOWN",
      tradability: "KNOWN",
      industry: "UNKNOWN",
      liquidity: "UNKNOWN",
      price: "KNOWN",
      corporateActions: "UNKNOWN",
      marketState: "UNKNOWN",
    },
  };
}

/** tailMultiplier 只改 rd >= 6 的行（PIT 反例用）。 */
export function buildTrendFusionDataset(tailMultiplier = 1): ResearchDataset {
  const rows: ResearchDatasetRow[] = [];
  for (const spec of TREND_FUSION_CANDIDATES) {
    const securityId = securityIdOf(spec.key);
    for (let relativeDay = 0; relativeDay <= 5; relativeDay += 1) {
      const close = spec.closes[relativeDay]!;
      const volume = relativeDay === 1 ? 1_000_000 * spec.t1VolumeRatio : 1_000_000;
      rows.push(rowOf(securityId, TRADING_DAYS[relativeDay]!, close, volume));
    }
    for (let index = 0; index < 3; index += 1) {
      const relativeDay = 6 + index;
      rows.push(
        rowOf(
          securityId,
          TRADING_DAYS[relativeDay]!,
          spec.closes[5]! * tailMultiplier,
          1_000_000,
        ),
      );
    }
  }
  return {
    datasetVersion: "test-composite-trend-fusion-1.0.0",
    universeDefinition: {
      rule: "test-universe",
      asOfDescription: "PIT per trade date",
      days: TRADING_DAYS.map((tradeDate) => ({
        tradeDate,
        isTradingDay: true,
        members: [],
        excludedByReason: {},
      })),
    },
    policySet: [],
    dataSnapshot: {
      capturedAt: "2026-03-10T00:00:00.000Z",
      request: {
        name: "test-composite-trend-fusion",
        startDate: EVENT_DAY,
        endDate: LAST_TRADING_DAY,
        asOfPerTradeDate: true,
        asOf: null,
        coreIndexCodes: [],
        universeFilter: {
          boards: [],
          excludeSt: false,
          tDayCondition: "none",
          pullback: null,
        },
      },
      calendarName: "test",
      calendarFirstDate: EVENT_DAY,
      calendarLastDate: LAST_TRADING_DAY,
      tradingDays: TRADING_DAYS.length,
      domains: [],
      coverageGaps: [],
    },
    rows,
    gate: "PASS",
    gateNotes: [],
  };
}

export function buildTrendFusionArm(
  dataset: ResearchDataset,
  rankFusion: { readonly trendWeight: number } | null | undefined,
  topN = 3,
) {
  const built = buildCompositeEvents(dataset, COMPOSITE_RUNNER_MAX_AMPLITUDE);
  return buildCompositeSourceRun({
    armId: "test-arm",
    label: "test arm",
    kind: "bucket_t5",
    dataset,
    tradingDays: built.tradingDays,
    bucketCandidatesByDate: built.bucketCandidatesByDate,
    rankCandidatesByTe: built.rankCandidatesByTe,
    topN,
    maxAmplitude: COMPOSITE_RUNNER_MAX_AMPLITUDE,
    dateRange: { startDate: EVENT_DAY, endDate: LAST_TRADING_DAY },
    rankFusion,
  });
}

/** P0-2 门槛臂：排序不变，只把 trendScore < minTrendScore 的候选剔除。 */
export function buildTrendFusionGateArm(
  dataset: ResearchDataset,
  minTrendScore: number,
  topN = 3,
) {
  const built = buildCompositeEvents(dataset, COMPOSITE_RUNNER_MAX_AMPLITUDE);
  return buildCompositeSourceRun({
    armId: "test-gate-arm",
    label: "test gate arm",
    kind: "bucket_t5",
    dataset,
    tradingDays: built.tradingDays,
    bucketCandidatesByDate: built.bucketCandidatesByDate,
    rankCandidatesByTe: built.rankCandidatesByTe,
    topN,
    maxAmplitude: COMPOSITE_RUNNER_MAX_AMPLITUDE,
    dateRange: { startDate: EVENT_DAY, endDate: LAST_TRADING_DAY },
    candidateGate: { minTrendScore },
  });
}

/** 决策日**按排名**的选中候选 key（rank 升序）。 */
export function rankedSelectedKeysOf(
  days: readonly {
    date: string;
    selected: readonly { securityId: string; rank: number }[];
  }[],
): string[] {
  const day = days.find((record) => record.date === DECISION_DAY);
  if (day === undefined) throw new Error(`没有 ${DECISION_DAY} 的候选日记录`);
  return [...day.selected]
    .sort((left, right) => left.rank - right.rank)
    .map((candidate) => candidate.securityId.split("::event:")[0]!);
}

/** 决策日选中的候选 key 集合（与排名无关，用于集合比较）。 */
export function selectedKeysOf(
  days: readonly { date: string; selected: readonly { securityId: string }[] }[],
): string[] {
  const day = days.find((record) => record.date === DECISION_DAY);
  if (day === undefined) throw new Error(`没有 ${DECISION_DAY} 的候选日记录`);
  return [...day.selected]
    .sort((left, right) => left.securityId.localeCompare(right.securityId))
    .map((candidate) => candidate.securityId.split("::event:")[0]!);
}