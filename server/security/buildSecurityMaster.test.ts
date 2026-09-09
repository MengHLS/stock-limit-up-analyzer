/**
 * STEP 7.4 — Security Master 构建器测试（确定性 id / 构建 / code reuse）。
 */

import { describe, expect, it } from "vitest";
import {
  buildSecurityMasterFromNameChanges,
  buildSecurityMasterFromStockBasic,
  splitNameChangeSegments,
} from "./buildSecurityMaster";
import { generateDeterministicSecurityId, securityIdAnchorForTsCode } from "./deterministicId";
import { detectCodeReuse } from "./identifierHistory";
import type { NameChangeRecord } from "./namechange";
import type { ProviderSecurityRecord } from "./provider";
import { isValidSecurityId } from "./securityId";

describe("确定性 security_id", () => {
  it("同一锚点恒定产出同一 id，且通过格式校验", () => {
    const a = generateDeterministicSecurityId(securityIdAnchorForTsCode("SH", "600000"));
    const b = generateDeterministicSecurityId(securityIdAnchorForTsCode("SH", "600000"));
    expect(a).toBe(b);
    expect(isValidSecurityId(a)).toBe(true);
  });

  it("不同锚点产出不同 id", () => {
    const a = generateDeterministicSecurityId(securityIdAnchorForTsCode("SH", "600000"));
    const b = generateDeterministicSecurityId(securityIdAnchorForTsCode("SZ", "000001"));
    expect(a).not.toBe(b);
  });
});

function stockRecord(overrides: Partial<ProviderSecurityRecord> & Pick<ProviderSecurityRecord, "exchange" | "code">): ProviderSecurityRecord {
  return {
    name: "示例",
    securityType: "stock",
    listedDate: "2000-01-01",
    delistedDate: null,
    status: "listed",
    source: "tushare_stock_basic",
    ...overrides,
  };
}

describe("buildSecurityMasterFromStockBasic", () => {
  it("构建上市 + 退市证券的 primary 标识符（退市区间闭合）", () => {
    const records = [
      stockRecord({ exchange: "SH", code: "600000", listedDate: "1999-11-10", status: "listed" }),
      stockRecord({ exchange: "SH", code: "600777", listedDate: "1990-01-01", delistedDate: "2022-01-01", status: "delisted" }),
    ];
    const result = buildSecurityMasterFromStockBasic(records);

    expect(result.securities).toHaveLength(2);
    expect(result.identifiers).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);

    const delisted = result.identifiers.find((i) => i.code === "600777")!;
    expect(delisted.effectiveFrom).toBe("1990-01-01");
    expect(delisted.effectiveTo).toBe("2022-01-01");

    const listed = result.identifiers.find((i) => i.code === "600000")!;
    expect(listed.effectiveTo).toBeNull();
  });

  it("缺少上市日期的记录被拒绝", () => {
    const result = buildSecurityMasterFromStockBasic([
      stockRecord({ exchange: "SH", code: "600000", listedDate: null }),
    ]);
    expect(result.securities).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("上市日期");
  });
});

describe("splitNameChangeSegments", () => {
  it("连续名称区间不拆分", () => {
    const group: NameChangeRecord[] = [
      { exchange: "SZ", code: "000001", tsCode: "000001.SZ", name: "平安银行", effectiveFrom: "2012-08-02", effectiveTo: null, annDate: null, changeReason: "其他" },
      { exchange: "SZ", code: "000001", tsCode: "000001.SZ", name: "深发展A", effectiveFrom: "1991-04-03", effectiveTo: "2012-08-01", annDate: null, changeReason: "其他" },
    ];
    const segments = splitNameChangeSegments(group);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.effectiveFrom).toBe("1991-04-03");
    expect(segments[0]!.effectiveTo).toBeNull();
  });

  it("区间出现缺口 → 拆分为代码复用段", () => {
    const group: NameChangeRecord[] = [
      { exchange: "SH", code: "600001", tsCode: "600001.SH", name: "新公司", effectiveFrom: "2005-06-01", effectiveTo: null, annDate: null, changeReason: "其他" },
      { exchange: "SH", code: "600001", tsCode: "600001.SH", name: "旧公司", effectiveFrom: "1990-01-01", effectiveTo: "2000-12-31", annDate: null, changeReason: "其他" },
    ];
    const segments = splitNameChangeSegments(group);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.effectiveTo).toBe("2000-12-31");
    expect(segments[1]!.effectiveFrom).toBe("2005-06-01");
  });
});

describe("buildSecurityMasterFromNameChanges + code reuse", () => {
  it("缺口拆分为两个 security_id，detectCodeReuse 识别到 1 条复用", () => {
    const nameChanges: NameChangeRecord[] = [
      { exchange: "SH", code: "600001", tsCode: "600001.SH", name: "新公司", effectiveFrom: "2005-06-01", effectiveTo: null, annDate: null, changeReason: "其他" },
      { exchange: "SH", code: "600001", tsCode: "600001.SH", name: "旧公司", effectiveFrom: "1990-01-01", effectiveTo: "2000-12-31", annDate: null, changeReason: "其他" },
    ];
    const result = buildSecurityMasterFromNameChanges(nameChanges);

    expect(result.securities).toHaveLength(2);
    expect(result.identifiers).toHaveLength(2);

    const reuse = detectCodeReuse(result.identifiers);
    expect(reuse).toHaveLength(1);
    expect(reuse[0]!.code).toBe("600001");
    expect(reuse[0]!.securityIds).toHaveLength(2);
  });

  it("无缺口 → 单证券、无复用", () => {
    const nameChanges: NameChangeRecord[] = [
      { exchange: "SZ", code: "000001", tsCode: "000001.SZ", name: "平安银行", effectiveFrom: "2012-08-02", effectiveTo: null, annDate: null, changeReason: "其他" },
      { exchange: "SZ", code: "000001", tsCode: "000001.SZ", name: "深发展A", effectiveFrom: "1991-04-03", effectiveTo: "2012-08-01", annDate: null, changeReason: "其他" },
    ];
    const result = buildSecurityMasterFromNameChanges(nameChanges);
    expect(result.securities).toHaveLength(1);
    expect(result.identifiers).toHaveLength(1);
    expect(result.securities[0]!.status).toBe("listed");
    expect(detectCodeReuse(result.identifiers)).toHaveLength(0);
  });
});
