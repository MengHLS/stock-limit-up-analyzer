/**
 * StrategyBasicInfo — 策略基础信息（任务 §3.2）。
 *
 * 展示：策略名称 / 策略 ID / 版本 / 数据集 / 股票池（Universe）/ 策略描述。
 * 直接编辑 StrategyViewModel 的身份字段，序列化仍走 adapter（无损往返）。
 *
 * 数据集（§16 dataset 绑定）：
 * - 从「数据集构建」页（researchDataset.list）下拉选择已构建的数据集版本；
 * - 选中后自动同步 universeId = research-dataset:<datasetVersion>（派生一致性，后端校验）。
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard, StatusBadge } from "@/components/common";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { StrategyViewModel } from "@/adapters/strategyAdapter";

/** 派生 universe 标识（= deriveDatasetUniverseId(datasetVersion)）。 */
function derivedUniverseId(datasetVersion: string): string {
  return `research-dataset:${datasetVersion}`;
}

export function StrategyBasicInfo({
  vm,
  onChange,
}: {
  vm: StrategyViewModel;
  onChange: (next: StrategyViewModel) => void;
}) {
  const set = (patch: Partial<StrategyViewModel>) =>
    onChange({ ...vm, ...patch });

  const datasets = trpc.researchDataset.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const selected = datasets.data?.find(
    d => d.datasetVersion === vm.datasetVersion
  );

  /** 选择数据集：同步 datasetVersion + 派生 universeId + 人类可读说明。 */
  function selectDataset(datasetVersion: string) {
    if (!datasetVersion) return;
    const entry = datasets.data?.find(d => d.datasetVersion === datasetVersion);
    set({
      datasetVersion,
      universeId: derivedUniverseId(datasetVersion),
      universeDescription: entry
        ? `${entry.name}（${entry.startDate} ~ ${entry.endDate}，${entry.rowCount} 行）`
        : vm.universeDescription,
    });
  }

  return (
    <SectionCard
      title="基础信息"
      icon={FileText}
      description="策略身份与数据绑定（§16 identity）"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="s-name">策略名称</Label>
          <Input
            id="s-name"
            value={vm.name}
            onChange={e => set({ name: e.target.value })}
            placeholder="如 涨停候选基线"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-id">策略 ID</Label>
          <Input
            id="s-id"
            value={vm.strategyId}
            onChange={e => set({ strategyId: e.target.value })}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-ver">版本（语义化版本号）</Label>
          <Input
            id="s-ver"
            value={vm.version}
            onChange={e => set({ version: e.target.value })}
            className="font-mono"
            placeholder="1.0.0"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="s-ds">数据集（来自「数据集构建」）</Label>
            <button
              type="button"
              onClick={() => datasets.refetch()}
              disabled={datasets.isFetching}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {datasets.isFetching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              刷新
            </button>
          </div>
          <Select
            value={vm.datasetVersion || "none"}
            onValueChange={v => v !== "none" && selectDataset(v)}
          >
            <SelectTrigger
              id="s-ds"
              className="w-full font-mono text-xs"
              disabled={datasets.isLoading}
            >
              <SelectValue placeholder="选择已构建的数据集…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" disabled>
                未选择数据集
              </SelectItem>
              {datasets.data && datasets.data.length === 0 && (
                <SelectItem value="empty" disabled>
                  暂无已构建数据集
                </SelectItem>
              )}
              {vm.datasetVersion &&
                !datasets.data?.some(
                  d => d.datasetVersion === vm.datasetVersion
                ) && (
                  <SelectItem value={vm.datasetVersion}>
                    {vm.datasetVersion}（当前引用）
                  </SelectItem>
                )}
              {datasets.data?.map(d => (
                <SelectItem key={d.datasetId} value={d.datasetVersion}>
                  {d.name} · {d.datasetVersion}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <StatusBadge status={selected.gate} className="text-[10px]" />
              <span>
                {selected.startDate} ~ {selected.endDate} · {selected.rowCount}{" "}
                行
              </span>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            数据集为空时，请先到「数据集构建」页构建并认证一个数据集，再回到本页选择。
          </p>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="s-uni">股票池（Universe，由数据集派生）</Label>
          <Input
            id="s-uni"
            value={vm.universeId}
            onChange={e => set({ universeId: e.target.value })}
            className="font-mono"
            placeholder="research-dataset:<datasetVersion>"
          />
          <p className="text-[11px] text-muted-foreground">
            派生股票池须等于{" "}
            <code className="font-mono">research-dataset:&lt;datasetVersion&gt;</code>
            ，选择数据集时自动同步；静态白名单可用显式 members（暂不在本页编辑）。
          </p>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="s-desc">策略描述</Label>
          <Textarea
            id="s-desc"
            value={vm.description}
            onChange={e => set({ description: e.target.value })}
            rows={2}
            placeholder="策略的人类可读描述"
          />
        </div>
      </div>
    </SectionCard>
  );
}
