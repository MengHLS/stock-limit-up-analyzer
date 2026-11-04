import { describe, expect, it } from "vitest";
import {
  classifyRegulationAnnouncement,
  primaryRegulationEventType,
} from "../../../../server/research/regulationEvents/announcementClassifier";

describe("regulation announcement classifier", () => {
  it("classifies combined abnormal volatility and risk warning announcement", () => {
    const types = classifyRegulationAnnouncement("股票交易异常波动暨风险提示公告");
    expect(types).toEqual(["abnormal_volatility", "risk_warning"]);
    expect(primaryRegulationEventType(types)).toBe("abnormal_volatility");
  });

  it("classifies severe abnormal volatility with highest priority", () => {
    const types = classifyRegulationAnnouncement("股票交易严重异常波动暨风险提示公告");
    expect(types).toContain("severe_abnormal_volatility");
    expect(primaryRegulationEventType(types)).toBe("severe_abnormal_volatility");
  });

  it("classifies inquiry and resumption announcements", () => {
    expect(classifyRegulationAnnouncement("关于股票交易异常波动的问询函的回函")).toContain(
      "regulatory_inquiry_or_letter",
    );
    expect(classifyRegulationAnnouncement("关于公司股票复牌的公告")).toContain("resumption");
  });

  it("ignores unrelated announcements", () => {
    expect(classifyRegulationAnnouncement("关于2026年度日常关联交易的公告")).toEqual([]);
    expect(primaryRegulationEventType([])).toBeNull();
  });
});