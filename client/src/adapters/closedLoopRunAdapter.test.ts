/**
 * closedLoopRunAdapter 单测（纯函数，零 IO）。
 *
 * 锁定的三条纪律：
 *   1. **零计算**：评估标量只从 evaluationRef 直搬，缺字段一律 null（不推算、不填 0）；
 *   2. **防御性解析**：非对象 / 无 runId / 字段类型不符 → 降级为 null / 空数组 / UNKNOWN，
 *      绝不构造「看起来跑过」的结果；
 *   3. **标识符确定性**：deriveExperimentId 同配置 + 同日 → 同 id（形态符合 C-13.3）。
 */

import { describe, expect, it } from "vitest";
import {
  buildClosedLoopRunViewModel,
  closedLoopRunToRunResult,
  deriveExperimentId,
  emptyClosedLoopRun,
} from "./closedLoopRunAdapter";

const HEX = "a".repeat(64);

/** 与后端 loopRun 响应同构的最小真实形态。 */
function rawRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: "clrun-20260911000000000",
    createdAt: "2026-09-11T00:00:00.000Z",
    chainFingerprint: HEX,
    fingerprint: "f".repeat(64),
    overall: {
      status: "PARTIAL_BLOCKED",
      executedStageCount: 1,
      blockedStageCount: 13,
      skippedStageCount: 0,
      firstBlockedReasonCode: "CL_DATA_NOT_INJECTED",
      synthetic: false,
      note: "1 阶段执行，13 阶段阻塞",
    },
    runnerInjected: ["evaluation"],
    stages: [
      {
        stageId: "evaluation",
        state: "EXECUTED",
        outputKind: "evaluationRef",
        outputHandoffFingerprint: "b".repeat(64),
        output: {
          kind: "evaluationRef",
          backtestFingerprint: "c".repeat(64),
          performance: {
            fingerprint: "d".repeat(64),
            inputFingerprint: "e".repeat(64),
            totalReturnPct: 5.3,
            cagrPct: 21.2,
            maxDrawdownPct: -3.7,
          },
          riskAdjusted: {
            fingerprint: "1".repeat(64),
            sharpeRatio: 1.42,
            sortinoRatio: 2.01,
            calmarRatio: 0.88,
          },
          tradeQuality: {
            fingerprint: "2".repeat(64),
            winRatePct: 55.5,
            profitFactor: 1.8,
            completedTradeCount: 12,
          },
          evaluatorsCovered: [
            "performanceMetrics",
            "riskAdjustedMetrics",
            "tradeQualityMetrics",
          ],
        },
        blocked: null,
      },
      {
        stageId: "data",
        state: "BLOCKED",
        outputKind: "datasetSummary",
        outputHandoffFingerprint: null,
        output: null,
        blocked: {
          reasonCode: "CL_DATA_NOT_INJECTED",
          detail: "data 阶段未注入数据集",
          upstreamStageId: null,
          errorCode: null,
          errorMessage: null,
        },
      },
    ],
    blockedSummary: [],
    wiring: {
      requestedStages: ["data", "research"],
      wiredStages: ["data", "research", "strategy", "backtest", "evaluation", "finalize"],
      unwiredStages: ["optimization", "regime"],
      coveredStages: ["evaluation"],
      uncoveredStages: ["data", "research"],
      executorBound: false,
    },
    ...overrides,
  };
}

describe("closedLoopRunAdapter — 空态", () => {
  it("emptyClosedLoopRun 不携带任何「看起来跑过」的字段", () => {
    const vm = emptyClosedLoopRun();
    expect(vm.hasResult).toBe(false);
    expect(vm.runId).toBe("");
    expect(vm.status).toBe("NOT_RUN");
    expect(vm.stages).toEqual([]);
    expect(vm.evaluation).toBeNull();
    expect(vm.counts).toEqual({ executed: 0, blocked: 0, skipped: 0 });
    expect(vm.wiring.executorBound).toBe(false);
  });
});

describe("closedLoopRunAdapter — 防御性解析", () => {
  it("非对象 / 无 runId → null（保持空态，不臆造）", () => {
    expect(buildClosedLoopRunViewModel(null)).toBeNull();
    expect(buildClosedLoopRunViewModel("x")).toBeNull();
    expect(buildClosedLoopRunViewModel([])).toBeNull();
    expect(buildClosedLoopRunViewModel({})).toBeNull();
    expect(buildClosedLoopRunViewModel({ runId: "" })).toBeNull();
  });

  it("缺 wiring / overall → 全部降级为空，不抛错", () => {
    const vm = buildClosedLoopRunViewModel({ runId: "r1" })!;
    expect(vm.hasResult).toBe(true);
    expect(vm.status).toBe("UNKNOWN");
    expect(vm.counts).toEqual({ executed: 0, blocked: 0, skipped: 0 });
    expect(vm.wiring).toEqual({
      wiredStages: [],
      unwiredStages: [],
      coveredStages: [],
      executorBound: false,
    });
    expect(vm.stages).toEqual([]);
    expect(vm.firstBlockedReasonCode).toBeNull();
  });

  it("未知阶段状态 → UNKNOWN（不猜成 EXECUTED）", () => {
    const vm = buildClosedLoopRunViewModel(
      rawRun({
        stages: [
          { stageId: "regime", state: "WHAT", outputKind: "regimeRef" },
        ],
      })
    )!;
    expect(vm.stages[0]!.state).toBe("UNKNOWN");
  });

  it("阶段缺 stageId 的行被丢弃（不产生空键行）", () => {
    const vm = buildClosedLoopRunViewModel(
      rawRun({ stages: [{ state: "BLOCKED" }, { stageId: "data", state: "BLOCKED" }] })
    )!;
    expect(vm.stages.map(s => s.stageId)).toEqual(["data"]);
  });
});

describe("closedLoopRunAdapter — 映射", () => {
  it("全链概要 / 计数 / 装配覆盖逐字段透传", () => {
    const vm = buildClosedLoopRunViewModel(rawRun())!;
    expect(vm.runId).toBe("clrun-20260911000000000");
    expect(vm.createdAt).toBe("2026-09-11T00:00:00.000Z");
    expect(vm.status).toBe("PARTIAL_BLOCKED");
    expect(vm.chainFingerprint).toBe(HEX);
    expect(vm.synthetic).toBe(false);
    expect(vm.counts).toEqual({ executed: 1, blocked: 13, skipped: 0 });
    expect(vm.firstBlockedReasonCode).toBe("CL_DATA_NOT_INJECTED");
    expect(vm.runnerInjected).toEqual(["evaluation"]);
    expect(vm.wiring.wiredStages).toHaveLength(6);
    expect(vm.wiring.unwiredStages).toEqual(["optimization", "regime"]);
    expect(vm.wiring.coveredStages).toEqual(["evaluation"]);
    expect(vm.wiring.executorBound).toBe(false);
  });

  it("阶段行含阻塞 reasonCode / detail / 交接指纹", () => {
    const vm = buildClosedLoopRunViewModel(rawRun())!;
    const data = vm.stages.find(s => s.stageId === "data")!;
    expect(data.state).toBe("BLOCKED");
    expect(data.blockedReasonCode).toBe("CL_DATA_NOT_INJECTED");
    expect(data.blockedDetail).toBe("data 阶段未注入数据集");
    expect(data.handoffFingerprint).toBeNull();
    const evalRow = vm.stages.find(s => s.stageId === "evaluation")!;
    expect(evalRow.state).toBe("EXECUTED");
    expect(evalRow.handoffFingerprint).toBe("b".repeat(64));
    expect(evalRow.blockedReasonCode).toBeNull();
  });
});

describe("closedLoopRunAdapter — 评估标量（零计算）", () => {
  it("evaluation EXECUTED 且有 evaluationRef → 直搬三节标量", () => {
    const vm = buildClosedLoopRunViewModel(rawRun())!;
    expect(vm.evaluation).toEqual({
      totalReturnPct: 5.3,
      cagrPct: 21.2,
      maxDrawdownPct: -3.7,
      sharpeRatio: 1.42,
      sortinoRatio: 2.01,
      calmarRatio: 0.88,
      winRatePct: 55.5,
      profitFactor: 1.8,
      completedTradeCount: 12,
    });
  });

  it("evaluation 未 EXECUTED → evaluation 为 null（不读残缺 output）", () => {
    const vm = buildClosedLoopRunViewModel(
      rawRun({
        stages: [
          {
            stageId: "evaluation",
            state: "BLOCKED",
            outputKind: "evaluationRef",
            output: { kind: "evaluationRef", performance: { totalReturnPct: 9.9 } },
          },
        ],
      })
    )!;
    expect(vm.evaluation).toBeNull();
  });

  it("output.kind ≠ evaluationRef → 不抽取（防张冠李戴）", () => {
    const vm = buildClosedLoopRunViewModel(
      rawRun({
        stages: [
          {
            stageId: "evaluation",
            state: "EXECUTED",
            outputKind: "evaluationRef",
            output: { kind: "backtestSummary", performance: { totalReturnPct: 9.9 } },
          },
        ],
      })
    )!;
    expect(vm.evaluation).toBeNull();
  });

  it("三节全缺 → null（不返回「全 null 的伪标量对象」）", () => {
    const vm = buildClosedLoopRunViewModel(
      rawRun({
        stages: [
          {
            stageId: "evaluation",
            state: "EXECUTED",
            outputKind: "evaluationRef",
            output: { kind: "evaluationRef" },
          },
        ],
      })
    )!;
    expect(vm.evaluation).toBeNull();
  });

  it("缺字段 → null 而非 0（不推算、不填零）", () => {
    const vm = buildClosedLoopRunViewModel(
      rawRun({
        stages: [
          {
            stageId: "evaluation",
            state: "EXECUTED",
            outputKind: "evaluationRef",
            output: {
              kind: "evaluationRef",
              performance: { totalReturnPct: 5.3 },
            },
          },
        ],
      })
    )!;
    expect(vm.evaluation?.totalReturnPct).toBe(5.3);
    expect(vm.evaluation?.cagrPct).toBeNull();
    expect(vm.evaluation?.maxDrawdownPct).toBeNull();
    expect(vm.evaluation?.sharpeRatio).toBeNull();
    expect(vm.evaluation?.completedTradeCount).toBeNull();
  });
});

describe("closedLoopRunAdapter — RunResultViewModel 投影", () => {
  it("指标按既定字段对应直搬（cagrPct → annualizedReturnPct 等改名，不换算）", () => {
    const vm = buildClosedLoopRunViewModel(rawRun())!;
    const r = closedLoopRunToRunResult(vm);
    expect(r.runId).toBe("clrun-20260911000000000");
    expect(r.status).toBe("PARTIAL_BLOCKED");
    expect(r.metrics).toEqual({
      totalReturnPct: 5.3,
      annualizedReturnPct: 21.2,
      maxDrawdownPct: -3.7,
      winRatePct: 55.5,
      profitFactor: 1.8,
      sharpe: 1.42,
      tradeCount: 12,
    });
    expect(r.hasData).toBe(true);
  });

  it("无评估标量 → 全 null 且 hasData=false（UI 显示空态）", () => {
    const vm = buildClosedLoopRunViewModel(
      rawRun({
        stages: [{ stageId: "data", state: "BLOCKED", outputKind: "datasetSummary" }],
      })
    )!;
    const r = closedLoopRunToRunResult(vm);
    expect(Object.values(r.metrics).every(v => v === null)).toBe(true);
    expect(r.hasData).toBe(false);
  });
});

describe("closedLoopRunAdapter — experimentId 派生", () => {
  const now = new Date("2026-09-11T03:04:05.000Z");
  const range = { startDate: "2026-08-01", endDate: "2026-08-31" };

  it("形态符合 EXP-YYYYMMDD-XXXXXXXX", () => {
    const id = deriveExperimentId("limit-up-baseline", range, "NEXT_OPEN", now);
    expect(id).toMatch(/^EXP-\d{8}-[0-9A-F]{8}$/);
    expect(id.startsWith("EXP-20260911-")).toBe(true);
  });

  it("同配置 + 同日 → 同 id；任一输入变化 → 不同 id", () => {
    const base = deriveExperimentId("s1", range, "NEXT_OPEN", now);
    expect(deriveExperimentId("s1", range, "NEXT_OPEN", now)).toBe(base);
    expect(deriveExperimentId("s2", range, "NEXT_OPEN", now)).not.toBe(base);
    expect(deriveExperimentId("s1", { ...range, endDate: "2026-09-01" }, "NEXT_OPEN", now)).not.toBe(base);
    expect(deriveExperimentId("s1", range, "NEXT_CLOSE", now)).not.toBe(base);
  });

  it("跨日 → 不同 id（日期段随当日变化）", () => {
    const next = new Date("2026-09-12T03:04:05.000Z");
    expect(deriveExperimentId("s1", range, "NEXT_OPEN", now)).not.toBe(
      deriveExperimentId("s1", range, "NEXT_OPEN", next)
    );
  });
});
