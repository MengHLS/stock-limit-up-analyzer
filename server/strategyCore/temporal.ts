/**
 * STRATEGY-ARCH-001 — 时间语义（规格 §6）。
 *
 * 提供两类能力，二者正交：
 *   ① **相对日代数**：`T` / `T-1` / `T+1` / `T+N` / `WINDOW(T+1,T+5)` 的表示与归约；
 *   ② **evaluation-time**：`evaluate(T)` 只能读 `informationAvailableAt(T)`。
 *
 * 🔴 PIT 铁律（本模块是唯一权威）：
 *   在相对日 `rd` 上做决策时，**只允许读 `≤ rd` 的 bar**。
 *   `rd` 之后的 bar 一律不可见 —— 即使 Dataset 里存在，也必须由 `createDayScopedBarAccess`
 *   拒绝并**记录违规**（不是静默返回 null）。
 *
 * 纯模块：无 DB / 无 IO / 无 Date.now / 无 Math.random。
 */

import {
  STRATEGY_CORE_SCHEMA_VERSION,
  StrategyCoreError,
  validationIssue,
  validationResult,
  type CoreValidationIssue,
  type CoreValidationResult,
  type EvaluationTime,
  type RelativeDay,
  type TemporalUnit,
} from "./types";

export const CORE_TEMPORAL_VERSION = STRATEGY_CORE_SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// 相对日代数
// ---------------------------------------------------------------------------

/** 事件日（T）。 */
export const T0: RelativeDay = 0;

/** 相对日 → 人类可读标签（`T` / `T+3` / `T-1`）。 */
export function offsetToLabel(offset: RelativeDay): string {
  if (offset === 0) return "T";
  return offset > 0 ? "T+" + String(offset) : "T-" + String(-offset);
}

/**
 * 标签 → 相对日。支持 `T` / `T+3` / `T-1` / `T0`（大小写不敏感，允许空白）。
 * 无法解析 ⇒ `null`（由调用方决定是拒绝还是当作未声明）。
 */
export function labelToOffset(label: string): RelativeDay | null {
  if (typeof label !== "string") return null;
  const raw = label.trim().toUpperCase().replace(/\s+/g, "");
  if (raw === "T" || raw === "T0" || raw === "T+0" || raw === "T-0") return 0;
  const plus = /^T\+(\d+)$/.exec(raw);
  if (plus !== null) return Number(plus[1]);
  const minus = /^T-(\d+)$/.exec(raw);
  if (minus !== null) return -Number(minus[1]);
  return null;
}

/** 观察窗口（起点 / 终点 / 单位；含两端）。 */
export interface TemporalWindow {
  readonly start: RelativeDay;
  readonly end: RelativeDay;
  readonly unit: TemporalUnit;
}

/** 构造窗口（**做形态校验**：start/end 必须整数、start ≤ end）。 */
export function makeTemporalWindow(
  start: RelativeDay,
  end: RelativeDay,
  unit: TemporalUnit = "TRADING_DAY",
): TemporalWindow {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new StrategyCoreError(
      "RULE_GRAPH_INVALID",
      "观察窗口的 start / end 必须是整数相对日（" + String(start) + " / " + String(end) + "）",
    );
  }
  if (start > end) {
    throw new StrategyCoreError(
      "RULE_GRAPH_INVALID",
      "观察窗口 start(" + String(start) + ") 不能晚于 end(" + String(end) + ")",
    );
  }
  return { start, end, unit };
}

/** 窗口内相对日序列（升序，含两端）。 */
export function windowOffsets(window: TemporalWindow): readonly RelativeDay[] {
  const out: RelativeDay[] = [];
  for (let offset = window.start; offset <= window.end; offset += 1) out.push(offset);
  return out;
}

/** 窗口是否包含某相对日。 */
export function windowContains(window: TemporalWindow, offset: RelativeDay): boolean {
  return offset >= window.start && offset <= window.end;
}

/** 窗口天数。 */
export function windowLength(window: TemporalWindow): number {
  return window.end - window.start + 1;
}

/** 规范化窗口（按单位排序键，供指纹稳定）。 */
export function normalizeTemporalWindow(window: TemporalWindow): TemporalWindow {
  return { start: window.start, end: window.end, unit: window.unit };
}

/** 两个窗口是否相等（规范化后）。 */
export function temporalWindowsEqual(left: TemporalWindow, right: TemporalWindow): boolean {
  return left.start === right.start && left.end === right.end && left.unit === right.unit;
}

// ---------------------------------------------------------------------------
// evaluation-time
// ---------------------------------------------------------------------------

const POINT_ORDER: Record<EvaluationTime["point"], number> = { open: 0, close: 1 };

/** 比较两个时点：-1 早于 / 0 相等 / 1 晚于（同日 open < close）。 */
export function compareEvaluationTime(left: EvaluationTime, right: EvaluationTime): -1 | 0 | 1 {
  if (left.date < right.date) return -1;
  if (left.date > right.date) return 1;
  const lp = POINT_ORDER[left.point];
  const rp = POINT_ORDER[right.point];
  if (lp < rp) return -1;
  if (lp > rp) return 1;
  return 0;
}

/** 规范化时点（形态校验）。 */
export function makeEvaluationTime(date: string, point: EvaluationTime["point"]): EvaluationTime {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new StrategyCoreError("CORE_DEFINITION_INVALID", "决策时点的日期必须是 YYYY-MM-DD，实际 " + String(date));
  }
  if (point !== "open" && point !== "close") {
    throw new StrategyCoreError("CORE_DEFINITION_INVALID", "决策时点的时点必须是 open | close，实际 " + String(point));
  }
  return { date, point };
}

/**
 * 某根 bar 在某时点是否可见（PIT 唯一判据）。
 *
 *   - bar 日期 < 时点日期 ⇒ 可见（完整 bar）；
 *   - bar 日期 = 时点日期 且 时点 = close ⇒ 可见（完整 bar）；
 *   - bar 日期 = 时点日期 且 时点 = open ⇒ **不可见**（当日完整 bar 尚不存在）；
 *   - bar 日期 > 时点日期 ⇒ 不可见。
 */
export function isBarVisibleAt(barDate: string, asOf: EvaluationTime): boolean {
  if (barDate > asOf.date) return false;
  if (barDate < asOf.date) return true;
  return asOf.point === "close";
}

// ---------------------------------------------------------------------------
// 日范围 bar 访问（唯一 PIT 关卡）
// ---------------------------------------------------------------------------

/** 一根对策略可见的 bar（只含策略需要的列；价格可为 null = 当日无数据）。 */
export interface VisibleBar {
  readonly date: string;
  /** 相对日（相对**事件日**；事件日为 0）。 */
  readonly relativeDay: RelativeDay;
  readonly open: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly close: number | null;
  readonly volume: number | null;
  readonly amount: number | null;
  /** 前收盘（派生列，可缺失）。 */
  readonly preClose?: number | null;
}

/** 违规记录（PIT 越界读取）。 */
export interface VisibilityViolation {
  readonly relativeDay: RelativeDay;
  readonly requestedAtDay: RelativeDay;
  readonly reason: "FUTURE_RELATIVE_DAY" | "RELATIVE_DAY_NOT_IN_SCOPE";
}

/** 日范围可见性访问器：在 `rd` 上决策时只允许读 `≤ rd` 的 bar。 */
export interface DayScopedBarAccess {
  readonly currentRelativeDay: RelativeDay;
  /** 读取相对日 `rd` 的 bar；越界 ⇒ 返回 null 并记录违规（**不静默**）。 */
  barAt(relativeDay: RelativeDay): VisibleBar | null;
  /** 当前 bar（= `barAt(currentRelativeDay)`）。 */
  currentBar(): VisibleBar | null;
  /** 事件日 bar（= `barAt(0)`；`currentRelativeDay < 0` 时为 null）。 */
  eventDayBar(): VisibleBar | null;
  /** 至多 `rd` 的可见 bar（升序，含 `rd`）—— 供特征计算使用（lookback 用）。 */
  barsUpTo(relativeDay: RelativeDay): readonly VisibleBar[];
  /** 已记录的违规（非空 ⇒ 本次决策发生过未来函数读取）。 */
  violations(): readonly VisibilityViolation[];
}

/** 输入 bar 集：**全量**（含未来），可见性由访问器负责收窄。 */
export interface BarUniverse {
  /** 必须按 `relativeDay` 升序，且**唯一**。 */
  readonly bars: readonly VisibleBar[];
  /** 本次评估允许的最远相对日（缺省不限；用于把评估限制在声明视界内）。 */
  readonly maxRelativeDay?: RelativeDay;
}

/**
 * 创建日范围可见性访问器（**PIT 的唯一关卡**）。
 *
 * 与 legacy 的差别（这是本次改造的核心之一）：
 *   - legacy：`visibleBars` 按 `DecisionTime` 过滤，但**字段引用层没有关卡**，
 *     且配方特征的 availability 被恒置为远古日期 ⇒ `LeakageGuard` 恒通过；
 *   - core：**在访问点**把「读 `rd` 的 bar」与「当前决策在 `rd`」比较，
 *     越界即记录违规，由 Runtime 在产出决策前**响亮抛错**。
 */
export function createDayScopedBarAccess(
  universe: BarUniverse,
  currentRelativeDay: RelativeDay,
): DayScopedBarAccess {
  const sorted = universe.bars;
  const byDay = new Map<RelativeDay, VisibleBar>();
  for (const bar of sorted) {
    if (byDay.has(bar.relativeDay)) {
      throw new StrategyCoreError(
        "CORE_DEFINITION_INVALID",
        "BarUniverse 内相对日重复：" + String(bar.relativeDay),
      );
    }
    byDay.set(bar.relativeDay, bar);
  }
  const violations: VisibilityViolation[] = [];
  const upperBound =
    universe.maxRelativeDay === undefined ? currentRelativeDay : Math.min(universe.maxRelativeDay, currentRelativeDay);

  const barAt = (relativeDay: RelativeDay): VisibleBar | null => {
    if (relativeDay > currentRelativeDay) {
      violations.push({
        relativeDay,
        requestedAtDay: currentRelativeDay,
        reason: "FUTURE_RELATIVE_DAY",
      });
      return null;
    }
    if (universe.maxRelativeDay !== undefined && relativeDay > universe.maxRelativeDay) {
      violations.push({
        relativeDay,
        requestedAtDay: currentRelativeDay,
        reason: "RELATIVE_DAY_NOT_IN_SCOPE",
      });
      return null;
    }
    return byDay.get(relativeDay) ?? null;
  };

  const barsUpTo = (relativeDay: RelativeDay): readonly VisibleBar[] => {
    const limit = Math.min(relativeDay, currentRelativeDay);
    if (relativeDay > currentRelativeDay) {
      violations.push({
        relativeDay,
        requestedAtDay: currentRelativeDay,
        reason: "FUTURE_RELATIVE_DAY",
      });
    }
    const out: VisibleBar[] = [];
    for (const bar of sorted) {
      if (bar.relativeDay <= limit) out.push(bar);
    }
    return out;
  };

  return {
    currentRelativeDay,
    barAt,
    currentBar: () => barAt(currentRelativeDay),
    eventDayBar: () => barAt(0),
    barsUpTo,
    violations: () => violations.slice(),
  };
}

/** 相对日上限（供特征 lookback 校验）。 */
export function assertRelativeDayInScope(relativeDay: RelativeDay, maxRelativeDay: RelativeDay): void {
  if (relativeDay > maxRelativeDay) {
    throw new StrategyCoreError(
      "FEATURE_LOOKBACK_INSUFFICIENT",
      "相对日 " + offsetToLabel(relativeDay) + " 超出本次评估视界 " + offsetToLabel(maxRelativeDay),
    );
  }
}

/** 校验窗口形态（供 RuleGraph 校验器使用）。 */
export function validateTemporalWindow(window: TemporalWindow, path: string): readonly CoreValidationIssue[] {
  const issues: CoreValidationIssue[] = [];
  if (!Number.isInteger(window.start) || !Number.isInteger(window.end)) {
    issues.push(validationIssue("RULE_GRAPH_INVALID", path, "窗口 start / end 必须是整数"));
  }
  if (window.start > window.end) {
    issues.push(validationIssue("RULE_GRAPH_INVALID", path, "窗口 start 不能晚于 end"));
  }
  if (window.unit !== "TRADING_DAY" && window.unit !== "CALENDAR_DAY") {
    issues.push(validationIssue("RULE_GRAPH_INVALID", path, "窗口单位非法：" + String(window.unit)));
  }
  return issues;
}

/** 校验时间单位已知。 */
export function validateTemporalUnit(unit: string, path: string): CoreValidationResult {
  if (unit !== "TRADING_DAY" && unit !== "CALENDAR_DAY") {
    return validationResult([validationIssue("RULE_GRAPH_INVALID", path, "时间单位非法：" + unit)]);
  }
  return validationResult([]);
}
