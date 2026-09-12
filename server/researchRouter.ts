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
 *
 * STEP STRATEGY-004 增补：
 * - 写操作（create / save / delete / createVersion / **cloneVersion** / **setVersionStatus**）
 *   统一 `adminProcedure`，与 Dataset Registry / Research Engine 写端点权限口径一致；
 * - 只读（load / list / listVersions / loadVersion / **loadBundle** / **getVersionBundle** /
 *   **validateVersion**）保持 `publicProcedure`，不扩大也不缩小既有读取能力。
 */

import { publicProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { readFileSync } from "node:fs";
import {
  strategyDocumentSchema,
  strategyLifecycleRecordSchema,
  lifecycleTransitionInputSchema,
  metricsEvaluateInputSchema,
  strategySaveInputSchema,
  strategyIdInputSchema,
  strategyLoadVersionInputSchema,
  strategyCreateVersionInputSchema,
  strategyCloneVersionInputSchema,
  strategySetVersionStatusInputSchema,
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
import { DbStrategyRepository } from "./research/strategyPersistence/db";
import { StrategyService } from "./research/strategyPersistence/service";
import { strategyCandidateRouter } from "./research/strategyCandidate/router";
import { composeCodeVersion } from "./research/experimentLineage/codeVersion";
import { evaluatePerformance } from "./research/performanceMetrics";
import { evaluateRiskAdjustedMetrics } from "./research/riskAdjustedMetrics";
import { evaluateTradeQualityMetrics } from "./research/tradeQualityMetrics";
import type { EquityPoint, Trade } from "./backtest/types";

/**
 * STEP STRATEGY-002 — codeVersion 注入（composeCodeVersion 产物）。
 * 入口读 package.json（git 短哈希不可得时按 +gunknown.dirty 保守标记），
 * 失败响亮回退 CODE_VERSION_UNKNOWN。模块加载时计算一次，避免每次请求读文件。
 */
function resolveCodeVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return composeCodeVersion({
      packageVersion: typeof pkg.version === "string" ? pkg.version : null,
      git: { commitShortHash: null, dirty: null },
    });
  } catch {
    return "unknown";
  }
}

const CODE_VERSION = resolveCodeVersion();

/** 策略持久化编排服务（真实 DB 落库；fingerprint/幂等/不可变语义见 strategyPersistence）。 */
const strategyService = new StrategyService(new DbStrategyRepository(), { codeVersion: CODE_VERSION });

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
  /**
   * RESEARCH-006.2 — Research → Strategy 候选桥（`research.strategyCandidate.*`）。
   *
   * 与既有 `research.strategy.*`（策略本体 / 版本 / 生命周期，STRATEGY-002~004）**并列**，
   * 不是它的替代：`strategyCandidate` 管「研究发现的取舍登记」，`strategy` 管「已转正的策略本体」。
   * ⚠️ 本 STEP **不提供** `promote`：候选永远无法自动变成策略（006.3 才建那条路）。
   */
  strategyCandidate: strategyCandidateRouter,

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

    // ---- STEP STRATEGY-002 · CRUD（持久化 + 版本化）----
    // STEP STRATEGY-004：写操作统一 `adminProcedure`（与 Dataset Registry / Research Engine 写端点口径一致）；
    // 只读操作保持 publicProcedure（不扩大权限，也不缩小既有读取能力）。

    /** 创建全新策略（strategyId 必须不存在）。 */
    create: adminProcedure
      .input(strategySaveInputSchema)
      .mutation(({ input }) => strategyService.create({ document: input.document })),

    /** 保存策略版本（幂等；strategyId 不存在时等价 create）。 */
    save: adminProcedure
      .input(strategySaveInputSchema)
      .mutation(({ input }) => strategyService.save({ document: input.document })),

    /** 加载策略最新版本本体（含指纹复核）。 */
    load: publicProcedure
      .input(strategyIdInputSchema)
      .query(({ input }) => strategyService.load(input.strategyId)),

    /** 列出全部策略摘要。 */
    list: publicProcedure.query(() => strategyService.list()),

    /** 删除策略（级联删版本）。 */
    delete: adminProcedure
      .input(strategyIdInputSchema)
      .mutation(({ input }) => strategyService.delete(input.strategyId)),

    /** 基于最新版本创建新版本（复用 cloneStrategyDocument + bump 语义闸门）。 */
    createVersion: adminProcedure
      .input(strategyCreateVersionInputSchema)
      .mutation(({ input }) =>
        strategyService.createVersion({
          strategyId: input.strategyId,
          document: input.document,
          ...(input.bump ? { bump: input.bump } : {}),
        }),
      ),

    /** 加载指定版本（§17 九项追溯记录，含指纹复核）。 */
    loadVersion: publicProcedure
      .input(strategyLoadVersionInputSchema)
      .query(({ input }) => strategyService.loadVersion(input.strategyId, input.version)),

    /** 列出某策略的全部版本摘要。 */
    listVersions: publicProcedure
      .input(strategyIdInputSchema)
      .query(({ input }) => strategyService.listVersions(input.strategyId)),

    // ---- STEP STRATEGY-004 · 暴露 STRATEGY-003 已完成但未暴露的 Domain Service 能力 ----
    // 以下 4 个能力在 STRATEGY-003 已实现于 StrategyService / Repository，本 STEP 只做「传输 → 领域」
    // 投递（不重新实现任何领域逻辑）。写操作为 adminProcedure；只读保持 publicProcedure。

    /**
     * 一次取全一个版本（Canonical 本体 + §17 追溯 + 5 类投影）。
     *
     * 读操作（不改变任何状态）→ publicProcedure，与 `loadVersion` 同权限口径。
     */
    loadBundle: publicProcedure
      .input(strategyLoadVersionInputSchema)
      .query(({ input }) => strategyService.loadBundle(input.strategyId, input.version)),

    /**
     * `getVersionBundle` —— `loadBundle` 的**同实现别名**。
     *
     * 保留该名称是为了对齐 Repository 契约（`StrategyRepository.getVersionBundle`）的词汇；
     * 两者调用同一 Service 方法，不存在第二套读取逻辑（避免出现两份口径）。
     */
    getVersionBundle: publicProcedure
      .input(strategyLoadVersionInputSchema)
      .query(({ input }) => strategyService.loadBundle(input.strategyId, input.version)),

    /**
     * 读库校验指定版本：文档全量校验（含 definition / Look-Ahead）+ 投影漂移检测。
     * 只读（不修复、不写入）；漂移以明细返回，由调用方决定是否失败。
     */
    validateVersion: publicProcedure
      .input(strategyLoadVersionInputSchema)
      .query(({ input }) => strategyService.validateVersion(input.strategyId, input.version)),

    /**
     * 按**指定源版本** clone 出新版本（源版本可为任意历史版本；`parentVersionId` 指向源版本行）。
     * 幂等三态：inserted / idempotent-skip / conflict（**绝不覆盖既有版本**）。写操作 → admin。
     */
    cloneVersion: adminProcedure
      .input(strategyCloneVersionInputSchema)
      .mutation(({ input }) =>
        strategyService.cloneVersion({
          strategyId: input.strategyId,
          fromVersion: input.fromVersion,
          ...(input.targetVersion === undefined ? {} : { targetVersion: input.targetVersion }),
          ...(input.bump === undefined ? {} : { bump: input.bump }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.status === undefined ? {} : { status: input.status }),
        }),
      ),

    /**
     * 版本生命周期状态迁移（唯一允许的 UPDATE；内容仍不可变）。写操作 → admin。
     * 状态白名单由后端 `isStrategyLifecycleStatus` 权威判定（传输层只做字面量约束）。
     */
    setVersionStatus: adminProcedure
      .input(strategySetVersionStatusInputSchema)
      .mutation(({ input }) =>
        strategyService.setVersionStatus(input.strategyId, input.version, input.status),
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
