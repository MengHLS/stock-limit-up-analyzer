/**
 * SCOPE-002 S7 —— 「按策略版本坐标取评估 / 模拟盘留档」的纯选择逻辑单测。
 *
 * 只碰纯函数：不触 DB。
 */
import { describe, expect, it } from "vitest";
import {
  selectStrategyVersionEvaluation,
  selectStrategyVersionPaperTrading,
} from "../../../server/closedLoopBacktestRun/strategyVersionArtifacts";
import type { RawArchivedPayload } from "../../../server/closedLoopBacktestRun/rawPayload";

const COORDS = { strategyId: "s-a", strategyVersion: "1.0.0" };

function row(input: {
  id: number; runId: string; strategyId: string; strategyVersion: string;
  experimentId?: string | null; payload: Record<string, unknown>;
}): RawArchivedPayload {
  return {
    id: input.id, runId: input.runId, strategyId: input.strategyId, strategyVersion: input.strategyVersion,
    experimentId: input.experimentId ?? null, startDate: "2019-01-01", endDate: "2026-09-04",
    payload: input.payload,
  };
}

/** 模拟仓储返回：id 倒序（新的在前）。 */
const EVAL_ROWS: readonly RawArchivedPayload[] = [
  row({ id: 200, runId: "eval-promoted", strategyId: "s-a", strategyVersion: "1.0.0", experimentId: "exp-1", payload: { evaluationDetail: { promoted: { full: { totalReturnPct: 129.7 } } } } }),
  row({ id: 100, runId: "eval-baseline", strategyId: "s-base", strategyVersion: "1.62.1", experimentId: "exp-1", payload: { evaluationDetail: { baseline: { full: { totalReturnPct: 15.8 } } } } }),
];

const PAPER_ROWS: readonly RawArchivedPayload[] = [
  row({ id: 300, runId: "paper-forward", strategyId: "s-a", strategyVersion: "1.0.0", experimentId: "exp-2", payload: { paperTradingForwardState: { status: "WAITING_FOR_NEW_DATA" } } }),
  row({ id: 200, runId: "paper-historical", strategyId: "s-a", strategyVersion: "1.0.0", experimentId: "exp-2", payload: { paperTradingState: { daily: [1, 2, 3] } } }),
];

describe("selectStrategyVersionEvaluation", () => {
  it("promoted = 坐标匹配那条；baseline = 同 experimentId 的对照组（坐标不同）", () => {
    const out = selectStrategyVersionEvaluation(EVAL_ROWS, COORDS);
    expect(out.promoted?.runId).toBe("eval-promoted");
    expect(out.baseline?.runId).toBe("eval-baseline");
    expect((out.evaluationDetail as any).promoted.full.totalReturnPct).toBe(129.7);
  });

  it("坐标不匹配 ⇒ 全为 null、evaluationDetail 为 null（不伪造）", () => {
    const out = selectStrategyVersionEvaluation(EVAL_ROWS, { strategyId: "nope", strategyVersion: "9.9.9" });
    expect(out.promoted).toBeNull();
    expect(out.baseline).toBeNull();
    expect(out.evaluationDetail).toBeNull();
  });

  it("同任务多条兄弟行 ⇒ baseline 取最旧的一条（可复现）", () => {
    const rows: readonly RawArchivedPayload[] = [
      row({ id: 400, runId: "p", strategyId: "s-a", strategyVersion: "1.0.0", experimentId: "exp-1", payload: { evaluationDetail: { x: 1 } } }),
      row({ id: 300, runId: "b-new", strategyId: "s-x", strategyVersion: "2.0.0", experimentId: "exp-1", payload: { evaluationDetail: { x: 2 } } }),
      row({ id: 100, runId: "b-old", strategyId: "s-y", strategyVersion: "1.62.1", experimentId: "exp-1", payload: { evaluationDetail: { x: 3 } } }),
    ];
    expect(selectStrategyVersionEvaluation(rows, COORDS).baseline?.runId).toBe("b-old");
  });

  it("没有 evaluationDetail 的行被忽略", () => {
    const rows: readonly RawArchivedPayload[] = [
      row({ id: 500, runId: "no-detail", strategyId: "s-a", strategyVersion: "1.0.0", payload: { other: true } }),
    ];
    expect(selectStrategyVersionEvaluation(rows, COORDS).promoted).toBeNull();
  });
});

describe("selectStrategyVersionPaperTrading", () => {
  it("state 与 forward 各自独立取最新", () => {
    const out = selectStrategyVersionPaperTrading(PAPER_ROWS, COORDS);
    expect(out.stateRun?.runId).toBe("paper-historical");
    expect(out.forwardRun?.runId).toBe("paper-forward");
    expect((out.state as any).daily).toHaveLength(3);
    expect((out.forward as any).status).toBe("WAITING_FOR_NEW_DATA");
  });

  it("只有 state 没有 forward ⇒ forward 为 null（不伪造）", () => {
    const out = selectStrategyVersionPaperTrading([PAPER_ROWS[1]!], COORDS);
    expect(out.state).not.toBeNull();
    expect(out.forward).toBeNull();
    expect(out.forwardRun).toBeNull();
  });

  it("坐标不匹配 ⇒ 全为 null", () => {
    const out = selectStrategyVersionPaperTrading(PAPER_ROWS, { strategyId: "nope", strategyVersion: "9.9.9" });
    expect(out.state).toBeNull();
    expect(out.forward).toBeNull();
  });
});