/**
 * RESOLVING-RANK-3F-001 · 实验臂 B —— **3F 连续化排序**（纯计算，未接线）。
 *
 * ## 为什么要这个文件
 *
 * 现行 3F 合成分 = 三个因子「桶位分」等权平均，桶位分 = `(idx + 0.5) / k`
 * （`FROZEN-BUCKET-CONTRACT-001`，落地处 = `twelve-factor-composite-study/result.ts`）。
 * 三个成员的桶数是 **2 / 5 / 5**（见 `result.ts` 的 `MAX_AMPLITUDE_BUCKETS` /
 * `MEAN_AMPLITUDE_BUCKETS` / `VOLUME_RATIO_BUCKETS` 及各自 `bucketOf`），
 * ⇒ 合成分**最多只有 18 个可能取值**。实测（`closed_loop_backtest_run` id `6210006`，ds=780001）：
 * 3 档覆盖 **86.9%** 的成交、最高分一处并列 **262 笔（18.3%）**，而破平键是
 * `securityId.localeCompare`（`framework/ranking.ts:90` / `selection.ts:21`）
 * ⇒ 每天中位 **35** 个首板候选争 3 个名额时，**档内次序由不透明 UUID 决定**。
 * 完整证据：`docs/research/RESULT-151PCT-WINNER-CONCENTRATION-001.md` §10。
 *
 * ## 本文件做什么（只做一件事）
 *
 * 保持**同一套冻结桶边界、同一方向表、同一等权**，只把桶内取值由「桶中点 `(idx+0.5)/k`」
 * 换成**桶内实测相对位置的单调映射** `(idx + t) / k`，`t ∈ [0,1]`。这消除桶内并列，
 * 而**不新增任何桶边界、不重估方向、不做权重优化**。
 *
 * ## 与冻结契约的关系（零复制、零篡改）
 *
 * - 桶归属**仍然只由** `result.ts` 的 `bucketOf` 决定 —— 本文件不重写分桶逻辑；
 * - 桶边界**不是重新声明**的常数，而是用**二分法从 `bucketOf` 反解**出来的
 *   （`deriveBucketEdges`）⇒ 它与契约**不可能漂移**，因为它的来源就是契约本身；
 * - `result.ts` **未被修改一行**。
 *
 * ## 🔴 无自由参数（这是刻意的）
 *
 * 内部桶与首桶都用线性映射（首桶下界取 `0`，3F 三因子取值恒 ≥ 0）。
 * 末桶上界在契约里是 `+inf`，若人为取一个有限上界（例如「边界 ×1.5」），
 * 会让**超过该上界的候选重新全部并列在 t = 1** —— 那等于在一个新位置重建了本实验要消除的并列。
 * 因此末桶默认使用**无参数的单调饱和映射**：
 *
 * ```text
 * t = 1 - lastEdge / value        (value >= lastEdge > 0)
 * ```
 *
 * `value = lastEdge → t = 0`；`value → ∞ → t → 1` 但**永不抵达**；严格单调、无上界参数。
 * `t = 0.5` 恰好发生在 `value = 2 × lastEdge`（单测据此构造 parity 用例）。
 *
 * 若需要做上界敏感性（方案 §3 的 S 口径），可显式传 `lastBucketUpper` 切回线性映射 ——
 * 但那是**显式声明的稳健性臂**，不是默认行为。
 *
 * ## 🔴 接线状态：**未接线**
 *
 * 本模块**不被任何 recipe / strategy / registry 引用**，因此对现有行为
 * **零影响**（默认关闭）。按方案 §7，只有在离线重放证明「臂 B 单调」之后，
 * 才考虑把它接进策略（且必须带显式开关）。
 */
import {
  factorDefinitionOf,
  type FactorDefinition,
  type TwelveFactorCode,
} from "../../../research-experiments/first-board-pullback/twelve-factor-composite-study/result";
import {
  THREE_FACTOR_CODES,
  type ThreeFactorRaw,
} from "./threeFactorScoreFeatures";

export interface ContinuousScoreOptions {
  /**
   * 末桶上界的**显式**线性口径（稳健性臂用）。缺省 = 无参数的饱和映射
   * `t = 1 - lastEdge / value`（推荐、无自由参数）。
   */
  readonly lastBucketUpper?: number;
  /**
   * 首桶下界。缺省时内部推断为 `0`（要求第一个桶边界 > 0，3F 三成员均满足）；
   * 否则抛错，避免对可为负的因子静默产出无意义的插值。
   */
  readonly rangeLow?: number;
  /** true（缺省）= 沿用「首板回踩」资格门槛；false = 移除该门槛（对齐既有语义）。 */
  readonly requirePullback?: boolean;
}

const edgeCache = new Map<TwelveFactorCode, readonly number[]>();

/**
 * 用二分法从**冻结的** `bucketOf` 反解桶边界（返回 `k-1` 个内部边界，升序）。
 *
 * 这样边界与契约**不可能漂移** —— 它不是重新声明的常数，而是 `bucketOf` 本身的逆。
 * 前置条件：`bucketOf(0)` 落在第 0 桶（3F 三成员取值恒 ≥ 0，均满足）。
 */
export function deriveBucketEdges(code: TwelveFactorCode): readonly number[] {
  const cached = edgeCache.get(code);
  if (cached !== undefined) return cached;

  const definition = factorDefinitionOf(code);
  const k = definition.buckets.length;
  if (k <= 1) {
    edgeCache.set(code, []);
    return [];
  }
  if (definition.bucketOf(0) !== definition.buckets[0]) {
    throw new Error(
      `deriveBucketEdges: 因子 ${code} 的第 0 桶不包含 0 ⇒ 需要显式 rangeLow，本函数不做静默推断。`,
    );
  }

  const edges: number[] = [];
  for (let index = 0; index < k - 1; index += 1) {
    const label = definition.buckets[index]!;
    let lo = index === 0 ? 0 : edges[index - 1]!;
    let hi = lo > 0 ? lo * 2 : 1;
    let guard = 0;
    while (definition.bucketOf(hi) === label) {
      lo = hi;
      hi *= 2;
      guard += 1;
      if (guard > 200) {
        throw new Error(`deriveBucketEdges: 因子 ${code} 第 ${index} 桶上界未收敛。`);
      }
    }
    for (let step = 0; step < 100; step += 1) {
      const mid = (lo + hi) / 2;
      if (definition.bucketOf(mid) === label) lo = mid;
      else hi = mid;
    }
    edges.push(hi);
  }
  edgeCache.set(code, edges);
  return edges;
}

/** 末桶下界（= 最后一个桶边界）。 */
export function lastBucketLowerOf(code: TwelveFactorCode): number {
  const edges = deriveBucketEdges(code);
  const last = edges[edges.length - 1];
  if (last === undefined || !(last > 0)) {
    throw new Error(`lastBucketLowerOf: 因子 ${code} 缺少正的最后桶边界。`);
  }
  return last;
}

function rangeLowOf(code: TwelveFactorCode, options: ContinuousScoreOptions): number {
  if (options.rangeLow !== undefined) return options.rangeLow;
  const edges = deriveBucketEdges(code);
  const first = edges[0];
  if (first === undefined || !(first > 0)) {
    throw new Error(`rangeLowOf: 因子 ${code} 第一个桶边界非正 ⇒ 请显式传 rangeLow。`);
  }
  return 0;
}

/**
 * 桶位分的**参数化形式**：`(idx + t) / k`，再套方向表。
 *
 * 🔴 **构造性 parity**：`bucketPositionalScoreAt(code, idx, 0.5)` 与现行
 * `orientedScoreOf` 在同一桶上的取值**逐位相同**（同一浮点路径：先算 `(idx+0.5)/k`，
 * 再 `orientation === 1 ? s : 1 - s`）。因此现行行为是本函数的特例 —— 单测直接断言这一点。
 */
export function bucketPositionalScoreAt(
  code: TwelveFactorCode,
  bucketIndex: number,
  withinBucket: number,
): number {
  const definition = factorDefinitionOf(code);
  const k = definition.buckets.length;
  const raw = (bucketIndex + withinBucket) / k;
  return definition.orientation === 1 ? raw : 1 - raw;
}

/** 线性桶内位置（越界夹取；退化区间返回 0.5）。 */
function linearPosition(value: number, low: number, high: number): number {
  if (!(high > low)) return 0.5;
  const t = (value - low) / (high - low);
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/**
 * 末桶（上界为 `+inf`）的桶内位置。
 *
 * 默认：无参数的单调饱和映射 `1 - lastEdge / value`（`value >= lastEdge > 0`），
 * 严格单调、永不并列在 t=1。显式传 `lastBucketUpper` 时改用线性映射（稳健性臂）。
 */
function lastBucketPosition(
  value: number,
  lastEdge: number,
  options: ContinuousScoreOptions,
): number {
  const explicitUpper = options.lastBucketUpper;
  if (explicitUpper !== undefined) return linearPosition(value, lastEdge, explicitUpper);
  if (!(lastEdge > 0)) return 0.5;
  if (!(value > lastEdge)) return 0;
  const t = 1 - lastEdge / value;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/**
 * 连续化的**方向分**：与 `orientedScoreOf` 同定义域、同方向、同桶，
 * 唯一差别是桶内不再塌成中点。缺值/未知 → `null`（不插补）。
 */
export function continuousOrientedScoreOf(
  code: TwelveFactorCode,
  value: number | null,
  options: ContinuousScoreOptions = {},
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const definition: FactorDefinition = factorDefinitionOf(code);
  const label = definition.bucketOf(value);
  if (label === null) return null;
  const index = definition.buckets.indexOf(label);
  if (index < 0) return null;

  const k = definition.buckets.length;
  const edges = deriveBucketEdges(code);
  let position: number;
  if (k === 1) {
    position = 0.5;
  } else if (index === 0) {
    position = linearPosition(value, rangeLowOf(code, options), edges[0]!);
  } else if (index === k - 1) {
    position = lastBucketPosition(value, edges[edges.length - 1]!, options);
  } else {
    position = linearPosition(value, edges[index - 1]!, edges[index]!);
  }
  return bucketPositionalScoreAt(code, index, position);
}

/**
 * 连续化合成分 `Σ(oriented) / 3`。
 *
 * 浮点路径与 `compositeScoreOf` **同构**（先累加、再除以 n），刻意不写成 `Σ (1/3)·x` ——
 * 见 `threeFactorScoreFeatures.ts:149-151`：1 ULP 就足以改变同值破平次序。
 */
export function continuousCompositeScoreOf(
  values: Readonly<Record<TwelveFactorCode, number | null>>,
  codes: readonly TwelveFactorCode[] = THREE_FACTOR_CODES,
  options: ContinuousScoreOptions = {},
): number | null {
  let sum = 0;
  for (const code of codes) {
    const score = continuousOrientedScoreOf(code, values[code] ?? null, options);
    if (score === null) return null;
    sum += score;
  }
  return sum / codes.length;
}

/** 连续化的 3F 合成分（与 `threeFactorCompositeScoreOf` 同签名、同门槛语义）。 */
export function threeFactorContinuousScoreOf(
  raw: ThreeFactorRaw,
  options: ContinuousScoreOptions = {},
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
  return continuousCompositeScoreOf(values, THREE_FACTOR_CODES, options);
}
