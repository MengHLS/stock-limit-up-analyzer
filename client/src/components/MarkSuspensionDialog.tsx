import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { CalendarOff, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

type StockIdentity = { stockCode: string; stockName: string };

type Props = {
  open: boolean;
  stock: StockIdentity;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function MarkSuspensionDialog({ open, stock, onOpenChange, onChanged }: Props) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setStartDate("");
      setEndDate("");
      setNote("");
    }
  }, [open]);

  const windowsQuery = trpc.sentiment.listSuspensionWindows.useQuery(undefined, {
    enabled: open,
    staleTime: 10_000,
  });
  const stockWindows = useMemo(
    () => (windowsQuery.data ?? []).filter((w) => w.stockCode === stock.stockCode),
    [windowsQuery.data, stock.stockCode],
  );

  const markMutation = trpc.sentiment.markStockSuspension.useMutation({
    onSuccess: () => {
      toast.success("已标记停牌区间，同步检查将不再把该区间计入缺失");
      onOpenChange(false);
      onChanged?.();
    },
    onError: (error) => toast.error(`标记失败：${error.message}`),
  });

  const inferMutation = trpc.sentiment.inferStockSuspension.useMutation({
    onSuccess: (results) => {
      const result = results.find((r) => r.stockCode === stock.stockCode);
      if (!result || result.invalidCode) {
        toast.info("未取到该股日线，可能代码有误或已退市，请先校正代码");
        return;
      }
      if (result.windows.length === 0) {
        toast.info("该区间内未发现停牌（个股每日均有成交）");
        return;
      }
      void windowsQuery.refetch();
      if (result.trailing) {
        toast.success(`已识别退市/长期停牌，已自动标记 ${result.windows.length} 段永久无行情窗口`);
        onOpenChange(false);
        onChanged?.();
        return;
      }
      const latest = result.windows.at(-1)!;
      setStartDate(latest.startDate);
      setEndDate(latest.endDate);
      toast.success(`推断到 ${result.windows.length} 段停牌，已填入最近一段 ${latest.startDate} ~ ${latest.endDate}`);
    },
    onError: (error) => toast.error(`推断失败：${error.message}`),
  });

  const deleteMutation = trpc.sentiment.deleteStockSuspension.useMutation({
    onSuccess: () => {
      toast.success("已删除停牌窗口");
      void windowsQuery.refetch();
      onChanged?.();
    },
    onError: (error) => toast.error(`删除失败：${error.message}`),
  });

  const canSave = startDate && endDate && startDate <= endDate && !markMutation.isPending;
  const busy = markMutation.isPending || inferMutation.isPending || deleteMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarOff className="h-4 w-4 text-indigo-500" />
            标记停牌区间
          </DialogTitle>
          <DialogDescription>
            针对 <span className="font-mono font-medium text-slate-700">{stock.stockCode}</span>{" "}
            <span className="font-medium text-slate-700">{stock.stockName}</span>
            <br />
            停牌期间个股无行情，标记后同步检查不再把该区间当作"缺失"重复报警。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 已有窗口 */}
          {stockWindows.length > 0 && (
            <div className="space-y-2">
              <Label>已标记的停牌区间</Label>
              <div className="space-y-1.5">
                {stockWindows.map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
                    <span className="font-mono">
                      {w.startDate} ~ {w.endDate === "9999-12-31" ? "退市/永久" : w.endDate}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={w.source === "manual" ? "outline" : "secondary"} className="font-normal">
                        {w.source === "manual" ? "人工" : "自动推断"}
                      </Badge>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-rose-600"
                        title="删除该窗口"
                        onClick={() => deleteMutation.mutate({ id: w.id })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="susp-start">停牌起始日</Label>
              <Input
                id="susp-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="susp-end">停牌结束日</Label>
              <Input
                id="susp-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="susp-note">备注（可选）</Label>
            <Input
              id="susp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="如：重大资产重组停牌核查"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 w-full"
            disabled={inferMutation.isPending}
            onClick={() => {
              inferMutation.mutate({ stockCodes: [stock.stockCode], startDate: "2025-01-01", endDate: todayIso() });
            }}
          >
            {inferMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            自动推断停牌区间（用 Tushare 个股日线反推）
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={() => markMutation.mutate({ stockCode: stock.stockCode, startDate, endDate, note: note || undefined })}
            className="bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700"
          >
            {markMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存标记
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
