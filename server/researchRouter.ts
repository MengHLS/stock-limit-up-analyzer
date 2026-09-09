/**
 * FE-0 — research tRPC Router（STEP 15 策略 Schema + 版本化 / STEP 21 生命周期）。
 *
 * 纪律：
 * - **只读复用**：调用 STEP 15 / 21 既有纯函数（validate / bump / compare / applyLifecycleTransition），
 *   不重写任何语义；本层只做「传输 → 领域」的边界投递；
 * - **后端为权威**：领域对象以 `z.custom` 透传进来后，由后端既有校验器
 *   （validateStrategyDocument / assertValidStrategyLifecycleRecord）作权威校验，
 *   shared 层不复制领域 schema，避免双份口径漂移；
 * - **错误不静默**：生命周期迁移不满足 §23 四要素/迁移表时后端抛错，
 *   本层原样冒泡为 tRPC 错误（不吞异常、不返回「成功但没变」的假结果）；
 * - **状态不冒充**：本 router 不改变任何 STEP 状态判定——STEP 15/21 仍为
 *   `CODE_READY`，VALIDATED 依赖数据链就绪认证（§0.2 禁止越级）。
 */

import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  strategyDocumentSchema,
  strategyLifecycleRecordSchema,
  lifecycleTransitionInputSchema,
  metricsEvaluateInputSchema,
} from "../shared/researchContracts";
import type { StrategyDocument } from "./research/strategySchema/types";
import type { StrategyLifecycleRecord, LifecycleEvidenceRef } from "./research/lifecycle/types";
import {
  validateStrategyDocument,
  bumpStrategyVersion,
  compareStrategyDocuments,
  applyLifecycleTransition,
  STRATEGY_LIFECYCLE_STATUSES,
  STRATEGY_LIFECYCLE_TRANSITIONS,
} from "./research";
import { evaluatePerformance } from "./research/performanceMetrics";
import { evaluateRiskAdjustedMetrics } from "./research/riskAdjustedMetrics";
import { evaluateTradeQualityMetrics } from "./research/tradeQualityMetrics";
import type { EquityPoint, Trade } from "./backtest/types";

/**
 * 传输层 → 领域层边界投递。
 * 形态已由 zod 保证为对象；语义合法性交由后端权威校验器判定（不在此处「修正」入参）。
 */
function toStrategyDocument(value: Record<string, unknown>): StrategyDocument {
  return value as unknown as StrategyDocument;
}

function toLifecycleRecord(value: Record<string, unknown>): StrategyLifecycleRecord {
  return value as unknown as StrategyLifecycleRecord;
}

export const researchRouter = router({
  strategy: router({
    /** 校验 StrategyDocument（§16 全字段 + §17 追溯）。返回结构化 issue 列表。 */
    validate: publicProcedure
      .input(z.object({ document: strategyDocumentSchema }))
      .mutation(({ input }) => validateStrategyDocument(toStrategyDocument(input.document))),

    /** semver 版本推进（major/minor/patch）。 */
    bump: publicProcedure
      .input(
        z.object({
          version: z.string().min(1, "version 必填（semver x.y.z）"),
          bump: z.enum(["major", "minor", "patch"]),
        }),
      )
      .mutation(({ input }) => ({ version: bumpStrategyVersion(input.version, input.bump) })),

    /** 比较两个策略本体（字段级差异，供版本对比 UI 使用）。 */
    compare: publicProcedure
      .input(z.object({ left: strategyDocumentSchema, right: strategyDocumentSchema }))
      .mutation(({ input }) =>
        compareStrategyDocuments(
          toStrategyDocument(input.left),
          toStrategyDocument(input.right),
        ),
      ),
  }),

  lifecycle: router({
    /**
     * 生命周期状态机描述（§23）。
     * 状态与迁移表**取自后端常量**（唯一事实来源），前端不得自行维护一份。
     */
    describe: publicProcedure.query(() => ({
      statuses: [...STRATEGY_LIFECYCLE_STATUSES],
      transitions: STRATEGY_LIFECYCLE_TRANSITIONS,
    })),

    /**
     * 应用一次生命周期迁移，返回**新的**记录（append-only，不改原记录）。
     * 不满足迁移表或 §23 四要素（timestamp/reason/experiment/evidence）时抛错。
     */
    transition: publicProcedure
      .input(z.object({ record: strategyLifecycleRecordSchema, input: lifecycleTransitionInputSchema }))
      .mutation(({ input }) =>
        applyLifecycleTransition(toLifecycleRecord(input.record), {
          to: input.input.to,
          timestamp: input.input.timestamp,
          reason: input.input.reason,
          experimentId: input.input.experimentId ?? null,
          actor: input.input.actor ?? null,
          ...(input.input.evidence
            ? { evidence: input.input.evidence as unknown as readonly LifecycleEvidenceRef[] }
            : {}),
        }),
      ),
  }),

  /**
   * FE-5 — 绩效评估（C-16.1 收益/风险/回撤 + C-16.2 风险调整 + C-16.3 交易质量）。
   *
   * 纯函数、确定性：给定同一（equityCurve, trades, 口径参数）必得同一指标。
   * 三套指标共享同一输入一次性求值，避免各自重算导致口径不一致。
   *
   * 纪律：
   * - **只读复用**：调用 C-16.x 既有纯函数，不重写任何指标语义；
   * - **不冒充结论**：本端点只算指标，不产出策略结论；RESEARCH_READY 之前
   *   结果一律属「技术预览」口径（前端须明示，见 R7）；
   * - **响亮失败**：空曲线 / 单点曲线等退化输入由评估器结构化抛错，本层原样冒泡
   *   为 tRPC 错误（不吞异常、不返回 NaN 假指标）。
   */
  metrics: router({
    evaluate: publicProcedure
      .input(metricsEvaluateInputSchema)
      .mutation(({ input }) => {
        const equityCurve = input.equityCurve as readonly EquityPoint[];
        const trades = input.trades as readonly Trade[] | undefined;
        const base = {
          equityCurve,
          annualizationFactor: input.annualizationFactor,
          ...(trades !== undefined ? { trades } : {}),
        };

        const performance = evaluatePerformance({
          ...base,
          drawdownThresholdPct: input.drawdownThresholdPct,
          downsideTarget: input.downsideTarget,
        });
        const riskAdjusted = evaluateRiskAdjustedMetrics({
          ...base,
          rfAnnualPct: input.rfAnnualPct,
          downsideTarget: input.downsideTarget,
        });
        const tradeQuality = evaluateTradeQualityMetrics(base);

        return { performance, riskAdjusted, tradeQuality };
      }),
  }),
});

export type ResearchRouter = typeof researchRouter;
