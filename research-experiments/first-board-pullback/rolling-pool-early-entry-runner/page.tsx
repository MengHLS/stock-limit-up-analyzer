/**
 * 首板滚动池 × 连续观察买点 × 固定 Runner —— 实验页面。
 *
 * 🔴 页面契约只有两个 props；**不自己发请求**（执行入口在服务端只有一套）；
 *    **不得**运行时 import `server/**` 或 `./experiment`（跑在浏览器里）。
 *
 * ⚠️ 实况（如实登记）：平台今天的 Run 详情页用**通用信封渲染器**
 *    （`GenericExperimentResult`）展示 `tables` / `statistics` / `charts`，
 *    本页目前作为「实验自己的页面」登记但未必被挂载。因此**关键数字全部进信封**
 *    （见 `result.ts`），本页只做同一批数字的另一视角呈现。
 */

import { Beaker } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/common";
import type { ExperimentPageProps } from "@/researchExperiments/contract";
import type { EarlyEntryRunnerCustomPayload } from "./result";

const VERDICT_NOTE: Readonly<Record<string, string>> = {
  RIGHT_TAIL_EVIDENCE: "满足事前右尾证据条件（仍不构成可交易资格）",
  RISK_TRADEOFF: "右尾有证据，但账户收益/回撤代价恶化 ⇒ 只能作为风险权衡读数",
  INSUFFICIENT_EVIDENCE: "证据不足（不等同于证明无效）",
  NO_SUPPORT: "本配置在可实现尾率上劣于同日同池随机选择",
};

function renderCell(value: unknown, digits: number): string {
  if (typeof value === "number") return value.toFixed(digits);
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

export default function RollingPoolEarlyEntryRunnerPage({
  descriptor,
  outcome,
}: ExperimentPageProps) {
  const result = outcome?.result ?? null;

  if (result === null) {
    return (
      <Card data-experiment-page={descriptor.pageKey}>
        <CardContent className="p-6">
          <EmptyState
            icon={Beaker}
            title="尚未运行"
            description="选择 Dataset 版本（first_limit_pullback / v10-listed365-pre10-post80）后点击「运行」。"
          />
        </CardContent>
      </Card>
    );
  }

  const custom = (result.customPayload ?? {}) as Partial<EarlyEntryRunnerCustomPayload>;
  const summary = result.sampleSummary;
  const tables = result.tables ?? [];
  const frozen = custom.frozenConfig ?? null;
  const rAccount = custom.rAccount ?? null;
  const coverage = custom.coverage ?? null;

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">滚动池 · 连续观察买点 · 固定 Runner（冻结）</CardTitle>
          <CardDescription className="text-xs">
            {frozen
              ? `窗口 ${frozen.mainWindowStart} ~ ${frozen.mainWindowEnd} · ` +
                `买点 rd${frozen.confirmMinRd}..${frozen.confirmMaxRd} 确认 / rd ≤ ${frozen.entryFillMaxRd} 成交 · ` +
                `守线 ${frozen.supportRatio} · 缩量 ${frozen.shrinkRatio} · 观察分 ≥ ${frozen.observationMinScore} · ` +
                `TopK ${frozen.dailyTopK} · Random ${frozen.randomAccountCount} 账户（基址 ${frozen.randomSeedIndexBase}） · ` +
                `仓位 ${(frozen.positionFraction * 100).toFixed(0)}% 权益 · 初始资金 ${frozen.initialCapital} 元 · ` +
                `持仓上限 ${frozen.maxPositions} / 每日新买 ${frozen.maxDailyBuys}`
              : "本实验的冻结配置见结果元数据。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>
            候选事件 {summary.candidateCount} · 入池事件 {summary.eligibleCount} · 剔除{" "}
            {summary.excludedCount} · T+10 违规 {custom.tPlusTenViolationCount ?? "—"}
          </p>
          <p className="font-medium text-foreground">
            两臂都走**真实撮合**（既有唯一 <code>runTradeSimulation</code>）与**同一份冻结退出政策**；
            因子 <code>maxAmp5</code> 完全不参与。这仍不是投资建议，也不是盈利承诺。
          </p>
          {rAccount ? (
            <p>
              R：复合总收益 {renderCell(rAccount.totalReturnPct, 4)}% · 最大回撤{" "}
              {renderCell(rAccount.maxDrawdownPct, 4)}% · 交易 {rAccount.tradeCount} 笔 · 已平仓{" "}
              {rAccount.completedTradeCount} 笔 · 期末未平仓 {rAccount.openAtEndCount} 笔 · 被跳过意图{" "}
              {rAccount.skippedIntentCount} 条
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">研究判定（事前收口规则）</CardTitle>
          <CardDescription className="text-xs">
            判定只回答「本配置在本窗口里有没有尾部证据」，不是策略晋级结论。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="rounded border p-2">
            <div className="font-mono">
              <strong>{custom.verdict?.verdict ?? "—"}</strong>
            </div>
            <div className="text-muted-foreground">
              {VERDICT_NOTE[custom.verdict?.verdict ?? ""] ?? ""}
            </div>
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {(custom.verdict?.reasons ?? []).map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {coverage ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              数据覆盖阻断（{coverage.dataCoverageBlockedTrades} 笔 · 占{" "}
              {renderCell(coverage.dataCoverageBlockedSharePct, 2)}%）
            </CardTitle>
            <CardDescription className="text-xs">
              物理 post 上界 rd{coverage.physicalPostMaxRelativeDay}；完整跑完 Runner 需要约 rd
              {coverage.requiredPostRelativeDayForFullRunner}。按目标 §6 处置 C-1：不缩短政策、
              不在 rd80 强制卖出、不剔除长持赢家。
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <p>{coverage.note}</p>
            <p className="mt-1">
              期末未平仓 {coverage.tradesOpenAtEnd} 笔 · 达到 Runner 续持上界{" "}
              {coverage.runnerExtensionReachedTrades} 笔 · 两者交集{" "}
              {coverage.runnerExtensionReachedOpenAtEndTrades} 笔
            </p>
          </CardContent>
        </Card>
      ) : null}

      {tables.map((table) => (
        <Card key={table.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{table.title}</CardTitle>
            {table.description ? (
              <CardDescription className="text-xs">{table.description}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {table.columns.map((column) => (
                    <TableHead
                      key={column.key}
                      className={column.align === "RIGHT" ? "text-right" : undefined}
                    >
                      {column.label}
                      {column.unit ? `（${column.unit}）` : ""}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.slice(0, 200).map((row, index) => (
                  <TableRow key={index}>
                    {table.columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={
                          column.align === "RIGHT"
                            ? "text-right font-mono text-xs tabular-nums"
                            : "text-xs"
                        }
                      >
                        {renderCell(row[column.key], column.digits ?? 2)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {table.rows.length > 200 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                仅显示前 200 行（共 {table.rows.length} 行）；完整数据见 Run 产物 CSV。
              </p>
            ) : null}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">证据限制与契约缺口</CardTitle>
          <CardDescription className="text-xs">
            必须在读结论之前读这一段。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          {(custom.contractGaps ?? []).map((gap, index) => (
            <p key={index}>• {gap}</p>
          ))}
          {(summary.notes ?? []).map((note, index) => (
            <p key={`n-${index}`}>• {note}</p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
