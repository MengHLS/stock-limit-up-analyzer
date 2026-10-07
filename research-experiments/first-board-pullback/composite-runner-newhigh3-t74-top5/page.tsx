/** P4 · 选股广度 TopN 3->5 页（其余冻结）。只消费 props。 */
import type { ExperimentPageProps } from "@/researchExperiments/contract";

interface Row {
  id: string; label: string; selectionTopN: number; maxDailyBuys: number; maxPositions: number;
  fullCReturnPct: number; fullCMaxDrawdownPct: number | null; fullCTrades: number;
  fullControlDeltaPct: number; bigWin50Count: number; bigWin100Count: number;
  extraRankTrades: number; extraRankNetPnl: number; extraRankBigWin50: number;
}
interface Payload {
  controlParity?: { pass?: boolean; cReturnPct?: number; cTrades?: number; trigger?: number };
  arms?: Row[];
  note?: string;
}
function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits) + "%";
}

export default function CompositeRunnerT74Top5Page(props: ExperimentPageProps) {
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
                <th className="px-3 py-2">可选范围</th>
                <th className="px-3 py-2">单日/持仓</th>
                <th className="px-3 py-2">C 收益</th>
                <th className="px-3 py-2">C 最大回撤</th>
                <th className="px-3 py-2">&gt;=+50%</th>
                <th className="px-3 py-2">&gt;=+100%</th>
                <th className="px-3 py-2">rank4-5 成交</th>
                <th className="px-3 py-2">rank4-5 净利</th>
                <th className="px-3 py-2">C 成交</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.id} className="border-t">
                  <td className="px-3 py-2">{arm.label}</td>
                  <td className="px-3 py-2">top{arm.selectionTopN}</td>
                  <td className="px-3 py-2">{arm.maxDailyBuys} / {arm.maxPositions}</td>
                  <td className="px-3 py-2">{pct(arm.fullCReturnPct, 4)}</td>
                  <td className="px-3 py-2 font-medium">{pct(arm.fullCMaxDrawdownPct, 4)}</td>
                  <td className="px-3 py-2">{arm.bigWin50Count}</td>
                  <td className="px-3 py-2">{arm.bigWin100Count}</td>
                  <td className="px-3 py-2">{arm.extraRankTrades}</td>
                  <td className="px-3 py-2">{Math.round(arm.extraRankNetPnl)}</td>
                  <td className="px-3 py-2">{arm.fullCTrades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        P4 只改选股广度（每日 top3 → top5）与买入名额/持仓上限；3F 排序、候选池、SL-18.1 退出链、
        Runner T74 与数据集坐标全部冻结。
      </p>
    </div>
  );
}
