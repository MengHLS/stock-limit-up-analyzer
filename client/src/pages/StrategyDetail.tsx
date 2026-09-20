/**
 * StrategyDetail — 单个策略的详情页（`/strategies/:strategyId`，新建入口 `/strategies/new`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 设计要点（2026-09-13 · 纯 `client/**`，零服务端改动）
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. **列表与详情分家**：本页只处理**一个**策略。挑策略是列表页的事
 *    （`StrategyList`），这里不再有「策略下拉框」——那会把「浏览全库」和
 *    「编辑这一条」混成同一个动作。
 * 2. **URL 是唯一坐标源**：`strategyId` 来自路由，`version` 来自 `?version=`。
 *    换版本 = 改 URL（可回退、可分享、可刷新），不存在「隐藏的当前版本」。
 *    `?version` 缺省 = 该策略最新版本（走 `load`，而非 `loadVersion`）。
 * 3. **两条页签动作链**：`校验 / 保存 / 另存为新版本` 全部走后端权威端点；
 *    页面只做结构化编辑与只读展示，**不重算**任何量化判定。
 * 4. 🔴 **`load` 与 `loadVersion` 形状不同**：前者返回裸 `StrategyDocument`，
 *    后者返回 §17 版本记录（文档嵌在 `.strategy` 下）⇒ 必须经 `toStrategyDocument()`
 *    归一，否则会把版本记录的**外壳**当成文档（所有字段读空）。
 * 5. **文案从简**：正文只留「是什么 / 缺什么」，后端契约与实现边界的说明收进
 *    组件内的 Tooltip / 折叠区，不再占据首屏。
 * 6. 🔴 **规则编辑只有一条路：Canonical `definition`**（2026-09-13，纯 `client/**`）。
 *    - 旧版此页签编辑的是 v1 兼容视图（`entryRules` / `exitRules` / `riskRules`），
 *      配一张自造字段表（`candidate.rank` / `price.pctChange` …）。实测真实库 9 个策略：
 *      **8 个带 Canonical 定义**，真正进回测的是它的 `entry.conditions`；v1 视图是有损派生，
 *      回测侧对 `entryRules` 的引用数为 **0**，且对它做**任何**编辑都会在保存时撞
 *      `SCHEMA_DEFINITION_VIEW_CONFLICT`（`alignDefinitionViews` 是深度比对）
 *      ⇒ 那一层既不是真相来源、也存不下去。
 *    - 现在的编辑走 `DefinitionFields`（与研究草图**同序同标题的七段**、同一套渲染外壳、
 *      同一批词表）；提交时删掉 v1 派生视图（与服务端 `patchToInput` 同口径）。
 *    - **「JSON 高级模式」已移除**：它让用户直接编辑 wire 文档，绕开一切约束，
 *      还制造出「JSON 里改了、页面上没改」的第二种真相。
 *    - **没有 Canonical 定义的文档**（legacy `limit-up-baseline`、新建模板）**保留**
 *      兼容视图编辑，并在页面上明说原因 —— 替用户凭空造一个定义会比现状更糟
 *      （见 `LegacyDefinitionNotice`）。这一条是已知缺口，须单独排期处理新建流程。
 * 7. 🔴 **运行结果不再只活在内存里**（2026-09-14，修「跑过的回测刷新后就没了」）。
 *    此前 `RunTab` 把结果只存进 `useState`，而 `dev` 是单进程 `tsx watch`（改 `server/**`
 *    即整站热重启）⇒ 整页重载后结果消失，且空态还写着「还没跑过」——看起来就像
 *    「跑过的回测又没了」。现在：**本次运行结果优先；无本次结果时，从「回测留档」
 *    （`researchRun.listBacktests` + `getBacktest`）恢复该策略最近一次运行**。
 *    恢复路径与运行工作台共用 `buildClosedLoopRunViewModel` + `ClosedLoopRunResultPanel`
 *    ⇒ 零口径漂移；且**绝不**在无留档时伪造「看起来跑过」的字段。
 */

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
  StrategyHeader,
  StrategyVersionPanel,
  type LoadedTarget,
  type RunConfigViewModel,
} from "@/components/strategy";
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
import { StrategyResearchProvenancePanel } from "@/components/research/StrategyResearchProvenancePanel";
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
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

function asRecord(v: unknown): Record<string, unknown> {
  return (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
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
}: {
  vm: StrategyViewModel;
  onVmChange: (next: StrategyViewModel) => void;
  /** 「这份文档没有 Canonical 定义」的**具体原因**；有定义时为 `null`。 */
  legacyReason: string | null;
  /** **已同步数据集坐标**的定义草稿；`null` ⇒ 走兼容视图编辑。 */
  syncedDrafts: DefinitionDrafts | null;
  onDefinitionChange: (next: DefinitionDrafts) => void;
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
        <DefinitionFields drafts={syncedDrafts} onChange={onDefinitionChange} />
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

  /**
   * 已留档的最近一次运行 —— 修「刷新 / 整页重载后结果就没了」（2026-09-14）。
   *
   * 结果此前**只**存在 `runResult` 这份组件内存里；而 `dev` 是单进程
   * `tsx watch server/_core/index.ts`，任何 `server/**` 改动触发的热重启、或用户手动刷新，
   * 都会整页重载 ⇒ 结果消失，空态还写着「还没跑过」。
   *
   * 现在：**本次运行结果优先；无本次结果时，从留档表恢复该策略最近一次运行**。
   * 取数走 `listBacktests({strategyId, limit:1})` → `getBacktest({id})`，构建走运行工作台
   * **同一个** `buildClosedLoopRunViewModel` ⇒ 零口径漂移。
   */
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
      executionModel: config.executionModel,
      // 🔴 恒为真（2026-09-13）：点「运行策略」= 服务端真实读取该策略绑定的数据集 +
      // 真实读策略文档 + 按配方装配入参。原先这是两个用户开关，但「关掉后跑空转」既非
      // 用户所需也不可诊断（关「加载真实数据」⇒ 14 阶段全 BLOCKED；关「声明数据链已就绪」
      // ⇒ 数据集 gate 被压成 INCONCLUSIVE），故已移出 UI。
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

  /** 当前版本的真实状态（后端版本行；拿不到就是 `null`，不猜）。 */
  const versionStatus = useMemo(() => {
    if (loadedTarget === null) return null;
    const rows = versionList.data;
    if (rows === undefined) return null;
    return rows.find(v => v.version === loadedTarget.version)?.status ?? null;
  }, [loadedTarget, versionList.data]);

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

  const goToVersion = (version: string) =>
    setLocation(
      `/strategies/${encodeURIComponent(strategyId)}?version=${encodeURIComponent(version)}`
    );

  const goToList = () => setLocation("/strategies");

  /** 换版本 = 改 URL；草稿有改动时先确认，避免静默丢编辑。 */
  const onSelectVersion = (version: string) => {
    if (version === (loadedTarget?.version ?? pinnedVersion)) return;
    if (dirty && !window.confirm("当前草稿有未保存的修改，切换版本会丢弃它们。继续？")) {
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

  function onSave() {
    save.mutate(
      { document: draftDocument },
      {
        onSuccess: saved => settleSaved(saved, "策略已保存"),
        onError: e => toast.error("保存失败", { description: e.message }),
      }
    );
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
        saving={save.isPending}
        onSave={onSave}
        creatingVersion={createVersion.isPending}
        onCreateVersion={onCreateVersion}
        validateStatus={validateStatus}
        dirty={dirty}
      />

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
              <TabsTrigger value="definition" className="flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5" /> 策略定义
              </TabsTrigger>
              <TabsTrigger value="run" className="flex items-center gap-1.5">
                <Play className="h-3.5 w-3.5" /> 运行回测
              </TabsTrigger>
              <TabsTrigger value="versions" className="flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" /> 版本与状态
              </TabsTrigger>
            </TabsList>

            <TabsContent value="definition" className="pt-4">
              <DefinitionTab
                vm={vm}
                onVmChange={updateVm}
                legacyReason={definitionState.kind === "raw" ? definitionState.reason : null}
                syncedDrafts={visibleDefinitionDrafts}
                onDefinitionChange={updateDefinitionDrafts}
              />
            </TabsContent>

            <TabsContent value="run" className="pt-4">
              <RunTab vm={vm} />
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
          </Tabs>
        )
      )}
    </div>
  );
}

export default function StrategyDetail() {
  const params = useParams();
  const strategyId = String(params.strategyId ?? "");
  // 🔴 key = 策略坐标：换策略即重挂载，本地草稿/脏标记随旧策略一起丢弃。
  return <StrategyDetailBody key={strategyId} strategyId={strategyId} />;
}
