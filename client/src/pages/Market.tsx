import { Button } from "@/components/ui/button";
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
                        <YAxis yAxisId="right" orientation="right" label={{ value: '成交额/两融余额(亿)', angle: 90, position: 'insideRight' }} />
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
                    <CardDescription>展示各题材在不同日期的涨停热度（颜色越深热度越高）</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4 max-h-[800px] overflow-y-auto">
                      {sectorDistribution?.slice(0, 30).map((day) => {
                        const maxCount = Math.max(...day.sectors.map(s => s.count), 1);
                        return (
                          <div key={day.date} className="space-y-2">
                            <div className="font-medium text-sm">{day.date}</div>
                            <div className="flex flex-wrap gap-2">
                              {day.sectors.slice(0, 10).map((s) => {
                                const intensity = Math.min(100, (s.count / maxCount) * 100);
                                const opacity = 0.3 + (intensity / 100) * 0.7;
                                return (
                                  <div
                                    key={s.sector}
                                    className="px-3 py-2 rounded-lg text-sm font-medium text-white transition-all hover:shadow-md"
                                    style={{
                                      backgroundColor: `rgba(59, 130, 246, ${opacity})`,
                                      minWidth: '90px',
                                      textAlign: 'center'
                                    }}
                                    title={`${s.sector}: ${s.count}只`}
                                  >
                                    <div className="truncate">{s.sector}</div>
                                    <div className="text-xs opacity-80">{s.count}只</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
    </div>
  );
}
