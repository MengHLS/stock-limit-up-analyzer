/**
 * RESEARCH-002C — 分析模板的校验与展开（纯逻辑，零 IO）。
 *
 * 模板 = 「建分析的配方」：一份可跨实验复用的分析清单。本模块只做两件事：
 *   1. **校验模板草稿**（`assertTemplateDraft`）—— 不合法就响亮失败，绝不写半个模板；
 *   2. **展开成批量创建项**（`templateItemsToBatchItems`）—— 展开结果直接喂给
 *      `createAnalysesBatch`，于是「从模板建分析」与「批量矩阵建分析」走**同一条**落库路径
 *      （预检整批拒绝 / 部分失败如实回显 / 补偿删除全部自动继承，不另写一套）。
 *
 * 纪律：模板里存的条件是**配置快照**；展开时逐项校验其结构，结构不对就报
 * `TEMPLATE_VALIDATION_FAILED` 并指出是第几项 —— 不静默丢掉条件（丢条件会让
 * 「条件分析」退化成「等于全样本」，属于读数不实）。
 */

import type { ResearchAnalysisTemplateItem } from "../researchCore";
import { implementedAnalysisTypes } from "./batchCreate";
import { ResearchEngineError } from "./errors";
import type { ResearchBatchAnalysisItem } from "./types";

/** 模板名长度上限（与 `research_analysis_template.name varchar(120)` 一致）。 */
export const MAX_TEMPLATE_NAME_LENGTH = 120;
/** 模板明细上限（与批量创建上限一致，避免存下一个注定跑不完的模板）。 */
export const MAX_TEMPLATE_ITEMS = 200;
export const MAX_TEMPLATE_ITEM_NAME_LENGTH = 200;

/** 模板明细草稿（创建模板时的入参形态）。 */
export interface TemplateItemDraft {
  analysisType: string;
  name: string;
  target?: string | null;
  config?: unknown;
  /** 条件行（与批量创建同一形态）。 */
  conditions?: ReadonlyArray<{
    groupNo: number;
    sortOrder: number;
    fieldName: string;
    operator: string;
    value: unknown;
    logicalOperator?: string;
    groupLogicalOperator?: string;
  }>;
}

export interface TemplateDraft {
  name: string;
  items: ReadonlyArray<TemplateItemDraft>;
}

/** 校验模板草稿；不合法抛 `TEMPLATE_VALIDATION_FAILED`（消息里点名第几项）。 */
export function assertTemplateDraft(draft: TemplateDraft): void {
  const issues: string[] = [];
  const name = typeof draft.name === "string" ? draft.name.trim() : "";
  if (name === "") issues.push("模板名不能为空");
  else if (name.length > MAX_TEMPLATE_NAME_LENGTH) {
    issues.push(`模板名不能超过 ${MAX_TEMPLATE_NAME_LENGTH} 个字符`);
  }

  const items = draft.items ?? [];
  if (items.length === 0) issues.push("模板至少要包含一个分析");
  else if (items.length > MAX_TEMPLATE_ITEMS) {
    issues.push(`模板最多 ${MAX_TEMPLATE_ITEMS} 个分析，本次 ${items.length} 个`);
  }

  const implemented = new Set(implementedAnalysisTypes());
  items.forEach((item, index) => {
    const label = `第 ${index + 1} 项`;
    const itemName = typeof item.name === "string" ? item.name.trim() : "";
    if (itemName === "") issues.push(`${label}：分析名称不能为空`);
    else if (itemName.length > MAX_TEMPLATE_ITEM_NAME_LENGTH) {
      issues.push(`${label}：分析名称不能超过 ${MAX_TEMPLATE_ITEM_NAME_LENGTH} 个字符`);
    }
    if (!implemented.has(item.analysisType)) {
      issues.push(
        `${label}：分析类型 ${item.analysisType} 未在 RESEARCH-002 中实现（已实现：${implementedAnalysisTypes().join(" / ")}）`,
      );
    }
    if (item.analysisType === "CONDITIONAL") {
      const usable = (item.conditions ?? []).filter((c) => c.fieldName.trim() !== "");
      if (usable.length === 0) {
        issues.push(`${label}：条件分析必须至少有一条填好字段的条件（空条件等于「等于全样本」）`);
      }
    }
  });

  if (issues.length > 0) {
    throw new ResearchEngineError(
      "TEMPLATE_VALIDATION_FAILED",
      `模板校验未通过，**未保存任何模板** —— ${issues.join("；")}`,
      { issueCount: issues.length },
    );
  }
}

/**
 * 模板明细 → 批量创建项。
 *
 * `conditionsJson` 是开放 JSON（落库时 `encodeJson`），因此**必须在展开处校验结构**：
 * 它不是「引擎可信输入」，而是「用户此前存下来的东西」。结构不认识 → 具名失败并指出第几项。
 */
export function templateItemsToBatchItems(
  items: ReadonlyArray<ResearchAnalysisTemplateItem>,
): ResearchBatchAnalysisItem[] {
  return items.map((item, index) => {
    const conditions = readConditions(item, index);
    return {
      analysisType: item.analysisType,
      name: item.name,
      target: item.target ?? null,
      config: item.config,
      ...(conditions.length > 0 ? { conditions } : {}),
    };
  });
}

function readConditions(
  item: ResearchAnalysisTemplateItem,
  index: number,
): NonNullable<ResearchBatchAnalysisItem["conditions"]> {
  const raw = item.conditionsJson;
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ResearchEngineError(
      "TEMPLATE_VALIDATION_FAILED",
      `模板第 ${index + 1} 项（${item.name}）的条件不是数组 —— 模板内容已损坏，拒绝展开`,
      { templateItemIndex: index },
    );
  }
  return raw.map((row, rowIndex) => {
    const r = row as Record<string, unknown> | null;
    const fieldName = typeof r?.fieldName === "string" ? r.fieldName : "";
    if (r === null || typeof r !== "object" || fieldName.trim() === "") {
      throw new ResearchEngineError(
        "TEMPLATE_VALIDATION_FAILED",
        `模板第 ${index + 1} 项（${item.name}）第 ${rowIndex + 1} 行条件缺少 fieldName —— 模板内容已损坏，拒绝展开`,
        { templateItemIndex: index, conditionRowIndex: rowIndex },
      );
    }
    return {
      groupNo: Number(r.groupNo ?? 0),
      sortOrder: Number(r.sortOrder ?? rowIndex),
      fieldName,
      operator: String(r.operator ?? ""),
      value: r.value ?? null,
      logicalOperator: typeof r.logicalOperator === "string" ? r.logicalOperator : "AND",
      groupLogicalOperator: typeof r.groupLogicalOperator === "string" ? r.groupLogicalOperator : "AND",
    };
  });
}

/** 模板明细 → 保存用（把批量创建项去掉 `target` 的 null 语义，统一成模板项形态）。 */
export function batchItemsToTemplateItems(
  items: ReadonlyArray<ResearchBatchAnalysisItem>,
): TemplateItemDraft[] {
  return items.map((item) => ({
    analysisType: item.analysisType,
    name: item.name,
    target: item.target ?? null,
    config: item.config,
    ...(item.conditions && item.conditions.length > 0
      ? {
          conditions: item.conditions.map((c) => ({
            groupNo: c.groupNo,
            sortOrder: c.sortOrder,
            fieldName: c.fieldName,
            operator: c.operator,
            value: c.value,
            logicalOperator: c.logicalOperator ?? "AND",
            groupLogicalOperator: c.groupLogicalOperator ?? "AND",
          })),
        }
      : {}),
  }));
}
