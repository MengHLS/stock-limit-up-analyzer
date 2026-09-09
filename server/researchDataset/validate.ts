/**
 * STEP 12.6 — Research Dataset：请求规范化与校验（纯函数）。
 */

import { isValidIsoDate } from "../security/dates";
import {
  DEFAULT_CORE_INDEX_CODES,
} from "../historicalState/db";
import type {
  NormalizedResearchDatasetRequest,
  ResearchDatasetRequest,
  ResearchDatasetRequestIssue,
} from "./types";

function issue(code: string, message: string): ResearchDatasetRequestIssue {
  return { code, message };
}

/** 规范化请求（应用默认值）；不做语义校验。 */
export function normalizeResearchDatasetRequest(
  request: ResearchDatasetRequest,
): NormalizedResearchDatasetRequest {
  return {
    ...request,
    asOfPerTradeDate: request.asOfPerTradeDate ?? true,
    asOf: request.asOf ?? null,
    coreIndexCodes:
      request.coreIndexCodes && request.coreIndexCodes.length > 0
        ? [...request.coreIndexCodes]
        : [...DEFAULT_CORE_INDEX_CODES],
  };
}

/** 校验规范化请求：返回问题列表（空 = 合法）。 */
export function validateNormalizedResearchDatasetRequest(
  request: NormalizedResearchDatasetRequest,
): ResearchDatasetRequestIssue[] {
  const issues: ResearchDatasetRequestIssue[] = [];
  if (request.name.trim() === "") {
    issues.push(issue("EMPTY_NAME", "数据集名称不能为空"));
  }
  if (!isValidIsoDate(request.startDate)) {
    issues.push(issue("INVALID_START_DATE", `startDate 非法日期：${request.startDate}`));
  }
  if (!isValidIsoDate(request.endDate)) {
    issues.push(issue("INVALID_END_DATE", `endDate 非法日期：${request.endDate}`));
  }
  if (request.startDate > request.endDate) {
    issues.push(issue("RANGE_REVERSED", `startDate(${request.startDate}) 晚于 endDate(${request.endDate})`));
  }
  if (!request.asOfPerTradeDate) {
    if (request.asOf === null) {
      issues.push(issue("MISSING_AS_OF", "asOfPerTradeDate=false 时必须显式提供 asOf 固定快照日期"));
    } else if (!isValidIsoDate(request.asOf)) {
      issues.push(issue("INVALID_AS_OF", `asOf 非法日期：${request.asOf}`));
    }
  } else if (request.asOf !== null) {
    issues.push(issue("CONFLICT_AS_OF", "asOfPerTradeDate=true 时不应同时提供 asOf（逐日 PIT 由 tradeDate 决定）"));
  }
  return issues;
}
