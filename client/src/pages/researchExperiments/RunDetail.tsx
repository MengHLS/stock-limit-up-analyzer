
import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Database,
  ExternalLink,
  Info,
  Loader2,
  Play,
  Wrench,
} from "lucide-react";
import type { ExperimentArtifactRef } from "@shared/researchExperimentsContracts";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConfirmDialog, ErrorState, JsonBlock, MetricCard, TechnicalDetails } from "@/components/common";
import { rpcErrorToDiagnostic } from "@/lib/rpcDiagnostic";
import { experimentPageOf } from "@/researchExperiments";
import { useAuth } from "@/_core/hooks/useAuth";
import { GenericExperimentResult } from "./GenericResultView";
import {
  ArtifactCatalogCard,
  ArtifactIndexCard,
  ArtifactInlinePreview,
  ResultRawJson,
} from "./artifactViews";
import { MetadataRow, RunStatusBadge, formatDateTime, formatDuration } from "./runShared";

export default function ResearchExperimentRunDetail() {
  const params = useParams<{ group?: string; key?: string; runId?: string }>();
  const group = params.group ?? "";
  const key = params.key ?? "";
  const runId = decodeURIComponent(params.runId ?? "");
  const experimentId = `${decodeURIComponent(group)}/${decodeURIComponent(key)}`;
  const basePath = `/research-experiments/${encodeURIComponent(group)}/${encodeURIComponent(key)}`;

  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();

  const runQuery = trpc.researchExperiments.getRun.useQuery(
    { runId },
    {
      enabled: runId.length > 0,
      retry: false,
      staleTime: 15_000,
      refetchInterval: (query) => {
        const status = query.state.data?.run.status;
        return status === "PENDING" || status === "RUNNING" ? 2_000 : false;
      },
    },
  );
  const detail = runQuery.data;

  // 实验描述符（只为了拿名字 / 版本 / 自定义页面 key）—— 与 Run 事实是两条取数路径。
  const experimentQuery = trpc.researchExperiments.get.useQuery(
    { experimentId },
    { enabled: experimentId !== "/", retry: false, staleTime: 60_000 },
  );
  const descriptor = experimentQuery.data?.descriptor;

  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const reconcileMutation = trpc.researchExperiments.reconcileRun.useMutation({
    onSuccess: () => {
      setReconcileError(null);
      setReconcileOpen(false);
      void utils.researchExperiments.getRun.invalidate({ runId });
      void utils.researchExperiments.get.invalidate({ experimentId });
    },
    onError: (error) => {
      setReconcileError(error.message);
      setReconcileOpen(false);
    },
  });

  /**
   * 页内可预览的产物 —— **判据来自服务端**（`inlineViewable` 是服务端实测体积与形态后的
   * 权威裁决），前端不重算。这样「服务端说不可预览、前端却给按钮」在结构上不可能发生。
   */
  const previewables = useMemo<ExperimentArtifactRef[]>(
    () => (detail?.artifacts ?? []).filter((item) => item.inlineViewable).map((item) => item.ref),
    [detail?.artifacts],
  );

  if (runQuery.isLoading) {
    return (
      <div className="space-y-3 p-4 md:p-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (runQuery.error || detail === undefined) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <ErrorState
          error={rpcErrorToDiagnostic(runQuery.error?.message, {
            title: `Run ${runId || "（缺少 runId）"} 加载失败`,
          })}
        />
        <Button asChild variant="outline" size="sm">
          <Link href="/research-experiments">返回实验列表</Link>
        </Button>
      </div>
    );
  }

  const { run, manifest, result, artifacts, artifactsAvailable, artifactsError, dataIsolation } =
    detail;
  const PageComponent = descriptor ? experimentPageOf(descriptor.pageKey) : null;
  const summary = run.summary;
  const isFailed = run.status === "FAILED";
  const isRunning = run.status === "RUNNING";

  return (
    <div className="space-y-4 p-4 md:p-6" data-experiment-run-detail={run.runId}>
      {/* ① 头部：这是哪次运行、什么状态 */}
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <span>{run.experimentName}</span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  v{run.experimentVersion}
                </Badge>
                <RunStatusBadge run={run} />
              </CardTitle>
              <CardDescription className="space-y-0.5">
                <span className="block font-mono text-[11px]">Run {run.runId}</span>
                <span className="block font-mono text-[11px]">
                  experiment = {run.experimentId}
                </span>
                <span className="block break-all font-mono text-[11px]">
                  code = {run.experimentCodeDigest ?? "（历史 Run 未记录）"}
                </span>
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="ghost">
                <Link href={basePath} data-back-to-experiment="true">
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> 回到实验
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href="/research-experiments">全部实验</Link>
              </Button>
              {isRunning && isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-400 text-amber-700"
                  onClick={() => setReconcileOpen(true)}
                  data-reconcile-run="true"
                >
                  <Wrench className="mr-1.5 h-4 w-4" /> 判定为失败并收敛
                </Button>
              )}
            </div>
          </div>
          {isRunning && (
            <Alert className="border-blue-300 bg-blue-50">
              <Info className="h-4 w-4 shrink-0 text-blue-600" />
              <AlertDescription className="text-xs">
                这条 Run 仍处于 <span className="font-mono">RUNNING</span>。
                正常执行会在后台队列中收敛为 <span className="font-mono">COMPLETED</span> 或{" "}
                <span className="font-mono">FAILED</span>；若长时间停在这里（服务重启 / 进程退出），
                Run 元数据里会标记「可能已卡住」，管理员可在此**人为判定为失败**（不会删除任何产物）。
              </AlertDescription>
            </Alert>
          )}
        </CardHeader>
      </Card>

      {reconcileError && (
        <ErrorState
          error={rpcErrorToDiagnostic(reconcileError, { title: "收敛 Run 失败" })}
        />
      )}

      {/* 🔴 失败 Run 必须给出原因，绝不伪装成成功（规格 §21-E） */}
      {isFailed && (
        <Alert className="border-red-300 bg-red-50" data-run-failure="true">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <AlertTitle className="text-sm">
            本次运行失败
            <Badge variant="outline" className="ml-2 font-mono text-[10px]">
              {run.errorCode ?? "UNKNOWN"}
            </Badge>
          </AlertTitle>
          <AlertDescription className="space-y-1 text-xs">
            <p>{run.errorMessage ?? "（未记录错误信息）"}</p>
            <p className="text-muted-foreground">
              耗时 {formatDuration(run.durationMs)}；
              {run.resultManifestKey === null
                ? "没有写入 Manifest（失败 Run 不产出产物索引）。"
                : `Manifest 已写入：${run.resultManifestKey}`}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* ② 关键事实（一级信息层，全部来自 TiDB，不依赖对象存储） */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Dataset 版本"
          value={run.datasetVersionLabel}
          hint={`${run.datasetCode} · id=${run.datasetVersionId}`}
          mono={false}
        />
        <MetricCard label="开始" value={formatDateTime(run.startedAt)} mono={false} />
        <MetricCard label="结束" value={formatDateTime(run.completedAt)} mono={false} />
        <MetricCard
          label="耗时"
          value={formatDuration(run.durationMs)}
          tone={isFailed ? "danger" : run.status === "COMPLETED" ? "success" : undefined}
        />
        <MetricCard
          label="候选样本"
          value={summary?.candidateCount ?? "—"}
          hint={summary ? "来自落库轻量摘要" : "未落库摘要"}
        />
        <MetricCard label="入池（eligible）" value={summary?.eligibleCount ?? "—"} />
        <MetricCard label="剔除（excluded）" value={summary?.excludedCount ?? "—"} />
        <MetricCard
          label="产物个数"
          value={summary?.artifactCount ?? artifacts.length}
          hint="含 result / manifest"
        />
        <MetricCard
          label="研究阶段"
          value={run.researchPhase ?? "EXPLORATORY"}
          mono={false}
        />
        <MetricCard
          label="确认 Gate"
          value={run.confirmatoryGate?.status ?? "—"}
          tone={
            run.confirmatoryGate?.status === "PASS"
              ? "success"
              : run.confirmatoryGate?.status === "FAIL"
                ? "danger"
                : undefined
          }
        />
      </div>

      {dataIsolation?.status === "CONTAMINATED" && (
        <Alert variant="destructive" data-run-data-isolation="contaminated">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>该 Holdout 已被历史 Run 污染，不能作为正式策略证据</AlertTitle>
          <AlertDescription>
            {dataIsolation.summary}
            <span className="mt-1 block font-mono text-xs">
              污染 Run：{dataIsolation.contaminatedRunIds.join(", ")}
            </span>
          </AlertDescription>
        </Alert>
      )}

      {(run.researchPhase === "OBSERVATION" || run.researchPhase === "HOLDOUT") && (
        <Card data-run-protocol="true">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Research Protocol</CardTitle>
            <CardDescription className="text-xs">
              确认性研究的阶段、冻结窗口与 Gate；Holdout 只允许引用匹配的 Observation Run。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="grid gap-1.5 sm:grid-cols-2">
              <MetadataRow label="阶段" value={run.researchPhase ?? "—"} />
              <MetadataRow
                label="协议"
                value={
                  run.protocolId
                    ? `${run.protocolId}@${run.protocolVersion ?? "—"}`
                    : "—"
                }
              />
              <MetadataRow
                label="评估窗口"
                value={
                  run.evaluationWindow
                    ? `${run.evaluationWindow.startDate} ~ ${run.evaluationWindow.endDate}`
                    : "—"
                }
              />
              <MetadataRow label="父 Run" value={run.parentRunId ?? "—"} />
              <MetadataRow
                label="协议指纹"
                value={run.protocolFingerprint ?? "—"}
              />
            </div>
            {run.confirmatoryGate && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  <p className="font-medium">
                    Gate：{run.confirmatoryGate.status}
                  </p>
                  <p className="text-muted-foreground">{run.confirmatoryGate.summary}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {run.confirmatoryGate.checks.map((check) => (
                      <Badge key={check.code} variant="outline" className="font-mono text-[10px]">
                        {check.code}: {check.status}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {/* ③ 轻量摘要（TiDB 里那份；避免为看几个数字去拉 result.json） */}
          <Card data-run-summary="true">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">落库摘要（Summary）</CardTitle>
              <CardDescription className="text-xs">
                这些数字随 Run 一起写进 TiDB，因此列表页 / 本页**不需要**读对象存储就能显示。
                与下方 Result 内容不一致时，以 Result 为准（摘要是轻量的）。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {summary === null ? (
                <p className="text-muted-foreground">
                  这条 Run 没有落库摘要（多为失败 Run 或早期记录）。
                </p>
              ) : (
                <>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <MetadataRow label="执行结论" value={summary.runStatus} />
                    <MetadataRow
                      label="信息边界"
                      value={
                        summary.forwardDataRead === null
                          ? "未记录"
                          : summary.forwardDataRead
                            ? "读取了事件日之后数据"
                            : "未读取事件日之后数据"
                      }
                    />
                    <MetadataRow
                      label="读到的行数"
                      value={`prefix ${summary.prefixRowCount ?? "—"} · post ${summary.postRowCount ?? "—"}`}
                    />
                    <MetadataRow label="日志行数" value={String(summary.logLineCount)} />
                  </div>
                  <Separator />
                  <div>
                    <p className="mb-1 font-medium">剔除原因分布（样本为何变少）</p>
                    {summary.excludedByReason === null ||
                    Object.keys(summary.excludedByReason).length === 0 ? (
                      <p className="text-muted-foreground">无剔除记录。</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(summary.excludedByReason)
                          .sort((a, b) => b[1] - a[1])
                          .map(([code, count]) => (
                            <Badge key={code} variant="outline" className="font-mono text-[10px]">
                              {code}: {count}
                            </Badge>
                          ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              <Separator />
              <div className="grid gap-1.5 sm:grid-cols-2">
                <MetadataRow label="resultSchemaVersion" value={run.resultSchemaVersion ?? "—"} />
                <MetadataRow label="resultManifestKey" value={run.resultManifestKey ?? "—"} />
                <MetadataRow label="createdAt" value={formatDateTime(run.createdAt)} />
                <MetadataRow label="updatedAt" value={formatDateTime(run.updatedAt)} />
              </div>
            </CardContent>
          </Card>

          {/* ④ 参数快照（写入即冻结，代码改了也仍能读懂这条历史 Run） */}
          <Card data-run-parameters="true">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">参数（写入时快照）</CardTitle>
              <CardDescription className="text-xs">
                已归并默认值后的实际参数。默认值来自**当时的**实验声明 —— 因此即使实验代码后来改了，
                这条历史 Run 仍然读得懂。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <JsonBlock value={run.parameters} emptyText="本实验没有参数。" />
            </CardContent>
          </Card>

          {/* ⑤ 结果 */}
          {result === null ? (
            <Card data-run-result="absent">
              <CardContent className="flex items-start gap-2 p-6 text-sm text-muted-foreground">
                <Ban className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p>这条 Run 没有可读取的结果。</p>
                  <p className="text-xs">
                    {isFailed
                      ? "因为本次执行失败（失败 Run 不产生结果信封）。失败原因见上方红色提示。"
                      : artifactsAvailable
                        ? "Run 状态是成功，但对象存储里没有结果对象 —— 这属于异常，请检查上面的产物存在性核验。"
                        : "对象存储本次不可读，因此拿不到结果。"}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4" data-run-result="present">
              <GenericExperimentResult
                result={result}
                pageKey={descriptor?.pageKey ?? "（实验未注册）"}
                reason="本页展示的是持久化下来的结果信封。"
                registrationNotice={
                  PageComponent
                    ? {
                        title: "这里是「持久化结果」视图，不是实验的自定义页面",
                        description:
                          "该实验注册了自定义结果页面（含 customPayload 等自有结构），但自定义页面需要本次执行的完整执行事实（execution），本页只持有持久化结果。要查看完整视图，请回到实验页重新运行一次。",
                      }
                    : null
                }
              />

              {PageComponent && (
                <Alert>
                  <Info className="h-4 w-4 shrink-0" />
                  <AlertDescription className="text-xs">
                    该实验有自定义结果页面（pageKey ={" "}
                    <span className="font-mono">{descriptor?.pageKey}</span>）。
                    <Link className="mx-1 underline" href={basePath}>
                      回到 {descriptor?.name ?? "实验页"}
                    </Link>
                    运行一次即可看到完整自定义视图。
                  </AlertDescription>
                </Alert>
              )}

              <Card data-run-result-raw="true">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">结果原始 JSON</CardTitle>
                  <CardDescription className="text-xs">
                    默认显示为键值表；需要看嵌套结构时切到「原文」。这是**对象存储里那份**
                    `result.json` 的内容（经后端读取，前端不接触凭据）。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResultRawJson result={result} />
                </CardContent>
              </Card>
            </div>
          )}

          {/* ⑥ 产物：Manifest 索引 + 实测存在性 */}
          {manifest === null ? (
            <Card data-run-manifest="absent">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">产物清单</CardTitle>
                <CardDescription className="text-xs">
                  {artifactsAvailable
                    ? "这条 Run 没有 Manifest（失败 Run 不产出产物索引）。"
                    : "对象存储本次不可读，因此拿不到 Manifest。"}
                </CardDescription>
              </CardHeader>
              {!artifactsAvailable && artifactsError && (
                <CardContent>
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="font-mono">{artifactsError.code}</span>：{artifactsError.message}
                    <br />
                    这不代表产物丢了 —— 只是本次没能读到。
                  </p>
                </CardContent>
              )}
            </Card>
          ) : (
            <>
              <ArtifactIndexCard runId={run.runId} manifest={manifest} />
              <ArtifactCatalogCard
                runId={run.runId}
                artifacts={artifacts}
                available={artifactsAvailable}
                error={artifactsError}
              />
              {previewables.length > 0 && (
                <Card data-run-artifact-preview="true">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">文本产物页内预览</CardTitle>
                    <CardDescription className="text-xs">
                      CSV / JSON / 日志等文本产物可以在这里**按需**加载（点按钮才请求字节）。
                      二进制与小体积以外的格式一律只给打开 / 下载入口。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {previewables.map((ref) => (
                      <div key={ref.key} className="space-y-1.5">
                        <p className="text-xs font-medium">
                          {ref.label}
                          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                            {ref.format} · {ref.key}
                          </span>
                        </p>
                        <ArtifactInlinePreview runId={run.runId} artifact={ref} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* ⑦ 技术详情（工程字段默认折叠） */}
          <TechnicalDetails title="技术详情（Object Key / schema 版本 / 状态迁移线索）">
            <div className="grid gap-1.5 text-xs sm:grid-cols-2">
              <MetadataRow label="runId" value={run.runId} />
              <MetadataRow label="experimentId" value={run.experimentId} />
              <MetadataRow label="状态" value={run.status} />
              <MetadataRow label="stale（可能已卡住）" value={run.stale ? "true" : "false"} />
              <MetadataRow label="datasetVersionId" value={String(run.datasetVersionId)} />
              <MetadataRow label="resultSchemaVersion" value={run.resultSchemaVersion ?? "—"} />
              <MetadataRow label="resultManifestKey" value={run.resultManifestKey ?? "—"} />
              <MetadataRow label="errorCode" value={run.errorCode ?? "—"} />
              <MetadataRow label="createdAt" value={run.createdAt} />
              <MetadataRow label="updatedAt" value={run.updatedAt} />
            </div>
            {manifest && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium">Manifest 原文</p>
                <pre className="max-h-72 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
                  {JSON.stringify(manifest, null, 2)}
                </pre>
              </div>
            )}
          </TechnicalDetails>
        </div>

        {/* 右侧：坐标与快捷入口 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="h-4 w-4" /> Dataset 坐标
              </CardTitle>
              <CardDescription className="text-xs">
                本 Run 只读**这一个** Dataset 版本（软引用，非外键）。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              <MetadataRow label="datasetCode" value={run.datasetCode} />
              <MetadataRow label="版本名" value={run.datasetVersionLabel} />
              <MetadataRow label="datasetVersionId" value={String(run.datasetVersionId)} />
              <Button asChild size="sm" variant="outline" className="mt-2 h-7 w-full">
                <Link
                  href={`/datasets/${encodeURIComponent(run.datasetCode)}/versions/${run.datasetVersionId}`}
                  data-open-dataset-version={String(run.datasetVersionId)}
                >
                  <ExternalLink className="mr-1 h-3 w-3" /> 打开数据集版本
                </Link>
              </Button>
            </CardContent>
          </Card>

          {descriptor && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Play className="h-4 w-4" /> 再跑一次
                </CardTitle>
                <CardDescription className="text-xs">
                  本页是**只读**的历史视图。要产生新结果，请回实验页运行
                  （新 Run 会另起一行，**不会覆盖**这条历史 Run）。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5 text-xs">
                <MetadataRow label="实验" value={`${descriptor.name} v${descriptor.version}`} />
                <MetadataRow label="pageKey" value={descriptor.pageKey} />
                <Button asChild size="sm" variant="outline" className="mt-2 h-7 w-full">
                  <Link href={`${basePath}?datasetVersionId=${run.datasetVersionId}`}>
                    <Play className="mr-1 h-3 w-3" /> 回实验页并带入本 Run 的 Dataset
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {experimentQuery.error && (
            <Card>
              <CardContent className="p-4 text-xs text-muted-foreground">
                实验描述符读取失败（<span className="font-mono">{experimentQuery.error.message}</span>
                ）—— 不影响本页展示的 Run 事实。
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={reconcileOpen}
        onOpenChange={setReconcileOpen}
        title={`把 Run ${run.runId} 判定为失败？`}
        description="这只改 Run 的元数据状态（RUNNING → FAILED），不会删除任何产物。适用于「服务重启 / 请求被中断」导致永远停在 RUNNING 的情况。"
        confirmLabel="判定为失败"
        tone="danger"
        pending={reconcileMutation.isPending}
        onConfirm={() => reconcileMutation.mutate({ runId: run.runId, reason: "人工在 Run 详情页判定为失败" })}
      />

      {runQuery.isFetching && !runQuery.isLoading && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> 刷新中…
        </p>
      )}
    </div>
  );
}
