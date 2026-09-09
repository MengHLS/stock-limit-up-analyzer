/**
 * STEP 13 / C-13.3 — Experiment Lineage（§28 实验谱系追踪）测试。
 *
 * 覆盖（对应任务验收）：
 *   (a) code_version 注入式解析确定性 / 格式（无 IO、测试传假值）；
 *   (b) 兼容映射正确性：既有测试风格 ResearchExperiment fixture → §28 记录；
 *       dataset 无 version / costModel 未冻结时显式 missing（不猜），注入后 15 项齐备可过；
 *       Snapshot 映射需注入 createdAt；
 *   (c) 15 项齐备性校验器：缺项 / 格式非法 / cost-slippage 不一致 → 结构化 issue；
 *       metrics/result 可选（outcome=null 合法、requireOutcome 时强制）；
 *   (d) fingerprint 确定性 / 不可变 / 序列化 round-trip（防篡改）；
 *   (e) regime 未评估占位语义（unassessed + reason，validate 不误报）；
 *   (f) outcome 挂载（metrics/result）与跨 Run / 错实验 / 双重挂载拒绝；
 *   (g) ExperimentRegistry 只读桥（不改既有类）。
 */

import { describe, expect, it } from "vitest";
import type { CostModel, PerformanceMetrics } from "../../engine/domain";
import type { ResearchExperiment, ResearchExperimentSnapshot } from "../types";
import type { ResearchRun } from "../run";
import { ExperimentRegistry } from "../experimentRegistry";
import { ResearchValidationError } from "../experimentValidation";
import {
  CODE_VERSION_UNKNOWN,
  composeCodeVersion,
  computeExperimentLineageFingerprint,
  createExperimentLineageRecord,
  deserializeExperimentLineageRecord,
  DEFAULT_REGIME_UNASSESSED_REASON,
  ExperimentLineageBridge,
  EXPERIMENT_LINEAGE_RECORD_KIND,
  EXPERIMENT_LINEAGE_RECORD_VERSION,
  experimentToLineageRecord,
  isValidCodeVersionFormat,
  isValidDatasetVersionFormat,
  mountRunOutcome,
  REGIME_UNASSESSED_REASON_CODE,
  serializeExperimentLineageRecord,
  snapshotToLineageRecord,
  validateExperimentLineageRecord,
  type ExperimentLineageMappingContext,
  type ExperimentLineageRecordInput,
} from "./index";

// ---------------------------------------------------------------------------
// Fixtures（既有研究层测试风格：experimentPersistence.test.ts 同构）
// ---------------------------------------------------------------------------

const DATASET_VERSION = "rd-1.0.0-1-cffc2a0e66efbf0b";

const COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

const PERFORMANCE: PerformanceMetrics = {
  totalReturnPct: 20,
  annualizedReturnPct: null,
  annualizedVolatilityPct: null,
  sharpeRatio: null,
  maxDrawdownPct: 5,
  tradeCount: 12,
  completedTradeCount: 10,
  winRatePct: null,
  profitFactor: null,
  averageWin: null,
  averageLoss: null,
  expectancy: null,
  openPositionCount: 2,
};

/** 现代 fixture：dataset 带内容寻址 datasetVersion + 冻结 costModel。 */
function makeFullExperiment(experimentId = "EXP-20260906-LINEAGE01"): ResearchExperiment {
  return {
    experimentId,
    strategyId: "leader-candidate-baseline",
    strategyVersion: "1.0.0",
    parameterSet: { minScore: null, maxSignals: 5, featureMode: "limit-up-confirm" },
    dataset: {
      startDate: "2026-01-05",
      endDate: "2026-03-31",
      universe: "limit-up",
      datasetVersion: DATASET_VERSION,
    },
    featureConfig: { featureMode: "limit-up-confirm" },
    backtestConfig: {
      initialCapital: 100_000,
      maxPositions: 5,
      costModel: structuredClone(COST_MODEL),
      executionModel: "next-open",
    },
    createdAt: "2026-09-06T00:00:00.000Z",
    status: "created",
  };
}

/** 旧式 fixture：dataset 无 version、backtestConfig 无冻结 costModel（与 C-13.3 前实验同态）。 */
function makeLegacyExperiment(): ResearchExperiment {
  return {
    experimentId: "EXP-20260906-LEGACY01",
    strategyId: "leader-candidate-baseline",
    strategyVersion: "0.9.0",
    parameterSet: { minScore: null, maxSignals: 5 },
    dataset: { startDate: "2026-01-05", endDate: "2026-01-08", universe: "limit-up" },
    backtestConfig: {
      initialCapital: 100_000,
      maxPositions: 5,
      commissionRate: 0.0003,
      slippageRate: 0.001,
      lotSize: 100,
      executionModel: "next-open",
    },
    createdAt: "2026-09-06T00:00:00.000Z",
    status: "completed",
  };
}

function makeSnapshot(experiment: ResearchExperiment): ResearchExperimentSnapshot {
  const { createdAt: _ignored, status: _ignoredStatus, ...snapshot } = experiment;
  return snapshot;
}

/** 全解析 mapping context（本模块假设 codeVersion 由入口用 composeCodeVersion 注入）。 */
function makeFullContext(): ExperimentLineageMappingContext {
  return {
    codeVersion: composeCodeVersion({ packageVersion: "1.0.0", git: { commitShortHash: "2b786f7", dirty: false } }),
    universeVersion: DATASET_VERSION,
  };
}

/** 直接构造输入的 helper（各字段 override 用）。 */
function makeLineageInput(overrides: Partial<ExperimentLineageRecordInput> = {}): ExperimentLineageRecordInput {
  return {
    experimentId: "EXP-20260906-LINEAGE01",
    strategyId: "leader-candidate-baseline",
    strategyVersion: "1.0.0",
    datasetVersion: { kind: "resolved", value: DATASET_VERSION },
    universeVersion: { kind: "resolved", value: DATASET_VERSION },
    parameterSet: { minScore: null, maxSignals: 5 },
    dateRange: { startDate: "2026-01-05", endDate: "2026-03-31" },
    costModel: { kind: "frozen", model: structuredClone(COST_MODEL) },
    slippageModel: { kind: "resolved", model: "fixed-bps", slippageBps: 10 },
    executionModel: { kind: "resolved", value: "next-open" },
    regime: { kind: "unassessed", reasonCode: REGIME_UNASSESSED_REASON_CODE, reason: DEFAULT_REGIME_UNASSESSED_REASON },
    outcome: null,
    codeVersion: { kind: "resolved", value: "1.0.0+g2b786f7" },
    createdAt: "2026-09-06T00:00:00.000Z",
    ...overrides,
  };
}

function makeRunResult(experimentId: string, runId: string): ResearchRun {
  return {
    runId,
    experimentId,
    status: "succeeded",
    startedAt: "2026-09-06T01:00:00.000Z",
    finishedAt: "2026-09-06T01:01:00.000Z",
    result: {
      metadata: {
        strategyId: "leader-candidate-baseline",
        strategyVersion: "1.0.0",
        startDate: "2026-01-05",
        endDate: "2026-03-31",
        initialCapital: 100_000,
        generatedAt: "2026-09-06T01:01:00.000Z",
      },
      config: {
        strategyId: "leader-candidate-baseline",
        strategyVersion: "1.0.0",
        initialCapital: 100_000,
        startDate: "2026-01-05",
        endDate: "2026-03-31",
        cost: structuredClone(COST_MODEL),
        maxPositions: 5,
        maxPositionAmountRatio: 0,
      },
      performance: structuredClone(PERFORMANCE),
      finalEquity: 120_000,
    },
    error: null,
    createdAt: "2026-09-06T01:00:00.000Z",
  };
}

/** 断言抛 ResearchValidationError 且含指定 issue code。 */
function expectValidationIssueCodes(action: () => unknown, codes: string[]): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ResearchValidationError);
    const issues = (error as ResearchValidationError).issues;
    for (const code of codes) {
      expect(issues.map((issue) => issue.code)).toContain(code);
    }
    return;
  }
  throw new Error(`期望抛 ResearchValidationError（含 ${codes.join(", ")}），实际未抛错`);
}

// ---------------------------------------------------------------------------
// (a) code_version
// ---------------------------------------------------------------------------

describe("code_version（注入式纯函数）", () => {
  it("composeCodeVersion 确定性组合（clean / dirty / 无 git / 全无）", () => {
    expect(composeCodeVersion({ packageVersion: "1.0.0", git: { commitShortHash: "2b786f7", dirty: false } }))
      .toBe("1.0.0+g2b786f7");
    expect(composeCodeVersion({ packageVersion: "1.0.0", git: { commitShortHash: "2b786f7", dirty: true } }))
      .toBe("1.0.0+g2b786f7.dirty");
    // dirty=null（未校验）：保守按 dirty 标记，不伪装 clean。
    expect(composeCodeVersion({ packageVersion: "1.0.0", git: { commitShortHash: "2b786f7", dirty: null } }))
      .toBe("1.0.0+g2b786f7.dirty");
    expect(composeCodeVersion({ packageVersion: "1.0.0", git: { commitShortHash: null, dirty: null } }))
      .toBe("1.0.0+gunknown");
    expect(composeCodeVersion({ packageVersion: "1.0.0", git: { commitShortHash: "", dirty: null } }))
      .toBe("1.0.0+gunknown");
    expect(composeCodeVersion({ packageVersion: null, git: { commitShortHash: null, dirty: null } }))
      .toBe(CODE_VERSION_UNKNOWN);
    expect(composeCodeVersion({ packageVersion: null, git: { commitShortHash: "2b786f7", dirty: false } }))
      .toBe("unknown+g2b786f7");
  });

  it("composeCodeVersion 非法来源响亮抛错（不静默）", () => {
    expect(() => composeCodeVersion({ packageVersion: "", git: { commitShortHash: null, dirty: null } })).toThrow(/空串/);
    expect(() => composeCodeVersion({ packageVersion: "1.0.0+build", git: { commitShortHash: null, dirty: null } })).toThrow(/\+/);
    expect(() => composeCodeVersion({ packageVersion: "1.0.0", git: { commitShortHash: "NOT-A-HASH", dirty: false } })).toThrow(/hex/);
  });

  it("isValidCodeVersionFormat 识别规范形态、拒绝空白等垃圾值", () => {
    expect(isValidCodeVersionFormat("1.0.0+g2b786f7")).toBe(true);
    expect(isValidCodeVersionFormat("1.0.0+g2b786f7.dirty")).toBe(true);
    expect(isValidCodeVersionFormat("unknown+g2b786f7")).toBe(true);
    expect(isValidCodeVersionFormat(CODE_VERSION_UNKNOWN)).toBe(true);
    expect(isValidCodeVersionFormat("bad value with space")).toBe(false);
    expect(isValidCodeVersionFormat("")).toBe(false);
  });

  it("isValidDatasetVersionFormat 识别内容寻址 rd 版本", () => {
    expect(isValidDatasetVersionFormat(DATASET_VERSION)).toBe(true);
    expect(isValidDatasetVersionFormat("v1")).toBe(false);
    expect(isValidDatasetVersionFormat("latest")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) 兼容映射
// ---------------------------------------------------------------------------

describe("映射：ResearchExperiment → §28 谱系记录", () => {
  it("现代 fixture 映射后 §28 15 项齐备、可校验通过", () => {
    const record = experimentToLineageRecord(makeFullExperiment(), makeFullContext());
    expect(record.recordKind).toBe(EXPERIMENT_LINEAGE_RECORD_KIND);
    expect(record.recordVersion).toBe(EXPERIMENT_LINEAGE_RECORD_VERSION);
    expect(record.experimentId).toBe("EXP-20260906-LINEAGE01");
    expect(record.strategyId).toBe("leader-candidate-baseline");
    expect(record.strategyVersion).toBe("1.0.0");
    expect(record.datasetVersion).toEqual({ kind: "resolved", value: DATASET_VERSION });
    expect(record.universeVersion).toEqual({ kind: "resolved", value: DATASET_VERSION });
    expect(record.costModel).toEqual({ kind: "frozen", model: COST_MODEL });
    expect(record.slippageModel).toEqual({ kind: "resolved", model: "fixed-bps", slippageBps: 10 });
    expect(record.executionModel).toEqual({ kind: "resolved", value: "next-open" });
    expect(record.codeVersion).toEqual({ kind: "resolved", value: "1.0.0+g2b786f7" });
    expect(record.createdAt).toBe("2026-09-06T00:00:00.000Z");
    expect(record.dateRange).toEqual({ startDate: "2026-01-05", endDate: "2026-03-31" });
    expect(record.outcome).toBeNull();

    const validation = validateExperimentLineageRecord(record);
    expect(validation.valid).toBe(true);
  });

  it("dataset 无 version / costModel 未冻结：显式 missing（不猜），缺项全部机器可见", () => {
    const record = experimentToLineageRecord(makeLegacyExperiment(), { codeVersion: "1.0.0+g2b786f7" });
    expect(record.datasetVersion.kind).toBe("missing");
    expect(record.universeVersion.kind).toBe("missing");
    expect(record.costModel.kind).toBe("missing");
    expect(record.slippageModel.kind).toBe("missing");
    // executionModel 有载体 → resolved。
    expect(record.executionModel).toEqual({ kind: "resolved", value: "next-open" });

    const validation = validateExperimentLineageRecord(record);
    expect(validation.valid).toBe(false);
    const codes = validation.issues.map((issue) => issue.code);
    expect(codes).toContain("LINEAGE_DATASET_VERSION_UNRESOLVED");
    expect(codes).toContain("LINEAGE_UNIVERSE_VERSION_UNRESOLVED");
    expect(codes).toContain("LINEAGE_COST_MODEL_UNRESOLVED");
    expect(codes).toContain("LINEAGE_SLIPPAGE_MODEL_UNRESOLVED");
    // 缺项带中文原因（不静默）。
    expect((record.datasetVersion as { reason?: string }).reason).toContain("datasetVersion");
    expect((record.costModel as { reason?: string }).reason).toContain("costModel");
  });

  it("legacy fixture + 显式注入（dataset/universe/code/costModel）→ 15 项可校验通过", () => {
    const context: ExperimentLineageMappingContext = {
      codeVersion: "1.0.0+g2b786f7",
      datasetVersion: DATASET_VERSION,
      universeVersion: DATASET_VERSION,
      costModel: structuredClone(COST_MODEL),
    };
    const record = experimentToLineageRecord(makeLegacyExperiment(), context);
    const validation = validateExperimentLineageRecord(record);
    expect(validation.valid).toBe(true);
    expect(record.datasetVersion).toEqual({ kind: "resolved", value: DATASET_VERSION });
    expect(record.costModel).toEqual({ kind: "frozen", model: COST_MODEL });
    expect(record.slippageModel).toEqual({ kind: "resolved", model: "fixed-bps", slippageBps: 10 });
  });

  it("载体已给值 + context 注入不同值 → 响亮抛错（禁止冲突）", () => {
    const context: ExperimentLineageMappingContext = {
      codeVersion: "1.0.0+g2b786f7",
      datasetVersion: "rd-2.0.0-1-aaaaaaaaaaaaaaaa",
    };
    expect(() => experimentToLineageRecord(makeFullExperiment(), context)).toThrow(/不一致/);
  });

  it("Snapshot 映射：不含 createdAt → 必须 context.createdAt 注入", () => {
    const snapshot = makeSnapshot(makeFullExperiment());
    expect(() => snapshotToLineageRecord(snapshot, { codeVersion: "1.0.0+g2b786f7" })).toThrow(/createdAt/);
    const record = snapshotToLineageRecord(snapshot, {
      codeVersion: "1.0.0+g2b786f7",
      universeVersion: DATASET_VERSION,
      createdAt: "2026-09-06T00:00:00.000Z",
    });
    expect(record.createdAt).toBe("2026-09-06T00:00:00.000Z");
    expect(validateExperimentLineageRecord(record).valid).toBe(true);
  });

  it("deterministic：同输入两次映射深相等（含 fingerprint）", () => {
    const a = experimentToLineageRecord(makeFullExperiment(), makeFullContext());
    const b = experimentToLineageRecord(makeFullExperiment(), makeFullContext());
    expect(a).toEqual(b);
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// (c) 15 项齐备性校验器
// ---------------------------------------------------------------------------

describe("§28 齐备性校验器", () => {
  it("结构档（requireResolvedRefs=false）允许显式 missing；齐备档（默认）报缺项", () => {
    const record = createExperimentLineageRecord(makeLineageInput({
      datasetVersion: { kind: "missing", code: "LINEAGE_DATASET_VERSION_UNRESOLVED", reason: "无数据集版本载体" },
    }));
    expect(validateExperimentLineageRecord(record, { requireResolvedRefs: false }).valid).toBe(true);
    expect(validateExperimentLineageRecord(record).valid).toBe(false);
  });

  it("resolved 版本格式非法 → 结构化 issue（dataset 版本格式错）", () => {
    expectValidationIssueCodes(
      () => createExperimentLineageRecord(makeLineageInput({
        datasetVersion: { kind: "resolved", value: "v1" },
      })),
      ["LINEAGE_DATASET_VERSION_FORMAT_INVALID"],
    );
  });

  it("costModel 与 slippageModel 交叉不一致 → 结构化 issue", () => {
    expectValidationIssueCodes(
      () => createExperimentLineageRecord(makeLineageInput({
        slippageModel: { kind: "resolved", model: "fixed-bps", slippageBps: 20 },
      })),
      ["LINEAGE_SLIPPAGE_COST_MISMATCH"],
    );
  });

  it("metrics/result 可选：outcome=null 时齐备档可过；requireOutcome=true 时给缺项 issue", () => {
    const record = createExperimentLineageRecord(makeLineageInput());
    expect(validateExperimentLineageRecord(record).valid).toBe(true);
    const forced = validateExperimentLineageRecord(record, { requireOutcome: true });
    expect(forced.valid).toBe(false);
    expect(forced.issues.map((issue) => issue.code)).toContain("LINEAGE_OUTCOME_REQUIRED");
  });

  it("codeVersion 为 resolved 但形态垃圾 → 结构化 issue", () => {
    expectValidationIssueCodes(
      () => createExperimentLineageRecord(makeLineageInput({
        codeVersion: { kind: "resolved", value: "not a code version" },
      })),
      ["LINEAGE_CODE_VERSION_FORMAT_INVALID"],
    );
  });

  it("createdAt 非 ISO → 结构化 issue", () => {
    expectValidationIssueCodes(
      () => createExperimentLineageRecord(makeLineageInput({ createdAt: "yesterday" })),
      ["LINEAGE_DATE_TIME_INVALID"],
    );
  });

  it("missing ref 携带非法 code → 结构化 issue（白名单强制）", () => {
    expectValidationIssueCodes(
      () => createExperimentLineageRecord(makeLineageInput({
        codeVersion: { kind: "missing", code: "NOT_IN_WHITELIST", reason: "x" },
      })),
      ["LINEAGE_MISSING_CODE_INVALID"],
    );
  });

  it("regime 缺省占位语义：unassessed + reason，不误报；assessed 亦可校验通过", () => {
    const record = createExperimentLineageRecord(makeLineageInput());
    expect(record.regime).toEqual({
      kind: "unassessed",
      reasonCode: REGIME_UNASSESSED_REASON_CODE,
      reason: DEFAULT_REGIME_UNASSESSED_REASON,
    });
    expect(validateExperimentLineageRecord(record).valid).toBe(true);

    const assessed = createExperimentLineageRecord(makeLineageInput({
      regime: { kind: "assessed", regimeId: "RISK-ON", note: "示例评估（C-22.1 后语义）" },
    }));
    expect(validateExperimentLineageRecord(assessed).valid).toBe(true);
  });

  it("assess 形态：regimeId 为空 → issue", () => {
    expectValidationIssueCodes(
      () => createExperimentLineageRecord(makeLineageInput({
        regime: { kind: "assessed", regimeId: "  " },
      })),
      ["LINEAGE_REGIME_ID_EMPTY"],
    );
  });
});

// ---------------------------------------------------------------------------
// (d) fingerprint / 不可变 / round-trip
// ---------------------------------------------------------------------------

describe("fingerprint / 不可变 / 序列化", () => {
  it("记录不可变（深冻结）", () => {
    const record = createExperimentLineageRecord(makeLineageInput());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.datasetVersion as object)).toBe(true);
    expect(Object.isFrozen(record.parameterSet as object)).toBe(true);
    expect(() => {
      (record as { experimentId: string }).experimentId = "EXP-20260906-HACK";
    }).toThrow(TypeError);
  });

  it("指纹对内容敏感：createdAt 不同 → fingerprint 不同；同内容必同指纹", () => {
    const a = createExperimentLineageRecord(makeLineageInput());
    const b = createExperimentLineageRecord(makeLineageInput({ createdAt: "2026-09-06T00:00:01.000Z" }));
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(createExperimentLineageRecord(makeLineageInput()).fingerprint).toBe(a.fingerprint);
  });

  it("serialize → deserialize round-trip 一致（含 missing ref 记录）", () => {
    const full = createExperimentLineageRecord(makeLineageInput());
    expect(deserializeExperimentLineageRecord(serializeExperimentLineageRecord(full))).toEqual(full);

    const missingRecord = createExperimentLineageRecord(makeLineageInput({
      datasetVersion: { kind: "missing", code: "LINEAGE_DATASET_VERSION_UNRESOLVED", reason: "无数据集版本载体" },
    }));
    const back = deserializeExperimentLineageRecord(serializeExperimentLineageRecord(missingRecord));
    expect(back).toEqual(missingRecord);
    expect(validateExperimentLineageRecord(back).valid).toBe(false);
  });

  it("deserialize 指纹复核：篡改内容 → 响亮抛错", () => {
    const record = createExperimentLineageRecord(makeLineageInput());
    const parsed: Record<string, unknown> = JSON.parse(serializeExperimentLineageRecord(record));
    (parsed.parameterSet as Record<string, unknown>).maxSignals = 99;
    expect(() => deserializeExperimentLineageRecord(JSON.stringify(parsed))).toThrow(/指纹不匹配/);
  });

  it("NaN 拒绝：fingerprint 守卫遇到非有限数 → 响亮抛错", () => {
    const poisoned = { ...makeLineageInput(), dateRange: { startDate: NaN, endDate: NaN } } as unknown as ExperimentLineageRecordInput;
    expect(() => computeExperimentLineageFingerprint(poisoned)).toThrow(/非有限数字/);
  });
});

// ---------------------------------------------------------------------------
// (e) outcome 挂载
// ---------------------------------------------------------------------------

describe("outcome 挂载（metrics/result）", () => {
  it("succeeded Run → 挂载成功，metrics===result.performance，齐备校验通过", () => {
    const base = createExperimentLineageRecord(makeLineageInput());
    const run = makeRunResult(base.experimentId, "RUN-EXP-20260906-LINEAGE01-RUN0001");
    const withOutcome = mountRunOutcome(base, run);

    expect(withOutcome).not.toBe(base);
    expect(base.outcome).toBeNull();
    expect(withOutcome.outcome).not.toBeNull();
    expect(withOutcome.outcome?.runId).toBe("RUN-EXP-20260906-LINEAGE01-RUN0001");
    expect(withOutcome.outcome?.status).toBe("succeeded");
    expect(withOutcome.outcome?.metrics).toEqual(PERFORMANCE);
    expect(withOutcome.outcome?.recordedAt).toBe("2026-09-06T01:01:00.000Z");
    expect(validateExperimentLineageRecord(withOutcome).valid).toBe(true);
    expect(withOutcome.fingerprint).not.toBe(base.fingerprint);
  });

  it("挂载非本实验 Run → 抛错", () => {
    const base = createExperimentLineageRecord(makeLineageInput());
    const run = makeRunResult("EXP-20260906-OTHER001", "RUN-EXP-20260906-OTHER001-RUN0001");
    expect(() => mountRunOutcome(base, run)).toThrow(/不一致/);
  });

  it("挂载非 succeeded / result 为 null 的 Run → 抛错", () => {
    const base = createExperimentLineageRecord(makeLineageInput());
    const failed = makeRunResult(base.experimentId, "RUN-EXP-20260906-LINEAGE01-RUN0002");
    expect(() => mountRunOutcome(base, { ...failed, status: "failed", result: null })).toThrow(/succeeded/);

    const noResult = makeRunResult(base.experimentId, "RUN-EXP-20260906-LINEAGE01-RUN0003");
    expect(() => mountRunOutcome(base, { ...noResult, result: null })).toThrow(/result 为 null/);
  });

  it("双重挂载 → 抛错（禁止覆盖）", () => {
    const base = createExperimentLineageRecord(makeLineageInput());
    const run = makeRunResult(base.experimentId, "RUN-EXP-20260906-LINEAGE01-RUN0001");
    const withOutcome = mountRunOutcome(base, run);
    expect(() => mountRunOutcome(withOutcome, run)).toThrow(/禁止覆盖/);
  });

  it("outcome 挂载后指纹仍确定性（同输入同指纹）", () => {
    const base = createExperimentLineageRecord(makeLineageInput());
    const run = makeRunResult(base.experimentId, "RUN-EXP-20260906-LINEAGE01-RUN0001");
    const a = mountRunOutcome(base, run);
    const b = mountRunOutcome(createExperimentLineageRecord(makeLineageInput()), run);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// (f) ExperimentRegistry 只读桥
// ---------------------------------------------------------------------------

describe("ExperimentRegistry 桥", () => {
  it("register 既有实验 → bridge 映射 / 列出 / 齐备性校验；未知 id 响亮抛错", () => {
    const registry = new ExperimentRegistry();
    const experiment = makeFullExperiment();
    registry.register(experiment);

    const bridge = new ExperimentLineageBridge(registry);
    expect(bridge.has(experiment.experimentId)).toBe(true);

    const record = bridge.getLineage(experiment.experimentId, makeFullContext());
    expect(validateExperimentLineageRecord(record).valid).toBe(true);

    const list = bridge.listLineages(makeFullContext());
    expect(list).toHaveLength(1);
    expect(list[0]!.experimentId).toBe(experiment.experimentId);

    const check = bridge.validateLineage(experiment.experimentId, makeFullContext());
    expect(check.valid).toBe(true);

    expect(() => bridge.getLineage("EXP-20260906-NOTFOUND01", makeFullContext())).toThrow(/未注册/);
    expect(() => bridge.validateLineage("EXP-20260906-NOTFOUND01", makeFullContext())).toThrow(/未注册/);
  });

  it("bridge 不修改既有 registry：注册后 registry.get 内容与原实验一致（mutation isolation 不破坏）", () => {
    const registry = new ExperimentRegistry();
    const experiment = makeFullExperiment();
    registry.register(experiment);
    const bridge = new ExperimentLineageBridge(registry);
    bridge.getLineage(experiment.experimentId, makeFullContext());
    expect(registry.get(experiment.experimentId)).toEqual(experiment);
    expect(registry.list()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (g) registry 风格兼容 fixture（experimentPersistence.test.ts 同构）的映射回归
// ---------------------------------------------------------------------------

describe("兼容性：既有测试风格 fixture", () => {
  it("experimentPersistence.test.ts 同构输入可被校验器给出结构化结论", () => {
    // 与 experimentPersistence.test.ts makeInput 完全同构（service 会冻结 costModel；此处直接映射）。
    const input: ResearchExperiment = {
      experimentId: "EXP-20260906-TEST0001",
      strategyId: "leader-candidate-baseline",
      strategyVersion: "1.0.0",
      parameterSet: { minScore: null, maxSignals: 5, featureMode: "limit-up-confirm" },
      dataset: { startDate: "2026-01-06", endDate: "2026-01-08", universe: "limit-up" },
      backtestConfig: {
        initialCapital: 100_000,
        maxPositions: 5,
        commissionRate: 0.0003,
        slippageRate: 0.001,
        lotSize: 100,
        executionModel: "next-open",
      },
      createdAt: "2026-09-06T00:00:00.000Z",
      status: "created",
    };
    const record = experimentToLineageRecord(input, { codeVersion: "1.0.0+g2b786f7" });
    const validation = validateExperimentLineageRecord(record);
    // 缺 dataset_version / universe_version / cost_model / slippage_model（旧实验如实缺省，机器可见）。
    expect(validation.valid).toBe(false);
    const codes = validation.issues.map((issue) => issue.code);
    expect(codes).toContain("LINEAGE_DATASET_VERSION_UNRESOLVED");
    expect(codes).toContain("LINEAGE_UNIVERSE_VERSION_UNRESOLVED");
    expect(codes).toContain("LINEAGE_COST_MODEL_UNRESOLVED");
    expect(codes).toContain("LINEAGE_SLIPPAGE_MODEL_UNRESOLVED");

    // 注入实际消费事实后齐备可过。
    const enriched = experimentToLineageRecord(input, {
      codeVersion: "1.0.0+g2b786f7",
      datasetVersion: DATASET_VERSION,
      universeVersion: DATASET_VERSION,
      costModel: structuredClone(COST_MODEL),
    });
    expect(validateExperimentLineageRecord(enriched).valid).toBe(true);
  });
});
