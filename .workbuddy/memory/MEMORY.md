# stock-limit-up-analyzer 长期约定（精简索引）

> 细则（唯一权威文件名 / 不变量编号 / 验收判据 / 工具坑 / 时区 / Migration / 前端 recharts / tRPC 全链）**全在同目录 `PROJECT_RULES.md`** —— 动手前必须先读对应章节。
> 本文件只留「不知道就会立刻做错」的硬禁令。证据/叙述 → `ROADMAP.md` §44（真实状态，覆盖式）、§44.5（队列）、§47（更新记录，append-only）。

## 动手前三条
1. **先读 `PROJECT_RULES.md` 对应章节**（环境 / 前端 / tRPC 全链 / 涨停 / 回填 / 数据完整性 / Migration / 跨模块坐标 / 总控命名）。
2. 🔴 **改任何 `server/**` 都会触发热重启并杀死在途研究 Run**（Run 永久卡 `RUNNING`，无产品级恢复入口）⇒ **用户在用页面时禁改 server 文件、禁跑重型真实库脚本**。
3. 🔴 **禁 `pnpm/npm install`**（沙箱 SIGTERM）、**禁新增依赖**、**禁 `prettier --write`**、**禁 `npm run db:push` / `drizzle-kit generate`**、**禁手工补写 `drizzle/meta/_journal.json`**（属伪造）。

## 环境速查（详见 PROJECT_RULES.md「启动与本机环境」）
- 启动 `pnpm run dev`；端口取 `.env` 的 `PORT`（本机 **3000**）；**8000~9000 段为 Windows 保留段、不可用**。
- Bash 须前置 `export PATH=/c/Users/A/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Windows/System32:$PATH`，否则 `head`/`dirname` not found。
- **PowerShell 工具只回退出码不回 stdout** ⇒ 读输出用 Bash。**`ROADMAP.md` 一律用 Read/Grep，禁 `sed`/`head`/`cut`**（中文乱码）。
- 🔴 **`agent-browser` 在本机不可用** ⇒ 前端验收**禁把「浏览器截图」写进验收路径**；改用真实 tRPC 取数 + React-free 纯函数复用 + adapter 往返 + 真实 DB 校验。
- 🔴 **时区**：库中时间戳是 **UTC 墙钟**、`executionLogJson` 内却是 **ISO 带 Z**（同表两套、差 8h）⇒ **写时间戳传字符串字面量**（不传 `Date`），读用 `DATE_FORMAT(...)` 取原始串自行换算。

## 总控（强制）
- `ROADMAP.md` = 唯一 Master Control：§44 真实状态（**覆盖式**）+ §44.5 队列 + §47 更新记录（**append-only** + 时间戳）。每任务完成必须更新三者并定下一任务。
- 7 态 `DESIGN / CODE_READY / DATA_READY / VALIDATED / RESEARCH_READY / PRODUCTION_READY / BLOCKED`；**只有 `RESEARCH_READY=TRUE` 才允许正式策略结论**（代码存在 ≠ VALIDATED，测试通过 ≠ Research Ready）。
- ⚠️ **同一文件禁同批次并发多个 Edit**（静默丢改动）；本仓库**常有并行会话** ⇒ 唯一锚点 + 单次 Edit，且**不得混淆并行会话的改动归属**（判据 `find -newermt`）。
- 命名（§49）：模块/文件/目录**禁带 STEP/C-task 编号或数字后缀**，纯语义小驼峰；命名前先全库查重。

## 铁律与红线
- 优先级：正确性 > 数据真实性 > PIT > 可复现性 > 架构完整性 > 测试 > 速度；证据 **真实 DB > 运行结果 > 代码 > 测试 > 文档 > 假设**；**禁 mock 冒充真实数据**。PIT：asOf 只看 T 时刻已知；历史池不得用当前列表回填。
- 🔴 **跨模块唯一 Dataset 坐标 = `datasetVersionId = dataset_version.id`**（`datasetVersion` 只是显示 label）⇒ **禁第二套 ID**、禁复制 Registry 版本表、禁绕 Registry 直读 `ds_*`、禁按 name/版本串比对。
- 🔴 **Strategy 唯一 Canonical SoT = `strategy_versions.strategyDocumentJson`**（内含 `definition`）；5 张投影**单向派生**、**禁反向生成**、漂移**绝不自动修复**。
- 🔴 **涨停价必须四舍五入到分**（`server/data/boardRules.ts`），比例 **PIT 感知**（ST=5%）；**窗口左边界必须预热**，否则连板误判首板。
- 🔴 **项目零数据库 FK**：跨模块引用一律不加 FK，完整性靠应用层 + 事务（校验─提交间**残留窗口已在注释登记**）。
- 🔴 **Migration**：`drizzle/schema.ts`（唯一权威）→ 手写 `drizzle/NNNN_<semantic>.sql` → 幂等 `scripts/applyXxx.mjs` + `information_schema` 断言 → 实跑取证据。**声明 ≠ 线上真实 ⇒ 约束/列是否存在必须查真实库**。
- 🔴 **Research → Strategy 桥已建成到「库 + 领域层」**（006.1 = DATA_READY）：`research_strategy_candidate` +4 个 `source*` 列 + 新表 `strategy_research_provenance`（**Strategy 侧 display-only 独立切面、零 FK 快照值；禁加进 `strategy_versions` / `StrategyDocument`**）；**唯一桥目录 = `server/research/strategyCandidate/`**（`importBoundary.test.ts` 守护「只有它可同时 import 两侧」）。**业务线路仍未接**（`createFromConclusion` / `promote` / 前端 = 不存在）。设计见 `docs/research/RESEARCH-006.0-architecture.md`（方案 C：Candidate 即 Draft，不建 `strategy_drafts`）；细则见 `PROJECT_RULES.md`「跨模块坐标」。
- ⚠️ 既有测试失败基线（**禁为过测试改快照或期望**）：`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`（15 例 / 7 文件，全为环境依赖）。- ⚠️ **STEP 编号会撞车**：`RESEARCH-006/007/008` 已被 §47 的结果可读性前端任务占用 ⇒ 架构线用 `.0/.1/…` 子号区分。
