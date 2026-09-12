/**
 * RunConfigPanel — 回测运行配置（任务 §4，Run Workbench）。
 *
 * 提供：时间范围 / 初始资金 / 手续费 / 滑点 / 最大持仓 / 运行模式。
 *
 * FE-0 扩展接入：顶部「运行就绪探测」条由后端 `researchRun.readiness` 只读端点驱动
 * （认证 gate + 策略注册 + 装配覆盖率），未就绪原因原样展示。
 *
 * FE-4 扩展接入：`onRun` 注入后「运行策略」按钮可用，点击真实调用
 * `researchRun.loopRun`（封闭循环编排器）。按钮**不因 executorBound=false 锁死**——
 * 运行请求会真跑入参齐备的阶段、如实 BLOCKED 其余阶段，这是有诊断价值的真实执行；
 * 未就绪原因只在 Tooltip 里提示，不阻断发起。
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
import { Loader2, Play, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { StrategyViewModel } from "@/adapters/strategyAdapter";
import { EXECUTION_MODEL_LABELS } from "@/adapters/strategyAdapter";
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
  onRun,
  running = false,
  runError = null,
}: {
  vm: StrategyViewModel;
  readiness?: RunReadinessOutput | null;
  readinessLoading?: boolean;
  /** 发起闭环运行（FE-4）。缺省 → 按钮禁用（未接线场景）。 */
  onRun?: (config: RunConfigViewModel) => void;
  running?: boolean;
  runError?: string | null;
}) {
  const [config, setConfig] = useState<RunConfigViewModel>(() =>
    initRunConfig(vm)
  );
  const set = (patch: Partial<RunConfigViewModel>) =>
    setConfig(c => ({ ...c, ...patch }));

  // 按钮可用性由「是否接线」决定，而非「整条 14 阶段链是否就绪」：
  // 运行请求会真实执行入参齐备的阶段，并把不可执行阶段如实 BLOCKED（诊断价值），
  // 因此不因 executorBound=false 就把入口锁死（那会让工作台永远是空壳）。
  const wired = typeof onRun === "function";
  const canRun = wired && !running;
  const reasonHint =
    readiness && readiness.reasons.length > 0 ? readiness.reasons[0] : null;
  const tooltip = !wired
    ? "运行端点未接线（本页未注入 onRun）"
    : running
      ? "正在执行闭环运行…"
      : reasonHint
        ? `点击执行：入参齐备的阶段会真实运行；不可执行阶段将如实 BLOCKED。当前首因：${reasonHint}`
        : "点击执行闭环运行（真实调用封闭循环编排器）";

  return (
    <SectionCard
      title="回测配置"
      description="策略 → 数据集 → 回测配置 → 运行 → 结果"
      right={
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                size="sm"
                disabled={!canRun}
                onClick={() => onRun?.(config)}
              >
                {running ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                )}
                {running ? "运行中…" : "运行策略"}
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
        {runError && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 font-mono text-[11px] text-red-700">
            运行失败：{runError}
          </p>
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
                    {EXECUTION_MODEL_LABELS[m] ?? m}（{m}）
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
