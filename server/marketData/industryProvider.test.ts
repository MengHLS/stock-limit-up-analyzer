import { describe, it, expect } from "vitest";
import {
  baostockCodeToSecurityCode,
  splitIndustryCodeName,
  parseBaostockIndustry,
  toBaostockCode,
  type BaostockIndustryRow,
} from "./providers/baostock";
import { validateIndustryIntervals, getIndustryAt } from "./industry";

describe("baostockCodeToSecurityCode（securityCode 转换）", () => {
  it("sh.600000 → 600000.SH", () => {
    expect(baostockCodeToSecurityCode("sh.600000")).toBe("600000.SH");
  });

  it("sz.000001 → 000001.SZ", () => {
    expect(baostockCodeToSecurityCode("sz.000001")).toBe("000001.SZ");
  });

  it("bj.920000 → 920000.BJ", () => {
    expect(baostockCodeToSecurityCode("bj.920000")).toBe("920000.BJ");
  });

  it("与 toBaostockCode 互为逆运算", () => {
    expect(baostockCodeToSecurityCode(toBaostockCode("600000.SH"))).toBe("600000.SH");
    expect(baostockCodeToSecurityCode(toBaostockCode("002361.SZ"))).toBe("002361.SZ");
  });

  it("非法代码抛错", () => {
    expect(() => baostockCodeToSecurityCode("600000")).toThrow();
    expect(() => baostockCodeToSecurityCode("hk.00700")).toThrow();
  });
});

describe("splitIndustryCodeName（industryCode/Name 拆分）", () => {
  it("J66货币金融服务 → code=J66 name=货币金融服务", () => {
    expect(splitIndustryCodeName("J66货币金融服务")).toEqual({ industryCode: "J66", industryName: "货币金融服务" });
  });

  it("C39计算机、通信和其他电子设备制造业 → code=C39", () => {
    expect(splitIndustryCodeName("C39计算机、通信和其他电子设备制造业")).toEqual({
      industryCode: "C39",
      industryName: "计算机、通信和其他电子设备制造业",
    });
  });

  it("纯中文名（无代码前缀）→ code 空、name 保留原文", () => {
    expect(splitIndustryCodeName("制造业")).toEqual({ industryCode: "", industryName: "制造业" });
  });

  it("空串 → 两者皆空", () => {
    expect(splitIndustryCodeName("")).toEqual({ industryCode: "", industryName: "" });
  });
});

describe("parseBaostockIndustry（BaoStock industry 行解析 + PIT）", () => {
  const row: BaostockIndustryRow = {
    updateDate: "2026-08-31",
    code: "sh.600000",
    code_name: "浦发银行",
    industry: "J66货币金融服务",
    industryClassification: "证监会行业分类",
  };

  it("解析为 IndustryAssignment：securityId=规范化代码，effectiveFrom=updateDate，effectiveTo=null", () => {
    const assignment = parseBaostockIndustry(row, "2026-09-06T00:00:00.000Z");
    expect(assignment.securityId).toBe("600000.SH");
    expect(assignment.industryCode).toBe("J66");
    expect(assignment.industryName).toBe("货币金融服务");
    expect(assignment.effectiveFrom).toBe("2026-08-31");
    expect(assignment.effectiveTo).toBeNull();
    expect(assignment.source).toBe("baostock");
    expect(assignment.retrievedAt).toBe("2026-09-06T00:00:00.000Z");
  });

  it("区间校验：单条当前快照区间 VALID（无重叠）", () => {
    const assignment = parseBaostockIndustry(row);
    const result = validateIndustryIntervals([assignment], assignment.securityId);
    expect(result.status).toBe("VALID");
  });

  it("getIndustryAt：effectiveFrom 当天及之后命中当前行业", () => {
    const assignment = parseBaostockIndustry(row);
    expect(getIndustryAt([assignment], "600000.SH", "2026-08-31")?.industryCode).toBe("J66");
    expect(getIndustryAt([assignment], "600000.SH", "2026-09-01")?.industryCode).toBe("J66");
    // effectiveFrom 之前无归属（诚实：不伪造历史行业）
    expect(getIndustryAt([assignment], "600000.SH", "2026-08-30")).toBeNull();
  });
});
