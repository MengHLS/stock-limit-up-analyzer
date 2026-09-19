import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { ladderHeight } from "@shared/ladderHeight";
import { normalizeLimitUpTime } from "@shared/limitUpTime";
import { buildSectorHeatLookup, sortBySectorHeat } from "@shared/sectorHeatOrder";
import { ChevronDown, TrendingUp } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
 * 2026-09-19 第四轮修订（用户口述：图表拆合 + 暗夜柱色 + 坐标轴可读性 + 去掉折叠说明文字）：
 *   10. **柱状图独立成图**：涨停家数从「上下两联」里拆出来独占一张图（左轴「家」，日期轴由下方折线图承载）。
 *   11. **两条折线合并为一图两轴**：成交额（左轴，亿）与两融余额（右轴，亿）合到同一张图 ——
 *       两轴各自定域（`dataMin/dataMax ± 常数`）。实测 30 日窗口：成交额 16,126~19,716 亿、
 *       两融 26,185~26,380 亿，**量级相近但波动幅度差两个数量级**，共轴会把两融压成直线。
 *   12. **暗夜柱色压暗**：`#ef4444`（红-500）在大面积柱体上于暗底色会「发光」刺眼 ⇒ 暗夜改用 `#b91c1c`（红-700）；
 *       取色依据是 `useTheme()` 解析后的**实际生效主题**，不是「是否跟随系统」的推断。
 *   13. **不再画旋转的轴标题**：`label={{ angle: ±90 }}` 在轴宽不足时与刻度数字重叠（用户反馈「根本看不见」）
 *       ⇒ 单位改由**每张图的小标题**与**图例名称**承载，轴内只留刻度数字。
 *   14. **去掉梯队折叠的状态说明文字**（「已折叠本组 x 行（默认只显示前 3 行）」），只留展开 / 收起按钮。
 *
 * 2026-09-19 第五轮修订（用户口述：「首页最下面有四个大的跳转按钮没用，去掉」）：
 *   15. **底部四张快捷入口卡片整体移除**（涨停复盘明细 / 大盘分析 / 情绪分析 / 上传图片）——
 *       侧栏同名入口仍在，只去掉首页这四条重复跳转。
 *
 * 2026-09-19 第六轮修订（用户口述：「首页连板梯队日期选择器夜间模式文字看不清」）：
 *   16. **梯队「选择日期」下拉改为「主题令牌上色」**：原实现只写了 `border border-border`，
 *       而 `background-color` 落到 Tailwind preflight 的**透明** ⇒ 控件表面与**展开的选项弹层**
 *       一律交给 UA / 平台决定；偏偏 `option` 的文字色是 `inherit` 来的 `--foreground`（暗色近白）。
 *       Windows Chrome 的选项弹层是浏览器进程按**平台主题**画的独立窗口，与页面 CSS 不共享表面
 *       ⇒ 平台表面为浅色时就是「浅字浅底」。无头 Chrome 实测（`_probe_ladder_date_select_dark.mjs`）：
 *       暗色主题下 `option` 表面 = `rgba(0,0,0,0)`，若平台弹层为纯白，文字对比度仅 **1.27**（AA 需 ≥ 4.5）。
 *       ⇒ 补齐 `bg-background text-foreground border-input`（与 `OperationLogs.tsx` 的既有写法一致，
 *       使表面对比度不再依赖平台）+ `[&>option]:bg-popover [&>option]:text-popover-foreground`
 *       （选项自带不透明底与配套前景色）+ 键盘焦点 `ring`。
 *       ⚠️ `Market.tsx` 的「选择日期」是同一种写法（同一个缺陷），本轮**未动**（用户只报了首页）。
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
/**
 * 「展开 → 收起」后的回滚落点：把本组网格顶部停在距视口顶部这么远的地方。
 *
 * 为什么需要回滚（用户 2026-09-19）：「点击折叠后，页面向上回滚至合适位置，要带滚动动画」——
 * 展开态下按钮长在很高的一格网格**下面**，用户为了点它已经滚到很下面；收起后本组瞬间变矮
 * （首板组 11 行 → 3 行，约 1000px），下方内容整体上移，而浏览器**保留 scrollY** ⇒
 * 用户眼里"啪"地跳到了别的高度组，找不到自己刚才操作的是哪个。
 *
 * 值取 88px：本项目无 sticky 顶栏（`AppShell` 是 `SidebarProvider` + `main`，滚动体是 window），
 * 88px 只是呼吸留白，保证「本组网格 + 折叠按钮」同屏可见。
 */
const LADDER_COLLAPSE_SCROLL_TOP = 88;
/** 网格列数的初始猜测值；`useLayoutEffect` 会在首帧绘制前用实测值覆盖，不产生可见闪烁。 */
const LADDER_GRID_FALLBACK_COLS = 6;
/** 只读行情类查询的 staleTime：回退首页/切页返回时直接用缓存，不再重复打库。 */
const READONLY_STALE_MS = 5 * 60_000;

const CHART_COLORS = {
  /**
   * 涨停家数（柱）· 亮色主题。
   *
   * 🔴 日间态**保持原值不动**（用户 2026-09-19 明确：「只改夜间模式」）：白底上的红不刺眼，
   * 且对白卡对比度 3.76:1，是这几版里最清楚的一档 —— 不要为了"统一"顺手把它一起改淡。
   */
  limitUpBarLight: "#ef4444",
  /**
   * 涨停家数（柱）· 暗夜主题（唯一被改的一档）。
   *
   * 旧值 = Tailwind `red-700`（`#b91c1c`，`hsl(0,74%,42%)`）—— 深色卡片上一块"沉而艳"的红，用户反馈刺眼。
   * 现值 `#a04e4e` = `hsl(0,34%,47%)`：色相仍是 0（红涨绿跌是硬口径，不改色相），饱和度 74%→34%，
   * 退成"灰调砖红"，不再发光。
   * ⚠️ **必须守住「暗夜比亮日暗」这条既有口径**（`docs/evidence/_probe_homepage_rework.mjs` 的 I 节按
   * WCAG 相对亮度断言 `dark < light × 0.7`）：现值 0.135 vs 亮日 `#ef4444` 的 0.229 ⇒ 比值 **0.59**，余量 16%。
   * 改色前先套一遍这条公式 —— 「降饱和」很容易顺手把亮度一起抬上去，从而把两档拉平
   * （本轮曾误取 `#c88383`，比值 0.81 ⇒ 探针直接红）。
   */
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

/**
 * ② 涨停家数（柱，独立一图）＋ 成交额 / 两融余额（两条折线，一图两轴）。
 *
 * 为什么柱与线分家：柱的量纲是「家数」、线的量纲是「金额」，读数方式不同，叠在一个坐标系里图表显得拥挤。
 * 为什么两条折线是**两轴**而不是一轴：两者量级相近（都是亿）但**波动幅度差两个数量级**
 *   —— 实测 30 日窗口 成交额 16,126~19,716 亿、两融 26,185~26,380 亿 ⇒ 共用一根轴时两融会被压成直线。
 * 两图共用同一份 `chartData` 与 `syncId` ⇒ 悬浮明细与日期一一对应；左右内边距刻意对齐
 *   （左 = 轴宽 52；右 = 8 + 轴宽 56 = 64）⇒ 柱与折线在竖直方向对得上位。
 * 单位**不下沉到旋转的轴标题**（轴宽不足时会与刻度数字重叠，用户反馈「根本看不见」）
 *   ⇒ 改由每张图的小标题 + 图例名称承载。
 */
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
        <CardDescription>
          上下两张图共用同一条日期轴与同一个悬浮明细：上图 = 涨停家数（柱，左轴「家」）；下图 =
          成交额（左轴，亿）＋ 两融余额（右轴，亿）两条折线。成交额与两融量级相近，但波动幅度差两个数量级
          （实测 30 日窗口 16,126~19,716 亿 vs 26,185~26,380 亿），共用一根轴会把两融压成直线，
          故两轴各自定域。单位由每张图的小标题与图例承载，不再画轴标题 —— 旋转的轴标题在轴宽不足时会与
          刻度数字挤在一起。交易所两融汇总次日早晨才发布，最新一日的两融暂缺（断点，不插值）。
        </CardDescription>
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

/**
 * 单格：时间行（或一字板标 / 涨跌幅）+ 名称（断板划线）+ 题材。
 *
 * 🔴 「断板 vs 连板」的区分必须走**双通道**（用户 2026-09-19：「夜间模式下断板划线展示和连板区分度太低，
 * 换一种更明显的，后续 UI 设计都要考虑夜间模式的可读性」）：
 *   ① **形状**：断板格加**虚线描边**（`outline` 系列 —— 不占布局 ⇒ 网格对齐与列宽完全不受影响，
 *      且虚线是"失效/候补"的通用语义，任何主题、任何色觉下都读得出来）；
 *   ② **文字**：名称删除线加粗到 2px 且去掉 alpha；连板名升为 `font-semibold`（字重也是通道）。
 *
 * 为什么**不能**只靠"文字深浅"这一条通道（实测量化，别凭感觉）：
 *   · 亮色 `--foreground` oklch(0.20) / `--muted-foreground` oklch(0.50) ⇒ 文本对比 **2.93:1**；
 *   · 暗色 `--foreground` oklch(0.92) / `--muted-foreground` oklch(0.715) ⇒ 文本对比 **1.79:1**
 *     —— 夜间只有日间的 **61%**，这就是"区分度太低"的根因；
 *   · 而**再压暗断板名会伤它自己的可读性**（暗色下对卡片 5.18:1，压到 oklch(0.55) 只剩 3.0:1）
 *     ⇒ 文字通道已到顶，剩下的区分度必须由形状通道承担。
 */
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

        {/* ② 涨停家数（柱，独立一图）+ 成交额 / 两融余额（双轴折线图） */}
        <MarketOverviewSection />

        {/* ③ 连板梯队（高度 × 网格） */}
        <BoardLadderSection />

        {/* ④ 题材热力日历 */}
        <SectorHeatmapSection />

        {/* ⑤ 免责声明 */}
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
          免责声明：本页仅用于历史复盘与研究辅助，所有统计基于已记录的涨停记录与指数日线，不构成投资建议；板数口径为「连续
          记录交易日涨停的天数」，与行情软件口径可能存在差异；一字板判据为当日开盘 = 最高 = 最低，行情缺失时不标记；
          交易所两融汇总次日早晨发布，最新一日可能缺失。
        </p>
      </div>
    </div>
  );
}
