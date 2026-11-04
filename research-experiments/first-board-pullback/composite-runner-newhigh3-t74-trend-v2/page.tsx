/**
 * P1 · 趋势评分 v2（符号修正 + 分位融合）页。
 *
 * 只消费 ExperimentPageProps：不 import experiment.ts、不 import server/**。
 */
import type { ExperimentPageProps } from "@/researchExperiments/contract";

interface V2ArmRow {
  id: string;
  label: string;
  v2Weight: number | null;
  scoredCandidates: number | null;
  droppedMissingComponents: number | null;
  fullCReturnPct: number;
  fullCTrades: number;
  fullCMaxDrawdownPct: number | null;
  fullControlDeltaPct: number;
}

interface V2Payload {
  controlParity?: {
    pass?: boolean; aReturnPct?: number; aTrades?: number;
    cReturnPct?: number; cTrades?: number; trigger?: number;
  };
  arms?: V2ArmRow[];
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

export default function CompositeRunnerNewHigh3T74TrendV2Page(props: ExperimentPageProps) {
  const { descriptor, outcome } = props;
  const payload = (outcome?.result?.customPayload ?? undefined) as V2Payload | undefined;
  const arms = payload?.arms ?? [];
  const parity = payload?.controlParity;
  const control = arms.find((arm) => arm.v2Weight === null) ?? null;
  const winner = arms
    .filter((arm) => arm.v2Weight !== null)
    .reduce<V2ArmRow | null>(
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
                A（无 Runner）{pct(parity.aReturnPct, 4)} / {parity.aTrades ?? "—"} 笔 · C（Runner T74）
                {pct(parity.cReturnPct, 4)} / {parity.cTrades ?? "—"} 笔 · Runner 触发 {parity.trigger ?? "—"} 笔
              </span>
            </div>
            <div className="text-muted-foreground">
              FAIL 时不要读 v2 臂的 Δ：说明数据/代码坐标已经与留档不一致。
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
                <th className="px-3 py-2 font-medium">v2 权重</th>
                <th className="px-3 py-2 font-medium">参与打分候选</th>
                <th className="px-3 py-2 font-medium">分量缺失被排除</th>
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
                  <td className="px-3 py-2">{arm.v2Weight === null ? "0（控制）" : arm.v2Weight}</td>
                  <td className="px-3 py-2">{arm.scoredCandidates ?? "—"}</td>
                  <td className="px-3 py-2">{arm.droppedMissingComponents ?? "—"}</td>
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

      {winner !== null && control !== null ? (
        <p className="text-sm">
          全周期最优 v2 臂：<span className="font-medium">{winner.label}</span>
          （{pp(winner.fullCReturnPct - control.fullCReturnPct, 4)}）
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        v2 = 等权( 分位(回撤深度), 分位(-动量), 分位(-结构偏离) )，分位在当日候选内计算；
        fused =（1−w）·3F + w·v2。TopN、maxPositions、分层仓位、SL-18.1 退出链、Runner 政策与数据集坐标全部冻结。
      </p>
    </div>
  );
}
