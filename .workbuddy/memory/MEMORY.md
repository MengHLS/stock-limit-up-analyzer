# stock-limit-up-analyzer 硬禁令索引

> 细则见 `.workbuddy/memory/PROJECT_RULES.md`（动手前必读；⚠️ **该文件纯 CRLF**，本文件与逐日日志纯 LF）。

## 三门
1. 先读 `PROJECT_RULES.md`「启动与本机环境」。
2. 🔴 改 `server/**` 会热重启、**杀死在途 Run** ⇒ 用户在用页面时禁改 server、禁跑重库脚本；先查在途（`_probe_inflight_state.mts`）。
3. 🔴 禁 `pnpm/npm install`、新增依赖、`prettier --write`、`db:push`/`drizzle-kit generate`、手写 `_journal.json`。

## 环境（工具坑）
- 🔴 端口只认启动日志：本机 **3000 落在 Windows 保留段 `2980–3079`**（`EACCES` 非忙）⇒ dev 静默回落 3100/3101；读输出须 Bash + 长 PATH。
- 🔴 行尾**逐文件实测**（`count(b"\r\n")` vs `count(b"\n")`），禁推断：`ROADMAP*.md`、`drizzle/schema.ts`、`client/src/**/*.tsx`、`tests/**/*.ts`、**`PROJECT_RULES.md`** 为 **CRLF**；`MEMORY.md`、逐日日志、`docs/evidence/*`、`server/**` 为 **LF**。改法 = `splitlines(keepends=True)` + 写前写后各断言 CRLF 计数。
- 🔴 改文件用 Python `read_bytes()`+`write_bytes()`（`read_text` 静默把 CRLF 转 LF）；🔴 `Edit` 曾静默不生效 ⇒ 改完回读 / `grep -c` 核对。
- 🔴 落盘「先编码后打开」+ 原子替换：`data = text.encode("utf-8")` → 写 `p + ".tmp-write"` → `os.replace`（若先 `open(p,"wb")` 再 encode，抛错会把文件清成 **0 B**）。
- 🔴 源码字面量禁 `\uXXXX` 代理转义（Python 不合并分离代理对 ⇒ `compile()` 抛 `UnicodeEncodeError`，脚本**零输出即死**）；**emoji 一律写字面量**；⚠️ 字节探测查不出，须 `compile()` 后遍历 `co_consts`。⚠️ **模板字符串内禁再嵌反引号**（会提前闭合模板）。
- 🔴 恢复文件内容用 `git cat-file -p <rev>:<path>`（**不过 smudge 过滤器**）；`git checkout --` 按 `core.autocrlf` 还原成 CRLF，对 LF 目标文件等于整文件重写。
- 🔴 改 `.tsx` / 总控走「行数组手术 + 断言」，禁手抄超长行：锚点**必须是连续行块**（首尾拼接非子串，`str.count` 为 0）；删 JSX 后必回读 + `git diff --stat` 断言增删数，错了 `git checkout --` 复位重跑（改前先确认那次 `M` 是自己）。
- ✅ 前端真实渲染可进验收（旧「禁浏览器截图」作废，细则见 `PROJECT_RULES.md`「前端」段）：Edge `--headless=new --no-proxy-server --user-data-dir=<tmp> --remote-debugging-port=N` + Node 22 内置 `WebSocket` 直连 CDP，**量 DOM 计数 / `innerText` 比截图硬**；`agent-browser` 不可用、无 `jsdom`。⚠️ 端口须随机 + `taskkill /F /T` 杀整棵进程树（残留子进程会劫持新实例 ⇒ 全项假失败）。
- 🔴 探针 = `docs/evidence/`（不进 tsc/vitest）；项目根执行；长跑后台 + 重定向日志；清理判据绑「可识别命名域」、不绑 `runId`。
- ⚠️ 测试 = `tests/`；**基线 = 7 文件失败**，判据是**失败文件集合**。

## 总控
- `ROADMAP.md` 唯一 Master Control（§44 覆盖式 + §44.5 + 附录 append-only）；**仅 `RESEARCH_READY=TRUE` 才允许策略结论**；改用**带断言的脚本**。
- 🔴 禁同批次并发多 Edit ⇒ 唯一锚点 + 单次 Edit，写后 grep 断言标记。
- 🔴 **§44.5 编号按「下一个未占用」（已用到 `9ao`），禁「末条 +1」**；§44「上轮实查：」**每轮都保留** ⇒ **只插入**，条目**单行**。

## 坐标与根因
- Dataset 坐标 = `dataset_version.id`；Strategy SoT = `strategy_versions.strategyDocumentJson`；**零 FK**。
- Research→Strategy 桥 = `strategyCandidate/`；**`promote` 是唯一 `CONVERTED` 入口**。
- 🔴 **「条件进不了回测」是架构性的**：`assemble.ts` 不看 `entryRules`（只看 `recipeId`）⇒ 正路 = `recipeRegistry.ts` 注册配方 + 草稿带 `recipeId`。

## 运行工作台 / 留档 / 成交明细
- 直读桥 = `runWorkbenchAssembly/datasetFromRegistry.ts`（**禁第二套实现**）。✅ **已能撮合、回落不再常态**：投影 `rd=0`（特征基准）+ `rd ∈ [1, obs.end+1]`（观察日 + 次日执行日）；🔴 **决策日资格 = `rd ∈ [obs.start, obs.end]`**；窗口**只认策略声明**（缺/非法/超 post 容量一律抛错）。
- 🔴 直读桥 `securityId` = canonical **`sec_<uuid>`**（`engineKeyBridge#resolveSecurityIdByEngineKey` **逐事件按自身 `tradeDate`** 桥接，处理 code reuse），`code` 才是代码 —— `ds_*` 只有 `symbol`；**板块判定一律用 `row.code`**。
- 🔴 **回落重建必须继承数据集 universe 约束**（`boards`/`excludeSt`）：错用 `UniverseConstraintError`（**非** `RegistryDatasetBridgeError`，否则被吞 ⇒ 静默全市场）；前端 `classifyRebuildScope`=`unknown` 提示重跑。
- ✅ `loopRun` 每次**自动留档**到 `closed_loop_backtest_run`（best-effort 不阻断；`runId` 幂等），页 `/backtest-runs`。🔴 与 legacy `backtest_runs` **不同表、禁互灌**；**列表不读 `resultJson`**。
- 🔴 策略页结果**只在 React 内存** ⇒ 重载即丢；现已**从留档恢复该策略最近一次**（复用同一 VM + 面板），优先级「本次 > 恢复 > 明说 > 空态」；**空态禁谎称「还没跑过」**。
- 🔴 `loopRun`：`dateRange` 必填；`experimentId` 须 `EXP-YYYYMMDD-XXXXXXXX`；**14 阶段仅 6 有执行器**；**同步长请求**。
- 🔴 成交明细键 = **`sec_<uuid>`（非代码）** ⇒ 名称走 `researchRun.securityLabels`（覆盖 62.9%、缺口显「—」）；解析**必用 `normalizeSecurityCode`**。

## 前向纸面交易（`/paper-trading`）与指数同步（`/stock-sync`）
- 🔴 推进（含回测）交易日历**唯一来源 = `index_daily`**（与候选价格行**刻意解耦**）；2026-09-15 起可在 `/stock-sync` 同步，此前**只有 CLI `scripts/backfillIndex.ts`** 一条写入路径（`indexProviders` 在生产代码**零消费**）⇒ 停更即 **`datesToAdvance` 恒空 ⇒ 静默 no-op 却报成功**。补数**必须 `--force`**（`isCoverageFresh` 容忍末端差 ≤ 30 天 ⇒ 默认误判「已覆盖」）。
- ✅ 页面入口（`INDEX-SYNC-PAGE-001`）：`sentiment.getIndexSyncStatus`（public 只读）/ `sentiment.syncIndexDaily`（admin）；服务层 `server/marketData/indexSync.ts`。沿用 4 只（`000001.SH`/`399001.SZ`/`000300.SH`/`000905.SH`），默认 tushare（配额 **5 次/天 + 1 次/分钟**，逐只 65s）⇒ 省配额靠**智能增量**（已齐平 0 请求；仅末端落后只补 `[末日+1, end]`）。
- 🔴 **齐平判定必须传 `referenceDate`**（= 行情末端 `stock_daily_prices` 最大 `tradeDate`，必为真实交易日）：只按 30 天自然日容差会把「**落后恰好 1 个交易日**」判成「已齐平」⇒ 页面「落后告警」与「本次计划跳空」自相矛盾。
- 🔴 三态诊断 `paperTrading.ts#classifyAdvanceKind`：`advanced` / `already-latest` / `calendar-stale`，判据 = **`marketLastDate > calendarLastDate`**（**参照物必须是行情末端**）。建运行越界锚点抛 `PaperTradingCalendarStaleError`，码**须写进 message** 才跨 tRPC；前端按 `diagnosis` **分流 toast**，禁一律报成功。

## 数据覆盖与「某天为何不出现」判据链
> 详版（三条链分工 / 边界分叉 / 探针清单）见 `PROJECT_RULES.md`「『某天为何不出现』三条链分工 × 组合回测边界分叉 × legacy 回测末日」。本节只留判据。
- 🔴 **三条链互不相干**：**前向纸面**（日历 = `index_daily`，进度 = `paper_trading_runs.lastProcessedDate`，**补日历不自动推进**）／**组合回测**（读**数据集**，留档 `closed_loop_backtest_run.datasetSource` 记 `registry`|`rebuild`，**不用推算**）／**legacy `/backtest`**（信号 = `limit_up_records`，**与数据集无关**）。
- 🔴 **四环节判据链（缺一即不出）**：① 日历末端 ≥ 目标日 → ② bar / `ds_*` 覆盖含目标日 → ③ **数据集窗口**含目标日（**仅 `registry` 直读路径**：`handle` 窗口 = `dataset_version.startDate/endDate`，`datasetFromRegistry.ts:1046-1047` ⇒ 越界 **FAIL FAST** `SIM_RANGE_OUT_OF_DATASET`（`session.ts:52-57` / `engine.ts:303-312`）；`rebuild` 用用户窗口 ⇒ 不可能越界）→ ④ 已推进到目标日。⚠️ **装配层不校验窗口**（`assemble.ts:481 / 496`，别在这层找边界）。
- 🔴 **数据集窗口两个上限取小者**：390002 声明 `2024-09-01~2026-09-01`（内容 post max 09-04）⇒ **有效上限 = 09-01**；活跃策略全绑它 ⇒ `cand-*` 被卡（唯一例外 `limit-up-baseline` ⇒ `REGISTRY_OBSERVATION_WINDOW_UNDECLARED` ⇒ 回落 rebuild）；UI 无 `datasetSourcePolicy` ⇒ **跑到 09-01 之后必须重建数据集 + 重绑策略**。
- 🔴 **legacy `/backtest` 可回测末日 = 日历倒数第 (obs+1) 个交易日**：`leaderCandidates.ts:951-958` 的 `if (!nextDate) continue` 主动排除「最后 obs 个交易日缺完整 T+1 观察」⇒ **当天必然缺席，与数据同步无关**；看**当天**候选池用 `/leader-candidates`（`buildLeaderCandidatesResult`）。
- 🔴 **`stock_daily_prices` 不是全市场快照**：`stockPriceSync.ts` 按「涨停记录 × 信号日 + `futureTradingDayCount=10` 观察窗」增量 ⇒ 近端每日仅 **400~600 只**，全市场只到 2026-09-04 及以前（~5,540 只/日）。⇒ **先问「这天是不是候选池日」，别判同步故障**。
- 🔴 **DB 时区 = UTC**（`@@system_time_zone` = `UTC`）⇒ `createdAt`/`retrievedAt`/`sourceUpdatedAt` **+8 才是北京时**（易把盘后 18:30 误判成盘中快照）。
- ⚠️ 留档 `startDate/endDate` = **用户当时选的区间** ⇒ 若 `endDate` 早于目标日，与数据集 / 行情**全都无关**，先看这条。
- 🔧 真库只读探针：`_probe_today_gap.mts`（四环节 + 涨停记录末端 + **legacy 信号日资格**）；`_probe_dataset_vs_today.mts`（声明窗口 vs 内容 + 策略走向表）；`_probe_assemble_window_bounds.mts`（装配 / 会话分层实证，~11s/例）。

## 页面与口径（→ 细则）
- 策略页分家 `/strategies` + `/strategies/:strategyId`；**新建草稿须清空 `strategyId`**。
- 🔴 规则编辑 = 「策略定义」七段表单；**JSON 模式已删**。有 `definition` 时**禁回送五个 v1 视图**（否则 `SCHEMA_DEFINITION_VIEW_CONFLICT`）。
- 🔴 **运算符两形**：定义侧**名称形**（`GREATER_THAN_OR_EQUAL`）vs 草图**符号形**（`>=`），只在 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 译。
- 🔴 换数据集**同动三处**：doc 级坐标 + `definition.datasets` PRIMARY 绑定 + `universe.universeId`。
- 🔴 **门槛型条件必须 `gated` 配方**；`signalBuilder` 是工厂 ⇒ **先 `resolveParameters`**；**禁手搓 `row.bars`**。
- 🔴 `client/**` 禁 import `server/**`/`shared/**` **运行时值** ⇒ 镜像词表用「本地常量 + 表比对测试」。免责声明不得删；`RESEARCH_READY` 不因「结果可看」变 TRUE。
- 🔴 性能只认「**交错 ≥3 轮取中位**」；「**热调用 ≈0ms**」才是缓存判据。「**全端点 DB 失败 + 零 DB 端点正常**」⇒ **先查池**。真实列名**禁凭记忆**写 SQL。
