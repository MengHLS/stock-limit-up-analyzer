/**
 * ROBUSTNESS-001 §14 — Robustness Run：状态机 / ID / 口径解析 / 汇总。
 *
 * ## 状态机（规格 §14）
 *
 * `CREATED → RUNNING → COMPLETED | FAILED | CANCELLED`
 *
 * 🔴 **迁移表唯一权威 = `server/research/parameterSearch/searchRun.ts#PARAMETER_SEARCH_RUN_TRANSITIONS`**
 *   —— 规格 §7（Search Run）与 §14（Robustness Run）的**词表与迁移完全一致**
 *   （CREATED / RUNNING / COMPLETED / FAILED / CANCELLED），因此本域**不新建第二张迁移表**，
 *   只复用它并在失败时抛本域的领域码（`ROBUSTNESS_STATUS_TRANSITION_INVALID`）。
 *   这样「两处状态机漂移」在结构上不可能发生。
 *
 * ## ID 与时间戳
 *
 * `robustnessRunId` 由调用方注入（可指定 suffix 以便测试确定性）；`createdAt` / `startedAt` /
 * `completedAt` **一律由调用方给真实时刻**，本模块不触 `Date.now`、不用 `now()` 冒充完成时间。
 */

import {
  PARAMETER_SEARCH_RUN_STATUSES,
  type ParameterSearchRunStatus,
} from "../../../shared/parameterSearchContracts";
import { ResearchValidationError } from "../experimentValidation";
import { canTransitionSearchRun } from "../parameterSearch/searchRun";
import { fingerprintOf } from "./canonical";
import {
  DEFAULT_DRAWDOWN_TOLERANCE_PCT,
  DEFAULT_MIN_VALID_NEIGHBORS,
  DEFAULT_NEIGHBOR_DISTANCE,
  DEFAULT_RETURN_TOLERANCE_PCT,
  MAX_NEIGHBOR_DISTANCE,
  MAX_TOLERANCE_PCT,
  SEARCH_ROBUSTNESS_RUN_ID_PREFIX,
  type ResolvedRobustnessAnalysisConfig,
  type RobustnessAnalysisConfig,
  type SearchRobustnessSummary,
} from "./types";

// ---------------------------------------------------------------------------
// 状态机（复用唯一权威迁移表，只换领域码）
// ---------------------------------------------------------------------------

/** 是否允许该迁移（同一权威 `canTransitionSearchRun`；同态视为幂等重放）。 */
export function canTransitionRobustnessRun(
  from: ParameterSearchRunStatus,
  to: ParameterSearchRunStatus,
): boolean {
  return canTransitionSearchRun(from, to);
}

/**
 * 断言迁移合法，否则抛本域领域码 `ROBUSTNESS_STATUS_TRANSITION_INVALID`。
 *
 * 与 PS 侧 `assertSearchRunTransition` 的唯一差别 = 领域码，便于前端按域定位。
 */
export function assertRobustnessRunTransition(
  from: ParameterSearchRunStatus,
  to: ParameterSearchRunStatus,
): void {
  if (canTransitionRobustnessRun(from, to)) return;
  throw new ResearchValidationError([
    {
      code: "ROBUSTNESS_STATUS_TRANSITION_INVALID",
      path: "status",
      message:
        `Robustness Run 状态迁移非法：${from} → ${to}；`
        + `唯一权威迁移表见 parameterSearch/searchRun.ts#PARAMETER_SEARCH_RUN_TRANSITIONS（同态重放视为幂等）。`,
    },
  ]);
}

/** 判断取值是否为合法状态（读库行校验；非法值**响亮报错**，不默认成 CREATED）。 */
export function isRobustnessRunStatus(value: unknown): value is ParameterSearchRunStatus {
  return (
    typeof value === "string" && (PARAMETER_SEARCH_RUN_STATUSES as readonly string[]).includes(value)
  );
}

/** 解析状态（非法即抛；不静默回落）。 */
export function parseRobustnessRunStatus(value: unknown): ParameterSearchRunStatus {
  if (!isRobustnessRunStatus(value)) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_STATUS_UNKNOWN",
        path: "status",
        message: `未知 Robustness Run 状态：${String(value)}（合法：${PARAMETER_SEARCH_RUN_STATUSES.join(" / ")}）`,
      },
    ]);
  }
  return value;
}

// ---------------------------------------------------------------------------
// 口径解析（规格 §5.3：可配置 / 持久化 / 不写死前端 / 不随单次数据动态改变）
// ---------------------------------------------------------------------------

/** 校验单个容差（有限、非负、不超上限）。 */
function resolveTolerance(
  raw: number | undefined,
  fallback: number,
  field: string,
): number {
  if (raw === undefined) return fallback;
  if (!Number.isFinite(raw)) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_CONFIG_INVALID",
        path: field,
        message: `${field} 必须是有限数字（收到 ${String(raw)}）。`,
      },
    ]);
  }
  if (raw < 0 || raw > MAX_TOLERANCE_PCT) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_CONFIG_INVALID",
        path: field,
        message: `${field} 必须落在 [0, ${String(MAX_TOLERANCE_PCT)}]（收到 ${String(raw)}）；不静默夹取。`,
      },
    ]);
  }
  return raw;
}

/**
 * 解析稳定性判定口径为**全字段自描述**形态（缺省补齐、非法即抛）。
 *
 * 🔴 为什么不静默夹取：`neighborDistance = 0` 会被夹成 1，于是「零邻域」这条边界永远
 *   测不到；`null` 时间戳会被填成「刚刚」—— 两者都会把「配置错了」伪装成「跑过了」。
 */
export function resolveRobustnessAnalysisConfig(
  config: RobustnessAnalysisConfig | undefined,
): ResolvedRobustnessAnalysisConfig {
  const input = config ?? {};
  const returnTolerancePct = resolveTolerance(
    input.returnTolerancePct,
    DEFAULT_RETURN_TOLERANCE_PCT,
    "returnTolerancePct",
  );
  const drawdownTolerancePct = resolveTolerance(
    input.drawdownTolerancePct,
    DEFAULT_DRAWDOWN_TOLERANCE_PCT,
    "drawdownTolerancePct",
  );

  const neighborDistanceRaw = input.neighborDistance ?? DEFAULT_NEIGHBOR_DISTANCE;
  if (!Number.isInteger(neighborDistanceRaw) || neighborDistanceRaw < 1) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_CONFIG_INVALID",
        path: "neighborDistance",
        message: `neighborDistance 必须是 >= 1 的整数（收到 ${String(neighborDistanceRaw)}）；不静默夹取。`,
      },
    ]);
  }
  if (neighborDistanceRaw > MAX_NEIGHBOR_DISTANCE) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_CONFIG_INVALID",
        path: "neighborDistance",
        message: `neighborDistance 上限为 ${String(MAX_NEIGHBOR_DISTANCE)}（收到 ${String(neighborDistanceRaw)}）；不静默夹取。`,
      },
    ]);
  }

  const minValidNeighborsRaw = input.minValidNeighbors ?? DEFAULT_MIN_VALID_NEIGHBORS;
  if (!Number.isInteger(minValidNeighborsRaw) || minValidNeighborsRaw < 1) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_CONFIG_INVALID",
        path: "minValidNeighbors",
        message: `minValidNeighbors 必须是 >= 1 的整数（收到 ${String(minValidNeighborsRaw)}）；不静默夹取。`,
      },
    ]);
  }

  return {
    returnTolerancePct,
    drawdownTolerancePct,
    neighborDistance: neighborDistanceRaw,
    minValidNeighbors: minValidNeighborsRaw,
  };
}

// ---------------------------------------------------------------------------
// ID
// ---------------------------------------------------------------------------

/** 生成 Robustness Run ID：`SROB-YYYYMMDD-XXXXXXXX`（UTC 日期 + 后缀）。 */
export function generateSearchRobustnessRunId(now: Date, suffix: string): string {
  const date =
    `${now.getUTCFullYear()}`
    + `${String(now.getUTCMonth() + 1).padStart(2, "0")}`
    + `${String(now.getUTCDate()).padStart(2, "0")}`;
  return `${SEARCH_ROBUSTNESS_RUN_ID_PREFIX}-${date}-${suffix.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// 进度（详情页用；唯一算法）
// ---------------------------------------------------------------------------

/** 进度快照（列表 / 详情共用）。 */
export interface SearchRobustnessProgress {
  /** 源 Search Run 的组合总数（分母）。 */
  readonly sourceCombinationCount: number;
  /** 已进入判定（含判定为证据不足）的组合数。 */
  readonly analyzedCombinationCount: number;
  /** 进度百分比（0~100；分母为 0 时 0 —— 没有源组合就什么都没分析，不谎报 100）。 */
  readonly progressPct: number;
}

/** 计算进度（纯函数；不读库）。 */
export function computeRobustnessProgress(input: {
  readonly sourceCombinationCount: number;
  readonly analyzedCombinationCount: number;
}): SearchRobustnessProgress {
  const total = Math.max(0, input.sourceCombinationCount);
  const analyzed = Math.max(0, Math.min(total, input.analyzedCombinationCount));
  const progressPct = total === 0 ? 0 : Math.round((analyzed / total) * 10000) / 100;
  return {
    sourceCombinationCount: total,
    analyzedCombinationCount: analyzed,
    progressPct,
  };
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

/** 空汇总（尚未 start；`CREATED` 状态下详情页如实显示 0 / false）。 */
export function emptyRobustnessSummary(
  sourceCombinationCount: number,
  parameterReference: { readonly verified: boolean; readonly note: string },
): SearchRobustnessSummary {
  return {
    sourceCombinationCount,
    analyzedCombinationCount: 0,
    stableCount: 0,
    unstableCount: 0,
    insufficientTradingActivityCount: 0,
    insufficientNeighborhoodCount: 0,
    sourceResultUnavailableCount: 0,
    neighborhoodIncompleteCount: 0,
    parameterReferenceUnverified: !parameterReference.verified,
    parameterReferenceNote: parameterReference.note,
  };
}

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

/** Run 内容指纹（除 `fingerprint` 外全部字段的 canonical sha256）。 */
export function computeSearchRobustnessRunFingerprint(record: object): string {
  return fingerprintOf(record);
}

/** 单组合结果内容指纹。 */
export function computeSearchRobustnessResultFingerprint(record: object): string {
  return fingerprintOf(record);
}

/** 单参数分析内容指纹。 */
export function computeSearchRobustnessParameterFingerprint(record: object): string {
  return fingerprintOf(record);
}
