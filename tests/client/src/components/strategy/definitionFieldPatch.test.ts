/**
 * `definitionFieldPatch.ts` 行为锁（P2：③ 仓位 / ④ 成本与成交的 FIELD_PATCH）。
 *
 * 这一层只有两件事会出错，而且**都会静默**：
 *   ① 补丁顺手把没声明的字段冲掉（或更糟：重建 `original` ⇒ 丢掉表单不编辑的键）；
 *   ② `maxPositions` 双写只写了一半（`position` 与回测配置对不上）。
 * 所以断言的重点不是"值对不对"，而是**"碰了什么 / 没碰什么"**。
 */
import { describe, expect, it } from "vitest";

import {
  FIRST_BOARD_PULLBACK_DEFINITION,
  FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
} from "../../../../../server/research/strategySchema/goldenSample";
import {
  definitionToDrafts,
  draftsToDefinition,
  withDocumentLevelDrafts,
  type DefinitionDrafts,
} from "@/components/strategy/definitionDraft";
import {
  applyDefinitionFieldPatch,
  describeDefinitionFieldPatch,
} from "@/components/strategy/definitionFieldPatch";

function goldenDrafts(): DefinitionDrafts {
  const state = withDocumentLevelDrafts(
    definitionToDrafts(FIRST_BOARD_PULLBACK_DEFINITION),
    FIRST_BOARD_PULLBACK_DOCUMENT_INPUT.executionAssumptions,
  );
  if (state.kind !== "structured") throw new Error("golden sample 应当可以被结构化编辑");
  return state.drafts;
}

/** 除 `position` / `cost` / `execution` 之外的段（补丁**不该**碰它们）。 */
function untouchedSegments(drafts: DefinitionDrafts): string {
  return JSON.stringify({
    schemaVersion: drafts.schemaVersion,
    event: drafts.event,
    window: drafts.window,
    trigger: drafts.trigger,
    conditions: drafts.conditions,
    exitRules: drafts.exitRules,
    risk: drafts.risk,
    parameters: drafts.parameters,
    datasets: drafts.datasets,
  });
}

describe("applyDefinitionFieldPatch（③ 仓位 / ④ 成本与成交）", () => {
  it("1) ③ 仓位补丁：只填声明的字段，其余段一字不动", () => {
    const drafts = goldenDrafts();
    const before = untouchedSegments(drafts);
    const next = applyDefinitionFieldPatch(drafts, {
      position: { sizingMethod: "FIXED_RATIO", positionRatio: 0.2, maxPositions: 5 },
    });
    expect(next.position.sizingMethod).toBe("FIXED_RATIO");
    expect(next.position.positionRatio).toBe("0.2");
    expect(next.position.maxPositions).toBe("5");
    expect(untouchedSegments(next)).toBe(before);
  });

  it("2) ★ `maxPositions` 双写：position 与 cost（= 回测配置）必须一致", () => {
    const next = applyDefinitionFieldPatch(goldenDrafts(), {
      position: { sizingMethod: "FIXED_RATIO", maxPositions: 7 },
    });
    expect(next.position.maxPositions).toBe("7");
    expect(next.cost.maxPositions).toBe("7");
  });

  it("3) 补丁没声明 maxPositions 时，**不得**顺手改写 cost.maxPositions", () => {
    const drafts = goldenDrafts();
    const originalCostMax = drafts.cost.maxPositions;
    const next = applyDefinitionFieldPatch(drafts, { position: { positionRatio: 0.35 } });
    expect(next.position.positionRatio).toBe("0.35");
    expect(next.cost.maxPositions).toBe(originalCostMax);
  });

  it("4) ★ `original` 原样保留：补丁只改文本字段，不重建 original（不丢键）", () => {
    const drafts = goldenDrafts();
    const next = applyDefinitionFieldPatch(drafts, {
      position: { sizingMethod: "FIXED_AMOUNT", fixedAmount: 100000 },
    });
    expect(next.position.original).toEqual(drafts.position.original);
    expect(next.cost.original).toEqual(drafts.cost.original);
    expect(next.cost.backtestOriginal).toEqual(drafts.cost.backtestOriginal);
    expect(next.execution.original).toEqual(drafts.execution.original);
  });

  it("5) ★ 补丁后往返：`definition` 不新增 / 不丢失键（结构化深等于）", () => {
    const drafts = goldenDrafts();
    const next = applyDefinitionFieldPatch(drafts, {
      position: { sizingMethod: "FIXED_RATIO", positionRatio: 0.2, maxPositions: 5 },
      cost: { initialCapital: 1000000, commissionRate: 0.0003, stampDutyRate: 0.001 },
      execution: { signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_OPEN", priceType: "OPEN" },
    });
    const before = draftsToDefinition(drafts);
    const after = draftsToDefinition(next);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    // 只该动到 position 段（补丁没声明别的 definition 级字段）
    expect(after.entry).toEqual(before.entry);
    expect(after.exit).toEqual(before.exit);
    expect(after.parameters).toEqual(before.parameters);
    expect(after.position?.sizingMethod).toBe("FIXED_RATIO");
  });

  it("6) ④ 成本与成交补丁：7 项成本 + 3 项成交口径都落到草稿", () => {
    const next = applyDefinitionFieldPatch(goldenDrafts(), {
      cost: {
        initialCapital: 1000000, commissionRate: 0.0003, stampDutyRate: 0.001,
        transferFeeRate: 0.00001, slippageBps: 10, lotSize: 100, minCommission: 5,
      },
      execution: { signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_OPEN", priceType: "OPEN" },
    });
    for (const [key, expected] of Object.entries({
      initialCapital: "1000000", commissionRate: "0.0003", stampDutyRate: "0.001",
      transferFeeRate: "0.00001", slippageBps: "10", lotSize: "100", minCommission: "5",
    })) {
      expect(next.cost[key as keyof typeof next.cost], key).toBe(expected);
    }
    expect(next.execution.signalTiming).toBe("T_CLOSE");
    expect(next.execution.executionTiming).toBe("T_PLUS_1_OPEN");
    expect(next.execution.priceType).toBe("OPEN");
  });

  it("7) 纯函数：入参草稿不被修改", () => {
    const drafts = goldenDrafts();
    const snapshot = JSON.stringify(drafts);
    applyDefinitionFieldPatch(drafts, {
      position: { sizingMethod: "EQUAL_WEIGHT", maxPositions: 3 },
      cost: { initialCapital: 500000 },
    });
    expect(JSON.stringify(drafts)).toBe(snapshot);
  });

  it("8) 未知段 / 未知键被忽略（不猜、不报错、不扩面）", () => {
    const drafts = goldenDrafts();
    const next = applyDefinitionFieldPatch(drafts, {
      notASegment: { foo: 1 },
      position: { notAKey: 1 },
    });
    expect(next.position).toEqual(drafts.position);
    expect(next.cost).toEqual(drafts.cost);
  });

  it("9) describeDefinitionFieldPatch：稳定顺序，供信任层/审计用", () => {
    expect(describeDefinitionFieldPatch({ position: { maxPositions: 5, sizingMethod: "FIXED_RATIO" } }))
      .toEqual(["position.maxPositions", "position.sizingMethod"]);
    expect(describeDefinitionFieldPatch({ cost: { lotSize: 100 }, execution: { priceType: "OPEN" } }))
      .toEqual(["cost.lotSize", "execution.priceType"]);
    expect(describeDefinitionFieldPatch({})).toEqual([]);
  });
});
