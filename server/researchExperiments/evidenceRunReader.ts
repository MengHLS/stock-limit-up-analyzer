/**
 * STRATEGY-RESEARCH-BRIDGE-001 — **持久化 Run 的只读读回端口**。
 *
 * ## 为什么需要它
 *
 * 规格 §12 要求策略溯源「引用必须指向**真实存在的 Run** / Experiment Version」，并明令禁止
 * 「手写一个不存在的 Run ID / 虚构 artifact / 复制 result.json」。因此证据**不能**来自调用方自报：
 * 必须由服务端按 `runId` 从 `research_experiment_run` + 对象存储**读回**，并据此冻结事实。
 *
 * ## 它复用什么（不新建第二套）
 *
 * 真实实现只调 **既有** `ExperimentRunService`：
 *   - `getRun(runId)` —— 一条 `SELECT ... WHERE runId=?`，取实验坐标 / Dataset 坐标 / 耗时；
 *   - `readRunDetail(runId)` —— 既有「Run 元数据 + Manifest + Result」读取（Result 来自对象存储）。
 *
 * 本文件**不** import DB 驱动 / MinIO SDK / Drizzle，只依赖 `ExperimentRunService` 的接口面 ——
 * 单测可以注入与真实装配**不同**的替身，而生产链上只有一套装配。
 *
 * ## 与「实时重跑」的关系（规格 §1「不重复建设」）
 *
 * 既有的 `ExperimentRunner`（实时重跑）与本节口**并存且不互相替代**：
 *   - 实时重跑用于「**还没有**持久化 Run 时先跑一次再建策略」；
 *   - 本节口用于「**已经有**真实持久化 Run 时按 Run 建策略」—— 这正是规格 §7「使用当前
 *     **已经完成的** EXP-001 / EXP-002」所要求的形态。
 */

import type { ExperimentResultEnvelope } from "@shared/researchExperimentsContracts";
import type { ExperimentRunService } from "./persistence/runService";

/** 从持久化事实读回的一次运行（只保留「证据」需要的面）。 */
export interface PersistedEvidenceRun {
  readonly runId: string;
  /** = `research_experiment_run.experimentId`（`<group>/<key>`）。 */
  readonly experimentCode: string;
  readonly experimentVersion: string;
  readonly datasetVersionId: number | null;
  readonly datasetCode: string | null;
  readonly datasetVersionLabel: string | null;
  /** `COMPLETED` / `FAILED` / `PENDING` / `RUNNING`（如实透出，判定交给调用方）。 */
  readonly status: string;
  readonly startedAt: string | null;
  readonly durationMs: number | null;
  /** 参数快照（Run 行里「已归并默认值」的那一份）。 */
  readonly parameters: unknown;
  /** 结果信封（来自对象存储）；不可读时 `null`（**不伪造**）。 */
  readonly result: ExperimentResultEnvelope | null;
  /** 结果信封是否可读（false ⇒ `result` 必为 null，由 `resultUnavailableReason` 说明）。 */
  readonly resultAvailable: boolean;
  readonly resultUnavailableReason: string | null;
}

export interface ExperimentEvidenceRunReader {
  /** 读一条持久化 Run；**不存在** ⇒ `null`（不抛错 —— 「没找到」与「读失败」要分开）。 */
  read(runId: string): Promise<PersistedEvidenceRun | null>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 真实实现：`ExperimentRunService`（TiDB 元数据 + 对象存储结果）。
 *
 * 🔴 `readRunDetail` 在 Run 不存在时抛 `EXPERIMENT_RUN_NOT_FOUND` —— 那**不是**读失败，
 * 而是「这条 Run 不在这里」。捕获它并返回 `null`，让调用方给出**参数化**的错误
 * （「你给的 runId 指向的 Run 不存在」），而不是把领域码埋在一条 500 里。
 */
export function createPersistedEvidenceRunReader(deps: {
  readonly runService: ExperimentRunService;
}): ExperimentEvidenceRunReader {
  return {
    async read(runId: string) {
      const record = await deps.runService.getRun(runId);
      if (record === null) return null;

      let result: ExperimentResultEnvelope | null = null;
      let resultAvailable = false;
      let resultUnavailableReason: string | null = null;
      try {
        const detail = await deps.runService.readRunDetail(runId);
        result = detail.result;
        resultAvailable = detail.result !== null;
        if (detail.result === null) {
          resultUnavailableReason = detail.artifactsError === null
            ? "结果信封在对象存储中不存在（Manifest 声明的 result.json 未找到）"
            : `${detail.artifactsError.code}: ${detail.artifactsError.message}`;
        }
      } catch (error) {
        resultUnavailableReason = error instanceof Error
          ? `${(error as { code?: string }).code ?? "UNKNOWN"}: ${error.message}`
          : String(error);
      }

      return {
        runId: record.runId,
        experimentCode: record.experimentId,
        experimentVersion: record.experimentVersion,
        datasetVersionId: asNumber(record.datasetVersionId),
        datasetCode: asString(record.datasetCode),
        datasetVersionLabel: asString(record.datasetVersionLabel),
        status: record.status,
        startedAt: asString(record.startedAt),
        durationMs: asNumber(record.durationMs),
        parameters: record.parameters ?? null,
        result,
        resultAvailable,
        resultUnavailableReason,
      };
    },
  };
}
