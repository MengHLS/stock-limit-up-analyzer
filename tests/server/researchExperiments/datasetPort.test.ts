/**
 * RESEARCH-EXPERIMENT-001 · Dataset 桥契约测试
 *
 * 覆盖规格 §17「dataset validation」以及三条**结构级**保证：
 *   1. **列投影即时声明** —— 未声明的列读不到（读出来是 `undefined`）；
 *      声明了不存在的列 ⇒ **当场拒**（否则取值会静默变 null）；
 *   2. **相对日白名单** —— 未声明的相对日读不到（不是「能读但你别读」）；
 *   3. **PIT 结构闸门** —— 未声明 `usesForwardData` 时 `observation()` **调用即抛**。
 *
 * 数据面用项目既有的 `InMemoryResearchDatasetReader`（与真实 DB 实现同过滤语义），
 * 不是 mock 冒名；它自带 `callLog`，可断言「确实按版本下推、按批取数」。
 */

import { describe, expect, it } from "vitest";
import type { ExperimentDescriptor } from "@shared/researchExperimentsContracts";
import {
  createRegistryExperimentDatasetPort,
  assertRelativeDaysWithinHorizon,
  assertDatasetCodeMatches,
  assertVersionReady,
} from "../../../server/researchExperiments/datasetPort";
import { ExperimentError } from "../../../server/researchExperiments/errors";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 900_001;

const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 120001,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-06-30",
  totalEvents: 3,
  horizons: [5],
  pathRelativeDayRange: { min: 1, max: 5 },
  postRelativeDayRange: { min: 1, max: 5 },
  decisionOffsetDays: null,
};

function event(eventId: string, tradeDate: string): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
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
  values: Partial<FirstLimitPullbackRawBar> = {},
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate,
    relativeDay,
    open: 10,
    high: 11,
    low: 9.5,
    close: 10.5,
    volume: 1000,
    amount: 10_500,
    ...values,
  };
}

const EVENTS = [event("e1@2025-01-02", "2025-01-02"), event("e2@2025-01-03", "2025-01-03")];

const BARS: FirstLimitPullbackRawBar[] = [
  bar("e1@2025-01-02", 0, "2025-01-02", { close: 10, open: 9.9, low: 9.8, high: 10.1 }),
  bar("e2@2025-01-03", 0, "2025-01-03", { close: 20, open: 19.9, low: 19.8, high: 20.1 }),
  bar("e1@2025-01-02", 1, "2025-01-03", { open: 10.2, high: 10.6, low: 9.9, close: 10.4 }),
  bar("e2@2025-01-03", 1, "2025-01-06", { open: 20.5, high: 21, low: 19.7, close: 20.2 }),
  bar("e1@2025-01-02", 2, "2025-01-06", { open: 10.4, high: 10.5, low: 10.0, close: 10.3 }),
  bar("e2@2025-01-03", 2, "2025-01-07", { open: 20.2, high: 20.4, low: 19.0, close: 19.5 }),
];

function makePort() {
  return createRegistryExperimentDatasetPort({
    reader: new InMemoryResearchDatasetReader({ context, events: EVENTS, prefixBars: BARS, postBars: BARS }),
    // 测试用更小的扫描上限，便于验证「截断被如实标记」。
    eventScanLimit: 10,
    eventPageSize: 1,
  });
}

function descriptorWith(
  patch: Partial<ExperimentDescriptor["datasetRequirement"]>,
  rest: Partial<ExperimentDescriptor> = {},
): ExperimentDescriptor {
  const base: ExperimentDescriptor = {
    id: "demo/bridge",
    name: "桥测试",
    version: "1.0.0",
    description: "演示",
    source: "test",
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: { events: ["isFirstLimit", "boardType"], feature: ["close"] },
      prefixRelativeDays: [0],
      postRelativeDays: [],
      decisionOffsetDays: null,
      usesForwardData: false,
    },
    pageKey: "demo/bridge",
    pageTitle: "桥测试",
  };
  return { ...base, ...rest, datasetRequirement: { ...base.datasetRequirement, ...patch } };
}

async function expectReject(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`期望抛出 ${code}，但没有抛出`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExperimentError);
    expect((error as ExperimentError).code).toBe(code);
  }
}

describe("Dataset 桥 · 版本事实", () => {
  it("解析出真实事实（代码 / 标签 / 状态 / 视界）", async () => {
    const facts = await makePort().getVersionFacts(VERSION_ID);
    expect(facts).not.toBeNull();
    expect(facts!.datasetCode).toBe("first_limit_pullback");
    expect(facts!.datasetVersionLabel).toBe("v-test");
    expect(facts!.status).toBe("READY");
    expect(facts!.postRelativeDayRange).toEqual({ min: 1, max: 5 });
    // 🔴 Registry 读取层不暴露 prefix 视界 ⇒ 如实不提供（而不是编一个区间）
    expect(Object.prototype.hasOwnProperty.call(facts!, "prefixRelativeDayRange")).toBe(false);
  });

  it("未知版本返回 null", async () => {
    expect(await makePort().getVersionFacts(999)).toBeNull();
  });

  it("非 READY / 代码不匹配 / 相对日超视界 分别被拒", () => {
    const facts = {
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetName: "首板回踩",
      datasetVersionLabel: "v-test",
      status: "BUILDING",
      startDate: null,
      endDate: null,
      totalEvents: null,
      postRelativeDayRange: { min: 1, max: 5 },
    };
    try {
      assertVersionReady(facts);
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as ExperimentError).code).toBe("EXPERIMENT_DATASET_VERSION_NOT_READY");
    }

    try {
      assertDatasetCodeMatches(descriptorWith({}), { ...facts, status: "READY", datasetCode: "some_other" });
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as ExperimentError).code).toBe("EXPERIMENT_DATASET_CODE_MISMATCH");
    }

    try {
      assertRelativeDaysWithinHorizon(
        descriptorWith({ postRelativeDays: [1, 9], usesForwardData: true, forwardDataPurpose: "研究" }),
        { ...facts, status: "READY" },
      );
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as ExperimentError).code).toBe("EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE");
      expect((error as ExperimentError).message).toContain("夹取");
    }

    // 数据集没有 post 数据却声明了 post 相对日 ⇒ 同样拒绝（不静默当作全空）
    try {
      assertRelativeDaysWithinHorizon(
        descriptorWith({ postRelativeDays: [1], usesForwardData: true, forwardDataPurpose: "研究" }),
        { ...facts, status: "READY", postRelativeDayRange: null },
      );
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as ExperimentError).code).toBe("EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE");
    }
  });
});

describe("Dataset 桥 · 列投影即声明", () => {
  it("只有声明过的列出现在行里（未声明的列读出来是 undefined）", async () => {
    const port = makePort();
    const facts = (await port.getVersionFacts(VERSION_ID))!;
    const { access } = port.createAccess({ descriptor: descriptorWith({}), facts });

    const events = await access.events();
    expect(events).toHaveLength(2);
    expect(Object.keys(events[0]!.values).sort()).toEqual(["boardType", "isFirstLimit"]);
    expect(events[0]!.values.isFirstLimit).toBe(true);
    // 未声明 ⇒ 取不到（不是 null 值，而是键根本不存在）
    expect(events[0]!.values.turnover).toBeUndefined();

    const feature = await access.feature(0);
    expect(Object.keys(feature[0]!.values)).toEqual(["close"]);
    expect(feature[0]!.values.open).toBeUndefined();
    expect(feature.map((row) => row.values.close)).toEqual([10, 20]);
  });

  it("声明了不存在的列 ⇒ 当场拒绝（否则取值会静默变 null）", async () => {
    const port = makePort();
    const facts = (await port.getVersionFacts(VERSION_ID))!;
    expect(() =>
      port.createAccess({
        descriptor: descriptorWith({
          requiredColumns: { events: ["isFirstLimit", "noSuchColumn"], feature: ["close"] },
        }),
        facts,
      }),
    ).toThrowError(/noSuchColumn/);
  });

  it("必须声明至少一个列 —— 但校验发生在注册/契约层（这里验证 createAccess 不因空声明崩）", async () => {
    const port = makePort();
    const facts = (await port.getVersionFacts(VERSION_ID))!;
    const { access } = port.createAccess({
      descriptor: descriptorWith({ requiredColumns: { feature: ["close"] } }),
      facts,
    });
    const events = await access.events();
    expect(events[0]!.values).toEqual({});
  });
});

describe("Dataset 桥 · 相对日白名单与 PIT 闸门", () => {
  it("未声明的相对日读不到（feature / observation 都拒绝）", async () => {
    const port = makePort();
    const facts = (await port.getVersionFacts(VERSION_ID))!;
    const { access } = port.createAccess({
      descriptor: descriptorWith({
        prefixRelativeDays: [0],
        postRelativeDays: [1],
        usesForwardData: true,
        forwardDataPurpose: "研究事件后收益",
      }),
      facts,
    });

    await expectReject(access.feature(-1), "EXPERIMENT_DATASET_REQUIREMENT_INVALID");
    await expectReject(access.observation(2), "EXPERIMENT_DATASET_REQUIREMENT_INVALID");
    // 声明过的可以读
    expect((await access.observation(1)).length).toBeGreaterThan(0);
  });

  it("未声明 usesForwardData 时 observation() 调用即抛（PIT 结构闸门，不是靠注释提醒）", async () => {
    const port = makePort();
    const facts = (await port.getVersionFacts(VERSION_ID))!;
    const { access } = port.createAccess({
      descriptor: descriptorWith({ postRelativeDays: [1], usesForwardData: false }),
      facts,
    });
    await expectReject(access.observation(1), "EXPERIMENT_FORWARD_DATA_FORBIDDEN");
  });

  it("下推的列投影必须包含**骨架列**（eventId / tradeDate / relativeDay / symbol）", async () => {
    // 🔴 回归守卫（真库 E2E 实测踩到）：`buildColumnSelection` 只 SELECT 清单里的列，
    //    漏 `eventId` 会让领域映射器产出 `eventId: undefined` ⇒ 之后按 eventId 批量取行情
    //    **恒返回 0 行**（`prefixRowCount = 0 / postRowCount = 0`）。
    //    单测用的内存读取层**不实现列裁剪**，所以这个缺陷只有靠「断言下推的查询本身」才拦得住。
    const inner = new InMemoryResearchDatasetReader({
      context,
      events: EVENTS,
      prefixBars: BARS,
      postBars: BARS,
    });
    const queries: { method: string; columns?: readonly string[] }[] = [];
    const recorder = {
      getVersionContext: (id: number) => inner.getVersionContext(id),
      loadEventPage: (query: Parameters<typeof inner.loadEventPage>[0]) => {
        queries.push({ method: "event", columns: query.columns });
        return inner.loadEventPage(query);
      },
      loadPrefixBars: (query: Parameters<typeof inner.loadPrefixBars>[0]) => {
        queries.push({ method: "prefix", columns: query.columns });
        return inner.loadPrefixBars(query);
      },
      loadPostBars: (query: Parameters<typeof inner.loadPostBars>[0]) => {
        queries.push({ method: "post", columns: query.columns });
        return inner.loadPostBars(query);
      },
    };

    const port = createRegistryExperimentDatasetPort({ reader: recorder, eventPageSize: 2 });
    const facts = (await port.getVersionFacts(VERSION_ID))!;
    const { access } = port.createAccess({
      descriptor: descriptorWith({
        requiredColumns: { events: ["isFirstLimit"], feature: ["close"], observation: ["open"] },
        postRelativeDays: [1],
        usesForwardData: true,
        forwardDataPurpose: "研究",
      }),
      facts,
    });
    await access.events();
    await access.feature(0);
    await access.observation(1);

    const byMethod = new Map(queries.map((query) => [query.method, query.columns ?? []]));
    for (const column of ["eventId", "tradeDate", "symbol", "datasetVersionId"]) {
      expect(byMethod.get("event"), `事件查询缺少骨架列 ${column}`).toContain(column);
    }
    for (const method of ["prefix", "post"]) {
      for (const column of ["eventId", "tradeDate", "symbol", "relativeDay", "datasetVersionId"]) {
        expect(byMethod.get(method), `${method} 查询缺少骨架列 ${column}`).toContain(column);
      }
    }
    // 声明列也在清单里（否则实验读不到自己声明的东西）
    expect(byMethod.get("event")).toContain("isFirstLimit");
    expect(byMethod.get("prefix")).toContain("close");
    expect(byMethod.get("post")).toContain("open");
  });

  it("读取按版本下推、且同一个相对日只读一次（惰性缓存）", async () => {
    const reader = new InMemoryResearchDatasetReader({
      context,
      events: EVENTS,
      prefixBars: BARS,
      postBars: BARS,
    });
    const port = createRegistryExperimentDatasetPort({ reader, eventPageSize: 1 });
    const facts = (await port.getVersionFacts(VERSION_ID))!;
    const { access, stats } = port.createAccess({
      descriptor: descriptorWith({
        prefixRelativeDays: [0],
        postRelativeDays: [1, 2],
        usesForwardData: true,
        forwardDataPurpose: "研究事件后收益",
      }),
      facts,
    });

    await access.events();
    await access.observation(1);
    await access.observation(1);
    await access.observation(2);

    const postCalls = reader.callLog.filter((call) => call.method === "loadPostBars");
    // 同一个 rd 只读一次
    expect(postCalls).toHaveLength(2);
    // 每次都按版本下推、且带上了事件集合
    for (const call of postCalls) {
      expect(call.datasetVersionId).toBe(VERSION_ID);
      expect(call.ids).toBe(2);
    }
    expect(potentiallyStatsGuard(stats)).toBe(true);
  });
});

/** 小工具：断言统计字段形状（避免把 undefined 当通过）。 */
function potentiallyStatsGuard(stats: { eventCount: number; postRowCount: number; maxPostRelativeDayRead: number | null }): boolean {
  return stats.eventCount === 2 && stats.postRowCount > 0 && stats.maxPostRelativeDayRead === 2;
}
