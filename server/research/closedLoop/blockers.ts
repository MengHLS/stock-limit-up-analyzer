/**
 * STEP 25 / C-25.1 — Closed Loop：BLOCKED reason code（阶段级合法阻塞，非异常）。
 *
 * 语义边界（与 errors.ts 的区分）：
 *   - 下列 reasonCode 是「诚实判定」结果：阶段未执行（或其后继未执行）但原因合法、
 *     以 ClosedLoopRun 的 stage.state=BLOCKED + reasonCode 显式记录，**不抛错**；
 *   - 真实编程错误（请求非法 / 拓扑非法 / 阶段执行器抛错）走 errors.ts 抛 ClosedLoopError，
 *     不进本清单。
 *
 * 命名纪律：全部 CL_ 前缀（域前缀见 ROADMAP §49），与既有 reasonCode 域
 * （LIFECYCLE_THRESHOLD_* / DFA_* / TJ_* / RB18_*）不重叠。
 */
export const CLOSED_LOOP_BLOCKED_REASON_CODES = {
  /**
   * 数据链真实数据源未注入（dataProvider / 数据执行器缺失），且未提供 dataset 交接种子。
   * Data 阶段（以及从 data 起步的 Research 阶段）真实结论无法产生 → 显式 BLOCKED。
   */
  CL_DATA_NOT_INJECTED: "CL_DATA_NOT_INJECTED",
  /**
   * 数据集 gate 未 PASS（FAIL / INCONCLUSIVE）：datasetSummary.gate !== "PASS"。
   * §45.2 数据链就绪认证未达成前，禁止以该数据集得出研究/回测结论。
   */
  CL_DATASET_GATE_NOT_PASS: "CL_DATASET_GATE_NOT_PASS",
  /** 阶段执行器未注入（请求了该阶段但 stageRunners 无对应函数）。 */
  CL_RUNNER_NOT_INJECTED: "CL_RUNNER_NOT_INJECTED",
  /** 阶段输入不可得：canonical 前驱未执行且未提供对应 kind 的 seed 交接。 */
  CL_STAGE_INPUT_MISSING: "CL_STAGE_INPUT_MISSING",
  /** 上游阶段已 BLOCKED，本阶段及后续不执行（禁伪造中间产物冒充已执行）。 */
  CL_UPSTREAM_BLOCKED: "CL_UPSTREAM_BLOCKED",
  /** 生命周期证据门槛未满足（如 →Validated/→Production 缺 datasetGate PASS evidence）。 */
  CL_GATE_EVIDENCE_MISSING: "CL_GATE_EVIDENCE_MISSING",
  /**
   * C-24.1 上游已知债务接线限制：tradeJournal 对 actual=null 的 unfilled 条目
   * assertValidTradeJournalEntry 会拒绝（reconcile 却可能产出 NONE+null）。
   * 本任务不改 C-24.1；触及时显式记录为接线限制，交由独立小任务治理。
   */
  CL_REVIEW_UNFILLED_VALIDATION_DEFERRED: "CL_REVIEW_UNFILLED_VALIDATION_DEFERRED",
  /**
   * finalize 阶段被请求，但未注入 finalize 执行器、且请求未携带 lifecycle 配置
   * （无法完成生命周期整合）。
   */
  CL_LIFECYCLE_CONFIG_MISSING: "CL_LIFECYCLE_CONFIG_MISSING",
  /** 阶段执行器抛错（run 记录级阻塞原因；编排器同时抛 ClosedLoopError 不吞异常）。 */
  CL_STAGE_EXECUTION_ERROR: "CL_STAGE_EXECUTION_ERROR",
  /** 阶段执行器返回产物非法（kind 不匹配 / 契约校验失败）。 */
  CL_STAGE_OUTPUT_INVALID: "CL_STAGE_OUTPUT_INVALID",
} as const;

/** BLOCKED reason code 类型。 */
export type ClosedLoopBlockedReasonCode =
  (typeof CLOSED_LOOP_BLOCKED_REASON_CODES)[keyof typeof CLOSED_LOOP_BLOCKED_REASON_CODES];

/** 值是否为合法 BLOCKED reason code。 */
export function isClosedLoopBlockedReasonCode(value: string): value is ClosedLoopBlockedReasonCode {
  return (Object.values(CLOSED_LOOP_BLOCKED_REASON_CODES) as string[]).includes(value);
}

/**
 * evidence 门槛类 issue code 前缀（C-21.1 lifecycle 的 LIFECYCLE_THRESHOLD_*）。
 * 编排器把「仅含这些门槛 issue 的迁移请求」判定为 CL_GATE_EVIDENCE_MISSING（合法 BLOCKED）；
 * 含其它 issue（跳级 / 时间戳 / reason 非法等）则视为调用方错误 → 抛错。
 */
export const CLOSED_LOOP_GATE_THRESHOLD_ISSUE_PREFIX = "LIFECYCLE_THRESHOLD_" as const;
