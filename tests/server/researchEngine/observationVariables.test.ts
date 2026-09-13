/**
 * RESEARCH-002 · OBSERVATION — 观察日变量（T+k 可观测 vs 事后标签）。
 *
 * 这一族存在的理由：用户的策略不是「按 T 日的特征分档」，而是
 * 「T 日首板 → 未来 N 日为观察日 → 满足条件（如回踩不破事件日最低价）则买入」。
 * 条件作用在 **T+k 那一天就能看到的量** 上，而不是事后才知道的结果上。
 *
 * 本文件要钉死的四件事：
 *   1. **可见性口径**：`obs_{k}d.*` 的 offset 必须是 k，而累积量 `pullback_*_{k}d`
 *      覆盖 `1..k` 的全部 post K 线（不是单个 k）；
 *   2. **可用上界来自真实数据**：`post.relativeDay` 覆盖到哪，变量就能用到哪；
 *      没有 post 数据 ⇒ 一切观察日变量不可用（**不是**默认到 20）；
 *   3. **PIT 护栏**：在 T+e 判定时引用 offset > e 的观察日变量 → 拒绝；
 *   4. **端到端**：观察日条件真的能当条件跑通 CONDITIONAL 分析，且结果与手算一致。
 */

import { describe, expect, it } from "vitest";
import {
  OBSERVATION_MAX_OFFSET,
  ResearchVariableCatalog,
  assertObservationConditionsPitSafe,
  parseObservationVariableName,
} from "../../../server/researchEngine/variables";
import { ResearchEngineError } from "../../../server/researchEngine/errors";
import { buildSampleSet } from "../../../server/researchEngine/sampleSet";
import {
  buildSyntheticDataset,
  linearEvents,
  TEST_DATASET_VERSION_ID,
  type SyntheticEventSpec,
} from "../../../server/researchEngine/testFixtures";
import { deriveColumnProjection } from "../../../server/researchEngine/columnProjection";
import { createDefaultAnalysisExecutorRegistry } from "../../../server/researchEngine/analyses/registry";
import { resolveEngineAnalysisConfig } from "../../../server/researchEngine/analysisConfig";
import type { ResearchConditionSet } from "../../../server/researchCore";

const PATH_DAYS = Array.from({ length: 20 }, (_, i) => i + 1);

function makeCatalog(postMax = 20): ResearchVariableCatalog {
  return new ResearchVariableCatalog(
    [5, 10, 20],
    PATH_DAYS,
    Array.from({ length: postMax }, (_, i) => i + 1),
  );
}

describe("观察日变量 · 命名与可见性", () => {
  it("逐日变量的 availableFromOffset 等于它自己的 k（不是 1）", () => {
    const catalog = makeCatalog();
    const def = catalog.resolveObservation("obs_5d.close");
    expect(def.availableFromOffset).toBe(5);
    expect(def.postRelativeDays).toEqual([5]);
  });

  it("累积变量的 postRelativeDays 覆盖 1..k 全部观察日", () => {
    const catalog = makeCatalog();
    const def = catalog.resolveObservation("pullback_min_low_4d");
    expect(def.availableFromOffset).toBe(4);
    expect(def.postRelativeDays).toEqual([1, 2, 3, 4]);
  });

  it("事件日最低价（holds_event_low）确需基准线 ⇒ 声明 needsEventBar", () => {
    const catalog = makeCatalog();
    expect(catalog.resolveObservation("pullback_holds_event_low_3d").needsEventBar).toBe(true);
  });

  it("缩放类口径（量能比 / 收盘比）同样声明 needsEventBar", () => {
    const catalog = makeCatalog();
    for (const name of [
      "pullback_min_volume_ratio_3d",
      "pullback_last_volume_ratio_3d",
      "pullback_close_ratio_3d",
    ]) {
      expect(catalog.resolveObservation(name).needsEventBar, name).toBe(true);
    }
  });

  it("缩量条件必须用比率口径：min_volume 是绝对量，min_volume_ratio 才是可比较的比率", () => {
    const catalog = makeCatalog();
    // 两者都存在，但语义不同 —— 这是刻意的：绝对量用于「多少股」的描述，比率用于条件比较。
    expect(catalog.hasObservation("pullback_min_volume_3d")).toBe(true);
    expect(catalog.hasObservation("pullback_min_volume_ratio_3d")).toBe(true);
    expect(catalog.resolveObservation("pullback_min_volume_3d").unit).toBe("股");
    expect(catalog.resolveObservation("pullback_min_volume_ratio_3d").unit).toBe("比例");
  });

  it("可以解析名字的两半（逐日 / 累积各有稳定键名）", () => {
    expect(parseObservationVariableName("obs_3d.high")).toEqual({ kind: "day", offset: 3, field: "high" });
    expect(parseObservationVariableName("pullback_min_volume_2d")).toEqual({
      kind: "pullback",
      offset: 2,
      stat: "min_volume",
    });
    expect(parseObservationVariableName("future_return_5d")).toBeNull();
  });
});

describe("观察日变量 · 可用上界来自真实数据", () => {
  it("post 只覆盖到 T+5 时，obs_9d.close 不可用（不是默认到 20）", () => {
    const catalog = makeCatalog(5);
    expect(catalog.hasObservation("obs_5d.close")).toBe(true);
    expect(catalog.hasObservation("obs_9d.close")).toBe(false);
  });

  it("数据集没有任何 post 数据 ⇒ 一切观察日变量不可用，且 listObservations 为空", () => {
    const catalog = new ResearchVariableCatalog([5, 10, 20], PATH_DAYS, []);
    expect(catalog.observationMaxOffset).toBe(0);
    expect(catalog.listObservations()).toEqual([]);
    expect(() => catalog.resolveObservation("obs_1d.close")).toThrow(ResearchEngineError);
  });

  it("把结果变量当观察日用会明确拒绝（角色反用，不是「未知变量」）", () => {
    const catalog = makeCatalog();
    expect(() => catalog.resolveObservation("future_return_5d")).toThrow(/不是观察日变量/);
  });

  it("OBSERVATION_MAX_OFFSET 是声明上限；真实上界仍由目录决定", () => {
    expect(OBSERVATION_MAX_OFFSET).toBe(20);
    const catalog = makeCatalog(20);
    expect(catalog.observationMaxOffset).toBe(20);
    expect(catalog.hasObservation("obs_20d.close")).toBe(true);
    expect(catalog.hasObservation("obs_21d.close")).toBe(false);
  });
});

describe("观察日变量 · PIT 护栏", () => {
  it("在 T+3 判定却引用 obs_5d ⇒ 拒绝（这正是「用未来信息当条件」）", () => {
    const catalog = makeCatalog();
    expect(() =>
      assertObservationConditionsPitSafe({
        catalog,
        fields: ["obs_3d.close", "obs_5d.min_low_proxy" as string, "pullback_min_low_5d"],
        evaluationOffset: 3,
      }),
    ).toThrow(/PIT 违规/);
  });

  it("引用 offset ≤ 判定日的观察日变量 ⇒ 通过，并回传用到的变量", () => {
    const catalog = makeCatalog();
    const used = assertObservationConditionsPitSafe({
      catalog,
      fields: ["obs_2d.close", "pullback_min_low_3d", "turnover"],
      evaluationOffset: 3,
    });
    expect(used).toEqual([
      { variable: "obs_2d.close", availableFromOffset: 2 },
      { variable: "pullback_min_low_3d", availableFromOffset: 3 },
    ]);
  });

  it("特征 / 结果 / 维度不受本护栏约束（它们各有自己的 PIT 规则）", () => {
    const catalog = makeCatalog();
    expect(() =>
      assertObservationConditionsPitSafe({
        catalog,
        fields: ["turnover", "board", "future_return_20d"],
        evaluationOffset: 1,
      }),
    ).not.toThrow();
  });
});

describe("观察日变量 · 列投影", () => {
  it("声明 observationDefs 后 post 列真的被投影进来（否则静默全 null）", () => {
    const catalog = makeCatalog();
    const defs = ["obs_3d.close", "pullback_min_low_3d", "pullback_holds_event_low_2d"].map((n) =>
      catalog.resolveObservation(n),
    );
    const projection = deriveColumnProjection({
      featureDefs: [],
      outcomeDefs: [],
      observationDefs: defs,
      dimensionKeys: [],
      prefixDays: [],
      postDays: [1, 2, 3],
      pathDays: [],
      outcomeHorizons: [],
    });
    // close / low 必须进投影；eventId / relativeDay 是结构列，永远在。
    expect(projection.post).toContain("close");
    expect(projection.post).toContain("low");
    expect(projection.post).toContain("eventId");
    expect(projection.post).toContain("relativeDay");
    // 没被任何变量读到的宽列仍被裁掉（证明确实发生了裁剪，不是「全列」）。
    expect(projection.post).not.toContain("amount");
  });
});

describe("观察日变量 · 端到端装配", () => {
  it("观察日条件能装配出真实取值，且与 post K 线逐位一致", async () => {
    const { reader, postBars } = buildSyntheticDataset({
      events: linearEvents(6),
      horizons: [5],
      maxPathDay: 5,
    });
    const catalog = makeCatalog(5);
    const assembled = await buildSampleSet({
      reader,
      datasetVersionId: TEST_DATASET_VERSION_ID,
      catalog,
      requirement: {
        features: ["turnover"],
        outcomes: [],
        observations: [
          "obs_2d.close",
          "pullback_min_low_3d",
          "pullback_min_volume_ratio_3d",
          "pullback_last_volume_ratio_3d",
        ],
      },
    });

    expect(assembled.observations).toEqual([
      "obs_2d.close",
      "pullback_min_low_3d",
      "pullback_min_volume_ratio_3d",
      "pullback_last_volume_ratio_3d",
    ]);
    expect(assembled.samples.length).toBe(6);

    const first = assembled.samples[0]!;
    const bar2 = postBars.find((b) => b.eventId === first.eventId && b.relativeDay === 2)!;
    const bars13 = postBars.filter((b) => b.eventId === first.eventId && b.relativeDay <= 3);
    const eventBar = { volume: 1_000_000 }; // 夹具 post.volume 恒为 1_000_000，prefix rd=0 volume 亦然
    expect(first.observations["obs_2d.close"]).toBeCloseTo(bar2.close, 10);
    expect(first.observations["pullback_min_low_3d"]).toBeCloseTo(
      Math.min(...bars13.map((b) => b.low)),
      10,
    );
    // 夹具里 prefix rd=0 的 volume = 1_000_000 - 0 = 1_000_000，post.volume 恒为 1_000_000
    // ⇒ 最小量能比 = 1、末日量能比 = 1。这恰好证明比率口径被真实计算过（不是 null）。
    expect(first.observations["pullback_min_volume_ratio_3d"]).toBeCloseTo(1_000_000 / eventBar.volume, 10);
    expect(first.observations["pullback_last_volume_ratio_3d"]).toBeCloseTo(1_000_000 / eventBar.volume, 10);
  });

  it("没有 post 数据的数据集上装配观察日变量 ⇒ 数值全 null（不报错、不臆造）", async () => {
    const { reader } = buildSyntheticDataset({
      events: linearEvents(4),
      horizons: [5],
      maxPathDay: 5,
      withPost: false,
    });
    // 目录按真实数据构造 ⇒ 没有 post 就一个观察日变量也没有。
    const catalog = new ResearchVariableCatalog([5], PATH_DAYS, []);
    expect(catalog.listObservations()).toEqual([]);
    const assembled = await buildSampleSet({
      reader,
      datasetVersionId: TEST_DATASET_VERSION_ID,
      catalog,
      requirement: { features: ["turnover"], outcomes: [], observations: [] },
    });
    expect(assembled.samples.length).toBe(4);
    expect(assembled.samples[0]!.observations).toEqual({});
  });

  it("未登记的观察日变量名在装配期就失败（不静默变 null）", async () => {
    const { reader } = buildSyntheticDataset({ events: linearEvents(3), horizons: [5], maxPathDay: 5 });
    const catalog = makeCatalog(5);
    await expect(
      buildSampleSet({
        reader,
        datasetVersionId: TEST_DATASET_VERSION_ID,
        catalog,
        requirement: { features: ["turnover"], outcomes: [], observations: ["obs_9d.close"] },
      }),
    ).rejects.toThrow(ResearchEngineError);
  });
});

describe("观察日变量 · 端到端 CONDITIONAL 分析", () => {
  /**
   * 用户的策略形状：「回踩不破首板日最低价 → 买入」。
   * 这里用一个可控实验验证它真的能作为**条件**跑通，并且分母口径正确：
   *   - `pullback_holds_event_low_3d` = `min(low[1..3]) >= eventBar.low` 的 0/1；
   *   - 全样本 = 所有有 T+5 收益的事件，条件组 = 其中满足该条件的事件。
   *
   * 夹具口径（见 testFixtures 的 post 段）：`px = close × (1+ret)`、`low = px − 0.05`，
   * 而事件日 `eventBar.low = close − 0.05`。因此：
   *   `min(low[1..3]) >= close − 0.05`  ⟺  `min(ret[1..3]) >= 0`。
   * 用这条等价关系构造数据，条件就不再依赖夹具的浮点细节。
   */
  it("观察日条件可作条件集，样本分流正确且与手算一致", async () => {
    const events: SyntheticEventSpec[] = [
      // 前 3 个：T+1..T+3 全程不跌破事件日最低价 → 满足条件
      { index: 0, turnover: 1, futureReturn: (rd) => (rd <= 3 ? 0 : 0.05) },
      { index: 1, turnover: 2, futureReturn: (rd) => (rd <= 3 ? 0.01 : 0.06) },
      { index: 2, turnover: 3, futureReturn: (rd) => (rd <= 3 ? 0.02 : 0.07) },
      // 后 2 个：T+2 深度回撤（跌破事件日最低价）→ 不满足条件
      { index: 3, turnover: 4, futureReturn: (rd) => (rd <= 3 ? -0.15 : 0.02) },
      { index: 4, turnover: 5, futureReturn: (rd) => (rd <= 3 ? -0.2 : 0.03) },
    ];
    const ds = buildSyntheticDataset({ events, horizons: [5], maxPathDay: 5 });
    const catalog = makeCatalog(5);
    const conditionSet: ResearchConditionSet = {
      groups: [
        {
          groupNo: 0,
          groupLogicalOperator: "AND",
          conditions: [
            {
              groupNo: 0,
              sortOrder: 0,
              fieldName: "pullback_holds_event_low_3d",
              operator: "==",
              value: 1,
              logicalOperator: "AND",
              groupLogicalOperator: "AND",
            },
          ],
        },
      ],
    };

    const executor = createDefaultAnalysisExecutorRegistry().require("CONDITIONAL");
    const resolved = resolveEngineAnalysisConfig({
      analysis: {
        id: 1,
        runId: 1,
        analysisType: "CONDITIONAL",
        name: "回踩不破事件日最低价",
        config: { targetField: "future_return_5d" },
        status: "PENDING",
      },
      catalog,
    });
    const requirement = executor.requiredVariables(resolved, { catalog, conditionSet });
    // 条件字段必须被分流到 observations（不是 features / outcomes）。
    expect(requirement.observations).toEqual(["pullback_holds_event_low_3d"]);
    expect(requirement.features).toEqual([]);

    const set = await buildSampleSet({
      reader: ds.reader,
      datasetVersionId: ds.datasetVersionId,
      catalog,
      requirement,
      dimensionKeys: requirement.dimensions ?? [],
    });
    const result = await executor.execute({
      analysis: {
        id: 1,
        runId: 1,
        analysisType: "CONDITIONAL",
        name: "回踩不破事件日最低价",
        config: { targetField: "future_return_5d" },
        status: "PENDING",
      },
      config: resolved,
      datasetVersionId: ds.datasetVersionId,
      samples: set.samples,
      horizons: ds.context.horizons,
      conditionSet,
    });

    const byKey = new Map(
      result.rows
        .filter((r) => r.metricCode === "SAMPLE_COUNT")
        .map((r) => [(r.dimension as { group?: string })?.group, r.metricValue]),
    );
    expect(byKey.get("ALL")).toBe(5);
    expect(byKey.get("CONDITION")).toBe(3);
    expect(result.diagnostics).toMatchObject({ matchedConditionSamples: 3 });
  });
});
