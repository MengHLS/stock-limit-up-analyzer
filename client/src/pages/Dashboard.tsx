import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { normalizeLimitUpTime } from "@shared/limitUpTime";
import { Link } from "wouter";
import { Loader2, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * 首页 —— 行情复盘总览（HOMEPAGE-001 / 编号 `9be`，接管路由 `/`）
 *
 * 版式按用户 5 条要求落地（2026-09-18 修订版）：
 *   1. **不展示数据新鲜度条**：最近复盘日 / 行情最新日 / 待补交易日一律不出现在本页
 *      （同步状态归 `/stock-sync`「行情同步」页，本页不做任何同步状态展示）；
 *   2. 新增大盘日线走势图（`index_daily` → `market.getIndexDailySeries`）；
 *   3. 大盘成交量（两市成交额）、两融余额、涨停数**整合到同一张图**统一展示（三轴各自量纲）；
 *   4. 题材热力日历使用**独立表格**单独展示；
 *   5. 连板梯队**改为大表格**，自上而下依次列出连板股与断板股（数据源 `limitUp.getBoardRoster`）。
 *
 * 数据口径约束：
 *   · 板数 = 「连续记录交易日涨停的天数」；连板股取当日口径、断板股取**上一记录交易日**口径。
 *   · 指数与行情缺失字段一律断点，**不插值、不推算**。
 *   · 连板名录走有界窗口（60 自然日，实测约 0.5~2s）；不得改用全表实现
 *     （`getConnectionBoardStats` 全表 99,918 行、实测 68.3s）。
 */

/** 大盘日线走势图绑定的指数。 */
const BENCHMARK_INDEX_CODE = "000001.SH";
const BENCHMARK_INDEX_NAME = "上证指数";
/** 指数走势窗口（交易日）。 */
const INDEX_TREND_DAYS = 60;
/** 三合一图窗口（自然日）。 */
const MARKET_CHART_DAYS = 30;
/** 热力日历最多展示的题材行数（按窗口内涨停家数取前 N）。 */
const HEATMAP_SECTOR_LIMIT = 20;

const CHART_COLORS = {
  limitUpCount: "#ef4444",
  turnover: "#3b82f6",
  marginBalance: "#f59e0b",
  close: "#3b82f6",
  ma5: "#f59e0b",
  ma20: "#8b5cf6",
};

/** 快捷入口（复盘闭环的实际去路）。 */
const SHORTCUTS = [
  { label: "涨停复盘明细", description: "逐日涨停记录、题材与个股筛选", href: "/limit-up" },
  { label: "大盘分析", description: "累计统计与大盘数据同步", href: "/market" },
  { label: "情绪分析", description: "情绪周期与龙头候选", href: "/sentiment-analysis" },
  { label: "上传图片", description: "录入当日涨停复盘图", href: "/upload" },
];

/** 由收盘序列计算 N 日均线；不足 N 日或窗口内含空值处返回 null（不插值）。 */
function movingAverage(values: Array<number | null>, window: number): Array<number | null> {
  return values.map((_, index) => {
    if (index + 1 < window) return null;
    let sum = 0;
    for (let cursor = index + 1 - window; cursor <= index; cursor += 1) {
      const value = values[cursor];
      if (value === null || !Number.isFinite(value)) return null;
      sum += value;
    }
    return sum / window;
  });
}

function formatPoint(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

/** 大盘日线走势图的悬浮明细（含涨跌幅，涨红跌绿）。 */
function IndexTrendTooltip(props: any) {
  const row = props?.payload?.[0]?.payload;
  if (!props?.active || !row) return null;
  const pct = row["涨跌幅"] as number | null;
  return (
    <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-sm">
      <div className="mb-1 font-medium">
        {row.fullDate} · {BENCHMARK_INDEX_NAME}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-muted-foreground">开盘</span>
        <span className="text-right">{formatPoint(row["开盘"])}</span>
        <span className="text-muted-foreground">最高</span>
        <span className="text-right">{formatPoint(row["最高"])}</span>
        <span className="text-muted-foreground">最低</span>
        <span className="text-right">{formatPoint(row["最低"])}</span>
        <span className="text-muted-foreground">收盘</span>
        <span className="text-right font-medium">{formatPoint(row["收盘"])}</span>
        <span className="text-muted-foreground">涨跌幅</span>
        <span
          className={
            pct === null || pct === undefined
              ? "text-right"
              : pct >= 0
                ? "text-right text-red-600"
                : "text-right text-emerald-600"
          }
        >
          {pct === null || pct === undefined ? "—" : `${pct > 0 ? "+" : ""}${pct}%`}
        </span>
      </div>
    </div>
  );
}

/** 情绪评级（沿用既有阈值）。 */
function getEmotionLevel(score: number) {
  if (score >= 86) return { label: "亢奋", color: "text-red-600", bg: "bg-red-100" };
  if (score >= 71) return { label: "活跃", color: "text-orange-600", bg: "bg-orange-100" };
  if (score >= 51) return { label: "正常", color: "text-blue-600", bg: "bg-blue-100" };
  if (score >= 31) return { label: "低迷", color: "text-gray-600", bg: "bg-gray-100" };
  return { label: "冰点", color: "text-gray-400", bg: "bg-gray-50" };
}

/** 板数标签配色（高度越高越警示）。 */
function boardBadgeClass(boards: number) {
  if (boards >= 7) return "bg-red-100 text-red-700";
  if (boards >= 4) return "bg-orange-100 text-orange-700";
  if (boards >= 2) return "bg-blue-100 text-blue-700";
  return "bg-gray-100 text-gray-700";
}

export default function DashboardPage() {
  // ① 大盘日线走势图
  const { data: indexSeries, isLoading: indexLoading } = trpc.market.getIndexDailySeries.useQuery({
    indexCode: BENCHMARK_INDEX_CODE,
    days: INDEX_TREND_DAYS,
  });
  // ② 成交额 / 两融余额 / 涨停数 三合一
  const { data: limitUpWithMarketData, isLoading: marketLoading } = trpc.market.getLimitUpWithMarketData.useQuery(
    { days: MARKET_CHART_DAYS },
    { refetchInterval: 300_000 },
  );
  // ③ 题材热力日历
  const { data: sectorDistribution, isLoading: sectorLoading } = trpc.limitUp.getSectorDistribution.useQuery();

  const isLoading = indexLoading || marketLoading || sectorLoading;

  // 大盘日线走势图数据
  const indexRows = indexSeries ?? [];
  const closes = indexRows.map((row) => row.close);
  const ma5 = movingAverage(closes, 5);
  const ma20 = movingAverage(closes, 20);
  const indexChartData = indexRows.map((row, index) => {
    const previousClose = index > 0 ? closes[index - 1] : null;
    const pct =
      row.close !== null && previousClose !== null && previousClose !== 0
        ? Number((((row.close - previousClose) / previousClose) * 100).toFixed(2))
        : null;
    return {
      date: row.tradeDate.substring(5),
      fullDate: row.tradeDate,
      开盘: row.open,
      最高: row.high,
      最低: row.low,
      收盘: row.close,
      涨跌幅: pct,
      MA5: ma5[index],
      MA20: ma20[index],
    };
  });

  // 三合一图数据
  const marketChartData = (limitUpWithMarketData ?? []).map((item) => ({
    date: item.date.substring(5),
    涨停数: item.limitUpCount,
    成交额: item.turnover ? Number.parseFloat(item.turnover) : null,
    两融余额: item.marginBalance ? Number.parseFloat(item.marginBalance) : null,
  }));

  // 热力日历数据：题材按窗口内涨停家数降序
  const heatmapDays = sectorDistribution ?? [];
  const heatmapSectors = (() => {
    const totals = new Map<string, number>();
    for (const day of heatmapDays) {
      for (const sector of day.sectors) {
        totals.set(sector.sector, (totals.get(sector.sector) || 0) + sector.count);
      }
    }
    return Array.from(totals.entries())
      .filter(([sector]) => sector !== "其他")
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, HEATMAP_SECTOR_LIMIT);
  })();
  const heatmapMaxValue = Math.max(1, ...heatmapDays.flatMap((day) => day.sectors.map((sector) => sector.count)));

  return (
    <div className="container py-6 max-w-7xl">
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="h-5 w-5" />
        <h1 className="text-lg font-semibold">行情总览</h1>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ① 大盘日线走势图 */}
          <Card>
            <CardHeader>
              <CardTitle>大盘日线走势图</CardTitle>
              <CardDescription>
                {BENCHMARK_INDEX_NAME}（{BENCHMARK_INDEX_CODE}）最近 {INDEX_TREND_DAYS} 个交易日的收盘点位与 5 / 20
                日均线；数据源 = 指数日线表（index_daily），点位缺失处断点、不插值。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {indexChartData.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">暂无指数日线数据</div>
              ) : (
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={indexChartData} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={24} />
                    <YAxis
                      domain={["dataMin - 40", "dataMax + 40"]}
                      tick={{ fontSize: 12 }}
                      label={{ value: "点位", angle: -90, position: "insideLeft" }}
                    />
                    <Tooltip content={<IndexTrendTooltip />} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="收盘"
                      stroke={CHART_COLORS.close}
                      strokeWidth={2.5}
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="MA5"
                      stroke={CHART_COLORS.ma5}
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="MA20"
                      stroke={CHART_COLORS.ma20}
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* ② 大盘成交量 · 两融数据 · 涨停数 —— 同一张图统一展示 */}
          <Card>
            <CardHeader>
              <CardTitle>大盘成交量 · 两融数据 · 涨停数</CardTitle>
              <CardDescription>
                三项整合在同一张图内统一展示：柱 = 涨停家数（左轴），线 = 大盘成交额与两融余额（右轴，各自独立量纲，避免被
                成交额压低成直线）。交易所两融汇总次日早晨才发布，最新一日的成交额与两融暂缺（断点，不插值）。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {marketChartData.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">暂无大盘数据</div>
              ) : (
                <ResponsiveContainer width="100%" height={420}>
                  <ComposedChart data={marketChartData} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={16} />
                    <YAxis
                      yAxisId="count"
                      tick={{ fontSize: 12 }}
                      label={{ value: "涨停家数", angle: -90, position: "insideLeft" }}
                    />
                    <YAxis
                      yAxisId="turnover"
                      orientation="right"
                      domain={["dataMin - 1500", "dataMax + 1500"]}
                      tick={{ fontSize: 12 }}
                      label={{ value: "成交额(亿)", angle: 90, position: "insideRight" }}
                    />
                    <YAxis
                      yAxisId="margin"
                      orientation="right"
                      domain={["dataMin - 150", "dataMax + 150"]}
                      tick={{ fontSize: 12 }}
                      label={{ value: "两融余额(亿)", angle: 90, position: "insideRight" }}
                    />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="count" dataKey="涨停数" fill={CHART_COLORS.limitUpCount} radius={[2, 2, 0, 0]} />
                    <Line
                      yAxisId="turnover"
                      type="monotone"
                      dataKey="成交额"
                      stroke={CHART_COLORS.turnover}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      yAxisId="margin"
                      type="monotone"
                      dataKey="两融余额"
                      stroke={CHART_COLORS.marginBalance}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* ③ 题材热力日历 —— 独立表格 */}
          <Card>
            <CardHeader>
              <CardTitle>题材热力日历</CardTitle>
              <CardDescription>
                独立表格展示：行 = 题材（按窗口内涨停家数取前 {HEATMAP_SECTOR_LIMIT}），列 = 记录交易日（最近{" "}
                {heatmapDays.length} 个，新 → 旧），单元格颜色深浅 = 当日该题材涨停数量；“合计”列 = 该题材窗口内涨停总数。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border border-border p-2 bg-muted text-left font-medium min-w-[80px] sticky left-0 z-10">
                        题材
                      </th>
                      {heatmapDays.map((day) => (
                        <th
                          key={day.date}
                          className="border border-border p-2 bg-muted text-center font-medium min-w-[50px] text-xs"
                        >
                          {day.date.split("-").slice(1).join("-")}
                        </th>
                      ))}
                      <th className="border border-border p-2 bg-muted text-center font-medium min-w-[52px] text-xs">
                        合计
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapSectors.map(([sector, total]) => (
                      <tr key={sector}>
                        <td className="border border-border p-2 font-medium text-left bg-muted sticky left-0 z-10 min-w-[80px] text-xs">
                          {sector}
                        </td>
                        {heatmapDays.map((day) => {
                          const count = day.sectors.find((item) => item.sector === sector)?.count || 0;
                          const intensity = count === 0 ? 0 : Math.min(100, (count / heatmapMaxValue) * 100);
                          const opacity = intensity === 0 ? 0 : 0.2 + (intensity / 100) * 0.8;
                          return (
                            <td
                              key={`${sector}-${day.date}`}
                              className="border border-border p-2 text-center text-xs"
                              style={{
                                backgroundColor: count === 0 ? "transparent" : `rgba(59, 130, 246, ${opacity})`,
                                color: intensity > 50 ? "white" : "inherit",
                              }}
                            >
                              {count > 0 ? count : "-"}
                            </td>
                          );
                        })}
                        <td className="border border-border p-2 text-center text-xs font-medium">{total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ④ 连板梯队 —— 大表格：连板股 → 断板股 */}
          <BoardLadderSection />

          {/* ⑤ 快捷入口 + 免责声明 */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {SHORTCUTS.map((shortcut) => (
              <Link key={shortcut.href} href={shortcut.href}>
                <Card className="cursor-pointer transition-colors hover:bg-muted/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">{shortcut.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{shortcut.description}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
            免责声明：本页仅用于历史复盘与研究辅助，所有统计基于已记录的涨停记录与指数日线，不构成投资建议；板数口径为「连续
            记录交易日涨停的天数」，与行情软件口径可能存在差异；交易所两融汇总次日早晨发布，最新一日可能缺失。
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 连板梯队区块：日期选择 + 当日指标 + **一张大表格**（先连板股、后断板股）。
 * 数据源 `limitUp.getBoardRoster`（有界窗口，实测 0.5~2s）；不得改用全表实现。
 */
function BoardLadderSection() {
  const { data: availableDates } = trpc.limitUp.getDates.useQuery();
  const [selectedDate, setSelectedDate] = useState("");

  useEffect(() => {
    if (availableDates && availableDates.length > 0 && !selectedDate) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  const { data: roster, isLoading } = trpc.limitUp.getBoardRoster.useQuery(
    { date: selectedDate },
    { enabled: !!selectedDate, refetchInterval: 300_000 },
  );

  const metrics = roster?.metrics;
  const emotionLevel = getEmotionLevel(metrics?.emotionScore ?? 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>连板梯队</CardTitle>
        <CardDescription>
          大表格自上而下依次列出：连板股（当日涨停且 2 板及以上）→ 断板股（上一记录交易日涨停、当日未再涨停）。
          板数口径 = 「连续记录交易日涨停的天数」；断板股行内板数与涨停时间均为上一记录交易日口径，并区分「连板中断」（≥2
          板）与「首板未续」。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-sm font-medium">选择日期：</label>
          <select
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="px-3 py-2 border border-border rounded-md text-sm"
          >
            {availableDates?.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
          {roster ? (
            <span className="text-xs text-muted-foreground">
              板数窗口：{roster.window.startDate} ~ {roster.date}（{roster.window.tradingDateCount} 个记录交易日）
            </span>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !roster ? (
          <div className="py-8 text-center text-sm text-muted-foreground">暂无数据</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">总涨停数</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{roster.metrics.totalLimitUp}</div>
                  <p className="text-xs text-muted-foreground">
                    首板 {roster.metrics.firstBoards} 只 · 连板 {roster.metrics.connectionBoards} 只
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">断板数</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{roster.metrics.brokenCount}</div>
                  <p className="text-xs text-muted-foreground">
                    其中连板中断 {roster.metrics.brokenConnectionCount} 只（上一记录日涨停{" "}
                    {roster.metrics.prevTotalLimitUp} 只）
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">最高板</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{roster.metrics.maxBoards}板</div>
                  <p className="text-xs text-muted-foreground">当日最高连板数</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">情绪评分</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <div className="text-2xl font-bold">{roster.metrics.emotionScore}</div>
                    <Badge className={`${emotionLevel.bg} ${emotionLevel.color}`}>{emotionLevel.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">市场情绪强度</p>
                </CardContent>
              </Card>
            </div>

            {roster.window.exhausted ? (
              <p className="text-xs text-amber-600">
                注意：有股票的连板数顶满 {roster.window.lookbackDays} 个自然日窗口，最高板可能被低估，请扩大窗口后复核。
              </p>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">板数</th>
                    <th className="text-left p-2">股票代码</th>
                    <th className="text-left p-2">股票名称</th>
                    <th className="text-left p-2">题材</th>
                    <th className="text-left p-2">涨停时间</th>
                    <th className="text-left p-2">状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-muted/50">
                    <td colSpan={6} className="p-2 text-xs font-medium">
                      连板股 · 当日涨停且 2 板及以上（{roster.connectionStocks.length} 只，板数降序）
                    </td>
                  </tr>
                  {roster.connectionStocks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-3 text-xs text-muted-foreground">
                        当日无 2 板及以上的连板股。
                      </td>
                    </tr>
                  ) : (
                    roster.connectionStocks.map((stock) => (
                      <tr key={`connection-${stock.stockCode}`} className="border-b hover:bg-muted/50">
                        <td className="p-2">
                          <Badge className={boardBadgeClass(stock.boards)}>{stock.boards}板</Badge>
                        </td>
                        <td className="p-2 font-mono text-xs">{stock.stockCode}</td>
                        <td className="p-2 font-medium">{stock.stockName}</td>
                        <td className="p-2">
                          <Badge variant="outline">{stock.sector}</Badge>
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {normalizeLimitUpTime(stock.limitUpTime) ?? "-"}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">当日连板</td>
                      </tr>
                    ))
                  )}

                  <tr className="bg-muted/50">
                    <td colSpan={6} className="p-2 text-xs font-medium">
                      断板股 · 上一记录交易日 {roster.prevDate ?? "—"} 涨停、当日未再涨停（
                      {roster.brokenStocks.length} 只，其中连板中断 {roster.metrics.brokenConnectionCount} 只；板数与涨停时间
                      均为上一记录交易日口径）
                    </td>
                  </tr>
                  {roster.brokenStocks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-3 text-xs text-muted-foreground">
                        无断板股：上一记录交易日的涨停股当日全部继续涨停。
                      </td>
                    </tr>
                  ) : (
                    roster.brokenStocks.map((stock) => (
                      <tr key={`broken-${stock.stockCode}`} className="border-b hover:bg-muted/50">
                        <td className="p-2">
                          <Badge className={boardBadgeClass(stock.boards)}>昨日 {stock.boards}板</Badge>
                        </td>
                        <td className="p-2 font-mono text-xs">{stock.stockCode}</td>
                        <td className="p-2 font-medium">{stock.stockName}</td>
                        <td className="p-2">
                          <Badge variant="outline">{stock.sector}</Badge>
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {normalizeLimitUpTime(stock.limitUpTime) ?? "-"}
                        </td>
                        <td className="p-2">
                          {stock.brokenKind === "connection" ? (
                            <Badge className="bg-orange-100 text-orange-700">连板中断</Badge>
                          ) : (
                            <Badge className="bg-gray-100 text-gray-700">首板未续</Badge>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
