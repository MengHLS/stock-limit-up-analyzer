/**
 * FE-5 — 绩效仪表盘（Performance Dashboard）：研究链路 run 绩效查看器。
 *
 * 展示规格（ROADMAP §48.4 FE-5）：Equity 曲线 / Drawdown / Trade 明细 /
 * 指标卡（CAGR/MaxDD/Sharpe/Sortino/Calmar/WinRate/PF/Expectancy/Turnover/月年度一致性）/
 * Regime 表现。
 *
 * 纪律（§0.2 / §31 / 前端不是 Quant Engine）：
 * - **只读渲染**：数值一律来自后端 `research.metrics.evaluate`（C-16.1/16.2/16.3
 *   同源评估记录），本页**不计算任何指标**，不本地加工曲线；
 * - **技术预览口径（R7）**：研究 run 端点（closedLoop）尚未绑定真实数据注入，
 *   本页提供「技术预览」数据源——以生产回测（getLeaderCandidateResearch）的
 *   realisticSimulation 作为 equityCurve/trades 输入，喂给研究绩效评估器求值，
 *   结果**属技术预览、非 RESEARCH_READY 口径**（页面顶部醒目提示条）；
 * - **诚实空态**：未运行 / 数据未就绪时指标全「—」、曲线/交易全 Empty State，
 *   绝不伪造收益率/Sharpe/回撤/曲线点。
 */

import { useState } from "react";
import {
  Activity,
  Loader2,
  Play,
  ShieldCheck,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import {
  SectionCard,
  StatusBadge,
  MetricCard,
  EmptyState,
  TechnicalDetails,
  DataTable,
} from "@/components/common";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type ReadinessOutput =
  inferRouterOutputs<AppRouter>["researchRun"]["readiness"];
type ResearchOutput =
  inferRouterOutputs<AppRouter>["sentiment"]["getLeaderCandidateBacktest"];
type MetricsOutput =
  inferRouterOutputs<AppRouter>["research"]["metrics"]["evaluate"];
type Simulation = NonNullable<ResearchOutput["realisticSimulation"]>;

// ---------------------------------------------------------------------------
// 指标口径字典（只描述「将展示什么」，不含任何数值）
// ---------------------------------------------------------------------------

const METRIC_CARDS: { label: string; hint: string }[] = [
  { label: "总收益率", hint: "期末权益 / 期初权益 − 1（%）" },
  { label: "年化 CAGR", hint: "几何年化（%）" },
  { label: "最大回撤", hint: "running-peak 口径（%）" },
  { label: "Sharpe", hint: "年化超额收益 / 年化波动（rf 默认 0）" },
  { label: "Sortino", hint: "仅计下行偏差（C-16.2）" },
  { label: "Calmar", hint: "CAGR / |MaxDD|；无回撤显式 —" },
  { label: "胜率", hint: "已平仓交易中盈利占比（%）" },
  { label: "Profit Factor", hint: "总盈利 / |总亏损|" },
  { label: "期望 Expectancy", hint: "平均每笔净盈亏（元/笔）" },
  { label: "年化换手", hint: "双边名义成交 / 平均资产（倍/年）" },
  { label: "交易次数", hint: "已完成 / 全部（含期末未平仓）" },
];

const TRADE_COLUMNS = [
  "标的",
  "开仓时间",
  "开仓价",
  "平仓时间",
  "平仓价",
  "数量",
  "净盈亏",
  "收益率",
  "持有(日)",
  "期末未平",
  "退出原因",
];

// ---------------------------------------------------------------------------
// 技术预览数据源：生产回测 realisticSimulation → 研究绩效评估输入
// ---------------------------------------------------------------------------

/**
 * RealisticEquityPoint → EquityPoint（补 marketValue = equity − cash）。
 * 纯字段映射，不做任何指标计算。
 */
function toEquityPoints(sim: Simulation) {
  return sim.equityCurve.map((p) => ({
    date: p.date,
    equity: p.equity,
    cash: p.cash,
    openPositions: p.openPositions,
    marketValue: p.equity - p.cash,
  }));
}

/**
 * RealisticTrade → Trade（技术预览口径）。
 * 注：RealisticTrade 无 grossPnL / 独立 slippage，此处 grossPnL 以 netPnl 近似、
 * slippageAmount 记 0；holdingPeriod 由后端 C-16.3 依据曲线日期索引重算（详见
 * tradeQualityMetrics.analyze computeAverageHoldingPeriodDays 口径）。
 */
function toTrades(sim: Simulation) {
  return (sim.trades ?? [])
    .filter((t) => t.status === "filled")
    .map((t) => ({
      securityId: t.stockCode,
      entryTime: t.entryDate ?? "",
      entryPrice: t.entryPrice ?? 0,
      exitTime: t.exitDate,
      exitPrice: t.exitPrice,
      quantity: t.shares,
      grossPnL: t.netPnl,
      fees: t.totalFees,
      slippageAmount: 0,
      netPnl: t.netPnl,
      returnPct: t.netReturn,
      holdingPeriod: null,
      openAtEnd: t.exitDate === null,
      reason: t.reason,
    }));
}

// ---------------------------------------------------------------------------
// 就绪门辅助组件（由后端 researchRun.readiness 驱动，不写死前置）
// ---------------------------------------------------------------------------

function verdictStatus(verdict: string): string {
  if (verdict === "READY_TO_RUN") return "SUCCESS";
  if (verdict === "EXECUTOR_NOT_BOUND") return "INFO";
  return "INCONCLUSIVE";
}

function ReadinessBadge({
  canRun,
  loading,
  error,
}: {
  canRun: boolean;
  loading: boolean;
  error: boolean;
}) {
  if (loading)
    return <StatusBadge status="INFO" label="探测中…" icon={Loader2} />;
  if (error) return <StatusBadge status="ERROR" label="探测失败" />;
  return canRun ? (
    <StatusBadge status="SUCCESS" label="READY_TO_RUN" icon={ShieldCheck} />
  ) : (
    <StatusBadge status="INCONCLUSIVE" label="未就绪" />
  );
}

function ReadinessGateContent({
  loading,
  error,
  data,
}: {
  loading: boolean;
  error: boolean;
  data: ReadinessOutput | null;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        正在探测研究 run 就绪状态…
      </p>
    );
  }
  if (error || !data) {
    return (
      <EmptyState
        title="运行就绪探测失败"
        description="无法从后端 researchRun.readiness 获取就绪状态；请确认服务已启动并检查后端日志。"
      />
    );
  }

  const gate = data.datasetGate;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge
          status={verdictStatus(data.verdict)}
          label={data.verdict}
        />
        {data.executorBound ? (
          <StatusBadge status="SUCCESS" label="EXECUTOR_BOUND" />
        ) : (
          <StatusBadge status="INFO" label="EXECUTOR_NOT_BOUND" />
        )}
        <StatusBadge
          status={data.strategies.length > 0 ? "SUCCESS" : "INCONCLUSIVE"}
          label={`已注册策略 ${data.strategies.length}`}
        />
      </div>

      {data.canRun ? (
        <p className="flex items-center gap-1.5 text-sm text-emerald-700">
          <ShieldCheck className="h-4 w-4" />
          研究链路已就绪：数据域认证通过、策略已注册、执行器已绑定。真实 run
          结果到达后，下方区域将自动渲染（无假数据过渡）。
        </p>
      ) : (
        <div className="space-y-2">
          <ul className="max-w-3xl space-y-1">
            {data.reasons.map((reason, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
              >
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
          {gate && (
            <div className="max-w-3xl rounded-md border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              <p>
                gate 认证快照：
                {gate.evidenceAvailable ? (
                  <>
                    RESEARCH_READY={gate.researchReady ? "TRUE" : "FALSE"} ·
                    PASS {gate.passCount} / PENDING {gate.pendingCount} / FAIL{" "}
                    {gate.failCount}
                    {gate.capturedAt ? ` · captured ${gate.capturedAt}` : ""}
                  </>
                ) : (
                  <>证据不可用：{gate.evidenceError ?? "gate 文件缺失"}</>
                )}
              </p>
              {gate.pendingChecks.length > 0 && (
                <p className="mt-0.5 text-amber-700">
                  未认证项：{gate.pendingChecks.join("、")}（C/D/E
                  域回填完成后重新 certify 即解锁）
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 数值格式化与涨跌着色（中国 A 股约定：涨红跌绿）
// ---------------------------------------------------------------------------

const fmtPct = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "—" : `${v.toFixed(digits)}%`;
const fmtNum = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "—" : v.toFixed(digits);
const pnlTone = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : v >= 0 ? "text-rose-600" : "text-emerald-700";

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

export default function PerformanceDashboard() {
  const readinessQuery = trpc.researchRun.readiness.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 技术预览数据源：手动触发生产回测（enabled: false），再喂给研究绩效评估器。
  const researchQuery = trpc.sentiment.getLeaderCandidateBacktest.useQuery(
    undefined,
    { enabled: false }
  );
  const metricsMutation = trpc.research.metrics.evaluate.useMutation();
  const [previewError, setPreviewError] = useState<string | null>(null);

  const metrics: MetricsOutput | null = metricsMutation.data ?? null;

  const runPreview = async () => {
    setPreviewError(null);
    try {
      const research = await researchQuery.refetch();
      const sim = research.data?.realisticSimulation;
      if (!sim || sim.equityCurve.length === 0) {
        setPreviewError("回测未返回有效权益曲线（equityCurve 为空）。");
        return;
      }
      metricsMutation.mutate({
        equityCurve: toEquityPoints(sim),
        trades: toTrades(sim),
      });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    }
  };

  const perf = metrics?.performance.metrics;
  const riskAdj = metrics?.riskAdjusted.metrics;
  const tradeQuality = metrics?.tradeQuality.metrics.tradeQuality ?? null;
  const monthly = metrics?.tradeQuality.metrics.monthly ?? null;
  const yearly = metrics?.tradeQuality.metrics.yearly ?? null;

  const equitySeries =
    researchQuery.data?.realisticSimulation.equityCurve.map((p) => ({
      date: p.date.slice(5),
      equity: p.equity,
    })) ?? [];

  const drawdownSegments = perf?.drawdown.drawdownSegments ?? [];
  const trades = metrics?.performance
    ? (toTrades(researchQuery.data?.realisticSimulation as Simulation))
    : [];

  const loading = researchQuery.isFetching || metricsMutation.isPending;

  const metricValues: Array<{ label: string; value: React.ReactNode; tone?: string }> = [
    { label: "总收益率", value: <span className={pnlTone(perf?.returns.totalReturnPct)}>{fmtPct(perf?.returns.totalReturnPct)}</span> },
    { label: "年化 CAGR", value: <span className={pnlTone(perf?.returns.cagrPct)}>{fmtPct(perf?.returns.cagrPct)}</span> },
    { label: "最大回撤", value: <span className="text-emerald-700">{fmtPct(perf?.drawdown.maxDrawdownPct)}</span> },
    { label: "Sharpe", value: fmtNum(riskAdj?.sharpeRatio) },
    { label: "Sortino", value: fmtNum(riskAdj?.sortinoRatio) },
    { label: "Calmar", value: fmtNum(riskAdj?.calmarRatio) },
    { label: "胜率", value: fmtPct(tradeQuality?.winRatePct, 1) },
    { label: "Profit Factor", value: fmtNum(tradeQuality?.profitFactor) },
    { label: "期望 Expectancy", value: fmtNum(tradeQuality?.expectancy) },
    { label: "年化换手", value: fmtNum(tradeQuality?.turnover.annualizedTurnover) },
    {
      label: "交易次数",
      value:
        tradeQuality === null
          ? "—"
          : `${tradeQuality.completedTradeCount} / ${tradeQuality.totalTradeCount}`,
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <TrendingUp className="h-5 w-5" />
          绩效仪表盘
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          FE-5 · 研究链路绩效查看器——Equity 曲线 / 回撤 / 指标卡 / 交易明细 /
          月年一致性；指标由后端 C-16.1/16.2/16.3 同源评估记录给出，本页不计算、不伪造。
        </p>
      </div>

      {/* 数据就绪门（后端 researchRun.readiness 只读探测） */}
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            数据就绪门
            <ReadinessBadge
              canRun={readinessQuery.data?.canRun ?? false}
              loading={readinessQuery.isLoading}
              error={readinessQuery.isError}
            />
          </span>
        }
        icon={Activity}
        description="由后端 researchRun.readiness 探测：数据认证 gate + 策略注册 + 执行器绑定。就绪后本页自动渲染真实 run 绩效。"
      >
        <ReadinessGateContent
          loading={readinessQuery.isLoading}
          error={readinessQuery.isError}
          data={readinessQuery.data ?? null}
        />
      </SectionCard>

      {/* 技术预览数据源（R7 隔离标注） */}
      <SectionCard
        title="技术预览（非 RESEARCH_READY 口径）"
        icon={Play}
        description="研究 run 端点未绑定真实数据注入前，用生产回测 realisticSimulation 作为输入，喂给研究绩效评估器（C-16.x）求值。结果仅用于观察指标口径，不构成正式策略结论。"
        right={
          <Button
            variant="default"
            size="sm"
            onClick={runPreview}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {loading ? "评估中…" : "运行回测评估"}
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            此区块属「技术预览」：数据源为生产回测（含退出策略局限），且
            RESEARCH_READY 尚未认证——指标口径可参考，但不得据此下正式策略结论。
          </div>
          {previewError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {previewError}
            </div>
          )}
          {!metrics && !loading && !previewError && (
            <p className="text-xs text-muted-foreground">
              尚未运行。点击右上角「运行回测评估」以生产回测结果计算真实绩效指标。
            </p>
          )}
        </div>
      </SectionCard>

      {/* 一级：指标卡 */}
      <SectionCard
        title="绩效指标"
        description={
          "总收益率 / CAGR / MaxDD / Sharpe / Sortino / Calmar / WinRate / PF / Expectancy / Turnover / 交易次数。数值来自 C-16.x 同源评估记录，页面不做指标计算。"
        }
        right={<StatusBadge status={metrics ? "SUCCESS" : "NOT_RUN"} label={metrics ? "EVALUATED" : "NO_DATA"} />}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {METRIC_CARDS.map((m, i) => (
            <MetricCard
              key={m.label}
              label={m.label}
              value={metrics ? metricValues[i].value : "—"}
              hint={m.hint}
            />
          ))}
        </div>
      </SectionCard>

      {/* 二级：收益 / 回撤曲线 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="收益曲线（Equity）"
          description="逐交易时点 equity（现金+市值）；数据源 = 生产回测 realisticSimulation.equityCurve。"
        >
          {equitySeries.length > 0 ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equitySeries} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="date" minTickGap={24} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} domain={["auto", "auto"]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="equity" name="权益" stroke="#6366f1" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-56 items-center justify-center rounded-md border border-dashed bg-muted/20">
              <EmptyState title="暂无曲线" description="运行「回测评估」后在此渲染 equityCurve。" className="border-0 py-8" />
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="回撤剖面（Drawdown）"
          description="running-peak 回撤段（峰值→谷底→恢复），与 MaxDD 同口径（C-16.1 analyzeDrawdown）。"
        >
          {drawdownSegments.length > 0 ? (
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-100 text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">峰</th>
                    <th className="px-2 py-1.5">谷</th>
                    <th className="px-2 py-1.5">恢复</th>
                    <th className="px-2 py-1.5 text-right">深度</th>
                    <th className="px-2 py-1.5 text-right">峰→谷(日)</th>
                  </tr>
                </thead>
                <tbody>
                  {drawdownSegments.map((seg, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">{seg.peakDate}</td>
                      <td className="px-2 py-1.5">{seg.troughDate}</td>
                      <td className="px-2 py-1.5">{seg.recoveryDate ?? "未恢复"}</td>
                      <td className="px-2 py-1.5 text-right text-emerald-700">{seg.depthPct.toFixed(2)}%</td>
                      <td className="px-2 py-1.5 text-right">{seg.tradingDaysToTrough}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex h-56 items-center justify-center rounded-md border border-dashed bg-muted/20">
              <EmptyState title="暂无回撤剖面" description="运行「回测评估」后在此渲染回撤段。" className="border-0 py-8" />
            </div>
          )}
        </SectionCard>
      </div>

      {/* 三级：交易明细 */}
      <SectionCard
        title="交易明细（Trades）"
        description="完整交易生命周期（建仓→清仓 / 期末仍持仓）。列头字段对应 engine/domain Trade 契约。"
      >
        {trades.length > 0 ? (
          <DataTable maxHeight={420}>
            <TableHeader>
              <TableRow>
                {TRADE_COLUMNS.map((c) => (
                  <TableHead key={c} className="text-xs">{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((t, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{t.securityId}</TableCell>
                  <TableCell className="text-xs">{t.entryTime || "—"}</TableCell>
                  <TableCell className="text-xs">{t.entryPrice}</TableCell>
                  <TableCell className="text-xs">{t.exitTime ?? "—"}</TableCell>
                  <TableCell className="text-xs">{t.exitPrice ?? "—"}</TableCell>
                  <TableCell className="text-xs">{t.quantity}</TableCell>
                  <TableCell className={`text-xs ${pnlTone(t.netPnl)}`}>{t.netPnl?.toFixed(2) ?? "—"}</TableCell>
                  <TableCell className={`text-xs ${pnlTone(t.returnPct)}`}>{t.returnPct === null || t.returnPct === undefined ? "—" : `${t.returnPct.toFixed(2)}%`}</TableCell>
                  <TableCell className="text-xs">{t.holdingPeriod ?? "—"}</TableCell>
                  <TableCell className="text-xs">{t.openAtEnd ? "是" : "否"}</TableCell>
                  <TableCell className="text-xs">{t.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </DataTable>
        ) : (
          <EmptyState title="暂无交易记录" description="运行「回测评估」后，此处渲染该次回测的 trades。" className="py-10" />
        )}
      </SectionCard>

      {/* 四级：月 / 年度一致性（C-16.3） */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="月度一致性"
          description="月度收益分布与一致率（C-16.3 MonthlyConsistencyMetrics）。"
        >
          {monthly ? (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md bg-muted/40 p-2">
                  <p className="text-muted-foreground">统计月数</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums">{monthly.monthCount}</p>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <p className="text-muted-foreground">盈利月占比</p>
                  <p className={`mt-0.5 text-base font-semibold tabular-nums ${pnlTone((monthly.positiveMonthRatio - 0.5))}`}>{fmtPct(monthly.positiveMonthRatio * 100, 1)}</p>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <p className="text-muted-foreground">最大连亏月数</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums">{monthly.maxConsecutiveLosingMonths}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">最佳月</p>
                  <p className="mt-0.5 font-mono">{monthly.bestMonth ? `${monthly.bestMonth.monthKey}（${monthly.bestMonth.returnPct.toFixed(2)}%）` : "—"}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">最差月</p>
                  <p className="mt-0.5 font-mono">{monthly.worstMonth ? `${monthly.worstMonth.monthKey}（${monthly.worstMonth.returnPct.toFixed(2)}%）` : "—"}</p>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState title="暂无月度一致性" description="运行「回测评估」后展示。" className="py-8" />
          )}
        </SectionCard>

        <SectionCard
          title="年度一致性"
          description="年度收益与逐年一致性（C-16.3 YearlyConsistencyMetrics）。"
        >
          {yearly ? (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md bg-muted/40 p-2">
                  <p className="text-muted-foreground">统计年数</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums">{yearly.yearCount}</p>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <p className="text-muted-foreground">盈利年占比</p>
                  <p className={`mt-0.5 text-base font-semibold tabular-nums ${pnlTone((yearly.positiveYearRatio - 0.5))}`}>{fmtPct(yearly.positiveYearRatio * 100, 1)}</p>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <p className="text-muted-foreground">最大连亏年数</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums">{yearly.maxConsecutiveLosingYears}</p>
                </div>
              </div>
              <div className="max-h-40 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <tbody>
                    {yearly.entries.map((e) => (
                      <tr key={e.yearKey} className="border-t border-slate-100 first:border-t-0">
                        <td className="px-2 py-1">{e.yearKey}</td>
                        <td className={`px-2 py-1 text-right tabular-nums ${pnlTone(e.returnPct)}`}>{e.returnPct.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState title="暂无年度一致性" description="运行「回测评估」后展示。" className="py-8" />
          )}
        </SectionCard>
      </div>

      {/* 五级：Regime 表现 */}
      <SectionCard
        title="Regime 表现"
        description="各市场状态分段的收益与交易表现——同源 marketRegime attribution / C-16.3 Regime 分段（C-22.1 前恒为 unassessed 占位）。"
      >
        <EmptyState
          title="暂无 Regime 表现"
          description="marketRegime 端点（FE-8 阶段）暴露后展示：Regime 分段 × 收益 / 回撤 / 交易数对照。"
          className="py-10"
        />
      </SectionCard>

      {/* 工程信息：联调清单（折叠） */}
      <TechnicalDetails title="技术详情：FE-5 联调清单（只读契约说明，非数据）">
        <ul className="space-y-1 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <li>数据源：research.metrics.evaluate（C-16.1/16.2/16.3 同源评估）——技术预览用生产回测 realisticSimulation 喂入</li>
          <li>指标字段：C-16.1 PerformanceMetrics（totalReturnPct / cagrPct / maxDrawdownPct / recoveryFactor / annualizedVolatilityPct）</li>
          <li>扩展指标：C-16.2 RiskAdjustedMetrics（Sharpe / Sortino / Calmar）；C-16.3 TradeQualityMetrics（WinRate / PF / Expectancy / Turnover / MonthlyConsistency / YearlyConsistency / Regime）</li>
          <li>曲线：equityCurve（EquityPoint）；Drawdown 剖面由 C-16.1 analyzeDrawdown 输出 drawdownSegments</li>
          <li>交易行：Trade（securityId / entryTime / entryPrice / exitTime / exitPrice / quantity / netPnl / returnPct / holdingPeriod / openAtEnd / reason）</li>
          <li>纪律：本页不计算指标、不生成曲线；端点暴露后数值即填、空态即让位。技术预览口径已顶部醒目标注（R7）</li>
        </ul>
      </TechnicalDetails>
    </div>
  );
}
