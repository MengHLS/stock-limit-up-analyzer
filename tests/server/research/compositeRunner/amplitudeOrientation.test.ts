/**
 * `TAIL-SELECTION-002` — 3F 取向翻转（`compositeRunner` 层）测试锁。
 *
 * 锁两件事：
 *   ① **缺省逐位不变**：`"LOW"` 是恒等变换 ⇒ 生产路径与既有留档零漂移；
 *   ② **`"HIGH"` 是取向翻转**：取补 `1 − score`，且与冻结契约的
 *      「三个方向全部翻转」在数学上等价（`1 − Σ(oriented)/3 = Σ(1 − oriented)/3`）。
 *
 * 🔴 冻结契约 `FROZEN-BUCKET-CONTRACT-001` **未被修改** —— 本函数只做取补，
 * 桶边界与方向表仍在 `recipeFeatures/threeFactorScoreFeatures.ts` 原处不动。
 */

import { describe, expect, it } from "vitest";
import { orientAmplitudeScore } from "../../../../server/research/compositeRunner/index";

describe("TAIL-SELECTION-002 · compositeRunner 取向变换", () => {
  it("缺省 LOW 是恒等变换（既有行为逐位不变）", () => {
    for (const score of [0, 0.1, 0.25, 1 / 3, 0.5, 2 / 3, 0.9, 1]) {
      expect(orientAmplitudeScore(score, "LOW")).toBe(score);
    }
  });

  it("HIGH 是取补：orient(s, HIGH) = 1 − s", () => {
    for (const score of [0, 0.1, 0.25, 1 / 3, 0.5, 2 / 3, 0.9, 1]) {
      expect(orientAmplitudeScore(score, "HIGH")).toBeCloseTo(1 - score, 12);
    }
  });

  it("双重翻转回到原值（对合性）、且翻转严格反序（TopN 变成 BottomN）", () => {
    for (const score of [0.1, 1 / 3, 0.5, 0.75]) {
      expect(orientAmplitudeScore(orientAmplitudeScore(score, "HIGH"), "HIGH")).toBeCloseTo(score, 12);
    }
    // 严格反序 ⇒ 取 topN(1−s) ≡ 取 bottomN(s)：选中集合与破平顺序完全一致。
    const scores = [0.1, 0.9, 0.5, 0.75, 1 / 3];
    const byLow = [...scores].sort((a, b) => orientAmplitudeScore(b, "LOW") - orientAmplitudeScore(a, "LOW"));
    const byHigh = [...scores].sort((a, b) => orientAmplitudeScore(b, "HIGH") - orientAmplitudeScore(a, "HIGH"));
    expect(byHigh).toEqual([...byLow].reverse());
  });

  it("与「三个方向全部翻转」等价：1 − mean(oriented) = mean(1 − oriented)", () => {
    // 用三个代表值模拟三因子桶位分；翻转取向 = 每个分项取补。
    const triples: ReadonlyArray<readonly [number, number, number]> = [
      [0.2, 0.4, 0.9],
      [0, 0, 0],
      [1, 1, 1],
      [1 / 3, 2 / 3, 0.5],
    ];
    for (const [a, b, c] of triples) {
      const frozen = (a + b + c) / 3;
      const flipped = (1 - a + (1 - b) + (1 - c)) / 3;
      expect(orientAmplitudeScore(frozen, "HIGH")).toBeCloseTo(flipped, 12);
    }
  });
});
