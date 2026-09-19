/**
 * STRATEGY-ARCH-001 — RuleGraph（规格 §5 / §6 / §7）。
 *
 * 解决的问题（对照 legacy）：legacy 的规则是**扁平**的 ——
 * `entry.conditions[]` 数组内即全 AND，`ConditionDefinition` **没有逻辑运算符字段**
 * ⇒ `A AND (B OR C)` 写不下；`path.* / outcome.*` 一律被拒 ⇒ 路径型策略写不下；
 * 也没有 `SEQUENCE`（`A → B → C`）与 `TRIGGER` 的一等公民表达。
 *
 * 本模块给出 **RuleGraph / Expression Tree**：
 *
 *   ALL        所有子节点成立（空子集非法）
 *   ANY        任一子节点成立
 *   NOT        子节点不成立
 *   CONDITION  左值 expr 与右值 expr 的比较（8 个运算符**全部可实现**）
 *   EVENT      事件是否发生（事件类型闭集 + CUSTOM_EVENT 扩展位）
 *   WINDOW     在窗口内逐日求值子节点，按显式量化器（ALL_DAYS / ANY_DAY）归约
 *   SEQUENCE   有序发生（`A → B → C`），步骤的「发生日」必须非降
 *   TRIGGER    窗口内哪一天产出决策（FIRST_VALID_DAY / LAST_VALID_DAY / EVERY_VALID_DAY / NEXT_TRADING_DAY）
 *
 * 🔴 反硬编码纪律（规格 §5）：本模块**不认识任何具体策略名**（没有 firstLimitPullback /
 * dragonLeader / breakout 分支）。事件类型与运算符是**闭集词表**，新增策略靠组合节点实现，
 * 不靠新增 `if (strategyType === ...)` 分支。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random；求值确定性；越界读取由 env 记录违规。
 */

import {
  COMPARISON_OPERATORS,
  CORE_EVENT_TYPES,
  CORE_TRIGGER_TYPES,
  RULE_NODE_KINDS,
  StrategyCoreError,
  WINDOW_QUANTIFIERS,
  validationIssue,
  type ComparisonOperator,
  type CoreTriggerType,
  type CoreValidationIssue,
  type CoreValue,
  type RelativeDay,
  type RuleNodeKind,
  type WindowQuantifier,
  type EvaluationTime,
} from "./types";
import {
  collectFeatureReferences,
  collectFieldReferences,
  collectParameterReferences,
  evaluateExpression,
  validateExpression,
  type ExpressionValidationOptions,
  type ValueExpression,
} from "./expression";
import {
  offsetToLabel,
  validateTemporalWindow,
  windowOffsets,
  type TemporalWindow,
  type VisibilityViolation,
} from "./temporal";
import { fieldReferenceFeatureId } from "./fieldReference";

// ---------------------------------------------------------------------------
// 节点类型
// ---------------------------------------------------------------------------

export interface AllNode {
  readonly kind: "ALL";
  readonly id?: string;
  readonly children: readonly RuleNode[];
  readonly description?: string;
}

export interface AnyNode {
  readonly kind: "ANY";
  readonly id?: string;
  readonly children: readonly RuleNode[];
  readonly description?: string;
}

export interface NotNode {
  readonly kind: "NOT";
  readonly id?: string;
  readonly child: RuleNode;
  readonly description?: string;
}

export interface ConditionNode {
  readonly kind: "CONDITION";
  readonly id?: string;
  readonly left: ValueExpression;
  readonly operator: ComparisonOperator;
  readonly right: ValueExpression;
  readonly description?: string;
}

export interface EventNode {
  readonly kind: "EVENT";
  readonly id?: string;
  readonly eventType: string;
  readonly params?: Readonly<Record<string, CoreValue>>;
  readonly description?: string;
}

export interface WindowNode {
  readonly kind: "WINDOW";
  readonly id?: string;
  /** 窗口（相对事件日的偏移，含两端）。 */
  readonly window: TemporalWindow;
  /** 🔴 **必填**量化器：窗口内如何归约。缺失即非法（**不编默认值**）。 */
  readonly quantifier: WindowQuantifier;
  readonly child: RuleNode;
  readonly description?: string;
}

export interface SequenceNode {
  readonly kind: "SEQUENCE";
  readonly id?: string;
  /** 有序步骤（至少 1 步）；各步的「发生日」必须非降。 */
  readonly steps: readonly RuleNode[];
  readonly description?: string;
}

export interface TriggerNode {
  readonly kind: "TRIGGER";
  readonly id?: string;
  readonly triggerType: CoreTriggerType;
  readonly description?: string;
}

export type RuleNode =
  | AllNode
  | AnyNode
  | NotNode
  | ConditionNode
  | EventNode
  | WindowNode
  | SequenceNode
  | TriggerNode;

/** 构造助手。 */
export const Rule = {
  all: (children: readonly RuleNode[], id?: string, description?: string): AllNode => ({ kind: "ALL", children, ...(id === undefined ? {} : { id }), ...(description === undefined ? {} : { description }) }),
  any: (children: readonly RuleNode[], id?: string, description?: string): AnyNode => ({ kind: "ANY", children, ...(id === undefined ? {} : { id }), ...(description === undefined ? {} : { description }) }),
  not: (child: RuleNode, id?: string, description?: string): NotNode => ({ kind: "NOT", child, ...(id === undefined ? {} : { id }), ...(description === undefined ? {} : { description }) }),
  condition: (
    left: ValueExpression,
    operator: ComparisonOperator,
    right: ValueExpression,
    id?: string,
    description?: string,
  ): ConditionNode => ({ kind: "CONDITION", left, operator, right, ...(id === undefined ? {} : { id }), ...(description === undefined ? {} : { description }) }),
  event: (eventType: string, id?: string, params?: Readonly<Record<string, CoreValue>>): EventNode => ({
    kind: "EVENT",
    eventType,
    ...(id === undefined ? {} : { id }),
    ...(params === undefined ? {} : { params }),
  }),
  window: (window: TemporalWindow, quantifier: WindowQuantifier, child: RuleNode, id?: string): WindowNode => ({
    kind: "WINDOW",
    window,
    quantifier,
    child,
    ...(id === undefined ? {} : { id }),
  }),
  sequence: (steps: readonly RuleNode[], id?: string): SequenceNode => ({ kind: "SEQUENCE", steps, ...(id === undefined ? {} : { id }) }),
  trigger: (triggerType: CoreTriggerType, id?: string): TriggerNode => ({ kind: "TRIGGER", triggerType, ...(id === undefined ? {} : { id }) }),
} as const;

// ---------------------------------------------------------------------------
// 求值环境
// ---------------------------------------------------------------------------

/** 节点求值轨迹（供 StrategyDecision.conditions 与解释性输出使用）。 */
export interface RuleNodeTrace {
  readonly nodeId: string;
  readonly kind: RuleNodeKind;
  /** null = 该节点在本次求值中未被赋值（如 TRIGGER 在无窗口时）。 */
  readonly satisfied: boolean | null;
  readonly detail: string;
  /** WINDOW 节点：窗口内**逐日**子节点成立的相对日（升序）。 */
  readonly windowValidDays?: readonly RelativeDay[];
  /** SEQUENCE 节点：各步的「发生日」（非降；缺失步骤记 null）。 */
  readonly sequenceDays?: readonly (RelativeDay | null)[];
  /** EVENT 节点：事件类型（供 StrategyDecision.events 直接取用，**不再二次求值**）。 */
  readonly eventType?: string;
  /** EVENT 节点：事件参数。 */
  readonly eventParams?: Readonly<Record<string, CoreValue>>;
  /** TRIGGER 节点：触发类型（供 StrategyDecision.signals 直接取用）。 */
  readonly triggerType?: string;
}

/** RuleGraph 求值环境（由 StrategyRuntime 装配；本模块不关心数据从哪来）。 */
export interface RuleEvaluationEnv {
  /** 决策时点（PIT 语义坐标）。 */
  readonly asOf: EvaluationTime;
  /** 当前被评估的相对日（T = 0）。 */
  readonly currentDay: RelativeDay;
  /** 本次评估允许的最远相对日。 */
  readonly maxRelativeDay: RelativeDay;
  /** 事件是否发生（事件类型 + 参数）。 */
  readonly eventOccurred: (eventType: string, params: Readonly<Record<string, CoreValue>>) => boolean;
  /** 字段引用求值（`bar.low` / `prefix.rd0.open` / `post.rd1.close` / `event.limitUpPrice`）。 */
  readonly fieldValue: (field: string) => CoreValue;
  /** 特征求值（注册表 id）。 */
  readonly featureValue: (featureId: string) => CoreValue;
  /** 已解析参数求值。 */
  readonly parameterValue: (code: string) => CoreValue;
  /** 共享的 PIT 违规收集器（越界读取追加到这里，Runtime 在产出决策前检查）。 */
  readonly violations: VisibilityViolation[];
  /**
   * 共享的「数据不足」收集器：条件操作数为 `null`（该 bar 缺列 / 该日无数据）时追加到这里。
   * 语义：**条件视为不成立**（不抛错、不臆造默认值），并把「为什么没成立」如实上报。
   */
  readonly insufficiencies?: string[];
  /** 派生新作用域（切换 `currentDay`；PIT 违规收集器**共享**）。 */
  readonly withDay: (day: RelativeDay) => RuleEvaluationEnv;
}

// ---------------------------------------------------------------------------
// 求值
// ---------------------------------------------------------------------------

/** 节点 id 解析（缺省按结构路径派生 ⇒ 同一图必得同一 id）。 */
export function resolveNodeId(node: RuleNode, path: string): string {
  const explicit = node.id;
  return typeof explicit === "string" && explicit.trim() !== "" ? explicit.trim() : path;
}

function requireNumber(value: CoreValue, operator: ComparisonOperator, side: "left" | "right", nodeId: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StrategyCoreError(
      "EXPRESSION_INVALID",
      "条件 " + nodeId + " 的 " + side + " 侧在 " + operator + " 下必须是有限数字（实际 " + JSON.stringify(value) + "）",
    );
  }
  return value;
}

function compareValues(
  left: CoreValue,
  operator: ComparisonOperator,
  right: CoreValue,
  nodeId: string,
): boolean {
  switch (operator) {
    case "GT":
      return requireNumber(left, operator, "left", nodeId) > requireNumber(right, operator, "right", nodeId);
    case "GTE":
      return requireNumber(left, operator, "left", nodeId) >= requireNumber(right, operator, "right", nodeId);
    case "LT":
      return requireNumber(left, operator, "left", nodeId) < requireNumber(right, operator, "right", nodeId);
    case "LTE":
      return requireNumber(left, operator, "left", nodeId) <= requireNumber(right, operator, "right", nodeId);
    case "EQ":
      return left === right;
    case "NEQ":
      return left !== right;
    case "IN":
    case "NOT_IN": {
      throw new StrategyCoreError(
        "EXPRESSION_INVALID",
        "IN / NOT_IN 必须由 ARRAY 右值内联处理（条件 " + nodeId + " 的右值不是 ARRAY）",
      );
    }
  }
}

function compareCondition(node: ConditionNode, env: RuleEvaluationEnv, nodeId: string): { satisfied: boolean; detail: string } {
  const scope = {
    fieldValue: env.fieldValue,
    featureValue: env.featureValue,
    parameterValue: env.parameterValue,
  };
  if (node.operator === "IN" || node.operator === "NOT_IN") {
    if (node.right.kind !== "ARRAY") {
      throw new StrategyCoreError(
        "EXPRESSION_INVALID",
        "条件 " + nodeId + " 使用 " + node.operator + " 时右值必须是常量数组（ARRAY）",
      );
    }
    const target = evaluateExpression(node.left, scope);
    if (target === null) {
      env.insufficiencies?.push("条件 " + nodeId + " 的左值求值为 null（数据缺失）");
      return { satisfied: false, detail: "left=null（数据缺失）⇒ " + node.operator + " 视为不成立" };
    }
    const hit = node.right.items.some((item) => item === target);
    const satisfied = node.operator === "IN" ? hit : !hit;
    return {
      satisfied,
      detail: "left=" + JSON.stringify(target) + " " + node.operator + " [" + node.right.items.map((i) => JSON.stringify(i)).join(",") + "]",
    };
  }
  const left = evaluateExpression(node.left, scope);
  const right = evaluateExpression(node.right, scope);
  if (left === null || right === null) {
    env.insufficiencies?.push(
      "条件 " + nodeId + " 操作数缺失（left=" + JSON.stringify(left) + ", right=" + JSON.stringify(right) + "）",
    );
    return { satisfied: false, detail: "操作数缺失 ⇒ 条件不成立（不臆造默认值）" };
  }
  return {
    satisfied: compareValues(left, node.operator, right, nodeId),
    detail: "left=" + JSON.stringify(left) + " " + node.operator + " right=" + JSON.stringify(right),
  };
}

/** 求值结果（含全量轨迹）。 */
export interface RuleGraphEvaluation {
  readonly satisfied: boolean;
  readonly traces: readonly RuleNodeTrace[];
  /** 所有 WINDOW 节点journal：`windowNodeId -> 成立的相对日`。 */
  readonly windowValidDays: ReadonlyMap<string, readonly RelativeDay[]>;
}

function evaluateNode(
  node: RuleNode,
  env: RuleEvaluationEnv,
  path: string,
  traces: RuleNodeTrace[],
  journal: Map<string, readonly RelativeDay[]>,
): boolean {
  const nodeId = resolveNodeId(node, path);
  switch (node.kind) {
    case "ALL": {
      let satisfied = node.children.length > 0;
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index] as RuleNode;
        const childOk = evaluateNode(child, env, path + ".children[" + String(index) + "]", traces, journal);
        satisfied = satisfied && childOk;
      }
      traces.push({ nodeId, kind: "ALL", satisfied, detail: node.children.length + " 个子节点全部成立" });
      return satisfied;
    }
    case "ANY": {
      let satisfied = false;
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index] as RuleNode;
        const childOk = evaluateNode(child, env, path + ".children[" + String(index) + "]", traces, journal);
        satisfied = satisfied || childOk;
      }
      traces.push({ nodeId, kind: "ANY", satisfied, detail: node.children.length + " 个子节点中任一成立" });
      return satisfied;
    }
    case "NOT": {
      const inner = evaluateNode(node.child, env, path + ".child", traces, journal);
      traces.push({ nodeId, kind: "NOT", satisfied: !inner, detail: "子节点取反（子=" + String(inner) + "）" });
      return !inner;
    }
    case "CONDITION": {
      const { satisfied, detail } = compareCondition(node, env, nodeId);
      traces.push({ nodeId, kind: "CONDITION", satisfied, detail });
      return satisfied;
    }
    case "EVENT": {
      const params = node.params ?? {};
      const satisfied = env.eventOccurred(node.eventType, params);
      traces.push({
        nodeId,
        kind: "EVENT",
        satisfied,
        detail: "事件 " + node.eventType + "（params=" + JSON.stringify(params) + "）在 " + offsetToLabel(env.currentDay) + " " + (satisfied ? "发生" : "未发生"),
        eventType: node.eventType,
        eventParams: params,
      });
      return satisfied;
    }
    case "WINDOW": {
      const allOffsets = windowOffsets(node.window);
      // 🔴 PIT：只考虑**当前决策日及之前**的窗口日（更晚的候选日尚未到来 ⇒ 不可读）。
      const considered = allOffsets.filter((offset) => offset <= env.currentDay);
      const futureSkipped = allOffsets.filter((offset) => offset > env.currentDay);
      const validDays: RelativeDay[] = [];
      for (const offset of considered) {
        const scoped = env.withDay(offset);
        const ok = evaluateNode(node.child, scoped, path + ".child", traces, journal);
        if (ok) validDays.push(offset);
      }
      const satisfied =
        node.quantifier === "ALL_DAYS"
          ? validDays.length === allOffsets.length && allOffsets.length > 0
          : validDays.length > 0;
      journal.set(nodeId, validDays);
      traces.push({
        nodeId,
        kind: "WINDOW",
        satisfied,
        detail:
          "窗口 " +
          offsetToLabel(node.window.start) +
          "~" +
          offsetToLabel(node.window.end) +
          "（" +
          node.window.unit +
          "）量化器 " +
          node.quantifier +
          "，成立日 " +
          JSON.stringify(validDays) +
          "，尚未到的窗口日 " +
          JSON.stringify(futureSkipped),
        windowValidDays: validDays,
      });
      return satisfied;
    }
    case "SEQUENCE": {
      // 有序发生：逐步求值，各步「发生日」必须非降（贪心取最早满足日）。
      const days: (RelativeDay | null)[] = [];
      let previousDay = -Number.MAX_SAFE_INTEGER;
      let satisfied = node.steps.length > 0;
      for (let index = 0; index < node.steps.length; index += 1) {
        const step = node.steps[index] as RuleNode;
        const stepPath = path + ".steps[" + String(index) + "]";
        const occurrence = findOccurrenceDay(step, env, stepPath, traces, journal, previousDay);
        days.push(occurrence);
        if (occurrence === null) {
          satisfied = false;
        } else if (occurrence < previousDay) {
          satisfied = false;
        } else {
          previousDay = occurrence;
        }
      }
      traces.push({
        nodeId,
        kind: "SEQUENCE",
        satisfied,
        detail: "有序步骤发生日 " + JSON.stringify(days) + "（必须非降）",
        sequenceDays: days,
      });
      return satisfied;
    }
    case "TRIGGER": {
      // TRIGGER 依赖同一作用域内已求值的 WINDOW 节点 journal。
      // 🔴 无 WINDOW 时（纯条件策略）：唯一候选日 = 当前决策日（**不是**「不成立」——
      //    否则「没有观察窗口的策略」会永远发不出信号）。
      const windows: RelativeDay[][] = [];
      for (const value of journal.values()) windows.push(value as RelativeDay[]);
      const allValidDays: readonly RelativeDay[] = windows.length === 0 ? [env.currentDay] : dedupeSorted(windows.flat());
      const satisfied = resolveTriggerSatisfaction(node.triggerType, allValidDays, env.currentDay);
      traces.push({
        nodeId,
        kind: "TRIGGER",
        satisfied,
        detail:
          "触发 " +
          node.triggerType +
          " 在当前日 " +
          offsetToLabel(env.currentDay) +
          " " +
          (satisfied ? "成立" : "不成立") +
          "（窗口成立日=" +
          JSON.stringify(allValidDays) +
          (windows.length === 0 ? "；无 WINDOW 节点 ⇒ 候选日仅当前日" : "") +
          "）",
        triggerType: node.triggerType,
      });
      return satisfied;
    }
  }
}

function dedupeSorted(days: readonly RelativeDay[]): readonly RelativeDay[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

/** 触发时点的判定（唯一权威）。`validDays` 为空 ⇒ 不成立（无候选日）。 */
export function resolveTriggerSatisfaction(
  triggerType: CoreTriggerType,
  validDays: readonly RelativeDay[],
  currentDay: RelativeDay,
): boolean {
  if (validDays.length === 0) return false;
  const first = validDays[0] as RelativeDay;
  const last = validDays[validDays.length - 1] as RelativeDay;
  switch (triggerType) {
    case "FIRST_VALID_DAY":
      return currentDay === first;
    case "LAST_VALID_DAY":
      return currentDay === last;
    case "EVERY_VALID_DAY":
      return validDays.includes(currentDay);
    case "NEXT_TRADING_DAY":
      return currentDay === last + 1;
  }
}

/**
 * 求某节点「最早发生日」：在候选日集合上逐日求值，取第一个成立的日子。
 *
 * 🔴 候选日集合的语义：
 *   - `WINDOW` 步骤 ⇒ 用它自己的窗口逐日求值（**其窗口是权威**），取窗口内首个成立日；
 *   - `EVENT` 步骤 ⇒ 候选日 = { 0 }（事件日）；
 *   - `TRIGGER` 步骤 ⇒ 依赖 journal（由前序 WINDOW 写入）；无 journal ⇒ 用 `currentDay`；
 *   - 其余节点 ⇒ 候选日 = { `currentDay` }，且必须 `>= minDay`。
 */
function findOccurrenceDay(
  node: RuleNode,
  env: RuleEvaluationEnv,
  path: string,
  traces: RuleNodeTrace[],
  journal: Map<string, readonly RelativeDay[]>,
  minDay: RelativeDay,
): RelativeDay | null {
  if (node.kind === "WINDOW") {
    const allOffsets = windowOffsets(node.window);
    // 🔴 同上：只考虑当前决策日及之前的窗口日（PIT）。
    const considered = allOffsets.filter((offset) => offset <= env.currentDay);
    const validDays: RelativeDay[] = [];
    for (const offset of considered) {
      const scoped = env.withDay(offset);
      if (evaluateNode(node.child, scoped, path + ".child", traces, journal)) validDays.push(offset);
    }
    journal.set(resolveNodeId(node, path), validDays);
    const eligible = validDays.filter((day) => day >= minDay);
    const satisfied =
      node.quantifier === "ALL_DAYS"
        ? validDays.length === allOffsets.length && allOffsets.length > 0 && node.window.end >= minDay
        : eligible.length > 0;
    traces.push({
      nodeId: resolveNodeId(node, path),
      kind: "WINDOW",
      satisfied,
      detail:
        "窗口 " +
        offsetToLabel(node.window.start) +
        "~" +
        offsetToLabel(node.window.end) +
        "量化器 " +
        node.quantifier +
        "，成立日 " +
        JSON.stringify(validDays),
      windowValidDays: validDays,
    });
    if (!satisfied) return null;
    if (node.quantifier === "ALL_DAYS") return node.window.end >= minDay ? node.window.end : null;
    return eligible.length > 0 ? (eligible[0] as RelativeDay) : null;
  }

  if (node.kind === "EVENT") {
    const scoped = env.withDay(0);
    const ok = evaluateNode(node, scoped, path, traces, journal);
    return ok && 0 >= minDay ? 0 : null;
  }

  if (node.kind === "TRIGGER") {
    const windows: RelativeDay[][] = [];
    for (const value of journal.values()) windows.push(value as RelativeDay[]);
    const allValidDays: readonly RelativeDay[] =
      windows.length === 0 ? [env.currentDay] : dedupeSorted(windows.flat());
    const candidates = triggerCandidateDays(node.triggerType, allValidDays);
    for (const day of candidates) {
      if (day < minDay) continue;
      const ok = evaluateNode(node, env.withDay(day), path, traces, journal);
      if (ok) return day;
    }
    // 全部候选都不满足 ⇒ 如实记录「不成立」并返回 null（不静默换日）。
    traces.push({
      nodeId: resolveNodeId(node, path),
      kind: "TRIGGER",
      satisfied: false,
      detail: "触发 " + node.triggerType + " 在候选日 " + JSON.stringify(candidates) + " 均不成立",
    });
    return null;
  }

  const ok = evaluateNode(node, env, path, traces, journal);
  return ok && env.currentDay >= minDay ? env.currentDay : null;
}

/** 触发时点对应的候选日集合（用于 SEQUENCE 内的 TRIGGER 步骤）。 */
export function triggerCandidateDays(
  triggerType: CoreTriggerType,
  validDays: readonly RelativeDay[],
): readonly RelativeDay[] {
  if (validDays.length === 0) return [];
  const last = validDays[validDays.length - 1] as RelativeDay;
  switch (triggerType) {
    case "FIRST_VALID_DAY":
      return [validDays[0] as RelativeDay];
    case "LAST_VALID_DAY":
      return [last];
    case "EVERY_VALID_DAY":
      return validDays;
    case "NEXT_TRADING_DAY":
      return [last + 1];
  }
}

/** 对 RuleGraph 求值（入口）。 */
export function evaluateRuleGraph(root: RuleNode, env: RuleEvaluationEnv): RuleGraphEvaluation {
  const traces: RuleNodeTrace[] = [];
  const journal = new Map<string, readonly RelativeDay[]>();
  const satisfied = evaluateNode(root, env, "ruleGraph", traces, journal);
  return { satisfied, traces, windowValidDays: journal };
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export interface RuleGraphValidationOptions extends ExpressionValidationOptions {
  /** 最大嵌套深度（防栈溢出 / 防病态图）。 */
  readonly maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 32;

/**
 * RuleGraph 静态校验（结构 + 词表 + 表达式 + 深度）。
 *
 * 注意：本函数**不**做时间域 / 未来函数判定 —— 那属于 `leakageGuard`（规格 §15 的唯一关卡）。
 */
export function validateRuleGraph(
  root: RuleNode,
  options: RuleGraphValidationOptions = {},
): readonly CoreValidationIssue[] {
  const issues: CoreValidationIssue[] = [];
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  const walk = (node: RuleNode, path: string, depth: number): void => {
    if (depth > maxDepth) {
      issues.push(validationIssue("RULE_GRAPH_INVALID", path, "节点嵌套深度超过 " + String(maxDepth)));
      return;
    }
    if (node === null || typeof node !== "object") {
      issues.push(validationIssue("RULE_NODE_INVALID", path, "节点不是对象"));
      return;
    }
    if (!(RULE_NODE_KINDS as readonly string[]).includes(node.kind)) {
      issues.push(validationIssue("RULE_NODE_INVALID", path, "未知节点种类：" + String((node as { kind?: unknown }).kind)));
      return;
    }
    switch (node.kind) {
      case "ALL":
      case "ANY": {
        if (node.children.length === 0) {
          issues.push(validationIssue("RULE_GRAPH_INVALID", path, node.kind + " 至少需要 1 个子节点"));
        }
        node.children.forEach((child, index) => walk(child, path + ".children[" + String(index) + "]", depth + 1));
        break;
      }
      case "NOT":
        walk(node.child, path + ".child", depth + 1);
        break;
      case "CONDITION": {
        if (!(COMPARISON_OPERATORS as readonly string[]).includes(node.operator)) {
          issues.push(validationIssue("RULE_GRAPH_INVALID", path, "未知比较运算符：" + String(node.operator)));
        }
        if ((node.operator === "IN" || node.operator === "NOT_IN") && node.right.kind !== "ARRAY") {
          issues.push(
            validationIssue("EXPRESSION_INVALID", path + ".right", node.operator + " 的右值必须是常量数组（ARRAY）"),
          );
        }
        issues.push(...validateExpression(node.left, path + ".left", options));
        issues.push(...validateExpression(node.right, path + ".right", options));
        break;
      }
      case "EVENT": {
        if (!(CORE_EVENT_TYPES as readonly string[]).includes(node.eventType)) {
          issues.push(
            validationIssue(
              "RULE_GRAPH_INVALID",
              path,
              "未知事件类型 " + String(node.eventType) + "（闭集：" + CORE_EVENT_TYPES.join("/") + "；扩展用 CUSTOM_EVENT + params）",
            ),
          );
        }
        break;
      }
      case "WINDOW": {
        issues.push(...validateTemporalWindow(node.window, path + ".window"));
        if (!(WINDOW_QUANTIFIERS as readonly string[]).includes(node.quantifier)) {
          issues.push(
            validationIssue(
              "RULE_GRAPH_INVALID",
              path,
              "WINDOW 必须显式声明 window 量化器（" + WINDOW_QUANTIFIERS.join("/") + "），实际 " + String(node.quantifier),
            ),
          );
        }
        walk(node.child, path + ".child", depth + 1);
        break;
      }
      case "SEQUENCE": {
        if (node.steps.length === 0) {
          issues.push(validationIssue("RULE_GRAPH_INVALID", path, "SEQUENCE 至少需要 1 个步骤"));
        }
        node.steps.forEach((step, index) => walk(step, path + ".steps[" + String(index) + "]", depth + 1));
        break;
      }
      case "TRIGGER": {
        if (!(CORE_TRIGGER_TYPES as readonly string[]).includes(node.triggerType)) {
          issues.push(
            validationIssue(
              "RULE_GRAPH_INVALID",
              path,
              "未知触发类型 " + String(node.triggerType) + "（闭集：" + CORE_TRIGGER_TYPES.join("/") + "）",
            ),
          );
        }
        break;
      }
    }
  };

  walk(root, "ruleGraph", 0);
  return issues;
}

/** 收集 RuleGraph 里全部字段引用（去重、稳定排序）。 */
export function collectRuleFieldReferences(root: RuleNode): readonly string[] {
  const out: string[] = [];
  walkRule(root, (node) => {
    if (node.kind === "CONDITION") {
      collectFieldReferences(node.left, out);
      collectFieldReferences(node.right, out);
    }
  });
  return [...new Set(out)].sort();
}

/**
 * 收集 RuleGraph 里全部特征引用（去重、稳定排序）。
 *
 * 🔴 包含两类：
 *   ① 显式 `FEATURE_REFERENCE`（`Expr.feature("ma20")`）；
 *   ② `bar.<派生字段>`（`bar.volumeRatio` / `bar.haircutFromEventLow` / …）—— 它们
 *      在 Runtime 里**由注册特征承载**（桥接表 `DERIVED_BAR_FIELD_TO_FEATURE_ID`）。
 *
 * 为什么必须包含 ②：否则 `featureRequirements` 会漏掉这些特征 ⇒ Runnable 时
 * `registry.resolve()` 抛 FEATURE_NOT_REGISTERED，而**声明层却看不出问题**
 * （这正是「声明面与实现面不一致」那一类缺陷）。桥接未登记的派生字段名**不进**集合，
 * 由 `parseCoreFieldReference` 判为 UNKNOWN 并在校验/泄漏层被拒。
 */
export function collectRuleFeatureReferences(root: RuleNode): readonly string[] {
  const out: string[] = [];
  walkRule(root, (node) => {
    if (node.kind !== "CONDITION") return;
    const expressions: readonly ValueExpression[] = [node.left, node.right];
    for (const expression of expressions) {
      for (const featureId of collectFeatureReferences(expression)) out.push(featureId);
      for (const field of collectFieldReferences(expression)) {
        const bridged = fieldReferenceFeatureId(field);
        if (bridged !== null) out.push(bridged);
      }
    }
  });
  return [...new Set(out)].sort();
}

/** 收集 RuleGraph 里全部参数引用（去重、稳定排序）。 */
export function collectRuleParameterReferences(root: RuleNode): readonly string[] {
  const out: string[] = [];
  walkRule(root, (node) => {
    if (node.kind === "CONDITION") {
      collectParameterReferences(node.left, out);
      collectParameterReferences(node.right, out);
    }
  });
  return [...new Set(out)].sort();
}

/** 收集 RuleGraph 里出现的节点种类（稳定排序）。 */
export function collectRuleNodeKinds(root: RuleNode): readonly RuleNodeKind[] {
  const kinds = new Set<RuleNodeKind>();
  walkRule(root, (node) => kinds.add(node.kind));
  return [...kinds].sort();
}

/** 收集 RuleGraph 里声明的观察窗口（WINDOW 节点；稳定排序）。 */
export function collectRuleWindows(root: RuleNode): readonly TemporalWindow[] {
  const out: TemporalWindow[] = [];
  walkRule(root, (node) => {
    if (node.kind === "WINDOW") out.push(node.window);
  });
  return out;
}

/** 遍历 RuleGraph 全部节点（确定性前序）。 */
export function walkRule(root: RuleNode, visit: (node: RuleNode) => void): void {
  const stack: RuleNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as RuleNode;
    visit(node);
    switch (node.kind) {
      case "ALL":
      case "ANY":
        for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index] as RuleNode);
        break;
      case "NOT":
        stack.push(node.child);
        break;
      case "WINDOW":
        stack.push(node.child);
        break;
      case "SEQUENCE":
        for (let index = node.steps.length - 1; index >= 0; index -= 1) stack.push(node.steps[index] as RuleNode);
        break;
      default:
        break;
    }
  }
}
