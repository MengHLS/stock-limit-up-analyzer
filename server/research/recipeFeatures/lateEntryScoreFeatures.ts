/**
 * P8 · T+7/T+8/T+10 延迟入场的滚动 3F 重评分（LateEntry3F v1）。
 *
 * 口径：
 *   - 不沿用事件 T+1..T+5 的旧分数；
 *   - 在当前决策日 D，取「D 及之前最近 5 个交易日」+ 前一日锚点，共 6 根 bar；
 *   - 复用原 3F 的三项冻结公式与桶边界：maxAmplitude / meanAmplitude / t1VolumeRatio；
 *   - 因为候选已经通过 T+5 的原始回踩门槛，这里不再重复要求晚窗口内必须回踩
 *     （requirePullback=false）；这是新的版本化口径，不代表原 3F。
 *
 * PIT：
 *   - 入参必须已经截断到当前决策日；
 *   - 少于/多于 6 根都返回 null 或响亮抛错，不读取未来 bar。
 */
import {
  computeThreeFactorRaw,
  threeFactorCompositeScoreOf,
} from "./threeFactorScoreFeatures";
import type { CanonicalMarketBar } from "../../data";

export const LATE_ENTRY_SCORE_VERSION = "late-entry-3f-rolling-5-v1.0.0";
export const LATE_ENTRY_WINDOW_BARS = 6;

export interface LateEntryScore {
  readonly score: number;
  readonly maxAmplitude: number;
  readonly meanAmplitude: number;
  readonly volumeRatio: number;
}

/**
 * 由「D-5..D 共 6 根 bar」计算滚动 3F 分。
 *
 * bars[0] 是晚窗口的锚点（D-5），bars[1..5] 是最近 5 个交易日。
 * 任何一根不可用 ⇒ null；调用方不得插补。
 */
export function computeLateEntryScore(
  bars: readonly CanonicalMarketBar[],
): LateEntryScore | null {
  if (bars.length !== LATE_ENTRY_WINDOW_BARS) return null;
  const raw = computeThreeFactorRaw(bars, 5);
  if (raw === null) return null;
  const score = threeFactorCompositeScoreOf(raw, { requirePullback: false });
  if (score === null || !Number.isFinite(score)) return null;
  return {
    score,
    maxAmplitude: raw.maxAmplitude,
    meanAmplitude: raw.meanAmplitude,
    volumeRatio: raw.t1VolumeRatio,
  };
}
