/**
 * 趋势入场 · **预注册配置**测试（冻结性）。
 *
 * 钉住：
 *   1. 恰好 3 条臂、id 稳定；
 *   2. **每条臂的每个条件都必须落在预注册四类词表内**（出现第五类即红）；
 *   3. 均线窗口只能用 5/10/20/60；观察窗固定 rd1..20；
 *   4. 三条臂**共用同一条退出配置**（退出不是自变量）；
 *   5. 需要物化的前置相对日 = −59..0（MA60 可达）、后置 = 1..80。
 */
import { describe, expect, it } from "vitest";
import {
  TREND_CONDITION_KINDS,
  TREND_ENTRY_ARMS,
  TREND_ENTRY_EXIT,
  TREND_ENTRY_MAX_RELATIVE_DAY,
  TREND_ENTRY_POST_RELATIVE_DAYS,
  TREND_ENTRY_PREFIX_RELATIVE_DAYS,
  TREND_ENTRY_WINDOW,
} from "../../../research-experiments/first-board-pullback/trend-entry-ma-v1/arms";
import { TREND_MA_WINDOWS } from "../../../research-experiments/shared/firstBoardPullback/trendEntry";
import { trendEntryMaV1Experiment } from "../../../research-experiments/first-board-pullback/trend-entry-ma-v1/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

const ALLOWED = new Set<string>(TREND_CONDITION_KINDS);
const MA_WINDOWS = new Set<number>(TREND_MA_WINDOWS);

describe("trend-entry-ma-v1 · 预注册臂冻结性", () => {
  it("恰好 3 条臂且 id 稳定", () => {
    expect(TREND_ENTRY_ARMS.map((arm) => arm.id)).toEqual([
      "a1-bull-stack",
      "a2-pullback-reclaim",
      "a3-above-ma60",
    ]);
  });

  it("所有条件都落在预注册四类词表内", () => {
    for (const arm of TREND_ENTRY_ARMS) {
      const conditions = [...arm.entry.trigger.all, ...arm.entry.trigger.any, ...arm.exit.conditions];
      expect(conditions.length).toBeGreaterThan(0);
      for (const condition of conditions) {
        expect(ALLOWED.has(condition.kind)).toBe(true);
        if (condition.kind === "PRICE_VS_MA") expect(MA_WINDOWS.has(condition.ma)).toBe(true);
        if (condition.kind === "MA_ORDER") {
          expect(MA_WINDOWS.has(condition.fast)).toBe(true);
          expect(MA_WINDOWS.has(condition.slow)).toBe(true);
        }
        if (condition.kind === "MA_SLOPE") expect(MA_WINDOWS.has(condition.ma)).toBe(true);
      }
    }
  });

  it("观察窗固定 rd1..20、入场执行固定 NEXT_OPEN、未触发 SKIP", () => {
    for (const arm of TREND_ENTRY_ARMS) {
      expect(arm.entry.window).toEqual(TREND_ENTRY_WINDOW);
      expect(arm.entry.window).toEqual({ fromRd: 1, toRd: 20 });
      expect(arm.entry.execution).toBe("NEXT_OPEN");
      expect(arm.entry.onNoTrigger).toBe("SKIP");
    }
  });

  it("三条臂共用同一条退出配置（退出不是自变量）", () => {
    for (const arm of TREND_ENTRY_ARMS) {
      expect(arm.exit).toEqual(TREND_ENTRY_EXIT);
    }
    expect(TREND_ENTRY_EXIT).toEqual({
      mode: "MIXED",
      horizonDays: 20,
      conditions: [{ kind: "PRICE_VS_MA", ma: 10, op: "LT" }],
      stopRatio: 0.06,
      exitAt: "NEXT_OPEN",
    });
  });

  it("实验描述符能通过注册，且坐标声明 v9 + 前置 −59..0", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(trendEntryMaV1Experiment)).not.toThrow();
    const requirement = trendEntryMaV1Experiment.descriptor.datasetRequirement;
    expect(requirement.requiredDatasetVersionLabel).toBe("v9");
    expect(requirement.datasetCode).toBe("first_limit_pullback");
    expect(requirement.prefixRelativeDays).toEqual([...TREND_ENTRY_PREFIX_RELATIVE_DAYS]);
    expect(requirement.postRelativeDays).toEqual([...TREND_ENTRY_POST_RELATIVE_DAYS]);
    expect(requirement.decisionOffsetDays).toBeNull();
    expect(requirement.usesForwardData).toBe(true);
  });

  it("需物化的相对日：前置 −59..0（MA60 可达）、后置 1..80", () => {
    expect(TREND_ENTRY_PREFIX_RELATIVE_DAYS.length).toBe(60);
    expect(TREND_ENTRY_PREFIX_RELATIVE_DAYS[0]).toBe(-59);
    expect(TREND_ENTRY_PREFIX_RELATIVE_DAYS[TREND_ENTRY_PREFIX_RELATIVE_DAYS.length - 1]).toBe(0);
    expect(TREND_ENTRY_POST_RELATIVE_DAYS[0]).toBe(1);
    expect(TREND_ENTRY_POST_RELATIVE_DAYS[TREND_ENTRY_POST_RELATIVE_DAYS.length - 1]).toBe(80);
    expect(TREND_ENTRY_MAX_RELATIVE_DAY).toBe(80);
    // MA60 在观察窗末端（rd 20）需要 rd −39..20；前置 −59 足够
    expect(TREND_ENTRY_WINDOW.toRd - 59).toBeLessThanOrEqual(TREND_ENTRY_WINDOW.fromRd);
  });
});
