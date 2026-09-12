/**
 * closedLoopRunAdapter — 闭环运行结果 → 前端 ViewModel（任务 §17：API → Adapter → ViewModel → UI）。
 *
 * 数据来源：`researchRun.loopRun`（真实执行 `runClosedLoop`，返回完整可审计轨迹）。
 *
 * 铁律（对齐 runResultAdapter.ts）：
 *   - **零计算**：本层只做字段搬移与形态收敛，**不**由前端推算收益率 / Sharpe / 回撤
 *     等任何业务指标。评估标量一律取自 evaluation 阶段真实产出的 `evaluationRef`
 *     （由后端三套评估器计算），缺失即 null，UI 显示「—」；
 *   - **防御性解析**：`buildClosedLoopRunViewModel` 对非对象/字段缺失/类型不符
 *     一律降级为 null 或空数组，绝不构造函数或臆造状态；
 *   - **可复算指纹透传**：chainFingerprint 原样展示（供人工比对两次运行是否同源）。
 */

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import type { RunResultViewModel } from "./runResultAdapter";

export type ClosedLoopRunOutput =
  inferRouterOutputs<AppRouter>["researchRun"]["loopRun"];

/** 阶段状态（与后端 CLOSED_LOOP_STAGE_STATES 一致；解析失败降级为 "UNKNOWN"）。 */
export type ClosedLoopStageStateView =
  | "READY"
  | "EXECUTED"
  | "BLOCKED"
  | "SKIPPED"
  | "UNKNOWN";

export interface ClosedLoopStageRowViewModel {
  stageId: string;
  state: ClosedLoopStageStateView;
  outputKind: string;
  handoffFingerprint: string | null;
  blockedReasonCode: string | null;
  blockedDetail: string | null;
  errorCode: string | null;
}

export interface ClosedLoopEvaluationScalars {
  totalReturnPct: number | null;
  cagrPct: number | null;
  maxDrawdownPct: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  winRatePct: number | null;
  profitFactor: number | null;
  completedTradeCount: number | null;
}

export interface ClosedLoopRunViewModel {
  /** 是否已有一次真实运行结果（无 → UI 展示空态）。 */
  hasResult: boolean;
  runId: string;
  createdAt: string;
  status: string;
  chainFingerprint: string;
  synthetic: boolean;
  note: string;
  counts: {
    executed: number;
    blocked: number;
    skipped: number;
  };
  firstBlockedReasonCode: string | null;
  /** 本次真正注入执行器的阶段。 */
  runnerInjected: string[];
  wiring: {
    wiredStages: string[];
    unwiredStages: string[];
    coveredStages: string[];
    executorBound: boolean;
  };
  stages: ClosedLoopStageRowViewModel[];
  /** 评估标量：仅当 evaluation 阶段真实 EXECUTED 且产出 evaluationRef 时非 null。 */
  evaluation: ClosedLoopEvaluationScalars | null;
}

// ---------------------------------------------------------------------------
// 防御性取值
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

const STAGE_STATES: readonly ClosedLoopStageStateView[] = [
  "READY",
  "EXECUTED",
  "BLOCKED",
  "SKIPPED",
];

function asStageState(v: unknown): ClosedLoopStageStateView {
  return STAGE_STATES.includes(v as ClosedLoopStageStateView)
    ? (v as ClosedLoopStageStateView)
    : "UNKNOWN";
}

// ---------------------------------------------------------------------------
// 空态
// ---------------------------------------------------------------------------

/** 空结果（尚未发起运行 / 运行失败）——UI 展示空态，不构造任何「看起来跑过」的字段。 */
export function emptyClosedLoopRun(): ClosedLoopRunViewModel {
  return {
    hasResult: false,
    runId: "",
    createdAt: "",
    status: "NOT_RUN",
    chainFingerprint: "",
    synthetic: false,
    note: "",
    counts: { executed: 0, blocked: 0, skipped: 0 },
    firstBlockedReasonCode: null,
    runnerInjected: [],
    wiring: {
      wiredStages: [],
      unwiredStages: [],
      coveredStages: [],
      executorBound: false,
    },
    stages: [],
    evaluation: null,
  };
}

// ---------------------------------------------------------------------------
// 主解析
// ---------------------------------------------------------------------------

/** 从 evaluation 阶段产出里抽取标量（只在 kind === "evaluationRef" 时读取）。 */
function extractEvaluationScalars(
  stages: readonly ClosedLoopStageRowViewModel[],
  rawStages: readonly unknown[],
): ClosedLoopEvaluationScalars | null {
  const index = stages.findIndex(
    s => s.stageId === "evaluation" && s.state === "EXECUTED"
  );
  if (index < 0) return null;
  const output = isRecord(rawStages[index]) ? rawStages[index].output : null;
  if (!isRecord(output) || output.kind !== "evaluationRef") return null;

  const perf = isRecord(output.performance) ? output.performance : null;
  const risk = isRecord(output.riskAdjusted) ? output.riskAdjusted : null;
  const quality = isRecord(output.tradeQuality) ? output.tradeQuality : null;
  // 三节全缺 → 视为无标量（不返回全 null 的伪对象，避免 UI 误判「有结果」）
  if (perf === null && risk === null && quality === null) return null;

  return {
    // 字段名直搬（cagrPct 即年化口径），不做任何换算
    totalReturnPct: perf ? asNum(perf.totalReturnPct) : null,
    cagrPct: perf ? asNum(perf.cagrPct) : null,
    maxDrawdownPct: perf ? asNum(perf.maxDrawdownPct) : null,
    sharpeRatio: risk ? asNum(risk.sharpeRatio) : null,
    sortinoRatio: risk ? asNum(risk.sortinoRatio) : null,
    calmarRatio: risk ? asNum(risk.calmarRatio) : null,
    winRatePct: quality ? asNum(quality.winRatePct) : null,
    profitFactor: quality ? asNum(quality.profitFactor) : null,
    completedTradeCount: quality ? asNum(quality.completedTradeCount) : null,
  };
}

/**
 * 防御性解析闭环运行结果。
 * 非对象 / 缺 runId → 返回 null（调用方保持空态）。
 */
export function buildClosedLoopRunViewModel(
  raw: unknown
): ClosedLoopRunViewModel | null {
  if (!isRecord(raw)) return null;
  const runId = asStr(raw.runId);
  if (runId === null) return null;

  const rawStages = Array.isArray(raw.stages) ? raw.stages : [];
  const stages: ClosedLoopStageRowViewModel[] = rawStages
    .filter(isRecord)
    .map(s => {
      const blocked = isRecord(s.blocked) ? s.blocked : null;
      return {
        stageId: asStr(s.stageId) ?? "",
        state: asStageState(s.state),
        outputKind: asStr(s.outputKind) ?? "",
        handoffFingerprint: asStr(s.outputHandoffFingerprint),
        blockedReasonCode: blocked ? asStr(blocked.reasonCode) : null,
        blockedDetail: blocked ? asStr(blocked.detail) : null,
        errorCode: blocked ? asStr(blocked.errorCode) : null,
      };
    })
    .filter(row => row.stageId !== "");

  const wiringRaw = isRecord(raw.wiring) ? raw.wiring : {};
  const overall = isRecord(raw.overall) ? raw.overall : {};

  return {
    hasResult: true,
    runId,
    createdAt: asStr(raw.createdAt) ?? "",
    status: asStr(overall.status) ?? "UNKNOWN",
    chainFingerprint: asStr(raw.chainFingerprint) ?? "",
    synthetic: overall.synthetic === true,
    note: asStr(overall.note) ?? "",
    counts: {
      executed: asNum(overall.executedStageCount) ?? 0,
      blocked: asNum(overall.blockedStageCount) ?? 0,
      skipped: asNum(overall.skippedStageCount) ?? 0,
    },
    firstBlockedReasonCode: asStr(overall.firstBlockedReasonCode),
    runnerInjected: asStrArray(raw.runnerInjected),
    wiring: {
      wiredStages: asStrArray(wiringRaw.wiredStages),
      unwiredStages: asStrArray(wiringRaw.unwiredStages),
      coveredStages: asStrArray(wiringRaw.coveredStages),
      executorBound: wiringRaw.executorBound === true,
    },
    stages,
    evaluation: extractEvaluationScalars(stages, rawStages),
  };
}

// ---------------------------------------------------------------------------
// 映射到既有 RunResultViewModel（复用既有指标卡 UI，零新指标）
// ---------------------------------------------------------------------------

/**
 * 闭环结果 → 既有 `RunResultViewModel`。
 *
 * 字段对应（直搬，不换算）：
 *   totalReturnPct      ← evaluation.performance.totalReturnPct
 *   annualizedReturnPct ← evaluation.performance.cagrPct（同为年化口径，仅改名）
 *   maxDrawdownPct      ← evaluation.performance.maxDrawdownPct
 *   sharpe              ← evaluation.riskAdjusted.sharpeRatio（仅改名）
 *   winRatePct          ← evaluation.tradeQuality.winRatePct
 *   profitFactor        ← evaluation.tradeQuality.profitFactor
 *   tradeCount          ← evaluation.tradeQuality.completedTradeCount
 */
export function closedLoopRunToRunResult(
  vm: ClosedLoopRunViewModel
): RunResultViewModel {
  const e = vm.evaluation;
  const metrics = {
    totalReturnPct: e?.totalReturnPct ?? null,
    annualizedReturnPct: e?.cagrPct ?? null,
    maxDrawdownPct: e?.maxDrawdownPct ?? null,
    winRatePct: e?.winRatePct ?? null,
    profitFactor: e?.profitFactor ?? null,
    sharpe: e?.sharpeRatio ?? null,
    tradeCount: e?.completedTradeCount ?? null,
  };
  return {
    runId: vm.runId,
    status: vm.status,
    strategyVersion: null,
    datasetVersion: null,
    createdAt: vm.createdAt || null,
    durationMs: null,
    metrics,
    hasData: Object.values(metrics).some(v => v !== null),
  };
}

// ---------------------------------------------------------------------------
// 实验标识（仅生成 §28 谱系锚点用的**标识符**，不涉及任何业务数值）
// ---------------------------------------------------------------------------

/** FNV-1a 32bit → 8 位十六进制（确定性，跨运行稳定；仅用于标识，非指纹）。 */
function fnv1a8(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * 派生 experimentId（形态 `EXP-YYYYMMDD-XXXXXXXX`，满足 C-13.3 validator 形态要求）。
 *
 * ⚠️ 这是**标识符**而非业务指标：内容由 (strategyId, dateRange, executionModel, 当日)
 * 确定性派生，同配置同日 → 同 id，便于复现与检索。真正的 run 谱系指纹由后端产出。
 */
export function deriveExperimentId(
  strategyId: string,
  dateRange: { startDate: string; endDate: string },
  executionModel: string,
  now: Date = new Date()
): string {
  const ymd = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
    now.getUTCDate()
  ).padStart(2, "0")}`;
  const digest = fnv1a8(
    `${strategyId}|${dateRange.startDate}|${dateRange.endDate}|${executionModel}`
  );
  return `EXP-${ymd}-${digest.toUpperCase()}`;
}
