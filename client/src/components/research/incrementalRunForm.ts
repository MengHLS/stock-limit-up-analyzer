/**
 * 增量补跑的前端门禁（**纯函数**，与 `datasetRegistry/datasetFilterForm` 同一约定：可单测、不碰网络）。
 *
 * 为什么要独立成模块：`Run` 的「能不能执行」是**两个正交维度**决定的 ——
 *   - **Run 级**：只有 PENDING / FAILED / CANCELLED 能整轮执行（COMPLETED 不可覆盖）；
 *   - **Analysis 级**：只有尚无有效结果的分析能被补跑。
 *
 * 用户最容易被这两个维度绕晕：Run 已 COMPLETED → 「运行引擎」按钮变灰；此时**新增**的分析
 * 需要走「补跑」。把判定收敛在这里并给出**具体原因文案**，UI 就不会出现「灰按钮但不说为什么」。
 */

/** 尚无有效结果、可被补跑的分析状态（与后端 `RUNNABLE_ANALYSIS_STATUSES` 一致）。 */
export const RUNNABLE_ANALYSIS_STATUSES = ["PENDING", "FAILED", "CANCELLED"] as const;

/** Run 状态中「正在执行、任何入口都应拒绝」的集合。 */
export const RUN_BUSY_STATUSES = ["RUNNING"] as const;

export function isRunnableAnalysisStatus(status: string): boolean {
  return (RUNNABLE_ANALYSIS_STATUSES as readonly string[]).includes(status);
}

export function isRunBusy(runStatus: string): boolean {
  return (RUN_BUSY_STATUSES as readonly string[]).includes(runStatus);
}

export interface IncrementalAvailability {
  /** 该分析此刻能否补跑。 */
  enabled: boolean;
  /** `enabled === false` 时的具体原因（直接展示给用户，避免「灰了但不说为什么」）。 */
  reason?: string;
  /** `enabled === true` 时的说明（讲清这一步会做什么、不会做什么）。 */
  hint?: string;
}

/**
 * 单个分析的补跑门禁。
 *
 * `hasSnapshot`：该 Run 是否已整轮执行过（`inputSnapshot` 存在）。
 * 没有基准快照时补跑无从谈起 —— 此时应引导用户走「运行引擎」整轮执行。
 */
export function incrementalAvailability(args: {
  runStatus: string;
  analysisStatus: string;
  hasSnapshot: boolean;
}): IncrementalAvailability {
  const { runStatus, analysisStatus, hasSnapshot } = args;

  if (isRunBusy(runStatus)) {
    return { enabled: false, reason: `Run 正在执行中（${runStatus}），请等当前批次结束后再补跑` };
  }
  if (!isRunnableAnalysisStatus(analysisStatus)) {
    return {
      enabled: false,
      reason:
        analysisStatus === "COMPLETED"
          ? "该分析已有结果（COMPLETED），补跑不会覆盖它；要重跑请新建 Run"
          : `该分析当前状态为 ${analysisStatus}，不可补跑（只有 PENDING / FAILED / CANCELLED 可补跑）`,
    };
  }
  if (!hasSnapshot) {
    return {
      enabled: false,
      reason: "该 Run 还没整轮执行过，没有可复用的基准快照；请先点「运行引擎」",
    };
  }
  return {
    enabled: true,
    hint:
      "补跑：只计算这个分析，复用该 Run 已冻结的 Dataset 版本与日期窗口，" +
      "不重跑其它分析、不覆盖已有结果；本批次不生成结论（需整轮重跑才会刷新结论）。",
  };
}

/** Run 下是否存在可补跑的分析（用于 Run 卡片给出「有 N 个分析待补跑」的引导）。 */
export function countRunnableAnalyses(
  runStatus: string,
  analysisStatuses: readonly string[],
  hasSnapshot: boolean,
): number {
  if (isRunBusy(runStatus) || !hasSnapshot) return 0;
  return analysisStatuses.filter(isRunnableAnalysisStatus).length;
}
