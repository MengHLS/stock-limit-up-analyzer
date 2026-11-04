
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Database,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useRef, useState } from "react";
import type {
  ParameterViewModel,
  StrategyViewModel,
} from "@/adapters/strategyAdapter";
import {
  EXECUTION_MODEL_LABELS,
  parseJsonScalarArray,
} from "@/adapters/strategyAdapter";
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
  /** 覆盖策略文档的费率；null = 沿用策略文档。 */
  commissionRate: number;
  stampDutyRate: number;
  transferFeeRate: number;
  slippageBps: number;
  maxPositions: number;
  /** 单日最多新建仓数量；null = 沿用策略文档。 */
  maxDailyBuys: number | null;
  executionModel: string;
  /** 仅包含用户显式修改过的参数名 → 覆盖值。 */
  parameterOverrides: Record<string, unknown>;
  /** 显式执行配方 id（策略文档无 recipe 时生效；空串 = 用服务端默认常量）。 */
  recipeId: string;
}

export function createRunConfig(vm: StrategyViewModel): RunConfigViewModel {
  return initRunConfig(vm);
}

/**
 * 运行配置 → `runtimeConfig` 覆写（**只包含真正改动过的字段**）。
 *
 * 用途：单策略运行与多版本对比必须共用同一套「什么算覆写」的判断，否则同一份
 * 界面配置在两条入口会产出不同口径。策略文档本身永不被本函数修改。
 */
export function toRuntimeConfig(
  config: RunConfigViewModel,
  vm: StrategyViewModel
): Record<string, unknown> {
  return {
    ...(config.initialCapital !== vm.initialCapital
      ? { initialCapital: config.initialCapital }
      : {}),
    ...(config.maxPositions !== vm.positionSizing.maxPositions
      ? { maxPositions: config.maxPositions }
      : {}),
    ...(config.maxDailyBuys !== vm.maxDailyBuys
      ? { maxDailyBuys: config.maxDailyBuys }
      : {}),
    ...(config.commissionRate !== vm.costModel.commissionRate
      ? { commissionRate: config.commissionRate }
      : {}),
    ...(config.stampDutyRate !== vm.costModel.stampDutyRate
      ? { stampDutyRate: config.stampDutyRate }
      : {}),
    ...(config.transferFeeRate !== vm.costModel.transferFeeRate
      ? { transferFeeRate: config.transferFeeRate }
      : {}),
    ...(config.slippageBps !== vm.costModel.slippageBps
      ? { slippageBps: config.slippageBps }
      : {}),
    ...(config.executionModel !== vm.executionModel
      ? { executionModel: config.executionModel }
      : {}),
    ...(Object.keys(config.parameterOverrides).length > 0
      ? { parameterOverrides: config.parameterOverrides }
      : {}),
  };
}

/** 预先算好的可复用输入块（单策略 / 版本对比共用）。 */
export function RunConfigFields({
  vm,
  config,
  set,
}: {
  vm: StrategyViewModel;
  config: RunConfigViewModel;
  set: (patch: Partial<RunConfigViewModel>) => void;
}) {
  return (
    <>
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
          <Label htmlFor="run-stamp">印花税（费率）</Label>
          <Input
            id="run-stamp"
            type="number"
            step={0.0001}
            min={0}
            value={config.stampDutyRate}
            onChange={e =>
              set({ stampDutyRate: Number(e.target.value) || 0 })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="run-transfer">过户费（费率）</Label>
          <Input
            id="run-transfer"
            type="number"
            step={0.00001}
            min={0}
            value={config.transferFeeRate}
            onChange={e =>
              set({ transferFeeRate: Number(e.target.value) || 0 })
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
        <div className="space-y-1.5">
          <Label htmlFor="run-maxdaily">单日最多建仓</Label>
          <Input
            id="run-maxdaily"
            type="number"
            min={1}
            placeholder="留空 = 沿用策略文档"
            value={config.maxDailyBuys ?? ""}
            onChange={e =>
              set({
                maxDailyBuys:
                  e.target.value === ""
                    ? null
                    : Math.max(1, Number(e.target.value) || 1),
              })
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

      <ParameterOverrideBlock vm={vm} config={config} set={set} />
    </>
  );
}

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
    stampDutyRate: vm.costModel.stampDutyRate,
    transferFeeRate: vm.costModel.transferFeeRate,
    slippageBps: vm.costModel.slippageBps,
    maxPositions: vm.positionSizing.maxPositions,
    maxDailyBuys: vm.maxDailyBuys,
    executionModel: vm.executionModel,
    parameterOverrides: {},
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
  const configKey = `${vm.strategyId}@${vm.version}`;
  const previousKeyRef = useRef(configKey);
  if (previousKeyRef.current !== configKey) {
    previousKeyRef.current = configKey;
    // 切策略 / 切版本时必须重挂配置，避免上一版的覆盖值串台。
    // 这里用同步重置而不是 effect：下次渲染前 `config` 已与 `vm` 对齐。
    setConfig(initRunConfig(vm));
  }
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

        <RunConfigFields vm={vm} config={config} set={set} />
      </div>
    </SectionCard>
  );
}

/**
 * 参数覆盖编辑器。
 *
 * 交互纪律：
 *   - 初始值 = 策略文档参数 `defaultValue`（无默认值 → 空）；
 *   - 「已覆盖」由**当前值与文档默认值是否不同**唯一决定，不额外维护一份易失真的勾选状态；
 *   - 清空输入 = 还原为文档默认值（即取消覆盖），不是提交空串；
 *   - `defaultValue: null` 与「没有 defaultValue」在展示上可区分，但两者都视为「未覆盖」起点。
 */
function ParameterOverrideBlock({
  vm,
  config,
  set,
}: {
  vm: StrategyViewModel;
  config: RunConfigViewModel;
  set: (patch: Partial<RunConfigViewModel>) => void;
}) {
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  if (vm.parameters.length === 0) return null;

  const effectiveValue = (param: ParameterViewModel): unknown =>
    Object.prototype.hasOwnProperty.call(config.parameterOverrides, param.name)
      ? config.parameterOverrides[param.name]
      : param.defaultValue;

  const isOverridden = (param: ParameterViewModel): boolean =>
    Object.prototype.hasOwnProperty.call(config.parameterOverrides, param.name);

  const setOverride = (param: ParameterViewModel, raw: string) => {
    if (param.type === "json") {
      const next = { ...config.parameterOverrides };
      if (raw.trim() === "") {
        delete next[param.name];
        set({ parameterOverrides: next });
        return;
      }
      const parsed = parseJsonScalarArray(raw);
      if (param.minItems !== null && parsed.length < param.minItems) {
        throw new Error(
          `${param.name} 至少需要 ${param.minItems} 项，当前 ${parsed.length} 项。`
        );
      }
      if (param.maxItems !== null && parsed.length > param.maxItems) {
        throw new Error(
          `${param.name} 最多允许 ${param.maxItems} 项，当前 ${parsed.length} 项。`
        );
      }
      next[param.name] = parsed;
      set({ parameterOverrides: next });
      return;
    }

    const next = { ...config.parameterOverrides };
    const docDefault = param.defaultValue;
    const isDocDefault = (candidate: unknown): boolean => {
      if (!param.hasDefaultValue && docDefault === null) {
        return candidate === null;
      }
      return candidate === docDefault;
    };

    let nextValue: unknown;
    if (raw === "") {
      nextValue = null;
    } else if (param.type === "number") {
      const n = Number(raw);
      nextValue = Number.isFinite(n) ? n : raw;
    } else if (param.type === "boolean") {
      nextValue = raw === "true";
    } else {
      nextValue = raw;
    }

    if (raw === "" || isDocDefault(nextValue)) {
      delete next[param.name];
    } else {
      next[param.name] = nextValue;
    }
    set({ parameterOverrides: next });
  };

  const resetAll = () => set({ parameterOverrides: {} });
  const overriddenCount = Object.keys(config.parameterOverrides).length;

  const jsonText = (param: ParameterViewModel, value: unknown): string => {
    const draft = jsonDrafts[param.name];
    if (draft !== undefined) return draft;
    if (value === null || value === undefined) return "";
    return JSON.stringify(value, null, 2);
  };

  const handleJsonChange = (param: ParameterViewModel, raw: string) => {
    setJsonDrafts(current => ({ ...current, [param.name]: raw }));
    if (raw.trim() === "") {
      setJsonErrors(current => {
        const next = { ...current };
        delete next[param.name];
        return next;
      });
      setOverride(param, "");
      return;
    }
    try {
      setOverride(param, raw);
      setJsonErrors(current => {
        const next = { ...current };
        delete next[param.name];
        return next;
      });
    } catch (error) {
      setJsonErrors(current => ({
        ...current,
        [param.name]:
          error instanceof Error ? error.message : "JSON 参数无效。",
      }));
    }
  };

  return (
    <details className="rounded-md border bg-muted/20 px-3 py-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs font-medium">
        <span>参数覆盖</span>
        <span className="text-[11px] font-normal text-muted-foreground">
          策略文档参数 {vm.parameters.length} 项
          {overriddenCount > 0
            ? ` · 已覆盖 ${overriddenCount} 项`
            : " · 全部沿用文档默认值"}
        </span>
        {overriddenCount > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-[11px]"
            onClick={e => {
              e.preventDefault();
              resetAll();
            }}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            全部还原
          </Button>
        )}
      </summary>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vm.parameters.map(param => {
          const value = effectiveValue(param);
          const shown =
            value === null || value === undefined
              ? ""
              : param.type === "json"
                ? jsonText(param, value)
                : String(value);
          const overridden = isOverridden(param);
          return (
            <div key={param.name} className="space-y-1.5">
              <Label
                htmlFor={`run-param-${param.name}`}
                className="flex items-center gap-1.5"
              >
                <span className="font-mono">{param.name}</span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  {param.type}
                </span>
                {overridden && (
                  <span className="rounded bg-orange-100 px-1 py-0.5 text-[10px] text-orange-700">
                    已覆盖
                  </span>
                )}
              </Label>
              {param.type === "boolean" ? (
                <Select
                  value={shown === "" ? "__none__" : shown}
                  onValueChange={v =>
                    setOverride(param, v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger
                    id={`run-param-${param.name}`}
                    className="text-sm"
                  >
                    <SelectValue placeholder="沿用文档默认" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      沿用文档默认
                      {param.hasDefaultValue
                        ? `（${
                            param.defaultValue === null
                              ? "null"
                              : JSON.stringify(param.defaultValue)
                          }）`
                        : ""}
                    </SelectItem>
                    <SelectItem value="true">true</SelectItem>
                    <SelectItem value="false">false</SelectItem>
                  </SelectContent>
                </Select>
              ) : param.type === "json" ? (
                <>
                  <Textarea
                    id={`run-param-${param.name}`}
                    rows={4}
                    className="font-mono text-xs"
                    placeholder={
                      param.hasDefaultValue
                        ? `文档默认：${JSON.stringify(param.defaultValue)}`
                        : "留空 = 沿用文档默认"
                    }
                    value={shown}
                    onChange={e => handleJsonChange(param, e.target.value)}
                  />
                  {jsonErrors[param.name] !== undefined && (
                    <p className="text-[10px] text-red-600">
                      {jsonErrors[param.name]}
                    </p>
                  )}
                </>
              ) : (
                <Input
                  id={`run-param-${param.name}`}
                  type={param.type === "number" ? "number" : "text"}
                  step={param.step ?? "any"}
                  min={param.min ?? undefined}
                  max={param.max ?? undefined}
                  placeholder={
                    param.hasDefaultValue
                      ? `文档默认：${
                          param.defaultValue === null
                            ? "null"
                            : JSON.stringify(param.defaultValue)
                        }`
                      : "留空 = 沿用文档默认"
                  }
                  value={shown}
                  onChange={e => setOverride(param, e.target.value)}
                />
              )}
              {param.description !== "" && (
                <p className="text-[10px] leading-snug text-muted-foreground">
                  {param.description}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        只提交你改过的参数；未改动的参数由后端按策略文档默认值解析。
      </p>
    </details>
  );
}

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
