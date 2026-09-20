/**
 * PHASE-R1-001 — 观察日 PIT 护栏的**真实性**测试（编号 `9bz`）。
 *
 * 背景（这是一个真实缺陷）：原实现的判定日 = `max(组内观察日变量的 offset)`，随后断言
 * 「每个 offset ≤ 该 max」—— 循环定义、**恒真**，生产路径永不触发。而它正是
 * `assertObservationConditionsPitSafe` 自称的「整个 OBSERVATION 角色存在的唯一防线」。
 *
 * 本文件既断言**新行为**（判定日 = Dataset 声明的决策日），也用一条**反证**断言把
 * 「旧口径必然放行」钉死 —— 否则「修好了」只是一句没有对照的声明。
 */

import { describe, expect, it } from "vitest";
import {
  ResearchVariableCatalog,
  assertGroupObservationPitSafe,
  assertObservationConditionsPitSafe,
  readDecisionOffsetDays,
  resolveEffectiveDecisionOffset,
} from "../../../server/researchEngine/variables";
import { ResearchEngineError } from "../../../server/researchEngine/errors";

/** post 视界显式给到 1..10，保证 `pullback_*_{k}d` / `obs_{k}d.*` 都已登记。 */
const catalog = new ResearchVariableCatalog(
  [5, 10, 20],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
);

function group(...fieldNames: string[]) {
  return { conditions: fieldNames.map((fieldName) => ({ fieldName })) };
}

function codeOf(fn: () => void): string {
  try {
    fn();
    return "(未抛错)";
  } catch (e) {
    return e instanceof ResearchEngineError ? e.code : `非引擎错误：${String(e)}`;
  }
}

describe("PHASE-R1-001 · 观察日 PIT 护栏（判定日由 Dataset 声明）", () => {
  it("数据集未声明决策日 + 观察日条件 ⇒ OBSERVATION_WITHOUT_DECISION_DAY（响亮拒绝，不放行）", () => {
    expect(
      codeOf(() =>
        assertGroupObservationPitSafe({
          catalog,
          groups: [group("pullback_min_low_3d")],
          decisionOffsetDays: null,
        }),
      ),
    ).toBe("OBSERVATION_WITHOUT_DECISION_DAY");
  });

  it("引用晚于决策日的观察日变量 ⇒ VARIABLE_ROLE_VIOLATION（护栏真的生效）", () => {
    expect(
      codeOf(() =>
        assertGroupObservationPitSafe({
          catalog,
          groups: [group("pullback_min_low_5d")],
          decisionOffsetDays: 3,
        }),
      ),
    ).toBe("VARIABLE_ROLE_VIOLATION");
  });

  it("引用不晚于决策日的观察日变量 ⇒ 通过，并返回被引用变量（可追溯、不静默）", () => {
    const used = assertGroupObservationPitSafe({
      catalog,
      groups: [group("pullback_min_low_3d", "turnover")],
      decisionOffsetDays: 3,
    });
    expect(used).toEqual([{ variable: "pullback_min_low_3d", availableFromOffset: 3 }]);
  });

  it("只用 T 日及以前的特征 / 结果的组 ⇒ 不受决策日约束（不误伤）", () => {
    const used = assertGroupObservationPitSafe({
      catalog,
      groups: [group("turnover", "previous_close")],
      decisionOffsetDays: null,
    });
    expect(used).toEqual([]);
  });

  it("多组分别判定：任一组的观察日越界即整次拒绝，不因另一组合法而放行", () => {
    expect(
      codeOf(() =>
        assertGroupObservationPitSafe({
          catalog,
          groups: [group("turnover"), group("obs_5d.close")],
          decisionOffsetDays: 2,
        }),
      ),
    ).toBe("VARIABLE_ROLE_VIOLATION");
  });

  it("🔴 反证：旧口径「判定日 = 组内最大 offset」必然放行 ⇒ 它挡不住任何东西", () => {
    const fields = ["pullback_min_low_5d"];
    // 旧实现的 evaluationOffset 就取自组内 max(=5)，故 offset ≤ max 恒真 ⇒ 永不抛错。
    expect(() =>
      assertObservationConditionsPitSafe({ catalog, fields, evaluationOffset: 5 }),
    ).not.toThrow();
    // 同一条件，换成「数据集声明的决策日 = 3」才被拒绝 —— 这正是本次修复的点。
    expect(
      codeOf(() =>
        assertGroupObservationPitSafe({ catalog, groups: [group(...fields)], decisionOffsetDays: 3 }),
      ),
    ).toBe("VARIABLE_ROLE_VIOLATION");
  });
});

describe("PHASE-R1-001B · 判定日的四级声明解析（分析 → Run → Experiment → Dataset）", () => {
  const base = {
    datasetDecisionOffsetDays: null as number | null,
    analysisConfig: null as unknown,
    runConfig: null as unknown,
    experimentConfig: null as unknown,
    analysisId: 1,
  };

  it("四级全空 ⇒ null（后续引用观察日变量即被拒绝）", () => {
    expect(resolveEffectiveDecisionOffset({ ...base })).toBeNull();
  });

  it("四级各自单独声明 ⇒ 都生效", () => {
    expect(resolveEffectiveDecisionOffset({ ...base, analysisConfig: { decisionOffsetDays: 1 } })).toBe(1);
    expect(resolveEffectiveDecisionOffset({ ...base, runConfig: { decisionOffsetDays: 2 } })).toBe(2);
    expect(resolveEffectiveDecisionOffset({ ...base, experimentConfig: { decisionOffsetDays: 3 } })).toBe(3);
    expect(resolveEffectiveDecisionOffset({ ...base, datasetDecisionOffsetDays: 4 })).toBe(4);
  });

  it("多处声明**同值** ⇒ 通过（不误伤）", () => {
    expect(
      resolveEffectiveDecisionOffset({
        ...base,
        analysisConfig: { decisionOffsetDays: 2 },
        runConfig: { decisionOffsetDays: 2 },
        experimentConfig: { decisionOffsetDays: 2 },
        datasetDecisionOffsetDays: 2,
      }),
    ).toBe(2);
  });

  it("多处声明**异值** ⇒ DECISION_OFFSET_CONFLICT（不按优先级静默取一个）", () => {
    expect(
      codeOf(() =>
        resolveEffectiveDecisionOffset({
          ...base,
          experimentConfig: { decisionOffsetDays: 2 },
          datasetDecisionOffsetDays: 5,
        }),
      ),
    ).toBe("DECISION_OFFSET_CONFLICT");
    expect(
      codeOf(() =>
        resolveEffectiveDecisionOffset({
          ...base,
          analysisConfig: { decisionOffsetDays: 1 },
          runConfig: { decisionOffsetDays: 2 },
          experimentConfig: { decisionOffsetDays: 2 },
        }),
      ),
    ).toBe("DECISION_OFFSET_CONFLICT");
  });

  it("存在但非法（0 / -1 / 2.5 / \"3\" / NaN）⇒ INVALID_DECISION_OFFSET（绝不静默忽略）", () => {
    for (const bad of [0, -1, 2.5, "3", Number.NaN]) {
      expect(codeOf(() => readDecisionOffsetDays({ decisionOffsetDays: bad }, "experiment.config"))).toBe(
        "INVALID_DECISION_OFFSET",
      );
    }
    // 键不存在 / 值为 null ⇒ 视为「未声明」，不是错误
    expect(readDecisionOffsetDays({}, "experiment.config")).toBeNull();
    expect(readDecisionOffsetDays({ decisionOffsetDays: null }, "experiment.config")).toBeNull();
    expect(readDecisionOffsetDays(null, "experiment.config")).toBeNull();
  });

  it("解析结果接进护栏：声明 d=2 时 offset=2 放行、offset=3 拒绝", () => {
    const d = resolveEffectiveDecisionOffset({ ...base, experimentConfig: { decisionOffsetDays: 2 } });
    expect(d).toBe(2);
    expect(() =>
      assertGroupObservationPitSafe({ catalog, groups: [group("pullback_min_low_2d")], decisionOffsetDays: d }),
    ).not.toThrow();
    expect(
      codeOf(() =>
        assertGroupObservationPitSafe({ catalog, groups: [group("pullback_min_low_3d")], decisionOffsetDays: d }),
      ),
    ).toBe("VARIABLE_ROLE_VIOLATION");
  });
});
