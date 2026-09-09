/**
 * STEP 17 / C-17.2 — Rolling Optimization：滚动窗口生成（交易日锚定，纯函数）。
 *
 * 窗口锚定决策（文档化）：
 *   - 窗口锚定**数据集实际交易日序列**（tradeDates：升序、无重复、YYYY-MM-DD），单位是
 *     「交易日个数」，而不是 walkForward（STEP 6.5）的日历天。理由：
 *       1. 本模块窗内评估消费的是逐交易日数据流（ResearchDataset 行 → simulator → C-16.1
 *          equityCurve），日历天切片会把非交易日空隙卷进来，导致「窗内样本」与
 *          「评估曲线实际覆盖的交易日」错位；
 *       2. ResearchDataset 无真实日历对象，其权威时间粒度就是 tradeDate 序列本身
 *          （C-12.6.1 universeDefinition.days / rows.tradeDate）；
 *       3. 纯索引切片天然无未来数据：窗 i 只含它自己的 tradeDates 切片，跨窗一致性只做
 *          描述性比较，不把未来窗数据引入过去窗。
 *      walkForward 的日历天语义面向生产 WFO 引擎（C-19.x 范畴），保留不动；两者边界见
 *      types.ts 文件头。
 *
 * 窗口几何：
 *   窗 0 = tradeDates[0 .. windowLength-1]；
 *   窗 i = tradeDates[i*stepLength .. i*stepLength + windowLength - 1]；
 *   直到 `i*stepLength + windowLength > tradeDates.length`（完整窗口放不下）时明确停止。
 *   - stepLength < windowLength → 相邻窗重叠（参数漂移观测的常规形态）；
 *   - stepLength = windowLength → 无缝平铺；> windowLength → 窗间留空（数据不参与）。
 *
 * 铁律：纯函数、确定性、无 IO / Date.now / Math.random；退化输入（空日期序列、日期
 * 乱序/重复/格式非法、非法配置、交易日不足一个窗口）结构化抛错，绝不静默返回空数组。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { isValidDateString } from "../datasetSplit";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "../experimentValidation";
import type {
  ResolvedRollingWindowConfig,
  RollingOptimizationWindow,
  RollingWindowConfig,
} from "./types";

// ---------------------------------------------------------------------------
// 交易日历校验
// ---------------------------------------------------------------------------

/**
 * 校验交易日序列：非空、每项 YYYY-MM-DD、严格升序且无重复。
 * 返回结构化结果；供 generateRollingOptimizationWindows 与调用方复用。
 */
export function validateRollingTradeDates(tradeDates: readonly string[]): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  if (!Array.isArray(tradeDates)) {
    return { valid: false, issues: [{ code: "ROLLING_TRADE_DATES_NOT_ARRAY", path: "tradeDates", message: "tradeDates 必须是数组" }] };
  }
  if (tradeDates.length === 0) {
    return { valid: false, issues: [{ code: "ROLLING_TRADE_DATES_EMPTY", path: "tradeDates", message: "tradeDates 不能为空（至少 1 个交易日）" }] };
  }
  for (let index = 0; index < tradeDates.length; index++) {
    const date = tradeDates[index];
    if (typeof date !== "string" || !isValidDateString(date)) {
      issues.push({ code: "ROLLING_TRADE_DATE_INVALID", path: `tradeDates[${index}]`, message: `日期必须是 YYYY-MM-DD：${String(date)}` });
      continue;
    }
    if (index > 0 && date <= tradeDates[index - 1]!) {
      issues.push({ code: "ROLLING_TRADE_DATES_NOT_ASCENDING", path: `tradeDates[${index}]`, message: `tradeDates 必须严格升序且无重复：${date} 不晚于前一日 ${tradeDates[index - 1]}` });
    }
  }
  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 窗口配置解析（缺省补齐 + 校验；返回 issues 不抛错）
// ---------------------------------------------------------------------------

/** 解析窗口配置：缺省补齐 + 形态校验。issues 为空即合法。 */
export function resolveRollingWindowConfig(
  config: RollingWindowConfig | undefined,
): { readonly config: ResolvedRollingWindowConfig | null; readonly issues: ResearchValidationIssue[] } {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  if (config === undefined || config === null || typeof config !== "object" || Array.isArray(config)) {
    issues.push({ code: "ROLLING_WINDOW_CONFIG_INVALID", path: "windowConfig", message: "windowConfig 必须是对象" });
    return { config: null, issues };
  }
  const windowLength = config.windowLength;
  const stepLength = config.stepLength;
  const maxWindows = config.maxWindows ?? null;
  if (!Number.isInteger(windowLength) || windowLength < 1) {
    issue("ROLLING_WINDOW_LENGTH_INVALID", "windowConfig.windowLength", `windowLength 必须是 >= 1 的整数（交易日个数），实际 ${String(windowLength)}`);
  }
  if (!Number.isInteger(stepLength) || stepLength < 1) {
    issue("ROLLING_STEP_LENGTH_INVALID", "windowConfig.stepLength", `stepLength 必须是 >= 1 的整数（交易日个数），实际 ${String(stepLength)}`);
  }
  if (maxWindows !== null && (!Number.isInteger(maxWindows) || maxWindows < 1)) {
    issue("ROLLING_MAX_WINDOWS_INVALID", "windowConfig.maxWindows", `maxWindows 必须为 null 或 >= 1 的整数，实际 ${String(maxWindows)}`);
  }
  if (issues.length > 0) {
    return { config: null, issues };
  }
  return {
    config: { mode: "rolling", windowLength, stepLength, maxWindows },
    issues,
  };
}

// ---------------------------------------------------------------------------
// 窗口生成
// ---------------------------------------------------------------------------

/**
 * 生成滚动窗口（交易日锚定，deterministic）。
 *
 * 无法容纳第 0 个完整窗口（tradeDates.length < windowLength）→ 结构化抛错
 * （ROLLING_WINDOW_INSUFFICIENT_DATASET），绝不静默返回空数组。
 */
export function generateRollingOptimizationWindows(
  tradeDates: readonly string[],
  config: RollingWindowConfig,
): RollingOptimizationWindow[] {
  const resolved = resolveRollingWindowConfig(config);
  if (resolved.config === null) {
    throw new ResearchValidationError(resolved.issues);
  }
  const dateValidation = validateRollingTradeDates(tradeDates);
  if (!dateValidation.valid) {
    throw new ResearchValidationError(dateValidation.issues);
  }

  const rc = resolved.config;
  const windows: RollingOptimizationWindow[] = [];
  const total = tradeDates.length;
  let windowIndex = 0;
  for (;;) {
    if (rc.maxWindows !== null && windows.length >= rc.maxWindows) break;
    const start = windowIndex * rc.stepLength;
    if (start + rc.windowLength > total) break; // 完整窗口放不下 → 明确停止
    const slice = tradeDates.slice(start, start + rc.windowLength);
    windows.push({
      windowIndex,
      firstTradeDate: slice[0]!,
      lastTradeDate: slice[slice.length - 1]!,
      tradeDayCount: slice.length,
      tradeDates: slice,
    });
    windowIndex += 1;
  }

  if (windows.length === 0) {
    throw new ResearchValidationError([
      {
        code: "ROLLING_WINDOW_INSUFFICIENT_DATASET",
        path: "tradeDates",
        message: `交易日序列长度 ${total} 不足以容纳第 0 个完整窗口（windowLength=${rc.windowLength}），无法进行滚动优化`,
      },
    ]);
  }
  return windows;
}

// ---------------------------------------------------------------------------
// 窗口配置 fingerprint（canonical sha256；供 Run 记录/审计）
// ---------------------------------------------------------------------------

/** 窗口配置 canonical fingerprint（覆盖 mode/windowLength/stepLength/maxWindows）。 */
export function computeRollingWindowConfigFingerprint(config: ResolvedRollingWindowConfig): string {
  return createHash("sha256").update(canonicalStringify(config), "utf8").digest("hex");
}
