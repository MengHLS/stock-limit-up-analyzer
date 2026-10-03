
import { ConfirmDialog } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClosedLoopRunResultPanel,
  DefinitionFields,
  PositionSizingEditor,
  RuleEditor,
  RunConfigPanel,
  StrategyAdvancedTools,
  StrategyBasicInfo,
  StrategyFamilyPanel,
  StrategyHeader,
  StrategyValidationStatus,
  StrategyVersionPanel,
  PresetEditor,
  type LoadedTarget,
  type PresetMaterializeResult,
  type PresetParameterValue,
  type PresetSelection,
  type PresetSummary,
  type RunConfigViewModel,
} from "@/components/strategy";
import { toRuntimeConfig } from "@/components/strategy/RunConfigPanel";
import {
  draftsToDefinition,
  backtestConfigFromDrafts,
  costModelFromDrafts,
  definitionToDrafts,
  syncPrimaryDatasetBinding,
  withDocumentLevelDrafts,
  type DefinitionDraftState,
  type DefinitionDrafts,
} from "@/components/strategy/definitionDraft";
import {
  applyDefinitionFieldPatch,
  type DefinitionFieldPatch,
} from "@/components/strategy/definitionFieldPatch";
import type { SelectedPresetParameters } from "@/components/strategy/searchParameterCandidates";
import { recordPresetUsage } from "@/components/strategy/authoringUsageLog";
import {
  ExitPolicySlotEditor,
  type ExitPolicySlotDto,
  type ExitPolicySlotRecognition,
  type ExitSlotParameterValue,
} from "@/components/strategy/ExitPolicySlotEditor";
import { StrategyResearchProvenancePanel } from "@/components/research/StrategyResearchProvenancePanel";
import { FirstLimitPoolSummary } from "@/components/strategy/FirstLimitPoolSummary";
import {
  StrategyFinalEvaluationTab,
  StrategyPaperTradingTab,
} from "@/components/strategy/StrategyVersionArtifactsTabs";
import {
  DefinitionProgressOverview,
  type DefinitionProgressPresetSegment,
} from "@/components/strategy/DefinitionProgressOverview";
import {
  DefinitionTrustStatus,
  type DefinitionTrustChangedParam,
  type DefinitionTrustKind,
} from "@/components/strategy/DefinitionTrustStatus";
import { trpc } from "@/lib/trpc";
import {
  strategyToViewModel,
  viewModelToStrategy,
  type StrategyViewModel,
} from "@/adapters/strategyAdapter";
import {
  buildClosedLoopRunViewModel,
  deriveExperimentId,
  type ClosedLoopRunViewModel,
} from "@/adapters/closedLoopRunAdapter";
import { formatLocalDateTime } from "@/adapters/closedLoopBacktestRunAdapter";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  History,
  Info,
  Loader2,
  LogIn,
  Play,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Link, useLocation, useParams, useSearch } from "wouter";

// ---------------------------------------------------------------------------
// 后端权威模板（开发期用后端纯函数生成一次；前端只透传，不重算 hash / fingerprint）
//
// 用途收窄为**一种**：新建策略时的骨架。已存在的策略一律从后端加载真实文档，
// 不会停在这份模板上。
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
      id: "exit-stoploss",
      kind: "threshold",
      field: "position.pnlPct",
      operator: "<=",
      operand: -5,
      description: "持仓盈亏 ≤ -5% 止损离场",
    },
  ],
  positionSizing: { kind: "equal-weight", maxPositions: 5 },
  riskRules: [
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

/** 「起点」选择按钮的样式（选中态高亮）。 */
function originButtonClass(active: boolean): string {
  return [
    "rounded-md border px-3 py-1.5 text-xs transition",
    active ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted",
  ].join(" ");
}

function asRecord(v: unknown): Record<string, unknown> {
  return (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
}

/**
 * SCOPE-002 —— 创作词表 / 空白草稿的**线上形状**（结构性描述，不 import 服务端值）。
 */
interface AuthoringVocabularyDto {
  readonly presetSlots: readonly { readonly slot: string; readonly label: string; readonly required: boolean; readonly description: string }[];
  readonly presets: readonly PresetSummary[];
  readonly exitPolicyRuleEnvelope: Record<string, unknown>;
  /** FE-PLAN-004：退出政策的 9 个规则槽（服务端下发；前端不自行拼 policy）。 */
  readonly exitPolicySlots?: readonly ExitPolicySlotDto[];
  /** 还没有退出政策时的**起步基准**（= 已登记实验 SL-00 的 policy）。 */
  readonly exitPolicyBasePolicy?: Record<string, unknown> | null;
  readonly exitPolicyBaseLabel?: string;
  readonly strategyTypes: readonly string[];
}

type AuthoringExitSlotId =
  | "ANCHOR" | "TAKE_PROFIT" | "TIME_EXIT" | "CONFIRMATION" | "ESCALATION"
  | "SCHEDULE" | "REDUCTION" | "STRONG_HOLD" | "RESEARCH";

/** 与共享契约 `strategyAuthoringSlotSchema` 的取值一一对应（客户端只描述形状，不 import 服务端值）。 */
type AuthoringSlotValue =
  | "RECIPE" | "EXIT_POLICY" | "POSITION" | "COST" | "EXIT_BASE" | "STOP" | "TAKE_PROFIT"
  | "TIME_EXIT" | "STRONG_HOLD" | "CAPITAL_RECYCLE" | "RUNNER_BRIDGE";

interface AuthoringBlankDto {
  readonly parts: {
    readonly identity: { readonly version: string };
    readonly definition: Record<string, unknown>;
    readonly executionAssumptions: Record<string, unknown>;
    readonly universe: Record<string, unknown>;
  };
  readonly requiredSections: readonly { readonly key: string; readonly label: string; readonly description: string }[];
  readonly notes: readonly string[];
}

/**
 * 归一「加载」的两种返回形态（见文件头第 4 条）。
 *   - `research.strategy.load`        → `StrategyDocument`（文档就是返回值本身）；
 *   - `research.strategy.loadVersion` → `StrategyVersionRecord`（文档在 `.strategy`）。
 */
function toStrategyDocument(raw: unknown): Record<string, unknown> {
  const outer = asRecord(raw);
  const inner = outer.strategy;
  if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) {
    return asRecord(inner);
  }
  return outer;
}

/**
 * 新建草稿 = 模板骨架 + **清空身份字段**。
 *
 * 🔴 不能直接拿模板开新策略：模板的 `strategyId`（`limit-up-baseline`）在库里**已存在**，
 * 原样保存会撞上既有策略（幂等写入 = 变成给它加版本，而不是新建）。因此这里把
 * `strategyId` / `name` / `description` 清空，交给用户显式填写。
 */
function emptyDraftDocument(): Record<string, unknown> {
  return {
    ...asRecord(TEMPLATE_DOCUMENT),
    strategyId: "",
    version: "1.0.0",
    name: "",
    description: "",
  };
}

// ---------------------------------------------------------------------------
// 页签 1 · 策略定义（Canonical `definition`；与研究草图同一套交互）
// ---------------------------------------------------------------------------

/**
 * 没有 Canonical 定义时的说明。
 *
 * 🔴 **不能**在这种情况下把定义编辑器顶上去：`definitionToDrafts` 会返回 `raw`，
 * 而我们一旦提交一个（空的 / 猜的）`definition`，就同时触发三件事：
 *   1. 满屏的错误（事件类型 / 窗口 / 触发时点 / 仓位 / 费率全是空的）；
 *   2. `map.ts#alignDefinitionViews` 开始对账 v1 视图 ⇒ 原有 `entryRules` 立刻冲突；
 *   3. 文档级 `datasetVersionId` 与「不存在的 PRIMARY 绑定」对不上 ⇒ 又一个响亮的拒绝。
 * 也就是说：**替用户凭空造一个定义，比让他继续编辑兼容视图更糟**。
 * 所以这里明说原因，并把旧的兼容视图编辑器原样保留（今天它能存下去，因为没有 definition
 * ⇒ `alignDefinitionViews` 直接返回，不做任何对账）。
 */
function LegacyDefinitionNotice({ reason }: { reason: string }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="flex items-start gap-1.5 text-[12px] font-medium text-amber-900">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>这个版本没有 Canonical 定义，下面的编辑器改的是「兼容视图」</span>
      </p>
      <p className="mt-1 pl-5 text-[11px] text-amber-900">{reason}</p>
      <p className="mt-1 pl-5 text-[11px] text-amber-900">
        「兼容视图」是给人和后端错误信息对照用的**有损派生结果**，回测不读它 ——
        所以在这一层做条件编辑，只有在这个文档确实没有 Canonical 定义时才有意义。
        带定义的策略（研究候选转正后的都是）请用定义编辑器改，那里改的才是回测真正读的规则。
      </p>
    </div>
  );
}

function DefinitionTab({
  vm,
  onVmChange,
  legacyReason,
  syncedDrafts,
  onDefinitionChange,
  presetSegments,
  trustPanel,
  searchParameterSources,
  presetBlocks,
}: {
  vm: StrategyViewModel;
  onVmChange: (next: StrategyViewModel) => void;
  /** 「这份文档没有 Canonical 定义」的**具体原因**；有定义时为 `null`。 */
  legacyReason: string | null;
  /** **已同步数据集坐标**的定义草稿；`null` ⇒ 走兼容视图编辑。 */
  syncedDrafts: DefinitionDrafts | null;
  onDefinitionChange: (next: DefinitionDrafts) => void;
  /** 预设槽的完成度状态（并入概览；不传 = 概览只反映 7 段）。 */
  presetSegments?: readonly DefinitionProgressPresetSegment[];
  /** 信任层状态条（P1）。 */
  trustPanel?: ReactNode;
  /** ⑤ 派生来源（P3）：①–④ 已选方案暴露的参数。 */
  searchParameterSources?: readonly SelectedPresetParameters[];
  /** 各任务块**自己的方案行**（由各段渲染在段首）。 */
  presetBlocks?: { readonly recipe?: ReactNode; readonly exit?: ReactNode; readonly position?: ReactNode; readonly cost?: ReactNode };
}) {
  return (
    <div className="space-y-4">
      <StrategyBasicInfo vm={vm} onChange={onVmChange} />

      {syncedDrafts === null ? (
        <>
          <LegacyDefinitionNotice reason={legacyReason ?? "该版本未携带 Canonical 定义。"} />
          <RuleEditor
            title="入场规则（兼容视图）"
            icon={LogIn}
            category="entry"
            rules={vm.entryRules}
            onChange={entryRules => onVmChange({ ...vm, entryRules })}
            defaultKind="threshold"
            fieldPlaceholder="如 candidate.rank"
          />
          <RuleEditor
            title="退出规则（兼容视图）"
            icon={ArrowRight}
            category="exit"
            rules={vm.exitRules}
            onChange={exitRules => onVmChange({ ...vm, exitRules })}
            defaultKind="time-based"
            fieldPlaceholder="如 position.holdingDays"
          />
          <PositionSizingEditor vm={vm} onChange={onVmChange} />
          <RuleEditor
            title="风险规则（兼容视图）"
            icon={ShieldAlert}
            category="risk"
            rules={vm.riskRules}
            onChange={riskRules => onVmChange({ ...vm, riskRules })}
            defaultKind="state"
            fieldPlaceholder="如 position.count"
          />
        </>
      ) : (
        <>
          {/* 7 段是折叠的 ⇒ 先把"还差什么"平铺出来（点击可跳到该段） */}
          {trustPanel}
          <DefinitionProgressOverview drafts={syncedDrafts} presetSegments={presetSegments} />
          <DefinitionFields
            drafts={syncedDrafts}
            onChange={onDefinitionChange}
            searchParameterSources={searchParameterSources}
            presetBlocks={presetBlocks}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 页签 2 · 运行回测
// ---------------------------------------------------------------------------

/**
 * 把后端返回的错误文本转成人话。
 *
 * `loopRun` 入参校验失败时，tRPC 会把 zod 的 issue 数组**原样 JSON 序列化**成一条多行
 * 消息。用户看到的就是那坨东西 —— 它既不说明「哪一步没做」，也不说明「下一步该干嘛」。
 * 这里只做展示层归纳：不改语义、不掩盖失败。
 */
function humanizeRunError(message: string): string {
  if (message.trimStart().startsWith("[")) {
    const messages = [...message.matchAll(/"message"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
    if (messages.length > 0) {
      return `入参校验未通过（${messages.length} 项）：${messages.join("；")}。请在「回测配置」中补齐后重试。`;
    }
  }
  if (message.includes("超出数据集窗口")) return message;
  if (message.includes("experimentId")) {
    return `${message}（运行标识格式问题，刷新页面重试即可；若重复出现请反馈。）`;
  }
  return message;
}

function RunTab({ vm }: { vm: StrategyViewModel }) {
  const [runResult, setRunResult] = useState<ClosedLoopRunViewModel | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const readinessQuery = trpc.researchRun.readiness.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const historyQuery = trpc.researchRun.listBacktests.useQuery(
    { strategyId: vm.strategyId, limit: 1 },
    { retry: false, refetchOnWindowFocus: false }
  );
  const latestRun = historyQuery.data?.[0] ?? null;
  const detailQuery = trpc.researchRun.getBacktest.useQuery(
    { id: latestRun?.id ?? 0 },
    { enabled: latestRun !== null, retry: false, refetchOnWindowFocus: false }
  );

  /** 本次运行结果不存在时，才用留档恢复（本次结果永远优先，不被旧留档顶掉）。 */
  const restoredFromArchive = useMemo(() => {
    if (runResult !== null) return null;
    const raw = detailQuery.data?.result;
    if (raw === null || raw === undefined) return null;
    return buildClosedLoopRunViewModel(raw);
  }, [runResult, detailQuery.data]);

  /**
   * 「有留档但恢复不出来」的原因 —— 必须明说，**不能**伪装成「还没跑过」。
   * 只在下述两种情况非 null：详情读取失败 / 留档里本就没有完整结果。
   */
  const latestDetail = detailQuery.data ?? null;
  const archiveBlockedReason: string | null =
    latestRun === null
      ? null
      : detailQuery.error
        ? `回测留档详情读取失败：${detailQuery.error.message}`
        : latestDetail !== null && latestDetail.resultIssue !== null
          ? `这条留档的结果读不出来（不符合当前契约）：${latestDetail.resultIssue}`
          : latestDetail !== null && latestDetail.result === null
            ? "这条留档没有完整结果明细（本次运行的 resultJson 为空）。"
            : null;

  const loopRun = trpc.researchRun.loopRun.useMutation({
    onSuccess: raw => {
      const parsed = buildClosedLoopRunViewModel(raw);
      if (parsed === null) {
        setRunError("运行返回体无法解析（缺少 runId / stages），未记录结果。");
        setRunResult(null);
        return;
      }
      setRunError(null);
      setRunResult(parsed);
      // 本次运行已自动留档 ⇒ 让「最近一次留档」立刻对齐，下次刷新即从这里恢复。
      void utils.researchRun.listBacktests.invalidate();
    },
    onError: e => {
      setRunError(humanizeRunError(e.message));
      setRunResult(null);
    },
  });

  const handleRun = (config: RunConfigViewModel) => {
    setRunError(null);
    const runtimeConfig = toRuntimeConfig(config, vm);
    loopRun.mutate({
      // experimentId 仅作谱系锚点标识（确定性派生，非业务数值）
      experimentId: deriveExperimentId(
        vm.strategyId,
        { startDate: config.startDate, endDate: config.endDate },
        config.executionModel
      ),
      strategyId: vm.strategyId,
      strategyVersion: vm.version,
      dateRange: { startDate: config.startDate, endDate: config.endDate },
      ...(Object.keys(runtimeConfig).length > 0 ? { runtimeConfig } : {}),
      useRealData: true as const,
      // gate 取库内 `dataset_version.status` 的真实值（READY → PASS），不人为压成冒烟口径。
      datasetGuards: { dataReady: true as const },
      ...(config.recipeId ? { recipeId: config.recipeId } : {}),
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
      {runResult !== null ? (
        <ClosedLoopRunResultPanel result={runResult} />
      ) : restoredFromArchive !== null ? (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            <History className="h-3.5 w-3.5 shrink-0" />
            <span>
              以下是从回测留档载入的最近一次运行
              {latestRun !== null
                ? `（${latestRun.strategyVersion} · ${formatLocalDateTime(latestRun.createdAt)}）`
                : ""}
              —— 刷新页面不会丢。
            </span>
            <Link to="/backtest-runs" className="underline underline-offset-2 hover:text-foreground">
              查看全部回测历史
            </Link>
          </p>
          <ClosedLoopRunResultPanel result={restoredFromArchive} />
        </div>
      ) : archiveBlockedReason !== null ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 px-6 py-8 text-center">
          <Info className="mx-auto h-5 w-5 text-amber-600" />
          <p className="mt-2 text-sm text-amber-900">{archiveBlockedReason}</p>
          <Link to="/backtest-runs">
            <Button variant="outline" size="sm" className="mt-4">
              去回测历史
            </Button>
          </Link>
        </div>
      ) : historyQuery.isLoading || latestRun !== null ? (
        <div className="rounded-lg border border-dashed px-6 py-10 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">正在读取这个策略的历史回测…</p>
        </div>
      ) : historyQuery.error ? (
        <div className="rounded-lg border border-dashed border-rose-200 bg-rose-50/40 px-6 py-8 text-center">
          <Info className="mx-auto h-5 w-5 text-rose-600" />
          <p className="mt-2 text-sm text-rose-800">
            读取历史回测失败：{historyQuery.error.message}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed px-6 py-10 text-center">
          <Play className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            这个策略还没有运行记录。点上方「运行策略」跑一次 —— 跑完结果会自动留档，刷新也不会丢。
          </p>
          <Link to="/backtest-runs">
            <Button variant="outline" size="sm" className="mt-4">
              去回测历史
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

/**
 * 真正持有编辑器状态的组件。
 *
 * 🔴 由外层用 `key={strategyId}` 挂载 ⇒ **换策略即重挂载**，所有本地状态（草稿、
 * 脏标记、坐标）自动归零，不必手写一堆「路由变了要清哪些 state」的同步逻辑。
 * 换**版本**不重挂载（同一个 `strategyId`），所以加载是平滑替换、不闪骨架。
 */
function StrategyDetailBody({ strategyId }: { strategyId: string }) {
  const isNew = strategyId === "new";
  const [, setLocation] = useLocation();
  const search = useSearch();

  const urlVersion = new URLSearchParams(search).get("version");
  const pinnedVersion = urlVersion !== null && urlVersion !== "" ? urlVersion : null;

  const validate = trpc.strategyDomain.strategy.validate.useMutation();
  const save = trpc.strategyDomain.strategy.save.useMutation();
  const createVersion = trpc.strategyDomain.strategy.createVersion.useMutation();

  // ---- SCOPE-002：创作词表 / 空白 canonical 草稿 / 预设物化 ----
  const authoringVocabularyQuery = trpc.strategyDomain.authoring.getVocabulary.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const vocabulary = (authoringVocabularyQuery.data ?? null) as AuthoringVocabularyDto | null;
  /**
   * 新建策略的起点 = **服务端下发的空白 canonical 草稿**（SCOPE-002 §2.3 A2）。
   *
   * 只有 `isNew` 才查（既有策略一律从库里加载真实文档，绝不用模板覆盖）。
   */
  const blankDraftQuery = trpc.strategyDomain.authoring.getBlankDraft.useQuery({}, {
    enabled: isNew,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const blankAppliedRef = useRef(false);
  const materializePreset = trpc.strategyDomain.authoring.materializePreset.useMutation();
  const saveDraft = trpc.strategyDomain.authoring.saveDraft.useMutation();
  const [recipeSelection, setRecipeSelection] = useState<PresetSelection | null>(null);
  const [exitPolicySelection, setExitPolicySelection] = useState<PresetSelection | null>(null);
  const [recipeMaterialized, setRecipeMaterialized] = useState<PresetMaterializeResult | null>(null);
  const [exitPolicyMaterialized, setExitPolicyMaterialized] = useState<PresetMaterializeResult | null>(null);
  // ③ 仓位 / ④ 成本与成交：FIELD_PATCH 预设（选中后把值**填进**草稿字段）
  const [positionSelection, setPositionSelection] = useState<PresetSelection | null>(null);
  const [costSelection, setCostSelection] = useState<PresetSelection | null>(null);
  const [positionMaterialized, setPositionMaterialized] = useState<PresetMaterializeResult | null>(null);
  const [costMaterialized, setCostMaterialized] = useState<PresetMaterializeResult | null>(null);

  // ---- 编辑器状态 ----
  const initialDocument = () => (isNew ? emptyDraftDocument() : TEMPLATE_DOCUMENT);
  const [vm, setVm] = useState<StrategyViewModel>(() =>
    strategyToViewModel(initialDocument())
  );
  /**
   * Canonical 定义的草稿状态（规则编辑的唯一真相来源）。
   *
   * 🔴 它与 `vm` 是**两份状态**，但规则的真相比只有一份：
   *   - `definition` 是权威 —— 回测读的是它的 `entry.conditions`（不是 v1 的 `entryRules`）；
   *   - `vm` 承载身份字段、v1 兼容视图，以及文档级 `executionAssumptions`。
   * 提交时由 `draftDocument` 把两者合成一份文档，并在提供 `definition` 时**删掉 v1 视图**
   * —— 与服务端 `strategyPersistence/service.ts#patchToInput`（STRATEGY-004）同一口径。
   *
   * 文档级成本 / 回测配置不在 `definition` 里（服务端明确拒绝把它们塞进去），
   * 所以它们从 `executionAssumptions` 单独取出，与定义草稿装在同一个状态里一起编辑。
   */
  const [definitionState, setDefinitionState] = useState<DefinitionDraftState>(() =>
    withDocumentLevelDrafts(
      definitionToDrafts(asRecord(initialDocument()).definition),
      asRecord(initialDocument()).executionAssumptions
    )
  );
  const [validateStatus, setValidateStatus] = useState<boolean | null>(null);
  /** 最近一次「加载 / 保存」得到的**已落库**文档（差异对比的左值）；`null` = 无对照物。 */
  const [savedDocument, setSavedDocument] = useState<Record<string, unknown> | null>(null);
  /** 已落库并加载进编辑器的坐标；`null` = 当前是未落库的草稿。 */
  const [loadedTarget, setLoadedTarget] = useState<LoadedTarget | null>(null);
  /** 草稿是否有未保存的改动（只用于显示「未保存」标记与换版本前确认）。 */
  const [dirty, setDirty] = useState(false);
  /**
   * 新建策略的**起点**：空白 canonical（默认）或从模式族生成。
   *
   * 🔴 只在 `isNew` 时有意义 —— 既有版本永远从库里加载真实文档，不用起点覆盖它。
   */
  const [originKind, setOriginKind] = useState<"BLANK" | "FAMILY">("BLANK");

  // ---- 后端真实数据源 ----
  const loadEnabled = !isNew;
  const loadLatest = trpc.strategyDomain.strategy.load.useQuery(
    { strategyId },
    {
      enabled: loadEnabled && pinnedVersion === null,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const loadPinned = trpc.strategyDomain.strategy.loadVersion.useQuery(
    { strategyId, version: pinnedVersion ?? "" },
    {
      enabled: loadEnabled && pinnedVersion !== null,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const loadError = loadPinned.error ?? loadLatest.error;
  const loadFetching = loadLatest.isFetching || loadPinned.isFetching;
  const loadData = pinnedVersion === null ? loadLatest.data : loadPinned.data;

  const versionList = trpc.strategyDomain.strategy.listVersions.useQuery(
    { strategyId },
    { enabled: loadEnabled, refetchOnWindowFocus: false }
  );
  const versionCatalog = trpc.strategyDomain.strategy.listVersionCatalog.useQuery(
    { strategyId },
    { enabled: loadEnabled, refetchOnWindowFocus: false }
  );

  /**
   * 把一次「加载结果」灌进编辑器。
   *
   * 结算判据 = **坐标键**（`?version` 或缺省 latest），而不是「data 的引用变了」：
   * 重复选同一个已缓存版本时 React Query 会返回同一个对象（引用不变），
   * 依赖引用会让这件事永远「看起来没发生」。
   */
  const appliedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!loadEnabled) return;
    if (loadFetching) return;
    if (loadData === undefined) return;
    const key = pinnedVersion ?? "latest";
    if (appliedKeyRef.current === key) return;
    appliedKeyRef.current = key;
    const doc = toStrategyDocument(loadData);
    setVm(strategyToViewModel(doc));
    setDefinitionState(
      withDocumentLevelDrafts(
        definitionToDrafts(doc.definition),
        doc.executionAssumptions
      )
    );
    setSavedDocument(doc);
    setLoadedTarget({
      strategyId: String(doc.strategyId ?? strategyId),
      version: String(doc.version ?? ""),
    });
    setValidateStatus(null);
    setDirty(false);
  }, [loadEnabled, loadFetching, loadData, pinnedVersion, strategyId]);

  /**
   * 新建策略：空白 canonical 草稿一到，就把编辑器切到**结构化定义**模式。
   *
   * 为什么必须这样做：此前的 `emptyDraftDocument()` 是无 `definition` 的 legacy 模板，
   * `definitionToDrafts` 会返回 `raw` ⇒ 定义编辑器退化成"兼容视图"，
   * 用户**根本编不出 canonical 策略**（SCOPE-002 §0.1 DoD 不可能达成）。
   */
  useEffect(() => {
    if (!isNew) return;
    if (blankAppliedRef.current) return;
    const blank = (blankDraftQuery.data ?? null) as AuthoringBlankDto | null;
    if (blank === null) return;
    blankAppliedRef.current = true;
    const document: Record<string, unknown> = {
      recordKind: "STRATEGY_DOCUMENT",
      recordVersion: 1,
      strategyId: "",
      version: blank.parts.identity.version,
      name: "",
      universe: blank.parts.universe,
      definition: blank.parts.definition,
      executionAssumptions: blank.parts.executionAssumptions,
    };
    setVm(strategyToViewModel(document));
    setDefinitionState(withDocumentLevelDrafts(definitionToDrafts(document.definition), document.executionAssumptions));
    setSavedDocument(null);
    setLoadedTarget(null);
    setValidateStatus(null);
    setDirty(false);
  }, [blankDraftQuery.data, isNew]);

  /** 当前版本的真实状态（后端版本行；拿不到就是 `null`，不猜）。 */
  const versionStatus = useMemo(() => {
    if (loadedTarget === null) return null;
    const rows = versionList.data;
    if (rows === undefined) return null;
    return rows.find(v => v.version === loadedTarget.version)?.status ?? null;
  }, [loadedTarget, versionList.data]);

  const loadedPoolSemantics = useMemo(() => {
    if (loadedTarget === null) return null;
    return (
      versionCatalog.data?.find(row => row.version === loadedTarget.version)?.study
        ?.firstLimitPool ?? null
    );
  }, [loadedTarget, versionCatalog.data]);

  /**
   * 当前版本是否属于「首板股票池每日评分」模式族。
   *
   * 判据取已落库文档的实体级 `strategyType`（落在 `vm.extra` 透传），而不是「有没有
   * 拿到池化语义详情」——否则目录接口慢一步时，池化区块会整块消失，看起来像「前端没改」。
   */
  const loadedStrategyType =
    typeof vm.extra.strategyType === "string" && vm.extra.strategyType !== ""
      ? vm.extra.strategyType
      : null;

  /**
   * 提交给后端的文档 = 身份 / 视图（`vm`）+ Canonical 定义（草稿）。
   *
   * 🔴 提交前必须把「基础信息」里的数据集坐标**同步进 `definition.datasets` 的 PRIMARY 绑定**：
   * 服务端会双向对账 doc 级 `datasetVersion(Id)` 与 PRIMARY 绑定（`map.ts#alignDefinitionViews`），
   * 只改「基础信息」不改绑定 ⇒ `SCHEMA_DEFINITION_DATASET_VERSION(_ID)_MISMATCH`。
   * 这是纯派生（`DefinitionFields` 也让同一份同步后的草稿渲染），不会写坏状态。
   */
  const draftDocument = useMemo(() => {
    if (definitionState.kind !== "structured") return viewModelToStrategy(vm);
    const drafts = syncPrimaryDatasetBinding(definitionState.drafts, {
      datasetVersionId: vm.datasetVersionId,
      datasetVersion: vm.datasetVersion,
    });
    return viewModelToStrategy(vm, {
      definition: draftsToDefinition(drafts),
      executionAssumptions: {
        costModel: costModelFromDrafts(drafts),
        backtestConfig: backtestConfigFromDrafts(drafts),
      },
    });
  }, [vm, definitionState]);

  /**
   * 定义编辑器渲染用的草稿 —— 与提交用的是**同一份**（已同步数据集坐标）。
   *
   * 若让界面渲染未同步的那份，用户会看到绑定行写着旧版本、而提交出去的是新版本，
   * 这种「显示与提交不一致」正是最难查的一类问题。
   */
  const visibleDefinitionDrafts = useMemo(() => {
    if (definitionState.kind !== "structured") return null;
    return syncPrimaryDatasetBinding(definitionState.drafts, {
      datasetVersionId: vm.datasetVersionId,
      datasetVersion: vm.datasetVersion,
    });
  }, [vm.datasetVersionId, vm.datasetVersion, definitionState]);

  /**
   * 预设槽的完成度（并入「定义完成度」概览）。
   *
   * 为什么必须并进来：**信号配方是必填** —— 缺它装配层会落到 DEFAULT 配方，
   * 回测跑的不是你以为的那套；而它不在 7 段里，只看 7 段会误报"没有必填缺口"。
   */
  const definitionPresetSegments = useMemo<readonly DefinitionProgressPresetSegment[]>(() => {
    const build = (
      selection: PresetSelection | null,
      materialized: PresetMaterializeResult | null,
      key: string,
      label: string,
      domId: string,
      required: boolean,
    ): DefinitionProgressPresetSegment => {
      if (selection === null) {
        return {
          key, label, domId,
          state: required ? "MISSING" : "OPTIONAL",
          hint: required ? "未选择（必填：缺它会退回默认配方的选股逻辑）" : "未选择（可选：留空 = 持有到回测期末）",
        };
      }
      if (materialized !== null && materialized.issues.length > 0) {
        return { key, label, domId, state: "INVALID", hint: materialized.issues[0]?.message ?? "物化失败" };
      }
      return { key, label, domId, state: "SET", hint: `已选 ${selection.presetId}` };
    };
    return [
      build(recipeSelection, recipeMaterialized, "RECIPE", "信号配方", "preset-recipe", true),
      build(exitPolicySelection, exitPolicyMaterialized, "EXIT_POLICY", "退出政策", "preset-exit-policy", false),
      build(positionSelection, positionMaterialized, "POSITION", "仓位与持仓数", "preset-position", false),
      build(costSelection, costMaterialized, "COST", "成本与成交", "preset-cost", false),
    ];
  }, [
    recipeSelection, recipeMaterialized,
    exitPolicySelection, exitPolicyMaterialized,
    positionSelection, positionMaterialized,
    costSelection, costMaterialized,
  ]);

  /** 本稿用过的预设 + **预设版本** + 参数（SCOPE-002 §1.5 · 裁定 Q5：只进审计，不进定义指纹）。 */
  /**
   * 信任层（P1）：相对"你打开的那个版本"，**预设参数**改了哪几项。
   *
   * 只比对「预设暴露的参数」与它自己的默认值 —— 这正是"选方案 + 调参数"模型下最常改的面；
   * 定义里其它字段的改动由 `dirty` 兜底（状态条显示为"定义已修改"）。
   */
  const changedPresetParams = useMemo<readonly DefinitionTrustChangedParam[]>(() => {
    const out: DefinitionTrustChangedParam[] = [];
    const scan = (selection: PresetSelection | null, slotKey: string, slotLabel: string) => {
      if (selection === null) return;
      const preset = (vocabulary?.presets ?? []).find(item => item.presetId === selection.presetId);
      if (preset === undefined) return;
      for (const parameter of preset.parameters) {
        const current = selection.parameters[parameter.code];
        if (current === undefined || current === parameter.defaultValue) continue;
        out.push({
          slotKey, slotLabel, code: parameter.code,
          from: String(parameter.defaultValue), to: String(current),
        });
      }
    };
    scan(recipeSelection, "RECIPE", "信号配方");
    scan(exitPolicySelection, "EXIT_POLICY", "退出政策");
    scan(positionSelection, "POSITION", "仓位与持仓数");
    scan(costSelection, "COST", "成本与成交");
    return out;
  }, [recipeSelection, exitPolicySelection, positionSelection, costSelection, vocabulary]);

  const presetRefs = useMemo(() => {
    const refs: { slot: AuthoringSlotValue; presetId: string; presetVersion: string; parameters: Record<string, PresetParameterValue> }[] = [];
    const add = (selection: PresetSelection | null, slot: AuthoringSlotValue) => {
      if (selection === null) return;
      const preset = (vocabulary?.presets ?? []).find(item => item.presetId === selection.presetId);
      refs.push({
        slot: (selection.slot as AuthoringSlotValue) ?? slot,
        presetId: selection.presetId,
        presetVersion: preset?.version ?? "unknown",
        parameters: { ...selection.parameters },
      });
    };
    add(recipeSelection, "RECIPE");
    add(exitPolicySelection, "EXIT_POLICY");
    add(positionSelection, "POSITION");
    add(costSelection, "COST");
    return refs;
  }, [recipeSelection, exitPolicySelection, positionSelection, costSelection, vocabulary]);

  /**
   * ⑤「可调参数」的派生来源（P3 / C-1）：①–④ **已选方案**各自暴露的参数。
   *
   * 🔴 这里只做"投影"，不自造参数清单 —— ⑤ 的唯一写路径仍是 `definition.parameters[]`
   *    （草稿）。加一个预设参数，候选自动多一条。
   */
  const searchParameterSources = useMemo<readonly SelectedPresetParameters[]>(() => {
    const pick = (selection: PresetSelection | null, blockLabel: string): SelectedPresetParameters | null => {
      if (selection === null) return null;
      const preset = (vocabulary?.presets ?? []).find(item => item.presetId === selection.presetId);
      if (preset === undefined || preset.parameters.length === 0) return null;
      return { blockLabel, presetDisplayName: preset.displayName, parameters: preset.parameters };
    };
    return [
      pick(recipeSelection, "① 选股"),
      pick(exitPolicySelection, "② 出场"),
      pick(positionSelection, "③ 仓位"),
      pick(costSelection, "④ 成本与成交"),
    ].filter((item): item is SelectedPresetParameters => item !== null);
  }, [recipeSelection, exitPolicySelection, positionSelection, costSelection, vocabulary]);

  /**
   * P5：**本地**用量计数（每块方案被换 / 参数被改的频率）。
   *
   * - 只写 `localStorage`，**不发任何网络请求**（本仓也没有遥测基建）；
   * - 只记 slot / presetId / "改了几项"，不记策略名与数值；
   * - 用途仅限：攒够 ≥2 周后决定要不要重排每块的默认项（FE-PLAN-003 §8 P5）。
   */
  useEffect(() => {
    const scan = (slotKey: string, selection: PresetSelection | null) => {
      if (selection === null) return;
      const preset = (vocabulary?.presets ?? []).find(item => item.presetId === selection.presetId);
      const changed = preset === undefined
        ? 0
        : preset.parameters.filter(parameter => {
            const current = selection.parameters[parameter.code];
            return current !== undefined && current !== parameter.defaultValue;
          }).length;
      recordPresetUsage(slotKey, selection.presetId, changed);
    };
    scan("RECIPE", recipeSelection);
    scan("EXIT_POLICY", exitPolicySelection);
    scan("POSITION", positionSelection);
    scan("COST", costSelection);
  }, [recipeSelection, exitPolicySelection, positionSelection, costSelection, vocabulary]);

  /**
   * 当前文档里的**退出政策**（即 `exit.rules[*].policy` 里那一条）。
   *
   * 🔴 它同时也是 9 个槽的**当前取值来源** —— 槽编辑器显示的就是这份 policy 拆出来的东西，
   *    所以"看到的"与"保存的"永远是同一份（不会出现显示与提交不一致）。
   */
  const currentExitPolicy = useMemo<Record<string, unknown> | null>(() => {
    if (visibleDefinitionDrafts === null) return null;
    for (const row of visibleDefinitionDrafts.exitRules) {
      const policy = row.original?.policy;
      if (typeof policy === "object" && policy !== null && !Array.isArray(policy)) {
        return policy as Record<string, unknown>;
      }
    }
    return null;
  }, [visibleDefinitionDrafts]);

  /**
   * 槽编辑器实际使用的 policy：
   *   - 文档里已有退出政策 ⇒ 用它（既有行为，零改动）；
   *   - **还没有** ⇒ 用词表下发的**起步基准**（已登记实验 SL-00 的 policy）。
   *
   * 🔴 为什么不是「什么都不给」：那样用户必须先在「推荐组合」里挑一个整包才能碰任何槽
   *    （实测反馈：不选推荐组合 ⇒ 9 槽根本不出现）。改用起步基准后，任一槽改一下就
   *    写出一份完整的、**基于已登记实验**的政策；它是不是被验证过由信任层照实说。
   */
  const effectiveExitPolicy = currentExitPolicy ?? ((vocabulary?.exitPolicyBasePolicy ?? null) as Record<string, unknown> | null);
  const usingExitBasePolicy = currentExitPolicy === null && effectiveExitPolicy !== null;

  /** 服务端识别：每个槽现在是哪个方案 + 参数（认不出 ⇒ `optionId: null`）。 */
  /**
   * 打开的那个版本的退出政策 —— 信任层判「改了哪一槽」的**基准**。
   *
   * 只从已落库文档（`savedDocument`）取：本地草稿的变化**不能**当基准，
   * 否则改完再改回去就永远判"变体"。
   */
  const baselineExitPolicy = useMemo<Record<string, unknown> | null>(() => {
    if (savedDocument === null) return null;
    const doc = savedDocument as Record<string, unknown>;
    const definition = (doc.definition ?? doc.definitionJson ?? doc) as Record<string, unknown>;
    const rules = (definition.exit as { rules?: unknown } | undefined)?.rules;
    if (!Array.isArray(rules)) return null;
    for (const rule of rules) {
      const policy = (rule as { policy?: unknown } | null)?.policy;
      if (typeof policy === "object" && policy !== null && !Array.isArray(policy)) {
        return policy as Record<string, unknown>;
      }
    }
    return null;
  }, [savedDocument]);

  const baselineExitSlotRecognition = trpc.strategyDomain.authoring.recognizeExitPolicySlots.useQuery(
    { policy: baselineExitPolicy ?? {} },
    { enabled: baselineExitPolicy !== null },
  );




  const exitSlotRecognition = trpc.strategyDomain.authoring.recognizeExitPolicySlots.useQuery(
    { policy: effectiveExitPolicy ?? {} },
    { enabled: effectiveExitPolicy !== null },
  );

  /** P4：起点行选了某个推荐组合 ⇒ 走既有整包物化路径（与原来那张卡完全相同）。 */
  const onExitStartPresetChange = (presetId: string) => {
    const preset = (vocabulary?.presets ?? []).find(item => item.presetId === presetId);
    if (preset === undefined) return;
    onExitPolicySelectionChange({
      slot: preset.slot as AuthoringSlotValue,
      presetId,
      parameters: Object.fromEntries(preset.parameters.map(parameter => [parameter.code, parameter.defaultValue])),
    });
  };

  /** P4：「改为实验基准」= 把整份政策换回词表下发的起步基准（SL-00）。 */
  const onExitResetToBase = () => {
    const envelope = vocabulary?.exitPolicyRuleEnvelope;
    const base = vocabulary?.exitPolicyBasePolicy;
    if (envelope === undefined || base === undefined) return;
    setExitPolicySelection(null);
    setExitPolicyMaterialized(null);
    setDirty(true);
    applyExitPolicyRule(envelope, base);
  };

  /**
   * P4：**退出槽**的逐槽差异（相对打开的那个版本）。
   *
   * 与上面的预设参数比对同源：都以"打开时的那一份"为基准，都只报**改了哪一项**。
   * 换方案报一条「换方案：A → B」；只调参数则逐参数报一条。
   */
  const changedExitSlots = useMemo<readonly DefinitionTrustChangedParam[]>(() => {
    const base = baselineExitSlotRecognition.data?.slots as readonly ExitPolicySlotRecognition[] | undefined;
    const current = exitSlotRecognition.data?.slots as readonly ExitPolicySlotRecognition[] | undefined;
    if (base === undefined || current === undefined) return [];
    const out: DefinitionTrustChangedParam[] = [];
    for (const slot of vocabulary?.exitPolicySlots ?? []) {
      const before = base.find(item => item.slotId === slot.slotId);
      const after = current.find(item => item.slotId === slot.slotId);
      if (before === undefined || after === undefined) continue;
      const nameOf = (optionId: string | null) =>
        optionId === null
          ? "本表单不识别"
          : (slot.options.find(option => option.optionId === optionId)?.displayName ?? optionId);
      if (before.optionId !== after.optionId) {
        out.push({
          slotKey: `EXIT_${slot.slotId}`, slotLabel: `出场·${slot.label}`, code: "换方案",
          from: nameOf(before.optionId), to: nameOf(after.optionId),
        });
        continue;
      }
      const option = slot.options.find(item => item.optionId === after.optionId);
      if (option === undefined) continue;
      for (const parameter of option.parameters) {
        const from = before.parameters[parameter.code] ?? parameter.defaultValue;
        const to = after.parameters[parameter.code] ?? parameter.defaultValue;
        if (from === to) continue;
        out.push({
          slotKey: `EXIT_${slot.slotId}`, slotLabel: `出场·${slot.label}`, code: parameter.label,
          from: String(from), to: String(to),
        });
      }
    }
    return out;
  }, [baselineExitSlotRecognition.data, exitSlotRecognition.data, vocabulary]);

  /** 预设参数 + 退出槽差异的**合并**（信任层只认这一份）。 */
  const changedDefinitionParams = useMemo<readonly DefinitionTrustChangedParam[]>(
    () => [...changedPresetParams, ...changedExitSlots],
    [changedPresetParams, changedExitSlots],
  );

  /** 三态：未落库 ⇒ 全新；有参数改动或任何编辑 ⇒ 变体；否则一致。 */
  const definitionTrustKind: DefinitionTrustKind =
    loadedTarget === null ? "UNVERIFIED" : (changedDefinitionParams.length > 0 || dirty ? "VARIANT" : "MATCH");

  const applyExitSlot = trpc.strategyDomain.authoring.applyExitPolicySlot.useMutation();

  /**
   * 改一个退出槽：把**当前 policy** 与「选哪个方案 + 填哪些参数」交给服务端，
   * 由它认领 + 物化 + 只覆盖该槽的键，再把结果写回 `exit.rules`。
   * 前端**不拼 policy**（SCOPE-002 §0.2 P4）。
   */
  const onExitSlotApply = (input: {
    slotId: string;
    optionId: string;
    parameters: Readonly<Record<string, ExitSlotParameterValue>>;
  }) => {
    const envelope = vocabulary?.exitPolicyRuleEnvelope;
    if (envelope === undefined || effectiveExitPolicy === null) return;
    setDirty(true);
    applyExitSlot.mutate(
      {
        policy: effectiveExitPolicy,
        slotId: input.slotId as AuthoringExitSlotId,
        optionId: input.optionId,
        parameters: { ...input.parameters },
      },
      {
        onSuccess: result => {
          if (result.issues.length > 0) {
            toast.error("这一槽没改成", { description: result.issues.join("；") });
            return;
          }
          applyExitPolicyRule(envelope, result.policy);
        },
      },
    );
  };

  const goToVersion = (version: string) =>
    setLocation(
      `/strategies/${encodeURIComponent(strategyId)}?version=${encodeURIComponent(version)}`
    );

  const goToList = () => setLocation("/strategies");

  /**
   * 换版本 = 改 URL；草稿有改动时先确认，避免静默丢编辑。
   * 🔴 用统一 `ConfirmDialog`（`@/components/common`）而非原生 `window.confirm`：
   *    原生 confirm 会阻塞页面且无法被无头 DOM 断言；本仓已把「重操作统一走 ConfirmDialog」写成约定。
   */
  const [pendingVersionSwitch, setPendingVersionSwitch] = useState<string | null>(null);
  const onSelectVersion = (version: string) => {
    if (version === (loadedTarget?.version ?? pinnedVersion)) return;
    if (dirty) {
      setPendingVersionSwitch(version);
      return;
    }
    goToVersion(version);
  };

  // ---- 草稿编辑（标记脏，供「未保存」提示与换版确认使用）----
  const updateVm = (next: StrategyViewModel) => {
    setDirty(true);
    setVm(next);
  };
  const updateDefinitionDrafts = (next: DefinitionDrafts) => {
    setDirty(true);
    setDefinitionState({ kind: "structured", drafts: next });
  };

  /** RECIPE 槽：物化结果写进**文档级** `recipe`（经 `vm.extra` 无损透传）。 */
  const onRecipeSelectionChange = (next: PresetSelection | null) => {
    setRecipeSelection(next);
    setDirty(true);
    if (next === null) {
      setRecipeMaterialized(null);
      setVm(previous => {
        const extra = { ...previous.extra };
        delete extra.recipe;
        return { ...previous, extra };
      });
      return;
    }
    materializePreset.mutate(
      { slot: next.slot as AuthoringSlotValue, presetId: next.presetId, parameters: { ...next.parameters } },
      {
        onSuccess: result => {
          const materialized = result as PresetMaterializeResult;
          setRecipeMaterialized(materialized);
          setVm(previous => {
            const extra = { ...previous.extra };
            if (materialized.issues.length === 0) extra.recipe = materialized.payload;
            else delete extra.recipe;
            return { ...previous, extra };
          });
        },
      }
    );
  };

  /**
   * EXIT_POLICY 槽：把服务端物化出的 policy 塞进 `definition.exit.rules` 的**统一规则外壳**。
   *
   * 🔴 外壳（id / type / trigger / priority / enabled / description）来自词表的
   * `exitPolicyRuleEnvelope` —— 前端只做"外壳 + payload"的合并，不自行发明语义。
   */
  const onExitPolicySelectionChange = (next: PresetSelection | null) => {
    setExitPolicySelection(next);
    setDirty(true);
    const envelope = vocabulary?.exitPolicyRuleEnvelope;
    if (next === null) {
      setExitPolicyMaterialized(null);
      if (envelope !== undefined) removeExitPolicyRule(String(envelope.id));
      return;
    }
    materializePreset.mutate(
      { slot: next.slot as AuthoringSlotValue, presetId: next.presetId, parameters: { ...next.parameters } },
      {
        onSuccess: result => {
          const materialized = result as PresetMaterializeResult;
          setExitPolicyMaterialized(materialized);
          if (materialized.issues.length > 0 || envelope === undefined) return;
          applyExitPolicyRule(envelope, materialized.payload);
        },
      }
    );
  };

  /**
   * ③ 仓位 / ④ 成本与成交：**FIELD_PATCH** 预设。
   *
   * 选中 ⇒ 服务端物化出一张「草稿字段补丁」⇒ 这里用 `applyDefinitionFieldPatch` 把值填进草稿。
   * 与 ①② 的唯一区别：payload **不进文档**，只填本来就由表单编辑的那些字段
   * （草稿仍是唯一真相，C-2 不破）。
   */
  const onFieldPatchSelectionChange = (
    slot: "POSITION" | "COST",
    next: PresetSelection | null,
    setSelection: (value: PresetSelection | null) => void,
    setMaterialized: (value: PresetMaterializeResult | null) => void,
  ) => {
    setSelection(next);
    setDirty(true);
    if (next === null) {
      setMaterialized(null);
      return;
    }
    materializePreset.mutate(
      { slot, presetId: next.presetId, parameters: { ...next.parameters } },
      {
        onSuccess: result => {
          const materialized = result as PresetMaterializeResult;
          setMaterialized(materialized);
          if (materialized.issues.length > 0) return;
          const patch = materialized.payload as DefinitionFieldPatch;
          setDefinitionState(previous => previous.kind !== "structured"
            ? previous
            : { kind: "structured", drafts: applyDefinitionFieldPatch(previous.drafts, patch) });
        },
      }
    );
  };

  const onPositionSelectionChange = (next: PresetSelection | null) =>
    onFieldPatchSelectionChange("POSITION", next, setPositionSelection, setPositionMaterialized);

  const onCostSelectionChange = (next: PresetSelection | null) =>
    onFieldPatchSelectionChange("COST", next, setCostSelection, setCostMaterialized);

  /** 变体态的一键还原：把预设参数恢复为各自默认值（不动其它编辑）。 */
  const restorePresetDefaults = () => {
    const reset = (selection: PresetSelection | null, apply: (next: PresetSelection) => void) => {
      if (selection === null) return;
      const preset = (vocabulary?.presets ?? []).find(item => item.presetId === selection.presetId);
      if (preset === undefined) return;
      apply({
        slot: selection.slot,
        presetId: selection.presetId,
        parameters: Object.fromEntries(preset.parameters.map(item => [item.code, item.defaultValue])),
      });
    };
    reset(recipeSelection, onRecipeSelectionChange);
    reset(exitPolicySelection, onExitPolicySelectionChange);
    reset(positionSelection, onPositionSelectionChange);
    reset(costSelection, onCostSelectionChange);
    /**
     * P4：退出槽的"还原" = 把整份 policy 换回**打开的那个版本**的那一份。
     * 槽是逐字段拼出来的，逐槽回默认值拼回去未必等于原政策（例如原政策有本表单不表达的形状）
     * ⇒ 只有整份替换才能保证"还原到已验证的那一套"。
     */
    const envelope = vocabulary?.exitPolicyRuleEnvelope;
    if (baselineExitPolicy !== null && envelope !== undefined) applyExitPolicyRule(envelope, baselineExitPolicy);
  };

  const applyExitPolicyRule = (envelope: Record<string, unknown>, policy: unknown) => {
    setDefinitionState(previous => {
      if (previous.kind !== "structured") return previous;
      const ruleId = String(envelope.id ?? "exit-unified-policy");
      const row = {
        original: { ...envelope, policy },
        type: String(envelope.type ?? "STOP_LOSS"),
        trigger: String(envelope.trigger ?? "ON_CLOSE"),
        threshold: "",
        thresholdUnit: "",
        priority: String(envelope.priority ?? 0),
        enabled: envelope.enabled !== false,
      };
      const others = previous.drafts.exitRules.filter(item => item.original?.id !== ruleId);
      return { kind: "structured", drafts: { ...previous.drafts, exitRules: [row, ...others] } };
    });
  };

  const removeExitPolicyRule = (ruleId: string) => {
    setDefinitionState(previous => {
      if (previous.kind !== "structured") return previous;
      return { kind: "structured", drafts: { ...previous.drafts, exitRules: previous.drafts.exitRules.filter(item => item.original?.id !== ruleId) } };
    });
  };

  function onValidate() {
    validate.mutate(
      { document: draftDocument },
      {
        onSuccess: r => {
          setValidateStatus(r.valid);
          if (r.valid) {
            toast.success("校验通过");
          } else {
            toast.error(`校验未通过：${r.issues.length} 项问题`, {
              description:
                r.issues[0]?.message ?? "详情见「策略定义」页签顶部的红色清单",
            });
          }
        },
        onError: e => toast.error("校验请求失败", { description: e.message }),
      }
    );
  }

  /** 保存 / 另存成功后的统一落地：写回状态、记住已结算坐标、把 URL 指到这一版。 */
  function settleSaved(created: unknown, label: string) {
    const doc = asRecord(created);
    const id = String(doc.strategyId ?? "");
    const version = String(doc.version ?? "");
    setVm(strategyToViewModel(doc));
    setDefinitionState(
      withDocumentLevelDrafts(definitionToDrafts(doc.definition), doc.executionAssumptions)
    );
    setSavedDocument(doc);
    setLoadedTarget({ strategyId: id, version });
    setValidateStatus(true);
    setDirty(false);
    void versionList.refetch();
    toast.success(label, { description: `${id}@${version}` });
    // 🔴 先记住坐标再跳：避免跳转后加载副作用把这份「刚保存的文档」当成新数据再灌一次。
    appliedKeyRef.current = version;
    setLocation(`/strategies/${encodeURIComponent(id)}?version=${encodeURIComponent(version)}`);
  }

  /**
   * SCOPE-002 §2.3 A5 —— 新建走 `authoring.saveDraft`（带"必须有 canonical definition" +
   * "strategyType 必填"两条门槛，并把用过的预设连同**预设版本**冻结进审计字段）；
   * 既有策略仍走 `strategy.save`（不改其写语义与门槛）。
   */
  function onSave() {
    const handlers = {
      onSuccess: (saved: unknown) => settleSaved(saved, isNew ? "草稿已保存" : "策略已保存"),
      onError: (error: { message: string; data?: unknown }) =>
        toast.error("保存失败", { description: error.message }),
    };
    if (isNew) {
      saveDraft.mutate(
        { document: draftDocument, origin: { kind: "BLANK_CANONICAL", presetRefs } },
        handlers
      );
      return;
    }
    save.mutate({ document: draftDocument }, handlers);
  }

  function onCreateVersion() {
    createVersion.mutate(
      { strategyId: vm.strategyId, document: draftDocument },
      {
        onSuccess: created => settleSaved(created, "新版本已创建"),
        onError: e => toast.error("创建版本失败", { description: e.message }),
      }
    );
  }

  // 首次进入、还没拿到任何已落库文档 ⇒ 骨架（而不是先闪一版模板再跳成真实文档）
  const docPending = loadEnabled && loadedTarget === null && loadError === null;

  return (
    <div className="space-y-4">
      <StrategyHeader
        vm={vm}
        loadedTarget={loadedTarget}
        versionStatus={versionStatus}
        versions={versionList.data ?? null}
        versionsLoading={versionList.isLoading}
        onSelectVersion={onSelectVersion}
        onBack={goToList}
        loadingTarget={loadFetching}
        validating={validate.isPending}
        onValidate={onValidate}
        saving={save.isPending || saveDraft.isPending}
        onSave={onSave}
        creatingVersion={createVersion.isPending}
        onCreateVersion={onCreateVersion}
        validateStatus={validateStatus}
        dirty={dirty}
      />

      {/*
        SCOPE-002 UI 重排 —— **起点**只在新建时选，模式族面板不再无条件置顶。
        旧行为：/strategies/new 一进来就预填「首板股票池 · 滚动 3F」并给出"创建独立策略"按钮，
        与"空白 canonical 起点"直接冲突（用户从没选过那个族）。
      */}
      {isNew ? (
        <div className="rounded-lg border bg-card p-4" data-strategy-origin>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">起点</h3>
            <p className="text-[11px] text-muted-foreground">
              空白 canonical = 从零填写；模式族 = 用已登记族物化一份完整文档后继续编辑。
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setOriginKind("BLANK")}
              className={originButtonClass(originKind === "BLANK")}
              data-origin-option="BLANK"
            >
              空白 canonical 定义
            </button>
            <button
              type="button"
              onClick={() => setOriginKind("FAMILY")}
              className={originButtonClass(originKind === "FAMILY")}
              data-origin-option="FAMILY"
            >
              从模式族生成
            </button>
          </div>
          {originKind === "FAMILY" && (
            <div className="mt-4">
              <StrategyFamilyPanel
                currentStrategyId={strategyId}
                datasetVersionId={vm.datasetVersionId}
                datasetLabel={vm.datasetVersion}
              />
            </div>
          )}
        </div>
      ) : (
        <details className="rounded-lg border bg-card px-4 py-3" data-strategy-family-collapsed>
          <summary className="cursor-pointer text-sm font-medium">
            从模式族另存新版本
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">
              不修改当前版本；物化后需另存为新版本
            </span>
          </summary>
          <div className="mt-3">
            <StrategyFamilyPanel
              currentStrategyId={strategyId}
              datasetVersionId={vm.datasetVersionId}
              datasetLabel={vm.datasetVersion}
            />
          </div>
        </details>
      )}

      {loadedPoolSemantics !== null && (
        <FirstLimitPoolSummary
          pool={loadedPoolSemantics}
          title="当前版本使用首板股票池 · 滚动 3F"
          description="首板事件把证券加入持久池；T+1 起逐日滚动评分，T+5 后固定窗口，低于最低分移池但持仓继续按原退出政策执行。"
        />
      )}

      {loadedPoolSemantics === null &&
        (loadedStrategyType === "FIRST_LIMIT_POOL_DAILY_SCORE" ||
          loadedStrategyType === "FIRST_LIMIT_POOL_ROLLING_3F") && (
          <div className="flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50/50 px-4 py-3 text-[11px] text-cyan-900">
            {versionCatalog.isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在读取池化语义…
              </>
            ) : (
              <>
                <Info className="h-3.5 w-3.5" />
                该策略属于「首板股票池每日评分」模式族，但当前版本未登记池化语义详情。
              </>
            )}
          </div>
        )}

      {loadError !== null && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3">
          <p className="font-mono text-[11px] text-red-700">
            加载失败：{loadError.message}
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={goToList}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            返回策略列表
          </Button>
        </div>
      )}

      {docPending ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        loadError === null && (
          <Tabs defaultValue="definition">
            <TabsList>
              <TabsTrigger value="definition" data-tab="definition" className="flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5" /> 策略定义
              </TabsTrigger>
              <TabsTrigger value="run" data-tab="run" className="flex items-center gap-1.5">
                <Play className="h-3.5 w-3.5" /> 运行回测
              </TabsTrigger>
              {/* SCOPE-002 S7：按当前版本坐标查看留档（专项页能力的通用化） */}
              <TabsTrigger value="evaluation" data-tab="evaluation" className="flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5" /> 最终评估
              </TabsTrigger>
              <TabsTrigger value="paper" data-tab="paper" className="flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5" /> 模拟盘
              </TabsTrigger>
              <TabsTrigger value="versions" data-tab="versions" className="flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" /> 版本与状态
              </TabsTrigger>
              <TabsTrigger value="validation" className="flex items-center gap-1.5" data-tab="validation">
                <ShieldCheck className="h-3.5 w-3.5" /> 验证状态
              </TabsTrigger>
            </TabsList>

            <TabsContent value="definition" className="pt-4">
              <DefinitionTab
                vm={vm}
                onVmChange={updateVm}
                legacyReason={definitionState.kind === "raw" ? definitionState.reason : null}
                syncedDrafts={visibleDefinitionDrafts}
                onDefinitionChange={updateDefinitionDrafts}
                presetSegments={definitionPresetSegments}
                searchParameterSources={searchParameterSources}
                presetBlocks={
                  vocabulary === null ? undefined : {
                    recipe: (
                      <PresetEditor
                        domId="preset-recipe"
                        title="信号配方（RECIPE）"
                        hint="决定买什么样的股（选股规则）"
                        presets={(vocabulary.presets ?? []).filter(item => item.slot === "RECIPE")}
                        value={recipeSelection}
                        onChange={onRecipeSelectionChange}
                        materialized={recipeMaterialized}
                        materializing={materializePreset.isPending}
                      />
                    ),
                    exit: (
                      <div className="space-y-3">
                        {/* 逐槽：9 个规则槽（常显 3 / 折叠 5 / 研究 1）+ 起点行 + 总述。 */}
                        {effectiveExitPolicy === null ? (
                          <p className="rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground" data-exit-slots-empty>
                            正在读取退出政策的起步基准…
                          </p>
                        ) : (
                          <>
                            {usingExitBasePolicy && (
                              <p className="text-[10px] text-muted-foreground" data-exit-slots-base-note>
                                还没有退出政策 ⇒ 下面 9 槽以「{vocabulary.exitPolicyBaseLabel ?? "实验基准"}」为起点；改任一槽即写成这份定义的政策。
                              </p>
                            )}
                            <ExitPolicySlotEditor
                              slots={vocabulary.exitPolicySlots ?? []}
                              recognitions={(exitSlotRecognition.data?.slots ?? []) as readonly ExitPolicySlotRecognition[]}
                              policy={effectiveExitPolicy}
                              domId="preset-exit-policy"
                              startOptions={(vocabulary.presets ?? [])
                                .filter(item => item.slot === "EXIT_POLICY")
                                .map(item => ({ presetId: item.presetId, displayName: item.displayName }))}
                              startPresetId={exitPolicySelection?.presetId ?? null}
                              onStartChange={onExitStartPresetChange}
                              onResetToBase={onExitResetToBase}
                              baseLabel={vocabulary.exitPolicyBaseLabel}
                              disabled={applyExitSlot.isPending}
                              busy={exitSlotRecognition.isFetching || applyExitSlot.isPending}
                              onApply={onExitSlotApply}
                            />
                          </>
                        )}
                      </div>
                    ),
                    position: (
                      <PresetEditor
                        domId="preset-position"
                        title="仓位与持仓数（POSITION）"
                        hint="每笔买多少 / 最多同时持有几只 —— 选中后填进第 ⑤ 段的字段"
                        presets={(vocabulary.presets ?? []).filter(item => item.slot === "POSITION")}
                        value={positionSelection}
                        onChange={onPositionSelectionChange}
                        materialized={positionMaterialized}
                        materializing={materializePreset.isPending}
                      />
                    ),
                    cost: (
                      <PresetEditor
                        domId="preset-cost"
                        title="成本与成交（COST）"
                        hint="初始资金 / 六项费率 / 成交时点与价格 —— 选中后填进第 ⑥ 段的字段"
                        presets={(vocabulary.presets ?? []).filter(item => item.slot === "COST")}
                        value={costSelection}
                        onChange={onCostSelectionChange}
                        materialized={costMaterialized}
                        materializing={materializePreset.isPending}
                      />
                    ),
                  }
                }
                trustPanel={
                  <DefinitionTrustStatus
                    kind={definitionTrustKind}
                    basisLabel={loadedTarget === null ? null : `${loadedTarget.strategyId}@${loadedTarget.version}`}
                    changedParams={changedDefinitionParams}
                    dirty={dirty}
                    onRestoreDefaults={restorePresetDefaults}
                  />
                }
              />
            </TabsContent>

            <TabsContent value="run" className="pt-4">
              <RunTab vm={vm} />
            </TabsContent>

            <TabsContent value="evaluation" className="pt-4" data-tab-content="evaluation">
              {loadedTarget === null ? (
                <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                  尚未保存 —— 留档以 (strategyId, version) 为坐标，保存后才可查询。
                </p>
              ) : (
                <StrategyFinalEvaluationTab
                  strategyId={loadedTarget.strategyId}
                  strategyVersion={loadedTarget.version}
                />
              )}
            </TabsContent>

            <TabsContent value="paper" className="pt-4" data-tab-content="paper">
              {loadedTarget === null ? (
                <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                  尚未保存 —— 留档以 (strategyId, version) 为坐标，保存后才可查询。
                </p>
              ) : (
                <StrategyPaperTradingTab
                  strategyId={loadedTarget.strategyId}
                  strategyVersion={loadedTarget.version}
                />
              )}
            </TabsContent>

            <TabsContent value="versions" className="pt-4">
              {loadedTarget === null ? (
                <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                  尚未保存 —— 保存后才有版本历史、差异对比与状态推进。
                </p>
              ) : (
                <div className="space-y-4">
                  <StrategyVersionPanel
                    strategyId={loadedTarget.strategyId}
                    version={loadedTarget.version}
                    versions={versionList.data ?? null}
                    versionsLoading={versionList.isLoading}
                    onRefetchVersions={() => void versionList.refetch()}
                    savedDocument={savedDocument}
                    draftDocument={draftDocument}
                  />
                  <StrategyAdvancedTools currentVersion={vm.version} />
                  {/*
                    研究溯源是**只读元数据**，只在确实加载了某个落库版本后才查 ——
                    本地草稿不会去查一个不存在的策略。查不到就明说，不阻断策略本身。
                  */}
                  <StrategyResearchProvenancePanel
                    strategyId={loadedTarget.strategyId}
                    version={loadedTarget.version}
                  />
                </div>
              )}
            </TabsContent>

            {/* FLOW-001 §3 ⑤→⑥ 交接缺口：统一状态标识（只读台账，不给结论、不排名） */}
            <TabsContent value="validation" className="pt-4" data-tab-content="validation">
              <StrategyValidationStatus strategyId={vm.strategyId} strategyVersion={vm.version} />
            </TabsContent>
          </Tabs>
        )
      )}

      <ConfirmDialog
        open={pendingVersionSwitch !== null}
        onOpenChange={(open) => { if (!open) setPendingVersionSwitch(null); }}
        title="切换版本会丢弃未保存的修改"
        description="当前草稿有未保存的修改。切换版本后这些修改会丢失，且无法撤销。"
        confirmLabel="丢弃并切换"
        tone="danger"
        onConfirm={() => {
          const next = pendingVersionSwitch;
          setPendingVersionSwitch(null);
          if (next !== null) goToVersion(next);
        }}
      />
    </div>
  );
}

export default function StrategyDetail() {
  const params = useParams();
  const strategyId = String(params.strategyId ?? "");
  // 🔴 key = 策略坐标：换策略即重挂载，本地草稿/脏标记随旧策略一起丢弃。
  return <StrategyDetailBody key={strategyId} strategyId={strategyId} />;
}
