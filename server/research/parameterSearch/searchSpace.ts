/**
 * PARAMETER-001 §3/§4/§5 — Parameter Space Definition（参数空间定义 · 派生 · 校验 · 编译）。
 *
 * ## 本模块在既有体系里的位置（**收敛，不新建第二套**）
 *
 * 既有链路：`StrategyDefinition.parameters`（canonical，带 `parameterRole`）
 *   ──投影──▶ `strategy_parameters` 表（`strategySchema/projection.ts`）
 *   ──既有派生器有损视图──▶ `parameterSpaceFromDocument.ts`（**只读 legacy v1 视图，不读 role**）
 *   ──▶ `SweepParameterSpace`（`server/research/parameterSpace.ts`）
 *   ──▶ `generateParameterCombinations`（Cartesian Product）
 *
 * 🔴 历史缺陷（R-05）：`parameterSpaceFromDocument.ts` 走 `document.parameters`（v1 有损视图，
 *   **没有 `parameterRole` 字段**）⇒ `FIXED` 参数只要带 min/max/step 就照样被搜索。
 *   本模块补上唯一缺失的一环：**从带 role 的投影派生搜索域**，其余一律复用既有实现。
 *
 * ## 职责边界（严格）
 *
 * - **只**产出「参数空间定义」（含 FIXED/TUNABLE/DERIVED 分类 + 搜索域形态）；
 * - **不**生成组合（→ `combination.ts` 复用 `combinationGenerator`）；
 * - **不**执行搜索（→ `run.ts` 既有纯函数引擎）；
 * - **不**碰 DB / IO（调用方传入已读出的投影行）；
 * - 校验为纯函数（返回结构化结果，不抛错），另提供 `assert*` 便捷入口。
 *
 * ## 分类语义（规格 §4）
 *
 * | kind      | 进搜索空间 | 说明 |
 * |-----------|-----------|------|
 * | `FIXED`   | ❌        | 搜索过程中不能变化（`datasetVersionId` / `strategyVersionId` / `initialCapital` / `executionPolicyVersion` / 回测窗口 由 Run 层持有） |
 * | `TUNABLE` | ✅        | 只有它进搜索空间（**唯一权威判据 = `parameterRole === "TUNABLE"`**） |
 * | `DERIVED` | ❌        | 由其他参数推导，**不得直接进入搜索空间** |
 *
 * 🔴 `TUNABLE` 判据的**唯一权威实现**是 `server/strategyCore/parameterResolver.ts#listSearchableParameters`
 * （Core 侧，`role === "TUNABLE"`）。本模块在**投影层**应用同一判据：不 import `strategyCore`
 * （那会给 `server/research/**` 引入一条新的跨域生产依赖），改为把判据收敛到 `isSearchableStrategyParameter`
 * 一个函数，并由 `tests/server/research/parameterSearch/searchSpace.test.ts` **断言与
 * `listSearchableParameters` 在夹具上逐参数等价** —— 让「两处判据不漂移」成为可执行事实。
 */

import {
  PARAMETER_SEARCH_SPACE_RECORD_KIND,
  PARAMETER_SEARCH_SPACE_RECORD_VERSION,
  type ParameterSearchDomain,
  type ParameterSearchParameterDefinition,
  type ParameterSearchParameterKind,
  type ParameterSearchSpaceDefinition,
} from "../../../shared/parameterSearchContracts";
import type { ParameterSpace, SweepParameterDefinition } from "../parameterSpace";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "../experimentValidation";
import type { StrategyParameterProjectionRow } from "../strategySchema/projection";

// ---------------------------------------------------------------------------
// 判据常量（唯一落点）
// ---------------------------------------------------------------------------

/**
 * 「可被 Parameter Search 搜索」的角色（规格 §4）。
 *
 * 🔴 唯一权威实现 = `strategyCore/parameterResolver.ts#listSearchableParameters`；
 *   本常量是它在**投影层**的等价表达，由测试钉住等价性（见文件头）。
 */
export const PARAMETER_SEARCH_SEARCHABLE_ROLE = "TUNABLE" as const;

/** 某个**带角色**的参数是否可被搜索（唯一判据；不得在内联处重复写 `=== "TUNABLE"`）。 */
export function isSearchableStrategyParameter(parameter: {
  readonly parameterRole: string;
}): boolean {
  return parameter.parameterRole === PARAMETER_SEARCH_SEARCHABLE_ROLE;
}

/** 参数空间里的参数名合法性（与策略 Schema 的 `ParameterDefinition.code` 同规则）。 */
const PARAMETER_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// 派生
// ---------------------------------------------------------------------------

/** 派生结果：定义 + 如实说明（未进搜索空间的参数与原因）。 */
export interface ParameterSearchSpaceDerivation {
  readonly definition: ParameterSearchSpaceDefinition;
  /** 逐条如实说明（禁静默丢弃）。 */
  readonly notes: readonly string[];
  /** 投影中 `parameterRole` 非三态枚举的异常行（如历史脏数据），如实带出。 */
  readonly unknownRoleCodes: readonly string[];
  /**
   * PARAMETER-002 — **被策略规则图引用**的参数 code 集合是否真的做了核对。
   *   `false` = 调用方未提供引用面（如决策引擎不可构造）⇒ 本层**没有**做死参数筛查。
   */
  readonly referenceCheckApplied: boolean;
  /**
   * PARAMETER-002 — 声明为 `TUNABLE` 但**规则图从未引用**的参数 code（去重、稳定排序）。
   *
   * 这些参数被搜索时**不会改变任何执行结果**（决策引擎读不到它们）⇒ 必须如实带出，
   * 由调用方决定拒绝还是提示。
   */
  readonly unreferencedTunableCodes: readonly string[];
}

/** 派生输入。 */
export interface ParameterSearchSpaceDerivationInput {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parameters: readonly StrategyParameterProjectionRow[];
  /**
   * PARAMETER-002 — 策略**规则图实际引用**的参数 code 集合（唯一权威 = `strategyCore/ruleGraph.ts#collectRuleParameterReferences`）。
   *
   * 🔴 为什么必须有这一项：参数「声明在 schema 里」不等于「决策引擎会读它」。实测
   *   `cand-360001@1.0.0` 声明 3 个 TUNABLE 参数、规则图引用 **0** 个 ⇒ 3 组不同取值
   *   产出的权益曲线**逐字节相同**（搜索结果是「假差异」）。缺省（`undefined`）⇒
   *   **不做**该筛查，并在 `referenceCheckApplied=false` 里如实登记（不假装查过）。
   */
  readonly referencedParameterCodes?: ReadonlySet<string>;
}

function parseDefaultValue(json: string | null): {
  readonly value: unknown;
  readonly parseFailed: boolean;
} {
  if (json === null) return { value: undefined, parseFailed: false };
  try {
    return { value: JSON.parse(json), parseFailed: false };
  } catch {
    // 历史脏数据：不假装能解析，也不编造默认值 —— 原样保留字符串并登记
    return { value: json, parseFailed: true };
  }
}

function toKind(role: string): ParameterSearchParameterKind | null {
  if (role === "FIXED" || role === "TUNABLE" || role === "DERIVED") return role;
  return null;
}

/**
 * 由**策略参数投影行**派生搜索域（规格 §3 的四种搜索形态）。
 *
 * 规则（全部来自参数自身的声明，**不猜、不给隐式默认**）：
 *   - `number` + `min/max/step` 齐备 ⇒ `INTEGER_RANGE`（三者皆整数）/ `DECIMAL_RANGE`（否则）；
 *   - `string` + `allowedValues` 非空 ⇒ `ENUM`；
 *   - `boolean` ⇒ `ENUM [true, false]`（布尔只有两种取值）；
 *   - 声明不足 ⇒ `search` 缺省 + `exclusionReason` 写明缺什么（**不编默认值**）。
 */
function buildSearchDomain(
  row: StrategyParameterProjectionRow,
): { readonly domain?: ParameterSearchDomain; readonly reason?: string } {
  const dataType = row.dataType;
  if (dataType === "number") {
    const { minValue, maxValue, stepValue } = row;
    if (minValue === null || maxValue === null || stepValue === null) {
      const missing = [
        minValue === null ? "min" : null,
        maxValue === null ? "max" : null,
        stepValue === null ? "step" : null,
      ].filter((item): item is string => item !== null);
      return { reason: `数值参数缺少 ${missing.join(" / ")}，无法构成搜索域（不编造默认边界）` };
    }
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || !Number.isFinite(stepValue)) {
      return { reason: "min / max / step 含非有限数（NaN / Infinity）" };
    }
    if (stepValue <= 0) return { reason: `step 必须 > 0，实际 ${String(stepValue)}` };
    if (minValue > maxValue) {
      return { reason: `min(${String(minValue)}) 大于 max(${String(maxValue)})，区间倒挂` };
    }
    const allIntegers =
      Number.isInteger(minValue) && Number.isInteger(maxValue) && Number.isInteger(stepValue);
    return allIntegers
      ? { domain: { mode: "INTEGER_RANGE", min: minValue, max: maxValue, step: stepValue } }
      : { domain: { mode: "DECIMAL_RANGE", min: minValue, max: maxValue, step: stepValue } };
  }
  if (dataType === "string") {
    // 投影行没有 allowedValues 列（`strategy_parameters` 未投影白名单）⇒ 无法在投影层构造 ENUM。
    // 这是**如实的能力缺口**，不允许用「空枚举」冒充，也不允许猜测取值集合。
    return {
      reason:
        "字符串参数的可选值白名单（allowedValues）未投影到 `strategy_parameters`，"
        + "投影层无法构造 ENUM 搜索域；请在创建搜索时显式给出该参数的搜索域",
    };
  }
  if (dataType === "boolean") {
    return { domain: { mode: "ENUM", values: [true, false] } };
  }
  return { reason: `未知参数类型：${String(dataType)}` };
}

/**
 * 由策略参数投影派生 Parameter Space 定义。
 *
 * 🔴 派生**只读**入参，不写库、不读库；`FIXED` / `DERIVED` 会被原样登记但**不带搜索域**。
 */
export function deriveParameterSearchSpaceFromProjection(
  input: ParameterSearchSpaceDerivationInput,
): ParameterSearchSpaceDerivation {
  const notes: string[] = [];
  const unknownRoleCodes: string[] = [];
  const unreferencedTunableCodes: string[] = [];
  const referenced = input.referencedParameterCodes;
  const referenceCheckApplied = referenced !== undefined;
  const parameters: ParameterSearchParameterDefinition[] = [];

  for (const row of [...input.parameters].sort((left, right) => left.ordinal - right.ordinal)) {
    const kind = toKind(row.parameterRole);
    if (kind === null) {
      unknownRoleCodes.push(row.code);
      parameters.push({
        name: row.code,
        type: toSearchDataType(row.dataType),
        kind: "FIXED",
        defaultValue: parseDefaultValue(row.defaultValueJson).value as never,
        required: row.required,
        ...(row.description === null ? {} : { description: row.description }),
        ...(row.unit === null ? {} : { unit: row.unit }),
        exclusionReason: `未知 parameterRole：${String(row.parameterRole)}（不猜测其可搜索性）`,
      });
      notes.push(`${row.code}：未知 parameterRole ${String(row.parameterRole)}，未进搜索空间。`);
      continue;
    }

    const parsedDefault = parseDefaultValue(row.defaultValueJson);
    const base = {
      name: row.code,
      type: toSearchDataType(row.dataType),
      kind,
      defaultValue: (parsedDefault.value ?? null) as never,
      required: row.required,
      ...(row.description === null ? {} : { description: row.description }),
      ...(row.unit === null ? {} : { unit: row.unit }),
    };

    if (!isSearchableStrategyParameter(row)) {
      parameters.push({
        ...base,
        exclusionReason:
          kind === "DERIVED"
            ? "DERIVED 参数由其他参数推导，不得直接进入搜索空间"
            : "FIXED 参数在搜索过程中不能变化，不进搜索空间",
      });
      notes.push(`${row.code}（${kind}）：不进搜索空间。`);
      continue;
    }

    const built = buildSearchDomain(row);
    if (built.domain === undefined) {
      parameters.push({ ...base, exclusionReason: built.reason ?? "无法构造搜索域" });
      notes.push(`${row.code}（TUNABLE）：${built.reason ?? "无法构造搜索域"}。`);
      continue;
    }

    /**
     * PARAMETER-002 — 死参数筛查（**唯一判据来自调用方核对的规则图引用面**）。
     *
     * 声明为 TUNABLE、但规则图里没有任何 `PARAMETER_REFERENCE` 指向它 ⇒ 搜索这一维
     * **不可能改变任何执行结果**（决策引擎读不到它）。此时把它留在搜索空间里，
     * 只会产出「N 组逐字节相同的行」，并为每组白付一次回测 —— 属于必须堵掉的静默陷阱。
     */
    if (referenceCheckApplied && !referenced.has(row.code)) {
      unreferencedTunableCodes.push(row.code);
      parameters.push({
        ...base,
        exclusionReason:
          "策略规则图未引用该参数（决策引擎读不到它）⇒ 搜索这一维不会改变任何执行结果；"
          + "请在策略文档里用「参数引用」指向该参数（如 bar.volume LESS_THAN_OR_EQUAL max_volume_ratio）后再搜索",
      });
      notes.push(
        `${row.code}（TUNABLE）：⚠️ 规则图未引用 ⇒ 不进搜索空间（搜索它只会得到重复结果）。`,
      );
      continue;
    }

    parameters.push({ ...base, search: built.domain });
    notes.push(`${row.code}（TUNABLE）：${describeParameterSearchDomain(built.domain)}。`);
  }

  if (unreferencedTunableCodes.length > 0) {
    notes.push(
      `死参数筛查：${unreferencedTunableCodes.length} 个 TUNABLE 参数未被规则图引用`
        + `（${unreferencedTunableCodes.join(" / ")}）⇒ 已排除出搜索空间。`,
    );
  }
  if (!referenceCheckApplied) {
    notes.push(
      "⚠️ 未做死参数筛查（调用方未提供规则图参数引用面）⇒ 本次搜索可能包含不改变执行结果的参数。",
    );
  }

  return {
    definition: {
      recordKind: PARAMETER_SEARCH_SPACE_RECORD_KIND,
      recordVersion: PARAMETER_SEARCH_SPACE_RECORD_VERSION,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      parameters,
      notes,
    },
    notes,
    unknownRoleCodes,
    referenceCheckApplied,
    unreferencedTunableCodes,
  };
}

function toSearchDataType(dataType: string): "number" | "string" | "boolean" {
  if (dataType === "number" || dataType === "string" || dataType === "boolean") return dataType;
  // 未知类型：登记为 string 只是承载用的标签，其 `exclusionReason` 已写明未知类型 ⇒ 不会进搜索空间
  return "string";
}

/** 人类可读的搜索域描述（错误提示 / 前端展示共用）。 */
export function describeParameterSearchDomain(domain: ParameterSearchDomain): string {
  switch (domain.mode) {
    case "FIXED":
      return `固定值 ${JSON.stringify(domain.value)}`;
    case "ENUM":
      return `枚举 ${domain.values.map((value) => JSON.stringify(value)).join(" / ")}`;
    case "INTEGER_RANGE":
      return `整数区间 [${String(domain.min)}, ${String(domain.max)}] step ${String(domain.step)}`;
    case "DECIMAL_RANGE":
      return `小数区间 [${String(domain.min)}, ${String(domain.max)}] step ${String(domain.step)}`;
  }
}

// ---------------------------------------------------------------------------
// 搜索域 → 既有 Sweep 参数定义（编译；复用既有 Cartesian Product）
// ---------------------------------------------------------------------------

/** 单个参数编译结果。 */
export interface CompiledParameter {
  readonly name: string;
  readonly sweep: SweepParameterDefinition;
}

/**
 * 把搜索域编译为既有 `SweepParameterDefinition`（唯一目的：复用
 * `generateParameterCombinations` / `calculateCombinationCount` / `computeParameterSpaceFingerprint`）。
 *
 * 🔴 编译**不改变口径**，只做形态映射；映射不成立时返回结构化 issue（不猜、不降级）。
 */
export function compileParameterSearchDomain(input: {
  readonly name: string;
  readonly type: "number" | "string" | "boolean";
  readonly domain: ParameterSearchDomain;
}): { readonly compiled?: CompiledParameter; readonly issue?: ResearchValidationIssue } {
  const path = `parameterSearchSpace.${input.name}`;
  const { domain } = input;
  switch (domain.mode) {
    case "FIXED": {
      const value = domain.value;
      if (value === null) {
        return {
          issue: {
            code: "PARAMETER_SEARCH_DOMAIN_UNCOMPILABLE",
            path,
            message: "固定值搜索域不允许为 null（null 表达不出「一个确定取值」）",
          },
        };
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          return {
            issue: {
              code: "PARAMETER_SEARCH_DOMAIN_UNCOMPILABLE",
              path,
              message: `固定值 ${String(value)} 不是有限数`,
            },
          };
        }
        return {
          compiled: {
            name: input.name,
            sweep: { type: "number", name: input.name, min: value, max: value, step: 1 },
          },
        };
      }
      if (typeof value === "boolean") {
        return { compiled: { name: input.name, sweep: { type: "boolean", name: input.name, values: [value] } } };
      }
      return { compiled: { name: input.name, sweep: { type: "enum", name: input.name, values: [value] } } };
    }
    case "ENUM": {
      const values = domain.values;
      if (values.length === 0) {
        return {
          issue: { code: "PARAMETER_SEARCH_ENUM_EMPTY", path, message: "enum 搜索域不能为空" },
        };
      }
      if (values.some((value) => value === null)) {
        return {
          issue: {
            code: "PARAMETER_SEARCH_ENUM_INVALID",
            path,
            message: "enum 搜索域不允许包含 null（null 不进搜索空间）",
          },
        };
      }
      const allBoolean = values.every((value) => typeof value === "boolean");
      if (allBoolean) {
        return {
          compiled: {
            name: input.name,
            sweep: { type: "boolean", name: input.name, values: values as boolean[] },
          },
        };
      }
      const allString = values.every((value) => typeof value === "string");
      if (allString) {
        return {
          compiled: {
            name: input.name,
            sweep: { type: "enum", name: input.name, values: values as string[] },
          },
        };
      }
      // 数值枚举：既有 Sweep 只有「等步长区间」形态，任意数值集合无法无损表达 ⇒ 拒绝（不近似）
      return {
        issue: {
          code: "PARAMETER_SEARCH_DOMAIN_UNCOMPILABLE",
          path,
          message:
            "数值型 enum 搜索域无法映射到既有 Sweep 参数形态（既有实现只支持等步长区间）；"
            + "请改用 INTEGER_RANGE / DECIMAL_RANGE，或把取值收敛为等步长序列",
        },
      };
    }
    case "INTEGER_RANGE": {
      const issue = validateRangeIssue(path, domain);
      if (issue !== undefined) return { issue };
      return {
        compiled: {
          name: input.name,
          sweep: {
            type: "integer",
            name: input.name,
            min: domain.min,
            max: domain.max,
            step: domain.step,
          },
        },
      };
    }
    case "DECIMAL_RANGE": {
      const issue = validateRangeIssue(path, domain);
      if (issue !== undefined) return { issue };
      return {
        compiled: {
          name: input.name,
          sweep: {
            type: "number",
            name: input.name,
            min: domain.min,
            max: domain.max,
            step: domain.step,
          },
        },
      };
    }
  }
}

function validateRangeIssue(
  path: string,
  domain: { readonly min: number; readonly max: number; readonly step: number },
): ResearchValidationIssue | undefined {
  if (!Number.isFinite(domain.min) || !Number.isFinite(domain.max) || !Number.isFinite(domain.step)) {
    return {
      code: "PARAMETER_SEARCH_RANGE_NOT_FINITE",
      path,
      message: "min / max / step 必须是有限数字（禁止 NaN / Infinity）",
    };
  }
  if (domain.step <= 0) {
    return {
      code: "PARAMETER_SEARCH_STEP_INVALID",
      path,
      message: `step 必须 > 0，实际 ${String(domain.step)}`,
    };
  }
  if (domain.min > domain.max) {
    return {
      code: "PARAMETER_SEARCH_RANGE_ORDER",
      path,
      message: `min(${String(domain.min)}) 不能大于 max(${String(domain.max)})`,
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 校验（规格 §5）
// ---------------------------------------------------------------------------

/** 搜索空间的**声明面**（用于「参数必须存在于 Strategy Schema」的核对）。 */
export interface ParameterSearchDeclaredParameter {
  readonly code: string;
  readonly dataType: string;
  readonly parameterRole: string;
}

/**
 * 校验参数空间定义。覆盖规格 §5 全部条目：
 *   参数名不重复 / 参数必须存在于 Strategy Schema / 类型必须匹配 /
 *   range 合法 / step > 0 / enum 不能为空 / DERIVED 不得直接搜索 / FIXED 不得进搜索空间。
 *
 * `declared` 缺省时**跳过**「存在于 Strategy Schema」与「类型匹配」两项，并在结果里如实注明
 * （哨兵字段 `schemaChecked`），不假装校验过。
 */
export function validateParameterSearchSpace(
  definition: ParameterSearchSpaceDefinition,
  declared?: readonly ParameterSearchDeclaredParameter[],
): ResearchValidationResult & { readonly schemaChecked: boolean } {
  const issues: ResearchValidationIssue[] = [];
  if (!definition || typeof definition !== "object" || !Array.isArray(definition.parameters)) {
    return {
      valid: false,
      issues: [
        {
          code: "PARAMETER_SEARCH_SPACE_INVALID",
          path: "parameterSearchSpace",
          message: "parameterSearchSpace.parameters 必须是数组",
        },
      ],
      schemaChecked: false,
    };
  }

  const declaredByCode = new Map<string, ParameterSearchDeclaredParameter>();
  for (const item of declared ?? []) declaredByCode.set(item.code, item);
  const schemaChecked = declared !== undefined && declaredByCode.size > 0;

  const seen = new Set<string>();
  for (const parameter of definition.parameters) {
    const path = `parameterSearchSpace.${String(parameter?.name ?? "<unnamed>")}`;

    if (typeof parameter?.name !== "string" || parameter.name.trim() === "") {
      issues.push({
        code: "PARAMETER_SEARCH_PARAM_NAME_EMPTY",
        path: "parameterSearchSpace",
        message: "参数名不能为空",
      });
      continue;
    }
    if (!PARAMETER_NAME_RE.test(parameter.name)) {
      issues.push({
        code: "PARAMETER_SEARCH_PARAM_NAME_INVALID",
        path,
        message: `参数名须匹配 ${String(PARAMETER_NAME_RE)}`,
      });
    }
    if (seen.has(parameter.name)) {
      issues.push({
        code: "PARAMETER_SEARCH_PARAM_DUPLICATE",
        path,
        message: `参数名重复：${parameter.name}`,
      });
      continue;
    }
    seen.add(parameter.name);

    const kindIssue = checkKind(parameter, path);
    if (kindIssue !== undefined) issues.push(kindIssue);

    if (schemaChecked) {
      const declaredParameter = declaredByCode.get(parameter.name);
      if (declaredParameter === undefined) {
        issues.push({
          code: "PARAMETER_SEARCH_PARAM_UNKNOWN",
          path,
          message:
            `参数 ${parameter.name} 不存在于策略 Schema（禁止 Parameter Search 自造参数）；`
            + `已声明：${[...declaredByCode.keys()].join(" / ") || "（无）"}`,
        });
      } else {
        if (declaredParameter.dataType !== parameter.type) {
          issues.push({
            code: "PARAMETER_SEARCH_PARAM_TYPE_MISMATCH",
            path,
            message:
              `参数类型不匹配：策略 Schema 声明 ${declaredParameter.dataType}，`
              + `搜索空间声明 ${parameter.type}`,
          });
        }
        if (declaredParameter.parameterRole !== parameter.kind) {
          issues.push({
            code: "PARAMETER_SEARCH_PARAM_ROLE_MISMATCH",
            path,
            message:
              `参数分类不匹配：策略 Schema 声明 ${declaredParameter.parameterRole}，`
              + `搜索空间声明 ${parameter.kind}`,
          });
        }
      }
    }

    if (parameter.search === undefined) {
      /**
       * 🔴 PARAMETER-002 — 「TUNABLE 却缺搜索域」要分两类，否则会给出**误导性**的排错方向：
       *   ① **无 `exclusionReason`** ⇒ 真的是配置缺失（调用方漏给搜索域）⇒ 报错；
       *   ② **有 `exclusionReason`** ⇒ 是**刻意排除**（如「规则图未引用该参数」= 死参数）
       *      ⇒ 不是错误，原因已逐条登记在 `exclusionReason` / 派生 notes 里。
       * 首版把 ② 也当成 ① 报 `TUNABLE_WITHOUT_DOMAIN`，导致真正的死参数原因被掩盖
       * （实测：错误信息只说「缺少搜索域」，用户会去补搜索域而不是去修文档）。
       */
      if (isSearchableStrategyParameter({ parameterRole: parameter.kind }) && parameter.exclusionReason === undefined) {
        issues.push({
          code: "PARAMETER_SEARCH_TUNABLE_WITHOUT_DOMAIN",
          path,
          message: `TUNABLE 参数 ${parameter.name} 缺少搜索域`,
        });
      }
      continue;
    }

    const compiled = compileParameterSearchDomain({
      name: parameter.name,
      type: parameter.type,
      domain: parameter.search,
    });
    if (compiled.issue !== undefined) issues.push(compiled.issue);
  }

  return { valid: issues.length === 0, issues, schemaChecked };
}

function checkKind(
  parameter: ParameterSearchParameterDefinition,
  path: string,
): ResearchValidationIssue | undefined {
  if (
    parameter.kind !== "FIXED"
    && parameter.kind !== "TUNABLE"
    && parameter.kind !== "DERIVED"
  ) {
    return {
      code: "PARAMETER_SEARCH_PARAM_KIND_INVALID",
      path,
      message: `未知参数分类：${String(parameter.kind)}（须为 FIXED | TUNABLE | DERIVED）`,
    };
  }
  if (parameter.kind === "DERIVED" && parameter.search !== undefined) {
    return {
      code: "PARAMETER_SEARCH_DERIVED_NOT_SEARCHABLE",
      path,
      message: `DERIVED 参数 ${parameter.name} 不得直接进入搜索空间（由其他参数推导）`,
    };
  }
  if (parameter.kind === "FIXED" && parameter.search !== undefined) {
    return {
      code: "PARAMETER_SEARCH_FIXED_NOT_SEARCHABLE",
      path,
      message: `FIXED 参数 ${parameter.name} 不得进入搜索空间（搜索过程中不能变化）`,
    };
  }
  return undefined;
}

/** 断言参数空间合法，否则抛 `ResearchValidationError`。 */
export function assertValidParameterSearchSpace(
  definition: ParameterSearchSpaceDefinition,
  declared?: readonly ParameterSearchDeclaredParameter[],
): void {
  const result = validateParameterSearchSpace(definition, declared);
  if (!result.valid) throw new ResearchValidationError(result.issues);
}

// ---------------------------------------------------------------------------
// 编译为既有 ParameterSpace / 读取搜索参数
// ---------------------------------------------------------------------------

/** 进搜索空间的参数（`kind === TUNABLE` 且带搜索域）。 */
export function searchableParameters(
  definition: ParameterSearchSpaceDefinition,
): readonly ParameterSearchParameterDefinition[] {
  return definition.parameters.filter(
    (parameter) => isSearchableStrategyParameter({ parameterRole: parameter.kind }) && parameter.search !== undefined,
  );
}

/**
 * 编译为**既有** `ParameterSpace`（`server/research/parameterSpace.ts`）。
 *
 * 目的：让组合生成 / 计数 / 指纹 / 校验全部走既有唯一实现（禁第二套）。
 * 不合法时抛 `ResearchValidationError`（响亮，不降级）。
 */
export function compileSearchSpaceToParameterSpace(
  definition: ParameterSearchSpaceDefinition,
  declared?: readonly ParameterSearchDeclaredParameter[],
): ParameterSpace {
  assertValidParameterSearchSpace(definition, declared);
  const parameters: SweepParameterDefinition[] = [];
  for (const parameter of searchableParameters(definition)) {
    const compiled = compileParameterSearchDomain({
      name: parameter.name,
      type: parameter.type,
      domain: parameter.search as ParameterSearchDomain,
    });
    if (compiled.compiled === undefined) {
      throw new ResearchValidationError(
        compiled.issue === undefined
          ? [{ code: "PARAMETER_SEARCH_DOMAIN_UNCOMPILABLE", path: parameter.name, message: "无法编译搜索域" }]
          : [compiled.issue],
      );
    }
    parameters.push(compiled.compiled.sweep);
  }
  return { parameters };
}

/** 派生面汇总（供 API 返回「派生了什么、排除了什么」，禁静默）。 */
export interface ParameterSearchSpaceSummary {
  readonly searchable: readonly string[];
  readonly fixed: readonly string[];
  readonly derived: readonly string[];
  readonly excluded: readonly { readonly name: string; readonly reason: string }[];
}

/** 汇总参数空间分类（供 UI / 报告显示）。 */
export function summarizeParameterSearchSpace(
  definition: ParameterSearchSpaceDefinition,
): ParameterSearchSpaceSummary {
  const searchable: string[] = [];
  const fixed: string[] = [];
  const derived: string[] = [];
  const excluded: { name: string; reason: string }[] = [];
  for (const parameter of definition.parameters) {
    if (isSearchableStrategyParameter({ parameterRole: parameter.kind }) && parameter.search !== undefined) {
      searchable.push(parameter.name);
      continue;
    }
    if (parameter.kind === "FIXED") fixed.push(parameter.name);
    else if (parameter.kind === "DERIVED") derived.push(parameter.name);
    excluded.push({
      name: parameter.name,
      reason: parameter.exclusionReason ?? "未进搜索空间（原因未登记）",
    });
  }
  return { searchable, fixed, derived, excluded };
}

/**
 * 覆盖搜索域（创建搜索时前端可逐参数覆盖；**只允许覆盖已声明参数**）。
 *
 * 🔴 覆盖不得改变分类：`FIXED` / `DERIVED` 参数**拒绝**被赋予搜索域（响亮拒绝，不静默忽略）。
 *
 * ⚠️ PARAMETER-002：本函数**不**负责「死参数」（规则图未引用）筛查 —— 那一层由
 *   `executor#createParameterSearchRun` 在**覆盖之后**应用（`excludeUnreferencedDomains`），
 *   否则显式覆盖会把死参数重新塞回搜索空间（实测踩到）。
 */
export function applySearchDomainOverrides(
  definition: ParameterSearchSpaceDefinition,
  overrides: readonly { readonly name: string; readonly domain: ParameterSearchDomain }[],
): { readonly definition: ParameterSearchSpaceDefinition; readonly issues: readonly ResearchValidationIssue[] } {
  const issues: ResearchValidationIssue[] = [];
  const byName = new Map(overrides.map((override) => [override.name, override.domain]));
  for (const name of byName.keys()) {
    if (!definition.parameters.some((parameter) => parameter.name === name)) {
      issues.push({
        code: "PARAMETER_SEARCH_OVERRIDE_UNKNOWN_PARAM",
        path: `parameterSearchSpace.${name}`,
        message: `覆盖了不存在的参数：${name}`,
      });
    }
  }
  const parameters = definition.parameters.map((parameter) => {
    const domain = byName.get(parameter.name);
    if (domain === undefined) return parameter;
    if (!isSearchableStrategyParameter({ parameterRole: parameter.kind })) {
      issues.push({
        code:
          parameter.kind === "DERIVED"
            ? "PARAMETER_SEARCH_DERIVED_NOT_SEARCHABLE"
            : "PARAMETER_SEARCH_FIXED_NOT_SEARCHABLE",
        path: `parameterSearchSpace.${parameter.name}`,
        message:
          parameter.kind === "DERIVED"
            ? `DERIVED 参数 ${parameter.name} 不得被赋予搜索域`
            : `FIXED 参数 ${parameter.name} 不得被赋予搜索域`,
      });
      return parameter;
    }
    const { exclusionReason: _dropped, ...rest } = parameter;
    return { ...rest, search: domain };
  });
  return {
    definition: { ...definition, parameters },
    issues,
  };
}

// ---------------------------------------------------------------------------
// PARAMETER-002 — 死参数排除（**必须在覆盖之后应用**）
// ---------------------------------------------------------------------------

/**
 * 把「规则图未引用」的参数从搜索空间里**彻底剥离**（无论它当前有没有搜索域）。
 *
 * 🔴 为什么必须放在**覆盖之后**：`applySearchDomainOverrides` 能给任意 TUNABLE 参数赋搜索域，
 *   若先剥离再覆盖，一个显式覆盖就能把死参数**重新塞回**搜索空间
 *   （实测踩到：三个死参数被覆盖后 `searchable` 又变成 3 个）。⇒ 顺序是纪律：
 *   `派生 → 覆盖 → 死参数剥离 → 校验`。
 *
 * 剥离只清 `search` 并写明 `exclusionReason`，**不改 `kind`**（分类是策略 schema 的事实，
 * 不因本次搜索的取舍而改写）。
 */
export function excludeUnreferencedDomains(
  definition: ParameterSearchSpaceDefinition,
  unreferencedCodes: ReadonlySet<string>,
): ParameterSearchSpaceDefinition {
  return {
    ...definition,
    parameters: definition.parameters.map((parameter) => {
      if (!unreferencedCodes.has(parameter.name)) return parameter;
      const { search: _dropped, ...rest } = parameter;
      return {
        ...rest,
        exclusionReason:
          "策略规则图未引用该参数（决策引擎读不到它）⇒ 搜索这一维不会改变任何执行结果；"
          + "请在策略文档里用「参数引用」指向该参数（如 bar.volumeRatio LESS_THAN_OR_EQUAL max_volume_ratio）后再搜索",
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// 快照 JSON（落库 / 回读）
// ---------------------------------------------------------------------------

/** 序列化参数空间快照（落地 `parameter_search_run.parameterSpaceJson`）。 */
export function serializeParameterSearchSpace(definition: ParameterSearchSpaceDefinition): string {
  return JSON.stringify(definition);
}

/**
 * 反序列化参数空间快照（**结构校验**，非法即抛）。
 *
 * 🔴 历史 Read：`parameterSearch` 列可能为 `longtext` ⇒ 调用方拿到的是字符串，必须在此解析；
 *   结构不合法**响亮抛错**，绝不返回半个对象让上层拿 `undefined` 当真值。
 */
export function deserializeParameterSearchSpace(json: string): ParameterSearchSpaceDefinition {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_SPACE_SNAPSHOT_INVALID",
        path: "parameterSpaceJson",
        message: "参数空间快照不是对象",
      },
    ]);
  }
  const candidate = parsed as ParameterSearchSpaceDefinition;
  assertValidParameterSearchSpace(candidate);
  return candidate;
}
