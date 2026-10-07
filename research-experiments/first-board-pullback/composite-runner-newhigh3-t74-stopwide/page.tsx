/** P3 · 扩大固定止损页（其余冻结）。只消费 props：不 import experiment.ts / server/**。 */
import type { ExperimentPageProps } from "@/researchExperiments/contract";

interface StopRow {
  id: string; label: string; stopRatio: number;
  fullCReturnPct: number; fullCMaxDrawdownPct: number | null; fullCTrades: number;
  fullControlDeltaPct: number; bigWin50Count: number; bigWin100Count: number;
  meanLossPct: number | null; worstTradeReturnPct: number | null;
  tradesWorseThan6Pct: number; tradesWorseThan10Pct: number; stopExitCount: number;
}
interface Payload {
  controlParity?: { pass?: boolean; cReturnPct?: number; cTrades?: number; trigger?: number };
  arms?: StopRow[];
  note?: string;
}
function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits) + "%";
}
function num(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export default function CompositeRunnerT74StopWidePage(props: ExperimentPageProps) {
  const { descriptor, outcome } = props;
  const payload = (outcome?.result?.customPayload ?? undefined) as Payload | undefined;
  const arms = payload?.arms ?? [];
  const parity = payload?.controlParity;
  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{descriptor.name}</h1>
        <p className="text-sm text-muted-foreground">{descriptor.description}</p>
      </div>
      <div className="rounded border p-3 text-sm">
        <div>控制臂 parity：
          <span className={parity?.pass ? "font-medium text-emerald-600" : "font-medium text-red-600"}>
            {parity === undefined ? "（无结果）" : parity.pass ? "PASS" : "FAIL"}
          </span>
          <span className="ml-2 text-muted-foreground">C {pct(parity?.cReturnPct, 4)} / {parity?.cTrades ?? "—"} 笔 · trigger {parity?.trigger ?? "—"}</span>
        </div>
      </div>
      {arms.length === 0 ? (
        <p className="text-sm text-muted-foreground">（尚无臂结果）</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">臂</th>
                <th className="px-3 py-2">固定止损</th>
                <th className="px-3 py-2">C 收益</th>
                <th className="px-3 py-2">C 最大回撤</th>
                <th className="px-3 py-2">&gt;=+50%</th>
                <th className="px-3 py-2">亏损笔均值</th>
                <th className="px-3 py-2">最差单笔</th>
                <th className="px-3 py-2">亏超 6%</th>
                <th className="px-3 py-2">亏超 10%</th>
                <th className="px-3 py-2">C 成交</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.id} className="border-t">
                  <td className="px-3 py-2">{arm.label}</td>
                  <td className="px-3 py-2">{(arm.stopRatio * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2">{pct(arm.fullCReturnPct, 4)}</td>
                  <td className="px-3 py-2 font-medium">{pct(arm.fullCMaxDrawdownPct, 4)}</td>
                  <td className="px-3 py-2">{arm.bigWin50Count}</td>
                  <td className="px-3 py-2">{pct(arm.meanLossPct, 3)}</td>
                  <td className="px-3 py-2">{pct(arm.worstTradeReturnPct, 3)}</td>
                  <td className="px-3 py-2">{arm.tradesWorseThan6Pct}</td>
                  <td className="px-3 py-2">{arm.tradesWorseThan10Pct}</td>
                  <td className="px-3 py-2">{arm.fullCTrades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        只改固定止损（SL-18.1 的 stop.anchor.stopRatio，现役 6%）；选股、名额 2/5、移动止损 8%、MA 止盈、
        5 日时间退出、strongHold 5→10、Runner T74 与数据集坐标全部冻结。
      </p>
    </div>
  );
}
