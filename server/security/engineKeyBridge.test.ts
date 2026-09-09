/**
 * STEP 12 — Engine Compatibility Key Bridge 专项测试（GAP-ENG-KEY）。
 * 覆盖：canonical → engineKey / engineKey → canonical / code change / code reuse /
 *       asOf 分界 / 无匹配拒绝 / 歧义抛错。
 */

import { describe, expect, it } from "vitest";
import type { SecurityIdentifier } from "./types";
import { resolveEngineKeyAt, resolveSecurityIdByEngineKey } from "./engineKeyBridge";

const SEC_A = "sec_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SEC_B = "sec_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function primary(securityId: string, exchange: "SH" | "SZ" | "BJ", code: string, effectiveFrom: string, effectiveTo: string | null): SecurityIdentifier {
  return { securityId, exchange, code, identifierType: "primary", effectiveFrom, effectiveTo, source: "test" };
}

/** 典型复用场景：代码 000029.SZ 先属于 A（2000-2020），退市后被 B 复用（2021-至今）。 */
function reuseHistory(): SecurityIdentifier[] {
  return [
    primary(SEC_A, "SZ", "000029", "2000-06-01", "2020-09-30"),
    primary(SEC_B, "SZ", "000029", "2021-05-10", null),
  ];
}

/** 代码变更场景：SEC_B 原名 000030.SZ，后改名 300030.SZ。 */
function codeChangeHistory(): SecurityIdentifier[] {
  return [
    primary(SEC_B, "SZ", "000030", "2019-01-02", "2020-11-05"),
    primary(SEC_B, "SZ", "300030", "2020-11-06", null),
  ];
}

describe("resolveEngineKeyAt（canonical securityId → 引擎兼容键 stockCode）", () => {
  it("在生效区间内解析为 canonical stockCode", () => {
    const result = resolveEngineKeyAt(codeChangeHistory(), SEC_B, "2021-03-01");
    expect(result).toMatchObject({ ok: true, securityId: SEC_B, engineKey: "300030.SZ", code: "300030", exchange: "SZ", asOf: "2021-03-01" });
  });

  it("同一 security 更名：不同 asOf 解析到不同引擎键（确定性 + PIT-safe）", () => {
    const before = resolveEngineKeyAt(codeChangeHistory(), SEC_B, "2020-01-10");
    const after = resolveEngineKeyAt(codeChangeHistory(), SEC_B, "2021-01-10");
    expect(before).toMatchObject({ ok: true, engineKey: "000030.SZ" });
    expect(after).toMatchObject({ ok: true, engineKey: "300030.SZ" });
  });

  it("code reuse 下两个不同 security 在各自区间都能解析（不会错误合并）", () => {
    const a = resolveEngineKeyAt(reuseHistory(), SEC_A, "2019-06-01");
    const b = resolveEngineKeyAt(reuseHistory(), SEC_B, "2024-06-01");
    expect(a).toMatchObject({ ok: true, engineKey: "000029.SZ", securityId: SEC_A });
    expect(b).toMatchObject({ ok: true, engineKey: "000029.SZ", securityId: SEC_B });
    // 关键：两者引擎键相同但 canonical identity 不同 → 引擎键不是永久身份的证据。
    expect(a.ok && b.ok && a.engineKey === b.engineKey && a.securityId !== b.securityId).toBe(true);
  });

  it("asOf 落在两个区间之间的空档 → NO_IDENTIFIER（拒绝猜测）", () => {
    const result = resolveEngineKeyAt(reuseHistory(), SEC_A, "2020-12-01");
    expect(result).toEqual({ ok: false, reason: "NO_IDENTIFIER" });
  });

  it("完全未知的 securityId → NO_IDENTIFIER", () => {
    expect(resolveEngineKeyAt(reuseHistory(), "sec_unknown", "2020-01-01")).toEqual({ ok: false, reason: "NO_IDENTIFIER" });
  });

  it("同一 securityId 在 asOf 有多个重叠区间（数据错误）→ AMBIGUOUS", () => {
    const broken = [
      primary(SEC_A, "SZ", "000001", "2019-01-01", "2021-12-31"),
      primary(SEC_A, "SZ", "000002", "2021-06-01", null),
    ];
    const result = resolveEngineKeyAt(broken, SEC_A, "2021-09-01");
    expect(result).toMatchObject({ ok: false, reason: "AMBIGUOUS" });
  });
});

describe("resolveSecurityIdByEngineKey（引擎兼容键 → canonical securityId）", () => {
  it("在生效区间内解析出对应 securityId", () => {
    const result = resolveSecurityIdByEngineKey(codeChangeHistory(), "300030.SZ", "2021-03-01");
    expect(result).toMatchObject({ ok: true, securityId: SEC_B, engineKey: "300030.SZ" });
  });

  it("code reuse：同一引擎键在前后区间解析到不同 security（反推方向也 asOf-safe）", () => {
    const before = resolveSecurityIdByEngineKey(reuseHistory(), "000029.SZ", "2019-06-01");
    const after = resolveSecurityIdByEngineKey(reuseHistory(), "000029.SZ", "2024-06-01");
    expect(before).toMatchObject({ ok: true, securityId: SEC_A });
    expect(after).toMatchObject({ ok: true, securityId: SEC_B });
    expect(before.ok && after.ok && before.securityId !== after.securityId).toBe(true);
  });

  it("空档期 → NO_IDENTIFIER（退市后、复用前不能解析出任何身份）", () => {
    expect(resolveSecurityIdByEngineKey(reuseHistory(), "000029.SZ", "2020-12-01")).toEqual({ ok: false, reason: "NO_IDENTIFIER" });
  });

  it("非法引擎键抛错（不静默猜测）", () => {
    expect(() => resolveSecurityIdByEngineKey(reuseHistory(), "abc", "2020-01-01")).toThrow();
  });

  it("多行指向不同 securityId（数据错误）→ AMBIGUOUS", () => {
    const broken = [
      primary(SEC_A, "SZ", "000029", "2019-01-01", "2021-12-31"),
      primary(SEC_B, "SZ", "000029", "2021-06-01", null),
    ];
    expect(resolveSecurityIdByEngineKey(broken, "000029.SZ", "2021-09-01")).toMatchObject({ ok: false, reason: "AMBIGUOUS" });
  });
});
