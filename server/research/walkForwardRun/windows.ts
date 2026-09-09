/**
 * STEP 19 / C-19.1 — WFO 滚动窗口划分（交易日锚定，纯函数）。
 *
 * ## 锚定决策（与 C-17.2 一致，与 STEP 6.5 walkForward 不同）
 * 窗口锚定**数据集实际交易日序列**（tradeDates：升序、无重复、YYYY-MM-DD），单位是
 * 「交易日个数」，而非日历天。理由（沿用 C-17.2 windows.ts 的决策）：
 *   1. 窗内评估消费的是逐交易日数据流（ResearchDataset 行 → C-14.1 simulator → C-16.1
 *      曲线），日历天切片会把休市/停牌空隙卷进来，导致「窗切片」与「评估曲线实际覆盖的
 *      交易日」错位；
 *   2. 研究链路的权威时间粒度就是 tradeDate 序列本身；
 *   3. 纯索引切片天然无未来数据：窗 i 只含它自己的 tradeDates 切片。
 * STEP 6.5 walkForward.ts 的日历天语义面向生产 WFO 服务，**仅参考哲学不 import**。
 *
 * ## 窗口几何
 * ```
 * rolling：
 *   trainStart = i * step
 *   trainEnd   = trainStart + trainWindow
 *   testStart  = trainEnd + gap
 *   testEnd    = testStart + testWindow          条件：testEnd <= total
 *
 * anchored（expanding）：
 *   trainStart = 0（Train 段随窗扩张）
 *   trainEnd   = i * step + trainWindow
 *   testStart / testEnd 同上
 *
 * embargo：optimizationDates = trainDates[0 .. trainWindow-embargo-1]
 *          embargoDates      = trainDates[trainWindow-embargo .. trainWindow-1]
 * gap     ：gapDates         = tradeDates[trainEnd .. trainEnd+gap-1]（两段都不属于）
 * ```
 *
 * **Test 段严格位于 Train 段之后且无重叠**：由几何保证（testStart >= trainEnd），并由
 * `assertWalkForwardSplitInvariants` 在每个窗口上做运行时断言（日期字典序 + 集合交集），
 * 不是注释承诺。
 *
 * 铁律：纯函数、确定性、无 IO / Date.now / Math.random；退化输入（空日期序列、乱序/重复/
 * 格式非法、非法配置、embargo 吞掉整个 train、交易日不足一个完整窗口）→ 结构化抛错，
 * 绝不静默返回空数组。
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
  ResolvedWalkForwardSplitConfig,
  WalkForwardSplit,
  WalkForwardSplitConfig,
} from "./types";

// ---------------------------------------------------------------------------
// 交易日历校验
// ---------------------------------------------------------------------------

/** 校验交易日序列：非空、每项 YYYY-MM-DD、严格升序且无重复。 */
export function validateWalkForwardTradeDates(
  tradeDates: readonly string[],
): ResearchValidationResult {
  if (!Array.isArray(tradeDates)) {
    return {
      valid: false,
      issues: [
        {
          code: "WFO19_TRADE_DATES_NOT_ARRAY",
          path: "tradeDates",
          message: "tradeDates 必须是数组",
        },
      ],
    };
  }
  const issues: ResearchValidationIssue[] = [];
  if (tradeDates.length === 0) {
    return {
      valid: false,
      issues: [
        {
          code: "WFO19_TRADE_DATES_EMPTY",
          path: "tradeDates",
          message: "tradeDates 不能为空（至少 1 个交易日）",
        },
      ],
    };
  }
  for (let index = 0; index < tradeDates.length; index++) {
    const date = tradeDates[index];
    if (typeof date !== "string" || !isValidDateString(date)) {
      issues.push({
        code: "WFO19_TRADE_DATE_INVALID",
        path: `tradeDates[${index}]`,
        message: `日期必须是 YYYY-MM-DD：${String(date)}`,
      });
      continue;
    }
    if (index > 0 && date <= tradeDates[index - 1]!) {
      issues.push({
        code: "WFO19_TRADE_DATES_NOT_ASCENDING",
        path: `tradeDates[${index}]`,
        message: `tradeDates 必须严格升序且无重复：${date} 不晚于前一日 ${tradeDates[index - 1]}`,
      });
    }
  }
  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 配置解析（缺省补齐 + 校验；返回 issues 不抛错）
// ---------------------------------------------------------------------------

/**
 * 解析窗口划分配置：缺省补齐（mode=rolling / gap=0 / embargo=0 / maxWindows=null）+ 形态校验。
 * issues 为空即合法。
 */
export function resolveWalkForwardSplitConfig(
  config: WalkForwardSplitConfig | undefined,
): {
  readonly config: ResolvedWalkForwardSplitConfig | null;
  readonly issues: readonly ResearchValidationIssue[];
} {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  if (config === undefined || config === null || typeof config !== "object" || Array.isArray(config)) {
    issue("WFO19_SPLIT_CONFIG_INVALID", "splitConfig", "splitConfig 必须是对象");
    return { config: null, issues };
  }

  const mode = config.mode ?? "rolling";
  const gap = config.gap ?? 0;
  const embargo = config.embargo ?? 0;
  const maxWindows = config.maxWindows ?? null;
  const { trainWindow, testWindow, step } = config;

  if (mode !== "rolling" && mode !== "anchored") {
    issue("WFO19_SPLIT_MODE_INVALID", "splitConfig.mode", `mode=${String(mode)} 非法（期望 rolling | anchored）`);
  }
  if (!Number.isInteger(trainWindow) || trainWindow < 1) {
    issue("WFO19_TRAIN_WINDOW_INVALID", "splitConfig.trainWindow", `trainWindow 必须是 >= 1 的整数（交易日个数），实际 ${String(trainWindow)}`);
  }
  if (!Number.isInteger(testWindow) || testWindow < 1) {
    issue("WFO19_TEST_WINDOW_INVALID", "splitConfig.testWindow", `testWindow 必须是 >= 1 的整数（交易日个数），实际 ${String(testWindow)}`);
  }
  if (!Number.isInteger(step) || step < 1) {
    issue("WFO19_STEP_INVALID", "splitConfig.step", `step 必须是 >= 1 的整数（交易日个数），实际 ${String(step)}`);
  }
  if (!Number.isInteger(gap) || gap < 0) {
    issue("WFO19_GAP_INVALID", "splitConfig.gap", `gap 必须是 >= 0 的整数（交易日个数），实际 ${String(gap)}`);
  }
  if (!Number.isInteger(embargo) || embargo < 0) {
    issue("WFO19_EMBARGO_INVALID", "splitConfig.embargo", `embargo 必须是 >= 0 的整数（交易日个数），实际 ${String(embargo)}`);
  }
  if (maxWindows !== null && (!Number.isInteger(maxWindows) || maxWindows < 1)) {
    issue("WFO19_MAX_WINDOWS_INVALID", "splitConfig.maxWindows", `maxWindows 必须为 null 或 >= 1 的整数，实际 ${String(maxWindows)}`);
  }
  if (Number.isInteger(trainWindow) && Number.isInteger(embargo) && trainWindow >= 1 && embargo >= 0
    && trainWindow - embargo < 1) {
    issue(
      "WFO19_EMBARGO_EXCEEDS_TRAIN",
      "splitConfig.embargo",
      `embargo=${embargo} 吞掉整个 train 段（trainWindow=${trainWindow}），优化段无交易日`,
    );
  }

  if (issues.length > 0) {
    return { config: null, issues };
  }
  return { config: { mode, trainWindow, testWindow, step, gap, embargo, maxWindows }, issues };
}

// ---------------------------------------------------------------------------
// 窗口不变量断言（PIT 边界：Test 严格晚于 Train 且无重叠）
// ---------------------------------------------------------------------------

/**
 * 断言单个窗口的不变量（FAIL FAST，任何一条被破坏立即抛错）：
 *   1. trainDates / testDates 非空；
 *   2. lastTrainDate < firstTestDate（字典序 = YYYY-MM-DD 时间序）；
 *   3. lastOptimizationDate < firstTestDate（优化段同样严格早于 OOS 段）；
 *   4. trainDates ∩ testDates = ∅（集合级无重叠）；
 *   5. optimizationDates + embargoDates === trainDates（划分自洽）；
 *   6. 各日期子序列严格升序。
 */
export function assertWalkForwardSplitInvariants(split: WalkForwardSplit): void {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  const prefix = `windows[${split.windowIndex}]`;

  const ascending = (dates: readonly string[], label: string): void => {
    for (let i = 1; i < dates.length; i++) {
      if (dates[i]! <= dates[i - 1]!) {
        issue("WFO19_SPLIT_NOT_ASCENDING", `${prefix}.${label}`, `${label} 必须严格升序：${dates[i]} 不晚于 ${dates[i - 1]}`);
        return;
      }
    }
  };

  if (split.trainDates.length === 0) {
    issue("WFO19_SPLIT_TRAIN_EMPTY", `${prefix}.trainDates`, "trainDates 不能为空");
  }
  if (split.testDates.length === 0) {
    issue("WFO19_SPLIT_TEST_EMPTY", `${prefix}.testDates`, "testDates 不能为空");
  }
  if (split.optimizationDates.length === 0) {
    issue("WFO19_SPLIT_OPTIMIZATION_EMPTY", `${prefix}.optimizationDates`, "optimizationDates 不能为空（embargo 不得吞掉整个 train 段）");
  }

  ascending(split.trainDates, "trainDates");
  ascending(split.testDates, "testDates");
  ascending(split.optimizationDates, "optimizationDates");

  if (
    split.optimizationDates.length + split.embargoDates.length !== split.trainDates.length
  ) {
    issue(
      "WFO19_SPLIT_EMBARGO_PARTITION_INVALID",
      `${prefix}.embargoDates`,
      `optimizationDates(${split.optimizationDates.length}) + embargoDates(${split.embargoDates.length}) 必须等于 trainDates(${split.trainDates.length})`,
    );
  }

  if (split.trainDates.length > 0 && split.testDates.length > 0) {
    if (split.lastTrainDate >= split.firstTestDate) {
      issue(
        "WFO19_SPLIT_TEST_NOT_AFTER_TRAIN",
        `${prefix}.testDates`,
        `Test 段必须严格晚于 Train 段：lastTrainDate=${split.lastTrainDate} 不早于 firstTestDate=${split.firstTestDate}`,
      );
    }
    const trainSet = new Set(split.trainDates);
    const overlap = split.testDates.filter((date) => trainSet.has(date));
    if (overlap.length > 0) {
      issue(
        "WFO19_SPLIT_TRAIN_TEST_OVERLAP",
        `${prefix}.testDates`,
        `Train 段与 Test 段不得重叠，重叠 ${overlap.length} 个交易日（首个 ${overlap[0]}）`,
      );
    }
  }
  if (split.optimizationDates.length > 0 && split.testDates.length > 0) {
    const lastOptimization = split.optimizationDates[split.optimizationDates.length - 1]!;
    if (lastOptimization >= split.firstTestDate) {
      issue(
        "WFO19_SPLIT_TEST_NOT_AFTER_OPTIMIZATION",
        `${prefix}.optimizationDates`,
        `Test 段必须严格晚于优化段：lastOptimizationDate=${lastOptimization} 不早于 firstTestDate=${split.firstTestDate}`,
      );
    }
  }

  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}

// ---------------------------------------------------------------------------
// 窗口生成
// ---------------------------------------------------------------------------

/**
 * 生成 WFO 窗口划分（Train / Test 成对；交易日锚定，deterministic）。
 *
 * 无法容纳第 0 个完整窗口（trainWindow + gap + testWindow > tradeDates.length）→
 * 结构化抛错（WFO19_SPLIT_INSUFFICIENT_DATASET），绝不静默返回空数组。
 * 每个生成的窗口都会通过 assertWalkForwardSplitInvariants 双重校验后才返回。
 */
export function generateWalkForwardSplits(
  tradeDates: readonly string[],
  config: WalkForwardSplitConfig,
): WalkForwardSplit[] {
  const resolved = resolveWalkForwardSplitConfig(config);
  if (resolved.config === null) {
    throw new ResearchValidationError([...resolved.issues]);
  }
  const dateValidation = validateWalkForwardTradeDates(tradeDates);
  if (!dateValidation.valid) {
    throw new ResearchValidationError(dateValidation.issues);
  }

  const rc = resolved.config;
  const total = tradeDates.length;
  const splits: WalkForwardSplit[] = [];
  let windowIndex = 0;

  for (;;) {
    if (rc.maxWindows !== null && splits.length >= rc.maxWindows) break;

    // anchored：Train 段起点恒为 0、末点随窗扩张（expanding）；
    // rolling ：Train 段起点与末点同步推进（定长）。两者的 trainEnd 公式相同。
    const advance = windowIndex * rc.step;
    const trainStart = rc.mode === "anchored" ? 0 : advance;
    const trainEnd = advance + rc.trainWindow;
    const testStart = trainEnd + rc.gap;
    const testEnd = testStart + rc.testWindow;
    if (testEnd > total) break; // 完整窗口放不下 → 明确停止

    const trainDates = tradeDates.slice(trainStart, trainEnd);
    const optimizationLength = trainDates.length - rc.embargo;
    const optimizationDates = trainDates.slice(0, optimizationLength);
    const embargoDates = trainDates.slice(optimizationLength);
    const gapDates = tradeDates.slice(trainEnd, testStart);
    const testDates = tradeDates.slice(testStart, testEnd);

    const split: WalkForwardSplit = {
      windowIndex,
      mode: rc.mode,
      trainStartIndex: trainStart,
      trainDates,
      optimizationDates,
      embargoDates,
      gapDates,
      testDates,
      firstTrainDate: trainDates[0]!,
      lastTrainDate: trainDates[trainDates.length - 1]!,
      firstTestDate: testDates[0]!,
      lastTestDate: testDates[testDates.length - 1]!,
      trainDayCount: trainDates.length,
      optimizationDayCount: optimizationDates.length,
      embargoDayCount: embargoDates.length,
      gapDayCount: gapDates.length,
      testDayCount: testDates.length,
      spanDayCount: testEnd - trainStart,
    };
    assertWalkForwardSplitInvariants(split);
    splits.push(split);
    windowIndex += 1;
  }

  if (splits.length === 0) {
    throw new ResearchValidationError([
      {
        code: "WFO19_SPLIT_INSUFFICIENT_DATASET",
        path: "tradeDates",
        message:
          `交易日序列长度 ${total} 不足以容纳第 0 个完整 WFO 窗口`
          + `（trainWindow=${rc.trainWindow} + gap=${rc.gap} + testWindow=${rc.testWindow}`
          + `，anchored 模式下 train 段还需随窗扩张），无法执行 Walk-Forward`,
      },
    ]);
  }
  return splits;
}

// ---------------------------------------------------------------------------
// 配置 fingerprint（canonical sha256；供 Run 记录/审计）
// ---------------------------------------------------------------------------

/** 窗口划分配置 canonical fingerprint（覆盖 mode/trainWindow/testWindow/step/gap/embargo/maxWindows）。 */
export function computeWalkForwardSplitConfigFingerprint(
  config: ResolvedWalkForwardSplitConfig,
): string {
  return createHash("sha256").update(canonicalStringify(config), "utf8").digest("hex");
}
