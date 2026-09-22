/**
 * RESEARCH-EXPERIMENT-004 — Artifact 发布器（Result → 对象存储 → Manifest）。
 *
 * ## 顺序（规格 §12 的中间四步）
 *
 * ```
 * 生成 Result
 *    ↓ ① 写 result.json（若有结果）
 *    ↓ ② 写实验声明的文件产物（tables/ charts/ logs/ artifacts/）
 *    ↓ ③ 生成并写 manifest.json
 *    ↓ ④ **验证 Artifact 存在**（真去存储 HEAD 一遍）
 * ```
 *
 * 只有 ④ 通过，调用方（`runService`）才允许把 Run 置为 `COMPLETED`（规格 §13 情况 A）。
 *
 * ## 存储错误 → 领域错误（**翻译表只有这一处**）
 *
 * | 存储层 | 领域层 |
 * | --- | --- |
 * | `NOT_CONFIGURED` / `UNAVAILABLE` | `EXPERIMENT_ARTIFACT_STORAGE_UNAVAILABLE` |
 * | `PUT_FAILED` | `EXPERIMENT_ARTIFACT_UPLOAD_FAILED` |
 * | `NOT_FOUND` | `EXPERIMENT_ARTIFACT_NOT_FOUND` |
 * | `KEY_INVALID` | `EXPERIMENT_ARTIFACT_KEY_INVALID` |
 *
 * 集中翻译的意义：页面永远只会看到**实验领域码**，不需要懂 S3 的错误方言。
 */

import type {
  ExperimentArtifactFileSpec,
  ExperimentArtifactRef,
  ExperimentResultEnvelope,
  ExperimentRunManifest,
} from "@shared/researchExperimentsContracts";
import {
  EXPERIMENT_ARTIFACT_MAX_COUNT,
  EXPERIMENT_ARTIFACT_MAX_SINGLE_BYTES,
  EXPERIMENT_ARTIFACT_MAX_TOTAL_BYTES,
  EXPERIMENT_RESULT_JSON_MAX_BYTES,
  EXPERIMENT_RESULT_TABLE_MAX_CELLS,
  EXPERIMENT_RESULT_TABLE_MAX_ROWS,
} from "@shared/researchExperimentsContracts";
import { ARTIFACT_STORAGE_ERROR, ArtifactStorageError, type ArtifactStorage } from "../../artifactStorage/types";
import {
  logObjectKey,
  manifestObjectKey,
  resultObjectKey,
  roleObjectKey,
} from "../../artifactStorage/objectKey";
import { ExperimentError } from "../errors";
import {
  artifactRefFromMetadata,
  buildRunManifest,
  inferArtifactDescriptor,
  validateRunManifest,
  verifyManifestArtifacts,
  type ManifestVerificationResult,
} from "./runManifest";

/** 默认日志对象名（实验没有额外声明 log 产物时的固定落点）。 */
export const DEFAULT_RUN_LOG_NAME = "run.log";

/** 存储层错误 → 实验领域错误。 */
export function translateArtifactStorageError(error: unknown): ExperimentError {
  if (error instanceof ExperimentError) return error;
  if (error instanceof ArtifactStorageError) {
    switch (error.code) {
      case ARTIFACT_STORAGE_ERROR.NOT_CONFIGURED:
      case ARTIFACT_STORAGE_ERROR.UNAVAILABLE:
        return new ExperimentError("EXPERIMENT_ARTIFACT_STORAGE_UNAVAILABLE", error.message, error.detail);
      case ARTIFACT_STORAGE_ERROR.NOT_FOUND:
        return new ExperimentError("EXPERIMENT_ARTIFACT_NOT_FOUND", error.message, error.detail);
      case ARTIFACT_STORAGE_ERROR.KEY_INVALID:
        return new ExperimentError("EXPERIMENT_ARTIFACT_KEY_INVALID", error.message, error.detail);
      case ARTIFACT_STORAGE_ERROR.PUT_FAILED:
      case ARTIFACT_STORAGE_ERROR.GET_FAILED:
        return new ExperimentError("EXPERIMENT_ARTIFACT_UPLOAD_FAILED", error.message, error.detail);
      default:
        return new ExperimentError("EXPERIMENT_ARTIFACT_STORAGE_UNAVAILABLE", error.message, error.detail);
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ExperimentError("EXPERIMENT_ARTIFACT_UPLOAD_FAILED", message);
}

export interface PublishRunArtifactsInput {
  storage: ArtifactStorage;
  experimentId: string;
  experimentVersion: string;
  experimentCodeDigest: string;
  runId: string;
  datasetVersionId: number;
  /** Manifest 的 `createdAt`（ISO）。 */
  createdAt: string;
  /** 结果信封；`null` = 本次没有结果（正常路径下成功 Run 应当有）。 */
  result: ExperimentResultEnvelope | null;
  /** 实验写的运行日志（会落 `logs/run.log`）。 */
  logs: readonly string[];
  /** 实验声明的文件产物。 */
  artifactFiles: readonly ExperimentArtifactFileSpec[];
  /** 测试 / 维护可注入较严的上限；生产缺省使用 shared 契约常量。 */
  limits?: Partial<ExperimentPublishLimits>;
}

export interface ExperimentPublishLimits {
  resultJsonMaxBytes: number;
  resultTableMaxRows: number;
  resultTableMaxCells: number;
  artifactMaxCount: number;
  artifactMaxSingleBytes: number;
  artifactMaxTotalBytes: number;
}

export const DEFAULT_EXPERIMENT_PUBLISH_LIMITS: ExperimentPublishLimits = Object.freeze({
  resultJsonMaxBytes: EXPERIMENT_RESULT_JSON_MAX_BYTES,
  resultTableMaxRows: EXPERIMENT_RESULT_TABLE_MAX_ROWS,
  resultTableMaxCells: EXPERIMENT_RESULT_TABLE_MAX_CELLS,
  artifactMaxCount: EXPERIMENT_ARTIFACT_MAX_COUNT,
  artifactMaxSingleBytes: EXPERIMENT_ARTIFACT_MAX_SINGLE_BYTES,
  artifactMaxTotalBytes: EXPERIMENT_ARTIFACT_MAX_TOTAL_BYTES,
});

export interface PublishRunArtifactsResult {
  manifest: ExperimentRunManifest;
  manifestKey: string;
  resultKey: string | null;
  /** 本次写出的**全部** Object Key（含 manifest 自身），顺序 = 写入顺序。 */
  keys: string[];
  verification: ManifestVerificationResult;
  totalBytes: number;
}

/**
 * 发布一个 Run 的全部产物，并返回 Manifest 与存在性验证结果。
 *
 * 🔴 本函数**不判断 Run 状态、不写数据库** —— 它只负责「把东西放对位置并核对」。
 *    状态迁移在 `runRepository`（唯一权威），编排在 `runService`。
 */
export async function publishRunArtifacts(
  input: PublishRunArtifactsInput,
): Promise<PublishRunArtifactsResult> {
  const { storage } = input;
  const resultBody = input.result === null ? null : `${JSON.stringify(input.result, null, 2)}\n`;
  const limits: ExperimentPublishLimits = {
    ...DEFAULT_EXPERIMENT_PUBLISH_LIMITS,
    ...input.limits,
  };
  validatePublishLimits(input, resultBody, limits);
  const keys: string[] = [];
  let totalBytes = 0;
  // Key → 已写入的索引项：重复 Key 是**作者写错**，直接拒绝（不静默覆盖）。
  const written = new Map<string, ExperimentArtifactRef>();

  /** 写一个对象并登记索引项；Key 冲突即抛。 */
  const write = async (args: {
    key: string;
    body: string | Uint8Array;
    kind: ExperimentArtifactRef["kind"];
    format: string;
    label: string;
    description?: string | null;
    contentType: string;
  }): Promise<ExperimentArtifactRef> => {
    if (written.has(args.key)) {
      throw new ExperimentError(
        "EXPERIMENT_MANIFEST_INVALID",
        `Run "${input.runId}" 有两个产物落到了同一个 Object Key："${args.key}"` +
          `（同一个 Key 只能有一个产物 —— 否则 Manifest 索引无法指向确定的对象）`,
        { key: args.key },
      );
    }
    const put = await storage.put(args.key, args.body, { contentType: args.contentType });
    const ref = artifactRefFromMetadata({
      key: args.key,
      kind: args.kind,
      format: args.format,
      label: args.label,
      description: args.description ?? null,
      metadata: put.metadata,
      createdAt: input.createdAt,
    });
    written.set(args.key, ref);
    keys.push(args.key);
    totalBytes += ref.sizeBytes;
    return ref;
  };

  try {
    // ① result.json
    let resultRef: ExperimentArtifactRef | null = null;
    if (input.result !== null) {
      resultRef = await write({
        key: resultObjectKey(input.experimentId, input.runId),
        body: resultBody!,
        kind: "RESULT",
        format: "json",
        label: "结果信封（result.json）",
        description: "本次 Run 的完整结果（通用信封 + 实验自有结构）",
        contentType: "application/json; charset=utf-8",
      });
    }

    // ② 实验声明的文件产物
    const declared: ExperimentArtifactRef[] = [];
    for (const spec of input.artifactFiles) {
      const descriptor = inferArtifactDescriptor(spec.role, spec.name);
      declared.push(
        await write({
          key: roleObjectKey(input.experimentId, input.runId, roleForSpec(spec), spec.name),
          body: spec.body,
          kind: descriptor.kind,
          format: descriptor.format,
          label: spec.label ?? spec.name,
          description: spec.description ?? null,
          contentType: spec.contentType ?? descriptor.contentType,
        }),
      );
    }

    // ③ 运行日志（恒写一份；失败 Run 不走本函数，所以这里一定是成功 Run）
    const logRef = await write({
      key: logObjectKey(input.experimentId, input.runId, DEFAULT_RUN_LOG_NAME),
      body: input.logs.length === 0 ? "" : `${input.logs.join("\n")}\n`,
      kind: "LOG",
      format: "text",
      label: "运行日志（run.log）",
      description: "实验自己写的运行日志（有界，最多 200 行）",
      contentType: "text/plain; charset=utf-8",
    });

    // ④ Manifest
    const manifest = buildRunManifest({
      experimentId: input.experimentId,
      experimentVersion: input.experimentVersion,
      experimentCodeDigest: input.experimentCodeDigest,
      runId: input.runId,
      datasetVersionId: input.datasetVersionId,
      createdAt: input.createdAt,
      result: resultRef,
      // 角色分层：table → tables 段、chart → charts 段、log/artifact → artifacts 段。
      tables: declared.filter((ref) => ref.kind === "CSV" || ref.kind === "PARQUET" || ref.kind === "TABLE"),
      charts: declared.filter((ref) => ref.kind === "CHART"),
      artifacts: [...declared.filter((ref) => ref.kind === "OTHER" || ref.kind === "IMAGE" || ref.kind === "LOG"), logRef],
    });
    // 自洽校验（坐标必须就是这条 Run）—— 在写出去之前先拦一次。
    validateRunManifest(manifest, {
      experimentId: input.experimentId,
      runId: input.runId,
      datasetVersionId: input.datasetVersionId,
    });

    const manifestKey = manifestObjectKey(input.experimentId, input.runId);
    await storage.put(manifestKey, `${JSON.stringify(manifest, null, 2)}\n`, {
      contentType: "application/json; charset=utf-8",
    });
    keys.push(manifestKey);

    // ⑤ 验证：真去存储 HEAD 一遍（规格 §12 / §13 情况 C）
    const verification = await verifyManifestArtifacts(storage, manifest);
    if (!verification.verified) {
      throw new ExperimentError(
        "EXPERIMENT_ARTIFACT_UPLOAD_FAILED",
        `Run "${input.runId}" 的产物校验失败：Manifest 里 ${verification.missing.length} 个对象在上传后**读不到**` +
          `（缺失：${verification.missing.slice(0, 5).join(", ")}${verification.missing.length > 5 ? " …" : ""}）` +
          `—— 因此**不允许**把 Run 标为 COMPLETED`,
        { missing: verification.missing, manifestKey },
      );
    }

    return { manifest, manifestKey, resultKey: resultRef?.key ?? null, keys, verification, totalBytes };
  } catch (error) {
    const cleanupFailures: string[] = [];
    for (const key of [...keys].reverse()) {
      try {
        await storage.delete(key);
      } catch (cleanupError) {
        cleanupFailures.push(
          `${key}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
      }
    }
    if (cleanupFailures.length > 0 && error instanceof ExperimentError) {
      const detail =
        typeof error.detail === "object" && error.detail !== null
          ? { ...(error.detail as Record<string, unknown>), cleanupFailures }
          : { cause: error.detail, cleanupFailures };
      throw new ExperimentError(error.code, error.message, detail);
    }
    throw translateArtifactStorageError(error);
  }
}

function bodyByteLength(body: string | Uint8Array): number {
  return typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.byteLength;
}

export function validatePublishLimits(
  input: PublishRunArtifactsInput,
  resultBody: string | null,
  limits: ExperimentPublishLimits,
): void {
  const resultBytes = resultBody === null ? 0 : bodyByteLength(resultBody);
  if (resultBytes > limits.resultJsonMaxBytes) {
    throw new ExperimentError(
      "EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED",
      `result.json 体积 ${resultBytes} B 超过上限 ${limits.resultJsonMaxBytes} B；` +
        `明细数据必须通过 context.artifact 输出，禁止塞进结果信封`,
      { resultBytes, max: limits.resultJsonMaxBytes },
    );
  }

  for (const table of input.result?.tables ?? []) {
    const rows = table.rows.length;
    const columns = table.columns.length;
    const cells = rows * columns;
    if (rows > limits.resultTableMaxRows || cells > limits.resultTableMaxCells) {
      throw new ExperimentError(
        "EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED",
        `结果表 "${table.key}" 资源超限：${rows} 行 × ${columns} 列 = ${cells} 单元格` +
          `（上限 ${limits.resultTableMaxRows} 行 / ${limits.resultTableMaxCells} 单元格）`,
        { tableKey: table.key, rows, columns, cells },
      );
    }
  }

  const declaredCount = input.artifactFiles.length + (input.result === null ? 0 : 1) + 2;
  if (declaredCount > limits.artifactMaxCount) {
    throw new ExperimentError(
      "EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED",
      `本次 Run 预计写出 ${declaredCount} 个对象，超过上限 ${limits.artifactMaxCount}`,
      { count: declaredCount, max: limits.artifactMaxCount },
    );
  }

  let totalBytes = resultBytes + bodyByteLength(input.logs.join("\n") + (input.logs.length > 0 ? "\n" : ""));
  for (const spec of input.artifactFiles) {
    const bytes = bodyByteLength(spec.body);
    if (bytes > limits.artifactMaxSingleBytes) {
      throw new ExperimentError(
        "EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED",
        `产物 "${spec.name}" 体积 ${bytes} B 超过单文件上限 ${limits.artifactMaxSingleBytes} B`,
        { name: spec.name, bytes, max: limits.artifactMaxSingleBytes },
      );
    }
    totalBytes += bytes;
  }
  if (totalBytes > limits.artifactMaxTotalBytes) {
    throw new ExperimentError(
      "EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED",
      `本次 Run 产物总量 ${totalBytes} B 超过上限 ${limits.artifactMaxTotalBytes} B`,
      { totalBytes, max: limits.artifactMaxTotalBytes },
    );
  }
}

/** 文件规格 → 角色段（`log` 段与 `artifact` 段分开，便于前端分组显示）。 */
function roleForSpec(
  spec: ExperimentArtifactFileSpec,
): "tables" | "charts" | "logs" | "artifacts" {
  switch (spec.role) {
    case "table":
      return "tables";
    case "chart":
      return "charts";
    case "log":
      return "logs";
    default:
      return "artifacts";
  }
}
