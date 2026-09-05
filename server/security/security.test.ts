/**
 * STEP 7.4 — Security Identity Layer 核心测试。
 * 覆盖：security_id 稳定性 / code & exchange 解析 / BJ·SH·SZ / identifier history /
 *       effective interval / code reuse / listed & delisted date / as-of lookup /
 *       current vs historical universe / survivorship-safe lookup。
 */

import { describe, expect, it } from "vitest";
import { inferStockExchangeSuffix, normalizeStockCode } from "../stockIdentity";
import {
  addDays,
  canonicalCode,
  compareDate,
  detectCodeReuse,
  generateSecurityId,
  inferExchange,
  intervalContains,
  intervalsOverlap,
  isValidSecurityId,
  normalizeSecurityCode,
  parseSecurityCode,
  SecurityMasterStore,
  validateIdentifierHistory,
} from "./index";
import type { Security, SecurityIdentifier } from "./index";

function sec(overrides: Partial<Security> = {}): Security {
  return {
    securityId: generateSecurityId(),
    securityType: "stock",
    exchange: "SH",
    currency: "CNY",
    country: "CN",
    status: "listed",
    listedDate: "2019-01-02",
    delistedDate: null,
    ...overrides,
  };
}

function ident(overrides: Partial<SecurityIdentifier> = {}): SecurityIdentifier {
  return {
    securityId: "sec_00000000-0000-4000-8000-000000000000",
    exchange: "SH",
    code: "600000",
    identifierType: "primary",
    effectiveFrom: "2019-01-02",
    effectiveTo: null,
    source: "test",
    ...overrides,
  };
}

describe("security_id 永久身份", () => {
  it("生成合法且唯一的 security_id", () => {
    const a = generateSecurityId();
    const b = generateSecurityId();
    expect(isValidSecurityId(a)).toBe(true);
    expect(isValidSecurityId(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("拒绝非法 security_id", () => {
    expect(isValidSecurityId("")).toBe(false);
    expect(isValidSecurityId("600000.SH")).toBe(false);
    expect(isValidSecurityId("sec_123")).toBe(false);
  });

  it("代码变更不改变 security_id（同一证券换代码）", () => {
    const store = new SecurityMasterStore();
    const securityId = generateSecurityId();
    store.upsertSecurity(sec({ securityId, exchange: "SZ", listedDate: "2015-06-01" }));
    store.addIdentifier({ securityId, exchange: "SZ", code: "000001", identifierType: "primary", effectiveFrom: "2015-06-01", effectiveTo: null, source: "test" });
    store.linkCodeChange(securityId, "SZ", "000002", "2024-03-01", "manual");

    expect(store.getSecurity(securityId)?.securityId).toBe(securityId);
    expect(store.resolveByCode("SZ", "000001", "2023-12-31")?.securityId).toBe(securityId);
    expect(store.resolveByCode("SZ", "000002", "2024-03-01")?.securityId).toBe(securityId);
  });
});

describe("证券代码解析", () => {
  it("解析裸 6 位数字", () => {
    expect(parseSecurityCode("600000")).toEqual({ digits: "600000", exchange: "SH" });
  });
  it("解析带后缀（大写）", () => {
    expect(parseSecurityCode("600000.SH")).toEqual({ digits: "600000", exchange: "SH" });
  });
  it("解析小写与空白", () => {
    expect(parseSecurityCode(" 600000.sh ")).toEqual({ digits: "600000", exchange: "SH" });
  });
  it("解析交易所前缀形态", () => {
    expect(parseSecurityCode("sz000001")).toEqual({ digits: "000001", exchange: "SZ" });
  });
  it("拒绝后缀与代码前缀冲突", () => {
    expect(() => parseSecurityCode("600000.SZ")).toThrow();
  });
  it("拒绝非法输入", () => {
    expect(() => parseSecurityCode("abc")).toThrow();
    expect(() => parseSecurityCode("12345")).toThrow();
  });
  it("canonical 表示", () => {
    expect(normalizeSecurityCode("600000")).toBe("600000.SH");
    expect(canonicalCode({ digits: "920001", exchange: "BJ" })).toBe("920001.BJ");
  });
});

describe("交易所推断", () => {
  it("SH：6 开头", () => {
    expect(inferExchange("600000")).toBe("SH");
    expect(inferExchange("688001")).toBe("SH");
    expect(inferExchange("601318")).toBe("SH");
  });
  it("SZ：0/3 开头", () => {
    expect(inferExchange("000001")).toBe("SZ");
    expect(inferExchange("300001")).toBe("SZ");
    expect(inferExchange("002361")).toBe("SZ");
  });
  it("BJ：92/4/8 开头", () => {
    expect(inferExchange("920001")).toBe("BJ");
    expect(inferExchange("430001")).toBe("BJ");
    expect(inferExchange("830001")).toBe("BJ");
    expect(inferExchange("870001")).toBe("BJ");
    expect(inferExchange("400001")).toBe("BJ");
    expect(inferExchange("800001")).toBe("BJ");
  });
  it("无法识别前缀抛错", () => {
    expect(() => inferExchange("200001")).toThrow();
  });
});

describe("BJ / SH / SZ 完整支持", () => {
  it("BJ 规范表示", () => {
    expect(parseSecurityCode("920001.BJ")).toEqual({ digits: "920001", exchange: "BJ" });
    expect(normalizeSecurityCode("920001.BJ")).toBe("920001.BJ");
  });
  it("SH 规范表示", () => {
    expect(normalizeSecurityCode("600000.SH")).toBe("600000.SH");
  });
  it("SZ 规范表示", () => {
    expect(normalizeSecurityCode("000001.SZ")).toBe("000001.SZ");
  });
});

describe("与历史 stockIdentity 语义一致", () => {
  it("normalizeStockCode 与 normalizeSecurityCode 等价", () => {
    for (const input of ["600272", "600272.SH", "000001", "000001.SZ", "920001", "920001.BJ"]) {
      expect(normalizeStockCode(input)).toBe(normalizeSecurityCode(input));
    }
  });
  it("inferStockExchangeSuffix 与 inferExchange 等价", () => {
    for (const digits of ["600000", "000001", "300001", "920001", "430001", "830001"]) {
      expect(inferStockExchangeSuffix(digits)).toBe(inferExchange(digits));
    }
  });
});

describe("标识符历史（identifier history）", () => {
  it("记录与检索", () => {
    const store = new SecurityMasterStore();
    const securityId = generateSecurityId();
    store.upsertSecurity(sec({ securityId, exchange: "SH" }));
    store.addIdentifier({ securityId, exchange: "SH", code: "600000", identifierType: "primary", effectiveFrom: "2019-01-02", effectiveTo: null, source: "test" });
    expect(store.identifiersOf(securityId)).toHaveLength(1);
    expect(store.resolveByCode("SH", "600000", "2023-01-01")?.securityId).toBe(securityId);
  });

  it("同一 code 在不同区间对应不同 security_id（代码复用）", () => {
    const store = new SecurityMasterStore();
    const oldId = generateSecurityId();
    const newId = generateSecurityId();
    store.upsertSecurity(sec({ securityId: oldId, exchange: "SZ", listedDate: "2010-01-01", delistedDate: "2020-12-31", status: "delisted" }));
    store.upsertSecurity(sec({ securityId: newId, exchange: "SZ", listedDate: "2022-06-01" }));
    store.addIdentifier({ securityId: oldId, exchange: "SZ", code: "000777", identifierType: "primary", effectiveFrom: "2010-01-01", effectiveTo: "2020-12-31", source: "test" });
    store.addIdentifier({ securityId: newId, exchange: "SZ", code: "000777", identifierType: "primary", effectiveFrom: "2022-06-01", effectiveTo: null, source: "test" });

    expect(store.resolveByCode("SZ", "000777", "2015-01-01")?.securityId).toBe(oldId);
    expect(store.resolveByCode("SZ", "000777", "2023-01-01")?.securityId).toBe(newId);
    const reuse = store.codeReuse();
    expect(reuse).toHaveLength(1);
    expect(reuse[0]!.code).toBe("000777");
    expect(reuse[0]!.securityIds.sort()).toEqual([newId, oldId].sort());
  });
});

describe("有效区间（effective interval）", () => {
  it("intervalContains 闭区间语义", () => {
    expect(intervalContains("2019-01-02", null, "2020-01-01")).toBe(true);
    expect(intervalContains("2019-01-02", "2020-12-31", "2020-12-31")).toBe(true);
    expect(intervalContains("2019-01-02", "2020-12-31", "2021-01-01")).toBe(false);
    expect(intervalContains("2019-01-02", "2020-12-31", "2019-01-01")).toBe(false);
  });

  it("intervalsOverlap 判定", () => {
    expect(intervalsOverlap("2020-01-01", "2020-12-31", "2020-06-01", "2021-06-01")).toBe(true);
    expect(intervalsOverlap("2020-01-01", "2020-12-31", "2021-01-01", null)).toBe(false);
    expect(intervalsOverlap("2020-01-01", null, "2021-01-01", null)).toBe(true);
  });

  it("重叠区间校验抛错", () => {
    const history = [
      ident({ effectiveFrom: "2020-01-01", effectiveTo: "2020-12-31" }),
      ident({ effectiveFrom: "2020-06-01", effectiveTo: null }),
    ];
    expect(() => validateIdentifierHistory(history)).toThrow(/重叠/);
  });

  it("不重叠区间通过校验", () => {
    const history = [
      ident({ effectiveFrom: "2020-01-01", effectiveTo: "2020-12-31" }),
      ident({ effectiveFrom: "2021-01-01", effectiveTo: null }),
    ];
    expect(() => validateIdentifierHistory(history)).not.toThrow();
  });
});

describe("上市 / 退市日期", () => {
  it("addDays 与 compareDate", () => {
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(compareDate("2022-06-17", "2022-06-17")).toBe(0);
    expect(compareDate("2022-06-16", "2022-06-17")).toBeLessThan(0);
  });

  it("未上市证券不出现在 as-of universe", () => {
    const store = new SecurityMasterStore();
    const securityId = generateSecurityId();
    store.upsertSecurity(sec({ securityId, exchange: "SZ", listedDate: "2024-06-01" }));
    store.addIdentifier({ securityId, exchange: "SZ", code: "001001", identifierType: "primary", effectiveFrom: "2024-06-01", effectiveTo: null, source: "test" });
    expect(store.asOfUniverse("2024-01-01")).toHaveLength(0);
    expect(store.asOfUniverse("2024-07-01")).toHaveLength(1);
  });

  it("已退市证券不出现在退市之后的 as-of universe", () => {
    const store = new SecurityMasterStore();
    const securityId = generateSecurityId();
    store.upsertSecurity(sec({ securityId, exchange: "SH", listedDate: "2015-01-01", delistedDate: "2022-12-31", status: "delisted" }));
    store.addIdentifier({ securityId, exchange: "SH", code: "600777", identifierType: "primary", effectiveFrom: "2015-01-01", effectiveTo: "2022-12-31", source: "test" });
    expect(store.asOfUniverse("2022-12-31")).toHaveLength(1);
    expect(store.asOfUniverse("2023-01-01")).toHaveLength(0);
  });
});

describe("as-of lookup 与 survivorship", () => {
  it("as-of 解析返回正确证券", () => {
    const store = new SecurityMasterStore();
    const securityId = generateSecurityId();
    store.upsertSecurity(sec({ securityId, exchange: "SH", listedDate: "2018-01-01" }));
    store.addIdentifier({ securityId, exchange: "SH", code: "600001", identifierType: "primary", effectiveFrom: "2018-01-01", effectiveTo: null, source: "test" });
    expect(store.resolveByCode("SH", "600001", "2022-06-17")?.securityId).toBe(securityId);
    expect(store.resolveByCode("SH", "600001", "2017-01-01")).toBeNull();
  });

  it("current universe != historical universe（survivorship 基础）", () => {
    const store = new SecurityMasterStore();
    const delistedId = generateSecurityId();
    const listedId = generateSecurityId();
    store.upsertSecurity(sec({ securityId: delistedId, exchange: "SH", listedDate: "2010-01-01", delistedDate: "2020-12-31", status: "delisted" }));
    store.upsertSecurity(sec({ securityId: listedId, exchange: "SZ", listedDate: "2021-01-01" }));
    store.addIdentifier({ securityId: delistedId, exchange: "SH", code: "600001", identifierType: "primary", effectiveFrom: "2010-01-01", effectiveTo: "2020-12-31", source: "test" });
    store.addIdentifier({ securityId: listedId, exchange: "SZ", code: "000002", identifierType: "primary", effectiveFrom: "2021-01-01", effectiveTo: null, source: "test" });

    const historical = store.asOfUniverse("2019-01-01").map((s) => s.securityId).sort();
    const current = store.asOfUniverse("2024-01-01").map((s) => s.securityId).sort();
    expect(historical).toEqual([delistedId]);
    expect(current).toEqual([listedId]);
    expect(historical).not.toEqual(current);
  });

  it("survivorship-safe：退市证券仍可按历史日期解析，但不属于当前 universe", () => {
    const store = new SecurityMasterStore();
    const delistedId = generateSecurityId();
    store.upsertSecurity(sec({ securityId: delistedId, exchange: "SZ", listedDate: "2012-01-01", delistedDate: "2019-12-31", status: "delisted" }));
    store.addIdentifier({ securityId: delistedId, exchange: "SZ", code: "000999", identifierType: "primary", effectiveFrom: "2012-01-01", effectiveTo: "2019-12-31", source: "test" });

    expect(store.resolveByCode("SZ", "000999", "2018-06-01")?.securityId).toBe(delistedId);
    expect(store.asOfUniverse("2023-01-01")).toHaveLength(0);
  });
});

describe("detectCodeReuse（纯函数）", () => {
  it("无复用时返回空数组", () => {
    const history = [
      ident({ securityId: "sec_00000000-0000-4000-8000-000000000000", code: "600000" }),
    ];
    expect(detectCodeReuse(history)).toHaveLength(0);
  });
});
