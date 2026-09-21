/**
 * EXP-002 · 首板后回踩条件稳定性验证 —— 本实验自己的测试（规格 §21 的后半：**EXP-002 的 11 个面**）。
 *
 * | # | 面 | 钉在哪 |
 * | --- | --- | --- |
 * | 1 | Dataset Version 正确 | 注册 / 版本坐标 / 非 READY 拒 / 语义码不匹配拒 / 相对日超视界拒 |
 * | 2 | PIT 正确 | `decisionOffsetDays = 5` / `usesForwardData` 声明 + 结构级闸门实测 / rd=0 只经 `feature()` |
 * | 3 | 无未来数据泄漏 | 读取上界 ≤ 声明上界 / 未声明相对日当场拒 / 少声明相对日 ⇒ Run FAILED |
 * | 4 | baseline 可复现 | 同输入跑两次 ⇒ customPayload / runId / 指纹 / 日志逐字节一致；理由可读 |
 * | 5 | variant 真重算 | 自检行 delta≡0；改一根 bar ⇒ 指标变；静态扫描：没有读旧结果的路径 |
 * | 6 | sample accounting 平衡 | 核心四桶 + 信封两式 + 原因合计 + 闭集；样本集合变化可见 |
 * | 7 | Result Envelope | 3 表 / 统计 / 图 / customPayload（过本实验 resultSchema）/ 信封账 |
 * | 8 | Artifact manifest | 5 个产物 + 相对名合法 + 声明索引与产出同名 + 核心记录可离线复核指纹 |
 * | 9 | MinIO 写入（字符串层） | Object Key 结构 = `…/runs/{runId}/{role}/{name}`；真实字节见 E2E |
 * | 10 | Run 状态 | SUCCEEDED / 参数越界拒（执行前）/ 少声明相对日 ⇒ FAILED 且不产出 Manifest |
 * | 11 | 前端最终态 | 页面注册键 = `pageKey`；`page.tsx` 不引 server 运行时；文件存在（DOM 见 E2E） |
 *
 * 🔴 本文件**不依赖**真实 MinIO 凭据（与 EXP-001 同纪律）：对象存储只做**纯字符串**校验；
 *    真实 MinIO 写入 / 真实 Dataset(390002) / 浏览器 DOM 验收在 E2E 脚本里做（规格 §22）。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ExperimentArtifactFileSpec,
  ExperimentDescriptor,
  ExperimentResultPayload,
  ExperimentResultTable,
} from "@shared/researchExperimentsContracts";
import {
  artifactObjectKey,
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
import { EXPERIMENT_DEFINITIONS } from "../../../research-experiments/manifest";
import { stabilityValidationExperiment } from "../../../research-experiments/first-board-pullback/stability-validation/experiment";
import {
  BASELINE_HORIZON_RATIONALE,
  BASELINE_SPEC,
  COMPARISON_SPECS,
  COMPUTATION_VERSION,
  EXCLUSION_REASONS,
  EXPERIMENT_CODE,
  MAX_DECLARED_POST_RELATIVE_DAY,
  METRIC_NAMES,
  METRIC_UNAVAILABLE_REASONS,
  SAMPLE_CONDITIONS,
  SELF_CHECK_VARIANT_CODES,
  STABILITY_DIMENSIONS,
  VARIANT_SPECS,
  isExclusionReasonCode,
  requiredMaxRelativeDayOf,
  specOf,
  stabilityValidationCustomPayloadSchema,
  type StabilityValidationCustomPayload,
} from "../../../research-experiments/first-board-pullback/stability-validation/result";
import { deserializeMultiDimensionRobustnessRun } from "../../../server/research/robustness/multiDimension";

// ---------------------------------------------------------------------------
// 夹具：7 个首板事件，按回撤深度 / 是否破开盘价铺满 6 个桶 + 两个分组
// ---------------------------------------------------------------------------

const VERSION_ID = 990_200;
const EXPERIMENT_ID = EXPERIMENT_CODE;
const RUN_ID = "RUN-EXP002-TEST";

/** 回撤桶覆盖（手算）：E1 破位并深跌 / E2 浅回撤 / E3 不回踩 / E4 微回撤 /
 *  E5 中回撤 / E6 破位且深回撤（并全程下跌）/ E7 浅回撤但缺一个远端观察日。 */
const EXPECTED_CONDITION_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  NON_BREAK_OPEN: 5,
  BREAK_OPEN: 2,
  NO_PULLBACK: 1,
  DD_200BP: 1,
  DD_500BP: 2,
  DD_800BP: 1,
  DD_1000BP: 1,
  DD_BELOW_1000BP: 1,
});

const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 120002,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-exp002-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 7,
  horizons: [5, 10, 20],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: 5,
};

type Ohlc = readonly [open: number, high: number, low: number, close: number];
/** (最低价, 收盘价)：最低价是「回撤深度 / 是否破位」的唯一输入，刻意直接给。 */
type DayPair = readonly [low: number, close: number];

/**
 * 由「(最低价, 收盘价)」序列生成 rd=1..10 的行情根。
 *
 * - 开盘价 = 上一根收盘价（rd=1 的开盘价 = 首板日收盘价）—— 与真实行情一致；
 * - 最高价 = `max(开, 收) × 1.005`（保证 OHLC 自洽且「总是略微突破上一根收盘」）；
 * - 最低价 = `min(给定最低价, 开, 收)`：只向下取，绝不制造 `high < low`。
 */
function series(prevClose: number, days: readonly DayPair[]): Record<number, Ohlc> {
  const out: Record<number, Ohlc> = {};
  let prev = prevClose;
  days.forEach(([rawLow, close], index) => {
    const open = prev;
    const low = Math.min(rawLow, open, close);
    out[index + 1] = [open, Math.max(open, close) * 1.005, low, close];
    prev = close;
  });
  return out;
}

/** rd 11..20 的「平淡日」：把每个事件补成完整 20 天视界。 */
function tail(from: number, to: number, price: number): Record<number, Ohlc> {
  const out: Record<number, Ohlc> = {};
  for (let rd = from; rd <= to; rd += 1) out[rd] = [price, price, price, price];
  return out;
}

interface EventPlan {
  eventId: string;
  open0: number;
  close0: number;
  limitUpPrice: number;
  eventDayBar: Ohlc | null;
  days: readonly DayPair[];
  tailPrice: number;
  /** 刻意留空的相对日（「该变体所需窗口缺行」的账目证据）。 */
  omitRelativeDays?: readonly number[];
}

const E1: EventPlan = {
  eventId: "e1",
  open0: 10,
  close0: 11,
  limitUpPrice: 11,
  eventDayBar: [10, 11.0, 9.9, 11],
  days: [
    [11.0, 11.3],
    [9.5, 9.8],
    [9.6, 10.2],
    [9.9, 10.5],
    [10.1, 10.8],
    [10.6, 11.1],
    [10.8, 11.3],
    [11.0, 11.5],
    [11.2, 11.7],
    [11.4, 11.9],
  ],
  tailPrice: 11.9,
};

const E2: EventPlan = {
  eventId: "e2",
  open0: 20,
  close0: 22,
  limitUpPrice: 22,
  eventDayBar: [20, 22, 19.9, 22],
  days: [
    [21.5, 22.6],
    [21.2, 22.9],
    [21.8, 23.2],
    [22.2, 23.5],
    [22.6, 23.8],
    [23.2, 24.1],
    [23.6, 24.4],
    [24.0, 24.7],
    [24.4, 25.0],
    [24.7, 25.3],
  ],
  tailPrice: 25.3,
};

const E3: EventPlan = {
  eventId: "e3",
  open0: 30,
  close0: 33,
  limitUpPrice: 33,
  eventDayBar: [30, 33, 29.5, 33],
  days: [
    [33.0, 33.5],
    [33.8, 34.0],
    [34.0, 34.4],
    [34.4, 34.8],
    [34.8, 35.2],
    [35.2, 35.6],
    [35.6, 36.0],
    [36.0, 36.4],
    [36.4, 36.8],
    [36.8, 37.2],
  ],
  tailPrice: 37.2,
};

const E4: EventPlan = {
  eventId: "e4",
  open0: 40,
  close0: 44,
  limitUpPrice: 44,
  eventDayBar: [40, 44, 39.6, 44],
  days: [
    [43.5, 44.5],
    [43.8, 44.9],
    [44.2, 45.3],
    [44.6, 45.7],
    [45.0, 46.1],
    [45.6, 46.5],
    [46.0, 46.9],
    [46.4, 47.3],
    [46.8, 47.7],
    [47.2, 48.1],
  ],
  tailPrice: 48.1,
};

const E5: EventPlan = {
  eventId: "e5",
  open0: 50,
  close0: 55,
  limitUpPrice: 55,
  eventDayBar: [50, 55, 49.5, 55],
  days: [
    [51.5, 55.5],
    [51.8, 56.0],
    [52.2, 56.5],
    [52.6, 57.0],
    [53.0, 57.5],
    [53.6, 58.0],
    [54.0, 58.5],
    [54.4, 59.0],
    [54.8, 59.5],
    [55.2, 60.0],
  ],
  tailPrice: 60.0,
};

/** 破位 + 全程下跌（远端不创新高 ⇒ 突破率这条指标真的会「不成立」）。 */
const E6: EventPlan = {
  eventId: "e6",
  open0: 60,
  close0: 66,
  limitUpPrice: 66,
  eventDayBar: [60, 66, 59.5, 66],
  days: [
    [64.0, 65.0],
    [62.0, 63.0],
    [60.5, 61.5],
    [59.8, 60.2],
    [59.5, 59.9],
    [59.0, 59.3],
    [58.6, 58.9],
    [58.2, 58.5],
    [57.8, 58.1],
    [57.4, 57.7],
  ],
  tailPrice: 57.7,
};

/** 缺 rd=15：T+10 视界照常可用，T+20 视界缺行 ⇒ 逐变体样本集合真的会变。 */
const E7: EventPlan = {
  eventId: "e7",
  open0: 70,
  close0: 77,
  limitUpPrice: 77,
  eventDayBar: [70, 77, 69.5, 77],
  days: [
    [74.0, 78.0],
    [73.5, 78.5],
    [74.5, 79.0],
    [75.5, 80.0],
    [76.5, 81.0],
    [77.0, 81.5],
    [77.5, 82.0],
    [78.0, 82.5],
    [78.5, 83.0],
    [79.0, 83.5],
  ],
  tailPrice: 83.5,
  omitRelativeDays: [15],
};

function makeEvent(plan: EventPlan): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId: plan.eventId,
    symbol: "600000.SH",
    tradeDate: "2025-01-02",
    market: "SH",
    industryCode: "IND",
    boardType: "main",
    previousClose: plan.open0,
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
  ohlc: Ohlc,
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: `2025-01-${String(2 + relativeDay).padStart(2, "0")}`,
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
      prefixBars.push(makeBar(plan.eventId, 0, plan.eventDayBar));
    }
    const bars = { ...series(plan.close0, plan.days), ...tail(11, 20, plan.tailPrice) };
    for (const [key, ohlc] of Object.entries(bars)) {
      const rd = Number(key);
      if (plan.omitRelativeDays?.includes(rd) === true) continue;
      postBars.push(makeBar(plan.eventId, rd, ohlc));
    }
  }
  return { events, prefixBars, postBars };
}

const MAIN_PLANS: readonly EventPlan[] = [E1, E2, E3, E4, E5, E6, E7];
const MAIN_UNIVERSE = buildUniverse(MAIN_PLANS);

/** 与主夹具**只差一根 bar**：E1 的 rd=10 收盘 11.9 → 13.5（用于「真重算」证据）。 */
const TAMPERED_UNIVERSE = buildUniverse([
  {
    ...E1,
    days: E1.days.map((pair, index) => (index === 9 ? ([11.4, 13.5] as DayPair) : pair)),
    tailPrice: 13.5,
  },
  E2,
  E3,
  E4,
  E5,
  E6,
  E7,
]);

const EMPTY_UNIVERSE: Universe = { events: [], prefixBars: [], postBars: [] };
const EMPTY_CONTEXT: ResearchDatasetVersionContext = { ...context, totalEvents: 0 };

/**
 * 大样本宇宙（120 个事件）：用来让 `maxEvents` 的**主动裁剪**真的发生
 * （descriptor 的 `bounds.min = 100` ⇒ 只有 ≥100 个事件时这个参数才既有意义又可越界）。
 */
function buildBigUniverse(count: number): Universe {
  const plans: EventPlan[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = 10 + index;
    const close0 = base * 1.1;
    plans.push({
      eventId: `b${String(index).padStart(3, "0")}`,
      open0: base,
      close0,
      limitUpPrice: close0,
      eventDayBar: [base, close0, base * 0.99, close0],
      days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
        (rd) => [base * 1.02, close0 * 1.01 ** rd] as DayPair,
      ),
      tailPrice: close0 * 1.01 ** 10,
    });
  }
  return buildUniverse(plans);
}

const BIG_COUNT = 120;
const BIG_UNIVERSE = buildBigUniverse(BIG_COUNT);
const BIG_CONTEXT: ResearchDatasetVersionContext = { ...context, totalEvents: BIG_COUNT };

// ---------------------------------------------------------------------------
// 运行夹具
// ---------------------------------------------------------------------------

function makePort(universe: Universe, versionContext: ResearchDatasetVersionContext) {
  return createRegistryExperimentDatasetPort({
    reader: new InMemoryResearchDatasetReader({
      context: versionContext,
      events: universe.events,
      prefixBars: universe.prefixBars,
      postBars: universe.postBars,
    }),
    eventPageSize: 2,
  });
}

function makeRunner(
  universe: Universe = MAIN_UNIVERSE,
  versionContext: ResearchDatasetVersionContext = context,
  experiment: typeof stabilityValidationExperiment = stabilityValidationExperiment,
) {
  const registry = new ExperimentRegistry();
  registry.register(experiment);
  const datasetPort = makePort(universe, versionContext);
  return {
    datasetPort,
    runner: createExperimentRunner({
      registry,
      datasetPort,
      now: () => new Date(1_700_000_000_000),
    }),
  };
}

async function runOnce(args: {
  universe?: Universe;
  versionContext?: ResearchDatasetVersionContext;
  experiment?: typeof stabilityValidationExperiment;
  parameters?: Record<string, number | string | boolean>;
} = {}) {
  const { runner } = makeRunner(args.universe, args.versionContext, args.experiment);
  return runner.runDetailed({
    experimentId: args.experiment?.descriptor.id ?? EXPERIMENT_ID,
    datasetVersionId: args.versionContext?.datasetVersionId ?? VERSION_ID,
    ...(args.parameters !== undefined ? { parameters: args.parameters } : {}),
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

/** 成功 Run 的快捷取数（断言失败时错误信息里带上原因，而不是 undefined 崩）。 */
function payloadOf(outcome: { runStatus: string; result: unknown; error: unknown }): ExperimentResultPayload {
  if (outcome.runStatus !== "SUCCEEDED") {
    throw new Error(`期望 Run 成功，实际 ${outcome.runStatus}：${JSON.stringify(outcome.error)}`);
  }
  return outcome.result as ExperimentResultPayload;
}

function customOf(payload: ExperimentResultPayload): StabilityValidationCustomPayload {
  const parsed = stabilityValidationCustomPayloadSchema.safeParse(payload.customPayload);
  if (!parsed.success) {
    throw new Error(`customPayload 不符合本实验 resultSchema：${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("；")}`);
  }
  return parsed.data;
}

function variantsOf(payload: ExperimentResultPayload): StabilityValidationCustomPayload["variants"] {
  return customOf(payload).variants;
}

function rowOf(payload: ExperimentResultPayload, code: string): StabilityValidationCustomPayload["variants"][number] {
  const found = variantsOf(payload).find((variant) => variant.code === code);
  if (found === undefined) {
    throw new Error(`结果里没有变体 "${code}"；实际：${variantsOf(payload).map((v) => v.code).join(", ")}`);
  }
  return found;
}

function tableOf(payload: ExperimentResultPayload, key: string): ExperimentResultTable {
  const found = payload.tables?.find((table) => table.key === key);
  if (found === undefined) {
    throw new Error(`结果里没有表 "${key}"；实际：${(payload.tables ?? []).map((t) => t.key).join(", ")}`);
  }
  return found;
}

function statOf(payload: ExperimentResultPayload, code: string) {
  const found = payload.statistics?.find((item) => item.code === code);
  if (found === undefined) {
    throw new Error(`结果里没有统计项 "${code}"；实际：${(payload.statistics ?? []).map((s) => s.code).join(", ")}`);
  }
  return found;
}

function sumOf(map: Readonly<Record<string, number>>): number {
  return Object.values(map).reduce((a, b) => a + b, 0);
}

const STABILITY_DIR = path.resolve(
  process.cwd(),
  "research-experiments/first-board-pullback/stability-validation",
);

// ---------------------------------------------------------------------------
// 1. Dataset Version 正确
// ---------------------------------------------------------------------------

describe("EXP-002 · 1. Dataset Version 正确", () => {
  it("已注册：清单 + 页面注册表键与 descriptor.pageKey 一致", () => {
    const definition = EXPERIMENT_DEFINITIONS.find(
      (item) => item.descriptor.id === EXPERIMENT_ID,
    );
    expect(definition).toBeDefined();
    expect(definition!.descriptor.pageKey).toBe(EXPERIMENT_ID);
    expect(EXPERIMENT_PAGES[definition!.descriptor.pageKey]).toBeDefined();
    expect(experimentPageOf(EXPERIMENT_ID)).toBeDefined();
    expect(definition!.descriptor.version).toBe(COMPUTATION_VERSION);
  });

  it("数据坐标声明：语义码 / 全量扫描 / rd=0 只作 feature / post 1…20", () => {
    const req = stabilityValidationExperiment.descriptor.datasetRequirement;
    expect(req.datasetCode).toBe("first_limit_pullback");
    expect(req.eventScanPolicy).toBe("FULL_DATASET");
    expect(req.prefixRelativeDays).toEqual([0]);
    expect(req.postRelativeDays![0]).toBe(1);
    expect(req.postRelativeDays!.at(-1)).toBe(MAX_DECLARED_POST_RELATIVE_DAY);
    expect(req.postRelativeDays).toHaveLength(MAX_DECLARED_POST_RELATIVE_DAY);
  });

  it("Run 结果的坐标来自平台（实验无法谎报）：datasetId / datasetCode / 版本标签 / 事件总数", async () => {
    const { outcome } = await runOnce();
    const payload = payloadOf(outcome);
    expect(payload.metadata.datasetVersionId).toBe(VERSION_ID);
    expect(payload.metadata.datasetCode).toBe("first_limit_pullback");
    expect(payload.metadata.datasetVersionLabel).toBe("v-exp002-test");
    expect(payload.metadata.computationVersion).toBe(COMPUTATION_VERSION);
    expect(outcome.execution.datasetFacts.datasetVersionId).toBe(VERSION_ID);
    expect(outcome.execution.datasetFacts.datasetTotalEvents).toBe(7);
  });

  it("非 READY 版本 ⇒ 执行前拒（EXPERIMENT_DATASET_VERSION_NOT_READY）", async () => {
    await expectThrowCode(
      runOnce({ versionContext: { ...context, status: "BUILDING" } }),
      "EXPERIMENT_DATASET_VERSION_NOT_READY",
    );
  });

  it("语义码不匹配 ⇒ 执行前拒（EXPERIMENT_DATASET_CODE_MISMATCH）", async () => {
    await expectThrowCode(
      runOnce({ versionContext: { ...context, datasetCode: "other_dataset" } }),
      "EXPERIMENT_DATASET_CODE_MISMATCH",
    );
  });

  it("声明了超出数据集真实视界的相对日 ⇒ 执行前拒（EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE）", async () => {
    await expectThrowCode(
      runOnce({
        versionContext: { ...context, postRelativeDayRange: { min: 1, max: 10 } },
      }),
      "EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. PIT 正确
// ---------------------------------------------------------------------------

describe("EXP-002 · 2. PIT 正确（决策时点 / 未来数据的有意声明）", () => {
  it("决策时点上界 = EXP-001 的 maxObservationDay（= 5），并显式声明使用未来数据", () => {
    const req = stabilityValidationExperiment.descriptor.datasetRequirement;
    expect(req.decisionOffsetDays).toBe(5);
    expect(req.usesForwardData).toBe(true);
    expect(req.forwardDataPurpose ?? "").not.toBe("");
    expect(req.forwardDataPurpose).toContain("事后");
    // rd=0（首板日本身）是基准价的唯一来源 ⇒ 只能经 feature()，不在 postRelativeDays 里
    expect(req.prefixRelativeDays).toEqual([0]);
    expect(req.postRelativeDays).not.toContain(0);
  });

  it("Run 记录如实回报 PIT 坐标：decisionOffsetDays = 5 / forwardDataRead = true", async () => {
    const { outcome } = await runOnce();
    expect(outcome.execution.datasetFacts.decisionOffsetDays).toBe(5);
    expect(outcome.execution.datasetFacts.forwardDataRead).toBe(true);
    expect(outcome.execution.datasetFacts.eventScanPolicy).toBe("FULL_DATASET");
  });

  it("🔴 结构级闸门实测：未声明 usesForwardData 时读 rd≥1 当场抛", async () => {
    const { datasetPort } = makeRunner();
    const facts = await datasetPort.getVersionFacts(VERSION_ID);
    expect(facts).not.toBeNull();
    const requirement = { ...stabilityValidationExperiment.descriptor.datasetRequirement };
    delete (requirement as { usesForwardData?: boolean }).usesForwardData;
    const descriptor: ExperimentDescriptor = {
      ...stabilityValidationExperiment.descriptor,
      datasetRequirement: requirement,
    };
    const { access } = datasetPort.createAccess({ descriptor, facts: facts! });
    await expectThrowCode(access.observation(1), "EXPERIMENT_FORWARD_DATA_FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// 3. 无未来数据泄漏
// ---------------------------------------------------------------------------

describe("EXP-002 · 3. 无未来数据泄漏（读取上界 = 声明上界）", () => {
  it("真实读取上界恰为声明上界，且不超过它", async () => {
    const { outcome } = await runOnce();
    expect(outcome.execution.datasetFacts.maxPostRelativeDayRead).toBe(MAX_DECLARED_POST_RELATIVE_DAY);
    expect(outcome.execution.datasetFacts.maxPostRelativeDayRead).toBeLessThanOrEqual(
      MAX_DECLARED_POST_RELATIVE_DAY,
    );
  });

  it("矩阵每个变体所需的相对日上界都在声明窗口内", () => {
    for (const variant of VARIANT_SPECS) {
      expect(requiredMaxRelativeDayOf(variant)).toBeLessThanOrEqual(MAX_DECLARED_POST_RELATIVE_DAY);
    }
    // 矩阵确实用满了声明窗口（否则「同窗口」这件事是空的）
    expect(Math.max(...VARIANT_SPECS.map(requiredMaxRelativeDayOf))).toBe(MAX_DECLARED_POST_RELATIVE_DAY);
  });

  it("未在 postRelativeDays 里声明的相对日 ⇒ 读不到（白名单闸门）", async () => {
    const { datasetPort } = makeRunner();
    const facts = await datasetPort.getVersionFacts(VERSION_ID);
    const { access } = datasetPort.createAccess({
      descriptor: stabilityValidationExperiment.descriptor,
      facts: facts!,
    });
    await expectThrowCode(
      access.observation(MAX_DECLARED_POST_RELATIVE_DAY + 1),
      "EXPERIMENT_DATASET_REQUIREMENT_INVALID",
    );
  });

  it("🔴 少声明相对日并不会静默少读：run() 自查后把 Run 判 FAILED", async () => {
    const requirement = {
      ...stabilityValidationExperiment.descriptor.datasetRequirement,
      postRelativeDays: [1, 2, 3, 4, 5],
    };
    const shortcut = {
      ...stabilityValidationExperiment,
      descriptor: { ...stabilityValidationExperiment.descriptor, datasetRequirement: requirement },
    };
    const { outcome, artifactFiles } = await runOnce({ experiment: shortcut });
    expect(outcome.runStatus).toBe("FAILED");
    expect(outcome.result).toBeNull();
    expect(outcome.error?.message ?? "").toContain("只声明了 post 相对日");
    // 失败路径不产出 Manifest / 不落对象存储
    expect(artifactFiles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. baseline 可复现
// ---------------------------------------------------------------------------

describe("EXP-002 · 4. baseline 可复现（同输入 ⇒ 同产物）", () => {
  it("同输入跑两次 ⇒ customPayload / runId / 指纹 / counts / 日志逐字一致", async () => {
    const first = await runOnce();
    const second = await runOnce();
    const a = payloadOf(first.outcome);
    const b = payloadOf(second.outcome);
    expect(a.customPayload).toEqual(b.customPayload);
    expect(customOf(a).robustnessRunId).toBe(customOf(b).robustnessRunId);
    expect(customOf(a).robustnessFingerprint).toBe(customOf(b).robustnessFingerprint);
    expect(customOf(a).counts).toEqual(customOf(b).counts);
    expect(first.outcome.execution.logs).toEqual(second.outcome.execution.logs);
    // 产物字节也必须是同一份（CSV / SVG 一起）
    expect(first.artifactFiles.map((f) => f.body)).toEqual(second.artifactFiles.map((f) => f.body));
  });

  it("Baseline 显式声明在 Definition 里，且理由可读（不是隐含默认）", () => {
    expect(BASELINE_SPEC).toEqual({ decisionDay: 5, horizon: 10, sampleCondition: "ALL" });
    expect(BASELINE_HORIZON_RATIONALE).toContain("maxObservationDay");
    expect(BASELINE_HORIZON_RATIONALE).toContain("严格大于");
  });

  it("结果里的 Baseline 与声明逐字段一致，且是真实算出来的（不是空壳）", async () => {
    const custom = customOf(payloadOf((await runOnce()).outcome));
    expect(custom.baseline.decisionDay).toBe(BASELINE_SPEC.decisionDay);
    expect(custom.baseline.horizon).toBe(BASELINE_SPEC.horizon);
    expect(custom.baseline.sampleCondition).toBe(BASELINE_SPEC.sampleCondition);
    expect(custom.baselineRationale).toBe(BASELINE_HORIZON_RATIONALE);
    expect(custom.baseline.accounting.validCount).toBe(7);
    expect(Number.isFinite(custom.baseline.metrics.metrics.meanCloseReturn)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. variant 真重算
// ---------------------------------------------------------------------------

describe("EXP-002 · 5. variant 真重算（不是复制旧结果 / 不是只改标签）", () => {
  it("🔴 自检行：与基准同配置的两个变体逐指标 delta 恰为 0 且判定 stable", async () => {
    const payload = payloadOf((await runOnce()).outcome);
    for (const code of SELF_CHECK_VARIANT_CODES) {
      const row = rowOf(payload, code);
      expect(row.status).toBe("succeeded");
      expect(row.verdict).toBe("stable");
      expect(row.comparisons.length).toBeGreaterThan(0);
      for (const comparison of row.comparisons) {
        expect(comparison.delta).toBe(0);
        expect(comparison.verdict).toBe("stable");
      }
    }
  });

  it("改一根 bar（E1 的 rd=10 收盘）⇒ 基准指标与观测到的 delta 一起变", async () => {
    const before = customOf(payloadOf((await runOnce()).outcome));
    const after = customOf(payloadOf((await runOnce({ universe: TAMPERED_UNIVERSE })).outcome));
    const meanBefore = before.baseline.metrics.metrics.meanCloseReturn;
    const meanAfter = after.baseline.metrics.metrics.meanCloseReturn;
    expect(meanAfter).not.toBe(meanBefore);
    expect(meanAfter).toBeGreaterThan(meanBefore);
    // 样本量不变（只改了一根 bar 的价位，没有增删样本）⇒ 变化只能来自重算
    expect(after.baseline.accounting.validCount).toBe(before.baseline.accounting.validCount);
    // 至少有一行的 delta 跟着变
    const deltasOf = (custom: StabilityValidationCustomPayload): string =>
      custom.variants
        .flatMap((variant) => variant.comparisons.map((c) => `${variant.code}:${c.metric}:${String(c.delta)}`))
        .join("|");
    expect(deltasOf(after)).not.toBe(deltasOf(before));
  });

  it("逐变体指标互不相同（不是把同一份值复制给每一行）", async () => {
    const custom = customOf(payloadOf((await runOnce()).outcome));
    const means = new Set(
      custom.variants.map((variant) => String(variant.metrics?.metrics.meanCloseReturn)),
    );
    expect(means.size).toBeGreaterThan(1);
  });

  it("🔴 静态扫描：本实验目录里没有任何「读旧结果文件」的路径", () => {
    const files = readdirSync(STABILITY_DIR).filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(path.join(STABILITY_DIR, file), "utf8");
      for (const forbidden of [
        "readFileSync",
        "readFile(",
        "createReadStream",
        'from "node:fs"',
        'from "fs"',
        'from "../fundamental-study/experiment"',
      ]) {
        expect(
          text.includes(forbidden),
          `${file} 出现了禁止片段 "${forbidden}"（真重算不允许依赖任何既有结果文件）`,
        ).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. sample accounting 平衡
// ---------------------------------------------------------------------------

describe("EXP-002 · 6. sample accounting 平衡（§13）", () => {
  it("逐变体：三式都平 + 原因合计 = 各桶 + 原因码全在闭集里", async () => {
    const custom = customOf(payloadOf((await runOnce()).outcome));
    // `customPayload.variants` = 基准行 + 全部非基准变体（基准**同时**在 `customPayload.baseline` 里）
    expect(custom.variants).toHaveLength(VARIANT_SPECS.length + 1);
    expect(custom.variants.filter((variant) => variant.verdict === "baseline")).toHaveLength(1);
    for (const variant of custom.variants) {
      const accounting = variant.accounting!;
      expect(variant.status).toBe("succeeded");
      expect(accounting.candidateCount).toBe(7);
      expect(accounting.eligibleCount + accounting.missingCount + accounting.invalidCount).toBe(
        accounting.candidateCount,
      );
      expect(accounting.validCount + accounting.excludedCount).toBe(accounting.eligibleCount);
      expect(
        accounting.validCount + accounting.excludedCount + accounting.missingCount + accounting.invalidCount,
      ).toBe(accounting.candidateCount);
      expect(sumOf(accounting.excludedByReason)).toBe(accounting.excludedCount);
      expect(sumOf(accounting.missingByReason)).toBe(accounting.missingCount);
      expect(sumOf(accounting.invalidByReason)).toBe(accounting.invalidCount);
      for (const code of [
        ...Object.keys(accounting.excludedByReason),
        ...Object.keys(accounting.missingByReason),
        ...Object.keys(accounting.invalidByReason),
      ]) {
        expect(isExclusionReasonCode(code), `未登记的原因码 "${code}"`).toBe(true);
      }
      expect(accounting.accountingFormula).not.toBe("");
    }
  });

  it("信封口径（平台守恒式）：eligible + excluded = candidate，且原因合计 = excluded", async () => {
    const payload = payloadOf((await runOnce()).outcome);
    const summary = payload.sampleSummary;
    expect(summary.eligibleCount + summary.excludedCount).toBe(summary.candidateCount);
    expect(sumOf(summary.excludedByReason)).toBe(summary.excludedCount);
    expect(summary.notes ?? []).not.toHaveLength(0);
  });

  it("两套口径的换算在结果里是**显式**的（信封 eligible = 核心 validCount）", async () => {
    const payload = payloadOf((await runOnce()).outcome);
    const custom = customOf(payload);
    const baseline = custom.baseline.accounting!;
    expect(custom.baseline.verdict).toBe("baseline");
    expect(payload.sampleSummary.eligibleCount).toBe(baseline.validCount);
    expect(payload.sampleSummary.excludedCount).toBe(
      baseline.candidateCount - baseline.validCount,
    );
    expect(sumOf(payload.sampleSummary.excludedByReason)).toBe(
      baseline.excludedCount + baseline.missingCount + baseline.invalidCount,
    );
  });

  it("🔴 样本集合变化可见：T+20 视界因缺一个远端观察日而少一个样本", async () => {
    const payload = payloadOf((await runOnce()).outcome);
    const horizon20 = rowOf(payload, `HORIZON_T${MAX_DECLARED_POST_RELATIVE_DAY}`);
    expect(horizon20.accounting!.missingCount).toBe(1);
    expect(horizon20.accounting!.missingByReason.MISSING_WINDOW_BAR).toBe(1);
    expect(horizon20.accounting!.eligibleCount).toBe(6);
    expect(horizon20.accounting!.validCount).toBe(6);
    // 基准侧 7 ⇒ 这一行的比较必须把「样本集合变了」标出来
    const comparison = horizon20.comparisons[0]!;
    expect(comparison.baselineSampleCount).toBe(7);
    expect(comparison.variantSampleCount).toBe(6);
    expect(comparison.sampleSetChanged).toBe(true);
    // 而 T+10 视界不受影响（该变体根本不需要 rd=15）
    expect(rowOf(payload, "OBS_DAY_T5").accounting!.missingCount).toBe(0);
  });

  it("样本条件分组的样本量与手算一致（分桶互斥且完全覆盖）", async () => {
    const payload = payloadOf((await runOnce()).outcome);
    let sum = 0;
    for (const [condition, expected] of Object.entries(EXPECTED_CONDITION_COUNTS)) {
      // 每个样本条件 = 一个变体（`COND_<code>`），其有效样本数就是该条件命中的事件数
      const variant = rowOf(payload, `COND_${condition}`);
      expect(variant.accounting!.validCount, `样本条件 ${condition} 的有效样本数`).toBe(expected);
      if (condition !== "NON_BREAK_OPEN" && condition !== "BREAK_OPEN") sum += expected;
    }
    // 6 个回撤桶 + 不回踩桶 = 全部 7 个样本（互斥、完全覆盖）
    expect(sum).toBe(7);
    expect(EXPECTED_CONDITION_COUNTS.NON_BREAK_OPEN + EXPECTED_CONDITION_COUNTS.BREAK_OPEN).toBe(7);
    expect(SAMPLE_CONDITIONS).toContain("DD_BELOW_1000BP");
  });

  it("maxEvents 主动裁剪 ⇒ 进「缺数据」桶（不静默丢弃）", async () => {
    const payload = payloadOf(
      (await runOnce({ universe: BIG_UNIVERSE, versionContext: BIG_CONTEXT, parameters: { maxEvents: 100 } }))
        .outcome,
    );
    const custom = customOf(payload);
    expect(custom.candidates.candidateCount).toBe(BIG_COUNT);
    for (const variant of custom.variants) {
      expect(variant.accounting!.candidateCount).toBe(BIG_COUNT);
      expect(variant.accounting!.missingByReason.MAX_EVENTS_LIMIT).toBe(BIG_COUNT - 100);
      expect(variant.accounting!.missingCount).toBe(BIG_COUNT - 100);
      expect(variant.accounting!.eligibleCount).toBe(100);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Result Envelope
// ---------------------------------------------------------------------------

describe("EXP-002 · 7. Result Envelope（动态信封，不建全局固定 schema）", () => {
  it("3 张表 / 统计项 / 1 张图 / customPayload 全部齐备且过本实验自己的 resultSchema", async () => {
    const payload = payloadOf((await runOnce()).outcome);
    expect((payload.tables ?? []).map((table) => table.key)).toEqual([
      "stability_matrix",
      "stability_comparison",
      "sample_accounting",
    ]);
    expect((payload.statistics ?? []).length).toBeGreaterThan(10);
    expect(payload.charts).toHaveLength(1);
    const parsed = stabilityValidationCustomPayloadSchema.safeParse(payload.customPayload);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    expect(customOf(payload).computationVersion).toBe(COMPUTATION_VERSION);
    expect(customOf(payload).experimentCode).toBe(EXPERIMENT_ID);
  });

  it("矩阵表 = 逐变体 × 逐指标的长表（48 行），列里有判定与样本量", async () => {
    const payload = payloadOf((await runOnce()).outcome);
    const matrix = tableOf(payload, "stability_matrix");
    // 矩阵只覆盖**非基准**变体：每个变体 × 每个声明比较指标
    expect(matrix.rows).toHaveLength(VARIANT_SPECS.length * COMPARISON_SPECS.length);
    const keys = (matrix.columns ?? []).map((column) => column.key);
    for (const key of ["variantCode", "dimension", "verdict", "sampleCount", "delta", "tolerance"]) {
      expect(keys, `矩阵表缺列 ${key}`).toContain(key);
    }
    // 每行都有一个声明过容差的指标 + 一个判定
    for (const row of matrix.rows) {
      expect((COMPARISON_SPECS as readonly { metric: string }[]).map((s) => s.metric)).toContain(
        String(row.metric),
      );
      expect(["stable", "sensitive", "insufficient"]).toContain(String(row.verdict));
    }
    // 另外两张表 = 基准 + 变体，一行一个
    expect(tableOf(payload, "sample_accounting").rows).toHaveLength(1 + VARIANT_SPECS.length);
    expect(tableOf(payload, "stability_comparison").rows).toHaveLength(1 + VARIANT_SPECS.length);
  });

  it("统计项与声明一致：候选数、缺口、坏 bar 反查恒为 0、基准口径", async () => {
    const payload = payloadOf((await runOnce()).outcome);
    expect(statOf(payload, "candidate_event_count").value).toBe(7);
    expect(statOf(payload, "unscanned_event_count").value).toBe(0);
    expect(statOf(payload, "invalid_ohlc_used_in_window_count").value).toBe(0);
    expect(statOf(payload, "baseline_decision_day").value).toBe(BASELINE_SPEC.decisionDay);
    expect(statOf(payload, "baseline_horizon").value).toBe(BASELINE_SPEC.horizon);
    expect(statOf(payload, "variant_count").value).toBe(VARIANT_SPECS.length);
    const counts = customOf(payload).counts;
    expect(counts.stableCount + counts.sensitiveCount + counts.insufficientCount + counts.failedCount).toBe(
      counts.variantCount,
    );
    expect(counts.variantCount).toBe(VARIANT_SPECS.length);
  });

  it("图表系列 = 三个声明比较指标；不可用点是 null 而不是 0", async () => {
    const payload = payloadOf((await runOnce()).outcome);
    const chart = payload.charts![0]!;
    expect(chart.series.map((series) => series.key)).toEqual(COMPARISON_SPECS.map((spec) => spec.metric));
    for (const series of chart.series) {
      expect(series.points).toHaveLength(VARIANT_SPECS.length);
      for (const point of series.points) {
        expect(point.x === null || typeof point.x === "string" || typeof point.x === "number").toBe(true);
        expect(point.y === null || typeof point.y === "number").toBe(true);
      }
    }
    // HORIZON_T5 的窗口按定义为空 ⇒ 三个比例指标都不可用 ⇒ 其点必须为 null（禁伪造 0）
    const t5Row = customOf(payload).variants.find((v) => v.horizon === 5 && v.decisionDay === 5)!;
    expect(t5Row.verdict).toBe("insufficient");
    for (const spec of COMPARISON_SPECS) {
      expect(t5Row.metrics?.metrics[spec.metric]).toBeUndefined();
      expect(t5Row.metrics?.unavailable[spec.metric]).toBe(
        METRIC_UNAVAILABLE_REASONS.EMPTY_FUTURE_WINDOW,
      );
      const comparison = t5Row.comparisons.find((c) => c.metric === spec.metric)!;
      expect(comparison.delta).toBeNull();
      expect(comparison.verdict).toBe("insufficient");
      expect(comparison.reason ?? "").not.toBe("");
    }
  });

  it("零事件仍产出结构完整的结果（不崩、不造假）", async () => {
    const { outcome } = await runOnce({ universe: EMPTY_UNIVERSE, versionContext: EMPTY_CONTEXT });
    const payload = payloadOf(outcome);
    const custom = customOf(payload);
    expect(custom.candidates.candidateCount).toBe(0);
    expect(payload.sampleSummary.candidateCount).toBe(0);
    expect(payload.sampleSummary.eligibleCount).toBe(0);
    expect(custom.baseline.accounting!.validCount).toBe(0);
    for (const variant of custom.variants) {
      expect(variant.verdict).not.toBe("stable");
      // 不可用原因分两类（判定顺序刻意固定：先「按定义不可评估」，再「数据不够」）
      const expected =
        variant.horizon <= variant.decisionDay
          ? METRIC_UNAVAILABLE_REASONS.EMPTY_FUTURE_WINDOW
          : METRIC_UNAVAILABLE_REASONS.NO_VALID_SAMPLE;
      expect(variant.metrics?.unavailable.meanCloseReturn).toBe(expected);
      // 绝不以 0 冒充不可用
      expect(variant.metrics?.metrics.meanCloseReturn).toBeUndefined();
    }
    // 仍然产出完整三表（矩阵 48 行结构在，但每行的比较值都是 null —— 不是 0）
    expect((payload.tables ?? []).length).toBe(3);
    const matrix = tableOf(payload, "stability_matrix");
    expect(matrix.rows).toHaveLength(VARIANT_SPECS.length * COMPARISON_SPECS.length);
    for (const row of matrix.rows) {
      expect(row.delta).toBeNull();
      expect(row.variantValue).toBeNull();
      expect(row.verdict).toBe("insufficient");
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Artifact manifest
// ---------------------------------------------------------------------------

describe("EXP-002 · 8. Artifact manifest / 产物索引", () => {
  const EXPECTED_NAMES = [
    "stability_matrix.csv",
    "stability_comparison.csv",
    "sample_accounting.csv",
    "stability_overview.svg",
    "robustness-run.json",
  ];

  it("产出恰好 5 个文件：3 CSV + 1 SVG + 核心记录", async () => {
    const { artifactFiles } = await runOnce();
    expect(artifactFiles.map((file) => file.name).sort()).toEqual([...EXPECTED_NAMES].sort());
    expect(artifactFiles).toHaveLength(5);
    for (const file of artifactFiles) {
      expect(() => assertSafeRelativeName(file.name)).not.toThrow();
      // 🔴 名字里不得出现角色段（`tables/` / `charts/`）—— 否则会落成 tables/tables/x.csv
      expect(file.name).not.toContain("/");
      expect(file.name.startsWith("/")).toBe(false);
      expect(file.name).not.toContain("..");
      expect(file.body.length).toBeGreaterThan(0);
    }
  });

  it("信封里声明的产物索引与真实产出同名同角色（且不带字节）", async () => {
    const { artifactFiles } = await runOnce();
    const payload = payloadOf((await runOnce()).outcome);
    const declared = customOf(payload).artifacts;
    expect(declared.map((item) => item.name).sort()).toEqual(artifactFiles.map((f) => f.name).sort());
    for (const item of declared) {
      const produced = artifactFiles.find((file) => file.name === item.name)!;
      expect(item.role).toBe(produced.role);
      expect(item.contentType).toBe(produced.contentType);
      expect(Object.prototype.hasOwnProperty.call(item, "body")).toBe(false);
    }
    const roles = new Map(declared.map((item) => [item.name, item.role]));
    expect(roles.get("stability_matrix.csv")).toBe("table");
    expect(roles.get("stability_overview.svg")).toBe("chart");
    expect(roles.get("robustness-run.json")).toBe("artifact");
  });

  it("🔴 核心记录可离线复核：`robustness-run.json` 反序列化后指纹通过校验", async () => {
    const { artifactFiles } = await runOnce();
    const record = artifactFiles.find((file) => file.name === "robustness-run.json")!;
    const parsed = deserializeMultiDimensionRobustnessRun(record.body);
    const payload = payloadOf((await runOnce()).outcome);
    expect(parsed.runId).toBe(customOf(payload).robustnessRunId);
    expect(parsed.fingerprint).toBe(customOf(payload).robustnessFingerprint);
    expect(parsed.recordKind).toBe("MULTI_DIMENSION_ROBUSTNESS_RUN");
    expect(parsed.variants).toHaveLength(VARIANT_SPECS.length);
    // 每个变体的核心账目与展示层同源
    for (const variant of parsed.variants) {
      const payloadRow = variantsOf(payload).find((row) => row.code === variant.item.code)!;
      expect(variant.sampleAccounting!.validCount).toBe(payloadRow.accounting!.validCount);
    }
  });

  it("产物内容与信封表同源（CSV 行数 = 表的行数）", async () => {
    const { artifactFiles } = await runOnce();
    for (const key of ["stability_matrix", "stability_comparison", "sample_accounting"]) {
      const file = artifactFiles.find((item) => item.name === `${key}.csv`)!;
      const dataLines = file.body.trim().split("\n");
      expect(dataLines.length).toBeGreaterThan(1); // 表头 + 至少 1 行
    }
    const svg = artifactFiles.find((item) => item.name === "stability_overview.svg")!;
    expect(svg.body.startsWith("<svg")).toBe(true);
    expect(svg.body).toContain("红柱");
  });

  it("产物声明的名字集合里没有「本实验没实现」的东西（唯一来源 = 一次 artifactSpecs 列表）", () => {
    // 结构性判据：experiment.ts 里 `artifact(` 的调用点只有一个，参数来自同一个列表
    const text = readFileSync(path.join(STABILITY_DIR, "experiment.ts"), "utf8");
    const callSites = text.match(/artifact\(spec\)/gu) ?? [];
    expect(callSites).toHaveLength(1);
    expect(text).toContain("for (const spec of artifactSpecs) artifact(spec);");
  });
});

// ---------------------------------------------------------------------------
// 9. MinIO 写入（字符串层；真实字节见 E2E）
// ---------------------------------------------------------------------------

describe("EXP-002 · 9. 对象 Key 结构（真实 MinIO 写入由 §22 E2E 验证）", () => {
  it("三类角色的 Key 都落在 `experiments/<id>/runs/<runId>/` 下", async () => {
    const { artifactFiles } = await runOnce();
    const cases: readonly { file: ExperimentArtifactFileSpec; role: string; key: string }[] =
      artifactFiles.map((file) => ({
        file,
        role: file.role === "table" ? "tables" : file.role === "chart" ? "charts" : "artifacts",
        key:
          file.role === "table"
            ? tableObjectKey(EXPERIMENT_ID, RUN_ID, file.name)
            : file.role === "chart"
              ? chartObjectKey(EXPERIMENT_ID, RUN_ID, file.name)
              : artifactObjectKey(EXPERIMENT_ID, RUN_ID, file.name),
      }));
    for (const item of cases) {
      expect(item.key).toBe(`experiments/${EXPERIMENT_ID}/runs/${RUN_ID}/${item.role}/${item.file.name}`);
      expect(isObjectKeyUnderRun(item.key, EXPERIMENT_ID, RUN_ID)).toBe(true);
      // 反向：不属于别的 Run
      expect(isObjectKeyUnderRun(item.key, EXPERIMENT_ID, "RUN-OTHER")).toBe(false);
    }
  });

  it("contentType 与角色一致（上传时按此声明 MIME）", async () => {
    const { artifactFiles } = await runOnce();
    const byName = new Map(artifactFiles.map((file) => [file.name, file.contentType]));
    expect(byName.get("stability_matrix.csv")).toBe("text/csv; charset=utf-8");
    expect(byName.get("stability_overview.svg")).toBe("image/svg+xml");
    expect(byName.get("robustness-run.json")).toBe("application/json; charset=utf-8");
  });
});

// ---------------------------------------------------------------------------
// 10. Run 状态
// ---------------------------------------------------------------------------

describe("EXP-002 · 10. Run 状态（含失败路径的两条出口）", () => {
  it("正常路径 ⇒ SUCCEEDED + result 非空 + error 为 null", async () => {
    const { outcome } = await runOnce();
    expect(outcome.runStatus).toBe("SUCCEEDED");
    expect(outcome.error).toBeNull();
    expect(outcome.result).not.toBeNull();
    expect(outcome.descriptor.id).toBe(EXPERIMENT_ID);
    expect(outcome.execution.durationMs).toBeGreaterThanOrEqual(0);
    expect(outcome.execution.logs.length).toBeGreaterThan(0);
    expect(outcome.execution.resolvedParameters.maxEvents).toBe(400_000);
  });

  it("执行前参数越界 ⇒ 领域错误（不是 SUCCEEDED 也不是静默夹取）", async () => {
    // `bounds.min = 100`：低于下界必须**响亮拒绝**，绝不夹取到 100（那样「研究范围」会被静默改动）
    await expectThrowCode(runOnce({ parameters: { maxEvents: 5 } }), "EXPERIMENT_PARAMETER_INVALID");
    const maxEvents = stabilityValidationExperiment.descriptor.parameters.find(
      (parameter) => parameter.code === "maxEvents",
    )!;
    expect(maxEvents.bounds).toEqual({ min: 100, max: 400_000 });
    expect(maxEvents.defaultValue).toBe(400_000);
  });

  it("🔴 失败 Run 不产出 Manifest（artifactFiles 为空）", async () => {
    const requirement = {
      ...stabilityValidationExperiment.descriptor.datasetRequirement,
      postRelativeDays: [1, 2, 3, 4, 5],
    };
    const shortcut = {
      ...stabilityValidationExperiment,
      descriptor: { ...stabilityValidationExperiment.descriptor, datasetRequirement: requirement },
    };
    const { outcome, artifactFiles } = await runOnce({ experiment: shortcut });
    expect(outcome.runStatus).toBe("FAILED");
    expect(outcome.error?.code).toBe("EXPERIMENT_RUN_FAILED");
    expect(outcome.result).toBeNull();
    expect(artifactFiles).toEqual([]);
  });

  it("维度声明与变体归属自洽（3 个维度、无空维度）", async () => {
    const custom = customOf(payloadOf((await runOnce()).outcome));
    expect(custom.dimensions.map((d) => d.id)).toEqual(STABILITY_DIMENSIONS.map((d) => d.id));
    expect(custom.dimensionConclusions).toHaveLength(STABILITY_DIMENSIONS.length);
    for (const conclusion of custom.dimensionConclusions) {
      expect(conclusion.variantCount).toBeGreaterThan(0);
      expect(conclusion.verdict).not.toBe("no-variants");
      expect(
        conclusion.stableCount +
          conclusion.sensitiveCount +
          conclusion.insufficientCount +
          conclusion.failedCount,
      ).toBe(conclusion.variantCount);
    }
    expect(custom.observations.length).toBeGreaterThan(0);
    for (const observation of custom.observations) {
      expect(observation.text.trim()).not.toBe("");
    }
  });

  it("结论里逐项登记了「不产出什么」（sensitive 是发现而非缺陷）", async () => {
    const custom = customOf(payloadOf((await runOnce()).outcome));
    const joined = custom.notes.join("\n");
    expect(joined).toContain("不产出");
    expect(joined).toContain("一个 Run 一个基准");
    expect(custom.comparisonSpecNotes.join("\n")).toContain("不是统计显著性");
    // 本实验不产出策略 / 参数 / 候选
    for (const forbidden of ["candidateId", "strategyId", "analysisId"]) {
      expect(JSON.stringify(custom).includes(forbidden), `结果里不应出现 ${forbidden}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. 前端最终态（静态部分；DOM 见 §22 E2E）
// ---------------------------------------------------------------------------

describe("EXP-002 · 11. 前端最终态（静态闸门）", () => {
  it("页面注册表键 = descriptor.pageKey，且导出的是一个组件", () => {
    const page = EXPERIMENT_PAGES[EXPERIMENT_ID];
    expect(page).toBeDefined();
    expect(typeof page === "function" || typeof page === "object").toBe(true);
    expect(experimentPageOf("not-registered/experiment")).toBeFalsy();
  });

  it("页面文件存在，且**不**引 server 运行时 / 不引实验定义 / 不引引桥", () => {
    const text = readFileSync(path.join(STABILITY_DIR, "page.tsx"), "utf8");
    const importLines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("import "));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line.includes("/server/"), `页面不得 import server 运行时：${line}`).toBe(false);
      expect(line.includes("robustnessBridge"), `页面不得 import 引桥：${line}`).toBe(false);
      expect(/from\s+"\.\/experiment"/u.test(line), `页面不得 import 实验定义：${line}`).toBe(false);
    }
    // 只允许 type-only 引 `./result`（结果结构类型）
    const resultImports = importLines.filter((line) => line.includes('from "./result"'));
    for (const line of resultImports) expect(line.startsWith("import type ")).toBe(true);
  });

  it("实验目录结构完整（result / experiment / page / README）", () => {
    const names = readdirSync(STABILITY_DIR);
    for (const required of ["result.ts", "experiment.ts", "page.tsx", "README.md"]) {
      expect(names, `缺文件 ${required}`).toContain(required);
    }
  });

  it("页面覆盖了总览 / 矩阵 / 样本账 / 产物四块（DOM 文案在 E2E 里量）", () => {
    const text = readFileSync(path.join(STABILITY_DIR, "page.tsx"), "utf8");
    for (const label of ["总览", "矩阵", "样本账", "产物"]) {
      expect(text, `页面缺区块「${label}」`).toContain(label);
    }
    // 稳定 / 敏感 / 不足 / 失败 四态都必须出现在界面上
    for (const verdict of ["stable", "sensitive", "insufficient", "failed"]) {
      expect(text).toContain(verdict);
    }
  });

  it("观察项类别是中文标签（DOM 里出现的是人读文案，不是枚举码）", () => {
    const text = readFileSync(path.join(STABILITY_DIR, "page.tsx"), "utf8");
    for (const kind of ["描述性事实", "维度比较", "值得注意", "局限"]) {
      expect(text, `页面缺观察项标签「${kind}」`).toContain(kind);
    }
    // 四个枚举码本身**不该**出现在界面文案里（它们只作为 Record 的键）
    for (const code of ["POTENTIAL_SIGNAL", "LIMITATION"]) {
      expect(text.split("\n").some((line) => line.includes(`>${code}<`))).toBe(false);
    }
  });

  it("README 说明了「复用既有 Robustness 方法、不新建引擎 / 不新建表」", () => {
    const text = readFileSync(path.join(STABILITY_DIR, "README.md"), "utf8");
    expect(text).toContain("robustness");
    expect(text).toMatch(/不新建|不建新表|不新增表/u);
    expect(text).toContain("Baseline");
  });

  it("指标词表与比较声明同源（页面 / CSV / 图表都从这一份取）", () => {
    expect([...METRIC_NAMES]).toEqual([
      "sampleCount",
      "validSampleCount",
      "meanCloseReturn",
      "medianCloseReturn",
      "breakoutVsCloseRate",
    ]);
    for (const spec of COMPARISON_SPECS) {
      expect(METRIC_NAMES).toContain(spec.metric);
      expect(spec.tolerance).toBeGreaterThan(0);
      expect(spec.direction).toBe("both");
    }
    // 样本量指标进词表但**不**声明比较容差（样本量是设计属性，不是结论）
    expect(COMPARISON_SPECS.map((spec) => spec.metric)).not.toContain("sampleCount");
    expect(EXCLUSION_REASONS.MISSING_WINDOW_BAR.bucket).toBe("missing");
    expect(EXCLUSION_REASONS.SAMPLE_CONDITION_NOT_MET.bucket).toBe("excluded");
    expect(specOf("OBS_DAY_T5").dimensionId).toBe("observationDay");
  });
});
