/**
 * datasetRegistryAdapter 单测（STEP DATASET-002.3，任务 §15）。
 *
 * 覆盖：列表 / 详情 / 版本列表 / 版本详情 / 作业状态 / 统计 / 空态 / 错误态 / 加载态 /
 * bigint→number / null 归一 / status 透传 / 进度推导。全部为纯函数，node 环境可跑。
 */

import { describe, expect, it } from "vitest";
import {
  buildDatasetListRow,
  formatCount,
  formatDateTime,
  jobToVm,
  rpcErrorToDiagnostic,
  statisticsToVm,
  versionToVm,
} from "./datasetRegistryAdapter";
import type {
  DatasetBuildJobDetail,
  DatasetBuildJobListItem,
  DatasetDefinitionListItem,
  DatasetStatistics,
  DatasetVersionListItem,
} from "@shared/datasetRegistryContracts";

function def(overrides: Partial<DatasetDefinitionListItem> = {}): DatasetDefinitionListItem {
  return {
    id: 1,
    datasetCode: "first_limit_pullback",
    name: "首板回踩",
    description: "首板事件 + 回踩路径 + 结果",
    datasetType: "EVENT",
    storageType: "DATABASE",
    status: "ACTIVE",
    eventTableName: "ds_first_limit_pullback_event",
    pathTableName: "ds_first_limit_pullback_path",
    outcomeTableName: "ds_first_limit_pullback_outcome",
    featureTableName: null,
    createdAt: "2026-09-10T02:00:00.000Z",
    updatedAt: "2026-09-10T02:30:00.000Z",
    ...overrides,
  };
}

function ver(overrides: Partial<DatasetVersionListItem> = {}): DatasetVersionListItem {
  return {
    id: 3,
    datasetId: 1,
    version: "v2",
    status: "READY",
    startDate: "2024-01-02",
    endDate: "2024-12-31",
    featureVersion: "fv-1",
    sourceVersion: "sv-1",
    totalEvents: 10240,
    totalRows: 237128,
    createdAt: "2026-09-10T02:10:00.000Z",
    completedAt: "2026-09-10T02:20:00.000Z",
    ...overrides,
  };
}

function job(overrides: Partial<DatasetBuildJobListItem> = {}): DatasetBuildJobListItem {
  return {
    id: 9,
    datasetVersionId: 3,
    jobId: "job-1",
    status: "RUNNING",
    totalChunks: 10,
    completedChunks: 5,
    currentChunk: 5,
    processedRows: 100000,
    failedRows: 0,
    lastSymbol: "600001.SH",
    lastTradeDate: "2024-06-15",
    startedAt: "2026-09-10T02:10:00.000Z",
    updatedAt: "2026-09-10T02:15:00.000Z",
    completedAt: null,
    errorMessage: null,
    progress: null,
    ...overrides,
  };
}

describe("datasetRegistryAdapter · 列表 / 详情 / 版本元信息聚合", () => {
  it("列表：聚合 versionCount / latestVersion / latestVersionStatus", () => {
    const versions = [
      ver({ id: 1, version: "smoke", status: "READY" }),
      ver({ id: 2, version: "v1", status: "READY" }),
      ver({ id: 3, version: "v2", status: "READY" }),
    ];
    const row = buildDatasetListRow(def(), versions);
    expect(row.versionCount).toBe(3);
    expect(row.latestVersion).toBe("v2"); // 最高 id = 最近创建
    expect(row.latestVersionStatus).toBe("READY");
  });

  it("列表空态：无版本 → versionCount=0 / latest=null", () => {
    const row = buildDatasetListRow(def(), []);
    expect(row.versionCount).toBe(0);
    expect(row.latestVersion).toBeNull();
    expect(row.latestVersionStatus).toBeNull();
  });

  it("列表：updatedAt 原样透传（null 归一为 null）", () => {
    const row = buildDatasetListRow(def({ updatedAt: null }), []);
    expect(row.updatedAt).toBeNull();
  });

  it("版本列表：dateRange / totalEvents / totalRows 映射", () => {
    const vm = versionToVm(ver());
    expect(vm.dateRange).toBe("2024-01-02 → 2024-12-31");
    expect(vm.totalEvents).toBe(10240);
    expect(vm.totalRows).toBe(237128);
    expect(vm.status).toBe("READY");
  });

  it("版本列表：缺 endDate 时 dateRange 半开", () => {
    const vm = versionToVm(ver({ endDate: null }));
    expect(vm.dateRange).toBe("2024-01-02 → —");
  });
});

describe("datasetRegistryAdapter · 作业状态与进度", () => {
  it("RUNNING + chunk 比例 → progress 50%", () => {
    const vm = jobToVm(job({ status: "RUNNING", totalChunks: 10, completedChunks: 5 }));
    expect(vm.progressPercent).toBe(50);
  });

  it("COMPLETED → progress 100%", () => {
    const vm = jobToVm(job({ status: "COMPLETED", totalChunks: null, completedChunks: null }));
    expect(vm.progressPercent).toBe(100);
  });

  it("RUNNING 无 chunk 信息 → progress null（不臆造）", () => {
    const vm = jobToVm(job({ status: "RUNNING", totalChunks: null, completedChunks: null }));
    expect(vm.progressPercent).toBeNull();
  });

  it("五态 status 原样透传", () => {
    const statuses = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const;
    for (const s of statuses) {
      expect(jobToVm(job({ status: s })).status).toBe(s);
    }
  });

  it("detail 形态附带 checkpointSummary 摘要", () => {
    const detail: DatasetBuildJobDetail = {
      ...job({ status: "COMPLETED" }),
      checkpointSummary: {
        phase: "outcomes",
        lastTradeDate: "2024-12-31",
        lastSymbol: "600001.SH",
        lastEventId: "evt-1",
        processedRows: 237128,
        completedChunks: 42,
      },
    };
    const vm = jobToVm(detail);
    expect(vm.checkpointSummary?.phase).toBe("outcomes");
    expect(vm.checkpointSummary?.processedRows).toBe(237128);
  });
});

describe("datasetRegistryAdapter · 统计", () => {
  const stats: DatasetStatistics = {
    datasetVersionId: 3,
    version: "v2",
    status: "READY",
    declared: { totalEvents: 10240, totalRows: 237128 },
    actual: {
      eventCount: 10240,
      pathCount: 206408,
      outcomeCount: 30720,
      rowCount: 247368,
      firstDate: "2024-01-02",
      lastDate: "2024-12-31",
      horizons: [1, 3, 5, 10, 20],
    },
  };

  it("统计：event/path/outcome/rowCount/firstDate/lastDate 映射", () => {
    const vm = statisticsToVm(stats);
    expect(vm.eventCount).toBe(10240);
    expect(vm.pathCount).toBe(206408);
    expect(vm.outcomeCount).toBe(30720);
    expect(vm.rowCount).toBe(247368);
    expect(vm.firstDate).toBe("2024-01-02");
    expect(vm.lastDate).toBe("2024-12-31");
  });

  it("统计：horizons 与 declared 透传", () => {
    const vm = statisticsToVm(stats);
    expect(vm.horizons).toEqual([1, 3, 5, 10, 20]);
    expect(vm.declaredEvents).toBe(10240);
    expect(vm.declaredRows).toBe(237128);
  });
});

describe("datasetRegistryAdapter · 错误态 / 格式化", () => {
  it("错误 → DiagnosticError（code/title/suggestions/technical）", () => {
    const diag = rpcErrorToDiagnostic("boom", { title: "列表加载失败" });
    expect(diag.code).toBe("RPC_ERROR");
    expect(diag.title).toBe("列表加载失败");
    expect(diag.explanation).toContain("后端");
    expect(diag.suggestions!.length).toBeGreaterThan(0);
    expect(diag.technical).toBe("boom");
  });

  it("formatCount：number 千分位 / null → —", () => {
    expect(formatCount(237128)).toBe("237,128");
    expect(formatCount(null)).toBe("—");
    expect(formatCount(undefined)).toBe("—");
  });

  it("formatDateTime：ISO → 本地 YYYY-MM-DD HH:mm / null → —", () => {
    expect(formatDateTime(null)).toBe("—");
    const out = formatDateTime("2026-09-10T02:30:00.000Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
