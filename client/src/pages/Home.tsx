import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
      const dateStr = record.limitUpDate instanceof Date 
        ? record.limitUpDate.toISOString().split('T')[0]
        : String(record.limitUpDate);
      if (!grouped.has(dateStr)) {
        grouped.set(dateStr, []);
      }
      grouped.get(dateStr)!.push(record);
    }
    return grouped;
  }, [allRecords]);

  // 当前选中日期的题材统计
  const currentDateStats = useMemo(() => {
    if (!selectedDate) return [];
    const records = recordsByDate.get(selectedDate) || [];
    const sectorMap = new Map<string, number>();
    for (const record of records) {
      const sector = record.sector || '其他';
      sectorMap.set(sector, (sectorMap.get(sector) || 0) + 1);
    }
    return Array.from(sectorMap.entries())
      .map(([sector, count]) => ({ sector, count }))
      .sort((a, b) => b.count - a.count);
  }, [selectedDate, recordsByDate]);

  // 自动选择最新日期
  useMemo(() => {
    if (dates.length > 0 && !selectedDate) {
      setSelectedDate(dates[0]);
    }
  }, [dates, selectedDate]);

  const isLoading = datesLoading || recordsLoading;

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

      <main className="container py-8">
        {/* 搜索栏 */}
        <div className="mb-8">
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索股票代码或名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-11"
            />
          </div>
        </div>

        {/* 搜索结果 */}
        {searchQuery && (
          <Card className="mb-8">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Search className="h-5 w-5" />
                搜索结果
                {searchResults.length > 0 && (
                  <Badge variant="secondary">{searchResults.length} 条记录</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {searchLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : searchResults.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">未找到相关股票</p>
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
                              {record.limitUpDate instanceof Date 
                                ? record.limitUpDate.toLocaleDateString('zh-CN')
                                : record.limitUpDate}
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
            {/* 左侧：日期列表 */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  日期列表
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : dates.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground px-4">
                      暂无数据，请先上传涨停复盘图片
                    </p>
                  ) : (
                    <div className="space-y-1 p-2">
                      {dates.map((date) => {
                        const count = recordsByDate.get(date)?.length || 0;
                        return (
                          <button
                            key={date}
                            onClick={() => setSelectedDate(date)}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm transition-colors ${
                              selectedDate === date
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-accent'
                            }`}
                          >
                            <span>{date}</span>
                            <div className="flex items-center gap-2">
                              <Badge 
                                variant={selectedDate === date ? "secondary" : "outline"}
                                className="text-xs"
                              >
                                {count}只
                              </Badge>
                              <ChevronRight className="h-4 w-4" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* 右侧：详情展示 */}
            <div className="lg:col-span-3 space-y-6">
              {selectedDate && (
                <>
                  {/* 题材统计 */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        {selectedDate} 题材统计
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {currentDateStats.length === 0 ? (
                        <p className="text-center py-4 text-muted-foreground">暂无数据</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {currentDateStats.map(({ sector, count }) => (
                            <Badge
                              key={sector}
                              variant="secondary"
                              className="px-3 py-1.5 text-sm"
                            >
                              <Tag className="h-3.5 w-3.5 mr-1.5" />
                              {sector}
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs font-semibold">
                                {count}
                              </span>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* 涨停股票列表 */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        涨停股票
                        <Badge variant="outline">
                          {recordsByDate.get(selectedDate)?.length || 0} 只
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="px-4 py-3 text-left font-medium">股票</th>
                              <th className="px-4 py-3 text-left font-medium">涨停时间</th>
                              <th className="px-4 py-3 text-left font-medium">板数</th>
                              <th className="px-4 py-3 text-left font-medium">题材</th>
                              <th className="px-4 py-3 text-left font-medium">关键词</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {(recordsByDate.get(selectedDate) || []).map((record) => (
                              <tr key={record.id} className="hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-3">
                                  <div>
                                    <span className="font-medium">{record.stockName}</span>
                                    <span className="text-muted-foreground ml-2 text-xs">
                                      {record.stockCode}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">
                                  {record.limitUpTime || '-'}
                                </td>
                                <td className="px-4 py-3">
                                  {record.boardCount ? (
                                    <Badge variant="outline" className="text-xs">
                                      {record.boardCount}
                                    </Badge>
                                  ) : '-'}
                                </td>
                                <td className="px-4 py-3">
                                  {record.sector ? (
                                    <Badge variant="secondary" className="text-xs">
                                      {record.sector}
                                    </Badge>
                                  ) : '-'}
                                </td>
                                <td className="px-4 py-3 max-w-xs">
                                  <p className="text-xs text-muted-foreground truncate" title={record.keywords || ''}>
                                    {record.keywords || '-'}
                                  </p>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}

              {!selectedDate && !isLoading && dates.length > 0 && (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-16">
                    <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">请从左侧选择一个日期查看详情</p>
                  </CardContent>
                </Card>
              )}

              {!isLoading && dates.length === 0 && (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-16">
                    <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground mb-4">暂无涨停数据</p>
                    {isAuthenticated && (
                      <Link href="/upload">
                        <Button>
                          <Upload className="h-4 w-4 mr-2" />
                          上传涨停复盘图片
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
