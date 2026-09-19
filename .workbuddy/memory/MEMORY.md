# stock-limit-up-analyzer 硬禁令索引

> 🔴 唯一细则源 = `.workbuddy/memory/PROJECT_RULES.md`（含本文旧全文 + 下移附录）。本文**只留 🔴 禁令 + 最易踩口径**；篇幅受限，明细一律回读细则源 / 代码 / `docs/architecture/**`。

## 三门（违反即事故）
1. 🔴 改 `server/**` ⇒ `tsx watch` 热重启并**杀在途 Run**（在途=`RUNNING`；`PENDING`+空 `inputSnapshot` 草稿禁收敛）⇒ 用户在用页面时禁改 server、禁跑重库脚本；改 `client/**` 只走 HMR。
2. 🔴 禁 `install`/新依赖/`prettier --write`/`db:push`/`drizzle-kit generate`/手写 `_journal.json`。
3. 🔴 同一文件多处编辑必须**串行**（并行 `Edit` ⇒ 后写覆盖先写、前者静默丢失）。

## 环境 / 工具
- 🔴 Bash 前置 `export PATH=/c/Users/A/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Windows/System32:$PATH`；`git`/`node`/`python` 不认 `/c/...` ⇒ 传 `C:/...`；Win stdout 常不返回 ⇒ Python 读**落盘**文件。
- 🔴 端口只认启动日志（**3000 = Vite dev**，`/trpc/*` 返 `index.html` ⇒ 打 tRPC 别打 3000）；探端点用 Node `fetch`。
- 🔴 长任务输出**禁接管道**（EPIPE ⇒ 中止并清空留档）；后台 `run_in_background` + 读 `.out.txt`；**先确认 stdout 有内容再解析产物**，否则读到的是**上一版 stale `.out.json`**。
- 🔴 改文件 = Python bytes + `os.replace` + 回读；裸 `str.replace` 要 `assert count==1`。测试基线 = **8 失败文件 / 17 用例**（判据 = 失败**文件集合**，先剥 ANSI）。
- 🔴 行尾：改前改后跑 `scripts/checkEolDrift.mjs`；**CRLF 只有 `PROJECT_RULES.md`、`.gitignore`**，余全 LF；读 CRLF 用 `newline=""`，写探针/JSON 一律 `"wb"`。
- 🔴 落点：`C:\work\sourcecode\_scratch\`（一次性）｜`docs/evidence/`（探针，须登记 `README.md`）｜`docs/research/`（报告）。`client/**` 只禁 import `server/**` **运行时值**。
- 🔴 证据脚本：结论**按模式落盘**（`clean` ⇒ `*.clean.out.json/.txt`）否则清理阶段**静默覆盖**主阶段判据；**写完必须先 `node --check`** —— 在**模板字符串内部**的注释里写反引号或 `${` 会让模板串提前闭合、脚本根本没跑（而旧产物仍在）。
- ✅ 前端验收 = 无头 Chrome/Edge + Node `WebSocket` 直连 CDP **量 DOM**（`agent-browser` 本机不可用）；端口实测空闲、输出必须落盘。

## 总控
- 🔴 `ROADMAP.md` 唯一 Master Control（§44 覆盖式只留最近 1 条「上轮实查」，被覆盖那条**原样搬运**到 `ROADMAP-CHANGELOG.md`；§44.5 队列；§47 append-only）；仅 `RESEARCH_READY=TRUE` 允许策略结论。
- 🔴 取号真源 = 「编号台账」行（禁「末条 +1」、禁凭记忆）；**文件头铁律行 + 台账行两处同步**。并行会话会推进台账；完成已登记项**不取新号**，就地改完成态。
- 🔴 分叉合流：`ls-remote` → `fetch` → `merge --no-ff`；文档冲突两侧都保留；丢文件 `git ls-files -d -z | xargs -0 git checkout --`。

## 页面 / 前端
- 🔴 侧栏高亮 = 分段精确匹配 + 取最长命中（`AppShell.tsx#isPathActive`，禁 `startsWith`）。首页入口 = 左上角网站标题（`data-slot="sidebar-home-link"`）⇒ 站在 `/` 侧栏零高亮。
- 🔴 口径函数必须落 `shared/`（`ladderHeight.ts`/`sectorHeatOrder.ts`）。生成物禁手改：`darkCompatibility.css`/`favicon.svg`；运算符两形只在 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 译；**免责声明不得删**。
- 🔴 「接线完成」≠「用户够得到」⇒ 交付前必按**正常导航**量 DOM；长请求按钮 pending 换文案；`<Button asChild><Link>`；静默 `return` 换响亮 toast；靠内存态到达的界面必须有 URL 深链。
- 🔴 CDP：兼听 `requestWillBeSent`；toast 高频轮询；模板串正则 `\s` 被吃（用 `includes`）；Radix/受控控件只认真实鼠标；DOM 锚点必须页面主体唯一长锚点（禁侧栏短词）。
- 🔴 静态标题锚点 ≠ 数据到位 ⇒ 必等**目标数据行数 > 0**；同页多面板查询落地可能 ~20 s（dev 冷编译）⇒ 预算放宽 + 点不中就重试；pass 表达式取**已达标那一步**快照。
- 🔴 **探针作用域必须收窄到被测面板子树**（同页兄弟面板的免责文案本身就含禁词 ⇒ 整页扫会把别的域判成本域违规；`table tbody tr` 也会把兄弟面板的行数一起数进来）⇒ **收窄后必须自证**（根节点 `data-slot` + 是否含兄弟面板按钮 + 文本长度随交互增长）。
- 🔴 **禁词扫描须区分「否定式免责」与「肯定式结论」**（面板渲染的服务端 notes 本身即「也不称任何 Fold 为「最好 / 最差」」）⇒ 判据双轨：自由文本里含禁词的**行**必须同时含否定标记；标题/表头/按钮/徽标等**结论承载面**一律不得出现。

## Strategy 域（STRATEGY-AUDIT-001 / ARCH-001/002）
- 🔴 运行时唯一权威数据集坐标 = `datasetVersionId`；`datasetVersion`(label) 仅展示。回落重建时 `= null` 且只继承 boards/excludeSt ⇒ 口径不同。
- 🔴 `loopRun` 的 `parameterSet` 入参是**死字段**（只进 `metadata`）；参数覆写唯一活路 = `assemble.ts:135 parameterOverrides`。`parameterSpaceFromDocument.ts` **完全不读 `parameterRole`**；`derivedFrom` 无求值器；执行层用**有损**的 `document.parameters`（`legacyViews.ts:157`）。
- 🔴 运行级复现快照缺失 + `strategy_versions.codeVersion` 实测 **11/11 = `1.0.0+gunknown`** ⇒ 无法从留档复现运行级参数。`setVersionStatus` 只校验八态、**不吃 §23 迁移表** ⇒ `Draft→Production` 跳级不被拒。
- 🔴 `LeakageGuard` 对配方特征**恒通过**（`recipeRegistryAtoms.ts#samePointAvailability` 恒置 `1990-01-01`）⇒ 策略层无独立未来函数防护，安全全靠数据层 PIT。
- 🔴 Core 唯一入口 = `server/strategyCore/`（`StrategyRuntime.evaluate` → `StrategyDecision`）= **语义**权威；legacy `StrategyDefinition` 降为**存储编码**（`adapters/legacyDefinition.ts` 双向翻译）。`WINDOW` 只考虑「当前决策日及之前」⇒ `evaluate` 必须**逐决策日**调用；`updateVersionDefinition()` 恒抛 `VERSION_IMMUTABLE`；事件判定由 `context.resolveEvent` 注入，**未注入即抛错**。
- 🔴 Definition 内不得出现 Dataset/引擎坐标（`DATASET_BINDING_IN_DEFINITION_FORBIDDEN`）；`usesForwardData=true` 的特征**无法注册**。legacy 与 Core 语义不同 ⇒ 历史回测数字**不可直接对比**。改 `DERIVED_BAR_FIELD_TO_FEATURE_ID` 必须**同查 3 处**。

## Backtest 口径与留档（BACKTEST-002）
- 🔴 年化唯一 = **252 交易日/年**（`backtestResult.ts#BACKTEST_ANNUALIZATION_DAYS`），必须复用 `shared/quant-stats#annualizedReturnFromEquityCurve`（`n = 权益点数 − 1`）。别再写 244。
- 🔴 `maxDrawdownPct` = **正数幅度**；逐点 `drawdownPct` 才有符号（≤0）。**算式形式也算口径**（`(end/start − 1)×100` ≠ `((end − start)/start)×100`）。
- 🔴 canonical 唯一面 = `canonicalMetrics()`；`NOT_AVAILABLE` **不得**被评估器数值顶替。
- 🔴 `server/backtest/**` 就是事实上的 Backtest Core（`simulator/engine.ts#runTradeSimulation`）⇒ **禁新建 `backtestCore/**`**；`backtest/engine.ts#runBacktestEngine2` 生产不可达（不删）。
- 🔴 留档写入**必须重试**（长算期间不碰 DB ⇒ 结束时单次 `insert` 必失败；有界重试 ≤3 次不抛）；`resultJson` 读回来是**字符串**。真实 Run 耗时**与窗口无关** ⇒ 别用缩小窗口加速。

## 三条并列执行边（守卫形态各不相同，**互不可搬移**）
- 🔴 ① `searchRobustness/**`（`9bu`）= **零重跑**（只读冻结快照做邻域统计）｜import **黑名单**（禁 `backtest`/`strategyEvaluation`/`closedLoop`/`strategyCore`/`runWorkbenchAssembly`/`researchEngine`/`leaderCandidates`）。
- 🔴 ② `oosValidation/**`（`9bv`）= **必须重跑 + 必须重算** ｜import **必含清单**（必须够到 `createStrategyBacktestBridge` + `projectCanonicalMetrics`）。
- 🔴 ③ `walkForward/**`（`9bw`）= **逐 Fold 重跑且零复制** ｜**黑名单 +「执行只能经由注入钩子」**（可 import `oosValidation/types` 取两个版本常量；禁自行触达执行面、禁 `WalkForward → HTTP → OOS API → HTTP → Backtest`）。实现互搬 ⇒ 对侧守卫立刻变红。
- 🔴 `stabilityRatio` 的 `null` ≠ `0`；`tradeCount = 0` ⇒ `INSUFFICIENT_TRADING_ACTIVITY`（**不计入** `validNeighborCount`）；缺格 ⇒ `MISSING_COMBINATION` + 全 `null`、**禁补值**；>2 可变参数 ⇒ 格标 `AMBIGUOUS`。稳健性源必须 `COMPLETED` + 有结果 + 全 `canonical` + 不跨 Run 混行。
- 🔴 「真重跑」主判据 = 撮合指纹 `backtestFingerprint` 差异，**不是指标差异**（`tradeCount = 0` 时两侧指标天然相等 ⇒ 会误判）。
- 🔴 **同进程幂等 ≠ 跨进程幂等**：进程内连调两次（`executed=false`）与**换进程**再执行是**两条判据、不可互替** —— 若「已完成」判定依赖内存态，前者绿、后者露馅。

## Parameter Search 域（`9bs`/`9bt`）
- 🔴 参数「声明在 schema 里」≠「引擎会读它」。唯一判据 = `strategyCore/ruleGraph.ts#collectRuleParameterReferences`；引用为 0 时极端取值给出**逐字节相同的权益曲线**。实测**全部 11 个既有策略版本 `ruleGraphRefs` 全为空** ⇒ 搜历史候选必被拒（`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`）⇒ 要真搜参数必须**自建含参数引用的新版本**。
- 🔴 顺序纪律：**派生 → 覆盖 → 死参数剥离 → 校验**（覆盖能把死参数塞回搜索空间 ⇒ `..._OVERRIDE_ON_UNREFERENCED_PARAMETER`）；左值必须同量纲（比值参数配 `bar.volumeRatio`）。
- 🔴 role 真源 = `strategy_parameters` 投影（不是 `document.parameters`）；「谁能被搜索」唯一落点 = `searchSpace.ts#isSearchableStrategyParameter`（`role === "TUNABLE"`）。`parameterHash` 拒 NaN/Infinity、撞 hash 响亮抛错。
- 🔴 ESM `export *` 同名**静默遮蔽** ⇒ 新增顶层导出前先查 `server/**`+`shared/**`（已有守卫测试）；`parameterSearch/index.ts` 刻意**不 re-export 执行层**（否则经评估端口子图形成运行时循环导入）。
- 🔴 `adminProcedure` 全仓零使用 ⇒ 新写端点沿用 `publicProcedure`。`dataset_version.startDate/endDate` 是 UTC 时间戳 ⇒ 取业务日期**必须按北京时区**。
- 🔴 **「被接受但从未生效」的字段是缺陷**：新增创建入参必须保证每个键都被真实读到（域执行器 `request.${key}` 或端点段 `input.${key}`）⇒ 已有「无死旋钮」守卫（`9bw` 据此删掉 `parameterSearchSpace`）。

## Walk-Forward（`9bw`）
- 🔴 **编排层，不是新引擎**：`server/research/walkForward/**` = 时间滚动编排 + Fold 隔离 + 汇总；禁新建 `WalkForwardMetrics`/`WalkForwardBacktestEngine`/`WalkForwardStrategyRuntime`。
- 🔴 Fold **串行** + **每 Fold 独立搜索**：明禁「先跑一遍全局 Parameter Search 再切成多 OOS Fold」（`WALK_FORWARD_SEARCH_NOT_INDEPENDENT`，判据 = 同一 Search Run 不得被两个 Fold 复用）。
- 🔴 窗口几何**只复用不重写**：`server/research/walkForwardRun/windows.ts#generateWalkForwardSplits`；单位 = **交易日个数**；硬约束 `isEnd < oosStart` 且 `oosStart = isEnd + 1 trading day`。
- 🔴 **命名不遮蔽**：本域符号一律带 `VALIDATION`（`WFV` 对 C-19.1 的 `WFA`）；本域与 `walkForwardRun/**` **刻意不并入全域 `export *`**，一律按文件路径 import。
- 🔴 汇总**只做描述性统计**：禁「最优/最佳/推荐/winner/best/optimal Fold」、禁自动淘汰、禁把 `tradeCount DESC` 变生产默认。
- 🔴 候选冻结只认「源 Search Run + `parameterHash`」并**重算复核**；冻结不足 ⇒ **显式失败**，禁回读当前策略版本补全。`null` ≠ `0`（可用 Fold = 0 ⇒ 六项全 `null`、`availableCount = 0`，**不退化成 0**）。

## Architecture Baseline（SYSTEM-BASELINE-001）
- 🔴 后续任务默认入口 = `docs/architecture/SYSTEM-BASELINE.md`（+ `system-manifest.yaml`/`CHANGE-AUDIT.md`）⇒ 除非触发 `GLOBAL AUDIT REQUIRED`，禁再全局重扫。规范 = `AGENT-GUIDE.md`；当前基线 **`v1.4.0`**。
- 🔴 基线描述「工作区」不是 HEAD；行号只是快照 ⇒ 定位用「路径 + 符号名」；采样值必须带时间戳。
- 🔴 三个语义权威：策略 = `server/strategyCore/**` · 执行/成本/持仓 = `server/backtest/**` · 指标 = `canonicalMetrics()`（唯一）。
- 🔴 探针纪律：`ds_*` 全表 COUNT 相加 ≠ 应按 `datasetVersionId` 分组；`resultJson LIKE '%"backtest"%'` 不是「有 backtest 段」的判据。

## 性能（PARAMETER-001-PRE）
- 🔴 真实 Run 分母：`optimization` **92.83%** · 数据集装载 2.61% · 写库 3.36% · 主链 0.97%（DB 往返仅 61 次）。根因 = `optimization` 取数据集整窗（484 决策日）而非运行窗口 ⇒ **9.28×**（DEFECT-1 已定位未修）。全文 = `docs/parameter/PARAMETER-001-PRE-PROFILE.md`。
