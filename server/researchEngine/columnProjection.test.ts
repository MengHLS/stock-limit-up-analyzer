/**
 * RESEARCH-002 · PERF — 列投影测试。
 *
 * 这里要证明的不是「投影算得对」，而是**「投影没有改变任何口径」**：
 *   1. 逐变量差分：同一个变量用「全列源」与「投影后源」解析，结果必须逐位相等 ——
 *      若某个变量读了未被投影的列，投影源会给出 undefined（→ null），差分当场失败；
 *   2. 端到端差分：同一份合成 Dataset 上，`columnProjection: "all"`（不裁剪）与自动派生的装配结果
 *      必须完全一致，且整个装配过程在 `projectionGuard: "all"` 下不得触发越界读取；
 *   3. 越界即失败：守卫必须把「读了未投影的列」变成 `PROJECTION_MISSING_COLUMN`，而不是静默 null；
 *   4. 写错列名即失败：变量定义读了表里不存在的列，派生阶段就要抛错。
 */

import { describe, expect, it } from "vitest";
import {
  deriveColumnProjection,
  fullColumnProjection,
  guardProjectedRow,
  PROJECTION_FULL_COLUMNS,
  resolveGuardMode,
  type ResearchColumnProjection,
} from "./columnProjection";
import { ResearchVariableCatalog, type FeatureSources, type OutcomeSources } from "./variables";
import { ResearchEngineError } from "./errors";
import { buildSampleSet } from "./sampleSet";
import { buildSyntheticDataset, linearEvents, TEST_DATASET_VERSION_ID } from "./testFixtures";

const PATH_DAYS = Array.from({ length: 20 }, (_, i) => i + 1);
const catalog = new ResearchVariableCatalog([5, 10, 20], PATH_DAYS);

/** 把一行裁成「只保留 keep 里的键」——缺失的键在解析里等价于 undefined。 */
function stripRow<T extends object>(row: T, keep: readonly string[]): T {
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keep) out[key] = source[key];
  return out as T;
}

describe("列投影 · 派生", () => {
  it("结构列无论变量怎么声明都会被保留", () => {
    const projection = deriveColumnProjection({
      featureDefs: [],
      outcomeDefs: [],
      dimensionKeys: [],
      prefixDays: [],
      pathDays: [],
      outcomeHorizons: [],
    });
    expect(projection.event).toEqual(["datasetVersionId", "eventId", "symbol", "tradeDate"]);
    expect(projection.prefix).toEqual(["datasetVersionId", "eventId", "relativeDay"]);
    expect(projection.path).toEqual(["datasetVersionId", "eventId", "relativeDay"]);
    expect(projection.outcome).toEqual(["datasetVersionId", "eventId", "horizon"]);
  });

  it("确实发生裁剪：大宽列（open/high/low/amount/createdAt…）不进投影", () => {
    const projection = deriveColumnProjection({
      featureDefs: catalog.listFeatures().map((n) => catalog.resolveFeature(n)),
      outcomeDefs: catalog.listOutcomes().map((n) => catalog.resolveOutcome(n)),
      dimensionKeys: ["year", "board"],
      prefixDays: Array.from({ length: 21 }, (_, i) => i - 20),
      pathDays: PATH_DAYS,
      outcomeHorizons: [5, 10, 20],
    });

    // prefix 读 close / volume，外加**事件日形态**所需的 open / low
    // （`is_one_word_open` 读 open；`is_one_word_hold`、`event_low_offset` 读 low）。
    // `high` / `amount` 仍然没有任何变量读 ⇒ 裁剪照旧发生。
    expect(projection.prefix).toContain("close");
    expect(projection.prefix).toContain("volume");
    expect(projection.prefix).toContain("open");
    expect(projection.prefix).toContain("low");
    for (const dropped of ["high", "amount", "symbol", "tradeDate", "id", "createdAt"]) {
      expect(projection.prefix, `prefix 不该取 ${dropped}`).not.toContain(dropped);
    }

    // path 读四个 relative 收益列 + 逐日量比列（`volume_ratio_{d}d` 读 volumeRatio）
    for (const kept of [
      "closeFromEventClose",
      "highFromEventClose",
      "lowFromEventClose",
      "volumeRatio",
      "pullbackFromEventHigh",
    ]) {
      expect(projection.path).toContain(kept);
    }
    for (const dropped of ["breakoutPrice", "symbol", "tradeDate", "id", "createdAt"]) {
      expect(projection.path, `path 不该取 ${dropped}`).not.toContain(dropped);
    }

    // outcome 只读聚合列
    for (const kept of ["maxReturn", "minReturn", "maxDrawdown", "isBreakout", "daysToBreakout"]) {
      expect(projection.outcome).toContain(kept);
    }
    expect(projection.outcome).not.toContain("createdAt");

    // 投影是真子集（否则「裁剪」名不副实）
    for (const role of ["event", "prefix", "path", "outcome"] as const) {
      expect(projection[role].length).toBeLessThan(PROJECTION_FULL_COLUMNS[role].length);
    }
  });

  it("只申请与 prefix 无关的变量时，prefix 投影只剩结构列", () => {
    const projection = deriveColumnProjection({
      featureDefs: [catalog.resolveFeature("turnover"), catalog.resolveFeature("previous_close")],
      outcomeDefs: [],
      dimensionKeys: [],
      prefixDays: [],
      pathDays: [],
      outcomeHorizons: [],
    });
    expect(projection.prefix).toEqual(["datasetVersionId", "eventId", "relativeDay"]);
    expect(projection.event).toContain("turnover");
    expect(projection.event).toContain("previousClose");
  });

  it("维度键所需的列也算进投影（board → boardType）", () => {
    const projection = deriveColumnProjection({
      featureDefs: [],
      outcomeDefs: [],
      dimensionKeys: ["board", "market", "industry"],
      prefixDays: [],
      pathDays: [],
      outcomeHorizons: [],
    });
    expect(projection.event).toContain("boardType");
    expect(projection.event).toContain("market");
    expect(projection.event).toContain("industryCode");
  });

  it("变量读了表里不存在的列 → 派生阶段就抛错（不可能静默变 null）", () => {
    const bogus = {
      name: "bogus",
      role: "FEATURE" as const,
      label: "笔误变量",
      definition: "故意把 close 写成 clsoe，用于验证派生阶段必须失败",
      resolve: (s: FeatureSources) =>
        (s.prefixBars.get(0) as unknown as Record<string, number>)["clsoe"] ?? null,
    };
    expect(() =>
      deriveColumnProjection({
        featureDefs: [bogus],
        outcomeDefs: [],
        dimensionKeys: [],
        prefixDays: [0],
        pathDays: [],
        outcomeHorizons: [],
      }),
    ).toThrowError(/clsoe/);
  });
});

describe("列投影 · 逐变量差分（全列 vs 投影）", () => {
  const dataset = buildSyntheticDataset({ events: linearEvents(6) });
  const event = dataset.events[0]!;

  const fullFeatureSources = (): FeatureSources => ({
    event: { ...event },
    prefixBars: new Map(dataset.prefixBars.filter((b) => b.eventId === event.eventId).map((b) => [b.relativeDay, { ...b }])),
  });
  const fullOutcomeSources = (): OutcomeSources => ({
    pathRows: new Map(dataset.paths.filter((p) => p.eventId === event.eventId).map((p) => [p.relativeDay, { ...p }])),
    outcomeRows: new Map(dataset.outcomes.filter((o) => o.eventId === event.eventId).map((o) => [o.horizon, { ...o }])),
  });

  it("每个特征变量：投影后取值 == 全列取值", () => {
    for (const name of catalog.listFeatures()) {
      const def = catalog.resolveFeature(name);
      const prefixDays = def.prefixRelativeDays ?? [];
      const projection = deriveColumnProjection({
        featureDefs: [def],
        outcomeDefs: [],
        dimensionKeys: [],
        prefixDays,
        pathDays: [],
        outcomeHorizons: [],
      });

      const full = fullFeatureSources();
      const projected: FeatureSources = {
        event: stripRow(full.event, projection.event),
        prefixBars: new Map(
          [...full.prefixBars].map(([day, bar]) => [day, stripRow(bar, projection.prefix)]),
        ),
      };

      expect(def.resolve(projected), `特征 ${name} 在投影后取值发生变化`).toEqual(def.resolve(full));
    }
  });

  it("每个结果变量：投影后取值 == 全列取值", () => {
    for (const name of catalog.listOutcomes()) {
      const def = catalog.resolveOutcome(name);
      const projection = deriveColumnProjection({
        featureDefs: [],
        outcomeDefs: [def],
        dimensionKeys: [],
        prefixDays: [],
        pathDays: def.pathRelativeDays ?? [],
        outcomeHorizons: def.outcomeHorizons ?? [],
      });

      const full = fullOutcomeSources();
      const projected: OutcomeSources = {
        pathRows: new Map([...full.pathRows].map(([day, row]) => [day, stripRow(row, projection.path)])),
        outcomeRows: new Map([...full.outcomeRows].map(([h, row]) => [h, stripRow(row, projection.outcome)])),
      };

      expect(def.resolve(projected), `结果 ${name} 在投影后取值发生变化`).toEqual(def.resolve(full));
    }
  });
});

describe("列投影 · 越界守卫", () => {
  const dataset = buildSyntheticDataset({ events: linearEvents(2) });
  const bar = dataset.prefixBars[0]!;

  it("读未投影的列 → PROJECTION_MISSING_COLUMN（不静默 null）", () => {
    const guarded = guardProjectedRow({ ...bar }, "prefix", ["datasetVersionId", "eventId", "relativeDay", "close"]);
    expect(guarded.close).toBe(bar.close);
    let error: unknown;
    try {
      // open 属于 prefix 真实列，但不在本次投影里
      void guarded.open;
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ResearchEngineError);
    expect((error as ResearchEngineError).code).toBe("PROJECTION_MISSING_COLUMN");
  });

  it("读已投影的列（含 null）与无关属性都放行", () => {
    const guarded = guardProjectedRow({ ...bar }, "prefix", ["datasetVersionId", "eventId", "relativeDay", "close", "volume"]);
    expect(guarded.volume).toBe(bar.volume);
    expect(typeof guarded.toString).toBe("function");
  });

  it("全列投影下不拦任何列读取", () => {
    const guarded = guardProjectedRow({ ...bar }, "prefix", fullColumnProjection().prefix);
    expect(guarded.open).toBe(bar.open);
    expect(guarded.amount).toBe(bar.amount);
  });
});

describe("列投影 · 装配层端到端差分", () => {
  it("不裁剪 与 自动派生裁剪 的装配结果完全一致（且在全程守卫下不越界）", async () => {
    const dataset = buildSyntheticDataset({ events: linearEvents(11) });
    const requirement = {
      features: catalog.listFeatures(),
      outcomes: catalog.listOutcomes().slice(0, 8),
      dimensions: ["year", "board"],
    };
    const guardAll = "all" as const;

    const withoutPruning = await buildSampleSet({
      reader: dataset.reader,
      datasetVersionId: TEST_DATASET_VERSION_ID,
      catalog,
      requirement,
      dimensionKeys: requirement.dimensions,
      eventPageSize: 4,
      pageConcurrency: 1,
      projectionGuard: guardAll,
      columnProjection: "all",
    });

    const withPruning = await buildSampleSet({
      reader: dataset.reader,
      datasetVersionId: TEST_DATASET_VERSION_ID,
      catalog,
      requirement,
      dimensionKeys: requirement.dimensions,
      eventPageSize: 4,
      pageConcurrency: 3,
      projectionGuard: guardAll,
      columnProjection: undefined, // 自动派生
    });

    expect(withPruning.samples).toEqual(withoutPruning.samples);
    expect(withPruning.eventCount).toBe(withoutPruning.eventCount);
    expect(withPruning.chunkCount).toBe(withoutPruning.chunkCount);

    // 派生投影确实小于全列（证明这条路径真的在裁剪）
    const derived: ResearchColumnProjection = withPruning.columnProjection;
    expect(derived.prefix.length).toBeLessThan(PROJECTION_FULL_COLUMNS.prefix.length);
    expect(derived.path.length).toBeLessThan(PROJECTION_FULL_COLUMNS.path.length);
    // 而不裁剪路径原样是全列
    expect(withoutPruning.columnProjection.prefix).toEqual(PROJECTION_FULL_COLUMNS.prefix);
  });

  it("流水线并发不改变批序与结果（并发 1 与 3 结果一致）", async () => {
    const dataset = buildSyntheticDataset({ events: linearEvents(9) });
    const requirement = { features: ["turnover", "pre_volatility_20d"], outcomes: ["future_return_5d"] };

    const serial = await buildSampleSet({
      reader: dataset.reader,
      datasetVersionId: TEST_DATASET_VERSION_ID,
      catalog,
      requirement,
      eventPageSize: 2,
      pageConcurrency: 1,
    });
    const pipelined = await buildSampleSet({
      reader: dataset.reader,
      datasetVersionId: TEST_DATASET_VERSION_ID,
      catalog,
      requirement,
      eventPageSize: 2,
      pageConcurrency: 4,
    });

    expect(pipelined.samples).toEqual(serial.samples);
    expect(pipelined.chunkCount).toBe(serial.chunkCount);
  });
});

describe("列投影 · 守卫策略解析", () => {
  it("默认 first-chunk，可显式关闭或全开", () => {
    expect(resolveGuardMode(undefined)).toBe("first-chunk");
    expect(resolveGuardMode("")).toBe("first-chunk");
    expect(resolveGuardMode("off")).toBe("off");
    expect(resolveGuardMode("0")).toBe("off");
    expect(resolveGuardMode("all")).toBe("all");
    expect(resolveGuardMode("ALWAYS")).toBe("all");
  });
});
