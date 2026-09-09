/**
 * FE-9 — 复盘工作台（Review Workbench）：复盘纪律 + 生产闭环 UI。
 *
 * 展示规格（ROADMAP §48.4 FE-9，对应 §26/§27）：纸面交易单笔全生命周期
 * （建仓→加仓→做T→清仓）+ 纪律反馈看板（C-24.2）+ 生产闭环状态（C-25.1）。
 *
 * 纪律（§0.2 / R7 / 前端不是 Quant Engine）：
 * - **只读渲染**：数值一律来自后端 `review.*` 端点（tradeJournal / disciplineFeedback /
 *   paperAccount 三个 CODE_READY 纯函数引擎）与 `sentiment.*`（legacy 前向纸面真实数据），
 *   本页不计算任何纪律评分 / 交易指标 / PnL；
 * - **R7 隔离标注（必做）**：凡复用 legacy 前向纸面（PaperTradingState 的 PaperOrder /
 *   PaperPosition / equityCurve）与手工注入的复盘数据流，即属「技术预览·非 RESEARCH_READY
 *   口径」，与 RESEARCH_READY 研究链路严格隔离（页面顶部醒目提示条）；
 * - **诚实空态**：C-23.2 编排未完成 → journal.drafts 需要 SignalToPnlRun、paper.run
 *   需要 PaperAccountRunInput，当前无真实数据注入 → 该区块诚实 EmptyState；
 *   discipline.run 无已标注 entry → 空账本运行返回 inconclusive（DFA_NO_ENTRIES），
 *   绝不编造违规原因 / 纪律评分；
 * - **字段字典取真实引擎契约**：列名 / 阶段字段 / 图例枚举一律引用
 *   server/research/tradeJournal|disciplineFeedback|paperAccount 真实类型与受控词表。
 */

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  SectionCard,
  StatusBadge,
  StatusDot,
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
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AppRouter } from "../../../server/routers";
import type { ReviewRouter } from "../../../server/reviewRouter";

// ---------------------------------------------------------------------------
// 类型：review 端点尚未合并进 appRouter，先用类型断言构造 review 客户端；
// 协调者合并后改回 `trpc.review.*`（预期内的临时类型隔离）。
// ---------------------------------------------------------------------------

type ReviewClient = ReturnType<typeof createTRPCReact<ReviewRouter>>;
const review = trpc as unknown as ReviewClient;

type ReconcileOutput = inferRouterOutputs<ReviewRouter>["journal"]["reconcile"];
type DisciplineOutput = inferRouterOutputs<ReviewRouter>["discipline"]["run"];
type PaperTradingDetail = inferRouterOutputs<AppRouter>["sentiment"]["getPaperTradingRun"];

// ---------------------------------------------------------------------------
// 展示规格常量（结构 / 图例，不携带任何数据值）
// ---------------------------------------------------------------------------

/** 单笔交易生命周期四阶段固定管线（§26 展示规格；引擎不存 stage 字段）。 */
const LIFE_CYCLE_STAGES = [
  { code: "OPEN", label: "建仓", desc: "该标的初次买入，建立持仓。" },
  { code: "ADD", label: "加仓", desc: "持仓期间追加买入，摊薄/扩大仓位。" },
  { code: "T_TRADE", label: "做T", desc: "持有底仓的同时做日内 T+0 卖出/回补。" },
  { code: "CLOSE", label: "清仓", desc: "全部卖出平仓，持仓归零。" },
] as const;

/** 违规归因原因码（JOURNAL_REASON_CODES，tradeJournal/types.ts 受控词表）。 */
const REASON_CODE_LEGEND: { code: string; meaning: string }[] = [
  { code: "OMISSION", meaning: "规则记得但操作遗漏" },
  { code: "MISUNDERSTANDING", meaning: "对规则理解/应用错误" },
  { code: "IMPULSIVE", meaning: "冲动下单，未按计划执行" },
  { code: "JUDGMENT_OVERRIDE", meaning: "明知规则但判断性覆盖" },
  { code: "EXECUTION_TECHNICAL", meaning: "执行技术问题（系统/延迟/手数/路径）" },
  { code: "MARKET_EVENT", meaning: "涨跌停/停牌/流动性等客观事件" },
  { code: "INFORMATION_SHORTAGE", meaning: "决策时信息不足" },
  { code: "OTHER", meaning: "其它（reasonNote 必填）" },
];

const RULE_VIOLATION_SEVERITIES = [
  { code: "MINOR", meaning: "轻微" },
  { code: "MAJOR", meaning: "明显" },
  { code: "CRITICAL", meaning: "严重" },
];

const DEVIATION_DIMENSION_LEGEND = [
  "QUANTITY",
  "PRICE",
  "TIMING",
  "UNFILLED",
  "PARTIAL_FILL",
];

// ---------------------------------------------------------------------------
// 数值格式化与涨跌着色（中国 A 股约定：涨红跌绿）
// ---------------------------------------------------------------------------

const fmtNum = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d);
const pnlTone = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : v >= 0 ? "text-rose-600" : "text-emerald-700";

// ---------------------------------------------------------------------------
// 技术预览 · journal.reconcile 手工核对表单（引擎注入式，不伪造数据）
// ---------------------------------------------------------------------------

function ReconcileDemo() {
  const [securityId, setSecurityId] = useState("600000.SH");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("100");
  const [decisionDate, setDecisionDate] = useState("2024-01-02");
  const [execDate, setExecDate] = useState("2024-01-03");
  const [windowDays, setWindowDays] = useState("1");
  const [refPrice, setRefPrice] = useState("");
  const [fillMode, setFillMode] = useState<"filled" | "none">("filled");
  const [fillQty, setFillQty] = useState("100");
  const [fillPrice, setFillPrice] = useState("9.80");
  const [fillDate, setFillDate] = useState("2024-01-03");
  const [basePrice, setBasePrice] = useState("10.00");
  const [unfilledCode, setUnfilledCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = review.journal.reconcile.useMutation({
    onError: (err) => setFormError(err.message),
  });
  const result: ReconcileOutput | null = mutation.data ?? null;

  const run = () => {
    setFormError(null);
    const qty = Number(quantity);
    const win = Number(windowDays);
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isInteger(win) || win < 1) {
      setFormError("数量必须为正整数、执行窗口必须为 ≥1 整数");
      return;
    }
    const ref = refPrice.trim() === "" ? null : Number(refPrice);
    const fills =
      fillMode === "filled"
        ? [
            {
              fillId: "preview-fill-1",
              securityId,
              side,
              quantity: Number(fillQty),
              price: Number(fillPrice),
              timestamp: fillDate,
              basePrice: basePrice.trim() === "" ? null : Number(basePrice),
            },
          ]
        : [];
    mutation.mutate({
      planned: {
        securityId,
        side,
        quantity: qty,
        decisionDate,
        expectedExecutionDate: execDate,
        executionWindowDays: win,
        referencePrice: ref,
        referencePriceBasis: ref === null ? null : "决策日 close（技术预览手工注入）",
        priceRangeLow: null,
        priceRangeHigh: null,
      },
      fills,
      ...(fillMode === "none" && unfilledCode.trim() !== ""
        ? { unfilledReasonCode: unfilledCode.trim() }
        : {}),
    });
  };

  const field = (label: string, value: string, set: (s: string) => void, placeholder = "") => (
    <label className="text-[11px] text-muted-foreground">
      {label}
      <Input value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} className="mt-0.5 h-8 bg-background text-xs" />
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {field("证券", securityId, setSecurityId)}
        <label className="text-[11px] text-muted-foreground">
          方向
          <select
            value={side}
            onChange={(e) => setSide(e.target.value as "buy" | "sell")}
            className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="buy">buy</option>
            <option value="sell">sell</option>
          </select>
        </label>
        {field("计划股数", quantity, setQuantity)}
        {field("决策日", decisionDate, setDecisionDate)}
        {field("执行日", execDate, setExecDate)}
        {field("窗口(交易日)", windowDays, setWindowDays, "1")}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {field("参考价(可选)", refPrice, setRefPrice, "决策日 close")}
        <label className="text-[11px] text-muted-foreground">
          成交状态
          <select
            value={fillMode}
            onChange={(e) => setFillMode(e.target.value as "filled" | "none")}
            className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="filled">已成交</option>
            <option value="none">未成交</option>
          </select>
        </label>
        {fillMode === "filled" ? (
          <>
            {field("成交股数", fillQty, setFillQty)}
            {field("成交价", fillPrice, setFillPrice)}
            {field("成交日", fillDate, setFillDate)}
            {field("基准价(可选)", basePrice, setBasePrice, "执行日前收")}
          </>
        ) : (
          <>
            {field("未成交原因码", unfilledCode, setUnfilledCode, "如 PAPER_CHECK_*")}
            <div className="col-span-3" />
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={run} disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          运行核对
        </Button>
        {formError && <span className="text-xs text-red-600">{formError}</span>}
      </div>

      {result && (
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-semibold">核对结果（JournalDeviation）</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="成交状态" value={result.fillState} hint="FULL / PARTIAL / NONE" />
            <MetricCard label="数量偏差" value={fmtNum(result.quantityDeviation, 0)} hint="实际 − 计划（股）" />
            <MetricCard label="实际成交价" value={fmtNum(result.actualFillPrice)} hint="VWAP；未成交为 —" />
            <MetricCard label="价格偏差" value={fmtNum(result.priceDeviation)} hint="实际 − 参考价" />
            <MetricCard label="窗口内成交" value={result.executedInPlannedWindow === null ? "—" : String(result.executedInPlannedWindow)} hint="D+1 计划窗口" />
            <MetricCard
              label="机器偏差维度"
              value={result.machineDeviationDimensions.length > 0 ? result.machineDeviationDimensions.join(" / ") : "—"}
              hint="JOURNAL_DEVIATION_DIMENSIONS"
            />
          </div>
          {result.unfilledReasonCode && (
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              未成交原因：{result.unfilledReasonCode}
            </p>
          )}
          {result.reconcileNote && (
            <p className="mt-1 text-[11px] text-muted-foreground">{result.reconcileNote}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 纪律反馈看板（C-24.2 四类报告）
// ---------------------------------------------------------------------------

function DisciplineBoard({ data }: { data: DisciplineOutput | null }) {
  if (!data) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[
          "违规原因统计（aggregateViolationCauses）",
          "重复错误识别（detectRepeatMistakes）",
          "最差执行策略排序（rankExecutionQuality）",
          "易错环境识别（identifyErrorProneEnvironments）",
          "描述性结论（conclusion）",
          "人工评级与趋势（PostReviewRecord，模块零自动打分）",
        ].map((t) => (
          <EmptyState key={t} title={`暂无${t.split("（")[0]}`} description="运行「空账本纪律分析」或注入已标注 TradeJournalEntry 后渲染。" className="py-6" />
        ))}
      </div>
    );
  }

  const s = data.summary;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard label="分析条目数" value={s.analyzedEntryCount} />
        <MetricCard label="已标注" value={s.annotationCount} />
        <MetricCard label="声明违规" value={s.violationDeclaredCount} />
        <MetricCard
          label="结论"
          value={data.conclusion.verdict}
          tone={data.conclusion.verdict === "stable" ? "success" : data.conclusion.verdict === "patternsFound" ? "warning" : "neutral"}
        />
      </div>
      <div className="rounded-md border bg-muted/20 p-3">
        <p className="text-xs font-semibold">描述性结论</p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {data.conclusion.reasonCode}：{data.conclusion.reason}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs font-semibold">违规原因统计</p>
          {data.violationCauses.rows.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">无已标注违规（reasonUnassignedCount={data.violationCauses.reasonUnassignedCount}）。</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {data.violationCauses.rows.map((r) => (
                <li key={r.reasonCode} className="text-[11px]">
                  {r.reasonCode} × {r.count}（{fmtNum(r.shareOfViolationsPct, 1)}%）
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs font-semibold">重复错误识别</p>
          {data.repeatMistakes.patterns.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">无同因重复（candidateEventCount={data.repeatMistakes.candidateEventCount}）。</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {data.repeatMistakes.patterns.map((p) => (
                <li key={p.groupKey} className="text-[11px]">
                  {p.reasonCode}（{p.groupKey}）× {p.occurrenceCount}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs font-semibold">最差执行策略排序</p>
          {data.executionQuality.rows.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">无策略分组（rankedCount={data.executionQuality.rankedCount}）。</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {data.executionQuality.rows.map((r) => (
                <li key={r.strategyKey} className="text-[11px]">
                  {r.strategyKey}（{r.status === "RANKED" ? `#${r.rank}` : r.status}，n={r.entryCount}）
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs font-semibold">易错环境识别</p>
          {data.errorProneEnvironments.rows.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              无环境标签（labeledEntryCount={data.errorProneEnvironments.labeledEntryCount}，unlabeled={data.errorProneEnvironments.unlabeledEntryCount}）。
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {data.errorProneEnvironments.rows.map((r) => (
                <li key={r.environmentKey} className="text-[11px]">
                  {r.environmentKey}：违规 {r.violationCount}/{r.taggedEntryCount}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs font-semibold">候选模式清单</p>
          {data.patterns.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">无候选模式（描述性，供人审）。</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {data.patterns.map((p) => (
                <li key={p.key} className="text-[11px]">{p.label}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs font-semibold">人工评级与趋势</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            纪律评级为人工注入（PostReviewRecord 1–5）；本引擎零自动打分，无已落账复盘时为空。
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

export default function ReviewWorkbench() {
  // 研究引擎端点（技术预览）：discipline 空账本运行，证明端点可用且诚实返回 inconclusive。
  const disciplineMutation = review.discipline.run.useMutation();
  const [disciplineError, setDisciplineError] = useState<string | null>(null);

  // legacy 前向纸面真实数据（R7 隔离数据流）。
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const listQuery = trpc.sentiment.listPaperTradingRuns.useQuery({ limit: 50 });
  const detailQuery = trpc.sentiment.getPaperTradingRun.useQuery(
    { id: selectedId ?? 0 },
    { enabled: selectedId !== null },
  );

  const runs = listQuery.data ?? [];
  const detail: PaperTradingDetail | null = detailQuery.data ?? null;

  const curveData = useMemo(
    () => (detail?.state.equityCurve ?? []).map((p) => ({ date: p.date.slice(5), equity: p.equity })),
    [detail],
  );

  const orders = useMemo(() => [...(detail?.state.orders ?? [])].reverse(), [detail]);
  const filledOrders = useMemo(() => orders.filter((o) => o.status !== "skipped"), [orders]);
  const exitedOrders = useMemo(() => orders.filter((o) => o.status === "exited"), [orders]);
  const stageCounts: Record<string, number> = {
    OPEN: filledOrders.length,
    ADD: 0,
    T_TRADE: 0,
    CLOSE: exitedOrders.length,
  };

  const runEmptyDiscipline = () => {
    setDisciplineError(null);
    disciplineMutation.mutate({
      runId: "dfa-preview-empty",
      createdAt: new Date().toISOString(),
      entries: [],
    });
  };

  return (
    <div className="space-y-4">
      {/* 页面头 */}
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ClipboardList className="h-5 w-5" />
          复盘工作台
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          FE-9 · 复盘纪律 + 生产闭环——纸面交易单笔全生命周期（建仓→加仓→做T→清仓） /
          纪律反馈看板（C-24.2）/ 生产闭环状态（C-25.1）；后端 review.* 端点已暴露
          （tradeJournal / disciplineFeedback / paperAccount 引擎），C-23.2 数据注入未完成时诚实用空态。
        </p>
      </div>

      {/* R7 隔离标注（必做、醒目）：技术预览 · 非 RESEARCH_READY 口径 */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 space-y-1 text-xs leading-relaxed">
            <p className="font-semibold">技术预览 · 非 RESEARCH_READY 口径 · 隔离标注（ROADMAP R7）</p>
            <p>
              本工作台联调时复用 <b>legacy 前向纸面</b>（PaperTradingState：PaperOrder /
              PaperPosition / equityCurve）与<b>手工注入的复盘数据流</b>，一律属「非研究可信度
              口径」，与 RESEARCH_READY 研究链路（tradeJournal / disciplineFeedback /
              paperAccount 经 review.* 暴露的同源记录）<b>严格隔离</b>，不得据此下研究结论。
            </p>
            <p className="font-mono text-[11px]">
              研究链路数据联调前置：① C-23.2 编排产出 SignalToPnlRun / PaperAccountRunInput
              真实数据注入；② C-24.1 / C-24.2 / C-25.1 认证（VALIDATED）。
            </p>
          </div>
        </div>
      </div>

      {/* 研究引擎端点接入（技术预览） */}
      <SectionCard
        title="研究引擎端点接入（技术预览）"
        icon={Play}
        description="review.journal.reconcile / review.journal.drafts / review.discipline.run / review.paper.run 四端点已暴露；本层只做传输 → 领域边界投递，引擎结构化错误原样冒泡。"
        right={<StatusBadge status="INFO" label="CODE_READY" />}
      >
        <div className="space-y-4">
          <div className="rounded-lg border p-3">
            <p className="mb-2 text-xs font-semibold">journal.reconcile · 计划 vs 实际机器核对</p>
            <ReconcileDemo />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs font-semibold">journal.drafts · 从 SignalToPnlRun 提取 draft</p>
              <EmptyState
                title="待 C-23.2 数据注入"
                description="buildJournalDraftsFromRun 需要 SignalToPnlRun（C-23.2 闭环编排产物）；当前退出策略未完成、无真实 SignalToPnlRun，端点已暴露但无数据源，不做伪造。"
                className="mt-2 border-0 py-6"
              />
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-xs font-semibold">paper.run · 组装 paper account run</p>
              <EmptyState
                title="待 C-23.2 数据注入"
                description="assemblePaperAccountRun 需要 PaperAccountRunInput（orders/fills/持仓快照/现金账本/成本·执行声明）。legacy 前向纸面为另一套 PaperOrder/PaperPosition 形态（非引擎契约），不擅自桥接，端点已暴露待注入。"
                className="mt-2 border-0 py-6"
              />
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">discipline.run · 纪律反馈分析（四类报告）</p>
              <Button size="sm" variant="outline" onClick={runEmptyDiscipline} disabled={disciplineMutation.isPending}>
                {disciplineMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                运行空账本分析
              </Button>
            </div>
            {(disciplineError ?? disciplineMutation.error?.message) && (
              <p className="mt-1 text-xs text-red-600">{disciplineError ?? disciplineMutation.error?.message}</p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              无已标注 TradeJournalEntry 时，空账本运行会诚实返回 inconclusive（DFA_NO_ENTRIES），
              绝不编造违规原因/纪律评分（对齐 TJ_UNASSESSED_REASON_CODES 显式缺省码哲学）。
            </p>
          </div>
        </div>
      </SectionCard>

      {/* 纪律反馈看板（C-24.2 四类报告） */}
      <SectionCard
        title="纪律反馈看板"
        icon={ShieldCheck}
        description="跨交易聚合（C-24.2 DisciplineFeedbackRun）四类报告 + 描述性结论；仅消费已落账人工标注，draft（annotation=null）不计入。无自动纪律打分——评级为人工注入（1–5，PostReviewRecord）。"
        right={<StatusBadge status={disciplineMutation.data ? "SUCCESS" : "NOT_RUN"} label={disciplineMutation.data ? disciplineMutation.data.conclusion.verdict : "NO_DATA"} />}
      >
        {/* 静态说明卡：违规类型图例（真实枚举，非数据） */}
        <div className="mb-3 rounded-lg border bg-muted/20 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
            <ShieldCheck className="h-3.5 w-3.5" />
            违规归因受控词表 · 静态说明卡（枚举取自 tradeJournal/types.ts JOURNAL_REASON_CODES）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {REASON_CODE_LEGEND.map((r) => (
              <span key={r.code} title={r.meaning} className="rounded-md border bg-card px-1.5 py-0.5 font-mono text-[11px]">
                {r.code}
                <span className="ml-1 font-sans text-muted-foreground">{r.meaning}</span>
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>严重度：</span>
            {RULE_VIOLATION_SEVERITIES.map((s) => (
              <span key={s.code} className="rounded-md border bg-card px-1.5 py-0.5 font-mono">
                {s.code}
                <span className="ml-1 font-sans">{s.meaning}</span>
              </span>
            ))}
            <span className="ml-1">｜偏差维度（可过滤轴）：</span>
            {DEVIATION_DIMENSION_LEGEND.map((d) => (
              <span key={d} className="rounded-md border bg-card px-1.5 py-0.5 font-mono">{d}</span>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            环境标签由调用方注入（不自行计算 regime）；无标签条目显式归缺省桶
            <span className="mx-1 rounded border bg-card px-1 font-mono">ENV_UNLABELED</span>，不编造环境。
          </p>
        </div>

        <DisciplineBoard data={disciplineMutation.data ?? null} />
      </SectionCard>

      {/* 真实纸面交易单笔全生命周期（legacy 前向纸面 · R7 隔离） */}
      <SectionCard
        title="真实纸面交易单笔全生命周期（legacy 前向纸面 · R7 隔离）"
        icon={TrendingUp}
        description="数据源 = sentiment.getPaperTradingRun（PaperTradingState）。上半区运行列表 + 权益曲线，下半区逐笔订单与生命周期阶段（建仓/加仓/做T/清仓）。legacy 前向纸面无加仓/做T路径，阶段计数如实为 0。"
        right={<StatusBadge status={detail ? "SUCCESS" : "NOT_RUN"} label={detail ? `#${detail.id}` : "NO_DATA"} />}
      >
        {listQuery.isLoading ? (
          <p className="flex items-center gap-1.5 py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载运行列表…
          </p>
        ) : runs.length === 0 ? (
          <EmptyState
            title="暂无前向纸面运行"
            description="管理员在前向纸面交易页创建并推进一条运行后，此处渲染其真实订单 / 权益曲线 / 生命周期阶段。"
            className="py-8"
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {runs.map((run) => (
                <Button
                  key={run.id}
                  size="sm"
                  variant={run.id === selectedId ? "default" : "outline"}
                  onClick={() => setSelectedId(run.id)}
                >
                  #{run.id} {run.label}
                  <span className="ml-1 font-mono text-[10px] opacity-70">{run.lastProcessedDate ?? "-"}</span>
                </Button>
              ))}
            </div>

            {detailQuery.isLoading && (
              <p className="flex items-center gap-1.5 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载运行详情…
              </p>
            )}

            {detail && (
              <>
                {/* 账户 / 摘要指标 */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MetricCard label="初始资金" value={`¥${detail.initialCapital.toLocaleString()}`} />
                  <MetricCard label="前向总市值" value={`¥${(detail.summary?.finalEquity ?? 0).toLocaleString()}`} />
                  <MetricCard
                    label="累计收益"
                    value={<span className={pnlTone(detail.summary?.totalReturn)}>{fmtNum(detail.summary?.totalReturn)}</span>}
                  />
                  <MetricCard label="最大回撤" value={fmtNum(detail.summary?.maxDrawdown)} />
                </div>

                {/* 权益曲线 */}
                {curveData.length > 0 ? (
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={curveData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="date" minTickGap={24} tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} domain={["auto", "auto"]} />
                        <Tooltip />
                        <Line type="monotone" dataKey="equity" name="前向权益" stroke="#f97316" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState title="暂无权益曲线" description="该运行尚未推进出权益点。" className="py-6" />
                )}

                {/* 生命周期阶段管线 */}
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {LIFE_CYCLE_STAGES.map((stage, idx) => (
                    <div key={stage.code} className="rounded-lg border bg-card p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-xs font-semibold">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted font-mono text-[10px]">{idx + 1}</span>
                          {stage.label}
                          <span className="font-mono text-[10px] text-muted-foreground">{stage.code}</span>
                        </p>
                        <StatusDot status={stageCounts[stage.code] > 0 ? "SUCCESS" : "NOT_RUN"} />
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{stage.desc}</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">{stageCounts[stage.code]} 笔</p>
                      {(stage.code === "ADD" || stage.code === "T_TRADE") && (
                        <p className="mt-1 text-[10px] text-muted-foreground">legacy 前向纸面无此路径（单标的单笔、无日内回转）。</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* 逐笔订单 */}
                <p className="text-xs text-muted-foreground">逐笔订单（来自 PaperTradingState.orders，非研究引擎 TradeJournalEntry）</p>
                <DataTable maxHeight={320}>
                  <TableHeader>
                    <TableRow>
                      {["证券", "状态", "信号日", "成交日 / 价", "出清日 / 价", "股数", "净收益", "原因"].map((c) => (
                        <TableHead key={c} className="text-xs">{c}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((o, i) => (
                      <TableRow key={`${o.stockCode}-${o.entryDate}-${i}`}>
                        <TableCell className="text-xs">
                          <p className="font-medium">{o.stockName}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">{o.stockCode}</p>
                        </TableCell>
                        <TableCell className="text-xs">{o.status === "exited" ? "已出清" : o.status === "filled" ? "持仓中" : "未成交"}</TableCell>
                        <TableCell className="font-mono text-xs">{o.signalDate}</TableCell>
                        <TableCell className="font-mono text-xs">{o.entryDate ?? "—"}{o.entryPrice === null ? "" : ` @ ${o.entryPrice}`}</TableCell>
                        <TableCell className="font-mono text-xs">{o.exitDate ?? "—"}{o.exitPrice === null ? "" : ` @ ${o.exitPrice}`}</TableCell>
                        <TableCell className="text-xs">{o.shares}</TableCell>
                        <TableCell className={`text-xs ${pnlTone(o.netReturn)}`}>{o.netReturn === null ? "—" : `${o.netReturn}%`}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{o.reason ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                    {orders.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="p-0">
                          <EmptyState title="暂无订单" description="该运行尚未成交任何订单。" className="border-0 py-8" />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </DataTable>
              </>
            )}
          </div>
        )}
      </SectionCard>

      {/* 生产闭环状态 */}
      <SectionCard
        title="生产闭环状态"
        icon={WalletCards}
        description="账户 / 约束配置（C-23.1 paperAccount）+ §27 生产闭环（C-25.1）状态机；C-25.1 全链路编排尚未编码，此处为诚实空态。"
        right={<StatusBadge status="NOT_RUN" label="未就绪" />}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium">账户 / 约束配置</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { label: "初始资金", hint: "PaperAccount.initialCapital" },
                { label: "可用现金", hint: "cash（不含冻结）" },
                { label: "冻结资金", hint: "frozen（挂单预留）" },
                { label: "总权益", hint: "equity = cash + frozen + Σ市值" },
                { label: "已实现盈亏", hint: "realizedPnL（账户累计）" },
                { label: "持仓数", hint: "positions（securityId 升序）" },
              ].map((m) => (
                <MetricCard key={m.label} label={m.label} value="—" hint={m.hint} />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              以上账户截面由 C-23.2 编排产出 PaperAccountRunInput 后经 paper.run 组装；当前无数据注入，故为占位（—）。
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium">闭环状态机</p>
            <EmptyState
              title="暂无生产闭环运行"
              description="C-25.1（§27 全链路编排：Data→Research→…→Discipline）尚未编码且未认证；联调后将展示闭环各环节状态与迁移，此处不做占位假状态。"
              className="py-8"
            />
          </div>
        </div>
      </SectionCard>

      {/* 工程信息：字段字典 + 联调清单 */}
      <TechnicalDetails title="技术详情：FE-9 字段字典（真实契约来源）+ 联调清单（只读说明，非数据）">
        <div className="space-y-2 px-1 py-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <p className="font-sans font-medium text-foreground">端点清单（server/reviewRouter.ts）</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>journal.reconcile（mutation）→ reconcilePlanVsActual（ReconcilePlanVsActualInput → JournalDeviation）</li>
            <li>journal.drafts（mutation）→ buildJournalDraftsFromRun（SignalToPnlRun + createdAt → JournalDraftExtraction）</li>
            <li>discipline.run（mutation）→ buildDisciplineFeedbackRun（BuildDisciplineFeedbackRunInput → DisciplineFeedbackRun）</li>
            <li>paper.run（mutation）→ assemblePaperAccountRun（PaperAccountRunInput → PaperAccountRun，含 pnlBreakdown）</li>
          </ul>
          <p className="pt-1 font-sans font-medium text-foreground">字段字典（1:1 取真实引擎契约）</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>tradeJournal/types.ts：TradeJournalEntry（entryId / journalId / securityId / side / decisionDate / expectedExecutionDate / planned / actual / deviation / annotation）；受控词表 JOURNAL_REASON_CODES / JOURNAL_EMOTION_CODES / JOURNAL_RULE_VIOLATION_SEVERITIES / JOURNAL_DEVIATION_DIMENSIONS / TJ_UNASSESSED_REASON_CODES</li>
            <li>disciplineFeedback/types.ts：DisciplineFeedbackRun（violationCauses / repeatMistakes / executionQuality / errorProneEnvironments / conclusion / patterns）；DFA_ENV_UNLABELED_KEY</li>
            <li>paperAccount/types.ts：PaperAccount / PaperAccountPosition / PaperAccountOrder / PaperAccountFill / PaperAccountRun（orders / fills / positionSnapshots / cashLedger / equityCurve / pnlBreakdown / executionCoverage / 双声明指纹）</li>
            <li>派生口径：建仓/加仓/做T/清仓阶段属展示派生（legacy 前向纸面单标的单笔、无加仓/做T路径），引擎无 stage / Trade 级汇总字段</li>
          </ul>
          <p className="pt-1 font-sans font-medium text-foreground">联调清单</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>reviewRouter 合并进 server/routers.ts appRouter（协调者统一处理，前端由类型断言改回 trpc.review.*）</li>
            <li>C-23.2 编排产出 SignalToPnlRun / PaperAccountRunInput 真实数据注入（journal.drafts / paper.run 解除空态）</li>
            <li>C-24.1 / C-24.2 / C-25.1 认证（VALIDATED）后，解除 R7 技术预览标注</li>
            <li>前端纪律：本页不计算纪律评分 / 交易指标；端点暴露后数值即填、空态即让位；legacy 数据流一律以 R7 隔离条标注</li>
          </ul>
        </div>
      </TechnicalDetails>

      {/* 注脚 */}
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        review.* 端点已暴露（引擎 CODE_READY）；C-23.2 数据注入未完成，draft / paper / 有标注纪律聚合为空态，无编造。
      </p>
    </div>
  );
}
