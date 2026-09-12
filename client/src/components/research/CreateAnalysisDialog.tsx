/**
 * CreateAnalysisDialog — 「新建分析」入口（RESEARCH-002 前端工作台 / RESEARCH-004 简化）。
 *
 * ## 交互结构（简化目标：默认只看到「必填的三件事」）
 *
 *   ① 你想回答什么问题 —— 用人话提问题，不暴露分析类型枚举、不显示「主分析优先级」
 *      （那是结论生成器内部的挑选规则，对做研究的人没有决策价值）；
 *   ② 需要哪些参数 —— **只渲染该类型真正必填的字段**（条件编辑器在非必填时不出现）；
 *   ③ 高级（默认收起）—— 分析名称（留空自动生成）、以及**可选**的条件。
 *
 * ## 三条不造假的纪律（与原实现一致，未放宽）
 *
 *   - **变量只能从目录里选**（下拉 / 勾选），不做自由文本。目录由 Dataset 的真实视界推导，
 *     手打一个不存在的变量必然得到 `UNKNOWN_VARIABLE`；UI 从源头消除这种跑空。
 *   - **不登记 `research_analysis_metric`**。指标定义由引擎逐行写入结果的
 *     `details.metricDefinition`，在前端再抄一份指标码清单只会制造第二份权威。
 *   - **条件构造器按运算符元数显示输入框**（`BETWEEN` 两个、`IS_NULL` 零个、`IN` 逗号列表）。
 *
 * ## RESEARCH-004 新增
 *
 *   - `SEGMENT_RELATION`（分段关系）：两个时间窗 → 窗 A 分档、看窗 B 的表现。
 *     窗与变量的对应关系**实时显示**（`max_drawdown_5d` vs `segment_return_5_20d`），
 *     因为「锚在 T」与「锚在 T+1」不是同一个数，界面上必须看得出来。
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2, Plus, Sigma, TriangleAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { rpcErrorToDiagnostic, variableLabelOf } from "@/adapters/researchEngineAdapter";
import { ConditionGroupsEditor } from "./ConditionGroupsEditor";
import {
  ANALYSIS_EXAMPLES,
  ANALYSIS_TYPE_OPTIONS,
  SEGMENT_STAT_OPTIONS,
  WINDOW_ANCHOR_LABEL,
  analysisFormRequirements,
  analysisTypeOptionOf,
  applyAnalysisExample,
  availableFutureReturnHorizons,
  createDefaultAnalysisForm,
  defaultSegmentWindows,
  missingVariablesForExample,
  recommendFeatureField,
  recommendTargetField,
  segmentRelationDescription,
  suggestAnalysisName,
  toAnalysisConditions,
  toAnalysisConfig,
  toAnalysisTarget,
  usesExistingVariableFamily,
  validateAnalysisForm,
  windowVariableName,
  type AnalysisExample,
  type AnalysisFormCatalog,
  type CreateAnalysisFormState,
  type ImplementedAnalysisType,
} from "./createAnalysisForm";

const DIMENSION_LABELS: Record<string, string> = {
  year: "年度",
  month: "月份",
  quarter: "季度",
  board: "板块",
  market: "市场",
  industry: "行业",
};

/** 分区标题（① ② ③ 只是阅读顺序，不是必须逐步完成的向导 —— 用户可任意顺序改）。 */
function SectionTitle({ index, title, hint }: { index: string; title: string; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium">
        <span className="mr-1.5 text-muted-foreground">{index}</span>
        {title}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** 一个时间窗的编辑块（起 / 止 / 口径 + 实时显示映射到的真实变量名）。 */
function WindowEditor({
  title,
  role,
  state,
  onChange,
  spaceHint,
}: {
  title: string;
  role: "A" | "B";
  state: CreateAnalysisFormState;
  onChange: (next: Partial<CreateAnalysisFormState>) => void;
  spaceHint: string;
}) {
  const from = role === "A" ? state.windowAFrom : state.windowBFrom;
  const to = role === "A" ? state.windowATo : state.windowBTo;
  const stat = role === "A" ? state.windowAStat : state.windowBStat;
  const fromKey = role === "A" ? "windowAFrom" : "windowBFrom";
  const toKey = role === "A" ? "windowATo" : "windowBTo";
  const statKey = role === "A" ? "windowAStat" : "windowBStat";

  const fromNum = Number(from);
  const toNum = Number(to);
  const validNumbers = Number.isInteger(fromNum) && Number.isInteger(toNum) && toNum > fromNum;
  const variable = validNumbers ? windowVariableName(stat, fromNum, toNum) : "—";
  const reuses = usesExistingVariableFamily(from);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium">{title}</p>
        {reuses && (
          <Badge variant="outline" className="text-[10px]">
            复用既有口径
          </Badge>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">起（T+n）</Label>
          <Input
            className="h-8"
            value={from}
            onChange={(e) => onChange({ [fromKey]: e.target.value } as Partial<CreateAnalysisFormState>)}
            placeholder="0 = 事件日"
          />
          <p className="text-[11px] text-muted-foreground">
            {reuses ? WINDOW_ANCHOR_LABEL : "锚在此日收盘"}
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">止（T+n）</Label>
          <Input
            className="h-8"
            value={to}
            onChange={(e) => onChange({ [toKey]: e.target.value } as Partial<CreateAnalysisFormState>)}
          />
          <p className="text-[11px] text-muted-foreground">{spaceHint}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">统计口径</Label>
          <Select
            value={stat}
            onValueChange={(v) => onChange({ [statKey]: v } as Partial<CreateAnalysisFormState>)}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEGMENT_STAT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                  <span className="ml-1 text-xs text-muted-foreground">{o.hint}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {/* 把口径摊开：同一个「前 5 日最大跌幅」，锚在 T 与锚在 T+1 是两个不同的变量 */}
      <p className="text-[11px] text-muted-foreground">
        实际使用的变量：<span className="font-mono">{variable}</span>
        {reuses ? "（Dataset 既有口径，除以事件日收盘）" : "（以本窗起点收盘为基准）"}
      </p>
    </div>
  );
}

export function CreateAnalysisDialog({
  datasetVersionId,
  runId,
  onCreated,
}: {
  datasetVersionId: number;
  runId: number;
  onCreated?: (analysisId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateAnalysisFormState>(() => createDefaultAnalysisForm("QUANTILE"));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const variables = trpc.researchEngine.listVariables.useQuery(
    { datasetVersionId },
    { enabled: open && datasetVersionId > 0 },
  );

  const segmentRange = variables.data?.datasetVersion?.pathRelativeDayRange ?? null;

  const catalog: AnalysisFormCatalog = useMemo(
    () => ({
      features: variables.data?.features ?? [],
      outcomes: variables.data?.outcomes ?? [],
      dimensions: variables.data?.dimensions ?? [],
      segmentRange,
    }),
    [variables.data, segmentRange],
  );

  const req = analysisFormRequirements(form.analysisType);

  /** 字段更新（窄化 setForm 的样板）。 */
  function update(next: Partial<CreateAnalysisFormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  // 目录到位后填入推荐默认值（只在用户还没选时）
  //
  // ⚠️ 分段窗**不在这里播种**：窗值一旦被这个 effect 重置，用户在
  //    catalog 重取（React Query 命中新引用）时输入就会被悄悄抹掉。
  //    窗的初值只在「切到 SEGMENT_RELATION」那一刻按当前 segmentRange 给一次（见 switchType）。
  useEffect(() => {
    if (!open || !variables.data) return;
    setForm((prev) => {
      const next = { ...prev };
      if (req.needsFeature && !prev.featureField) next.featureField = recommendFeatureField(catalog.features);
      if (req.needsTarget && !prev.targetField) next.targetField = recommendTargetField(catalog.outcomes);
      if (req.needsHorizons && prev.horizons.length === 0) {
        const hs = availableFutureReturnHorizons(catalog.outcomes);
        next.horizons = hs.includes(5) ? [5] : hs.slice(0, 1);
      }
      return next;
    });
  }, [
    open,
    variables.data,
    req.needsFeature,
    req.needsTarget,
    req.needsHorizons,
    catalog.features,
    catalog.outcomes,
  ]);

  const errors = useMemo(() => validateAnalysisForm(form, catalog), [form, catalog]);
  const conditionCount = useMemo(
    () =>
      form.conditions.reduce(
        (sum, g) => sum + g.conditions.filter((c) => c.fieldName.trim() !== "").length,
        0,
      ),
    [form.conditions],
  );
  const horizonOptions = useMemo(
    () => availableFutureReturnHorizons(catalog.outcomes),
    [catalog.outcomes],
  );

  const createAnalysis = trpc.researchEngine.createAnalysis.useMutation();
  const utils = trpc.useUtils();
  const busy = createAnalysis.isPending;

  const suggestedName = suggestAnalysisName(form);
  const finalName = form.name.trim() || suggestedName;

  function reset() {
    setForm(createDefaultAnalysisForm("QUANTILE"));
    setAdvancedOpen(false);
    setSubmitError(null);
  }

  function switchType(type: ImplementedAnalysisType) {
    setForm((prev) => {
      // 切到分段关系时按**真实的 path 视界**给一组默认窗（A=[0,5] → B=[5,上界]）；
      // 其余类型保留用户已填的窗，便于来回切换时不丢输入。
      const seed =
        type === "SEGMENT_RELATION"
          ? defaultSegmentWindows(segmentRange)
          : {
              aFrom: prev.windowAFrom,
              aTo: prev.windowATo,
              bFrom: prev.windowBFrom,
              bTo: prev.windowBTo,
            };
      const fresh = createDefaultAnalysisForm(type, {
        featureField: prev.featureField,
        targetField: prev.targetField,
        segmentWindows: seed,
      });
      return { ...fresh, name: "", variables: prev.variables, horizons: prev.horizons };
    });
    setAdvancedOpen(false);
  }

  /**
   * 套用内置示例：类型 / 变量 / 条件 / 窗一次性填好。
   * 刻意**不动** `name` —— 让建议名按最终参数生成，避免「名字说的是 A、参数是 B」。
   */
  function applyExample(example: AnalysisExample) {
    setForm(applyAnalysisExample(example, segmentRange));
    setAdvancedOpen(false);
    setSubmitError(null);
  }

  async function handleSubmit() {
    if (errors.length > 0) return;
    setSubmitError(null);
    try {
      const name = finalName;
      const conditions = toAnalysisConditions(form);
      const analysis = await createAnalysis.mutateAsync({
        runId,
        analysisType: form.analysisType,
        name,
        ...(toAnalysisTarget(form) !== undefined ? { target: toAnalysisTarget(form)! } : {}),
        config: toAnalysisConfig(form),
        ...(conditions.length > 0 ? { conditions } : {}),
      });
      await utils.researchEngine.getRun.invalidate();
      await utils.researchEngine.listAnalyses.invalidate();
      toast.success(`分析已创建：#${analysis.id}`, { description: name });
      setOpen(false);
      reset();
      onCreated?.(analysis.id!);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  }

  const diagnostic = submitError ? rpcErrorToDiagnostic(submitError) : null;
  const catalogReady = variables.data !== undefined;
  const option = analysisTypeOptionOf(form.analysisType);
  const requiredConditions = req.canHaveConditions && req.requiresConditions;
  const optionalConditions = req.canHaveConditions && !req.requiresConditions;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-1.5 h-4 w-4" /> 新建分析
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sigma className="h-4 w-4" /> 新建分析
          </DialogTitle>
          <DialogDescription>
            分析属于当前 Run。变量选项来自这个 Dataset 版本真实存在的数据（
            {variables.data
              ? `${catalog.features.length} 个 T 日可观测变量 / ${catalog.outcomes.length} 个未来结果变量`
              : "加载中…"}
            ）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {variables.data && (
            <div className="space-y-2">
              <SectionTitle
                index="⓪"
                title="从例子开始（可选）"
                hint="点一下就把下面的参数全部填好；也可以完全跳过，自己配。"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {ANALYSIS_EXAMPLES.map((example) => {
                  const missing = missingVariablesForExample(example, {
                    features: catalog.features,
                    outcomes: catalog.outcomes,
                  });
                  const disabled = missing.length > 0;
                  return (
                    <button
                      key={example.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => applyExample(example)}
                      className={`rounded-md border p-2 text-left text-xs transition-colors ${
                        disabled
                          ? "cursor-not-allowed opacity-55"
                          : "hover:border-primary hover:bg-muted/40"
                      }`}
                    >
                      <span className="block font-medium">{example.title}</span>
                      <span className="mt-0.5 block text-muted-foreground">{example.story}</span>
                      {disabled && (
                        <span className="mt-1 block text-[10px] text-amber-700">
                          本 Dataset 缺少：{missing.join("、")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <SectionTitle index="①" title="你想回答什么问题" hint="选一句最贴近的问题，参数会按它来展开。" />
            <div className="grid gap-2 sm:grid-cols-2">
              {ANALYSIS_TYPE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => switchType(o.value)}
                  className={`rounded-md border p-2 text-left text-xs transition-colors ${
                    form.analysisType === o.value ? "border-primary bg-muted/60" : "hover:bg-muted/40"
                  }`}
                >
                  <span className="block font-medium">{o.question}</span>
                  <span className="mt-0.5 block text-muted-foreground">{o.hint}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground/80">
                    类型：{o.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {!catalogReady && open && (
            <p className="text-xs text-muted-foreground">
              {variables.isLoading ? "正在读取变量目录…" : "变量目录不可用，请检查 Dataset 版本状态。"}
            </p>
          )}

          {catalogReady && (
            <>
              <div className="space-y-3">
                <SectionTitle
                  index="②"
                  title="需要哪些参数"
                  hint={
                    form.analysisType === "SEGMENT_RELATION"
                      ? "把行情切成先后两段：前一段用来分档，后一段用来看表现。两段不能重叠。"
                      : "只有这类分析必填的字段会出现在这里。"
                  }
                />

                {req.needsSegmentWindows && (
                  <div className="space-y-2">
                    <WindowEditor
                      title="窗 A（用来分档的那一段）"
                      role="A"
                      state={form}
                      onChange={update}
                      spaceHint={
                        segmentRange ? `可用范围 T+${segmentRange.min}..T+${segmentRange.max}` : "无 path 数据"
                      }
                    />
                    <WindowEditor
                      title="窗 B（要看的后一段）"
                      role="B"
                      state={form}
                      onChange={update}
                      spaceHint={
                        segmentRange ? `可用范围 T+${segmentRange.min}..T+${segmentRange.max}` : "无 path 数据"
                      }
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="analysis-bands">窗 A 分几档</Label>
                        <Input
                          id="analysis-bands"
                          type="number"
                          min={2}
                          max={100}
                          value={form.windowBands}
                          onChange={(e) => update({ windowBands: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          相同取值不会被拆到不同档，实际档数可能少于设定值（结果会如实说明）。
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  {req.needsFeature && (
                    <div className="space-y-1.5">
                      <Label htmlFor="analysis-feature">分组依据（T 日就能看到的变量）</Label>
                      <Select value={form.featureField} onValueChange={(v) => update({ featureField: v })}>
                        <SelectTrigger id="analysis-feature">
                          <SelectValue placeholder="选择变量" />
                        </SelectTrigger>
                        <SelectContent>
                          {catalog.features.map((f) => (
                            <SelectItem key={f} value={f}>
                              {variableLabelOf(f)}
                              <span className="ml-1 font-mono text-xs text-muted-foreground">{f}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {req.needsTarget && (
                    <div className="space-y-1.5">
                      <Label htmlFor="analysis-target">要看的未来结果</Label>
                      <Select value={form.targetField} onValueChange={(v) => update({ targetField: v })}>
                        <SelectTrigger id="analysis-target">
                          <SelectValue placeholder="选择结果变量" />
                        </SelectTrigger>
                        <SelectContent>
                          {catalog.outcomes.map((o) => (
                            <SelectItem key={o} value={o}>
                              {variableLabelOf(o)}
                              <span className="ml-1 font-mono text-xs text-muted-foreground">{o}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {req.needsQuantileGroups && (
                    <div className="space-y-1.5">
                      <Label htmlFor="analysis-groups">分几档</Label>
                      <Input
                        id="analysis-groups"
                        type="number"
                        min={2}
                        max={100}
                        value={form.quantileGroups}
                        onChange={(e) => update({ quantileGroups: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        相同取值不会被拆到不同档，实际档数可能少于设定值（结果会如实说明）。
                      </p>
                    </div>
                  )}

                  {req.needsDimension && (
                    <div className="space-y-1.5">
                      <Label htmlFor="analysis-dimension">按什么分组检验</Label>
                      <Select value={form.stabilityDimension} onValueChange={(v) => update({ stabilityDimension: v })}>
                        <SelectTrigger id="analysis-dimension">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {catalog.dimensions.map((d) => (
                            <SelectItem key={d} value={d}>
                              {DIMENSION_LABELS[d] ?? d}
                              <span className="ml-1 font-mono text-xs text-muted-foreground">{d}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {(variables.data?.unavailableDimensions ?? []).map((u) => (
                        <p key={u.key} className="text-xs text-muted-foreground">
                          维度 <span className="font-mono">{u.key}</span> 不可用：{u.reason}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {req.needsVariables && (
                  <div className="space-y-1.5">
                    <Label>要统计哪些变量（可多选）</Label>
                    <ScrollArea className="h-44 rounded-md border p-2">
                      {["T 日可观测", "未来结果"].map((group) => {
                        const items = group === "T 日可观测" ? catalog.features : catalog.outcomes;
                        return (
                          <div key={group} className="mb-2">
                            <p className="px-1 py-1 text-xs text-muted-foreground">{group}</p>
                            {items.map((name) => {
                              const checked = form.variables.includes(name);
                              return (
                                <label
                                  key={name}
                                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(nextVal) =>
                                      update({
                                        variables: nextVal
                                          ? [...form.variables, name]
                                          : form.variables.filter((v) => v !== name),
                                      })
                                    }
                                  />
                                  <span>{variableLabelOf(name)}</span>
                                  <span className="font-mono text-muted-foreground">{name}</span>
                                </label>
                              );
                            })}
                          </div>
                        );
                      })}
                    </ScrollArea>
                    <p className="text-xs text-muted-foreground">已选 {form.variables.length} 个变量</p>
                  </div>
                )}

                {req.needsHorizons && (
                  <div className="space-y-1.5">
                    <Label>看事件后的哪几天（T+N）</Label>
                    <div className="flex flex-wrap gap-2">
                      {horizonOptions.map((h) => {
                        const checked = form.horizons.includes(h);
                        return (
                          <label
                            key={h}
                            className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                              checked ? "border-primary bg-muted/60" : ""
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(nextVal) =>
                                update({
                                  horizons: nextVal
                                    ? [...form.horizons, h].sort((a, b) => a - b)
                                    : form.horizons.filter((x) => x !== h),
                                })
                              }
                            />
                            T+{h}
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      可选视界来自这个 Dataset 真实存在的天数；MFE / MAE / 最大回撤只在它们存在的视界产出。
                    </p>
                  </div>
                )}

                {requiredConditions && (
                  <ConditionGroupsEditor
                    groups={form.conditions}
                    onChange={(next) => update({ conditions: next })}
                    catalog={catalog}
                    title="条件（必填）"
                  />
                )}
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  <span className="space-y-0.5">
                    <span className="block text-xs font-medium">
                      <span className="mr-1.5 text-muted-foreground">③</span>
                      高级设置（默认不需要动）
                      {optionalConditions && (
                        <span className="ml-2 text-muted-foreground">
                          {conditionCount > 0 ? `已设 ${conditionCount} 条条件` : "未设条件"}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      分析名称（留空将自动命名）、以及可选的样本条件。
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                      advancedOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {advancedOpen && (
                  <div className="space-y-3 border-t pt-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="analysis-name">分析名称</Label>
                      <Input
                        id="analysis-name"
                        value={form.name}
                        onChange={(e) => update({ name: e.target.value })}
                        placeholder={suggestedName}
                        maxLength={200}
                      />
                      <p className="text-xs text-muted-foreground">
                        留空将命名为「{suggestedName}」
                      </p>
                    </div>

                    {optionalConditions && (
                      <ConditionGroupsEditor
                        groups={form.conditions}
                        onChange={(next) => update({ conditions: next })}
                        catalog={catalog}
                        title="样本条件（可选）"
                        hint="不设条件 = 用全部样本；加了条件就只看满足条件的样本。"
                      />
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {errors.length > 0 && (
            <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {errors.map((e) => (
                <li key={e} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          )}

          {diagnostic && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
              <p className="font-medium">{diagnostic.title}</p>
              <p className="mt-0.5">{diagnostic.explanation}</p>
              {diagnostic.suggestions && diagnostic.suggestions.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {diagnostic.suggestions.map((s) => (
                    <li key={s}>· {s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto max-w-[60%] truncate text-xs text-muted-foreground">
            {option ? `将创建：${finalName}` : ""}
          </span>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={errors.length > 0 || busy || !catalogReady}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            创建分析
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
