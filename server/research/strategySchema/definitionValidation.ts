/**
 * STEP STRATEGY-003 — StrategyDefinition 校验器（纯函数；结构 + Look-Ahead）。
 *
 * 复用既有校验体系（不自造第二套 Framework，SPEC §十）：
 *   - 返回 `ResearchValidationResult`（不抛错），`assertValidCanonicalStrategyDefinition` 失败即抛
 *     `ResearchValidationError`（风格对齐 strategySchema/validate.ts）；
 *   - 参数的数值自洽性（defaultValue 越界 / min>max / step 等）**委托**既有
 *     `validateParameterSchema`，本层只补充 Strategy 特有的 role / TUNABLE 范围等规则。
 *
 * Look-Ahead 静态校验（SPEC §11 / §28 / §十二；本任务的重点）：
 *   判定依据是**字段时间域目录**（`definition.ts` 的 `parseStrategyFieldReference` /
 *   `resolveFieldTimeDomain`），规则如下：
 *
 *   L1 `UNKNOWN_FIELD_TIME_DOMAIN`：引用无法判定时间域（根不合法 / 形态不匹配）→ 拒绝。
 *      **默认拒绝**，而非「黑名单命中 future 才拒绝」——后者可被命名绕过（SPEC §十一 规则 2）。
 *   L2 `UNKNOWN_FIELD_REFERENCE`：时间域可判定，但字段不在该层白名单内 → 拒绝（防拼写漂移）。
 *   L3 `INVALID_FUTURE_REFERENCE`：引用 `path.*` / `outcome.*`（Dataset 明示「前视，仅打标签」）
 *      → 拒绝。这两个层是标签层，作为信号条件输入即为未来数据泄漏。
 *   L4 `INVALID_FUTURE_REFERENCE`：引用 `post.rd{n}` 且 `n > 允许的最大前视相对日`
 *      （= `resolveSignalTimeline().maxReferencableOffset`）→ 拒绝。
 *      「允许的最大前视相对日」由 trigger 决定的**最早可能信号偏移**给出：
 *      在该 bar 上求值时，只可能读到它自己及之前的数据。
 *   L5 `SIGNAL_TIMELINE_UNRESOLVABLE`：窗口单位非 `TRADING_DAY` 时无法把窗口映射到
 *      Dataset 的交易日 `relativeDay` 坐标系 ⇒ 任何 `post.rd{n}` 引用一律拒绝（宁严不宽）。
 *   L6 `SIGNAL_EXECUTION_TIMING_CONFLICT`：成交不得早于信号（`signalTiming=T_CLOSE`
 *      时禁止 `executionTiming=T_CLOSE` 同 bar 收盘成交 —— 本项目 T+1 模型）。
 *   L7 `TRIGGER_EXECUTION_INCONSISTENT`：`trigger=NEXT_TRADING_DAY`（信号已顺延一日）
 *      时，`executionTiming` 必须是 `T_PLUS_1_*` 或更晚（SPEC §十一 规则 3）。
 *   L8 `PRICE_TYPE_TIMING_MISMATCH`：`priceType` 必须与 `executionTiming` 的开/收盘语义一致。
 *
 * ⚠️ 诚实边界：以上都是**声明层静态**检查，只能证明「Definition 声明的引用不越界」，
 * 不能证明运行时执行器没有旁路读取未来数据。该边界在报告中显式声明，不冒充已解决。
 *
 * ⚠️ issue.path 语义：**以 StrategyDefinition 根为基准**（如 `exit.rules[0].thresholdUnit`），
 * **不含** `definition.` 前缀。本校验器只认识「一个 StrategyDefinition」，
 * 嵌入 StrategyDocument 时由调用方（map.ts / validate.ts）rebase 成 `definition.…`，
 * 避免同一路径被前缀两次（`definition.definition.exit.…`）。
 */

import { isValidDatasetVersionFormat } from "../experimentLineage/validate";
import { validateParameterSchema } from "../experimentValidation";
import type { ResearchParameterSchema, ResearchParameterValue } from "../types";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "../experimentValidation";
import {
  STRATEGY_BAR_FIELDS,
  STRATEGY_CONDITION_OPERATORS,
  STRATEGY_CONDITION_VALUE_TYPES,
  STRATEGY_COST_MODELS,
  STRATEGY_DATASET_ROLES,
  STRATEGY_DATASET_VERSION_LABEL_RE,
  isValidDatasetVersionId,
  STRATEGY_DEFINITION_SCHEMA_VERSIONS,
  STRATEGY_EVENT_FIELDS,
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
  isKnownFieldReference,
  isValidObservationWindow,
  parseStrategyFieldReference,
  resolveSignalTimeline,
  type ConditionDefinition,
  type StrategyDefinition,
} from "./definition";

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function result(issues: ResearchValidationIssue[]): ResearchValidationResult {
  return { valid: issues.length === 0, issues };
}

const PARAMETER_CODE_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value: unknown): value is ResearchParameterValue {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function inWhitelist<T extends string>(value: unknown, whitelist: readonly T[]): value is T {
  return typeof value === "string" && (whitelist as readonly string[]).includes(value);
}

function checkOptionalRatio(value: unknown, path: string, label: string, issues: ResearchValidationIssue[]): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    issues.push(issue("SCHEMA_DEFINITION_RATIO_INVALID", path, `${label} 必须是 (0, 1] 的有限数字，实际：${String(value)}`));
  }
}

// ---------------------------------------------------------------------------
// L1–L5：字段引用 / Look-Ahead
// ---------------------------------------------------------------------------

/**
 * 校验一个字段引用（条件的左值一定是字段引用；右值仅在 `valueType=FIELD_REFERENCE` 时是）。
 *
 * @param maxForwardOffset 允许引用的最大前视相对日（`post.rd{n}` 的 n 上界）。
 * @param timelineResolvable 观测窗口能否映射到交易日坐标系。
 */
function checkFieldReference(
  field: unknown,
  path: string,
  label: string,
  maxForwardOffset: number,
  timelineResolvable: boolean,
  issues: ResearchValidationIssue[],
): void {
  if (typeof field !== "string" || field.trim() === "") {
    issues.push(issue("SCHEMA_DEFINITION_FIELD_REFERENCE_INVALID", path, `${label} 必须是非空字段引用字符串`));
    return;
  }
  const reference = parseStrategyFieldReference(field);
  if (reference.kind === "unknown") {
    issues.push(issue(
      "UNKNOWN_FIELD_TIME_DOMAIN",
      path,
      `${label} 无法判定时间域（未知引用形态）：${reference.raw}。` +
      "合法形态：prefix.rd{n}.{field}（n<=0）/ event.{field} / bar.{field} / post.rd{n}.{field}（n>=1）；" +
      "无法判定时间域的引用默认禁止作为信号条件（SPEC §26）",
    ));
    return;
  }
  if (reference.kind === "labelOnly") {
    // 先于字段白名单判定：标签层是「结构性错误」，报 INVALID_FUTURE_REFERENCE 比报未知字段更有用。
    issues.push(issue(
      "INVALID_FUTURE_REFERENCE",
      path,
      `${label} 引用了 Dataset 的「前视，仅打标签」层 ${reference.root}.*（${field}）：` +
      "该层数据在信号时刻不可得，作为信号条件输入构成未来数据泄漏（Look-Ahead Bias）",
    ));
    return;
  }
  if (!isKnownFieldReference(reference)) {
    const whitelist = reference.kind === "eventDay"
      ? `event 层白名单：${[...STRATEGY_EVENT_FIELDS].join(" | ")}`
      : `prefix / post / bar 层白名单：${[...STRATEGY_BAR_FIELDS].join(" | ")}`;
    issues.push(issue(
      "UNKNOWN_FIELD_REFERENCE",
      path,
      `${label} 的字段名不在对应白名单内：${field}（${whitelist}）`,
    ));
    return;
  }
  if (reference.kind === "forwardBar") {
    if (!timelineResolvable) {
      issues.push(issue(
        "SIGNAL_TIMELINE_UNRESOLVABLE",
        path,
        `${label} 引用了前视窗口行情 ${field}，但观察窗口单位为 CALENDAR_DAY，` +
        "无法映射到 Dataset 的交易日 relativeDay 坐标系，因此无法证明其 PIT 安全；改为 TRADING_DAY 或移除该引用",
      ));
      return;
    }
    if (reference.relativeDay > maxForwardOffset) {
      issues.push(issue(
        "INVALID_FUTURE_REFERENCE",
        path,
        `${label} 引用了 post.rd${reference.relativeDay}（${field}），` +
        `但最早可能产生信号的相对日只有 T+${maxForwardOffset}：在该 bar 上求值需要读取未来数据`,
      ));
    }
  }
}

/** 校验单条 Condition（左值必为字段引用；右值按 valueType 分派）。 */
function checkCondition(
  raw: unknown,
  path: string,
  label: string,
  maxForwardOffset: number,
  timelineResolvable: boolean,
  parameterCodes: ReadonlySet<string>,
  issues: ResearchValidationIssue[],
): void {
  if (!isPlainObject(raw)) {
    issues.push(issue("SCHEMA_DEFINITION_CONDITION_INVALID", path, `${label} 必须是条件对象`));
    return;
  }
  const condition = raw as unknown as ConditionDefinition;

  if (condition.id !== undefined && condition.id !== null) {
    if (typeof condition.id !== "string" || condition.id.trim() === "") {
      issues.push(issue("SCHEMA_DEFINITION_CONDITION_ID_INVALID", `${path}.id`, `${label} 的 id 若提供必须是非空字符串`));
    }
  }
  if (!inWhitelist(condition.operator, STRATEGY_CONDITION_OPERATORS)) {
    issues.push(issue(
      "SCHEMA_DEFINITION_CONDITION_OPERATOR_INVALID",
      `${path}.operator`,
      `${label} 的 operator 必须是 ${STRATEGY_CONDITION_OPERATORS.join(" | ")} 之一，实际：${String(condition.operator)}`,
    ));
  }
  if (typeof condition.enabled !== "boolean") {
    issues.push(issue("SCHEMA_DEFINITION_CONDITION_ENABLED_INVALID", `${path}.enabled`, `${label} 的 enabled 必须是布尔值`));
  }
  checkFieldReference(condition.field, `${path}.field`, `${label} 的左值 field`, maxForwardOffset, timelineResolvable, issues);

  if (!inWhitelist(condition.valueType, STRATEGY_CONDITION_VALUE_TYPES)) {
    issues.push(issue(
      "SCHEMA_DEFINITION_CONDITION_VALUE_TYPE_INVALID",
      `${path}.valueType`,
      `${label} 的 valueType 必须是 ${STRATEGY_CONDITION_VALUE_TYPES.join(" | ")} 之一，实际：${String(condition.valueType)}`,
    ));
    return;
  }

  const isSetOperator = condition.operator === "IN" || condition.operator === "NOT_IN";
  const value = condition.value;

  if (condition.valueType === "FIELD_REFERENCE") {
    if (typeof value !== "string") {
      issues.push(issue("SCHEMA_DEFINITION_CONDITION_VALUE_INVALID", `${path}.value`, `${label} 的 FIELD_REFERENCE 右值必须是字段引用字符串`));
      return;
    }
    checkFieldReference(value, `${path}.value`, `${label} 的右值`, maxForwardOffset, timelineResolvable, issues);
    return;
  }

  if (condition.valueType === "PARAMETER_REFERENCE") {
    if (typeof value !== "string" || value.trim() === "") {
      issues.push(issue("SCHEMA_DEFINITION_CONDITION_VALUE_INVALID", `${path}.value`, `${label} 的 PARAMETER_REFERENCE 右值必须是非空参数 code`));
      return;
    }
    if (!parameterCodes.has(value)) {
      issues.push(issue(
        "SCHEMA_DEFINITION_CONDITION_PARAMETER_UNKNOWN",
        `${path}.value`,
        `${label} 引用了不存在的参数 code：${value}`,
      ));
    }
    return;
  }

  // CONSTANT
  if (isSetOperator) {
    if (!Array.isArray(value) || value.length === 0 || !value.every(isScalar)) {
      issues.push(issue(
        "SCHEMA_DEFINITION_CONDITION_VALUE_INVALID",
        `${path}.value`,
        `${label} 使用 ${condition.operator} 时右值必须是非空的标量数组`,
      ));
    }
    return;
  }
  if (Array.isArray(value) || !isScalar(value)) {
    issues.push(issue(
      "SCHEMA_DEFINITION_CONDITION_VALUE_INVALID",
      `${path}.value`,
      `${label} 的 CONSTANT 右值必须是有限标量（number | string | boolean | null）`,
    ));
  }
}

// ---------------------------------------------------------------------------
// 主体校验
// ---------------------------------------------------------------------------

/**
 * 校验 StrategyDefinition（结构化 issue 清单）。
 * 覆盖 SPEC §27 的 Definition / Parameter / Entry / Exit / Execution 五组，外加 §28 的 Look-Ahead 组。
 */
export function validateCanonicalStrategyDefinition(definition: StrategyDefinition | undefined | null): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!isPlainObject(definition)) {
    return result([issue("SCHEMA_DEFINITION_INVALID", "definition", "StrategyDefinition 缺失或非对象")]);
  }
  const d = definition as unknown as StrategyDefinition;

  if (!inWhitelist(d.schemaVersion, STRATEGY_DEFINITION_SCHEMA_VERSIONS)) {
    issues.push(issue(
      "SCHEMA_DEFINITION_SCHEMA_VERSION_INVALID",
      "schemaVersion",
      `schemaVersion 必须是 ${STRATEGY_DEFINITION_SCHEMA_VERSIONS.join(" | ")} 之一（Definition 结构版本，≠ strategy version），实际：${String(d.schemaVersion)}`,
    ));
  }

  // -- 参数（先算 parameterCodes，供 condition / exit / position 引用解析） --
  const parameterCodes = new Set<string>();
  const parameters = d.parameters as unknown;
  if (!Array.isArray(parameters)) {
    issues.push(issue("SCHEMA_DEFINITION_PARAMETERS_INVALID", "parameters", "parameters 必须是数组"));
  } else {
    const seen = new Set<string>();
    parameters.forEach((raw, index) => {
      const base = `parameters[${index}]`;
      if (!isPlainObject(raw)) {
        issues.push(issue("SCHEMA_DEFINITION_PARAMETER_INVALID", base, `第 ${index} 个参数必须是对象`));
        return;
      }
      const code = raw.code;
      if (typeof code !== "string" || code.trim() === "") {
        issues.push(issue("SCHEMA_DEFINITION_PARAMETER_CODE_EMPTY", `${base}.code`, "参数 code 必须是非空字符串"));
      } else {
        if (!PARAMETER_CODE_RE.test(code)) {
          issues.push(issue("SCHEMA_DEFINITION_PARAMETER_CODE_FORMAT", `${base}.code`, `参数 code 必须匹配 ${PARAMETER_CODE_RE.source}，实际：${code}`));
        }
        if (seen.has(code)) {
          issues.push(issue("SCHEMA_DEFINITION_PARAMETER_CODE_DUPLICATE", `${base}.code`, `参数 code=${code} 重复，版本内必须唯一`));
        }
        seen.add(code);
        parameterCodes.add(code);
      }
      if (typeof raw.name !== "string" || raw.name.trim() === "") {
        issues.push(issue("SCHEMA_DEFINITION_PARAMETER_NAME_EMPTY", `${base}.name`, "参数 name 必须是非空字符串"));
      }
      if (!inWhitelist(raw.dataType, STRATEGY_PARAMETER_DATA_TYPES)) {
        issues.push(issue(
          "SCHEMA_DEFINITION_PARAMETER_DATATYPE_INVALID",
          `${base}.dataType`,
          `参数 dataType 必须是 ${STRATEGY_PARAMETER_DATA_TYPES.join(" | ")} 之一，实际：${String(raw.dataType)}`,
        ));
      }
      if (typeof raw.required !== "boolean") {
        issues.push(issue("SCHEMA_DEFINITION_PARAMETER_REQUIRED_INVALID", `${base}.required`, "参数 required 必须是布尔值"));
      }

      const role = raw.parameterRole;
      if (!inWhitelist(role, STRATEGY_PARAMETER_ROLES)) {
        issues.push(issue(
          "SCHEMA_DEFINITION_PARAMETER_ROLE_INVALID",
          `${base}.parameterRole`,
          `参数 parameterRole 必须是 ${STRATEGY_PARAMETER_ROLES.join(" | ")} 之一，实际：${String(role)}`,
        ));
      } else if (role === "TUNABLE") {
        // SPEC §27：TUNABLE 参数范围必须完整，否则 Parameter Search 无法界定搜索空间。
        if (raw.dataType === "number") {
          if (typeof raw.min !== "number" || !Number.isFinite(raw.min)
            || typeof raw.max !== "number" || !Number.isFinite(raw.max)) {
            issues.push(issue(
              "SCHEMA_DEFINITION_PARAMETER_ROLE_TUNABLE_RANGE",
              base,
              `TUNABLE 数值参数 ${String(code)} 必须同时声明 min 与 max（Parameter Search 的搜索空间上界/下界）`,
            ));
          }
        } else if (!Array.isArray(raw.allowedValues) || raw.allowedValues.length === 0) {
          issues.push(issue(
            "SCHEMA_DEFINITION_PARAMETER_ROLE_TUNABLE_RANGE",
            base,
            `TUNABLE 非数值参数 ${String(code)} 必须声明非空 allowedValues（搜索候选集合）`,
          ));
        }
      } else if (role === "DERIVED") {
        if (typeof raw.derivedFrom !== "string" || raw.derivedFrom.trim() === "") {
          issues.push(issue(
            "SCHEMA_DEFINITION_PARAMETER_DERIVED_SOURCE",
            `${base}.derivedFrom`,
            `DERIVED 参数 ${String(code)} 必须声明 derivedFrom（推导表达式，否则 DERIVED 语义不可解释）`,
          ));
        }
      }

      if (raw.step !== undefined && raw.step !== null) {
        if (typeof raw.step !== "number" || !Number.isFinite(raw.step) || raw.step <= 0) {
          issues.push(issue("SCHEMA_DEFINITION_PARAMETER_STEP_INVALID", `${base}.step`, "参数 step 必须是 > 0 的有限数字"));
        }
      }
    });

    // 数值自洽性（defaultValue 越界 / min > max / 类型不匹配）委托既有校验器，不重复实现。
    const derivedSchema: ResearchParameterSchema = {
      parameters: parameters.filter(isPlainObject).map((item) => ({
        name: String(item.code ?? ""),
        type: (item.dataType ?? "number") as ResearchParameterSchema["parameters"][number]["type"],
        required: item.required === true,
        ...(item.defaultValue === undefined ? {} : { defaultValue: item.defaultValue as ResearchParameterValue }),
        ...(typeof item.nullable === "boolean" ? { nullable: item.nullable } : {}),
        ...(typeof item.min === "number" ? { min: item.min } : {}),
        ...(typeof item.max === "number" ? { max: item.max } : {}),
        ...(typeof item.step === "number" ? { step: item.step } : {}),
        ...(Array.isArray(item.allowedValues) ? { allowedValues: item.allowedValues as string[] } : {}),
      })),
    };
    issues.push(...validateParameterSchema(derivedSchema).issues.map((item) => ({
      code: item.code,
      path: item.path === "parameterSchema"
        ? "parameters"
        : `parameters${item.path.slice("parameterSchema".length)}`,
      message: item.message,
    })));
  }

  // -- Entry --
  // 时间线在 Entry 段解出，但 Exit 段的附加条件也要用同一套边界，因此在段外声明。
  let timelineResolvable = false;
  let maxForwardOffset = -1;
  const entry = d.entry as unknown;
  if (!isPlainObject(entry)) {
    issues.push(issue("SCHEMA_DEFINITION_ENTRY_INVALID", "entry", "entry 必须是对象"));
  } else {
    const event = entry.event;
    if (!isPlainObject(event)) {
      issues.push(issue("SCHEMA_DEFINITION_ENTRY_EVENT_INVALID", "entry.event", "entry.event 必须是对象"));
    } else if (!inWhitelist(event.type, STRATEGY_EVENT_TYPES)) {
      issues.push(issue(
        "SCHEMA_DEFINITION_ENTRY_EVENT_TYPE_INVALID",
        "entry.event.type",
        `entry.event.type 必须是 ${STRATEGY_EVENT_TYPES.join(" | ")} 之一（扩展用 CUSTOM_EVENT + params），实际：${String(event.type)}`,
      ));
    }

    const window = entry.observationWindow as unknown;
    if (!isPlainObject(window)) {
      issues.push(issue("SCHEMA_DEFINITION_ENTRY_WINDOW_INVALID", "entry.observationWindow", "entry.observationWindow 必须是对象"));
    } else {
      if (!inWhitelist(window.unit, STRATEGY_WINDOW_UNITS)) {
        issues.push(issue(
          "SCHEMA_DEFINITION_ENTRY_WINDOW_UNIT_INVALID",
          "entry.observationWindow.unit",
          `window.unit 必须是 ${STRATEGY_WINDOW_UNITS.join(" | ")} 之一（量化默认 TRADING_DAY），实际：${String(window.unit)}`,
        ));
      }
      const start = window.start;
      const end = window.end;
      if (typeof start !== "number" || typeof end !== "number"
        || !isValidObservationWindow({ start, end, unit: window.unit as never })) {
        issues.push(issue(
          "SCHEMA_DEFINITION_ENTRY_WINDOW_INVALID",
          "entry.observationWindow",
          `观察窗口必须满足 start >= 1 且 start <= end（整数交易日偏移），实际：start=${String(start)}, end=${String(end)}`,
        ));
      } else if (inWhitelist(window.unit, STRATEGY_WINDOW_UNITS)) {
        const trigger = entry.trigger;
        const triggerType = isPlainObject(trigger) ? trigger.type : undefined;
        if (inWhitelist(triggerType, STRATEGY_TRIGGER_TYPES)) {
          const timeline = resolveSignalTimeline(triggerType as never, { start, end, unit: window.unit as never });
          timelineResolvable = timeline.resolvable;
          maxForwardOffset = timeline.maxReferencableOffset;
        }
      }
    }

    const trigger = entry.trigger;
    if (!isPlainObject(trigger)) {
      issues.push(issue("SCHEMA_DEFINITION_ENTRY_TRIGGER_INVALID", "entry.trigger", "entry.trigger 必须是对象"));
    } else if (!inWhitelist(trigger.type, STRATEGY_TRIGGER_TYPES)) {
      issues.push(issue(
        "SCHEMA_DEFINITION_ENTRY_TRIGGER_TYPE_INVALID",
        "entry.trigger.type",
        `entry.trigger.type 必须是 ${STRATEGY_TRIGGER_TYPES.join(" | ")} 之一，实际：${String(trigger.type)}`,
      ));
    }

    const conditions = entry.conditions as unknown;
    if (!Array.isArray(conditions)) {
      issues.push(issue("SCHEMA_DEFINITION_ENTRY_CONDITIONS_INVALID", "entry.conditions", "entry.conditions 必须是数组（可为空数组）"));
    } else {
      const seen = new Set<string>();
      conditions.forEach((raw, index) => {
        const base = `entry.conditions[${index}]`;
        checkCondition(raw, base, `entry 条件 #${index + 1}`, maxForwardOffset, timelineResolvable, parameterCodes, issues);
        if (isPlainObject(raw) && typeof raw.id === "string" && raw.id.trim() !== "") {
          if (seen.has(raw.id)) {
            issues.push(issue("SCHEMA_DEFINITION_CONDITION_ID_DUPLICATE", `${base}.id`, `entry 条件 id=${raw.id} 重复`));
          }
          seen.add(raw.id);
        }
      });
    }
  }

  // -- Exit --
  const exit = d.exit as unknown;
  if (!isPlainObject(exit)) {
    issues.push(issue("SCHEMA_DEFINITION_EXIT_INVALID", "exit", "exit 必须是对象"));
  } else {
    const rules = exit.rules as unknown;
    if (!Array.isArray(rules)) {
      issues.push(issue("SCHEMA_DEFINITION_EXIT_RULES_INVALID", "exit.rules", "exit.rules 必须是数组"));
    } else {
      const seenIds = new Set<string>();
      const seenPriorities = new Set<number>();
      rules.forEach((raw, index) => {
        const base = `exit.rules[${index}]`;
        if (!isPlainObject(raw)) {
          issues.push(issue("SCHEMA_DEFINITION_EXIT_RULE_INVALID", base, `第 ${index} 条出场规则必须是对象`));
          return;
        }
        const rule = raw;
        if (typeof rule.id === "string" && rule.id.trim() !== "") {
          if (seenIds.has(rule.id)) {
            issues.push(issue("SCHEMA_DEFINITION_EXIT_RULE_ID_DUPLICATE", `${base}.id`, `出场规则 id=${rule.id} 重复`));
          }
          seenIds.add(rule.id);
        }
        if (!inWhitelist(rule.type, STRATEGY_EXIT_RULE_TYPES)) {
          issues.push(issue(
            "SCHEMA_DEFINITION_EXIT_RULE_TYPE_INVALID",
            `${base}.type`,
            `出场规则 type 必须是 ${STRATEGY_EXIT_RULE_TYPES.join(" | ")} 之一，实际：${String(rule.type)}`,
          ));
        }
        if (!inWhitelist(rule.trigger, STRATEGY_EXIT_TRIGGERS)) {
          issues.push(issue(
            "SCHEMA_DEFINITION_EXIT_TRIGGER_INVALID",
            `${base}.trigger`,
            `出场规则 trigger 必须是 ${STRATEGY_EXIT_TRIGGERS.join(" | ")} 之一，实际：${String(rule.trigger)}`,
          ));
        }
        if (typeof rule.enabled !== "boolean") {
          issues.push(issue("SCHEMA_DEFINITION_EXIT_RULE_ENABLED_INVALID", `${base}.enabled`, "出场规则 enabled 必须是布尔值"));
        }
        const priority = rule.priority;
        if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0) {
          issues.push(issue("SCHEMA_DEFINITION_EXIT_RULE_PRIORITY_INVALID", `${base}.priority`, "出场规则 priority 必须是 >= 0 的整数"));
        } else {
          if (seenPriorities.has(priority)) {
            issues.push(issue("SCHEMA_DEFINITION_EXIT_RULE_PRIORITY_DUPLICATE", `${base}.priority`, `出场规则 priority=${priority} 在同一出场定义内重复（优先级必须唯一）`));
          }
          seenPriorities.add(priority);
        }

        const hasThreshold = rule.threshold !== undefined && rule.threshold !== null;
        const hasParameter = typeof rule.parameter === "string" && rule.parameter.trim() !== "";
        if (!hasThreshold && !hasParameter) {
          issues.push(issue("SCHEMA_DEFINITION_EXIT_THRESHOLD_REQUIRED", base, "出场规则必须提供 threshold 或 parameter 之一"));
        } else if (hasThreshold && hasParameter) {
          issues.push(issue(
            "SCHEMA_DEFINITION_EXIT_THRESHOLD_AMBIGUOUS",
            base,
            "threshold（字面值）与 parameter（引用参数，取 defaultValue）只能二选一；同时声明将产生两个真值来源",
          ));
        }
        if (hasThreshold) {
          if (typeof rule.threshold !== "number" || !Number.isFinite(rule.threshold)) {
            issues.push(issue("SCHEMA_DEFINITION_EXIT_THRESHOLD_INVALID", `${base}.threshold`, "threshold 必须是有限数字"));
          } else if (rule.type === "TIME_EXIT" && rule.threshold <= 0) {
            issues.push(issue("SCHEMA_DEFINITION_EXIT_HOLDING_DAYS_INVALID", `${base}.threshold`, "TIME_EXIT 的持有天数必须 > 0"));
          }
        }

        // thresholdUnit 描述「阈值如何换算」，与阈值来自字面值还是参数无关 —— 只要存在阈值就必须声明。
        // 阈值缺失时声明它是悬挂字段（会误导读者以为阈值已定义），故拒绝。
        const hasThresholdUnit = rule.thresholdUnit !== undefined && rule.thresholdUnit !== null;
        if (hasThreshold || hasParameter) {
          if (!inWhitelist(rule.thresholdUnit, STRATEGY_EXIT_THRESHOLD_UNITS)) {
            issues.push(issue(
              "SCHEMA_DEFINITION_EXIT_THRESHOLD_UNIT_INVALID",
              `${base}.thresholdUnit`,
              `必须声明 thresholdUnit（${STRATEGY_EXIT_THRESHOLD_UNITS.join(" | ")}）`,
            ));
          }
        } else if (hasThresholdUnit) {
          issues.push(issue(
            "SCHEMA_DEFINITION_EXIT_THRESHOLD_UNIT_INVALID",
            `${base}.thresholdUnit`,
            "未声明 threshold / parameter 时不应声明 thresholdUnit（悬挂字段）",
          ));
        }

        if (hasParameter && !parameterCodes.has(rule.parameter as string)) {
          issues.push(issue("SCHEMA_DEFINITION_EXIT_PARAMETER_UNKNOWN", `${base}.parameter`, `出场规则引用了不存在的参数 code：${String(rule.parameter)}`));
        }
        if (rule.condition !== undefined && rule.condition !== null) {
          checkCondition(
            rule.condition,
            `${base}.condition`,
            `出场规则 #${index + 1} 的条件`,
            maxForwardOffset,
            timelineResolvable,
            parameterCodes,
            issues,
          );
        }
      });
    }
  }

  // -- Position --
  const position = d.position as unknown;
  if (!isPlainObject(position)) {
    issues.push(issue("SCHEMA_DEFINITION_POSITION_INVALID", "position", "position 必须是对象"));
  } else {
    if (!inWhitelist(position.sizingMethod, STRATEGY_POSITION_SIZING_METHODS)) {
      issues.push(issue(
        "SCHEMA_DEFINITION_POSITION_METHOD_INVALID",
        "position.sizingMethod",
        `position.sizingMethod 必须是 ${STRATEGY_POSITION_SIZING_METHODS.join(" | ")} 之一，实际：${String(position.sizingMethod)}`,
      ));
    }
    const maxPositions = position.maxPositions;
    if (typeof maxPositions !== "number" || !Number.isInteger(maxPositions) || maxPositions < 1) {
      issues.push(issue("SCHEMA_DEFINITION_POSITION_MAX_POSITIONS_INVALID", "position.maxPositions", "maxPositions 必须是 >= 1 的整数"));
    }
    checkOptionalRatio(position.positionRatio, "position.positionRatio", "position.positionRatio", issues);
    checkOptionalRatio(position.maxExposure, "position.maxExposure", "position.maxExposure", issues);
    checkOptionalRatio(position.maxSinglePosition, "position.maxSinglePosition", "position.maxSinglePosition", issues);
    if (position.fixedAmount !== undefined && position.fixedAmount !== null) {
      if (typeof position.fixedAmount !== "number" || !Number.isFinite(position.fixedAmount) || position.fixedAmount <= 0) {
        issues.push(issue("SCHEMA_DEFINITION_POSITION_FIXED_AMOUNT_INVALID", "position.fixedAmount", "fixedAmount 必须是 > 0 的有限数字"));
      }
    }
    if (position.sizingMethod === "FIXED_AMOUNT" && (position.fixedAmount === undefined || position.fixedAmount === null)) {
      issues.push(issue("SCHEMA_DEFINITION_POSITION_FIXED_AMOUNT_INVALID", "position.fixedAmount", "sizingMethod=FIXED_AMOUNT 必须声明 fixedAmount"));
    }
    if (position.sizingMethod === "FIXED_RATIO"
      && (position.positionRatio === undefined || position.positionRatio === null)
      && (typeof position.parameter !== "string" || position.parameter.trim() === "")) {
      issues.push(issue("SCHEMA_DEFINITION_POSITION_RATIO_INVALID", "position.positionRatio", "sizingMethod=FIXED_RATIO 必须声明 positionRatio 或 parameter"));
    }
    if (typeof position.parameter === "string" && position.parameter.trim() !== "" && !parameterCodes.has(position.parameter)) {
      issues.push(issue("SCHEMA_DEFINITION_POSITION_PARAMETER_UNKNOWN", "position.parameter", `position 引用了不存在的参数 code：${position.parameter}`));
    }
  }

  // -- Risk --
  const risk = d.risk as unknown;
  if (!isPlainObject(risk)) {
    issues.push(issue("SCHEMA_DEFINITION_RISK_INVALID", "risk", "risk 必须是对象"));
  } else {
    for (const [key, label] of [
      ["stopLoss", "risk.stopLoss"],
      ["maxDrawdown", "risk.maxDrawdown"],
      ["maxExposure", "risk.maxExposure"],
      ["maxSinglePosition", "risk.maxSinglePosition"],
      ["dailyLossLimit", "risk.dailyLossLimit"],
      ["concentrationLimit", "risk.concentrationLimit"],
    ] as const) {
      checkOptionalRatio(risk[key], key, label, issues);
    }
    if (risk.maxPositions !== undefined && risk.maxPositions !== null) {
      if (typeof risk.maxPositions !== "number" || !Number.isInteger(risk.maxPositions) || risk.maxPositions < 1) {
        issues.push(issue("SCHEMA_DEFINITION_RISK_MAX_POSITIONS_INVALID", "risk.maxPositions", "risk.maxPositions 必须是 >= 1 的整数"));
      }
    }
  }

  // -- Execution --
  const execution = d.execution as unknown;
  if (!isPlainObject(execution)) {
    issues.push(issue("SCHEMA_DEFINITION_EXECUTION_INVALID", "execution", "execution 必须是对象"));
  } else {
    const signalTiming = execution.signalTiming;
    const executionTiming = execution.executionTiming;
    const priceType = execution.priceType;
    if (!inWhitelist(signalTiming, STRATEGY_SIGNAL_TIMINGS)) {
      issues.push(issue(
        "SCHEMA_DEFINITION_EXECUTION_SIGNAL_TIMING_INVALID",
        "execution.signalTiming",
        `signalTiming 必须是 ${STRATEGY_SIGNAL_TIMINGS.join(" | ")} 之一，实际：${String(signalTiming)}`,
      ));
    }
    if (!inWhitelist(executionTiming, STRATEGY_EXECUTION_TIMINGS)) {
      issues.push(issue(
        "SCHEMA_DEFINITION_EXECUTION_TIMING_INVALID",
        "execution.executionTiming",
        `executionTiming 必须是 ${STRATEGY_EXECUTION_TIMINGS.join(" | ")} 之一，实际：${String(executionTiming)}`,
      ));
    }
    if (!inWhitelist(priceType, STRATEGY_PRICE_TYPES)) {
      issues.push(issue(
        "SCHEMA_DEFINITION_EXECUTION_PRICE_TYPE_INVALID",
        "execution.priceType",
        `priceType 必须是 ${STRATEGY_PRICE_TYPES.join(" | ")} 之一，实际：${String(priceType)}`,
      ));
    }
    if (!inWhitelist(execution.quantityMethod, STRATEGY_QUANTITY_METHODS)) {
      issues.push(issue(
        "SCHEMA_DEFINITION_EXECUTION_QUANTITY_METHOD_INVALID",
        "execution.quantityMethod",
        `quantityMethod 必须是 ${STRATEGY_QUANTITY_METHODS.join(" | ")} 之一，实际：${String(execution.quantityMethod)}`,
      ));
    }
    const lotSize = execution.lotSize;
    if (typeof lotSize !== "number" || !Number.isInteger(lotSize) || lotSize <= 0) {
      issues.push(issue("SCHEMA_DEFINITION_EXECUTION_LOT_SIZE_INVALID", "execution.lotSize", "lotSize 必须是 > 0 的整数（A 股一手 = 100）"));
    }
    for (const [key, label] of [["slippageModel", "滑点"], ["commissionModel", "佣金"]] as const) {
      const value = execution[key];
      if (value !== undefined && value !== null && !inWhitelist(value, STRATEGY_COST_MODELS)) {
        issues.push(issue(
          "SCHEMA_DEFINITION_EXECUTION_COST_MODEL_INVALID",
          `execution.${key}`,
          `${label}模型必须是 ${STRATEGY_COST_MODELS.join(" | ")} 之一，实际：${String(value)}`,
        ));
      }
    }
    const constraints = execution.executionConstraints;
    if (constraints !== undefined && constraints !== null) {
      if (!Array.isArray(constraints) || constraints.some((item) => typeof item !== "string" || item.trim() === "")) {
        issues.push(issue("SCHEMA_DEFINITION_EXECUTION_CONSTRAINTS_INVALID", "execution.executionConstraints", "executionConstraints 必须是非空字符串数组"));
      }
    }

    // -- L6 / L7 / L8：时序自洽 --
    if (inWhitelist(signalTiming, STRATEGY_SIGNAL_TIMINGS) && inWhitelist(executionTiming, STRATEGY_EXECUTION_TIMINGS)) {
      const trigger = isPlainObject(entry) && isPlainObject(entry.trigger) ? entry.trigger.type : undefined;
      const isDeferredTrigger = trigger === "NEXT_TRADING_DAY";

      if (signalTiming === "T_CLOSE" && executionTiming === "T_CLOSE") {
        issues.push(issue(
          "SIGNAL_EXECUTION_TIMING_CONFLICT",
          "execution.executionTiming",
          "signalTiming=T_CLOSE 时禁止 executionTiming=T_CLOSE：同一 bar 收盘同时出信号并成交在本项目 T+1 模型下不可实现，且等价于使用该 bar 收盘信息成交",
        ));
      } else if (isDeferredTrigger && executionTiming === "T_CLOSE") {
        issues.push(issue(
          "TRIGGER_EXECUTION_INCONSISTENT",
          "execution.executionTiming",
          "trigger=NEXT_TRADING_DAY 表示信号已相对条件 bar 顺延一个交易日，executionTiming 必须是 T_PLUS_1_OPEN / T_PLUS_1_CLOSE / T_PLUS_2_OPEN 之一（不得为同 bar 成交 T_CLOSE）",
        ));
      }

      if (inWhitelist(priceType, STRATEGY_PRICE_TYPES) && priceType !== "VWAP") {
        // "T_CLOSE".endsWith("_CLOSE") 成立；T_PLUS_*_OPEN / T_PLUS_*_CLOSE 同理。
        const expectsOpen = executionTiming.endsWith("_OPEN");
        const expectsClose = executionTiming.endsWith("_CLOSE");
        if (expectsOpen && priceType !== "OPEN") {
          issues.push(issue(
            "PRICE_TYPE_TIMING_MISMATCH",
            "execution.priceType",
            `executionTiming=${executionTiming} 以开盘价成交，priceType 必须是 OPEN（或 VWAP 代理），实际：${priceType}`,
          ));
        } else if (expectsClose && priceType !== "CLOSE") {
          issues.push(issue(
            "PRICE_TYPE_TIMING_MISMATCH",
            "execution.priceType",
            `executionTiming=${executionTiming} 以收盘价成交，priceType 必须是 CLOSE（或 VWAP 代理），实际：${priceType}`,
          ));
        }
      }
    }
  }

  // -- Datasets（只建立引用） --
  const datasets = d.datasets as unknown;
  if (!Array.isArray(datasets)) {
    issues.push(issue("SCHEMA_DEFINITION_DATASETS_INVALID", "datasets", "datasets 必须是数组（可为空数组）"));
  } else {
    const seenBindings = new Set<string>();
    let primaryCount = 0;
    datasets.forEach((raw, index) => {
      const base = `datasets[${index}]`;
      if (!isPlainObject(raw)) {
        issues.push(issue("SCHEMA_DEFINITION_DATASET_INVALID", base, `第 ${index} 个 Dataset 绑定必须是对象`));
        return;
      }
      if (typeof raw.datasetId !== "string" || raw.datasetId.trim() === "") {
        issues.push(issue("SCHEMA_DEFINITION_DATASET_ID_EMPTY", `${base}.datasetId`, "datasetId 必须是非空字符串"));
      }

      // STRATEGY-004：坐标二选一 —— Dataset Registry 权威坐标（datasetVersionId）或 legacy rd-… 分支。
      const hasVersionId = raw.datasetVersionId !== undefined && raw.datasetVersionId !== null;
      if (hasVersionId && !isValidDatasetVersionId(raw.datasetVersionId)) {
        issues.push(issue(
          "SCHEMA_DEFINITION_DATASET_VERSION_ID_INVALID",
          `${base}.datasetVersionId`,
          `datasetVersionId 必须是正整数（dataset_version.id），实际：${String(raw.datasetVersionId)}`,
        ));
      }

      const versionIsNonEmptyLabel = isStrategyDatasetVersionLabel(raw.datasetVersion);
      const versionIsLegacyContentAddressed = typeof raw.datasetVersion === "string"
        && isValidDatasetVersionFormat(raw.datasetVersion);

      if (hasVersionId) {
        // Dataset Registry 坐标：datasetVersion 降级为 label / 快照（v1 / v2）。
        if (!versionIsNonEmptyLabel) {
          issues.push(issue(
            "SCHEMA_DEFINITION_DATASET_VERSION_INVALID",
            `${base}.datasetVersion`,
            `提供 datasetVersionId 时 datasetVersion 必须是 Dataset Version label（如 v1 / v2；不得再写 legacy rd-… 串），实际：${String(raw.datasetVersion)}`,
          ));
        }
      } else if (!versionIsLegacyContentAddressed) {
        // legacy 兼容分支：datasetVersionId 缺省时必须仍是 rd-… 内容寻址串。
        issues.push(issue(
          "SCHEMA_DEFINITION_DATASET_VERSION_INVALID",
          `${base}.datasetVersion`,
          `未提供 datasetVersionId 时 datasetVersion 必须是 rd-… 内容寻址数据集版本（legacy 兼容分支），实际：${String(raw.datasetVersion)}`,
        ));
      }

      if (!inWhitelist(raw.role, STRATEGY_DATASET_ROLES)) {
        issues.push(issue(
          "SCHEMA_DEFINITION_DATASET_ROLE_INVALID",
          `${base}.role`,
          `role 必须是 ${STRATEGY_DATASET_ROLES.join(" | ")} 之一，实际：${String(raw.role)}`,
        ));
      } else if (raw.role === "PRIMARY") {
        primaryCount += 1;
        if (primaryCount > 1) {
          issues.push(issue("SCHEMA_DEFINITION_DATASET_PRIMARY_DUPLICATE", `${base}.role`, "最多只允许一个 PRIMARY Dataset 绑定"));
        }
      }
      const key = `${String(raw.datasetId)}|${String(raw.datasetVersion)}|${String(raw.role)}|${
        hasVersionId ? String(raw.datasetVersionId) : "legacy"
      }`;
      if (seenBindings.has(key)) {
        issues.push(issue("SCHEMA_DEFINITION_DATASET_BINDING_DUPLICATE", base, `Dataset 绑定重复：${key}`));
      }
      seenBindings.add(key);
    });
  }

  return result(issues);
}

/** 策略定义非法即抛 ResearchValidationError。 */
export function assertValidCanonicalStrategyDefinition(definition: StrategyDefinition | undefined | null): void {
  const validation = validateCanonicalStrategyDefinition(definition);
  if (!validation.valid) throw new ResearchValidationError(validation.issues);
}

/**
 * STRATEGY-004 — 是否为 **Dataset Registry 的版本 label**（`v1` / `v2`）。
 *
 * 明确**排除** legacy `rd-…` 内容寻址串：两者是同一字段的两种语义
 * （有坐标时 = label，无坐标时 = legacy 版本串），必须互斥而不能互相冒充 ——
 * 否则「提供 datasetVersionId 却仍写 rd-…」这种半迁移状态会被静默接受。
 *
 * 校验器（本文件的 definition 层 + validate.ts 的文档层）与 universe 派生后缀共用本函数，
 * 保证三处标签口径唯一。
 */
export function isStrategyDatasetVersionLabel(value: unknown): boolean {
  return typeof value === "string"
    && STRATEGY_DATASET_VERSION_LABEL_RE.test(value)
    && !isValidDatasetVersionFormat(value);
}
