# stock-limit-up-analyzer 硬禁令索引

> **压缩索引**；🔴 **唯一细则源 = `.workbuddy/memory/PROJECT_RULES.md`**（末章「MEMORY.md 原文下移」= 旧全文 8439 字符，**零丢失**）。动手前读本文 + 当日日报，再按章名 grep。

## 三门
1. 🔴 改 `server/**` 会热重启并**杀死在途 Run**（在途 = `RUNNING`；`PENDING` + 空 `inputSnapshot` 的草稿**禁收敛**）⇒ 用户在用页面时禁改 server、禁跑重库脚本。改 `client/**` 只走 HMR。
2. 🔴 禁 `install` / 新依赖 / `prettier --write` / `db:push` / `drizzle-kit generate` / 手写 `_journal.json`。
3. 🔴 **同一文件的多处编辑必须串行** —— 并行两个 `Edit` ⇒ 后写覆盖先写、前者**静默丢失**（09-19 真踩）。

## 环境 / 工具
- 端口只认启动日志（4000 常被占 ⇒ 实测 **4001/4002**；残留无头 Chrome 会「TCP 通但 fetch 失败」）；探端点用 Node `fetch`。
- 沙箱 Bash 缺 coreutils（见用户级记忆）；`git`/`node` 不认 `/c/...` ⇒ 传 `C:/...`；Win stdout 常不返回 ⇒ 落盘用 Python 读。
- 🔴 **长任务输出禁接管道**（EPIPE ⇒ 脚本中止并清空自身留档）；后台用 `run_in_background` + 读 `.out.txt`。
- 🔴 改文件 = Python bytes + `os.replace` + 回读。测试基线 = **8 失败文件 / 17 用例**（判据 = 失败**文件集合**）。
- 🔴 行尾禁按清单判 ⇒ 先跑 `scripts/checkEolDrift.mjs`，唯一依据 = **HEAD blob**。纯 CRLF 仅 3 文件：`PROJECT_RULES.md`、`App.tsx`、`AppShell.tsx`。
- ✅ 前端验收 = 无头 Chrome + Node `WebSocket` 直连 CDP 量 DOM；端口**实测空闲**、输出**必须落盘**。
- one-off 脚本写仓外 `_scratch\`；报告 `docs/research/`、探针 `docs/evidence/`（**须登记 `README.md`**）。🔴 `client/**` 只禁 import `server/**` **运行时值**；`@shared/*` 允许。

## 总控
- `ROADMAP.md` 唯一 Master Control（§44 覆盖式 / §44.5 队列 / §47 append-only → `ROADMAP-CHANGELOG.md`）；仅 `RESEARCH_READY=TRUE` 允许策略结论。
- 🔴 取号真源 = 「编号台账」行（**禁「末条 +1」**）；**文件头铁律行 + 台账行两处同步**；**取号前先对远端**。现用至 `9bm` ⇒ 下一个 `9bn`。
- 🔴 分叉合流：`ls-remote` → `fetch` → `merge --no-ff`；文档冲突**两侧都保留**；丢文件 `git ls-files -d -z | xargs -0 git checkout --`。

## 领域口径
- 四条最易踩：① 评估端口 = `server/research/strategyEvaluation/`（唯一），主输出字段 **`evaluation`**；**`dataReady: true` 必须显式传**（`runAudit.ts:74` 缺省 false ⇒ 否则 `INCONCLUSIVE`）；② 交易日历唯一来源 = `index_daily`（**停更 ⇒ 静默 no-op 却报成功**，补数须 `--force`）；③ `/backtest` **并存两套交易语义**（快照 = 等权；顶层 = 固定 100 股）⇒ **禁加 cap**；④ **止损三落点互不相通**（`realisticBacktest.ts` / `paperTrading.ts` / `server/engine/**` **完全不执行**）。
- 事项闭环：`todo_delegate_status = idle` ⇒ 无 dispatch id ⇒ 用 `todo_add_comment`+`todo_transition`。

## 页面
- 🔴 侧栏高亮 = **分段精确匹配 + 取最长命中**（`AppShell.tsx#isPathActive`，禁 `startsWith`，详情页点亮父项）。**首页 `/` 入口 = 左上角网站标题**（`9bm`；锚点 `data-slot="sidebar-home-link"`），「复盘分析」组**不再单列「首页」** ⇒ 站在 `/` 侧栏**零高亮**。探针 `_probe_sidebar_active_highlight.mjs`。
- 🔴 首页 = `client/src/pages/Dashboard.tsx`：四指数迷你卡（各 **120 交易日**）+ 共享分类轴两联图（右轴**仅成交额**）+ 连板梯队「**高度 × 网格**」+ 题材热力图。
- 🔴 梯队「高度」= **「若该股本日涨停会达到的连板数」**（断板 +1；**首板未续也 +1**）⇒ 唯一实现 `shared/ladderHeight.ts`（🔴 `client/**` 禁 import `server/**` 运行时值 ⇒ 口径函数须落 `shared/`）。折叠是**组内**的（`LADDER_GROUP_VISIBLE_ROWS=3`）。梯队行内与热力图行序均按**题材当日热力**降序（`shared/sectorHeatOrder.ts`，缺热度 **-1**）。⚠️ `limit_up_records.boardCount` 基本全 NULL ⇒ **不可作真源**。
- 🔴 生成物禁手改：`darkCompatibility.css` / `favicon.svg`。运算符两形只在 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 译；**免责声明不得删**。
- 🔴 **「接线完成」≠「用户够得到」** ⇒ 交付前必须无头量 DOM；长请求按钮**必须换文案**；`Link` 包 `Button` 须 `<Button asChild><Link>`。
- 🔴 **CDP 五坑**：兼听 `requestWillBeSent`；toast 高频轮询；模板串正则 `\s` 被吃（用 `includes`）；Radix/受控控件只认真实鼠标；端口**实测空闲**。
