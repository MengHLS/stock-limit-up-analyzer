/** 趋势触发入场页（配置驱动）。只消费 props。 */
import type { ExperimentPageProps } from "@/researchExperiments/contract";

interface ArmOutcome {
  id: string; label: string; eventsEvaluated: number;
  triggered: number; unfillable: number; noTrigger: number; triggerRatePct: number;
  exited: number; openAtEnd: number;
  meanNetReturnPct: number | null; medianNetReturnPct: number | null; winRatePct: number | null;
  bigWin50Count: number; bigWin100Count: number;
  meanHoldingDays: number | null; medianHoldingDays: number | null;
  meanEntryRd: number | null; medianEntryRd: number | null; meanUnevaluableDaysPerEvent: number | null;
}
interface YearlyRow { armId: string; year: string; trades: number; meanNetReturnPct: number | null }
interface Payload {
  datasetVersionId?: number;
  costBps?: { buy?: number; sell?: number };
  arms?: ArmOutcome[];
  yearly?: YearlyRow[];
  note?: string;
}

function pct(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits) + "%";
}
function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export default function TrendEntryMaV1Page(props: ExperimentPageProps) {
  const { descriptor, outcome } = props;
  const payload = (outcome?.result?.customPayload ?? undefined) as Payload | undefined;
  const arms = payload?.arms ?? [];
  const yearly = payload?.yearly ?? [];
  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{descriptor.name}</h1>
        <p className="text-sm text-muted-foreground">{descriptor.description}</p>
      </div>
      <div className="rounded border p-3 text-sm">
        <span className="text-muted-foreground">
          数据集版本 id：{payload?.datasetVersionId ?? "—"} · 成本 买 {payload?.costBps?.buy ?? "—"} bps / 卖 {payload?.costBps?.sell ?? "—"} bps（含印花税）
        </span>
      </div>
      {arms.length === 0 ? (
        <p className="text-sm text-muted-foreground">（尚无臂结果）</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">臂</th>
                <th className="px-3 py-2">触发率</th>
                <th className="px-3 py-2">平均入场 rd</th>
                <th className="px-3 py-2">平均持有日</th>
                <th className="px-3 py-2">净收益均值</th>
                <th className="px-3 py-2">净收益中位</th>
                <th className="px-3 py-2">胜率</th>
                <th className="px-3 py-2">&gt;=+50%</th>
                <th className="px-3 py-2">触发 / 未触发 / 不可买</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.id} className="border-t">
                  <td className="px-3 py-2">{arm.label}</td>
                  <td className="px-3 py-2">{num(arm.triggerRatePct, 2)}%</td>
                  <td className="px-3 py-2">{num(arm.meanEntryRd, 2)}</td>
                  <td className="px-3 py-2">{num(arm.meanHoldingDays, 2)}</td>
                  <td className="px-3 py-2 font-medium">{pct(arm.meanNetReturnPct)}</td>
                  <td className="px-3 py-2">{pct(arm.medianNetReturnPct)}</td>
                  <td className="px-3 py-2">{num(arm.winRatePct, 2)}%</td>
                  <td className="px-3 py-2">{arm.bigWin50Count}</td>
                  <td className="px-3 py-2">{arm.triggered} / {arm.noTrigger} / {arm.unfillable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {yearly.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">臂</th>
                <th className="px-3 py-2">年</th>
                <th className="px-3 py-2">笔数</th>
                <th className="px-3 py-2">净收益均值</th>
              </tr>
            </thead>
            <tbody>
              {yearly.map((row) => (
                <tr key={row.armId + "-" + row.year} className="border-t">
                  <td className="px-3 py-2">{row.armId}</td>
                  <td className="px-3 py-2">{row.year}</td>
                  <td className="px-3 py-2">{row.trades}</td>
                  <td className="px-3 py-2">{pct(row.meanNetReturnPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        入场 = 观察窗 rd1..20 内首个满足该臂全部条件的交易日（次一开盘成交）；收益 = 实际入场→实际退出。
        条件词表固定四类（价格 vs MA / MA 排列 / MA 斜率 / N 日收益），数据不足按不可评估处理、不插补。
      </p>
    </div>
  );
}
