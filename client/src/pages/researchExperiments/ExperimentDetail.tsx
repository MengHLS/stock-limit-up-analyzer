/**
 * 独立研究实验详情 / 运行页（`/research-experiments/:group/:key`，RESEARCH-EXPERIMENT-001）。
 *
 * ## 平台负责什么（规格 §13 / §7）
 *
 * 本页是**通用外壳**，与具体实验无关：
 *   1. 显示实验元数据（名称 / 版本 / 来源 / 说明）与 Dataset 需求声明；
 *   2. Dataset 版本选择器（**坐标进 URL**，见下）+ 由参数定义自动渲染的参数表单；
 *   3. 「运行」动作（pending 时**换文案**并给出量级，见 `.workbuddy/memory/MEMORY.md` 的
 *      「长请求按钮 pending 必须换文案」）；
 *   4. 执行状态（loading / 成功 / 失败）、执行元数据（耗时 / Dataset 坐标 / 实际参数 / 日志）；
 *   5. 结果：`pageKey` 命中客户端页面注册表 ⇒ 挂载**实验自己的页面**；否则降级到通用渲染器。
 *
 * ## 两条刻意的设计
 *
 * - 🔴 **坐标进 URL**：Dataset 版本来自 `?datasetVersionId=`，默认取最新版本。
 *   刷新 / 分享 / 后退都不会丢坐标 —— 「靠内存态才能到达」是上一轮踩过的坑。
 * - 🔴 **结果不落库（如实告知）**：本体系**不新增数据库表**（规格 §9），
 *   执行是请求内计算，因此**刷新页面后需要重跑**。这一点在页面上明确写出，
 *   而不是让用户对着空结果猜「是不是坏了」。
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { AlertTriangle, Database, FlaskConical, Info, Loader2, Play, RefreshCw } from "lucide-react";
import type {
  ExperimentParameterValues,
  ExperimentRunOutcome,
} from "@shared/researchExperimentsContracts";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ErrorState } from "@/components/common";
import { rpcErrorToDiagnostic } from "@/lib/rpcDiagnostic";
import { experimentPageOf } from "@/researchExperiments";
import { GenericExperimentResult } from "./GenericResultView";

/** 表单原始值（保持字符串形态，避免输入过程中被数字转换吃掉中间态）。 */
type RawValue = string | boolean;

function defaultRawValue(kind: string, defaultValue: unknown): RawValue {
  if (kind === "BOOLEAN") return defaultValue === true;
  if (kind === "INT_LIST") return Array.isArray(defaultValue) ? defaultValue.join(",") : "";
  return defaultValue === undefined || defaultValue === null ? "" : String(defaultValue);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export default function ResearchExperimentDetail() {
  const params = useParams<{ group?: string; key?: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();

  const experimentId = `${decodeURIComponent(params.group ?? "")}/${decodeURIComponent(params.key ?? "")}`;
  const basePath = `/research-experiments/${encodeURIComponent(params.group ?? "")}/${encodeURIComponent(params.key ?? "")}`;

  const descriptorQuery = trpc.researchExperiments.get.useQuery(
    { experimentId },
    { enabled: experimentId !== "/", retry: false },
  );
  const descriptor = descriptorQuery.data;

  const versionsQuery = trpc.researchExperiments.listDatasetVersions.useQuery(
    { datasetCode: descriptor?.datasetRequirement.datasetCode ?? "" },
    { enabled: descriptor !== undefined, staleTime: 60_000 },
  );
  const versionOptions = versionsQuery.data ?? [];

  // ---- Dataset 版本坐标：URL 是唯一权威（默认取最新） ----
  const deepLinkVersionId = useMemo(() => {
    const raw = new URLSearchParams(search).get("datasetVersionId");
    if (raw === null || raw.trim() === "") return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [search]);
  const selectedVersionId = deepLinkVersionId ?? versionOptions[0]?.datasetVersionId ?? null;
  const selectedVersion = versionOptions.find((v) => v.datasetVersionId === selectedVersionId) ?? null;

  // ---- 参数表单（默认值来自描述符；改口径只改后端声明） ----
  const [rawParams, setRawParams] = useState<Record<string, RawValue>>({});
  useEffect(() => {
    if (!descriptor) return;
    const next: Record<string, RawValue> = {};
    for (const param of descriptor.parameters) {
      next[param.code] = defaultRawValue(param.kind, param.defaultValue);
    }
    setRawParams(next);
  }, [descriptor?.id, descriptor?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const [paramError, setParamError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ExperimentRunOutcome | null>(null);
  const [rpcError, setRpcError] = useState<{ message: string } | null>(null);

  const runMutation = trpc.researchExperiments.run.useMutation({
    onSuccess: (data) => {
      setOutcome(data);
      setRpcError(null);
    },
    onError: (error) => {
      // 🔴 响亮提示，不静默：tRPC 错误与「执行失败」是两类事实，分开呈现。
      setRpcError({ message: error.message });
      setOutcome(null);
    },
  });

  /** 把表单原始值编译成入参；非法即**拒绝提交并提示**（服务端仍会独立校验）。 */
  function buildParameters(): ExperimentParameterValues | null {
    if (!descriptor) return null;
    const values: Record<string, number | boolean | string | number[]> = {};
    for (const param of descriptor.parameters) {
      const raw = rawParams[param.code];
      if (param.kind === "BOOLEAN") {
        values[param.code] = raw === true;
        continue;
      }
      const text = typeof raw === "string" ? raw.trim() : "";
      if (text === "") {
        // 空串 = 不提交（由后端用 defaultValue 归并），与服务端「缺省即默认」语义一致。
        continue;
      }
      if (param.kind === "INT_LIST") {
        const parts = text
          .split(/[,，\s]+/)
          .map((part) => part.trim())
          .filter((part) => part !== "");
        const numbers = parts.map((part) => Number(part));
        if (numbers.some((n) => !Number.isInteger(n))) {
          setParamError(`「${param.label}」需要整数列表（逗号分隔），当前值：${text}`);
          return null;
        }
        values[param.code] = numbers;
        continue;
      }
      const numeric = Number(text);
      if ((param.kind === "INT" || param.kind === "NUMBER") && !Number.isFinite(numeric)) {
        setParamError(`「${param.label}」需要数值，当前值：${text}`);
        return null;
      }
      if (param.kind === "INT" && !Number.isInteger(numeric)) {
        setParamError(`「${param.label}」需要整数，当前值：${text}`);
        return null;
      }
      values[param.code] = param.kind === "ENUM" ? text : numeric;
    }
    setParamError(null);
    return values;
  }

  function handleRun() {
    if (descriptor === undefined || selectedVersionId === null) return;
    const parameters = buildParameters();
    if (parameters === null) return;
    runMutation.mutate({
      experimentId: descriptor.id,
      datasetVersionId: selectedVersionId,
      parameters,
    });
  }

  if (descriptorQuery.isLoading) {
    return (
      <div className="space-y-3 p-4 md:p-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (descriptorQuery.error || descriptor === undefined) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <ErrorState
          error={rpcErrorToDiagnostic(descriptorQuery.error?.message, {
            title: "实验不存在或加载失败",
          })}
        />
        <Button asChild variant="outline" size="sm">
          <Link href="/research-experiments">返回实验列表</Link>
        </Button>
      </div>
    );
  }

  const requirement = descriptor.datasetRequirement;
  const PageComponent = experimentPageOf(descriptor.pageKey);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* ① 元数据 */}
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-base">
                <FlaskConical className="h-4 w-4" /> {descriptor.name}
                <Badge variant="outline" className="font-mono text-[10px]">
                  v{descriptor.version}
                </Badge>
                {requirement.usesForwardData && (
                  <Badge variant="secondary" className="text-[10px]">
                    使用事件日之后数据
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                <span className="font-mono text-[11px]">{descriptor.id}</span> · 来源{" "}
                {descriptor.source}
                {selectedVersion
                  ? ` · Dataset ${selectedVersion.datasetCode} ${selectedVersion.version}（id=${selectedVersion.datasetVersionId}）`
                  : ""}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="ghost">
                <Link href="/research-experiments">全部实验</Link>
              </Button>
              <Button
                size="sm"
                onClick={handleRun}
                disabled={runMutation.isPending || selectedVersionId === null}
                data-experiment-run-button="true"
              >
                {runMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    正在运行实验…（读真实 Dataset 并全量计算，可能需要 10~60 秒）
                  </>
                ) : (
                  <>
                    <Play className="mr-1.5 h-4 w-4" /> 运行
                  </>
                )}
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{descriptor.description}</p>
          {requirement.usesForwardData && requirement.forwardDataPurpose && (
            <Alert className="mt-1">
              <Info className="h-4 w-4 shrink-0" />
              <AlertDescription className="text-xs">
                本实验读取事件日之后的数据，用途：
                {requirement.forwardDataPurpose}
              </AlertDescription>
            </Alert>
          )}
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {/* ② 执行状态 */}
          {rpcError && (
            <ErrorState
              error={rpcErrorToDiagnostic(rpcError.message, { title: "运行请求被拒绝" })}
            />
          )}
          {outcome && outcome.runStatus === "FAILED" && (
            <Alert className="border-red-300 bg-red-50">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
              <AlertTitle className="text-sm">
                本次执行失败
                <Badge variant="outline" className="ml-2 font-mono text-[10px]">
                  {outcome.error?.code ?? "UNKNOWN"}
                </Badge>
              </AlertTitle>
              <AlertDescription className="space-y-1 text-xs">
                <p>{outcome.error?.message}</p>
                <p className="text-muted-foreground">
                  执行耗时 {formatDuration(outcome.execution.durationMs)}；Dataset =
                  {outcome.execution.datasetFacts.datasetCode}{" "}
                  {outcome.execution.datasetFacts.datasetVersionLabel}。
                  {outcome.error?.detail !== undefined && (
                    <>
                      {" "}
                      技术详情：
                      <span className="font-mono">
                        {JSON.stringify(outcome.error.detail).slice(0, 400)}
                      </span>
                    </>
                  )}
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* ③ 结果 */}
          {outcome && outcome.runStatus === "SUCCEEDED" && outcome.result && (
            PageComponent ? (
              <PageComponent descriptor={descriptor} outcome={outcome} />
            ) : (
              <GenericExperimentResult
                result={outcome.result}
                pageKey={descriptor.pageKey}
                reason="实验作者尚未在客户端页面注册表里登记该 pageKey。"
              />
            )
          )}
          {outcome === null && !rpcError && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <Database className="h-4 w-4" /> 选择 Dataset 版本后点击右上角「运行」。
                </p>
                <p className="mt-2 text-xs">
                  <RefreshCw className="mr-1 inline h-3 w-3" />
                  本实验体系<strong>不新增数据库表</strong>，执行是请求内计算 ——
                  刷新页面后结果不会自动恢复，需要重跑（Dataset 坐标保存在 URL 里，不会丢）。
                </p>
              </CardContent>
            </Card>
          )}

          {/* ④ 执行元数据 */}
          {outcome && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">执行元数据</CardTitle>
                <CardDescription className="text-xs">
                  开始 {formatDateTime(outcome.execution.startedAt)} · 结束{" "}
                  {formatDateTime(outcome.execution.finishedAt)} · 耗时{" "}
                  {formatDuration(outcome.execution.durationMs)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="grid gap-2 sm:grid-cols-2">
                  <MetadataRow label="实验" value={`${descriptor.name} v${descriptor.version}`} />
                  <MetadataRow
                    label="Dataset 版本"
                    value={`${outcome.execution.datasetFacts.datasetCode} ${outcome.execution.datasetFacts.datasetVersionLabel}（id=${outcome.execution.datasetFacts.datasetVersionId}，${outcome.execution.datasetFacts.status}）`}
                  />
                  <MetadataRow
                    label="数据集区间"
                    value={`${outcome.execution.datasetFacts.startDate ?? "—"} ~ ${outcome.execution.datasetFacts.endDate ?? "—"}`}
                  />
                  <MetadataRow
                    label="实际读取"
                    value={`事件 ${outcome.execution.datasetFacts.eventCount} 行 · prefix ${outcome.execution.datasetFacts.prefixRowCount} 行 · post ${outcome.execution.datasetFacts.postRowCount} 行`}
                  />
                  <MetadataRow
                    label="信息边界（decisionOffsetDays）"
                    value={
                      outcome.execution.datasetFacts.decisionOffsetDays === null
                        ? "未声明（样本资格不使用事件日之后数据）"
                        : `T+${outcome.execution.datasetFacts.decisionOffsetDays}`
                    }
                  />
                  <MetadataRow
                    label="是否读取事件日之后数据"
                    value={
                      outcome.execution.datasetFacts.forwardDataRead
                        ? `是（最远 rd=${outcome.execution.datasetFacts.maxPostRelativeDayRead ?? "—"}）`
                        : "否"
                    }
                  />
                </div>
                <Separator />
                <div>
                  <p className="mb-1 font-medium">实际使用的参数</p>
                  <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-[11px]">
                    {JSON.stringify(outcome.execution.resolvedParameters, null, 2)}
                  </pre>
                </div>
                {outcome.execution.logs.length > 0 && (
                  <div>
                    <p className="mb-1 font-medium">运行日志</p>
                    <pre className="max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
                      {outcome.execution.logs.join("\n")}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* 右侧：坐标 + 参数 + 声明 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Dataset 版本</CardTitle>
              <CardDescription className="text-xs">
                只有 READY 版本可用于实验；选择会写进 URL（可分享 / 可刷新）。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {versionsQuery.isLoading && <Skeleton className="h-9 w-full" />}
              {versionsQuery.error && (
                <p className="text-xs text-red-600">版本列表加载失败：{versionsQuery.error.message}</p>
              )}
              {!versionsQuery.isLoading && versionOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  没有属于 <span className="font-mono">{requirement.datasetCode}</span>{" "}
                  的数据集版本。请先在「数据集」页构建一个 READY 版本。
                </p>
              )}
              {versionOptions.length > 0 && (
                <Select
                  value={selectedVersionId === null ? undefined : String(selectedVersionId)}
                  onValueChange={(value) =>
                    setLocation(`${basePath}?datasetVersionId=${value}`)
                  }
                >
                  <SelectTrigger data-experiment-version-select="true">
                    <SelectValue placeholder="选择 Dataset 版本" />
                  </SelectTrigger>
                  <SelectContent>
                    {versionOptions.map((option) => (
                      <SelectItem
                        key={option.datasetVersionId}
                        value={String(option.datasetVersionId)}
                      >
                        {option.version} · id={option.datasetVersionId} · {option.status} ·{" "}
                        {option.startDate ?? "—"}~{option.endDate ?? "—"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selectedVersion && (
                <p className="text-xs text-muted-foreground">
                  已选：<span className="font-mono">{selectedVersion.version}</span> ·
                  事件数 {selectedVersion.totalEvents ?? "—"} · 状态 {selectedVersion.status}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">参数</CardTitle>
              <CardDescription className="text-xs">
                留空 = 使用默认值（由服务端归并）。越界 / 枚举外的值会被服务端独立拒绝。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {descriptor.parameters.length === 0 && (
                <p className="text-xs text-muted-foreground">本实验没有参数。</p>
              )}
              {descriptor.parameters.map((param) => (
                <div key={param.code} className="space-y-1">
                  <Label htmlFor={`param-${param.code}`} className="text-xs">
                    {param.label}
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      {param.code}
                    </span>
                    {param.unit ? (
                      <span className="ml-1 text-[10px] text-muted-foreground">（{param.unit}）</span>
                    ) : null}
                  </Label>
                  {param.kind === "BOOLEAN" ? (
                    <Select
                      value={rawParams[param.code] === true ? "true" : "false"}
                      onValueChange={(value) =>
                        setRawParams((prev) => ({ ...prev, [param.code]: value === "true" }))
                      }
                    >
                      <SelectTrigger id={`param-${param.code}`} className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">是</SelectItem>
                        <SelectItem value="false">否</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : param.kind === "ENUM" ? (
                    <Select
                      value={String(rawParams[param.code] ?? "")}
                      onValueChange={(value) =>
                        setRawParams((prev) => ({ ...prev, [param.code]: value }))
                      }
                    >
                      <SelectTrigger id={`param-${param.code}`} className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(param.allowedValues ?? []).map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`param-${param.code}`}
                      className="h-9"
                      value={String(rawParams[param.code] ?? "")}
                      placeholder={
                        param.kind === "INT_LIST"
                          ? "逗号分隔整数，如 1,2,3"
                          : param.defaultValue === undefined || param.defaultValue === null
                            ? ""
                            : `默认 ${String(param.defaultValue)}`
                      }
                      onChange={(event) =>
                        setRawParams((prev) => ({ ...prev, [param.code]: event.target.value }))
                      }
                    />
                  )}
                  {param.description && (
                    <p className="text-[11px] text-muted-foreground">{param.description}</p>
                  )}
                  {param.bounds && (param.bounds.min !== null || param.bounds.max !== null) && (
                    <p className="text-[11px] text-muted-foreground">
                      取值
                      {param.bounds.min !== null ? ` ≥ ${String(param.bounds.min)}` : ""}
                      {param.bounds.max !== null ? ` ≤ ${String(param.bounds.max)}` : ""}
                    </p>
                  )}
                </div>
              ))}
              {paramError && <p className="text-xs text-red-600">{paramError}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Dataset 需求声明</CardTitle>
              <CardDescription className="text-xs">
                实验只能读到<strong>这里声明过</strong>的列与相对日（列投影 + 相对日白名单）。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <MetadataRow label="数据集" value={requirement.datasetCode} />
              <MetadataRow
                label="event 列"
                value={(requirement.requiredColumns.events ?? []).join(", ") || "—"}
              />
              <MetadataRow
                label="prefix（rd ≤ 0）列"
                value={(requirement.requiredColumns.feature ?? []).join(", ") || "—"}
              />
              <MetadataRow
                label="post（rd ≥ 1）列"
                value={(requirement.requiredColumns.observation ?? []).join(", ") || "—"}
              />
              <MetadataRow
                label="prefix 相对日"
                value={(requirement.prefixRelativeDays ?? []).join(", ") || "—"}
              />
              <MetadataRow
                label="post 相对日"
                value={
                  (requirement.postRelativeDays ?? []).length > 6
                    ? `${(requirement.postRelativeDays ?? []).slice(0, 6).join(", ")} … 共 ${(requirement.postRelativeDays ?? []).length} 个`
                    : (requirement.postRelativeDays ?? []).join(", ") || "—"
                }
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all font-mono">{value}</span>
    </div>
  );
}
