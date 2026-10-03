/**
 * SCOPE-002 §2 —— 策略创作工作台 tRPC 子 router（`strategyDomain.authoring.*`）。
 *
 * 定位：**传输层**。这里不写业务语义 —— 词表来自 `./vocabulary`，物化来自 `./materialize`，
 * 落库复用既有 `StrategyService`（**不新增第二条写路径**）。
 *
 * 权限（与 `server/strategyDomainRouter.ts` 同口径）：
 *   - 只读 / 物化 / 预览 ⇒ `publicProcedure`（无副作用、不落库）
 *   - 保存草稿 ⇒ `adminProcedure`
 *
 * ✅ 裁定 Q3：`diffAgainstVersion` **不在此暴露** —— 它是纯函数（`./diff.ts`），只给 tests / dev 用。
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../../_core/trpc";
import {
  materializeStrategyPresetInputSchema,
  previewStrategyAuthoringDocumentInputSchema,
  saveStrategyAuthoringDraftInputSchema,
  strategyAuthoringBlankInputSchema,
} from "../../../shared/researchContracts";
import { ResearchValidationError } from "../experimentValidation";
import { createStrategyDocument } from "../strategySchema/map";
import type { StrategyDocumentInput } from "../strategySchema/types";
import { DbStrategyRepository } from "../strategyPersistence/db";
import { StrategyService } from "../strategyPersistence/service";
import { buildStrategyAuthoringBlank } from "./blankDraft";
import { resolveAuthoringDatasetBinding } from "./datasetBinding";
import { materializePreset } from "./materialize";
import { buildStrategyAuthoringVocabulary } from "./vocabulary";
import {
  EXIT_POLICY_SLOT_IDS,
  applyExitPolicySlot,
  exitSlotIsAtDefaults,
  recognizeExitPolicySlot,
} from "./exitPolicySlots";
import type { ExitPolicyDefinition } from "../exitPolicyCommon";
import { applyExitPolicySlotInputSchema } from "../../../shared/researchContracts";

export interface StrategyAuthoringRouterOptions {
  readonly codeVersion: string;
}

function badRequest(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function summarizeValidationIssues(issues: readonly { readonly code: string; readonly path: string; readonly message: string }[]): string {
  const head = issues.slice(0, 5).map(item => `[${item.code}] ${item.path}: ${item.message}`).join("；");
  return issues.length > 5 ? `${head} …（共 ${issues.length} 处）` : head;
}

export function createStrategyAuthoringRouter(options: StrategyAuthoringRouterOptions) {
  return router({
    /** A1 —— 元数据词表（只读、确定性）。 */
    getVocabulary: publicProcedure.query(() => buildStrategyAuthoringVocabulary()),

    /**
     * FE-PLAN-004 —— 把当前 policy **认出**每个槽现在是哪个方案 + 参数。
     *
     * 🔴 识别同样只在服务端做（前端不重写匹配口径）。认不出 ⇒ `optionId: null`
     *    （UI 显示「本表单不识别」并**不改写**），绝不就近匹配。
     */
    recognizeExitPolicySlots: publicProcedure
      .input(z.object({ policy: z.unknown() }))
      .query(({ input }) => {
        const policy = input.policy as ExitPolicyDefinition;
        const usable = typeof policy === "object" && policy !== null && !Array.isArray(policy)
          && typeof (policy as { stop?: unknown }).stop === "object"
          && (policy as { stop?: unknown }).stop !== null;
        return {
          slots: EXIT_POLICY_SLOT_IDS.map(slotId => {
            if (!usable) return { slotId, optionId: null, parameters: {}, atDefaults: false };
            const recognized = recognizeExitPolicySlot(policy, slotId);
            if (recognized === null) return { slotId, optionId: null, parameters: {}, atDefaults: false };
            return {
              slotId,
              optionId: recognized.optionId,
              parameters: recognized.parameters,
              atDefaults: exitSlotIsAtDefaults(recognized, slotId),
            };
          }),
        };
      }),

    /**
     * FE-PLAN-004 —— 应用一个**退出政策槽**（止损位置 / 止盈 / 到期 / …）。
     *
     * 🔴 语义全在服务端：`applyExitPolicySlot` 负责认领、物化参数、**只覆盖该槽的键**
     *    并保留其它字段（含本表单不编辑的 `stop.contexts` / `strongHold.scaleOutRatio`）。
     *    前端只做"选哪个方案 + 填哪些参数"，**不得自行拼装 policy**。
     *
     * `issues` 非空 ⇒ `policy` 原样返回（**响亮拒绝**，不返回"看起来能用"的对象）。
     */
    applyExitPolicySlot: publicProcedure
      .input(applyExitPolicySlotInputSchema)
      .mutation(({ input }) => {
        const base = input.policy as ExitPolicyDefinition;
        if (typeof base !== "object" || base === null || Array.isArray(base)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "AUTHORING_POLICY_INVALID：policy 必须是对象" });
        }
        if (typeof base.stop !== "object" || base.stop === null || Array.isArray(base.stop)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "AUTHORING_POLICY_INVALID：policy.stop 缺失（退出政策必须含止损段）" });
        }
        const result = applyExitPolicySlot(base, input.slotId, input.optionId, input.parameters);
        return { policy: result.policy, issues: result.issues };
      }),

    /**
     * A2 —— 空白 canonical 草稿零件。
     *
     * 传 `datasetVersionId` 时先只读解析 Dataset 坐标；非 READY 或不存在 ⇒ 响亮拒绝。
     */
    getBlankDraft: publicProcedure
      .input(strategyAuthoringBlankInputSchema)
      .query(async ({ input }) => {
        if (input.datasetVersionId === undefined) return buildStrategyAuthoringBlank();
        const binding = await resolveAuthoringDatasetBinding(input.datasetVersionId);
        if (binding === null) {
          return badRequest(`AUTHORING_DATASET_NOT_FOUND: datasetVersionId=${input.datasetVersionId} 不存在或缺少所属数据集定义`);
        }
        if (binding.status !== "READY") {
          return badRequest(`AUTHORING_DATASET_NOT_READY: datasetVersionId=${input.datasetVersionId} 状态为 ${binding.status}，只有 READY 版本可用于创作`);
        }
        return buildStrategyAuthoringBlank({
          datasetBinding: {
            datasetId: binding.datasetId,
            datasetVersion: binding.datasetVersion,
            datasetVersionId: binding.datasetVersionId,
          },
        });
      }),

    /** A3 —— 预设物化（纯函数；同输入同输出）。 */
    materializePreset: publicProcedure
      .input(materializeStrategyPresetInputSchema)
      .mutation(({ input }) => materializePreset({
        slot: input.slot,
        presetId: input.presetId,
        parameters: input.parameters,
      })),

    /**
     * A4 —— 保存前预检（**不是闸门**；闸门在 A5 / `strategy.save`）。
     *
     * 用既有组装器（`createStrategyDocument` → `validateStrategyDocument` + canonical 校验）
     * 跑一遍，把 issue 原样返回给前端做锚点提示。
     */
    previewDocument: publicProcedure
      .input(previewStrategyAuthoringDocumentInputSchema)
      .mutation(({ input }) => {
        const raw = input.document;
        const canonicalDefinitionPresent =
          typeof raw.definition === "object" && raw.definition !== null && !Array.isArray(raw.definition);
        try {
          const assembled = createStrategyDocument(raw as unknown as StrategyDocumentInput);
          return {
            valid: true,
            issues: [] as { code: string; path: string; message: string }[],
            fingerprint: assembled.fingerprint,
            canonicalDefinitionPresent,
          };
        } catch (error) {
          if (error instanceof ResearchValidationError) {
            return {
              valid: false,
              issues: error.issues.map(item => ({ code: item.code, path: item.path, message: item.message })),
              fingerprint: null,
              canonicalDefinitionPresent,
            };
          }
          throw error;
        }
      }),

    /**
     * A5 —— 保存为 Draft（创作路径的**唯一**写入口）。
     *
     * 与 `strategyDomain.strategy.save` 的差别只有两条门槛：
     *   1. 必须带 canonical `definition`（否则报 `AUTHORING_DEFINITION_MISSING`）；
     *   2. `strategyType` 必填（✅ 裁定 Q4）。
     * 其余（幂等 / 版本不可变 / Dataset 绑定校验）全部复用既有 `StrategyService.save`。
     *
     * ⚠️ 状态语义（对 SCOPE-002 §2.3 A5「强制 Draft」的收敛）：**新建 ⇒ Draft；
     *    既有策略 ⇒ 不改其状态**（不把 Validated/Paper 降级成 Draft）。
     */
    saveDraft: adminProcedure
      .input(saveStrategyAuthoringDraftInputSchema)
      .mutation(async ({ input }) => {
        const raw = input.document;
        const definition = raw.definition;
        if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
          return badRequest("AUTHORING_DEFINITION_MISSING: 该文档没有 canonical definition；创作路径不接受 legacy-only 文档（请用 /strategies/new 的空白 canonical 起点）");
        }
        let assembled;
        try {
          assembled = createStrategyDocument(raw as unknown as StrategyDocumentInput);
        } catch (error) {
          if (error instanceof ResearchValidationError) {
            return badRequest(`AUTHORING_DOCUMENT_INVALID: ${summarizeValidationIssues(error.issues)}`);
          }
          throw error;
        }
        if (typeof assembled.strategyType !== "string" || assembled.strategyType.trim() === "") {
          return badRequest("AUTHORING_STRATEGY_TYPE_REQUIRED: 保存前必须选择 strategyType（裁定 Q4）");
        }
        const service = new StrategyService(new DbStrategyRepository(), { codeVersion: options.codeVersion });
        return await service.save({ document: assembled as unknown as Record<string, unknown> });
      }),
  });
}