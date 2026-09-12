/**
 * StrategyBasicInfo — 策略基础信息（任务 §3.2）。
 *
 * 展示：策略名称 / 策略 ID / 版本 / 数据集 / 股票池（Universe）/ 策略描述。
 * 直接编辑 StrategyViewModel 的身份字段，序列化仍走 adapter（无损往返）。
 *
 * 🔴 STEP STRATEGY-004 — Dataset 绑定数据源统一（任务 §2.1 E / §11）：
 * - **唯一来源 = Dataset Registry**（`datasetRegistry.listDefinitions` / `getDefinition` /
 *   `getVersion`）。**不再**读取旧 `researchDataset.list`（旧 `research_datasets` 表与
 *   Dataset Registry 不是同一套坐标），因此本选择器与 Research 的
 *   `CreateExperimentDialog` 完全同源；
 * - 只允许选择 **READY** 版本（判定复用 `isUsableVersionStatus`，与 Research 同一处口径）；
 * - 选择结果写入 **`datasetVersionId = dataset_version.id`（权威坐标）** +
 *   `datasetVersion = 版本 label`（显示 / 快照）；`universeId` 按派生规则同步；
 * - 非 READY 版本**显示但禁用**（写明当前状态），而不是藏起来让人困惑，也不是放过去让人白跑一次。
 */

import { useEffect, useState } from "react";
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
import { formatCount } from "@/adapters/researchEngineAdapter";
import { isUsableVersionStatus } from "@/components/research/createExperimentForm";
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
  const set = (patch: Partial<StrategyViewModel>) => onChange({ ...vm, ...patch });

  // -- Dataset Registry：定义清单（与 Research 新建实验完全同源）--
  const definitions = trpc.datasetRegistry.listDefinitions.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // 用户显式选择的定义；未选时由「当前坐标所属定义」或「唯一定义」兜底。
  const [pickedDefinitionId, setPickedDefinitionId] = useState<number | null>(null);

  // 由已保存的权威坐标反查其所属 Dataset 定义（用于重新打开时正确回显）。
  const currentVersion = trpc.datasetRegistry.getVersion.useQuery(
    { datasetVersionId: vm.datasetVersionId ?? 0 },
    { enabled: vm.datasetVersionId !== null && vm.datasetVersionId > 0, refetchOnWindowFocus: false },
  );

  const definitionId =
    pickedDefinitionId
    ?? currentVersion.data?.datasetId
    ?? (definitions.data?.length === 1 ? definitions.data[0]!.id : null);

  const detail = trpc.datasetRegistry.getDefinition.useQuery(
    { definitionId: definitionId ?? 0 },
    { enabled: definitionId !== null && definitionId > 0, refetchOnWindowFocus: false },
  );

  const versions = detail.data?.versions ?? [];
  const selectedVersion = versions.find((v) => v.id === vm.datasetVersionId);

  // 已保存坐标不属于任何可见版本（例如版本被删除 / 尚未加载完）时，仍把当前引用显示出来。
  const orphanCoordinate =
    vm.datasetVersionId !== null && !detail.isLoading && versions.length > 0 && selectedVersion === undefined;

  // 切换到另一个 Dataset 定义：清掉旧的坐标（否则会把上一个数据集的版本带过去）。
  useEffect(() => {
    if (pickedDefinitionId === null) return;
    if (vm.datasetVersionId === null) return;
    if (currentVersion.isLoading || currentVersion.data === undefined) return;
    if (pickedDefinitionId !== currentVersion.data.datasetId) {
      set({ datasetVersionId: null, datasetVersion: "" });
    }
    // 只在「用户主动换数据集」时触发；依赖项刻意收窄避免与坐标同步互相打架。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedDefinitionId]);

  const refreshing = definitions.isFetching || detail.isFetching || currentVersion.isFetching;

  function refreshAll() {
    void definitions.refetch();
    void detail.refetch();
    void currentVersion.refetch();
  }

  /** 选择 Dataset Version：同步权威坐标 + label + 派生 universeId + 人类可读说明。 */
  function selectVersion(versionId: number) {
    const entry = versions.find((v) => v.id === versionId);
    if (entry === undefined) return;
    if (!isUsableVersionStatus(entry.status)) return;
    set({
      datasetVersionId: entry.id,
      datasetVersion: entry.version,
      universeId: derivedUniverseId(entry.version),
      universeDescription:
        `${detail.data?.name ?? ""}（${detail.data?.datasetCode ?? ""} · ${entry.version} · ` +
        `${entry.startDate ?? "—"} ~ ${entry.endDate ?? "—"}，${formatCount(entry.totalEvents)} 事件）`,
    });
  }

  return (
    <SectionCard
      title="基础信息"
      icon={FileText}
      description="策略身份与数据绑定（§16 identity；Dataset 坐标来自 Dataset Registry）"
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
            <Label htmlFor="s-ds-def">数据集（Dataset Registry）</Label>
            <button
              type="button"
              onClick={refreshAll}
              disabled={refreshing}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {refreshing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              刷新
            </button>
          </div>
          <Select
            value={definitionId === null ? "none" : String(definitionId)}
            onValueChange={v => v !== "none" && setPickedDefinitionId(Number(v))}
          >
            <SelectTrigger
              id="s-ds-def"
              className="w-full text-xs"
              disabled={definitions.isLoading}
            >
              <SelectValue
                placeholder={definitions.isLoading ? "加载中…" : "选择数据集"}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" disabled>
                未选择数据集
              </SelectItem>
              {definitions.data && definitions.data.length === 0 && (
                <SelectItem value="empty" disabled>
                  暂无数据集定义
                </SelectItem>
              )}
              {definitions.data?.map(d => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {d.name}（{d.datasetCode}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="s-ds-ver">Dataset 版本（仅 READY 可用于绑定）</Label>
          <Select
            value={vm.datasetVersionId === null ? "none" : String(vm.datasetVersionId)}
            onValueChange={v => v !== "none" && selectVersion(Number(v))}
          >
            <SelectTrigger
              id="s-ds-ver"
              className="w-full text-xs"
              disabled={definitionId === null || detail.isLoading}
            >
              <SelectValue
                placeholder={
                  definitionId === null
                    ? "请先选择数据集"
                    : detail.isLoading
                      ? "加载版本…"
                      : versions.length === 0
                        ? "该数据集暂无版本"
                        : "选择版本"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" disabled>
                未选择数据集版本
              </SelectItem>
              {orphanCoordinate && (
                <SelectItem value={String(vm.datasetVersionId)} disabled>
                  {vm.datasetVersion}（当前引用 · 已不在该数据集版本清单中）
                </SelectItem>
              )}
              {versions.map(v => {
                const usable = isUsableVersionStatus(v.status);
                return (
                  <SelectItem key={v.id} value={String(v.id)} disabled={!usable}>
                    <span className="flex items-center gap-2 font-mono">
                      <span>{v.version}</span>
                      <span className="text-[11px] font-sans text-muted-foreground">
                        {v.startDate ?? "—"} ~ {v.endDate ?? "—"} · {formatCount(v.totalEvents)} 事件
                      </span>
                      <StatusBadge status={v.status} className="text-[10px]" />
                      {!usable && <span className="text-[11px] font-sans">（不可用于策略绑定）</span>}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {selectedVersion && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <StatusBadge status={selectedVersion.status} className="text-[10px]" />
              <span className="font-mono">
                datasetVersionId={selectedVersion.id}
              </span>
              <span>
                {detail.data?.datasetCode} · {selectedVersion.version} ·{" "}
                {selectedVersion.startDate ?? "—"} ~ {selectedVersion.endDate ?? "—"} ·{" "}
                {formatCount(selectedVersion.totalEvents)} 事件
              </span>
            </div>
          )}

          {definitionId !== null && !detail.isLoading && versions.length > 0
            && !versions.some(v => isUsableVersionStatus(v.status)) && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                该数据集下没有 READY 状态的版本，无法绑定。请到「数据集构建」完成构建后再试。
              </p>
            )}

          <p className="text-[11px] text-muted-foreground">
            绑定保存的是 <code className="font-mono">datasetVersionId（dataset_version.id）</code>
            ；<code className="font-mono">datasetVersion</code> 只是显示 / 快照 label。
            保存时后端会查 Dataset Registry 校验「存在 且 READY 且属于该数据集」，不通过即拒绝保存。
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
            ，选择数据集版本时自动同步；静态白名单可用显式 members（暂不在本页编辑）。
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
