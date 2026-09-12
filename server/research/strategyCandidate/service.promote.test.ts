/**
 * RESEARCH-006.3 — `StrategyCandidateService.promote` 契约测试（全 InMemory，不触真实 DB）。
 *
 * 覆盖（006.3 §37 ~ §41）：
 *   A. 前置条件 15 例：不存在 / 非 ACCEPTED（DRAFT / REVIEW / REJECTED / ARCHIVED）/
 *      ACCEPTED 正常 / validate 失败 / Dataset 不存在 / 非 READY / 默认继承 / 指定不同 /
 *      缺 divergence reason / 正确保存 reason / provenance 正确 / 候选终态 CONVERTED；
 *   B. 幂等（§18 / §19）：第二次 promote **不产生第二个策略版本**，且返回同一份结果；
 *   C. 跨存储失败 + 恢复（§25 / §26 / §39）：**注入**失败（不靠真实库偶然出错），
 *      断言「已建的 Strategy 不被删除」「候选保持 ACCEPTED」「重试命中既有版本且不新建第二份」；
 *   D. provenance 是**历史事实快照**（§22 / §40）：上游删除后仍可读；
 *   E. Strategy 独立性（§41）：Research 侧数据消失不影响 Strategy 版本读取与校验。
 *
 * 🔴 不为了「看起来成功」放宽规则（§53）：本文件里所有「失败」断言都同时断言**没有副作用**。
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryResearchRepositories,
  type ResearchRepositories,
} from "../../researchCore";
import { InMemoryStrategyRepository } from "../strategyPersistence/inMemory";
import type { StrategyRepository } from "../strategyPersistence/contract";
import { StrategyServicePromotionPort } from "./strategyPromotionPort";
import { createInMemoryStrategyResearchProvenanceRepository } from "./provenance";
import { STRATEGY_CANDIDATE_ERROR, StrategyCandidateError } from "./candidateTypes";
import {
  createStrategyCandidateService,
  type DatasetVersionReadPort,
  type DatasetVersionSnapshot,
  type StrategyCandidateService,
} from "./service";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 研究来源 Dataset Version（Experiment 绑定）。 */
const SOURCE_DATASET_VERSION_ID = 390002;
/** 另一个 READY 的 Dataset Version（用于验证 divergence）。 */
const OTHER_DATASET_VERSION_ID = 390003;
/** 存在但未 READY 的 Dataset Version。 */
const NOT_READY_DATASET_VERSION_ID = 390004;
/** Registry 里根本不存在的坐标。 */
const MISSING_DATASET_VERSION_ID = 399999;
const DATASET_CODE = "first_limit_pullback";
const NOW_ISO = "2026-09-12T10:00:00.000Z";
const NOW = () => new Date(NOW_ISO);

function snapshotOf(id: number): DatasetVersionSnapshot | undefined {
  if (id === SOURCE_DATASET_VERSION_ID) {
    return { datasetVersionId: id, label: "v2", status: "READY", datasetId: 120001, datasetCode: DATASET_CODE };
  }
  if (id === OTHER_DATASET_VERSION_ID) {
    return { datasetVersionId: id, label: "v3", status: "READY", datasetId: 120001, datasetCode: DATASET_CODE };
  }
  if (id === NOT_READY_DATASET_VERSION_ID) {
    return { datasetVersionId: id, label: "v4", status: "BUILDING", datasetId: 120001, datasetCode: DATASET_CODE };
  }
  return undefined;
}

function makeDatasetPort(): DatasetVersionReadPort {
  return { async getVersionById(id) { return snapshotOf(id); } };
}

/** Strategy 侧的 Dataset Registry 只读端口（与上表同口径 —— 两处口径不一致本身就是 bug）。 */
function makeStrategyDatasetRegistry() {
  return {
    async getVersionById(id: number) {
      const snap = snapshotOf(id);
      return snap === undefined
        ? undefined
        : { id: snap.datasetVersionId, datasetId: snap.datasetId, version: snap.label, status: snap.status };
    },
    async getDefinitionById(datasetId: number) {
      return { id: datasetId, datasetCode: DATASET_CODE };
    },
  };
}

/** 完整可转正的候选草稿（Research 侧字段；扩展槽见 006.3 §9 的映射表）。 */
function draftPatch() {
  return {
    entryRule: {
      event: "FIRST_LIMIT_UP",
      timing: "NEXT_OPEN",
      extra: {
        observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
        trigger: "FIRST_VALID_DAY",
        eventParams: { limitUpRatio: 0.1 },
        execution: { quantityMethod: "TARGET_WEIGHT", lotSize: 100, slippageModel: "BPS", commissionModel: "BPS" },
        position: { sizingMethod: "FIXED_RATIO", positionRatio: 0.2, maxExposure: 0.8 },
        risk: { stopLoss: 0.08, maxDrawdown: 0.25 },
        document: {
          backtestConfig: { initialCapital: 1_000_000, maxPositions: 5 },
          costModel: {
            commissionRate: 0.00025,
            stampDutyRate: 0.0005,
            transferFeeRate: 0.00001,
            slippageBps: 5,
            lotSize: 100,
            minCommission: 5,
          },
        },
      },
    },
    filterRule: {
      groups: [
        {
          groupNo: 0,
          groupLogicalOperator: "AND",
          conditions: [
            {
              groupNo: 0,
              sortOrder: 0,
              fieldName: "bar.low",
              operator: ">=",
              value: "prefix.rd0.open",
              logicalOperator: "AND",
              groupLogicalOperator: "AND",
            },
          ],
        },
      ],
    },
    exitRule: { holdingDays: 3, takeProfit: 0.15, stopLoss: 0.08 },
    riskRule: { maxPositions: 5, maxPositionWeight: 0.3 },
    parameterSpace: { holdingDays: { type: "number", min: 1, max: 20, step: 1 } },
  };
}

interface Harness {
  repos: ResearchRepositories;
  strategyRepo: StrategyRepository;
  provenance: ReturnType<typeof createInMemoryStrategyResearchProvenanceRepository>;
  service: StrategyCandidateService;
  experimentId: number;
  conclusionId: number;
}

async function seedHarness(options: { draft?: Record<string, unknown>; skipDraft?: boolean } = {}): Promise<Harness> {
  const repos = createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => snapshotOf(id) !== undefined,
    now: NOW,
  });
  const strategyRepo = new InMemoryStrategyRepository(() => NOW_ISO, {
    datasetRegistry: makeStrategyDatasetRegistry(),
  });
  const provenance = createInMemoryStrategyResearchProvenanceRepository({ now: NOW });

  const experiment = await repos.experiments.create({
    datasetVersionId: SOURCE_DATASET_VERSION_ID,
    name: "正式数据，首板回踩",
    researchType: "EVENT_STUDY",
    status: "COMPLETED",
  });
  const conclusion = await repos.conclusions.create({
    experimentId: experiment.id as number,
    conclusionType: "SUPPORTED",
    title: "首板回踩不破首板开盘价",
    conclusion: "正文",
    confidence: 0.85,
  });

  const service = createStrategyCandidateService({
    repos,
    datasetVersions: makeDatasetPort(),
    strategies: new StrategyServicePromotionPort(strategyRepo, { codeVersion: "test-1.0.0", now: () => NOW_ISO }),
    provenance,
  });

  if (options.skipDraft !== true) {
    const view = await service.createFromConclusion({ conclusionId: conclusion.id as number });
    await service.update(view.candidate.id as number, (options.draft ?? draftPatch()) as never);
  }

  return {
    repos,
    strategyRepo,
    provenance,
    service,
    experimentId: experiment.id as number,
    conclusionId: conclusion.id as number,
  };
}

/** 登记 → 填草稿 → 推到 ACCEPTED，返回 candidateId。 */
async function seedAcceptedCandidate(
  h: Harness,
  options: { draft?: Record<string, unknown> } = {},
): Promise<number> {
  const view = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
  const id = view.candidate.id as number;
  await h.service.update(id, (options.draft ?? draftPatch()) as never);
  await h.service.transition({ candidateId: id, to: "REVIEW" });
  await h.service.transition({ candidateId: id, to: "ACCEPTED" });
  return id;
}

async function expectError(promise: Promise<unknown>, code: string): Promise<StrategyCandidateError> {
  try {
    await promise;
  } catch (err) {
    expect(err, `期望 StrategyCandidateError(${code})，实际抛出 ${String(err)}`).toBeInstanceOf(
      StrategyCandidateError,
    );
    const e = err as StrategyCandidateError;
    expect(e.code).toBe(code);
    return e;
  }
  throw new Error(`期望抛出 StrategyCandidateError(${code})，但调用成功返回`);
}

/** 该策略下的版本行数（用于证明「没有第二个版本」）。 */
async function versionCount(repo: StrategyRepository, strategyId: string): Promise<number> {
  const versions = await repo.listVersions(strategyId);
  return versions.length;
}

/** 全库策略数（用于证明失败路径**零 Strategy 数据**）。 */
async function strategyCount(repo: StrategyRepository): Promise<number> {
  const list = await repo.listStrategies();
  return list.length;
}

// ---------------------------------------------------------------------------
// A. 前置条件
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · promote 前置条件（§5）", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await seedHarness({ skipDraft: true });
  });

  it("1) candidateId 不存在 → CANDIDATE_NOT_FOUND", async () => {
    await expectError(h.service.promote({ candidateId: 999999999 }), STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_FOUND);
  });

  it("2) candidateId 非正整数 → INVALID_INPUT（不查库）", async () => {
    await expectError(h.service.promote({ candidateId: 0 }), STRATEGY_CANDIDATE_ERROR.INVALID_INPUT);
  });

  it("2b) overrides 出现未知键（含完整 definition）→ 响亮拒绝，不静默丢弃", async () => {
    const e = await expectError(
      h.service.promote({ candidateId: 1, overrides: { definition: { entry: {} } } as never }),
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    );
    expect(e.message).toContain("definition");
  });

  it("3) DRAFT 直接转正 → CANDIDATE_NOT_ACCEPTED（且零 Strategy 数据）", async () => {
    const view = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    const id = view.candidate.id as number;
    await h.service.update(id, draftPatch() as never);
    await expectError(
      h.service.promote({ candidateId: id }),
      STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED,
    );
    expect(await strategyCount(h.strategyRepo)).toBe(0);
    expect((await h.repos.candidates.getById(id))?.status).toBe("DRAFT");
  });

  it("4) REVIEW → CANDIDATE_NOT_ACCEPTED", async () => {
    const view = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    const id = view.candidate.id as number;
    await h.service.update(id, draftPatch() as never);
    await h.service.transition({ candidateId: id, to: "REVIEW" });
    await expectError(h.service.promote({ candidateId: id }), STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED);
    expect(await strategyCount(h.strategyRepo)).toBe(0);
  });

  it("5) REJECTED → CANDIDATE_NOT_ACCEPTED", async () => {
    const view = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    const id = view.candidate.id as number;
    await h.service.update(id, draftPatch() as never);
    await h.service.transition({ candidateId: id, to: "REVIEW" });
    await h.service.transition({ candidateId: id, to: "REJECTED" });
    await expectError(h.service.promote({ candidateId: id }), STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED);
  });

  it("6) ARCHIVED → CANDIDATE_NOT_ACCEPTED", async () => {
    const view = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    const id = view.candidate.id as number;
    await h.service.update(id, draftPatch() as never);
    await h.service.transition({ candidateId: id, to: "ARCHIVED" });
    await expectError(h.service.promote({ candidateId: id }), STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED);
  });

  it("7) ACCEPTED + 草稿完整 → 成功（Strategy / Version / Provenance / CONVERTED 四件套）", async () => {
    const id = await seedAcceptedCandidate(h);
    const result = await h.service.promote({ candidateId: id });

    expect(result.candidateId).toBe(id);
    expect(result.strategyId).toBe(`cand-${id}`);
    expect(result.strategyVersion).toBe("1.0.0");
    expect(result.origin).toBe("DIRECT");
    expect(result.candidateStatus).toBe("CONVERTED");
    expect(result.idempotent).toBe(false);
    expect(result.provenanceId).toBeGreaterThan(0);
    expect(result.strategyVersionId).toBeGreaterThan(0);
    expect(result.fingerprint).toMatch(/^[0-9a-f]{8,}$/);

    // 版本真的落库了（复用 StrategyService 的 5 投影 + Dataset Binding 校验）
    const bundle = await h.strategyRepo.getVersionBundle(result.strategyId, result.strategyVersion);
    expect(bundle?.hasDefinition).toBe(true);
    expect(bundle?.projections.datasetBindings).toHaveLength(1);
    expect(bundle?.status).toBe("Draft");
  });

  it("8) 构建出的 definition 未过既有校验 → PROMOTE_DEFINITION_INVALID，零 Strategy 数据，候选保持 ACCEPTED", async () => {
    // FIXED_RATIO 却不给 positionRatio：草稿能构建，但既有校验器拒绝（§10 就是要抓这种）
    const draft = draftPatch();
    (draft.entryRule.extra.position as Record<string, unknown>) = { sizingMethod: "FIXED_RATIO" };
    const id = await seedAcceptedCandidate(h, { draft });
    const e = await expectError(
      h.service.promote({ candidateId: id }),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_DEFINITION_INVALID,
    );
    expect(Array.isArray(e.details?.issues)).toBe(true);
    expect(await strategyCount(h.strategyRepo)).toBe(0);
    expect((await h.repos.candidates.getById(id))?.status).toBe("ACCEPTED");
    expect(await h.provenance.listByStrategyId(`cand-${id}`)).toHaveLength(0);
  });

  it("9) 草稿缺必填（无 observationWindow）→ PROMOTE_SKETCH_INCOMPLETE，零副作用", async () => {
    const draft = draftPatch();
    const extra = draft.entryRule.extra as Record<string, unknown>;
    const { observationWindow: _dropped, ...rest } = extra;
    draft.entryRule.extra = rest as typeof draft.entryRule.extra;
    const id = await seedAcceptedCandidate(h, { draft });
    await expectError(
      h.service.promote({ candidateId: id }),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
    );
    expect(await strategyCount(h.strategyRepo)).toBe(0);
    expect((await h.repos.candidates.getById(id))?.status).toBe("ACCEPTED");
  });
});

// ---------------------------------------------------------------------------
// B. Dataset 绑定（§11 ~ §16 / §30）
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · promote 的 Dataset 绑定（§11 ~ §16）", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await seedHarness({ skipDraft: true });
  });

  it("10) 缺省继承：执行绑定 = 研究来源坐标，且 divergence 原因必须为 NULL", async () => {
    const id = await seedAcceptedCandidate(h);
    const result = await h.service.promote({ candidateId: id });

    expect(result.sourceDatasetVersionId).toBe(SOURCE_DATASET_VERSION_ID);
    expect(result.sourceDatasetLabel).toBe("v2");
    expect(result.executionDatasetVersionId).toBe(SOURCE_DATASET_VERSION_ID);
    expect(result.datasetDivergence).toBe(false);
    expect(result.sourceDatasetDivergenceReason).toBeNull();
    expect((await h.repos.candidates.getById(id))?.sourceDatasetDivergenceReason).toBeNull();
  });

  it("11) 显式指定不同 Dataset + 提供原因 → divergence=true，原因落列", async () => {
    const id = await seedAcceptedCandidate(h);
    const reason = "研究在 v2 验证机制，执行改用 v3 更长的回测窗口";
    const result = await h.service.promote({
      candidateId: id,
      overrides: { datasetBinding: { datasetVersionId: OTHER_DATASET_VERSION_ID }, datasetDivergenceReason: reason },
    });

    expect(result.executionDatasetVersionId).toBe(OTHER_DATASET_VERSION_ID);
    expect(result.sourceDatasetVersionId).toBe(SOURCE_DATASET_VERSION_ID);
    expect(result.datasetDivergence).toBe(true);
    expect(result.sourceDatasetDivergenceReason).toBe(reason);

    const row = await h.repos.candidates.getById(id);
    expect(row?.sourceDatasetDivergenceReason).toBe(reason);
    const bundle = await h.strategyRepo.getVersionBundle(result.strategyId, result.strategyVersion);
    expect(bundle?.document.datasetVersionId).toBe(OTHER_DATASET_VERSION_ID);
  });

  it("12) 指定不同却不给原因 → DATASET_DIVERGENCE_REASON_REQUIRED（零 Strategy 数据）", async () => {
    const id = await seedAcceptedCandidate(h);
    await expectError(
      h.service.promote({
        candidateId: id,
        overrides: { datasetBinding: { datasetVersionId: OTHER_DATASET_VERSION_ID } },
      }),
      STRATEGY_CANDIDATE_ERROR.DATASET_DIVERGENCE_REASON_REQUIRED,
    );
    expect(await strategyCount(h.strategyRepo)).toBe(0);
    expect((await h.repos.candidates.getById(id))?.status).toBe("ACCEPTED");
  });

  it("13) 一致却硬填原因（含 same dataset / N/A 之类占位）→ INVALID_INPUT", async () => {
    const id = await seedAcceptedCandidate(h);
    for (const filler of ["same dataset", "inherit", "N/A"]) {
      await expectError(
        h.service.promote({ candidateId: id, overrides: { datasetDivergenceReason: filler } }),
        STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
      );
    }
    expect(await strategyCount(h.strategyRepo)).toBe(0);
    expect((await h.repos.candidates.getById(id))?.sourceDatasetDivergenceReason).toBeNull();
  });

  it("14) 指定的 Dataset Version 不存在 → DATASET_VERSION_NOT_FOUND", async () => {
    const id = await seedAcceptedCandidate(h);
    await expectError(
      h.service.promote({
        candidateId: id,
        overrides: {
          datasetBinding: { datasetVersionId: MISSING_DATASET_VERSION_ID },
          datasetDivergenceReason: "不存在的坐标",
        },
      }),
      STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_FOUND,
    );
    expect(await strategyCount(h.strategyRepo)).toBe(0);
  });

  it("15) 指定的 Dataset Version 非 READY → DATASET_VERSION_NOT_READY", async () => {
    const id = await seedAcceptedCandidate(h);
    await expectError(
      h.service.promote({
        candidateId: id,
        overrides: {
          datasetBinding: { datasetVersionId: NOT_READY_DATASET_VERSION_ID },
          datasetDivergenceReason: "构建中",
        },
      }),
      STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_READY,
    );
    expect(await strategyCount(h.strategyRepo)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C. provenance（§20 ~ §22 / §31 / §40）
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · promote 的 provenance（§20 ~ §22）", () => {
  it("16) provenance 是历史事实快照：上游锚 / origin / 快照逐项正确", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);
    const candidate = await h.repos.candidates.getById(id);
    const result = await h.service.promote({ candidateId: id });

    const row = await h.provenance.getBySourceCandidateId(id);
    expect(row).toBeDefined();
    expect(row?.id).toBe(result.provenanceId);
    expect(row?.strategyVersionId).toBe(result.strategyVersionId);
    expect(row?.strategyId).toBe(result.strategyId);
    expect(row?.strategyVersion).toBe("1.0.0");
    expect(row?.sourceCandidateId).toBe(id);
    expect(row?.sourceConclusionId).toBe(h.conclusionId);
    expect(row?.sourceExperimentId).toBe(h.experimentId);
    expect(row?.sourceDatasetVersionId).toBe(SOURCE_DATASET_VERSION_ID);
    expect(row?.sourceDatasetLabel).toBe("v2");
    expect(row?.origin).toBe("DIRECT");
    // 快照必须**自包含**（不是只存一个 candidateId 等回查）
    expect(row?.sourceSnapshotJson).toEqual(candidate?.sourceTraceJson ?? null);
  });

  it("17) 候选终态：CONVERTED + strategyDefinitionId 指向策略（两处一致）", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);
    const result = await h.service.promote({ candidateId: id });

    const row = await h.repos.candidates.getById(id);
    expect(row?.status).toBe("CONVERTED");
    expect(row?.strategyDefinitionId).toBe(result.strategyId);
  });

  it("18) 上游（Experiment / Conclusion / Candidate）被删后，provenance 仍可读（§40）", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);
    const result = await h.service.promote({ candidateId: id });

    await h.repos.conclusions.delete(h.conclusionId);
    await h.repos.experiments.delete(h.experimentId);
    await h.repos.candidates.delete(id);

    const row = await h.provenance.getBySourceCandidateId(id);
    expect(row?.id).toBe(result.provenanceId);
    expect(row?.sourceConclusionId).toBe(h.conclusionId);
    expect(row?.strategyVersionId).toBe(result.strategyVersionId);
  });
});

// ---------------------------------------------------------------------------
// D. 幂等（§18 / §19）
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · promote 幂等（§18 / §19）", () => {
  it("19) 第二次 promote：同结果 + 不产生第二个版本 + 候选不再被改写", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);

    const first = await h.service.promote({ candidateId: id });
    const before = await versionCount(h.strategyRepo, first.strategyId);

    const second = await h.service.promote({ candidateId: id });
    expect(second).toEqual({ ...first, idempotent: true });
    expect(await versionCount(h.strategyRepo, first.strategyId)).toBe(before);
    expect(before).toBe(1);
    expect(await strategyCount(h.strategyRepo)).toBe(1);
    // provenance 也只有一条
    expect(await h.provenance.listByStrategyId(first.strategyId)).toHaveLength(1);
  });

  it("20) 幂等返回仍带 fingerprint（来自真实版本行，不编值）", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);
    const first = await h.service.promote({ candidateId: id });
    const second = await h.service.promote({ candidateId: id });
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("21) 第二次带上「一致却填了 reason」→ 拒绝（不因幂等而放宽 divergence 规则）", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);
    await h.service.promote({ candidateId: id });
    await expectError(
      h.service.promote({ candidateId: id, overrides: { datasetDivergenceReason: "N/A" } }),
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    );
  });

  it("21b) 第二次要求改绑到别的 Dataset → 拒绝（已转正 = 不可逆；不静默忽略）", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);
    const first = await h.service.promote({ candidateId: id });
    await expectError(
      h.service.promote({
        candidateId: id,
        overrides: {
          datasetBinding: { datasetVersionId: OTHER_DATASET_VERSION_ID },
          datasetDivergenceReason: "事后改绑",
        },
      }),
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    );
    const bundle = await h.strategyRepo.getVersionBundle(first.strategyId, first.strategyVersion);
    expect(bundle?.document.datasetVersionId).toBe(SOURCE_DATASET_VERSION_ID);
  });

  it("21c) 已转正且带 divergence：重复传同一个原因 → 幂等通过；传新原因 → 拒绝", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);
    const reason = "研究 v2、执行 v3（窗口更长）";
    const first = await h.service.promote({
      candidateId: id,
      overrides: { datasetBinding: { datasetVersionId: OTHER_DATASET_VERSION_ID }, datasetDivergenceReason: reason },
    });
    const again = await h.service.promote({
      candidateId: id,
      overrides: { datasetBinding: { datasetVersionId: OTHER_DATASET_VERSION_ID }, datasetDivergenceReason: reason },
    });
    expect(again.idempotent).toBe(true);
    expect(again.strategyVersionId).toBe(first.strategyVersionId);

    await expectError(
      h.service.promote({
        candidateId: id,
        overrides: { datasetBinding: { datasetVersionId: OTHER_DATASET_VERSION_ID }, datasetDivergenceReason: "换了个说法" },
      }),
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    );
  });
});

// ---------------------------------------------------------------------------
// E. 跨存储失败 + 恢复（§25 / §26 / §39）
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · 跨存储失败与恢复（§25 / §26 / §39）", () => {
  it("22) provenance 写入失败：抛 PROMOTE_WRITEBACK_FAILED（带 strategyId / versionId），不删 Strategy，候选仍 ACCEPTED", async () => {
    const repos = createInMemoryResearchRepositories({
      datasetVersionExists: async (id) => snapshotOf(id) !== undefined,
      now: NOW,
    });
    const strategyRepo = new InMemoryStrategyRepository(() => NOW_ISO, {
      datasetRegistry: makeStrategyDatasetRegistry(),
    });
    const realProvenance = createInMemoryStrategyResearchProvenanceRepository({ now: NOW });
    let failNext = true;
    const flakyProvenance = {
      ...realProvenance,
      async create(input: Parameters<typeof realProvenance.create>[0]) {
        if (failNext) {
          failNext = false;
          throw new Error("注入故障：provenance 写库不可用");
        }
        return realProvenance.create(input);
      },
    };

    const experiment = await repos.experiments.create({
      datasetVersionId: SOURCE_DATASET_VERSION_ID,
      name: "E",
      researchType: "EVENT_STUDY",
    });
    const conclusion = await repos.conclusions.create({
      experimentId: experiment.id as number,
      conclusionType: "SUPPORTED",
      title: "T",
      conclusion: "C",
    });
    const service = createStrategyCandidateService({
      repos,
      datasetVersions: makeDatasetPort(),
      strategies: new StrategyServicePromotionPort(strategyRepo, { codeVersion: "test-1.0.0" }),
      provenance: flakyProvenance,
    });

    const view = await service.createFromConclusion({ conclusionId: conclusion.id as number });
    const id = view.candidate.id as number;
    await service.update(id, draftPatch() as never);
    await service.transition({ candidateId: id, to: "REVIEW" });
    await service.transition({ candidateId: id, to: "ACCEPTED" });

    const err = await expectError(
      service.promote({ candidateId: id }),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_WRITEBACK_FAILED,
    );
    const strategyId = `cand-${id}`;
    expect(err.details?.strategyId).toBe(strategyId);
    expect(err.details?.stage).toBe("PROVENANCE_WRITEBACK");
    expect(typeof err.details?.strategyVersionId).toBe("number");

    // ① Strategy **没有被删除**（§26 明确禁止 delete-and-retry）
    expect(await strategyCount(strategyRepo)).toBe(1);
    expect(await versionCount(strategyRepo, strategyId)).toBe(1);
    // ② 溯源里没有行（这一步失败了）
    expect(await realProvenance.listByStrategyId(strategyId)).toHaveLength(0);
    // ③ 候选保持 ACCEPTED（不许「看起来已完成」）
    expect((await repos.candidates.getById(id))?.status).toBe("ACCEPTED");

    // ④ 重试：命中既有版本（指纹一致）⇒ 补齐溯源与回写，**绝不产生第二个版本**
    const recovered = await service.promote({ candidateId: id });
    expect(recovered.strategyId).toBe(strategyId);
    expect(recovered.strategyVersionId).toBe(err.details?.strategyVersionId);
    expect(recovered.idempotent).toBe(true);
    expect(await versionCount(strategyRepo, strategyId)).toBe(1);
    expect(await strategyCount(strategyRepo)).toBe(1);
    expect((await realProvenance.listByStrategyId(strategyId))).toHaveLength(1);
    expect((await repos.candidates.getById(id))?.status).toBe("CONVERTED");
    expect((await repos.candidates.getById(id))?.strategyDefinitionId).toBe(strategyId);
  });

  it("23) 候选回写失败：抛 PROMOTE_WRITEBACK_FAILED，Strategy + provenance 都在，重试只补回写", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);

    // 注入点选在**仓储端口**（而不是真实库）：失败是构造出来的，不靠「碰巧出问题」。
    const original = h.repos.candidates;
    const originalUpdate = original.update.bind(original);
    let failNextConvertedWrite = true;
    const flakyRepos: ResearchRepositories = {
      ...h.repos,
      candidates: {
        ...original,
        update: (async (...args: Parameters<typeof originalUpdate>) => {
          const patch = args[1] as { status?: string };
          if (failNextConvertedWrite && patch.status === "CONVERTED") {
            failNextConvertedWrite = false;
            throw new Error("注入故障：候选回写不可用");
          }
          return originalUpdate(...args);
        }) as typeof original.update,
      },
    };
    const service = createStrategyCandidateService({
      repos: flakyRepos,
      datasetVersions: makeDatasetPort(),
      strategies: new StrategyServicePromotionPort(h.strategyRepo, { codeVersion: "test-1.0.0" }),
      provenance: h.provenance,
    });

    const err = await expectError(
      service.promote({ candidateId: id }),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_WRITEBACK_FAILED,
    );
    expect(err.details?.stage).toBe("CANDIDATE_WRITEBACK");
    const strategyId = `cand-${id}`;
    expect(await versionCount(h.strategyRepo, strategyId)).toBe(1);
    expect(await h.provenance.listByStrategyId(strategyId)).toHaveLength(1);
    expect((await h.repos.candidates.getById(id))?.status).toBe("ACCEPTED");

    const recovered = await service.promote({ candidateId: id });
    expect(recovered.idempotent).toBe(true);
    expect(await versionCount(h.strategyRepo, strategyId)).toBe(1);
    expect((await h.repos.candidates.getById(id))?.status).toBe("CONVERTED");
  });

  it("24) 候选已 CONVERTED 但溯源行消失（被绕过 promote 改过状态）→ PROMOTE_STATE_INCONSISTENT", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);
    const result = await h.service.promote({ candidateId: id });
    await h.provenance.deleteByStrategyVersionId(result.strategyVersionId);
    await expectError(
      h.service.promote({ candidateId: id }),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_STATE_INCONSISTENT,
    );
  });

  it("25) 溯源在、候选状态却不是 ACCEPTED/CONVERTED（状态与溯源不一致）→ PROMOTE_STATE_INCONSISTENT", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);
    await h.service.promote({ candidateId: id });

    // 构造「历史脏数据」：溯源在，但候选状态被绕过状态机改回了 REVIEW。
    // 通过仓储端口注入读取视图（不去破坏真实存储，也不动生产数据）。
    const original = h.repos.candidates;
    const dirtyRepos: ResearchRepositories = {
      ...h.repos,
      candidates: {
        ...original,
        getById: (async (...args: Parameters<typeof original.getById>) => {
          const row = await original.getById(...args);
          if (row?.id !== id) return row;
          return { ...row, status: "REVIEW" as const };
        }) as typeof original.getById,
      },
    };
    const service = createStrategyCandidateService({
      repos: dirtyRepos,
      datasetVersions: makeDatasetPort(),
      strategies: new StrategyServicePromotionPort(h.strategyRepo, { codeVersion: "test-1.0.0" }),
      provenance: h.provenance,
    });

    await expectError(
      service.promote({ candidateId: id }),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_STATE_INCONSISTENT,
    );
    // 真实存储未受影响：候选仍是 CONVERTED、版本仍只有一条
    expect((await original.getById(id))?.status).toBe("CONVERTED");
    expect(await versionCount(h.strategyRepo, `cand-${id}`)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F. Strategy 独立性（§41）
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · Strategy 独立性（§41）", () => {
  it("26) Research 侧登记录被删后，Strategy 版本仍可读 / 定义仍在（研究侧不是 Strategy 的依赖）", async () => {
    const h = await seedHarness({ skipDraft: true });
    const id = await seedAcceptedCandidate(h);
    const result = await h.service.promote({ candidateId: id });

    await h.repos.candidates.delete(id);
    await h.repos.conclusions.delete(h.conclusionId);
    await h.repos.experiments.delete(h.experimentId);

    const bundle = await h.strategyRepo.getVersionBundle(result.strategyId, result.strategyVersion);
    expect(bundle).toBeDefined();
    expect(bundle?.hasDefinition).toBe(true);
    expect(bundle?.projections.datasetBindings).toHaveLength(1);
    expect(bundle?.fingerprint).toBe(result.fingerprint);
    // 版本行 id 与 promote 返回一致（同一份事实，不是「又建了一个」）
    expect(bundle?.versionRowId).toBe(result.strategyVersionId);
  });

  it("27) 同一候选（两次独立运行）的 Strategy 身份是确定性的：cand-<id> + 1.0.0", async () => {
    const a = await seedHarness({ skipDraft: true });
    const idA = await seedAcceptedCandidate(a);
    const ra = await a.service.promote({ candidateId: idA });

    const b = await seedHarness({ skipDraft: true });
    const idB = await seedAcceptedCandidate(b);
    const rb = await b.service.promote({ candidateId: idB });

    // 不同候选 → 不同策略身份（不靠 name 派生，避免「同名撞车」与无法追溯）
    expect(ra.strategyId).toBe(`cand-${idA}`);
    expect(rb.strategyId).toBe(`cand-${idB}`);
    expect(ra.strategyVersion).toBe("1.0.0");
    expect(rb.strategyVersion).toBe("1.0.0");
  });
});
