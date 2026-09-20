import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
      // RESEARCH-EXPERIMENT-001 — 独立研究实验体系根目录（与 vite.config.ts 保持一致；
      // 两处别名不同步会让「测试里能跑、浏览器里跑不起来」这类问题出现）。
      "@experiments": path.resolve(templateRoot, "research-experiments"),
    },
  },
  test: {
    environment: "node",
    include: [
      // 测试文件统一收拢在仓库根 tests/（镜像 server / client/src / shared 结构）
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "tests/**/*.spec.ts",
    ],
  },
});
