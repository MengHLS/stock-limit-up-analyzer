/**
 * ClosedLoopRunResultPanel — 闭环运行结果面板（FE-4 运行工作台）。
 *
 * 输入 = `closedLoopRunAdapter` 产出的 ViewModel（真实 `researchRun.loopRun` 结果）。
 * 本组件**只渲染**：不计算任何指标、不推断任何状态、不美化阻塞原因。
 *
 * 展示顺序按「用户最想先看到什么」排（2026-09-13 重排）：
 *   1. 全链概要（runId / createdAt / chainFingerprint / synthetic 标记）；
 *   2. 🔴 **策略产出**（真实回测产物）：成交笔数与期末权益、**权益曲线**、撮合统计与
 *      **拒单原因分布**、跳过原因、成交明细 —— 「运行策略后产生的数据」就在这里；
 *   3. 评估标量（仅 evaluation 阶段真实 EXECUTED 时有值，否则「—」）；
 *   4. 真实数据装配摘要（数据集从哪来 / 规模多大 / 用了哪个配方）；
 *   5. 🔴 **执行轨迹**：默认只列**本次真正执行**的阶段（其余折叠）—— 14 阶段里 7 个尚无
 *      执行器、恒为 BLOCKED，把它们与「真跑过的阶段」平铺在一起只会淹没真实产出。
 */

import {
  MetricCard,
  SectionCard,
  StatusBadge,
} from "@/components/common";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";
import type {
  ClosedLoopBacktestArtifactsView,
  ClosedLoopKeyedCount,
  ClosedLoopRunViewModel,
  ClosedLoopStageRowViewModel,
  RebuildScopeVerdict,
} from "@/adapters/closedLoopRunAdapter";
import { useSecurityLabels, type SecurityLabelView } from "@/hooks/useSecurityLabels";

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(2)}%`;
}

function fmtNum(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

function fmtInt(v: number | null): string {
  return v === null ? "—" : v.toLocaleString();
}

function shortHash(h: string): string {
  return h.length <= 16 ? h : `${h.slice(0, 12)}…${h.slice(-4)}`;
}

function fmtMoney(v: number | null): string {
  return v === null ? "—" : `¥${v.toLocaleString()}`;
}

function fmtRate(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(4)}%`;
}

function fmtBps(v: number | null): string {
  return v === null ? "—" : `${v} bp`;
}

/** 人话解释：把首阻塞码翻译成「为什么没跑 / 怎么才能跑」。 */
const BLOCKED_REASON_HUMAN: Readonly<Record<string, string>> = {
  CL_DATA_NOT_INJECTED:
    "服务端未拿到数据集 → 后续阶段无数据可用。",
  CL_DATASET_GATE_NOT_PASS:
    "数据集预检未通过（库内 dataset_version.status 非 READY）→ 数据阶段阻塞。",
  CL_RUNNER_NOT_INJECTED:
    "该阶段尚无真实执行器 → 下游一并阻塞。属功能未覆盖，非运行错误。",
  CL_UPSTREAM_BLOCKED:
    "上游阶段阻塞 → 先解决上游（禁止伪造中间产物）。",
  CL_WIRING_ARTIFACT_MISSING:
    "装配层缺少该阶段所需的重对象。",
  CL_STAGE_INPUT_MISSING:
    "该阶段所需的上游交接物未产出。",
  CL_LIFECYCLE_CONFIG_MISSING:
    "生命周期配置缺失，无法确定评估口径。",
};

/**
 * 拒单原因人话表（`TradeSimulationRun.executionStats.byReason` 的键）。
 *
 * 🔴 `SUSPENDED` 是「执行日**没有该证券的行情行**」—— 在 A 股语境内它是「停牌 / 当日不在
 * 数据集的证券池内」的总称。它是**最需要被看见**的一种拒单：2026-09-13 实测，直读事件面板
 * 时 100% 的订单都拒在它上面，而当时界面对此一无所知。
 */
const REJECTION_REASON_LABEL: Readonly<Record<string, string>> = {
  SUSPENDED: "执行日无行情（停牌 / 当日不在数据集证券池内）",
  LIMIT_UP: "开盘触及涨停（买入被拦截）",
  LIMIT_DOWN: "开盘触及跌停（卖出被拦截）",
  NO_LIQUIDITY: "当日无有效价格",
  INSUFFICIENT_CASH: "现金不足以全额成交",
  T_PLUS_1: "T+1 可卖份额不足",
  OTHER: "其他",
};

/** 计划层跳过原因人话表（`SkippedIntentEntry.code`）。 */
const SKIP_CODE_LABEL: Readonly<Record<string, string>> = {
  MAX_POSITIONS_REACHED: "并发持仓已满位",
  BUDGET_BELOW_MIN_LOT: "预算不足一手",
  FROZEN_EXIT_DEFERRED: "T+1 冻结，卖出顺延",
  NO_NEXT_TRADING_DAY: "窗口最后一日无可执行日",
  NON_LONG_DIRECTION: "非做多方向（longOnly 不建仓）",
};

/** 成本科目人话表（`TradeSimulationRun.costs` 的键）。 */
const COST_KEY_LABEL: Readonly<Record<string, string>> = {
  buyCommission: "买入佣金",
  sellCommission: "卖出佣金",
  stampDuty: "印花税",
  transferFee: "过户费",
  slippage: "滑点",
  otherFees: "其他费用",
  totalFees: "费用合计",
  totalCost: "总成本（含滑点）",
};

/** 「键 → 笔数」横排列表（拒单原因 / 跳过原因 / 成本共用同一段渲染）。 */
function KeyedCountList({
  items,
  labels,
  emptyText,
}: {
  items: readonly ClosedLoopKeyedCount[];
  labels: Readonly<Record<string, string>>;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <span className="text-muted-foreground">{emptyText}</span>;
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map(item => (
        <span key={item.key} className="font-mono">
          {labels[item.key] ?? item.key}
          <span className="ml-1 tabular-nums font-medium text-foreground">
            {item.count.toLocaleString()}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * 渲染一行阶段（表格行；`compact` = 折叠区用的精简列）。
 *
 * 抽成函数是为了让「已执行表」与「未执行折叠表」共用同一套字段解析，避免两处口径漂移。
 */
function renderStageRow(stage: ClosedLoopStageRowViewModel, compact = false) {
  return (
    <TableRow key={stage.stageId}>
      <TableCell className="px-3 py-2 font-mono">{stage.stageId}</TableCell>
      <TableCell className="px-3 py-2">
        <StatusBadge status={stage.state} />
      </TableCell>
      {!compact && (
        <>
          <TableCell className="px-3 py-2 font-mono text-muted-foreground">
            {stage.outputKind || "—"}
          </TableCell>
          <TableCell className="px-3 py-2 font-mono text-muted-foreground">
            {stage.handoffFingerprint ? (
              <span title={stage.handoffFingerprint}>
                {shortHash(stage.handoffFingerprint)}
              </span>
            ) : (
              "—"
            )}
          </TableCell>
        </>
      )}
      <TableCell className="px-3 py-2">
        {stage.blockedReasonCode ? (
          <div>
            <span className="font-mono text-red-600">{stage.blockedReasonCode}</span>
            {stage.blockedDetail && (
              <p className="mt-0.5 max-w-xl text-[11px] leading-snug text-muted-foreground">
                {stage.blockedDetail}
              </p>
            )}
            {stage.errorCode && (
              <p className="mt-0.5 font-mono text-[10px] text-red-600">
                error: {stage.errorCode}
              </p>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/** 权益曲线 tooltip。**函数而非组件** —— props 为 `unknown` 的组件会被 JSX 拒收属性。 */
function renderEquityTooltip(props: unknown, initialCapital: number | null) {
  const { active, payload } = props as {
    active?: boolean;
    payload?: { payload: { date: string; equity: number } }[];
  };
  if (active !== true || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (point === undefined) return null;
  const diff = initialCapital === null ? null : point.equity - initialCapital;
  return (
    <div className="min-w-[190px] space-y-1 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="font-mono font-medium">{point.date}</p>
      <p className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">权益</span>
        <span className="font-mono tabular-nums">¥{point.equity.toLocaleString()}</span>
      </p>
      {diff !== null && (
        <p className="flex items-center justify-between gap-3 text-muted-foreground">
          <span>相对初始资金</span>
          <span className="font-mono tabular-nums">
            {diff >= 0 ? "+" : "−"}¥{Math.abs(diff).toLocaleString()}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * 「证券」单元格 —— **名称 + 代码**。
 *
 * 回测结果里的 `securityId` 是 Research canonical identity（`sec_<uuid>`），直接展示
 * 用户读不懂；名称与代码由服务端解析（`researchRun.securityLabels`）后在此贴上。
 *
 * 四种**如实**状态，任何一种都不臆造（缺就显示「—」）：
 *   ① 解析成功 → 名称在上、canonical 代码在下；
 *   ② 解析出代码但名称源未收录 → 名称位「—」，**代码照常显示**（名称源只收录涨停过的
 *      股票，回测 universe 是全市场，这种缺口是数据现实）；
 *   ③ 字典未到（加载中 / 查询失败）→ 回退显示原始 `securityId`（截断，完整值挂 `title`）；
 *   ④ identity 不在标识历史里 → 同 ③（`code` 为 null）。
 */
function SecurityCell({
  securityId,
  label,
}: {
  securityId: string;
  label: SecurityLabelView | null;
}) {
  if (label?.code) {
    return (
      <div className="flex flex-col leading-tight">
        <span>{label.name ?? "—"}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{label.code}</span>
      </div>
    );
  }
  return (
    <span className="font-mono text-[10px] text-muted-foreground" title={securityId}>
      {securityId.length <= 14 ? securityId : `${securityId.slice(0, 14)}…`}
    </span>
  );
}

/**
 * 「策略产出」区块 —— 运行一次回测后**真正产生的东西**。
 *
 * 全部数值都是后端产出（评估器 / 撮合引擎）的直搬；本组件不做任何反算。
 */
function StrategyOutputSection({
  backtest,
  totalReturnPct,
  initialCapital,
  costModelNote,
  rebuildScope,
}: {
  backtest: ClosedLoopBacktestArtifactsView;
  totalReturnPct: number | null;
  initialCapital: number | null;
  costModelNote: string | null;
  /** 重建路径的证券范围是否已确认继承自绑定数据集（`unknown` = 修复前的历史结果）。 */
  rebuildScope: RebuildScopeVerdict | null;
}) {
  const stats = backtest.executionStats;
  const zeroTrades = backtest.tradeCount === 0;
  const curve = backtest.equityCurve;

  // 成交明细的「名称 + 代码」字典：只对本次真正出现的标的查一次（只读、展示增强）。
  const tradeSecurityIds = useMemo(
    () => backtest.trades.map(trade => trade.securityId),
    [backtest.trades],
  );
  const { labels: securityLabels } = useSecurityLabels(tradeSecurityIds);
  const equityValues = curve.map(p => p.equity);
  const yDomain: [number, number] | undefined =
    equityValues.length === 0
      ? undefined
      : (() => {
          const values = initialCapital === null ? equityValues : [...equityValues, initialCapital];
          const lo = Math.min(...values);
          const hi = Math.max(...values);
          const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.02 || 1;
          return [lo - pad, hi + pad];
        })();

  return (
    <div className="mt-4 rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-foreground">策略产出（回测阶段真实产物）</span>
        <StatusBadge
          status={zeroTrades ? "WARNING" : "SUCCESS"}
          label={zeroTrades ? "ZERO_TRADES" : "TRADES_FILLED"}
        />
        <span className="font-mono text-[11px] text-muted-foreground">
          决策日 {fmtInt(backtest.decisionDayCount)} · 权益点 {curve.length}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard label="成交笔数" value={fmtInt(backtest.tradeCount)} />
        <MetricCard label="初始资金" value={fmtMoney(backtest.initialCapital)} />
        <MetricCard label="期末权益" value={fmtMoney(backtest.finalEquity)} />
        <MetricCard
          label="总收益率（评估阶段口径）"
          value={fmtPct(totalReturnPct)}
        />
      </div>

      {/* 🔴 0 成交时，把「为什么」直接摊开 —— 这是本区块存在的主要理由 */}
      {zeroTrades && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-900">
          <p className="flex items-start gap-1.5 font-medium">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              本次一笔都没成交（订单 {fmtInt(stats?.totalOrders ?? null)} 单，
              全部被拒 {fmtInt(stats?.rejectedOrders ?? null)} 单）⇒ 权益曲线恒定不变、指标全 0。
            </span>
          </p>
          <p className="mt-1 pl-5">
            拒单原因：
            <KeyedCountList
              items={stats?.byReason ?? []}
              labels={REJECTION_REASON_LABEL}
              emptyText="未记录（后端未产出 executionStats）"
            />
          </p>
          <p className="mt-1 pl-5">
            最常见原因若为「执行日无行情」，说明数据集在该证券的**执行日**没有行情行
            （例如数据集只覆盖事件日）—— 请核对上方「真实数据装配」里的数据来源与回落原因。
          </p>
        </div>
      )}

      {/* 权益曲线 */}
      {curve.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-[11px] text-muted-foreground">
            权益曲线（逐模拟交易日 · 虚线 = 初始资金基准）
          </p>
          <div className="w-full" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 8, right: 24, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.7 }}
                  tickLine={false}
                  axisLine={{ stroke: "currentColor", strokeOpacity: 0.2 }}
                  minTickGap={36}
                />
                <YAxis
                  {...(yDomain !== undefined ? { domain: yDomain } : {})}
                  tickFormatter={(value: number) => `${Math.round(value / 1000)}k`}
                  tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.7 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                {initialCapital !== null && (
                  <ReferenceLine
                    y={initialCapital}
                    stroke="currentColor"
                    strokeOpacity={0.45}
                    strokeDasharray="6 4"
                  />
                )}
                {/* recharts 只在 `content` 为（箭头）函数时注入 active/payload；写成 ReactElement 会走
                    cloneElement 且 props 类型为 unknown 的组件会被 JSX 拒收 → 用普通函数调用。 */}
                <Tooltip
                  cursor={{ stroke: "currentColor", strokeOpacity: 0.25 }}
                  content={(tooltipProps: unknown) =>
                    renderEquityTooltip(tooltipProps, initialCapital)
                  }
                />
                <Line
                  type="monotone"
                  dataKey="equity"
                  name="权益"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground">
          后端未产出权益曲线（本次 backtest 阶段未执行或产出为空）。
        </p>
      )}

      {/* 撮合统计（含拒单 / 跳过原因分布） */}
      <div className="mt-3 grid gap-1 rounded-md border bg-muted/20 px-3 py-2 font-mono text-[11px] leading-relaxed">
        <p className="text-muted-foreground">
          撮合：信号 {fmtInt(stats?.totalSignals ?? null)} · 下单 {fmtInt(stats?.totalOrders ?? null)} ·
          成交 {fmtInt(stats?.totalFills ?? null)} · 拒单 {fmtInt(stats?.rejectedOrders ?? null)} ·
          部分成交 {fmtInt(stats?.partialFills ?? null)}
        </p>
        <p className="text-muted-foreground">
          拒单原因分布：
          <KeyedCountList
            items={stats?.byReason ?? []}
            labels={REJECTION_REASON_LABEL}
            emptyText="无（本次没有拒单）"
          />
        </p>
        <p className="text-muted-foreground">
          计划层跳过：
          <KeyedCountList
            items={backtest.skippedCounts}
            labels={SKIP_CODE_LABEL}
            emptyText="无"
          />
        </p>
        {backtest.costs.length > 0 && (
          <p className="text-muted-foreground">
            成本：
            <KeyedCountList
              items={backtest.costs.map(c => ({ key: c.key, count: Math.round(c.count) }))}
              labels={COST_KEY_LABEL}
              emptyText="—"
            />
          </p>
        )}
        {costModelNote && <p className="text-muted-foreground">假设：{costModelNote}</p>}
      </div>

      {/* 🔴 证券范围未确认（修复前落库的历史结果）—— 必须如实提示：
          不能让用户以为「成交明细里的 300/688」是出自他绑定的那份数据集 */}
      {rebuildScope === "unknown" && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
          <p className="flex items-start gap-1.5 font-medium">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>本次运行的证券范围<strong>未确认</strong>，成交明细可能超出你绑定数据集的范围。</span>
          </p>
          <p className="mt-1.5 pl-5">
            数据来源是「回落重建」，而这条结果里<strong>没有</strong>「已继承绑定数据集板块约束」的声明 ——
            这类结果产生于 2026-09-14 修复之前（修复后重建会继承数据集的板块 / ST 约束）。
            若成交明细里出现创业板 300·301、科创板 688 等标的，而你的数据集只声明了主板，
            那正是这个原因。<strong>请重新运行一次</strong>得到范围正确的结果。
          </p>
        </div>
      )}

      {/* 成交明细 */}
      <div className="mt-3">
        <p className="mb-1 text-[11px] text-muted-foreground">
          成交明细{backtest.tradesTruncated ? "（后端按上限投影，仅含前若干笔）" : ""}
          {backtest.tradeCount > 0 && `　共 ${backtest.tradeCount} 笔`}
        </p>
        {backtest.trades.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">无成交明细。</p>
        ) : (
          <div className="max-h-[360px] overflow-auto rounded-md border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-3 py-2">证券（名称 / 代码）</TableHead>
                  <TableHead className="px-3 py-2">买入日</TableHead>
                  <TableHead className="px-3 py-2">买入价</TableHead>
                  <TableHead className="px-3 py-2">卖出日</TableHead>
                  <TableHead className="px-3 py-2">卖出价</TableHead>
                  <TableHead className="px-3 py-2">股数</TableHead>
                  <TableHead className="px-3 py-2">净盈亏</TableHead>
                  <TableHead className="px-3 py-2">收益率</TableHead>
                  <TableHead className="px-3 py-2">持有(交易日)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backtest.trades.map((trade, index) => (
                  <TableRow key={`${trade.securityId}-${trade.entryTime}-${index}`}>
                    <TableCell className="px-3 py-1.5">
                      <SecurityCell
                        securityId={trade.securityId}
                        label={securityLabels?.[trade.securityId] ?? null}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-1.5 font-mono">{trade.entryTime}</TableCell>
                    <TableCell className="px-3 py-1.5 font-mono tabular-nums">
                      {fmtNum(trade.entryPrice)}
                    </TableCell>
                    <TableCell className="px-3 py-1.5 font-mono">
                      {trade.exitTime ?? (trade.openAtEnd ? "期末持仓" : "—")}
                    </TableCell>
                    <TableCell className="px-3 py-1.5 font-mono tabular-nums">
                      {fmtNum(trade.exitPrice)}
                    </TableCell>
                    <TableCell className="px-3 py-1.5 font-mono tabular-nums">
                      {fmtInt(trade.quantity)}
                    </TableCell>
                    <TableCell className="px-3 py-1.5 font-mono tabular-nums">
                      {fmtNum(trade.netPnl)}
                    </TableCell>
                    <TableCell className="px-3 py-1.5 font-mono tabular-nums">
                      {fmtPct(trade.returnPct)}
                    </TableCell>
                    <TableCell className="px-3 py-1.5 font-mono tabular-nums">
                      {fmtInt(trade.holdingPeriod)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {backtest.trades.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          证券名称取自涨停复盘记录（`limit_up_records`，只收录有过涨停的股票），未收录的代码名称显示「—」；
          代码为证券标识历史的 canonical 形式（`6位数字.交易所`）。
        </p>
      )}

      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          以上是一次回测运行的**原始产出**，不是策略结论：未做多重比较校正、未通过
          `RESEARCH_READY` 门禁，不得据此下单。
        </span>
      </p>
    </div>
  );
}

export function ClosedLoopRunResultPanel({
  result,
}: {
  result: ClosedLoopRunViewModel;
}) {
  const e = result.evaluation;
  const covered = result.wiring.coveredStages.length;
  const total = result.stages.length;
  const a = result.assembly;
  const zeroExecuted = result.counts.executed === 0 && total > 0;
  // 「本次真正做了什么」为主视图：只有 EXECUTED 阶段有产物，其余（BLOCKED / SKIPPED）折叠。
  const executedStages = result.stages.filter(stage => stage.state === "EXECUTED");
  const unexecutedStages = result.stages.filter(stage => stage.state !== "EXECUTED");
  const blockedHuman =
    result.firstBlockedReasonCode === null
      ? null
      : BLOCKED_REASON_HUMAN[result.firstBlockedReasonCode] ?? null;

  return (
    <SectionCard
      title="闭环运行结果"
      description="真实执行轨迹：入参齐备的阶段真跑，缺入参 / 无执行器的如实标为 BLOCKED。"
      right={<StatusBadge status={result.status} />}
    >
      {/* 全链概要 */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs text-muted-foreground">
        <span>Run ID: {result.runId}</span>
        {result.createdAt && <span>Created: {result.createdAt}</span>}
        {result.chainFingerprint && (
          <span title={result.chainFingerprint}>
            Chain: {shortHash(result.chainFingerprint)}
          </span>
        )}
        {result.synthetic && (
          <StatusBadge status="WARNING" label="SYNTHETIC" />
        )}
      </div>

      {/* 「0 执行」人话横幅：不是卡住、也不是没做完，而是入参没给够 */}
      {zeroExecuted && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
          <p className="flex items-start gap-1.5 font-medium">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>本次 {total} 个阶段无一执行。</span>
          </p>
          <p className="mt-1.5 pl-5">
            {blockedHuman ?? "原因见下方「阻塞原因」列。"}
          </p>
          {result.firstBlockedReasonCode && (
            <p className="mt-1 pl-5 font-mono text-[11px] text-amber-800">
              首阻塞码：{result.firstBlockedReasonCode}
            </p>
          )}
        </div>
      )}

      {/* 真实数据装配摘要（仅 useRealData 装配成功时出现） */}
      {a !== null && (
        <div className="mt-4 rounded-md border bg-muted/20 px-3 py-2.5 text-[11px] leading-relaxed">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">真实数据装配</span>
            <StatusBadge
              status={a.datasetGate === "PASS" ? "SUCCESS" : "WARNING"}
              label={`GATE_${a.datasetGate}`}
            />
            <StatusBadge
              status={a.datasetSource === "registry" ? "SUCCESS" : "WARNING"}
              label={
                a.datasetSource === "registry"
                  ? "直读已绑定数据集"
                  : a.datasetSource === "rebuild"
                    ? "从零重建"
                    : "来源未知"
              }
            />
            <span className="font-mono text-muted-foreground">
              数据集 {a.datasetVersion}
              {a.datasetVersionId !== null && (
                <span className="ml-1">（dataset_version.id={a.datasetVersionId}）</span>
              )}
            </span>
          </div>
          {a.datasetSource === "rebuild" && a.datasetSourceNote !== null && (
            <p className="mt-1.5 flex items-start gap-1.5 text-amber-800">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              <span>未使用已绑定数据集：{a.datasetSourceNote}</span>
            </p>
          )}
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3 lg:grid-cols-4">
            <span className="text-muted-foreground">
              区间：<span className="font-mono text-foreground">
                {a.startDate || "—"} ~ {a.endDate || "—"}
              </span>
            </span>
            <span className="text-muted-foreground">
              行数：<span className="font-mono text-foreground">
                {fmtInt(a.datasetRowCount)}
              </span>
            </span>
            <span className="text-muted-foreground">
              证券数：<span className="font-mono text-foreground">
                {fmtInt(a.datasetSecurityCount)}
              </span>
            </span>
            <span className="text-muted-foreground">
              策略：<span className="font-mono text-foreground">
                {a.strategyId || "—"}@{a.strategyVersion || "—"}
              </span>
            </span>
            <span className="text-muted-foreground">
              配方：<span className="font-mono text-foreground">
                {a.recipeId || "—"}
              </span>
              {a.recipeSource === "default-fallback" ? (
                // 🔴 BD-21：兜底 = 文档既没 recipe 也没声明式条件 ⇒ 装配层自己顶了一份
                // 默认配方上来。这不是「有人要求这么跑」，必须让用户一眼看出，
                // 不能只印一个英文枚举（否则等于把静默换规则留在界面上）。
                <span className="ml-1 font-medium text-amber-700">
                  （兜底默认 · 文档未声明配方与条件）
                </span>
              ) : (
                <span className="ml-1 text-muted-foreground">
                  （来源 {a.recipeSource}）
                </span>
              )}
            </span>
            <span className="text-muted-foreground">
              特征：<span className="font-mono text-foreground">
                {a.recipeFeatureIds.length > 0
                  ? a.recipeFeatureIds.join("、")
                  : "—"}
              </span>
            </span>
            <span className="text-muted-foreground">
              初始资金：<span className="font-mono text-foreground">
                {fmtMoney(a.simulation.initialCapital)}
              </span>
            </span>
            <span className="text-muted-foreground">
              最大持仓：<span className="font-mono text-foreground">
                {fmtInt(a.simulation.maxPositions)}
              </span>
            </span>
            <span className="text-muted-foreground">
              执行模型：<span className="font-mono text-foreground">
                {a.simulation.executionModel}
              </span>
            </span>
          </div>
          {a.simulation.costModel !== null && (
            <p className="mt-1.5 font-mono text-muted-foreground">
              成本模型：佣金 {fmtRate(a.simulation.costModel.commissionRate ?? null)}
              （最低 {fmtMoney(a.simulation.costModel.minCommission ?? null)}）·
              印花税 {fmtRate(a.simulation.costModel.stampDutyRate ?? null)} ·
              过户费 {fmtRate(a.simulation.costModel.transferFeeRate ?? null)} ·
              滑点 {fmtBps(a.simulation.costModel.slippageBps ?? null)} ·
              冲击 {fmtBps(a.simulation.costModel.impactBps ?? null)}
            </p>
          )}
          {a.selectionSummary && (
            <p className="mt-1 flex items-start gap-1.5 text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>选股口径：{a.selectionSummary}</span>
            </p>
          )}
        </div>
      )}

      {/* 🔴 策略产出（真实回测产物）—— 放在装配摘要之后：0 成交时用户需要先看到「数据从哪来」 */}
      {result.backtest !== null && (
        <StrategyOutputSection
          backtest={result.backtest}
          totalReturnPct={e?.totalReturnPct ?? null}
          initialCapital={
            result.backtest.initialCapital ?? a?.simulation.initialCapital ?? null
          }
          rebuildScope={result.rebuildScope}
          costModelNote={
            a === null
              ? null
              : `${a.simulation.executionModel} 执行 · 佣金 ${fmtRate(
                  a.simulation.costModel?.commissionRate ?? null,
                )} / 印花税 ${fmtRate(a.simulation.costModel?.stampDutyRate ?? null)} / 滑点 ${fmtBps(
                  a.simulation.costModel?.slippageBps ?? null,
                )}`
          }
        />
      )}

      {/* 阶段口径：只把「真跑过的」当正面指标 —— 14 阶段里 9 个本来就跑不了 */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard
          label="本次执行阶段"
          value={`${fmtInt(result.counts.executed)}/${fmtInt(total)}`}
        />
        <MetricCard
          label="未执行阶段"
          value={fmtInt(result.counts.blocked + result.counts.skipped)}
        />
        <MetricCard
          label="其中尚无执行器"
          value={fmtInt(result.wiring.unwiredStages.length)}
        />
        <MetricCard label="入参齐备阶段" value={`${covered}/${total}`} />
      </div>

      {/* 首阻塞 */}
      {result.firstBlockedReasonCode && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="font-mono">首阻塞：{result.firstBlockedReasonCode}</span>
        </p>
      )}

      {/* 评估标量（仅真实评估后展示；否则全「—」） */}
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-foreground">
          评估标量
          {e === null && (
            <span className="ml-2 font-normal text-muted-foreground">
              本次运行未执行 evaluation 阶段 → 无标量（不推算）
            </span>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard label="总收益率" value={fmtPct(e?.totalReturnPct ?? null)} />
          <MetricCard label="年化收益率（CAGR）" value={fmtPct(e?.cagrPct ?? null)} />
          <MetricCard label="最大回撤" value={fmtPct(e?.maxDrawdownPct ?? null)} />
          <MetricCard label="Sharpe" value={fmtNum(e?.sharpeRatio ?? null)} />
          <MetricCard label="Sortino" value={fmtNum(e?.sortinoRatio ?? null)} />
          <MetricCard label="Calmar" value={fmtNum(e?.calmarRatio ?? null)} />
          <MetricCard label="胜率" value={fmtPct(e?.winRatePct ?? null)} />
          <MetricCard
            label="Profit Factor"
            value={fmtNum(e?.profitFactor ?? null)}
          />
          <MetricCard
            label="完成交易数"
            value={fmtInt(e?.completedTradeCount ?? null)}
          />
        </div>
      </div>

      {/* 装配覆盖明细 */}
      <div className="mt-4 rounded-md border bg-muted/20 px-3 py-2.5 text-[11px] leading-relaxed">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">执行器装配</span>
          {result.wiring.executorBound ? (
            <StatusBadge status="SUCCESS" label="EXECUTOR_BOUND" />
          ) : (
            <StatusBadge status="INFO" label="EXECUTOR_NOT_BOUND" />
          )}
          <span className="text-muted-foreground">
            已装配 {result.wiring.wiredStages.length} 阶段 / 尚无执行器{" "}
            {result.wiring.unwiredStages.length} 阶段
          </span>
        </div>
        {result.wiring.unwiredStages.length > 0 && (
          <p className="mt-1 font-mono text-muted-foreground">
            尚无执行器：{result.wiring.unwiredStages.join("、")}
          </p>
        )}
        {result.runnerInjected.length > 0 && (
          <p className="mt-1 font-mono text-muted-foreground">
            本次注入：{result.runnerInjected.join("、")}
          </p>
        )}
        {result.note && (
          <p className="mt-1 flex items-start gap-1.5 text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{result.note}</span>
          </p>
        )}
      </div>

      {/* 逐阶段轨迹：默认只列**本次真正执行**的阶段，其余折叠 */}
      <div className="mt-4">
        <p className="mb-1.5 text-xs font-medium text-foreground">
          本次真正执行的阶段
          <span className="ml-2 font-normal text-muted-foreground">
            共 {executedStages.length} 个
            {unexecutedStages.length > 0 &&
              `；另有 ${unexecutedStages.length} 个未执行（多为尚无执行器 / 上游未产出交接物，与本次策略产出无关）`}
          </span>
        </p>

        {executedStages.length === 0 ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
            本次没有任何阶段被真实执行 —— 请求入参未齐备。请先看上方的「首阻塞」与下方
            「未执行阶段」明细；**没有执行就没有产出**，本页不会用占位数据补齐。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-3 py-2">阶段</TableHead>
                  <TableHead className="px-3 py-2">状态</TableHead>
                  <TableHead className="px-3 py-2">产出</TableHead>
                  <TableHead className="px-3 py-2">交接指纹</TableHead>
                  <TableHead className="px-3 py-2">阻塞原因</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executedStages.map(stage => renderStageRow(stage))}
              </TableBody>
            </Table>
          </div>
        )}

        {unexecutedStages.length > 0 && (
          <details className="mt-3 rounded-md border bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              未执行的 {unexecutedStages.length} 个阶段（无产物；列出仅为可追溯）
            </summary>
            {unexecutedStages.some(s => s.blockedReasonCode === "CL_RUNNER_NOT_INJECTED") && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                其中{" "}
                {
                  unexecutedStages.filter(
                    s => s.blockedReasonCode === "CL_RUNNER_NOT_INJECTED",
                  ).length
                }{" "}
                个是「尚无真实执行器」（优化 / 稳健性 / 样本外 / 过拟合 / 纸面交易 / 复盘 /
                纪律反馈）—— 属功能未覆盖，不是本次运行出错；它们也不会产出任何数据。
              </p>
            )}
            <div className="mt-2 overflow-x-auto rounded-md border">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3 py-2">阶段</TableHead>
                    <TableHead className="px-3 py-2">状态</TableHead>
                    <TableHead className="px-3 py-2">阻塞原因</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unexecutedStages.map(stage => renderStageRow(stage, true))}
                </TableBody>
              </Table>
            </div>
          </details>
        )}
      </div>
    </SectionCard>
  );
}
