import type { StrategyVersionFirstLimitPoolDetailDto } from "@shared/researchContracts";
import { Clock3, Database, ShieldOff, Waypoints } from "lucide-react";

import { cn } from "@/lib/utils";

function PoolFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-cyan-900/70">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-[11px] leading-5 text-cyan-950",
          mono && "font-mono",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function FirstLimitPoolSummary({
  pool,
  title = "池化执行语义",
  description = "首板事件入池后逐日评分；评分只决定买入候选，评分不影响退出。",
  className,
}: {
  pool: StrategyVersionFirstLimitPoolDetailDto;
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-cyan-200 bg-cyan-50/50 px-4 py-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 rounded-md bg-cyan-100 p-1.5 text-cyan-800">
            <Waypoints className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-cyan-950">{title}</p>
            <p className="mt-0.5 text-[11px] leading-5 text-cyan-900/80">
              {description}
            </p>
          </div>
        </div>
        <span className="rounded border border-cyan-200 bg-white/70 px-2 py-1 font-mono text-[10px] text-cyan-900">
          {pool.familyId} / {pool.armId}
        </span>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        <PoolFact label="入池规则" value={pool.admissionRule} />
        <PoolFact
          label="滚动评分"
          value={pool.earlyScoreStage}
          mono
        />
        <PoolFact
          label="窗口冻结"
          value={pool.fullScoreStage}
          mono
        />
        <PoolFact label="移除规则" value={pool.invalidationRule} />
        <PoolFact
          label="池龄 / 失效"
          value={`${pool.ageCapTradingDays} 个交易日 / 连续不可评分 ${pool.scoreInvalidationDays} 日`}
          mono
        />
        <PoolFact
          label="每日候选上限"
          value={String(pool.maxDailyCandidates)}
          mono
        />
        {pool.minimumScore !== undefined && (
          <PoolFact label="最低分 / 移池线" value={String(pool.minimumScore)} mono />
        )}
        {pool.maxObservationAmplitude !== undefined && (
          <PoolFact
            label="滚动最大振幅上限"
            value={`${(pool.maxObservationAmplitude * 100).toFixed(0)}%`}
            mono
          />
        )}
        {pool.calibrationVersion !== undefined && (
          <PoolFact label="评分校准版本" value={pool.calibrationVersion} mono />
        )}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-cyan-200/80 pt-3 text-[10px] text-cyan-950">
        <span className="inline-flex items-center gap-1 rounded border border-cyan-200 bg-white/70 px-2 py-1">
          <ShieldOff className="h-3 w-3" />
          candidateExitPolicy = DISABLED
        </span>
        <span className="rounded border border-cyan-200 bg-white/70 px-2 py-1 font-mono">
          scoreAffectsExit = false
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-cyan-200 bg-white/70 px-2 py-1">
          <Clock3 className="h-3 w-3" />
          单日成员 ≤ {pool.panelBudgets.maxMembersPerDay}
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-cyan-200 bg-white/70 px-2 py-1">
          <Database className="h-3 w-3" />
          面板总行数 ≤ {pool.panelBudgets.maxPanelRows}
        </span>
      </div>

      {pool.errorCodes.length > 0 && (
        <div className="mt-3 border-t border-cyan-200/80 pt-3">
          <p className="text-[10px] font-medium text-cyan-900/70">
            池化稳定错误码
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {pool.errorCodes.map(code => (
              <span
                key={code}
                className="rounded bg-cyan-100/80 px-2 py-1 font-mono text-[10px] text-cyan-900"
              >
                {code}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
