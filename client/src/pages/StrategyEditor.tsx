/**
 * FE-4 — 策略编辑器 + 运行工作台（STEP 13/15/16 · 策略 Schema + 版本化 + 生命周期）。
 *
 * 双模式改造（任务 §3）：
 * - 顶部 [可视化编辑] / [JSON 高级模式]，默认可视化；
 * - 可视化编辑通过 adapter（`@/adapters/strategyAdapter`）无损往返 StrategyDocument；
 * - JSON 高级模式保留原透传 + 校验能力，服务开发者 / Debug / Audit。
 *
 * 纪律（不变）：
 * - **不重算任何量化判定**：validate / bump / compare / lifecycle 全部来自后端纯函数端点，
 *   页面只做只读展示与结构化编辑，不复制 schema、不重算 fingerprint / chain hash；
 * - **后端为权威**：编辑结果经 `viewModelToStrategy` 序列化后交后端校验；
 * - **不伪造**：「保存 / 保存新版本 / 运行」端点后端尚未暴露 → 禁用态 + tooltip。
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/common";
import {
  StrategyHeader,
  StrategyBasicInfo,
  RuleEditor,
  PositionSizingEditor,
  StrategyJsonEditor,
  RunConfigPanel,
  type RunConfigViewModel,
  RunResultPlaceholder,
  ClosedLoopRunResultPanel,
} from "@/components/strategy";
import { StrategyResearchProvenancePanel } from "@/components/research/StrategyResearchProvenancePanel";
import { trpc } from "@/lib/trpc";
import type { StrategyLifecycleStatusValue } from "@shared/researchContracts";
import {
  strategyToViewModel,
  viewModelToStrategy,
  type StrategyViewModel,
} from "@/adapters/strategyAdapter";
import { emptyRunResult } from "@/adapters/runResultAdapter";
import {
  buildClosedLoopRunViewModel,
  deriveExperimentId,
  type ClosedLoopRunViewModel,
} from "@/adapters/closedLoopRunAdapter";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileDiff,
  GitBranch,
  Hammer,
  History,
  Info,
  Loader2,
  LogIn,
  Play,
  ScrollText,
  ShieldAlert,
  Tag,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSearch } from "wouter";

// ---------------------------------------------------------------------------
// 后端权威模板（开发期用后端纯函数生成一次；前端只透传，不重算 hash / fingerprint）
// ---------------------------------------------------------------------------

const TEMPLATE_DOCUMENT = {
  recordKind: "STRATEGY_DOCUMENT",
  recordVersion: 1,
  strategyId: "limit-up-baseline",
  version: "1.0.0",
  name: "涨停候选基线",
  description: "研究链路基线策略",
  universe: { universeId: "research-dataset:rd-1.0.0-1-cffc2a0e66efbf0b" },
  entryRules: [
    {
      id: "enter-rank",
      kind: "threshold",
      field: "candidate.rank",
      operator: "<=",
      operand: 5,
      description: "候选综合排名 ≤ 5 才允许进场",
    },
    {
      id: "enter-pct",
      kind: "threshold",
      field: "price.pctChange",
      operator: ">=",
      operand: 9.5,
      description: "当日涨幅 ≥ 9.5%（逼近涨停板）",
    },
    {
      id: "enter-limitup",
      kind: "state",
      field: "price.limitUp",
      operator: "==",
      operand: "true",
      description: "当日收盘封死涨停板",
    },
    {
      id: "enter-consecutive",
      kind: "threshold",
      field: "candle.consecutiveLimitUps",
      operator: ">=",
      operand: 2,
      description: "连续涨停 ≥ 2 板（强势梯队）",
    },
    {
      id: "enter-turnover",
      kind: "threshold",
      field: "volume.turnoverRate",
      operator: ">=",
      operand: 5,
      description: "换手率 ≥ 5%（充分换手）",
    },
  ],
  exitRules: [
    {
      id: "exit-holding",
      kind: "time-based",
      field: "position.holdingDays",
      operator: ">=",
      operand: 3,
      description: "持有 ≥ 3 个交易日强制退出",
    },
    {
      id: "exit-takeprofit",
      kind: "threshold",
      field: "position.pnlPct",
      operator: ">=",
      operand: 8,
      description: "持仓盈亏 ≥ 8% 止盈离场",
    },
    {
      id: "exit-stoploss",
      kind: "threshold",
      field: "position.pnlPct",
      operator: "<=",
      operand: -5,
      description: "持仓盈亏 ≤ -5% 止损离场",
    },
    {
      id: "exit-sealbreak",
      kind: "event",
      field: "limitUp.sealBroken",
      operator: "==",
      operand: "true",
      description: "涨停打开（炸板）即退出",
    },
  ],
  positionSizing: { kind: "equal-weight", maxPositions: 5 },
  riskRules: [
    {
      id: "risk-maxpos",
      kind: "state",
      field: "position.count",
      operator: "<=",
      operand: 5,
      description: "同时持仓数 ≤ 5 只",
    },
    {
      id: "risk-dailyloss",
      kind: "threshold",
      field: "account.dailyLossPct",
      operator: ">=",
      operand: 3,
      description: "单日账户亏损 ≥ 3% 停止开新仓",
    },
    {
      id: "risk-singleloss",
      kind: "threshold",
      field: "position.singleLossPct",
      operator: "<=",
      operand: -5,
      description: "单笔亏损 ≤ -5%",
    },
    {
      id: "risk-drawdown",
      kind: "threshold",
      field: "account.maxDrawdownPct",
      operator: "<=",
      operand: 15,
      description: "账户最大回撤 ≤ 15%",
    },
  ],
  parameters: {
    parameters: [
      {
        name: "topN",
        type: "number",
        required: true,
        defaultValue: 5,
        min: 1,
        max: 20,
        description: "选股数",
      },
      {
        name: "minScore",
        type: "number",
        required: false,
        nullable: true,
        defaultValue: null,
        description: "分数阈值",
      },
    ],
  },
  datasetVersion: "rd-1.0.0-1-cffc2a0e66efbf0b",
  executionAssumptions: {
    backtestConfig: { initialCapital: 100000, maxPositions: 5 },
    costModel: {
      commissionRate: 0.0003,
      stampDutyRate: 0.001,
      transferFeeRate: 0.00001,
      slippageBps: 10,
      lotSize: 100,
      minCommission: 5,
    },
    executionModel: "NEXT_OPEN",
  },
  fingerprint:
    "c8f0996d95e372e3eba56081ef0df5a607f48313e7e370916d0009af3bcbdb02",
} as const;

const TEMPLATE_LIFECYCLE_RECORD = {
  recordKind: "STRATEGY_LIFECYCLE_RECORD",
  recordVersion: 1,
  strategyId: "limit-up-baseline",
  strategyVersion: "1.0.0",
  versionRecordFingerprint:
    "d6d48cc85ef2afc64acb316f3e80e0f2d86e470b7394d0de712772a25dc255ec",
  status: "Draft",
  transitions: [
    {
      seq: 0,
      from: null,
      to: "Draft",
      timestamp: "2026-09-01T01:00:00.000Z",
      reason: "创建基线策略 1.0.0 的生命周期壳",
      experimentId: null,
      evidence: [],
      actor: "researcher-a",
      prevHash: null,
      hash: "af898b78ea6213a44bfa3a1f6508878ce76272d817589e2f127103c5e1a800b6",
    },
  ],
  fingerprint:
    "55ea85612273e227d5f9ef074ac492ba150e7ef1f4c54e0d5a4a328dc6cf4e5d",
} as const;

const json = (v: unknown) => JSON.stringify(v, null, 2);

function parseJson(
  text: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Tab 1 · 策略编辑器（双模式：可视化 + JSON 高级）
// ---------------------------------------------------------------------------

function EditorTab({
  vm,
  onVmChange,
  jsonText,
  onJsonTextChange,
  onValidateResult,
}: {
  vm: StrategyViewModel;
  onVmChange: (next: StrategyViewModel) => void;
  jsonText: string;
  onJsonTextChange: (t: string) => void;
  onValidateResult: (valid: boolean | null) => void;
}) {
  const [mode, setMode] = useState<"visual" | "json">("visual");

  function switchMode(next: "visual" | "json") {
    if (next === mode) return;
    if (next === "json") {
      // 可视化 → JSON：序列化当前 vm
      onJsonTextChange(json(viewModelToStrategy(vm)));
    } else {
      // JSON → 可视化：解析并回填
      const parsed = parseJson(jsonText);
      if (parsed.ok && isRecord(parsed.value)) {
        onVmChange(strategyToViewModel(parsed.value));
      } else {
        toast.error("JSON 解析失败，无法切换回可视化编辑", {
          description: parsed.ok ? "内容不是对象" : parsed.error,
        });
        return;
      }
    }
    setMode(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
        <button
          onClick={() => switchMode("visual")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "visual"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <LogIn className="h-3.5 w-3.5" /> 可视化编辑
        </button>
        <button
          onClick={() => switchMode("json")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "json"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ScrollText className="h-3.5 w-3.5" /> JSON 高级模式
        </button>
      </div>

      {mode === "visual" ? (
        <div className="space-y-4">
          <StrategyBasicInfo vm={vm} onChange={onVmChange} />
          <RuleEditor
            title="入场规则"
            description="进场条件（声明式，不执行）——可用「添加预设条件」快速填充常用中文条件"
            icon={LogIn}
            category="entry"
            rules={vm.entryRules}
            onChange={entryRules => onVmChange({ ...vm, entryRules })}
            defaultKind="threshold"
            fieldPlaceholder="如 candidate.rank"
          />
          <RuleEditor
            title="退出规则"
            description="退出条件（时间 / 阈值 / 事件 / 状态）"
            icon={ArrowRight}
            category="exit"
            rules={vm.exitRules}
            onChange={exitRules => onVmChange({ ...vm, exitRules })}
            defaultKind="time-based"
            fieldPlaceholder="如 position.holdingDays"
          />
          <PositionSizingEditor vm={vm} onChange={onVmChange} />
          <RuleEditor
            title="风险规则"
            description="如最大持仓 / 止损 / 单日亏损闸门 / 最大回撤"
            icon={ShieldAlert}
            category="risk"
            rules={vm.riskRules}
            onChange={riskRules => onVmChange({ ...vm, riskRules })}
            defaultKind="state"
            fieldPlaceholder="如 position.count"
          />
        </div>
      ) : (
        <StrategyJsonEditor
          text={jsonText}
          onTextChange={onJsonTextChange}
          onResult={onValidateResult}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 · 版本化（bump + compare）
// ---------------------------------------------------------------------------

function VersionTab() {
  const bump = trpc.research.strategy.bump.useMutation();
  const compare = trpc.research.strategy.compare.useMutation();

  const [version, setVersion] = useState("1.0.0");
  const [bumped, setBumped] = useState<string | null>(null);

  const [left, setLeft] = useState(json(TEMPLATE_DOCUMENT));
  const [right, setRight] = useState(
    json({
      ...TEMPLATE_DOCUMENT,
      name: "涨停候选基线 v2",
      entryRules: [
        {
          id: "enter-rank",
          kind: "threshold",
          field: "candidate.rank",
          operator: "<=",
          operand: 3,
          description: "候选综合排名 ≤ 3 才允许进场",
        },
      ],
    })
  );
  const [diff, setDiff] = useState<NonNullable<
    ReturnType<typeof trpc.research.strategy.compare.useMutation>["data"]
  > | null>(null);
  const [cmpErr, setCmpErr] = useState<string | null>(null);

  function doBump(kind: "major" | "minor" | "patch") {
    bump.mutate(
      { version, bump: kind },
      { onSuccess: r => setBumped(r.version) }
    );
  }

  function doCompare() {
    const l = parseJson(left);
    const r = parseJson(right);
    if (!l.ok) return setCmpErr(`左：${l.error}`);
    if (!r.ok) return setCmpErr(`右：${r.error}`);
    setCmpErr(null);
    compare.mutate(
      {
        left: l.value as Record<string, unknown>,
        right: r.value as Record<string, unknown>,
      },
      { onSuccess: d => setDiff(d) }
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Tag className="h-4 w-4" /> semver 版本推进
          </CardTitle>
          <CardDescription>
            major（结构变化）/ minor（文本·参数默认值）/ patch，纯函数确定性。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="fe4-version">当前版本</Label>
              <Input
                id="fe4-version"
                value={version}
                onChange={e => setVersion(e.target.value)}
                className="w-40 font-mono"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => doBump("major")}
              disabled={bump.isPending}
            >
              major
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => doBump("minor")}
              disabled={bump.isPending}
            >
              minor
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => doBump("patch")}
              disabled={bump.isPending}
            >
              patch
            </Button>
            {bumped && (
              <span className="flex items-center gap-1.5 text-sm">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                  {bumped}
                </code>
              </span>
            )}
          </div>
          {bump.error && (
            <p className="mt-2 font-mono text-xs text-red-600">
              {bump.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileDiff className="h-4 w-4" /> 策略差异对比（字段级 diff）
          </CardTitle>
          <CardDescription>
            忽略 version / fingerprint（派生字段）；结构字段变化 →
            major，文本/参数默认值 → minor。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <Textarea
              value={left}
              onChange={e => setLeft(e.target.value)}
              spellCheck={false}
              className="min-h-[220px] font-mono text-[11px]"
            />
            <Textarea
              value={right}
              onChange={e => setRight(e.target.value)}
              spellCheck={false}
              className="min-h-[220px] font-mono text-[11px]"
            />
          </div>
          <Button size="sm" onClick={doCompare} disabled={compare.isPending}>
            {compare.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            比较
          </Button>

          {cmpErr && <p className="font-mono text-xs text-red-600">{cmpErr}</p>}
          {compare.error && (
            <p className="font-mono text-xs text-red-600">
              {compare.error.message}
            </p>
          )}

          {diff && (
            <div className="space-y-2">
              {diff.equal ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> 两策略等价（忽略 version
                  / fingerprint）
                </div>
              ) : (
                <>
                  <StatusBadge
                    status="INCONCLUSIVE"
                    label={`${diff.differences.length} 处差异`}
                  />
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="w-56 px-3 py-2 font-medium">路径</th>
                          <th className="w-24 px-3 py-2 font-medium">类型</th>
                          <th className="px-3 py-2 font-medium">
                            左侧 → 右侧
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {diff.differences.map((d, i) => (
                          <tr key={i} className="border-b last:border-b-0">
                            <td className="px-3 py-2 font-mono text-[11px]">
                              {d.path}
                            </td>
                            <td className="px-3 py-2">{d.kind}</td>
                            <td className="px-3 py-2 font-mono text-[11px]">
                              <span className="text-muted-foreground">
                                {d.left === undefined
                                  ? "∅"
                                  : JSON.stringify(d.left)}
                              </span>
                              <span className="mx-1 text-muted-foreground">
                                →
                              </span>
                              <span className="text-foreground">
                                {d.right === undefined
                                  ? "∅"
                                  : JSON.stringify(d.right)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 · 生命周期（describe + transition）
// ---------------------------------------------------------------------------

type LifecycleDescribe = NonNullable<
  ReturnType<typeof trpc.research.lifecycle.describe.useQuery>["data"]
>;
type LifecycleTransitionResult = NonNullable<
  ReturnType<typeof trpc.research.lifecycle.transition.useMutation>["data"]
>;

function LifecycleTab({
  onStatusChange,
}: {
  onStatusChange: (status: string) => void;
}) {
  const describe = trpc.research.lifecycle.describe.useQuery();
  const transition = trpc.research.lifecycle.transition.useMutation();

  const [recordText, setRecordText] = useState(json(TEMPLATE_LIFECYCLE_RECORD));
  const [to, setTo] = useState("Research");
  const [reason, setReason] = useState("研究启动：文献与特征假设");
  const [timestamp, setTimestamp] = useState(() => new Date().toISOString());
  const [experimentId, setExperimentId] = useState("");
  const [actor, setActor] = useState("researcher-a");
  const [evidenceText, setEvidenceText] = useState("[]");

  const [result, setResult] = useState<LifecycleTransitionResult | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  const parsedRecord = useMemo(() => parseJson(recordText), [recordText]);
  const currentStatus =
    parsedRecord.ok && isRecord(parsedRecord.value)
      ? (parsedRecord.value as Record<string, unknown>).status
      : null;

  const allowedTargets: string[] = describe.data
    ? [
        ...((describe.data.transitions as Record<string, readonly string[]>)[
          String(currentStatus)
        ] ?? [...describe.data.statuses]),
      ]
    : [];

  function doTransition() {
    const rec = parseJson(recordText);
    if (!rec.ok) return setFormErr(`record JSON 解析失败：${rec.error}`);
    const ev = parseJson(evidenceText);
    if (!ev.ok) return setFormErr(`evidence JSON 解析失败：${ev.error}`);
    if (!Array.isArray(ev.value)) return setFormErr("evidence 必须是数组");
    setFormErr(null);
    transition.mutate(
      {
        record: rec.value as Record<string, unknown>,
        input: {
          to: to as StrategyLifecycleStatusValue,
          timestamp,
          reason,
          ...(experimentId.trim() ? { experimentId: experimentId.trim() } : {}),
          actor: actor.trim() || null,
          evidence: ev.value as Record<string, unknown>[],
        },
      },
      {
        onSuccess: r => {
          setResult(r);
          onStatusChange(r.status);
        },
      }
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4" /> §23
            生命周期状态机（后端常量，唯一事实来源）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {describe.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : describe.error ? (
            <p className="font-mono text-xs text-red-600">
              {describe.error.message}
            </p>
          ) : describe.data ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {describe.data.statuses.map(s => (
                  <span key={s} className="flex items-center gap-1">
                    <StatusBadge status={s} />
                    {s !==
                      describe.data!.statuses[
                        describe.data!.statuses.length - 1
                      ] && (
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    )}
                  </span>
                ))}
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="w-36 px-3 py-2 font-medium">当前状态</th>
                      <th className="px-3 py-2 font-medium">可迁移至</th>
                    </tr>
                  </thead>
                  <tbody>
                    {describe.data.statuses.map(s => {
                      const tos =
                        (
                          describe.data!.transitions as Record<
                            string,
                            readonly string[]
                          >
                        )[s] ?? [];
                      return (
                        <tr key={s} className="border-b last:border-b-0">
                          <td className="px-3 py-2 font-mono">{s}</td>
                          <td className="px-3 py-2">
                            {tos.length === 0 ? (
                              <span className="text-muted-foreground">
                                终态（不可迁移）
                              </span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {tos.map(t => (
                                  <StatusBadge
                                    key={t}
                                    status={t}
                                    label={t}
                                    className="text-[10px]"
                                  />
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4" /> 生命周期迁移（append-only）
          </CardTitle>
          <CardDescription>
            §23 每次状态变化须 timestamp / reason / experiment / evidence
            四要素；不满足迁移表或证据门槛时后端抛错。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert className="py-2">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-[11px]">
              record 为「生命周期壳」（含 genesis 首跳 + 完整 hash
              链），由后端校验。timestamp/actor
              为注入式字段，页面默认值仅供演示。
            </AlertDescription>
          </Alert>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRecordText(json(TEMPLATE_LIFECYCLE_RECORD))}
            >
              <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> 载入示例壳
            </Button>
            {currentStatus ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                当前状态
                <StatusBadge status={String(currentStatus)} />
              </span>
            ) : null}
          </div>

          <Textarea
            value={recordText}
            onChange={e => setRecordText(e.target.value)}
            spellCheck={false}
            className="min-h-[260px] font-mono text-[11px] leading-5"
          />

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fe4-to">迁移至（to）</Label>
              <select
                id="fe4-to"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                {allowedTargets.map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fe4-ts">timestamp（ISO-8601 UTC）</Label>
              <Input
                id="fe4-ts"
                value={timestamp}
                onChange={e => setTimestamp(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fe4-reason">reason（必填非空）</Label>
              <Input
                id="fe4-reason"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fe4-exp">experimentId（可空）</Label>
              <Input
                id="fe4-exp"
                value={experimentId}
                onChange={e => setExperimentId(e.target.value)}
                placeholder="如 EXP-2026-09-01-…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fe4-actor">actor（可空）</Label>
              <Input
                id="fe4-actor"
                value={actor}
                onChange={e => setActor(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fe4-ev">evidence（JSON 数组，可空）</Label>
              <Input
                id="fe4-ev"
                value={evidenceText}
                onChange={e => setEvidenceText(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            证据门槛示例：Candidate 需 searchRun；Validated / Production 需
            datasetGate PASS；Approved 需 approval。
          </p>

          <Button
            size="sm"
            onClick={doTransition}
            disabled={transition.isPending}
          >
            {transition.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            应用迁移
          </Button>

          {formErr && (
            <p className="font-mono text-xs text-red-600">{formErr}</p>
          )}
          {transition.error && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>迁移被拒绝</AlertTitle>
              <AlertDescription className="font-mono text-xs">
                {transition.error.message}
              </AlertDescription>
            </Alert>
          )}

          {result && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  新记录
                </span>
                <StatusBadge status={result.status} />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {result.strategyId}@{result.strategyVersion}
                </span>
              </div>
              <p className="break-all font-mono text-[10px] text-muted-foreground">
                fingerprint: {result.fingerprint}
              </p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="px-3 py-2 font-medium">序号</th>
                      <th className="px-3 py-2 font-medium">状态迁移</th>
                      <th className="px-3 py-2 font-medium">原因</th>
                      <th className="px-3 py-2 font-medium">证据</th>
                      <th className="px-3 py-2 font-medium">哈希</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.transitions.map(t => (
                      <tr key={t.seq} className="border-b last:border-b-0">
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {t.seq}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {t.from ?? "∅"} → {t.to}
                        </td>
                        <td className="px-3 py-2">{t.reason}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {t.evidence.length === 0
                            ? "—"
                            : `${t.evidence.length} 项`}
                        </td>
                        <td
                          className="max-w-[140px] truncate px-3 py-2 font-mono text-[10px] text-muted-foreground"
                          title={t.hash}
                        >
                          {t.hash.slice(0, 12)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4 · 运行工作台（FE-4：真实接线 researchRun.loopRun）
// ---------------------------------------------------------------------------

function RunWorkbenchTab({ vm }: { vm: StrategyViewModel }) {
  // 未发起运行 / 运行失败 → 空态（沿用既有结构预留面板；此处是唯一的 emptyRunResult 用途）
  const [runResult, setRunResult] = useState<ClosedLoopRunViewModel | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // FE-0：运行就绪探测（只读，后端权威）
  const readinessQuery = trpc.researchRun.readiness.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const loopRun = trpc.researchRun.loopRun.useMutation({
    onSuccess: raw => {
      const parsed = buildClosedLoopRunViewModel(raw);
      if (parsed === null) {
        // 响应形态不符预期：如实报错，不伪造「已运行」
        setRunError("运行返回体无法解析（缺少 runId / stages），未记录结果。");
        setRunResult(null);
        return;
      }
      setRunError(null);
      setRunResult(parsed);
    },
    onError: e => {
      setRunError(e.message);
      setRunResult(null);
    },
  });

  const handleRun = (config: RunConfigViewModel) => {
    setRunError(null);
    loopRun.mutate({
      // experimentId 仅作 §28 谱系锚点标识（确定性派生，非业务数值）
      experimentId: deriveExperimentId(vm.strategyId, {
        startDate: config.startDate,
        endDate: config.endDate,
      }, config.executionModel),
      strategyId: vm.strategyId,
      strategyVersion: vm.version,
      dateRange: { startDate: config.startDate, endDate: config.endDate },
      executionModel: config.executionModel,
    });
  };

  return (
    <div className="space-y-4">
      <RunConfigPanel
        vm={vm}
        readiness={readinessQuery.data ?? null}
        readinessLoading={readinessQuery.isLoading}
        onRun={handleRun}
        running={loopRun.isPending}
        runError={runError}
      />
      {runResult === null ? (
        <RunResultPlaceholder result={emptyRunResult()} />
      ) : (
        <ClosedLoopRunResultPanel result={runResult} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 策略列表（STEP STRATEGY-002 · 最小列表：ID / Name / Latest Version / Status / Updated At / Load）
// ---------------------------------------------------------------------------

function StrategyList({ onLoad }: { onLoad: (strategyId: string) => void }) {
  const list = trpc.research.strategy.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  if (list.isLoading) {
    return <Skeleton className="h-14 w-full" />;
  }
  if (list.error) {
    return <p className="font-mono text-xs text-red-600">{list.error.message}</p>;
  }
  const items = list.data ?? [];
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        暂无已保存的策略——在下方编辑器中「保存」后会出现在这里。
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-3 py-2 font-medium">策略 ID</th>
            <th className="px-3 py-2 font-medium">名称</th>
            <th className="px-3 py-2 font-medium">最新版本</th>
            <th className="px-3 py-2 font-medium">状态</th>
            <th className="px-3 py-2 font-medium">更新时间</th>
            <th className="px-3 py-2 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.strategyId} className="border-b last:border-b-0">
              <td className="px-3 py-2 font-mono">{s.strategyId}</td>
              <td className="px-3 py-2">{s.name}</td>
              <td className="px-3 py-2 font-mono">{s.latestVersion}</td>
              <td className="px-3 py-2">
                <StatusBadge status={s.status} />
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—"}
              </td>
              <td className="px-3 py-2">
                <Button size="sm" variant="ghost" onClick={() => onLoad(s.strategyId)}>
                  <LogIn className="mr-1 h-3 w-3" /> 加载
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

export default function StrategyEditor() {
  const validate = trpc.research.strategy.validate.useMutation();
  const save = trpc.research.strategy.save.useMutation();
  const createVersion = trpc.research.strategy.createVersion.useMutation();
  const [vm, setVm] = useState<StrategyViewModel>(() =>
    strategyToViewModel(TEMPLATE_DOCUMENT)
  );
  const [jsonText, setJsonText] = useState(() => json(TEMPLATE_DOCUMENT));
  const [validateStatus, setValidateStatus] = useState<boolean | null>(null);
  const [lifecycleStatus, setLifecycleStatus] = useState("Draft");

  const [loadId, setLoadId] = useState<string | null>(null);
  /** 已从服务端加载的权威坐标（`null` = 仍在展示本地模板 ⇒ 不查溯源）。 */
  const [loadedTarget, setLoadedTarget] = useState<{ strategyId: string; version: string } | null>(
    null
  );

  const loadQuery = trpc.research.strategy.load.useQuery(
    { strategyId: loadId ?? "" },
    { enabled: loadId !== null, retry: false, refetchOnWindowFocus: false }
  );

  /**
   * 「查看 Strategy Version」的最小落点（006.4.1-B §17 / §20）：
   * `/strategy-editor?strategyId=…&version=…` —— **不新增第二套策略页面**。
   *
   * `version` 只作提示：`research.strategy.load` 以 `strategyId` 为准返回权威版本，
   * 页面一律以**加载结果**为真（不用 URL 值伪造、也不拿它当坐标比对）。
   * 只在首次进入时消费一次，之后用户手动点「加载」不受影响。
   */
  const search = useSearch();
  const urlStrategyId = new URLSearchParams(search).get("strategyId");
  const [urlLoadHandled, setUrlLoadHandled] = useState(false);
  useEffect(() => {
    if (urlLoadHandled) return;
    if (urlStrategyId === null || urlStrategyId === "") return;
    setUrlLoadHandled(true);
    setLoadId(urlStrategyId);
  }, [urlLoadHandled, urlStrategyId]);

  useEffect(() => {
    if (loadQuery.data) {
      setVm(strategyToViewModel(loadQuery.data));
      setJsonText(json(loadQuery.data));
      setValidateStatus(null);
      setLoadedTarget({ strategyId: loadQuery.data.strategyId, version: loadQuery.data.version });
      setLoadId(null);
      toast.success("策略已加载", {
        description: `${loadQuery.data.strategyId}@${loadQuery.data.version}`,
      });
    }
  }, [loadQuery.data]);

  useEffect(() => {
    if (loadQuery.error) {
      toast.error("加载失败", { description: loadQuery.error.message });
      setLoadId(null);
    }
  }, [loadQuery.error]);

  function onValidate() {
    const doc = viewModelToStrategy(vm);
    validate.mutate(
      { document: doc },
      {
        onSuccess: r => {
          setValidateStatus(r.valid);
          if (r.valid) {
            toast.success("策略校验通过", {
              description: "结构 + 语义校验通过（后端权威）",
            });
          } else {
            toast.error(`校验未通过：${r.issues.length} 项问题`, {
              description:
                r.issues[0]?.message ?? "请查看 JSON 高级模式的 issue 明细",
            });
          }
        },
        onError: e => toast.error("校验请求失败", { description: e.message }),
      }
    );
  }

  function onSave() {
    const doc = viewModelToStrategy(vm);
    save.mutate(
      { document: doc },
      {
        onSuccess: saved => {
          // 保存后以后端重组装的 document 为准（version / fingerprint 权威重算）
          setVm(strategyToViewModel(saved));
          setJsonText(json(saved));
          setValidateStatus(true);
          toast.success("策略已保存", {
            description: `${saved.strategyId}@${saved.version}`,
          });
        },
        onError: e => toast.error("保存失败", { description: e.message }),
      }
    );
  }

  function onCreateVersion() {
    const doc = viewModelToStrategy(vm);
    createVersion.mutate(
      { strategyId: vm.strategyId, document: doc },
      {
        onSuccess: created => {
          setVm(strategyToViewModel(created));
          setJsonText(json(created));
          setValidateStatus(true);
          toast.success("新版本已创建", {
            description: `${created.strategyId}@${created.version}`,
          });
        },
        onError: e => toast.error("创建版本失败", { description: e.message }),
      }
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <StrategyHeader
        vm={vm}
        lifecycleStatus={lifecycleStatus}
        validating={validate.isPending}
        onValidate={onValidate}
        saving={save.isPending}
        onSave={onSave}
        creatingVersion={createVersion.isPending}
        onCreateVersion={onCreateVersion}
      />

      {/*
        §20：Research Provenance 只读区直接长在**现有**策略页上（不新建第二套 Strategy 页面）。
        只在「确实从服务端加载了某个版本」之后出现 —— 本地模板态不会去查一个不存在的策略。
        它**只读**且**不阻断**：查不到就明说「来源已不存在」，策略本身的读取/执行不受影响。
      */}
      {loadedTarget !== null && (
        <StrategyResearchProvenancePanel
          strategyId={loadedTarget.strategyId}
          version={loadedTarget.version}
        />
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="h-4 w-4" /> 已保存策略
          </CardTitle>
          <CardDescription>
            点击「加载」把策略载入编辑器（持久化于真实数据库，重启后仍在）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StrategyList onLoad={setLoadId} />
        </CardContent>
      </Card>

      {validateStatus !== null && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {validateStatus ? (
            <span className="flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> 最近一次校验通过
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-red-700">
              <XCircle className="h-3.5 w-3.5" /> 最近一次校验未通过
            </span>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Hammer className="h-4 w-4" /> 策略编辑器 + 运行工作台
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
              FE-4 · STEP 13/15/16
            </span>
          </CardTitle>
          <CardDescription>
            主观规则 → StrategyDocument 结构化编辑与校验（§16）→ semver
            版本化与差异对比（§17）→ 生命周期迁移（§23）。 全部经 FE-0
            暴露的后端纯函数端点，页面只读展示、不重算量化判定。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="editor">
            <TabsList>
              <TabsTrigger value="editor" className="flex items-center gap-1.5">
                <ScrollText className="h-3.5 w-3.5" /> 策略编辑器
              </TabsTrigger>
              <TabsTrigger
                value="version"
                className="flex items-center gap-1.5"
              >
                <Tag className="h-3.5 w-3.5" /> 版本化
              </TabsTrigger>
              <TabsTrigger
                value="lifecycle"
                className="flex items-center gap-1.5"
              >
                <GitBranch className="h-3.5 w-3.5" /> 生命周期
              </TabsTrigger>
              <TabsTrigger value="run" className="flex items-center gap-1.5">
                <Play className="h-3.5 w-3.5" /> 运行工作台
              </TabsTrigger>
            </TabsList>
            <TabsContent value="editor" className="pt-4">
              <EditorTab
                vm={vm}
                onVmChange={setVm}
                jsonText={jsonText}
                onJsonTextChange={setJsonText}
                onValidateResult={setValidateStatus}
              />
            </TabsContent>
            <TabsContent value="version" className="pt-4">
              <VersionTab />
            </TabsContent>
            <TabsContent value="lifecycle" className="pt-4">
              <LifecycleTab onStatusChange={setLifecycleStatus} />
            </TabsContent>
            <TabsContent value="run" className="pt-4">
              <RunWorkbenchTab vm={vm} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
