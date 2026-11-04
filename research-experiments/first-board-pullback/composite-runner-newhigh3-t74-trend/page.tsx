/**
 * P0 · 3F 排序 × 趋势评分融合页。
 *
 * 只消费 `ExperimentPageProps`：**不 import experiment.ts、不 import server/****
 * （页面跑在浏览器里；服务端计算不得进 bundle）。
 */
import type { ExperimentPageProps } from "@/researchExperiments/contract";

interface TrendFusionArmRow {
  id: string;
  label: string;
  trendWeight: number | null;
  fusionScoredCandidates: number | null;
  fusionDroppedCandidates: number | null;
  fullCReturnPct: number;
  fullCTrades: number;
  fullCMaxDrawdownPct: number | null;
  fullControlDeltaPct: number;
  fullAReturnPct: number | null;
  holdoutCReturnPct: number | null;
  holdoutCMaxDrawdownPct: number | null;
  holdoutControlDeltaPct: number | null;
  runnerTrigger: number | null;
}

interface TrendFusionPayload {
  controlParity?: {
    pass?: boolean;
    aReturnPct?: number;
    aTrades?: number;
    cReturnPct?: number;
    cTrades?: number;
    trigger?: number;
  };
  arms?: TrendFusionArmRow[];
  note?: string;
}

function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function pp(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}pp`;
}

export default function CompositeRunnerNewHigh3T74TrendPage(props: ExperimentPageProps) {
  const { descriptor, outcome } = props;
  const payload = (outcome?.result?.customPayload ?? undefined) as TrendFusionPayload | undefined;
  const arms = payload?.arms ?? [];
  const parity = payload?.controlParity;
  const control = arms.find((arm) => arm.trendWeight === null) ?? null;
  const winner = arms
    .filter((arm) => arm.trendWeight !== null)
    .reduce<TrendFusionArmRow | null>(
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
              FAIL 时**不要**读融合臂的 Δ：说明数据/代码坐标已经与留档不一致。
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
                <th className="px-3 py-2 font-medium">趋势权重</th>
                <th className="px-3 py-2 font-medium">全周期 C 收益</th>
                <th className="px-3 py-2 font-medium">Δ vs 控制</th>
                <th className="px-3 py-2 font-medium">C 最大回撤</th>
                <th className="px-3 py-2 font-medium">C 成交</th>
                <th className="px-3 py-2 font-medium">后置窗口 C</th>
                <th className="px-3 py-2 font-medium">后置 Δ</th>
                <th className="px-3 py-2 font-medium">趋势分缺失被排除</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.id} className="border-t">
                  <td className="px-3 py-2">{arm.label}</td>
                  <td className="px-3 py-2">{arm.trendWeight === null ? "0（控制）" : arm.trendWeight}</td>
                  <td className="px-3 py-2">{pct(arm.fullCReturnPct, 4)}</td>
                  <td className={`px-3 py-2 ${arm.fullControlDeltaPct > 0 ? "text-emerald-600" : arm.fullControlDeltaPct < 0 ? "text-red-600" : ""}`}>
                    {pp(arm.fullControlDeltaPct, 4)}
                  </td>
                  <td className="px-3 py-2">{pct(arm.fullCMaxDrawdownPct, 4)}</td>
                  <td className="px-3 py-2">{arm.fullCTrades}</td>
                  <td className="px-3 py-2">{pct(arm.holdoutCReturnPct, 4)}</td>
                  <td className={`px-3 py-2 ${(arm.holdoutControlDeltaPct ?? 0) > 0 ? "text-emerald-600" : (arm.holdoutControlDeltaPct ?? 0) < 0 ? "text-red-600" : ""}`}>
                    {pp(arm.holdoutControlDeltaPct, 4)}
                  </td>
                  <td className="px-3 py-2">{arm.fusionDroppedCandidates ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {winner !== null && control !== null ? (
        <p className="text-sm">
          全周期最优融合臂：<span className="font-medium">{winner.label}</span>
          （{pp(winner.fullCReturnPct - control.fullCReturnPct, 4)}）
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        P0 只改候选排序（3F 与 trendScore 的加权融合）；TopN、maxPositions、分层仓位、
        SL-18.1 退出链、Runner 政策与数据集坐标全部冻结。结果明细见平台通用渲染器（表格 / 统计 / Gate）。
      </p>
    </div>
  );
}