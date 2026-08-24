import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Filter, GitBranch } from "lucide-react";

type PhaseFunnelItem = {
  phase: "冰点试错" | "修复上升" | "上升发酵" | "高位分歧" | "高位亢奋" | "高位退潮";
  sampleSize: number;
  successCount: number;
  successRate: number | null;
  maxBoards: number | null;
};

type CandidatePhaseFunnelProps = {
  stages: PhaseFunnelItem[];
  observationDays: 1 | 2;
  activePhase: PhaseFunnelItem["phase"] | null;
  onPhaseChange: (phase: PhaseFunnelItem["phase"] | null) => void;
};

const phaseStyle: Record<PhaseFunnelItem["phase"], { color: string; soft: string; text: string }> = {
  "冰点试错": { color: "#64748b", soft: "bg-slate-100", text: "text-slate-700" },
  "修复上升": { color: "#0ea5e9", soft: "bg-sky-100", text: "text-sky-800" },
  "上升发酵": { color: "#10b981", soft: "bg-emerald-100", text: "text-emerald-800" },
  "高位分歧": { color: "#f59e0b", soft: "bg-amber-100", text: "text-amber-800" },
  "高位亢奋": { color: "#f97316", soft: "bg-orange-100", text: "text-orange-800" },
  "高位退潮": { color: "#e11d48", soft: "bg-rose-100", text: "text-rose-800" },
};

export function CandidatePhaseFunnel({ stages, observationDays, activePhase, onPhaseChange }: CandidatePhaseFunnelProps) {
  const maxSamples = Math.max(...stages.map((stage) => stage.sampleSize), 1);

  return (
    <Card className="border-indigo-100 bg-white/90 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-indigo-600" />周期阶段漏斗</CardTitle>
        <CardDescription>候选按其信号日的情绪阶段归属；仅统计满足当前评分阈值的较晚30%独立样本，并以 T+{observationDays} 涨停延续验证。</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(290px,0.75fr)] lg:items-center">
          <div className="space-y-2">
            {stages.map((stage, index) => {
              const tone = phaseStyle[stage.phase];
              const width = stage.sampleSize === 0 ? 36 : Math.max(48, Math.round((stage.sampleSize / maxSamples) * 100));
              const isActive = activePhase === stage.phase;
              return (
                <button
                  key={stage.phase}
                  type="button"
                  onClick={() => onPhaseChange(isActive ? null : stage.phase)}
                  className={`group mx-auto flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${isActive ? "border-indigo-500 ring-2 ring-indigo-200" : "border-white"} ${tone.soft}`}
                  style={{ width: `${width}%`, minWidth: "230px" }}
                  aria-pressed={isActive}
                >
                  <div className="min-w-0"><p className={`truncate text-sm font-bold ${tone.text}`}>{index + 1}. {stage.phase}</p><p className="mt-0.5 text-[11px] text-slate-500">{stage.maxBoards === null ? "暂无独立样本" : `阶段最高 ${stage.maxBoards}板`}</p></div>
                  <div className="shrink-0 text-right"><p className={`text-base font-bold ${tone.text}`}>{stage.successRate ?? "-"}{stage.successRate === null ? "" : "%"}</p><p className="text-[11px] text-slate-500">{stage.successCount}/{stage.sampleSize}</p></div>
                </button>
              );
            })}
          </div>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
            <div className="flex items-center gap-2"><Filter className="h-4 w-4 text-indigo-600" /><p className="text-sm font-semibold text-slate-800">漏斗阅读方式</p></div>
            <p className="mt-2 text-xs leading-5 text-slate-600">宽度表示该阶段的独立样本数量；右侧百分比为当前评分阈值下的 T+{observationDays} 延续率。阶段之间样本量并非资金流入或交易路径。</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{stages.map((stage) => <Badge key={stage.phase} variant="outline" className={`cursor-pointer border-transparent ${phaseStyle[stage.phase].soft} ${phaseStyle[stage.phase].text}`} onClick={() => onPhaseChange(activePhase === stage.phase ? null : stage.phase)}>{stage.phase} {stage.sampleSize}样本</Badge>)}</div>
            <p className="mt-3 text-xs font-medium text-indigo-700">点击任一阶段可筛选下方完整历史明细，再次点击取消。</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
