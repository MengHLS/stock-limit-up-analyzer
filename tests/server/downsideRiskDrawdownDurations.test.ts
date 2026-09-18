/**
 * `server/downsideRisk.ts#calculateDrawdownDurations` 口径回归。
 *
 * 🔴 口径（2026-09-18 用户裁定）：锁定**最大回撤那一次**回撤区间，两个指标取自**同一个**区间 ——
 *   - 回撤持续时间 = 峰值日 → 谷底日的交易日数；
 *   - 收复回撤所用时间 = 谷底日 → 收复前高的交易日数（未收复则计至期末）。
 *   并列最深取**最早**那一次；二者相加恒等于「峰值日 → 收复日」的总交易日数。
 *
 * 本文件的存在意义：旧实现是「全期各区间**分别**取最大」（两个数字可能来自不同区间，典型 154 / 153），
 * 极易被顺手改回去 —— 下面用「最长区间 ≠ 最深区间」的构造把这条口径钉死。
 */
import { describe, expect, it } from "vitest";
import { calculateDrawdownDurations } from "../../server/downsideRisk";

describe("calculateDrawdownDurations", () => {
  it("空序列 ⇒ 两项皆 null", () => {
    expect(calculateDrawdownDurations([])).toEqual({ maxDrawdownDurationTradingDays: null, longestRecoveryTradingDays: null });
  });

  it("单点序列 ⇒ 两项皆 null", () => {
    expect(calculateDrawdownDurations([100])).toEqual({ maxDrawdownDurationTradingDays: null, longestRecoveryTradingDays: null });
  });

  it("全期无回撤（单调上行 / 持平）⇒ 两项皆 null", () => {
    expect(calculateDrawdownDurations([100, 101, 102, 103])).toEqual({ maxDrawdownDurationTradingDays: null, longestRecoveryTradingDays: null });
    expect(calculateDrawdownDurations([100, 100, 100])).toEqual({ maxDrawdownDurationTradingDays: null, longestRecoveryTradingDays: null });
  });

  it("锁定的是最深区间，而不是最长区间（旧口径会给出 7 / 4）", () => {
    const equities = [
      100, //                          0  峰值
      98, 97, 96, 95, 96, 97, 98, //   1..7 浅而长的回撤（谷底 95 在 4）
      100, //                          8  收复
      90, //                           9  深跌
      80, //                          10  谷底（全期最深）
      85, 90, //                      11..12
      100, //                         13  收复
      102, //                         14  新高
    ];
    const result = calculateDrawdownDurations(equities);
    expect(result.maxDrawdownDurationTradingDays).toBe(2); // 8 → 10
    expect(result.longestRecoveryTradingDays).toBe(3); // 10 → 13
    expect(result.maxDrawdownDurationTradingDays).not.toBe(7); // 旧「最长区间」口径的产物
  });

  it("两项相加 = 峰值日 → 收复日 的总交易日数", () => {
    const equities = [100, 98, 97, 96, 95, 96, 97, 98, 100, 90, 80, 85, 90, 100, 102];
    const result = calculateDrawdownDurations(equities);
    expect(result.maxDrawdownDurationTradingDays! + result.longestRecoveryTradingDays!).toBe(13 - 8);
  });

  it("并列最深时取最早那一次", () => {
    // 两次回撤深度相同（都跌到 80），前一次更短、后一次更长 ⇒ 应保留更早（更短）那一次
    const equities = [100, 80, 100, 90, 80, 90, 100];
    const result = calculateDrawdownDurations(equities);
    expect(result.maxDrawdownDurationTradingDays).toBe(1); // 0 → 1
    expect(result.longestRecoveryTradingDays).toBe(1); // 1 → 2
  });

  it("期末仍未收复 ⇒ 收复用时计至期末", () => {
    const equities = [100, 90, 80, 85];
    const result = calculateDrawdownDurations(equities);
    expect(result.maxDrawdownDurationTradingDays).toBe(2); // 0 → 2
    expect(result.longestRecoveryTradingDays).toBe(1); // 2 → 3（期末）
  });

  it("最深区间落在期末且尚未收复时同样参与评选", () => {
    const equities = [100, 95, 100, 60, 50, 55];
    const result = calculateDrawdownDurations(equities);
    expect(result.maxDrawdownDurationTradingDays).toBe(2); // 2 → 4
    expect(result.longestRecoveryTradingDays).toBe(1); // 4 → 5（期末）
  });
});
