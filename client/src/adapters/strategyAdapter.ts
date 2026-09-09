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
