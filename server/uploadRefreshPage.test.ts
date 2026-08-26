import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");

const uploadPageSource = readFileSync(resolve(projectRoot, "client/src/pages/Upload.tsx"), "utf8");

describe("上传识别后的指定日期自动刷新", () => {
  it("在批量识别保存完成后按上传日期重新查询一次", () => {
    expect(uploadPageSource).toContain("const records = await utils.limitUp.getByDate.fetch({ date });");
    expect(uploadPageSource).toContain("所有图片保存完成后，只按本次上传日期重新查询一次");
    expect(uploadPageSource).toContain("refreshedCount = await refreshUploadedDateData(limitUpDate);");
    expect(uploadPageSource).toContain("data-upload-date-refresh");
  });

  it("展示成功、空结果、失败和重试反馈", () => {
    for (const requiredText of [
      'dateRefreshState === "success"',
      'dateRefreshState === "empty"',
      'dateRefreshState === "error"',
      "自动刷新失败",
      "当前没有可展示的数据库记录",
      "重试",
      "再次刷新",
    ]) {
      expect(uploadPageSource).toContain(requiredText);
    }
  });
});
