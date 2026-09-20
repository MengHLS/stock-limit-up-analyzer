/**
 * RESEARCH-EXPERIMENT-004 · Run 持久化 —— Unit / Integration / Failure / Idempotency（规格 §19）。
 *
 * ## 为什么这一组测试必须存在
 *
 * 004 把「执行即丢失」改成「执行即落库 + 落对象存储」。新增的风险不是「算错了」，
 * 而是**一致性**：「DB 说完成、对象却不在」「执行失败、Run 永远 RUNNING」这类
 * 状态裂缝**不会让任何单测变红**，却会让页面开始撒谎（规格 §13 情况 A/B/C）。
 *
 * 因此本文件的主体不是「结果对不对」，而是：
 *   - 生命周期顺序（PENDING → RUNNING → COMPLETED/FAILED）**不可颠倒**；
 *   - 产物没落存储 ⇒ **绝不允许** COMPLETED；
 *   - 执行期失败 ⇒ **必须**收敛，不留 RUNNING 悬挂行；
 *   - 引用（`resultManifestKey`）**必须**指向真实存在的对象；
 *   - 重复 finalize 同一 Run ⇒ 不得产生不可控的重复状态（幂等）。
 *
 * 全部用真实领域代码 + 内存替身（仓储 / 对象存储），**不连真库、不连 MinIO**；
 * 真库 + 真 MinIO 的端到端验证由 `docs/evidence` 的 E2E 探针负责。
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EXPERIMENT_ARTIFACT_INLINE_PREVIEW_FORMATS,
  EXPERIMENT_ARTIFACT_INLINE_PREVIEW_MAX_BYTES,
  EXPERIMENT_MANIFEST_SCHEMA_VERSION,
  type ExperimentDefinition,
  type ExperimentRunRecord,
} from "@shared/researchExperimentsContracts";
import {
  InMemoryArtifactStorage,
  assertRunIdForObjectKey,
  assertSafeRelativeName,
  experimentRunKeyPrefix,
  isObjectKeyUnderRun,
  logObjectKey,
  manifestObjectKey,
  resultObjectKey,
  tableObjectKey,
} from "../../../server/artifactStorage";
import { ARTIFACT_STORAGE_ERROR, ArtifactStorageError } from "../../../server/artifactStorage/types";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentError } from "../../../server/researchExperiments/errors";
import {
  EXPERIMENT_RUN_STALE_AFTER_MS,
  INLINE_VIEW_MAX_BYTES,
  InMemoryExperimentRunRepository,
  assertManifestKeyPresent,
  assertRunTransition,
  buildRunManifest,
  computeStale,
  createExperimentRunService,
  isInlineViewable,
  parseRunManifest,
  summarizeOutcome,
  validateRunManifest,
} from "../../../server/researchExperiments/persistence";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";

const VERSION_ID = 900_400;
const RESULT_KEY_SAMPLE = "demo/persist";

const versionContext: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 120004,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-persist",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-06-30",
  totalEvents: 3,
  horizons: [5],
  pathRelativeDayRange: { min: 1, max: 5 },
  postRelativeDayRange: { min: 1, max: 5 },
  decisionOffsetDays: null,
};

/** 一个「正常」实验：写日志、声明一个 CSV 产物、返回可配平的样本账。 */
const persistDefinition: ExperimentDefinition = {
  descriptor: {
    id: "demo/persist",
    name: "持久化测试实验",
    version: "2.3.4",
    description: "用于验证 Run 持久化链路",
    source: "test",
    parameters: [{ code: "n", label: "数量", kind: "INT", required: false, defaultValue: 2 }],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: { events: ["isFirstLimit"] },
      prefixRelativeDays: [0],
      postRelativeDays: [],
      decisionOffsetDays: null,
      usesForwardData: false,
    },
    pageKey: "demo/persist",
    pageTitle: "持久化测试实验",
  },
  resultSchema: z.object({ ok: z.boolean() }),
  run: (context) => {
    context.log(`参数 n=${String(context.parameters.n)}`);
    context.artifact({
      name: "cohort.csv",
      role: "table",
      body: "symbol,ret\n600000,0.01\n",
      label: "样本明细",
    });
    return {
      sampleSummary: {
        candidateCount: 3,
        eligibleCount: 2,
        excludedCount: 1,
        excludedByReason: { NO_PREFIX_BAR: 1 },
      },
      statistics: [
        { code: "meanRet", label: "平均收益", value: 0.0123, unit: null, digits: 4 },
      ],
      customPayload: { ok: true },
    };
  },
};

/** 一个「执行期抛错」的实验（用来走「执行中失败 ⇒ 返回 FAILED outcome」那条出口）。 */
const failingDefinition: ExperimentDefinition = {
  ...persistDefinition,
  descriptor: {
    ...persistDefinition.descriptor,
    id: "demo/failing",
    name: "会失败的实验",
    pageKey: "demo/failing",
  },
  run: () => {
    throw new Error("实验内部炸了");
  },
};

interface Harness {
  runService: ReturnType<typeof createExperimentRunService>;
  repository: InMemoryExperimentRunRepository;
  storage: InMemoryArtifactStorage;
}

function buildHarness(options?: {
  storage?: InMemoryArtifactStorage;
  repository?: InMemoryExperimentRunRepository;
  generateRunId?: (now: Date) => string;
  now?: () => Date;
}): Harness {
  const registry = new ExperimentRegistry();
  registry.register(persistDefinition);
  registry.register(failingDefinition);

  const datasetPort = createRegistryExperimentDatasetPort({
    reader: new InMemoryResearchDatasetReader({
      context: versionContext,
      events: [],
      prefixBars: [],
      postBars: [],
    }),
    listVersionOptions: async (filter) =>
      filter?.datasetCode === undefined || filter.datasetCode === "first_limit_pullback"
        ? [
            {
              datasetVersionId: VERSION_ID,
              datasetCode: "first_limit_pullback",
              datasetName: "首板回踩",
              version: "v-persist",
              status: "READY",
              startDate: "2025-01-01",
              endDate: "2025-06-30",
              totalEvents: 3,
            },
          ]
        : [],
  });

  const runner = createExperimentRunner({ registry, datasetPort });
  const repository = options?.repository ?? new InMemoryExperimentRunRepository();
  const storage = options?.storage ?? new InMemoryArtifactStorage();

  const runService = createExperimentRunService({
    runner,
    repository,
    resolveStorage: () => storage,
    ...(options?.generateRunId !== undefined ? { generateRunId: options.generateRunId } : {}),
    ...(options?.now !== undefined ? { now: options.now } : {}),
  });

  return { runService, repository, storage };
}

// ---------------------------------------------------------------------------
// Unit：Object Key 规范（规格 §9）
// ---------------------------------------------------------------------------

describe("Object Key 规范（唯一产生点）", () => {
  it("Key 形态完全由 (实验, Run, 角色, 名字) 决定 —— 不用随机路径", () => {
    const prefix = experimentRunKeyPrefix("demo/persist", "RUN-1");
    expect(prefix).toBe("experiments/demo/persist/runs/RUN-1");
    expect(manifestObjectKey("demo/persist", "RUN-1")).toBe(`${prefix}/manifest.json`);
    expect(resultObjectKey("demo/persist", "RUN-1")).toBe(`${prefix}/result.json`);
    expect(tableObjectKey("demo/persist", "RUN-1", "cohort.csv")).toBe(
      `${prefix}/tables/cohort.csv`,
    );
    expect(logObjectKey("demo/persist", "RUN-1", "run.log")).toBe(`${prefix}/logs/run.log`);
  });

  it("runId 里的 key 注入（`/`、`..`、反斜杠）被**结构级**拒绝", () => {
    expect(() => assertRunIdForObjectKey("../evil")).toThrowError(/不符合 Object Key 规范/u);
    expect(() => assertRunIdForObjectKey("a/b")).toThrowError(/不符合 Object Key 规范/u);
    expect(() => assertRunIdForObjectKey("a\\b")).toThrowError(/不符合 Object Key 规范/u);
    expect(() => assertRunIdForObjectKey(".hidden")).toThrowError(/不符合 Object Key 规范/u);
    // 合法形态不被误伤。
    expect(assertRunIdForObjectKey("RUN-20260920-ABCD1234")).toBe("RUN-20260920-ABCD1234");
  });

  it("产物名字：越界 / 绝对 / 反斜杠一律拒", () => {
    expect(() => assertSafeRelativeName("")).toThrowError(ArtifactStorageError);
    expect(() => assertSafeRelativeName("/etc/passwd")).toThrowError(/不得以斜杠开头/u);
    expect(() => assertSafeRelativeName("tables/../secret.csv")).toThrowError(/越界段/u);
    expect(() => assertSafeRelativeName("a\\b.csv")).toThrowError(/反斜杠/u);
    expect(assertSafeRelativeName(" tables/cohort.csv ")).toBe("tables/cohort.csv");
  });

  it("isObjectKeyUnderRun：只认本 Run 前缀（跨 Run 读取的**结构闸**）", () => {
    expect(
      isObjectKeyUnderRun("experiments/demo/persist/runs/RUN-1/result.json", "demo/persist", "RUN-1"),
    ).toBe(true);
    expect(
      isObjectKeyUnderRun("experiments/demo/persist/runs/RUN-2/result.json", "demo/persist", "RUN-1"),
    ).toBe(false);
    // 非法的 runId ⇒ 前缀算不出来 ⇒ 一律 false（不抛错，只拒绝）。
    expect(isObjectKeyUnderRun("whatever", "demo/persist", "../evil")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit：Manifest 契约（规格 §10）
// ---------------------------------------------------------------------------

describe("Manifest 契约", () => {
  const ref = {
    key: "experiments/demo/persist/runs/RUN-1/result.json",
    kind: "RESULT" as const,
    format: "json",
    contentType: "application/json",
    sizeBytes: 12,
    createdAt: "2026-09-20T00:00:00.000Z",
    label: "结果信封",
  };

  it("buildRunManifest 产出稳定结构（result 是引用，不是内容）", () => {
    const manifest = buildRunManifest({
      experimentId: "demo/persist",
      experimentVersion: "2.3.4",
      runId: "RUN-1",
      datasetVersionId: VERSION_ID,
      createdAt: "2026-09-20T00:00:00.000Z",
      result: ref,
      tables: [],
      charts: [],
      artifacts: [],
    });
    expect(manifest.schemaVersion).toBe(EXPERIMENT_MANIFEST_SCHEMA_VERSION);
    expect(manifest.experimentCode).toBe("demo/persist");
    expect(manifest.datasetVersionId).toBe(VERSION_ID);
    expect(manifest.result?.key).toBe(ref.key);
  });

  it("坐标自洽校验：把 A 的 Manifest 挪到 B ⇒ 当场拒（不是事后发现）", () => {
    const manifest = buildRunManifest({
      experimentId: "demo/persist",
      experimentVersion: "1.0.0",
      runId: "RUN-1",
      datasetVersionId: VERSION_ID,
      createdAt: "2026-09-20T00:00:00.000Z",
      result: null,
    });
    expect(() =>
      validateRunManifest(manifest, {
        experimentId: "demo/persist",
        runId: "RUN-OTHER",
        datasetVersionId: VERSION_ID,
      }),
    ).toThrowError(/runId=RUN-1 ≠ RUN-OTHER/u);
    expect(() =>
      validateRunManifest(manifest, {
        experimentId: "demo/persist",
        runId: "RUN-1",
        datasetVersionId: VERSION_ID + 1,
      }),
    ).toThrowError(/datasetVersionId/u);
  });

  it("parseRunManifest：坏 JSON / 缺字段 ⇒ EXPERIMENT_MANIFEST_INVALID", () => {
    const expected = { experimentId: "demo/persist", runId: "RUN-1", datasetVersionId: VERSION_ID };
    expect(() => parseRunManifest("{不是 JSON", expected)).toThrowError(
      /EXPERIMENT_MANIFEST_INVALID|不是合法 JSON/u,
    );
    try {
      parseRunManifest("{}", expected);
      throw new Error("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(ExperimentError);
      expect((error as ExperimentError).code).toBe("EXPERIMENT_MANIFEST_INVALID");
    }
  });
});

// ---------------------------------------------------------------------------
// Unit：状态迁移与 stale（规格 §12 / §13 情况 B）
// ---------------------------------------------------------------------------

describe("Run 状态迁移（唯一权威表）", () => {
  it("合法迁移通过、终态不可再迁移", () => {
    expect(() => assertRunTransition("R", "PENDING", "RUNNING")).not.toThrow();
    expect(() => assertRunTransition("R", "PENDING", "FAILED")).not.toThrow();
    expect(() => assertRunTransition("R", "RUNNING", "COMPLETED")).not.toThrow();
    expect(() => assertRunTransition("R", "RUNNING", "FAILED")).not.toThrow();
    for (const terminal of ["COMPLETED", "FAILED"] as const) {
      for (const target of ["PENDING", "RUNNING", "COMPLETED", "FAILED"] as const) {
        expect(() => assertRunTransition("R", terminal, target)).toThrowError(
          /不允许从/u,
        );
      }
    }
  });

  it("stale 只标注不改写：RUNNING 超阈值才算卡住", () => {
    const nowIso = "2026-09-20T12:00:00.000Z";
    const longAgo = new Date(
      new Date(nowIso).getTime() - EXPERIMENT_RUN_STALE_AFTER_MS - 60_000,
    ).toISOString();
    expect(computeStale("RUNNING", longAgo, nowIso)).toBe(true);
    expect(computeStale("RUNNING", nowIso, nowIso)).toBe(false);
    // 终态与「还没开始」都不算卡住 —— stale 的语义仅限「停在 RUNNING 太久」。
    expect(computeStale("COMPLETED", longAgo, nowIso)).toBe(false);
    expect(computeStale("FAILED", longAgo, nowIso)).toBe(false);
    expect(computeStale("PENDING", null, nowIso)).toBe(false);
  });

  it("没有 Manifest Key 就不许 COMPLETED（规格 §13 情况 A 的结构闸）", () => {
    expect(() => assertManifestKeyPresent("RUN-1", "  ")).toThrowError(ExperimentError);
    expect(() => assertManifestKeyPresent("RUN-1", "a/b/manifest.json")).not.toThrow();
  });

  it("summarizeOutcome / isInlineViewable 与服务端契约常量一致", () => {
    expect(INLINE_VIEW_MAX_BYTES).toBe(EXPERIMENT_ARTIFACT_INLINE_PREVIEW_MAX_BYTES);
    expect(isInlineViewable("json", 1024)).toBe(true);
    expect(isInlineViewable("JSON", 1024)).toBe(true);
    expect(isInlineViewable("text", 1024)).toBe(true);
    expect(isInlineViewable("parquet", 1024)).toBe(false);
    expect(isInlineViewable("json", EXPERIMENT_ARTIFACT_INLINE_PREVIEW_MAX_BYTES + 1)).toBe(false);
    expect(isInlineViewable("json", null)).toBe(false);
    expect(EXPERIMENT_ARTIFACT_INLINE_PREVIEW_FORMATS).toContain("json");
  });
});

// ---------------------------------------------------------------------------
// Integration：完整链路（规格 §12 十步 / §19 Integration）
// ---------------------------------------------------------------------------

describe("集成：Experiment → Run → Result → 对象存储 → Manifest → DB → 读回", () => {
  it("顺序落库并写全产物；重新查询可完整读回（页面刷新不必重跑）", async () => {
    const { runService, storage, repository } = buildHarness();

    const execution = await runService.execute({
      experimentId: "demo/persist",
      datasetVersionId: VERSION_ID,
      parameters: { n: 7 },
    });

    // ① DB 侧：COMPLETED + Manifest 引用 + 轻量摘要
    expect(execution.persisted).toBe(true);
    const run = execution.run;
    expect(run).not.toBeNull();
    expect(run!.status).toBe("COMPLETED");
    expect(run!.experimentName).toBe("持久化测试实验");
    expect(run!.experimentVersion).toBe("2.3.4");
    expect(run!.datasetVersionLabel).toBe("v-persist");
    expect(run!.parameters).toEqual({ n: 7 });
    expect(run!.errorCode).toBeNull();
    expect(run!.completedAt).not.toBeNull();
    expect(run!.resultManifestKey).toBe(manifestObjectKey("demo/persist", run!.runId));
    expect(run!.resultSchemaVersion).toBe("1.0.0");
    expect(run!.summary?.candidateCount).toBe(3);
    expect(run!.summary?.eligibleCount).toBe(2);
    expect(run!.summary?.excludedCount).toBe(1);
    expect(run!.summary?.excludedByReason).toEqual({ NO_PREFIX_BAR: 1 });
    expect(run!.summary?.logLineCount).toBe(1);

    // ② 对象存储侧：result / 声明的 CSV / 日志 / manifest 都在，且**真的是同一条 Run 的 Key**
    const manifestKey = manifestObjectKey("demo/persist", run!.runId);
    const resultKey = resultObjectKey("demo/persist", run!.runId);
    const csvKey = tableObjectKey("demo/persist", run!.runId, "cohort.csv");
    const logKey = logObjectKey("demo/persist", run!.runId, "run.log");
    for (const key of [resultKey, csvKey, logKey, manifestKey]) {
      expect(await storage.exists(key)).toBe(true);
    }
    expect(storage.peekText(csvKey)).toBe("symbol,ret\n600000,0.01\n");
    expect(storage.peekText(logKey)).toBe("参数 n=7\n");

    // ③ 重新读取（等价于用户关掉页面再打开）：Run 元数据 + Manifest + Result + 产物
    const again = await runService.getRun(run!.runId);
    expect(again?.status).toBe("COMPLETED");
    expect(again?.resultManifestKey).toBe(manifestKey);

    const manifest = await runService.readManifest(run!.runId);
    expect(manifest).not.toBeNull();
    expect(manifest!.runId).toBe(run!.runId);
    expect(manifest!.experimentCode).toBe(RESULT_KEY_SAMPLE);
    expect(manifest!.result?.key).toBe(resultKey);
    expect(manifest!.tables.map((t) => t.key)).toEqual([csvKey]);
    expect(manifest!.artifacts.map((a) => a.key)).toEqual([logKey]);

    const detail = await runService.readRunDetail(run!.runId);
    expect(detail.artifactsAvailable).toBe(true);
    expect(detail.artifactsError).toBeNull();
    expect(detail.result?.parameters).toEqual({ n: 7 });
    expect(detail.result?.customPayload).toEqual({ ok: true });
    // 每个产物都被**实测**过存在性（不是照抄 Manifest）：result + cohort.csv + run.log。
    // ⚠️ Manifest 自身**不在**产物目录里（它是索引，不是产物）。
    expect(detail.artifacts).toHaveLength(3);
    expect(detail.artifacts.every((item) => item.present)).toBe(true);
    expect(detail.artifacts.map((item) => item.ref.key).sort()).toEqual(
      [csvKey, logKey, resultKey].sort(),
    );
    expect(detail.artifacts.find((item) => item.ref.key === resultKey)?.inlineViewable).toBe(true);

    // ④ Result 内容确实可读（浏览器 → API → 对象存储 的那条路径）
    const fetched = await runService.readArtifact(run!.runId, resultKey);
    expect(JSON.parse(fetched.body.toString("utf8")).customPayload).toEqual({ ok: true });

    // ⑤ 「一个 Experiment → 多个 Run」且**不覆盖历史 Run**
    const second = await runService.execute({
      experimentId: "demo/persist",
      datasetVersionId: VERSION_ID,
      parameters: { n: 8 },
    });
    expect(second.run!.runId).not.toBe(run!.runId);
    const all = await runService.listRuns({ experimentId: "demo/persist" });
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.runId)).toContain(run!.runId);
    expect(await runService.countRunsByExperiment("demo/persist")).toBe(2);
    // 第一条 Run 的行没有被第二条覆盖。
    expect((await repository.getRun(run!.runId))?.parameters).toEqual({ n: 7 });
    // 最近一条 = 第二次（列表页「Latest Run」的事实来源）
    const latest = await runService.latestRunByExperiment();
    expect(latest.get("demo/persist")?.runId).toBe(second.run!.runId);
  });

  it("执行期失败 ⇒ outcome FAILED + Run FAILED，且**不写任何对象**（不留悬挂 RUNNING）", async () => {
    const { runService, storage, repository } = buildHarness();
    const execution = await runService.execute({
      experimentId: "demo/failing",
      datasetVersionId: VERSION_ID,
    });

    expect(execution.persisted).toBe(true);
    expect(execution.outcome.runStatus).toBe("FAILED");
    expect(execution.outcome.result).toBeNull();
    expect(execution.run?.status).toBe("FAILED");
    expect(execution.run?.errorMessage).toContain("实验内部炸了");
    expect(execution.run?.resultManifestKey).toBeNull();
    expect(storage.size).toBe(0);
    // 没有第二条状态：Run 行只有一条，且已收敛。
    expect((await runService.listRuns({ experimentId: "demo/failing" })).length).toBe(1);
    expect(await repository.getRun(execution.run!.runId).then((r) => r?.status)).toBe("FAILED");
  });

  it("请求本身不成立（未注册实验）⇒ 直接抛领域错误，**不留任何行**", async () => {
    const { runService, repository } = buildHarness();
    await expect(
      runService.execute({ experimentId: "no/such", datasetVersionId: VERSION_ID }),
    ).rejects.toThrowError(/EXPERIMENT_NOT_FOUND|未注册/u);
    expect(await repository.listRuns()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Failure：存储侧故障（规格 §13 情况 A / §19 Failure）
// ---------------------------------------------------------------------------

describe("失败路径：对象存储不可用 / 上传失败（情况 A 的守门）", () => {
  it("存储不可用 ⇒ Run=FAILED（**绝不 COMPLETED**），但真实 outcome 仍如实返回", async () => {
    const storage = new InMemoryArtifactStorage({ unavailable: true });
    const { runService, repository } = buildHarness({ storage });

    const execution = await runService.execute({
      experimentId: "demo/persist",
      datasetVersionId: VERSION_ID,
    });

    expect(execution.outcome.runStatus).toBe("SUCCEEDED"); // 实验**确实算完了**
    expect(execution.persisted).toBe(true);
    expect(execution.run?.status).toBe("FAILED"); // 但没能落存储 ⇒ 不许声称完成
    expect(execution.run?.errorCode).toBe("EXPERIMENT_ARTIFACT_STORAGE_UNAVAILABLE");
    expect(execution.run?.resultManifestKey).toBeNull();
    expect(execution.run?.errorMessage).toContain("不允许标记 COMPLETED");

    // 全库扫描：不存在任何 COMPLETED 的 Run（情况 A 的结构性禁令）
    const all = await repository.listRuns();
    expect(all).toHaveLength(1);
    expect(all.every((record) => record.status !== "COMPLETED")).toBe(true);
  });

  it("上传失败（PUT_FAILED）⇒ Run=FAILED 且错误码 = EXPERIMENT_ARTIFACT_UPLOAD_FAILED", async () => {
    const storage = new InMemoryArtifactStorage({ failPut: true });
    const { runService } = buildHarness({ storage });

    const execution = await runService.execute({
      experimentId: "demo/persist",
      datasetVersionId: VERSION_ID,
    });

    expect(execution.outcome.runStatus).toBe("SUCCEEDED");
    expect(execution.run?.status).toBe("FAILED");
    expect(execution.run?.errorCode).toBe("EXPERIMENT_ARTIFACT_UPLOAD_FAILED");
  });

  it("上传成功但对象随即消失（验证阶段发现）⇒ 仍收敛为 FAILED，不用 COMPLETED 埋雷", async () => {
    // 用「上传后立刻被别人删掉」模拟：这里通过自定义替身让 exists 恒 false。
    const storage = new InMemoryArtifactStorage();
    const flaky = Object.create(storage) as InMemoryArtifactStorage;
    let puts = 0;
    Object.defineProperty(flaky, "exists", {
      value: async (key: string) => {
        puts += 1;
        // 第一次验证（Manifest 里的首个对象）故意说「不在」。
        if (puts === 1) return false;
        return storage.exists(key);
      },
    });

    const { runService } = buildHarness({ storage: flaky });
    const execution = await runService.execute({
      experimentId: "demo/persist",
      datasetVersionId: VERSION_ID,
    });
    expect(execution.run?.status).toBe("FAILED");
    expect(execution.run?.errorCode).toBe("EXPERIMENT_ARTIFACT_UPLOAD_FAILED");
    expect(execution.run?.errorMessage).toContain("读不到");
  });
});

// ---------------------------------------------------------------------------
// Failure：读路径的诚实性（规格 §13 情况 C）
// ---------------------------------------------------------------------------

describe("读路径：引用与对象不一致时必须如实报告", () => {
  it("对象被外部删除 ⇒ 仍然可读，但 missing 被点名、inlineViewable=false", async () => {
    const { runService, storage } = buildHarness();
    const execution = await runService.execute({
      experimentId: "demo/persist",
      datasetVersionId: VERSION_ID,
    });
    const runId = execution.run!.runId;
    const csvKey = tableObjectKey("demo/persist", runId, "cohort.csv");
    storage.removeForTests(csvKey);

    const detail = await runService.readRunDetail(runId);
    expect(detail.manifest).not.toBeNull();
    expect(detail.artifactsAvailable).toBe(true);
    expect(detail.artifactsError?.code).toBe("EXPERIMENT_ARTIFACT_NOT_FOUND");
    const gone = detail.artifacts.find((item) => item.ref.key === csvKey);
    expect(gone?.present).toBe(false);
    expect(gone?.inlineViewable).toBe(false);
    // 其它产物不受影响（不是整页报错）：result + run.log 仍在。
    expect(detail.artifacts.filter((item) => item.present).length).toBe(2);
  });

  it("Manifest 内容被改坏 ⇒ artifactsAvailable=false 并给出 EXPERIMENT_MANIFEST_INVALID", async () => {
    const { runService, storage } = buildHarness();
    const execution = await runService.execute({
      experimentId: "demo/persist",
      datasetVersionId: VERSION_ID,
    });
    const runId = execution.run!.runId;
    await storage.put(manifestObjectKey("demo/persist", runId), "{坏的", {
      contentType: "application/json",
    });

    const detail = await runService.readRunDetail(runId);
    expect(detail.artifactsAvailable).toBe(false);
    expect(detail.manifest).toBeNull();
    expect(detail.result).toBeNull();
    expect(detail.artifactsError?.code).toBe("EXPERIMENT_MANIFEST_INVALID");
    // Run 元数据（TiDB 事实）仍然完好 —— 页面不该因为存储坏掉就整页读不出来。
    expect(detail.run.status).toBe("COMPLETED");
  });

  it("存储整体不可读 ⇒ artifactsAvailable=false 且 manifest/result 为 null（不伪造空结果）", async () => {
    const { runService, storage } = buildHarness();
    const execution = await runService.execute({
      experimentId: "demo/persist",
      datasetVersionId: VERSION_ID,
    });
    const runId = execution.run!.runId;
    const down = new InMemoryArtifactStorage({ unavailable: true });
    // 换掉装配里的存储：直接构造一个新 service（同一个仓储）。
    const repository = new InMemoryExperimentRunRepository();
    await repository.createRun({
      runId,
      experimentId: "demo/persist",
      experimentName: "持久化测试实验",
      experimentVersion: "2.3.4",
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetVersionLabel: "v-persist",
      parameters: { n: 2 },
    });
    await repository.markRunning(runId);
    await repository.markCompleted(runId, {
      manifestKey: manifestObjectKey("demo/persist", runId),
      resultSchemaVersion: "1.0.0",
      summary: null,
      durationMs: 1,
    });
    expect(storage.size).toBeGreaterThan(0); // 原存储里确实有东西

    const offline = buildHarness({ storage: down, repository });
    const detail = await offline.runService.readRunDetail(runId);
    expect(detail.artifactsAvailable).toBe(false);
    expect(detail.manifest).toBeNull();
    expect(detail.result).toBeNull();
    expect(detail.run.status).toBe("COMPLETED");
  });
});

// ---------------------------------------------------------------------------
// Read 授权：下载白名单（规格 §18）
// ---------------------------------------------------------------------------

describe("Artifact 读取授权（两道闸）", () => {
  it("未登记进 Manifest 的 Key ⇒ EXPERIMENT_ARTIFACT_NOT_FOUND", async () => {
    const { runService } = buildHarness();
    const execution = await runService.execute({
      experimentId: "demo/persist",
      datasetVersionId: VERSION_ID,
    });
    const runId = execution.run!.runId;
    const cloakKey = tableObjectKey("demo/persist", runId, "not-published.csv");
    await expect(runService.readArtifact(runId, cloakKey)).rejects.toThrowError(
      /EXPERIMENT_ARTIFACT_NOT_FOUND|不在 Run/u,
    );
  });

  it("跨 Run 的 Key ⇒ 结构闸拒绝（EXPERIMENT_ARTIFACT_KEY_INVALID）", async () => {
    const { runService } = buildHarness();
    const execution = await runService.execute({
      experimentId: "demo/persist",
      datasetVersionId: VERSION_ID,
    });
    const runId = execution.run!.runId;
    const otherRunKey = resultObjectKey("demo/persist", "RUN-OTHER-0003");
    try {
      await runService.readArtifact(runId, otherRunKey);
      throw new Error("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(ExperimentError);
      expect((error as ExperimentError).code).toBe("EXPERIMENT_ARTIFACT_KEY_INVALID");
    }
  });

  it("非法 Key（越界段）在任何存储访问之前就被拒", async () => {
    const { runService } = buildHarness();
    const execution = await runService.execute({
      experimentId: "demo/persist",
      datasetVersionId: VERSION_ID,
    });
    await expect(
      runService.readArtifact(execution.run!.runId, "experiments/../secret"),
    ).rejects.toThrowError(ArtifactStorageError);
  });

  it("读不存在的 Run ⇒ EXPERIMENT_RUN_NOT_FOUND（不返回空对象）", async () => {
    const { runService } = buildHarness();
    await expect(runService.readRunDetail("RUN-NOPE")).rejects.toThrowError(
      /EXPERIMENT_RUN_NOT_FOUND|不存在/u,
    );
    await expect(runService.readManifest("RUN-NOPE")).rejects.toThrowError(/不存在/u);
  });
});

// ---------------------------------------------------------------------------
// Idempotency：重复 finalize 不得产生不可控重复状态
// ---------------------------------------------------------------------------

describe("幂等：重复 finalize / Run id 冲突 / 人工收敛", () => {
  it("同一 Run 用同一 Manifest Key 重复 markCompleted ⇒ 幂等 no-op（不抛错、不改内容）", async () => {
    const repository = new InMemoryExperimentRunRepository();
    await repository.createRun({
      runId: "RUN-IDEMPOTENT-1",
      experimentId: "demo/persist",
      experimentName: "x",
      experimentVersion: "1.0.0",
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetVersionLabel: "v-persist",
      parameters: {},
    });
    await repository.markRunning("RUN-IDEMPOTENT-1");
    const manifestKey = manifestObjectKey("demo/persist", "RUN-IDEMPOTENT-1");
    const first = await repository.markCompleted("RUN-IDEMPOTENT-1", {
      manifestKey,
      resultSchemaVersion: "1.0.0",
      summary: null,
      durationMs: 42,
      completedAt: "2026-09-20T00:00:10.000Z",
    });
    const second = await repository.markCompleted("RUN-IDEMPOTENT-1", {
      manifestKey,
      resultSchemaVersion: "1.0.0",
      summary: null,
      durationMs: 42,
      completedAt: "2026-09-20T00:00:10.000Z",
    });
    expect(second.status).toBe("COMPLETED");
    expect(second.resultManifestKey).toBe(first.resultManifestKey);
    expect(second.durationMs).toBe(first.durationMs);
  });

  it("同一 Run 用**不同** Manifest Key 重复 finalize ⇒ 拒绝（不静默改引用）", async () => {
    const repository = new InMemoryExperimentRunRepository();
    await repository.createRun({
      runId: "RUN-IDEMPOTENT-2",
      experimentId: "demo/persist",
      experimentName: "x",
      experimentVersion: "1.0.0",
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetVersionLabel: "v-persist",
      parameters: {},
    });
    await repository.markRunning("RUN-IDEMPOTENT-2");
    await repository.markCompleted("RUN-IDEMPOTENT-2", {
      manifestKey: manifestObjectKey("demo/persist", "RUN-IDEMPOTENT-2"),
      resultSchemaVersion: "1.0.0",
      summary: null,
      durationMs: 1,
    });
    // 断言**领域码**（不是消息文案 —— 文案会变，码是契约）。
    const conflict = await repository
      .markCompleted("RUN-IDEMPOTENT-2", {
        manifestKey: manifestObjectKey("demo/persist", "RUN-OTHER-KEY"),
        resultSchemaVersion: "1.0.0",
        summary: null,
        durationMs: 1,
      })
      .catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ExperimentError);
    expect((conflict as ExperimentError).code).toBe("EXPERIMENT_RUN_STATE_INVALID");
    // 引用没有被改掉（不静默覆盖）。
    expect((await repository.getRun("RUN-IDEMPOTENT-2"))?.resultManifestKey).toBe(
      manifestObjectKey("demo/persist", "RUN-IDEMPOTENT-2"),
    );
  });

  it("重复 markFailed 幂等；已 COMPLETED 的 Run 不会被打回 FAILED", async () => {
    const repository = new InMemoryExperimentRunRepository();
    await repository.createRun({
      runId: "RUN-IDEMPOTENT-3",
      experimentId: "demo/persist",
      experimentName: "x",
      experimentVersion: "1.0.0",
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetVersionLabel: "v-persist",
      parameters: {},
    });
    await repository.markRunning("RUN-IDEMPOTENT-3");
    const failed = await repository.markFailed("RUN-IDEMPOTENT-3", {
      errorCode: "EXPERIMENT_RUN_FAILED",
      errorMessage: "第一次失败",
      durationMs: null,
    });
    const again = await repository.markFailed("RUN-IDEMPOTENT-3", {
      errorCode: "EXPERIMENT_RUN_FAILED",
      errorMessage: "第二次失败",
      durationMs: null,
    });
    expect(again.errorMessage).toBe(failed.errorMessage);
    expect(again.status).toBe("FAILED");
  });

  it("Run id 连续冲突 ⇒ 抛 EXPERIMENT_RUN_ID_CONFLICT（而不是撞出一个重复行）", async () => {
    const repository = new InMemoryExperimentRunRepository();
    await repository.createRun({
      runId: "RUN-FIXED-0001",
      experimentId: "demo/persist",
      experimentName: "x",
      experimentVersion: "1.0.0",
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetVersionLabel: "v-persist",
      parameters: {},
    });
    const { runService } = buildHarness({
      repository,
      generateRunId: () => "RUN-FIXED-0001",
    });
    await expect(
      runService.execute({ experimentId: "demo/persist", datasetVersionId: VERSION_ID }),
    ).rejects.toThrowError(/EXPERIMENT_RUN_ID_CONFLICT|冲突/u);
    // 冲突没有产生第二行。
    expect(await repository.countRunsByExperiment("demo/persist")).toBe(1);
  });

  it("reconcileRun：RUNNING → FAILED（带留痕）；非 RUNNING 一律拒", async () => {
    const { runService, repository } = buildHarness();
    await repository.createRun({
      runId: "RUN-STUCK-1",
      experimentId: "demo/persist",
      experimentName: "x",
      experimentVersion: "1.0.0",
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetVersionLabel: "v-persist",
      parameters: {},
    });
    await repository.markRunning("RUN-STUCK-1");
    const reconciled = await runService.reconcileRun("RUN-STUCK-1", "服务重启导致中断");
    expect(reconciled.status).toBe("FAILED");
    expect(reconciled.errorCode).toBe("EXPERIMENT_RUN_RECONCILED");
    expect(reconciled.errorMessage).toContain("服务重启导致中断");
    // 再收敛一次 ⇒ 已经不是 RUNNING，拒绝（不重复改状态）。
    await expect(runService.reconcileRun("RUN-STUCK-1", "再来一次")).rejects.toThrowError(
      /EXPERIMENT_RUN_STATE_INVALID|只有 RUNNING/u,
    );
  });

  it("落库行本身不会出现「COMPLETED 但无 manifestKey」的非法组合", async () => {
    const repository = new InMemoryExperimentRunRepository();
    const created: ExperimentRunRecord = await repository.createRun({
      runId: "RUN-INTEGRITY-1",
      experimentId: "demo/persist",
      experimentName: "x",
      experimentVersion: "1.0.0",
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetVersionLabel: "v-persist",
      parameters: {},
    });
    expect(created.status).toBe("PENDING");
    await repository.markRunning("RUN-INTEGRITY-1");
    await expect(
      repository.markCompleted("RUN-INTEGRITY-1", {
        manifestKey: "   ",
        resultSchemaVersion: "1.0.0",
        summary: null,
        durationMs: 1,
      }),
    ).rejects.toThrowError(ExperimentError);
    expect((await repository.getRun("RUN-INTEGRITY-1"))?.status).toBe("RUNNING");
  });
});

// ---------------------------------------------------------------------------
// 装配期纪律：存储未配置时不该在装配期就炸（惰性）
// ---------------------------------------------------------------------------

describe("惰性解析对象存储", () => {
  it("未调用任何存储操作时，resolveStorage 不被求值（=> 未配 MinIO 也能读列表/历史 Run）", async () => {
    const registry = new ExperimentRegistry();
    registry.register(persistDefinition);
    let calls = 0;
    const repository = new InMemoryExperimentRunRepository();
    const service = createExperimentRunService({
      runner: createExperimentRunner({
        registry,
        datasetPort: createRegistryExperimentDatasetPort({
          reader: new InMemoryResearchDatasetReader({
            context: versionContext,
            events: [],
            prefixBars: [],
            postBars: [],
          }),
        }),
      }),
      repository,
      resolveStorage: () => {
        calls += 1;
        throw new ArtifactStorageError(
          ARTIFACT_STORAGE_ERROR.NOT_CONFIGURED,
          "（测试）未配置 MinIO",
        );
      },
    });

    await repository.createRun({
      runId: "RUN-LAZY-1",
      experimentId: "demo/persist",
      experimentName: "x",
      experimentVersion: "1.0.0",
      datasetVersionId: VERSION_ID,
      datasetCode: "first_limit_pullback",
      datasetVersionLabel: "v-persist",
      parameters: {},
    });
    // 纯读路径完全不碰存储。
    expect((await service.getRun("RUN-LAZY-1"))?.status).toBe("PENDING");
    expect(await service.listRuns({ experimentId: "demo/persist" })).toHaveLength(1);
    expect(calls).toBe(0);

    // 需要读产物时才炸 —— 而且炸出来的是可读的「未配置」而不是神秘异常。
    const detail = await service.readRunDetail("RUN-LAZY-1");
    expect(detail.artifactsAvailable).toBe(true);
    expect(detail.manifest).toBeNull();
  });
});
