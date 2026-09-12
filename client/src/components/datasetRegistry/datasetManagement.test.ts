/**
 * 多数据集管理组件 — 纯函数单测（STEP DATASET-003A）。
 *
 * 只测纯函数（不渲染组件、不触 DOM / tRPC）：
 *   - validateDatasetCodeInput：与后端同源的 datasetCode 预校验（形态 + 禁止模式）；
 *   - isDeleteDatasetConfirmed：删除数据集的手工二次确认判定。
 */

import { describe, expect, it } from "vitest";
import { validateDatasetCodeInput } from "./CreateDatasetDialog";
import { isDeleteDatasetConfirmed } from "./DeleteDatasetDialog";

describe("validateDatasetCodeInput", () => {
  it("空串不报错（由提交按钮 disabled 兜底）", () => {
    expect(validateDatasetCodeInput("")).toBeNull();
  });

  it("合法 lowercase snake_case → null", () => {
    expect(validateDatasetCodeInput("first_limit_pullback")).toBeNull();
    expect(validateDatasetCodeInput("momentum_breakout")).toBeNull();
    expect(validateDatasetCodeInput("a")).toBeNull();
  });

  it("含大写 / 连字符 / 空格 / 驼峰 → 报错", () => {
    expect(validateDatasetCodeInput("FirstLimitPullback")).not.toBeNull();
    expect(validateDatasetCodeInput("first-limit-pullback")).not.toBeNull();
    expect(validateDatasetCodeInput("first limit")).not.toBeNull();
    expect(validateDatasetCodeInput("firstLimit")).not.toBeNull();
  });

  it("以数字开头 → 报错", () => {
    expect(validateDatasetCodeInput("1st_limit")).not.toBeNull();
  });

  it("禁止模式：版本号后缀 / 纯数字后缀 → 报错（防同一数据集被拆成多个 code）", () => {
    expect(validateDatasetCodeInput("first_limit_pullback_v1")).not.toBeNull();
    expect(validateDatasetCodeInput("first_limit_pullback_v12")).not.toBeNull();
    expect(validateDatasetCodeInput("first_limit_pullback_001")).not.toBeNull();
    expect(validateDatasetCodeInput("first_limit_pullback_2")).not.toBeNull();
  });

  it("超长（>64）→ 报错", () => {
    expect(validateDatasetCodeInput("a".repeat(65))).not.toBeNull();
  });
});

describe("isDeleteDatasetConfirmed", () => {
  const code = "first_limit_pullback";

  it("完全一致 → true", () => {
    expect(isDeleteDatasetConfirmed(code, code)).toBe(true);
  });

  it("空串 / 前后空白 / 大小写不同 / 子串 → false", () => {
    expect(isDeleteDatasetConfirmed("", code)).toBe(false);
    expect(isDeleteDatasetConfirmed(` ${code}`, code)).toBe(false);
    expect(isDeleteDatasetConfirmed(code.toUpperCase(), code)).toBe(false);
    expect(isDeleteDatasetConfirmed("first_limit", code)).toBe(false);
    expect(isDeleteDatasetConfirmed(`${code}_v1`, code)).toBe(false);
  });
});
