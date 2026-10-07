/**
 * P10 · compositeRunner 的**候选池上市龄过滤**测试。
 *
 * 夹具四候选的纯 3F Top3 = [sec-a-high3f, sec-b-4th, sec-c-mid]；决策日 = 2026-03-07。
 *
 * 钉住：
 *   1. candidateListingFilter 缺省 / null => 既有行为逐字段不变；
 *   2. 过滤发生在**排序前**：被剔除的名额由低名次**递补**（不是「选中后跳过」）；
 *   3. 上市龄按**决策日**（不是事件日）计算；`age == minListingAgeDays` ⇒ 保留（严格小于才剔除）；
 *   4. 上市日不可得 ⇒ **不剔除**，并如实计数；
 *   5. 账目（评估数 / 剔除数 / 不可得数）与实际逐日剔除一致。
 */
import { describe, expect, it } from "vitest";
import {
  buildCompositeEvents,
  buildCompositeSourceRun,
  COMPOSITE_RUNNER_MAX_AMPLITUDE,
} from "../../../../server/research/compositeRunner/index";
import {
  DECISION_DAY,
  EVENT_DAY,
  LAST_TRADING_DAY,
  buildTrendFusionDataset,
  rankedSelectedKeysOf,
} from "./trendFusionFixture";

const UNFILTERED_TOP3 = ["sec-a-high3f", "sec-b-4th", "sec-c-mid"];
/** 决策日 2026-03-07 与事件日 2026-03-02 分别距 2026-01-01 = 65 天 / 60 天。 */
const SUB_NEW_LISTED = "2026-01-01";
const OLD_LISTED = "2000-01-01";

function buildFilteredArm(
  minListingAgeDays: number | null,
  listingDateOf: (securityId: string) => string | null,
) {
  const dataset = buildTrendFusionDataset();
  const built = buildCompositeEvents(dataset, COMPOSITE_RUNNER_MAX_AMPLITUDE);
  return buildCompositeSourceRun({
    armId: "test-listing-filter-arm",
    label: "test listing filter arm",
    kind: "bucket_t5",
    dataset,
    tradingDays: built.tradingDays,
    bucketCandidatesByDate: built.bucketCandidatesByDate,
    rankCandidatesByTe: built.rankCandidatesByTe,
    topN: 3,
    maxAmplitude: COMPOSITE_RUNNER_MAX_AMPLITUDE,
    dateRange: { startDate: EVENT_DAY, endDate: LAST_TRADING_DAY },
    candidateListingFilter:
      minListingAgeDays === null ? null : { minListingAgeDays, listingDateOf },
  });
}

/** 只有 sec-a-high3f 是次新。 */
const aIsSubNew = (securityId: string): string | null =>
  securityId.startsWith("sec-a-high3f") ? SUB_NEW_LISTED : OLD_LISTED;

describe("compositeRunner · 候选池上市龄过滤", () => {
  it("缺省与 null => 与既有纯 3F 结果逐字段相同", () => {
    const omitted = buildFilteredArm(null, aIsSubNew);
    expect(rankedSelectedKeysOf(omitted.sourceRun.days)).toEqual(UNFILTERED_TOP3);
    expect(omitted.sourceRun.parameters).not.toHaveProperty("minListingAgeDays");
    expect(omitted.listingFilterAccounting).toBeUndefined();
  });

  it("过滤在排序前：次新被剔除，低名次递补进来", () => {
    const filtered = buildFilteredArm(365, aIsSubNew);
    // sec-a-high3f（3F 第 1）被剔除 ⇒ 第 4 名 sec-d-low3f 递补。
    expect(rankedSelectedKeysOf(filtered.sourceRun.days)).toEqual([
      "sec-b-4th",
      "sec-c-mid",
      "sec-d-low3f",
    ]);
    expect(filtered.listingFilterAccounting).toEqual({
      evaluatedCandidateCount: 4,
      excludedByListingAge: 1,
      unknownListingDate: 0,
    });
  });

  it("边界：age == minListingAgeDays 保留；严格小于才剔除", () => {
    expect(rankedSelectedKeysOf(buildFilteredArm(65, aIsSubNew).sourceRun.days)).toEqual(UNFILTERED_TOP3);
    const excluded = buildFilteredArm(66, aIsSubNew);
    expect(rankedSelectedKeysOf(excluded.sourceRun.days)).not.toContain("sec-a-high3f");
    expect(excluded.listingFilterAccounting?.excludedByListingAge).toBe(1);
  });

  it("上市龄按**决策日**计算（不是事件日）", () => {
    // 上市日 2025-03-07 ⇒ 决策日（2026-03-07）龄 = 365，事件日（2026-03-02）龄 = 360。
    // 阈值 361 下：按决策日 => 保留；若误按事件日 => 会被剔除。
    const listed = "2025-03-07";
    const arm = buildFilteredArm(361, (securityId) =>
      securityId.startsWith("sec-a-high3f") ? listed : OLD_LISTED);
    expect(rankedSelectedKeysOf(arm.sourceRun.days)).toEqual(UNFILTERED_TOP3);
    expect(arm.listingFilterAccounting?.excludedByListingAge).toBe(0);
  });

  it("上市日不可得 => 不剔除，并如实计数（不静默排除身份不明的候选）", () => {
    const arm = buildFilteredArm(365, (securityId) =>
      securityId.startsWith("sec-a-high3f") ? null : OLD_LISTED);
    expect(rankedSelectedKeysOf(arm.sourceRun.days)).toEqual(UNFILTERED_TOP3);
    expect(arm.listingFilterAccounting).toEqual({
      evaluatedCandidateCount: 4,
      excludedByListingAge: 0,
      unknownListingDate: 1,
    });
  });

  it("PIT：只读决策日及以前 —— 改动 rd >= 6 不改变过滤结果与账目", () => {
    const withTail = (() => {
      const dataset = buildTrendFusionDataset(3);
      const built = buildCompositeEvents(dataset, COMPOSITE_RUNNER_MAX_AMPLITUDE);
      return buildCompositeSourceRun({
        armId: "test-listing-filter-arm",
        label: "test listing filter arm",
        kind: "bucket_t5",
        dataset,
        tradingDays: built.tradingDays,
        bucketCandidatesByDate: built.bucketCandidatesByDate,
        rankCandidatesByTe: built.rankCandidatesByTe,
        topN: 3,
        maxAmplitude: COMPOSITE_RUNNER_MAX_AMPLITUDE,
        dateRange: { startDate: EVENT_DAY, endDate: LAST_TRADING_DAY },
        candidateListingFilter: { minListingAgeDays: 365, listingDateOf: aIsSubNew },
      });
    })();
   expect(rankedSelectedKeysOf(withTail.sourceRun.days)).toEqual([
      "sec-b-4th",
      "sec-c-mid",
      "sec-d-low3f",
    ]);
    expect(withTail.listingFilterAccounting?.excludedByListingAge).toBe(1);
  });
});
