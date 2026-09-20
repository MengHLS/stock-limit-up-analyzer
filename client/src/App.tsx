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
// RESEARCH-EXPERIMENT-003 — 旧 Research 工作台（`/research` 及其子路由）与
//   Finding / Conclusion 列表页已**整体删除**：旧 Research 体系不再属于正式系统。
//   正式研究入口只剩 `/research-experiments`（见下方 RESEARCH-EXPERIMENT-001 注释）。
// RESEARCH-006.4.1 — Strategy Candidate（研究 → 策略桥）详情页保留：
//   它是「候选草稿 → 策略」的唯一前端入口，与旧 Analysis/Finding/Conclusion 无关。
import { StrategyCandidateDetail } from "./pages/candidates";
// FRONTEND-FINAL-001（P0-1）— 正式验证域：OOS / Walk-Forward / 稳健性的**持久化**口径唯一入口。
//   审计确认旧 `/walk-forward` 走的是内存态技术预览（不落库），与持久化实现是两套且互不引用
//   ⇒ 正式口径改由 `/validation/*` 承载，旧页保留代码但从导航移除（见 WalkForwardAnalysis.tsx）。
import {
  ValidationIndexPage,
  RobustnessValidationPage,
  OosValidationPage,
  WalkForwardValidationPage,
} from "./pages/validation";
// RESEARCH-EXPERIMENT-001 — 独立研究实验体系：实验列表 / 详情（实验自带参数与结果结构，
//   可直接读 Dataset，**不经过**旧 Research 的 Analysis/Finding/Conclusion 链路）
// RESEARCH-EXPERIMENT-004 — 新增 Run 详情页：只凭 `runId` 打开一条**已持久化**的历史 Run
//   （Run 元数据在 TiDB、结果与产物在对象存储）。
import {
  ResearchExperimentList,
  ResearchExperimentDetail,
  ResearchExperimentRunDetail,
} from "./pages/researchExperiments";

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
      {/* FRONTEND-FINAL-001（P1-6）— 参数搜索深链：`/parameter-search/:runId` 直达某次搜索 Run。
          与 `?searchRunId=` 等价（两者都支持），刷新 / 分享后都能恢复选中坐标。 */}
      <Route path="/parameter-search/:runId" component={ParameterSearch} />
      {/* FRONTEND-FINAL-001（P0-1）— 正式验证域（持久化口径）。旧 `/walk-forward` 仅保留代码，不再是正式入口。 */}
      <Route path="/validation" component={ValidationIndexPage} />
      <Route path="/validation/robustness" component={RobustnessValidationPage} />
      <Route path="/validation/robustness/:runId" component={RobustnessValidationPage} />
      <Route path="/validation/oos" component={OosValidationPage} />
      <Route path="/validation/oos/:runId" component={OosValidationPage} />
      <Route path="/validation/walk-forward" component={WalkForwardValidationPage} />
      <Route path="/validation/walk-forward/:runId" component={WalkForwardValidationPage} />
      <Route path="/validation/walk-forward/:runId/folds/:foldIndex" component={WalkForwardValidationPage} />
      {/* 旧技术预览口径（不落库）。保留可达性以免旧书签 404，但**不在侧栏出现**、页面顶部有醒目降级提示。 */}
      <Route path="/walk-forward" component={WalkForwardAnalysis} />
      <Route path="/regime-report" component={RegimeReport} />
      <Route path="/review-workbench" component={ReviewWorkbench} />
      {/* RESEARCH-EXPERIMENT-003 — 旧 Research 路由段（`/research*`、`/findings*`、
          `/conclusions*`、`/candidates` 列表）已整体移除。候选详情保留一条可达路径
          （跨实验候选列表页不存在了，但候选详情仍可从策略溯源面板打开）。 */}
      <Route path="/candidates/:candidateId" component={StrategyCandidateDetail} />

      {/* RESEARCH-EXPERIMENT-001 — **唯一**的正式研究入口：独立实验体系。
          路径形态 `:group/:key` 对应实验 id 的 `<group>/<key>` 两段（id 内含 `/`，
          因此不能用一个 `:experimentId` 段匹配）。 */}
      <Route path="/research-experiments" component={ResearchExperimentList} />
      <Route path="/research-experiments/:group/:key" component={ResearchExperimentDetail} />
      {/* RESEARCH-EXPERIMENT-004 — 持久化 Run 详情。**更具体的路径必须放在
          `/research-experiments/:group/:key` 之后**（wouter 的 Switch 按顺序匹配，
          但 `:group` 只吃一段，所以两条互不吞并；顺序放在后面更直观）。 */}
      <Route
        path="/research-experiments/:group/:key/runs/:runId"
        component={ResearchExperimentRunDetail}
      />

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
