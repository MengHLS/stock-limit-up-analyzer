import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { ladderHeight } from "@shared/ladderHeight";
import { normalizeLimitUpTime } from "@shared/limitUpTime";
import { buildSectorHeatLookup, sortBySectorHeat } from "@shared/sectorHeatOrder";
import { Link } from "wouter";
import { TrendingUp } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
 * 首页 —— 行情复盘总览（HOMEPAGE-001 / 编号 `9be`，接管路由 `/`）。
 *
 * 2026-09-18 第二轮修订（事项 `rKRNzQ`「大盘日线走势图」5 条要求）：
 *   1. **四指数并列**：`index_daily` 里实际存在四条指数（上证指数 / 深证成指 / 沪深300 / 中证500，
 *      各 1873 行、覆盖 2019-01-02 ~ 最新），四条**并排**展示；单卡区块压小（图表高 130），
 *      窗口从 60 个交易日放宽到 **120** 个交易日 ⇒ 「更小的区块 + 更多的日期」。
 *   2. **三合图拆成上下两联**：原实现右轴叠了「成交额」「两融余额」两个坐标系（用户反馈右侧两个坐标打架，
 *      而合并到一根轴上两融会被成交额压低成直线）。现改为**共享分类轴的两联图**：
 *      上联 = 涨停家数（左轴，柱） + 成交额（右轴，线，**右轴只此一条**）；下联 = 两融余额（独占左轴）。
 *      不为对齐而做任何数据变换，两条曲线各用各的量纲，两融的日常波动因此可见。
 *   3. **连板梯队与题材热力日历互换位置**：连板梯队提前到第二块（紧随三合图），热力日历后置。
 *   4. **连板梯队改为「高度 × 网格」版式**（对齐用户附件 `QQ20260918-230855.png`）：
 *      左列 = 高度（`N 板` / `首板(N)`），右侧按高度分行、每股一格的网格；
 *      格内 = 首次封板时间（一字板则换成「一字板」标） + 名称 + 题材；**断板股加删除线并改显当日涨跌幅**。
 *      **左列「高度」口径（2026-09-18 与附件图逐格对拍后修正）=「若该股本日涨停会达到的连板数」**：
 *      本日仍涨停 ⇒ 本日连板数；连板中断 ⇒ 上一记录交易日连板数 + 1（五只断板股全部上行一位：
 *      澳弘电子 5→6、中晶科技 3→4、共达电声 / 中岩大地 / 万向德农 2→3；当日涨停股不变）。唯一实现 = `@shared/ladderHeight`。
 *   5. **首屏不再被单一 spinner 堵住**：去掉「全部 query 就绪才渲染」的全页 loading，
 *      改为每张卡片各自骨架屏 + 各自就绪即渲染；四个指数查询由 `httpBatchLink` 合并为一次 HTTP 批量请求并并行取数；
 *      只读查询统一挂 `staleTime`（回退首页不再重复打库）。
 *
 * 2026-09-19 第三轮修订（事项 `rKRNzQ`：一条口径裁定 + 三条版式收敛）：
 *   6. **「首板未续」也 +1**：口径统一为「若该股本日涨停会达到的连板数」⇒ 上一记录交易日 1 板、
 *      当日未涨停的也落到 **2 板行**（按断板格呈现）。上一版「不 +1」的推断按用户裁定作废，
 *      见 `@shared/ladderHeight` 的注释。
 *   7. **梯队折叠按「组内网格行」**：**每个高度组各自判断** —— 该组网格行数 > 3 时默认只显示前 3 行，
 *      由该组自己的按钮展开/收起（`LADDER_GROUP_VISIBLE_ROWS`；列数实测自计算样式，各断点下都恰好 3 行）。
 *      ⚠️ 上一版按「整个梯队的高度行数」折叠属**口径理解错误**，已按用户 2026-09-19 澄清作废。
 *   8. **梯队行内改按题材当日热力排序**：同一高度行内，按该股题材在**所选日期**的涨停家数降序，
 *      **与是否断板无关**（不再把断板格统一排前/排尾）；同热度内按封板时间升序。
 *      唯一实现 = `@shared/sectorHeatOrder`（与热力日历共用同一比较器，禁止各写一套）。
 *   9. **题材热力日历改按「当日」排序**：行顺序由「窗口内合计」改为「**当日**（最新一列）涨停家数」降序，
 *      合计只作同热度时的次键；取前 N 也随之按当日序。
 *
 * 数据口径约束：
 *   · 板数 = 「连续记录交易日涨停的天数」；连板股取当日口径、断板股取**上一记录交易日**口径。
 *   · 梯队左列「高度」= **若该股本日涨停会达到的连板数**（断板 ⇒ 上一记录日板数 + 1，**含首板未续**，
 *     见 `@shared/ladderHeight`）。
 *   · 一字板 = 当日「开盘 = 最高 = 最低」（`stock_daily_prices` 实测判据）；涨跌幅 = (收 − 前收) / 前收。
 *     两者行情缺失一律 null，前端按「—」呈现 —— **不插值、不推算**。
 *   · 指数与行情缺失字段一律断点，**不插值、不推算**。
 *   · 连板名录走有界窗口（60 自然日，实测约 0.4s）；不得改用全表实现
 *     （`getConnectionBoardStats` 全表 99,918 行、实测 68.3s）。
 */

/** 并列展示的四条指数（= `index_daily` 全部 indexCode，实查见 docs/evidence）。 */
const BENCHMARK_INDICES = [
  { code: "000001.SH", name: "上证指数", color: "#ef4444" },
  { code: "399001.SZ", name: "深证成指", color: "#3b82f6" },
  { code: "000300.SH", name: "沪深300", color: "#f59e0b" },
  { code: "000905.SH", name: "中证500", color: "#8b5cf6" },
] as const;

/** 指数走势窗口（交易日）—— 放宽到 120 以在小区块里展示更多日期。 */
const INDEX_TREND_DAYS = 120;
/** 三合图窗口（自然日）。 */
const MARKET_CHART_DAYS = 30;
/** 热力日历最多展示的题材行数（按**当日**涨停家数排序后取前 N）。 */
const HEATMAP_SECTOR_LIMIT = 20;
/**
 * 梯队**单个高度组内部**默认可见的网格行数：该组的网格行数超过它，才出现折叠按钮，
 * 且默认只渲染前 `LADDER_GROUP_VISIBLE_ROWS` 行（= 该值 × 当前实测列数 格）。
 *
 * ⚠️ 判据是**组内网格行数**，不是整个梯队的高度行数 —— 用户 2026-09-19 澄清：
 *    「超过三行折叠是每个高度内超过三行，折叠那个高度到只有三行」。
 */
const LADDER_GROUP_VISIBLE_ROWS = 3;
/** 网格列数的初始猜测值；`useLayoutEffect` 会在首帧绘制前用实测值覆盖，不产生可见闪烁。 */
const LADDER_GRID_FALLBACK_COLS = 6;
/** 只读行情类查询的 staleTime：回退首页/切页返回时直接用缓存，不再重复打库。 */
const READONLY_STALE_MS = 5 * 60_000;

const CHART_COLORS = {
  limitUpCount: "#ef4444",
  turnover: "#3b82f6",
  marginBalance: "#f59e0b",
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

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** 涨红跌绿（A 股惯例）。 */
function pctClass(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-red-600" : "text-emerald-600";
}

/** 指数走势的悬浮明细（含涨跌幅，涨红跌绿）。 */
function IndexTrendTooltip(props: any) {
  const row = props?.payload?.[0]?.payload;
  if (!props?.active || !row) return null;
  return (
    <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-sm">
      <div className="mb-1 font-medium">
        {row.fullDate} · {row.indexName}
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
        <span className={`text-right ${pctClass(row["涨跌幅"])}`}>{formatPct(row["涨跌幅"])}</span>
        <span className="text-muted-foreground">MA5</span>
        <span className="text-right">{formatPoint(row.MA5)}</span>
        <span className="text-muted-foreground">MA20</span>
        <span className="text-right">{formatPoint(row.MA20)}</span>
      </div>
    </div>
  );
}

/** 三合图（两联）的悬浮明细：一次给出三组原始值。 */
function MarketChartTooltip(props: any) {
  const row = props?.payload?.[0]?.payload;
  if (!props?.active || !row) return null;
  return (
    <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-sm">
      <div className="mb-1 font-medium">{row.fullDate}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-muted-foreground">涨停家数</span>
        <span className="text-right font-medium">{row["涨停数"] ?? "—"}</span>
        <span className="text-muted-foreground">成交额</span>
        <span className="text-right">{row["成交额"] === null ? "—" : `${row["成交额"]} 亿`}</span>
        <span className="text-muted-foreground">两融余额</span>
        <span className="text-right">{row["两融余额"] === null ? "—" : `${row["两融余额"]} 亿`}</span>
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

/** 区块级骨架屏（替代原来的全页 spinner）。 */
function BlockSkeleton({ height = 200 }: { height?: number }) {
  return <Skeleton className="w-full rounded-lg" style={{ height }} />;
}

/**
 * 单只指数的迷你走势卡（四张并列）。
 * 自有 query ⇒ 各自就绪即渲染，不互相阻塞。
 */
function IndexTrendCard({ index }: { index: (typeof BENCHMARK_INDICES)[number] }) {
  const { data, isLoading, isError } = trpc.market.getIndexDailySeries.useQuery(
    { indexCode: index.code, days: INDEX_TREND_DAYS },
    { staleTime: READONLY_STALE_MS },
  );

  const rows = data ?? [];
  const chartData = useMemo(() => {
    const closes = rows.map((row) => row.close);
    const ma5 = movingAverage(closes, 5);
    const ma20 = movingAverage(closes, 20);
    return rows.map((row, idx) => {
      const previousClose = idx > 0 ? closes[idx - 1] : null;
      const pct =
        row.close !== null && previousClose !== null && previousClose !== 0
          ? Number((((row.close - previousClose) / previousClose) * 100).toFixed(2))
          : null;
      return {
        date: row.tradeDate.substring(5),
        fullDate: row.tradeDate,
        indexName: index.name,
        开盘: row.open,
        最高: row.high,
        最低: row.low,
        收盘: row.close,
        涨跌幅: pct,
        MA5: ma5[idx],
        MA20: ma20[idx],
      };
    });
  }, [rows, index.name]);

  const last = chartData[chartData.length - 1];
  const firstDate = chartData[0]?.fullDate;
  const lastDate = last?.fullDate;

  return (
    <div className="rounded-lg border border-border p-3" data-homepage-index-card={index.code}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-medium">{index.name}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{index.code}</span>
        </div>
        <span className={`text-xs font-medium ${pctClass(last?.["涨跌幅"])}`}>{formatPct(last?.["涨跌幅"])}</span>
      </div>

      {isLoading ? (
        <BlockSkeleton height={130} />
      ) : isError || chartData.length === 0 ? (
        <div className="flex h-[130px] items-center justify-center text-xs text-muted-foreground">暂无指数日线数据</div>
      ) : (
        <>
          <div className="mb-1 flex items-baseline gap-2">
            <span className={`text-lg font-semibold leading-none ${pctClass(last?.["涨跌幅"])}`}>
              {formatPoint(last?.["收盘"])}
            </span>
            <span className="text-[10px] text-muted-foreground">
              最新 {lastDate} · {chartData.length} 个交易日
            </span>
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={30} height={16} />
              <YAxis
                domain={["dataMin - 30", "dataMax + 30"]}
                tick={{ fontSize: 9 }}
                width={38}
                tickFormatter={(value: number) => value.toFixed(0)}
              />
              <Tooltip content={<IndexTrendTooltip />} />
              <Line type="monotone" dataKey="收盘" stroke={index.color} strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="MA5" stroke="#94a3b8" strokeWidth={1} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="MA20" stroke="#64748b" strokeWidth={1} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-[2px] w-3 rounded" style={{ backgroundColor: index.color }} />
              收盘
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-[2px] w-3 rounded bg-slate-400" />
              MA5
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-[2px] w-3 rounded bg-slate-500" />
              MA20
            </span>
            <span className="ml-auto">
              {firstDate} ~ {lastDate}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** ① 大盘日线走势图：四指数并列。 */
function IndexTrendSection() {
  return (
    <Card data-homepage-index-grid>
      <CardHeader className="pb-3">
        <CardTitle>大盘日线走势图</CardTitle>
        <CardDescription>
          四条指数并列展示（数据源 index_daily，即库中实际存在的全部指数代码），各自最近 {INDEX_TREND_DAYS}{" "}
          个交易日；每张卡 = 收盘点位（粗线）+ MA5 / MA20（细线），点位缺失处断点、不插值。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {BENCHMARK_INDICES.map((index) => (
            <IndexTrendCard key={index.code} index={index} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** ② 涨停数 · 成交额 · 两融余额：共享分类轴的两联图（右侧只保留一条纵轴）。 */
function MarketOverviewSection() {
  const { data, isLoading } = trpc.market.getLimitUpWithMarketData.useQuery(
    { days: MARKET_CHART_DAYS },
    { staleTime: READONLY_STALE_MS, refetchInterval: 300_000 },
  );

  const chartData = useMemo(
    () =>
      (data ?? []).map((item) => ({
        date: item.date.substring(5),
        fullDate: item.date,
        涨停数: item.limitUpCount,
        成交额: item.turnover ? Number.parseFloat(item.turnover) : null,
        两融余额: item.marginBalance ? Number.parseFloat(item.marginBalance) : null,
      })),
    [data],
  );

  return (
    <Card data-homepage-market-chart>
      <CardHeader className="pb-3">
        <CardTitle>大盘成交量 · 两融数据 · 涨停数</CardTitle>
        <CardDescription>
          上下两联共享同一条日期轴：上联 = 涨停家数（左轴，柱）+ 成交额（右轴，线）—— 右轴只有成交额一条；
          下联 = 两融余额（独占左轴，亿）。两融量级小、日常波动只有 ±1%，与成交额挤在同一根轴上会被压成直线，
          因此各自独用坐标系；两侧左轴宽度对齐，两联的日期刻度严格对齐。交易所两融汇总次日早晨才发布，
          最新一日的两融暂缺（断点，不插值）。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <BlockSkeleton height={330} />
        ) : chartData.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">暂无大盘数据</div>
        ) : (
          <div className="space-y-1">
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart data={chartData} syncId="homepageMarket" margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis
                  yAxisId="count"
                  tick={{ fontSize: 12 }}
                  width={44}
                  label={{ value: "涨停家数", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                />
                <YAxis
                  yAxisId="turnover"
                  orientation="right"
                  width={56}
                  domain={["dataMin - 1200", "dataMax + 1200"]}
                  tick={{ fontSize: 12 }}
                  label={{ value: "成交额(亿)", angle: 90, position: "insideRight", style: { fontSize: 11 } }}
                />
                <Tooltip content={<MarketChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
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
              </ComposedChart>
            </ResponsiveContainer>

            <ResponsiveContainer width="100%" height={120}>
              <ComposedChart data={chartData} syncId="homepageMarket" margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={16} />
                <YAxis
                  yAxisId="margin"
                  tick={{ fontSize: 12 }}
                  width={44}
                  domain={["dataMin - 60", "dataMax + 60"]}
                  label={{ value: "两融余额(亿)", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                />
                {/* 占位右轴：只为把下联绘图区宽度对齐上联（上联右轴宽 56），不承载数据。 */}
                <YAxis yAxisId="pad" orientation="right" width={56} tick={false} axisLine={false} tickLine={false} />
                <Line
                  yAxisId="margin"
                  type="monotone"
                  dataKey="两融余额"
                  name="两融余额"
                  stroke={CHART_COLORS.marginBalance}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 梯队里的一格（连板股 / 首板股 / 断板股共用一个形状）。 */
interface LadderItem {
  key: string;
  stockCode: string;
  stockName: string;
  sector: string;
  limitUpTime: string;
  changePct: number | null;
  oneWordBoard: boolean | null;
  /** true = 断板股（加删除线、改显当日涨跌幅）。 */
  broken: boolean;
}

interface LadderGroup {
  key: string;
  /** 左列主标签：`6 板` / `首板`。 */
  label: string;
  /** 左列副标签：首板显示当日家数，其余为空。 */
  subLabel?: string;
  items: LadderItem[];
}

/** 单格：时间行（或一字板标 / 涨跌幅）+ 名称（断板加删除线）+ 题材。 */
function LadderCell({ item }: { item: LadderItem }) {
  const time = normalizeLimitUpTime(item.limitUpTime);
  return (
    <div className="min-w-0 text-center leading-tight" data-ladder-stock={item.stockCode}>
      {item.broken ? (
        <div className={`text-[11px] ${pctClass(item.changePct)}`}>{formatPct(item.changePct)}</div>
      ) : item.oneWordBoard ? (
        <div className="text-[11px]">
          <span className="rounded bg-red-600 px-1 py-px text-[10px] font-medium text-white">一字板</span>
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">{time ? time.slice(0, 5) : "—"}</div>
      )}
      <div
        className={`truncate text-sm font-medium ${
          item.broken ? "text-muted-foreground line-through decoration-muted-foreground/70 decoration-[1.5px]" : ""
        }`}
        title={`${item.stockName} ${item.stockCode}`}
      >
        {item.stockName}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">{item.sector}</div>
    </div>
  );
}

/** 梯队行内次序的**次键**：封板时间升序；时间缺失的排最后。 */
function compareLimitUpTime(left: string, right: string): number {
  const a = normalizeLimitUpTime(left);
  const b = normalizeLimitUpTime(right);
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

/**
 * 实测网格列数（`grid-template-columns` 的 token 数）。
 *
 * 断点**不另立一套**：直接读计算样式 ⇒ 与 `grid-cols-2 / sm:3 / lg:4 / xl:6` 永远一致；
 * 若哪天改了列数类，这里自动跟着变，不会出现「按 6 列算、实际渲染 2 列」的错位。
 */
function useGridColumnCount(ref: RefObject<HTMLDivElement | null>): number {
  const [cols, setCols] = useState(LADDER_GRID_FALLBACK_COLS);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    /** 读取实测列数；⚠️ 只有**真的变了**才 setState，否则 ResizeObserver 会因自身高度变化反复触发而打成渲染环。 */
    const sync = () => {
      const raw = typeof window === "undefined" ? "" : window.getComputedStyle(element).gridTemplateColumns;
      const next = raw ? raw.trim().split(/\s+/).filter(Boolean).length : 0;
      setCols((previous) => (next > 0 && next !== previous ? next : previous));
    };

    sync();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", sync);
      return () => window.removeEventListener("resize", sync);
    }
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return cols;
}

/**
 * 单个高度组的网格 + **组内**折叠。
 *
 * 折叠判据 = **本组自己的网格行数**（不是整个梯队的高度行数）：行数 > `LADDER_GROUP_VISIBLE_ROWS` 时
 * 默认只渲染前 `LADDER_GROUP_VISIBLE_ROWS` 行（= 3 × 实测列数 格），由本组按钮展开/收起。
 * 收起态**不渲染**被折叠的格（不做 CSS 裁切）⇒ 探针能如实数到格数，不会把隐藏内容算进去。
 */
function LadderGroupGrid({ groupKey, items }: { groupKey: string; items: LadderItem[] }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = useGridColumnCount(gridRef);
  const [expanded, setExpanded] = useState(false);

  const columns = Math.max(1, cols);
  const totalRows = Math.ceil(items.length / columns);
  const visibleCells = LADDER_GROUP_VISIBLE_ROWS * columns;
  const collapsible = items.length > visibleCells;
  const collapsed = collapsible && !expanded;
  const shown = collapsed ? items.slice(0, visibleCells) : items;

  return (
    <>
      <div
        ref={gridRef}
        className="grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        data-ladder-grid={groupKey}
        data-ladder-grid-rows-total={totalRows}
        data-ladder-grid-rows-visible={collapsed ? LADDER_GROUP_VISIBLE_ROWS : totalRows}
      >
        {shown.map((item) => (
          <LadderCell key={item.key} item={item} />
        ))}
      </div>
      {collapsible ? (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          <span className="text-[11px] text-muted-foreground">
            {expanded
              ? `已展开本组全部 ${totalRows} 行`
              : `已折叠本组 ${totalRows - LADDER_GROUP_VISIBLE_ROWS} 行（默认只显示前 ${LADDER_GROUP_VISIBLE_ROWS} 行）`}
          </span>
          <button
            type="button"
            data-homepage-ladder-group-toggle={groupKey}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted/60"
          >
            {expanded ? "收起" : `展开本组全部 ${totalRows} 行`}
          </button>
        </div>
      ) : null}
    </>
  );
}

/**
 * ③ 连板梯队 —— 「高度 × 网格」版式（对齐用户附件图片）。
 *
 * 左列 = 高度（`N 板` / `首板(N)`），右侧按高度分行、每股一格的网格。
 * 格内三行：① 首次封板时间（一字板 ⇒ 红标「一字板」）；② 股票名称（**断板股加删除线**）；
 * ③ 题材。断板股的第①行改为**当日涨跌幅**，与图片一致。
 *
 * 左列「高度」= **若该股本日涨停会达到的连板数**（唯一实现在 `@shared/ladderHeight`）：
 * 本日仍涨停 ⇒ 本日连板数；本日未涨停 ⇒ 上一记录交易日连板数 + 1 ——
 * **含「首板未续」**（上一记录日 1 板、当日未续 ⇒ 落到 2 板行，按断板格呈现）。
 * 因此左列最高值可以**高于** `metrics.maxBoards`（后者是当日已实现的最高连板数，喂情绪评分，口径不同）。
 *
 * 行内次序 = 该股题材在**所选日期**的涨停家数降序（唯一实现 = `@shared/sectorHeatOrder`），
 * **与是否断板无关** —— 断板格与涨停格混排，不再固定排前或排尾；同热度内按封板时间升序。
 *
 * 折叠是**组内**的：每个高度组各自判断，网格行数 > `LADDER_GROUP_VISIBLE_ROWS`（3）时默认只显示前 3 行，
 * 由该组自己的按钮展开/收起（列数实测自计算样式 ⇒ 2/3/4/6 列各断点下都恰好是 3 行）。
 *
 * 数据源 `limitUp.getBoardRoster`（有界窗口，实测约 0.4s）+ `limitUp.getSectorDistribution`
 * （与热力日历是同一个 query key ⇒ 命中同一份缓存，不额外打库）；不得改用全表实现。
 */
function BoardLadderSection() {
  const { data: availableDates } = trpc.limitUp.getDates.useQuery(undefined, { staleTime: READONLY_STALE_MS });
  const [selectedDate, setSelectedDate] = useState("");

  useEffect(() => {
    if (availableDates && availableDates.length > 0 && !selectedDate) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  const { data: roster, isLoading } = trpc.limitUp.getBoardRoster.useQuery(
    { date: selectedDate },
    { enabled: !!selectedDate, staleTime: READONLY_STALE_MS, refetchInterval: 300_000 },
  );
  // 行内排序用的当日题材热度。与下方热力日历同一个 query key ⇒ 共用缓存，不会多打一次库。
  const { data: sectorDistribution } = trpc.limitUp.getSectorDistribution.useQuery(undefined, {
    staleTime: READONLY_STALE_MS,
  });

  const metrics = roster?.metrics;
  const emotionLevel = getEmotionLevel(metrics?.emotionScore ?? 0);

  /**
   * 所选日期的「题材 → 当日涨停家数」。
   * ⚠️ 该接口只覆盖最近 30 自然日：选到更早的日期 ⇒ 空表，行内次序退化为「封板时间升序」，
   * **不编造热度**（`sectorHeatOf` 对未知题材取 -1，全体并列 ⇒ 由次键决定）。
   */
  const heatLookup = useMemo(
    () => buildSectorHeatLookup(sectorDistribution?.find((day) => day.date === selectedDate)),
    [sectorDistribution, selectedDate],
  );

  /** 按高度分行：maxHeight → 2 板（空行跳过），最后固定追加「首板(N)」。 */
  const groups = useMemo<LadderGroup[]>(() => {
    if (!roster) return [];

    const connection = roster.connectionStocks ?? [];
    const firstBoards = roster.firstBoardStocks ?? [];
    const broken = roster.brokenStocks ?? [];

    const toItem = (row: (typeof connection)[number], isBroken: boolean): LadderItem => ({
      key: `${isBroken ? "broken" : "up"}-${row.stockCode}`,
      stockCode: row.stockCode,
      stockName: row.stockName,
      sector: row.sector,
      limitUpTime: row.limitUpTime,
      changePct: row.changePct ?? null,
      oneWordBoard: row.oneWordBoard ?? null,
      broken: isBroken,
    });

    /** 组内格子 = 涨停格 + 断板格**混排**，按题材当日热力降序（同热度再按封板时间、代码）。 */
    const buildItems = (up: typeof connection, cut: typeof broken): LadderItem[] =>
      sortBySectorHeat(
        [...up.map((row) => toItem(row, false)), ...cut.map((row) => toItem(row, true))],
        heatLookup,
        (left, right) =>
          compareLimitUpTime(left.limitUpTime, right.limitUpTime) || left.stockCode.localeCompare(right.stockCode),
      );

    const built: LadderGroup[] = [];
    // 分行依据 = 「高度」= **若本日涨停会达到的连板数**（口径唯一实现在 `@shared/ladderHeight`）。
    // ⚠️ 上界必须同时看「当日连板股」与「断板股」：断板股高度 = 上一记录日板数 + 1，
    //    可以高于当日最高板（例：昨日 5 板今日断板 ⇒ 当日 maxBoards 只有 4，但 6 板那一行不能丢）。
    const maxHeight = Math.max(2, ...connection.map(ladderHeight), ...broken.map(ladderHeight));
    for (let height = maxHeight; height >= 2; height -= 1) {
      const up = connection.filter((row) => ladderHeight(row) === height);
      const cut = broken.filter((row) => ladderHeight(row) === height);
      if (up.length === 0 && cut.length === 0) continue;
      built.push({ key: `boards-${height}`, label: `${height} 板`, items: buildItems(up, cut) });
    }

    // 「首板」行 = **本日**首板（高度 1）；「首板未续」已按 +1 落到 2 板行，不再挂在这一行末尾。
    built.push({
      key: "boards-1",
      label: "首板",
      subLabel: `(${firstBoards.length})`,
      items: buildItems(firstBoards, []),
    });

    return built;
  }, [roster, heatLookup]);

  return (
    <Card data-homepage-ladder>
      <CardHeader className="pb-3">
        <CardTitle>连板梯队</CardTitle>
        <CardDescription>
          按「高度」分行、每股一格的梯队表：格内第一行 = 首次封板时间（一字板以红标「一字板」代替），
          第二行 = 股票名称，第三行 = 题材。断板股整名加删除线，第一行改显当日涨跌幅（涨红跌绿）。
          左列高度 = 「若该股本日涨停会达到的连板数」⇒ 当日仍涨停取本日连板数、当日未涨停（含首板未续）
          取上一记录交易日连板数 + 1，因此左列最高值可以高于「最高板」指标（后者是当日已实现口径）；
          断板股的板数与封板时间为上一记录交易日口径，热力缺失时该格热度视为最低。
          行内按该股题材当日涨停家数降序排列（与是否断板无关），同热度内按封板时间升序；
          「首板(N)」的 N = 当日首板家数（首板未续已按 +1 计入 2 板行）。每个高度组各自在网格超过{" "}
          {LADDER_GROUP_VISIBLE_ROWS} 行时默认只显示前 {LADDER_GROUP_VISIBLE_ROWS} 行，可单独展开该组全部。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium">选择日期：</label>
          <select
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
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
          <BlockSkeleton height={420} />
        ) : !roster ? (
          <div className="py-8 text-center text-sm text-muted-foreground">暂无数据</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

            {/* 折叠在**组内**（见 `LadderGroupGrid`）；整个梯队的高度行不再整体收起。 */}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="w-[92px] border-b border-r border-border px-2 py-2 text-center font-medium">高度</th>
                    <th className="border-b border-border px-3 py-2 text-left font-medium">梯队（划线表示断板）</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.key} data-ladder-group={group.label}>
                      <td className="border-b border-r border-border px-2 py-3 text-center align-middle">
                        <div className="text-base font-semibold leading-tight text-red-600">{group.label}</div>
                        {group.subLabel ? (
                          <div className="text-[11px] leading-tight text-muted-foreground">{group.subLabel}</div>
                        ) : null}
                      </td>
                      <td className="border-b border-border px-3 py-3">
                        {group.items.length === 0 ? (
                          <div className="py-2 text-xs text-muted-foreground">该高度无个股</div>
                        ) : (
                          <LadderGroupGrid groupKey={group.key} items={group.items} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** ④ 题材热力日历 —— 独立表格。 */
function SectorHeatmapSection() {
  const { data, isLoading } = trpc.limitUp.getSectorDistribution.useQuery(undefined, { staleTime: READONLY_STALE_MS });

  const days = data ?? [];
  /**
   * 行（题材）顺序 = **当日**（最新一列，`days[0]`）的涨停家数降序 —— **不是**窗口内合计：
   * 合计会把 30 天拉平、热点换题材后排序滞后。合计只作同热度时的次键，再按名称兜底。
   * 取前 `HEATMAP_SECTOR_LIMIT` 也随该序（当日为 0 的题材会被排到后面，可能因此不入前 N）。
   */
  const sectors = useMemo(() => {
    const totals = new Map<string, number>();
    for (const day of days) {
      for (const sector of day.sectors) {
        totals.set(sector.sector, (totals.get(sector.sector) || 0) + sector.count);
      }
    }
    const rows = Array.from(totals.entries())
      .filter(([sector]) => sector !== "其他")
      .map(([sector, total]) => ({ sector, total }));
    // 唯一实现 = `@shared/sectorHeatOrder`（与连板梯队共用同一比较器）。
    return sortBySectorHeat(rows, buildSectorHeatLookup(days[0]), (left, right) => right.total - left.total || left.sector.localeCompare(right.sector)).slice(
      0,
      HEATMAP_SECTOR_LIMIT,
    );
  }, [days]);
  const maxValue = Math.max(1, ...days.flatMap((day) => day.sectors.map((sector) => sector.count)));

  return (
    <Card data-homepage-heatmap>
      <CardHeader className="pb-3">
        <CardTitle>题材热力日历</CardTitle>
        <CardDescription>
          独立表格展示：列 = 记录交易日（最近 {days.length} 个，新 → 旧），单元格颜色深浅 = 当日该题材涨停数量；
          行 = 题材，按当日（最新一列）涨停家数降序取前 {HEATMAP_SECTOR_LIMIT}（合计只作同热度时的次键），
          “合计”列 = 该题材窗口内涨停总数（仅参考，不参与排序）。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <BlockSkeleton height={420} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[80px] border border-border bg-muted p-2 text-left font-medium">
                    题材
                  </th>
                  {days.map((day) => (
                    <th
                      key={day.date}
                      className="min-w-[50px] border border-border bg-muted p-2 text-center text-xs font-medium"
                    >
                      {day.date.split("-").slice(1).join("-")}
                    </th>
                  ))}
                  <th className="min-w-[52px] border border-border bg-muted p-2 text-center text-xs font-medium">合计</th>
                </tr>
              </thead>
              <tbody>
                {sectors.map(({ sector, total }) => (
                  <tr key={sector}>
                    <td className="sticky left-0 z-10 min-w-[80px] border border-border bg-muted p-2 text-left text-xs font-medium">
                      {sector}
                    </td>
                    {days.map((day) => {
                      const count = day.sectors.find((item) => item.sector === sector)?.count || 0;
                      const intensity = count === 0 ? 0 : Math.min(100, (count / maxValue) * 100);
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
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <div className="container max-w-7xl py-6">
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="h-5 w-5" />
        <h1 className="text-lg font-semibold">行情总览</h1>
      </div>

      {/*
        各区块**各自持有 query、各自渲染骨架屏**：没有任何一个数据源可以堵住整页。
        首屏因此是「先出布局、数据逐块补齐」，而不是一个转圈等到全部就绪。
      */}
      <div className="space-y-6">
        {/* ① 大盘日线走势图（四指数并列） */}
        <IndexTrendSection />

        {/* ② 涨停数 · 成交额 · 两融余额（两联图） */}
        <MarketOverviewSection />

        {/* ③ 连板梯队（高度 × 网格） */}
        <BoardLadderSection />

        {/* ④ 题材热力日历 */}
        <SectorHeatmapSection />

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
          记录交易日涨停的天数」，与行情软件口径可能存在差异；一字板判据为当日开盘 = 最高 = 最低，行情缺失时不标记；
          交易所两融汇总次日早晨发布，最新一日可能缺失。
        </p>
      </div>
    </div>
  );
}
