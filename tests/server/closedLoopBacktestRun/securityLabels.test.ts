/**
 * 成交明细「证券名称 + 代码」解析 —— 纯函数测试。
 *
 * 关注的是**解析会不会说谎**，而不是「能不能跑」：
 *   A. 标识 + 名称都齐 ⇒ 名称与 canonical 代码都对（`sec_<uuid>` → `603269.SH`）；
 *   B. 名称源未收录该代码 ⇒ `name` 为 **null 而 code 仍在**（名称缺口不能连带丢代码）；
 *   C. identity 不在标识历史里 ⇒ 三个字段**全 null**（不猜、不拼）；
 *   D. 非 primary 标识**不参与**解析（只有 primary 是权威代码）；
 *   E. 同代码名称漂移（OCR）⇒ 取**最近日期**那一条（复用既有 `buildLatestStockNameMap` 语义）；
 *   F. 输出顺序与入参 `securityIds` **逐位对应**（未命中也要占位，前端才能按序索引）；
 *   G. 代码与交易所后缀冲突（`000001` + `SH`）⇒ `code` 为 null（拒绝静默猜测）；
 *   H. 空入参 ⇒ 空数组。
 */

import { describe, expect, it } from "vitest";
import {
  buildSecurityLabels,
  type SecurityIdentifierRow,
  type StockNameRecordRow,
} from "../../../server/closedLoopBacktestRun/securityLabels";

function identifier(
  securityId: string,
  exchange: string,
  code: string,
  identifierType = "primary",
): SecurityIdentifierRow {
  return { securityId, exchange, code, identifierType };
}

function nameRecord(
  stockCode: string,
  stockName: string,
  limitUpDate: string,
  limitUpTime: string | null = null,
): StockNameRecordRow {
  return { stockCode, stockName, limitUpDate, limitUpTime };
}

describe("buildSecurityLabels", () => {
  it("A) 标识与名称都齐 ⇒ 名称 + canonical 代码都对", () => {
    const labels = buildSecurityLabels(
      ["sec_aaa"],
      [identifier("sec_aaa", "SH", "603269")],
      [nameRecord("603269.SH", "海鸥股份", "2025-01-06")],
    );
    expect(labels).toEqual([
      { securityId: "sec_aaa", code: "603269.SH", name: "海鸥股份", exchange: "SH" },
    ]);
  });

  it("B) 名称源未收录 ⇒ name 为 null，但 code 仍在（不连带丢代码）", () => {
    const labels = buildSecurityLabels(
      ["sec_bbb"],
      [identifier("sec_bbb", "SZ", "002733")],
      [],
    );
    expect(labels[0]).toEqual({
      securityId: "sec_bbb",
      code: "002733.SZ",
      name: null,
      exchange: "SZ",
    });
  });

  it("C) identity 不在标识历史里 ⇒ 三字段全 null（不猜、不拼）", () => {
    const labels = buildSecurityLabels(
      ["sec_missing"],
      [identifier("sec_aaa", "SH", "603269")],
      [nameRecord("603269.SH", "海鸥股份", "2025-01-06")],
    );
    expect(labels).toEqual([
      { securityId: "sec_missing", code: null, name: null, exchange: null },
    ]);
  });

  it("D) 非 primary 标识不参与解析（须严格等于 null，不能擅自兜底用次类标识）", () => {
    const labels = buildSecurityLabels(
      ["sec_ccc"],
      [identifier("sec_ccc", "SH", "603269", "tushare_ts_code")],
      [nameRecord("603269.SH", "海鸥股份", "2025-01-06")],
    );
    expect(labels[0]).toEqual({
      securityId: "sec_ccc",
      code: null,
      name: null,
      exchange: null,
    });
  });

  it("E) 同代码名称漂移 ⇒ 取最近日期那一条", () => {
    const labels = buildSecurityLabels(
      ["sec_ddd"],
      [identifier("sec_ddd", "SH", "600398")],
      [
        nameRecord("600398.SH", "凯诺科技", "2020-03-10"),
        nameRecord("600398.SH", "海澜之家", "2025-01-06"),
        nameRecord("600398.SH", "海澜之家", "2024-11-20"),
      ],
    );
    expect(labels[0]?.name).toBe("海澜之家");
  });

  it("F) 输出顺序与入参逐位对应（未命中占位，前端按序索引）", () => {
    const labels = buildSecurityLabels(
      ["sec_1", "sec_unknown", "sec_2"],
      [identifier("sec_2", "SZ", "000631"), identifier("sec_1", "SH", "603997")],
      [nameRecord("603997.SH", "继峰股份", "2025-01-03"), nameRecord("000631.SZ", "顺发恒能", "2025-01-08")],
    );
    expect(labels.map(l => l.securityId)).toEqual(["sec_1", "sec_unknown", "sec_2"]);
    expect(labels.map(l => l.code)).toEqual(["603997.SH", null, "000631.SZ"]);
    expect(labels.map(l => l.name)).toEqual(["继峰股份", null, "顺发恒能"]);
  });

  it("G) 代码与交易所后缀冲突 ⇒ code 为 null（拒绝静默猜测）", () => {
    // 000001 属深市；history 却标 SH ⇒ 冲突，须置空而非强行拼成 000001.SH。
    const labels = buildSecurityLabels(
      ["sec_conflict"],
      [identifier("sec_conflict", "SH", "000001")],
      [nameRecord("000001.SZ", "平安银行", "2025-01-06")],
    );
    expect(labels[0]?.code).toBeNull();
    expect(labels[0]?.name).toBeNull();
  });

  it("H) 空入参 ⇒ 空数组", () => {
    expect(buildSecurityLabels([], [identifier("sec_aaa", "SH", "603269")], [])).toEqual([]);
  });

  it("I) 全库归一：同一 securityId 有多条 primary 时取第一条（不静默取最后一条）", () => {
    const labels = buildSecurityLabels(
      ["sec_dup"],
      [identifier("sec_dup", "SH", "600000"), identifier("sec_dup", "SH", "600001")],
      [],
    );
    expect(labels[0]?.code).toBe("600000.SH");
  });
});
