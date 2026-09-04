import { useAuth } from "@/_core/hooks/useAuth";
import { AlertCircle, ArrowLeft, CheckCircle2, Database, Loader2, RefreshCw, Search, UploadCloud } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";

export default function StockPriceSyncPage() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const [stockCode, setStockCode] = useState("");
  const [signalDate, setSignalDate] = useState("");
  const [syncingKey, setSyncingKey] = useState<string | null>(null);
  const queryInput = useMemo(() => ({ stockCode: stockCode.trim() || undefined, signalDate: signalDate || undefined }), [signalDate, stockCode]);
  const missingQuery = trpc.sentiment.getMissingStockPrices.useQuery(queryInput, { enabled: isAuthenticated });
  const syncMutation = trpc.sentiment.syncMissingStockPrices.useMutation();

  const rows = missingQuery.data ?? [];
  const missingPairCount = rows.reduce((sum, row) => sum + row.missingCount, 0);
  const sync = async (filter: { stockCode?: string; signalDate?: string }, key: string) => {
    setSyncingKey(key);
    try {
      const result = await syncMutation.mutateAsync(filter);
      toast.success(`同步完成：保存 ${result.savedPriceRows} 条，仍缺失 ${result.missingPricePairs} 条`);
      await missingQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "手动同步失败，请检查权限或行情接口");
    } finally {
      setSyncingKey(null);
    }
  };

  if (!authLoading && !isAuthenticated) {
    return <div className="min-h-screen bg-background flex items-center justify-center p-4"><Card className="w-full max-w-md"><CardHeader className="text-center"><CardTitle>请先登录</CardTitle><CardDescription>登录后才能检查和手动同步行情数据</CardDescription></CardHeader><CardContent><Button asChild className="w-full"><a href={getLoginUrl()}>登录</a></Button></CardContent></Card></div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <header className="sticky top-0 z-50 w-full border-b bg-white/85 backdrop-blur-xl shadow-sm">
        <div className="container flex h-14 items-center justify-between gap-3">
          <Link href="/"><Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="h-4 w-4" />返回首页</Button></Link>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Database className="h-4 w-4 text-orange-600" />行情同步检查</div>
        </div>
      </header>
      <main className="container max-w-[1500px] py-6">
        <div className="mb-5"><h1 className="text-2xl font-bold text-slate-900">行情同步检查</h1><p className="mt-1 text-sm text-slate-600">检查候选股票信号日及后续5个实际交易日的日线行情。手动同步需要管理员权限，写入仍采用股票—交易日幂等规则。</p></div>
        <Card className="mb-5 border-slate-200/80 shadow-sm"><CardHeader className="pb-3"><CardTitle className="text-base">筛选缺失记录</CardTitle><CardDescription>缺失数量按股票和信号日汇总；同步完成后可刷新列表确认覆盖情况。</CardDescription></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-end"><div className="space-y-2"><Label htmlFor="sync-stock-code">股票代码</Label><Input id="sync-stock-code" placeholder="例如 600001.SH" value={stockCode} onChange={(event) => setStockCode(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="sync-signal-date">信号日期</Label><Input id="sync-signal-date" type="date" value={signalDate} onChange={(event) => setSignalDate(event.target.value)} /></div><Button variant="outline" onClick={() => void missingQuery.refetch()} disabled={missingQuery.isFetching} className="gap-2"><RefreshCw className={missingQuery.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />检查缺失</Button><Button onClick={() => void sync({}, "all")} disabled={syncingKey !== null || rows.length === 0} className="gap-2"><UploadCloud className="h-4 w-4" />同步当前筛选</Button></div></CardContent></Card>
        <div className="mb-5 grid gap-4 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-xs text-slate-500">缺失股票—信号日</p><p className="mt-1 text-2xl font-bold text-red-600">{rows.length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-slate-500">缺失行情组合</p><p className="mt-1 text-2xl font-bold text-amber-600">{missingPairCount}</p></CardContent></Card><Card><CardContent className="flex items-center gap-3 p-4"><CheckCircle2 className="h-7 w-7 text-emerald-600" /><div><p className="text-xs text-slate-500">检查状态</p><p className="font-semibold">{missingQuery.isLoading ? "检查中" : rows.length === 0 ? "未发现缺失" : "存在待补全"}</p></div></CardContent></Card></div>
        <Card className="border-slate-200/80 shadow-sm"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Search className="h-5 w-5 text-orange-600" />缺失明细 {!missingQuery.isLoading && <Badge variant="secondary">{rows.length} 条</Badge>}</CardTitle></CardHeader><CardContent>
          {missingQuery.isLoading && <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在检查行情覆盖...</div>}
          {missingQuery.error && <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{missingQuery.error.message}</div>}
          {!missingQuery.isLoading && !missingQuery.error && rows.length === 0 && <div className="rounded-lg bg-muted/50 p-10 text-center text-sm text-muted-foreground">当前筛选条件下没有缺失行情。</div>}
          {!missingQuery.isLoading && !missingQuery.error && rows.length > 0 && <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/50 text-left"><tr><th className="px-4 py-3 font-medium">股票代码</th><th className="px-4 py-3 font-medium">信号日</th><th className="px-4 py-3 font-medium">应有交易日</th><th className="px-4 py-3 font-medium">缺失交易日</th><th className="px-4 py-3 text-right font-medium">缺失数</th><th className="px-4 py-3 text-right font-medium">操作</th></tr></thead><tbody className="divide-y">{rows.map((row) => { const key = `${row.stockCode}::${row.signalDate}`; return <tr key={key} className="align-top hover:bg-muted/30"><td className="px-4 py-3 font-medium">{row.stockCode}</td><td className="whitespace-nowrap px-4 py-3">{row.signalDate}</td><td className="max-w-[280px] px-4 py-3 text-muted-foreground">{row.requiredTradeDates.join("、")}</td><td className="max-w-[320px] px-4 py-3 text-red-600">{row.missingTradeDates.join("、")}</td><td className="px-4 py-3 text-right"><Badge variant="destructive">{row.missingCount}</Badge></td><td className="px-4 py-3 text-right"><Button size="sm" variant="outline" disabled={syncingKey !== null} onClick={() => void sync({ stockCode: row.stockCode, signalDate: row.signalDate }, key)} className="gap-1">{syncingKey === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}{syncingKey === key ? "同步中" : "手动同步"}</Button></td></tr>; })}</tbody></table></div>}
        </CardContent></Card>
      </main>
    </div>
  );
}
