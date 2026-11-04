/**
 * P2 · 放开买入名额 / 持仓上限页（选股与排序冻结）。
 *
 * 只消费 ExperimentPageProps：不 import experiment.ts、不 import server/**。
 */
import type { ExperimentPageProps } from "@/researchExperiments/contract";

interface SlotArmRow {
  id: string;
  label: string;
  maxDailyBuys: number;
  maxPositions: number;
  fullCReturnPct: number;
  fullCTrades: number;
  fullCMaxDrawdownPct: number | null;
  fullControlDeltaPct: number;
  bigWin50Count: number;
  bigWin100Count: number;
  bigWin50NetPnlSharePct: number | null;
  maxTradeReturnPct: number | null;
}

interface SlotsPayload {
  controlParity?: {
    pass?: boolean; aReturnPct?: number; aTrades?: number;
    cReturnPct?: number; cTrades?: number; trigger?: number;
  };
  controlBigWin50Baseline?: number;
  arms?: SlotArmRow[];
  note?: string;
}

function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits) + "%";
}

function pp(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return (value > 0 ? "+" : "") + value.toFixed(digits) + "pp";
}

export default function CompositeRunnerT74SlotsPage(props: ExperimentPageProps) {
  const { descriptor, outcome } = props;
  const payload = (outcome?.result?.customPayload ?? undefined) as SlotsPayload | undefined;
  const arms = payload?.arms ?? [];
  const parity = payload?.controlParity;
  const control = arms.find((arm) => arm.id === "control") ?? null;
  const variants = arms.filter((arm) => arm.id !== "control");
  const bestByBigWins = variants.reduce<SlotArmRow | null>(
    (best, arm) => (best === null || arm.bigWin50Count > best.bigWin50Count ? arm : best),
    null,
  );
  const bestByReturn = variants.reduce<SlotArmRow | null>(
    (best, arm) => (best === null || arm.fullCReturnPct > best.fullCReturnPct ? arm : best),
    null,
  );

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{descriptor.name}</h1>
        <p className="text-sm text-muted-foreground">{descriptor.description}</p>
      </div>

      <div className="rounded border p-3 text-sm">
        <div className="font-medium">控制臂 parity（对齐 T74 留档）</div>
        {parity === undefined ? (
          <div className="text-muted-foreground">（本次 Run 尚无结果）</div>
        ) : (
          <div className="mt-1 space-y-0.5">
            <div>
              状态：
              <span className={parity.pass ? "font-medium text-emerald-600" : "font-medium text-red-600"}>
                {parity.pass ? "PASS" : "FAIL"}
              </span>
              <span className="ml-2 text-muted-foreground">
                C（Runner T74）{pct(parity.cReturnPct, 4)} / {parity.cTrades ?? "—"} 笔 · Runner 触发 {parity.trigger ?? "—"} 笔
              </span>
            </div>
            <div className="text-muted-foreground">
              FAIL 时不要读容量臂的 Δ：说明数据/代码坐标已经与留档不一致。
            </div>
          </div>
        )}
      </div>

      {arms.length === 0 ? (
        <p className="text-sm text-muted-foreground">（尚无臂结果）</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">臂</th>
                <th className="px-3 py-2 font-medium">单日买入</th>
                <th className="px-3 py-2 font-medium">持仓上限</th>
                <th className="px-3 py-2 font-medium">&gt;= +50% 笔数</th>
                <th className="px-3 py-2 font-medium">&gt;= +100% 笔数</th>
                <th className="px-3 py-2 font-medium">C 收益</th>
                <th className="px-3 py-2 font-medium">Δ vs 控制</th>
                <th className="px-3 py-2 font-medium">C 最大回撤</th>
                <th className="px-3 py-2 font-medium">C 成交</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.id} className="border-t">
                  <td className="px-3 py-2">{arm.label}</td>
                  <td className="px-3 py-2">{arm.maxDailyBuys}</td>
                  <td className="px-3 py-2">{arm.maxPositions}</td>
                  <td className="px-3 py-2 font-medium">{arm.bigWin50Count}</td>
                  <td className="px-3 py-2">{arm.bigWin100Count}</td>
                  <td className="px-3 py-2">{pct(arm.fullCReturnPct, 4)}</td>
                  <td className={`px-3 py-2 ${arm.fullControlDeltaPct > 0 ? "text-emerald-600" : arm.fullControlDeltaPct < 0 ? "text-red-600" : ""}`}>
                    {pp(arm.fullControlDeltaPct, 4)}
                  </td>
                  <td className="px-3 py-2">{pct(arm.fullCMaxDrawdownPct, 4)}</td>
                  <td className="px-3 py-2">{arm.fullCTrades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {control !== null && payload?.controlBigWin50Baseline !== undefined ? (
        <p className="text-sm">
          现役控制臂 &gt;= +50% 笔数基准：<span className="font-medium">{payload.controlBigWin50Baseline}</span>
          {bestByBigWins === null ? null : <> · 最优容量臂：{bestByBigWins.label}（{bestByBigWins.bigWin50Count} 笔）</>}
          {bestByReturn === null ? null : <> · 收益最优：{bestByReturn.label}（{pct(bestByReturn.fullCReturnPct, 4)}）</>}
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        P2 只改执行容量（maxDailyBuys / maxPositions）；选股、排序、候选池、SL-18.1 退出链、Runner T74
        与数据集坐标逐字段冻结（四条臂共享同一份 sourceRun）。
      </p>
    </div>
  );
}
