/** STRATEGY-3570001 最终评估只读适配页：数据来自持久化 API，展示复用通用模板。 */
import {
  StrategyEvaluationTemplate,
  type StrategyEvaluationDetail,
} from "@/components/strategy/StrategyEvaluationTemplate";
import { trpc } from "@/lib/trpc";

export default function StrategyFinalEvaluation() {
  // ✅ SCOPE-002 S7：改用**通用**端点（按版本坐标），专项端点只是它的薄封装。
  const q = trpc.researchRun.getStrategyVersionEvaluation.useQuery({
    strategyId: "first-limit-pullback-3f-top3-runner-hold20",
    strategyVersion: "1.0.0",
  });
  const payload = q.data as {
    evaluationDetail?: StrategyEvaluationDetail;
    promoted?: { runId: string; status: string };
  } | null;
  const detail = payload?.evaluationDetail ?? null;

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">加载评估结果…</div>;
  if (detail === null) {
    return <div className="p-6 text-sm text-muted-foreground">尚无持久化的评估结果。</div>;
  }
  return (
    <StrategyEvaluationTemplate
      detail={detail}
      runId={payload?.promoted?.runId ?? null}
      runStatus={payload?.promoted?.status}
    />
  );
}
