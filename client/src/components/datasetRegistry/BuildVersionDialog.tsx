/**
 * BuildVersionDialog — 「构建新版本」入口（STEP DATASET-002.4B / 003B）。
 *
 * 整合说明：旧 `/dataset-builder` 的「配置窗口 + 构建参数 + 一键构建」能力迁移到
 * Dataset Registry（新架构，以新为准）。本组件只做**传输形态**与**编排**：
 *   1) createDatasetVersion（admin）→ 建逻辑版本 DRAFT，并固化**筛选配置 + 执行参数**；
 *   2) （可选）createBuildJob（admin）→ PENDING；
 *   3) （可选）startBuildJob（admin）→ RUNNING，后台执行器真实写 ds_* 物理表。
 *
 * DATASET-003B 变更（筛选能力补齐）：
 *   - 新增完整筛选面板：板块多选 / 排除 ST / 事件维度（相对日 × 事件类型，可多选）/ t 前后窗口；
 *   - **构建门禁**：筛选配置未通过校验时，提交按钮禁用（「只有在完成筛选条件配置后，才能构建」）；
 *   - 原有 pathHorizon / outcomeHorizons / batchSize 收敛：`pathHorizon` → `postWindowDays`，
 *     outcomeHorizons / batchSize 移入「高级执行参数」折叠区（非筛选维度）。
 *
 * 纪律：
 *   - 语义合法性由后端权威校验（契约 `createDatasetVersionInputSchema` + service `normalizeBuildFilter`），
 *     本组件的前端校验（`datasetFilterForm.validateFilterForm`）只是尽早反馈，**不放松**后端口径；
 *   - 版本标签正则复用 `@shared/datasetRegistryContracts.DATASET_VERSION_LABEL_PATTERN`（防漂移）；
 *   - 默认值取 `DATASET_BUILD_FILTER_DEFAULTS`（同源权威默认）；
 *   - 不在此处臆造进度 / 状态；构建进度一律以 VersionDetail 轮询后端为准。
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Hammer, ChevronDown, Plus, Trash2, Filter } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  DATASET_BUILD_FILTER_LIMITS,
  DATASET_VERSION_LABEL_PATTERN,
} from "@shared/datasetRegistryContracts";
import {
  addEventRow,
  boardOptions,
  buildFilterPayload,
  createDefaultFilterForm,
  describeFilterForm,
  eventKindOptions,
  formatEventRow,
  relativeDayOptions,
  removeEventRow,
  toggleBoard,
  updateEventRow,
  validateFilterForm,
  type DatasetFilterFormState,
} from "./datasetFilterForm";

/** 从既有版本标签推断下一个建议标签（全部为 v{n} → max+1；否则 count+1）。 */
export function suggestNextVersion(existing: string[]): string {
  if (existing.length === 0) return "v1";
  const nums: number[] = [];
  let allNumeric = true;
  for (const label of existing) {
    const m = /^v(\d+)$/.exec(label);
    if (m) nums.push(Number(m[1]));
    else allNumeric = false;
  }
  if (allNumeric && nums.length === existing.length) return `v${Math.max(...nums) + 1}`;
  return `v${existing.length + 1}`;
}

export interface BuildVersionDialogProps {
  datasetId: number;
  datasetCode: string;
  /** 该定义下已有版本标签（用于建议下一个 version）。 */
  existingVersions: string[];
  /** 版本创建并（可选）启动构建成功后回调（通常用于跳转 / 刷新）。 */
  onCreated?: (versionId: number) => void;
  /** 自定义触发按钮；缺省为「构建新版本」主按钮。 */
  trigger?: React.ReactNode;
}

export function BuildVersionDialog({
  datasetId,
  datasetCode,
  existingVersions,
  onCreated,
  trigger,
}: BuildVersionDialogProps) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(() => suggestNextVersion(existingVersions));
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startImmediately, setStartImmediately] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [form, setForm] = useState<DatasetFilterFormState>(() => createDefaultFilterForm());

  const createVersion = trpc.datasetRegistry.createDatasetVersion.useMutation();
  const createJob = trpc.datasetRegistry.createBuildJob.useMutation();
  const startJob = trpc.datasetRegistry.startBuildJob.useMutation();
  const busy = createVersion.isPending || createJob.isPending || startJob.isPending;

  function patchForm(patch: Partial<DatasetFilterFormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  /** 筛选配置校验（构建门禁：非空即不得提交）。 */
  const filterError = useMemo(() => validateFilterForm(form), [form]);

  const localError = useMemo(() => {
    if (!version) return "请填写版本标签";
    if (!DATASET_VERSION_LABEL_PATTERN.test(version)) {
      return "version 须为 1..32 位字母/数字/._-，且以字母或数字开头";
    }
    if (existingVersions.includes(version)) return `版本 ${version} 已存在，请更换`;
    if (!startDate || !endDate) return "请填写构建窗口起止日期";
    if (startDate > endDate) return "起始日期不能晚于结束日期";
    if (filterError) return filterError;
    return null;
  }, [version, existingVersions, startDate, endDate, filterError]);

  const filterSummary = useMemo(() => describeFilterForm(form), [form]);

  async function onSubmit() {
    if (localError) {
      toast.error(localError);
      return;
    }
    try {
      const created = await createVersion.mutateAsync({
        datasetId,
        version: version.trim(),
        startDate,
        endDate,
        filter: buildFilterPayload(form),
      });

      await utils.datasetRegistry.getDefinition.invalidate({ definitionId: datasetId });
      await utils.datasetRegistry.listVersions.invalidate({ datasetId });

      if (startImmediately) {
        const job = await createJob.mutateAsync({ datasetVersionId: created.id });
        await startJob.mutateAsync({ jobId: job.jobId });
        toast.success(`版本 ${created.version} 已创建并开始构建（作业 ${job.jobId}）`);
      } else {
        toast.success(`版本 ${created.version} 已创建（DRAFT），可稍后手动开始构建`);
      }

      setOpen(false);
      resetForm();
      onCreated?.(created.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  function resetForm() {
    setVersion(suggestNextVersion(existingVersions));
    setStartDate("");
    setEndDate("");
    setStartImmediately(true);
    setAdvancedOpen(false);
    setForm(createDefaultFilterForm());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setVersion(suggestNextVersion(existingVersions));
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-1.5">
            <Hammer className="h-3.5 w-3.5" /> 构建新版本
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hammer className="h-4 w-4" /> 构建新版本
          </DialogTitle>
          <DialogDescription>
            为数据集 <span className="font-mono">{datasetCode}</span> 创建逻辑版本，并固化筛选条件与构建参数。
            {startImmediately ? "创建后将立即启动后台构建（真实写入物理表）。" : "本次仅创建版本，不立即构建。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="bv-version" className="text-xs">
                版本标签
              </Label>
              <Input
                id="bv-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="v3"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bv-start" className="text-xs">
                起始日期
              </Label>
              <Input
                id="bv-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bv-end" className="text-xs">
                结束日期
              </Label>
              <Input
                id="bv-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* ============ 筛选条件（必填，构建门禁）============ */}
          <div className="space-y-4 rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Filter className="h-3.5 w-3.5" /> 筛选条件
              <span className="text-muted-foreground">（必填，未通过校验不可构建）</span>
            </div>

            {/* 板块 */}
            <div className="space-y-1.5">
              <Label className="text-xs">
                板块
                <span className="ml-1 text-muted-foreground">（不勾选 = 全板块，含无法归类的）</span>
              </Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {boardOptions().map((opt) => (
                  <div key={opt.value} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`bv-board-${opt.value}`}
                      checked={form.boards.includes(opt.value)}
                      onCheckedChange={() => patchForm({ boards: toggleBoard(form.boards, opt.value) })}
                    />
                    <Label htmlFor={`bv-board-${opt.value}`} className="text-xs font-normal">
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* 排除 ST */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="bv-exclude-st"
                checked={form.excludeSt}
                onCheckedChange={(v) => patchForm({ excludeSt: v === true })}
              />
              <Label htmlFor="bv-exclude-st" className="text-xs font-medium">
                排除 ST / *ST（按当日 PIT 状态，不依赖股票名称）
              </Label>
            </div>

            {/* 事件维度 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  事件维度
                  <span className="ml-1 text-muted-foreground">
                    （相对日 × 事件类型，多条为「或」；最多 {DATASET_BUILD_FILTER_LIMITS.maxEvents} 条）
                  </span>
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={form.events.length >= DATASET_BUILD_FILTER_LIMITS.maxEvents}
                  onClick={() => patchForm({ events: addEventRow(form.events) })}
                >
                  <Plus className="h-3.5 w-3.5" /> 添加
                </Button>
              </div>
              <div className="space-y-2">
                {form.events.map((row) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <Select
                      value={row.relativeDay}
                      onValueChange={(v) => patchForm({ events: updateEventRow(form.events, row.key, { relativeDay: v }) })}
                    >
                      <SelectTrigger className="w-[150px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {relativeDayOptions().map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={row.kind}
                      onValueChange={(v) =>
                        patchForm({ events: updateEventRow(form.events, row.key, { kind: v as never }) })
                      }
                    >
                      <SelectTrigger className="w-[130px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {eventKindOptions().map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="font-mono text-[11px] text-muted-foreground">{formatEventRow(row)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={form.events.length <= 1}
                      onClick={() => patchForm({ events: removeEventRow(form.events, row.key) })}
                      aria-label="删除该事件维度"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                「T 日」= 事件日当天判定；「T-1 日」= 前一交易日判定（如 T-1 首板、T 日作为观察起点）。
                锚点永远不晚于事件日（不存在未来锚点）。
              </p>
            </div>

            {/* 数据天数范围 */}
            <div className="space-y-1.5">
              <Label className="text-xs">数据天数范围（交易日）</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="bv-pre" className="text-[11px] font-normal text-muted-foreground">
                    t 日之前 {DATASET_BUILD_FILTER_LIMITS.preWindowDays.min}..
                    {DATASET_BUILD_FILTER_LIMITS.preWindowDays.max}
                  </Label>
                  <Input
                    id="bv-pre"
                    type="number"
                    min={DATASET_BUILD_FILTER_LIMITS.preWindowDays.min}
                    max={DATASET_BUILD_FILTER_LIMITS.preWindowDays.max}
                    value={form.preWindowDays}
                    onChange={(e) => patchForm({ preWindowDays: e.target.value })}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bv-post" className="text-[11px] font-normal text-muted-foreground">
                    t 日之后 {DATASET_BUILD_FILTER_LIMITS.postWindowDays.min}..
                    {DATASET_BUILD_FILTER_LIMITS.postWindowDays.max}
                  </Label>
                  <Input
                    id="bv-post"
                    type="number"
                    min={DATASET_BUILD_FILTER_LIMITS.postWindowDays.min}
                    max={DATASET_BUILD_FILTER_LIMITS.postWindowDays.max}
                    value={form.postWindowDays}
                    onChange={(e) => patchForm({ postWindowDays: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                物化的相对日区间 = t−{form.preWindowDays || 0} .. t+{form.postWindowDays || 0}（相对事件日）。
              </p>
            </div>

            <p className="rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
              筛选摘要：{filterSummary}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="bv-start-now"
              checked={startImmediately}
              onCheckedChange={(v) => setStartImmediately(v === true)}
            />
            <Label htmlFor="bv-start-now" className="text-xs font-medium">
              创建后立即开始构建
            </Label>
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                />
                高级执行参数（非筛选维度）
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bv-oh" className="text-xs">
                    结果视界（逗号分隔，交易日）
                  </Label>
                  <Input
                    id="bv-oh"
                    value={form.outcomeHorizons}
                    onChange={(e) => patchForm({ outcomeHorizons: e.target.value })}
                    placeholder="5,10,20"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bv-bs" className="text-xs">
                    批大小
                  </Label>
                  <Input
                    id="bv-bs"
                    type="number"
                    min={1}
                    max={10000}
                    value={form.batchSize}
                    onChange={(e) => patchForm({ batchSize: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                参数在创建版本时一并固化，后续构建按此执行（可在版本详情页查看）。
              </p>
            </CollapsibleContent>
          </Collapsible>

          {localError && <p className="text-xs text-amber-700 dark:text-amber-500">{localError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={busy || !!localError}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {startImmediately ? "创建并构建" : "创建版本"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
