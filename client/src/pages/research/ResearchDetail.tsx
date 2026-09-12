/**
 * ResearchDetail — 研究工作台（`/research/:experimentId`）。
 *
 * 一条线性链路：实验 → Run → 分析 → 运行引擎 → 结果 → 结论。
 * 页面本身不做任何统计，只做编排与「后端事实的可见化」：
 *   - Run 的失败原因（errorCode / errorMessage）必须出现在列表里，不能只在日志里；
 *   - 分析状态、结果行数、耗时都来自后端；
 *   - 「运行引擎」按钮的可点击性由 Run 状态决定（与后端 `RUN_NOT_PENDING` 同源）。
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  BarChart3,
  Braces,
  FileText,
  FlaskConical,
  Grid3x3,
  History,
  Layers,
  Lightbulb,
  Plus,
  Search,
  Sigma,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, SectionCard, StatusBadge } from "@/components/common";
import {
  formatCount,
  formatDateTime,
  formatDuration,
  rpcErrorToDiagnostic,
  runToVm,
} from "@/adapters/researchEngineAdapter";
import {
  AnalysisConditionEditor,
  AnalysisResultsView,
  BatchAnalysisDialog,
  CandidatesPanel,
  ConclusionPanel,
  ConfirmDeleteButton,
  CreateAnalysisDialog,
  ExperimentActions,
  ResearchMatrixView,
  RunEngineButton,
  RunExecutionBatches,
  RunIncrementalButton,
  VariableCatalogCard,
  incrementalRunForm,
  researchTypeLabelOf,
} from "@/components/research";

export default function ResearchDetail() {
  const params = useParams();
  const experimentId = Number(params.experimentId);
  const validId = Number.isFinite(experimentId) && experimentId > 0;

  const detail = trpc.researchEngine.getExperiment.useQuery(
    { experimentId },
    { enabled: validId },
  );

  const runs = useMemo(() => (detail.data?.runs ?? []).map(runToVm), [detail.data]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  // 默认选中最新一次 Run（runNo 最大）
  useEffect(() => {
    if (runs.length === 0) return;
    if (selectedRunId !== null && runs.some((r) => r.id === selectedRunId)) return;
    const latest = [...runs].sort((a, b) => b.runNo - a.runNo)[0]!;
    setSelectedRunId(latest.id);
  }, [runs, selectedRunId]);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

  const runDetail = trpc.researchEngine.getRun.useQuery(
    { runId: selectedRunId ?? 0 },
    { enabled: selectedRunId !== null && selectedRunId > 0 },
  );
  const analyses = runDetail.data?.analyses ?? [];

  const [selectedAnalysisId, setSelectedAnalysisId] = useState<number | null>(null);
  useEffect(() => {
    if (analyses.length === 0) {
      setSelectedAnalysisId(null);
      return;
    }
    if (selectedAnalysisId !== null && analyses.some((a) => a.id === selectedAnalysisId)) return;
    setSelectedAnalysisId(analyses[0]!.id ?? null);
  }, [analyses, selectedAnalysisId]);

  /**
   * 结果页签的两种视图。
   *
   * `matrix`（默认）：把「决策日 × 回撤桶」这类**批量建出来的**分析拼回一张表 ——
   * 一个 Run 动辄上百个分析，逐个点开的平铺按钮列表**看不出横向可比性**，而这类分析的
   * 全部信息本身就是一张二维表。默认给矩阵就是为了让「哪一格站得住」第一眼可见。
   *
   * `single`：原有逐分析视图，负责「**这一格**里到底筛了什么、逐指标是多少」。
   * 矩阵里点任一格会切到这里并选中该分析。
   */
  const [resultView, setResultView] = useState<"matrix" | "single">("matrix");
  const [analysisQuery, setAnalysisQuery] = useState("");

  /** 矩阵视图只需要 name / target / status（解析规则见 `researchMatrix.ts`）。 */
  const matrixAnalyses = useMemo(
    () =>
      analyses.flatMap((a) =>
        a.id === undefined ? [] : [{ id: a.id, name: a.name, target: a.target ?? null, status: a.status }],
      ),
    [analyses],
  );

  const visibleAnalyses = useMemo(() => {
    const q = analysisQuery.trim().toLowerCase();
    if (q.length === 0) return analyses;
    return analyses.filter((a) => a.name.toLowerCase().includes(q) || String(a.id).includes(q));
  }, [analyses, analysisQuery]);

  const createRun = trpc.researchEngine.createRun.useMutation();
  const removeRun = trpc.researchEngine.deleteRun.useMutation();
  const removeAnalysis = trpc.researchEngine.deleteAnalysis.useMutation();
  const utils = trpc.useUtils();

  async function handleCreateRun() {
    try {
      const run = await createRun.mutateAsync({ experimentId });
      await utils.researchEngine.getExperiment.invalidate();
      toast.success(`已创建 Run #${run.runNo}`, {
        description: "接下来在「分析」里添加至少一个分析，再点「运行引擎」。",
      });
      setSelectedRunId(run.id!);
    } catch (e) {
      toast.error("创建 Run 失败", {
        description: rpcErrorToDiagnostic(e instanceof Error ? e.message : String(e)).explanation,
      });
    }
  }

  if (!validId) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState
          error={{
            code: "BAD_REQUEST",
            title: "无效的实验 ID",
            explanation: "URL 中的 experimentId 不是合法整数。",
            suggestions: ["返回研究实验列表重新选择"],
          }}
        />
      </div>
    );
  }

  if (detail.isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (detail.error) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState
          error={rpcErrorToDiagnostic(detail.error.message, { title: "实验加载失败" })}
        />
      </div>
    );
  }

  const experiment = detail.data!.experiment;
  const version = detail.data!.datasetVersion;
  const hypotheses = detail.data!.hypotheses;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <Link
                href="/research"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              >
                <ArrowLeft className="h-3 w-3" /> 返回实验列表
              </Link>
              <CardTitle className="flex items-center gap-2 text-base">
                <FlaskConical className="h-4 w-4" /> {experiment.name}
              </CardTitle>
              <CardDescription>{experiment.description ?? "（未填描述）"}</CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge status={experiment.status} />
              <ExperimentActions
                experimentId={experimentId}
                name={experiment.name}
                description={experiment.description ?? null}
                datasetLabel={
                  version
                    ? `${version.datasetName}（${version.datasetCode}）· ${version.versionLabel}`
                    : `DatasetVersionId ${experiment.datasetVersionId}`
                }
              />
              <Button size="sm" variant="outline" onClick={handleCreateRun} disabled={createRun.isPending}>
                <Plus className="mr-1.5 h-4 w-4" /> 新建 Run
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>研究类型：{researchTypeLabelOf(experiment.researchType)}</span>
            <span>
              Dataset：{version ? `${version.datasetName}（${version.datasetCode}）` : "—"}
            </span>
            {version && (
              <span className="flex items-center gap-1.5">
                版本 <span className="font-mono">{version.versionLabel}</span>
                <StatusBadge status={version.status} />
                {version.startDate ?? "—"} ~ {version.endDate ?? "—"}
                {" · "}
                {formatCount(version.totalEvents)} 个事件
              </span>
            )}
            <span>创建于 {formatDateTime(experiment.createdAt)}</span>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="pipeline">
        <TabsList>
          <TabsTrigger value="pipeline" className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" /> 执行链路
          </TabsTrigger>
          <TabsTrigger value="results" className="flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> 结果
          </TabsTrigger>
          <TabsTrigger value="conclusion" className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> 结论
          </TabsTrigger>
          <TabsTrigger value="candidates" className="flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5" /> 策略候选
          </TabsTrigger>
          <TabsTrigger value="variables" className="flex items-center gap-1.5">
            <Braces className="h-3.5 w-3.5" /> 变量目录
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4 pt-3">
          <SectionCard title="假设" icon={Lightbulb} description="结论会挂在假设上；没有假设时自动结论仍然生成，但无法回答「假设是否被支持」。">
            {hypotheses.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                这个实验没有登记假设。可以新建实验时同时登记，或在「新建实验」对话框中补一条。
              </p>
            ) : (
              <ul className="space-y-2">
                {hypotheses.map((h) => (
                  <li key={h.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{h.name}</span>
                      <StatusBadge status={h.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{h.statement}</p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="运行（Run）"
            icon={Layers}
            description="一次 Run = 一次可复现的执行。已 COMPLETED 的 Run 不会被覆盖；新增的分析用下方列表里的「补跑」，要整轮重跑请新建 Run。"
            right={
              selectedRun && (
                <RunEngineButton
                  experimentId={experimentId}
                  runId={selectedRun.id}
                  runStatus={selectedRun.status}
                  analysisCount={analyses.length}
                  runnableAnalysisCount={incrementalRunForm.countRunnableAnalyses(
                    selectedRun.status,
                    analyses.map((a) => a.status),
                    selectedRun.hasInputSnapshot,
                  )}
                  onFinished={() => {
                    void utils.researchEngine.getRun.invalidate();
                    void utils.researchEngine.getExperiment.invalidate();
                  }}
                />
              )
            }
          >
            {runs.length === 0 ? (
              <EmptyState
                icon={Layers}
                title="还没有 Run"
                description="Run 是分析的容器。先新建一个 Run，再添加分析并执行。"
                action={
                  <Button size="sm" onClick={handleCreateRun} disabled={createRun.isPending}>
                    <Plus className="mr-1.5 h-4 w-4" /> 新建 Run
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Run</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">样本量</TableHead>
                    <TableHead className="text-right">耗时</TableHead>
                    <TableHead className="text-right">结束时间</TableHead>
                    <TableHead>失败原因</TableHead>
                    <TableHead className="w-28 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow
                      key={r.id}
                      onClick={() => setSelectedRunId(r.id)}
                      className={`cursor-pointer ${r.id === selectedRunId ? "bg-muted/60" : ""}`}
                    >
                      <TableCell className="font-mono text-xs">#{r.runNo}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatCount(r.sampleCount)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatDuration(r.durationMs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {formatDateTime(r.completedAt)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.errorCode ? (
                          <span className="text-red-700">
                            <span className="font-mono">{r.errorCode}</span>
                            {r.errorMessage ? ` · ${r.errorMessage}` : ""}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <ConfirmDeleteButton
                          label="删 Run"
                          title={`删除 Run #${r.runNo}？`}
                          consequence={
                            <div className="space-y-1.5 text-xs">
                              <p>会连带删除该 Run 下的全部分析（含条件、指标定义、结果行）。</p>
                              <p>
                                结论是「实验级」实体（不带 runId），服务端按结论证据里的 analysisId
                                精确判定归属：只删由本 Run 的分析产出的结论；归属无法判定的结论会保留并计数上报。
                              </p>
                              <p className="text-amber-800">
                                执行中（RUNNING）的 Run 会被拒绝删除。
                              </p>
                            </div>
                          }
                          onConfirm={async () => {
                            const result = await removeRun.mutateAsync({ runId: r.id });
                            await Promise.all([
                              utils.researchEngine.getExperiment.invalidate(),
                              utils.researchEngine.listConclusions.invalidate(),
                            ]);
                            return {
                              summary:
                                result.unattributedConclusions > 0
                                  ? `${result.summary}；另有 ${result.unattributedConclusions} 条结论无法判定归属，已保留`
                                  : result.summary,
                            };
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {selectedRun && (
              <div className="mt-4 space-y-2 border-t pt-3">
                <div className="flex items-center gap-2">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-medium">执行批次（Run #{selectedRun.runNo}）</p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  一条 Run 的结果可能来自多个批次：整轮执行落定基准，之后新增的分析走「补跑」。
                  批次日志是追加式的历史事实，不随分析删除而改写。
                </p>
                <RunExecutionBatches log={selectedRun.executionLog ?? null} />
              </div>
            )}
          </SectionCard>

          {selectedRun && (
            <SectionCard
              title={`分析（Run #${selectedRun.runNo}）`}
              icon={Sigma}
              description="每个分析独立实现、独立落库。变量选项来自当前 Dataset 版本的真实视界。"
              right={
                <div className="flex items-center gap-2">
                  <CreateAnalysisDialog
                    datasetVersionId={experiment.datasetVersionId}
                    runId={selectedRun.id}
                    onCreated={(id) => {
                      setSelectedAnalysisId(id);
                      void utils.researchEngine.getRun.invalidate();
                    }}
                  />
                  <BatchAnalysisDialog
                    datasetVersionId={experiment.datasetVersionId}
                    experimentId={experiment.id}
                    runId={selectedRun.id}
                    onCreated={() => {
                      void utils.researchEngine.getRun.invalidate();
                      void utils.researchEngine.listAnalyses.invalidate();
                    }}
                  />
                </div>
              }
            >
              {runDetail.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : analyses.length === 0 ? (
                <EmptyState
                  icon={Sigma}
                  title="这个 Run 还没有分析"
                  description="引擎需要至少一个分析才能执行。先新建分析，再点「运行引擎」。"
                  action={
                    <CreateAnalysisDialog
                      datasetVersionId={experiment.datasetVersionId}
                      runId={selectedRun.id}
                      onCreated={(id) => {
                        setSelectedAnalysisId(id);
                        void utils.researchEngine.getRun.invalidate();
                      }}
                    />
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">ID</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>目标</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">结束时间</TableHead>
                      <TableHead className="w-80 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analyses.map((a) => (
                      <TableRow
                        key={a.id}
                        onClick={() => setSelectedAnalysisId(a.id!)}
                        className={`cursor-pointer ${a.id === selectedAnalysisId ? "bg-muted/60" : ""}`}
                      >
                        <TableCell className="font-mono text-xs">#{a.id}</TableCell>
                        <TableCell className="text-xs">{a.analysisType}</TableCell>
                        <TableCell className="text-xs">{a.name}</TableCell>
                        <TableCell className="font-mono text-xs">{a.target ?? "—"}</TableCell>
                        <TableCell>
                          <StatusBadge status={a.status} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {formatDateTime(a.completedAt)}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <RunIncrementalButton
                              experimentId={experimentId}
                              runId={selectedRun.id}
                              runStatus={selectedRun.status}
                              analysisId={a.id!}
                              analysisStatus={a.status}
                              hasSnapshot={selectedRun.hasInputSnapshot}
                              onFinished={() => {
                                void utils.researchEngine.getRun.invalidate();
                                void utils.researchEngine.getAnalysisResults.invalidate();
                              }}
                            />
                            <AnalysisConditionEditor
                              analysisId={a.id!}
                              datasetVersionId={experiment.datasetVersionId}
                              analysisName={a.name}
                            />
                            <ConfirmDeleteButton
                              label="删分析"
                              title={`删除分析 #${a.id}（${a.analysisType}）？`}
                              consequence={
                                <div className="space-y-1.5 text-xs">
                                  <p>会删除该分析的条件、指标定义与全部结果行。</p>
                                  <p>证据指向该分析的结论也会一并删除；其所属 Run 保留不动。</p>
                                  <p className="text-amber-800">执行中（RUNNING）的分析会被拒绝删除。</p>
                                </div>
                              }
                              onConfirm={async () => {
                                const result = await removeAnalysis.mutateAsync({
                                  analysisId: a.id!,
                                });
                                await Promise.all([
                                  utils.researchEngine.getRun.invalidate(),
                                  utils.researchEngine.getExperiment.invalidate(),
                                  utils.researchEngine.listConclusions.invalidate(),
                                  utils.researchEngine.getAnalysisResults.invalidate(),
                                ]);
                                return { summary: result.summary };
                              }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>
          )}
        </TabsContent>

        <TabsContent value="results" className="space-y-3 pt-3">
          {!selectedRun ? (
            <EmptyState icon={BarChart3} title="请先选择一个 Run" />
          ) : analyses.length === 0 ? (
            <EmptyState icon={BarChart3} title="该 Run 下还没有分析" />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant={resultView === "matrix" ? "default" : "outline"}
                    onClick={() => setResultView("matrix")}
                  >
                    <Grid3x3 className="mr-1.5 h-3.5 w-3.5" /> 矩阵视图
                  </Button>
                  <Button
                    size="sm"
                    variant={resultView === "single" ? "default" : "outline"}
                    onClick={() => setResultView("single")}
                  >
                    <Sigma className="mr-1.5 h-3.5 w-3.5" /> 逐分析
                  </Button>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  该 Run 共 {analyses.length} 个分析
                  {resultView === "single" && selectedAnalysisId !== null ? ` · 当前 #${selectedAnalysisId}` : ""}
                </span>
              </div>

              {resultView === "matrix" ? (
                <ResearchMatrixView
                  analyses={matrixAnalyses}
                  onSelectAnalysis={(id) => {
                    setSelectedAnalysisId(id);
                    setResultView("single");
                  }}
                />
              ) : (
                <>
                  {analyses.length > 20 && (
                    <div className="relative max-w-sm">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={analysisQuery}
                        onChange={(e) => setAnalysisQuery(e.target.value)}
                        placeholder="按名称或 ID 过滤分析…"
                        className="w-full rounded border bg-background py-1 pl-7 pr-2 text-xs"
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {visibleAnalyses.map((a) => (
                      <Button
                        key={a.id}
                        size="sm"
                        variant={a.id === selectedAnalysisId ? "default" : "outline"}
                        title={`${a.name}${a.target ? ` · ${a.target}` : ""}`}
                        onClick={() => setSelectedAnalysisId(a.id!)}
                      >
                        #{a.id} {a.name.length > 30 ? `${a.name.slice(0, 30)}…` : a.name}
                      </Button>
                    ))}
                    {visibleAnalyses.length === 0 && (
                      <span className="text-xs text-muted-foreground">没有匹配「{analysisQuery}」的分析</span>
                    )}
                  </div>
                  {selectedAnalysisId !== null && <AnalysisResultsView analysisId={selectedAnalysisId} />}
                </>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="conclusion" className="pt-3">
          <ConclusionPanel experimentId={experimentId} />
        </TabsContent>

        <TabsContent value="candidates" className="pt-3">
          <CandidatesPanel experimentId={experimentId} />
        </TabsContent>

        <TabsContent value="variables" className="pt-3">
          <VariableCatalogCard datasetVersionId={experiment.datasetVersionId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
