/**
 * LOCAL-DATASET-SNAPSHOT — 本地快照下载代理路由（开发态）。
 *
 * `GET /api/datasets/:datasetVersionId/snapshot` 流式返回固定的
 * `dataset-<id>.sqlite` 文件（另附 manifest 摘要响应头）。
 *
 * ## 为什么不是 tRPC 端点
 *
 * 快照是完整 SQLite 文件（可达数百 MB）。tRPC 走 superjson 序列化，把二进制塞进去要
 * base64（体积 +33%）且整块驻留内存 ⇒ 用 Express 的 `createReadStream` 最直接。
 *
 * ## 安全模型
 *
 *   1. **生产环境 404**：仅在 `NODE_ENV=development` 暴露，避免把本地加速产物带上线；
 *   2. **固定文件名**：只读 `<DATASET_SNAPSHOT_DIR>/<id>/dataset.sqlite`，不接受任何
 *      调用方给出的路径 / 文件名（无目录穿越面）；
 *   3. **先校验再流式**：只有 `store.inspect` 完整通过（manifest + 版本 + schema +
 *      checksum + count）才开流；校验失败返回 4xx/5xx，不吐半个字节。
 *
 * 必须在 Vite / 静态资源中间件**之前**注册（与 `/api/experiments/artifact` 同理），
 * 否则开发模式下会被 Vite 的 HTML fallback 吃掉。
 */

import { createReadStream } from "node:fs";
import type { Express, Request, Response } from "express";
import {
  defaultDatasetMetadataReader,
  defaultDatasetSnapshotStore,
  type DatasetMetadataReader,
} from "./datasetRegistry/snapshot/contentDependencies";
import type { DatasetSnapshotStore } from "./datasetRegistry/snapshot";
import { DatasetSnapshotError } from "./datasetRegistry/snapshot/errors";

export interface DatasetSnapshotRouteDeps {
  store?: DatasetSnapshotStore;
  metadataReader?: DatasetMetadataReader;
}

/** 生产环境一律 404（不暴露存在性）。 */
function snapshotRoutesEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

function parseDatasetVersionId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** 把快照错误码映射到稳定的 HTTP 状态（不静默回退 DB）。 */
function httpStatusFor(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof DatasetSnapshotError) {
    switch (error.code) {
      case "SNAPSHOT_NOT_FOUND":
      case "SNAPSHOT_NOT_SUPPORTED":
        return { status: 404, code: error.code, message: error.message };
      case "SNAPSHOT_INVALID":
      case "SNAPSHOT_MANIFEST_INVALID":
      case "SNAPSHOT_SCHEMA_INVALID":
      case "SNAPSHOT_CHECKSUM_MISMATCH":
      case "SNAPSHOT_COUNT_MISMATCH":
      case "SNAPSHOT_VERSION_MISMATCH":
      case "SNAPSHOT_IDENTITY_MISSING":
        return { status: 409, code: error.code, message: error.message };
      default:
        return { status: 500, code: error.code, message: error.message };
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, code: "SNAPSHOT_UNKNOWN_ERROR", message };
}

export function registerDatasetSnapshotRoutes(
  app: Express,
  deps: DatasetSnapshotRouteDeps = {},
): void {
  const store = deps.store ?? defaultDatasetSnapshotStore();
  const metadataReader = deps.metadataReader ?? defaultDatasetMetadataReader();

  app.get(
    "/api/datasets/:datasetVersionId/snapshot",
    async (req: Request, res: Response) => {
      if (!snapshotRoutesEnabled()) {
        res.status(404).json({ code: "SNAPSHOT_DISABLED", message: "本地快照仅在开发环境可用。" });
        return;
      }
      const datasetVersionId = parseDatasetVersionId(req.params.datasetVersionId ?? "");
      if (datasetVersionId === null) {
        res.status(400).json({
          code: "SNAPSHOT_VERSION_ID_INVALID",
          message: "datasetVersionId 必须是正整数。",
        });
        return;
      }

      try {
        const version = await metadataReader.getVersionById(datasetVersionId);
        if (!version) {
          res.status(404).json({
            code: "SNAPSHOT_VERSION_NOT_FOUND",
            message: `未找到 dataset_version.id=${datasetVersionId}。`,
          });
          return;
        }
        const definition = await metadataReader.getDefinitionById(version.datasetId);
        if (!definition || version.status !== "READY" || definition.datasetCode !== "first_limit_pullback") {
          res.status(404).json({
            code: "SNAPSHOT_NOT_SUPPORTED",
            message: `dataset_version.id=${datasetVersionId} 不支持本地快照（需 READY + first_limit_pullback）。`,
          });
          return;
        }
        const snapshot = await store.inspect(datasetVersionId, { version, definition });
        if (!snapshot) {
          res.status(404).json({
            code: "SNAPSHOT_NOT_FOUND",
            message: `dataset_version.id=${datasetVersionId} 尚无本地快照；请先生成。`,
          });
          return;
        }

        const fileName = `dataset-${datasetVersionId}.sqlite`;
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", String(snapshot.manifest.sqlite.size));
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("X-Dataset-Snapshot-Sha256", snapshot.manifest.sqlite.sha256);
        res.setHeader("X-Dataset-Snapshot-Format-Version", String(snapshot.manifest.formatVersion));
        // 快照对应不可变版本，文件内容不随后续操作变化 ⇒ 可私有缓存。
        res.setHeader("Cache-Control", "private, max-age=60");

        const stream = createReadStream(snapshot.sqlitePath);
        let finished = false;
        stream.on("error", (error) => {
          if (finished) return;
          finished = true;
          console.warn(
            `[DatasetSnapshot] 下载流失败 id=${datasetVersionId}: ${error.message}`,
          );
          if (!res.headersSent) {
            res.status(500).json({ code: "SNAPSHOT_STREAM_FAILED", message: error.message });
          } else {
            res.destroy(error);
          }
        });
        stream.on("end", () => {
          finished = true;
        });
        // 客户端中断：销毁读流，避免句柄泄漏（不写日志噪声）。
        res.on("close", () => {
          if (!finished) stream.destroy();
        });
        stream.pipe(res);
      } catch (error) {
        const mapped = httpStatusFor(error);
        console.warn(
          `[DatasetSnapshot] 下载失败 id=${datasetVersionId} code=${mapped.code}: ${mapped.message}`,
        );
        if (!res.headersSent) {
          res.status(mapped.status).json({ code: mapped.code, message: mapped.message });
        } else {
          res.destroy(error instanceof Error ? error : undefined);
        }
      }
    },
  );
}
