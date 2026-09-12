/**
 * CreateExperimentDialog — 「新建研究实验」入口（RESEARCH-002 前端工作台）。
 *
 * 编排：
 *   1) 选 Dataset 定义（`datasetRegistry.listDefinitions`）→ 选版本（`getDefinition.versions`）；
 *   2) （可选）同时登记一条假设；
 *   3) `researchEngine.createExperiment`（admin）→ `createHypothesis`（可选）。
 *
 * 关键诚实点：
 *   - **只允许选 READY 版本**。引擎对非 READY 版本抛 `DATASET_VERSION_NOT_READY`，
 *     所以这里把不可用版本显示出来但**禁用**（并写明当前状态），而不是藏起来让用户困惑，
 *     也不是放过去让用户白跑一次。
 *   - 校验失败时**列出全部原因**（`validateExperimentForm` 返回数组），不是逐个挤牙膏。
 *   - 不在此处臆造统计口径：Dataset 版本的事件数直接展示后端值，缺失显示 `—`。
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Loader2, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/common";
import { formatCount, rpcErrorToDiagnostic } from "@/adapters/researchEngineAdapter";
import {
  RESEARCH_TYPE_OPTIONS,
  createDefaultExperimentForm,
  isUsableVersionStatus,
  recommendVersionId,
  suggestHypothesisName,
  toExperimentInput,
  toHypothesisInput,
  validateExperimentForm,
  type VersionOptionLike,
} from "./createExperimentForm";

export function CreateExperimentDialog({
  onCreated,
  defaultDatasetId,
}: {
  onCreated?: (experimentId: number) => void;
  defaultDatasetId?: number | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(createDefaultExperimentForm);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const definitions = trpc.datasetRegistry.listDefinitions.useQuery(undefined, { enabled: open });

  // 预选数据集（从列表页带入）
  useEffect(() => {
    if (!open || !defaultDatasetId || form.datasetId) return;
    setForm((prev) => ({ ...prev, datasetId: String(defaultDatasetId) }));
  }, [open, defaultDatasetId, form.datasetId]);

  // 若只有一个定义，直接选中，省一次点击
  useEffect(() => {
    if (!open || form.datasetId) return;
    const list = definitions.data;
    if (list && list.length === 1) {
      setForm((prev) => ({ ...prev, datasetId: String(list[0]!.id) }));
    }
  }, [open, definitions.data, form.datasetId]);

  const definitionId = Number(form.datasetId);
  const detail = trpc.datasetRegistry.getDefinition.useQuery(
    { definitionId },
    { enabled: open && Number.isFinite(definitionId) && definitionId > 0 },
  );

  const versions: VersionOptionLike[] = useMemo(
    () =>
      (detail.data?.versions ?? []).map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        startDate: v.startDate,
        endDate: v.endDate,
        totalEvents: v.totalEvents,
      })),
    [detail.data],
  );

  // 版本列表到位后推荐一个可用版本（只在用户尚未选择时）
  useEffect(() => {
    if (!open || form.datasetVersionId || versions.length === 0) return;
    const recommended = recommendVersionId(versions);
    if (recommended !== null) {
      setForm((prev) => ({ ...prev, datasetVersionId: String(recommended) }));
    }
  }, [open, versions, form.datasetVersionId]);

  const errors = useMemo(
    () =>
      validateExperimentForm(form, {
        versions,
        definitionSelected: detail.data !== undefined,
      }),
    [form, versions, detail.data],
  );

  const createExperiment = trpc.researchEngine.createExperiment.useMutation();
  const createHypothesis = trpc.researchEngine.createHypothesis.useMutation();
  const utils = trpc.useUtils();

  const busy = createExperiment.isPending || createHypothesis.isPending;

  function reset() {
    setForm(createDefaultExperimentForm());
    setSubmitError(null);
  }

  async function handleSubmit() {
    if (errors.length > 0) return;
    setSubmitError(null);
    try {
      const experiment = await createExperiment.mutateAsync(toExperimentInput(form));
      const experimentId = experiment.id!;
      const hypothesis = toHypothesisInput(form, experimentId);
      if (hypothesis) {
        try {
          await createHypothesis.mutateAsync({
            ...hypothesis,
            name: hypothesis.name || suggestHypothesisName(hypothesis.statement),
          });
        } catch (e) {
          // 实验已建成，假设失败不能让用户以为整个操作失败
          toast.warning("实验已创建，但假设登记失败", {
            description: rpcErrorToDiagnostic(e instanceof Error ? e.message : String(e)).explanation,
          });
        }
      }
      await utils.researchEngine.listExperiments.invalidate();
      toast.success(`实验已创建：#${experimentId}`, { description: experiment.name });
      setOpen(false);
      reset();
      onCreated?.(experimentId);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  }

  const selectedVersion = versions.find((v) => String(v.id) === form.datasetVersionId);
  const diagnostic = submitError ? rpcErrorToDiagnostic(submitError) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" /> 新建实验
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" /> 新建研究实验
          </DialogTitle>
          <DialogDescription>
            实验绑定**一个**固定的 Dataset 版本。只有 READY 状态的版本可用于研究。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="research-dataset">数据集</Label>
              <Select
                value={form.datasetId}
                onValueChange={(v) =>
                  // 换数据集必须清掉版本，否则会把上一个数据集的版本带过去
                  setForm((prev) => ({ ...prev, datasetId: v, datasetVersionId: "" }))
                }
              >
                <SelectTrigger id="research-dataset">
                  <SelectValue placeholder={definitions.isLoading ? "加载中…" : "选择数据集"} />
                </SelectTrigger>
                <SelectContent>
                  {(definitions.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}（{d.datasetCode}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="research-version">Dataset 版本</Label>
              <Select
                value={form.datasetVersionId}
                onValueChange={(v) => setForm((prev) => ({ ...prev, datasetVersionId: v }))}
                disabled={!form.datasetId || detail.isLoading}
              >
                <SelectTrigger id="research-version">
                  <SelectValue
                    placeholder={
                      !form.datasetId
                        ? "请先选择数据集"
                        : detail.isLoading
                          ? "加载版本…"
                          : versions.length === 0
                            ? "该数据集暂无版本"
                            : "选择版本"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => {
                    const usable = isUsableVersionStatus(v.status);
                    return (
                      <SelectItem key={v.id} value={String(v.id)} disabled={!usable}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono">{v.version}</span>
                          <span className="text-xs text-muted-foreground">
                            {v.startDate ?? "—"} ~ {v.endDate ?? "—"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatCount(v.totalEvents)} 事件
                          </span>
                          <StatusBadge status={v.status} />
                          {!usable && <span className="text-xs">（不可用于研究）</span>}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedVersion && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <span className="font-mono">{selectedVersion.version}</span> ·{" "}
              {selectedVersion.startDate ?? "—"} ~ {selectedVersion.endDate ?? "—"} ·{" "}
              {formatCount(selectedVersion.totalEvents)} 个事件 ·{" "}
              <StatusBadge status={selectedVersion.status} />
            </div>
          )}

          {detail.data !== undefined && versions.length > 0 && recommendVersionId(versions) === null && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              该数据集下没有 READY 状态的版本，无法创建实验。请到「数据集构建」完成构建后再试。
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="research-name">实验名称</Label>
            <Input
              id="research-name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="如：首板换手率与未来5日收益研究"
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="research-type">研究类型</Label>
            <Select
              value={form.researchType}
              onValueChange={(v) =>
                setForm((prev) => ({ ...prev, researchType: v as typeof prev.researchType }))
              }
            >
              <SelectTrigger id="research-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESEARCH_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="flex items-center gap-2">
                      <span>{o.label}</span>
                      <span className="text-xs text-muted-foreground">{o.hint}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="research-desc">描述（可选）</Label>
            <Textarea
              id="research-desc"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              rows={2}
              placeholder="这次研究想回答什么问题、为什么选这个 Dataset 版本"
            />
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <p className="text-xs font-medium">假设（可选，但强烈建议登记）</p>
            <p className="text-xs text-muted-foreground">
              结论会挂在假设上。没有假设时自动结论仍然生成，但无法回答「假设是否被支持」。
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="research-h-name" className="text-xs">
                假设名称
              </Label>
              <Input
                id="research-h-name"
                value={form.hypothesisName}
                onChange={(e) => setForm((prev) => ({ ...prev, hypothesisName: e.target.value }))}
                onBlur={() =>
                  setForm((prev) =>
                    // 只做「空 → 用陈述首句兜底」，绝不覆盖用户已填内容
                    prev.hypothesisName.trim() || !prev.hypothesisStatement.trim()
                      ? prev
                      : { ...prev, hypothesisName: suggestHypothesisName(prev.hypothesisStatement) },
                  )
                }
                placeholder="如：换手率与未来收益负相关"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="research-h-statement" className="text-xs">
                假设陈述
              </Label>
              <Textarea
                id="research-h-statement"
                value={form.hypothesisStatement}
                onChange={(e) => setForm((prev) => ({ ...prev, hypothesisStatement: e.target.value }))}
                rows={2}
                placeholder="如：换手率不同区间的首板股票，未来5日收益存在系统性差异。"
              />
            </div>
          </div>

          {errors.length > 0 && (
            <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {errors.map((e) => (
                <li key={e}>· {e}</li>
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
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={errors.length > 0 || busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            创建实验
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
