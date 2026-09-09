/**
 * RunConfigPanel — 回测运行配置（任务 §4，Run Workbench）。
 *
 * 提供：时间范围 / 初始资金 / 手续费 / 滑点 / 最大持仓 / 运行模式。
 *
 * FE-0 扩展接入（本轮）：顶部「运行就绪探测」条由后端 `researchRun.readiness`
 * 只读端点驱动（数据认证 gate + 策略注册 + 执行器绑定），未就绪原因原样展示；
 * 「运行策略」按钮 enabled = readiness.canRun（当前数据域认证未完成 → 恒 false，
 * 不伪造「已运行」；数据 + 执行链就绪后按钮自动可用，前端无需改动）。
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SectionCard, StatusBadge } from "@/components/common";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Play, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { StrategyViewModel } from "@/adapters/strategyAdapter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

export type RunReadinessOutput =
  inferRouterOutputs<AppRouter>["researchRun"]["readiness"];

const EXECUTION_MODELS = [
  "NEXT_OPEN",
  "NEXT_CLOSE",
  "VWAP_PROXY",
  "LIMIT_PRICE",
] as const;

export interface RunConfigViewModel {
  startDate: string;
  endDate: string;
  initialCapital: number;
  commissionRate: number;
  slippageBps: number;
  maxPositions: number;
  executionModel: string;
}

function initRunConfig(vm: StrategyViewModel): RunConfigViewModel {
  return {
    startDate: "",
    endDate: "",
    initialCapital: vm.initialCapital,
    commissionRate: vm.costModel.commissionRate,
    slippageBps: vm.costModel.slippageBps,
    maxPositions: vm.positionSizing.maxPositions,
    executionModel: vm.executionModel,
  };
}

/** verdict → 统一状态色语义（不扩展 status 词表；UI 层映射）。 */
function verdictStatus(verdict: string): string {
  if (verdict === "READY_TO_RUN") return "SUCCESS";
  if (verdict === "EXECUTOR_NOT_BOUND") return "INFO";
  // EVIDENCE_MISSING / DATASET_NOT_READY / STRATEGIES_MISSING → 黄
  return "INCONCLUSIVE";
}

function ReadinessBlock({ readiness }: { readiness: RunReadinessOutput }) {
  const gate = readiness.datasetGate;
  const pendingNote =
    gate && gate.pendingChecks.length > 0
      ? `未认证域：${gate.pendingChecks.join("、")}`
      : null;
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-foreground">运行就绪探测</span>
        <StatusBadge
          status={verdictStatus(readiness.verdict)}
          label={readiness.verdict}
        />
        {readiness.executorBound ? (
          <StatusBadge status="SUCCESS" label="EXECUTOR_BOUND" />
        ) : (
          <StatusBadge status="INFO" label="EXECUTOR_NOT_BOUND" />
        )}
        <span className="text-muted-foreground">
          已注册策略 {readiness.strategies.length} 项
        </span>
      </div>
      {readiness.canRun ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-700">
          <ShieldCheck className="h-3.5 w-3.5" />
          数据域已认证、策略已注册、执行器已绑定 —— 可发起研究 run。
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {readiness.reasons.map((reason, i) => (
            <li
              key={i}
              className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"
            >
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
              <span>{reason}</span>
            </li>
          ))}
          {gate && !gate.evidenceAvailable && gate.evidenceError && (
            <li className="font-mono text-[10px] text-red-600">
              证据错误：{gate.evidenceError}
            </li>
          )}
          {pendingNote && (
            <li className="text-[11px] text-amber-700">{pendingNote}</li>
          )}
        </ul>
      )}
    </div>
  );
}

export function RunConfigPanel({
  vm,
  readiness,
  readinessLoading,
}: {
  vm: StrategyViewModel;
  readiness?: RunReadinessOutput | null;
  readinessLoading?: boolean;
}) {
  const [config, setConfig] = useState<RunConfigViewModel>(() =>
    initRunConfig(vm)
  );
  const set = (patch: Partial<RunConfigViewModel>) =>
    setConfig(c => ({ ...c, ...patch }));

  const canRun = readiness?.canRun === true;
  const tooltip = canRun
    ? "执行端点将在数据 + 执行链就绪后启用（当前为就绪探测接入）"
    : readiness && readiness.reasons.length > 0
      ? readiness.reasons[0]
      : readinessLoading
        ? "正在探测运行就绪状态…"
        : "运行就绪探测暂不可用";

  return (
    <SectionCard
      title="回测配置"
      description="Strategy → Dataset → Backtest Configuration → Run → Result"
      right={
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="sm" disabled={!canRun}>
                <Play className="mr-1.5 h-3.5 w-3.5" /> 运行策略
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      }
    >
      <div className="space-y-4">
        {readinessLoading && (
          <p className="text-xs text-muted-foreground">正在探测运行就绪状态…</p>
        )}
        {!readinessLoading && readiness && (
          <ReadinessBlock readiness={readiness} />
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="run-start">时间范围（起始）</Label>
            <Input
              id="run-start"
              type="date"
              value={config.startDate}
              onChange={e => set({ startDate: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="run-end">时间范围（结束）</Label>
            <Input
              id="run-end"
              type="date"
              value={config.endDate}
              onChange={e => set({ endDate: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="run-capital">初始资金</Label>
            <Input
              id="run-capital"
              type="number"
              min={0}
              value={config.initialCapital}
              onChange={e =>
                set({ initialCapital: Number(e.target.value) || 0 })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="run-comm">手续费（费率）</Label>
            <Input
              id="run-comm"
              type="number"
              step={0.0001}
              min={0}
              value={config.commissionRate}
              onChange={e =>
                set({ commissionRate: Number(e.target.value) || 0 })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="run-slip">滑点（bps）</Label>
            <Input
              id="run-slip"
              type="number"
              min={0}
              value={config.slippageBps}
              onChange={e => set({ slippageBps: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="run-maxpos">最大持仓</Label>
            <Input
              id="run-maxpos"
              type="number"
              min={1}
              value={config.maxPositions}
              onChange={e =>
                set({ maxPositions: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label>运行模式</Label>
            <Select
              value={config.executionModel}
              onValueChange={v => set({ executionModel: v })}
            >
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXECUTION_MODELS.map(m => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
