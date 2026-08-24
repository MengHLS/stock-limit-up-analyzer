import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, CircleDotDashed, Grid3X3, Sparkles, X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

type CandidateChartItem = {
  stockCode: string;
  stockName: string;
  sector: string;
  boards: number;
  score: number;
  turnover: string | null;
  circulationValue: string | null;
};

type ScoreBand = {
  label: string;
  minScore: number;
  maxScore: number | null;
  sampleSize: number;
  successCount: number;
  successRate: number | null;
};

export type CandidateChartFilters = {
  stockCode: string | null;
  sector: string | null;
  boardBucket: number | null;
  scoreBand: { minScore: number; maxScore: number | null; label: string } | null;
};

type CandidateInsightChartsProps = {
  candidates: CandidateChartItem[];
  scoreBands: ScoreBand[];
  observationDays: 1 | 2;
  filters: CandidateChartFilters;
  onFiltersChange: (filters: CandidateChartFilters) => void;
  onFocusCandidates: () => void;
};

const sectorColors = ["#f97316", "#0ea5e9", "#8b5cf6", "#10b981", "#ec4899", "#eab308", "#14b8a6", "#64748b"];

function parseTurnover(value: string | null) {
  if (!value) return 0;
  const parsed = Number.parseFloat(value.replace(/[亿元,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getBoardBucket(boards: number) {
  return Math.min(Math.max(boards, 1), 6);
}

function bubbleTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="max-w-[230px] rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="font-semibold text-slate-800">{point.stockName}</p>
      <p className="font-mono text-xs text-slate-500">{point.stockCode}</p>
      <p className="mt-1 text-xs text-slate-600">{point.sector} · {point.boards}板 · {point.score}分</p>
      <p className="mt-1 text-xs text-slate-500">成交额 {point.turnover ? `${point.turnover}亿` : "缺失"} · 流通市值 {point.circulationValue ? `${point.circulationValue}亿` : "缺失"}</p>
      <p className="mt-1 text-xs font-medium text-orange-700">点击筛选并定位该候选</p>
    </div>
  );
}

function barTooltip({ active, payload, observationDays }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="font-semibold text-slate-800">{point.label}</p>
      <p className="mt-1 text-sm text-emerald-700">样本外 T+{observationDays} 成功率：{point.successRate ?? "-"}{point.successRate === null ? "" : "%"}</p>
      <p className="mt-1 text-xs text-slate-500">{point.successCount}/{point.sampleSize} 个独立样本</p>
      <p className="mt-1 text-xs font-medium text-sky-700">点击按该评分区间筛选当前候选</p>
    </div>
  );
}

export function CandidateInsightCharts({
  candidates,
  scoreBands,
  observationDays,
  filters,
  onFiltersChange,
  onFocusCandidates,
}: CandidateInsightChartsProps) {
  const sectorOrder = Array.from(new Set(candidates.map((candidate) => candidate.sector)))
    .sort((left, right) => {
      const leftCount = candidates.filter((candidate) => candidate.sector === left).length;
      const rightCount = candidates.filter((candidate) => candidate.sector === right).length;
      return rightCount - leftCount || left.localeCompare(right);
    })
    .slice(0, 8);
  const sectorColorMap = new Map(sectorOrder.map((sector, index) => [sector, sectorColors[index % sectorColors.length]]));
  const bubbleData = candidates.map((candidate) => ({
    ...candidate,
    turnoverValue: Math.max(parseTurnover(candidate.turnover), 1),
    color: sectorColorMap.get(candidate.sector) ?? "#64748b",
  }));
  const boardBuckets = [1, 2, 3, 4, 5, 6];
  const activeFilterCount = [filters.stockCode, filters.sector, filters.boardBucket, filters.scoreBand].filter(Boolean).length;

  const updateFilter = (patch: Partial<CandidateChartFilters>) => {
    onFiltersChange({ ...filters, ...patch });
    onFocusCandidates();
  };

  const clearFilters = () => onFiltersChange({ stockCode: null, sector: null, boardBucket: null, scoreBand: null });

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-600">Interactive Screening</p>
          <h3 className="mt-1 text-xl font-bold text-slate-900">候选筛选图表</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">点击气泡、评分柱或热力单元格，可联动筛选下方候选明细。柱状图仅展示独立样本外区间的历史延续率。</p>
        </div>
        {activeFilterCount > 0 && (
          <Button variant="outline" size="sm" className="gap-2 border-sky-200 text-sky-700 hover:bg-sky-50" onClick={clearFilters}>
            <X className="h-4 w-4" />清除图表筛选（{activeFilterCount}）
          </Button>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-orange-100 bg-white/90 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><CircleDotDashed className="h-4 w-4 text-orange-600" />候选气泡散点图</CardTitle>
            <CardDescription>横轴为综合评分，纵轴为连板高度，气泡大小为成交额，颜色代表题材。</CardDescription>
          </CardHeader>
          <CardContent>
            {bubbleData.length === 0 ? <p className="py-20 text-center text-sm text-slate-500">当前没有可展示的候选。</p> : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 12, right: 18, bottom: 8, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" dataKey="score" name="综合评分" domain={[0, 100]} tick={{ fontSize: 12, fill: "#64748b" }} label={{ value: "综合评分", position: "insideBottom", offset: -2, fill: "#64748b", fontSize: 12 }} />
                    <YAxis type="number" dataKey="boards" name="连板高度" allowDecimals={false} domain={[0, "dataMax + 1"]} tick={{ fontSize: 12, fill: "#64748b" }} label={{ value: "连板", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 12 }} />
                    <ZAxis type="number" dataKey="turnoverValue" range={[90, 560]} name="成交额" />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={bubbleTooltip} />
                    <Scatter data={bubbleData} onClick={(entry: any) => updateFilter({ stockCode: entry?.payload?.stockCode ?? null })}>
                      {bubbleData.map((entry) => <Cell key={entry.stockCode} fill={entry.color} fillOpacity={filters.stockCode && filters.stockCode !== entry.stockCode ? 0.28 : 0.88} stroke={filters.stockCode === entry.stockCode ? "#0f172a" : "#ffffff"} strokeWidth={filters.stockCode === entry.stockCode ? 3 : 1.5} />)}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">{sectorOrder.map((sector) => <Badge key={sector} variant="outline" className="cursor-pointer border-slate-200 bg-white text-slate-600 hover:bg-slate-50" onClick={() => updateFilter({ sector: filters.sector === sector ? null : sector })}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: sectorColorMap.get(sector) }} />{sector}</Badge>)}</div>
          </CardContent>
        </Card>

        <Card className="border-emerald-100 bg-white/90 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-emerald-600" />评分区间样本外成功率</CardTitle>
            <CardDescription>评分阈值在早期数据校准后，使用较晚30%交易日的独立样本计算 T+{observationDays} 涨停延续率。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={scoreBands} margin={{ top: 12, right: 10, bottom: 10, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} interval={0} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "#64748b" }} tickFormatter={(value) => `${value}%`} />
                  <Tooltip content={(props) => barTooltip({ ...props, observationDays })} />
                  <Bar dataKey="successRate" name="样本外成功率" radius={[6, 6, 0, 0]} onClick={(entry: any) => updateFilter({ scoreBand: entry?.minScore === undefined ? null : { minScore: entry.minScore, maxScore: entry.maxScore, label: entry.label } })}>
                    {scoreBands.map((band) => <Cell key={band.label} fill={filters.scoreBand?.label === band.label ? "#0284c7" : band.sampleSize === 0 ? "#cbd5e1" : "#10b981"} fillOpacity={band.successRate === null ? 0.45 : 0.9} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{scoreBands.map((band) => <button key={band.label} type="button" onClick={() => updateFilter({ scoreBand: { minScore: band.minScore, maxScore: band.maxScore, label: band.label } })} className={`rounded-lg border p-2 text-left transition-colors ${filters.scoreBand?.label === band.label ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-slate-50 hover:bg-slate-100"}`}><p className="text-xs font-medium text-slate-700">{band.label}</p><p className="mt-1 text-xs text-slate-500">样本外 {band.successCount}/{band.sampleSize}</p></button>)}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-violet-100 bg-white/90 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Grid3X3 className="h-4 w-4 text-violet-600" />题材—连板热力图</CardTitle>
          <CardDescription>按当前候选聚合。行是题材，列是连板高度；颜色越深代表该题材在对应高度的候选越多。</CardDescription>
        </CardHeader>
        <CardContent>
          {sectorOrder.length === 0 ? <p className="py-12 text-center text-sm text-slate-500">当前没有可聚合的候选题材。</p> : (
            <div className="overflow-x-auto">
              <div className="min-w-[620px]">
                <div className="grid grid-cols-[minmax(120px,1.35fr)_repeat(6,minmax(64px,1fr))] gap-1.5 text-xs">
                  <div className="px-2 py-2 font-medium text-slate-500">题材 / 连板</div>
                  {boardBuckets.map((board) => <div key={board} className="px-2 py-2 text-center font-medium text-slate-500">{board === 6 ? "6板+" : `${board}板`}</div>)}
                  {sectorOrder.map((sector) => {
                    const sectorTotal = candidates.filter((candidate) => candidate.sector === sector).length;
                    return [
                      <button key={`${sector}-label`} type="button" className={`rounded-md px-2 py-2 text-left font-medium transition-colors ${filters.sector === sector ? "bg-violet-100 text-violet-800" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`} onClick={() => updateFilter({ sector: filters.sector === sector ? null : sector })}>{sector}<span className="ml-1 text-slate-400">{sectorTotal}</span></button>,
                      ...boardBuckets.map((board) => {
                        const count = candidates.filter((candidate) => candidate.sector === sector && getBoardBucket(candidate.boards) === board).length;
                        const isSelected = filters.sector === sector && filters.boardBucket === board;
                        const intensity = count === 0 ? "bg-slate-50 text-slate-300" : count === 1 ? "bg-violet-100 text-violet-700" : count === 2 ? "bg-violet-300 text-violet-900" : "bg-violet-600 text-white";
                        return <button key={`${sector}-${board}`} type="button" onClick={() => updateFilter({ sector, boardBucket: board })} className={`min-h-10 rounded-md border border-transparent text-center font-semibold transition-transform hover:scale-[1.03] ${isSelected ? "ring-2 ring-violet-500 ring-offset-1" : ""} ${intensity}`}>{count || "–"}</button>;
                      }),
                    ];
                  })}
                </div>
              </div>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Sparkles className="h-3.5 w-3.5 text-violet-500" />点击题材、连板单元格即可筛选候选明细；6板+包含6板及以上。</div>
        </CardContent>
      </Card>
    </section>
  );
}
