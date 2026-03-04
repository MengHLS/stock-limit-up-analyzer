import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, TrendingUp, Calendar, BarChart3, PieChart, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function MarketPage() {
  const { data: dailyStats, isLoading: statsLoading } = trpc.limitUp.getDailyStats.useQuery();
  const { data: sectorDistribution, isLoading: sectorLoading } = trpc.limitUp.getSectorDistribution.useQuery();
  const { data: limitUpWithMarketData, isLoading: marketDataLoading } = trpc.market.getLimitUpWithMarketData.useQuery({ days: 30 });

  const isLoading = statsLoading || sectorLoading || marketDataLoading;

  // 计算统计数据
  const totalDays = dailyStats?.length || 0;
  const totalLimitUps = dailyStats?.reduce((sum, item) => sum + item.count, 0) || 0;
  const avgLimitUps = totalDays > 0 ? Math.round(totalLimitUps / totalDays) : 0;
  const maxLimitUps = dailyStats?.reduce((max, item) => Math.max(max, item.count), 0) || 0;

  // 获取最热门的题材（跨所有日期）
  const allSectors = new Map<string, number>();
  sectorDistribution?.forEach(day => {
    day.sectors.forEach(s => {
      allSectors.set(s.sector, (allSectors.get(s.sector) || 0) + s.count);
    });
  });
  const topSectors = Array.from(allSectors.entries())
    .filter(([sector]) => sector !== '其他')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // 准备图表数据
  const chartData = dailyStats?.map(item => ({
    date: item.date.substring(5), // 只显示 MM-DD
    涨停数: item.count,
  })) || [];

  // 准备题材分布数据（最近7天）
  const recentSectorData = sectorDistribution?.slice(0, 7).reverse().map(day => {
    const data: any = { date: day.date.substring(5) };
    day.sectors.slice(0, 5).forEach(s => {
      data[s.sector] = s.count;
    });
    return data;
  }) || [];

  // 获取所有题材名称（用于图例）
  const allSectorNames = new Set<string>();
  recentSectorData.forEach(day => {
    Object.keys(day).forEach(key => {
      if (key !== 'date') allSectorNames.add(key);
    });
  });

  const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Button>
          </Link>
          <div className="ml-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            <h1 className="text-lg font-semibold">大盘分析</h1>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-7xl">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* 统计卡片 */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">总天数</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalDays}</div>
                  <p className="text-xs text-muted-foreground">已记录的交易日</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">总涨停数</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalLimitUps}</div>
                  <p className="text-xs text-muted-foreground">累计涨停股票</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">日均涨停</CardTitle>
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{avgLimitUps}</div>
                  <p className="text-xs text-muted-foreground">平均每日涨停数</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">最高涨停</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{maxLimitUps}</div>
                  <p className="text-xs text-muted-foreground">单日最高涨停数</p>
                </CardContent>
              </Card>
            </div>

            {/* 图表区域 */}
            <Tabs defaultValue="market" className="space-y-4">
              <TabsList>
                <TabsTrigger value="market">大盘数据</TabsTrigger>
                <TabsTrigger value="heatmap">题材热力</TabsTrigger>
                <TabsTrigger value="boards">连板梯队</TabsTrigger>
              </TabsList>

              {/* 大盘数据 - 三轴融合图表 */}
              <TabsContent value="market" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>大盘综合分析</CardTitle>
                    <CardDescription>涨停数、成交额、两融余额展示</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={500}>
                      <LineChart data={limitUpWithMarketData?.map(item => ({
                        date: item.date.substring(5),
                        涨停数: item.limitUpCount,
                        成交额: item.turnover ? parseFloat(item.turnover) : 0,
                        两融余额: item.marginBalance ? parseFloat(item.marginBalance) : 0,
                      })) || []}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                        <YAxis yAxisId="left" label={{ value: '涨停数', angle: -90, position: 'insideLeft' }} />
                        <YAxis yAxisId="right" orientation="right" domain={[7500, 'auto']} label={{ value: '成交额/两融余额(亿)', angle: 90, position: 'insideRight' }} />
                        <Tooltip />
                        <Legend />
                        <Line 
                          yAxisId="left"
                          type="monotone" 
                          dataKey="涨停数" 
                          stroke="#3b82f6" 
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                        <Line 
                          yAxisId="right"
                          type="monotone" 
                          dataKey="成交额" 
                          stroke="#10b981" 
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                        <Line 
                          yAxisId="right"
                          type="monotone" 
                          dataKey="两融余额" 
                          stroke="#f59e0b" 
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 题材热力日历 */}
              <TabsContent value="heatmap" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>题材热力日历</CardTitle>
                    <CardDescription>颜色深浅表示该日期该题材的涨停数量</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr>
                            <th className="border border-border p-2 bg-muted text-left font-medium min-w-[80px]">题材</th>
                            {sectorDistribution?.slice(0, 20).map((day) => (
                              <th key={day.date} className="border border-border p-2 bg-muted text-center font-medium min-w-[50px] text-xs">
                                {day.date.split('-').slice(1).join('-')}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const allSectors = new Set();
                            sectorDistribution?.forEach(day => {
                              day.sectors.forEach(s => allSectors.add(s.sector));
                            });
                            
                            const maxValue = Math.max(...(sectorDistribution?.flatMap(day => day.sectors.map(s => s.count)) || [1]));
                            
                            return Array.from(allSectors).slice(0, 15).map((sector: any) => (
                              <tr key={sector as string}>
                                <td className="border border-border p-2 font-medium text-left bg-muted sticky left-0 z-10 min-w-[80px] text-xs">
                                  {sector as string}
                                </td>
                                {sectorDistribution?.slice(0, 20).map((day) => {
                                  const sectorData = day.sectors.find(s => s.sector === sector);
                                  const count = sectorData?.count || 0;
                                  const intensity = count === 0 ? 0 : Math.min(100, (count / maxValue) * 100);
                                  const opacity = intensity === 0 ? 0 : 0.2 + (intensity / 100) * 0.8;
                                  
                                  return (
                                    <td
                                      key={`${sector}-${day.date}`}
                                      className="border border-border p-2 text-center text-xs"
                                      style={{
                                        backgroundColor: count === 0 ? 'transparent' : `rgba(59, 130, 246, ${opacity})`,
                                        color: intensity > 50 ? 'white' : 'inherit'
                                      }}
                                    >
                                      {count > 0 ? count : '-'}
                                    </td>
                                  );
                                })}
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 连板梯队 */}
              <TabsContent value="boards" className="space-y-4">
                <ConnectionBoardsTab />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
    </div>
  );
}

// 连板梯队组件
function ConnectionBoardsTab() {
  const { data: availableDates } = trpc.limitUp.getDates.useQuery();
  
  const [selectedDate, setSelectedDate] = useState(() => {
    // 默认选择最近的日期
    return '';
  });

  // 当获取到可用日期后，设置默认日期
  useEffect(() => {
    if (availableDates && availableDates.length > 0 && !selectedDate) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  const { data: boardStats, isLoading } = trpc.limitUp.getConnectionBoardStats.useQuery(
    { date: selectedDate },
    { enabled: !!selectedDate }
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!boardStats) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          暂无数据
        </CardContent>
      </Card>
    );
  }

  const { distribution, trend, stocks, metrics } = boardStats;

  // 情绪评级
  const getEmotionLevel = (score: number) => {
    if (score >= 86) return { label: '亢奋', color: 'text-red-600', bg: 'bg-red-100' };
    if (score >= 71) return { label: '活跃', color: 'text-orange-600', bg: 'bg-orange-100' };
    if (score >= 51) return { label: '正常', color: 'text-blue-600', bg: 'bg-blue-100' };
    if (score >= 31) return { label: '低迷', color: 'text-gray-600', bg: 'bg-gray-100' };
    return { label: '冰点', color: 'text-gray-400', bg: 'bg-gray-50' };
  };

  const emotionLevel = getEmotionLevel(metrics.emotionScore);

  return (
    <div className="space-y-4">
      {/* 日期选择器 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">选择日期：</label>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border border-border rounded-md text-sm"
            >
              {availableDates?.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* 情绪指标卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">总涨停数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalLimitUp}</div>
            <p className="text-xs text-muted-foreground">当日涨停股票总数</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">连板数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.connectionBoards}</div>
            <p className="text-xs text-muted-foreground">2板及以上的股票</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">最高板</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.maxBoards}板</div>
            <p className="text-xs text-muted-foreground">当日最高连板数</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">情绪评分</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold">{metrics.emotionScore}</div>
              <Badge className={`${emotionLevel.bg} ${emotionLevel.color}`}>
                {emotionLevel.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">市场情绪强度</p>
          </CardContent>
        </Card>
      </div>

      {/* 连板梯队分布图 */}
      <Card>
        <CardHeader>
          <CardTitle>连板梯队分布</CardTitle>
          <CardDescription>各板数股票数量分布</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={distribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 连板趋势图 */}
      <Card>
        <CardHeader>
          <CardTitle>连板趋势</CardTitle>
          <CardDescription>最近7天各板数股票数量变化</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="board1" name="首板" stroke="#93c5fd" strokeWidth={2} />
              <Line type="monotone" dataKey="board2" name="2板" stroke="#3b82f6" strokeWidth={2} />
              <Line type="monotone" dataKey="board3" name="3板" stroke="#f59e0b" strokeWidth={2} />
              <Line type="monotone" dataKey="board4Plus" name="4板+" stroke="#ef4444" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 连板股票列表 */}
      <Card>
        <CardHeader>
          <CardTitle>连板股票列表</CardTitle>
          <CardDescription>按板数降序排列</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">板数</th>
                  <th className="text-left p-2">股票代码</th>
                  <th className="text-left p-2">股票名称</th>
                  <th className="text-left p-2">题材</th>
                  <th className="text-left p-2">涨停时间</th>
                  <th className="text-left p-2">连板天数</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((stock, index) => (
                  <tr key={index} className="border-b hover:bg-muted/50">
                    <td className="p-2">
                      <Badge 
                        className={
                          stock.boards >= 7 ? 'bg-red-100 text-red-700' :
                          stock.boards >= 4 ? 'bg-orange-100 text-orange-700' :
                          stock.boards >= 2 ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-700'
                        }
                      >
                        {stock.boards}板
                      </Badge>
                    </td>
                    <td className="p-2 font-mono text-xs">{stock.stockCode}</td>
                    <td className="p-2 font-medium">{stock.stockName}</td>
                    <td className="p-2">
                      <Badge variant="outline">{stock.sector}</Badge>
                    </td>
                    <td className="p-2 text-muted-foreground">{stock.limitUpTime}</td>
                    <td className="p-2 text-muted-foreground text-xs">{stock.connectionDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
