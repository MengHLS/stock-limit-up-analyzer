import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Upload from "./pages/Upload";
import Market from "./pages/Market";
import MarketData from "./pages/MarketData";
import MarketDataInput from "./pages/MarketDataInput";
import SentimentAlerts from "./pages/SentimentAlerts";
import SentimentAnalysis from "./pages/SentimentAnalysis";
import LeaderCandidates from "./pages/LeaderCandidates";
import Backtest from "./pages/Backtest";
import OperationLogs from "./pages/OperationLogs";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/upload"} component={Upload} />
      <Route path={"/market"} component={Market} />
      <Route path="/market-data" component={MarketData} />
      <Route path="/market-data-input" component={MarketDataInput} />
      <Route path="/sentiment-alerts" component={SentimentAlerts} />
      <Route path="/sentiment-analysis" component={SentimentAnalysis} />
      <Route path="/leader-candidates" component={LeaderCandidates} />
      <Route path="/backtest" component={Backtest} />
      <Route path="/operation-logs" component={OperationLogs} />

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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
