/** P6 · T74 跨日候选池页（只消费 props）。 */
import type { ExperimentPageProps } from "@/researchExperiments/contract";

interface Row {
  id: string;
  label: string;
  selectionTopN: number;
  maxDailyBuys: number;
  maxPositions: number;
  carryMaxAgeDays: number;
  replacementScoreMargin: number;
  refreshWeight: number | null;
  fullCReturnPct: number;
  fullCMaxDrawdownPct: number | null;
  fullCTrades: number;
  fullControlDeltaPct: number;
  bigWin50Count: number;
  bigWin100Count: number;
  carryQueuedCandidates: number;
  carryConsideredCandidates: number;
  carrySelectedCandidates: number;
  carryAttemptedCandidates: number;
  carryExpiredCandidates: number;
  carryTrades: number;
  carryNetPnl: number;
  carryBigWin50Count: number;
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
function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export default function CompositeRunnerT74CarryoverPage(props: ExperimentPageProps) {
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
                <th className="px-3 py-2">carry</th>
                <th className="px-3 py-2">refresh</th>
                <th className="px-3 py-2">margin</th>
                <th className="px-3 py-2">C 收益</th>
                <th className="px-3 py-2">C 最大回撤</th>
                <th className="px-3 py-2">&gt;=+50%</th>
                <th className="px-3 py-2">&gt;=+100%</th>
                <th className="px-3 py-2">carry 尝试</th>
                <th className="px-3 py-2">carry 成交</th>
                <th className="px-3 py-2">carry 净利</th>
                <th className="px-3 py-2">carry &gt;=+50%</th>
                <th className="px-3 py-2">C 成交</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.id} className="border-t">
                  <td className="px-3 py-2">{arm.label}</td>
                  <td className="px-3 py-2">{arm.carryMaxAgeDays} 日</td>
                  <td className="px-3 py-2">{arm.refreshWeight === null ? "—" : arm.refreshWeight.toFixed(2)}</td>
                  <td className="px-3 py-2">{arm.replacementScoreMargin.toFixed(2)}</td>
                  <td className="px-3 py-2">{pct(arm.fullCReturnPct, 4)}</td>
                  <td className="px-3 py-2 font-medium">{pct(arm.fullCMaxDrawdownPct, 4)}</td>
                  <td className="px-3 py-2">{arm.bigWin50Count}</td>
                  <td className="px-3 py-2">{arm.bigWin100Count}</td>
                  <td className="px-3 py-2">{arm.carryAttemptedCandidates}</td>
                  <td className="px-3 py-2">{arm.carryTrades}</td>
                  <td className="px-3 py-2">{num(arm.carryNetPnl, 0)}</td>
                  <td className="px-3 py-2">{arm.carryBigWin50Count}</td>
                  <td className="px-3 py-2">{arm.fullCTrades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {arms.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">臂</th>
                <th className="px-3 py-2">进入 pending</th>
                <th className="px-3 py-2">参与重排</th>
                <th className="px-3 py-2">进入 topN</th>
                <th className="px-3 py-2">进入买入前 N</th>
                <th className="px-3 py-2">超龄淘汰</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.id} className="border-t">
                  <td className="px-3 py-2">{arm.label}</td>
                  <td className="px-3 py-2">{arm.carryQueuedCandidates}</td>
                  <td className="px-3 py-2">{arm.carryConsideredCandidates}</td>
                  <td className="px-3 py-2">{arm.carrySelectedCandidates}</td>
                  <td className="px-3 py-2">{arm.carryAttemptedCandidates}</td>
                  <td className="px-3 py-2">{arm.carryExpiredCandidates}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        P7 对 fresh + pending 在同一决策日统一做 CarryRefreshV1 重评分，再与原始 3F 融合。
        “是否实际成交”由 simulator 决定，source-run 不做成交回执推断。
      </p>
    </div>
  );
}
