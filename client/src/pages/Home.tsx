import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { 
  Upload, 
  Search, 
  Calendar, 
  TrendingUp, 
  BarChart3, 
  Loader2,
  Clock,
  Hash,
  Tag,
  Flame,
  Star,
  Database
} from "lucide-react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { Link } from "wouter";

export default function Home() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [watchFilter, setWatchFilter] = useState<"all" | "normal" | "important">("all");
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);

  // 获取股票板块（使用useCallback避免依赖问题）
  const getStockBoard = useCallback((stockCode: string): string => {
    if (stockCode.startsWith('300') || stockCode.startsWith('301')) return '创业板';
    if (stockCode.startsWith('688')) return '科创板';
    if (stockCode.startsWith('920')) return '北交所';
    return '主板';
  }, []);

  // 获取所有日期
  const { data: dates = [], isLoading: datesLoading } = trpc.limitUp.getDates.useQuery();

  // 获取所有涨停记录（用于按日期分组）
  const { data: allRecords = [], isLoading: recordsLoading } = trpc.limitUp.getAll.useQuery();

  // 搜索股票
  const { data: searchResults = [], isLoading: searchLoading } = trpc.limitUp.search.useQuery(
    { query: searchQuery },
    { enabled: searchQuery.length > 0 }
  );

  // 按日期分组记录
  const recordsByDate = useMemo(() => {
    const map = new Map<string, typeof allRecords>();
    allRecords.forEach(record => {
      const date = record.limitUpDate;
      if (!map.has(date)) {
        map.set(date, []);
      }
      map.get(date)!.push(record);
    });
    return map;
  }, [allRecords]);

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

  // 获取当前选中日期的题材统计
  const { data: currentDateStats = [] } = trpc.limitUp.getSectorStats.useQuery(
    { date: selectedDateStr! },
    { enabled: !!selectedDateStr }
  );

  // 当前选中日期的涨停记录（按题材、板数、时间排序并支持筛选）
  const sortedRecords = useMemo(() => {
    if (!selectedDateStr) return [];
    let records = recordsByDate.get(selectedDateStr) || [];
    
    // 按题材筛选
    if (selectedSector) {
      records = records.filter(r => r.sector === selectedSector);
    }
    
    // 按关注状态筛选（将在组件中处理）
    
    // 按板块筛选
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
  }, [selectedDateStr, recordsByDate, currentDateStats, selectedSector, selectedBoard]);

  // 自动选择最新日期
  useMemo(() => {
    if (dates.length > 0 && !selectedDate) {
      const latestDateStr = dates[0];
      const date = dateStringToDate.get(latestDateStr);
      if (date) {
        setSelectedDate(date);
      }
    }
  }, [dates, selectedDate, dateStringToDate]);

  const isLoading = datesLoading || recordsLoading;

  // 日历上有涨停数据的日期
  const datesWithData = useMemo(() => {
    return Array.from(dateStringToDate.values());
  }, [dateStringToDate]);

  // 自定义日历日期渲染，显示涨停数
  const modifiers = useMemo(() => {
    return {
      hasData: datesWithData,
    };
  }, [datesWithData]);

  const modifiersClassNames = {
    hasData: "relative",
  };

  // 为每个有数据的日期创建映射，存储涨停数
  const dateCountMap = useMemo(() => {
    const map = new Map<string, number>();
    dates.forEach(dateStr => {
      const records = recordsByDate.get(dateStr);
      if (records) {
        map.set(dateStr, records.length);
      }
    });
    return map;
  }, [dates, recordsByDate]);

  // 自定义DayButton组件，显示涨停数
  const CustomDayButton = useCallback(
    (props: any) => {
      // 确保传递所有必要的props
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
            relative flex flex-col items-center justify-center w-full aspect-square rounded-md transition-all duration-200 p-0.5 text-xs font-medium gap-0.5
            ${hasData 
              ? isSelected
                ? 'bg-gradient-to-b from-orange-400 to-orange-500 text-white shadow-lg border border-orange-300 hover:shadow-xl'
                : 'bg-gradient-to-b from-orange-50 to-orange-100 hover:from-orange-100 hover:to-orange-150 text-orange-600 border border-orange-200 shadow-sm hover:shadow-md'
              : isSelected
                ? 'bg-gradient-to-b from-slate-200 to-slate-300 text-slate-700 border border-slate-300 shadow-md'
                : isToday
                  ? 'bg-gradient-to-b from-blue-50 to-blue-100 text-blue-600 border border-blue-200 shadow-sm hover:shadow-md'
                  : 'hover:bg-slate-50 text-slate-500 border border-transparent hover:border-slate-200 hover:shadow-sm'
            }
          `}
        >
          <span className={`font-bold leading-none text-sm ${
            hasData && isSelected ? 'text-white' : hasData ? 'text-orange-700' : ''
          }`}>
            {day?.date.getDate()}
          </span>
          {hasData && (
            <span className={`text-xs font-bold leading-none ${
              isSelected ? 'text-orange-100' : 'text-orange-600'
            }`}>
              {count}
            </span>
          )}
        </button>
      );
    },
    [dateCountMap]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 shadow-sm">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
              涨停复盘助手
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/market">
              <Button variant="ghost" size="sm" className="gap-2 hover:bg-blue-50">
                <BarChart3 className="h-4 w-4" />
                大盘分析
              </Button>
            </Link>
            {isAuthenticated ? (
              <>
                <Link href="/market-data-input">
                  <Button variant="ghost" size="sm" className="gap-2 hover:bg-green-50">
                    <Database className="h-4 w-4" />
                    录入数据
                  </Button>
                </Link>
              </>
            ) : null}
            {isAuthenticated ? (
              <>
                <Link href="/upload">
                  <Button size="sm" className="gap-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 shadow-md">
                    <Upload className="h-4 w-4" />
                    上传图片
                  </Button>
                </Link>
                <span className="text-sm text-muted-foreground">
                  {user?.name || '用户'}
                </span>
              </>
            ) : (
              <Button size="sm" asChild className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700">
                <a href={getLoginUrl()}>登录</a>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container py-2 max-w-[1600px]">
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
                              {record.limitUpTime}
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
                      </div>
                    </CardContent>
                  </Card>

                  {/* 涨停股票列表 */}
                  <Card className="shadow-xl border-slate-200 bg-white/80 backdrop-blur">
                    <CardHeader className="bg-gradient-to-r from-orange-50 to-red-50 py-1 px-3">
                      <CardTitle className="flex items-center gap-2 text-slate-700 text-base">
                        <Flame className="h-4 w-4 text-orange-600" />
                        涨停股票 {sortedRecords.length} 只
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-2 px-3 pb-2">
                      <ScrollArea className="h-[700px] pr-4">
                        <WatchFilteredStockList 
                          records={sortedRecords} 
                          watchFilter={watchFilter}
                        />
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// 关注筛选股票列表组件
function WatchFilteredStockList({ 
  records, 
  watchFilter 
}: { 
  records: any[]; 
  watchFilter: "all" | "normal" | "important";
}) {
  const [watchStatusMap, setWatchStatusMap] = useState<Map<string, "none" | "normal" | "important">>(new Map());
  
  // 获取股票板块（使用useCallback避免依赖问题）
  const getStockBoard = useCallback((stockCode: string): string => {
    if (stockCode.startsWith('300') || stockCode.startsWith('301')) return '创业板';
    if (stockCode.startsWith('688')) return '科创板';
    if (stockCode.startsWith('920')) return '北交所';
    return '主板';
  }, []);
  
  // 初始化所有股票为none状态
  useEffect(() => {
    const newMap = new Map<string, "none" | "normal" | "important">();
    records.forEach(record => {
      newMap.set(record.stockCode, "none");
    });
    setWatchStatusMap(newMap);
  }, [records]);
  
  // 当WatchButton组件加载完成后，会通过onStatusChange回调更新真实状态
  
  // 筛选后的记录
  const filteredRecords = records.filter((record) => {
    if (watchFilter === "all") return true;
    const status = watchStatusMap.get(record.stockCode) || "none";
    return status === watchFilter;
  });
  
  // 更新单个股票的关注状态
  const updateWatchStatus = useCallback((stockCode: string, status: "none" | "normal" | "important") => {
    setWatchStatusMap(prev => {
      const newMap = new Map(prev);
      newMap.set(stockCode, status);
      return newMap;
    });
  }, []);

  return (
    <div className="grid gap-2">
      {filteredRecords.map((record) => (
                            <div
                              key={record.id}
                              className="group p-2 rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 hover:shadow-lg hover:border-orange-200 transition-all"
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
                                    <span className="font-semibold text-slate-700">{record.limitUpTime}</span>
                                    <Badge variant="outline" className="gap-1 border-orange-300 text-orange-700 font-semibold">
                                      <Tag className="h-3 w-3" />
                                      {record.sector}
                                    </Badge>
                                  </div>
                                  <WatchButton 
                                    stockCode={record.stockCode} 
                                    stockName={record.stockName}
                                    onStatusChange={updateWatchStatus}
                                  />
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
  onStatusChange
}: { 
  stockCode: string; 
  stockName: string;
  onStatusChange?: (stockCode: string, status: "none" | "normal" | "important") => void;
}) {
  const utils = trpc.useUtils();
  const { data: watchStatus } = trpc.limitUp.getWatchStatus.useQuery({ stockCode });
  const updateWatch = trpc.limitUp.updateWatchStatus.useMutation({
    onSuccess: (_, variables) => {
      utils.limitUp.getWatchStatus.invalidate({ stockCode });
      // 通知父组件状态变化
      if (onStatusChange) {
        onStatusChange(stockCode, variables.watchStatus);
      }
    },
  });
  
  // 当关注状态加载完成后，通知父组件
  useEffect(() => {
    if (watchStatus && onStatusChange) {
      onStatusChange(stockCode, watchStatus);
    }
  }, [watchStatus, stockCode, onStatusChange]);

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
