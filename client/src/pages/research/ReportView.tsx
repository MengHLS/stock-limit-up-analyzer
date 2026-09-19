/**
 * ReportView — 研究报告查看页（`/research/report/:runId`，PHASE-A-001）。
 *
 * 数据来源：`researchEngine.getReport`（**只读**端点）。
 * 本页**不做任何计算、不做任何拼装式「再解读」** —— 它只是把后端落库的
 * REPORT artifact 正文（markdown）与溯源字段原样呈现出来，因此：
 *   - 页面上看到的一切数字，与 `research_result` / `research_finding` / `research_conclusion`
 *     逐字一致；
 *   - 「报告生成时间」= artifact 的落库时间（`createdAt`），不是前端渲染时间；
 *   - 正文可切换「渲染 / 原文」两种视图 —— 原文视图保证任何 markdown 渲染差异
 *     都不会挡住「看到完整报告」这件事。
 */

import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Download, FileText, ListTree, RefreshCw } from "lucide-react";
import { Streamdown } from "streamdown";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, SectionCard } from "@/components/common";
import { formatCount, formatDateTime, rpcErrorToDiagnostic } from "@/adapters/researchEngineAdapter";

/**
 * `metadataJson` 的溯源字段（去掉正文本体）。
 *
 * 为什么在前端重复声明一次形状：服务端把它作为 `Record<string, unknown>` 返回
 * （metadata 本来就是开放 JSON），前端在**读**的时候需要一个可断言的窄类型。
 * 这里只声明本页真正展示的字段，不额外发明任何字段。
 */
interface ReportTraceability {
  datasetVersionId?: number | null;
  runId?: number | null;
  experimentId?: number | null;
  analysisIds?: number[];
  findingIds?: number[];
  conclusionId?: number | null;
  patternId?: string | null;
  patternIds?: string[];
  generatorVersion?: string;
  checksum?: { algorithm?: string; scope?: string; value?: string };
  conclusionResolution?: string | null;
  unresolvedTraceFields?: string[];
  report?: { format?: string; mediaType?: string; bytes?: number };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="text-xs">{children}</div>
    </div>
  );
}

export default function ReportView() {
  const params = useParams();
  const runId = Number(params.runId);
  const validId = Number.isFinite(runId) && runId > 0;

  const reportQuery = trpc.researchEngine.getReport.useQuery({ runId }, { enabled: validId });
  const [rawView, setRawView] = useState(false);

  const data = reportQuery.data;
  const trace = useMemo(
    () => (data?.traceability ?? null) as ReportTraceability | null,
    [data],
  );

  const experimentId = data?.run.experimentId ?? null;
  const body = data?.report?.body ?? null;

  /**
   * 下载（**非本任务核心**，见 PHASE-A-001 §11）。
   *
   * 走前端 Blob + anchor，不引入对象存储、不新增后端下载端点 ——
   * 与 `ConclusionPanel` 的既有做法一致。
   */
  function handleDownload() {
    if (!body) return;
    const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `research-report-run-${runId}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  if (!validId) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState
          error={{
            code: "BAD_REQUEST",
            title: "无效的 Run ID",
            explanation: "URL 中的 runId 不是合法整数。",
            suggestions: ["返回研究实验列表重新选择 Run"],
          }}
        />
      </div>
    );
  }

  if (reportQuery.isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (reportQuery.error) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <ErrorState
          error={rpcErrorToDiagnostic(reportQuery.error.message, { title: "研究报告加载失败" })}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void reportQuery.refetch()}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> 重新加载
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/research">返回实验列表</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4 p-4 md:p-6" data-testid="report-view" data-run-id={String(data.run.id)}>
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <Link
                href={experimentId ? `/research/${experimentId}` : "/research"}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              >
                <ArrowLeft className="h-3 w-3" /> 返回研究实验
              </Link>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" /> 研究报告 · Run #{data.run.runNo}
              </CardTitle>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRawView((v) => !v)}
                title="切换 markdown 渲染视图 / 原文视图"
              >
                <ListTree className="mr-1.5 h-4 w-4" />
                {rawView ? "渲染视图" : "原文视图"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={!body}>
                <Download className="mr-1.5 h-4 w-4" /> 下载 Markdown
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <Field label="报告生成时间（artifact.createdAt）">
            <span className="font-mono">{formatDateTime(data.artifact.createdAt)}</span>
          </Field>
          <Field label="Run 完成时间">
            <span className="font-mono">{formatDateTime(data.run.completedAt)}</span>
          </Field>
          <Field label="Run 状态">
            <Badge variant="outline">{data.run.status}</Badge>
          </Field>
          <Field label="样本量">
            <span className="font-mono tabular-nums">{formatCount(data.run.sampleCount ?? 0)}</span>
          </Field>
          <Field label="Dataset Version">
            <span className="font-mono">
              {trace?.datasetVersionId === null || trace?.datasetVersionId === undefined
                ? "—"
                : trace.datasetVersionId}
            </span>
          </Field>
          <Field label="Pattern">
            <span className="font-mono">
              {trace?.patternIds && trace.patternIds.length > 0 ? trace.patternIds.join("、") : "—"}
            </span>
          </Field>
          <Field label="Analysis / Finding / Conclusion">
            <span className="font-mono tabular-nums">
              {trace?.analysisIds?.length ?? 0} / {trace?.findingIds?.length ?? 0} /{" "}
              {trace?.conclusionId ?? "—"}
            </span>
          </Field>
          <Field label="Generator Version">
            <span className="font-mono">{trace?.generatorVersion ?? "—"}</span>
          </Field>
        </CardContent>
      </Card>

      <SectionCard
        title="溯源（artifact metadataJson）"
        icon={ListTree}
        description="报告与既有四张表（result / finding / conclusion / run）的锚点。checksum 覆盖正文，用于「同 run 同内容不重复落库」。"
      >
        <div className="space-y-2">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Field label="artifact id">
              <span className="font-mono">#{data.artifact.id ?? "—"}</span>
            </Field>
            <Field label="artifactType / storageType">
              <span className="font-mono">
                {data.artifact.artifactType} / {data.artifact.storageType}
              </span>
            </Field>
            <Field label="uri（INLINE 逻辑定位符）">
              <span className="font-mono break-all">{data.artifact.uri}</span>
            </Field>
            <Field label="正文格式 / 字节数">
              <span className="font-mono">
                {trace?.report?.format ?? "—"} · {formatCount(data.report?.bytes ?? 0)} bytes
              </span>
            </Field>
          </div>
          <Field label={`checksum（${trace?.checksum?.algorithm ?? "sha256"} · ${trace?.checksum?.scope ?? "report-body-utf8"}）`}>
            <span className="font-mono break-all">{data.artifact.checksum ?? "—"}</span>
          </Field>
          <Field label="REPORT artifact 数量（同 Run）">
            <span className="font-mono tabular-nums">{data.reportArtifactIds.length}</span>
          </Field>
          {trace?.conclusionResolution ? (
            <Field label="结论归属解析">
              <span>{trace.conclusionResolution}</span>
            </Field>
          ) : null}
          {trace?.unresolvedTraceFields && trace.unresolvedTraceFields.length > 0 ? (
            <Field label="未能可靠取得的溯源字段（不伪造，如实列出）">
              <ul className="list-disc space-y-0.5 pl-4 text-amber-700">
                {trace.unresolvedTraceFields.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Field>
          ) : (
            <Field label="未能可靠取得的溯源字段">
              <span className="text-muted-foreground">（无）</span>
            </Field>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="报告正文"
        icon={FileText}
        description="内容为既有 Research 结果的展示层投影，未重新查询行情、未重算任何研究结果。"
      >
        {body === null ? (
          <p className="text-xs text-amber-700">
            该 artifact 的 metadataJson 里没有可读正文（`report.body` 缺失）。
            这属于产物损坏，请重新生成报告后再查看。
          </p>
        ) : rawView ? (
          <pre
            data-testid="report-body-raw"
            className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed"
          >
            {body}
          </pre>
        ) : (
          <div
            data-testid="report-body"
            className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto"
          >
            <Streamdown>{body}</Streamdown>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
