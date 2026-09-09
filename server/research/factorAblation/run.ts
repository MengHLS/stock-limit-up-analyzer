/**
 * STEP 20 / C-20.2 — 因子消融与 OOS 退化：Run ID 生成与便捷入口。
 *
 * 便捷入口 `runAblationAssessment` 只负责补默认运行元数据（ablationRunId / createdAt，
 * 缺省才取当前时间/随机数——非复现输入），真正的求值/装配在 assess.ts（纯函数）。
 *
 * ID 形态：`ABL-YYYYMMDD-XXXXXXXX`（前缀 ABL + 日期 + 4 字节 hex 大写），
 * 风格对齐 OFA-* / OOSISO-* / SEARCH-*。
 */

import { randomBytes } from "node:crypto";
import { ABLATION_ASSESSMENT_RUN_ID_PREFIX, type AblationRequest } from "./types";
import { assessAblationRun } from "./assess";
import type { AblationAssessmentRun } from "./types";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 生成 AblationAssessmentRun ID（`ABL-YYYYMMDD-XXXXXXXX`）。 */
export function formatAblationRunId(date: string, suffix: string): string {
  return `${ABLATION_ASSESSMENT_RUN_ID_PREFIX}-${date}-${suffix}`;
}

/** 生成 ABL Run ID；测试可注入 suffix。 */
export function generateAblationRunId(
  now: Date = new Date(),
  suffix?: string,
): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const resolvedSuffix = suffix ?? randomBytes(4).toString("hex").toUpperCase();
  return formatAblationRunId(date, resolvedSuffix);
}

/**
 * 便捷入口：request 可省略 ablationRunId / createdAt（缺省自动补）。
 * 确定性要求时请显式注入两者（见 assess.ts）。
 */
export function runAblationAssessment(
  request: Omit<AblationRequest, "ablationRunId" | "createdAt"> & {
    readonly ablationRunId?: string;
    readonly createdAt?: string;
  },
): AblationAssessmentRun {
  const ablationRunId = request.ablationRunId ?? generateAblationRunId();
  const createdAt = request.createdAt ?? new Date().toISOString();
  return assessAblationRun({ ...request, ablationRunId, createdAt });
}
