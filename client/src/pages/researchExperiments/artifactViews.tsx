/**
 * 独立研究实验 · Artifact 展示件（RESEARCH-EXPERIMENT-004，规格 §16 / §17 / §18）。
 *
 * ## 三条纪律（都是规格里的硬要求）
 *
 * 1. **前端永远拿不到存储凭据**（§18）。渲染层只拿到 Object Key 与元数据；
 *    内容一律走 `GET /api/experiments/artifact?runId=…&key=…` 由后端代理。
 *    唯一的「拼 URL」点就是下面的 `artifactContentUrl()`。
 * 2. **不在页面初始化时自动下载任何产物**（§17）。所有内容获取都发生在
 *    **用户显式点击「预览 / 下载」之后**。
 * 3. **大文件不给预览**（§17）。即使格式支持，超过阈值也只给下载入口，
 *    并明确写出「为什么没给你预览」—— 不用一个转圈假装在加载。
 *
 * ## Artifact 与 Manifest 的关系
 *
 * `manifest.json` 是「这次 Run 产出了什么」的**唯一索引**（§10）；页面**不猜 Key、
 * 不列目录**。本文件的 `ArtifactIndexCard` 就是 Manifest 的可视化，
 * `ArtifactCatalogCard` 则是每个条目「**实测是否真的存在**」的结果回显
 * （`present` 由服务端真去对象存储 HEAD 得来，不是靠数据库声称）。
 */

import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Table2,
} from "lucide-react";
import type {
  ExperimentArtifactKind,
  ExperimentArtifactMetadata,
  ExperimentArtifactRef,
  ExperimentRunManifest,
} from "@shared/researchExperimentsContracts";
import {
  EXPERIMENT_ARTIFACT_INLINE_PREVIEW_FORMATS,
  EXPERIMENT_ARTIFACT_INLINE_PREVIEW_MAX_BYTES,
} from "@shared/researchExperimentsContracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JsonBlock } from "@/components/common";
import { MetadataRow, formatBytes, formatDateTime } from "./runShared";

/**
 * 允许内联预览的体积上限与形态名单。
 *
 * 🔴 与**服务端同源**（都在 `@shared/researchExperimentsContracts`）：服务端用它算
 *    `ExperimentArtifactMetadata.inlineViewable`（权威裁决），前端用它兜底
 *    （Manifest 索引行的 `present` 未知时需要自己判断）。**两边不许各写一份**。
 */
const ARTIFACT_INLINE_PREVIEW_MAX_BYTES = EXPERIMENT_ARTIFACT_INLINE_PREVIEW_MAX_BYTES;

/** 可由浏览器直接读成文本的形态（预览用）；其余只给下载。 */
const TEXT_PREVIEW_FORMATS = new Set<string>(EXPERIMENT_ARTIFACT_INLINE_PREVIEW_FORMATS);

/** Artifact 内容 URL —— **全站唯一的拼装点**（前端只经后端 API 取内容）。 */
export function artifactContentUrl(
  runId: string,
  key: string,
  disposition: "inline" | "attachment" = "attachment",
): string {
  const params = new URLSearchParams({ runId, key, disposition });
  return `/api/experiments/artifact?${params.toString()}`;
}

const KIND_META: Record<ExperimentArtifactKind, { label: string; icon: React.ReactNode; className: string }> = {
  RESULT: {
    label: "RESULT",
    icon: <FileJson className="mr-1 h-3 w-3" />,
    className: "border-violet-300 text-violet-700",
  },
  MANIFEST: {
    label: "MANIFEST",
    icon: <FileJson className="mr-1 h-3 w-3" />,
    className: "border-slate-300 text-slate-700",
  },
  TABLE: {
    label: "TABLE",
    icon: <Table2 className="mr-1 h-3 w-3" />,
    className: "border-sky-300 text-sky-700",
  },
  CHART: {
    label: "CHART",
    icon: <ImageIcon className="mr-1 h-3 w-3" />,
    className: "border-pink-300 text-pink-700",
  },
  CSV: {
    label: "CSV",
    icon: <FileSpreadsheet className="mr-1 h-3 w-3" />,
    className: "border-emerald-300 text-emerald-700",
  },
  PARQUET: {
    label: "PARQUET",
    icon: <FileSpreadsheet className="mr-1 h-3 w-3" />,
    className: "border-amber-300 text-amber-700",
  },
  LOG: {
    label: "LOG",
    icon: <FileText className="mr-1 h-3 w-3" />,
    className: "border-zinc-300 text-zinc-700",
  },
  IMAGE: {
    label: "IMAGE",
    icon: <ImageIcon className="mr-1 h-3 w-3" />,
    className: "border-pink-300 text-pink-700",
  },
  OTHER: {
    label: "OTHER",
    icon: <FileText className="mr-1 h-3 w-3" />,
    className: "border-zinc-300 text-zinc-700",
  },
};

/** 种类徽章（Manifest / 元数据两处共用，保证同一条目在两处**长得一样**）。 */
function KindBadge({ kind }: { kind: ExperimentArtifactKind }) {
  const meta = KIND_META[kind];
  return (
    <Badge variant="outline" className={`gap-0 font-mono text-[10px] ${meta.className}`}>
      {meta.icon}
      {meta.label}
    </Badge>
  );
}

/** 预览 / 下载按钮组（**用户不点就不发请求**）。 */
function ArtifactActions({
  runId,
  artifact,
  present,
  inlineViewable,
}: {
  runId: string;
  artifact: ExperimentArtifactRef;
  /** `null` = 未知（只读 Manifest 时不清楚对象是否还在）。 */
  present: boolean | null;
  /**
   * 服务端的权威裁决（`ExperimentArtifactMetadata.inlineViewable`）。
   * 传 `null` 表示「不知道，只好按本地判据估」—— 只在纯 Manifest 视图里发生。
   */
  inlineViewable?: boolean | null;
}) {
  const sizeBytes = artifact.sizeBytes;
  const formatSupported = TEXT_PREVIEW_FORMATS.has(artifact.format.toLowerCase());
  const withinCap = sizeBytes <= ARTIFACT_INLINE_PREVIEW_MAX_BYTES;
  // 服务端有结论就用服务端的；没有才用本地判据（不覆盖权威裁决）。
  const canPreview =
    present === false
      ? false
      : inlineViewable === true || inlineViewable === false
        ? inlineViewable
        : formatSupported && withinCap;

  const previewTitle = canPreview
    ? "在新标签页内联打开（后端代理读取）"
    : present === false
      ? "对象在存储里不存在，无法读取"
      : !formatSupported
        ? `形态 ${artifact.format} 不支持浏览器内联查看，请下载后用本地工具打开`
        : `体积 ${formatBytes(sizeBytes)} 超过预览上限 ${formatBytes(ARTIFACT_INLINE_PREVIEW_MAX_BYTES)}，请下载查看`;

  return (
    <div className="flex items-center justify-end gap-1.5">
      {canPreview ? (
        <Button asChild size="sm" variant="ghost" className="h-7">
          <a
            href={artifactContentUrl(runId, artifact.key, "inline")}
            target="_blank"
            rel="noreferrer"
            title={previewTitle}
            data-artifact-open={artifact.key}
          >
            <ExternalLink className="mr-1 h-3 w-3" /> 打开
          </a>
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          disabled
          title={previewTitle}
          data-artifact-open-disabled={artifact.key}
        >
          <ExternalLink className="mr-1 h-3 w-3" /> 打开
        </Button>
      )}
      <Button asChild size="sm" variant="outline" className="h-7">
        <a
          href={artifactContentUrl(runId, artifact.key, "attachment")}
          title="经后端代理下载（前端不接触对象存储凭据）"
          data-artifact-download={artifact.key}
        >
          <Download className="mr-1 h-3 w-3" /> 下载
        </a>
      </Button>
    </div>
  );
}

/** Manifest 坐标（Run 的「产物清单是谁、什么时候写的」）。 */
export function ManifestSummary({ manifest }: { manifest: ExperimentRunManifest }) {
  return (
    <div className="grid gap-1.5 text-xs sm:grid-cols-2">
      <MetadataRow label="manifest schemaVersion" value={manifest.schemaVersion} />
      <MetadataRow label="experimentCode" value={manifest.experimentCode} />
      <MetadataRow label="experimentVersion" value={manifest.experimentVersion} />
      <MetadataRow label="runId" value={manifest.runId} />
      <MetadataRow label="datasetVersionId" value={String(manifest.datasetVersionId)} />
      <MetadataRow label="createdAt" value={formatDateTime(manifest.createdAt)} />
    </div>
  );
}

/**
 * Manifest 索引卡（规格 §10：「这次 Run 产出了什么」的**唯一**权威索引）。
 *
 * 分组顺序与 Manifest 结构一致：result → tables → charts → artifacts。
 * 若 Manifest 为空（`result=null` 且三个数组都空）则明确说「本次没有任何产物」——
 * 这通常是失败 Run，页面上方会有失败原因。
 */
export function ArtifactIndexCard({
  runId,
  manifest,
}: {
  runId: string;
  manifest: ExperimentRunManifest;
}) {
  const groups: Array<{ title: string; items: ExperimentArtifactRef[] }> = [
    { title: "result（结果信封）", items: manifest.result === null ? [] : [manifest.result] },
    { title: "tables（表格）", items: manifest.tables },
    { title: "charts（图表）", items: manifest.charts },
    { title: "artifacts（其它产物）", items: manifest.artifacts },
  ];
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <Card data-run-manifest-index="true">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">产物清单（manifest.json）</CardTitle>
        <CardDescription className="text-xs">
          这是本次 Run 的<strong>唯一索引</strong>：页面不猜 Key、不列目录。
          共 {total} 个产物；内容一律经后端接口按需获取。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ManifestSummary manifest={manifest} />

        {total === 0 && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Ban className="h-3.5 w-3.5" /> 本次 Run 的 Manifest 里没有任何产物。
          </p>
        )}

        {groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <div key={group.title} className="space-y-1.5">
              <p className="text-xs font-medium">
                {group.title}
                <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                  {group.items.length}
                </span>
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称</TableHead>
                      <TableHead>种类</TableHead>
                      <TableHead>格式</TableHead>
                      <TableHead className="text-right">体积</TableHead>
                      <TableHead>Object Key</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map((item) => (
                      <TableRow key={item.key}>
                        <TableCell className="text-xs">
                          {item.label}
                          {item.description && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {item.description}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <KindBadge kind={item.kind} />
                        </TableCell>
                        <TableCell className="font-mono text-[11px]">{item.format}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] tabular-nums">
                          {formatBytes(item.sizeBytes)}
                        </TableCell>
                        <TableCell className="max-w-[280px] break-all font-mono text-[10px] text-muted-foreground">
                          {item.key}
                        </TableCell>
                        <TableCell className="text-right">
                          <ArtifactActions runId={runId} artifact={item} present={null} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

/**
 * 产物**实测**目录（规格 §8 / §16）：服务端逐个 `HEAD` 过对象存储。
 *
 * 与 `ArtifactIndexCard` 的分工：
 *   - 前者说「Manifest 声称产出了什么」（不可变的事实）；
 *   - 本卡说「这些对象**现在真的还在**吗」（可变的观察）。
 * 两者不一致正是「情况 C」的可见化 —— 用红色标出来，而不是悄悄隐藏。
 */
export function ArtifactCatalogCard({
  runId,
  artifacts,
  available,
  error,
}: {
  runId: string;
  artifacts: ExperimentArtifactMetadata[];
  available: boolean;
  error: { code: string; message: string } | null;
}) {
  const missing = artifacts.filter((item) => !item.present);
  return (
    <Card data-run-artifact-catalog="true">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">产物存在性核验</CardTitle>
        <CardDescription className="text-xs">
          每个条目都由服务端**真的去对象存储查了一次**（不是照抄 Manifest）。
          共 {artifacts.length} 个，其中 {missing.length} 个实测不存在。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!available && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p className="font-medium">对象存储当前不可读</p>
              <p className="mt-0.5">
                <span className="font-mono">{error?.code ?? "UNKNOWN"}</span>
                {error?.message ? `：${error.message}` : ""}
              </p>
              <p className="mt-0.5 text-amber-800">
                这不代表产物丢了 —— 只是本次没能读到。Run 元数据（TiDB）不受影响。
              </p>
            </div>
          </div>
        )}

        {available && missing.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p className="font-medium">
                {missing.length} 个 Manifest 里登记的对象在存储里**找不到**
              </p>
              <p className="mt-0.5">
                这就是规格里的「情况 C：引用指向不存在的对象」。可能是对象被人工删除，
                也可能被生命周期策略清理。这些条目的「打开 / 下载」会返回 404。
              </p>
            </div>
          </div>
        )}

        {artifacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">该 Run 没有登记任何产物。</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>种类</TableHead>
                  <TableHead>对象</TableHead>
                  <TableHead>写入时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {artifacts.map((item) => (
                  <TableRow key={item.ref.key}>
                    <TableCell className="text-xs">
                      {item.ref.label}
                      {item.inlineViewable && (
                        <Badge variant="secondary" className="ml-1.5 text-[10px]">
                          可预览
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <KindBadge kind={item.ref.kind} />
                    </TableCell>
                    <TableCell className="text-[11px]">
                      <span className="inline-flex items-center gap-1">
                        {item.present ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" /> 存在
                          </>
                        ) : (
                          <>
                            <Ban className="h-3 w-3 text-red-600" /> 不存在
                          </>
                        )}
                      </span>
                      <span className="ml-1.5 font-mono text-muted-foreground">
                        {formatBytes(item.sizeBytes ?? item.ref.sizeBytes)}
                        {item.contentType ? ` · ${item.contentType}` : ""}
                        {item.lastModified ? ` · ${formatDateTime(item.lastModified)}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-[11px] tabular-nums">
                      {formatDateTime(item.ref.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ArtifactActions
                        runId={runId}
                        artifact={item.ref}
                        present={item.present}
                        inlineViewable={item.inlineViewable}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 按需内联预览（**只有用户点了「加载预览」才发请求**）。
 *
 * 🔴 用 `fetch` 而不是 `<iframe>`：本接口返回的 `Content-Disposition: inline` 只影响
 *    浏览器对响应的处理方式，不影响「谁去取字节」。用 fetch 可以把字节**留在页面内**，
 *    这样体积、解析失败、非文本格式都能给出明确说明（规格 §17 要求「至少能查看
 *    metadata；对支持的格式提供下载/打开入口」，不要求页内渲染一切）。
 */
export function ArtifactInlinePreview({
  runId,
  artifact,
}: {
  runId: string;
  artifact: ExperimentArtifactRef;
}) {
  const [state, setState] = useState<
    | { phase: "IDLE" }
    | { phase: "LOADING" }
    | { phase: "TEXT"; text: string; truncated: boolean }
    | { phase: "ERROR"; message: string }
  >({ phase: "IDLE" });

  const format = artifact.format.toLowerCase();
  const textLike = TEXT_PREVIEW_FORMATS.has(format);
  const withinCap = artifact.sizeBytes <= ARTIFACT_INLINE_PREVIEW_MAX_BYTES;

  async function load() {
    setState({ phase: "LOADING" });
    try {
      const response = await fetch(artifactContentUrl(runId, artifact.key, "inline"), {
        method: "GET",
        credentials: "same-origin",
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const payload = (await response.json()) as { code?: string; message?: string };
          if (payload.code || payload.message) {
            detail = `${payload.code ?? "ERROR"}：${payload.message ?? ""}`;
          }
        } catch {
          // 响应不是 JSON（例如网关返回 HTML）⇒ 保留 HTTP 状态码即可，不编造细节。
        }
        setState({ phase: "ERROR", message: detail });
        return;
      }
      const text = await response.text();
      // 只做「显示截断」，不改判据：是否超限在点击前已由 `inlineViewable` 决定。
      const truncated = text.length > 200_000;
      setState({
        phase: "TEXT",
        text: truncated ? `${text.slice(0, 200_000)}\n…（预览截断，完整内容请下载）` : text,
        truncated,
      });
    } catch (error) {
      setState({ phase: "ERROR", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="space-y-2" data-artifact-preview={artifact.key}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => void load()}
          disabled={state.phase === "LOADING" || !textLike || !withinCap}
          data-artifact-load-preview={artifact.key}
        >
          {state.phase === "LOADING" ? (
            <>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" /> 加载中…
            </>
          ) : (
            <>
              <ExternalLink className="mr-1 h-3 w-3" /> 加载预览（页内）
            </>
          )}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {!textLike
            ? `${artifact.format} 不是文本格式，页内无法预览 —— 请用「打开」或「下载」`
            : !withinCap
              ? `${formatBytes(artifact.sizeBytes)} 超过 ${formatBytes(ARTIFACT_INLINE_PREVIEW_MAX_BYTES)} 上限，不在页内加载`
              : "点击后才请求字节，页面初始化不会自动下载"}
        </span>
      </div>
      {state.phase === "TEXT" && (
        <pre className="max-h-72 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
          {state.text}
        </pre>
      )}
      {state.phase === "ERROR" && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          预览失败：{state.message}
        </p>
      )}
    </div>
  );
}

/** Result 原始 JSON（规格 §16：「JSON 必须可查看原始结构」）。 */
export function ResultRawJson({ result }: { result: unknown }) {
  return (
    <div className="space-y-2">
      <JsonBlock value={result} emptyText="本次 Run 没有结果内容。" />
    </div>
  );
}
