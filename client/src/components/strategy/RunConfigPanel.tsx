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
 *
 * 🔴 2026-09-13：原「加载真实数据」「声明数据链已就绪」两个用户开关已**移除**，
 * 恒为真（点运行 = 跑真数据）。理由见下方 `RealDataBlock` 注释。
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SectionCard, StatusBadge } from "@/components/common";import {
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
import { Database, Loader2, Play, ShieldCheck, TriangleAlert } from "lucide-react";
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
  /** 显式执行配方 id（策略文档无 recipe 时生效；空串 = 用服务端默认常量）。 */
  recipeId: string;
}

/**
 * 时间范围默认值（🔴 2026-09-13 修复「点了运行没反应」的直接成因）。
 *
 * 背景：`loopRun` 的 `dateRange.startDate` / `endDate` 在契约里是 **`.min(1)` 必填**
 * （`shared/researchContracts.ts` 的 `closedLoopDateRangeSchema`），而后端还要求实验窗口
 * **⊆ 数据集窗口**（越界直接抛「超出数据集窗口」）。原先两格默认 `""` ⇒ 用户点「运行策略」
 * 会**立刻**收到 400 校验错误，看起来就像「按钮点了没反应」。
 *
 * 这里给一个**确定落在数据集窗口内的安全默认子窗**（数据集 390002 窗口 =
 * `2024-09-01 → 2026-09-01`）。用户仍可自由改；这只是把「必填」预置成合法值，
 * **不改变任何服务端判定**，也不冒充「已在全窗口验证过」。
 */
const DEFAULT_RUN_WINDOW = {
  startDate: "2025-01-02",
  endDate: "2025-03-31",
} as const;

function initRunConfig(vm: StrategyViewModel): RunConfigViewModel {
  return {
    startDate: DEFAULT_RUN_WINDOW.startDate,
    endDate: DEFAULT_RUN_WINDOW.endDate,
    initialCapital: vm.initialCapital,
    commissionRate: vm.costModel.commissionRate,
    slippageBps: vm.costModel.slippageBps,
    maxPositions: vm.positionSizing.maxPositions,
    executionModel: vm.executionModel,
    recipeId: "",
  };
}

/**
 * 发起前的**本地前置检查**（不替代服务端校验，只把「必然被拒」的输入挡在发请求之前，
 * 并给出人话原因）。返回 `null` = 通过。
 */
function precheckRunConfig(
  config: RunConfigViewModel,
  vm: StrategyViewModel
): string | null {
  if (config.startDate.trim() === "" || config.endDate.trim() === "") {
    return "时间范围必填。";
  }
  if (config.startDate > config.endDate) {
    return `时间范围倒序：起始 ${config.startDate} 晚于结束 ${config.endDate}。`;
  }
  if (vm.strategyId.trim() === "" || vm.version.trim() === "") {
    return "策略尚未落库（缺 strategyId / version），先「保存」再运行。";
  }
  if (vm.datasetVersionId === null) {
    return "未绑定数据集版本 —— 先在「策略定义 → 基础信息」里选一个 READY 版本。";
  }
  return null;
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
          就绪，可运行。
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

  // 本地前置检查：只挡「必然被服务端拒绝」的输入，并把原因说人话。
  // 注意：**不**据此禁用按钮 —— 按钮可用性仍由「是否接线」决定（见下）。
  const [precheckError, setPrecheckError] = useState<string | null>(null);

  // 按钮可用性由「是否接线」决定，而非「整条 14 阶段链是否就绪」：
  // 运行请求会真实执行入参齐备的阶段，并把不可执行阶段如实 BLOCKED（诊断价值），
  // 因此不因 executorBound=false 就把入口锁死（那会让工作台永远是空壳）。
  const wired = typeof onRun === "function";
  const canRun = wired && !running;
  const reasonHint =
    readiness && readiness.reasons.length > 0 ? readiness.reasons[0] : null;
  const tooltip = !wired
    ? "运行入口未接线"
    : running
      ? "正在运行…"
      : reasonHint
        ? `入参齐备的阶段真跑，其余如实标为 BLOCKED。首因：${reasonHint}`
        : "运行闭环（读取真实数据）";

  const handleClick = () => {
    const blocked = precheckRunConfig(config, vm);
    setPrecheckError(blocked);
    if (blocked !== null) return;
    onRun?.(config);
  };

  return (
    <SectionCard
      title="回测配置"
      right={
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                size="sm"
                disabled={!canRun}
                onClick={handleClick}
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
          <p className="text-xs text-muted-foreground">探测就绪状态…</p>
        )}
        {!readinessLoading && readiness && (
          <ReadinessBlock readiness={readiness} />
        )}
        {runError && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 font-mono text-[11px] text-red-700">
            运行失败：{runError}
          </p>
        )}
        {precheckError && (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{precheckError}</span>
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
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1 flex flex-col justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                set({
                  startDate: DEFAULT_RUN_WINDOW.startDate,
                  endDate: DEFAULT_RUN_WINDOW.endDate,
                })
              }
            >
              重置为默认窗口
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              两格必填，且须落在 <code className="font-mono">2024-09-01 ~ 2026-09-01</code> 内。
            </p>
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

        <RealDataBlock vm={vm} config={config} set={set} />
      </div>
    </SectionCard>
  );
}

/**
 * 「本次运行会跑什么」态势区（🔴 2026-09-13：原「加载真实数据 / 声明数据链已就绪」
 * 两个用户开关已**移除**）。
 *
 * 移除理由（用户侧原话：「什么乱七八糟的选项」）：这两个开关的「关闭态」产出的
 * 是一份**没有任何诊断价值**的结果 ——
 *   ① 关掉「加载真实数据」⇒ 服务端拿不到数据集 ⇒ `data` 阶段 `CL_DATA_NOT_INJECTED`
 *      ⇒ 其后 13 阶段全部 `CL_UPSTREAM_BLOCKED`，用户看到「14 阶段无一执行」；
 *   ② 关掉「声明数据链已就绪」⇒ 数据集 gate 被**人为**压成 `INCONCLUSIVE`
 *      ⇒ 真实可用的数据集也跑不动。
 * 两者都不是用户能/应该做的决策，且第 ② 个的名字与实现不符（它实际只是「是否读取
 * 库内 `dataset_version.status`」，不是任何「声明」）。⇒ 改为恒真，并把事实**展示**出来。
 */
function RealDataBlock({
  vm,
  config,
  set,
}: {
  vm: StrategyViewModel;
  config: RunConfigViewModel;
  set: (patch: Partial<RunConfigViewModel>) => void;
}) {
  const bound =
    vm.datasetVersionId === null
      ? "未绑定数据集（运行会被前置检查拦下）"
      : `已绑定 datasetVersionId=${vm.datasetVersionId}`;
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-3">
      <div className="space-y-1">
        <Label className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5" />
          本次运行使用真实数据
        </Label>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          按时间范围读取该策略绑定的数据集（{bound}）与已落库策略文档，再按配方装配入参；
          未装配执行器的阶段会如实标为 BLOCKED —— 是实现边界，不是本次运行的错误。
        </p>
      </div>

      <details className="mt-2.5 border-t pt-2.5">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">
          高级：指定执行配方 id（可留空）
        </summary>
        <div className="mt-2 space-y-1.5">
          <Input
            id="run-recipe"
            placeholder="留空 = 使用服务端已注册的默认配方"
            value={config.recipeId}
            onChange={e => set({ recipeId: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">
            文档里有 <code className="font-mono">recipe</code> 时以文档为准；实际用了哪个会显示在结果里。
          </p>
        </div>
      </details>
    </div>
  );
}
