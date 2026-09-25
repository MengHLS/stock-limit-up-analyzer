/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **Entry / Exit Engine**（通用基础之一）。
 *
 * ## 统一规则（唯一一处定义，所有因子共用）
 *
 * ```
 * Entry：T+6 开盘，条件 canBuyAtOpen === true        （不满足 ⇒ 该事件剔除）
 * Exit ：T+10 收盘，条件 canSellAtClose === true
 *        不可卖 ⇒ 从 T+11 起顺延到第一个可卖日的收盘，最多到 T+20（仍不可卖 ⇒ 剔除）
 * ```
 *
 * 🔴 **观察窗 `T+1..T+5` 不是买入窗口**：它只提供决策所需的信息。
 *    因此本引擎**只**接受 `rd = T+6` 的入场与 `rd ≥ T+10` 的退出，
 *    不存在「窗口内首次触及某价就买入」这种会用到当日收盘信息的写法。
 *
 * ## 与「公共底座」的关系（防漂移）
 *
 * 12F 的 `derive.ts` 里已有一份等价实现（它负责产出与 12F 逐位一致的净收益）。
 * 本引擎**独立再解一次**，然后由 `assertEntryExitAgreement` **逐笔对拍**：
 * 相对日必须相同、退出价必须相等（浮点容差 1e-9）。
 * 一旦两边不一致，Run 立刻失败 —— 这是「同一规则只有一套语义」的结构性保证，
 * 而不是靠注释约定。
 */

import type { ExperimentBarRow } from "@shared/researchExperimentsContracts";
import {
  ENTRY_DAY,
  EXIT_CANDIDATE_RELATIVE_DAYS,
  EXIT_RELATIVE_DAY,
  UNIFIED_ENTRY_POLICY,
  UNIFIED_EXIT_POLICY,
} from "./coordinate";
import type { PitEventAccess } from "./pitAccess";
import type { SingleFactorSample } from "./types";

const PRICE_EPSILON = 1e-9;

export type EntryExitFailureReason =
  | "ENTRY_UNFILLABLE"
  | "NO_EXECUTABLE_EXIT";

export type ExitReason = "TARGET_CLOSE" | "DEFERRED_CLOSE";

export interface ResolvedEntry {
  relativeDay: number;
  date: string;
  price: number;
}

export interface ResolvedExit {
  relativeDay: number;
  date: string;
  price: number;
  reason: ExitReason;
}

export type EntryExitResolution =
  | { ok: true; entry: ResolvedEntry; exit: ResolvedExit }
  | { ok: false; reason: EntryExitFailureReason };

function booleanAt(row: ExperimentBarRow | undefined, key: string): boolean {
  return row?.values[key] === true;
}

function numberAt(row: ExperimentBarRow | undefined, key: string): number | null {
  const value = row?.values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 信息截止日 = `T+5` 的真实交易日。因子、排名、信号都以此为时间锚。 */
export function resolveSignalDate(access: PitEventAccess): string | null {
  return access.tradeDateAt(ENTRY_DAY - 1);
}

/**
 * 统一入场：`T+6` 开盘，`canBuyAtOpen === true`。
 *
 * ⚠️ 不满足时**不顺延**：顺延会让「入场日」变成一个随行情变化的口径，
 * 使不同因子之间的入场分布不同（同一批事件在不同因子上落在不同日子），
 * 那就违背了「所有因子使用完全相同的入场规则」。
 */
export function resolveUnifiedEntry(access: PitEventAccess): ResolvedEntry | null {
  const row = access.executionBarAt(ENTRY_DAY);
  if (!booleanAt(row, "canBuyAtOpen")) return null;
  const price = numberAt(row, "open");
  const date = row?.tradeDate ?? null;
  if (price === null || price <= 0 || date === null || date === "") return null;
  return { relativeDay: ENTRY_DAY, date, price };
}

/** 统一退出：`T+10` 收盘，不可卖则顺延到其后第一个可卖日的收盘（≤ `T+20`）。 */
export function resolveUnifiedExit(access: PitEventAccess): ResolvedExit | null {
  for (const relativeDay of EXIT_CANDIDATE_RELATIVE_DAYS) {
    const row = access.executionBarAt(relativeDay);
    if (!booleanAt(row, "canSellAtClose")) continue;
    const price = numberAt(row, "close");
    const date = row?.tradeDate ?? null;
    if (price === null || price <= 0 || date === null || date === "") continue;
    return {
      relativeDay,
      date,
      price,
      reason: relativeDay === EXIT_RELATIVE_DAY ? "TARGET_CLOSE" : "DEFERRED_CLOSE",
    };
  }
  return null;
}

/** 入场 + 退出一次解完。 */
export function resolveEntryExit(access: PitEventAccess): EntryExitResolution {
  const entry = resolveUnifiedEntry(access);
  if (entry === null) return { ok: false, reason: "ENTRY_UNFILLABLE" };
  const exit = resolveUnifiedExit(access);
  if (exit === null) return { ok: false, reason: "NO_EXECUTABLE_EXIT" };
  return { ok: true, entry, exit };
}

/**
 * 逐笔对拍：本引擎的解与公共底座（`derive.ts`）产出的坐标必须一致。
 *
 * 比对项：
 * - 入场/退出**相对日**必须相同（退出顺延位置一致）；
 * - 入场/退出**价格**必须相等（容差 `1e-9`）；
 * - 日期必须由本引擎解析出来（公共底座不带日期字段，日期是模板新增的留档）。
 */
export function assertEntryExitAgreement(
  sample: SingleFactorSample,
  resolution: EntryExitResolution
): void {
  if (!resolution.ok) {
    throw new Error(
      `入场/退出对拍失败：事件 ${sample.eventId} 在公共底座里是可用样本，` +
        `但本引擎解出 ${resolution.reason}（两套语义已漂移）`
    );
  }
  const problems: string[] = [];
  if (resolution.entry.relativeDay !== sample.entryRelativeDay) {
    problems.push(
      `入场相对日 ${resolution.entry.relativeDay} ≠ ${sample.entryRelativeDay}`
    );
  }
  if (resolution.exit.relativeDay !== sample.exitRelativeDay) {
    problems.push(`退出相对日 ${resolution.exit.relativeDay} ≠ ${sample.exitRelativeDay}`);
  }
  if (Math.abs(resolution.entry.price - sample.entryPrice) > PRICE_EPSILON) {
    problems.push(`入场价 ${resolution.entry.price} ≠ ${sample.entryPrice}`);
  }
  if (Math.abs(resolution.exit.price - sample.exitPrice) > PRICE_EPSILON) {
    problems.push(`退出价 ${resolution.exit.price} ≠ ${sample.exitPrice}`);
  }
  if (resolution.entry.date !== sample.entryDate) {
    problems.push(`入场日 ${resolution.entry.date} ≠ ${sample.entryDate}`);
  }
  if (resolution.exit.date !== sample.exitDate) {
    problems.push(`退出日 ${resolution.exit.date} ≠ ${sample.exitDate}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `入场/退出对拍失败：事件 ${sample.eventId} —— ${problems.join("；")}。` +
        `统一规则只允许一套语义，请检查 coordinate.ts 与公共底座是否已被改动。`
    );
  }
}

/** 持有交易日数。 */
export function holdingDaysOf(entryRelativeDay: number, exitRelativeDay: number): number {
  return exitRelativeDay - entryRelativeDay + 1;
}

/** 人类可读的策略摘要（进结果元数据，便于事后审计口径）。 */
export function entryExitPolicySummary(): string {
  return (
    `Entry ${UNIFIED_ENTRY_POLICY.condition} @ T+${UNIFIED_ENTRY_POLICY.relativeDay} ` +
    `${UNIFIED_ENTRY_POLICY.priceField}；` +
    `Exit 主 ${UNIFIED_EXIT_POLICY.condition} @ T+${UNIFIED_EXIT_POLICY.primaryRelativeDay} ` +
    `${UNIFIED_EXIT_POLICY.priceField}，${UNIFIED_EXIT_POLICY.deferred}；` +
    `不可成交一律剔除（${UNIFIED_ENTRY_POLICY.onUnfilled} / ${UNIFIED_EXIT_POLICY.onUnfilled}）`
  );
}
