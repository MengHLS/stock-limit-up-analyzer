/**
 * STEP 6.4 — Dataset Split Contract（Train / Validation / OOS 时间切分）。
 *
 * 职责边界：
 *   - 只描述「研究数据集按时间切分为三段」的契约与校验，不实现任何回测 / 交易逻辑；
 *   - 时间是唯一的切分维度（禁止 shuffle / random split）；
 *   - 三段严格无重叠、无倒序，边界必须显式、可验证；
 *   - 提供 canonical fingerprint（SHA-256）供审计与确定性复现。
 *
 * 时间语义（复用项目既有约定）：
 *   - 日期为 `YYYY-MM-DD` 字符串，区间采用 **[start, end]（闭区间，两端点含）**；
 *     这与既有 `validateDatasetSpec`（`startDate <= endDate`）及 Production Backtest Core
 *     （endDate 为含端点的最后一个交易日）保持一致，不为 STEP 6.4 强行重构全局日期系统；
 *   - 相邻分段必须严格不相交：`trainEnd < validationStart` 且 `validationEnd < oosStart`
 *     （闭区间语义下，相邻两段的首尾日期「紧挨着」即无重叠，如 2023-12-31 → 2024-01-01）；
 *   - `start === end` 表示单日区间（非空），合法。
 *
 * 铁律：
 *   - 纯函数，不依赖 Database / Network / Date.now / Math.random；
 *   - 校验返回结构化结果，另提供 assert* 便捷入口；
 *   - fingerprint 通过固定字段顺序 + canonical JSON + SHA-256 保证稳定，不依赖对象键插入顺序。
 */

import { createHash } from "node:crypto";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "./experimentValidation";

/** 单个研究数据集时间范围（闭区间 [start, end]，两端点含）。 */
export interface ResearchDatasetRange {
  /** 起始日期（YYYY-MM-DD，含）。 */
  start: string;
  /** 结束日期（YYYY-MM-DD，含）。 */
  end: string;
}

/**
 * 研究数据集三段切分描述（Train / Validation / OOS）。
 *
 * 时间顺序必须满足（闭区间、严格无重叠）：
 *
 *   trainStart <= trainEnd < validationStart <= validationEnd < oosStart <= oosEnd
 */
export interface ResearchDatasetSplit {
  trainStart: string;
  trainEnd: string;
  validationStart: string;
  validationEnd: string;
  oosStart: string;
  oosEnd: string;
}

/** Train / Validation / OOS 三段范围（由 ResearchDatasetSplit 派生）。 */
export interface TrainValidationOosRanges {
  train: ResearchDatasetRange;
  validation: ResearchDatasetRange;
  oos: ResearchDatasetRange;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

/** 是否为合法的 YYYY-MM-DD 日期字符串。 */
export function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

/** 校验单个日期范围（闭区间 [start, end]；start <= end）。 */
export function validateDatasetRange(range: ResearchDatasetRange): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!range || typeof range !== "object") {
    return { valid: false, issues: [issue("RANGE_INVALID", "range", "日期范围缺失或非对象")] };
  }
  if (!isValidDateString(range.start)) {
    issues.push(issue("RANGE_START_INVALID", "range.start", "start 必须是 YYYY-MM-DD 格式"));
  }
  if (!isValidDateString(range.end)) {
    issues.push(issue("RANGE_END_INVALID", "range.end", "end 必须是 YYYY-MM-DD 格式"));
  }
  if (isValidDateString(range.start) && isValidDateString(range.end) && range.start > range.end) {
    issues.push(issue("RANGE_REVERSED", "range", `start(${range.start}) 晚于 end(${range.end})`));
  }
  return { valid: issues.length === 0, issues };
}

/** 断言单个日期范围合法，否则抛 ResearchValidationError。 */
export function assertValidDatasetRange(range: ResearchDatasetRange): void {
  const result = validateDatasetRange(range);
  if (!result.valid) throw new ResearchValidationError(result.issues);
}

/**
 * 校验三段切分（Train / Validation / OOS）。
 *
 * 规则（闭区间 [start,end]、严格无重叠）：
 *   trainStart <= trainEnd < validationStart <= validationEnd < oosStart <= oosEnd
 *
 * 即禁止：Train/Validation 重叠、Validation/OOS 重叠、Train/OOS 重叠、任一段倒序。
 */
export function validateResearchDatasetSplit(split: ResearchDatasetSplit): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!split || typeof split !== "object") {
    return { valid: false, issues: [issue("SPLIT_INVALID", "split", "切分描述缺失或非对象")] };
  }

  const fields: Array<[keyof ResearchDatasetSplit, string, string]> = [
    ["trainStart", "trainStart", "Train 起始"],
    ["trainEnd", "trainEnd", "Train 结束"],
    ["validationStart", "validationStart", "Validation 起始"],
    ["validationEnd", "validationEnd", "Validation 结束"],
    ["oosStart", "oosStart", "OOS 起始"],
    ["oosEnd", "oosEnd", "OOS 结束"],
  ];
  for (const [field, path, label] of fields) {
    if (!isValidDateString(split[field])) {
      issues.push(issue("SPLIT_DATE_INVALID", `split.${path}`, `${label} 必须是 YYYY-MM-DD 格式`));
    }
  }

  // 任一段内部倒序。
  if (isValidDateString(split.trainStart) && isValidDateString(split.trainEnd) && split.trainStart > split.trainEnd) {
    issues.push(issue("TRAIN_REVERSED", "split", `Train 倒序：trainStart(${split.trainStart}) 晚于 trainEnd(${split.trainEnd})`));
  }
  if (isValidDateString(split.validationStart) && isValidDateString(split.validationEnd) && split.validationStart > split.validationEnd) {
    issues.push(issue("VALIDATION_REVERSED", "split", `Validation 倒序：validationStart(${split.validationStart}) 晚于 validationEnd(${split.validationEnd})`));
  }
  if (isValidDateString(split.oosStart) && isValidDateString(split.oosEnd) && split.oosStart > split.oosEnd) {
    issues.push(issue("OOS_REVERSED", "split", `OOS 倒序：oosStart(${split.oosStart}) 晚于 oosEnd(${split.oosEnd})`));
  }

  // 分段之间严格无重叠（闭区间语义：相邻日期「紧挨着」即通过）。
  if (isValidDateString(split.trainEnd) && isValidDateString(split.validationStart) && split.trainEnd >= split.validationStart) {
    issues.push(issue("TRAIN_VALIDATION_OVERLAP", "split", `Train 与 Validation 重叠或相邻重叠：trainEnd(${split.trainEnd}) >= validationStart(${split.validationStart})`));
  }
  if (isValidDateString(split.validationEnd) && isValidDateString(split.oosStart) && split.validationEnd >= split.oosStart) {
    issues.push(issue("VALIDATION_OOS_OVERLAP", "split", `Validation 与 OOS 重叠或相邻重叠：validationEnd(${split.validationEnd}) >= oosStart(${split.oosStart})`));
  }
  if (isValidDateString(split.trainEnd) && isValidDateString(split.oosStart) && split.trainEnd >= split.oosStart) {
    issues.push(issue("TRAIN_OOS_OVERLAP", "split", `Train 与 OOS 重叠或相邻重叠：trainEnd(${split.trainEnd}) >= oosStart(${split.oosStart})`));
  }

  return { valid: issues.length === 0, issues };
}

/** 断言三段切分合法，否则抛 ResearchValidationError。 */
export function assertValidResearchDatasetSplit(split: ResearchDatasetSplit): void {
  const result = validateResearchDatasetSplit(split);
  if (!result.valid) throw new ResearchValidationError(result.issues);
}

/** 由三段切分派生 Train / Validation / OOS 三个闭区间范围（含端点）。 */
export function toTrainValidationOosRanges(split: ResearchDatasetSplit): TrainValidationOosRanges {
  assertValidResearchDatasetSplit(split);
  return {
    train: { start: split.trainStart, end: split.trainEnd },
    validation: { start: split.validationStart, end: split.validationEnd },
    oos: { start: split.oosStart, end: split.oosEnd },
  };
}

/**
 * 三段切分 canonical fingerprint（SHA-256）。
 * 固定字段顺序 + JSON 序列化，保证相同切分产生相同指纹，且不依赖对象键插入顺序。
 * 只修改任一日期（如 validationEnd）即产生不同指纹。
 */
export function computeDatasetSplitFingerprint(split: ResearchDatasetSplit): string {
  assertValidResearchDatasetSplit(split);
  const canonical = {
    trainStart: split.trainStart,
    trainEnd: split.trainEnd,
    validationStart: split.validationStart,
    validationEnd: split.validationEnd,
    oosStart: split.oosStart,
    oosEnd: split.oosEnd,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
