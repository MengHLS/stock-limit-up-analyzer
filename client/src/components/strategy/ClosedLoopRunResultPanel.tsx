/**
 * ClosedLoopRunResultPanel — 闭环运行结果面板（FE-4 运行工作台）。
 *
 * 输入 = `closedLoopRunAdapter` 产出的 ViewModel（真实 `researchRun.loopRun` 结果）。
 * 本组件**只渲染**：不计算任何指标、不推断任何状态、不美化阻塞原因。
 *
 * 展示三层：
 *   1. 全链概要（runId / createdAt / chainFingerprint / 三态计数 / synthetic 标记）；
 *   2. 评估标量（仅 evaluation 阶段真实 EXECUTED 时有值，否则全部「—」）；
 *   3. 逐阶段轨迹（14 行：状态 / 产出 kind / 阻塞 reasonCode 与详情）+ 装配覆盖。
 */

import {
  MetricCard,
  SectionCard,
  StatusBadge,
} from "@/components/common";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import type { ClosedLoopRunViewModel } from "@/adapters/closedLoopRunAdapter";

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(2)}%`;
}

function fmtNum(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

function fmtInt(v: number | null): string {
  return v === null ? "—" : v.toLocaleString();
}

function shortHash(h: string): string {
  return h.length <= 16 ? h : `${h.slice(0, 12)}…${h.slice(-4)}`;
}

export function ClosedLoopRunResultPanel({
  result,
}: {
  result: ClosedLoopRunViewModel;
}) {
  const e = result.evaluation;
  const covered = result.wiring.coveredStages.length;
  const total = result.stages.length;

  return (
    <SectionCard
      title="闭环运行结果"
      description="真实执行轨迹（researchRun.loopRun）：入参齐备的阶段真跑，缺入参/无执行器的阶段如实 BLOCKED。"
      right={<StatusBadge status={result.status} />}
    >
      {/* 全链概要 */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs text-muted-foreground">
        <span>Run ID: {result.runId}</span>
        {result.createdAt && <span>Created: {result.createdAt}</span>}
        {result.chainFingerprint && (
          <span title={result.chainFingerprint}>
            Chain: {shortHash(result.chainFingerprint)}
          </span>
        )}
        {result.synthetic && (
          <StatusBadge status="WARNING" label="SYNTHETIC" />
        )}
      </div>

      {/* 三态计数 + 装配覆盖 */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard label="已执行阶段" value={fmtInt(result.counts.executed)} />
        <MetricCard label="阻塞阶段" value={fmtInt(result.counts.blocked)} />
        <MetricCard label="跳过阶段" value={fmtInt(result.counts.skipped)} />
        <MetricCard label="装配覆盖" value={`${covered}/${total}`} />
      </div>

      {/* 首阻塞 */}
      {result.firstBlockedReasonCode && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="font-mono">首阻塞：{result.firstBlockedReasonCode}</span>
        </p>
      )}

      {/* 评估标量（仅真实评估后展示；否则全「—」） */}
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-foreground">
          评估标量
          {e === null && (
            <span className="ml-2 font-normal text-muted-foreground">
              本次运行未执行 evaluation 阶段 → 无标量（不推算）
            </span>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard label="总收益率" value={fmtPct(e?.totalReturnPct ?? null)} />
          <MetricCard label="年化收益率（CAGR）" value={fmtPct(e?.cagrPct ?? null)} />
          <MetricCard label="最大回撤" value={fmtPct(e?.maxDrawdownPct ?? null)} />
          <MetricCard label="Sharpe" value={fmtNum(e?.sharpeRatio ?? null)} />
          <MetricCard label="Sortino" value={fmtNum(e?.sortinoRatio ?? null)} />
          <MetricCard label="Calmar" value={fmtNum(e?.calmarRatio ?? null)} />
          <MetricCard label="胜率" value={fmtPct(e?.winRatePct ?? null)} />
          <MetricCard
            label="Profit Factor"
            value={fmtNum(e?.profitFactor ?? null)}
          />
          <MetricCard
            label="完成交易数"
            value={fmtInt(e?.completedTradeCount ?? null)}
          />
        </div>
      </div>

      {/* 装配覆盖明细 */}
      <div className="mt-4 rounded-md border bg-muted/20 px-3 py-2.5 text-[11px] leading-relaxed">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">执行器装配</span>
          {result.wiring.executorBound ? (
            <StatusBadge status="SUCCESS" label="EXECUTOR_BOUND" />
          ) : (
            <StatusBadge status="INFO" label="EXECUTOR_NOT_BOUND" />
          )}
          <span className="text-muted-foreground">
            已装配 {result.wiring.wiredStages.length} 阶段 / 尚无执行器{" "}
            {result.wiring.unwiredStages.length} 阶段
          </span>
        </div>
        {result.wiring.unwiredStages.length > 0 && (
          <p className="mt-1 font-mono text-muted-foreground">
            尚无执行器：{result.wiring.unwiredStages.join("、")}
          </p>
        )}
        {result.runnerInjected.length > 0 && (
          <p className="mt-1 font-mono text-muted-foreground">
            本次注入：{result.runnerInjected.join("、")}
          </p>
        )}
        {result.note && (
          <p className="mt-1 flex items-start gap-1.5 text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{result.note}</span>
          </p>
        )}
      </div>

      {/* 逐阶段轨迹 */}
      <div className="mt-4 overflow-x-auto rounded-md border">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="px-3 py-2">阶段</TableHead>
              <TableHead className="px-3 py-2">状态</TableHead>
              <TableHead className="px-3 py-2">产出</TableHead>
              <TableHead className="px-3 py-2">交接指纹</TableHead>
              <TableHead className="px-3 py-2">阻塞原因</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.stages.map(stage => (
              <TableRow key={stage.stageId}>
                <TableCell className="px-3 py-2 font-mono">
                  {stage.stageId}
                </TableCell>
                <TableCell className="px-3 py-2">
                  <StatusBadge status={stage.state} />
                </TableCell>
                <TableCell className="px-3 py-2 font-mono text-muted-foreground">
                  {stage.outputKind || "—"}
                </TableCell>
                <TableCell className="px-3 py-2 font-mono text-muted-foreground">
                  {stage.handoffFingerprint ? (
                    <span title={stage.handoffFingerprint}>
                      {shortHash(stage.handoffFingerprint)}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="px-3 py-2">
                  {stage.blockedReasonCode ? (
                    <div>
                      <span className="font-mono text-red-600">
                        {stage.blockedReasonCode}
                      </span>
                      {stage.blockedDetail && (
                        <p className="mt-0.5 max-w-xl text-[11px] leading-snug text-muted-foreground">
                          {stage.blockedDetail}
                        </p>
                      )}
                      {stage.errorCode && (
                        <p className="mt-0.5 font-mono text-[10px] text-red-600">
                          error: {stage.errorCode}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SectionCard>
  );
}
