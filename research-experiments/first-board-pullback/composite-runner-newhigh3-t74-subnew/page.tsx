/** P10 · 候选池上市龄过滤页（其余冻结）。只消费 props。 */
import type { ExperimentPageProps } from "@/researchExperiments/contract";

interface Row {
  id: string; label: string; excludeListedWithinDays: number | null;
  fullCReturnPct: number; fullCMaxDrawdownPct: number | null; fullCTrades: number;
  fullControlDeltaPct: number; bigWin50Count: number; bigWin100Count: number;
  listingExcludedCandidates: number; subNewTrades: number; subNewNetPnl: number; subNewBigWin50: number;
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

export default function CompositeRunnerT74SubNewPage(props: ExperimentPageProps) {
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
                <th className="px-3 py-2">剔除阈值</th>
                <th className="px-3 py-2">C 收益</th>
                <th className="px-3 py-2">Δ vs 控制</th>
                <th className="px-3 py-2">C 最大回撤</th>
                <th className="px-3 py-2">&gt;=+50%</th>
                <th className="px-3 py-2">&gt;=+100%</th>
                <th className="px-3 py-2">剔除候选</th>
                <th className="px-3 py-2">次新成交</th>
                <th className="px-3 py-2">次新净利</th>
                <th className="px-3 py-2">C 成交</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.id} className="border-t">
                  <td className="px-3 py-2">{arm.label}</td>
                  <td className="px-3 py-2">{arm.excludeListedWithinDays === null ? "—" : `< ${arm.excludeListedWithinDays} 日`}</td>
                  <td className="px-3 py-2 font-medium">{pct(arm.fullCReturnPct, 4)}</td>
                  <td className="px-3 py-2">{pct(arm.fullControlDeltaPct, 4)}</td>
                  <td className="px-3 py-2">{pct(arm.fullCMaxDrawdownPct, 4)}</td>
                  <td className="px-3 py-2">{arm.bigWin50Count}</td>
                  <td className="px-3 py-2">{arm.bigWin100Count}</td>
                  <td className="px-3 py-2">{arm.listingExcludedCandidates}</td>
                  <td className="px-3 py-2">{arm.subNewTrades}</td>
                  <td className="px-3 py-2">{Math.round(arm.subNewNetPnl)}</td>
                  <td className="px-3 py-2">{arm.fullCTrades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        P10 只改候选池的上市龄过滤（3F 排序前剔除、允许低名次递补）；3F 排序、每日 top3、2 笔 / 5 仓、
        SL-18.1 退出链、Runner T74 与数据集坐标全部冻结。上市日取 Security Master（决策日已知），
        上市龄按自然日计算。
      </p>
    </div>
  );
}
