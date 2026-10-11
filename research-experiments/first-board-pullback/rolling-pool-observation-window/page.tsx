/**
 * 首板滚动池 × 连续观察窗口（N × 最晚成交 L） × 再入场政策 × 固定 Runner —— 实验页面。
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
import type { ObservationWindowCustomPayload } from "./result";

const VERDICT_NOTE: Readonly<Record<string, string>> = {
  RIGHT_TAIL_EVIDENCE: "满足事前右尾证据条件（仍不构成可交易资格，也不是 OOS 通过）",
  RISK_TRADEOFF: "右尾有证据，但账户收益/均值代价恶化 ⇒ 只能作为风险权衡读数",
  INSUFFICIENT_EVIDENCE: "证据不足（不等同于证明无效）",
  NO_SUPPORT: "本配置在可实现尾率上劣于同日同池随机选择",
  NO_TRIGGER_IN_WINDOW: "本窗口内没有买点候选 ⇒ 尾率不可定义（不是数据失败）",
};

function renderCell(value: unknown, digits: number): string {
  if (typeof value === "number") return value.toFixed(digits);
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function pct(value: number | null | undefined, digits = 4): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export default function RollingPoolObservationWindowPage({
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

  const custom = (result.customPayload ?? {}) as Partial<ObservationWindowCustomPayload>;
  const summary = result.sampleSummary;
  const tables = result.tables ?? [];
  const frozen = custom.frozenConfig ?? null;
  const groups = custom.groupSummaries ?? [];
  const primary = custom.primaryComparison ?? null;
  const coverage = custom.coverage ?? null;
  const studyVerdict = custom.studyVerdict ?? null;

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">滚动池 · 连续观察窗口 × 再入场政策 · 固定 Runner（冻结）</CardTitle>
          <CardDescription className="text-xs">
            {frozen
              ? `窗口 ${frozen.mainWindowStart} ~ ${frozen.mainWindowEnd} · ` +
                `守线 ${frozen.supportRatio} · 缩量 ${frozen.shrinkRatio} · 观察分 ≥ ${frozen.observationMinScore} · ` +
                `TopK ${frozen.dailyTopK} · 每组 Random ${frozen.randomAccountCount} 账户（基址 ${frozen.randomSeedIndexBase}） · ` +
                `仓位 ${(frozen.positionFraction * 100).toFixed(0)}% 权益 · 初始资金 ${frozen.initialCapital} 元 · ` +
                `持仓上限 ${frozen.maxPositions} / 每日新买 ${frozen.maxDailyBuys} · ` +
                `账户合计 ${frozen.totalAccountCount}`
              : "本实验的冻结配置见结果元数据。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>
            候选事件 {summary.candidateCount} · 入池事件 {summary.eligibleCount} · 剔除{" "}
            {summary.excludedCount}
          </p>
          <p className="font-medium text-foreground">
            五组（A..E）在**同一个 Run** 内执行，共享一次端口读取的滚动池；两臂都走**真实撮合**
            （既有唯一 <code>runTradeSimulation</code>）与**同一份冻结退出政策**。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">唯一主要比较：D_R − B_R</CardTitle>
          <CardDescription className="text-xs">
            同 T+20、同允许再入场下，5 日观察相对 2 日观察的 ≥+20% 尾率差（配对日期块 bootstrap；
            block20 主 / block40 敏感性 / 锚点链敏感性）。次要比较不作为确认性判据。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {primary ? (
            <div className="rounded border p-2">
              <div className="font-mono">
                <strong>{primary.key}</strong>：点估计 {primary.pointEstimate?.toFixed(6) ?? "—"} ·
                block20 [{primary.low?.toFixed(6) ?? "—"}, {primary.high?.toFixed(6) ?? "—"}] ·
                block40 下界 {primary.sensitivityLow?.toFixed(6) ?? "—"} · 锚点链下界{" "}
                {primary.anchorChainLow?.toFixed(6) ?? "—"}
              </div>
              <div className="text-muted-foreground">
                样本门槛：{primary.sampleGateMet ? "满足" : "未满足"} · 同靶同向年度{" "}
                {primary.sameDirectionYears.join(" / ") || "无"} · 零分母迭代{" "}
                {primary.zeroDenominatorIterations} · 日历长度 {primary.calendarLength} · 结论{" "}
                {primary.supported ? "支持（探索性）" : "不支持/证据不足"}
              </div>
              <div className="mt-1 text-muted-foreground">{primary.note}</div>
            </div>
          ) : (
            <p>主比较缺失（结果不完整）。</p>
          )}
          {studyVerdict ? (
            <div className="rounded border p-2">
              <div className="font-mono">
                <strong>全研究收口：{studyVerdict.verdict}</strong>
              </div>
              <div className="text-muted-foreground">
                {VERDICT_NOTE[studyVerdict.verdict] ?? ""}
              </div>
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {(studyVerdict.reasons ?? []).map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">五组读数（R 臂）</CardTitle>
          <CardDescription className="text-xs">
            A/B/C/D 只改 N、L；D/E 只改再入场政策。组内 201 个账户共享**同一个** simulationConfig。
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>组</TableHead>
                <TableHead className="text-right">N</TableHead>
                <TableHead className="text-right">L</TableHead>
                <TableHead>再入场</TableHead>
                <TableHead className="text-right">候选日</TableHead>
                <TableHead className="text-right">触发锚点</TableHead>
                <TableHead className="text-right">再触发日</TableHead>
                <TableHead className="text-right">成交</TableHead>
                <TableHead className="text-right">已平仓</TableHead>
                <TableHead className="text-right">R ≥+20%</TableHead>
                <TableHead className="text-right">Random ≥+20%</TableHead>
                <TableHead className="text-right">尾率差</TableHead>
                <TableHead className="text-right">R 总收益</TableHead>
                <TableHead>判定</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.groupId}>
                  <TableCell className="text-xs">{group.groupId}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{group.observationDays}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{group.entryFillMaxRd}</TableCell>
                  <TableCell className="text-xs">
                    {group.reentryKind}
                    {group.reentryPolicy.maxEntriesPerMember === null ? "" : "（锚点 1 次）"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{group.decisionDateCount}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{group.triggerAnchorCount}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{group.retriggerDayCount}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{group.fillCount}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{group.rCompletedTradeCount}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{pct(group.rTail20Rate)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {pct(group.randomPooledTail20Rate)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {group.tail20RateDifference?.toFixed(6) ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {renderCell(group.rTotalReturnPct, 4)}%
                  </TableCell>
                  <TableCell className="text-xs">{group.verdict}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {coverage ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              数据覆盖与可观测性（期末未平仓 {coverage.tradesOpenAtEnd} 笔）
            </CardTitle>
            <CardDescription className="text-xs">
              三分类为**实验侧启发式**：正常期末 MTM {coverage.mtmValidCount} · 无执行 bar{" "}
              {coverage.noExecutionBarCount} · 停牌无法卖出 {coverage.suspendedCannotSellCount}（重叠{" "}
              {coverage.mtmValidWithRejectedSellEvidenceCount}）。完整跑完 Runner 需要约 rd
              {coverage.requiredPostRelativeDayForFullRunner}（物理上界 rd
              {coverage.physicalPostMaxRelativeDay}）。
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              Runner 可观测性 = {coverage.runnerTriggerObservability}：持有到 74 持有日的{" "}
              {coverage.heldToExtendedCapCount} 笔只作**计数**；触发与否在该契约上不可区分，
              **不**做退出消融、**不**声称 Runner 从未触发。
            </p>
            <p className="mt-1">{coverage.runnerObservabilityNote}</p>
            <p className="mt-1">{coverage.classifierNote}</p>
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
          <CardDescription className="text-xs">必须在读结论之前读这一段。</CardDescription>
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
