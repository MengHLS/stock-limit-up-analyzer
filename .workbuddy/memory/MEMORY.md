# stock-limit-up-analyzer 硬禁令索引

> 动手前必读 `PROJECT_RULES.md`（细则以它为准）：禁令速查 + 本机环境坑。

## 三门
1. 先读 `PROJECT_RULES.md`「启动与本机环境」。
2. 🔴 改 `server/**` 会热重启并**杀死在途 Run** ⇒ 用户在用页面时禁改 server、禁跑重库脚本（在途判据 `_probe_inflight_state.mts`）；改 `client/**` 只走 HMR。
3. 🔴 禁 `pnpm/npm install`、新增依赖、`prettier --write`、`db:push`、`drizzle-kit generate`、手写 `_journal.json`。

## 本机环境坑
- 🔴 端口只认启动日志（3000 正常绑定；旧「保留段 ⇒ 回落 3100/3101」不成立）。LAN `192.168.6.21`。
- 🔴 Bash 须自带长 PATH：git 在 `PortableGit/versions/1.2.0/cmd`、Unix 工具在**同版本 `usr/bin`**，缺一即 `command not found`。PowerShell 可用但 stdout 不回显 ⇒ 写文件再读。
- 🔴 `node -e` / `git` **不认 MSYS `/c/...` 路径**（解析成 `D:\c\...`）⇒ 传 `C:/...`。
- 🔴 后台服务用 `run_in_background=true`，末尾**禁 `&`**（`nohup &` 随会话回收 ⇒ 假「没起来」）。
- 🔴 **git 写入可能被外部回滚**（实测：`.git/refs` 目录会消失、会话内 loose 对象全丢；`fetch`/`update-ref` 打印成功但 ref 不落地）⇒ **每次 git 操作后复核 `git rev-parse HEAD` + `git cat-file -e <sha>`**；见 `bad object HEAD` 立即停手、先复制工作区到仓库外。另：`refs/remotes/origin/*` 每次 `git push` 后必被清掉 ⇒ 远端跟踪值写进 **`packed-refs`**（持久层，实测存活）；真值以 `git ls-remote` 为准。
- 🔴 **工作区有并发会话/快照同步在动文件**（非「自发」）：实测抹掉 `server/**` **522 个**（dev 崩 `ERR_MODULE_NOT_FOUND`、3000 掉线），同期**他会话探针文件凭空出现**、`.git/refs` 反复消失⇒ 判据 `find server -type f | wc -l` ≈ **565**（2026-09-17 实测；会随新增文件增长，关键判据是「没有批量减少」）；恢复 `git restore --worktree -- server/`；**操作后立即复查文件数 + 状态 + 有无他会话新文件**。
- 🔴 改文件用 Python `read_bytes()`+`write_bytes()`，**先 `encode()` 再打开 + `os.replace` 原子替换**（否则抛错清成 **0 B**），改完回读核对（`Edit` 曾静默不生效）。
- 🔴 源码字面量禁 `\uXXXX` 代理转义（⇒ `compile()` 抛 `UnicodeEncodeError`，零输出即死）；emoji 写字面量；模板字符串内禁嵌反引号。
- 🔴 行数组手术：锚点须**连续行块**；`.tsx`/总控改完 `git diff --stat` 断言增删数，错了 `git checkout --` 复位重跑。
- 🔴 **判行尾禁用 `grep -c $'\r'`**（2026-09-17 实测：4 个**纯 LF** 文件被它全报成「每行都有 CR」）⇒ 只认 Python `b.count(b"\r\n")` vs `b.count(b"\n")`。
- 🔴 探针放 `docs/evidence/`（不在 tsconfig scope）；测试 = `tests/`，**基线 7 文件失败**，判据 = **失败文件集合**。
- ✅ dev 首屏慢已修（`vite.config.ts` 删 manus 插件 + `optimizeDeps.include`；`server/_core/vite.ts` 预热须先 `await depsOptimizer.init()`）。
- ✅ 前端验收 = 无头 Chrome/Edge `--headless=new --user-data-dir=<tmp> --remote-debugging-port=<随机>` + Node 22 内置 `WebSocket` 直连 CDP；量 DOM 比截图硬；`taskkill /F /T`。⚠️ 探针输出**必须同步落盘**（异步 pipe 被杀时未 flush ⇒ 空 stdout）。`agent-browser`/`jsdom` 不可用。

## 行尾（**逐文件实测，禁推断**；仓库本地 `core.autocrlf=false`）
- 🔴 **CRLF 只有 3 个**：`.workbuddy/memory/PROJECT_RULES.md`、`client/src/App.tsx`、`client/src/components/AppShell.tsx`；**其余全是纯 LF**（含 `ROADMAP.md`、`ROADMAP-CHANGELOG.md`、`README.MD`、`drizzle/schema.ts`、`client/**` 其余 200 个、`server/**`、`docs/**`、`tests/**`、`scripts/**`、`MEMORY.md`、逐日日志、`index.css`）。判据 = `count(b"\r\n")` vs `count(b"\n")` **现场实测，禁按文件名推断**。⚠️ 曾两个方向都错过（先「全仓纯 LF」、后「`client/src/**/*.tsx` 全 CRLF」）⇒ 只认实测。
- `core.autocrlf=false` 在 `.git/config`（系统级 gitconfig 仍 `true`，**勿改**）⇒ 工作区行尾 = 磁盘真身。⚠️ **HEAD blob 内部仍 LF** ⇒ 恢复用 `git cat-file -p <rev>:<path>`；单向：被洗过的文件不自愈。

## 总控
- `ROADMAP.md` 唯一 Master Control（§44 覆盖式 + §44.5 + §47 append-only）；**仅 `RESEARCH_READY=TRUE` 才允许策略结论**。
- 🔴 禁同批次并发多 Edit ⇒ 唯一锚点 + 单次 Edit + grep 断言。
- 🔴 §44.5 取号真源 = `ROADMAP.md`「编号台账」行（**已用至 `9bc` ⇒ 下一个 `9bd`**），禁「末条 +1」；§44「上轮实查」每轮保留 ⇒ 只插入、条目单行。

## 坐标与根因
- Dataset 坐标 = `dataset_version.id`；Strategy SoT = `strategy_versions.strategyDocumentJson`；**零 FK**；`promote` 是唯一 `CONVERTED` 入口。
- 🔴 「条件进不了回测」是**架构性的**：`assemble.ts` 只看 `recipeId` ⇒ 正路 = `recipeRegistry.ts` 注册配方 + 草稿带 `recipeId`。

## 运行工作台 / 留档 / 成交明细
- 🔴 直读桥 = `runWorkbenchAssembly/datasetFromRegistry.ts`（**禁第二套实现**）；决策日资格 = `rd ∈ [obs.start, obs.end]`；窗口**只认策略声明**（缺/非法/超 post 容量一律抛错）。
- 🔴 `securityId` = canonical `sec_<uuid>`（`engineKeyBridge` 逐事件按自身 `tradeDate` 桥接）；**板块判定用 `row.code`**；成交明细名称走 `researchRun.securityLabels`（解析用 `normalizeSecurityCode`）。
- 🔴 回落重建必须继承数据集 universe 约束，抛 `UniverseConstraintError`（错用 `RegistryDatasetBridgeError` 会被吞 ⇒ 静默全市场）。
- 🔴 `loopRun` 自动留档 `closed_loop_backtest_run`（`runId` 幂等，`/backtest-runs`），与 legacy `backtest_runs` **不同表、禁互灌**；策略页结果只在内存 ⇒ 已从留档恢复，**空态禁谎称「还没跑过」**。
- 🔴 `loopRun`：`dateRange` 必填；`experimentId` 须 `EXP-YYYYMMDD-XXXXXXXX`；14 阶段仅 6 有执行器；同步长请求。

## 前向纸面 `/paper-trading` / 指数同步 `/stock-sync`
- 🔴 交易日历**唯一来源 = `index_daily`**（停更 ⇒ `datesToAdvance` 恒空、**静默 no-op 却报成功**；补数**必须 `--force`**）。入口 `sentiment.getIndexSyncStatus`/`syncIndexDaily`。
- 🔴 **齐平判定必须传 `referenceDate`**（= `stock_daily_prices` 最大 `tradeDate`），否则 30 天容差会把「落后恰好 1 个交易日」判成已齐平。
- 🔴 `classifyAdvanceKind` 三态 `advanced`/`already-latest`/`calendar-stale`，判据 = `marketLastDate > calendarLastDate`；越界抛 `PaperTradingCalendarStaleError`（码须写进 message 才跨 tRPC）；前端按 `diagnosis` 分流。

## 「某天为何不出现」（详版见 `PROJECT_RULES.md`）
- 🔴 三条链互不相干：**前向纸面**（`index_daily` + `paper_trading_runs.lastProcessedDate`）／**组合回测**（读数据集，留档 `datasetSource` = `registry`|`rebuild`）／**legacy `/backtest`**（信号 = `limit_up_records`）。
- 🔴 四环节缺一即不出：① 日历末端 ≥ 目标日 → ② bar/`ds_*` 覆盖 → ③ 数据集窗口含目标日（**仅 registry 路径**，越界 FAIL FAST `SIM_RANGE_OUT_OF_DATASET`）→ ④ 已推进。⚠️ 装配层不校验窗口（`assemble.ts:481/496`）。
- 🔴 数据集窗口取**两上限小者**（390002 ⇒ 有效 09-01）；越过后须**重建数据集 + 重绑策略**。legacy 可回测末日 = 日历倒数第 (obs+1) 个交易日；看当天候选池用 `/leader-candidates`。
- 🔴 `stock_daily_prices` **不是全市场快照**（近端每日仅 400~600 只）⇒ **先问「这天是不是候选池日」，别判同步故障**；DB 时区 = UTC（+8 才是北京时）。
- ⚠️ 留档 `startDate/endDate` 为用户当时所选。探针 `_probe_today_gap.mts`／`_probe_dataset_vs_today.mts`／`_probe_assemble_window_bounds.mts`。

## 页面 / 口径 / 暗色 / 侧栏 / 主题
- 🔴 **组合回测 `/backtest`「交易明细」页签分仓口径分段生效（两套模拟器并存）**：① 快照面板（当前持仓 / 准备买入 / 全部模拟订单 / 策略对比 / 风险归因）来自 **research-legacy 交易模拟器**，**完整套用分仓下拉**，口径唯一权威 = `server/positionBudget.ts#allocatePlannedBudgets`（等权 = 现金 ÷ 笔数）；② 顶层 `realisticSimulation`（回测总览「资金与仓位审计」）来自 **生产 Strategy Engine**，**每笔固定 100 股**（`runBacktestWithRisk` 未注入 PositionSizer ⇒ `engine.ts:117` 取 `signal.quantity` = `LEADER_CANDIDATE_PRODUCTION_REQUESTED_QUANTITY`），**不读分仓下拉**（`assumptions.positionSizingStrategy` 仅回显，源码自陈见 `leaderCandidateStrategyBacktest.ts:80`）。实证：生产核心快照 1232 笔成交 `shares` **全 = 100**；同页 legacy 段同一标的股数随策略变化（100/2200/3100/3200/3700）。⚠️ 两段**非等价**（`server/research/engineNonEquivalence.test.ts` 已固定），页面已加 `[data-portfolio-provenance]` 徽标如实标注。
- 🔴 **「准备买入」显示 100% 不是算错**（2026-09-17 复核）：等权 = **可用现金 ÷ 本批笔数**（`positionBudget.ts:59` ≡ `realisticBacktest.ts:419-430`）⇒ 当日**只有 1 只入选就必然吃掉 100% 可用现金**；评分加权单笔时也退化为此。**固定单笔比例 = 初始资金 × 20%**（`positionBudget.ts:58`，**与权益增长脱钩**）⇒ 真机 ¥20,000/笔，仅当前权益 2.69%，**它才是「每笔恒定比例」**。**系统内不存在「权益 ÷ maxPositions」口径**，该语义只能以「单标的上限」引入；**用户已明确不设上限 ⇒ 禁自行加 cap**。影响面：745 个决策日里 **384 天只有 1 只候选**，2019–2024 日均候选 **1.2–1.8 只**（等权 ≈ 满仓单票），2025 起才变密。探针 `_probe_position_sizing_caliber.mts`（喂真机数字复算三口径，5 断言）。
- ⚠️ 若改分仓口径，会**重算全部历史回测数值**（研究段 selectPenaltyWeight / tradeQuality / 归因都依赖它）⇒ 必先经用户授权。
- 🔴 **比例只在表格里（禁回独立段落）**：当前持仓表 = 成本金额 / 持仓市值 / 占总权益 + `tfoot` 合计（分母 = **同一模拟器同一截止日的 `finalCapital`**；真机验证**资金恒等式 `现金 + 持仓市值 = 总权益` 偏差 0.000%**）；准备买入表 = 计划仓位 / 预算上限列 + 合计行（回显口径与「股数待次日开盘价确定」）。钩子 `[data-planned-position-sizing]` / `[data-planned-position-chips]` **已删**（探针含反证断言）。探针 `_probe_planned_position_render.mjs`（18 断言，五策略逐个切换）。
- ⚠️ **待收敛**：`server/paperTrading.ts:374-386` 内联了**第二份**与 `positionBudget` 逐字等价的分配实现（前向纸面**生效**）⇒ 违反「唯一权威实现」，须在用户不用页面时收敛（改 `server/**` 会热重启杀在途 Run）。
- 🔴 **侧栏高亮 = 分段精确匹配 + 全局取最长命中**（`AppShell.tsx#isPathActive`；**禁 `startsWith`**）；详情页仍点亮父项。探针 `docs/evidence/_probe_sidebar_active_highlight.mjs`。
- 🔴 **主题语义**：`localStorage["theme"]` 显式值优先，否则跟随设备 `prefers-color-scheme`（`client/index.html` 内联脚本防闪白）；**点一次切换按钮即写死偏好** ⇒ 报「设备暗色没生效」先查该键。探针 `_probe_theme_autoload.mjs`。
- 策略页分家 `/strategies` + `/strategies/:strategyId`（新建草稿须清空 `strategyId`）；规则编辑 = 七段表单（**JSON 模式已删**），有 `definition` 时禁回送五个 v1 视图（`SCHEMA_DEFINITION_VIEW_CONFLICT`）。
- 🔴 运算符两形：定义侧**名称形**（`GREATER_THAN_OR_EQUAL`）vs 草图**符号形**（`>=`），只在 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 译。换数据集**同动三处**：doc 坐标 + `definition.datasets` PRIMARY + `universe.universeId`。
- 🔴 门槛型条件必须 `gated` 配方；`signalBuilder` 是工厂 ⇒ **先 `resolveParameters`**；禁手搓 `row.bars`。`client/**` 禁 import `server/**`/`shared/**` 运行时值；免责声明不得删；`RESEARCH_READY` 不因「结果可看」变 TRUE。
- 🔴 性能只认「**交错 ≥3 轮取中位**」；真实列名**禁凭记忆**写 SQL；「全端点 DB 失败 + 零 DB 正常」⇒ 先查池。
- 🔴 **暗色兼容层**：`client/src/theme/darkCompatibility.css` 是**生成物禁手改**（`scripts/generateDarkCompatibility.mjs`）；**新增 Tailwind 颜色类必须重跑生成器**。令牌在 `client/src/index.css` 的 `.dark`；抗刺眼靠 `color-mix(in oklab, …)` 压低色度。

- 🔴 **标签页图标 = 侧栏 Logo 的生成物** `client/public/favicon.svg`（生成器 `docs/evidence/_gen_favicon_svg.mts`，**禁手改**；位图由 `_gen_favicon_assets.mjs` 经无头 Chrome 栅格化）；两个坑：**XML 注释内禁出现连续两个短横线**（否则整份 SVG 非法 ⇒ 图标不显示）；**CSS 渐变按 oklab 插值而 SVG 只能 sRGB** ⇒ 只给端点两色标中调偏 12/255，须多色标折线逼近。探针 `_probe_favicon_render.mjs`；⚠️ **对拍必须先设日间 `prefers-color-scheme`**（夜间被兼容层压色，差异是主题的、不是图标的）。

## 大盘数据同步（成交额/两融，`/market`）
- 🔴 `market_data` 一行两列（`turnover` + `marginBalance` 均 NOT NULL）⇒ **只能整行写**，两融取不到就整天不写（禁占位值）。已修：按「窗口内缺失交易日」升序补齐、北京时 08:30/12:30、日历 = `index_daily` ∪ `limit_up_records`。
- 🔴 「最新交易日两融尚缺」≠ 故障（交易所发布滞后）；判据 = `getSyncStatus.pendingDates`（**>1 个才是缺口**），禁用 `hasTodayData`。探针 `_probe_market_data_gap.mts`／`_run_market_sync_backfill.mts`／`_probe_market_page_render.mjs`。
