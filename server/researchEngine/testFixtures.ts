/**
 * RESEARCH-002 — 测试夹具（合成 Dataset）。
 *
 * 原则：合成的是 **Dataset 的输入行**（真实物理表的形状），不是「假的结果」。
 * 因此 Test 中对结果数字的断言，检验的是 Engine / Analysis / Metric 的真实计算，
 * 而不是断言一个预先写好的 mock 返回值。
 */

import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../datasetRegistry/types";
import type { ResearchDatasetVersionContext } from "./types";
import { InMemoryResearchDatasetReader } from "./datasetReader";

export const TEST_DATASET_VERSION_ID = 900001;

/** 每个事件携带的可控特征。 */
export interface SyntheticEventSpec {
  /** 事件序号（0 起）。 */
  index: number;
  turnover: number | null;
  /** T+h 收盘收益（h 由 path 行给出）。 */
  futureReturn: (horizon: number) => number | null;
  /** 可选：覆盖日期（用于跨年 / 分组测试）；缺省由 index 递增生成。 */
  tradeDate?: string;
  boardType?: string | null;
  market?: string | null;
  /** 可选：环境标签（只有在提供 regimeProvider 时才会被读取）。 */
  regime?: string | null;
}

export interface SyntheticDatasetOptions {
  datasetVersionId?: number;
  events: readonly SyntheticEventSpec[];
  /** outcome 视界（真实表 outcome.horizon 的取值集合）。 */
  horizons?: readonly number[];
  /** path.relativeDay 的最大值（1..maxPathDay）。 */
  maxPathDay?: number;
  /** 是否生成 prefix（-20..0）；缺省 true。 */
  withPrefix?: boolean;
}

export interface SyntheticDataset {
  datasetVersionId: number;
  context: ResearchDatasetVersionContext;
  events: FirstLimitPullbackEvent[];
  paths: FirstLimitPullbackPath[];
  outcomes: FirstLimitPullbackOutcome[];
  prefixBars: FirstLimitPullbackRawBar[];
  reader: InMemoryResearchDatasetReader;
}

/** 序号 → 递增日期（不跳周末：这是合成数据，日期只用于分组）。 */
function dateOf(index: number, override?: string): string {
  if (override) return override;
  const d = new Date(Date.UTC(2024, 0, 1));
  d.setUTCDate(d.getUTCDate() + index);
  return d.toISOString().slice(0, 10);
}

/** 构造合成 Dataset（五表齐全，形状与真实物理表一致）。 */
export function buildSyntheticDataset(options: SyntheticDatasetOptions): SyntheticDataset {
  const datasetVersionId = options.datasetVersionId ?? TEST_DATASET_VERSION_ID;
  const horizons = [...(options.horizons ?? [5, 10, 20])].sort((a, b) => a - b);
  const maxPathDay = options.maxPathDay ?? Math.max(...horizons);
  const withPrefix = options.withPrefix ?? true;

  const events: FirstLimitPullbackEvent[] = [];
  const paths: FirstLimitPullbackPath[] = [];
  const outcomes: FirstLimitPullbackOutcome[] = [];
  const prefixBars: FirstLimitPullbackRawBar[] = [];

  for (const spec of options.events) {
    const tradeDate = dateOf(spec.index, spec.tradeDate);
    const symbol = `0000${String(spec.index).padStart(2, "0")}.SZ`;
    const eventId = `${symbol}@${tradeDate}`;
    const close = 10 + spec.index * 0.1;

    events.push({
      datasetVersionId,
      eventId,
      symbol,
      tradeDate,
      market: spec.market === undefined ? "SZ" : spec.market,
      industryCode: null,
      boardType: spec.boardType === undefined ? "main" : spec.boardType,
      previousClose: close - 0.1,
      limitUpPrice: close,
      turnover: spec.turnover,
      isFirstLimit: true,
      previousLimitDate: null,
      daysSincePreviousLimit: 100 + spec.index,
      historicalLimitCount: 1,
      marketCap: null,
      floatMarketCap: null,
    });

    if (withPrefix) {
      for (let rd = -20; rd <= 0; rd += 1) {
        prefixBars.push({
          datasetVersionId,
          eventId,
          symbol,
          tradeDate,
          relativeDay: rd,
          open: close + rd * 0.01,
          high: close + rd * 0.01 + 0.05,
          low: close + rd * 0.01 - 0.05,
          close: close + rd * 0.01,
          volume: 1_000_000 + rd * 1000,
          amount: 10_000_000 + rd * 10_000,
        });
      }
    }

    for (let rd = 1; rd <= maxPathDay; rd += 1) {
      const ret = spec.futureReturn(rd);
      paths.push({
        datasetVersionId,
        eventId,
        symbol,
        tradeDate,
        relativeDay: rd,
        highFromEventClose: ret,
        lowFromEventClose: ret === null ? null : ret - 0.01,
        closeFromEventClose: ret,
        pullbackFromEventHigh: ret === null ? null : ret - 0.02,
        volumeRatio: 1,
        isBreakout: ret === null ? null : ret > 0,
        breakoutPrice: null,
        daysToBreakout: ret !== null && ret > 0 ? rd : null,
      });
    }

    for (const h of horizons) {
      const ret = spec.futureReturn(h);
      outcomes.push({
        datasetVersionId,
        eventId,
        horizon: h,
        maxReturn: ret === null ? null : ret + 0.02,
        minReturn: ret === null ? null : ret - 0.03,
        maxDrawdown: ret === null ? null : ret - 0.05,
        isBreakout: ret === null ? null : ret > 0,
        daysToBreakout: ret !== null && ret > 0 ? h : null,
      });
    }
  }

  const context: ResearchDatasetVersionContext = {
    datasetVersionId,
    datasetId: 800001,
    datasetCode: "synthetic_fixture",
    datasetName: "合成夹具 Dataset",
    versionLabel: "v-test",
    status: "READY",
    startDate: events[0]?.tradeDate ?? null,
    endDate: events[events.length - 1]?.tradeDate ?? null,
    totalEvents: events.length,
    horizons,
    pathRelativeDayRange: events.length === 0 ? null : { min: 1, max: maxPathDay },
  };

  const reader = new InMemoryResearchDatasetReader({ context, events, paths, outcomes, prefixBars });
  return { datasetVersionId, context, events, paths, outcomes, prefixBars, reader };
}

/** 生成 N 个事件：turnover 均匀递增 1..N，future return 随 turnover 线性递增。 */
export function linearEvents(count: number, turnoverFrom = 1, turnoverStep = 1): SyntheticEventSpec[] {
  const specs: SyntheticEventSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const turnover = turnoverFrom + i * turnoverStep;
    specs.push({
      index: i,
      turnover,
      // 与 turnover 同序：turnover 越大，未来收益越高（分位研究的理想可控实验）
      futureReturn: (h) => round((i / count) * 0.1 * (h / 5)),
    });
  }
  return specs;
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
