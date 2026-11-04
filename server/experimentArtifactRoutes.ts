/**
 * RESEARCH-EXPERIMENT-004 — Artifact 内容代理路由（规格 §17 / §18）。
 *
 * ## 为什么不是 tRPC 端点
 *
 * 产物可能是几十 MB 的 Parquet。tRPC 走 superjson 序列化，把二进制塞进去要 base64
 * （体积 +33%）且整块驻留内存 ⇒ 用 Express 的流式响应最直接，也不必为「下载」
 * 引入任何新依赖。
 *
 * ## 安全模型（规格 §18）
 *
 * ```
 * Browser → GET /api/experiments/artifact?runId=…&key=…
 *         → 应用（校验 Key 属于该 Run 的 Manifest）
 *         → 对象存储（凭据只在服务端）
 *         → 字节流回浏览器
 * ```
 *
 * 🔴 三条：
 *   1. **凭据绝不下发**：响应里只有产物字节与 Content-Type，没有 endpoint / accessKey；
 *   2. **授权判据 = Manifest 白名单**（`runService.readArtifact` 内实现）：
 *      任意对象读取在结构上不成立 —— 未登记进 Manifest 的 Key 一律 404；
 *   3. **不暴露桶的存在性**：读不到就 404，不回显「桶里有别的东西」。
 *
 * ## 只读
 *
 * 本路由**没有任何写口**（DELETE / PUT 都不注册）—— 产物一旦写出即冻结。
 */

import type { Express, Request, Response } from "express";
import { defaultExperimentRunService } from "./researchExperiments/defaults";
import { ExperimentError } from "./researchExperiments/errors";

/** 从 Object Key 取下载文件名（去掉目录，供 Content-Disposition 用）。 */
export function artifactFileName(key: string): string {
  const base = key.split("/").pop() ?? "artifact";
  // 去掉引号 / 换行 / 分号 —— 防 header 注入（名字来自服务端生成的 Key，仍然防御性处理）。
  return base.replace(/["\\\r\n;]/gu, "_") || "artifact";
}

function httpStatusFor(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof ExperimentError) {
    switch (error.code) {
      case "EXPERIMENT_RUN_NOT_FOUND":
      case "EXPERIMENT_ARTIFACT_NOT_FOUND":
        return { status: 404, code: error.code, message: error.message };
      case "EXPERIMENT_ARTIFACT_KEY_INVALID":
      case "EXPERIMENT_MANIFEST_INVALID":
        return { status: 400, code: error.code, message: error.message };
      case "EXPERIMENT_ARTIFACT_STORAGE_UNAVAILABLE":
        return { status: 503, code: error.code, message: error.message };
      default:
        return { status: 500, code: error.code, message: error.message };
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, code: "EXPERIMENT_ARTIFACT_UNKNOWN_ERROR", message };
}

/**
 * 注册实验 Artifact 只读代理路由。
 *
 * 必须在 Vite / 静态资源中间件**之前**注册（与既有 `/api/scheduled/*` 同理），
 * 否则开发模式下会被 Vite 的 HTML fallback 吃掉。
 */
export function registerExperimentArtifactRoutes(app: Express): void {
  app.get("/api/experiments/artifact", async (req: Request, res: Response) => {
    const runId = typeof req.query.runId === "string" ? req.query.runId.trim() : "";
    const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
    if (runId.length === 0 || key.length === 0) {
      res.status(400).json({
        code: "EXPERIMENT_ARTIFACT_KEY_INVALID",
        message: "必须同时提供 runId 与 key（两者都是 Manifest 索引里的值）",
      });
      return;
    }
    // 默认下载；显式 disposition=inline 时才内联（页面「预览」按钮用）。
    const disposition = req.query.disposition === "inline" ? "inline" : "attachment";

    try {
      const { body, contentType } = await defaultExperimentRunService().readArtifact(runId, key);
      res.setHeader("Content-Type", contentType ?? "application/octet-stream");
      res.setHeader("Content-Length", String(body.byteLength));
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename="${artifactFileName(key)}"`,
      );
      // 产物一旦写出即不可变 ⇒ 可以放心让浏览器/中间层短暂缓存（仅私有缓存）。
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(body);
    } catch (error) {
      const mapped = httpStatusFor(error);
      console.warn(
        `[ExperimentArtifact] 读取失败 runId=${runId} key=${key} code=${mapped.code}: ${mapped.message}`,
      );
      res.status(mapped.status).json({ code: mapped.code, message: mapped.message });
    }
  });
}
