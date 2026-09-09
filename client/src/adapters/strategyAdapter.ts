/**
 * strategyAdapter — StrategyDocument 的 Frontend Adapter（任务 §17）。
 *
 * 职责边界：
 * - 后端 StrategyDocument 以 `unknown`（z.custom 透传）进入前端，本 adapter 把其
 *   **防御性解析**为前端 ViewModel（`StrategyViewModel`），供可视化编辑器消费；
 * - 前端编辑完成后 `viewModelToStrategy` 把 ViewModel **序列化回 wire 格式**，交给
 *   `research.strategy.validate / compare` 权威校验；
 * - **无损往返**：未被可视化编辑覆盖的字段（recordKind / recordVersion / recipe /
 *   metadata / fingerprint 等）原样保留在 `extra`，序列化时透传，绝不丢字段；
 * - **不重算语义**：fingerprint 为前端占位展示，真实指纹由后端序列化层重算；本 adapter
 *   不复制领域 schema，只做「wire ↔ 展示形态」的边界转换。
 *
 * 权威 schema：`server/research/strategySchema/types.ts#StrategyDocument`（不可在此复制口径）。
 */

// ---------------------------------------------------------------------------
// 白名单常量（与后端 DECLARED_RULE_KINDS / RULE_COMPARISON_OPERATORS / POSITION_SIZING_KINDS
// 展示侧对齐；权威校验仍由后端 validateStrategyDocument 兜底）
// ---------------------------------------------------------------------------

export const RULE_KINDS = [
  "threshold",
  "time-based",
  "state",
  "event",
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const RULE_OPERATORS = [">=", ">", "<=", "<", "==", "!="] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export const POSITION_SIZING_KINDS = [
  "equal-weight",
  "fixed-fraction",
  "rank-weighted",
] as const;
export type PositionSizingKind = (typeof POSITION_SIZING_KINDS)[number];

// ---------------------------------------------------------------------------
// ViewModel（前端展示形态，非领域 schema）
// ---------------------------------------------------------------------------

export interface RuleViewModel {
  id: string;
  kind: RuleKind | string;
  description: string;
  /** 空字符串 = 未设。 */
  field: string;
  /** 空字符串 = 未设。 */
  operator: RuleOperator | "";
  operand: number | string | null;
  note: string;
}

export interface PositionSizingViewModel {
  kind: PositionSizingKind | string;
  maxPositions: number;
  /** 仅 fixed-fraction 使用。 */
  fraction: number | null;
}

export interface ParameterViewModel {
  name: string;
  type: "number" | "string" | "boolean";
  required: boolean;
  nullable: boolean;
  defaultValue: number | string | boolean | null;
  /** 原始契约是否显式携带 defaultValue 键（区分「无默认值」与「defaultValue: null」）。 */
  hasDefaultValue: boolean;
  min: number | null;
  max: number | null;
  step: number | null;
  allowedValues: string[];
  description: string;
}

export interface CostModelViewModel {
  commissionRate: number;
  stampDutyRate: number;
  transferFeeRate: number;
  slippageBps: number;
  lotSize: number;
  minCommission: number;
}

export interface StrategyViewModel {
  strategyId: string;
  version: string;
  name: string;
  description: string;
  // universe
  universeId: string;
  universeMembers: string[];
  universeDescription: string;
  // rules
  entryRules: RuleViewModel[];
  exitRules: RuleViewModel[];
  riskRules: RuleViewModel[];
  // position sizing
  positionSizing: PositionSizingViewModel;
  // parameters
  parameters: ParameterViewModel[];
  // dataset
  datasetVersion: string;
  // execution assumptions
  initialCapital: number;
  maxPositions: number | null;
  costModel: CostModelViewModel;
  executionModel: string;
  // fingerprint（前端占位）
  fingerprint: string;
  /** 未编辑的透传字段（recordKind/recordVersion/recipe/metadata 等），保证无损往返。 */
  extra: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 防御性取值
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asNullableNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

// ---------------------------------------------------------------------------
// rules
// ---------------------------------------------------------------------------

/** 空规则模板（供「+ 添加条件」）。 */
export function emptyRule(kind: RuleKind = "threshold"): RuleViewModel {
  return {
    id: `rule-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    description: "",
    field: "",
    operator: kind === "time-based" || kind === "state" ? ">=" : "<=",
    operand: null,
    note: "",
  };
}

function parseRule(raw: unknown): RuleViewModel {
  const r = isRecord(raw) ? raw : {};
  const kind = asStr(r.kind, "threshold");
  const operator = asStr(r.operator) as RuleOperator | "";
  const operandRaw = r.operand;
  const operand =
    operandRaw === null || operandRaw === undefined
      ? null
      : typeof operandRaw === "number" || typeof operandRaw === "string"
        ? operandRaw
        : null;
  return {
    id: asStr(r.id),
    kind,
    description: asStr(r.description),
    field: asStr(r.field),
    operator: (RULE_OPERATORS as readonly string[]).includes(operator)
      ? (operator as RuleOperator)
      : "",
    operand,
    note: asStr(r.note),
  };
}

function serializeRule(r: RuleViewModel): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: r.id,
    kind: r.kind,
    description: r.description,
  };
  if (r.field) out.field = r.field;
  if (r.operator) {
    out.operator = r.operator;
    // operand 可为 null（表示「与无值比较」）；未设时省略
    if (r.operand !== undefined) out.operand = r.operand;
  }
  if (r.note) out.note = r.note;
  return out;
}

// ---------------------------------------------------------------------------
// position sizing / parameters / cost model
// ---------------------------------------------------------------------------

function parsePositionSizing(raw: unknown): PositionSizingViewModel {
  const r = isRecord(raw) ? raw : {};
  const kind = asStr(r.kind, "equal-weight");
  return {
    kind,
    maxPositions: asNum(r.maxPositions, 1),
    fraction: asNullableNum(r.fraction),
  };
}

function serializePositionSizing(
  p: PositionSizingViewModel
): Record<string, unknown> {
  if (p.kind === "fixed-fraction") {
    return {
      kind: "fixed-fraction",
      fraction: p.fraction ?? 0,
      maxPositions: p.maxPositions,
    };
  }
  return { kind: p.kind, maxPositions: p.maxPositions };
}

function parseParameter(raw: unknown): ParameterViewModel {
  const r = isRecord(raw) ? raw : {};
  const dv = r.defaultValue;
  return {
    name: asStr(r.name),
    type: (["number", "string", "boolean"] as const).includes(r.type as never)
      ? (r.type as ParameterViewModel["type"])
      : "number",
    required: asBool(r.required),
    nullable: asBool(r.nullable),
    defaultValue:
      dv === null || dv === undefined
        ? null
        : typeof dv === "number" ||
            typeof dv === "string" ||
            typeof dv === "boolean"
          ? dv
          : null,
    hasDefaultValue: Object.prototype.hasOwnProperty.call(r, "defaultValue"),
    min: asNullableNum(r.min),
    max: asNullableNum(r.max),
    step: asNullableNum(r.step),
    allowedValues: asStrArray(r.allowedValues),
    description: asStr(r.description),
  };
}

function serializeParameter(p: ParameterViewModel): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: p.name,
    type: p.type,
    required: p.required,
  };
  if (p.nullable) out.nullable = true;
  // 保留「显式 defaultValue: null」与「无 defaultValue」的区别（无损往返）
  if (p.hasDefaultValue || p.defaultValue !== null) {
    out.defaultValue = p.defaultValue;
  }
  if (p.min !== null) out.min = p.min;
  if (p.max !== null) out.max = p.max;
  if (p.step !== null) out.step = p.step;
  if (p.allowedValues.length > 0) out.allowedValues = p.allowedValues;
  if (p.description) out.description = p.description;
  return out;
}

function parseCostModel(raw: unknown): CostModelViewModel {
  const r = isRecord(raw) ? raw : {};
  return {
    commissionRate: asNum(r.commissionRate, 0.0003),
    stampDutyRate: asNum(r.stampDutyRate, 0.001),
    transferFeeRate: asNum(r.transferFeeRate, 0.00001),
    slippageBps: asNum(r.slippageBps, 10),
    lotSize: asNum(r.lotSize, 100),
    minCommission: asNum(r.minCommission, 5),
  };
}

// ---------------------------------------------------------------------------
// 解析 / 序列化
// ---------------------------------------------------------------------------

/** 可视化编辑器会覆盖的已知字段（其余字段归入 extra 透传）。 */
const KNOWN_KEYS = new Set([
  "recordKind",
  "recordVersion",
  "strategyId",
  "version",
  "name",
  "description",
  "universe",
  "entryRules",
  "exitRules",
  "positionSizing",
  "riskRules",
  "parameters",
  "datasetVersion",
  "executionAssumptions",
  "fingerprint",
]);

/** wire（unknown）→ 前端 ViewModel。缺失字段给安全默认值，绝不抛错。 */
export function strategyToViewModel(raw: unknown): StrategyViewModel {
  const src = isRecord(raw) ? raw : {};
  const universe = isRecord(src.universe) ? src.universe : {};
  const exec = isRecord(src.executionAssumptions)
    ? src.executionAssumptions
    : {};
  const backtest = isRecord(exec.backtestConfig) ? exec.backtestConfig : {};

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (!KNOWN_KEYS.has(k)) extra[k] = v;
  }

  return {
    strategyId: asStr(src.strategyId, "strategy"),
    version: asStr(src.version, "1.0.0"),
    name: asStr(src.name, "未命名策略"),
    description: asStr(src.description),
    universeId: asStr(universe.universeId, "research-dataset:"),
    universeMembers: asStrArray(universe.members),
    universeDescription: asStr(universe.description),
    entryRules: (Array.isArray(src.entryRules) ? src.entryRules : []).map(
      parseRule
    ),
    exitRules: (Array.isArray(src.exitRules) ? src.exitRules : []).map(
      parseRule
    ),
    riskRules: (Array.isArray(src.riskRules) ? src.riskRules : []).map(
      parseRule
    ),
    positionSizing: parsePositionSizing(src.positionSizing),
    parameters:
      isRecord(src.parameters) && Array.isArray(src.parameters.parameters)
        ? (src.parameters.parameters as unknown[]).map(parseParameter)
        : [],
    datasetVersion: asStr(src.datasetVersion, ""),
    initialCapital: asNum(backtest.initialCapital, 100000),
    maxPositions: asNullableNum(backtest.maxPositions),
    costModel: parseCostModel(exec.costModel),
    executionModel: asStr(exec.executionModel, "NEXT_OPEN"),
    fingerprint: asStr(src.fingerprint, ""),
    extra,
  };
}

/** 前端 ViewModel → wire（提交给 validate / compare）。已知字段覆盖 extra，未知字段透传。 */
export function viewModelToStrategy(
  vm: StrategyViewModel
): Record<string, unknown> {
  const universe: Record<string, unknown> = { universeId: vm.universeId };
  if (vm.universeMembers.length > 0) universe.members = vm.universeMembers;
  if (vm.universeDescription) universe.description = vm.universeDescription;

  const backtestConfig: Record<string, unknown> = {
    initialCapital: vm.initialCapital,
  };
  if (vm.maxPositions !== null) backtestConfig.maxPositions = vm.maxPositions;

  const executionAssumptions: Record<string, unknown> = {
    backtestConfig,
    costModel: { ...vm.costModel },
    executionModel: vm.executionModel,
  };

  return {
    ...vm.extra,
    recordKind: (vm.extra.recordKind as string) ?? "STRATEGY_DOCUMENT",
    recordVersion: (vm.extra.recordVersion as number) ?? 1,
    strategyId: vm.strategyId,
    version: vm.version,
    name: vm.name,
    ...(vm.description ? { description: vm.description } : {}),
    universe,
    entryRules: vm.entryRules.map(serializeRule),
    exitRules: vm.exitRules.map(serializeRule),
    riskRules: vm.riskRules.map(serializeRule),
    positionSizing: serializePositionSizing(vm.positionSizing),
    parameters: { parameters: vm.parameters.map(serializeParameter) },
    datasetVersion: vm.datasetVersion,
    executionAssumptions,
    fingerprint: vm.fingerprint,
  };
}

// ---------------------------------------------------------------------------
// 便捷展示 helpers（只读，不改变数据）
// ---------------------------------------------------------------------------

/** 规则的人类可读条件文本（如 "candidate.rank <= 5"）。 */
export function ruleConditionText(r: RuleViewModel): string {
  if (!r.field && !r.operator) return r.description || "—";
  const lhs = r.field || "?";
  const op = r.operator || "?";
  const rhs =
    r.operand === null || r.operand === undefined ? "∅" : String(r.operand);
  return `${lhs} ${op} ${rhs}`;
}

/** 仓位模式的展示标签。 */
export function positionSizingLabel(kind: string): string {
  switch (kind) {
    case "equal-weight":
      return "等权分仓";
    case "fixed-fraction":
      return "固定比例";
    case "rank-weighted":
      return "按排名加权";
    default:
      return kind || "—";
  }
}

/** 仓位模式的中文说明（供编辑器展示语义）。 */
export function positionSizingDescription(kind: string): string {
  switch (kind) {
    case "equal-weight":
      return "入选的候选等额分配资金，每只仓位相同，简单稳健。";
    case "fixed-fraction":
      return "每只固定占用初始资金的一定比例，超出部分留作现金。";
    case "rank-weighted":
      return "按候选排名高低分配权重，排名越靠前仓位越重。";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// 中文化展示 helper（规则类型 / 操作符 / 字段 / 执行模型）
// ---------------------------------------------------------------------------

/** 规则类型的中文标签（kind 白名单）。 */
export function ruleKindLabel(kind: string): string {
  switch (kind) {
    case "threshold":
      return "阈值";
    case "time-based":
      return "时间";
    case "state":
      return "状态";
    case "event":
      return "事件";
    default:
      return kind || "—";
  }
}

/** 规则类型的中文说明。 */
export function ruleKindDescription(kind: string): string {
  switch (kind) {
    case "threshold":
      return "数值阈值比较（如涨跌幅 / 评分）";
    case "time-based":
      return "按持有时间 / 交易日触发";
    case "state":
      return "持仓或状态断言（如是否封板）";
    case "event":
      return "事件触发（如炸板 / 尾盘未封）";
    default:
      return "";
  }
}

/** 比较操作符的中文标签。 */
export function ruleOperatorLabel(op: string): string {
  switch (op) {
    case ">=":
      return "≥ 大于等于";
    case ">":
      return "> 大于";
    case "<=":
      return "≤ 小于等于";
    case "<":
      return "< 小于";
    case "==":
      return "= 等于";
    case "!=":
      return "≠ 不等于";
    default:
      return op || "—";
  }
}

/** 常用规则字段的中文标签（供字段选择与展示）。 */
export const RULE_FIELD_LABELS: Record<string, string> = {
  "candidate.rank": "候选综合排名",
  "price.pctChange": "当日涨跌幅 (%)",
  "price.limitUp": "是否封死涨停",
  "candle.consecutiveLimitUps": "连板数",
  "volume.turnoverRate": "换手率 (%)",
  "volume.volumeRatio": "量比",
  "marketCap.float": "流通市值 (亿)",
  "sealAmountRatio": "封单额/流通市值",
  "industry.isHot": "是否热点题材",
  "score.composite": "综合评分",
  "position.holdingDays": "持有天数",
  "position.pnlPct": "持仓盈亏 (%)",
  "limitUp.sealBroken": "是否炸板",
  "time.closeSealed": "尾盘是否封板",
  "price.dropFromHigh": "距高点回撤 (%)",
  "price.openGap": "开盘缺口 (%)",
  "position.count": "持仓数",
  "account.dailyLossPct": "单日账户亏损 (%)",
  "position.singleLossPct": "单笔亏损 (%)",
  "account.maxDrawdownPct": "账户最大回撤 (%)",
  "position.singleWeight": "单票仓位占比",
};

/** 字段中文标签（未知字段回退原文）。 */
export function ruleFieldLabel(field: string): string {
  return RULE_FIELD_LABELS[field] ?? field;
}

/** 执行模型标识的中文标签。 */
export const EXECUTION_MODEL_LABELS: Record<string, string> = {
  NEXT_OPEN: "次日开盘价",
  NEXT_CLOSE: "次日收盘价",
  VWAP_PROXY: "均价代理 (VWAP)",
  LIMIT_PRICE: "限价成交",
  "next-open": "次日开盘价",
};

// ---------------------------------------------------------------------------
// 规则预设（入场 / 退出 / 风险，中文语义，供「添加预设条件」快速填充）
// ---------------------------------------------------------------------------

export type RuleCategory = "entry" | "exit" | "risk";

export interface RulePreset {
  /** 下拉项中文标签。 */
  label: string;
  category: RuleCategory;
  kind: RuleKind;
  field: string;
  operator: RuleOperator;
  operand: number | string | null;
  /** 完整中文语义（规则 description）。 */
  description: string;
  note?: string;
}

export const RULE_PRESETS: RulePreset[] = [
  // -- 入场规则 --
  { label: "候选排名前 N", category: "entry", kind: "threshold", field: "candidate.rank", operator: "<=", operand: 5, description: "候选综合排名 ≤ 5 才允许进场" },
  { label: "逼近涨停", category: "entry", kind: "threshold", field: "price.pctChange", operator: ">=", operand: 9.5, description: "当日涨幅 ≥ 9.5%（逼近涨停板）" },
  { label: "收盘封板", category: "entry", kind: "state", field: "price.limitUp", operator: "==", operand: "true", description: "当日收盘封死涨停板" },
  { label: "连板高度", category: "entry", kind: "threshold", field: "candle.consecutiveLimitUps", operator: ">=", operand: 2, description: "连续涨停 ≥ 2 板（强势梯队）" },
  { label: "充分换手", category: "entry", kind: "threshold", field: "volume.turnoverRate", operator: ">=", operand: 5, description: "换手率 ≥ 5%（充分换手）" },
  { label: "放量配合", category: "entry", kind: "threshold", field: "volume.volumeRatio", operator: ">=", operand: 1.5, description: "量比 ≥ 1.5（较昨日放量）" },
  { label: "流通市值适中", category: "entry", kind: "threshold", field: "marketCap.float", operator: "<=", operand: 100, description: "流通市值 ≤ 100 亿元" },
  { label: "封单强度", category: "entry", kind: "threshold", field: "sealAmountRatio", operator: ">=", operand: 0.1, description: "封单额/流通市值 ≥ 10%" },
  { label: "热点题材", category: "entry", kind: "state", field: "industry.isHot", operator: "==", operand: "true", description: "所属板块为当日热点题材" },
  { label: "评分门槛", category: "entry", kind: "threshold", field: "score.composite", operator: ">=", operand: 60, description: "综合评分 ≥ 60 分" },
  // -- 退出规则 --
  { label: "持有期上限", category: "exit", kind: "time-based", field: "position.holdingDays", operator: ">=", operand: 3, description: "持有 ≥ 3 个交易日强制退出" },
  { label: "止盈离场", category: "exit", kind: "threshold", field: "position.pnlPct", operator: ">=", operand: 8, description: "持仓盈亏 ≥ 8% 止盈离场" },
  { label: "止损离场", category: "exit", kind: "threshold", field: "position.pnlPct", operator: "<=", operand: -5, description: "持仓盈亏 ≤ -5% 止损离场" },
  { label: "炸板退出", category: "exit", kind: "event", field: "limitUp.sealBroken", operator: "==", operand: "true", description: "涨停打开（炸板）即退出" },
  { label: "尾盘未封退出", category: "exit", kind: "event", field: "time.closeSealed", operator: "==", operand: "false", description: "尾盘未能封板则次日退出" },
  { label: "高点回撤退出", category: "exit", kind: "threshold", field: "price.dropFromHigh", operator: ">=", operand: 5, description: "距最高点回撤 ≥ 5% 退出" },
  { label: "低开止损", category: "exit", kind: "threshold", field: "price.openGap", operator: "<=", operand: -3, description: "次日低开 ≥ 3% 止损离场" },
  // -- 风险规则 --
  { label: "最大持仓数", category: "risk", kind: "state", field: "position.count", operator: "<=", operand: 5, description: "同时持仓数 ≤ 5 只" },
  { label: "单日亏损闸门", category: "risk", kind: "threshold", field: "account.dailyLossPct", operator: ">=", operand: 3, description: "单日账户亏损 ≥ 3% 停止开新仓" },
  { label: "单笔最大亏损", category: "risk", kind: "threshold", field: "position.singleLossPct", operator: "<=", operand: -5, description: "单笔亏损 ≤ -5%" },
  { label: "账户最大回撤", category: "risk", kind: "threshold", field: "account.maxDrawdownPct", operator: "<=", operand: 15, description: "账户最大回撤 ≤ 15%" },
  { label: "单票仓位上限", category: "risk", kind: "threshold", field: "position.singleWeight", operator: "<=", operand: 0.2, description: "单票仓位占比 ≤ 20%" },
];

/** 按类别筛选预设。 */
export function rulePresetsForCategory(category: RuleCategory): RulePreset[] {
  return RULE_PRESETS.filter(p => p.category === category);
}

/** 把预设转成一条可编辑的规则（生成唯一 id）。 */
export function presetToRule(preset: RulePreset): RuleViewModel {
  return {
    id: `rule-${Math.random().toString(36).slice(2, 8)}`,
    kind: preset.kind,
    description: preset.description,
    field: preset.field,
    operator: preset.operator,
    operand: preset.operand as number | string | null,
    note: preset.note ?? "",
  };
}
