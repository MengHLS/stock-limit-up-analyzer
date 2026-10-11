/**
 * `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` —— 收益标签（规格 §5.1）。
 *
 * ## 标签口径（冻结）
 *
 * - **标签 A（主）**：假设**下一交易日开盘**入场，持有 **20 个交易日**的价格净收益。
 *   主退出不可卖时按**既有顺延原语**顺延到其后首个可卖价，**最多再 10 个交易日**；
 *   超过上限仍不可卖 ⇒ 用上限日收盘 **MTM** 并标 `UNEXITED_MTM`（不丢样本、不伪造成交）。
 * - **标签 B（辅助）**：未来 20 日内**最高价**相对入场价的涨幅（+20% 路径机会率与提前量）。
 *   🔴 **不是可实现收益**，不得用最高价模拟卖出。
 *
 * ## 复用了什么（不复制第二套实现）
 *
 * - 顺延出场规则：`../firstBoardPullback/panel.ts#findExecutableExit`
 *   （缺省上界 20，既有调用方不变；本模块显式传 `targetExit + 10` 的上界）；
 * - 成本：`../firstBoardPullback/cost.ts#netReturn`（**唯一**成本出口）；
 * - bar 结构有效性：`../firstBoardPullback/dataset.ts#foundationBarStructurallyValid`；
 * - 持有期口径：`holding_day = exitDay − entryDay + 1`（与公共底座逐字一致）。
 */

import { netReturn } from "../firstBoardPullback/cost";
import { foundationBarStructurallyValid } from "../firstBoardPullback/dataset";
import { findExecutableExit } from "../firstBoardPullback/panel";
import type {
  FoundationCostConfig,
  NormalizedFoundationBar,
} from "../firstBoardPullback/types";
import {
  COST_PRIMARY_ROUND_TRIP_BPS,
  COST_SENSITIVITY_ROUND_TRIP_BPS,
  EXIT_DEFERRAL_MAX_TRADING_DAYS,
  HOLDING_DAYS,
  MAX_POST_RELATIVE_DAY_NEEDED,
  PRIMARY_TAIL_THRESHOLD,
  type ArmId,
  type OpportunitySegment,
  type SignalLabelCode,
} from "./types";
import type { PoolBar, PoolEvent } from "./projection";

/**
 * 固定往返 bps → 既有成本原语入参。
 *
 * `netReturn(entry, exit, cost) = sellAdj(exit) / buyAdj(entry) − 1`，其中
 * `buyAdj = p·(1 + (c+s+i)/1e4)`、`sellAdj = p·(1 − (c+s+i+stamp)/1e4)`。
 * 令 `c=s=i=0`、`stampDuty=bps` 时该式**精确**等于 `(exit/entry)·(1 − bps/1e4) − 1`
 * ⇒ 往返成本恰为 `bps`。
 *
 * 🔴 这是**研究标签成本口径**，不是真实账户费率/冲击模型（规格 §3）。
 */
export function costConfigForRoundTripBps(bps: number): FoundationCostConfig {
  return {
    commissionBpsPerSide: 0,
    slippageBpsPerSide: 0,
    impactBpsPerSide: 0,
    stampDutyBps: bps,
  };
}

export const PRIMARY_COST = costConfigForRoundTripBps(COST_PRIMARY_ROUND_TRIP_BPS);
export const SENSITIVITY_COST = costConfigForRoundTripBps(COST_SENSITIVITY_ROUND_TRIP_BPS);

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** `PoolBar` → 既有顺延原语需要的 `NormalizedFoundationBar`（结构有效性走唯一判据）。 */
function toFoundationBar(bar: PoolBar): NormalizedFoundationBar {
  return {
    relativeDay: bar.relativeDay,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    preClose: bar.preClose,
    limitUpPrice: bar.limitUpPrice,
    limitDownPrice: bar.limitDownPrice,
    barPresent: bar.barPresent,
    suspended: bar.suspended,
    canBuyAtOpen: bar.canBuyAtOpen,
    canSellAtClose: bar.canSellAtClose,
    structurallyValid: foundationBarStructurallyValid(bar),
  };
}

export interface RawSignalLabel {
  readonly labelCode: SignalLabelCode;
  readonly entryDate: string | null;
  readonly entryRelativeDay: number | null;
  readonly entryOpen: number | null;
  readonly exitDate: string | null;
  readonly exitRelativeDay: number | null;
  readonly exitPrice: number | null;
  readonly deferredTradingDays: number | null;
  readonly grossReturn: number | null;
  readonly pathMaxReturn: number | null;
  /** 标签 B 达到 +20% 的**提前量**（交易日，1-based，从入场日起算）；未达到 = null。 */
  readonly pathPlus20TradingDay: number | null;
}

/**
 * 逐信号算标签 A / B。
 *
 * `age` = 决策日的事件年龄；入场 = `rd (age+1)` 开盘。
 * 全程只用该事件自己的 rd 轴（`rd → tradeDate` 由数据集给出）⇒ 停牌缺口不会被抹平。
 */
export function deriveSignalLabel(event: PoolEvent, age: number): RawSignalLabel {
  const entryRelativeDay = age + 1;
  const entryBar = event.post.get(entryRelativeDay);
  if (entryBar === undefined) {
    return emptyLabel("MISSING_NEXT_BAR");
  }
  const entryOpen = entryBar.open;
  const notFillable =
    !entryBar.barPresent ||
    entryBar.suspended ||
    entryBar.canBuyAtOpen !== true ||
    !finitePositive(entryOpen);
  if (notFillable) {
    return {
      ...emptyLabel("NO_FILL"),
      entryDate: entryBar.tradeDate,
      entryRelativeDay,
      entryOpen: finitePositive(entryOpen) ? entryOpen : null,
    };
  }

  const normalized = new Map<number, NormalizedFoundationBar>();
  for (const [rd, bar] of event.post) normalized.set(rd, toFoundationBar(bar));

  const targetExitRelativeDay = entryRelativeDay + (HOLDING_DAYS - 1);
  const capRelativeDay = Math.min(
    targetExitRelativeDay + EXIT_DEFERRAL_MAX_TRADING_DAYS,
    MAX_POST_RELATIVE_DAY_NEEDED,
  );
  const executable = findExecutableExit(normalized, targetExitRelativeDay, capRelativeDay);

  const path = derivePathLabel(event, entryRelativeDay, entryOpen);

  if (executable === null) {
    const capBar = event.post.get(capRelativeDay);
    if (capBar !== undefined && capBar.barPresent && !capBar.suspended && finitePositive(capBar.close)) {
      const gross = capBar.close / entryOpen - 1;
      return {
        labelCode: "UNEXITED_MTM",
        entryDate: entryBar.tradeDate,
        entryRelativeDay,
        entryOpen,
        exitDate: capBar.tradeDate,
        exitRelativeDay: capRelativeDay,
        exitPrice: capBar.close,
        deferredTradingDays: capRelativeDay - targetExitRelativeDay,
        grossReturn: gross,
        ...path,
      };
    }
    return {
      labelCode: "RIGHT_CENSORED",
      entryDate: entryBar.tradeDate,
      entryRelativeDay,
      entryOpen,
      exitDate: null,
      exitRelativeDay: null,
      exitPrice: null,
      deferredTradingDays: null,
      grossReturn: null,
      ...path,
    };
  }

  const exitBar = event.post.get(executable.day);
  return {
    labelCode: "EXECUTABLE",
    entryDate: entryBar.tradeDate,
    entryRelativeDay,
    entryOpen,
    exitDate: exitBar?.tradeDate ?? null,
    exitRelativeDay: executable.day,
    exitPrice: executable.price,
    deferredTradingDays: executable.day - targetExitRelativeDay,
    grossReturn: executable.price / entryOpen - 1,
    ...path,
  };
}

function emptyLabel(
  code: SignalLabelCode,
): Omit<RawSignalLabel, "pathMaxReturn" | "pathPlus20TradingDay"> & {
  pathMaxReturn: null;
  pathPlus20TradingDay: null;
} {
  return {
    labelCode: code,
    entryDate: null,
    entryRelativeDay: null,
    entryOpen: null,
    exitDate: null,
    exitRelativeDay: null,
    exitPrice: null,
    deferredTradingDays: null,
    grossReturn: null,
    pathMaxReturn: null,
    pathPlus20TradingDay: null,
  };
}

/** 标签 B：未来 `HOLDING_DAYS` 日最高价 / 入场价 − 1，以及达到 +20% 的提前量。 */
function derivePathLabel(
  event: PoolEvent,
  entryRelativeDay: number,
  entryOpen: number,
): { pathMaxReturn: number | null; pathPlus20TradingDay: number | null } {
  let maxHigh = entryOpen;
  let plus20: number | null = null;
  for (let offset = 0; offset < HOLDING_DAYS; offset += 1) {
    const bar = event.post.get(entryRelativeDay + offset);
    if (bar === undefined || !bar.barPresent || bar.suspended || !finitePositive(bar.high)) {
      return { pathMaxReturn: null, pathPlus20TradingDay: null };
    }
    if (bar.high > maxHigh) maxHigh = bar.high;
    if (plus20 === null && bar.high / entryOpen - 1 >= PRIMARY_TAIL_THRESHOLD - 1e-12) {
      plus20 = offset + 1;
    }
  }
  return { pathMaxReturn: maxHigh / entryOpen - 1, pathPlus20TradingDay: plus20 };
}

/** 净收益（两个成本档一次算完；`null` = 未成交 / 右删失）。 */
export function netReturnsOf(label: RawSignalLabel): {
  net20bps: number | null;
  net50bps: number | null;
} {
  if (
    label.entryOpen === null ||
    label.exitPrice === null ||
    label.entryOpen <= 0 ||
    label.exitPrice <= 0
  ) {
    return { net20bps: null, net50bps: null };
  }
  return {
    net20bps: netReturn(label.entryOpen, label.exitPrice, PRIMARY_COST),
    net50bps: netReturn(label.entryOpen, label.exitPrice, SENSITIVITY_COST),
  };
}

/** 决策槽位效用：`NO_FILL` 记现金 0（明确是槽位效用，**不伪造成交**）。 */
export function slotReturnOf(label: RawSignalLabel, net: number | null): number | null {
  if (label.labelCode === "NO_FILL") return 0;
  return net;
}

// ---------------------------------------------------------------------------
// 唯一机会段（离线合并；**不作实时入池规则**）
// ---------------------------------------------------------------------------

export interface SegmentSignalInput {
  readonly symbol: string;
  readonly date: string;
  readonly arm: ArmId;
  /** 标签窗（实际或计划的 [入场日, 出场日]；缺失 ⇒ 该信号不参与合并）。 */
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly tail20Hit: boolean;
}

/**
 * 合并同 symbol 的相邻信号标签窗：**共享交易日**即同一机会段。
 *
 * 🔴 离线口径：段边界用了未来信息，**不得**用于实时选择；段数**不是**独立样本数。
 */
export function buildOpportunitySegments(
  inputs: readonly SegmentSignalInput[],
  arm: ArmId,
): readonly OpportunitySegment[] {
  const bySymbol = new Map<string, SegmentSignalInput[]>();
  for (const input of inputs) {
    if (input.arm !== arm) continue;
    if (input.windowStart === null || input.windowEnd === null) continue;
    const list = bySymbol.get(input.symbol) ?? [];
    list.push(input);
    bySymbol.set(input.symbol, list);
  }
  const out: OpportunitySegment[] = [];
  for (const symbol of [...bySymbol.keys()].sort()) {
    const items = [...bySymbol.get(symbol)!].sort(
      (left, right) =>
        left.windowStart!.localeCompare(right.windowStart!) ||
        left.date.localeCompare(right.date),
    );
    let current: {
      start: string;
      end: string;
      dates: string[];
      tail20Hit: boolean;
    } | null = null;
    for (const item of items) {
      if (current === null) {
        current = {
          start: item.windowStart!,
          end: item.windowEnd!,
          dates: [item.date],
          tail20Hit: item.tail20Hit,
        };
        continue;
      }
      // 「共享交易日」⇔ 下一个窗的起点 ≤ 当前窗的终点。
      if (item.windowStart! <= current.end) {
        if (item.windowEnd! > current.end) current.end = item.windowEnd!;
        current.dates.push(item.date);
        current.tail20Hit = current.tail20Hit || item.tail20Hit;
        continue;
      }
      out.push(finishSegment(symbol, current, arm));
      current = {
        start: item.windowStart!,
        end: item.windowEnd!,
        dates: [item.date],
        tail20Hit: item.tail20Hit,
      };
    }
    if (current !== null) out.push(finishSegment(symbol, current, arm));
  }
  return out.sort(
    (left, right) =>
      left.symbol.localeCompare(right.symbol) || left.startDate.localeCompare(right.startDate),
  );
}

function finishSegment(
  symbol: string,
  current: { start: string; end: string; dates: string[]; tail20Hit: boolean },
  arm: ArmId,
): OpportunitySegment {
  const dates = [...current.dates].sort();
  return {
    symbol,
    startDate: current.start,
    endDate: current.end,
    signalDates: dates,
    arms: [arm],
    tail20Hit: current.tail20Hit,
    firstSignalDate: dates[0]!,
  };
}
