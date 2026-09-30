import { describe, expect, it } from "vitest";

import { getStrategyVersionStudyAnnotation } from "../../../server/research/strategyVersionStudyAnnotations";

describe("getStrategyVersionStudyAnnotation", () => {
  it("按模式族区间和精确版本覆盖返回研究结论", () => {
    const annotation = getStrategyVersionStudyAnnotation(
      "first-limit-pullback-3f-top3",
      "1.44.1"
    );

    expect(annotation?.familyId).toBe("stop-policy-sweep");
    expect(annotation?.familyLabel).toBe("止损政策族");
    expect(annotation?.observedResult).toContain("+27.96%");
    expect(annotation?.caution).toContain("#2130001");
  });

  it("未执行的上下文版本沿用所属族，但保留无效实验警示", () => {
    const annotation = getStrategyVersionStudyAnnotation(
      "first-limit-pullback-3f-top5",
      "1.52.0"
    );

    expect(annotation?.familyId).toBe("stop-policy-sweep");
    expect(annotation?.caution).toContain("1.52.0 至 1.56.0");
    expect(annotation?.caution).toContain("未真正注入引擎");
  });

  it("当前最佳组合带出完整留档指标与分钟数据边界", () => {
    const annotation = getStrategyVersionStudyAnnotation(
      "first-limit-pullback-3f-top3",
      "1.62.1"
    );

    expect(annotation?.familyLabel).toBe("c6+b4-14 当前最佳组合族");
    expect(annotation?.observedResult).toContain("+57.73%");
    expect(annotation?.observedResult).toContain("PF 1.1366");
    expect(
      annotation?.signals.find(
        signal => signal.label === "entryRiskFilter.maxMaxAmplitude"
      )
    ).toMatchObject({
      value: "14%",
      stage: "入场风险过滤",
      source: "ASSEMBLY",
    });
    expect(
      annotation?.signals.find(signal => signal.label === "positionTiers")
    ).toMatchObject({
      value: "低 5% / 中 20% / 高 25%",
      stage: "建仓仓位",
    });
    expect(
      annotation?.signals.find(signal => signal.source === "TUNABLE")
    ).toMatchObject({
      label: "max_max_amplitude",
    });
    expect(annotation?.familyDirectory).toHaveLength(14);
    expect(
      annotation?.familyDirectory.find(
        family => family.familyId === "c6-b4-14-best-combination"
      )
    ).toMatchObject({
      minVersion: "1.62.1",
      maxVersion: "1.62.1",
      uniqueDimension: "c6 分层仓位叠加最大振幅 <14% 过滤",
      minuteStage: "入场风险过滤 + 建仓仓位",
      executability: "EXECUTABLE",
    });
    const bestFamily = annotation?.familyDirectory.find(
      family => family.familyId === "c6-b4-14-best-combination"
    );
    expect(
      bestFamily?.resolvedSignals.find(
        signal => signal.label === "entryRiskFilter.maxMaxAmplitude"
      )
    ).toMatchObject({ value: "<14%", source: "TUNABLE" });
    expect(
      bestFamily?.resolvedSignals.find(
        signal => signal.label === "positionTiers"
      )?.value
    ).toContain("25%");
    expect(bestFamily?.tunableParameters).toEqual([
      expect.objectContaining({ name: "maxMaxAmplitude", defaultValue: 0.14 }),
    ]);
    expect(bestFamily?.arms).toEqual([
      expect.objectContaining({
        armId: "c6b4-14",
        strategyVersion: "1.62.1",
        label: "c6-b4-max-amp-14",
        description: expect.stringContaining("最大振幅<14%"),
      }),
    ]);
    expect(
      bestFamily?.arms[0]?.signals.find(signal =>
        signal.label === "entryRiskFilter.maxMaxAmplitude"
      )
    ).toMatchObject({ value: "<14%", source: "TUNABLE" });
    expect(bestFamily?.evidenceSources.length).toBeGreaterThan(0);
    expect(annotation?.minuteFields).toHaveLength(1);
    expect(annotation?.minuteFields[0]?.field).toBe("limitUpTime");
    expect(
      annotation?.minuteFields[0]?.stages.map(stage => stage.label)
    ).toEqual([
      "信号日基础评分",
      "候选准入",
      "下侧风险扣分",
      "质量混合评分",
      "T+1 开盘预期",
    ]);
    expect(annotation?.minuteFields[0]?.limitations.join(" ")).toContain(
      "最大振幅 LOW、平均振幅 LOW、T+1 量比 HIGH"
    );
    expect(annotation?.minuteFields[0]?.limitations.join(" ")).toContain(
      "当前没有真实分钟线"
    );
  });

  it("非 3F 早期版本只返回历史对照，不混入 3F 族内排名", () => {
    const annotation = getStrategyVersionStudyAnnotation(
      "first-board-pullback",
      "1.0.0"
    );

    expect(annotation?.familyId).toBe("early-non-3f-comparison");
    expect(annotation?.observedResult).toContain("不纳入 3F TopN");
    expect(annotation?.familyDirectory).toHaveLength(14);
    expect(annotation?.familyDirectory.at(-1)?.familyId).toBe(
      "early-non-3f-comparison"
    );
    expect(annotation?.familyDirectory.at(-1)?.arms).toEqual([]);
    expect(annotation?.signals).toHaveLength(1);
  });

  it("未知模式或非法版本不冒领研究结论", () => {
    expect(
      getStrategyVersionStudyAnnotation("unknown-strategy", "1.62.1")
    ).toBeNull();
    expect(
      getStrategyVersionStudyAnnotation(
        "first-limit-pullback-3f-top3",
        "not-a-version"
      )
    ).toBeNull();
    expect(
      getStrategyVersionStudyAnnotation(
        "first-limit-pullback-3f-top3",
        "9.99.9"
      )
    ).toBeNull();
  });

  it("每个 3F 族都登记独有维度与分钟作用阶段", () => {
    const annotation = getStrategyVersionStudyAnnotation(
      "first-limit-pullback-3f-top3",
      "1.0.0"
    );

    expect(annotation?.familyDirectory).toHaveLength(14);
    expect(
      annotation?.familyDirectory.find(
        family => family.familyId === "entry-risk-filter-b"
      )?.arms.map(arm => `${arm.armId}@${arm.strategyVersion}`)
    ).toEqual([
      "b1@1.58.0",
      "b2@1.58.1",
      "b3@1.58.2",
      "b4@1.58.3",
      "b5@1.58.4",
      "b6@1.58.5",
      "b7@1.58.6",
      "b8@1.58.7",
    ]);
    expect(
      annotation?.familyDirectory.filter(family =>
        family.familyId.startsWith("early-non-3f")
      )
    ).toHaveLength(1);
    for (const family of annotation?.familyDirectory ?? []) {
      expect(family.uniqueDimension.length).toBeGreaterThan(0);
      expect(family.minuteStage.length).toBeGreaterThan(0);
      expect(family.minuteEffect.length).toBeGreaterThan(0);
    }
  });

  describe("池化族（first-limit-pool-rolling-3f-top3）", () => {
    it("登记池化执行语义：入池、滚动评分、失效规则与候选退出边界", () => {
      const annotation = getStrategyVersionStudyAnnotation(
        "first-limit-pool-rolling-3f-top3",
        "1.0.0"
      );

      expect(annotation?.firstLimitPool).not.toBeNull();
      expect(annotation?.firstLimitPool).toMatchObject({
        familyId: "rolling-first-limit-pool",
        armId: "rolling-3f-top3-v1",
        strategyId: "first-limit-pool-rolling-3f-top3",
        strategyVersion: "1.0.0",
        ageCapTradingDays: 60,
        scoreInvalidationDays: 3,
        scoreAffectsExit: false,
        maxDailyCandidates: 3,
      });
      expect(annotation?.firstLimitPool?.admissionRule).toContain("FIRST_LIMIT_UP");
      expect(annotation?.firstLimitPool?.earlyScoreStage).toContain("T+1..T+5");
      expect(annotation?.firstLimitPool?.fullScoreStage).toContain("T+5");
      expect(annotation?.firstLimitPool?.invalidationRule).toContain("池龄上限");
      expect(annotation?.firstLimitPool?.panelBudgets.maxMembersPerDay).toBeGreaterThan(0);
      expect(annotation?.firstLimitPool?.errorCodes).toContain(
        "POOL_PANEL_ROW_BUDGET_EXCEEDED"
      );
    });

    it("只注解 1.0.0；其它版本不冒领池化语义", () => {
      expect(
        getStrategyVersionStudyAnnotation("first-limit-pool-rolling-3f-top3", "2.0.0")
      ).toBeNull();
      expect(
        getStrategyVersionStudyAnnotation("first-limit-pool-rolling-3f-top3", "bad")
      ).toBeNull();
    });

    it("旧 3F 注解不携带池化声明（普通研究 firstLimitPool 恒为 null）", () => {
      const old = getStrategyVersionStudyAnnotation(
        "first-limit-pullback-3f-top3",
        "1.62.1"
      );
      expect(old?.firstLimitPool).toBeNull();
    });
  });
});
