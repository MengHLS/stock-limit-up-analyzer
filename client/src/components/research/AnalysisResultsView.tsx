/**
 * AnalysisResultsView — 单个分析的落库结果视图。
 *
 * 展示纪律（与后端 `research_result` 的结构对齐）：
 *   - **分组块**：行 = 分组（Q1..Q10 / T+1..T+20 / 年度 / 条件组），列 = 指标；
 *     每格同时给出「该指标的样本数」——因为同一分组内不同指标的分母**本来就可能不同**
 *     （收益序列长度 vs 回撤列非空数）。用一个「组样本数」覆盖全部属于伪造分母，
 *     所以这里在分母不一致时显式标注「分母不一致」。
 *   - **标量块**：顶底分差 / 差值 / 组间差 p 值等整体性指标单独成表。
 *   - `null` 一律显示 `—`：指标「定义了但算不出来」是合法状态，不显示为 0。
 *   - 逐行 `details.lowSample` / `details.definition` 如实呈现，不吞掉小样本告警。
 *
 * 可读性（2026-09-12 第一轮，「结果页很乱」的对症改动）：
 *   - **默认只显示核心列**（样本数 / 均值 / 中位数 / 胜率 / 标准差 / 回撤）。十几个指标列
 *     并排要横向滚动、且多数列对「这个问题在问什么」没有帮助 —— 其余列折叠到
 *     「显示全部指标」后面，**不删只藏**；
 *   - 分组表把「样本数」摆在第一列，并且**分母一致时不再逐格重复 `n=`**（只在该组标签处
 *     写一次）——同一张表里同一个数字出现 N 次是纯噪音；
 *   - `metricCode` 这类工程信息不再占一列（改为单元格 `title`，鼠标悬停可查）；
 *   - 底部口径说明收进可折叠区。
 *
 * 可读性（2026-09-12 第二轮，「结果不直观 / 看不懂在说什么」的对症改动）：
 *   - **结论速览卡**：把「哪一组最好 / 好多少 / 显著不显著」提到最前，并把引擎写入的
 *     **差值口径**原样带出（`DIFFERENCE = mean(条件样本) − mean(全样本)`）；
 *   - **分档区间**：分组标签下写出该组覆盖的**变量取值区间**（由落库 `cutPoints` 反解）。
 *     起因是一个真实误读：结论写「第 5 档 − 第 1 档 = −1.8%」，而档 5 实际是「5 日内跌幅
 *     最小（甚至上涨）」那批 —— 档号不含方向，不给区间就只能猜，且极易猜反；
 *   - **分档条形**：主指标列给**共用横轴（含 0）**的条 + 0 参考线，单调性与符号一眼可见；
 *   - **差值口径上表**：把「谁减谁」显示在指标名下方，避免把「条件组 vs 全样本」误读成
 *     「条件组 vs 对照组」（引擎**只落库**全样本与条件组两组；对照组由前端反推，见第三轮）。
 *
 * 可读性（2026-09-12 第三轮，「加的统计图有点问题 / 还是不直观」的对症改动）：
 *   - **删掉单元格里的迷你条**（原 `ValueBar`）。它有两处硬伤：一是只有 ~72px 宽、1.5px 高，
 *     还随表格横向滚动跑出视口；二是**负值条宽度算错**了 —— 锚点取 `min(value, 0)` 之后再算
 *     `value − anchor`，`value < 0` 时该差恒为 0，被 `Math.max(…, 0.8)` 兜成一条看不见的细线，
 *     于是「有正有负」的分档图看起来**只剩正值那几档有数据**。改为独立的 `GroupMetricChart`：
 *     每档一行、共用**含 0** 的 x 轴、`0` 参考线、涨红跌绿；
 *   - **条件分析补出对照组**：`estimateExcludedGroupMean` 用恒等式
 *     `n_all · M_all = n_c · M_c + (n_all − n_c) · M_rest` 反推「不满足条件」那组
 *     （数学精确、非估计），图上以浅色虚线条明确标注「反推」—— 此前只给「条件组 vs 全样本」，
 *     「破 vs 不破差多少」得人工心算，且极易把分母读成另一组；
 *   - 表格回归**纯数字**，不再承担图形职责；主指标列加粗高亮，明确「该看哪一列」。
 *
 * 可读性（2026-09-12 第四轮，`DESCRIPTIVE` 多变量结果的呈现）：`volume_ratio_1d..5d` 这类
 * 「同一变量、不同滞后日」的结果，横轴是**时间**，用分组条形图会把它拍成一堆并列类别 ——
 * 「逐日衰减」这个唯一的信息就没了。因此新增 `buildVariableSeries` + `VariableSeriesChart`：
 *   - 折线（x = T+1…T+5），**基准线画在语义基准**（量比 = 1 倍「与涨停日持平」，不是 0）；
 *   - **中位数与均值同时画**：本数据集里该序列偏度 11.7~28.2、峰度 262~1217，均值全程 > 1
 *     （读成「一直在放量」）而中位数 T+3 起 < 1（实为缩量）—— 只给一个数字等于替读者做了
 *     一次未经说明的口径选择；偏度超阈值时图上直接提示「以中位数为准」；
 *   - 顺带修正 `variableLabelOf` 缺失的 `volume_ratio` 中文名（此前行标签显示成
 *     「volume_ratio T+1」这种半工程名）。
 *
 * 已知边界：**分析级 notes 不落库**（`AnalysisSummary.notes` 只进结论的 evidence）。
 * 因此本视图不声称展示全部注意事项，而是提示去「结论」页签看引擎记录的分组退化 / 变量缺失说明。
 */

import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Info } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/common";
import { GroupMetricChart } from "./GroupMetricChart";
import { VariableSeriesChart } from "./VariableSeriesChart";
import {
  buildGroupBlocks,
  buildHeadline,
  buildScalarRows,
  buildVariableSeries,
  estimateExcludedGroupMean,
  formatCount,
  formatMetricValue,
  metricCodesInOrder,
  metricLabelOf,
  rpcErrorToDiagnostic,
  type ResultRowLike,
} from "@/adapters/researchEngineAdapter";

/**
 * 默认可见的分组指标列。
 *
 * 选取标准：**能直接回答「哪一档更好 / 好多少 / 稳不稳」**。
 * 分位数（P01…P99）、盈亏比、偏度峰度等留在「显示全部指标」里 —— 它们不是无用，
 * 而是第二眼才需要，默认铺开只会把第一眼的结论淹掉。
 */
const DEFAULT_VISIBLE_GROUP_METRICS: readonly string[] = [
  "SAMPLE_COUNT",
  "MEAN_RETURN",
  "MEAN",
  "MEDIAN_RETURN",
  "MEDIAN",
  "WIN_RATE",
  "STD_RETURN",
  "STD",
  "MAX_DRAWDOWN",
];

/** 兜底：默认集合与结果无交集时，至少给出前几列（避免出现「什么列都没有」的空表）。 */
const FALLBACK_VISIBLE_COLUMN_COUNT = 4;

/**
 * 可反推「对照组」的指标码。
 *
 * 只有**均值型**指标能用 `estimateExcludedGroupMean` 的恒等式反推 —— 中位数、标准差、
 * 分位数都是非线性统计量，给不出「剩下的样本」的值（那会变成真正的估计/假设）。
 */
const ESTIMATABLE_METRIC_CODES: readonly string[] = ["MEAN_RETURN", "MEAN", "WIN_RATE"];

export function AnalysisResultsView({ analysisId }: { analysisId: number }) {
  const results = trpc.researchEngine.getAnalysisResults.useQuery({ analysisId });
  const [showAllMetrics, setShowAllMetrics] = useState(false);

  const rows = (results.data ?? []) as ResultRowLike[];

  const groupBlocks = useMemo(() => buildGroupBlocks(rows), [rows]);
  const scalarRows = useMemo(() => buildScalarRows(rows), [rows]);
  const allCodes = useMemo(
    () => metricCodesInOrder(rows.filter((r) => r.resultType === "GROUPED")),
    [rows],
  );

  const coreCodes = useMemo(
    () => allCodes.filter((code) => DEFAULT_VISIBLE_GROUP_METRICS.includes(code)),
    [allCodes],
  );
  const columnCodes = useMemo(() => {
    if (showAllMetrics) return allCodes;
    return coreCodes.length > 0 ? coreCodes : allCodes.slice(0, FALLBACK_VISIBLE_COLUMN_COUNT);
  }, [allCodes, coreCodes, showAllMetrics]);
  const hiddenColumnCount = allCodes.length - columnCodes.length;

  /**
   * 一句话结论。
   *
   * 取代了原先那行「最低 X / 最高 Y」速览 —— 它只给两个端点，读者仍要自己减、自己判显著性；
   * 现在连同「差值口径」与 t / p 一起给出，且**分档方向**（每档覆盖哪段取值）写在档位上。
   */
  const headline = useMemo(() => buildHeadline(rows, groupBlocks), [rows, groupBlocks]);

  /**
   * 一族「同一变量、不同滞后日」的序列（如 `volume_ratio_1d..5d`）。
   *
   * 这类分析的横轴是**时间**，分组条形图会把「逐日衰减」拍成一堆并列类别 —— 所以单独给一条
   * 折线路径。注意它与 `headline` **互不冲突**：`variable` 维度照旧不生成「顶底差」结论，
   * 只是换一种更合适的呈现方式。
   */
  const variableSeries = useMemo(() => buildVariableSeries(groupBlocks), [groupBlocks]);

  /**
   * 条件分析的「对照组」（不满足条件的那组）—— 由全样本与条件组反推。
   *
   * 引擎只落库两组（满足条件 / 全样本），于是「破 vs 不破差多少」此前要靠人工心算，
   * 而且极易把「全样本」当成对照组。这里补上缺的那一组，并**在图上明确标注为反推**。
   * 只对均值型指标做（恒等式成立的前提）；中位数一类直接不给 —— 宁可缺，也不给可疑数。
   */
  const complement = useMemo(() => {
    if (headline === null || headline.kind !== "CONDITIONAL") return null;
    if (!ESTIMATABLE_METRIC_CODES.includes(headline.metricCode)) return null;
    const all = headline.reference;
    const condition = headline.primary;
    const value = estimateExcludedGroupMean(
      all.value,
      all.sampleCount,
      condition.value,
      condition.sampleCount,
    );
    if (value === null) return null;
    const restCount =
      all.sampleCount !== null && condition.sampleCount !== null
        ? all.sampleCount - condition.sampleCount
        : null;
    /**
     * 插入位置：「全样本」条若留在中间，会把「满足条件」与「不满足条件」隔开 ——
     * 这两条才是真正的对照组，必须相邻才可比；「全样本」是基准，放最后更合理。
     */
    const allLabel = groupBlocks.find((b) => b.dimension?.group === "ALL")?.label;
    return {
      label: "不满足条件",
      value,
      display: formatMetricValue(headline.metricCode, value),
      sampleCount: restCount !== null && restCount > 0 ? restCount : null,
      ...(allLabel !== undefined ? { before: allLabel } : {}),
    };
  }, [groupBlocks, headline]);

  /** 主指标能否成图：在该指标上有值的组（含反推组）≥ 2。 */
  const chartable = useMemo(() => {
    if (headline === null) return false;
    let count = 0;
    for (const block of groupBlocks) {
      const cell = block.metrics.find((m) => m.metricCode === headline.metricCode);
      if (cell?.value !== null && cell?.value !== undefined) count += 1;
    }
    return count + (complement !== null ? 1 : 0) >= 2;
  }, [groupBlocks, headline, complement]);

  if (results.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (results.error) {
    return (
      <ErrorState
        error={rpcErrorToDiagnostic(results.error.message, { title: "分析结果加载失败" })}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="该分析尚无结果"
        description="可能原因：分析还未执行（点击「运行引擎」），或执行时失败。运行失败的具体原因记录在 Run 的 errorCode / errorMessage。"
      />
    );
  }

  const uniformDenominator =
    groupBlocks.length > 0 && groupBlocks.every((b) => b.uniformSampleCount !== null);

  return (
    <div className="space-y-4">
      {headline && (
        <Card className="border-l-4 border-l-primary/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">结论速览</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm leading-6">
              {headline.kind === "CONDITIONAL" ? (
                <>
                  按 <span className="font-medium">{headline.metricLabel}</span> 看，
                  <span className="font-semibold">{headline.primary.label}</span> 为{" "}
                  <span className="font-mono tabular-nums font-semibold">{headline.primary.display}</span>
                  （n={formatCount(headline.primary.sampleCount)}），
                  <span className="font-semibold">{headline.reference.label}</span> 为{" "}
                  <span className="font-mono tabular-nums font-semibold">{headline.reference.display}</span>
                  （n={formatCount(headline.reference.sampleCount)}），差值{" "}
                  <span className="font-mono tabular-nums font-semibold">{headline.spreadDisplay}</span>。
                </>
              ) : (
                <>
                  按 <span className="font-medium">{headline.metricLabel}</span> 看，最高的一组{" "}
                  <span className="font-semibold">{headline.primary.label}</span>
                  {headline.primary.rangeLabel !== null && (
                    <span className="text-muted-foreground">（分组变量 {headline.primary.rangeLabel}）</span>
                  )}{" "}
                  为 <span className="font-mono tabular-nums font-semibold">{headline.primary.display}</span>
                  （n={formatCount(headline.primary.sampleCount)}），最低的一组{" "}
                  <span className="font-semibold">{headline.reference.label}</span>
                  {headline.reference.rangeLabel !== null && (
                    <span className="text-muted-foreground">（分组变量 {headline.reference.rangeLabel}）</span>
                  )}{" "}
                  为 <span className="font-mono tabular-nums font-semibold">{headline.reference.display}</span>
                  （n={formatCount(headline.reference.sampleCount)}），顶底差{" "}
                  <span className="font-mono tabular-nums font-semibold">{headline.spreadDisplay}</span>。
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {headline.spreadDefinition !== null && (
                <span title="引擎写入的差值口径，前端原样展示、不重新定义">
                  差值口径：{headline.spreadDefinition}
                </span>
              )}
              {headline.tStat !== null && (
                <span className="font-mono tabular-nums">t = {headline.tStat.toFixed(3)}</span>
              )}
              {headline.pValue !== null && (
                <span className="font-mono tabular-nums">
                  p = {headline.pValue < 0.0001 && headline.pValue > 0 ? "< 0.0001" : headline.pValue.toFixed(4)}
                </span>
              )}
              {headline.sampleCount !== null && (
                <span>参与差值检验的样本 {formatCount(headline.sampleCount)}</span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              这只是**统计关系**，不是交易信号；显著性未做多重比较校正，且涨停事件窗口互相重叠，
              独立性假设不严格成立。需经 Backtest / 稳健性 / OOS 验证后才可作策略判断。
            </p>
          </CardContent>
        </Card>
      )}

      {variableSeries !== null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{variableSeries.familyLabel}逐日走势</CardTitle>
            <CardDescription className="text-xs">
              {variableSeries.points.length} 个滞后日（
              {variableSeries.points.map((p) => `T+${p.lag}`).join(" → ")}）· 中位数与均值同时给出（重尾
              分布下二者可能方向相反）· 悬停可看分位与样本数
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VariableSeriesChart series={variableSeries} />
          </CardContent>
        </Card>
      )}

      {headline !== null && chartable && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">分组对比图</CardTitle>
            <CardDescription className="text-xs">
              {headline.metricLabel} · 每组一根条，共用一个包含 0 的横轴（红 = 正、绿 = 负）；
              悬停可看该组的变量区间与样本数
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GroupMetricChart
              blocks={groupBlocks}
              metricCode={headline.metricCode}
              metricLabel={headline.metricLabel}
              complement={complement}
            />
          </CardContent>
        </Card>
      )}

      {groupBlocks.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
            <CardTitle className="text-sm">分组结果</CardTitle>
            <div className="flex items-center gap-2">
              {!uniformDenominator && (
                <span className="flex items-center gap-1 text-xs text-amber-700">
                  <AlertTriangle className="h-3 w-3" />
                  各组分母不一致，逐指标标注样本数
                </span>
              )}
              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                {groupBlocks.length} 组
              </Badge>
              {hiddenColumnCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllMetrics((v) => !v)}
                  className="rounded border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60"
                >
                  {showAllMetrics ? "只看核心指标" : `显示全部指标（+${hiddenColumnCount}）`}
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background" title="括号内为该分组在分组变量上的取值区间">
                    分组
                  </TableHead>
                  {columnCodes.map((code) => (
                    <TableHead
                      key={code}
                      className={`whitespace-nowrap text-right${
                        headline !== null && headline.metricCode === code ? " font-semibold text-foreground" : ""
                      }`}
                      title={code}
                    >
                      {metricLabelOf(code)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupBlocks.map((block) => {
                  const byCode = new Map(block.metrics.map((m) => [m.metricCode, m]));
                  return (
                    <TableRow key={block.key}>
                      <TableCell className="sticky left-0 bg-background text-sm">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {block.label}
                          {block.lowSample && (
                            <Badge
                              variant="outline"
                              className="border-amber-300 bg-amber-50 text-[10px] text-amber-700"
                            >
                              小样本
                            </Badge>
                          )}
                          {block.uniformSampleCount !== null && (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              n={formatCount(block.uniformSampleCount)}
                            </span>
                          )}
                        </span>
                        {/* 档号本身不含方向（「第 5 档」是跌得最深还是最浅？）—— 把区间摊在这里 */}
                        {block.rangeLabel !== null && (
                          <div
                            className="font-mono text-[11px] text-muted-foreground"
                            title="该组在分组变量上的取值区间（由引擎落库的 cutPoints 反解）"
                          >
                            {block.rangeLabel}
                          </div>
                        )}
                      </TableCell>
                      {columnCodes.map((code) => {
                        const cell = byCode.get(code);
                        // 主指标列加粗高亮：十几个指标列并排时，先让眼睛知道该落在哪一列
                        const isPrimary = headline !== null && headline.metricCode === code;
                        return (
                          <TableCell key={code} className="text-right align-top" title={cell?.definition ?? undefined}>
                            <div className={`font-mono tabular-nums text-sm${isPrimary ? " font-semibold" : ""}`}>
                              {cell?.display ?? "—"}
                            </div>
                            {/* 分母一致时，`n=` 已在分组标签处给过一次，逐格重复纯属噪音 */}
                            {cell && block.uniformSampleCount === null && (
                              <div className="font-mono text-[11px] text-muted-foreground">
                                n={formatCount(cell.sampleCount)}
                              </div>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {scalarRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">整体指标</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>指标</TableHead>
                  <TableHead className="text-right">数值</TableHead>
                  <TableHead className="text-right">样本数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scalarRows.map((row, i) => (
                  <TableRow key={`${row.metricCode}-${i}`} title={row.metricCode}>
                    <TableCell className="text-sm">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {row.label}
                        {row.lowSample && (
                          <Badge
                            variant="outline"
                            className="border-amber-300 bg-amber-50 text-[10px] text-amber-700"
                          >
                            小样本
                          </Badge>
                        )}
                      </span>
                      {row.comparisonDefinition !== null && (
                        <div
                          className="text-[11px] text-muted-foreground"
                          title="引擎写入的比较口径（谁减谁），原样展示"
                        >
                          {row.comparisonDefinition}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-sm">
                      {row.display}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-xs text-muted-foreground">
                      {formatCount(row.sampleCount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <details className="rounded-md border bg-muted/20 px-3 py-2">
        <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3 w-3 shrink-0" />
          表格怎么读（点开）
        </summary>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>
            「—」表示该指标在该分组下**无法计算**（样本不足或变量缺失），不是 0。
          </p>
          <p>
            同一分组内不同指标的样本数**可以不同**（例如平均收益的分母是收益序列长度，
            而最大回撤的分母只是回撤列非空的那些事件）；分母不一致时每个数值下方都会单独标 <span className="font-mono">n=</span>。
          </p>
          <p>
            分析级的注意事项（分组退化、变量缺失说明、小样本门槛）由引擎写入结论的 evidence，
            可在「结论」页签查看。
          </p>
        </div>
      </details>
    </div>
  );
}
