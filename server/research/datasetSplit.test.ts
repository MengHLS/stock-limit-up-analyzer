/**
 * STEP 6.4 — Dataset Split 测试。
 *
 * 覆盖（对应验收 §41 + §6 + §7 + §9）：
 *   时间边界（正常三段） / 重叠（Train-Validation / Validation-OOS / Train-OOS） / 倒序 /
 *   相邻边界（trainEnd=2023-12-31 → validationStart=2024-01-01） / 单日区间（start===end） /
 *   fingerprint 确定性 + 敏感性。
 */

import { describe, expect, it } from "vitest";
import {
  assertValidDatasetRange,
  computeDatasetSplitFingerprint,
  toTrainValidationOosRanges,
  validateDatasetRange,
  validateResearchDatasetSplit,
  type ResearchDatasetSplit,
} from "./datasetSplit";

function split(overrides: Partial<ResearchDatasetSplit> = {}): ResearchDatasetSplit {
  return {
    trainStart: "2020-01-01",
    trainEnd: "2023-12-31",
    validationStart: "2024-01-01",
    validationEnd: "2024-12-31",
    oosStart: "2025-01-01",
    oosEnd: "2025-12-31",
    ...overrides,
  };
}

describe("Dataset Split 时间边界", () => {
  it("正常三段 Train < Validation < OOS 通过", () => {
    const result = validateResearchDatasetSplit(split());
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("相邻边界：trainEnd=2023-12-31 → validationStart=2024-01-01 通过（闭区间紧挨）", () => {
    const result = validateResearchDatasetSplit(split({ trainEnd: "2023-12-31", validationStart: "2024-01-01" }));
    expect(result.valid).toBe(true);
  });

  it("单日区间（start === end）合法（闭区间语义，非空）", () => {
    const result = validateDatasetRange({ start: "2024-06-30", end: "2024-06-30" });
    expect(result.valid).toBe(true);
  });

  it("单日单段 split（train 单日）通过", () => {
    const result = validateResearchDatasetSplit(split({ trainStart: "2020-01-01", trainEnd: "2020-01-01" }));
    expect(result.valid).toBe(true);
  });
});

describe("Dataset Split 重叠 / 倒序", () => {
  it("Train 与 Validation 重叠（trainEnd === validationStart）失败", () => {
    const result = validateResearchDatasetSplit(split({ trainEnd: "2024-01-01", validationStart: "2024-01-01" }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "TRAIN_VALIDATION_OVERLAP")).toBe(true);
  });

  it("Validation 与 OOS 重叠（validationEnd >= oosStart）失败", () => {
    const result = validateResearchDatasetSplit(split({ validationEnd: "2025-01-01", oosStart: "2025-01-01" }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "VALIDATION_OOS_OVERLAP")).toBe(true);
  });

  it("Train 与 OOS 重叠失败", () => {
    const result = validateResearchDatasetSplit(split({ trainEnd: "2025-01-01", oosStart: "2025-01-01" }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "TRAIN_OOS_OVERLAP")).toBe(true);
  });

  it("Validation 倒序（validationStart > validationEnd）失败", () => {
    const result = validateResearchDatasetSplit(split({ validationStart: "2024-12-31", validationEnd: "2024-01-01" }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "VALIDATION_REVERSED")).toBe(true);
  });

  it("范围倒序（start > end）失败", () => {
    const result = validateDatasetRange({ start: "2024-12-31", end: "2024-01-01" });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "RANGE_REVERSED")).toBe(true);
  });

  it("非法日期格式失败", () => {
    const result = validateResearchDatasetSplit(split({ oosEnd: "2025/12/31" }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "SPLIT_DATE_INVALID")).toBe(true);
  });

  it("assertValidDatasetRange 在非法时抛 ResearchValidationError", () => {
    expect(() => assertValidDatasetRange({ start: "2024-12-31", end: "2024-01-01" })).toThrow(/倒序|晚于/);
  });
});

describe("Dataset Split 派生范围", () => {
  it("toTrainValidationOosRanges 返回三段闭区间范围", () => {
    const ranges = toTrainValidationOosRanges(split());
    expect(ranges.train).toEqual({ start: "2020-01-01", end: "2023-12-31" });
    expect(ranges.validation).toEqual({ start: "2024-01-01", end: "2024-12-31" });
    expect(ranges.oos).toEqual({ start: "2025-01-01", end: "2025-12-31" });
  });
});

describe("Dataset Split Fingerprint", () => {
  it("相同切分产生相同指纹（确定性）", () => {
    expect(computeDatasetSplitFingerprint(split())).toBe(computeDatasetSplitFingerprint(split()));
  });

  it("字段插入顺序不影响指纹（canonical 固定字段序）", () => {
    const a: ResearchDatasetSplit = {
      oosEnd: "2025-12-31",
      trainStart: "2020-01-01",
      validationStart: "2024-01-01",
      trainEnd: "2023-12-31",
      oosStart: "2025-01-01",
      validationEnd: "2024-12-31",
    };
    expect(computeDatasetSplitFingerprint(a)).toBe(computeDatasetSplitFingerprint(split()));
  });

  it("只改 validationEnd → 不同指纹", () => {
    expect(computeDatasetSplitFingerprint(split())).not.toBe(
      computeDatasetSplitFingerprint(split({ validationEnd: "2024-11-30" })),
    );
  });

  it("只改 oosStart → 不同指纹", () => {
    expect(computeDatasetSplitFingerprint(split())).not.toBe(
      computeDatasetSplitFingerprint(split({ oosStart: "2025-02-01" })),
    );
  });
});
