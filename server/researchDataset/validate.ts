/**
 * STEP 12.6 — Research Dataset：请求规范化与校验（纯函数）。
 */

import { isValidIsoDate } from "../security/dates";
import {
  DEFAULT_CORE_INDEX_CODES,
} from "../historicalState/db";
import { PULLBACK_TARGET_TYPES } from "./types";
import type {
  BoardCategory,
  NormalizedResearchDatasetRequest,
  ResearchDatasetRequest,
  ResearchDatasetRequestIssue,
  TDayCondition,
} from "./types";

function issue(code: string, message: string): ResearchDatasetRequestIssue {
  return { code, message };
}

/** 合法板块类别（与 types.BoardCategory 一致）。 */
const BOARD_CATEGORIES: readonly BoardCategory[] = [
  "main",
  "chinext",
  "star",
  "bse",
  "unknown",
];

/** 合法 T 日条件（与 types.TDayCondition 一致）。 */
const TDAY_CONDITIONS: readonly TDayCondition[] = [
  "none",
  "limitUp",
  "firstBoard",
  "consecutiveBoard",
];

/** 规范化请求（应用默认值）；不做语义校验。 */
export function normalizeResearchDatasetRequest(
  request: ResearchDatasetRequest,
): NormalizedResearchDatasetRequest {
  const filter = request.universeFilter ?? {};
  return {
    ...request,
    asOfPerTradeDate: request.asOfPerTradeDate ?? true,
    asOf: request.asOf ?? null,
    coreIndexCodes:
      request.coreIndexCodes && request.coreIndexCodes.length > 0
        ? [...request.coreIndexCodes]
        : [...DEFAULT_CORE_INDEX_CODES],
    universeFilter: {
      boards: filter.boards ? [...filter.boards] : [],
      excludeSt: filter.excludeSt ?? false,
      tDayCondition: filter.tDayCondition ?? "none",
      pullback: filter.pullback
        ? {
            targetTypes: [...filter.pullback.targetTypes],
            tolerancePercent: filter.pullback.tolerancePercent ?? 2,
            observationWindowDays: filter.pullback.observationWindowDays ?? 5,
          }
        : null,
    },
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
  const filter = request.universeFilter;
  for (const board of filter.boards) {
    if (!BOARD_CATEGORIES.includes(board)) {
      issues.push(issue("INVALID_BOARD", `universeFilter.boards 含非法板块：${board}`));
    }
  }
  if (!TDAY_CONDITIONS.includes(filter.tDayCondition)) {
    issues.push(issue("INVALID_TDAY_CONDITION", `universeFilter.tDayCondition 非法：${filter.tDayCondition}`));
  }
  if (filter.pullback) {
    if (filter.tDayCondition !== "firstBoard") {
      issues.push(
        issue(
          "PULLBACK_REQUIRES_FIRST_BOARD",
          "universeFilter.pullback 仅在 tDayCondition=firstBoard 时生效，请将 T 日条件设为「首板」",
        ),
      );
    }
    if (filter.pullback.targetTypes.length === 0) {
      issues.push(issue("PULLBACK_NO_TARGET", "universeFilter.pullback 至少需一个回踩目标位"));
    }
    for (const target of filter.pullback.targetTypes) {
      if (!PULLBACK_TARGET_TYPES.includes(target)) {
        issues.push(issue("INVALID_PULLBACK_TARGET", `universeFilter.pullback.targetTypes 含非法目标位：${target}`));
      }
    }
    if (
      !Number.isFinite(filter.pullback.tolerancePercent) ||
      filter.pullback.tolerancePercent < 0 ||
      filter.pullback.tolerancePercent > 50
    ) {
      issues.push(issue("INVALID_PULLBACK_TOLERANCE", "universeFilter.pullback.tolerancePercent 须在 [0,50]"));
    }
    if (
      !Number.isInteger(filter.pullback.observationWindowDays) ||
      filter.pullback.observationWindowDays < 1 ||
      filter.pullback.observationWindowDays > 10
    ) {
      issues.push(issue("INVALID_PULLBACK_WINDOW", "universeFilter.pullback.observationWindowDays 须为 [1,10] 的整数"));
    }
  }
  return issues;
}
