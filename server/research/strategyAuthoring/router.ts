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
import { adminProcedure, publicProcedure, router } from "../../_core/trpc";
import {
  applyAuthoringSlotInputSchema,
  materializeStrategyPresetInputSchema,
  previewStrategyAuthoringDocumentInputSchema,
  recognizeAuthoringSlotsInputSchema,
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
import { applyAuthoringSlot, recognizeAuthoringSlots } from "./authoringSlotRegistry";

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
     * 通用 AuthoringSlot —— 识别所有已登记槽（EXIT_POLICY / ENTRY_CONDITION）。
     *
     * 槽的语义由服务端 handler 决定；客户端只按 group -> slot -> option -> parameters 消费。
     */
    recognizeAuthoringSlots: publicProcedure
      .input(recognizeAuthoringSlotsInputSchema)
      .query(({ input }) => recognizeAuthoringSlots(input.target)),

    /** 通用 AuthoringSlot —— 应用一个槽，返回完整片段和 issues。 */
    applyAuthoringSlot: publicProcedure
      .input(applyAuthoringSlotInputSchema)
      .mutation(({ input }) => applyAuthoringSlot(
        input.target,
        input.slotId,
        input.optionId,
        input.parameters,
      )),

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