# stock-limit-up-analyzer 硬禁令索引

> 🔴 **唯一细则源 = `.workbuddy/memory/PROJECT_RULES.md`**（含两章「MEMORY.md 原文下移」）。动手前读本文 + 当日日报，再按章名 grep 细则源。

## 三门（违反即事故）
1. 🔴 改 `server/**` ⇒ 热重启并**杀死在途 Run**（在途 = `RUNNING`；`PENDING` + 空 `inputSnapshot` 的草稿**禁收敛**）⇒ 用户在用页面时禁改 server、禁跑重库脚本。改 `client/**` 只走 HMR。
2. 🔴 禁 `install` / 新依赖 / `prettier --write` / `db:push` / `drizzle-kit generate` / 手写 `_journal.json`。
3. 🔴 **同一文件的多处编辑必须串行** —— 并行两个 `Edit` ⇒ 后写覆盖先写、前者**静默丢失**。

## 环境 / 工具
- 命令前置 `export PATH=/c/Users/A/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Windows/System32:$PATH`（缺 coreutils）；`git`/`node` 不认 `/c/...` ⇒ 传 `C:/...`；Win stdout 常不返回 ⇒ 落盘用 Python 读。端口只认启动日志。
- 🔴 **长任务输出禁接管道**（EPIPE）；后台用 `run_in_background` + 读 `.out.txt`。改文件 = Python bytes + `os.replace` + 回读；`str.replace` 须 `assert count==1`（否则静默 no-op）。
- 🔴 测试基线 = **8 失败文件 / 17 例**（277 文件 → 8 failed / 269 passed）：7 环境依赖（真库/真 Tushare/真证据文件）+ 1 已知失效（`parameterSearchEffectiveness`，属 parameterSearch 在研区）；**保持现状只登记**；判据 = 失败**文件集合**，先剥 ANSI 颜色码。🔴 `tsc --noEmit` 基线 = **23 条错误**（全在 parameterSearch / searchRobustness 在研区）⇒ 判据 = 错误集合不变，**不是「0 错」**（旧日志的 tsc=0 已过期）。🔴 行尾唯一依据 = **HEAD blob** ⇒ 改前改后跑 `scripts/checkEolDrift.mjs`；CRLF 仅 `PROJECT_RULES.md`/`.gitignore`，余为 LF。
- ✅ 前端验收 = 无头 Chrome/Edge + Node `WebSocket` 直连 CDP **量 DOM**（`agent-browser` 本机不可用）；端口实测空闲、输出**必须落盘**。one-off 脚本写仓外 `C:\work\sourcecode\_scratch\`；报告 `docs/research/`、探针 `docs/evidence/`（须登记 `README.md`，只准 `.mts/.mjs/.log/.json/.md/.txt`）。

## 测试（事项 `rFCOuv`，2026-09-19）
- 🔴 日常**禁跑全量**，用 `pnpm run test:changed`（git 改动 → 反向依赖图 → 只跑受影响；`scripts/testChanged.mts`）；全量只在验收/合并前跑。
- 🔴 依赖图两条边语义不同：`import` 边**可传递且必须剔除纯类型引用**（`client/**` 对 `server/**` 全是 `import type { AppRouter }`，算进去就退化成全量）；`reads` 边（测试用字符串路径 `readFileSync` 读源码，21 个）**只认直接命中、不传递**。
- 模块测试文档 = `docs/testing/**`（镜像 `tests/**`），`pnpm run docs:tests` 生成，**禁手改**；新增/删测试后重跑。
- `client/src/pages/Dashboard.tsx` **零测试 import**（首页覆盖只经 `shared/ladderHeight.ts` 到达）⇒ 改它 `test:changed` 会响亮报「无测试依赖」。

## 总控
- `ROADMAP.md` 唯一 Master Control（§44 覆盖式只留 1 条；§44.5 队列；§47 append-only → `ROADMAP-CHANGELOG.md`）；`RESEARCH_READY=TRUE`（gate 17/17）才允许策略结论。
- 🔴 取号真源 = 「编号台账」行（**禁「末条 +1」**）；**文件头铁律行 + 台账行两处同步**；**取号前先对远端 + grep 全仓 `9b?`**。✅ **2026-09-19 已对账**：两处 = 「用至 `9bu` ⇒ 下一个 `9bv`」（漂移背景：`9bs`=PARAMETER-001、`9bt`=PARAMETER-002 曾实占未入台账；`9bu`=HOMEPAGE-006）。
- 🔴 分叉合流：`ls-remote` → `fetch` → `merge --no-ff`；文档冲突**两侧都保留**；丢文件 `git ls-files -d -z | xargs -0 git checkout --`。

## 领域口径（最易踩）
1. 评估端口 = `server/research/strategyEvaluation/`（唯一），主输出 `evaluation`；**`dataReady: true` 必须显式传**（否则 `INCONCLUSIVE`）。
2. 交易日历唯一来源 = `index_daily`（停更 ⇒ 静默 no-op 却报成功，补数须 `--force`）。
3. `/backtest` 并存两套交易语义（快照 = 等权；顶层 = 固定 100 股）⇒ **禁加 cap**。
4. **止损三落点互不相通**（`realisticBacktest.ts` / `paperTrading.ts` / `server/engine/**` 完全不执行）。
5. 研究链真实边界：`Analysis→Result→Finding→Conclusion` **已落库**（`research_finding` / `research_conclusion`）；`research_artifact` **生产零写入**（⇒ 落盘报告够不到）；`Conclusion→Candidate` **无自动派生桥**（候选规则来自 Pattern 投影 / 单条分析 filterRule / Hypothesis，findings 仅 provenance）。Pattern 与 Dataset **零耦合**；一次运行**只读一个** `datasetVersionId`。
- 事项闭环：`todo_delegate_status = idle` ⇒ 用 `todo_add_comment` + `todo_transition`。

## 页面
- 🔴 侧栏高亮 = **分段精确匹配 + 取最长命中**（`AppShell.tsx#isPathActive`，禁 `startsWith`）；首页 `/` 入口 = 左上角标题（`data-slot="sidebar-home-link"`）⇒ 站在 `/` 侧栏**零高亮**。
- 🔴 首页 = `client/src/pages/Dashboard.tsx`；梯队「高度」= **若该股本日涨停会达到的连板数**（断板 +1；**首板未续也 +1**）⇒ 唯一实现 `shared/ladderHeight.ts`；行序按题材当日热力降序（`shared/sectorHeatOrder.ts`）。⚠️ `limit_up_records.boardCount` 基本全 NULL ⇒ **不可作真源**。
- 🔴 生成物禁手改：`darkCompatibility.css` / `favicon.svg`；**免责声明不得删**。
- 🔴 **「接线完成」≠「用户够得到」** ⇒ 交付前按**正常导航**量 DOM；长请求按钮 pending **必须换文案**；静默 `return` 换响亮 toast。
- 🔴 **CDP 五坑**：兼听 `requestWillBeSent`；toast 每 400ms 轮询；模板串正则 `\s` 被吃（用 `includes`）；Radix/受控控件只认真实鼠标；端口**实测空闲**。

- 🔴 `/backtest` 冷启动慢的**根因 = 取数，不是计算**（实测：计算合计仅 **6.2s**；取数 1 年 **46.5s** / 2 年 **138s**；端到端 1 年 21~58s，**2 年直接 500 超时**）。价格行换区间就全量重拉且永不落盘 ⇒ 任何「结果缓存 / 载荷剥离」都是小修。**根治方案 = `docs/research/PLAN-BACKTEST-COLD-START-001.md`**（P0 三个与区间无关的读盘化 / P1 价格行存到(股票,日期)行级 / P2 切区间不自动重算）。详见细则章名 `组合回测页（/backtest）加载性能`。
## 详见细则源（按章名 grep `PROJECT_RULES.md`）
- **`MEMORY.md 原文下移`（两章，必读）**：策略 Core 语义权威（ARCH-001/002）· Strategy 域坐标与参数链路（AUDIT-001）· Backtest 口径与留档（BACKTEST-002）· Parameter Search（PARAMETER-001/002）· 参数搜索性能（PARAMETER-001-PRE）· Baseline 入口与 DB 事实（SYSTEM-BASELINE-001）· 扩展能力方案要点。
- 其它章：`测试资产与增量测试纪律` / `真实 tRPC 全链 E2E` / `涨停判定` / `数据完整性` / `Migration 流程` / `跨模块坐标` / `已知地雷` / `运行工作台…` / `闭环回测留档` / `模式库（PATTERN-LIBRARY-001）` / `前端可达性` / `行尾漂移` / `循环 import 与顶层常量` / `本机 curl 走 HTTP 代理`。
- 外部入口：`docs/architecture/SYSTEM-BASELINE.md`（v1.1.1）+ `AGENT-GUIDE.md`；审计全文 `docs/research/STRATEGY-AUDIT-001.md`；**扩展能力方案 = `docs/research/PLAN-STRATEGY-MODULE-EXTENSION-001-REVISED.md`**（001 的事实部分仍有效，分期被取代为 Phase A~D；**唯一推荐下一步 = Phase A 报告产物落地**；待批准、未实施）。
