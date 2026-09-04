import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { CalendarRange, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSynced?: () => void;
};

type SyncResult = {
  savedPriceRows: number;
  missingPricePairs: number;
  failedDates: string[];
  dateDetails: Array<{ tradeDate: string; requestedCount: number; savedCount: number; missingCount: number; failed: boolean }>;
};

export function DateRangeSyncDialog({ open, onOpenChange, onSynced }: Props) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    if (open) {
      setStartDate("");
      setEndDate("");
      setResult(null);
    }
  }, [open]);

  const syncMutation = trpc.sentiment.syncStockPricesByDateRange.useMutation({
    onSuccess: (data) => {
      setResult(data);
      if (data.failedDates.length > 0) {
        toast.error(`同步完成：成功 ${data.savedPriceRows} 条，失败 ${data.failedDates.length} 个交易日`);
      } else {
        toast.success(`同步完成：保存 ${data.savedPriceRows} 条${data.missingPricePairs > 0 ? `，仍缺 ${data.missingPricePairs} 对` : ""}`);
      }
      onSynced?.();
    },
    onError: (error) => toast.error(`同步失败：${error.message}`),
  });

  const isSingleDay = Boolean(startDate && endDate && startDate === endDate);
  const canSync = Boolean(startDate && endDate && startDate <= endDate) && !syncMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!syncMutation.isPending) onOpenChange(next); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-sky-500" />
            按日期同步行情
          </DialogTitle>
          <DialogDescription>
            指定日期范围，仅同步该范围内交易日的行情数据。支持单日（起止相同）或区间；停牌/退市日会自动跳过，不会重复拉取。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="range-start">起始日期</Label>
              <Input
                id="range-start"
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setResult(null); }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="range-end">结束日期</Label>
              <Input
                id="range-end"
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setResult(null); }}
              />
            </div>
          </div>

          {startDate && endDate && startDate <= endDate && (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              {isSingleDay
                ? `将同步 ${startDate} 单日行情`
                : `将同步 ${startDate} ~ ${endDate} 区间行情`}
              （含起止日）
            </div>
          )}
          {startDate && endDate && startDate > endDate && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              起始日期不能晚于结束日期
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> 成功 {result.savedPriceRows} 条
                </span>
                <span className="text-amber-700">缺失 {result.missingPricePairs} 对</span>
                {result.failedDates.length > 0 && (
                  <span className="flex items-center gap-1 text-rose-700">
                    <XCircle className="h-4 w-4" /> 失败 {result.failedDates.length} 日
                  </span>
                )}
              </div>
              {result.failedDates.length > 0 && (
                <p className="text-xs text-rose-600">失败日期：{result.failedDates.join("、")}</p>
              )}
              {result.dateDetails.length > 0 && (
                <div className="max-h-44 overflow-y-auto rounded border border-slate-200 bg-white">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-100 text-slate-600">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">日期</th>
                        <th className="px-2 py-1.5 text-right font-medium">请求</th>
                        <th className="px-2 py-1.5 text-right font-medium">成功</th>
                        <th className="px-2 py-1.5 text-right font-medium">缺失</th>
                        <th className="px-2 py-1.5 text-right font-medium">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.dateDetails.map((d) => (
                        <tr key={d.tradeDate} className="border-t border-slate-100">
                          <td className="px-2 py-1 font-mono">{d.tradeDate}</td>
                          <td className="px-2 py-1 text-right">{d.requestedCount}</td>
                          <td className="px-2 py-1 text-right text-emerald-700">{d.savedCount}</td>
                          <td className="px-2 py-1 text-right text-amber-700">{d.missingCount}</td>
                          <td className="px-2 py-1 text-right">
                            {d.failed ? <span className="text-rose-600">失败</span> : <span className="text-emerald-600">成功</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={syncMutation.isPending}>
            关闭
          </Button>
          <Button
            type="button"
            disabled={!canSync}
            onClick={() => syncMutation.mutate({ startDate, endDate })}
            className="bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700"
          >
            {syncMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            开始同步
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
