/**
 * StrategyVersionCompare — 策略版本演化（原「版本回测对比」）。
 *
 * 页面定位：按正式版本的 `parentVersionId → parentVersion` 父子关系还原一个策略的
 * 版本演化过程，优先完整呈现 3F Top3 的 14 个模式族与 arm。
 *
 * 数据纪律：
 *   - 节点唯一来源 = `strategyDomain.strategy.listVersionCatalog`（正式版本 + 留档指标投影）；
 *   - 父子关系只用真实父版本；无父 / 父记录缺失 / 自引用 / 环形链按独立根展示，不伪造连接；
 *   - 族 / arm 标签与主变化直接读目录行已携带的研究注解（`study.familyDirectory` /
 *     `study.signals`），不在前端另造一套研究口径；
 *   - 完整版本设置复用 `StrategyVersionDetailDialog`，本页不重复实现设置表单。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import type {
  StrategyVersionCatalogRowDto,
  StrategyVersionStudyAnnotationDto,
} from "@shared/researchContracts";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Loader2,
  Search,
  Settings2,
  Star,
  Waypoints,
} from "lucide-react";

import {
  StrategyVersionDetailDialog,
  type StrategyVersionDetailTarget,
} from "@/components/strategy/StrategyVersionDetailDialog";
import { SectionCard, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  buildEvolutionForest,
  collectAllVersions,
  computeDefaultExpandedVersions,
  countDescendants,
  filterEvolutionForest,
  type EvolutionTreeFilter,
  type EvolutionTreeNode,
  type EvolutionTreeRow,
} from "./strategyVersionEvolutionTree";

/**
 * 所有版本共享的基线信号，不能代表「这一版相对父版本改了什么」，
 * 因此不作为节点上的主变化标签；族级 / 版本级独有信号才进入标签。
 */
const BASELINE_SIGNAL_LABELS = new Set(["观察窗", "默认仓位", "成本"]);

interface VersionChangeChip {
  readonly label: string;
  readonly value: string;
}

interface VersionEvolutionRow extends EvolutionTreeRow {
  readonly row: StrategyVersionCatalogRowDto;
  readonly status: string;
  readonly familyLabel: string | null;
  readonly armId: string | null;
  readonly changes: readonly VersionChangeChip[];
  readonly searchText: string;
}

function fmtNum(value: number | null, digits = 2, suffix = ""): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(digits)}${suffix}`;
}

function tone(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  return value >= 0 ? "text-rose-600" : "text-emerald-700";
}

/**
 * 版本 → 模式族 / arm。
 *
 * arm 只在研究目录登记了该版本号时才认领；族内但未登记 arm 的版本只显示族标签，
 * 不冒领 arm 参数，也不为 arm 生成占位节点。
 */
function resolveFamilyAndArm(
  study: StrategyVersionStudyAnnotationDto | null,
  version: string
): { familyLabel: string | null; armId: string | null } {
  if (study === null) return { familyLabel: null, armId: null };
  for (const family of study.familyDirectory) {
    const arm = family.arms.find(item => item.strategyVersion === version);
    if (arm !== undefined) {
      return { familyLabel: family.familyLabel, armId: arm.armId };
    }
  }
  const currentFamily = study.familyDirectory.find(
    family => family.familyId === study.familyId
  );
  return {
    familyLabel: currentFamily?.familyLabel ?? study.familyLabel,
    armId: null,
  };
}

function primaryChanges(
  study: StrategyVersionStudyAnnotationDto | null
): VersionChangeChip[] {
  if (study === null) return [];
  return study.signals
    .filter(signal => !BASELINE_SIGNAL_LABELS.has(signal.label))
    .slice(0, 3)
    .map(signal => ({ label: signal.label, value: signal.value }));
}

function buildSearchText(
  row: StrategyVersionCatalogRowDto,
  study: StrategyVersionStudyAnnotationDto | null,
  familyLabel: string | null,
  armId: string | null
): string {
  return [
    row.version,
    row.versionStatus ?? "",
    row.backtestStatus ?? "",
    row.datasetVersion ?? "",
    row.description ?? "",
    familyLabel ?? "",
    armId ?? "",
    study?.familyLabel ?? "",
    study?.familyId ?? "",
    study?.studyStage ?? "",
    study?.keyDifference ?? "",
    ...(study?.signals.flatMap(signal => [signal.label, signal.value]) ?? []),
  ].join(" ");
}

function toDetailTarget(
  row: StrategyVersionCatalogRowDto
): StrategyVersionDetailTarget {
  return {
    version: row.version,
    status: row.versionStatus ?? row.backtestStatus ?? undefined,
    createdAt: row.versionCreatedAt ?? row.archiveCreatedAt ?? undefined,
    datasetVersion: row.datasetVersion,
    archiveId: row.archiveId,
    study: row.study,
  };
}

interface EvolutionBranchProps {
  readonly node: EvolutionTreeNode<VersionEvolutionRow>;
  readonly isRoot: boolean;
  readonly isLast: boolean;
  readonly visibleVersions: ReadonlySet<string> | null;
  readonly expandedVersions: ReadonlySet<string>;
  readonly selectedVersion: string | null;
  readonly newestVersion: string | null;
  readonly starPending: boolean;
  readonly onToggle: (version: string) => void;
  readonly onSelect: (version: string) => void;
  readonly onOpenDetail: (row: StrategyVersionCatalogRowDto) => void;
  readonly onToggleStar: (row: StrategyVersionCatalogRowDto) => void;
}

/**
 * 单个演化分支：节点卡片 + 缩进的子分支。
 *
 * 折叠只影响渲染，不改变数据：收起的分支仍以「+N 个后续版本」提示存在。
 */
function EvolutionBranch({
  node,
  isRoot,
  isLast,
  visibleVersions,
  expandedVersions,
  selectedVersion,
  newestVersion,
  starPending,
  onToggle,
  onSelect,
  onOpenDetail,
  onToggleStar,
}: EvolutionBranchProps) {
  const isExpanded = expandedVersions.has(node.version);
  const children =
    visibleVersions === null
      ? node.children
      : node.children.filter(child => visibleVersions.has(child.version));
  const descendantCount = countDescendants(node);
  const selected = selectedVersion === node.version;
  const showTrunkBelow = isExpanded && children.length > 0;
  const study = node.row.row.study;

  return (
    <li className="relative list-none pl-7">
      {!isRoot && (
        <>
          <span
            aria-hidden
            className="absolute left-0 top-0 h-[18px] w-px bg-border"
          />
          {(showTrunkBelow || !isLast) && (
            <span
              aria-hidden
              className="absolute bottom-0 left-0 top-[18px] w-px bg-border"
            />
          )}
          <span
            aria-hidden
            className="absolute left-0 top-[18px] h-px w-7 bg-border"
          />
        </>
      )}

      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => onSelect(node.version)}
        onDoubleClick={() => onOpenDetail(node.row.row)}
        onKeyDown={event => {
          if (event.key === "Enter") onOpenDetail(node.row.row);
          if (event.key === " ") {
            event.preventDefault();
            onSelect(node.version);
          }
        }}
        title={study?.keyDifference ?? undefined}
        className={cn(
          "cursor-pointer rounded-md border bg-card px-3 py-2 text-left transition-colors",
          selected
            ? "border-teal-400 bg-teal-50/60 ring-1 ring-teal-200"
            : "hover:border-teal-300 hover:bg-muted/30"
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {node.children.length > 0 ? (
            <button
              type="button"
              aria-label={isExpanded ? "收起分支" : "展开分支"}
              title={isExpanded ? "收起分支" : "展开分支"}
              className="rounded p-0.5 text-muted-foreground hover:text-teal-700"
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onToggle(node.version);
              }}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span aria-hidden className="w-4.5" />
          )}

          <span className="font-mono text-sm font-semibold">
            v{node.version}
          </span>
          <StatusBadge status={node.row.status} />
          {node.version === newestVersion && (
            <span className="rounded bg-teal-700 px-1.5 py-0.5 text-[10px] font-medium text-white">
              最新
            </span>
          )}
          {node.row.familyLabel !== null && (
            <span className="inline-flex items-center gap-1 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-800">
              <Waypoints className="h-3 w-3" />
              {node.row.familyLabel}
              {node.row.armId !== null && (
                <span className="font-mono font-semibold">
                  · {node.row.armId}
                </span>
              )}
            </span>
          )}

          <span className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              title="查看版本设置"
              aria-label="查看版本设置"
              className="rounded p-0.5 text-muted-foreground hover:text-teal-700"
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onOpenDetail(node.row.row);
              }}
              onDoubleClick={event => event.stopPropagation()}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={node.row.row.isStarred ? "取消星标" : "加星标"}
              aria-label={node.row.row.isStarred ? "取消星标" : "加星标"}
              className={cn(
                "rounded p-0.5",
                node.row.row.isStarred
                  ? "text-amber-500 hover:text-amber-600"
                  : "text-muted-foreground hover:text-amber-500"
              )}
              disabled={starPending}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onToggleStar(node.row.row);
              }}
              onDoubleClick={event => event.stopPropagation()}
            >
              <Star
                className="h-3.5 w-3.5"
                fill={node.row.row.isStarred ? "currentColor" : "none"}
              />
            </button>
          </span>
        </div>

        {node.row.changes.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {node.row.changes.map(change => (
              <span
                key={`${node.version}-${change.label}`}
                className="max-w-[18rem] truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                title={`${change.label}：${change.value}`}
              >
                <span className="font-mono">{change.label}</span>
                <span className="mx-1">:</span>
                {change.value}
              </span>
            ))}
          </div>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {!isExpanded && descendantCount > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5">
              +{descendantCount} 个后续版本
            </span>
          )}
          {node.row.row.archiveId === null ? (
            <span>无回测留档</span>
          ) : (
            <>
              <span>
                收益{" "}
                <span
                  className={cn(
                    "font-mono tabular-nums",
                    tone(node.row.row.totalReturnPct)
                  )}
                >
                  {fmtNum(node.row.row.totalReturnPct, 2, "%")}
                </span>
              </span>
              <span>
                回撤{" "}
                <span className="font-mono tabular-nums text-emerald-700">
                  {fmtNum(node.row.row.maxDrawdownPct, 2, "%")}
                </span>
              </span>
              <span>
                年化{" "}
                <span className="font-mono tabular-nums">
                  {fmtNum(node.row.row.cagrPct, 2, "%")}
                </span>
              </span>
              {node.row.row.datasetVersion !== null && (
                <span>数据集 {node.row.row.datasetVersion}</span>
              )}
            </>
          )}
        </div>
      </div>

      {isExpanded && children.length > 0 && (
        <ul className="relative mt-2 space-y-2">
          {children.map((child, index) => (
            <EvolutionBranch
              key={child.version}
              node={child}
              isRoot={false}
              isLast={index === children.length - 1}
              visibleVersions={visibleVersions}
              expandedVersions={expandedVersions}
              selectedVersion={selectedVersion}
              newestVersion={newestVersion}
              starPending={starPending}
              onToggle={onToggle}
              onSelect={onSelect}
              onOpenDetail={onOpenDetail}
              onToggleStar={onToggleStar}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function StrategyVersionCompare() {
  const params = useParams();
  const strategyId = String(params.strategyId ?? "");
  const utils = trpc.useUtils();

  // 版本演化树的唯一数据源：服务端把留档运行指标投影到正式 `strategy_versions` 行上，
  // 并把 `parentVersionId` 解析成可读 `parentVersion`；前端不再自行合并两个数据源。
  const catalogQuery = trpc.strategyDomain.strategy.listVersionCatalog.useQuery(
    { strategyId },
    { enabled: strategyId !== "", retry: false, refetchOnWindowFocus: false }
  );

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string> | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [detailRow, setDetailRow] =
    useState<StrategyVersionCatalogRowDto | null>(null);

  const nodeRows = useMemo<VersionEvolutionRow[]>(
    () =>
      (catalogQuery.data ?? []).map(row => {
        const study = row.study;
        const { familyLabel, armId } = resolveFamilyAndArm(study, row.version);
        return {
          version: row.version,
          parentVersion: row.parentVersion,
          row,
          status: row.versionStatus ?? row.backtestStatus ?? "Unknown",
          familyLabel,
          armId,
          changes: primaryChanges(study),
          searchText: buildSearchText(row, study, familyLabel, armId),
        };
      }),
    [catalogQuery.data]
  );

  const forest = useMemo(() => buildEvolutionForest(nodeRows), [nodeRows]);
  const defaultExpanded = useMemo(
    () => computeDefaultExpandedVersions(forest),
    [forest]
  );
  const filter = useMemo<EvolutionTreeFilter | null>(
    () => filterEvolutionForest(forest, search, node => node.searchText),
    [forest, search]
  );

  // 星标乐观更新会替换目录数组、重建森林；折叠状态只在版本集合真正变化时重置，
  // 避免用户加星后整棵树被收起。
  const versionSignature = useMemo(
    () => forest.orderedVersions.join("\u0000"),
    [forest]
  );
  useEffect(() => {
    setExpanded(null);
  }, [strategyId, versionSignature]);

  useEffect(() => {
    if (
      selectedVersion !== null &&
      !forest.nodesByVersion.has(selectedVersion)
    ) {
      setSelectedVersion(null);
    }
  }, [forest, selectedVersion]);

  const expandedVersions =
    filter !== null ? filter.expandedVersions : expanded ?? defaultExpanded;
  const visibleVersions = filter?.visibleVersions ?? null;

  const toggleExpanded = useCallback(
    (version: string) => {
      setExpanded(current => {
        const next = new Set(current ?? defaultExpanded);
        if (next.has(version)) {
          next.delete(version);
        } else {
          next.add(version);
        }
        return next;
      });
    },
    [defaultExpanded]
  );

  const expandAll = useCallback(() => {
    setExpanded(new Set(collectAllVersions(forest)));
  }, [forest]);

  const focusNewest = useCallback(() => {
    setExpanded(new Set(defaultExpanded));
    setSelectedVersion(forest.newestVersion);
  }, [defaultExpanded, forest.newestVersion]);

  // 星标是低频小写；先本地改目录缓存让节点即时变色，失败再回滚并提示。
  const setVersionStarred =
    trpc.strategyDomain.strategy.setVersionStarred.useMutation({
      onMutate: async input => {
        const catalogKey = { strategyId: input.strategyId };
        await utils.strategyDomain.strategy.listVersionCatalog.cancel(
          catalogKey
        );
        const catalogSnapshot =
          utils.strategyDomain.strategy.listVersionCatalog.getData(catalogKey);
        utils.strategyDomain.strategy.listVersionCatalog.setData(
          catalogKey,
          current => {
            if (current === undefined) return current;
            return current.map(row =>
              row.version === input.version
                ? { ...row, isStarred: input.isStarred }
                : row
            );
          }
        );
        return { catalogSnapshot };
      },
      onError: (error, input, context) => {
        if (context?.catalogSnapshot !== undefined) {
          utils.strategyDomain.strategy.listVersionCatalog.setData(
            { strategyId: input.strategyId },
            context.catalogSnapshot
          );
        }
        toast.error("星标更新失败", { description: error.message });
      },
      onSuccess: () => {
        void utils.strategyDomain.strategy.listVersionCatalog.invalidate({
          strategyId,
        });
      },
    });

  const toggleStar = useCallback(
    (row: StrategyVersionCatalogRowDto) => {
      setVersionStarred.mutate({
        strategyId,
        version: row.version,
        isStarred: !row.isStarred,
      });
    },
    [setVersionStarred, strategyId]
  );

  const rootNodes =
    visibleVersions === null
      ? forest.roots
      : forest.roots.filter(root => visibleVersions.has(root.version));

  const hasVersions = nodeRows.length > 0;
  const noMatch = filter !== null && filter.matchCount === 0;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/strategies">
          <Button size="sm" variant="ghost">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            返回策略
          </Button>
        </Link>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <GitBranch className="h-4.5 w-4.5 text-teal-700" />
          策略版本演化
        </h1>
        <span
          title={strategyId}
          className="w-full break-all font-mono text-xs text-muted-foreground sm:w-auto"
        >
          {strategyId}
        </span>
      </div>

      <SectionCard
        title="版本演化树"
        icon={Waypoints}
        description="按正式版本的父子关系还原版本演进；无父、父记录缺失或成环的版本作为独立根展示。"
        className="min-w-0"
        contentClassName="min-w-0"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-1.5 sm:min-w-[200px] sm:flex-1">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="搜索版本号、模式族或 arm"
              className="h-7 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={expandAll}>
              展开全部
            </Button>
            <Button size="sm" variant="outline" onClick={focusNewest}>
              仅看最新路径
            </Button>
            <span className="text-[11px] text-muted-foreground">
              共 {nodeRows.length} 个版本
              {filter !== null ? `，${filter.matchCount} 个匹配` : ""}
            </span>
          </div>
        </div>

        {catalogQuery.isLoading ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            读取版本目录…
          </p>
        ) : catalogQuery.error ? (
          <p className="font-mono text-xs text-rose-600">
            {catalogQuery.error.message}
          </p>
        ) : !hasVersions ? (
          <p className="text-xs text-muted-foreground">该策略暂无正式版本。</p>
        ) : noMatch ? (
          <p className="text-xs text-muted-foreground">没有匹配的版本。</p>
        ) : (
          <div className="w-full min-w-0 overflow-x-auto pb-1">
            <ul className="min-w-[280px] space-y-2">
              {rootNodes.map(root => (
                <EvolutionBranch
                  key={root.version}
                  node={root}
                  isRoot
                  isLast
                  visibleVersions={visibleVersions}
                  expandedVersions={expandedVersions}
                  selectedVersion={selectedVersion}
                  newestVersion={forest.newestVersion}
                  starPending={setVersionStarred.isPending}
                  onToggle={toggleExpanded}
                  onSelect={setSelectedVersion}
                  onOpenDetail={setDetailRow}
                  onToggleStar={toggleStar}
                />
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      <StrategyVersionDetailDialog
        open={detailRow !== null}
        onOpenChange={open => {
          if (!open) setDetailRow(null);
        }}
        strategyId={strategyId}
        target={detailRow === null ? null : toDetailTarget(detailRow)}
      />
    </div>
  );
}
