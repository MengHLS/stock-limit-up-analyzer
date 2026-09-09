/**
 * FE-0 扩展 — Research Run Router（策略目录 + 运行就绪探测，只读）。
 *
 * 定位：FE-4 运行工作台 / FE-5 绩效就绪门的**权威后端状态源**。
 * 在 run/metrics 完整执行端点（依赖数据注入 + 执行器装配 + gate 认证）落地前，
 * 本 router 提供两块真实能力：
 *
 *   1. `catalog.list` —— 已注册研究策略元数据（来自 ResearchStrategyRegistry，
 *      启动装配 `registerBuiltInResearchStrategies` 幂等注册，无 DB 依赖）；
 *   2. `run.readiness` —— 运行就绪合成判定：认证 gate 快照（readCertifiedGate，
 *      与 FE-1 dataHealth 同一事实来源）+ 注册策略存在性 + 执行器绑定状态。
 *
 * 纪律（对齐 researchRouter.ts 与 dataHealthRouter.ts）：
 *   - **只读**：本 router 不发起回测、不产生 run 记录、不改变任何状态；
 *   - **不冒充 READY**：真实执行链（runResearchBacktest + 数据 loader 注入 + 14 阶段
 *     closedLoop executor）尚未装配绑定 → `executorBound=false` 恒定，readiness 老实
 *     BLOCKED（对应 closedLoop CL_DATA_NOT_INJECTED / CL_DATASET_GATE_NOT_PASS 语义）；
 *     数据域认证 + 执行链装配完成后由后端翻转，前端零改动即变 READY_TO_RUN；
 *   - **后端为权威**：dataset gate 摘要取自 dataHealth.readCertifiedGate 的认证快照
 *     （certify 脚本只读 TiDB 生成），本 router 不重算 gate、不读实况行数；
 *   - **证据缺失不伪造**：gate 文件缺失/解析失败 → evidenceAvailable=false +
 *     evidenceError，verdict=EVIDENCE_MISSING。
 */

import { publicProcedure, router } from "./_core/trpc";
import {
  registerBuiltInResearchStrategies,
  researchStrategyRegistry,
} from "./research";
import { readCertifiedGate } from "./dataHealth";
import {
  researchCatalogItemSchema,
  researchRunReadinessSchema,
  type ResearchCatalogItem,
  type ResearchDatasetGateSummary,
  type ResearchRunReadinessVerdict,
} from "../shared/researchContracts";
import type { ResearchStrategyDefinition } from "./research/strategyContract";

// 幂等启动装配：把内置研究策略注册进单例注册中心（已注册则跳过）。
registerBuiltInResearchStrategies(researchStrategyRegistry);

/** 策略定义 → 目录条目（轻量元数据；参数明细不进 payload）。 */
function toCatalogItem(
  definition: ResearchStrategyDefinition
): ResearchCatalogItem {
  return {
    strategyId: definition.strategyId,
    version: definition.version,
    name: definition.name,
    description: definition.description ?? null,
    requiredData: [...definition.requiredData],
    requiredFeatures: [...definition.requiredFeatures],
    decisionPoint: definition.decisionPoint,
    ...(definition.metadata?.tags
      ? { tags: [...definition.metadata.tags] }
      : {}),
    parameterCount: definition.parameterSchema.parameters.length,
  };
}

/** 由认证 gate 快照派生摘要；证据缺失 → 返回带 evidenceError 的保守形态。 */
async function deriveDatasetGateSummary(): Promise<ResearchDatasetGateSummary> {
  const { gate, exists, parseError } = await readCertifiedGate();
  if (!exists || !gate) {
    return {
      researchReady: false,
      capturedAt: null,
      passCount: 0,
      pendingCount: 0,
      failCount: 0,
      pendingChecks: [],
      evidenceAvailable: exists,
      evidenceError: parseError,
    };
  }
  const pendingChecks = gate.checks
    .filter(check => check.status === "PENDING")
    .map(check => check.name);
  return {
    researchReady: gate.researchReady,
    capturedAt: gate.capturedAt,
    passCount: gate.summary.PASS,
    pendingCount: gate.summary.PENDING,
    failCount: gate.summary.FAIL,
    pendingChecks,
    evidenceAvailable: true,
    evidenceError: null,
  };
}

export const researchRunRouter = router({
  /** 已注册研究策略目录（v1：leader-candidate-baseline 等内置策略）。 */
  catalog: router({
    list: publicProcedure
      .output(researchCatalogItemSchema.array())
      .query(() => {
        return researchStrategyRegistry.list().map(toCatalogItem);
      }),
  }),

  /**
   * 运行就绪探测。
   * 未就绪原因按优先级 EVIDENCE_MISSING > DATASET_NOT_READY > STRATEGIES_MISSING
   * > EXECUTOR_NOT_BOUND 汇总到 reasons（可同时存在多条）。
   */
  readiness: publicProcedure
    .output(researchRunReadinessSchema)
    .query(async () => {
      const gate = await deriveDatasetGateSummary();
      const strategies = researchStrategyRegistry.list().map(toCatalogItem);
      // v1：真实执行链未绑定（closedLoop 14 阶段 executor + 数据 loader 装配属数据
      // 认证后的集成工作）；此处恒定 false，前端据此老实显示「执行器未就绪」。
      const executorBound = false;

      const reasons: string[] = [];
      let verdict: ResearchRunReadinessVerdict = "READY_TO_RUN";

      if (!gate.evidenceAvailable) {
        verdict = "EVIDENCE_MISSING";
        reasons.push(
          `认证证据缺失：${gate.evidenceError ?? "research_ready_gate.json 不存在"}。请先运行认证脚本生成 gate。`
        );
      } else if (!gate.researchReady) {
        verdict = "DATASET_NOT_READY";
        reasons.push(
          gate.pendingChecks.length > 0
            ? `数据域认证未通过（RESEARCH_READY=FALSE）：${gate.pendingChecks.join("、")} 尚为 PENDING，C/D/E 域回填完成后重新 certify 即解锁。`
            : "数据域认证未通过（RESEARCH_READY=FALSE），请检查 gate 快照。"
        );
      }

      if (strategies.length === 0) {
        if (verdict === "READY_TO_RUN") verdict = "STRATEGIES_MISSING";
        reasons.push(
          "研究策略注册表为空：尚未注册任何内置策略（registerBuiltInResearchStrategies）。"
        );
      }

      if (!executorBound) {
        if (verdict === "READY_TO_RUN") verdict = "EXECUTOR_NOT_BOUND";
        reasons.push(
          "真实执行链尚未绑定：run/backtest 执行器与数据 loader 装配待数据域认证后集成（closedLoop CL_RUNNER_NOT_INJECTED）。"
        );
      }

      const canRun =
        gate.evidenceAvailable &&
        gate.researchReady &&
        strategies.length > 0 &&
        executorBound;

      return {
        canRun,
        verdict,
        reasons,
        datasetGate: gate,
        strategies,
        executorBound,
      };
    }),
});

export type ResearchRunRouter = typeof researchRunRouter;
