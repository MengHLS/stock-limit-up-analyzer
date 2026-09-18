import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { AlertTriangle, BarChart3, Loader2, Play, Pause, Plus, RefreshCw, SlidersHorizontal, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type StrategyKey = "baseline" | "riskPenalty" | "hardFilter" | "qualityBlend" | "qualityGate";

const STRATEGY_LABELS: Record<StrategyKey, string> = {
  baseline: "原始策略",
  riskPenalty: "风险扣分策略",
  hardFilter: "高风险硬过滤",
  qualityBlend: "质量复合评分",
  qualityGate: "质量门控策略",
};

/** 止损 / 动态回撤止盈的判定时点：与 server/paperTrading.ts#PAPER_TRADING_EXIT_PHASES 同源（此处只做展示映射，不实现语义）。 */
type ExitPhase = "open" | "close" | "both";

const EXIT_PHASE_LABELS: Record<ExitPhase, string> = {
  both: "开盘 + 收盘（缺省）",
  open: "仅开盘",
  close: "仅收盘",
};

type SizingStrategy = "equal" | "scoreWeighted" | "fixedPercent";

const SIZING_LABELS: Record<SizingStrategy, string> = {
  equal: "等权（现金 ÷ 本批笔数）",
  fixedPercent: "固定单笔比例（初始资金 × 比例）",
  scoreWeighted: "按策略分加权",
};

/**
 * 数值型设置项的声明表 —— 表单渲染与提交前校验**共用同一份声明**。
 * 双份维护（渲染一套、校验一套）正是「页面显示 5%、服务端算 6%」这类漂移的温床。
 */
type NumericFieldKey =
  | "portfolioStopLossPercent"
  | "stopLossPercent"
  | "strongHoldMinReturn"
  | "maxHoldingDays"
  | "trailingProfitActivationPercent"
  | "trailingDrawdownPercent"
  | "maxPositions"
  | "fixedPositionPercent"
  | "oneWordLimitDownSellProbability"
  | "maxPositionAmountRatio";

type NumberFieldSpec = {
  key: NumericFieldKey;
  label: string;
  hint?: string;
  min: number;
  max: number;
  step?: number;
  /** 服务端 schema 为 .int() 的字段：提交前取整，避免撞出难读的校验错误。 */
  integer?: boolean;
};

const EXIT_FIELDS: NumberFieldSpec[] = [
  { key: "portfolioStopLossPercent", label: "组合无条件止损（%）", hint: "单票浮亏达建仓总权益的该比例即无条件出清；纸面专属、回测无；0=关闭", min: 0, max: 100, step: 0.5 },
  { key: "stopLossPercent", label: "单票止损比例（%）", hint: "相对建仓成本的固定比例止损", min: 0, max: 100, step: 0.5 },
  { key: "strongHoldMinReturn", label: "强势续持阈值（%）", hint: "收盘收益不低于该值且收盘≥前收 ⇒ 继续持有", min: 0, max: 100, step: 0.5 },
  { key: "maxHoldingDays", label: "最多续持（交易日）", hint: "达到即出清", min: 2, max: 30, step: 1, integer: true },
  { key: "trailingProfitActivationPercent", label: "回撤止盈激活（%）", hint: "峰值收益达到该值后武装回撤止盈", min: 0, max: 100, step: 0.5 },
  { key: "trailingDrawdownPercent", label: "回撤止盈回撤（%）", hint: "自峰值回撤达到该值即止盈出清", min: 0, max: 100, step: 0.5 },
];

const POSITION_FIELDS: NumberFieldSpec[] = [
  { key: "maxPositions", label: "最大持仓数", min: 1, max: 100, step: 1, integer: true },
  { key: "fixedPositionPercent", label: "固定单笔比例（%）", hint: "仅「固定单笔比例」仓位方式生效：初始资金 × 该比例", min: 1, max: 100, step: 1 },
];

/** 成交可行性开关（不改止损逻辑，只改变能不能买到 / 能不能卖出 / 能买多少）。默认与改动前一致 = 全关。 */
const CONSTRAINT_TOGGLES: Array<{ key: ConstraintToggleKey; label: string; hint: string }> = [
  { key: "enableIntradayStopLoss", label: "盘中止损", hint: "开盘未破位、但当日最低价触及止损价 ⇒ 按止损价出清" },
  { key: "blockLimitUpBuys", label: "禁追涨停买入", hint: "次日开盘价已达涨停 ⇒ 放弃买入" },
  { key: "blockOneWordLimitUpBuys", label: "禁一字涨停买入", hint: "开盘即封死一字涨停 ⇒ 跳过该笔" },
  { key: "blockLimitDownSells", label: "一字跌停卖不出", hint: "一字跌停无法出清 ⇒ 顺延到下一交易日（会如实写原因）" },
  { key: "enableOneWordLimitDownProbability", label: "一字跌停按概率可卖", hint: "不用「一定卖不掉」，改按确定性哈希概率判定当天能否卖出" },
];

const CONSTRAINT_FIELDS: NumberFieldSpec[] = [
  { key: "oneWordLimitDownSellProbability", label: "一字跌停可卖概率（%）", hint: "仅在上一个开关开启时生效", min: 0, max: 100, step: 5 },
  { key: "maxPositionAmountRatio", label: "单笔成交额占比上限", hint: "0=不限；0.05=不超过当日成交额 5%（容量约束，只改股数）", min: 0, max: 1, step: 0.01 },
];

type ConstraintToggleKey =
  | "enableIntradayStopLoss"
  | "blockLimitUpBuys"
  | "blockOneWordLimitUpBuys"
  | "blockLimitDownSells"
  | "enableOneWordLimitDownProbability";

type PaperSettingsForm = Record<NumericFieldKey, string> & {
  exitJudgementPhase: ExitPhase;
  positionSizingStrategy: SizingStrategy;
} & Record<ConstraintToggleKey, boolean>;

/** 缺省值 = 服务端缺省（server/paperTrading.ts#resolvePaperRealisticOptions / resolvePaperTradingSettings）。 */
const DEFAULT_SETTINGS: PaperSettingsForm = {
  exitJudgementPhase: "both",
  portfolioStopLossPercent: "3",
  stopLossPercent: "5",
  strongHoldMinReturn: "3",
  maxHoldingDays: "5",
  trailingProfitActivationPercent: "6",
  trailingDrawdownPercent: "3",
  maxPositions: "5",
  positionSizingStrategy: "equal",
  fixedPositionPercent: "20",
  enableIntradayStopLoss: false,
  blockLimitUpBuys: false,
  blockOneWordLimitUpBuys: false,
  blockLimitDownSells: false,
  enableOneWordLimitDownProbability: false,
  oneWordLimitDownSellProbability: "0",
  maxPositionAmountRatio: "0",
};

function Metric({ label, value, tone = "text-slate-800" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

const returnTone = (value: number | null | undefined) =>
  value === null || value === undefined || value === 0 ? "text-slate-800" : value > 0 ? "text-rose-600" : "text-emerald-700";

export default function PaperTrading() {
  const { user, isAuthenticated } = useAuth();
  const isAdmin = isAuthenticated && user?.role === "admin";
  const utils = trpc.useUtils();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [strategyKey, setStrategyKey] = useState<StrategyKey>("baseline");
  const [initialCapital, setInitialCapital] = useState("100000");
  /** 建运行时的策略设置（退出与止损 / 仓位 / 成交约束）；缺省值与服务端缺省一一对应。 */
  const [settings, setSettings] = useState<PaperSettingsForm>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  /** 最近一次推进的如实结论（推进成功 / 已是最新 / 交易日历落后）。 */
  const [advanceNotice, setAdvanceNotice] = useState<{ tone: "success" | "warning" | "info"; text: string } | null>(null);

  const listQuery = trpc.sentiment.listPaperTradingRuns.useQuery({ limit: 50 });
  const detailQuery = trpc.sentiment.getPaperTradingRun.useQuery(
    { id: selectedId ?? 0 },
    { enabled: selectedId !== null },
  );

  const createMutation = trpc.sentiment.createPaperTradingRun.useMutation({
    onSuccess: (data) => {
      toast.success(`已创建运行 #${data.id}`);
      setSelectedId(data.id);
      setLabel("");
      void listQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  // 🔴 推进提示必须按服务端诊断如实分流（2026-09-14 事故）：此前无条件报「已推进到最新交易日」，
  // 而交易日历（指数日线）落后时推进恒为空转 ⇒ 提示与事实相反。
  const advanceMutation = trpc.sentiment.advancePaperTradingRun.useMutation({
    onSuccess: (data) => {
      const { diagnosis } = data;
      if (diagnosis.calendarStale) {
        toast.warning(diagnosis.message);
        setAdvanceNotice({ tone: "warning", text: diagnosis.message });
      } else if (diagnosis.kind === "advanced") {
        toast.success(diagnosis.message);
        setAdvanceNotice({ tone: "success", text: diagnosis.message });
      } else {
        toast.info(diagnosis.message);
        setAdvanceNotice({ tone: "info", text: diagnosis.message });
      }
      void detailQuery.refetch();
      void listQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const statusMutation = trpc.sentiment.setPaperTradingRunStatus.useMutation({
    onSuccess: () => {
      void detailQuery.refetch();
      void listQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const runs = listQuery.data ?? [];
  const detail = detailQuery.data;

  const curveData = useMemo(() => (detail?.state.equityCurve ?? []).map((point) => ({
    date: point.date.slice(5),
    equity: point.equity,
    cash: point.cash,
  })), [detail]);

  const orders = useMemo(() => [...(detail?.state.orders ?? [])].reverse(), [detail]);

  const onCreate = () => {
    const capital = Number(initialCapital);
    if (!Number.isFinite(capital) || capital < 10_000) {
      toast.error("初始资金需为不小于 10000 的整数");
      return;
    }
    // 数值项按同一张声明表统一校验：任一非法即整体拒绝 —— 不做「悄悄用缺省顶上」的兜底，
    // 否则用户以为自己设了 2% 止损、实际跑的是 5%，而页面上看不出差别。
    const numeric = {} as Record<NumericFieldKey, number>;
    for (const spec of [...EXIT_FIELDS, ...POSITION_FIELDS, ...CONSTRAINT_FIELDS]) {
      const raw = settings[spec.key].trim();
      const parsedRaw = raw === "" ? Number(DEFAULT_SETTINGS[spec.key]) : Number(raw);
      const value = spec.integer ? Math.round(parsedRaw) : parsedRaw;
      if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
        toast.error(`「${spec.label}」需为 ${spec.min} ~ ${spec.max} 之间的数字`);
        return;
      }
      numeric[spec.key] = value;
    }
    createMutation.mutate({
      label: label.trim() || `${STRATEGY_LABELS[strategyKey]}·前向纸面`,
      strategyKey,
      initialCapital: Math.floor(capital),
      options: {
        realistic: {
          maxPositions: numeric.maxPositions,
          positionSizingStrategy: settings.positionSizingStrategy,
          fixedPositionPercent: numeric.fixedPositionPercent,
          stopLossPercent: numeric.stopLossPercent,
          strongHoldMinReturn: numeric.strongHoldMinReturn,
          maxHoldingDays: numeric.maxHoldingDays,
          trailingProfitActivationPercent: numeric.trailingProfitActivationPercent,
          trailingDrawdownPercent: numeric.trailingDrawdownPercent,
          enableIntradayStopLoss: settings.enableIntradayStopLoss,
          blockLimitUpBuys: settings.blockLimitUpBuys,
          blockOneWordLimitUpBuys: settings.blockOneWordLimitUpBuys,
          blockLimitDownSells: settings.blockLimitDownSells,
          enableOneWordLimitDownProbability: settings.enableOneWordLimitDownProbability,
          oneWordLimitDownSellProbability: numeric.oneWordLimitDownSellProbability,
          maxPositionAmountRatio: numeric.maxPositionAmountRatio,
        },
        // 🔴 纸面专属设置：组合回测不认识这个块（它在回测参数容器之外），边界由类型表达。
        paperTrading: {
          exitJudgementPhase: settings.exitJudgementPhase,
          portfolioStopLossPercent: numeric.portfolioStopLossPercent,
        },
      },
    });
  };

  const updateSetting = <K extends keyof PaperSettingsForm>(key: K, value: PaperSettingsForm[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const renderNumberField = (spec: NumberFieldSpec) => (
    <label key={spec.key} className="block text-xs text-slate-600">
      {spec.label}
      <Input
        type="number"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        value={settings[spec.key]}
        onChange={(event) => updateSetting(spec.key, event.target.value)}
        className="mt-1 h-9 w-full bg-white"
      />
      {spec.hint && <span className="mt-1 block text-[10px] font-normal leading-4 text-slate-400">{spec.hint}</span>}
    </label>
  );

  const renderToggle = (toggle: { key: ConstraintToggleKey; label: string; hint: string }) => (
    <label key={toggle.key} className="flex items-start gap-2 text-xs text-slate-600">
      <input
        type="checkbox"
        checked={settings[toggle.key]}
        onChange={(event) => updateSetting(toggle.key, event.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
      />
      <span>
        {toggle.label}
        <span className="mt-0.5 block text-[10px] leading-4 text-slate-400">{toggle.hint}</span>
      </span>
    </label>
  );

  // 「该运行实际生效的参数」：值全部来自服务端（唯一缺省源），页面只做标签映射 —— 不在这里再写一遍缺省值。
  const effectiveRows = useMemo(() => {
    const data = detail?.effectiveSettings;
    if (!data) return [];
    const rows: Array<{ label: string; value: string; paths: string[]; note?: string }> = [
      { label: "止损 / 回撤止盈判定时点", value: EXIT_PHASE_LABELS[data.exitJudgementPhase], paths: ["paperTrading.exitJudgementPhase"] },
      {
        label: "组合无条件止损",
        value: data.portfolioStopLossPercent > 0 ? `${data.portfolioStopLossPercent}%` : "已关闭",
        paths: ["paperTrading.portfolioStopLossPercent"],
        note: "纸面专属，回测无此规则",
      },
      { label: "单票止损比例", value: `${data.stopLossPercent}%`, paths: ["realistic.stopLossPercent"] },
      { label: "强势续持阈值", value: `${data.strongHoldMinReturn}%`, paths: ["realistic.strongHoldMinReturn"] },
      { label: "最多续持", value: `${data.maxHoldingDays} 个交易日`, paths: ["realistic.maxHoldingDays"] },
      {
        label: "回撤止盈",
        value: `激活 ${data.trailingProfitActivationPercent}% / 回撤 ${data.trailingDrawdownPercent}%`,
        paths: ["realistic.trailingProfitActivationPercent", "realistic.trailingDrawdownPercent"],
      },
      { label: "最大持仓数", value: String(data.maxPositions), paths: ["realistic.maxPositions"] },
      {
        label: "仓位方式",
        value: data.positionSizingStrategy === "fixedPercent"
          ? `固定单笔比例（初始资金 × ${data.fixedPositionPercent}%）`
          : SIZING_LABELS[data.positionSizingStrategy],
        paths: ["realistic.positionSizingStrategy", "realistic.fixedPositionPercent"],
      },
      {
        label: "盘中止损",
        value: data.enableIntradayStopLoss ? "开启" : "关闭",
        paths: ["realistic.enableIntradayStopLoss"],
      },
      {
        label: "成交约束",
        value: (() => {
          const parts = [
            data.blockLimitUpBuys ? "禁追涨停" : null,
            data.blockOneWordLimitUpBuys ? "禁一字涨停买入" : null,
            data.blockLimitDownSells ? "一字跌停卖不出" : null,
            data.enableOneWordLimitDownProbability ? `一字跌停按 ${data.oneWordLimitDownSellProbability}% 概率可卖` : null,
            data.maxPositionAmountRatio > 0 ? `单笔成交额上限 ${data.maxPositionAmountRatio}` : null,
          ].filter((part): part is string => part !== null);
          return parts.length === 0 ? "全部关闭（不施加成交可行性约束）" : parts.join(" · ");
        })(),
        paths: [
          "realistic.blockLimitUpBuys",
          "realistic.blockOneWordLimitUpBuys",
          "realistic.blockLimitDownSells",
          "realistic.enableOneWordLimitDownProbability",
          "realistic.maxPositionAmountRatio",
        ],
      },
    ];
    return rows;
  }, [detail]);

  const explicitKeySet = useMemo(() => new Set(detail?.effectiveSettings.explicitKeys ?? []), [detail]);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-orange-700">
              <BarChart3 className="h-5 w-5" />
              <span className="text-xs font-bold tracking-[0.18em]">FORWARD PAPER TRADING</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">前向纸面交易闭环</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              用真实样本外兜底历史回测：T 日收盘生成次日准备买入清单 → 次日开盘按真实开盘价成交 → 持仓按止盈止损逐日出清 → 累积真实前向曲线，与历史回测对比。
            </p>
            {/* 🔴 口径分叉必须写在页面上：默认参数下纸面与回测**不逐笔等价**，
                含混一句「与回测口径可比」就是 D3 那类「描述了一个不存在的机制」的翻版。 */}
            <p className="mt-2 max-w-3xl text-xs leading-5 text-orange-800">
              与组合回测的差异（逐条声明）：纸面比回测多一条「组合无条件止损」——单票浮亏达「建仓时账户总权益」的设定比例即无条件出清，缺省 3%
              （该规则组合回测不存在，只加在纸面；设为 0 即关闭，可回到与回测仅剩判定时点差异的形态）；
              止损与动态回撤止盈的判定时点可在建仓时选择「开盘 / 收盘 / 开盘+收盘」，组合回测固定为开盘+收盘。
            </p>
          </div>
          <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-right">
            <p className="text-xs text-orange-700">前向口径</p>
            <p className="mt-1 font-semibold text-orange-900">仅使用信号日及以前信息 · 固定权重</p>
          </div>
        </div>
      </section>

      {advanceNotice && (
        <section
          className={`rounded-2xl border p-4 text-sm ${
            advanceNotice.tone === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : advanceNotice.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                advanceNotice.tone === "warning" ? "text-amber-600" : advanceNotice.tone === "success" ? "text-emerald-600" : "text-slate-400"
              }`}
            />
            <p className="leading-6">{advanceNotice.text}</p>
            <button type="button" className="ml-auto shrink-0 text-xs text-slate-400 hover:text-slate-600" onClick={() => setAdvanceNotice(null)}>
              关闭
            </button>
          </div>
        </section>
      )}

      {isAdmin && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Plus className="h-4 w-4 text-orange-700" />
            <h2 className="font-semibold">新建前向运行</h2>
            <span className="text-xs text-slate-400">下列设置写入该运行的参数快照，逐日推进时生效</span>
            <button
              type="button"
              onClick={() => setShowSettings((current) => !current)}
              className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-orange-700"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {showSettings ? "收起策略设置" : "展开策略设置"}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-600">
              运行名称
              <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="如：前向纸面-原始策略" className="mt-1 h-9 w-56 bg-white" />
            </label>
            <label className="text-xs text-slate-600">
              策略
              <select
                value={strategyKey}
                onChange={(event) => setStrategyKey(event.target.value as StrategyKey)}
                className="mt-1 h-9 w-48 rounded-md border border-input bg-white px-3 text-sm"
              >
                {(Object.keys(STRATEGY_LABELS) as StrategyKey[]).map((key) => (
                  <option key={key} value={key}>{STRATEGY_LABELS[key]}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              初始资金（元）
              <Input value={initialCapital} onChange={(event) => setInitialCapital(event.target.value)} className="mt-1 h-9 w-36 bg-white" />
            </label>
            <Button size="sm" className="gap-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700" onClick={onCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              创建
            </Button>
            {showSettings && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-slate-500"
                onClick={() => setSettings(DEFAULT_SETTINGS)}
              >
                恢复默认设置
              </Button>
            )}
          </div>

          {showSettings && (
            <div className="mt-5 grid gap-4 lg:grid-cols-3" data-paper-settings>
              <fieldset className="rounded-xl border border-slate-200 p-3" data-paper-settings-group="exit">
                <legend className="px-1 text-xs font-semibold text-orange-700">退出与止损</legend>
                <div className="grid gap-3">
                  <label className="block text-xs text-slate-600">
                    止损 / 回撤止盈判定时点
                    <select
                      value={settings.exitJudgementPhase}
                      onChange={(event) => updateSetting("exitJudgementPhase", event.target.value as ExitPhase)}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-white px-3 text-sm"
                    >
                      {(Object.keys(EXIT_PHASE_LABELS) as ExitPhase[]).map((phase) => (
                        <option key={phase} value={phase}>{EXIT_PHASE_LABELS[phase]}</option>
                      ))}
                    </select>
                    <span className="mt-1 block text-[10px] font-normal leading-4 text-slate-400">
                      仅控制「止损 / 动态回撤止盈」；强势续持与最多续持永远只在收盘判定
                    </span>
                  </label>
                  {EXIT_FIELDS.map(renderNumberField)}
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-slate-200 p-3" data-paper-settings-group="position">
                <legend className="px-1 text-xs font-semibold text-orange-700">仓位</legend>
                <div className="grid gap-3">
                  <label className="block text-xs text-slate-600">
                    仓位方式
                    <select
                      value={settings.positionSizingStrategy}
                      onChange={(event) => updateSetting("positionSizingStrategy", event.target.value as SizingStrategy)}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-white px-3 text-sm"
                    >
                      {(Object.keys(SIZING_LABELS) as SizingStrategy[]).map((key) => (
                        <option key={key} value={key}>{SIZING_LABELS[key]}</option>
                      ))}
                    </select>
                    <span className="mt-1 block text-[10px] font-normal leading-4 text-slate-400">
                      等权按「现金 ÷ 本批笔数」分配；系统不设单笔仓位上限
                    </span>
                  </label>
                  {POSITION_FIELDS.map(renderNumberField)}
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-slate-200 p-3" data-paper-settings-group="constraint">
                <legend className="px-1 text-xs font-semibold text-orange-700">成交约束</legend>
                <div className="grid gap-3">
                  {CONSTRAINT_TOGGLES.map(renderToggle)}
                  {CONSTRAINT_FIELDS.map(renderNumberField)}
                </div>
              </fieldset>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <WalletCards className="h-4 w-4 text-orange-700" />
          <h2 className="font-semibold">运行列表</h2>
          <span className="ml-auto text-xs text-slate-400">共 {runs.length} 条</span>
        </div>
        {listQuery.isLoading ? (
          <p className="p-6 text-center text-sm text-slate-500">加载中…</p>
        ) : runs.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">暂无前向运行。管理员可创建一条运行开始真实样本外闭环。</p>
        ) : (
          <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[820px] text-xs">
              <thead className="bg-slate-100 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2">运行</th>
                  <th className="px-3 py-2">策略</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">已推进到</th>
                  <th className="px-3 py-2">前向收益</th>
                  <th className="px-3 py-2">最大回撤</th>
                  <th className="px-3 py-2">胜率</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className={`border-t border-slate-100 ${run.id === selectedId ? "bg-orange-50/60" : ""}`}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{run.label}</p>
                      <p className="mt-0.5 text-slate-400">#{run.id}</p>
                    </td>
                    <td className="px-3 py-2">{STRATEGY_LABELS[run.strategyKey] ?? run.strategyKey}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${run.status === "active" ? "bg-emerald-100 text-emerald-700" : run.status === "paused" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>
                        {run.status === "active" ? "进行中" : run.status === "paused" ? "已暂停" : "已结束"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">{run.lastProcessedDate ?? "-"}</td>
                    <td className={`px-3 py-2 font-semibold ${returnTone(run.summary?.totalReturn)}`}>{run.summary?.totalReturn === null || run.summary?.totalReturn === undefined ? "-" : `${run.summary.totalReturn}%`}</td>
                    <td className="px-3 py-2 font-medium text-emerald-700">{run.summary?.maxDrawdown === null || run.summary?.maxDrawdown === undefined ? "-" : `${run.summary.maxDrawdown}%`}</td>
                    <td className="px-3 py-2">{run.summary?.winRate === null || run.summary?.winRate === undefined ? "-" : `${run.summary.winRate}%`}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setSelectedId(run.id)}>查看</Button>
                        {isAdmin && run.status === "active" && (
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => advanceMutation.mutate({ id: run.id })} disabled={advanceMutation.isPending}>
                            <Play className="h-3.5 w-3.5" />推进
                          </Button>
                        )}
                        {isAdmin && (run.status === "active" || run.status === "paused") && (
                          <Button size="sm" variant="ghost" onClick={() => statusMutation.mutate({ id: run.id, status: run.status === "active" ? "paused" : "active" })} disabled={statusMutation.isPending}>
                            {run.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedId !== null && detailQuery.isLoading && (
        <p className="p-6 text-center text-sm text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />加载运行详情…</p>
      )}

      {detail && (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start gap-3">
              <BarChart3 className="mt-0.5 h-5 w-5 text-orange-700" />
              <div className="mr-auto">
                <h2 className="font-semibold">{detail.label} · {STRATEGY_LABELS[detail.strategyKey]}</h2>
                <p className="mt-1 text-xs text-slate-500">初始资金 ¥{detail.initialCapital.toLocaleString()} · 已推进到 {detail.lastProcessedDate ?? "-"} · 状态 {detail.status === "active" ? "进行中" : detail.status === "paused" ? "已暂停" : "已结束"}</p>
              </div>
              {isAdmin && detail.status === "active" && (
                <Button size="sm" variant="outline" className="gap-2" onClick={() => advanceMutation.mutate({ id: detail.id })} disabled={advanceMutation.isPending}>
                  <RefreshCw className={`h-4 w-4 ${advanceMutation.isPending ? "animate-spin" : ""}`} />推进到最新
                </Button>
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="前向总市值" value={`¥${(detail.summary?.finalEquity ?? 0).toLocaleString()}`} />
              <Metric label="前向累计收益" value={detail.summary?.totalReturn === null || detail.summary?.totalReturn === undefined ? "-" : `${detail.summary.totalReturn}%`} tone={returnTone(detail.summary?.totalReturn)} />
              <Metric label="最大回撤" value={detail.summary?.maxDrawdown === null || detail.summary?.maxDrawdown === undefined ? "-" : `${detail.summary.maxDrawdown}%`} tone="text-emerald-700" />
              <Metric label="已出清 / 胜率" value={`${detail.summary?.exitedCount ?? 0} 笔 · ${detail.summary?.winRate === null || detail.summary?.winRate === undefined ? "-" : `${detail.summary.winRate}%`}`} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label="已成交订单" value={String(detail.summary?.filledCount ?? 0)} />
              <Metric label="当前持仓" value={String(detail.summary?.openPositionCount ?? 0)} />
              <Metric label="前向交易日数" value={String(detail.summary?.tradingDayCount ?? 0)} />
            </div>
            {curveData.length > 0 && (
              <div className="mt-5 h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={curveData} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="date" minTickGap={24} tick={{ fontSize: 11, fill: "#64748b" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(value) => `¥${(Number(value) / 1000).toFixed(0)}k`} width={64} />
                    <Tooltip formatter={(value: number) => [`¥${value.toLocaleString()}`, "总市值"]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="equity" name="前向总市值" stroke="#f97316" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-paper-effective-settings>
            <div className="flex flex-wrap items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-orange-700" />
              <h2 className="font-semibold">该运行实际生效的参数</h2>
              <span className="ml-auto text-xs text-slate-400">
                值由服务端按 paramsJson + 缺省回落算出；标「默认」= 该键未显式写入
              </span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {effectiveRows.map((row) => {
                const isExplicit = row.paths.some((path) => explicitKeySet.has(path));
                return (
                  <div key={row.label} className="rounded-xl border border-slate-200 px-3 py-2" data-paper-effective-row={row.label} data-explicit={isExplicit ? "true" : "false"}>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-slate-500">{row.label}</p>
                      <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${isExplicit ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-500"}`}>
                        {isExplicit ? "你设的" : "默认"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{row.value}</p>
                    {row.note && <p className="mt-0.5 text-[10px] leading-4 text-slate-400">{row.note}</p>}
                  </div>
                );
              })}
            </div>
          </section>

          {detail.state.pendingBuys.length > 0 && (
            <section className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <BarChart3 className="mt-0.5 h-5 w-5 text-orange-700" />
                <div>
                  <p className="text-xs font-bold tracking-[0.16em] text-orange-700">NEXT-DAY BUY LIST</p>
                  <h2 className="mt-1 font-semibold">下一交易日准备买入清单</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">以 {detail.state.pendingBuys[0]?.signalDate ?? "-"} 收盘信息生成，按策略优先级排序，未承诺成交。</p>
                </div>
              </div>
              <div className="mt-4 overflow-auto rounded-xl border border-orange-100">
                <table className="w-full min-w-[760px] text-xs">
                  <thead className="bg-orange-50 text-left text-orange-900">
                    <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">股票</th><th className="px-3 py-2">题材</th><th className="px-3 py-2">板数</th><th className="px-3 py-2">策略分</th><th className="px-3 py-2">风险</th><th className="px-3 py-2">信号日收盘</th></tr>
                  </thead>
                  <tbody>
                    {detail.state.pendingBuys.map((buy) => (
                      <tr key={buy.stockCode} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-400">{buy.rank}</td>
                        <td className="px-3 py-2"><p className="font-medium text-slate-800">{buy.stockName}</p><p className="mt-0.5 font-mono text-slate-500">{buy.stockCode}</p></td>
                        <td className="px-3 py-2">{buy.sector}</td>
                        <td className="px-3 py-2">{buy.boards}板</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{buy.strategyScore}</td>
                        <td className="px-3 py-2"><span className={buy.riskTier === "高风险" ? "text-rose-600" : buy.riskTier === "中风险" ? "text-amber-600" : "text-emerald-700"}>{buy.riskTier}</span></td>
                        <td className="px-3 py-2 font-mono">{buy.signalClosePrice ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {detail.state.positions.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <WalletCards className="h-4 w-4 text-orange-700" />
                <h2 className="font-semibold">当前持仓（{detail.state.positions.length}）</h2>
              </div>
              <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="bg-slate-100 text-left text-slate-500">
                    <tr><th className="px-3 py-2">股票</th><th className="px-3 py-2">信号日</th><th className="px-3 py-2">成交日</th><th className="px-3 py-2">成交价</th><th className="px-3 py-2">股数</th><th className="px-3 py-2">成本</th></tr>
                  </thead>
                  <tbody>
                    {detail.state.positions.map((position) => (
                      <tr key={`${position.stockCode}-${position.entryDate}`} className="border-t border-slate-100">
                        <td className="px-3 py-2"><p className="font-medium text-slate-800">{position.stockName}</p><p className="mt-0.5 font-mono text-slate-500">{position.stockCode}</p></td>
                        <td className="px-3 py-2 font-mono">{position.signalDate}</td>
                        <td className="px-3 py-2 font-mono">{position.entryDate}</td>
                        <td className="px-3 py-2 font-mono">{position.entryPrice.toFixed(3)}</td>
                        <td className="px-3 py-2">{position.shares}</td>
                        <td className="px-3 py-2 font-mono">¥{position.capitalCost.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-orange-700" />
              <h2 className="font-semibold">逐笔订单（{orders.length}）</h2>
            </div>
            <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[980px] text-xs">
                <thead className="bg-slate-100 text-left text-slate-500">
                  <tr><th className="px-3 py-2">信号日 / 股票</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">成交日 / 价</th><th className="px-3 py-2">出清日 / 价</th><th className="px-3 py-2">股数</th><th className="px-3 py-2">净收益</th><th className="px-3 py-2">原因</th></tr>
                </thead>
                <tbody>
                  {orders.map((order, index) => (
                    <tr key={`${order.stockCode}-${order.entryDate}-${index}`} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2"><p className="font-medium text-slate-800">{order.stockName}</p><p className="mt-0.5 font-mono text-slate-500">{order.stockCode}</p><p className="mt-0.5 text-slate-400">{order.signalDate}</p></td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${order.status === "exited" ? "bg-slate-200 text-slate-600" : order.status === "filled" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {order.status === "exited" ? "已出清" : order.status === "filled" ? "持仓中" : "未成交"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">{order.entryDate ?? "-"}{order.entryPrice === null ? "" : ` @ ${order.entryPrice}`}</td>
                      <td className="px-3 py-2 font-mono">{order.exitDate ?? "-"}{order.exitPrice === null ? "" : ` @ ${order.exitPrice}`}</td>
                      <td className="px-3 py-2">{order.shares}</td>
                      <td className={`px-3 py-2 font-semibold ${order.netReturn === null ? "text-slate-400" : order.netReturn >= 0 ? "text-rose-600" : "text-emerald-700"}`}>
                        {order.netReturn === null ? "-" : `${order.netReturn}%`}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{order.reason ?? "-"}</td>
                    </tr>
                  ))}
                  {orders.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">暂无订单。</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
