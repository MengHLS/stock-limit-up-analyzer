import { netReturn } from "./cost";
import {
  FIRST_BOARD_PULLBACK_EPSILON,
  FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY,
  type FirstBoardEntryMode,
  type FoundationPanelExitReason,
  type FoundationPanelRow,
  type FoundationCostConfig,
  type NormalizedFoundationBar,
  type NormalizedFoundationEvent,
} from "./types";

type CostConfig = FoundationCostConfig;

function isUsable(bar: NormalizedFoundationBar | undefined): bar is NormalizedFoundationBar {
  return (
    bar !== undefined &&
    bar.barPresent &&
    !bar.suspended &&
    bar.structurallyValid
  );
}

function firstReachHoldingDay(
  bars: readonly NormalizedFoundationBar[],
  entryOpen: number,
  threshold: number
): number | null {
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index]!;
    const mark = bar.close! / entryOpen - 1;
    if (
      (threshold < 0 &&
        mark <= threshold + FIRST_BOARD_PULLBACK_EPSILON) ||
      (threshold > 0 &&
        mark >= threshold - FIRST_BOARD_PULLBACK_EPSILON)
    ) {
      return index + 1;
    }
  }
  return null;
}

function cumulativePathMetrics(
  bars: readonly NormalizedFoundationBar[],
  entryOpen: number
): {
  mfe: number;
  mae: number;
  peakHoldingDay: number;
  troughHoldingDay: number;
  firstPlus2: number | null;
  firstMinus2: number | null;
  firstPlus5: number | null;
  firstMinus5: number | null;
} {
  let maxHigh = entryOpen;
  let minLow = entryOpen;
  let peakHoldingDay = 1;
  let troughHoldingDay = 1;
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index]!;
    if (bar.high! > maxHigh) {
      maxHigh = bar.high!;
      peakHoldingDay = index + 1;
    }
    if (bar.low! < minLow) {
      minLow = bar.low!;
      troughHoldingDay = index + 1;
    }
  }
  return {
    mfe: maxHigh / entryOpen - 1,
    mae: minLow / entryOpen - 1,
    peakHoldingDay,
    troughHoldingDay,
    firstPlus2: firstReachHoldingDay(bars, entryOpen, 0.02),
    firstMinus2: firstReachHoldingDay(bars, entryOpen, -0.02),
    firstPlus5: firstReachHoldingDay(bars, entryOpen, 0.05),
    firstMinus5: firstReachHoldingDay(bars, entryOpen, -0.05),
  };
}

function pathClassV1(
  exitReturn: number,
  mfe: number,
  mae: number
): string {
  if (
    exitReturn > 0 &&
    mfe >= 0.02 - FIRST_BOARD_PULLBACK_EPSILON &&
    mae > -0.02 - FIRST_BOARD_PULLBACK_EPSILON
  ) {
    return "UP_SMOOTH";
  }
  if (
    exitReturn > 0 &&
    mfe >= 0.02 - FIRST_BOARD_PULLBACK_EPSILON &&
    mae <= -0.02 + FIRST_BOARD_PULLBACK_EPSILON
  ) {
    return "UP_RECOVERY";
  }
  if (
    exitReturn > 0 &&
    mfe < 0.02 - FIRST_BOARD_PULLBACK_EPSILON &&
    mae <= -0.02 + FIRST_BOARD_PULLBACK_EPSILON
  ) {
    return "WEAK_RECOVERY";
  }
  if (
    exitReturn <= 0 &&
    mfe >= 0.02 - FIRST_BOARD_PULLBACK_EPSILON
  ) {
    return "FADE";
  }
  if (
    exitReturn <= 0 &&
    mfe < 0.02 - FIRST_BOARD_PULLBACK_EPSILON &&
    mae <= -0.02 + FIRST_BOARD_PULLBACK_EPSILON
  ) {
    return "WEAK";
  }
  return "FLAT";
}

export function resolveEntryDay(
  event: NormalizedFoundationEvent,
  entryMode: FirstBoardEntryMode,
  pullbackTriggerBps: number
): number | null {
  if (entryMode.startsWith("FIXED_T")) {
    const day = Number(entryMode.slice("FIXED_T".length, -"_OPEN".length));
    return Number.isInteger(day) && day > 0 ? day : null;
  }
  for (let day = 1; day <= 5; day += 1) {
    const bar = event.barsByRelativeDay.get(day);
    if (!isUsable(bar)) return null;
    if (bar.close! < event.open - FIRST_BOARD_PULLBACK_EPSILON) {
      return null;
    }
    if (
      bar.close! <=
      event.close * (1 - pullbackTriggerBps / 10_000) +
        FIRST_BOARD_PULLBACK_EPSILON
    ) {
      return day + 1 <= 6 ? day + 1 : null;
    }
  }
  return null;
}

function findExecutableExit(
  barsByRelativeDay: ReadonlyMap<number, NormalizedFoundationBar>,
  targetDay: number
): {
  day: number;
  price: number;
  reason: FoundationPanelExitReason;
} | null {
  const target = barsByRelativeDay.get(targetDay);
  if (isUsable(target) && target.canSellAtClose === true) {
    return { day: targetDay, price: target.close!, reason: "TARGET_CLOSE" };
  }
  for (
    let day = targetDay + 1;
    day <= FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY;
    day += 1
  ) {
    const bar = barsByRelativeDay.get(day);
    if (!isUsable(bar)) continue;
    if (
      bar.open !== null &&
      bar.limitDownPrice !== null &&
      bar.open > bar.limitDownPrice + FIRST_BOARD_PULLBACK_EPSILON
    ) {
      return {
        day,
        price: bar.open,
        reason: "NEXT_SELLABLE_OPEN",
      };
    }
    if (bar.canSellAtClose === true) {
      return {
        day,
        price: bar.close!,
        reason: "NEXT_SELLABLE_CLOSE",
      };
    }
  }
  return null;
}

export interface FoundationPanelBuildResult {
  rows: readonly FoundationPanelRow[];
  entryUnavailable: boolean;
  fullSample: boolean;
  commonSample: boolean;
  rightCensored: boolean;
  missingPath: boolean;
  suspended: boolean;
  unfillableExit: boolean;
}

export function buildPanelRowsForEvent(
  event: NormalizedFoundationEvent,
  entryMode: FirstBoardEntryMode,
  cost: CostConfig,
  options: {
    pullbackTriggerBps?: number;
  } = {}
): FoundationPanelBuildResult {
  const entryDay = resolveEntryDay(
    event,
    entryMode,
    options.pullbackTriggerBps ?? 100
  );
  if (entryDay === null) {
    return {
      rows: [],
      entryUnavailable: true,
      fullSample: false,
      commonSample: false,
      rightCensored: false,
      missingPath: false,
      suspended: false,
      unfillableExit: false,
    };
  }
  const entryBar = event.barsByRelativeDay.get(entryDay);
  if (
    !isUsable(entryBar) ||
    entryBar.canBuyAtOpen !== true ||
    entryBar.open === null
  ) {
    return {
      rows: [],
      entryUnavailable: true,
      fullSample: false,
      commonSample: false,
      rightCensored: false,
      missingPath: false,
      suspended: false,
      unfillableExit: false,
    };
  }

  let missingPath = false;
  let suspended = false;
  let fieldsComplete = true;
  for (
    let day = 1;
    day <= FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY;
    day += 1
  ) {
    const bar = event.barsByRelativeDay.get(day);
    if (bar === undefined || !bar.barPresent || !bar.structurallyValid) {
      missingPath = true;
      continue;
    }
    if (bar.suspended) suspended = true;
    if (bar.canBuyAtOpen === null || bar.canSellAtClose === null) {
      fieldsComplete = false;
    }
  }
  const finalExit = findExecutableExit(
    event.barsByRelativeDay,
    FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY
  );
  const commonSample =
    fieldsComplete && !missingPath && !suspended && finalExit !== null;

  const rows: FoundationPanelRow[] = [];
  let unfillableExit = false;
  for (
    let exitDay = entryDay;
    exitDay <= FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY;
    exitDay += 1
  ) {
    const targetBar = event.barsByRelativeDay.get(exitDay);
    const targetUsable = isUsable(targetBar);
    const executable = findExecutableExit(event.barsByRelativeDay, exitDay);
    if (executable === null) unfillableExit = true;
    const heldBars: NormalizedFoundationBar[] = [];
    let heldPathUsable = true;
    for (let day = entryDay; day <= exitDay; day += 1) {
      const bar = event.barsByRelativeDay.get(day);
      if (!isUsable(bar)) {
        heldPathUsable = false;
        break;
      }
      heldBars.push(bar);
    }
    const pathMetrics = heldPathUsable
      ? cumulativePathMetrics(heldBars, entryBar.open)
      : null;
    const exitReturn = executable
      ? executable.price / entryBar.open - 1
      : null;
    rows.push({
      event_id: event.eventId,
      event_date: event.eventDate,
      year: event.year,
      symbol: event.symbol,
      entry_mode: entryMode,
      entry_day: entryDay,
      exit_day: exitDay,
      holding_day: exitDay - entryDay + 1,
      gross_return: exitReturn,
      net_return: executable
        ? netReturn(entryBar.open, executable.price, cost)
        : null,
      ideal_gross_return: targetUsable
        ? targetBar.close! / entryBar.open - 1
        : null,
      ideal_net_return: targetUsable
        ? netReturn(entryBar.open, targetBar.close!, cost)
        : null,
      can_buy: true,
      can_sell: executable !== null,
      exit_reason: executable?.reason ?? "RIGHT_CENSORED",
      execution_delay_days:
        executable === null ? null : executable.day - exitDay,
      right_censored: executable === null,
      common_sample_flag: commonSample,
      missing_bar:
        targetBar === undefined ||
        !targetBar.barPresent ||
        !targetBar.structurallyValid,
      suspended: targetBar?.suspended ?? false,
      mfe: pathMetrics?.mfe ?? null,
      mae: pathMetrics?.mae ?? null,
      peak_holding_day: pathMetrics?.peakHoldingDay ?? null,
      trough_holding_day: pathMetrics?.troughHoldingDay ?? null,
      first_plus_2_holding_day: pathMetrics?.firstPlus2 ?? null,
      first_minus_2_holding_day: pathMetrics?.firstMinus2 ?? null,
      first_plus_5_holding_day: pathMetrics?.firstPlus5 ?? null,
      first_minus_5_holding_day: pathMetrics?.firstMinus5 ?? null,
      path_class_v1:
        commonSample && pathMetrics !== null && exitReturn !== null
          ? pathClassV1(exitReturn, pathMetrics.mfe, pathMetrics.mae)
          : null,
    });
  }

  return {
    rows,
    entryUnavailable: false,
    fullSample: !missingPath && !suspended && fieldsComplete,
    commonSample,
    rightCensored: unfillableExit,
    missingPath,
    suspended,
    unfillableExit,
  };
}
