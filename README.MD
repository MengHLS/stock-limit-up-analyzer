# stock-limit-up-analyzer

A 股「涨停 / 连板」研究分析平台。

**技术栈**（版本取自 `package.json`）：React 19.2 · Vite 7.1 · TypeScript 5.9 · Express 4.21 · tRPC 11.6 · Drizzle ORM 0.44 · MySQL（`mysql2` 3.15）· Tailwind CSS 4.1 · Vitest 2.1 · 包管理器 **pnpm 10.4.1**。

## 启动（开发）

```bash
pnpm install     # 首次或依赖变更后
pnpm run dev     # 跨平台：Windows Git Bash / cmd / PowerShell / macOS / Linux 均可
```

### 🔴 端口：一律以**启动日志实际打印的**为准

- 端口取自 `.env` 的 `PORT`（默认 `3000`）。
- ⚠️ **本机 Windows 上 `3000` 落在系统保留端口段 `2980–3079`** ⇒ `listen` 会直接报 **`EACCES`**（**注意：这不是「端口被占用」**）⇒ dev server 会**静默回落到 `3100` / `3101`** 继续启动。
- ⇒ **不要假定 `http://localhost:3000` 一定可达**，也不要用「有没有监听 3000」去判断服务是否起来。**看启动日志里实际打出的那一行。**

### ⚠️ 不要在 npm 脚本里写前置环境变量赋值

不要写 `NODE_ENV=development tsx ...` 这种前置赋值 —— Windows 下 npm 用 `cmd.exe` 执行脚本，会直接报 `'NODE_ENV' 不是内部或外部命令`。

运行模式改由 `server/_core/env.ts#resolveRuntimeNodeEnv` 在**运行时**判定：**未显式声明 `production` 时一律按本地开发处理**。

## 生产构建与启动

```bash
pnpm run build
pnpm run start   # 等价于 node dist/index.js --production
```

## 手动启动（不经过 npm 脚本）

```bash
pnpm exec tsx watch server/_core/index.ts
```

## 其他脚本（完整清单见 `package.json`）

| 命令 | 作用 |
|---|---|
| `pnpm run check` | `tsc --noEmit` 类型检查 |
| `pnpm run test:changed` | **只跑与本次改动相关的测试**（`tsx scripts/testChanged.mts`）—— **日常开发用这个** |
| `pnpm test` | `vitest run` 全量测试（含 7 个环境依赖测试，离线恒红；只在版本验收 / 合并前跑一次） |
| `pnpm exec vitest run <路径>` | 跑单个文件或某个模块目录 |
| `pnpm run docs:tests` | 重新生成模块测试文档（`tsx scripts/genTestDocs.mts` → `docs/testing/**`） |
| `pnpm run backfill:daily` | 每日行情回填（`tsx scripts/backfillDaily.ts`） |
| `pnpm run db:push` | `drizzle-kit generate && drizzle-kit migrate` |

### 🔴 不要再「每个任务完成就跑全量」

全量里有 **8 个恒红文件**（7 个环境依赖：真 MySQL / 真 Tushare / 真实证据文件；＋ 1 个已知失效 `tests/server/research/parameterSearch/parameterSearchEffectiveness.test.ts`）离线**必然失败**，跑它只会让「基线零新增」退化成人工比对文件集合。
日常请用 `pnpm run test:changed`（按 git 改动 → 反向依赖图 → 只跑受影响的测试）。详见 `docs/testing/README.md`。

### 🔴 不要跑 `pnpm run format`

`pnpm run format` = `prettier --write .`，会**把本仓库的 CRLF 行尾整体改成 LF**（本仓库 `ROADMAP.md`、`ROADMAP-CHANGELOG.md`、`drizzle/schema.ts`、`client/src/**/*.tsx` 等为**纯 CRLF**）⇒ 会产生巨量无意义 diff。**本项目禁跑 `prettier --write`。**

## 相关文档

- `ROADMAP.md` —— 项目**唯一 Master Control**（§44 覆盖式状态区 / §44.5 未完成队列 / §47 append-only 更新记录）。
- `ROADMAP-CHANGELOG.md` —— 变更日志与 §44 历史条目归档（append-only）。
- `docs/testing/` —— **模块测试文档**（镜像 `tests/**` 结构，由 `pnpm run docs:tests` 生成，禁手改）。
- `docs/evidence/` —— 探针脚本与运行证据（不进 `tsc` / `vitest`）。
- `.workbuddy/memory/PROJECT_RULES.md` —— 本仓库工程铁律与已知地雷（**动手前必读**）。
