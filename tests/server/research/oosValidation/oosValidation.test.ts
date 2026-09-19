/**
 * OOS-001 §16 — 安全边界单测（T1~T7）。
 *
 * | 组 | 规格 | 本文件覆盖的判据 |
 * |---|---|---|
 * | T1 | 参数冻结 | `freezeCandidate` 五条判定 + `assertFrozenParameterSetUnchanged` |
 * | T2 | 参数不可重新搜索 | 契约入参**没有参数值位置**（`parameterHash` 是唯一指定方式） |
 * | T3 | OOS 不修改 Search Result | 本域只写 `oos_validation_*` 两表（写点白名单由静态守卫钉死） |
 * | T4 | 时间窗口隔离 | `assertOosWindowIsolated` 五条判定 + 边界（相等也算重叠） |
 * | T5 | canonical Metrics | `assertIsMetricsCanonical` + `OOS_METRICS_VERSION` 由常量拼出 |
 * | T6 | 确定性 | ID / 指纹（时间戳不参与）/ 对照可复现 |
 * | T7 | 结果串线 | Gate 的 `OOS_SOURCE_MISMATCH` + 冻结的跨 Run 拒绝 |
 *
 * 🔴 本文件**不触 DB、不触 Backtest**：它证明「纯域层在给定输入下的行为」。
 *   「经 tRPC + Drizzle + 真实回测往返后仍对」由 `docs/evidence/_e2e_oos_validation.mts` 证明
 *   （两者是**互补关系**，缺一不可 —— 单测抓不到真实往返，E2E 抓不到负例矩阵）。
 */

import { describe, expect, it } from "vitest";
import { BACKTEST_ANNUALIZATION_DAYS } from "../../../../server/backtest/backtestResult";
import { ResearchValidationError } from "../../../../server/research/experimentValidation";
import {
  computeParameterHash,
} from "../../../../server/research/parameterSearch/parameterHash";
import { canTransitionSearchRun } from "../../../../server/research/parameterSearch/searchRun";
import type {
  ParameterSearchCombinationRow,
  ParameterSearchResultRow,
} from "../../../../server/research/parameterSearch/persistence";
import type { ResearchParameterSet } from "../../../../server/research/types";
import { createOosValidationInputSchema } from "../../../../shared/oosValidationContracts";
import { buildOosComparison } from "../../../../server/research/oosValidation/comparison";
import {
  definitionFingerprintOfDocument,
  verifyDefinitionFingerprint,
} from "../../../../server/research/oosValidation/definitionFingerprint";
import {
  assertFrozenParameterSetUnchanged,
  canonicalParameterKey,
  freezeCandidate,
} from "../../../../server/research/oosValidation/freeze";
import { assertIsMetricsCanonical, assertOosSourceGate } from "../../../../server/research/oosValidation/gate";
import {
  assertOosRunCanExecute,
  assertOosRunTransition,
  canTransitionOosRun,
  computeOosResultFingerprint,
  computeOosRunFingerprint,
  generateOosValidationRunId,
  isOosRunStatus,
  parseOosRunStatus,
} from "../../../../server/research/oosValidation/run";
import { OOS_METRICS_VERSION } from "../../../../server/research/oosValidation/types";
import {
  assertOosWindowIsolated,
  assertWindowWellFormed,
  oosCalendarDaysBetween,
} from "../../../../server/research/oosValidation/window";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const RUN_ID = "PSRUN-20250101-deadbeef";
const OTHER_RUN_ID = "PSRUN-20250102-feedface";
const STRATEGY_ID = "oos1-spec-strategy";
const STRATEGY_VERSION = "1.0.0";

const BASE_PARAMS: ResearchParameterSet = { maxVolumeRatio: 0.3, maxDrawdown: 0.02 };
const OTHER_PARAMS: ResearchParameterSet = { maxVolumeRatio: 1.0, maxDrawdown: 0.02 };

function hashOf(parameters: ResearchParameterSet): string {
  return computeParameterHash({ strategyId: STRATEGY_ID, strategyVersion: STRATEGY_VERSION, parameters });
}

function combinationRow(
  parameters: ResearchParameterSet,
  overrides: Partial<ParameterSearchCombinationRow> = {},
): ParameterSearchCombinationRow {
  return {
    id: 1,
    searchRunId: RUN_ID,
    combinationIndex: 0,
    parameterHash: hashOf(parameters),
    parametersJson: JSON.stringify(parameters),
    status: "SUCCEEDED",
    attemptCount: 1,
    lastError: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function resultRow(
  parameters: ResearchParameterSet,
  overrides: Partial<ParameterSearchResultRow> = {},
): ParameterSearchResultRow {
  return {
    id: 1,
    searchRunId: RUN_ID,
    combinationIndex: 0,
    parameterHash: hashOf(parameters),
    parametersJson: JSON.stringify(parameters),
    status: "SUCCEEDED",
    error: null,
    totalReturnPct: 12.5,
    annualizedReturnPct: 30.1,
    maxDrawdownPct: 8.2,
    tradeCount: 17,
    winRatePct: 52.9,
    profitFactor: 1.4,
    metricsSource: "canonical",
    annualizationBasisJson: JSON.stringify({ type: "TRADING_DAYS", daysPerYear: BACKTEST_ANNUALIZATION_DAYS }),
    backtestFingerprint: "b".repeat(64),
    backtestRunId: null,
    evaluationId: "exp-spec-1",
    evaluationRunId: "closed-loop::exp-spec-1",
    evaluationJson: null,
    reproductionJson: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** 跑一个必然抛错的断言，取回领域码（**不抛错也要如实报**，避免假绿）。 */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ResearchValidationError) return error.issues[0]?.code ?? "（无 code）";
    throw error;
  }
  return "（未抛错）";
}

const SEARCH_WINDOW = { startDate: "2025-01-02", endDate: "2025-02-28" };
const OOS_WINDOW = { startDate: "2025-03-01", endDate: "2025-04-30" };
const DATASET_WINDOW = { startDate: "2024-09-01", endDate: "2026-09-01" };

// ---------------------------------------------------------------------------
// T1 — 参数冻结（§5）
// ---------------------------------------------------------------------------

describe("T1 参数冻结（§5）：冻结必须可复核，不足即响亮失败", () => {
  const parameters = BASE_PARAMS;

  it("正常路径：冻结出源 Run 的组合身份 + 快照取值 + 有成功结果标记", () => {
    const frozen = freezeCandidate({
      searchRunId: RUN_ID,
      strategyId: STRATEGY_ID,
      strategyVersion: STRATEGY_VERSION,
      parameterHash: hashOf(parameters),
      combinations: [combinationRow(parameters, { combinationIndex: 3 })],
      results: [resultRow(parameters)],
    });
    expect(frozen.sourceSearchRunId).toBe(RUN_ID);
    expect(frozen.combinationIndex).toBe(3);
    expect(frozen.parameterHash).toBe(hashOf(parameters));
    expect(frozen.parameters).toEqual(parameters);
    expect(frozen.hasSucceededResult).toBe(true);
  });

  it("组合不存在 ⇒ OOS_SOURCE_COMBINATION_NOT_FOUND（不回读当前策略版本补全）", () => {
    expect(
      codeOf(() =>
        freezeCandidate({
          searchRunId: RUN_ID,
          strategyId: STRATEGY_ID,
          strategyVersion: STRATEGY_VERSION,
          parameterHash: hashOf(OTHER_PARAMS),
          combinations: [combinationRow(parameters)],
          results: [resultRow(parameters)],
        }),
      ),
    ).toBe("OOS_SOURCE_COMBINATION_NOT_FOUND");
  });

  it("组合行属于另一个 Run ⇒ OOS_SOURCE_COMBINATION_NOT_FOUND（T7 防串线）", () => {
    expect(
      codeOf(() =>
        freezeCandidate({
          searchRunId: RUN_ID,
          strategyId: STRATEGY_ID,
          strategyVersion: STRATEGY_VERSION,
          parameterHash: hashOf(parameters),
          combinations: [combinationRow(parameters, { searchRunId: OTHER_RUN_ID })],
          results: [resultRow(parameters)],
        }),
      ),
    ).toBe("OOS_SOURCE_COMBINATION_NOT_FOUND");
  });

  it("落库行被篡改（参数改了、hash 没改）⇒ OOS_PARAMETER_FREEZE_HASH_MISMATCH", () => {
    const tampered = combinationRow(parameters);
    // 只改值不改身份 —— 这正是「行被外部改写」的样子。
    tampered.parametersJson = JSON.stringify({ maxVolumeRatio: 0.99, maxDrawdown: 0.02 });
    expect(
      codeOf(() =>
        freezeCandidate({
          searchRunId: RUN_ID,
          strategyId: STRATEGY_ID,
          strategyVersion: STRATEGY_VERSION,
          parameterHash: tampered.parameterHash,
          combinations: [tampered],
          results: [resultRow(parameters)],
        }),
      ),
    ).toBe("OOS_PARAMETER_FREEZE_HASH_MISMATCH");
  });

  it("没有成功结果 ⇒ OOS_SOURCE_RESULT_MISSING（没有 IS 基线就没有对照）", () => {
    for (const status of ["FAILED", "PENDING", "RUNNING", "SKIPPED"] as const) {
      expect(
        codeOf(() =>
          freezeCandidate({
            searchRunId: RUN_ID,
            strategyId: STRATEGY_ID,
            strategyVersion: STRATEGY_VERSION,
            parameterHash: hashOf(parameters),
            combinations: [combinationRow(parameters)],
            results: [resultRow(parameters, { status })],
          }),
        ),
      ).toBe("OOS_SOURCE_RESULT_MISSING");
    }
  });

  it("根本没有结果行 ⇒ OOS_SOURCE_RESULT_MISSING", () => {
    expect(
      codeOf(() =>
        freezeCandidate({
          searchRunId: RUN_ID,
          strategyId: STRATEGY_ID,
          strategyVersion: STRATEGY_VERSION,
          parameterHash: hashOf(parameters),
          combinations: [combinationRow(parameters)],
          results: [],
        }),
      ),
    ).toBe("OOS_SOURCE_RESULT_MISSING");
  });

  it("parametersJson 不是 JSON object ⇒ OOS_FROZEN_PARAMETER_SET_MISSING", () => {
    for (const bad of ["[1,2]", "\"text\"", "null"]) {
      expect(
        codeOf(() =>
          freezeCandidate({
            searchRunId: RUN_ID,
            strategyId: STRATEGY_ID,
            strategyVersion: STRATEGY_VERSION,
            parameterHash: hashOf(parameters),
            combinations: [combinationRow(parameters, { parametersJson: bad })],
            results: [resultRow(parameters)],
          }),
        ),
      ).toBe("OOS_FROZEN_PARAMETER_SET_MISSING");
    }
  });

  it("执行时复核：落库快照 == 组合行取值 ⇒ 通过", () => {
    expect(() =>
      assertFrozenParameterSetUnchanged({
        frozenFromRunRow: { maxVolumeRatio: 0.3, maxDrawdown: 0.02 },
        frozenFromCombinationRow: { maxDrawdown: 0.02, maxVolumeRatio: 0.3 },
      }),
    ).not.toThrow();
  });

  it("执行时复核：被并发改写 ⇒ OOS_FROZEN_PARAMETER_SET_CHANGED", () => {
    expect(
      codeOf(() =>
        assertFrozenParameterSetUnchanged({
          frozenFromRunRow: { maxVolumeRatio: 0.3 },
          frozenFromCombinationRow: { maxVolumeRatio: 0.31 },
        }),
      ),
    ).toBe("OOS_FROZEN_PARAMETER_SET_CHANGED");
  });

  it("canonicalParameterKey：与键序无关，且能区分 0 / null / \"0\"", () => {
    expect(canonicalParameterKey({ a: 1, b: 2 })).toBe(canonicalParameterKey({ b: 2, a: 1 }));
    expect(canonicalParameterKey({ a: 0 })).not.toBe(canonicalParameterKey({ a: null }));
    expect(canonicalParameterKey({ a: 0 })).not.toBe(canonicalParameterKey({ a: "0" }));
  });
});

// ---------------------------------------------------------------------------
// T2 — 参数不可重新搜索（接口层事实）
// ---------------------------------------------------------------------------

describe("T2 参数不可重新搜索（§5）：接口层没有参数值位置", () => {
  it("入参恰好 4 个键，且**不含** parameters / parameterSet / resolvedParameterSet", () => {
    const keys = Object.keys(createOosValidationInputSchema.shape).sort();
    expect(keys).toEqual(["metricsVersion", "oosWindow", "parameterHash", "sourceSearchRunId"]);
  });

  it("调用方「顺手传一组更好的参数」会被**剥离**（结构上无法到达领域层）", () => {
    const parsed = createOosValidationInputSchema.parse({
      sourceSearchRunId: RUN_ID,
      parameterHash: hashOf(BASE_PARAMS),
      oosWindow: OOS_WINDOW,
      // 恶意 / 误传：希望 OOS 用一组更好的参数
      parameters: { maxVolumeRatio: 0.99 },
      resolvedParameterSet: { maxVolumeRatio: 0.99 },
      parameterSet: { maxVolumeRatio: 0.99 },
    });
    expect("parameters" in parsed).toBe(false);
    expect("parameterSet" in parsed).toBe(false);
    expect("resolvedParameterSet" in parsed).toBe(false);
    // 只剩「源 Run + 候选身份 + 窗口」这三件事实。
    expect(Object.keys(parsed).sort()).toEqual(["oosWindow", "parameterHash", "sourceSearchRunId"]);
  });
});

// ---------------------------------------------------------------------------
// T4 — 时间窗口隔离（§6）
// ---------------------------------------------------------------------------

describe("T4 时间窗口隔离（§6）：默认禁止重叠", () => {
  it("正常路径：oosStart > searchEnd 且落在数据集内 ⇒ 通过并给出间隔天数", () => {
    const report = assertOosWindowIsolated({
      searchWindow: SEARCH_WINDOW,
      oosWindow: OOS_WINDOW,
      datasetWindow: DATASET_WINDOW,
    });
    expect(report.gapDays).toBe(1);
    expect(report.note).toContain("窗口隔离通过");
    expect(report.note).toContain("落在数据集可用窗口");
  });

  it("重叠（oosStart < searchEnd）⇒ OOS_WINDOW_OVERLAP", () => {
    expect(
      codeOf(() =>
        assertOosWindowIsolated({
          searchWindow: SEARCH_WINDOW,
          oosWindow: { startDate: "2025-02-01", endDate: "2025-03-31" },
          datasetWindow: DATASET_WINDOW,
        }),
      ),
    ).toBe("OOS_WINDOW_OVERLAP");
  });

  it("**正好相等**（oosStart == searchEnd）也算重叠 ⇒ OOS_WINDOW_OVERLAP（边界不许「差一点就放过」）", () => {
    expect(
      codeOf(() =>
        assertOosWindowIsolated({
          searchWindow: SEARCH_WINDOW,
          oosWindow: { startDate: "2025-02-28", endDate: "2025-03-31" },
          datasetWindow: DATASET_WINDOW,
        }),
      ),
    ).toBe("OOS_WINDOW_OVERLAP");
  });

  it("起止倒挂（oosStart > oosEnd）⇒ OOS_WINDOW_INVALID", () => {
    expect(
      codeOf(() =>
        assertOosWindowIsolated({
          searchWindow: SEARCH_WINDOW,
          oosWindow: { startDate: "2025-05-01", endDate: "2025-03-01" },
          datasetWindow: DATASET_WINDOW,
        }),
      ),
    ).toBe("OOS_WINDOW_INVALID");
  });

  it("形态非法 / 不存在的日历日 ⇒ OOS_WINDOW_INVALID", () => {
    for (const bad of ["2025/03/01", "2025-3-1", "20250301", "", "2025-02-30", "2025-13-01"]) {
      expect(
        codeOf(() => assertWindowWellFormed({ startDate: bad, endDate: "2025-04-30" }, "oosWindow")),
      ).toBe("OOS_WINDOW_INVALID");
    }
  });

  it("源窗口自身倒挂 ⇒ OOS_SEARCH_WINDOW_INVALID（问题在上游数据，不是调用方给的窗口）", () => {
    expect(
      codeOf(() =>
        assertOosWindowIsolated({
          searchWindow: { startDate: "2025-03-01", endDate: "2025-01-01" },
          oosWindow: OOS_WINDOW,
          datasetWindow: DATASET_WINDOW,
        }),
      ),
    ).toBe("OOS_SEARCH_WINDOW_INVALID");
  });

  it("OOS 越出数据集**上界** ⇒ OOS_WINDOW_OUT_OF_DATASET_RANGE", () => {
    expect(
      codeOf(() =>
        assertOosWindowIsolated({
          searchWindow: SEARCH_WINDOW,
          oosWindow: { startDate: "2026-08-01", endDate: "2026-10-31" }, // 晚于数据集止 2026-09-01
          datasetWindow: DATASET_WINDOW,
        }),
      ),
    ).toBe("OOS_WINDOW_OUT_OF_DATASET_RANGE");
  });

  it("越出数据集**下界**的情形在语义上不可达（源窗口本身就在数据集内）", () => {
    // 🔴 这不是漏测，而是一条**结构推论**：判定顺序要求 oosStart > searchEnd，
    //   而 searchEnd ≥ datasetStart（源 Search 窗口必须落在数据集内，否则它自己也建不起来）
    //   ⇒ oosStart > datasetStart 恒成立 ⇒ 「早于数据集起」不可能同时满足隔离要求。
    //   因此这一支只能由「数据集窗口被人为收窄」的上界侧触发（上一条测试覆盖）。
    //   这里把推论本身断言下来，防止有人误以为漏了一条分支。
    assertOosWindowIsolated({ searchWindow: SEARCH_WINDOW, oosWindow: OOS_WINDOW, datasetWindow: DATASET_WINDOW });
    expect(SEARCH_WINDOW.endDate > DATASET_WINDOW.startDate).toBe(true);
    expect(OOS_WINDOW.startDate > SEARCH_WINDOW.endDate).toBe(true);
    expect(OOS_WINDOW.startDate > DATASET_WINDOW.startDate).toBe(true);
  });

  it("datasetWindow = null ⇒ 跳过该层校验且 note 如实说明「缺少这层保护」（不假装查过）", () => {
    const report = assertOosWindowIsolated({
      searchWindow: SEARCH_WINDOW,
      oosWindow: OOS_WINDOW,
      datasetWindow: null,
    });
    expect(report.note).toContain("未校验数据集可用窗口");
  });

  it("oosCalendarDaysBetween：正/负/零都对", () => {
    expect(oosCalendarDaysBetween("2025-02-28", "2025-03-01")).toBe(1);
    expect(oosCalendarDaysBetween("2025-03-01", "2025-02-28")).toBe(-1);
    expect(oosCalendarDaysBetween("2025-03-01", "2025-03-01")).toBe(0);
    expect(oosCalendarDaysBetween("2025-01-01", "2025-12-31")).toBe(364);
  });
});

// ---------------------------------------------------------------------------
// T5 — canonical Metrics（§9 / §10）
// ---------------------------------------------------------------------------

describe("T5 canonical Metrics（§9）：口径不可比就拒绝建立对照", () => {
  it("canonical ⇒ 通过", () => {
    expect(() =>
      assertIsMetricsCanonical({ searchRunId: RUN_ID, parameterHash: "h", metricsSource: "canonical" }),
    ).not.toThrow();
  });

  it("evaluators ⇒ OOS_SOURCE_METRICS_NOT_CANONICAL（不「如实标注后继续」）", () => {
    expect(
      codeOf(() => assertIsMetricsCanonical({ searchRunId: RUN_ID, parameterHash: "h", metricsSource: "evaluators" })),
    ).toBe("OOS_SOURCE_METRICS_NOT_CANONICAL");
  });

  it("OOS_METRICS_VERSION 由年化常量**拼出**（不写死 252，口径变更会自动跟着变）", () => {
    expect(OOS_METRICS_VERSION).toBe(`canonicalMetrics@${String(BACKTEST_ANNUALIZATION_DAYS)}d`);
    expect(OOS_METRICS_VERSION).toContain(String(BACKTEST_ANNUALIZATION_DAYS));
  });
});

// ---------------------------------------------------------------------------
// T6 — 确定性
// ---------------------------------------------------------------------------

describe("T6 确定性（§16 T6）：同输入 ⇒ 同产物", () => {
  it("Run ID 形态 OOSV-YYYYMMDD-xxxxxxxx；同 now + 同 suffix ⇒ 同 ID", () => {
    const now = new Date("2025-03-01T12:34:56.000Z");
    expect(generateOosValidationRunId(now, "ABCD1234")).toBe("OOSV-20250301-abcd1234");
    expect(generateOosValidationRunId(now, "ABCD1234")).toBe(generateOosValidationRunId(now, "ABCD1234"));
    expect(generateOosValidationRunId(now)).toMatch(/^OOSV-\d{8}-[0-9a-f]{8}$/);
  });

  it("差异只在时间戳 / 指纹列 ⇒ 指纹**不变**（时间戳不参与内容指纹）", () => {
    const base = { oosRunId: "OOSV-x", status: "CREATED", runFingerprint: "x".repeat(64), a: 1 };
    expect(computeOosRunFingerprint(base)).toBe(
      computeOosRunFingerprint({
        ...base,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-09-19T00:00:00.000Z",
        startedAt: "2025-05-05T00:00:00.000Z",
        completedAt: null,
      }),
    );
  });

  it("业务字段变一个 ⇒ 指纹变", () => {
    const base = { oosRunId: "OOSV-x", a: 1 };
    expect(computeOosRunFingerprint(base)).not.toBe(computeOosRunFingerprint({ oosRunId: "OOSV-x", a: 2 }));
    expect(computeOosRunFingerprint(base)).not.toBe(computeOosRunFingerprint({ oosRunId: "OOSV-y", a: 1 }));
  });

  it("键序不影响指纹（canonical 序列化）", () => {
    expect(computeOosResultFingerprint({ a: 1, b: 2 })).toBe(computeOosResultFingerprint({ b: 2, a: 1 }));
  });

  it("对照：同输入 ⇒ 深度相等（可复现）", () => {
    const is = { totalReturnPct: 10, annualizedReturnPct: 20, maxDrawdownPct: 5, tradeCount: 10, winRatePct: 50, profitFactor: 1.5 };
    const oos = { totalReturnPct: 4, annualizedReturnPct: 8, maxDrawdownPct: 9, tradeCount: 6, winRatePct: 40, profitFactor: 1.1 };
    const a = buildOosComparison({ is, oos, isAvailable: true });
    const b = buildOosComparison({ is, oos, isAvailable: true });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// T7 — 结果串线
// ---------------------------------------------------------------------------

describe("T7 结果串线（§16 T7）：跨 Run 的行不得被当作同一实验", () => {
  const goodGate = {
    searchRunId: RUN_ID,
    sourceStatus: "COMPLETED",
    combinationCount: 2,
    resultCount: 2,
    observedSearchRunIds: [RUN_ID],
  };

  it("合格输入 ⇒ Gate 通过", () => {
    expect(() => assertOosSourceGate(goodGate)).not.toThrow();
  });

  it("行里出现别的 searchRunId ⇒ OOS_SOURCE_MISMATCH", () => {
    expect(
      codeOf(() => assertOosSourceGate({ ...goodGate, observedSearchRunIds: [RUN_ID, OTHER_RUN_ID] })),
    ).toBe("OOS_SOURCE_MISMATCH");
  });

  it("状态不是 COMPLETED / 状态列非法 ⇒ OOS_SOURCE_RUN_NOT_COMPLETED", () => {
    for (const status of ["CREATED", "RUNNING", "FAILED", "CANCELLED", "WEIRD", null, 42]) {
      expect(codeOf(() => assertOosSourceGate({ ...goodGate, sourceStatus: status }))).toBe(
        "OOS_SOURCE_RUN_NOT_COMPLETED",
      );
    }
  });

  it("无组合 / 无结果 ⇒ OOS_SOURCE_NO_COMBINATIONS / OOS_SOURCE_NO_RESULTS", () => {
    expect(codeOf(() => assertOosSourceGate({ ...goodGate, combinationCount: 0 }))).toBe(
      "OOS_SOURCE_NO_COMBINATIONS",
    );
    expect(codeOf(() => assertOosSourceGate({ ...goodGate, resultCount: 0 }))).toBe("OOS_SOURCE_NO_RESULTS");
  });
});

// ---------------------------------------------------------------------------
// §12 — 状态机（复用 PS 权威迁移表 + 本域额外收紧 COMPLETED）
// ---------------------------------------------------------------------------

describe("§12 OOS Run 状态机", () => {
  it("与 Parameter Search 共用同一张迁移表（逐格比对，防两处漂移）", () => {
    const all = ["CREATED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const;
    for (const from of all) {
      for (const to of all) {
        expect(canTransitionOosRun(from, to)).toBe(canTransitionSearchRun(from, to));
      }
    }
  });

  it("CREATED / FAILED / CANCELLED 允许执行；RUNNING / COMPLETED 拒绝", () => {
    for (const status of ["CREATED", "FAILED", "CANCELLED"] as const) {
      expect(() => assertOosRunCanExecute(status)).not.toThrow();
    }
    expect(codeOf(() => assertOosRunCanExecute("RUNNING"))).toBe("OOS_RUN_ALREADY_RUNNING");
    expect(codeOf(() => assertOosRunCanExecute("COMPLETED"))).toBe("OOS_RUN_ALREADY_COMPLETED");
  });

  it("🔴 迁移表**允许** COMPLETED → RUNNING，但本域的执行准入**禁止**它（更严调用，不是第二张表）", () => {
    expect(canTransitionSearchRun("COMPLETED", "RUNNING")).toBe(true);
    expect(canTransitionOosRun("COMPLETED", "RUNNING")).toBe(true);
    expect(codeOf(() => assertOosRunCanExecute("COMPLETED"))).toBe("OOS_RUN_ALREADY_COMPLETED");
  });

  it("非法迁移 ⇒ OOS_STATUS_TRANSITION_INVALID", () => {
    expect(codeOf(() => assertOosRunTransition("COMPLETED", "CREATED"))).toBe("OOS_STATUS_TRANSITION_INVALID");
  });

  it("同态重放视为幂等", () => {
    for (const status of ["CREATED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const) {
      expect(canTransitionOosRun(status, status)).toBe(true);
      expect(() => assertOosRunTransition(status, status)).not.toThrow();
    }
  });

  it("状态解析不静默回落（非法值 ⇒ OOS_STATUS_UNKNOWN）", () => {
    expect(isOosRunStatus("COMPLETED")).toBe(true);
    expect(isOosRunStatus("completed")).toBe(false);
    expect(codeOf(() => parseOosRunStatus("COMPLETED"))).toBe("（未抛错）");
    expect(codeOf(() => parseOosRunStatus("Completed"))).toBe("OOS_STATUS_UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// §10 — IS / OOS 对照
// ---------------------------------------------------------------------------

describe("§10 IS / OOS 对照：只给事实与比较，不给结论", () => {
  const is = {
    totalReturnPct: 10,
    annualizedReturnPct: 20,
    maxDrawdownPct: -5, // 契约里回撤是**正数幅度**口径；此处刻意用正数更贴近真实
    tradeCount: 10,
    winRatePct: 50,
    profitFactor: 2,
  };
  const oos = {
    totalReturnPct: 4,
    annualizedReturnPct: 8,
    maxDrawdownPct: 9,
    tradeCount: 6,
    winRatePct: 40,
    profitFactor: 1.1,
  };

  it("六项 delta / ratio 逐项正确", () => {
    const c = buildOosComparison({ is: { ...is, maxDrawdownPct: 5 }, oos, isAvailable: true });
    expect(c.totalReturnPctDelta).toBe(-6);
    expect(c.totalReturnPctRatio).toBeCloseTo(0.4, 10);
    expect(c.annualizedReturnPctDelta).toBe(-12);
    expect(c.maxDrawdownPctDelta).toBe(4);
    expect(c.tradeCountDelta).toBe(-4);
    expect(c.winRatePctDelta).toBe(-10);
    expect(c.profitFactorDelta).toBeCloseTo(-0.9, 10);
    expect(c.comparableCount).toBe(6);
    expect(c.comparable).toBe(true);
  });

  it("🔴 方向刻进字段名：degradation = IS − OOS（正数=样本外下降）；drawdownChange = OOS − IS（正数=加深）", () => {
    const c = buildOosComparison({ is: { ...is, maxDrawdownPct: 5 }, oos, isAvailable: true });
    expect(c.totalReturnDegradationPct).toBe(6); // 10 − 4 ⇒ 下降 6 个点
    expect(c.drawdownChangePct).toBe(4); // 9 − 5 ⇒ 回撤加深 4 个点
    expect(c.tradeCountChange).toBe(-4);
    // 与 delta 恰为相反数，刻意都提供（同表混用一种符号必然读错一次）
    expect(c.totalReturnDegradationPct).toBe(-(c.totalReturnPctDelta ?? 0));
    expect(c.maxDrawdownPctDelta).toBe(c.drawdownChangePct);
  });

  it("IS = 0 ⇒ ratio 为 null（**不做除零**），delta 照常，且仍计入 comparableCount", () => {
    const c = buildOosComparison({
      is: { ...is, totalReturnPct: 0 },
      oos,
      isAvailable: true,
    });
    expect(c.totalReturnPctRatio).toBeNull();
    expect(c.totalReturnPctDelta).toBe(4);
    // 🔴 `comparableCount` 是**事实计数**（两侧都有值 ⇒ 计入），与「ratio 能不能算」无关。
    expect(c.comparableCount).toBe(6);
  });

  it("任一侧 null ⇒ 该项 delta / ratio 均为 null，且计入缺项说明", () => {
    const c = buildOosComparison({ is, oos: { ...oos, profitFactor: null }, isAvailable: true });
    expect(c.profitFactorDelta).toBeNull();
    expect(c.profitFactorRatio).toBeNull();
    expect(c.comparableCount).toBe(5);
    expect(c.notes.join(" ")).toContain("profitFactor");
  });

  it("全部不可用 ⇒ comparable = false，且**不编造 0**", () => {
    const allNull = {
      totalReturnPct: null,
      annualizedReturnPct: null,
      maxDrawdownPct: null,
      tradeCount: null,
      winRatePct: null,
      profitFactor: null,
    };
    const c = buildOosComparison({ is: allNull, oos: allNull, isAvailable: false });
    expect(c.comparable).toBe(false);
    expect(c.comparableCount).toBe(0);
    expect(c.totalReturnPctDelta).toBeNull();
    expect(c.totalReturnDegradationPct).toBeNull();
    expect(c.drawdownChangePct).toBeNull();
    expect(c.tradeCountChange).toBeNull();
  });

  it("IS 源不可用 ⇒ comparable = false（语义结论），但 comparableCount 照实报（事实计数）", () => {
    const c = buildOosComparison({ is, oos, isAvailable: false });
    expect(c.comparable).toBe(false);
    expect(c.notes.join(" ")).toContain("对照不成立");
    // 🔴 两个字段各司其职、**不允许互相打脸**：
    //   `comparableCount` = 有几对指标两侧都有值（事实）；`comparable` = 这次对照成立吗（结论）。
    expect(c.comparableCount).toBe(6);
  });

  it("样本外笔数更少 ⇒ 如实记录且**明确不做好坏判定**", () => {
    const c = buildOosComparison({ is, oos, isAvailable: true });
    expect(c.tradeCountChange).toBe(-4);
    expect(c.notes.join(" ")).toContain("不对其做「好 / 坏」判定");
  });
});

// ---------------------------------------------------------------------------
// §8 — 策略定义指纹
// ---------------------------------------------------------------------------

describe("§8 策略定义指纹：构造不出就如实说「没冻结」，绝不编一个", () => {
  it("legacy 文档（无 canonical 定义）⇒ fingerprint = null 且 note 说明原因", () => {
    const legacy = {
      strategyId: "legacy-x",
      version: "1.0.0",
      name: "legacy",
      universe: "limit-up",
      // 刻意不给 definition ⇒ Core 构造不出
    } as never;
    const result = definitionFingerprintOfDocument(legacy);
    expect(result.fingerprint).toBeNull();
    expect(result.note).toContain("未冻结策略定义指纹");
  });

  it("frozen = null ⇒ 执行时不复核，且**如实登记**（不假装复核过）", () => {
    const verified = verifyDefinitionFingerprint({ frozen: null, current: "abc" });
    expect(verified.ok).toBe(true);
    expect(verified.note).toContain("不做");
  });

  it("current = null ⇒ 无法复核，如实登记", () => {
    const verified = verifyDefinitionFingerprint({ frozen: "abc", current: null });
    expect(verified.ok).toBe(true);
    expect(verified.note).toContain("无法复核");
  });

  it("指纹一致 ⇒ ok；漂移 ⇒ ok = false（这就是 OOS_STRATEGY_DEFINITION_DRIFT 的判据）", () => {
    expect(verifyDefinitionFingerprint({ frozen: "abc", current: "abc" }).ok).toBe(true);
    const drift = verifyDefinitionFingerprint({ frozen: "abc", current: "def" });
    expect(drift.ok).toBe(false);
    expect(drift.note).toContain("漂移");
  });
});
