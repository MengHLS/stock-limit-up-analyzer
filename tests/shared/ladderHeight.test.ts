import { describe, expect, it } from "vitest";
import { ladderHeight } from "../../shared/ladderHeight";

/**
 * 梯队「高度」口径 = **「若该股本日涨停，会达到的连板数」**。
 * 期望值不是凭空写的：断板股那部分来自与用户参考工具（附件 `QQ20260918-230855.png`）的逐格对拍，
 * 原始数据见 `docs/evidence/_probe_ladder_height_caliber.out.json`；
 * 「首板未续 +1」来自 2026-09-19 用户裁定（上一版从附件图推断「不 +1」，已作废）。
 */
describe("连板梯队高度（若本日涨停会达到的连板数）", () => {
  it("本日仍涨停（连板股 / 首板股）：高度 = 本日连板数，不 +1", () => {
    expect(ladderHeight({ boards: 1 })).toBe(1);
    expect(ladderHeight({ boards: 2 })).toBe(2);
    expect(ladderHeight({ boards: 4 })).toBe(4);
  });

  it("连板中断：高度 = 上一记录交易日连板数 + 1", () => {
    expect(ladderHeight({ boards: 2, brokenKind: "connection" })).toBe(3);
    expect(ladderHeight({ boards: 3, brokenKind: "connection" })).toBe(4);
    expect(ladderHeight({ boards: 5, brokenKind: "connection" })).toBe(6);
  });

  it("首板未续：同样 +1 ⇒ 落到 2 板行（用户裁定，2026-09-19）", () => {
    expect(ladderHeight({ boards: 1, brokenKind: "first" })).toBe(2);
  });

  it("口径唯一：任何断板股都比其已实现板数高一级、任何当日涨停股都不变", () => {
    const brokenBoards = [1, 2, 3, 5, 9];
    expect(brokenBoards.map((boards) => ladderHeight({ boards, brokenKind: "first" }))).toEqual([2, 3, 4, 6, 10]);
    expect(brokenBoards.map((boards) => ladderHeight({ boards, brokenKind: "connection" }))).toEqual([2, 3, 4, 6, 10]);
    expect(brokenBoards.map((boards) => ladderHeight({ boards }))).toEqual(brokenBoards);
  });

  it("2026-09-18 对拍：五只断板股上行一位，四只涨停股原地不动", () => {
    // 断板股（库里已实现板数来自逐日连板链，见 boardRoster 的 boardsAt）
    const broken = [
      { name: "澳弘电子", achieved: 5 },
      { name: "中晶科技", achieved: 3 },
      { name: "共达电声", achieved: 2 },
      { name: "中岩大地", achieved: 2 },
      { name: "万向德农", achieved: 2 },
    ];
    expect(broken.map((item) => ladderHeight({ boards: item.achieved, brokenKind: "connection" }))).toEqual([6, 4, 3, 3, 3]);
    // 当日涨停股：高度 = 本日连板数（华瓷股份 / 锡华科技 4 板，世联行 / 内蒙新华 3 板）
    expect([4, 4, 3, 3].map((boards) => ladderHeight({ boards }))).toEqual([4, 4, 3, 3]);
  });
});
