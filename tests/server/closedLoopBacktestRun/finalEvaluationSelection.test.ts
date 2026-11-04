/** STRATEGY-3570001-FINAL-EVALUATION-001 —— 留档选择逻辑单测（纯函数，无 DB）。 */
import { describe, expect, it } from "vitest";
import {
  FINAL_EVALUATION_EXPERIMENT_ID,
  selectFinalEvaluationPair,
  selectFinalEvaluationRunIds,
} from "../../../server/closedLoopBacktestRun/finalEvaluationSelection";

const detail = (id: number, strategyId: string, strategyVersion: string, evaluationDetail: unknown) => ({
  id, strategyId, strategyVersion, result: { evaluationDetail },
});

describe("selectFinalEvaluationRunIds", () => {
  it("只挑本任务 experimentId 的行，保持入参顺序", () => {
    const ids = selectFinalEvaluationRunIds([
      { id: 1, experimentId: "OTHER" },
      { id: 5970002, experimentId: FINAL_EVALUATION_EXPERIMENT_ID },
      { id: 5970001, experimentId: FINAL_EVALUATION_EXPERIMENT_ID },
      { id: 3, experimentId: null },
    ]);
    expect(ids).toEqual([5970002, 5970001]);
  });

  it("没有本任务行 ⇒ 空数组（不伪造）", () => {
    expect(selectFinalEvaluationRunIds([{ id: 1, experimentId: "OTHER" }])).toEqual([]);
  });
});

describe("selectFinalEvaluationPair", () => {
  it("按 strategyId 取提升版、按 version 取基线，并原样取出 evaluationDetail", () => {
    const ev = { promoted: { runner: { triggerCount: 159 } } };
    const pair = selectFinalEvaluationPair([
      detail(5970002, "first-limit-pullback-3f-top3-runner-hold20", "1.0.0", ev),
      detail(5970001, "first-limit-pullback-3f-top3", "1.62.1", ev),
    ]);
    expect(pair.promoted?.id).toBe(5970002);
    expect(pair.baseline?.id).toBe(5970001);
    expect(pair.evaluationDetail).toEqual(ev);
  });

  it("缺行 ⇒ 对应位置为 null（不猜、不补）", () => {
    const pair = selectFinalEvaluationPair([detail(5970002, "first-limit-pullback-3f-top3-runner-hold20", "1.0.0", { x: 1 })]);
    expect(pair.promoted?.id).toBe(5970002);
    expect(pair.baseline).toBeNull();
  });

  it("result 缺 evaluationDetail ⇒ null（不用空对象冒充）", () => {
    const pair = selectFinalEvaluationPair([{ id: 1, strategyId: "first-limit-pullback-3f-top3-runner-hold20", strategyVersion: "1.0.0", result: {} }]);
    expect(pair.evaluationDetail).toBeNull();
  });
});
