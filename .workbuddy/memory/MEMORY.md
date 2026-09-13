# stock-limit-up-analyzer 长期约定（硬禁令索引）

> 只留「不知道就会做错」的硬禁令；**细则全在 `PROJECT_RULES.md`，动手前先读对应章节**。证据 → `ROADMAP.md` §44/§44.5 + `ROADMAP-CHANGELOG.md`（原 §47）；逐日 → `memory/YYYY-MM-DD.md`。

## 动手前三条
1. 先读 `PROJECT_RULES.md`（「启动与本机环境」含 Bash 所需长 PATH）。
2. 🔴 **改任何 `server/**` 会热重启并杀死在途研究 Run**（永久卡 `RUNNING`、无恢复入口）⇒ 用户在用页面时禁改 server 文件、禁跑重型真实库脚本。动手前先只读查 `research_runs` / `research_analysis` 有无在途。
3. 🔴 禁 `pnpm/npm install`（SIGTERM）、新增依赖、`prettier --write`、`db:push`/`drizzle-kit generate`、手写 `_journal.json`（属伪造）。

## 环境速查
- `pnpm run dev`；端口取 `.env` `PORT`（本机 3000；8000~9000 为 Windows 保留段）。
- 读输出用 Bash（PowerShell 只回退出码）；Bash 必须前置长 PATH → `PROJECT_RULES.md:64`。
- **`ROADMAP.md` / `ROADMAP-CHANGELOG.md` 用 Read/Grep，禁 `sed`/`head`/`cut`**；🔴 **本机无 `agent-browser`**、仓库无 `jsdom`/`@testing-library` ⇒ 前端验收**禁写「浏览器截图」**，改用真实 tRPC 取数 + 纯函数复用 + 真实 DB。
- 🔴 时间戳：库内 = UTC 墙钟，`executionLogJson` 内 = ISO 带 Z（差 8h）⇒ 写传字符串字面量，读用 `DATE_FORMAT(...)`。
- 🔴 **证据簇坐标 = `docs/evidence/`**：历史文档里的裸 `_xxx` 一律指向该目录；该目录**不进 `tsc`/vitest**；在**项目根目录** `npx tsx docs/evidence/<name>` 运行。**禁把新探针写回根目录。** heredoc 会破坏 `.mts` ⇒ **必须用 Write 工具**。⚠️ **`npx tsx -e` 内联脚本常无输出 ⇒ 必须写文件。**
- 🔴 **测试文件坐标 = 仓库根 `tests/`**；**5 类位置敏感写法见 `PROJECT_RULES.md`「测试文件布局」**（漏改第 3/4/5 类会**静默失效**）。
- ⚠️ **测试失败基线 = 7 文件 / 15~16 例**（`dataHealth`/`image`/`limitUp`/`limitUp.watch`/`marketData`/`tushare.secret`/`tushareTradingCalendar`）；**判据是失败文件集合、不是案数**。**禁取一次 `grep FAIL` 定性** —— `datasetRegistry/runner`、`backfill/scheduler` 并发下会**假失败**（首次 grep 9 文件、稳定复跑 7 文件）。

## 总控（强制）
- `ROADMAP.md` 唯一 Master Control：§44 覆盖式 + §44.5 队列 + §47 append-only（**§47 正文在 `ROADMAP-CHANGELOG.md`**）；每任务完成必须更新三者。
- 7 态 `DESIGN/CODE_READY/DATA_READY/VALIDATED/RESEARCH_READY/PRODUCTION_READY/BLOCKED`；**只有 `RESEARCH_READY=TRUE` 才允许策略结论**。
- ⚠️ 同一文件禁同批次并发多 Edit；仓库常有并行会话 ⇒ 唯一锚点 + 单次 Edit。
- 命名（§49）：模块/文件/目录禁带 STEP 编号或数字后缀；先查重。⚠️ **编号会撞车**：`RESEARCH-006/007/008` 已占用 ⇒ 架构线 `.0/.1/…`；分析线 `009/010/007.1/007.2`。
- 🔴 **往长文档插入时 `old_string` 必须锚定「完整、唯一、能自证边界」的片段**；从条目**中段**匹配会吃掉其开头标记。写完**必须 grep 断言插入点两侧原有标记仍在**。
- 🔴 **`ROADMAP.md` §44.5 的 `9x.` 编号已排到 `9ad.`，新条目从 `9ae.` 起**；插入前 `grep -oE '^   - \*\*9[a-z]+\.' | sort -u` 查占用。

## 铁律（细则见 PROJECT_RULES.md）
- 优先级（正确性 > 数据真实性 > PIT > 架构 > 测试 > 速度）；**禁 mock 冒充真实数据**。
- 🔴 **Dataset 唯一坐标 = `datasetVersionId = dataset_version.id`** ⇒ 禁第二套 ID、禁绕 Registry 直读 `ds_*`。
- 🔴 **Strategy 唯一 SoT = `strategy_versions.strategyDocumentJson`**；5 投影单向派生、禁反向生成、漂移不自动修复。
- 🔴 涨停价**四舍五入到分** + 比例 PIT 感知（ST=5%）；窗口左边界必须预热。
- 🔴 **零 FK**（完整性靠应用层 + 事务）；**Migration**：`drizzle/schema.ts` → 手写 SQL → 幂等 apply + `information_schema` 断言；**声明 ≠ 线上真实，必须查真实库**。
- 🔴 **Research → Strategy 桥**：唯一桥目录 `server/research/strategyCandidate/`；`promote` 是唯一 `CONVERTED` 入口（入参只有 `{candidateId, overrides?}`，**禁提交完整 StrategyDefinition**）。✅ **`cloneVersion` / Backtest 都已存在**（`strategyPersistence/service.ts:275` / `server/backtest/**` + `server/strategy/strategyBacktest.ts`）。
- 🔴 **「条件进不了回测」= Research→Strategy→Backtest 链路真断点**（2026-09-13 实证）：① `definitionBuild.ts` **已把** `filterRule` 正确翻成 `definition.entry.conditions`（真实字段引用）；② 但 **`assemble.ts` 对 `entryRules` 引用数 = 0**、`server/backtest/` 与 `server/strategy/` 对 `definition.entry.conditions` 引用数 = 0；③ 全仓**只注册 1 个配方** `leader-candidate-baseline`（`pctChange` + `topN:5`），3 份文档 `recipe` 全缺。⇒ **根因是架构性的**：`Strategy13` 携带**函数实例**（`FeatureProvider.compute`/`SignalBuilder`）**无法从 DB JSON 还原** ⇒ 真实实例必须按 `recipeId` 在代码库注册。**⇒ 想让条件真进回测，唯一正路 = 在 `recipeRegistry.ts` 注册真实配方 + 让候选草稿带上 `recipeId`；禁靠 promote 注入定义。**
- 🔴 **Research 分析层硬边界**：无四段配置对象/无编码列/无多视界矩阵/无二维交叉；`CONDITIONAL` 不产 P25/P75；**一 Run 只一条结论**。
- 🔴 **分析口径与桶纪律**：`segment_return_{a}_{b}d = close(T+b)/close(T+a) − 1`（锚定日收盘建仓、raw 未复权）；`390002` **未启用回踩筛选** ⇒ 样本 = 全部首板事件（23,978）；桶须写明开闭 + 「加总 = 全集」闭环；**附送的 `MAX_DRAWDOWN` 行不要读**；滚动资格 `min(low[T+1..T+d]) >= open(T)` 现有模型表达不了（最小扩展 = `EVENT_LOW_GUARD_BASES` 加 `"open"`）。
- ✅ **前端研究域（候选草图 · 纯 `client/**`）**：**五块结构化表单**（禁退回 JSON 文本框；表达不了整块降级只读 `raw` 且 `raw` 永不进补丁）、**七段决策顺序**（①买什么 ②**什么条件买**（可空）③什么时候买 ④怎么卖 ⑤买多少 ⑥成本 ⑦参数空间）、**`filterRule` =「买入条件」且归属 `condition` 段**（**禁标成「剔除」**）、缺口**必须说清差哪一项**、结果页签**默认矩阵视图**。细则 → `PROJECT_RULES.md`「前端候选草图」。
- 🔴 **必填性只能去校验器里数，禁从字段名反推**。现有转正必填 = **10 项**（`entryRule.event`/`timing`/`observationWindow`(3格)/`trigger`/`quantityMethod`/`lotSize`/`sizingMethod`/`maxPositions`/`initialCapital`/六项费率）。
- 🔴 **`filterRule` 归属段 = `condition`**：原 `when` 一段**同时装**可空的「什么条件买」与**三项全必填**的「什么时候买」⇒ 用户连四轮投诉「什么价买永远还差一箱校验」的真实机理。**禁把这两件事再塞回同一段**。
- 🔴 **段数变更触发 `Record<SketchSegmentKey,…>` 穷尽性检查**（**防线不是障碍**）；必须同步查：`SKETCH_SEGMENTS`/`SKETCH_SEGMENT_REQUIRED`/`SKETCH_BLOCK_HOME_SEGMENT`/`SEGMENT_READONLY`/`CandidateSketchFields.statuses[]` 下标/测试段顺序断言。
- 🔴 **压文案时免责声明不得删**：`ConclusionPanel` 的 `evidence.disclaimer`（琥珀框）与矩阵/结果页的「**不是交易信号 / 未做多重比较校正**」是**合规内容**。

## 缓存与性能（三铁律）
- 🔴 ① **「热调用 ≈0ms」才是缓存生效的判据**（`getLeaderCandidates` 号称有缓存但热调用仍 23.7s = 等于没缓存；修后冷 45.3s → **热 1ms**）。② **TTL 与单飞解决不同问题** —— TTL 消除「时间上重复」、单飞消除「空间上并发」，**数十秒级计算两者都要**。③ 🔴 **失效要精准** —— `createLimitUpRecordsBatch` 是**逐批（每 100 条）调用失效函数**，把 890 万行全表聚合缓存加进失效清单会放大成数十次全表扫描。**加失效前先问「这个写入函数的调用频率」。**
- 🔴 **性能修复先测速再动刀；用户给的方向是线索不是结论**（用户说「分页、缓存加快加载」，实测分页早已做完、回测早有缓存，真瓶颈在无人看的地方）。
- 🔴 **性能结论只能用「交错重复 ≥3 轮取中位」得出**：同一操作波动 **1.5~2.4×**；**单次采样差值 <2× 视为噪声**。反面教材：曾据**单次**采样写下「跨境链路反并行、3.45× 惩罚」，交错 5 轮实测 **0.96×**。
- 🔴 **Drizzle 报错的 `query: 7.969s` 是「排队 + 执行」总和，不是执行时间**：`liquidity_daily` 901.5 万行、复现查询仅 229~587ms ⇒ **先证 SQL 无罪，再查耗时来源**。大表 + 大耗时最易误判成「该加索引」。
- 🔴 **运行工作台耗时 = 分钟级，属真实工作量**：`buildResearchDataset` 主成本 = `fetchLimitUpCandidateBars`（**5,615ms per 30 交易日 × 23 片 ≈ 129s**）；`loopRun` 是**一次性同步长请求** ⇒ 前端无进度反馈。**`compress` 必须保持开启**（3130ms vs 8039ms，**2.57×**）。

## 数据层已知坑
- 🔴 **mysql2 `idleTimeout` 不是无条件生效的**：`lib/base/pool.js` 的 idle 回收定时器**只在 `maxIdle < connectionLimit` 时启动**；二者相等时 `idleTimeout` 是**死配置**、`getConnection()` 从 `_freeConnections` 直接 `pop()` 且**无存活探测/ping** ⇒ 跨境长 RTT 下死连接被原样发出（`Failed query: ...` + 沿 `cause` 链的 `ECONNRESET`）。**修复 = `maxIdle: poolSize - 1`**（已修）。⚠️ 探针里跨轮次重复查询也会撞 `ECONNRESET` ⇒ **重跑一次即可**。
- 🔴 **`withReadRetry`（`server/researchEngine/readRetry.ts`）= 只读安全的有界瞬时错误重试**：沿 `cause` 链识别 Drizzle 包装错误，默认 3 次 / 退避 300→900ms。**语义错误不重试**。新增只读查询应主动接入，**不要吞错、不要自造重试**。
- 🔴 **编排器硬规则**（`closedLoop/orchestrator.ts:338-350`）：任一阶段阻塞 ⇒ **其后继全部 `CL_UPSTREAM_BLOCKED`** ⇒「补一个执行器」≠ 该阶段会执行，**必须整链前驱都已装配**。`coverage.ts` 的「已覆盖」判据 = **`wired && inputsSatisfied && predecessorCovered`** 三者与（只看 wired 会高估）；已加 canonical 前驱门（用 `CLOSED_LOOP_STAGE_PRODUCED_KIND` 反查，**禁用 `CONSUMED_KIND`，会自引用**）。
- 🔴 **真实表名/列名（禁凭记忆写 SQL；探针 `docs/evidence/_probe_table_columns.mts`）**：
  - `research_analysis`（**无 `startedAt`**）；`research_analysis_condition`（**`analysisId`/`groupNo`/`sortOrder`/`fieldName`/`operator`/`valueJson`/`logicalOperator`/`groupLogicalOperator`** —— **非** `groupIndex`/`field`）；`research_analysis_metric`
  - `research_result`（**非** `research_analysis_result`；分组判据 = `JSON.parse(dimensionJson).group ∈ {ALL, CONDITION}`）
  - `research_conclusion`（**无 `runId`**）；`research_strategy_candidate`（**`experimentId`/`conclusionId`/`strategyDefinitionId`** —— **非** `sourceConclusionId`/`sourceExperimentId`）；**`research_analyses`（复数）不存在**
  - `dataset_version` 窗口列存 **UTC 墙钟**（`2024-08-31T16:00Z` = 东八区 09-01 00:00）⇒ 读取时差 8h。
- 🔴 **探针漏加 `datasetVersionId` 会把多版混算**（390001+390002 混算得「事件 25,108」，主版本真实 = **23,978**）。**任何 `ds_*` 聚合必须带版本坐标。**
- 🔴 **「全端点一致 DB 失败 + 零 DB 端点正常」= 池内死连接，先查池、别改代码**（2026-09-13 21:10 实测）：跑完全量 `vitest` 后 `research.strategy.list` / `researchEngine.listRuns` 等**所有**读端点一致 500（`t≈19.2s` ≈ `connectTimeout: 20_000`），而 `readiness`（零 DB）**200**、TiDB 网关 **TCP 0.17s 可达** ⇒ 属上条 `maxIdle` 现象：源码已修但**运行中的进程仍持旧连接**，须等 `idleTimeout`（默认 **10 min**）回收。**实测 t+75s 自行恢复**。⇒ **别把它当成自己刚改出来的回归**；先跑一个零 DB 端点（`readiness`）作对照。
- ✅ **只读性能定案值（桥，勿凭感觉改）**：`EVENT_PAGE_LIMIT=5000`（5.3s，优于 2000 的 8.8s / 10000 的 7.9s）；rd=0 批读 `batch=1000 / conc=池上限16`（1.4s）；**并发用池上限而非工具默认 8**。反面教材：首版 40.8s 的瓶颈是 **60 次串行 `loadRawBarsBatch`**（改 `mapWithConcurrency` → 7.9s），**别把「串行」误判成「库慢」**。

## 运行工作台数据集直读（2026-09-13 16:55 已修 · CODE_READY；细则见 §44.5 #25）
- ✅ **修复 = 新增桥 `server/runWorkbenchAssembly/datasetFromRegistry.ts`**（经 Registry 既有只读接口投影，**禁第二套实现/写 SQL/直连物理表**），`resolveDataset()` **默认 `prefer-registry` 优先直读**，**仅 `RegistryDatasetBridgeError` 回落重建**且原因写进 `assembly.datasetSourceNote`（**其他错误一律上抛，禁把 bug 伪装成「直读不可用」**）。实测：直读 **6.2s / 23,978 行** vs 重建 **60.6s / 96,912 行**（**~10×**）。
- 🔴 **`ds_*` → `ResearchDataset` 桥的投影口径**：**每事件恰产出一行**（`tradeDate = event.tradeDate`，OHLCV 取 `prefix` 的 **rd=0**）；🔴 **`post`（rd≥1）不并入 rows**（未来信息，逐日 PIT 面板禁混入）⇒ 需 T+N 窗口撮合的策略**必须走重建路径**；Registry 未落库的列一律**忠实「未知」**（`UNKNOWN`/null/0/`{}`），**不猜不填零**；对**本次投影内容**重算 `datasetVersion`，**同一份 dataset 对象同时喂 `experimentConfig` 与 `inputs`**。
- 🔴 **`post` 不能并入 rows 是「结构不可能」**：`ds_*` 行语义 = **(事件, 相对日)** ⇒ `post` 同一天天然多行（实测 **95,977 组 `(tradeDate,symbol)` 冲突、单日最多 8 行**），而 `rows` 硬不变量 = `(tradeDate, securityId)` **唯一**（`datasetAccess/handle.ts:109-126`）；`prefix` 的 **rd=0 严格唯一（0 冲突）** ⇒ 只有它够格当决策日行。**禁把「消费侧缺路径」误判成「表要重设计」。**

## 运行工作台「运行策略」按钮（2026-09-13 21:10 已修 · 纯 `client/**`；细则见 §44.5 #27）

- 🔴 **按钮可用性判据 = `wired && !running`，与 readiness 无关**（`RunConfigPanel.tsx`：`wired = typeof onRun === "function"`）。`StrategyEditor.tsx` 已注入 `onRun={handleRun}` ⇒ **恒可点**。readiness `canRun=false` / `verdict=EXECUTOR_NOT_BOUND` **只影响 tooltip**（FE-4 设计：入参齐备的阶段真跑、其余如实 BLOCKED）。⇒ **用户说「按钮点不动」时，先证伪 disabled，再查「点了之后必然失败」的入参。**
- 🔴 **`loopRun` 的两道硬校验（页面默认值曾踩中）**：① `dateRange.startDate` / `endDate` 是 **`.min(1)` 必填**（`shared/researchContracts.ts` 的 `closedLoopDateRangeSchema`）—— **空串直接 400**；② 窗口须 **⊆ 数据集窗口**（390002 = **2024-09-01 → 2026-09-01**），越界抛「超出数据集窗口 … 禁止以部分数据集冒充全窗口运行」。`experimentId` 是**顶层**字段（非 `metadata` 下）且须匹配 `EXP-YYYYMMDD-XXXXXXXX`。
- ✅ **现默认窗口 = `2025-01-02 → 2025-03-31`**（`DEFAULT_RUN_WINDOW`，确定在窗口内的安全子窗）+「重置为默认窗口」按钮；新增 `precheckRunConfig()` 发前挡四类必然被拒输入（空日期 / 起>止 / 坐标缺失 / 开真实数据但 `datasetVersionId=null`），`humanizeRunError()` 把 zod issue 数组转人话。
- ⚠️ **前端默认策略是 `TEMPLATE_DOCUMENT`（未落库）**：`strategyId=limit-up-baseline` / `version=1.0.0`，而**库内真实版本是 `1.1.0`** ⇒ 不先「加载」就点运行会撞版本不存在。库内仅 2 份可加载策略：`cand-270001@1.0.0`、`limit-up-baseline@1.1.0`。
- ✅ **实测跑通基准**：新默认窗口 + `useRealData` ⇒ HTTP 200 / `executedStageCount=5` / `datasetSource=registry` / 23,978 行 / gate=PASS，17~18s。探针 `docs/evidence/_probe_run_workbench_button.mts`（4/4 PASS）。

## 策略定义写法（写定义前必查，凭记忆必错）
- 🔴 **枚举白名单**：`schemaVersion` = **`"1.0"`**；`execution.signalTiming` = `T_OPEN | T_CLOSE`；`execution.executionTiming` = `T_CLOSE | T_PLUS_1_OPEN | T_PLUS_1_CLOSE | T_PLUS_2_OPEN`（T+1 模型 = `T_CLOSE` 出信号 → `T_PLUS_1_OPEN` 成交）；`execution.quantityMethod` = `FIXED_SHARES | TARGET_WEIGHT | AMOUNT`（**≠** `position.sizingMethod` = `FIXED_AMOUNT | FIXED_RATIO | EQUAL_WEIGHT | RISK_BASED`）；`priceType` = `OPEN | CLOSE | HIGH | LOW | VWAP`；`STRATEGY_CONDITION_OPERATORS` = `GREATER_THAN | …_OR_EQUAL | LESS_THAN | …_OR_EQUAL | EQUAL | NOT_EQUAL | IN | NOT_IN`；条件 `valueType` = `CONSTANT | FIELD_REFERENCE | PARAMETER_REFERENCE`；🔴 **`exitRule` 除条件外必须给 `threshold` 或 `parameter` 之一**（否则 `SCHEMA_DEFINITION_EXIT_THRESHOLD_REQUIRED`）。**`ENTRY_TIMING_TO_EXECUTION`**（`definitionBuild.ts:101-110`）：`NEXT_OPEN`→`T_PLUS_1_OPEN`/`OPEN`；`NEXT_CLOSE`→`T_PLUS_1_CLOSE`/`CLOSE`；`SAME_CLOSE`→`T_CLOSE`/`CLOSE` —— 🔴 **`SAME_CLOSE` 被硬拒**（`SIGNAL_EXECUTION_TIMING_CONFLICT`）。
- ✅ **`validateCanonicalStrategyDefinition` 返回 `ResearchValidationResult`，错误在 `result.issues`（不是 `errors`）**。
- 🔴 **校验器只查「结构合法性」，不查「语义等价」⇒ 构造真实定义后必须人工复核**。三处已知偏差：**G1**「回调期最低价」是**累积约束** `min(low[T+1..T+k]) >= 首板日low`，单条只能写 `bar.low >= prefix.rd0.low`（实测量化差：T+1 **0** / T+3 630 / **T+5 = 1,393（逐日 76.0% vs 累积 70.2%，高估 5.8%）**）；**G2** 跨日聚合表达不了；**G3** 窗口内相对引用表达不了。
- ✅ **「T日首板 → 未来5日观察 → 满足条件买入」= 既有模型原生支持**：`entry.observationWindow {1,5,TRADING_DAY}` + `trigger: FIRST_VALID_DAY` + `entry.conditions` 用 `bar.*` 与 `prefix.rd*` 比对。🔴 **`post.rd{n}` 仅在 `n <= earliestSignalOffset` 时放行**（`post.rd6` ⇒ `INVALID_FUTURE_REFERENCE`）；`path.*`/`outcome.*` 属 `labelOnly`，**作信号条件必拒**。「首板回踩 · 量价时三维过滤」完整定义 → `docs/research/STRATEGY-SPEC-first-limit-pullback.md`。
- 🔴 **`ds_*`（390002）实测边界**：`prefix` rd∈[-20,0] / `post` rd∈[1,20] / `event` 多数列 / `outcome` {5,10,20} 完整；`close=high`（实体涨停）23,907/23,978（99.7%）、一字板 706；**🔴 `marketCap`/`floatMarketCap` 100% NULL；`industryCode` 空 99.5%；`indexClose`/分时/开板次数不存在** ⇒ 「高位股/大盘环境/板块题材」**今天无法验证**，「烂板」只能用非实体涨停近似 —— **结论不得声称已验证这些维度**。

## 观察日变量族（2026-09-13 18:55 · VALIDATED）
- 🔴 **三变量角色**：`FEATURE`(≤T) / `OUTCOME`(>T 标签) / **`OBSERVATION`(T+k 当时可见)**。**观察日与结果变量的区别不是「是否未来」，而是「是否在信号时点可见」**。三者 `Sources` 互不包含 ⇒ 编译期 PIT 隔离。**新增变量族必须同步跑一遍 `resolve`**，否则其列被 `columnProjection` 裁掉 ⇒ **静默全 null**。
- 🔴 **`availableFromOffset = k` 是防「事后筛选冒充信号」的唯一防线**：既是装配层「只加载 ≤ 窗口终点」的裁剪依据，也是条件求值「求值日 k 不得引用 > k 的观察日」的 PIT 校验依据（`assertObservationConditionsPitSafe` + `assertGroupPitSafe`）。
- 🔴 **同一物理量不同角色必须分别成组**：`holds_event_low_5d` 是 **`OUTCOME`**（事后标签），`pullback_holds_event_low_3d` 是 **`OBSERVATION`** —— **数值可能相同，语义与时点完全不同**。
- 🔴 **`min_volume` 是绝对股数，与常量 `0.5` 比较恒为假** ⇒「缩量 ≤ 首板日 50%」必须用**比值口径** `min_volume_ratio` / `last_volume_ratio`（`PULLBACK_STATS` 已 6 → 8 → **9**，新增 `last_is_bullish`）。
- 🔴 **`PULLBACK_STATS` 口径对照（9 项）**：`min_low`（最低价）/`max_high`/`close`/`close_ratio`（**收盘相对首板日收盘**）/`min_volume`（绝对股数）/`min_volume_ratio`/`last_volume_ratio`/`holds_event_low`（**未破首板日最低价**，`min(low[T+1..T+k]) >= prefix.rd0.low`）/`last_is_bullish`（**当日阳线 = `post.close[T+k] > post.open[T+k]`**，即用户口径的「红盘」）。
- 🔴 **`pullback_close_ratio_*` ≠ `pullback_last_is_bullish_*`**：前者是「收盘相对**首板日**收盘」（`hold_flip_green` 同族），后者只看**当日 K 线实体方向**。**用户明确裁定②的「红盘」= 后者**。
- 🔴 **「属于主链」与「是上一级的子集」是正交概念，禁用同一布尔位表达**。把 `hold`（主链起点）的 `nested` 写成 `false` ⇒ 因分流 `nested ? chain : controls`，**起点掉进对照组**。**修正 = 拆成 `nested`（属于主链）+ `parent`（逻辑父级）。**
- 🔴 **「逐级保留比」分母必须显式声明，禁取「链上前一个元素」**：链按**用户思考顺序**排，深浅回撤三变体插在 `hold` 与 `hold_shrink` 之间 ⇒ 分母误取 `hold_deep`(2,218) ⇒ 2746/2218 = **124%**。**加护栏测试「任何保留比必须 <100%」。** 同源陷阱：`hold_early`(T+2) 窗口**比 T+3 短** ⇒ 样本反而**更多**（20,527 > 19,080），算出 **107.6%** ⇒ 是**平行窗口变体**，`parent` 必须 `null`。
- 🔴 **`nested`/`parent` 类结构化字段的正确性只能由「真实数据跑一遍」暴露** —— `tsc` 与「数据形状对」都抓不到。
- 🔴 **前端第三视图坐标 = `observationFunnel.ts`（VM 纯函数）+ `ObservationFunnelView.tsx`**，在 `ResearchDetail.tsx` 结果页签三切换。**矩阵回答「哪一格」（二维）｜漏斗回答「每级各贡献什么」（一维逐级收紧）**。菜单图标需同步 `lucide-react` 的 `Filter`。
- 🔴 **漏斗的合规内容不得删**：显著性基准是「**全部首板事件**」而非上一级、**未做多重比较校正**、窗口重叠、主链各级**非严格包含**、对照组与主链**互斥**（UI 用虚线 + 「平行对照」徽标）。**`RESEARCH_READY` 不因「分析已建 + 结果可看」变 TRUE。**
- 🔴 **未做**：「末日放量」只用 `last_volume_ratio > 1`，**未**表达「放量阳线反包前一日阴线实体」。

## 首板回踩漏斗实测基线（Run #570001 · `ds=390002`）
全样本 23,751 / 均值 **+1.52%** / 胜率 **47.42%**；**全部 `p ≈ 0`**。**完整 13 行表见 `ROADMAP.md` §44.5 / `.workbuddy/memory/2026-09-13.md`**。核心结论（只记这几条）：
- 🔴 **「守线」单独近乎 no-op**（540001 T+3 守线：n=19,080 / +3.97% / 胜率 55.18%）—— 它的价值是**止损定义**，不是筛选器。
- 🔴 **「缩量」才是真筛选器**：**540007 守线+缩量≤30%** = n=705 / **+21.20%** / 胜率 **76.88%**（最强单条件）；540006 缩量≤50% = n=2,746 / +7.16%（明显弱于 ≤30%）。
- 🔴 **「已破位」是极强负面信号**：540002 对照 = n=4,664 / **−8.49%** / 胜率 15.65%。
- 🔴 **回撤越深越差，④组三档全负**：0~2% = −1.08% / 2~5% = −3.61% / 5%+ = −7.30%（胜率 35% / 18.4% / 10.5%）。⇒ **「回撤浅」不是好条件，是「没回撤」才是**。
- ⚠️ 540009（+18.98%）/540011 用的是**收盘相对首板日收盘**口径，**≠ 用户裁定的「红盘」（当日阳线）** —— 两者不是同一条件，勿混引。

## 四组条件 → 策略候选 → 回测（2026-09-13 20:30 · **VALIDATED**）
- 🔴 **已注册配方 = 2 个**（`recipeRegistry.ts`）：`leader-candidate-baseline`（`weighted`，`pctChange`+`topN:5`）与 **`first-limit-pullback-hold-shrink`**（`gated`，4 特征 `haircutFromEventLow`/`volumeRatio`/`isBullish`/`momentumFromEventClose`，3 参数 `max_volume_ratio`/`max_drawdown`/`require_bullish`）。🔴 **门槛型条件必须用 `gated`**：加权和里「守线失败」只让分数变小、**不剔除** ⇒ 会放行「守线失败但其他特征极高」的样本，属口径错误。
- 🔴 **`requireRecipe(document, explicitRecipeId)` 优先级定案（`assemble.ts:280-298`）**：**文档已声明 `recipe` ⇒ 文档优先**，显式 `recipeId` **不得覆盖**（`recipeSource="strategy-document"`）；`explicitRecipeId` 只在文档**无** `recipe` 时作诚实兜底（`recipeSource="explicit-request"`）。**禁改成「调用方覆写优先」。**
- 🔴 **`StrategyRecipeRuntime.signalBuilder` 是工厂 `buildSignalBuilder(parameters)`**（门槛值来自文档参数）；`assemble.ts` **必须先 `resolveParameters` 再构造 `strategy13`**。
- 🔴 **候选草稿扩展槽 = `entryRule.extra`**（闭集 `CANDIDATE_SKETCH_EXTENSION_KEYS`，出现未定义键即 `PROMOTE_SKETCH_INVALID`），现有键：`observationWindow`/`trigger`/`eventParams`/`execution`/`position`/`risk`/`document`/**`recipe`**。🔴 **客户端镜像常量在 `client/src/components/research/candidateSketchVocabulary.ts`，改服务端必须同步改**（`candidateSketchForm.test.ts` 是逐字对表的**防漂移哨兵**）。
- 🔴 **`parameterSpace` 非空 + `defaultValue` 是硬前提**：`resolveParameters` 对无 `defaultValue` 的参数抛 `RECIPE_PARAMETER_NO_DEFAULT`；且草稿 `parameterRole` **恒为 `TUNABLE`** ⇒ **数值参数必须同时给 `min` 与 `max`**（否则 `PROMOTE_SKETCH_INCOMPLETE`），非数值须给非空 `allowedValues`。✅ 转正资格：`CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES = ["DRAFT","FINAL"]`。
- 🔴 **`ResearchDataset.rows[]` 无 `bars` 字段**（是扁平 OHLCV 行）⇒ **禁在探针里「手搓 `row.bars` 复算特征」**（会得 0 候选 + 假「特征全缺失」）。正确口径 = **走真实引擎 `runCandidateEngine`**（内部 `createDatasetSession` → 逐决策日 `runResearchPipeline`，与回测同一代码路径），再用 `visibleBars(session.dataSource.getBars(sec), date, point)` 独立复算核对。链路：`handle.rows` = 全量；`session.rows` = 日期切片；`getBars` 返回**全窗口** bars（升序）；`point=close` ⇒ 末根 = 决策日 bar。
- 🔴 **决策窗口必须落在数据集窗口内**：390002 窗口 = **2024-09-01 → 2026-09-01**（库内存 UTC 墙钟 `2024-08-31T16:00Z`）。装配面**不校验**这点，**只有真正驱动引擎才抛**「实验日期范围超出数据集窗口」。
- 🔴 **`loopRun` 入参要求**：`experimentId` 必须匹配 **`EXP-YYYYMMDD-XXXXXXXX`**（§28），否则**先真跑 ~16s 再失败** ⇒ 复用前端 `fnv1a8`+`deriveExperimentId`；`strategyVersion` 必须是**真实落库**行（`leader-candidate-baseline@1.0.0` 是内置目录项、**未落库**）。
- ✅ **实测结论（真跑通）**：①/②/④-c 三例 `loopRun({useRealData:true})` 全过（11.6~18.4s / `datasetSource=registry` / 23,978 行 / 零 BLOCKED）；反事实 `cand-270001@1.0.0`（`hasRecipe=false`）⇒ `explicit-request`+`pctChange` ✅。C 段引擎：57 决策日 / 64 名额 / **`INSUFFICIENT_FEATURES=2525` 被剔除**（门槛真筛）/ **64/64 入选独立复算 gate 全过** / 反事实交集仅 20 只。
- ⚠️ **仍缺**：`CandidateEvaluationRun` 是**候选层统计**（不含成交/收益）⇒ 真正「逐日撮合出收益曲线」的回测仍未做；`optimization`/`robustness`/`oos`/`overfitting`/`paper`/`review`/`discipline` 仍无执行器。`SAME_CLOSE` 被硬拒（`SIGNAL_EXECUTION_TIMING_CONFLICT`）⇒ ③ 可行集 = {T+1 开盘, T+1 收盘}。
