/**
 * PD-03 —— 候选列表（只读）行为测试。
 *
 * 依据：`docs/product/SPEC-003-PD03-candidate-list.md` §6 验收判据 +
 *       `docs/architecture/SCOPE-001-candidate-list-endpoint.md` §8 Test Plan。
 *
 * 覆盖：
 *   1. 返回**轻量行**（不含三套规则 JSON / 旧链遗留列）且分歧标记由快照列派生；
 *   2. `status` 过滤；
 *   3. `sourceDatasetVersionId`（研究**来源**坐标）过滤；
 *   4. `limit` 截断 + `order: "desc"`；
 *   5. 缺省行为（不截断、升序）——不在此层另发明默认值。
 */

import { describe, expect, it } from "vitest";
import { createInMemoryResearchCandidateRepository } from "../../../../server/research/candidateRepository";
import { createStrategyCandidateService } from "../../../../server/research/strategyCandidate/service";
import type { ResearchStrategyCandidate } from "../../../../server/research/vocabulary";

function makeService(rows: readonly ResearchStrategyCandidate[]) {
  return createStrategyCandidateService({
    candidates: createInMemoryResearchCandidateRepository({ rows }),
    // 列表**不解析** Dataset 版本（避免 N+1）；端口在此只需存在。
    datasetVersions: { async getVersionById() { return undefined; } },
  });
}

function candidate(over: Partial<ResearchStrategyCandidate> & { name: string }): ResearchStrategyCandidate {
  return { experimentId: 1, status: "REVIEW", ...over } as ResearchStrategyCandidate;
}

describe("PD-03 · strategyCandidate.list（只读列表）", () => {
  it("返回轻量行，且分歧标记由 sourceDatasetDivergenceReason 派生", async () => {
    const service = makeService([
      candidate({ name: "A", sourceDatasetVersionId: 540002, sourceDatasetDivergenceReason: null }),
      candidate({ name: "B", sourceDatasetVersionId: 540003, sourceDatasetDivergenceReason: "执行绑定改用 v3" }),
    ]);

    const rows = await service.list();

    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(rows.map((r) => r.hasSourceDatasetDivergence)).toEqual([false, true]);
    expect(rows.map((r) => r.sourceDatasetVersionId)).toEqual([540002, 540003]);

    // 轻量：字段集**恰好**是列表契约，不含规则 JSON，也不含 experimentId / conclusionId。
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "createdAt",
        "hasSourceDatasetDivergence",
        "id",
        "name",
        "sourceDatasetVersionId",
        "status",
        "strategyDefinitionId",
        "updatedAt",
      ].sort(),
    );
  });

  it("按 status 过滤", async () => {
    const service = makeService([
      candidate({ name: "review-1", status: "REVIEW" }),
      candidate({ name: "accepted-1", status: "ACCEPTED" }),
      candidate({ name: "review-2", status: "REVIEW" }),
    ]);

    const rows = await service.list({ status: "REVIEW" });

    expect(rows.map((r) => r.name)).toEqual(["review-1", "review-2"]);
  });

  it("按研究来源 Dataset 版本过滤（来源坐标，不是执行绑定坐标）", async () => {
    const service = makeService([
      candidate({ name: "v2-1", sourceDatasetVersionId: 540002 }),
      candidate({ name: "v3-1", sourceDatasetVersionId: 540003 }),
      candidate({ name: "none" }),
    ]);

    const rows = await service.list({ sourceDatasetVersionId: 540003 });

    expect(rows.map((r) => r.name)).toEqual(["v3-1"]);
  });

  it("limit 截断 + order desc（按 id 倒序）", async () => {
    const service = makeService([
      candidate({ name: "r1" }),
      candidate({ name: "r2" }),
      candidate({ name: "r3" }),
    ]);

    const rows = await service.list({ limit: 2, order: "desc" });

    expect(rows.map((r) => r.name)).toEqual(["r3", "r2"]);
  });

  it("缺省 = 不截断且升序（不在此层发明默认值）", async () => {
    const service = makeService([
      candidate({ name: "r1" }),
      candidate({ name: "r2" }),
      candidate({ name: "r3" }),
    ]);

    const rows = await service.list();

    expect(rows.map((r) => r.name)).toEqual(["r1", "r2", "r3"]);
  });
});