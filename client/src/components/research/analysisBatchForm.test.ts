/**
 * analysisBatchForm 单测 — 批量矩阵展开 / 标准套件 / 模板预览。
 *
 * 覆盖重点（都是「错了会静默少建或建错」的地方）：
 *   - 笛卡尔积的**基数**正确（少乘一个维度是最典型的静默 bug）；
 *   - 生成的名称**批内唯一**（STABILITY 的建议名不含目标变量，必须消歧）；
 *   - 缺输入时**不产出而是记 skipped + 原因**（不静默少建）；
 *   - 无条件时 CONDITIONAL 必须被跳过并说明（引擎会拒空条件）；
 *   - EVENT_STUDY 只有一项且视界一次给全（不是每个视界一项）。
 */

import { describe, expect, it } from "vitest";
import {
  MAX_BATCH_ITEMS,
  buildSuitePlan,
  createDefaultBatchMatrixForm,
  describeBatchItem,
  expandAnalysisMatrix,
  formStateToBatchItem,
  templatePreviewRows,
  toBatchCreatePayload,
  validateBatchMatrixForm,
  validateTemplateName,
  type BatchMatrixFormState,
} from "./analysisBatchForm";
import {
  ANALYSIS_EXAMPLES,
  IMPLEMENTED_ANALYSIS_TYPES,
  applyAnalysisExample,
  createEmptyCondition,
  createEmptyConditionGroup,
  missingVariablesForExample,
  suggestAnalysisName,
  type AnalysisFormCatalog,
} from "./createAnalysisForm";

const CATALOG: AnalysisFormCatalog = {
  features: ["turnover", "volumeRatio", "floatMarketCap"],
  outcomes: ["future_return_5d", "future_return_10d", "future_return_20d", "max_return_10d"],
  dimensions: ["year", "month", "board"],
};

function baseState(overrides: Partial<BatchMatrixFormState> = {}): BatchMatrixFormState {
  return {
    analysisTypes: [],
    featureField: "turnover",
    targetFields: [],
    quantileGroups: "10",
    horizons: [],
    stabilityDimensions: [],
    variables: [],
    conditions: [],
    ...overrides,
  };
}

function withCondition(): BatchMatrixFormState["conditions"] {
  const group = createEmptyConditionGroup();
  const cond = createEmptyCondition();
  cond.fieldName = "volumeRatio";
  cond.operator = ">=";
  cond.value = "1.5";
  group.conditions = [cond];
  return [group];
}

describe("expandAnalysisMatrix — 矩阵基数", () => {
  it("QUANTILE × 3 个目标 → 3 项，名称各自带目标变量", () => {
    const result = expandAnalysisMatrix(
      baseState({ analysisTypes: ["QUANTILE"], targetFields: CATALOG.outcomes.slice(0, 3) }),
    );
    expect(result.items).toHaveLength(3);
    expect(result.items.map((i) => i.target)).toEqual([
      "future_return_5d",
      "future_return_10d",
      "future_return_20d",
    ]);
    for (const item of result.items) {
      expect(item.name).toContain(item.target!);
    }
    // 配置与单建同源（复用 toAnalysisConfig）
    expect(result.items[0]!.config).toEqual({
      featureField: "turnover",
      targetField: "future_return_5d",
      quantileGroups: 10,
    });
    expect(result.skipped).toHaveLength(0);
    expect(result.truncated).toBe(0);
  });

  it("STABILITY = 目标 × 维度 的笛卡尔积，且名称含目标变量（防重名）", () => {
    const result = expandAnalysisMatrix(
      baseState({
        analysisTypes: ["STABILITY"],
        targetFields: ["future_return_5d", "future_return_10d"],
        stabilityDimensions: ["year", "board"],
      }),
    );
    expect(result.items).toHaveLength(4);
    const names = result.items.map((i) => i.name);
    expect(new Set(names).size).toBe(4);
    // 每个名称都必须能区分出「目标 + 维度」，否则预览清单无法核对
    for (const item of result.items) {
      expect(item.name).toContain(item.target!);
    }
    expect(names.some((n) => n.includes("year"))).toBe(true);
    expect(names.some((n) => n.includes("board"))).toBe(true);
  });

  it("EVENT_STUDY 只有一项，视界一次给全（不是每视界一项）", () => {
    const result = expandAnalysisMatrix(
      baseState({ analysisTypes: ["EVENT_STUDY"], horizons: [1, 3, 5] }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.config).toEqual({ horizons: [1, 3, 5] });
    expect(result.items[0]!.target).toBeUndefined();
  });

  it("DESCRIPTIVE 只有一项，variables 原样传入", () => {
    const result = expandAnalysisMatrix(
      baseState({ analysisTypes: ["DESCRIPTIVE"], variables: ["turnover", "volumeRatio"] }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.config).toEqual({ variables: ["turnover", "volumeRatio"] });
  });

  it("多类型混合：5 类同时选且输入齐备时按各规则累加", () => {
    const result = expandAnalysisMatrix(
      baseState({
        analysisTypes: ["DESCRIPTIVE", "QUANTILE", "EVENT_STUDY", "STABILITY", "CONDITIONAL"],
        targetFields: ["future_return_5d", "future_return_10d"],
        horizons: [5],
        stabilityDimensions: ["year"],
        variables: ["turnover"],
        conditions: withCondition(),
      }),
    );
    // DESCRIPTIVE 1 + QUANTILE 2 + EVENT_STUDY 1 + STABILITY 2 + CONDITIONAL 2 = 8
    expect(result.items).toHaveLength(8);
    expect(new Set(result.items.map((i) => i.name)).size).toBe(8);
    expect(result.skipped).toHaveLength(0);
  });
});

describe("expandAnalysisMatrix — 缺输入时不静默少建", () => {
  it("未勾选的类型既不产出、也不算 skipped（那是用户的明确选择）", () => {
    const result = expandAnalysisMatrix(baseState({ analysisTypes: ["QUANTILE"], targetFields: ["future_return_5d"] }));
    expect(result.items).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("QUANTILE 缺特征 → 跳过并说明原因", () => {
    const result = expandAnalysisMatrix(
      baseState({ analysisTypes: ["QUANTILE"], featureField: "", targetFields: ["future_return_5d"] }),
    );
    expect(result.items).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.analysisType).toBe("QUANTILE");
    expect(result.skipped[0]!.reason).toContain("特征变量");
  });

  it("CONDITIONAL 无条件 → 跳过，且原因必须点明「空条件等于全样本」", () => {
    const result = expandAnalysisMatrix(
      baseState({ analysisTypes: ["CONDITIONAL"], targetFields: ["future_return_5d"] }),
    );
    expect(result.items).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain("全样本");
  });

  it("CONDITIONAL 有条件 → 每个目标一项，且条件载荷逐项一致", () => {
    const result = expandAnalysisMatrix(
      baseState({
        analysisTypes: ["CONDITIONAL"],
        targetFields: ["future_return_5d", "future_return_10d"],
        conditions: withCondition(),
      }),
    );
    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item.conditions).toHaveLength(1);
      expect(item.conditions![0]!.fieldName).toBe("volumeRatio");
      expect(item.conditions![0]!.groupNo).toBe(0);
      expect(item.conditions![0]!.sortOrder).toBe(0);
      expect(item.conditions![0]!.value).toBe(1.5);
    }
  });

  it("每组条件只算一次并复用同一载荷（不产生组号断号）", () => {
    const result = expandAnalysisMatrix(
      baseState({
        analysisTypes: ["QUANTILE", "CONDITIONAL"],
        targetFields: ["future_return_5d"],
        conditions: withCondition(),
      }),
    );
    const quantile = result.items.find((i) => i.analysisType === "QUANTILE")!;
    const conditional = result.items.find((i) => i.analysisType === "CONDITIONAL")!;
    expect(quantile.conditions).toEqual(conditional.conditions);
  });

  it("EVENT_STUDY 无视界 / STABILITY 无维度 / DESCRIPTIVE 无变量 → 各自被跳过", () => {
    const result = expandAnalysisMatrix(
      baseState({
        analysisTypes: ["EVENT_STUDY", "STABILITY", "DESCRIPTIVE"],
        targetFields: ["future_return_5d"],
      }),
    );
    expect(result.items).toHaveLength(0);
    expect(result.skipped.map((s) => s.analysisType).sort()).toEqual([
      "DESCRIPTIVE",
      "EVENT_STUDY",
      "STABILITY",
    ]);
  });
});

describe("expandAnalysisMatrix — 上限截断", () => {
  it("超过单批上限时截断，且如实报告 truncated 数量", () => {
    const manyTargets = Array.from({ length: 60 }, (_, i) => `future_return_${i + 1}d`);
    const manyDimensions = Array.from({ length: 20 }, (_, i) => `dim${i}`);
    const result = expandAnalysisMatrix(
      baseState({
        analysisTypes: ["STABILITY"],
        targetFields: manyTargets,
        stabilityDimensions: manyDimensions,
      }),
    );
    // 60 × 20 = 1200 > 200
    expect(result.items).toHaveLength(MAX_BATCH_ITEMS);
    expect(result.truncated).toBe(1200 - MAX_BATCH_ITEMS);
  });
});

describe("toBatchCreatePayload", () => {
  it("无目标的类型不发 target 键（与单建「没有就不发」一致）", () => {
    const result = expandAnalysisMatrix(
      baseState({ analysisTypes: ["EVENT_STUDY"], horizons: [5], targetFields: ["future_return_5d"] }),
    );
    const payload = toBatchCreatePayload(result.items);
    expect(payload).toHaveLength(1);
    expect("target" in payload[0]!).toBe(false);
    expect(payload[0]!.analysisType).toBe("EVENT_STUDY");
  });

  it("无条件时不发 conditions 键（避免服务端把空数组当成条件集）", () => {
    const result = expandAnalysisMatrix(
      baseState({ analysisTypes: ["QUANTILE"], targetFields: ["future_return_5d"] }),
    );
    const payload = toBatchCreatePayload(result.items);
    expect("conditions" in payload[0]!).toBe(false);
  });

  it("带目标 / 条件的类型如实携带", () => {
    const result = expandAnalysisMatrix(
      baseState({
        analysisTypes: ["CONDITIONAL"],
        targetFields: ["future_return_5d"],
        conditions: withCondition(),
      }),
    );
    const payload = toBatchCreatePayload(result.items);
    expect(payload[0]!.target).toBe("future_return_5d");
    expect(payload[0]!.conditions).toHaveLength(1);
  });
});

describe("createDefaultBatchMatrixForm", () => {
  it("默认填的是目录里真实存在的变量（绝不发明变量）", () => {
    const state = createDefaultBatchMatrixForm(CATALOG);
    expect(CATALOG.features).toContain(state.featureField);
    for (const t of state.targetFields) expect(CATALOG.outcomes).toContain(t);
    for (const h of state.horizons) expect(h).toBeGreaterThan(0);
    for (const d of state.stabilityDimensions) expect(CATALOG.dimensions).toContain(d);
    expect(state.analysisTypes).toEqual(["QUANTILE"]);
  });
});

describe("buildSuitePlan", () => {
  it("视界取自真实目录，不硬编码 1/3/5/10/20", () => {
    const plan = buildSuitePlan({ featureField: "turnover", targetField: "future_return_5d", catalog: CATALOG });
    // 目录里只有 5 / 10 / 20（max_return_10d 不参与 future_return 视界）
    expect(plan.state.horizons).toEqual([5, 10, 20]);
  });

  it("无条件时明确说明「不含条件分析」，而不是悄悄少一项", () => {
    const plan = buildSuitePlan({ featureField: "turnover", targetField: "future_return_5d", catalog: CATALOG });
    expect(plan.members).toContain("CONDITIONAL");
    expect(plan.notes.some((n) => n.includes("条件分析"))).toBe(true);
  });

  it("套件展开后 CONDITIONAL 被跳过并给出原因，但其余成员都在", () => {
    const plan = buildSuitePlan({ featureField: "turnover", targetField: "future_return_5d", catalog: CATALOG });
    const result = expandAnalysisMatrix(plan.state);
    // 类型集合（STABILITY 每维度一项，故按集合比对而不是逐项比对）
    const types = new Set(result.items.map((i) => i.analysisType));
    expect([...types].sort()).toEqual(["DESCRIPTIVE", "EVENT_STUDY", "QUANTILE", "STABILITY"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.analysisType).toBe("CONDITIONAL");
    // STABILITY 每个维度一项
    expect(result.items.filter((i) => i.analysisType === "STABILITY")).toHaveLength(3);
  });

  it("填了条件后 CONDITIONAL 进入清单", () => {
    const plan = buildSuitePlan({
      featureField: "turnover",
      targetField: "future_return_5d",
      catalog: CATALOG,
      conditions: withCondition(),
    });
    const result = expandAnalysisMatrix(plan.state);
    expect(result.items.map((i) => i.analysisType)).toContain("CONDITIONAL");
    expect(result.skipped).toHaveLength(0);
  });

  it("空维度目录时如实说明稳定性分析缺席", () => {
    const plan = buildSuitePlan({
      featureField: "turnover",
      targetField: "future_return_5d",
      catalog: { ...CATALOG, dimensions: [] },
    });
    expect(plan.notes.some((n) => n.includes("稳定性"))).toBe(true);
    expect(expandAnalysisMatrix(plan.state).items.map((i) => i.analysisType)).not.toContain("STABILITY");
  });
});

describe("templatePreviewRows", () => {
  it("按 sortOrder 升序，且不推导、不改名", () => {
    const rows = templatePreviewRows([
      { sortOrder: 2, analysisType: "STABILITY", name: "c", target: "future_return_5d" },
      { sortOrder: 0, analysisType: "QUANTILE", name: "a", target: null },
      { sortOrder: 1, analysisType: "EVENT_STUDY", name: "b" },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["a", "b", "c"]);
    expect(rows[1]!.target).toBeNull();
  });
});

describe("validateBatchMatrixForm / validateTemplateName", () => {
  it("未选类型即报错", () => {
    expect(validateBatchMatrixForm(baseState())).toContain("请至少选择一种分析类型");
  });

  it("勾了 QUANTILE 但没特征 → 报错", () => {
    const errors = validateBatchMatrixForm(
      baseState({ analysisTypes: ["QUANTILE"], featureField: "", targetFields: ["future_return_5d"] }),
    );
    expect(errors.some((e) => e.includes("特征变量"))).toBe(true);
  });

  it("分组数越界 → 报错", () => {
    const errors = validateBatchMatrixForm(
      baseState({ analysisTypes: ["QUANTILE"], targetFields: ["future_return_5d"], quantileGroups: "1" }),
    );
    expect(errors.some((e) => e.includes("分组数"))).toBe(true);
  });

  it("输入齐备 → 无错误", () => {
    expect(
      validateBatchMatrixForm(
        baseState({ analysisTypes: ["QUANTILE"], targetFields: ["future_return_5d"] }),
      ),
    ).toHaveLength(0);
  });

  it("模板名空 / 过长", () => {
    expect(validateTemplateName("   ")).toContain("请填写模板名");
    expect(validateTemplateName("x".repeat(121)).some((e) => e.includes("120"))).toBe(true);
    expect(validateTemplateName("首板研究套件")).toHaveLength(0);
  });
});

describe("formStateToBatchItem — 内置示例 → 批量条目", () => {
  function exampleById(id: string) {
    const found = ANALYSIS_EXAMPLES.find((e) => e.id === id);
    if (!found) throw new Error(`测试引用了不存在的示例：${id}`);
    return found;
  }

  it("CONDITIONAL：名称取示例标题，条件按「组」转成载荷行", () => {
    const example = exampleById("hold-event-low");
    const item = formStateToBatchItem(applyAnalysisExample(example, null), example.title);

    expect(item.analysisType).toBe("CONDITIONAL");
    expect(item.name).toBe(example.title);
    expect(item.target).toBe("future_return_20d");
    expect(item.conditions).toHaveLength(1);
    expect(item.conditions?.[0]).toMatchObject({
      groupNo: 0,
      sortOrder: 0,
      fieldName: "holds_event_low_5d",
      operator: "==",
      value: 1,
      logicalOperator: "AND",
      groupLogicalOperator: "AND",
    });
  });

  it("不传 nameOverride（或传空白）时退回 suggestAnalysisName，不臆造名字", () => {
    const example = exampleById("hold-event-low");
    const state = applyAnalysisExample(example, null);
    expect(formStateToBatchItem(state).name).toBe(suggestAnalysisName(state));
    expect(formStateToBatchItem(state, "   ").name).toBe(suggestAnalysisName(state));
  });

  it("DESCRIPTIVE：变量进 config，不产出 target 也不产出 conditions", () => {
    const example = exampleById("volume-shape");
    const item = formStateToBatchItem(applyAnalysisExample(example, null), example.title);

    expect(item.analysisType).toBe("DESCRIPTIVE");
    expect(item.config.variables).toEqual([
      "volume_ratio_1d",
      "volume_ratio_2d",
      "volume_ratio_3d",
      "volume_ratio_4d",
      "volume_ratio_5d",
    ]);
    expect(item.target).toBeUndefined();
    expect(item.conditions).toBeUndefined();
  });

  it("SEGMENT_RELATION：四个窗参数进 config（不落 target / conditions）", () => {
    const example = exampleById("segment-drawdown-then-return");
    const item = formStateToBatchItem(applyAnalysisExample(example, { min: 1, max: 20 }), example.title);

    expect(item.config).toMatchObject({
      windowA: [0, 5],
      windowB: [5, 20],
      windowAStat: "max_drawdown",
      windowBStat: "return",
    });
    expect(item.target).toBeUndefined();
  });

  it("每个内置示例都满足服务端批量预检口径（点下去就能建，不是点了才报错）", () => {
    // 镜像断言 server/researchEngine/batchCreate.ts#preflightBatchCreateItems：
    // 名称非空且 ≤200、类型属「已实现子集」、CONDITIONAL 至少一条填好字段的条件。
    for (const example of ANALYSIS_EXAMPLES) {
      const item = formStateToBatchItem(
        applyAnalysisExample(example, { min: 1, max: 20 }),
        example.title,
      );
      expect(item.name.trim(), example.id).not.toBe("");
      expect(item.name.length, example.id).toBeLessThanOrEqual(200);
      expect(IMPLEMENTED_ANALYSIS_TYPES as readonly string[], example.id).toContain(item.analysisType);
      if (item.analysisType === "CONDITIONAL") {
        const usable = (item.conditions ?? []).filter((c) => c.fieldName.trim() !== "");
        expect(usable.length, example.id).toBeGreaterThan(0);
      }
    }
  });

  it("示例标题可直接当模板名（≤120 字符，与库列宽 / 唯一索引口径一致）", () => {
    for (const example of ANALYSIS_EXAMPLES) {
      expect(validateTemplateName(example.title), example.id).toHaveLength(0);
    }
  });

  it("示例载荷过 toBatchCreatePayload 后条件与目标不丢", () => {
    const example = exampleById("tradeable-first-board");
    const [payload] = toBatchCreatePayload([
      formStateToBatchItem(applyAnalysisExample(example, null), example.title),
    ]);
    expect(payload).toMatchObject({
      analysisType: "CONDITIONAL",
      name: example.title,
      target: "future_return_20d",
    });
    expect(payload?.conditions).toHaveLength(1);
  });

  it("缺变量判定按 requiredVariables 走（示例卡据此置灰并写出缺什么）", () => {
    const example = exampleById("hold-event-low");
    // 本测试的 CATALOG 只有 future_return_20d，没有守护变量
    expect(missingVariablesForExample(example, CATALOG)).toEqual(["holds_event_low_5d"]);
    expect(
      missingVariablesForExample(example, {
        features: ["holds_event_low_5d"],
        outcomes: ["future_return_20d"],
      }),
    ).toEqual([]);
  });
});

describe("describeBatchItem — 卡片上那行「实际会写进分析的内容」", () => {
  function itemOf(exampleId: string) {
    const example = ANALYSIS_EXAMPLES.find((e) => e.id === exampleId);
    if (!example) throw new Error(`测试引用了不存在的示例：${exampleId}`);
    return formStateToBatchItem(applyAnalysisExample(example, { min: 1, max: 20 }), example.title);
  }

  it("条件 + 目标变量都看得见", () => {
    expect(describeBatchItem(itemOf("hold-event-low"))).toBe("holds_event_low_5d == 1 · → future_return_20d");
  });

  it("变量多于 3 个时缩略成「首 … 末（共 N 个）」", () => {
    const text = describeBatchItem(itemOf("volume-shape"));
    expect(text).toContain("volume_ratio_1d … volume_ratio_5d（共 5 个）");
  });

  it("分段窗写成人读的 T+ 区间", () => {
    expect(describeBatchItem(itemOf("segment-drawdown-then-return"))).toContain("窗A T+0..T+5 → 窗B T+5..T+20");
  });
});
