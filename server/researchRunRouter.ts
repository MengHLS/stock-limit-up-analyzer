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
import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
// RESEARCH-EXPERIMENT-003 — 研究层 barrel 已删除；本 router 只用到两件东西，
// 改为显式按文件导入（barrel 会让整个旧 Research 目录进入可达集）。
import { registerBuiltInResearchStrategies } from "./research/adapter";
import { researchStrategyRegistry } from "./research/registry";
import { readCertifiedGate } from "./dataHealth";
// BD-24 — 留档重试的「瞬时 vs 语义」判定**复用只读路径的同一份特征表**，
// 不另立第二套「什么算瞬时」（两份口径必然漂移）。此处只用判定函数，不用 `withReadRetry`
// ——那个工具按其头注释**只给读路径**用。
import { isTransientReadError } from "./readRetry";
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
  closedLoopBacktestRunDetailSchema,
  closedLoopBacktestRunListInputSchema,
  closedLoopBacktestRunRecordSchema,
  closedLoopRunInputSchema,
  closedLoopRunResultSchema,
  researchCatalogItemSchema,
  researchChainHealthSchema,
  researchRunReadinessSchema,
  securityLabelsInputSchema,
  securityLabelsOutputSchema,
  type ClosedLoopRunResult,
  type ClosedLoopWiringSummary,
  type ResearchCatalogItem,
  type ResearchDatasetGateSummary,
  type ResearchRunReadinessVerdict,
} from "../shared/researchContracts";
import type { ResearchStrategyDefinition } from "./research/strategyContract";
import { StrategyService } from "./research/strategyPersistence/service";
import { DbStrategyRepository } from "./research/strategyPersistence/db";
import {
  assembleRunWorkbenchInputs,
  LoopRunAssemblyError,
  type LoopRunAssemblySummary,
} from "./runWorkbenchAssembly";
import type { StrategyDocument } from "./research/strategySchema/types";
import { StrategyRecipeRuntimeError } from "./research/recipeErrors";
import {
  getClosedLoopBacktestRun,
  listClosedLoopBacktestRuns,
  saveClosedLoopBacktestRun,
} from "./closedLoopBacktestRun/repository";
import { loadSecurityLabels, withPersistedSecurityLabels } from "./closedLoopBacktestRun/securityLabels";
// STRATEGY-ARCH-002 — 策略运行留档（零 schema 变更：进既有 resultJson）。
import {
  buildStrategyRunRecord,
  runtimeConfigSnapshot,
} from "./strategyCore/production";
// BACKTEST-002（B-03/B-04）— 回测结果有界载荷 + canonical 指标 + 执行政策版本。
import {
  DEFAULT_BACKTEST_SAMPLE_LIMIT,
  buildBacktestResult,
  buildBacktestRunPayload,
} from "./backtest/backtestResult";
import {
  BACKTEST_EXECUTION_POLICY_VERSION,
  DEFAULT_BACKTEST_EXECUTION_POLICY,
  describeExecutionPolicy,
} from "./backtest/context";
import type { AssembledStrategySide } from "./runWorkbenchAssembly/assemble";
// PARAMETER-001-PRE — 性能剖析（默认关闭；`PARAM_PROFILE=1` 才生效）。
import { perfBegin, perfCount, perfEnd, perfRun, perfRunAsync } from "./observability";

// 幂等启动装配：把内置研究策略注册进单例注册中心（已注册则跳过）。
registerBuiltInResearchStrategies(researchStrategyRegistry);

/**
 * 策略持久化读取服务（**只读**用途：`useRealData=true` 时按 `strategyId@version` 取
 * 真实策略文档）。与 `researchRouter.ts` 各自 new 一份 `StrategyService` —— 该服务是
 * 无状态编排（依赖注入 Repository），重复实例化只多一个轻对象，换来的是两个 router
 * 之间零 import 耦合。
 */
const runWorkbenchStrategyService = new StrategyService(new DbStrategyRepository(), {
  codeVersion: "unknown",
});

/**
 * 从策略文档取已绑定的 Dataset Registry 坐标（`dataset_version.id`）。
 *
 * 唯一坐标纪律（`PROJECT_RULES`）：`datasetVersionId` 是 Dataset 的**唯一**坐标，
 * 故优先取 Canonical `definition.datasets` 中 `role=PRIMARY` 那一条；无 definition 的
 * 历史 / UI 文档退到 doc 级镜像 `document.datasetVersionId`（与
 * `datasetBindingValidation.collectStrategyDatasetBindingRequests` 同口径）。
 *
 * 拿不到 → 返回 undefined（调用方据此走「从零重建」并在摘要里如实说明）。
 */
function primaryDatasetVersionIdOf(document: StrategyDocument): number | undefined {
  const datasets = document.definition?.datasets;
  if (datasets !== undefined && datasets.length > 0) {
    const primary = datasets.find(d => d.role === "PRIMARY") ?? datasets[0];
    if (primary !== undefined && primary.datasetVersionId !== undefined && primary.datasetVersionId !== null) {
      return primary.datasetVersionId;
    }
  }
  const mirrored = document.datasetVersionId;
  return mirrored !== undefined && mirrored !== null ? mirrored : undefined;
}

/** 装配失败 → TRPCError（稳定错误码进 message 前缀，前端可直接展示）。 */
function toAssemblyTrpcError(error: unknown): TRPCError {  if (error instanceof LoopRunAssemblyError || error instanceof StrategyRecipeRuntimeError) {
    return new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `[${error.code}] ${error.message}`,
    });
  }
  if (error instanceof Error) {
    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(error) });
}

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

/**
 * CLOSED-LOOP-BACKTEST-PERSIST-001 — 把一次闭环运行结果留档（**best-effort，绝不阻断回测**）。
 *
 * 为什么吞掉错误：这是一次昂贵且真实的执行（跨境库取数 + 逐日撮合，分钟级），
 * 结果已经算出来了 —— **不能因为写一张留档表失败就把结果丢掉**。故此处只记录日志、不抛。
 * 代价是「留档失败 ⇒ 历史列表里少这一条」，这是**如实可见**的降级（不是假装存了）；
 * 另外 `runId` 唯一键保证重试幂等收敛，不会因重试堆出重复记录。
 *
 * 🔴 BACKTEST-002 收尾实测：**只尝试一次是不够的**。
 *    一次真实运行（`cand-360004@1.0.0`）计算阶段约 **593~616 s**，其间完全不碰 DB；
 *    计算结束时连接池里那条连接已被链路（TiDB Cloud / 中间 LB）**静默重置**，于是
 *    **唯一的一次 insert 必然失败** ⇒ 长运行**每次都静默丢掉留档**（历史列表恒缺这条）。
 *    ⇒ 第一版修法 = **有界重试**（首次失败后换连接再试），语义仍是 best-effort（不抛、不阻断回测）。
 *    ⚠️ 不要把它改成「失败即抛」：那会把「历史列表少一条」升级成「回测结果丢失」。
 *    ⚠️「不碰 DB」≠「连接没被借出」：池的回收器**只处理自由队列**，被借出的连接它看不见
 *    ⇒「借出跨越掐断窗口、之后才还回池」的连接既不被回收、时间戳又被 `release()` 刷新成新的
 *    ⇒ 这一类**只能靠有界重试清掉**（源码级边界见 `server/db.ts#resolveIdleTimeoutMs` 注释）。
 *
 * 🔴 BD-24（2026-09-21，用户报障「跑完 first-board-pullback 在『回测历史』里看不到」）：
 *    第一版「重试 3 次」**不够**，且上面那句「重试即成功」**只在「池内死连接数 < 尝试次数」时成立**
 *    —— 本轮进程内复现（`docs/evidence/_probe_fbp_looprun_repro2.out.json`）实测：9.81 分钟的长算后，
 *    **3 次 INSERT + 紧随其后的列表 SELECT 全部 `read ECONNRESET`（errno −4077）** ⇒ 池里至少 **4 条**
 *    连接已死，3 次尝试烧完就放弃（这正是「页面有结果、历史无此条」的直接原因）。
 *    根因**不在本函数**：`server/db.ts` 的池阈值（`idleTimeout` = 10 分钟）**大于**实测链路空闲窗口
 *    （**(240, 330] s**，见 `_probe_db_keepalive_ab.mts`）⇒ 长算期间**一条空闲连接都不会被回收**，
 *    写库时取到的全是已被掐死、却因保活未生效而「看似可用」的半开 socket（要等 ~19.28 s TCP 重传超时）。
 *    已按实测把回收阈值压到 **3 分钟 < 240s** ⇒ 写库边界的陈旧连接由**至少 4 条**降到 **1 条**。
 *    ⚠️ 但压阈值**清不到 0**：回收器只处理自由队列，且只看 `release()` 时刷新的 `lastActiveTime`
 *    ⇒ 「被借出跨越掐断窗口、之后才还回池」的连接对它**永久不可见**（源码级边界见
 *    `db.ts#resolveIdleTimeoutMs` 注释）⇒ 修后真跑的第 1 次尝试**仍然**撞死连接、白等 **19.28 s**，
 *    靠第 2 次换到新连接（**3.86 s**）才成功（`_probe_fbp_looprun_repro2.out.json`）。
 *    ⇒ **所以本函数的重试预算是承重项，不是兜底。**
 *    ⚠️ 试过的**错解**（别再试）：把保活初始延迟设成 30s（想让死连接被快速检出）—— 真跑一次证明它是
 *    **引雷**：`EPIPE`（`writeAfterFIN`）触发 mysql2 `_notifyError` **二次** `emit('error')`，而
 *    `pool_connection.js` 只用 `once('error')` ⇒ **unhandled 'error' ⇒ 进程退出**
 *    （`_probe_fbp_looprun_repro2.keepalive-trial.out.txt`）。
 *    本函数随之做两处**收紧**：⒜ 尝试次数按「实测死连接下界 4」派生（见下）；
 *    ⒝ **非瞬时错误不再重试**（SQL / 表结构这类错误重试不可能成功，白等会拖住整个响应）。
 */
const CLOSED_LOOP_PERSIST_RETRY_DELAY_MS = 300;

/**
 * 留档最大尝试次数（含首次）。**派生**而非拍脑袋：
 *
 *   - 连接级瞬时错误会让 mysql2 把**那条连接**移出池
 *     （`node_modules/mysql2/lib/base/pool_connection.js` 的 `error` 处理器 `_removeConnection`）
 *     ⇒ 每次失败**恰好**消耗一条死连接，需要的尝试次数 = 1 + 池内死连接数；
 *   - 实测下界（`BD-24` 复现）：长算结束后池里**至少 4 条**已死 ⇒ 上轮的 **3 次**必然不够；
 *   - 取 **6** = 实测下界 4 之上留 **2** 次余量。有界性：单次失败实测 **≈19.28 s**
 *     （socket 半开时要等 TCP 重传超时；`prefix-BD24` 证据里连续两次间隔 19.585 / 19.875 s
 *     减去 0.3 / 0.6 s 退避 ⇒ 19.28 s）⇒ 全 6 次都失败时最坏 ≈ **1.7 分钟**
 *     （5 × 19.28 + 退避 4.5 s），且只在链路真出问题时才走到尾。
 *
 * ⚠️ **本项是承重项，不是兜底**（`BD-24` 修后真跑的实测结论）：`idleTimeout` 只能把写库边界的陈旧连接
 *    从「至少 4 条」压到「1 条」，**压不到 0**（它看不见「被借出跨越掐断窗口」的连接）⇒ 余下那条必须靠
 *    重试清掉。也**不是**保活：A/B 实测证明保活挡不住链路掐断，把它调成有限值还会引雷（见上两段）。
 */
const CLOSED_LOOP_PERSIST_ATTEMPTS = 6;

/** 留档写入的依赖注入点：默认走真实实现；单测据此注入**可证伪**的失败序列。 */
export interface ClosedLoopPersistDeps {
  /** 覆盖真正的写入函数（默认 `saveClosedLoopBacktestRun`）。 */
  save?: (input: Parameters<typeof saveClosedLoopBacktestRun>[0]) => Promise<number>;
  /** 覆盖尝试次数（仅测试用；默认 `CLOSED_LOOP_PERSIST_ATTEMPTS`）。 */
  attempts?: number;
  /** 覆盖退避基数（仅测试用；`0` = 不等待）。 */
  retryDelayMs?: number;
}

export interface ClosedLoopPersistResult {
  readonly persisted: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export async function persistClosedLoopBacktestRun(
  options: {
    experimentId: string;
    strategyId: string;
    strategyVersion: string;
    startDate: string;
    endDate: string;
    result: ClosedLoopRunResult;
  },
  deps: ClosedLoopPersistDeps = {},
): Promise<ClosedLoopPersistResult> {
  const save = deps.save ?? saveClosedLoopBacktestRun;
  const maxAttempts = Math.max(1, Math.trunc(deps.attempts ?? CLOSED_LOOP_PERSIST_ATTEMPTS));
  const retryDelayMs = Math.max(0, deps.retryDelayMs ?? CLOSED_LOOP_PERSIST_RETRY_DELAY_MS);
  const saveInput: Parameters<typeof saveClosedLoopBacktestRun>[0] = {
    experimentId: options.experimentId,
    strategyId: options.strategyId,
    strategyVersion: options.strategyVersion,
    startDate: options.startDate,
    endDate: options.endDate,
    result: options.result,
  };

  let lastDetail = "（未捕获到错误详情）";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await save(saveInput);
      if (attempt > 1) {
        console.warn(
          `[loopRun] 闭环回测结果留档在第 ${attempt} 次尝试成功（前 ${attempt - 1} 次是长算后连接被重置，` +
            `属已知现象；BD-24）。`,
        );
      }
      return { persisted: true, errorCode: null, errorMessage: null };
    } catch (error) {
      lastDetail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

      // 非瞬时错误（SQL 非法 / 表结构不符 / 数据越界…）重试**不可能**成功 ⇒ 立即放弃，
      // 不白等 N × 19.6s。瞬时判定**复用** `readRetry.ts` 的同一份特征表，避免两套口径漂移。
      if (!isTransientReadError(error)) {
        console.warn(
          `[loopRun] 闭环回测结果留档失败（非瞬时错误，不重试；不影响本次运行结果，历史列表将缺此条）` +
            `（runId=${options.result.runId}）：${lastDetail}`,
        );
        return { persisted: false, errorCode: "CLOSED_LOOP_PERSIST_FAILED", errorMessage: lastDetail };
      }

      if (attempt < maxAttempts) {
        const nextDelayMs = retryDelayMs * attempt;
        console.warn(
          `[loopRun] 留档第 ${attempt}/${maxAttempts} 次尝试失败（连接级瞬时错误），${nextDelayMs}ms 后重试：${lastDetail}`,
        );
        await new Promise<void>((resolve) => {
          setTimeout(resolve, nextDelayMs);
        });
      }
    }
  }
  console.warn(
    `[loopRun] 闭环回测结果留档失败（已尝试 ${maxAttempts} 次；不影响本次运行结果，历史列表将缺此条）` +
      `（runId=${options.result.runId}）：${lastDetail}`,
  );
  return { persisted: false, errorCode: "CLOSED_LOOP_PERSIST_FAILED", errorMessage: lastDetail };
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
   * CLOSED-LOOP-BACKTEST-PERSIST-001 — 历史留档列表（只读）。
   *
   * 闭环 `loopRun` 每次执行都会**自动留档**一行；这里按留档时间倒序返回**摘要级**列表，
   * **不含**完整结果（单条可达数百 KB，列表页搬运它纯属浪费）。要看完整轨迹用 `getBacktest`。
   *
   * 🔴 与 legacy `sentiment.listBacktestRuns` 不是同一套：那条读的是龙头候选回测
   * （`backtest_runs` 表），本条读闭环运行留档（`closed_loop_backtest_run` 表）。
   */
  listBacktests: publicProcedure
    .input(closedLoopBacktestRunListInputSchema)
    .output(closedLoopBacktestRunRecordSchema.array())
    .query(async ({ input }) => {
      return await listClosedLoopBacktestRuns({
        ...(input?.limit !== undefined ? { limit: input.limit } : {}),
        ...(input?.strategyId !== undefined ? { strategyId: input.strategyId } : {}),
      });
    }),

  /**
   * 单条留档详情（含完整运行结果）。不存在 → `null`（不抛错，前端据此显示「记录不存在」）。
   *
   * ⚠️ 留档行存在但 `resultJson` 损坏时会**抛错**（不静默降级成「没有结果」）——
   * 「记录坏了」与「本次没留结果」是两件不同的事。
   */
  getBacktest: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .output(closedLoopBacktestRunDetailSchema.nullable())
    .query(async ({ input }) => {
      return await getClosedLoopBacktestRun(input.id);
    }),

  /**
   * 成交明细的「证券名称 + 代码」字典（只读）。
   *
   * 为什么单独开一个端点：闭环结果里 `trades[].securityId` 是 `sec_<uuid>`，把它翻成
   * 「海鸥股份 603269.SH」要跨两张表（identifier history → limit_up_records）。放在
   * 这里而不是塞进 `loopRun` / `getBacktest` 的返回体，是为了：
   *   ① 不改 `ClosedLoopRunResult` 契约（回测产物是**算出来的**，名称是**贴上去的**）；
   *   ② 运行工作台与「回测历史」详情**共用同一个查询** ⇒ 零口径漂移。
   *
   * 🔴 取不到名称时 `name` 为 `null`（名称源只收录涨停过的股票，回测 universe 是全市场）
   * —— 如实返回空洞，前端显示「—」。
   */
  securityLabels: publicProcedure
    .input(securityLabelsInputSchema)
    .output(securityLabelsOutputSchema)
    .query(async ({ input }) => {
      const labels = await loadSecurityLabels(input.securityIds);
      const byId: Record<string, (typeof labels)[number]> = {};
      for (const label of labels) byId[label.securityId] = label;
      return byId;
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

  /**
   * 闭环真实执行（一次调用的完整可审计轨迹）。
   *
   * 留档（2026-09-14 起，CLOSED-LOOP-BACKTEST-PERSIST-001）：每次执行后**自动留档**一行到
   * `closed_loop_backtest_run`，供「回测历史」页回看（`listBacktests` / `getBacktest`）。
   * 留档是**旁路**：失败不影响本次运行的返回结果，也不改动任何编排语义。
   */
  loopRun: publicProcedure
    .input(closedLoopRunInputSchema)
    .output(closedLoopRunResultSchema)
    .mutation(async ({ input }) => {
      const __runTotal = perfBegin("run.loopRun_total");
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

      // ------------------------------------------------------------------
      // 运行工作台「真实跑通」（useRealData=true）
      //
      // 与上方「只透传」是**互斥的两条路**：本分支由服务端真实构建数据集 + 真实读策略
      // 文档 + 真实装配配方，因此 data / research / backtest / evaluation / regime 五阶段
      // 可以真的执行。任何一环失败 → 抛 PRECONDITION_FAILED（附稳定错误码），
      // **绝不**降级成「用占位数据跑一遍」。
      // ------------------------------------------------------------------
      let assemblySummary: LoopRunAssemblySummary | null = null;
      // STRATEGY-ARCH-002 — 策略侧产物（Core 决策源 / 版本 / 事件判定器）留到跑完后组 Run Record。
      let assembledSide: AssembledStrategySide | null = null;
      if (input.useRealData === true) {
        let assembled;
        try {
          const versionRecord = await runWorkbenchStrategyService.loadVersion(
            input.strategyId,
            input.strategyVersion,
          );
          assembled = await assembleRunWorkbenchInputs({
            strategyId: input.strategyId,
            strategyVersion: input.strategyVersion,
            startDate: input.dateRange.startDate,
            endDate: input.dateRange.endDate,
            createdAt,
            codeVersion: input.codeVersion ?? "unknown",
            strategyDocument: versionRecord.strategy,
            // 已绑定的 Dataset Registry 坐标（PRIMARY）——有就用它直读已落库 ds_* 数据集，
            // 而不是从零重算。事实（含回落原因）由装配层写进 assembly.datasetSource*。
            ...(primaryDatasetVersionIdOf(versionRecord.strategy) !== undefined
              ? { datasetVersionId: primaryDatasetVersionIdOf(versionRecord.strategy)! }
              : {}),
            ...(input.recipeId !== undefined ? { recipeId: input.recipeId } : {}),
            ...(input.datasetGuards?.dataReady !== undefined
              ? { dataReady: input.datasetGuards.dataReady }
              : {}),
            ...(input.datasetGuards?.maxTradingDays !== undefined
              ? { maxTradingDays: input.datasetGuards.maxTradingDays }
              : {}),
            ...(input.datasetGuards?.maxSecuritiesPerDay !== undefined
              ? { maxSecuritiesPerDay: input.datasetGuards.maxSecuritiesPerDay }
              : {}),
          });
        } catch (error) {
          throw toAssemblyTrpcError(error);
        }
        // 装配成功：把真实入参合并进 wiringInputs（覆盖同名的空位）
        Object.assign(wiringInputs, assembled.inputs);
        assemblySummary = assembled.assembly;
        assembledSide = assembled.side;
      }

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

      // BACKTEST-002（B-03）— 🔴 此前这里把 `artifacts` 丢掉了 ⇒ 完整的
      // `TradeSimulationRun`（含 equityCurve / trades）跑完即弃，无法落库。
      // 捕获它即打通 artifact propagation：**不重算、不复制引擎**，只用同一个产物。
      const { stageRunners, artifacts } = createClosedLoopWiring(wiringInputs, { requested });

      const run = perfRun("run.stage_orchestration", () =>
        runClosedLoop({
          runId,
          createdAt,
          metadata,
          stageIds: requested,
          stageRunners,
          ...(seedHandoffs.length > 0 ? { seedHandoffs } : {}),
          ...(lifecycleConfig !== undefined ? { lifecycle: lifecycleConfig } : {}),
        }),
      );

      let resultOut: ClosedLoopRunResult = {
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
        assembly:
          assemblySummary === null
            ? null
            : {
                datasetVersion: assemblySummary.datasetVersion,
                datasetGate: assemblySummary.datasetGate,
                datasetRowCount: assemblySummary.datasetRowCount,
                datasetSecurityCount: assemblySummary.datasetSecretCount,
                datasetSource: assemblySummary.datasetSource,
                datasetSourceNote: assemblySummary.datasetSourceNote,
                datasetVersionId: assemblySummary.datasetVersionId,
                dateRange: { ...assemblySummary.dateRange },
                strategyId: assemblySummary.strategyId,
                strategyVersion: assemblySummary.strategyVersion,
                recipeId: assemblySummary.recipeId,
                recipeSource: assemblySummary.recipeSource,
                recipeFeatureIds: [...assemblySummary.recipeFeatureIds],
                selectionSummary: assemblySummary.selectionSummary,
                strategyDecisionEngine: assemblySummary.strategyDecisionEngine,
                strategyDecisionEngineNote: assemblySummary.strategyDecisionEngineNote,
                simulation: {
                  initialCapital: assemblySummary.simulation.initialCapital,
                  maxPositions: assemblySummary.simulation.maxPositions,
                  maxDailyBuys: assemblySummary.simulation.maxDailyBuys,
                  executionModel: assemblySummary.simulation.executionModel,
                  costModel: { ...assemblySummary.simulation.costModel },
                },
              },
      };

      // ------------------------------------------------------------------
      // STRATEGY-ARCH-002 — Strategy Run Record（**每次运行必留**，零 schema 变更）
      //
      // 落点 = 上面这个 `result` 对象 ⇒ 由既有 `persistClosedLoopBacktestRun` 写进
      // `closed_loop_backtest_run.resultJson`。只有真的走了 Core 判定（`strategy-core`）
      // 才留档 —— 回落 legacy 配方时留一份「其实是 legacy 跑的」记录只会误导。
      // ------------------------------------------------------------------
      if (assembledSide !== null && assembledSide.strategyRunContext.engine === "strategy-core") {
        const context = assembledSide.strategyRunContext;
        const source = context.coreDecisionSource;
        const coreVersion = context.coreVersion;
        if (source !== null && coreVersion !== null && coreVersion.ok) {
          const codeVersion = input.codeVersion ?? "unknown";
          const digest = source.digest();
          const record = buildStrategyRunRecord({
            runId: run.runId,
            version: coreVersion.version,
            parameterSet: assembledSide.parameterSet as unknown as Record<string, never>,
            resolvedParameterSet: source.resolvedParameterSet().values,
            codeVersion,
            universe: { universeId: context.universeId, members: null },
            datasetReference: {
              datasetVersionId: assemblySummary?.datasetVersionId ?? null,
              datasetLabel: assemblySummary?.datasetVersion ?? null,
              datasetSource: (assemblySummary?.datasetSource ?? "rebuild") as
                | "registry"
                | "rebuild"
                | "injected",
              datasetContentFingerprint: assemblySummary?.datasetVersion ?? null,
            },
            seed: null,
            runtimeConfig: runtimeConfigSnapshot({
              startDate: input.dateRange.startDate,
              point: context.point,
              maxRelativeDayObserved: digest.maxRelativeDayObserved,
              horizonRelativeDay: digest.maxRelativeDayObserved,
            }),
            createdAt,
            digest,
            anchorPolicy: context.anchorPolicy,
            notes: [
              context.note,
              ...source.notes,
              ...coreVersion.notes,
              "codeVersion=" + codeVersion + " 由调用方注入（本服务端不读 git / package.json）",
            ],
            unmappedExitRuleIds: coreVersion.adaptation.unmappedExitRuleIds,
          });
          resultOut.strategyRun = record;
        }
      }

      // ------------------------------------------------------------------
      // BACKTEST-002（B-03）— BacktestRunResult → resultJson.backtest（有界载荷）
      // ------------------------------------------------------------------
      const backtestRun = artifacts.tradeSimulationRun;
      if (backtestRun !== undefined) {
        const initialCapital = assemblySummary?.simulation.initialCapital ?? null;
        if (initialCapital !== null) {
          const __metrics = perfBegin("metrics.build_backtest_result");
          const result = buildBacktestResult({
            runId: run.runId,
            strategyVersionId: input.strategyId + "@" + input.strategyVersion,
            datasetVersionId: assemblySummary?.datasetVersionId ?? null,
            parameterSet: (input.parameterSet ?? {}) as Readonly<Record<string, unknown>>,
            initialCapital,
            equityCurve: backtestRun.equityCurve,
            tradeLedger: backtestRun.trades,
            notes: [
              "权益曲线 / 成交台账来自同链 backtest 阶段的真实产物（artifacts.tradeSimulationRun）",
              "明细**不全量入库**：见 equitySamples / tradeSamples（有界）与 equityDigest / tradeDigest（全量指纹）",
            ],
          });
          perfEnd(__metrics);
          const __serialize = perfBegin("persistence.payload_serialization");
          const payload = buildBacktestRunPayload({ result });
          resultOut.backtest = {
            canonicalMetrics: payload.canonicalMetrics,
            summary: payload.summary,
            equitySamples: [...payload.equitySamples],
            tradeSamples: [...payload.tradeSamples],
            truncated: payload.truncated,
            equityDigest: payload.equityDigest,
            tradeDigest: payload.tradeDigest,
            notes: [...payload.notes],
            executionMetadata: {
              executionPolicyVersion: BACKTEST_EXECUTION_POLICY_VERSION,
              engineVersion: "strategy-core/1.0.0",
              codeVersion: input.codeVersion ?? "unknown",
              initialCapital,
              sampleLimit: DEFAULT_BACKTEST_SAMPLE_LIMIT,
              notes: [...describeExecutionPolicy(DEFAULT_BACKTEST_EXECUTION_POLICY)],
            },
          };
          perfEnd(__serialize);
        }
      }

      // CLOSED-LOOP-BACKTEST-PERSIST-001 — 每次运行都留档，供「回测历史」页回看。
      // best-effort：留档失败不抛（详见 persistClosedLoopBacktestRun 的说明）。
      resultOut = await withPersistedSecurityLabels(resultOut);
      const persistence = await perfRunAsync("persistence.db_write", () =>
        persistClosedLoopBacktestRun({
          experimentId: input.experimentId,
          strategyId: input.strategyId,
          strategyVersion: input.strategyVersion,
          startDate: input.dateRange.startDate,
          endDate: input.dateRange.endDate,
          result: resultOut,
        }),
      );
      resultOut.persistence = persistence;

      perfCount("run.resultJson_bytes", JSON.stringify(resultOut).length);
      perfEnd(__runTotal);
      return resultOut;
    }),
});

export type ResearchRunRouter = typeof researchRunRouter;
