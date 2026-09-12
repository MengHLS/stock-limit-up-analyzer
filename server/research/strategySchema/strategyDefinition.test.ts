/**
 * STRATEGY-003 — StrategyDefinition 领域模型测试（纯内存 fixture，无 DB）。
 *
 * 覆盖（SPEC §36 / §十二 要求）：
 *   A. Golden Sample「首板回踩」可被新 Domain Model 完整表达（SPEC §25）；
 *   B. Definition 序列化 / 反序列化 round-trip + 篡改拒绝；
 *   C. Definition 指纹：同定义 → 同 Hash；任一实质字段变 → Hash 变（entry / exit / parameter /
 *      position / risk / execution / dataset 逐项参数化）；
 *   D. 结构校验：非法 schemaVersion / 窗口 / 操作符 / 执行规则 / 参数 / 出场规则；
 *   E. **Look-Ahead 静态校验**（SPEC §28 / §十一）：标签层引用、超窗前视引用、未知时间域、
 *      默认拒绝白名单、时序一致性、价格类型与成交时点一致性；
 *   F. Canonical definition 与 v1 派生视图的一致性闸门（冲突即响亮失败，不静默覆盖）；
 *   G. clone 到指定版本：Definition 完整复制、视图重新派生、指纹重算；
 *   H. 字段引用解析与信号时间线（唯一权威实现的行为固化）。
 */

import { describe, expect, it } from "vitest";
import { canonicalStringify } from "../../researchDataset/version";
import { ResearchValidationError } from "../experimentValidation";
import {
  cloneStrategyDocumentToVersion,
  computeStrategyDefinitionFingerprint,
  createStrategyDefinition,
  createStrategyDocument,
  createStrategyDocumentFromDefinition,
  deriveLegacyViews,
  deserializeStrategyDocument,
  normalizeStrategyDefinition,
  parseStrategyFieldReference,
  resolveSignalTimeline,
  serializeStrategyDefinition,
  serializeStrategyDocument,
  validateCanonicalStrategyDefinition,
  validateStrategyDocument,
  type ConditionDefinition,
  type StrategyDefinitionInput,
} from "./index";
import {
  FIRST_BOARD_PULLBACK_DATASET_VERSION,
  FIRST_BOARD_PULLBACK_DEFINITION,
  FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
} from "./goldenSample";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 以 Golden Sample 为基线构造变体（每次深拷贝，避免测试间互相污染）。 */
function makeDefinition(overrides: Partial<StrategyDefinitionInput> = {}): StrategyDefinitionInput {
  return structuredClone({ ...FIRST_BOARD_PULLBACK_DEFINITION, ...overrides });
}

/** 替换 entry.conditions（用于条件类用例）。 */
function withConditions(conditions: readonly ConditionDefinition[]): StrategyDefinitionInput {
  const base = makeDefinition();
  return { ...base, entry: { ...base.entry, conditions } };
}

/** 替换 entry 的窗口 / 触发（Look-Ahead 用例）。 */
function withEntryWindow(
  window: { start: number; end: number; unit: "TRADING_DAY" | "CALENDAR_DAY" },
  trigger: "FIRST_VALID_DAY" | "LAST_VALID_DAY" | "EVERY_VALID_DAY" | "NEXT_TRADING_DAY",
): StrategyDefinitionInput {
  const base = makeDefinition();
  return { ...base, entry: { ...base.entry, observationWindow: window, trigger: { type: trigger } } };
}

/** 替换 execution（时序用例）。 */
function withExecution(execution: StrategyDefinitionInput["execution"]): StrategyDefinitionInput {
  return makeDefinition({ execution });
}

const GOLDEN_DOCUMENT = createStrategyDocumentFromDefinition(FIRST_BOARD_PULLBACK_DOCUMENT_INPUT);

// ---------------------------------------------------------------------------
// A. Golden Sample — 新 Domain Model 真能表达「首板回踩」
// ---------------------------------------------------------------------------

describe("A. Golden Sample 首板回踩（SPEC §25）", () => {
  it("组装成功且文档通过全量校验", () => {
    expect(GOLDEN_DOCUMENT.strategyId).toBe("first-board-pullback");
    expect(GOLDEN_DOCUMENT.version).toBe("1.0.0");
    expect(validateStrategyDocument(GOLDEN_DOCUMENT).valid).toBe(true);
  });

  it("Canonical definition 完整保留 Entry / Exit / Position / Risk / Execution / Parameters", () => {
    const definition = GOLDEN_DOCUMENT.definition;
    expect(definition).toBeDefined();
    expect(definition?.schemaVersion).toBe("1.0");
    expect(definition?.entry.event.type).toBe("FIRST_LIMIT_UP");
    expect(definition?.entry.observationWindow).toEqual({ start: 1, end: 5, unit: "TRADING_DAY" });
    expect(definition?.entry.trigger.type).toBe("FIRST_VALID_DAY");
    expect(definition?.exit.rules.map((rule) => rule.type)).toEqual(["TIME_EXIT", "STOP_LOSS", "TAKE_PROFIT"]);
    expect(definition?.position.sizingMethod).toBe("FIXED_RATIO");
    expect(definition?.risk.maxPositions).toBe(5);
    expect(definition?.execution.signalTiming).toBe("T_CLOSE");
    expect(definition?.execution.executionTiming).toBe("T_PLUS_1_OPEN");
    expect(definition?.parameters).toHaveLength(6);
    expect(definition?.datasets).toHaveLength(1);
  });

  it("v1 兼容视图由 Canonical definition 自动派生（调用方无需手工保持一致）", () => {
    expect(GOLDEN_DOCUMENT.entryRules).toHaveLength(2);
    expect(GOLDEN_DOCUMENT.entryRules[0]?.field).toBe("bar.low");
    expect(GOLDEN_DOCUMENT.entryRules[0]?.operator).toBe(">=");
    expect(GOLDEN_DOCUMENT.entryRules[0]?.operand).toBe("prefix.rd0.open");
    expect(GOLDEN_DOCUMENT.exitRules.map((rule) => rule.id)).toEqual(["holding-days", "stop-loss", "take-profit"]);
    expect(GOLDEN_DOCUMENT.riskRules.map((rule) => rule.id)).toEqual([
      "risk.maxPositions",
      "risk.maxSinglePosition",
      "risk.maxExposure",
      "risk.stopLoss",
    ]);
    // positionRatio 由参数 defaultValue(0.2) 解析为 fixed-fraction 比例
    expect(GOLDEN_DOCUMENT.positionSizing).toEqual({ kind: "fixed-fraction", fraction: 0.2, maxPositions: 5 });
    expect(GOLDEN_DOCUMENT.parameters.parameters.map((item) => item.name)).toEqual([
      "holdingDays",
      "limitUpThreshold",
      "positionRatio",
      "pullbackWindow",
      "stopLoss",
      "takeProfit",
    ]);
    expect(GOLDEN_DOCUMENT.executionAssumptions.executionModel).toBe("NEXT_OPEN");
    expect(GOLDEN_DOCUMENT.datasetVersion).toBe(FIRST_BOARD_PULLBACK_DATASET_VERSION);
  });

  it("参数角色区分 TUNABLE 与 FIXED（未来 Parameter Search 的筛选键已就位，本任务不实现搜索）", () => {
    const definition = createStrategyDefinition(FIRST_BOARD_PULLBACK_DEFINITION);
    const tunable = definition.parameters.filter((item) => item.parameterRole === "TUNABLE").map((item) => item.code);
    const fixed = definition.parameters.filter((item) => item.parameterRole === "FIXED").map((item) => item.code);
    expect(tunable).toEqual(["holdingDays", "positionRatio", "pullbackWindow", "stopLoss", "takeProfit"]);
    expect(fixed).toEqual(["limitUpThreshold"]);
  });
});

// ---------------------------------------------------------------------------
// B. 序列化 / 反序列化
// ---------------------------------------------------------------------------

describe("B. Definition 序列化 / 反序列化", () => {
  it("canonical 序列化 round-trip 保持内容一致", () => {
    const definition = createStrategyDefinition(FIRST_BOARD_PULLBACK_DEFINITION);
    const json = serializeStrategyDefinition(definition);
    const reparsed = JSON.parse(json) as unknown;
    expect(canonicalStringify(reparsed)).toBe(canonicalStringify(definition));
  });

  it("文档 round-trip（含 definition）内容一致", () => {
    const json = serializeStrategyDocument(GOLDEN_DOCUMENT);
    const restored = deserializeStrategyDocument(json);
    expect(canonicalStringify(restored)).toBe(canonicalStringify(GOLDEN_DOCUMENT));
    expect(restored.definition?.entry.trigger.type).toBe("FIRST_VALID_DAY");
  });

  it("文档被篡改（改 definition 中的一个数字）→ 反序列化响亮失败", () => {
    const json = serializeStrategyDocument(GOLDEN_DOCUMENT);
    const tampered = json.replace('"maxPositions":5', '"maxPositions":6');
    expect(tampered).not.toBe(json);
    expect(() => deserializeStrategyDocument(tampered)).toThrow(ResearchValidationError);
  });

  it("无 definition 的历史 v1 文档仍然可通过校验（向后兼容）", () => {
    const legacy = createStrategyDocument({
      strategyId: "legacy-v1",
      version: "1.0.0",
      name: "遗留 v1 策略",
      universe: { universeId: `research-dataset:${FIRST_BOARD_PULLBACK_DATASET_VERSION}` },
      entryRules: [{ id: "r1", kind: "threshold", description: "回踩不破首板开盘价" }],
      exitRules: [{ id: "x1", kind: "time-based", description: "持有 3 日退出" }],
      positionSizing: { kind: "fixed-fraction", fraction: 0.2, maxPositions: 5 },
      riskRules: [{ id: "k1", kind: "state", description: "最多 5 仓" }],
      parameters: {
        parameters: [{ name: "holdingDays", type: "number", required: true, defaultValue: 3 }],
      },
      datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION,
      executionAssumptions: GOLDEN_DOCUMENT.executionAssumptions,
      metadata: { author: "legacy" },
    });
    expect(legacy.definition).toBeUndefined();
    expect(validateStrategyDocument(legacy).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. 指纹（SPEC §九 / §29）
// ---------------------------------------------------------------------------

describe("C. StrategyDefinition 指纹", () => {
  it("同 Definition → 同 Hash（多次独立构造结果一致）", () => {
    const a = computeStrategyDefinitionFingerprint(createStrategyDefinition(FIRST_BOARD_PULLBACK_DEFINITION));
    const b = computeStrategyDefinitionFingerprint(createStrategyDefinition(structuredClone(FIRST_BOARD_PULLBACK_DEFINITION)));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("参数数组顺序不同（语义相同）→ 规范化后同 Hash", () => {
    const base = makeDefinition();
    const shuffled = makeDefinition({ parameters: [...base.parameters].reverse() });
    expect(canonicalStringify(normalizeStrategyDefinition(shuffled))).toBe(canonicalStringify(normalizeStrategyDefinition(base)));
    expect(computeStrategyDefinitionFingerprint(createStrategyDefinition(shuffled)))
      .toBe(computeStrategyDefinitionFingerprint(createStrategyDefinition(base)));
  });

  it("dataset 绑定顺序不同（语义相同）→ 同 Hash", () => {
    const base = makeDefinition({
      datasets: [
        { datasetId: "ds_b", datasetVersion: "rd-1.0.0-1-0123456789abcdef", role: "OOS" },
        { datasetId: "ds_a", datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION, role: "PRIMARY" },
      ],
    });
    const reordered = makeDefinition({
      datasets: [...base.datasets].reverse(),
    });
    expect(computeStrategyDefinitionFingerprint(createStrategyDefinition(base)))
      .toBe(computeStrategyDefinitionFingerprint(createStrategyDefinition(reordered)));
  });

  const mutations: Array<{ name: string; mutate: () => StrategyDefinitionInput }> = [
    {
      name: "entry（条件右值）",
      mutate: () => withConditions([{ ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!, value: "prefix.rd0.close" }]),
    },
    {
      name: "entry（窗口）",
      mutate: () => withEntryWindow({ start: 1, end: 4, unit: "TRADING_DAY" }, "FIRST_VALID_DAY"),
    },
    {
      name: "exit（规则阈值优先级）",
      mutate: () => {
        const base = makeDefinition();
        return {
          ...base,
          exit: {
            rules: base.exit.rules.map((rule, index) => (index === 0 ? { ...rule, priority: 9 } : rule)),
          },
        };
      },
    },
    {
      name: "parameter（defaultValue）",
      mutate: () => {
        const base = makeDefinition();
        return {
          ...base,
          parameters: base.parameters.map((item) => (item.code === "holdingDays" ? { ...item, defaultValue: 5 } : item)),
        };
      },
    },
    {
      name: "position（maxPositions）",
      mutate: () => {
        const base = makeDefinition();
        return { ...base, position: { ...base.position, maxPositions: 4 } };
      },
    },
    {
      name: "risk（maxExposure）",
      mutate: () => {
        const base = makeDefinition();
        return { ...base, risk: { ...base.risk, maxExposure: 0.7 } };
      },
    },
    {
      name: "execution（成交时点）",
      mutate: () => withExecution({ ...makeDefinition().execution, executionTiming: "T_PLUS_1_CLOSE", priceType: "CLOSE" }),
    },
    {
      name: "dataset 绑定",
      mutate: () => makeDefinition({
        datasets: [{ datasetId: "ds_first_limit_pullback", datasetVersion: "rd-1.0.0-1-0123456789abcdef", role: "PRIMARY" }],
      }),
    },
  ];

  it.each(mutations)("实质改动「$name」→ Hash 必须变化", ({ mutate }) => {
    const baseFingerprint = computeStrategyDefinitionFingerprint(createStrategyDefinition(makeDefinition()));
    expect(computeStrategyDefinitionFingerprint(createStrategyDefinition(mutate()))).not.toBe(baseFingerprint);
  });

  it("Document 指纹与 Definition 指纹是两个层级（改身份不改定义 → Document 指纹变、Definition 指纹不变）", () => {
    const renamed = createStrategyDocumentFromDefinition({
      ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
      name: "首板回踩（改名）",
    });
    expect(renamed.fingerprint).not.toBe(GOLDEN_DOCUMENT.fingerprint);
    expect(computeStrategyDefinitionFingerprint(renamed.definition!))
      .toBe(computeStrategyDefinitionFingerprint(GOLDEN_DOCUMENT.definition!));
  });
});

// ---------------------------------------------------------------------------
// D. 结构校验
// ---------------------------------------------------------------------------

describe("D. 结构校验", () => {
  const cases: Array<{ name: string; definition: StrategyDefinitionInput; code: string }> = [
    {
      name: "schemaVersion 不在白名单",
      definition: makeDefinition({ schemaVersion: "2.0" }),
      code: "SCHEMA_DEFINITION_SCHEMA_VERSION_INVALID",
    },
    {
      name: "观察窗口 start = 0",
      definition: withEntryWindow({ start: 0, end: 5, unit: "TRADING_DAY" }, "FIRST_VALID_DAY"),
      code: "SCHEMA_DEFINITION_ENTRY_WINDOW_INVALID",
    },
    {
      name: "观察窗口 start > end",
      definition: withEntryWindow({ start: 5, end: 1, unit: "TRADING_DAY" }, "FIRST_VALID_DAY"),
      code: "SCHEMA_DEFINITION_ENTRY_WINDOW_INVALID",
    },
    {
      name: "窗口单位非法",
      definition: withEntryWindow({ start: 1, end: 5, unit: "HOUR" as never }, "FIRST_VALID_DAY"),
      code: "SCHEMA_DEFINITION_ENTRY_WINDOW_UNIT_INVALID",
    },
    {
      name: "trigger 非法",
      definition: withEntryWindow({ start: 1, end: 5, unit: "TRADING_DAY" }, "SOMEDAY" as never),
      code: "SCHEMA_DEFINITION_ENTRY_TRIGGER_TYPE_INVALID",
    },
    {
      name: "事件类型非法",
      definition: makeDefinition({ entry: { ...makeDefinition().entry, event: { type: "MOON_PHASE" as never } } }),
      code: "SCHEMA_DEFINITION_ENTRY_EVENT_TYPE_INVALID",
    },
    {
      name: "条件操作符非法",
      definition: withConditions([{ ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!, operator: "APPROXIMATELY" as never }]),
      code: "SCHEMA_DEFINITION_CONDITION_OPERATOR_INVALID",
    },
    {
      name: "条件右值类型非法",
      definition: withConditions([{ ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!, valueType: "MAGIC" as never }]),
      code: "SCHEMA_DEFINITION_CONDITION_VALUE_TYPE_INVALID",
    },
    {
      name: "条件右值引用不存在的参数",
      definition: withConditions([{
        ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!,
        value: "notDeclaredParam",
        valueType: "PARAMETER_REFERENCE",
      }]),
      code: "SCHEMA_DEFINITION_CONDITION_PARAMETER_UNKNOWN",
    },
    {
      name: "IN 操作符右值必须是数组",
      definition: withConditions([{
        ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!,
        operator: "IN",
        value: 1,
        valueType: "CONSTANT",
      }]),
      code: "SCHEMA_DEFINITION_CONDITION_VALUE_INVALID",
    },
    {
      name: "出场规则 priority 重复",
      definition: (() => {
        const base = makeDefinition();
        return { ...base, exit: { rules: base.exit.rules.map((rule) => ({ ...rule, priority: 1 })) } };
      })(),
      code: "SCHEMA_DEFINITION_EXIT_RULE_PRIORITY_DUPLICATE",
    },
    {
      name: "出场规则 threshold 与 parameter 都没有",
      definition: (() => {
        const base = makeDefinition();
        return {
          ...base,
          exit: {
            rules: [{
              id: "bare",
              type: "STOP_LOSS",
              trigger: "INTRADAY",
              priority: 1,
              enabled: true,
            }],
          },
        };
      })(),
      code: "SCHEMA_DEFINITION_EXIT_THRESHOLD_REQUIRED",
    },
    {
      name: "threshold 与 parameter 同时声明（两个真值来源）",
      definition: (() => {
        const base = makeDefinition();
        return {
          ...base,
          exit: {
            rules: [{
              id: "both",
              type: "STOP_LOSS",
              trigger: "INTRADAY",
              threshold: 0.05,
              thresholdUnit: "RATIO",
              parameter: "stopLoss",
              priority: 1,
              enabled: true,
            }],
          },
        };
      })(),
      code: "SCHEMA_DEFINITION_EXIT_THRESHOLD_AMBIGUOUS",
    },
    {
      // 阈值来自 parameter 时同样需要 thresholdUnit（阈值「值」与「单位」是两回事）。
      name: "以 parameter 表达阈值但缺 thresholdUnit",
      definition: (() => {
        const base = makeDefinition();
        return {
          ...base,
          exit: {
            rules: [{
              id: "param-no-unit",
              type: "STOP_LOSS",
              trigger: "INTRADAY",
              parameter: "stopLoss",
              priority: 1,
              enabled: true,
            }],
          },
        };
      })(),
      code: "SCHEMA_DEFINITION_EXIT_THRESHOLD_UNIT_INVALID",
    },
    {
      // 悬挂 thresholdUnit：既无 threshold 也无 parameter，单位声明无意义。
      name: "悬挂 thresholdUnit（无 threshold 且无 parameter）",
      definition: (() => {
        const base = makeDefinition();
        return {
          ...base,
          exit: {
            rules: [{
              id: "dangling-unit",
              type: "STOP_LOSS",
              trigger: "INTRADAY",
              thresholdUnit: "RATIO",
              priority: 1,
              enabled: true,
            }],
          },
        };
      })(),
      code: "SCHEMA_DEFINITION_EXIT_THRESHOLD_UNIT_INVALID",
    },
    {
      name: "TIME_EXIT 持有天数 <= 0",
      definition: (() => {
        const base = makeDefinition();
        return {
          ...base,
          exit: {
            rules: [{
              id: "time",
              type: "TIME_EXIT",
              trigger: "ON_CLOSE",
              threshold: -1,
              thresholdUnit: "TRADING_DAY",
              priority: 1,
              enabled: true,
            }],
          },
        };
      })(),
      code: "SCHEMA_DEFINITION_EXIT_HOLDING_DAYS_INVALID",
    },
    {
      name: "出场规则引用不存在的参数",
      definition: (() => {
        const base = makeDefinition();
        return {
          ...base,
          exit: {
            rules: [{
              id: "time",
              type: "TIME_EXIT",
              trigger: "ON_CLOSE",
              parameter: "nope",
              thresholdUnit: "TRADING_DAY",
              priority: 1,
              enabled: true,
            }],
          },
        };
      })(),
      code: "SCHEMA_DEFINITION_EXIT_PARAMETER_UNKNOWN",
    },
    {
      name: "lotSize <= 0",
      definition: withExecution({ ...makeDefinition().execution, lotSize: 0 }),
      code: "SCHEMA_DEFINITION_EXECUTION_LOT_SIZE_INVALID",
    },
    {
      name: "signalTiming 非法",
      definition: withExecution({ ...makeDefinition().execution, signalTiming: "T_MID" as never }),
      code: "SCHEMA_DEFINITION_EXECUTION_SIGNAL_TIMING_INVALID",
    },
    {
      name: "executionTiming 非法",
      definition: withExecution({ ...makeDefinition().execution, executionTiming: "T_PLUS_3_OPEN" as never }),
      code: "SCHEMA_DEFINITION_EXECUTION_TIMING_INVALID",
    },
    {
      name: "参数 code 重复",
      definition: (() => {
        const base = makeDefinition();
        return { ...base, parameters: [...base.parameters, { ...base.parameters[0]! }] };
      })(),
      code: "SCHEMA_DEFINITION_PARAMETER_CODE_DUPLICATE",
    },
    {
      name: "TUNABLE 缺少 min/max",
      definition: (() => {
        const base = makeDefinition();
        return {
          ...base,
          parameters: base.parameters.map((item) =>
            item.code === "holdingDays" ? { code: item.code, name: item.name, dataType: item.dataType, parameterRole: item.parameterRole, defaultValue: item.defaultValue, required: item.required } : item),
        };
      })(),
      code: "SCHEMA_DEFINITION_PARAMETER_ROLE_TUNABLE_RANGE",
    },
    {
      name: "DERIVED 缺少 derivedFrom",
      definition: (() => {
        const base = makeDefinition();
        return {
          ...base,
          parameters: [...base.parameters, {
            code: "halfExposure",
            name: "半仓暴露",
            dataType: "number",
            parameterRole: "DERIVED",
            required: false,
          }],
        };
      })(),
      code: "SCHEMA_DEFINITION_PARAMETER_DERIVED_SOURCE",
    },
    {
      name: "parameterRole 非法",
      definition: (() => {
        const base = makeDefinition();
        return {
          ...base,
          parameters: base.parameters.map((item) => (item.code === "holdingDays" ? { ...item, parameterRole: "OPTIMIZE" as never } : item)),
        };
      })(),
      code: "SCHEMA_DEFINITION_PARAMETER_ROLE_INVALID",
    },
    {
      name: "step <= 0",
      definition: (() => {
        const base = makeDefinition();
        return {
          ...base,
          parameters: base.parameters.map((item) => (item.code === "holdingDays" ? { ...item, step: 0 } : item)),
        };
      })(),
      code: "SCHEMA_DEFINITION_PARAMETER_STEP_INVALID",
    },
    {
      name: "defaultValue 越界（委托既有参数校验器）",
      definition: (() => {
        const base = makeDefinition();
        return {
          ...base,
          parameters: base.parameters.map((item) => (item.code === "holdingDays" ? { ...item, defaultValue: 999 } : item)),
        };
      })(),
      code: "VALUE_ABOVE_MAX",
    },
    {
      name: "FIXED_RATIO 既无 positionRatio 也无 parameter",
      definition: (() => {
        const base = makeDefinition();
        return { ...base, position: { sizingMethod: "FIXED_RATIO", maxPositions: 5 } };
      })(),
      code: "SCHEMA_DEFINITION_POSITION_RATIO_INVALID",
    },
    {
      name: "position 引用不存在的参数",
      definition: (() => {
        const base = makeDefinition();
        return { ...base, position: { ...base.position, parameter: "nope" } };
      })(),
      code: "SCHEMA_DEFINITION_POSITION_PARAMETER_UNKNOWN",
    },
    {
      name: "risk 比例 > 1",
      definition: (() => {
        const base = makeDefinition();
        return { ...base, risk: { ...base.risk, maxExposure: 1.2 } };
      })(),
      code: "SCHEMA_DEFINITION_RATIO_INVALID",
    },
    {
      name: "dataset role 非法",
      definition: makeDefinition({
        datasets: [{ datasetId: "d", datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION, role: "TEST" as never }],
      }),
      code: "SCHEMA_DEFINITION_DATASET_ROLE_INVALID",
    },
    {
      name: "datasetVersion 非 rd-… 格式",
      definition: makeDefinition({
        datasets: [{ datasetId: "d", datasetVersion: "latest", role: "PRIMARY" }],
      }),
      code: "SCHEMA_DEFINITION_DATASET_VERSION_INVALID",
    },
    {
      name: "多于一个 PRIMARY 绑定",
      definition: makeDefinition({
        datasets: [
          { datasetId: "d1", datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION, role: "PRIMARY" },
          { datasetId: "d2", datasetVersion: "rd-1.0.0-1-0123456789abcdef", role: "PRIMARY" },
        ],
      }),
      code: "SCHEMA_DEFINITION_DATASET_PRIMARY_DUPLICATE",
    },
    {
      name: "datasetVersionId 不是正整数（STRATEGY-004 坐标形态）",
      definition: makeDefinition({
        datasets: [{ datasetId: "first_limit_pullback", datasetVersion: "v2", datasetVersionId: 0, role: "PRIMARY" }],
      }),
      code: "SCHEMA_DEFINITION_DATASET_VERSION_ID_INVALID",
    },
    {
      name: "提供 datasetVersionId 但 datasetVersion 是 rd-… 串（label 缺失）",
      definition: makeDefinition({
        datasets: [{
          datasetId: "first_limit_pullback",
          datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION,
          datasetVersionId: 390002,
          role: "PRIMARY",
        }],
      }),
      code: "SCHEMA_DEFINITION_DATASET_VERSION_INVALID",
    },
  ];

  it.each(cases)("$name → $code", ({ definition, code }) => {
    const validation = validateCanonicalStrategyDefinition(createStrategyDefinitionUnchecked(definition));
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((item) => item.code)).toContain(code);
  });

  it("委托既有参数校验器时保留其错误码，但把路径重映射到 definition.parameters.*（根相对）", () => {
    const base = makeDefinition();
    const outOfRange = {
      ...base,
      parameters: base.parameters.map((item) => (item.code === "holdingDays" ? { ...item, defaultValue: 999 } : item)),
    };
    const result = validateCanonicalStrategyDefinition(createStrategyDefinitionUnchecked(outOfRange));
    expect(result.valid).toBe(false);
    const delegated = result.issues.find((item) => item.code === "VALUE_ABOVE_MAX");
    expect(delegated).toBeDefined();
    // 委托校验器的原生根是 parameterSchema.*，必须被重映射为 parameters.*；
    // 不得保留 parameterSchema 前缀（否则消费方按 definition 路径定位不到）。
    expect(delegated?.path.startsWith("parameters.")).toBe(true);
    expect(delegated?.path.includes("parameterSchema")).toBe(false);
  });

  it("校验器 issue.path 一律根相对（不含 `definition.` 前缀），避免嵌入文档时被前缀两次", () => {
    const broken = makeDefinition({
      datasets: [{ datasetId: "d", datasetVersion: "latest", role: "PRIMARY" }],
    });
    const result = validateCanonicalStrategyDefinition(createStrategyDefinitionUnchecked(broken));
    expect(result.issues.length).toBeGreaterThan(0);
    for (const item of result.issues) {
      expect(item.path.startsWith("definition.")).toBe(false);
    }
  });

  it("规范化的合法 Golden Sample 零 issue（不误报）", () => {
    const validation = validateCanonicalStrategyDefinition(createStrategyDefinition(FIRST_BOARD_PULLBACK_DEFINITION));
    expect(validation.issues).toEqual([]);
    expect(validation.valid).toBe(true);
  });
});

/**
 * STRATEGY-004 — Dataset 绑定坐标（`datasetVersionId` 权威 + label 快照 + legacy rd-… 兼容）。
 *
 * 本组只覆盖**形态与派生**（纯函数）；「存在 / READY / datasetId 一致」的引用完整性
 * 由 `strategyPersistence/datasetBindingValidation.test.ts` 以端口 + 真实库脚本覆盖。
 */
describe("D2. Dataset 绑定坐标（STRATEGY-004）", () => {
  const COORDINATE_BINDING = {
    datasetId: "first_limit_pullback",
    datasetVersion: "v2",
    datasetVersionId: 390002,
    role: "PRIMARY" as const,
  };

  it("Dataset Registry 坐标合法：datasetVersionId 正整数 + label 形态 → 零 issue", () => {
    const validation = validateCanonicalStrategyDefinition(
      normalizeStrategyDefinition(makeDefinition({ datasets: [COORDINATE_BINDING] })),
    );
    expect(validation.issues).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("legacy 兼容分支保留：datasetVersionId 缺省 + rd-… → 仍是合法的（不因新坐标而失效）", () => {
    const validation = validateCanonicalStrategyDefinition(
      normalizeStrategyDefinition(makeDefinition({
        datasets: [{ datasetId: "ds_first_limit_pullback", datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION, role: "PRIMARY" }],
      })),
    );
    expect(validation.issues).toEqual([]);
  });

  it("坐标参与定义指纹：换 datasetVersionId → 指纹变（同一 label 也必须是不同定义）", () => {
    const definitionOf = (datasetVersionId: number) => createStrategyDefinition(
      makeDefinition({ datasets: [{ ...COORDINATE_BINDING, datasetVersionId }] }),
    );
    expect(computeStrategyDefinitionFingerprint(definitionOf(390002)))
      .not.toBe(computeStrategyDefinitionFingerprint(definitionOf(390003)));
  });

  it("绑定去重键含坐标：同 (datasetId, label, role) 但坐标不同 → 不算重复", () => {
    const validation = validateCanonicalStrategyDefinition(
      normalizeStrategyDefinition(makeDefinition({
        datasets: [
          { ...COORDINATE_BINDING, role: "VALIDATION", datasetVersionId: 390001, datasetVersion: "v1" },
          { ...COORDINATE_BINDING, role: "OOS", datasetVersionId: 390002, datasetVersion: "v2" },
        ],
      })),
    );
    expect(validation.issues.map((item) => item.code))
      .not.toContain("SCHEMA_DEFINITION_DATASET_BINDING_DUPLICATE");
  });

  it("规范化：datasets 排序含坐标作为最终 tie-break（角色/标识/label 全同时顺序稳定）", () => {
    const normalized = normalizeStrategyDefinition(makeDefinition({
      datasets: [
        { datasetId: "d", datasetVersion: "v1", datasetVersionId: 390002, role: "OOS" },
        { datasetId: "d", datasetVersion: "v1", datasetVersionId: 390001, role: "OOS" },
      ],
    }));
    expect(normalized.datasets.map((item) => item.datasetVersionId)).toEqual([390001, 390002]);
  });

  it("doc 级 datasetVersionId 由 definition 的 PRIMARY 绑定单向派生（缺省时自动补齐）", () => {
    const doc = createStrategyDocumentFromDefinition({
      strategyId: "coordinate-derive",
      version: "1.0.0",
      name: "坐标派生",
      universe: { universeId: `research-dataset:${COORDINATE_BINDING.datasetVersion}` },
      definition: makeDefinition({ datasets: [COORDINATE_BINDING] }),
      executionAssumptions: {
        backtestConfig: { initialCapital: 100000 },
        costModel: structuredClone(FIRST_BOARD_PULLBACK_DOCUMENT_INPUT.executionAssumptions.costModel),
      },
    });
    expect((doc as { datasetVersionId?: number }).datasetVersionId).toBe(390002);
    expect(doc.datasetVersion).toBe("v2");
  });

  it("doc 级 datasetVersionId 与 PRIMARY 绑定不一致 → 响亮拒绝（不静默覆盖）", () => {
    expect(() => createStrategyDocument({
      ...structuredClone(FIRST_BOARD_PULLBACK_DOCUMENT_INPUT) as unknown as Record<string, unknown>,
      strategyId: "coordinate-conflict",
      universe: { universeId: `research-dataset:${COORDINATE_BINDING.datasetVersion}` },
      definition: makeDefinition({ datasets: [COORDINATE_BINDING] }),
      datasetVersion: "v2",
      datasetVersionId: 390001,
    } as never)).toThrow(ResearchValidationError);
  });

  it("PRIMARY 绑定走 legacy 分支却声明了 doc 级坐标 → 响亮拒绝", () => {
    expect(() => createStrategyDocument({
      ...structuredClone(FIRST_BOARD_PULLBACK_DOCUMENT_INPUT) as unknown as Record<string, unknown>,
      strategyId: "coordinate-legacy-conflict",
      universe: { universeId: `research-dataset:${FIRST_BOARD_PULLBACK_DATASET_VERSION}` },
      definition: makeDefinition({
        datasets: [{ datasetId: "ds_first_limit_pullback", datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION, role: "PRIMARY" }],
      }),
      datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION,
      datasetVersionId: 390002,
    } as never)).toThrow(ResearchValidationError);
  });
});


/**
 * 用规范化（不改语义）后的定义跑校验，避免「窗口/参数顺序」等与用例无关的差异干扰断言。
 * 不走 createStrategyDefinition（那会因非法定义抛错）——校验用例要的是 issue 列表。
 */
function createStrategyDefinitionUnchecked(input: StrategyDefinitionInput): ReturnType<typeof normalizeStrategyDefinition> {
  return normalizeStrategyDefinition(input);
}

// ---------------------------------------------------------------------------
// E. Look-Ahead 静态校验（SPEC §28 / §十一 / §十二）
// ---------------------------------------------------------------------------

describe("E. Look-Ahead 静态校验", () => {
  const codes = (definition: StrategyDefinitionInput): string[] =>
    validateCanonicalStrategyDefinition(normalizeStrategyDefinition(definition)).issues.map((item) => item.code);

  it("引用 outcome 标签层 → INVALID_FUTURE_REFERENCE", () => {
    expect(codes(withConditions([{
      ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!,
      value: "outcome.return5",
      valueType: "FIELD_REFERENCE",
    }]))).toContain("INVALID_FUTURE_REFERENCE");
  });

  it("引用 path 标签层（Dataset 明示『前视，仅打标签』）→ INVALID_FUTURE_REFERENCE", () => {
    expect(codes(withConditions([{
      ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!,
      value: "path.rd1.ma5",
      valueType: "FIELD_REFERENCE",
    }]))).toContain("INVALID_FUTURE_REFERENCE");
  });

  it("左值本身引用标签层同样被拒", () => {
    expect(codes(withConditions([{
      ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!,
      field: "outcome.return5",
    }]))).toContain("INVALID_FUTURE_REFERENCE");
  });

  it("FIRST_VALID_DAY + 窗口 T+1..T+5：引用 post.rd3 → 超窗前视，拒绝", () => {
    expect(codes(withConditions([{
      ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!,
      value: "post.rd3.high",
      valueType: "FIELD_REFERENCE",
    }]))).toContain("INVALID_FUTURE_REFERENCE");
  });

  it("FIRST_VALID_DAY + 窗口 T+1..T+5：引用 post.rd1 合法（= 最早可能信号偏移）", () => {
    const issues = validateCanonicalStrategyDefinition(normalizeStrategyDefinition(withConditions([{
      ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!,
      value: "post.rd1.high",
      valueType: "FIELD_REFERENCE",
    }]))).issues;
    expect(issues).toEqual([]);
  });

  it("LAST_VALID_DAY 放宽到 windowEnd：窗口 T+1..T+5 时 post.rd5 合法、post.rd6 非法", () => {
    const ok = withEntryWindow({ start: 1, end: 5, unit: "TRADING_DAY" }, "LAST_VALID_DAY");
    const withRd5 = {
      ...ok,
      entry: { ...ok.entry, conditions: [{ ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!, value: "post.rd5.high", valueType: "FIELD_REFERENCE" as const }] },
    };
    expect(codes(withRd5)).toEqual([]);
    const withRd6 = {
      ...ok,
      entry: { ...ok.entry, conditions: [{ ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!, value: "post.rd6.high", valueType: "FIELD_REFERENCE" as const }] },
    };
    expect(codes(withRd6)).toContain("INVALID_FUTURE_REFERENCE");
  });

  it("NEXT_TRADING_DAY 再顺延一日：窗口 T+1..T+5 时 post.rd2 合法、post.rd3 非法", () => {
    const base = withEntryWindow({ start: 1, end: 5, unit: "TRADING_DAY" }, "NEXT_TRADING_DAY");
    const rd2 = {
      ...base,
      entry: { ...base.entry, conditions: [{ ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!, value: "post.rd2.high", valueType: "FIELD_REFERENCE" as const }] },
    };
    expect(codes(rd2)).toEqual([]);
    const rd3 = {
      ...base,
      entry: { ...base.entry, conditions: [{ ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!, value: "post.rd3.high", valueType: "FIELD_REFERENCE" as const }] },
    };
    expect(codes(rd3)).toContain("INVALID_FUTURE_REFERENCE");
  });

  it("自然日窗口无法映射交易日坐标系 → 前视引用报 SIGNAL_TIMELINE_UNRESOLVABLE", () => {
    const base = withEntryWindow({ start: 1, end: 5, unit: "CALENDAR_DAY" }, "FIRST_VALID_DAY");
    const definition = {
      ...base,
      entry: { ...base.entry, conditions: [{ ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!, value: "post.rd1.high", valueType: "FIELD_REFERENCE" as const }] },
    };
    expect(codes(definition)).toContain("SIGNAL_TIMELINE_UNRESOLVABLE");
  });

  it("未知时间域（无法判定）→ UNKNOWN_FIELD_TIME_DOMAIN（默认拒绝，而非黑名单放过）", () => {
    expect(codes(withConditions([{
      ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!,
      value: "futureReturn5",
      valueType: "FIELD_REFERENCE",
    }]))).toContain("UNKNOWN_FIELD_TIME_DOMAIN");
  });

  it("时间域可判定但字段不在白名单 → UNKNOWN_FIELD_REFERENCE", () => {
    expect(codes(withConditions([{
      ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!,
      field: "bar.nonexistent",
    }]))).toContain("UNKNOWN_FIELD_REFERENCE");
  });

  it("事件层拼写错误（不存在字段）→ UNKNOWN_FIELD_REFERENCE", () => {
    expect(codes(withConditions([{
      ...FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions[0]!,
      field: "event.openingPrice",
    }]))).toContain("UNKNOWN_FIELD_REFERENCE");
  });

  it("signalTiming = T_CLOSE 且 executionTiming = T_CLOSE → SIGNAL_EXECUTION_TIMING_CONFLICT", () => {
    expect(codes(withExecution({
      ...makeDefinition().execution,
      signalTiming: "T_CLOSE",
      executionTiming: "T_CLOSE",
      priceType: "CLOSE",
    }))).toContain("SIGNAL_EXECUTION_TIMING_CONFLICT");
  });

  it("trigger = NEXT_TRADING_DAY 与同 bar 成交 T_CLOSE 不一致 → TRIGGER_EXECUTION_INCONSISTENT", () => {
    const base = withEntryWindow({ start: 1, end: 5, unit: "TRADING_DAY" }, "NEXT_TRADING_DAY");
    expect(codes({
      ...base,
      execution: { ...base.execution, signalTiming: "T_OPEN", executionTiming: "T_CLOSE", priceType: "CLOSE" },
    })).toContain("TRIGGER_EXECUTION_INCONSISTENT");
  });

  it("priceType 与 executionTiming 的开关盘语义不一致 → PRICE_TYPE_TIMING_MISMATCH", () => {
    expect(codes(withExecution({
      ...makeDefinition().execution,
      executionTiming: "T_PLUS_1_OPEN",
      priceType: "CLOSE",
    }))).toContain("PRICE_TYPE_TIMING_MISMATCH");
  });

  it("VWAP 作为代理价在任意成交时点均被允许", () => {
    expect(codes(withExecution({
      ...makeDefinition().execution,
      executionTiming: "T_PLUS_1_OPEN",
      priceType: "VWAP",
    }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F. Canonical definition 与 v1 视图的一致性闸门
// ---------------------------------------------------------------------------

describe("F. Canonical definition ↔ v1 派生视图一致性", () => {
  const documentInput = (extra: Record<string, unknown>): Record<string, unknown> => ({
    strategyId: "view-check",
    version: "1.0.0",
    name: "视图一致性",
    universe: { universeId: `research-dataset:${FIRST_BOARD_PULLBACK_DATASET_VERSION}` },
    definition: structuredClone(FIRST_BOARD_PULLBACK_DEFINITION),
    datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION,
    executionAssumptions: structuredClone(GOLDEN_DOCUMENT.executionAssumptions),
    ...extra,
  });

  it("调用方显式给出与派生结果不一致的 entryRules → SCHEMA_DEFINITION_VIEW_CONFLICT", () => {
    let caught: ResearchValidationError | undefined;
    try {
      createStrategyDocument(documentInput({
        entryRules: [{ id: "wrong", kind: "state", description: "与 definition 不符" }],
      }) as never);
    } catch (error) {
      caught = error as ResearchValidationError;
    }
    expect(caught).toBeInstanceOf(ResearchValidationError);
    expect(caught?.issues.map((item) => item.code)).toContain("SCHEMA_DEFINITION_VIEW_CONFLICT");
  });

  it("调用方显式给出与派生结果一致的视图 → 通过（视图只是冗余，不构成第二 SoT）", () => {
    const derived = deriveLegacyViews(createStrategyDefinition(FIRST_BOARD_PULLBACK_DEFINITION));
    const doc = createStrategyDocument(documentInput({
      entryRules: derived.entryRules,
      exitRules: derived.exitRules,
      riskRules: derived.riskRules,
      positionSizing: derived.positionSizing,
      parameters: derived.parameters,
    }) as never);
    expect(doc.definition?.entry.trigger.type).toBe("FIRST_VALID_DAY");
  });

  it("datasetVersion 与 PRIMARY 绑定不一致 → SCHEMA_DEFINITION_DATASET_VERSION_MISMATCH", () => {
    let caught: ResearchValidationError | undefined;
    try {
      createStrategyDocument(documentInput({ datasetVersion: "rd-1.0.0-1-0123456789abcdef" }) as never);
    } catch (error) {
      caught = error as ResearchValidationError;
    }
    expect(caught?.issues.map((item) => item.code)).toContain("SCHEMA_DEFINITION_DATASET_VERSION_MISMATCH");
  });

  it("缺少 executionAssumptions 的 costModel/backtestConfig → 响亮要求显式提供", () => {
    const input = documentInput({});
    delete (input as Record<string, unknown>).executionAssumptions;
    let caught: ResearchValidationError | undefined;
    try {
      createStrategyDocument(input as never);
    } catch (error) {
      caught = error as ResearchValidationError;
    }
    expect(caught?.issues.map((item) => item.code)).toContain("SCHEMA_DEFINITION_EXECUTION_ASSUMPTIONS_REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// G. Clone 到指定版本
// ---------------------------------------------------------------------------

describe("G. cloneStrategyDocumentToVersion", () => {
  it("Definition 完整复制（含参数 / 规则 / dataset 绑定），版本号与指纹重算", () => {
    const cloned = cloneStrategyDocumentToVersion(GOLDEN_DOCUMENT, "2.0.0");
    expect(cloned.version).toBe("2.0.0");
    expect(cloned.strategyId).toBe(GOLDEN_DOCUMENT.strategyId);
    expect(canonicalStringify(cloned.definition)).toBe(canonicalStringify(GOLDEN_DOCUMENT.definition));
    expect(cloned.fingerprint).not.toBe(GOLDEN_DOCUMENT.fingerprint);
    expect(cloned.entryRules).toHaveLength(GOLDEN_DOCUMENT.entryRules.length);
    expect(cloned.exitRules).toHaveLength(GOLDEN_DOCUMENT.exitRules.length);
    expect(cloned.datasetVersion).toBe(GOLDEN_DOCUMENT.datasetVersion);
  });

  it("历史 v1 文档（无 definition）clone 时 v1 字段原样复制", () => {
    const legacy = createStrategyDocument({
      strategyId: "legacy-clone",
      version: "1.0.0",
      name: "遗留",
      universe: { universeId: `research-dataset:${FIRST_BOARD_PULLBACK_DATASET_VERSION}` },
      entryRules: [{ id: "r1", kind: "threshold", description: "仅声明" }],
      exitRules: [],
      positionSizing: { kind: "equal-weight", maxPositions: 3 },
      riskRules: [],
      parameters: { parameters: [] },
      datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION,
      executionAssumptions: GOLDEN_DOCUMENT.executionAssumptions,
    });
    const cloned = cloneStrategyDocumentToVersion(legacy, "1.1.0");
    expect(cloned.definition).toBeUndefined();
    expect(cloned.entryRules).toHaveLength(1);
    expect(cloned.positionSizing).toEqual({ kind: "equal-weight", maxPositions: 3 });
  });
});

// ---------------------------------------------------------------------------
// H. 字段引用解析 / 信号时间线（唯一权威实现的行为固化）
// ---------------------------------------------------------------------------

describe("H. 字段引用解析与信号时间线", () => {
  it("parseStrategyFieldReference 覆盖全部合法前缀并拒绝未知形态", () => {
    expect(parseStrategyFieldReference("prefix.rd0.open")).toEqual({ kind: "preEvent", relativeDay: 0, field: "open" });
    expect(parseStrategyFieldReference("prefix.rd-3.low")).toEqual({ kind: "preEvent", relativeDay: -3, field: "low" });
    expect(parseStrategyFieldReference("post.rd2.high")).toEqual({ kind: "forwardBar", relativeDay: 2, field: "high" });
    expect(parseStrategyFieldReference("event.limitUpPrice")).toEqual({ kind: "eventDay", field: "limitUpPrice" });
    expect(parseStrategyFieldReference("bar.volume")).toEqual({ kind: "currentBar", field: "volume" });
    expect(parseStrategyFieldReference("path.rd1.ma5")).toEqual({ kind: "labelOnly", root: "path", field: "rd1.ma5" });
    expect(parseStrategyFieldReference("outcome.return5")).toEqual({ kind: "labelOnly", root: "outcome", field: "return5" });
    expect(parseStrategyFieldReference("futureReturn")).toEqual({ kind: "unknown", raw: "futureReturn" });
    expect(parseStrategyFieldReference("")).toEqual({ kind: "unknown", raw: "" });
  });

  it("resolveSignalTimeline：最早信号偏移由 trigger 决定", () => {
    const window = { start: 1, end: 5, unit: "TRADING_DAY" as const };
    expect(resolveSignalTimeline("FIRST_VALID_DAY", window).earliestSignalOffset).toBe(1);
    expect(resolveSignalTimeline("EVERY_VALID_DAY", window).earliestSignalOffset).toBe(1);
    expect(resolveSignalTimeline("LAST_VALID_DAY", window).earliestSignalOffset).toBe(5);
    expect(resolveSignalTimeline("NEXT_TRADING_DAY", window).earliestSignalOffset).toBe(2);
    expect(resolveSignalTimeline("FIRST_VALID_DAY", { ...window, unit: "CALENDAR_DAY" }).resolvable).toBe(false);
  });

  it("deriveLegacyViews：有损映射逐项固定（executionModel / positionSizing）", () => {
    const definition = createStrategyDefinition(FIRST_BOARD_PULLBACK_DEFINITION);
    const views = deriveLegacyViews(definition);
    expect(views.executionModel).toBe("NEXT_OPEN");
    expect(views.positionSizing).toEqual({ kind: "fixed-fraction", fraction: 0.2, maxPositions: 5 });
    expect(views.entryRules).toHaveLength(2);
    expect(views.parameters.parameters.map((item) => item.name)).toContain("limitUpThreshold");
  });
});
