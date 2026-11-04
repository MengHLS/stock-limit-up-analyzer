import { describe, expect, it } from "vitest";

import {
  THREE_FACTOR_TOPN_FAMILY_IDS,
  buildThreeFactorTopNFamilyDocument,
  buildThreeFactorTopNFamilyInput,
  buildThreeFactorTopNFamilyArmDocument,
  buildThreeFactorTopNFamilyArmInput,
  buildThreeFactorTopNFamilyParameterizedDocument,
  buildThreeFactorTopNFamilyParameterizedInput,
  describeThreeFactorTopNFamilyArm,
  listThreeFactorTopNFamilyDefinitions,
  listThreeFactorTopNFamilyArms,
  listThreeFactorTopNStudies,
  resolveThreeFactorTopNFamily,
  resolveThreeFactorTopNFamilyArm,
  resolveThreeFactorTopNStudy,
  resolveThreeFactorTopNStudyMembers,
} from "../../../server/research/patternLibrary/threeFactorTopNFamilies";
import { validateStrategyDocument } from "../../../server/research/strategySchema";
import { coreVersionFromDocument } from "../../../server/strategyCore/production/versionFromDocument";
import {
  assembleStrategySide,
  mapDeclaredPositionSizing,
} from "../../../server/runWorkbenchAssembly/assemble";
import { mapDeclaredExitPolicy } from "../../../server/runWorkbenchAssembly/exitPolicy";
import { getStrategyVersionStudyAnnotation } from "../../../server/research/strategyVersionStudyAnnotations";

const COORDINATES = {
  topN: 3,
  datasetVersionId: 660001,
  datasetLabel: "v5",
} as const;

describe("3F TopN 模式族可执行注册表", () => {
  it("族 id 唯一，且与版本注解目录逐项对齐", () => {
    const definitions = listThreeFactorTopNFamilyDefinitions();
    expect(definitions).toHaveLength(14);

    const ids = definitions.map(definition => definition.familyId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...THREE_FACTOR_TOPN_FAMILY_IDS].sort());

    const directory =
      getStrategyVersionStudyAnnotation("first-limit-pullback-3f-top3", "1.62.1")
        ?.familyDirectory ?? [];
    expect([...directory.map(family => family.familyId)].sort()).toEqual([...ids].sort());
  });

  it("只有两个族显式标为 HISTORICAL_ONLY，且都拒绝生成 3F 输入", () => {
    const historicalOnly = listThreeFactorTopNFamilyDefinitions()
      .filter(definition => definition.executability === "HISTORICAL_ONLY")
      .map(definition => definition.familyId);
    expect(historicalOnly.sort()).toEqual([
      "early-execution-baseline",
      "early-non-3f-comparison",
    ]);

    for (const familyId of historicalOnly) {
      const definition = resolveThreeFactorTopNFamily(familyId);
      expect(definition?.inputPatch).toBeNull();
      expect(definition?.historicalOnlyReason).not.toBeNull();
      expect(() => buildThreeFactorTopNFamilyInput(familyId, COORDINATES)).toThrow(
        /不可执行/,
      );
      expect(() => buildThreeFactorTopNFamilyDocument(familyId, COORDINATES)).toThrow(
        /不可执行/,
      );
    }
  });

  it.each(
    listThreeFactorTopNFamilyDefinitions()
      .filter(definition => definition.executability === "EXECUTABLE")
      .map(definition => [definition.familyId] as const),
  )("%s：生成合法文档、可转 Core 且被组装侧消费", (familyId) => {
    const document = buildThreeFactorTopNFamilyDocument(familyId, COORDINATES);
    const validation = validateStrategyDocument(document);
    expect(
      validation.valid,
      validation.issues.map(issue => `${issue.code}:${issue.path}`).join(" | "),
    ).toBe(true);
    expect(document.strategyId).toBe("first-limit-pullback-3f-top3");
    expect(document.datasetVersionId).toBe(660001);

    const coreVersion = coreVersionFromDocument({
      document,
      createdAt: "2026-09-29T00:00:00.000Z",
    });
    expect(coreVersion.ok).toBe(true);

    const strategySide = assembleStrategySide(
      {
        strategyId: document.strategyId,
        strategyVersion: document.version,
        startDate: "2019-01-01",
        endDate: "2026-09-04",
        createdAt: "2026-09-29T00:00:00.000Z",
        codeVersion: "three-factor-family-test",
        strategyDocument: document,
      },
      "ds-family-registry",
    );
    expect(strategySide.parameterSet).toBeTypeOf("object");
    expect(strategySide.strategyVersionRecordInput.document.version).toBe(document.version);
    expect(() =>
      mapDeclaredExitPolicy(document.definition?.exit.rules, {}, document.definition?.exit.strongHold),
    ).not.toThrow();
    expect(() => mapDeclaredPositionSizing(document.positionSizing)).not.toThrow();
  });

  it("c6+b4-14 族把分档仓位与 14% 最大振幅同时带进文档", () => {
    const document = buildThreeFactorTopNFamilyDocument(
      "c6-b4-14-best-combination",
      COORDINATES,
    );
    const declaredTiers = document.definition?.position?.positionTiers ?? [];
    expect(declaredTiers.map(tier => tier.fraction)).toEqual([0.05, 0.2, 0.25]);

    const entryConditions = document.definition?.entry?.conditions ?? [];
    const amplitudeCondition = entryConditions.find(
      condition => condition.field === "bar.observationMaxAmplitude",
    );
    expect(amplitudeCondition?.value).toBe(0.14);
  });

  it("runner 族把趋势 runner、减仓与退出截止写进 strongHold", () => {
    const input = buildThreeFactorTopNFamilyInput("runner-scale-out", COORDINATES);
    expect(input.strongHold).toMatchObject({
      afterExtendedHold: "TREND",
      scaleOutRatio: 0.5,
      runnerExitAtHoldingDays: 14,
    });
    expect(input.observationWindow).toEqual({ start: 5, end: 19, unit: "TRADING_DAY" });
  });

  it("可参数化族把族维度声明为 TUNABLE 且允许覆写落到文档", () => {
    const parameterized = buildThreeFactorTopNFamilyParameterizedDocument(
      "c6-b4-14-best-combination",
      COORDINATES,
      { maxMaxAmplitude: 0.16 },
    );
    const parameter = parameterized.definition?.parameters.find(
      item => item.code === "max_max_amplitude",
    );
    expect(parameter?.parameterRole).toBe("TUNABLE");
    expect(parameter?.defaultValue).toBe(0.14);

    const amplitudeCondition =
      parameterized.definition?.entry?.conditions?.find(
        condition => condition.field === "bar.observationMaxAmplitude",
      );
    expect(amplitudeCondition?.valueType).toBe("PARAMETER_REFERENCE");
    expect(amplitudeCondition?.value).toBe("max_max_amplitude");
  });

  it("参数覆写超出声明范围时直接报错，不静默夹取", () => {
    expect(() =>
      buildThreeFactorTopNFamilyParameterizedInput(
        "c6-b4-14-best-combination",
        COORDINATES,
        { maxMaxAmplitude: 0.5 },
      ),
    ).toThrow(/超出范围/);
  });

  it("未知族 id 直接报错", () => {
    expect(() => buildThreeFactorTopNFamilyDocument("not-a-family", COORDINATES)).toThrow(
      /未知的 3F TopN 模式族/,
    );
  });
});

describe("3F TopN 模式族 arm 注册表", () => {
  const allArms = listThreeFactorTopNFamilyDefinitions().flatMap(definition =>
    listThreeFactorTopNFamilyArms(definition.familyId).map(arm => ({
      familyId: definition.familyId,
      arm,
    })),
  );

  it("HISTORICAL_ONLY 族没有 arm，可执行族至少登记一个 arm", () => {
    for (const definition of listThreeFactorTopNFamilyDefinitions()) {
      const arms = listThreeFactorTopNFamilyArms(definition.familyId);
      if (definition.executability === "HISTORICAL_ONLY") {
        expect(arms).toHaveLength(0);
      } else {
        expect(arms.length).toBeGreaterThan(0);
      }
    }
  });

  it("族内 armId 唯一，且每个 arm 的 strategyVersion 不重复", () => {
    for (const definition of listThreeFactorTopNFamilyDefinitions()) {
      const arms = listThreeFactorTopNFamilyArms(definition.familyId);
      expect(new Set(arms.map(arm => arm.armId)).size).toBe(arms.length);
      expect(new Set(arms.map(arm => arm.strategyVersion)).size).toBe(arms.length);
    }
  });

  it("臂版本落在各自族的版本区间内", () => {
    for (const { familyId, arm } of allArms) {
      const definition = resolveThreeFactorTopNFamily(familyId)!;
      const version = arm.strategyVersion;
      const ge = (left: string, right: string) =>
        left.localeCompare(right, undefined, { numeric: true }) >= 0;
      const le = (left: string, right: string) =>
        left.localeCompare(right, undefined, { numeric: true }) <= 0;
      expect(ge(version, definition.minVersion), `${familyId}/${arm.armId} < ${definition.minVersion}`).toBe(true);
      expect(le(version, definition.maxVersion), `${familyId}/${arm.armId} > ${definition.maxVersion}`).toBe(true);
    }
  });

  it("每个 arm 都生成合法文档、可转 Core 且被组装侧消费", () => {
    for (const { familyId, arm } of allArms) {
      const document = buildThreeFactorTopNFamilyArmDocument(
        familyId,
        arm.armId,
        COORDINATES,
      );
      expect(document.version, `${familyId}/${arm.armId} version`).toBe(arm.strategyVersion);
      expect(document.strategyId).toBe("first-limit-pullback-3f-top3");
      const validation = validateStrategyDocument(document);
      expect(
        validation.valid,
        `${familyId}/${arm.armId}: ${validation.issues.map(issue => issue.code).join("|")}`,
      ).toBe(true);

      const coreVersion = coreVersionFromDocument({
        document,
        createdAt: "2026-09-29T00:00:00.000Z",
      });
      expect(coreVersion.ok, `${familyId}/${arm.armId} core`).toBe(true);

      const strategySide = assembleStrategySide(
        {
          strategyId: document.strategyId,
          strategyVersion: document.version,
          startDate: "2019-01-01",
          endDate: "2026-09-04",
          createdAt: "2026-09-29T00:00:00.000Z",
          codeVersion: "three-factor-arm-test",
          strategyDocument: document,
        },
        "ds-arm-registry",
      );
      expect(strategySide.strategyVersionRecordInput.document.version).toBe(document.version);
      expect(() => mapDeclaredPositionSizing(document.positionSizing)).not.toThrow();
      expect(() =>
        mapDeclaredExitPolicy(document.definition?.exit.rules, {}, document.definition?.exit.strongHold),
      ).not.toThrow();
    }
  });

  it("arm 构建输入携带对应 strategyVersion，且拼上调用坐标", () => {
    const input = buildThreeFactorTopNFamilyArmInput(
      "entry-risk-filter-b",
      "b4",
      COORDINATES,
    );
    expect(input.strategyVersion).toBe("1.58.3");
    expect(input.topN).toBe(3);
    expect(input.datasetVersionId).toBe(660001);
    expect(input.entryRiskFilter).toMatchObject({ maxMaxAmplitude: 0.12 });
  });

  it("组合族 arm 同时带风险过滤与仓位分档", () => {
    const document = buildThreeFactorTopNFamilyArmDocument(
      "c6-b4-14-best-combination",
      "c6b4-14",
      COORDINATES,
    );
    expect(document.version).toBe("1.62.1");
    const tiers = document.definition?.position?.positionTiers ?? [];
    expect(tiers.map(tier => tier.fraction)).toEqual([0.05, 0.2, 0.25]);
    const amplitude = document.definition?.entry?.conditions?.find(
      condition => condition.field === "bar.observationMaxAmplitude",
    );
    expect(amplitude?.value).toBe(0.14);
  });

  it("arm 投影暴露版本独有取值，而不是只重复族默认", () => {
    const c6 = describeThreeFactorTopNFamilyArm("tiered-position-sizing-c", "c6");
    expect(c6.find(signal => signal.label === "positionTiers")?.value).toContain(
      "25%",
    );
    const b8 = describeThreeFactorTopNFamilyArm("entry-risk-filter-b", "b8");
    expect(
      b8.filter(signal => signal.stage === "入场风险过滤").map(signal => signal.value),
    ).toEqual(["<8%", "-10%"]);
    expect(describeThreeFactorTopNFamilyArm("early-execution-baseline", "x")).toEqual([]);
    expect(describeThreeFactorTopNFamilyArm("entry-risk-filter-b", "missing")).toEqual([]);
  });

  it("runner 族 arm 的 strongHold 维度随 arm 变化", () => {
    const scale75 = buildThreeFactorTopNFamilyArmInput(
      "runner-scale-out",
      "scale75",
      COORDINATES,
    );
    expect(scale75.strategyVersion).toBe("1.24.1");
    expect(scale75.strongHold).toMatchObject({
      afterExtendedHold: "TREND",
      scaleOutRatio: 0.75,
      runnerExitAtHoldingDays: 14,
    });

    const replace = buildThreeFactorTopNFamilyArmInput(
      "runner-scale-out",
      "replace",
      COORDINATES,
    );
    expect(replace.strongHold).toMatchObject({
      maxConcurrentRunners: 2,
      replacementScoreMargin: 0.03,
    });
  });

  it("trailing-take-profit 族登记 8 个 arm，覆盖 MA/ATR/R/回吐/结构低点/PSAR/混合", () => {
    const arms = listThreeFactorTopNFamilyArms("trailing-take-profit");
    expect(arms.map(arm => arm.armId)).toEqual([
      "ma",
      "legacy_ma_control",
      "atr",
      "rlock",
      "giveback",
      "swing",
      "sar",
      "hybrid",
    ]);
    expect(arms.map(arm => arm.strategyVersion)).toEqual([
      "1.14.0",
      "1.14.1",
      "1.15.0",
      "1.16.0",
      "1.17.0",
      "1.18.0",
      "1.19.0",
      "1.20.0",
    ]);
  });

  it("B 族 8 个 arm 的版本与顺序与留档一致", () => {
    const arms = listThreeFactorTopNFamilyArms("entry-risk-filter-b");
    expect(arms.map(arm => `${arm.armId}:${arm.strategyVersion}`)).toEqual([
      "b1:1.58.0",
      "b2:1.58.1",
      "b3:1.58.2",
      "b4:1.58.3",
      "b5:1.58.4",
      "b6:1.58.5",
      "b7:1.58.6",
      "b8:1.58.7",
    ]);
  });

  it("未知 arm 与 HISTORICAL_ONLY 族的 arm 直接报错", () => {
    expect(() =>
      buildThreeFactorTopNFamilyArmDocument("entry-risk-filter-b", "b99", COORDINATES),
    ).toThrow(/没有 arm=b99/);
    expect(() =>
      buildThreeFactorTopNFamilyArmDocument("not-a-family", "b1", COORDINATES),
    ).toThrow(/未知的 3F TopN 模式族/);
    expect(
      resolveThreeFactorTopNFamilyArm("early-execution-baseline", "anything"),
    ).toBeNull();
  });
});

describe("3F TopN 研究集合注册表", () => {
  it("只登记 entry-study 与 trailing-policy-study 两个集合", () => {
    expect(listThreeFactorTopNStudies().map(study => study.studyId)).toEqual([
      "entry-study",
      "trailing-policy-study",
    ]);
    expect(resolveThreeFactorTopNStudy("missing-study")).toBeNull();
    expect(() => resolveThreeFactorTopNStudyMembers("missing-study")).toThrow(
      /未知的 3F TopN 研究集合/,
    );
  });

  it("entry-study 顺序与历史默认 --arms 一致", () => {
    const members = resolveThreeFactorTopNStudyMembers("entry-study");
    expect(
      members.map(member => `${member.familyId}/${member.arm.armId}`),
    ).toEqual([
      "entry-risk-filter-b/b1",
      "entry-risk-filter-b/b2",
      "entry-risk-filter-b/b3",
      "entry-risk-filter-b/b4",
      "entry-risk-filter-b/b5",
      "entry-risk-filter-b/b6",
      "entry-risk-filter-b/b7",
      "entry-risk-filter-b/b8",
      "c6-b4-14-best-combination/c6b4-14",
      "zero-low-score-allocation/c7",
      "zero-low-score-allocation/c8",
      "zero-low-score-allocation/c9",
      "tiered-position-sizing-c/c6b4",
      "tiered-position-sizing-c/c5",
      "tiered-position-sizing-c/c6",
      "tiered-position-sizing-c/c1",
      "tiered-position-sizing-c/c2",
      "tiered-position-sizing-c/c3",
      "tiered-position-sizing-c/c4",
    ]);
    // 默认别名等于 armId。
    expect(members.map(member => member.alias)).toEqual(
      members.map(member => member.arm.armId),
    );
  });

  it("trailing-policy-study 的别名与顺序与历史 NAMED_ARMS 一致", () => {
    const members = resolveThreeFactorTopNStudyMembers("trailing-policy-study");
    expect(members.map(member => member.alias)).toEqual([
      "ma",
      "legacy_ma_control",
      "atr",
      "rlock",
      "giveback",
      "swing",
      "sar",
      "hybrid",
      "ma_trend",
      "scale50",
      "scale75",
      "runner2",
      "replace",
    ]);
    expect(
      members.map(member => `${member.familyId}/${member.arm.armId}`),
    ).toEqual([
      "trailing-take-profit/ma",
      "trailing-take-profit/legacy_ma_control",
      "trailing-take-profit/atr",
      "trailing-take-profit/rlock",
      "trailing-take-profit/giveback",
      "trailing-take-profit/swing",
      "trailing-take-profit/sar",
      "trailing-take-profit/hybrid",
      "runner-scale-out/ma_trend",
      "runner-scale-out/scale50",
      "runner-scale-out/scale75",
      "runner-scale-out/runner2",
      "runner-scale-out/replace",
    ]);
  });

  it("研究集合每个成员都能构建出合法 arm 文档", () => {
    for (const studyId of ["entry-study", "trailing-policy-study"]) {
      for (const member of resolveThreeFactorTopNStudyMembers(studyId)) {
        const document = buildThreeFactorTopNFamilyArmDocument(
          member.familyId,
          member.arm.armId,
          COORDINATES,
        );
        expect(
          validateStrategyDocument(document).valid,
          `${studyId}:${member.familyId}/${member.arm.armId}`,
        ).toBe(true);
      }
    }
  });
});
