# stock-limit-up-analyzer 硬禁令索引

> **压缩索引**；🔴 **唯一细则源 = `.workbuddy/memory/PROJECT_RULES.md`**（194 KB，末章「MEMORY.md 原文下移」保有旧全文）。动手前读本文 + 当日日报，再按章名 grep。

## 三门（违反即事故）
1. 🔴 改 `server/**` ⇒ `tsx watch` 热重启并**杀死在途 Run**（在途 = `RUNNING`；`PENDING` + 空 `inputSnapshot` 的草稿**禁收敛**）⇒ 用户在用页面时禁改 server、禁跑重库脚本。改 `client/**` 只走 HMR。
2. 🔴 禁 `install` / 新依赖 / `prettier --write` / `db:push` / `drizzle-kit generate` / 手写 `_journal.json`。
3. 🔴 **同一文件的多处编辑必须串行** —— 并行两个 `Edit` ⇒ 后写覆盖先写、前者**静默丢失**。

## 环境 / 工具
- 端口只认启动日志（常被占 ⇒ 实测过 3000/4000/4001/4002；残留无头 Chrome 会「TCP 通但 fetch 失败」）；探端点用 Node `fetch` / `curl`。
- 沙箱 Bash 缺 coreutils ⇒ 命令前置 `export PATH=/c/Users/A/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Windows/System32:$PATH`；`git`/`node` 不认 `/c/...` ⇒ 传 `C:/...`；Win stdout 常不返回 ⇒ 落盘用 Python 读。
- 🔴 **长任务输出禁接管道**（EPIPE ⇒ 脚本中止并清空自身留档）；后台用 `run_in_background` + 读 `.out.txt`。
- 🔴 改文件 = Python bytes + `os.replace` + 回读；裸 `str.replace` 必须 `assert count==1`（否则静默 no-op）。测试基线 = **8 失败文件 / 17 用例**（判据 = 失败**文件集合**，先剥 ANSI 颜色码）。
- 🔴 行尾唯一依据 = **HEAD blob**（`git hash-object` ≠ `git rev-parse HEAD:<f>` 而 `git diff-files` 为空 ⇒ 漂移看不见）。改前改后都跑 `scripts/checkEolDrift.mjs`（`--fix` 按 HEAD 归一化）。已确认 CRLF：`PROJECT_RULES.md`、`.gitignore`；其余含 `ROADMAP.md`/`MEMORY.md`/`client|server|docs|tests|scripts/**` 为 LF。⚠️ 读 CRLF 文件须 `open(..., newline="")`；写探针/JSON 一律 `"wb"`。
- ✅ 前端验收 = 无头 Chrome/Edge + Node `WebSocket` 直连 CDP **量 DOM**（`agent-browser` 本机不可用）；端口**实测空闲**、输出**必须落盘**。
- one-off 脚本写仓外 `C:\work\sourcecode\_scratch\`（Windows 绝对路径）；报告 `docs/research/`、探针 `docs/evidence/`（须登记 `README.md`，且**只准** `.mts/.mjs/.log/.json/.md/.txt`，收尾 `ls docs/evidence/*.py` 应为空）。🔴 `client/**` 只禁 import `server/**` **运行时值**；`@shared/*` 允许。

## 总控
- `ROADMAP.md` 唯一 Master Control（§44 覆盖式：**只保留最近 1 条**；§44.5 队列；§47 append-only → 写 `ROADMAP-CHANGELOG.md`）；仅 `RESEARCH_READY=TRUE` 允许策略结论。
- 🔴 取号真源 = 「编号台账」行（**禁「末条 +1」**，禁凭记忆）；**文件头铁律行 + 台账行两处同步**；**取号前先对远端**。⚠️ 并行会话会推进台账。**「完成一条已登记项」不取新号**，就地改完成态。
- 🔴 分叉合流：`ls-remote` → `fetch` → `merge --no-ff`；文档冲突**两侧都保留**；丢文件 `git ls-files -d -z | xargs -0 git checkout --`。

## 领域口径（最易踩）
1. 评估端口 = `server/research/strategyEvaluation/`（唯一），主输出字段 **`evaluation`**；**`dataReady: true` 必须显式传**（`runAudit.ts:74` 缺省 false ⇒ 否则 `INCONCLUSIVE`）。
2. 交易日历唯一来源 = `index_daily`（**停更 ⇒ 静默 no-op 却报成功**，补数须 `--force`）。
3. `/backtest` **并存两套交易语义**（快照 = 等权；顶层 = 固定 100 股）⇒ **禁加 cap**。
4. **止损三落点互不相通**（`realisticBacktest.ts` / `paperTrading.ts` / `server/engine/**` **完全不执行**）。
- 事项闭环：`todo_delegate_status = idle` ⇒ 无 dispatch id ⇒ 用 `todo_add_comment`+`todo_transition`。

## 页面
- 🔴 侧栏高亮 = **分段精确匹配 + 取最长命中**（`AppShell.tsx#isPathActive`，禁 `startsWith`，详情页点亮父项）。**首页 `/` 入口 = 左上角网站标题**（锚点 `data-slot="sidebar-home-link"`）⇒ 站在 `/` 侧栏**零高亮**。探针 `_probe_sidebar_active_highlight.mjs`。
- 🔴 首页 = `client/src/pages/Dashboard.tsx`：四指数迷你卡（各 **120 交易日**）+ 共享分类轴两联图（右轴**仅成交额**）+ 连板梯队「**高度 × 网格**」+ 题材热力图。
- 🔴 梯队「高度」= **「若该股本日涨停会达到的连板数」**（断板 +1；**首板未续也 +1**）⇒ 唯一实现 `shared/ladderHeight.ts`（口径函数须落 `shared/`）。折叠是**组内**的（`LADDER_GROUP_VISIBLE_ROWS=3`）。行序按**题材当日热力**降序（`shared/sectorHeatOrder.ts`，缺热度 **-1**）。⚠️ `limit_up_records.boardCount` 基本全 NULL ⇒ **不可作真源**。
- 🔴 生成物禁手改：`darkCompatibility.css` / `favicon.svg`。运算符两形只在 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 译；**免责声明不得删**。
- 🔴 **「接线完成」≠「用户够得到」** ⇒ 交付前必须**按正常导航**量 DOM；长请求按钮 **pending 必须换文案**；`<Button asChild><Link>`；静默 `return` 换响亮 toast。凡靠内存态才能到达的界面必须有 URL 深链。
- 🔴 **CDP 五坑**：兼听 `requestWillBeSent`；toast 每 400ms 轮询（4s 消失）；模板串正则 `\s` 被吃（用 `includes`）；Radix/受控控件只认真实鼠标；端口**实测空闲**。DOM 文本锚点必须**页面主体唯一长锚点**（禁侧栏短词）。

## Strategy 域运行坐标 / 参数链路（STRATEGY-AUDIT-001，2026-09-19）
- 🔴 运行时**唯一权威数据集坐标 = `datasetVersionId`**（`researchRunRouter.ts#primaryDatasetVersionIdOf` → `datasetFromRegistry.ts`）；`datasetVersion`(label) 仅展示。⚠️ 回落重建时 `datasetVersionId = null` 且**只继承 boards/excludeSt**，不继承 event/window/tDayCondition ⇒ 口径不同。
- 🔴 **`loopRun` 的 `parameterSet` 入参是死字段**（只进 `metadata`，不落库）；参数覆写唯一活路 = `assemble.ts:135 parameterOverrides`（`strategyEvaluation/backtestBridge.ts` 与 `evaluator.ts` 传）。前端也不提交它。
- 🔴 **`parameterRole` 的运行期派生器 `parameterSpaceFromDocument.ts` 完全不读它**（FIXED 也会被搜）；`derivedFrom` **无求值器**；执行层用**有损的 v1 `document.parameters`**（`legacyViews.ts:157` 丢弃 code/role/unit/derivedFrom）。`paramSearchRouter.ts` 全文**零写库调用** ⇒ 搜索结果不落库、无 datasetVersion 字段。
- 🔴 **运行级复现快照缺失**：`closed_loop_backtest_run` 无 `parameterSet`/`codeVersion`/`engineVersion`/`seed`/`Universe`/`startedAt`；实测 6/6 行 `resultJson` 零命中。`strategy_versions.codeVersion` 实测 **11/11 = `1.0.0+gunknown`**。
- 🔴 **`LeakageGuard` 对配方特征恒通过**（`recipeRegistryAtoms.ts#samePointAvailability` 恒置 `1990-01-01`）⇒ **策略层没有独立未来函数防护**，安全全靠数据层 PIT。
- 🔴 `setVersionStatus` 只校验「属于八态」，**不吃 §23 迁移表** ⇒ `Draft→Production` 跳级不被拒。
- ⚠️ 全平台实测仅 **1 个 `dataset_definition`**、2 个 `dataset_version`；`strategies` 10 行全 Draft；闭环留档 6/6 `PARTIAL_BLOCKED`。审计全文 = `docs/research/STRATEGY-AUDIT-001.md`。

## Strategy Core 语义权威（STRATEGY-ARCH-001）
- 🔴 **Core 唯一入口 = `server/strategyCore/`**（`StrategyRuntime.evaluate(version, parameterSet, context)` → `StrategyDecision`）。它是**语义**权威；legacy `StrategyDefinition` 降级为**存储编码**，靠 `adapters/legacyDefinition.ts` **双向**翻译（指纹逐字节相等，有测试）。
- 🔴 **`WINDOW` 只考虑「当前决策日及之前」**（更晚的进 `futureSkipped`）⇒ `evaluate` **必须逐决策日调用**；`FIRST_VALID_DAY` 在条件第一次成立那天发信号。
- 🔴 **`updateVersionDefinition()` 恒抛 `VERSION_IMMUTABLE`**（可断言约束）；改内容只能 `applyDefinitionChange()` → 新版本。
- 🔴 **事件判定必须由运行方注入**（`context.resolveEvent`）：**未注入即抛错**，不静默返回 false。
- 🔴 **Definition 内不得出现 Dataset / 引擎坐标**（`DATASET_BINDING_IN_DEFINITION_FORBIDDEN`）；`datasetVersionId` 只允许在 `StrategyRunSnapshot.datasetReference`。
- 🔴 特征 `availability` 是**相对当前 bar** 的声明（`usesForwardData` 必须 false、`dataThroughRelativeDay ≤ 0`）；`usesForwardData=true` **无法注册**。
- ⚠️ **`bar.<派生字段>` 经桥接表映射为特征 id**（`DERIVED_BAR_FIELD_TO_FEATURE_ID`）⇒ 改桥接表必须同查 3 处：`ruleGraph.collectRuleFeatureReferences` / `fieldReference.parseCoreFieldReference` / `featureRegistry`。
- 🔴 **接产未做（N-02，高）**：`loopRun(useRealData)` / `strategyEvaluation` / `conditionSignal/compile.ts` **仍走 legacy** ⇒ Core「已建成未通电」。`StrategyRunSnapshot` **未落库**（N-01）；阈值型出场（TAKE_PROFIT/STOP_LOSS/TIME_EXIT）**仍在 `exitRules` 声明保留**（N-03）。

## Backtest 口径与留档（BACKTEST-002，2026-09-19）
- 🔴 **年化口径唯一 = 252 交易日/年**（`server/backtest/backtestResult.ts#BACKTEST_ANNUALIZATION_DAYS`），**必须复用** `shared/quant-stats#annualizedReturnFromEquityCurve`（`n = 权益点数 − 1`）。别再写 244。
- 🔴 **`maxDrawdownPct` = 正数幅度**；**逐点 `drawdownPct` 才是有符号（≤0）**，两者不同量。
- 🔴 **算式形式也算口径**：`(end/start − 1)×100` 与 `((end − start)/start)×100` 浮点不同（`5.3` vs `5.299999999999994`）⇒ 跨模块统一必须连算式一起。
- 🔴 **canonical 唯一面 = `canonicalMetrics()`**；`ClosedLoopEvaluationRef` 带 `canonicalMetrics` / `metricsSource` / `annualizationBasis`。**`NOT_AVAILABLE` 不得被评估器数值顶替**。
- 🔴 **留档写入必须重试**：真实 Run 计算 593~627 s 期间不碰 DB ⇒ 结束时单次 `insert` 必然失败（判据 = 紧随 SELECT 首发也失败、**重试即成功**）。`researchRunRouter#persistClosedLoopBacktestRun` 已有界重试 ≤3 次（best-effort、**不抛**）。⚠️ 别改成「失败即抛」。
- ✅ **真实 Run 耗时与窗口无关**（3 个月 593.3 s / 1 个月 616.4 s）——**根因已定位**（PARAMETER-001-PRE）：**92.83% 在 `optimization` 阶段**，而该阶段的样本窗口被错设为**数据集整窗（484 决策日）**而非运行窗口（57 日）⇒ 见下节「参数搜索性能」。**别用缩小窗口当加速手段**（只影响那 0.97%）。
- ⚠️ **探针读 `closed_loop_backtest_run.resultJson` 拿到的是字符串** ⇒ 必须 `JSON.parse` 兜住；长算探针应支持只读复核模式（如 `XXX_VERIFY_ONLY=1`）。
- ✅ **性能线已完成（PARAMETER-001-PRE）**：旧结论「Core 只占 8.7%、主因在数据集读取」**已被实测否证**（Core 实际占 **85.8%**、数据集装载仅 **2.61%**）⇒ 见下节「参数搜索性能」。

## Parameter Search 有效性（PARAMETER-002 实查，`9bt` 2026-09-19）
- 🔴 **参数「声明在 schema 里」≠「决策引擎会读它」**。实测 `cand-360001@1.0.0` 声明 3 个 TUNABLE 参数、
  而 Core **规则图 `PARAMETER_REFERENCE` = 0** ⇒ 3 组极端取值产出的**权益曲线逐字节相同**。
  ⇒ 判断一个 TUNABLE 参数是否「真的可搜」，**唯一判据** = `strategyCore/ruleGraph.ts#collectRuleParameterReferences`（入口 + 出场规则图）。
- 🔴 **`createSearch` 会因「死参数」响亮拒绝**（`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`）。
  ⇒ 用 PARAMETER-001 的探针/脚本搜历史候选（`cand-3600xx`）时**现在会被拒**，这是**新预期行为**，不是回归。
  要真搜参数：需在策略文档里用**参数引用**（如 `bar.volumeRatio <= max_volume_ratio`，右值写成参数 code、`valueType=PARAMETER_REFERENCE`）
  改写条件并生成**新版本**（旧版本不可变）。⚠️ 左值必须**同量纲**：比值参数配 `bar.volumeRatio`，
  写成 `bar.volume` 会恒为假（首版探针就这么错了）。
- 🔴 **顺序纪律：`派生 → 覆盖 → 死参数剥离 → 校验`**。显式搜索域覆盖**能**把死参数重新塞回搜索空间（实测踩到）；
  给死参数赋会变化的搜索域会响亮拒绝（`PARAMETER_SEARCH_OVERRIDE_ON_UNREFERENCED_PARAMETER`）。
- ⚠️ `TUNABLE 缺搜索域` 只在**无 `exclusionReason`** 时报错 —— 有 reason = 刻意排除（死参数等）。
- ⚠️ **两套派生器的收敛状态**：`parameterSpaceFromDocument.ts` = `LEGACY / PREVIEW`（消费者 = 技术预览端点 + **闭环 optimization 阶段**，后者只持有 `document`、拿不到 role 投影行 ⇒ 切换属主链改动，已登记遗留）；
  `searchSpace.ts#deriveParameterSearchSpaceFromProjection` = **PARAMETER-001/002 唯一**使用（有静态源码守卫测试）。
- ⚠️ `createSearch` 现在做**前置窗口校验**（`dataset_version` 日期按**北京业务日**）⇒ `PARAMETER_SEARCH_WINDOW_OUT_OF_DATASET_RANGE`。
- ⚠️ 构造策略文档必须走 `createStrategyDocumentFromDefinition`（v1 视图单向派生）；手改 `definition` 会触发
  `SCHEMA_DEFINITION_VIEW_CONFLICT` / `_VIEW_DRIFT`（校验器正确拒绝）。

## Parameter Search 域（PARAMETER-001 实建，`9bs` 2026-09-19）
- 🔴 **搜索空间派生的 role 真源 = `strategy_parameters` 投影**（`parameterRole`）；**不是** `document.parameters`（legacy v1 有损视图，**无 role**）。
  ⇒ 目录里**同时存在两条派生器**：`strategyEvaluation/parameterSpaceFromDocument.ts`（旧、无 role、legacy 预览用）与 `parameterSearch/searchSpace.ts#deriveParameterSearchSpaceFromProjection`（新、带 role、PARAMETER-001 用）。**别再以为只有一条**。
- 🔴 **「谁能被搜索」判据唯一落点 = `searchSpace.ts#isSearchableStrategyParameter`**（`role === "TUNABLE"`）；不 import `server/strategyCore`（避免给 `server/research/**` 新增跨域生产依赖），**由单测断言与 `listSearchableParameters` 逐参数等价**。
- 🔴 **`parameterHash` 拒绝 NaN/Infinity**（静默转 null ⇒ 两组参数撞同一身份 ⇒ resume/retry/cache 全错位）；撞 hash **响亮抛错**，不合并不覆盖。
- 🔴 **Run 计数唯一真源 = 结果行重算**（`persistence#recomputeRunCounters`），禁调用方累加。
- 🔴 **`server/research/parameterSearch/index.ts` 刻意不 re-export 执行层** —— 会经评估端口子图回到 `closedLoopWiring/executors` 形成**运行时循环导入**；消费方按显式路径引用。
- 🔴 **`adminProcedure` 全仓零使用**（实测 0 命中）⇒ 新增写端点沿用 `publicProcedure`。
- ⚠️ **`dataset_version.startDate/endDate` 是 UTC 时间戳**（北京日 2024-09-01 存成 `2024-08-31T16:00:00Z`）⇒ 取业务日期**必须按北京时区**，`toISOString().slice(0,10)` 会少一天。
- ⚠️ 三表 `parameter_search_run` / `parameter_search_combination` / `parameter_search_result`（26/10/23 列、0 FK、快照写入即冻结）；迁移 = `drizzle/0041_parameter_search.sql` + `scripts/applyParameterSearch.mjs`。
- ⚠️ **遗留**：① 无前置「窗口 ⊆ 数据集窗口」校验；② `backtestRunId` 恒 NULL（评估端口走内存态 5 阶段闭环，不落 `closed_loop_backtest_run` 行）。

## Architecture Baseline 入口（SYSTEM-BASELINE-001 建立，2026-09-19）
- 🔴 **后续所有任务的默认入口 = `docs/architecture/SYSTEM-BASELINE.md`**（+ `system-manifest.yaml` + `CHANGE-AUDIT.md`）⇒ **除非触发 12 条 `GLOBAL AUDIT REQUIRED`，禁再全局重扫**。Agent 规范见 `docs/architecture/AGENT-GUIDE.md`（14 条禁止行为 + 16 条陷阱）。Baseline `v1.0.0`。
- 🔴 **基线描述的是「工作区」，不是 HEAD**；**行号只是 auditedAt 快照 ⇒ 定位一律用「路径 + 符号名」**；**采样值必须带时间戳**。
- 各域状态：Dataset/Research/Strategy/Backtest/Lifecycle/MarketRegime = **READY**；**Parameter Search = IN PROGRESS(PRE)**；Evaluation = **PARTIAL**；Robustness/OOS/WFA/Overfitting = FACT(技术预览)；Simulation = FACT；**Production = PLANNED**。闭环 14 阶段**实装 8**（未装 robustness/oos/overfitting/paper/review/discipline，以 `CL_RUNNER_NOT_INJECTED` 如实 BLOCKED）。
- 🔴 **三个语义权威**：策略 = `server/strategyCore/**` · 执行/成本/持仓 = `server/backtest/**`（**禁新建 backtestCore**）· 指标 = `backtestResult.ts#canonicalMetrics()`（**唯一**；Evaluation 已有 canonical 时**禁**重算重叠指标）。
- ⚠️ **DB 事实**：真实库 **63** 张基表（schema.ts 声明 60 + `__drizzle_migrations` + 2 张 `rd_rows_*`）；**0 外键**（全软引用）；**drizzle 发布链路自 0024 停摆**（journal 止 0023 / snapshot 止 0015 / `__drizzle_migrations` 24 行）⇒ `db:push` 不可用，只能手写 SQL + `scripts/apply*.mjs`。
- ⚠️ **ROADMAP §44.4 滞后**（仍写 STEP 13~25 BLOCKED，实际 13/14/15/21/22 已 READY）；**11 条历史文档漂移**已登记 `SYSTEM-BASELINE.md` §12.4。
- 🔴 **探针纪律**：`ds_*` 全表 COUNT 相加 ≠ 应看**按 `datasetVersionId` 分组**；`resultJson LIKE '%"backtest"%'` **不是**「有 backtest 段」的判据（会误命中 `backtestFingerprint`）⇒ 用 `$.backtest.executionMetadata.executionPolicyVersion`。
## 参数搜索性能（PARAMETER-001-PRE，2026-09-19）
- 🔴 **真实 Run 的三个分母**（同输入实测）：`optimization` 阶段 **92.83%** · 数据集装载 **2.61%** · 留档写库 **3.36%** · **主链只 0.97%**（6.4 s）。**DB 往返仅 61 次（无 N+1）；CPU 采样 ≈ 墙钟 ⇒ 纯 CPU-bound**。全文 = `docs/parameter/PARAMETER-001-PRE-PROFILE.md`。
- 🔴 **R-06 根因 = 窗口不在请求里**：`optimization` 的样本窗口 = 数据集版本窗口（484 决策日），不是运行窗口 ⇒ **9.28×**。**DEFECT-1 已定位未修**（改它会改 `optimizationRef`，违反 §10 Before==After）⇒ PARAMETER-001 第 0 步必修。
- 🔴 **定义指纹必须缓存**：`strategyCore/runtime.ts` 原在**每次求值**里对**整份定义**算 **2 次** `computeDefinitionFingerprint` ⇒ `canonical.ts` 占 **44.30% CPU**。已改为按 definition `WeakMap` 缓存 + 每求值取 1 次（**逐字节等价**，有回归测试）⇒ **2.07×（计算路径）**。
- 🔴 **`db.read_ms` 是「并发求和」不是墙钟**（48 条批读并发 16）⇒ 拿它当网络占比会差 6 倍。占比一律用 `dataset.resolve` / `persistence.db_write` 的**墙钟**。
- 🔴 **Before/After 必须同条件**：插桩 + 1 ms CPU 采样会把 593.3 s 变 657.8 s（+11%）⇒ 跨报告引用数字必须写明条件。
- 🔴 **特征不可跨参数预计算**（`runtime.ts` 把 `resolved.values` 传给 `featureDefinition.compute`）⇒ 除非先补「特征→参数依赖」声明，否则预计算 = 静默改结果。
- 🔴 **搜索边际成本（AFTER 实测）**：**2,500 ms/组**（用户窗口 57 日 / 7,731 成员槽）⇒ 1000 组串行 ≈ **42 min**；数据集必须**一次装载多组复用**（`researchDataset` 注入路径已具备）。
- 插桩开关：`PARAM_PROFILE=1`（**默认关**，关闭时零影响）；探针 `_probe_param001_pre_profile.mts`（含 V8 CPU 采样）/ `_probe_param001_stage_bench.mts`（零写库，**须 `process.exit()`**）/ `_probe_param001_recon.mts`。
