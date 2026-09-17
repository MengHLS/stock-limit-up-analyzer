/**
 * RESEARCH-PLANNER-001 — 编排层错误（机器可读错误码，稳定）。
 *
 * 为什么**不**复用 `researchEngine/errors.ts#ResearchEngineError`：
 * 那个类的错误码是**执行期**语义（「这条分析为什么跑不出来」），本文件的码是**编排期**语义
 * （「这份计划为什么没能生成 / 没能落成」）。二者面向的消费者不同：前者进
 * `research_run.errorCode`，后者进 HTTP 响应与用户提示。混在一个封闭联合里会让
 * 「Run 失败码」这个集合被编排期概念污染（例如有人会以为 `QUESTION_TOO_SHORT` 是一条 Run 的终态）。
 *
 * 码本身刻意保持**稳定且可读**：调用方（tRPC router / Workbuddy）按码分流，
 * 不解析 message 文案。
 */

export const RESEARCH_PLANNER_ERROR_CODES = [
  /** 研究问题过短（无法定位研究方法；系统不猜）。 */
  "QUESTION_TOO_SHORT",
  /** 研究问题过长（超过列宽）。 */
  "QUESTION_TOO_LONG",
  /** 研究问题不存在。 */
  "QUESTION_NOT_FOUND",
  /** 研究计划不存在。 */
  "PLAN_NOT_FOUND",
  /** 计划没有绑定 Run（结构不完整，无法物化）。 */
  "PLAN_RUN_MISSING",
  /** 计划里没有任何分析（能力缺失导致），不该继续执行。 */
  "PLAN_EMPTY",
  /** Dataset Version 不存在 / 不可读（由 reader 返回空上下文时抛出）。 */
  "DATASET_VERSION_NOT_FOUND",
  /** Dataset Version 尚未 READY（没有可读的事件 / 路径数据）。 */
  "DATASET_VERSION_NOT_READY",
  /** 实验写入成功但未返回 id（异常存储行为，立即中止以免留下孤儿）。 */
  "EXPERIMENT_WRITE_FAILED",
  /** Run 写入成功但未返回 id。 */
  "RUN_WRITE_FAILED",
  /** 研究问题写入成功但未返回 id。 */
  "QUESTION_WRITE_FAILED",
  /**
   * 假设写入成功但未返回 id。
   *
   * 假设不是可选项：引擎生成结论时从「实验的第一条假设」推导研究问题
   * （`engine.ts`）。没有假设，结论正文会退化成占位符「(未登记假设陈述)」，
   * 且 `research_conclusion.researchQuestion` 会落成 null ⇒ §15 的
   * 「结论必须基于研究问题」直接失效。因此写不进去必须中止，不能静默继续。
   */
  "HYPOTHESIS_WRITE_FAILED",
  /** 计划写入成功但未返回 id。 */
  "PLAN_WRITE_FAILED",
  /** 未归类的内部异常（保留原始 message，不伪装成某个业务码）。 */
  "INTERNAL",
] as const;
export type ResearchPlannerErrorCode = (typeof RESEARCH_PLANNER_ERROR_CODES)[number];

export class ResearchPlannerError extends Error {
  readonly code: ResearchPlannerErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ResearchPlannerErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ResearchPlannerError";
    this.code = code;
    this.details = details;
  }
}

/** 收窄任意异常为本错误（非本类 → `INTERNAL` 重包，保留原始 message，不伪装成业务码）。 */
export function toResearchPlannerError(e: unknown): ResearchPlannerError {
  if (e instanceof ResearchPlannerError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new ResearchPlannerError("INTERNAL", `编排层执行失败：${message}`);
}
