# stock-limit-up-analyzer 硬禁令索引

> 细则真源 = `.workbuddy/memory/PROJECT_RULES.md`。本文只留跨会话必须复用的判据。

## 三门
1. 🔴 改 `server/**` 热重启会**杀死在途 Run** ⇒ 用户在用时禁改 server、禁跑重库脚本。**在途 = `RUNNING`（唯一）**；`PENDING` + 空 `inputSnapshot`/`startedAt` = 未执行草稿、禁收敛。`client/**` 只走 HMR。
2. 🔴 禁 `pnpm/npm install`、新增依赖、`prettier --write`、`db:push`、`drizzle-kit generate`、手写 `_journal.json`。

## 环境 / 工具链
- 端口每轮会变 ⇒ 先 `netstat | grep LISTENING`。**`curl` 走代理**（连 127.0.0.1 都 502，`--noproxy` 不可靠）⇒ 用 **Node `fetch` + `localhost`** 探端点。
- Bash 须自带长 PATH（git = `PortableGit/versions/1.2.0/cmd`、Unix 工具 = 同版 `usr/bin`）；git/node 不认 MSYS `/c/...` ⇒ 传 `C:/...`；后台用 `run_in_background`（末尾禁 `&`）；PowerShell stdout 不回显 ⇒ 写文件再读。
- git 写入可能被外部回滚 ⇒ 每次操作后复核 `rev-parse HEAD`；并发改文件用 `find server -type f | wc -l` 前后比。🔴 `refs/remotes/origin/main` 会丢 ⇒ 只信 `git ls-remote` / `FETCH_HEAD`；合流 `ls-remote` → `fetch` → `merge --no-ff`，`ROADMAP*`/memory 冲突**两侧都保留**。
- 🔴 GitHub 只在「非沙箱 + 清空 `*_PROXY`」可达 ⇒ `dangerouslyDisableSandbox` + `env -u HTTP_PROXY … git …`。
- 写文件用 Python bytes + `os.replace` + 回读。源码禁 `\uXXXX`；🔴 模板字符串内禁嵌反引号。
- 🔴 裸子串断言会假失败（新注释常引用旧标识符）⇒ 判据带形态。DOM 文本判据禁短词（`'参数'` 会被侧栏「参数搜索」抢先）⇒ 用主体唯一长锚点。
- 探针 → `docs/evidence/`；一次性脚本 → `C:\work\sourcecode\_scratch\`；报告 → `docs/research/`。测试基线 **8 文件失败 / 17 用例**（判据 = 失败**文件集合**）。
- ✅ 前端验收 = 无头 Chrome `--headless=new --user-data-dir=<tmp> --remote-debugging-port=<随机>` + Node `WebSocket` 直连 CDP **量 DOM**；⚠️ 探针输出必须落盘。`agent-browser`/`jsdom` 不可用。
- 🔴 CDP 三坑：只听 `responseReceived` 会漏在途请求（并听 `requestWillBeSent`）；toast 须高频轮询（4 秒消失）；模板串里正则 `\s` 会被吃 ⇒ 用 `includes`。

## 行尾（逐文件实测，禁推断）
- 🔴 工作区多为纯 CRLF 而 HEAD blob 纯 LF，`git status/diff` **全看不见** ⇒ 改前先 `node scripts/checkEolDrift.mjs`（只看「已修改」文件，报 0 ≠ 全仓健康）；唯一依据 = HEAD blob，恢复用 `git cat-file -p <rev>:<path>`。
- 🔴 HEAD 与工作区**字节差 == 行数** ⇒ 纯行尾漂移（归一化后 numstat 才真实）。
- 🔴 写文件必须 `open(p,"wb")` + `.encode("utf-8")`。**纯 LF**：`ROADMAP*`、`.workbuddy/memory/*`、`docs/**`、`server/**`、`client/**`；**纯 CRLF**：`client/src/App.tsx`、`client/src/components/AppShell.tsx`、`.workbuddy/memory/PROJECT_RULES.md` ⇒ 仍须实测。
- ⚠️ 读 CRLF 做行手术须 `open(..., newline="")`；🔴 判行尾禁 `grep -c $'\r'` ⇒ 只认 Python `b.count(b"\r\n")` vs `b.count(b"\n")`。

## 总控
- `ROADMAP.md` 唯一 Master Control（§44 覆盖式 / §44.5 队列 / §47 append-only）；**仅 `RESEARCH_READY=TRUE` 允许策略结论**。
- §44.5 取号真源 = 「编号台账」行（禁「末条 +1」）且**先对远端台账**；文件头铁律行 + 台账行**两处都同步**。禁同批次并发多 Edit。

## 回测 / 评估端口
- Dataset 坐标 = `dataset_version.id`；Strategy SoT = `strategy_versions.strategyDocumentJson`；**零 FK**；`promote` 是唯一 `CONVERTED` 入口。
- ✅ `assemble.ts#requireRecipe` 三路：①带 `recipe` → 注册表 ②**有条件无 recipe** → 现场编译 ③皆无 → 显式兜底；`recipeSource` 第三值 `strategy-declarative-conditions`。🔴 ①必须先于②；🔴 等价改写**方向翻转**（`haircut lte 0`）；表外写法抛 `CONDITION_NOT_MAPPABLE`，禁回落默认配方。
- 🔴 **唯一评估端口 = `server/research/strategyEvaluation/`**：`evaluateStrategyParameters({strategyDocument, parameterOverrides?, dateRange, dataset?, datasetVersionId?, dataReady?, createdAt, codeVersion})`；子链 = 前 5 阶段；主输出字段是 **`evaluation`**（含 `equityCurve`），不是 `performance`。禁手写 dataset→engine→simulator 子链。
- 🔴 **`dataReady: true` 必须显式传**（`runAudit.ts:74` 缺省 false）⇒ 否则 `gate = INCONCLUSIVE` + `CL_DATASET_GATE_NOT_PASS`（易误判成「数据链未认证」）。
- 🔴 `resolveParameters` 覆写键必须在 `document.parameters` 内，否则 `RECIPE_PARAMETER_UNKNOWN`。
- 🔴 `DatasetSourceKind` = `registry` / `rebuild` / **`injected`**；给 `researchDataset` 则跳过一切数据集解析。
- 🔴 `backtestBridge.ts#createStrategyBacktestBridge` = 「参数集 × 区间 → 标量 + 权益曲线」唯一实现（按区间缓存）。
- 🔴 策略参数空间必须 `deriveParameterSpaceFromDocument` 派生；legacy 8 维度对策略文档不存在。
- 🔴 单组评估约 3 分钟 ⇒ 搜索只能 `random` + 小 `budget`；1240 组全网格会同步阻塞。⚠️ 长跑后 DB 查询会瞬时失败（连接池）；真实列名禁凭记忆写 SQL；性能只认「交错 ≥3 轮取中位」。
- 🔴 `marketRegimeRouter` 不是参数评估 router ⇒ 落点②只涉及 `paramSearchRouter` + `walkForwardRouter`。

## 运行工作台 / 留档
- 🔴 直读桥 = `runWorkbenchAssembly/datasetFromRegistry.ts`（禁第二套实现）；决策日资格 = `rd ∈ [obs.start, obs.end]`；窗口只认策略声明。
- 🔴 `securityId` = canonical `sec_<uuid>`（`engineKeyBridge` 按自身 `tradeDate` 桥接）；板块判定用 `row.code`。
- 🔴 回落重建须继承 universe 约束并抛 `UniverseConstraintError`（错用 `RegistryDatasetBridgeError` 会被吞 ⇒ 静默全市场）。
- 🔴 `loopRun` 留档 `closed_loop_backtest_run`（与 legacy `backtest_runs` 不同表、禁互灌）；`dateRange` 必填；`experimentId` 须 `EXP-YYYYMMDD-XXXXXXXX`；14 阶段有执行器 8 个。

## 前向纸面 / 指数同步
- 🔴 交易日历唯一来源 = `index_daily`（停更 ⇒ `datesToAdvance` 恒空、**静默 no-op 却报成功**；补数必须 `--force`）。
- 🔴 齐平判定必须传 `referenceDate`（= `stock_daily_prices` 最大 `tradeDate`），否则 30 天容差把「落后 1 日」判成已齐平。
- 🔴 `market_data` 两列均 NOT NULL ⇒ **只能整行写**（禁占位值）；缺口判据 = `getSyncStatus.pendingDates`（>1 才缺口，禁 `hasTodayData`）。
- 「某天为何不出现」：三链互不相干（前向纸面 / 组合回测 / legacy）；四环节缺一即不出（日历末端 / bar 覆盖 / 数据集窗口 / 已推进）。

## 页面 / 口径 / 暗色
- 🔴 侧栏高亮 = 分段精确匹配 + **取最长命中**（`AppShell.tsx#isPathActive`，禁 `startsWith`）；详情页点亮父项。
- 🔴 主题：`localStorage["theme"]` 显式值优先，否则跟设备（`client/index.html` 内联脚本防闪白）；**点一次即写死偏好**。
- 🔴 运算符两形：定义侧名称形 vs 草图符号形，只在 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 译；换数据集同动三处。
- 🔴 门槛型条件必须 `gated` 配方；`signalBuilder` 是工厂 ⇒ 先 `resolveParameters`。`client/**` 禁 import `server/**`/`shared/**` 运行时值；免责声明不得删；`RESEARCH_READY` 不因「结果可看」变 TRUE。
- 🔴 策略页 `/strategies` + `/strategies/:strategyId`（新建草稿须清空 `strategyId`）；规则编辑 = 七段表单（JSON 模式已删），有 `definition` 时禁回送五个 v1 视图（`SCHEMA_DEFINITION_VIEW_CONFLICT`）。
- 🔴 生成物禁手改：`client/src/theme/darkCompatibility.css`（新增 Tailwind 颜色类须重跑生成器）；favicon（`_gen_favicon_svg.mts` / `_gen_favicon_assets.mjs`）。坑：XML 注释内禁连续两个短横线；CSS oklab vs SVG sRGB 须多色标逼近，对拍先设**日间**配色。

## 组合回测分仓（`9bc`）
- 🔴 `/backtest` 并存两套交易语义：①快照面板 = legacy 模拟器，套用分仓下拉（权威 = `positionBudget.ts#allocatePlannedBudgets`，等权 = 现金 ÷ 笔数）；②`realisticSimulation` = 生产 Engine，**每笔固定 100 股**（`engine.ts:117`），不读分仓。⚠️ 非等价（`engineNonEquivalence.test.ts`），页面已加 `[data-portfolio-provenance]`。
- 🔴 「准备买入」显示 100% 不是算错：等权 = 现金 ÷ 本批笔数。**固定单笔 = 初始资金 × 20%**；系统内无「权益 ÷ maxPositions」口径；**用户已明确不设上限 ⇒ 禁自行加 cap**。⚠️ 改分仓口径会重算全部历史回测数值 ⇒ 必先经用户授权。
- 🔴 比例只在表格里：持仓表 tfoot 分母 = 同一模拟器同一截止日 `finalCapital`；准备买入表含「股数待次日开盘价确定」，禁以假设价格估算股数。
- ⚠️ 待收敛：`server/paperTrading.ts:374-386` 内联了第二份等价分配实现（违反唯一权威）。

## 交易模式单一真源（PATTERN-LIBRARY-001）
- 🔴 模式唯一真源 = `server/research/patternLibrary/patterns/*.ts`；新增一种 = 1 个声明文件 + `patterns/index.ts` 1 行。禁再往 `moduleRegistry.ts` 写工厂、禁再往 `recipeRegistry.ts` 写配方字面量。
- 🔴 声明层只允许 `import type`；投影唯一 = `project.ts` + `projectRecipe.ts`。
- 🔴 顶层常量互相 import ⇒ **运行时炸而 `tsc = 0`** ⇒ 注册表必须惰性单例；执行侧运行时原子在 `recipeRegistryAtoms.ts`，`recipeRegistry.ts` 只 re-export。
- 🔴 候选创建可传 `patternId`（`researchPlannerRouter.ts#createCandidate`）⇒ 自动带 `entryRule.extra.recipe` + `parameterSpace`；不传则与既往完全一致。

## 策略文档 / 候选草图坐标
- 🔴 配方引用在 **`document.recipe`（顶层）**，不是 `document.definition.entry.recipe`（不存在）；`assemble.ts:461` 读它。
- 🔴 `strategies` 表两个身份列：`id`(INT) 与 `strategyId`(varchar) ⇒ 清理一律用 `strategyId`；对 `id` 传字符串报 `Truncated incorrect INTEGER value`（会让行数守恒假装通过）。
- 🔴 `patternId` 路径下候选写 `filterRule:{groups:[]}` 是刻意的：研究侧变量名无策略侧翻译；筛选由 `buildGates` 承载，摘要进 `sourceTraceJson.patternGateSummary`。
- 🔴 `buildConditions` 读 `logicalOperator`/`groupLogicalOperator`，非 AND ⇒ 响亮抛错；**组内首条必须放行**。`ConditionDefinition` 无逻辑位字段。
- 🔴 候选草图的键白名单必须与服务端契约**等宽**（`candidateSketchForm.ts`）：`PARAMETER_SPACE_ROW_KEYS` 8 键，其中 `parameterRole`/`defaultValue` 真被读（`definitionBuild.ts:497`/`:550`，缺 `defaultValue` 抛 `RECIPE_PARAMETER_NO_DEFAULT`），少一个整块降级为「原样展示」；⚠️ `CONDITION_ROW_KEYS` **仍缺 `note`**（`:468` 读它写 `condition.description`）⇒ 已转正候选（如 360008）的 filterRule 块仍降级。🔴 **改服务端参数/条件契约必须同查前端三处**：白名单 / `CandidateSketchFields.tsx` / `CandidateSketchCard.tsx`。空串 = 不声明，禁伪造。

## 前端可达性
- 🔴 `/research/ask` 的 `step`/`questionId` 是内存态 ⇒ 刷新回不到 `OUTCOME`；已补深链 `/research/ask?runId=N`（入口在实验详情页 Run 面板）。后端 `getOutcome` 两身份皆收。
- 🔴 **「接线完成」≠「用户够得到」** ⇒ 前端改动必须用无头浏览器按真实导航路径量一次 DOM。
- 🔴 `createCandidate` 实测 13.2 秒 ⇒ 长请求按钮**必须换文案**；身份判据必须 `questionId ?? runId` 择一（硬判单字段会在另一条路径**静默 return**）。**静默 return 一律换响亮提示**。
- 🔴 `Link` 包 `Button` 必须 `<Button asChild><Link>`（否则 `<a><button>` 非法嵌套）。
- 🔴 清理测试数据前先查引用面（`information_schema.COLUMNS where COLUMN_NAME='candidateId'` —— 本仓 **0 命中**）。
- 🔴 **候选 → 策略可达性**：`/strategies` 只列 `strategies` 表（`strategyService.list()`）⇒ **未转正候选不出现**（符合设计）；候选详情页 `ACCEPTED` 才有「转正为策略」入口，`CONVERTED` 后只写一句「已转正」，**无 `/strategies/:strategyId` 链接** ⇒ 研究侧看不到产物（真实缺口）。

## 研究 Run 运行态 / 孤儿回收（2026-09-18 实测）
- 🔴 **僵尸 RUNNING 的第三种形态**：`reclaim.ts` 的 RUNNING 兜底分支**只在遍历「非终态分析」时**收集父 Run ⇒ **「父 RUNNING + 子分析全终态 + 有结果」永不被自动收敛**（热重启杀在收尾时刻的样子）。实测 `run 930001`：stale 882 分钟、子 28/28 COMPLETED、510 结果行、execLog batch1 停 `RUNNING`，回收器真实调用 = `reclaimedRuns: []`（零写入）⇒ 只能**人工收敛**（`FAILED` + `RUN_ORPHANED` + `completedAt` + Experiment 回滚）。
- 🔴 排查僵尸 Run 顺序：`startedAt` 距今（**库内时间戳是 UTC 墙钟，别再减 8 小时**）→ 子分析状态分布 → `research_result` 行数 → `executionLogJson` 末批 `status/completedAt` → **进程证据**（`Get-Process -Id <pid> | Select StartTime`；⚠️ PowerShell 里 `$pid` 是保留变量）。进程启动晚于 `startedAt` ⇒ 执行者已消亡。
- ✅ **写保护代理取证法**：把真实仓储包 Proxy（方法名命中 `^(create|update|delete|remove|insert|upsert|save|replace|set|purge)` 即抛错，**其余必须 `.bind(obj)`**）后照常调**真实函数** ⇒ 同时得到「真实返回值 + 是否零写入 + 本来要写什么」，避免只读复刻判据造成第二套实现。
- 🔴 **判「候选能否转正」用只读试跑**：`buildStrategyDefinition()` + `validateBuiltStrategyDefinition()` 是纯函数不写库（`_probe_candidate_promote_dryrun.mts`）。已拒形态：条件右值写**算术表达式**（`prefix.rd0.volume * 0.3`）⇒ `PROMOTE_SKETCH_INVALID`。
