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

/**
 * 键 → 计数（拒单原因 / 跳过原因 / 成本科目）。
 *
 * 统一用一个形状承载三类「同一个东西的分布」，UI 才能用同一段渲染逻辑；
 * 语义差异由字段名（`byReason` / `skippedCounts` / `costs`）表达。
 */
export interface ClosedLoopKeyedCount {
  key: string;
  count: number;
}

/** 权益曲线上的一个点（直搬 `backtest/types.EquityPoint` 的数值字段）。 */
export interface ClosedLoopEquityPointView {
  date: string;
  equity: number;
  cash: number | null;
  marketValue: number | null;
  openPositions: number | null;
}

/** 单笔成交（直搬 `backtest/types.Trade` 子集）。 */
export interface ClosedLoopTradeView {
  securityId: string;
  entryTime: string;
  entryPrice: number | null;
  exitTime: string | null;
  exitPrice: number | null;
  quantity: number | null;
  netPnl: number | null;
  returnPct: number | null;
  holdingPeriod: number | null;
  openAtEnd: boolean;
  fees: number | null;
}

/** 撮合执行统计（含**拒单原因分布** —— 「为什么没成交」的唯一答案来源）。 */
export interface ClosedLoopExecutionStatsView {
  totalSignals: number | null;
  totalOrders: number | null;
  totalFills: number | null;
  rejectedOrders: number | null;
  partialFills: number | null;
  byReason: ClosedLoopKeyedCount[];
}

export interface ClosedLoopBacktestArtifactsView {
  tradeCount: number;
  initialCapital: number | null;
  finalEquity: number | null;
  decisionDayCount: number | null;
  equityCurve: ClosedLoopEquityPointView[];
  executionStats: ClosedLoopExecutionStatsView | null;
  skippedCounts: ClosedLoopKeyedCount[];
  costs: ClosedLoopKeyedCount[];
  trades: ClosedLoopTradeView[];
  tradesTruncated: boolean;
}

/**
 * 真实数据装配摘要（仅当本次以 `useRealData=true` 装配成功时非 null）。
 *
 * 全部字段**直搬**后端 `assembly`，前端不做任何换算 / 补齐 / 推断。
 * 该摘要回答一个关键问题：「这次运行，数据集与策略到底从哪来、长什么样」。
 */
export interface ClosedLoopRunAssemblyViewModel {
  datasetVersion: string;
  /** 数据集 gate 判定：PASS / FAIL / INCONCLUSIVE（后端原样透传）。 */
  datasetGate: string;
  datasetRowCount: number | null;
  datasetSecurityCount: number | null;
  /** 数据来源：`registry`（直读策略已绑定的 ds_* 数据集）| `rebuild`（按窗口从零重建）。 */
  datasetSource: string;
  /** `rebuild` 且由「直读失败」引起时的原因（否则 null）。 */
  datasetSourceNote: string | null;
  /** 直读命中时的已落库数据集坐标（`dataset_version.id`）；重建时为 null。 */
  datasetVersionId: number | null;
  /** `YYYY-MM-DD`。 */
  startDate: string;
  endDate: string;
  strategyId: string;
  strategyVersion: string;
  recipeId: string;
  /** 配方来源：策略文档内自带 / 请求显式指定。 */
  recipeSource: string;
  recipeFeatureIds: string[];
  selectionSummary: string | null;
  simulation: {
    initialCapital: number | null;
    maxPositions: number | null;
    executionModel: string;
    costModel: {
      commissionRate?: number | null;
      minCommission?: number | null;
      stampDutyRate?: number | null;
      transferFeeRate?: number | null;
      slippageBps?: number | null;
      impactBps?: number | null;
    } | null;
  };
}

export type RebuildScopeVerdict = "inherited" | "declared-unscoped" | "unknown";

/**
 * 纯函数：从后端 `datasetSourceNote` 判定重建范围是否**已确认**。
 *
 * - `inherited`：明确继承了约束（或明确「沿用该数据集声明的约束 = 全板块」）；
 * - `declared-unscoped`：明确说明「未继承任何板块约束」（数据源未声明）——已知的全板块；
 * - `unknown`：**没有说话** ⇒ 无法确认（历史结果），需要提示用户重跑。
 */
export function classifyRebuildScope(note: string | null): RebuildScopeVerdict {
  const text = note ?? "";
  if (
    text.includes("已继承该数据集的 universe 约束") ||
    text.includes("沿用该数据集声明的 universe 约束")
  ) {
    return "inherited";
  }
  if (text.includes("未继承任何板块约束")) return "declared-unscoped";
  return "unknown";
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
  /** backtest 真实明细（曲线 / 撮合统计 / 成交明细）；未执行 backtest → null。 */
  backtest: ClosedLoopBacktestArtifactsView | null;
  /** 真实数据装配摘要；未使用真实装配（或装配失败）→ null。 */
  assembly: ClosedLoopRunAssemblyViewModel | null;
  /**
   * 重建路径的证券范围是否**已确认**继承自绑定数据集；非重建 / 未装配 → null。
   * `unknown` = 历史结果（修复前落库，note 里没有继承声明）⇒ UI 须提示重跑。
   */
  rebuildScope: RebuildScopeVerdict | null;
  /** 是否成功写入「回测历史」；旧结果未知时为 null。 */
  persistence: {
    persisted: boolean;
    errorCode: string | null;
    errorMessage: string | null;
  } | null;
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
    backtest: null,
    assembly: null,
    rebuildScope: null,
    persistence: null,
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
 * 解析 backtest 阶段的真实明细（曲线 / 撮合统计 / 跳过原因 / 成交）。
 *
 * 只在 `stageId="backtest"` 且 `state="EXECUTED"` 时读取；字段缺失一律降级（空数组 / null），
 * **绝不**构造节点或臆造数值 —— 与 `extractEvaluationScalars` 同一防御口径。
 */
function extractBacktestArtifacts(
  stages: readonly ClosedLoopStageRowViewModel[],
  rawStages: readonly unknown[],
): ClosedLoopBacktestArtifactsView | null {
  const index = stages.findIndex(s => s.stageId === "backtest" && s.state === "EXECUTED");
  if (index < 0) return null;
  const rawStage = rawStages[index];
  const output = isRecord(rawStage) && isRecord(rawStage.output) ? rawStage.output : null;
  if (output === null || output.kind !== "backtestSummary") return null;

  const curve: ClosedLoopEquityPointView[] = [];
  if (Array.isArray(output.equityCurve)) {
    for (const point of output.equityCurve) {
      if (!isRecord(point)) continue;
      const date = asStr(point.date);
      const equity = asNum(point.equity);
      // 曲线点缺日期或缺权益值 → 该点无意义，跳过（不补 0：补 0 会画出不存在的暴跌）
      if (date === null || equity === null) continue;
      curve.push({
        date,
        equity,
        cash: asNum(point.cash),
        marketValue: asNum(point.marketValue),
        openPositions: asNum(point.openPositions),
      });
    }
  }

  const asKeyedCounts = (v: unknown): ClosedLoopKeyedCount[] => {
    if (Array.isArray(v)) {
      return v
        .filter(isRecord)
        .map(item => ({
          key: asStr(item.code) ?? asStr(item.key) ?? "",
          count: asNum(item.count) ?? asNum(item.value) ?? 0,
        }))
        .filter(item => item.key !== "");
    }
    if (isRecord(v)) {
      return Object.entries(v)
        .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
        .map(([key, value]) => ({ key, count: value as number }));
    }
    return [];
  };

  const statsRaw = isRecord(output.executionStats) ? output.executionStats : null;
  const executionStats: ClosedLoopExecutionStatsView | null =
    statsRaw === null
      ? null
      : {
          totalSignals: asNum(statsRaw.totalSignals),
          totalOrders: asNum(statsRaw.totalOrders),
          totalFills: asNum(statsRaw.totalFills),
          rejectedOrders: asNum(statsRaw.rejectedOrders),
          partialFills: asNum(statsRaw.partialFills),
          byReason: asKeyedCounts(statsRaw.byReason).sort((a, b) => b.count - a.count),
        };

  const trades: ClosedLoopTradeView[] = [];
  if (Array.isArray(output.trades)) {
    for (const trade of output.trades) {
      if (!isRecord(trade)) continue;
      const securityId = asStr(trade.securityId);
      const entryTime = asStr(trade.entryTime);
      if (securityId === null || entryTime === null) continue;
      trades.push({
        securityId,
        entryTime,
        entryPrice: asNum(trade.entryPrice),
        exitTime: asStr(trade.exitTime),
        exitPrice: asNum(trade.exitPrice),
        quantity: asNum(trade.quantity),
        netPnl: asNum(trade.netPnl),
        returnPct: asNum(trade.returnPct),
        holdingPeriod: asNum(trade.holdingPeriod),
        openAtEnd: trade.openAtEnd === true,
        fees: asNum(trade.fees),
      });
    }
  }

  return {
    tradeCount: asNum(output.tradeCount) ?? trades.length,
    initialCapital: asNum(output.initialCapital),
    finalEquity: asNum(output.finalEquity),
    decisionDayCount: asNum(output.decisionDayCount),
    equityCurve: curve,
    executionStats,
    skippedCounts: asKeyedCounts(output.skippedCounts).sort((a, b) => b.count - a.count),
    costs: asKeyedCounts(output.costs),
    trades,
    tradesTruncated: output.tradesTruncated === true,
  };
}

/**
 * 解析真实数据装配摘要。
 *
 * 防御策略（与全文件一致）：非对象 / 缺 `datasetVersion` → null；
 * 缺字段一律降级为 null 或空值，绝不臆造（例如缺 datasetVersion 即视为「无装配信息」）。
 */
function extractAssembly(
  raw: unknown
): ClosedLoopRunAssemblyViewModel | null {
  if (!isRecord(raw)) return null;
  const datasetVersion = asStr(raw.datasetVersion);
  if (datasetVersion === null) return null;

  const sim = isRecord(raw.simulation) ? raw.simulation : null;
  const costRaw =
    sim && isRecord(sim.costModel) ? sim.costModel : null;

  return {
    datasetVersion,
    datasetGate: asStr(raw.datasetGate) ?? "UNKNOWN",
    datasetRowCount: asNum(raw.datasetRowCount),
    datasetSecurityCount: asNum(raw.datasetSecurityCount),
    datasetSource: asStr(raw.datasetSource) ?? "UNKNOWN",
    datasetSourceNote: asStr(raw.datasetSourceNote),
    datasetVersionId: asNum(raw.datasetVersionId),
    startDate: asStr(raw.startDate) ?? "",
    endDate: asStr(raw.endDate) ?? "",
    strategyId: asStr(raw.strategyId) ?? "",
    strategyVersion: asStr(raw.strategyVersion) ?? "",
    recipeId: asStr(raw.recipeId) ?? "",
    recipeSource: asStr(raw.recipeSource) ?? "UNKNOWN",
    recipeFeatureIds: asStrArray(raw.recipeFeatureIds),
    selectionSummary: asStr(raw.selectionSummary),
    simulation: {
      initialCapital: sim ? asNum(sim.initialCapital) : null,
      maxPositions: sim ? asNum(sim.maxPositions) : null,
      executionModel: sim ? asStr(sim.executionModel) ?? "—" : "—",
      costModel: costRaw
        ? {
            commissionRate: asNum(costRaw.commissionRate),
            minCommission: asNum(costRaw.minCommission),
            stampDutyRate: asNum(costRaw.stampDutyRate),
            transferFeeRate: asNum(costRaw.transferFeeRate),
            slippageBps: asNum(costRaw.slippageBps),
            impactBps: asNum(costRaw.impactBps),
          }
        : null,
    },
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
  const assemblyVm = extractAssembly(raw.assembly);
  const persistence = isRecord(raw.persistence)
    ? {
        persisted: raw.persistence.persisted === true,
        errorCode: asStr(raw.persistence.errorCode),
        errorMessage: asStr(raw.persistence.errorMessage),
      }
    : null;

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
    backtest: extractBacktestArtifacts(stages, rawStages),
    assembly: assemblyVm,
    rebuildScope:
      assemblyVm !== null && assemblyVm.datasetSource === "rebuild"
        ? classifyRebuildScope(assemblyVm.datasetSourceNote)
        : null,
    persistence,
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
