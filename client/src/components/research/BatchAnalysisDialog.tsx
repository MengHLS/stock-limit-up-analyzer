/**
 * BatchAnalysisDialog — 「批量新建分析」（RESEARCH-002C）。
 *
 * 触发问题：用户「我需要手动建立很多分析，有没有什么办法可以减少这个过程」。
 * 单个分析一次填表在研究里是纯粹的重复劳动，本对话框把三条路径收敛到一处：
 *
 *   1. **矩阵**：勾类型 / 目标 / 视界 / 维度，一次提交展开成 `类型 × 目标 …`；
 *   2. **标准套件**：选一个特征 + 一个目标，铺开一套标准分析组合；
 *   3. **例子**：内置示例（研究问题式标题 + 已配好的参数），点一下直接建到当前 Run，
 *      也可一键存成模板；与单建表单的「从例子开始」共用同一份 `ANALYSIS_EXAMPLES`；
 *   4. **我的模板**：把常用组合存下来，跨实验一键铺开。
 *
 * 三条纪律（与纯函数层 `analysisBatchForm.ts` 配套）：
 *
 *   - **一律先摊开清单再确认**。三个 Tab 底部都有同一块预览清单（「将创建 N 个分析」），
 *     套件与模板尤其不能静默铺开 —— 套件会替用户做一部分研究设计，必须让人看见。
 *   - **不静默少建**。缺输入的类型被跳过时，如实列出「哪个类型因为什么没生成」；
 *     超过单批上限时也明确写出被截断的数量。
 *   - **结果如实回显**。服务端返回的 `created` / `failed` 各自带下标，逐条列出来；
 *     预检失败（整批拒绝）时明说「一个都没有创建」，绝不让人以为是建了一半。
 *
 * 刻意**不动**既有的 `CreateAnalysisDialog`（单建路径已稳定且被多处复用），
 * 二者在 UI 上并存：一个「新建分析」、一个「批量新建」。
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, Loader2, ListPlus, Plus, Sigma, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  rpcErrorToDiagnostic,
  toAnalysisTemplateVms,
  variableLabelOf,
  type AnalysisTemplateVm,
} from "@/adapters/researchEngineAdapter";
import { ConditionGroupsEditor } from "./ConditionGroupsEditor";
import {
  ANALYSIS_EXAMPLES,
  ANALYSIS_TYPE_OPTIONS,
  analysisTypeOptionOf,
  applyAnalysisExample,
  availableFutureReturnHorizons,
  missingVariablesForExample,
  type AnalysisFormCatalog,
} from "./createAnalysisForm";
import {
  MAX_BATCH_ITEMS,
  MATRIX_ANALYSIS_TYPES,
  buildSuitePlan,
  createDefaultBatchMatrixForm,
  describeBatchItem,
  expandAnalysisMatrix,
  formStateToBatchItem,
  toBatchCreatePayload,
  validateBatchMatrixForm,
  validateTemplateName,
  type BatchItemDraft,
  type BatchSkippedReason,
} from "./analysisBatchForm";

const DIMENSION_LABELS: Record<string, string> = {
  year: "年度",
  month: "月份",
  quarter: "季度",
  board: "板块",
  market: "市场",
  industry: "行业",
};

function typeLabel(type: string): string {
  return analysisTypeOptionOf(type)?.label ?? type;
}

/**
 * 矩阵的类型多选清单 = 目录里**矩阵能表达**的那些。
 *
 * 过滤依据是 `MATRIX_ANALYSIS_TYPES`（唯一权威），不是在这里手写白名单 ——
 * 否则新增分析类型时，「能建」与「能批量建」两份清单必然漂移。
 */
const MATRIX_TYPE_OPTIONS = ANALYSIS_TYPE_OPTIONS.filter((o) =>
  MATRIX_ANALYSIS_TYPES.some((t) => t === o.value),
);

/**
 * 「把全部示例存为一个模板」用的模板名。
 *
 * 模板名在库里有**唯一索引**（`research_analysis_template_name_unique`），重名会被服务端
 * 拒绝。这里用同一个常量既做保存名、又做「是否已存在」的判据，避免出现
 * 「按钮显示可用、点了却报模板名已存在」。
 */
const EXAMPLE_BUNDLE_TEMPLATE_NAME = "首板涨停：内置示例集合";

/** 多选复选清单（目标变量 / 描述统计变量共用）。 */
function CheckboxList({
  items,
  selected,
  onToggle,
  height = "h-36",
}: {
  items: readonly string[];
  selected: readonly string[];
  onToggle: (name: string, next: boolean) => void;
  height?: string;
}) {
  return (
    <ScrollArea className={`${height} rounded-md border p-2`}>
      {items.map((name) => (
        <label
          key={name}
          className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
        >
          <Checkbox checked={selected.includes(name)} onCheckedChange={(next) => onToggle(name, Boolean(next))} />
          <span>{variableLabelOf(name)}</span>
          <span className="font-mono text-muted-foreground">{name}</span>
        </label>
      ))}
    </ScrollArea>
  );
}

/** 多选小圆片（视界 / 维度共用）。 */
function ChipToggles({
  items,
  selected,
  onToggle,
  labelOf,
}: {
  items: readonly (string | number)[];
  selected: readonly (string | number)[];
  onToggle: (value: string | number, next: boolean) => void;
  labelOf: (value: string | number) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((value) => {
        const checked = selected.includes(value);
        return (
          <label
            key={String(value)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
              checked ? "border-primary bg-muted/60" : ""
            }`}
          >
            <Checkbox checked={checked} onCheckedChange={(next) => onToggle(value, Boolean(next))} />
            {labelOf(value)}
          </label>
        );
      })}
    </div>
  );
}

/** 预览清单 + 跳过说明 + 截断提示（三个 Tab 共用同一块）。 */
function BatchPreview({
  items,
  skipped,
  truncated,
}: {
  items: ReadonlyArray<BatchItemDraft>;
  skipped: ReadonlyArray<BatchSkippedReason>;
  truncated: number;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-medium">
        将创建 <span className="font-mono">{items.length}</span> 个分析
        {items.length === 0 && "（当前没有任何可创建项）"}
      </p>
      {items.length > 0 && (
        <ScrollArea className="h-40">
          <ol className="space-y-1">
            {items.map((item, index) => (
              <li key={`${item.name}-${index}`} className="flex items-start gap-2 text-xs">
                <span className="w-6 shrink-0 text-right font-mono text-muted-foreground">{index + 1}</span>
                <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                  {typeLabel(item.analysisType)}
                </Badge>
                <span className="break-all">{item.name}</span>
              </li>
            ))}
          </ol>
        </ScrollArea>
      )}
      {truncated > 0 && (
        <p className="text-xs text-amber-700">
          已达单批上限 {MAX_BATCH_ITEMS} 个，另有 <span className="font-mono">{truncated}</span> 个未列入本批
          —— 请拆分提交。
        </p>
      )}
      {skipped.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {skipped.map((s) => (
            <li key={s.analysisType} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                <span className="font-medium">{typeLabel(s.analysisType)}</span> 未生成：{s.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 创建结果回显（成功 / 失败逐条列出）。 */
interface BatchOutcome {
  createdCount: number;
  failedCount: number;
  failed: Array<{ index: number; name: string; errorCode: string; errorMessage: string }>;
  templateName?: string;
}

export function BatchAnalysisDialog({
  datasetVersionId,
  experimentId,
  runId,
  onCreated,
}: {
  datasetVersionId: number;
  /** 仅作为模板的溯源信息；缺失时不写 `sourceExperimentId`（不编造）。 */
  experimentId?: number;
  runId: number;
  onCreated?: (createdCount: number) => void;
}) {
  const [open, setOpen] = useState(false);
  // 默认落在「例子 / 我的模板」而不是「矩阵展开」：后者的组合控件最多，但**空手进来
  // 的人不知道该怎么选**；前者一打开就有配好的东西可用（可直接建、也可存成模板），
  // 需要铺开组合时再切到矩阵，成本只是多点一下。
  const [tab, setTab] = useState<"matrix" | "suite" | "template">("template");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BatchOutcome | null>(null);

  const variables = trpc.researchEngine.listVariables.useQuery(
    { datasetVersionId },
    { enabled: open && datasetVersionId > 0 },
  );
  const catalog: AnalysisFormCatalog = useMemo(
    () => ({
      features: variables.data?.features ?? [],
      outcomes: variables.data?.outcomes ?? [],
      dimensions: variables.data?.dimensions ?? [],
    }),
    [variables.data],
  );

  // ---- 矩阵 ----
  const [matrix, setMatrix] = useState(() => createDefaultBatchMatrixForm({ features: [], outcomes: [], dimensions: [] }));
  const [matrixTouched, setMatrixTouched] = useState(false);

  // 目录到位后填一次默认值（用户动过就不再覆盖）
  useEffect(() => {
    if (!open || !variables.data || matrixTouched) return;
    setMatrix(createDefaultBatchMatrixForm(catalog));
  }, [open, variables.data, catalog, matrixTouched]);

  const matrixExpansion = useMemo(() => expandAnalysisMatrix(matrix), [matrix]);
  const matrixErrors = useMemo(() => validateBatchMatrixForm(matrix), [matrix]);

  // ---- 套件 ----
  const [suiteFeature, setSuiteFeature] = useState("");
  const [suiteTarget, setSuiteTarget] = useState("");
  const [suiteConditions, setSuiteConditions] = useState<ReturnType<typeof buildSuitePlan>["state"]["conditions"]>([]);

  useEffect(() => {
    if (!open || !variables.data) return;
    setSuiteFeature((prev) => prev || (catalog.features.includes("turnover") ? "turnover" : catalog.features[0] ?? ""));
    setSuiteTarget((prev) => prev || (catalog.outcomes.includes("future_return_5d") ? "future_return_5d" : catalog.outcomes[0] ?? ""));
  }, [open, variables.data, catalog]);

  const suitePlan = useMemo(
    () =>
      buildSuitePlan({
        featureField: suiteFeature,
        targetField: suiteTarget,
        catalog,
        conditions: suiteConditions,
      }),
    [suiteFeature, suiteTarget, catalog, suiteConditions],
  );
  const suiteExpansion = useMemo(() => expandAnalysisMatrix(suitePlan.state), [suitePlan]);

  // ---- 模板 ----
  const templatesQuery = trpc.researchEngine.listAnalysisTemplates.useQuery(undefined, { enabled: open });
  const templates: AnalysisTemplateVm[] = useMemo(
    () => toAnalysisTemplateVms(templatesQuery.data),
    [templatesQuery.data],
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  useEffect(() => {
    if (templates.length === 0) {
      setSelectedTemplateId(null);
      return;
    }
    setSelectedTemplateId((prev) => (prev !== null && templates.some((t) => t.id === prev) ? prev : templates[0]!.id));
  }, [templates]);
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  // ---- 内置示例（模板页签顶部，点一下直接落到当前 Run）----
  //
  // 为什么把示例也放进这个弹窗：用户「新建分析页看完还是不知道该怎么配」时，
  // 更想要的是**在已有 Run 上直接建好**，而不是先学会单建表单。
  // 示例经 `applyAnalysisExample` → `formStateToBatchItem` 转换，与手动填表同源。
  const segmentRange = variables.data?.datasetVersion?.pathRelativeDayRange ?? null;
  const exampleRows = useMemo(
    () =>
      ANALYSIS_EXAMPLES.map((example) => ({
        example,
        draft: formStateToBatchItem(applyAnalysisExample(example, segmentRange), example.title),
        missing: missingVariablesForExample(example, catalog),
      })),
    [catalog, segmentRange],
  );
  /** 已存在的模板名 —— 模板名有唯一索引，据此把按钮置为「已存为模板」而不是撞库报错。 */
  const templateNames = useMemo(() => new Set(templates.map((t) => t.name)), [templates]);
  /** 正在创建的示例 id —— 只让被点的那张卡转圈（`createBatch` 是共享状态，不能一概而论）。 */
  const [pendingExampleId, setPendingExampleId] = useState<string | null>(null);

  // ---- 存为模板 ----
  const [templateName, setTemplateName] = useState("");
  const templateNameErrors = useMemo(() => validateTemplateName(templateName), [templateName]);

  // ---- mutations ----
  const utils = trpc.useUtils();
  const createBatch = trpc.researchEngine.createAnalyses.useMutation();
  const createTemplate = trpc.researchEngine.createAnalysisTemplate.useMutation();
  const applyTemplate = trpc.researchEngine.applyAnalysisTemplate.useMutation();
  const deleteTemplate = trpc.researchEngine.deleteAnalysisTemplate.useMutation();
  const busy = createBatch.isPending || createTemplate.isPending || applyTemplate.isPending || deleteTemplate.isPending;

  function reset() {
    setSubmitError(null);
    setOutcome(null);
    setTemplateName("");
    setMatrixTouched(false);
  }

  async function refresh() {
    await utils.researchEngine.getRun.invalidate();
    await utils.researchEngine.listAnalyses.invalidate();
    await utils.researchEngine.listAnalysisTemplates.invalidate();
  }

  async function submitItems(items: ReadonlyArray<BatchItemDraft>, templateNameForLabel?: string) {
    setSubmitError(null);
    setOutcome(null);
    try {
      const result = await createBatch.mutateAsync({
        runId,
        items: toBatchCreatePayload(items),
      });
      await refresh();
      setOutcome({
        createdCount: result.createdCount,
        failedCount: result.failedCount,
        failed: result.failed,
        ...(templateNameForLabel ? { templateName: templateNameForLabel } : {}),
      });
      if (result.failedCount === 0) {
        toast.success(`已创建 ${result.createdCount} 个分析`, { description: "未执行 —— 需显式触发整轮执行或补跑" });
        onCreated?.(result.createdCount);
      } else {
        toast.warning(`创建完成：成功 ${result.createdCount} 个，失败 ${result.failedCount} 个`, {
          description: "失败的项已回滚，未留半成品",
        });
        onCreated?.(result.createdCount);
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitTemplateApplication() {
    if (!selectedTemplate) return;
    setSubmitError(null);
    setOutcome(null);
    try {
      const result = await applyTemplate.mutateAsync({ templateId: selectedTemplate.id, runId });
      await refresh();
      setOutcome({
        createdCount: result.createdCount,
        failedCount: result.failedCount,
        failed: result.failed,
        templateName: result.templateName,
      });
      toast.success(`已按模板「${result.templateName}」创建 ${result.createdCount} 个分析`);
      onCreated?.(result.createdCount);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * 存为模板。
   *
   * `explicitName` 供内置示例卡使用（模板名 = 示例标题，一次点击即入库）；
   * 缺省仍读输入框里的 `templateName`（矩阵页签的「存为模板」走这条）。
   * 两条路径的校验与落库完全相同 —— 不另开一条「示例专用」的保存逻辑。
   */
  async function saveAsTemplate(sourceItems: ReadonlyArray<BatchItemDraft>, explicitName?: string) {
    const rawName = explicitName ?? templateName;
    if (validateTemplateName(rawName).length > 0 || sourceItems.length === 0) return;
    const name = rawName.trim();
    setSubmitError(null);
    try {
      const created = await createTemplate.mutateAsync({
        name,
        ...(experimentId !== undefined ? { sourceExperimentId: experimentId } : {}),
        items: toBatchCreatePayload(sourceItems),
      });
      await utils.researchEngine.listAnalysisTemplates.invalidate();
      if (explicitName === undefined) setTemplateName("");
      setSelectedTemplateId(created.id ?? null);
      toast.success(`模板已保存：${created.name}`, { description: `含 ${sourceItems.length} 个分析` });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  }

  const diagnostic = submitError ? rpcErrorToDiagnostic(submitError) : null;
  const catalogReady = variables.data !== undefined;
  const horizonOptions = availableFutureReturnHorizons(catalog.outcomes);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <ListPlus className="mr-1.5 h-4 w-4" /> 批量 / 模板
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sigma className="h-4 w-4" /> 批量 / 模板建分析
          </DialogTitle>
          <DialogDescription>
            一次提交生成一组分析。分析属于某个 Run；变量选项来自当前 Dataset 版本的真实视界
            {variables.data
              ? `（${catalog.features.length} 个特征 / ${catalog.outcomes.length} 个结果变量）`
              : "（加载中…）"}。
            <span className="mt-1 block text-amber-700">
              批量创建**只建不跑**：建完仍需显式触发整轮执行或补跑；补跑批次不生成结论（本批不产结论）。
            </span>
          </DialogDescription>
        </DialogHeader>

        {!catalogReady && open && (
          <p className="text-xs text-muted-foreground">
            {variables.isLoading ? "正在读取变量目录…" : "变量目录不可用，请检查 Dataset 版本状态。"}
          </p>
        )}

        {catalogReady && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="matrix">矩阵展开</TabsTrigger>
              <TabsTrigger value="suite">标准套件</TabsTrigger>
              <TabsTrigger value="template">例子 / 我的模板</TabsTrigger>
            </TabsList>

            {/* ------------------------------ 矩阵 ------------------------------ */}
            <TabsContent value="matrix" className="space-y-4">
              <div className="space-y-1.5">
                <Label>分析类型（可多选）</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {MATRIX_TYPE_OPTIONS.map((o) => {
                    const checked = matrix.analysisTypes.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => {
                          setMatrixTouched(true);
                          setMatrix((prev) => ({
                            ...prev,
                            analysisTypes: checked
                              ? prev.analysisTypes.filter((t) => t !== o.value)
                              : [...prev.analysisTypes, o.value],
                          }));
                        }}
                        className={`rounded-md border p-2 text-left text-xs transition-colors ${
                          checked ? "border-primary bg-muted/60" : "hover:bg-muted/40"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 font-medium">
                          <span
                            aria-hidden="true"
                            className={`inline-block h-3.5 w-3.5 shrink-0 rounded-sm border ${
                              checked ? "border-primary bg-primary" : "border-muted-foreground/40"
                            }`}
                          />
                          {o.label}
                          {o.primaryPriority !== null && (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              主分析 {o.primaryPriority}
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-muted-foreground">{o.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="batch-feature">特征变量（分位分析用，T 日可观测）</Label>
                  <select
                    id="batch-feature"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={matrix.featureField}
                    onChange={(e) => {
                      setMatrixTouched(true);
                      setMatrix((prev) => ({ ...prev, featureField: e.target.value }));
                    }}
                  >
                    <option value="">（未选择）</option>
                    {catalog.features.map((f) => (
                      <option key={f} value={f}>
                        {variableLabelOf(f)}（{f}）
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="batch-groups">分位分组数</Label>
                  <Input
                    id="batch-groups"
                    type="number"
                    min={2}
                    max={100}
                    value={matrix.quantileGroups}
                    onChange={(e) => {
                      setMatrixTouched(true);
                      setMatrix((prev) => ({ ...prev, quantileGroups: e.target.value }));
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>目标变量（可多选；分位 / 条件 / 稳定性 各生成一项）</Label>
                <CheckboxList
                  items={catalog.outcomes}
                  selected={matrix.targetFields}
                  onToggle={(name, next) => {
                    setMatrixTouched(true);
                    setMatrix((prev) => ({
                      ...prev,
                      targetFields: next
                        ? [...prev.targetFields, name]
                        : prev.targetFields.filter((t) => t !== name),
                    }));
                  }}
                />
              </div>

              {horizonOptions.length > 0 && (
                <div className="space-y-1.5">
                  <Label>事件研究视界（T+N，可多选；只生成一项）</Label>
                  <ChipToggles
                    items={horizonOptions}
                    selected={matrix.horizons}
                    labelOf={(v) => `T+${v}`}
                    onToggle={(value, next) => {
                      setMatrixTouched(true);
                      setMatrix((prev) => ({
                        ...prev,
                        horizons: next
                          ? [...prev.horizons, Number(value)].sort((a, b) => a - b)
                          : prev.horizons.filter((h) => h !== Number(value)),
                      }));
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    视界来自 Dataset 的真实 `path.relativeDay`；不硬编码 T+1/3/5/10/20。
                  </p>
                </div>
              )}

              {catalog.dimensions.length > 0 && (
                <div className="space-y-1.5">
                  <Label>稳定性维度（可多选；每 目标 × 维度 各一项）</Label>
                  <ChipToggles
                    items={catalog.dimensions}
                    selected={matrix.stabilityDimensions}
                    labelOf={(v) => DIMENSION_LABELS[String(v)] ?? String(v)}
                    onToggle={(value, next) => {
                      setMatrixTouched(true);
                      setMatrix((prev) => ({
                        ...prev,
                        stabilityDimensions: next
                          ? [...prev.stabilityDimensions, String(value)]
                          : prev.stabilityDimensions.filter((d) => d !== String(value)),
                      }));
                    }}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label>描述统计变量（可多选；全部合成为一项）</Label>
                <CheckboxList
                  items={[...catalog.features, ...catalog.outcomes]}
                  selected={matrix.variables}
                  height="h-28"
                  onToggle={(name, next) => {
                    setMatrixTouched(true);
                    setMatrix((prev) => ({
                      ...prev,
                      variables: next ? [...prev.variables, name] : prev.variables.filter((v) => v !== name),
                    }));
                  }}
                />
              </div>

              <ConditionGroupsEditor
                groups={matrix.conditions}
                onChange={(next) => {
                  setMatrixTouched(true);
                  setMatrix((prev) => ({ ...prev, conditions: next }));
                }}
                catalog={catalog}
                title="条件（可选；填写后条件分析才会计入本批）"
              />

              <BatchPreview
                items={matrixExpansion.items}
                skipped={matrixExpansion.skipped}
                truncated={matrixExpansion.truncated}
              />

              <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                <div className="min-w-[220px] flex-1 space-y-1.5">
                  <Label htmlFor="template-name">把上面这份清单存为模板（可选）</Label>
                  <Input
                    id="template-name"
                    value={templateName}
                    placeholder="例：首板换手率标准检查"
                    maxLength={120}
                    onChange={(e) => setTemplateName(e.target.value)}
                  />
                  {templateName.trim() !== "" && templateNameErrors.length > 0 && (
                    <p className="text-xs text-red-700">{templateNameErrors.join("；")}</p>
                  )}
                </div>
                <Button
                  variant="outline"
                  disabled={busy || templateNameErrors.length > 0 || matrixExpansion.items.length === 0}
                  onClick={() => saveAsTemplate(matrixExpansion.items)}
                >
                  {createTemplate.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="mr-1.5 h-4 w-4" />
                  )}
                  存为模板
                </Button>
              </div>
            </TabsContent>

            {/* ------------------------------ 套件 ------------------------------ */}
            <TabsContent value="suite" className="space-y-4">
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                套件会替你铺开一套**标准**分析（描述统计 / 分位 / 事件研究 / 稳定性 / 条件）。
                它替你做了一部分研究设计，所以下面会把**将创建的每一条**先列出来，确认后再创建。
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="suite-feature">特征变量</Label>
                  <select
                    id="suite-feature"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={suiteFeature}
                    onChange={(e) => setSuiteFeature(e.target.value)}
                  >
                    <option value="">（未选择）</option>
                    {catalog.features.map((f) => (
                      <option key={f} value={f}>
                        {variableLabelOf(f)}（{f}）
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="suite-target">目标变量</Label>
                  <select
                    id="suite-target"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={suiteTarget}
                    onChange={(e) => setSuiteTarget(e.target.value)}
                  >
                    <option value="">（未选择）</option>
                    {catalog.outcomes.map((o) => (
                      <option key={o} value={o}>
                        {variableLabelOf(o)}（{o}）
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <ConditionGroupsEditor
                groups={suiteConditions}
                onChange={setSuiteConditions}
                catalog={catalog}
                title="条件（可选；填了才包含条件分析）"
              />

              <div className="space-y-1 rounded-md border p-3 text-xs">
                <p className="font-medium">套件组成</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  <li>· 描述统计：特征 + 目标的分布</li>
                  <li>· 分位分析：特征分 10 组 → 目标</li>
                  <li>
                    · 事件研究：当前 Dataset 真实存在的视界
                    {suitePlan.state.horizons.length > 0 ? `（${suitePlan.state.horizons.map((h) => `T+${h}`).join(" / ")}）` : "（无）"}
                  </li>
                  <li>
                    · 稳定性分析：按可用维度
                    {suitePlan.state.stabilityDimensions.length > 0
                      ? `（${suitePlan.state.stabilityDimensions.map((d) => DIMENSION_LABELS[d] ?? d).join(" / ")}）`
                      : "（无）"}
                  </li>
                  <li>· 条件分析：仅在填了条件时包含</li>
                </ul>
                {suitePlan.notes.length > 0 && (
                  <ul className="space-y-0.5 text-amber-700">
                    {suitePlan.notes.map((n) => (
                      <li key={n}>⚠ {n}</li>
                    ))}
                  </ul>
                )}
              </div>

              <BatchPreview
                items={suiteExpansion.items}
                skipped={suiteExpansion.skipped}
                truncated={suiteExpansion.truncated}
              />
            </TabsContent>

            {/* ------------------------------ 模板 ------------------------------ */}
            <TabsContent value="template" className="space-y-4">
              {/* ---- 内置示例：点一下直接建到当前 Run ---- */}
              <section className="space-y-2 rounded-md border border-dashed p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-[240px] flex-1">
                    <p className="text-xs font-medium">从例子开始 —— 点一下直接建到当前 Run</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      每张卡是一道配好的研究问题；卡上那行小字就是
                      <span className="font-medium">实际会写进分析的内容</span>
                      （从待建条目反推，不是另抄一份说明）。建完**不自动执行**，仍需显式触发整轮执行或增量补跑。
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || !catalogReady || templateNames.has(EXAMPLE_BUNDLE_TEMPLATE_NAME)}
                    onClick={() => saveAsTemplate(exampleRows.map((row) => row.draft), EXAMPLE_BUNDLE_TEMPLATE_NAME)}
                  >
                    {templateNames.has(EXAMPLE_BUNDLE_TEMPLATE_NAME)
                      ? "示例已存为模板"
                      : "把全部示例存为一个模板"}
                  </Button>
                </div>

                {!catalogReady && (
                  <p className="text-xs text-muted-foreground">正在读取当前 Dataset 的变量目录…</p>
                )}

                {catalogReady && (
                  <div className="grid gap-2 lg:grid-cols-2">
                    {exampleRows.map(({ example, draft, missing }) => {
                      const blocked = missing.length > 0;
                      const saved = templateNames.has(example.title);
                      return (
                        <div key={example.id} className="flex flex-col gap-1.5 rounded-md border p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium leading-snug">{example.title}</p>
                            <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                              {typeLabel(example.analysisType)}
                            </Badge>
                          </div>
                          <p className="text-[11px] leading-relaxed text-muted-foreground">{example.story}</p>
                          <p className="break-all font-mono text-[10px] text-muted-foreground">
                            {describeBatchItem(draft)}
                          </p>
                          {blocked && (
                            <p className="text-[11px] text-amber-700">本 Dataset 缺少：{missing.join(" / ")}</p>
                          )}
                          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-0.5">
                            <Button
                              size="sm"
                              disabled={busy || blocked}
                              onClick={async () => {
                                setPendingExampleId(example.id);
                                try {
                                  await submitItems([draft]);
                                } finally {
                                  setPendingExampleId(null);
                                }
                              }}
                            >
                              {pendingExampleId === example.id ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Plus className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              按此创建
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy || blocked || saved}
                              onClick={() => saveAsTemplate([draft], example.title)}
                            >
                              {saved ? "已存为模板" : "存为模板"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* ---- 我的模板：用户自己存下来的配方 ---- */}
              <section className="space-y-3">
                <p className="text-xs font-medium">我的模板</p>
                {templatesQuery.isLoading && <p className="text-xs text-muted-foreground">正在读取模板…</p>}
                {!templatesQuery.isLoading && templates.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    还没有模板。可以点上面示例卡里的「存为模板」，或在「矩阵展开」页签调好清单后用底部的
                    「存为模板」把这份配方存下来。
                  </p>
                )}

              {templates.length > 0 && (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[240px] flex-1 space-y-1.5">
                      <Label htmlFor="template-pick">选择模板</Label>
                      <select
                        id="template-pick"
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        value={selectedTemplateId ?? ""}
                        onChange={(e) => setSelectedTemplateId(Number(e.target.value))}
                      >
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}（{t.itemCount} 个分析）
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      variant="outline"
                      disabled={busy || !selectedTemplate}
                      onClick={async () => {
                        if (!selectedTemplate) return;
                        try {
                          await deleteTemplate.mutateAsync({ templateId: selectedTemplate.id });
                          await utils.researchEngine.listAnalysisTemplates.invalidate();
                          toast.success(`已删除模板：${selectedTemplate.name}`);
                        } catch (e) {
                          setSubmitError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      {deleteTemplate.isPending ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1.5 h-4 w-4" />
                      )}
                      删除模板
                    </Button>
                  </div>

                  {selectedTemplate && (
                    <div className="space-y-2 rounded-md border p-3">
                      <p className="text-xs">
                        <span className="font-medium">{selectedTemplate.name}</span>
                        {selectedTemplate.description ? ` — ${selectedTemplate.description}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        将创建 <span className="font-mono">{selectedTemplate.itemCount}</span> 个分析：
                      </p>
                      <ScrollArea className="h-40">
                        <ol className="space-y-1">
                          {selectedTemplate.items.map((item) => (
                            <li key={`${item.sortOrder}-${item.name}`} className="flex items-start gap-2 text-xs">
                              <span className="w-6 shrink-0 text-right font-mono text-muted-foreground">
                                {item.sortOrder + 1}
                              </span>
                              <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                                {typeLabel(item.analysisType)}
                              </Badge>
                              <span className="break-all">{item.name}</span>
                            </li>
                          ))}
                        </ol>
                      </ScrollArea>
                      <p className="text-xs text-amber-700">
                        模板里的目标变量 / 特征变量是**保存时**的选择，不会按当前 Dataset 自动改写
                        —— 换数据集后可能失效，服务端会如实报错。
                      </p>
                    </div>
                  )}
                </>
              )}
              </section>
            </TabsContent>
          </Tabs>
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

        {outcome && (
          <div className="rounded-md border px-3 py-2 text-xs">
            <p className="font-medium">
              创建结果：成功 <span className="font-mono text-emerald-700">{outcome.createdCount}</span> 个
              {outcome.failedCount > 0 && (
                <>
                  ，失败 <span className="font-mono text-red-700">{outcome.failedCount}</span> 个
                </>
              )}
            </p>
            {outcome.failedCount === 0 && (
              <p className="mt-0.5 text-muted-foreground">
                未执行。请在该 Run 上点「运行引擎」（整轮）或对新增分析点「补跑」。
              </p>
            )}
            {outcome.failed.length > 0 && (
              <ul className="mt-1 space-y-1">
                {outcome.failed.map((f) => (
                  <li key={`${f.index}-${f.name}`} className="text-red-800">
                    · 第 {f.index + 1} 项「{f.name}」：<span className="font-mono">{f.errorCode}</span> {f.errorMessage}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {tab === "matrix" && `当前清单 ${matrixExpansion.items.length} 个`}
            {tab === "suite" && `当前清单 ${suiteExpansion.items.length} 个`}
            {tab === "template" && (selectedTemplate ? `模板含 ${selectedTemplate.itemCount} 个` : "未选择模板")}
          </span>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            关闭
          </Button>
          {tab === "matrix" && (
            <Button
              disabled={busy || matrixErrors.length > 0 || matrixExpansion.items.length === 0}
              onClick={() => submitItems(matrixExpansion.items)}
            >
              {createBatch.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              创建 {matrixExpansion.items.length} 个分析
            </Button>
          )}
          {tab === "suite" && (
            <Button
              disabled={busy || suiteExpansion.items.length === 0}
              onClick={() => submitItems(suiteExpansion.items)}
            >
              {createBatch.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              创建 {suiteExpansion.items.length} 个分析
            </Button>
          )}
          {tab === "template" && (
            <Button disabled={busy || !selectedTemplate || selectedTemplate.itemCount === 0} onClick={submitTemplateApplication}>
              {applyTemplate.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              按模板创建 {selectedTemplate?.itemCount ?? 0} 个分析
            </Button>
          )}
        </DialogFooter>

        {tab === "matrix" && matrixErrors.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {matrixErrors.map((e) => (
              <li key={e} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{e}</span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
