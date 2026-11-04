/**
 * STEP 20 / C-20.2 — 因子消融与 OOS 退化：成分双轨贡献 + 排序 + OOS 退化信号候选。
 *
 * 职责（纯函数）：
 *   1. 对每个成分，在 IS / OOS 两轨分别计算「收益边际贡献」（百分点）+ maxDD 变化；
 *   2. 产出贡献清单，按 IS 收益边际贡献降序稳定排序（**完整清单，显式非单点 argmax**；
 *      并列按 targetId 字典序打破，排名唯一确定性）；
 *   3. 对「IS 贡献显著为正但 OOS 转负 / 趋零」的成分记录**描述性过拟合信号候选**
 *      （reasonCode 限定集合，见 types.ts）——**不下因果/聚合结论**。
 *
 * 贡献口径（语义为正 = 该成分保留价值）：
 *   - REMOVE_SINGLE / LEAVE_ONE_OUT（remove 系）：参照 = 全模型 base；
 *       贡献 = base.totalReturnPct − 剔除该成分后的 totalReturnPct；
 *   - CUMULATIVE_REMOVE（remove 系）：参照 = 前一变体（累计剥离的增量损失）；
 *   - FORWARD_ADD（add 系）：参照 = 前一变体；贡献 = 加入后 − 加入前。
 * maxDD 变化 = 变体 maxDD − 参照 maxDD（原始呈现，不做方向归因）。
 *
 * 确定性纪律：纯函数、readonly、无 IO / Date.now / Math.random；
 * 排序稳定（主键贡献降序、次键 targetId 升序）；NaN/Infinity 在 assess 已拒绝，
 * 本文件只消费有限标量（对 null 显式短路为不可评估）。
 */

import type {
  AblationContributionEntry,
  AblationMode,
  AblationOverfitSignal,
  AblationOverfitSignalCode,
  AblationSampleResult,
  AblationTarget,
  AblationTrackResult,
  ResolvedAblationThresholds,
} from "./types";
import { ablationModeValueFamily } from "./types";

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function trackReturn(track: AblationTrackResult, variantIndex: number): number | null {
  const sample = track.samples[variantIndex];
  if (sample === undefined || sample.status !== "succeeded" || sample.metrics === null) return null;
  return sample.metrics.totalReturnPct;
}

function trackDrawdown(track: AblationTrackResult, variantIndex: number): number | null {
  const sample = track.samples[variantIndex];
  if (sample === undefined || sample.status !== "succeeded" || sample.metrics === null) return null;
  return sample.metrics.maxDrawdownPct;
}

function trackSample(track: AblationTrackResult, variantIndex: number): AblationSampleResult | undefined {
  return track.samples[variantIndex];
}

/** 定位某成分的边际变体序号（该变体存在于两轨样本中；找不到 → null）。 */
function marginalVariantIndex(
  samples: readonly AblationSampleResult[],
  targetId: string,
): number | null {
  for (const sample of samples) {
    if (!sample.variant.isBase && sample.variant.marginalTargetId === targetId) {
      return sample.variant.variantIndex;
    }
  }
  return null;
}

/**
 * 某成分在给定轨上的「参照变体」序号：
 *   - REMOVE_SINGLE / LEAVE_ONE_OUT：base（variants[0]）；
 *   - CUMULATIVE_REMOVE / FORWARD_ADD：该成分所在变体的前一变体（增量视角）。
 */
function referenceVariantIndex(mode: AblationMode, variantIndex: number): number {
  return mode === "REMOVE_SINGLE" || mode === "LEAVE_ONE_OUT" ? 0 : variantIndex - 1;
}

/** 双轨的贡献数值对（各自可为 null = 该轨不可评估）。 */
interface TrackContribPair {
  readonly returnContributionPct: number | null;
  readonly drawdownDeltaPct: number | null;
}

/** 在给定轨上计算成分的贡献（ret/dd 均需参照与变体同时可评估）。 */
function contributionOnTrack(
  mode: AblationMode,
  track: AblationTrackResult,
  variantIndex: number,
): TrackContribPair {
  const refIndex = referenceVariantIndex(mode, variantIndex);
  const refReturn = trackReturn(track, refIndex);
  const varReturn = trackReturn(track, variantIndex);
  const refDd = trackDrawdown(track, refIndex);
  const varDd = trackDrawdown(track, variantIndex);
  const family = ablationModeValueFamily(mode);

  const returnContributionPct =
    refReturn === null || varReturn === null
      ? null
      : family === "remove"
        ? refReturn - varReturn // 剔除后损失多少（正 = 保留有价值）
        : varReturn - refReturn; // 加入后增益多少（正 = 加入有价值）

  const drawdownDeltaPct =
    refDd === null || varDd === null ? null : varDd - refDd;

  return { returnContributionPct, drawdownDeltaPct };
}

// ---------------------------------------------------------------------------
// 主计算
// ---------------------------------------------------------------------------

/**
 * 计算成分双轨贡献 + OOS 退化信号候选。
 *
 * 前提（由 assess.ts 保证）：is 轨必有且 base 成功；oos 轨存在时 base 成功；
 * 两轨样本集合同一组变体（相同 variantIndex ↔ 相同配方）。
 *
 * 退化：
 *   - 变体在某一轨失败 → 该轨贡献为 null（显式不可评估），不静默补 0；
 *   - 无 OOS 轨 → 全部 oos 贡献为 null、无信号（assess.ts 加 reasonCode）。
 */
export function computeAblationContributions(input: {
  readonly mode: AblationMode;
  readonly components: readonly AblationTarget[];
  readonly is: AblationTrackResult;
  readonly oos: AblationTrackResult | null;
  readonly thresholds: ResolvedAblationThresholds;
}): {
  readonly contributions: readonly AblationContributionEntry[];
  readonly signals: readonly AblationOverfitSignal[];
} {
  const { mode, components, is, oos, thresholds } = input;

  // 中间工作条目（isRank / signalCode 排序与判定后回填，随后物化为不可变条目）。
  interface WorkingEntry {
    readonly targetId: string;
    readonly kind: AblationTarget["kind"];
    readonly label: string;
    readonly variantIndex: number;
    readonly isContributionPct: number | null;
    readonly oosContributionPct: number | null;
    readonly isMaxDrawdownDeltaPct: number | null;
    readonly oosMaxDrawdownDeltaPct: number | null;
    readonly isAssessed: boolean;
    readonly oosAssessed: boolean;
    isRank: number | null;
    signalCode: AblationOverfitSignalCode | null;
  }

  const working: WorkingEntry[] = components.map((target, index) => {
    const variantIndex = marginalVariantIndex(is.samples, target.targetId);
    if (variantIndex === null) {
      // 防御：变体生成与成分清单不一致属于编程错误，绝不该发生。
      throw new Error(
        `factorAblation: 找不到成分 ${target.targetId} 的边际变体（mode=${mode}, index=${index}）`,
      );
    }
    const isPair = contributionOnTrack(mode, is, variantIndex);
    const oosPair = oos === null ? { returnContributionPct: null, drawdownDeltaPct: null }
      : contributionOnTrack(mode, oos, variantIndex);

    const isSample = trackSample(is, variantIndex);
    const oosSample = oos === null ? undefined : trackSample(oos, variantIndex);

    return {
      targetId: target.targetId,
      kind: target.kind,
      label: target.label,
      variantIndex,
      isContributionPct: isPair.returnContributionPct,
      oosContributionPct: oosPair.returnContributionPct,
      isMaxDrawdownDeltaPct: isPair.drawdownDeltaPct,
      oosMaxDrawdownDeltaPct: oosPair.drawdownDeltaPct,
      isAssessed: isSample !== undefined && isSample.status === "succeeded",
      oosAssessed: oosSample !== undefined && oosSample.status === "succeeded",
      isRank: null,
      signalCode: null,
    };
  });

  // ---- 稳定排序：主键 = IS 收益边际贡献降序（null 排最后），次键 = targetId 升序 ----
  working.sort((left, right) => {
    const lc = left.isContributionPct;
    const rc = right.isContributionPct;
    if (lc === null && rc === null) return left.targetId.localeCompare(right.targetId);
    if (lc === null) return 1;
    if (rc === null) return -1;
    if (lc !== rc) return rc - lc;
    return left.targetId.localeCompare(right.targetId);
  });

  // ---- 排名（唯一、确定性；并列按 targetId 已定序） ----
  let rank = 0;
  for (const entry of working) {
    if (entry.isContributionPct !== null) {
      rank += 1;
      entry.isRank = rank;
    }
  }

  // ---- OOS 退化信号候选（描述性；仅当 IS 与 OOS 贡献均可评估） ----
  const signals: AblationOverfitSignal[] = [];
  for (const entry of working) {
    const isContribution = entry.isContributionPct;
    const oosContribution = entry.oosContributionPct;
    if (isContribution === null || oosContribution === null) continue;
    if (isContribution <= thresholds.isContributionFloorPct) continue;
    let code: AblationOverfitSignalCode | null = null;
    if (oosContribution < 0) code = "ABL_IS_POS_OOS_NEG";
    else if (oosContribution <= thresholds.oosNeutralCeilingPct) code = "ABL_IS_POS_OOS_NEUTRAL";
    if (code === null) continue;
    const message =
      `成分「${entry.label}」IS 边际贡献 ${isContribution.toFixed(2)}pp（> floor ${thresholds.isContributionFloorPct}pp）`
      + `，但 OOS 边际贡献 ${oosContribution.toFixed(2)}pp`
      + `（${code === "ABL_IS_POS_OOS_NEG" ? "样本外反向，回测好泛化差候选" : "样本外趋零，泛化贡献未兑现"}）；`
      + `描述性候选，非因果结论`;
    signals.push({
      targetId: entry.targetId,
      kind: entry.kind,
      label: entry.label,
      isContributionPct: isContribution,
      oosContributionPct: oosContribution,
      code,
      message,
    });
    entry.signalCode = code;
  }

  // ---- 物化为不可变贡献条目 ----
  const contributions: readonly AblationContributionEntry[] = working.map((entry) => ({
    targetId: entry.targetId,
    kind: entry.kind,
    label: entry.label,
    variantIndex: entry.variantIndex,
    isContributionPct: entry.isContributionPct,
    oosContributionPct: entry.oosContributionPct,
    isMaxDrawdownDeltaPct: entry.isMaxDrawdownDeltaPct,
    oosMaxDrawdownDeltaPct: entry.oosMaxDrawdownDeltaPct,
    isAssessed: entry.isAssessed,
    oosAssessed: entry.oosAssessed,
    isRank: entry.isRank,
    signalCode: entry.signalCode,
  }));

  return { contributions, signals };
}
