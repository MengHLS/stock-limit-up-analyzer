/**
 * definitionVocabulary ↔ 服务端词表**逐字对表**（防漂移哨兵）。
 *
 * 为什么必须有它：`client/**` **不能** import 服务端的运行时值（仓库铁律：跨端只允许
 * `import type`，否则服务端模块会被打进浏览器包）⇒ 定义侧词表只能在客户端**抄一份**。
 * 抄一份就有漂移风险，唯一能拦住漂移的手段就是这里逐字比。
 *
 * 覆盖范围 = `definitionVocabulary.ts` 里**每一个**对服务端枚举的镜像：
 *   event / windowUnit / trigger / **conditionOperator** / conditionValueType /
 *   exitRuleType / exitTrigger / exitThresholdUnit / sizingMethod / signalTiming /
 *   executionTiming / priceType / quantityMethod / costModel / parameterRole /
 *   parameterDataType / datasetRole。
 *
 * ⚠️ 本测试**测的是「值集相同」而不是「顺序相同」**：客户端为了让常用项排在前面
 * （如 `T_CLOSE` 在 `T_OPEN` 之前、`T_PLUS_1_OPEN` 在最前）**故意**调过顺序，
 * 而下拉顺序是 UI 决策、不是契约。契约是**集合相等且无重复**。
 *
 * 另一半（`SYMBOL_TO_OPERATOR_NAME`）测的是**值域**而不是键：符号形只在草图侧出现，
 * 定义侧一律是服务端名称。这里额外断言「定义侧运算符表里**不含任何符号**」——
 * 那正是本轮修掉的那个真 bug（详见 `definitionVocabulary.ts` 的注释）。
 */

import { describe, expect, it } from "vitest";
import {
  STRATEGY_CONDITION_OPERATORS,
  STRATEGY_CONDITION_VALUE_TYPES,
  STRATEGY_COST_MODELS,
  STRATEGY_DATASET_ROLES,
  STRATEGY_EVENT_TYPES,
  STRATEGY_EXECUTION_TIMINGS,
  STRATEGY_EXIT_RULE_TYPES,
  STRATEGY_EXIT_THRESHOLD_UNITS,
  STRATEGY_EXIT_TRIGGERS,
  STRATEGY_PARAMETER_DATA_TYPES,
  STRATEGY_PARAMETER_ROLES,
  STRATEGY_POSITION_SIZING_METHODS,
  STRATEGY_PRICE_TYPES,
  STRATEGY_QUANTITY_METHODS,
  STRATEGY_SIGNAL_TIMINGS,
  STRATEGY_TRIGGER_TYPES,
  STRATEGY_WINDOW_UNITS,
} from "../../../../../server/research/strategySchema/definition";
import { CANDIDATE_CONDITION_OPERATOR_OPTIONS } from "@/components/research/candidateSketchVocabulary";
import {
  DEFINITION_CONDITION_OPERATOR_OPTIONS,
  DEFINITION_CONDITION_VALUE_TYPE_OPTIONS,
  DEFINITION_COST_MODEL_OPTIONS,
  DEFINITION_DATASET_ROLE_OPTIONS,
  DEFINITION_EVENT_OPTIONS,
  DEFINITION_EXECUTION_TIMING_OPTIONS,
  DEFINITION_EXIT_RULE_TYPE_OPTIONS,
  DEFINITION_EXIT_THRESHOLD_UNIT_OPTIONS,
  DEFINITION_EXIT_TRIGGER_OPTIONS,
  DEFINITION_PARAMETER_ROLE_OPTIONS,
  DEFINITION_PARAMETER_TYPE_OPTIONS,
  DEFINITION_PRICE_TYPE_OPTIONS,
  DEFINITION_QUANTITY_METHOD_OPTIONS,
  DEFINITION_SIGNAL_TIMING_OPTIONS,
  DEFINITION_SIZING_METHOD_OPTIONS,
  DEFINITION_TRIGGER_OPTIONS,
  DEFINITION_WINDOW_UNIT_OPTIONS,
  SYMBOL_TO_OPERATOR_NAME,
  definitionConditionOperatorOf,
  definitionOperatorSymbol,
  definitionOptionLabel,
  isKnownDefinitionOption,
} from "@/components/strategy/definitionVocabulary";

/** 集合相等（忽略顺序）+ 无重复。顺序是 UI 决策，契约是集合。 */
function expectSameValueSet(actual: readonly string[], expected: readonly string[], what: string): void {
  expect([...actual].sort(), `${what}：值集必须与服务端逐字相同`).toEqual([...expected].sort());
  expect(new Set(actual).size, `${what}：不得有重复取值`).toBe(actual.length);
}

const values = (options: readonly { readonly value: string }[]) => options.map((option) => option.value);

describe("定义侧词表 ↔ 服务端逐字对表（防漂移）", () => {
  it("1) 与草图共用的那批表：值集逐字相同", () => {
    expectSameValueSet(values(DEFINITION_EVENT_OPTIONS), [...STRATEGY_EVENT_TYPES], "entry.event.type");
    expectSameValueSet(
      values(DEFINITION_WINDOW_UNIT_OPTIONS),
      [...STRATEGY_WINDOW_UNITS],
      "observationWindow.unit",
    );
    expectSameValueSet(values(DEFINITION_TRIGGER_OPTIONS), [...STRATEGY_TRIGGER_TYPES], "trigger.type");
    expectSameValueSet(
      values(DEFINITION_CONDITION_VALUE_TYPE_OPTIONS),
      [...STRATEGY_CONDITION_VALUE_TYPES],
      "conditions[].valueType",
    );
    expectSameValueSet(
      values(DEFINITION_SIZING_METHOD_OPTIONS),
      [...STRATEGY_POSITION_SIZING_METHODS],
      "position.sizingMethod",
    );
    expectSameValueSet(
      values(DEFINITION_QUANTITY_METHOD_OPTIONS),
      [...STRATEGY_QUANTITY_METHODS],
      "execution.quantityMethod",
    );
    expectSameValueSet(values(DEFINITION_COST_MODEL_OPTIONS), [...STRATEGY_COST_MODELS], "cost model 标识");
    expectSameValueSet(
      values(DEFINITION_PARAMETER_TYPE_OPTIONS),
      [...STRATEGY_PARAMETER_DATA_TYPES],
      "parameters[].dataType",
    );
  });

  it("2) 定义侧独有的那批表：值集逐字相同", () => {
    expectSameValueSet(values(DEFINITION_SIGNAL_TIMING_OPTIONS), [...STRATEGY_SIGNAL_TIMINGS], "execution.signalTiming");
    expectSameValueSet(
      values(DEFINITION_EXECUTION_TIMING_OPTIONS),
      [...STRATEGY_EXECUTION_TIMINGS],
      "execution.executionTiming",
    );
    expectSameValueSet(values(DEFINITION_PRICE_TYPE_OPTIONS), [...STRATEGY_PRICE_TYPES], "execution.priceType");
    expectSameValueSet(
      values(DEFINITION_EXIT_RULE_TYPE_OPTIONS),
      [...STRATEGY_EXIT_RULE_TYPES],
      "exit.rules[].type",
    );
    expectSameValueSet(values(DEFINITION_EXIT_TRIGGER_OPTIONS), [...STRATEGY_EXIT_TRIGGERS], "exit.rules[].trigger");
    expectSameValueSet(
      values(DEFINITION_EXIT_THRESHOLD_UNIT_OPTIONS),
      [...STRATEGY_EXIT_THRESHOLD_UNITS],
      "exit.rules[].thresholdUnit",
    );
    expectSameValueSet(
      values(DEFINITION_PARAMETER_ROLE_OPTIONS),
      [...STRATEGY_PARAMETER_ROLES],
      "parameters[].parameterRole",
    );
    expectSameValueSet(values(DEFINITION_DATASET_ROLE_OPTIONS), [...STRATEGY_DATASET_ROLES], "datasets[].role");
  });

  it("3) 🔴 条件运算符：定义侧是**服务端名称**（不是草图那一套符号）", () => {
    expectSameValueSet(
      values(DEFINITION_CONDITION_OPERATOR_OPTIONS),
      [...STRATEGY_CONDITION_OPERATORS],
      "conditions[].operator",
    );
  });

  it("4) 🔴 定义侧运算符表里**不得出现符号形**（这正是本轮修掉的那个真 bug）", () => {
    // 真实库里的条件写的是 { operator: "GREATER_THAN_OR_EQUAL" }（见
    // docs/evidence/_probe_strategy_definition_shape.json 的 conditionSample）。
    // 若这张表被换回草图的符号表，用户一改运算符就会写出后端不认的值。
    //
    // ⚠️ 只比**真正翻译了拼写的那些**：`IN`/`NOT_IN` 在翻译表里是「自己映射到自己」
    // （它们没有符号写法）⇒ 把它们也算进来会得到一个永远为假的断言，
    // 那是断言写错、不是代码写错。
    const translatedAway = Object.entries(SYMBOL_TO_OPERATOR_NAME).filter(
      ([symbol, name]) => symbol !== name,
    );
    expect(translatedAway.length, "真正发生改写的运算符应当恰好是六个").toBe(6);
    for (const [symbol] of translatedAway) {
      expect(
        values(DEFINITION_CONDITION_OPERATOR_OPTIONS),
        `定义侧不该出现符号形运算符 ${symbol}`,
      ).not.toContain(symbol);
    }
    // 反向：草图侧也不该出现**名称形**（两边各司其职，谁也别把对方的值抄过来）。
    // 用「草图值集里没有它」来判「名称形」，同样天然排掉两形同名的 `IN`/`NOT_IN`。
    const sketchValues = new Set(CANDIDATE_CONDITION_OPERATOR_OPTIONS.map((option) => option.value));
    const nameOnly = STRATEGY_CONDITION_OPERATORS.filter((name) => !sketchValues.has(name));
    expect(nameOnly.length, "名称形独有的运算符应当恰好是六个").toBe(6);
    for (const name of nameOnly) {
      expect(
        [...sketchValues],
        `草图侧不该出现名称形运算符 ${name}`,
      ).not.toContain(name);
    }
  });

  it("5) 符号 → 名称的翻译表：值域 ≡ 服务端运算符，键域 ≡ 草图运算符", () => {
    const translated = Object.values(SYMBOL_TO_OPERATOR_NAME);
    expectSameValueSet(translated, [...STRATEGY_CONDITION_OPERATORS], "翻译表的值（服务端名称）");
    expectSameValueSet(
      Object.keys(SYMBOL_TO_OPERATOR_NAME),
      CANDIDATE_CONDITION_OPERATOR_OPTIONS.map((option) => option.value),
      "翻译表的键（草图符号）",
    );
  });

  it("6) `arity`（单值 / 列表）与草图侧对同一运算符的判断一致", () => {
    // 「属于 / 不属于」在两处都必须被判成 LIST —— 判错会让右值被当成单值解析。
    for (const option of DEFINITION_CONDITION_OPERATOR_OPTIONS) {
      const sketch = CANDIDATE_CONDITION_OPERATOR_OPTIONS.find(
        (item) => item.value === option.value || SYMBOL_TO_OPERATOR_NAME[item.value] === option.value,
      );
      expect(sketch, `定义侧运算符 ${option.value} 在草图侧找不到对应项`).toBeDefined();
      expect(option.arity, `运算符 ${option.value} 的 arity 两侧不一致`).toBe(sketch?.arity);
    }
  });

  it("7) 标签查询：未知取值**原样返回**，绝不编造一个看着对的中文名", () => {
    expect(definitionOptionLabel(DEFINITION_EVENT_OPTIONS, "FIRST_LIMIT_UP")).toBe("首个涨停（首板）");
    expect(definitionOptionLabel(DEFINITION_EVENT_OPTIONS, "SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(definitionOptionLabel(DEFINITION_EVENT_OPTIONS, "")).toBe("");
    expect(isKnownDefinitionOption(DEFINITION_EVENT_OPTIONS, "SOMETHING_NEW")).toBe(false);
  });

  it("8) 运算符的符号形只用于显示：已知值有人话，未知值原样回显", () => {
    expect(definitionOperatorSymbol("GREATER_THAN_OR_EQUAL")).toBe(" 大于等于 ");
    expect(definitionOperatorSymbol("LESS_THAN")).toBe(" 小于 ");
    expect(definitionConditionOperatorOf("NOT_IN")?.arity).toBe("LIST");
    expect(definitionOperatorSymbol("WHATEVER")).toBe(" WHATEVER ");
  });
});
