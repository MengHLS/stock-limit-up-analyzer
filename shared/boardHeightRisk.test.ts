import { describe, expect, it } from "vitest";
import {
  BOARD_HEIGHT_RISK_MAX_TIER_FROM,
  DEFAULT_MAX_PARTICIPATING_BOARDS,
  boardHeightPositionScale,
  boardHeightRiskContribution,
  boardHeightRiskLadder,
  describeBoardHeightRisk,
  isBoardParticipationRestricted,
  isHighBoard,
  normalizeBoards,
} from "./boardHeightRisk";

describe("高位连板风险梯度", () => {
  it("2 板及以下不扣分，3 板起单调递增，5/6 板显著重于 4 板", () => {
    const contributions = [1, 2, 3, 4, 5, 6, 7, 8].map((boards) => boardHeightRiskContribution(boards));
    expect(contributions[0]).toBe(0);
    expect(contributions[1]).toBe(5);
    // 3~7 板严格递增；7 板起封顶（风险分本身有 100 上限，不再无限增长）。
    for (let index = 3; index <= 6; index += 1) {
      expect(contributions[index]!).toBeGreaterThan(contributions[index - 1]!);
    }
    const four = boardHeightRiskContribution(4);
    const five = boardHeightRiskContribution(5);
    const six = boardHeightRiskContribution(6);
    expect(five).toBeGreaterThan(four);
    expect(six).toBeGreaterThan(five);
    expect(boardHeightRiskContribution(7)).toBe(boardHeightRiskContribution(12));
  });

  it("暴露给前端的梯度表按板数升序，且与判定函数自洽", () => {
    const ladder = boardHeightRiskLadder();
    expect(ladder.map((step) => step.minBoards)).toEqual([...ladder.map((step) => step.minBoards)].sort((left, right) => left - right));
    for (const step of ladder) {
      expect(boardHeightRiskContribution(step.minBoards)).toBe(step.contribution);
    }
    expect(ladder.at(-1)!.minBoards).toBe(BOARD_HEIGHT_RISK_MAX_TIER_FROM);
  });

  it("非法连板高度按 1 板兜底，不产生 NaN 风险分", () => {
    expect(normalizeBoards(Number.NaN)).toBe(1);
    expect(normalizeBoards(0)).toBe(1);
    expect(normalizeBoards(-3)).toBe(1);
    expect(normalizeBoards(4.9)).toBe(4);
    expect(boardHeightRiskContribution(Number.NaN)).toBe(0);
  });
});

describe("高位连板参与上限与仓位缩放", () => {
  it("默认上限 6 板：6 板允许参与，7 板起限制参与", () => {
    expect(DEFAULT_MAX_PARTICIPATING_BOARDS).toBe(6);
    expect(isBoardParticipationRestricted(5)).toBe(false);
    expect(isBoardParticipationRestricted(6)).toBe(false);
    expect(isBoardParticipationRestricted(7)).toBe(true);
    // 上限可配置：放宽到 8 板后 7 板恢复参与。
    expect(isBoardParticipationRestricted(7, 8)).toBe(false);
  });

  it("未越上限的高位标的按下调系数降低仓位，越上限返回 0", () => {
    expect(boardHeightPositionScale(1)).toBe(1);
    expect(boardHeightPositionScale(4)).toBe(1);
    expect(boardHeightPositionScale(5)).toBe(0.6);
    expect(boardHeightPositionScale(6)).toBe(0.3);
    expect(boardHeightPositionScale(7)).toBe(0);
    // 上限放宽后同一高度不再被限制参与，但仍按档位降仓。
    expect(boardHeightPositionScale(7, 8)).toBe(0.3);
  });

  it("高位连板判定从 4 板开始，且与说明文案一致", () => {
    expect(isHighBoard(3)).toBe(false);
    expect(isHighBoard(4)).toBe(true);
    expect(describeBoardHeightRisk(5)).toContain("降低仓位");
    expect(describeBoardHeightRisk(8)).toContain("限制参与");
    expect(describeBoardHeightRisk(2)).toContain("允许区间内");
  });
});
