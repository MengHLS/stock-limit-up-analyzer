/**
 * WALK-FORWARD-001 — Run 身份与运行内容指纹（规格 §10 / §16）。
 *
 * ## 冻结什么
 *
 * Run 创建时必须一次性冻结（规格 §10）：`strategyFingerprint` / `datasetVersionId` /
 * `windowSchedule` / `selectionPolicy` / `engineVersion` / `metricsVersion`。
 * 本文件负责把这六项（加策略身份与搜索口径）压成一个 **canonical sha256**，
 * 写进 Run 行的 `runFingerprint`。
 *
 * ## 🔴 指纹的边界（别把它当跨运行幂等键）
 *
 * `runFingerprint` **含 Run id**（因为它是「这一行内容」的指纹，与 OOS-001 同口径），
 * 所以两次独立创建同一个配置会得到**不同**的 `runFingerprint` —— 这是**正确行为**
 * （它们确实是两条不同的记录）。
 *
 * 规格 §16 要求的「同输入 ⇒ 稳定指纹」落在**另外两处**，且都是跨运行稳定的：
 *   - `schedule.scheduleFingerprint`（配置 + 交易日 + Fold 端点，**不含** Run id / 时间戳）；
 *   - 每个 Fold 的 `window` + `parameterHash` 组合（由 `freeze.ts#buildFoldExecutionFingerprint` 覆盖）。
 * E2E 的确定性判据比对后者，而不是 `runFingerprint`。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { ResearchValidationError } from "../experimentValidation";
import type {
  WalkForwardScheduleSnapshot,
  WalkForwardSelectionPolicy,
  WalkForwardWindowConfig,
} from "./types";
import { WALK_FORWARD_VALIDATION_RUN_ID_PREFIX } from "./types";

// ---------------------------------------------------------------------------
// Run ID
// ---------------------------------------------------------------------------

/** 补零到 2 位（Run ID 里的月 / 日）。 */
function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

/**
 * 格式化为 `WFV-YYYYMMDD-XXXXXXXX`。
 *
 * 🔴 日期取 **UTC 墙钟的日**（与 OOS-001 / PS 的 Run ID 口径一致，便于跨表对齐排查）；
 *   业务日的时区换算发生在窗口/日历层，不在这里。
 */
export function formatWalkForwardValidationRunId(date: Date, suffix: string): string {
  const stamp = `${String(date.getUTCFullYear())}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
  return `${WALK_FORWARD_VALIDATION_RUN_ID_PREFIX}-${stamp}-${suffix}`;
}

/** 生成 Run ID（`suffix` 缺省取 `crypto.randomUUID()` 的前 8 位）。 */
export function generateWalkForwardValidationRunId(now: Date = new Date(), suffix?: string): string {
  const tail = suffix ?? createHash("md5").update(`${String(now.getTime())}-${Math.random()}`).digest("hex").slice(0, 8);
  return formatWalkForwardValidationRunId(now, tail);
}

// ---------------------------------------------------------------------------
// 运行内容指纹
// ---------------------------------------------------------------------------

/** 指纹输入（全部为**创建时冻结**的字段；不含任何可变量）。 */
export interface WalkForwardValidationRunFingerprintInput {
  readonly walkForwardRunId: string;
  readonly strategyVersionId: string;
  readonly strategyFingerprint: string | null;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly schedule: WalkForwardScheduleSnapshot;
  readonly selectionPolicy: WalkForwardSelectionPolicy;
  readonly searchMethod: string;
  readonly maxCombinationsPerFold: number | null;
  readonly totalFoldCount: number;
  readonly metricsVersion: string;
  readonly engineVersion: string;
}

/**
 * 计算 Run 运行内容指纹（canonical sha256）。
 *
 * 覆盖：Run 身份 + 策略身份与其定义指纹 + 数据集坐标 + **完整排程快照**
 * （含配置、交易日序列、Fold 端点、排程指纹）+ **选择策略快照** + 搜索口径 + 版本自述。
 *
 * 🔴 **不含** `notes` / 时间戳 / 计数类可变字段 —— 否则「同一份冻结配置」会因为
 *   执行进度不同而得到不同指纹，失去「内容指纹」的意义。
 *
 * 🔴 符号名带 `Validation` —— C-19.1 `walkForwardRun/serialize.ts` **已占用**
 *   `computeWalkForwardRunFingerprint`（两域名字只差 3 个字符，且仓内有多个 `export *`
 *   全域 barrel）⇒ 本域一切符号必须与 `WFA` 侧可区分，否则 barrel 会静默互相遮蔽。
 */
export function computeWalkForwardValidationRunFingerprint(
  input: WalkForwardValidationRunFingerprintInput,
): string {
  return createHash("sha256")
    .update(
      canonicalStringify({
        walkForwardRunId: input.walkForwardRunId,
        strategyVersionId: input.strategyVersionId,
        strategyFingerprint: input.strategyFingerprint,
        datasetVersionId: input.datasetVersionId,
        datasetVersionLabel: input.datasetVersionLabel,
        scheduleFingerprint: input.schedule.scheduleFingerprint,
        tradeDatesFingerprint: input.schedule.tradeDatesFingerprint,
        windows: input.schedule.windows,
        selectionPolicy: input.selectionPolicy,
        searchMethod: input.searchMethod,
        maxCombinationsPerFold: input.maxCombinationsPerFold,
        totalFoldCount: input.totalFoldCount,
        metricsVersion: input.metricsVersion,
        engineVersion: input.engineVersion,
      }),
      "utf8",
    )
    .digest("hex");
}

// ---------------------------------------------------------------------------
// 创建入参的领域侧复检（schema 之外的那部分）
// ---------------------------------------------------------------------------

/**
 * 复检创建请求里**schema 表达不了**的部分（防御性；仍在领域层抛领域码）。
 *
 * 两条：
 *   ① `EXPLICIT_PARAMETER_HASH` 策略下，`parameterHash` 必须非空
 *      （schema 已保证，这里再兜一次防绕过 schema 的调用方）；
 *   ② `maxFolds` 若给了，必须 >= 1（schema 已保证，同上）。
 */
export function assertCreateRequestConsistent(input: {
  readonly windowConfig: WalkForwardWindowConfig;
  readonly selectionPolicy: WalkForwardSelectionPolicy;
}): void {
  const issues: { code: string; path: string; message: string }[] = [];
  if (
    input.selectionPolicy.kind === "EXPLICIT_PARAMETER_HASH"
    && input.selectionPolicy.parameterHash.trim() === ""
  ) {
    issues.push({
      code: "WALK_FORWARD_SELECTION_POLICY_INVALID",
      path: "selectionPolicy.parameterHash",
      message: "EXPLICIT_PARAMETER_HASH 策略必须给出非空的 parameterHash。",
    });
  }
  if (input.windowConfig.maxFolds !== undefined && input.windowConfig.maxFolds < 1) {
    issues.push({
      code: "WALK_FORWARD_WINDOW_CONFIG_INVALID",
      path: "windowConfig.maxFolds",
      message: `maxFolds 必须 >= 1，实际 ${String(input.windowConfig.maxFolds)}`,
    });
  }
  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}
