/**
 * StrategyHeader — 策略头（任务 §3.1 / STEP STRATEGY-002 接通持久化）。
 *
 * 一级信息：策略名称 / ID / 版本 / 数据集 / 状态 + 右侧操作条
 * [校验] [保存] [保存新版本]。
 *
 * STEP STRATEGY-002 起，「保存 / 保存新版本」接入真实持久化链路
 * （save → DB / createVersion → DB）。
 *
 * 🔴 2026-09-13：「运行」按钮**已删除** —— 它原为 `runDisabled = true` 硬编码占位
 * （Phase 6 结构预留），而后端闭环运行端点**早已真实可用**（`server/researchRunRouter.ts#loopRun`）。
 * 唯一入口收敛到本页「运行工作台」页签内的 `RunConfigPanel`「运行策略」按钮（按「是否注入 onRun」
 * 门控，**不**按 readiness 门控）。保留一个永远点不动的同名按钮，只会让人误判「运行功能没做完」。
 */

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/common";
import { Save, Tag } from "lucide-react";
import type { StrategyViewModel } from "@/adapters/strategyAdapter";

export function StrategyHeader({
  vm,
  lifecycleStatus,
  validating,
  onValidate,
  saving,
  onSave,
  creatingVersion,
  onCreateVersion,
}: {
  vm: StrategyViewModel;
  lifecycleStatus: string;
  validating: boolean;
  onValidate: () => void;
  saving: boolean;
  onSave: () => void;
  creatingVersion: boolean;
  onCreateVersion: () => void;
}) {
  const field = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="truncate font-mono text-sm font-medium text-foreground">
        {value}
      </p>
    </div>
  );

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border bg-card p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-lg font-semibold">{vm.name}</h1>
          <StatusBadge status={lifecycleStatus} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
          {field("策略 ID", vm.strategyId)}
          {field("版本", vm.version)}
          {field("数据集", vm.datasetVersion || "—")}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onValidate}
          disabled={validating}
        >
          <Tag className="mr-1.5 h-3.5 w-3.5" /> 校验
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onSave}
          disabled={saving || creatingVersion}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" /> 保存
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCreateVersion}
          disabled={creatingVersion || saving}
        >
          <Tag className="mr-1.5 h-3.5 w-3.5" /> 保存新版本
        </Button>
      </div>
    </div>
  );
}
