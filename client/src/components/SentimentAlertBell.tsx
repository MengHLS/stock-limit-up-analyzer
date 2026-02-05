import { useState, useEffect } from "react";
import { Bell, BellRing, Check, CheckCheck, TrendingUp, TrendingDown, Flame, Snowflake, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

interface SentimentAlert {
  id: number;
  alertDate: string;
  alertType: "warming" | "cooling" | "extreme_hot" | "extreme_cold";
  title: string;
  description: string | null;
  currentScore: number;
  previousScore: number | null;
  scoreChange: number | null;
  totalLimitUp: number | null;
  connectionBoards: number | null;
  maxBoards: number | null;
  isRead: "0" | "1";
  createdAt: Date;
}

// 预警类型图标和颜色映射
const alertTypeConfig = {
  warming: {
    icon: TrendingUp,
    bgColor: "bg-orange-100",
    textColor: "text-orange-700",
    borderColor: "border-orange-200",
    label: "转暖",
  },
  cooling: {
    icon: TrendingDown,
    bgColor: "bg-blue-100",
    textColor: "text-blue-700",
    borderColor: "border-blue-200",
    label: "转冷",
  },
  extreme_hot: {
    icon: Flame,
    bgColor: "bg-red-100",
    textColor: "text-red-700",
    borderColor: "border-red-200",
    label: "极度亢奋",
  },
  extreme_cold: {
    icon: Snowflake,
    bgColor: "bg-cyan-100",
    textColor: "text-cyan-700",
    borderColor: "border-cyan-200",
    label: "极度冰点",
  },
};

export function SentimentAlertBell() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const utils = trpc.useUtils();

  // 获取预警数据
  const { data: alerts = [], isLoading: alertsLoading } = trpc.sentiment.getAlerts.useQuery(
    { limit: 20 },
    { refetchInterval: 60000 } // 每分钟刷新一次
  );

  // 获取未读数量
  const { data: unreadCount = 0 } = trpc.sentiment.getUnreadCount.useQuery(undefined, {
    refetchInterval: 30000, // 每30秒刷新一次
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

  const handleMarkAsRead = (id: number) => {
    if (user) {
      markAsReadMutation.mutate({ id });
    }
  };

  const handleMarkAllAsRead = () => {
    if (user) {
      markAllAsReadMutation.mutate();
    }
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日`;
  };

  // 格式化评分变化
  const formatScoreChange = (change: number | null) => {
    if (change === null) return "";
    const sign = change > 0 ? "+" : "";
    return `${sign}${change}`;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          {unreadCount > 0 ? (
            <>
              <BellRing className="h-5 w-5 text-orange-500 animate-pulse" />
              <Badge 
                className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs bg-red-500 text-white"
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </Badge>
            </>
          ) : (
            <Bell className="h-5 w-5" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <span className="font-semibold">情绪预警</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {unreadCount} 条未读
              </Badge>
            )}
          </div>
          {unreadCount > 0 && user && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={handleMarkAllAsRead}
              disabled={markAllAsReadMutation.isPending}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              全部已读
            </Button>
          )}
        </div>

        <ScrollArea className="h-[400px]">
          {alertsLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">暂无预警记录</p>
              <p className="text-xs mt-1">当市场情绪出现拐点时会自动提醒</p>
            </div>
          ) : (
            <div className="divide-y">
              {alerts.map((alert: SentimentAlert) => {
                const config = alertTypeConfig[alert.alertType];
                const Icon = config.icon;
                const isUnread = alert.isRead === "0";

                return (
                  <div
                    key={alert.id}
                    className={`p-4 hover:bg-muted/50 transition-colors ${
                      isUnread ? "bg-blue-50/50" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-full ${config.bgColor}`}>
                        <Icon className={`h-4 w-4 ${config.textColor}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge
                            variant="outline"
                            className={`text-xs ${config.bgColor} ${config.textColor} ${config.borderColor}`}
                          >
                            {config.label}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(alert.alertDate)}
                          </span>
                          {isUnread && (
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                          )}
                        </div>
                        <h4 className="font-medium text-sm mb-1 line-clamp-1">
                          {alert.title}
                        </h4>
                        {alert.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                            {alert.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-xs">
                          <span className="flex items-center gap-1">
                            <span className="text-muted-foreground">评分:</span>
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
                          </span>
                          {alert.totalLimitUp !== null && (
                            <span className="text-muted-foreground">
                              涨停: {alert.totalLimitUp}
                            </span>
                          )}
                          {alert.maxBoards !== null && (
                            <span className="text-muted-foreground">
                              最高: {alert.maxBoards}板
                            </span>
                          )}
                        </div>
                      </div>
                      {isUnread && user && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => handleMarkAsRead(alert.id)}
                          disabled={markAsReadMutation.isPending}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <div className="p-3 border-t bg-muted/30">
          <p className="text-xs text-center text-muted-foreground">
            预警规则：评分变化≥15分或进入极端区间时触发
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
