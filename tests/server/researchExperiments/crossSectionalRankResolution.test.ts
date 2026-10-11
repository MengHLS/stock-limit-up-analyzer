import { describe, expect, it } from "vitest";

import {
  DEFAULT_RANK_RESOLUTION_THRESHOLDS,
  describeRankResolution,
  diagnoseDay,
  judgeRankResolution,
  summarizeRankResolution,
  summarizeTieBreakSensitivity,
  type ResolutionDay,
} from "@experiments/shared/singleFactor/rankResolution";

/**
 * P3 排序分辨力仪器 —— **合成夹具**（零 Dataset 依赖）。
 *
 * 🔴 本测试**不读任何 Dataset**、**不产生 Run**。它只锁定「仪器语义」：
 *    - 连续值 ⇒ `RESOLUTION_OK`
 *    - 高度离散 / 大并列 ⇒ `TIE_BREAK_DOMINATED`
 *    - 随机列 = 逐日无放回均匀 K 子集（**不是** tie-break `RAND`）
 */

const CONTINUOUS: ResolutionDay[] = Array.from({ length: 40 }, (_, dayIndex) => ({
  date: `2020-01-${String((dayIndex % 28) + 1).padStart(2, "0")}`,
  candidates: Array.from({ length: 30 }, (_, candidateIndex) => ({
    eventId: `sym${String(candidateIndex).padStart(3, "0")}@d${dayIndex}`,
    // 连续且几乎无重复
    value: candidateIndex * 0.037 + dayIndex * 1e-4,
  })),
}));

/**
 * 模拟 `holdStreak` 的真实形态（`rightTailTypes.ts` L75 记载：
 * 每日 distinct 中位数 3、单值最大占比中位数 83.3%、边界并列 ≥K 日占比 73%）。
 * 构造：30 只候选中 25 只同值（83.3%），另 5 只分落 2 个取值 ⇒ distinct = 3。
 */
const DISCRETE: ResolutionDay[] = Array.from({ length: 40 }, (_, dayIndex) => ({
  date: `2020-02-${String((dayIndex % 28) + 1).padStart(2, "0")}`,
  candidates: Array.from({ length: 30 }, (_, candidateIndex) => ({
    eventId: `sym${String(candidateIndex).padStart(3, "0")}@e${dayIndex}`,
    value: candidateIndex < 25 ? 3 : candidateIndex < 28 ? 2 : 1,
  })),
}));

describe("diagnoseDay", () => {
  it("连续值在同一天内不产生边界并列", () => {
    const day = diagnoseDay(CONTINUOUS[0]!, 3);
    expect(day.distinctCount).toBe(30);
    expect(day.modalTieSize).toBe(1);
    expect(day.boundaryStraddles).toBe(false);
    expect(day.boundaryTieSize).toBe(0);
  });

  it("离散值在入选边界上产生大并列组", () => {
    const day = diagnoseDay(DISCRETE[0]!, 3);
    expect(day.distinctCount).toBe(3);
    expect(day.modalTieSize).toBe(25);
    expect(day.modalShare).toBeCloseTo(25 / 30, 10);
    expect(day.boundaryStraddles).toBe(true);
    expect(day.boundaryTieSize).toBe(25);
  });
});

describe("summarizeTieBreakSensitivity", () => {
  it("连续值下换破平键不改变入选集合", () => {
    const sensitivity = summarizeTieBreakSensitivity({ days: CONTINUOUS, topK: 3 });
    expect(sensitivity.jaccardAscDescMedian).toBe(1);
    expect(sensitivity.selectionChangedDayShare).toBe(0);
  });

  it("离散值下换破平键几乎改变全部入选集合", () => {
    const sensitivity = summarizeTieBreakSensitivity({ days: DISCRETE, topK: 3 });
    // 25 只同值 ⇒ ASC 取 eventId 最小的 3 只、DESC 取最大的 3 只 ⇒ 交集为空
    expect(sensitivity.jaccardAscDescMedian).toBe(0);
    expect(sensitivity.selectionChangedDayShare).toBe(1);
  });

  it("🔴 全并列时换键选出【完全不相交】的集合 —— 这正是要防的伪排序", () => {
    const flat: ResolutionDay[] = [{
      date: "2020-03-02",
      candidates: Array.from({ length: 20 }, (_, index) => ({ eventId: `s${index}`, value: 1 })),
    }];
    const sensitivity = summarizeTieBreakSensitivity({ days: flat, topK: 3 });
    // 全部同值 ⇒ 排序完全由破平键决定：ASC 取 s0,s1,s2；DESC 取 s19,s18,s17 ⇒ J = 0
    expect(sensitivity.jaccardAscDescMedian).toBe(0);
    // 而「逐日无放回均匀子集」是独立随机抽取 ⇒ 同样与 ASC 几乎不相交
    expect(sensitivity.jaccardAscUniformMedian).toBeLessThan(1);
  });
});

describe("judgeRankResolution", () => {
  it("连续因子 ⇒ RESOLUTION_OK", () => {
    const summary = summarizeRankResolution({ days: CONTINUOUS, topK: 3 });
    const sensitivity = summarizeTieBreakSensitivity({ days: CONTINUOUS, topK: 3 });
    const judgement = judgeRankResolution({ summary, sensitivity });
    expect(judgement.verdict).toBe("RESOLUTION_OK");
    expect(judgement.reasons).toEqual([]);
    expect(describeRankResolution(judgement)).toContain("RESOLUTION_OK");
  });

  it("离散因子 ⇒ TIE_BREAK_DOMINATED 且给出理由", () => {
    const summary = summarizeRankResolution({ days: DISCRETE, topK: 3 });
    const sensitivity = summarizeTieBreakSensitivity({ days: DISCRETE, topK: 3 });
    const judgement = judgeRankResolution({ summary, sensitivity });
    expect(judgement.verdict).toBe("TIE_BREAK_DOMINATED");
    expect(judgement.reasons.length).toBeGreaterThan(0);
  });

  it("阈值可显式覆盖（默认值只是预注册默认，不得事后放宽）", () => {
    const summary = summarizeRankResolution({ days: DISCRETE, topK: 3 });
    const sensitivity = summarizeTieBreakSensitivity({ days: DISCRETE, topK: 3 });
    const relaxed = judgeRankResolution({
      summary,
      sensitivity,
      thresholds: { ...DEFAULT_RANK_RESOLUTION_THRESHOLDS, minDistinctCount: 1, maxModalShareMedian: 1, maxModalDominatedDayShare: 1, minJaccardAscDesc: 0 },
    });
    expect(relaxed.verdict).toBe("RESOLUTION_OK");
  });
});
