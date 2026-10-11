/** RESOLVING-RANK-3F-001 · 实验臂 B（3F 连续化排序）纯计算测试。 */
import { describe, expect, it } from "vitest";
import {
  THREE_FACTOR_CODES,
  threeFactorCompositeScoreOf,
  type ThreeFactorRaw,
} from "../../../../server/research/recipeFeatures/threeFactorScoreFeatures";
import {
  bucketPositionalScoreAt,
  continuousCompositeScoreOf,
  continuousOrientedScoreOf,
  deriveBucketEdges,
  lastBucketLowerOf,
  threeFactorContinuousScoreOf,
} from "../../../../server/research/recipeFeatures/threeFactorContinuousScoreFeatures";
import {
  factorDefinitionOf,
  orientedScoreOf,
  type TwelveFactorCode,
} from "../../../../research-experiments/first-board-pullback/twelve-factor-composite-study/result";

const raw = (
  maxAmplitude: number,
  meanAmplitude: number,
  t1VolumeRatio: number,
  hasPullback = true,
): ThreeFactorRaw => ({
  hasPullbackInObservationWindow: hasPullback,
  maxAmplitude,
  meanAmplitude,
  t1VolumeRatio,
});

/**
 * 某因子各桶中 **t = 0.5** 的代表值。
 * 内部/首桶为线性映射 ⇒ 取区间中点；末桶为饱和映射 `1 - lastEdge/value`
 * ⇒ `t = 0.5` 落在 `value = 2 × lastEdge`。
 */
function bucketMidpointsOf(code: TwelveFactorCode): number[] {
  const edges = deriveBucketEdges(code);
  const k = factorDefinitionOf(code).buckets.length;
  const out: number[] = [];
  for (let index = 0; index < k; index += 1) {
    if (index === k - 1) out.push(2 * edges[edges.length - 1]!);
    else {
      const low = index === 0 ? 0 : edges[index - 1]!;
      out.push((low + edges[index]!) / 2);
    }
  }
  return out;
}

describe("RESOLVING-RANK-3F-001 · 桶边界反解", () => {
  it("三因子桶数确为 2 / 5 / 5（本实验的起点事实）", () => {
    expect(factorDefinitionOf("maxAmplitude").buckets.length).toBe(2);
    expect(factorDefinitionOf("meanAmplitude").buckets.length).toBe(5);
    expect(factorDefinitionOf("t1VolumeRatio").buckets.length).toBe(5);
  });

  it("已知桶边界（振幅 0.08 / 均幅 0.02·0.04·0.06·0.08 / 量比 0.5·0.8·1.2·2）被反解命中", () => {
    expect(deriveBucketEdges("maxAmplitude")).toEqual([0.08]);
    expect(deriveBucketEdges("meanAmplitude")).toEqual([0.02, 0.04, 0.06, 0.08]);
    expect(deriveBucketEdges("t1VolumeRatio")).toEqual([0.5, 0.8, 1.2, 2]);
  });

  it("反解出的边界能逐点复现冻结的 bucketOf", () => {
    for (const code of THREE_FACTOR_CODES) {
      const definition = factorDefinitionOf(code);
      const edges = deriveBucketEdges(code);
      const upper = lastBucketLowerOf(code) * 10;
      expect(edges.length).toBe(definition.buckets.length - 1);

      const indexFromEdges = (value: number): number => {
        let index = 0;
        while (index < edges.length && value >= edges[index]!) index += 1;
        return index;
      };

      for (let step = 0; step <= 4000; step += 1) {
        const value = (upper * step) / 4000;
        const fromContract = definition.buckets.indexOf(definition.bucketOf(value) as string);
        expect(indexFromEdges(value)).toBe(fromContract);
      }
    }
  });
});

describe("RESOLVING-RANK-3F-001 · 构造性 parity（现行行为是本设计的特例）", () => {
  it("withinBucket = 0.5 时与冻结的 orientedScoreOf 逐位相同", () => {
    for (const code of THREE_FACTOR_CODES) {
      const definition = factorDefinitionOf(code);
      const edges = deriveBucketEdges(code);
      const k = definition.buckets.length;

      for (let index = 0; index < k; index += 1) {
        const representative = index === 0 ? 0 : edges[index - 1]!;
        expect(definition.buckets.indexOf(definition.bucketOf(representative) as string)).toBe(index);
        expect(bucketPositionalScoreAt(code, index, 0.5)).toBe(orientedScoreOf(code, representative));
      }
    }
  });

  it("三因子同时取 t=0.5 代表值时，连续合成分与冻结合成分一致（≤ 1e-12）", () => {
    const maxMid = bucketMidpointsOf("maxAmplitude");
    const meanMid = bucketMidpointsOf("meanAmplitude");
    const t1Mid = bucketMidpointsOf("t1VolumeRatio");
    let checked = 0;
    for (const a of maxMid) {
      for (const b of meanMid) {
        for (const c of t1Mid) {
          const value = raw(a, b, c);
          const frozen = threeFactorCompositeScoreOf(value);
          const continuous = threeFactorContinuousScoreOf(value);
          expect(frozen).not.toBeNull();
          expect(continuous).not.toBeNull();
          expect(Math.abs(continuous! - frozen!)).toBeLessThanOrEqual(1e-12);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(maxMid.length * meanMid.length * t1Mid.length);
    expect(checked).toBe(2 * 5 * 5);
  });
});

describe("RESOLVING-RANK-3F-001 · 连续分是冻结分的严格细化（不跨桶）", () => {
  it("连续分始终落在其所属桶的区间内", () => {
    const code: TwelveFactorCode = "t1VolumeRatio"; // orientation = +1 ⇒ oriented 即 raw
    const definition = factorDefinitionOf(code);
    const k = definition.buckets.length;
    const upper = lastBucketLowerOf(code) * 10;
    for (let step = 0; step <= 4000; step += 1) {
      const value = (upper * step) / 4000;
      const index = definition.buckets.indexOf(definition.bucketOf(value) as string);
      const score = continuousOrientedScoreOf(code, value);
      expect(score).not.toBeNull();
      expect(score!).toBeGreaterThanOrEqual(index / k - 1e-12);
      expect(score!).toBeLessThanOrEqual((index + 1) / k + 1e-12);
    }
  });

  it("方向表被保留：-1 因子随值非增，+1 因子随值非减", () => {
    const sweep = (code: TwelveFactorCode): void => {
      const upper = lastBucketLowerOf(code) * 10;
      const decreasing = factorDefinitionOf(code).orientation === -1;
      let previous: number | null = null;
      for (let step = 0; step <= 2000; step += 1) {
        const value = (upper * step) / 2000;
        const score = continuousOrientedScoreOf(code, value);
        expect(score).not.toBeNull();
        if (previous !== null) {
          if (decreasing) expect(score!).toBeLessThanOrEqual(previous + 1e-12);
          else expect(score!).toBeGreaterThanOrEqual(previous - 1e-12);
        }
        previous = score;
      }
    };
    for (const code of THREE_FACTOR_CODES) sweep(code);
  });
});

describe("RESOLVING-RANK-3F-001 · 消除桶内并列（本实验要放开的唯一变量）", () => {
  it("同桶内两个不同取值：冻结分相同、连续分不同", () => {
    const a = raw(0.01, 0.03, 1.0);
    const b = raw(0.07, 0.03, 1.0); // 同属 maxAmplitude 第 0 桶（< 0.08）
    expect(threeFactorCompositeScoreOf(a)).toBe(threeFactorCompositeScoreOf(b));
    const ca = threeFactorContinuousScoreOf(a)!;
    const cb = threeFactorContinuousScoreOf(b)!;
    expect(ca).not.toBe(cb);
    // 振幅越小越好（orientation = -1）⇒ 连续分应更高
    expect(ca).toBeGreaterThan(cb);
  });

  it("跨桶的相对次序不被连续化反转", () => {
    const better = raw(0.05, 0.03, 1.0); // 第 0 桶
    const worse = raw(0.09, 0.03, 1.0); // 第 1 桶
    expect(threeFactorCompositeScoreOf(better)!).toBeGreaterThan(
      threeFactorCompositeScoreOf(worse)!,
    );
    expect(threeFactorContinuousScoreOf(better)!).toBeGreaterThan(
      threeFactorContinuousScoreOf(worse)!,
    );
  });

  it("回归：末桶默认映射**不饱和**，越大的值给出严格更大的桶内位置", () => {
    for (const code of THREE_FACTOR_CODES) {
      const last = lastBucketLowerOf(code);
      const values = [last * 1.5, last * 2, last * 10, last * 1e3, last * 1e6];
      const scores = values.map((value) => {
        // 归一化回「桶内位置」以比较：对 +1 因子 oriented 即 raw
        const definition = factorDefinitionOf(code);
        const index = definition.buckets.length - 1;
        const score = continuousOrientedScoreOf(code, value)!;
        const rawScore = definition.orientation === 1 ? score : 1 - score;
        return rawScore * definition.buckets.length - index;
      });
      for (let i = 1; i < scores.length; i += 1) {
        expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
      }
    }
  });

  it("值域基数：冻结分 ≤ 18 档，连续分远超 18 档", () => {
    const frozen = new Set<string>();
    const continuous = new Set<string>();
    for (let m = 0; m <= 40; m += 1) {
      for (let n = 0; n <= 40; n += 1) {
        for (let v = 0; v <= 40; v += 1) {
          const value = raw(0.002 * m, 0.002 * n, 0.05 * v);
          const f = threeFactorCompositeScoreOf(value);
          const c = threeFactorContinuousScoreOf(value);
          if (f !== null) frozen.add(f.toFixed(9));
          if (c !== null) continuous.add(c.toFixed(9));
        }
      }
    }
    expect(frozen.size).toBeLessThanOrEqual(18);
    expect(frozen.size).toBeGreaterThanOrEqual(10);
    expect(continuous.size).toBeGreaterThan(100);
  });
});

describe("RESOLVING-RANK-3F-001 · 缺值与门槛语义", () => {
  it("缺值 / 非有限一律 null，不插补", () => {
    expect(continuousOrientedScoreOf("maxAmplitude", null)).toBeNull();
    expect(continuousOrientedScoreOf("maxAmplitude", Number.NaN)).toBeNull();
    expect(continuousOrientedScoreOf("maxAmplitude", Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("任一成员缺值 ⇒ 合成分 null", () => {
    const values: Record<TwelveFactorCode, number | null> = {
      bodyHeight: null,
      turnover: null,
      amountPercentile: null,
      meanAmplitude: 0.03,
      maxAmplitude: null,
      holdStreak: null,
      t1VolumeRatio: 1.0,
      limitGap: null,
      preReturn10: null,
      drawdownDepth: null,
      t1OpenGap: null,
      historyLimitCount: null,
    };
    expect(continuousCompositeScoreOf(values, THREE_FACTOR_CODES)).toBeNull();
  });

  it("回踩门槛语义与 threeFactorCompositeScoreOf 一致", () => {
    const noPullback = raw(0.01, 0.03, 1.0, false);
    expect(threeFactorCompositeScoreOf(noPullback)).toBeNull();
    expect(threeFactorContinuousScoreOf(noPullback)).toBeNull();
    expect(threeFactorCompositeScoreOf(noPullback, { requirePullback: false })).not.toBeNull();
    expect(threeFactorContinuousScoreOf(noPullback, { requirePullback: false })).not.toBeNull();
  });
});

describe("RESOLVING-RANK-3F-001 · 末桶口径（默认无自由参数）", () => {
  it("显式 lastBucketUpper 只影响末桶内取值，不影响其它桶", () => {
    const midBucket = 0.03; // meanAmplitude 第 1 桶
    const scores = [0.09, 0.12, 0.3, 5.0].map((lastBucketUpper) =>
      continuousOrientedScoreOf("meanAmplitude", midBucket, { lastBucketUpper }),
    );
    for (const score of scores) {
      expect(score).not.toBeNull();
      expect(score).toBe(scores[0]);
    }
  });

  it("末桶之上的极端值被夹取在末桶区间内，不越界", () => {
    const code: TwelveFactorCode = "t1VolumeRatio";
    const k = factorDefinitionOf(code).buckets.length;
    const extreme = lastBucketLowerOf(code) * 1e9;
    const score = continuousOrientedScoreOf(code, extreme)!;
    expect(score).toBeGreaterThanOrEqual((k - 1) / k - 1e-12);
    expect(score).toBeLessThanOrEqual(k / k + 1e-12);
    expect(score).toBeLessThan(1); // 饱和映射永不抵达上沿
  });
});
