/**
 * StrategyBasicInfo — 策略基础信息（任务 §3.2）。
 *
 * 展示：策略名称 / Strategy ID / Version / Description / Universe / Dataset。
 * 直接编辑 StrategyViewModel 的身份字段，序列化仍走 adapter（无损往返）。
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/common";
import { FileText } from "lucide-react";
import type { StrategyViewModel } from "@/adapters/strategyAdapter";

export function StrategyBasicInfo({
  vm,
  onChange,
}: {
  vm: StrategyViewModel;
  onChange: (next: StrategyViewModel) => void;
}) {
  const set = (patch: Partial<StrategyViewModel>) =>
    onChange({ ...vm, ...patch });

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
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-id">Strategy ID</Label>
          <Input
            id="s-id"
            value={vm.strategyId}
            onChange={e => set({ strategyId: e.target.value })}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-ver">Version（semver）</Label>
          <Input
            id="s-ver"
            value={vm.version}
            onChange={e => set({ version: e.target.value })}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-ds">数据集版本（datasetVersion）</Label>
          <Input
            id="s-ds"
            value={vm.datasetVersion}
            onChange={e => set({ datasetVersion: e.target.value })}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="s-desc">Description</Label>
          <Textarea
            id="s-desc"
            value={vm.description}
            onChange={e => set({ description: e.target.value })}
            rows={2}
            placeholder="策略的人类可读描述"
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="s-uni">Universe</Label>
          <Input
            id="s-uni"
            value={vm.universeId}
            onChange={e => set({ universeId: e.target.value })}
            className="font-mono"
            placeholder="research-dataset:<datasetVersion>"
          />
          <p className="text-[11px] text-muted-foreground">
            派生 universe 须等于{" "}
            <code className="font-mono">
              research-dataset:&lt;datasetVersion&gt;
            </code>
            ； 静态白名单可用显式 members（暂不在本页编辑）。
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
