/**
 * STEP STRATEGY-002 — Strategy Persistence 测试（Repository 契约逻辑 + Service 编排）。
 *
 * 说明：
 *   - 本文件用 InMemoryStrategyRepository 测「契约逻辑」（幂等 / 指纹冲突 / 不可变 / 排序）
 *     与 Service 编排语义（create/save/load/createVersion + 版本闸门）；**不用于证明持久化**。
 *   - 持久化验收（真实 TiDB：重启往返 + 版本往返）由 `scripts/stepStrategy002E2E.mjs` 承担（§21 禁止 mock 证明持久化）。
 */

import { describe, expect, it } from "vitest";
import type { CostModel } from "../../../../server/engine/domain";
import { createStrategyDocument, createStrategyVersionRecord } from "../../../../server/research/strategySchema/map";
import type { StrategyDocument, StrategyDocumentInput, StrategyVersionRecord } from "../../../../server/research/strategySchema/types";
import { InMemoryStrategyRepository } from "../../../../server/research/strategyPersistence/inMemory";
import { StrategyService } from "../../../../server/research/strategyPersistence/service";

const DATASET_VERSION = "rd-1.0.0-1-cffc2a0e66efbf0b";

const COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

function makeDocInput(overrides: Partial<StrategyDocumentInput> = {}): StrategyDocumentInput {
  return {
    strategyId: "limit-up-baseline",
    version: "1.0.0",
    name: "涨停候选基线",
    description: "研究链路基线策略",
    universe: { universeId: `research-dataset:${DATASET_VERSION}` },
    entryRules: [
      { id: "enter-topN", kind: "threshold", field: "candidate.rank", operator: "<=", operand: 5, description: "候选排名 <= 5 进场" },
    ],
    exitRules: [
      { id: "exit-holding-days", kind: "time-based", field: "position.holdingDays", operator: ">=", operand: 3, description: "持有 >= 3 日退出" },
    ],
    positionSizing: { kind: "equal-weight", maxPositions: 5 },
    riskRules: [
      { id: "risk-max-positions", kind: "state", field: "position.count", operator: "<=", operand: 5, description: "组合持仓数不超过 5" },
    ],
    parameters: {
      parameters: [
        { name: "topN", type: "number", required: true, defaultValue: 5, min: 1, max: 20, description: "选股数" },
        { name: "minScore", type: "number", required: false, nullable: true, defaultValue: null, description: "分数阈值" },
      ],
    },
    datasetVersion: DATASET_VERSION,
    executionAssumptions: {
      backtestConfig: { initialCapital: 100_000, maxPositions: 5 },
      costModel: COST_MODEL,
      executionModel: "NEXT_OPEN",
    },
    ...overrides,
  };
}

function makeDocument(overrides: Partial<StrategyDocumentInput> = {}): StrategyDocument {
  return createStrategyDocument(makeDocInput(overrides));
}

function makeService() {
  const repo = new InMemoryStrategyRepository(() => "2026-09-09T00:00:00.000Z");
  const service = new StrategyService(repo, {
    codeVersion: "1.0.0+g0000000",
    now: () => "2026-09-09T00:00:00.000Z",
  });
  return { repo, service };
}

describe("InMemoryStrategyRepository", () => {
  it("saveVersion 幂等：同 fingerprint 重复保存跳过，不产生重复版本", async () => {
    const { repo } = makeService();
    const doc = makeDocument();
    const service = new StrategyService(repo, { codeVersion: "1.0.0+g0000000", now: () => "2026-09-09T00:00:00.000Z" });

    await service.save({ document: doc as unknown as Record<string, unknown> });
    await service.save({ document: doc as unknown as Record<string, unknown> });

    const versions = await repo.listVersions(doc.strategyId);
    expect(versions.length).toBe(1);
    expect(versions[0]?.versionRowId).toBeGreaterThan(0);
  });

  it("saveVersion 冲突：同 version 不同 fingerprint 拒绝", async () => {
    const repo = new InMemoryStrategyRepository();
    const docA = makeDocument({ name: "版本 A" });
    const docB = makeDocument({ name: "版本 B" }); // 同 strategyId + 同 version，内容不同

    const resultA = await repo.saveVersion({
      strategyId: docA.strategyId,
      document: docA,
      versionRecord: makeVersionRecord(docA),
    });
    expect(resultA.outcome).toBe("inserted");

    const resultB = await repo.saveVersion({
      strategyId: docB.strategyId,
      document: docB,
      versionRecord: makeVersionRecord(docB),
    });
    expect(resultB.outcome).toBe("conflict");
    expect(resultB.existingFingerprint).toBe(docA.fingerprint);
  });

  it("listVersions 按版本号语义降序（1.10.0 > 1.9.0）", async () => {
    const repo = new InMemoryStrategyRepository();
    for (const v of ["1.0.0", "1.9.0", "1.10.0", "2.0.0"]) {
      const doc = makeDocument({ version: v, name: `v${v}` });
      await repo.saveVersion({
        strategyId: doc.strategyId,
        document: doc,
        versionRecord: makeVersionRecord(doc),
      });
    }
    const versions = await repo.listVersions("limit-up-baseline");
    expect(versions.map((v) => v.version)).toEqual(["2.0.0", "1.10.0", "1.9.0", "1.0.0"]);
  });

  it("deleteStrategy 级联删除版本", async () => {
    const repo = new InMemoryStrategyRepository();
    const doc = makeDocument();
    await repo.saveVersion({
      strategyId: doc.strategyId,
      document: doc,
      versionRecord: makeVersionRecord(doc),
    });
    await repo.saveStrategy({ strategyId: doc.strategyId, name: doc.name, latestVersion: doc.version, status: "Draft" });

    await repo.deleteStrategy(doc.strategyId);
    expect(await repo.getStrategy(doc.strategyId)).toBeUndefined();
    expect(await repo.listVersions(doc.strategyId)).toEqual([]);
  });

  it("updateVersionStarred 写入后可被 listVersions 读回，并支持取消", async () => {
    const repo = new InMemoryStrategyRepository(() => "2026-09-09T00:00:00.000Z");
    const doc = makeDocument();
    await repo.saveVersion({
      strategyId: doc.strategyId,
      document: doc,
      versionRecord: makeVersionRecord(doc),
    });

    await repo.updateVersionStarred(doc.strategyId, doc.version, true);
    expect(await repo.listVersions(doc.strategyId)).toEqual([
      expect.objectContaining({ version: doc.version, isStarred: true }),
    ]);

    await repo.updateVersionStarred(doc.strategyId, doc.version, false);
    expect((await repo.listVersions(doc.strategyId))[0]?.isStarred).toBe(false);
  });

  it("没有正式版本行的坐标不能加星（留档必须先物化正式版本）", async () => {
    const repo = new InMemoryStrategyRepository();
    // 刻意不 saveVersion：模拟研究脚本只写 closed_loop_backtest_run 留档的版本
    // （例如 first-limit-pullback-3f-top3@1.62.1）。
    const strategyId = "first-limit-pullback-3f-top3";
    const version = "1.62.1";

    expect(await repo.listVersions(strategyId)).toEqual([]);
    await expect(repo.updateVersionStarred(strategyId, version, true))
      .rejects.toThrow(/未找到策略版本，无法更新星标/);
    expect(await repo.listVersionStars(strategyId)).toEqual([]);
  });

  it("updateVersionParent 写入父链后可被 listVersions / getVersionBundle 读回", async () => {
    const repo = new InMemoryStrategyRepository(() => "2026-09-09T00:00:00.000Z");
    const rootDoc = makeDocument();
    const childDoc = makeDocument({ version: "1.1.0", name: "子版本" });
    for (const document of [rootDoc, childDoc]) {
      await repo.saveVersion({
        strategyId: document.strategyId,
        document,
        versionRecord: makeVersionRecord(document),
      });
    }

    const rootRowId = await repo.getVersionRowId(rootDoc.strategyId, rootDoc.version);
    expect(rootRowId).toBeGreaterThan(0);
    await repo.updateVersionParent(childDoc.strategyId, childDoc.version, rootRowId!);

    const versions = await repo.listVersions(childDoc.strategyId);
    const child = versions.find(row => row.version === childDoc.version);
    expect(child?.parentVersionId).toBe(rootRowId);
    expect((await repo.getVersionBundle(childDoc.strategyId, childDoc.version))?.parentVersionId)
      .toBe(rootRowId);

    await repo.updateVersionParent(childDoc.strategyId, childDoc.version, null);
    expect((await repo.getVersionBundle(childDoc.strategyId, childDoc.version))?.parentVersionId)
      .toBeNull();
  });

  it("updateVersionParent 拒绝缺失父版本、跨策略父版本与自引用", async () => {
    const repo = new InMemoryStrategyRepository(() => "2026-09-09T00:00:00.000Z");
    const doc = makeDocument();
    const otherDoc = makeDocument({ strategyId: "other-strategy", name: "其他策略" });
    for (const document of [doc, otherDoc]) {
      await repo.saveVersion({
        strategyId: document.strategyId,
        document,
        versionRecord: makeVersionRecord(document),
      });
    }

    await expect(repo.updateVersionParent(doc.strategyId, doc.version, 999_999))
      .rejects.toThrow(/父版本不存在或不属于同一策略/);
    await expect(repo.updateVersionParent(
      doc.strategyId,
      doc.version,
      (await repo.getVersionRowId(otherDoc.strategyId, otherDoc.version))!,
    )).rejects.toThrow(/父版本不存在或不属于同一策略/);

    const selfRowId = await repo.getVersionRowId(doc.strategyId, doc.version);
    await expect(repo.updateVersionParent(doc.strategyId, doc.version, selfRowId!))
      .rejects.toThrow(/不能指向自身/);
  });

  it("updateVersionParent 是幂等纯元数据操作：摘要、内容、指纹与时间戳不变", async () => {
    const repo = new InMemoryStrategyRepository(() => "2026-09-09T00:00:00.000Z");
    const rootDoc = makeDocument();
    const childDoc = makeDocument({ version: "1.1.0", name: "子版本" });
    for (const document of [rootDoc, childDoc]) {
      await repo.saveVersion({
        strategyId: document.strategyId,
        document,
        versionRecord: makeVersionRecord(document),
      });
    }
    const rootRowId = await repo.getVersionRowId(rootDoc.strategyId, rootDoc.version);
    const before = await repo.getVersionBundle(childDoc.strategyId, childDoc.version);
    const beforeSummary = (await repo.listVersions(childDoc.strategyId))
      .find(row => row.version === childDoc.version);

    await repo.updateVersionParent(childDoc.strategyId, childDoc.version, rootRowId!);
    await repo.updateVersionParent(childDoc.strategyId, childDoc.version, rootRowId!);

    const after = await repo.getVersionBundle(childDoc.strategyId, childDoc.version);
    const afterSummary = (await repo.listVersions(childDoc.strategyId))
      .find(row => row.version === childDoc.version);
    expect(after).toEqual({ ...before, parentVersionId: rootRowId });
    expect(afterSummary).toEqual({ ...beforeSummary, parentVersionId: rootRowId });
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });
});

describe("StrategyService", () => {
  it("create 创建策略 + 第一条版本；重复 create 抛错", async () => {
    const { service } = makeService();
    const doc = makeDocument();
    const created = await service.create({ document: doc as unknown as Record<string, unknown> });
    expect(created.strategyId).toBe(doc.strategyId);
    expect(created.version).toBe("1.0.0");
    expect(created.fingerprint).toBe(doc.fingerprint);

    await expect(service.create({ document: doc as unknown as Record<string, unknown> }))
      .rejects.toThrow(/已存在/);
  });

  it("save 幂等：同内容两次 save 不产生重复版本", async () => {
    const { service, repo } = makeService();
    const doc = makeDocument();
    await service.save({ document: doc as unknown as Record<string, unknown> });
    await service.save({ document: doc as unknown as Record<string, unknown> });
    expect(await repo.listVersions(doc.strategyId)).toHaveLength(1);
  });

  it("load 返回最新版本且 fingerprint 一致", async () => {
    const { service } = makeService();
    const doc = makeDocument();
    await service.save({ document: doc as unknown as Record<string, unknown> });
    const loaded = await service.load(doc.strategyId);
    expect(loaded.strategyId).toBe(doc.strategyId);
    expect(loaded.fingerprint).toBe(doc.fingerprint);
    expect(loaded.version).toBe("1.0.0");
  });

  it("createVersion 参数默认值变化 → minor bump（1.0.0 → 1.1.0）", async () => {
    const { service } = makeService();
    await service.save({ document: makeDocument() as unknown as Record<string, unknown> });

    const next = makeDocument({
      parameters: {
        parameters: [
          { name: "topN", type: "number", required: true, defaultValue: 7, min: 1, max: 20, description: "选股数" },
          { name: "minScore", type: "number", required: false, nullable: true, defaultValue: null, description: "分数阈值" },
        ],
      },
    });
    const created = await service.createVersion({
      strategyId: "limit-up-baseline",
      document: next as unknown as Record<string, unknown>,
    });
    expect(created.version).toBe("1.1.0");
  });

  it("createVersion 结构变化（entryRules）→ major bump（1.0.0 → 2.0.0）", async () => {
    const { service } = makeService();
    await service.save({ document: makeDocument() as unknown as Record<string, unknown> });

    const next = makeDocument({
      entryRules: [
        { id: "enter-topN", kind: "threshold", field: "candidate.rank", operator: "<=", operand: 3, description: "候选排名 <= 3 进场" },
        { id: "enter-new", kind: "threshold", field: "volume.turnoverRate", operator: ">=", operand: 5, description: "换手率 >= 5%" },
      ],
    });
    const created = await service.createVersion({
      strategyId: "limit-up-baseline",
      document: next as unknown as Record<string, unknown>,
    });
    expect(created.version).toBe("2.0.0");
  });

  it("createVersion 显式 bump 不足（结构变化传 minor）→ 闸门拒绝", async () => {
    const { service } = makeService();
    await service.save({ document: makeDocument() as unknown as Record<string, unknown> });

    const next = makeDocument({
      entryRules: [
        { id: "enter-new", kind: "threshold", field: "volume.turnoverRate", operator: ">=", operand: 5, description: "换手率 >= 5%" },
      ],
    });
    await expect(service.createVersion({
      strategyId: "limit-up-baseline",
      document: next as unknown as Record<string, unknown>,
      bump: "minor",
    })).rejects.toThrow(/bump 级别不足|必须 major/);
  });

  it("immutable：同 version 不同内容 save → 拒绝", async () => {
    const { service } = makeService();
    await service.save({ document: makeDocument() as unknown as Record<string, unknown> });
    const mutated = makeDocument({ name: "改名但同版本" });
    await expect(service.save({ document: mutated as unknown as Record<string, unknown> }))
      .rejects.toThrow(/不可变|createVersion/);
  });

  it("loadVersion 返回 §17 九项追溯记录（含 codeVersion 注入）", async () => {
    const { service } = makeService();
    const doc = makeDocument();
    await service.save({ document: doc as unknown as Record<string, unknown> });
    const record = await service.loadVersion(doc.strategyId, "1.0.0");
    expect(record.strategyId).toBe(doc.strategyId);
    expect(record.version).toBe("1.0.0");
    expect(record.codeVersion).toBe("1.0.0+g0000000");
    expect(record.datasetVersion).toBe(DATASET_VERSION);
    expect(record.universeId).toBe(`research-dataset:${DATASET_VERSION}`);
    expect(record.createdAt).toBe("2026-09-09T00:00:00.000Z");
    expect(record.strategy.fingerprint).toBe(doc.fingerprint);
  });

  it("strategyType：创建时落库，后续文档缺省不得清空既有分类", async () => {
    const { service, repo } = makeService();
    const typed = makeDocument({ strategyType: "BASELINE" });

    await service.create({ document: typed as unknown as Record<string, unknown> });
    expect((await repo.getStrategy(typed.strategyId))?.strategyType).toBe("BASELINE");

    // 回归：refreshEntityPointer 曾因未透传、且 DB 侧用 `?? null` 覆盖，导致每次 save 清空分类。
    // 版本内容不可变，改名必须走 createVersion；补丁未声明 strategyType 时应继承既有分类。
    const withoutType = makeDocInput({ name: "改名但不重复声明分类" });
    delete (withoutType as { strategyType?: unknown }).strategyType;
    await service.createVersion({
      strategyId: typed.strategyId,
      document: withoutType as unknown as Record<string, unknown>,
    });

    const summary = await repo.getStrategy(typed.strategyId);
    expect(summary?.strategyType).toBe("BASELINE");
    expect(summary?.name).toBe("改名但不重复声明分类");
  });

  it("strategyType：显式改分类时落库覆盖既有值", async () => {
    const { service, repo } = makeService();
    const typed = makeDocument({ strategyType: "BASELINE" });
    await service.create({ document: typed as unknown as Record<string, unknown> });

    const reclassified = makeDocument({ strategyType: "MANUAL", name: "改分类" });
    await service.createVersion({
      strategyId: typed.strategyId,
      document: reclassified as unknown as Record<string, unknown>,
      bump: "minor",
    });

    expect((await repo.getStrategy(typed.strategyId))?.strategyType).toBe("MANUAL");
  });

  it("strategyType：非法值被校验器拒绝，不静默落库", async () => {
    const { service } = makeService();
    const invalid = makeDocInput({
      strategyType: "NOT_A_REAL_TYPE" as unknown as StrategyDocumentInput["strategyType"],
    });

    await expect(service.create({ document: invalid as unknown as Record<string, unknown> }))
      .rejects.toThrow(/strategyType/);
  });
});

/** 构造一个最小 §17 版本追溯记录（复用 createStrategyVersionRecord）。 */
function makeVersionRecord(doc: StrategyDocument): StrategyVersionRecord {
  return createStrategyVersionRecord({
    document: doc,
    context: { codeVersion: "1.0.0+g0000000", createdAt: "2026-09-09T00:00:00.000Z" },
  });
}
