/**
 * createAnalysisForm — 「新建分析」表单状态、校验与 payload 构造（纯函数，无 React 依赖）。
 *
 * 三条纪律：
 *   1. **只暴露引擎真的实现了的分析类型**。`RESEARCH_ANALYSIS_TYPES` 里还有
 *      DISTRIBUTION / CORRELATION / IC / PATH / REGIME / SIGNIFICANCE，而已实现的只有
 *      `IMPLEMENTED_ANALYSIS_TYPES` 这 6 类（RESEARCH-002 的 5 类 + RESEARCH-004 的
 *      SEGMENT_RELATION）；把剩下的放进选择题只会让用户白跑一次并拿到 `UNKNOWN_ANALYSIS_TYPE`。
 *      `ANALYSIS_TYPE_OPTIONS` 用 `satisfies` 对**已实现子集**做编译期约束。
 *   2. **变量只能从真实变量目录里选**。目录由 Dataset 的真实视界推导，所以 UI 不做自由文本输入
 *      —— 手打一个 `future_return_7d` 在 outcome 表里并不存在，只会得到 `UNKNOWN_VARIABLE`。
 *   3. **条件值的类型由运算符决定**（`BETWEEN` → 二元组，`IN` → 列表，`IS_NULL` → 无值）。
 *      这一层要是错了，引擎会把它当成不成立的条件，静默少算样本 —— 所以在此显式构造并单测。
 */

import type { ResearchAnalysisType, ResearchConditionOperator, SegmentStatKind } from "../../../../server/researchCore";

// ---------------------------------------------------------------------------
// 分析类型（只列已实现的 6 类）
// ---------------------------------------------------------------------------

export const IMPLEMENTED_ANALYSIS_TYPES = [
  "DESCRIPTIVE",
  "EVENT_STUDY",
  "QUANTILE",
  "CONDITIONAL",
  "STABILITY",
  "SEGMENT_RELATION",
] as const satisfies ReadonlyArray<ResearchAnalysisType>;

export type ImplementedAnalysisType = (typeof IMPLEMENTED_ANALYSIS_TYPES)[number];

/**
 * 分段窗口径（`server/researchCore/config.ts#SEGMENT_STAT_KINDS` 的**类型镜像**）。
 *
 * ⚠️ 这里故意只镜像**类型**、不 `import` 服务端常量：值导入会把 `researchCore`（含 Repository
 * 与 DB 依赖）整条拖进前端 bundle，项目有 bundle 泄漏检查。`satisfies` 保证镜像不漂移 ——
 * 服务端增删口径时此处编译不过，而不是运行期静默少一个选项。
 */
export const SEGMENT_STAT_OPTIONS = [
  { value: "return", label: "分段收益", hint: "末值口径：close(止) / close(起) − 1" },
  { value: "max_return", label: "最大有利偏移", hint: "窗内最高价 / close(起) − 1" },
  { value: "min_return", label: "最大不利偏移", hint: "窗内最低价 / close(起) − 1" },
  { value: "max_drawdown", label: "最大跌幅", hint: "窗内最低收盘 / close(起) − 1（负值）" },
] as const satisfies ReadonlyArray<{ value: SegmentStatKind; label: string; hint: string }>;

/** 分段关系里「窗起点为 0」的语义：锚在**事件日收盘**（T），复用既有变量族。 */
export const WINDOW_ANCHOR_LABEL = "T（事件日收盘）";

export interface AnalysisTypeOption {
  value: ImplementedAnalysisType;
  /**
   * 类型名（短、稳定）。**会进入持久化的分析名**（如「分位分析：turnover 分 10 组 → …」），
   * 所以它必须像一个名字，而不是一句问题 —— 名字要能在列表里一眼扫过。
   */
  label: string;
  /** 用人话写的「这个类型能回答什么问题」，作为选择题的**主标题**（`label` 退为副标）。 */
  question: string;
  hint: string;
  /** 结论主分析的选取优先级（与后端 `PRIMARY_PRIORITY` 一致），用于给用户预期。 */
  primaryPriority: number | null;
}

export const ANALYSIS_TYPE_OPTIONS: ReadonlyArray<AnalysisTypeOption> = [
  {
    value: "QUANTILE",
    label: "分位分析",
    question: "某个信号和未来收益有关系吗",
    hint: "按信号值分档，比较各档未来收益（最常用的第一刀）",
    primaryPriority: 1,
  },
  {
    value: "CONDITIONAL",
    label: "条件分析",
    question: "满足某个条件的样本不一样吗",
    hint: "满足条件 vs 全样本的收益差异",
    primaryPriority: 2,
  },
  {
    value: "EVENT_STUDY",
    label: "事件研究",
    question: "事件之后怎么走",
    hint: "事件后 T+1/T+3/T+5… 的收益分布",
    primaryPriority: 3,
  },
  {
    value: "SEGMENT_RELATION",
    label: "分段关系",
    question: "前一阶段的表现，和后一阶段有关系吗",
    hint: "把行情切成先后两段，看前一段与后一段的共变（如「前 5 日跌幅 → 之后 15 日收益」）",
    primaryPriority: 5,
  },
  {
    value: "STABILITY",
    label: "稳定性分析",
    question: "这个规律在不同年份/板块都成立吗",
    hint: "按年度 / 板块等维度检验方向是否稳定",
    primaryPriority: 4,
  },
  {
    value: "DESCRIPTIVE",
    label: "描述统计",
    question: "先看看数据长什么样",
    hint: "变量分布（均值 / 分位 / 偏度 / 缺失率）",
    primaryPriority: null,
  },
];

export function analysisTypeOptionOf(type: string): AnalysisTypeOption | undefined {
  return ANALYSIS_TYPE_OPTIONS.find((o) => o.value === type);
}

/** 某分析类型需要哪些字段（唯一权威，UI 与校验共用）。 */
export interface AnalysisFormRequirements {
  needsFeature: boolean;
  needsTarget: boolean;
  needsVariables: boolean;
  needsQuantileGroups: boolean;
  needsDimension: boolean;
  needsHorizons: boolean;
  /** SEGMENT_RELATION：需要两个时间窗（窗 A 分组、窗 B 结果）。 */
  needsSegmentWindows: boolean;
  canHaveConditions: boolean;
  /** 无条件门槛：这些分析在没有任何条件时也能跑。 */
  requiresConditions: boolean;
}

export function analysisFormRequirements(type: ImplementedAnalysisType): AnalysisFormRequirements {
  switch (type) {
    case "DESCRIPTIVE":
      return {
        needsFeature: false,
        needsTarget: false,
        needsVariables: true,
        needsQuantileGroups: false,
        needsDimension: false,
        needsHorizons: false,
        needsSegmentWindows: false,
        canHaveConditions: true,
        requiresConditions: false,
      };
    case "EVENT_STUDY":
      return {
        needsFeature: false,
        needsTarget: false,
        needsVariables: false,
        needsQuantileGroups: false,
        needsDimension: false,
        needsHorizons: true,
        needsSegmentWindows: false,
        canHaveConditions: true,
        requiresConditions: false,
      };
    case "QUANTILE":
      return {
        needsFeature: true,
        needsTarget: true,
        needsVariables: false,
        needsQuantileGroups: true,
        needsDimension: false,
        needsHorizons: false,
        needsSegmentWindows: false,
        canHaveConditions: true,
        requiresConditions: false,
      };
    case "CONDITIONAL":
      return {
        needsFeature: false,
        needsTarget: true,
        needsVariables: false,
        needsQuantileGroups: false,
        needsDimension: false,
        needsHorizons: false,
        needsSegmentWindows: false,
        canHaveConditions: true,
        // 空条件 = 「等于全样本」，等于什么都没做 → 后端会拒绝，前端先拦
        requiresConditions: true,
      };
    case "STABILITY":
      return {
        needsFeature: false,
        needsTarget: true,
        needsVariables: false,
        needsQuantileGroups: false,
        needsDimension: true,
        needsHorizons: false,
        needsSegmentWindows: false,
        canHaveConditions: true,
        requiresConditions: false,
      };
    case "SEGMENT_RELATION":
      return {
        needsFeature: false,
        // 目标变量由两个窗推导，用户不直接选变量 —— 选了反而容易和窗不一致
        needsTarget: false,
        needsVariables: false,
        needsQuantileGroups: false,
        needsDimension: false,
        needsHorizons: false,
        needsSegmentWindows: true,
        canHaveConditions: true,
        requiresConditions: false,
      };
  }
}

// ---------------------------------------------------------------------------
// 条件
// ---------------------------------------------------------------------------

export interface ConditionOperatorOption {
  value: ResearchConditionOperator;
  label: string;
  /** 需要几个值：0 = 不需要（IS_NULL 系），1 = 单值，2 = 区间，LIST = 逗号分隔列表。 */
  arity: "NONE" | "ONE" | "TWO" | "LIST";
}

export const CONDITION_OPERATOR_OPTIONS: ReadonlyArray<ConditionOperatorOption> = [
  { value: ">", label: "大于", arity: "ONE" },
  { value: ">=", label: "大于等于", arity: "ONE" },
  { value: "<", label: "小于", arity: "ONE" },
  { value: "<=", label: "小于等于", arity: "ONE" },
  { value: "==", label: "等于", arity: "ONE" },
  { value: "!=", label: "不等于", arity: "ONE" },
  { value: "BETWEEN", label: "介于（闭区间）", arity: "TWO" },
  { value: "IN", label: "属于", arity: "LIST" },
  { value: "NOT_IN", label: "不属于", arity: "LIST" },
  { value: "IS_NULL", label: "缺失", arity: "NONE" },
  { value: "IS_NOT_NULL", label: "非缺失", arity: "NONE" },
];

export function operatorArityOf(operator: ResearchConditionOperator): ConditionOperatorOption["arity"] {
  return CONDITION_OPERATOR_OPTIONS.find((o) => o.value === operator)?.arity ?? "ONE";
}

export interface ConditionDraft {
  fieldName: string;
  operator: ResearchConditionOperator;
  /** 主值（`TWO` 时为下界）。 */
  value: string;
  /** 第二值（仅 `BETWEEN`）。 */
  value2: string;
  /** 本条件相对**前一条**的连接方式（组内首条忽略）。 */
  logicalOperator: "AND" | "OR" | "NOT";
}

export interface ConditionGroupDraft {
  /** 本组相对**前一组**的连接方式（首组忽略）。 */
  logicalOperator: "AND" | "OR";
  conditions: ConditionDraft[];
}

export function createEmptyCondition(): ConditionDraft {
  return { fieldName: "", operator: ">=", value: "", value2: "", logicalOperator: "AND" };
}

export function createEmptyConditionGroup(): ConditionGroupDraft {
  return { logicalOperator: "AND", conditions: [createEmptyCondition()] };
}

/** 把字符串按数字解析：能解析成有限数就转 number，否则保留字符串（如板块名 `main`）。 */
export function parseScalarValue(raw: string): number | string | null {
  const text = raw.trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : text;
}

/** 把逗号 / 顿号分隔的字符串解析成数组（`IN` / `NOT_IN` 用）。 */
export function parseListValue(raw: string): Array<number | string> {
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => parseScalarValue(s))
    .filter((v): v is number | string => v !== null);
}

/**
 * 条件值 → 领域形态（与后端 `conditionEvaluator` 的期望一致）。
 * 返回 `undefined` 表示「该运算符不需要值」。
 */
export function parseConditionValue(
  operator: ResearchConditionOperator,
  value: string,
  value2: string,
): unknown {
  switch (operatorArityOf(operator)) {
    case "NONE":
      return undefined;
    case "TWO": {
      const lo = parseScalarValue(value);
      const hi = parseScalarValue(value2);
      return lo === null || hi === null ? undefined : [lo, hi];
    }
    case "LIST":
      return parseListValue(value);
    default:
      return parseScalarValue(value) ?? undefined;
  }
}

/** 校验单个条件草稿，返回错误清单（空 = 可用）。 */
export function validateConditionDraft(
  draft: ConditionDraft,
  catalog: { features: readonly string[]; outcomes: readonly string[]; dimensions: readonly string[] },
): string[] {
  const errors: string[] = [];
  const field = draft.fieldName.trim();
  if (!field) {
    errors.push("请选择条件字段");
    return errors;
  }
  const known =
    catalog.features.includes(field) ||
    catalog.outcomes.includes(field) ||
    catalog.dimensions.includes(field);
  if (!known) {
    errors.push(`条件字段 "${field}" 不在当前 Dataset 的变量目录中`);
  }
  const arity = operatorArityOf(draft.operator);
  if (arity === "ONE" && draft.value.trim() === "") {
    errors.push(`条件「${field} ${draft.operator}」缺少比较值`);
  }
  if (arity === "TWO") {
    const lo = parseScalarValue(draft.value);
    const hi = parseScalarValue(draft.value2);
    if (lo === null || hi === null) {
      errors.push(`条件「${field} 介于」需要填写上下界`);
    } else if (typeof lo === "number" && typeof hi === "number" && lo > hi) {
      errors.push(`条件「${field} 介于」的下界大于上界，该条件恒不成立`);
    }
  }
  if (arity === "LIST" && parseListValue(draft.value).length === 0) {
    errors.push(`条件「${field} ${draft.operator}」需要至少一个候选值（逗号分隔）`);
  }
  return errors;
}

/**
 * 校验整组条件草稿（组内逐条 + 组间至少一条有效条件）。
 *
 * 「编辑既有分析的条件」必须走同一个校验入口 —— 否则会出现「新建拦得住、编辑
 * 拦不住」，把一个非法条件直接写到库里，下一次 Run 才炸。
 */
export function validateConditionGroups(
  groups: ReadonlyArray<ConditionGroupDraft>,
  catalog: { features: readonly string[]; outcomes: readonly string[]; dimensions: readonly string[] },
): string[] {
  const errors: string[] = [];
  const effective = conditionGroupsToPayload(groups);
  if (effective.length === 0) {
    errors.push("至少要有一条填好字段的条件；若想清空条件请改为删除分析或重建分析。");
  }
  groups.forEach((group, gi) => {
    group.conditions.forEach((cond, ci) => {
      for (const message of validateConditionDraft(cond, catalog)) {
        errors.push(`第 ${gi + 1} 组第 ${ci + 1} 条：${message}`);
      }
    });
  });
  return errors;
}

/**
 * 已落库条件行 → 条件组草稿（用于「编辑既有分析的条件」回填）。
 *
 * 反向映射规则与 `conditionGroupsToPayload` 严格对称：
 *   - `BETWEEN` 的数组值拆成上/下界两个输入框；
 *   - `IN` / `NOT_IN` 的数组值用逗号连接（与解析端 `parseListValue` 同一分隔符约定）；
 *   - `IS_NULL` / `IS_NOT_NULL` 无值 → 空串；
 *   - 标量直接字符串化。
 */
export function conditionPayloadToDraftGroups(
  rows: ReadonlyArray<AnalysisConditionInput>,
): ConditionGroupDraft[] {
  const byGroup = new Map<number, AnalysisConditionInput[]>();
  for (const row of rows) {
    const list = byGroup.get(row.groupNo) ?? [];
    list.push(row);
    byGroup.set(row.groupNo, list);
  }
  const groupNos = [...byGroup.keys()].sort((a, b) => a - b);
  return groupNos.map((groupNo) => {
    const items = [...(byGroup.get(groupNo) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const drafts: ConditionDraft[] = items.map((row) => {
      const arityOfRow = operatorArityOf(row.operator);
      let value = "";
      let value2 = "";
      if (arityOfRow === "TWO" && Array.isArray(row.value)) {
        value = row.value.length > 0 ? String(row.value[0]) : "";
        value2 = row.value.length > 1 ? String(row.value[1]) : "";
      } else if (arityOfRow === "LIST" && Array.isArray(row.value)) {
        value = row.value.map((v) => String(v)).join(",");
      } else if (arityOfRow !== "NONE" && row.value !== null && row.value !== undefined) {
        value = String(row.value);
      }
      return {
        fieldName: row.fieldName,
        operator: row.operator,
        value,
        value2,
        logicalOperator: row.logicalOperator,
      };
    });
    return {
      logicalOperator: items[0]?.groupLogicalOperator ?? "AND",
      conditions: drafts.length > 0 ? drafts : [createEmptyCondition()],
    };
  });
}

// ---------------------------------------------------------------------------
// 分段窗（SEGMENT_RELATION）
// ---------------------------------------------------------------------------

/** 窗相对日的可用范围（来自 Dataset 真实的 `path.relativeDay`；`null` = 该版本没有 path 数据）。 */
export interface SegmentWindowRange {
  min: number;
  max: number;
}

/**
 * 窗的**取值区间**（锚点日只提供基准价，不计入取值）。
 *
 * ⚠️ 这是后端 `server/researchEngine/analysisConfig.ts#resolveSegmentWindows` 中
 * `segmentValueWindow` 的**前端口径镜像**。镜像的目的是让用户在提交前就看到重叠错误，
 * 而不是白等一次服务端往返；**权威判定仍在后端**（前端拦不住的一律以后端为准）。
 * 若后端口径变化，此处必须同步 —— `createAnalysisForm.test.ts` 里有对齐断言。
 */
export function segmentValueWindow(from: number, to: number): [number, number] {
  return [from === 0 ? 1 : from + 1, to];
}

/** 两个闭区间是否有交集（与后端 `rangesOverlap` 同式）。 */
export function windowRangesOverlap(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/**
 * 窗 → 真实结果变量名（后端 `server/researchEngine/variables.ts#windowOutcomeVariableName` 的镜像）。
 *
 * 展示它的目的是**把口径摊开给用户看**：同样是「前 5 日最大跌幅」，
 * `from = 0` 得到的是 Dataset 既有的 `max_drawdown_5d`，而 `from = 1` 得到的是
 * `segment_max_drawdown_1_5d`（锚在 T+1 收盘）——两者不是同一个数，界面上必须能看出来。
 */
export function windowVariableName(stat: SegmentStatKind, from: number, to: number): string {
  if (from === 0) return stat === "return" ? `future_return_${to}d` : `${stat}_${to}d`;
  return `segment_${stat}_${from}_${to}d`;
}

/** 该窗是否走「既有变量族」（锚在事件日收盘 = 复用 Dataset 已定口径，而非新建口径）。 */
export function usesExistingVariableFamily(from: string): boolean {
  return from.trim() === "0";
}

/** 推荐默认窗：窗 A = `[0, 5]`（锚在事件日收盘，正好复用既有 `max_drawdown_5d`），窗 B = `[5, path 上界]`。 */
export function defaultSegmentWindows(range: SegmentWindowRange | null): {
  aFrom: string;
  aTo: string;
  bFrom: string;
  bTo: string;
} {
  const max = range?.max ?? 20;
  const aTo = Math.max(1, Math.min(5, max - 1));
  return { aFrom: "0", aTo: String(aTo), bFrom: String(aTo), bTo: String(max) };
}

/** 把字符串解析为整数相对日；非整数返回 null（不四舍五入，避免把 5.6 悄悄变成 6）。 */
export function parseRelativeDay(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isInteger(n) ? n : null;
}

// ---------------------------------------------------------------------------
// 表单状态
// ---------------------------------------------------------------------------

export interface CreateAnalysisFormState {
  analysisType: ImplementedAnalysisType;
  name: string;
  /** 特征变量（QUANTILE 必填）。 */
  featureField: string;
  /** 结果变量（QUANTILE / CONDITIONAL / STABILITY 必填）。 */
  targetField: string;
  /** 参与统计的变量清单（DESCRIPTIVE 必填）。 */
  variables: string[];
  /** 分组数（字符串保存，适配 number input）。 */
  quantileGroups: string;
  stabilityDimension: string;
  horizons: number[];
  conditions: ConditionGroupDraft[];
  // ---- SEGMENT_RELATION（字符串保存，适配 number input；0 = 锚在事件日收盘）----
  windowAFrom: string;
  windowATo: string;
  windowAStat: SegmentStatKind;
  windowBFrom: string;
  windowBTo: string;
  windowBStat: SegmentStatKind;
  windowBands: string;
}

export interface AnalysisFormDefaults {
  featureField?: string;
  targetField?: string;
  horizons?: readonly number[];
  /** 分段窗默认值（由调用方按真实 path 范围给出）。 */
  segmentWindows?: { aFrom: string; aTo: string; bFrom: string; bTo: string };
}

export function createDefaultAnalysisForm(
  analysisType: ImplementedAnalysisType = "QUANTILE",
  defaults: AnalysisFormDefaults = {},
): CreateAnalysisFormState {
  const seg = defaults.segmentWindows ?? defaultSegmentWindows(null);
  return {
    analysisType,
    name: "",
    featureField: defaults.featureField ?? "",
    targetField: defaults.targetField ?? "",
    variables: [],
    quantileGroups: "10",
    stabilityDimension: "year",
    horizons: [...(defaults.horizons ?? [5])],
    conditions: analysisFormRequirements(analysisType).requiresConditions
      ? [createEmptyConditionGroup()]
      : [],
    windowAFrom: seg.aFrom,
    windowATo: seg.aTo,
    windowAStat: "max_drawdown",
    windowBFrom: seg.bFrom,
    windowBTo: seg.bTo,
    windowBStat: "return",
    windowBands: "5",
  };
}

// ---------------------------------------------------------------------------
// 目录推荐
// ---------------------------------------------------------------------------

/**
 * 推荐默认目标变量：优先 `future_return_5d`（验收案例口径），
 * 否则取存在的第一个 `future_return_*`，再否则取目录第一个。**绝不返回不存在的变量名。**
 */
export function recommendTargetField(outcomes: readonly string[]): string {
  if (outcomes.includes("future_return_5d")) return "future_return_5d";
  const five = outcomes.find((o) => /^future_return_\d+d$/.test(o));
  if (five) return five;
  return outcomes[0] ?? "";
}

/** 推荐默认特征变量：优先 `turnover`（验收案例口径），否则目录第一个。 */
export function recommendFeatureField(features: readonly string[]): string {
  if (features.includes("turnover")) return "turnover";
  return features[0] ?? "";
}

/**
 * 可用视界 = 同时可由 `future_return_{h}d` 提供的 h（即 path 的真实相对日）。
 * `EVENT_STUDY` 的视口选项由它决定，**不硬编码 [1,3,5,10,20]**。
 */
export function availableFutureReturnHorizons(outcomes: readonly string[]): number[] {
  const set = new Set<number>();
  for (const name of outcomes) {
    const m = /^future_return_(\d+)d$/.exec(name);
    if (m) set.add(Number(m[1]));
  }
  return [...set].sort((a, b) => a - b);
}

/** 可用稳定性维度（来自 `listVariables.dimensions` 且排除不可用项）。 */
export function availableStabilityDimensions(dimensions: readonly string[]): string[] {
  return [...dimensions];
}

// ---------------------------------------------------------------------------
// 内置示例（「从例子开始」）
// ---------------------------------------------------------------------------
//
// 为什么要内置而不是只留「用户自己存模板」：模板机制要求**先有一个配好的分析**才能存，
// 而「不知道该怎么配」正是新用户卡住的地方 —— 拿它当入口等于让不会的人先会一遍。
// 这里给的是**具体研究问题 + 已配好的参数**，点一下整套填好，再按需微调。
//
// 三条写作纪律：
//   1. 标题用**研究问题**措辞（「没跌破…的，20 日怎么走」），不用分析类型名；
//   2. `story` 必须点出**读结论时的口径陷阱**（尤其事后条件筛选、不重叠约束）；
//   3. `requiredVariables` 只列**该例真正的关键变量**（不列通配），供 UI 在目录缺变量时
//      直接禁用该卡片并说明缺什么 —— 而不是让人点完才被后端拒绝。

/** 示例里的一条条件（只需字段 / 运算符 / 值，其余沿用空条件默认）。 */
export interface AnalysisExampleCondition {
  fieldName: string;
  operator: ResearchConditionOperator;
  value: string;
}

export interface AnalysisExample {
  id: string;
  /** 卡片主标题：研究问题本身。 */
  title: string;
  /** 一句话说明「在比较什么」+ 读结论时的口径提醒。 */
  story: string;
  analysisType: ImplementedAnalysisType;
  featureField?: string;
  targetField?: string;
  conditions?: readonly AnalysisExampleCondition[];
  variables?: readonly string[];
  quantileGroups?: number;
  horizons?: readonly number[];
  segmentWindows?: {
    aFrom: string;
    aTo: string;
    aStat: SegmentStatKind;
    bFrom: string;
    bTo: string;
    bStat: SegmentStatKind;
  };
  /** 该例依赖的关键变量（含目标变量）；缺任一 → UI 禁用该卡。 */
  requiredVariables: readonly string[];
}

export const ANALYSIS_EXAMPLES: readonly AnalysisExample[] = [
  {
    id: "hold-event-low",
    title: "没跌破涨停日最低价的，20 日怎么走",
    story:
      "条件 = T+1..T+5 **盘中**最低价始终站在事件日最低价上方（holds_event_low_5d = 1），"
      + "看它们 T+20 的收益，对照是全样本（含破位的）。"
      + "注意：这是用未来 5 天的走势筛样本，属**事后条件筛选**，不是 T 日可交易信号。",
    analysisType: "CONDITIONAL",
    targetField: "future_return_20d",
    conditions: [{ fieldName: "holds_event_low_5d", operator: "==", value: "1" }],
    requiredVariables: ["holds_event_low_5d", "future_return_20d"],
  },
  {
    id: "break-event-low",
    title: "跌破涨停日最低价的，是不是更差",
    story:
      "把 T+1..T+5 盘中**跌破**事件日最低价的那一档单独拎出来看 T+20（holds_event_low_5d = 0）。"
      + "与上一例互补 —— 两例合起来才构成完整对照。"
      + "想看「收盘口径」就把字段换成 holds_event_low_close_5d。",
    analysisType: "CONDITIONAL",
    targetField: "future_return_20d",
    conditions: [{ fieldName: "holds_event_low_5d", operator: "==", value: "0" }],
    requiredVariables: ["holds_event_low_5d", "future_return_20d"],
  },
  {
    id: "tradeable-first-board",
    title: "开盘买得到的首板（非一字），差多少",
    story:
      "条件 = 事件日**开盘价没到涨停价**（is_one_word_open = 0），即开盘那一刻挂得上单。"
      + "对照是全样本（含一字板）。要更严格的一字板定义，把字段换成 is_one_word_hold"
      + "（盘中从未开板）。",
    analysisType: "CONDITIONAL",
    targetField: "future_return_20d",
    conditions: [{ fieldName: "is_one_word_open", operator: "==", value: "0" }],
    requiredVariables: ["is_one_word_open", "future_return_20d"],
  },
  {
    id: "pullback-volume",
    title: "回踩第一天就缩量的，后面更好吗",
    story:
      "条件 = T+1 当天量比 < 0.8（相对事件日缩量两成以上），看它们 T+20 的收益，对照是全样本。"
      + "量比 = 当日成交量 ÷ 事件日成交量，< 1 即缩量。"
      + "量比要到 T+1 收盘才可观测（是**结果**而不是特征），所以这里只能做条件筛选，"
      + "同属事后筛选、不构成 T 日信号。想看 T+2..T+5 的缩量，把字段换成 volume_ratio_2d … volume_ratio_5d。",
    analysisType: "CONDITIONAL",
    targetField: "future_return_20d",
    conditions: [{ fieldName: "volume_ratio_1d", operator: "<", value: "0.8" }],
    requiredVariables: ["volume_ratio_1d", "future_return_20d"],
  },
  {
    id: "segment-drawdown-then-return",
    title: "前 5 日跌得越深，之后 15 日越强吗",
    story:
      "窗 A = T→T+5 最大跌幅（用来分档），窗 B = T+5→T+20 分段收益。"
      + "两个窗的**取值区间不能重叠**（锚点日不计入取值，所以 T+5 收 / T+6 起是合法的）。",
    analysisType: "SEGMENT_RELATION",
    segmentWindows: { aFrom: "0", aTo: "5", aStat: "max_drawdown", bFrom: "5", bTo: "20", bStat: "return" },
    requiredVariables: ["future_return_20d"],
  },
  {
    id: "volume-shape",
    title: "首板后 5 天的量能长什么样",
    story:
      "不设假设，先把 T+1..T+5 **逐日量比**的分布看一眼（均值 / 中位数 / 缺失率）。"
      + "常用作其他量能分析的前置检查 —— 缺失率高的话，后面按量比分档就要谨慎。",
    analysisType: "DESCRIPTIVE",
    variables: [
      "volume_ratio_1d",
      "volume_ratio_2d",
      "volume_ratio_3d",
      "volume_ratio_4d",
      "volume_ratio_5d",
    ],
    requiredVariables: ["volume_ratio_1d", "volume_ratio_5d"],
  },
];

/** 该示例在当前 Dataset 版本缺哪些变量（空数组 = 可用）。 */
export function missingVariablesForExample(
  example: AnalysisExample,
  catalog: { features: readonly string[]; outcomes: readonly string[] },
): string[] {
  return example.requiredVariables.filter(
    (name) => !catalog.features.includes(name) && !catalog.outcomes.includes(name),
  );
}

/**
 * 示例 → 完整表单状态。
 *
 * `name` 刻意留空：让 `suggestAnalysisName` 按最终参数生成分析名 ——
 * 预填一个写死的名字会在用户改参数后变成误导（名字与内容对不上）。
 */
export function applyAnalysisExample(
  example: AnalysisExample,
  segmentRange: SegmentWindowRange | null,
): CreateAnalysisFormState {
  // 分段窗按**真实 path 视界**钳制：例子写的是 5..20，若该 Dataset 的上界更小，
  // 直接用会越界。钳到上界后如果窗已不成立（上界 ≤ 起），退回按真实视界生成的默认窗。
  let segments = example.segmentWindows;
  if (segments !== undefined && segmentRange !== null && Number(segments.bTo) > segmentRange.max) {
    const clamped = { ...segments, bTo: String(segmentRange.max) };
    if (Number(clamped.bTo) > Number(clamped.bFrom)) {
      segments = clamped;
    } else {
      const fallback = defaultSegmentWindows(segmentRange);
      segments = { ...segments, aFrom: fallback.aFrom, aTo: fallback.aTo, bFrom: fallback.bFrom, bTo: fallback.bTo };
    }
  }

  const base = createDefaultAnalysisForm(example.analysisType, {
    ...(example.featureField !== undefined ? { featureField: example.featureField } : {}),
    ...(example.targetField !== undefined ? { targetField: example.targetField } : {}),
    ...(example.horizons !== undefined ? { horizons: example.horizons } : {}),
    ...(segments !== undefined
      ? {
          segmentWindows: {
            aFrom: segments.aFrom,
            aTo: segments.aTo,
            bFrom: segments.bFrom,
            bTo: segments.bTo,
          },
        }
      : {}),
  });
  return {
    ...base,
    ...(example.variables !== undefined ? { variables: [...example.variables] } : {}),
    ...(example.quantileGroups !== undefined ? { quantileGroups: String(example.quantileGroups) } : {}),
    ...(segments !== undefined
      ? { windowAStat: segments.aStat, windowBStat: segments.bStat }
      : {}),
    // 示例的条件统一放进**一组**（组内 AND）：`conditions` 的类型是
    // `ConditionGroupDraft[]`（组），不是 `ConditionDraft[]`（条目）——
    // 直接放条目会让组对象的 `conditions` 字段缺失，载荷构造器读到时崩。
    conditions:
      example.conditions !== undefined
        ? [
            {
              logicalOperator: "AND",
              conditions: example.conditions.map((condition) => ({
                ...createEmptyCondition(),
                fieldName: condition.fieldName,
                operator: condition.operator,
                value: condition.value,
              })),
            },
          ]
        : base.conditions,
  };
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export interface AnalysisFormCatalog {
  features: readonly string[];
  outcomes: readonly string[];
  dimensions: readonly string[];
  /** 分段窗可用范围（来自 Dataset 真实 path 视界；缺省/null = 不可用）。 */
  segmentRange?: SegmentWindowRange | null;
}

export function validateAnalysisForm(
  state: CreateAnalysisFormState,
  catalog: AnalysisFormCatalog,
): string[] {
  const errors: string[] = [];
  const req = analysisFormRequirements(state.analysisType);

  if (!state.name.trim()) {
    errors.push("请填写分析名称");
  } else if (state.name.trim().length > 200) {
    errors.push("分析名称不能超过 200 个字符");
  }

  if (req.needsFeature) {
    if (!state.featureField) {
      errors.push("请选择特征变量（只能来自 T 日及之前可观测的变量）");
    } else if (!catalog.features.includes(state.featureField)) {
      errors.push(`特征变量 "${state.featureField}" 不在当前 Dataset 中`);
    }
  }

  if (req.needsTarget) {
    if (!state.targetField) {
      errors.push("请选择目标变量（未来收益类，来自 T+1 之后）");
    } else if (!catalog.outcomes.includes(state.targetField)) {
      errors.push(`目标变量 "${state.targetField}" 不在当前 Dataset 中`);
    } else if (catalog.features.includes(state.targetField)) {
      // 理论上前端下拉框不会让用户选到，但仍显式拦截（与后端 VARIABLE_ROLE_VIOLATION 对齐）
      errors.push(`"${state.targetField}" 是特征变量，不能作为目标变量（PIT 违规）`);
    }
  }

  if (req.needsVariables) {
    if (state.variables.length === 0) {
      errors.push("请至少选择一个变量");
    } else {
      const unknown = state.variables.filter(
        (v) => !catalog.features.includes(v) && !catalog.outcomes.includes(v),
      );
      if (unknown.length > 0) {
        errors.push(`以下变量不在当前 Dataset 中：${unknown.join("、")}`);
      }
    }
  }

  if (req.needsQuantileGroups) {
    const n = Number(state.quantileGroups);
    if (!Number.isInteger(n) || n < 2) {
      errors.push("分组数必须是不小于 2 的整数");
    } else if (n > 100) {
      errors.push("分组数不能超过 100（组内样本会过少）");
    }
  }

  if (req.needsDimension) {
    if (!state.stabilityDimension) {
      errors.push("请选择稳定性维度");
    } else if (!catalog.dimensions.includes(state.stabilityDimension)) {
      errors.push(`稳定性维度 "${state.stabilityDimension}" 当前不可用`);
    }
  }

  if (req.needsHorizons && state.horizons.length === 0) {
    errors.push("请至少选择一个视界（T+N）");
  }

  if (req.needsSegmentWindows) {
    errors.push(...validateSegmentWindows(state, catalog.segmentRange ?? null));
  }

  const conditionErrors = state.conditions.flatMap((g) =>
    g.conditions.flatMap((c) => validateConditionDraft(c, catalog)),
  );
  errors.push(...conditionErrors);

  if (req.requiresConditions) {
    const usable = state.conditions.some((g) =>
      g.conditions.some((c) => c.fieldName.trim() !== "" && validateConditionDraft(c, catalog).length === 0),
    );
    if (!usable) {
      errors.push("条件分析至少需要一个完整可用的条件（空条件等于「等于全样本」，没有研究意义）");
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// payload
// ---------------------------------------------------------------------------

/**
 * 分段窗校验（前端预检，**与后端 `analysisConfig.ts#resolveSegmentWindows` 同式**）。
 *
 * 覆盖四项：窗形态、`from < to`、是否落在真实 path 视界内、两窗取值区间是否重叠。
 * 后端仍会再判一次并且是权威 —— 前端拦不住的（例如 Dataset 期间被重建）以后端为准。
 */
export function validateSegmentWindows(
  state: CreateAnalysisFormState,
  range: SegmentWindowRange | null,
): string[] {
  const errors: string[] = [];
  const max = range?.max ?? null;

  const parse = (label: string, fromRaw: string, toRaw: string): [number, number] | null => {
    const from = parseRelativeDay(fromRaw);
    const to = parseRelativeDay(toRaw);
    if (from === null || to === null) {
      errors.push(`${label}的相对日必须是整数（0 表示锚在事件日收盘 T）`);
      return null;
    }
    if (to <= from) {
      errors.push(`${label}的止必须大于起（实得 ${from} → ${to}）`);
      return null;
    }
    if (max !== null && to > max) {
      errors.push(`${label}的止超出该 Dataset 的 path 视界上界 T+${max}`);
      return null;
    }
    return [from, to];
  };

  const a = parse("窗 A", state.windowAFrom, state.windowATo);
  const b = parse("窗 B", state.windowBFrom, state.windowBTo);

  if (a !== null && b !== null) {
    const va = segmentValueWindow(a[0], a[1]);
    const vb = segmentValueWindow(b[0], b[1]);
    if (windowRangesOverlap(va, vb)) {
      errors.push(
        `两个窗的取值区间重叠（窗 A 取值 T+${va[0]}..T+${va[1]}、窗 B 取值 T+${vb[0]}..T+${vb[1]}）：`
          + "共享 K 线会让「后一段的表现」变成对前一段的同义反复，引擎会拒绝执行。"
          + "把窗 B 的起设在窗 A 的止之后即可。",
      );
    }
  }

  const bands = Number(state.windowBands);
  if (!Number.isInteger(bands) || bands < 2 || bands > 100) {
    errors.push("窗 A 的分档数必须是不小于 2、不大于 100 的整数");
  }

  return errors;
}

/** 分析配置（落 `research_analysis.configJson`，由引擎解析）。 */
export function toAnalysisConfig(state: CreateAnalysisFormState): Record<string, unknown> {
  const req = analysisFormRequirements(state.analysisType);
  const config: Record<string, unknown> = {};
  if (req.needsFeature) config.featureField = state.featureField;
  if (req.needsTarget) config.targetField = state.targetField;
  if (req.needsVariables) config.variables = [...state.variables];
  if (req.needsQuantileGroups) config.quantileGroups = Number(state.quantileGroups);
  if (req.needsDimension) config.stabilityDimension = state.stabilityDimension;
  if (req.needsHorizons) config.horizons = [...state.horizons].sort((a, b) => a - b);
  if (req.needsSegmentWindows) {
    config.windowA = [Number(state.windowAFrom), Number(state.windowATo)];
    config.windowB = [Number(state.windowBFrom), Number(state.windowBTo)];
    config.windowAStat = state.windowAStat;
    config.windowBStat = state.windowBStat;
    config.windowBands = Number(state.windowBands);
  }
  return config;
}

/** 条件行（落 `research_analysis_condition`）。 */
export interface AnalysisConditionInput {
  groupNo: number;
  sortOrder: number;
  fieldName: string;
  operator: ResearchConditionOperator;
  /**
   * 领域形态的值。API 契约要求**该键必须存在**（`z.unknown()` 是必填键），
   * 因此不需要值的运算符（`IS_NULL` / `IS_NOT_NULL`）显式发送 `null`，
   * 而不是省略键 —— 省略会被 tRPC 入参校验直接拒掉。
   */
  value: unknown;
  logicalOperator: "AND" | "OR" | "NOT";
  groupLogicalOperator: "AND" | "OR";
}

/**
 * 条件组草稿 → API 载荷（落 `research_analysis_condition`）。
 *
 * 独立成函数的原因：「新建分析」与「编辑既有分析的条件」用的是**同一套**条件
 * 草稿 UI，两条路径必须产出**逐字段一致**的载荷 —— 否则会出现「新建能过、编辑
 * 过不了」或更糟的「两条路径写入的口径不一样」。
 *
 * 编号规则（不是随手取的，由后端 `assertConditionSet` 的约束反推）：
 *   - **组号必须重排为连续的 0..n-1**。草稿允许存在「整组一个字都没填」的空组，
 *     这类组不产出任何行；若直接拿草稿下标当组号，就会出现 `{groupNo: 1}` 而缺 0
 *     的载荷，被后端以「条件组号不连续，缺少 0」直接拒掉。
 *   - **组内 sortOrder 按有效条件紧凑编号**。后端只要求组内唯一（不要求连续），
 *     但紧凑编号让「草稿 → 载荷」与「载荷 → 草稿」互为规范形，于是往返幂等 ——
 *     用户「打开编辑、什么都不改、点保存」不会改动库里任何口径。
 */
export function conditionGroupsToPayload(
  groups: ReadonlyArray<ConditionGroupDraft>,
): AnalysisConditionInput[] {
  const out: AnalysisConditionInput[] = [];
  let groupNo = 0;
  for (const group of groups) {
    // 字段名空白的行 = 「看起来填了、实际没填」，不落库也不占位
    const effective = group.conditions.filter((c) => c.fieldName.trim() !== "");
    if (effective.length === 0) continue; // 整组无有效条件 → 该组不存在，不占组号
    effective.forEach((cond, sortOrder) => {
      out.push({
        groupNo,
        sortOrder,
        fieldName: cond.fieldName.trim(),
        operator: cond.operator,
        value: parseConditionValue(cond.operator, cond.value, cond.value2) ?? null,
        logicalOperator: cond.logicalOperator,
        groupLogicalOperator: group.logicalOperator,
      });
    });
    groupNo += 1;
  }
  return out;
}

export function toAnalysisConditions(state: CreateAnalysisFormState): AnalysisConditionInput[] {
  return conditionGroupsToPayload(state.conditions);
}

/** 分析入口的 target 列（人读；与 `config.targetField` 同源）。 */
export function toAnalysisTarget(state: CreateAnalysisFormState): string | undefined {
  return analysisFormRequirements(state.analysisType).needsTarget ? state.targetField : undefined;
}

/** 一段窗的可读描述（`T+0..T+5 最大跌幅`；from=0 时写成 `T（事件日）..T+5`）。 */
export function windowDescription(state: CreateAnalysisFormState, which: "A" | "B"): string {
  const from = which === "A" ? state.windowAFrom : state.windowBFrom;
  const to = which === "A" ? state.windowATo : state.windowBTo;
  const stat = which === "A" ? state.windowAStat : state.windowBStat;
  const label = SEGMENT_STAT_OPTIONS.find((o) => o.value === stat)?.label ?? stat;
  const fromText = from === "0" ? WINDOW_ANCHOR_LABEL : `T+${from}`;
  return `${fromText}..T+${to} ${label}`;
}

/** 分段关系的整体描述（供预览与自动命名共用，避免两处文案不一致）。 */
export function segmentRelationDescription(state: CreateAnalysisFormState): string {
  return `${windowDescription(state, "A")} → ${windowDescription(state, "B")}`;
}

/** 未填名称时给一个不臆造的建议名（明确写出用的是哪个变量）。 */
export function suggestAnalysisName(state: CreateAnalysisFormState): string {
  const option = analysisTypeOptionOf(state.analysisType);
  const label = option?.label ?? state.analysisType;
  switch (state.analysisType) {
    case "QUANTILE":
      return state.featureField && state.targetField
        ? `${label}：${state.featureField} 分 ${state.quantileGroups} 组 → ${state.targetField}`
        : label;
    case "CONDITIONAL":
      return state.targetField ? `${label}：条件 → ${state.targetField}` : label;
    case "EVENT_STUDY":
      return state.horizons.length > 0
        ? `${label}：${state.horizons.map((h) => `T+${h}`).join(" / ")}`
        : label;
    case "STABILITY":
      return `${label}：按 ${state.stabilityDimension} 分组`;
    case "SEGMENT_RELATION":
      return `${label}：${segmentRelationDescription(state)}`;
    default:
      return state.variables.length > 0 ? `${label}：${state.variables.length} 个变量` : label;
  }
}
