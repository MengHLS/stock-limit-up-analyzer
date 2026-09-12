/**
 * RunIncrementalButton — 触发 `researchEngine.runIncremental`（补跑单个尚无结果的分析）。
 *
 * 为什么需要它：一个 Run 一旦整轮跑完（COMPLETED），「运行引擎」按钮就按设计变灰
 * （已 COMPLETED 的 Run 不会被覆盖）。此后**新增**的分析没有任何入口能跑 —— 这就是
 * 「我新建了一个分析，但是没有可以让他运行的按钮」的根因。补跑是这个场景下的正确出路：
 * 只算这个分析，复用该 Run 已冻结的基准，不覆盖任何已有结果。
 *
 * 交互上延续 `RunEngineButton` 的诚实原则：
 *   - 不可补跑时给出**具体原因**（不是一句「不可用」）；
 *   - 完成后展示引擎真实返回的执行证据；
 *   - 明确告知**本次不会刷新结论**（增量批次不生成结论）。
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ListPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/common";
import {
  analysisTypeLabelOf,
  formatCount,
  formatDuration,
  rpcErrorToDiagnostic,
} from "@/adapters/researchEngineAdapter";
import { incrementalAvailability } from "./incrementalRunForm";

export function RunIncrementalButton({
  experimentId,
  runId,
  runStatus,
  analysisId,
  analysisStatus,
  hasSnapshot,
  onFinished,
}: {
  experimentId: number;
  runId: number;
  runStatus: string;
  analysisId: number;
  analysisStatus: string;
  /** 该 Run 是否已整轮执行过（`inputSnapshot` 存在）。 */
  hasSnapshot: boolean;
  onFinished?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runIncremental = trpc.researchEngine.runIncremental.useMutation();
  const utils = trpc.useUtils();

  const availability = incrementalAvailability({ runStatus, analysisStatus, hasSnapshot });
  const disabled = !availability.enabled || runIncremental.isPending;

  async function handleRun() {
    setError(null);
    try {
      const result = await runIncremental.mutateAsync({
        experimentId,
        runId,
        analysisIds: [analysisId],
      });
      await Promise.all([
        utils.researchEngine.getExperiment.invalidate(),
        utils.researchEngine.getRun.invalidate(),
        utils.researchEngine.listExperiments.invalidate(),
        // 补跑的要义就是产出新结果 → 必须刷新结果与结论缓存，否则页面会继续显示旧值
        utils.researchEngine.getAnalysisResults.invalidate(),
        utils.researchEngine.listConclusions.invalidate(),
      ]);
      toast.success("补跑完成", {
        description: `批次 ${result.executionSequence} · ${formatCount(result.resultCount)} 行结果 · ${formatDuration(result.durationMs)}`,
      });
      setOpen(true);
      onFinished?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOpen(true);
    }
  }

  const result = runIncremental.data;
  const diagnostic = error ? rpcErrorToDiagnostic(error) : null;

  const button = (
    <Button size="sm" variant="outline" onClick={handleRun} disabled={disabled}>
      {runIncremental.isPending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <ListPlus className="mr-1.5 h-3.5 w-3.5" />
      )}
      {runIncremental.isPending ? "补跑中…" : "补跑"}
    </Button>
  );

  return (
    <>
      {availability.enabled ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{button}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs">{availability.hint}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{button}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs">{availability.reason}</p>
          </TooltipContent>
        </Tooltip>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{diagnostic ? "补跑失败" : "补跑完成"}</DialogTitle>
            <DialogDescription>
              {diagnostic
                ? "失败已如实落到 Run 的 errorCode / errorMessage 与执行批次日志，可追溯；此前批次的结果未被改动。"
                : "以下是引擎真实返回的执行证据（本次批次，非估算）。"}
            </DialogDescription>
          </DialogHeader>

          {diagnostic && (
            <div className="space-y-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
              <p className="font-medium">
                {diagnostic.title}
                <span className="ml-2 font-mono">{diagnostic.code}</span>
              </p>
              <p>{diagnostic.explanation}</p>
              {diagnostic.suggestions && diagnostic.suggestions.length > 0 && (
                <ul className="space-y-0.5">
                  {diagnostic.suggestions.map((s) => (
                    <li key={s}>· {s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">执行批次</p>
                  <p className="font-mono tabular-nums">#{result.executionSequence}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">样本量（复用基准）</p>
                  <p className="font-mono tabular-nums">{formatCount(result.sampleCount)}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">结果行数</p>
                  <p className="font-mono tabular-nums">{formatCount(result.resultCount)}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">耗时</p>
                  <p className="font-mono tabular-nums">{formatDuration(result.durationMs)}</p>
                </div>
              </div>

              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-medium">本批次未生成结论（预期行为）</p>
                <p className="mt-0.5">{result.conclusionSkippedReason}</p>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium">本批次分析</p>
                <div className="space-y-1">
                  {result.analyses.map((a) => (
                    <div
                      key={a.analysisId}
                      className="flex items-center justify-between rounded border px-2 py-1 text-xs"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono">#{a.analysisId}</span>
                        <span>{analysisTypeLabelOf(a.analysisType)}</span>
                        <StatusBadge status={a.status} />
                        {a.errorCode && <span className="font-mono text-red-700">{a.errorCode}</span>}
                      </span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {formatCount(a.resultCount)} 行 · {formatDuration(a.durationMs)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
