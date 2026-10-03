/** 通用策略评估模板：只消费持久化 evaluationDetail，不硬编码策略 / 收益 / 年份标签。 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SectionCard, StatusBadge } from "@/components/common";
export type StrategyEvaluationMetrics = {
  totalReturnPct: number | null; cagrPct: number | null; maxDrawdownPct: number | null;
  profitFactor: number | null; winRatePct: number | null; tradeCount: number;
  averageHoldingDays: number | null; medianHoldingDays: number | null;
  turnover: number; cost: number;
};
export type StrategyEvaluationYearRow = { totalReturnPct: number | null; maxDrawdownPct: number | null; tradeCount: number; profitFactor: number | null };
export type StrategyEvaluationSide = {
  strategyId: string; strategyVersion: string; label: string;
  full: StrategyEvaluationMetrics; oos: StrategyEvaluationMetrics; cost2: StrategyEvaluationMetrics;
  yearly: Record<string, StrategyEvaluationYearRow>;
  concentration: { count: number; top5SharePct: number | null; top10SharePct: number | null; maxWin: number | null; maxLoss: number | null };
  maxConsecutiveLosses: number; maxDrawdownDurationDays: number;
  drawdownCurve: { date: string; equity: number; drawdownPct: number }[];
  runner?: {
    triggerCount: number; coveragePct: number | null; directPnlIncrement: number;
    meanExtraPnl: number | null; medianExtraPnl: number | null; top10SharePct: number | null;
    extraHoldingDaysTotal: number; meanExtraHoldingDays: number | null; medianExtraHoldingDays: number | null;
    exitReasonDistribution: Record<string, number>; capitalCycleResidual: number;
  };
};
export type StrategyEvaluationDetail = {
  protocolFingerprint: string;
  evaluationWindow: { startDate: string; endDate: string };
  oosWindow: { startDate: string; endDate: string };
  datasetVersionId: number;
  baseline: StrategyEvaluationSide; promoted: StrategyEvaluationSide;
  delta: Record<string, unknown>;
  simulator: string; sameData: boolean; sameWindow: boolean; sameCostModel: boolean;
  generatedAt: string;
};

const n = (v: unknown, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "—");
const pct = (v: unknown, d = 2) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(d)}%` : "—");
const delta = (a: unknown, b: unknown, d = 2) => (typeof a === "number" && typeof b === "number" ? `${b - a >= 0 ? "+" : ""}${(b - a).toFixed(d)}` : "—");

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export interface StrategyEvaluationTemplateProps {
  readonly detail: StrategyEvaluationDetail;
  readonly runId?: string | null;
  readonly runStatus?: string;
  readonly loading?: boolean;
  readonly emptyText?: string;
}

export function StrategyEvaluationTemplate({ detail, runId, runStatus }: StrategyEvaluationTemplateProps) {
  const { baseline, promoted } = detail;
  const baselineLabel = baseline.label || baseline.strategyId;
  const promotedLabel = promoted.label || promoted.strategyId;
  const years = [...new Set([...Object.keys(baseline.yearly), ...Object.keys(promoted.yearly)])].sort();
  const yearlyRows = years.map((y) => ({
    year: y,
    baseline: baseline.yearly[y]?.totalReturnPct ?? null,
    promoted: promoted.yearly[y]?.totalReturnPct ?? null,
  }));
  const drawdownRows = promoted.drawdownCurve.map((p, i) => ({
    date: p.date,
    promoted: p.drawdownPct ?? 0,
    baseline: baseline.drawdownCurve[i]?.drawdownPct ?? null,
  }));
  const compare: { metric: string; a: string; c: string; d: string }[] = [
    { metric: "Total Return", a: pct(baseline.full.totalReturnPct), c: pct(promoted.full.totalReturnPct), d: delta(baseline.full.totalReturnPct, promoted.full.totalReturnPct) },
    { metric: "CAGR", a: pct(baseline.full.cagrPct), c: pct(promoted.full.cagrPct), d: delta(baseline.full.cagrPct, promoted.full.cagrPct) },
    { metric: "MaxDD", a: pct(baseline.full.maxDrawdownPct), c: pct(promoted.full.maxDrawdownPct), d: delta(baseline.full.maxDrawdownPct, promoted.full.maxDrawdownPct) },
    { metric: "Profit Factor", a: n(baseline.full.profitFactor, 4), c: n(promoted.full.profitFactor, 4), d: delta(baseline.full.profitFactor, promoted.full.profitFactor, 4) },
    { metric: "Trades", a: String(baseline.full.tradeCount), c: String(promoted.full.tradeCount), d: delta(baseline.full.tradeCount, promoted.full.tradeCount, 0) },
    { metric: "Turnover", a: money(baseline.full.turnover), c: money(promoted.full.turnover), d: money(promoted.full.turnover - baseline.full.turnover) },
    { metric: "Cost", a: money(baseline.full.cost), c: money(promoted.full.cost), d: money(promoted.full.cost - baseline.full.cost) },
    { metric: "OOS Return", a: pct(baseline.oos.totalReturnPct), c: pct(promoted.oos.totalReturnPct), d: delta(baseline.oos.totalReturnPct, promoted.oos.totalReturnPct) },
    { metric: "Top10% Share", a: pct(baseline.concentration.top10SharePct, 1), c: pct(promoted.concentration.top10SharePct, 1), d: delta(baseline.concentration.top10SharePct, promoted.concentration.top10SharePct, 1) },
  ];

  return (
    <div className="space-y-4 p-4">
      <SectionCard title="策略概览">
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label="Strategy" value={promoted.label} />
          <MetricCard label="语义" value={`${promoted.strategyId}@${promoted.strategyVersion}`} />
          <MetricCard label="Dataset" value={`dataset #${detail.datasetVersionId}`} />
          <MetricCard label="Evaluation Window" value={`${detail.evaluationWindow.startDate} ~ ${detail.evaluationWindow.endDate}`} />
          <MetricCard label="OOS Window" value={`${detail.oosWindow.startDate} ~ ${detail.oosWindow.endDate}`} />
          <div className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground">Run Status</div>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge status={runStatus ?? "COMPLETED"} />
              <span className="text-xs text-muted-foreground">{runId ?? "—"}</span>
            </div>
          </div>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          protocol {detail.protocolFingerprint} · simulator {detail.simulator} · 同数据/同窗口/同成本 = {String(detail.sameData)}/{String(detail.sameWindow)}/{String(detail.sameCostModel)}
        </div>
      </SectionCard>

      <SectionCard title={`核心指标（${promotedLabel}）`}>
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Total Return" value={pct(promoted.full.totalReturnPct)} />
          <MetricCard label="CAGR" value={pct(promoted.full.cagrPct)} />
          <MetricCard label="MaxDD" value={pct(promoted.full.maxDrawdownPct)} />
          <MetricCard label="Profit Factor" value={n(promoted.full.profitFactor, 4)} />
          <MetricCard label="Trades" value={String(promoted.full.tradeCount)} />
          <MetricCard label="Turnover" value={money(promoted.full.turnover)} />
          <MetricCard label="Cost" value={money(promoted.full.cost)} />
          <MetricCard label="Win Rate" value={pct(promoted.full.winRatePct)} />
          <MetricCard label="Avg Holding" value={n(promoted.full.averageHoldingDays, 2)} />
          <MetricCard label="Median Holding" value={n(promoted.full.medianHoldingDays, 1)} />
        </div>
      </SectionCard>

      <SectionCard title={`${promotedLabel} vs ${baselineLabel} 对照`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1">Metric</th><th className="py-1 text-right">{baselineLabel}</th><th className="py-1 text-right">{promotedLabel}</th><th className="py-1 text-right">Delta</th>
            </tr>
          </thead>
          <tbody>
            {compare.map((r) => (
              <tr key={r.metric} className="border-t border-border">
                <td className="py-1">{r.metric}</td>
                <td className="py-1 text-right tabular-nums">{r.a}</td>
                <td className="py-1 text-right tabular-nums">{r.c}</td>
                <td className="py-1 text-right tabular-nums">{r.d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard title="年度收益">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yearlyRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis unit="%" />
              <Tooltip />
              <Legend />
              <Bar dataKey="baseline" name={baselineLabel} fill="#64748b" />
              <Bar dataKey="promoted" name={promotedLabel} fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="回撤曲线">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={drawdownRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" minTickGap={60} />
              <YAxis unit="%" />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="baseline" name={baselineLabel} dot={false} stroke="#64748b" />
              <Line type="monotone" dataKey="promoted" name={promotedLabel} dot={false} stroke="#dc2626" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="Runner 专区">
        {promoted.runner === undefined ? (
          <div className="text-sm text-muted-foreground">无 Runner 数据</div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <MetricCard label="Trigger Count" value={String(promoted.runner.triggerCount)} />
              <MetricCard label="Coverage" value={pct(promoted.runner.coveragePct)} />
              <MetricCard label="Direct PnL Increment" value={money(promoted.runner.directPnlIncrement)} />
              <MetricCard label="Extra Holding Days" value={String(promoted.runner.extraHoldingDaysTotal)} />
              <MetricCard label="Mean Extra PnL" value={money(promoted.runner.meanExtraPnl)} />
              <MetricCard label="Median Extra PnL" value={money(promoted.runner.medianExtraPnl)} />
              <MetricCard label="Mean Extra Days" value={n(promoted.runner.meanExtraHoldingDays, 2)} />
              <MetricCard label="Top10% Share" value={pct(promoted.runner.top10SharePct, 1)} />
            </div>
            <div className="mt-3 text-sm">
              <div className="mb-1 text-xs text-muted-foreground">退出原因分布</div>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(promoted.runner.exitReasonDistribution).map(([k, v]) => (
                    <tr key={k} className="border-t border-border"><td className="py-1">{k}</td><td className="py-1 text-right tabular-nums">{v}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard title="收益集中度">
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Top 5% Share" value={pct(promoted.concentration.top5SharePct, 1)} />
          <MetricCard label="Top 10% Share" value={pct(promoted.concentration.top10SharePct, 1)} />
          <MetricCard label="Max Win" value={money(promoted.concentration.maxWin)} />
          <MetricCard label="Max Loss" value={money(promoted.concentration.maxLoss)} />
          <MetricCard label="Max Consecutive Losses" value={String(promoted.maxConsecutiveLosses)} />
          <MetricCard label="Max DD Duration (days)" value={String(promoted.maxDrawdownDurationDays)} />
          <MetricCard label={`${baselineLabel} Top 10% Share`} value={pct(baseline.concentration.top10SharePct, 1)} />
          <MetricCard label={`${baselineLabel} Max DD Duration (days)`} value={String(baseline.maxDrawdownDurationDays)} />
        </div>
      </SectionCard>

      <SectionCard title="成本敏感性">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1">Cost</th><th className="py-1 text-right">{baselineLabel} Return</th><th className="py-1 text-right">{promotedLabel} Return</th>
              <th className="py-1 text-right">{baselineLabel} MaxDD</th><th className="py-1 text-right">{promotedLabel} MaxDD</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="py-1">Standard Cost</td>
              <td className="py-1 text-right tabular-nums">{pct(baseline.full.totalReturnPct)}</td>
              <td className="py-1 text-right tabular-nums">{pct(promoted.full.totalReturnPct)}</td>
              <td className="py-1 text-right tabular-nums">{pct(baseline.full.maxDrawdownPct)}</td>
              <td className="py-1 text-right tabular-nums">{pct(promoted.full.maxDrawdownPct)}</td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-1">Cost ×2</td>
              <td className="py-1 text-right tabular-nums">{pct(baseline.cost2.totalReturnPct)}</td>
              <td className="py-1 text-right tabular-nums">{pct(promoted.cost2.totalReturnPct)}</td>
              <td className="py-1 text-right tabular-nums">{pct(baseline.cost2.maxDrawdownPct)}</td>
              <td className="py-1 text-right tabular-nums">{pct(promoted.cost2.maxDrawdownPct)}</td>
            </tr>
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}
