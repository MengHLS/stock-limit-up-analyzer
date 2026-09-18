import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect, useSearch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import AppShell from "./components/AppShell";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
// HOMEPAGE-001（编号 9be）—— 首页 = 行情复盘总览，接管路由 `/`
//   原 `/` 的涨停复盘明细迁至 `/limit-up`（文件同时由 Home.tsx 更名为 LimitUpReview.tsx）
import Dashboard from "./pages/Dashboard";
import LimitUpReview from "./pages/LimitUpReview";
import Upload from "./pages/Upload";
import Market from "./pages/Market";
import SentimentAlerts from "./pages/SentimentAlerts";
import SentimentAnalysis from "./pages/SentimentAnalysis";
import LeaderCandidates from "./pages/LeaderCandidates";
import Backtest from "./pages/Backtest";
// CLOSED-LOOP-BACKTEST-PERSIST-001 — 闭环回测留档历史（与上行 legacy /backtest 不同源）
import BacktestRuns from "./pages/BacktestRuns";
import PaperTrading from "./pages/PaperTrading";
import OperationLogs from "./pages/OperationLogs";
import StockSync from "./pages/StockSync";
// FE-1 — 研究链路：数据域健康看板
import DataHealth from "./pages/DataHealth";
// FE-2 — 研究链路：asOf(T) 历史状态查询器
import HistoricalState from "./pages/HistoricalState";
// DATASET-002.4B — 旧 /dataset-builder（FE-3）已整合进 Dataset Registry，此处仅保留重定向
import {
  DatasetList,
  DatasetDetail,
  VersionList,
  VersionDetail,
} from "./pages/datasets";
// FE-4 — 研究链路：策略**列表**与**详情**分家（2026-09-13）
//   列表 `/strategies`            → 有哪些策略、各自什么状态
//   详情 `/strategies/:strategyId` → 这一个策略长什么样、跑不跑得动
import StrategyList from "./pages/StrategyList";
import StrategyDetail from "./pages/StrategyDetail";
// FE-5 — 研究链路：绩效仪表盘（骨架线）
import PerformanceDashboard from "./pages/PerformanceDashboard";
// FE-6 — 研究链路：参数搜索 + 鲁棒性（骨架线）
import ParameterSearch from "./pages/ParameterSearch";
// FE-7 — 研究链路：Walk-Forward / OOS + 过拟合判定（骨架线）
import WalkForwardAnalysis from "./pages/WalkForwardAnalysis";
// FE-8 — 研究链路：Regime + 报告导出（骨架线）
import RegimeReport from "./pages/RegimeReport";
// FE-9 — 研究链路：复盘纪律 + 生产闭环（骨架线）
import ReviewWorkbench from "./pages/ReviewWorkbench";
// RESEARCH-002 — 研究引擎：实验 / Run / 分析 / 结果 / 结论 工作台
// RESEARCH-006.4.1 — Research → Candidate 前端闭环：候选详情（结论 → 候选 → 状态流转）
import { ResearchList, ResearchAsk, ResearchDetail, StrategyCandidateDetail } from "./pages/research";

/**
 * 旧链接兼容：`/strategy-editor?strategyId=…&version=…`。
 *
 * 候选转正页等历史入口曾把坐标拼在这条 URL 上；详情页迁到 `/strategies/:strategyId` 之后，
 * 这里只做一次**静态改写**（不渲染第二套策略页面），旧书签与旧链接继续可用。
 */
function LegacyStrategyRedirect() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const strategyId = params.get("strategyId");
  const version = params.get("version");
  if (strategyId === null || strategyId === "") {
    return <Redirect to="/strategies" />;
  }
  const suffix =
    version === null || version === ""
      ? ""
      : `?version=${encodeURIComponent(version)}`;
  return <Redirect to={`/strategies/${encodeURIComponent(strategyId)}${suffix}`} />;
}

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Dashboard} />
      {/* 原 `/` 的涨停复盘明细（HOMEPAGE-001 后迁到此处） */}
      <Route path={"/limit-up"} component={LimitUpReview} />
      <Route path={"/upload"} component={Upload} />
      <Route path={"/market"} component={Market} />
      <Route path="/sentiment-alerts" component={SentimentAlerts} />
      <Route path="/sentiment-analysis" component={SentimentAnalysis} />
      <Route path="/leader-candidates" component={LeaderCandidates} />
      <Route path="/backtest" component={Backtest} />
      {/* 闭环回测留档：每次「运行策略」的产出都留档在这里（自动保存，无需手动点） */}
      <Route path="/backtest-runs" component={BacktestRuns} />
      <Route path="/paper-trading" component={PaperTrading} />
      <Route path="/operation-logs" component={OperationLogs} />
      <Route path="/stock-sync" component={StockSync} />
      <Route path="/data-health" component={DataHealth} />
      <Route path="/historical-state" component={HistoricalState} />
      {/* DATASET-002.4B — 旧 /dataset-builder 已整合，重定向到新数据集构建入口 */}
      <Route path="/dataset-builder">
        <Redirect to="/datasets" />
      </Route>
      {/* DATASET-002.x — 数据集构建（Dataset Registry；含版本创建 / 构建 / 进度） */}
      <Route path="/datasets" component={DatasetList} />
      <Route path="/datasets/:datasetId" component={DatasetDetail} />
      <Route path="/datasets/:datasetId/versions" component={VersionList} />
      <Route path="/datasets/:datasetId/versions/:versionId" component={VersionDetail} />
      {/* 策略：列表 / 详情分家；旧 /strategy-editor 仅做兼容改写 */}
      <Route path="/strategies" component={StrategyList} />
      <Route path="/strategies/:strategyId" component={StrategyDetail} />
      <Route path="/strategy-editor" component={LegacyStrategyRedirect} />
      <Route path="/performance" component={PerformanceDashboard} />
      <Route path="/parameter-search" component={ParameterSearch} />
      <Route path="/walk-forward" component={WalkForwardAnalysis} />
      <Route path="/regime-report" component={RegimeReport} />
      <Route path="/review-workbench" component={ReviewWorkbench} />
      {/* RESEARCH-002 — 研究引擎工作台（实验 → Run → 分析 → 结果 → 结论） */}
      <Route path="/research" component={ResearchList} />
      {/* RESEARCH-PLANNER-001 — 默认模式：提出问题即研究。必须排在 `/research/:experimentId`
          之前，否则 wouter 会把 `ask` 当成 experimentId 去匹配。 */}
      <Route path="/research/ask" component={ResearchAsk} />
      {/* RESEARCH-006.4.1 — 候选详情必须先于 `/research/:experimentId` 匹配（同前缀更深路径） */}
      <Route path="/research/candidates/:candidateId" component={StrategyCandidateDetail} />
      <Route path="/research/:experimentId" component={ResearchDetail} />

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * Toaster 包装：shadcn 的 sonner 封装默认从 next-themes 取主题（本项目没挂那个 Provider），
 * 这里显式把本项目的实际主题透传下去，保证 Toast 与页面主题一致。
 */
function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <ThemedToaster />
          <AppShell>
            <Router />
          </AppShell>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
