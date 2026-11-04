/**
 * SCOPE-002 §1.3 —— 策略创作的**预设注册表**（纯声明 + 纯函数，无 IO）。
 *
 * ✅ 裁定 Q1：集中落位在本文件；`exitPolicyExperiments.ts` / `trailingPolicy.ts` /
 * `stateFactorRegistry.ts` / `recipeRegistry.ts` **保持原样不动**。本文件只做三件事：
 *   1. **引用**既有 payload（`STOP_POLICY_EXPERIMENTS` 的完整 `ExitPolicyDefinition`、
 *      `recipeRegistry` 的规范投影）；
 *   2. **声明**新预设常量（`TIME_EXIT` / `STRONG_HOLD` / `CAPITAL_RECYCLE` —— 裁定 Q2）；
 *   3. **暴露**可调参数点（RFC 6901 JSON Pointer，见 `./jsonPointer.ts`）。
 *
 * 🔴 本文件**不新增任何策略语义**：所有 payload 的类型都是 `AGENTS.md` §2 认可的既有类型
 * （`ExitPolicyDefinition` / `StrategyRecipe` / `RunnerHoldingBridgePolicyDefinition` …），
 * 物化后一律由既有校验器复核（见 `./materialize.ts`）。
 */
import type { ExitPolicyDefinition, RunnerHoldingBridgePolicyDefinition, StrongHoldPolicyDefinition } from "../exitPolicyCommon";
import { STOP_POLICY_EXPERIMENTS } from "../exitPolicyExperiments";
import { listStrategyRecipeProjections } from "../recipeRegistry";
import type { ResearchTrailingPolicyDefinition } from "../trailingPolicy";
import { RUNNER_HOLDING_BRIDGE_STATES } from "../exitPolicyCommon";
import { describeStopPolicy } from "../stopPolicy";
import { describeTrailingPolicy } from "../trailingPolicy";
import { encodePointerSegment } from "./jsonPointer";

/** 作者面槽位。`EXIT_BASE` 是「完整退出政策基座」，只在高级模式暴露（`advancedOnly`）。 */
export const STRATEGY_AUTHORING_SLOTS = [
  "RECIPE",
  "EXIT_POLICY",
  // ③ / ④：**字段补丁**预设（写草稿字段，不是 canonical payload）
  "POSITION",
  "COST",
  "EXIT_BASE",
  "STOP",
  "TAKE_PROFIT",
  "TIME_EXIT",
  "STRONG_HOLD",
  "CAPITAL_RECYCLE",
  "RUNNER_BRIDGE",
] as const;
export type StrategyAuthoringSlot = (typeof STRATEGY_AUTHORING_SLOTS)[number];

export const STRATEGY_AUTHORING_SLOT_LABELS: Readonly<Record<StrategyAuthoringSlot, string>> = {
  RECIPE: "信号配方",
  EXIT_POLICY: "退出政策（组合）",
  POSITION: "仓位与持仓数",
  COST: "成本与成交",
  EXIT_BASE: "退出政策基座（高级）",
  STOP: "止损（高级）",
  TAKE_PROFIT: "止盈（高级）",
  TIME_EXIT: "到期退出（高级）",
  STRONG_HOLD: "强势续持（高级）",
  CAPITAL_RECYCLE: "资金循环（高级）",
  RUNNER_BRIDGE: "Runner 持有桥（高级）",
};

export type StrategyPresetParameterValue = number | boolean | string;

/** 一个可调参数点。`path` 是 RFC 6901 JSON Pointer，指向**该预设 payload 内部**。 */
export interface StrategyPresetParameter {
  readonly code: string;
  readonly label: string;
  readonly description: string;
  readonly path: string;
  readonly valueType: "number" | "boolean" | "string";
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly allowedValues?: readonly string[];
  /** 枚举取值的**中文标签**（值本身不变；UI 显示标签、提交仍是 canonical 值）。 */
  readonly optionLabels?: Readonly<Record<string, string>>;
  readonly required: boolean;
  readonly defaultValue: StrategyPresetParameterValue;
}

export type StrategyPresetStatus = "REGISTERED" | "EXPERIMENTAL" | "DEPRECATED";

export interface StrategyPresetSummary {
  readonly presetId: string;
  readonly slot: StrategyAuthoringSlot;
  /** 技术标识（recipeId / 实验编号…）—— **只在"技术细节"里出现**。 */
  readonly label: string;
  /** 技术口径说明（保留给高级/排障视图）。 */
  readonly description: string;
  /**
   * 「配方名」：**给人看的中文名**（下拉里显示的就是它）。
   *
   * 🔴 这是展示层元数据，不参与任何计算。要求：非空、且**不等于 presetId**
   * （由 `vocabulary.test.ts` 守住 —— 新增配方必须顺手起个中文名，不许糊 id）。
   */
  readonly displayName: string;
  /** 一句话人话说明：这个配方**做什么**、**适合什么场景**。 */
  readonly summary: string;
  readonly status: StrategyPresetStatus;
  /** 预设自身版本（审计冻结用，见 SCOPE-002 §1.5 裁定 Q5）。 */
  readonly version: string;
  /** 溯源：这份 payload 来自哪里。 */
  readonly sourceRef: string;
  /** 🔴 高级模式才显示（默认下拉过滤掉）。 */
  readonly advancedOnly: boolean;
  readonly parameters: readonly StrategyPresetParameter[];
}

/** 原子预设：payload 是某个既有类型的实例（或 `null` = 显式关闭该子槽）。 */
export interface AtomicStrategyPreset extends StrategyPresetSummary {
  readonly kind: "ATOMIC";
  readonly payload: unknown;
}

/** 组合预设：以完整 `ExitPolicyDefinition` 为基座，可再叠加 runnerBridge / 逐子槽覆盖。 */
export interface CompositeStrategyPreset extends StrategyPresetSummary {
  readonly kind: "COMPOSITE";
  readonly composition: {
    readonly base: string;
    readonly runnerBridge: string | null;
    readonly overrides?: Readonly<Partial<Record<
      "stop" | "takeProfit" | "timeExit" | "strongHold" | "capitalRecycle",
      string | null
    >>>;
  };
}

/**
 * **字段补丁**预设：payload **不是** canonical 定义片段，而是写给「策略定义草稿」的补丁
 * （形状：`{ 段名: { 字段名: 值 } }`，段名 = `DefinitionDrafts` 的键）。
 *
 * 🔴 为什么要单独一个 kind：③ 仓位 / ④ 成本与成交在定义里**没有**独立载体，
 *    它们就是 `position.*` / `execution.*` + 文档级 `executionAssumptions.*` 的若干字段。
 *    把它们伪装成 `ATOMIC`（canonical payload）会让前端有可能整体写进文档 ⇒ 类型上就挡住。
 *
 * 🔴 与 C-2「一个概念只有一个编辑点」的关系：补丁只**填**那些本来就由表单编辑的字段；
 *    表单（草稿）仍是唯一真相，预设只是"一按就填好的一组值"，不新增第二处定义。
 */
export interface FieldPatchStrategyPreset extends StrategyPresetSummary {
  readonly kind: "FIELD_PATCH";
  readonly payload: Readonly<Record<string, Readonly<Record<string, StrategyPresetParameterValue>>>>;
}

export type StrategyAuthoringPreset = AtomicStrategyPreset | CompositeStrategyPreset | FieldPatchStrategyPreset;

// ---------------------------------------------------------------------------
// 参数派生（从**既有 payload 的真实形状**读，不硬编码预设专有映射）
// ---------------------------------------------------------------------------

function num(code: string, label: string, description: string, path: string, value: number, extra: Partial<StrategyPresetParameter> = {}): StrategyPresetParameter {
  return { code, label, description, path, valueType: "number", required: true, defaultValue: value, ...extra };
}

function bool(code: string, label: string, description: string, path: string, value: boolean): StrategyPresetParameter {
  return { code, label, description, path, valueType: "boolean", required: true, defaultValue: value };
}

/** Runner 状态取值的中文名（展示层；值本身仍是 `NEW_HIGH_3` 这类 canonical 标识）。 */
const RUNNER_STATE_LABELS: Readonly<Record<string, string>> = {
  NEW_HIGH_2: "创 2 日新高",
  NEW_HIGH_3: "创 3 日新高",
  CONSECUTIVE_HIGHER_HIGHS_GE_2: "连续 2 日抬高",
  RETURN_2_POSITIVE: "2 日收益为正",
  RETURN_3_POSITIVE: "3 日收益为正",
  CLOSE_ABOVE_MA5: "收盘站上 MA5",
  CLOSE_ABOVE_MA10: "收盘站上 MA10",
  MA5_SLOPE_POSITIVE: "MA5 向上",
  MA10_SLOPE_POSITIVE: "MA10 向上",
  NEAR_5D_HIGH: "接近 5 日高点",
  CONSECUTIVE_LOWER_CLOSES_GE_2: "连续 2 日收低",
  CLOSE_LOCATION_UPPER_THIRD: "收盘在当日上 1/3",
};

/** 由 `StopPolicyDefinition` 的真实形状派生可调点（无则返回空 ⇒ 不猜）。 */
export function deriveStopParameters(stop: unknown): StrategyPresetParameter[] {
  const out: StrategyPresetParameter[] = [];
  const policy = (stop ?? {}) as Record<string, any>;
  const anchor = policy.anchor;
  if (anchor?.kind === "FIXED_PERCENT" && typeof anchor.stopRatio === "number") {
    out.push(num("anchor.stopRatio", "初始止损比例", "固定百分比止损（0.06 = 6%）", "/anchor/stopRatio", anchor.stopRatio, { min: 0.005, max: 0.5, step: 0.005, unit: "ratio" }));
  }
  const escalation = policy.escalation;
  if (escalation?.kind === "PEAK_DRAWDOWN") {
    if (typeof escalation.activationRatio === "number") {
      out.push(num("escalation.activationRatio", "升级激活浮盈", "浮盈达到该比例后才启用峰值回撤", "/escalation/activationRatio", escalation.activationRatio, { min: 0, max: 1, step: 0.005, unit: "ratio" }));
    }
    if (typeof escalation.drawdownRatio === "number") {
      out.push(num("escalation.drawdownRatio", "峰值回撤幅度", "从最高价回撤达到该比例即止损", "/escalation/drawdownRatio", escalation.drawdownRatio, { min: 0.005, max: 0.5, step: 0.005, unit: "ratio" }));
    }
  }
  return out;
}

export function deriveTakeProfitParameters(takeProfit: unknown): StrategyPresetParameter[] {
  const p = (takeProfit ?? {}) as Record<string, any>;
  if (p.kind !== "MA_CROSS") return [];
  return [
    num("fastWindow", "快线窗口", "MA 交叉止盈的快线（交易日）", "/fastWindow", p.fastWindow, { min: 1, max: 60, step: 1, unit: "TRADING_DAY" }),
    num("slowWindow", "慢线窗口", "MA 交叉止盈的慢线（交易日）", "/slowWindow", p.slowWindow, { min: 2, max: 250, step: 1, unit: "TRADING_DAY" }),
    num("activationRatio", "激活浮盈", "浮盈达到该比例后才启用该止盈", "/activationRatio", p.activationRatio, { min: 0, max: 1, step: 0.005, unit: "ratio" }),
  ];
}

export function deriveTimeExitParameters(timeExit: unknown): StrategyPresetParameter[] {
  const p = (timeExit ?? {}) as Record<string, any>;
  if (p.kind !== "FIXED_HOLDING_DAYS") return [];
  return [num("holdingDays", "到期持有日", "持有满 N 个交易日后退出", "/holdingDays", p.holdingDays, { min: 1, max: 250, step: 1, unit: "TRADING_DAY" })];
}

export function deriveStrongHoldParameters(strongHold: unknown): StrategyPresetParameter[] {
  const p = (strongHold ?? {}) as Record<string, any>;
  if (p === null || typeof p !== "object") return [];
  const out: StrategyPresetParameter[] = [];
  if (typeof p.atHoldingDays === "number") out.push(num("atHoldingDays", "判定持有日", "在该持有日收盘判定是否续持", "/atHoldingDays", p.atHoldingDays, { min: 1, max: 120, step: 1, unit: "TRADING_DAY" }));
  if (typeof p.minReturnRatio === "number") out.push(num("minReturnRatio", "续持最低浮盈", "浮盈达到该比例才允许续持", "/minReturnRatio", p.minReturnRatio, { min: 0, max: 1, step: 0.005, unit: "ratio" }));
  if (typeof p.extendToHoldingDays === "number") out.push(num("extendToHoldingDays", "延长至持有日", "续持后的持有上限", "/extendToHoldingDays", p.extendToHoldingDays, { min: 1, max: 250, step: 1, unit: "TRADING_DAY" }));
  if (typeof p.requireAboveMa5 === "boolean") out.push(bool("requireAboveMa5", "需在 MA5 之上", "续持当日收盘需高于 MA5", "/requireAboveMa5", p.requireAboveMa5));
  if (typeof p.requireAboveMa10 === "boolean") out.push(bool("requireAboveMa10", "需在 MA10 之上", "续持当日收盘需高于 MA10", "/requireAboveMa10", p.requireAboveMa10));
  return out;
}

export function deriveRunnerBridgeParameters(bridge: unknown): StrategyPresetParameter[] {
  const p = (bridge ?? {}) as Record<string, any>;
  if (p === null || typeof p !== "object" || p.kind !== "PIT_RUNNER_HOLDING_BRIDGE") return [];
  const out: StrategyPresetParameter[] = [];
  if (typeof p.state === "string") {
    out.push({
      code: "state", label: "判定状态", description: "在判定日用该状态决定是否延长持有",
      path: "/state", valueType: "string", required: true, defaultValue: p.state,
      allowedValues: [...RUNNER_HOLDING_BRIDGE_STATES],
      optionLabels: RUNNER_STATE_LABELS,
    });
  }
  if (typeof p.decisionHoldingDays === "number") out.push(num("decisionHoldingDays", "判定持有日", "在该持有日收盘做状态判定", "/decisionHoldingDays", p.decisionHoldingDays, { min: 1, max: 120, step: 1, unit: "TRADING_DAY" }));
  if (typeof p.extendToHoldingDays === "number") out.push(num("extendToHoldingDays", "延长至持有日", "状态成立时延长的持有上限", "/extendToHoldingDays", p.extendToHoldingDays, { min: 2, max: 250, step: 1, unit: "TRADING_DAY" }));
  return out;
}

/** 把「子槽 payload 的参数」重挂到组合 policy 的路径下（`/anchor/x` → `/stop/anchor/x`）。 */
function prefixParameters(prefix: string, parameters: readonly StrategyPresetParameter[]): StrategyPresetParameter[] {
  return parameters.map(p => ({ ...p, code: `${prefix}.${p.code}`, path: `/${encodePointerSegment(prefix)}${p.path}` }));
}

/**
 * 退出政策的**短规则名**：一句话把关键规则串起来（用户要的是"名字就能说明白"）。
 *
 * 形如：`止损6%｜浮盈3%后回撤8%｜破MA5/MA10走｜最长5日｜强势延至10日`
 */
function describePolicyShortName(policy: ExitPolicyDefinition): string {
  const parts: string[] = [];
  const anchor = policy.stop.anchor;
  if (anchor.kind === "FIXED_PERCENT") {
    parts.push(`止损${String(Math.round(anchor.stopRatio * 100))}%`);
  } else {
    parts.push(`止损${describeStopPolicy(policy.stop).replace(/^固定\s*/, "")}`);
  }
  const escalation = policy.stop.escalation;
  if (escalation !== undefined && escalation !== null) {
    if (escalation.kind === "PEAK_DRAWDOWN") {
      parts.push(`浮盈${String(Math.round(escalation.activationRatio * 100))}%后回撤${String(Math.round(escalation.drawdownRatio * 100))}%`);
    } else if (escalation.kind === "CHANDELIER") {
      parts.push(`吊灯${String(escalation.atrMultiplier)}倍ATR`);
    } else if (escalation.kind === "MA_BAND") {
      parts.push(`MA${String(escalation.maWindow)}轨道`);
    } else {
      parts.push(`升级止损`);
    }
  }
  if (policy.stop.schedule !== undefined && policy.stop.schedule !== null) parts.push("分阶段止损");
  const takeProfit = policy.takeProfit;
  if (takeProfit !== null && takeProfit.kind === "MA_CROSS") {
    parts.push(`破MA${String(takeProfit.fastWindow)}/MA${String(takeProfit.slowWindow)}走`);
  } else if (takeProfit !== null) {
    parts.push("移动止盈");
  }
  if (policy.timeExit !== null) parts.push(`最长${String(policy.timeExit.holdingDays)}日`);
  if (policy.strongHold !== null) parts.push(`强势延至${String(policy.strongHold.extendToHoldingDays)}日`);
  return parts.join("｜");
}

/** 把一份完整退出政策说成一句人话（复用既有的两个中文描述器，不自造词）。 */
function describeExitPolicy(policy: ExitPolicyDefinition): string {
  const parts: string[] = [`止损 ${describeStopPolicy(policy.stop)}`];
  if (policy.takeProfit !== null) parts.push(describeTrailingPolicy(policy.takeProfit));
  if (policy.timeExit !== null) parts.push(`持有满 ${String(policy.timeExit.holdingDays)} 个交易日后退出`);
  if (policy.strongHold !== null) {
    parts.push(`第 ${String(policy.strongHold.atHoldingDays)} 日浮盈≥${(policy.strongHold.minReturnRatio * 100).toFixed(1)}% 且站上均线则续持至第 ${String(policy.strongHold.extendToHoldingDays)} 日`);
  }
  if (policy.runnerBridge !== undefined && policy.runnerBridge !== null) {
    parts.push(`第 ${String(policy.runnerBridge.decisionHoldingDays)} 日若满足 Runner 状态则延长至第 ${String(policy.runnerBridge.extendToHoldingDays)} 日`);
  }
  return parts.join("；");
}

// ---------------------------------------------------------------------------
// 退出政策基座（EXIT_BASE，来自既有 STOP_POLICY_EXPERIMENTS；仅高级模式）
// ---------------------------------------------------------------------------

const VALIDATED_BASE_IDS = new Set(["SL-18.1"]);

function exitBasePreset(id: string, experiment: { readonly version: string; readonly name: string; readonly policy: ExitPolicyDefinition }): AtomicStrategyPreset {
  return {
    kind: "ATOMIC",
    presetId: `exitBase:${id}`,
    slot: "EXIT_BASE",
    label: `${id} · ${experiment.name}`,
    description: `完整退出政策基座（来自 exitPolicyExperiments 的 ${id}@${experiment.version}）`,
    displayName: `${id}｜${describePolicyShortName(experiment.policy)}`,
    summary: describeExitPolicy(experiment.policy),
    status: VALIDATED_BASE_IDS.has(id) ? "REGISTERED" : "EXPERIMENTAL",
    version: experiment.version,
    sourceRef: `server/research/exitPolicyExperiments.ts#STOP_POLICY_EXPERIMENTS["${id}"]`,
    advancedOnly: true,
    payload: experiment.policy,
    parameters: [
      ...prefixParameters("stop", deriveStopParameters(experiment.policy.stop)),
      ...prefixParameters("takeProfit", deriveTakeProfitParameters(experiment.policy.takeProfit)),
      ...prefixParameters("timeExit", deriveTimeExitParameters(experiment.policy.timeExit)),
      ...prefixParameters("strongHold", deriveStrongHoldParameters(experiment.policy.strongHold)),
    ],
  };
}

export const EXIT_BASE_PRESETS: readonly AtomicStrategyPreset[] = Object.entries(STOP_POLICY_EXPERIMENTS)
  .map(([id, experiment]) => exitBasePreset(id, experiment))
  .sort((a, b) => a.presetId.localeCompare(b.presetId));

// ---------------------------------------------------------------------------
// RunnerBridge（含「关闭」）
// ---------------------------------------------------------------------------

const RUNNER_BRIDGE_OFF: AtomicStrategyPreset = {
  kind: "ATOMIC", presetId: "runnerBridge:off", slot: "RUNNER_BRIDGE",
  label: "不启用 Runner", description: "显式关闭 runnerBridge（canonical 的 null）",
  displayName: "不延长（到点就走）", summary: "不做状态判定，持有到原定时间/止盈止损条件触发即退出。",
  status: "REGISTERED", version: "1", sourceRef: "SCOPE-002 §1.3.4 显式关闭", advancedOnly: false,
  payload: null, parameters: [],
};

const RUNNER_BRIDGE_NH3_5_20: AtomicStrategyPreset = (() => {
  const payload: RunnerHoldingBridgePolicyDefinition = {
    kind: "PIT_RUNNER_HOLDING_BRIDGE",
    state: "NEW_HIGH_3",
    decisionHoldingDays: 5,
    extendToHoldingDays: 20,
  };
  return {
    kind: "ATOMIC", presetId: "runnerBridge:NH3_DECIDE5_EXTEND20", slot: "RUNNER_BRIDGE",
    label: "NEW_HIGH_3 · 5 → 20", description: "第 5 个持有日收盘若创 3 日新高，则延长至第 20 个持有日（3570001 的 Runner 形状）",
    displayName: "创新高延长至 20 日", summary: "第 5 个持有日收盘若创近 3 日新高，把持有上限从 5 日放宽到 20 日；否则按原计划退出。",
    status: "REGISTERED", version: "1", sourceRef: "SERVER/research/strategy_versions#3570001 · RESULT-RUNNER-NEWHIGH3-PROMOTE-001",
    advancedOnly: false, payload, parameters: deriveRunnerBridgeParameters(payload),
  };
})();

export const RUNNER_BRIDGE_PRESETS: readonly AtomicStrategyPreset[] = [RUNNER_BRIDGE_NH3_5_20, RUNNER_BRIDGE_OFF];

// ---------------------------------------------------------------------------
// 逐子槽覆盖预设（高级模式；含「关闭」）
// ---------------------------------------------------------------------------

function offPreset(slot: StrategyAuthoringSlot, presetId: string, label: string): AtomicStrategyPreset {
  return {
    kind: "ATOMIC", presetId, slot, label, description: "显式关闭该子槽（canonical 的 null）",
    displayName: label, summary: "该子槽留空（canonical 的 null）：这一段不参与退出判定。",
    status: "REGISTERED", version: "1", sourceRef: "SCOPE-002 §1.3.4 显式关闭", advancedOnly: true,
    payload: null, parameters: [],
  };
}

export const TAKE_PROFIT_PRESETS: readonly AtomicStrategyPreset[] = [
  {
    kind: "ATOMIC", presetId: "takeProfit:MA_CROSS_5_10_ACT0", slot: "TAKE_PROFIT",
    label: "MA5 × MA10 死叉止盈", description: "快线下穿慢线即止盈（无浮盈激活门槛）",
    displayName: "跌破 MA5/MA10 就走", summary: "收盘同时跌破 MA5 与 MA10，提示趋势走坏，次日开盘退出。",
    status: "REGISTERED", version: "1", sourceRef: "server/research/exitPolicyExperiments.ts#MA_TAKE_PROFIT",
    advancedOnly: true,
    payload: { kind: "MA_CROSS", fastWindow: 5, slowWindow: 10, activationRatio: 0 } satisfies ResearchTrailingPolicyDefinition,
    parameters: deriveTakeProfitParameters({ kind: "MA_CROSS", fastWindow: 5, slowWindow: 10, activationRatio: 0 }),
  },
  offPreset("TAKE_PROFIT", "takeProfit:off", "不启用止盈"),
];

export const TIME_EXIT_PRESETS: readonly AtomicStrategyPreset[] = [
  {
    kind: "ATOMIC", presetId: "timeExit:FIXED_5", slot: "TIME_EXIT",
    label: "持有 5 个交易日后退出", description: "固定持有期退出（3570001 的 timeExit）",
    displayName: "最多拿 5 个交易日", summary: "不论盈亏，持有满 5 个交易日后退出（给短线节奏兜底）。",
    status: "REGISTERED", version: "1", sourceRef: "server/research/exitPolicyExperiments.ts#BASE timeExit",
    advancedOnly: true,
    payload: { kind: "FIXED_HOLDING_DAYS", holdingDays: 5 },
    parameters: deriveTimeExitParameters({ kind: "FIXED_HOLDING_DAYS", holdingDays: 5 }),
  },
  offPreset("TIME_EXIT", "timeExit:off", "不启用到期退出"),
];

export const STRONG_HOLD_PRESETS: readonly AtomicStrategyPreset[] = [
  {
    kind: "ATOMIC", presetId: "strongHold:DAY5_TO_10_MIN3PCT_ABOVE_MA5_MA10", slot: "STRONG_HOLD",
    label: "第 5 日强势续持至第 10 日", description: "浮盈≥3% 且收盘在 MA5/MA10 之上则续持至第 10 日，之后走时间退出",
    displayName: "够强就多拿 5 天", summary: "第 5 日浮盈≥3% 且收盘站上 MA5、MA10，就把持有上限从 5 日放宽到 10 日。",
    status: "REGISTERED", version: "1", sourceRef: "server/research/exitPolicyExperiments.ts#BASE_STRONG_HOLD",
    advancedOnly: true,
    payload: {
      atHoldingDays: 5, minReturnRatio: 0.03, requireAboveMa5: true, requireAboveMa10: true,
      extendToHoldingDays: 10, afterExtendedHold: "TIME_EXIT",
    } satisfies StrongHoldPolicyDefinition,
    parameters: deriveStrongHoldParameters({ atHoldingDays: 5, minReturnRatio: 0.03, requireAboveMa5: true, requireAboveMa10: true, extendToHoldingDays: 10 }),
  },
  offPreset("STRONG_HOLD", "strongHold:off", "不启用强势续持"),
];

export const CAPITAL_RECYCLE_PRESETS: readonly AtomicStrategyPreset[] = [
  offPreset("CAPITAL_RECYCLE", "capitalRecycle:off", "不启用资金循环"),
];

/** 高级模式下的 STOP 原子覆盖（payload = `StopPolicyDefinition`，从基座里取）。 */
export const STOP_PRESETS: readonly AtomicStrategyPreset[] = buildStopOverridePresets();

function buildStopOverridePresets(): AtomicStrategyPreset[] {
  return [...EXIT_BASE_PRESETS]
    .map(base => {
      const payload = (base.payload as ExitPolicyDefinition).stop;
      const id = base.presetId.replace("exitBase:", "");
      return {
        kind: "ATOMIC" as const,
        presetId: `stop:${id}`,
        slot: "STOP" as const,
        label: `${id} 的止损段`,
        description: `从退出政策基座 ${id} 取出的 stop 段（高级覆盖）`,
        displayName: `${id} 的止损`,
        summary: describeStopPolicy(payload),
        status: base.status,
        version: base.version,
        sourceRef: base.sourceRef,
        advancedOnly: true,
        payload,
        parameters: deriveStopParameters(payload),
      };
    })
    .sort((a, b) => a.presetId.localeCompare(b.presetId));
}

// ---------------------------------------------------------------------------
// Recipe 预设（来自 recipeRegistry 的唯一投影）
// ---------------------------------------------------------------------------

/**
 * 配方的**人话名**（展示层元数据，不参与任何计算）。
 *
 * 🔴 未登记的配方回落到 recipeId —— `vocabulary.test.ts` 会因此失败：
 *    新增配方必须顺手起个中文名，不许把 id 糊到用户脸上。
 */
const RECIPE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "leader-candidate-baseline": "涨幅前 5 名",
  "first-limit-pullback-3f-top1": "首板回踩 · 3F 评分取第 1",
  "first-limit-pullback-3f-top2": "首板回踩 · 3F 评分取前 2",
  "first-limit-pullback-3f-top3": "首板回踩 · 3F 评分取前 3",
  "first-limit-pullback-3f-top5": "首板回踩 · 3F 评分取前 5",
  "first-limit-pullback-3f-top3-no-pullback-gate": "首板回踩（不要求回踩）· 3F 取前 3",
  "first-limit-pullback-3f-top5-no-pullback-gate": "首板回踩（不要求回踩）· 3F 取前 5",
  "first-limit-pullback-3f-calibrated-n5": "首板回踩 · 校准 N5 评分",
  "first-limit-pullback-hold-shrink": "首板回踩 · 守线 + 缩量",
  "first-limit-pool-fixed-3f": "首板股票池 · 固定窗口 3F",
  "first-limit-pool-rolling-3f": "首板股票池 · 滚动 3F",
};

export const RECIPE_PRESETS: readonly AtomicStrategyPreset[] = listStrategyRecipeProjections().map(recipe => ({
  kind: "ATOMIC" as const,
  presetId: `recipe:${recipe.recipeId}`,
  slot: "RECIPE" as const,
  label: recipe.recipeId,
  displayName: RECIPE_DISPLAY_NAMES[recipe.recipeId] ?? recipe.recipeId,
  summary: recipe.signalDescription ?? `已注册执行配方 ${recipe.recipeId}`,
  description: recipe.signalDescription ?? `已注册执行配方 ${recipe.recipeId}`,
  status: "REGISTERED" as const,
  version: "1",
  sourceRef: `server/research/recipeRegistry.ts#projectStrategyRecipe("${recipe.recipeId}")`,
  advancedOnly: false,
  payload: recipe,
  // 配方的可调门槛属策略文档的 `parameters[]`（参数搜索空间段），不在此处重复声明。
  parameters: [],
}));

/**
 * EXIT_POLICY 预设落到 `definition.exit.rules[]` 时的**规则外壳**。
 *
 * 🔴 它与 3570001 / `definitionBuild` 产出的 `exit-unified-policy` 形状**逐字段同形**
 * （只差 `description` 文案 —— 而文案已被 `diff.ts` 的语义比较忽略）。
 * 放在服务端是为了避免前端自造外壳（SCOPE-002 §0.2 P4）：前端只做"逐字复制"。
 */
export const EXIT_POLICY_RULE_ENVELOPE = {
  id: "exit-unified-policy",
  type: "STOP_LOSS",
  trigger: "ON_CLOSE",
  priority: 0,
  enabled: true,
  description: "统一退出策略：止损、止盈、时间退出、strongHold 与 runnerBridge 由 policy 配置表达（来源：策略创作工作台 EXIT_POLICY 预设）",
} as const;

// ---------------------------------------------------------------------------
// EXIT_POLICY 组合预设（默认下拉就展示这些）
// ---------------------------------------------------------------------------

function composeExitPolicy(input: {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly displayName: string;
  readonly summary: string;
  readonly status: StrategyPresetStatus;
  readonly version: string;
  readonly sourceRef: string;
  readonly baseId: string;
  readonly runnerBridgeId: string | null;
}): CompositeStrategyPreset {
  const base = EXIT_BASE_PRESETS.find(p => p.presetId === input.baseId);
  if (base === undefined) throw new Error(`EXIT_POLICY 预设 ${input.id} 引用了不存在的基座：${input.baseId}`);
  const bridge = input.runnerBridgeId === null
    ? null
    : RUNNER_BRIDGE_PRESETS.find(p => p.presetId === input.runnerBridgeId) ?? null;
  if (input.runnerBridgeId !== null && bridge === null) {
    throw new Error(`EXIT_POLICY 预设 ${input.id} 引用了不存在的 runnerBridge：${input.runnerBridgeId}`);
  }
  return {
    kind: "COMPOSITE",
    presetId: `exit:${input.id}`,
    slot: "EXIT_POLICY",
    label: input.label,
    description: input.description,
    displayName: input.displayName,
    summary: input.summary,
    status: input.status,
    version: input.version,
    sourceRef: input.sourceRef,
    advancedOnly: false,
    composition: {
      base: input.baseId,
      runnerBridge: input.runnerBridgeId,
    },
    parameters: [
      ...base.parameters,
      ...(bridge === null ? [] : prefixParameters("runnerBridge", bridge.parameters)),
    ],
  };
}

function basePreset(id: string): AtomicStrategyPreset {
  const found = EXIT_BASE_PRESETS.find(p => p.presetId === `exitBase:${id}`);
  if (found === undefined) throw new Error(`exitPolicyExperiments 缺少基座 ${id}`);
  return found;
}

export const EXIT_POLICY_PRESETS: readonly CompositeStrategyPreset[] = [
  // 🔴 3570001 的验收锚点：SL-18.1 完整政策 + NEW_HIGH_3 / 5 → 20
  composeExitPolicy({
    id: "SL-18.1-nh3-5-20",
    label: "SL-18.1 + NEW_HIGH_3 5 → 20",
    description: "3570001 的退出政策：固定 6% 止损（盘中）+ 峰值回撤 3%/8% 升级 + MA5×MA10 止盈 + 5 日到期 + 第 5 日强势续持至第 10 日 + NEW_HIGH_3 延长至第 20 日",
    displayName: "6%止损｜8%回撤保护｜破均线走｜最长20日",
    summary: "进场后先按 6% 止损（盘中触发）；浮盈超 3% 后改用峰值回撤 8% 保护；跌破 MA5/MA10 就走；最多拿 5 日，够强可续到 10 日，创新高可延长到 20 日。",
    status: "REGISTERED",
    version: "1.0.0",
    sourceRef: "Strategy Version 3570001（RESULT-STRATEGY-BRIDGE-RUNNER-FINAL-001）",
    baseId: "exitBase:SL-18.1",
    runnerBridgeId: "runnerBridge:NH3_DECIDE5_EXTEND20",
  }),
  // 同基座、无 Runner ⇒ 1.62.1 对照形状
  composeExitPolicy({
    id: "SL-18.1",
    label: "SL-18.1（无 Runner）",
    description: "与 3570001 同基座但不启用 runnerBridge —— 评估里的 1.62.1 对照形状",
    displayName: "6%止损｜8%回撤保护｜破均线走｜最长10日",
    summary: "与推荐版同一套止损/止盈/到期规则，但**不做创新高延长** —— 到点就走，适合作为对照。",
    status: "REGISTERED",
    version: "1.0.0",
    sourceRef: "server/research/exitPolicyExperiments.ts#SL-18.1",
    baseId: "exitBase:SL-18.1",
    runnerBridgeId: null,
  }),
  ...["SL-18.0", "SL-18.2", "SL-19.0", "SL-20.0"].map(id =>
    composeExitPolicy({
      id,
      label: basePreset(id).label,
      description: `${id} 完整退出政策（未启用 Runner）`,
      displayName: describePolicyShortName((basePreset(id).payload as ExitPolicyDefinition)),
      summary: `${basePreset(id).summary}；不延长持有。`,
      status: "EXPERIMENTAL",
      version: basePreset(id).version,
      sourceRef: basePreset(id).sourceRef,
      baseId: `exitBase:${id}`,
      runnerBridgeId: null,
    }),
  ),
];

// ---------------------------------------------------------------------------
// ③ 仓位与持仓数（FIELD_PATCH ⇒ DefinitionDrafts.position / cost）
// ---------------------------------------------------------------------------

/**
 * 🔴 「最多同时持有」在 payload 里**只出现一次**（`/position/maxPositions`）。
 *
 * 落库时它必须同时写 `definition.position.maxPositions` 与
 * `executionAssumptions.backtestConfig.maxPositions`（P-1 的「单一编辑点 + 双写」裁定，见
 * FE-PLAN-003 §5.4）—— 那一份由**客户端应用补丁时镜像**（`applyFieldPatch`），
 * 不在预设里声明两次，免得用户看到两个旋钮（C-2）。
 */
function positionPreset(input: {
  readonly id: string;
  readonly label: string;
  readonly displayName: string;
  readonly summary: string;
  readonly status: StrategyPresetStatus;
  readonly sizingMethod: string;
  readonly maxPositions: number;
  readonly positionRatio?: number;
  readonly fixedAmount?: number;
}): FieldPatchStrategyPreset {
  const parameters: StrategyPresetParameter[] = [
    ...(input.positionRatio === undefined ? [] : [
      num("positionRatio", "单笔比例", "每笔用总资金的多少（0.2 = 两成）", "/position/positionRatio", input.positionRatio, {
        unit: "ratio", min: 0.01, max: 1, step: 0.01,
      }),
    ]),
    ...(input.fixedAmount === undefined ? [] : [
      num("fixedAmount", "每笔金额", "每一笔投入的金额（元）", "/position/fixedAmount", input.fixedAmount, {
        unit: "CNY", min: 1000, step: 1000,
      }),
    ]),
    num("maxPositions", "最多同时持有", "最多同时拿几只（也写入回测配置的最大持仓数）", "/position/maxPositions", input.maxPositions, {
      unit: "COUNT", min: 1, max: 50, step: 1,
    }),
  ];
  return {
    kind: "FIELD_PATCH",
    presetId: `position:${input.id}`,
    slot: "POSITION",
    label: input.label,
    displayName: input.displayName,
    summary: input.summary,
    description: input.summary,
    status: input.status,
    version: "1.0.0",
    sourceRef: "FE-PLAN-003 §5.4（position.* 执行层已生效：BACKTEST-002 / server/runWorkbenchAssembly/assemble.ts#positionSizing）",
    advancedOnly: false,
    payload: {
      position: {
        sizingMethod: input.sizingMethod,
        maxPositions: input.maxPositions,
        ...(input.positionRatio === undefined ? {} : { positionRatio: input.positionRatio }),
        ...(input.fixedAmount === undefined ? {} : { fixedAmount: input.fixedAmount }),
      },
    },
    parameters,
  };
}

export const POSITION_PRESETS: readonly FieldPatchStrategyPreset[] = [
  positionPreset({
    id: "fixed-ratio-20-max5",
    label: "FIXED_RATIO 0.2 × 5",
    displayName: "固定比例 20% × 最多 5 只",
    summary: "每笔投总资金的 20%，最多同时拿 5 只 —— 仓位随权益走，赚了钱下一笔自动变大。",
    status: "REGISTERED",
    sizingMethod: "FIXED_RATIO",
    positionRatio: 0.2,
    maxPositions: 5,
  }),
  positionPreset({
    id: "equal-weight-max5",
    label: "EQUAL_WEIGHT × 5",
    displayName: "等权（各 1/N）× 最多 5 只",
    summary: "可用资金在同时持有的标的上等分，最多 5 只 —— 不做个股加权。",
    status: "REGISTERED",
    sizingMethod: "EQUAL_WEIGHT",
    maxPositions: 5,
  }),
  positionPreset({
    id: "fixed-amount-100k-max3",
    label: "FIXED_AMOUNT 100000 × 3",
    displayName: "固定金额 10 万 × 最多 3 只",
    summary: "每笔固定投 10 万元，最多同时拿 3 只 —— 单笔金额不随权益变化，便于对账。",
    status: "REGISTERED",
    sizingMethod: "FIXED_AMOUNT",
    fixedAmount: 100000,
    maxPositions: 3,
  }),
  positionPreset({
    id: "equity-ratio-10-max10",
    label: "EQUITY_RATIO 0.1 × 10",
    displayName: "总权益比例 10% × 最多 10 只",
    summary: "每笔按**总权益**的 10% 下单，最多同时拿 10 只 —— 更分散，单笔更小。",
    status: "EXPERIMENTAL",
    sizingMethod: "EQUITY_RATIO",
    positionRatio: 0.1,
    maxPositions: 10,
  }),
];

// ---------------------------------------------------------------------------
// ④ 成本与成交（FIELD_PATCH ⇒ DefinitionDrafts.cost / execution）
// ---------------------------------------------------------------------------

/**
 * 一套**成本与成交**命名配置。覆盖 7 项成本假设（`executionAssumptions.costModel` +
 * `backtestConfig.initialCapital`）与 3 项成交口径（`definition.execution.*`）。
 *
 * 🔴 数值口径与 `client/src/components/research/candidateSketchCostPreset.ts` 的
 *    `A_SHARE_COST_PRESET` **同一组数字**（佣金万3 / 印花千1 / 过户万0.1 / 滑点 10bp /
 *    100 股一手 / 最低佣金 5 元）。要改就两边一起改 —— 这是口径，不是风格。
 */
function costSlotPreset(input: {
  readonly id: string;
  readonly label: string;
  readonly displayName: string;
  readonly summary: string;
  readonly status: StrategyPresetStatus;
  readonly initialCapital: number;
  readonly commissionRate: number;
  readonly stampDutyRate: number;
  readonly transferFeeRate: number;
  readonly slippageBps: number;
  readonly lotSize: number;
  readonly minCommission: number;
  readonly signalTiming: string;
  readonly executionTiming: string;
  readonly priceType: string;
  readonly parameterOverrides?: readonly string[];
}): FieldPatchStrategyPreset {
  const executionLabels: Readonly<Record<string, string>> = {
    T_OPEN: "T 日开盘", T_CLOSE: "T 日收盘",
    T_PLUS_1_OPEN: "T+1 开盘", T_PLUS_1_CLOSE: "T+1 收盘", T_PLUS_2_OPEN: "T+2 开盘",
  };
  const all: readonly StrategyPresetParameter[] = [
    num("initialCapital", "初始资金", "回测起始资金（元）", "/cost/initialCapital", input.initialCapital, { unit: "CNY", min: 10000, step: 10000 }),
    num("commissionRate", "佣金率", "券商佣金（0.0003 = 万3）", "/cost/commissionRate", input.commissionRate, { unit: "ratio", min: 0, max: 0.01, step: 0.00001 }),
    num("stampDutyRate", "印花税率", "卖出印花税（0.001 = 千1）", "/cost/stampDutyRate", input.stampDutyRate, { unit: "ratio", min: 0, max: 0.01, step: 0.00001 }),
    num("transferFeeRate", "过户费率", "过户费（0.00001 = 万0.1）", "/cost/transferFeeRate", input.transferFeeRate, { unit: "ratio", min: 0, max: 0.01, step: 0.000001 }),
    num("slippageBps", "滑点", "成交价不利偏移（基点，10 = 0.1%）", "/cost/slippageBps", input.slippageBps, { unit: "BPS", min: 0, max: 200, step: 1 }),
    num("lotSize", "每手股数", "A 股是 100", "/cost/lotSize", input.lotSize, { unit: "SHARES", min: 1, max: 10000, step: 100 }),
    num("minCommission", "最低佣金", "单笔最低佣金（元）", "/cost/minCommission", input.minCommission, { unit: "CNY", min: 0, step: 1 }),
    {
      code: "signalTiming", label: "信号时点", description: "信号在哪个 bar 判定",
      path: "/execution/signalTiming", valueType: "string", required: true, defaultValue: input.signalTiming,
      allowedValues: ["T_OPEN", "T_CLOSE"], optionLabels: executionLabels,
    },
    {
      code: "executionTiming", label: "成交时点", description: "相对信号 bar 的哪一根成交",
      path: "/execution/executionTiming", valueType: "string", required: true, defaultValue: input.executionTiming,
      allowedValues: ["T_CLOSE", "T_PLUS_1_OPEN", "T_PLUS_1_CLOSE", "T_PLUS_2_OPEN"], optionLabels: executionLabels,
    },
    {
      code: "priceType", label: "成交价格类型", description: "用哪根 bar 的哪个价成交",
      path: "/execution/priceType", valueType: "string", required: true, defaultValue: input.priceType,
      allowedValues: ["OPEN", "CLOSE", "HIGH", "LOW", "VWAP"],
      optionLabels: { OPEN: "开盘价", CLOSE: "收盘价", HIGH: "最高价", LOW: "最低价", VWAP: "均价（VWAP）" },
    },
  ];
  const overrides = input.parameterOverrides;
  return {
    kind: "FIELD_PATCH",
    presetId: `cost:${input.id}`,
    slot: "COST",
    label: input.label,
    displayName: input.displayName,
    summary: input.summary,
    description: input.summary,
    status: input.status,
    version: "1.0.0",
    sourceRef: "executionAssumptions（client/src/adapters/strategyAdapter.ts#parseCostModel 兜底值 + candidateSketchCostPreset.ts#A_SHARE_COST_PRESET）",
    advancedOnly: false,
    payload: {
      cost: {
        initialCapital: input.initialCapital,
        commissionRate: input.commissionRate,
        stampDutyRate: input.stampDutyRate,
        transferFeeRate: input.transferFeeRate,
        slippageBps: input.slippageBps,
        lotSize: input.lotSize,
        minCommission: input.minCommission,
      },
      execution: {
        signalTiming: input.signalTiming,
        executionTiming: input.executionTiming,
        priceType: input.priceType,
      },
    },
    parameters: overrides === undefined ? all : all.filter(p => overrides.includes(p.code)),
  };
}

export const COST_SLOT_PRESETS: readonly FieldPatchStrategyPreset[] = [
  costSlotPreset({
    id: "a-share-standard-open-1m",
    label: "A 股标准 · 100 万 · T+1 开盘",
    displayName: "A 股标准（万3佣金·千1印花·10bp滑点）· 100 万 · T+1 开盘",
    summary: "券商佣金万3、卖出印花税千1、过户费万0.1、滑点 10bp、100 股一手、最低佣金 5 元；T 日收盘出信号、T+1 开盘成交。",
    status: "REGISTERED",
    initialCapital: 1000000, commissionRate: 0.0003, stampDutyRate: 0.001, transferFeeRate: 0.00001,
    slippageBps: 10, lotSize: 100, minCommission: 5,
    signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_OPEN", priceType: "OPEN",
  }),
  costSlotPreset({
    id: "a-share-standard-close-1m",
    label: "A 股标准 · 100 万 · T+1 收盘",
    displayName: "A 股标准 · 100 万 · T+1 收盘成交",
    summary: "成本与上一条相同，只把成交挪到 T+1 收盘 —— 用来测「早一天还是晚一天成交」的差别。",
    status: "EXPERIMENTAL",
    initialCapital: 1000000, commissionRate: 0.0003, stampDutyRate: 0.001, transferFeeRate: 0.00001,
    slippageBps: 10, lotSize: 100, minCommission: 5,
    signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_CLOSE", priceType: "OPEN",
  }),
  costSlotPreset({
    id: "zero-cost-open-1m",
    label: "零成本 · 100 万 · T+1 开盘",
    displayName: "零成本（理想化对照）· 100 万 · T+1 开盘",
    summary: "把全部费率与滑点归零 —— **不是真实可成交口径**，只用来量「成本吃掉多少收益」的上界。",
    status: "EXPERIMENTAL",
    initialCapital: 1000000, commissionRate: 0, stampDutyRate: 0, transferFeeRate: 0,
    slippageBps: 0, lotSize: 100, minCommission: 0,
    signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_OPEN", priceType: "OPEN",
  }),
  costSlotPreset({
    id: "high-slippage-30bp-1m",
    label: "A 股标准 · 滑点 30bp · 100 万",
    displayName: "A 股标准 + 高滑点压力（30bp）· 100 万 · T+1 开盘",
    summary: "其余同 A 股标准，只把滑点抬到 30bp —— 压力测试「成交比想象中差」时的表现。",
    status: "EXPERIMENTAL",
    initialCapital: 1000000, commissionRate: 0.0003, stampDutyRate: 0.001, transferFeeRate: 0.00001,
    slippageBps: 30, lotSize: 100, minCommission: 5,
    signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_OPEN", priceType: "OPEN",
  }),
];

// ---------------------------------------------------------------------------
// 汇总查询
// ---------------------------------------------------------------------------

const ALL_PRESETS: readonly StrategyAuthoringPreset[] = [
  ...RECIPE_PRESETS,
  ...EXIT_POLICY_PRESETS,
  ...POSITION_PRESETS,
  ...COST_SLOT_PRESETS,
  ...EXIT_BASE_PRESETS,
  ...STOP_PRESETS,
  ...TAKE_PROFIT_PRESETS,
  ...TIME_EXIT_PRESETS,
  ...STRONG_HOLD_PRESETS,
  ...CAPITAL_RECYCLE_PRESETS,
  ...RUNNER_BRIDGE_PRESETS,
];

/** 全部预设（含高级）。顺序确定：slot 顺序 → presetId 字典序。 */
export function listStrategyAuthoringPresets(): readonly StrategyAuthoringPreset[] {
  const slotOrder = new Map(STRATEGY_AUTHORING_SLOTS.map((slot, index) => [slot, index] as const));
  return [...ALL_PRESETS].sort((a, b) => {
    const sa = slotOrder.get(a.slot) ?? 99;
    const sb = slotOrder.get(b.slot) ?? 99;
    return sa !== sb ? sa - sb : a.presetId.localeCompare(b.presetId);
  });
}

/** 按 `(slot, presetId)` 查预设；不存在 ⇒ `null`（不抛错，由调用方决定错误码）。 */
export function findStrategyAuthoringPreset(slot: StrategyAuthoringSlot, presetId: string): StrategyAuthoringPreset | null {
  return ALL_PRESETS.find(p => p.slot === slot && p.presetId === presetId) ?? null;
}