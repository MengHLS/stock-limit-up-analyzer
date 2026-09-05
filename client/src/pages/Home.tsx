import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { trpc } from "@/lib/trpc";
import { filterFirstBoardRecords, getPreviousRecordedDate } from "@/lib/firstBoard";
import { buildLimitUpCsv } from "@/lib/exportCsv";
import { normalizeCustomSector } from "@/lib/customSector";
import { isValidLimitUpTime, normalizeLimitUpTime } from "@shared/limitUpTime";
import { buildAdjacentRecordsByDate, getLatestDateString, summarizeDailyCounts, summarizeSectorStats, buildWatchStatusMap, setWatchStatus } from "@/lib/homeData";
import { CorrectStockDialog } from "@/components/CorrectStockDialog";
import { 
  Search, 
  Calendar, 
  TrendingUp, 
  BarChart3, 
  Loader2,
  Clock,
  Tag,
  Star,
  Download,
  Pencil,
  Trash2,
  Wand2
} from "lucide-react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { toast } from "sonner";

const EMPTY_ARRAY: any[] = [];

export default function Home() {
  const { isAuthenticated, user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const { data: watchlistData } = trpc.watchlist.getAll.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
  const watchlist = watchlistData ?? EMPTY_ARRAY;
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [watchFilter, setWatchFilter] = useState<"all" | "normal" | "important">("all");
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [showFirstBoard, setShowFirstBoard] = useState(false);
  const [sortByTime, setSortByTime] = useState<"asc" | "desc" | null>(null);
  const [recordsForExport, setRecordsForExport] = useState<any[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [correctStock, setCorrectStock] = useState<{ stockCode: string; stockName: string } | null>(null);

  // 获取股票板块（使用useCallback避免依赖问题）
  const getStockBoard = useCallback((stockCode: string): string => {
    if (stockCode.startsWith('300') || stockCode.startsWith('301')) return '创业板';
    if (stockCode.startsWith('688')) return '科创板';
    if (stockCode.startsWith('920')) return '北交所';
    return '主板';
  }, []);

  // 每日统计同时提供日历日期和每日数量，避免重复请求日期列表
  // 只加载每日统计及当前日/上一已记录交易日，避免首页初始拉取全部历史明细
  const { data: dailyStatsData, isLoading: dailyStatsLoading } = trpc.limitUp.getDailyStats.useQuery();
  const dailyStats = dailyStatsData ?? EMPTY_ARRAY;
  const dates = useMemo(() => dailyStats.map((stat) => stat.date), [dailyStats]);
  const selectedDateStrForQuery = selectedDate
    ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`
    : null;
  const previousDateStr = useMemo(
    () => selectedDateStrForQuery ? getPreviousRecordedDate(dates, selectedDateStrForQuery) : null,
    [dates, selectedDateStrForQuery],
  );
  const { data: selectedRecordsData, isLoading: selectedRecordsLoading } = trpc.limitUp.getByDate.useQuery(
    { date: selectedDateStrForQuery ?? "" },
    { enabled: !!selectedDateStrForQuery },
  );
  const selectedRecords = selectedRecordsData ?? EMPTY_ARRAY;
  const { data: previousRecordsData } = trpc.limitUp.getByDate.useQuery(
    { date: previousDateStr ?? "" },
    { enabled: !!previousDateStr },
  );
  const previousRecords = previousRecordsData ?? EMPTY_ARRAY;

  // 搜索股票
  const { data: searchResultsData, isLoading: searchLoading } = trpc.limitUp.search.useQuery(
    { query: searchQuery },
    { enabled: searchQuery.length > 0 }
  );
  const searchResults = searchResultsData ?? EMPTY_ARRAY;

  // 首板筛选只需要当前日和上一已记录交易日记录
  const recordsByDate = useMemo(
    () => buildAdjacentRecordsByDate(selectedDateStrForQuery, selectedRecords, previousDateStr, previousRecords),
    [selectedDateStrForQuery, selectedRecords, previousDateStr, previousRecords],
  );

  // 创建日期字符串到Date对象的映射
  const dateStringToDate = useMemo(() => {
    const map = new Map<string, Date>();
    dates.forEach(dateStr => {
      const [year, month, day] = dateStr.split('-').map(Number);
      map.set(dateStr, new Date(year, month - 1, day));
    });
    return map;
  }, [dates]);

  // 日期转字符串
  const dateToString = (date: Date | undefined): string | null => {
    if (!date) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // 当前选中日期的字符串格式
  const selectedDateStr = dateToString(selectedDate);

  const dailyCountSummary = useMemo(() => summarizeDailyCounts(dailyStats), [dailyStats]);

  useEffect(() => {
    if (selectedDate) {
      setCalendarMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
  }, [selectedDate]);

  // 题材统计直接从当前日期记录计算，避免再次查询同一批涨停数据
  const currentDateStats = useMemo(() => summarizeSectorStats(selectedRecords), [selectedRecords]);

  // 当前选中日期的涨停记录（按题材、板数、时间排序并支持筛选）
  const sortedRecords = useMemo(() => {
    if (!selectedDateStr) return [];
    let records = recordsByDate.get(selectedDateStr) || [];

    // 首先计算当日首板，再叠加题材和板块筛选，保证多个筛选条件可组合
    if (showFirstBoard) {
      records = filterFirstBoardRecords(recordsByDate, selectedDateStr);
    }

    if (selectedSector) {
      records = records.filter(r => r.sector === selectedSector);
    }

    if (selectedBoard) {
      records = records.filter(r => getStockBoard(r.stockCode) === selectedBoard);
    }
    
    // 创建题材顺序映射
    const sectorOrder = new Map<string, number>();
    currentDateStats.forEach((stat, index) => {
      sectorOrder.set(stat.sector, index);
    });

    // 解析板数字符串为数字（用于排序）
    const parseBoardCount = (boardCount: string | null): number => {
      if (!boardCount) return 0;
      const match = boardCount.match(/(\d+)天(\d+)板/);
      if (match) {
        return parseInt(match[2]) || 0;
      }
      return 0;
    };

    // 如果启用按时间排序，直接按时间排序
    if (sortByTime) {
      return [...records].sort((a, b) => {
        const timeA = normalizeLimitUpTime(a.limitUpTime) ?? '00:00:00';
        const timeB = normalizeLimitUpTime(b.limitUpTime) ?? '00:00:00';
        const parseTime = (time: string): number => {
          const [hours, minutes, seconds] = time.split(':').map(Number);
          return hours * 3600 + minutes * 60 + seconds;
        };
        const secondsA = parseTime(timeA);
        const secondsB = parseTime(timeB);
        const comparison = secondsA - secondsB;
        return sortByTime === 'asc' ? comparison : -comparison;
      });
    }

    return [...records].sort((a, b) => {
      // 1. 按题材排序
      const sectorOrderA = sectorOrder.get(a.sector || '') ?? 999;
      const sectorOrderB = sectorOrder.get(b.sector || '') ?? 999;
      if (sectorOrderA !== sectorOrderB) {
        return sectorOrderA - sectorOrderB;
      }
      
      // 2. 同题材内按板数降序
      const boardA = parseBoardCount(a.boardCount);
      const boardB = parseBoardCount(b.boardCount);
      if (boardA !== boardB) {
        return boardB - boardA;
      }
      
      // 3. 同板数内按涨停时间排序
      return (a.limitUpTime || '').localeCompare(b.limitUpTime || '');
    });
  }, [selectedDateStr, recordsByDate, currentDateStats, selectedSector, selectedBoard, showFirstBoard, sortByTime]);

  // 自动选择数据库中最新的涨停日期，而不是系统当前日期
  useEffect(() => {
    if (!selectedDate) {
      const latestDateStr = getLatestDateString(dates);
      const date = latestDateStr ? dateStringToDate.get(latestDateStr) : undefined;
      if (date) {
        setSelectedDate(date);
      }
    }
  }, [dates, selectedDate, dateStringToDate]);

  const isLoading = dailyStatsLoading || selectedRecordsLoading;

  const handleExport = useCallback(() => {
    if (!selectedDateStr || recordsForExport.length === 0) return;

    const csv = buildLimitUpCsv(recordsForExport);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `涨停数据-${selectedDateStr}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [selectedDateStr, recordsForExport]);

  // 校正股票代码/名称成功后：刷新日历统计、当日与前一交易日明细及搜索结果。
  // 校正可能同步改写该股票在其他涨停日的记录，故当前挂载的两个日期缓存都要失效。
  const handleStockCorrected = useCallback(() => {
    void utils.limitUp.getDailyStats.invalidate();
    void utils.limitUp.search.invalidate();
    void utils.limitUp.getDates.invalidate();
    if (selectedDateStr) void utils.limitUp.getByDate.invalidate({ date: selectedDateStr });
    if (previousDateStr) void utils.limitUp.getByDate.invalidate({ date: previousDateStr });
  }, [utils, selectedDateStr, previousDateStr]);

  // 日历上有涨停数据的日期
  const datesWithData = useMemo(() => {
    return Array.from(dateStringToDate.values());
  }, [dateStringToDate]);

  const modifiers = useMemo(() => ({
    hasData: datesWithData,
  }), [datesWithData]);

  const modifiersClassNames = {
    hasData: "relative",
  };

  const dateCountMap = useMemo(() => {
    const map = new Map<string, number>();
    dailyStats.forEach((stat) => map.set(stat.date, Number(stat.count)));
    return map;
  }, [dailyStats]);

  const CustomDayButton = useCallback(
    (props: any) => {
      const { day, modifiers, ...buttonProps } = props;
      const dateStr = day?.date ? dateToString(day.date) : null;
      const count = dateStr ? dateCountMap.get(dateStr) : undefined;
      const hasData = count !== undefined;
      const isSelected = modifiers?.selected;
      const isToday = modifiers?.today;

      return (
        <button
          {...buttonProps}
          type="button"
          className={`
            relative flex flex-col items-center justify-center w-full aspect-square rounded-lg transition-all duration-300 p-2 text-sm font-medium gap-1 cursor-pointer
            ${hasData 
              ? isSelected
                ? 'bg-gradient-to-br from-orange-400 via-orange-500 to-red-500 text-white shadow-xl border border-orange-300 hover:shadow-2xl hover:scale-105'
                : 'bg-gradient-to-br from-orange-50 via-orange-100 to-yellow-50 hover:from-orange-100 hover:via-orange-150 hover:to-yellow-100 text-orange-700 border border-orange-200 shadow-md hover:shadow-lg hover:scale-102'
              : isSelected
                ? 'bg-gradient-to-br from-slate-200 to-slate-300 text-slate-700 border border-slate-300 shadow-lg hover:scale-105'
                : isToday
                  ? 'bg-gradient-to-br from-blue-100 to-blue-200 text-blue-700 border border-blue-300 shadow-md hover:shadow-lg hover:scale-102 ring-2 ring-blue-300 ring-opacity-50'
                  : 'hover:bg-slate-100 text-slate-600 border border-slate-200 shadow-sm hover:shadow-md hover:scale-102'
            }
          `}
        >
          <span className={`font-bold leading-none text-xl ${hasData && isSelected ? "text-white" : hasData ? "text-orange-800" : "text-slate-800"}`}>
            {day?.date.getDate()}
          </span>
          {hasData && (
            <span className={`text-xs font-semibold leading-none ${isSelected ? "text-orange-100" : "text-orange-600"}`}>
              {count}
            </span>
          )}
        </button>
      );
    },
    [dateCountMap]
  );

  return (
    <div className="bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="container py-2 max-w-[1600px]">
        {/* 搜索栏 */}
        <div className="mb-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索股票代码或名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 h-10 text-base shadow-sm border-slate-200 focus-visible:ring-orange-500"
            />
          </div>
        </div>

        {/* 搜索结果 */}
        {searchQuery && (
          <Card className="mb-3 shadow-lg border-slate-200">
            <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50 py-2 px-3">
              <CardTitle className="flex items-center gap-2 text-slate-700 text-base">
                <Search className="h-4 w-4" />
                搜索结果
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2 px-3 pb-2">
              {searchLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                </div>
              ) : searchResults.length === 0 ? (
                <p className="text-center py-12 text-muted-foreground">
                  未找到相关股票
                </p>
              ) : (
                <div className="grid gap-2">
                  {searchResults.map((record) => (
                    <div
                      key={record.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white hover:shadow-md hover:border-orange-200 transition-all"
                    >
                      <div className="flex items-center gap-6">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="font-bold text-lg text-slate-800">{record.stockName}</span>
                            <span className="text-sm font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{record.stockCode}</span>
                            {record.boardCount && (
                              <Badge variant="destructive" className="bg-gradient-to-r from-orange-500 to-red-600 font-semibold">
                                {record.boardCount}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-slate-600">
                            <span className="flex items-center gap-1.5">
                              <Calendar className="h-4 w-4 text-blue-500" />
                              {record.limitUpDate}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Clock className="h-4 w-4 text-green-500" />
                              {normalizeLimitUpTime(record.limitUpTime) ?? '-'}
                            </span>
                            <Badge variant="outline" className="gap-1 border-orange-300 text-orange-700">
                              <Tag className="h-3 w-3" />
                              {record.sector}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      {record.keywords && (
                        <div className="text-sm text-slate-600 max-w-md line-clamp-2">
                          {record.keywords}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3">
            {/* 左侧：日历 */}
            <Card className="shadow-xl border-slate-200 bg-white/80 backdrop-blur">
              <CardHeader className="bg-gradient-to-r from-orange-50 to-red-50 py-2 px-3">
                <CardTitle className="flex items-center gap-2 text-slate-700 text-base">
                  <Calendar className="h-5 w-5 text-orange-600" />
                  选择日期
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2 px-3 pb-2">
                {dates.length === 0 ? (
                  <p className="text-center py-12 text-muted-foreground">
                    暂无数据，请先上传涨停复盘图片
                  </p>
                ) : (
                  <div className="calendar-container">
                    <CalendarComponent
                      mode="single"
                      selected={selectedDate}
                      month={calendarMonth}
                      onMonthChange={setCalendarMonth}
                      onSelect={setSelectedDate}
                      modifiers={modifiers}
                      modifiersClassNames={modifiersClassNames}
                      className="rounded-lg"
                      components={{
                        DayButton: CustomDayButton as any,
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 右侧：涨停数据 */}
            <div className="space-y-2">
              {selectedDateStr && (
                <>
                  {/* 题材统计 */}
                  <Card className="shadow-xl border-slate-200 bg-white/80 backdrop-blur">
                    <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 py-1 px-3">
                      <CardTitle className="flex items-center gap-2 text-slate-700 text-sm">
                        <BarChart3 className="h-4 w-4 text-blue-600" />
                        {selectedDateStr} 题材统计
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-1.5 px-3 pb-1.5">
                      <div className="mb-2 grid grid-cols-3 gap-2">
                        <div className="rounded-lg bg-orange-50 px-2 py-1.5 text-center">
                          <div className="text-[11px] text-orange-600">当日涨停</div>
                          <div className="font-bold text-orange-700">{recordsByDate.get(selectedDateStr)?.length ?? 0}</div>
                        </div>
                        <div className="rounded-lg bg-blue-50 px-2 py-1.5 text-center">
                          <div className="text-[11px] text-blue-600">历史日均</div>
                          <div className="font-bold text-blue-700">{dailyCountSummary.average}</div>
                        </div>
                        <div className="rounded-lg bg-indigo-50 px-2 py-1.5 text-center">
                          <div className="text-[11px] text-indigo-600">累计记录</div>
                          <div className="font-bold text-indigo-700">{dailyCountSummary.total}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setSelectedSector(null)}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
                            selectedSector === null
                              ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white shadow-md'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          全部 {sortedRecords.length}
                        </button>
                        {currentDateStats.map((stat) => (
                          <button
                            key={stat.sector}
                            onClick={() => setSelectedSector(stat.sector === selectedSector ? null : stat.sector)}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
                              selectedSector === stat.sector
                                ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md'
                                : 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 hover:from-blue-100 hover:to-indigo-100 border border-blue-200'
                            }`}
                          >
                            {stat.sector} {stat.count}
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* 关注筛选 */}
                  <Card className="shadow-xl border-slate-200 bg-white/80 backdrop-blur">
                    <CardContent className="p-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setWatchFilter("all")}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
                            watchFilter === "all"
                              ? 'bg-gradient-to-r from-slate-500 to-slate-600 text-white shadow-md'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          全部股票
                        </button>
                        <button
                          onClick={() => setWatchFilter("normal")}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all flex items-center gap-1 ${
                            watchFilter === "normal"
                              ? 'bg-gradient-to-r from-orange-400 to-orange-500 text-white shadow-md'
                              : 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200'
                          }`}
                        >
                          <Star className="h-3 w-3" />
                          普通关注
                        </button>
                        <button
                          onClick={() => setWatchFilter("important")}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all flex items-center gap-1 ${
                            watchFilter === "important"
                              ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-md'
                              : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                          }`}
                        >
                          <Star className="h-3 w-3 fill-current" />
                          重点关注
                        </button>
                        {/* 板块筛选 */}
                        <div className="flex items-center gap-1 ml-2 pl-2 border-l border-slate-300">
                          <button
                            onClick={() => setSelectedBoard(null)}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
                              selectedBoard === null
                                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md'
                                : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
                            }`}
                          >
                            全部板
                          </button>
                          <button
                            onClick={() => setSelectedBoard('创业板')}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
                              selectedBoard === '创业板'
                                ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-md'
                                : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                            }`}
                          >
                            创业板
                          </button>
                          <button
                            onClick={() => setSelectedBoard('科创板')}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
                              selectedBoard === '科创板'
                                ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-md'
                                : 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-200'
                            }`}
                          >
                            科创板
                          </button>
                          <button
                            onClick={() => setSelectedBoard('主板')}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
                              selectedBoard === '主板'
                                ? 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white shadow-md'
                                : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200'
                            }`}
                          >
                            主板
                          </button>
                          <button
                            onClick={() => setSelectedBoard('北交所')}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
                              selectedBoard === '北交所'
                                ? 'bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-md'
                                : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                            }`}
                          >
                            北交所
                          </button>
                        </div>
                        
                        {/* 当日首板和时间排序 */}
                        <div className="flex items-center gap-1 ml-2 pl-2 border-l border-slate-300">
                          <button
                            onClick={() => setShowFirstBoard(!showFirstBoard)}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
                              showFirstBoard
                                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md'
                                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
                            }`}
                          >
                            当日首板
                          </button>
                          <button
                            onClick={() => setSortByTime(sortByTime === null ? 'asc' : sortByTime === 'asc' ? 'desc' : null)}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all flex items-center gap-1 ${
                              sortByTime === null
                                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                : sortByTime === 'asc'
                                ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-md'
                                : 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-md'
                            }`}
                          >
                            <Clock className="h-3 w-3" />
                            {sortByTime === null ? '按时间' : sortByTime === 'asc' ? '时间↑' : '时间↓'}
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* 涨停股票列表 */}
                  <Card className="shadow-xl border-slate-200 bg-white/80 backdrop-blur">
                    <CardHeader className="bg-gradient-to-r from-orange-50 to-red-50 py-1 px-3">
                      <div className="flex items-center justify-between gap-3">
                        <CardTitle className="flex items-center gap-2 text-slate-700 text-base">
                          <TrendingUp className="h-4 w-4 text-orange-600" />
                          涨停股票 {sortedRecords.length} 只
                        </CardTitle>
                        {isAuthenticated && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleExport}
                            disabled={recordsForExport.length === 0}
                            className="gap-1 border-orange-200 text-orange-700 hover:bg-orange-50"
                          >
                            <Download className="h-3.5 w-3.5" />
                            导出CSV
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-2 px-3 pb-2">
                      <ScrollArea className="h-[700px] pr-4">
                        <WatchFilteredStockList
                          records={sortedRecords}
                          watchFilter={watchFilter}
                          isAuthenticated={isAuthenticated}
                          watchlist={watchlist}
                          onFilteredRecordsChange={setRecordsForExport}
                          onCorrectStock={isAdmin ? (stock) => setCorrectStock(stock) : undefined}
                        />
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <CorrectStockDialog
        open={correctStock !== null}
        stock={correctStock ?? { stockCode: "", stockName: "" }}
        onOpenChange={(open) => { if (!open) setCorrectStock(null); }}
        onCorrected={handleStockCorrected}
      />
    </div>
  );
}

// 关注筛选股票列表组件
function WatchFilteredStockList({
  records,
  watchFilter,
  isAuthenticated,
  watchlist,
  onFilteredRecordsChange,
  onCorrectStock,
}: {
  records: any[];
  watchFilter: "all" | "normal" | "important";
  isAuthenticated: boolean;
  watchlist: Array<{ stockCode: string; watchType: "normal" | "important" }>;
  onFilteredRecordsChange?: (records: any[]) => void;
  /** 管理员用于校正股票代码/名称（走身份批量校正，含自动补全后缀与冲突检测） */
  onCorrectStock?: (stock: { stockCode: string; stockName: string }) => void;
}) {
  const [watchStatusMap, setWatchStatusMap] = useState<Map<string, "none" | "normal" | "important">>(new Map());
  
  // 获取股票板块（使用useCallback避免依赖问题）
  const getStockBoard = useCallback((stockCode: string): string => {
    if (stockCode.startsWith('300') || stockCode.startsWith('301')) return '创业板';
    if (stockCode.startsWith('688')) return '科创板';
    if (stockCode.startsWith('920')) return '北交所';
    return '主板';
  }, []);
  
  // 使用一次性关注列表初始化当前日期股票状态，避免逐股票发起请求
  useEffect(() => {
    setWatchStatusMap(buildWatchStatusMap(records, watchlist));
  }, [records, watchlist]);
  
  // 当WatchButton组件加载完成后，会通过onStatusChange回调更新真实状态
  
  // 筛选后的记录
  const filteredRecords = useMemo(() => records.filter((record) => {
    if (watchFilter === "all") return true;
    const status = watchStatusMap.get(record.stockCode) || "none";
    return status === watchFilter;
  }), [records, watchFilter, watchStatusMap]);

  useEffect(() => {
    onFilteredRecordsChange?.(filteredRecords);
  }, [filteredRecords, onFilteredRecordsChange]);
  
  // 更新单个股票的关注状态
  const updateWatchStatus = useCallback((stockCode: string, status: "none" | "normal" | "important") => {
    setWatchStatusMap((prev) => setWatchStatus(prev, stockCode, status));
  }, []);

  return (
    <div className="grid gap-2">
      {filteredRecords.map((record) => (
                            <div
                              key={record.id}
                              className="group relative p-2 rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 hover:shadow-lg hover:border-orange-200 transition-all"
                            >
                              <div className="flex items-start justify-between mb-1.5">
                                <div className="flex items-center gap-3">
                                  <span className="font-bold text-base text-slate-800 group-hover:text-orange-600 transition-colors">
                                    {record.stockName}
                                  </span>
                                  <span className="text-sm font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                                    {record.stockCode}
                                  </span>
                                  {record.boardCount && (
                                    <Badge className="bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold shadow-sm">
                                      {record.boardCount}
                                    </Badge>
                                  )}
                                  {/* 板块标签 */}
                                  {(() => {
                                    const board = getStockBoard(record.stockCode);
                                    const boardColors: Record<string, string> = {
                                      '创业板': 'bg-green-100 text-green-700 border-green-300',
                                      '科创板': 'bg-cyan-100 text-cyan-700 border-cyan-300',
                                      '主板': 'bg-yellow-100 text-yellow-700 border-yellow-300',
                                      '北交所': 'bg-rose-100 text-rose-700 border-rose-300'
                                    };
                                    return (
                                      <Badge variant="outline" className={`border ${boardColors[board]} font-semibold text-xs`}>
                                        {board}
                                      </Badge>
                                    );
                                  })()}
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-2 text-sm">
                                    <Clock className="h-4 w-4 text-green-500" />
                                    <span className="font-semibold text-slate-700">{normalizeLimitUpTime(record.limitUpTime) ?? '-'}</span>
                                    <Badge variant="outline" className="gap-1 border-orange-300 text-orange-700 font-semibold">
                                      <Tag className="h-3 w-3" />
                                      {record.sector}
                                    </Badge>
                                  </div>
                                  {isAuthenticated && (
                                    <WatchButton
                                      stockCode={record.stockCode}
                                      stockName={record.stockName}
                                      watchStatus={watchStatusMap.get(record.stockCode) ?? "none"}
                                      onStatusChange={updateWatchStatus}
                                    />
                                  )}
                                  {isAuthenticated && <StockRecordActions record={record} onCorrectStock={onCorrectStock} />}
                                </div>
                              </div>
                              {record.keywords && (
                                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-1.5 rounded-lg">
                                  {record.keywords}
                                </p>
                              )}
        </div>
      ))}
    </div>
  );
}

// 关注按钮组件
function WatchButton({ 
  stockCode, 
  stockName,
  watchStatus,
  onStatusChange
}: { 
  stockCode: string; 
  stockName: string;
  watchStatus: "none" | "normal" | "important";
  onStatusChange?: (stockCode: string, status: "none" | "normal" | "important") => void;
}) {
  const utils = trpc.useUtils();
  const updateWatch = trpc.limitUp.updateWatchStatus.useMutation({
    onSuccess: (_, variables) => {
      utils.watchlist.getAll.invalidate();
      onStatusChange?.(stockCode, variables.watchStatus);
    },
  });

  const handleClick = () => {
    if (!watchStatus) return;
    
    let newStatus: "none" | "normal" | "important";
    if (watchStatus === "none") {
      newStatus = "normal";
    } else if (watchStatus === "normal") {
      newStatus = "important";
    } else {
      newStatus = "none";
    }
    
    updateWatch.mutate({ stockCode, stockName, watchStatus: newStatus });
  };

  if (!watchStatus) return null;

  return (
    <button
      onClick={handleClick}
      disabled={updateWatch.isPending}
      className="transition-all hover:scale-110 disabled:opacity-50"
      title={
        watchStatus === "none" 
          ? "点击添加关注" 
          : watchStatus === "normal" 
          ? "普通关注，点击切换为重点关注" 
          : "重点关注，点击取消关注"
      }
    >
      {watchStatus === "none" && (
        <Star className="h-5 w-5 text-slate-300 hover:text-orange-400" />
      )}
      {watchStatus === "normal" && (
        <Star className="h-5 w-5 text-orange-400 fill-orange-400" />
      )}
      {watchStatus === "important" && (
        <Star className="h-5 w-5 text-red-600 fill-red-600" />
      )}
    </button>
  );
}


function StockRecordActions({ record, onCorrectStock }: { record: any; onCorrectStock?: (stock: { stockCode: string; stockName: string }) => void }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [stockName, setStockName] = useState(record.stockName ?? "");
  const [limitUpTime, setLimitUpTime] = useState(normalizeLimitUpTime(record.limitUpTime) ?? "");
  const [sector, setSector] = useState(record.sector ?? "");
  const [keywords, setKeywords] = useState(record.keywords ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const updateRecord = trpc.limitUp.update.useMutation({
    onSuccess: () => {
      setErrorMessage(null);
      setSuccessMessage("已保存自定义题材分类");
      setEditing(false);
      utils.limitUp.getDailyStats.invalidate();
      utils.limitUp.getByDate.invalidate({ date: record.limitUpDate });
      utils.limitUp.search.invalidate();
    },
    onError: (error) => setErrorMessage(error.message || "保存失败，请稍后重试"),
  });
  const deleteRecord = trpc.limitUp.delete.useMutation({
    onSuccess: () => {
      utils.limitUp.getDailyStats.invalidate();
      utils.limitUp.getByDate.invalidate({ date: record.limitUpDate });
      utils.limitUp.search.invalidate();
    },
    onError: (error) => toast.error(error.message || "删除失败，请稍后重试"),
  });

  const isTimeValid = isValidLimitUpTime(limitUpTime);

  if (editing) {
    return (
      <div className="absolute right-2 top-10 z-10 grid w-64 gap-1 rounded-lg border border-orange-200 bg-white p-2 shadow-xl">
        <Input value={stockName} onChange={(event) => setStockName(event.target.value)} placeholder="股票名称" className="h-7 text-xs" />
        <Input value={limitUpTime} onChange={(event) => setLimitUpTime(event.target.value)} placeholder="涨停时间 HH:MM:SS" className="h-7 text-xs" />
        <Input value={sector} onChange={(event) => setSector(event.target.value)} placeholder="自定义题材分类" className="h-7 text-xs" />
        <Input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="关键词" className="h-7 text-xs" />
        {!isTimeValid && <p className="text-xs text-red-600">时间格式应为 HH:MM:SS（也支持输入HH:MM自动补秒）</p>}
        {errorMessage && <p className="text-xs text-red-600">{errorMessage}</p>}
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing(false)}>取消</Button>
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={updateRecord.isPending || !stockName.trim() || !isTimeValid}
            onClick={() => updateRecord.mutate({
              id: record.id,
              stockName: stockName.trim(),
              limitUpTime: normalizeLimitUpTime(limitUpTime) ?? "",
              sector: normalizeCustomSector(sector),
              keywords: keywords.trim() || undefined,
            })}
          >
            保存
          </Button>
        </div>
      </div>
    );
  }

  return (
        <div className="flex items-center gap-1">
      {successMessage && <span className="text-xs text-green-600">{successMessage}</span>}
      {onCorrectStock && (
        <button
          type="button"
          className="rounded p-1 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
          title="校正股票代码 / 名称（自动补全交易所后缀，同步更新该股票全部涨停记录）"
          onClick={() => onCorrectStock({ stockCode: record.stockCode, stockName: record.stockName })}
        >
          <Wand2 className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        className="rounded p-1 text-slate-400 hover:bg-orange-50 hover:text-orange-600"
        title="编辑记录"
        onClick={() => {
          setSuccessMessage(null);
          setEditing(true);
        }}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
        title="删除记录"
        disabled={deleteRecord.isPending}
        onClick={() => {
          if (window.confirm(`确定删除 ${record.stockName}（${record.stockCode}）吗？`)) {
            deleteRecord.mutate({ id: record.id });
          }
        }}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
