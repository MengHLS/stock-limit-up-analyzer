import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, TrendingUp, Loader2 } from "lucide-react";
import { Link } from "wouter";

export default function SectorDistributionPage() {
  const { data: sectorHeatmapData, isLoading } = trpc.sector.getHeatmapData.useQuery({ days: 30 });

  // 计算统计数据
  const totalSectors = sectorHeatmapData?.length || 0;
  const totalLimitUps = sectorHeatmapData?.reduce((sum: number, item: any) => sum + item.totalCount, 0) || 0;
  const topSector = sectorHeatmapData && sectorHeatmapData.length > 0 ? sectorHeatmapData[0] : null;

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
            <h1 className="text-lg font-semibold">题材热度分析</h1>
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
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">题材总数</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalSectors}</div>
                  <p className="text-xs text-muted-foreground">近30天出现的题材</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">涨停总数</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalLimitUps}</div>
                  <p className="text-xs text-muted-foreground">所有题材涨停数</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">最热题材</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{topSector?.totalCount || 0}</div>
                  <p className="text-xs text-muted-foreground">{topSector?.sector || '无'}</p>
                </CardContent>
              </Card>
            </div>

            {/* 题材热力日历 */}
            <Card>
              <CardHeader>
                <CardTitle>题材热力日历</CardTitle>
                <CardDescription>展示各题材的涨停热度（颜色越深热度越高）</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 max-h-[800px] overflow-y-auto">
                  {sectorHeatmapData?.map((item: any) => {
                    const maxCount = Math.max(...(sectorHeatmapData?.map((d: any) => d.totalCount) || [1]), 1);
                    const intensity = Math.min(100, (item.totalCount / maxCount) * 100);
                    const opacity = 0.3 + (intensity / 100) * 0.7;
                    
                    return (
                      <div key={item.sector} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-sm">{item.sector}</div>
                          <Badge variant="secondary">{item.totalCount} 只</Badge>
                        </div>
                        <div className="h-8 bg-muted rounded-lg overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 transition-all flex items-center justify-end pr-3"
                            style={{ width: `${intensity}%` }}
                          >
                            {intensity > 15 && (
                              <span className="text-white text-xs font-medium">{item.totalCount}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
