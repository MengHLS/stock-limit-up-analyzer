/**
 * 运行工作台 — 「首板回踩 · 3F 综合评分」配方的**特征实现**（纯计算）。
 *
 * ## 为什么单独成文件
 *
 * 与 `pullbackFeatures.ts` 同性质：本文件只放**纯计算** —— 由（已按 decisionTime as-of
 * 过滤的）bars 算出 3F 三个因子值与其合成分。无 IO、无副作用、确定性。
 *
 * ## 🔴 口径来源：零复制，全部 import 自研究侧唯一落地处
 *
 * 3F 定义（用户 2026-09 冻结）= `maxAmplitude`(LOW) + `meanAmplitude`(LOW) +
 * `t1VolumeRatio`(HIGH)，**等权各 1/3**。桶边界 / 方向表 / 桶位分公式 / 等权合成分公式
 * **全部**来自 `research-experiments/first-board-pullback/twelve-factor-composite-study/result.ts`
 * —— 它是 `FROZEN-BUCKET-CONTRACT-001` 在代码里的唯一落地处
 * （`bucketPositionalScoreOf` / `orientedScoreOf` / `compositeScoreOf`）。
 * 本文件**不新增任何桶边界、不做方向再估计、不做权重优化**。
 *
 * ## 🔴 两侧 bars 的偏移不同（本文件最容易踩的一处）
 *
 * | 侧 | `bars[0]` | 事件日 T 在哪 | T+1 | T+5 |
 * |---|---|---|---|---|
 * | 研究侧 `derive.ts#deriveTwelveFactorSamples` | `T+1` | 另传的 `eventBar` | `bars[0]` | `bars[4]` |
 * | 本文件（Core / 装配层） | **`T`**（prefix `rd=0`） | `bars[0]` | `bars[1]` | `bars[5]` |
 *
 * 依据 = `runWorkbenchAssembly/datasetFromRegistry.ts` 的窗口投影：
 * 「面板含 `rd=0`（首板日，充当 `pullbackFeatures` 的特征基准 `bars[0]`）+
 * `rd ∈ [1, end+1]`（观察日 + 次日执行日）」，且「**`rd=0` 不进决策日**」。
 *
 * ⇒ 本文件里 `amplitudes[i] = (bars[i+1].high − bars[i+1].low) / runningPreClose`，
 * `runningPreClose` 初值 = `bars[0].close`（首板日收盘），逐根更新为 `bars[i+1].close`。
 * 这与研究侧 `derive.ts` 的循环**逐字同构**（同一递推、同一顺序、同一除法），只是下标整体 +1。
 *
 * ## 为什么不需要「同日 peer 集合」
 *
 * 3F 用的是 `BUCKET_POSITIONAL` 标准化（桶边界**冻结在词表里**）⇒ 取值只依赖该证券自己的
 * 因子值，**不需要横截面**（与 `CROSS_SECTION_PERCENTILE` 相反）⇒ 可以做成 per-security
 * 特征。凡是要 peer 集合的标准化，本文件都做不了（会在报告里如实登记）。
 */

import type { CanonicalMarketBar } from "../../data";
import {
  compositeScoreOf,
  orientedScoreOf,
  type TwelveFactorCode,
} from "../../../research-experiments/first-board-pullback/twelve-factor-composite-study/result";

/** 1.62.1 的振幅窗口上限（T+1..T+5），与研究侧 `CONTEXT_DAYS` 同值。 */
export const AMPLITUDE_WINDOW_DAYS = 5;

/**
 * 3F 成员（**顺序参与浮点累加** ⇒ 必须与研究侧 `memberCodes` 顺序逐字一致）。
 *
 * 研究侧 `composite-factor-constrained-weight-study/presets.ts` 的 3F 预设写作
 * `memberCodes: [...AMPLITUDE_PAIR, "t1VolumeRatio"]` ⇒
 * `["maxAmplitude", "meanAmplitude", "t1VolumeRatio"]`。`scoreSamples` 按该顺序累加
 * `orientedSum` 后除以 3 ⇒ 本常量保持同一顺序，合成分与既有 Run **逐位相同**。
 */
export const THREE_FACTOR_CODES = [
  "maxAmplitude",
  "meanAmplitude",
  "t1VolumeRatio",
] as const satisfies readonly TwelveFactorCode[];

export type ThreeFactorCode = (typeof THREE_FACTOR_CODES)[number];

/** 3F 三个原始因子值（未标准化）。 */
export interface ThreeFactorRaw {
  /** 当前评估窗口 T+1..Te 内是否至少有一天回踩到首板收盘价下方。 */
  readonly hasPullbackInObservationWindow: boolean;
  /** 当前评估窗口 T+1..Te 最大振幅（分母为链式前收）。 */
  readonly maxAmplitude: number;
  /** 当前评估窗口 T+1..Te 平均振幅。 */
  readonly meanAmplitude: number;
  /** T+1 成交量 ÷ 首板日成交量。 */
  readonly t1VolumeRatio: number;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 由「已 as-of 过滤」的 bars 算 3F 三个原始值。
 *
 * 🔴 入参约定：`bars[0]` = **首板日 T**（装配层 prefix `rd=0`），`bars[1..N]` = T+1..T+N。
 * `amplitudeWindowDays` 是**本次信息截点** Te：
 *   - 1.62.1 调用缺省值 5 ⇒ T+1..T+5；
 *   - DYNAMIC-3F-BUCKET-ENTRY-001 传入 1..5，且只读 bars[1..Te]。
 * 任一根缺失 / 非有限 / 首板日收盘或成交量非正 ⇒ 返回 `null`（**不插补、不填 0**、
 * 与契约 §3.3「完备用例」一致）。
 *
 * `t1VolumeRatio` 始终固定为 T+1 成交量 / 首板日成交量，不随 Te 改变。
 * 决策日 = 序列末根；同一事件一旦在声明的首个有效日触发，后续日不再重复入场。
 */
export function computeThreeFactorRaw(
  bars: readonly CanonicalMarketBar[],
  amplitudeWindowDays: number = AMPLITUDE_WINDOW_DAYS,
): ThreeFactorRaw | null {
  if (!Number.isInteger(amplitudeWindowDays) || amplitudeWindowDays < 1 || amplitudeWindowDays > AMPLITUDE_WINDOW_DAYS) {
    throw new Error(`3F amplitudeWindowDays 必须是 [1, ${AMPLITUDE_WINDOW_DAYS}] 的整数，实际 ${String(amplitudeWindowDays)}。`);
  }
  const eventBar = bars[0];
  if (eventBar === undefined) return null;
  const eventClose = eventBar.close;
  const eventVolume = eventBar.volume;
  if (!finite(eventClose) || eventClose <= 0) return null;
  if (!finite(eventVolume) || eventVolume <= 0) return null;
  // 需要 bars[0..Te] 共 Te+1 根；不足 ⇒ 该事件尚未走完当前观察窗口。
  if (bars.length < amplitudeWindowDays + 1) return null;

  let runningPreClose = eventClose;
  let sum = 0;
  let max = Number.NEGATIVE_INFINITY;
  let hasPullbackInObservationWindow = false;
  for (let index = 0; index < amplitudeWindowDays; index += 1) {
    const bar = bars[index + 1]!;
    const { high, low, close } = bar;
    if (!finite(high) || !finite(low) || !finite(close)) return null;
    const amplitude = (high - low) / runningPreClose;
    if (!Number.isFinite(amplitude)) return null;
    sum += amplitude;
    if (amplitude > max) max = amplitude;
    if (close < eventClose - 1e-9) hasPullbackInObservationWindow = true;
    runningPreClose = close;
  }
  const t1Bar = bars[1]!;
  if (!finite(t1Bar.volume)) return null;

  return {
    hasPullbackInObservationWindow,
    maxAmplitude: max,
    meanAmplitude: sum / amplitudeWindowDays,
    t1VolumeRatio: t1Bar.volume / eventVolume,
  };
}

/** 单个成员的方向分（= 契约 §3.1 + §3.2，直接复用研究侧唯一实现）。 */
export function orientedScoreOfMember(code: ThreeFactorCode, raw: ThreeFactorRaw): number | null {
  return orientedScoreOf(code, raw[code]);
}

/**
 * 3F 等权合成分 `Σ(oriented) / 3`。
 *
 * 走 `compositeScoreOf(values, THREE_FACTOR_CODES)` —— 与研究侧 `scoreSamples` 的
 * EQUAL 分支（`orientedSum / members.length`）是**同一条浮点路径**（先累加再除以 n）。
 * 缺任一成员 ⇒ `null`（不插补）。
 *
 * 注意这里刻意**不**手写 `Σ (1/3)·x`：两者数学等价但浮点可差 1 ULP，而桶位分在横截面上
 * 有大量精确同值 ⇒ 1 ULP 就足以改变 `rankSignals` 的同值破平次序（`selection.ts` 的
 * `rank` 升序 + `securityId` 破平）⇒ 改变 TopN 边界上「选中哪几只」。
 */
export interface ThreeFactorCompositeScoreOptions {
  /**
   * true（缺省）= 沿用「首板回踩」资格门槛：观察窗内必须出现收盘价低于首板日收盘价；
   * false = 新版本显式移除该门槛，允许纯上升路径进入 3F 横截面排序。
   */
  readonly requirePullback?: boolean;
}

export function threeFactorCompositeScoreOf(
  raw: ThreeFactorRaw,
  options: ThreeFactorCompositeScoreOptions = {},
): number | null {
  const requirePullback = options.requirePullback ?? true;
  if (requirePullback && !raw.hasPullbackInObservationWindow) return null;
  const values: Record<TwelveFactorCode, number | null> = {
    bodyHeight: null,
    turnover: null,
    amountPercentile: null,
    meanAmplitude: raw.meanAmplitude,
    maxAmplitude: raw.maxAmplitude,
    holdStreak: null,
    t1VolumeRatio: raw.t1VolumeRatio,
    limitGap: null,
    preReturn10: null,
    drawdownDepth: null,
    t1OpenGap: null,
    historyLimitCount: null,
  };
  return compositeScoreOf(values, THREE_FACTOR_CODES);
}
