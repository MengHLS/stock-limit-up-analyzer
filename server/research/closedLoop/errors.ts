/**
 * STEP 25 / C-25.1 — Closed Loop（Production Quant Platform 全链编排）结构化错误。
 *
 * 错误域 = 编排器 / 阶段链本身（拓扑、请求、运行时执行错误），与各阶段模块的既有
 * 结构化错误域（RB18 / DFA_ / LIFECYCLE / TJ…）隔离；阶段内部错误一律经编排器
 * 转记为 ClosedLoopError（CL_STAGE_EXECUTION_ERROR，携带 stageId 与 run 审计）。
 *
 * 铁律：FAIL FAST —— 非法请求 / 拓扑顺序非法 / 运行时执行错误 → 响亮抛错（稳定 code）；
 * 合法 BLOCKED（缺数据/缺 evidence/上游阻塞）不抛错，走 ClosedLoopRun 的
 * blockedSummary 显式记录（见 blockers.ts）。
 */

import type { ClosedLoopStageId } from "./types";

/** 错误码白名单（稳定机器码，禁止随文案漂移）。 */
export const CLOSED_LOOP_ERROR_CODES = {
  /** request 顶层非对象。 */
  CL_REQUEST_INVALID: "CL_REQUEST_INVALID",
  /** runId 缺失或空。 */
  CL_RUN_ID_MISSING: "CL_RUN_ID_MISSING",
  /** createdAt 缺失 / 非 ISO-8601 UTC。 */
  CL_CREATED_AT_INVALID: "CL_CREATED_AT_INVALID",
  /** metadata（§28 研究身份 / 窗口）缺失或非法。 */
  CL_METADATA_INVALID: "CL_METADATA_INVALID",
  /** stageRunners 非对象或含非函数项。 */
  CL_RUNNER_MAP_INVALID: "CL_RUNNER_MAP_INVALID",
  /** stageIds 传入空数组（空阶段集）。 */
  CL_STAGES_EMPTY: "CL_STAGES_EMPTY",
  /** stageIds 含重复。 */
  CL_STAGES_DUPLICATE: "CL_STAGES_DUPLICATE",
  /** stageIds 含未知阶段。 */
  CL_STAGES_UNKNOWN: "CL_STAGES_UNKNOWN",
  /** stageIds 相对 canonical 拓扑顺序非法（逆序 / 跳段后回跳）。 */
  CL_STAGES_ORDER_VIOLATION: "CL_STAGES_ORDER_VIOLATION",
  /** seedHandoffs 传入非法值。 */
  CL_SEED_INVALID: "CL_SEED_INVALID",
  /** seedHandoffs 同 kind 重复。 */
  CL_SEED_DUPLICATE: "CL_SEED_DUPLICATE",
  /** seed kind 的产生阶段也出现在 stageIds（重复来源，歧义）。 */
  CL_SEED_REDUNDANT_WITH_STAGE: "CL_SEED_REDUNDANT_WITH_STAGE",
  /** seed kind 无任何被请求阶段消费（闲置 seed）。 */
  CL_SEED_UNUSED: "CL_SEED_UNUSED",
  /** 阶段执行器抛出异常（编排器捕获转记后重抛；error.run 携带已产生的审计 run）。 */
  CL_STAGE_EXECUTION_ERROR: "CL_STAGE_EXECUTION_ERROR",
  /** 阶段执行器返回产物非法（kind 不匹配 / 形状不合法）。 */
  CL_STAGE_OUTPUT_INVALID: "CL_STAGE_OUTPUT_INVALID",
  /** lifecycle 迁移请求本身非法（非 evidence 门槛问题，如跳级 / 时间戳非法）。 */
  CL_LIFECYCLE_TRANSITION_INVALID: "CL_LIFECYCLE_TRANSITION_INVALID",
  /** 生命周期推进时生命周期配置缺失（finalize 需要）。 */
  CL_LIFECYCLE_CONFIG_MISSING: "CL_LIFECYCLE_CONFIG_MISSING",
  /** 链指纹复核失败（run 内容被篡改 / 不一致）。 */
  CL_CHAIN_FINGERPRINT_MISMATCH: "CL_CHAIN_FINGERPRINT_MISMATCH",
} as const;

/** 错误码类型。 */
export type ClosedLoopErrorCode = (typeof CLOSED_LOOP_ERROR_CODES)[keyof typeof CLOSED_LOOP_ERROR_CODES];

/** 值是否为合法错误码。 */
export function isClosedLoopErrorCode(value: string): value is ClosedLoopErrorCode {
  return (Object.values(CLOSED_LOOP_ERROR_CODES) as string[]).includes(value);
}

/**
 * 闭环编排结构化错误（稳定 code + 人类可读信息）。
 *
 * 可选附加字段（均由构造选项携带，无则 null）：
 *   - stageId：出错阶段；
 *   - run：出错前已产生的审计 run（阶段执行错误时保证非 null，供调用方审计）；
 *   - issues：结构化 issue 清单（可选，来自拓扑/契约校验）。
 */
export interface ClosedLoopErrorOptions {
  readonly stageId?: ClosedLoopStageId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly run?: any;
  readonly issues?: readonly { code: string; path: string; message: string }[];
}

/** 闭环编排错误。 */
export class ClosedLoopError extends Error {
  readonly code: ClosedLoopErrorCode;
  readonly stageId: ClosedLoopStageId | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly run: any | null;
  readonly issues: readonly { code: string; path: string; message: string }[] | null;

  constructor(code: ClosedLoopErrorCode, message: string, options?: ClosedLoopErrorOptions) {
    super(message);
    this.name = "ClosedLoopError";
    this.code = code;
    this.stageId = options?.stageId ?? null;
    this.run = options?.run ?? null;
    this.issues = options?.issues ?? null;
  }
}
