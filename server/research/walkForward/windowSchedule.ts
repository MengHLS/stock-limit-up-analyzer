/**
 * WALK-FORWARD-001 — Window Contract（规格 §4）：把「配置」翻成「确定的 Fold 窗口」。
 *
 * ## 为什么这一层几乎全是复用
 *
 * 窗口几何（rolling / anchored + embargo + gap + 无重叠断言）**已经在仓库里存在**：
 * `server/research/walkForwardRun/windows.ts#generateWalkForwardSplits`（C-19.1），
 * 它已经是**纯函数 + 确定性 + 交易日锚定**，且每个窗口都跑
 * `assertWalkForwardSplitInvariants` 对「Test 严格晚于 Train 且无交集」做**运行时断言**。
 *
 * ⇒ 本文件**不重写窗口几何**（规格 §2.4：先查有没有现成 rolling / expanding 工具，避免重复实现），
 *   只做三件本域特有的事：
 *   1. **模式译名**：规格的 `ROLLING` / `EXPANDING` ⇒ 既有几何的 `rolling` / `anchored`
 *      （`anchored` = IS 起点恒为 0、末点随窗扩张 —— 与 `EXPANDING` 语义完全一致）；
 *   2. **端点投影**：把既有 `WalkForwardSplit` 投影成本域契约要求的
 *      `isStart / isEnd / oosStart / oosEnd` 四端点；
 *   3. **多 Fold 级不变量**：既有断言只保证「单个窗口内 Train/Test 不重叠」，
 *      本域再补「**跨 Fold** 不得出现 OOS 段回退 / 与更晚 Fold 的 IS 重叠」与
 *      「全部窗口必须落在数据集可用区间内」（规格 §11 泄漏守卫的静态部分）。
 *
 * 铁律：纯函数、无 IO / `Date.now` / `Math.random`；退化输入 → 结构化抛错，绝不静默返回空。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { ResearchValidationError } from "../experimentValidation";
import type { WalkForwardSplit, WalkForwardSplitConfig } from "../walkForwardRun/types";
import { generateWalkForwardSplits } from "../walkForwardRun/windows";
import type {
  WalkForwardFoldSchedule,
  WalkForwardFoldWindow,
  WalkForwardScheduleSnapshot,
  WalkForwardWindowConfig,
} from "./types";
import { WALK_FORWARD_METRICS_VERSION } from "./types";

// ---------------------------------------------------------------------------
// 模式译名（规格词表 ⇄ 既有几何词表）—— 唯一映射点
// ---------------------------------------------------------------------------

/** 规格 `windowMode` ⇒ 既有几何的 `mode`。唯一映射点，别在别处再写第二份。 */
export function toSplitMode(mode: WalkForwardWindowConfig["windowMode"]): WalkForwardSplitConfig["mode"] {
  switch (mode) {
    case "ROLLING":
      return "rolling";
    case "EXPANDING":
      return "anchored";
    default: {
      const exhaustive: never = mode;
      throw new ResearchValidationError([
        {
          code: "WALK_FORWARD_WINDOW_MODE_INVALID",
          path: "windowConfig.windowMode",
          message: `未登记的窗口模式：${String(exhaustive)}（期望 ROLLING | EXPANDING）`,
        },
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// 配置形态校验（在调用既有几何之前先给出本域口径的错误码）
// ---------------------------------------------------------------------------

/**
 * 校验窗口配置的空/倒挂/自相矛盾（纯形态，不做几何可行性判断 —— 那由几何层负责）。
 *
 * 逐条判据：
 *   ① `startDate <= endDate`（否则「取样区间」是空的，几何层会报「交易日不足」，
 *      但那个错误会掩盖真正的起因：区间倒挂）；
 *   ② `gapDays >= 0` / `isEmbargoDays >= 0`（schema 已保证，这里再兜一次防绕过 schema 的调用方）；
 *   ③ `isEmbargoDays < isWindowDays`（embargo 吞掉整个 IS ⇒ 优化段无交易日；
 *      几何层也会报 `WFO19_EMBARGO_EXCEEDS_TRAIN`，这里提前用本域错误码给出更贴近业务的说法）。
 */
export function assertWindowConfigWellFormed(config: WalkForwardWindowConfig): void {
  const issues: { code: string; path: string; message: string }[] = [];
  if (config.startDate > config.endDate) {
    issues.push({
      code: "WALK_FORWARD_WINDOW_CONFIG_INVALID",
      path: "windowConfig",
      message:
        `取样区间倒挂：startDate=${config.startDate} 晚于 endDate=${config.endDate}；`
        + "窗口排程无法在空区间上生成任何 Fold。",
    });
  }
  const gap = config.gapDays ?? 0;
  const embargo = config.isEmbargoDays ?? 0;
  if (!Number.isInteger(gap) || gap < 0) {
    issues.push({
      code: "WALK_FORWARD_WINDOW_CONFIG_INVALID",
      path: "windowConfig.gapDays",
      message: `gapDays 必须是 >= 0 的整数（交易日个数），实际 ${String(config.gapDays)}`,
    });
  }
  if (!Number.isInteger(embargo) || embargo < 0) {
    issues.push({
      code: "WALK_FORWARD_WINDOW_CONFIG_INVALID",
      path: "windowConfig.isEmbargoDays",
      message: `isEmbargoDays 必须是 >= 0 的整数（交易日个数），实际 ${String(config.isEmbargoDays)}`,
    });
  }
  if (embargo >= config.isWindowDays) {
    issues.push({
      code: "WALK_FORWARD_EMBARGO_EXCEEDS_IS_WINDOW",
      path: "windowConfig.isEmbargoDays",
      message:
        `isEmbargoDays=${String(embargo)} 不小于 isWindowDays=${String(config.isWindowDays)}`
        + " ⇒ embargo 吞掉整个样本内窗口，搜索段将无可用交易日。",
    });
  }
  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}

// ---------------------------------------------------------------------------
// Fold 排程生成（= 复用既有几何 + 投影端点）
// ---------------------------------------------------------------------------

/** 把规格配置翻成既有几何的配置（唯一映射点，且**不含**任何本域私有语义）。 */
export function toSplitConfig(
  config: WalkForwardWindowConfig,
): WalkForwardSplitConfig {
  return {
    mode: toSplitMode(config.windowMode),
    trainWindow: config.isWindowDays,
    testWindow: config.oosWindowDays,
    step: config.stepDays,
    gap: config.gapDays ?? 0,
    embargo: config.isEmbargoDays ?? 0,
    maxWindows: config.maxFolds ?? null,
  };
}

/** 既有 `WalkForwardSplit` ⇒ 本域 `WalkForwardFoldSchedule`（四端点投影 + 交易日集合）。 */
function toFoldSchedule(split: WalkForwardSplit): WalkForwardFoldSchedule {
  return {
    foldIndex: split.windowIndex,
    isStart: split.firstTrainDate,
    isEnd: split.lastTrainDate,
    oosStart: split.firstTestDate,
    oosEnd: split.lastTestDate,
    isTradeDates: [...split.trainDates],
    searchTradeDates: [...split.optimizationDates],
    embargoTradeDates: [...split.embargoDates],
    oosTradeDates: [...split.testDates],
    gapTradeDates: [...split.gapDates],
    isTradingDays: split.trainDayCount,
    oosTradingDays: split.testDayCount,
  };
}

/**
 * 生成 Fold 排程（**唯一入口**；内部走既有 `generateWalkForwardSplits`）。
 *
 * 生成的每个 Fold 都已通过既有 `assertWalkForwardSplitInvariants`（几何层）
 * **以及**本文件的 `assertWalkForwardScheduleInvariants`（跨 Fold 层）。
 */
export function planWalkForwardFolds(input: {
  readonly config: WalkForwardWindowConfig;
  readonly tradeDates: readonly string[];
}): readonly WalkForwardFoldSchedule[] {
  assertWindowConfigWellFormed(input.config);
  const splits = generateWalkForwardSplits(input.tradeDates, toSplitConfig(input.config));
  const folds = splits.map(toFoldSchedule);
  assertWalkForwardScheduleInvariants(folds);
  return folds;
}

// ---------------------------------------------------------------------------
// 跨 Fold 不变量（**单个窗口之外的**那部分泄漏守卫）
// ---------------------------------------------------------------------------

/**
 * 断言多 Fold 排程的不变量（FAIL FAST）：
 *   1. `foldIndex` 严格递增且从 0 开始（顺序错乱 ⇒ 后续「不得读下一 Fold 数据」无从谈起）；
 *   2. 每个 Fold 自身 `isStart <= isEnd < oosStart <= oosEnd`（端点不颠倒）；
 *   3. **同一 Fold 内** IS 与 OOS 交易日集合无交集（几何层已保证，这里再独立复核一次：
 *      两个独立实现都通过才算通过，避免只信一条链路）；
 *   4. **跨 Fold 单调**：后一 Fold 的 `oosStart` 不早于前一 Fold 的 `oosStart`
 *      （OOS 段不得回退）、且后一 Fold 的 `oosEnd` 不早于前一 Fold 的 `oosEnd`；
 *   5. **跨 Fold 无回看**：后一 Fold 的 `isEnd <` 其后任一更晚 Fold 的 `oosStart`
 *      自动成立（由 4 推出）—— 关键是禁止「更晚 Fold 的 OOS 落在更早 Fold 的 IS 里」，
 *      即对任意 i < j 必须 `folds[j].oosStart > folds[i].oosStart`。
 */
export function assertWalkForwardScheduleInvariants(
  folds: readonly WalkForwardFoldSchedule[],
): void {
  const issues: { code: string; path: string; message: string }[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  if (folds.length === 0) {
    issue(
      "WALK_FORWARD_SCHEDULE_EMPTY",
      "folds",
      "排程生成了 0 个 Fold —— 调用方必须先解决几何可行性，不得把空排程当成功。",
    );
    throw new ResearchValidationError(issues);
  }

  for (let index = 0; index < folds.length; index += 1) {
    const fold = folds[index]!;
    const prefix = `folds[${index}]`;
    if (fold.foldIndex !== index) {
      issue("WALK_FORWARD_FOLD_INDEX_NOT_SEQUENTIAL", `${prefix}.foldIndex`,
        `foldIndex 必须等于其序号：期望 ${String(index)}，实际 ${String(fold.foldIndex)}`);
    }
    if (fold.isStart > fold.isEnd) {
      issue("WALK_FORWARD_FOLD_WINDOW_INVALID", `${prefix}.isStart`,
        `IS 窗口倒挂：isStart=${fold.isStart} 晚于 isEnd=${fold.isEnd}`);
    }
    if (fold.oosStart > fold.oosEnd) {
      issue("WALK_FORWARD_FOLD_WINDOW_INVALID", `${prefix}.oosStart`,
        `OOS 窗口倒挂：oosStart=${fold.oosStart} 晚于 oosEnd=${fold.oosEnd}`);
    }
    if (fold.isEnd >= fold.oosStart) {
      issue("WALK_FORWARD_IS_OOS_NOT_ORDERED", `${prefix}.oosStart`,
        `必须 isEnd < oosStart：isEnd=${fold.isEnd}，oosStart=${fold.oosStart}`);
    }
    const isSet = new Set(fold.isTradeDates);
    const overlap = fold.oosTradeDates.filter((date) => isSet.has(date));
    if (overlap.length > 0) {
      issue("WALK_FORWARD_IS_OOS_OVERLAP", `${prefix}.oosTradeDates`,
        `同一 Fold 的 IS 与 OOS 交易日不得重叠，实测重叠 ${String(overlap.length)} 个`
        + `（首个 ${overlap[0] ?? "?"}）`);
    }
    if (fold.searchTradeDates.length === 0) {
      issue("WALK_FORWARD_SEARCH_DATES_EMPTY", `${prefix}.searchTradeDates`,
        "搜索可用交易日为空（embargo 可能吞掉了整个 IS 段），拒绝生成该 Fold。");
    }
  }

  for (let index = 1; index < folds.length; index += 1) {
    const previous = folds[index - 1]!;
    const current = folds[index]!;
    if (current.oosStart <= previous.oosStart) {
      issue("WALK_FORWARD_OOS_NOT_ADVANCING", `folds[${index}].oosStart`,
        `OOS 段必须单调推进：前一 Fold oosStart=${previous.oosStart}，`
        + `本 Fold oosStart=${current.oosStart}`);
    }
    if (current.isStart < previous.isStart) {
      issue("WALK_FORWARD_IS_NOT_ADVANCING", `folds[${index}].isStart`,
        `IS 起点不得回退：前一 Fold isStart=${previous.isStart}，本 Fold isStart=${current.isStart}`);
    }
  }

  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}

// ---------------------------------------------------------------------------
// 数据集越界（规格 §11：OOSEnd <= DatasetAvailableEnd）
// ---------------------------------------------------------------------------

/**
 * 断言全部 Fold 都落在数据集可用窗口内（含两端，北京业务日）。
 *
 * 🔴 为什么这条必须在这里、而不只在搜索时校验：搜索只校验 **IS** 窗口
 *   （`assertSearchWindowWithinDataset`），而 OOS 窗口越界要到「OOS 真跑」时才炸
 *   —— 那时已经白付了 N 次搜索回测。⇒ 创建时就一次性全查掉。
 */
export function assertFoldsWithinDatasetRange(input: {
  readonly folds: readonly WalkForwardFoldSchedule[];
  readonly datasetWindow: { readonly startDate: string; readonly endDate: string } | null;
}): void {
  if (input.datasetWindow === null) return; // 无绑定数据集坐标 ⇒ 不校验（不猜）
  const { startDate, endDate } = input.datasetWindow;
  const issues: { code: string; path: string; message: string }[] = [];
  for (const fold of input.folds) {
    for (const [label, value] of [
      ["isStart", fold.isStart],
      ["isEnd", fold.isEnd],
      ["oosStart", fold.oosStart],
      ["oosEnd", fold.oosEnd],
    ] as const) {
      if (value < startDate || value > endDate) {
        issues.push({
          code: "WALK_FORWARD_WINDOW_OUT_OF_DATASET_RANGE",
          path: `folds[${fold.foldIndex}].${label}`,
          message:
            `Fold ${String(fold.foldIndex)} 的 ${label}=${value} 超出数据集可用窗口 `
            + `${startDate}..${endDate}（含两端，按北京业务日）；`
            + "越界会在执行时以 SIM_RANGE_OUT_OF_DATASET 失败，故在创建时就拒绝。",
        });
      }
    }
  }
  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}

// ---------------------------------------------------------------------------
// 指纹（规格 §16：同输入 ⇒ 同 schedule fingerprint）
// ---------------------------------------------------------------------------

/** 交易日序列指纹（canonical sha256）。 */
export function computeTradeDatesFingerprint(tradeDates: readonly string[]): string {
  return createHash("sha256").update(canonicalStringify([...tradeDates]), "utf8").digest("hex");
}

/**
 * 排程指纹：覆盖**配置 + 交易日序列 + 生成出的全部 Fold 端点**。
 *
 * 🔴 不含时间戳 / Run id ⇒ 同一份输入跨运行、跨进程得到**逐字节相同**的指纹
 *   （规格 §16 的确定性判据）。
 */
export function computeWalkForwardScheduleFingerprint(input: {
  readonly config: WalkForwardWindowConfig;
  readonly tradeDates: readonly string[];
  readonly folds: readonly WalkForwardFoldSchedule[];
}): string {
  return createHash("sha256")
    .update(
      canonicalStringify({
        config: input.config,
        tradeDates: [...input.tradeDates],
        windows: input.folds.map((fold) => toFoldWindow(fold)),
      }),
      "utf8",
    )
    .digest("hex");
}

/** Fold 排程 ⇒ 契约里的四端点窗口（唯一投影点）。 */
export function toFoldWindow(fold: WalkForwardFoldSchedule): WalkForwardFoldWindow {
  return {
    foldIndex: fold.foldIndex,
    isStart: fold.isStart,
    isEnd: fold.isEnd,
    oosStart: fold.oosStart,
    oosEnd: fold.oosEnd,
    isTradingDays: fold.isTradingDays,
    oosTradingDays: fold.oosTradingDays,
  };
}

/** 组装排程快照（Run 行的冻结内容之一）。 */
export function buildWalkForwardScheduleSnapshot(input: {
  readonly config: WalkForwardWindowConfig;
  readonly tradeDates: readonly string[];
  readonly folds: readonly WalkForwardFoldSchedule[];
}): WalkForwardScheduleSnapshot {
  return {
    config: input.config,
    tradeDates: [...input.tradeDates],
    tradeDatesFingerprint: computeTradeDatesFingerprint(input.tradeDates),
    scheduleFingerprint: computeWalkForwardScheduleFingerprint(input),
    windows: input.folds.map(toFoldWindow),
  };
}

/** 排程的人类可读说明（如实回报生成了什么；不静默）。 */
export function describeWalkForwardSchedule(input: {
  readonly config: WalkForwardWindowConfig;
  readonly folds: readonly WalkForwardFoldSchedule[];
}): string {
  const modeText = input.config.windowMode === "ROLLING"
    ? `ROLLING（IS 定长 ${String(input.config.isWindowDays)} 个交易日）`
    : `EXPANDING（IS 起点固定于 ${input.folds[0]?.isStart ?? "?"}，末点逐步扩张）`;
  const gap = input.config.gapDays ?? 0;
  const embargo = input.config.isEmbargoDays ?? 0;
  const first = input.folds[0];
  const last = input.folds[input.folds.length - 1];
  return (
    `窗口排程：${modeText}；OOS 定长 ${String(input.config.oosWindowDays)} 个交易日；`
    + `步长 ${String(input.config.stepDays)}；gap=${String(gap)}；embargo=${String(embargo)}。`
    + `共 ${String(input.folds.length)} 个 Fold`
    + (first === undefined || last === undefined
      ? "。"
      : `，覆盖 ${first.oosStart}..${last.oosEnd}（OOS 段）。`)
    + (gap === 0 ? " gap=0 ⇒ oosStart 即 isEnd 的**下一个交易日**（规格 §4）。" : "")
  );
}

/** 供 Run 行自述用的口径说明（唯一来源 = canonical 指标）。 */
export function describeWalkForwardMetricsCaliber(): string {
  return `指标口径自述：${WALK_FORWARD_METRICS_VERSION}（唯一权威 = canonical metrics，本域零重算、零新增指标）。`;
}
