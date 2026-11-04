/**
 * STEP 25 / C-25.1 — Closed Loop：主编排器 runClosedLoop。
 *
 * 编排语义（可运行 / 可审计 / 诚实）：
 *   1. 请求校验（FAIL FAST）：拓扑 / metadata / seed / runner map / lifecycle 配置；
 *   2. 逐阶段（canonical 顺序）：输入解析 → 注入式执行器运行 → 输出契约校验 →
 *      §28 谱系落账 → 下一阶段；任一阶段阻塞则其后继全部 CL_UPSTREAM_BLOCKED；
 *   3. 阻塞分类（合法 BLOCKED 返回 run；见 blockers.ts）；执行器抛错 / 输出非法 →
 *      记录审计 run 后重抛 ClosedLoopError（不吞异常，run 挂在 error.run）。
 *
 * 确定性：纯同步；runId/createdAt 注入；阶段执行器自身必须确定性（本层不调用时钟/随机）。
 * 诚实边界：不自动 promotion（finalize 只执行调用方声明的单次迁移意图）；
 * synthetic 交接以 synthetic:true 传播，run.overall.synthetic 汇总，绝不与真实结论混淆。
 */

import { CLOSED_LOOP_ERROR_CODES, ClosedLoopError } from "./errors";
import { type ClosedLoopBlockedReasonCode } from "./blockers";
import {
  CLOSED_LOOP_HANDOFF_KINDS,
  CLOSED_LOOP_RUN_RECORD_KIND,
  CLOSED_LOOP_RUN_RECORD_VERSION,
  CLOSED_LOOP_STAGE_IDS,
  CLOSED_LOOP_STAGE_RUN_SEP,
  CLOSED_LOOP_STAGE_CONSUMED_KIND,
  CLOSED_LOOP_STAGE_PRODUCED_KIND,
  closedLoopProducerOfKind,
  type ClosedLoopBlockedDetail,
  type ClosedLoopBlockedSummaryItem,
  type ClosedLoopDatasetSummary,
  type ClosedLoopHandoff,
  type ClosedLoopHandoffKind,
  type ClosedLoopRun,
  type ClosedLoopRunMetadata,
  type ClosedLoopRunRequest,
  type ClosedLoopStageContext,
  type ClosedLoopStageId,
  type ClosedLoopStageRunRecord,
  type ClosedLoopStageRunnerMap,
  type ClosedLoopStageInputById,
  type ClosedLoopStageOutputById,
} from "./types";
import { closedLoopPredecessorOf, resolveClosedLoopStageSelection, closedLoopStageSpec } from "./spec";
import { assertClosedLoopHandoffValid, isClosedLoopIsoDateTime } from "./guards";
import {
  computeClosedLoopChainFingerprint,
  computeClosedLoopRunFingerprint,
  computeFingerprintOfBody,
  deepFreeze,
  serializeClosedLoopRun,
  deserializeClosedLoopRun,
} from "./serialize";
import { closedLoopStageToLineageRecord } from "./lineage";
import { attemptClosedLoopLifecycleAdvance, assembleClosedLoopFinalizeRef } from "./lifecycle";
import type { ClosedLoopLifecycleAdvanceOutcome } from "./lifecycle";
import { isExperimentIdFormat } from "../experimentIdentity";
import { isValidDatasetVersionFormat } from "../experimentLineage/validate";
import { isValidCodeVersionFormat } from "../experimentLineage/codeVersion";
import { assertValidStrategyLifecycleRecord } from "../lifecycle/validate";

// ---------------------------------------------------------------------------
// 基础谓词 / request 校验（FAIL FAST；不含“合法 BLOCKED”）
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectFinite(record: Record<string, unknown>, path: string): void {
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && typeof value === "object") {
      collectFinite(value as Record<string, unknown>, `${path}.${key}`);
    } else if (typeof value === "number" && !Number.isFinite(value)) {
      throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID, `${path}.${key} 含非有限数字（${String(value)}）`);
    }
  }
}

function checkMetadata(metadata: ClosedLoopRunMetadata): void {
  if (!isRecord(metadata)) {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID, "request.metadata 必须是对象");
  }
  if (typeof metadata.experimentId !== "string" || !isExperimentIdFormat(metadata.experimentId)) {
    throw new ClosedLoopError(
      CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID,
      `metadata.experimentId（${String(metadata.experimentId)}）必须匹配 EXP-YYYYMMDD-XXXXXXXX 形态（§28 身份）`,
    );
  }
  if (typeof metadata.strategyId !== "string" || metadata.strategyId.trim() === "") {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID, "metadata.strategyId 必须是非空字符串");
  }
  if (typeof metadata.strategyVersion !== "string" || metadata.strategyVersion.trim() === "") {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID, "metadata.strategyVersion 必须是非空字符串");
  }
  const range = metadata.dateRange;
  if (!isRecord(range)) {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID, "metadata.dateRange 缺失");
  }
  const { startDate, endDate } = range;
  if (typeof startDate !== "string" || !DATE_RE.test(startDate) || typeof endDate !== "string" || !DATE_RE.test(endDate)) {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID, "metadata.dateRange.startDate/endDate 必须是 YYYY-MM-DD");
  }
  if (startDate > endDate) {
    throw new ClosedLoopError(
      CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID,
      `metadata.dateRange.startDate（${startDate}）晚于 endDate（${endDate}）`,
    );
  }
  if (metadata.datasetVersion !== null) {
    if (typeof metadata.datasetVersion !== "string" || !isValidDatasetVersionFormat(metadata.datasetVersion)) {
      throw new ClosedLoopError(
        CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID,
        `metadata.datasetVersion（${String(metadata.datasetVersion)}）非 rd-<builder>-<rowSchema>-<sha256> 形态或非 null`,
      );
    }
  }
  if (metadata.codeVersion !== null) {
    if (typeof metadata.codeVersion !== "string" || !isValidCodeVersionFormat(metadata.codeVersion)) {
      throw new ClosedLoopError(
        CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID,
        `metadata.codeVersion（${String(metadata.codeVersion)}）形态非法或非 null`,
      );
    }
  }
  if (metadata.universeVersion !== null && (typeof metadata.universeVersion !== "string" || metadata.universeVersion.trim() === "")) {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID, "metadata.universeVersion 必须是非空字符串或 null");
  }
  if (metadata.executionModel !== null && (typeof metadata.executionModel !== "string" || metadata.executionModel.trim() === "")) {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID, "metadata.executionModel 必须是非空字符串或 null");
  }
  const cost = metadata.costModel;
  if (cost !== null) {
    if (!isRecord(cost)) {
      throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID, "metadata.costModel 必须是对象或 null");
    }
    for (const field of ["commissionRate", "stampDutyRate", "transferFeeRate", "slippageBps", "minCommission", "lotSize"]) {
      if (!(field in cost)) {
        throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_METADATA_INVALID, `metadata.costModel.${field} 缺失（STEP 8 CostModel 六字段）`);
      }
    }
    collectFinite(cost, "costModel");
  }
  if (metadata.parameterSet !== null && typeof metadata.parameterSet === "object") {
    collectFinite(metadata.parameterSet as Record<string, unknown>, "parameterSet");
  }
}

function assertValidRequest(request: ClosedLoopRunRequest): void {
  if (!isRecord(request)) {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_REQUEST_INVALID, "request 必须是对象");
  }
  if (typeof request.runId !== "string" || request.runId.trim() === "") {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_RUN_ID_MISSING, "request.runId 必须是非空注入式字符串");
  }
  if (!isClosedLoopIsoDateTime(request.createdAt)) {
    throw new ClosedLoopError(
      CLOSED_LOOP_ERROR_CODES.CL_CREATED_AT_INVALID,
      `request.createdAt（${String(request.createdAt)}）必须是 ISO-8601 UTC（YYYY-MM-DDTHH:mm:ss[.sss]Z）`,
    );
  }
  checkMetadata(request.metadata);
  if (request.stageRunners !== undefined) {
    if (!isRecord(request.stageRunners)) {
      throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_RUNNER_MAP_INVALID, "request.stageRunners 必须是对象");
    }
    for (const [stageId, runner] of Object.entries(request.stageRunners as Record<string, unknown>)) {
      if (!(CLOSED_LOOP_STAGE_IDS as readonly string[]).includes(stageId)) {
        throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_RUNNER_MAP_INVALID, `stageRunners 含未知阶段键 ${stageId}`);
      }
      if (typeof runner !== "function") {
        throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_RUNNER_MAP_INVALID, `stageRunners[${stageId}] 必须是函数（注入式执行器）`);
      }
    }
  }
  if (request.dataProvider !== undefined && typeof request.dataProvider !== "function") {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_RUNNER_MAP_INVALID, "request.dataProvider 必须是函数");
  }
  if (request.lifecycle !== undefined) {
    if (!isRecord(request.lifecycle)) {
      throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_LIFECYCLE_TRANSITION_INVALID, "request.lifecycle 必须是对象");
    }
    try {
      assertValidStrategyLifecycleRecord(request.lifecycle.lifecycleRecord);
    } catch (error) {
      throw new ClosedLoopError(
        CLOSED_LOOP_ERROR_CODES.CL_LIFECYCLE_TRANSITION_INVALID,
        `request.lifecycle.lifecycleRecord 校验失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function validateSeeds(request: ClosedLoopRunRequest, selected: readonly ClosedLoopStageId[]): void {
  const seeds = request.seedHandoffs;
  if (seeds === undefined || seeds === null) return;
  if (!Array.isArray(seeds)) {
    throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_SEED_INVALID, "request.seedHandoffs 必须是数组");
  }
  const selectedSet = new Set(selected);
  const consumedKinds = new Set<string>();
  for (const stageId of selected) {
    const kind = CLOSED_LOOP_STAGE_CONSUMED_KIND[stageId];
    if (kind !== null) consumedKinds.add(kind);
  }
  const seen = new Set<string>();
  for (const seed of seeds) {
    if (!isRecord(seed)) {
      throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_SEED_INVALID, "seed 条目必须是对象");
    }
    const kind = seed.kind as ClosedLoopHandoffKind;
    if (!CLOSED_LOOP_HANDOFF_KINDS.includes(kind)) {
      throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_SEED_INVALID, `seed kind 非法：${String(seed.kind)}`);
    }
    if (seen.has(kind)) {
      throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_SEED_DUPLICATE, `seed 重复（kind=${kind}；每 kind 至多一条）`);
    }
    seen.add(kind);
    const producer = closedLoopProducerOfKind(kind);
    if (selectedSet.has(producer)) {
      throw new ClosedLoopError(
        CLOSED_LOOP_ERROR_CODES.CL_SEED_REDUNDANT_WITH_STAGE,
        `seed kind=${kind} 的产生阶段 ${producer} 已在 stageIds 内（来源歧义：删 seed 或去掉该阶段）`,
      );
    }
    if (!consumedKinds.has(kind)) {
      throw new ClosedLoopError(
        CLOSED_LOOP_ERROR_CODES.CL_SEED_UNUSED,
        `seed kind=${kind} 无任何被请求阶段消费（消费者未在 stageIds，或已被前序执行阶段覆盖）`,
      );
    }
    assertClosedLoopHandoffValid(seed.handoff, kind);
  }
}

// ---------------------------------------------------------------------------
// 行构造 helper
// ---------------------------------------------------------------------------

function skippedRow(stageId: ClosedLoopStageId): ClosedLoopStageRunRecord {
  return {
    stageId,
    state: "SKIPPED",
    consumedHandoffKind: CLOSED_LOOP_STAGE_CONSUMED_KIND[stageId],
    producedHandoffKind: CLOSED_LOOP_STAGE_PRODUCED_KIND[stageId],
    outputHandoffFingerprint: null,
    output: null,
    blocked: null,
    lineage: null,
  };
}

function blockedRow(
  stageId: ClosedLoopStageId,
  reasonCode: ClosedLoopBlockedReasonCode,
  detail: string,
  upstreamStageId: ClosedLoopStageId | null,
  errorCode: string | null,
  errorMessage: string | null,
): ClosedLoopStageRunRecord {
  const blocked: ClosedLoopBlockedDetail = { reasonCode, detail, upstreamStageId, errorCode, errorMessage };
  return {
    stageId,
    state: "BLOCKED",
    consumedHandoffKind: CLOSED_LOOP_STAGE_CONSUMED_KIND[stageId],
    producedHandoffKind: CLOSED_LOOP_STAGE_PRODUCED_KIND[stageId],
    outputHandoffFingerprint: null,
    output: null,
    blocked,
    lineage: null,
  };
}

function executedRow(stageId: ClosedLoopStageId, output: ClosedLoopHandoff): ClosedLoopStageRunRecord {
  return {
    stageId,
    state: "EXECUTED",
    consumedHandoffKind: CLOSED_LOOP_STAGE_CONSUMED_KIND[stageId],
    producedHandoffKind: CLOSED_LOOP_STAGE_PRODUCED_KIND[stageId],
    outputHandoffFingerprint: computeFingerprintOfBody(output),
    output,
    blocked: null,
    lineage: null,
  };
}

// ---------------------------------------------------------------------------
// 主编排器
// ---------------------------------------------------------------------------

/** 运行一次闭环（确定性编排骨架）。完整语义见文件头与 ROADMAP §27/§0。 */
export function runClosedLoop(request: ClosedLoopRunRequest): ClosedLoopRun {
  assertValidRequest(request);
  const selected = resolveClosedLoopStageSelection(request.stageIds);
  validateSeeds(request, selected);

  const ctx: ClosedLoopStageContext = { runId: request.runId, createdAt: request.createdAt };
  const runners = { ...(request.stageRunners ?? {}) } as ClosedLoopStageRunnerMap;
  const selectedSet = new Set(selected);
  const seedsByKind = new Map<ClosedLoopHandoffKind, ClosedLoopHandoff>();
  for (const seed of request.seedHandoffs ?? []) {
    seedsByKind.set(seed.kind as ClosedLoopHandoffKind, seed.handoff as ClosedLoopHandoff);
  }

  const stageRunId = (stageId: ClosedLoopStageId): string =>
    `${request.runId}${CLOSED_LOOP_STAGE_RUN_SEP}${stageId}`;

  const invoke = (
    stageId: ClosedLoopStageId,
    input: ClosedLoopStageInputById[ClosedLoopStageId] | null,
  ): ClosedLoopHandoff => {
    const executor = runners[stageId] as unknown as
      | ((c: ClosedLoopStageContext, i: ClosedLoopStageInputById[ClosedLoopStageId]) => ClosedLoopStageOutputById[ClosedLoopStageId])
      | undefined;
    if (executor === undefined) {
      throw new ClosedLoopError(
        CLOSED_LOOP_ERROR_CODES.CL_STAGE_EXECUTION_ERROR,
        `阶段 ${stageId} 执行器未注入（编排内部不变量破坏）`,
        { stageId },
      );
    }
    const out = executor(ctx, input as never);
    return assertClosedLoopHandoffValid(out, CLOSED_LOOP_STAGE_PRODUCED_KIND[stageId]) as ClosedLoopHandoff;
  };

  const rows: ClosedLoopStageRunRecord[] = [];
  let firstBlocked: ClosedLoopStageId | null = null;
  let datasetSynthetic = false;
  let anyExecutedSynthetic = false;
  let promotionApplied = false;

  for (const stageId of CLOSED_LOOP_STAGE_IDS) {
    const spec = closedLoopStageSpec(stageId);
    if (!selectedSet.has(stageId)) {
      rows.push(skippedRow(stageId));
      continue;
    }
    if (firstBlocked !== null) {
      rows.push(
        blockedRow(
          stageId,
          "CL_UPSTREAM_BLOCKED",
          `上游阶段 ${firstBlocked} 已阻塞，本阶段及后续不执行（禁止伪造中间产物冒充已执行）`,
          firstBlocked,
          null,
          null,
        ),
      );
      continue;
    }

    // ---- 输入解析（canonical 前驱产出 | seed | 缺失） ----
    let input: ClosedLoopStageInputById[ClosedLoopStageId] | null = null;
    let inputResolved = spec.consumesKind === null;
    if (spec.consumesKind !== null) {
      const predecessor = closedLoopPredecessorOf(stageId);
      const prevRow = predecessor !== null ? rows[stageIndex(predecessor)] : undefined;
      if (prevRow !== undefined && prevRow.state === "EXECUTED" && prevRow.output !== null) {
        input = prevRow.output as ClosedLoopStageInputById[ClosedLoopStageId];
        inputResolved = true;
      } else {
        const seed = seedsByKind.get(spec.consumesKind);
        if (seed !== undefined) {
          input = seed as ClosedLoopStageInputById[ClosedLoopStageId];
          inputResolved = true;
        }
      }
    }

    // ---- 门禁 1：data 数据链 ----
    if (stageId === "data") {
      if (runners.data === undefined && request.dataProvider === undefined) {
        rows.push(
          blockedRow(
            stageId,
            "CL_DATA_NOT_INJECTED",
            "真实数据链未注入（缺 data 执行器 / dataProvider）；不伪造 datasetSummary——接真实 DB 在 VALIDATED 阶段",
            null,
            null,
            null,
          ),
        );
        firstBlocked = stageId;
        continue;
      }
      if (runners.data === undefined && request.dataProvider !== undefined) {
        // dataProvider 包装为 data 执行器（忽略 ctx/input；仅当未注入显式 data runner）。
        const provider = request.dataProvider;
        runners.data = ((_ctx: ClosedLoopStageContext, _input: null) => provider()) as ClosedLoopStageRunnerMap["data"];
      }
    }

    // ---- 门禁 2：research 消费的 dataset gate ----
    if (stageId === "research" && spec.consumesKind === "datasetSummary") {
      if (!inputResolved || input === null) {
        rows.push(
          blockedRow(
            stageId,
            "CL_DATA_NOT_INJECTED",
            "research 阶段无 datasetSummary 输入（真实数据链未注入）；禁止在无数据声明下运行研究管线",
            null,
            null,
            null,
          ),
        );
        firstBlocked = stageId;
        continue;
      }
      const ds = input as ClosedLoopDatasetSummary;
      datasetSynthetic = datasetSynthetic || ds.synthetic;
      if (ds.gate !== "PASS") {
        rows.push(
          blockedRow(
            stageId,
            "CL_DATASET_GATE_NOT_PASS",
            `Research Dataset gate = ${ds.gate}（非 PASS）；§45.2 数据链就绪认证未达成，禁止以该数据集产出研究结论`,
            null,
            null,
            null,
          ),
        );
        firstBlocked = stageId;
        continue;
      }
    }

    // ---- 门禁 3：runner 注入（finalize 可走内置生命周期整合） ----
    let builtinFinalize = false;
    if (stageId === "finalize" && runners.finalize === undefined && request.lifecycle !== undefined) {
      builtinFinalize = true;
    } else if (runners[stageId] === undefined) {
      const reasonCode: ClosedLoopBlockedReasonCode = stageId === "data" ? "CL_DATA_NOT_INJECTED" : "CL_RUNNER_NOT_INJECTED";
      if (stageId === "finalize") {
        rows.push(
          blockedRow(
            stageId,
            "CL_LIFECYCLE_CONFIG_MISSING",
            "finalize 阶段被请求但未注入 finalize 执行器、且 request.lifecycle 缺失（无法完成生命周期整合）",
            null,
            null,
            null,
          ),
        );
      } else {
        rows.push(
          blockedRow(
            stageId,
            reasonCode,
            `阶段 ${stageId} 执行器未注入（注入式执行器表缺 ${stageId} 项）；无法执行该阶段`,
            null,
            null,
            null,
          ),
        );
      }
      firstBlocked = stageId;
      continue;
    }

    // ---- 门禁 4：输入缺失（subset 链缺 seed） ----
    if (spec.consumesKind !== null && !inputResolved) {
      rows.push(
        blockedRow(
          stageId,
          "CL_STAGE_INPUT_MISSING",
          `阶段 ${stageId} 需要输入交接 ${spec.consumesKind}（产生阶段 ${closedLoopProducerOfKind(spec.consumesKind)} 未被请求）；请提供 seed 或纳入前序阶段`,
          null,
          null,
          null,
        ),
      );
      firstBlocked = stageId;
      continue;
    }

    // ---- 执行 ----
    let output: ClosedLoopHandoff;
    if (builtinFinalize) {
      const config = request.lifecycle!;
      const outcome = attemptClosedLoopLifecycleAdvance(config.lifecycleRecord, config.transition, {
        syntheticDataset: datasetSynthetic,
        allowSyntheticEvidence: config.allowSyntheticEvidence,
      });
      if (outcome.status === "blocked") {
        rows.push(
          blockedRow(
            stageId,
            outcome.reasonCode,
            outcome.detail,
            null,
            null,
            null,
          ),
        );
        firstBlocked = stageId;
        continue;
      }
      // advanced：先占位 runSummary，链结束后回填真实计数（finalize 为末阶段）。
      const finalizeRef = assembleClosedLoopFinalizeRef({
        config,
        outcome,
        source: {
          module: "lifecycle",
          moduleRunKind: "STRATEGY_LIFECYCLE_RECORD",
          runId: null,
          fingerprint: outcome.record.fingerprint,
        },
        runSummary: { executedStageCount: 0, blockedStageCount: 0, synthetic: datasetSynthetic, note: "占位（链结束后回填）" },
        promotion: buildPromotion(config.transition.to, outcome, datasetSynthetic),
        strategyKey: {
          strategyId: config.lifecycleRecord.strategyId,
          strategyVersion: config.lifecycleRecord.strategyVersion,
        },
      });
      output = finalizeRef;
    } else {
      try {
        output = invoke(stageId, input);
      } catch (error) {
        // 记录审计 run 后重抛（不吞异常）：错误码保持原始（CL_STAGE_OUTPUT_INVALID 等），
        // 未知异常归并为 CL_STAGE_EXECUTION_ERROR。
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof ClosedLoopError
            ? error.code
            : CLOSED_LOOP_ERROR_CODES.CL_STAGE_EXECUTION_ERROR;
        const reasonCode: ClosedLoopBlockedReasonCode =
          code === CLOSED_LOOP_ERROR_CODES.CL_STAGE_OUTPUT_INVALID
            ? "CL_STAGE_OUTPUT_INVALID"
            : "CL_STAGE_EXECUTION_ERROR";
        rows.push(blockedRow(stageId, reasonCode, message, null, code, message));
        const run = assembleRun(rows, request, selected, ctx, stageId, datasetSynthetic, anyExecutedSynthetic, promotionApplied);
        throw new ClosedLoopError(code, `阶段 ${stageId} 失败：${message}`, { stageId, run });
      }
    }

    // ---- EXECUTED 落账 ----
    // data 阶段附加 gate 门槛：产出 datasetSummary.gate 非 PASS → data 自身 BLOCKED
    // （CL_DATASET_GATE_NOT_PASS；§45.2 认证未达成，禁止产出/消费该数据集结论）。
    if (stageId === "data" && output.kind === "datasetSummary" && output.gate !== "PASS") {
      rows.push(
        blockedRow(
          stageId,
          "CL_DATASET_GATE_NOT_PASS",
          `data 数据源产出 dataset gate = ${output.gate}（非 PASS）；§45.2 数据链就绪认证未达成`,
          null,
          null,
          null,
        ),
      );
      firstBlocked = stageId;
      continue;
    }
    rows.push(executedRow(stageId, output));
    anyExecutedSynthetic = anyExecutedSynthetic || output.synthetic === true;
    if (stageId === "data" && output.kind === "datasetSummary") {
      datasetSynthetic = datasetSynthetic || output.synthetic === true;
    }
    if (stageId === "finalize" && output.kind === "finalizeRef") {
      promotionApplied = output.promotion.applied;
    }
  }

  // ---- §28 谱系落账（EXECUTED 阶段；在整链完成后统一计算，保证确定性） ----
  const finalRows = rows.map((row) => {
    if (row.state !== "EXECUTED" || row.output === null) return row;
    const lineageRecord = closedLoopStageToLineageRecord({
      stageId: row.stageId,
      stageRunId: stageRunId(row.stageId),
      metadata: request.metadata,
      createdAt: request.createdAt,
    });
    return {
      ...row,
      lineage: {
        stageRunId: stageRunId(row.stageId),
        stageId: row.stageId,
        experimentId: request.metadata.experimentId,
        strategyId: request.metadata.strategyId,
        strategyVersion: request.metadata.strategyVersion,
        dateRange: {
          startDate: request.metadata.dateRange.startDate,
          endDate: request.metadata.dateRange.endDate,
        },
        datasetVersion: request.metadata.datasetVersion,
        codeVersion: request.metadata.codeVersion,
        createdAt: request.createdAt,
        lineageRecord,
      },
    };
  });

  // ---- finalize 内置推进的 runSummary 回填（真实计数） ----
  const finalRows2 = finalRows.map((row) => {
    if (row.stageId !== "finalize" || row.state !== "EXECUTED" || row.output === null) return row;
    const finalizeOut = row.output;
    if (finalizeOut.kind !== "finalizeRef") return row;
    const executedCount = finalRows.filter((r) => r.state === "EXECUTED").length;
    const blockedCount = finalRows.filter((r) => r.state === "BLOCKED").length;
    const patched = {
      ...finalizeOut,
      runSummary: {
        executedStageCount: executedCount,
        blockedStageCount: blockedCount,
        synthetic: datasetSynthetic,
        note: "全链 summary（编排器回填真实计数）",
      },
    } as ClosedLoopHandoff;
    return {
      ...row,
      output: patched,
      outputHandoffFingerprint: computeFingerprintOfBody(patched),
    };
  });

  return assembleRun(finalRows2, request, selected, ctx, null, datasetSynthetic, anyExecutedSynthetic, promotionApplied);
}

function buildPromotion(
  to: string,
  outcome: ClosedLoopLifecycleAdvanceOutcome,
  datasetSynthetic: boolean,
): { considered: boolean; applied: boolean; evidenceIsSynthetic: boolean; detail: string } {
  const productionTier = to === "Approved" || to === "Production";
  const applied = outcome.status === "advanced" && productionTier;
  return {
    considered: productionTier,
    applied,
    evidenceIsSynthetic: outcome.evidenceIsSynthetic,
    detail: productionTier
      ? applied
        ? `生命周期已推进至 ${to}（调用方声明 + evidence 门槛通过；数据集 synthetic=${datasetSynthetic}）`
        : `未推进至 ${to}（见 lifecycle.blockedReasonCode；production 决策留人工 + gate，编排器不自动 promotion）`
      : "本次迁移目标非 Approved/Production 档，不涉及 promotion",
  };
}

/** 组装终态 run（含 blockedSummary / overall / 指纹 / 审计行补全）。 */
function assembleRun(
  rowsIn: readonly ClosedLoopStageRunRecord[],
  request: ClosedLoopRunRequest,
  selected: readonly ClosedLoopStageId[],
  ctx: ClosedLoopStageContext,
  failingStage: ClosedLoopStageId | null,
  datasetSynthetic: boolean,
  anyExecutedSynthetic: boolean,
  promotionApplied: boolean,
): ClosedLoopRun {
  // 行完整化：失败场景把失败行之后的 requested 阶段补 BLOCKED / 非 requested 补 SKIPPED。
  const byId = new Map(rowsIn.map((r) => [r.stageId, r] as const));
  const rows: ClosedLoopStageRunRecord[] = [];
  let afterFailure = failingStage === null;
  for (const stageId of CLOSED_LOOP_STAGE_IDS) {
    const existing = byId.get(stageId);
    if (existing !== undefined) {
      rows.push(existing);
      if (existing.state === "BLOCKED") afterFailure = true;
      continue;
    }
    if (!selected.includes(stageId)) {
      rows.push(skippedRow(stageId));
    } else if (failingStage !== null && !afterFailure && stageIndex(stageId) < stageIndex(failingStage)) {
      // 失败行之前未记录的 requested 阶段（不应发生；防越序）
      rows.push(blockedRow(stageId, "CL_UPSTREAM_BLOCKED", "内部排序异常", failingStage, null, null));
    } else if (failingStage !== null && stageId === failingStage) {
      rows.push(blockedRow(stageId, "CL_STAGE_EXECUTION_ERROR", "阶段执行器抛错（错误信息见 errorMessage）", null, null, null));
    } else {
      rows.push(
        blockedRow(
          stageId,
          "CL_UPSTREAM_BLOCKED",
          `上游阶段 ${failingStage ?? "—"} 执行失败/阻塞，本阶段及后续不执行`,
          failingStage,
          null,
          null,
        ),
      );
    }
  }

  const executed = rows.filter((r) => r.state === "EXECUTED");
  const blocked = rows.filter((r) => r.state === "BLOCKED");
  const skipped = rows.filter((r) => r.state === "SKIPPED");

  const blockedSummary: ClosedLoopBlockedSummaryItem[] = blocked.map((row) => ({
    stageId: row.stageId,
    reasonCode: row.blocked!.reasonCode,
    detail: row.blocked!.detail,
    upstreamStageId: row.blocked!.upstreamStageId,
    errorCode: row.blocked!.errorCode,
    errorMessage: row.blocked!.errorMessage,
  }));

  const status: ClosedLoopRun["overall"]["status"] =
    executed.length > 0 && blocked.length === 0
      ? "ALL_EXECUTED"
      : executed.length === 0
        ? "NO_STAGE_EXECUTED"
        : "PARTIAL_BLOCKED";

  const runnerInjected = Object.keys(request.stageRunners ?? {}).filter((id) =>
    (CLOSED_LOOP_STAGE_IDS as readonly string[]).includes(id),
  ) as ClosedLoopStageId[];

  const requestView = {
    stageIds: [...selected],
    runnerInjected,
    dataProviderInjected: request.dataProvider !== undefined,
    seedKinds: (request.seedHandoffs ?? []).map((s) => s.kind as ClosedLoopHandoffKind),
    lifecycleConfigPresent: request.lifecycle !== undefined,
  };

  const firstBlockedReason =
    blocked.length > 0 ? (blocked.find((b) => b.blocked !== null && b.blocked!.upstreamStageId === null)?.blocked?.reasonCode ?? blocked[0]!.blocked!.reasonCode) : null;

  const overall: ClosedLoopRun["overall"] = {
    status,
    executedStageCount: executed.length,
    blockedStageCount: blocked.length,
    skippedStageCount: skipped.length,
    firstBlockedReasonCode: firstBlockedReason,
    synthetic: anyExecutedSynthetic || datasetSynthetic,
    promotionApplied,
    note:
      blocked.length === 0
        ? "全链 EXECUTED"
        : `首阻塞 ${blocked[0]!.stageId}（${blocked[0]!.blocked!.reasonCode}）：${blocked[0]!.blocked!.detail}`,
  };

  const chainPayload = { stages: rows, blockedSummary, request: requestView, metadata: request.metadata, overall };
  const chainFingerprint = computeClosedLoopChainFingerprint(chainPayload);
  const body: Omit<ClosedLoopRun, "fingerprint"> = {
    recordKind: CLOSED_LOOP_RUN_RECORD_KIND,
    recordVersion: CLOSED_LOOP_RUN_RECORD_VERSION,
    runId: ctx.runId,
    createdAt: ctx.createdAt,
    metadata: request.metadata,
    request: requestView,
    stages: rows,
    blockedSummary,
    chainFingerprint,
    overall,
  };
  const fingerprint = computeClosedLoopRunFingerprint(body);
  return deepFreeze({ ...body, fingerprint } as ClosedLoopRun);
}

function stageIndex(stageId: ClosedLoopStageId): number {
  const index = CLOSED_LOOP_STAGE_IDS.indexOf(stageId);
  if (index < 0) throw new ClosedLoopError(CLOSED_LOOP_ERROR_CODES.CL_STAGES_UNKNOWN, `未知阶段 ${stageId}`);
  return index;
}

/** 便捷：run → JSON（供审计日志/报告）。 */
export function closedLoopRunToJson(run: ClosedLoopRun): string {
  return serializeClosedLoopRun(run);
}

/** 便捷：反序列化并复核链指纹（篡改拒绝）。 */
export function deserializeClosedLoopRunVerified(json: string): ClosedLoopRun {
  const run = deserializeClosedLoopRun(json, { verify: true });
  return run;
}
