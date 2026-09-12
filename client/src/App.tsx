import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import AppShell from "./components/AppShell";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Upload from "./pages/Upload";
import Market from "./pages/Market";
import MarketDataInput from "./pages/MarketDataInput";
import SentimentAlerts from "./pages/SentimentAlerts";
import SentimentAnalysis from "./pages/SentimentAnalysis";
import LeaderCandidates from "./pages/LeaderCandidates";
import Backtest from "./pages/Backtest";
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
// FE-4 — 研究链路：策略编辑器 + 运行工作台
import StrategyEditor from "./pages/StrategyEditor";
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
import { ResearchList, ResearchDetail } from "./pages/research";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/upload"} component={Upload} />
      <Route path={"/market"} component={Market} />
      <Route path="/market-data-input" component={MarketDataInput} />
      <Route path="/sentiment-alerts" component={SentimentAlerts} />
      <Route path="/sentiment-analysis" component={SentimentAnalysis} />
      <Route path="/leader-candidates" component={LeaderCandidates} />
      <Route path="/backtest" component={Backtest} />
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
      <Route path="/strategy-editor" component={StrategyEditor} />
      <Route path="/performance" component={PerformanceDashboard} />
      <Route path="/parameter-search" component={ParameterSearch} />
      <Route path="/walk-forward" component={WalkForwardAnalysis} />
      <Route path="/regime-report" component={RegimeReport} />
      <Route path="/review-workbench" component={ReviewWorkbench} />
      {/* RESEARCH-002 — 研究引擎工作台（实验 → Run → 分析 → 结果 → 结论） */}
      <Route path="/research" component={ResearchList} />
      <Route path="/research/:experimentId" component={ResearchDetail} />

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <AppShell>
            <Router />
          </AppShell>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
