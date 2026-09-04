import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { CorrectStockDialog } from "@/components/CorrectStockDialog";
import { MarkSuspensionDialog } from "@/components/MarkSuspensionDialog";
import { DateRangeSyncDialog } from "@/components/DateRangeSyncDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarOff,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CloudDownload,
  Database,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function formatDate(date: string) {
  return date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1-$2-$3");
}

/** 生成带省略号的页码序列，例如 [1, '...', 4, 5, 6, '...', 20] */
function buildPageList(current: number, total: number): Array<number | "..."> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const delta = 1;
  const result: Array<number | "..."> = [];
  for (let p = 1; p <= total; p += 1) {
    if (p === 1 || p === total || (p >= current - delta && p <= current + delta)) {
      result.push(p);
    } else if (result[result.length - 1] !== "...") {
      result.push("...");
    }
  }
  return result;
}

type SyncResultLike = {
  savedPriceRows: number;
  missingPricePairs: number;
  failedDates: string[];
  rateLimited?: boolean;
};

function describeSyncResult(result: SyncResultLike): { kind: "success" | "error" | "info"; text: string } {
  if (result.rateLimited) {
    return { kind: "error", text: "触发 Tushare 限频，已中止同步，请稍候 1 分钟再试" };
  }
  if (result.failedDates.length > 0) {
    return { kind: "error", text: `部分日期同步失败：${result.failedDates.join("、")}` };
  }
  if (result.savedPriceRows === 0) {
    return { kind: "info", text: "该股票/日期暂无可用行情（可能停牌、退市或交易日未到）" };
  }
  return { kind: "success", text: `已同步 ${result.savedPriceRows} 条日线价格${result.missingPricePairs > 0 ? `，仍缺 ${result.missingPricePairs} 个` : ""}` };
}

export default function StockSync() {
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [search, setSearch] = useState("");
  const [syncingCode, setSyncingCode] = useState<string | null>(null);
  const [correctStock, setCorrectStock] = useState<{ stockCode: string; stockName: string } | null>(null);
  const [markSuspension, setMarkSuspension] = useState<{ stockCode: string; stockName: string } | null>(null);
  const [dateRangeSync, setDateRangeSync] = useState(false);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading, isError, refetch, isFetching } = trpc.sentiment.getStockSyncStatus.useQuery(undefined, {
    staleTime: 30_000,
  });

  const syncAllMutation = trpc.sentiment.syncCandidateDailyPrices.useMutation({
    onSuccess: (result) => {
      const message = describeSyncResult(result);
      if (message.kind === "success") toast.success(message.text);
      else if (message.kind === "info") toast.info(message.text);
      else toast.error(message.text);
      void refetch();
    },
    onError: (error) => {
      toast.error(`同步失败：${error.message}`);
    },
  });

  const syncOneMutation = trpc.sentiment.syncStockPriceForDate.useMutation({
    onSuccess: (result) => {
      const message = describeSyncResult(result);
      if (message.kind === "success") toast.success(message.text);
      else if (message.kind === "info") toast.info(message.text);
      else toast.error(message.text);
      setSyncingCode(null);
      void refetch();
    },
    onError: (error) => {
      toast.error(`同步失败：${error.message}`);
      setSyncingCode(null);
    },
  });

  // 1) 先按当前筛选条件过滤
  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter((item) => {
      if (onlyMissing && item.missingCount === 0) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return item.stockCode.toLowerCase().includes(q) || item.stockName.toLowerCase().includes(q);
    });
  }, [data, onlyMissing, search]);

  // 2) 仅对「涨停日期」列做升/降序排序（稳定排序，同日期保持原相对顺序）
  const sortedItems = useMemo(() => {
    if (sortDir === "asc") {
      return [...filteredItems].sort((a, b) => a.limitUpDate.localeCompare(b.limitUpDate));
    }
    return [...filteredItems].sort((a, b) => b.limitUpDate.localeCompare(a.limitUpDate));
  }, [filteredItems, sortDir]);

  // 3) 分页切片
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(
    () => sortedItems.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sortedItems, safePage, pageSize]
  );

  // 筛选/搜索/每页条数变化时回到第一页，避免停留在越界页码
  useEffect(() => {
    setPage(1);
  }, [onlyMissing, search, pageSize]);

  const items = pagedItems;
  const summary = data?.summary;
  const syncBusy = syncAllMutation.isPending;

  return (
    <div className="container py-4 max-w-[1400px] space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-md">
            <CloudDownload className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-lg font-bold text-slate-800">行情同步检查</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={syncBusy}
            onClick={() => syncAllMutation.mutate({ mode: "recent" })}
          >
            {syncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            同步最近8个交易日
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={syncBusy}
            onClick={() => syncAllMutation.mutate({ mode: "full" })}
          >
            {syncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            全量同步
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setDateRangeSync(true)}
          >
            <CalendarRange className="h-4 w-4" />
            按日期同步
          </Button>
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => void refetch()}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新
          </Button>
        </div>
      </div>
        {/* 概览卡片 */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="py-2 px-3"><CardDescription className="text-xs">股票总数</CardDescription></CardHeader>
              <CardContent className="py-1 px-3"><div className="text-2xl font-bold text-slate-800">{summary.totalStocks}</div></CardContent>
            </Card>
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="py-2 px-3"><CardDescription className="text-xs">完全同步</CardDescription></CardHeader>
              <CardContent className="py-1 px-3"><div className="text-2xl font-bold text-emerald-600">{summary.fullySynced}</div></CardContent>
            </Card>
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="py-2 px-3"><CardDescription className="text-xs">部分缺失</CardDescription></CardHeader>
              <CardContent className="py-1 px-3"><div className="text-2xl font-bold text-amber-600">{summary.partialSynced}</div></CardContent>
            </Card>
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="py-2 px-3"><CardDescription className="text-xs">完全未同步</CardDescription></CardHeader>
              <CardContent className="py-1 px-3"><div className="text-2xl font-bold text-rose-600">{summary.fullyMissing}</div></CardContent>
            </Card>
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="py-2 px-3"><CardDescription className="text-xs">缺失行情对数</CardDescription></CardHeader>
              <CardContent className="py-1 px-3"><div className="text-2xl font-bold text-rose-600">{summary.missingPairs}</div></CardContent>
            </Card>
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="py-2 px-3"><CardDescription className="text-xs">已同步行情行数</CardDescription></CardHeader>
              <CardContent className="py-1 px-3"><div className="text-2xl font-bold text-sky-600">{summary.syncedPairCount}</div></CardContent>
            </Card>
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="py-2 px-3"><CardDescription className="text-xs">停牌无行情日数</CardDescription></CardHeader>
              <CardContent className="py-1 px-3"><div className="text-2xl font-bold text-indigo-600">{summary.suspendedPairs}</div></CardContent>
            </Card>
          </div>
        )}

        {!summary?.calendarAvailable && !isLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <AlertTriangle className="h-4 w-4" />
            未配置 TUSHARE_TOKEN，无法获取交易日历，以下仅按「信号日」检查缺失情况。
          </div>
        )}

        {/* 筛选栏 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索股票代码或名称..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 w-64 text-sm border-slate-200"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(e) => setOnlyMissing(e.target.checked)}
              className="h-4 w-4 accent-orange-500"
            />
            仅显示未同步
          </label>
        </div>

        {/* 列表 */}
        <Card className="shadow-sm border-slate-200">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
              </div>
            ) : isError ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">加载失败，请刷新重试</div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-2" />
                {onlyMissing ? "没有未同步的股票数据" : "暂无数据"}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>股票代码</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))}
                        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors select-none"
                        title={`按涨停日期排序，当前为${sortDir === "asc" ? "升序" : "降序"}（点击切换）`}
                        aria-label={`按涨停日期排序，当前${sortDir === "asc" ? "升序" : "降序"}`}
                      >
                        涨停日期
                        {sortDir === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5 text-orange-500" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 text-orange-500" aria-hidden />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>板数</TableHead>
                    <TableHead>题材</TableHead>
                    <TableHead>缺失数</TableHead>
                    <TableHead>缺失日期</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const isSyncing = syncingCode === item.stockCode;
                    return (
                      <TableRow key={`${item.stockCode}-${item.limitUpDate}`}>
                        <TableCell className="font-mono text-xs">{item.stockCode}</TableCell>
                        <TableCell className="font-medium">{item.stockName}</TableCell>
                        <TableCell className="text-xs">{formatDate(item.limitUpDate)}</TableCell>
                        <TableCell className="text-xs">{item.boardCount ?? "-"}</TableCell>
                        <TableCell className="text-xs">
                          {item.sector ? <Badge variant="secondary" className="font-normal">{item.sector}</Badge> : "-"}
                        </TableCell>
                        <TableCell>
                          {item.missingCount === 0 ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">已同步</Badge>
                          ) : (
                            <Badge className="bg-rose-50 text-rose-700 border-rose-200">{item.missingCount}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs max-w-[260px]">
                          <div className="flex flex-wrap items-center gap-1">
                            {item.suspendedDates.length > 0 && (
                              <span
                                className="inline-flex items-center gap-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 text-[11px]"
                                title={`停牌（个股无成交）：${item.suspendedDates.map((d) => formatDate(d)).join("、")}`}
                              >
                                停牌 {item.suspendedDates.length}日
                              </span>
                            )}
                            {item.missingDates.length > 0 && (
                              <span
                                className="inline-flex items-center rounded bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 text-[11px]"
                                title={`真缺失：${item.missingDates.map((d) => formatDate(d)).join("、")}`}
                              >
                                缺 {item.missingDates.length}日
                              </span>
                            )}
                            {item.missingDates.length === 0 && item.suspendedDates.length === 0 && (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                              title="校正该股票的名称或代码（如录入错误导致一直无法同步）"
                              onClick={() => setCorrectStock({ stockCode: item.stockCode, stockName: item.stockName })}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              校正
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50"
                              title="标记该股的停牌区间（停牌日无行情，无需同步）"
                              onClick={() => setMarkSuspension({ stockCode: item.stockCode, stockName: item.stockName })}
                            >
                              <CalendarOff className="h-3.5 w-3.5" />
                              停牌
                            </Button>
                            {item.missingCount > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 h-8"
                                disabled={isSyncing}
                                onClick={() => {
                                  setSyncingCode(item.stockCode);
                                  syncOneMutation.mutate({ date: item.limitUpDate, stockCodes: [item.stockCode] });
                                }}
                              >
                                {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
                                同步
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 排序状态 + 分页 */}
        {!isLoading && !isError && sortedItems.length > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>
                共 <span className="font-semibold text-slate-700">{sortedItems.length}</span> 条
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-orange-700">
                {sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                涨停日期 {sortDir === "asc" ? "升序" : "降序"}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>每页</span>
                <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                  <SelectTrigger size="sm" className="h-8 w-[72px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map((size) => (
                      <SelectItem key={size} value={String(size)} className="text-xs">
                        {size} 条
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 disabled:opacity-40"
                  disabled={safePage <= 1}
                  onClick={() => setPage(1)}
                  title="第一页"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 disabled:opacity-40"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  title="上一页"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {buildPageList(safePage, totalPages).map((entry, index) =>
                  entry === "..." ? (
                    <span key={`ellipsis-${index}`} className="px-1 text-xs text-slate-400">
                      …
                    </span>
                  ) : (
                    <Button
                      key={entry}
                      variant={entry === safePage ? "default" : "ghost"}
                      size="sm"
                      className={
                        entry === safePage
                          ? "h-8 w-8 p-0 text-xs font-semibold"
                          : "h-8 w-8 p-0 text-xs text-slate-600 hover:text-slate-900"
                      }
                      onClick={() => setPage(entry)}
                      aria-current={entry === safePage ? "page" : undefined}
                    >
                      {entry}
                    </Button>
                  )
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 disabled:opacity-40"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  title="下一页"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 disabled:opacity-40"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(totalPages)}
                  title="最后一页"
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>

              <span className="text-xs text-slate-500 whitespace-nowrap">
                第 {safePage} / {totalPages} 页
              </span>
            </div>
          </div>
        )}

        <CorrectStockDialog
          open={correctStock !== null}
          stock={correctStock ?? { stockCode: "", stockName: "" }}
          onOpenChange={(open) => { if (!open) setCorrectStock(null); }}
          onCorrected={() => void refetch()}
        />

        <MarkSuspensionDialog
          open={markSuspension !== null}
          stock={markSuspension ?? { stockCode: "", stockName: "" }}
          onOpenChange={(open) => { if (!open) setMarkSuspension(null); }}
          onChanged={() => void refetch()}
        />

        <DateRangeSyncDialog
          open={dateRangeSync}
          onOpenChange={setDateRangeSync}
          onSynced={() => void refetch()}
        />
    </div>
  );
}
