/**
 * WALK-FORWARD-001 — Leakage Guard（规格 §11，本任务的**核心验收条件**）。
 *
 * ## 要防的到底是什么
 *
 * 最危险的做法（规格 §11 专门点名）：
 *
 * ```text
 * ❌ 先跑一次覆盖整个区间的 Parameter Search，再把结果切成多个 OOS Fold
 * ```
 *
 * 那样每个 Fold 的「样本内搜索」实际上已经看过它自己的 OOS 段（乃至后续全部 Fold 的数据），
 * 而产物看起来**完全正常**（有搜索、有冻结、有样本外指标），只是结论毫无意义。
 *
 * 本域的正确做法（形状上就不可能泄漏）：
 *
 * ```text
 * ✅ Fold 1 IS Search → Fold 1 OOS
 * ✅ Fold 2 IS Search → Fold 2 OOS     ← 每 Fold **独立**建一条 Parameter Search Run
 * ✅ Fold 3 IS Search → Fold 3 OOS
 * ```
 *
 * ## 静态 + 运行时双重约束
 *
 * - **静态**（结构事实，可被测试断言）：本域**只**通过注入钩子 `runFoldSearch` 建搜索，
 *   而钩子请求体里带的是**该 Fold 的 IS 窗口**；本域自身**不 import** 任何搜索执行器、
 *   任何回测引擎（见 `tests/.../walkForwardBoundary.test.ts` 的 import 黑名单）。
 * - **运行时**（本文件）：每一步都回读**真实落库的行**再断言，而不是信任内存里的入参：
 *   搜索 Run 行的窗口必须 ⊆ 该 Fold 的 IS 窗口；搜索用到的交易日必须 ⊆ IS 交易日；
 *   OOS 窗口必须**恰好等于**该 Fold 的 OOS 窗口；OOS 窗口不得与任何更晚 Fold 的窗口相交。
 *
 * 铁律：任何一条不满足 ⇒ **响亮抛错**（领域码），**绝不自动修复、绝不降级继续**。
 */

import { ResearchValidationError } from "../experimentValidation";
import type { WalkForwardFoldSchedule } from "./types";

/** 一次断言要用的全部真实坐标（都来自落库的行，不是内存入参）。 */
export interface FoldLeakageGuardInput {
  readonly fold: WalkForwardFoldSchedule;
  /** 该 Fold 的搜索 Run 行上的窗口（**从库里读回**）。 */
  readonly searchRunWindow: { readonly startDate: string; readonly endDate: string } | null;
  /** 搜索实际使用的交易日（从搜索 Run 行 / 组合行读回；可为 null = 不可得）。 */
  readonly searchTradeDates: readonly string[] | null;
  /** 该 Fold 的 OOS Run 行上的窗口（**从库里读回**）。 */
  readonly oosRunWindow: { readonly startDate: string; readonly endDate: string } | null;
  /** 绑定数据集的可用窗口（含两端）；null = 无坐标，不校验。 */
  readonly datasetWindow: { readonly startDate: string; readonly endDate: string } | null;
  /** **全部** Fold 的排程（用于「不得读后续 Fold 数据」）。 */
  readonly allFolds: readonly WalkForwardFoldSchedule[];
}

/**
 * 断言单个 Fold 的泄漏守卫（FAIL FAST，一次性报出全部问题）。
 *
 * 六条判据（全部按 `YYYY-MM-DD` 字典序比较 = 时间序）：
 *   ① `searchStart >= isStart` ∧ `searchEnd <= isEnd`　⇒ `SearchEnd <= ISEnd`（规格 §11）
 *   ② `isEnd < oosStart`（几何层已保证，这里独立复核）
 *   ③ `oosEnd <= datasetEnd` ∧ `oosStart >= datasetStart`（若绑定了数据集）
 *   ④ `oosWindow` **恰好等于**该 Fold 的 oosStart/oosEnd（不得偷换窗口）
 *   ⑤ 搜索用到的**每一个交易日**都必须落在该 Fold 的 IS 交易日集合内
 *   ⑥ 搜索窗口不得与**任何更晚** Fold 的 **OOS 段**相交（≙ 未使用后续 Fold 的**评估数据**；
 *      相邻 Fold 的 IS 窗口重叠是 `ROLLING` 的正常形态，**不**判泄漏）
 */
export function assertFoldLeakageGuard(input: FoldLeakageGuardInput): void {
  const issues: { code: string; path: string; message: string }[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  const fold = input.fold;
  const prefix = `folds[${String(fold.foldIndex)}]`;

  // ① 搜索窗口必须落在该 Fold 的 IS 窗口内
  if (input.searchRunWindow !== null) {
    const { startDate, endDate } = input.searchRunWindow;
    if (startDate < fold.isStart || endDate > fold.isEnd) {
      issue(
        "WALK_FORWARD_SEARCH_WINDOW_EXCEEDS_IS",
        `${prefix}.searchRunWindow`,
        `搜索窗口必须落在该 Fold 的 IS 窗口内：搜索 ${startDate}..${endDate}，`
        + `IS ${fold.isStart}..${fold.isEnd}`,
      );
    }
  }

  // ② IS 必须严格早于 OOS
  if (fold.isEnd >= fold.oosStart) {
    issue(
      "WALK_FORWARD_IS_OOS_NOT_ORDERED",
      `${prefix}.oosStart`,
      `必须 isEnd < oosStart：isEnd=${fold.isEnd}，oosStart=${fold.oosStart}`,
    );
  }

  // ③ OOS 必须落在数据集可用区间内
  if (input.datasetWindow !== null) {
    const { startDate, endDate } = input.datasetWindow;
    if (fold.oosStart < startDate || fold.oosEnd > endDate) {
      issue(
        "WALK_FORWARD_WINDOW_OUT_OF_DATASET_RANGE",
        `${prefix}.oosWindow`,
        `OOS 窗口超出数据集可用窗口：OOS ${fold.oosStart}..${fold.oosEnd}，`
        + `数据集 ${startDate}..${endDate}`,
      );
    }
  }

  // ④ OOS Run 行上的窗口必须与排程完全一致（杜绝「悄悄换一个更有利的窗口」）
  if (input.oosRunWindow !== null) {
    if (
      input.oosRunWindow.startDate !== fold.oosStart
      || input.oosRunWindow.endDate !== fold.oosEnd
    ) {
      issue(
        "WALK_FORWARD_OOS_WINDOW_MISMATCH",
        `${prefix}.oosRunWindow`,
        `OOS Run 的窗口必须与排程逐字相等：OOS Run ${input.oosRunWindow.startDate}..`
        + `${input.oosRunWindow.endDate}，排程 ${fold.oosStart}..${fold.oosEnd}`,
      );
    }
  }

  // ⑤ 搜索用到的交易日必须全部落在该 Fold 的 IS 交易日集合里
  if (input.searchTradeDates !== null) {
    const allowed = new Set(fold.isTradeDates);
    const offenders = input.searchTradeDates.filter((date) => !allowed.has(date));
    if (offenders.length > 0) {
      issue(
        "WALK_FORWARD_SEARCH_DATES_OUTSIDE_IS",
        `${prefix}.searchTradeDates`,
        `搜索用到了不属于本 Fold IS 的交易日 ${String(offenders.length)} 个`
        + `（前 3 个：${offenders.slice(0, 3).join(", ")}）`,
      );
    }
  }

  // ⑥ 搜索窗口不得与任何**更晚** Fold 的 **OOS 段**相交
  //
  // 🔴 为什么比对的是「更晚 Fold 的 OOS 段」而**不是**它的整个区间（`isStart..oosEnd`）：
  //   `ROLLING` 且 `step < isWindowDays` 时，相邻 Fold 的 **IS 窗口本来就重叠**
  //   （例：step=5 / isWindowDays=10 ⇒ Fold0 的 IS = D[0..9]、Fold1 的 IS = D[5..14]）。
  //   那是 normal 的滚动形态 —— 那段数据对两个 Fold 而言都是「已经发生的过去」。
  //   真正构成泄漏的是「搜索看到了**属于某次评估**的数据」，即更晚 Fold 的 OOS 段
  //   （那段数据在被评估时才是「未来」）。⇒ 判据只比对 OOS 段，避免把正常重叠误判成泄漏。
  for (const later of input.allFolds) {
    if (later.foldIndex <= fold.foldIndex) continue;
    const laterOosStart = later.oosStart;
    const laterOosEnd = later.oosEnd;
    const searchStart = input.searchRunWindow?.startDate ?? fold.isStart;
    const searchEnd = input.searchRunWindow?.endDate ?? fold.isEnd;
    if (searchStart <= laterOosEnd && searchEnd >= laterOosStart) {
      issue(
        "WALK_FORWARD_FUTURE_DATA_LEAK",
        `${prefix}.searchRunWindow`,
        `本 Fold 的搜索窗口 ${searchStart}..${searchEnd} 与更晚 Fold `
        + `[${String(later.foldIndex)}] 的 **OOS 段** ${laterOosStart}..${laterOosEnd} **相交** ⇒`
        + " 搜索看到了后续 Fold 的评估数据（规格 §11 明禁）。"
        + "（注：相邻 Fold 的 IS 窗口重叠是 ROLLING 的正常形态，不构成泄漏。）",
      );
    }
  }

  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}

/**
 * 断言「每个 Fold 的搜索都是**独立发起**的」，而不是「一次全局搜索被切成多段」。
 *
 * 判据（结构事实，不看注释）：
 *   - 每个 Fold 的 `sourceSearchRunId` 必须**互不相同**（同一个 Run 被两个 Fold 复用
 *     = 典型的「一次搜索切多段」，规格 §11 明禁）；
 *   - 每个搜索 Run 的窗口必须落在**它自己那个 Fold** 的 IS 内（由调用方逐 Fold 断言）。
 */
export function assertIndependentFoldSearches(input: {
  readonly entries: readonly {
    readonly foldIndex: number;
    readonly searchRunId: string | null;
    readonly searchWindow: { readonly startDate: string; readonly endDate: string } | null;
  }[];
}): void {
  const issues: { code: string; path: string; message: string }[] = [];
  const seen = new Map<string, number>();
  for (const entry of input.entries) {
    if (entry.searchRunId === null) continue;
    const previous = seen.get(entry.searchRunId);
    if (previous !== undefined) {
      issues.push({
        code: "WALK_FORWARD_SEARCH_NOT_INDEPENDENT",
        path: `folds[${String(entry.foldIndex)}].sourceSearchRunId`,
        message:
          `Fold ${String(entry.foldIndex)} 与 Fold ${String(previous)} 复用了同一条 Parameter Search Run`
          + `（${entry.searchRunId}）⇒ 这就是「先跑一次全局搜索、再切成多个 Fold」的形态，`
          + "违反规格 §11；每个 Fold 必须**独立**发起自己的搜索。",
      });
    }
    seen.set(entry.searchRunId, entry.foldIndex);
  }
  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}

/** 泄漏守卫的可读说明（写进 Fold notes；不静默）。 */
export function describeFoldLeakageGuard(fold: WalkForwardFoldSchedule): string {
  return (
    `泄漏守卫通过：搜索窗口 ⊆ IS（${fold.isStart}..${fold.isEnd}，`
    + `可用于搜索 ${String(fold.searchTradeDates.length)} 个交易日`
    + (fold.embargoTradeDates.length > 0
      ? `，embargo 剔除 ${String(fold.embargoTradeDates.length)} 个`
      : "")
    + `）；isEnd(${fold.isEnd}) < oosStart(${fold.oosStart}) 严格成立；`
    + `OOS 只使用 ${fold.oosStart}..${fold.oosEnd}（${String(fold.oosTradingDays)} 个交易日）。`
  );
}
