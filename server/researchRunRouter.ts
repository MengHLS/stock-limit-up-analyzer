/**
 * FE-0 扩展 — Research Run Router（策略目录 + 运行就绪探测 + 闭环真实执行）。
 *
 * 定位：FE-4 运行工作台的**权威后端状态源 + 执行入口**。
 *
 * 三个能力：
 *   1. `catalog.list` —— 已注册研究策略元数据（来自 ResearchStrategyRegistry，
 *      启动装配 `registerBuiltInResearchStrategies` 幂等注册，无 DB 依赖）；
 *   2. `run.readiness` —— 运行就绪合成判定：认证 gate 快照（readCertifiedGate，
 *      与 FE-1 dataHealth 同一事实来源）+ 注册策略存在性 + **真实装配覆盖率探测**
 *      （`assessClosedLoopWiringCoverage`，取代早期硬编码 `executorBound=false`）；
 *   3. `run.loopRun` —— 闭环真实执行：按调用方显式声明的入参装配 14 阶段执行器，
 *      交给 `runClosedLoop` 跑一次，返回完整可审计轨迹（含链指纹）。
 *
 * 纪律（对齐 researchRouter.ts 与 dataHealthRouter.ts）：
 *   - **不冒充 READY**：`executorBound` 由覆盖率探测真实计算。任一段无执行器或入参
 *     不可得 → false，并在 `wiring` 中如实列出缺口阶段与原因；
 *   - **后端为权威**：dataset gate 摘要取自 dataHealth.readCertifiedGate 的认证快照
 *     （certify 脚本只读 TiDB 生成），本 router 不重算 gate、不读实况行数；
 *   - **证据缺失不伪造**：gate 文件缺失/解析失败 → evidenceAvailable=false +
 *     evidenceError，verdict=EVIDENCE_MISSING；
 *   - **执行不造假**：`loopRun` 只注入调用方声明的真实入参；拿不到的入参一律不注入，
 *     对应阶段由编排器如实 BLOCKED。**绝不**为凑绿而派生/推算入参。
 */

import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "./_core/trpc";
import {
  registerBuiltInResearchStrategies,
  researchStrategyRegistry,
} from "./research";
import { readCertifiedGate } from "./dataHealth";
import { runClosedLoop } from "./research/closedLoop/orchestrator";
import {
  CLOSED_LOOP_STAGE_IDS,
  type ClosedLoopBacktestSummary,
  type ClosedLoopLifecycleConfig,
  type ClosedLoopRunMetadata,
  type ClosedLoopSeedHandoff,
  type ClosedLoopStageId,
} from "./research/closedLoop/types";
import {
  assessClosedLoopWiringCoverage,
  createClosedLoopWiring,
  wiredClosedLoopStages,
  type ClosedLoopWiringInputs,
} from "./research/closedLoopWiring";
import type {
  LifecycleTransitionInput,
  StrategyLifecycleRecord,
} from "./research/lifecycle/types";
import type { ResearchParameterSet } from "./research/types";
import {
  closedLoopRunInputSchema,
  closedLoopRunResultSchema,
  researchCatalogItemSchema,
  researchRunReadinessSchema,
  type ClosedLoopWiringSummary,
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

// ---------------------------------------------------------------------------
// 装配覆盖率投影（readiness 与 loopRun 共用同一探测函数，避免两处口径漂移）
// ---------------------------------------------------------------------------

/**
 * 覆盖率 → 传输层摘要。
 *
 * `wiredStages` / `unwiredStages` 取**静态装配能力**（全 14 阶段，与本次请求无关）；
 * `coveredStages` / `uncoveredStages` 取**本次入参下的真实覆盖**。
 *
 * ⚠️ 边界声明：本摘要表达「本层执行器已装配 ∧ 闭包入参可得」，**不含编排器上游交接
 * 可得性**（`ClosedLoopStageInputById` 要求的同链前驱产出）。后者以 `loopRun` 返回的
 * `stages[].blocked` 为准——例如只给 `evaluationInput` 而不含 backtest 阶段时，
 * evaluation 执行器可注册，但若没有 backtestSummary 种子，编排器仍会阻塞。
 */
function toWiringSummary(
  inputs: ClosedLoopWiringInputs,
  requested?: readonly ClosedLoopStageId[],
): ClosedLoopWiringSummary {
  const coverage = assessClosedLoopWiringCoverage(inputs, requested);
  const wired = new Set<string>(wiredClosedLoopStages());
  const all: readonly string[] = CLOSED_LOOP_STAGE_IDS;
  return {
    requestedStages: [...coverage.requested],
    wiredStages: all.filter(stageId => wired.has(stageId)),
    unwiredStages: all.filter(stageId => !wired.has(stageId)),
    coveredStages: [...coverage.coveredStages],
    uncoveredStages: [...coverage.uncoveredStages],
    executorBound: coverage.executorBound,
  };
}

/** 就绪探测使用的「零入参」装配摘要（不臆造任何调用方入参）。 */
function probeWiringAtRest(): ClosedLoopWiringSummary {
  return toWiringSummary({});
}

/** 未就绪原因的诚实措辞（按探测结果生成，不写死「尚未实现」）。 */
function describeWiringGap(wiring: ClosedLoopWiringSummary): string {
  if (wiring.unwiredStages.length === 0) {
    return "真实执行链未完整绑定：被请求链存在入参不可得的阶段（见 wiring.uncoveredStages）。";
  }
  return (
    `真实执行链未完整绑定：14 阶段中 ${wiring.wiredStages.length} 阶段已装配真实执行器` +
    `（${wiring.wiredStages.join("、")}），${wiring.unwiredStages.length} 阶段尚无执行器` +
    `（${wiring.unwiredStages.join("、")}）；且已装配阶段仍需调用方注入真实入参` +
    `（researchDataset / experimentConfig / strategyContract / strategy13 / ` +
    `strategyDocumentInput / simulationConfig / evaluationInput / lifecycle）。`
  );
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
   * 运行就绪探测（只读）。
   * 未就绪原因按优先级 EVIDENCE_MISSING > DATASET_NOT_READY > STRATEGIES_MISSING
   * > EXECUTOR_NOT_BOUND 汇总到 reasons（可同时存在多条）。
   */
  readiness: publicProcedure
    .output(researchRunReadinessSchema)
    .query(async () => {
      const gate = await deriveDatasetGateSummary();
      const strategies = researchStrategyRegistry.list().map(toCatalogItem);
      // 真实探测：覆盖率由 closedLoopWiring 计算（不再硬编码）。
      const wiring = probeWiringAtRest();
      const executorBound = wiring.executorBound;

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
            ? `数据域认证未通过（G0 未全 PASS）：${gate.pendingChecks.join("、")} 尚为 PENDING，补齐数据域后重新 certify 即解锁 G0。`
            : "研究链未就绪（RESEARCH_READY=G4 未通过）：数据地基 G0 已认证，但 Industry PIT（G1）/ Research Dataset（G2）/ 生产引擎退出策略（G3）尚未完成，需按 MASTER_PRODUCT_ROADMAP PHASE 1~3 依次建设。"
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
        reasons.push(describeWiringGap(wiring));
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
        wiring,
      };
    }),

  /** 闭环真实执行（无状态、不落库；一次调用的完整可审计轨迹）。 */
  loopRun: publicProcedure
    .input(closedLoopRunInputSchema)
    .output(closedLoopRunResultSchema)
    .mutation(({ input }) => {
      const createdAt = input.createdAt ?? new Date().toISOString();
      const runId =
        input.runId ?? `clrun-${createdAt.replace(/[^0-9]/g, "").slice(0, 17)}`;

      // 归一为 canonical 保序子集（乱序/重复输入不报错；非法值已被 zod enum 挡下）
      const requested: readonly ClosedLoopStageId[] = CLOSED_LOOP_STAGE_IDS.filter(
        stageId => input.stageIds === undefined || input.stageIds.includes(stageId)
      );

      // backtestSummarySeed 的产生阶段（backtest）不得在链内，否则语义冲突
      if (input.backtestSummarySeed !== undefined && requested.includes("backtest")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "backtestSummarySeed 只适用于不含 backtest 阶段的链（交接种子要求其产生阶段不在 stageIds 内）。" +
            "请显式传入不含 backtest 的 stageIds，或去掉该种子让 backtest 阶段自行产生摘要。",
        });
      }

      // evaluation 的两项前置必须成对出现：
      //   ① 编排器要求消费 backtestSummary 交接 → 需 backtestSummarySeed（或链内有 backtest，但那条路要 dataset）；
      //   ② 评估结果必须绑定「曲线来自哪次真实回测」→ 指纹只能取 seed.fingerprint（不接受调用方另填，防伪绑定）。
      if (input.evaluationInput !== undefined && input.backtestSummarySeed === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "evaluationInput 必须与 backtestSummarySeed 一并提供：权益曲线必须声明来自哪次真实回测" +
            "（backtestFingerprint 取 seed.fingerprint），且 evaluation 阶段的执行还要求 backtestSummary 交接存在。",
        });
      }

      const lifecycleConfig: ClosedLoopLifecycleConfig | undefined =
        input.lifecycle === undefined
          ? undefined
          : {
              lifecycleRecord: input.lifecycle
                .lifecycleRecord as unknown as StrategyLifecycleRecord,
              transition: input.lifecycle
                .transition as unknown as LifecycleTransitionInput,
              ...(input.lifecycle.allowSyntheticEvidence !== undefined
                ? { allowSyntheticEvidence: input.lifecycle.allowSyntheticEvidence }
                : {}),
            };

      // 只注入调用方显式声明的真实入参（缺项 → 相应阶段不注册 → 编排器如实 BLOCKED）
      const wiringInputs: ClosedLoopWiringInputs = {
        ...(input.evaluationInput !== undefined && input.backtestSummarySeed !== undefined
          ? {
              evaluationInput: {
                ...input.evaluationInput,
                // 指纹来自调用方声明的真实回测种子，不由本层推算
                backtestFingerprint: input.backtestSummarySeed.fingerprint,
              },
            }
          : {}),
        ...(lifecycleConfig !== undefined ? { lifecycle: lifecycleConfig } : {}),
      };

      const seedHandoffs: ClosedLoopSeedHandoff[] = [];
      if (input.backtestSummarySeed !== undefined) {
        const seed = input.backtestSummarySeed;
        const handoff: ClosedLoopBacktestSummary = {
          kind: "backtestSummary",
          handoffVersion: 1,
          synthetic: seed.synthetic,
          source: {
            module: seed.module,
            moduleRunKind: "TRADE_SIMULATION_RUN",
            runId: null,
            fingerprint: seed.fingerprint,
          },
          datasetVersion: seed.datasetVersion,
          datasetGate: seed.datasetGate,
          dateRange: { ...seed.dateRange },
          initialCapital: seed.initialCapital,
          finalEquity: seed.finalEquity,
          decisionDayCount: seed.decisionDayCount,
          equityCurvePointCount: seed.equityCurvePointCount,
          tradeCount: seed.tradeCount,
        };
        seedHandoffs.push({ kind: "backtestSummary", handoff });
      }

      const metadata: ClosedLoopRunMetadata = {
        experimentId: input.experimentId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        dateRange: { ...input.dateRange },
        datasetVersion: input.datasetVersion ?? null,
        universeVersion: input.universeVersion ?? null,
        codeVersion: input.codeVersion ?? null,
        costModel: null,
        executionModel: input.executionModel ?? null,
        parameterSet: (input.parameterSet ?? {}) as unknown as Readonly<ResearchParameterSet>,
      };

      const { stageRunners } = createClosedLoopWiring(wiringInputs, { requested });

      const run = runClosedLoop({
        runId,
        createdAt,
        metadata,
        stageIds: requested,
        stageRunners,
        ...(seedHandoffs.length > 0 ? { seedHandoffs } : {}),
        ...(lifecycleConfig !== undefined ? { lifecycle: lifecycleConfig } : {}),
      });

      return {
        runId: run.runId,
        createdAt: run.createdAt,
        chainFingerprint: run.chainFingerprint,
        fingerprint: run.fingerprint,
        overall: { ...run.overall },
        runnerInjected: [...run.request.runnerInjected],
        stages: run.stages.map(stage => ({
          stageId: stage.stageId,
          state: stage.state,
          outputKind: stage.producedHandoffKind,
          outputHandoffFingerprint: stage.outputHandoffFingerprint,
          output: stage.output ?? null,
          blocked:
            stage.blocked === null
              ? null
              : {
                  reasonCode: stage.blocked.reasonCode,
                  detail: stage.blocked.detail,
                  upstreamStageId: stage.blocked.upstreamStageId,
                  errorCode: stage.blocked.errorCode,
                  errorMessage: stage.blocked.errorMessage,
                },
        })),
        blockedSummary: run.blockedSummary.map(item => ({
          stageId: item.stageId,
          reasonCode: item.reasonCode,
          detail: item.detail,
          upstreamStageId: item.upstreamStageId,
          errorCode: item.errorCode,
          errorMessage: item.errorMessage,
        })),
        wiring: toWiringSummary(wiringInputs, requested),
      };
    }),
});

export type ResearchRunRouter = typeof researchRunRouter;
