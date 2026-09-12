/**
 * batchCreate 单测 — 批量建分析的预检与执行语义。
 *
 * 覆盖重点（都是「错了会留下半成品或悄悄少建」的地方）：
 *   - 预检整批拒绝：`assertBatchCreateItems` 不通过时**一个都不建**；
 *   - 单批上限 `BATCH_TOO_LARGE`；
 *   - 执行期失败**如实回显**并**补偿删除**（不留「有分析没条件」的半成品）；
 *   - 回滚本身失败时也如实标注，不静默吞掉；
 *   - 成功的项保证「有 id 就能跑」（条件已落库）。
 */

import { describe, expect, it } from "vitest";
import { createInMemoryResearchRepositories, type ResearchRepositories } from "../researchCore";
import { ResearchEngineError } from "./errors";
import {
  MAX_BATCH_CREATE_ITEMS,
  assertBatchCreateItems,
  createAnalysesBatch,
  implementedAnalysisTypes,
  preflightBatchCreateItems,
} from "./batchCreate";
import type { ResearchBatchAnalysisItem } from "./types";

function repos(): ResearchRepositories {
  return createInMemoryResearchRepositories({ datasetVersionExists: async () => true });
}

async function seedRun(store: ResearchRepositories): Promise<number> {
  const experiment = await store.experiments.create({
    datasetVersionId: 1,
    name: "批量测试",
    researchType: "FEATURE",
  });
  const run = await store.runs.create({ experimentId: experiment.id!, runNo: 1, config: null });
  return run.id!;
}

const quantile = (name: string, target = "future_return_5d"): ResearchBatchAnalysisItem => ({
  analysisType: "QUANTILE",
  name,
  target,
  config: { featureField: "turnover", targetField: target, quantileGroups: 10 },
});

describe("implementedAnalysisTypes", () => {
  it("取自执行器注册表（唯一权威），并且恰好是已实现的 6 类", () => {
    expect(implementedAnalysisTypes()).toEqual([
      "CONDITIONAL",
      "DESCRIPTIVE",
      "EVENT_STUDY",
      "QUANTILE",
      "SEGMENT_RELATION",
      "STABILITY",
    ]);
  });
});

describe("preflightBatchCreateItems", () => {
  it("合法输入 → 无问题", () => {
    expect(preflightBatchCreateItems([quantile("a")])).toHaveLength(0);
  });

  it("空批次 → 整批级问题（index = -1）", () => {
    const issues = preflightBatchCreateItems([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.index).toBe(-1);
  });

  it("未实现的类型被点名，且提示里列出已实现集合", () => {
    const issues = preflightBatchCreateItems([
      { analysisType: "IC" as never, name: "信息系数" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.index).toBe(0);
    expect(issues[0]!.message).toContain("未在 RESEARCH-002 中实现");
    expect(issues[0]!.message).toContain("QUANTILE");
  });

  it("名称空白 → 报错；超 200 字符 → 报错", () => {
    expect(preflightBatchCreateItems([quantile("   ")])[0]!.message).toContain("名称不能为空");
    expect(preflightBatchCreateItems([quantile("x".repeat(201))])[0]!.message).toContain("200");
  });

  it("CONDITIONAL 缺条件 → 报错；有条件 → 通过", () => {
    const noCond: ResearchBatchAnalysisItem = { analysisType: "CONDITIONAL", name: "无条件" };
    expect(
      preflightBatchCreateItems([noCond]).some((i) => i.message.includes("空条件")),
    ).toBe(true);

    const withCond: ResearchBatchAnalysisItem = {
      analysisType: "CONDITIONAL",
      name: "有条件",
      conditions: [{ groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 1 }],
    };
    expect(preflightBatchCreateItems([withCond])).toHaveLength(0);
  });

  it("条件行存在但 fieldName 为空白 → 视同没有条件", () => {
    const item: ResearchBatchAnalysisItem = {
      analysisType: "CONDITIONAL",
      name: "空字段条件",
      conditions: [{ groupNo: 0, sortOrder: 0, fieldName: "   ", operator: ">=", value: 1 }],
    };
    expect(preflightBatchCreateItems([item])).toHaveLength(1);
  });
});

describe("assertBatchCreateItems", () => {
  it("超出单批上限 → BATCH_TOO_LARGE（且消息里有两个数字）", () => {
    const items = Array.from({ length: MAX_BATCH_CREATE_ITEMS + 1 }, (_, i) => quantile(`a${i}`));
    try {
      assertBatchCreateItems(items);
      throw new Error("应当抛错");
    } catch (e) {
      expect(e).toBeInstanceOf(ResearchEngineError);
      expect((e as ResearchEngineError).code).toBe("BATCH_TOO_LARGE");
    }
  });

  it("预检失败 → BATCH_VALIDATION_FAILED，消息显式写明「未创建任何分析」", () => {
    try {
      assertBatchCreateItems([quantile("ok"), quantile("  ")]);
      throw new Error("应当抛错");
    } catch (e) {
      expect((e as ResearchEngineError).code).toBe("BATCH_VALIDATION_FAILED");
      expect((e as ResearchEngineError).message).toContain("未创建任何分析");
      expect((e as ResearchEngineError).message).toContain("第 2 项");
    }
  });
});

describe("createAnalysesBatch", () => {
  it("正常批量：逐项创建，index 与入参一一对应", async () => {
    const store = repos();
    const runId = await seedRun(store);

    const result = await createAnalysesBatch(store, runId, [
      quantile("T+5", "future_return_5d"),
      quantile("T+10", "future_return_10d"),
      { analysisType: "EVENT_STUDY", name: "事件", config: { horizons: [5, 10] } },
    ]);

    expect(result.createdCount).toBe(3);
    expect(result.failedCount).toBe(0);
    expect(result.runId).toBe(runId);
    expect(result.created.map((c) => c.index)).toEqual([0, 1, 2]);

    const stored = await store.analyses.list({ runId });
    expect(stored).toHaveLength(3);
    expect(stored.map((a) => a.name).sort()).toEqual(["T+10", "T+5", "事件"]);
  });

  it("条件真实落库（created 项保证「有 id 就能跑」）", async () => {
    const store = repos();
    const runId = await seedRun(store);

    const result = await createAnalysesBatch(store, runId, [
      {
        analysisType: "CONDITIONAL",
        name: "条件",
        target: "future_return_5d",
        config: { targetField: "future_return_5d" },
        conditions: [
          { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 2 },
          { groupNo: 1, sortOrder: 0, fieldName: "volumeRatio", operator: "<", value: 3 },
        ],
      },
    ]);

    const conditions = await store.conditions.listByAnalysis(result.created[0]!.analysisId);
    expect(conditions).toHaveLength(2);
    expect(conditions.map((c) => c.groupNo)).toEqual([0, 1]);
  });

  it("Run 不存在 → RUN_NOT_FOUND", async () => {
    const store = repos();
    await expect(createAnalysesBatch(store, 123456, [quantile("x")])).rejects.toMatchObject({
      code: "RUN_NOT_FOUND",
    });
  });

  it("预检失败 → 抛错且**一个都没建**", async () => {
    const store = repos();
    const runId = await seedRun(store);
    await expect(
      createAnalysesBatch(store, runId, [quantile("ok"), quantile("")]),
    ).rejects.toMatchObject({ code: "BATCH_VALIDATION_FAILED" });
    expect(await store.analyses.list({ runId })).toHaveLength(0);
  });

  it("条件写入失败 → 补偿删除该分析，并计入 failed（不留半成品）", async () => {
    const base = repos();
    const runId = await seedRun(base);
    const store: ResearchRepositories = {
      ...base,
      conditions: {
        ...base.conditions,
        async replaceForAnalysis() {
          throw new Error("模拟条件写入失败");
        },
      },
    };

    const result = await createAnalysesBatch(store, runId, [
      {
        analysisType: "CONDITIONAL",
        name: "条件写不进去",
        target: "future_return_5d",
        config: { targetField: "future_return_5d" },
        conditions: [{ groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 1 }],
      },
      quantile("无条件的项"),
    ]);

    expect(result.createdCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failed[0]!.index).toBe(0);
    expect(result.failed[0]!.errorMessage).toContain("模拟条件写入失败");

    const stored = await base.analyses.list({ runId });
    // 只有第二项留下；第一项已被补偿删除
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe("无条件的项");
    expect(await base.conditions.listByAnalysis(result.created[0]!.analysisId)).toHaveLength(0);
  });

  it("回滚本身失败时如实标注（不静默吞掉）", async () => {
    const base = repos();
    const runId = await seedRun(base);
    const store: ResearchRepositories = {
      ...base,
      conditions: {
        ...base.conditions,
        async replaceForAnalysis() {
          throw new Error("条件写入失败");
        },
        async deleteByAnalysis() {
          throw new Error("回滚也失败了");
        },
      },
    };

    const result = await createAnalysesBatch(store, runId, [
      {
        analysisType: "CONDITIONAL",
        name: "回滚失败项",
        target: "future_return_5d",
        config: { targetField: "future_return_5d" },
        conditions: [{ groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 1 }],
      },
    ]);

    expect(result.failedCount).toBe(1);
    expect(result.failed[0]!.errorMessage).toContain("回滚该项失败");
    // 分析行确实留下了 —— 这正是「如实标注」要暴露的事实
    expect(await base.analyses.list({ runId })).toHaveLength(1);
  });

  it("单批上限内即上限本身可用（边界不误伤）", async () => {
    const store = repos();
    const runId = await seedRun(store);
    const items = Array.from({ length: MAX_BATCH_CREATE_ITEMS }, (_, i) => quantile(`a${i}`));
    const result = await createAnalysesBatch(store, runId, items);
    expect(result.createdCount).toBe(MAX_BATCH_CREATE_ITEMS);
    expect(result.failedCount).toBe(0);
  });
});
