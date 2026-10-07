/**
 * STOCK-SELECTION-001/005 —— 选股 tRPC Router。
 *
 * 定位：把选股域暴露给「选股」页面，页面只依赖本 router 的端点：
 *   1. `listStrategies` —— 可选策略清单（页面据此渲染策略选择器 ⇒ 一个页面兼容多策略）；
 *   2. `listDataSources` —— 可选数据载体（live = 当日行情 / dataset = 数据集快照）；
 *   3. `select` —— 给定 {策略, 数据载体, 决策日, TopN} 返回当日选股清单 + 剔除统计（**纯读，不落库**）；
 *   4. `saveRun` —— 按**同一坐标**重算后把选股清单 + **剔除统计**冻结进 `stock_selection_run`
 *      （用户手动「保存」触发；同坐标 UPSERT 覆盖，幂等）；
 *   5. `listRuns` / `getRun` —— 回看已保存的历史选股记录（含剔除统计）。
 *
 * 纪律：
 *   - **选股本身只读**：`select` 无副作用；**唯一写路径**是 `saveRun` → 只写 `stock_selection_run`
 *     这一张快照表，不碰行情 / 数据集 / 策略版本 / 执行链；
 *   - **不信任客户端数据**：`saveRun` 只收坐标，picks / 剔除统计恒由服务端**重算**得出；
 *   - **错误不吞**：域错误码（缺 rd0 / 日历缺洞 / 超护栏 / 未知策略）如实转成 tRPC 错误，
 *     绝不降级成「今天没有候选」；
 *   - **可注入**：registry 与 runStore 均可注入替身（单测不连库），生产用默认（DB + 进程内身份缓存）。
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import {
  createDbStockSelectionRunStore,
  createStockSelectionRegistry,
  StockSelectionError,
  isValidDecisionDate,
  type StockSelectionRegistry,
  type StockSelectionRunStore,
  type StockSelectionStrategy,
} from "./stockSelection";

/** 数据载体指认（可选；缺省 = 域内默认载体）。 */
const sourceRefSchema = z.object({
  kind: z.enum(["dataset", "live"], { message: "数据载体仅支持 dataset | live" }),
  /** 仅 `dataset` 载体需要：数据集版本坐标（`dataset_version.id`；label 不作为坐标）。 */
  datasetVersionId: z.number().int().positive("数据集版本 id 必须为正整数").optional(),
});

const selectInputSchema = z.object({
  /** 策略 id（未知 id 由注册表响亮拒绝：`SELECTION_STRATEGY_UNKNOWN`）。 */
  strategyId: z.string().min(1, "策略 id 不能为空"),
  /** 决策日（收盘后，YYYY-MM-DD）。 */
  decisionDate: z
    .string()
    .refine(isValidDecisionDate, "决策日必须是 YYYY-MM-DD 形式的合法日历日"),
  /** 每日最多选几只（缺省 = 策略默认）。 */
  topN: z.number().int().min(1).max(50).optional(),
  /** 数据载体；省略 = 默认载体（当前 `dataset`，此时必须给 `datasetVersionId`）。 */
  source: sourceRefSchema.optional(),
});

const listRunsInputSchema = z.object({
  /** 最多返回多少条历史（缺省 20，上限 200）。 */
  limit: z.number().int().positive().max(200).optional(),
});

const getRunInputSchema = z.object({ runId: z.string().min(1, "runId 不能为空") });

function resolveStrategy(registry: StockSelectionRegistry, strategyId: string): StockSelectionStrategy {
  try {
    return registry.get(strategyId);
  } catch (error) {
    if (error instanceof StockSelectionError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
    }
    throw error;
  }
}

/** 选股域错误 → tRPC（消息带稳定错误码，跨 RPC 边界不丢诊断线索）。 */
function toSelectionTrpcError(error: unknown): never {
  if (error instanceof StockSelectionError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message, cause: error });
  }
  throw error;
}

export function buildStockSelectionRouter(
  registry: StockSelectionRegistry,
  runStore: StockSelectionRunStore = createDbStockSelectionRunStore(),
) {
  return router({
    listStrategies: publicProcedure.query(() =>
      registry.list().map((strategy) => ({
        id: strategy.id,
        label: strategy.label,
        description: strategy.description,
        datasetId: strategy.datasetId,
      })),
    ),

    /** 可选数据载体（页面「数据来源」选择器）：live = 当日行情；dataset = 数据集快照（研究口径）。 */
    listDataSources: publicProcedure.query(() => registry.listDataSources()),

    select: publicProcedure.input(selectInputSchema).query(async ({ input }) => {
      const strategy = resolveStrategy(registry, input.strategyId);
      try {
        // 🔴 只把「决策日 + TopN + 数据载体」交给策略；策略不接触 strategyId / 数据集细节。
        return await strategy.select({
          decisionDate: input.decisionDate,
          topN: input.topN,
          source: input.source,
        });
      } catch (error) {
        toSelectionTrpcError(error);
      }
    }),

    /**
     * 保存选股结果（含剔除统计）。
     *
     * 只接收**坐标**：服务端按同一坐标重算一次再落库 ⇒ 客户端无法伪造 picks / 剔除统计。
     * 同坐标重复保存 = UPSERT 覆盖（runId 确定性），不产生重复行。
     */
    saveRun: publicProcedure.input(selectInputSchema).mutation(async ({ input }) => {
      const strategy = resolveStrategy(registry, input.strategyId);
      try {
        const selection = await strategy.select({
          decisionDate: input.decisionDate,
          topN: input.topN,
          source: input.source,
        });
        return await runStore.save(selection);
      } catch (error) {
        toSelectionTrpcError(error);
      }
    }),

    /** 历史选股记录（列表行，含剔除统计；不含 picks 明细）。 */
    listRuns: publicProcedure.input(listRunsInputSchema).query(({ input }) => runStore.list(input.limit)),

    /** 历史选股记录明细（含 picks）；不存在返回 null（调用方自行渲染空态）。 */
    getRun: publicProcedure.input(getRunInputSchema).query(({ input }) => runStore.get(input.runId)),
  });
}

/** 生产实例（DB 只读 reader + 进程内只读一次的身份表 + DB 快照存储）。 */
export const stockSelectionRouter = buildStockSelectionRouter(createStockSelectionRegistry());