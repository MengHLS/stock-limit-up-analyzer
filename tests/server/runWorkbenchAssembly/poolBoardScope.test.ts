import { describe, expect, it } from "vitest";
import { filterPoolEventsByBoardScope } from "../../../server/runWorkbenchAssembly/datasetFromRegistry";

describe("pool event board scope", () => {
  it("main-only 过滤排除北交所，未声明时保持旧行为", () => {
    const events = [
      { boardType: "main" },
      { boardType: "bse" },
      { boardType: null },
    ];
    expect(filterPoolEventsByBoardScope(events, ["main"]).map(item => item.boardType)).toEqual(["main"]);
    expect(filterPoolEventsByBoardScope(events, undefined)).toEqual(events);
  });
});
