import { describe, expect, it } from "vitest";
import { baseSecurityIdOf, eventScopedSecurityId } from "../../server/eventIdentity";

describe("baseSecurityIdOf", () => {
  it("剥离事件窗作用域，回到 canonical securityId", () => {
    expect(baseSecurityIdOf(eventScopedSecurityId("sec_aaa", "600000.SH@2025-01-02")))
      .toBe("sec_aaa");
  });

  it("剥离首板池作用域，保证成交 K 线能解析代码/名称", () => {
    expect(baseSecurityIdOf("sec_aaa::pool:600000.SH@2025-01-02"))
      .toBe("sec_aaa");
  });

  it("普通 canonical securityId 原样返回", () => {
    expect(baseSecurityIdOf("sec_aaa")).toBe("sec_aaa");
  });
});
