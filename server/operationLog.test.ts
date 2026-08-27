import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const schemaSource = readFileSync(resolve(projectRoot, "drizzle/schema.ts"), "utf8");
const dbSource = readFileSync(resolve(projectRoot, "server/db.ts"), "utf8");
const routerSource = readFileSync(resolve(projectRoot, "server/routers.ts"), "utf8");
const uploadSource = readFileSync(resolve(projectRoot, "client/src/pages/Upload.tsx"), "utf8");
const appSource = readFileSync(resolve(projectRoot, "client/src/App.tsx"), "utf8");
const pageSource = readFileSync(resolve(projectRoot, "client/src/pages/OperationLogs.tsx"), "utf8");

describe("图片识别与日期刷新操作日志", () => {
  it("schema记录识别、刷新、状态、日期、数量和操作者", () => {
    for (const requiredText of [
      'mysqlTable("operation_logs"',
      'operationType: mysqlEnum("operationType", ["image_recognition", "date_refresh"])',
      'status: mysqlEnum("status", ["processing", "success", "empty", "failed"])',
      "imageId",
      "requestedDate",
      "effectiveDate",
      "recognizedCount",
      "refreshedCount",
      "createdBy: int(\"createdBy\").notNull()",
      "imageUrl: text(\"imageUrl\")",
    ]) {
      expect(schemaSource).toContain(requiredText);
    }
  });

  it("日志查询按当前用户隔离并支持类型、状态、日期筛选", () => {
    expect(dbSource).toContain("export async function getOperationLogs(");
    expect(dbSource).toContain("eq(operationLogs.createdBy, userId)");
    expect(dbSource).toContain("export async function getOperationLogById");
    expect(dbSource).toContain("eq(operationLogs.id, id)");
    expect(dbSource).toContain("filters?.operationType");
    expect(dbSource).toContain("filters?.status");
    expect(dbSource).toContain("filters?.date");
    expect(routerSource).toContain("operationLog: router({");
    expect(routerSource).toContain("getOperationLogs(ctx.user.id, input)");
  });

  it("网页同步、本地异步识别和日期刷新均写入日志", () => {
    expect(routerSource).toContain('operationType: "image_recognition"');
    expect(routerSource).toContain("await finishOperationLog(operationLogId");
    expect(routerSource).toContain('status: stocks.length > 0 ? "success" : "empty"');
    expect(uploadSource).toContain("recordRefreshMutation.mutateAsync");
    expect(uploadSource).toContain("dateRefreshState");
    expect(routerSource).toContain("recordRefresh: protectedProcedure");
    expect(routerSource).toContain("retry: protectedProcedure");
    expect(routerSource).toContain('sourceLog.status !== "failed"');
    expect(routerSource).toContain('sourceLog.operationType === "image_recognition"');
    expect(routerSource).toContain("sourceLog.imageUrl");
    expect(pageSource).toContain("retryOperation.mutateAsync");
    expect(pageSource).toContain('logStatus === "failed"');
    expect(pageSource).toContain("一键重试");
  });

  it("日志页面已注册并提供状态与类型筛选", () => {
    expect(appSource).toContain('path="/operation-logs"');
    for (const requiredText of [
      "操作日志",
      "全部类型",
      "全部状态",
      "图片识别",
      "日期数据刷新",
      "刷新日志",
      "当前账号发起",
      "日志仅对当前登录账号可见",
    ]) {
      expect(pageSource).toContain(requiredText);
    }
  });
});
