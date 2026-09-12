/**
 * RunEngineButton — 触发 `researchEngine.runEngine`（真实读取 Dataset → 计算 → 落库 → 生成结论）。
 *
 * 这是工作台里**唯一会长时间阻塞**的动作（真实 TiDB 上约 17~30 s，瓶颈是跨境往返而非算力），
 * 所以交互上必须诚实：
 *   - 执行中明确告知「正在读取 Dataset 并计算，约 20 秒量级」，而不是一个转圈到底；
 *   - 完成后展示**引擎真实返回的执行证据**（样本量、结果行数、装配耗时、各分析耗时、结论类型），
 *     而不是只说一句「成功」；
 *   - 失败时把 `errorCode` + `errorMessage` 原文和「下一步该做什么」一起给出
 *     —— 引擎的失败可追溯性设计，正是为了让这一步能被用户看见。
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, PlayCircle } from "lucide-react";
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

export function RunEngineButton({
  experimentId,
  runId,
  runStatus,
  analysisCount,
  runnableAnalysisCount = 0,
  onFinished,
}: {
  experimentId: number;
  runId: number;
  runStatus: string;
  analysisCount: number;
  /** 该 Run 下「尚无有效结果」的分析数（>0 时提示改用行内「补跑」，而不是只灰一个按钮）。 */
  runnableAnalysisCount?: number;
  onFinished?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runEngine = trpc.researchEngine.runEngine.useMutation();
  const utils = trpc.useUtils();

  // 与后端一致：只有 PENDING / FAILED / CANCELLED 可以执行（已 COMPLETED 的 Run 不可覆盖）
  const executable = runStatus === "PENDING" || runStatus === "FAILED" || runStatus === "CANCELLED";
  const disabled = !executable || analysisCount === 0 || runEngine.isPending;

  /**
   * 为什么不能点 —— **必须说到点子上**。
   * Run 已 COMPLETED 且存在尚无结果的分析，是最容易让人卡住的情形：此时正解是行内「补跑」，
   * 继续整轮执行会覆盖已有结果。只说「状态不允许」等于把用户丢在原地。
   */
  const blockedReason =
    !executable && runnableAnalysisCount > 0
      ? `Run #${runId} 已 ${runStatus}，整轮执行会覆盖已有结果（不允许）。` +
        `该 Run 下有 ${runnableAnalysisCount} 个分析尚无结果 —— 请在下方分析列表里对它们点「补跑」。`
      : !executable
        ? `Run 状态为 ${runStatus}，只有 PENDING / FAILED / CANCELLED 可整轮执行。` +
          `已 COMPLETED 的 Run 不会被覆盖；要重跑全部分析请新建 Run。`
        : analysisCount === 0
          ? "请先新建至少一个分析"
          : undefined;

  async function handleRun() {
    setError(null);
    try {
      const result = await runEngine.mutateAsync({ experimentId, runId });
      await Promise.all([
        utils.researchEngine.getExperiment.invalidate(),
        utils.researchEngine.getRun.invalidate(),
        utils.researchEngine.listExperiments.invalidate(),
        // 整轮执行会重写全部分析的结果 → 结果/结论缓存必须一起失效
        utils.researchEngine.getAnalysisResults.invalidate(),
        utils.researchEngine.listConclusions.invalidate(),
      ]);
      toast.success(`Run 执行完成`, {
        description: `${formatCount(result.sampleCount)} 个样本 · ${formatCount(result.resultCount)} 行结果 · ${formatDuration(result.durationMs)}`,
      });
      setOpen(true);
      onFinished?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOpen(true);
    }
  }

  const result = runEngine.data;
  const diagnostic = error ? rpcErrorToDiagnostic(error) : null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button size="sm" onClick={handleRun} disabled={disabled}>
              {runEngine.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-1.5 h-4 w-4" />
              )}
              {runEngine.isPending ? "执行中…" : "运行引擎"}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-xs">
            {blockedReason ?? "整轮执行：读取 Dataset → 计算该 Run 的**全部**分析 → 落结果 + 生成结论。"}
          </p>
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{diagnostic ? "执行失败" : "执行完成"}</DialogTitle>
            <DialogDescription>
              {diagnostic
                ? "失败已如实落到 Run 的 errorCode / errorMessage，可追溯。"
                : "以下是引擎真实返回的执行证据（本次运行，非估算）。"}
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
                  <p className="text-muted-foreground">样本量</p>
                  <p className="font-mono tabular-nums">{formatCount(result.sampleCount)}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">结果行数</p>
                  <p className="font-mono tabular-nums">{formatCount(result.resultCount)}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">引擎耗时</p>
                  <p className="font-mono tabular-nums">{formatDuration(result.durationMs)}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">Dataset 装配</p>
                  <p className="font-mono tabular-nums">{formatDuration(result.sampleBuildMs)}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">分析数</p>
                  <p className="font-mono tabular-nums">{result.analysisCount}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">结论</p>
                  <p>
                    {result.conclusionType ? (
                      <StatusBadge status={result.conclusionType} />
                    ) : (
                      <span className="text-muted-foreground">未生成</span>
                    )}
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                装配阶段是往返次数最多的一步，耗时随跨境网络波动最明显（实测 1.4 s ~ 9.6 s）；
                分析阶段稳定在 1.5~2.2 s / 个。统计结果不随耗时波动。
              </p>

              <div>
                <p className="mb-1.5 text-xs font-medium">各分析</p>
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
