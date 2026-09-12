/**
 * STEP DATASET-002.2 — Dataset Registry 契约单测（纯契约层，不触 DB）。
 *
 * 覆盖：枚举字面量契约、safeIntId 安全边界、分页入参 schema 校验、update/archive schema。
 * 与后端领域类型的运行一致性由 server/datasetRegistry/router.test.ts + query.test.ts 守护；
 * 真实 TiDB 只读验证由 docs/step-dataset-002.2-report.md 的验证脚本承担。
 */

import { describe, expect, it } from "vitest";
import {
  DATASET_BUILD_CONFIG_DEFAULTS,
  DATASET_BUILD_CONFIG_LIMITS,
  DATASET_BUILD_JOB_STATUS_VALUES,
  DATASET_DEFINITION_STATUS_VALUES,
  DATASET_DEFINITION_TYPE_VALUES,
  DATASET_PAGE_LIMIT_MAX,
  DATASET_STORAGE_TYPE_VALUES,
  DATASET_VERSION_LABEL_PATTERN,
  DATASET_VERSION_STATUS_VALUES,
  archiveDefinitionInputSchema,
  cancelBuildJobInputSchema,
  createBuildJobInputSchema,
  createDatasetDefinitionInputSchema,
  createDatasetVersionInputSchema,
  deleteDatasetDefinitionInputSchema,
  deleteDatasetVersionInputSchema,
  eventPageInputSchema,
  getDefinitionInputSchema,
  outcomePageInputSchema,
  pathPageInputSchema,
  retryBuildJobInputSchema,
  safeIntId,
  startBuildJobInputSchema,
  updateDefinitionInputSchema,
} from "./datasetRegistryContracts";

describe("DATASET-002.2 · 枚举字面量契约", () => {
  it("Definition/Version/Job 枚举字面量与后端领域类型一致", () => {
    expect([...DATASET_DEFINITION_TYPE_VALUES]).toEqual(["EVENT", "FACTOR", "ML", "RESEARCH"]);
    expect([...DATASET_STORAGE_TYPE_VALUES]).toEqual(["DATABASE"]);
    expect([...DATASET_DEFINITION_STATUS_VALUES]).toEqual(["ACTIVE", "ARCHIVED"]);
    expect([...DATASET_VERSION_STATUS_VALUES]).toEqual(["DRAFT", "BUILDING", "READY", "FAILED"]);
    expect([...DATASET_BUILD_JOB_STATUS_VALUES]).toEqual(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);
  });
});

describe("DATASET-002.2 · safeIntId（bigint 安全边界）", () => {
  it("接受 1 ~ MAX_SAFE_INTEGER 的整数", () => {
    expect(safeIntId.safeParse(1).success).toBe(true);
    expect(safeIntId.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
  });

  it("拒绝 0 / 负数 / 浮点 / 超出安全整数", () => {
    expect(safeIntId.safeParse(0).success).toBe(false);
    expect(safeIntId.safeParse(-1).success).toBe(false);
    expect(safeIntId.safeParse(1.5).success).toBe(false);
    expect(safeIntId.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
    expect(safeIntId.safeParse(NaN).success).toBe(false);
  });
});

describe("DATASET-002.2 · 分页入参 schema", () => {
  const base = { datasetVersionId: 7 };

  it("eventPageInput：合法入参通过", () => {
    expect(eventPageInputSchema.safeParse(base).success).toBe(true);
    expect(eventPageInputSchema.safeParse({ ...base, fromDate: "2024-01-01", toDate: "2024-12-31", cursor: "abc", limit: 10 }).success).toBe(true);
  });

  it("eventPageInput：非法 datasetVersionId / 非法日期 / limit 越界被拒", () => {
    expect(eventPageInputSchema.safeParse({ datasetVersionId: 0 }).success).toBe(false);
    expect(eventPageInputSchema.safeParse({ ...base, fromDate: "2024/01/01" }).success).toBe(false);
    expect(eventPageInputSchema.safeParse({ ...base, limit: 0 }).success).toBe(false);
    expect(eventPageInputSchema.safeParse({ ...base, limit: DATASET_PAGE_LIMIT_MAX + 1 }).success).toBe(false);
    expect(eventPageInputSchema.safeParse({ ...base, limit: 1.5 }).success).toBe(false);
  });

  it("pathPageInput：eventId / 日期过滤合法；非法 eventId 被拒", () => {
    expect(pathPageInputSchema.safeParse({ ...base, eventId: "600001.SH@2024-01-02" }).success).toBe(true);
    expect(pathPageInputSchema.safeParse({ ...base, eventId: "" }).success).toBe(false);
    expect(pathPageInputSchema.safeParse({ ...base, eventId: "x".repeat(65) }).success).toBe(false);
  });

  it("outcomePageInput：horizon 过滤合法；非法 horizon 被拒", () => {
    expect(outcomePageInputSchema.safeParse({ ...base, horizon: 5 }).success).toBe(true);
    expect(outcomePageInputSchema.safeParse({ ...base, horizon: 0 }).success).toBe(false);
    expect(outcomePageInputSchema.safeParse({ ...base, horizon: 1.5 }).success).toBe(false);
  });
});

describe("DATASET-002.2 · update / archive schema", () => {
  it("updateDefinitionInput：name/description 可选，definitionId 必填", () => {
    expect(updateDefinitionInputSchema.safeParse({ definitionId: 1 }).success).toBe(true);
    expect(updateDefinitionInputSchema.safeParse({ definitionId: 1, name: "新名称" }).success).toBe(true);
    expect(updateDefinitionInputSchema.safeParse({ name: "新名称" }).success).toBe(false);
    expect(updateDefinitionInputSchema.safeParse({ definitionId: 1, name: "" }).success).toBe(false);
  });

  it("archiveDefinitionInput / getDefinitionInput：definitionId 必填且为正整数", () => {
    expect(archiveDefinitionInputSchema.safeParse({ definitionId: 1 }).success).toBe(true);
    expect(getDefinitionInputSchema.safeParse({ definitionId: 0 }).success).toBe(false);
  });
});

describe("DATASET-002.4A · Build Lifecycle mutation schema", () => {
  it("createBuildJobInput：datasetVersionId 必填且为正整数", () => {
    expect(createBuildJobInputSchema.safeParse({ datasetVersionId: 1 }).success).toBe(true);
    expect(createBuildJobInputSchema.safeParse({ datasetVersionId: 0 }).success).toBe(false);
    expect(createBuildJobInputSchema.safeParse({}).success).toBe(false);
    expect(createBuildJobInputSchema.safeParse({ datasetVersionId: 1.5 }).success).toBe(false);
  });

  it("start/cancel/retry：jobId 必填、长度 ≤64", () => {
    expect(startBuildJobInputSchema.safeParse({ jobId: "ds001-v1-123" }).success).toBe(true);
    expect(cancelBuildJobInputSchema.safeParse({ jobId: "ds001-v1-123" }).success).toBe(true);
    expect(retryBuildJobInputSchema.safeParse({ jobId: "ds001-v1-123" }).success).toBe(true);

    expect(startBuildJobInputSchema.safeParse({ jobId: "" }).success).toBe(false);
    expect(cancelBuildJobInputSchema.safeParse({}).success).toBe(false);
    expect(retryBuildJobInputSchema.safeParse({ jobId: "x".repeat(65) }).success).toBe(false);
  });
});

describe("DATASET-002.4B · 版本标签正则 / 构建参数默认值 / createDatasetVersion schema", () => {
  it("DATASET_VERSION_LABEL_PATTERN：接受 v1 / 2024-full / v1.2_a；拒绝空格 / 首字符符号 / 超长", () => {
    expect(DATASET_VERSION_LABEL_PATTERN.test("v1")).toBe(true);
    expect(DATASET_VERSION_LABEL_PATTERN.test("2024-full")).toBe(true);
    expect(DATASET_VERSION_LABEL_PATTERN.test("v1.2_a")).toBe(true);
    expect(DATASET_VERSION_LABEL_PATTERN.test("V1")).toBe(true);

    expect(DATASET_VERSION_LABEL_PATTERN.test("")).toBe(false);
    expect(DATASET_VERSION_LABEL_PATTERN.test("v 1")).toBe(false);
    expect(DATASET_VERSION_LABEL_PATTERN.test("-v1")).toBe(false);
    expect(DATASET_VERSION_LABEL_PATTERN.test("_v1")).toBe(false);
    expect(DATASET_VERSION_LABEL_PATTERN.test("x".repeat(33))).toBe(false);
  });

  it("构建参数默认值与边界常量自洽（默认落在边界内）", () => {
    expect(DATASET_BUILD_CONFIG_DEFAULTS.pathHorizon).toBeGreaterThanOrEqual(DATASET_BUILD_CONFIG_LIMITS.pathHorizon.min);
    expect(DATASET_BUILD_CONFIG_DEFAULTS.pathHorizon).toBeLessThanOrEqual(DATASET_BUILD_CONFIG_LIMITS.pathHorizon.max);
    expect(DATASET_BUILD_CONFIG_DEFAULTS.batchSize).toBeGreaterThanOrEqual(DATASET_BUILD_CONFIG_LIMITS.batchSize.min);
    expect(DATASET_BUILD_CONFIG_DEFAULTS.batchSize).toBeLessThanOrEqual(DATASET_BUILD_CONFIG_LIMITS.batchSize.max);
    expect(DATASET_BUILD_CONFIG_DEFAULTS.outcomeHorizons.length).toBeLessThanOrEqual(DATASET_BUILD_CONFIG_LIMITS.maxHorizons);
  });

  it("createDatasetVersionInput：合法筛选入参通过（缺省子项自动补权威默认）", () => {
    const base = { datasetId: 1, version: "v3", startDate: "2024-01-01", endDate: "2024-12-31" };
    const minimal = createDatasetVersionInputSchema.safeParse({
      ...base,
      filter: { events: [{ relativeDay: 0, kind: "firstBoard" }] },
    });
    expect(minimal.success).toBe(true);
    if (minimal.success) {
      expect(minimal.data.filter.boards).toEqual([]);
      expect(minimal.data.filter.excludeSt).toBe(false);
      expect(minimal.data.filter.preWindowDays).toBe(0);
      expect(minimal.data.filter.postWindowDays).toBe(20);
      expect(minimal.data.filter.outcomeHorizons).toEqual([5, 10, 20]);
      expect(minimal.data.filter.batchSize).toBe(1000);
    }
    expect(
      createDatasetVersionInputSchema.safeParse({
        ...base,
        filter: {
          boards: ["main", "chinext"],
          excludeSt: true,
          events: [{ relativeDay: 0, kind: "firstBoard" }, { relativeDay: -1, kind: "limitUp" }],
          preWindowDays: 5,
          postWindowDays: 30,
          outcomeHorizons: [5, 10],
          batchSize: 500,
        },
      }).success,
    ).toBe(true);
  });

  it("createDatasetVersionInput：必填缺失 / 空 version / 日期倒置被拒", () => {
    expect(createDatasetVersionInputSchema.safeParse({ datasetId: 1, version: "v1", startDate: "2024-01-01" }).success).toBe(false);
    expect(createDatasetVersionInputSchema.safeParse({ datasetId: 1, version: "", startDate: "2024-01-01", endDate: "2024-12-31" }).success).toBe(false);
    expect(createDatasetVersionInputSchema.safeParse({ datasetId: 0, version: "v1", startDate: "2024-01-01", endDate: "2024-12-31" }).success).toBe(false);
    expect(createDatasetVersionInputSchema.safeParse({ datasetId: 1, version: "v 1", startDate: "2024-01-01", endDate: "2024-12-31" }).success).toBe(false);
    expect(createDatasetVersionInputSchema.safeParse({ datasetId: 1, version: "v1", startDate: "2024-12-31", endDate: "2024-01-01" }).success).toBe(false);
  });

  it("createDatasetVersionInput：筛选参数越界被拒", () => {
    const base = { datasetId: 1, version: "v1", startDate: "2024-01-01", endDate: "2024-12-31" };
    const withFilter = (filter: Record<string, unknown>) =>
      createDatasetVersionInputSchema.safeParse({
        ...base,
        filter: { events: [{ relativeDay: 0, kind: "firstBoard" }], ...filter },
      }).success;
    expect(withFilter({ preWindowDays: -1 })).toBe(false);
    expect(withFilter({ preWindowDays: 121 })).toBe(false);
    expect(withFilter({ postWindowDays: 0 })).toBe(false);
    expect(withFilter({ postWindowDays: 121 })).toBe(false);
    expect(withFilter({ batchSize: 0 })).toBe(false);
    expect(withFilter({ batchSize: 10001 })).toBe(false);
    expect(withFilter({ outcomeHorizons: [] })).toBe(false);
    expect(withFilter({ outcomeHorizons: [5, 10, 20, 30, 40, 50, 60, 70, 80] })).toBe(false);
    expect(withFilter({ outcomeHorizons: [0] })).toBe(false);
    expect(withFilter({ boards: ["nasdaq"] })).toBe(false);
    expect(withFilter({ events: [] })).toBe(false);
  });
});

describe("DATASET-003A · 多数据集与删除入参契约", () => {
  it("createDatasetDefinitionInput：合法 datasetCode 通过", () => {
    expect(
      createDatasetDefinitionInputSchema.safeParse({
        datasetCode: "first_limit_pullback",
        name: "首板回踩",
        datasetType: "EVENT",
      }).success,
    ).toBe(true);
    expect(
      createDatasetDefinitionInputSchema.safeParse({ datasetCode: "breakout", name: "突破", datasetType: "FACTOR", description: null }).success,
    ).toBe(true);
  });

  it("createDatasetDefinitionInput：非法 datasetCode 被拒（格式 / 版本后缀 / 序号结尾 / 大写 / 空）", () => {
    const bad = ["", "First_Limit", "first-limit", "first_limit_pullback_v1", "first_limit_pullback_001", "1st_limit", "a".repeat(65)];
    for (const datasetCode of bad) {
      expect(createDatasetDefinitionInputSchema.safeParse({ datasetCode, name: "x", datasetType: "EVENT" }).success).toBe(false);
    }
  });

  it("createDatasetDefinitionInput：name / datasetType 必填且有边界", () => {
    expect(createDatasetDefinitionInputSchema.safeParse({ datasetCode: "breakout", name: "", datasetType: "EVENT" }).success).toBe(false);
    expect(createDatasetDefinitionInputSchema.safeParse({ datasetCode: "breakout", name: "x", datasetType: "OTHER" }).success).toBe(false);
    expect(createDatasetDefinitionInputSchema.safeParse({ datasetCode: "breakout", name: "x".repeat(129), datasetType: "EVENT" }).success).toBe(false);
  });

  it("deleteDatasetVersionInput：datasetVersionId 必填且为正整数", () => {
    expect(deleteDatasetVersionInputSchema.safeParse({ datasetVersionId: 1 }).success).toBe(true);
    expect(deleteDatasetVersionInputSchema.safeParse({ datasetVersionId: 0 }).success).toBe(false);
    expect(deleteDatasetVersionInputSchema.safeParse({}).success).toBe(false);
  });

  it("deleteDatasetDefinitionInput：必须回传 confirmDatasetCode（防误删）", () => {
    expect(
      deleteDatasetDefinitionInputSchema.safeParse({ definitionId: 1, confirmDatasetCode: "first_limit_pullback" }).success,
    ).toBe(true);
    expect(deleteDatasetDefinitionInputSchema.safeParse({ definitionId: 1 }).success).toBe(false);
    expect(deleteDatasetDefinitionInputSchema.safeParse({ definitionId: 1, confirmDatasetCode: "" }).success).toBe(false);
    expect(deleteDatasetDefinitionInputSchema.safeParse({ definitionId: 0, confirmDatasetCode: "x" }).success).toBe(false);
  });
});
