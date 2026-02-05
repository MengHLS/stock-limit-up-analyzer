import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { 
  ArrowLeft, 
  Bell, 
  TrendingUp, 
  TrendingDown, 
  Flame, 
  Snowflake, 
  Loader2,
  RefreshCw,
  Check,
  CheckCheck
} from "lucide-react";

// 预警类型配置
const alertTypeConfig = {
  warming: {
    icon: TrendingUp,
    bgColor: "bg-orange-100",
    textColor: "text-orange-700",
    borderColor: "border-orange-200",
    label: "转暖信号",
    description: "市场情绪从冰点/偏冷转向中性/偏暖",
  },
  cooling: {
    icon: TrendingDown,
    bgColor: "bg-blue-100",
    textColor: "text-blue-700",
    borderColor: "border-blue-200",
    label: "转冷信号",
    description: "市场情绪从亢奋/偏暖转向中性/偏冷",
  },
  extreme_hot: {
    icon: Flame,
    bgColor: "bg-red-100",
    textColor: "text-red-700",
    borderColor: "border-red-200",
    label: "极度亢奋",
    description: "市场进入极度亢奋区间，需警惕回调风险",
  },
  extreme_cold: {
    icon: Snowflake,
    bgColor: "bg-cyan-100",
    textColor: "text-cyan-700",
    borderColor: "border-cyan-200",
    label: "极度冰点",
    description: "市场进入极度冰点区间，可关注反弹机会",
  },
};

export default function SentimentAlertsPage() {
  const { user, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  // 获取预警数据
  const { data: alerts = [], isLoading: alertsLoading, refetch } = trpc.sentiment.getAlerts.useQuery(
    { limit: 100 }
  );

  // 获取未读数量
  const { data: unreadCount = 0 } = trpc.sentiment.getUnreadCount.useQuery();

  // 批量检测预警
  const batchCheckMutation = trpc.sentiment.batchCheck.useMutation({
    onSuccess: (data) => {
      utils.sentiment.getAlerts.invalidate();
      utils.sentiment.getUnreadCount.invalidate();
      alert(`检测完成，生成了 ${data.length} 条新预警`);
    },
    onError: (error) => {
      alert(`检测失败: ${error.message}`);
    },
  });

  // 标记单个为已读
  const markAsReadMutation = trpc.sentiment.markAsRead.useMutation({
    onSuccess: () => {
      utils.sentiment.getAlerts.invalidate();
      utils.sentiment.getUnreadCount.invalidate();
    },
  });

  // 标记全部为已读
  const markAllAsReadMutation = trpc.sentiment.markAllAsRead.useMutation({
    onSuccess: () => {
      utils.sentiment.getAlerts.invalidate();
      utils.sentiment.getUnreadCount.invalidate();
    },
  });

  const handleBatchCheck = () => {
    if (confirm("是否检测最近30天的情绪拐点并生成预警？")) {
      batchCheckMutation.mutate({ days: 30 });
    }
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  // 格式化评分变化
  const formatScoreChange = (change: number | null) => {
    if (change === null) return "";
    const sign = change > 0 ? "+" : "";
    return `${sign}${change}`;
  };

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
            <Bell className="h-5 w-5" />
            <h1 className="text-lg font-semibold">情绪预警管理</h1>
            {unreadCount > 0 && (
              <Badge variant="destructive">{unreadCount} 条未读</Badge>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {isAuthenticated && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBatchCheck}
                  disabled={batchCheckMutation.isPending}
                >
                  {batchCheckMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  检测历史拐点
                </Button>
                {unreadCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => markAllAsReadMutation.mutate()}
                    disabled={markAllAsReadMutation.isPending}
                  >
                    <CheckCheck className="h-4 w-4 mr-2" />
                    全部已读
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-4xl">
        {/* 预警规则说明 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">预警规则说明</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(alertTypeConfig).map(([type, config]) => {
                const Icon = config.icon;
                return (
                  <div
                    key={type}
                    className={`p-3 rounded-lg border ${config.bgColor} ${config.borderColor}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={`h-4 w-4 ${config.textColor}`} />
                      <span className={`font-medium text-sm ${config.textColor}`}>
                        {config.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {config.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* 预警列表 */}
        <Card>
          <CardHeader>
            <CardTitle>预警记录</CardTitle>
            <CardDescription>
              共 {alerts.length} 条预警记录，{unreadCount} 条未读
            </CardDescription>
          </CardHeader>
          <CardContent>
            {alertsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : alerts.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>暂无预警记录</p>
                <p className="text-sm mt-2">
                  点击"检测历史拐点"按钮可以检测最近30天的情绪拐点
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {alerts.map((alert: any) => {
                  const config = alertTypeConfig[alert.alertType as keyof typeof alertTypeConfig];
                  const Icon = config.icon;
                  const isUnread = alert.isRead === "0";

                  return (
                    <div
                      key={alert.id}
                      className={`p-4 rounded-lg border transition-colors ${
                        isUnread ? "bg-blue-50/50 border-blue-200" : "bg-background"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-full ${config.bgColor}`}>
                          <Icon className={`h-5 w-5 ${config.textColor}`} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge
                              variant="outline"
                              className={`${config.bgColor} ${config.textColor} ${config.borderColor}`}
                            >
                              {config.label}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {formatDate(alert.alertDate)}
                            </span>
                            {isUnread && (
                              <Badge variant="default" className="bg-blue-500">
                                未读
                              </Badge>
                            )}
                          </div>
                          <h3 className="font-semibold mb-2">{alert.title}</h3>
                          {alert.description && (
                            <p className="text-sm text-muted-foreground mb-3">
                              {alert.description}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-4 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">情绪评分:</span>
                              <span className="font-medium">{alert.currentScore}</span>
                              {alert.scoreChange !== null && (
                                <span
                                  className={
                                    alert.scoreChange > 0
                                      ? "text-red-500"
                                      : "text-green-500"
                                  }
                                >
                                  ({formatScoreChange(alert.scoreChange)})
                                </span>
                              )}
                            </div>
                            {alert.totalLimitUp !== null && (
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">涨停数:</span>
                                <span className="font-medium">{alert.totalLimitUp}</span>
                              </div>
                            )}
                            {alert.connectionBoards !== null && (
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">连板数:</span>
                                <span className="font-medium">{alert.connectionBoards}</span>
                              </div>
                            )}
                            {alert.maxBoards !== null && (
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">最高板:</span>
                                <span className="font-medium">{alert.maxBoards}板</span>
                              </div>
                            )}
                          </div>
                        </div>
                        {isUnread && isAuthenticated && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markAsReadMutation.mutate({ id: alert.id })}
                            disabled={markAsReadMutation.isPending}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            已读
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
