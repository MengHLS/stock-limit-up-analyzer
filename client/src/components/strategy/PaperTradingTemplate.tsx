/** 通用 Paper Trading 展示模板：数据必须来自持久化 API，策略专属列由调用页注入。 */
import type { ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard, StatusBadge } from "@/components/common";
export type PaperSignalRecord = { tradeDate: string; stock: string; inTop3: boolean; newHigh3: boolean; signalTime: string; plannedEntryPrice: number | null };
export type PaperFillRecord = { tradeDate: string; stock: string; side: string; plannedPrice: number | null; simulatedFillPrice: number | null; quantity: number; cost: number; slippage: number; status: string };
export type PaperPositionRecord = { tradeDate: string; stock: string; entryDate: string; entryPrice: number; currentPrice: number | null; holdingDays: number; runnerState: string; peakPrice: number | null; unrealizedPnL: number | null; exitCondition: string | null };
export type PaperExitRecord = { tradeDate: string; stock: string; exitPrice: number | null; exitReason: string; realizedPnL: number | null; holdingDays: number | null; usedRunner: boolean };
export type PaperDailyRecord = { tradeDate: string; equity: number; cash: number; marketValue: number; dailyReturnPct: number | null; cumulativeReturnPct: number | null; drawdownPct: number; signals: PaperSignalRecord[]; fills: PaperFillRecord[]; positions: PaperPositionRecord[]; exits: PaperExitRecord[] };
export type PaperForwardDaily = { tradeDate: string; equity: number; drawdownPct: number; cash: number; marketValue: number };
export type PaperForwardState = {
  runId: string; status: string; latestDataDate: string; lastProcessedTradingDate: string;
  nextTradingDate: string | null; lastRunAt: string; lastError: string | null;
  baselineRunId: string; baselineLastProcessedDate: string;
  account: { cash: number; marketValue: number; equity: number; peakEquity: number; dailyReturnPct: number | null; cumulativeReturnPct: number; drawdownPct: number };
  carriedPositions: PaperPositionRecord[]; forwardDaily: PaperForwardDaily[];
  forwardStats: { newTradeCount: number; newSignalCount: number; newRunnerCount: number; forwardReturnPct: number | null; forwardMaxDrawdownPct: number | null; forwardProfitFactor: number | null; forwardWinRatePct: number | null; forwardAverageHoldingDays: number | null; runnerDirectContribution: number };
  forwardHistory: PaperExitRecord[];
};
export type PaperTradingState = {
  strategyVersionId: number; strategyId: string; strategyVersion: string; datasetVersionId: number;
  runner: { state: string; decisionHoldingDays: number; extendToHoldingDays: number };
  window: { startDate: string; endDate: string };
  provenanceId: number; holdoutRunId: string;
  initialCapital: number; maxPositions: number; singlePositionRatio: number;
  daily: PaperDailyRecord[];
  account: { equity: number; cash: number; marketValue: number; cumulativeReturnPct: number; maxDrawdownPct: number; currentDrawdownPct: number; todayReturnPct: number | null };
  openPositions: PaperPositionRecord[]; history: PaperExitRecord[];
  lastRunAt: string; runStatus: string; dataIssue: string | null;
};

const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "—");
const pct = (v: unknown, d = 2) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(d)}%` : "—");
const num = (v: unknown, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");

export interface PaperTradingSignalColumn {
  readonly key: string;
  readonly header: string;
  readonly value: (signal: PaperSignalRecord, index: number, fill?: PaperFillRecord) => ReactNode;
}

export interface PaperTradingTemplateProps {
  readonly state: PaperTradingState;
  readonly forward?: PaperForwardState | null;
  readonly signalColumns?: readonly PaperTradingSignalColumn[];
}

export function PaperTradingTemplate({ state, forward = null, signalColumns = [] }: PaperTradingTemplateProps) {  const today = state.daily.at(-1);
  const recentSignals = state.daily.flatMap((d) => d.signals).slice(-20).reverse();
  const fillsByStock = new Map((today?.fills ?? []).map((f) => [f.stock, f]));
  const curve = state.daily.map((d) => ({ date: d.tradeDate, equity: d.equity, drawdownPct: d.drawdownPct }));
  const recentHistory = [...state.history].reverse().slice(0, 40);

  return (
    <div className="space-y-4 p-4">
      <SectionCard title="策略运行状态">
        <div className="grid gap-3 md:grid-cols-4 text-sm">
          <div><div className="text-xs text-muted-foreground">Strategy Version</div><div className="font-semibold">#{state.strategyVersionId} · {state.strategyId}@{state.strategyVersion}</div></div>
          <div><div className="text-xs text-muted-foreground">Runner</div><div className="font-semibold">{state.runner.state} / {state.runner.decisionHoldingDays} → {state.runner.extendToHoldingDays}</div></div>
          <div><div className="text-xs text-muted-foreground">Dataset</div><div className="font-semibold">#{state.datasetVersionId}</div></div>
          <div><div className="text-xs text-muted-foreground">Data Date</div><div className="font-semibold">{today?.tradeDate ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">最近一次运行</div><div className="font-semibold">{state.lastRunAt}</div></div>
          <div><div className="text-xs text-muted-foreground">Run Status</div><StatusBadge status={state.runStatus} /></div>
          <div><div className="text-xs text-muted-foreground">数据缺失 / 异常</div><div className="font-semibold">{state.dataIssue ?? "无"}</div></div>
          <div><div className="text-xs text-muted-foreground">溯源</div><div className="font-semibold">provenance {state.provenanceId} · {state.holdoutRunId}</div></div>
        </div>
      </SectionCard>

      <SectionCard title="账户">
        <div className="grid gap-3 md:grid-cols-4 text-sm">
          <div><div className="text-xs text-muted-foreground">总权益</div><div className="text-lg font-semibold tabular-nums">{money(state.account.equity)}</div></div>
          <div><div className="text-xs text-muted-foreground">现金</div><div className="text-lg font-semibold tabular-nums">{money(state.account.cash)}</div></div>
          <div><div className="text-xs text-muted-foreground">持仓市值</div><div className="text-lg font-semibold tabular-nums">{money(state.account.marketValue)}</div></div>
          <div><div className="text-xs text-muted-foreground">累计收益</div><div className="text-lg font-semibold tabular-nums">{pct(state.account.cumulativeReturnPct)}</div></div>
          <div><div className="text-xs text-muted-foreground">今日收益</div><div className="font-semibold tabular-nums">{pct(state.account.todayReturnPct)}</div></div>
          <div><div className="text-xs text-muted-foreground">MaxDD</div><div className="font-semibold tabular-nums">{pct(state.account.maxDrawdownPct)}</div></div>
          <div><div className="text-xs text-muted-foreground">当前回撤</div><div className="font-semibold tabular-nums">{pct(state.account.currentDrawdownPct)}</div></div>
          <div><div className="text-xs text-muted-foreground">初始资金 / 单仓</div><div className="font-semibold">{money(state.initialCapital)} · {pct(state.singlePositionRatio * 100, 0)}</div></div>
        </div>
      </SectionCard>

      <SectionCard title={`今日策略池（${today?.tradeDate ?? "—"}）`}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground">
            <th className="py-1">股票</th>{signalColumns.map((column) => <th key={column.key} className="py-1">{column.header}</th>)}
            <th className="py-1 text-right">计划入场</th><th className="py-1 text-right">实际模拟成交</th><th className="py-1">状态</th>
          </tr></thead>
          <tbody>
            {(today?.signals ?? []).map((s, i) => {
              const fill = fillsByStock.get(s.stock);
              return (
                <tr key={s.stock + i} className="border-t border-border">
                  <td className="py-1 font-mono text-xs">{s.stock}</td>
                  {signalColumns.map((column) => <td key={column.key} className="py-1">{column.value(s, i, fill)}</td>)}
                  <td className="py-1 text-right tabular-nums">{num(s.plannedEntryPrice)}</td>
                  <td className="py-1 text-right tabular-nums">{fill ? num(fill.simulatedFillPrice) : "—"}</td>
                  <td className="py-1">{fill ? fill.status : "WAITING_FILL"}</td>
                </tr>
              );
            })}
            {(today?.signals ?? []).length === 0 && <tr><td className="py-2 text-muted-foreground" colSpan={4 + signalColumns.length}>当日无 Top3 信号</td></tr>}
          </tbody>
        </table>
        <div className="mt-2 text-xs text-muted-foreground">近期信号（最近 20 条，倒序）</div>
        <table className="mt-1 w-full text-sm">
          <tbody>
            {recentSignals.map((s, i) => (
              <tr key={"r" + s.tradeDate + s.stock + i} className="border-t border-border">
                <td className="py-1">{s.tradeDate}</td><td className="py-1 font-mono text-xs">{s.stock}</td>
                <td className="py-1 text-right tabular-nums">{num(s.plannedEntryPrice)}</td>
                <td className="py-1 text-xs text-muted-foreground">{s.signalTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard title="当前持仓">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground">
            <th className="py-1">股票</th><th className="py-1 text-right">入场价</th><th className="py-1 text-right">现价</th>
            <th className="py-1 text-right">持仓天数</th><th className="py-1">Runner 状态</th>
            <th className="py-1 text-right">浮盈亏</th><th className="py-1">退出条件</th>
          </tr></thead>
          <tbody>
            {state.openPositions.map((p, i) => (
              <tr key={p.stock + i} className="border-t border-border">
                <td className="py-1 font-mono text-xs">{p.stock}</td>
                <td className="py-1 text-right tabular-nums">{num(p.entryPrice)}</td>
                <td className="py-1 text-right tabular-nums">{num(p.currentPrice)}</td>
                <td className="py-1 text-right tabular-nums">{p.holdingDays}</td>
                <td className="py-1">{p.runnerState}</td>
                <td className="py-1 text-right tabular-nums">{money(p.unrealizedPnL)}</td>
                <td className="py-1 text-xs text-muted-foreground">{p.exitCondition ?? "按原止损 / 趋势 / strongHold 逐日判定"}</td>
              </tr>
            ))}
            {state.openPositions.length === 0 && <tr><td className="py-2 text-muted-foreground" colSpan={7}>当前无持仓（期末已清仓）</td></tr>}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard title="权益 / 回撤">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curve}>
              <XAxis dataKey="date" minTickGap={60} /><YAxis /><Tooltip />
              <Line type="monotone" dataKey="equity" name="Equity" dot={false} stroke="#dc2626" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title={`历史交易（共 ${state.history.length} 笔，显示最近 ${recentHistory.length} 笔）`}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground">
            <th className="py-1">日期</th><th className="py-1">股票</th><th className="py-1 text-right">退出价</th>
            <th className="py-1">退出原因</th><th className="py-1 text-right">持仓天数</th>
            <th className="py-1 text-right">PnL</th><th className="py-1">Runner</th>
          </tr></thead>
          <tbody>
            {recentHistory.map((h, i) => (
              <tr key={h.tradeDate + h.stock + i} className="border-t border-border">
                <td className="py-1">{h.tradeDate}</td><td className="py-1 font-mono text-xs">{h.stock}</td>
                <td className="py-1 text-right tabular-nums">{num(h.exitPrice)}</td>
                <td className="py-1">{h.exitReason}</td>
                <td className="py-1 text-right tabular-nums">{h.holdingDays ?? "—"}</td>
                <td className="py-1 text-right tabular-nums">{money(h.realizedPnL)}</td>
                <td className="py-1">{h.usedRunner ? "是" : "否"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard title="实时状态（Forward Paper Trading）">
        {forward === null ? (
          <div className="text-sm text-muted-foreground">尚未创建前向运行。</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Latest Data Date</div><div className="font-semibold">{forward.latestDataDate}</div></div>
            <div><div className="text-xs text-muted-foreground">Last Processed Date</div><div className="font-semibold">{forward.lastProcessedTradingDate}</div></div>
            <div><div className="text-xs text-muted-foreground">Next Trading Date</div><div className="font-semibold">{forward.nextTradingDate ?? "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Last Run</div><div className="font-semibold">{forward.lastRunAt}</div></div>
            <div><div className="text-xs text-muted-foreground">Run Status</div><StatusBadge status={forward.status} /></div>
            <div><div className="text-xs text-muted-foreground">数据缺失 / 执行错误</div><div className="font-semibold">{forward.lastError ?? "无"}</div></div>
            <div><div className="text-xs text-muted-foreground">基线</div><div className="font-semibold">{forward.baselineRunId}（{forward.baselineLastProcessedDate}）</div></div>
            <div><div className="text-xs text-muted-foreground">新增交易日</div><div className="font-semibold">{forward.forwardDaily.length}</div></div>
            <div><div className="text-xs text-muted-foreground">前向账户权益</div><div className="font-semibold tabular-nums">{money(forward.account.equity)}</div></div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Forward 统计（仅真实新增交易日）">
        {forward === null || forward.forwardDaily.length === 0 ? (
          <div className="text-sm text-muted-foreground">尚无新增交易日 —— Forward 表现不可用（等待新数据，不用历史数据冒充前向）。</div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-4 text-sm">
              <div><div className="text-xs text-muted-foreground">新增交易数</div><div className="font-semibold tabular-nums">{forward.forwardStats.newTradeCount}</div></div>
              <div><div className="text-xs text-muted-foreground">新增信号数</div><div className="font-semibold tabular-nums">{forward.forwardStats.newSignalCount}</div></div>
              <div><div className="text-xs text-muted-foreground">新增 Runner 数</div><div className="font-semibold tabular-nums">{forward.forwardStats.newRunnerCount}</div></div>
              <div><div className="text-xs text-muted-foreground">Forward Return</div><div className="font-semibold tabular-nums">{pct(forward.forwardStats.forwardReturnPct)}</div></div>
              <div><div className="text-xs text-muted-foreground">Forward MaxDD</div><div className="font-semibold tabular-nums">{pct(forward.forwardStats.forwardMaxDrawdownPct)}</div></div>
              <div><div className="text-xs text-muted-foreground">Forward PF</div><div className="font-semibold tabular-nums">{num(forward.forwardStats.forwardProfitFactor, 4)}</div></div>
              <div><div className="text-xs text-muted-foreground">Forward 胜率</div><div className="font-semibold tabular-nums">{pct(forward.forwardStats.forwardWinRatePct)}</div></div>
              <div><div className="text-xs text-muted-foreground">Forward 平均持仓</div><div className="font-semibold tabular-nums">{num(forward.forwardStats.forwardAverageHoldingDays, 2)}</div></div>
              <div><div className="text-xs text-muted-foreground">Runner 直接贡献</div><div className="font-semibold tabular-nums">{money(forward.forwardStats.runnerDirectContribution)}</div></div>
            </div>
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={forward.forwardDaily.map((d) => ({ date: d.tradeDate, equity: d.equity }))}>
                  <XAxis dataKey="date" minTickGap={60} /><YAxis /><Tooltip />
                  <Line type="monotone" dataKey="equity" name="Forward Equity" dot={false} stroke="#2563eb" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard title="Historical Backtest vs Live Paper Forward">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground">
            <th className="py-1">指标</th><th className="py-1 text-right">Historical Backtest</th><th className="py-1 text-right">Forward Paper</th><th className="py-1 text-right">Delta</th>
          </tr></thead>
          <tbody>
            <tr className="border-t border-border"><td className="py-1">Return</td><td className="py-1 text-right tabular-nums">{pct(state.account.cumulativeReturnPct)}</td><td className="py-1 text-right tabular-nums">{pct(forward?.forwardStats.forwardReturnPct)}</td><td className="py-1 text-right tabular-nums">{forward?.forwardStats.forwardReturnPct == null ? "—" : pct(forward.forwardStats.forwardReturnPct - state.account.cumulativeReturnPct)}</td></tr>
            <tr className="border-t border-border"><td className="py-1">MaxDD</td><td className="py-1 text-right tabular-nums">{pct(state.account.maxDrawdownPct)}</td><td className="py-1 text-right tabular-nums">{pct(forward?.forwardStats.forwardMaxDrawdownPct)}</td><td className="py-1 text-right tabular-nums">—</td></tr>
            <tr className="border-t border-border"><td className="py-1">PF</td><td className="py-1 text-right tabular-nums">—</td><td className="py-1 text-right tabular-nums">{num(forward?.forwardStats.forwardProfitFactor, 4)}</td><td className="py-1 text-right tabular-nums">—</td></tr>
            <tr className="border-t border-border"><td className="py-1">Win Rate</td><td className="py-1 text-right tabular-nums">—</td><td className="py-1 text-right tabular-nums">{pct(forward?.forwardStats.forwardWinRatePct)}</td><td className="py-1 text-right tabular-nums">—</td></tr>
            <tr className="border-t border-border"><td className="py-1">Trade Count</td><td className="py-1 text-right tabular-nums">{state.history.length}</td><td className="py-1 text-right tabular-nums">{forward?.forwardStats.newTradeCount ?? "—"}</td><td className="py-1 text-right tabular-nums">{forward === null ? "—" : String(forward.forwardStats.newTradeCount - state.history.length)}</td></tr>
            <tr className="border-t border-border"><td className="py-1">Avg Holding</td><td className="py-1 text-right tabular-nums">—</td><td className="py-1 text-right tabular-nums">{num(forward?.forwardStats.forwardAverageHoldingDays, 2)}</td><td className="py-1 text-right tabular-nums">—</td></tr>
            <tr className="border-t border-border"><td className="py-1">Runner Contribution</td><td className="py-1 text-right tabular-nums">—</td><td className="py-1 text-right tabular-nums">{money(forward?.forwardStats.runnerDirectContribution)}</td><td className="py-1 text-right tabular-nums">—</td></tr>
          </tbody>
        </table>
        <div className="mt-2 text-xs text-muted-foreground">Forward 数据只来自真实新增交易日；无新数据时该列为空，不用历史数据冒充。</div>
      </SectionCard>
    </div>
  );
}
