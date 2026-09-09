/**
 * FE-1 — 数据域健康看板（STEP 12 · A~G 域 + gate 认证证据）。
 *
 * 纪律（§27 Frontend Audit / §31 禁止项）：
 * - **不重新计算任何量化判定**：页面只消费后端 `dataHealth.overview`（源自 certify 脚本只读 TiDB 生成的
 *   认证 gate JSON），不在此处推导 gate 状态、不把 PENDING 显示成 PASS；
 * - **认证态 / 实况态分离**：`实况查库` Tab 明确标注「未认证」，且默认不自动查询（手动触发）；
 * - **诚实空态**：证据文件缺失 / 解析失败 → 明示错误与修复命令，不展示 0 值冒充「无问题」。
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { styleForStatus } from "@/lib/status";
import type { DataDomain, GateStatus } from "@shared/dataHealthContracts";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Clock,
  Database,
  FileJson,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// 展示辅助（仅格式化，不参与任何判定）
// ---------------------------------------------------------------------------

const STATUS_META: Record<
  GateStatus,
  { label: string; icon: typeof CheckCircle2 }
> = {
  PASS: {
    label: "PASS",
    icon: CheckCircle2,
  },
  PENDING: {
    label: "PENDING",
    icon: Clock,
  },
  FAIL: {
    label: "FAIL",
    icon: XCircle,
  },
};

function StatusBadge({ status }: { status: GateStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      className={`gap-1 font-mono ${styleForStatus(status).badge}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

function num(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toLocaleString() : "—";
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

/** 陈旧度：> 60min 视为过期提示（提示性，不改变判定）。 */
function fmtStale(min: number | null | undefined): {
  text: string;
  warn: boolean;
} {
  if (min === null || min === undefined) return { text: "未知", warn: false };
  if (min < 1) return { text: "刚刚", warn: false };
  if (min < 60) return { text: `${Math.round(min)} 分钟前`, warn: false };
  const h = min / 60;
  if (h < 24) return { text: `${h.toFixed(1)} 小时前`, warn: true };
  return { text: `${(h / 24).toFixed(1)} 天前`, warn: true };
}

/** 紧凑展示 gate 项的 current / threshold（原样透传，不改写数值）。 */
function KeyValues({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value).filter(
    ([, v]) => typeof v !== "object" || v === null
  );
  if (entries.length === 0)
    return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]"
        >
          <span className="text-muted-foreground">{k}</span>
          <span className="font-medium">{String(v)}</span>
        </span>
      ))}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "pass" | "pending" | "fail" | "neutral";
}) {
  const toneClass =
    tone === "pass"
      ? "text-emerald-600"
      : tone === "pending"
        ? "text-amber-600"
        : tone === "fail"
          ? "text-red-600"
          : "text-foreground";
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

function DomainCard({
  domain,
}: {
  domain: import("@shared/dataHealthContracts").DomainHealth;
}) {
  const pct =
    domain.coverage.pct === null
      ? 0
      : Math.min(100, Math.max(0, domain.coverage.pct));
  const meta = STATUS_META[domain.status];
  return (
    <Card className="gap-0 py-4">
      <CardHeader className="px-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-900 font-mono text-xs font-bold text-white">
              {domain.domain}
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate text-sm">{domain.label}</CardTitle>
              <CardDescription className="truncate font-mono text-[11px]">
                {domain.tables.join(" · ")}
              </CardDescription>
            </div>
          </div>
          <StatusBadge status={domain.status} />
        </div>
      </CardHeader>
      <CardContent className="px-4">
        <div className="mb-1 flex items-baseline justify-between font-mono text-xs">
          <span className="tabular-nums">
            <span className="text-base font-semibold">
              {num(domain.coverage.current)}
            </span>
            <span className="text-muted-foreground">
              {" "}
              / {num(domain.coverage.target)}
            </span>
          </span>
          <span className="text-muted-foreground">
            {domain.coverage.pct === null
              ? "—"
              : `${domain.coverage.pct.toFixed(1)}%`}{" "}
            {domain.coverage.unit}
          </span>
        </div>
        <Progress
          value={pct}
          className={`h-1.5 ${
            domain.status === "PASS"
              ? "[&>div]:bg-emerald-500"
              : domain.status === "FAIL"
                ? "[&>div]:bg-red-500"
                : "[&>div]:bg-amber-500"
          }`}
        />
        <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
          {domain.detail}
        </p>
        {domain.status !== "PASS" && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
            <meta.icon className="h-3 w-3" />
            gate 项 {domain.checkIds.map(i => `#${i}`).join(" / ")} 未达阈值
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** 数据快照：按「表 → 行数 + 日期范围」渲染，未知结构降级为 JSON 原文。 */
function SnapshotSection({ snapshot }: { snapshot: Record<string, unknown> }) {
  const tableEntries = Object.entries(snapshot).filter(([, v]) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    return typeof (v as Record<string, unknown>)["rows"] === "number";
  }) as Array<[string, Record<string, unknown>]>;

  const scalarEntries = Object.entries(snapshot).filter(
    ([, v]) => typeof v !== "object" || v === null
  );
  const byYear = Array.isArray(snapshot["ohlcvByYear"])
    ? (snapshot["ohlcvByYear"] as Array<Record<string, number>>)
    : [];
  const maxYearRows = Math.max(1, ...byYear.map(y => Number(y["rows"] ?? 0)));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-medium">表行数（认证快照）</h3>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">表</TableHead>
                <TableHead className="text-right text-xs">行数</TableHead>
                <TableHead className="text-xs">最早</TableHead>
                <TableHead className="text-xs">最晚</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableEntries.map(([name, v]) => {
                const minKey = Object.keys(v).find(k => k.startsWith("min_"));
                const maxKey = Object.keys(v).find(k => k.startsWith("max_"));
                return (
                  <TableRow key={name}>
                    <TableCell className="font-mono text-xs">{name}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {num(Number(v["rows"]))}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {minKey ? String(v[minKey] ?? "—") : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {maxKey ? String(v[maxKey] ?? "—") : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {byYear.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">OHLCV 逐年分布</h3>
          <div className="space-y-1">
            {byYear.map(y => (
              <div key={String(y["year"])} className="flex items-center gap-2">
                <span className="w-12 font-mono text-xs">{y["year"]}</span>
                <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-slate-700"
                    style={{
                      width: `${(Number(y["rows"] ?? 0) / maxYearRows) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-20 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {num(Number(y["rows"]))}
                </span>
                <span className="w-24 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {num(Number(y["stocks"] ?? 0))} 股 /{" "}
                  {num(Number(y["tradingDays"] ?? 0))} 日
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {scalarEntries.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">标量指标</h3>
          <div className="flex flex-wrap gap-2">
            {scalarEntries.map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded border bg-muted/40 px-2 py-1 font-mono text-xs"
              >
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium tabular-nums">{String(v)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

export default function DataHealth() {
  const overview = trpc.dataHealth.overview.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  // 实况查库为重型查询：默认关闭，仅由用户手动触发（避免无意中压库）
  const live = trpc.dataHealth.liveCounts.useQuery(undefined, {
    enabled: false,
  });

  const data = overview.data;
  const stale = fmtStale(data?.source.staleMinutes);

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Database className="h-5 w-5" />
            数据域健康看板
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            STEP 12 历史数据基础 · 数据源：
            <code className="mx-1 rounded bg-muted px-1 font-mono">
              {data?.source.path ?? "…"}
            </code>
            （由{" "}
            <code className="font-mono">scripts/step12_certify_gate.mjs</code>{" "}
            只读 TiDB 生成）
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <div
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
                data.researchReady
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-amber-300 bg-amber-50"
              }`}
            >
              {data.researchReady ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-amber-600" />
              )}
              <div className="leading-tight">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  RESEARCH_READY
                </div>
                <div
                  className={`font-mono text-sm font-semibold ${
                    data.researchReady ? "text-emerald-700" : "text-amber-700"
                  }`}
                >
                  {data.researchReady ? "TRUE" : "FALSE"}
                </div>
              </div>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void overview.refetch()}
            disabled={overview.isFetching}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${overview.isFetching ? "animate-spin" : ""}`}
            />
            刷新
          </Button>
        </div>
      </div>

      {/* 加载态 */}
      {overview.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full" />
            ))}
          </div>
        </div>
      )}

      {/* 错误态 */}
      {overview.isError && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="flex items-start gap-2 py-4 text-sm text-red-700">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">读取健康看板数据失败</p>
              <p className="mt-1 font-mono text-xs">
                {overview.error?.message ?? "未知错误"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 证据缺失 / 解析失败：明示修复命令，不展示 0 值冒充正常 */}
      {data && !data.source.exists && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex items-start gap-2 py-4 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">认证证据文件缺失，无数据可展示</p>
              <p className="mt-1 text-xs">{data.source.parseError}</p>
              <p className="mt-2 font-mono text-xs">
                修复：node scripts/step12_certify_gate.mjs
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.source.parseError && data.source.exists && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="flex items-start gap-2 py-4 text-sm text-red-700">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                证据文件解析失败（未展示任何替代数据）
              </p>
              <p className="mt-1 font-mono text-xs">{data.source.parseError}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.source.exists && !data.source.parseError && (
        <>
          {/* 汇总条 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile
              label="gate 总项"
              value={data.summary?.total ?? 0}
              tone="neutral"
            />
            <StatTile
              label="PASS"
              value={data.summary?.PASS ?? 0}
              tone="pass"
            />
            <StatTile
              label="PENDING"
              value={data.summary?.PENDING ?? 0}
              tone="pending"
            />
            <StatTile
              label="FAIL"
              value={data.summary?.FAIL ?? 0}
              tone="fail"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              快照时间：{fmtTime(data.source.capturedAt)}
              <span className={stale.warn ? "text-amber-700" : ""}>
                （{stale.text}）
              </span>
            </span>
            {stale.warn && (
              <span className="text-amber-700">
                快照已过期，建议重跑 certify 脚本后刷新
              </span>
            )}
          </div>

          {/* RESEARCH_READY=FALSE 时的硬提示（不得隐藏，§31）。分层语义：G0 数据地基 vs G4 研究就绪。 */}
          {!data.researchReady && (
            <Card className="border-amber-300 bg-amber-50">
              <CardContent className="flex items-start gap-2 py-3 text-sm text-amber-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    RESEARCH_READY = FALSE（G4 未通过）
                    {data.dataFoundationReady
                      ? "：数据地基 G0 已认证，但研究链尚未建设"
                      : "：数据地基 G0 亦未完全就绪"}
                  </p>
                  <p className="mt-0.5 text-xs">
                    按 §0.2 铁律，此期间不得产出正式策略结论。
                    {data.dataFoundationReady
                      ? "当前阻塞为 Industry PIT（G1）/ Research Dataset（G2）/ 生产引擎退出策略（G3），按 MASTER_PRODUCT_ROADMAP PHASE 1~3 依次建设。"
                      : " 请先补齐数据域并重跑 certify 脚本。"}
                  </p>
                  {data.gates && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {Object.entries(data.gates).map(([k, v]) => (
                        <span
                          key={k}
                          className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                            v.status === "PASS"
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-amber-300 bg-white text-amber-700"
                          }`}
                        >
                          {k}:{v.status}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* A~G 域 */}
          <div>
            <h2 className="mb-2 text-sm font-medium">
              数据域覆盖（A~G，由 gate 项派生）
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.domains.map(d => (
                <DomainCard key={d.domain as DataDomain} domain={d} />
              ))}
            </div>
          </div>

          <Separator />

          <Tabs defaultValue="gates">
            <TabsList>
              <TabsTrigger value="gates">
                Gate 明细（{data.checks.length}）
              </TabsTrigger>
              <TabsTrigger value="snapshot">数据快照</TabsTrigger>
              <TabsTrigger value="live">实况查库（未认证）</TabsTrigger>
              <TabsTrigger value="evidence">
                证据产物（{data.evidence.length}）
              </TabsTrigger>
            </TabsList>

            {/* Gate 明细 */}
            <TabsContent value="gates">
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-xs">#</TableHead>
                      <TableHead className="text-xs">检查项</TableHead>
                      <TableHead className="w-24 text-xs">状态</TableHead>
                      <TableHead className="text-xs">当前值</TableHead>
                      <TableHead className="text-xs">阈值</TableHead>
                      <TableHead className="text-xs">说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.checks.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {c.id}
                        </TableCell>
                        <TableCell className="text-xs font-medium whitespace-nowrap">
                          {c.name}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={c.status} />
                        </TableCell>
                        <TableCell className="align-top">
                          <KeyValues value={c.current} />
                        </TableCell>
                        <TableCell className="align-top">
                          <KeyValues value={c.threshold} />
                        </TableCell>
                        <TableCell className="max-w-md text-xs text-muted-foreground">
                          {c.detail}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* 数据快照 */}
            <TabsContent value="snapshot">
              {data.snapshot ? (
                <SnapshotSection snapshot={data.snapshot} />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  认证快照中无 snapshot 段
                </p>
              )}
            </TabsContent>

            {/* 实况查库（未认证） */}
            <TabsContent value="live">
              <Card className="border-amber-300">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    未认证实况（仅用于观察回填进度）
                  </CardTitle>
                  <CardDescription className="text-xs">
                    本结果为直接查库的即时值，<strong>未经 gate 认证</strong>，
                    不得作为 RESEARCH_READY 依据；正式判定只认「Gate
                    明细」中的认证快照。 该查询较重（含 COUNT
                    DISTINCT），请按需手动触发。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void live.refetch()}
                    disabled={live.isFetching}
                  >
                    <RefreshCw
                      className={`mr-1.5 h-3.5 w-3.5 ${live.isFetching ? "animate-spin" : ""}`}
                    />
                    查询实况
                  </Button>

                  {live.isFetching && <Skeleton className="mt-3 h-48 w-full" />}

                  {live.isError && (
                    <p className="mt-3 text-sm text-red-700">
                      查询失败：{live.error?.message ?? "未知错误"}
                    </p>
                  )}

                  {live.data?.error && (
                    <p className="mt-3 flex items-start gap-1.5 text-sm text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{live.data.error}</span>
                    </p>
                  )}

                  {live.data && live.data.tables.length > 0 && (
                    <>
                      <p className="mt-3 text-xs text-muted-foreground">
                        查询时间：{fmtTime(live.data.capturedAt)} · certified =
                        <span className="font-mono">false</span>
                        {live.data.error ? " · 部分结果（超时中断）" : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {live.data.note}
                      </p>
                      <div className="mt-2 overflow-x-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="font-mono text-xs">
                                表
                              </TableHead>
                              <TableHead className="text-right text-xs">
                                行数（估算）
                              </TableHead>
                              <TableHead className="text-right text-xs">
                                覆盖（精确）
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {live.data.tables.map(t => (
                              <TableRow key={t.table}>
                                <TableCell className="font-mono text-xs">
                                  {t.table}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs tabular-nums">
                                  {t.rowsEstimated
                                    ? `≈ ${num(t.rows)}`
                                    : num(t.rows)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs tabular-nums">
                                  {t.coverageError ? (
                                    <span
                                      className="text-amber-700"
                                      title={t.coverageError}
                                    >
                                      超时/失败
                                    </span>
                                  ) : t.coverage === null ? (
                                    "—"
                                  ) : (
                                    `${num(t.coverage)} ${t.coverageLabel ?? ""}`
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}

                  {!live.data && !live.isFetching && !live.isError && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      尚未查询。点击「查询实况」获取即时值。
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* 证据产物 */}
            <TabsContent value="evidence">
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">文件</TableHead>
                      <TableHead className="w-20 text-xs">类型</TableHead>
                      <TableHead className="text-right text-xs">大小</TableHead>
                      <TableHead className="text-xs">证据时间</TableHead>
                      <TableHead className="text-xs">修改时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.evidence.map(e => (
                      <TableRow key={e.path}>
                        <TableCell className="flex items-center gap-1.5 font-mono text-xs">
                          <FileJson className="h-3 w-3 shrink-0 text-muted-foreground" />
                          {e.path}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className="font-mono text-[10px]"
                          >
                            {e.kind}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {(e.bytes / 1024).toFixed(1)} KB
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {fmtTime(e.capturedAt)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {fmtTime(e.modifiedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
