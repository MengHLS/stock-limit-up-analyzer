/**
 * STOCK-SELECTION-006 —— 选股清单展示派生纯函数单测。
 *
 * 锁住三件事：① 名称缺失显示 `—`（不用代码冒充）；② 代码层层回退；③ K 线窗口以事件日 T0 为中心，
 * 无事件日 ⇒ null（不可点）。
 */

import { describe, expect, it } from "vitest";
import {
  buildKlineTargetForExcludedStock,
  buildKlineTargetForPick,
  pickCodeForDisplay,
  pickNameForDisplay,
} from "../../../../client/src/lib/stockSelectionPicks";

const pick = {
  canonicalSecurityId: "sec_test-1",
  code: "600000.SH",
  eventDate: "2024-02-15",
  signalDate: "2024-02-22",
  entryDate: "2024-02-23",
};

describe("pickNameForDisplay", () => {
  it("有名称 ⇒ 原样返回", () => {
    expect(pickNameForDisplay({ code: "600000.SH", name: "浦发银行" })).toBe("浦发银行");
  });

  it("名称为 null / 空串 / 全空白 ⇒ `—`（绝不用代码冒充名称）", () => {
    expect(pickNameForDisplay(undefined)).toBe("—");
    expect(pickNameForDisplay({ code: "600000.SH", name: null })).toBe("—");
    expect(pickNameForDisplay({ code: "600000.SH", name: "" })).toBe("—");
    expect(pickNameForDisplay({ code: "600000.SH", name: "   " })).toBe("—");
  });
});

describe("pickCodeForDisplay", () => {
  it("pick.code 优先；缺失回退标签代码；再缺失回退 canonical id（永不空串）", () => {
    expect(pickCodeForDisplay(pick, { code: "000001.SZ", name: "x" })).toBe("600000.SH");
    expect(pickCodeForDisplay({ ...pick, code: null }, { code: "600000.SH", name: "x" })).toBe("600000.SH");
    expect(pickCodeForDisplay({ ...pick, code: null }, undefined)).toBe("sec_test-1");
  });
});

describe("buildKlineTargetForPick", () => {
  it("窗口 = 事件日 T0 ~ 计划买入日（交易详情同款弹窗入参）", () => {
    expect(buildKlineTargetForPick(pick, { code: "600000.SH", name: "浦发银行" })).toEqual({
      securityId: "sec_test-1",
      code: "600000.SH",
      name: "浦发银行",
      entryTime: "2024-02-15",
      exitTime: "2024-02-23",
    });
  });

  it("无计划买入日 ⇒ 退到信号日（仍可看 K 线）", () => {
    const target = buildKlineTargetForPick({ ...pick, entryDate: null }, undefined);
    expect(target?.exitTime).toBe("2024-02-22");
    expect(target?.name).toBeNull();
  });

  it("无事件日 ⇒ null（不可点，避免开空窗口）", () => {
    expect(buildKlineTargetForPick({ ...pick, eventDate: "" }, undefined)).toBeNull();
  });
});
describe("buildKlineTargetForExcludedStock（剔除票的 K 线窗口）", () => {
  it("窗口以事件日 T0 为中心（首尾同日）", () => {
    expect(
      buildKlineTargetForExcludedStock(
        { canonicalSecurityId: "sec_test-9", code: "600009.SH", eventDate: "2026-09-23" },
        { code: "600009.SH", name: "测试票" },
      ),
    ).toEqual({
      securityId: "sec_test-9",
      code: "600009.SH",
      name: "测试票",
      entryTime: "2026-09-23",
      exitTime: "2026-09-23",
    });
  });

  it("无事件日 ⇒ null（不可点）", () => {
    expect(
      buildKlineTargetForExcludedStock({ canonicalSecurityId: "sec_x", code: null, eventDate: "" }, undefined),
    ).toBeNull();
  });
});