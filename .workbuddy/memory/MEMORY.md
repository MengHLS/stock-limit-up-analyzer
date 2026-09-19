# stock-limit-up-analyzer 硬禁令索引

> 细则真源 = `.workbuddy/memory/PROJECT_RULES.md`。只留跨会话必须复用的判据。

## 三门
1. 🔴 改 `server/**` 热重启会**杀死在途 Run** ⇒ 用户在用时禁改 server。在途 = `RUNNING`（唯一）；`PENDING` + 空 `inputSnapshot`/`startedAt` = 草稿。`client/**` 只走 HMR。
2. 🔴 禁 `pnpm/npm install`、新增依赖、`prettier --write`、`db:push`、`drizzle-kit generate`、手写 `_journal.json`。迁移 = 手写 SQL + 幂等 apply + `information_schema` 断言。

## 环境 / 工具链
- 端口每轮变 ⇒ 先 `netstat | grep LISTENING`。`curl` 走代理（连 127.0.0.1 也 502）⇒ 用 Node `fetch` + `localhost`。Bash 须自带长 PATH（git = `PortableGit/versions/1.2.0/cmd`、Unix 工具 = 同版 `usr/bin`）；git/node 不认 MSYS `/c/...` ⇒ 传 `C:/...`；后台用 `run_in_background`；PowerShell stdout 不回显 ⇒ 写文件再读。
- git 写入可能被外部回滚 ⇒ 复核 `rev-parse HEAD`。🔴 `refs/remotes/origin/main` 会丢 ⇒ 只信 `git ls-remote`/`FETCH_HEAD`；合流 = `ls-remote`→`fetch`→`merge --no-ff`，`ROADMAP*`/memory 冲突**两侧都保留**。🔴 GitHub 只在「非沙箱 + 清空 `*_PROXY`」可达。
- 写文件用 Python bytes + `os.replace` + 回读；源码禁 `\uXXXX`；🔴 模板字符串内禁嵌反引号。🔴 裸子串断言会假失败 ⇒ 判据带形态；DOM 文本判据禁短词 ⇒ 用主体唯一长锚点。
- 探针 → `docs/evidence/`；一次性脚本 → `C:\work\sourcecode\_scratch\`；报告 → `docs/research/`。测试基线 **8 文件 / 17 用例**（判据 = 失败**文件集合**）。
- ✅ 前端验收 = 无头 Chrome `--headless=new --user-data-dir=<tmp> --remote-debugging-port=<随机>` + Node `WebSocket` 直连 CDP **量 DOM**；输出必须落盘。`agent-browser`/`jsdom` 不可用。
- 🔴 CDP：只听 `responseReceived` 会漏在途请求（并听 `requestWillBeSent`）；模板串里正则 `\s` 会被吃 ⇒ 用 `includes`；🔴 **禁固定 `sleep` 判「渲染好了」** ⇒ 轮询锚点 + 记 `readyMs`（实测 `/market` 锚点 5.7s 才出现，固定 9s 会**假失败**）。

## 行尾（逐文件实测）
- 🔴 工作区多为 CRLF 而 HEAD blob 纯 LF，`git status/diff` **全看不见**（mtime 命中 ⇒ 对**未修改**文件全程沉默）⇒ **改前跑 + 改后复跑** `node scripts/checkEolDrift.mjs`；唯一依据 = HEAD blob。🔴 字节差 == 行数 ⇒ 纯漂移。
- 🔴 **纯 LF**：`ROADMAP*`、`.workbuddy/memory/*`、`docs/**`、`server/**`、`client/**`；**纯 CRLF**：`client/src/App.tsx`、`AppShell.tsx`、`PROJECT_RULES.md` ⇒ 仍须实测（同目录可混）。判行尾只认 Python `b.count(b"\r\n")` vs `b.count(b"\n")`。🔴 行尾归因**必须先做对照实验**：2026-09-18 实测 `Edit`/`Write` **保留 LF、不是元凶**（真凶 = 未定的外部同步/并发会话）。

## 总控
- `ROADMAP.md` 唯一 Master Control（§44 覆盖式 / §44.5 队列 / §47 append-only）；**仅 `RESEARCH_READY=TRUE` 允许策略结论**。🔴 §44.5 条目多为**单行**（可 grep）⇒ 追加内容保持单行。
- §44.5 取号真源 = 「编号台账」行（禁「末条 +1」）且**先对远端台账**；铁律行 + 台账行**两处同步**。同一号内收敛（如 `9be` 版式追加）**不消耗新号**。

## 回测 / 评估端口
- Dataset 坐标 = `dataset_version.id`；Strategy SoT = `strategy_versions.strategyDocumentJson`；**零 FK**；`promote` 是唯一 `CONVERTED` 入口。
- ✅ `assemble.ts#requireRecipe` 三路：①带 `recipe` → 注册表 ②**有条件无 recipe** → 现场编译 ③皆无 → 兜底（`recipeSource = strategy-declarative-conditions`）。🔴 ①必须先于②；🔴 等价改写**方向翻转**；表外写法抛 `CONDITION_NOT_MAPPABLE`。
- 🔴 **唯一评估端口 = `server/research/strategyEvaluation/`**；主输出字段是 **`evaluation`**（含 `equityCurve`）。禁手写 dataset→engine→simulator 子链。
- 🔴 **`dataReady: true` 必须显式传**（`runAudit.ts:74` 缺省 false）⇒ 否则 `INCONCLUSIVE` + `CL_DATASET_GATE_NOT_PASS`。覆写键必须在 `document.parameters` 内（否则 `RECIPE_PARAMETER_UNKNOWN`）。`DatasetSourceKind` = `registry`/`rebuild`/**`injected`**。`createStrategyBacktestBridge` = 「参数集 × 区间 → 标量 + 权益曲线」唯一实现；参数空间必须 `deriveParameterSpaceFromDocument` 派生。
- 🔴 单组评估 ≈3 分钟 ⇒ 搜索只能 `random` + 小 `budget`。⚠️ 长跑后 DB 查询会瞬时失败；真实列名禁凭记忆写 SQL。`marketRegimeRouter` 不是参数评估 router。

## 运行工作台 / 前向纸面 / 留档
- 🔴 直读桥 = `runWorkbenchAssembly/datasetFromRegistry.ts`（禁第二套实现）；决策日资格 = `rd ∈ [obs.start, obs.end]`。`securityId` = canonical `sec_<uuid>`；板块判定用 `row.code`；回落重建须抛 `UniverseConstraintError`（错用 `RegistryDatasetBridgeError` 会被吞 ⇒ 静默全市场）。
- 🔴 `loopRun` 留档 `closed_loop_backtest_run`（与 `backtest_runs` 不同表、禁互灌）；`dateRange` 必填；`experimentId` 须 `EXP-YYYYMMDD-XXXXXXXX`。
- 🔴 交易日历唯一来源 = `index_daily`（停更 ⇒ `datesToAdvance` 恒空、**静默 no-op 却报成功**；补数必须 `--force`）；齐平必须传 `referenceDate`。`market_data` 两列均 NOT NULL ⇒ **只能整行写**；缺口判据 = `getSyncStatus.pendingDates`（>1 才缺口，禁 `hasTodayData`）。

## 页面 / 路由 / 连板口径
- 🔴 `/` = **行情复盘总览首页**（`pages/Dashboard.tsx`）；明细迁 `/limit-up`（`LimitUpReview.tsx`，原 `Home.tsx`）。侧栏高亮 = 分段精确匹配 + **取最长命中**（`AppShell.tsx#isPathActive`，禁 `startsWith`；`/` 特判只匹配自身 ⇒ 与 `/limit-up` 互斥）。
- 🔴 **连板梯队唯一数据源 = `server/boardRoster.ts#getBoardRoster`**（有界窗口 60 自然日，**522ms**）；**禁**再用 `limitUp.getConnectionBoardStats`（全表 99,918 行 / **68s**，禁进首屏）。板数 = 连续**记录交易日**涨停个数；窗口触顶置 `window.exhausted`；**目标日无记录 ⇒ 整体留空**。情绪分唯一真源 = `shared/boardEmotionScore.ts`；指数日线 = `market.getIndexDailySeries`。
- 🔴 主题：`localStorage["theme"]` 显式值优先，否则跟设备；**点一次即写死偏好**。`client/**` 禁 import `server/**`/`shared/**` 运行时值；免责声明不得删；`RESEARCH_READY` 不因「结果可看」变 TRUE。
- 🔴 策略页 `/strategies` + `/strategies/:strategyId`（新建草稿须清空 `strategyId`）；规则编辑 = 七段表单，有 `definition` 时禁回送五个 v1 视图（`SCHEMA_DEFINITION_VIEW_CONFLICT`）。
- 🔴 **生成物禁手改**：`client/src/theme/darkCompatibility.css`（**改注释也要重跑**生成器）；favicon。⚠️ 该生成器按 `walk(SRC)` **文件发现顺序**输出 ⇒ 任何 `client/**` 增删改名都会造成**纯排序 diff**（判据 = 选择器集合与声明体全等）。

## 组合回测分仓（`9bc`）
- 🔴 `/backtest` 并存两套语义：①快照面板 = legacy 模拟器 + 分仓下拉（权威 = `positionBudget.ts#allocatePlannedBudgets`，等权 = 现金 ÷ 笔数）；②`realisticSimulation` = 生产 Engine，**每笔固定 100 股**（`engine.ts:117`），不读分仓。⚠️ 非等价。
- 🔴 「准备买入」显示 100% 不是算错。**固定单笔 = 初始资金 × 20%**；**用户已明确不设上限 ⇒ 禁自行加 cap**。⚠️ 改分仓口径会重算全部历史数值 ⇒ 必先经用户授权。⚠️ `server/paperTrading.ts:374-386` 内联第二份分配实现（待收敛）。

## 交易模式单一真源（PATTERN-LIBRARY-001）
- 🔴 模式唯一真源 = `server/research/patternLibrary/patterns/*.ts`；新增一种 = 1 个声明文件 + `patterns/index.ts` 1 行。禁再往 `moduleRegistry.ts` / `recipeRegistry.ts` 写工厂与配方字面量。声明层只允许 `import type`。
- 🔴 顶层常量互相 import ⇒ **运行时炸而 `tsc = 0`** ⇒ 注册表必须惰性单例（原子在 `recipeRegistryAtoms.ts`）。候选创建可传 `patternId` ⇒ 自动带 `entryRule.extra.recipe` + `parameterSpace`。

## 策略文档 / 候选草图坐标
- 🔴 配方引用在 **`document.recipe`（顶层）**，不是 `document.definition.entry.recipe`。`strategies` 表两身份列 `id`(INT) / `strategyId`(varchar) ⇒ 清理一律用 `strategyId`（对 `id` 传字符串报 `Truncated incorrect INTEGER value`，会让行数守恒假装通过）。
- 🔴 `patternId` 路径下候选写 `filterRule:{groups:[]}` 是刻意的：筛选由 `buildGates` 承载，摘要进 `sourceTraceJson.patternGateSummary`。`buildConditions` 读 `logicalOperator`/`groupLogicalOperator`，非 AND ⇒ 响亮抛错；**组内首条必须放行**。
- 🔴 候选草图键白名单必须与服务端契约**等宽**（`candidateSketchForm.ts`）：`PARAMETER_SPACE_ROW_KEYS` 8 键（缺 `defaultValue` 抛 `RECIPE_PARAMETER_NO_DEFAULT`）；⚠️ `CONDITION_ROW_KEYS` **仍缺 `note`** ⇒ 已转正候选的 filterRule 块仍降级。🔴 改契约必须同查前端三处：白名单 / `CandidateSketchFields.tsx` / `CandidateSketchCard.tsx`。

## 前端可达性
- 🔴 **「接线完成」≠「用户够得到」** ⇒ 前端改动必须用无头浏览器按真实导航路径量一次 DOM。身份判据须 `questionId ?? runId` 择一；**静默 return 一律换响亮提示**；`createCandidate` 13.2s ⇒ 长请求按钮**必须换文案**。
- 🔴 `Link` 包 `Button` 必须 `<Button asChild><Link>`。**候选 → 策略可达性**：`/strategies` 只列 `strategies` 表 ⇒ 未转正候选不出现（符合设计）；候选详情页 `CONVERTED` 后**无 `/strategies/:strategyId` 链接**（真实缺口）。

## 研究 Run 运行态 / 孤儿回收（2026-09-18 实测）
- 🔴 **僵尸 RUNNING 第三形态**：`reclaim.ts` 的 RUNNING 兜底分支**只在遍历「非终态分析」时**收集父 Run ⇒ **「父 RUNNING + 子分析全终态 + 有结果」永不被自动收敛**（实测零写入）⇒ 只能**人工收敛**（`FAILED` + `RUN_ORPHANED` + `completedAt` + Experiment 回滚）。⚠️ `9bd` 待做。
- 🔴 排查顺序：`startedAt` 距今（**库内时间戳是 UTC 墙钟，别再减 8 小时**）→ 子分析状态分布 → `research_result` 行数 → `executionLogJson` 末批 → **进程证据**（`Get-Process -Id <pid> | Select StartTime`）。✅ **写保护代理取证法**：真实仓储包 Proxy（方法名命中 `^(create|update|delete|remove|insert|upsert|save|replace|set|purge)` 即抛错，其余 `.bind(obj)`）后照常调真实函数 ⇒ 得「真实返回值 + 是否零写入」。

## Strategy 域运行坐标 / 参数链路（STRATEGY-AUDIT-001 实查 2026-09-19）
- 🔴 运行时**唯一权威数据集坐标 = `datasetVersionId`**（`researchRunRouter.ts#primaryDatasetVersionIdOf` → `datasetFromRegistry.ts`）；`datasetVersion`(label) 仅展示。⚠️ 回落重建时 `datasetVersionId = null` 且**只继承 boards/excludeSt**，不继承 event/window/tDayCondition ⇒ 口径不同。
- 🔴 **`loopRun` 的 `parameterSet` 入参是死字段**：只进 `metadata`（`researchRunRouter.ts:564`），既不过 `assembly` 也不落库；参数覆写唯一活路 = `assemble.ts:135 parameterOverrides`（由 `strategyEvaluation/backtestBridge.ts` 与 `evaluator.ts` 传）。前端也不提交它。
- 🔴 **运行级复现快照缺失**：`closed_loop_backtest_run` 无 `parameterSet`/`codeVersion`/`engineVersion`/`seed`/`Universe`/`startedAt`；实测 6/6 行 `resultJson` 里这些键**零命中**。`strategy_versions.codeVersion` 实测 **11/11 = `1.0.0+gunknown`**（有列、不可用）。
- 🔴 **`LeakageGuard` 对配方特征恒通过**：`recipeRegistryAtoms.ts#samePointAvailability` 把可用性恒置 `EPOCH_FLOOR_DATE="1990-01-01"`；`validateStrategy13` 不拒 future 变量；`conditionSignal/compile.ts` 零 `leakage` 引用 ⇒ **策略层没有独立未来函数防护**，安全性全靠数据层 PIT（`datasetAccess/invariants.ts`）。
- 🔴 参数：`parameterRole` 的**运行期派生器 `parameterSpaceFromDocument.ts` 完全不读它**（FIXED 也会被搜）；`derivedFrom` **无求值器**（仅人类可读）；执行层用**有损的 v1 `document.parameters`**（`legacyViews.ts:157` 丢弃 code/role/unit/derivedFrom）。`paramSearchRouter.ts` 全文**零写库调用** ⇒ 搜索结果不落库、无 datasetVersion 字段。
- 🔴 `setVersionStatus` 只校验「属于八态」，**不吃 §23 迁移表**（迁移表只在纯函数 `research/lifecycle/transition.ts`）⇒ `Draft→Production` 跳级在写入路径上不被拒。
- ⚠️ 全平台实测仅 **1 个 `dataset_definition`**（`first_limit_pullback`）、2 个 `dataset_version`；`strategies` 10 行全 Draft、无 Production；闭环留档 6/6 `PARTIAL_BLOCKED`。审计全文 = `docs/research/STRATEGY-AUDIT-001.md`。

## Strategy Core 语义权威（STRATEGY-ARCH-001 实建，`9bi`）
- 🔴 **Core 唯一入口 = `server/strategyCore/`**（`StrategyRuntime.evaluate(version, parameterSet, context)` → `StrategyDecision`）。它是**语义**权威；legacy `StrategyDefinition` 降级为**存储编码**，靠 `adapters/legacyDefinition.ts` **双向**翻译（`legacy→Core→legacy→Core` 指纹逐字节相等，有测试）。
- 🔴 **`WINDOW` 只考虑「当前决策日及之前」的窗口日**（更晚的进 `futureSkipped`）⇒ `evaluate` **必须逐决策日调用**；`FIRST_VALID_DAY` 在条件第一次成立那天发信号。这条让「`evaluate(T)` 不读 T+1」成为**结构性事实**，不是约定。
- 🔴 **`updateVersionDefinition()` 恒抛 `VERSION_IMMUTABLE`** —— 把「不存在第二条改内容的路径」做成**可断言**约束。改内容只能 `applyDefinitionChange()` → 新版本（指纹相同 ⇒ `unchanged` 幂等）。
- 🔴 **事件判定必须由运行方注入**（`context.resolveEvent` / `setEventOccurrenceResolver`）：**未注入即抛错**，不静默返回 false（否则「没接事件源」被伪装成「当日无事件」）。
- 🔴 **Definition 内不得出现 Dataset / 引擎坐标**（`DATASET_BINDING_IN_DEFINITION_FORBIDDEN`，机器可查）；`datasetVersionId` 只允许在 `StrategyRunSnapshot.datasetReference`。
- 🔴 特征 `availability` 是**相对当前 bar**的声明（`usesForwardData` 必须 false、`dataThroughRelativeDay ≤ 0`）；`usesForwardData=true` **无法注册** ⇒ 未来结果类变量进不了策略特征。
- ⚠️ **`bar.<派生字段>` 经桥接表映射为特征 id**（`DERIVED_BAR_FIELD_TO_FEATURE_ID`）⇒ 改桥接表必须同查 3 处：`ruleGraph.collectRuleFeatureReferences`（已纳入桥接）/ `fieldReference.parseCoreFieldReference` / `featureRegistry` 内置特征。
- ⚠️ **静态泄漏审计只在证得出时报警**：无 `WINDOW` 时不设 A4 界（交运行时关卡），避免误杀合法定义。
- 🔴 **接产未做（N-02，高）**：`loopRun(useRealData)` / `strategyEvaluation` / `conditionSignal/compile.ts` **仍走 legacy** ⇒ Core「已建成未通电」。另 `StrategyRunSnapshot` **未落库**（N-01）、阈值型出场（TAKE_PROFIT/STOP_LOSS/TIME_EXIT）因需「入场价/入场日」运行态引用**仍在 `exitRules` 以声明保留**（N-03）。
