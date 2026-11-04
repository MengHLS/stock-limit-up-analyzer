/**
 * 首板股票池 — 滚动 3F 评分（纯计算）。
 *
 * 与事件窗 3F 的差别只在“观察窗长度”：
 *   - 事件窗固定使用 T+1..T+5；
 *   - 滚动版本在 T+N（N=1..5）使用 T+1..T+N，T+5 后继续使用 T+1..T+5。
 *
 * 分桶方向沿用冻结契约：maxAmplitude / meanAmplitude = LOW，
 * t1VolumeRatio = HIGH；每个 N 的边界来自 2019–2024 首板样本重估，并冻结在本文件。
 */

import type { CanonicalMarketBar } from "../../data";

export const ROLLING_THREE_FACTOR_FEATURE_ID = "rollingThreeFactorCompositeScore";
export const ROLLING_THREE_FACTOR_FEATURE_VERSION = "1.0.0";
export const ROLLING_THREE_FACTOR_CALIBRATION_VERSION = "rolling-3f-2019-2024-v1";
export const ROLLING_THREE_FACTOR_MAX_WINDOW_DAYS = 5;
export const FIXED_POOL_THREE_FACTOR_FEATURE_ID = "fixedPoolThreeFactorCompositeScore";
export const CALIBRATED_N5_EVENT_FEATURE_ID = "calibratedN5ThreeFactorCompositeScore";

export interface RollingThreeFactorScoreEdges {
  readonly maxAmplitudeEdges: readonly number[];
  readonly meanAmplitudeEdges: readonly number[];
  readonly t1VolumeRatioEdges: readonly number[];
}

/** 冻结桶对照：所有 N 共用原 3F 冻结边界。 */
export const FROZEN_THREE_FACTOR_SCORE_EDGES: RollingThreeFactorScoreEdges = Object.freeze({
  maxAmplitudeEdges: [0.08],
  meanAmplitudeEdges: [0.02, 0.04, 0.06, 0.08],
  t1VolumeRatioEdges: [0.5, 0.8, 1.2, 2],
});

export interface RollingThreeFactorCalibration {
  readonly relativeDay: 1 | 2 | 3 | 4 | 5;
  readonly maxAmplitudeEdges: readonly number[];
  readonly meanAmplitudeEdges: readonly number[];
  readonly t1VolumeRatioEdges: readonly number[];
  readonly sampleCount: number;
}

/** 2019–2024 样本的逐 N 分桶边界。 */
export const ROLLING_THREE_FACTOR_CALIBRATION: readonly RollingThreeFactorCalibration[] =
  Object.freeze([
    {
      relativeDay: 1,
      maxAmplitudeEdges: [0.1028872425],
      meanAmplitudeEdges: [0.0503528958, 0.0671566786, 0.0835875557, 0.1028872425],
      t1VolumeRatioEdges: [0.9398224153, 1.2112642138, 1.553695287, 2.2146299179],
      sampleCount: 53_967,
    },
    {
      relativeDay: 2,
      maxAmplitudeEdges: [0.1194968553],
      meanAmplitudeEdges: [0.0505872584, 0.0651458379, 0.0791125211, 0.0963557517],
      t1VolumeRatioEdges: [0.9397617529, 1.2112268166, 1.5537487164, 2.2147449087],
      sampleCount: 53_918,
    },
    {
      relativeDay: 3,
      maxAmplitudeEdges: [0.1258278146],
      meanAmplitudeEdges: [0.0500055922, 0.0631969336, 0.0757174468, 0.0918183001],
      t1VolumeRatioEdges: [0.9397809056, 1.2112211837, 1.553913582, 2.2152542968],
      sampleCount: 53_870,
    },
    {
      relativeDay: 4,
      maxAmplitudeEdges: [0.1297297297],
      meanAmplitudeEdges: [0.0490577304, 0.0613425113, 0.0733375734, 0.088555553],
      t1VolumeRatioEdges: [0.9401868101, 1.2112815159, 1.5540183883, 2.215544262],
      sampleCount: 53_837,
    },
    {
      relativeDay: 5,
      maxAmplitudeEdges: [0.1322725012],
      meanAmplitudeEdges: [0.0481180181, 0.0599229173, 0.0713936755, 0.0861422938],
      t1VolumeRatioEdges: [0.9402135315, 1.2113100326, 1.5541260846, 2.2157439688],
      sampleCount: 53_801,
    },
  ] satisfies readonly RollingThreeFactorCalibration[]);

export interface RollingThreeFactorRaw {
  readonly relativeDay: 1 | 2 | 3 | 4 | 5;
  readonly maxAmplitude: number;
  readonly meanAmplitude: number;
  readonly t1VolumeRatio: number;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 由 T+0..T+N 的 bars 计算滚动 3F 原始值；数据不足或无效时返回 null。 */
export function computeRollingThreeFactorRaw(
  bars: readonly CanonicalMarketBar[],
): RollingThreeFactorRaw | null {
  const eventBar = bars[0];
  if (eventBar === undefined || !finite(eventBar.close) || eventBar.close <= 0) return null;
  if (!finite(eventBar.volume) || eventBar.volume <= 0) return null;

  const availableDays = Math.min(bars.length - 1, ROLLING_THREE_FACTOR_MAX_WINDOW_DAYS);
  if (availableDays < 1) return null;
  const relativeDay = availableDays as 1 | 2 | 3 | 4 | 5;

  let runningPreClose = eventBar.close;
  let sum = 0;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 1; index <= relativeDay; index += 1) {
    const bar = bars[index];
    if (
      bar === undefined
      || !finite(bar.high)
      || !finite(bar.low)
      || !finite(bar.close)
    ) {
      return null;
    }
    const amplitude = (bar.high - bar.low) / runningPreClose;
    if (!Number.isFinite(amplitude)) return null;
    sum += amplitude;
    max = Math.max(max, amplitude);
    runningPreClose = bar.close;
  }

  const t1Bar = bars[1];
  if (t1Bar === undefined || !finite(t1Bar.volume)) return null;
  return {
    relativeDay,
    maxAmplitude: max,
    meanAmplitude: sum / relativeDay,
    t1VolumeRatio: t1Bar.volume / eventBar.volume,
  };
}

function bucketIndex(value: number, edges: readonly number[]): number {
  let index = 0;
  while (index < edges.length && value >= edges[index]!) index += 1;
  return index;
}

function positionalScore(value: number, edges: readonly number[]): number {
  return (bucketIndex(value, edges) + 0.5) / (edges.length + 1);
}

function orientedLow(value: number, edges: readonly number[]): number {
  return 1 - positionalScore(value, edges);
}

export function calibrationForRelativeDay(
  relativeDay: 1 | 2 | 3 | 4 | 5,
): RollingThreeFactorCalibration {
  const calibration = ROLLING_THREE_FACTOR_CALIBRATION.find(
    item => item.relativeDay === relativeDay,
  );
  if (calibration === undefined) {
    throw new Error(`滚动 3F：缺少 T+${relativeDay} 的校准边界。`);
  }
  return calibration;
}

/** 等权合成；任一成员不可算即 null。 */
export function rollingThreeFactorCompositeScoreOf(
  raw: RollingThreeFactorRaw,
): number | null {
  const calibration = calibrationForRelativeDay(raw.relativeDay);
  return rollingThreeFactorCompositeScoreWithEdgesOf(raw, {
    maxAmplitudeEdges: calibration.maxAmplitudeEdges,
    meanAmplitudeEdges: calibration.meanAmplitudeEdges,
    t1VolumeRatioEdges: calibration.t1VolumeRatioEdges,
  });
}

export function rollingThreeFactorCompositeScoreWithEdgesOf(
  raw: RollingThreeFactorRaw,
  edges: RollingThreeFactorScoreEdges,
): number | null {
  const maxScore = orientedLow(raw.maxAmplitude, edges.maxAmplitudeEdges);
  const meanScore = orientedLow(raw.meanAmplitude, edges.meanAmplitudeEdges);
  const volumeScore = positionalScore(raw.t1VolumeRatio, edges.t1VolumeRatioEdges);
  const sum = maxScore + meanScore + volumeScore;
  return Number.isFinite(sum) ? sum / 3 : null;
}

export function calibratedN5ThreeFactorCompositeScoreOf(
  raw: RollingThreeFactorRaw,
): number | null {
  const calibration = calibrationForRelativeDay(5);
  return rollingThreeFactorCompositeScoreWithEdgesOf(raw, {
    maxAmplitudeEdges: calibration.maxAmplitudeEdges,
    meanAmplitudeEdges: calibration.meanAmplitudeEdges,
    t1VolumeRatioEdges: calibration.t1VolumeRatioEdges,
  });
}
