/**
 * FE-6 — 参数搜索 + 鲁棒性（Parameter Search & Robustness）。
 *
 * 展示规格（ROADMAP §48.4 FE-6）：Grid / Random / Rolling 参数搜索 +
 * 稳定区结论 + 候选参数表 + C-18.1 四轴扰动鲁棒性报告 + C-18.2 随机化鲁棒性分布。
 *
 * 纪律（§0.2 / §31 / R7 / 前端不是 Quant Engine）：
 * - **只读渲染**：数值一律来自后端 paramSearch.* 端点（C-17.1 runParameterSearch /
 *   C-17.2 runRollingOptimization / C-18.1 runRobustnessStress /
 *   C-18.2 runStochasticRobustness），本页不计算任何指标、不生成曲线、不伪造样例；
 * - **技术预览口径（R7，必做）**：评估标量由服务端以生产回测 realisticSimulation
 *   同步查表注入（totalReturnPct / maxDrawdownPct / tradeCount），非 RESEARCH_READY
 *   口径——页面顶部醒目提示条标注「技术预览·非 RESEARCH_READY 口径」；
 * - **诚实空态**：未运行 / 数据未就绪时全 Empty State；失败样本结构化可见（不吞错）；
 * - **字段字典取真实引擎契约**：列名 / verdict 词汇 / 配置默认值逐字取自
 *   server/research/parameterSearch|rollingOptimization|robustness|
 *   stochasticRobustness 类型与常量（见 TechnicalDetails 来源清单）。
 */

import { useState } from "react";
import {
  Dices,
  Loader2,
  Map as MapIcon,
  Play,
  Radar,
  Search,
  Shield,
  ShieldCheck,
  Table2,
  TriangleAlert,
} from "lucide-react";
import {
  SectionCard,
  StatusBadge,
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
import type { ParamSearchRouter } from "../../../server/paramSearchRouter";

// ---------------------------------------------------------------------------
// 类型：paramSearch 端点尚未合并进 appRouter，先用类型断言构造客户端；
// 协调者合并后改回 `trpc.paramSearch.*`（预期内的临时类型隔离）。
// ---------------------------------------------------------------------------

type ParamSearchClient = ReturnType<typeof createTRPCReact<ParamSearchRouter>>;
const paramSearch = trpc as unknown as ParamSearchClient;

type DescribeOutput = inferRouterOutputs<ParamSearchRouter>["describe"];
type SearchRun = inferRouterOutputs<ParamSearchRouter>["run"];
type RollingRun = inferRouterOutputs<ParamSearchRouter>["rolling"];
type RobustnessRun = inferRouterOutputs<ParamSearchRouter>["robustness"];
type StochasticRun = inferRouterOutputs<ParamSearchRouter>["stochastic"];

// ---------------------------------------------------------------------------
// 受控词表（逐字取自引擎契约）
// ---------------------------------------------------------------------------

/** 搜索模式 key：grid / random 对应 C-17.1 单期；rolling 对应 C-17.2 时间滚动窗。 */
type SearchMode = "grid" | "random" | "rolling";

const SEARCH_MODES: { key: SearchMode; label: string; hint: string }[] = [
  { key: "grid", label: "Grid", hint: "C-17.1：ParameterSpace 全组合枚举（确定性顺序）。" },
  { key: "random", label: "Random", hint: "C-17.1：seedable PRNG 无放回采样（同 seed 同结果）。" },
  { key: "rolling", label: "Rolling", hint: "C-17.2：交易日序列逐窗复用搜索，跨窗一致性判定。" },
];

const ROBUSTNESS_AXES: { key: string; label: string }[] = [
  { key: "cost", label: "成本轴" },
  { key: "slippage", label: "滑点轴" },
  { key: "parameter", label: "参数轴" },
  { key: "execution", label: "执行轴" },
];

const STOCHASTIC_METHODS: { key: string; label: string }[] = [
  { key: "monteCarlo", label: "蒙特卡洛重采样" },
  { key: "bootstrap", label: "Bootstrap 重抽样" },
  { key: "orderRandomization", label: "成交顺序随机化" },
];

// ---------------------------------------------------------------------------
// 数值格式化与着色
// ---------------------------------------------------------------------------

const fmtPct = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? "—" : `${v.toFixed(d)}%`;
const fmtNum = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? "—" : v.toFixed(d);
const pnlTone = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : v >= 0 ? "text-rose-600" : "text-emerald-700";

/** 参数集 → 人类可读（键排序 + `k=v`）。 */
function formatParamSet(set: Record<string, number | string | boolean | null> | undefined): string {
  if (!set) return "—";
  const parts = Object.keys(set)
    .sort()
    .map((k) => `${k}=${String(set[k])}`);
  return parts.length === 0 ? "∅" : parts.join("，");
}

/** SweepParameterDefinition → 范围描述（用于参数空间表）。 */
function describeSweepParam(p: DescribeOutput["defaultParameterSpace"]["parameters"][number]): string {
  if (p.type === "number" || p.type === "integer") {
    return `${p.min} ~ ${p.max}（step ${p.step}）`;
  }
  if (p.type === "boolean") {
    return (p.values ?? [true, false]).map(String).join(" / ");
  }
  return p.values.join(" / ");
}

/** 离散取值（用于 2D 稳定区热力图；number/integer 按 min..max step 展开）。 */
function sweepDiscreteValues(
  p: DescribeOutput["defaultParameterSpace"]["parameters"][number],
): (number | string | boolean)[] {
  if (p.type === "boolean") return p.values ?? [true, false];
  if (p.type === "enum") return p.values;
  const values: number[] = [];
  if (!Number.isFinite(p.step) || p.step <= 0) return [];
  for (let v = p.min; v <= p.max + 1e-9; v += p.step) values.push(v);
  return values;
}

// ---------------------------------------------------------------------------
// verdict → 状态色（仅展示映射，不参与量化判定）
// ---------------------------------------------------------------------------

const regionVerdictStatus = (v: string) =>
  v === "stable" ? "SUCCESS"
    : v === "degraded-bad-point-rate" ? "WARNING"
      : "INCONCLUSIVE";

const rollingVerdictStatus = (v: string) =>
  v === "stable-across-windows" ? "SUCCESS"
    : v === "no-consistent-parameters" ? "WARNING"
      : "INCONCLUSIVE";

const axisVerdictStatus = (v: string) =>
  v === "stable" ? "SUCCESS" : v === "sensitive" ? "WARNING" : "INCONCLUSIVE";

const sampleVerdictStatus = (v: string) =>
  v === "stable" ? "SUCCESS"
    : v === "sensitive" ? "WARNING"
      : v === "baseline" ? "INFO"
        : "ERROR";

const stochasticVerdictStatus = (v: string) =>
  v === "stable" ? "SUCCESS" : v === "sensitive" ? "WARNING" : "INCONCLUSIVE";

/** 2D 稳定区热力图单元格着色（涨红跌绿，深浅按收益幅度）。 */
function heatCellStyle(returnPct: number | null, failed: boolean): React.CSSProperties {
  if (failed || returnPct === null) {
    return { background: "#f1f5f9", color: "#94a3b8" };
  }
  const intensity = Math.min(1, Math.abs(returnPct) / 10);
  return returnPct >= 0
    ? { background: `rgba(244,63,94,${(0.12 + 0.5 * intensity).toFixed(3)})`, color: "#9f1239" }
    : { background: `rgba(16,185,129,${(0.12 + 0.5 * intensity).toFixed(3)})`, color: "#047857" };
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

export default function ParameterSearch() {
  const [mode, setMode] = useState<SearchMode>("grid");
  const [searchSeed, setSearchSeed] = useState("42");
  const [axis, setAxis] = useState<string>("cost");
  const [stochMethod, setStochMethod] = useState<string>("monteCarlo");
  const [stochSeed, setStochSeed] = useState("1");
  const [stochIterations, setStochIterations] = useState("500");

  const [searchError, setSearchError] = useState<string | null>(null);
  const [robError, setRobError] = useState<string | null>(null);
  const [stochError, setStochError] = useState<string | null>(null);

  const describeQuery = paramSearch.describe.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const runMutation = paramSearch.run.useMutation();
  const rollMutation = paramSearch.rolling.useMutation();
  const robMutation = paramSearch.robustness.useMutation();
  const stochMutation = paramSearch.stochastic.useMutation();
  // 生产回测：仅用于 rolling 模式推导交易日序列（技术预览数据源）。
  const backtestQuery = trpc.sentiment.getLeaderCandidateBacktest.useQuery(undefined, {
    enabled: false,
  });

  const describe = describeQuery.data ?? null;
  const searchRun: SearchRun | null = runMutation.data ?? null;
  const rollingRun: RollingRun | null = rollMutation.data ?? null;
  const robustnessRun: RobustnessRun | null = robMutation.data ?? null;
  const stochasticRun: StochasticRun | null = stochMutation.data ?? null;

  const searchLoading = runMutation.isPending || rollMutation.isPending;
  const activeSearchRun = mode === "rolling" ? rollingRun : searchRun;

  const parseIntInput = (raw: string, fallback: number): number => {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const runSearch = async () => {
    setSearchError(null);
    if (!describe) return;
    const space = describe.defaultParameterSpace;
    if (mode === "rolling") {
      const res = await backtestQuery.refetch();
      const dates = Array.from(
        new Set((res.data?.realisticSimulation.equityCurve ?? []).map((p) => p.date)),
      ).sort();
      if (dates.length < 2) {
        setSearchError("交易日序列不足（equityCurve 日期 < 2），无法进行滚动优化。");
        return;
      }
      const windowLength = Math.max(2, Math.floor(dates.length / 3));
      rollMutation.mutate({
        method: "grid",
        parameterSpace: space,
        tradeDates: dates,
        windowConfig: { windowLength, stepLength: windowLength, maxWindows: null },
      });
      return;
    }
    runMutation.mutate({
      method: mode,
      parameterSpace: space,
      ...(mode === "random" ? { seed: parseIntInput(searchSeed, 42) } : {}),
    });
  };

  const runRobustness = () => {
    setRobError(null);
    robMutation.mutate({ axis: axis as "cost" | "slippage" | "parameter" | "execution" });
  };

  const runStochastic = () => {
    setStochError(null);
    stochMutation.mutate({
      method: stochMethod as "monteCarlo" | "bootstrap" | "orderRandomization",
      seed: parseIntInput(stochSeed, 1),
      ...(stochIterations.trim() !== ""
        ? { iterations: parseIntInput(stochIterations, 500) }
        : {}),
    });
  };

  const runErr = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Radar className="h-5 w-5" />
          参数搜索 + 鲁棒性
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          FE-6 · Grid / Random / Rolling 搜索、稳定参数区、候选参数，与 C-18.1 四轴扰动 /
          C-18.2 随机化鲁棒性报告。数值一律来自后端 paramSearch.* 端点，本页不计算、不伪造。
        </p>
      </div>

      {/* R7 技术预览提示条（醒目，必做） */}
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <span className="font-semibold">技术预览 · 非 RESEARCH_READY 口径（R7 隔离）。</span>
          {" "}
          评估标量由服务端以生产回测 realisticSimulation 同步查表注入（totalReturnPct /
          maxDrawdownPct / tradeCount），参数空间组合数上限{" "}
          {describe?.preview.maxCombinations ?? 64}；仅用于观察研究引擎口径，不得据此下正式策略结论。
        </span>
      </div>

      {/* ---- 搜索配置 + 结果 ---- */}
      <SectionCard
        title="参数搜索"
        description="C-17.1 Grid / Random 单期搜索 + C-17.2 Rolling 滚动优化；参数空间取 describe 默认（2 维 × 2 档 = 4 组合，保证预计算可交互）。"
        icon={Search}
        right={
          <Button size="sm" onClick={runSearch} disabled={!describe || searchLoading}>
            {searchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {searchLoading ? "搜索中…" : "开始搜索"}
          </Button>
        }
      >
        <div className="space-y-4">
          {/* 模式 + 随机种子 */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">搜索模式</p>
              <div role="radiogroup" aria-label="搜索模式" className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
                {SEARCH_MODES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.key}
                    onClick={() => setMode(m.key)}
                    className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      mode === m.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {SEARCH_MODES.find((m) => m.key === mode)?.hint}
              </p>
            </div>
            {mode === "random" && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">随机种子（seed）</p>
                <Input
                  value={searchSeed}
                  onChange={(e) => setSearchSeed(e.target.value)}
                  className="h-8 w-24 font-mono text-xs"
                />
              </div>
            )}
          </div>

          {/* 参数空间（describe 默认） */}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              参数空间（describe.defaultParameterSpace；字段取自 SweepParameterDefinition）
            </p>
            {describe ? (
              <DataTable maxHeight={160}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">参数名</TableHead>
                    <TableHead className="text-xs">类型</TableHead>
                    <TableHead className="text-xs">范围 / 取值</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {describe.defaultParameterSpace.parameters.map((p, i) => (
                    <TableRow key={`${p.name}-${i}`}>
                      <TableCell className="font-mono text-xs">{p.name}</TableCell>
                      <TableCell className="text-xs">{p.type}</TableCell>
                      <TableCell className="font-mono text-xs">{describeSweepParam(p)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            ) : (
              <EmptyState
                title={describeQuery.isError ? "describe 加载失败" : "加载参数空间…"}
                description={describeQuery.isError ? runErr(describeQuery.error) : "正在读取引擎配置默认值。"}
                className="py-6"
              />
            )}
          </div>

          {searchError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{searchError}</div>
          )}
          {runMutation.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {runErr(runMutation.error)}
            </div>
          )}
          {rollMutation.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {runErr(rollMutation.error)}
            </div>
          )}

          {/* 结果 */}
          {activeSearchRun === null ? (
            <EmptyState
              icon={MapIcon}
              title="尚未运行搜索"
              description="点击「开始搜索」后，此处渲染稳定区结论、被评样本与候选参数表。"
              className="py-8"
            />
          ) : mode === "rolling" ? (
            <RollingResult run={rollingRun!} />
          ) : (
            <SearchResult run={searchRun!} />
          )}
        </div>
      </SectionCard>

      {/* ---- 鲁棒性（四轴） ---- */}
      <SectionCard
        title="确定性扰动鲁棒性（C-18.1 四轴）"
        description="逐轴生成「基准 + 单改变体」，服务端预计算回测后做漂移敏感归因（收益 |Δ| > 5pp / 回撤恶化 > 3pp）。"
        icon={Shield}
        right={
          <Button size="sm" onClick={runRobustness} disabled={robMutation.isPending}>
            {robMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            运行鲁棒性
          </Button>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">扰动轴（单选，逐轴独立成 run）</p>
            <div role="radiogroup" aria-label="扰动轴" className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1">
              {ROBUSTNESS_AXES.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  role="radio"
                  aria-checked={axis === a.key}
                  onClick={() => setAxis(a.key)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    axis === a.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {a.label}
                  <span className="font-mono text-[10px] text-muted-foreground">axis={a.key}</span>
                </button>
              ))}
            </div>
          </div>

          {robError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{robError}</div>
          )}
          {robMutation.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{runErr(robMutation.error)}</div>
          )}

          {robustnessRun === null ? (
            <EmptyState
              icon={ShieldCheck}
              title="尚未运行鲁棒性"
              description="点击「运行鲁棒性」后，此处渲染轴级结论（verdict / sensitiveEntries）与逐扰动样本表。"
              className="py-8"
            />
          ) : (
            <RobustnessResult run={robustnessRun} />
          )}
        </div>
      </SectionCard>

      {/* ---- 随机化鲁棒性（C-18.2） ---- */}
      <SectionCard
        title="随机化鲁棒性（C-18.2）"
        description="Monte Carlo / Bootstrap / Trade Order 三法，seeded 重采样经验分布 + 尾部概率 + 基准相对位置（i.i.d. 假设，非假设检验）。"
        icon={Dices}
        right={
          <Button size="sm" onClick={runStochastic} disabled={stochMutation.isPending}>
            {stochMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            运行随机化
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">方法</p>
              <div role="radiogroup" aria-label="随机化方法" className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1">
                {STOCHASTIC_METHODS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={stochMethod === m.key}
                    onClick={() => setStochMethod(m.key)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      stochMethod === m.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">种子（seed）</p>
              <Input value={stochSeed} onChange={(e) => setStochSeed(e.target.value)} className="h-8 w-24 font-mono text-xs" />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">迭代次数（iterations，默认 500）</p>
              <Input value={stochIterations} onChange={(e) => setStochIterations(e.target.value)} className="h-8 w-24 font-mono text-xs" />
            </div>
          </div>

          {stochError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{stochError}</div>
          )}
          {stochMutation.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{runErr(stochMutation.error)}</div>
          )}

          {stochasticRun === null ? (
            <EmptyState
              icon={Dices}
              title="尚未运行随机化"
              description="点击「运行随机化」后，此处渲染三指标经验分布、尾部概率与结论（verdict / flags / interpretation）。"
              className="py-8"
            />
          ) : (
            <StochasticResult run={stochasticRun} />
          )}
        </div>
      </SectionCard>

      {/* 工程信息：字段字典（折叠） */}
      <TechnicalDetails title="技术详情：FE-6 字段字典（引擎契约 1:1）与联调清单">
        <ul className="space-y-1 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <li>端点：paramSearch.describe / run / rolling / robustness / stochastic（server/paramSearchRouter.ts）</li>
          <li>评估标量桥：搜索消费 ParameterSearchMetricsView（totalReturnPct / maxDrawdownPct / tradeCount）；随机化消费 StochasticMetricsView（另含 sharpe）</li>
          <li>C-17.1：ParameterSearchRun（region 四值 verdict / evaluatedSamples / candidates）；默认 DEFAULT_REGION_ANALYSIS_CONFIG（minReturnPct 0 / maxDrawdownPct 15 / maxBadPointRatePct 50 / requireStableCandidates true）</li>
          <li>C-17.2：RollingOptimizationRun（stability 三值 verdict / parameters / candidates）；DEFAULT_ROLLING_STABILITY_CONFIG（minEvaluatedWindows 2）</li>
          <li>C-18.1：RobustnessRun（axis / samples / conclusion）；阈值 returnDriftThresholdPct 5 / drawdownWorseningThresholdPct 3；sample verdict = baseline | stable | sensitive | failed</li>
          <li>C-18.2：StochasticRobustnessRun（method / seed / distribution / tailProbabilities / conclusion）；默认 iterations 500 / alpha 0.05 / tailDrawdownThresholdPct 20 / minIterationsForVerdict 30</li>
          <li>纪律：本页不计算指标、不生成曲线、不缓存假样例；端点暴露后数值即填、空态即让位。技术预览口径已顶部醒目标注（R7）</li>
        </ul>
      </TechnicalDetails>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 结果子组件
// ---------------------------------------------------------------------------

function SearchResult({ run }: { run: SearchRun }) {
  const region = run.region;
  const params = run.parameterSpace.parameters;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">稳定区结论：</span>
        <StatusBadge status={regionVerdictStatus(region.verdict)} label={region.verdict} />
        <span className="font-mono text-[10px] text-muted-foreground">searchRunId={run.searchRunId}</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          sample {run.sampleCount} / {run.combinationCount}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="被评样本" value={region.evaluatedCount} hint={`成功 ${region.succeededCount} / 失败 ${region.failedCount}`} />
        <MetricCard label="合格样本" value={region.qualifiedCount} hint={`低收益 ${region.lowReturnCount}`} />
        <MetricCard label="坏点" value={region.badDrawdownCount} hint={`坏点率 ${fmtPct(region.badPointRatePct, 1)}`} />
        <MetricCard
          label="区域均值收益"
          value={<span className={pnlTone(region.aggregate?.meanTotalReturnPct)}>{fmtPct(region.aggregate?.meanTotalReturnPct)}</span>}
          hint={`中位 ${fmtPct(region.aggregate?.medianTotalReturnPct)}`}
        />
      </div>

      {/* 2D 稳定区热力图（默认 2 维参数空间时渲染） */}
      {params.length === 2 && (
        <Heatmap run={run} />
      )}

      {/* 候选参数表 */}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          候选参数（candidates；strategyKind=candidate，非 production）
        </p>
        {run.candidates.length === 0 ? (
          <EmptyState icon={Table2} title="无候选参数" description={region.candidatesSuppressed ? "合格样本充足但被坏点率 / requireStableCandidates 抑制产出。" : "稳定区未成立（verdict ≠ stable）或合格样本不足。"} className="py-6" />
        ) : (
          <DataTable maxHeight={260}>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">candidateId</TableHead>
                <TableHead className="text-xs">parameterSet</TableHead>
                <TableHead className="text-xs">totalReturnPct</TableHead>
                <TableHead className="text-xs">maxDrawdownPct</TableHead>
                <TableHead className="text-xs">tradeCount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.candidates.map((c) => (
                <TableRow key={c.candidateId}>
                  <TableCell className="font-mono text-xs">{c.candidateId}</TableCell>
                  <TableCell className="font-mono text-xs">{formatParamSet(c.parameterSet)}</TableCell>
                  <TableCell className={`text-xs ${pnlTone(c.performance.totalReturnPct)}`}>{fmtPct(c.performance.totalReturnPct)}</TableCell>
                  <TableCell className="text-xs text-emerald-700">{fmtPct(c.performance.maxDrawdownPct)}</TableCell>
                  <TableCell className="text-xs">{c.performance.tradeCount ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </DataTable>
        )}
      </div>

      {/* 被评样本表 */}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">被评样本（evaluatedSamples）</p>
        <DataTable maxHeight={260}>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">parameterSet</TableHead>
              <TableHead className="text-xs">status</TableHead>
              <TableHead className="text-xs">totalReturnPct</TableHead>
              <TableHead className="text-xs">maxDrawdownPct</TableHead>
              <TableHead className="text-xs">tradeCount</TableHead>
              <TableHead className="text-xs">error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.evaluatedSamples.map((s, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{formatParamSet(s.parameterSet)}</TableCell>
                <TableCell><StatusBadge status={s.status === "succeeded" ? "SUCCESS" : "ERROR"} label={s.status} /></TableCell>
                <TableCell className={`text-xs ${pnlTone(s.totalReturnPct)}`}>{fmtPct(s.totalReturnPct)}</TableCell>
                <TableCell className="text-xs text-emerald-700">{fmtPct(s.maxDrawdownPct)}</TableCell>
                <TableCell className="text-xs">{s.tradeCount ?? "—"}</TableCell>
                <TableCell className="text-xs text-red-600">{s.error ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
      </div>
    </div>
  );
}

/** 2D 稳定区热力图（仅两维参数空间；格子 = 对应参数组合的 totalReturnPct）。 */
function Heatmap({ run }: { run: SearchRun }) {
  const [d1, d2] = run.parameterSpace.parameters;
  if (!d1 || !d2) return null;
  const vals1 = sweepDiscreteValues(d1 as DescribeOutput["defaultParameterSpace"]["parameters"][number]);
  const vals2 = sweepDiscreteValues(d2 as DescribeOutput["defaultParameterSpace"]["parameters"][number]);
  const sampleByKey = new Map<string, SearchRun["evaluatedSamples"][number]>();
  for (const s of run.evaluatedSamples) {
    const key = `${String(s.parameterSet[d1.name])}|${String(s.parameterSet[d2.name])}`;
    sampleByKey.set(key, s);
  }
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        稳定区热力图（{d1.name} × {d2.name}；格子数值 = totalReturnPct）
      </p>
      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-center text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-muted px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                {d2.name} ↓ / {d1.name} →
              </th>
              {vals1.map((v) => (
                <th key={String(v)} className="bg-muted px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{String(v)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vals2.map((v2) => (
              <tr key={String(v2)}>
                <td className="sticky left-0 bg-muted px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{String(v2)}</td>
                {vals1.map((v1) => {
                  const s = sampleByKey.get(`${String(v1)}|${String(v2)}`);
                  const failed = !s || s.status === "failed";
                  return (
                    <td key={String(v1)} style={heatCellStyle(s?.totalReturnPct ?? null, failed)} className="px-2 py-1.5 font-mono tabular-nums">
                      {failed ? "✕" : fmtNum(s!.totalReturnPct)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RollingResult({ run }: { run: RollingRun }) {
  const stability = run.stability;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">跨窗一致性：</span>
        <StatusBadge status={rollingVerdictStatus(stability.verdict)} label={stability.verdict} />
        <span className="font-mono text-[10px] text-muted-foreground">runId={run.runId}</span>
        <span className="font-mono text-[10px] text-muted-foreground">窗口 {run.windowCount}（windowLength {run.windowConfig.windowLength}）</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="窗口数" value={stability.windowCount} />
        <MetricCard label="去重参数集" value={stability.uniqueParameterCount} hint={`至少一窗合格 ${stability.everQualifiedParameterCount}`} />
        <MetricCard label="跨窗一致参数" value={stability.consistentParameterCount} />
        <MetricCard
          label="一致集收益均值"
          value={<span className={pnlTone(stability.aggregate?.meanTotalReturnPct)}>{fmtPct(stability.aggregate?.meanTotalReturnPct)}</span>}
          hint={`中位 ${fmtPct(stability.aggregate?.medianTotalReturnPct)}`}
        />
      </div>

      {/* 参数跨窗一致性统计 */}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">跨窗参数统计（parameters）</p>
        {stability.parameters.length === 0 ? (
          <EmptyState icon={Table2} title="无被考察参数" description="各窗均无合格样本。" className="py-6" />
        ) : (
          <DataTable maxHeight={260}>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">parameterSet</TableHead>
                <TableHead className="text-xs">合格/被评窗</TableHead>
                <TableHead className="text-xs">qualifiedRate</TableHead>
                <TableHead className="text-xs">medianReturn</TableHead>
                <TableHead className="text-xs">maxMaxDrawdown</TableHead>
                <TableHead className="text-xs">consistent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stability.parameters.map((p) => (
                <TableRow key={p.parameterSetKey}>
                  <TableCell className="font-mono text-xs">{formatParamSet(p.parameterSet)}</TableCell>
                  <TableCell className="text-xs">{p.qualifiedWindowCount} / {p.evaluatedWindowCount}</TableCell>
                  <TableCell className="text-xs">{fmtPct(p.qualifiedWindowRatePct, 1)}</TableCell>
                  <TableCell className={`text-xs ${pnlTone(p.medianTotalReturnPct)}`}>{fmtPct(p.medianTotalReturnPct)}</TableCell>
                  <TableCell className="text-xs text-emerald-700">{fmtPct(p.maxMaxDrawdownPct)}</TableCell>
                  <TableCell><StatusBadge status={p.consistent ? "SUCCESS" : "INCONCLUSIVE"} label={p.consistent ? "一致" : "不一致"} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </DataTable>
        )}
      </div>

      {/* 跨窗汇总候选 */}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">跨窗汇总候选（candidates；kind=candidate）</p>
        {run.candidates.length === 0 ? (
          <EmptyState icon={Table2} title="无跨窗候选" description="无参数集在其被评估的全部窗口中都合格。" className="py-6" />
        ) : (
          <DataTable maxHeight={260}>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">candidateId</TableHead>
                <TableHead className="text-xs">parameterSet</TableHead>
                <TableHead className="text-xs">meanReturn</TableHead>
                <TableHead className="text-xs">medianReturn</TableHead>
                <TableHead className="text-xs">maxMaxDrawdown</TableHead>
                <TableHead className="text-xs">合格窗</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.candidates.map((c) => (
                <TableRow key={c.candidateId}>
                  <TableCell className="font-mono text-xs">{c.candidateId}</TableCell>
                  <TableCell className="font-mono text-xs">{formatParamSet(c.parameterSet)}</TableCell>
                  <TableCell className={`text-xs ${pnlTone(c.performance.meanTotalReturnPct)}`}>{fmtPct(c.performance.meanTotalReturnPct)}</TableCell>
                  <TableCell className={`text-xs ${pnlTone(c.performance.medianTotalReturnPct)}`}>{fmtPct(c.performance.medianTotalReturnPct)}</TableCell>
                  <TableCell className="text-xs text-emerald-700">{fmtPct(c.performance.maxMaxDrawdownPct)}</TableCell>
                  <TableCell className="text-xs">{c.consistency.qualifiedWindowCount} / {c.consistency.evaluatedWindowCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </DataTable>
        )}
      </div>
    </div>
  );
}

function RobustnessResult({ run }: { run: RobustnessRun }) {
  const conclusion = run.conclusion;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">轴级结论（{run.axis}）：</span>
        <StatusBadge status={axisVerdictStatus(conclusion.verdict)} label={conclusion.verdict} />
        <span className="font-mono text-[10px] text-muted-foreground">robustnessRunId={run.robustnessRunId}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="扰动总数" value={conclusion.sampleCount} hint="含基准" />
        <MetricCard label="敏感" value={conclusion.sensitiveCount} tone={conclusion.sensitiveCount > 0 ? "warning" : "neutral"} />
        <MetricCard label="稳定" value={conclusion.stableCount} />
        <MetricCard label="评估失败" value={conclusion.failedCount} hint={`基准成功 ${conclusion.baselineSucceeded ? "是" : "否"}`} />
      </div>

      {conclusion.sensitiveEntries.length > 0 && (
        <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-medium">敏感扰动条目：</p>
          <p className="mt-0.5 font-mono text-[11px]">
            {conclusion.sensitiveEntries.map((e) => `${e.code}（${e.label}）`).join("、")}
          </p>
        </div>
      )}

      {/* 逐扰动样本表 */}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">逐扰动样本（samples；索引 0 = 基准）</p>
        <DataTable maxHeight={300}>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">扰动</TableHead>
              <TableHead className="text-xs">code</TableHead>
              <TableHead className="text-xs">verdict</TableHead>
              <TableHead className="text-xs">totalReturnPct</TableHead>
              <TableHead className="text-xs">maxDrawdownPct</TableHead>
              <TableHead className="text-xs">returnDrift</TableHead>
              <TableHead className="text-xs">ddWorsening</TableHead>
              <TableHead className="text-xs">error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.samples.map((s, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs">{s.perturbation.label}</TableCell>
                <TableCell className="font-mono text-[11px]">{s.perturbation.code}</TableCell>
                <TableCell><StatusBadge status={sampleVerdictStatus(s.verdict)} label={s.verdict} /></TableCell>
                <TableCell className={`text-xs ${pnlTone(s.metrics?.totalReturnPct)}`}>{fmtPct(s.metrics?.totalReturnPct)}</TableCell>
                <TableCell className="text-xs text-emerald-700">{fmtPct(s.metrics?.maxDrawdownPct)}</TableCell>
                <TableCell className={`text-xs ${pnlTone(s.drift ? -Math.abs(s.drift.returnDriftPct) : undefined)}`}>{s.drift ? `${s.drift.returnDriftPct >= 0 ? "+" : ""}${s.drift.returnDriftPct.toFixed(2)}pp` : "—"}</TableCell>
                <TableCell className="text-xs">{s.drift ? `${s.drift.drawdownWorseningPct.toFixed(2)}pp` : "—"}</TableCell>
                <TableCell className="text-xs text-red-600">{s.error ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
      </div>
    </div>
  );
}

function StochasticResult({ run }: { run: StochasticRun }) {
  const conclusion = run.conclusion;
  const distribution = run.distribution;
  const tail = run.tailProbabilities;
  const metricRows = [
    { key: "totalReturnPct", label: "总收益率（%）" },
    { key: "maxDrawdownPct", label: "最大回撤（%）" },
    { key: "sharpe", label: "Sharpe" },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">结论（{run.method}）：</span>
        <StatusBadge status={stochasticVerdictStatus(conclusion.verdict)} label={conclusion.verdict} />
        <span className="font-mono text-[10px] text-muted-foreground">{conclusion.reasonCode}</span>
        <span className="font-mono text-[10px] text-muted-foreground">成功 {conclusion.successCount} / 失败 {conclusion.failedCount}</span>
      </div>

      {conclusion.flags.length > 0 && (
        <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-medium">敏感标签：</p>
          <p className="mt-0.5 font-mono text-[11px]">{conclusion.flags.join(" / ")}</p>
        </div>
      )}

      {conclusion.interpretation && (
        <p className="rounded-md border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {conclusion.interpretation}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="基准收益" value={<span className={pnlTone(run.baseline.totalReturnPct)}>{fmtPct(run.baseline.totalReturnPct)}</span>} />
        <MetricCard label="基准回撤" value={<span className="text-emerald-700">{fmtPct(run.baseline.maxDrawdownPct)}</span>} />
        <MetricCard label="P(收益<0)" value={tail ? fmtPct(tail.probLossPct, 1) : "—"} />
        <MetricCard
          label={`P(MaxDD>${tail?.drawdownThresholdPct ?? 20}%)`}
          value={tail ? fmtPct(tail.probDrawdownExceedsPct, 1) : "—"}
          hint={tail?.probNegativeSharpePct !== null && tail?.probNegativeSharpePct !== undefined ? `P(Sharpe<0) ${fmtPct(tail.probNegativeSharpePct, 1)}` : undefined}
        />
      </div>

      {/* 三指标经验分布 */}
      {distribution === null ? (
        <EmptyState icon={Dices} title="无分布" description="成功样本为 0（全部迭代评估失败），不伪造空分布。" className="py-6" />
      ) : (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">经验分布摘要（quantile p05 ~ p95 + CI）</p>
          <DataTable maxHeight={220}>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">指标</TableHead>
                <TableHead className="text-xs">均值</TableHead>
                <TableHead className="text-xs">中位</TableHead>
                <TableHead className="text-xs">p05 ~ p95</TableHead>
                <TableHead className="text-xs">CI（{distribution.totalReturnPct.confidenceInterval.levelPct}%）</TableHead>
                <TableHead className="text-xs">基准百分位</TableHead>
                <TableHead className="text-xs">基准在尾</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metricRows.map((row) => {
                const inf = distribution[row.key];
                if (!inf) return null;
                const s = inf.summary;
                return (
                  <TableRow key={row.key}>
                    <TableCell className="text-xs">{row.label}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{fmtNum(s.mean)}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{fmtNum(s.median)}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{fmtNum(s.p05)} ~ {fmtNum(s.p95)}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{fmtNum(inf.confidenceInterval.lower)} ~ {fmtNum(inf.confidenceInterval.upper)}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{inf.baselinePercentile === null ? "—" : `${inf.baselinePercentile.toFixed(1)}`}</TableCell>
                    <TableCell><StatusBadge status={inf.baselineInTail ? "WARNING" : "SUCCESS"} label={inf.baselineInTail ? "尾部" : "非尾"} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </DataTable>
        </div>
      )}
    </div>
  );
}
