/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007` TASK B —— 行情读取优化的**等价性**契约。
 *
 * ## 为什么必须有这个文件
 *
 * TASK B 改的是**读法**（相对日分批 + 有界并发）而不是**研究口径**，因此验收判据只能是
 * 「同输入 ⇒ 同样结果，且查询次数真的少了」。本文件用**同一份数据、同一个读取层替身**
 * 把「旧逐日读法」与「新分批读法」逐日逐行对照，并锁住查询次数与统计字段：
 *
 *   1. **逐日行等价**（含**行序**）：分批读回来的每一天，与逐日读回来的那一天深度相等；
 *   2. **查询次数真的下降**：分批后 `loadPostBars` 调用次数 = 片数 × 事件块数；
 *   3. **统计字段不变**：`postRowCount` / `prefixRowCount` / `maxPostRelativeDayRead` 一致；
 *   4. **端口缺省 = 旧形状**：不传分片参数时逐查询形状与旧实现**逐字相同**
 *      （避免「公共件缺省静默改形状」波及几十个既有调用方）；
 *   5. **封执行数据集**：`sealRollingPoolExecutionDataset` 的「单次日期索引」与旧
 *      `rows.filter(...)` 表达式**逐项相同**，且封出的 `datasetVersion` 与输入行序无关。
 *
 * ⚠️ 纯合成 fixture：不连 DB、不跑 Run、不产出收益矩阵。
 */

import { describe, expect, it } from "vitest";
import type { ExperimentDescriptor } from "@shared/researchExperimentsContracts";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import {
  sealRollingPoolExecutionDataset,
  type RollingPoolExecutionRowInput,
} from "../../../server/researchExperiments/rollingPoolExecutionSupport";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 990_007;

const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 120_007,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩（分批读等价性）",
  versionLabel: "v-batch-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-06-30",
  totalEvents: 3,
  horizons: [5],
  pathRelativeDayRange: { min: 1, max: 3 },
  postRelativeDayRange: { min: 1, max: 3 },
  decisionOffsetDays: null,
};

function event(eventId: string, tradeDate: string, symbol: string): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol,
    tradeDate,
    market: "SH",
    industryCode: "INDUSTRY_A",
    boardType: "main",
    previousClose: 10,
    limitUpPrice: 11,
    turnover: 3.2,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 1,
    marketCap: 1_000_000,
    floatMarketCap: 800_000,
  };
}

function bar(
  eventId: string,
  relativeDay: number,
  tradeDate: string,
  close: number,
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate,
    relativeDay,
    open: close - 0.1,
    high: close + 0.2,
    low: close - 0.3,
    close,
    preClose: close - 0.05,
    volume: 1000 + relativeDay,
    amount: 10_500,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
    canBuyAtOpen: true,
    canSellAtClose: true,
  };
}

const EVENTS: readonly FirstLimitPullbackEvent[] = [
  event("e1@2025-01-02", "2025-01-02", "600001.SH"),
  event("e2@2025-01-03", "2025-01-03", "600002.SH"),
  event("e3@2025-01-06", "2025-01-06", "600003.SH"),
];

/** 🔴 刻意**按「相对日交错」**排列：分批读若把行序弄乱，下面的逐日深度相等会当场变红。 */
const POST_BARS: readonly FirstLimitPullbackRawBar[] = [
  bar("e1@2025-01-02", 1, "2025-01-03", 11),
  bar("e2@2025-01-03", 1, "2025-01-06", 21),
  bar("e3@2025-01-06", 1, "2025-01-07", 31),
  bar("e1@2025-01-02", 2, "2025-01-06", 12),
  bar("e2@2025-01-03", 2, "2025-01-07", 22),
  bar("e3@2025-01-06", 2, "2025-01-08", 32),
  bar("e1@2025-01-02", 3, "2025-01-07", 13),
  bar("e2@2025-01-03", 3, "2025-01-08", 23),
  bar("e3@2025-01-06", 3, "2025-01-09", 33),
];

const PREFIX_BARS: readonly FirstLimitPullbackRawBar[] = [
  bar("e1@2025-01-02", -1, "2025-01-01", 9.1),
  bar("e2@2025-01-03", -1, "2025-01-02", 9.2),
  bar("e3@2025-01-06", -1, "2025-01-03", 9.3),
  bar("e1@2025-01-02", 0, "2025-01-02", 10),
  bar("e2@2025-01-03", 0, "2025-01-03", 20),
  bar("e3@2025-01-06", 0, "2025-01-06", 30),
];

function descriptorWith(): ExperimentDescriptor {
  return {
    id: "test/day-batching-equivalence",
    name: "分批读等价性",
    version: "1.0.0",
    description: "TASK B 等价性契约",
    source: "test",
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: {
        events: ["isFirstLimit", "boardType", "market"],
        feature: ["close"],
        observation: ["close"],
      },
      prefixRelativeDays: [-1, 0],
      postRelativeDays: [1, 2, 3],
      decisionOffsetDays: 3,
      usesForwardData: true,
      forwardDataPurpose: "分批读等价性测试",
    },
    pageKey: "test/day-batching-equivalence",
    pageTitle: "分批读等价性",
  };
}

interface ReadResult {
  /** 相对日 → 该日的行（`JSON` 化后的稳定形状，便于深度比较）。 */
  readonly byDay: Record<string, unknown>;
  readonly prefixByDay: Record<string, unknown>;
  readonly postCalls: number;
  readonly prefixCalls: number;
  readonly postRowCount: number;
  readonly prefixRowCount: number;
  readonly maxPostRelativeDayRead: number | null;
  readonly barQueryCount: number;
}

/**
 * 用给定的分片/并发参数读**同一批**相对日，返回逐日结果与调用计数。
 *
 * `eventPageSize: 2` 让事件扫描也分页；`chunkSize: 1` 让「事件块数」= 事件数
 * ⇒ 查询次数的差异只可能来自**相对日分批**，不来自事件分块。
 */
async function readAll(options: {
  readonly barDayBatchSize?: number;
  readonly barReadConcurrency?: number;
}): Promise<ReadResult> {
  const reader = new InMemoryResearchDatasetReader({
    context,
    events: EVENTS,
    prefixBars: PREFIX_BARS,
    postBars: POST_BARS,
  });
  const port = createRegistryExperimentDatasetPort({
    reader,
    eventPageSize: 2,
    barBatchSize: 1,
    ...(options.barDayBatchSize !== undefined ? { barDayBatchSize: options.barDayBatchSize } : {}),
    ...(options.barReadConcurrency !== undefined ? { barReadConcurrency: options.barReadConcurrency } : {}),
  });
  const facts = (await port.getVersionFacts(VERSION_ID))!;
  const { access, stats, freezeSelection } = port.createAccess({
    descriptor: descriptorWith(),
    facts,
  });
  await access.events();
  freezeSelection(EVENTS.map((item) => item.eventId));

  const prefixByDay: Record<string, unknown> = {};
  for (const relativeDay of [-1, 0]) {
    // 同一天**读两次**：缓存必须让第二次不再发查询（惰性缓存契约不因分批而失效）。
    await access.feature(relativeDay);
    prefixByDay[String(relativeDay)] = await access.feature(relativeDay);
  }
  const postByDay: Record<string, unknown> = {};
  for (const relativeDay of [1, 2, 3]) {
    await access.observation(relativeDay);
    postByDay[String(relativeDay)] = await access.observation(relativeDay);
  }

  return {
    byDay: postByDay,
    prefixByDay,
    postCalls: reader.callLog.filter((call) => call.method === "loadPostBars").length,
    prefixCalls: reader.callLog.filter((call) => call.method === "loadPrefixBars").length,
    postRowCount: stats.postRowCount,
    prefixRowCount: stats.prefixRowCount,
    maxPostRelativeDayRead: stats.maxPostRelativeDayRead,
    barQueryCount: stats.barQueryCount,
  };
}

describe("TASK B · 相对日分批读的等价性（同一数据面：旧逐日 vs 新分批）", () => {
  it("① 逐日行**逐行相同**（分批 vs 逐日），且 ② 查询次数真的下降", async () => {
    const legacy = await readAll({ barDayBatchSize: 1, barReadConcurrency: 1 });
    const batched = await readAll({ barDayBatchSize: 3, barReadConcurrency: 3 });

    // ① 逐日行等价：内容 + 行序都必须一致（比较的是同一个 in-memory 读取层返回的行）。
    expect(batched.byDay).toEqual(legacy.byDay);
    expect(batched.prefixByDay).toEqual(legacy.prefixByDay);
    // 每天都真的有行（否则「等价」是空集上的假等价）。
    for (const relativeDay of ["1", "2", "3"]) {
      expect((batched.byDay[relativeDay] as unknown[]).length).toBe(EVENTS.length);
    }

    // ② 查询次数：旧 = 3 相对日 × 3 事件块（chunkSize=1）= 9；新 = 1 片 × 3 块 = 3。
    expect(legacy.postCalls).toBe(9);
    expect(batched.postCalls).toBe(3);
    expect(batched.postCalls).toBeLessThan(legacy.postCalls);
    // prefix 同理：旧 2 日 × 3 块 = 6；新 1 片 × 3 块 = 3。
    expect(legacy.prefixCalls).toBe(6);
    expect(batched.prefixCalls).toBe(3);

    // ③ 统计字段不变（读取行数、最大相对日、行情查询总数）。
    expect(batched.postRowCount).toBe(legacy.postRowCount);
    expect(batched.prefixRowCount).toBe(legacy.prefixRowCount);
    expect(batched.maxPostRelativeDayRead).toBe(legacy.maxPostRelativeDayRead);
    expect(batched.maxPostRelativeDayRead).toBe(3);
    expect(batched.barQueryCount).toBe(3 + 3);
    expect(legacy.barQueryCount).toBe(9 + 6);
  });

  it("③ 端口**缺省**（不传分片参数）= 旧逐日形状，不静默改变公共件的查询形状", async () => {
    const defaults = await readAll({});
    const legacy = await readAll({ barDayBatchSize: 1, barReadConcurrency: 1 });
    expect(defaults.postCalls).toBe(legacy.postCalls);
    expect(defaults.prefixCalls).toBe(legacy.prefixCalls);
    expect(defaults.byDay).toEqual(legacy.byDay);
    expect(defaults.prefixByDay).toEqual(legacy.prefixByDay);
  });

  it("④ 大并发 + 多事件块下逐日行序仍确定（并发只改发出顺序，不改结果顺序）", async () => {
    const serial = await readAll({ barDayBatchSize: 3, barReadConcurrency: 1 });
    const concurrent = await readAll({ barDayBatchSize: 3, barReadConcurrency: 8 });
    expect(concurrent.byDay).toEqual(serial.byDay);
    expect(concurrent.prefixByDay).toEqual(serial.prefixByDay);
    expect(concurrent.postCalls).toBe(serial.postCalls);
  });
});

// ---------------------------------------------------------------------------
// 封执行数据集：单次日期索引 ≡ 旧 `rows.filter(...)`
// ---------------------------------------------------------------------------

function executionRow(date: string, securityId: string): RollingPoolExecutionRowInput {
  return {
    tradeDate: date,
    securityId,
    code: "600000.SH",
    exchange: "SH",
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    preClose: 10,
    volume: 1000,
    amount: 10_500,
    barPresent: true,
    suspended: false,
  };
}

const SEAL_ROWS: readonly RollingPoolExecutionRowInput[] = [
  executionRow("2024-03-01", "sec_b"),
  executionRow("2024-03-01", "sec_a"),
  executionRow("2024-03-04", "sec_a"),
];

function seal(rows: readonly RollingPoolExecutionRowInput[]) {
  return sealRollingPoolExecutionDataset({
    name: "task-b-date-index-test",
    startDate: "2024-03-01",
    endDate: "2024-03-05",
    datasetVersionId: 780_004,
    rows,
    // 刻意含一个**没有任何行**的交易日：索引缺键时必须与 `filter` 一样给出空成员。
    tradingDates: ["2024-03-01", "2024-03-04", "2024-03-05"],
  });
}

describe("TASK B · 封执行数据集：单次日期索引 ≡ 旧逐日 filter", () => {
  it("每一天的 `members` 与旧 `rows.filter(...)` 表达式**逐项相同**（含空日）", () => {
    const sealed = seal(SEAL_ROWS);
    expect(sealed.universeDefinition.days.map((day) => day.tradeDate))
      .toEqual(["2024-03-01", "2024-03-04", "2024-03-05"]);

    // 参考实现 = 被替换掉的旧表达式（作用在同一份**已排序去重**的 `sealed.rows` 上）。
    for (const day of sealed.universeDefinition.days) {
      const reference = sealed.rows
        .filter((row) => row.tradeDate === day.tradeDate)
        .map((row) => row.securityId);
      expect(day.members, `日期 ${day.tradeDate} 的成员必须与旧 filter 逐项相同`).toEqual(reference);
    }
    expect(sealed.universeDefinition.days[0]!.members).toEqual(["sec_a", "sec_b"]);
    expect(sealed.universeDefinition.days[2]!.members).toEqual([]);
    // 行数与覆盖日数仍按真实行统计（空日不算「有行」）。
    expect(sealed.rows).toHaveLength(3);
    expect(sealed.dataSnapshot.domains[0]!.rowsLoaded).toBe(3);
    expect(sealed.dataSnapshot.domains[0]!.datesCovered).toBe(2);
    expect(sealed.dataSnapshot.domains[0]!.datesExpected).toBe(3);
  });

  it("内容寻址版本与输入行序无关（索引化不引入顺序依赖）", () => {
    const forward = seal(SEAL_ROWS);
    const shuffled = seal([SEAL_ROWS[2]!, SEAL_ROWS[0]!, SEAL_ROWS[1]!]);
    expect(shuffled.datasetVersion).toBe(forward.datasetVersion);
    expect(shuffled.universeDefinition.days).toEqual(forward.universeDefinition.days);
    expect(shuffled.universeDefinition.days.map((day) => day.members))
      .toEqual(forward.universeDefinition.days.map((day) => day.members));
  });
});
