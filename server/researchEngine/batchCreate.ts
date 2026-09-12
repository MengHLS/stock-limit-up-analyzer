/**
 * RESEARCH-002C — 批量建分析（把「一个一个填对话框」压成「一次提交」）。
 *
 * 触发问题：用户「我需要手动建立很多分析，有没有什么办法可以减少这个过程」。
 * 引擎侧本来只有 `createAnalysis`（一次一个），而研究里大量重复的是
 * **类型 × 目标 × 视界** 的矩阵（例如 QUANTILE 换 T+5 / T+10 / T+20 各建一次）。
 *
 * 两条设计纪律（都不是保守，是「不静默不实」的直接推论）：
 *
 *   1. **预检整批拒绝，不产半成品**
 *      预检能发现的问题（名字空、类型未实现、CONDITIONAL 缺条件）都是**用户可修**的输入问题。
 *      此时「能建几个建几个」只会留下难以解释的半成品，因此预检未通过 → **一个都不建**，
 *      并把逐项问题原样回传。真正无法预知的失败（写库报错）才留到执行期。
 *
 *      ⚠️ 预检**不重复实现**条件结构合法性（组号连续 0..n-1 / 组内 sortOrder 唯一 / 值元数）——
 *      那是 `researchCore/conditions.ts#assertConditionSet` 的**唯一权威**，由
 *      `replaceForAnalysis` 在写入时执行。刻意不在这里抄一遍：抄一份就会漂移。
 *      这类失败因此落在执行期，但**同样不会留半成品**（见下面第 2 条的补偿删除）。
 *
 *   2. **执行期部分失败如实回显 + 补偿删除**
 *      `created` 里每一项都保证**完整可用**：若条件写入失败，会先删条件再删该分析
 *      （补偿删除），并把它计入 `failed`。这样「有 id 就能跑」是一个真不变量，
 *      而不是「大概能跑」。补偿删除本身失败也会如实标注，绝不静默吞掉。
 *
 * 为什么不用数据库事务包住整批：批量建分析是**一次性写 N 个独立对象**，它们之间没有
 * 需要共同成立的约束；用大事务反而会把跨境 TiDB 的 RTT 放大成一次长事务（见 §44 传输实测）。
 */

import type {
  ResearchConditionOperator,
  ResearchGroupLogicalOperator,
  ResearchLogicalOperator,
  ResearchRepositories,
} from "../researchCore";
import { createDefaultAnalysisExecutorRegistry } from "./analyses/registry";
import { engineAssert, ResearchEngineError, toResearchEngineError } from "./errors";
import type { ResearchBatchAnalysisItem, ResearchBatchCreateResult } from "./types";

/** 单批上限：超过这个量说明该走模板/脚本，而不是靠一次 HTTP 往返。 */
export const MAX_BATCH_CREATE_ITEMS = 200;

/** 预检问题（`index` 为入参 `items` 的下标；`-1` 表示整批级问题）。 */
export interface BatchPreflightIssue {
  index: number;
  name: string;
  message: string;
}

/** 已实现的分析类型 —— 取自执行器注册表，**不另立第二份清单**（防漂移）。 */
export function implementedAnalysisTypes(): string[] {
  return createDefaultAnalysisExecutorRegistry().listTypes();
}

/** 逐项预检（纯函数，不碰 DB）。返回空数组 = 可动手。 */
export function preflightBatchCreateItems(
  items: ReadonlyArray<ResearchBatchAnalysisItem>,
): BatchPreflightIssue[] {
  const issues: BatchPreflightIssue[] = [];
  if (items.length === 0) {
    issues.push({ index: -1, name: "", message: "批量创建至少要包含一个分析" });
    return issues;
  }

  const implemented = new Set(implementedAnalysisTypes());

  items.forEach((item, index) => {
    const rawName = typeof item.name === "string" ? item.name : "";
    const label = rawName.trim() !== "" ? rawName.trim() : `#${index + 1}`;

    if (rawName.trim() === "") {
      issues.push({ index, name: label, message: "分析名称不能为空" });
    } else if (rawName.trim().length > 200) {
      issues.push({ index, name: label, message: "分析名称不能超过 200 个字符" });
    }

    if (!implemented.has(item.analysisType)) {
      issues.push({
        index,
        name: label,
        message: `分析类型 ${item.analysisType} 未在 RESEARCH-002 中实现（已实现：${implementedAnalysisTypes().join(" / ")}）`,
      });
    }

    // 与前端 `requiresConditions` 同口径：空条件 = 「等于全样本」，引擎跑它没有研究意义。
    if (item.analysisType === "CONDITIONAL") {
      const usable = (item.conditions ?? []).filter(
        (c) => typeof c.fieldName === "string" && c.fieldName.trim() !== "",
      );
      if (usable.length === 0) {
        issues.push({
          index,
          name: label,
          message: "条件分析必须至少有一条填好字段的条件（空条件等于「等于全样本」，没有研究意义）",
        });
      }
    }
  });

  return issues;
}

/**
 * 预检断言：不通过即抛具名错误（**动手前**拒绝）。
 * 错误消息显式写明「未创建任何分析」，避免调用方误以为建了一部分。
 */
export function assertBatchCreateItems(items: ReadonlyArray<ResearchBatchAnalysisItem>): void {
  engineAssert(
    items.length <= MAX_BATCH_CREATE_ITEMS,
    "BATCH_TOO_LARGE",
    `批量创建最多 ${MAX_BATCH_CREATE_ITEMS} 个分析，本次收到 ${items.length} 个`,
    { max: MAX_BATCH_CREATE_ITEMS, received: items.length },
  );

  const issues = preflightBatchCreateItems(items);
  if (issues.length === 0) return;

  const head = issues
    .slice(0, 10)
    .map((i) => `第 ${i.index + 1} 项（${i.name}）：${i.message}`)
    .join("；");
  const more = issues.length > 10 ? `；另有 ${issues.length - 10} 项问题` : "";
  throw new ResearchEngineError(
    "BATCH_VALIDATION_FAILED",
    `批量创建预检未通过，**未创建任何分析** —— ${head}${more}`,
    { issueCount: issues.length, issues },
  );
}

/** 批量创建：预检 → 逐项创建 → 部分失败如实回显（含补偿删除）。 */
export async function createAnalysesBatch(
  repos: ResearchRepositories,
  runId: number,
  items: ReadonlyArray<ResearchBatchAnalysisItem>,
): Promise<ResearchBatchCreateResult> {
  assertBatchCreateItems(items);

  const run = await repos.runs.getById(runId);
  engineAssert(run !== undefined, "RUN_NOT_FOUND", `未找到 Research Run：${runId}`, { runId });

  const created: ResearchBatchCreateResult["created"] = [];
  const failed: ResearchBatchCreateResult["failed"] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const name = item.name.trim();
    let analysisId: number | undefined;

    try {
      const analysis = await repos.analyses.create({
        runId,
        analysisType: item.analysisType,
        name,
        target: item.target ?? null,
        config: item.config ?? null,
      });
      analysisId = analysis.id;
      if (analysisId === undefined) {
        throw new ResearchEngineError(
          "INTERNAL_ERROR",
          "分析创建成功但未返回 id —— 无法继续写条件，已中止该项",
        );
      }

      const conditionRows = (item.conditions ?? []).map((c) => ({
        groupNo: c.groupNo,
        sortOrder: c.sortOrder,
        fieldName: c.fieldName,
        operator: c.operator as ResearchConditionOperator,
        value: c.value,
        logicalOperator: (c.logicalOperator ?? "AND") as ResearchLogicalOperator,
        groupLogicalOperator: (c.groupLogicalOperator ?? "AND") as ResearchGroupLogicalOperator,
      }));
      if (conditionRows.length > 0) {
        await repos.conditions.replaceForAnalysis(analysisId, conditionRows);
      }

      created.push({ index, analysisId, analysisType: item.analysisType, name });
    } catch (e) {
      const error = toResearchEngineError(e);
      let rollbackNote = "";
      if (analysisId !== undefined) {
        // 补偿删除：不留「有分析但条件残缺」的半成品。条件先删（replaceForAnalysis 是先删后插）。
        try {
          await repos.conditions.deleteByAnalysis(analysisId);
          await repos.analyses.delete(analysisId);
        } catch (rollbackError) {
          rollbackNote = `；⚠️ 回滚该项失败：${toResearchEngineError(rollbackError).message}`;
        }
      }
      failed.push({
        index,
        name,
        errorCode: error.code,
        errorMessage: `${error.message}${rollbackNote}`,
      });
    }
  }

  return {
    runId,
    created,
    failed,
    createdCount: created.length,
    failedCount: failed.length,
  };
}
