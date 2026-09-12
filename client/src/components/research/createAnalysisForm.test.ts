/**
 * createAnalysisForm 测试。
 *
 * 四个「会静默算错」的风险点被单独锁定：
 *   1. 只暴露已实现的 6 类分析（把 IC / DISTRIBUTION 放进下拉框 → 必然 `UNKNOWN_ANALYSIS_TYPE`）；
 *   2. 条件值的类型必须由运算符决定（`BETWEEN` / `IN` / `IS_NULL` 三种形态）；
 *   3. `toAnalysisConfig` 不能把无关键塞进 config（会把后端解析带偏）；
 *   4. **「新建」与「编辑既有条件」共用同一载荷构造器** —— 往返必须幂等，
 *      否则「点开编辑、什么都不改、点保存」就会把库里口径改掉。
 */

import { describe, expect, it } from "vitest";
import {
  ANALYSIS_EXAMPLES,
  ANALYSIS_TYPE_OPTIONS,
  IMPLEMENTED_ANALYSIS_TYPES,
  SEGMENT_STAT_OPTIONS,
  analysisFormRequirements,
  analysisTypeOptionOf,
  applyAnalysisExample,
  availableFutureReturnHorizons,
  conditionGroupsToPayload,
  conditionPayloadToDraftGroups,
  createDefaultAnalysisForm,
  createEmptyConditionGroup,
  defaultSegmentWindows,
  missingVariablesForExample,
  operatorArityOf,
  parseConditionValue,
  parseListValue,
  parseRelativeDay,
  parseScalarValue,
  recommendFeatureField,
  recommendTargetField,
  segmentRelationDescription,
  segmentValueWindow,
  suggestAnalysisName,
  toAnalysisConditions,
  toAnalysisConfig,
  toAnalysisTarget,
  usesExistingVariableFamily,
  validateAnalysisForm,
  validateConditionDraft,
  validateConditionGroups,
  validateSegmentWindows,
  windowDescription,
  windowRangesOverlap,
  windowVariableName,
  type AnalysisConditionInput,
  type AnalysisFormCatalog,
  type ConditionGroupDraft,
  type CreateAnalysisFormState,
} from "./createAnalysisForm";

/** 与真实 Dataset（path 1..20 / outcome {5,10,20}）同构的目录。 */
const CATALOG: AnalysisFormCatalog = {
  features: [
    "turnover",
    "market_cap",
    "float_market_cap",
    "previous_close",
    "limit_up_price",
    "pre_return_5d",
    "days_since_previous_limit",
  ],
  outcomes: [
    "future_return_1d",
    "future_return_3d",
    "future_return_5d",
    "future_return_10d",
    "future_return_20d",
    "max_return_5d",
    "max_drawdown_5d",
    "is_breakout_5d",
  ],
  dimensions: ["year", "month", "quarter", "board", "market", "industry"],
};

function form(overrides: Partial<CreateAnalysisFormState> = {}): CreateAnalysisFormState {
  return { ...createDefaultAnalysisForm("QUANTILE"), ...overrides };
}

describe("createAnalysisForm — 分析类型", () => {
  it("只暴露引擎已实现的 6 类，且不含 IC / DISTRIBUTION", () => {
    expect(IMPLEMENTED_ANALYSIS_TYPES).toHaveLength(6);
    expect(ANALYSIS_TYPE_OPTIONS.map((o) => o.value).sort()).toEqual([
      "CONDITIONAL",
      "DESCRIPTIVE",
      "EVENT_STUDY",
      "QUANTILE",
      "SEGMENT_RELATION",
      "STABILITY",
    ]);
    for (const notImplemented of ["IC", "DISTRIBUTION", "CORRELATION", "PATH", "REGIME", "SIGNIFICANCE"]) {
      expect(IMPLEMENTED_ANALYSIS_TYPES as readonly string[]).not.toContain(notImplemented);
    }
  });

  it("主分析优先级与后端 PRIMARY_PRIORITY 一致（QUANTILE 第一，DESCRIPTIVE 不参与）", () => {
    const byPrimary = ANALYSIS_TYPE_OPTIONS.filter((o) => o.primaryPriority !== null).sort(
      (a, b) => a.primaryPriority! - b.primaryPriority!,
    );
    expect(byPrimary.map((o) => o.value)).toEqual([
      "QUANTILE",
      "CONDITIONAL",
      "EVENT_STUDY",
      "STABILITY",
      "SEGMENT_RELATION",
    ]);
  });

  it("类型名（label）保持短名，问题句（question）另存 —— 名字会进持久化的分析名", () => {
    for (const option of ANALYSIS_TYPE_OPTIONS) {
      // 名字必须是短标识，不能是一句话（否则建议名会变成「某个信号和未来收益有关系吗：…」）
      expect(option.label.length).toBeLessThanOrEqual(8);
      expect(option.label).not.toMatch(/[？?]/);
      expect(option.question.length).toBeGreaterThan(0);
    }
    expect(analysisTypeOptionOf("QUANTILE")?.label).toBe("分位分析");
    expect(analysisTypeOptionOf("SEGMENT_RELATION")?.label).toBe("分段关系");
  });

  it("每类分析的必填项要求互不相同且符合规格", () => {
    expect(analysisFormRequirements("QUANTILE")).toMatchObject({
      needsFeature: true,
      needsTarget: true,
      needsQuantileGroups: true,
      needsVariables: false,
    });
    expect(analysisFormRequirements("DESCRIPTIVE")).toMatchObject({
      needsVariables: true,
      needsFeature: false,
      needsTarget: false,
    });
    expect(analysisFormRequirements("EVENT_STUDY")).toMatchObject({ needsHorizons: true });
    expect(analysisFormRequirements("STABILITY")).toMatchObject({
      needsTarget: true,
      needsDimension: true,
    });
    expect(analysisFormRequirements("CONDITIONAL").requiresConditions).toBe(true);
    expect(analysisFormRequirements("QUANTILE").requiresConditions).toBe(false);
  });

  it("默认表单按类型给不同初始值", () => {
    const q = createDefaultAnalysisForm("QUANTILE");
    expect(q.quantileGroups).toBe("10");
    expect(q.conditions).toEqual([]);

    const c = createDefaultAnalysisForm("CONDITIONAL");
    expect(c.conditions).toHaveLength(1);
    expect(c.conditions[0]!.conditions).toHaveLength(1);

    const s = createDefaultAnalysisForm("STABILITY");
    expect(s.stabilityDimension).toBe("year");
  });
});

describe("createAnalysisForm — 目录推荐", () => {
  it("优先验收案例口径 turnover / future_return_5d", () => {
    expect(recommendTargetField(CATALOG.outcomes)).toBe("future_return_5d");
    expect(recommendFeatureField(CATALOG.features)).toBe("turnover");
  });

  it("没有 5d 时退回任意 future_return_*，仍没有才取第一个；空目录返回空串", () => {
    expect(recommendTargetField(["future_return_20d", "max_return_5d"])).toBe("future_return_20d");
    expect(recommendTargetField(["max_return_5d"])).toBe("max_return_5d");
    expect(recommendTargetField([])).toBe("");
    expect(recommendFeatureField([])).toBe("");
  });

  it("可用视界由目录推导，不硬编码", () => {
    expect(availableFutureReturnHorizons(CATALOG.outcomes)).toEqual([1, 3, 5, 10, 20]);
    expect(availableFutureReturnHorizons(["future_return_5d"])).toEqual([5]);
    expect(availableFutureReturnHorizons([])).toEqual([]);
  });
});

describe("createAnalysisForm — 条件值类型", () => {
  it("运算符元数映射正确", () => {
    expect(operatorArityOf(">")).toBe("ONE");
    expect(operatorArityOf("BETWEEN")).toBe("TWO");
    expect(operatorArityOf("IN")).toBe("LIST");
    expect(operatorArityOf("IS_NULL")).toBe("NONE");
  });

  it("标量解析：数字转 number，文本保留字符串，空串为 null", () => {
    expect(parseScalarValue("12")).toBe(12);
    expect(parseScalarValue(" 3.5 ")).toBe(3.5);
    expect(parseScalarValue("main")).toBe("main");
    expect(parseScalarValue("")).toBeNull();
  });

  it("列表解析兼容中英文逗号与顿号", () => {
    expect(parseListValue("1,2，3、4")).toEqual([1, 2, 3, 4]);
    expect(parseListValue("main, chinext")).toEqual(["main", "chinext"]);
    expect(parseListValue("  ,  ")).toEqual([]);
  });

  it("条件值形态由运算符决定", () => {
    expect(parseConditionValue(">=", "5", "")).toBe(5);
    expect(parseConditionValue("BETWEEN", "1", "10")).toEqual([1, 10]);
    expect(parseConditionValue("IN", "1,2,3", "")).toEqual([1, 2, 3]);
    expect(parseConditionValue("IS_NULL", "", "")).toBeUndefined();
    expect(parseConditionValue("BETWEEN", "1", "")).toBeUndefined();
  });
});

describe("createAnalysisForm — 条件校验", () => {
  const base = { fieldName: "turnover", operator: ">=" as const, value: "5", value2: "", logicalOperator: "AND" as const };

  it("合法条件通过", () => {
    expect(validateConditionDraft(base, CATALOG)).toEqual([]);
  });

  it("空字段名直接返回", () => {
    expect(validateConditionDraft({ ...base, fieldName: "  " }, CATALOG)).toEqual(["请选择条件字段"]);
  });

  it("目录外的字段被拒（防手打不存在的变量）", () => {
    expect(validateConditionDraft({ ...base, fieldName: "future_return_7d" }, CATALOG).join(" ")).toContain(
      "不在当前 Dataset",
    );
  });

  it("缺少比较值 / 区间缺界 / 下界大于上界 / 空列表 都被拦下", () => {
    expect(validateConditionDraft({ ...base, value: "" }, CATALOG).join(" ")).toContain("缺少比较值");
    expect(
      validateConditionDraft({ ...base, operator: "BETWEEN", value: "1", value2: "" }, CATALOG).join(" "),
    ).toContain("需要填写上下界");
    expect(
      validateConditionDraft({ ...base, operator: "BETWEEN", value: "10", value2: "1" }, CATALOG).join(" "),
    ).toContain("恒不成立");
    expect(validateConditionDraft({ ...base, operator: "IN", value: "  " }, CATALOG).join(" ")).toContain(
      "至少一个候选值",
    );
  });

  it("IS_NULL 不需要值", () => {
    expect(
      validateConditionDraft({ ...base, operator: "IS_NULL", value: "" }, CATALOG),
    ).toEqual([]);
  });
});

describe("createAnalysisForm — 表单校验", () => {
  it("QUANTILE 齐备时通过", () => {
    expect(
      validateAnalysisForm(
        form({ name: "换手率十分位", featureField: "turnover", targetField: "future_return_5d" }),
        CATALOG,
      ),
    ).toEqual([]);
  });

  it("QUANTILE 缺名称 / 特征 / 目标 / 分组数 各自报错", () => {
    const errors = validateAnalysisForm(form({ name: " " }), CATALOG);
    expect(errors.join(" ")).toContain("请填写分析名称");
    expect(errors.join(" ")).toContain("请选择特征变量");
    expect(errors.join(" ")).toContain("请选择目标变量");
  });

  it("分组数必须 ≥2 且 ≤100", () => {
    const base = form({ name: "n", featureField: "turnover", targetField: "future_return_5d" });
    expect(validateAnalysisForm({ ...base, quantileGroups: "1" }, CATALOG).join(" ")).toContain("不小于 2");
    expect(validateAnalysisForm({ ...base, quantileGroups: "2.5" }, CATALOG).join(" ")).toContain("整数");
    expect(validateAnalysisForm({ ...base, quantileGroups: "101" }, CATALOG).join(" ")).toContain("不能超过 100");
    expect(validateAnalysisForm({ ...base, quantileGroups: "2" }, CATALOG)).toEqual([]);
  });

  it("目标变量选成特征变量 → PIT 违规被拦", () => {
    // 脏数据场景：目录把某变量同时列进 features 与 outcomes
    const bad: AnalysisFormCatalog = { ...CATALOG, outcomes: [...CATALOG.outcomes, "turnover"] };
    const errors = validateAnalysisForm(
      form({ name: "n", featureField: "turnover", targetField: "turnover" }),
      bad,
    );
    expect(errors.join(" ")).toContain("PIT 违规");
  });

  it("CONDITIONAL 空条件被拒（等于「等于全样本」）", () => {
    const state: CreateAnalysisFormState = {
      ...createDefaultAnalysisForm("CONDITIONAL"),
      name: "换手率条件研究",
      targetField: "future_return_5d",
      // 有一个条件组，但里面是空条件 —— 属于「看起来填了、实际没填」
    };
    expect(validateAnalysisForm(state, CATALOG).join(" ")).toContain("至少需要一个完整可用的条件");
  });

  it("CONDITIONAL 条件存在但字段名未填 → 仍算未填", () => {
    const state: CreateAnalysisFormState = {
      ...createDefaultAnalysisForm("CONDITIONAL"),
      name: "换手率条件研究",
      targetField: "future_return_5d",
      conditions: [
        {
          logicalOperator: "AND",
          conditions: [{ fieldName: "  ", operator: ">=", value: "5", value2: "", logicalOperator: "AND" }],
        },
      ],
    };
    const errors = validateAnalysisForm(state, CATALOG);
    expect(errors.join(" ")).toContain("至少需要一个完整可用的条件");
    expect(errors.join(" ")).toContain("请选择条件字段");
  });

  it("CONDITIONAL 有一个完整条件时通过", () => {
    const state: CreateAnalysisFormState = {
      ...createDefaultAnalysisForm("CONDITIONAL"),
      name: "换手率 ≥5 的条件研究",
      targetField: "future_return_5d",
      conditions: [
        {
          logicalOperator: "AND",
          conditions: [{ fieldName: "turnover", operator: ">=", value: "5", value2: "", logicalOperator: "AND" }],
        },
      ],
    };
    expect(validateAnalysisForm(state, CATALOG)).toEqual([]);
  });

  it("DESCRIPTIVE 未选变量被拒；选了目录外变量也被拒", () => {
    const empty = validateAnalysisForm(createDefaultAnalysisForm("DESCRIPTIVE"), CATALOG);
    expect(empty.join(" ")).toContain("至少选择一个变量");
    const unknown = validateAnalysisForm(
      { ...createDefaultAnalysisForm("DESCRIPTIVE"), name: "描述", variables: ["turnover", "nope"] },
      CATALOG,
    );
    expect(unknown.join(" ")).toContain("nope");
  });

  it("STABILITY 维度必须在可用列表内", () => {
    const bad = validateAnalysisForm(
      { ...createDefaultAnalysisForm("STABILITY"), name: "稳定", targetField: "future_return_5d", stabilityDimension: "regime" },
      CATALOG,
    );
    expect(bad.join(" ")).toContain("regime");
  });

  it("EVENT_STUDY 至少一个视界", () => {
    const errors = validateAnalysisForm(
      { ...createDefaultAnalysisForm("EVENT_STUDY"), name: "事件", horizons: [] },
      CATALOG,
    );
    expect(errors.join(" ")).toContain("至少选择一个视界");
  });
});

describe("createAnalysisForm — payload", () => {
  it("config 只包含该分析类型相关的键", () => {
    const q = toAnalysisConfig(
      form({ name: "n", featureField: "turnover", targetField: "future_return_5d", quantileGroups: "10" }),
    );
    expect(Object.keys(q).sort()).toEqual(["featureField", "quantileGroups", "targetField"]);
    expect(q.quantileGroups).toBe(10);

    const e = toAnalysisConfig({ ...createDefaultAnalysisForm("EVENT_STUDY"), horizons: [5, 1, 10] });
    expect(Object.keys(e)).toEqual(["horizons"]);
    expect(e.horizons).toEqual([1, 5, 10]);

    const d = toAnalysisConfig({
      ...createDefaultAnalysisForm("DESCRIPTIVE"),
      variables: ["turnover", "market_cap"],
    });
    expect(Object.keys(d)).toEqual(["variables"]);
    expect(d.variables).toEqual(["turnover", "market_cap"]);
  });

  it("target 列只在需要目标变量时给出", () => {
    expect(toAnalysisTarget(form({ targetField: "future_return_5d" }))).toBe("future_return_5d");
    expect(toAnalysisTarget(createDefaultAnalysisForm("EVENT_STUDY"))).toBeUndefined();
  });

  it("条件行：groupNo / sortOrder / 连接符 正确，空字段被跳过且组号重排为连续", () => {
    const state: CreateAnalysisFormState = {
      ...createDefaultAnalysisForm("CONDITIONAL"),
      conditions: [
        // 整组没填 —— 它不该占组号，否则载荷缺 groupNo=0 会被后端
        // `assertConditionSet` 以「条件组号不连续，缺少 0」拒掉
        createEmptyConditionGroup(),
        {
          logicalOperator: "OR",
          conditions: [
            { fieldName: "turnover", operator: ">=", value: "5", value2: "", logicalOperator: "AND" },
            { fieldName: "board", operator: "==", value: "main", value2: "", logicalOperator: "OR" },
            { fieldName: "", operator: ">", value: "1", value2: "", logicalOperator: "AND" },
          ],
        },
      ],
    };
    const rows = toAnalysisConditions(state);
    expect(rows).toHaveLength(2);
    // 空组被丢弃后，唯一的有效组重排为 groupNo 0（组号连续）
    expect(rows.map((r) => r.groupNo)).toEqual([0, 0]);
    expect(rows[0]).toMatchObject({
      groupNo: 0,
      sortOrder: 0,
      fieldName: "turnover",
      operator: ">=",
      value: 5,
      logicalOperator: "AND",
      groupLogicalOperator: "OR",
    });
    expect(rows[1]).toMatchObject({
      groupNo: 0,
      sortOrder: 1,
      fieldName: "board",
      operator: "==",
      value: "main",
      logicalOperator: "OR",
    });
  });

  it("IS_NULL 条件发送 value=null（键必须存在，省略会被 tRPC 入参校验拒绝）", () => {
    const rows = toAnalysisConditions({
      ...createDefaultAnalysisForm("CONDITIONAL"),
      conditions: [
        {
          logicalOperator: "AND",
          conditions: [{ fieldName: "market_cap", operator: "IS_NULL", value: "", value2: "", logicalOperator: "AND" }],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect("value" in rows[0]!).toBe(true);
    expect(rows[0]!.value).toBeNull();
  });
});

describe("createAnalysisForm — 建议名称", () => {
  it("明确写出用了哪些变量，不生成含糊名称", () => {
    expect(
      suggestAnalysisName(form({ featureField: "turnover", targetField: "future_return_5d", quantileGroups: "10" })),
    ).toBe("分位分析：turnover 分 10 组 → future_return_5d");
    expect(suggestAnalysisName(form({ featureField: "" }))).toBe("分位分析");
    expect(
      suggestAnalysisName({ ...createDefaultAnalysisForm("EVENT_STUDY"), horizons: [5, 10] }),
    ).toBe("事件研究：T+5 / T+10");
    expect(
      suggestAnalysisName({ ...createDefaultAnalysisForm("STABILITY"), stabilityDimension: "board" }),
    ).toBe("稳定性分析：按 board 分组");
  });
});

// ---------------------------------------------------------------------------
// 条件载荷往返 —— 「新建分析」与「编辑既有条件」共用同一构造器
// ---------------------------------------------------------------------------

/** 覆盖全部值形态：标量数字、标量字符串、区间、列表、无值。 */
const DRAFTS: ConditionGroupDraft[] = [
  {
    logicalOperator: "AND",
    conditions: [
      { fieldName: "turnover", operator: ">=", value: "5", value2: "", logicalOperator: "AND" },
      { fieldName: "board", operator: "==", value: "main", value2: "", logicalOperator: "OR" },
    ],
  },
  {
    logicalOperator: "OR",
    conditions: [
      {
        fieldName: "market_cap",
        operator: "BETWEEN",
        value: "1000000000",
        value2: "50000000000",
        logicalOperator: "AND",
      },
      { fieldName: "market_cap", operator: "IS_NULL", value: "", value2: "", logicalOperator: "AND" },
      { fieldName: "industry", operator: "IN", value: "电子,计算机,通信", value2: "", logicalOperator: "NOT" },
    ],
  },
];

describe("createAnalysisForm — 条件载荷往返", () => {
  it("编号规则：组号 0 基、组内序号紧凑，空字段名行被跳过且不占位", () => {
    const rows = conditionGroupsToPayload([
      {
        logicalOperator: "AND",
        conditions: [
          { fieldName: "turnover", operator: ">=", value: "5", value2: "", logicalOperator: "AND" },
          // 中间夹一条「看起来填了、实际没填」的行：它不该把后面那条挤到 sortOrder=2
          { fieldName: "   ", operator: ">=", value: "1", value2: "", logicalOperator: "AND" },
          { fieldName: "board", operator: "==", value: "main", value2: "", logicalOperator: "AND" },
        ],
      },
      {
        logicalOperator: "OR",
        conditions: [
          { fieldName: "market_cap", operator: "IS_NOT_NULL", value: "", value2: "", logicalOperator: "AND" },
        ],
      },
    ]);
    expect(rows.map((r) => [r.groupNo, r.sortOrder, r.fieldName])).toEqual([
      [0, 0, "turnover"],
      [0, 1, "board"],
      [1, 0, "market_cap"],
    ]);
  });

  it("BETWEEN / IN / IS_NULL 的领域值形态正确，且 value 键必须存在", () => {
    const rows = conditionGroupsToPayload(DRAFTS);
    const pick = (field: string, op: string) =>
      rows.find((r) => r.fieldName === field && r.operator === op)!;

    expect(pick("market_cap", "BETWEEN").value).toEqual([1000000000, 50000000000]);
    expect(pick("industry", "IN").value).toEqual(["电子", "计算机", "通信"]);
    expect(pick("turnover", ">=").value).toBe(5);
    expect(pick("board", "==").value).toBe("main");

    const isNull = pick("market_cap", "IS_NULL");
    expect("value" in isNull).toBe(true); // 显式 null，不是省略键（省略会被 tRPC 拒掉）
    expect(isNull.value).toBeNull();

    expect(pick("industry", "IN").groupLogicalOperator).toBe("OR");
    expect(pick("industry", "IN").logicalOperator).toBe("NOT");
  });

  it("往返幂等：草稿 → 载荷 → 回填草稿 → 载荷，两次载荷逐字段一致", () => {
    const first = conditionGroupsToPayload(DRAFTS);
    const refilled = conditionPayloadToDraftGroups(first);
    const second = conditionGroupsToPayload(refilled);
    expect(second).toEqual(first);
  });

  it("回填保留组间 / 组内连接符，并按 groupNo、sortOrder 升序整理乱序输入", () => {
    // 真实库里 SELECT 出来的行序不保证有序
    const shuffled: AnalysisConditionInput[] = [
      { groupNo: 1, sortOrder: 1, fieldName: "board", operator: "==", value: "main", logicalOperator: "OR", groupLogicalOperator: "OR" },
      { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 5, logicalOperator: "AND", groupLogicalOperator: "AND" },
      { groupNo: 1, sortOrder: 0, fieldName: "market_cap", operator: ">", value: 1_000_000_000, logicalOperator: "AND", groupLogicalOperator: "OR" },
    ];
    const groups = conditionPayloadToDraftGroups(shuffled);
    expect(groups.map((g) => g.logicalOperator)).toEqual(["AND", "OR"]);
    expect(groups[0]!.conditions.map((c) => c.fieldName)).toEqual(["turnover"]);
    expect(groups[1]!.conditions.map((c) => c.fieldName)).toEqual(["market_cap", "board"]);
    expect(groups[1]!.conditions[1]!.logicalOperator).toBe("OR");
  });

  it("组内 sortOrder 有空洞时会被压紧，但相对顺序不变", () => {
    const sparse: AnalysisConditionInput[] = [
      { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 5, logicalOperator: "AND", groupLogicalOperator: "AND" },
      { groupNo: 0, sortOrder: 7, fieldName: "board", operator: "==", value: "main", logicalOperator: "AND", groupLogicalOperator: "AND" },
    ];
    const rows = conditionGroupsToPayload(conditionPayloadToDraftGroups(sparse));
    expect(rows.map((r) => [r.sortOrder, r.fieldName])).toEqual([
      [0, "turnover"],
      [1, "board"],
    ]);
  });

  it("空行列表回填为 []（不臆造一个空组）", () => {
    expect(conditionPayloadToDraftGroups([])).toEqual([]);
  });

  it("组号必须连续 0..n-1：中间夹空组也要重排（否则后端 assertConditionSet 拒收）", () => {
    const rows = conditionGroupsToPayload([
      {
        logicalOperator: "AND",
        conditions: [
          { fieldName: "turnover", operator: ">=", value: "5", value2: "", logicalOperator: "AND" },
        ],
      },
      // 整组未填 —— 若按草稿下标编号，下一组会变成 groupNo=2 而缺 1
      { logicalOperator: "OR", conditions: [{ fieldName: "", operator: ">", value: "1", value2: "", logicalOperator: "AND" }] },
      {
        logicalOperator: "OR",
        conditions: [
          { fieldName: "board", operator: "==", value: "main", value2: "", logicalOperator: "AND" },
        ],
      },
    ]);
    expect(rows.map((r) => r.groupNo)).toEqual([0, 1]);
    expect(rows.map((r) => r.fieldName)).toEqual(["turnover", "board"]);
    // 组号连续性的通用判据：去重排序后必须等于 0..n-1
    const distinct = [...new Set(rows.map((r) => r.groupNo))].sort((a, b) => a - b);
    expect(distinct).toEqual(distinct.map((_, i) => i));
  });

  it("全为空组 → 载荷为空数组（不产出任何行，也不报错）", () => {
    expect(conditionGroupsToPayload([createEmptyConditionGroup(), createEmptyConditionGroup()])).toEqual([]);
  });

  it("往返是「数值稳定」而非「文本稳定」：5.0 → 5、1e9 → 1000000000", () => {
    const rows = conditionGroupsToPayload([
      {
        logicalOperator: "AND",
        conditions: [
          { fieldName: "turnover", operator: ">", value: "5.0", value2: "", logicalOperator: "AND" },
          { fieldName: "market_cap", operator: ">", value: "1e9", value2: "", logicalOperator: "AND" },
        ],
      },
    ]);
    const back = conditionPayloadToDraftGroups(rows);
    expect(back[0]!.conditions.map((c) => c.value)).toEqual(["5", "1000000000"]);
    // 唯一真正重要的保证：再存一次不会改变口径
    expect(conditionGroupsToPayload(back)).toEqual(rows);
  });
});

describe("createAnalysisForm — 条件组校验（新建与编辑共用）", () => {
  it("没有任何可落库条件 → 明确拒绝，并给出替代做法", () => {
    const errors = validateConditionGroups([createEmptyConditionGroup()], CATALOG);
    expect(errors.join(" ")).toContain("至少要有一条填好字段的条件");
    expect(errors.join(" ")).toContain("删除分析或重建分析");
  });

  it("逐条错误带「第 N 组第 M 条」定位（组号 1 基）", () => {
    const errors = validateConditionGroups(
      [
        {
          logicalOperator: "AND",
          conditions: [
            { fieldName: "turnover", operator: ">=", value: "5", value2: "", logicalOperator: "AND" },
          ],
        },
        {
          logicalOperator: "AND",
          conditions: [
            { fieldName: "future_return_7d", operator: ">", value: "1", value2: "", logicalOperator: "AND" },
            { fieldName: "market_cap", operator: "BETWEEN", value: "10", value2: "1", logicalOperator: "AND" },
          ],
        },
      ],
      CATALOG,
    );
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toContain(
      '第 2 组第 1 条：条件字段 "future_return_7d" 不在当前 Dataset 的变量目录中',
    );
    expect(errors.join(" ")).toContain("第 2 组第 2 条：条件「market_cap 介于」的下界大于上界，该条件恒不成立");
  });

  it("空字段名的行不会被静默忽略，而是同样被点名", () => {
    const errors = validateConditionGroups([createEmptyConditionGroup()], CATALOG);
    expect(errors.some((e) => e.includes("第 1 组第 1 条：请选择条件字段"))).toBe(true);
  });

  it("合法条件组（含维度字段）→ 无错误", () => {
    // board / industry 来自 dimensions，不是 features —— 必须同样被认可
    expect(validateConditionGroups(DRAFTS, CATALOG)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 分段窗（SEGMENT_RELATION）
//
// 前端这一层是**镜像**：它让用户在提交前就看到重叠/越界，而不是白等一次服务端往返，
// 但权威判定在后端。因此这里的重点是「镜像与后端同式」，而不是「前端拦得住一切」。
// ---------------------------------------------------------------------------

describe("createAnalysisForm — 分段窗", () => {
  const RANGE = { min: 1, max: 20 };

  function segmentForm(overrides: Partial<CreateAnalysisFormState> = {}): CreateAnalysisFormState {
    return { ...createDefaultAnalysisForm("SEGMENT_RELATION"), ...overrides };
  }

  it("镜像与后端同式：取值区间、重叠判定、变量命名都对得上", () => {
    // 与 server/researchEngine/variables.ts 的 segmentValueWindow 同值
    expect(segmentValueWindow(0, 5)).toEqual([1, 5]);
    expect(segmentValueWindow(5, 20)).toEqual([6, 20]);
    // 与后端 rangesOverlap 同值：紧邻不算重叠，相交必须判重叠
    expect(windowRangesOverlap(segmentValueWindow(0, 5), segmentValueWindow(5, 20))).toBe(false);
    expect(windowRangesOverlap(segmentValueWindow(0, 10), segmentValueWindow(5, 20))).toBe(true);
    // 与后端 windowOutcomeVariableName 同值：from = 0 复用既有族
    expect(windowVariableName("return", 0, 5)).toBe("future_return_5d");
    expect(windowVariableName("max_drawdown", 0, 5)).toBe("max_drawdown_5d");
    expect(windowVariableName("return", 5, 20)).toBe("segment_return_5_20d");
    expect(windowVariableName("max_drawdown", 5, 20)).toBe("segment_max_drawdown_5_20d");
    expect(usesExistingVariableFamily("0")).toBe(true);
    expect(usesExistingVariableFamily("1")).toBe(false);
  });

  it("默认窗 = 紧邻的两段（锚在 T 的 5 日 + 之后 15 日），且可用范围越窄越保守", () => {
    expect(defaultSegmentWindows(RANGE)).toEqual({ aFrom: "0", aTo: "5", bFrom: "5", bTo: "20" });
    // path 视界只有 1..6 时不能给出 T+5 → T+20（那个窗根本不存在）
    expect(defaultSegmentWindows({ min: 1, max: 6 })).toEqual({ aFrom: "0", aTo: "5", bFrom: "5", bTo: "6" });
    // 没有 path 数据：仍给出保守默认，由校验去报「不可用」
    expect(defaultSegmentWindows(null).bTo).toBe("20");
  });

  it("相对日只认整数（不把 5.6 悄悄变成 6，也不接受空白）", () => {
    expect(parseRelativeDay("5")).toBe(5);
    expect(parseRelativeDay(" 12 ")).toBe(12);
    expect(parseRelativeDay("0")).toBe(0);
    expect(parseRelativeDay("5.6")).toBeNull();
    expect(parseRelativeDay("-1")).toBeNull();
    expect(parseRelativeDay("")).toBeNull();
  });

  it("校验覆盖四项：形态 / 止大于起 / 越界 / 重叠", () => {
    expect(validateSegmentWindows(segmentForm(), RANGE)).toEqual([]);
    expect(validateSegmentWindows(segmentForm({ windowATo: "x" }), RANGE).join(" ")).toContain("必须是整数");
    expect(validateSegmentWindows(segmentForm({ windowATo: "0", windowAFrom: "5" }), RANGE).join(" ")).toContain(
      "止必须大于起",
    );
    expect(validateSegmentWindows(segmentForm({ windowBTo: "25" }), RANGE).join(" ")).toContain("超出");
    const overlap = validateSegmentWindows(segmentForm({ windowATo: "10" }), RANGE).join(" ");
    expect(overlap).toContain("重叠");
    expect(overlap).toContain("T+1..T+10");
    expect(overlap).toContain("T+6..T+20");
    // 没有 path 范围时无法判越界，但重叠仍要判
    expect(validateSegmentWindows(segmentForm(), null)).toEqual([]);
  });

  it("分档数必须是 2..100 的整数", () => {
    for (const bands of ["1", "0", "101", "2.5", ""]) {
      expect(validateSegmentWindows(segmentForm({ windowBands: bands }), RANGE).join(" ")).toContain("分档数");
    }
  });

  it("payload 带上五个窗字段，且把分档数与相对日转成数字", () => {
    expect(toAnalysisConfig(segmentForm())).toEqual({
      windowA: [0, 5],
      windowB: [5, 20],
      windowAStat: "max_drawdown",
      windowBStat: "return",
      windowBands: 5,
    });
    // 非 SEGMENT_RELATION 的类型不许把窗字段塞进 config（会把后端解析带偏）
    expect(toAnalysisConfig(createDefaultAnalysisForm("QUANTILE"))).not.toHaveProperty("windowA");
  });

  it("建议名与描述用人话写出两个窗，并显示映射到的真实变量", () => {
    const form = segmentForm();
    expect(suggestAnalysisName(form)).toContain("分段关系");
    // 窗 A 锚在事件日收盘 ⇒ 描述里必须是「T（事件日收盘）」而不是一个含糊的 T+0
    expect(windowDescription(form, "A")).toBe("T（事件日收盘）..T+5 最大跌幅");
    expect(windowDescription(form, "B")).toBe("T+5..T+20 分段收益");
    expect(segmentRelationDescription(form)).toContain("→");
    // 窗 B 一侧锚在 T+5，必须能看出来它不是 future_return_20d
    expect(windowVariableName(form.windowBStat, 5, 20)).toBe("segment_return_5_20d");
    expect(SEGMENT_STAT_OPTIONS.map((o) => o.value)).toEqual([
      "return",
      "max_return",
      "min_return",
      "max_drawdown",
    ]);
  });

  it("新建 SEGMENT_RELATION 时默认不带条件（窗参数才是它的必填项）", () => {
    expect(createDefaultAnalysisForm("SEGMENT_RELATION").conditions).toEqual([]);
    expect(analysisFormRequirements("SEGMENT_RELATION")).toMatchObject({
      needsSegmentWindows: true,
      needsFeature: false,
      needsTarget: false,
      canHaveConditions: true,
      requiresConditions: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 内置示例（「从例子开始」）
//
// 这类示例的价值全在**点一下就能跑**上：如果套用完还要用户自己修校验错误，
// 那它比不给还糟（把人从「不知道配什么」变成「以为配好了但跑了报错」）。
// 因此下面的关键断言是「示例直接通过 validateAnalysisForm」。
// ---------------------------------------------------------------------------

describe("createAnalysisForm — 内置示例", () => {
  /** 「目录齐全」的假 catalog：示例应全部可用；另需一个「缺变量」目录验证禁用逻辑。 */
  const FULL_CATALOG: AnalysisFormCatalog = {
    features: [
      "turnover",
      "previous_close",
      "is_one_word_open",
      "is_one_word_hold",
      "event_low_offset",
      "event_open_offset",
    ],
    outcomes: [
      "future_return_1d",
      "future_return_5d",
      "future_return_10d",
      "future_return_20d",
      "holds_event_low_5d",
      "holds_event_low_close_5d",
      "event_low_margin_5d",
      "volume_ratio_1d",
      "volume_ratio_2d",
      "volume_ratio_3d",
      "volume_ratio_4d",
      "volume_ratio_5d",
    ],
    dimensions: ["year", "month", "quarter", "board", "market", "industry"],
    segmentRange: { min: 1, max: 20 },
  };

  it("示例 id 唯一，且都带了标题 / 说明 / 关键变量（没有「只有参数没有理由」的卡）", () => {
    expect(ANALYSIS_EXAMPLES.length).toBeGreaterThanOrEqual(5);
    const ids = new Set<string>();
    for (const example of ANALYSIS_EXAMPLES) {
      expect(ids.has(example.id), `示例 id 重复：${example.id}`).toBe(false);
      ids.add(example.id);
      expect(example.title.length, example.id).toBeGreaterThan(4);
      expect(example.story.length, example.id).toBeGreaterThan(20);
      expect(example.requiredVariables.length, example.id).toBeGreaterThan(0);
    }
  });

  it("目录齐全 ⇒ 全部可用；缺关键变量 ⇒ 精确报出缺哪些", () => {
    for (const example of ANALYSIS_EXAMPLES) {
      expect(missingVariablesForExample(example, FULL_CATALOG), example.id).toEqual([]);
    }
    const lean = { features: ["turnover"], outcomes: ["future_return_5d"] };
    const hold = ANALYSIS_EXAMPLES.find((e) => e.id === "hold-event-low")!;
    expect(missingVariablesForExample(hold, lean)).toEqual([
      "holds_event_low_5d",
      "future_return_20d",
    ]);
  });

  it("套用示例后表单**直接通过校验**（不是「点了还要自己修」）", () => {
    for (const example of ANALYSIS_EXAMPLES) {
      const form = applyAnalysisExample(example, FULL_CATALOG.segmentRange ?? null);
      // 名称刻意不预填（见下一条用例），此处补一个名字，只为校验「参数是否配全」
      const errors = validateAnalysisForm({ ...form, name: `示例：${example.id}` }, FULL_CATALOG);
      expect(errors, `${example.id}: ${errors.join(" / ")}`).toEqual([]);
    }
  });

  it("套用示例不预填分析名（让建议名按最终参数生成，避免名实不符）", () => {
    for (const example of ANALYSIS_EXAMPLES) {
      expect(applyAnalysisExample(example, null).name, example.id).toBe("");
    }
  });

  it("CONDITIONAL 示例：条件与目标落到表单，且不把 SEGMENT 专用字段写进 config", () => {
    const hold = ANALYSIS_EXAMPLES.find((e) => e.id === "hold-event-low")!;
    const form = applyAnalysisExample(hold, FULL_CATALOG.segmentRange ?? null);
    expect(form.analysisType).toBe("CONDITIONAL");
    expect(form.targetField).toBe("future_return_20d");
    expect(form.conditions).toHaveLength(1);
    expect(form.conditions[0]!.conditions[0]).toMatchObject({
      fieldName: "holds_event_low_5d",
      operator: "==",
      value: "1",
    });
    const config = toAnalysisConfig(form);
    expect(config).not.toHaveProperty("windowA");
    expect(config).not.toHaveProperty("featureField");
  });

  it("量能示例用的是**结果**侧条件（量比要 T+1 收盘才可观测，不能当分组特征）", () => {
    const volume = ANALYSIS_EXAMPLES.find((e) => e.id === "pullback-volume")!;
    // 量比变量出现在 outcomes 而不是 features —— 这是 PIT 正确的用法
    expect(FULL_CATALOG.outcomes).toContain("volume_ratio_1d");
    expect(FULL_CATALOG.features).not.toContain("volume_ratio_1d");
    const form = applyAnalysisExample(volume, null);
    expect(form.analysisType).toBe("CONDITIONAL");
    expect(form.featureField).toBe("");
    expect(form.conditions[0]!.conditions[0]).toMatchObject({
      fieldName: "volume_ratio_1d",
      operator: "<",
    });
  });

  it("分段窗示例按真实视界钳制：上界不足时既不留越界窗、也不留非法窗", () => {
    const seg = ANALYSIS_EXAMPLES.find((e) => e.id === "segment-drawdown-then-return")!;
    // path 只到 10 ⇒ bTo 20 必须被钳到 10，且仍满足 from < to
    const clamped = applyAnalysisExample(seg, { min: 1, max: 10 });
    expect(Number(clamped.windowBTo)).toBe(10);
    expect(Number(clamped.windowBFrom)).toBeLessThan(Number(clamped.windowBTo));
    expect(
      validateAnalysisForm(
        { ...clamped, name: "钳制校验" },
        { ...FULL_CATALOG, segmentRange: { min: 1, max: 10 } },
      ),
    ).toEqual([]);

    // 上界小到装不下「起 5」时，退回按真实视界生成的默认窗
    const tiny = applyAnalysisExample(seg, { min: 1, max: 5 });
    expect(Number(tiny.windowBTo)).toBeGreaterThan(Number(tiny.windowBFrom));
    expect(
      validateAnalysisForm(
        { ...tiny, name: "回退校验" },
        { ...FULL_CATALOG, segmentRange: { min: 1, max: 5 } },
      ),
    ).toEqual([]);
  });

  it("描述统计示例：变量清单完整落到表单", () => {
    const shape = ANALYSIS_EXAMPLES.find((e) => e.id === "volume-shape")!;
    const form = applyAnalysisExample(shape, null);
    expect(form.analysisType).toBe("DESCRIPTIVE");
    expect(form.variables).toEqual([
      "volume_ratio_1d",
      "volume_ratio_2d",
      "volume_ratio_3d",
      "volume_ratio_4d",
      "volume_ratio_5d",
    ]);
  });
});
