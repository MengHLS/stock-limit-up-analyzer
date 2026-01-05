import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ChevronRight,
  Clock,
  Hash,
  Tag
} from "lucide-react";
import { useState, useMemo } from "react";
import { Link } from "wouter";

export default function Home() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  // 获取所有日期列表
  const { data: dates = [], isLoading: datesLoading } = trpc.limitUp.getDates.useQuery();
  
  // 获取所有涨停记录
  const { data: allRecords = [], isLoading: recordsLoading } = trpc.limitUp.getAll.useQuery();
  
  // 搜索结果
  const { data: searchResults = [], isLoading: searchLoading } = trpc.limitUp.search.useQuery(
    { query: searchQuery },
    { enabled: searchQuery.length > 0 }
  );

  // 按日期分组的记录
  const recordsByDate = useMemo(() => {
    const grouped = new Map<string, typeof allRecords>();
    for (const record of allRecords) {
      const dateStr = String(record.limitUpDate);
      if (!grouped.has(dateStr)) {
        grouped.set(dateStr, []);
      }
      grouped.get(dateStr)!.push(record);
    }
    return grouped;
  }, [allRecords]);

  // 将日期字符串转换为Date对象的Map
  const dateStringToDate = useMemo(() => {
    const map = new Map<string, Date>();
    dates.forEach(dateStr => {
      const [year, month, day] = dateStr.split('-').map(Number);
      map.set(dateStr, new Date(year, month - 1, day));
    });
    return map;
  }, [dates]);

  // 反向映射：Date对象转日期字符串
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
    { date: selectedDateStr || '' },
    { enabled: !!selectedDateStr }
  );

  // 对当前日期的涨停记录按题材排序
  const sortedRecords = useMemo(() => {
    if (!selectedDateStr) return [];
    const records = recordsByDate.get(selectedDateStr) || [];
    
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
      const sectorA = a.sector || '其他';
      const sectorB = b.sector || '其他';
      const orderA = sectorOrder.get(sectorA) ?? 999;
      const orderB = sectorOrder.get(sectorB) ?? 999;
      // 1. 先按题材排序
      if (orderA !== orderB) return orderA - orderB;
      // 2. 同题材内按板数降序
      const boardA = parseBoardCount(a.boardCount);
      const boardB = parseBoardCount(b.boardCount);
      if (boardA !== boardB) return boardB - boardA;
      // 3. 同板数内按涨停时间排序
      return (a.limitUpTime || '').localeCompare(b.limitUpTime || '');
    });
  }, [selectedDateStr, recordsByDate, currentDateStats]);

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
    hasData: "bg-primary/10 font-semibold",
  };

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-7 w-7 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight">涨停复盘助手</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/market">
              <Button variant="outline" size="sm" className="gap-2">
                <BarChart3 className="h-4 w-4" />
                大盘分析
              </Button>
            </Link>
            {isAuthenticated ? (
              <>
                <Link href="/upload">
                  <Button variant="default" size="sm" className="gap-2">
                    <Upload className="h-4 w-4" />
                    上传图片
                  </Button>
                </Link>
                <span className="text-sm text-muted-foreground">
                  {user?.name || '用户'}
                </span>
              </>
            ) : (
              <Button variant="default" size="sm" asChild>
                <a href={getLoginUrl()}>登录</a>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-7xl">
        {/* 搜索栏 */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索股票代码或名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* 搜索结果 */}
        {searchQuery && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                搜索结果
              </CardTitle>
            </CardHeader>
            <CardContent>
              {searchLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : searchResults.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  未找到相关股票
                </p>
              ) : (
                <div className="space-y-3">
                  {searchResults.map((record) => (
                    <div
                      key={record.id}
                      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{record.stockName}</span>
                            <span className="text-sm text-muted-foreground">{record.stockCode}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {record.limitUpDate}
                            </span>
                            {record.limitUpTime && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {record.limitUpTime}
                              </span>
                            )}
                            {record.boardCount && (
                              <Badge variant="outline" className="text-xs">
                                {record.boardCount}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        {record.sector && (
                          <Badge className="mb-1">{record.sector}</Badge>
                        )}
                        {record.keywords && (
                          <p className="text-xs text-muted-foreground max-w-xs truncate">
                            {record.keywords}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 主内容区 */}
        {!searchQuery && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* 左侧：日历 */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  选择日期
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : dates.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground text-sm">
                    暂无数据，请先上传涨停复盘图片
                  </p>
                ) : (
                  <div className="flex flex-col items-center">
                    <CalendarComponent
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      modifiers={modifiers}
                      modifiersClassNames={modifiersClassNames}
                      className="rounded-md border"
                    />
                    {selectedDateStr && (
                      <div className="mt-4 text-center w-full">
                        <p className="text-sm text-muted-foreground mb-1">已选择</p>
                        <p className="font-semibold">{selectedDateStr}</p>
                        <Badge variant="secondary" className="mt-2">
                          {recordsByDate.get(selectedDateStr)?.length || 0}只涨停
                        </Badge>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 右侧：详情展示 */}
            <div className="lg:col-span-3 space-y-6">
              {!selectedDateStr ? (
                <Card>
                  <CardContent className="py-12">
                    <p className="text-center text-muted-foreground">
                      请在左侧日历中选择日期查看涨停数据
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* 题材统计 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        {selectedDateStr} 题材统计
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {currentDateStats.length === 0 ? (
                        <p className="text-center py-4 text-muted-foreground">
                          暂无题材数据
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {currentDateStats.map((stat) => (
                            <Badge key={stat.sector} variant="secondary" className="text-sm px-3 py-1">
                              <Tag className="h-3 w-3 mr-1" />
                              {stat.sector} {stat.count}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* 涨停股票列表 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        涨停股票 {sortedRecords.length} 只
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[600px] pr-4">
                        {sortedRecords.length === 0 ? (
                          <p className="text-center py-8 text-muted-foreground">
                            暂无涨停数据
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {sortedRecords.map((record) => (
                              <div
                                key={record.id}
                                className="p-4 rounded-lg border bg-card hover:bg-accent/30 transition-colors"
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="font-semibold text-lg">{record.stockName}</span>
                                      <span className="text-sm text-muted-foreground">{record.stockCode}</span>
                                      {record.boardCount && (
                                        <Badge variant="destructive" className="text-xs">
                                          {record.boardCount}
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
                                      {record.limitUpTime && (
                                        <span className="flex items-center gap-1">
                                          <Clock className="h-3.5 w-3.5" />
                                          {record.limitUpTime}
                                        </span>
                                      )}
                                      {record.circulationValue && (
                                        <span>流通市值: {record.circulationValue}亿</span>
                                      )}
                                      {record.turnover && (
                                        <span>成交额: {record.turnover}亿</span>
                                      )}
                                    </div>
                                    {record.keywords && (
                                      <p className="text-sm text-muted-foreground">
                                        {record.keywords}
                                      </p>
                                    )}
                                  </div>
                                  <div className="ml-4">
                                    {record.sector && (
                                      <Badge className="whitespace-nowrap">{record.sector}</Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
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
