/**
 * STEP A-1 — 声明式条件 → 执行门槛 编译器单测（`server/research/conditionSignal/compile.ts`）。
 *
 * 锁死四条**最容易悄悄错**的语义（每条的失败都会让回测产物看起来正常但结论是错的）：
 *
 *   1. **方向**：`bar.low >= prefix.rd0.open`（守线）必须编译成 `haircut <= 0`，
 *      而不是 `haircut >= 0` —— 后者语义恰好相反（「跌破首板开盘价」）。
 *      本文件用「恰好守平通过 / 略微跌破剔除」把两个方向区分开。
 *   2. **闭集**：表外字段 / 表外运算符 / 非有限右值一律抛 `CONDITION_NOT_MAPPABLE`
 *      **并逐条列出**，绝不静默丢弃、也绝不回落默认配方。
 *   3. **参数右值**：`valueType=PARAMETER_REFERENCE` 必须真去参数集取值（缺值响亮抛错），
 *      杜绝「文档声明 0.3、实际按构造时常量跑」这类口径漂移。
 *   4. **同源**：合成配方复用已注册配方的同一批特征提供器，且**不进**已注册配方清单。
 *
 * 断言一律走 `SignalBuilder` 的**公开语义**（`null` = 该证券不进候选），不依赖编译器的内部表示。
 */

import { describe, expect, it } from "vitest";
import { DECLARATIVE_RECIPE_ID, compileConditionRecipe } from "../../../../server/research/conditionSignal";
import { PULLBACK_FEATURE_IDS, PULLBACK_PARAMETER_IDS, registeredStrategyRecipeIds } from "../../../../server/research/recipeRegistry";
import { StrategyRecipeRuntimeError } from "../../../../server/research/recipeErrors";
import type { ConditionDefinition } from "../../../../server/research/strategySchema/definition";
import type { ResearchParameterSchema, ResearchParameterSet } from "../../../../server/research/types";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const EMPTY_SCHEMA: ResearchParameterSchema = { parameters: [] };

/** 声明的两个数值参数（模拟「阈值来自参数」的文档）。 */
const PARAM_SCHEMA: ResearchParameterSchema = {
  parameters: [
    { name: "max_drawdown", type: "number", required: false, defaultValue: 0.02 },
    { name: "max_volume_ratio", type: "number", required: false, defaultValue: 0.3 },
  ],
};

function cond(input: {
  field: string;
  operator: ConditionDefinition["operator"];
  value: ConditionDefinition["value"];
  valueType: ConditionDefinition["valueType"];
  enabled?: boolean;
  description?: string;
}): ConditionDefinition {
  return {
    field: input.field,
    operator: input.operator,
    value: input.value,
    valueType: input.valueType,
    enabled: input.enabled ?? true,
    ...(input.description !== undefined ? { description: input.description } : {}),
  };
}

function compile(
  conditions: readonly ConditionDefinition[],
  parameters: ResearchParameterSchema = EMPTY_SCHEMA,
): ReturnType<typeof compileConditionRecipe> {
  return compileConditionRecipe({
    strategyId: "strategy-under-test",
    strategyVersion: "1.0.0",
    conditions,
    parameters,
  });
}

/** 编译并返回错误码（成功则返回 "NO_ERROR"）。 */
function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof StrategyRecipeRuntimeError ? error.code : `UNEXPECTED:${String(error)}`;
  }
  return "NO_ERROR";
}

function errorMessageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

/**
 * 跑一次信号构造。
 *
 * ⚠️ 必须补上排序特征（`momentumFromEventClose`）：门槛全过之后信号值取自它，
 * 它缺失时构造器返回 `null`，会把「门槛不通过」和「数据不足」混为一谈 ⇒ 测不出门槛行为。
 */
function evaluate(
  runtime: ReturnType<typeof compileConditionRecipe>,
  features: Readonly<Record<string, number | null>>,
  parameters: ResearchParameterSet = {},
): unknown {
  const build = runtime.buildSignalBuilder(parameters);
  return build({
    securityId: "sec-under-test",
    date: "2026-01-05",
    features: { [PULLBACK_FEATURE_IDS.momentum]: 0.1, ...features },
  });
}

// ---------------------------------------------------------------------------
// 1. 恒等映射：派生字段 → 同名特征
// ---------------------------------------------------------------------------

describe("恒等映射（派生字段直接落在同名特征上）", () => {
  it("bar.haircutFromEventLow <= 0.02 ⇒ 「守线」门槛", () => {
    const runtime = compile([
      cond({ field: "bar.haircutFromEventLow", operator: "LESS_THAN_OR_EQUAL", value: 0.02, valueType: "CONSTANT" }),
    ]);
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0.02 })).not.toBeNull();
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0.03 })).toBeNull();
  });

  it("bar.volumeRatio <= 0.5 ⇒ 「缩量」门槛", () => {
    const runtime = compile([
      cond({ field: "bar.volumeRatio", operator: "LESS_THAN_OR_EQUAL", value: 0.5, valueType: "CONSTANT" }),
    ]);
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.volumeRatio]: 0.5 })).not.toBeNull();
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.volumeRatio]: 0.6 })).toBeNull();
  });

  it("bar.isBullish >= 1 ⇒ 「红盘」门槛", () => {
    const runtime = compile([
      cond({ field: "bar.isBullish", operator: "GREATER_THAN_OR_EQUAL", value: 1, valueType: "CONSTANT" }),
    ]);
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.isBullish]: 1 })).not.toBeNull();
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.isBullish]: 0 })).toBeNull();
  });

  it("门槛为 EQ 时是精确相等", () => {
    const runtime = compile([
      cond({ field: "bar.isBullish", operator: "EQUAL", value: 1, valueType: "CONSTANT" }),
    ]);
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.isBullish]: 1 })).not.toBeNull();
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.isBullish]: 0 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. 等价改写的方向（本 STEP 修掉的真实缺陷）
// ---------------------------------------------------------------------------

describe("原始行情写法的等价改写（方向不得反向）", () => {
  it("bar.low >= prefix.rd0.open（守线）⇒ haircut <= 0，而非 >= 0", () => {
    const runtime = compile([
      cond({
        field: "bar.low",
        operator: "GREATER_THAN_OR_EQUAL",
        value: "prefix.rd0.open",
        valueType: "FIELD_REFERENCE",
      }),
    ]);
    // 恰好守平（low === open）⇒ 含等号 ⇒ 两个方向都通过，不算判据
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0 })).not.toBeNull();
    // 略微跌破开盘价（low < open ⇒ haircut > 0）⇒ **必须剔除**；若方向反了这里会通过
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0.01 })).toBeNull();
    // 高于开盘价（low > open ⇒ haircut < 0）⇒ **必须通过**；若方向反了这里会被剔除
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: -0.05 })).not.toBeNull();
  });

  it("bar.volume < prefix.rd0.volume ⇒ volumeRatio < 1（严格）", () => {
    const runtime = compile([
      cond({ field: "bar.volume", operator: "LESS_THAN", value: "prefix.rd0.volume", valueType: "FIELD_REFERENCE" }),
    ]);
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.volumeRatio]: 0.999 })).not.toBeNull();
    // 恰好等量（volume === v0）⇒ 严格小于不通过；若误判成 lte 这里会通过
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.volumeRatio]: 1 })).toBeNull();
  });

  it("bar.volume <= prefix.rd0.volume ⇒ volumeRatio <= 1（含等号）", () => {
    const runtime = compile([
      cond({
        field: "bar.volume",
        operator: "LESS_THAN_OR_EQUAL",
        value: "prefix.rd0.volume",
        valueType: "FIELD_REFERENCE",
      }),
    ]);
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.volumeRatio]: 1 })).not.toBeNull();
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.volumeRatio]: 1.001 })).toBeNull();
  });

  it("bar.close >= prefix.rd0.close ⇒ momentum >= 0", () => {
    const runtime = compile([
      cond({
        field: "bar.close",
        operator: "GREATER_THAN_OR_EQUAL",
        value: "prefix.rd0.close",
        valueType: "FIELD_REFERENCE",
      }),
    ]);
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.momentum]: 0 })).not.toBeNull();
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.momentum]: -0.001 })).toBeNull();
  });

  it("表里没有登记的方向 ⇒ 响亮抛错（不近似、不取反）", () => {
    // `bar.low <= prefix.rd0.open` 数学上等价于 `haircut >= 0`，但表里未登记该方向
    const code = errorCodeOf(() =>
      compile([
        cond({
          field: "bar.low",
          operator: "LESS_THAN_OR_EQUAL",
          value: "prefix.rd0.open",
          valueType: "FIELD_REFERENCE",
        }),
      ]),
    );
    expect(code).toBe("CONDITION_NOT_MAPPABLE");
  });

  it("写成等价改写但 valueType 不是 FIELD_REFERENCE ⇒ 响亮抛错", () => {
    const code = errorCodeOf(() =>
      compile([
        cond({
          field: "bar.low",
          operator: "GREATER_THAN_OR_EQUAL",
          value: "prefix.rd0.open",
          valueType: "CONSTANT",
        }),
      ]),
    );
    expect(code).toBe("CONDITION_NOT_MAPPABLE");
  });
});

// ---------------------------------------------------------------------------
// 3. 参数右值（阈值来自文档参数）
// ---------------------------------------------------------------------------

describe("右值 = 参数引用", () => {
  it("门槛值在 buildGates 时从参数集读取（不是构造时常量）", () => {
    const runtime = compile(
      [
        cond({
          field: "bar.haircutFromEventLow",
          operator: "LESS_THAN_OR_EQUAL",
          value: "max_drawdown",
          valueType: "PARAMETER_REFERENCE",
        }),
      ],
      PARAM_SCHEMA,
    );
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0.03 }, { max_drawdown: 0.03 })).not.toBeNull();
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0.031 }, { max_drawdown: 0.03 })).toBeNull();
    // 换一个更松的参数值 ⇒ 同一条条件放行更深的回撤（证明门槛真的跟着参数走）
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0.031 }, { max_drawdown: 0.05 })).not.toBeNull();
  });

  it("参数缺值 ⇒ 在取值时响亮抛错（不静默取默认）", () => {
    const runtime = compile(
      [
        cond({
          field: "bar.haircutFromEventLow",
          operator: "LESS_THAN_OR_EQUAL",
          value: "max_drawdown",
          valueType: "PARAMETER_REFERENCE",
        }),
      ],
      PARAM_SCHEMA,
    );
    const code = errorCodeOf(() => evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0.01 }, {}));
    expect(code).toBe("RECIPE_PARAMETER_INVALID");
  });

  it("指向文档未声明的参数 ⇒ 编译期响亮抛错", () => {
    const code = errorCodeOf(() =>
      compile([
        cond({
          field: "bar.haircutFromEventLow",
          operator: "LESS_THAN_OR_EQUAL",
          value: "not_declared",
          valueType: "PARAMETER_REFERENCE",
        }),
      ]),
    );
    expect(code).toBe("CONDITION_NOT_MAPPABLE");
  });
});

// ---------------------------------------------------------------------------
// 4. 闭集：表外的写法一律抛错并逐条列出
// ---------------------------------------------------------------------------

describe("闭集与抛错", () => {
  it("表外字段 ⇒ CONDITION_NOT_MAPPABLE 且消息逐条列出", () => {
    const message = errorMessageOf(() =>
      compile([
        cond({ field: "event.limitUpPrice", operator: "GREATER_THAN", value: 10, valueType: "CONSTANT" }),
        cond({ field: "post.rd2.high", operator: "LESS_THAN", value: 12, valueType: "CONSTANT" }),
      ]),
    );
    expect(message).toContain("第 1 条条件");
    expect(message).toContain("第 2 条条件");
    // 前缀不得重复：上层 message 已经带了「装配层：策略 …」，describeUnmappable 不应再带一次
    expect(message.match(/装配层/g)?.length ?? 0).toBe(1);
    expect(message).toContain("event.limitUpPrice");
    expect(message).toContain("post.rd2.high");
  });

  it("NOT_EQUAL / IN / NOT_IN 在执行侧没有等价门槛 ⇒ 抛错", () => {
    for (const operator of ["NOT_EQUAL", "IN", "NOT_IN"] as const) {
      const code = errorCodeOf(() =>
        compile([
          cond({ field: "bar.isBullish", operator, value: 1, valueType: "CONSTANT" }),
        ]),
      );
      expect(code, `运算符 ${operator} 应被拒绝`).toBe("CONDITION_NOT_MAPPABLE");
    }
  });

  it('存量的死写法（CONSTANT + 表达式字符串）⇒ 抛错，不被当成数值', () => {
    const code = errorCodeOf(() =>
      compile([
        cond({
          field: "bar.volume",
          operator: "LESS_THAN_OR_EQUAL",
          value: "prefix.rd0.volume * 0.3",
          valueType: "CONSTANT",
        }),
      ]),
    );
    expect(code).toBe("CONDITION_NOT_MAPPABLE");
  });

  it("派生字段与字段引用比较（特征层表达不了）⇒ 抛错", () => {
    const code = errorCodeOf(() =>
      compile([
        cond({
          field: "bar.haircutFromEventLow",
          operator: "LESS_THAN_OR_EQUAL",
          value: "prefix.rd0.open",
          valueType: "FIELD_REFERENCE",
        }),
      ]),
    );
    expect(code).toBe("CONDITION_NOT_MAPPABLE");
  });

  it("一条启用条件都没有 ⇒ CONDITION_EMPTY", () => {
    expect(errorCodeOf(() => compile([]))).toBe("CONDITION_EMPTY");
    expect(
      errorCodeOf(() =>
        compile([
          cond({
            field: "bar.isBullish",
            operator: "GREATER_THAN_OR_EQUAL",
            value: 1,
            valueType: "CONSTANT",
            enabled: false,
          }),
        ]),
      ),
    ).toBe("CONDITION_EMPTY");
  });

  it("CONSTANT 右值不是有限数字（字符串 / NaN）⇒ 抛错", () => {
    expect(
      errorCodeOf(() =>
        compile([cond({ field: "bar.isBullish", operator: "EQUAL", value: "1", valueType: "CONSTANT" })]),
      ),
    ).toBe("CONDITION_NOT_MAPPABLE");
  });
});

// ---------------------------------------------------------------------------
// 5. 合成配方的身份与同源性
// ---------------------------------------------------------------------------

describe("合成配方的身份", () => {
  it("recipeId 是自解释的声明式 id", () => {
    const runtime = compile([
      cond({ field: "bar.isBullish", operator: "GREATER_THAN_OR_EQUAL", value: 1, valueType: "CONSTANT" }),
    ]);
    expect(runtime.recipeId).toBe(DECLARATIVE_RECIPE_ID);
  });

  it("合成配方不污染「已注册配方清单」", () => {
    compile([
      cond({ field: "bar.isBullish", operator: "GREATER_THAN_OR_EQUAL", value: 1, valueType: "CONSTANT" }),
    ]);
    expect(registeredStrategyRecipeIds()).not.toContain(DECLARATIVE_RECIPE_ID);
  });

  it("特征提供器与已注册配方同源（四个派生特征）", () => {
    const runtime = compile([
      cond({ field: "bar.isBullish", operator: "GREATER_THAN_OR_EQUAL", value: 1, valueType: "CONSTANT" }),
    ]);
    expect(runtime.features.map((feature) => feature.featureId).sort()).toEqual(
      [
        PULLBACK_FEATURE_IDS.haircut,
        PULLBACK_FEATURE_IDS.volumeRatio,
        PULLBACK_FEATURE_IDS.isBullish,
        PULLBACK_FEATURE_IDS.momentum,
      ].sort(),
    );
  });

  it("摘要写门槛形状但**不写参数值**（避免与 buildGates 时的真实取值口径漂移）", () => {
    const runtime = compile(
      [
        cond({
          field: "bar.haircutFromEventLow",
          operator: "LESS_THAN_OR_EQUAL",
          value: "max_drawdown",
          valueType: "PARAMETER_REFERENCE",
        }),
      ],
      PARAM_SCHEMA,
    );
    expect(runtime.signalDescription).toContain("max_drawdown");
    // 参数默认值 0.02 不得出现在摘要里 —— 摘要描述的是「门槛形状」，不是「本次取值」
    expect(runtime.signalDescription).not.toContain("0.02");
  });

  it("多个门槛按 AND 语义叠加（任一不过即剔除）", () => {
    const runtime = compile([
      cond({ field: "bar.low", operator: "GREATER_THAN_OR_EQUAL", value: "prefix.rd0.open", valueType: "FIELD_REFERENCE" }),
      cond({ field: "bar.volume", operator: "LESS_THAN", value: "prefix.rd0.volume", valueType: "FIELD_REFERENCE" }),
      cond({ field: "bar.isBullish", operator: "GREATER_THAN_OR_EQUAL", value: 1, valueType: "CONSTANT" }),
    ]);
    const allPass = {
      [PULLBACK_FEATURE_IDS.haircut]: 0,
      [PULLBACK_FEATURE_IDS.volumeRatio]: 0.5,
      [PULLBACK_FEATURE_IDS.isBullish]: 1,
    };
    expect(evaluate(runtime, allPass)).not.toBeNull();
    expect(evaluate(runtime, { ...allPass, [PULLBACK_FEATURE_IDS.isBullish]: 0 })).toBeNull();
    expect(evaluate(runtime, { ...allPass, [PULLBACK_FEATURE_IDS.volumeRatio]: 1 })).toBeNull();
    expect(evaluate(runtime, { ...allPass, [PULLBACK_FEATURE_IDS.haircut]: 0.01 })).toBeNull();
  });

  it("特征缺失 ⇒ 剔除（数据不足与不满足都剔除，但都不产出信号）", () => {
    const runtime = compile([
      cond({ field: "bar.isBullish", operator: "GREATER_THAN_OR_EQUAL", value: 1, valueType: "CONSTANT" }),
    ]);
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.isBullish]: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. 确定性 + enabled=false 的声明语义
// ---------------------------------------------------------------------------

describe("确定性与 enabled 语义", () => {
  it("同输入两次编译 ⇒ 行为一致（无随机 / 无时间依赖）", () => {
    const conditions = [
      cond({ field: "bar.low", operator: "GREATER_THAN_OR_EQUAL", value: "prefix.rd0.open", valueType: "FIELD_REFERENCE" }),
      cond({ field: "bar.volume", operator: "LESS_THAN", value: "prefix.rd0.volume", valueType: "FIELD_REFERENCE" }),
    ];
    const a = compile(conditions);
    const b = compile(conditions);
    expect(a.recipeId).toBe(b.recipeId);
    expect(a.randomSeed).toBe(b.randomSeed);
    const features = { [PULLBACK_FEATURE_IDS.haircut]: -0.01, [PULLBACK_FEATURE_IDS.volumeRatio]: 0.8 };
    expect(evaluate(a, features)).not.toBeNull();
    expect(evaluate(b, features)).not.toBeNull();
  });

  it("enabled=false 的条件按声明跳过，且跳过条数进摘要", () => {
    const runtime = compile([
      cond({ field: "bar.isBullish", operator: "GREATER_THAN_OR_EQUAL", value: 1, valueType: "CONSTANT" }),
      cond({
        field: "bar.isBullish",
        operator: "GREATER_THAN_OR_EQUAL",
        value: 0,
        valueType: "CONSTANT",
        enabled: false,
      }),
    ]);
    expect(runtime.signalDescription).toContain("1 条 enabled=false");
    // 被跳过的条件不得生效（它是 `isBullish >= 0`，若生效则永真 —— 无法区分；改用更钝的判据）
    expect(runtime.signalDescription).toContain("共 1 条门槛");
  });

  it("真实文档形态回归：cand-270001 的两条条件可编译且语义为「守线 + 缩量」", () => {
    // 与库里 strategy_versions#390001（cand-270001@1.0.0）的 conditions 逐字一致
    const runtime = compile([
      cond({
        field: "bar.low",
        operator: "GREATER_THAN_OR_EQUAL",
        value: "prefix.rd0.open",
        valueType: "FIELD_REFERENCE",
        description: "守线",
      }),
      cond({
        field: "bar.volume",
        operator: "LESS_THAN",
        value: "prefix.rd0.volume",
        valueType: "FIELD_REFERENCE",
        description: "缩量",
      }),
    ]);
    expect(runtime.recipeId).toBe(DECLARATIVE_RECIPE_ID);
    const ok = { [PULLBACK_FEATURE_IDS.haircut]: -0.01, [PULLBACK_FEATURE_IDS.volumeRatio]: 0.8 };
    expect(evaluate(runtime, ok)).not.toBeNull();
    // 跌破开盘价 ⇒ 剔除
    expect(evaluate(runtime, { ...ok, [PULLBACK_FEATURE_IDS.haircut]: 0.01 })).toBeNull();
    // 放量（量比 > 1）⇒ 剔除
    expect(evaluate(runtime, { ...ok, [PULLBACK_FEATURE_IDS.volumeRatio]: 1.2 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. STRATEGY-RESEARCH-BRIDGE-001 §15 回归 —— 参数 code **不等于**已注册配方的三个 code
//
// 🔴 针对一个**结构性**缺陷（实测于 `first-board-pullback@1.0.0`）：
//    注册期「门槛引用面」探测（`recipeRegistry#buildGatesProbe`）此前把探测参数集**写死**为
//    `Object.values(PULLBACK_PARAMETER_IDS)`（= `max_volume_ratio` / `max_drawdown` /
//    `require_bullish`）。合成配方的参数 code 来自**策略文档**，与这三个无关 ⇒ 探测调用
//    `requireNumericParameter` 取不到值 ⇒ 抛 `RECIPE_PARAMETER_INVALID` ⇒
//    「文档声明式条件」这条路径（`assemble.ts#requireRecipe` 路径 2）对任何参数 code 不等于
//    注册配方三参数的策略**结构性不可用**（策略进不了 Backtest 输入链）。
//
// ⚠️ 为什么本文件此前 28 例全绿也没抓到：夹具里的参数 code 恰好用了 `max_drawdown`
//    （**正是**那三个 code 之一）⇒ 缺陷被夹具**意外回避**。所以本节的夹具**故意**用
//    不在 `PULLBACK_PARAMETER_IDS` 里的 code（与首板回踩草稿逐字一致）。
//
// 证据：`docs/evidence/_probe_srb001_doc_params.mts` / `_e2e_srb001_bridge_consumption.mts`。
// ---------------------------------------------------------------------------

describe("参数 code 不在已注册配方的参数面内（SRB001 §15 回归）", () => {
  /** 与 `first-board-pullback@1.0.0` 文档逐字一致的两个参数 code（都不在 `PULLBACK_PARAMETER_IDS` 里）。 */
  const FOREIGN_SCHEMA: ResearchParameterSchema = {
    parameters: [
      { name: "maxBreakDepthRatio", type: "number", required: false, defaultValue: 0 },
      { name: "maxVolumeRatio", type: "number", required: false, defaultValue: 1 },
    ],
  };

  it("夹具自检：这两个 code 确实不在已注册配方的参数面内（否则本节的回归是空的）", () => {
    const registered = new Set(Object.values(PULLBACK_PARAMETER_IDS));
    expect(registered.has("maxBreakDepthRatio")).toBe(false);
    expect(registered.has("maxVolumeRatio")).toBe(false);
  });

  it("compileConditionRecipe 不抛错（修复前必抛 RECIPE_PARAMETER_INVALID）", () => {
    const runtime = compile(
      [
        cond({
          field: "bar.haircutFromEventLow",
          operator: "LESS_THAN_OR_EQUAL",
          value: "maxBreakDepthRatio",
          valueType: "PARAMETER_REFERENCE",
        }),
        cond({
          field: "bar.volumeRatio",
          operator: "LESS_THAN_OR_EQUAL",
          value: "maxVolumeRatio",
          valueType: "PARAMETER_REFERENCE",
        }),
      ],
      FOREIGN_SCHEMA,
    );
    expect(runtime.recipeId).toBe(DECLARATIVE_RECIPE_ID);
  });

  it("门槛右值仍真去参数集取值（边界两侧各一例）", () => {
    const runtime = compile(
      [
        cond({
          field: "bar.haircutFromEventLow",
          operator: "LESS_THAN_OR_EQUAL",
          value: "maxBreakDepthRatio",
          valueType: "PARAMETER_REFERENCE",
        }),
      ],
      FOREIGN_SCHEMA,
    );
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0 }, { maxBreakDepthRatio: 0 })).not.toBeNull();
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0.01 }, { maxBreakDepthRatio: 0 })).toBeNull();
    expect(evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0.01 }, { maxBreakDepthRatio: 0.02 })).not.toBeNull();
  });

  it("门槛右值缺值仍响亮抛错（修复没有把「拒绝静默取默认」放宽）", () => {
    const runtime = compile(
      [
        cond({
          field: "bar.haircutFromEventLow",
          operator: "LESS_THAN_OR_EQUAL",
          value: "maxBreakDepthRatio",
          valueType: "PARAMETER_REFERENCE",
        }),
      ],
      FOREIGN_SCHEMA,
    );
    expect(errorCodeOf(() => evaluate(runtime, { [PULLBACK_FEATURE_IDS.haircut]: 0.01 }, {}))).toBe(
      "RECIPE_PARAMETER_INVALID",
    );
  });
});
