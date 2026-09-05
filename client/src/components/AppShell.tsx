import { useAuth } from "@/_core/hooks/useAuth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getLoginUrl } from "@/const";
import { SentimentAlertBell } from "@/components/SentimentAlertBell";
import { Button } from "@/components/ui/button";
import {
  Activity,
  BarChart3,
  Bell,
  ClipboardList,
  CloudDownload,
  Crown,
  Database,
  LayoutDashboard,
  LogOut,
  TrendingUp,
  Upload,
  WalletCards,
} from "lucide-react";
import { useLocation } from "wouter";
import { type LucideIcon } from "lucide-react";

type NavItem = {
  label: string;
  path: string;
  icon: LucideIcon;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "复盘分析",
    items: [
      { label: "涨停复盘", path: "/", icon: LayoutDashboard },
      { label: "大盘分析", path: "/market", icon: BarChart3 },
      { label: "情绪分析", path: "/sentiment-analysis", icon: Activity },
      { label: "龙头候选", path: "/leader-candidates", icon: Crown },
    ],
  },
  {
    label: "量化回测",
    items: [
      { label: "组合回测", path: "/backtest", icon: WalletCards },
      { label: "前向纸面交易", path: "/paper-trading", icon: TrendingUp },
    ],
  },
  {
    label: "数据录入",
    items: [
      { label: "上传图片", path: "/upload", icon: Upload },
      { label: "录入大盘数据", path: "/market-data-input", icon: Database },
    ],
  },
  {
    label: "数据管理",
    items: [
      { label: "行情同步", path: "/stock-sync", icon: CloudDownload },
      { label: "情绪预警", path: "/sentiment-alerts", icon: Bell },
      { label: "操作日志", path: "/operation-logs", icon: ClipboardList },
    ],
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();

  const handleNavigate = (path: string) => {
    if (path !== location) setLocation(path);
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="h-16 justify-center">
          <button
            onClick={() => handleNavigate("/")}
            className="flex items-center gap-2.5 px-2 py-1.5 w-full rounded-lg hover:bg-sidebar-accent transition-colors group-data-[collapsible=icon]:justify-center"
          >
            <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
              <TrendingUp className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="font-bold text-base bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent group-data-[collapsible=icon]:hidden truncate">
              涨停复盘助手
            </span>
          </button>
        </SidebarHeader>

        <SidebarContent>
          {navGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive =
                    item.path === "/"
                      ? location === "/"
                      : location.startsWith(item.path);
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        onClick={() => handleNavigate(item.path)}
                      >
                        <item.icon
                          className={isActive ? "text-orange-600" : ""}
                        />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <div className="flex items-center gap-2 px-1 group-data-[collapsible=icon]:justify-center">
            <SentimentAlertBell />
            {isAuthenticated && user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-sidebar-accent transition-colors w-full text-left group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:w-auto focus:outline-none">
                    <Avatar className="h-8 w-8 border shrink-0">
                      <AvatarFallback className="text-xs font-medium">
                        {user.name?.charAt(0).toUpperCase() ?? "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                      <p className="text-sm font-medium truncate leading-none">
                        {user.name ?? "用户"}
                      </p>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onClick={() => void logout()}
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    退出登录
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                size="sm"
                className="gap-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 group-data-[collapsible=icon]:hidden"
                onClick={() => {
                  window.location.href = getLoginUrl();
                }}
              >
                登录
              </Button>
            )}
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
