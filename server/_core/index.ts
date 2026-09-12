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
import { ensureStockPriceIndex } from "../stockPriceIndex";
import { startMarketSyncScheduler, syncMarketDataOnce, syncMarketDataIfMissing } from "../marketSync";
import { startPaperTradingScheduler, advancePaperTradingOnce } from "../paperTradingScheduler";
import { reclaimOrphanBuildJobs } from "../datasetRegistry";
import { resolveRuntimeNodeEnv } from "./env";

// 统一运行模式（判定口径见 env.ts#resolveRuntimeNodeEnv）。
// 必须早于任何读取 process.env.NODE_ENV 的逻辑：下方的 Vite/静态分支、vite.ts#serveStatic、
// context.ts#createContext 都直接读它；NODE_ENV 未声明时这里会落成 development。
process.env.NODE_ENV = resolveRuntimeNodeEnv();

type PortProbe = "free" | "in-use" | "denied";

/**
 * 探测端口能否绑定。
 * - free    可绑定
 * - in-use  EADDRINUSE：已被其他进程占用，换相邻端口即可
 * - denied  EACCES：端口落在操作系统保留段内。Windows 上 Hyper-V / WSL / Docker 会整段
 *           占用 8000-9000 等区间（可见 `netsh interface ipv4 show excludedportrange protocol=tcp`），
 *           同段内逐个重试必然全部失败，必须整段跳过。
 */
function probePort(port: number): Promise<PortProbe> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      resolve(error.code === "EACCES" ? "denied" : "in-use");
    });
    server.listen(port, () => {
      server.close(() => resolve("free"));
    });
  });
}

async function findAvailablePort(startPort: number = 3000, span: number = 200): Promise<number> {
  for (let port = startPort; port < startPort + span; port++) {
    const probe = await probePort(port);
    if (probe === "free") {
      return port;
    }
    if (probe === "denied") {
      // 保留端口段按 100 为粒度连续成段（8000-8099 / 8100-8199 ...），跳到本段末尾，
      // 循环自增后即进入下一段，避免在整段保留区内逐 1 空转。
      port = Math.floor(port / 100) * 100 + 99;
    }
  }
  throw new Error(
    `No available port found starting from ${startPort}（已扫描 ${span} 个端口）。` +
      `若日志出现 EACCES，说明该端口段被操作系统保留，请把 .env 的 PORT 改到保留段之外（如 3000）。`,
  );
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

  const envPort = Number.parseInt(process.env.PORT ?? "", 10);
  const preferredPort = Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : 3000;
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
    // 预热「行情同步检查」所需的位图索引：有磁盘快照时 ~84ms，缺失则后台重建（不阻塞服务启动）。
    ensureStockPriceIndex();
    // 回收孤儿构建作业：构建运行态是进程内内存 map，上次进程退出后遗留的 RUNNING 作业
    // 无人接管、永不终态，会把版本永久卡在 BUILDING（既不能重建也不能删除）。
    // 判据 = 停更超过 DATASET_RECLAIM_STALE_MINUTES（缺省 10）分钟；回收 = 置 CANCELLED + 版本 FAILED + 清空该版本数据行。
    void reclaimOrphanBuildJobs()
      .then((reclaimed) => {
        for (const r of reclaimed) {
          console.warn(
            `[DatasetBuild] 回收孤儿作业 job=${r.jobId} version=${r.datasetVersionId} ` +
              `停更=${r.staleMinutes}分钟 ` +
              (r.rollbackSkipped
                ? `未清空数据（版本仍 READY，本轮未接管 ⇒ 原数据保持有效）`
                : `已清空数据=${r.purgedRows}行`),
          );
        }
      })
      .catch((error) => {
        console.error("[DatasetBuild] 孤儿作业回收异常:", error);
      });
  });
}

startServer().catch(console.error);
