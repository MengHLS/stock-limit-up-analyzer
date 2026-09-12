/**
 * STEP DATASET-001 — 命名规范测试（§38.1 Naming Test）。
 */

import { describe, expect, it } from "vitest";
import {
  buildDatasetTableName,
  buildDatasetTableNames,
  isValidDatasetCode,
  parseDatasetTableName,
  validateDatasetCode,
} from "./naming";

describe("naming: ds_{dataset_code}_{role}", () => {
  it("合法 datasetCode 通过校验", () => {
    expect(isValidDatasetCode("first_limit_pullback")).toBe(true);
    expect(isValidDatasetCode("breakout")).toBe(true);
    expect(isValidDatasetCode("consecutive_limit")).toBe(true);
    expect(isValidDatasetCode("trend_following")).toBe(true);
  });

  it("非法 datasetCode 被拒绝（version/日期/环境/uuid/大写/非法字符）", () => {
    expect(isValidDatasetCode("first_limit_pullback_v1")).toBe(false);
    expect(isValidDatasetCode("first_limit_pullback_202609")).toBe(false);
    expect(isValidDatasetCode("first_limit_pullback_test")).toBe(false);
    expect(isValidDatasetCode("FirstLimitPullback")).toBe(false);
    expect(isValidDatasetCode("first-limit-pullback")).toBe(false);
    expect(isValidDatasetCode("ds_001")).toBe(false);
  });

  it("物理表名 = ds_{dataset_code}_{role}", () => {
    expect(buildDatasetTableName("first_limit_pullback", "event")).toBe("ds_first_limit_pullback_event");
    expect(buildDatasetTableName("first_limit_pullback", "prefix")).toBe("ds_first_limit_pullback_prefix");
    expect(buildDatasetTableName("first_limit_pullback", "post")).toBe("ds_first_limit_pullback_post");
    expect(buildDatasetTableName("first_limit_pullback", "path")).toBe("ds_first_limit_pullback_path");
    expect(buildDatasetTableName("first_limit_pullback", "outcome")).toBe("ds_first_limit_pullback_outcome");
  });

  it("定义表名派生完整覆盖 event/prefix/post/path/outcome/feature", () => {
    expect(buildDatasetTableNames("first_limit_pullback")).toEqual({
      event: "ds_first_limit_pullback_event",
      prefix: "ds_first_limit_pullback_prefix",
      post: "ds_first_limit_pullback_post",
      path: "ds_first_limit_pullback_path",
      outcome: "ds_first_limit_pullback_outcome",
      feature: "ds_first_limit_pullback_feature",
    });
  });

  it("解析表名可还原 datasetCode 与 role", () => {
    expect(parseDatasetTableName("ds_first_limit_pullback_path")).toEqual({
      datasetCode: "first_limit_pullback",
      role: "path",
    });
    expect(parseDatasetTableName("ds_first_limit_pullback_prefix")).toEqual({
      datasetCode: "first_limit_pullback",
      role: "prefix",
    });
    expect(parseDatasetTableName("ds_first_limit_pullback_post")).toEqual({
      datasetCode: "first_limit_pullback",
      role: "post",
    });
    expect(parseDatasetTableName("not_ds_table")).toBeNull();
    expect(parseDatasetTableName("ds_first_limit_pullback_unknown")).toBeNull();
  });

  it("validateDatasetCode 返回确定性错误列表", () => {
    expect(validateDatasetCode("first_limit_pullback")).toEqual([]);
    expect(validateDatasetCode("").some((m) => m.includes("不能为空"))).toBe(true);
    expect(validateDatasetCode("first_limit_pullback_v1").some((m) => m.includes("版本"))).toBe(true);
  });
});
