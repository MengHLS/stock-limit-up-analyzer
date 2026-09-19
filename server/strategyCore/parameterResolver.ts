/**
 * STRATEGY-ARCH-001 — Parameter Schema + Resolver（规格 §9）。
 *
 * 解决的问题（对照 legacy）：
 *   - `derivedFrom` 只是**人类可读字符串**，全仓**无求值器** ⇒ `DERIVED` 是空声明；
 *   - 运行期搜索空间派生器**不读 `parameterRole`** ⇒ `FIXED` 参数照样被搜索；
 *   - 参数有**三处表示**（`definition.parameters` → `document.parameters` → `SweepParameterSpace`）
 *     且由 ①→② **有损派生**（丢 code / role / unit / derivedFrom），**执行层用的是有损的 ②**。
 *
 * 本模块给出**单一可信链**：
 *
 *   ParameterDefinition[]（schema）
 *        ↓ resolveParameters(schema, ParameterSet)
 *   ResolvedParameterSet（已解析、已校验、DERIVED 已求值）
 *
 * 支持（规格 §9 全量）：
 *   type            number / string / boolean
 *   role            FIXED / TUNABLE / DERIVED（**DERIVED 真正求值**，支持表达式与多级依赖）
 *   defaultValue    缺省值（缺失且无覆写 ⇒ 响亮抛错，不编默认）
 *   validation      类型 / 范围(min,max,step) / 枚举(allowedValues) / nullable
 *   dependency      参数依赖（`derivedFrom` 引用的其他参数）
 *   cycle detection 循环依赖检测（DFS 三色标记）
 *
 * 🔴 `TUNABLE` 的作用：**只有 `TUNABLE` 才允许进入 Parameter Search**。
 *   `listSearchableParameters(schema)` 是唯一权威 —— 消费者必须用它，不得自行按 `min/max` 猜。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random；确定性。
 */

import {
  PARAMETER_CODE_RE,
  PARAMETER_DATA_TYPES,
  PARAMETER_ROLES,
  STRATEGY_CORE_ERROR_CODES,
  StrategyCoreError,
  validationIssue,
  type CoreValidationIssue,
  type CoreValue,
  type ParameterDataType,
  type ParameterRole,
  type StrategyCoreErrorCode,
} from "./types";
import {
  collectParameterReferences,
  evaluateExpression,
  parseExpression,
  validateExpression,
  type ValueExpression,
} from "./expression";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface ParameterDefinitionBase {
  readonly code: string;
  readonly name: string;
  readonly role: ParameterRole;
  readonly defaultValue?: CoreValue;
  readonly nullable?: boolean;
  readonly unit?: string;
  readonly description?: string;
  readonly required: boolean;
}

export interface NumberParameterDefinition extends ParameterDefinitionBase {
  readonly dataType: "number";
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly derivedFrom?: ValueExpression;
}

export interface StringParameterDefinition extends ParameterDefinitionBase {
  readonly dataType: "string";
  readonly allowedValues?: readonly string[];
  readonly derivedFrom?: ValueExpression;
}

export interface BooleanParameterDefinition extends ParameterDefinitionBase {
  readonly dataType: "boolean";
  readonly derivedFrom?: ValueExpression;
}

export type ParameterDefinition =
  | NumberParameterDefinition
  | StringParameterDefinition
  | BooleanParameterDefinition;

/** 调用方提供的参数值集合（**未解析**原始配置；键必须都在 schema 内）。 */
export type ParameterSet = Readonly<Record<string, CoreValue>>;

/**
 * 已解析参数集（Runtime 只能消费这个）。
 *
 * 🔴 类型上带 `resolved: true` 标记：让「未解析原始配置」**无法**被当成 Runtime 输入传递
 *   （规格 §9「Runtime 获得的必须是 ResolvedParameterSet」）。
 */
export interface ResolvedParameterSet {
  readonly resolved: true;
  readonly values: Readonly<Record<string, CoreValue>>;
}

/** 参数依赖图（`code -> 它依赖的其他参数 code`，稳定排序）。 */
export type ParameterDependencyGraph = ReadonlyMap<string, readonly string[]>;

// ---------------------------------------------------------------------------
// schema 校验
// ---------------------------------------------------------------------------

function validateSingleDefinition(definition: ParameterDefinition, path: string): readonly CoreValidationIssue[] {
  const issues: CoreValidationIssue[] = [];
  if (!PARAMETER_CODE_RE.test(definition.code)) {
    issues.push(validationIssue("PARAMETER_UNKNOWN", path + ".code", "参数 code 形态非法：" + definition.code));
  }
  if (definition.name.trim() === "") {
    issues.push(validationIssue("PARAMETER_UNKNOWN", path + ".name", "name 不能为空"));
  }
  if (!(PARAMETER_DATA_TYPES as readonly string[]).includes(definition.dataType)) {
    issues.push(validationIssue("PARAMETER_TYPE_MISMATCH", path + ".dataType", "未知数据类型 " + String(definition.dataType)));
  }
  if (!(PARAMETER_ROLES as readonly string[]).includes(definition.role)) {
    issues.push(validationIssue("PARAMETER_UNKNOWN", path + ".role", "未知参数角色 " + String(definition.role)));
  }

  if (definition.role === "DERIVED") {
    if (definition.derivedFrom === undefined) {
      issues.push(
        validationIssue("PARAMETER_DERIVED_MISSING_EXPRESSION", path + ".derivedFrom", "DERIVED 参数必须声明 derivedFrom 表达式"),
      );
    } else {
      issues.push(...validateExpression(definition.derivedFrom, path + ".derivedFrom"));
    }
  } else if (definition.derivedFrom !== undefined) {
    issues.push(
      validationIssue(
        "PARAMETER_DERIVED_MISSING_EXPRESSION",
        path + ".derivedFrom",
        "只有 DERIVED 参数才能声明 derivedFrom（当前 role=" + definition.role + "）—— 声明了却不生效是禁止的",
      ),
    );
  }

  if (definition.role === "TUNABLE") {
    if (definition.dataType === "number") {
      const numberDef = definition as NumberParameterDefinition;
      if (numberDef.min === undefined || numberDef.max === undefined) {
        issues.push(
          validationIssue(
            "PARAMETER_TUNABLE_REQUIRES_BOUNDS",
            path,
            "TUNABLE 数值参数必须同时声明 min 与 max（搜索空间的范围必须由文档声明，不替你猜）",
          ),
        );
      } else if (numberDef.min > numberDef.max) {
        issues.push(validationIssue("PARAMETER_OUT_OF_RANGE", path, "参数范围倒挂：min > max（不替你交换）"));
      }
    } else if (definition.dataType === "string") {
      const stringDef = definition as StringParameterDefinition;
      if (stringDef.allowedValues === undefined || stringDef.allowedValues.length === 0) {
        issues.push(
          validationIssue("PARAMETER_NOT_ALLOWED_VALUE", path, "TUNABLE 字符串参数必须声明非空 allowedValues"),
        );
      }
    } else {
      issues.push(
        validationIssue("PARAMETER_TYPE_MISMATCH", path, "TUNABLE 不支持 boolean（布尔维度无法网格化，请用 string 枚举表达）"),
      );
    }
  }

  if (definition.defaultValue !== undefined) {
    issues.push(...validateSingleValue(definition, definition.defaultValue, path + ".defaultValue"));
  }
  return issues;
}

function validateSingleValue(
  definition: ParameterDefinition,
  value: CoreValue,
  path: string,
): readonly CoreValidationIssue[] {
  const issues: CoreValidationIssue[] = [];
  if (value === null) {
    if (definition.nullable !== true) {
      issues.push(validationIssue("PARAMETER_NULL_NOT_ALLOWED", path, "该参数不允许 null（nullable 未声明）"));
    }
    return issues;
  }
  if (definition.dataType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(validationIssue("PARAMETER_TYPE_MISMATCH", path, "期望有限数字，实际 " + JSON.stringify(value)));
      return issues;
    }
    const numberDef = definition as NumberParameterDefinition;
    if (numberDef.min !== undefined && value < numberDef.min) {
      issues.push(validationIssue("PARAMETER_OUT_OF_RANGE", path, "值 " + String(value) + " 小于 min " + String(numberDef.min)));
    }
    if (numberDef.max !== undefined && value > numberDef.max) {
      issues.push(validationIssue("PARAMETER_OUT_OF_RANGE", path, "值 " + String(value) + " 大于 max " + String(numberDef.max)));
    }
    return issues;
  }
  if (definition.dataType === "string") {
    if (typeof value !== "string") {
      issues.push(validationIssue("PARAMETER_TYPE_MISMATCH", path, "期望字符串，实际 " + JSON.stringify(value)));
      return issues;
    }
    const stringDef = definition as StringParameterDefinition;
    if (stringDef.allowedValues !== undefined && stringDef.allowedValues.length > 0 && !stringDef.allowedValues.includes(value)) {
      issues.push(
        validationIssue(
          "PARAMETER_NOT_ALLOWED_VALUE",
          path,
          "值 " + value + " 不在 allowedValues [" + stringDef.allowedValues.join("、") + "] 内",
        ),
      );
    }
    return issues;
  }
  if (typeof value !== "boolean") {
    issues.push(validationIssue("PARAMETER_TYPE_MISMATCH", path, "期望布尔，实际 " + JSON.stringify(value)));
  }
  return issues;
}

/** 校验参数 schema（结构 + 唯一性 + role 相关规则 + 依赖引用完整性 + 循环依赖）。 */
export function validateParameterSchema(schema: readonly ParameterDefinition[]): readonly CoreValidationIssue[] {
  const issues: CoreValidationIssue[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < schema.length; index += 1) {
    const definition = schema[index] as ParameterDefinition;
    const path = "parameterSchema[" + String(index) + "]";
    if (seen.has(definition.code)) {
      issues.push(validationIssue("PARAMETER_SCHEMA_DUPLICATE_CODE", path + ".code", "参数 code 重复：" + definition.code));
    }
    seen.add(definition.code);
    issues.push(...validateSingleDefinition(definition, path));
  }

  // 依赖引用完整性（表达式里的参数引用必须都在 schema 内）
  const known = new Set(schema.map((definition) => definition.code));
  for (let index = 0; index < schema.length; index += 1) {
    const definition = schema[index] as ParameterDefinition;
    if (definition.derivedFrom === undefined) continue;
    for (const code of collectParameterReferences(definition.derivedFrom)) {
      if (!known.has(code)) {
        issues.push(
          validationIssue(
            "PARAMETER_UNKNOWN",
            "parameterSchema[" + String(index) + "].derivedFrom",
            "派生表达式引用了未声明的参数 " + code,
          ),
        );
      }
    }
  }

  // 循环依赖
  for (const cycle of detectParameterCycles(schema)) {
    issues.push(validationIssue("PARAMETER_DERIVED_CYCLE", "parameterSchema", "检测到循环依赖：" + cycle.join(" → ")));
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 依赖图 / 循环检测
// ---------------------------------------------------------------------------

/** 参数依赖图（只有 DERIVED 参数有出边）。 */
export function parameterDependencyGraph(schema: readonly ParameterDefinition[]): ParameterDependencyGraph {
  const graph = new Map<string, readonly string[]>();
  for (const definition of schema) {
    const deps =
      definition.role === "DERIVED" && definition.derivedFrom !== undefined
        ? [...new Set(collectParameterReferences(definition.derivedFrom))].sort()
        : [];
    graph.set(definition.code, deps);
  }
  return graph;
}

/**
 * 循环依赖检测（DFS 三色标记；返回**全部**发现到的环，每个环规范化成稳定顺序）。
 * 环的表示：从环内最小 code 起按依赖方向列出，末尾回到起点。
 */
export function detectParameterCycles(schema: readonly ParameterDefinition[]): readonly (readonly string[])[] {
  const graph = parameterDependencyGraph(schema);
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const code of graph.keys()) color.set(code, WHITE);
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();

  const visit = (node: string): void => {
    color.set(node, GRAY);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      if (!graph.has(dependency)) continue;
      const state = color.get(dependency);
      if (state === GRAY) {
        const start = stack.indexOf(dependency);
        const cycle = stack.slice(start);
        const normalized = normalizeCycle(cycle);
        const key = normalized.join(">");
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push([...normalized, normalized[0] as string]);
        }
        continue;
      }
      if (state === WHITE) visit(dependency);
    }
    stack.pop();
    color.set(node, BLACK);
  };

  for (const code of [...graph.keys()].sort()) {
    if (color.get(code) === WHITE) visit(code);
  }
  return cycles;
}

function normalizeCycle(cycle: readonly string[]): string[] {
  const sorted = [...cycle].sort();
  const smallest = sorted[0] as string;
  const index = cycle.indexOf(smallest);
  return [...cycle.slice(index), ...cycle.slice(0, index)];
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

/** 拓扑序（依赖在前）；存在环时抛 `PARAMETER_DERIVED_CYCLE`。 */
export function parameterResolutionOrder(schema: readonly ParameterDefinition[]): readonly string[] {
  const cycles = detectParameterCycles(schema);
  if (cycles.length > 0) {
    throw new StrategyCoreError(
      "PARAMETER_DERIVED_CYCLE",
      "参数存在循环依赖，无法解析：" + cycles.map((cycle) => cycle.join(" → ")).join(" | "),
      { cycleLength: cycles[0]?.length ?? 0 },
    );
  }
  const graph = parameterDependencyGraph(schema);
  const byCode = new Map(schema.map((definition) => [definition.code, definition]));
  const out: string[] = [];
  const visited = new Set<string>();
  const visit = (code: string): void => {
    if (visited.has(code)) return;
    visited.add(code);
    for (const dependency of graph.get(code) ?? []) {
      if (byCode.has(dependency)) visit(dependency);
    }
    out.push(code);
  };
  for (const code of [...byCode.keys()].sort()) visit(code);
  return out;
}

/** 只有 `TUNABLE` 参数可被 Parameter Search 搜索（唯一权威）。 */
export function listSearchableParameters(schema: readonly ParameterDefinition[]): readonly ParameterDefinition[] {
  return schema.filter((definition) => definition.role === "TUNABLE");
}

/**
 * 解析参数（唯一入口）。
 *
 * 顺序（规格 §9）：
 *   1. schema 校验（含循环依赖检测）→ 非法即抛；
 *   2. 调用方集合的未知键 ⇒ 抛 `PARAMETER_UNKNOWN`（不静默忽略）；
 *   3. DERIVED 参数不允许被调用方赋值 ⇒ 抛 `PARAMETER_DERIVED_OVERRIDE_FORBIDDEN`；
 *   4. 按拓扑序求值：覆写值 → DERIVED 表达式 → defaultValue；三者皆无 ⇒ `PARAMETER_MISSING_DEFAULT`；
 *   5. 逐项做类型 / 范围 / 枚举 / nullable 校验。
 */
export function resolveParameters(
  schema: readonly ParameterDefinition[],
  set: ParameterSet = {},
): ResolvedParameterSet {
  const schemaIssues = validateParameterSchema(schema);
  if (schemaIssues.length > 0) {
    const first = schemaIssues[0] as CoreValidationIssue;
    throw new StrategyCoreError(
      "CORE_DEFINITION_INVALID",
      schemaIssues.map((issue) => issue.path + ": " + issue.message).join(" | "),
      { issueCode: first.code, issueCount: schemaIssues.length },
    );
  }

  const byCode = new Map(schema.map((definition) => [definition.code, definition]));
  for (const key of Object.keys(set)) {
    if (!byCode.has(key)) {
      throw new StrategyCoreError(
        "PARAMETER_UNKNOWN",
        "提供了未声明的参数 " + key + "（已声明：" + [...byCode.keys()].sort().join("、") + "）—— 拒绝静默忽略",
        { code: key },
      );
    }
  }

  const resolved: Record<string, CoreValue> = {};
  const readResolved = (code: string): CoreValue => {
    if (Object.prototype.hasOwnProperty.call(resolved, code)) return resolved[code] as CoreValue;
    throw new StrategyCoreError(
      "PARAMETER_UNKNOWN",
      "派生表达式引用了尚未解析的参数 " + code + "（拓扑序保证不应发生；请检查循环依赖）",
      { code },
    );
  };

  const order = parameterResolutionOrder(schema);
  for (const code of order) {
    const definition = byCode.get(code) as ParameterDefinition;
    const provided = Object.prototype.hasOwnProperty.call(set, code) ? (set[code] as CoreValue) : undefined;

    let value: CoreValue | undefined;
    if (definition.role === "DERIVED") {
      if (provided !== undefined) {
        throw new StrategyCoreError(
          "PARAMETER_DERIVED_OVERRIDE_FORBIDDEN",
          "参数 " + code + " 是 DERIVED（由 derivedFrom 推导），不允许调用方直接赋值 —— 否则参数集不再可复现",
          { code },
        );
      }
      const expression = definition.derivedFrom as ValueExpression;
      value = evaluateExpression(expression, {
        fieldValue: (field) => {
          throw new StrategyCoreError(
            "EXPRESSION_INVALID",
            "派生表达式引用数据集字段 " + field + " —— 派生参数只能引用其他参数（保持与数据无关）",
            { field },
          );
        },
        featureValue: (featureId) => {
          throw new StrategyCoreError(
            "EXPRESSION_INVALID",
            "派生表达式引用特征 " + featureId + " —— 派生参数只能引用其他参数（保持与数据无关）",
            { featureId },
          );
        },
        parameterValue: readResolved,
      });
      if (value !== null && typeof value === "number" && !Number.isFinite(value)) {
        throw new StrategyCoreError(
          "PARAMETER_DERIVED_INVALID_RESULT",
          "参数 " + code + " 的派生结果为非有限数字（" + String(value) + "）",
          { code },
        );
      }
    } else if (provided !== undefined) {
      value = provided;
    } else {
      value = definition.defaultValue;
    }

    if (value === undefined) {
      throw new StrategyCoreError(
        "PARAMETER_MISSING_DEFAULT",
        "参数 " + code + " 既未提供取值、也没有 defaultValue（拒绝在结果里留下不可复现的参数）",
        { code },
      );
    }

    const valueIssues = validateSingleValue(definition, value, "parameterSchema." + code);
    if (valueIssues.length > 0) {
      const first = valueIssues[0] as CoreValidationIssue;
      const narrowed = (STRATEGY_CORE_ERROR_CODES as readonly string[]).includes(first.code)
        ? (first.code as StrategyCoreErrorCode)
        : "PARAMETER_TYPE_MISMATCH";
      throw new StrategyCoreError(
        narrowed,
        valueIssues.map((issue) => issue.message).join(" | "),
        { code, issueCount: valueIssues.length },
      );
    }
    resolved[code] = value;
  }

  // 稳定键序（供指纹稳定）
  const sorted: Record<string, CoreValue> = {};
  for (const code of Object.keys(resolved).sort()) sorted[code] = resolved[code] as CoreValue;
  return { resolved: true, values: Object.freeze(sorted) };
}

/** 便捷读取（缺失即抛错，**不返回 undefined 冒充值**）。 */
export function requireResolvedValue(set: ResolvedParameterSet, code: string): CoreValue {
  if (!Object.prototype.hasOwnProperty.call(set.values, code)) {
    throw new StrategyCoreError("PARAMETER_UNKNOWN", "已解析参数集里没有 " + code, { code });
  }
  return set.values[code] as CoreValue;
}

/** 便捷读取数值（类型不符即抛错）。 */
export function requireResolvedNumber(set: ResolvedParameterSet, code: string): number {
  const value = requireResolvedValue(set, code);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StrategyCoreError(
      "PARAMETER_TYPE_MISMATCH",
      "参数 " + code + " 期望有限数字，实际 " + JSON.stringify(value),
      { code },
    );
  }
  return value;
}

/** 便捷读取布尔。 */
export function requireResolvedBoolean(set: ResolvedParameterSet, code: string): boolean {
  const value = requireResolvedValue(set, code);
  if (typeof value !== "boolean") {
    throw new StrategyCoreError(
      "PARAMETER_TYPE_MISMATCH",
      "参数 " + code + " 期望布尔，实际 " + JSON.stringify(value),
      { code },
    );
  }
  return value;
}

/** 从文本表达式解析 `derivedFrom`（legacy 兼容；失败抛 `PARAMETER_DERIVED_UNPARSEABLE`）。 */
export function derivedExpressionFromText(text: string): ValueExpression {
  return parseExpression(text);
}
