import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { syncCandidateDailyPrices } from "../stockPriceSync";
import { startMarketSyncScheduler, syncMarketDataOnce, syncMarketDataIfMissing } from "../marketSync";
import { startPaperTradingScheduler, advancePaperTradingOnce } from "../paperTradingScheduler";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // 定时任务回调：自动获取大盘成交额与两融余额并写入数据库（供外部 cron 平台调用）
  app.post("/api/scheduled/syncMarketData", async (req, res) => {
    try {
      const authUser = await sdk.authenticateRequest(req);
      if (!authUser.isCron) {
        return res.status(403).json({ error: "Unauthorized cron caller" });
      }

      const result = await syncMarketDataOnce();
      if (result.ok) {
        console.log(`[MarketSync] Synced verified market data for ${result.date}: turnover=${result.turnoverYi}, marginBalance=${result.marginBalanceYi}`);
        return res.json({ ok: true, date: result.date, data: result, sources: result.sources });
      }
      console.warn(`[MarketSync] Skipped ${result.date}; verified market sources are unavailable: ${result.skipped}`);
      return res.json({ ok: true, skipped: result.skipped, date: result.date });
    } catch (error: any) {
      console.error("[MarketSync] Error in scheduled sync:", error);
      return res.status(500).json({
        error: error.message || "Internal server error",
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 定时任务回调：盘后补齐候选池所需近期日线价格，重复执行会按代码与日期覆盖写入。
  app.post("/api/scheduled/syncStockDailyPrices", async (req, res) => {
    try {
      const authUser = await sdk.authenticateRequest(req);
      if (!authUser.isCron) {
        return res.status(403).json({ error: "Unauthorized cron caller" });
      }

      const result = await syncCandidateDailyPrices("recent");
      return res.json({ ok: true, result });
    } catch (error: any) {
      console.error("[StockPriceSync] Scheduled sync failed:", error);
      return res.status(500).json({
        error: error.message || "Internal server error",
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 定时任务回调：把全部 active 前向纸面交易运行推进到最新交易日（真实样本外闭环）。
  app.post("/api/scheduled/advancePaperTrading", async (req, res) => {
    try {
      const authUser = await sdk.authenticateRequest(req);
      if (!authUser.isCron) {
        return res.status(403).json({ error: "Unauthorized cron caller" });
      }

      const result = await advancePaperTradingOnce();
      if (result.ok) {
        return res.json({ ok: true, result });
      }
      return res.json({ ok: true, skipped: result.skipped });
    } catch (error: any) {
      console.error("[PaperTrading] Scheduled advance failed:", error);
      return res.status(500).json({
        error: error.message || "Internal server error",
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
    }
  });
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // 启动大盘数据盘后自动同步调度（北京时间 16:00 / 17:30，服务自身定时，不依赖外部 cron）。
    startMarketSyncScheduler();
    // 启动前向纸面交易每日推进调度（北京时间 17:00 / 18:30，在行情同步之后）。
    startPaperTradingScheduler();
    // 启动兜底：延迟片刻后，若今日（北京时间）尚无大盘数据则立即补同步一次。
    setTimeout(() => {
      void syncMarketDataIfMissing().catch((error) => {
        console.error("[MarketSync] 启动补同步异常:", error);
      });
    }, 10_000);
  });
}

startServer().catch(console.error);
