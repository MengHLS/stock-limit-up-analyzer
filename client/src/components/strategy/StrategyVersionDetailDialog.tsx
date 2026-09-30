import { Database, Loader2, Settings2, Waypoints } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { StrategyVersionStudyAnnotationDto } from "@shared/researchContracts";

import {
  EXECUTION_MODEL_LABELS,
  positionSizingLabel,
  ruleConditionText,
  ruleFieldLabel,
  ruleKindLabel,
  strategyToViewModel,
  type ParameterViewModel,
  type RuleViewModel,
} from "@/adapters/strategyAdapter";
import { StatusBadge } from "@/components/common";
import { FirstLimitPoolSummary } from "@/components/strategy/FirstLimitPoolSummary";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/displayFormat";
import { trpc } from "@/lib/trpc";

export interface StrategyVersionDetailTarget {
  readonly version: string;
  readonly status?: string;
  readonly createdAt?: string;
  readonly datasetVersion?: string | null;
  readonly archiveId?: number | null;
  readonly study?: StrategyVersionStudyAnnotationDto | null;
}

type RawRecord = Record<string, unknown>;

const DATASET_SOURCE_LABELS: Record<string, string> = {
  registry: "已绑定数据集直读",
  rebuild: "按窗口重建",
  injected: "外部注入",
};

const RECIPE_SOURCE_LABELS: Record<string, string> = {
  "strategy-document": "策略文档自带",
  "strategy-declarative-conditions": "声明式条件合成",
  "explicit-request": "请求显式指定",
  "default-fallback": "默认配方兜底",
};

const DECISION_ENGINE_LABELS: Record<string, string> = {
  "strategy-core": "策略核心引擎",
  "legacy-recipe": "兼容配方引擎",
};

function isRawRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRawRecord(value: unknown): RawRecord | null {
  return isRawRecord(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function fmtRawValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") return value === "" ? '""' : value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "—";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : value.map(fmtRawValue).join(" · ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasOwn(record: RawRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function sortedKeys(...records: readonly (RawRecord | null)[]): string[] {
  return Array.from(
    new Set(
      records.flatMap(record => (record === null ? [] : Object.keys(record)))
    )
  ).sort((a, b) => a.localeCompare(b));
}

function datasetSourceLabel(value: string | null): string {
  if (value === null) return "—";
  return DATASET_SOURCE_LABELS[value] ?? value;
}

function recipeSourceLabel(value: string | null): string {
  if (value === null) return "—";
  return RECIPE_SOURCE_LABELS[value] ?? value;
}

function decisionEngineLabel(value: string | null): string {
  if (value === null) return "—";
  return DECISION_ENGINE_LABELS[value] ?? value;
}

function executionModelDisplay(value: unknown): string {
  const model = asString(value);
  if (model === null) return "—";
  const label = EXECUTION_MODEL_LABELS[model] ?? model;
  return label === model ? label : `${label} (${model})`;
}

function fmtNumber(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : value.toFixed(digits);
}

function fmtMoney(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function fmtRatePct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(4).replace(/\.?0+$/, "")}%`;
}

function fmtBps(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(2).replace(/\.?0+$/, "")} bps`;
}

function fmtBoolean(value: boolean): string {
  return value ? "是" : "否";
}

function fmtOptionalMoney(value: unknown): string {
  const number = asNumber(value);
  return number === null ? "—" : fmtMoney(number);
}

function fmtOptionalRatePct(value: unknown): string {
  const number = asNumber(value);
  return number === null ? "—" : fmtRatePct(number);
}

function fmtOptionalBps(value: unknown): string {
  const number = asNumber(value);
  return number === null ? "—" : fmtBps(number);
}

function fmtOptionalBoolean(value: unknown): string {
  const boolean = asBoolean(value);
  return boolean === null ? "—" : fmtBoolean(boolean);
}

function fmtInteger(value: unknown): string {
  const number = asNumber(value);
  return number === null ? "—" : number.toLocaleString("zh-CN");
}

function fmtPercentageValue(value: unknown, digits = 2): string {
  const number = asNumber(value);
  return number === null ? "—" : `${fmtNumber(number, digits)}%`;
}

function parameterTypeLabel(type: ParameterViewModel["type"]): string {
  switch (type) {
    case "number":
      return "数值";
    case "string":
      return "文本";
    case "boolean":
      return "布尔";
    case "json":
      return "JSON";
  }
}

function parameterDefault(p: ParameterViewModel): string {
  if (!p.hasDefaultValue && p.defaultValue === null) return "—";
  if (p.defaultValue === null) return "null";
  if (Array.isArray(p.defaultValue)) {
    return JSON.stringify(p.defaultValue);
  }
  return String(p.defaultValue);
}

function parameterConstraint(p: ParameterViewModel): string {
  const parts: string[] = [];
  if (p.allowedValues.length > 0) {
    parts.push(`可选值：${p.allowedValues.join(" / ")}`);
  } else if (p.min !== null || p.max !== null) {
    parts.push(
      `范围：${p.min === null ? "—" : p.min} ~ ${p.max === null ? "—" : p.max}`
    );
  }
  if (p.step !== null) parts.push(`步长：${p.step}`);
  if (p.minItems !== null || p.maxItems !== null) {
    parts.push(
      `条目数：${p.minItems === null ? "—" : p.minItems} ~ ${
        p.maxItems === null ? "—" : p.maxItems
      }`
    );
  }
  if (p.required) parts.push("必填");
  return parts.join(" · ") || "—";
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 break-all text-xs ${
          mono ? "font-mono tabular-nums" : ""
        }`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

function DetailSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t pt-4 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-start gap-2">
        {icon !== undefined && (
          <span className="mt-0.5 shrink-0 text-teal-700">{icon}</span>
        )}
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description !== undefined && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function SubsectionTitle({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-3">
      <h4 className="text-xs font-semibold">{title}</h4>
      {description !== undefined && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}

function Notice({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-[11px] leading-relaxed ${
        tone === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-dashed text-muted-foreground"
      }`}
    >
      {children}
    </div>
  );
}

function StringList({
  values,
  emptyText,
}: {
  values: readonly string[];
  emptyText: string;
}) {
  if (values.length === 0) {
    return <p className="text-[11px] text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className="rounded border bg-muted/30 px-2 py-1 font-mono text-[10px]"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function ParameterSnapshotTable({
  requested,
  resolved,
}: {
  requested: RawRecord | null;
  resolved: RawRecord | null;
}) {
  const keys = sortedKeys(requested, resolved);
  if (keys.length === 0) {
    return (
      <Notice>
        本次运行未记录参数入参或解析后的参数快照。历史留档可能尚未写入该字段。
      </Notice>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[720px] text-xs">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">参数</th>
            <th className="px-3 py-2 font-medium">运行入参</th>
            <th className="px-3 py-2 font-medium">解析后实际值</th>
            <th className="px-3 py-2 font-medium">记录来源</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(key => {
            const requestedRecorded =
              requested !== null && hasOwn(requested, key);
            const resolvedRecorded = resolved !== null && hasOwn(resolved, key);
            const source =
              requestedRecorded && resolvedRecorded
                ? "入参与解析均有记录"
                : resolvedRecorded
                  ? "解析派生值"
                  : "仅运行入参";
            return (
              <tr key={key} className="border-t align-top">
                <td className="px-3 py-2 font-mono font-medium">{key}</td>
                <td className="px-3 py-2 font-mono">
                  {requestedRecorded
                    ? fmtRawValue(requested[key])
                    : "未显式提供"}
                </td>
                <td className="px-3 py-2 font-mono">
                  {resolvedRecorded ? fmtRawValue(resolved[key]) : "未记录"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{source}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BacktestArchiveDetails({
  archiveId,
  isLoading,
  errorMessage,
  detail,
}: {
  archiveId: number | null;
  isLoading: boolean;
  errorMessage: string | null;
  detail: unknown;
}) {
  if (archiveId === null) {
    return (
      <DetailSection
        title="回测留档实际口径"
        description="这里读取该版本卡片关联的留档，而不是版本文档默认值。"
        icon={<Database className="h-4 w-4" />}
      >
        <Notice>
          当前版本卡片没有关联的回测留档，下面只展示策略版本文档设置。
        </Notice>
      </DetailSection>
    );
  }

  if (isLoading) {
    return (
      <DetailSection
        title="回测留档实际口径"
        description="这里读取该版本卡片关联的留档，而不是版本文档默认值。"
        icon={<Database className="h-4 w-4" />}
      >
        <div className="flex min-h-20 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-700" />
          正在读取回测留档 #{archiveId}…
        </div>
      </DetailSection>
    );
  }

  if (errorMessage !== null) {
    return (
      <DetailSection
        title="回测留档实际口径"
        description="这里读取该版本卡片关联的留档，而不是版本文档默认值。"
        icon={<Database className="h-4 w-4" />}
      >
        <Notice tone="warning">
          <p className="font-medium">回测留档读取失败</p>
          <p className="mt-1 break-all font-mono">{errorMessage}</p>
        </Notice>
      </DetailSection>
    );
  }

  const archiveRecord = asRawRecord(detail);
  if (archiveRecord === null) {
    return (
      <DetailSection
        title="回测留档实际口径"
        description="这里读取该版本卡片关联的留档，而不是版本文档默认值。"
        icon={<Database className="h-4 w-4" />}
      >
        <Notice tone="warning">
          未找到留档 #{archiveId}，可能已被清理；下面只展示策略版本文档设置。
        </Notice>
      </DetailSection>
    );
  }

  const result = asRawRecord(archiveRecord.result);
  const overall = asRawRecord(result?.overall);
  const assembly = asRawRecord(result?.assembly);
  const simulation = asRawRecord(assembly?.simulation);
  const costModel = asRawRecord(simulation?.costModel);
  const assemblyDateRange = asRawRecord(assembly?.dateRange);
  const strategyRun = asRawRecord(result?.strategyRun);
  const snapshot = asRawRecord(strategyRun?.strategyRunSnapshot);
  const universe = asRawRecord(snapshot?.universe);
  const datasetReference = asRawRecord(snapshot?.datasetReference);
  const runtimeConfig = asRawRecord(snapshot?.runtimeConfig);
  const parameterSet = asRawRecord(snapshot?.parameterSet);
  const resolvedParameterSet = asRawRecord(snapshot?.resolvedParameterSet);
  const decision = asRawRecord(strategyRun?.strategyDecision);
  const strategyExecutionMetadata = asRawRecord(strategyRun?.executionMetadata);
  const backtest = asRawRecord(result?.backtest);
  const backtestSummary = asRawRecord(backtest?.summary);
  const backtestExecutionMetadata = asRawRecord(backtest?.executionMetadata);
  const runtimeOverridesRecorded =
    assembly !== null && hasOwn(assembly, "runtimeOverrides");
  const runtimeOverrides = asStringArray(assembly?.runtimeOverrides);
  const universeMembersRecorded =
    universe !== null && hasOwn(universe, "members");
  const universeMembersRaw = universe?.members;
  const universeMembers = asStringArray(universeMembersRaw);
  const strategyExecutionNotes = asStringArray(
    strategyExecutionMetadata?.notes
  );
  const unmappedExitRuleIds = asStringArray(
    strategyExecutionMetadata?.unmappedExitRuleIds
  );
  const backtestExecutionNotes = asStringArray(
    backtestExecutionMetadata?.notes
  );
  const backtestNotes = asStringArray(backtest?.notes);
  const recipeFeatureIds = asStringArray(assembly?.recipeFeatureIds);
  const decisionSamples = Array.isArray(decision?.samples)
    ? decision.samples
    : [];

  return (
    <>
      <DetailSection
        title="回测留档实际口径"
        description="来自 closed_loop_backtest_run 留档；这是本次回测真正运行时的设置与坐标。"
        icon={<Database className="h-4 w-4" />}
      >
        <div className="rounded-md border bg-muted/15 p-3">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <DetailItem label="留档 ID" value={`#${archiveId}`} mono />
            <DetailItem
              label="Run ID"
              value={asString(archiveRecord.runId) ?? "—"}
              mono
            />
            <DetailItem
              label="留档时间"
              value={formatDateTime(asString(archiveRecord.createdAt))}
            />
            <DetailItem
              label="状态"
              value={asString(archiveRecord.status) ?? "—"}
              mono
            />
            <DetailItem
              label="策略"
              value={asString(archiveRecord.strategyId) ?? "—"}
              mono
            />
            <DetailItem
              label="策略版本"
              value={asString(archiveRecord.strategyVersion) ?? "—"}
              mono
            />
            <DetailItem
              label="实验 ID"
              value={asString(archiveRecord.experimentId) ?? "—"}
              mono
            />
            <DetailItem
              label="回测窗口"
              value={`${asString(archiveRecord.startDate) ?? "—"} ~ ${
                asString(archiveRecord.endDate) ?? "—"
              }`}
              mono
            />
            <DetailItem
              label="留档数据集"
              value={asString(archiveRecord.datasetVersion) ?? "—"}
              mono
            />
            <DetailItem
              label="数据集坐标"
              value={fmtInteger(archiveRecord.datasetVersionId)}
              mono
            />
            <DetailItem
              label="数据来源"
              value={datasetSourceLabel(asString(archiveRecord.datasetSource))}
            />
            <DetailItem
              label="数据来源说明"
              value={asString(archiveRecord.datasetSourceNote) ?? "无回落说明"}
            />
            <DetailItem
              label="初始资金"
              value={fmtOptionalMoney(archiveRecord.initialCapital)}
              mono
            />
            <DetailItem
              label="期末权益"
              value={fmtOptionalMoney(archiveRecord.finalEquity)}
              mono
            />
            <DetailItem
              label="成交笔数"
              value={fmtInteger(archiveRecord.tradeCount)}
              mono
            />
            <DetailItem
              label="权益曲线点"
              value={fmtInteger(archiveRecord.equityCurvePointCount)}
              mono
            />
            <DetailItem
              label="累计收益"
              value={fmtPercentageValue(archiveRecord.totalReturnPct)}
              mono
            />
            <DetailItem
              label="最大回撤"
              value={fmtPercentageValue(archiveRecord.maxDrawdownPct)}
              mono
            />
            <DetailItem
              label="年化收益"
              value={fmtPercentageValue(archiveRecord.cagrPct)}
              mono
            />
            <DetailItem
              label="阶段执行"
              value={`${fmtInteger(archiveRecord.executedStageCount)} 执行 / ${fmtInteger(
                archiveRecord.blockedStageCount
              )} 阻塞 / ${fmtInteger(archiveRecord.skippedStageCount)} 跳过`}
              mono
            />
          </dl>
          {asString(archiveRecord.firstBlockedReasonCode) !== null && (
            <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
              首个阻塞原因：
              <span className="ml-1 font-mono">
                {asString(archiveRecord.firstBlockedReasonCode)}
              </span>
            </p>
          )}
        </div>

        {result === null ? (
          <div className="mt-3">
            <Notice tone="warning">
              这条留档没有保存完整结果（result），无法还原当时的运行设置。
            </Notice>
          </div>
        ) : (
          <dl className="mt-3 grid gap-x-6 gap-y-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <DetailItem
              label="整体状态"
              value={asString(overall?.status) ?? "—"}
              mono
            />
            <DetailItem
              label="结果 Run ID"
              value={asString(result.runId) ?? "—"}
              mono
            />
            <DetailItem
              label="结果创建时间"
              value={formatDateTime(asString(result.createdAt))}
            />
            <DetailItem
              label="链路指纹"
              value={asString(result.chainFingerprint) ?? "—"}
              mono
            />
          </dl>
        )}
      </DetailSection>

      {result !== null && (
        <>
          <DetailSection
            title="运行装配与数据口径"
            description="对应 result.assembly：数据集、配方、判定引擎，以及真正传给仿真器的资金与成本设置。"
          >
            {assembly === null ? (
              <Notice tone="warning">
                历史记录未写入运行装配摘要（result.assembly），无法还原本次数据集与成本口径。
              </Notice>
            ) : (
              <div className="space-y-4">
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem
                    label="数据集版本"
                    value={asString(assembly.datasetVersion) ?? "—"}
                    mono
                  />
                  <DetailItem
                    label="数据集 Gate"
                    value={asString(assembly.datasetGate) ?? "—"}
                    mono
                  />
                  <DetailItem
                    label="数据集行数"
                    value={fmtInteger(assembly.datasetRowCount)}
                    mono
                  />
                  <DetailItem
                    label="证券数"
                    value={fmtInteger(assembly.datasetSecurityCount)}
                    mono
                  />
                  <DetailItem
                    label="数据来源"
                    value={datasetSourceLabel(asString(assembly.datasetSource))}
                  />
                  <DetailItem
                    label="数据集坐标"
                    value={fmtInteger(assembly.datasetVersionId)}
                    mono
                  />
                  <DetailItem
                    label="窗口"
                    value={`${asString(assemblyDateRange?.startDate) ?? "—"} ~ ${
                      asString(assemblyDateRange?.endDate) ?? "—"
                    }`}
                    mono
                  />
                  <DetailItem
                    label="策略坐标"
                    value={`${asString(assembly.strategyId) ?? "—"} @ ${
                      asString(assembly.strategyVersion) ?? "—"
                    }`}
                    mono
                  />
                  <DetailItem
                    label="配方 ID"
                    value={asString(assembly.recipeId) ?? "—"}
                    mono
                  />
                  <DetailItem
                    label="配方来源"
                    value={recipeSourceLabel(asString(assembly.recipeSource))}
                  />
                  <DetailItem
                    label="判定引擎"
                    value={decisionEngineLabel(
                      asString(assembly.strategyDecisionEngine)
                    )}
                  />
                  <DetailItem
                    label="判定引擎说明"
                    value={asString(assembly.strategyDecisionEngineNote) ?? "—"}
                  />
                </dl>

                <div className="border-t pt-3">
                  <p className="mb-1 text-xs font-medium">数据来源说明</p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {asString(assembly.datasetSourceNote) ??
                      "本次为直读 / 注入，无回落说明。"}
                  </p>
                  <p className="mt-3 text-xs font-medium">选股摘要</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {asString(assembly.selectionSummary) ?? "—"}
                  </p>
                  <p className="mt-3 text-xs font-medium">配方特征 ID</p>
                  <div className="mt-1.5">
                    <StringList
                      values={recipeFeatureIds}
                      emptyText="本次配方没有声明特征 ID。"
                    />
                  </div>
                </div>

                <div className="border-t pt-3">
                  <p className="mb-2 text-xs font-medium">运行期显式覆写</p>
                  {!runtimeOverridesRecorded ? (
                    <Notice tone="warning">
                      历史记录未写入
                      runtimeOverrides，无法确认本次是否覆写了文档默认值。
                    </Notice>
                  ) : runtimeOverrides.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      本次没有显式覆写，全部按策略文档声明执行。
                    </p>
                  ) : (
                    <StringList
                      values={runtimeOverrides}
                      emptyText="本次没有显式覆写。"
                    />
                  )}
                </div>

                <div className="border-t pt-3">
                  <p className="mb-2 text-xs font-medium">实际仿真与成本模型</p>
                  {simulation === null ? (
                    <Notice tone="warning">
                      历史记录未写入仿真设置，无法还原实际资金、持仓上限和执行模型。
                    </Notice>
                  ) : (
                    <>
                      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                        <DetailItem
                          label="初始资金"
                          value={fmtOptionalMoney(simulation.initialCapital)}
                          mono
                        />
                        <DetailItem
                          label="持仓上限"
                          value={fmtInteger(simulation.maxPositions)}
                          mono
                        />
                        <DetailItem
                          label="每日买入上限"
                          value={fmtInteger(simulation.maxDailyBuys)}
                          mono
                        />
                        <DetailItem
                          label="执行模型"
                          value={executionModelDisplay(
                            simulation.executionModel
                          )}
                        />
                      </dl>
                      {costModel === null ? (
                        <div className="mt-3">
                          <Notice tone="warning">
                            历史记录未写入完整成本模型。
                          </Notice>
                        </div>
                      ) : (
                        <dl className="mt-3 grid gap-x-6 gap-y-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3">
                          <DetailItem
                            label="佣金率"
                            value={fmtOptionalRatePct(costModel.commissionRate)}
                            mono
                          />
                          <DetailItem
                            label="印花税率"
                            value={fmtOptionalRatePct(costModel.stampDutyRate)}
                            mono
                          />
                          <DetailItem
                            label="过户费率"
                            value={fmtOptionalRatePct(
                              costModel.transferFeeRate
                            )}
                            mono
                          />
                          <DetailItem
                            label="滑点"
                            value={fmtOptionalBps(costModel.slippageBps)}
                            mono
                          />
                          <DetailItem
                            label="每手股数"
                            value={fmtInteger(costModel.lotSize)}
                            mono
                          />
                          <DetailItem
                            label="最低佣金"
                            value={fmtOptionalMoney(costModel.minCommission)}
                            mono
                          />
                        </dl>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </DetailSection>

          <DetailSection
            title="可复现运行快照"
            description="对应 result.strategyRun.strategyRunSnapshot：用于判定本次策略行为能否按原配置重放。"
            icon={<Waypoints className="h-4 w-4" />}
          >
            {snapshot === null ? (
              <Notice tone="warning">
                这条历史留档未写入 strategyRunSnapshot，可能是未接线
                Core，或记录早于该字段上线。
              </Notice>
            ) : (
              <div className="space-y-4">
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem
                    label="快照版本"
                    value={fmtInteger(snapshot.snapshotVersion)}
                    mono
                  />
                  <DetailItem
                    label="Run ID"
                    value={asString(snapshot.runId) ?? "—"}
                    mono
                  />
                  <DetailItem
                    label="策略坐标"
                    value={`${asString(snapshot.strategyId) ?? "—"} @ ${
                      asString(snapshot.strategyVersion) ?? "—"
                    }`}
                    mono
                  />
                  <DetailItem
                    label="快照创建时间"
                    value={formatDateTime(asString(snapshot.createdAt))}
                  />
                  <DetailItem
                    label="定义指纹"
                    value={asString(snapshot.definitionFingerprint) ?? "—"}
                    mono
                  />
                  <DetailItem
                    label="引擎版本"
                    value={asString(snapshot.engineVersion) ?? "—"}
                    mono
                  />
                  <DetailItem
                    label="代码版本"
                    value={asString(snapshot.codeVersion) ?? "—"}
                    mono
                  />
                  <DetailItem
                    label="执行语义版本"
                    value={asString(snapshot.executionSemanticsVersion) ?? "—"}
                    mono
                  />
                  <DetailItem
                    label="Seed"
                    value={fmtRawValue(snapshot.seed)}
                    mono
                  />
                </dl>

                <div className="border-t pt-3">
                  <p className="mb-2 text-xs font-medium">数据集引用</p>
                  {datasetReference === null ? (
                    <Notice tone="warning">
                      快照未记录 datasetReference。
                    </Notice>
                  ) : (
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                      <DetailItem
                        label="数据集 ID"
                        value={fmtInteger(datasetReference.datasetVersionId)}
                        mono
                      />
                      <DetailItem
                        label="数据集标签"
                        value={asString(datasetReference.datasetLabel) ?? "—"}
                        mono
                      />
                      <DetailItem
                        label="数据来源"
                        value={datasetSourceLabel(
                          asString(datasetReference.datasetSource)
                        )}
                      />
                      <DetailItem
                        label="内容指纹"
                        value={
                          asString(
                            datasetReference.datasetContentFingerprint
                          ) ?? "—"
                        }
                        mono
                      />
                    </dl>
                  )}
                </div>

                <div className="border-t pt-3">
                  <p className="mb-2 text-xs font-medium">Universe</p>
                  {universe === null ? (
                    <Notice tone="warning">快照未记录 universe。</Notice>
                  ) : (
                    <>
                      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                        <DetailItem
                          label="Universe ID"
                          value={asString(universe.universeId) ?? "—"}
                          mono
                        />
                        <DetailItem
                          label="成员"
                          value={
                            !universeMembersRecorded
                              ? "未记录"
                              : universeMembersRaw === null
                                ? "动态股票池（成员未固化）"
                                : `${universeMembers.length} 个`
                          }
                        />
                      </dl>
                      {universeMembers.length > 0 && (
                        <div className="mt-3">
                          <StringList
                            values={universeMembers}
                            emptyText="成员列表为空。"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="border-t pt-3">
                  <p className="mb-2 text-xs font-medium">运行时间坐标</p>
                  {runtimeConfig === null ? (
                    <Notice tone="warning">快照未记录 runtimeConfig。</Notice>
                  ) : (
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                      <DetailItem
                        label="求值日期"
                        value={asString(runtimeConfig.evaluationDate) ?? "—"}
                        mono
                      />
                      <DetailItem
                        label="求值时点"
                        value={asString(runtimeConfig.evaluationPoint) ?? "—"}
                        mono
                      />
                      <DetailItem
                        label="当前相对日"
                        value={fmtInteger(runtimeConfig.currentRelativeDay)}
                        mono
                      />
                      <DetailItem
                        label="最大相对日"
                        value={fmtInteger(runtimeConfig.maxRelativeDay)}
                        mono
                      />
                    </dl>
                  )}
                </div>

                <div className="border-t pt-3">
                  <SubsectionTitle
                    title="参数快照"
                    description="运行入参与解析后实际值并列展示；解析值才是复现主判据。"
                  />
                  <ParameterSnapshotTable
                    requested={parameterSet}
                    resolved={resolvedParameterSet}
                  />
                </div>
              </div>
            )}
          </DetailSection>

          <DetailSection
            title="策略决策摘要"
            description="对应 result.strategyRun.strategyDecision：本次策略核心实际产生的行为面计数。"
          >
            {decision === null ? (
              <Notice tone="warning">
                这条历史留档未写入 strategyDecision 摘要。
              </Notice>
            ) : (
              <>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem
                    label="决策次数"
                    value={fmtInteger(decision.decisionCount)}
                    mono
                  />
                  <DetailItem
                    label="发出信号"
                    value={fmtInteger(decision.emittedSignalCount)}
                    mono
                  />
                  <DetailItem
                    label="总信号"
                    value={fmtInteger(decision.totalSignalCount)}
                    mono
                  />
                  <DetailItem
                    label="事件命中"
                    value={fmtInteger(decision.totalEventHitCount)}
                    mono
                  />
                  <DetailItem
                    label="总条件"
                    value={fmtInteger(decision.totalConditionCount)}
                    mono
                  />
                  <DetailItem
                    label="满足条件"
                    value={fmtInteger(decision.totalSatisfiedConditionCount)}
                    mono
                  />
                  <DetailItem
                    label="数据不足"
                    value={fmtInteger(decision.insufficientDataCount)}
                    mono
                  />
                  <DetailItem
                    label="无信号丢弃"
                    value={fmtInteger(decision.droppedNoSignalCount)}
                    mono
                  />
                  <DetailItem
                    label="缺排名值丢弃"
                    value={fmtInteger(decision.droppedMissingRankValueCount)}
                    mono
                  />
                  <DetailItem
                    label="锚点无法判定"
                    value={fmtInteger(decision.undecidableAnchorCount)}
                    mono
                  />
                  <DetailItem
                    label="已发生事件"
                    value={fmtInteger(decision.occurredEventCount)}
                    mono
                  />
                  <DetailItem
                    label="未发生事件"
                    value={fmtInteger(decision.notOccurredEventCount)}
                    mono
                  />
                  <DetailItem
                    label="最小 Bar 数"
                    value={fmtInteger(decision.minBarCount)}
                    mono
                  />
                  <DetailItem
                    label="最大 Bar 数"
                    value={fmtInteger(decision.maxBarCount)}
                    mono
                  />
                  <DetailItem
                    label="观测最大相对日"
                    value={fmtInteger(decision.maxRelativeDayObserved)}
                    mono
                  />
                  <DetailItem
                    label="样本数"
                    value={fmtInteger(decisionSamples.length)}
                    mono
                  />
                </dl>
                <dl className="mt-3 grid gap-x-6 gap-y-3 border-t pt-3">
                  <DetailItem
                    label="决策摘要指纹"
                    value={asString(decision.decisionDigestFingerprint) ?? "—"}
                    mono
                  />
                </dl>
              </>
            )}
          </DetailSection>

          <DetailSection
            title="策略执行政策"
            description="对应 result.strategyRun.executionMetadata：策略判定入口、锚点政策与未映射退出规则。"
          >
            {strategyExecutionMetadata === null ? (
              <Notice tone="warning">这条历史留档未写入策略执行元数据。</Notice>
            ) : (
              <>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem
                    label="决策来源"
                    value={decisionEngineLabel(
                      asString(strategyExecutionMetadata.decisionSource)
                    )}
                  />
                  <DetailItem
                    label="引擎版本"
                    value={
                      asString(strategyExecutionMetadata.engineVersion) ?? "—"
                    }
                    mono
                  />
                  <DetailItem
                    label="代码版本"
                    value={
                      asString(strategyExecutionMetadata.codeVersion) ?? "—"
                    }
                    mono
                  />
                  <DetailItem
                    label="锚点政策"
                    value={
                      asString(strategyExecutionMetadata.anchorPolicy) ?? "—"
                    }
                    mono
                  />
                </dl>
                <div className="mt-3 grid gap-4 border-t pt-3 lg:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium">执行说明</p>
                    <StringList
                      values={strategyExecutionNotes}
                      emptyText="未记录执行说明。"
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium">未映射退出规则</p>
                    <StringList
                      values={unmappedExitRuleIds}
                      emptyText="没有未映射的退出规则。"
                    />
                  </div>
                </div>
              </>
            )}
          </DetailSection>

          <DetailSection
            title="回测执行政策"
            description="对应 result.backtest.executionMetadata：成交约束、容量上限和本载荷的抽样口径。"
          >
            {backtest === null ? (
              <Notice tone="warning">
                这条历史留档没有 backtest 阶段载荷，无法还原回测执行政策。
              </Notice>
            ) : (
              <div className="space-y-4">
                {backtestExecutionMetadata === null ? (
                  <Notice tone="warning">
                    历史记录未写入 backtest.executionMetadata。
                  </Notice>
                ) : (
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                    <DetailItem
                      label="执行政策版本"
                      value={`v${fmtInteger(
                        backtestExecutionMetadata.executionPolicyVersion
                      )}`}
                      mono
                    />
                    <DetailItem
                      label="引擎版本"
                      value={
                        asString(backtestExecutionMetadata.engineVersion) ?? "—"
                      }
                      mono
                    />
                    <DetailItem
                      label="代码版本"
                      value={
                        asString(backtestExecutionMetadata.codeVersion) ?? "—"
                      }
                      mono
                    />
                    <DetailItem
                      label="初始资金"
                      value={fmtOptionalMoney(
                        backtestExecutionMetadata.initialCapital
                      )}
                      mono
                    />
                    <DetailItem
                      label="样本上限"
                      value={fmtInteger(backtestExecutionMetadata.sampleLimit)}
                      mono
                    />
                  </dl>
                )}

                <dl className="grid gap-x-6 gap-y-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem
                    label="载荷期末权益"
                    value={fmtOptionalMoney(backtestSummary?.finalEquity)}
                    mono
                  />
                  <DetailItem
                    label="载荷累计收益"
                    value={fmtPercentageValue(backtestSummary?.totalReturnPct)}
                    mono
                  />
                  <DetailItem
                    label="权益是否截断"
                    value={fmtOptionalBoolean(
                      asRawRecord(backtest.truncated)?.equity
                    )}
                  />
                  <DetailItem
                    label="成交是否截断"
                    value={fmtOptionalBoolean(
                      asRawRecord(backtest.truncated)?.trades
                    )}
                  />
                  <DetailItem
                    label="权益曲线指纹"
                    value={asString(backtest.equityDigest) ?? "—"}
                    mono
                  />
                  <DetailItem
                    label="成交台账指纹"
                    value={asString(backtest.tradeDigest) ?? "—"}
                    mono
                  />
                </dl>

                <div className="border-t pt-3">
                  <p className="mb-2 text-xs font-medium">执行政策说明</p>
                  <StringList
                    values={
                      backtestExecutionNotes.length > 0
                        ? backtestExecutionNotes
                        : backtestNotes
                    }
                    emptyText="未记录执行政策说明。"
                  />
                </div>
              </div>
            )}
          </DetailSection>
        </>
      )}
    </>
  );
}

function StudyAnnotationDetails({
  study,
}: {
  study?: StrategyVersionStudyAnnotationDto | null;
}) {
  if (study === undefined || study === null) return null;

  return (
    <DetailSection
      title="模式定位与研究结论"
      description="按回测留档归纳版本所属模式族、研究阶段和观察结果；它解释版本差异，不替代逐笔回测结果。"
      icon={<Waypoints className="h-4 w-4" />}
    >
      <div className="rounded-md border bg-muted/15 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800">
            {study.familyLabel}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {study.familyId}
          </span>
          <span className="rounded border px-2 py-1 text-[10px] text-muted-foreground">
            {study.studyStage}
          </span>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-3 lg:grid-cols-2">
          <DetailItem label="关键差异" value={study.keyDifference} />
          <DetailItem label="留档观察" value={study.observedResult} />
        </dl>
      </div>

      {study.firstLimitPool !== null && (
        <FirstLimitPoolSummary
          pool={study.firstLimitPool}
          className="mt-4"
          description={`${study.firstLimitPool.strategyId}@${study.firstLimitPool.strategyVersion}；评分只决定买入候选，不驱动卖出。`}
        />
      )}

      {study.signals.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <SubsectionTitle
            title="实验配置与作用阶段"
            description="列出本版本在回测链路中的具体旋钮、取值和生效阶段；可调项与固定装配项分开标注。"
          />
          <div className="grid gap-2 lg:grid-cols-2">
            {study.signals.map(signal => (
              <div
                key={`${signal.label}-${signal.stage}`}
                className="rounded-md border bg-muted/15 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">
                    {signal.label}
                  </span>
                  <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {signal.stage}
                  </span>
                  <span
                    className={
                      signal.source === "TUNABLE"
                        ? "rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800"
                        : "rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    }
                  >
                    {signal.source === "TUNABLE"
                      ? "前端可调"
                      : signal.source === "FIXED"
                        ? "文档固定"
                        : "装配固定"}
                  </span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-foreground">
                  {signal.value}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {signal.effect}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {study.caution !== null && (
        <div className="mt-3">
          <Notice tone="warning">
            <p className="font-medium">研究边界与留档注意</p>
            <p className="mt-1">{study.caution}</p>
          </Notice>
        </div>
      )}

      <div className="mt-4 border-t pt-3">
        <SubsectionTitle
          title="分钟字段作用"
          description="列出每个字段真正参与的评分、准入、风险与预期阶段。"
        />
        {study.firstLimitPool !== null && (
          <Notice tone="warning">
            <p className="font-medium">池化早期评分不读取分钟字段</p>
            <p className="mt-1">
              该版本的 EARLY_OHLC 阶段只使用 OHLC 派生特征；limitUpTime
              与分钟字段只在 T+5 起的完整 3F 阶段按下表生效。
            </p>
          </Notice>
        )}
        <div className="space-y-3">
          {study.minuteFields.map(field => (
            <div key={field.field} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold">
                  {field.field}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  分钟字段
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {field.role}
              </p>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {field.stages.map(stage => (
                  <div
                    key={`${field.field}-${stage.label}`}
                    className="rounded-md border bg-muted/15 px-3 py-2"
                  >
                    <p className="text-xs font-medium">{stage.label}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {stage.effect}
                    </p>
                  </div>
                ))}
              </div>
              {field.limitations.length > 0 && (
                <div className="mt-3">
                  <Notice tone="warning">
                    <p className="font-medium">当前口径限制</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {field.limitations.map(limitation => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  </Notice>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </DetailSection>
  );
}

function RuleList({
  title,
  rules,
}: {
  title: string;
  rules: readonly RuleViewModel[];
}) {
  if (rules.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        {title}未设置
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">
        {title}
        <span className="ml-1.5 font-normal text-muted-foreground">
          {rules.length} 条
        </span>
      </p>
      <div className="space-y-1.5">
        {rules.map((rule, index) => {
          const condition = ruleConditionText(rule);
          const description = rule.description.trim();
          return (
            <div
              key={`${rule.id || rule.kind}-${index}`}
              className="rounded-md border bg-muted/15 px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {index + 1}
                </span>
                <span className="text-xs font-medium">
                  {description || condition}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {ruleKindLabel(rule.kind)}
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {rule.field
                  ? `${ruleFieldLabel(rule.field)} · ${condition}`
                  : condition}
              </p>
              {rule.note && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {rule.note}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StrategyVersionDetailDialog({
  open,
  onOpenChange,
  strategyId,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategyId: string;
  target: StrategyVersionDetailTarget | null;
}) {
  const version = target?.version ?? "";
  const archiveId = target?.archiveId ?? null;
  const query = trpc.strategyDomain.strategy.loadBundle.useQuery(
    { strategyId, version },
    {
      enabled: open && strategyId !== "" && version !== "",
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const archiveQuery = trpc.researchRun.getBacktest.useQuery(
    { id: archiveId ?? 0 },
    {
      enabled: open && (archiveId ?? 0) > 0,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  const bundle = query.data;
  const vm = useMemo(
    () => (bundle === undefined ? null : strategyToViewModel(bundle.document)),
    [bundle]
  );
  const archiveDetail = archiveQuery.data ?? null;

  const executionModelLabel =
    vm === null
      ? "—"
      : (EXECUTION_MODEL_LABELS[vm.executionModel] ?? vm.executionModel);
  const positionMax =
    vm === null ? null : (vm.maxPositions ?? vm.positionSizing.maxPositions);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-14 text-left">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 rounded-md bg-teal-50 p-2 text-teal-700">
              <Settings2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">
                策略版本设置
              </DialogTitle>
              <DialogDescription className="mt-1 truncate font-mono text-xs">
                {strategyId}
                {version !== "" ? ` @ v${version}` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="space-y-5">
            <StudyAnnotationDetails study={target?.study} />

            <BacktestArchiveDetails
              archiveId={archiveId}
              isLoading={archiveQuery.isLoading}
              errorMessage={archiveQuery.error?.message ?? null}
              detail={archiveDetail}
            />

            <DetailSection
              title="版本默认设置"
              description="来自策略版本文档，用于对照；实际运行口径以上方回测留档为准。"
            >
              {query.isLoading ? (
                <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-teal-700" />
                  正在读取版本设置…
                </div>
              ) : query.error !== null ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-700">
                  <p className="font-medium">版本设置读取失败</p>
                  <p className="mt-1 font-mono">{query.error.message}</p>
                </div>
              ) : bundle === undefined || vm === null ? (
                <div className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
                  没有可展示的版本设置。
                </div>
              ) : (
                <div className="space-y-4">
                  <DetailSection title="基础信息">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{vm.name}</span>
                      <StatusBadge status={bundle.status} />
                      {bundle.parentVersionId !== null && (
                        <span className="text-[10px] text-muted-foreground">
                          父版本 #{bundle.parentVersionId}
                        </span>
                      )}
                    </div>
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                      <DetailItem label="策略 ID" value={vm.strategyId} mono />
                      <DetailItem label="版本" value={`v${vm.version}`} mono />
                      <DetailItem
                        label="创建时间"
                        value={formatDateTime(bundle.createdAt)}
                      />
                      <DetailItem
                        label="数据集"
                        value={
                          vm.datasetVersion || target?.datasetVersion || "—"
                        }
                        mono
                      />
                      <DetailItem
                        label="数据集坐标"
                        value={
                          vm.datasetVersionId === null
                            ? "—"
                            : String(vm.datasetVersionId)
                        }
                        mono
                      />
                      <DetailItem
                        label="执行模型"
                        value={`${executionModelLabel} (${vm.executionModel || "—"})`}
                      />
                      <DetailItem label="Universe" value={vm.universeId} mono />
                      <DetailItem
                        label="代码版本"
                        value={bundle.versionRecord.codeVersion}
                        mono
                      />
                      <DetailItem
                        label="内容指纹"
                        value={bundle.fingerprint}
                        mono
                      />
                    </dl>
                    {vm.description && (
                      <p className="mt-3 border-l-2 pl-3 text-xs leading-relaxed text-muted-foreground">
                        {vm.description}
                      </p>
                    )}
                    {!bundle.hasDefinition && (
                      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                        这是历史 v1 版本，设置按兼容视图展示。
                      </p>
                    )}
                  </DetailSection>

                  <DetailSection
                    title="执行与资金"
                    description="版本固化时的回测资金、持仓上限与成交假设。"
                  >
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                      <DetailItem
                        label="初始资金"
                        value={fmtMoney(vm.initialCapital)}
                        mono
                      />
                      <DetailItem
                        label="回测持仓上限"
                        value={
                          vm.maxPositions === null
                            ? "—"
                            : String(vm.maxPositions)
                        }
                        mono
                      />
                      <DetailItem
                        label="每日最大买入"
                        value={
                          vm.maxDailyBuys === null
                            ? "—"
                            : String(vm.maxDailyBuys)
                        }
                        mono
                      />
                      <DetailItem
                        label="执行模型"
                        value={executionModelLabel}
                      />
                    </dl>
                    <dl className="mt-4 grid gap-x-6 gap-y-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3">
                      <DetailItem
                        label="佣金率"
                        value={fmtRatePct(vm.costModel.commissionRate)}
                        mono
                      />
                      <DetailItem
                        label="印花税率"
                        value={fmtRatePct(vm.costModel.stampDutyRate)}
                        mono
                      />
                      <DetailItem
                        label="过户费率"
                        value={fmtRatePct(vm.costModel.transferFeeRate)}
                        mono
                      />
                      <DetailItem
                        label="滑点"
                        value={fmtBps(vm.costModel.slippageBps)}
                        mono
                      />
                      <DetailItem
                        label="每手股数"
                        value={String(vm.costModel.lotSize)}
                        mono
                      />
                      <DetailItem
                        label="最低佣金"
                        value={fmtMoney(vm.costModel.minCommission)}
                        mono
                      />
                    </dl>
                  </DetailSection>

                  <DetailSection title="仓位与参数">
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                      <DetailItem
                        label="仓位模式"
                        value={`${positionSizingLabel(
                          vm.positionSizing.kind
                        )} (${vm.positionSizing.kind || "—"})`}
                      />
                      <DetailItem
                        label="策略持仓上限"
                        value={String(vm.positionSizing.maxPositions)}
                        mono
                      />
                      <DetailItem
                        label="单仓比例"
                        value={
                          vm.positionSizing.fraction === null
                            ? "—"
                            : fmtRatePct(vm.positionSizing.fraction)
                        }
                        mono
                      />
                      <DetailItem
                        label="单仓金额"
                        value={
                          vm.positionSizing.fixedAmount === null
                            ? "—"
                            : fmtMoney(vm.positionSizing.fixedAmount)
                        }
                        mono
                      />
                    </dl>
                    {positionMax !== null && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        当前回测持仓上限为 {positionMax}。
                      </p>
                    )}

                    <div className="mt-4 border-t pt-3">
                      <p className="mb-2 text-xs font-medium">
                        参数
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          {vm.parameters.length} 个
                        </span>
                      </p>
                      {vm.parameters.length === 0 ? (
                        <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                          未声明参数。
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-md border">
                          <table className="w-full min-w-[680px] text-xs">
                            <thead className="bg-muted/50 text-left text-muted-foreground">
                              <tr>
                                <th className="px-3 py-2 font-medium">参数</th>
                                <th className="px-3 py-2 font-medium">类型</th>
                                <th className="px-3 py-2 font-medium">
                                  默认值
                                </th>
                                <th className="px-3 py-2 font-medium">约束</th>
                              </tr>
                            </thead>
                            <tbody>
                              {vm.parameters.map((parameter, index) => (
                                <tr
                                  key={`${parameter.name}-${index}`}
                                  className="border-t align-top"
                                >
                                  <td className="px-3 py-2">
                                    <p className="font-mono font-medium">
                                      {parameter.name}
                                    </p>
                                    {parameter.description && (
                                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                                        {parameter.description}
                                      </p>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    {parameterTypeLabel(parameter.type)}
                                    {parameter.nullable && (
                                      <span className="ml-1 text-[10px] text-muted-foreground">
                                        可空
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 font-mono">
                                    {parameterDefault(parameter)}
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground">
                                    {parameterConstraint(parameter)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </DetailSection>

                  <DetailSection title="交易规则">
                    <div className="grid gap-3 lg:grid-cols-3">
                      <RuleList title="入场规则" rules={vm.entryRules} />
                      <RuleList title="出场规则" rules={vm.exitRules} />
                      <RuleList title="风险规则" rules={vm.riskRules} />
                    </div>
                  </DetailSection>

                  <DetailSection
                    title="股票池"
                    description="版本记录中的 universe 与成员快照。"
                  >
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      <DetailItem
                        label="Universe ID"
                        value={vm.universeId}
                        mono
                      />
                      <DetailItem
                        label="成员数量"
                        value={
                          vm.universeMembers.length === 0
                            ? "动态股票池"
                            : String(vm.universeMembers.length)
                        }
                      />
                    </dl>
                    {vm.universeDescription && (
                      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                        {vm.universeDescription}
                      </p>
                    )}
                    {vm.universeMembers.length > 0 && (
                      <p className="mt-3 break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                        {vm.universeMembers.join(" · ")}
                      </p>
                    )}
                  </DetailSection>
                </div>
              )}
            </DetailSection>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
