/**
 * FE-1 — 数据域健康看板 tRPC Router（STEP 12 · A~G 域 + gate 认证证据）。
 *
 * 纪律：
 * - **只读真实证据**：判定来自 `docs/researchReadyGate/research_ready_gate.json`（certify 脚本只读 TiDB 生成），
 *   本 router 不重新计算 gate，也不提供「手动把 PENDING 改成 PASS」的能力；
 * - **认证态 / 实况态严格分离**：`overview` = 认证快照；`liveCounts` = 未认证查库，
 *   响应带 `certified:false` 字面量类型，前端无法误当作 gate 依据；
 * - **诚实失败**：证据缺失 / 查库失败 → 返回 error 字段与空表，**不构造假数据**。
 */

import { publicProcedure, router } from "./_core/trpc";
import {
  buildDataHealthOverview,
  listEvidenceArtifacts,
  queryLiveCounts,
  LIVE_NOTE,
} from "./dataHealth";
import {
  dataHealthOverviewSchema,
  evidenceArtifactSchema,
  liveCountsResultSchema,
} from "../shared/dataHealthContracts";

export const dataHealthRouter = router({
  /**
   * 健康看板总览：认证 gate 快照 + A~G 派生域健康 + 证据清单。
   * 不查库（零 DB 开销），可安全频繁刷新。
   */
  overview: publicProcedure.output(dataHealthOverviewSchema).query(async () => {
    return buildDataHealthOverview();
  }),

  /** 证据产物清单（docs/researchReadyGate + docs/audit 下真实 JSON）。 */
  evidence: publicProcedure
    .output(evidenceArtifactSchema.array())
    .query(async () => {
      return listEvidenceArtifacts();
    }),

  /**
   * 未认证实况行数（**重型查库**，仅用于观察回填进度）。
   *
   * 注意：本结果 `certified === false`，**不得**用于 `RESEARCH_READY` 判定；
   * 正式判定只认 `overview` 的认证 gate 快照。
   */
  liveCounts: publicProcedure.output(liveCountsResultSchema).query(async () => {
    const { capturedAt, tables, error } = await queryLiveCounts();
    return { capturedAt, certified: false as const, tables, note: LIVE_NOTE, error };
  }),
});

export type DataHealthRouter = typeof dataHealthRouter;
