/**
 * FE-7 — Walk-Forward / OOS 过拟合分析（WFO + OOS 隔离 + 过拟合判定）。
 *
 * 展示规格（ROADMAP §48.4 FE-7）：WFO 编排配置 / 逐窗 IS→OOS 分段编排视图 /
 * OOS 汇总指标 / PBO 与参数敏感性过拟合判定。
 *
 * 纪律（§0.2 / §31 / R7 / 前端不是 Quant Engine）：
 * - **只读渲染**：窗口几何、OOS 隔离、PBO/敏感度判定语义全部来自后端引擎
 *   （server/research 下 walkForwardRun C-19.1 / oosIsolation C-19.2 /
 *   overfittingDetection C-20.1），本页**不计算**任何统计、**不自行判定**过拟合；
 * - **技术预览口径（R7，必做）**：评估标量由服务端以生产回测 realisticSimulation
 *   同步查表注入（totalReturnPct / maxDrawdownPct / tradeCount），非 RESEARCH_READY
 *   口径——页面顶部醒目提示条标注「技术预览·非 RESEARCH_READY 口径」；
 * - **诚实空态**：未运行 / 数据未就绪时全 Empty State；失败样本结构化可见（不吞错）；
 * - **视觉隔离是验收点**：每个 fold 条内 OOS（样本外）区与训练（IS）区使用不同
 *   背景色 + 显式标签（slate=训练·样本内；indigo=OOS·样本外），防止误用 OOS 数据训练。
 */

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  FlaskConical,
  GitBranch,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  SectionCard,
  StatusBadge,
  MetricCard,
  EmptyState,
  TechnicalDetails,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { WalkForwardRouter } from "../../../server/walkForwardRouter";

// ---------------------------------------------------------------------------
// 类型：walkForward 端点尚未合并进 appRouter，先用类型断言构造客户端；
// 协调者合并后改回 `trpc.walkForward.*`（预期内的临时类型隔离，同 FE-6/9）。
// ---------------------------------------------------------------------------

type WalkForwardClient = ReturnType<typeof createTRPCReact<WalkForwardRouter>>;
const walkForward = trpc as unknown as WalkForwardClient;

type DescribeOutput = inferRouterOutputs<WalkForwardRouter>["describe"];
type RunOutput = inferRouterOutputs<WalkForwardRouter>["run"];
type OosRun = inferRouterOutputs<WalkForwardRouter>["oos"];
type OverfitRun = inferRouterOutputs<WalkForwardRouter>["overfit"];
type WalkForwardWindow = RunOutput["run"]["windows"][number];

// ---------------------------------------------------------------------------
// 本地回退默认值（与 server/walkForwardRouter.ts 预览常量一致；describe 未返回时使用）
// ---------------------------------------------------------------------------

const FALLBACK_PARAMETER_SPACE: DescribeOutput["defaultParameterSpace"] = {
  parameters: [
    { type: "integer", name: "maxHoldingDays", min: 3, max: 5, step: 2 },
    { type: "number", name: "stopLossPercent", min: 5, max: 8, step: 3 },
  ],
};

const FALLBACK_SPLIT_CONFIG: DescribeOutput["defaultSplitConfig"] = {
  mode: "rolling",
  trainWindow: 20,
  testWindow: 5,
  step: 5,
  gap: 0,
  embargo: 0,
  maxWindows: 6,
};

// ---------------------------------------------------------------------------
// 数值格式化与着色（中国 A 股约定：涨红跌绿）
// ---------------------------------------------------------------------------

const fmtPct = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? "—" : `${v.toFixed(d)}%`;
const fmtNum = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? "—" : v.toFixed(d);
const pnlTone = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : v >= 0 ? "text-rose-600" : "text-emerald-700";

/** 参数集 → 人类可读（键排序 + `k=v`）。 */
function formatParamSet(set: Record<string, number | string | boolean | null> | null | undefined): string {
  if (!set) return "—";
  const parts = Object.keys(set)
    .sort()
    .map((k) => `${k}=${String(set[k])}`);
  return parts.length === 0 ? "∅" : parts.join("，");
}

/** 过拟合聚合结论 → 状态语义色。 */
function overfitStatus(conclusion: string | null | undefined): string {
  switch (conclusion) {
    case "OVERFIT":
      return "FAILED";
    case "OVERFIT_RISK":
      return "WARNING";
    case "NOT_OVERFIT":
      return "SUCCESS";
    case "INCONCLUSIVE":
      return "INCONCLUSIVE";
    default:
      return "NOT_RUN";
  }
}

/** PBO 结论 → 状态语义色。 */
function pboStatus(conclusion: string | null | undefined): string {
  switch (conclusion) {
    case "OVERFIT_RISK_HIGH":
      return "FAILED";
    case "OVERFIT_RISK_MODERATE":
      return "WARNING";
    case "OVERFIT_RISK_LOW":
      return "SUCCESS";
    default:
      return "INCONCLUSIVE";
  }
}

/** 从冻结参数集派生参数敏感性扰动规则（仅数值参数，±2 档）。 */
function sensitivityRules(set: Record<string, number | string | boolean | null>): Array<{
  parameterName: string;
  additiveSteps: number[];
}> {
  return Object.entries(set)
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .map(([name]) => ({ parameterName: name, additiveSteps: [-2, 2] }));
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

export default function WalkForwardAnalysis() {
  const describeQuery = walkForward.describe.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const runMutation = walkForward.run.useMutation();
  const oosMutation = walkForward.oos.useMutation();
  const overfitMutation = walkForward.overfit.useMutation();

  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");

  const [runResult, setRunResult] = useState<RunOutput | null>(null);
  const [oosResult, setOosResult] = useState<OosRun | null>(null);
  const [overfitResult, setOverfitResult] = useState<OverfitRun | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);

  const describe = describeQuery.data ?? null;
  const parameterSpace = describe?.defaultParameterSpace ?? FALLBACK_PARAMETER_SPACE;
  const splitConfig = describe?.defaultSplitConfig ?? FALLBACK_SPLIT_CONFIG;

  const loading =
    runMutation.isPending || oosMutation.isPending || overfitMutation.isPending;

  /** 全链路：WFO → OOS 隔离 → 过拟合检测（一次按钮触发，逐段存结果）。 */
  const runFullFlow = async () => {
    setFlowError(null);
    setRunResult(null);
    setOosResult(null);
    setOverfitResult(null);
    try {
      const runOut = await runMutation.mutateAsync({
        method: "grid",
        parameterSpace,
        splitConfig,
        startDate,
        endDate,
      });
      setRunResult(runOut);

      const oosOut = await oosMutation.mutateAsync({
        walkForwardRun: runOut.run,
        oosEquityCurves: runOut.oosEquityCurves,
      });
      setOosResult(oosOut);

      // 过拟合检测：分区 = 各 succeeded OOS 窗（CSCV 需偶数 >= 4 分区）。
      const succeeded = runOut.run.windows.filter((w) => w.test.status === "succeeded");
      if (succeeded.length >= 4 && succeeded.length % 2 === 0) {
        const partitionRanges = succeeded.map((w) => ({
          startDate: w.test.firstTestDate,
          endDate: w.test.lastTestDate,
        }));
        const baseParameterSet = succeeded[0]?.frozen?.parameterSet ?? null;
        const overfitOut = await overfitMutation.mutateAsync({
          pbo: {
            numPartitions: succeeded.length,
            metric: "totalReturnPct",
            direction: "maximize",
            parameterSpace: runOut.run.parameterSpace,
            partitionRanges,
          },
          ...(baseParameterSet
            ? {
                sensitivity: {
                  baseParameterSet,
                  rules: sensitivityRules(baseParameterSet),
                  startDate: succeeded[0]!.test.firstTestDate,
                  endDate: succeeded[succeeded.length - 1]!.test.lastTestDate,
                },
              }
            : {}),
        });
        setOverfitResult(overfitOut);
      }
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : String(err));
    }
  };

  const run = runResult?.run ?? null;
  const aggregate = run?.aggregate ?? null;
  const windows = run?.windows ?? [];
  const oosSegment = oosResult?.report.oosSegmentAggregate ?? null;
  const freezeIntegrity = run?.freezeIntegrity ?? null;
  const pbo = overfitResult?.pbo ?? null;
  const sensitivity = overfitResult?.parameterSensitivity ?? null;
  const conclusion = overfitResult?.conclusion ?? null;
  const zeroDistribution = pbo?.zeroDistribution ?? null;
  const maxHistogramBin = zeroDistribution
    ? Math.max(...zeroDistribution.histogram, 1)
    : 1;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <FlaskConical className="h-5 w-5" />
          Walk-Forward / OOS 过拟合分析
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          FE-7 · WFO 滚动编排（Train→Optimize→Freeze→Test）+ OOS 隔离纪律 + PBO /
          参数敏感性过拟合判定。数值与判定均来自后端 C-19.1/C-19.2/C-20.1，本页不计算、不判定、不伪造。
        </p>
      </div>

      {/* 技术预览口径（R7，顶部醒目提示） */}
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
        <span className="font-semibold">技术预览·非 RESEARCH_READY 口径：</span>
        评估标量由服务端以生产回测 realisticSimulation 同步查表注入（totalReturnPct /
        maxDrawdownPct / tradeCount），非研究数据链认证口径（R7）；PBO / 敏感性 /
        OOS 聚合结论仅用于观察，不得据此下正式策略结论。
      </div>

      {/* 端点就绪门 */}
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            端点就绪门
            {describeQuery.isLoading ? (
              <StatusBadge status="INFO" label="探测中…" icon={Loader2} />
            ) : describeQuery.isError ? (
              <StatusBadge status="ERROR" label="不可达" />
            ) : (
              <StatusBadge status="SUCCESS" label="已暴露" icon={ShieldCheck} />
            )}
          </span>
        }
        icon={Activity}
        description="walkForwardRouter（C-19.1/19.2/20.1）暴露后本页发起真实编排；引擎仍为 CODE_READY（非 VALIDATED），故结果属技术预览。"
      >
        {describeQuery.isError ? (
          <EmptyState
            icon={ShieldAlert}
            title="后端 WFO / OOS / 过拟合端点不可达"
            description={
              describeQuery.error instanceof Error
                ? describeQuery.error.message
                : String(describeQuery.error)
            }
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            端点已就绪：<span className="font-mono">walkForward.describe</span> /
            <span className="font-mono"> run</span> /{" "}
            <span className="font-mono">oos</span> /{" "}
            <span className="font-mono">overfit</span>。填写回测区间后点击「运行
            Walk-Forward 全链路」即可端到端编排。
          </p>
        )}
      </SectionCard>

      {/* 配置区 */}
      <SectionCard
        title="WFO 编排配置"
        icon={SlidersHorizontal}
        description={
          "单位均为交易日个数（字段取自 walkForwardRun/types.ts WalkForwardSplitConfig）；参数空间维度映射到生产回测可选字段（见 describe.mappableParameters）。"
        }
        right={<StatusBadge status={run ? "SUCCESS" : "NOT_RUN"} label={run ? run.runId : "未运行"} />}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border bg-muted/20 px-3 py-2">
            <p className="font-mono text-[11px] font-medium text-foreground">日期区间</p>
            <div className="mt-1 flex items-center gap-1.5">
              <Input
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-7 font-mono text-[11px]"
                placeholder="YYYY-MM-DD"
              />
              <span className="text-muted-foreground">~</span>
              <Input
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-7 font-mono text-[11px]"
                placeholder="YYYY-MM-DD"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              用于服务端加载交易日历（index_daily）并划分 WFO 窗口。
            </p>
          </div>
          {[
            ["mode", String(splitConfig.mode)],
            ["trainWindow", String(splitConfig.trainWindow)],
            ["testWindow", String(splitConfig.testWindow)],
            ["step", String(splitConfig.step)],
            ["gap / embargo", `${splitConfig.gap ?? 0} / ${splitConfig.embargo ?? 0}`],
            ["maxWindows", String(splitConfig.maxWindows)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border bg-muted/20 px-3 py-2">
              <p className="font-mono text-[11px] font-medium text-foreground">{label}</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
            </div>
          ))}
          <div className="rounded-md border bg-muted/20 px-3 py-2">
            <p className="font-mono text-[11px] font-medium text-foreground">参数空间</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {parameterSpace.parameters.map((p) => p.name).join(" × ")}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={runFullFlow} disabled={loading || describeQuery.isLoading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {loading ? "运行中…" : "运行 Walk-Forward 全链路"}
          </Button>
          {flowError && (
            <p className="max-w-xl text-xs leading-relaxed text-red-700">{flowError}</p>
          )}
        </div>
      </SectionCard>

      {/* 编排视图（核心）：逐窗分段 IS → OOS，视觉隔离 */}
      <SectionCard
        title="编排视图：逐窗分段（IS → OOS）"
        icon={GitBranch}
        description={
          "横向分段展示每个 fold：slate=训练·样本内（IS），indigo=OOS·样本外。OOS 区与训练区底色隔离 + 显式标签，防误用——这是 §48.4 验收点。"
        }
        right={
          <StatusBadge
            status={run ? "SUCCESS" : "NOT_RUN"}
            label={run ? `WFA · ${run.windowCount} folds` : "无 WFO Run"}
          />
        }
      >
        {/* 图例 */}
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm border border-slate-400 bg-slate-100" />
            训练 · 样本内（IS）
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm border border-indigo-400 bg-indigo-100" />
            OOS · 样本外
          </span>
          <span className="ml-auto font-mono">时间轴推进（按 step 逐窗右移）→</span>
        </div>

        {windows.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="尚未运行 WFO"
            description="点击「运行 Walk-Forward 全链路」后，此处按 WalkForwardRun.windows 逐窗渲染真实日期区间、冻结参数与 succeeded/skipped 状态。"
          />
        ) : (
          <div className="space-y-2">
            {windows.map((w) => (
              <FoldStrip key={w.windowId} window={w} />
            ))}
          </div>
        )}

        {/* OOS 纪律说明（PIT：训练绝不使用 OOS 信息） */}
        <div className="mt-4 rounded-md border bg-slate-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            OOS 纪律（PIT 隔离）——语义来自后端，前端只渲染
          </p>
          {freezeIntegrity ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              冻结纪律机器检查（verifyWalkForwardFreezeDiscipline）：
              {freezeIntegrity.passed ? (
                <span className="text-emerald-700">通过（{freezeIntegrity.windowCount} 窗，冻结 {freezeIntegrity.frozenWindowCount}，测试 {freezeIntegrity.testedWindowCount}）</span>
              ) : (
                <span className="text-red-700">
                  失败：{freezeIntegrity.violations.join("；")}
                </span>
              )}
              {oosResult ? (
                <span className="ml-2">
                  · OOS 隔离纪律（verifyOosIsolation）：
                  {oosResult.discipline.passed ? (
                    <span className="text-emerald-700">通过</span>
                  ) : (
                    <span className="text-red-700">失败：{oosResult.discipline.violations.join("；")}</span>
                  )}
                </span>
              ) : null}
            </p>
          ) : null}
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-muted-foreground">
            <li>PIT：窗口只看 T 及之前信息；OOS 段数据/结果严禁参与优化与参数选择。</li>
            <li>冻结：Train 稳定区合格成员取「下中位数」（median-qualified，显式非 argmax），深冻结后仅供 Test 评估。</li>
            <li>结构：Test 段严格晚于 Train 段且集合无重叠；OOS 结果不回写参数。</li>
          </ul>
        </div>
      </SectionCard>

      {/* 结果区 a：OOS 汇总指标 */}
      <SectionCard
        title="OOS 汇总指标"
        icon={BarChart3}
        description={
          "上方：C-19.1 WalkForwardAggregate（一次 WFO 编排自描述最小聚合）；下方：C-19.2 OosSegmentAggregate（基于 OOS 权益曲线 + C-16.1/16.2 的分段完整指标）。两者均不做曲线拼接、不下判定。"
        }
        right={<StatusBadge status={aggregate ? "SUCCESS" : "NOT_RUN"} label={aggregate ? `OOS ${aggregate.testedWindowCount} 窗` : "NO_DATA"} />}
      >
        <p className="mb-2 text-[11px] font-medium text-muted-foreground">
          最小聚合 · WalkForwardAggregate（walkForwardRun）
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          <MetricCard label="OOS 均值收益" value={<span className={pnlTone(aggregate?.meanTestTotalReturnPct)}>{fmtPct(aggregate?.meanTestTotalReturnPct)}</span>} hint="succeeded 窗 test.totalReturnPct 算术均值（%）" />
          <MetricCard label="OOS 中位收益" value={<span className={pnlTone(aggregate?.medianTestTotalReturnPct)}>{fmtPct(aggregate?.medianTestTotalReturnPct)}</span>} hint="下中位数口径（aggregate.ts）" />
          <MetricCard label="OOS 最差 / 最佳窗" value={`${fmtPct(aggregate?.minTestTotalReturnPct)} / ${fmtPct(aggregate?.maxTestTotalReturnPct)}`} hint="minTest / maxTest（%）" />
          <MetricCard label="分段 OOS 累计收益" value={<span className={pnlTone(aggregate?.cumulatedTestReturnPct)}>{fmtPct(aggregate?.cumulatedTestReturnPct)}</span>} hint="各窗 OOS 收益连乘 − 1；分段拼接，非连续净值" />
          <MetricCard label="OOS 均值 / 最大回撤" value={`${fmtPct(aggregate?.meanTestMaxDrawdownPct)} / ${fmtPct(aggregate?.maxTestMaxDrawdownPct)}`} hint="meanTestMaxDrawdown / maxTestMaxDrawdown（%）" />
          <MetricCard label="IS 均值收益" value={<span className={pnlTone(aggregate?.meanTrainTotalReturnPct)}>{fmtPct(aggregate?.meanTrainTotalReturnPct)}</span>} hint="冻结参数在其 Train 段的样本绩效均值（%）" />
          <MetricCard label="IS→OOS 退化" value={<span className={pnlTone(aggregate?.oosDegradationPp)}>{fmtPct(aggregate?.oosDegradationPp)}</span>} hint="meanTest − meanTrain（百分点）；如实呈现，非通过/失败判定" />
          <MetricCard label="计划 / 测试 / 跳过窗" value={aggregate ? `${aggregate.plannedWindowCount} / ${aggregate.testedWindowCount} / ${aggregate.skippedWindowCount}` : "—"} hint="plannedWindowCount / testedWindowCount / skippedWindowCount" />
        </div>

        <p className="mb-2 mt-4 text-[11px] font-medium text-muted-foreground">
          分段完整指标 · OosSegmentAggregate（oosIsolation，需逐窗 OOS 权益曲线）
        </p>
        {oosSegment ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            <MetricCard label="完整评估段数" value={`${oosSegment.assessedSegmentCount} / ${oosSegment.assessedSegmentCount + oosSegment.unassessedSegmentCount}`} hint="assessed / 总段数（有 OOS 权益曲线并经 C-16.1/16.2 评估）" />
            <MetricCard label="分段累计总收益" value={<span className={pnlTone(oosSegment.cumulatedTotalReturnPct)}>{fmtPct(oosSegment.cumulatedTotalReturnPct)}</span>} hint="各 assessed 段 totalReturnPct 连乘 − 1" />
            <MetricCard label="分段 CAGR 均值 / 中位" value={`${fmtPct(oosSegment.meanCagrPct)} / ${fmtPct(oosSegment.medianCagrPct)}`} hint="各段几何 CAGR 的描述性均值 / 下中位数" />
            <MetricCard label="分段 MaxDD 均值 / 最大" value={`${fmtPct(oosSegment.meanMaxDrawdownPct)} / ${fmtPct(oosSegment.maxMaxDrawdownPct)}`} hint="各段最大回撤的均值 / 最大值" />
            <MetricCard label="分段 Sharpe 均值 / 中位" value={`${fmtNum(oosSegment.meanSharpeRatio)} / ${fmtNum(oosSegment.medianSharpeRatio)}`} hint="null 段跳过" />
            <MetricCard label="分段 Sortino 均值" value={fmtNum(oosSegment.meanSortinoRatio)} hint="C-16.2 口径，null 段跳过" />
            <MetricCard label="分段 Calmar 均值" value={fmtNum(oosSegment.meanCalmarRatio)} hint="C-16.2 口径，null 段跳过" />
          </div>
        ) : (
          <EmptyState
            title="暂无分段完整指标"
            description="运行「Walk-Forward 全链路」后，若逐窗 OOS 权益曲线可评估（>= 2 点），此处渲染 C-16.1/16.2 段级指标；无曲线则仅保留上方标量绩效。"
            className="py-8"
          />
        )}
      </SectionCard>

      {/* 结果区 b：过拟合判定（PBO / 参数敏感性） */}
      <SectionCard
        title="过拟合判定"
        icon={ShieldAlert}
        description={
          "PBO（Probability of Backtest Overfitting，CSCV）与参数敏感性的判定。判定词汇（OVERFIT_RISK_HIGH / MODERATE / LOW / INCONCLUSIVE 及聚合 OVERFIT / OVERFIT_RISK / NOT_OVERFIT / INCONCLUSIVE / NO_EVAL）取自 overfittingDetection/types.ts。"
        }
        right={
          conclusion ? (
            <StatusBadge status={overfitStatus(conclusion)} label={conclusion} />
          ) : (
            <StatusBadge status="NOT_RUN" label="待判定" />
          )
        }
      >
        {!overfitResult && !loading ? (
          <EmptyState
            icon={ShieldAlert}
            title="尚未运行过拟合检测"
            description="全链路运行后（需 >= 4 个 succeeded OOS 窗且为偶数，CSCV 切分要求），此处渲染 PBO 概率、零分布直方图与参数敏感性漂移分解。数据不足时引擎显式给出 reasonCode，页面如实展示。"
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid grid-cols-2 gap-3 content-start">
              <MetricCard
                label="PBO 概率"
                value={pbo && pbo.status === "computed" && pbo.pbo !== null ? fmtNum(pbo.pbo, 3) : "—"}
                hint={`倒置率 = overfitCount / evaluatedCombinations（阈值 pboHigh=${overfitResult?.thresholds.pboHigh} / pboMedium=${overfitResult?.thresholds.pboMedium}）`}
              />
              <MetricCard
                label="PBO 评估划分数"
                value={pbo && pbo.status === "computed" ? `${pbo.evaluatedCombinations} / ${pbo.numCombinations}` : "—"}
                hint="OfdPboResult.evaluatedCombinations / numCombinations"
              />
              <MetricCard
                label="PBO 判定"
                value={
                  pbo ? (
                    <StatusBadge status={pboStatus(pbo.conclusion)} label={pbo.conclusion} className="text-sm" />
                  ) : (
                    "—"
                  )
                }
                hint={`倒置观察 ${pbo ? pbo.overfitCount : "—"} 次`}
              />
              <MetricCard
                label="敏感 / 稳定样本"
                value={sensitivity ? `${sensitivity.measure.sensitiveNonBaselineCount} / ${sensitivity.measure.stableNonBaselineCount}` : "—"}
                hint="ParameterSensitivityMeasure.sensitiveNonBaselineCount / stableNonBaselineCount"
              />
              <MetricCard
                label="最大收益漂移"
                value={<span className={pnlTone(sensitivity ? -(sensitivity.measure.maxReturnDriftPct ?? 0) : undefined)}>{fmtPct(sensitivity?.measure.maxReturnDriftPct)}</span>}
                hint="|ΔtotalReturnPct| 最大绝对值；阈值 5pp（C-18.1）"
              />
              <MetricCard
                label="最大回撤恶化"
                value={fmtPct(sensitivity?.measure.maxDrawdownWorseningPct)}
                hint="max(0, ΔmaxDrawdownPct)；阈值 3pp（C-18.1）"
              />
              <MetricCard
                label="参数敏感性判定"
                value={sensitivity ? sensitivity.conclusion : "—"}
                hint={sensitivity?.reasonCode ? `reasonCode=${sensitivity.reasonCode}` : "SENSITIVE / STABLE / INCONCLUSIVE / NO_VARIANTS"}
              />
            </div>

            {/* PBO 零分布直方图 + 结论理由 */}
            <div className="space-y-3">
              {zeroDistribution ? (
                <div className="rounded-md border bg-card p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    PBO 零分布直方图（10-bin，testPercentile 分位）
                  </p>
                  <div className="flex h-24 items-end gap-0.5">
                    {zeroDistribution.histogram.map((count, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-sm bg-indigo-200"
                        style={{ height: `${count === 0 ? 2 : Math.max(4, (count / maxHistogramBin) * 100)}%` }}
                        title={`bin ${i}：${count}`}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    倒置率 {fmtNum(zeroDistribution.overfitRate, 3)}（{zeroDistribution.overfitCount}/{zeroDistribution.evaluatedCombinations}）
                    {pbo?.quantileCi
                      ? ` · 分位 CI ${fmtNum(pbo.quantileCi.lower, 3)} ~ ${fmtNum(pbo.quantileCi.upper, 3)}`
                      : ""}
                  </p>
                </div>
              ) : null}

              {overfitResult?.reasons && overfitResult.reasons.length > 0 ? (
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">判定理由（优先级倒序）</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
                    {overfitResult.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </SectionCard>

      {/* 工程信息：字段字典 + 联调清单（折叠） */}
      <TechnicalDetails title="技术详情：FE-7 契约字典与联调清单（只读）">
        <ul className="space-y-1 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <li>【端点】server/walkForwardRouter.ts：describe / run（C-19.1）/ oos（C-19.2）/ overfit（C-20.1）</li>
          <li>【窗口配置】WalkForwardSplitConfig（mode rolling|anchored / trainWindow / testWindow / step / gap / embargo / maxWindows，单位交易日）</li>
          <li>【逐窗记录】WalkForwardWindowRecord：train（firstTrainDate / lastTrainDate / searchRun）+ frozen（parameterSetKey / selection=median-qualified / trainTotalReturnPct）+ test（status=succeeded|skipped / totalReturnPct / maxDrawdownPct / skipReasonCode）</li>
          <li>【OOS 隔离】WindowTrainResult / WindowTestResult（除身份键外键集合无交集）；discipline.ts verifyOosIsolation；record.ts assertOosEquityCurveContainedInTest</li>
          <li>【OOS 聚合】computeWalkForwardAggregate（meanTest / medianTest / min|maxTest / cumulatedTestReturnPct / oosDegradationPp）+ OosSegmentAggregate（CAGR/Sharpe/Sortino/Calmar）</li>
          <li>【PBO/敏感度】OfdPboResult（pbo / overfitCount / evaluatedCombinations / conclusion / zeroDistribution.histogram / quantileCi）+ ParameterSensitivityMeasure；assess.ts 优先级 NO_EVAL→INCONCLUSIVE→OVERFIT→OVERFIT_RISK→NOT_OVERFIT</li>
          <li>【runId】WFA-* · OOSISO-* · OFA-*；recordKind / recordVersion / fingerprint（sha256）</li>
          <li>【纪律】本页不计算指标、不生成曲线；OOS 分区配色仅为防误用布局语义；技术预览口径已顶部醒目标注（R7）</li>
        </ul>
      </TechnicalDetails>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 单 fold 分段条（IS slate / OOS indigo 视觉隔离）
// ---------------------------------------------------------------------------

function FoldStrip({ window }: { window: WalkForwardWindow }) {
  const succeeded = window.test.status === "succeeded";
  return (
    <div className="rounded-lg border border-slate-300 bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold text-foreground">
          fold {window.windowId}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">
            冻结参数：{formatParamSet(window.frozen?.parameterSet)}
          </span>
          <StatusBadge
            status={succeeded ? "SUCCESS" : "SKIPPED"}
            label={succeeded ? "OOS 已评估" : window.test.skipReasonCode ?? "skipped"}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row">
        {/* 训练 · 样本内（slate） */}
        <div className="flex-1 rounded-md border border-slate-300 bg-slate-100 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-sm bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
              训练 · 样本内 IS
            </span>
            <span className="text-[11px] text-slate-600">
              优化 {window.train.optimizationDayCount} 日（embargo {window.train.embargoDayCount} 日）
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-slate-700">
            {window.train.firstTrainDate} ~ {window.train.lastTrainDate}
            <span className="ml-1 text-slate-500">（{window.train.trainDayCount} 交易日）</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            IS 绩效：收益 {fmtPct(window.frozen?.trainTotalReturnPct)} · 回撤 {fmtPct(window.frozen?.trainMaxDrawdownPct)} · 交易 {window.frozen?.trainTradeCount ?? "—"}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            稳定区结论：{window.frozen?.regionVerdict ?? "无冻结参数"}（合格成员 {window.frozen?.qualifiedMemberCount ?? 0}）
          </p>
        </div>

        {/* OOS · 样本外（indigo） */}
        <div className="w-full rounded-md border border-indigo-300 bg-indigo-50 p-3 lg:w-2/5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-sm bg-indigo-200 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-900">
              <AlertTriangle className="h-3 w-3 text-amber-600" />
              OOS · 样本外
            </span>
            <span className="text-[11px] text-indigo-700">仅评估冻结参数 · 禁用于训练 · 不回写</span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-indigo-700">
            {window.test.firstTestDate} ~ {window.test.lastTestDate}
            <span className="ml-1 text-indigo-500">（{window.test.testDayCount} 交易日）</span>
          </p>
          {succeeded ? (
            <p className="mt-1 text-[11px] text-indigo-800">
              OOS 绩效：收益 <span className={pnlTone(window.test.totalReturnPct)}>{fmtPct(window.test.totalReturnPct)}</span> · 回撤 {fmtPct(window.test.maxDrawdownPct)} · 交易 {window.test.tradeCount ?? "—"}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-indigo-500">
              {window.test.error ?? "未评估（无冻结参数或 OOS 段不可评估）"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
