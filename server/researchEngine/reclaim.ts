/**
 * RESEARCH-ORPHAN-RECLAIM-001 —— 研究链孤儿回收（**唯一实现**）。
 *
 * 根因（2026-09-17 实查，非推断）：
 *   `engine.ts#run` / `#runIncremental` 的失败收敛路径只把 **Run** 置为 FAILED，
 *   从不收敛该 Run 下仍处 RUNNING / PENDING 的 **Analysis**。于是异常终止后留下
 *   「父 Run 已终态、子 Analysis 未终态」的自相矛盾状态：污染各状态计数、在 UI 上
 *   表现为「永远在做」，且没有任何产品入口能纠正它。
 *   实测现场：`research_run 330003` = FAILED（2026-09-11 14:58），其 `research_analysis 270008`
 *   至今停在 PENDING、`resultRows = 0`。
 *
 * 两道防线（缺一不可）：
 *   ① **源头**（`engine.ts`）：Run 异常收敛时一并收敛其未完成 Analysis ⇒ 不再产生新孤儿；
 *   ② **回收**（本文件）：收敛**历史遗留**的孤儿，并对「执行者已消失」的 RUNNING Run 兜底。
 *
 * 判据（保守：宁可不回收也不误杀）：
 *   - 父 Run 已终态（COMPLETED / FAILED / CANCELLED）且**终止时间早于 `now - graceMinutes`**
 *     ⇒ 子 Analysis 是孤儿。设缓冲期是让位给「刚失败、用户正要重跑」的正常操作，
 *     避免回收器与 `engine.ts` 置 RUNNING 的时序竞争。
 *   - 父 Run **不存在**（本项目零 FK，父行被删不会级联）⇒ 子 Analysis 是孤儿。
 *   - 父 Run `RUNNING` 且 `startedAt` 早于 `now - staleRunningMinutes` ⇒ 执行者进程已不存在
 *     （正常 Run 为分钟级；`tsx watch` 热重启会留下这种残骸）。
 *   - 🔴 父 Run `PENDING` **一律不动**。它有两种合法含义：
 *       (a) 已建计划但**从未执行**（`inputSnapshot` 与 `startedAt` 皆空）；
 *       (b) 增量批次跑完但**仍有未完成分析**（`engine.ts:596` 会把 Run 置回 PENDING）。
 *     把 (a) 当孤儿收敛会**破坏用户的合法研究草稿**——实测 `research_run 630002`
 *     属于实验 360002（DRAFT），从未执行，**必须保留**。
 *   - 父 Run 无任何时间基准 ⇒ **跳过**（诚实：不敢回收）。
 *
 * 边界：本模块只做**状态收敛**，不删任何行、不算任何统计、不动 Dataset / 正式 Strategy。
 */

import type { ResearchAnalysis, ResearchRepositories, ResearchRun } from "../researchCore";

/** 父 Run 终态后，子 Analysis 需等待多久才允许被回收（分钟）—— 隔离「刚失败正要点重跑」的竞争窗口。 */
export const DEFAULT_ORPHAN_GRACE_MINUTES = 30;

/** RUNNING 超过多久视为「执行者已不存在」（分钟）。正常 Run 为分钟级；12 小时留足余量。 */
export const DEFAULT_STALE_RUNNING_MINUTES = 720;

/** 收敛原因（机器可判读；只进返回值，**不落库** —— `research_analysis` 无 errorCode 列）。 */
export type OrphanReason = "run-terminal" | "run-missing" | "run-orphaned-stale";

export interface ReclaimedOrphanAnalysis {
  analysisId: number;
  runId: number;
  /** 收敛前的状态（PENDING / RUNNING）。 */
  previousStatus: string;
  reason: OrphanReason;
}

export interface ReclaimedOrphanRun {
  runId: number;
  experimentId: number;
  /** 置 RUNNING 后停更的分钟数。 */
  staleMinutes: number;
  /** 随之收敛的子 Analysis 条数。 */
  analysisCount: number;
}

/** 如实回报：被**跳过**的未执行草稿（不是在途 Run，不得回收）。 */
export interface SkippedUnexecutedRun {
  runId: number;
  experimentId: number;
  createdAt: string | undefined;
  reason: string;
}

export interface OrphanReclaimResult {
  /** 因「执行者消失」被收敛的 Run。 */
  reclaimedRuns: ReclaimedOrphanRun[];
  /** 被收敛的孤儿 Analysis（含上面每个 Run 的子分析）。 */
  reclaimedAnalyses: ReclaimedOrphanAnalysis[];
  /** 明确判定为「合法未执行草稿」而**保留**的 Run（如实回报，不静默）。 */
  skippedUnexecutedRuns: SkippedUnexecutedRun[];
}

export interface OrphanReclaimOptions {
  graceMinutes?: number;
  staleRunningMinutes?: number;
  /** 注入时钟（测试用）。 */
  now?: Date;
}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

function parseIso(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.NaN;
}

/**
 * 回收研究链孤儿。**幂等**：无孤儿时是纯只读遍历，返回值全空。
 * 返回值如实分类「收敛了什么」与「明确保留了什么」，调用方不得只打日志隐去后者。
 */
export async function reclaimOrphanResearchWork(
  repos: ResearchRepositories,
  options: OrphanReclaimOptions = {},
): Promise<OrphanReclaimResult> {
  const graceMinutes = options.graceMinutes ?? DEFAULT_ORPHAN_GRACE_MINUTES;
  const staleRunningMinutes = options.staleRunningMinutes ?? DEFAULT_STALE_RUNNING_MINUTES;
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const result: OrphanReclaimResult = {
    reclaimedRuns: [],
    reclaimedAnalyses: [],
    skippedUnexecutedRuns: [],
  };
  // 两条阈值都关掉 ⇒ 整体跳过（与 dataset 侧 `staleMinutes <= 0 → 整体跳过` 同构）。
  if (graceMinutes <= 0 && staleRunningMinutes <= 0) return result;

  // 全库 Run（本项目为十位量级），建索引供逐条判定。
  const runById = new Map<number, ResearchRun>();
  for (const run of await repos.runs.list()) {
    if (run.id !== undefined) runById.set(run.id, run);
  }

  // 只关心非终态 Analysis（终态的没有可收敛的东西）。
  const looseAnalyses: ResearchAnalysis[] = [
    ...(await repos.analyses.list({ status: "PENDING" })),
    ...(await repos.analyses.list({ status: "RUNNING" })),
  ];

  /** 收敛单条 Analysis：只写状态与完成时刻（原因由父 Run 的 errorCode / errorMessage 承载）。 */
  const cancelAnalysis = async (analysis: ResearchAnalysis, reason: OrphanReason): Promise<void> => {
    await repos.analyses.update(analysis.id!, { status: "CANCELLED", completedAt: nowIso });
    result.reclaimedAnalyses.push({
      analysisId: analysis.id!,
      runId: analysis.runId,
      previousStatus: analysis.status,
      reason,
    });
  };

  /** 待兜底收敛的 RUNNING 孤儿 Run（先收 Run，再收其子 Analysis）。 */
  const orphanedRuns = new Map<number, { run: ResearchRun; staleMinutes: number }>();

  for (const analysis of looseAnalyses) {
    if (analysis.id === undefined) continue;
    const run = runById.get(analysis.runId);

    // ① 父 Run 已被删除（零 FK ⇒ 不级联）⇒ 子行是孤儿。
    if (!run) {
      if (graceMinutes <= 0) continue;
      await cancelAnalysis(analysis, "run-missing");
      continue;
    }

    // ② 父 Run 已终态 ⇒ 硬证据孤儿（等过缓冲期再收，让位给重跑）。
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      if (graceMinutes <= 0) continue;
      const terminalAt = parseIso(run.completedAt ?? run.startedAt ?? run.createdAt);
      if (!Number.isFinite(terminalAt)) continue; // 无时间基准 → 跳过（诚实）
      if (terminalAt > nowMs - graceMinutes * 60_000) continue; // 刚终态 → 不抢跑
      await cancelAnalysis(analysis, "run-terminal");
      continue;
    }

    // ③ 父 Run PENDING ⇒ 合法中间态，一律不动（详见文件头）。
    if (run.status === "PENDING") {
      if (run.inputSnapshot == null && run.startedAt == null) {
        result.skippedUnexecutedRuns.push({
          runId: run.id!,
          experimentId: run.experimentId,
          createdAt: run.createdAt,
          reason: "从未进入执行（inputSnapshot 与 startedAt 皆空）⇒ 待执行草稿，不是在途 Run",
        });
      }
      continue;
    }

    // ④ 父 Run RUNNING ⇒ 仅在明确「执行者已消失」时才兜底收敛。
    if (run.status === "RUNNING") {
      if (staleRunningMinutes <= 0) continue;
      const startedAt = parseIso(run.startedAt);
      if (!Number.isFinite(startedAt)) continue; // 无时间基准 → 跳过
      if (startedAt > nowMs - staleRunningMinutes * 60_000) continue; // 仍在执行窗口内
      if (!orphanedRuns.has(run.id!)) {
        orphanedRuns.set(run.id!, {
          run,
          staleMinutes: Math.round((nowMs - startedAt) / 60_000),
        });
      }
    }
  }

  // 兜底：收敛「执行者已消失」的 Run，随后收敛其子 Analysis。
  for (const [runId, { run, staleMinutes }] of orphanedRuns) {
    await repos.runs.update(runId, {
      status: "FAILED",
      completedAt: nowIso,
      errorCode: "RUN_ORPHANED",
      errorMessage:
        `执行者进程已不存在：置 RUNNING 后停更 ${staleMinutes} 分钟无进展` +
        `（正常 Run 为分钟级；进程热重启会留下此类残骸）。` +
        `本 Run 未产出结论；已产出的分析结果原样保留，可直接增量补跑。`,
    });

    let analysisCount = 0;
    for (const analysis of looseAnalyses) {
      if (analysis.id === undefined || analysis.runId !== runId) continue;
      await cancelAnalysis(analysis, "run-orphaned-stale");
      analysisCount += 1;
    }

    // Experiment 卡在 RUNNING 是同类死锁（与 Dataset 侧「版本卡 BUILDING」同构）。
    // 只在「该 Experiment 下再无其它 RUNNING Run」时回滚，避免误伤并行 Run。
    const experiment = await repos.experiments.getById(run.experimentId);
    if (experiment?.status === "RUNNING") {
      const stillRunning = (await repos.runs.list({ experimentId: run.experimentId })).some(
        (r) => r.status === "RUNNING",
      );
      if (!stillRunning) {
        await repos.experiments.update(run.experimentId, { status: "FAILED" });
      }
    }

    result.reclaimedRuns.push({
      runId,
      experimentId: run.experimentId,
      staleMinutes,
      analysisCount,
    });
  }

  return result;
}

/** 供日志 / 报告汇总一句话（不隐藏任何一类）。 */
export function describeOrphanReclaim(result: OrphanReclaimResult): string {
  const parts: string[] = [];
  if (result.reclaimedRuns.length > 0) parts.push(`收敛孤儿 Run ${result.reclaimedRuns.length} 个`);
  if (result.reclaimedAnalyses.length > 0) parts.push(`收敛孤儿分析 ${result.reclaimedAnalyses.length} 条`);
  if (result.skippedUnexecutedRuns.length > 0) {
    parts.push(`保留未执行草稿 Run ${result.skippedUnexecutedRuns.length} 个（不是在途，未回收）`);
  }
  return parts.length === 0 ? "无孤儿（未做任何写入）" : parts.join("；");
}
