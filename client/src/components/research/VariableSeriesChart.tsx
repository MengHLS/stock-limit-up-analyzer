/**
 * VariableSeriesChart — 「同一变量、不同滞后日」序列的**折线图**。
 *
 * 存在理由：`volume_ratio_1d..5d` 这类结果的横轴是**时间**（T+1 → T+5），分组条形图会把它
 * 拍成一堆并列的类别，「逐日衰减」这个唯一有价值的信息就没了。本组件是它的专用呈现。
 *
 * 三条纪律：
 *   1. **基准线画在语义基准上**：量比的「持平」是 **1 倍**而不是 0（见 `VariableSeriesVm.baseline`）。
 *      基准画错，全正序列里「缩量」与「放量」看上去都是「远高于基准」。
 *   2. **中位数与均值都画**（若都有）：重尾（本数据集偏度 11.7~28.2、峰度 262~1217）下两者能
 *      给出**相反结论** —— 均值全程 > 1（读成「一直在放量」），中位数 T+3 起 < 1（实为缩量）。
 *      只给一个数字等于替读者做了一次未经说明的口径选择。偏度大时组件会显式提示以典型值为准。
 *   3. **不用涨红跌绿**：这里的取值是成交量倍数 / 分布中心，不是价格涨跌，套用涨跌色会被读成
 *      方向性涨跌。故取中性双色（蓝 = 典型值，琥珀 = 均值）。
 *
 * 主题：文字 / 网格 / 轴线一律由 `currentColor` 派生，随外层 `Card` 的 `card-foreground` 明暗自适应。
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMetricValue, metricLabelOf, metricUnitOf, type VariableSeriesVm } from "@/adapters/researchEngineAdapter";

/** 典型值（分布中心）优先取中位数，退回均值 —— 重尾分布下中位数才代表「大多数样本」。 */
const TYPICAL_METRIC_CODES: readonly string[] = ["MEDIAN_RETURN", "MEDIAN", "MEAN_RETURN", "MEAN"];
/** 与典型值对照的「均值侧」指标。 */
const MEAN_METRIC_CODES: readonly string[] = ["MEAN_RETURN", "MEAN"];

const TYPICAL_COLOR = "#2563eb";
const MEAN_COLOR = "#f59e0b";

/** 偏度绝对值超过该值即提示「均值不可作典型值」。 */
const SKEWNESS_WARN_THRESHOLD = 2;

function pickMetricCode(codes: readonly string[], candidates: readonly string[]): string | null {
  for (const candidate of candidates) if (codes.includes(candidate)) return candidate;
  return null;
}

/** 一条折线的外观定义。 */
interface LineSpec {
  code: string;
  color: string;
  dashed: boolean;
}

/**
 * recharts 的 Line 取值键。
 *
 * 刻意用**展平到顶层的动态键**（`v_<metricCode>`）而不是函数式 `dataKey` —— 函数式 dataKey
 * 在不同 recharts 版本行为不一致，而字符串键是各版本都稳的写法。
 */
type SeriesRow = {
  lag: number;
  label: string;
  sampleCount: number | null;
  /** 指标码 → 已格式化串（口径与表格一致，tooltip 直接复用）。 */
  displays: Record<string, string>;
  extras: { label: string; display: string }[];
} & Record<string, unknown>;

export function VariableSeriesChart({ series }: { series: VariableSeriesVm }) {
  const typicalCode = pickMetricCode(series.metricCodes, TYPICAL_METRIC_CODES);
  const meanCode = pickMetricCode(series.metricCodes, MEAN_METRIC_CODES);
  const lines: LineSpec[] = [];
  if (meanCode !== null && meanCode !== typicalCode) lines.push({ code: meanCode, color: MEAN_COLOR, dashed: true });
  if (typicalCode !== null) lines.push({ code: typicalCode, color: TYPICAL_COLOR, dashed: false });
  if (lines.length === 0) return null;

  // 变量名只用于**单位判定**（量比是无量纲倍数，收益类才是百分比）；取族的首个成员当代表。
  const unitVariable = `${series.family}_1d`;
  const unit = metricUnitOf(lines[0]!.code, unitVariable);

  const rows: SeriesRow[] = series.points.map((point) => {
    const displays: Record<string, string> = {};
    const extras: { label: string; display: string }[] = [];
    const row: SeriesRow = { lag: point.lag, label: point.label, sampleCount: null, displays, extras };
    for (const metric of point.metrics) {
      if (metric.metricCode === "SAMPLE_COUNT") {
        row.sampleCount = metric.sampleCount;
        continue;
      }
      displays[metric.metricCode] = metric.display;
      if (metric.value !== null) row[`v_${metric.metricCode}`] = metric.value;
      if (lines.every((line) => line.code !== metric.metricCode)) {
        extras.push({ label: metric.label, display: metric.display });
      }
    }
    return row;
  });

  // y 轴值域：必须让基准线（量比 1）落在可见范围内，否则等于没画。
  const plotted: number[] = [];
  for (const point of series.points) {
    for (const metric of point.metrics) {
      if (!lines.some((line) => line.code === metric.metricCode)) continue;
      if (typeof metric.value === "number" && Number.isFinite(metric.value)) plotted.push(metric.value);
    }
  }
  if (plotted.length === 0) return null;
  if (series.baseline !== null) plotted.push(series.baseline);
  const rawLo = Math.min(...plotted);
  const rawHi = Math.max(...plotted);
  const pad = (rawHi - rawLo) * 0.12 || Math.abs(rawHi) * 0.1 || 1;
  const yDomain: [number, number] = [rawLo - pad, rawHi + pad];

  const formatTick = (value: number): string => {
    if (unit === "PERCENT") return `${(value * 100).toFixed(1)}%`;
    if (unit === "COUNT") return value.toFixed(0);
    return value.toFixed(2);
  };

  // 偏度提示：重尾下「均值」不是典型值 —— 这句话必须在图上，而不是等读者自己发现。
  const skewness: number[] = [];
  for (const point of series.points) {
    const metric = point.metrics.find((m) => m.metricCode === "SKEWNESS");
    if (typeof metric?.value === "number" && Number.isFinite(metric.value)) skewness.push(metric.value);
  }
  const skewnessMax = skewness.length > 0 ? Math.max(...skewness) : null;
  const warnSkew = skewnessMax !== null && skewnessMax > SKEWNESS_WARN_THRESHOLD;
  const typicalLabel = metricLabelOf(typicalCode ?? meanCode ?? "MEDIAN");

  const lags = series.points.map((p) => p.lag);
  const xDomain: [number, number] = [Math.min(...lags) - 0.35, Math.max(...lags) + 0.35];

  return (
    <div className="space-y-2">
      <div className="w-full" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 28, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} />
            <XAxis
              dataKey="lag"
              type="number"
              domain={xDomain}
              ticks={lags}
              tickFormatter={(value: number) => `T+${value}`}
              tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.75 }}
              tickLine={false}
              axisLine={{ stroke: "currentColor", strokeOpacity: 0.2 }}
            />
            <YAxis
              domain={yDomain}
              tickFormatter={formatTick}
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.7 }}
              tickLine={false}
              axisLine={false}
              width={54}
            />
            {series.baseline !== null && (
              <ReferenceLine
                y={series.baseline}
                stroke="currentColor"
                strokeOpacity={0.45}
                strokeDasharray="6 4"
                label={{
                  value:
                    series.baseline === 1 ? "1.00 = 与涨停日持平" : `${formatTick(series.baseline)} 基准`,
                  position: "insideBottomRight",
                  fontSize: 10,
                  fill: "currentColor",
                  fillOpacity: 0.7,
                }}
              />
            )}
            {/* recharts 只在 `content` 为（箭头）函数时把 active/payload 注进来；写成
                `<SeriesTooltip extra={…} />` 这种 ReactElement 会走 cloneElement 路径，
                而且 props 类型为 `unknown` 的组件会被 JSX 拒绝一切属性（TS2322）。
                所以这里用**普通函数调用**，不经过 JSX 属性检查。 */}
            <Tooltip
              cursor={{ stroke: "currentColor", strokeOpacity: 0.25 }}
              content={(tooltipProps: unknown) => renderSeriesTooltip(tooltipProps, lines)}
            />
            {lines.map((line) => (
              <Line
                key={line.code}
                type="monotone"
                dataKey={`v_${line.code}`}
                name={metricLabelOf(line.code)}
                stroke={line.color}
                strokeWidth={line.dashed ? 2 : 3}
                strokeDasharray={line.dashed ? "7 4" : undefined}
                dot={{ r: line.dashed ? 3 : 4, fill: line.color, strokeWidth: 0 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {typicalCode !== null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[3px] w-6 rounded" style={{ background: TYPICAL_COLOR }} />
            {metricLabelOf(typicalCode)}（典型值）
          </span>
        )}
        {meanCode !== null && meanCode !== typicalCode && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[3px] w-6 rounded" style={{ background: MEAN_COLOR }} />
            {metricLabelOf(meanCode)}（受极值拉动）
          </span>
        )}
        {series.baseline !== null && <span>虚线 = 基准（{formatTick(series.baseline)}）</span>}
      </div>

      {warnSkew && (
        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800">
          ⚠️ 该序列偏度最大 {skewnessMax.toFixed(1)}（重尾分布）。均值被少数极端样本拉高，
          <span className="font-medium">判断方向请以「{typicalLabel}」为准</span>
          —— 只看均值可能得出与中位数相反的方向。
        </p>
      )}
    </div>
  );
}

interface SeriesTooltipProps {
  active?: boolean;
  payload?: { payload: SeriesRow }[];
}

/** 折线 tooltip。**函数而非组件** —— 见调用点注释（props 为 `unknown` 的组件会被 JSX 拒收属性）。 */
function renderSeriesTooltip(props: unknown, lines: LineSpec[]) {
  const { active, payload } = props as SeriesTooltipProps;
  if (active !== true || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (row === undefined) return null;
  return (
    <div className="min-w-[200px] space-y-1 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="font-medium">{row.label}</p>
      {lines.map((line) => (
        <p key={line.code} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: line.color }} />
            {metricLabelOf(line.code)}
          </span>
          <span className="font-mono tabular-nums">{row.displays[line.code] ?? "—"}</span>
        </p>
      ))}
      {row.extras.map((extra) => (
        <p key={extra.label} className="flex items-center justify-between gap-3 text-muted-foreground">
          <span>{extra.label}</span>
          <span className="font-mono tabular-nums">{extra.display}</span>
        </p>
      ))}
      <p className="text-muted-foreground">样本数 {row.sampleCount === null ? "—" : row.sampleCount}</p>
    </div>
  );
}
