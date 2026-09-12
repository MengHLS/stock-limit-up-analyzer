/**
 * RESEARCH-001 — Repository 错误类型（机器可读错误码）。
 *
 * 为什么需要：项目**零数据库 FK**（soft reference），引用合法性必须由应用层保证。
 * 因此 Repository 必须在写入前显式校验父引用存在性，并以**稳定错误码**失败，
 * 而不是写入一个指向不存在父行的孤儿记录。
 */

export const RESEARCH_REFERENCE_ERROR = {
  DATASET_VERSION_NOT_FOUND: "RESEARCH_DATASET_VERSION_NOT_FOUND",
  EXPERIMENT_NOT_FOUND: "RESEARCH_EXPERIMENT_NOT_FOUND",
  HYPOTHESIS_NOT_FOUND: "RESEARCH_HYPOTHESIS_NOT_FOUND",
  RUN_NOT_FOUND: "RESEARCH_RUN_NOT_FOUND",
  ANALYSIS_NOT_FOUND: "RESEARCH_ANALYSIS_NOT_FOUND",
  CONCLUSION_NOT_FOUND: "RESEARCH_CONCLUSION_NOT_FOUND",
  ARTIFACT_SCOPE_REQUIRED: "RESEARCH_ARTIFACT_SCOPE_REQUIRED",
  EXPERIMENT_NOT_FOUND_FOR_UPDATE: "RESEARCH_EXPERIMENT_NOT_FOUND_FOR_UPDATE",
  /** RESEARCH-002C：分析模板不存在。 */
  TEMPLATE_NOT_FOUND: "RESEARCH_TEMPLATE_NOT_FOUND",
} as const;

export type ResearchReferenceErrorCode =
  (typeof RESEARCH_REFERENCE_ERROR)[keyof typeof RESEARCH_REFERENCE_ERROR];

/** 引用完整性 / 存在性错误。 */
export class ResearchReferenceError extends Error {
  readonly code: ResearchReferenceErrorCode;

  constructor(code: ResearchReferenceErrorCode, message: string) {
    super(message);
    this.name = "ResearchReferenceError";
    this.code = code;
  }
}

/** 唯一约束冲突（人为给出可读信息，不完全依赖驱动报错文案）。 */
export class ResearchConflictError extends Error {
  readonly code = "RESEARCH_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ResearchConflictError";
  }
}
