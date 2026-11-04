/**
 * FE-1 — 数据域健康看板 tRPC Router（STEP 12 · A~G 域 + gate 认证证据）。
 *
 * 纪律：
 * - **只读真实证据**：判定来自 `docs/researchReadyGate/research_ready_gate.json`（certify 脚本只读 TiDB 生成），
 *   本 router **不计算** gate，也不提供「手动把 PENDING 改成 PASS」的能力；
 * - **`recertify` 的边界（唯一带副作用的入径）**：它只做「以服务端身份重跑那条既有只读脚本 +
 *   读回产物」，判定逻辑仍 100% 在脚本里（服务端零复制）；**入参里没有任何字段**能让调用方给出状态，
 *   失败时返回 `ok:false` 且 `snapshot` 恒为 null。属 `adminProcedure`（会写磁盘证据文件）；
 * - **认证态 / 实况态严格分离**：`overview` = 认证快照；`liveCounts` = 未认证查库，
 *   响应带 `certified:false` 字面量类型，前端无法误当作 gate 依据；
 * - **诚实失败**：证据缺失 / 查库失败 → 返回 error 字段与空表，**不构造假数据**。
 */

import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import {
  buildDataHealthOverview,
  listEvidenceArtifacts,
  queryLiveCounts,
  LIVE_NOTE,
} from "./dataHealth";
import { recertifyResearchReadyGate } from "./researchReadyGate/recertify";
import {
  dataHealthOverviewSchema,
  evidenceArtifactSchema,
  liveCountsResultSchema,
  recertifyGateResultSchema,
  type RecertifyGateResult,
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

  /**
   * **重跑数据域认证** —— 等价于在仓库根执行 `node scripts/step12_certify_gate.mjs`。
   *
   * 与「刷新」的区别（禁止混淆，二者不是同一件事）：
   *   - `overview` / 页面「重读快照」= **重读**磁盘上的快照文件（零 DB 开销，不改变认证结果）；
   *   - `recertify` / 页面「重跑认证」 = **重跑**那条只读认证命令，再读回新快照（真实查库，数十秒）。
   *
   * 纪律：本过程**不接收任何判定入参**，也不提供「把 PENDING 改成 PASS」的能力 ——
   * gate 判定永远来自脚本对真实 TiDB 的只读查询。失败 / 超时 / 产物不合法 ⇒ `ok:false`
   * 且 `snapshot` 为 null（即使磁盘上仍留着上一次的产物也不回传）。
   * 并发触发由服务端单飞收敛为同一次运行（`sharedWithInFlight` 如实标记）。
   */
  recertify: adminProcedure
    .output(recertifyGateResultSchema)
    .mutation(async (): Promise<RecertifyGateResult> => {
      return recertifyResearchReadyGate();
    }),
});

export type DataHealthRouter = typeof dataHealthRouter;
