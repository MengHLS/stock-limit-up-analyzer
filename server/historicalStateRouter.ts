/**
 * FE-0 — historicalState tRPC Router（STEP 12.5 · asOf(T) 历史状态查询）。
 *
 * 纪律：
 * - **只读复用**：直接调用 STEP 12.5 既有 `querySecurityHistoricalState`，不重写任何重建逻辑；
 * - **诚实空值**：DB 不可用或 securityId 不存在 → 返回 `null`（不伪造空状态、不冒充 KNOWN）；
 * - **PIT 透传**：asOf 由调用方显式给出，后端按 §4 PIT 铁律过滤，本层不做任何「补全/兜底」。
 *
 * 状态：STEP 12.5 编码已 CODE_READY（单测 28+29 全过），
 * VALIDATED 依赖 A~H 全 DATA_READY（§0.2 禁止越级）——本 router 不因暴露而宣称认证。
 */

import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { isoDateSchema } from "../shared/researchContracts";
import { querySecurityHistoricalState } from "./historicalState";
import { lookupSecuritiesByCode, parseCodeQuery } from "./historicalState/codeLookup";
import {
  historicalStateResolveInputSchema,
  historicalStateResolveResultSchema,
} from "../shared/researchContracts";

/** 单标的 asOf(T) 查询入参（与 shared 契约同源，此处再声明以保持 router 自解释）。 */
const asOfInput = z.object({
  securityId: z.string().min(1, "securityId 必填"),
  tradeDate: isoDateSchema,
  asOf: isoDateSchema.nullable().optional(),
  coreIndexCodes: z.array(z.string()).optional(),
});

export const historicalStateRouter = router({
  /**
   * 单标的 asOf(T) 历史状态（十问：身份/上市/退市/行业/可交易/流动性/价格/公司行为/市场状态/可知性）。
   *
   * @returns 完整 SecurityHistoricalState；DB 不可用或标的不存在 → null。
   */
  asOf: publicProcedure.input(asOfInput).query(async ({ input }) => {
    const state = await querySecurityHistoricalState(input.securityId, input.tradeDate, {
      asOf: input.asOf ?? null,
      ...(input.coreIndexCodes ? { coreIndexCodes: input.coreIndexCodes } : {}),
    });
    // 未命中即诚实返回 null（不构造「全 UNKNOWN」假状态冒充查询结果）。
    return state ?? null;
  }),

  /**
   * FE-2 — 6 位代码 → 候选证券 解析（asOf 查询前必须先有 securityId）。
   * 代码可能跨证券复用（code reuse），故返回候选集由用户选定；DB 不可用/超时 → error 明示。
   */
  resolveCode: publicProcedure
    .input(historicalStateResolveInputSchema)
    .output(historicalStateResolveResultSchema)
    .query(async ({ input }) => {
      const parsed = parseCodeQuery(input.query);
      if (parsed.error || !parsed.digits) {
        return {
          query: input.query,
          digits: null,
          exchange: null,
          parseError: parsed.error ?? "无法解析",
          candidates: [],
          error: null,
        };
      }
      const { candidates, error } = await lookupSecuritiesByCode({
        digits: parsed.digits,
        exchange: parsed.exchange,
        limit: input.limit,
      });
      return {
        query: input.query,
        digits: parsed.digits,
        exchange: parsed.exchange,
        parseError: null,
        candidates,
        error,
      };
    }),
});

export type HistoricalStateRouter = typeof historicalStateRouter;
