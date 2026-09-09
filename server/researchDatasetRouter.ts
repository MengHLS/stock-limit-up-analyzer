/**
 * FE-0 — researchDataset tRPC Router（STEP 12.6 · Research Dataset 构建）。
 *
 * 纪律：
 * - **只读复用**：调用 STEP 12.6 既有 `buildResearchDataset`，不重写构建/版本/政策逻辑；
 * - **不回传 rows**：rows 可达百万级，经 RPC 传输不可行；本层只回传摘要
 *   （datasetVersion / policySet / dataSnapshot / universeDefinition / gate / rowCount），
 *   rows 仅供后端研究链路消费（§31 禁止前端篡改或重算量化结果）；
 * - **诚实 gate**：gate = FAIL / PASS / INCONCLUSIVE 原样透传，
 *   不把 INCONCLUSIVE 粉饰为 PASS，不把空数据集冒充成功（§0.2）；
 * - **限流保护**：经 RPC 触发必须显式限流，省略时取保守默认值，防止误触全历史构建。
 *
 * 状态：STEP 12.6 编码已 CODE_READY（单测 37 全过 + 确定性 datasetVersion 已验证），
 * DATA_READY / VALIDATED 依赖 A~H 全 DATA_READY（§0.2 禁止越级）。
 */

import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  isoDateSchema,
  RESEARCH_DATASET_RPC_DEFAULTS,
  type ResearchDatasetSummary,
} from "../shared/researchContracts";
import { buildResearchDataset, type ResearchDatasetRequest } from "./researchDataset";

const buildInput = z.object({
  name: z.string().min(1, "数据集名称必填"),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  asOfPerTradeDate: z.boolean().optional(),
  asOf: isoDateSchema.nullable().optional(),
  coreIndexCodes: z.array(z.string()).optional(),
  maxTradingDays: z.number().int().positive().optional(),
  maxSecuritiesPerDay: z.number().int().positive().optional(),
  dataReady: z.boolean().optional(),
});

export const researchDatasetRouter = router({
  /**
   * 构建 Research Dataset 并返回**摘要**（不含 rows）。
   *
   * 两次相同入参应得到相同 datasetVersion（确定性已由 C-12.6.1 单测验证）。
   */
  build: publicProcedure.input(buildInput).mutation(async ({ input }) => {
    const request: ResearchDatasetRequest = {
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      ...(input.asOfPerTradeDate !== undefined ? { asOfPerTradeDate: input.asOfPerTradeDate } : {}),
      ...(input.asOf !== undefined ? { asOf: input.asOf } : {}),
      ...(input.coreIndexCodes ? { coreIndexCodes: input.coreIndexCodes } : {}),
    };

    const dataset = await buildResearchDataset(request, {
      dataReady: input.dataReady ?? RESEARCH_DATASET_RPC_DEFAULTS.dataReady,
      maxTradingDays: input.maxTradingDays ?? RESEARCH_DATASET_RPC_DEFAULTS.maxTradingDays,
      maxSecuritiesPerDay:
        input.maxSecuritiesPerDay ?? RESEARCH_DATASET_RPC_DEFAULTS.maxSecuritiesPerDay,
    });

    // rows 不回传（体积不可控）；rowCount 如实反映实际构建行数。
    const summary: ResearchDatasetSummary = {
      datasetVersion: dataset.datasetVersion,
      universeDefinition: dataset.universeDefinition,
      policySet: dataset.policySet,
      dataSnapshot: dataset.dataSnapshot,
      gate: dataset.gate,
      gateNotes: dataset.gateNotes,
      rowCount: dataset.rows.length,
    };
    return summary;
  }),
});

export type ResearchDatasetRouter = typeof researchDatasetRouter;
