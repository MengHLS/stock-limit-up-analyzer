/** `TAIL-SELECTION-002` · 3F 取向翻转页（其余冻结）。只消费 props：不 import experiment.ts / server/**。 */
import type { ExperimentPageProps } from "@/researchExperiments/contract";

interface ArmRow {
  id: string;
  label: string;
  orientation: "LOW" | "HIGH";
  withRunner: boolean;
  runnerExitAtHoldingDays: number | null;
  fullCReturnPct: number;
  fullCMaxDrawdownPct: number | null;
  fullCTrades: number;
  fullControlDeltaPct: number;
  runnerTrigger: number | null;
  bigWin50Count: number;
  bigWin100Count: number;
  winRatePct: number;
  meanLossPct: number | null;
  worstTradeReturnPct: number | null;
  p05TradeReturnPct: number | null;
}
interface Payload {
  controlParity?: { pass?: boolean; cReturnPct?: number; cTrades?: number; trigger?: number };
  arms?: ArmRow[];
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

export default function CompositeRunnerT74InvertedPage(props: ExperimentPageProps) {
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
        <div>控制臂 parity（ABORT 门禁）：
          <span className={parity?.pass ? "font-medium text-emerald-600" : "font-medium text-red-600"}>
            {parity === undefined ? "（无结果）" : parity.pass ? "PASS" : "FAIL"}
          </span>
          <span className="ml-2 text-muted-foreground">
            C {pct(parity?.cReturnPct, 4)} / {parity?.cTrades ?? "—"} 笔 · trigger {parity?.trigger ?? "—"}
          </span>
        </div>
        {parity !== undefined && !parity.pass ? (
          <p className="mt-1 text-red-600">
            控制臂未复现 T74 冻结值 ⇒ 按 PLAN §4 <b>不解读任何臂</b>。
          </p>
        ) : null}
      </div>
      {arms.length === 0 ? (
        <p className="text-sm text-muted-foreground">（尚无臂结果）</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">臂</th>
                <th className="px-3 py-2">取向</th>
                <th className="px-3 py-2">Runner</th>
                <th className="px-3 py-2">C 收益</th>
                <th className="px-3 py-2">C 最大回撤</th>
                <th className="px-3 py-2">&gt;=+50%</th>
                <th className="px-3 py-2">&gt;=+100%</th>
                <th className="px-3 py-2">胜率</th>
                <th className="px-3 py-2">Runner 触发</th>
                <th className="px-3 py-2">最差单笔</th>
                <th className="px-3 py-2">C 成交</th>
                <th className="px-3 py-2">Δ vs 控制</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.id} className="border-t">
                  <td className="px-3 py-2">{arm.label}</td>
                  <td className="px-3 py-2">{arm.orientation}</td>
                  <td className="px-3 py-2">
                    {arm.withRunner ? (arm.runnerExitAtHoldingDays === null ? "有" : "有（延长 " + arm.runnerExitAtHoldingDays + "）") : "无"}
                  </td>
                  <td className="px-3 py-2">{pct(arm.fullCReturnPct, 4)}</td>
                  <td className="px-3 py-2 font-medium">{pct(arm.fullCMaxDrawdownPct, 4)}</td>
                  <td className="px-3 py-2 font-medium">{arm.bigWin50Count}</td>
                  <td className="px-3 py-2 font-medium">{arm.bigWin100Count}</td>
                  <td className="px-3 py-2">{pct(arm.winRatePct, 2)}</td>
                  <td className="px-3 py-2">{arm.runnerTrigger ?? "—"}</td>
                  <td className="px-3 py-2">{pct(arm.worstTradeReturnPct, 2)}</td>
                  <td className="px-3 py-2">{arm.fullCTrades}</td>
                  <td className="px-3 py-2">{num(arm.fullControlDeltaPct, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        只改 3F 振幅取向（`1 − Σ(oriented)/3` ≡ 三方向全翻）；选股宽度、名额 2/5、止损 6%、移动止损 8%、
        MA 止盈、5 日时间退出、strongHold 5→10、Runner T74 与数据集坐标全部冻结。
        🔴 「取向翻转」与「取现行 top-3 的反向」在数学上是同一件事（`1−x` 严格单调）。
      </p>
    </div>
  );
}
