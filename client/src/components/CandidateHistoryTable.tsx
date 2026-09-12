import type { inferRouterOutputs } from "@trpc/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaginationBar } from "@/components/PaginationBar";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { AppRouter } from "../../../server/routers";

type HistoryPageOutput = inferRouterOutputs<AppRouter>["sentiment"]["getLeaderCandidateHistoryPage"];

/** 明细行类型直接取自 tRPC 输出，避免与服务端字段漂移。 */
export type LeaderCandidateHistoryRow = HistoryPageOutput["rows"][number];

export type CandidateHistoryTableProps = {
  rows: LeaderCandidateHistoryRow[];
  observationDays: 1 | 2;
  /** 服务端已应用的阶段筛选（null = 未筛选）。 */
  phase: string | null;
  onClearPhase: () => void;
  page: number;
  pageSize: number;
  /** 当前筛选条件下的总行数。 */
  totalRows: number;
  /** 未筛选的全量行数。 */
  allRows: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  isLoading: boolean;
  isFetching: boolean;
  errorMessage: string | null;
  onRetry: () => void;
};

function formatDate(date: string | null) {
  if (!date) return "-";
  return date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日");
}

function riskTone(tier: "低风险" | "中风险" | "高风险") {
  if (tier === "高风险") return "border-rose-200 bg-rose-50 text-rose-700";
  if (tier === "中风险") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function getTPlus2PriceStatus(row: { secondDayDate: string | null; secondDayOpenPrice: number | null; secondDayClosePrice: number | null }) {
  if (row.secondDayDate === null) return "未到T+2观察日";
  if (row.secondDayOpenPrice === null && row.secondDayClosePrice === null) return "无可用日线行情";
  if (row.secondDayOpenPrice === null) return "开盘价缺失";
  if (row.secondDayClosePrice === null) return "收盘价缺失";
  return null;
}

/**
 * 全样本历史明细表（服务端分页）。
 *
 * 2026-09-11 性能修复：明细行数上万，过去整表回传 + 一次性渲染会把浏览器拖死。
 * 现在只渲染服务端返回的当前页（<= pageSize 行），过滤与计数都由服务端完成，
 * 因此「显示 x/y 条」始终反映筛选后的全量，而不是当前页。
 */
export function CandidateHistoryTable({
  rows,
  observationDays,
  phase,
  onClearPhase,
  page,
  pageSize,
  totalRows,
  allRows,
  totalPages,
  onPageChange,
  onPageSizeChange,
  isLoading,
  isFetching,
  errorMessage,
  onRetry,
}: CandidateHistoryTableProps) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>
          全样本历史明细：显示 {rows.length}/{totalRows} 条（共 {allRows} 条已按候选日期倒序；风险分只使用每行信号日信息）
        </span>
        {phase && (
          <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
            阶段筛选：{phase}
            <button type="button" className="ml-1 font-bold" onClick={onClearPhase}>×</button>
          </Badge>
        )}
        {isFetching && !isLoading && (
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Loader2 className="h-3 w-3 animate-spin" />更新中
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />正在加载历史明细…
        </div>
      ) : errorMessage ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-rose-200 bg-rose-50/60 py-14 text-center">
          <AlertTriangle className="h-8 w-8 text-rose-300" />
          <p className="text-sm font-medium text-rose-700">历史明细加载失败：{errorMessage}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>重新加载</Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 py-14 text-center text-sm text-slate-500">
          {totalRows === 0 && phase ? "当前阶段没有匹配的历史样本，可清除阶段筛选后重试。" : "暂无历史明细。"}
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border border-slate-200 lg:max-h-[620px]">
          <table className="w-full min-w-[1320px] text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">候选日期</th>
                <th className="px-3 py-2 font-medium">阶段</th>
                <th className="px-3 py-2 font-medium">股票</th>
                <th className="px-3 py-2 font-medium">题材</th>
                <th className="px-3 py-2 font-medium">龙头/风险/净评分</th>
                <th className="px-3 py-2 font-medium">流通市值/评分</th>
                <th className="px-3 py-2 font-medium">连板</th>
                <th className="px-3 py-2 font-medium">T+1 开/收溢价</th>
                <th className="px-3 py-2 font-medium">T+2 开/收溢价</th>
                <th className="px-3 py-2 font-medium">T+1买入→T+2出清</th>
                <th className="px-3 py-2 font-medium">T+{observationDays}结果</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.date}-${row.stockCode}`} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-600">{formatDate(row.date)}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="border-indigo-100 bg-indigo-50 text-indigo-700">{row.phase ?? "阶段缺失"}</Badge></td>
                  <td className="px-3 py-2"><p className="font-medium text-slate-800">{row.stockName}</p><p className="font-mono text-xs text-slate-500">{row.stockCode}</p></td>
                  <td className="px-3 py-2 text-slate-600">{row.sector}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-700">龙头 {row.score}分</p>
                    {row.riskScore === undefined || !row.riskTier ? (
                      <p className="mt-1 text-xs text-slate-400">风险分缺失</p>
                    ) : (
                      <>
                        <Badge variant="outline" className={`mt-1 ${riskTone(row.riskTier)}`}>风险 {row.riskScore} · {row.riskTier}</Badge>
                        <p className="mt-1 text-xs text-emerald-700">扣 {row.riskPenalty ?? "-"} · 净 {row.netScore ?? "-"}</p>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{row.circulationValue ? `${row.circulationValue}亿 / ${row.marketCapScore}分` : "- / 0分"}</td>
                  <td className="px-3 py-2 text-orange-600">{row.boards}板</td>
                  <td className="px-3 py-2">
                    <p className={row.nextOpenPremium !== null && row.nextOpenPremium > 0 ? "font-medium text-emerald-700" : "text-slate-600"}>开 {row.nextOpenPremium === null ? "-" : `${row.nextOpenPremium}%`}</p>
                    <p className={row.nextClosePremium !== null && row.nextClosePremium > 0 ? "font-medium text-emerald-700" : "text-slate-600"}>收 {row.nextClosePremium === null ? "-" : `${row.nextClosePremium}%`}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p className={row.secondDayOpenPremium !== null && row.secondDayOpenPremium > 0 ? "font-medium text-violet-700" : "text-slate-600"}>开 {row.secondDayOpenPremium === null ? "-" : `${row.secondDayOpenPremium}%`}</p>
                    <p className={row.secondDayClosePremium !== null && row.secondDayClosePremium > 0 ? "font-medium text-violet-700" : "text-slate-600"}>收 {row.secondDayClosePremium === null ? "-" : `${row.secondDayClosePremium}%`}</p>
                    {getTPlus2PriceStatus(row) && <p className="mt-0.5 text-[10px] text-slate-400">{getTPlus2PriceStatus(row)}</p>}
                  </td>
                  <td className="px-3 py-2">
                    {row.tPlus1CloseToTPlus2CloseReturn === null ? (
                      <span className="text-slate-500">-</span>
                    ) : (
                      <>
                        <p className={row.tPlus1CloseToTPlus2CloseSuccess ? "font-medium text-emerald-700" : "text-rose-600"}>{row.tPlus1CloseToTPlus2CloseReturn}%</p>
                        <p className="text-xs text-slate-500">{row.tPlus1CloseToTPlus2CloseSuccess ? "成功" : "未成功"}</p>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={row.success ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}>
                      {row.success ? `T+${observationDays} ${formatDate(row.nextDate)} 延续` : `T+${observationDays} ${formatDate(row.nextDate)} 未延续`}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaginationBar
        className="mt-3 justify-end"
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        disabled={isFetching}
      />
    </div>
  );
}
