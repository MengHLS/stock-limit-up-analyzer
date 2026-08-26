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
import * as db from "../db";
import { syncCandidateDailyPrices } from "../stockPriceSync";
import { fetchMarketFactorSnapshot } from "../marketFactors";

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

  // 定时任务回调：自动获取大盘成交额与两融余额并写入数据库
  app.post("/api/scheduled/syncMarketData", async (req, res) => {
    try {
      const authUser = await sdk.authenticateRequest(req);
      if (!authUser.isCron) {
        return res.status(403).json({ error: "Unauthorized cron caller" });
      }

      // 获取当前北京时间日期 (YYYY-MM-DD)
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const todayStr = formatter.format(now);

      try {
        const snapshot = await fetchMarketFactorSnapshot(todayStr);
        const saved = await db.upsertMarketData({
          dataDate: todayStr,
          turnover: String(snapshot.turnoverYi),
          marginBalance: String(snapshot.marginBalanceYi),
          note: "真实来源：Tushare daily（沪深成交额）+ 上交所/深交所公开两融汇总",
        });
        console.log(`[MarketSync] Synced verified market data for ${todayStr}: turnover=${snapshot.turnoverYi}, marginBalance=${snapshot.marginBalanceYi}`);
        return res.json({ ok: true, date: todayStr, data: saved, sources: snapshot.sources });
      } catch (sourceError) {
        const skipped = sourceError instanceof Error ? sourceError.message : String(sourceError);
        console.warn(`[MarketSync] Skipped ${todayStr}; verified market sources are unavailable: ${skipped}`);
        return res.json({ ok: true, skipped, date: todayStr });
      }
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
  });
}

startServer().catch(console.error);
