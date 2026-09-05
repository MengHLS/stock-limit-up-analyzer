/**
 * STEP 10 — 横截面排序（Ranker）。
 *
 * 能力：
 *   - cross-sectional ranking（同截面按 value 排序）；
 *   - NaN / missing 处理（exclude 排除 | rankLast 排在有效值之后）；
 *   - ties 处理（stable 稳定顺序 | average 平均秩）；
 *   - winsorization 缩尾接口（WinsorizationSpec，参数不在本 STEP 选定）。
 *
 * 铁律：纯函数、确定性（并列以 securityId 升序破平）、不修改输入、禁止 NaN 进入下游。
 *
 * 语义约定：
 *   - rank 为 1-based，1 最优；percentile = 1 − (rank − 1) / n，∈ (0, 1]，1 最优。
 *   - n 为输入条目总数；缺失且被 exclude 的条目 rank/percentile 为 null。
 *   - 缺失（rankLast）的条目仅作报告排序，绝不参与后续 selection（无有效值不可选中）。
 */

import { quantile } from "../../../shared/quant-stats";
import type { RankInput, RankedSignal, RankingConfig } from "./contract";
import { assertValidRankingConfig } from "./validation";

/** 对有限值按分位夹住极值（纯函数，不修改输入）。样本不足时原样返回。 */
export function winsorize(values: readonly number[], lowerQuantile: number, upperQuantile: number): number[] {
  const lower = quantile([...values], lowerQuantile);
  const upper = quantile([...values], upperQuantile);
  if (lower === null || upper === null) return [...values];
  return values.map((value) => (value < lower ? lower : value > upper ? upper : value));
}

interface Entry {
  securityId: string;
  value: number | null;
  key: number | null;
  winsorized: number | null;
  finite: boolean;
}

/** 横截面排序。 */
export function rankSignals(input: readonly RankInput[], config: RankingConfig): RankedSignal[] {
  assertValidRankingConfig(config);

  const n = input.length;
  if (n === 0) return [];

  // 重复 securityId 属数据错误，FAIL FAST，避免排序结果歧义。
  const seen = new Set<string>();
  for (const item of input) {
    if (seen.has(item.securityId)) {
      throw new Error(`rankSignals: 重复 securityId：${item.securityId}`);
    }
    seen.add(item.securityId);
  }

  const higherIsBetter = config.higherIsBetter;
  const tieBreaking = config.tieBreaking ?? "average";
  const missingPolicy = config.missingPolicy ?? "exclude";

  const entries: Entry[] = input.map((item) => {
    const finite = item.value !== null && Number.isFinite(item.value);
    return { securityId: item.securityId, value: item.value, key: null, winsorized: null, finite };
  });

  // 缩尾：基于有限值分位夹取极值。
  const finiteValues = entries.filter((e) => e.finite).map((e) => e.value as number);
  let clamped: number[] | null = null;
  if (config.winsorization && finiteValues.length >= 2) {
    const lower = quantile(finiteValues, config.winsorization.lowerQuantile);
    const upper = quantile(finiteValues, config.winsorization.upperQuantile);
    if (lower !== null && upper !== null && lower <= upper) {
      clamped = finiteValues.map((value) => (value < lower ? lower : value > upper ? upper : value));
    }
  }

  let clampedIndex = 0;
  for (const entry of entries) {
    if (entry.finite) {
      const winsorized = clamped ? (clamped[clampedIndex++] as number) : (entry.value as number);
      entry.winsorized = winsorized;
      entry.key = winsorized;
    }
  }

  const valid = entries.filter((e) => e.finite);
  const missing = entries.filter((e) => !e.finite);

  // 有效值排序：方向感知 + securityId 破平（确定性）。
  valid.sort((left, right) => {
    const delta = higherIsBetter ? (right.key as number) - (left.key as number) : (left.key as number) - (right.key as number);
    if (delta !== 0) return delta;
    return left.securityId.localeCompare(right.securityId);
  });

  const rankOf = new Map<string, { rank: number; percentile: number }>();

  if (tieBreaking === "average") {
    let i = 0;
    while (i < valid.length) {
      let j = i;
      while (j + 1 < valid.length && (valid[j + 1]!.key as number) === (valid[i]!.key as number)) j += 1;
      const averageRank = (i + 1 + j + 1) / 2;
      for (let k = i; k <= j; k += 1) {
        rankOf.set(valid[k]!.securityId, { rank: averageRank, percentile: 1 - (averageRank - 1) / n });
      }
      i = j + 1;
    }
  } else {
    valid.forEach((entry, index) => {
      const rank = index + 1;
      rankOf.set(entry.securityId, { rank, percentile: 1 - (rank - 1) / n });
    });
  }

  if (missingPolicy === "rankLast") {
    missing.sort((left, right) => left.securityId.localeCompare(right.securityId));
    missing.forEach((entry, index) => {
      const rank = valid.length + 1 + index;
      rankOf.set(entry.securityId, { rank, percentile: 1 - (rank - 1) / n });
    });
  }

  const bySecurityId = new Map(entries.map((entry) => [entry.securityId, entry]));
  return input.map((item) => {
    const entry = bySecurityId.get(item.securityId)!;
    const ranked = rankOf.get(item.securityId);
    return {
      securityId: item.securityId,
      value: entry.value,
      winsorizedValue: entry.winsorized,
      rank: ranked ? ranked.rank : null,
      percentile: ranked ? ranked.percentile : null,
    };
  });
}
