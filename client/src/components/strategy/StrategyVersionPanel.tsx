/**
 * StrategyVersionPanel — 策略工作台「版本与状态」页签。
 *
 * 它回答三个**真实**问题（这三件事后端早已具备，此前页面却完全没露出来，
 * 反而要求用户手贴两份完整 StrategyDocument JSON 才能看到差异）：
 *
 *   1. 「这个策略有哪些版本、各自什么状态？」 → `research.strategy.listVersions`（只读）；
 *   2. 「我这次改了哪些地方？」               → `research.strategy.compare`（草稿 ↔ 已落库版本）；
 *   3. 「把这一版的状态改成 X。」             → `research.strategy.setVersionStatus`（真实写库）。
 *
 * 纪律（与项目铁律一致）：
 * - **不重算任何判定**：差异、状态合法性一律来自后端；本组件只发起请求与展示结果；
 * - **不伪造状态**：当前状态取自后端版本行（`listVersions[].status`），不是本地常量，
 *   也不是组件的 `useState` 默认值；
 * - 🔴 **`client/**` 不能 import 后端 / shared 的运行时值**（会把 `zod` 打进浏览器包）⇒
 *   状态词表用**客户端常量 + 对表测试**落地（`@/lib/status` ↔
 *   `tests/client/src/lib/statusVocabulary.test.ts`），后端改词表则该测试先红。
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  GitCompareArrows,
  History,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Tag,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { SectionCard, StatusBadge } from "@/components/common";
import { STRATEGY_VERSION_STATUS_OPTIONS } from "@/lib/status";
import { formatDateTime } from "@/lib/displayFormat";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import type { StrategyLifecycleStatusValue } from "@shared/researchContracts";

// 类型取自真实 tRPC 路由（与 `RunConfigPanel` 同一种写法），不手写 DTO、不复制口径。
type RouterOutputs = inferRouterOutputs<AppRouter>;
// RESEARCH-EXPERIMENT-003 —— 策略域命名空间由 `research.*` 改名 `strategyDomain.*`。
type VersionRows = RouterOutputs["strategyDomain"]["strategy"]["listVersions"];
type LabeledDiff = RouterOutputs["strategyDomain"]["strategy"]["compare"];

function shortHash(h: string): string {
  return h.length <= 16 ? h : `${h.slice(0, 12)}…${h.slice(-4)}`;
}

/** 版本状态的人话说明（逐条对齐 §23 语义，不按字面翻译）。 */
const STATUS_HINT: Record<string, string> = {
  Draft: "草稿：尚未进入研究流程。",
  Research: "研究中：正在做假设与验证。",
  Candidate: "候选：有研究证据，等待取舍。",
  Validated: "已验证：通过了数据集门槛。",
  Paper: "纸面交易：前向跟踪，未投真金。",
  Approved: "已批准：评审通过，可上线。",
  Production: "生产中：实盘运行。",
  Retired: "已退役：终态。",
};

export function StrategyVersionPanel({
  strategyId,
  version,
  versions,
  versionsLoading,
  onRefetchVersions,
  savedDocument,
  draftDocument,
}: {
  strategyId: string;
  version: string;
  /** 后端 `listVersions` 结果；`null` = 尚未取到。 */
  versions: VersionRows | null;
  versionsLoading: boolean;
  onRefetchVersions: () => void;
  /** 已落库的文档（上次「加载 / 保存」的产物）；`null` = 当前草稿尚无落库对照物。 */
  savedDocument: Record<string, unknown> | null;
  /** 当前草稿（`viewModelToStrategy(vm)`）—— 比较的右值。 */
  draftDocument: Record<string, unknown>;
}) {
  const compare = trpc.strategyDomain.strategy.compare.useMutation();
  const setStatus = trpc.strategyDomain.strategy.setVersionStatus.useMutation();

  const [nextStatus, setNextStatus] = useState<StrategyLifecycleStatusValue | "">("");
  const [diff, setDiff] = useState<LabeledDiff | null>(null);
  const [cmpError, setCmpError] = useState<string | null>(null);

  const current = versions?.find(v => v.version === version) ?? null;
  const currentStatus = current?.status ?? null;

  function runCompare() {
    if (savedDocument === null) return;
    setCmpError(null);
    compare.mutate(
      { left: savedDocument, right: draftDocument },
      { onSuccess: d => setDiff(d) }
    );
  }

  function applyStatus() {
    if (nextStatus === "") return;
    setStatus.mutate(
      { strategyId, version, status: nextStatus },
      {
        onSuccess: () => {
          toast.success("版本状态已更新", {
            description: `${strategyId}@${version} → ${nextStatus}`,
          });
          setNextStatus("");
          onRefetchVersions();
        },
        onError: e => toast.error("状态更新失败", { description: e.message }),
      }
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- 1. 版本历史（后端真实数据） ---- */}
      <SectionCard
        title="版本历史"
        icon={History}
        description="来自后端 `listVersions` 的真实记录；「父版本」是版本演进链，不是外键。"
        right={
          <Button
            size="sm"
            variant="ghost"
            onClick={onRefetchVersions}
            disabled={versionsLoading}
          >
            {versionsLoading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            刷新
          </Button>
        }
      >
        {versionsLoading && versions === null ? (
          <Skeleton className="h-16 w-full" />
        ) : versions === null || versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无版本。</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-3 py-2">版本</TableHead>
                  <TableHead className="px-3 py-2">状态</TableHead>
                  <TableHead className="px-3 py-2">父版本</TableHead>
                  <TableHead className="px-3 py-2">数据集</TableHead>
                  <TableHead className="px-3 py-2">指纹</TableHead>
                  <TableHead className="px-3 py-2">创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map(v => {
                  const isCurrent = v.version === version;
                  return (
                    <TableRow
                      key={v.version}
                      className={isCurrent ? "bg-orange-50/60" : undefined}
                    >
                      <TableCell className="px-3 py-2 font-mono">
                        {v.version}
                        {isCurrent && (
                          <span className="ml-2 text-[10px] text-orange-700">
                            当前载入
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <StatusBadge status={v.status} />
                      </TableCell>
                      <TableCell className="px-3 py-2 font-mono text-muted-foreground">
                        {v.parentVersionId === null ? "—" : `#${v.parentVersionId}`}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <span className="font-mono">{v.datasetVersion || "—"}</span>
                        {v.datasetVersionId !== null && (
                          <span className="ml-1 text-muted-foreground">
                            （id={v.datasetVersionId}）
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className="px-3 py-2 font-mono text-muted-foreground"
                        title={v.fingerprint}
                      >
                        {shortHash(v.fingerprint)}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-muted-foreground">
                        {formatDateTime(v.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* ---- 2. 草稿 ↔ 已保存版本 差异 ---- */}
      <SectionCard
        title="这次改了什么"
        icon={GitCompareArrows}
        description="拿「当前编辑器里的草稿」与「已落库的这一版」逐字段比对——不需要手写 JSON。"
        right={
          <Button
            size="sm"
            onClick={runCompare}
            disabled={savedDocument === null || compare.isPending}
          >
            {compare.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            比较
          </Button>
        }
      >
        {savedDocument === null ? (
          <p className="text-[11px] text-muted-foreground">
            没有落库对照物 —— 先「保存」，或在版本历史里「载入」一个版本。
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            左：已落库 <code className="font-mono">{strategyId}@{version}</code>；右：当前草稿（忽略 version / fingerprint）。
          </p>
        )}

        {cmpError && (
          <p className="mt-2 font-mono text-xs text-red-600">{cmpError}</p>
        )}
        {compare.error && (
          <p className="mt-2 font-mono text-xs text-red-600">
            {compare.error.message}
          </p>
        )}

        {diff && (
          <div className="mt-3 space-y-2">
            {diff.equal ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                与已落库版本一致（忽略 version / fingerprint），无未保存改动。
              </div>
            ) : (
              <>
                <StatusBadge
                  status="INCONCLUSIVE"
                  label={`${diff.differences.length} 处差异`}
                />
                <div className="overflow-x-auto rounded-md border">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-56 px-3 py-2">路径</TableHead>
                        <TableHead className="w-24 px-3 py-2">类型</TableHead>
                        <TableHead className="px-3 py-2">已保存 → 草稿</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {diff.differences.map((d, i) => (
                        <TableRow key={`${d.path}-${i}`}>
                          <TableCell className="px-3 py-2 font-mono text-[11px]">
                            {d.path}
                          </TableCell>
                          <TableCell className="px-3 py-2">{d.kind}</TableCell>
                          <TableCell className="px-3 py-2 font-mono text-[11px]">
                            <span className="text-muted-foreground">
                              {d.left === undefined ? "∅" : JSON.stringify(d.left)}
                            </span>
                            <span className="mx-1 text-muted-foreground">→</span>
                            <span className="text-foreground">
                              {d.right === undefined
                                ? "∅"
                                : JSON.stringify(d.right)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}
      </SectionCard>

      {/* ---- 3. 版本状态推进（真实写库） ---- */}
      <SectionCard
        title="版本状态"
        icon={Tag}
        description="只改 status 一列；策略内容不可变。"
        right={
          currentStatus !== null ? <StatusBadge status={currentStatus} /> : undefined
        }
      >
        {currentStatus === null ? (
          <p className="text-xs text-muted-foreground">取不到该版本状态。</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {STATUS_HINT[currentStatus] ?? "（该状态暂无说明）"}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="ver-status">迁移至</Label>
                <Select
                  value={nextStatus === "" ? undefined : nextStatus}
                  onValueChange={v =>
                    setNextStatus(v as StrategyLifecycleStatusValue)
                  }
                >
                  <SelectTrigger id="ver-status" className="w-56 text-sm">
                    <SelectValue placeholder="选择目标状态" />
                  </SelectTrigger>
                  <SelectContent>
                    {STRATEGY_VERSION_STATUS_OPTIONS.map(s => (
                      <SelectItem key={s} value={s}>
                        {s}
                        {s === currentStatus ? "（当前）" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                onClick={applyStatus}
                disabled={nextStatus === "" || setStatus.isPending}
              >
                {setStatus.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                应用
              </Button>
            </div>
            {nextStatus !== "" && (
              <p className="text-[11px] text-muted-foreground">
                目标语义：{STATUS_HINT[nextStatus] ?? "（暂无说明）"}
              </p>
            )}
            {setStatus.error && (
              <p className="font-mono text-xs text-red-600">
                {setStatus.error.message}
              </p>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              ⚠️ 真实写库：即刻改变该版本的生命周期状态，不改策略内容、不新建版本。
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
