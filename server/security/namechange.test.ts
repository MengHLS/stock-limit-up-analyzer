/**
 * STEP 7.4 — namechange 解析测试（Tushare namechange → NameChangeRecord[]）。
 */

import { describe, expect, it } from "vitest";
import { parseTushareNameChange, TushareNameChangePayload } from "./namechange";

// 真实探测形态（2026-09-06，000001.SZ）：字段与区间语义。
const realShapePayload: TushareNameChangePayload = {
  code: 0,
  msg: "",
  data: {
    fields: ["ts_code", "name", "start_date", "end_date", "ann_date", "change_reason"],
    items: [
      ["000001.SZ", "平安银行", "20120802", null, "20120120", "其他"],
      ["000001.SZ", "深发展A", "20070620", "20120801", "20070614", "其他"],
      ["000001.SZ", "S深发展A", "20061009", "20070619", "20060928", "其他"],
      ["000001.SZ", "深发展A", "19910403", "20061008", "19910403", "其他"],
    ],
  },
};

describe("parseTushareNameChange", () => {
  it("解析真实形态（深发展A → 平安银行）", () => {
    const records = parseTushareNameChange(realShapePayload);
    expect(records).toHaveLength(4);

    const first = records.find((r) => r.name === "平安银行")!;
    expect(first.exchange).toBe("SZ");
    expect(first.code).toBe("000001");
    expect(first.tsCode).toBe("000001.SZ");
    expect(first.effectiveFrom).toBe("2012-08-02");
    expect(first.effectiveTo).toBeNull();

    const earliest = records.find((r) => r.name === "深发展A" && r.effectiveFrom === "1991-04-03")!;
    expect(earliest.effectiveTo).toBe("2006-10-08");
  });

  it("错误码抛错", () => {
    expect(() => parseTushareNameChange({ code: 40203, msg: "频率超限", data: undefined })).toThrow(/频率超限/);
  });

  it("缺少必需字段抛错", () => {
    expect(() =>
      parseTushareNameChange({ code: 0, data: { fields: ["name"], items: [["平安银行"]] } }),
    ).toThrow(/缺少字段/);
  });

  it("无法解析的 ts_code 被跳过", () => {
    const payload: TushareNameChangePayload = {
      code: 0,
      data: {
        fields: ["ts_code", "name", "start_date", "end_date", "ann_date", "change_reason"],
        items: [
          ["BADCODE", "异常", "20200101", null, null, "其他"],
          ["600000.SH", "浦发银行", "19991110", null, null, "其他"],
        ],
      },
    };
    const records = parseTushareNameChange(payload);
    expect(records).toHaveLength(1);
    expect(records[0]!.code).toBe("600000");
    expect(records[0]!.exchange).toBe("SH");
  });
});
