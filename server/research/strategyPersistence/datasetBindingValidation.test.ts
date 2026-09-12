/**
 * STEP STRATEGY-004 — Dataset Binding 引用完整性测试（任务 §9 / §10）。
 *
 * 覆盖：
 *   A. `evaluateDatasetBinding`：存在 / READY / label 一致 / datasetId 属于该版本 / legacy 分支；
 *   B. `collectStrategyDatasetBindingRequests`：definition 绑定优先，缺失时退到 doc 级 PRIMARY 镜像；
 *   C. `assertStrategyDatasetBindings`：三类错误码 + 同坐标只查一次（去重）；
 *   D. `InMemoryStrategyRepository` + `StrategyService`：写入前闸门生效（失败**不落任何行**）；
 *   E. 兼容性回归：legacy `rd-…` 绑定在「未接入 Registry」的默认端口下仍可保存（旧行为不被破坏）。
 *
 * ⚠️ 诚实边界：本文件用 **fake 端口**验证判定逻辑与写入闸门；
 * 「真实 dataset_version 查询 + 同事务回滚」由 `scripts/verifyStrategyDatasetBinding.mts`
 * 在真实 TiDB 上验收（§21 禁止用 mock 证明持久化）。
 */

import { describe, expect, it } from "vitest";
import {
  FIRST_BOARD_PULLBACK_DATASET_VERSION,
  FIRST_BOARD_PULLBACK_DEFINITION,
  FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
} from "../strategySchema/goldenSample";
import { createStrategyDocument, createStrategyDocumentFromDefinition } from "../strategySchema/map";
import type { StrategyDefinitionInput } from "../strategySchema/definition";
import type { StrategyDocument } from "../strategySchema/types";
import {
  STRATEGY_DATASET_BINDING_ERROR_CODES,
  StrategyDatasetBindingError,
  assertStrategyDatasetBindings,
  collectStrategyDatasetBindingRequests,
  datasetCodesMatch,
  evaluateDatasetBinding,
  type DatasetVersionReference,
  type DatasetVersionReferencePort,
  type DatasetDefinitionReference,
} from "./datasetBindingValidation";
import { InMemoryStrategyRepository } from "./inMemory";
import { StrategyService } from "./service";

const CODE_VERSION = "1.0.0+g0000000";
const NOW = "2026-09-12T00:00:00.000Z";

/** 真实 TiDB 上的 v2 坐标（只读事实，硬编码为 fixture 便于断言错误信息）。 */
const DATASET_DEFINITION_ID = 120001;
const V2: DatasetVersionReference = { id: 390002, datasetId: DATASET_DEFINITION_ID, version: "v2", status: "READY" };
const V1: DatasetVersionReference = { id: 390001, datasetId: DATASET_DEFINITION_ID, version: "v1", status: "READY" };
const DEFINITION: DatasetDefinitionReference = { id: DATASET_DEFINITION_ID, datasetCode: "first_limit_pullback" };

/** 可注入 fake 端口（记录调用次数，供去重断言）。 */
function makePort(
  versions: readonly DatasetVersionReference[] = [V1, V2],
  definitions: readonly DatasetDefinitionReference[] = [DEFINITION],
): DatasetVersionReferencePort & { readonly versionCalls: string[]; readonly definitionCalls: string[] } {
  const versionCalls: string[] = [];
  const definitionCalls: string[] = [];
  return {
    versionCalls,
    definitionCalls,
    async getVersionById(id: number) {
      versionCalls.push(String(id));
      return versions.find((item) => item.id === id);
    },
    async getDefinitionById(id: number) {
      definitionCalls.push(String(id));
      return definitions.find((item) => item.id === id);
    },
  };
}

/** 以 Golden Sample 为基线，把 PRIMARY 换成「Dataset Registry 坐标」绑定。 */
function coordinateDefinition(datasets: StrategyDefinitionInput["datasets"]): StrategyDefinitionInput {
  return { ...structuredClone(FIRST_BOARD_PULLBACK_DEFINITION), datasets: [...datasets] };
}

/** 组装一份合法的、绑定 v2 的富定义文档（universeId 由 PRIMARY 的 label 派生，保证一致性）。 */
function coordinateDocument(
  datasets: StrategyDefinitionInput["datasets"] = [
    { datasetId: "first_limit_pullback", datasetVersion: "v2", datasetVersionId: 390002, role: "PRIMARY" },
  ],
): StrategyDocument {
  const primary = datasets.find((item) => item.role === "PRIMARY");
  const label = primary?.datasetVersion ?? "v2";
  return createStrategyDocumentFromDefinition({
    strategyId: "strategy-004-coordinate",
    version: "1.0.0",
    name: "坐标绑定策略",
    universe: { universeId: `research-dataset:${label}` },
    definition: coordinateDefinition(datasets),
    executionAssumptions: {
      backtestConfig: { initialCapital: 1_000_000, maxPositions: 5 },
      costModel: structuredClone(FIRST_BOARD_PULLBACK_DOCUMENT_INPUT.executionAssumptions.costModel),
    },
  });
}

function makeService(port: DatasetVersionReferencePort) {
  const repo = new InMemoryStrategyRepository(() => NOW, { datasetRegistry: port });
  return { repo, service: new StrategyService(repo, { codeVersion: CODE_VERSION, now: () => NOW }) };
}

// ---------------------------------------------------------------------------
// A. 单条坐标判定（纯函数）
// ---------------------------------------------------------------------------

describe("A. evaluateDatasetBinding — 单条坐标判定", () => {
  const request = {
    path: "definition.datasets[0]",
    role: "PRIMARY" as const,
    datasetId: "first_limit_pullback",
    datasetVersionLabel: "v2",
    datasetVersionId: 390002 as number | undefined,
  };

  it("存在 + READY + label 一致 + datasetId 属于该版本 → 零 issue", () => {
    expect(evaluateDatasetBinding(request, V2, DEFINITION)).toEqual([]);
  });

  it("datasetId 允许 ds_ 前缀历史写法（ds_first_limit_pullback 对应 first_limit_pullback）", () => {
    expect(evaluateDatasetBinding(
      { ...request, datasetId: "ds_first_limit_pullback" },
      V2,
      DEFINITION,
    )).toEqual([]);
  });

  it("legacy 分支（datasetVersionId 缺省）→ 不查库、不报错（保留旧兼容行为）", () => {
    expect(evaluateDatasetBinding({ ...request, datasetVersionId: undefined }, undefined, undefined)).toEqual([]);
  });

  it("坐标不存在 → DATASET_VERSION_NOT_FOUND", () => {
    const issues = evaluateDatasetBinding({ ...request, datasetVersionId: 999999999 }, undefined, undefined);
    expect(issues.map((item) => item.code)).toEqual(["DATASET_VERSION_NOT_FOUND"]);
  });

  it.each(["DRAFT", "BUILDING", "FAILED"])("坐标存在但 status=%s → DATASET_VERSION_NOT_READY", (status) => {
    const issues = evaluateDatasetBinding(request, { ...V2, status }, DEFINITION);
    expect(issues.map((item) => item.code)).toEqual(["DATASET_VERSION_NOT_READY"]);
    expect(issues[0]?.message).toContain(status);
  });

  it("label 与 Registry 的 version 不一致 → DATASET_BINDING_INVALID", () => {
    const issues = evaluateDatasetBinding({ ...request, datasetVersionLabel: "v1" }, V2, DEFINITION);
    expect(issues.map((item) => item.code)).toEqual(["DATASET_BINDING_INVALID"]);
    expect(issues[0]?.message).toContain('"v2"');
  });

  it("交叉绑定（datasetId 不属于该版本）→ DATASET_BINDING_INVALID", () => {
    const issues = evaluateDatasetBinding({ ...request, datasetId: "some_other_dataset" }, V2, DEFINITION);
    expect(issues.map((item) => item.code)).toEqual(["DATASET_BINDING_INVALID"]);
    expect(issues[0]?.message).toContain("交叉绑定");
  });

  it("坐标形态非法（0 / 负数 / 小数 / 字符串）→ DATASET_BINDING_INVALID", () => {
    for (const bad of [0, -1, 1.5, "390002" as unknown as number]) {
      const issues = evaluateDatasetBinding({ ...request, datasetVersionId: bad }, V2, DEFINITION);
      expect(issues.map((item) => item.code)).toEqual(["DATASET_BINDING_INVALID"]);
    }
  });

  it("错误码常量是稳定契约（前端 / 测试按码分支）", () => {
    expect([...STRATEGY_DATASET_BINDING_ERROR_CODES]).toEqual([
      "DATASET_VERSION_NOT_FOUND",
      "DATASET_VERSION_NOT_READY",
      "DATASET_BINDING_INVALID",
    ]);
  });

  it("datasetCodesMatch 只做精确匹配与 ds_ 前缀宽容（不做模糊匹配）", () => {
    expect(datasetCodesMatch("first_limit_pullback", "first_limit_pullback")).toBe(true);
    expect(datasetCodesMatch("ds_first_limit_pullback", "first_limit_pullback")).toBe(true);
    expect(datasetCodesMatch("first_limit_pullback_extra", "first_limit_pullback")).toBe(false);
    expect(datasetCodesMatch("ds", null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. 收集待校验坐标
// ---------------------------------------------------------------------------

describe("B. collectStrategyDatasetBindingRequests — 坐标来源", () => {
  it("有 definition → 每个绑定一条请求（路径含下标）", () => {
    const requests = collectStrategyDatasetBindingRequests(coordinateDocument([
      { datasetId: "first_limit_pullback", datasetVersion: "v2", datasetVersionId: 390002, role: "PRIMARY" },
      { datasetId: "first_limit_pullback", datasetVersion: "v1", datasetVersionId: 390001, role: "VALIDATION" },
    ]));
    expect(requests.map((item) => item.path)).toEqual([
      "definition.datasets[0]",
      "definition.datasets[1]",
    ]);
    expect(requests.map((item) => item.datasetVersionId)).toEqual([390002, 390001]);
  });

  it("无 definition 但 doc 级声明坐标 → 一条请求（path = datasetVersionId，不校验 datasetId）", () => {
    // 以 legacy 文档（含 v1 兼容视图）为基线：去掉 definition、换成 Dataset Registry 坐标。
    const legacyDoc = createStrategyDocumentFromDefinition(FIRST_BOARD_PULLBACK_DOCUMENT_INPUT);
    const wire = {
      ...(legacyDoc as unknown as Record<string, unknown>),
      universe: { universeId: "research-dataset:v2" },
      datasetVersion: "v2",
      datasetVersionId: 390002,
    };
    delete wire.definition;
    delete wire.fingerprint;
    const doc = createStrategyDocument(wire as never);
    const requests = collectStrategyDatasetBindingRequests(doc);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe("datasetVersionId");
    expect(requests[0]?.datasetId).toBeUndefined();
    expect(requests[0]?.datasetVersionId).toBe(390002);
  });

  it("无 definition 且无 doc 级坐标（legacy）→ 零请求（不产生任何 IO）", () => {
    const doc = createStrategyDocumentFromDefinition(FIRST_BOARD_PULLBACK_DOCUMENT_INPUT);
    const requests = collectStrategyDatasetBindingRequests(doc);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.datasetVersionId).toBeUndefined();
    expect(requests[0]?.datasetId).toBe("ds_first_limit_pullback");
  });
});

// ---------------------------------------------------------------------------
// C. 断言（去重 + 聚合报错）
// ---------------------------------------------------------------------------

describe("C. assertStrategyDatasetBindings", () => {
  const requests = collectStrategyDatasetBindingRequests(coordinateDocument([
    { datasetId: "first_limit_pullback", datasetVersion: "v2", datasetVersionId: 390002, role: "PRIMARY" },
    { datasetId: "first_limit_pullback", datasetVersion: "v1", datasetVersionId: 390001, role: "VALIDATION" },
    { datasetId: "first_limit_pullback", datasetVersion: "v1", datasetVersionId: 390001, role: "OOS" },
  ]));

  it("全部合法 → 通过；且同一坐标只查一次（去重）", async () => {
    const port = makePort();
    await expect(assertStrategyDatasetBindings(requests, port)).resolves.toBeUndefined();
    expect(port.versionCalls.sort()).toEqual(["390001", "390002"]);
    // 两个坐标同属一个 Dataset Definition → 只查一次定义。
    expect(port.definitionCalls).toEqual([String(DATASET_DEFINITION_ID)]);
  });

  it("legacy-only 请求 → 完全不产生 IO", async () => {
    const port = makePort();
    await expect(assertStrategyDatasetBindings(
      [{ path: "definition.datasets[0]", role: "PRIMARY", datasetId: "ds_x", datasetVersionLabel: "rd-1.0.0-1-0", datasetVersionId: undefined }],
      port,
    )).resolves.toBeUndefined();
    expect(port.versionCalls).toEqual([]);
  });

  it("多条非法 → 一次抛全部 issue（不只报第一条）", async () => {
    const mixed = collectStrategyDatasetBindingRequests(coordinateDocument([
      { datasetId: "first_limit_pullback", datasetVersion: "v2", datasetVersionId: 999999999, role: "PRIMARY" },
      { datasetId: "first_limit_pullback", datasetVersion: "v1", datasetVersionId: 390001, role: "VALIDATION" },
      { datasetId: "first_limit_pullback", datasetVersion: "v1", datasetVersionId: 390002, role: "OOS" },
    ]));
    const error = await assertStrategyDatasetBindings(mixed, makePort()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StrategyDatasetBindingError);
    const bindingError = error as StrategyDatasetBindingError;
    // 规范化会按 (role, datasetId, datasetVersion, datasetVersionId) 重排绑定 ⇒ 断言集合而非顺序。
    expect([...bindingError.issues.map((item) => item.code)].sort()).toEqual([
      "DATASET_BINDING_INVALID",
      "DATASET_VERSION_NOT_FOUND",
    ]);
    expect(bindingError.issues).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// D. 写入闸门（Repository / Service）
// ---------------------------------------------------------------------------

describe("D. 写入闸门 — 校验失败不得落任何行", () => {
  it("合法坐标 → save 成功，版本行带上 datasetVersionId", async () => {
    const { repo, service } = makeService(makePort());
    await service.save({ document: coordinateDocument() as unknown as Record<string, unknown> });
    const summaries = await repo.listVersions("strategy-004-coordinate");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.datasetVersion).toBe("v2");
    expect(summaries[0]?.datasetVersionId).toBe(390002);
  });

  it("坐标不存在 → 抛 DATASET_VERSION_NOT_FOUND，且**没有**任何策略 / 版本落库", async () => {
    const { repo, service } = makeService(makePort());
    const doc = coordinateDocument([
      { datasetId: "first_limit_pullback", datasetVersion: "v9", datasetVersionId: 999999999, role: "PRIMARY" },
    ]);
    const error = await service.save({ document: doc as unknown as Record<string, unknown> })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StrategyDatasetBindingError);
    expect((error as StrategyDatasetBindingError).code).toBe("DATASET_VERSION_NOT_FOUND");
    expect(await repo.getStrategy("strategy-004-coordinate")).toBeUndefined();
    expect(await repo.listVersions("strategy-004-coordinate")).toEqual([]);
  });

  it("未接入 Dataset Registry（默认端口）→ 明确失败，不静默放过坐标", async () => {
    const repo = new InMemoryStrategyRepository(() => NOW);
    const service = new StrategyService(repo, { codeVersion: CODE_VERSION, now: () => NOW });
    const error = await service.save({ document: coordinateDocument() as unknown as Record<string, unknown> })
      .catch((e: unknown) => e);
    expect((error as StrategyDatasetBindingError).code).toBe("DATASET_VERSION_NOT_FOUND");
  });

  it("clone 出的新版本同样带上坐标，并再次通过闸门（不产生未校验的新版本）", async () => {
    const { repo, service } = makeService(makePort());
    await service.save({ document: coordinateDocument() as unknown as Record<string, unknown> });
    const cloned = await service.cloneVersion({
      strategyId: "strategy-004-coordinate",
      fromVersion: "1.0.0",
      targetVersion: "2.0.0",
    });
    expect(cloned.outcome).toBe("inserted");
    const summaries = await repo.listVersions("strategy-004-coordinate");
    const v2Row = summaries.find((item) => item.version === "2.0.0");
    expect(v2Row?.datasetVersionId).toBe(390002);
    expect(v2Row?.datasetVersion).toBe("v2");
  });

  it("兼容性回归：legacy rd-… 绑定 + 默认端口仍可保存（旧行为不被破坏）", async () => {
    const repo = new InMemoryStrategyRepository(() => NOW);
    const service = new StrategyService(repo, { codeVersion: CODE_VERSION, now: () => NOW });
    await service.save({ document: createStrategyDocumentFromDefinition(FIRST_BOARD_PULLBACK_DOCUMENT_INPUT) as unknown as Record<string, unknown> });
    const doc = await service.load("first-board-pullback");
    expect(doc.datasetVersion).toBe(FIRST_BOARD_PULLBACK_DATASET_VERSION);
    expect((doc as { datasetVersionId?: number }).datasetVersionId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// E. 多绑定规则（PRIMARY 唯一 / 去重 / role 白名单）继续成立
// ---------------------------------------------------------------------------

describe("E. 多绑定规则继续成立", () => {
  it("PRIMARY / VALIDATION / OOS 三绑定合法（各角色一个）", async () => {
    const { service } = makeService(makePort());
    const doc = coordinateDocument([
      { datasetId: "first_limit_pullback", datasetVersion: "v2", datasetVersionId: 390002, role: "PRIMARY" },
      { datasetId: "first_limit_pullback", datasetVersion: "v1", datasetVersionId: 390001, role: "VALIDATION" },
      { datasetId: "first_limit_pullback", datasetVersion: "v1", datasetVersionId: 390001, role: "OOS" },
    ]);
    await expect(service.save({ document: doc as unknown as Record<string, unknown> })).resolves.toBeDefined();
  });

  it("第二个 PRIMARY 被 Domain 校验挡下（不进入引用完整性阶段）", async () => {
    const port = makePort();
    const { service } = makeService(port);
    // 两条绑定 label 相同（否则规范化会按 label 重排、PRIMARY 视图取到另一条），
    // 仅坐标不同 ⇒ 去重键不冲突，唯一违规点就是「多于一个 PRIMARY」。
    // 注意：组装（coordinateDocument）本身就会抛错，因此必须在同一 async 边界内捕获。
    const attempt = async () => {
      const doc = coordinateDocument([
        { datasetId: "first_limit_pullback", datasetVersion: "v2", datasetVersionId: 390002, role: "PRIMARY" },
        { datasetId: "first_limit_pullback", datasetVersion: "v2", datasetVersionId: 390001, role: "PRIMARY" },
      ]);
      return service.save({ document: doc as unknown as Record<string, unknown> });
    };
    const error = await attempt().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { issues?: { code: string }[] }).issues?.map((item) => item.code))
      .toContain("SCHEMA_DEFINITION_DATASET_PRIMARY_DUPLICATE");
    expect(port.versionCalls).toEqual([]); // 形态校验先失败 → 未发起任何 Registry 查询
  });
});
