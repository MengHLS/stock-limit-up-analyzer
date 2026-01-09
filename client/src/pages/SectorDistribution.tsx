import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from "recharts";
import { Flame } from "lucide-react";

export default function SectorDistribution() {
  const { data: sectorData, isLoading } = trpc.sector.getHeatmapData.useQuery({
    days: 30,
  });

  // 准备气泡图数据 - 按热度排序
  const bubbleData = useMemo(() => {
    if (!sectorData) return [];
    
    return sectorData.map((sector, index) => ({
      name: sector.sector,
      x: index,
      y: sector.totalCount,
      size: Math.max(sector.totalCount * 3, 50),
      count: sector.totalCount,
    }));
  }, [sectorData]);

  // 准备热力图数据 - 按日期展示
  const heatmapData = useMemo(() => {
    if (!sectorData || sectorData.length === 0) return [];

    // 获取所有日期
    const allDates = new Set<string>();
    sectorData.forEach(sector => {
      sector.dailyData.forEach(d => allDates.add(d.date));
    });

    const sortedDates = Array.from(allDates).sort();

    // 构建热力图数据
    return sectorData.slice(0, 10).map(sector => {
      const row: any = { sector: sector.sector };
      sortedDates.forEach(date => {
        const dailyCount = sector.dailyData.find(d => d.date === date)?.count || 0;
        row[date] = dailyCount;
      });
      return row;
    });
  }, [sectorData]);

  // 获取热度颜色
  const getHeatColor = (value: number, max: number) => {
    const ratio = value / max;
    if (ratio === 0) return "bg-gray-100";
    if (ratio < 0.2) return "bg-orange-100";
    if (ratio < 0.4) return "bg-orange-200";
    if (ratio < 0.6) return "bg-orange-400";
    if (ratio < 0.8) return "bg-orange-500";
    return "bg-orange-600";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!sectorData || sectorData.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg text-gray-500">暂无数据</div>
      </div>
    );
  }

  const maxCount = Math.max(...sectorData.map(s => s.totalCount), 1);
  const allDates = new Set<string>();
  sectorData.forEach(sector => {
    sector.dailyData.forEach(d => allDates.add(d.date));
  });
  const sortedDates = Array.from(allDates).sort();
  const maxDailyCount = Math.max(
    ...sectorData.flatMap(s => s.dailyData.map(d => d.count)),
    1
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 页面标题 */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Flame className="w-8 h-8 text-orange-500" />
            题材热度分析
          </h1>
          <p className="text-slate-600">近30日题材涨停热度统计与趋势分析</p>
        </div>

        {/* 标签页切换 */}
        <Tabs defaultValue="bubble" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="bubble">气泡热度图</TabsTrigger>
            <TabsTrigger value="heatmap">热力日历</TabsTrigger>
            <TabsTrigger value="ranking">热度排行</TabsTrigger>
          </TabsList>

          {/* 气泡热度图 */}
          <TabsContent value="bubble">
            <Card className="p-6">
              <h2 className="text-xl font-bold mb-4">题材热度气泡图</h2>
              <p className="text-sm text-gray-600 mb-4">气泡大小表示涨停数量，越大热度越高</p>
              <ResponsiveContainer width="100%" height={400}>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="x" 
                    name="排序"
                    hide
                  />
                  <YAxis 
                    type="number" 
                    dataKey="y" 
                    name="涨停数"
                  />
                  <Tooltip 
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white p-3 border border-gray-200 rounded shadow">
                            <p className="font-bold">{data.name}</p>
                            <p className="text-orange-600">涨停数: {data.count}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Scatter 
                    name="题材热度" 
                    data={bubbleData} 
                    fill="#f97316"
                    fillOpacity={0.7}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </Card>
          </TabsContent>

          {/* 热力日历 */}
          <TabsContent value="heatmap">
            <Card className="p-6">
              <h2 className="text-xl font-bold mb-4">题材热力日历</h2>
              <p className="text-sm text-gray-600 mb-4">颜色深度表示该日期该题材的涨停数量</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="border border-gray-200 p-2 bg-gray-50 font-bold text-left w-24">题材</th>
                      {sortedDates.map(date => (
                        <th key={date} className="border border-gray-200 p-2 bg-gray-50 text-xs font-semibold text-center w-12">
                          {date.split('-')[2]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sectorData.slice(0, 15).map(sector => (
                      <tr key={sector.sector}>
                        <td className="border border-gray-200 p-2 font-semibold text-sm bg-gray-50">
                          {sector.sector}
                        </td>
                        {sortedDates.map(date => {
                          const count = sector.dailyData.find(d => d.date === date)?.count || 0;
                          return (
                            <td 
                              key={`${sector.sector}-${date}`}
                              className={`border border-gray-200 p-2 text-center text-xs font-semibold ${getHeatColor(count, maxDailyCount)}`}
                              title={`${sector.sector} - ${date}: ${count}只`}
                            >
                              {count > 0 ? count : '-'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* 热度排行 */}
          <TabsContent value="ranking">
            <Card className="p-6">
              <h2 className="text-xl font-bold mb-4">题材热度排行榜</h2>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart 
                  data={sectorData.slice(0, 15)}
                  margin={{ top: 20, right: 20, bottom: 100, left: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="sector" 
                    angle={-45}
                    textAnchor="end"
                    height={120}
                  />
                  <YAxis label={{ value: '涨停数', angle: -90, position: 'insideLeft' }} />
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white p-3 border border-gray-200 rounded shadow">
                            <p className="font-bold">{data.sector}</p>
                            <p className="text-orange-600">总涨停数: {data.totalCount}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar 
                    dataKey="totalCount" 
                    fill="#f97316"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 统计信息 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <Card className="p-4 bg-gradient-to-br from-orange-50 to-orange-100">
            <p className="text-sm text-gray-600">总题材数</p>
            <p className="text-3xl font-bold text-orange-600">{sectorData.length}</p>
          </Card>
          <Card className="p-4 bg-gradient-to-br from-blue-50 to-blue-100">
            <p className="text-sm text-gray-600">最热题材</p>
            <p className="text-2xl font-bold text-blue-600">{sectorData[0]?.sector}</p>
            <p className="text-sm text-blue-500">{sectorData[0]?.totalCount}只涨停</p>
          </Card>
          <Card className="p-4 bg-gradient-to-br from-indigo-50 to-indigo-100">
            <p className="text-sm text-gray-600">统计周期</p>
            <p className="text-2xl font-bold text-indigo-600">30天</p>
            <p className="text-sm text-indigo-500">{sortedDates.length}个交易日</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
