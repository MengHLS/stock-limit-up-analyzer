import { MaxConnectionBoardTrendChart } from "@/components/MaxConnectionBoardTrendChart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { ladderHeight } from "@shared/ladderHeight";
import { normalizeLimitUpTime } from "@shared/limitUpTime";
import { buildSectorHeatLookup, isTailSector, sortBySectorHeat } from "@shared/sectorHeatOrder";
import { ChevronDown, TrendingUp } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
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
const LADDER_GROUP_VISIBLE_ROWS = 3;
const LADDER_COLLAPSE_SCROLL_TOP = 88;
/** 网格列数的初始猜测值；`useLayoutEffect` 会在首帧绘制前用实测值覆盖，不产生可见闪烁。 */
const LADDER_GRID_FALLBACK_COLS = 6;
/** 只读行情类查询的 staleTime：回退首页/切页返回时直接用缓存，不再重复打库。 */
const READONLY_STALE_MS = 5 * 60_000;

const CHART_COLORS = {
  limitUpBarLight: "#ef4444",
  limitUpBarDark: "#a04e4e",
  turnover: "#3b82f6",
  marginBalance: "#f59e0b",
};

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

function MarketOverviewSection() {
  const { data, isLoading } = trpc.market.getLimitUpWithMarketData.useQuery(
    { days: MARKET_CHART_DAYS },
    { staleTime: READONLY_STALE_MS, refetchInterval: 300_000 },
  );
  const { theme } = useTheme();

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

  /** 柱色随**实际生效**主题切换（`useTheme()` 给的是 light/dark，不是「是否跟随系统」）。 */
  const barColor = theme === "dark" ? CHART_COLORS.limitUpBarDark : CHART_COLORS.limitUpBarLight;

  return (
    <Card data-homepage-market-chart>
      <CardHeader className="pb-3">
        <CardTitle>大盘成交量 · 两融数据 · 涨停数</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <BlockSkeleton height={330} />
        ) : chartData.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">暂无大盘数据</div>
        ) : (
          <div className="space-y-4">
            {/* 图 1：涨停家数（柱）—— 独占一张图，不与金额量纲混在一个坐标系里。 */}
            <div data-homepage-chart="limit-up-bar">
              <div className="mb-1 text-xs font-medium text-muted-foreground">涨停家数（柱，左轴：家）</div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart
                  data={chartData}
                  syncId="homepageMarket"
                  margin={{ top: 8, right: 64, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" hide />
                  <YAxis width={52} tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip content={<MarketChartTooltip />} />
                  <Bar dataKey="涨停数" name="涨停家数" fill={barColor} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/*
              图 2：成交额 + 两融余额 —— 两条折线一图两轴（左 = 成交额，右 = 两融余额）。
              刻度一律取整：`16,126.02` 这类带小数的 8 字符刻度在 52px 轴宽里会被裁掉首位数字
              （用户反馈「坐标轴数字看不见」），量纲是亿，整数刻度足够读数。
            */}
            <div data-homepage-chart="market-lines">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                成交额（左轴：亿）· 两融余额（右轴：亿）
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={chartData}
                  syncId="homepageMarket"
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={16} />
                  <YAxis
                    yAxisId="turnover"
                    width={52}
                    domain={["dataMin - 1200", "dataMax + 1200"]}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value: number) => value.toFixed(0)}
                  />
                  <YAxis
                    yAxisId="margin"
                    orientation="right"
                    width={56}
                    domain={["dataMin - 60", "dataMax + 60"]}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value: number) => value.toFixed(0)}
                  />
                  <Tooltip content={<MarketChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    yAxisId="turnover"
                    type="monotone"
                    dataKey="成交额"
                    name="成交额(亿)"
                    stroke={CHART_COLORS.turnover}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                  <Line
                    yAxisId="margin"
                    type="monotone"
                    dataKey="两融余额"
                    name="两融余额(亿)"
                    stroke={CHART_COLORS.marginBalance}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
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

function LadderCell({ item }: { item: LadderItem }) {
  const time = normalizeLimitUpTime(item.limitUpTime);
  return (
    <div
      className={`min-w-0 rounded-md text-center leading-tight ${
        item.broken ? "-outline-offset-1 outline-1 outline-dashed outline-muted-foreground/80" : ""
      }`}
      data-ladder-stock={item.stockCode}
    >
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
        className={`truncate text-sm ${
          item.broken
            ? "font-medium text-muted-foreground line-through decoration-muted-foreground decoration-[2px]"
            : "font-semibold"
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

function LadderGroupGrid({ groupKey, items }: { groupKey: string; items: LadderItem[] }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = useGridColumnCount(gridRef);
  const [expanded, setExpanded] = useState(false);
  /** 上一帧的展开态：只在「展开 → 收起」这一刻回滚；挂载帧与展开动作都不动滚动条。 */
  const wasExpandedRef = useRef(false);

  /**
   * 收起后把本组平滑滚回视野。
   *
   * ⚠️ 三个刻意的选择：
   *   ① 用 `useLayoutEffect` 而不是 `useEffect` —— 必须在浏览器把「变矮后的布局」画出去**之前**算落点，
   *      否则会先看到一次跳动再滑回来；
   *   ② **只向上、绝不向下**：本组顶部若已在舒适线以下（用户本来就看得见），一律不滚 ——
   *      否则点一下收起会把用户的视口往下拽，比不滚更烦；
   *   ③ 落点夹取到页面最大可滚距离，避免最后一组（首板）收起后滚过头露出空白。
   */
  useLayoutEffect(() => {
    const wasExpanded = wasExpandedRef.current;
    wasExpandedRef.current = expanded;
    if (!wasExpanded || expanded) return;
    const element = gridRef.current;
    if (!element) return;
    const top = element.getBoundingClientRect().top;
    if (top >= LADDER_COLLAPSE_SCROLL_TOP) return;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const target = Math.min(Math.max(0, window.scrollY + top - LADDER_COLLAPSE_SCROLL_TOP), maxScroll);
    // 尊重系统的「减弱动态效果」：该偏好打开时改为瞬时定位，不做动画。
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    window.scrollTo({ top: target, behavior: reduceMotion ? "auto" : "smooth" });
  }, [expanded]);

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
        // ⚠️ 这个容器**只能有按钮这一个子元素**：`docs/evidence/_probe_homepage_rework.mjs` 断言
        // `btn.parentElement` 除按钮外无其它子节点（防"已折叠本组 x 行"这类冗余说明文字回流）。
        // 居中靠容器自身的 `justify-center` 完成，不要再套一层 wrapper。
        <div className="mt-3 flex items-center justify-center">
          <button
            type="button"
            data-homepage-ladder-group-toggle={groupKey}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex select-none items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3.5 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm transition-all hover:border-foreground/20 hover:bg-muted hover:text-foreground hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
          >
            <span>{expanded ? "收起" : `展开本组全部 ${totalRows} 行`}</span>
            {/* 箭头随展开态翻转 —— 让"当前是收着还是展开"不只有文字一个信号。 */}
            <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      ) : null}
    </>
  );
}

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
   * 所选日期的「题材 → 当日涨停家数 + 窗口内合计」（两个键同一遍扫描，与热力图**同一查表**）。
   * ⚠️ 该接口只覆盖最近 30 自然日：选到更早的日期 ⇒ 当日热度一律 -1（**不编造热度**），
   * 次序退化为「窗口内合计降序 → 题材名」——**仍与热力图同序**。
   */
  const heatLookup = useMemo(
    () => buildSectorHeatLookup(sectorDistribution, selectedDate),
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

    /**
     * 组内格子 = 涨停格 + 断板格**混排**，按 `compareSectorOrder`（题材次序，与热力图同源）升序；
     * `tieBreak` 只作用于**同一题材内部**（封板时间升序 → 代码升序）。
     * 「其他」压尾由 `sortBySectorHeat` 内部保证（唯一实现，勿在此另写一套）。
     */
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
          行内按「题材次序」排列（与是否断板无关）：当日涨停家数降序 → 同热度按窗口合计降序 → 再按题材名，
          与下方题材热力日历**同序**；同一题材内部按封板时间升序；
          「其他」（无题材归属的兜底桶）不参与热度名次，固定排在每个高度的最后；
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
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&>option]:bg-popover [&>option]:text-popover-foreground"
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
  const sectors = useMemo(() => {
    const lookup = buildSectorHeatLookup(days, days[0]?.date);
    const rows = Array.from(lookup.entries())
      .filter(([sector]) => !isTailSector(sector))
      .map(([sector, entry]) => ({ sector, total: entry.windowTotal }));
    return sortBySectorHeat(rows, lookup).slice(0, HEATMAP_SECTOR_LIMIT);
  }, [days]);
  const maxValue = Math.max(1, ...days.flatMap((day) => day.sectors.map((sector) => sector.count)));

  return (
    <Card data-homepage-heatmap>
      <CardHeader className="pb-3">
        <CardTitle>题材热力日历</CardTitle>
        <CardDescription>
          独立表格展示：列 = 记录交易日（最近 {days.length} 个，新 → 旧），单元格颜色深浅 = 当日该题材涨停数量；
          行 = 题材，按当日（最新一列）涨停家数降序取前 {HEATMAP_SECTOR_LIMIT}，同热度按“合计”降序、再按题材名
          —— 与上方连板梯队的题材次序**同一套规则**（同一个题材在两处的相对位置一致）；
          “合计”列 = 该题材窗口内涨停总数（它正是同热度时的次键）。
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

function SentimentTrendSection() {
  /**
   * `nonce: 0` = 服务端缓存的默认键（`trend:${nonce ?? 0}`）⇒ 与 `/sentiment-analysis`
   * 的普通挂载**共用同一条缓存**，两边互相加热，不会各算一份。
   */
  const { data, isLoading, isError } = trpc.sentiment.getMaxConnectionBoardTrend.useQuery(
    { nonce: 0 },
    { staleTime: READONLY_STALE_MS },
  );
  const points = data ?? [];

  if (isLoading) {
    return (
      <Card data-homepage-sentiment-chart>
        <CardHeader className="pb-3">
          <CardTitle>每日最高连板折线图</CardTitle>
          <CardDescription>正在读取主板涨停记录并计算每日最高连板…</CardDescription>
        </CardHeader>
        <CardContent>
          <BlockSkeleton height={340} />
        </CardContent>
      </Card>
    );
  }

  if (isError || points.length === 0) {
    return (
      <Card data-homepage-sentiment-chart>
        <CardHeader className="pb-3">
          <CardTitle>每日最高连板折线图</CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {isError ? "最高连板数据加载失败，请稍后重试。" : "暂无最高连板数据：录入涨停记录后这里会自动生成每日趋势。"}
        </CardContent>
      </Card>
    );
  }

  return (
    <div data-homepage-sentiment-chart>
      <MaxConnectionBoardTrendChart
        points={points}
        chartHeight={340}
        yAxisLabel={null}
        className="border-border bg-card shadow-sm"
        sliderHint="连续拖动选区或两端手柄，松手后会对齐交易日并更新主图；悬浮数据点可查看当日最高连板个股。"
        headerExtra={(
          <Link
            href="/sentiment-analysis"
            data-homepage-sentiment-entry
            className="text-xs font-medium text-orange-600 hover:underline"
          >
            情绪周期与龙头列表 →
          </Link>
        )}
      />
    </div>
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

        {/* ② 涨停家数（柱，独立一图）+ 成交额 / 两融余额（双轴折线图） */}
        <MarketOverviewSection />

        {/* ③ 连板梯队（高度 × 网格） */}
        <BoardLadderSection />

        {/* ④ 题材热力日历 */}
        <SectorHeatmapSection />

        {/* ⑤ 底部 —— 每日最高连板折线图 + 日期范围滑块（用户 2026-09-20 要求，见 `SentimentTrendSection`） */}
        <SentimentTrendSection />
      </div>
    </div>
  );
}
