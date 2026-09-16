/**
 * ResearchAsk — 「提出问题即研究」的**默认模式**（RESEARCH-PLANNER-001 / §17 / §18 / §29）。
 *
 * 这一页只解决一件事：**让用户不需要懂统计分析就能发起一次研究**。
 * 默认流程就是任务书 §29 的六步：
 *   ① 选 Dataset ② 输入研究问题 ③ 点「开始研究」④ 等 Run 完成
 *   ⑤ 读结论 / 关键发现 / 关键证据 / 样本量 / 稳定性 / 风险 ⑥ 决定 [创建 Candidate] / [暂不继续]
 *
 * 三条设计纪律：
 *
 *   1. **页面不做统计**（§2.2 / §9）
 *      所有数字都是 `researchPlanner.getOutcome` 的字段直出。本文件不求和、不求平均、
 *      不重算比率 —— 唯一允许的「计算」是把 0~1 的小数格式化成百分比。
 *
 *   2. **不把原始结果堆在首屏**（§14）
 *      首屏只有：结论、关键发现、关键证据、样本量、稳定性、风险提示。
 *      逐条分析状态、计划被丢弃的项、口径回执全部收进折叠区 —— 但**必须可到达**，
 *      否则用户无法复核「系统到底算了什么」。
 *
 *   3. **默认模式与专家模式并存，不取代**（§17）
 *      现有的实验 / 分析 / Finding 工作台入口（`/research`）原样保留，本页只是新增的默认入口。
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Lightbulb,
  PlayCircle,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/common";
// `findingTypeLabelOf` 复用既有 adapter —— 不在这里再写一份类型标签表（第二套口径迟早漂移）。
import { findingTypeLabelOf, formatCount } from "@/adapters/researchEngineAdapter";
import {
  RESEARCH_ASK_EXAMPLES,
  RESEARCH_ASK_STEP_LABELS,
  RESEARCH_PLAN_DEFAULT_ANALYSIS,
  RESEARCH_PLAN_MAX_ANALYSIS,
  RESEARCH_PLAN_MIN_ANALYSIS,
  buildKeyEvidenceRows,
  buildRiskNotes,
  candidateFilterOriginLabelOf,
  createDefaultResearchAskForm,
  formatPercent,
  formatPercentPoint,
  isRunReportable,
  nextStepHintOf,
  recommendationStageStyleOf,
  strengthGradeLabelOf,
  summarizeRunProgress,
  toResearchAskInput,
  validateResearchAskForm,
  type CandidateFilterSourceView,
  type ResearchAskStep,
  type ResearchOutcomeView,
  type ResearchPlannedView,
} from "@/components/research/researchAskForm";
import { researchTypeLabelOf } from "@/components/research/createExperimentForm";

const toneClass: Record<"good" | "warn" | "bad", string> = {
  good: "border-emerald-300 bg-emerald-50 text-emerald-800",
  warn: "border-amber-300 bg-amber-50 text-amber-800",
  bad: "border-rose-300 bg-rose-50 text-rose-800",
};

export default function ResearchAsk() {
  const [step, setStep] = useState<ResearchAskStep>("ASK");
  const [form, setForm] = useState(createDefaultResearchAskForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [planned, setPlanned] = useState<ResearchPlannedView | null>(null);
  const [questionId, setQuestionId] = useState<number | null>(null);
  const [candidateId, setCandidateId] = useState<number | null>(null);
  /**
   * §16 候选创建回执（含 `filterRuleSource`）。
   * 让用户看得见「筛选条件是从哪条分析、几条条件来的」——
   * 人工确认候选时必须能核这件事（此前只能从报错里知道条件没导出成）。
   */
  const [candidateSource, setCandidateSource] = useState<CandidateFilterSourceView | null>(null);
  const [capOverride, setCapOverride] = useState(String(RESEARCH_PLAN_DEFAULT_ANALYSIS));
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const definitions = trpc.datasetRegistry.listDefinitions.useQuery();
  const definitionId = Number(form.datasetId);
  const detail = trpc.datasetRegistry.getDefinition.useQuery(
    { definitionId },
    { enabled: Number.isFinite(definitionId) && definitionId > 0 },
  );

  const versions = useMemo(
    () =>
      (detail.data?.versions ?? []).map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        startDate: v.startDate,
        endDate: v.endDate,
        totalEvents: v.totalEvents,
      })),
    [detail.data],
  );

  // 只定义一个数据集时直接选中，省一次点击（与 CreateExperimentDialog 同一做法）
  useEffect(() => {
    if (form.datasetId !== "" || !definitions.data || definitions.data.length !== 1) return;
    setForm((prev) => ({ ...prev, datasetId: String(definitions.data![0]!.id) }));
  }, [definitions.data, form.datasetId]);

  // 版本到位后推荐一个 READY 版本（只在用户尚未选择时）
  useEffect(() => {
    if (form.datasetVersionId !== "" || versions.length === 0) return;
    const ready = versions.find((v) => v.status === "READY") ?? versions[0];
    if (ready !== undefined) setForm((prev) => ({ ...prev, datasetVersionId: String(ready.id) }));
  }, [versions, form.datasetVersionId]);

  const createQuestion = trpc.researchPlanner.createQuestion.useMutation();
  const startRun = trpc.researchPlanner.runResearchDetached.useMutation();
  const createCandidate = trpc.researchPlanner.createCandidate.useMutation();

  const outcomeQuery = trpc.researchPlanner.getOutcome.useQuery(
    { questionId: questionId ?? 0 },
    {
      enabled: questionId !== null,
      // 执行期轮询：进度由后端逐条写 `research_analysis.status`（§23），前端只是读。
      refetchInterval: step === "RUNNING" ? 3000 : false,
    },
  );
  const outcome = (outcomeQuery.data ?? null) as ResearchOutcomeView | null;

  // 跑完就切到结论页（判定放在 `isRunReportable` 里，含「还没物化完」的竞态保护）
  useEffect(() => {
    if (step !== "RUNNING" || outcome === null) return;
    if (isRunReportable(outcome)) setStep("OUTCOME");
  }, [step, outcome]);

  // 运行中的秒表（纯粹为了告诉用户「还在动」，不是进度来源）
  useEffect(() => {
    if (step !== "RUNNING") return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const progress = outcome === null ? null : summarizeRunProgress(outcome);
  const elapsedSeconds = startedAt === null ? 0 : Math.floor((nowTick - startedAt) / 1000);

  const busy = createQuestion.isPending || startRun.isPending;

  function handleAsk() {
    const found = validateResearchAskForm(form, { versions, definitionLoaded: detail.data !== undefined });
    setErrors(found);
    setSubmitError(null);
    if (found.length > 0) return;

    const input = toResearchAskInput(form);
    const cap = Number(capOverride);
    const capValid = Number.isInteger(cap) && cap >= RESEARCH_PLAN_MIN_ANALYSIS && cap <= RESEARCH_PLAN_MAX_ANALYSIS;

    createQuestion.mutate(
      {
        datasetVersionId: input.datasetVersionId,
        questionText: input.questionText,
        generatedBy: "USER",
        ...(capValid ? { maxAnalysisPerPlan: cap } : {}),
      },
      {
        onSuccess: (data) => {
          setPlanned(data);
          setQuestionId(data.question.id ?? null);
          setCandidateId(null);
          setStep("PREVIEW");
        },
        onError: (e) => setSubmitError(e.message),
      },
    );
  }

  function handleStartRun() {
    if (planned?.plan.id === undefined) return;
    const planId = planned.plan.id;
    startRun.mutate(
      { planId },
      {
        onSuccess: () => {
          setStartedAt(Date.now());
          setNowTick(Date.now());
          setStep("RUNNING");
          void outcomeQuery.refetch();
        },
        onError: (e) => setSubmitError(e.message),
      },
    );
  }

  function handleCreateCandidate() {
    if (questionId === null || outcome === null) return;
    /**
     * 🔴 **这里不再自己挑分析** —— 这是本缺陷的现场。
     *
     * 旧实现：`outcome.analyses.find((a) => a.priority === "P0")`。
     * 而计划里第一条 P0 是 `EVENT_STUDY 全样本基准`
     * （`analysisPlan.ts:361` 是全函数第一条 push，`requiredFlag = true`），
     * 它天然没有 `research_analysis_condition` 行 ⇒ 服务端按设计拒绝，
     * 「创建候选」在产品上**恒失败**（实测报错：
     * 「分析 780001 没有任何条件，无法导出候选题筛选条件。」）。
     *
     * 之所以 E2E 一直全绿：E2E 自己写了更严的判据
     * （`priority === "P0" && analysisType === "CONDITIONAL"`）——
     * **测试比产品严，通过只证明测试的挑法对，不证明产品可用**。
     *
     * 现在挑选规则**只在服务端实现一次**（`aggregate.ts#rankCandidateSourceAnalyses`，
     * 口径：提问点名 → 计划必需项 → P0/P1/P2 → 条件分析 → analysisId 升序）。
     * 前端与 Workbuddy 都不必、也无法知道该传哪条分析 —— §20 的调用契约里
     * 本来就只有 `{ datasetVersionId, researchQuestion }`。
     */
    createCandidate.mutate(
      {
        questionId,
        name: (outcome.questionText ?? "自动研究").slice(0, 80),
        description: `由研究问题自动规划并执行（planId=${outcome.planId}）。`,
      },
      {
        onSuccess: (data) => {
          setCandidateId(data.candidate.id ?? null);
          setCandidateSource(data.filterRuleSource);
          const s = data.filterRuleSource;
          toast.success(`已创建候选草稿 #${data.candidate.id}`, {
            description:
              s.origin === "NONE"
                ? "⚠️ 本次没有任何可导出的筛选条件 —— 候选已建但口径为空，"
                  + "进入策略前必须补上，否则等于「全市场」。状态 DRAFT，需人工确认。"
                : `筛选条件来自「${s.analysisName}」（${s.conditionCount} 条，`
                  + `${candidateFilterOriginLabelOf(s.origin)}）。`
                  + "状态为 DRAFT —— 需要你人工确认后才会进入策略流程。",
          });
        },
        onError: (e) => toast.error("创建候选失败", { description: e.message }),
      },
    );
  }

  function resetAll() {
    setStep("ASK");
    setForm(createDefaultResearchAskForm());
    setErrors([]);
    setSubmitError(null);
    setPlanned(null);
    setQuestionId(null);
    setCandidateId(null);
    setCandidateSource(null);
    setStartedAt(null);
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> 提出研究问题，系统自动设计并执行研究
            </CardTitle>
            <CardDescription>
              你只需要选一份 Dataset + 用一句话说清想研究什么。
              研究方法、特征 / 目标 / 视界 / 分组 / 稳定性复核全部由系统设计 ——
              你最终只负责判断「是否值得进入下一阶段」。
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/research">高级 / 专家模式</Link>
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(Object.keys(RESEARCH_ASK_STEP_LABELS) as ResearchAskStep[]).map((s) => (
              <li key={s} className={s === step ? "font-medium text-foreground" : undefined}>
                {RESEARCH_ASK_STEP_LABELS[s]}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {step === "ASK" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">① 提出问题</CardTitle>
            <CardDescription>
              只有两项是必填：Dataset 版本、研究问题。其余全部由系统决定。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ask-dataset">数据集</Label>
                <Select
                  value={form.datasetId}
                  onValueChange={(v) =>
                    // 换数据集必须清掉版本，否则会把上一个数据集的版本带过去
                    setForm((prev) => ({ ...prev, datasetId: v, datasetVersionId: "" }))
                  }
                >
                  <SelectTrigger id="ask-dataset">
                    <SelectValue placeholder={definitions.isLoading ? "加载中…" : "选择数据集"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(definitions.data ?? []).map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.name}（{d.datasetCode}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ask-version">Dataset 版本</Label>
                <Select
                  value={form.datasetVersionId}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, datasetVersionId: v }))}
                  disabled={form.datasetId === "" || detail.isLoading}
                >
                  <SelectTrigger id="ask-version">
                    <SelectValue
                      placeholder={
                        form.datasetId === ""
                          ? "请先选择数据集"
                          : detail.isLoading
                            ? "加载版本…"
                            : versions.length === 0
                              ? "该数据集暂无版本"
                              : "选择版本"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={String(v.id)} disabled={v.status !== "READY"}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono">{v.version}</span>
                          <span className="text-xs text-muted-foreground">
                            {v.startDate ?? "—"} ~ {v.endDate ?? "—"}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatCount(v.totalEvents)} 事件</span>
                          <StatusBadge status={v.status} />
                          {v.status !== "READY" && <span className="text-xs">（不可用于研究）</span>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ask-question">研究问题</Label>
              <Textarea
                id="ask-question"
                value={form.questionText}
                onChange={(e) => setForm((prev) => ({ ...prev, questionText: e.target.value }))}
                rows={3}
                placeholder="如：首板之后回踩，只要不跌破首板开盘价，后面的收益是不是更好？"
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground">
                用交易语言描述假设即可 —— <strong>不要</strong>填写特征名、目标变量、视界、分组维度，
                那些由系统根据问题自动决定。
              </p>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <Lightbulb className="h-3.5 w-3.5" /> 不知道怎么问？点一句示例
              </p>
              {RESEARCH_ASK_EXAMPLES.map((ex) => (
                <button
                  key={ex.text}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, questionText: ex.text }))}
                  className="block w-full rounded-md border bg-background px-3 py-2 text-left text-xs hover:bg-accent"
                >
                  <span className="block font-medium">{ex.text}</span>
                  <span className="mt-0.5 block text-muted-foreground">{ex.hint}</span>
                </button>
              ))}
            </div>

            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-xs font-medium">高级（可选）：计划规模上限</summary>
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="ask-cap" className="text-xs">
                  最多生成多少条分析（{RESEARCH_PLAN_MIN_ANALYSIS} ~ {RESEARCH_PLAN_MAX_ANALYSIS}，默认{" "}
                  {RESEARCH_PLAN_DEFAULT_ANALYSIS}）
                </Label>
                <Input
                  id="ask-cap"
                  value={capOverride}
                  onChange={(e) => setCapOverride(e.target.value)}
                  className="h-9 w-32 font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  超限时系统**不会报错**，而是按优先级保留核心分析、降低次要维度，并把被裁掉的项如实列出。
                </p>
              </div>
            </details>

            {errors.length > 0 && (
              <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {errors.map((e) => (
                  <li key={e}>· {e}</li>
                ))}
              </ul>
            )}

            {submitError !== null && (
              <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {submitError}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleAsk} disabled={busy}>
                {createQuestion.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                <Sparkles className="mr-1.5 h-4 w-4" /> 开始研究
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "PREVIEW" && planned !== null && (
        <PlanPreviewCard
          planned={planned}
          expectedEvents={
            versions.find((v) => String(v.id) === form.datasetVersionId)?.totalEvents ?? null
          }
          onBack={() => setStep("ASK")}
          onStart={handleStartRun}
          starting={startRun.isPending}
          error={submitError}
        />
      )}

      {step === "RUNNING" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Loader2 className="h-4 w-4 animate-spin" /> ③ 正在研究
            </CardTitle>
            <CardDescription>
              进度来自后端逐条写库的分析状态（不是前端估算）。已运行 {elapsedSeconds}s。
              {progress !== null && progress.total > 0 && (
                <> 共 {progress.total} 条分析：完成 {progress.completed} / 失败 {progress.failed} / 进行中 {progress.pending}。</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {progress === null || progress.total === 0 ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-2 w-full" />
                <p className="text-xs text-muted-foreground">正在把研究计划落成分析（物化）…</p>
              </div>
            ) : (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <AnalysisStatusTable analyses={outcome?.analyses ?? []} />
              </>
            )}
            <p className="text-xs text-muted-foreground">
              提示：这是一次同步长请求的异步化 —— 期间刷新页面不会打断执行；执行完成前不要改服务端代码。
            </p>
          </CardContent>
        </Card>
      )}

      {step === "OUTCOME" && outcome !== null && (
        <OutcomeView
          outcome={outcome}
          candidateId={candidateId}
          candidateSource={candidateSource}
          creatingCandidate={createCandidate.isPending}
          onCreateCandidate={handleCreateCandidate}
          onReset={resetAll}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ② 计划预览（§18：正式执行前可看；默认无需调整）
// ---------------------------------------------------------------------------

function PlanPreviewCard({
  planned,
  expectedEvents,
  onBack,
  onStart,
  starting,
  error,
}: {
  planned: ResearchPlannedView;
  expectedEvents: number | null;
  onBack: () => void;
  onStart: () => void;
  starting: boolean;
  error: string | null;
}) {
  const p = planned.preview;
  const spec = planned.plan.notes?.spec ?? null;
  const capabilityHints = planned.preview.capabilityNotes;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">② 研究计划预览</CardTitle>
        <CardDescription>
          系统已把这句话变成一份具体的研究计划。默认直接用；需要调整请回到上一步改问题
          —— 计划本身不允许手改字段（那会让「预览的」与「执行的」变成两份东西）。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
          <p>
            <span className="font-medium">研究方法：</span>
            {spec?.researchModule.primaryLabel ?? planned.intent.primaryModule.label}
            <span className="ml-2 font-mono text-muted-foreground">{planned.intent.primaryModuleKey}</span>
            <span className="ml-2 text-muted-foreground">
              （研究类型：{researchTypeLabelOf(planned.intent.researchType)}；由系统识别，你不需要选）
            </span>
          </p>
          <p className="mt-1">
            <span className="font-medium">预计分析数：</span>
            {p.plannedCount} 条（核心 {p.coreCount} / 辅助 {p.auxiliaryCount} / 探索 {p.exploratoryCount}）
            {p.capApplied && <span className="ml-1 text-amber-800">· 已因规模上限裁剪</span>}
          </p>
          <p className="mt-1">
            <span className="font-medium">预计数据量：</span>
            {expectedEvents === null
              ? "该 Dataset 版本未登记事件数（实际样本数由引擎执行时冻结）"
              : `该 Dataset 版本约 ${formatCount(expectedEvents)} 个事件（实际样本数由引擎执行时按 horizon 可用性冻结）`}
          </p>
        </div>

        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            p.dataValidity.passed ? toneClass.good : toneClass.warn
          }`}
        >
          <p className="flex items-center gap-1.5 font-medium">
            {p.dataValidity.passed ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" /> 数据有效性检查 ✓ Passed
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5" /> 存在 {p.dataValidity.failedCount} 条分析未通过有效性检查
              </>
            )}
          </p>
          {p.dataValidity.notes.map((n) => (
            <p key={n} className="mt-0.5">
              · {n}
            </p>
          ))}
          {capabilityHints.map((n) => (
            <p key={n} className="mt-0.5">
              · {n}
            </p>
          ))}
        </div>

        {spec !== null && (
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-xs font-medium">
              系统自动选择的口径（特征 / 目标 / 视界 / 分组 / 稳定性）—— 点开核对
            </summary>
            <div className="mt-3 space-y-3 text-xs">
              <p>
                <span className="font-medium">视界：</span>
                {spec.horizons.map((h) => `T+${h}`).join(" / ") || "—"}
              </p>
              <p>
                <span className="font-medium">比较基准：</span>
                {spec.baseline === null ? "（无）" : spec.baseline.analysisName}
              </p>
              <div>
                <p className="font-medium">条件口径（P0 核心）：</p>
                {spec.condition.length === 0 && <p className="text-muted-foreground">（无）</p>}
                {spec.condition.map((c) => (
                  <div key={c.analysisName} className="mt-1 rounded border bg-muted/20 px-2 py-1">
                    <p className="font-mono">{c.analysisName}</p>
                    {c.expressions.map((e) => (
                      <p key={e} className="font-mono text-muted-foreground">
                        {e}
                      </p>
                    ))}
                    {c.readbacks.map((r) => (
                      <p key={r}>↳ {r}</p>
                    ))}
                  </div>
                ))}
              </div>
              <div>
                <p className="font-medium">特征侧用到的变量：</p>
                <ul className="mt-1 space-y-0.5">
                  {spec.featureMapping.map((f) => (
                    <li key={f.variable}>
                      <span className="font-mono">{f.variable}</span>
                      <span className="ml-2 text-muted-foreground">
                        {f.roles.join("/")} · {f.analysisCount} 条
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium">结果侧用到的变量：</p>
                <ul className="mt-1 space-y-0.5">
                  {spec.targetMapping.map((f) => (
                    <li key={f.variable}>
                      <span className="font-mono">{f.variable}</span>
                      <span className="ml-2 text-muted-foreground">
                        {f.analysisCount} 条
                        {f.horizons.length > 0 ? ` · ${f.horizons.map((h) => `T+${h}`).join("/")}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium">稳定性复核：</p>
                <ul className="mt-1 space-y-0.5">
                  {spec.stabilityPlan.length === 0 && <li className="text-muted-foreground">（无）</li>}
                  {spec.stabilityPlan.map((s) => (
                    <li key={s.analysisName}>
                      按 {s.dimensionLabel} 分组 → <span className="font-mono">{s.analysisName}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium">分段 / 关系型分析：</p>
                <ul className="mt-1 space-y-0.5">
                  {spec.interactionPlan.length === 0 && <li className="text-muted-foreground">（无）</li>}
                  {spec.interactionPlan.map((s) => (
                    <li key={s.analysisName}>
                      <span className="font-mono">{s.analysisName}</span>
                      <span className="block text-muted-foreground">{s.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <PlanBucket title={`核心分析（必做）· ${p.coreCount} 条`} items={p.coreAnalyses} required />
          <PlanBucket title={`辅助分析 · ${p.auxiliaryCount} 条`} items={p.auxiliaryAnalyses} />
          <PlanBucket title={`探索分析 · ${p.exploratoryCount} 条`} items={p.exploratoryAnalyses} />
        </div>

        {/*
          §13 / §18 —— 预览期就要让用户确认「系统有没有听清我在问什么」。
          没有这一段，用户只能在跑完 4 分钟后才发现「我问的那件事一条分析都没生成」。
        */}
        <div className="rounded-md border bg-muted/20 px-3 py-3 text-xs">
          {p.emphasisAnalysisNames.length > 0 ? (
            <>
              <p className="font-medium">
                已识别到你问的重点 —— 下列 {p.emphasisAnalysisNames.length} 条会作为「针对你的问题」的直接证据：
              </p>
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                {p.emphasisAnalysisNames.map((name) => (
                  <li key={name}>· {name}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground">
              你的问题里没有点明某个具体维度（例如「深度」「缩量」「放量」）。执行后，结论页会把
              <span className="font-medium">本问题的核心口径（必做项）</span>
              作为「针对你的问题」的直接证据。如果这不是你想问的，请把问题写得更具体一些。
            </p>
          )}
        </div>

        {p.droppedCount > 0 && (
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-xs font-medium">
              有 {p.droppedCount} 条分析未生成 / 被裁剪 —— 点开看原因
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {(planned.plan.notes?.dropped ?? []).map((d) => (
                <li key={`${d.analysisType}-${d.name}`}>
                  <span className="font-mono">{d.analysisType}</span> · {d.name}
                  <span className="ml-1">[{d.reason}]</span>
                  <span className="block">{d.detail}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {error !== null && (
          <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onBack} disabled={starting}>
            返回修改
          </Button>
          <Button onClick={onStart} disabled={starting || p.plannedCount === 0}>
            {starting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            <PlayCircle className="mr-1.5 h-4 w-4" /> 执行这份计划
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlanBucket({
  title,
  items,
  required,
}: {
  title: string;
  items: ReadonlyArray<{ name: string; analysisType: string; purpose: string }>;
  required?: boolean;
}) {
  return (
    <div className={`rounded-md border p-3 ${required === true ? "border-emerald-300 bg-emerald-50/40" : ""}`}>
      <p className="text-xs font-medium">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.length === 0 && <li className="text-xs text-muted-foreground">（无）</li>}
        {items.map((it) => (
          <li key={`${it.analysisType}-${it.name}`} className="text-xs">
            <span className="font-mono text-[11px] text-muted-foreground">{it.analysisType}</span>
            <span className="ml-1.5">{it.name}</span>
            <span className="mt-0.5 block text-muted-foreground">{it.purpose}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ④ 结论视图（§12–§15 / §29 第 5 步）
// ---------------------------------------------------------------------------

function OutcomeView({
  outcome,
  candidateId,
  candidateSource,
  creatingCandidate,
  onCreateCandidate,
  onReset,
}: {
  outcome: ResearchOutcomeView;
  candidateId: number | null;
  candidateSource: CandidateFilterSourceView | null;
  creatingCandidate: boolean;
  onCreateCandidate: () => void;
  onReset: () => void;
}) {
  const stage = recommendationStageStyleOf(outcome.recommendation.stage);
  const riskNotes = buildRiskNotes(outcome);
  const evidenceRows = buildKeyEvidenceRows(outcome);

  return (
    <>
      {/* 结论（§15） */}
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">④ 研究结论</CardTitle>
          <CardDescription>{outcome.questionText}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {outcome.conclusion === null ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              本轮没有生成结论记录（通常是因为 Run 失败）。请先补跑失败的分析，或换一个问题重试。
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded border px-2 py-0.5 font-medium">
                  {conclusionTypeLabelOf(outcome.conclusion.conclusionType)}
                </span>
                <span className={`rounded border px-2 py-0.5 font-medium ${toneClass[stage.tone]}`}>
                  {stage.label}
                </span>
                <span className="text-muted-foreground">
                  分析 {outcome.analysisCount} 条（完成 {outcome.completedCount} / 失败 {outcome.failedCount}）·
                  样本基准 {formatCount(outcome.sampleCount)} · 检出发现 {outcome.findingsTotal} 条
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{outcome.conclusion.conclusion}</p>
              <p className={`rounded-md border px-3 py-2 text-xs ${toneClass[stage.tone]}`}>{stage.meaning}</p>
              {outcome.conclusion.limitations.length > 0 && (
                <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                  <p className="font-medium">结论自身的局限：</p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {outcome.conclusion.limitations.map((l) => (
                      <li key={l}>· {l}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/*
        针对你的问题（§13 / §15 / §28）—— 必须在「关键发现」之前。
        理由：关键发现是**全部证据**里最强的几条，排序按强度 → 样本量；
        当强度在 1.0 饱和时，样本量小的强效应会被挤下去。
        「用户问的那件事」如果只落在那批被挤掉的条目里，用户会在自己的结论页上找不到答案。
      */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            针对你的问题（{outcome.questionAlignedFindings.length} 条）
          </CardTitle>
          <CardDescription>{outcome.questionAlignment.note}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {outcome.questionAlignedFindings.length === 0 ? (
            <div className="rounded-md border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
              本轮没有拿到可以直接回答这个问题的证据。这不等于「结论是错的」——
              而是说**这个问题在本轮没有得到证据支持**，请先核对计划里是否真的包含了对应分析，
              再决定是否进入下一阶段。
            </div>
          ) : (
            outcome.questionAlignedFindings.map((f) => (
              <div key={f.findingId} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">#{f.findingId}</span>
                  <span className="rounded border px-1.5 py-0.5">{findingTypeLabelOf(f.findingType)}</span>
                  <span className="text-muted-foreground">
                    样本 {formatCount(f.sampleCount)} · 视界 {f.horizon === null ? "—" : `T+${f.horizon}`}
                  </span>
                  {f.effect.excessReturn !== null && (
                    <span
                      className={`rounded border px-1.5 py-0.5 font-medium ${
                        f.effect.excessReturn >= 0 ? toneClass.good : toneClass.bad
                      }`}
                    >
                      超额 {formatPercentPoint(f.effect.excessReturn)}
                    </span>
                  )}
                  {f.stability !== null && (
                    <span className="text-muted-foreground">
                      {f.stability.contradicted ? "稳定性有冲突" : f.stability.stable ? "稳定性通过" : "稳定性未通过"}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm font-medium">{f.title}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* 关键发现（§13） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            关键发现（{outcome.topFindings.length} 条，共检出 {outcome.findingsTotal} 条）
          </CardTitle>
          <CardDescription>
            已按强度排序并去重（合并掉 {outcome.dedupedCount} 条重复表述）。
            {outcome.hiddenFindingCount > 0 && `另有 ${outcome.hiddenFindingCount} 条未进第一屏。`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {outcome.topFindings.length === 0 && (
            <div className="rounded-md border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
              本轮没有检出达到阈值的发现。这本身是一个结果 —— 说明这个方向在当前数据上不成立。
            </div>
          )}
          {outcome.topFindings.map((f) => (
            <div key={f.findingId} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-muted-foreground">#{f.findingId}</span>
                <span className="rounded border px-1.5 py-0.5">{findingTypeLabelOf(f.findingType)}</span>
                <span
                  className={`rounded border px-1.5 py-0.5 font-medium ${
                    f.researchStrengthGrade === "STRONG" ? toneClass.good : toneClass.warn
                  }`}
                >
                  强度 {strengthGradeLabelOf(f.researchStrengthGrade)}
                  {f.researchStrength !== null && `（${f.researchStrength.toFixed(2)}）`}
                </span>
                <span className="text-muted-foreground">
                  样本 {f.sampleCount ?? "—"} · 视界 {f.horizon === null ? "—" : `T+${f.horizon}`}
                </span>
              </div>
              <p className="mt-1.5 text-sm font-medium">{f.title}</p>
              {f.summary !== null && <p className="mt-0.5 text-xs text-muted-foreground">{f.summary}</p>}
              <p className="mt-1 text-xs">
                <span className="font-medium">条件：</span>
                <span className="font-mono">{f.analysisName ?? "—"}</span>
                {f.target !== null && (
                  <>
                    <span className="ml-2 font-medium">目标：</span>
                    <span className="font-mono">{f.target}</span>
                  </>
                )}
              </p>
              <div className="mt-1.5 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                <p>
                  <span className="text-muted-foreground">条件组收益：</span>
                  {formatPercent(f.effect.groupReturn)} · 胜率 {formatPercent(f.effect.winRate, 1)}
                </p>
                <p>
                  <span className="text-muted-foreground">相对基准：</span>
                  {f.effect.benchmarkUnavailable ? (
                    "基准不可用"
                  ) : (
                    <>
                      {formatPercentPoint(f.effect.excessReturn)}（基准 {formatPercent(f.effect.benchmarkReturn)}）
                    </>
                  )}
                </p>
                <p>
                  <span className="text-muted-foreground">稳定性：</span>
                  {f.stability === null
                    ? "无稳定性证据"
                    : f.stability.stable
                      ? `稳定（一致率 ${formatPercent(f.stability.consistentRatio, 0)}）`
                      : `不稳定（一致率 ${formatPercent(f.stability.consistentRatio, 0)}）`}
                </p>
                <p>
                  <span className="text-muted-foreground">冲突：</span>
                  {f.conflictsWith.length > 0 ? `与 ${f.conflictsWith.join(", #")} 冲突` : "无"}
                </p>
              </div>
              {f.stability !== null && f.stability.slices.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    按 {f.stability.dimensionKey} 的 {f.stability.slices.length} 个切片
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {f.stability.slices.map((s) => (
                      <li key={s.label}>
                        <span className="font-mono">{s.label}</span>
                        <span className="ml-2">{formatPercent(s.metricValue)}</span>
                        <span className="ml-2 text-muted-foreground">n={s.sampleCount ?? "—"}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {f.limitations.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800">
                  {f.limitations.map((l) => (
                    <li key={l}>⚠️ {l}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 关键证据表（§13 九问） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">关键证据</CardTitle>
          <CardDescription>每一行对应一条关键发现，九列与「发现了什么 / 在什么条件下 / … / 是否冲突」一一对应。</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {evidenceRows.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">（无可展示的证据行）</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>发现了什么</TableHead>
                    <TableHead>在什么条件下</TableHead>
                    <TableHead>目标 / 视界</TableHead>
                    <TableHead>样本量</TableHead>
                    <TableHead>与基准差异</TableHead>
                    <TableHead>效果大小</TableHead>
                    <TableHead>稳定性</TableHead>
                    <TableHead>冲突</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evidenceRows.map((r) => (
                    <TableRow key={r.findingId}>
                      <TableCell className="max-w-xs text-xs">
                        <span className="font-mono text-muted-foreground">#{r.findingId}</span> {r.what}
                      </TableCell>
                      <TableCell className="max-w-xs font-mono text-xs">{r.condition}</TableCell>
                      <TableCell className="text-xs">
                        {r.target} · {r.horizon}
                      </TableCell>
                      <TableCell className="text-xs">{r.sample}</TableCell>
                      <TableCell className="text-xs">{r.vsBenchmark}</TableCell>
                      <TableCell className="text-xs">{r.effectSize}</TableCell>
                      <TableCell className="text-xs">{r.stability}</TableCell>
                      <TableCell className="text-xs">{r.conflict}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 风险提示与有效性（§14 / §22） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">风险提示与数据有效性</CardTitle>
          <CardDescription>每一条都对应一个后端事实（有效性 / 局限 / 反向证据 / 样本等级 / 裁剪）。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 text-xs">
          {riskNotes.map((n) => (
            <p key={n} className="rounded border bg-muted/20 px-2 py-1.5">
              {n}
            </p>
          ))}
          {outcome.dataValidity.failedAnalyses.length > 0 && (
            <div className="rounded border border-rose-200 px-2 py-1.5">
              <p className="font-medium">未通过有效性检查的分析：</p>
              <ul className="mt-0.5">
                {outcome.dataValidity.failedAnalyses.map((a) => (
                  <li key={a.analysisId}>
                    <span className="font-mono">#{a.analysisId}</span> {a.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* §15 建议 + §16 下一步 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">下一步</CardTitle>
          <CardDescription>{outcome.recommendation.text}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-0.5 text-xs">
            {outcome.recommendation.reasons.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {outcome.nextActions.map((n) => (
              <li key={n}>→ {n}</li>
            ))}
          </ul>
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {outcome.recommendation.disclaimer}
          </p>
          <p className="text-xs text-muted-foreground">{nextStepHintOf(outcome.recommendation.stage)}</p>

          {/*
            §16 —— 候选筛选条件的来源必须**在点按钮之前**就能看到。
            旧实现里前端自己按「第一条 P0」挑，挑中了没有条件的全样本基准，
            用户点下去只会拿到一句报错；而「本 Run 到底有几条分析能导出条件」
            是数据库事实，只能由服务端如实告知。
          */}
          <div className="rounded-md border px-3 py-2 text-xs">
            {outcome.candidateEligibleAnalyses.length === 0 ? (
              <p className="text-amber-800">
                本 Run 的 {outcome.analysisCount} 条分析里**没有一条带条件**
                （现状下只有条件分析才会落条件）—— 直接创建候选会得到一个
                <span className="font-medium">没有筛选条件</span>
                的候选（等于「全市场」）。建议先补一条带条件的分析再创建。
              </p>
            ) : (
              <>
                <p>
                  <span className="font-medium">
                    创建候选时会自动使用「{outcome.candidateEligibleAnalyses[0]!.name}」的
                    {outcome.candidateEligibleAnalyses[0]!.conditionCount} 条条件
                  </span>
                  <span className="text-muted-foreground">
                    （依据：{outcome.candidateEligibleAnalyses[0]!.why}）
                  </span>
                </p>
                {outcome.candidateEligibleAnalyses.length > 1 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground">
                      本 Run 共有 {outcome.candidateEligibleAnalyses.length} 条分析可导出条件
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {outcome.candidateEligibleAnalyses.map((c) => (
                        <li key={c.analysisId}>
                          <span className="font-mono">#{c.analysisId}</span> {c.name}
                          <span className="ml-1">（{c.conditionCount} 条条件 · {c.why}）</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
            {candidateSource !== null && (
              <p className="mt-1 border-t pt-1">
                <span className="font-medium">
                  候选 #{candidateId} 的筛选条件：
                </span>
                {candidateSource.origin === "NONE" ? (
                  <span className="text-amber-800">
                    ⚠️ 未导出（{candidateFilterOriginLabelOf(candidateSource.origin)}）——
                    {candidateSource.note}
                  </span>
                ) : (
                  <>
                    来自「{candidateSource.analysisName}」
                    {candidateSource.conditionCount} 条条件
                    <span className="text-muted-foreground">
                      （{candidateFilterOriginLabelOf(candidateSource.origin)}）· {candidateSource.note}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={onReset}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> 换个问题
            </Button>
            {candidateId === null ? (
              <Button onClick={onCreateCandidate} disabled={creatingCandidate}>
                {creatingCandidate && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                <FlaskConical className="mr-1.5 h-4 w-4" /> 创建 Candidate
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href={`/research/candidates/${candidateId}`}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> 查看候选 #{candidateId}（DRAFT）
                </Link>
              </Button>
            )}
          </div>
          <p className="text-right text-xs text-muted-foreground">
            创建候选**不会**自动生成策略 —— 候选是 DRAFT，需要你人工确认后才会进入策略流程。
          </p>
        </CardContent>
      </Card>

      {/* 原始分析（§14：默认不展示，但必须可到达） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">研究计划与原始分析（复核用）</CardTitle>
          <CardDescription>
            默认收起。需要核对「系统到底算了什么」时再展开 —— 首屏只展示结论与关键发现。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-xs font-medium">
              逐条分析状态（{outcome.analyses.length} 条）
            </summary>
            <div className="mt-3">
              <AnalysisStatusTable analyses={outcome.analyses} />
            </div>
          </details>

          {outcome.plan.selectionRationale.length > 0 && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-xs font-medium">系统的选择理由（为什么这么设计研究）</summary>
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {outcome.plan.selectionRationale.map((r) => (
                  <li key={r}>· {r}</li>
                ))}
              </ul>
            </details>
          )}

          {outcome.plan.dropped.length > 0 && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-xs font-medium">
                未生成 / 被裁剪的 {outcome.plan.dropped.length} 条分析
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {outcome.plan.dropped.map((d) => (
                  <li key={`${d.analysisType}-${d.name}`}>
                    <span className="font-mono">{d.analysisType}</span> · {d.name}
                    <span className="ml-1">[{d.reason}]</span>
                    <span className="block">{d.detail}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="text-xs text-muted-foreground">
            单条分析的原始结果行（分组 / 分位 / 显著性）在{" "}
            <Link href="/research" className="underline">
              高级 / 专家模式
            </Link>{" "}
            里按分析逐条查看 —— 本页刻意不把原始结果铺开，避免「统计垃圾」淹没结论。
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function AnalysisStatusTable({
  analyses,
}: {
  analyses: ResearchOutcomeView["analyses"];
}) {
  if (analyses.length === 0) {
    return <p className="text-xs text-muted-foreground">还没有落成任何分析。</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">分析</TableHead>
            <TableHead className="w-12">优先级</TableHead>
            <TableHead className="w-24">状态</TableHead>
            <TableHead className="w-20">结果行</TableHead>
            <TableHead>分析名 / 目的</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {analyses.map((a) => (
            <TableRow key={a.analysisId}>
              <TableCell className="font-mono text-xs">#{a.analysisId}</TableCell>
              <TableCell className="text-xs">{a.priority ?? "—"}</TableCell>
              <TableCell>
                <span className="flex items-center gap-1 text-xs">
                  {a.status === "COMPLETED" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                  ) : a.status === "FAILED" || a.status === "CANCELLED" ? (
                    <XCircle className="h-3.5 w-3.5 text-rose-600" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                  {a.status}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs">{a.resultCount}</TableCell>
              <TableCell className="text-xs">
                <span className="font-mono text-[11px] text-muted-foreground">{a.analysisType}</span>
                <span className="ml-1.5">{a.name}</span>
                {a.purpose !== null && <span className="mt-0.5 block text-muted-foreground">{a.purpose}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** 结论类型的人读标签。 */
function conclusionTypeLabelOf(type: string): string {
  switch (type) {
    case "SUPPORTED":
      return "假设得到支持";
    case "PARTIALLY_SUPPORTED":
      return "部分支持";
    case "REJECTED":
      return "假设被否定";
    case "INCONCLUSIVE":
      return "证据不足以判断";
    default:
      return type;
  }
}
