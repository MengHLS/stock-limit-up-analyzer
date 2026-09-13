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
