/**
 * STEP DATASET-001 — Registry 测试（§38.2 Definition Test / §38.3 Version Test / §38.4 Version Isolation）。
 */

import { describe, expect, it } from "vitest";
import { DatasetRegistryService, InMemoryDatasetRegistry } from "./registry";

function makeService() {
  return new DatasetRegistryService(new InMemoryDatasetRegistry());
}

describe("Dataset Registry", () => {
  it("datasetCode 唯一（重复创建被拒绝）", async () => {
    const svc = makeService();
    await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    await expect(
      svc.createDefinition({ datasetCode: "first_limit_pullback", name: "dup", datasetType: "EVENT" }),
    ).rejects.toThrow(/已存在/);
  });

  it("创建定义时物理表名显式落库（§8 不运行时猜名）", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    expect(def.eventTableName).toBe("ds_first_limit_pullback_event");
    expect(def.pathTableName).toBe("ds_first_limit_pullback_path");
    expect(def.outcomeTableName).toBe("ds_first_limit_pullback_outcome");
    expect(def.featureTableName).toBeNull();
  });

  it("非法 datasetCode 拒绝创建", async () => {
    const svc = makeService();
    await expect(
      svc.createDefinition({ datasetCode: "first_limit_pullback_v1", name: "x", datasetType: "EVENT" }),
    ).rejects.toThrow(/非法 datasetCode/);
  });

  it("(datasetId, version) 唯一（§38.3）", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "breakout", name: "突破", datasetType: "EVENT" });
    const datasetId = def.id!;
    await svc.createVersion({ datasetId, version: "v1", startDate: null, endDate: null });
    await expect(
      svc.createVersion({ datasetId, version: "v1", startDate: null, endDate: null }),
    ).rejects.toThrow(/版本已存在/);
    // 不同 dataset 可用同 version 字符串
    const def2 = await svc.createDefinition({ datasetCode: "consecutive_limit", name: "连板", datasetType: "EVENT" });
    await expect(svc.createVersion({ datasetId: def2.id!, version: "v1", startDate: null, endDate: null })).resolves.toBeDefined();
  });

  it("Version 隔离：v1 / v2 物理同表、逻辑隔离（dataset_version_id）", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const v1 = await svc.createVersion({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-06-30" });
    const v2 = await svc.createVersion({ datasetId: def.id!, version: "v2", startDate: "2024-07-01", endDate: "2024-12-31" });
    expect(v1.id).not.toBe(v2.id);
    expect(v1.id).toBeDefined();
    expect(v2.id).toBeDefined();
    // 物理表名不因 version 变化（§30：禁止一版一表）
    expect(def.eventTableName).toBe("ds_first_limit_pullback_event");
  });

  it("作业生命周期：start → progress → complete", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "breakout", name: "突破", datasetType: "EVENT" });
    const v = await svc.createVersion({ datasetId: def.id!, version: "v1", startDate: null, endDate: null });
    const job = await svc.startJob({ datasetVersionId: v.id!, jobId: "job-1" });
    expect(job.status).toBe("RUNNING");
    await svc.updateJobProgress("job-1", { processedRows: 100, lastTradeDate: "2024-01-03" });
    await svc.completeJob("job-1");
    const done = await (svc as unknown as { repo: { getJob: (id: string) => Promise<{ status: string }> } }).repo.getJob("job-1");
    expect(done.status).toBe("COMPLETED");
  });
});
