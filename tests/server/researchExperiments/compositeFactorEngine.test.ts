/**
 * COMPOSITE_FACTOR_EXPERIMENT_V1 —— 组合因子模板**装配层单元测试**。
 *
 * ## 为什么测「合成内核 + 评估 + 装配」而不是整条 `run()`
 *
 * `run()` 只是「成员解析 → 共用样本派生 → 合成分 → PIT 对拍 → 评估 → 装配」；
 * 其中样本派生由公共地基 `deriveTwelveFactorSamples()` 承担（其正确性由真实 Run 的
 * 样本账 73,003 / 70,236 把关），PIT 与逐笔对拍由 `shared/singleFactor/**` 承担。
 * 本文件专门钉住**本模板自己新增的那一层**，这些地方错了不会报错、只会静默产出错数字：
 *
 * 1. 方向**不在组合里重估**（`direction` 必须等于契约 `orientation` 推出的方向）；
 * 2. 标准化方法 `BUCKET_POSITIONAL` + 12 因子 + 等权 ⇒ 合成分必须与 12F 的
 *    `compositeScoreOf()` **逐位一致**（这是「模板没算错」的唯一可证伪判据）；
 * 3. **不插补**：缺成员 ⇒ 整条样本不可评分（不是填 0、不是跳过该成员）；
 *    ⚠️ 但「缺失」必须由**标准化结果**判定 —— `limitGap` 的 `null` 是合法 UNKNOWN 桶；
 * 4. 权重：`EQUAL` = 1/n；`CUSTOM` 的三种非法输入必须响亮失败；
 * 5. 日集 `OWN` / `FIXED` 的账（当日池 < 门槛 ⇒ 整天不纳入，且排除原因看得见）；
 * 6. 主判据符号：构造「净收益 = 合成分」的样本 ⇒ TopN 配对日度超额必须为正；
 * 7. `customPayload` 必须能通过 `compositeFactorSchema`
 *    （真实 Run 要跑十几分钟才校验 schema，一次失败等于白跑 ⇒ 必须在这里先证明一致）；
 * 8. 样本账守恒（不守恒必须抛；缺成员造成的差额必须被 `MISSING_COMPOSITE_MEMBER` 补上）；
 * 9. 4 档 × OWN 的全量逐笔与日度序列 CSV 产物确实被写出且行数正确；
 * 10. 口径确定性（同一份输入两次装配结果完全相同）。
 */

import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type {
  ExperimentArtifactFileSpec,
  ExperimentDescriptor,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  TWELVE_FACTOR_CODES,
  bucketPositionalScoreOf,
  compositeScoreOf,
  type TwelveFactorCode,
  type TwelveFactorSample,
} from "../../../research-experiments/first-board-pullback/twelve-factor-composite-study/result";
import type { TwelveFactorDerivation } from "../../../research-experiments/first-board-pullback/twelve-factor-composite-study/derive";
import { analyseComposite } from "../../../research-experiments/shared/compositeFactor/analyse";
import {
  REFERENCE_CANDIDATE_COUNT,
  REFERENCE_ELIGIBLE_COUNT,
  TRADE_PREVIEW_LIMIT,
  assembleCompositeFactorResult,
  compositeFactorSchema,
} from "../../../research-experiments/shared/compositeFactor/assemble";
import {
  FROZEN_TWELVE_FACTOR_MEMBERS,
  assertMemberDirections,
  assertMembersUsable,
  compositionBucketFingerprint,
  resolveCompositeMember,
} from "../../../research-experiments/shared/compositeFactor/members";
import {
  buildScoringPlan,
  crossSectionPercentileOf,
  orientValue,
  resolveWeights,
  scoreSamples,
  summarizeCompositeScores,
} from "../../../research-experiments/shared/compositeFactor/scoring";
import {
  COMPOSITE_COMBOS,
  COMPOSITE_FACTOR_CONTRACT_ID,
  COMPOSITE_FACTOR_EXPERIMENT_TYPE,
  COMPOSITE_FACTOR_TEMPLATE_ID,
  COMPOSITE_TOP_N_SIZES,
  DAY_SCOPES,
  defineCompositeTemplateSpec,
  type CompositeMemberSpec,
} from "../../../research-experiments/shared/compositeFactor/types";
import {
  ENTRY_DAY,
  EXIT_RELATIVE_DAY,
  ROUND_TRIP_COST_BPS,
} from "../../../research-experiments/shared/singleFactor/coordinate";
import {
  OBSERVATION_RELATIVE_DAYS,
  PIT_INFORMATION_CUTOFF_RELATIVE_DAY,
  type SingleFactorSample,
} from "../../../research-experiments/shared/singleFactor/types";

const COST = ROUND_TRIP_COST_BPS / 10_000;
const DATES = ["2025-01-06", "2025-01-07", "2025-01-08"] as const;
const PER_DAY = 12;

/** 落在 turnover 的 6 个桶（<1 / <2 / <3 / <5 / <10 / ≥10）里。 */
const TURNOVER_VALUES = [0.5, 1.5, 2.5, 4, 7, 15] as const;
/** 落在 amountPercentile 的 5 个分位桶里（本 fixture 只用到前两个）。 */
const AMOUNT_VALUES = [0.05, 0.3] as const;

const MEMBER_SPECS: readonly CompositeMemberSpec[] = FROZEN_TWELVE_FACTOR_MEMBERS.map(
  member => ({
    code: member.code,
    direction: member.direction,
    orientation: member.orientation,
  })
);

const MEMBERS = MEMBER_SPECS.map(resolveCompositeMember);

const SPEC = defineCompositeTemplateSpec({
  members: MEMBER_SPECS,
  normalization: "BUCKET_POSITIONAL",
  weighting: { mode: "EQUAL" },
});

/**
 * 12 因子基线值：除 turnover / amountPercentile 外的 10 个因子固定在确定的桶里
 * （每个 `bucketOf` 都有兜底分支 ⇒ 任何有限数都落在某个桶）。
 */
function baseFactors(): Record<TwelveFactorCode, number | null> {
  const factors = {} as Record<TwelveFactorCode, number | null>;
  for (const code of TWELVE_FACTOR_CODES) factors[code] = 1;
  factors.bodyHeight = 0.03;
  factors.meanAmplitude = 0.05;
  factors.maxAmplitude = 0.1;
  factors.holdStreak = 2;
  factors.t1VolumeRatio = 1;
  factors.limitGap = 10;
  factors.preReturn10 = 0.02;
  factors.drawdownDepth = -0.03;
  factors.t1OpenGap = 0.02;
  factors.historyLimitCount = 3;
  return factors;
}

/**
 * 构造「净收益 = 合成分」的样本：同日横截面上合成分高的样本净收益一定高
 * ⇒ TopN 的超额必然为正、日胜率必然为 1，且断言不依赖任何桶边界的具体取值。
 */
function buildSamples(
  dates: readonly string[] = DATES,
  perDay: number = PER_DAY
): TwelveFactorSample[] {
  const samples: TwelveFactorSample[] = [];
  for (const date of dates) {
    for (let index = 0; index < perDay; index += 1) {
      const factors = baseFactors();
      factors.turnover =
        TURNOVER_VALUES[index % TURNOVER_VALUES.length] as number;
      factors.amountPercentile = AMOUNT_VALUES[
        Math.floor(index / TURNOVER_VALUES.length) % AMOUNT_VALUES.length
      ] as number;
      const score = compositeScoreOf(factors, TWELVE_FACTOR_CODES);
      expect(score).not.toBeNull();
      samples.push({
        eventId: `${date}-${String(index).padStart(2, "0")}`,
        eventDate: date,
        year: Number(date.slice(0, 4)),
        entryOpen: 10,
        exitPrice: 10 * (1 + score! + COST),
        netReturn: score!,
        mfe: 0.05,
        mae: -0.05,
        factors,
      });
    }
  }
  return samples;
}

function planOf(samples: readonly TwelveFactorSample[]) {
  return buildScoringPlan({
    members: MEMBERS,
    normalization: SPEC.normalization,
    weighting: SPEC.weighting,
    samples,
  });
}

/** 把「已评分样本」变成单因子引擎认得的排序输入（排序键 = 合成分）。 */
function rankableOf(
  scored: readonly { readonly sample: TwelveFactorSample; readonly compositeScore: number }[]
): SingleFactorSample[] {
  return scored.map(item => ({
    eventId: item.sample.eventId,
    stockCode: `600${item.sample.eventId.slice(-2)}.SH`,
    eventDate: item.sample.eventDate,
    signalDate: `${item.sample.eventDate}#T+${PIT_INFORMATION_CUTOFF_RELATIVE_DAY}`,
    entryDate: `${item.sample.eventDate}#T+${ENTRY_DAY}`,
    exitDate: `${item.sample.eventDate}#T+${EXIT_RELATIVE_DAY}`,
    entryRelativeDay: ENTRY_DAY,
    exitRelativeDay: EXIT_RELATIVE_DAY,
    holdingDays: EXIT_RELATIVE_DAY - ENTRY_DAY + 1,
    entryPrice: item.sample.entryOpen,
    exitPrice: item.sample.exitPrice,
    grossReturn: item.sample.netReturn + COST,
    cost: COST,
    costBps: ROUND_TRIP_COST_BPS,
    netReturn: item.sample.netReturn,
    year: item.sample.year,
    factorValue: item.compositeScore,
  }));
}

function derivationOf(
  samples: readonly TwelveFactorSample[],
  options: {
    readonly excludedByReason?: Record<string, number>;
    readonly candidateCount?: number;
  } = {}
): TwelveFactorDerivation {
  const excludedByReason = options.excludedByReason ?? { MISSING_PREFIX_PATH: 5 };
  const explained = Object.values(excludedByReason).reduce(
    (sum, value) => sum + value,
    0
  );
  const candidateCount = options.candidateCount ?? samples.length + explained;
  return {
    samples: [...samples],
    universeFacts: new Map(),
    candidateCount,
    exactLimitUpCloseCount: candidateCount,
    excludedByReason,
    factorMissingByCode: {},
    datasetEventCount: candidateCount,
    unscannedEventCount: 0,
    duplicateEventIdCount: 0,
    crossSectionPeerCount: samples.length,
    prefixWindowMissingCount: excludedByReason.MISSING_PREFIX_PATH ?? 0,
  };
}

function fakeContext(
  artifacts: ExperimentArtifactFileSpec[]
): ExperimentRunContext {
  const descriptor: ExperimentDescriptor = {
    id: "first-board-pullback/composite-factor-equal-weight-study",
    name: "composite factor test",
    version: "1.0.0",
    description: "test",
    source: "test",
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: { events: [], feature: [], observation: [] },
      decisionOffsetDays: null,
      usesForwardData: true,
    },
    pageKey: "first-board-pullback/composite-factor-equal-weight-study",
    pageTitle: "composite factor test",
  };
  return {
    descriptor,
    codeDigest: "exp-code-sha256:test",
    protocol: null,
    parameters: {},
    dataset: {
      facts: {
        datasetVersionId: 660001,
        datasetCode: "first_limit_pullback",
        datasetName: "首板回踩",
        datasetVersionLabel: "v5",
        status: "READY",
        startDate: "2019-01-01",
        endDate: "2026-09-04",
        totalEvents: 0,
        postRelativeDayRange: { min: 1, max: 20 },
      },
      async events() {
        return [];
      },
      async *eventPages() {
        yield [];
      },
      async feature() {
        return [];
      },
      async observation() {
        return [];
      },
    },
    datasets: {},
    freezeSelection() {},
    log() {},
    artifact(spec) {
      artifacts.push(spec);
    },
  };
}

interface Fixture {
  readonly samples: TwelveFactorSample[];
  readonly scored: ReturnType<typeof scoreSamples>;
  readonly rankable: SingleFactorSample[];
  readonly analysis: ReturnType<typeof analyseComposite>;
  readonly derivation: TwelveFactorDerivation;
  readonly artifacts: ExperimentArtifactFileSpec[];
  readonly payload: ReturnType<typeof assembleCompositeFactorResult>;
  readonly custom: ReturnType<typeof compositeFactorSchema.parse>;
}

function buildFixture(): Fixture {
  const samples = buildSamples();
  const plan = planOf(samples);
  const scored = scoreSamples({ plan, samples });
  const rankable = rankableOf(scored.scored);
  const analysis = analyseComposite({
    rankable,
    combos: COMPOSITE_COMBOS.map(combo => ({
      id: combo.id,
      size: combo.size,
      label: combo.label,
    })),
    dayScopes: SPEC.dayScopes,
    fixedDayMinSize: Math.max(...SPEC.topNSizes),
  });
  const derivation = derivationOf(samples);
  const artifacts: ExperimentArtifactFileSpec[] = [];
  const payload = assembleCompositeFactorResult({
    context: fakeContext(artifacts),
    spec: SPEC,
    members: MEMBERS,
    weighting: plan.weighting,
    scored: scored.scored,
    compositeSummary: summarizeCompositeScores(
      scored.scored.map(item => item.compositeScore)
    ),
    missingByMember: scored.missingByMember,
    derivation,
    analysis,
    coordinate: {
      entryDay: ENTRY_DAY,
      exitRelativeDay: EXIT_RELATIVE_DAY,
      roundTripCostBps: ROUND_TRIP_COST_BPS,
      decisionOffsetDays: ENTRY_DAY - 1,
      informationCutoffRelativeDay: PIT_INFORMATION_CUTOFF_RELATIVE_DAY,
      observationRelativeDays: OBSERVATION_RELATIVE_DAYS,
    },
    rankedKey: "composite",
    normalizationLabel: "冻结桶位分 (idx+0.5)/k（FROZEN-BUCKET-CONTRACT-001 §3.1）",
    normalizationDisclosure: "test",
    bucketFingerprint: compositionBucketFingerprint(MEMBERS),
  });
  return {
    samples,
    scored,
    rankable,
    analysis,
    derivation,
    artifacts,
    payload,
    custom: compositeFactorSchema.parse(payload.customPayload),
  };
}

describe("composite-factor-v1 · 模板身份与档位枚举", () => {
  it("模板 / 实验类型 / 契约编号三件套与需求逐字一致", () => {
    expect(COMPOSITE_FACTOR_TEMPLATE_ID).toBe("COMPOSITE_FACTOR_EXPERIMENT_V1");
    expect(COMPOSITE_FACTOR_EXPERIMENT_TYPE).toBe("COMPOSITE_FACTOR");
    expect(COMPOSITE_FACTOR_CONTRACT_ID).toBe("CF-V1-001");
    expect(SPEC.templateId).toBe(COMPOSITE_FACTOR_TEMPLATE_ID);
    expect(SPEC.experimentType).toBe(COMPOSITE_FACTOR_EXPERIMENT_TYPE);
    expect(SPEC.contractId).toBe(COMPOSITE_FACTOR_CONTRACT_ID);
  });

  it("TopN 档位 = 3/5/10/20，且档位只有 TopN 一维（方向已进入成员贡献）", () => {
    expect(COMPOSITE_TOP_N_SIZES).toEqual([3, 5, 10, 20]);
    expect(COMPOSITE_COMBOS.map(combo => combo.id)).toEqual([
      "N3",
      "N5",
      "N10",
      "N20",
    ]);
    expect(COMPOSITE_COMBOS.map(combo => combo.size)).toEqual([3, 5, 10, 20]);
    expect(SPEC.topNSizes).toEqual([3, 5, 10, 20]);
    expect(SPEC.dayScopes).toEqual(["OWN", "FIXED"]);
    expect(DAY_SCOPES).toEqual(["OWN", "FIXED"]);
  });

  it("不传 topNSizes / dayScopes 时由模板补默认值（新增实验不必重复声明）", () => {
    const minimal = defineCompositeTemplateSpec({
      members: MEMBER_SPECS,
      normalization: "BUCKET_POSITIONAL",
      weighting: { mode: "EQUAL" },
    });
    expect(minimal.topNSizes).toEqual(COMPOSITE_TOP_N_SIZES);
    expect(minimal.dayScopes).toEqual(DAY_SCOPES);
  });
});

describe("composite-factor-v1 · 成员适配器（不修改 12 因子定义）", () => {
  it("12 个冻结因子全部可解析成成员，且方向与契约 orientation 一一对应", () => {
    expect(FROZEN_TWELVE_FACTOR_MEMBERS.length).toBe(12);
    expect(new Set(FROZEN_TWELVE_FACTOR_MEMBERS.map(m => m.code)).size).toBe(12);
    for (const member of FROZEN_TWELVE_FACTOR_MEMBERS) {
      expect(resolveCompositeMember({ code: member.code, direction: member.direction })).toBe(
        member
      );
      expect(member.direction).toBe(member.orientation === 1 ? "HIGH" : "LOW");
      expect(member.contractFingerprint.startsWith("fnv1a32:")).toBe(true);
      expect(member.valueOf).toBeTypeOf("function");
      expect(member.bucketScoreOf).not.toBeNull();
    }
  });

  it("方向一致性校验：原样通过；把方向掰过来 ⇒ 响亮失败（方向不允许重估）", () => {
    expect(() => assertMemberDirections(MEMBERS)).not.toThrow();
    const tampered = MEMBERS.map((member, index) =>
      index === 0
        ? { ...member, direction: member.direction === "HIGH" ? "LOW" : "HIGH" }
        : member
    );
    expect(() => assertMemberDirections(tampered as typeof MEMBERS)).toThrow(
      /方向与冻结契约不一致/u
    );
  });

  it("未登记的成员 code 响亮失败", () => {
    expect(() =>
      resolveCompositeMember({ code: "no_such_factor", direction: "HIGH" })
    ).toThrow(/未登记的成员/u);
  });

  it("成员集合可用性：重复成员失败；无桶词表 + BUCKET_POSITIONAL 失败（不是静默跳过）", () => {
    const first = MEMBERS[0]!;
    expect(() => assertMembersUsable([first, first], "BUCKET_POSITIONAL")).toThrow(
      /成员重复/u
    );
    const noBuckets = { ...first, bucketScoreOf: null };
    expect(() => assertMembersUsable([noBuckets], "BUCKET_POSITIONAL")).toThrow(
      /需要冻结桶词表/u
    );
    // 换成横截面百分位就不再需要桶词表
    expect(() =>
      assertMembersUsable([noBuckets], "CROSS_SECTION_PERCENTILE")
    ).not.toThrow();
    expect(() => assertMembersUsable([], "BUCKET_POSITIONAL")).toThrow(
      /至少需要一个成员/u
    );
  });

  it("成员桶指纹只覆盖契约字段（code|orientation|priorVerified|buckets）且与书写顺序无关", () => {
    const forward = compositionBucketFingerprint(MEMBERS);
    // ① 与书写顺序无关（按 code 排序后规范化）
    expect(compositionBucketFingerprint([...MEMBERS].reverse())).toBe(forward);
    // ② 桶词表一改就变
    const withExtraBucket = compositionBucketFingerprint([
      { ...MEMBERS[0]!, buckets: [...MEMBERS[0]!.buckets, "EXTRA"] },
      ...MEMBERS.slice(1),
    ]);
    expect(withExtraBucket).not.toBe(forward);
    // ③ orientation 一改就变
    const first = MEMBERS[0]!;
    const flippedOrientation = compositionBucketFingerprint([
      {
        ...first,
        orientation: first.orientation === 1 ? -1 : 1,
        direction: first.orientation === 1 ? "LOW" : "HIGH",
      },
      ...MEMBERS.slice(1),
    ]);
    expect(flippedOrientation).not.toBe(forward);
    // ④ 只掰 direction（orientation 不变）不改指纹 —— 因为这种成员本来就会被
    //    `assertMemberDirections` 拒绝，指纹无需为「不可能存在的成员」负责
    expect(
      compositionBucketFingerprint([
        { ...first, direction: first.direction === "HIGH" ? "LOW" : "HIGH" },
        ...MEMBERS.slice(1),
      ])
    ).toBe(forward);
  });
});

describe("composite-factor-v1 · 合成内核", () => {
  const samples = buildSamples();
  const plan = planOf(samples);
  const outcome = scoreSamples({ plan, samples });

  it("🔴 BUCKET_POSITIONAL + 12 因子 + 等权 ⇒ 合成分与 12F 的 compositeScoreOf 逐位一致", () => {
    expect(outcome.scored.length).toBe(samples.length);
    expect(outcome.unscorableCount).toBe(0);
    for (const item of outcome.scored) {
      const expected = compositeScoreOf(item.sample.factors, TWELVE_FACTOR_CODES);
      expect(expected).not.toBeNull();
      // **逐位**相等（不是「近似」）：等权走 `(Σ x)/n`，与 12F 的浮点路径完全相同。
      // 若有人把等权改回 `Σ (1/n)·x`，这里立刻红 —— 那一改动会让 TopN 边界上的
      // 同值 tie-break 换一批股票，进而使两个实验的点估计无法逐位对拍。
      expect(item.compositeScore).toBe(expected!);
    }
  });

  it("合成分可被第三方逐项复算：Σ w·oriented === compositeScore", () => {
    for (const item of outcome.scored) {
      let sum = 0;
      for (const contribution of item.contributions) {
        expect(contribution.oriented).not.toBeNull();
        sum += contribution.weight * contribution.oriented!;
      }
      expect(sum).toBeCloseTo(item.compositeScore, 12);
    }
  });

  it("方向调整语义：HIGH 保持、LOW 取 1 − x", () => {
    expect(orientValue(0.25, "HIGH")).toBe(0.25);
    expect(orientValue(0.25, "LOW")).toBe(0.75);
    expect(orientValue(1, "LOW")).toBe(0);
  });

  it("等权：每个成员 1/12，Σ = 1（权重与成员个数无关）", () => {
    const weighting = resolveWeights({ members: MEMBERS, weighting: { mode: "EQUAL" } });
    expect(weighting.weights.size).toBe(12);
    for (const value of weighting.weights.values()) {
      expect(value).toBeCloseTo(1 / 12, 12);
    }
    expect([...weighting.weights.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("自定义权重（已预留）：合法输入被归一化到 Σ = 1", () => {
    const weights: Record<string, number> = {};
    for (const code of TWELVE_FACTOR_CODES) weights[code] = 1;
    weights.turnover = 3;
    const resolved = resolveWeights({
      members: MEMBERS,
      weighting: { mode: "CUSTOM", weights },
    });
    expect(resolved.weights.get("turnover")).toBeCloseTo(3 / 14, 12);
    expect(resolved.weights.get("bodyHeight")).toBeCloseTo(1 / 14, 12);
    expect([...resolved.weights.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(resolved.disclosure).toContain("自定义权重");
  });

  it("自定义权重的四种非法输入全部响亮失败（不做静默兜底）", () => {
    const full = (): Record<string, number> => {
      const weights: Record<string, number> = {};
      for (const code of TWELVE_FACTOR_CODES) weights[code] = 1;
      return weights;
    };
    const missing = full();
    delete missing.turnover;
    expect(() =>
      resolveWeights({ members: MEMBERS, weighting: { mode: "CUSTOM", weights: missing } })
    ).toThrow(/缺少权重/u);

    expect(() =>
      resolveWeights({
        members: MEMBERS,
        weighting: { mode: "CUSTOM", weights: { ...full(), ghost: 1 } },
      })
    ).toThrow(/未登记成员/u);

    expect(() =>
      resolveWeights({
        members: MEMBERS,
        weighting: { mode: "CUSTOM", weights: { ...full(), turnover: 0 } },
      })
    ).toThrow(/有限正数/u);

    expect(() =>
      resolveWeights({
        members: MEMBERS,
        weighting: { mode: "CUSTOM", weights: { ...full(), turnover: Number.NaN } },
      })
    ).toThrow(/有限正数/u);
  });

  it("🔴 不插补：成员不可评估 ⇒ 整条样本不可评分，并逐成员登记原因", () => {
    const broken = buildSamples().map((sample, index) =>
      index === 0
        ? { ...sample, factors: { ...sample.factors, bodyHeight: null } }
        : sample
    );
    const brokenOutcome = scoreSamples({ plan: planOf(broken), samples: broken });
    expect(brokenOutcome.scored.length).toBe(broken.length - 1);
    expect(brokenOutcome.unscorableCount).toBe(1);
    expect(brokenOutcome.missingByMember.bodyHeight).toBe(1);
    expect(brokenOutcome.scored.some(item => item.sample.eventId === broken[0]!.eventId)).toBe(
      false
    );
  });

  it("🔴 缺失由「标准化结果」判定：limitGap 的 null 是合法 UNKNOWN 桶，不算缺失", () => {
    const withUnknown = buildSamples().map((sample, index) =>
      index === 0
        ? { ...sample, factors: { ...sample.factors, limitGap: null } }
        : sample
    );
    const scoredOutcome = scoreSamples({
      plan: planOf(withUnknown),
      samples: withUnknown,
    });
    expect(scoredOutcome.unscorableCount).toBe(0);
    expect(scoredOutcome.missingByMember).toEqual({});
    const first = scoredOutcome.scored.find(
      item => item.sample.eventId === withUnknown[0]!.eventId
    )!;
    const limitGapContribution = first.contributions.find(c => c.code === "limitGap")!;
    // 原始值是 null，但标准化结果是一个真实的桶位分 ⇒ 这一条正是「不插补」的边界
    expect(limitGapContribution.rawValue).toBeNull();
    expect(limitGapContribution.normalized).toBe(
      bucketPositionalScoreOf("limitGap", null)
    );
    expect(limitGapContribution.normalized).not.toBeNull();
    // 与 12F 的评分口径必须一致（同一份桶位分、同一条浮点路径）
    expect(first.compositeScore).toBe(
      compositeScoreOf(withUnknown[0]!.factors, TWELVE_FACTOR_CODES)!
    );
  });

  it("CROSS_SECTION_PERCENTILE：原始值为 null ⇒ 不可评估（该方法没有 UNKNOWN 桶）", () => {
    const samplesWithNull = buildSamples().map((sample, index) =>
      index === 0
        ? { ...sample, factors: { ...sample.factors, turnover: null } }
        : sample
    );
    const pctPlan = buildScoringPlan({
      members: MEMBERS,
      normalization: "CROSS_SECTION_PERCENTILE",
      weighting: { mode: "EQUAL" },
      samples: samplesWithNull,
    });
    const pctOutcome = scoreSamples({ plan: pctPlan, samples: samplesWithNull });
    expect(pctOutcome.unscorableCount).toBe(1);
    expect(pctOutcome.missingByMember.turnover).toBe(1);
    expect(pctOutcome.scored.length).toBe(samplesWithNull.length - 1);
  });

  it("横截面百分位小件：count(peer ≤ v)/N，自身计入分母", () => {
    expect(crossSectionPercentileOf(5, [1, 5, 9, 5])).toBeCloseTo(0.75, 12);
    expect(crossSectionPercentileOf(1, [1])).toBe(1);
    expect(crossSectionPercentileOf(1, [])).toBeNull();
  });

  it("合成分分布摘要：全部落在 (0, 1) 开区间内", () => {
    const summary = summarizeCompositeScores(
      outcome.scored.map(item => item.compositeScore)
    );
    expect(summary.count).toBe(samples.length);
    expect(summary.min!).toBeGreaterThan(0);
    expect(summary.max!).toBeLessThan(1);
    expect(summary.mean!).toBeGreaterThan(summary.min!);
    expect(summary.mean!).toBeLessThan(summary.max!);
    expect(summarizeCompositeScores([]).count).toBe(0);
  });
});

describe("composite-factor-v1 · 评估层（日集与主判据）", () => {
  const fixture = buildFixture();
  const { custom } = fixture;

  it("日集 OWN：N3/N5/N10 纳入全部 3 日并按当日池取头；N20 在 12 只的池上整天排除", () => {
    const own = (size: string) =>
      custom.topn.find(row => row.comboId === size && row.scope === "OWN")!;
    expect(own("N3").daysIncluded).toBe(DATES.length);
    expect(own("N3").metrics.tradeCount).toBe(DATES.length * 3);
    expect(own("N5").metrics.tradeCount).toBe(DATES.length * 5);
    expect(own("N10").metrics.tradeCount).toBe(DATES.length * 10);
    // 当日池 12 只 < 20 ⇒ 整天不纳入（不是「有几只算几只」）
    expect(own("N20").daysIncluded).toBe(0);
    expect(own("N20").daysExcludedSmall).toBe(DATES.length);
    expect(own("N20").metrics.tradeCount).toBe(0);
    // 档位仍然在结果里（不静默丢弃）
    expect(custom.topn.length).toBe(COMPOSITE_TOP_N_SIZES.length * DAY_SCOPES.length);
  });

  it("日集 FIXED：统一门槛 = 最大档 N（= 20）⇒ 本 fixture 下全部排除，账看得见", () => {
    const fixed = custom.topn.filter(row => row.scope === "FIXED");
    expect(fixed.length).toBe(COMPOSITE_TOP_N_SIZES.length);
    for (const row of fixed) {
      expect(row.daysIncluded).toBe(0);
      expect(row.daysExcludedSmall).toBe(DATES.length);
    }
  });

  it("主判据符号：净收益 = 合成分 ⇒ TopN 配对日度超额为正、日胜率 = 1、反转侧为负", () => {
    for (const size of ["N3", "N5", "N10"]) {
      const row = custom.excess.find(
        excess => excess.comboId === size && excess.scope === "OWN"
      )!;
      expect(row.daysIncluded).toBe(DATES.length);
      expect(row.excessMean!).toBeGreaterThan(0);
      expect(row.excessCi95Low!).toBeGreaterThan(0);
      expect(row.dayWinRate).toBe(1);
      // 日数 < 100 ⇒ 只允许 INSUFFICIENT，不能在小样本上给 POSITIVE
      expect(row.verdict).toBe("INSUFFICIENT");
    }
  });

  it("基准 = 当日池等权：N3 与 N10 的当日池日均同值（同日集、同池）", () => {
    const n3 = custom.benchmark.find(
      row => row.comboId === "N3" && row.scope === "OWN"
    )!;
    const n10 = custom.benchmark.find(
      row => row.comboId === "N10" && row.scope === "OWN"
    )!;
    expect(n3.daysIncluded).toBe(DATES.length);
    expect(n3.benchmarkMean!).toBeCloseTo(n10.benchmarkMean!, 12);
    expect(n3.simulations).toBe(1_000);
    // 组合日均高于随机抽签的 P50（因为收益与合成分单调）
    expect(n3.randomP50!).toBeLessThan(n3.benchmarkMean! + 1e-9);
  });

  it("时间切片 = 按年（本 fixture 只有 1 年）", () => {
    expect(custom.timeSlice.length).toBe(1 * COMPOSITE_TOP_N_SIZES.length);
    for (const row of custom.timeSlice) {
      expect(row.year).toBe(2025);
      expect(row.daysIncluded).toBeLessThanOrEqual(DATES.length);
    }
  });

  it("决策日诊断：3 个决策日、每日 12 只", () => {
    expect(custom.dayDiagnostics.daysTotal).toBe(DATES.length);
    expect(custom.dayDiagnostics.daysAtLeast3).toBe(DATES.length);
    expect(custom.dayDiagnostics.daysAtLeast10).toBe(DATES.length);
    expect(custom.dayDiagnostics.daysAtLeast20).toBe(0);
    expect(custom.dayDiagnostics.daySizeP50).toBe(PER_DAY);
    expect(custom.dayDiagnostics.daySizeMax).toBe(PER_DAY);
  });

  it("评估层不引入新交易逻辑：每笔都过成本恒等式（gross − cost === net）", () => {
    for (const evaluation of fixture.analysis.evaluations) {
      for (const trade of evaluation.result.trades) {
        expect(
          Math.abs(trade.grossReturn - trade.cost - trade.netReturn)
        ).toBeLessThan(1e-12);
        expect(trade.costBps).toBe(ROUND_TRIP_COST_BPS);
        expect(trade.holdingDays).toBe(EXIT_RELATIVE_DAY - ENTRY_DAY + 1);
      }
    }
  });

  it("Overall = 全样本等权（不做任何选择）：3 日 × 12 笔", () => {
    expect(custom.overall.daysIncluded).toBe(DATES.length);
    expect(custom.overall.trades).toBe(DATES.length * PER_DAY);
  });
});

describe("composite-factor-v1 · 装配层", () => {
  const fixture = buildFixture();
  const { custom, payload } = fixture;

  it("customPayload 通过 compositeFactorSchema（真实 Run 的 schema 校验前置到这里）", () => {
    expect(custom.templateId).toBe(COMPOSITE_FACTOR_TEMPLATE_ID);
    expect(custom.experimentType).toBe(COMPOSITE_FACTOR_EXPERIMENT_TYPE);
    expect(custom.contractId).toBe(COMPOSITE_FACTOR_CONTRACT_ID);
    expect(custom.composition.memberCount).toBe(12);
    expect(custom.composition.equalWeight).toBe(true);
    expect(custom.composition.weightSum).toBeCloseTo(1, 12);
    expect(custom.composition.fingerprint.startsWith("fnv1a32:")).toBe(true);
    expect(custom.composition.members.length).toBe(12);
    expect(custom.normalization.method).toBe("BUCKET_POSITIONAL");
    expect(custom.normalization.bucketContractId).toBe("FROZEN-BUCKET-CONTRACT-001");
    expect(custom.normalization.bucketFingerprint.startsWith("fnv1a32:")).toBe(true);
    expect(custom.ranking.direction).toBe("HIGH");
    expect(custom.ranking.topNSizes).toEqual([3, 5, 10, 20]);
    expect(custom.ranking.fixedDayMinSize).toBe(20);
    expect(custom.coordinate.entryDay).toBe(ENTRY_DAY);
    expect(custom.coordinate.exitRelativeDay).toBe(EXIT_RELATIVE_DAY);
    expect(custom.coordinate.roundTripCostBps).toBe(ROUND_TRIP_COST_BPS);
    expect(custom.disclosures.length).toBeGreaterThanOrEqual(10);
  });

  it("引擎版本与方向披露：3 个先验未验证因子被如实写进成员表", () => {
    const unverified = custom.composition.members.filter(m => !m.priorVerified);
    expect(unverified.length).toBeGreaterThan(0);
    for (const member of unverified) {
      expect(custom.disclosures.join("\n")).toContain("先验未验证");
    }
    expect(custom.computationVersion).toBe("1.0.0");
  });

  it("样本账平：candidate = eligible + excluded，且逐因原因合计相等", () => {
    const summary = payload.sampleSummary;
    expect(summary.candidateCount).toBe(fixture.derivation.candidateCount);
    expect(summary.eligibleCount).toBe(fixture.samples.length);
    expect(summary.excludedCount).toBe(5);
    expect(
      Object.values(summary.excludedByReason).reduce((a, b) => a + b, 0)
    ).toBe(5);
    expect(custom.sampleAccounting.completeCaseCount).toBe(fixture.samples.length);
    expect(custom.sampleAccounting.eligibleCount).toBe(fixture.scored.scored.length);
  });

  it("缺成员造成的差额被 MISSING_COMPOSITE_MEMBER 补上（不是悄悄消失）", () => {
    const samples = buildSamples().map((sample, index) =>
      index < 2
        ? { ...sample, factors: { ...sample.factors, bodyHeight: null } }
        : sample
    );
    const plan = planOf(samples);
    const scored = scoreSamples({ plan, samples });
    const analysis = analyseComposite({
      rankable: rankableOf(scored.scored),
      combos: COMPOSITE_COMBOS.map(combo => ({
        id: combo.id,
        size: combo.size,
        label: combo.label,
      })),
      dayScopes: SPEC.dayScopes,
      fixedDayMinSize: 20,
    });
    const artifacts: ExperimentArtifactFileSpec[] = [];
    const partial = assembleCompositeFactorResult({
      context: fakeContext(artifacts),
      spec: SPEC,
      members: MEMBERS,
      weighting: plan.weighting,
      scored: scored.scored,
      compositeSummary: summarizeCompositeScores(
        scored.scored.map(item => item.compositeScore)
      ),
      missingByMember: scored.missingByMember,
      derivation: derivationOf(samples),
      analysis,
      coordinate: {
        entryDay: ENTRY_DAY,
        exitRelativeDay: EXIT_RELATIVE_DAY,
        roundTripCostBps: ROUND_TRIP_COST_BPS,
        decisionOffsetDays: ENTRY_DAY - 1,
        informationCutoffRelativeDay: PIT_INFORMATION_CUTOFF_RELATIVE_DAY,
        observationRelativeDays: OBSERVATION_RELATIVE_DAYS,
      },
      rankedKey: "composite",
      normalizationLabel: "冻结桶位分",
      normalizationDisclosure: "test",
      bucketFingerprint: compositionBucketFingerprint(MEMBERS),
    });
    const partialCustom = compositeFactorSchema.parse(partial.customPayload);
    expect(scored.unscorableCount).toBe(2);
    expect(partialCustom.sampleAccounting.eligibleCount).toBe(samples.length - 2);
    expect(partialCustom.sampleAccounting.excludedByReason.MISSING_COMPOSITE_MEMBER).toBe(2);
    expect(
      partialCustom.sampleAccounting.excludedCount -
        Object.values(partialCustom.sampleAccounting.excludedByReason).reduce(
          (a, b) => a + b,
          0
        )
    ).toBe(0);
    // 逐成员缺失诊断（不依赖剔除计数）
    expect(partialCustom.sampleAccounting.missingByMember.bodyHeight).toBe(2);
  });

  it("样本账不守恒时立刻抛错（不允许悄悄产出一份对不上的结果）", () => {
    const samples = buildSamples();
    const plan = planOf(samples);
    const scored = scoreSamples({ plan, samples });
    const analysis = analyseComposite({
      rankable: rankableOf(scored.scored),
      combos: COMPOSITE_COMBOS.map(combo => ({
        id: combo.id,
        size: combo.size,
        label: combo.label,
      })),
      dayScopes: SPEC.dayScopes,
      fixedDayMinSize: 20,
    });
    const artifacts: ExperimentArtifactFileSpec[] = [];
    expect(() =>
      assembleCompositeFactorResult({
        context: fakeContext(artifacts),
        spec: SPEC,
        members: MEMBERS,
        weighting: plan.weighting,
        scored: scored.scored,
        compositeSummary: summarizeCompositeScores(
          scored.scored.map(item => item.compositeScore)
        ),
        missingByMember: scored.missingByMember,
        derivation: derivationOf(samples, {
          excludedByReason: { MISSING_PREFIX_PATH: 99 },
          // 候选数固定为 36 + 5 ⇒ 剔除应为 5，而逐因合计 99 ⇒ 必须抛错
          candidateCount: samples.length + 5,
        }),
        analysis,
        coordinate: {
          entryDay: ENTRY_DAY,
          exitRelativeDay: EXIT_RELATIVE_DAY,
          roundTripCostBps: ROUND_TRIP_COST_BPS,
          decisionOffsetDays: ENTRY_DAY - 1,
          informationCutoffRelativeDay: PIT_INFORMATION_CUTOFF_RELATIVE_DAY,
          observationRelativeDays: OBSERVATION_RELATIVE_DAYS,
        },
        rankedKey: "composite",
        normalizationLabel: "冻结桶位分",
        normalizationDisclosure: "test",
        bucketFingerprint: compositionBucketFingerprint(MEMBERS),
      })
    ).toThrow(/样本账不守恒/u);
  });

  it("六段结果齐备且行数正确（定义 / Overall / TopN / Excess / Benchmark / 切片 / 日诊断 / 逐笔）", () => {
    const tables = payload.tables ?? [];
    const of = (key: string) => tables.find(table => table.key === key)!;
    expect(of("cf_composition").rows.length).toBe(12);
    expect(of("cf_overall").rows.length).toBe(1);
    expect(of("cf_topn").rows.length).toBe(8);
    expect(of("cf_excess").rows.length).toBe(8);
    expect(of("cf_benchmark").rows.length).toBe(8);
    expect(of("cf_time_slice").rows.length).toBe(4);
    expect(of("cf_day_size").rows.length).toBe(8);
    // 逐笔预览 = 各 OWN 档取 min(100, 笔数)：9 + 15 + 30 + 0
    expect(of("cf_trades_preview").rows.length).toBe(54);
    expect(TRADE_PREVIEW_LIMIT).toBe(100);
  });

  it("逐笔预览字段齐全（含当日名次 / 当日池 / 合成分）", () => {
    const rows = (payload.tables ?? []).find(
      table => table.key === "cf_trades_preview"
    )!.rows;
    const first = rows[0]!;
    for (const field of [
      "sizeLabel",
      "rank",
      "poolSize",
      "stockCode",
      "eventDate",
      "entryDate",
      "exitDate",
      "compositeScore",
      "holdingDays",
      "grossReturn",
      "netReturn",
    ]) {
      expect(Object.keys(first)).toContain(field);
      expect(first[field]).not.toBeUndefined();
    }
    expect(first.poolSize).toBe(PER_DAY);
    expect(rows.find(row => row.rank === 1 && row.sizeLabel === "Top-10")).toBeDefined();
  });

  it("统计段：决策日总数 + 合成分中位 + 四档 OWN 超额（主判据）", () => {
    const statistics = payload.statistics ?? [];
    const codes = statistics.map(stat => stat.code);
    expect(codes).toContain("decision_day_count");
    expect(codes).toContain("composite_score_p50");
    for (const size of ["n3", "n5", "n10", "n20"]) {
      expect(codes).toContain(`excess_${size}`);
    }
    expect(statistics.length).toBe(2 + COMPOSITE_TOP_N_SIZES.length);
  });

  it("全量逐笔与日度序列 CSV 产物被写出（每 OWN 档 2 个文件，行数与 tradeCount 一致）", () => {
    const ownCount = custom.topn.filter(row => row.scope === "OWN").length;
    expect(fixture.artifacts.length).toBe(ownCount * 2);
    expect(custom.trades.artifactNames.length).toBe(ownCount * 2);
    for (const spec of fixture.artifacts) {
      expect(spec.contentType).toBe("application/gzip");
      expect(spec.name.endsWith(".csv.gz")).toBe(true);
    }
    const tradeArtifact = fixture.artifacts.find(spec =>
      spec.name.includes("trades-n3-own")
    )!;
    const text = gunzipSync(Buffer.from(tradeArtifact.body as Uint8Array)).toString(
      "utf8"
    );
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toContain("compositeScore");
    expect(lines[0]).toContain("netReturn");
    expect(lines.length - 1).toBe(DATES.length * 3);

    const seriesArtifact = fixture.artifacts.find(spec =>
      spec.name.includes("daily-n3-own")
    )!;
    const seriesText = gunzipSync(
      Buffer.from(seriesArtifact.body as Uint8Array)
    ).toString("utf8");
    expect(seriesText.split("\n")[0]).toBe("event_date,portfolio_net_return");
    expect(seriesText.trimEnd().split("\n").length - 1).toBe(DATES.length);
  });

  it("逐笔索引与产物清单一致：OWN 档有预览行、FIXED 档为 0", () => {
    for (const row of custom.trades.index) {
      const evaluation = fixture.analysis.evaluations.find(
        item => item.comboId === row.comboId && item.scope === row.scope
      )!;
      expect(row.tradeCount).toBe(evaluation.result.trades.length);
      expect(row.previewRows).toBe(
        row.scope === "OWN"
          ? Math.min(TRADE_PREVIEW_LIMIT, row.tradeCount)
          : 0
      );
    }
  });

  it("参照自检字段存在（合成样本必然与 12F 的参照不一致）", () => {
    expect(custom.referenceCheck.referenceCandidateCount).toBe(
      REFERENCE_CANDIDATE_COUNT
    );
    expect(custom.referenceCheck.referenceEligibleCount).toBe(
      REFERENCE_ELIGIBLE_COUNT
    );
    expect(custom.referenceCheck.matchesCandidateCount).toBe(false);
    expect(custom.referenceCheck.matchesEligibleCount).toBe(false);
    expect(custom.referenceCheck.referenceExperimentId).toBe(
      "first-board-pullback/twelve-factor-composite-study"
    );
  });

  it("多重比较披露：带判定的行数 = topn + excess + 时间切片 + 1", () => {
    expect(custom.verdictRowCount).toBe(8 + 8 + 4 + 1);
    expect(custom.disclosures.join("\n")).toContain("多重比较");
  });

  it("确定性：同一份输入两次装配结果完全相同（JSON 逐字节）", () => {
    const second = buildFixture();
    expect(JSON.stringify(second.payload)).toBe(JSON.stringify(payload));
  });
});
