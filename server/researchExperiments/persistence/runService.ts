/**
 * RESEARCH-EXPERIMENT-004 — Run 生命周期编排（规格 §12 / §13）。
 *
 * ## 唯一执行路径（规格 §12 的顺序**不可颠倒**）
 *
 * ```
 * ① prepare（执行前校验；不合规 ⇒ 抛领域错误，**不建任何行**）
 * ② TiDB: PENDING          （建 Run 行）
 * ③ TiDB: RUNNING          （记 startedAt）
 * ④ 执行 Experiment（runner.runDetailed）
 * ⑤ 失败 ⇒ TiDB: FAILED + errorCode/errorMessage          ← 出口 A
 * ⑥ 成功 ⇒ 生成 Result
 * ⑦       ⇒ 上传 Result / 文件产物到对象存储
 * ⑧       ⇒ 生成 manifest.json 并上传
 * ⑨       ⇒ **验证 Artifact 存在**
 * ⑩       ⇒ TiDB: 保存 resultManifestKey + COMPLETED       ← 出口 B
 * ```
 *
 * ## 三条一致性不变量（规格 §13 点名的三种坏情况）
 *
 * | 情况 | 期望 | 本文件的兑现方式 |
 * | --- | --- | --- |
 * | A：存储上传失败但 DB 说 COMPLETED | **禁止** | `COMPLETED` 只在 `publishRunArtifacts` 成功（含存在性验证）**之后**才写；任何上传/验证失败 ⇒ 走 `FAILED` |
 * | B：执行失败 ⇒ Run 永远 RUNNING | **禁止** | 执行体、落存储、写终态**每一步都在收敛分支上**；万一 DB 自身写不动，`stale` 读时标注 + `reconcileRun` 提供显式收敛入口 |
 * | C：`resultManifestKey` 指向不存在的对象 | **禁止** | 写入前 `verifyManifestArtifacts` 实测；读取时 `readRunDetail` **逐个实测**并在 `artifactsAvailable=false` 时如实报告 |
 *
 * ## 一个刻意的取舍（如实登记）
 *
 * 当**实验结果算成功、但对象存储写失败**时，本函数 **不抛错**，而是：
 *   - 把 Run 记为 `FAILED`（`errorCode = EXPERIMENT_ARTIFACT_UPLOAD_FAILED`）；
 *   - 仍然把**真实的** outcome 返回给调用方。
 *
 * 理由：抛错会让「算完的结果」直接消失，用户既看不到结果也不知道为什么；
 * 而返回 outcome + 一条 `FAILED` 的 Run，页面可以明确说
 * 「实验算完了（耗时 X ms），但结果没能写进对象存储 ⇒ 按规格不允许标记完成」。
 * **DB 侧绝不会出现 COMPLETED** —— 不变量没有被牺牲，只是把失败讲清楚了。
 */

import {
  EXPERIMENT_ARTIFACT_INLINE_PREVIEW_FORMATS,
  EXPERIMENT_ARTIFACT_INLINE_PREVIEW_MAX_BYTES,
  EXPERIMENT_RESULT_SCHEMA_VERSION,
  experimentResultEnvelopeSchema,
  type ExperimentResultEnvelope,
  type ExperimentRunDetail,
  type ExperimentRunExecutionResult,
  type ExperimentRunManifest,
  type ExperimentRunRecord,
  type ExperimentRunSummary,
} from "@shared/researchExperimentsContracts";
import type { ArtifactStorage } from "../../artifactStorage/types";
import {
  isObjectKeyUnderRun,
} from "../../artifactStorage/objectKey";
import type { ArtifactStorageError } from "../../artifactStorage/types";
import { ExperimentError, toExperimentError } from "../errors";
import type { ExperimentRunRequest, ExperimentRunner } from "../runner";
import { publishRunArtifacts, translateArtifactStorageError } from "./artifactPublisher";
import { generateExperimentRunId } from "./runId";
import { assertSafeObjectKey } from "../../artifactStorage/objectKey";
import {
  findManifestArtifact,
  manifestArtifactKeys,
  parseRunManifest,
} from "./runManifest";
import type { ExperimentRunListFilter, ExperimentRunRepository } from "./runRepository";

/** 收敛一条卡住的 Run 时写入的错误码。 */
export const EXPERIMENT_RUN_RECONCILED_CODE = "EXPERIMENT_RUN_RECONCILED";

/** Run id 冲突的最大重试次数（随机段碰撞的概率极低，但冲突必须被处理而不是抛到用户脸上）。 */
const MAX_RUN_ID_ATTEMPTS = 3;

export interface ExperimentRunServiceDeps {
  runner: ExperimentRunner;
  repository: ExperimentRunRepository;
  /**
   * 惰性解析对象存储。
   *
   * 🔴 **必须惰性**：未配置 MinIO 时，纯读列表 / 读历史 Run 仍应可用，
   *    只有真正要读写产物时才该炸。若在装配期就 eager 构造，整个实验页会因为
   *    没配 MinIO 而**整页打不开** —— 那会把「不能持久化」放大成「不能用」。
   */
  resolveStorage: () => ArtifactStorage;
  now?: () => Date;
  /** 可注入 Run id 生成器（测试用）。 */
  generateRunId?: (now: Date) => string;
}

export interface ExperimentRunService {
  execute(request: ExperimentRunRequest): Promise<ExperimentRunExecutionResult>;
  getRun(runId: string): Promise<ExperimentRunRecord | null>;
  listRuns(filter?: ExperimentRunListFilter): Promise<ExperimentRunRecord[]>;
  countRunsByExperiment(experimentId: string): Promise<number>;
  latestRunByExperiment(): Promise<Map<string, ExperimentRunRecord>>;
  /** 读一条 Run 的完整视图（元数据 + Manifest + Result + 每个 Artifact 的存在性）。 */
  readRunDetail(runId: string): Promise<ExperimentRunDetail>;
  /** 只读 Manifest（页面「查看 Manifest」用；不拉 Result）。 */
  readManifest(runId: string): Promise<ExperimentRunManifest | null>;
  /** 读一个 Artifact 的内容（**授权判据 = 该 Key 出现在该 Run 的 Manifest 里**）。 */
  readArtifact(runId: string, key: string): Promise<{ manifest: ExperimentRunManifest; key: string; body: Buffer; contentType: string | null }>;
  /** 把一条 `RUNNING` 收敛为 `FAILED`（人为判定，必须给 reason）。 */
  reconcileRun(runId: string, reason: string): Promise<ExperimentRunRecord>;
}

/** 从 outcome 抽出**轻量摘要**（进 DB；让列表页不必去对象存储拉 result.json）。 */
export function summarizeOutcome(
  outcome: ExperimentRunExecutionResult["outcome"],
  artifactCount: number,
): ExperimentRunSummary {
  const envelope = outcome.result;
  return {
    runStatus: outcome.runStatus,
    candidateCount: envelope?.sampleSummary.candidateCount ?? null,
    eligibleCount: envelope?.sampleSummary.eligibleCount ?? null,
    excludedCount: envelope?.sampleSummary.excludedCount ?? null,
    excludedByReason: envelope?.sampleSummary.excludedByReason ?? null,
    prefixRowCount: outcome.execution.datasetFacts.prefixRowCount,
    postRowCount: outcome.execution.datasetFacts.postRowCount,
    forwardDataRead: outcome.execution.datasetFacts.forwardDataRead,
    logLineCount: outcome.execution.logs.length,
    artifactCount,
  };
}

export function createExperimentRunService(deps: ExperimentRunServiceDeps): ExperimentRunService {
  const { runner, repository } = deps;
  const now = deps.now ?? (() => new Date());
  const makeRunId = deps.generateRunId ?? ((at: Date) => generateExperimentRunId(at));

  function storageErrorDetail(error: unknown): { code: string; message: string } {
    const translated = translateArtifactStorageError(error);
    return { code: translated.code, message: translated.message };
  }

  /** 读 Manifest（必要时抛领域错误）。 */
  async function requireManifest(record: ExperimentRunRecord): Promise<ExperimentRunManifest> {
    if (record.resultManifestKey === null) {
      throw new ExperimentError(
        "EXPERIMENT_MANIFEST_INVALID",
        `Run "${record.runId}"（status=${record.status}）没有 Manifest 引用 —— ` +
          `${record.status === "COMPLETED" ? "COMPLETED 却没有 Manifest 是**数据完整性错误**" : "该 Run 未产出 Manifest"}`,
        { runId: record.runId, status: record.status },
      );
    }
    let text: string;
    try {
      const got = await deps.resolveStorage().get(record.resultManifestKey);
      text = got.body.toString("utf8");
    } catch (error) {
      throw translateArtifactStorageError(error);
    }
    return parseRunManifest(text, {
      experimentId: record.experimentId,
      runId: record.runId,
      datasetVersionId: record.datasetVersionId,
    });
  }

  async function execute(request: ExperimentRunRequest): Promise<ExperimentRunExecutionResult> {
    // ① 执行前校验：不合规 ⇒ 抛领域错误，**不留任何行**（规格 §12 前置）
    const prepared = await runner.prepare(request);

    // ② 建 PENDING 行（runId 冲突则换一个再试）
    const at = now();
    let record: ExperimentRunRecord | null = null;
    let lastConflict: unknown = null;
    for (let attempt = 0; attempt < MAX_RUN_ID_ATTEMPTS && record === null; attempt += 1) {
      const runId = makeRunId(at);
      try {
        record = await repository.createRun({
          runId,
          experimentId: prepared.descriptor.id,
          experimentName: prepared.descriptor.name,
          experimentVersion: prepared.descriptor.version,
          datasetVersionId: prepared.facts.datasetVersionId,
          datasetCode: prepared.facts.datasetCode,
          datasetVersionLabel: prepared.facts.datasetVersionLabel,
          parameters: prepared.resolvedParameters,
          createdAt: at.toISOString(),
        });
      } catch (error) {
        if (error instanceof ExperimentError && error.code === "EXPERIMENT_RUN_ID_CONFLICT") {
          lastConflict = error;
          continue;
        }
        throw error;
      }
    }
    if (record === null) {
      throw new ExperimentError(
        "EXPERIMENT_RUN_ID_CONFLICT",
        `连续 ${MAX_RUN_ID_ATTEMPTS} 次生成的 Run id 都冲突，无法为实验 "${prepared.descriptor.id}" 建 Run`,
        { cause: lastConflict instanceof Error ? lastConflict.message : String(lastConflict) },
      );
    }
    const runId = record.runId;

    // ③ PENDING → RUNNING
    await repository.markRunning(runId, at.toISOString());

    // ④ 执行
    let detailed: Awaited<ReturnType<ExperimentRunner["runDetailed"]>>;
    try {
      detailed = await runner.runDetailed(request);
    } catch (error) {
      // 极窄的路径：prepare 已通过，但执行体内部再 prepare 时环境变了。
      // 无论原因，**必须收敛**（否则就是规格 §13 情况 B）。
      const failure = toExperimentError(error);
      await repository.markFailed(runId, {
        errorCode: failure.code,
        errorMessage: failure.message,
        durationMs: null,
        completedAt: now().toISOString(),
      });
      throw new ExperimentError(
        failure.code,
        `${failure.message}（本次 Run ${runId} 已记为 FAILED —— 不留 RUNNING 悬挂行）`,
        { ...(typeof failure.detail === "object" && failure.detail !== null ? (failure.detail as object) : {}), runId },
      );
    }

    const { outcome, artifactFiles } = detailed;
    const completedAt = outcome.execution.finishedAt;
    const durationMs = outcome.execution.durationMs;

    // ⑤ 出口 A：执行期失败
    if (outcome.runStatus === "FAILED") {
      const failure = outcome.error;
      const failed = await repository.markFailed(runId, {
        errorCode: failure?.code ?? "EXPERIMENT_RUN_FAILED",
        errorMessage: failure?.message ?? "实验执行失败（Runner 未提供错误信息）",
        durationMs,
        completedAt,
      });
      return { persisted: true, run: failed, outcome };
    }

    // ⑥⑦⑧⑨ 落对象存储 + 生成并验证 Manifest
    let published: Awaited<ReturnType<typeof publishRunArtifacts>>;
    try {
      published = await publishRunArtifacts({
        storage: deps.resolveStorage(),
        experimentId: prepared.descriptor.id,
        experimentVersion: prepared.descriptor.version,
        runId,
        datasetVersionId: prepared.facts.datasetVersionId,
        createdAt: completedAt,
        result: outcome.result,
        logs: outcome.execution.logs,
        artifactFiles,
      });
    } catch (error) {
      // 🔴 规格 §13 情况 A 的守门点：产物没落成功 ⇒ **绝不** COMPLETED。
      const failure = toExperimentError(error);
      const failed = await repository.markFailed(runId, {
        errorCode: failure.code,
        errorMessage:
          `实验已执行完成（耗时 ${durationMs} ms），但结果写入对象存储失败 ⇒ ` +
          `按规格不允许标记 COMPLETED，本 Run 记为 FAILED：${failure.message}`,
        durationMs,
        completedAt,
      });
      return { persisted: true, run: failed, outcome };
    }

    // ⑩ 出口 B：写 Manifest 引用 + COMPLETED
    const completed = await repository.markCompleted(runId, {
      manifestKey: published.manifestKey,
      resultSchemaVersion: EXPERIMENT_RESULT_SCHEMA_VERSION,
      summary: summarizeOutcome(outcome, published.keys.length),
      durationMs,
      completedAt,
    });
    return { persisted: true, run: completed, outcome };
  }

  async function readRunDetail(runId: string): Promise<ExperimentRunDetail> {
    const record = await repository.getRun(runId);
    if (record === null) {
      throw new ExperimentError("EXPERIMENT_RUN_NOT_FOUND", `Run "${runId}" 不存在`, { runId });
    }

    // 没有 Manifest 引用：正常的「未产出」状态（PENDING / RUNNING / FAILED），
    // 但 `COMPLETED` 却没有引用 = 数据完整性错误，必须响亮说出来。
    if (record.resultManifestKey === null) {
      const integrityBroken = record.status === "COMPLETED";
      return {
        run: record,
        manifest: null,
        result: null,
        artifacts: [],
        artifactsAvailable: !integrityBroken,
        artifactsError: integrityBroken
          ? {
              code: "EXPERIMENT_MANIFEST_INVALID",
              message:
                `Run "${runId}" 状态为 COMPLETED 却没有 resultManifestKey —— ` +
                `这是数据完整性错误（规格 §13 情况 C 的形态），请勿信任该 Run 的产物`,
            }
          : null,
      };
    }

    let manifest: ExperimentRunManifest;
    try {
      manifest = await requireManifest(record);
    } catch (error) {
      const failure = error instanceof ExperimentError ? error : translateArtifactStorageError(error);
      return {
        run: record,
        manifest: null,
        result: null,
        artifacts: [],
        artifactsAvailable: false,
        artifactsError: { code: failure.code, message: failure.message },
      };
    }

    const storage = deps.resolveStorage();
    let resultEnvelope: ExperimentResultEnvelope | null = null;
    const artifacts: ExperimentRunDetail["artifacts"] = [];
    let resultProblem: { code: string; message: string } | null = null;

    // Result：Manifest 里的 result 引用（读 + 校验；坏掉不影响 Manifest 与其它产物展示）
    if (manifest.result !== null) {
      try {
        const got = await storage.get(manifest.result.key);
        const parsed = experimentResultEnvelopeSchema.safeParse(JSON.parse(got.body.toString("utf8")));
        if (parsed.success) {
          resultEnvelope = parsed.data;
        } else {
          resultProblem = {
            code: "EXPERIMENT_RESULT_INVALID",
            message: `result.json 不符合结果信封契约：${parsed.error.issues
              .slice(0, 3)
              .map((issue) => `${issue.path.join(".")} ${issue.message}`)
              .join("；")}`,
          };
        }
      } catch (error) {
        resultProblem = storageErrorDetail(error);
      }
    }

    // 每个产物：**读时实测存在性**（规格 §13 情况 C 的检测点）
    const refs = [
      ...(manifest.result === null ? [] : [manifest.result]),
      ...manifest.tables,
      ...manifest.charts,
      ...manifest.artifacts,
    ];
    for (const ref of refs) {
      let present = false;
      let sizeBytes: number | null = null;
      let contentType: string | null = null;
      let lastModified: string | null = null;
      let etag: string | null = null;
      try {
        const metadata = await storage.getMetadata(ref.key);
        if (metadata !== null) {
          present = true;
          sizeBytes = metadata.sizeBytes;
          contentType = metadata.contentType;
          lastModified = metadata.lastModified;
          etag = metadata.etag;
        }
      } catch (error) {
        const detail = storageErrorDetail(error);
        resultProblem ??= detail;
      }
      artifacts.push({
        ref,
        present,
        sizeBytes,
        contentType,
        lastModified,
        etag,
        inlineViewable: present && isInlineViewable(ref.format, sizeBytes),
      });
    }

    const missing = artifacts.filter((item) => !item.present).map((item) => item.ref.key);
    return {
      run: record,
      manifest,
      result: resultEnvelope,
      artifacts,
      // 存储可读但个别对象缺失 ⇒ 仍是「可读」，但把缺失如实报告出来。
      artifactsAvailable: true,
      artifactsError:
        resultProblem ??
        (missing.length > 0
          ? {
              code: "EXPERIMENT_ARTIFACT_NOT_FOUND",
              message: `Manifest 指向的 ${missing.length} 个对象在存储里不存在：${missing.slice(0, 5).join(", ")}`,
            }
          : null),
    };
  }

  async function readArtifact(
    runId: string,
    key: string,
  ): Promise<{ manifest: ExperimentRunManifest; key: string; body: Buffer; contentType: string | null }> {
    const record = await repository.getRun(runId);
    if (record === null) {
      throw new ExperimentError("EXPERIMENT_RUN_NOT_FOUND", `Run "${runId}" 不存在`, { runId });
    }
    const safeKey = assertSafeObjectKey(key);
    const manifest = await requireManifest(record);

    // 🔴 授权判据（两道）：
    //    ① 结构闸：Key 必须落在本 Run 的前缀下（挡穿越到别的 Run）；
    //    ② Manifest 闸：Key 必须出现在该 Run 的 Manifest 里（挡越权读任意对象）。
    if (!isObjectKeyUnderRun(safeKey, record.experimentId, record.runId)) {
      throw new ExperimentError(
        "EXPERIMENT_ARTIFACT_KEY_INVALID",
        `对象 Key "${safeKey}" 不属于 Run "${runId}" 的前缀（拒绝跨 Run 读取）`,
        { runId, key: safeKey },
      );
    }
    const ref = findManifestArtifact(manifest, safeKey);
    if (ref === null) {
      throw new ExperimentError(
        "EXPERIMENT_ARTIFACT_NOT_FOUND",
        `对象 "${safeKey}" 不在 Run "${runId}" 的 Manifest 索引里（只有 Manifest 登记的产物可读）`,
        { runId, key: safeKey, indexed: [...manifestArtifactKeys(manifest)].length },
      );
    }

    const got = await deps.resolveStorage().get(safeKey);
    return { manifest, key: safeKey, body: got.body, contentType: got.metadata.contentType };
  }

  async function reconcileRun(runId: string, reason: string): Promise<ExperimentRunRecord> {
    const record = await repository.getRun(runId);
    if (record === null) {
      throw new ExperimentError("EXPERIMENT_RUN_NOT_FOUND", `Run "${runId}" 不存在`, { runId });
    }
    if (record.status !== "RUNNING") {
      throw new ExperimentError(
        "EXPERIMENT_RUN_STATE_INVALID",
        `只有 RUNNING 的 Run 需要收敛，Run "${runId}" 当前是 ${record.status}`,
        { runId, status: record.status },
      );
    }
    return repository.markFailed(runId, {
      errorCode: EXPERIMENT_RUN_RECONCILED_CODE,
      errorMessage: `人工收敛：${reason}`,
      durationMs: null,
      completedAt: now().toISOString(),
    });
  }

  return {
    execute,
    getRun: (runId) => repository.getRun(runId),
    listRuns: (filter) => repository.listRuns(filter),
    countRunsByExperiment: (experimentId) => repository.countRunsByExperiment(experimentId),
    latestRunByExperiment: () => repository.latestRunByExperiment(),
    readRunDetail,
    readManifest: async (runId) => {
      const record = await repository.getRun(runId);
      if (record === null) {
        throw new ExperimentError("EXPERIMENT_RUN_NOT_FOUND", `Run "${runId}" 不存在`, { runId });
      }
      if (record.resultManifestKey === null) return null;
      return requireManifest(record);
    },
    readArtifact,
    reconcileRun,
  };
}

/**
 * 小体积文本形态可由后端内联预览（大文件一律只给下载 —— 规格 §17）。
 *
 * 🔴 判据常量放在 `@shared/researchExperimentsContracts`：前端必须用**同一份**判据，
 *    否则会出现「服务端说不给预览、前端却给」这种同名不同义。
 */
export function isInlineViewable(format: string, sizeBytes: number | null): boolean {
  if (sizeBytes === null) return false;
  if (sizeBytes > EXPERIMENT_ARTIFACT_INLINE_PREVIEW_MAX_BYTES) return false;
  return (EXPERIMENT_ARTIFACT_INLINE_PREVIEW_FORMATS as readonly string[]).includes(
    format.toLowerCase(),
  );
}

/** 内联预览的体积上限（256 KiB）：超过就只给下载入口。 */
export const INLINE_VIEW_MAX_BYTES = EXPERIMENT_ARTIFACT_INLINE_PREVIEW_MAX_BYTES;

/** 便于测试注入的宽松类型别名（避免测试里 import 具体 S3 错误类）。 */
export type { ArtifactStorage, ArtifactStorageError };
