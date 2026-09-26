/**
 * 独立研究实验列表（`/research-experiments`，RESEARCH-EXPERIMENT-001 / 004 / LIST-001）。
 *
 * 一屏回答：平台上有哪些独立研究实验、每个实验要什么数据、**最近跑成什么样**。
 *
 * ## 分级展示（LIST-001，2026-09-26 按命名空间 + 因子口径改定）
 *
 * ```
 * 一级 = 模式（= experimentId 的命名空间段）  first-board-pullback 首板回撤研究 / combo-backtest 组合回测迁移
 *   └─ 二级 = 口径（自变量是不是「因子」）    单因子 / 多因子 / 其他口径
 *        └─ 三级 = 该口径下的实验行           沿用原来的表格行（版本 / 数据集 / 状态 / Latest Run / 操作）
 * ```
 *
 * 🔴 为什么要分级：实验已经到 34 个，平铺一张表时「谁和谁是一族的」只存在于作者脑子里。
 *    两级映射都是 `./experimentModes.ts` 里的**显式清单**（**展示层分类，不是研究结论**；
 *    质量档位 / 处置见 `docs/research/FIRST-BOARD-PULLBACK-EXPERIMENT-CURATION.md`）。
 *    没被认领的实验落「其他（未归类）」并**在页面上带提示** —— 漏归位必须可见。
 *    该不变量由 `tests/client/src/pages/researchExperimentModeGrouping.test.ts` 钉死。
 *
 * 🔴 组内分页：最深的切片单位是「模式 × 口径」，最大档 17 个，一次性全列会把「分级」又拉回
 *    一张长表。分页是**纯前端切片**（复用 `@/components/PaginationBar`，与 `/backtest`
 *    同一件控件），**不新增端点、不改任何统计口径**：两级标题的「N 个实验 / M 条 Run」
 *    永远按全量计，只有渲染层切片（与 `9bf` 在 `/backtest` 的处置一致）。
 *
 * ## 004 带来的变化
 *
 * 本页原来只显示「代码里声明了什么」（描述符来自注册表，不依赖数据库）。
 * 004 之后每次运行都会落库一条 Run，于是本页多了一维**事实**：
 * 每个实验跑了多少次、最近一次什么状态、什么时候跑的、产出了什么。
 *
 * 🔴 关键纪律：**描述符是代码事实、Run 是数据库事实，两者取数路径不同**。
 *    数据库不可用时描述符仍然拿得到 ⇒ 不能整页报错；但也**不能显示「0 个 Run」**，
 *    那等于把故障伪装成事实。所以 `runsAvailable=false` 时本页显示琥珀色说明，
 *    并明确写出「这不代表没有历史 Run」；分组统计里这些实验**不计入 runCount**。
 *
 * 🔴 与 `/research`（旧 Research 工作台）的区别必须一眼可见：旧页是「一个实验绑定一份
 *    Dataset 版本、再挂 Run / 分析 / 结果 / 结论」；本页是「**独立实验**：自带参数与结果
 *    结构，可直接读 Dataset，**不需要**经过 Analysis / Finding / Conclusion 这条旧链路」。
 *    本页是**唯一**正式研究入口。
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ChevronDown,
  FlaskConical,
  History,
  Layers,
  LineChart,
  Loader2,
} from "lucide-react";
import type { ExperimentSummary } from "@shared/researchExperimentsContracts";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/common";
import { PaginationBar } from "@/components/PaginationBar";
import { rpcErrorToDiagnostic } from "@/lib/rpcDiagnostic";
import {
  EXPERIMENT_PAGE_SIZE_DEFAULT,
  EXPERIMENT_PAGE_SIZE_OPTIONS,
  groupExperimentsByModeAndKind,
  modeKindStateKey,
  resolvePageWindow,
  type ExperimentKindGroup,
  type ExperimentModeGroup,
} from "./experimentModes";
import { NoArtifactBadge, RunStatusBadge, formatDateTime, formatDuration } from "./runShared";

/** 把 `group/key` 拆成两段（详情路由是 `/research-experiments/:group/:key`）。 */
function splitExperimentId(id: string): { group: string; key: string } {
  const index = id.indexOf("/");
  if (index < 0) return { group: id, key: "" };
  return { group: id.slice(0, index), key: id.slice(index + 1) };
}

/** 一行 Run 的「Latest Run」单元格：坐标 + 耗时 + 参数摘要（**不拉 Result 内容**）。 */
function LatestRunCell({ summary }: { summary: ExperimentSummary }) {
  const run = summary.latestRun;
  if (!summary.runsAvailable) {
    return <NoArtifactBadge text="取不到" />;
  }
  if (run === null) {
    return <span className="text-xs text-muted-foreground">尚无 Run</span>;
  }
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-[11px]">{run.runId}</p>
      <p className="text-[11px] text-muted-foreground">
        耗时 {formatDuration(run.durationMs)} · Dataset {run.datasetVersionLabel}
        <span className="ml-1">(id={run.datasetVersionId})</span>
      </p>
    </div>
  );
}

/** 一行 Run 的「状态」单元格。`runsAvailable=false` 时**不猜**，如实说取不到。 */
function StatusCell({ summary }: { summary: ExperimentSummary }) {
  const run = summary.latestRun;
  if (!summary.runsAvailable) {
    return (
      <Badge variant="outline" className="font-mono text-[10px] text-amber-700">
        <AlertTriangle className="mr-1 h-3 w-3" />
        未知
      </Badge>
    );
  }
  if (run === null) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        未运行
      </Badge>
    );
  }
  return <RunStatusBadge run={run} />;
}

/** 一个实验行（列定义与 LIST-001 之前逐字一致，**只是被挪进口径分组里**）。 */
function ExperimentRow({ summary }: { summary: ExperimentSummary }) {
  const descriptor = summary.descriptor;
  const { group, key } = splitExperimentId(descriptor.id);
  const requirement = descriptor.datasetRequirement;
  const detailPath = `/research-experiments/${encodeURIComponent(group)}/${encodeURIComponent(key)}`;

  return (
    <TableRow data-experiment-row={descriptor.id}>
      <TableCell className="max-w-md">
        <p className="text-sm font-medium">{descriptor.name}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{descriptor.id}</p>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {descriptor.description}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <Badge variant="secondary" className="text-[10px]">
            {descriptor.parameters.length} 个参数
          </Badge>
          {summary.runsAvailable && summary.runCount > 0 && (
            <Badge variant="outline" className="text-[10px]">
              <History className="mr-1 h-3 w-3" />
              {summary.runCount} 条 Run
            </Badge>
          )}
          {(descriptor.tags ?? []).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">v{descriptor.version}</TableCell>
      <TableCell className="text-xs">
        <span className="font-mono">{requirement.datasetCode}</span>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {requirement.usesForwardData ? "使用事件日之后数据" : "只用事件日及之前数据"}
        </p>
      </TableCell>
      <TableCell>
        <StatusCell summary={summary} />
      </TableCell>
      <TableCell className="max-w-[260px]">
        <LatestRunCell summary={summary} />
      </TableCell>
      <TableCell className="text-[11px] tabular-nums">
        {summary.runsAvailable ? formatDateTime(summary.latestRun?.startedAt ?? null) : "—"}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1.5">
          {summary.latestRun !== null && (
            <Button asChild size="sm" variant="ghost" className="h-7">
              <Link
                href={`${detailPath}/runs/${encodeURIComponent(summary.latestRun.runId)}`}
                data-open-latest-run={summary.latestRun.runId}
              >
                <History className="mr-1 h-3 w-3" /> 最近一次
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link href={detailPath} data-open-experiment={descriptor.id}>
              <LineChart className="mr-1.5 h-3.5 w-3.5" /> 打开
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * 二级：一个口径档 —— 可折叠小标题 + 档内实验表 + 档内分页。
 *
 * 分页状态键 = `modeKey::kindKey`（两级同名口径不会互相覆盖）。
 */
function ExperimentKindSection({
  modeKey,
  kindGroup,
  collapsed,
  page,
  pageSize,
  onToggle,
  onPageChange,
  onPageSizeChange,
}: {
  modeKey: string;
  kindGroup: ExperimentKindGroup;
  collapsed: boolean;
  page: number;
  pageSize: number;
  onToggle: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const {
    totalPages,
    safePage,
    startIndex,
    items: visible,
  } = resolvePageWindow(kindGroup.items, page, pageSize);

  return (
    <div
      data-experiment-kind={kindGroup.kind.key}
      data-experiment-kind-of={modeKey}
      className={cn(
        "rounded-lg border p-3",
        kindGroup.unclassified && "border-amber-300 bg-amber-50/60"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            data-experiment-kind-toggle={`${modeKey}::${kindGroup.kind.key}`}
            className="flex items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                collapsed && "-rotate-90"
              )}
            />
            <span className="text-sm font-semibold">{kindGroup.kind.label}</span>
          </button>
          <p className="line-clamp-2 pl-5 text-[11px] text-muted-foreground">
            {kindGroup.kind.description}
          </p>
        </div>
        <div
          data-experiment-kind-stats={`${modeKey}::${kindGroup.kind.key}`}
          className="flex flex-wrap items-center justify-end gap-1.5"
        >
          <Badge variant="secondary" className="font-mono text-[10px]">
            {kindGroup.experimentCount} 个实验
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            <History className="mr-1 h-3 w-3" />
            {kindGroup.runCount} 条 Run
          </Badge>
          {kindGroup.runsUnavailableCount > 0 && (
            <Badge variant="outline" className="font-mono text-[10px] text-amber-700">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {kindGroup.runsUnavailableCount} 个取不到 Run
            </Badge>
          )}
        </div>
      </div>

      {kindGroup.unclassified && !collapsed && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
          这些实验没被写进任何口径（`client/src/pages/researchExperiments/experimentModes.ts`）——
          不归位不影响运行，但这里会一直把它们单列出来。
        </p>
      )}

      {!collapsed && (
        <>
          <div className="mt-2 overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>实验</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>数据集</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>Latest Run</TableHead>
                  <TableHead>最近运行时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((summary) => (
                  <ExperimentRow key={summary.descriptor.id} summary={summary} />
                ))}
              </TableBody>
            </Table>
          </div>
          <div
            data-experiment-kind-pager={`${modeKey}::${kindGroup.kind.key}`}
            className="mt-2 flex flex-wrap items-center justify-between gap-2"
          >
            <span className="text-xs text-muted-foreground">
              本档显示第 {startIndex + 1}–{startIndex + visible.length} 个 / 共{" "}
              {kindGroup.items.length} 个实验
            </span>
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              pageSize={pageSize}
              pageSizeOptions={[...EXPERIMENT_PAGE_SIZE_OPTIONS]}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** 一级：一个模式（命名空间）—— 可折叠卡片，内含若干口径档。 */
function ExperimentModeSection({
  group,
  collapsed,
  kindCollapsed,
  kindPages,
  kindPageSizes,
  onToggle,
  onToggleKind,
  onPageChange,
  onPageSizeChange,
}: {
  group: ExperimentModeGroup;
  collapsed: boolean;
  kindCollapsed: Record<string, boolean>;
  kindPages: Record<string, number>;
  kindPageSizes: Record<string, number>;
  onToggle: () => void;
  onToggleKind: (kindKey: string) => void;
  onPageChange: (kindKey: string, page: number) => void;
  onPageSizeChange: (kindKey: string, pageSize: number) => void;
}) {
  const modeKey = group.mode.key;
  return (
    <Card data-experiment-mode={modeKey}>
      <CardHeader className="gap-1.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!collapsed}
              data-experiment-mode-toggle={modeKey}
              className="flex w-full items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  collapsed && "-rotate-90"
                )}
              />
              <CardTitle className="text-base">{group.mode.label}</CardTitle>
              <Badge variant="outline" className="font-mono text-[10px] font-normal">
                {group.mode.idPrefix}
              </Badge>
            </button>
            <CardDescription className="text-xs">{group.mode.description}</CardDescription>
          </div>
          <div
            data-experiment-mode-stats={modeKey}
            className="flex flex-wrap items-center justify-end gap-1.5"
          >
            <Badge variant="secondary" className="font-mono text-[10px]">
              {group.experimentCount} 个实验
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {group.kindGroups.length} 个口径
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              <History className="mr-1 h-3 w-3" />
              {group.runCount} 条 Run
            </Badge>
            {group.runsUnavailableCount > 0 && (
              <Badge variant="outline" className="font-mono text-[10px] text-amber-700">
                <AlertTriangle className="mr-1 h-3 w-3" />
                {group.runsUnavailableCount} 个取不到 Run
              </Badge>
            )}
            {collapsed && <span className="text-[10px] text-muted-foreground">已收起</span>}
          </div>
        </div>
        {group.unclassified && !collapsed && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
            这个命名空间没有登记到 experimentModes.ts ——
            不归位不影响运行，但这里会一直把它们单列出来。
          </p>
        )}
      </CardHeader>

      {!collapsed && (
        <CardContent className="space-y-2 p-4 pt-0">
          {group.kindGroups.map((kindGroup) => {
            const stateKey = modeKindStateKey(modeKey, kindGroup.kind.key);
            return (
              <ExperimentKindSection
                key={stateKey}
                modeKey={modeKey}
                kindGroup={kindGroup}
                collapsed={kindCollapsed[stateKey] ?? false}
                page={kindPages[stateKey] ?? 1}
                pageSize={kindPageSizes[stateKey] ?? EXPERIMENT_PAGE_SIZE_DEFAULT}
                onToggle={() => onToggleKind(kindGroup.kind.key)}
                onPageChange={(page) => onPageChange(kindGroup.kind.key, page)}
                onPageSizeChange={(pageSize) => onPageSizeChange(kindGroup.kind.key, pageSize)}
              />
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

export default function ResearchExperimentList() {
  const experiments = trpc.researchExperiments.list.useQuery({}, { staleTime: 30_000 });

  const rows = useMemo(() => experiments.data ?? [], [experiments.data]);
  const groups = useMemo(() => groupExperimentsByModeAndKind(rows), [rows]);

  // 折叠 / 分页状态：一级按模式键、二级按 `modeKey::kindKey`（默认全展开、第 1 页）
  const [collapsedByMode, setCollapsedByMode] = useState<Record<string, boolean>>({});
  const [collapsedByKind, setCollapsedByKind] = useState<Record<string, boolean>>({});
  const [pageByKind, setPageByKind] = useState<Record<string, number>>({});
  const [pageSizeByKind, setPageSizeByKind] = useState<Record<string, number>>({});

  const allStateKeys = useMemo(
    () =>
      groups.flatMap((group) =>
        group.kindGroups.map((kindGroup) =>
          modeKindStateKey(group.mode.key, kindGroup.kind.key)
        )
      ),
    [groups]
  );

  const toggleMode = (key: string) =>
    setCollapsedByMode((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleKind = (modeKey: string, kindKey: string) => {
    const stateKey = modeKindStateKey(modeKey, kindKey);
    setCollapsedByKind((prev) => ({ ...prev, [stateKey]: !prev[stateKey] }));
  };
  // 「全部收起 / 展开」必须同时作用于两级 —— 只收一级会让二级标题仍平铺一屏
  const setAllCollapsed = (collapsed: boolean) => {
    setCollapsedByMode(collapsed ? Object.fromEntries(groups.map((g) => [g.mode.key, true])) : {});
    setCollapsedByKind(
      collapsed ? Object.fromEntries(allStateKeys.map((key) => [key, true])) : {}
    );
  };
  const changePage = (modeKey: string, kindKey: string, page: number) =>
    setPageByKind((prev) => ({ ...prev, [modeKindStateKey(modeKey, kindKey)]: page }));
  const changePageSize = (modeKey: string, kindKey: string, pageSize: number) => {
    const stateKey = modeKindStateKey(modeKey, kindKey);
    setPageSizeByKind((prev) => ({ ...prev, [stateKey]: pageSize }));
    // 每页条数变化必须回到第 1 页 —— 否则会停在一个可能不存在的页码上（`9bf` 同一口径）
    setPageByKind((prev) => ({ ...prev, [stateKey]: 1 }));
  };

  // 只要有任何一个实验的 Run 事实取不到，就在页首如实说明（不让用户逐行去猜）。
  const runsUnavailable = rows.filter((row) => !row.runsAvailable);
  const totalRuns = rows.reduce(
    (sum, row) => sum + (row.runsAvailable ? row.runCount : 0),
    0
  );
  const totalKinds = groups.reduce((sum, group) => sum + group.kindGroups.length, 0);
  const allCollapsed =
    groups.length > 0 && groups.every((group) => collapsedByMode[group.mode.key]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" /> 独立研究实验
            {rows.length > 0 && (
              <>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {rows.length} 个实验 · {groups.length} 个模式 · {totalKinds} 个口径 · {totalRuns} 条
                  Run
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 text-xs"
                  data-experiment-collapse-all={allCollapsed ? "expand" : "collapse"}
                  onClick={() => setAllCollapsed(!allCollapsed)}
                >
                  <ChevronDown
                    className={cn(
                      "mr-1 h-3.5 w-3.5 transition-transform",
                      allCollapsed && "-rotate-90"
                    )}
                  />
                  {allCollapsed ? "全部展开" : "全部收起"}
                </Button>
              </>
            )}
          </CardTitle>
          <CardDescription>
            「独立实验」自带<strong>参数</strong>与<strong>结果结构</strong>，可直接读取 Dataset，
            <strong>不经过</strong>旧研究链路的分析 / 发现 / 结论。
            每次运行都会<strong>落库一条 Run</strong>（TiDB 存元数据），
            结果、Manifest、CSV / Parquet / 图表等产物写到<strong>对象存储</strong> ——
            <strong>刷新或关闭页面后仍可打开历史 Run，不需要重跑</strong>。
            新增实验不需要改核心代码 —— 契约与生成规范见
            <span className="mx-1 font-mono text-xs">docs/research/EXPERIMENT-CODE-SPEC.md</span>。
          </CardDescription>
          <p className="text-xs text-muted-foreground">
            下面按<strong>两级</strong>分组：一级是<strong>模式</strong>（= 实验 id 的命名空间段，
            如 <span className="font-mono text-[11px]">first-board-pullback</span>），
            二级是<strong>口径</strong>（<strong>单因子 / 多因子 / 其他口径</strong>，即自变量是不是
            「因子」）；最内层实验分页显示。
            这套分组是<strong>展示层分类</strong>，不含任何「哪一族更好」的判断。
          </p>
          <p className="text-xs text-muted-foreground">
            本页是项目的<strong>唯一</strong>正式研究入口。
          </p>
        </CardHeader>
      </Card>

      {experiments.isLoading && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-28 w-full" />
          </CardContent>
        </Card>
      )}

      {experiments.error && !experiments.isLoading && (
        <ErrorState
          error={rpcErrorToDiagnostic(experiments.error.message, { title: "实验列表加载失败" })}
        />
      )}

      {runsUnavailable.length > 0 && (
        <Alert
          className="border-amber-300 bg-amber-50"
          data-experiment-runs-unavailable={String(runsUnavailable.length)}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <AlertTitle className="text-sm">
            有 {runsUnavailable.length} 个实验的「运行历史」暂时取不到
          </AlertTitle>
          <AlertDescription className="space-y-1 text-xs">
            <p>
              <span className="font-mono">{runsUnavailable[0]?.runsError?.code}</span>：
              {runsUnavailable[0]?.runsError?.message}
            </p>
            <p className="text-muted-foreground">
              实验<strong>描述符</strong>来自代码里的注册表，不依赖数据库，所以本页仍可打开；
              但 Run 事实来自 TiDB。因此下面标「取不到」的那些行，
              <strong>不代表它们没有历史 Run</strong> —— 只是本次没能读到
              （组头的 Run 计数同样<strong>不含</strong>它们）。
            </p>
          </AlertDescription>
        </Alert>
      )}

      {experiments.data && rows.length === 0 && (
        <EmptyState
          icon={FlaskConical}
          title="还没有注册任何独立实验"
          description="在 research-experiments/ 下新增一个实验目录，并在 manifest 里加一行即可（详见 EXPERIMENT-CODE-SPEC.md）。"
        />
      )}

      {groups.map((group) => (
        <ExperimentModeSection
          key={group.mode.key}
          group={group}
          collapsed={collapsedByMode[group.mode.key] ?? false}
          kindCollapsed={collapsedByKind}
          kindPages={pageByKind}
          kindPageSizes={pageSizeByKind}
          onToggle={() => toggleMode(group.mode.key)}
          onToggleKind={(kindKey) => toggleKind(group.mode.key, kindKey)}
          onPageChange={(kindKey, page) => changePage(group.mode.key, kindKey, page)}
          onPageSizeChange={(kindKey, pageSize) =>
            changePageSize(group.mode.key, kindKey, pageSize)
          }
        />
      ))}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4" /> 平台提供什么
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <p>· 页面挂载机制（`pageKey` → 实验自己的页面）与元数据回显</p>
          <p>· Dataset 版本选择 + 参数表单（由参数定义自动渲染）</p>
          <p>· 执行与执行元数据（耗时 / Dataset 坐标 / 实际参数）</p>
          <p>· **Run 持久化**：TiDB 存元数据，对象存储存结果与产物，可回看历史</p>
          <p>· 错误状态与加载状态（领域码可读化）</p>
          <p>· 产物只给「元数据 + 按需下载」，页面初始化不自动拉大文件</p>
        </CardContent>
      </Card>

      {experiments.isFetching && !experiments.isLoading && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> 刷新中…
        </p>
      )}
    </div>
  );
}
