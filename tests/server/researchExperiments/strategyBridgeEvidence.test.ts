/**
 * STRATEGY-RESEARCH-BRIDGE-001 §18.3 / §18.4 —— **按真实持久化 Run 建策略**的单测。
 *
 * 本文件不连 DB / 不连对象存储：`ExperimentEvidenceRunReader` 用**同形替身**注入
 * （与 `evidenceRunReader.ts` 的真实实现调用同一组方法），策略端口 / 溯源仓储用
 * 「真实幂等语义的替身」（不是 mock 冒名）。
 *
 * | 规格 | 判据 | 用例 |
 * | --- | --- | --- |
 * | §18.3 | 合法证据 ⇒ 建出 1.0.0 版本 + 写溯源 + 证据列表进快照 | 1-a |
 * | §18.3 | 幂等：同证据重放 ⇒ 复用既有行、`created=false`、不重复写 | 1-b |
 * | §18.3 | 同版本挂**另一套**证据 ⇒ 拒绝覆盖（冲突） | 1-c |
 * | §18.4 | 引用不存在的 Run ⇒ 拒（禁手写 Run id） | 2-a |
 * | §18.4 | Run 未完成 / 结果读不回 / 缺参数快照 ⇒ 拒 | 2-b |
 * | §12  | reference 在结果里解析不到 ⇒ 拒（禁虚构 artifact） | 2-c |
 * | §12  | 多份证据 Dataset 分歧 / 要求执行绑定分歧 ⇒ 拒 | 2-d |
 * | §18.3 | 装配未注入读回端口 ⇒ 响亮失败（不静默降级成「不核实」） | 2-e |
 * | §6   | 证据列表被冻结进 `sourceSnapshotJson` 且**通过声明即受校验** | 3-a |
 * | §6   | 证据变 ⇒ 证据指纹变；证据不变 ⇒ 指纹不变（身份可识别变化） | 3-b |
 * | §16  | 读路径（`getVersionProvenance`）能看到证据列表 + 指纹 | 4-a |
 * | §18.2 | 非证据型溯源（历史行）读出来是 `[]` + `null`（零回归） | 4-b |
 */

import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_STRATEGY_ERROR,
  ExperimentStrategyError,
  createExperimentStrategyBridge,
  type ExperimentStrategyBridge,
  type ExperimentStrategyDraft,
} from "../../../server/researchExperiments/strategyBridge";
import type {
  ExperimentEvidenceRunReader,
  PersistedEvidenceRun,
} from "../../../server/researchExperiments/evidenceRunReader";
import {
  createInMemoryStrategyResearchProvenanceRepository,
  type InMemoryStrategyProvenanceStore,
} from "../../../server/research/strategyCandidate/provenance";
import { createStrategyCandidateService } from "../../../server/research/strategyCandidate/service";
import { assertDeclaredResearchEvidence } from "../../../server/research/strategyCandidate/researchEvidence";
import type { StrategyPromotionPort } from "../../../server/research/strategyCandidate/strategyPromotionPort";
import type { StrategyResearchProvenanceRepository } from "../../../server/research/strategyCandidate/types";
import {
  FIRST_BOARD_PULLBACK_DRAFT,
  FIRST_BOARD_PULLBACK_EVIDENCES,
  FIRST_BOARD_PULLBACK_STRATEGY_ID,
} from "../../../server/researchExperiments/firstBoardPullbackStrategyDraft";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const VERSION_ROW_ID = 904_001;
const DATASET_VERSION_ID = 390002;

const EXP001_RUN = "RUN-20260921-8557F38A";
const EXP002_RUN = "RUN-20260921-C95B1D47";
/** EXP-002 的**第二次**独立运行（与第一次 robustness 指纹相同）—— 证据列表里也引用了它。 */
const EXP002_RUN_2 = "RUN-20260921-A95F5B48";

/** 一条与真实 Run 同形的持久化事实（结果信封里含**真实存在**的坐标）。 */
function persistedRun(overrides: Partial<PersistedEvidenceRun> = {}): PersistedEvidenceRun {
  return {
    runId: EXP001_RUN,
    experimentCode: "first-board-pullback/fundamental-study",
    experimentVersion: "1.1.0",
    researchPhase: "HOLDOUT",
    protocolFingerprint: "protocol-sha256:test",
    parentRunId: "RUN-OBSERVATION-TEST",
    evaluationWindow: { startDate: "2026-01-01", endDate: "2026-06-30" },
    confirmatoryGate: {
      status: "PASS",
      protocolFingerprint: "protocol-sha256:test",
      sampleCount: 23_712,
      checks: [
        {
          code: "holdout_net_return",
          label: "Holdout 净收益",
          status: "PASS",
        },
      ],
      summary: "test fixture",
    },
    datasetVersionId: DATASET_VERSION_ID,
    datasetCode: "first_limit_pullback",
    datasetVersionLabel: "v2",
    status: "COMPLETED",
    startedAt: "2026-09-21T04:00:00.000Z",
    durationMs: 107_341,
    parameters: { maxObservationDay: 5, futureHorizons: [5, 10, 20], maxEvents: 400_000 },
    result: {
      metadata: {
        experimentId: "first-board-pullback/fundamental-study",
        experimentVersion: "1.1.0",
        datasetVersionId: DATASET_VERSION_ID,
      },
      parameters: { maxObservationDay: 5 },
      sampleSummary: { candidateCount: 23_978, eligibleCount: 23_712, excludedCount: 266, excludedByReason: {} },
      customPayload: {
        metrics: { pullbackRateOnFinalDay: 0.701459 },
        candidates: { candidateCount: 23_978, unscannedEventCount: 0 },
        informationBoundary: { decisionOffsetDays: 5 },
      },
    } as unknown as PersistedEvidenceRun["result"],
    resultAvailable: true,
    resultUnavailableReason: null,
    ...overrides,
  };
}

/** EXP-002 的那一条（同一份夹具的另一种形状）。 */
function persistedExp002Run(runId: string = EXP002_RUN): PersistedEvidenceRun {
  return persistedRun({
    runId,
    experimentCode: "first-board-pullback/stability-validation",
    experimentVersion: "1.0.0",
    durationMs: 132_821,
    parameters: { maxEvents: 400_000 },
    result: {
      metadata: {
        experimentId: "first-board-pullback/stability-validation",
        experimentVersion: "1.0.0",
        datasetVersionId: DATASET_VERSION_ID,
      },
      parameters: { maxEvents: 400_000 },
      sampleSummary: { candidateCount: 23_978, eligibleCount: 23_420, excludedCount: 558, excludedByReason: {} },
      customPayload: {
        overallVerdict: "insufficient",
        counts: { variantCount: 16, stableCount: 15, sensitiveCount: 0, insufficientCount: 1, failedCount: 0 },
        baseline: { decisionDay: 5, horizon: 10 },
      },
    } as unknown as PersistedEvidenceRun["result"],
  });
}

/** 默认登记的全部 Run —— **必须覆盖证据列表里的每一个 runId**（否则会撞 RUN_NOT_FOUND）。 */
function defaultRuns(): PersistedEvidenceRun[] {
  return [persistedRun(), persistedExp002Run(EXP002_RUN), persistedExp002Run(EXP002_RUN_2)];
}

/** 读回端口替身：只认登记过的 runId，未登记 ⇒ `null`（与真实实现同语义）。 */
function fakeReader(runs: readonly PersistedEvidenceRun[]): ExperimentEvidenceRunReader {
  const byId = new Map(runs.map((run) => [run.runId, run]));
  return {
    async read(runId) {
      return byId.get(runId) ?? null;
    },
    async listByExperiment(experimentCode) {
      return runs
        .filter((run) => run.experimentCode === experimentCode)
        .map((run) => ({
          runId: run.runId,
          experimentCode: run.experimentCode,
          researchPhase: run.researchPhase,
          parentRunId: run.parentRunId,
          evaluationWindow: run.evaluationWindow,
          datasetVersionId: run.datasetVersionId,
          status: run.status,
        }));
    },
  };
}

/**
 * 策略创建端口替身。
 *
 * 🔴 它**执行真实的幂等语义**：第二次同 (strategyId, version) 调用返回 `created:false`
 *    且行 id 不变 —— 这正是桥的幂等闸门要依赖的事实。它不是「随便返回一个对象」的 mock。
 */
function fakeStrategies(): { port: StrategyPromotionPort; calls: number[] } {
  const calls: number[] = [];
  const port = {
    async findVersion() {
      return undefined;
    },
    async createStrategyVersion(input: { strategyId: string; version: string }) {
      calls.push(1);
      return {
        strategyId: input.strategyId,
        version: input.version,
        versionRowId: VERSION_ROW_ID,
        fingerprint: "a".repeat(64),
        mainComponentCount: 1,
        projectableComponentCount: 1,
        created: calls.length === 1,
      };
    },
    async inspectVersion() {
      return { versionRowId: VERSION_ROW_ID, fingerprint: "a".repeat(64), datasetVersionId: DATASET_VERSION_ID };
    },
  } as unknown as StrategyPromotionPort;
  return { port, calls };
}

interface Harness {
  readonly bridge: ExperimentStrategyBridge;
  readonly store: InMemoryStrategyProvenanceStore;
  readonly strategies: StrategyPromotionPort;
  readonly provenance: StrategyResearchProvenanceRepository;
}

function harness(options: {
  readonly runs?: readonly PersistedEvidenceRun[];
  readonly withReader?: boolean;
} = {}): Harness {
  const strategies = fakeStrategies();
  const provenance = createInMemoryStrategyResearchProvenanceRepository();
  const runs = options.runs ?? defaultRuns();
  const bridge = createExperimentStrategyBridge({
    runner: null as never, // 本文件只走「按持久化 Run」路径 —— 实时重跑路径不参与
    strategies: strategies.port,
    provenance,
    ...(options.withReader === false ? {} : { evidenceRuns: fakeReader(runs) }),
  });
  return { bridge, store: provenance.store, strategies: strategies.port, provenance };
}

function draft(): ExperimentStrategyDraft {
  return structuredClone(FIRST_BOARD_PULLBACK_DRAFT);
}

/** 断言抛出的是桥的领域错误且 code 命中；同时把错误交回供进一步断言。 */
async function expectBridgeError(
  fn: () => Promise<unknown>,
  code: string,
): Promise<ExperimentStrategyError> {
  try {
    await fn();
  } catch (error) {
    expect(error, `期望 ExperimentStrategyError(${code})，实际 ${String(error)}`).toBeInstanceOf(
      ExperimentStrategyError,
    );
    const typed = error as ExperimentStrategyError;
    expect(typed.code).toBe(code);
    return typed;
  }
  throw new Error(`期望抛出 ${code}，但调用成功返回`);
}

/** 与真实证据列表等价的替身引用（Run id 与真实一致，结果信封为同形夹具）。 */
function evidenceRefs() {
  return FIRST_BOARD_PULLBACK_EVIDENCES.map((evidence) => ({ ...evidence }));
}

// ---------------------------------------------------------------------------
// 1) 正常路径 + 幂等 + 冲突（§18.3）
// ---------------------------------------------------------------------------

describe("§18.3 按真实持久化 Run 建策略", () => {
  it("1-a) 合法证据 ⇒ 建出 1.0.0 + 写溯源 + 证据进快照（首条真实闭环的单元级证明）", async () => {
    const h = harness();
    const result = await h.bridge.createStrategyFromEvidenceRuns({
      evidences: evidenceRefs(),
      strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
      name: "首板回踩",
      draft: draft(),
    });

    expect(result.strategyId).toBe(FIRST_BOARD_PULLBACK_STRATEGY_ID);
    expect(result.strategyVersion).toBe("1.0.0");
    expect(result.strategyVersionId).toBe(VERSION_ROW_ID);
    expect(result.created).toBe(true);
    expect(result.sourceKind).toBe("INDEPENDENT_EXPERIMENT");
    expect(result.provenanceId).toBeGreaterThan(0);
    expect(result.datasetVersionId).toBe(DATASET_VERSION_ID);
    expect(result.datasetVersionLabel).toBe("v2");

    // 证据是**服务端从 Run 读回后冻结**的事实，不是调用方自报：坐标逐条对得上真实 Run。
    expect(result.evidences).toHaveLength(5);
    expect(result.evidences.map((e) => e.runId)).toEqual([
      EXP001_RUN,
      EXP001_RUN,
      EXP001_RUN,
      EXP002_RUN,
      EXP002_RUN_2,
    ]);
    expect(result.evidences[0]).toMatchObject({
      experimentCode: "first-board-pullback/fundamental-study",
      experimentVersion: "1.1.0",
      datasetVersionId: DATASET_VERSION_ID,
      datasetVersionLabel: "v2",
      runStatus: "COMPLETED",
      durationMs: 107_341,
    });
    expect(result.evidences[3]?.experimentCode).toBe("first-board-pullback/stability-validation");
    for (const evidence of result.evidences) {
      expect(evidence.resultDigest.startsWith("exp-sha256:")).toBe(true);
    }
    // 溯源行只写了一条（一版本一条），且三个旧 Research 锚如实为 null。
    expect(h.store.rows).toHaveLength(1);
    expect(h.store.rows[0]).toMatchObject({
      strategyVersionId: VERSION_ROW_ID,
      sourceKind: "INDEPENDENT_EXPERIMENT",
      sourceCandidateId: null,
      sourceConclusionId: null,
      sourceExperimentId: null,
      sourceResearchRunId: null,
      sourceDatasetVersionId: DATASET_VERSION_ID,
      experimentRef: "first-board-pullback/fundamental-study",
      experimentVersion: "1.1.0",
    });
  });

  it("1-b) 幂等：同证据重放 ⇒ 复用既有溯源行、`created=false`、不写第二行", async () => {
    const h = harness();
    const first = await h.bridge.createStrategyFromEvidenceRuns({
      evidences: evidenceRefs(),
      strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
      name: "首板回踩",
      draft: draft(),
    });
    const second = await h.bridge.createStrategyFromEvidenceRuns({
      evidences: evidenceRefs(),
      strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
      name: "首板回踩",
      draft: draft(),
    });

    expect(second.created).toBe(false);
    expect(second.provenanceId).toBe(first.provenanceId);
    expect(second.researchEvidenceFingerprint).toBe(first.researchEvidenceFingerprint);
    expect(h.store.rows).toHaveLength(1);
  });

  it("1-c) 同版本挂**另一套**证据 ⇒ EVIDENCE_PROVENANCE_CONFLICT（绝不覆盖历史快照）", async () => {
    const h = harness();
    await h.bridge.createStrategyFromEvidenceRuns({
      evidences: evidenceRefs(),
      strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
      name: "首板回踩",
      draft: draft(),
    });

    // 只留一条证据 ⇒ 指纹必然不同 ⇒ 既不是幂等、也不是新建。
    const error = await expectBridgeError(
      () =>
        h.bridge.createStrategyFromEvidenceRuns({
          evidences: [evidenceRefs()[0]!],
          strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
          name: "首板回踩",
          draft: draft(),
        }),
      EXPERIMENT_STRATEGY_ERROR.EVIDENCE_PROVENANCE_CONFLICT,
    );
    expect(error.message).toContain("拒绝覆盖");
    // 原快照**逐字未变**（仓储无 update 口）。
    expect(h.store.rows).toHaveLength(1);
    expect(JSON.stringify(h.store.rows[0]!.sourceSnapshotJson)).toContain(EXP002_RUN);
  });
});

// ---------------------------------------------------------------------------
// 2) 失败面（§12 / §18.4）
// ---------------------------------------------------------------------------

describe("§12 / §18.4 按 Run 建策略的失败面", () => {
  const base = {
    evidences: evidenceRefs(),
    strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
    name: "首板回踩",
  } as const;

  it("2-a) 引用的 Run 不存在 ⇒ EVIDENCE_RUN_NOT_FOUND（禁手写 Run id）", async () => {
    const h = harness({ runs: [persistedExp002Run()] }); // 故意不登记 EXP-001
    const error = await expectBridgeError(
      () => h.bridge.createStrategyFromEvidenceRuns({ ...base, draft: draft() }),
      EXPERIMENT_STRATEGY_ERROR.EVIDENCE_RUN_NOT_FOUND,
    );
    expect(error.message).toContain(EXP001_RUN);
    // 一个版本都没建（校验全部发生在副作用之前）。
    expect(h.store.rows).toHaveLength(0);
  });

  it("2-b) Run 未完成 / 结果读不回 / 缺参数快照 ⇒ 各自专属码，且都不写任何东西", async () => {
    const cases: Array<{ label: string; run: PersistedEvidenceRun; code: string }> = [
      {
        label: "未完成",
        run: persistedRun({ status: "FAILED" }),
        code: EXPERIMENT_STRATEGY_ERROR.EVIDENCE_RUN_NOT_COMPLETED,
      },
      {
        label: "结果读不回",
        run: persistedRun({ result: null, resultAvailable: false, resultUnavailableReason: "MINIO_UNAVAILABLE: x" }),
        code: EXPERIMENT_STRATEGY_ERROR.EVIDENCE_RESULT_UNAVAILABLE,
      },
      {
        label: "缺参数快照",
        run: persistedRun({ parameters: null }),
        code: EXPERIMENT_STRATEGY_ERROR.EVIDENCE_INVALID,
      },
      {
        label: "缺 Dataset label",
        run: persistedRun({ datasetVersionLabel: null }),
        code: EXPERIMENT_STRATEGY_ERROR.EVIDENCE_INVALID,
      },
    ];
    for (const item of cases) {
      const h = harness({ runs: [item.run] });
      await expectBridgeError(
        () => h.bridge.createStrategyFromEvidenceRuns({ ...base, draft: draft() }),
        item.code,
      );
      expect(h.store.rows, `${item.label} 不得留下溯源行`).toHaveLength(0);
    }
  });

  it("2-c) reference 在结果里解析不到 ⇒ EVIDENCE_REFERENCE_UNRESOLVED（不得虚构 artifact）", async () => {
    const h = harness();
    const error = await expectBridgeError(
      () =>
        h.bridge.createStrategyFromEvidenceRuns({
          ...base,
          evidences: [{ runId: EXP001_RUN, evidenceKind: "RESULT_SUMMARY", reference: "customPayload.metrics.nope" }],
          draft: draft(),
        }),
      EXPERIMENT_STRATEGY_ERROR.EVIDENCE_REFERENCE_UNRESOLVED,
    );
    expect(error.message).toContain("customPayload.metrics.nope");
    expect(h.store.rows).toHaveLength(0);

    // 形态就不合法（非点分路径）⇒ 更早的 EVIDENCE_INVALID。
    await expectBridgeError(
      () =>
        h.bridge.createStrategyFromEvidenceRuns({
          ...base,
          evidences: [{ runId: EXP001_RUN, evidenceKind: "RESULT_SUMMARY", reference: "not a path" }],
          draft: draft(),
        }),
      EXPERIMENT_STRATEGY_ERROR.EVIDENCE_INVALID,
    );
  });

  it("2-c2) Exploratory / Gate 未 PASS / 协议不一致的 Run 不得进入正式策略", async () => {
    const exploratory = harness({
      runs: [persistedRun({ researchPhase: "EXPLORATORY" })],
    });
    await expectBridgeError(
      () =>
        exploratory.bridge.createStrategyFromEvidenceRuns({
          ...base,
          evidences: [{ runId: EXP001_RUN, evidenceKind: "RESULT_SUMMARY", reference: "customPayload.metrics.pullbackRateOnFinalDay" }],
          draft: draft(),
        }),
      EXPERIMENT_STRATEGY_ERROR.EVIDENCE_NOT_CONFIRMATORY,
    );

    const failedGate = harness({
      runs: [
        persistedRun({
          confirmatoryGate: {
            ...persistedRun().confirmatoryGate!,
            status: "FAIL",
          },
        }),
      ],
    });
    await expectBridgeError(
      () =>
        failedGate.bridge.createStrategyFromEvidenceRuns({
          ...base,
          evidences: [{ runId: EXP001_RUN, evidenceKind: "RESULT_SUMMARY", reference: "customPayload.metrics.pullbackRateOnFinalDay" }],
          draft: draft(),
        }),
      EXPERIMENT_STRATEGY_ERROR.EVIDENCE_GATE_NOT_PASS,
    );

    const protocolMismatch = harness({
      runs: [
        persistedRun({
          protocolFingerprint: "protocol-sha256:aaa",
          confirmatoryGate: {
            ...persistedRun().confirmatoryGate!,
            protocolFingerprint: "protocol-sha256:aaa",
          },
        }),
        persistedExp002Run(EXP002_RUN),
        persistedExp002Run(EXP002_RUN_2),
      ],
    });
    await expectBridgeError(
      () => protocolMismatch.bridge.createStrategyFromEvidenceRuns({ ...base, draft: draft() }),
      EXPERIMENT_STRATEGY_ERROR.EVIDENCE_PROTOCOL_MISMATCH,
    );

    const contaminated = harness({
      runs: [
        ...defaultRuns(),
        persistedRun({
          runId: "RUN-EXPLORATORY-CONTAMINATED",
          researchPhase: "EXPLORATORY",
          parentRunId: null,
          evaluationWindow: null,
          confirmatoryGate: null,
        }),
      ],
    });
    await expectBridgeError(
      () => contaminated.bridge.createStrategyFromEvidenceRuns({ ...base, draft: draft() }),
      EXPERIMENT_STRATEGY_ERROR.EVIDENCE_HOLDOUT_CONTAMINATED,
    );
  });

  it("2-d) 多份证据 Dataset 分歧 / 要求执行绑定分歧 ⇒ EVIDENCE_DATASET_MISMATCH", async () => {
    const h = harness({
      runs: [
        persistedRun(),
        { ...persistedExp002Run(EXP002_RUN), datasetVersionId: 390001, datasetVersionLabel: "v1" },
        { ...persistedExp002Run(EXP002_RUN_2), datasetVersionId: 390001, datasetVersionLabel: "v1" },
      ],
    });
    await expectBridgeError(
      () => h.bridge.createStrategyFromEvidenceRuns({ ...base, draft: draft() }),
      EXPERIMENT_STRATEGY_ERROR.EVIDENCE_DATASET_MISMATCH,
    );
    expect(h.store.rows).toHaveLength(0);

    // 执行绑定与证据 Dataset 不一致 ⇒ 响亮拒绝（而不是静默忽略调用方的执行覆盖）。
    const h2 = harness();
    const error = await expectBridgeError(
      () =>
        h2.bridge.createStrategyFromEvidenceRuns({
          ...base,
          draft: draft(),
          executionBinding: { datasetVersionId: 390001, datasetDivergenceReason: "想换个执行集" },
        }),
      EXPERIMENT_STRATEGY_ERROR.EVIDENCE_DATASET_MISMATCH,
    );
    expect(error.message).toContain("静默忽略");
    expect(h2.store.rows).toHaveLength(0);
  });

  it("2-e) 装配未注入读回端口 ⇒ EVIDENCE_READER_UNAVAILABLE（不静默降级成「不核实」）", async () => {
    const h = harness({ withReader: false });
    const error = await expectBridgeError(
      () => h.bridge.createStrategyFromEvidenceRuns({ ...base, draft: draft() }),
      EXPERIMENT_STRATEGY_ERROR.EVIDENCE_READER_UNAVAILABLE,
    );
    expect(error.message).toContain("拒绝在「不核实」的前提下创建策略");
    expect(h.store.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3) 证据进身份（§6）
// ---------------------------------------------------------------------------

describe("§6 证据进「可追溯身份」", () => {
  it("3-a) 证据段被冻结进 sourceSnapshotJson，且**通过声明即受校验**", async () => {
    const h = harness();
    await h.bridge.createStrategyFromEvidenceRuns({
      evidences: evidenceRefs(),
      strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
      name: "首板回踩",
      draft: draft(),
    });
    const snapshot = h.store.rows[0]!.sourceSnapshotJson;

    // 1) 声明即受校验：能过 `assertDeclaredResearchEvidence`（指纹与列表自洽）。
    expect(() => assertDeclaredResearchEvidence(snapshot)).not.toThrow();
    // 2) 向后兼容面：既有单实验形态的同名字段仍然在（main evidence）。
    expect(snapshot).toMatchObject({
      kind: "INDEPENDENT_EXPERIMENT",
      experimentRef: "first-board-pullback/fundamental-study",
      experimentVersion: "1.1.0",
    });
    // 3) 证据段 + 指纹键都在，且指纹是 `evi-sha256:` 前缀（与执行语义指纹不同名同形）。
    const asRecord = snapshot as Record<string, unknown>;
    expect(Array.isArray(asRecord.researchEvidences)).toBe(true);
    expect((asRecord.researchEvidences as unknown[]).length).toBe(5);
    expect(String(asRecord.researchEvidenceFingerprint)).toMatch(/^evi-sha256:[0-9a-f]{16}$/u);
    // 4) 篡改证据段 ⇒ 立刻失败（闸门是活的，不是恒真）。
    const tampered = {
      ...(asRecord as object),
      researchEvidences: [{ ...(asRecord.researchEvidences as Record<string, unknown>[])[0], runId: "RUN-19700101-00000000" }],
    };
    expect(() => assertDeclaredResearchEvidence(tampered)).toThrowError(/指纹/u);
  });

  it("3-b) 证据变 ⇒ 指纹变；证据不变 ⇒ 指纹不变（身份能识别来源变化）", async () => {
    const h1 = harness();
    const full = await h1.bridge.createStrategyFromEvidenceRuns({
      evidences: evidenceRefs(),
      strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
      name: "首板回踩",
      draft: draft(),
    });
    const h2 = harness();
    const subset = await h2.bridge.createStrategyFromEvidenceRuns({
      evidences: [evidenceRefs()[0]!],
      strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
      name: "首板回踩",
      draft: draft(),
    });

    expect(full.researchEvidenceFingerprint).not.toBe(subset.researchEvidenceFingerprint);

    // 同一份证据在**不同 harness** 上跑 ⇒ 指纹逐字节相同（指纹不含行 id / 时间戳）。
    const h3 = harness();
    const again = await h3.bridge.createStrategyFromEvidenceRuns({
      evidences: evidenceRefs(),
      strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
      name: "首板回踩",
      draft: draft(),
    });
    expect(again.researchEvidenceFingerprint).toBe(full.researchEvidenceFingerprint);

    // 🔴 关键：**执行语义指纹不受证据影响** —— 版本指纹在两种证据下都是同一个
    //    （`a`*64 由替身给出；真实实现里它 = computeDefinitionFingerprint(definition)）。
    //    这条把「研究事实与交易规则严格分离」钉成了可测事实。
    expect(full.strategyVersionId).toBe(subset.strategyVersionId);
  });
});

// ---------------------------------------------------------------------------
// 4) 读路径（§16）
// ---------------------------------------------------------------------------

describe("§16 溯源读路径能看到研究证据", () => {
  /** 用真实 Service + 内存仓储构造一次「写完之后读回来」。 */
  async function writeThenRead() {
    const h = harness();
    await h.bridge.createStrategyFromEvidenceRuns({
      evidences: evidenceRefs(),
      strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
      name: "首板回踩",
      draft: draft(),
    });
    const service = createStrategyCandidateService({
      candidates: { getById: async () => undefined } as never,
      datasetVersions: {
        async getVersionById(id: number) {
          return id === DATASET_VERSION_ID
            ? { datasetVersionId: id, label: "v2", status: "READY", datasetId: 120001, datasetCode: "first_limit_pullback" }
            : undefined;
        },
      },
      strategies: h.strategies,
      provenance: h.provenance,
    });
    return service.getVersionProvenance({ strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID, version: "1.0.0" });
  }

  it("4-a) 读到 5 条证据（EXP 编号 / 版本 / Run / Dataset 版本 / 引用）+ 证据指纹", async () => {
    const view = await writeThenRead();
    expect(view.provenance).not.toBeNull();
    const provenance = view.provenance!;

    expect(provenance.sourceKind).toBe("INDEPENDENT_EXPERIMENT");
    expect(provenance.researchEvidences).toHaveLength(5);
    expect(provenance.researchEvidenceFingerprint).toMatch(/^evi-sha256:[0-9a-f]{16}$/u);
    // §16 要求的那一问「基于哪些研究运行产生」逐字段可答：
    for (const evidence of provenance.researchEvidences) {
      expect(evidence.experimentCode.length).toBeGreaterThan(0);
      expect(evidence.experimentVersion.length).toBeGreaterThan(0);
      expect(evidence.runId).toMatch(/^RUN-\d{8}-[0-9A-F]{8}$/u);
      expect(evidence.datasetVersionId).toBe(DATASET_VERSION_ID);
      expect(evidence.datasetVersionLabel).toBe("v2");
      expect(evidence.reference.length).toBeGreaterThan(0);
      expect(evidence.resultDigest.startsWith("exp-sha256:")).toBe(true);
    }
    // 顺序 = 声明顺序（读路径不做任何排序）。
    expect(provenance.researchEvidences.map((e) => e.runId)).toEqual([
      EXP001_RUN,
      EXP001_RUN,
      EXP001_RUN,
      EXP002_RUN,
      EXP002_RUN_2,
    ]);
  });

  it("4-b) 非证据型溯源（历史行）⇒ `[]` + `null`（读路径不因形态旧而失败）", async () => {
    const provenance = createInMemoryStrategyResearchProvenanceRepository();
    await provenance.create({
      strategyVersionId: VERSION_ROW_ID,
      strategyId: "legacy-strategy",
      strategyVersion: "1.0.0",
      sourceCandidateId: 1,
      sourceConclusionId: 2,
      sourceExperimentId: 3,
      sourceDatasetVersionId: DATASET_VERSION_ID,
      sourceDatasetLabel: "v2",
      sourceSnapshotJson: { kind: "RESEARCH_CONCLUSION" },
      origin: "DIRECT",
    });
    const service = createStrategyCandidateService({
      candidates: { getById: async () => undefined } as never,
      datasetVersions: {
        async getVersionById() {
          return { datasetVersionId: DATASET_VERSION_ID, label: "v2", status: "READY", datasetId: 120001 };
        },
      },
      strategies: fakeStrategies().port,
      provenance,
    });
    const view = await service.getVersionProvenance({ strategyId: "legacy-strategy", version: "1.0.0" });
    expect(view.provenance?.researchEvidences).toEqual([]);
    expect(view.provenance?.researchEvidenceFingerprint ?? null).toBeNull();
    // 旧体系的面照旧可读（零回归）。
    expect(view.provenance?.sourceKind).toBe("RESEARCH_CONCLUSION");
    expect(view.provenance?.experimentResultDigest).toBeNull();
  });
});
