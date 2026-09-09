/**
 * runResultAdapter — Run / Backtest Result 的 Frontend Adapter（任务 §17，结构预留）。
 *
 * 现状：后端**尚无**策略级 Run Workbench / Backtest Result 端点（FE-4 仅有
 * validate/bump/compare/lifecycle）。本 adapter 只定义前端展示形态 + 防御性解析，
 * 供 Phase 6 Run Workbench 的 Empty State 与后续结果接入使用。
 *
 * 铁律：`parseRunResult` 在无真实数据时返回 `null`（前端渲染 Empty State），
 * **绝不由前端生成收益率 / Sharpe / 回撤等任何业务指标**。
 */

export interface RunResultViewModel {
  runId: string;
  status:
    | "NOT_RUN"
    | "READY"
    | "RUNNING"
    | "SUCCESS"
    | "FAILED"
    | "INCONCLUSIVE"
    | string;
  strategyVersion: string | null;
  datasetVersion: string | null;
  createdAt: string | null;
  durationMs: number | null;
  metrics: {
    totalReturnPct: number | null;
    annualizedReturnPct: number | null;
    maxDrawdownPct: number | null;
    winRatePct: number | null;
    profitFactor: number | null;
    sharpe: number | null;
    tradeCount: number | null;
  };
  /** 是否存在任何真实结果数据（无则 UI 展示 Empty State）。 */
  hasData: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** 空结果（供 NOT_RUN / Empty State）。 */
export function emptyRunResult(): RunResultViewModel {
  return {
    runId: "",
    status: "NOT_RUN",
    strategyVersion: null,
    datasetVersion: null,
    createdAt: null,
    durationMs: null,
    metrics: {
      totalReturnPct: null,
      annualizedReturnPct: null,
      maxDrawdownPct: null,
      winRatePct: null,
      profitFactor: null,
      sharpe: null,
      tradeCount: null,
    },
    hasData: false,
  };
}

/**
 * 防御性解析 run/backtest 结果。
 * 无数据（null/undefined/非对象）→ 返回 null；有对象但字段缺失 → 给 null 占位，不臆造。
 */
export function parseRunResult(raw: unknown): RunResultViewModel | null {
  if (!isRecord(raw)) return null;
  const m = isRecord(raw.metrics) ? raw.metrics : {};
  const metrics = {
    totalReturnPct: asNum(m.totalReturnPct) ?? asNum(m.totalReturn),
    annualizedReturnPct: asNum(m.annualizedReturnPct),
    maxDrawdownPct: asNum(m.maxDrawdownPct),
    winRatePct: asNum(m.winRatePct) ?? asNum(m.winRate),
    profitFactor: asNum(m.profitFactor),
    sharpe: asNum(m.sharpe) ?? asNum(m.sharpeRatio),
    tradeCount: asNum(m.tradeCount),
  };
  const hasData =
    Object.values(metrics).some(v => v !== null) || Boolean(asStr(raw.runId));
  return {
    runId: asStr(raw.runId) ?? "",
    status: asStr(raw.status) ?? "NOT_RUN",
    strategyVersion: asStr(raw.strategyVersion),
    datasetVersion: asStr(raw.datasetVersion),
    createdAt: asStr(raw.createdAt),
    durationMs: asNum(raw.durationMs),
    metrics,
    hasData,
  };
}
