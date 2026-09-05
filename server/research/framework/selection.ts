/**
 * STEP 10 — 候选选择（Selector）。
 *
 * 输入：排序结果（RankedSignal[]）；输出：选中候选（SelectedCandidate[]）。
 * 方法 configuration-driven：
 *   - topN：按 rank 取前 n；
 *   - topPercentile：取 percentile >= 1 − pct（即截面前 pct 分位）。
 *
 * 铁律：只选择「有有效值且已排序」的条目；缺失/NaN 绝不选中。
 */

import type { RankedSignal, SelectedCandidate, SelectionConfig } from "./contract";
import { assertValidSelectionConfig } from "./validation";

/** 从排序结果中选择候选（确定性：rank 升序 + securityId 破平）。 */
export function selectCandidates(ranked: readonly RankedSignal[], config: SelectionConfig): SelectedCandidate[] {
  assertValidSelectionConfig(config);

  const candidates = ranked
    .filter((r) => r.rank !== null && r.value !== null && Number.isFinite(r.value))
    .sort((left, right) => (left.rank as number) - (right.rank as number) || left.securityId.localeCompare(right.securityId));

  let kept: typeof candidates;
  if (config.method.kind === "topN") {
    kept = candidates.slice(0, config.method.n);
  } else {
    const threshold = 1 - config.method.pct;
    kept = candidates.filter((c) => (c.percentile as number) >= threshold);
  }

  return kept.map((c) => ({
    securityId: c.securityId,
    rank: c.rank as number,
    percentile: c.percentile as number,
    value: c.value as number,
  }));
}
