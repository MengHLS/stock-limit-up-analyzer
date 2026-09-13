# stock-limit-up-analyzer 硬禁令索引

> 🔴 **只是索引 + 一句话判据；细则在 `.workbuddy/memory/PROJECT_RULES.md`（47k 字），动手前必读对应章节。**
> 覆盖式 → `ROADMAP.md` §44 + §44.5；append-only → `ROADMAP-CHANGELOG.md`（原 §47）；逐日 → `memory/YYYY-MM-DD.md`。

## 动手前三门
1. **先读 `PROJECT_RULES.md`**（「启动与本机环境」含 Bash 必需长 PATH）。
2. 🔴 **改任何 `server/**` 会热重启并杀死在途研究 Run**（永久卡 `RUNNING`、无恢复入口）⇒ 用户在用页面时禁改 server、禁跑重型真实库脚本；先只读查 `research_runs`/`research_analysis` 有无在途。
3. 🔴 禁 `pnpm/npm install`、新增依赖、`prettier --write`、`db:push`/`drizzle-kit generate`、手写 `_journal.json`。

## 环境
- `pnpm run dev`；端口取 `.env` `PORT`（本机 **3000**；**8000~9000 是 Windows 保留段**）。**读输出必须用 Bash**（长 PATH 见 `PROJECT_RULES.md:64`）。
- 🔴 `ROADMAP*.md` 用 Read/Grep，**禁 `sed`/`head`/`cut`**（中文乱码）；🔴 **`ROADMAP.md` 是 CRLF** ⇒ 行级手术**必须 `splitlines(keepends=True)`**，**禁 `split("\n")` + `"\r\n".join`**（叠 `\r` 污染多重集；已踩两次、均被断言拦下）。
- 🔴 **无 `agent-browser`**、无 `jsdom`/`@testing-library` ⇒ 前端验收**禁写「浏览器截图」**，口径 = 真实 tRPC 取数 + 纯函数复用 + 真实 DB。
- 🔴 时间戳：库内 = **UTC 墙钟**；`executionLogJson` 内 = **ISO 带 Z**（差 8h）⇒ 写传字面量、读用 `DATE_FORMAT(...)`。
- 🔴 **探针 = `docs/evidence/`**（裸 `_xxx` 指此）；**不进 `tsc`/vitest**；**项目根** `npx tsx docs/evidence/<name>`；heredoc 破坏 `.mts` 且 `tsx -e` 无输出 ⇒ **必须用 Write 写文件**。
- 🔴 **测试 = 仓库根 `tests/`**；**5 类位置敏感写法漏改即静默失效**。
- ⚠️ **失败基线 = 7 文件 / 15~16 例**（清单见「铁律」）；判据是**失败文件集合**；**禁取一次 `grep FAIL` 定性**（并发下假失败）。

## 总控
- `ROADMAP.md` 唯一 Master Control：**§44 覆盖式 + §44.5 队列 + §47 append-only**；每任务完成必须更新三者。
- 7 态；**只有 `RESEARCH_READY=TRUE` 才允许策略结论**。
- ⚠️ **禁同批次并发多 Edit**（并行会话常见）⇒ 唯一锚点 + 单次 Edit。
- 🔴 **§44.5 编号非严格递增且已撞号**（`9v` 重复、`9ae` 落在 `9v` 前）⇒ 按「**下一个未占用**」判定，**禁「末条 +1」**（末位 `9ag` ⇒ 下一个 `9ah`）。
- 🔴 往长文档插入：`old_string` 须锚定「**完整、唯一、能自证边界**」的片段；写完**必须 grep 断言两侧原标记仍在**。

## 🔴 坐标与根因（细则 →「跨模块坐标」）
- **Dataset 坐标 = `datasetVersionId = dataset_version.id`**；**Strategy SoT = `strategy_versions.strategyDocumentJson`**（5 投影单向派生、禁反向）；**零 FK**；Migration 须用真实库 `information_schema` 断言（**声明 ≠ 线上真实**）。
- **Research→Strategy 桥** = 唯一目录 `server/research/strategyCandidate/`；**`promote` 是唯一 `CONVERTED` 入口**（入参只 `{candidateId, overrides?}`，**禁提交完整 StrategyDefinition**）。
- 🔴 **「条件进不了回测」根因是架构性的**：`definitionBuild.ts` **已**把 `filterRule` 翻成 `definition.entry.conditions`，但 `assemble.ts` / `server/backtest/**` / `server/strategy/**` 对 `entryRules` 引用数 = 0（配方只看 `recipeId`）；`Strategy13` 带**函数实例**（`compute`/`SignalBuilder`）**无法从 DB JSON 还原** ⇒ **唯一正路 = `recipeRegistry.ts` 注册真实配方 + 草稿带 `recipeId`；禁靠 promote 注入定义。**

## 🔴 计算口径
- 涨停价**四舍五入到分** + 比例 PIT 感知（ST=5%）；窗口左边界必须预热；**禁 mock 冒充真实数据**。
- 🔴 **`segment_*` / 桶纪律 / `MAX_DRAWDOWN` 不要读 / `min(low[T+1..T+d]) >= open(T)` 表达不了** ⇒ 细则见「Research 层」（+ `docs/research/LAYER_CONVENTIONS.md`）。
- 🔴 **漏加 `datasetVersionId` 会多版混算**（得 25,108）⇒ **任何 `ds_*` 聚合必须带版本坐标**。
- 🔴 **观察日三变量角色**：`FEATURE`(≤T)/`OUTCOME`(>T 标签)/**`OBSERVATION`(T+k 当时可见)**；判据 = **是否在信号时点可见**；同一物理量不同角色**必须分别成组**；**新增变量族必须跑一遍 `resolve`**，否则列被 `columnProjection` 裁掉 ⇒ **静默全 null**；**`availableFromOffset = k` 是防「事后筛选冒充信号」的唯一防线**。

## 🔴 运行工作台（细则 →「直读定案」/「已知地雷」）
- **直读桥 = `runWorkbenchAssembly/datasetFromRegistry.ts`**（**禁第二套实现/SQL/直连物理表**）；**仅 `RegistryDatasetBridgeError` 回落重建**（**其他错误一律上抛**）。直读 **6.2s/23,978 行** vs 重建 **60.6s/96,912 行**。
- 🔴 **桥投影**：**每事件恰一行**（OHLCV 取 `prefix` **rd=0**）；**`post`(rd≥1) 不并入 rows** ⇒ 需 T+N 窗口撮合的策略**必须走重建**；**禁把「消费侧缺路径」误判成「表要重设计」。**
- 🔴 **按钮可用性 = `wired && !running`，与 readiness 无关 ⇒ 恒可点**（`EXECUTOR_NOT_BOUND` 只影响 tooltip）⇒ **先证伪 disabled，再查「必然失败」的入参。**
- 🔴 **`loopRun` 两道硬校验**：① `dateRange.startDate/endDate` **必填**（空串 400）；② 窗口须 **⊆ 数据集窗口**（390002 = 2024-09-01 → 2026-09-01）；`experimentId` 须匹配 **`EXP-YYYYMMDD-XXXXXXXX`**（否则**先真跑 ~16s 再失败**）。✅ 已有 `DEFAULT_RUN_WINDOW`+`precheckRunConfig()`+`humanizeRunError()`。
- ✅ **两个 UI 开关已移除**：`useRealData` / `dataReady` 已从 `RunConfigPanel` **删掉**、现恒为真（`dataReady` 真义 = **是否读库内 `dataset_version.status` 真实值**，非「用户声明」）⇒ **别再往运行工作台加「是否用真数据」类开关。**
- 🔴 **14 阶段只有 6 个有执行器**（`data`/`research`/`strategy`/`backtest`/`evaluation`/`regime`）；**任一阶段阻塞 ⇒ 后继全部 `CL_UPSTREAM_BLOCKED`**；`coverage.ts` 判据 = `wired && inputsSatisfied && predecessorCovered` **三者与**。
- 🔴 `loopRun` 是**一次性同步长请求**（主成本 `fetchLimitUpCandidateBars` **≈129s**）⇒ 前端无进度反馈；**`compress` 必须保持开启**（3130 vs 8039ms，2.57×）。

## 🔴 页面坐标（策略页分家）
- **列表 `/strategies`（`StrategyList`）+ 详情 `/strategies/:strategyId`（`StrategyDetail`，版本在 `?version=`，URL 为唯一坐标源）**；旧 `/strategy-editor` = 兼容跳转（`LegacyStrategyRedirect`）；侧栏「策略」；深链生成器 `strategyVersionPath` 已指详情页。
- 🔴 **详情页不承载全库浏览**（不调 `research.strategy.list`）；**新建草稿必须清空 `strategyId`**（模板 `limit-up-baseline` 已在真实库中 ⇒ 否则会变成给既有策略加版本）。

## 🔴 策略定义（凭记忆必错；`PROJECT_RULES.md` 未收）
- **枚举**：`schemaVersion`=**`"1.0"`**；`signalTiming`=`T_OPEN|T_CLOSE`；`executionTiming`=`T_CLOSE|T_PLUS_1_OPEN|T_PLUS_1_CLOSE|T_PLUS_2_OPEN`；`execution.quantityMethod`=`FIXED_SHARES|TARGET_WEIGHT|AMOUNT`（**≠** `position.sizingMethod`）；**`exitRule` 除条件外必须给 `threshold` 或 `parameter`**。
- 🔴 **`ENTRY_TIMING_TO_EXECUTION`**：`NEXT_OPEN`→`T_PLUS_1_OPEN`/`OPEN`；`NEXT_CLOSE`→`T_PLUS_1_CLOSE`/`CLOSE`；**`SAME_CLOSE` 硬拒**。
- ✅ `validateCanonicalStrategyDefinition` 错误在 **`result.issues`（不是 `errors`）**；🔴 **只查「结构合法」，不查「语义等价」⇒ 必须人工复核**。
- ✅ **「首板→观察5日→买入」原生支持**：`entry.observationWindow {1,5,TRADING_DAY}` + `trigger: FIRST_VALID_DAY`。🔴 **`post.rd{n}` 仅在 `n <= earliestSignalOffset` 放行**；`path.*`/`outcome.*` 属 `labelOnly`，**作信号条件必拒**。
- 🔴 **`ds_*`(390002)**：`prefix` rd∈[-20,0] / `post` rd∈[1,20]；**`marketCap`/`floatMarketCap` 100% NULL、`industryCode` 空 99.5%、`indexClose`/分时/开板次数不存在** ⇒ 「高位股/大盘环境/板块题材」**无法验证**，结论**不得声称已验证**。
- 🔴 **`load` vs `loadVersion` 形状不同**（会静默读空）：`load()` → **裸 `StrategyDocument`**；`loadVersion()` → **§17 记录，文档嵌在 `.strategy` 下** ⇒ **必须剥壳**。`compareStrategyDocuments` **忽略 `version`/`fingerprint`** ⇒ 草稿↔落库 diff 才有意义。

## 🔴 配方与参数（细则 →「配方与参数」章节）
- 已注册 **2 个**配方：`leader-candidate-baseline`（`weighted`）、**`first-limit-pullback-hold-shrink`**（`gated`）。
- 🔴 **门槛型条件必须用 `gated`**（`weighted` 里「不满足」只降分、**不剔除** ⇒ **口径错误**）；🔴 **`requireRecipe`：文档已声明 `recipe` ⇒ 文档优先**，显式 `recipeId` **不得覆盖**。
- 🔴 **`signalBuilder` 是工厂** ⇒ **必须先 `resolveParameters` 再构造 `strategy13`**；🔴 **禁手搓 `row.bars` 复算特征**（`rows[]` 无 `bars` ⇒ 得 0 候选）⇒ 必须走真实引擎 `runCandidateEngine`。

## 🔴 前端研究域（纯 `client/**`；细则 →「前端候选草图」）
- **五块结构化表单**（禁退回 JSON 文本框）+ **七段决策顺序**；`filterRule` = 「买入条件」且归属 **`condition` 段（不是 `when`）**，**禁标「剔除」、禁塞回同一段**；必填性**只能去校验器数**（现有 **10 项**）；草稿扩展槽 = `entryRule.extra`（闭集）。
- 🔴 **`client/**` 不能 import `server/**`/`shared/**` 的运行时值**（会把 `zod` 打进前端包）⇒ 需镜像的词表用「**本地常量表 + 表比对测试**」做漂移哨兵。研究页签**默认矩阵视图**；缺口**必须说清差哪一项**。
- 🔴 **免责声明不得删**：`ConclusionPanel` 的 `evidence.disclaimer` 与「**不是交易信号 / 未做多重比较校正**」是**合规内容**；**`RESEARCH_READY` 不因「分析已建 + 结果可看」变 TRUE**。

## 🔴 性能与缓存（细则 →「昂贵回测与风控口径」）
- 🔴 **①「热调用 ≈0ms」才是缓存生效判据**（热调用 23.7s = 没缓存）。**② TTL 消除时间重复、单飞消除空间并发**，数十秒级计算**两者都要**。**③ 失效要精准**（`createLimitUpRecordsBatch` 逐批调用失效函数 ⇒ **先问调用频率**）。
- 🔴 **性能结论只能用「交错重复 ≥3 轮取中位」**：波动 1.5~2.4×，**单次差值 <2× 视为噪声**（曾误写「3.45×」，交错实测 **0.96×**）。
- 🔴 **Drizzle 的 `query: 7.969s` = 排队 + 执行总和**（复现 229~587ms）⇒ **先证 SQL 无罪**；**别把「串行」误判成「库慢」**。

## 🔴 基础设施坑（细则 → `PROJECT_RULES.md`「基础设施坑」）
- 🔴 **「全端点一致 DB 失败 + 零 DB 端点正常」= 池内死连接 ⇒ 先查池、别改代码**（`readiness` 200 作对照；**t+75s 自行恢复**）⇒ **别当成自己改出来的回归**。mysql2 `idleTimeout` 只在 `maxIdle < connectionLimit` 时生效（相等 = 死配置）⇒ 修复 = `maxIdle: poolSize - 1`（已修）。
- 🔴 **`withReadRetry` = 只读安全的有界瞬时重试**（**语义错误不重试**）；**跨境只读瞬时错误（`ECONNRESET`）是常态** ⇒ **单次失败 ≠ 代码缺陷**；脚本顶层 catch **必须摊开 `cause` 链**。
- 🔴 **真实列名禁凭记忆写 SQL**（探针 `_probe_table_columns.mts`）：`research_analysis` 无 `startedAt`；`research_analysis_condition` 用 `analysisId`/`groupNo`/`sortOrder`/`fieldName`/`operator`/`valueJson`（**非** `groupIndex`/`field`）；`research_result`（**非** `research_analysis_result`）；`research_conclusion` 无 `runId`；**`research_analyses`（复数）不存在**。

## 🔴 实测基线
- **首板回踩漏斗（Run #570001 · `ds=390002`）**：**「守线」单独近乎 no-op**（价值是**止损定义**）；**「缩量」才是真筛选器**（守线+缩量≤30% = n=705 / **+21.20%** / **76.88%**）；**「已破位」极强负面**（**−8.49%**）；**回撤越深越差** ⇒「回撤浅」不是好条件、「没回撤」才是。
