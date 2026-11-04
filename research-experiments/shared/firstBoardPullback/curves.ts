import { movingBlockBootstrapMean } from "../dateClusterBootstrap";
import {
  FOUNDATION_ANCHOR_HOLDING_DAYS,
  FOUNDATION_BOOTSTRAP_BLOCK_DAYS,
  FOUNDATION_BOOTSTRAP_ITERATIONS,
  FOUNDATION_BOOTSTRAP_SEED,
  FOUNDATION_SAMPLE_SETS,
  type FirstBoardEntryMode,
  type FoundationBootstrapRow,
  type FoundationCurveRow,
  type FoundationGroup,
  type FoundationPanelRow,
  type FoundationSampleSet,
} from "./types";

function round(value: number, digits = 10): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function trimmedMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const remove = Math.ceil(sorted.length * 0.05);
  const kept = remove >= sorted.length ? [] : sorted.slice(0, sorted.length - remove);
  return mean(kept);
}

interface CurveBucket {
  net: number[];
  idealNet: number[];
  executionShortfall: number[];
  relativeDays: number[];
  mfe: number[];
  mae: number[];
  peakDays: number[];
  troughDays: number[];
  reachPlus2: number;
  reachMinus2: number;
  reachPlus5: number;
  reachMinus5: number;
  eventDates: Set<string>;
}

interface BootstrapBucket {
  eventDates: string[];
  values: number[];
}

function keyOf(args: {
  groupCode: string;
  entryMode: FirstBoardEntryMode;
  sampleSet: FoundationSampleSet;
  holdingDay: number;
}): string {
  return [
    args.groupCode,
    args.entryMode,
    args.sampleSet,
    args.holdingDay,
  ].join("|");
}

export class FoundationCurveAccumulator {
  private readonly curve = new Map<string, CurveBucket>();
  private readonly bootstrap = new Map<string, BootstrapBucket>();
  private readonly groups = new Map<string, string>();

  constructor(private readonly bootstrapIterations = FOUNDATION_BOOTSTRAP_ITERATIONS) {}

  registerGroups(groups: readonly FoundationGroup[]): void {
    for (const group of groups) this.groups.set(group.code, group.label);
  }

  addRows(
    rows: readonly FoundationPanelRow[],
    groups: readonly FoundationGroup[]
  ): void {
    this.registerGroups(groups);
    for (const row of rows) {
      const sets: FoundationSampleSet[] = ["FULL"];
      if (row.common_sample_flag) sets.push("COMMON");
      for (const group of groups) {
        for (const sampleSet of sets) {
          const key = keyOf({
            groupCode: group.code,
            entryMode: row.entry_mode,
            sampleSet,
            holdingDay: row.holding_day,
          });
          const bucket = this.curve.get(key) ?? {
            net: [],
            idealNet: [],
            executionShortfall: [],
            relativeDays: [],
            mfe: [],
            mae: [],
            peakDays: [],
            troughDays: [],
            reachPlus2: 0,
            reachMinus2: 0,
            reachPlus5: 0,
            reachMinus5: 0,
            eventDates: new Set<string>(),
          };
          bucket.eventDates.add(row.event_date);
          bucket.relativeDays.push(row.entry_day + row.holding_day - 1);
          if (row.net_return !== null) bucket.net.push(row.net_return);
          if (row.ideal_net_return !== null) {
            bucket.idealNet.push(row.ideal_net_return);
          }
          if (
            row.net_return !== null &&
            row.ideal_net_return !== null
          ) {
            bucket.executionShortfall.push(
              row.net_return - row.ideal_net_return
            );
          }
          if (row.mfe !== null) bucket.mfe.push(row.mfe);
          if (row.mae !== null) bucket.mae.push(row.mae);
          if (row.peak_holding_day !== null) {
            bucket.peakDays.push(row.peak_holding_day);
          }
          if (row.trough_holding_day !== null) {
            bucket.troughDays.push(row.trough_holding_day);
          }
          if (row.first_plus_2_holding_day !== null) bucket.reachPlus2 += 1;
          if (row.first_minus_2_holding_day !== null) bucket.reachMinus2 += 1;
          if (row.first_plus_5_holding_day !== null) bucket.reachPlus5 += 1;
          if (row.first_minus_5_holding_day !== null) bucket.reachMinus5 += 1;
          this.curve.set(key, bucket);

          if (
            row.net_return !== null &&
            (FOUNDATION_ANCHOR_HOLDING_DAYS as readonly number[]).includes(
              row.holding_day
            )
          ) {
            const bootstrapKey = key;
            const bootstrapBucket = this.bootstrap.get(bootstrapKey) ?? {
              eventDates: [],
              values: [],
            };
            bootstrapBucket.eventDates.push(row.event_date);
            bootstrapBucket.values.push(row.net_return);
            this.bootstrap.set(bootstrapKey, bootstrapBucket);
          }
        }
      }
    }
  }

  finalize(): {
    curveRows: FoundationCurveRow[];
    bootstrapRows: FoundationBootstrapRow[];
  } {
    const curveRows: FoundationCurveRow[] = [];
    for (const [key, bucket] of this.curve) {
      const [groupCode, entryMode, sampleSet, holdingDayText] = key.split("|");
      const holdingDay = Number(holdingDayText);
      const sortedNet = [...bucket.net].sort((a, b) => a - b);
      const sortedMfe = [...bucket.mfe].sort((a, b) => a - b);
      const sortedMae = [...bucket.mae].sort((a, b) => a - b);
      const sortedPeak = [...bucket.peakDays].sort((a, b) => a - b);
      const sortedTrough = [...bucket.troughDays].sort((a, b) => a - b);
      const sortedRelativeDays = [...bucket.relativeDays].sort((a, b) => a - b);
      const sampleCount = bucket.net.length;
      curveRows.push({
        group_code: groupCode!,
        group_label: this.groups.get(groupCode!) ?? groupCode!,
        entry_mode: entryMode as FirstBoardEntryMode,
        sample_set: sampleSet as FoundationSampleSet,
        holding_day: holdingDay,
        relative_day: quantile(sortedRelativeDays, 0.5) ?? holdingDay,
        sample_count: sampleCount,
        event_date_count: bucket.eventDates.size,
        mean_net_return: mean(bucket.net),
        mean_ideal_net_return: mean(bucket.idealNet),
        mean_execution_shortfall: mean(bucket.executionShortfall),
        trimmed_mean_net_return: trimmedMean(bucket.net),
        median_net_return: quantile(sortedNet, 0.5),
        win_rate_net:
          sampleCount === 0
            ? null
            : bucket.net.filter(value => value > 0).length / sampleCount,
        p5_net_return: quantile(sortedNet, 0.05),
        p25_net_return: quantile(sortedNet, 0.25),
        p75_net_return: quantile(sortedNet, 0.75),
        p95_net_return: quantile(sortedNet, 0.95),
        mean_mfe: mean(bucket.mfe),
        median_mfe: quantile(sortedMfe, 0.5),
        mean_mae: mean(bucket.mae),
        median_mae: quantile(sortedMae, 0.5),
        median_peak_holding_day: quantile(sortedPeak, 0.5),
        median_trough_holding_day: quantile(sortedTrough, 0.5),
        reach_plus_2_rate:
          sampleCount === 0 ? null : bucket.reachPlus2 / sampleCount,
        reach_minus_2_rate:
          sampleCount === 0 ? null : bucket.reachMinus2 / sampleCount,
        reach_plus_5_rate:
          sampleCount === 0 ? null : bucket.reachPlus5 / sampleCount,
        reach_minus_5_rate:
          sampleCount === 0 ? null : bucket.reachMinus5 / sampleCount,
      });
    }

    const bootstrapRows: FoundationBootstrapRow[] = [];
    let seedOffset = 0;
    for (const [key, bucket] of this.bootstrap) {
      const [groupCode, entryMode, sampleSet, holdingDayText] = key.split("|");
      const bootstrap = movingBlockBootstrapMean({
        samples: bucket.values.map((value, index) => ({
          eventDate: bucket.eventDates[index]!,
          value,
        })),
        iterations: this.bootstrapIterations,
        blockLength: FOUNDATION_BOOTSTRAP_BLOCK_DAYS,
        seed: FOUNDATION_BOOTSTRAP_SEED + seedOffset,
      });
      seedOffset += 1;
      bootstrapRows.push({
        group_code: groupCode!,
        group_label: this.groups.get(groupCode!) ?? groupCode!,
        entry_mode: entryMode as FirstBoardEntryMode,
        sample_set: sampleSet as FoundationSampleSet,
        holding_day: Number(holdingDayText),
        mean_net_return: mean(bucket.values),
        bootstrap_ci95_low: bootstrap?.low ?? null,
        bootstrap_ci95_high: bootstrap?.high ?? null,
        bootstrap_cluster_count: bootstrap?.clusterCount ?? 0,
      });
    }

    const entryOrder = new Map(
      [
        "FIXED_T1_OPEN",
        "FIXED_T2_OPEN",
        "FIXED_T3_OPEN",
        "FIXED_T4_OPEN",
        "FIXED_T5_OPEN",
        "FIXED_T6_OPEN",
        "DYNAMIC_PULLBACK_V1",
      ].map((mode, index) => [mode, index])
    );
    const sampleOrder = new Map(
      FOUNDATION_SAMPLE_SETS.map((sampleSet, index) => [sampleSet, index])
    );
    curveRows.sort(
      (left, right) =>
        left.group_code.localeCompare(right.group_code) ||
        (entryOrder.get(left.entry_mode) ?? 0) -
          (entryOrder.get(right.entry_mode) ?? 0) ||
        (sampleOrder.get(left.sample_set) ?? 0) -
          (sampleOrder.get(right.sample_set) ?? 0) ||
        left.holding_day - right.holding_day
    );
    bootstrapRows.sort(
      (left, right) =>
        left.group_code.localeCompare(right.group_code) ||
        (entryOrder.get(left.entry_mode) ?? 0) -
          (entryOrder.get(right.entry_mode) ?? 0) ||
        (sampleOrder.get(left.sample_set) ?? 0) -
          (sampleOrder.get(right.sample_set) ?? 0) ||
        left.holding_day - right.holding_day
    );
    return { curveRows, bootstrapRows };
  }
}

export function roundFoundationNumber(value: number | null): number | null {
  return value === null ? null : round(value);
}
