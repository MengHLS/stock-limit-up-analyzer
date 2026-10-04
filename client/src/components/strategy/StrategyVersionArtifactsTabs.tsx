/**
 * SCOPE-002 S7 —— 策略详情页的「最终评估 / 模拟盘」通用 Tab。
 *
 * 与两个**专项页**（`/strategy-final-evaluation` · `/paper-trading-3570001`）的区别：
 *   这里按**当前加载的版本坐标**（`strategyId + strategyVersion`）查询，任何策略版本都能看；
 *   数据来源 = `researchRun.getStrategyVersionEvaluation` / `getStrategyVersionPaperTrading`
 *   （按坐标直读原样留档，查不到即空态，**不伪造**）。
 *
 * 展示复用既有模板（`StrategyEvaluationTemplate` / `PaperTradingTemplate`），不重写图表。
 */
import { Skeleton } from "@/components/ui/skeleton";
import {
  PaperTradingTemplate,
  type PaperForwardState,
  type PaperTradingState,
} from "@/components/strategy/PaperTradingTemplate";
import {
  StrategyEvaluationTemplate,
  type StrategyEvaluationDetail,
} from "@/components/strategy/StrategyEvaluationTemplate";
import { trpc } from "@/lib/trpc";

export interface StrategyVersionCoordinatesProps {
  readonly strategyId: string;
  readonly strategyVersion: string;
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function ErrorState({ label, message }: { label: string; message: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/40 px-6 py-8 text-center">
      <p className="text-sm text-rose-800">读取{label}失败：{message}</p>
    </div>
  );
}

/** 当前版本的最终评估留档（基线 / 提升版 / evaluationDetail 全部来自持久化）。 */
export function StrategyFinalEvaluationTab({ strategyId, strategyVersion }: StrategyVersionCoordinatesProps) {
  const query = trpc.researchRun.getStrategyVersionEvaluation.useQuery(
    { strategyId, strategyVersion },
    { refetchOnWindowFocus: false },
  );
  if (query.isLoading) return <Skeleton className="h-72 w-full" />;
  if (query.error !== null) return <ErrorState label="最终评估" message={query.error.message} />;

  const payload = (query.data ?? null) as {
    evaluationDetail?: unknown;
    promoted?: { runId?: string; status?: string } | null;
  } | null;
  const detail = (payload?.evaluationDetail ?? null) as StrategyEvaluationDetail | null;
  if (detail === null) {
    return (
      <EmptyState
        title="该版本还没有「最终评估」留档。"
        hint="评估由研究侧脚本产出并写入 closed_loop_backtest_run（result.evaluationDetail）；不会用其它版本的结果冒名顶替。"
      />
    );
  }
  return (
    <StrategyEvaluationTemplate
      detail={detail}
      runId={payload?.promoted?.runId ?? null}
      runStatus={payload?.promoted?.status}
    />
  );
}

/** 当前版本的模拟盘（历史回放 + 前向状态；两者各自可缺失）。 */
export function StrategyPaperTradingTab({ strategyId, strategyVersion }: StrategyVersionCoordinatesProps) {
  const query = trpc.researchRun.getStrategyVersionPaperTrading.useQuery(
    { strategyId, strategyVersion },
    { refetchOnWindowFocus: false },
  );
  if (query.isLoading) return <Skeleton className="h-72 w-full" />;
  if (query.error !== null) return <ErrorState label="模拟盘" message={query.error.message} />;

  const payload = (query.data ?? null) as { state?: unknown; forward?: unknown } | null;
  const state = (payload?.state ?? null) as PaperTradingState | null;
  const forward = (payload?.forward ?? null) as PaperForwardState | null;
  if (state === null) {
    return (
      <EmptyState
        title="该版本还没有「模拟盘」留档。"
        hint="模拟盘按同一份正式模拟投影成每日记录；没有留档时这里保持空态，不会用别的版本数据填充。"
      />
    );
  }
  return <PaperTradingTemplate state={state} forward={forward} />;
}