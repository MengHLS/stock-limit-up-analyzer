import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  // 开发态预热（2026-09-15）：让「依赖预打包 + 入口模块图的转换 + Tailwind 首轮编译」在服务启动后
  // 立刻在后台跑完，而不是等第一个页面请求来时串行阻塞（实测首屏 10.2s -> 亚秒级）。
  // 🔴 必须先 await depsOptimizer.init()：预热若撞上「依赖正在重新预打包」，
  // warmupRequest 会因 ERR_OUTDATED_OPTIMIZED_DEP 静默返回（不抛也不报），等于白跑。
  void (async () => {
    const clientEnv = vite.environments.client;
    try {
      await clientEnv.depsOptimizer?.init();
    } catch {
      /* 依赖预打包失败不阻断启动；下方预热同样失败也不影响功能 */
    }
    for (const target of ["/src/main.tsx", "/src/App.tsx", "/src/index.css"]) {
      try {
        await clientEnv.warmupRequest(target);
      } catch {
        /* 预热不成功也只是首屏慢一点 */
      }
    }
  })();
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
