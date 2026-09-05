/**
 * STEP 6.5 — Walk-Forward Optimization (WFO) Contract + Window Generation。
 *
 * 职责边界（Research Orchestration / Analysis Layer）：
 *   - 只描述「WFO 配置、窗口定义、窗口生成、窗口指纹」，不实现任何回测 / 交易 / 成交逻辑；
 *   - 窗口按时间顺序生成，rolling / expanding 两种模式，严格 deterministic、无未来数据；
 *   - 每个窗口三段（Train / Validation / OOS）严格无重叠、按时间递增；
 *   - 提供 canonical fingerprint（SHA-256）供审计与确定性复现。
 *
 * 时间语义（复用 STEP 6.4 既有约定）：
 *   - 日期为 `YYYY-MM-DD` 字符串，区间采用 **[start, end]（闭区间，两端点含）**；
 *   - `trainSize` / `validationSize` / `oosSize` / `stepSize` 均为 **日历天数（正整数）**，
 *     窗口在 `datasetRange` 内按天滑动；本层无「交易日索引」概念，故以日历天为唯一时间粒度，
 *     使用 UTC 日期算术保证 deterministic（不依赖本地时区 / DST）；
 *   - 相邻分段严格不相交：`trainEnd < validationStart`、`validationEnd < oosStart`。
 *
 * 铁律：
 *   - 输入非法必须 fail fast（禁止 return [] 掩盖配置错误）；
 *   - 无法形成完整 OOS 时明确停止（返回已生成窗口）；若连第 0 个窗口都无法形成则抛错；
 *   - 相邻窗口的 OOS 必须不重叠 → 强制 `stepSize >= oosSize`；
 *   - 纯函数，不依赖 Database / Network / Date.now / Math.random；
 *   - fingerprint 通过固定字段顺序 + canonical JSON + SHA-256 保证稳定，不依赖对象键插入顺序。
 */

import { createHash } from "node:crypto";
import {
  validateDatasetRange,
  type ResearchDatasetRange,
} from "./datasetSplit";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "./experimentValidation";
import {
  isSelectableMetric,
  isSelectionDirection,
  type SelectionDirection,
  type SelectionMetric,
} from "./validationSelection";

/** WFO 窗口模式：rolling = 固定长度滑动；expanding = Train 起点固定、终点向前扩展。 */
export type WalkForwardMode = "rolling" | "expanding";

/** WFO 配置（§四：至少包含以下字段）。 */
export interface WalkForwardConfig {
  /** 窗口模式。 */
  mode: WalkForwardMode;
  /** Train 长度（日历天数，正整数）。 */
  trainSize: number;
  /** Validation 长度（日历天数，正整数）。 */
  validationSize: number;
  /** OOS 长度（日历天数，正整数）。 */
  oosSize: number;
  /** 相邻窗口的移动步长（日历天数，正整数；必须 >= oosSize 以保证相邻 OOS 不重叠）。 */
  stepSize: number;
  /** 完整数据集范围（窗口在其内滑动）。 */
  datasetRange: ResearchDatasetRange;
  /** 选择指标（严格取自 PerformanceMetrics 既有字段）。 */
  selectionMetric: SelectionMetric;
  /** 选择方向。 */
  selectionDirection: SelectionDirection;
}

/**
 * 单个 WFO 窗口（§五）。
 *
 * 时间顺序必须满足（闭区间、严格无重叠）：
 *
 *   trainEnd < validationStart
 *   validationEnd < oosStart
 */
export interface WalkForwardWindow {
  /** 窗口序号（从 0 起，按时间递增）。 */
  windowIndex: number;
  /** 窗口模式（从 config 透传，进入 fingerprint）。 */
  mode: WalkForwardMode;
  trainRange: ResearchDatasetRange;
  validationRange: ResearchDatasetRange;
  oosRange: ResearchDatasetRange;
  /** 窗口 canonical fingerprint（SHA-256）。 */
  fingerprint: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** 日期字符串 → 距 UTC 1970-01-01 的天数（UTC，deterministic）。 */
function toEpochDay(date: string): number {
  const match = DATE_RE.exec(date);
  if (!match) {
    throw new ResearchValidationError([
      { code: "WFO_DATE_INVALID", path: "date", message: `日期必须是 YYYY-MM-DD 格式：${date}` },
    ]);
  }
  const year = Number(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** 距 UTC 1970-01-01 的天数 → YYYY-MM-DD。 */
function toDateString(epochDay: number): string {
  const date = new Date(epochDay * DAY_MS);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 日期加 n 天（UTC，deterministic）。 */
function addDays(date: string, days: number): string {
  return toDateString(toEpochDay(date) + days);
}

/** 比较两个日期字符串（按日历序）。 */
function compareDate(left: string, right: string): number {
  return toEpochDay(left) - toEpochDay(right);
}

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** 校验 WFO 配置（纯函数，返回结构化结果）。 */
export function validateWalkForwardConfig(config: WalkForwardConfig): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (!config || typeof config !== "object") {
    return { valid: false, issues: [issue("WFO_CONFIG_INVALID", "config", "WFO 配置缺失或非对象")] };
  }

  if (config.mode !== "rolling" && config.mode !== "expanding") {
    issues.push(issue("WFO_MODE_INVALID", "config.mode", `非法窗口模式：${String(config.mode)}（仅 rolling | expanding）`));
  }
  if (!isPositiveInteger(config.trainSize)) {
    issues.push(issue("WFO_TRAIN_SIZE_INVALID", "config.trainSize", "trainSize 必须是 > 0 的整数（日历天数）"));
  }
  if (!isPositiveInteger(config.validationSize)) {
    issues.push(issue("WFO_VALIDATION_SIZE_INVALID", "config.validationSize", "validationSize 必须是 > 0 的整数（日历天数）"));
  }
  if (!isPositiveInteger(config.oosSize)) {
    issues.push(issue("WFO_OOS_SIZE_INVALID", "config.oosSize", "oosSize 必须是 > 0 的整数（日历天数）"));
  }
  if (!isPositiveInteger(config.stepSize)) {
    issues.push(issue("WFO_STEP_SIZE_INVALID", "config.stepSize", "stepSize 必须是 > 0 的整数（日历天数）"));
  }
  if (isPositiveInteger(config.stepSize) && isPositiveInteger(config.oosSize) && config.stepSize < config.oosSize) {
    issues.push(issue("WFO_STEP_LT_OOS", "config.stepSize", `stepSize(${config.stepSize}) 必须 >= oosSize(${config.oosSize})，否则相邻窗口 OOS 重叠`));
  }
  if (!config.datasetRange || typeof config.datasetRange !== "object") {
    issues.push(issue("WFO_DATASET_RANGE_INVALID", "config.datasetRange", "datasetRange 缺失或非对象"));
  } else {
    const rangeIssues = validateDatasetRange(config.datasetRange).issues;
    issues.push(...rangeIssues.map((i) => ({ ...i, path: `config.datasetRange.${i.path.replace("range.", "")}` })));
  }
  if (!isSelectableMetric(config.selectionMetric)) {
    issues.push(issue("WFO_SELECTION_METRIC_INVALID", "config.selectionMetric", `非法选择指标：${String(config.selectionMetric)}`));
  }
  if (!isSelectionDirection(config.selectionDirection)) {
    issues.push(issue("WFO_SELECTION_DIRECTION_INVALID", "config.selectionDirection", `非法选择方向：${String(config.selectionDirection)}`));
  }

  return { valid: issues.length === 0, issues };
}

/** 断言 WFO 配置合法，否则抛 ResearchValidationError。 */
export function assertValidWalkForwardConfig(config: WalkForwardConfig): void {
  const result = validateWalkForwardConfig(config);
  if (!result.valid) throw new ResearchValidationError(result.issues);
}

/**
 * 生成 WFO 窗口（rolling / expanding，deterministic）。
 *
 * Rolling：Train 长度固定，`trainStart = datasetRange.start + windowIndex * stepSize`。
 * Expanding：Train 起点固定，`trainEnd = datasetRange.start + trainSize - 1 + windowIndex * stepSize`。
 *
 * 两种模式下 Validation / OOS 均向前移动 stepSize：
 *
 *   validationStart = trainEnd + 1
 *   validationEnd   = validationStart + validationSize - 1
 *   oosStart        = validationEnd + 1
 *   oosEnd          = oosStart + oosSize - 1
 *
 * 生成循环在 `oosEnd > datasetRange.end` 时明确停止（无法形成完整 OOS）；若第 0 个窗口
 * 即无法形成完整 OOS（数据集不足以容纳一整个 Train+Validation+OOS），则 fail fast 抛错。
 *
 * 断言生成结果满足（防御性 invariant）：
 *   - 窗口按 windowIndex 严格时间递增；
 *   - 每窗口三段严格无重叠；
 *   - 相邻窗口 OOS 不重叠。
 */
export function generateWalkForwardWindows(config: WalkForwardConfig): WalkForwardWindow[] {
  assertValidWalkForwardConfig(config);

  const windows: WalkForwardWindow[] = [];
  let windowIndex = 0;

  for (;;) {
    const trainStart = config.mode === "rolling"
      ? addDays(config.datasetRange.start, windowIndex * config.stepSize)
      : config.datasetRange.start;
    const trainEnd = config.mode === "rolling"
      ? addDays(trainStart, config.trainSize - 1)
      : addDays(config.datasetRange.start, config.trainSize - 1 + windowIndex * config.stepSize);
    const validationStart = addDays(trainEnd, 1);
    const validationEnd = addDays(validationStart, config.validationSize - 1);
    const oosStart = addDays(validationEnd, 1);
    const oosEnd = addDays(oosStart, config.oosSize - 1);

    if (compareDate(oosEnd, config.datasetRange.end) > 0) {
      break; // 无法形成完整 OOS → 明确停止
    }

    const window: Omit<WalkForwardWindow, "fingerprint"> = {
      windowIndex,
      mode: config.mode,
      trainRange: { start: trainStart, end: trainEnd },
      validationRange: { start: validationStart, end: validationEnd },
      oosRange: { start: oosStart, end: oosEnd },
    };
    windows.push({ ...window, fingerprint: computeWindowFingerprint(window) });
    windowIndex += 1;
  }

  if (windows.length === 0) {
    throw new ResearchValidationError([
      {
        code: "WFO_INSUFFICIENT_DATASET",
        path: "config.datasetRange",
        message: "数据集范围不足以形成第 0 个完整窗口（Train + Validation + OOS），无法进行 WFO",
      },
    ]);
  }

  assertWindowsValid(windows);
  return windows;
}

/** 防御性校验生成出的窗口序列（相邻 OOS 不重叠、每窗口三段严格无重叠、时间严格递增）。 */
function assertWindowsValid(windows: readonly WalkForwardWindow[]): void {
  const issues: ResearchValidationIssue[] = [];
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]!;
    if (compareDate(w.trainRange.start, w.trainRange.end) > 0) {
      issues.push(issue("WFO_WINDOW_TRAIN_REVERSED", `windows[${i}]`, "train 倒序"));
    }
    if (compareDate(w.trainRange.end, w.validationRange.start) >= 0) {
      issues.push(issue("WFO_WINDOW_TRAIN_VAL_OVERLAP", `windows[${i}]`, "train 与 validation 重叠"));
    }
    if (compareDate(w.validationRange.end, w.oosRange.start) >= 0) {
      issues.push(issue("WFO_WINDOW_VAL_OOS_OVERLAP", `windows[${i}]`, "validation 与 oos 重叠"));
    }
    if (i > 0) {
      const prev = windows[i - 1]!;
      if (compareDate(prev.oosRange.end, w.oosRange.start) >= 0) {
        issues.push(issue("WFO_WINDOW_OOS_OVERLAP", `windows[${i}]`, "相邻窗口 OOS 重叠"));
      }
    }
  }
  if (issues.length > 0) throw new ResearchValidationError(issues);
}

// ---------------------------------------------------------------------------
// Fingerprint（canonical SHA-256）
// ---------------------------------------------------------------------------

/** 递归 canonical 化：数组保持顺序、对象键按字典序排序。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, val]) => [key, canonicalize(val)]),
    );
  }
  return value;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * 窗口 canonical fingerprint（§九）。覆盖 windowIndex / mode / trainRange / validationRange / oosRange。
 * 相同配置 → 相同指纹；任一字段（含日期）改变 → 不同指纹；不依赖对象键插入顺序。
 */
export function computeWindowFingerprint(window: Omit<WalkForwardWindow, "fingerprint">): string {
  const canonical = canonicalize({
    windowIndex: window.windowIndex,
    mode: window.mode,
    trainRange: window.trainRange,
    validationRange: window.validationRange,
    oosRange: window.oosRange,
  });
  return sha256Hex(JSON.stringify(canonical));
}

/** WFO 计划 canonical fingerprint（§十二 planFingerprint）：覆盖 config 全部语义字段。 */
export function computeWalkForwardConfigFingerprint(config: WalkForwardConfig): string {
  assertValidWalkForwardConfig(config);
  const canonical = canonicalize({
    mode: config.mode,
    trainSize: config.trainSize,
    validationSize: config.validationSize,
    oosSize: config.oosSize,
    stepSize: config.stepSize,
    datasetRange: config.datasetRange,
    selectionMetric: config.selectionMetric,
    selectionDirection: config.selectionDirection,
  });
  return sha256Hex(JSON.stringify(canonical));
}
