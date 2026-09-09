/**
 * RunResultPlaceholder — 回测结果结构预留（任务 §5）。
 *
 * 核心指标（总收益率/年化/最大回撤/胜率/Profit Factor/Sharpe/交易次数）+ 收益曲线 /
 * 回撤曲线 / 交易记录 / 每日持仓 / 风险事件 / 运行日志。
 *
 * 诚实纪律：后端尚无策略级 Run/Backtest Result 端点，**绝不由前端伪造**任何指标，
 * 全部展示 Empty State / 占位「—」。
 */

import {
  EmptyState,
  MetricCard,
  SectionCard,
  StatusBadge,
} from "@/components/common";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartLine,
  CircleDot,
  FileText,
  ListChecks,
  Package,
  ShieldAlert,
} from "lucide-react";
import type { RunResultViewModel } from "@/adapters/runResultAdapter";

const METRICS: Array<{
  key: keyof RunResultViewModel["metrics"];
  label: string;
}> = [
  { key: "totalReturnPct", label: "总收益率" },
  { key: "annualizedReturnPct", label: "年化收益率" },
  { key: "maxDrawdownPct", label: "最大回撤" },
  { key: "winRatePct", label: "胜率" },
  { key: "profitFactor", label: "Profit Factor" },
  { key: "sharpe", label: "Sharpe" },
  { key: "tradeCount", label: "交易次数" },
];

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(2)}%`;
}

function fmtNum(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

function fmtInt(v: number | null): string {
  return v === null ? "—" : v.toLocaleString();
}

function metricValue(
  key: keyof RunResultViewModel["metrics"],
  v: number | null
): string {
  switch (key) {
    case "totalReturnPct":
    case "annualizedReturnPct":
    case "maxDrawdownPct":
    case "winRatePct":
      return fmtPct(v);
    case "profitFactor":
    case "sharpe":
      return fmtNum(v);
    case "tradeCount":
      return fmtInt(v);
    default:
      return "—";
  }
}

export function RunResultPlaceholder({
  result,
}: {
  result: RunResultViewModel;
}) {
  const detailTabs = [
    { value: "equity", label: "收益曲线", icon: ChartLine },
    { value: "drawdown", label: "回撤曲线", icon: ShieldAlert },
    { value: "trades", label: "交易记录", icon: ListChecks },
    { value: "holdings", label: "每日持仓", icon: Package },
    { value: "risk", label: "风险事件", icon: ShieldAlert },
    { value: "logs", label: "运行日志", icon: CircleDot },
  ];

  return (
    <SectionCard
      title="运行结果"
      right={<StatusBadge status={result.status} />}
      description={
        result.hasData
          ? "运行结果（真实数据）"
          : "后端运行端点尚未就绪，以下为结构预留（Empty State）"
      }
    >
      {/* 指标卡（无数据时全部「—」，不伪造） */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {METRICS.map(m => (
          <MetricCard
            key={m.key}
            label={m.label}
            value={metricValue(m.key, result.metrics[m.key])}
          />
        ))}
      </div>

      {/* 运行元信息 */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs text-muted-foreground">
        {result.runId && <span>Run ID: {result.runId}</span>}
        {result.strategyVersion && (
          <span>Strategy: {result.strategyVersion}</span>
        )}
        {result.datasetVersion && <span>Dataset: {result.datasetVersion}</span>}
        {result.createdAt && <span>Created: {result.createdAt}</span>}
        {result.durationMs !== null && (
          <span>Duration: {result.durationMs} ms</span>
        )}
      </div>

      <Tabs defaultValue="equity" className="mt-4">
        <TabsList>
          {detailTabs.map(t => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="flex items-center gap-1.5"
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {detailTabs.map(t => (
          <TabsContent key={t.value} value={t.value} className="pt-4">
            <EmptyState
              icon={t.icon}
              title={`暂无${t.label}数据`}
              description="后端回测结果端点尚未就绪。此处为结构预留，接入真实结果后展示曲线 / 交易记录 / 持仓 / 风险事件 / 日志。"
            />
          </TabsContent>
        ))}
      </Tabs>
    </SectionCard>
  );
}
