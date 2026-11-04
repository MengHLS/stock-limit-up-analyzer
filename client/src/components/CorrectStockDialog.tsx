import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CheckCircle2, Loader2, Search, Wand2 } from "lucide-react";
import { toast } from "sonner";

type StockIdentity = { stockCode: string; stockName: string };

type Props = {
  open: boolean;
  stock: StockIdentity;
  onOpenChange: (open: boolean) => void;
  /** 校正成功后回调（已由父组件刷新列表） */
  onCorrected?: () => void;
};

export function CorrectStockDialog({ open, stock, onOpenChange, onCorrected }: Props) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [lookupNote, setLookupNote] = useState<{ tsCode: string; name: string } | null>(null);

  useEffect(() => {
    if (open && stock.stockCode) {
      setCode(stock.stockCode);
      setName(stock.stockName);
      setLookupNote(null);
    }
  }, [open, stock]);

  const lookupMutation = trpc.sentiment.lookupStockInfo.useMutation({
    onSuccess: (info) => {
      if (!info) {
        setLookupNote(null);
        toast.info("未查询到该代码对应的股票，请检查代码数字是否写错");
      } else {
        setLookupNote(info);
        toast.success(`查询到：${info.tsCode} ${info.name}`);
      }
    },
    onError: (error) => toast.error(`查询失败：${error.message}`),
  });

  const correctMutation = trpc.sentiment.correctStockIdentity.useMutation({
    onSuccess: (result) => {
      toast.success(`已校正 ${result.updatedRows} 条记录（涉及 ${result.dates.length} 个涨停日）`);
      onOpenChange(false);
      onCorrected?.();
    },
    onError: (error) => toast.error(`校正失败：${error.message}`),
  });

  const handleLookup = () => {
    const digits = code.trim().match(/(\d{6})/)?.[1];
    if (!digits) {
      toast.error("请先输入 6 位数字代码再查询");
      return;
    }
    lookupMutation.mutate({ code: digits });
  };

  const canSave = code.trim().length > 0 && name.trim().length > 0 && !correctMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!correctMutation.isPending) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-orange-500" />
            校正股票名称 / 代码
          </DialogTitle>
          <DialogDescription>
            正在校正 <span className="font-mono font-medium text-slate-700">{stock.stockCode}</span>{" "}
            <span className="font-medium text-slate-700">{stock.stockName}</span>
            <br />
            将同步更新该名称下所有涨停记录，建议先「查询验证」确认代码正确。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="correct-code">新代码</Label>
            <div className="flex gap-2">
              <Input
                id="correct-code"
                value={code}
                onChange={(e) => { setCode(e.target.value); setLookupNote(null); }}
                placeholder="如 600272 或 600272.SH（后缀可留空）"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="用腾讯行情验证代码并反查真实名称"
                onClick={handleLookup}
                disabled={lookupMutation.isPending}
                className="shrink-0"
              >
                {lookupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            {lookupNote && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="space-y-1">
                  <div>
                    查询到：<span className="font-mono font-semibold">{lookupNote.tsCode}</span>{" "}
                    <span className="font-semibold">{lookupNote.name}</span>
                  </div>
                  <button
                    type="button"
                    className="underline decoration-dotted underline-offset-2 hover:text-emerald-900"
                    onClick={() => { setCode(lookupNote.tsCode); setName(lookupNote.name); }}
                  >
                    填入此名称与代码
                  </button>
                  <div className="text-emerald-600/80">名称可能为当前最新名称（含 ST 前缀），如需保留历史名称可手动改回。</div>
                </div>
              </div>
            )}
            {code.trim() && !lookupNote && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                后缀可留空，保存时会按代码前缀自动补全（6→SH、0/3→SZ、4/8/92→BJ）。
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="correct-name">名称</Label>
            <Input
              id="correct-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="股票名称"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={correctMutation.isPending}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={() => {
              correctMutation.mutate({
                fromCode: stock.stockCode,
                fromName: stock.stockName,
                toCode: code,
                toName: name,
              });
            }}
            className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700"
          >
            {correctMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存校正
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
