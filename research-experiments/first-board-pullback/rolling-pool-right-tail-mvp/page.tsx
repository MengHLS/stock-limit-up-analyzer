/**
 * 首板滚动观察池 × 每日右尾识别 —— 实验页面。
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
import type { RollingPoolCustomPayload } from "./result";

const VERDICT_NOTE: Readonly<Record<string, string>> = {
  RIGHT_TAIL_EVIDENCE: "满足事前右尾证据条件（仍不构成可交易资格）",
  RISK_TRADEOFF: "右尾有证据，但左尾或净均值代价显著 ⇒ 只能作为风险权衡使用",
  INSUFFICIENT_EVIDENCE: "证据不足（不等同于证明无效）",
  NO_SUPPORT: "本配置无支持",
};

function renderCell(value: unknown, digits: number): string {
  if (typeof value === "number") return value.toFixed(digits);
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

export default function RollingPoolRightTailMvpPage({
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

  const custom = (result.customPayload ?? {}) as Partial<RollingPoolCustomPayload>;
  const summary = result.sampleSummary;
  const tables = result.tables ?? [];

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">滚动池 · 协议与范围（冻结）</CardTitle>
          <CardDescription className="text-xs">
            {custom.frozenConfig
              ? `窗口 ${custom.frozenConfig.mainWindowStart} ~ ${custom.frozenConfig.mainWindowEnd} · ` +
                `留池 rd${custom.frozenConfig.watchMinAge}..${custom.frozenConfig.watchMaxAge} · ` +
                `可选下界 rd${custom.frozenConfig.selectableAgeLowerBound} · TopK ${custom.frozenConfig.topK} · ` +
                `Random ${custom.frozenConfig.randomDrawCount} 种子（基址 ${custom.frozenConfig.randomSeedBase}） · ` +
                `往返 ${custom.frozenConfig.roundTripCostBpsPrimary}bps 主 / ${custom.frozenConfig.roundTripCostBpsSensitivity}bps 敏感性`
              : "本实验的冻结配置见结果元数据。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>
            候选事件 {summary.candidateCount} · 入池事件 {summary.eligibleCount} · 剔除{" "}
            {summary.excludedCount}
          </p>
          <p className="font-medium text-foreground">
            这是研究标签口径（假设下一交易日开盘入场、持有 20 交易日），
            <strong>不是</strong>平台 NEXT_OPEN 策略回测，也不构成任何投资资格。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">研究判定（事前收口规则）</CardTitle>
          <CardDescription className="text-xs">
            判定只回答「本配置在本窗口里有没有证据」，不是策略晋级结论。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(custom.verdicts ?? []).map((item) => (
            <div key={item.arm} className="rounded border p-2 text-xs">
              <div className="font-mono">
                {item.arm} → <strong>{item.verdict}</strong>
              </div>
              <div className="text-muted-foreground">
                {VERDICT_NOTE[item.verdict] ?? ""}
              </div>
              {(item.reasons ?? []).length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {item.reasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

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
