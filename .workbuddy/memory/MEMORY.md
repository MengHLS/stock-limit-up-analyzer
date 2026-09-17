# stock-limit-up-analyzer 硬禁令索引

> **唯一细则源 = `.workbuddy/memory/PROJECT_RULES.md`**；本文只是压缩索引，条目均为硬判据。

## 三门
1. 🔴 改 `server/**` 会热重启并**杀死在途 Run** ⇒ 用户在用页面时禁改 server、禁跑重库脚本。**在途 = `RUNNING`（唯一）**（`engine.ts` 全校验通过才置）；`PENDING` 且 `inputSnapshot`/`startedAt` 空 = **未执行草稿、禁收敛**。改 `client/**` 只走 HMR。
2. 🔴 禁 `pnpm/npm install`、新增依赖、`prettier --write`、`db:push`、`drizzle-kit generate`、手写 `_journal.json`。

## 环境（本机）
- 端口只认启动日志（4000 常 busy ⇒ 实跑 4001）。**`curl` 走 HTTP 代理**且 `--noproxy '*'` 不可靠 ⇒ 探端点用 **Node `fetch` + `localhost`**。
- Bash 须自带长 PATH（git 在 `PortableGit/versions/1.2.0/cmd`、Unix 工具在**同版本 `usr/bin`**）；`node -e`/`git` 不认 MSYS `/c/...` ⇒ 传 `C:/...`；后台服务用 `run_in_background`、末尾禁 `&`。
- **git 写入可能被外部回滚** ⇒ 每次 git 操作后复核 `git rev-parse HEAD`。有并发会话动文件 ⇒ 以 `find server -type f | wc -l` 的**前后比对**为判据。
- 改文件用 Python bytes + `os.replace` 原子写 + 回读核对。源码字面量禁 `\uXXXX`（⇒ `UnicodeEncodeError`）；🔴 **模板字符串内禁嵌反引号**（实测改崩过文件）。
- 行数组手术：**连续行块**锚点、**按索引降序替换**、插入新函数前断言「在模块顶层」；改完 `git diff --stat` 断言增删数。
- 🔴 **裸子串断言会假失败**（新注释常刻意引用旧标识符）⇒ 判据要带形态（`**旧文**`/括号/「恰好 N 次且确在引用内」）。本会话踩过 5 次。
- 探针放 `docs/evidence/`；测试 = `tests/`，**基线 8 文件失败 / 17 用例**（判据 = **失败文件集合**，非失败数）。
- ✅ 前端验收 = 无头 Chrome/Edge `--headless=new --user-data-dir=<tmp> --remote-debugging-port=<随机>` + Node 22 内置 `WebSocket` 直连 CDP，**量 DOM**；Chrome 在 `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`；⚠️ 探针输出**必须同步落盘**。`agent-browser`/`jsdom` 不可用。

## 行尾（**逐文件实测，禁推断**；`core.autocrlf=false`）
- 🔴 **禁按「清单」判行尾**：工作区多为**纯 CRLF** 而 HEAD blob 是**纯 LF**，且 `git status`/`diff`/`diff-files` **全看不见**（外部改写保留 mtime ⇒ stat 快速路径跳过）⇒ 改任何文件前先跑 `node scripts/checkEolDrift.mjs`（**只看「已修改」文件，报 0 ≠ 全仓健康**）；唯一依据 = **HEAD blob**；恢复用 `git cat-file -p <rev>:<path>`。
- 🔴 写文件必须 `open(p,"wb")`+`.encode("utf-8")`（Python 文本模式在 Windows 把 LF 写成 CRLF）。**纯 CRLF**：`PROJECT_RULES.md`（改完断言 `crlf == lf`）；**实测纯 LF**：`ROADMAP*.md`、`.workbuddy/memory/*.md`、`docs/research/*.md`。
- 🔴 改完必跑哨兵（曾 `numstat` 报 **+228/-197** 而真实只 **+31**）；排查先比 `git diff --numstat` 与 `--ignore-cr-at-eol`。
- ⚠️ 读 CRLF 文件做行手术须 `open(..., newline="")`（否则 `split("\r\n")` 退化成 1 行）。

## 总控
- `ROADMAP.md` 唯一 Master Control（§44 覆盖式 + §44.5 队列 + §47 append-only）；**仅 `RESEARCH_READY=TRUE` 允许策略结论**。
- §44.5 取号真源 = 「编号台账」行（**禁「末条 +1」**）；§44「上轮实查」每轮只留 1 条。禁同批次并发多 Edit。
- 一次性脚本写仓外 `C:\work\sourcecode\_scratch\`；`docs/research/` 放实施报告，`docs/evidence/` 只放探针。

## 回测 / 评估端口
- Dataset 坐标 = `dataset_version.id`；Strategy SoT = `strategy_versions.strategyDocumentJson`；**零 FK**；`promote` 是唯一 `CONVERTED` 入口。
- ✅ **条件进回测已修（`9aw`）**：`assemble.ts#requireRecipe` ①带 `recipe`→注册表 ②**有条件无 recipe**→现场编译（`conditionSignal/compile.ts`）③皆无→显式兜底；`recipeSource` 第三值 `strategy-declarative-conditions`。🔴 **① 必须先于 ②**；🔴 等价改写**方向翻转**（`bar.low >= prefix.rd0.open` ⇒ `haircut lte 0`）；表外写法抛 `CONDITION_NOT_MAPPABLE` 逐条列出，**禁回落默认配方**。
- 🔴 **评估端口 = `server/research/strategyEvaluation/`**（唯一实现）：`evaluateStrategyParameters({strategyDocument, parameterOverrides?, dateRange, dataset?, datasetVersionId?, dataReady?, createdAt, codeVersion})`；子链 = 前 5 阶段（其余如实 `SKIPPED`）；主输出字段是 **`evaluation`**（`ClosedLoopEvaluationRef`，含 `equityCurve`），**不是** `performance`。**禁**手写 dataset→engine→simulator→evaluate 子链。
- 🔴 **`dataReady: true` 必须显式传**（`runAudit.ts:74` 缺省 `false`；`:145-149` 的 `PASS` 判据含它）⇒ 否则 `gate = INCONCLUSIVE`、闭环 `data` 阶段以 `CL_DATASET_GATE_NOT_PASS` 阻塞。⚠️ **极易误判成「数据链认证未达成」**。
- 🔴 `resolveParameters(schema, overrides?)`：覆写键**必须在** `document.parameters` 里，否则抛 `RECIPE_PARAMETER_UNKNOWN`。
- 🔴 `DatasetSourceKind` 三值 `registry` / `rebuild` / **`injected`**；给 `researchDataset` 则**跳过一切数据集解析**。
- 🔴 `backtestBridge.ts#createStrategyBacktestBridge` = 「参数集 × 区间 → 标量 + 权益曲线」唯一实现（按区间缓存数据集）。
- 🔴 策略路径参数空间**必须从文档派生**（`deriveParameterSpaceFromDocument`）；legacy 8 维度对策略文档不存在。
- 🔴 单组策略评估约 **3 分钟** ⇒ 参数搜索只能 `random` + 小 `budget`；全网格 1240 组会**同步阻塞**。
- ⚠️ **长跑后 DB 查询会瞬时失败**（连接池）⇒ 先单独验证读函数，别当代码缺陷。
- 🔴 **`marketRegimeRouter` 不是参数评估 router**（无 `MAPPABLE_PARAMETER_DICTIONARY`）⇒ 落点② 只涉及 `paramSearchRouter` + `walkForwardRouter`。

## 运行工作台 / 留档 / 成交明细
- 🔴 直读桥 = `runWorkbenchAssembly/datasetFromRegistry.ts`（**禁第二套实现**）；决策日资格 = `rd ∈ [obs.start, obs.end]`；窗口**只认策略声明**。
- 🔴 `securityId` = canonical `sec_<uuid>`（`engineKeyBridge` 按自身 `tradeDate` 桥接）；**板块判定用 `row.code`**。
- 🔴 回落重建须继承 universe 约束并抛 `UniverseConstraintError`（错用 `RegistryDatasetBridgeError` 会被吞 ⇒ 静默全市场）。
- 🔴 `loopRun` 留档 `closed_loop_backtest_run`（与 legacy `backtest_runs` **不同表、禁互灌**）；`dateRange` 必填；`experimentId` 须 `EXP-YYYYMMDD-XXXXXXXX`；14 阶段**有执行器 8 个**。

## 前向纸面 / 指数同步 / 大盘
- 🔴 交易日历**唯一来源 = `index_daily`**（停更 ⇒ `datesToAdvance` 恒空、**静默 no-op 却报成功**；补数**必须 `--force`**）。
- 🔴 **齐平判定必须传 `referenceDate`**（= `stock_daily_prices` 最大 `tradeDate`），否则 30 天容差把「落后 1 个交易日」判成已齐平。
- 🔴 `market_data` 一行两列（`turnover` + `marginBalance` 均 NOT NULL）⇒ **只能整行写**；缺口判据 = `getSyncStatus.pendingDates`（**>1 才缺口**）。
- 「某天为何不出现」：三链互不相干（前向纸面 / 组合回测 / legacy）；四环节缺一即不出（日历末端 / bar 覆盖 / 数据集窗口 / 已推进）。详版见 `PROJECT_RULES.md`。

## 页面 / 口径 / 暗色
- 🔴 **侧栏高亮 = 分段精确匹配 + 取最长命中**（`AppShell.tsx#isPathActive`；**禁 `startsWith`**）。
- 🔴 **主题**：`localStorage["theme"]` 显式值优先，否则跟设备；**点一次切换即写死偏好**。
- 🔴 运算符两形：定义侧**名称形** vs 草图**符号形**，只在 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 译；换数据集**同动三处**。
- 🔴 门槛型条件必须 `gated` 配方；`signalBuilder` 是工厂 ⇒ 先 `resolveParameters`。`client/**` 禁 import `server/**` 运行时值；`RESEARCH_READY` 不因「结果可看」变 TRUE。
- 🔴 **暗色兼容层** `client/src/theme/darkCompatibility.css` 是**生成物禁手改**（新增 Tailwind 颜色类须重跑生成器）。

## 交易模式单一真源（PATTERN-LIBRARY-001 · 2026-09-17）
- 🔴 **模式唯一真源 = `server/research/patternLibrary/patterns/*.ts`**；新增一种模式 = 1 个声明文件 + `patterns/index.ts` 1 行。**禁**再往 `moduleRegistry.ts` 写工厂、**禁**再往 `recipeRegistry.ts` 写配方字面量。
- 🔴 声明层（`patternLibrary/types.ts` + `patterns/**`）**只允许 `import type`**；投影唯一 = `project.ts` + `projectRecipe.ts`。
- 🔴 **顶层常量 + 互相 import ⇒ 运行时炸而 `tsc = 0`**（`TypeError: buildPatternModuleSpecs is not a function`）⇒ 注册表都是**惰性单例**：`defaultResearchModuleRegistry()` / `registeredRecipes()`。
- 🔴 执行侧运行时原子在 `server/research/recipeRegistryAtoms.ts`；`recipeRegistry.ts` 只 re-export。
- 🔴 **候选创建可传 `patternId`**（`researchPlannerRouter.ts#createCandidate`）⇒ 自动带 `entryRule.extra.recipe` + `parameterSpace`；不传则与既往完全一致。

## 策略文档坐标（PATTERN-LIBRARY-001 全链验收实测）
- 🔴 **配方引用在 `document.recipe`（顶层）**，**不是** `document.definition.entry.recipe`（后者不存在）⇒ `assemble.ts:461` 读的正是 `document.recipe`。⚠️ 断言位置必须回源码核对。
- 🔴 **`strategies` 表两个身份列**：`id`(INT 自增) 与 `strategyId`(varchar) ⇒ 清理一律用 `strategyId`；对 `id` 传字符串报 `Truncated incorrect INTEGER value`（**会让行数守恒假装通过**）。
- 🔴 **`patternId` 路径下候选写 `filterRule:{groups:[]}` 是刻意的**：研究侧变量名无策略侧翻译，写进去 promote 必失败；筛选语义由 `buildGates` 承载，摘要进 `sourceTraceJson.patternGateSummary`。
- 🔴 **P0-1 已修（响亮拒绝）**：`definitionBuild.ts#buildConditions` 读 `logicalOperator`/`groupLogicalOperator`，非 AND ⇒ 抛错；**组内首条必须放行**（引擎本就忽略它，误拒反而错）。`ConditionDefinition` **没有**逻辑位字段。

## 前端可达性（2026-09-17）
- 🔴 `/research/ask` 的 `step`/`questionId` 是**内存态**（`ResearchAsk.tsx:96/101`）且 `getOutcome` 的 `enabled` 依赖后者 ⇒ **刷新页面永远回不到 `OUTCOME` 步骤** —— 而「交易模式」下拉只在那里（`:1162`，包在 `candidateEligibleAnalyses.length > 0` 分支里）。
- 🔴 已补**深链** `/research/ask?runId=N`（或 `?questionId=N`）：`readDeepLink(search)` ⇒ `step` 直接进 `RUNNING`，`isRunReportable` 成立即自动切 `OUTCOME`。后端 `getOutcome`（`researchPlannerRouter.ts:380-391`）**本就同时接受 `questionId` 与 `runId`**。
- 🔴 入口在实验详情页 `/research/:experimentId` 的 Run 面板（`ResearchDetail.tsx`）。下拉前置 = 该 Run 至少一条带条件分析（判据 `aggregate.ts:301-305` 的 `conditionCount > 0`）；诊断探针 `_probe_visible_pattern_entry.mts`。
- 🔴 `isRunReportable` = `analysisCount > 0 && pendingCount === 0 && runStatus ∈ {COMPLETED, FAILED}`（`researchAskForm.ts:286-290`）。
- 🔴 **教训：「接线完成」≠「用户够得到」** ⇒ 交付前必须用无头浏览器量一次 DOM。
- 🔴 **`createCandidate` 实测 13.2 秒**（服务端跑 `buildResearchOutcome` 全量聚合）⇒ 长请求按钮**必须换文案**（只 `disabled` + 小 spinner 会被当成「坏了」）；前端身份判据必须 **`questionId ?? runId` 择一**（服务端 `:463-497` 两者皆收）—— 硬判 `questionId === null` 会在深链模式下**静默 return**（本轮真踩）。
- 🔴 `Link` 包 `Button` 必须写 **`<Button asChild><Link>`**（否则渲染成 `<a><button>` 非法嵌套）；既有范式见 `ResearchList.tsx:87-91`。
- 🔴 **CDP 探针三坑**：只监听 `Network.responseReceived` 会漏「已发出未响应」⇒ 同时听 `requestWillBeSent`；取 toast 必须**高频轮询**（sonner 默认 4 秒消失，等 9 秒必空）；**模板字符串里的正则 `\s` 反斜杠会被吃掉**（用 `includes` 替代）。
- 🔴 验收清理测试数据前先查引用面：`information_schema.COLUMNS where COLUMN_NAME='candidateId'` —— 本仓 **0 命中** ⇒ 删候选行不留孤儿。
