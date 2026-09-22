/**
 * 独立研究实验详情 / 运行页（`/research-experiments/:group/:key`）。
 *
 * RESEARCH-EXPERIMENT-001 建立通用外壳；**RESEARCH-EXPERIMENT-004 给它加了持久化**。
 *
 * ## 平台负责什么
 *
 *   1. 显示实验元数据（名称 / 版本 / 来源 / 说明）与 Dataset 需求声明；
 *   2. Dataset 版本选择器（**坐标进 URL**）+ 由参数定义自动渲染的参数表单；
 *   3. 「运行」动作（pending 时**换文案**并给出量级）；
 *   4. 执行状态与「**是否已持久化**」（这是 004 新增的关键区别，见下）；
 *   5. **运行历史（Run 列表）** —— 可直接打开任何一条历史 Run；
 *   6. 结果：`pageKey` 命中客户端页面注册表 ⇒ 挂载**实验自己的页面**；否则降级通用渲染器。
 *
 * ## 004 带来的三个行为变化
 *
 * - 🔴 **结果落库了**：每次「运行」都会先建 Run 行（PENDING → RUNNING → COMPLETED/FAILED），
 *   产物落对象存储。因此刷新页面**不再丢结果**：历史 Run 列表里点进去就能看。
 * - 🔴 **「跑成功」≠「存成功」**：实验算完但对象存储写失败时，Run 会是 `FAILED`
 *   而 outcome 是 `SUCCEEDED`（规格 §13 情况 A 的正确表现）。页面**必须响亮区分这两件事**，
 *   否则用户会以为「结果显示正常 ⇒ 一定存下来了」。
 * - 🔴 **Run 事实取不到时如实标注**（`runsAvailable=false`）：实验描述符来自代码注册表，
 *   DB 挂了也拿得到 ⇒ 不能因为 Run 查不到就整页报错，也不能显示「0 个 Run」假装没有历史。
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import {
  AlertTriangle,
  Database,
  ExternalLink,
  FlaskConical,
  History,
  Info,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";
import type {
  ExperimentParameterValues,
  ExperimentResearchProtocolInput,
} from "@shared/researchExperimentsContracts";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { MetadataRow, RunStatusBadge, formatDateTime, formatDuration } from "./runShared";

/** 表单原始值（保持字符串形态，避免输入过程中被数字转换吃掉中间态）。 */
type RawValue = string | boolean;

function defaultRawValue(kind: string, defaultValue: unknown): RawValue {
  if (kind === "BOOLEAN") return defaultValue === true;
  if (kind === "INT_LIST") return Array.isArray(defaultValue) ? defaultValue.join(",") : "";
  return defaultValue === undefined || defaultValue === null ? "" : String(defaultValue);
}

/** 参数摘要（列表页一行显示，太长就截断 —— 细节进 Run 详情）。 */
function summarizeParameters(parameters: Record<string, unknown>): string {
  const keys = Object.keys(parameters);
  if (keys.length === 0) return "—";
  return keys
    .sort()
    .map((key) => `${key}=${JSON.stringify(parameters[key])}`)
    .join(", ");
}

export default function ResearchExperimentDetail() {
  const params = useParams<{ group?: string; key?: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();

  const group = params.group ?? "";
  const key = params.key ?? "";
  const experimentId = `${decodeURIComponent(group)}/${decodeURIComponent(key)}`;
  const basePath = `/research-experiments/${encodeURIComponent(group)}/${encodeURIComponent(key)}`;

  const utils = trpc.useUtils();
  const [runOffset, setRunOffset] = useState(0);
  const experimentQuery = trpc.researchExperiments.get.useQuery(
    { experimentId, ...(runOffset > 0 ? { runOffset } : {}) },
    { enabled: experimentId !== "/", retry: false },
  );
  const detail = experimentQuery.data;
  const descriptor = detail?.descriptor;
  const runs = detail?.runs ?? [];

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
    setRunOffset(0);
    const next: Record<string, RawValue> = {};
    for (const param of descriptor.parameters) {
      next[param.code] = defaultRawValue(param.kind, param.defaultValue);
    }
    setRawParams(next);
  }, [descriptor?.id, descriptor?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const [paramError, setParamError] = useState<string | null>(null);
  const [protocolEnabled, setProtocolEnabled] = useState(false);
  const [protocolPhase, setProtocolPhase] = useState<"OBSERVATION" | "HOLDOUT">("OBSERVATION");
  const [protocolId, setProtocolId] = useState("");
  const [protocolVersion, setProtocolVersion] = useState("1.0.0");
  const [hypothesisCode, setHypothesisCode] = useState("H1");
  const [observationStart, setObservationStart] = useState("");
  const [observationEnd, setObservationEnd] = useState("");
  const [holdoutStart, setHoldoutStart] = useState("");
  const [holdoutEnd, setHoldoutEnd] = useState("");
  const [parentRunId, setParentRunId] = useState("");
  const [rpcError, setRpcError] = useState<{ message: string } | null>(null);

  const runMutation = trpc.researchExperiments.startRun.useMutation({
    onSuccess: (run) => {
      setRpcError(null);
      // 新 Run 已落库 ⇒ 刷新历史列表（否则用户看不到刚跑的那一条）。
      void utils.researchExperiments.get.invalidate({ experimentId });
      setLocation(`${basePath}/runs/${encodeURIComponent(run.runId)}`);
    },
    onError: (error) => {
      setRpcError({ message: error.message });
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

  function buildProtocol(): ExperimentResearchProtocolInput | undefined | null {
    if (!protocolEnabled) return undefined;
    const id = protocolId.trim();
    const version = protocolVersion.trim();
    const hypothesis = hypothesisCode.trim();
    if (
      id === "" ||
      version === "" ||
      hypothesis === "" ||
      observationStart === "" ||
      observationEnd === "" ||
      holdoutStart === "" ||
      holdoutEnd === ""
    ) {
      setParamError("启用 Research Protocol 后，协议 ID / 版本 / 假设及观察、Holdout 窗口均为必填。");
      return null;
    }
    if (observationEnd >= holdoutStart) {
      setParamError("Holdout 起始日必须晚于 Observation 结束日。");
      return null;
    }
    if (protocolPhase === "HOLDOUT" && parentRunId.trim() === "") {
      setParamError("HOLDOUT 必须填写已完成且 Gate=OBSERVATION_READY 的父 Observation Run ID。");
      return null;
    }
    setParamError(null);
    return {
      protocolId: id,
      protocolVersion: version,
      hypothesisCode: hypothesis,
      observationWindow: { startDate: observationStart, endDate: observationEnd },
      holdoutWindow: { startDate: holdoutStart, endDate: holdoutEnd },
      phase: protocolPhase,
      ...(protocolPhase === "HOLDOUT" ? { parentRunId: parentRunId.trim() } : {}),
    };
  }

  function handleRun() {
    if (descriptor === undefined || selectedVersionId === null) return;
    const parameters = buildParameters();
    if (parameters === null) return;
    const protocol = buildProtocol();
    if (protocol === null) return;
    runMutation.mutate({
      experimentId: descriptor.id,
      datasetVersionId: selectedVersionId,
      parameters,
      ...(protocol !== undefined ? { protocol } : {}),
    });
  }

  if (experimentQuery.isLoading) {
    return (
      <div className="space-y-3 p-4 md:p-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (experimentQuery.error || descriptor === undefined) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <ErrorState
          error={rpcErrorToDiagnostic(experimentQuery.error?.message, {
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
                    正在创建 Run…
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

          {!rpcError && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <Database className="h-4 w-4" /> 选择 Dataset 版本后点击右上角「运行」。
                </p>
                <p className="mt-2 text-xs">
                  <RefreshCw className="mr-1 inline h-3 w-3" />
                  运行会创建后台 Run 并立即跳转到详情页；页面会持续刷新状态与结果。
                </p>
              </CardContent>
            </Card>
          )}

          {/* ⑤ 运行历史（004 新增） */}
          <Card data-experiment-run-history="true">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" /> 运行历史
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {runs.length}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Run 元数据保存在 TiDB，产物保存在对象存储 —— 点「打开」可查看任意一条历史 Run
                的状态、参数、结果与产物。
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {detail?.runsAvailable === false && (
                <Alert className="border-amber-300 bg-amber-50">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <AlertTitle className="text-sm">运行历史暂时取不到</AlertTitle>
                  <AlertDescription className="text-xs">
                    <span className="font-mono">{detail.runsError?.code}</span>：
                    {detail.runsError?.message}
                    <br />
                    这不代表「没有历史 Run」—— 只是本次没能读到（实验描述符本身不依赖数据库，所以本页仍可打开）。
                  </AlertDescription>
                </Alert>
              )}
              {detail?.runsAvailable !== false && runs.length === 0 && (
                <p className="py-2 text-xs text-muted-foreground">
                  还没有任何 Run。点右上角「运行」会产生第一条。
                </p>
              )}
              {runs.length > 0 && (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>Dataset</TableHead>
                      <TableHead>参数</TableHead>
                      <TableHead>开始</TableHead>
                      <TableHead className="text-right">耗时</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.runId}>
                        <TableCell className="font-mono text-[11px]">{run.runId}</TableCell>
                        <TableCell>
                          <RunStatusBadge run={run} />
                        </TableCell>
                        <TableCell className="font-mono text-[11px]">
                          {run.datasetVersionLabel}
                          <span className="ml-1 text-muted-foreground">(id={run.datasetVersionId})</span>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-[11px]" title={summarizeParameters(run.parameters)}>
                          {summarizeParameters(run.parameters)}
                        </TableCell>
                        <TableCell className="text-[11px]">{formatDateTime(run.startedAt)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] tabular-nums">
                          {formatDuration(run.durationMs)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant="outline" className="h-7">
                            <Link
                              href={`${basePath}/runs/${encodeURIComponent(run.runId)}`}
                              data-open-run={run.runId}
                            >
                              <ExternalLink className="mr-1 h-3 w-3" /> 打开
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={runOffset === 0}
                    onClick={() => setRunOffset((value) => Math.max(0, value - 200))}
                  >
                    上一页
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {runOffset + 1} - {runOffset + runs.length}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={runs.length < 200}
                    onClick={() => setRunOffset((value) => value + 200)}
                  >
                    下一页
                  </Button>
                </div>
                </>
              )}
            </CardContent>
          </Card>
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

          <Card data-experiment-protocol="true">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-sm">Research Protocol</CardTitle>
                  <CardDescription className="text-xs">
                    启用后进入 Observation / Holdout 确认性流程；Holdout 只能引用冻结的 Observation Run。
                  </CardDescription>
                </div>
                <Switch
                  checked={protocolEnabled}
                  onCheckedChange={setProtocolEnabled}
                  aria-label="启用 Research Protocol"
                />
              </div>
            </CardHeader>
            {protocolEnabled && (
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">阶段</Label>
                  <Select
                    value={protocolPhase}
                    onValueChange={(value) =>
                      setProtocolPhase(value as "OBSERVATION" | "HOLDOUT")
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OBSERVATION">OBSERVATION</SelectItem>
                      <SelectItem value="HOLDOUT">HOLDOUT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Protocol ID</Label>
                    <Input
                      className="h-9"
                      value={protocolId}
                      onChange={(event) => setProtocolId(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">协议版本</Label>
                    <Input
                      className="h-9"
                      value={protocolVersion}
                      onChange={(event) => setProtocolVersion(event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">假设编号</Label>
                  <Input
                    className="h-9"
                    value={hypothesisCode}
                    onChange={(event) => setHypothesisCode(event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Observation 开始</Label>
                    <Input
                      type="date"
                      className="h-9"
                      value={observationStart}
                      onChange={(event) => setObservationStart(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Observation 结束</Label>
                    <Input
                      type="date"
                      className="h-9"
                      value={observationEnd}
                      onChange={(event) => setObservationEnd(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Holdout 开始</Label>
                    <Input
                      type="date"
                      className="h-9"
                      value={holdoutStart}
                      onChange={(event) => setHoldoutStart(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Holdout 结束</Label>
                    <Input
                      type="date"
                      className="h-9"
                      value={holdoutEnd}
                      onChange={(event) => setHoldoutEnd(event.target.value)}
                    />
                  </div>
                </div>
                {protocolPhase === "HOLDOUT" && (
                  <div className="space-y-1">
                    <Label className="text-xs">父 Observation Run ID</Label>
                    <Input
                      className="h-9 font-mono text-xs"
                      value={parentRunId}
                      onChange={(event) => setParentRunId(event.target.value)}
                      placeholder="RUN-..."
                    />
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Holdout 一旦启动，同一协议指纹不得再次运行。
                </p>
              </CardContent>
            )}
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
