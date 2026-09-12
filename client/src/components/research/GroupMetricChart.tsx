/**
 * GroupMetricChart — 分组主指标的**横向条形图**（结果页的主视觉）。
 *
 * 为什么不用表格单元格里的迷你条：单元格内的条只有 ~72px 宽、1.5px 高，且随表格横向滚动
 * 一起跑出视口 —— 「单调性一眼可见」这个目的根本达不到。第一版甚至把负值条压成了 0.8% 宽
 * （锚点取 `min(value,0)` 后再算 `value − anchor`，`value < 0` 时恒等于 0），
 * 于是「有正有负」的分档图看起来就像「只有正的那几档有条」。本组件取代之。
 *
 * 三条纪律：
 *   1. **每档一行、一根条**，共用同一条 x 轴且**强制包含 0**（`domain` 下限 ≤ 0 ≤ 上限）
 *      —— 否则「−0.5% 比 +0.4% 更短」这种方向性错误必然发生；
 *   2. `0` 处画参考竖线：没有它，「全是正收益」与「正负各半」在视觉上无法区分；
 *   3. 颜色按 A 股习惯 **涨（正）红 / 跌（负）绿**。
 *
 * **实测条 vs 反推条**必须一眼可分：反推条（条件分析的「不满足条件」组，见
 * `estimateExcludedGroupMean`）用浅色填充 + 同色虚线描边，绝不与实测样本混同。
 *
 * 主题：文字与网格一律用 `currentColor` 派生，跟随外层 `Card` 的 `card-foreground`，
 * 因此明暗主题都成立；只有涨跌语义色是硬编码的（它们本身就是语义，不该随主题变）。
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatCount,
  formatMetricValue,
  metricUnitOf,
  type GroupBlockVm,
} from "@/adapters/researchEngineAdapter";

/** 正 = 涨（红），负 = 跌（绿）。 */
const UP_COLOR = "#e11d48";
const DOWN_COLOR = "#059669";
/** 反推条：同色系浅色（浅玫瑰 / 浅翠绿），与实测条同色相但明显更淡。 */
const ESTIMATED_UP_COLOR = "#fecdd3";
const ESTIMATED_DOWN_COLOR = "#a7f3d0";

/** tooltip 里额外展示的指标（主指标之外的「第二眼」信息）。 */
const TOOLTIP_EXTRA_METRICS: readonly string[] = [
  "MEDIAN_RETURN",
  "MEDIAN",
  "WIN_RATE",
  "STD_RETURN",
  "STD",
  "MAX_DRAWDOWN",
];
const TOOLTIP_EXTRA_LIMIT = 3;

/** 条件分析里「不满足条件」那一组（由全样本与条件组反推，见 `estimateExcludedGroupMean`）。 */
export interface GroupMetricChartComplement {
  label: string;
  value: number;
  display: string;
  sampleCount: number | null;
  /**
   * 插到哪一条**之前**（按 `name` 精确匹配）。
   *
   * 条件分析传「全样本」：真正的对照组是「满足条件 vs 不满足条件」，它们必须相邻才可比；
   * 「全样本」是基准，收尾更合理。找不到匹配（或未给）则追加到末尾。
   */
  before?: string;
}

interface ChartDatum {
  /** y 轴分类键（同时用于查表拿区间等附加信息）。 */
  name: string;
  rangeLabel: string | null;
  value: number;
  display: string;
  sampleCount: number | null;
  lowSample: boolean;
  estimated: boolean;
  extras: { label: string; display: string }[];
}

function extrasOf(block: GroupBlockVm, metricCode: string): { label: string; display: string }[] {
  const out: { label: string; display: string }[] = [];
  for (const code of TOOLTIP_EXTRA_METRICS) {
    if (out.length >= TOOLTIP_EXTRA_LIMIT) break;
    const cell = block.metrics.find((m) => m.metricCode === code);
    if (cell === undefined || cell.display === "—") continue;
    out.push({ label: cell.label, display: cell.display });
  }
  return out;
}

/** recharts 注入给坐标轴刻度的 props（这里只用到 x / y / payload）。 */
interface AxisTickProps {
  x: number;
  y: number;
  payload: { value: string };
}

/** 两行式 y 轴刻度：上行档名，下行该档覆盖的变量区间（`cutPoints` 反解）。 */
function TwoLineTick({ x, y, payload, byName }: AxisTickProps & { byName: Map<string, ChartDatum> }) {
  const datum = byName.get(payload.value);
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={datum?.rangeLabel != null ? -1 : 4} textAnchor="end" fontSize={11} fill="currentColor">
        {datum?.name ?? payload.value}
        {datum?.estimated === true && "（反推）"}
      </text>
      {datum?.rangeLabel != null && (
        <text x={0} y={0} dy={11} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.55}>
          {datum.rangeLabel}
        </text>
      )}
    </g>
  );
}

function ChartTooltip(props: unknown) {
  const { active, payload } = props as {
    active?: boolean;
    payload?: { payload: ChartDatum }[];
  };
  if (active !== true || !payload?.length) return null;
  const datum = payload[0]?.payload;
  if (datum === undefined) return null;
  return (
    <div className="min-w-[190px] space-y-1 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="font-medium">
        {datum.name}
        {datum.estimated && <span className="ml-1 text-muted-foreground">（由全样本与条件组反推）</span>}
      </p>
      {datum.rangeLabel !== null && (
        <p className="font-mono text-[11px] text-muted-foreground">分组变量 {datum.rangeLabel}</p>
      )}
      <p className="font-mono text-sm tabular-nums">{datum.display}</p>
      <p className="text-muted-foreground">
        样本数 {datum.sampleCount === null ? "—" : formatCount(datum.sampleCount)}
        {datum.lowSample && <span className="ml-1.5 text-amber-700">小样本</span>}
      </p>
      {datum.extras.map((extra) => (
        <p key={extra.label} className="text-muted-foreground">
          {extra.label} <span className="font-mono tabular-nums">{extra.display}</span>
        </p>
      ))}
    </div>
  );
}

export function GroupMetricChart({
  blocks,
  metricCode,
  metricLabel,
  complement = null,
}: {
  blocks: readonly GroupBlockVm[];
  metricCode: string;
  metricLabel: string;
  complement?: GroupMetricChartComplement | null;
}) {
  const data: ChartDatum[] = [];
  for (const block of blocks) {
    const cell = block.metrics.find((m) => m.metricCode === metricCode);
    if (cell === undefined || cell.value === null) continue;
    data.push({
      name: block.label,
      rangeLabel: block.rangeLabel,
      value: cell.value,
      display: cell.display,
      sampleCount: cell.sampleCount,
      lowSample: block.lowSample,
      estimated: false,
      extras: extrasOf(block, metricCode),
    });
  }
  if (complement !== null) {
    const datum: ChartDatum = {
      name: complement.label,
      rangeLabel: null,
      value: complement.value,
      display: complement.display,
      sampleCount: complement.sampleCount,
      lowSample: false,
      estimated: true,
      extras: [],
    };
    const at = complement.before === undefined ? -1 : data.findIndex((d) => d.name === complement.before);
    if (at >= 0) data.splice(at, 0, datum);
    else data.push(datum);
  }
  if (data.length < 2) return null;

  const byName = new Map(data.map((d) => [d.name, d]));
  const values = data.map((d) => d.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  if (lo === hi) return null;
  const pad = (hi - lo) * 0.08;
  const domain: [number, number] = [lo - pad, hi + pad];

  const unit = metricUnitOf(metricCode);
  const formatTick = (value: number): string => {
    if (unit === "PERCENT") return `${(value * 100).toFixed(2)}%`;
    if (unit === "COUNT") return formatCount(Math.round(value));
    return value.toFixed(2);
  };

  // 每档 40px + 轴区，保证两行刻度不互相压叠
  const height = Math.max(150, data.length * 40 + 48);

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 6, right: 28, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.12} />
          <XAxis
            type="number"
            domain={domain}
            tickFormatter={formatTick}
            tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.7 }}
            tickLine={false}
            axisLine={{ stroke: "currentColor", strokeOpacity: 0.2 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={132}
            interval={0}
            tickLine={false}
            axisLine={false}
            // recharts 只在 `tick` 为（箭头）函数时把 x/y/payload 注进来；写成 ReactElement
            // 会走 cloneElement 路径，自定义 props（byName）就传不进去（TS 也会直接报错）。
            tick={(tickProps: unknown) => (
              <TwoLineTick {...(tickProps as AxisTickProps)} byName={byName} />
            )}
          />
          <ReferenceLine x={0} stroke="currentColor" strokeOpacity={0.45} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "currentColor", fillOpacity: 0.05 }} />
          <Bar dataKey="value" name={metricLabel} barSize={16} radius={2} isAnimationActive={false}>
            {data.map((datum) => (
              <Cell
                key={datum.name}
                fill={
                  datum.estimated
                    ? datum.value >= 0
                      ? ESTIMATED_UP_COLOR
                      : ESTIMATED_DOWN_COLOR
                    : datum.value >= 0
                      ? UP_COLOR
                      : DOWN_COLOR
                }
                stroke={datum.estimated ? (datum.value >= 0 ? UP_COLOR : DOWN_COLOR) : undefined}
                strokeDasharray={datum.estimated ? "3 2" : undefined}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
