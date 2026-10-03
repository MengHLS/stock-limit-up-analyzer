/** STRATEGY-3570001 模拟盘只读适配页：查询持久化 API，展示复用通用 Paper Trading 模板。 */
import {
  PaperTradingTemplate,
  type PaperSignalRecord,
  type PaperTradingSignalColumn,
  type PaperTradingState,
  type PaperForwardState,
} from "@/components/strategy/PaperTradingTemplate";
import { trpc } from "@/lib/trpc";

const SIGNAL_COLUMNS: readonly PaperTradingSignalColumn[] = [
  {
    key: "rank",
    header: "3F Top3 排名",
    value: (_signal: PaperSignalRecord, index: number) => `#${index + 1}`,
  },
  {
    key: "newHigh3",
    header: "NEW_HIGH_3",
    value: (signal: PaperSignalRecord) => (signal.newHigh3 ? "是" : "—"),
  },
];

export default function PaperTrading3570001() {
  // ✅ SCOPE-002 S7：改用**通用**端点（按版本坐标），专项端点只是它的薄封装。
  const q = trpc.researchRun.getStrategyVersionPaperTrading.useQuery({
    strategyId: "first-limit-pullback-3f-top3-runner-hold20",
    strategyVersion: "1.0.0",
  });
  const payload = q.data as { state: PaperTradingState | null; forward: PaperForwardState | null } | null;
  const state = payload?.state ?? null;

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">加载模拟盘数据…</div>;
  if (state === null) return <div className="p-6 text-sm text-muted-foreground">尚无持久化的模拟盘运行数据。</div>;
  return <PaperTradingTemplate state={state} forward={payload?.forward ?? null} signalColumns={SIGNAL_COLUMNS} />;
}
