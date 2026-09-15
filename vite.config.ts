import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";
import { defineConfig } from "vite";


const plugins = [react(), tailwindcss(), jsxLocPlugin()];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  // 冷启动优化（2026-09-15）：见 .workbuddy/memory 的 dev 冷启动记录。
  optimizeDeps: {
    // 依赖预打包清单（取自 node_modules/.vite/deps/_metadata.json 的实况）。
    // 显式列出 ⇒ Vite 在「服务启动」阶段就完成校验/预打包，而不是等第一个页面请求
    // 才现场扫描（后者会把首屏请求挂住十几秒，实测 9.7~17.4s）。
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@trpc/client",
      "@trpc/react-query",
      "superjson",
      "wouter",
      "zod",
      "clsx",
      "tailwind-merge",
      "class-variance-authority",
      "lucide-react",
      "next-themes",
      "sonner",
      "recharts",
      "react-day-picker",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-avatar",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-collapsible",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-label",
      "@radix-ui/react-popover",
      "@radix-ui/react-progress",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slot",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
    ],
    // 默认 true 时，首个请求要等到「依赖扫描」结束才返回；关掉后立即返回，
    // 万一日后发现新依赖，Vite 走「重新预打包 + 自动刷新」而不是把页面卡死。
    holdUntilCrawlEnd: false,
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
