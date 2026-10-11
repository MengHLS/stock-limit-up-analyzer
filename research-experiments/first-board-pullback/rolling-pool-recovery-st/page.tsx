/**
 * 首板滚动池 × 破位修复再触发 × 每日 ST 硬闸门 —— 实验页面。
 *
 * 🔴 页面契约只有两个 props；**不自己发请求**（执行入口在服务端只有一套）；
 *    **不得**运行时 import `server/**` 或 `./experiment`（跑在浏览器里）。
 *
 * ⚠️ 实况（如实登记）：平台今天的 Run 详情页用**通用信封渲染器**
 *    （`GenericExperimentResult`）展示 `tables` / `statistics` / `charts`，
 *    本页作为「实验自己的页面」登记但未必被挂载。因此**关键数字全部进信封**
 *    （见 `result.ts`），本页只做同一批数字的另一视角呈现。
 *
 * 🔴 本实验当前**必然**以 `ST_COVERAGE_BLOCKED` 结束（无可 PIT 核验的 ST 源）：
 *    页面把这条状态放在最上方，避免读者把「没有矩阵」误读成「空仓 = 无效」。
 */

import { AlertTriangle, Beaker } from "lucide-react";
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
import type { RecoveryStCustomPayload } from "./result";

/**
 * 页面对 payload 的**窄化视图**。
 *
 * 🔴 为什么不用 `customPayload` 的推断类型：schema 里嵌套结构刻意用宽松
 *    `z.record`/`z.unknown`（细节字段以后只增不改，页面不该因为加一个字段就红）。
 *    页面只读它显示的这几个字段，因此这里显式声明它们。
 */
interface PageCoverageRow {
  readonly universeAnchorCount?: number;
  readonly hitAnchorCount?: number;
  readonly coverage?: number | null;
  readonly uniqueStockHitCount?: number;
}

interface PageGroupRow {
  readonly group?: string;
  readonly breachPolicy?: string;
  readonly triggerAnchorCount?: number;
  readonly breachedAnchorCount?: number;
  readonly recoverySignalCount?: number;
  readonly dailyUnknownBlockedDayCount?: number;
  readonly dailyStBlockedDayCount?: number;
  readonly coverage?: PageCoverageRow;
}

interface PageGapRow {
  readonly anchorEventId?: string;
  readonly group?: string;
  readonly tradeDate?: string;
  readonly timepoint?: string;
  readonly reason?: string;
}

interface PageStCoverageRow {
  readonly status?: string;
  readonly contractVersion?: string;
  readonly providerId?: string;
  readonly candidateCount?: number;
  readonly timepointChecks?: number;
  readonly verifiedNormalCount?: number;
  readonly stRejectedCount?: number;
  readonly unknownCount?: number;
  readonly gapSamples?: readonly PageGapRow[];
}

interface PageFrozenConfigRow {
  readonly mainWindowStart?: string;
  readonly mainWindowEnd?: string;
  readonly positionFraction?: number;
  readonly maxPositions?: number;
  readonly maxDailyBuys?: number;
  readonly dailyTopK?: number;
  readonly repairWindowDays?: number;
  readonly repairScoreTotalMin?: number;
  readonly randomAccountCount?: number;
  readonly randomSeedIndexBase?: number;
  readonly totalAccountCount?: number;
}

interface PageRunModeRow {
  readonly mode?: string;
  readonly totalAccountCount?: number;
}

/** 暂停终态的缺口明细（页面只读它显示的字段）。 */
interface PageBlockedDetailRow {
  readonly plannedCandidateCount?: number;
  readonly unknownBlockedCandidateCount?: number;
  readonly candidatesWithoutPlannedFillCount?: number;
  readonly timepointChecks?: number;
  readonly unknownTimepointCheckCount?: number;
  readonly blockedReasons?: readonly string[];
  readonly notEmittedMetrics?: readonly string[];
}

/** provider 身份（暂停终态里必须显示：读者要知道**缺的是哪个源**）。 */
interface PageProviderRow {
  readonly providerId?: string;
  readonly contractVersion?: string | null;
  readonly source?: string;
  readonly verifiable?: boolean;
}

interface PagePrimaryRow {
  readonly key?: string;
  readonly pointEstimate?: number | null;
  readonly sampleGateMet?: boolean;
  readonly supported?: boolean;
  readonly note?: string;
  readonly gateReason?: string;
}

function renderCell(value: unknown, digits: number): string {
  if (typeof value === "number") return value.toFixed(digits);
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

export default function RollingPoolRecoveryStPage({ descriptor, outcome }: ExperimentPageProps) {
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

  const custom = (result.customPayload ?? {}) as Partial<RecoveryStCustomPayload>;
  const summary = result.sampleSummary;
  const tables = result.tables ?? [];
  const frozen = (custom.frozenConfig ?? null) as PageFrozenConfigRow | null;
  const runMode = (custom.runMode ?? null) as PageRunModeRow | null;
  const groups = (custom.groups ?? []) as readonly PageGroupRow[];
  const stCoverage = (custom.stCoverage ?? null) as PageStCoverageRow | null;
  const stBlocked = custom.status === "ST_COVERAGE_BLOCKED"
    || (stCoverage !== null && stCoverage.status === "ST_COVERAGE_BLOCKED");
  const primary = (custom.primaryComparison ?? null) as PagePrimaryRow | null;
  const gapSamples = stCoverage?.gapSamples ?? [];
  const blockedDetail = (custom.stCoverageBlocked ?? null) as PageBlockedDetailRow | null;
  const provider = (custom.stProvider ?? null) as PageProviderRow | null;
  const matrixEmitted = custom.matrixEmitted === true;

  return (
    <div className="space-y-4" data-experiment-page={descriptor.pageKey}>
      <Card className={stBlocked ? "border-destructive" : undefined}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {stBlocked ? <AlertTriangle className="h-4 w-4 text-destructive" /> : null}
            首板滚动池 · 破位修复再触发 × 每日 ST 硬闸门（冻结）
          </CardTitle>
          <CardDescription className="text-xs">
            {frozen
              ? `窗口 ${frozen.mainWindowStart} ~ ${frozen.mainWindowEnd} · `
                + `仓位 ${((frozen.positionFraction ?? 0) * 100).toFixed(0)}% 权益 · `
                + `持仓上限 ${frozen.maxPositions} / 每日新买 ${frozen.maxDailyBuys} · TopK ${frozen.dailyTopK} · `
                + `修复窗口 ${frozen.repairWindowDays} 日 / 综合分 ≥ ${frozen.repairScoreTotalMin} · `
                + `两组 Random ${frozen.randomAccountCount} 账户（基址 ${frozen.randomSeedIndexBase}） · `
                + `账户合计 ${frozen.totalAccountCount}`
              : "本实验的冻结配置见结果元数据。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          {stBlocked ? (
            <p className="font-medium text-destructive">
              🔴 ST 覆盖不足 ⇒ `ST_COVERAGE_BLOCKED`：**没有**产出收益矩阵。
              任何计划候选资格 / 潜在成交检查时点缺可核验 NORMAL 或 ST 结论时，按目标 §4 默认暂停矩阵，
              只交付覆盖缺口 —— 这不是「空仓结果」，也不能用它评价新买点。
            </p>
          ) : null}
          <p>
            候选事件 {summary.candidateCount} · 入池事件 {summary.eligibleCount} · 剔除{" "}
            {summary.excludedCount}
            {runMode ? ` · 运行模式 ${runMode.mode}（${runMode.totalAccountCount} 账户）` : ""}
          </p>
          {stCoverage ? (
            <p>
              ST 闸门契约 {String(stCoverage.contractVersion)} · provider {String(stCoverage.providerId)} ·
              候选 {String(stCoverage.candidateCount)} · 检查点 {String(stCoverage.timepointChecks)} ·
              NORMAL {String(stCoverage.verifiedNormalCount)} / ST {String(stCoverage.stRejectedCount)} / UNKNOWN{" "}
              {String(stCoverage.unknownCount)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">唯一主要比较：`B_R − A_R`（≥+20% 唯一锚点覆盖率差）</CardTitle>
          <CardDescription className="text-xs">
            分母 = **共同且数据资格可核实的锚点宇宙**（不是各组成交数）；聚类键 = 每个共同锚点
            **首次进入观察池**的日期；配对日期块 bootstrap 1000 次（block20 主 / block40 敏感性 / 95%，
            共享日历、空日保留、共享抽样索引）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {primary ? (
            <div className="rounded border p-2">
              <div className="font-mono">
                <strong>{String(primary.key)}</strong>：点估计{" "}
                {typeof primary.pointEstimate === "number" ? primary.pointEstimate.toFixed(6) : "—"} ·
                样本门槛 {primary.sampleGateMet === true ? "满足" : "未满足"} · 结论{" "}
                {primary.supported === true ? "支持（探索性）" : "证据不足 / 不支持"}
              </div>
              <div className="mt-1 text-muted-foreground">{String(primary.note ?? "")}</div>
              <div className="mt-1 text-muted-foreground">{String(primary.gateReason ?? "")}</div>
            </div>
          ) : (
            <p className={stBlocked ? "font-medium text-destructive" : undefined}>
              {stBlocked
                ? "🔴 主比较**未产出**（`ST_COVERAGE_BLOCKED`）—— 这不是 0，也不是「证据不足」；"
                  + "补 ST 逐日可核验状态后再跑。"
                : "主比较缺失（结果不完整）。"}
            </p>
          )}
        </CardContent>
      </Card>

      {stBlocked ? (
        <Card className="border-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">ST 覆盖缺口（暂停终态：`matrixEmitted = {String(matrixEmitted)}`）</CardTitle>
            <CardDescription className="text-xs">
              缺失的 provider 身份：{String(provider?.providerId ?? stCoverage?.providerId ?? "—")}
              {provider ? `（契约 ${String(provider.contractVersion ?? "—")} · 来源 ${String(provider.source ?? "—")}`
                + ` · 可核验 ${provider.verifiable === true ? "是" : "否"}）` : ""}
              ；目标 §4：先交付覆盖缺口与补数影响，**不用**空仓结果评价新买点。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p className="text-foreground">
              计划候选 {renderCell(blockedDetail?.plannedCandidateCount, 0)} 个 · UNKNOWN_BLOCKED{" "}
              {renderCell(blockedDetail?.unknownBlockedCandidateCount, 0)} 个 · 无计划成交时点{" "}
              {renderCell(blockedDetail?.candidatesWithoutPlannedFillCount, 0)} 个 · 检查点{" "}
              {renderCell(blockedDetail?.timepointChecks, 0)} 格（UNKNOWN{" "}
              {renderCell(blockedDetail?.unknownTimepointCheckCount, 0)}）
            </p>
            {(blockedDetail?.blockedReasons ?? []).map((reason, index) => (
              <p key={`r-${index}`}>• 阻断原因：{reason}</p>
            ))}
            {(blockedDetail?.notEmittedMetrics ?? []).length > 0 ? (
              <div>
                <p className="font-medium text-foreground">刻意未产出的读数（逐条）：</p>
                {(blockedDetail?.notEmittedMetrics ?? []).map((metric, index) => (
                  <p key={`m-${index}`}>• {metric}</p>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">两组读数</CardTitle>
          <CardDescription className="text-xs">
            A = 003 的 D（破位后永久停买，继续观察）；B = 未破位同 A，破位后走修复分支。
            两者是**机制级**对照（同时改变局部支撑与观察聚合），不能称为单因素效应。
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>组</TableHead>
                <TableHead>破位后处置</TableHead>
                <TableHead className="text-right">触发锚点</TableHead>
                <TableHead className="text-right">破位锚点</TableHead>
                <TableHead className="text-right">修复信号</TableHead>
                <TableHead className="text-right">共同宇宙锚点</TableHead>
                <TableHead className="text-right">≥+20% 唯一锚点</TableHead>
                <TableHead className="text-right">覆盖率（%）</TableHead>
                <TableHead className="text-right">UNKNOWN_BLOCKED 日</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group, index) => (
                <TableRow key={`${String(group.group)}-${index}`}>
                  <TableCell className="text-xs">{String(group.group)}</TableCell>
                  <TableCell className="text-xs">{String(group.breachPolicy)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {renderCell(group.triggerAnchorCount, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {renderCell(group.breachedAnchorCount, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {renderCell(group.recoverySignalCount, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {renderCell(group.coverage?.universeAnchorCount, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {renderCell(group.coverage?.hitAnchorCount, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {renderCell(
                      typeof group.coverage?.coverage === "number"
                        ? (group.coverage.coverage as number) * 100
                        : null,
                      4,
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {renderCell(group.dailyUnknownBlockedDayCount, 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {stCoverage !== null && stCoverage.gapSamples?.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">ST 覆盖缺口样例（前 {stCoverage.gapSamples.length} 条）</CardTitle>
            <CardDescription className="text-xs">
              缺失一律记 UNKNOWN（**不伪造 NORMAL**）；完整缺口按原因 / 时点计数在信封与日志里。
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>锚点</TableHead>
                  <TableHead>组</TableHead>
                  <TableHead>交易日</TableHead>
                  <TableHead>时点</TableHead>
                  <TableHead>原因</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stCoverage.gapSamples.slice(0, 50).map((gap, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-mono text-xs">{gap.anchorEventId}</TableCell>
                    <TableCell className="text-xs">{gap.group}</TableCell>
                    <TableCell className="font-mono text-xs">{gap.tradeDate}</TableCell>
                    <TableCell className="text-xs">{gap.timepoint}</TableCell>
                    <TableCell className="text-xs">{gap.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                仅显示前 200 行（共 {table.rows.length} 行）；完整数据见 Run 产物。
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
