import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PANEL = readFileSync(
  resolve(process.cwd(), "client/src/components/strategy/StrategyFamilyPanel.tsx"),
  "utf8",
);
const DETAIL = readFileSync(
  resolve(process.cwd(), "client/src/pages/StrategyDetail.tsx"),
  "utf8",
);

describe("StrategyFamilyPanel", () => {
  it("从服务端读取已注册族，不复制族参数定义", () => {
    expect(PANEL).toContain("listFamilies");
    expect(PANEL).toContain("materializeFamily");
    expect(PANEL).toContain("createFromFamily");
    expect(PANEL).toContain("createVersionFromFamily");
    expect(PANEL).not.toContain("ROLLING_THREE_FACTOR_CALIBRATION");
  });

  it("在策略详情页提供模式族配置入口", () => {
    expect(DETAIL).toContain("StrategyFamilyPanel");
    expect(DETAIL).toContain("currentStrategyId={strategyId}");
  });
});
