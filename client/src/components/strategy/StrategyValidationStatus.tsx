/**
 * 策略「验证状态」汇总（FLOW-001 §3 的 ⑤→⑥ 交接缺口 —— 原文标注「⚠️ 缺统一状态标识」）。
 *
 * 回答一个问题：**这个策略版本跑过哪些验证、各自什么状态**。
 * 在此之前，用户必须离开策略页、去 `/validation` 逐块翻找，才能知道某版本是否验证过。
 *
 * 🔴 两条纪律（改动前必读）：
 *   1. 只表示「**跑没跑过 / 状态是什么**」，**不表示结论好坏** —— 禁止据此给策略排名，
 *      也禁止用视觉暗示「验证过 = 更好」（`Frontend Skill` §3：不得通过视觉设计暗示未经验证的结果更好）。
 *   2. **零契约变更**：只消费既有只读端点 `paramSearch.list{Robustness,Oos,WalkForward}Runs`。
 *      ⚠️ 稳健性 / OOS 的 list 端点**不支持** `strategyId` 过滤（只有 WFA 支持）⇒ 前端拉取一页后本地过滤，
 *      因此对「超过一页的 Run」只统计本页可见部分，UI 上如实标注。
 */

import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, SectionCard, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";

export interface StrategyValidationStatusProps {
  readonly strategyId: string;
  readonly strategyVersion: string;
}

/** 三块验证的元信息（与 `/validation` 的三个入口、PD-04 的「是否重跑」口径逐条对齐）。 */
const KINDS = [
  { key: "robustness", label: "稳健性", href: "/validation/robustness", rerun: "零重跑" },
  { key: "oos", label: "样本外 OOS", href: "/validation/oos", rerun: "真重跑" },
  { key: "walkForward", label: "Walk-Forward", href: "/validation/walk-forward", rerun: "每 Fold 真重跑" },
] as const;

/** Run 视图里本组件用到的最小结构（三个域各自 schema 都满足）。 */
interface ValidationRunLike {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly status: string;
}

/** 按 strategyId@version 过滤（draft：list 端点的返回上限是 200，故标注「本页可见」）。 */
function pickVersionRuns<T extends ValidationRunLike>(
  runs: readonly T[] | undefined,
  strategyId: string,
  strategyVersion: string,
): readonly T[] {
  return (runs ?? []).filter(
    (run) => run.strategyId === strategyId && run.strategyVersion === strategyVersion,
  );
}

/** 状态 → 次数（不排序结论，只统计事实）。 */
function statusCounts(runs: readonly ValidationRunLike[]): ReadonlyArray<readonly [string, number]> {
  const counter = new Map<string, number>();
  for (const run of runs) counter.set(run.status, (counter.get(run.status) ?? 0) + 1);
  return [...counter.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function StrategyValidationStatus({ strategyId, strategyVersion }: StrategyValidationStatusProps) {
  const robustness = trpc.paramSearch.listRobustnessRuns.useQuery({ limit: 200 });
  const oos = trpc.paramSearch.listOosRuns.useQuery({ limit: 200 });
  const walkForward = trpc.paramSearch.listWalkForwardRuns.useQuery({ strategyId, limit: 200 });

  const loading = robustness.isLoading || oos.isLoading || walkForward.isLoading;
  const errored = robustness.isError || oos.isError || walkForward.isError;

  const runsByKind = {
    robustness: pickVersionRuns(robustness.data, strategyId, strategyVersion),
    oos: pickVersionRuns(oos.data, strategyId, strategyVersion),
    walkForward: pickVersionRuns(walkForward.data, strategyId, strategyVersion),
  } as const;

  const total = KINDS.reduce((sum, kind) => sum + runsByKind[kind.key].length, 0);

  return (
    <SectionCard
      title="验证状态"
      icon={ShieldCheck}
      right={
        <Button asChild size="sm" variant="outline">
          <Link href="/validation">前往验证域</Link>
        </Button>
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">
        策略版本 <span className="font-mono">{strategyId}@{strategyVersion}</span> 的验证台账。
        🔴 **只表示「跑没跑过 / 状态是什么」，不代表结论好坏** —— 三块验证的语义不同（零重跑 / 真重跑 / 每 Fold 真重跑），
        不可互相替代，也不可据此排名。
      </p>

      {loading ? (
        <p className="text-xs text-muted-foreground">正在读取验证 Run…</p>
      ) : errored ? (
        <p className="text-xs text-amber-700">
          验证 Run 列表读取失败（可能是网络或后端不可用）—— 本页**不猜测**状态，请稍后重试。
        </p>
      ) : total === 0 ? (
        <EmptyState
          title="本版本尚未跑过验证"
          description="验证不是必跑项，但未验证的版本不应被当成已验证。需要验证时，先去参数搜索跑一次搜索，再进入验证域创建 Run。"
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/parameter-search">前往参数搜索</Link>
            </Button>
          }
          className="py-6"
        />
      ) : (
        <ul className="divide-y divide-border">
          {KINDS.map((kind) => {
            const runs = runsByKind[kind.key];
            return (
              <li key={kind.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-xs">
                <span className="w-32 shrink-0 font-medium">{kind.label}</span>
                <span className="w-28 shrink-0 text-muted-foreground">{kind.rerun}</span>
                {runs.length === 0 ? (
                  <span className="text-muted-foreground">未跑过</span>
                ) : (
                  <>
                    <span className="text-muted-foreground">共 {runs.length} 次</span>
                    {statusCounts(runs).map(([status, count]) => (
                      <span key={status} className="flex items-center gap-1">
                        <StatusBadge status={status} />
                        <span className="text-muted-foreground">×{count}</span>
                      </span>
                    ))}
                  </>
                )}
                <Link
                  href={kind.href}
                  className="ml-auto shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  查看 →
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}