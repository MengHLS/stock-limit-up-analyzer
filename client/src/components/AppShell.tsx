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
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  ClipboardList,
  CloudDownload,
  Crown,
  LayoutDashboard,
  LogOut,
  History,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Upload,
  WalletCards,
  Workflow,
  FileText,
  FileClock,
  BookOpenCheck,
  FlaskConical,
  Sparkles,
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
      // CLOSED-LOOP-BACKTEST-PERSIST-001 — 闭环回测留档（每次「运行策略」自动存一条）
      { label: "回测历史", path: "/backtest-runs", icon: FileClock },
      { label: "前向纸面交易", path: "/paper-trading", icon: TrendingUp },
    ],
  },
  {
    label: "数据录入",
    items: [
      { label: "上传图片", path: "/upload", icon: Upload },
    ],
  },
  // FE-1 — 研究链路导航分组（在 legacy 壳上增量新增，不重置既有页面）
  {
    label: "研究数据",
    items: [
      { label: "数据域健康", path: "/data-health", icon: ShieldCheck },
      { label: "历史状态查询", path: "/historical-state", icon: History },
      { label: "数据集构建", path: "/datasets", icon: Boxes },
      // RESEARCH-PLANNER-001 — 默认入口放在最前：先提问，再（必要时）进实验工作台。
      { label: "提问研究", path: "/research/ask", icon: Sparkles },
      { label: "研究实验", path: "/research", icon: FlaskConical },
      { label: "策略", path: "/strategies", icon: ClipboardList },
      { label: "绩效仪表盘", path: "/performance", icon: Activity },
      { label: "参数搜索", path: "/parameter-search", icon: SlidersHorizontal },
      { label: "WFO/OOS 分析", path: "/walk-forward", icon: Workflow },
      { label: "Regime/报告", path: "/regime-report", icon: FileText },
      { label: "复盘工作台", path: "/review-workbench", icon: BookOpenCheck },
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

/**
 * 侧栏高亮判定（2026-09-15 修）。
 *
 * 旧实现是 `location.startsWith(item.path)` —— 字符串前缀匹配，会把「前缀相同但完全
 * 不同的板块」一起点亮（`/backtest-runs` 回测历史命中 `/backtest` 组合回测）。
 * 现改为**按路径分段**匹配：路径相等、或当前路径以「item.path + `/`」开头才算命中，
 * 于是详情页（`/datasets/:id`、`/strategies/:id`、`/research/:id`）依然点亮父级菜单项。
 */
function normalizePath(raw: string): string {
  // wouter 的 location 可能带 `?query` / `#hash`，也可能带尾部 `/`，先统一剥掉
  const stripped = raw.split("?")[0].split("#")[0];
  if (stripped.length > 1) return stripped.replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

function isPathActive(currentPath: string, itemPath: string): boolean {
  const target = normalizePath(itemPath);
  if (target === "/") return currentPath === "/";
  return currentPath === target || currentPath.startsWith(target + "/");
}

/** 所有导航项（跨分组拉平），用于「取最长命中」的全局判定 */
const allNavItems: NavItem[] = navGroups.flatMap(group => group.items);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  // 唯一高亮项 = 「所有命中项里路径最长」的那一个（详情页因此点亮父项，同前缀板块不会互亮）
  const currentPath = normalizePath(location);
  const activeNavPath =
    allNavItems
      .filter(item => isPathActive(currentPath, item.path))
      .sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length)[0]
      ?.path ?? null;


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
          {navGroups.map(group => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map(item => {
                  const isActive = item.path === activeNavPath;
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
          {/* 折叠态（icon）下侧栏内容宽仅 ~32px，三个控件并排放不下 ⇒ 竖排 */}
          <div className="flex items-center gap-2 px-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5">
            <SentimentAlertBell />
            <ThemeToggle />
            {isAuthenticated && user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-sidebar-accent transition-colors min-w-0 flex-1 text-left group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:flex-none focus:outline-none">
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
