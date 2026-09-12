/**
 * PromoteCandidateDialog — 「转正为策略」入口（RESEARCH-006.4.1-B §8 ~ §19）。
 *
 * 🔴 这是整个前端**唯一**的 Candidate → Strategy 入口，且只调一个端点：
 *   `research.strategyCandidate.promote`（admin）。
 *   **绝不**调 `research.strategy.create / save / createVersion`，**绝不**在前端构造
 *   StrategyDefinition —— 定义永远由后端从候选草稿生成（§14）。
 *
 * 分层纪律（§25）：UI 只做**渲染 + 编排**；能不能转正、执行 Dataset 是否合法、
 * divergence 是否成立、幂等如何判定，**全部**由后端负责。前端只做 §15 的三项 UX 检查
 * （纯函数在 `./promoteForm`，有单测）。
 *
 * 数据源复用（§26 目标「新增 API = 0」）：执行 Dataset 选择器读的是既有
 * `datasetRegistry.listDefinitions` / `getDefinition`，READY 判定复用
 * `createExperimentForm#isUsableVersionStatus` —— 与 Research 新建实验、
 * Strategy 基础信息**同一处口径**，不另造 Dataset API。
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Rocket } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  PROMOTE_DOMAIN_HINTS,
  promoteFailureVm,
  promoteResultToVm,
  type PromoteFailureVm,
  type PromoteResultVm,
} from "@/adapters/strategyCandidateAdapter";
import {
  buildDatasetVersionOptions,
  buildPromoteInput,
  createDefaultPromoteForm,
  datasetOptionLabel,
  findDatasetVersionLabel,
  isPromotableStatus,
  validatePromoteForm,
  type PromoteFormState,
} from "./promoteForm";

export interface PromoteCandidateSummary {
  id: number;
  name: string;
  status: string;
  /** 研究来源 Dataset 坐标快照（可为 `null` = 提不出）。 */
  sourceDatasetVersionId: number | null;
  sourceDatasetLabel: string | null;
}

export function PromoteCandidateDialog({
  candidate,
  onPromoted,
}: {
  candidate: PromoteCandidateSummary;
  onPromoted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PromoteFormState>(() => createDefaultPromoteForm());
  const [pickedDefinitionId, setPickedDefinitionId] = useState<number | null>(null);
  const [result, setResult] = useState<PromoteResultVm | null>(null);
  const [failure, setFailure] = useState<PromoteFailureVm | null>(null);
  const utils = trpc.useUtils();
  const promote = trpc.research.strategyCandidate.promote.useMutation();

  const source = useMemo(
    () => ({
      sourceDatasetVersionId: candidate.sourceDatasetVersionId,
      sourceDatasetLabel: candidate.sourceDatasetLabel,
    }),
    [candidate.sourceDatasetVersionId, candidate.sourceDatasetLabel],
  );

  // -- Dataset Registry（与 Research / Strategy 同一套只读端点）--
  const definitions = trpc.datasetRegistry.listDefinitions.useQuery(undefined, {
    enabled: open,
    refetchOnWindowFocus: false,
  });
  const sourceVersion = trpc.datasetRegistry.getVersion.useQuery(
    { datasetVersionId: candidate.sourceDatasetVersionId ?? 0 },
    {
      enabled: open && candidate.sourceDatasetVersionId !== null,
      refetchOnWindowFocus: false,
    },
  );
  const definitionId =
    pickedDefinitionId
    ?? sourceVersion.data?.datasetId
    ?? (definitions.data?.length === 1 ? definitions.data[0]!.id : null);
  const detail = trpc.datasetRegistry.getDefinition.useQuery(
    { definitionId: definitionId ?? 0 },
    { enabled: open && definitionId !== null && definitionId > 0, refetchOnWindowFocus: false },
  );

  const options = useMemo(
    () =>
      buildDatasetVersionOptions({
        datasetName: detail.data?.name ?? "",
        datasetCode: detail.data?.datasetCode ?? "",
        versions: detail.data?.versions ?? [],
        sourceDatasetVersionId: candidate.sourceDatasetVersionId,
      }),
    [detail.data, candidate.sourceDatasetVersionId],
  );

  const validation = validatePromoteForm(form, source);
  const promotable = isPromotableStatus(candidate.status);

  useEffect(() => {
    if (!open) return;
    // 每次打开都回到「继承研究来源」的干净默认态（避免上次的选择残留）。
    setForm(createDefaultPromoteForm());
    setPickedDefinitionId(null);
    setResult(null);
    setFailure(null);
  }, [open]);

  const [, navigate] = useLocation();

  async function handleSubmit() {
    if (promote.isPending) return;
    const built = buildPromoteInput({ candidateId: candidate.id, form, source });
    if (!built.ok) {
      setFailure(null);
      toast.error("还不能提交", { description: built.errors.join("；") });
      return;
    }
    setFailure(null);
    try {
      const raw = await promote.mutateAsync(built.input);
      const vm = promoteResultToVm(raw, {
        executionDatasetLabel: findDatasetVersionLabel(options, raw.executionDatasetVersionId),
      });
      setResult(vm);
      toast.success(vm.title, { description: vm.summary });
      // 🔴 从服务端重读候选（**不**在前端把 status 改成 CONVERTED 伪造状态，§19）。
      await Promise.all([
        utils.research.strategyCandidate.get.invalidate({ candidateId: candidate.id }),
        utils.researchEngine.listCandidates.invalidate(),
      ]);
      onPromoted?.();
    } catch (e) {
      setResult(null);
      setFailure(promoteFailureVm(e));
    }
  }

  return (
    <>
      <Button
        size="sm"
        disabled={!promotable}
        title={
          promotable
            ? "把这个候选转正为正式策略（唯一入口；定义由后端从草图生成）"
            : `只有 ACCEPTED（已采纳）的候选可以转正，当前状态：${candidate.status}`
        }
        onClick={() => setOpen(true)}
      >
        <Rocket className="mr-1.5 h-3.5 w-3.5" /> 转正为策略
      </Button>

      <Dialog open={open} onOpenChange={(next) => !promote.isPending && setOpen(next)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{result ? "转正结果" : "转正为策略"}</DialogTitle>
            <DialogDescription>
              {result
                ? "以下信息全部来自服务端返回值。"
                : "转正会把候选草稿转换成正式的 StrategyDefinition，并创建一个 Strategy 版本。这是不可逆的跨模块写入。"}
            </DialogDescription>
          </DialogHeader>

          {result !== null ? (
            <PromoteResultView result={result} />
          ) : (
            <div className="space-y-4">
              {/* 候选与来源速览（§9） */}
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">候选</span>
                  <span className="font-mono">#{candidate.id}</span>
                  <span className="font-medium">{candidate.name}</span>
                  <StatusBadge status={candidate.status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                  <span>Research Source Dataset</span>
                  <span className="font-mono">
                    {candidate.sourceDatasetVersionId === null
                      ? "—（提不出）"
                      : `#${candidate.sourceDatasetVersionId}`}
                  </span>
                  <span>{candidate.sourceDatasetLabel ?? ""}</span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  Research 来源数据集用于形成研究结论；Strategy 执行数据集在转正时确定。
                </p>
              </div>

              {!promotable && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  当前状态不是 ACCEPTED，后端会以 CANDIDATE_NOT_ACCEPTED 拒绝。请先在候选页完成状态流转。
                </p>
              )}

              {/* Execution Dataset（§10 / §11 / §12） */}
              <div className="space-y-3 rounded-md border px-3 py-3">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="radio"
                      name="promote-mode"
                      checked={form.mode === "INHERIT"}
                      disabled={candidate.sourceDatasetVersionId === null}
                      onChange={() => setForm((p) => ({ ...p, mode: "INHERIT" }))}
                    />
                    继承研究来源数据集
                    {candidate.sourceDatasetVersionId === null && (
                      <span className="text-muted-foreground">（该候选没有来源 Dataset）</span>
                    )}
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="radio"
                      name="promote-mode"
                      checked={form.mode === "OVERRIDE"}
                      onChange={() => setForm((p) => ({ ...p, mode: "OVERRIDE" }))}
                    />
                    使用其他 Dataset
                  </label>
                </div>

                {form.mode === "OVERRIDE" && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="promote-ds-def">数据集</Label>
                      <Select
                        value={definitionId === null ? "none" : String(definitionId)}
                        onValueChange={(v) => v !== "none" && setPickedDefinitionId(Number(v))}
                      >
                        <SelectTrigger id="promote-ds-def" className="w-full text-xs">
                          <SelectValue placeholder={definitions.isLoading ? "加载中…" : "选择数据集"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" disabled>
                            未选择数据集
                          </SelectItem>
                          {definitions.data?.map((d) => (
                            <SelectItem key={d.id} value={String(d.id)}>
                              {d.name}（{d.datasetCode}）
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="promote-ds-ver">Dataset 版本（仅 READY 可选）</Label>
                      <Select
                        value={form.datasetVersionId === null ? "none" : String(form.datasetVersionId)}
                        onValueChange={(v) =>
                          v !== "none" && setForm((p) => ({ ...p, datasetVersionId: Number(v) }))
                        }
                      >
                        <SelectTrigger
                          id="promote-ds-ver"
                          className="w-full text-xs"
                          disabled={definitionId === null || detail.isLoading}
                        >
                          <SelectValue
                            placeholder={
                              definitionId === null
                                ? "请先选择数据集"
                                : detail.isLoading
                                  ? "加载版本…"
                                  : options.length === 0
                                    ? "该数据集暂无版本"
                                    : "选择版本"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" disabled>
                            未选择数据集版本
                          </SelectItem>
                          {options.map((o) => (
                            <SelectItem
                              key={o.datasetVersionId}
                              value={String(o.datasetVersionId)}
                              disabled={!o.usable}
                            >
                              <span className="flex items-center gap-2">
                                <span className="font-mono">{datasetOptionLabel(o)}</span>
                                {o.isSource && (
                                  <span className="font-sans text-[10px]">（研究来源）</span>
                                )}
                                {!o.usable && (
                                  <span className="font-sans text-[11px]">（不可用作执行绑定）</span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        提交的是 <code className="font-mono">datasetVersionId</code>；label / datasetCode
                        仅用于显示，不作为坐标。
                      </p>
                    </div>
                  </div>
                )}

                {validation.diverges && (
                  <div className="space-y-1.5">
                    <Label htmlFor="promote-divergence">
                      数据集分歧原因（执行 Dataset ≠ 研究来源，必填）
                    </Label>
                    <Textarea
                      id="promote-divergence"
                      rows={2}
                      value={form.divergenceReason}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, divergenceReason: e.target.value }))
                      }
                      placeholder="例如：研究用 v2 验证机制，执行需覆盖更长历史，改用 v3。"
                    />
                  </div>
                )}

                <p className="text-[11px] text-muted-foreground">
                  本次将用于执行的 Dataset：
                  <span className="font-mono">
                    {validation.executionDatasetVersionId === null
                      ? " —"
                      : ` #${validation.executionDatasetVersionId}`}
                  </span>
                  {validation.diverges ? "（与研究来源不同）" : "（与研究来源一致 / 继承）"}
                </p>
              </div>

              {validation.errors.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-600">
                  {validation.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}

              {failure !== null && <PromoteFailureView failure={failure} />}
            </div>
          )}

          <DialogFooter>
            {result === null ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={promote.isPending}
                >
                  取消
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!validation.ok || promote.isPending}
                >
                  {promote.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {promote.isPending ? "正在转正..." : "确认转正"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  关闭
                </Button>
                <Button onClick={() => { setOpen(false); navigate(result.path); }}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> 查看 Strategy Version
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 成功 / 幂等结果（§17 / §18）—— 文案在适配层，这里只排版。 */
function PromoteResultView({ result }: { result: PromoteResultVm }) {
  return (
    <div className="space-y-3">
      <div
        className={
          result.idempotent
            ? "rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900"
            : "rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
        }
      >
        <p className="flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="h-4 w-4" /> {result.title}
        </p>
        <p className="mt-1">{result.summary}</p>
      </div>

      <dl className="grid gap-1.5 text-xs md:grid-cols-2">
        <Field label="Strategy ID" value={result.strategyId} mono />
        <Field label="Strategy Version ID" value={String(result.strategyVersionId)} mono />
        <Field label="Strategy Version" value={result.strategyVersion} mono />
        <Field
          label="Execution Dataset"
          value={
            result.executionDatasetLabel === null
              ? `#${result.executionDatasetVersionId}`
              : `#${result.executionDatasetVersionId}（${result.executionDatasetLabel}）`
          }
          mono
        />
        <Field
          label="Research Source Dataset"
          value={
            result.sourceDatasetVersionId === null
              ? "—（提不出）"
              : `#${result.sourceDatasetVersionId}${result.sourceDatasetLabel === null ? "" : `（${result.sourceDatasetLabel}）`}`
          }
          mono
        />
        <Field label="Provenance ID" value={String(result.provenanceId)} mono />
        <Field label="来源类型" value={result.origin} mono />
        <Field label="数据集分歧" value={result.datasetDivergence ? "是" : "否"} />
        {result.datasetDivergence && (
          <Field
            label="分歧原因"
            value={result.sourceDatasetDivergenceReason ?? "—"}
          />
        )}
        <Field label="版本指纹" value={result.fingerprint} mono />
      </dl>

      <p className="text-[11px] text-muted-foreground">
        策略版本的 Research 溯源可在「查看 Strategy Version」页面以只读方式查看。
      </p>
    </div>
  );
}

/** 失败展示（§11）—— 领域码 / tRPC code / 建出的坐标全部来自后端返回值。 */
function PromoteFailureView({ failure }: { failure: PromoteFailureVm }) {
  const hint =
    failure.domainCode === null ? null : PROMOTE_DOMAIN_HINTS[failure.domainCode];
  return (
    <div className="space-y-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
      <p className="font-medium">{failure.diagnostic.title}</p>
      <p className="whitespace-pre-wrap">{hint?.explanation ?? failure.diagnostic.explanation}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px]">
        <span>领域码：{failure.domainCode ?? "—（未透传）"}</span>
        <span>tRPC code：{failure.trpcCode ?? "—"}</span>
      </div>
      {failure.writeback !== null && (
        <div className="rounded border border-red-200 bg-white/60 px-2 py-1.5 font-mono text-[11px]">
          <p className="font-sans font-medium">已产出的 Strategy（不会被删除）</p>
          <p>strategyId={failure.writeback.strategyId ?? "—"}</p>
          <p>strategyVersionId={failure.writeback.strategyVersionId ?? "—"}</p>
          <p>strategyVersion={failure.writeback.strategyVersion ?? "—"}</p>
          <p>stage={failure.writeback.stage ?? "—"}</p>
        </div>
      )}
      {(failure.diagnostic.suggestions ?? []).length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5">
          {(failure.diagnostic.suggestions ?? []).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono" : "break-all"}>{value}</dd>
    </div>
  );
}
