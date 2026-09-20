/**
 * EXP-001 · 首板后回踩第一性研究 —— 本实验自己的测试（规格 §28 的 16 个面）。
 *
 * | # | 面 | 钉在哪 |
 * | --- | --- | --- |
 * | 1 | ExperimentDefinition 注册 | 清单 + Registry + 页面注册表 |
 * | 2 | Dataset 版本 / 参数校验 | 边界拒 + 版本非 READY / 代码不匹配 / 视界超界 |
 * | 3 | T+1…T+5 相对日期计算 | `byDay[].relativeDay / tradeDate` |
 * | 4 | 首板日**开盘价**基准 | `breakBelowOpen` / `drawdownFromOpen` 必须锚在 rd=0 的 `open` |
 * | 5 | 回踩判定 | `low < firstLimitUpClose` |
 * | 6 | 不破 / 破位判定（**路径条件**） | T+2 破位、T+4 涨回 ⇒ 截至 T+5 仍算破位 |
 * | 7 | 回撤深度计算 | 对收盘价 / 对开盘价两个口径，负数 = 回撤 |
 * | 8 | 分桶 | 边界合法性 + 互不重叠 + 完全覆盖 |
 * | 9 | 后续收益 | `byHorizon` + 突破计数与 `timeToBreakout` |
 * | 10 | `excludedByReason` | 闭集 + 逐项计数 + 账目守恒 |
 * | 11 | PIT 边界 | `usesForwardData` / `decisionOffsetDays` / `maxObservationDay ≤ 5` 结构级闸门 |
 * | 12 | 空数据 | 零事件仍产出结构完整的结果（不崩、不造假） |
 * | 13 | 数据不足 | 缺观察日 ⇒ 剔除；缺远端行情 ⇒ 视界如实为 null |
 * | 14 | Result Envelope | 信封账目 + 表 / 图 / 统计 / 分布 / 比较齐全 |
 * | 15 | Artifact Key | 相对名字合法 + 落在 Run 前缀下 + 非法名字当场拒 |
 * | 16 | Manifest | 产物清单 7 项、名字唯一、与信封表同名同源 |
 *
 * 🔴 本文件**不依赖**真实 MinIO 凭据（规格 §28）：对象存储只做**纯字符串**校验；
 *    真实 MinIO 只用于 E2E 脚本。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ExperimentDefinition,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";
import {
  assertSafeRelativeName,
  chartObjectKey,
  isObjectKeyUnderRun,
  tableObjectKey,
} from "../../../server/artifactStorage/objectKey";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentError } from "../../../server/researchExperiments/errors";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import type { FirstLimitPullbackEvent, FirstLimitPullbackRawBar } from "../../../server/datasetRegistry/types";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import { EXPERIMENT_PAGES, experimentPageOf } from "../../../client/src/researchExperiments/pages";
import {
  EXCLUSION_REASON_LABELS,
  fundamentalStudyExperiment,
} from "../../../research-experiments/first-board-pullback/fundamental-study/experiment";
import {
  COMPUTATION_VERSION,
  DECLARED_DECISION_OFFSET_DAYS,
  DECLARED_POST_RELATIVE_DAYS,
  buildArtifacts,
  buildDrawdownBuckets,
  contiguousWindow,
  deriveSample,
  fundamentalStudyCustomPayloadSchema,
  isValidOhlc,
  shortBucketLabel,
  summarizeDailyPath,
  summarizeDrawdownBuckets,
  summarizeEntryDay,
  summarizeFutureHorizons,
  summarizeNonBreakVsBreak,
  type SampleDerived,
  type StudyBar,
  type StudySample,
} from "../../../research-experiments/first-board-pullback/fundamental-study/result";
import { EXPERIMENT_DEFINITIONS } from "../../../research-experiments/manifest";

// ---------------------------------------------------------------------------
// 夹具：6 个首板事件，覆盖「破位后涨回」「全程不破」「缺远端行情」「缺观察日」
//       「OHLC 非法」「缺涨停价」六种形态
// ---------------------------------------------------------------------------

const VERSION_ID = 990_100;
const EXPERIMENT_ID = "first-board-pullback/fundamental-study";

const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 120001,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-exp001-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 6,
  horizons: [5, 10, 20],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: DECLARED_DECISION_OFFSET_DAYS,
};

/** rd → 交易日（本地夹具固定映射，与平台无关）。 */
function dateOf(relativeDay: number): string {
  return `2025-01-${String(2 + relativeDay).padStart(2, "0")}`;
}

type Ohlc = readonly [open: number, high: number, low: number, close: number];

interface EventPlan {
  eventId: string;
  eventDate: string;
  /** `null` = 事件表没有涨停价（用于 MISSING_LIMIT_UP_PRICE）。 */
  limitUpPrice: number | null;
  previousClose: number;
  /** `null` = 首板日没有行情行（用于 MISSING_EVENT_DAY_BAR）。 */
  eventDayBar: Ohlc | null;
  postBars: Record<number, Ohlc>;
}

/** rd 6…20 的「平淡日」：把样本补成完整 20 天视界。 */
function tail(from: number, to: number, price: number): Record<number, Ohlc> {
  const out: Record<number, Ohlc> = {};
  for (let rd = from; rd <= to; rd += 1) out[rd] = [price, price, price, price];
  return out;
}

/** e1：T+1 回踩、T+2 跌破首板日开盘价、T+4/T+5 涨回 —— 「不破是路径条件」的主角。 */
const E1: EventPlan = {
  eventId: "e1",
  eventDate: "2025-01-02",
  limitUpPrice: 11,
  previousClose: 10,
  eventDayBar: [10, 11, 9.8, 11],
  postBars: {
    1: [11.5, 11.6, 10.9, 11.2],
    2: [11.0, 11.1, 9.6, 9.9],
    3: [9.8, 10.5, 9.5, 10.4],
    4: [10.5, 11.5, 10.3, 11.4],
    5: [11.4, 12.0, 11.2, 11.9],
    ...tail(6, 20, 11.9),
  },
};

/** e2：全程未跌破首板日开盘价（不破组）。 */
const E2: EventPlan = {
  eventId: "e2",
  eventDate: "2025-01-02",
  limitUpPrice: 22,
  previousClose: 20,
  eventDayBar: [20, 22, 19.9, 22],
  postBars: {
    1: [22.5, 23.0, 21.0, 22.8],
    2: [22.9, 23.5, 22.1, 23.2],
    3: [23.3, 24.0, 22.5, 23.8],
    4: [23.9, 24.5, 22.8, 24.2],
    5: [24.3, 25.0, 23.1, 24.6],
    ...tail(6, 20, 24.6),
  },
};

/** e3：只有 rd 1…5 的行情（远端 rd 6…20 缺）⇒ 入池但 T+10 / T+20 视界不可用。 */
const E3: EventPlan = {
  eventId: "e3",
  eventDate: "2025-01-02",
  limitUpPrice: 33,
  previousClose: 30,
  eventDayBar: [30, 33, 29.5, 33],
  postBars: {
    1: [33.5, 34.0, 32.0, 33.8],
    2: [33.9, 34.5, 33.2, 34.3],
    3: [34.4, 35.0, 33.6, 34.8],
    4: [34.9, 35.5, 34.0, 35.2],
    5: [35.3, 36.0, 34.4, 35.7],
  },
};

/** e4：缺 rd=2 的观察日行情 ⇒ 整事件剔除（禁跳洞取数）。 */
const E4: EventPlan = {
  eventId: "e4",
  eventDate: "2025-01-02",
  limitUpPrice: 44,
  previousClose: 40,
  eventDayBar: [40, 44, 39.6, 44],
  postBars: {
    1: [44.5, 45.0, 43.8, 44.6],
    3: [44.7, 45.2, 44.0, 44.9],
    4: [45.0, 45.5, 44.2, 45.1],
    5: [45.2, 45.8, 44.5, 45.5],
  },
};

/** e5：首板日 high < low（OHLC 自相矛盾）⇒ 剔除。 */
const E5: EventPlan = {
  eventId: "e5",
  eventDate: "2025-01-02",
  limitUpPrice: 55,
  previousClose: 50,
  eventDayBar: [50, 49, 51, 55],
  postBars: {},
};

/** e6：事件表没有涨停价 ⇒ 剔除。 */
const E6: EventPlan = {
  eventId: "e6",
  eventDate: "2025-01-02",
  limitUpPrice: null,
  previousClose: 60,
  eventDayBar: [60, 66, 59.5, 66],
  postBars: {},
};

function makeEvent(plan: EventPlan): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId: plan.eventId,
    symbol: "600000.SH",
    tradeDate: plan.eventDate,
    market: "SH",
    industryCode: "IND",
    boardType: "main",
    previousClose: plan.previousClose,
    limitUpPrice: plan.limitUpPrice,
    turnover: 2,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 1,
    marketCap: 1,
    floatMarketCap: 1,
  };
}

function makeBar(
  eventId: string,
  relativeDay: number,
  tradeDate: string,
  ohlc: Ohlc,
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate,
    relativeDay,
    open: ohlc[0],
    high: ohlc[1],
    low: ohlc[2],
    close: ohlc[3],
    volume: 1,
    amount: 1,
  };
}

interface Universe {
  events: FirstLimitPullbackEvent[];
  prefixBars: FirstLimitPullbackRawBar[];
  postBars: FirstLimitPullbackRawBar[];
}

function buildUniverse(plans: readonly EventPlan[]): Universe {
  const events: FirstLimitPullbackEvent[] = [];
  const prefixBars: FirstLimitPullbackRawBar[] = [];
  const postBars: FirstLimitPullbackRawBar[] = [];
  for (const plan of plans) {
    events.push(makeEvent(plan));
    if (plan.eventDayBar !== null) {
      prefixBars.push(makeBar(plan.eventId, 0, plan.eventDate, plan.eventDayBar));
    }
    for (const [key, ohlc] of Object.entries(plan.postBars)) {
      const rd = Number(key);
      postBars.push(makeBar(plan.eventId, rd, dateOf(rd), ohlc));
    }
  }
  return { events, prefixBars, postBars };
}

const MAIN_UNIVERSE = buildUniverse([E1, E2, E3, E4, E5, E6]);

function makeRunner(universe: Universe = MAIN_UNIVERSE, versionContext = context) {
  const registry = new ExperimentRegistry();
  registry.register(fundamentalStudyExperiment);
  const datasetPort = createRegistryExperimentDatasetPort({
    reader: new InMemoryResearchDatasetReader({
      context: versionContext,
      events: universe.events,
      prefixBars: universe.prefixBars,
      postBars: universe.postBars,
    }),
    eventPageSize: 2,
  });
  return createExperimentRunner({
    registry,
    datasetPort,
    now: () => new Date(1_700_000_000_000),
  });
}

async function expectThrowCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`期望抛出 ${code}，但没有抛出`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExperimentError);
    expect((error as ExperimentError).code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// 断言小工具（信封单元格只允许 number|string|boolean|null）
// ---------------------------------------------------------------------------

type Row = Readonly<Record<string, unknown>>;

function findRow(rows: readonly Row[], match: Readonly<Record<string, unknown>>): Row {
  const found = rows.find((row) => Object.entries(match).every(([key, value]) => row[key] === value));
  if (found === undefined) {
    throw new Error(`表里找不到匹配行 ${JSON.stringify(match)}；实际行键：${rows.map((r) => JSON.stringify(r)).join(" | ")}`);
  }
  return found;
}

function num(row: Row, key: string): number | null {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

function tableOf(payload: ExperimentResultPayload, key: string) {
  const table = (payload.tables ?? []).find((candidate) => candidate.key === key);
  if (table === undefined) throw new Error(`结果里没有表 ${key}`);
  return table;
}

/** 直接用纯计算层跑一次主夹具（避免与信封显示位收敛耦合）。 */
function deriveMain(
  maxObservationDay = 5,
  futureHorizons: readonly number[] = [5, 10, 20],
): SampleDerived[] {
  const samples: StudySample[] = [
    {
      eventId: "e1",
      symbol: "600000.SH",
      eventDate: "2025-01-02",
      firstLimitUpOpen: 10,
      firstLimitUpClose: 11,
      firstLimitUpPrice: 11,
      bars: Object.entries(E1.postBars).map(([key, ohlc]) => barOf(Number(key), ohlc)),
      maxAvailableRelativeDay: 20,
    },
    {
      eventId: "e2",
      symbol: "600000.SH",
      eventDate: "2025-01-02",
      firstLimitUpOpen: 20,
      firstLimitUpClose: 22,
      firstLimitUpPrice: 22,
      bars: Object.entries(E2.postBars).map(([key, ohlc]) => barOf(Number(key), ohlc)),
      maxAvailableRelativeDay: 20,
    },
    {
      eventId: "e3",
      symbol: "600000.SH",
      eventDate: "2025-01-02",
      firstLimitUpOpen: 30,
      firstLimitUpClose: 33,
      firstLimitUpPrice: 33,
      bars: Object.entries(E3.postBars).map(([key, ohlc]) => barOf(Number(key), ohlc)),
      maxAvailableRelativeDay: 5,
    },
  ];
  return samples.map((sample) => deriveSample(sample, { maxObservationDay, futureHorizons }));
}

function barOf(relativeDay: number, ohlc: Ohlc): StudyBar {
  return {
    relativeDay,
    tradeDate: dateOf(relativeDay),
    open: ohlc[0],
    high: ohlc[1],
    low: ohlc[2],
    close: ohlc[3],
  };
}

/** 主夹具的默认跑法（参数全默认）。 */
async function runMain(parameters: Record<string, unknown> = {}) {
  const runner = makeRunner();
  return runner.runDetailed({ experimentId: EXPERIMENT_ID, datasetVersionId: VERSION_ID, parameters });
}

// ---------------------------------------------------------------------------
// 1. ExperimentDefinition 注册
// ---------------------------------------------------------------------------

describe("EXP-001 · 1. ExperimentDefinition 注册", () => {
  it("清单里有本实验，且能通过 Registry 注册", () => {
    const registered = EXPERIMENT_DEFINITIONS.find((d) => d.descriptor.id === EXPERIMENT_ID);
    expect(registered).toBeDefined();
    const registry = new ExperimentRegistry();
    expect(() => registry.register(fundamentalStudyExperiment)).not.toThrow();
    expect(registry.listIds()).toContain(EXPERIMENT_ID);
  });

  it("descriptor 坐标自洽：id / pageKey / version / 计算口径版本一致", () => {
    const { descriptor } = fundamentalStudyExperiment;
    expect(descriptor.id).toBe(EXPERIMENT_ID);
    expect(descriptor.pageKey).toBe(EXPERIMENT_ID);
    expect(descriptor.version).toBe(COMPUTATION_VERSION);
    expect(descriptor.pageTitle).toBe("首板后回踩第一性研究");
    // 一个目录 = 一个独立 ExperimentDefinition（id 两段 kebab-case，与目录一致）
    expect(descriptor.id).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/u);
  });

  it("实验全程不得出现旧 Research 的锚字段（analysisId / findingIds / conclusionId / candidateId）", () => {
    const text = JSON.stringify(fundamentalStudyExperiment.descriptor);
    for (const forbidden of ["analysisId", "findingIds", "conclusionId", "candidateId"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("参数共 4 个，且都是研究范围参数（无「寻优」语义）", () => {
    const codes = fundamentalStudyExperiment.descriptor.parameters.map((p) => p.code);
    expect(codes).toEqual(["maxObservationDay", "futureHorizons", "drawdownBucketEdgesBps", "maxEvents"]);
  });
});

// ---------------------------------------------------------------------------
// 2 + 11. Dataset 声明与参数 / PIT 边界
// ---------------------------------------------------------------------------

describe("EXP-001 · 2+11. Dataset 声明与 PIT 边界", () => {
  it("声明面：datasetCode / 前缀 / 后缀 / 列 / usesForwardData / decisionOffsetDays", () => {
    const req = fundamentalStudyExperiment.descriptor.datasetRequirement;
    expect(req.datasetCode).toBe("first_limit_pullback");
    expect(req.prefixRelativeDays).toEqual([0]);
    expect(req.postRelativeDays).toEqual([...DECLARED_POST_RELATIVE_DAYS]);
    expect(req.postRelativeDays![0]).toBe(1);
    expect(req.postRelativeDays![req.postRelativeDays!.length - 1]).toBe(20);
    expect(req.usesForwardData).toBe(true);
    expect(req.forwardDataPurpose).toBeTruthy();
    expect(req.decisionOffsetDays).toBe(DECLARED_DECISION_OFFSET_DAYS);
    expect(DECLARED_DECISION_OFFSET_DAYS).toBe(5);
    // 三个角色的声明列必须逐项真实存在
    expect(req.requiredColumns.events).toEqual(["isFirstLimit", "boardType", "limitUpPrice", "previousClose"]);
    for (const role of ["feature", "observation"] as const) {
      expect(req.requiredColumns[role]).toEqual(["open", "high", "low", "close"]);
    }
  });

  it("参数越界一律执行前拒（不夹取）：maxObservationDay=6 超出声明边界", async () => {
    const runner = makeRunner();
    await expectThrowCode(
      runner.run({ experimentId: EXPERIMENT_ID, datasetVersionId: VERSION_ID, parameters: { maxObservationDay: 6 } }),
      "EXPERIMENT_PARAMETER_INVALID",
    );
  });

  it("未登记参数键被拒（不会静默忽略）", async () => {
    const runner = makeRunner();
    await expectThrowCode(
      runner.run({ experimentId: EXPERIMENT_ID, datasetVersionId: VERSION_ID, parameters: { bestEntryDay: 3 } }),
      "EXPERIMENT_PARAMETER_INVALID",
    );
  });

  it("版本非 READY ⇒ 拒（EXPERIMENT_DATASET_VERSION_NOT_READY）", async () => {
    const notReady = { ...context, status: "BUILDING" as ResearchDatasetVersionContext["status"] };
    await expectThrowCode(
      makeRunner(MAIN_UNIVERSE, notReady).run({ experimentId: EXPERIMENT_ID, datasetVersionId: VERSION_ID }),
      "EXPERIMENT_DATASET_VERSION_NOT_READY",
    );
  });

  it("Dataset 语义代码不匹配 ⇒ 拒（不静默换数据集）", async () => {
    const other = { ...context, datasetCode: "some_other_dataset" };
    await expectThrowCode(
      makeRunner(MAIN_UNIVERSE, other).run({ experimentId: EXPERIMENT_ID, datasetVersionId: VERSION_ID }),
      "EXPERIMENT_DATASET_CODE_MISMATCH",
    );
  });

  it("声明视界超出该版本真实视界 ⇒ 拒（不夹取）", async () => {
    const narrow = { ...context, postRelativeDayRange: { min: 1, max: 10 } };
    await expectThrowCode(
      makeRunner(MAIN_UNIVERSE, narrow).run({ experimentId: EXPERIMENT_ID, datasetVersionId: VERSION_ID }),
      "EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE",
    );
  });

  it("🔴 结构级闸门：maxObservationDay 超过 decisionOffsetDays 时 run() 自己拒绝（不靠参数边界兜）", async () => {
    // 参数边界（≤5）只是第一道；这里绕过 Runner 直接调 run()，验证实验内部的第二道闸门真的存在。
    const access = {
      facts: { datasetVersionId: VERSION_ID, datasetCode: "first_limit_pullback", totalEvents: 0 },
      events: async () => [],
      feature: async () => [],
      observation: async () => [],
    };
    const context = {
      descriptor: fundamentalStudyExperiment.descriptor,
      parameters: {
        maxObservationDay: 6,
        futureHorizons: [5],
        drawdownBucketEdgesBps: [0, -200],
        maxEvents: 100,
      },
      dataset: access,
      log: () => {},
      artifact: () => {},
    } as unknown as Parameters<ExperimentDefinition["run"]>[0];

    await expect(fundamentalStudyExperiment.run(context)).rejects.toThrow(/信息边界/u);
  });

  it("futureHorizons 含重复元素 ⇒ 拒（去重会静默改变列结构）", async () => {
    const runner = makeRunner();
    const outcome = await runner.run({
      experimentId: EXPERIMENT_ID,
      datasetVersionId: VERSION_ID,
      parameters: { futureHorizons: [5, 5, 10] },
    });
    expect(outcome.runStatus).toBe("FAILED");
    expect(outcome.error?.code).toBe("EXPERIMENT_RUN_FAILED");
    expect(outcome.error?.message).toContain("重复");
  });

  it("取数只走声明面：未声明的相对日读不到（观测日白名单）", async () => {
    const registry = new ExperimentRegistry();
    registry.register({
      ...fundamentalStudyExperiment,
      descriptor: { ...fundamentalStudyExperiment.descriptor, id: "demo/out-of-declaration" },
      run: async (ctx) => {
        await ctx.dataset.observation(21);
        return { sampleSummary: { candidateCount: 0, eligibleCount: 0, excludedCount: 0, excludedByReason: {} } };
      },
    });
    const port = createRegistryExperimentDatasetPort({
      reader: new InMemoryResearchDatasetReader({
        context,
        events: MAIN_UNIVERSE.events,
        prefixBars: MAIN_UNIVERSE.prefixBars,
        postBars: MAIN_UNIVERSE.postBars,
      }),
    });
    const probeRunner = createExperimentRunner({ registry, datasetPort: port });
    const outcome = await probeRunner.run({
      experimentId: "demo/out-of-declaration",
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("FAILED");
    expect(outcome.error?.code).toBe("EXPERIMENT_DATASET_REQUIREMENT_INVALID");
    expect(outcome.error?.message).toContain("未在 postRelativeDays 里声明");
  });
});

// ---------------------------------------------------------------------------
// 3 ~ 7. 逐日路径 / 基准 / 回踩 / 破位 / 回撤（纯计算层，数值逐个手工核对）
// ---------------------------------------------------------------------------

describe("EXP-001 · 3. T+1…T+5 相对日期计算", () => {
  it("byDay 覆盖 rd = 1…maxObservationDay，交易日与夹具一致", () => {
    const [e1] = deriveMain();
    expect(e1!.byDay.map((d) => d.relativeDay)).toEqual([1, 2, 3, 4, 5]);
    expect(e1!.byDay.map((d) => d.tradeDate)).toEqual([
      "2025-01-03",
      "2025-01-04",
      "2025-01-05",
      "2025-01-06",
      "2025-01-07",
    ]);
  });

  it("maxObservationDay 是可调的观察范围（3 ⇒ 只到 T+3）", () => {
    const [e1] = deriveMain(3, [5]);
    expect(e1!.byDay.map((d) => d.relativeDay)).toEqual([1, 2, 3]);
  });
});

describe("EXP-001 · 4+5+6+7. 基准价 / 回踩 / 破位（路径条件）/ 回撤深度", () => {
  it("回撤与破位锚在**首板日开盘价**，回踩锚在**首板日收盘价**（两个锚不可混）", () => {
    const [e1] = deriveMain();
    const d1 = e1!.byDay[0]!;
    // 首板日：open = 10，close = 11；T+1 low = 10.90
    expect(d1.lowReturnFromClose).toBeCloseTo((10.9 - 11) / 11, 12);
    expect(d1.pullbackBelowClose).toBe(true); // 10.90 < 11
    expect(d1.breakBelowOpen).toBe(false); // 10.90 ≥ 10
    expect(d1.drawdownFromClose).toBeCloseTo(-0.1 / 11, 12); // 对收盘价：负数 = 回撤
    expect(d1.drawdownFromOpen).toBeCloseTo(0.09, 12); // 对开盘价：仍在开盘价之上
  });

  it("回撤深度用**累计最低价**（不是当日最低价），两个口径都给", () => {
    const [e1] = deriveMain();
    const d3 = e1!.byDay[2]!;
    // T+1..T+3 的 low = 10.90 / 9.60 / 9.50 ⇒ cumulativeLow = 9.50
    expect(d3.cumulativeLow).toBeCloseTo(9.5, 12);
    expect(d3.drawdownFromClose).toBeCloseTo((9.5 - 11) / 11, 12);
    expect(d3.drawdownFromOpen).toBeCloseTo((9.5 - 10) / 10, 12);
    expect(d3.drawdownFromOpen).toBeLessThan(0); // 负数 = 回撤
  });

  it("🔴「不破首板日开盘价」是**路径条件**：T+2 破位后，T+4/T+5 涨回也不算不破", () => {
    const [e1, e2] = deriveMain();
    expect(e1!.byDay.map((d) => d.nonBreakOpen)).toEqual([true, false, false, false, false]);
    expect(e1!.byDay.map((d) => d.breakBelowOpen)).toEqual([false, true, true, false, false]);
    // T+4 的 low = 10.30 ≥ 10（当日没破），但路径已破 ⇒ nonBreakOpen 仍为 false
    expect(e1!.byDay[3]!.breakBelowOpen).toBe(false);
    expect(e1!.byDay[3]!.nonBreakOpen).toBe(false);

    // e2 全程不破
    expect(e2!.byDay.map((d) => d.nonBreakOpen)).toEqual([true, true, true, true, true]);
    expect(e2!.byDay.map((d) => d.breakBelowOpen)).toEqual([false, false, false, false, false]);
  });

  it("isValidOhlc 把「高低倒挂」「非正」「缺失」都判为非法", () => {
    expect(isValidOhlc({ open: 10, high: 11, low: 9.8, close: 11 })).toBe(true);
    expect(isValidOhlc({ open: 50, high: 49, low: 51, close: 55 })).toBe(false); // high < low
    expect(isValidOhlc({ open: 10, high: 11, low: 9.8, close: 0 })).toBe(false); // 非正
    expect(isValidOhlc({ open: 10, high: 11, low: null, close: 11 })).toBe(false); // 缺失
    expect(isValidOhlc({ open: 11, high: 11, low: 9.8, close: 11.5 })).toBe(false); // close 高于 high
  });

  it("contiguousWindow 缺一天就返回 null（禁跳洞取数）", () => {
    const index = new Map<number, StudyBar>([
      [1, barOf(1, [10, 11, 9, 10])],
      [2, barOf(2, [10, 11, 9, 10])],
    ]);
    expect(contiguousWindow(index, 1, 2)).not.toBeNull();
    expect(contiguousWindow(index, 1, 3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. 回撤深度分桶
// ---------------------------------------------------------------------------

describe("EXP-001 · 8. 回撤深度分桶", () => {
  const DEFAULTS = [0, -200, -500, -800, -1000];

  it("默认边界产出 6 个桶（未回踩 + 4 段 + 溢出一段），互不重叠且完全覆盖", () => {
    const { buckets, edgesRatio } = buildDrawdownBuckets(DEFAULTS);
    expect(edgesRatio).toEqual([0, -0.02, -0.05, -0.08, -0.1]);
    expect(buckets.map((b) => b.code)).toEqual([
      "NO_PULLBACK",
      "DD_200BP",
      "DD_500BP",
      "DD_800BP",
      "DD_1000BP",
      "DD_BELOW_1000BP",
    ]);
    const probes = [0.2, 0, -0.001, -0.02, -0.03, -0.05, -0.07, -0.08, -0.09, -0.1, -0.5];
    for (const probe of probes) {
      expect(buckets.filter((bucket) => bucket.test(probe))).toHaveLength(1);
    }
  });

  it("边界本身是「下界含、上界不含」（-2% 落在 DD_200BP，不落 NO_PULLBACK）", () => {
    const { buckets } = buildDrawdownBuckets(DEFAULTS);
    const dd = (code: string) => buckets.find((b) => b.code === code)!;
    expect(dd("NO_PULLBACK").test(0)).toBe(true);
    expect(dd("DD_200BP").test(0)).toBe(false);
    expect(dd("DD_200BP").test(-0.02)).toBe(true);
    expect(dd("DD_200BP").test(-0.019999)).toBe(true); // -1.9999% 仍落在 [-2%, 0)
    expect(dd("DD_200BP").test(-0.020001)).toBe(false); // 越过 -2% ⇒ 落到下一桶
    expect(dd("DD_BELOW_1000BP").test(-1)).toBe(true);
  });

  it("非法边界当场抛错（首项非 0 / 非递减 / 正数 / 少于 2 项）", () => {
    expect(() => buildDrawdownBuckets([0])).toThrow(/至少需要 2 个边界/u);
    expect(() => buildDrawdownBuckets([-100, -200])).toThrow(/第 1 项必须是 0/u);
    expect(() => buildDrawdownBuckets([0, -800, -500])).toThrow(/严格递减/u);
    expect(() => buildDrawdownBuckets([0, 200])).toThrow(/必须 ≤ 0/u);
    expect(() => buildDrawdownBuckets([0, -200.5])).toThrow(/必须是整数/u);
  });

  it("紧凑标签从权威边界派生（图表横轴不写第二套数值）", () => {
    const { buckets } = buildDrawdownBuckets(DEFAULTS);
    expect(buckets.map(shortBucketLabel)).toEqual(["未回踩", "-2%~0%", "-5%~-2%", "-8%~-5%", "-10%~-8%", "<-10%"]);
  });

  it("分桶汇总表：主夹具 3 个样本全部落桶，且 NO_PULLBACK 为空", () => {
    const derived = deriveMain();
    const { buckets } = buildDrawdownBuckets(DEFAULTS);
    const table = summarizeDrawdownBuckets(derived, buckets, 5, [5, 10, 20]);
    expect(table.key).toBe("drawdown_buckets");
    // e1 dd = -0.1364 ⇒ <-10%；e2 dd = -0.0455 与 e3 dd = -0.0303 ⇒ -5%~-2%
    expect(num(findRow(table.rows, { bucket: "DD_BELOW_1000BP" }), "sampleCount")).toBe(1);
    expect(num(findRow(table.rows, { bucket: "DD_500BP" }), "sampleCount")).toBe(2);
    expect(num(findRow(table.rows, { bucket: "NO_PULLBACK" }), "sampleCount")).toBe(0);
    const total = table.rows.reduce((acc, row) => acc + (num(row, "sampleCount") ?? 0), 0);
    expect(total).toBe(derived.length);
  });
});

// ---------------------------------------------------------------------------
// 9. 后续收益与突破
// ---------------------------------------------------------------------------

describe("EXP-001 · 9. 后续收益与突破", () => {
  it("byHorizon：以首板日**收盘价**为锚，MFE/MAE 与同锚 high/low 收益数学恒等", () => {
    const [e1] = deriveMain();
    const h5 = e1!.byHorizon.get(5)!;
    expect(h5.available).toBe(true);
    expect(h5.barCount).toBe(5);
    // 窗口 rd 1…5 的 high = 12.00、low = 9.50、最后一日 close = 11.90
    expect(h5.futureHighReturnFromClose).toBeCloseTo((12 - 11) / 11, 12);
    expect(h5.futureLowReturnFromClose).toBeCloseTo((9.5 - 11) / 11, 12);
    expect(h5.futureCloseReturnFromClose).toBeCloseTo((11.9 - 11) / 11, 12);
    expect(h5.mfeFromClose).toBe(h5.futureHighReturnFromClose);
    expect(h5.maeFromClose).toBe(h5.futureLowReturnFromClose);
  });

  it("突破研究：对首板日收盘价与涨停价两个基准，记录首次突破相对日", () => {
    const [e1, e2] = deriveMain();
    const h5e1 = e1!.byHorizon.get(5)!;
    // e1：T+1 high = 11.60 > close0 = 11 且 > limitUpPrice = 11 ⇒ 首次突破 = 1
    expect(h5e1.breakoutVsClose).toBe(true);
    expect(h5e1.timeToBreakoutVsClose).toBe(1);
    expect(h5e1.breakoutVsLimitUpPrice).toBe(true);
    expect(h5e1.timeToBreakoutVsLimitUpPrice).toBe(1);
    // e2：T+1 high = 23.00 > close0 = 22、但 limitUpPrice = 22 同值 ⇒ 也是 1
    const h5e2 = e2!.byHorizon.get(5)!;
    expect(h5e2.timeToBreakoutVsClose).toBe(1);
  });

  it("缺远端行情 ⇒ 视界如实不可用（available = false，不夹取、不用短窗冒充）", () => {
    const [, , e3] = deriveMain();
    expect(e3!.byHorizon.get(5)!.available).toBe(true);
    expect(e3!.byHorizon.get(10)!.available).toBe(false);
    expect(e3!.byHorizon.get(10)!.futureCloseReturnFromClose).toBeNull();
    expect(e3!.byHorizon.get(20)!.available).toBe(false);
  });

  it("后续视界表按「截至 T+5 的破位状态」分组，且样本数随视界缩短而增加", () => {
    const derived = deriveMain();
    const table = summarizeFutureHorizons(derived, [5, 10, 20], 5);
    expect(table.key).toBe("future_horizon_comparison");
    // T+5：三个样本都可用 ⇒ ALL = 3；T+20：只有 e1 / e2 可用 ⇒ ALL = 2
    expect(num(findRow(table.rows, { horizon: "T+5", group: "ALL" }), "sampleCount")).toBe(3);
    expect(num(findRow(table.rows, { horizon: "T+20", group: "ALL" }), "sampleCount")).toBe(2);
    // 分组固定为 T+5 的状态：e1 破位、e2 / e3 不破
    expect(num(findRow(table.rows, { horizon: "T+20", group: "BREAK_OPEN" }), "sampleCount")).toBe(1);
    expect(num(findRow(table.rows, { horizon: "T+20", group: "NON_BREAK_OPEN" }), "sampleCount")).toBe(1);
  });

  it("入场日视角：k = 1 的「入场前未破位」是空路径恒真（定义结果，不是研究发现）", () => {
    const derived = deriveMain();
    const table = summarizeEntryDay(derived, 5, [5, 10, 20]);
    expect(table.key).toBe("entry_day_comparison");
    expect(num(findRow(table.rows, { entryDay: "T+1" }), "nonBreakOpenRate")).toBe(1);
    // T+3 时 e1 已破位 ⇒ 2/3
    expect(num(findRow(table.rows, { entryDay: "T+3" }), "nonBreakOpenRate")).toBeCloseTo(2 / 3, 12);
    expect(num(findRow(table.rows, { entryDay: "T+5" }), "nonBreakOpenCount")).toBe(2);
  });

  it("入场日视角：入场后的口径需要 rd 齐全，否则如实为 null（next20 在 post 视界 20 内恒不可用）", () => {
    const derived = deriveMain();
    const table = summarizeEntryDay(derived, 5, [5, 10, 20]);
    // T+1 入场、next5 ⇒ 需要 rd 2…6；e3 只有 1…5 ⇒ 可用 2 条
    expect(num(findRow(table.rows, { entryDay: "T+1" }), "availableCountNext5")).toBe(2);
    // T+1 入场、next20 ⇒ 需要 rd 2…21，超过 post 物理视界 20 ⇒ 0 条可用（如实，不伪造）
    expect(num(findRow(table.rows, { entryDay: "T+1" }), "availableCountNext20")).toBe(0);
    expect(num(findRow(table.rows, { entryDay: "T+1" }), "meanNext20TradingDayReturn")).toBeNull();
  });

  it("逐日路径表：T+1 全部回踩、T+5 无人回踩；破位只从 T+2 开始", () => {
    const derived = deriveMain();
    const table = summarizeDailyPath(derived, 5);
    expect(table.key).toBe("daily_path_by_relative_day");
    const t1 = findRow(table.rows, { relativeDay: "T+1" });
    expect(num(t1, "sampleCount")).toBe(3);
    expect(num(t1, "pullbackCount")).toBe(3);
    expect(num(t1, "pullbackRate")).toBe(1);
    expect(num(t1, "breakOpenCount")).toBe(0);
    expect(num(t1, "nonBreakOpenCount")).toBe(3);
    const t2 = findRow(table.rows, { relativeDay: "T+2" });
    expect(num(t2, "breakOpenCount")).toBe(1);
    expect(num(t2, "nonBreakOpenCount")).toBe(2);
    const t5 = findRow(table.rows, { relativeDay: "T+5" });
    expect(num(t5, "pullbackCount")).toBe(0);
    expect(num(t5, "nonBreakOpenCount")).toBe(2);
  });

  it("不破 / 破位对照表：每日三组（ALL / NON_BREAK_OPEN / BREAK_OPEN）都在", () => {
    const derived = deriveMain();
    const table = summarizeNonBreakVsBreak(derived, 5);
    expect(table.key).toBe("non_break_vs_break");
    expect(table.rows).toHaveLength(5 * 3);
    const t5 = table.rows.filter((row) => row["classificationDay"] === "T+5");
    expect(num(findRow(t5, { group: "ALL" }), "sampleCount")).toBe(3);
    expect(num(findRow(t5, { group: "NON_BREAK_OPEN" }), "sampleCount")).toBe(2);
    expect(num(findRow(t5, { group: "BREAK_OPEN" }), "sampleCount")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 10 + 13 + 14. 端到端：剔除原因 / 数据不足 / 结果信封
// ---------------------------------------------------------------------------

describe("EXP-001 · 10+13. 剔除原因与数据质量（端到端 Run）", () => {
  it("六个候选中三个入池，三个各自归入一个闭集原因，账目严格守恒", async () => {
    const { outcome } = await runMain();
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const payload = outcome.result!;
    const summary = payload.sampleSummary;
    expect(summary.candidateCount).toBe(6);
    expect(summary.eligibleCount).toBe(3);
    expect(summary.excludedCount).toBe(3);
    expect(summary.excludedByReason).toEqual({
      MISSING_OBSERVATION_BAR: 1,
      INVALID_EVENT_DAY_OHLC: 1,
      MISSING_LIMIT_UP_PRICE: 1,
    });
    // 账必须平（平台也会校验，这里独立断言一次）
    expect(summary.eligibleCount + summary.excludedCount).toBe(summary.candidateCount);
    expect(Object.values(summary.excludedByReason).reduce((a, b) => a + b, 0)).toBe(summary.excludedCount);
  });

  it("剔除原因码全部在闭集里（禁止出现未登记原因）", () => {
    const registered = Object.keys(EXCLUSION_REASON_LABELS).sort();
    expect(registered).toEqual([
      "INVALID_EVENT_DAY_CLOSE",
      "INVALID_EVENT_DAY_OHLC",
      "INVALID_EVENT_DAY_OPEN",
      "INVALID_OBSERVATION_OHLC",
      "MAX_EVENTS_LIMIT",
      "MISSING_EVENT_DAY_BAR",
      "MISSING_LIMIT_UP_PRICE",
      "MISSING_OBSERVATION_BAR",
    ]);
    // 每个码都有中文说明（页面要能直接展示「为什么被剔除」）
    for (const label of Object.values(EXCLUSION_REASON_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("数据质量块逐项登记（缺观察日 / 非法 OHLC / 远端视界不足）", async () => {
    const { outcome } = await runMain();
    const payload = fundamentalStudyCustomPayloadSchema.parse(outcome.result!.customPayload);
    expect(payload.dataQuality.includedCount).toBe(3);
    expect(payload.dataQuality.excludedCount).toBe(3);
    expect(payload.dataQuality.missingObservationBarCount).toBe(1);
    expect(payload.dataQuality.invalidOhlcBarCount).toBe(1);
    expect(payload.dataQuality.missingEventDayBarCount).toBe(0);
    expect(payload.dataQuality.duplicateEventIdCount).toBe(0);
    // e3 缺 rd 6…20 ⇒ 最长视界不可用
    expect(payload.dataQuality.insufficientForwardBarsEventCount).toBe(1);
    expect(payload.dataQuality.datasetDeclaredTotalEvents).toBe(6);
  });

  it("summary / metrics 的坐标与关键统计量与表同源", async () => {
    const { outcome } = await runMain();
    const payload = fundamentalStudyCustomPayloadSchema.parse(outcome.result!.customPayload);
    expect(payload.computationVersion).toBe(COMPUTATION_VERSION);
    expect(payload.studyWindow).toMatchObject({
      maxObservationDay: 5,
      futureHorizons: [5, 10, 20],
      classificationDay: 5,
      drawdownBucketEdgesBps: [0, -200, -500, -800, -1000],
    });
    expect(payload.studyWindow.drawdownBucketEdgesRatio).toEqual([0, -0.02, -0.05, -0.08, -0.1]);
    expect(payload.summary).toEqual({
      sampleCount: 3,
      validSampleCount: 3,
      pullbackSampleCount: 3,
      nonBreakOpenSampleCount: 2,
      breakOpenSampleCount: 1,
    });
    expect(payload.metrics.finalObservationDay).toBe(5);
    expect(payload.metrics.nonBreakOpenRateThroughFinalDay).toBeCloseTo(2 / 3, 12);
    expect(payload.metrics.breakOpenRateThroughFinalDay).toBeCloseTo(1 / 3, 12);
    // 「当日破位率」与「截至破位率」是两个不同的量（T+5 当日无人破位，但历史上有人破过）
    expect(payload.metrics.breakOpenRateOnFinalDay).toBe(0);
    expect(payload.metrics.nonBreakOpenRateThroughFinalDay).not.toBe(payload.metrics.breakOpenRateOnFinalDay);
    // 分组结果按 (horizon × group) 展开，共 3 × 3 项
    expect(payload.metrics.groupOutcomes).toHaveLength(9);
  });

  it("观察按四类产出，且**不出现**「最优 / 最佳 / 应该买」这类策略结论措辞", async () => {
    const { outcome } = await runMain();
    const payload = fundamentalStudyCustomPayloadSchema.parse(outcome.result!.customPayload);
    const kinds = new Set(payload.observations.map((o) => o.kind));
    for (const kind of ["DESCRIPTIVE", "COMPARATIVE", "POTENTIAL_SIGNAL", "LIMITATION"]) {
      expect(kinds.has(kind as (typeof payload.observations)[number]["kind"])).toBe(true);
    }
    // 🔴 判据必须是**断言形态**，不能是裸子串：本实验的 LIMITATION 里**刻意写着**
    //    「不判定最优观察日 / 入场日 / 回撤区间」，裸子串断言命中的是否定式说明，
    //    证明不了任何事（这正是本仓已记录的教训）。
    //    因此只在**不含否定词**的句子里查「优越性 / 买入动作」的断言。
    const sentences = payload.observations
      .flatMap((o) => o.text.split(/[。；\n]+/u))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const claim = /(最优|最佳|应该买|应当买|建议买|推荐买|可以买入|应建仓|策略应当)/u;
    const negation = /(不|禁|未|无|非)/u;
    const offenders = sentences.filter((s) => claim.test(s) && !negation.test(s));
    expect(offenders).toEqual([]);
  });

  it("🔴 同一句里的「未跌破 X% / 曾跌破 Y%」必须互补：Y 用**截至**口径，不是**当日**破位率", async () => {
    // 踩过的坑（EXP-001 真机 Run 实测）：观察句里「曾跌破的占」误用了表里的 `breakOpenRate`
    // ——那是**当日**破位率（26.23%），而「未跌破」是**截至**口径（66.77%）⇒
    // 同一句话里两个数加起来只有 93%，会被读成事实的假信息。
    const { outcome } = await runMain();
    const payload = fundamentalStudyCustomPayloadSchema.parse(outcome.result!.customPayload);

    const breakSentence =
      payload.observations
        .flatMap((o) => o.text.split(/[。；\n]+/u))
        .find((s) => s.includes("曾跌破")) ?? "";
    expect(breakSentence).not.toBe("");

    const throughRate = payload.metrics.breakOpenRateThroughFinalDay;
    const onDayRate = payload.metrics.breakOpenRateOnFinalDay;
    expect(throughRate).not.toBeNull();
    expect(onDayRate).not.toBeNull();
    // 两个口径在夹具里确实不同 —— 否则下面那条断言证明不了任何事
    expect(throughRate).not.toBe(onDayRate);

    const throughText = `${(throughRate! * 100).toFixed(2)}%`;
    const onDayText = `${(onDayRate! * 100).toFixed(2)}%`;
    expect(breakSentence).toContain(throughText);
    expect(breakSentence).not.toContain(onDayText);

    // 硬判据：同一句里的两个百分比必须互补到 100%
    const percents = [...breakSentence.matchAll(/(\d+\.\d+)%/gu)].map((m) => Number(m[1]));
    expect(percents).toHaveLength(2);
    expect(percents[0]! + percents[1]!).toBeCloseTo(100, 2);
  });

  it("假设只以 H1/H2/H3 形式给出（potential strategy hypotheses），不含策略对象", async () => {
    const { outcome } = await runMain();
    const payload = fundamentalStudyCustomPayloadSchema.parse(outcome.result!.customPayload);
    expect(payload.potentialStrategyHypotheses.map((h) => h.code)).toEqual(["H1", "H2", "H3"]);
    for (const hypothesis of payload.potentialStrategyHypotheses) {
      expect(hypothesis.statement.length).toBeGreaterThan(0);
      expect(hypothesis.rationale.length).toBeGreaterThan(0);
    }
    // 结果里不得出现旧 Research / Strategy 的锚
    const serialized = JSON.stringify(payload);
    for (const forbidden of ["analysisId", "findingIds", "conclusionId", "candidateId", "strategyDefinitionId"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("🔴 读取层调用次数 = rd=0 一次 + 20 个观察日各一次（禁 N×M 逐事件逐日查询）", async () => {
    // 这条是「性能要求」的**硬证据**：数据面每读一个相对日只发**一次**批量查询，
    // 与事件数无关。若有人把实现改成「逐事件取数」，调用次数会变成 20 × N + 1 ⇒ 立刻变红。
    const reader = new InMemoryResearchDatasetReader({
      context,
      events: MAIN_UNIVERSE.events,
      prefixBars: MAIN_UNIVERSE.prefixBars,
      postBars: MAIN_UNIVERSE.postBars,
    });
    const registry = new ExperimentRegistry();
    registry.register(fundamentalStudyExperiment);
    const datasetPort = createRegistryExperimentDatasetPort({ reader, eventPageSize: 2 });
    const runner = createExperimentRunner({ registry, datasetPort });
    const outcome = await runner.run({ experimentId: EXPERIMENT_ID, datasetVersionId: VERSION_ID });
    expect(outcome.runStatus).toBe("SUCCEEDED");

    const prefixCalls = reader.callLog.filter((call) => call.method === "loadPrefixBars");
    const postCalls = reader.callLog.filter((call) => call.method === "loadPostBars");
    // rd=0 一次（prefix），rd 1…20 各一次（post）
    expect(prefixCalls).toHaveLength(1);
    expect(postCalls).toHaveLength(DECLARED_POST_RELATIVE_DAYS.length);
    expect(postCalls).toHaveLength(20);
    // 每次查询覆盖**全部**候选事件（批量），不是单个事件
    const eventCount = MAIN_UNIVERSE.events.length;
    for (const call of [...prefixCalls, ...postCalls]) {
      expect(call.ids).toBe(eventCount);
    }
    // 反证：逐事件查询会是多少次
    const naive = (DECLARED_POST_RELATIVE_DAYS.length + 1) * eventCount;
    expect(prefixCalls.length + postCalls.length).toBeLessThan(naive);
  });

  it("MAX_EVENTS_LIMIT：超上限的事件逐条登记，不静默丢弃", async () => {
    // 参数下界是 100 ⇒ 造 120 个事件、maxEvents = 100
    const plans: EventPlan[] = [];
    for (let i = 0; i < 120; i += 1) {
      const id = `bulk-${String(i).padStart(3, "0")}`;
      plans.push({
        eventId: id,
        eventDate: `2025-03-${String((i % 28) + 1).padStart(2, "0")}`,
        limitUpPrice: 11,
        previousClose: 10,
        eventDayBar: [10, 11, 9.8, 11],
        postBars: { 1: [11, 11.5, 10.5, 11.2], 2: [11.2, 11.6, 10.8, 11.4], 3: [11.4, 11.8, 11, 11.6], 4: [11.6, 12, 11.2, 11.8], 5: [11.8, 12.2, 11.4, 12] },
      });
    }
    const universe = buildUniverse(plans);
    const wideContext: ResearchDatasetVersionContext = { ...context, totalEvents: 120 };
    const runner = makeRunner(universe, wideContext);
    const { outcome } = await runner.runDetailed({
      experimentId: EXPERIMENT_ID,
      datasetVersionId: VERSION_ID,
      parameters: { maxEvents: 100 },
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const summary = outcome.result!.sampleSummary;
    expect(summary.candidateCount).toBe(120);
    expect(summary.excludedByReason.MAX_EVENTS_LIMIT).toBe(20);
    expect(summary.eligibleCount).toBe(100);
    expect(summary.eligibleCount + summary.excludedCount).toBe(summary.candidateCount);
  });

  it("🔴 数据集声明的事件数 > 本轮扫描到的候选数 ⇒ 缺口必须显式出数（守恒式覆盖不到它）", async () => {
    // 平台强制的守恒式是 `eligible + excluded = candidate`，而**压根没被扫描到的事件
    // 根本不在候选里** ⇒ 守恒式在它们身上恒真、起不到任何保护作用。
    // 缺口只能自己出数，否则「数据集 120 个 / 本轮只看 6 个」会静默读成「数据集只有 6 个」
    // （EXP-001 真机 Run 实测踩过：数据集声明 23978、本轮候选 20000，中间 3978 无任何记录）。
    const { outcome } = await makeRunner(MAIN_UNIVERSE, { ...context, totalEvents: 120 }).runDetailed({
      experimentId: EXPERIMENT_ID,
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const payload = fundamentalStudyCustomPayloadSchema.parse(outcome.result!.customPayload);
    const summary = outcome.result!.sampleSummary;

    expect(payload.candidates.datasetEventCount).toBe(120);
    expect(payload.candidates.candidateCount).toBe(6);
    expect(payload.candidates.unscannedEventCount).toBe(114);

    // 守恒式照样「平」—— 这正是它保护不到缺口的原因，必须显式断言这一点
    expect(summary.eligibleCount + summary.excludedCount).toBe(summary.candidateCount);
    expect(Object.values(summary.excludedByReason).reduce((a, b) => a + b, 0)).toBe(summary.excludedCount);

    // 缺口必须出现在**人能看到的地方**（notes + LIMITATION 观察），且带具体条数
    expect((summary.notes ?? []).join("\n")).toContain("114");
    const limitation = payload.observations
      .filter((o) => o.kind === "LIMITATION")
      .map((o) => o.text)
      .join("\n");
    expect(limitation).toContain("120");
    expect(limitation).toContain("114");
    expect(limitation).toContain("未被扫描");
  });

  it("缺口为 0 时不报缺口；数据集未声明总数时缺口是 null（**不是** 0）", async () => {
    // 声明总数 = 实际扫到的 6 个 ⇒ 无缺口，不应出现缺口措辞
    const exact = await makeRunner(MAIN_UNIVERSE, { ...context, totalEvents: 6 }).runDetailed({
      experimentId: EXPERIMENT_ID,
      datasetVersionId: VERSION_ID,
    });
    expect(exact.outcome.runStatus).toBe("SUCCEEDED");
    const payloadExact = fundamentalStudyCustomPayloadSchema.parse(exact.outcome.result!.customPayload);
    expect(payloadExact.candidates.unscannedEventCount).toBe(0);
    expect(
      payloadExact.observations
        .filter((o) => o.kind === "LIMITATION")
        .map((o) => o.text)
        .join("\n"),
    ).not.toContain("未被扫描");

    // 数据集没声明总数 ⇒ 缺口**不可知**，不能用 0 冒充（0 会被读成「账目完整」）
    const unknown = await makeRunner(MAIN_UNIVERSE, { ...context, totalEvents: null }).runDetailed({
      experimentId: EXPERIMENT_ID,
      datasetVersionId: VERSION_ID,
    });
    expect(unknown.outcome.runStatus).toBe("SUCCEEDED");
    const payloadUnknown = fundamentalStudyCustomPayloadSchema.parse(unknown.outcome.result!.customPayload);
    expect(payloadUnknown.candidates.unscannedEventCount).toBeNull();
    expect((unknown.outcome.result!.sampleSummary.notes ?? []).join("\n")).toContain("无法核对");
  });

  it("同一事件 ID 重复出现 ⇒ 去重并计数（不重复计入样本）", async () => {
    const duplicated: Universe = {
      events: [...MAIN_UNIVERSE.events, makeEvent(E1)],
      prefixBars: [...MAIN_UNIVERSE.prefixBars, makeBar("e1", 0, E1.eventDate, E1.eventDayBar!)],
      postBars: MAIN_UNIVERSE.postBars,
    };
    const { outcome } = await makeRunner(duplicated).runDetailed({
      experimentId: EXPERIMENT_ID,
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const payload = fundamentalStudyCustomPayloadSchema.parse(outcome.result!.customPayload);
    expect(payload.dataQuality.duplicateEventIdCount).toBe(1);
    expect(outcome.result!.sampleSummary.candidateCount).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 12. 空数据
// ---------------------------------------------------------------------------

describe("EXP-001 · 12. 空数据（零候选也要产出结构完整的结果）", () => {
  it("events 为空 ⇒ 成功、账目 0=0+0、表 / 图 / 统计仍然齐全（不崩、不造假）", async () => {
    const empty: Universe = { events: [], prefixBars: [], postBars: [] };
    const { outcome } = await makeRunner(empty, { ...context, totalEvents: 0 }).runDetailed({
      experimentId: EXPERIMENT_ID,
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const payload = outcome.result!;
    expect(payload.sampleSummary).toMatchObject({
      candidateCount: 0,
      eligibleCount: 0,
      excludedCount: 0,
      excludedByReason: {},
    });
    // 五张表都还在，行结构完整，比率类为 null 而不是 0
    expect(payload.tables!.map((t) => t.key)).toEqual([
      "daily_path_by_relative_day",
      "non_break_vs_break",
      "drawdown_buckets",
      "entry_day_comparison",
      "future_horizon_comparison",
    ]);
    const daily = findRow(tableOf(payload, "daily_path_by_relative_day").rows, { relativeDay: "T+1" });
    expect(num(daily, "sampleCount")).toBe(0);
    expect(num(daily, "pullbackRate")).toBeNull();
    expect(num(daily, "averageCloseReturn")).toBeNull();
    const custom = fundamentalStudyCustomPayloadSchema.parse(payload.customPayload);
    expect(custom.summary).toEqual({
      sampleCount: 0,
      validSampleCount: 0,
      pullbackSampleCount: 0,
      nonBreakOpenSampleCount: 0,
      breakOpenSampleCount: 0,
    });
    expect(custom.metrics.nonBreakOpenRateThroughFinalDay).toBeNull();
  });

  it("有事件但首板日全部缺行情 ⇒ 全部剔除、原因逐条登记、结果仍可读", async () => {
    const noEventDay: Universe = {
      events: [makeEvent(E1), makeEvent(E2)],
      prefixBars: [],
      postBars: MAIN_UNIVERSE.postBars,
    };
    const { outcome } = await makeRunner(noEventDay).runDetailed({
      experimentId: EXPERIMENT_ID,
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    expect(outcome.result!.sampleSummary).toMatchObject({
      candidateCount: 2,
      eligibleCount: 0,
      excludedCount: 2,
    });
    expect(outcome.result!.sampleSummary.excludedByReason.MISSING_EVENT_DAY_BAR).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 14. Result Envelope 完整性
// ---------------------------------------------------------------------------

describe("EXP-001 · 14. Result Envelope", () => {
  it("metadata 由平台填真实坐标（实验无法谎报 Dataset 版本）", async () => {
    const { outcome } = await runMain();
    expect(outcome.result!.metadata).toMatchObject({
      experimentId: EXPERIMENT_ID,
      experimentVersion: COMPUTATION_VERSION,
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetVersionLabel: "v-exp001-test",
      computationVersion: COMPUTATION_VERSION,
    });
    expect(outcome.result!.parameters).toEqual({
      maxObservationDay: 5,
      futureHorizons: [5, 10, 20],
      drawdownBucketEdgesBps: [0, -200, -500, -800, -1000],
      maxEvents: 20000,
    });
  });

  it("信封含 5 张表 / 8 个统计量 / 2 个分布 / 3 张图 / 1 个比较", async () => {
    const { outcome } = await runMain();
    const payload = outcome.result!;
    expect(payload.tables!.map((t) => t.key)).toEqual([
      "daily_path_by_relative_day",
      "non_break_vs_break",
      "drawdown_buckets",
      "entry_day_comparison",
      "future_horizon_comparison",
    ]);
    expect(payload.statistics!.map((s) => s.code)).toEqual([
      "included_sample_count",
      "excluded_sample_count",
      "pullback_sample_count",
      "non_break_open_rate",
      "break_open_rate",
      "mean_drawdown_from_close",
      "median_drawdown_from_close",
      "median_drawdown_from_open",
    ]);
    expect(payload.distributions!.map((d) => d.code)).toEqual([
      "drawdown_from_close_bucket",
      "future_close_return_T20_bucket",
    ]);
    expect(payload.charts!.map((c) => c.key)).toEqual([
      "path-mean-median",
      "drawdown-bucket-distribution",
      "non-break-vs-break-by-horizon",
    ]);
    expect(payload.comparisons!.map((c) => c.key)).toEqual(["non-break-vs-break-at-longest-horizon"]);
  });

  it("比率类统计量的 sampleCount 挂的是**分母**（分类日有路径的样本数），不是分子", async () => {
    const { outcome } = await runMain();
    const payload = outcome.result!;
    const nonBreak = payload.statistics!.find((s) => s.code === "non_break_open_rate")!;
    const breakOpen = payload.statistics!.find((s) => s.code === "break_open_rate")!;
    expect(nonBreak.sampleCount).toBe(3);
    expect(breakOpen.sampleCount).toBe(3);
    expect(nonBreak.value).toBeCloseTo(2 / 3, 6);
  });

  it("表内比率按显示位收敛（页面看到的数值与 CSV 同源，不存在第二套口径）", async () => {
    const { outcome } = await runMain();
    const daily = findRow(tableOf(outcome.result!, "daily_path_by_relative_day").rows, { relativeDay: "T+5" });
    const value = num(daily, "meanCumulativeDrawdownFromOpen");
    expect(value).not.toBeNull();
    expect(String(value)).not.toMatch(/e[+-]/iu);
  });

  it("样本账不平 ⇒ 平台拒（实验自己也不制造不平的账）", async () => {
    const broken: ExperimentDefinition = {
      ...fundamentalStudyExperiment,
      descriptor: { ...fundamentalStudyExperiment.descriptor, id: "demo/broken-account" },
      run: async () => ({
        sampleSummary: { candidateCount: 5, eligibleCount: 3, excludedCount: 1, excludedByReason: { A: 1 } },
      }),
    };
    const registry = new ExperimentRegistry();
    registry.register(broken);
    const port = createRegistryExperimentDatasetPort({
      reader: new InMemoryResearchDatasetReader({ context, events: [], prefixBars: [], postBars: [] }),
    });
    const runner = createExperimentRunner({ registry, datasetPort: port });
    const outcome = await runner.run({ experimentId: "demo/broken-account", datasetVersionId: VERSION_ID });
    expect(outcome.runStatus).toBe("FAILED");
    expect(outcome.error?.code).toBe("EXPERIMENT_RESULT_INVALID");
  });
});

// ---------------------------------------------------------------------------
// 15. Artifact Key
// ---------------------------------------------------------------------------

describe("EXP-001 · 15. Artifact Key", () => {
  it("7 个产物：名字是合法相对名**且不含角色段**、落在 Run 前缀的角色段下、两两唯一", async () => {
    const { artifactFiles } = await runMain();
    expect(artifactFiles).toHaveLength(7);
    const names = artifactFiles.map((file) => file.name);
    expect(new Set(names).size).toBe(7);
    expect(artifactFiles.filter((file) => file.role === "table")).toHaveLength(5);
    expect(artifactFiles.filter((file) => file.role === "chart")).toHaveLength(2);
    const RUN_ID = "run-0001";
    for (const file of artifactFiles) {
      expect(() => assertSafeRelativeName(file.name)).not.toThrow();
      expect(file.body.length).toBeGreaterThan(0);
      // 🔴 名字**不得**自己带角色段：Object Key = `…/{role}/{name}`，
      //    自带前缀会落成 `tables/tables/…`（EXP-001 真机 E2E 实测踩过一次）。
      expect(file.name).not.toMatch(/^(tables|charts|logs|artifacts)\//u);
      // 最终 Key 必须落在该角色段下且在该 Run 之下
      const expectedRole = file.role === "table" ? "tables" : "charts";
      const key =
        file.role === "table"
          ? tableObjectKey(EXPERIMENT_ID, RUN_ID, file.name)
          : chartObjectKey(EXPERIMENT_ID, RUN_ID, file.name);
      expect(key).toBe(`experiments/${EXPERIMENT_ID}/runs/${RUN_ID}/${expectedRole}/${file.name}`);
      expect(isObjectKeyUnderRun(key, EXPERIMENT_ID, RUN_ID)).toBe(true);
      // 实验不得声明绝对路径 / 越界段
      expect(file.name.startsWith("/")).toBe(false);
      expect(file.name).not.toContain("..");
    }
  });

  it("🔴 全仓静态扫描：任何实验定义 / 模板都不得把角色段写进产物 name（`tables/x.csv` 即错）", () => {
    // 本轮缺陷 ④ 的**结构性回归闸**。
    // 单测曾经漏掉这个模式，因为它藏在 `template/experiment.ts` 那次**演示** `artifact()` 调用里，
    // 而没有任何测试真机跑过模板 —— 但模板是**作者面契约**，照它复制的新实验会集体踩坑
    // （EXP-001 真机落成 `tables/tables/x.csv`，Manifest 白名单与实际 Key 不一致）。
    // 这里做**静态扫描**：不需要跑任何实验，直接覆盖 `research-experiments/**` 全部定义与模板。
    // 只扫代码行、跳过注释行 —— 因为「正确做法」的说明里**必须**引用错误写法当反例。
    const root = path.resolve(process.cwd(), "research-experiments");
    const offenders: string[] = [];
    const isCommentLine = (line: string): boolean =>
      /^\s*(\/\/|\/\*|\*|\*\/)/u.test(line);
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/u.test(entry.name)) continue;
        const relative = path.relative(process.cwd(), full).split(path.sep).join("/");
        for (const [index, line] of readFileSync(full, "utf8").split("\n").entries()) {
          if (isCommentLine(line)) continue;
          if (/name:\s*["'`](tables|charts|logs|artifacts)\//u.test(line)) {
            offenders.push(`${relative}:${index + 1} → ${line.trim()}`);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    // 反证：扫描面不是空的（模板 + 各实验定义都必须在扫描范围内）
    expect(readdirSync(root).length).toBeGreaterThan(1);
  });

  it("CSV 产物与信封里的表**同名同源**（表 key + `.csv` 就是声明名）", async () => {
    const { outcome, artifactFiles } = await runMain();
    const tableKeys = outcome.result!.tables!.map((table) => table.key).sort();
    const csvKeys = artifactFiles
      .filter((file) => file.role === "table")
      .map((file) => file.name.replace(/\.csv$/u, ""))
      .sort();
    expect(csvKeys).toEqual(tableKeys);
  });

  it("CSV 是 UTF-8 文本、两行注释 + 表头 + 逐行数据；SVG 自包含且不含外部引用", async () => {
    const { outcome, artifactFiles } = await runMain();
    for (const file of artifactFiles.filter((f) => f.role === "table")) {
      const key = file.name.replace(/\.csv$/u, "");
      const table = tableOf(outcome.result!, key);
      const lines = String(file.body).trimEnd().split("\n");
      // 结构：`# 标题` / `# 说明` / 表头 / 数据行…
      expect(lines).toHaveLength(table.rows.length + 3);
      expect(lines[0]!.startsWith("# ")).toBe(true);
      expect(lines[1]!.startsWith("# ")).toBe(true);
      expect(lines[2]!.split(",")).toHaveLength(table.columns.length);
      // 表头写的是**人读标签**（与页面列名一致），不是内部 key
      for (const label of table.columns.map((column) => column.label)) {
        expect(lines[2]!).toContain(label.includes(",") ? `"${label}"` : label);
      }
      expect(file.contentType).toContain("text/csv");
    }
    for (const file of artifactFiles.filter((f) => f.role === "chart")) {
      const body = String(file.body);
      expect(body.startsWith("<svg")).toBe(true);
      expect(body).toContain("</svg>");
      // 自包含：除 xmlns 命名空间外不得引用任何外部资源（href / <image> / <script>）
      expect(body).not.toMatch(/\b(href|xlink:href)\s*=/u);
      expect(body).not.toContain("<image");
      expect(body).not.toContain("<script");
      expect(file.contentType).toBe("image/svg+xml");
    }
  });

  it("非法产物名字在收集阶段**当场抛**（不等上传阶段），失败 Run 的 artifactFiles 为空", async () => {
    const evil: ExperimentDefinition = {
      ...fundamentalStudyExperiment,
      descriptor: { ...fundamentalStudyExperiment.descriptor, id: "demo/evil-name" },
      run: async (ctx) => {
        ctx.artifact({ name: "../evil.csv", role: "table", body: "x" });
        return { sampleSummary: { candidateCount: 0, eligibleCount: 0, excludedCount: 0, excludedByReason: {} } };
      },
    };
    const registry = new ExperimentRegistry();
    registry.register(evil);
    const port = createRegistryExperimentDatasetPort({
      reader: new InMemoryResearchDatasetReader({ context, events: [], prefixBars: [], postBars: [] }),
    });
    const runner = createExperimentRunner({ registry, datasetPort: port });
    const { outcome, artifactFiles } = await runner.runDetailed({
      experimentId: "demo/evil-name",
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("FAILED");
    expect(outcome.error?.code).toBe("EXPERIMENT_ARTIFACT_KEY_INVALID");
    expect(artifactFiles).toEqual([]);
  });

  it("buildArtifacts 是纯函数：同样的表 ⇒ 同样的字节（可复现）", () => {
    const derived = deriveMain();
    const table = summarizeDailyPath(derived, 5);
    const a = buildArtifacts([table], []);
    const b = buildArtifacts([summarizeDailyPath(deriveMain(), 5)], []);
    expect(a[0]!.body).toBe(b[0]!.body);
    expect(a[0]!.name).toBe("daily_path_by_relative_day.csv");
  });
});

// ---------------------------------------------------------------------------
// 16. Manifest / 页面注册
// ---------------------------------------------------------------------------

describe("EXP-001 · 16. Manifest 与前端页面注册", () => {
  it("本实验在清单里，且前端页面注册表有对应组件（漏登记会降级为通用渲染器）", () => {
    expect(EXPERIMENT_DEFINITIONS.some((d) => d.descriptor.id === EXPERIMENT_ID)).toBe(true);
    expect(EXPERIMENT_PAGES[EXPERIMENT_ID]).toBeDefined();
    expect(experimentPageOf(EXPERIMENT_ID)).not.toBeNull();
  });

  it("清单不出现重复 id（重复注册会让其中一个静默失效）", () => {
    const ids = EXPERIMENT_DEFINITIONS.map((d) => d.descriptor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("清单里的每个实验都声明了真实存在的 datasetCode 与 forwardDataPurpose（有前视数据时）", () => {
    for (const definition of EXPERIMENT_DEFINITIONS) {
      const req = definition.descriptor.datasetRequirement;
      expect(req.datasetCode.length).toBeGreaterThan(0);
      if (req.usesForwardData) expect(req.forwardDataPurpose ?? "").not.toBe("");
    }
  });

  it("pageKey 与 id 一致（页面注册表按 pageKey 索引）", () => {
    expect(fundamentalStudyExperiment.descriptor.pageKey).toBe(fundamentalStudyExperiment.descriptor.id);
  });
});
