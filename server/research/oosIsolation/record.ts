/**
 * STEP 19 / C-19.2 — 从 C-19.1 `WalkForwardRun` 构建 IS/OOS 隔离记录（WindowResultRecord）。
 *
 * 职责：
 *   - **复用 C-19.1 的窗口几何**：调用 `generateWalkForwardSplits(walkForwardRun.tradeDates,
 *     walkForwardRun.splitConfig)`（import 只读）重新生成 Train/Test 成对窗口，取得每窗
 *     **完整的 trainDates / testDates 数组**（WalkForwardRun 只存了首末日期 + 天数，没有完整
 *     日期序列），从而精确计算「Train/Test 重叠」与「OOS 曲线是否越界」。
 *   - 把 WalkForwardRun 的逐窗结果投影到 `WindowResultRecord`：Train 段（冻结参数 + IS 绩效）
 *     与 Test 段（OOS 参数 + OOS 绩效 + 权益曲线归档）**分离存储**。
 *   - 计算每窗隔离元数据（overlap 计数 / Test 晚于 Train / 参数冻结 / 不回写）。
 *   - 校验 OOS 权益曲线的 PIT 边界：曲线所有日期必须严格落在 [firstTestDate, lastTestDate]
 *     内（不得混入 Train 区间数据 = 数据泄漏，响亮抛错）。
 *
 * 铁律：纯函数、确定性、无 IO / Date.now / Math.random；退化输入响亮抛错（FAIL FAST）；
 * 不修改入参。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import { generateWalkForwardSplits } from "../walkForwardRun/windows";
import type { EquityPoint } from "../../backtest/types";
import type { WalkForwardRun } from "../walkForwardRun";
import type {
  OosSkipReasonCode,
  WindowIsolationMetadata,
  WindowResultRecord,
  WindowTestResult,
  WindowTrainResult,
} from "./types";

// ---------------------------------------------------------------------------
// 单窗指纹
// ---------------------------------------------------------------------------

/** 单窗隔离记录内容指纹（sha256，十六进制；除 fingerprint 字段外的 canonical JSON 摘要）。 */
export function computeWindowResultFingerprint(
  body: Omit<WindowResultRecord, "fingerprint">,
): string {
  return createHash("sha256").update(canonicalStringify(body), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// OOS 权益曲线 PIT 边界校验（曲线不得混入 Train 数据）
// ---------------------------------------------------------------------------

/**
 * 校验 OOS 权益曲线严格落在 Test 区间内（PIT 边界）：每点日期都在
 * [firstTestDate, lastTestDate] 内。越界 → 响亮抛错（隔离破坏 = 数据泄漏）。
 */
function assertOosEquityCurveContainedInTest(
  windowId: string,
  curve: readonly EquityPoint[],
  firstTestDate: string,
  lastTestDate: string,
): void {
  const issues: ResearchValidationIssue[] = [];
  for (let i = 0; i < curve.length; i++) {
    const date = curve[i]!.date;
    if (date < firstTestDate || date > lastTestDate) {
      issues.push({
        code: "OOS19_OOS_CURVE_OUTSIDE_TEST_WINDOW",
        path: `oosEquityCurves[${windowId}][${i}].date`,
        message:
          `OOS 权益曲线日期 ${date} 越出 Test 区间 [${firstTestDate}, ${lastTestDate}]`
          + `（混入 Train 区间数据 = 隔离破坏）`,
      });
    }
  }
  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}

// ---------------------------------------------------------------------------
// 主构建
// ---------------------------------------------------------------------------

/**
 * 从 WalkForwardRun 构建逐窗 IS/OOS 隔离记录。
 *
 * - 复用 C-19.1 `generateWalkForwardSplits` 取得完整 trainDates/testDates（供重叠与 PIT 校验）；
 * - 每窗 train / test 参数与绩效分离存储；
 * - OOS 权益曲线缺窗 → 该窗仅保留标量绩效，skipReasonCode 记 `OOS19_NO_OOS_EQUITY_CURVE`；
 * - test 未评估 → skipReasonCode 记 `OOS19_NO_TEST_RESULT`。
 *
 * 退化输入：`walkForwardRun.windows` 为空 → 抛错 `OOS19_EMPTY_WINDOWS`；
 * 窗口几何重放与记录数量/索引不一致 → 抛错 `OOS19_SPLIT_MISMATCH`。
 */
export function buildWindowResultRecords(
  walkForwardRun: WalkForwardRun,
  oosEquityCurves?: ReadonlyMap<string, readonly EquityPoint[]>,
): WindowResultRecord[] {
  if (!Array.isArray(walkForwardRun.windows) || walkForwardRun.windows.length === 0) {
    throw new ResearchValidationError([
      {
        code: "OOS19_EMPTY_WINDOWS",
        path: "walkForwardRun.windows",
        message: "WalkForwardRun.windows 不能为空（无窗口可隔离归档）",
      },
    ]);
  }

  // 复用 C-19.1 窗口几何：取得完整 trainDates / testDates。
  const splits = generateWalkForwardSplits(walkForwardRun.tradeDates, walkForwardRun.splitConfig);
  const splitsByIndex = new Map(splits.map((split) => [split.windowIndex, split]));

  const records: WindowResultRecord[] = [];
  for (const window of walkForwardRun.windows) {
    const split = splitsByIndex.get(window.windowIndex);
    if (split === undefined) {
      throw new ResearchValidationError([
        {
          code: "OOS19_SPLIT_MISMATCH",
          path: `walkForwardRun.windows[${window.windowIndex}]`,
          message: `窗口 ${window.windowId} 在重放的窗口几何中找不到对应 split（窗口几何与记录不一致）`,
        },
      ]);
    }

    const trainSet = new Set(split.trainDates);
    const overlapCount = split.testDates.filter((date) => trainSet.has(date)).length;
    const testStrictlyAfterTrain = split.lastTrainDate < split.firstTestDate;

    const frozen = window.frozen;
    const testStage = window.test;
    const oosCurve = oosEquityCurves?.get(window.windowId) ?? null;

    // OOS 曲线 PIT 边界（不得混入 Train 数据）。
    if (oosCurve !== null && oosCurve.length > 0) {
      assertOosEquityCurveContainedInTest(
        window.windowId,
        oosCurve,
        split.firstTestDate,
        split.lastTestDate,
      );
    }

    // 参数不回写：succeeded 时 test 参数 === 冻结参数；skipped 时无参数可回写（视为 true）。
    const paramsFrozenFromTrain = testStage.status === "succeeded"
      ? frozen !== null
        && testStage.parameterSet !== null
        && canonicalStringify(testStage.parameterSet) === canonicalStringify(frozen.parameterSet)
        && testStage.parameterSetKey === frozen.parameterSetKey
      : true;

    const testResultWritesBackParams = false;

    const isolation: WindowIsolationMetadata = {
      trainTestOverlapCount: overlapCount,
      testStrictlyAfterTrain,
      paramsFrozenFromTrain,
      testResultWritesBackParams,
      isolationHolds: overlapCount === 0 && testStrictlyAfterTrain && paramsFrozenFromTrain && !testResultWritesBackParams,
    };

    const train: WindowTrainResult = {
      windowId: window.windowId,
      windowIndex: window.windowIndex,
      firstTrainDate: window.train.firstTrainDate,
      lastTrainDate: window.train.lastTrainDate,
      frozenParameterSetKey: frozen?.parameterSetKey ?? null,
      frozenParameterSet: frozen?.parameterSet ?? null,
      trainTotalReturnPct: frozen?.trainTotalReturnPct ?? null,
      trainMaxDrawdownPct: frozen?.trainMaxDrawdownPct ?? null,
      trainTradeCount: frozen?.trainTradeCount ?? null,
    };

    const test: WindowTestResult = {
      windowId: window.windowId,
      windowIndex: window.windowIndex,
      firstTestDate: testStage.firstTestDate,
      lastTestDate: testStage.lastTestDate,
      status: testStage.status,
      testParameterSetKey: testStage.parameterSetKey,
      testParameterSet: testStage.parameterSet,
      totalReturnPct: testStage.totalReturnPct,
      maxDrawdownPct: testStage.maxDrawdownPct,
      tradeCount: testStage.tradeCount,
      skipReasonCode: resolveSkipReasonCode(testStage.status, oosCurve),
      oosEquityCurve: oosCurve,
    };

    const body: Omit<WindowResultRecord, "fingerprint"> = {
      windowId: window.windowId,
      windowIndex: window.windowIndex,
      train,
      test,
      isolation,
    };
    records.push({ ...body, fingerprint: computeWindowResultFingerprint(body) });
  }

  return records;
}

/** 派生跳过原因码（数据不足的诚实记录，非隔离破坏）。 */
function resolveSkipReasonCode(
  status: "succeeded" | "skipped",
  oosCurve: readonly EquityPoint[] | null,
): OosSkipReasonCode | null {
  if (status === "skipped") return "OOS19_NO_TEST_RESULT";
  if (oosCurve === null) return "OOS19_NO_OOS_EQUITY_CURVE";
  return null;
}
