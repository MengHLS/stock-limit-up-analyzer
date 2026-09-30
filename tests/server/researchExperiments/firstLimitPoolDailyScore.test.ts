import { describe, expect, it } from "vitest";

import { validateStrategyDocument } from "../../../server/research/strategySchema";
import {
  FIRST_LIMIT_POOL_DAILY_SCORE_ARM_ID,
  FIRST_LIMIT_POOL_DAILY_SCORE_FAMILY_ID,
  FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_ID,
  FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_VERSION,
  buildFirstLimitPoolDailyScoreDocument,
  describeFirstLimitPoolDailyScore,
} from "../../../server/research/patternLibrary/firstLimitPoolDailyScore";
import { getStrategyVersionStudyAnnotation } from "../../../server/research/strategyVersionStudyAnnotations";
import { coreVersionFromDocument } from "../../../server/strategyCore/production/versionFromDocument";

describe("first-limit-pool-rolling-3f 策略文档", () => {
  it("生成独立滚动池版本并继承 v1.62.1 执行面", () => {
    const document = buildFirstLimitPoolDailyScoreDocument({
      datasetVersionId: 660001,
      datasetLabel: "v5",
    });
    const validation = validateStrategyDocument(document);

    expect(
      validation.valid,
      validation.issues.map(issue => `${issue.code}:${issue.path}`).join(" | "),
    ).toBe(true);
    expect(document.strategyId).toBe(FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_ID);
    expect(document.version).toBe(FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_VERSION);
    expect(document.strategyType).toBe("FIRST_LIMIT_POOL_ROLLING_3F");
    expect(document.definition?.entry.trigger.type).toBe("FIRST_LIMIT_POOL");
    expect(document.definition?.entry.observationWindow).toEqual({
      start: 1,
      end: 5,
      unit: "TRADING_DAY",
    });
    expect(document.definition?.entry.conditions.map(item => item.id)).toContain(
      "entry-risk-rolling-max-amplitude",
    );
    expect(document.definition?.entry.conditions.map(item => item.id)).not.toContain(
      "entry-risk-max-amplitude",
    );
    expect(document.definition?.exit.candidateExitPolicy).toBe("DISABLED");
    expect(document.definition?.position.positionTiers).toEqual([
      { minScore: 0, fraction: 0.05 },
      { minScore: 0.55, fraction: 0.2 },
      { minScore: 0.7167, fraction: 0.25 },
    ]);
    expect(document.definition?.firstLimitPool).toMatchObject({
      poolPolicyId: FIRST_LIMIT_POOL_DAILY_SCORE_FAMILY_ID,
      admissionEventType: "FIRST_LIMIT_UP",
      admittedRelativeDay: 0,
      boardScope: ["main"],
      poolAgeCapTradingDays: 60,
      scorePolicy: "ROLLING_THREE_FACTOR",
      scoreStartRelativeDay: 1,
      scoreWindowDays: 5,
      minimumScore: 0.55,
      maxObservationAmplitude: 0.14,
      scoreInvalidationDays: 3,
      scoreAffectsExit: false,
      maxDailyCandidates: 3,
      allowMultipleMembersPerSecurity: true,
    });
    expect(document.recipe?.recipeId).toBe("first-limit-pool-rolling-3f");

    const core = coreVersionFromDocument({
      document,
      createdAt: "2026-09-30T00:00:00.000Z",
    });
    expect(core.ok, core.ok ? "" : `${core.reason}: ${core.detail}`).toBe(true);
    if (core.ok) {
      expect(core.firstLimitPool).toMatchObject({
        poolAgeCapTradingDays: 60,
        scorePolicy: "ROLLING_THREE_FACTOR",
        minimumScore: 0.55,
        scoreAffectsExit: false,
      });
      expect(core.notes.join(" ")).toContain("滚动 3F");
      expect(core.notes.join(" ")).toContain("scoreAffectsExit=false");
    }
  });

  it("拒绝非法池龄与最低分", () => {
    expect(() =>
      buildFirstLimitPoolDailyScoreDocument({
        datasetVersionId: 660001,
        datasetLabel: "v5",
        poolAgeCapTradingDays: 0,
      }),
    ).toThrow("poolAgeCapTradingDays");

    expect(() =>
      buildFirstLimitPoolDailyScoreDocument({
        datasetVersionId: 660001,
        datasetLabel: "v5",
        minimumScore: 1.2,
      }),
    ).toThrow("minimumScore");
  });

  it("可物化固定冻结桶归因对照", () => {
    const document = buildFirstLimitPoolDailyScoreDocument({
      datasetVersionId: 660001,
      datasetLabel: "v5",
      scoreMode: "FIXED_BUCKETS",
    });
    expect(document.recipe?.recipeId).toBe("first-limit-pool-fixed-3f");
    expect(document.definition?.firstLimitPool?.calibrationVersion).toBe(
      "FROZEN-BUCKET-CONTRACT-001",
    );
  });

  it("版本注解展示滚动评分、低分移池与评分不影响退出", () => {
    const annotation = getStrategyVersionStudyAnnotation(
      FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_ID,
      FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_VERSION,
    );
    const detail = describeFirstLimitPoolDailyScore();

    expect(annotation?.firstLimitPool).toMatchObject({
      familyId: FIRST_LIMIT_POOL_DAILY_SCORE_FAMILY_ID,
      armId: FIRST_LIMIT_POOL_DAILY_SCORE_ARM_ID,
      ageCapTradingDays: 60,
      scoreInvalidationDays: 3,
      scoreAffectsExit: false,
      minimumScore: 0.55,
    });
    expect(annotation?.firstLimitPool?.earlyScoreStage).toContain("T+1..T+5");
    expect(annotation?.firstLimitPool?.fullScoreStage).toContain("T+5");
    expect(annotation?.signals.map(signal => signal.label)).toContain(
      "candidateExitPolicy",
    );
    expect(annotation?.familyDirectory).toHaveLength(14);
    expect(detail.errorCodes).toContain("POOL_SCORE_BELOW_MINIMUM");
    expect(
      getStrategyVersionStudyAnnotation(
        FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_ID,
        "9.9.9",
      ),
    ).toBeNull();
  });

  it("旧 3F 注解不携带池化声明", () => {
    const annotation = getStrategyVersionStudyAnnotation(
      "first-limit-pullback-3f-top3",
      "1.62.1",
    );
    expect(annotation?.firstLimitPool).toBeNull();
  });
});
