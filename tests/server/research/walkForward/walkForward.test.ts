/**
 * WALK-FORWARD-001 §18 — 域层测试（窗口几何 / 生命周期 / 泄漏守卫 / 冻结 / 选择策略 / 汇总）。
 *
 * ## 测试的独立性纪律
 *
 * 窗口几何的期望值**不**从被测实现反推，而是由本文件自带的「参考实现」
 * （`expectedSplit`，直接按规格 §4 的定义算下标）算出 ⇒ 两边独立，才有判据意义。
 *
 * ## 🔴 最容易写假的三处（本文件逐条钉住）
 *
 * 1. **空集合的统计量必须是 `null` 而不是 `0`** —— `0` 是「算出来恰好是 0」，
 *    `null` 是「没有这个值」，两者混淆会把「无数据」伪装成「读数为零」；
 * 2. **`oosStart = isEnd + 1 个交易日`** 必须是**交易日**意义上的相邻，
 *    不是日历天相邻（否则休市空隙会被当成样本外数据）；
 * 3. **`WALK_FORWARD_FUTURE_DATA_LEAK`** 必须真的抓得到「搜索窗口伸进更晚 Fold」，
 *    而不是只靠 `SearchEnd <= ISEnd` 间接兜住（后者会漏掉「IS 内但已越到后一 Fold」的形态）。
 */

import { describe, expect, it } from "vitest";
import { ResearchValidationError } from "../../../../server/research/experimentValidation";
import { buildWalkForwardAggregate, describeMetricStat } from "../../../../server/research/walkForward/aggregate";
import {
  assertDatasetVersionUnchanged,
  assertParameterHashRecomputes,
  assertStrategyFingerprintUnchanged,
  recomputeParameterHash,
} from "../../../../server/research/walkForward/freeze";
import {
  assertFoldLeakageGuard,
  assertIndependentFoldSearches,
} from "../../../../server/research/walkForward/leakage";
import {
  assertFoldExecutionOrder,
  assertWalkForwardFoldTransition,
  assertWalkForwardRunCanExecute,
  canExecuteWalkForwardRun,
  canTransitionWalkForwardFold,
  isWalkForwardFoldTerminal,
  parseWalkForwardFoldStatus,
} from "../../../../server/research/walkForward/lifecycle";
import { selectFoldCandidate } from "../../../../server/research/walkForward/selection";
import { EMPTY_WALK_FORWARD_METRIC_STAT } from "../../../../server/research/walkForward/types";
import type {
  WalkForwardFoldSchedule,
  WalkForwardFoldView,
  WalkForwardWindowConfig,
} from "../../../../server/research/walkForward/types";
import {
  assertFoldsWithinDatasetRange,
  computeWalkForwardScheduleFingerprint,
  planWalkForwardFolds,
} from "../../../../server/research/walkForward/windowSchedule";

// ---------------------------------------------------------------------------
// 夹具：合成交易日序列（只排掉周末 ⇒ 确定性、无节假日表依赖）
// ---------------------------------------------------------------------------

/** 从 `startIso` 起取 `count` 个工作日（UTC 口径，纯函数）。 */
function weekdays(startIso: string, count: number): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00.000Z`);
  while (out.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** 60 个交易日（2025-01-01 起的工作日）。 */
const DATES = weekdays("2025-01-01", 60);

const BASE_CONFIG: WalkForwardWindowConfig = {
  startDate: DATES[0]!,
  endDate: DATES[DATES.length - 1]!,
  isWindowDays: 10,
  oosWindowDays: 5,
  stepDays: 5,
  windowMode: "ROLLING",
};

/** 抓出领域码（无抛错 ⇒ 空数组）。 */
function codesOf(fn: () => unknown): string[] {
  try {
    fn();
    return [];
  } catch (error) {
    if (error instanceof ResearchValidationError) return error.issues.map((issue) => issue.code);
    throw error;
  }
}

/**
 * 参考实现（**独立于被测代码**）：按规格 §4 直接算第 k 个 Fold 的下标。
 *
 * `ROLLING` 下 IS 起点 = k×step；`EXPANDING` 下 IS 起点恒为 0。
 */
function expectedSplit(k: number, cfg: WalkForwardWindowConfig) {
  const step = cfg.stepDays;
  const gap = cfg.gapDays ?? 0;
  const advance = k * step;
  const trainStart = cfg.windowMode === "EXPANDING" ? 0 : advance;
  const trainEnd = advance + cfg.isWindowDays;
  const testStart = trainEnd + gap;
  const testEnd = testStart + cfg.oosWindowDays;
  return {
    isStart: DATES[trainStart]!,
    isEnd: DATES[trainEnd - 1]!,
    oosStart: DATES[testStart]!,
    oosEnd: DATES[testEnd - 1]!,
    isTradingDays: trainEnd - trainStart,
    oosTradingDays: cfg.oosWindowDays,
  };
}

/** 期望的 Fold 个数（testEnd <= total 的最大 k + 1）。 */
function expectedFoldCount(cfg: WalkForwardWindowConfig): number {
  const gap = cfg.gapDays ?? 0;
  let k = 0;
  while (true) {
    const advance = k * cfg.stepDays;
    const testEnd = advance + cfg.isWindowDays + gap + cfg.oosWindowDays;
    if (testEnd > DATES.length) return k;
    k += 1;
  }
}

// ---------------------------------------------------------------------------
// §4 Window Contract
// ---------------------------------------------------------------------------

describe("§4 Window Contract：ROLLING / EXPANDING / 步长 / 边界", () => {
  it("ROLLING：IS 定长且起点随步长推进，四端点与参考实现逐字相等", () => {
    const folds = planWalkForwardFolds({ config: BASE_CONFIG, tradeDates: DATES });
    expect(folds.length).toBe(expectedFoldCount(BASE_CONFIG));
    expect(folds.length).toBeGreaterThanOrEqual(2);
    folds.forEach((fold, k) => {
      const want = expectedSplit(k, BASE_CONFIG);
      expect({
        isStart: fold.isStart,
        isEnd: fold.isEnd,
        oosStart: fold.oosStart,
        oosEnd: fold.oosEnd,
        isTradingDays: fold.isTradingDays,
        oosTradingDays: fold.oosTradingDays,
      }).toEqual(want);
    });
  });

  it("EXPANDING：IS 起点恒为 0、末点扩张（等价既有几何的 anchored）", () => {
    const cfg: WalkForwardWindowConfig = { ...BASE_CONFIG, windowMode: "EXPANDING" };
    const folds = planWalkForwardFolds({ config: cfg, tradeDates: DATES });
    expect(folds.length).toBe(expectedFoldCount(cfg));
    folds.forEach((fold, k) => {
      const want = expectedSplit(k, cfg);
      expect(fold.isStart).toBe(DATES[0]);
      expect(fold.isEnd).toBe(want.isEnd);
      expect(fold.oosStart).toBe(want.oosStart);
      expect(fold.isTradingDays).toBe(want.isTradingDays);
    });
    // 单调扩张：IS 长度严格递增，且第 0 个与 ROLLING 的第 0 个完全相同
    expect(folds[1]!.isTradingDays).toBeGreaterThan(folds[0]!.isTradingDays);
    expect(folds[0]!.isStart).toBe(expectedSplit(0, cfg).isStart);
  });

  it("🔴 oosStart 是 isEnd 的**下一个交易日**（交易日相邻，不是日历天相邻）", () => {
    const folds = planWalkForwardFolds({ config: BASE_CONFIG, tradeDates: DATES });
    const indexOf = new Map(DATES.map((date, position) => [date, position]));
    for (const fold of folds) {
      const isEndIndex = indexOf.get(fold.isEnd)!;
      const oosStartIndex = indexOf.get(fold.oosStart)!;
      expect(oosStartIndex).toBe(isEndIndex + 1);
    }
  });

  it("同 Fold 内 IS 与 OOS 交易日集合无交集；跨 Fold 的 OOS 段单调推进", () => {
    const folds = planWalkForwardFolds({ config: BASE_CONFIG, tradeDates: DATES });
    for (const fold of folds) {
      const isSet = new Set(fold.isTradeDates);
      expect(fold.oosTradeDates.filter((date) => isSet.has(date))).toEqual([]);
      expect(fold.oosTradeDates.length).toBe(BASE_CONFIG.oosWindowDays);
    }
    for (let k = 1; k < folds.length; k += 1) {
      expect(folds[k]!.oosStart > folds[k - 1]!.oosStart).toBe(true);
      expect(folds[k]!.oosEnd > folds[k - 1]!.oosEnd).toBe(true);
    }
  });

  it("gap 把 OOS 推开：gap=3 时 IS 与 OOS 之间空出 3 个交易日（且这些日子不属于任何一侧）", () => {
    const cfg: WalkForwardWindowConfig = { ...BASE_CONFIG, gapDays: 3 };
    const folds = planWalkForwardFolds({ config: cfg, tradeDates: DATES });
    const fold = folds[0]!;
    expect(fold.gapTradeDates.length).toBe(3);
    expect(fold.oosStart).toBe(expectedSplit(0, cfg).oosStart);
    const isSet = new Set(fold.isTradeDates);
    expect(fold.gapTradeDates.some((date) => isSet.has(date))).toBe(false);
    expect(fold.oosTradeDates.some((date) => fold.gapTradeDates.includes(date))).toBe(false);
  });

  it("embargo 从 IS 尾部剔除：searchTradeDates = IS − embargo，且 embargo 段不参与搜索", () => {
    const cfg: WalkForwardWindowConfig = { ...BASE_CONFIG, isEmbargoDays: 2 };
    const folds = planWalkForwardFolds({ config: cfg, tradeDates: DATES });
    const fold = folds[0]!;
    expect(fold.isTradeDates.length).toBe(BASE_CONFIG.isWindowDays);
    expect(fold.embargoTradeDates.length).toBe(2);
    expect(fold.searchTradeDates.length).toBe(BASE_CONFIG.isWindowDays - 2);
    expect(fold.searchTradeDates).toEqual(fold.isTradeDates.slice(0, -2));
    expect(fold.embargoTradeDates).toEqual(fold.isTradeDates.slice(-2));
  });

  it("stepDays 决定 Fold 密度：step 变大 ⇒ Fold 变少且 IS 推进更快", () => {
    const wide: WalkForwardWindowConfig = { ...BASE_CONFIG, stepDays: 10 };
    const narrow = planWalkForwardFolds({ config: BASE_CONFIG, tradeDates: DATES });
    const wideFolds = planWalkForwardFolds({ config: wide, tradeDates: DATES });
    expect(wideFolds.length).toBeLessThan(narrow.length);
    expect(wideFolds[1]!.isStart).toBe(DATES[10]);
  });

  it("maxFolds 是**上限**（生成前强制，不截断语义）", () => {
    const cfg: WalkForwardWindowConfig = { ...BASE_CONFIG, maxFolds: 3 };
    const folds = planWalkForwardFolds({ config: cfg, tradeDates: DATES });
    expect(folds.length).toBe(3);
    expect(folds.map((fold) => fold.isStart)).toEqual([
      expectedSplit(0, cfg).isStart,
      expectedSplit(1, cfg).isStart,
      expectedSplit(2, cfg).isStart,
    ]);
  });
});

// ---------------------------------------------------------------------------
// §4 非法配置（响亮失败，绝不静默返回空）
// ---------------------------------------------------------------------------

describe("§4 非法配置：响亮失败且给出本域领域码", () => {
  it("取样区间倒挂 ⇒ WALK_FORWARD_WINDOW_CONFIG_INVALID", () => {
    const cfg: WalkForwardWindowConfig = { ...BASE_CONFIG, startDate: DATES[40]!, endDate: DATES[3]! };
    expect(codesOf(() => planWalkForwardFolds({ config: cfg, tradeDates: DATES }))).toContain(
      "WALK_FORWARD_WINDOW_CONFIG_INVALID",
    );
  });

  it("embargo 吞掉整个 IS ⇒ WALK_FORWARD_EMBARGO_EXCEEDS_IS_WINDOW", () => {
    const cfg: WalkForwardWindowConfig = { ...BASE_CONFIG, isWindowDays: 5, isEmbargoDays: 5 };
    expect(codesOf(() => planWalkForwardFolds({ config: cfg, tradeDates: DATES }))).toContain(
      "WALK_FORWARD_EMBARGO_EXCEEDS_IS_WINDOW",
    );
  });

  it("交易日不足以容纳第 0 个窗口 ⇒ 结构化抛错（不是返回空排程）", () => {
    const cfg: WalkForwardWindowConfig = {
      ...BASE_CONFIG,
      isWindowDays: 40,
      oosWindowDays: 30,
      startDate: DATES[0]!,
      endDate: DATES[59]!,
    };
    const codes = codesOf(() => planWalkForwardFolds({ config: cfg, tradeDates: DATES }));
    expect(codes.length).toBeGreaterThan(0);
    expect(codes).toContain("WFO19_SPLIT_INSUFFICIENT_DATASET");
  });

  it("Fold 越出数据集可用窗口 ⇒ WALK_FORWARD_WINDOW_OUT_OF_DATASET_RANGE（创建时就拒，不等到执行）", () => {
    const folds = planWalkForwardFolds({ config: BASE_CONFIG, tradeDates: DATES });
    expect(
      codesOf(() =>
        assertFoldsWithinDatasetRange({
          folds,
          datasetWindow: { startDate: DATES[0]!, endDate: DATES[20]! },
        }),
      ),
    ).toContain("WALK_FORWARD_WINDOW_OUT_OF_DATASET_RANGE");
  });

  it("数据集可用窗口覆盖全部 Fold ⇒ 通过", () => {
    const folds = planWalkForwardFolds({ config: BASE_CONFIG, tradeDates: DATES });
    expect(
      codesOf(() =>
        assertFoldsWithinDatasetRange({
          folds,
          datasetWindow: { startDate: DATES[0]!, endDate: DATES[DATES.length - 1]! },
        }),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §16 确定性
// ---------------------------------------------------------------------------

describe("§16 确定性：同输入 ⇒ 逐字节相同的排程指纹", () => {
  const fingerprint = (config: WalkForwardWindowConfig): string =>
    computeWalkForwardScheduleFingerprint({
      config,
      tradeDates: DATES,
      folds: planWalkForwardFolds({ config, tradeDates: DATES }),
    });

  it("两次独立计算（含深拷贝输入）得到同一指纹", () => {
    const first = fingerprint({ ...BASE_CONFIG });
    const second = fingerprint(JSON.parse(JSON.stringify(BASE_CONFIG)) as WalkForwardWindowConfig);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("任一确定性输入变化都会改变指纹（step / mode / embargo）", () => {
    const base = fingerprint(BASE_CONFIG);
    expect(fingerprint({ ...BASE_CONFIG, stepDays: 6 })).not.toBe(base);
    expect(fingerprint({ ...BASE_CONFIG, windowMode: "EXPANDING" })).not.toBe(base);
    expect(fingerprint({ ...BASE_CONFIG, isEmbargoDays: 1 })).not.toBe(base);
  });

  it("指纹与「Run 身份 / 时间戳」无关：同一 config 在不同时刻调用结果相同（无 Date.now 依赖）", () => {
    const a = fingerprint(BASE_CONFIG);
    const b = fingerprint(BASE_CONFIG);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// §5 生命周期
// ---------------------------------------------------------------------------

describe("§5 生命周期：Fold 状态机 + Run 执行资格（本域唯一收紧）", () => {
  it("Fold 正向链路逐步合法；同态重放视为幂等", () => {
    const chain = [
      "WINDOW_CREATED",
      "SEARCH_RUNNING",
      "SEARCH_COMPLETED",
      "CANDIDATE_FROZEN",
      "OOS_RUNNING",
      "OOS_COMPLETED",
    ] as const;
    for (let i = 1; i < chain.length; i += 1) {
      expect(canTransitionWalkForwardFold(chain[i - 1]!, chain[i]!)).toBe(true);
    }
    expect(canTransitionWalkForwardFold("SEARCH_RUNNING", "SEARCH_RUNNING")).toBe(true);
  });

  it("终态无出边；跳级与回退一律响亮拒绝", () => {
    expect(isWalkForwardFoldTerminal("OOS_COMPLETED")).toBe(true);
    expect(isWalkForwardFoldTerminal("FAILED")).toBe(true);
    expect(isWalkForwardFoldTerminal("CANDIDATE_FROZEN")).toBe(false);
    expect(canTransitionWalkForwardFold("OOS_COMPLETED", "SEARCH_RUNNING")).toBe(false);
    expect(canTransitionWalkForwardFold("FAILED", "WINDOW_CREATED")).toBe(false);
    expect(canTransitionWalkForwardFold("WINDOW_CREATED", "OOS_RUNNING")).toBe(false);
    expect(
      codesOf(() => assertWalkForwardFoldTransition("SEARCH_COMPLETED", "WINDOW_CREATED")),
    ).toContain("WALK_FORWARD_FOLD_STATUS_TRANSITION_INVALID");
  });

  it("非法 Fold 状态不静默回落成 WINDOW_CREATED", () => {
    expect(codesOf(() => parseWalkForwardFoldStatus("BOGUS"))).toContain(
      "WALK_FORWARD_FOLD_STATUS_INVALID",
    );
    expect(parseWalkForwardFoldStatus("OOS_COMPLETED")).toBe("OOS_COMPLETED");
  });

  it("🔴 Run 执行资格：CREATED/FAILED/CANCELLED 可执行，COMPLETED 必须幂等返回而不是重跑", () => {
    expect(canExecuteWalkForwardRun("CREATED")).toBe(true);
    expect(canExecuteWalkForwardRun("FAILED")).toBe(true);
    expect(canExecuteWalkForwardRun("CANCELLED")).toBe(true);
    expect(canExecuteWalkForwardRun("COMPLETED")).toBe(false);
    expect(canExecuteWalkForwardRun("RUNNING")).toBe(false);
    expect(codesOf(() => assertWalkForwardRunCanExecute("COMPLETED"))).toContain(
      "WALK_FORWARD_RUN_NOT_EXECUTABLE",
    );
    expect(codesOf(() => assertWalkForwardRunCanExecute("RUNNING"))).toContain(
      "WALK_FORWARD_RUN_NOT_EXECUTABLE",
    );
  });

  it("串行纪律：要跑第 k 个 Fold 时，更早的 Fold 必须都已终态", () => {
    expect(
      codesOf(() =>
        assertFoldExecutionOrder({ foldIndex: 1, statuses: ["SEARCH_RUNNING", "WINDOW_CREATED"] }),
      ),
    ).toContain("WALK_FORWARD_FOLD_ORDER_INVALID");
    expect(
      codesOf(() =>
        assertFoldExecutionOrder({ foldIndex: 2, statuses: ["WINDOW_CREATED", "WINDOW_CREATED", "WINDOW_CREATED"] }),
      ),
    ).toContain("WALK_FORWARD_FOLD_ORDER_INVALID");
    expect(
      codesOf(() =>
        assertFoldExecutionOrder({ foldIndex: 1, statuses: ["OOS_COMPLETED", "WINDOW_CREATED"] }),
      ),
    ).toEqual([]);
    expect(
      codesOf(() =>
        assertFoldExecutionOrder({ foldIndex: 2, statuses: ["OOS_COMPLETED", "FAILED", "WINDOW_CREATED"] }),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §11 泄漏守卫（本任务核心验收条件）
// ---------------------------------------------------------------------------

function fixtureFolds(): readonly WalkForwardFoldSchedule[] {
  return planWalkForwardFolds({
    config: { ...BASE_CONFIG, isEmbargoDays: 2 },
    tradeDates: DATES,
  });
}

/** 干净基线：全部判据通过（`index` 指定要检查哪个 Fold）。 */
function cleanGuardInput(folds: readonly WalkForwardFoldSchedule[], index = 0) {
  const fold = folds[index]!;
  return {
    fold,
    searchRunWindow: { startDate: fold.isStart, endDate: fold.isEnd },
    searchTradeDates: fold.searchTradeDates,
    oosRunWindow: { startDate: fold.oosStart, endDate: fold.oosEnd },
    datasetWindow: { startDate: DATES[0]!, endDate: DATES[DATES.length - 1]! },
    allFolds: folds,
  };
}

describe("§11 Leakage Guard：五类泄漏逐一被抓（且干净基线通过）", () => {
  it("干净基线：搜索 ⊆ IS、IS < OOS、OOS 在数据集内、OOS Run 窗口与排程相等 ⇒ 通过", () => {
    const folds = fixtureFolds();
    expect(codesOf(() => assertFoldLeakageGuard(cleanGuardInput(folds)))).toEqual([]);
  });

  it("① 搜索窗口越出 IS 右端（哪怕只多一个交易日）⇒ WALK_FORWARD_SEARCH_WINDOW_EXCEEDS_IS", () => {
    const folds = fixtureFolds();
    const fold = folds[0]!;
    // 只伸到 `oosStart`（= isEnd 的下一个交易日）—— 单看这一条就足以越界
    const codes = codesOf(() =>
      assertFoldLeakageGuard({
        ...cleanGuardInput(folds),
        searchRunWindow: { startDate: fold.isStart, endDate: fold.oosStart },
      }),
    );
    expect(codes).toContain("WALK_FORWARD_SEARCH_WINDOW_EXCEEDS_IS");
  });

  it("① 搜索窗口早于 IS 左端（偷偷往前取数）同样被抓", () => {
    const folds = fixtureFolds();
    // 取第 1 个 Fold：它的 isStart = D[5]，往左伸到 D[0] 即越界
    const base = cleanGuardInput(folds, 1);
    expect(base.fold.isStart).toBe(DATES[5]);
    expect(
      codesOf(() =>
        assertFoldLeakageGuard({
          ...base,
          searchRunWindow: { startDate: DATES[0]!, endDate: base.fold.isEnd },
        }),
      ),
    ).toContain("WALK_FORWARD_SEARCH_WINDOW_EXCEEDS_IS");
  });

  it("④ OOS Run 的窗口与排程不一致（偷换一个更有利的窗口）⇒ WALK_FORWARD_OOS_WINDOW_MISMATCH", () => {
    const folds = fixtureFolds();
    const fold = folds[0]!;
    expect(
      codesOf(() =>
        assertFoldLeakageGuard({
          ...cleanGuardInput(folds),
          oosRunWindow: { startDate: fold.oosStart, endDate: folds[1]!.oosEnd },
        }),
      ),
    ).toContain("WALK_FORWARD_OOS_WINDOW_MISMATCH");
  });

  it("⑤ 搜索用到了不属于本 Fold IS 的交易日 ⇒ WALK_FORWARD_SEARCH_DATES_OUTSIDE_IS", () => {
    const folds = fixtureFolds();
    const fold = folds[0]!;
    const leaking = [...fold.searchTradeDates, folds[1]!.oosStart];
    expect(
      codesOf(() => assertFoldLeakageGuard({ ...cleanGuardInput(folds), searchTradeDates: leaking })),
    ).toContain("WALK_FORWARD_SEARCH_DATES_OUTSIDE_IS");
  });

  it("🔴 ⑥ 搜索窗口伸进**更晚** Fold 的区间 ⇒ WALK_FORWARD_FUTURE_DATA_LEAK（规格 §11 明禁的形态）", () => {
    const folds = fixtureFolds();
    const codes = codesOf(() =>
      assertFoldLeakageGuard({
        ...cleanGuardInput(folds),
        // 直接覆盖到 Fold 1 的 OOS 末端 ⇒ 搜索看到了后续 Fold 的数据
        searchRunWindow: { startDate: folds[0]!.isStart, endDate: folds[1]!.oosEnd },
      }),
    );
    expect(codes).toContain("WALK_FORWARD_FUTURE_DATA_LEAK");
  });

  it("③ OOS 越出数据集可用区间 ⇒ WALK_FORWARD_WINDOW_OUT_OF_DATASET_RANGE", () => {
    const folds = fixtureFolds();
    expect(
      codesOf(() =>
        assertFoldLeakageGuard({
          ...cleanGuardInput(folds),
          datasetWindow: { startDate: DATES[0]!, endDate: DATES[12]! },
        }),
      ),
    ).toContain("WALK_FORWARD_WINDOW_OUT_OF_DATASET_RANGE");
  });

  it("② IS 与 OOS 倒挂（isEnd >= oosStart）⇒ WALK_FORWARD_IS_OOS_NOT_ORDERED", () => {
    const folds = fixtureFolds();
    const fold = folds[0]!;
    expect(
      codesOf(() =>
        assertFoldLeakageGuard({
          ...cleanGuardInput(folds),
          fold: { ...fold, oosStart: fold.isEnd },
        }),
      ),
    ).toContain("WALK_FORWARD_IS_OOS_NOT_ORDERED");
  });

  it("🔴 独立性：同一 Search Run 被两个 Fold 复用 ⇒ WALK_FORWARD_SEARCH_NOT_INDEPENDENT", () => {
    const folds = fixtureFolds();
    const entries = folds.slice(0, 3).map((fold) => ({
      foldIndex: fold.foldIndex,
      searchRunId: fold.foldIndex === 2 ? "PSRUN-shared" : "PSRUN-shared",
      searchWindow: { startDate: fold.isStart, endDate: fold.isEnd },
    }));
    expect(codesOf(() => assertIndependentFoldSearches({ entries }))).toContain(
      "WALK_FORWARD_SEARCH_NOT_INDEPENDENT",
    );
  });

  it("独立性：每个 Fold 各自一条 Search Run ⇒ 通过（`null` 不参与比对）", () => {
    const folds = fixtureFolds();
    expect(
      codesOf(() =>
        assertIndependentFoldSearches({
          entries: folds.slice(0, 3).map((fold) => ({
            foldIndex: fold.foldIndex,
            searchRunId: `PSRUN-${String(fold.foldIndex)}`,
            searchWindow: { startDate: fold.isStart, endDate: fold.isEnd },
          })),
        }),
      ),
    ).toEqual([]);
    expect(
      codesOf(() =>
        assertIndependentFoldSearches({
          entries: [
            { foldIndex: 0, searchRunId: null, searchWindow: null },
            { foldIndex: 1, searchRunId: null, searchWindow: null },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §10 冻结与不可变性复核
// ---------------------------------------------------------------------------

describe("§10/§16 冻结：参数 hash 重算复核 + 策略/数据集漂移", () => {
  const PARAMS = { fastWindow: 5, slowWindow: 20, threshold: 0.5 };

  it("hash 由**重算**得出，而不是被信任：正确 hash 通过并原样返回", () => {
    const hash = recomputeParameterHash({
      strategyId: "cand-1",
      strategyVersion: "1.0.0",
      parameters: PARAMS,
    });
    expect(
      assertParameterHashRecomputes({
        foldIndex: 0,
        searchRunId: "PSRUN-1",
        combinationIndex: 0,
        parameterHash: hash,
        parameters: PARAMS,
        strategyId: "cand-1",
        strategyVersion: "1.0.0",
      }),
    ).toBe(hash);
  });

  it("hash 与参数快照不自洽 ⇒ WALK_FORWARD_PARAMETER_HASH_MISMATCH（FAIL LOUDLY，不自动修复）", () => {
    expect(
      codesOf(() =>
        assertParameterHashRecomputes({
          foldIndex: 0,
          searchRunId: "PSRUN-1",
          combinationIndex: 0,
          parameterHash: "0".repeat(64),
          parameters: PARAMS,
          strategyId: "cand-1",
          strategyVersion: "1.0.0",
        }),
      ),
    ).toContain("WALK_FORWARD_PARAMETER_HASH_MISMATCH");
  });

  it("策略定义指纹漂移 ⇒ WALK_FORWARD_STRATEGY_DEFINITION_DRIFT；一侧缺失则如实跳过", () => {
    expect(
      codesOf(() => assertStrategyFingerprintUnchanged({ label: "run", frozen: "aaa", current: "bbb" })),
    ).toContain("WALK_FORWARD_STRATEGY_DEFINITION_DRIFT");
    expect(
      codesOf(() => assertStrategyFingerprintUnchanged({ label: "run", frozen: "aaa", current: "aaa" })),
    ).toEqual([]);
    expect(
      codesOf(() => assertStrategyFingerprintUnchanged({ label: "run", frozen: null, current: "bbb" })),
    ).toEqual([]);
  });

  it("数据集坐标漂移 ⇒ WALK_FORWARD_DATASET_VERSION_DRIFT（含「冻结为空、现在有值」）", () => {
    expect(
      codesOf(() => assertDatasetVersionUnchanged({ label: "run", frozen: 1, current: 2 })),
    ).toContain("WALK_FORWARD_DATASET_VERSION_DRIFT");
    expect(
      codesOf(() => assertDatasetVersionUnchanged({ label: "run", frozen: null, current: 7 })),
    ).toContain("WALK_FORWARD_DATASET_VERSION_DRIFT");
    expect(
      codesOf(() => assertDatasetVersionUnchanged({ label: "run", frozen: 3, current: 3 })),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §7 Candidate Selection Policy（显式、零指标、可审计）
// ---------------------------------------------------------------------------

describe("§7 候选选择：只有两种显式策略，均不读取任何收益 / 风险指标", () => {
  const STRATEGY = { strategyId: "cand-1", strategyVersion: "1.0.0" };
  const PARAMS_A = { fastWindow: 3, threshold: 0.1 };
  const PARAMS_B = { fastWindow: 8, threshold: 0.9 };
  const HASH_A = recomputeParameterHash({ ...STRATEGY, parameters: PARAMS_A });
  const HASH_B = recomputeParameterHash({ ...STRATEGY, parameters: PARAMS_B });

  const combos = [
    { combinationIndex: 0, parameterHash: HASH_A, parametersJson: JSON.stringify(PARAMS_A) },
    { combinationIndex: 1, parameterHash: HASH_B, parametersJson: PARAMS_B },
  ];
  const results = [
    { combinationIndex: 0, parameterHash: HASH_A, status: "FAILED" },
    { combinationIndex: 1, parameterHash: HASH_B, status: "SUCCEEDED" },
  ];

  it("FIRST_ELIGIBLE_COMBINATION：取**编号最小且有成功结果**的组合（纯位置规则）", () => {
    const picked = selectFoldCandidate({
      foldIndex: 0,
      searchRunId: "PSRUN-1",
      policy: { kind: "FIRST_ELIGIBLE_COMBINATION" },
      combinations: combos,
      results,
      ...STRATEGY,
    });
    expect(picked.combinationIndex).toBe(1);
    expect(picked.parameterHash).toBe(HASH_B);
    expect(picked.hashRecomputed).toBe(HASH_B);
    // 参数快照原样来自源组合行（含「对象形态」的 parametersJson）
    expect(picked.parameters).toEqual(PARAMS_B);
  });

  it("FIRST_ELIGIBLE_COMBINATION：全部失败 ⇒ WALK_FORWARD_NO_ELIGIBLE_CANDIDATE（不代选）", () => {
    expect(
      codesOf(() =>
        selectFoldCandidate({
          foldIndex: 0,
          searchRunId: "PSRUN-1",
          policy: { kind: "FIRST_ELIGIBLE_COMBINATION" },
          combinations: combos,
          results: results.map((row) => ({ ...row, status: "FAILED" })),
          ...STRATEGY,
        }),
      ),
    ).toContain("WALK_FORWARD_NO_ELIGIBLE_CANDIDATE");
  });

  it("组合行为空 ⇒ WALK_FORWARD_SEARCH_HAS_NO_COMBINATION", () => {
    expect(
      codesOf(() =>
        selectFoldCandidate({
          foldIndex: 0,
          searchRunId: "PSRUN-1",
          policy: { kind: "FIRST_ELIGIBLE_COMBINATION" },
          combinations: [],
          results: [],
          ...STRATEGY,
        }),
      ),
    ).toContain("WALK_FORWARD_SEARCH_HAS_NO_COMBINATION");
  });

  it("EXPLICIT_PARAMETER_HASH：命中且 SUCCEEDED ⇒ 按人指定的那一个冻结（含字符串形态参数快照）", () => {
    const picked = selectFoldCandidate({
      foldIndex: 0,
      searchRunId: "PSRUN-1",
      policy: { kind: "EXPLICIT_PARAMETER_HASH", parameterHash: HASH_A },
      combinations: [{ ...combos[0]!, parametersJson: JSON.stringify(PARAMS_A) }],
      results: [{ combinationIndex: 0, parameterHash: HASH_A, status: "SUCCEEDED" }],
      ...STRATEGY,
    });
    expect(picked.parameterHash).toBe(HASH_A);
    expect(picked.parameters).toEqual(PARAMS_A);
  });

  it("EXPLICIT 找不到 ⇒ _NOT_FOUND；找到但非 SUCCEEDED ⇒ _NOT_ELIGIBLE（都不回落）", () => {
    expect(
      codesOf(() =>
        selectFoldCandidate({
          foldIndex: 0,
          searchRunId: "PSRUN-1",
          policy: { kind: "EXPLICIT_PARAMETER_HASH", parameterHash: "f".repeat(64) },
          combinations: combos,
          results,
          ...STRATEGY,
        }),
      ),
    ).toContain("WALK_FORWARD_EXPLICIT_CANDIDATE_NOT_FOUND");
    expect(
      codesOf(() =>
        selectFoldCandidate({
          foldIndex: 0,
          searchRunId: "PSRUN-1",
          policy: { kind: "EXPLICIT_PARAMETER_HASH", parameterHash: HASH_A },
          combinations: combos,
          results,
          ...STRATEGY,
        }),
      ),
    ).toContain("WALK_FORWARD_EXPLICIT_CANDIDATE_NOT_ELIGIBLE");
  });

  it("组合行未按 combinationIndex 升序 ⇒ WALK_FORWARD_COMBINATION_ORDER_UNSTABLE（数据库不保证顺序）", () => {
    expect(
      codesOf(() =>
        selectFoldCandidate({
          foldIndex: 0,
          searchRunId: "PSRUN-1",
          policy: { kind: "FIRST_ELIGIBLE_COMBINATION" },
          combinations: [...combos].reverse(),
          results,
          ...STRATEGY,
        }),
      ),
    ).toContain("WALK_FORWARD_COMBINATION_ORDER_UNSTABLE");
  });
});

// ---------------------------------------------------------------------------
// §12 汇总（只做描述性统计；null ≠ 0）
// ---------------------------------------------------------------------------

/** 造一个最小但形状完整的 Fold 视图。 */
function makeFold(overrides: {
  foldIndex: number;
  status?: WalkForwardFoldView["status"];
  outcome?: WalkForwardFoldView["outcome"];
  isMetrics?: WalkForwardFoldView["isMetrics"];
  oosMetrics?: WalkForwardFoldView["oosMetrics"];
  comparison?: WalkForwardFoldView["comparison"];
  errorCode?: string | null;
}): WalkForwardFoldView {
  return {
    recordKind: "WALK_FORWARD_VALIDATION_FOLD",
    recordVersion: 1,
    walkForwardRunId: "WFV-20250101-aaaaaaaa",
    foldIndex: overrides.foldIndex,
    isStart: "2025-01-01",
    isEnd: "2025-01-14",
    oosStart: "2025-01-15",
    oosEnd: "2025-01-21",
    sourceSearchRunId: `PSRUN-${String(overrides.foldIndex)}`,
    searchWindow: { startDate: "2025-01-01", endDate: "2025-01-14" },
    sourceCombinationIndex: 0,
    parameterHash: "a".repeat(64),
    resolvedParameterSet: { fastWindow: 5 },
    strategyVersionId: "cand-1@1.0.0",
    strategyFingerprint: "b".repeat(64),
    datasetVersionId: 7,
    oosRunId: `OOSV-20250101-${String(overrides.foldIndex)}`,
    oosWindow: { startDate: "2025-01-15", endDate: "2025-01-21" },
    status: overrides.status ?? "OOS_COMPLETED",
    outcome: overrides.outcome ?? "SUCCEEDED",
    isMetrics: overrides.isMetrics ?? null,
    isMetricsSource: "canonical",
    oosMetrics: overrides.oosMetrics ?? null,
    oosMetricsSource: "canonical",
    comparison: overrides.comparison ?? null,
    oosBacktestFingerprint: "c".repeat(64),
    executionFingerprint: "d".repeat(64),
    errorCode: overrides.errorCode ?? null,
    errorMessage: null,
    notes: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    completedAt: "2025-01-02T00:00:00.000Z",
  };
}

const METRIC_ROW = (total: number, tradeCount: number) => ({
  totalReturnPct: total,
  annualizedReturnPct: total * 2,
  maxDrawdownPct: 10,
  tradeCount,
  winRatePct: 50,
  profitFactor: 1.5,
});

describe("§12 汇总：只做描述性统计，且「不可用」与「等于 0」严格区分", () => {
  it("🔴 空集合 ⇒ 全 null + availableCount 0（绝不编造成 0）", () => {
    const stat = describeMetricStat([]);
    expect(stat).toEqual(EMPTY_WALK_FORWARD_METRIC_STAT);
    expect(stat.mean).toBeNull();
    expect(stat.median).toBeNull();
    expect(stat.observedMin).toBeNull();
    expect(stat.observedMax).toBeNull();
    expect(stat.availableCount).toBe(0);
    // 真实 0 与「没有值」必须可区分
    expect(describeMetricStat([0]).mean).toBe(0);
    expect(describeMetricStat([0]).mean).not.toBeNull();
  });

  it("数值序列的均值 / 中位数 / 观测区间按定义算（偶数个取中间两个的平均）", () => {
    expect(describeMetricStat([1, 2, 3, 4])).toEqual({
      availableCount: 4,
      mean: 2.5,
      median: 2.5,
      observedMin: 1,
      observedMax: 4,
    });
    expect(describeMetricStat([1, 2, 3]).median).toBe(2);
  });

  it("非有限数被剔除，不污染统计（NaN / Infinity 不进统计）", () => {
    const stat = describeMetricStat([1, Number.NaN, Number.POSITIVE_INFINITY, 3]);
    expect(stat.availableCount).toBe(2);
    expect(stat.mean).toBe(2);
  });

  it("计数诚实：SUCCEEDED 计入统计；FAILED / 成交不足**如实计数但不进统计**", () => {
    const folds = [
      makeFold({
        foldIndex: 0,
        outcome: "SUCCEEDED",
        isMetrics: METRIC_ROW(10, 12),
        oosMetrics: METRIC_ROW(4, 9),
        comparison: {
          comparableCount: 6,
          totalReturnPctDelta: -6,
          totalReturnPctRatio: 0.4,
          annualizedReturnPctDelta: -12,
          annualizedReturnPctRatio: 0.4,
          maxDrawdownPctDelta: 2,
          maxDrawdownPctRatio: 1.2,
          tradeCountDelta: -3,
          tradeCountRatio: 0.75,
          winRatePctDelta: -5,
          winRatePctRatio: 0.9,
          profitFactorDelta: -0.3,
          profitFactorRatio: 0.8,
          totalReturnDegradationPct: 6,
          drawdownChangePct: 2,
          tradeCountChange: -3,
          comparable: true,
          notes: [],
        },
      }),
      makeFold({
        foldIndex: 1,
        outcome: "INSUFFICIENT_TRADING_ACTIVITY",
        isMetrics: METRIC_ROW(8, 10),
        oosMetrics: METRIC_ROW(0, 0),
      }),
      makeFold({ foldIndex: 2, status: "FAILED", outcome: "FAILED", errorCode: "WALK_FORWARD_X" }),
    ];

    const aggregate = buildWalkForwardAggregate({
      walkForwardRunId: "WFV-20250101-aaaaaaaa",
      folds,
    });

    expect(aggregate.foldCount).toBe(3);
    // Fold0 / Fold1 的生命周期走完（status = OOS_COMPLETED）；Fold2 失败 ⇒ 只有 2 个完成
    expect(aggregate.completedFoldCount).toBe(2);
    expect(aggregate.failedFoldCount).toBe(1);
    expect(aggregate.insufficientTradingActivityCount).toBe(1);
    expect(aggregate.contributingFoldCount).toBe(1);

    // 只有 SUCCEEDED 的那一个进了统计
    expect(aggregate.isStats.totalReturnPct.availableCount).toBe(1);
    expect(aggregate.isStats.totalReturnPct.mean).toBe(10);
    expect(aggregate.oosStats.totalReturnPct.mean).toBe(4);
    // 成交不足的 Fold 的 0 笔**不**被当成「OOS 收益 = 0」混进来
    expect(aggregate.oosStats.tradeCount.availableCount).toBe(1);
    expect(aggregate.oosStats.tradeCount.mean).toBe(9);
    // 退化统计只有那一个贡献 Fold
    expect(aggregate.totalReturnDegradationPct.mean).toBe(6);
  });

  it("无任何贡献 Fold ⇒ 全部统计量为 null，且 notes 如实说明（不静默）", () => {
    const aggregate = buildWalkForwardAggregate({
      walkForwardRunId: "WFV-20250101-aaaaaaaa",
      folds: [makeFold({ foldIndex: 0, status: "FAILED", outcome: "FAILED", errorCode: "E" })],
    });
    expect(aggregate.contributingFoldCount).toBe(0);
    expect(aggregate.isStats.totalReturnPct.mean).toBeNull();
    expect(aggregate.oosStats.annualizedReturnPct.mean).toBeNull();
    expect(aggregate.totalReturnDegradationPct).toEqual(EMPTY_WALK_FORWARD_METRIC_STAT);
    expect(aggregate.notes.join("\n")).toContain("不编造 0");
  });

  it("🔴 汇总结果里**没有任何**排序 / 评级 / 推荐字段（接口层事实）", () => {
    const aggregate = buildWalkForwardAggregate({
      walkForwardRunId: "WFV-20250101-aaaaaaaa",
      folds: [makeFold({ foldIndex: 0, isMetrics: METRIC_ROW(10, 12), oosMetrics: METRIC_ROW(4, 9) })],
    });
    const keys = Object.keys(aggregate).join(" ").toLowerCase();
    for (const forbidden of ["best", "worst", "optimal", "recommend", "winner", "rank", "score"]) {
      expect(keys.includes(forbidden)).toBe(false);
    }
    expect(aggregate.notes.join("\n")).toContain("不排序");
  });

  it("Fold 序号必须连续且从 0 起（否则汇总的口径无从对齐）", () => {
    expect(
      codesOf(() =>
        buildWalkForwardAggregate({
          walkForwardRunId: "WFV-20250101-aaaaaaaa",
          folds: [makeFold({ foldIndex: 1 })],
        }),
      ),
    ).toContain("WALK_FORWARD_AGGREGATE_FOLD_INDEX_INVALID");
  });
});
