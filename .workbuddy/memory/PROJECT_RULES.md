# 项目细则归档（MEMORY.md 的配套详版）

> 由 `.workbuddy/memory/MEMORY.md` 拆出：MEMORY.md 只留高频硬禁令，**细则（唯一权威文件名、不变量编号、验收判据）在此**。动手改对应模块前必须先读本文件相应章节。

## 🔴 构建生命周期（DATASET-LIFECYCLE-001）
- **取消 = 回滚**（不是暂停）：`runner.cancel(jobId)` → **`await runner.waitForStop(jobId)`**（本进程无执行体则立即 true）→ `cancelJobAndRollback`（job CANCELLED / 版本 FAILED / **purge 该版本五表行**）。**顺序不可颠倒**（否则回滚被在途 INSERT 写回）；未在超时内停止 ⇒ 只置取消态 + `rollbackSkippedReason`，**不静默假装已回滚**；重复取消**幂等**（不抛 `INVALID_JOB_TRANSITION`）。
- **重建 = 从零**：`runner.execute` 在 `builder.build` 前 `purgeVersionRows(versionId)`；落库是 `ON DUPLICATE KEY UPDATE id = id`（**no-op**）⇒ **不先清场必留新旧混合数据**。
- **孤儿作业回收**：判据 = `status='RUNNING'` 且 `updatedAt ?? startedAt < now - staleMinutes`（**无时间基准 ⇒ 跳过**，诚实；`staleMinutes<=0` ⇒ 关闭）。钩子 `reclaimOrphanBuildJobs()`（`server/_core/index.ts`，env `DATASET_RECLAIM_STALE_MINUTES`，默认 10 分钟）。
- ⚠️ **`dataset_build_job.updatedAt` 是 `ON UPDATE CURRENT_TIMESTAMP`** ⇒ 任何 UPDATE 都刷新它 ⇒ **不能用它判「卡死」**，只能判「停更」（孤儿）。
- 审计 `scripts/verifyDatasetBuildLifecycle.mts`（L1 作业↔版本自洽+孤儿 / L2 声明↔实际 / L3 可用版本清单 / L4 非 READY 且无 RUNNING 者不得残留数据行）。

## Dataset Registry（001/003A/003B）
- `server/datasetRegistry/`。**一个逻辑 Dataset = 一组固定物理表**，多版本靠 `dataset_version_id` 隔离（禁一版一表）。
- **多数据集 = 插件化**：`plugins.ts`（`DatasetPlugin{physicalTables(DDL),createIO,createBuilder}`，**列清单唯一权威**）；核心零硬编码 datasetCode；未注册 ⇒ `BUILDER_NOT_REGISTERED`。物理表只经 `physicalTables.ts`；删版本保留表结构，删数据集才 DROP。
- 筛选（003B）落 `dataset_build_config`/`_event`/`_board`；语义权威 `filter.ts`；前端门禁 `datasetFilterForm.ts#validateFilterForm`。**锚点 ≤0**（禁正锚点）；**筛选口径建版本时固化不可后改**。错误码 `INVALID_BUILD_FILTER`（不静默夹取）/`CHECKPOINT_INCOMPATIBLE`。
- 状态机：Version `DRAFT→BUILDING→{READY,FAILED}`、`READY/FAILED→BUILDING`；Job `PENDING→{RUNNING,CANCELLED}`、`RUNNING→{COMPLETED,FAILED,CANCELLED}`，terminal 无出边；`isVersionBuildable = DRAFT|FAILED|READY`。⚠️ `completeJob → markReady` **两次写库非原子**（未修）。

## 物理表事件窗口五表分层
- `ds_{code}_{role}`，role ∈ event/prefix/post/path/outcome/feature。`prefix`(rd≤0) ↔ `post`(rd≥1) 分界落在 t 日 = **结构级 PIT 防线**；由 `rawBarCreateSql(table,keyPrefix)` 生成。`path.ts#eventReferenceFrom(bars)` **只取 `rd=0` 行**（禁 `?? 0`）。
- 不变量 **I1~I12**（含 I7b/I12）：`scripts/verifyDatasetWindowLayering.mts`；迁移 `applyDatasetWindowLayering.mts`（幂等，`--dry-run`/`--check`）。
- **已否证**（`verifyLimitUpCaliber.mts`）：`ds_*` 已是「四舍五入到分」口径、与现行代码同源（重建 v1 窗口 **60,002 行逐字节等价**）⇒ ~~「003B P1 修复后重建 v1/v2」~~ **不必做**。
- 🔴 **P7**：`liquidity_daily.totalMarketCap`/`circulationMarketCap` **全 NULL** ⇒ 下游 `marketCap`/`floatMarketCap` 全 NULL，**市值类特征/筛选不可用**；`event.industryCode` 全 NULL 是 P4 下游后果。文档**拆两文件禁混写**：`docs/DATABASE_DESIGN.md`=现状、`docs/DATABASE_REDESIGN.md`=方案（P1~P8）。

## 数据集构建性能（DATASET-PERF-001）
- 🔴 跨境构建**延迟受限**（RTT ≈ 208ms）非算力受限 ⇒ 只能**减往返 + 减搬运行数**。**禁 `worker_threads`**：连板状态必须单线程串行推进，「多线程」的正确等价物 = **有界异步并发**。
- **并发/分片常量唯一权威 = `server/datasetRegistry/concurrency.ts`**（`mapWithConcurrency`/`forEachWithConcurrency`/`chunkArray`），**禁别处重写**。连接池读 `DB_POOL_SIZE`（`server/db.ts#resolvePoolSize()`）。
- **SQL 下推粗筛超集** = `detection.ts#LIMIT_UP_CANDIDATE_SQL_PREDICATE` + JS 等价 `isLimitUpCandidateBar`（**测试夹具必须复用 JS 版**）；**只是粗筛，精确判定仍由 `isLimitUpClose` 内存完成**。取数一律**定向**（`fetchBarsForSymbolsInRange`/`fetchLiquidityForSymbolsInRange`，禁「整段日期全市场」）；小表走 `loadSecurityIndexes()` + `resolveStSync`/`resolveIndustrySync` 逐 bar O(1)。⚠️ **`batchSize` 速度敏感** ⇒ 待固化进 `dataset_build_config`。
- 验收 `scripts/verifyDatasetBuildPerf.mts`（S1 阈值 / S2 下推零漏判 / S3 定向取数逐行等价 / S4 端到端逐字节等价+计时）。**S4 判据 = 行数 + 内容指纹 + 行级多重集差集 0**。⚠️ **指纹必须排除 `id`/`createdAt`/`datasetVersionId`**，否则出「行数一致但指纹全不等」的**假阴性**。

## Research 层
- 🔴 全部约定（001 表 / 002 分层 / 002A 维护层 / 002B 增量补跑 / 002C 批量建分析 / **视界陷阱** / 失败语义 / 前端不造假铁律 / 既有测试失败处置）见 **`docs/research/LAYER_CONVENTIONS.md`** —— 改 Research 层代码前**必须先读**。
- 🔴 **分析能力边界 + 口径纪律**（2026-09-12 RESEARCH-007.1，细则 `docs/research/RESEARCH-007.1-pullback-correction.md`）：① **固定业务桶必须写明开闭**，并用「**各桶样本加总 = 全集条件样本数**」闭环校验 —— 双闭区间会让 `future_return=0`（平盘、depth=0，非回撤）入桶 + 边界重复计数（实测 5 桶加总 **10,106** vs 组 A **9,899**，多 207 = 平盘数）；正确 = `future_return < -lo AND >= -hi`。② **`CONDITIONAL` 自动附带的 `MAX_DRAWDOWN` 行不要读** —— 其变量名由 `drawdownVariableFor(target)` 从 target 名尾部 `_Nd` 推导（`segment_return_2_7d` → `max_drawdown_7d`），是「相对**首板**收盘、窗口 [T+1,T+7]」，**不是**「相对决策日收盘、窗口 [T+3,T+7]」。③ `holds_event_low_{h}d` / `event_low_margin_{h}d` **可作 `CONDITIONAL` 条件字段**，窗口恰为 `[T+1,T+h]` ⇒ 决策日 = h 时零前视。④ **滚动资格判定 `min(low[T+1..T+d]) >= open(T)` 现有模型表达不了**（数据层原料齐全：`prefix(rd=0).open` + `post(rd≥1).low`；缺的是变量层 —— 只有基准 `low(T)` 且只对 `outcomeHorizons={5,10,20}` 生成）⇒ **最小扩展 = `EVENT_LOW_GUARD_BASES` 加 `"open"` + 视界由 `outcomeHorizons` 扩到 `pathHorizons∩[1,5]`（单文件单函数、零 migration）**。⑤ **改名 / 改条件只有 API**（`updateAnalysis` / `setAnalysisConditions` 均 `adminProcedure`，前端只有删除）；`setAnalysisConditions` 会**删旧结果 + 删失效结论 + 回退 PENDING**。
- 三条最常咬人的：① `future_/high_/low_return_*` 来自 **path(1..20)**，`max_return_*`/`max_drawdown_*`/`is_breakout_*` 来自 **outcome（仅 {5,10,20}）** ⇒ **禁一把梭请求**；② 条件组号**必须连续 0..n-1**；③ `research_conclusion` **无 `runId`** ⇒ 归属靠 `evidence` 提 `analysisId` 求交，**提不出 id 绝不删**、**禁 `?? 0`**。
- ⚠️ 遗留**复数** `research_experiments`/`_runs`/`_datasets`（STEP 6.x）与新**单数** `research_*`（0031）**仅差一个 s**，极易误引。`docs/researchReadyGate/research_ready_gate.json` 为 `researchReady=true` ⇒ `dataHealth.test.ts` **1 例既有失败**，**禁**为过测试改快照或期望。
- `createRun` **只创建不执行** ⇒ 空 Run 永不出结果，须走 `runIncremental`（复用 `inputSnapshot` 冻结基准、不产结论、日志空则下一批从 **2** 起、不 backfill）。
- 🔴 **运行纪律（2026-09-11 事故）**：`npm run dev` = `tsx watch server/_core/index.ts` ⇒ **改任何 `server/**` 都会热重启并杀死在途研究 Run**（v2 单次装配 ≈ 9 分钟极易撞上；被杀 Run **永久卡 `RUNNING`** 且**无产品级恢复入口**）。**用户在用页面时禁改 server 文件、禁跑重型真实库脚本**（`verifyResearchEngine.mts --all` ~9 分钟且抢跨境 TiDB）。⚠️ dataset 侧有 `reclaimOrphanBuildJobs()` 兜底，**研究 Run 侧尚无**（待补，同构）。
- ⚠️ 数据集/版本的行数、装配耗时等**状态数字一律归 `ROADMAP.md` §44**，此处不记（曾据旧数字误判「v2 未建完」）。

- 🔴 **分析层「能表达什么」的落差清单（2026-09-12 实查，RESEARCH-010）**：一个 `research_analysis` = **一种统计方法 + 一个目标变量**，**没有**「Feature/Target/Horizon/Descriptive 四段配置」的分析对象，**没有编码列**（`code` 无处可落 ⇒ 只能塞进 Run 的 `configJson.note`），**没有多视界矩阵**（`horizons` 只有 `EVENT_STUDY` 用且不带分组 ⇒ 1D/3D/5D/10D 必须 **×4 份分析**），**没有二维分组**（「第几天 × 深度」只能拆成「每天一张分档表 + 逐格 `CONDITIONAL`」）。分组类分析（`QUANTILE`/`SEGMENT_RELATION`/`CONDITIONAL`/`STABILITY`）**只产 5 个指标** `SAMPLE_COUNT / MEAN_RETURN / MEDIAN_RETURN / STD_RETURN / WIN_RATE` —— **无 P25/P75、无组内极值**（分位数只有 `DESCRIPTIVE` 有）；`max_return`/`min_return` 口径**仍产 `WIN_RATE`（不是胜率，见 §44.5 第 9s 条）**。**一 Run 只产一条结论**，主分析 = `PRIMARY_PRIORITY` 固定优先级**取首个命中** ⇒ 大批量分析里只有 1 个进结论，**结论页必须配合结果页读**（否则会把「一格不显著」误读成「整条规律不成立」）。
- 🔴 **固定百分比分桶只能「堆分析」**：`SEGMENT_RELATION` 的 bands 与 `QUANTILE` 都是**等频（分位数）切档**、切点随样本变；要固定宽度（`0~2% / 2~4% / …`）必须 `CONDITIONAL` + `BETWEEN` **逐桶各建一个分析**（5 档 = 5 个分析），且 `BETWEEN` **两端闭区间** ⇒ 边界样本被相邻两桶各计一次。
- 🔴 **结果变量族全是比率、无绝对价**：`future_return_*` / `segment_*` 的分母是「事件日收盘 T」或「窗起点收盘 T+a」⇒ 表达「在某个回撤日建仓」只能靠 **`segment_return_{a}_{b}d` 改锚点**；`pullback_price`（绝对买入价）、相对首板日**开盘价** O_T、`(P−L_T)/(H_T−L_T)` **不可表达**（条件右值只能是常量，不支持跨字段算术）。
- ⚠️ `regime` 维度**不可用**（`listVariables.unavailableDimensions` 明示，未接 `RegimeTagProvider`）；`market_cap` / `float_market_cap` 变量虽在目录里，**上游全 NULL**。
- ✅ **建分析的标准三步（网页可达、无捷径）**：`新建 Run` → `批量建分析` → `运行引擎`（整轮）。⚠️ `runIncremental`（补跑）**不产结论**，所以首次一定要整轮执行；29 个分析 ≈ **2.5 分钟**，期间**禁改 `server/**`**（热重启会杀死在途 Run）。

## Strategy Domain Model 与 Dataset 绑定（003 起，004 起强化）
- **唯一 Canonical SoT = `strategy_versions.strategyDocumentJson`**（内含富 `definition`）；5 张投影表（`strategy_parameters`/`strategy_entry_rules`/`strategy_exit_rules`/`strategy_execution_rules`/`strategy_version_datasets`）由它**单向派生**。🔴 **禁 `Projection → Canonical`**；投影漂移由 `projection.ts#verifyStrategyProjections` 报 `SCHEMA_DEFINITION_VIEW_DRIFT`，**绝不自动修复**。方向铁律（v1 视图同理）见 `map.ts#alignDefinitionViews`（`fillOrCheck`：缺则补、冲突则 `SCHEMA_DEFINITION_VIEW_CONFLICT`）。
- 🔴 **传 `definition` 时不得透传 v1 视图**（`entryRules`/`exitRules`/`riskRules`/`positionSizing`/`parameters`）—— 必须由新 definition 单向派生。`cloneStrategyDocument` 与 `StrategyService#patchToInput` **两处必须一致**（后者曾相反 ⇒ `createVersion(带 definition)` **恒失败**；STRATEGY-004 修复，**`cloneStrategyDocument` 一行未动**）。
- 🔴 **Dataset 坐标唯一口径 = `datasetVersionId = dataset_version.id`**（`strategy_versions` + `strategy_version_datasets` 各一列；`drizzle/0035_strategy_dataset_binding_version_id.sql`）。`datasetVersion`（`v1`/`v2`）**只是显示 / 快照 label**。**禁建第二套 Dataset Version ID、禁复制 Registry 版本表、禁字符串格式校验代替引用校验**。
- **引用完整性唯一实现 = `server/research/strategyPersistence/datasetBindingValidation.ts`**（`collectStrategyDatasetBindingRequests` / `evaluateDatasetBinding` / `assertStrategyDatasetBindings`）。判据：**存在 ∧ `status === "READY"` ∧ label == Registry `version` ∧ `datasetId` 属于该版本**；错误码 `DATASET_VERSION_NOT_FOUND` / `DATASET_VERSION_NOT_READY` / `DATASET_BINDING_INVALID`。
- 🔴 **校验必须在 `db.ts#saveVersion` 的同一事务内**（禁「先存后校验」）；只读口用既有 **`DbDatasetRegistry#getVersionById` / `getDefinitionById`**（**禁写第二套 SQL、禁自动建 Dataset、禁绕 Registry 直读 `ds_*`**）。
- `rd-…` **legacy 分支保留**（无坐标 ⇒ 不做 DB 校验、列落 `NULL`、显式「未校验」）；`isStrategyDatasetVersionLabel` **排除 `rd-…`** ⇒ label 与 legacy **禁互相冒充**。
- **事务不可变语义**：同 `version` 同内容 = `idempotent-skip`、不同内容 = `conflict`（**绝不覆盖**）；`status` 是**唯一**可 UPDATE 列（`setVersionStatus`）。
- 验收判据：`scripts/verifyStrategyDatasetBinding.mts`（真实 TiDB + 真实 tRPC，101 项）、`scripts/verifyStrategyDatasetBindingUi.mts`（前端等价验收 46 项）、`scripts/verifyStrategyDomainModel.mts`（89 项，**其裸 SQL 投影读取须随新列同步**）。写端点一律 `adminProcedure`，读端点 `publicProcedure`。

## 昂贵回测与风控口径
- **龙头候选全区间回测 305~413s（冷）**。**明细必须走分页** `getLeaderCandidateHistoryPage`；快照 `leaderCandidateBacktestSnapshot.ts`（TTL 6h），**写路径必须失效** `db.invalidateLeaderCandidateBacktestCaches()`。⚠️ 收窄价格窗口换提速会经 `strategyBacktest.ts` 的 `rawRows` 日期并集**裁剪最早候选回溯窗口** ⇒ 须 A/B 后才可改。
- ✅ **`getLeaderCandidates()` 已于 2026-09-13 修复**（此前 **32.4s 冷 / 23.7s 热**，零缓存）。现为：**TTL 结果缓存（5min）+ 单飞 + 并行取数**，实测 **冷 45.3s → 热 1ms**、6 并发共享同一 Promise。**三条连带事实（改这里前必读）**：① 该函数是首屏**唯一**关键路径端点（喂页头 4 卡 + 评分列表 + 图表）；② 其内部 `getLeaderCandidateMarketFactorRows()` 也已加 TTL 缓存，**且被 `loadBacktestBaseContext` 共用**；③ 新增缓存必须挂进 `invalidateLeaderCandidateBacktestCaches()`（正确性）。⚠️ **冷启动首次仍慢** —— 缓存只消除重复计算，不减少单次固有成本。
- 🔴 **缓存设计铁律（2026-09-13 沉淀）**：① **「热调用 ≈0ms」才是缓存生效的判据**；某条「有缓存」的路径热调用仍需数十秒 ⇒ 等于没有缓存（本次真瓶颈即此）。② **TTL 缓存与单飞解决不同问题**：TTL 消除「时间上重复」、单飞消除「空间上并发」；**耗时数十秒的计算两者都要**（前端重挂载/多标签/React Query 重试会并发打入）。③ 🔴 **失效要精准，不是越多越好** —— 把 `dailyPriceCoverageCache`（890 万行全表聚合 ~9s）加进失效清单**是错的**：`createLimitUpRecordsBatch` 是**逐批（每 100 条）调用失效函数**，逐批清空会把一次回填放大成数十次全表扫描。**加失效前先问「这个写入函数的调用频率」**。④ 性能修复**先测速再动刀** —— 用户提的「分页 / 缓存」是线索不是结论（本次分页早已做完，真瓶颈在无人看的地方）。
- **连板高度风险唯一权威 = `shared/boardHeightRisk.ts`**（**禁别处重写**）。仓位缩放走 `positionScale`，只在 `realisticBacktest.ts` 的 `plannedBudget` 上向下缩放 ⇒ **不改排序、不删候选**；`baseline` **恒不施加高位约束**。
- **字段可用性唯一权威 = `shared/fieldAvailability.ts`**，阈值 0.6。铁律：**缺失既不是风险证据、也不是强度证据**（题材家数用同日 `median` 中性兜底；`limitUpTime` 缺失不记「封板偏晚」）。缺失分界：**2025-09 及更早整段缺 `limitUpTime`/`sector`/`keywords`**，**2025-11 起完整**。

## 启动与本机环境（工具坑，高频）
- 启动 = `pnpm run dev`（=`tsx watch server/_core/index.ts`）。🔴 脚本**禁写 `NODE_ENV=xxx tsx ...` 前置赋值**（Windows 下 npm 用 cmd.exe，报 `'NODE_ENV' 不是内部或外部命令`）；模式由 `server/_core/env.ts#resolveRuntimeNodeEnv` 运行时判定（仅 `NODE_ENV=production`/`--production` 为生产）；`npm start` = `node dist/index.js --production`。
- 端口取 `.env` 的 `PORT`，本机 **3000**。🔴 **8000~9000 段不可用**（Windows 保留段，bind 报 `EACCES` 而非 `EADDRINUSE` ⇒ 连扫 20 个全败并报「No available port found starting from 8080」）；查段 `netsh interface ipv4 show excludedportrange protocol=tcp`。
- 验启动须「启动 + 探测在**同一次** Bash 调用内」（调用结束进程即回收）；`kill $!` 只杀 npm/tsx 包装，**底层 node 泄漏且仍占端口** ⇒ 用 PowerShell 工具 `Stop-Process -Id <netstat 的 PID>`。
- 工具：**PowerShell 工具只回退出码不回 stdout**（读输出用 Bash）；**沙箱禁 `pnpm/npm install`**（SIGTERM）与「Bash 调 powershell.exe」⇒ 方案不得新增依赖。Bash 须前置 `export PATH=/c/Users/A/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Windows/System32:$PATH`，否则 `head`/`dirname` not found。
- `npx tsx -e` **静默无输出** ⇒ 探针落文件；探针**禁 import `server/data/boardRules.ts`**（会拉 `server/engine/execution` 而挂起）⇒ 内联等价实现（纯 `node -e` 可用）。**`ROADMAP.md` 一律用 Read/Grep 工具，禁 `sed`/`head`/`cut`**（中文乱码；`ROADMAP-CHANGELOG.md` 同）。
- `cursor`/`rows`/`rank` 是 TiDB 保留字（`AS cursor` → `ER_PARSE_ERROR`，换 `cur`）；列名以 `drizzle/schema.ts` 为准（`limit_up_records` 是 `keywords`、无 `reason`）。
- 🔴 **时区口径**：库中时间戳存的是 **UTC 墙钟**，而 `executionLogJson` 里的时间戳是 **ISO 带 Z**（同表两套表示法、相差 8h）。本机 Node TZ = `Asia/Shanghai` ⇒ 临时脚本用 mysql2 默认（`timezone:'local'`）读时间戳**整体差 8 小时**。**写时间戳一律传字符串字面量、不传 `Date`；读时间戳用 `DATE_FORMAT(...)` 取原始串自行换算**。TiDB 无 `CORR()` ⇒ 手工算皮尔逊或改用 `shared/quant-stats`。
- 🔴 **并发写状态**：有 Run / 构建在途时**禁写 `research_run` / `research_experiment` 状态**（会被引擎收尾覆盖，或反过来覆盖引擎）⇒ 状态写入必须带 `WHERE status=<期望>` 前置条件；运维脚本改状态前先确认无在途执行。
- 审计探针**分组键必须等于代码语义键**（漏 `statusType` 曾致 11 组假「冲突」；正确键 `(securityId,statusType,effectiveFrom)`）；`LIKE` 优先**前缀**（`%测试%` 会命中真实股名 `谱尼测试`/`西测测试`）。
- ⚠️ `shared/researchContracts.ts` schema **声明顺序 = 依赖顺序**（前向引用 TS2448 挡全库）；`shared/datasetRegistryContracts.ts` 依赖它 ⇒ 其中间态会让所有 import datasetRegistry 的脚本 **import 期崩溃** ⇒ 编辑一次成型。
- ⚠️ Windows：`ps -ef` 的 PID ≠ Windows PID，杀进程用 PowerShell `Stop-Process`（`taskkill //F` 在 Git Bash 非法）；长跑探针被「停止」后底层 node **必泄漏**，须显式清（否则抢 DB）。
- 🔴 **本仓库不是 prettier 格式化的**（`.prettierrc` 是 `printWidth:80` + `arrowParens:"avoid"`，但全目录 `prettier --check` 一律 warn，未改动文件也 warn）⇒ **禁跑 `prettier --write`**（会产生整文件 diff、污染并行会话的对比判据）。格式化验收只认 `npx tsc --noEmit` + `npx vitest run` + `npx vite build`。
- `tsconfig.json` `include` = `client/src/**`、`shared/**`、`server/**`（`vitest.config.ts` 的 `test.include` 同构：只覆盖 `server/**`、`shared/**`、`client/src/**`）⇒ 根目录 `_*.mjs` 探查脚本**不进编译**，可安全留存作证据。🔴 **2026-09-13 起这批证据的固定坐标由「根目录」改为 `docs/evidence/`**（85 个 `_*` 探针与运行结果整体迁入；`docs/evidence/**` 同样**不进编译、不进测试**，与 `scripts/**` 同待遇）。**判别口径**：2026-09-13 之前的文档与日志里出现的**裸 `_xxx` 文件名一律指向 `docs/evidence/_xxx`** —— `ROADMAP-CHANGELOG.md` 与 `.workbuddy/memory/**` 属 append-only，按「历史条目零改写」一字未动，映射只登记在 `docs/evidence/README.md` 与当日日志里。**重跑探针必须在项目根目录执行**（`npx tsx docs/evidence/<name>`；脚本按 CWD 写输出、按 `../../` 找源码，19 个 `.mts` 的 `./server/…` 已同步修正为 `../../server/…`）。
- 🔴 **真实库脚本必须显式收尾**：`scripts/verify*.mts` 跑过 `getDb()`（drizzle）后，连接池会**拖住 event loop** ⇒ 脚本「跑完不退」（曾挂 13 分钟）。结尾用 `process.exit(failures.length ? 1 : 0)`；另外脚本首行需 `import "dotenv/config"`（`getDb()` 读 `process.env.DATABASE_URL`，不加载 `.env` 会得到「数据库不可用（DATABASE_URL 未配置）」）。
- ⚠️ `scripts/**` **不在 tsconfig `include`** ⇒ `.mts` 验证脚本**不被 `tsc` 检查**，类型错只会在运行时暴露 ⇒ 写完必须实跑一次。
- 🔴 **Drizzle 会把真实 DB 错误包成 `DrizzleQueryError(message='Failed query: <sql>\nparams: …', cause=<真实错误>)`**（`mysql-core/session.ts#queryWithCache` 的 `catch (e) { throw new DrizzleQueryError(queryString, params, e) }`）⇒ 验收脚本顶层 catch 里只写 `String(err)` **等于把根因扔掉**（2026-09-12 在 006.4.1-B 真实踩到：一个 `strategy_exit_rules` 只读 SELECT 失败，日志只有「Failed query」，无法判断是「列不存在」还是「跨境瞬时断连」，白排一轮 12 分钟）。**规矩：`scripts/verify*.mts` 的顶层 catch 必须摊开 `cause` 链**（逐层打 `constructor.name` / `code` / `errno` / `sqlState` / `sqlMessage`），并把**根因**一并写进失败项 detail。附带事实：**跨境只读偶发瞬时错误是本项目常态**（`server/researchEngine/readRetry.ts` 即为此而生；生产读路径 `strategyPersistence/db.ts#loadProjections` 等**没有**重试）⇒ 单次失败**不等于**代码缺陷，判据 = 同一条查询**独立复现是否稳定失败** + `information_schema` 列签名核对。

## 前端（recharts / 分层 / 验收）
- ⚠️ 图表一律 **recharts**（已在 deps ⇒ **禁新增图表库**，沙箱也装不了）。四个坑：① 自定义坐标轴刻度**只有写成箭头函数**才会注入 `x/y/payload` —— 写 `tick={<C/>}` 走 `cloneElement`，自定义 props 传不进去且 **TS 报 `not assignable to type 'IntrinsicAttributes'`**；② tick 组件的 props 类型**不能是 `unknown`**（那样 JSX 会拒绝一切属性）；③ **`Tooltip` 的 `content` 同理** —— `<Tip lines={x}/>` 若 Tip 的 props 是 `unknown` 直接 `TS2322`，解法是 `content={(p) => renderTip(p, x)}` **普通函数调用**；④ `Line` 取值用**展平到顶层的字符串 `dataKey`**（`v_<code>`），**不用函数式 `dataKey`**（跨版本行为不一致）。横向条形图**横轴必须含 0** + `ReferenceLine x={0}`；折线图的基准线要画在**语义基准**上（量比 = 1 倍「持平」，不是 0）。
- ⚠️ **展示层能做恒等变形、不能做估计**（判据见 `docs/research/LAYER_CONVENTIONS.md`「前端工作台」段）：能从已落库数值**无损还原**的量可以算 —— 均值可以，**胜率也可以**（它就是 0/1 的均值），如 `estimateExcludedGroupMean` 反推条件分析缺的「对照组」，但**必须标注来源**（图上标「（反推）」）。中位数 / 标准差 / 分位数是非线性统计量，反推即估计 ⇒ 一律返回 `null`。**禁重算引擎口径**（如按「结果值最大/最小」自行挑顶底档 —— 引擎 `SPREAD_TOP_BOTTOM` 是「末档 − 首档」）；**能搬运就不要重算**。
- 🔴 **`agent-browser` 在本机不可用**（`open about:blank` 与本地页面**均挂起零输出**，沙箱起不了 Chromium）；且仓库**无 `jsdom` / `@testing-library`**、安装被沙箱禁 ⇒ **前端任务不得把「浏览器截图」写进验收路径**。等价手段：① 组件真实数据源走**真实 tRPC** 取数；② 组件真实判定函数若在 **React-free 纯函数模块**（如 `client/src/components/research/*Form.ts`、`client/src/adapters/*.ts`）可直接从 Node/tsx 脚本 `import` 复用，**禁另写一套口径**；③ 真实 adapter 往返（`xxxToViewModel` → `viewModelToXxx`）+ 真实 DB 校验。分层纪律 = `API(DTO) → Adapter → ViewModel → UI`，**不把裸 JSON 漏给视图层**。

## 🔴 真实 tRPC 全链 E2E（不必起 HTTP）
- `appRouter.createCaller(ctx)`（手构造 admin ctx：`user.role="admin"` + `req={protocol,headers:{}}` + `res={clearCookie:()=>{}}`）即可覆盖「tRPC → Service → Repository → TiDB」。
- ⚠️ **tRPC 把领域错误包成 `TRPCError(code="INTERNAL_SERVER_ERROR")`，原始错误码在 `cause` 链上** ⇒ 断言错误码必须**穿透 cause 链**再比对，只看 `err.code` 会永远看到 `INTERNAL_SERVER_ERROR`。
- 🔴 **`toTrpcError` 只透传 `message`、不带 `cause`**（2026-09-12 实测登记，RESEARCH-006.4.1 Phase A）⇒ **经它转换的错误，领域码不在 `cause` 链上、对 tRPC 客户端完全不可见**；上一条「穿透 cause 链」**只适用于「未转换、直接冒泡」的错误**（那种才带 `cause`，且 `code` 恒 `INTERNAL_SERVER_ERROR`）。实例：`transition` 拒 `CONVERTED` 时领域码 `STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE` **在 caller 侧取不到**，只能断言「`CONFLICT` + message 含 `promote()`」；后果是「§11 的 14 个 promote 错误码」会**塌缩成 5 个 tRPC code**（4 个 `PROMOTE_*` 全落 `PRECONDITION_FAILED` 无法区分）。**要前端按领域码分流，必须把码写进 message**（`message: \`[${e.code}] ${e.message}\``）—— 与 `rpcErrorToDiagnostic` 既有的 `/[([A-Z_]{3,})]/` 抠码约定一致。
- ✅ **2026-09-12 21:50 已落地（RESEARCH-006.4.1-B）**：`server/research/strategyCandidate/router.ts#toTrpcError` 的**所有**分支改为 `withDomainCode(e.code, …)`（含 `PROMOTE_WRITEBACK_FAILED` 把 `describeDetails` 的 `strategyId/strategyVersionId/strategyVersion/stage` 一并拼进 message）⇒ 领域码现在**随 `message` 跨过 tRPC 边界**；真实 TiDB 全链实测 **6 个不同领域码在 caller 侧可区分**（`CANDIDATE_NOT_ACCEPTED`/`PROMOTE_SKETCH_INCOMPLETE`/`PROMOTE_SKETCH_INVALID`/`DATASET_DIVERGENCE_REASON_REQUIRED`/`DATASET_VERSION_NOT_FOUND`/`INVALID_INPUT`）。前端读码只认 `client/src/adapters/strategyCandidateAdapter.ts#readRpcDomainCode`（同一正则），**禁再写第二套抠码逻辑**。⚠️ **仍然不带 `cause`** ⇒ 不要对**经 `toTrpcError` 转换过**的错误写「穿透 cause 链」的断言（会永远失败）；判据：`ResearchCandidateError` **无 code 字段 ⇒ 刻意不加前缀**（不编造领域码）。
- ⚠️ **新增端点时领域错误只能在 catch 里 `toTrpcError(e)` 或显式 `toTrpcError(new ...)`** —— 直接 `throw new XxxError(...)` 不改 tRPC code，一律落 `INTERNAL_SERVER_ERROR`（曾两次真实踩坑：RESEARCH-002C 的 3 个模板端点）。
- 🔴 **断言「某 procedure 不存在」禁用 caller 属性访问**：tRPC v11 的 `createCaller` 返回 **Proxy**，访问任何不存在的属性（如 `anyCaller.promote`）会触发「无 procedure」的**未处理 Promise rejection**（曾造成 4 个 unhandled errors + 2 例假失败）⇒ 必须用 `Object.keys(router._def.procedures)`（扁平点分路径，格式 `research.strategyCandidate.get`）断言端点集合与 `not.toContain(...)`。

## 🔴 涨停判定（P0）
- 涨停价**必须四舍五入到分**（`server/data/boardRules.ts`）；`isLimitUpClose` 与落库 `limitUpPrice` **必须同一函数**。比例 **PIT 感知**（ST=5%），经 `DbDatasetBuildIO.resolveSt` 按日在册判定，**禁用代码前缀猜**。不四舍五入对**原始行情**漏判 38.03%（**注意：这是旧谓词对 `stock_daily_prices` 的漏判率，不是 `ds_*` 数据的属性** —— `verifyLimitUpCaliber.mts` 已证 `ds_*` v1/v2 与现行代码同源）。
- 窗口左边界**必须预热**（有界回扫 `max(|负锚点|,1)` 交易日重建 `limitUpDays`），否则连板误判首板；负锚点下逐 bar 全量判定。连板唯一状态 = `limitUpDays`（`Map<symbol,Set<dayIdx>>`，Set 防 resume 重叠多计）。

## 数据源与回填
- OHLCV 用 **Tushare**，其余 6 域 **BaoStock**；**BaoStock 单账号单活跃会话 ⇒ 回填必须串行**。`stock_basic` 2000 行分页 ⇒ universe 一律 `--universe-from-db`。回填脚本需 `MARKETDATA_PYTHON=<venv>`。
- 🔴 **跨境 TiDB ~1.4 万行/s**：`stock_daily_prices`（889 万行）全表取回 700s ⇒ **批量读取不可行**，只能缓存 + 增量。
- **行情对位索引**一律 `server/stockPriceIndex.ts#hasStockDailyPrice`（O(1)），**禁用 @deprecated 的 `db.getStockDailyPricePairs()`**；快照 `.cache/stock-price-day-index.json`（冷建 `GROUP_CONCAT(DATEDIFF(...))` **必须事务内** `SET SESSION group_concat_max_len=4294967295`，否则静默截断）；写后统一 `invalidateStockPriceSyncCache()`。

## 🔴 数据完整性（001/002/003）
- **原始表**防线 = **DB 级唯一约束 + `ON DUPLICATE KEY UPDATE` 幂等覆盖**（非应用层 if-duplicate）⇒ 重叠窗口回填**不产重复行**；代价 = `updatedAt` 刷新 + 缓存失效 = **缓存抖动**。
- 🔴 `research_security_status_history` 缺 `UNIQUE(securityId,statusType,effectiveFrom)` ⇒ `timeline.ts#pickLatest` tie-break 是**「任取」** ⇒ 一旦重复，PIT ST 由 `source` 字母序决定 5%/10%。
- 🔴 `limit_up_records` **无业务唯一键 + 纯 INSERT**（OCR `routers.ts#uploadAndRecognize`）⇒ **重复上传同一复盘图必产重复行**（虚增家数 / 题材热度）。⚠️ 污染判据**必须前缀 `LIKE '测试%'`**（`%测试%` 命中真实股名 `谱尼测试`/`西测测试`）。
- 🔴 连板高度用 `db.ts#calculateConsecutiveBoards` 按「表内 `limitUpDate` 集合」**邻接链重算**（`boardCount` 是**死字段**）⇒ 缺任一天即断、低估为「首板」；`backfillLimitUpRecords.mjs` 的 `streak` **只读本轮 `fresh`** ⇒ 分批回填衔接日被重置为「首板」。
- 🔴 `ds_*` **五表零真重复**（`eventId=symbol@tradeDate` 确定性）；同股多次涨停 = 多事件各一行、**不是重复**。窗口**互相覆盖**（同根 K 线多份、v1 冗余 19~20%）= **结构性必需**，副本 OHLCV 逐字节同。**禁按 `(symbol,tradeDate)` 去重；禁把窗口行数当独立观测数**。
- 审计脚本：`verifyRawDataUniqueness.mts`、`verifyBoardHeightCaliber.mts`、`verifyLimitUpCaliber.mts`。

## Migration 流程（🔴 强制）
- `drizzle/meta/_journal.json`(≤23) 与 `*_snapshot.json`(≤0015) **自 0024 起停维护**（SQL 已到 **0036**）⇒ **禁 `npm run db:push` 与 `drizzle-kit generate`**（后者会重放 0016+ 产出垃圾）。
- 流程：① `drizzle/schema.ts`（唯一权威）→ ② 手写 `drizzle/NNNN_<semantic>.sql`（`CREATE TABLE IF NOT EXISTS`）→ ③ 幂等 `scripts/applyXxx.mjs`（apply + `information_schema` 断言 + `--dry-run`/`--check`）→ ④ 实跑取证据。**禁手工补写 journal**（属伪造）。⚠️ **声明 ≠ 线上真实** ⇒ 约束/列是否存在**必须查真实库**。
- **apply 脚本的好范式（0036 起）**：SQL 内写 `-- @guard: column|index|table <target>`，脚本**先查 `information_schema` 再执行**；断言除「列类型 / nullable / 列序 / 索引列名 / UNIQUE / **FK=0** / 全库 FK 总数」外，还应**冻结既有表列签名基线**（逐列比对，证明「没意外改到别的表」）并做 **apply 前后 20 张表行数逐表比对**（证明零数据变化）。`--check` 与二次 `apply` 都要能过。
- 项目**零数据库 FK**（soft reference）：跨模块引用一律不加 FK，完整性由应用层 + 事务保证。

## 跨模块坐标（Strategy ⇄ Research ⇄ Dataset）
- **唯一引用 = `datasetVersionId = dataset_version.id`**；`datasetVersion`（`v1`/`v2`/`rd-…`）只作**显示 / 快照 label**。**禁建第二套 Dataset Version ID、禁复制 Registry 版本表、禁按 name/版本串比对**。
- **Research 侧**：`research_experiment.datasetVersionId` 是输入边界，**创建即冻结**（`ResearchExperimentUpdatePatch` 排除该列）；`research_run.inputSnapshotJson` 冻结执行基准；`research_analysis` / `research_result` / `research_run` 表**零 dataset 列**（实查）。
- **Strategy 侧**：落库前必须查 Registry 断言「存在 ∧ `status=READY` ∧ label 与 Registry `version` 一致 ∧ `datasetId` 属于该版本」，**与写入同一事务**（`db.ts#saveVersion` 内）。错误码 `DATASET_VERSION_NOT_FOUND` / `DATASET_VERSION_NOT_READY` / `DATASET_BINDING_INVALID`（唯一实现 `strategyPersistence/datasetBindingValidation.ts`）。只读口用既有 `DbDatasetRegistry#getVersionById`/`getDefinitionById`（**禁写第二套 SQL、禁自动建 Dataset、禁绕 Registry 直读 `ds_*`**）。
- **Research → Strategy = 转正线路已贯通（006.3 起，`RESEARCH-006.3 = COMPLETE`）**：`strategy_versions` 仍**无任何 research 列**（Canonical 零污染，实查）；`research_strategy_candidate` 有业务写入入口；**`promote` 已存在** ⇒ 候选可以变成 Strategy（`research.strategyCandidate.promote`，**`adminProcedure`，不开放 public**）。设计见 `docs/research/RESEARCH-006.0-architecture.md`（方案 C：Candidate 即 Draft，**不建 `strategy_drafts`**）。
- 🔴 **RESEARCH-006.3 转正入口的三条硬禁令（不知道就会立刻做错）**：① **唯一转正链路** = `ACCEPTED 候选 → promote() → definitionBuild（唯一转换器，纯函数）→ 既有 validateCanonicalStrategyDefinition → Registry 校验（存在 ∧ READY）→ StrategyService.create + saveVersion（5 投影 + Binding 校验同事务）→ provenance.create → 候选 CONVERTED`；**`CONVERTED` 最后写**，任何前置失败 ⇒ **零 Strategy 数据 ∧ 候选保持 ACCEPTED**。② 🔴 **转正输入严禁携带完整 `StrategyDefinition`** —— `overrides` 只有 `datasetBinding.datasetVersionId` + `datasetDivergenceReason`（闭集，服务层**点名**拒绝，**不静默丢弃**）；定义内容**只能来自候选草稿的 `entryRule.extra` 闭集 7 键扩展槽**（`observationWindow` / `trigger` / `eventParams` / `execution` / `position` / `risk` / `document`，**零 migration**）；**缺必填 ⇒ `PROMOTE_SKETCH_INCOMPLETE`（回去补）≠ 写错 ⇒ `PROMOTE_SKETCH_INVALID`（回去改），两者不可混报**。③ 🔴 **幂等闸门 = `strategy_research_provenance.sourceCandidateId`**；第二次 promote **绝对不能产生第二个 Strategy Version**（`strategyId` 确定性派生 `cand-<id>` + 版本号固定 `1.0.0`）；**幂等路径不静默忽略 overrides**（改绑 / 一致却填 reason / 已 divergence 传新 reason 一律拒）；**跨存储失败抛 `PROMOTE_WRITEBACK_FAILED` 且带 `strategyId`/`strategyVersionId`/`stage`，🔴 禁止删除已创建的 Strategy 做「回滚」**（代码零 delete），恢复靠「闸门幂等 + version 写**指纹幂等自愈** + 补写 provenance + 补回写候选」。
- 🔴 **两层指纹不可混用（006.3 实测抓到的真 bug，极易重蹈）**：`StrategyVersionRecord.fingerprint`（§17 **追溯记录**指纹，摘要**含 `codeVersion` / `createdAt`** 等**每次注入可能不同**的元数据）**≠** `StrategyVersionBundle.fingerprint`（= `strategy_versions.fingerprint`，**document 内容指纹**，`saveVersion` 的幂等/冲突判定用它）。**判「内容是否一致」必须用后者**；用前者会把「同一份内容、换了个时间戳」误判成 `PROMOTE_VERSION_CONFLICT`，**让整个幂等恢复路径失效**（`strategyPromotionPort.findVersion` 已按此写死）。
- **Bridge 边界表述（006.3 起 = 允许清单式，非「一律禁止」）**：`importBoundary.test.ts` 的跨界允许清单 = `STRATEGY_PERSISTENCE_ALLOWLIST = ["strategyPromotionPort.ts"]`、`STRATEGY_SCHEMA_ALLOWLIST = ["strategyPromotionPort.ts", "definitionBuild.ts"]`，并断言**清单成员确实存在**（防清单写错文件名导致断言恒真）+ 不得直接写 `strategy_versions` + Strategy 侧不得反向认识 `researchCore`。**`cloneVersion` / `origin = INHERITED` / Promote UI / Candidate 前端仍不存在**（属 006.4+）。
- **RESEARCH-006.1 已建成的桥（实查 DATA_READY，业务线路仍未接）**：`research_strategy_candidate` +4 列（`sourceDatasetVersionId` 从 `research_experiment.datasetVersionId` **复制后不可变**；`sourceResearchRunId` 经 `evidence.primaryAnalysis.analysisId → research_analysis.runId` **两跳**解析、**提不出即 NULL 禁伪造**；`sourceTraceJson` 是 provenance **快照**，因 `research_result` **非 immutable**（重算即 `deleteByAnalysis`+`createMany`）；`sourceDatasetDivergenceReason` 一致时**必须 NULL**）+ 新表 `strategy_research_provenance`（**Strategy 侧独立切面、display-only、零 FK、快照值**，`UNIQUE(strategyVersionId)`；**不是** `strategy_versions` 的列、**不是** `StrategyDocument.definition` 的字段）。**唯一桥目录 = `server/research/strategyCandidate/`**（有 `importBoundary.test.ts` 守护：只有它可同时 import `researchCore` 与 `strategyPersistence`）。
- 🔴 **Candidate 普通 update 边界（006.1 裁定，防重蹈）**：**硬拒**（类型层 + `assertCandidateUpdatePatchKeys` 响亮失败）= `experimentId` / `conclusionId` / 4 个 `source*`；**状态机守卫**（`assertCandidateTransition` + `assertCandidateConversionCoherence`，**语义不可改**）= `status` / `strategyDefinitionId`（006.2 在 **API 层**摘除，006.3 起 `CONVERTED` 只能由 `promote` 到达）。⚠️ `researchCore/repository/inMemory.test.ts` 是 RESEARCH-001 既有验收，**用 `update({status})` 走完四态迁移** ⇒ 禁把它们从**仓库层**摘出。
- 🔴 **RESEARCH-006.2 已接通的 Candidate 业务线路（CODE_READY）**：`research.strategyCandidate.{get【public】, createFromConclusion / update / transition【admin】}`。四条硬纪律：① `createFromConclusion` 八步校验链，**`status` 恒 `DRAFT`**（代码从不传 status），`sourceDatasetVersionId` **只从 `experiment.datasetVersionId` 复制**，`overrides` **明确拒绝 `datasetVersionId`**；② `update` = **闭集白名单**（可写仅 7 个草图字段；**逐个显式赋值、禁 spread**；硬拒 `status`/`strategyDefinitionId`/`conclusionId`/`experimentId`/4 个 `source*`/未知字段；空 patch 亦拒）；③ 🔴 **`CONVERTED` 三处入口全拒**（`createFromConclusion` 结构性 / `update` 白名单 / `transition` 专属码 **`STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE`**）—— **只有 006.3 的 `promote()` 能产生 `CONVERTED`**；Router 的 `to` 枚举**故意含 `CONVERTED`**；④ `sourceTraceJson` 是**最小充分快照**（只读结论自身 `evidenceJson`，**不是 result 第二份存储**；**不伪造策略定义**：Conclusion 里没有的 `entryRule`/`exitRule`/`riskRule`/`parameterSpace` 缺省**全留空**）。**桥在 006.2 阶段不 import `strategyPersistence`/`strategySchema`**（`importBoundary.test.ts` 当时追加 2 例守护，含「不得出现写 `strategy_versions` 痕迹」）—— ⚠️ **该「一律禁止」是 006.2 的阶段纪律、非架构铁律**；**006.3 已把它改写为允许清单式**（见上「Bridge 边界表述」）。
- **桥梁验收方法论（可复用）**：把断言抽成**唯一一份**契约（`strategyCandidate/provenanceContract.ts`），由 InMemory 与**真实库**各驱动一遍并断言**用例名集合逐字相同** —— 两边各写一套断言只能证明「各自的实现没崩」，**不构成语义一致证据**。`UNIQUE` 这类约束要用**裸 SQL 重复插入**独立证明（`ER_DUP_ENTRY`），不得用应用层「先查后插」冒充 DB 约束。

## 总控与命名（强制）
- `ROADMAP.md` = 唯一 Master Control：**§44 真实状态（覆盖式）**、**§44.5 任务队列**、**§47 更新记录（append-only + 时间戳）**。每任务完成必须更新三者并定下一任务。
  - 🔴 **§47 的正文自 2026-09-13 起独立为根目录 `ROADMAP-CHANGELOG.md`**（原 §47 日志 718 行 / 约 500 KB = 全文 59%，拆出后 `ROADMAP.md` 852 KB → 约 332 KB）。**追加一律写进 `ROADMAP-CHANGELOG.md` 的文件末尾**；`ROADMAP.md` 里的 §47 只剩指针（**禁在 ROADMAP 里重建日志**）。历史条目零改写；拆分同时修掉了「`# 49.` 标题把日志割成两段」的错位。
- 7 态 `DESIGN/CODE_READY/DATA_READY/VALIDATED/RESEARCH_READY/PRODUCTION_READY/BLOCKED`；**只有 `RESEARCH_READY=TRUE` 才允许正式策略结论**（代码存在 ≠ VALIDATED，测试通过 ≠ Research Ready）。
- ⚠️ **同一文件禁同批次并发多个 Edit**（静默丢改动）；本仓库**常有并行会话** ⇒ 唯一锚点 + 单次 Edit；**并行会话改动的文件不得混淆归属**（判据用 `find -newermt`）。
- 命名（§49）：模块/文件/目录**禁带 STEP/C-task 编号或数字后缀**，纯语义小驼峰；命名前先全库查重。
- ⚠️ **STEP 编号会撞车**：`RESEARCH-006/007/008` 已被 §47（现 `ROADMAP-CHANGELOG.md`）的**结果页可读性前端任务**占用；架构线用 `RESEARCH-006.0/.1/…` 子号区分。

## 铁律
- 优先级：正确性 > 数据真实性 > PIT > 可复现性 > 架构完整性 > 测试 > 速度。证据 **真实 DB > 运行结果 > 代码 > 测试 > 文档 > 假设**；**禁 mock 冒充真实数据**。
- PIT：asOf 只看 T 时刻已知。Survivorship：历史池不得用当前列表回填。
- 已有测试失败基线（环境依赖，**禁为过测试改快照或期望**）：`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`（共 15 例 / 7 文件；案数会 ±1 抖动，**判据是「失败文件集合」而非案数**）。

## 🔴 测试文件布局（2026-09-13 起，全仓收拢）

- **唯一坐标 = 仓库根 `tests/`**，**镜像源结构**：`server/<a>/x.test.ts` → `tests/server/<a>/x.test.ts`；`client/src/**` → `tests/client/src/**`；`shared/**` → `tests/shared/**`。共 **230 个**（208 server + 18 client + 4 shared）。**禁再往源码目录写新测试**（会立刻破坏布局一致性）；`scripts/**` 仍是脚本验证区、不进 vitest。
- 配置：`vitest.config.ts#test.include` = `tests/**/*.test.ts` + `tests/**/*.test.tsx` + `tests/**/*.spec.ts`；`tsconfig.json#include` 含 `tests/**/*`，`exclude` 仍排除 `**/*.test.ts`（⇒ 测试仍不进 `tsc`，语义与迁移前一致）。
- 🔴 **迁移/新增测试时必须处理这 5 类「位置敏感」写法**（漏一类即静默失效，不是编译错）：
  1. **相对 import** —— 必须先把原说明符解析成仓库相对绝对位置、再 `relative(newDir, targetAbs)` 重算。**禁「加 `../` 前缀」式字符串替换**（目录深浅不同时必错）。
  2. **`import.meta.dirname` 基准** —— `resolve(import.meta.dirname, X)`：在 `import.meta.dirname` 后**插一个回退段** `relative(tests/<top>/<subDir>, <top>/<subDir>)`。`resolve` 收任意多 path 片段 ⇒ 插纯片段**不改变语义**，是最稳写法。
  3. **`import.meta.url` 派生基准** —— `readFileSync(new URL(rel, import.meta.url))` 改 URL base；`path.dirname(fileURLToPath(import.meta.url))` 补 `..` 层数。
  4. **裸 `from "."`（自引用目录）** —— 指向目录自身（= `index.ts`），**会被 `/\.\.?\//` 正则漏掉**（要求尾斜杠）⇒ 移后变目录、报 `EISDIR: illegal operation on a directory, read .`。必须显式写成指向原目录的完整相对路径。现存 3 处：`tests/server/research/{disciplineFeedback,signalToPnl,tradeJournal}/`。
  5. 🔴 **`vi.mock(...)` 说明符 = 模块身份**（最隐蔽）—— mock 说明符是**相对测试文件**解析的；移后若解析到另一个文件（或不存在），与被测源码 import 的模块**不是同一模块身份** ⇒ **mock 静默失效**（症状示例：`mockedFetchDaily.mockResolvedValue is not a function`）。**判据 = mock 说明符必须解析到与被测源码同一个文件**，与测试文件在哪无关。现存 1 处：`tests/server/marketFactors.test.ts` 的 `vi.mock("../../server/tushare")`。
- 回滚：**首选 `git checkout -- server client/src shared && git clean -fd tests`**（一步还原位置 + import 路径，不会漏改）；`_migrate_tests_rollback.mjs` 只做物理搬运、路径需另改。迁移脚本 `_moveTestsToRoot.mts`（在根目录，保留作证据）。
- ⚠️ **迁移中间态曾出现 9 个新增失败**（16 文件 / 28 例 vs 基线 7/15），全部来自上述第 3/4/5 类漏改 ⇒ **判定「迁移成功」的唯一标准 = 失败文件集合恰好等于基线集合**，不是「文件都搬过去了」。

## 🔴 前端候选草图（RESEARCH-006.4.1-C 系列 · 纯 `client/**`）

- **`filterRule` 的正名与归位**（C.3 / **归属段 2026-09-13 改**）：🔴 它的**唯一去向是 `entry.conditions`**（`definitionBuild.ts:506-508`）=「全部满足才产生买入信号」⇒ 它**是「买入条件」、不是「剔除条件」**（`SKETCH_BLOCK_LABELS.filterRule = "买入条件"`）；**归属段是 `condition`（什么条件买，2026-09-13 由 `when` 改过来）、不是 `what`**（`SKETCH_BLOCK_HOME_SEGMENT.filterRule = "condition"`）。🔴 **禁把它折回 `when`（什么时候买）段，也禁标成「剔除」** —— 前者会让「**可空的条件**」与「**三项全必填的时点**」共用一个段徽标，用户填完看得见的条件后徽标仍停在「还差 N 项」、且清单里那几项看不出属于同一段 ⇒ 这就是用户连续四轮投诉「什么价买永远还差一箱校验」的**真实机理**（**结构问题不能用压文案解决**）；后者会让用户把方向写反（去写 `NOT_IN` 才买）。条件模板 `CANDIDATE_CONDITION_PRESETS` 前两条**逐字取自后端 golden sample** `FIRST_BOARD_PULLBACK_DEFINITION`（`bar.low >= prefix.rd0.open` / `bar.volume < prefix.rd0.volume`）⇒ **禁自己编口径**；条件行**禁退回裸字段引用输入框**（用「部位 + 相对日 + 字段」三格选择器 + 人话预览 + 小字回显原始引用；不可解析的既有值退回自由文本且**绝不重建** —— 防静默丢数据）。
- **五块结构化表单**（C）：`entryRule`/`filterRule`/`exitRule`/`riskRule`/`parameterSpace`，**禁退回 JSON 文本框**；草稿三态 `empty|structured|raw`，**表达不了 ⇒ 整块降级只读 `raw` 且 `raw` 永不进补丁**（只有显式「清空」才提交 `null`）；类别名一律取自 `candidateSketchVocabulary.ts`（**服务端词表的手工镜像**，`candidateSketchForm.test.ts` **对表测试**锁定 ⇒ 后端词表一变测试先红）。🔴 补丁比较**必须双侧规范化**（`canonicalSketchJson` + `sketchValuesEqual`）—— 拿字面值直接比会把 `extra: {}` / 键序差异误判成改动（用户什么都没改却真写一次库，**完全静默**）。客户端**不能** import 服务端运行时值（否则服务端模块打进浏览器包）⇒ 该模式是唯一可行解。
- **七段决策顺序**（**2026-09-13 由六段改七段**）：界面**七段**（①买什么 → ②**什么条件买**（可空）→ ③什么时候买（三项必填）→ ④怎么卖 → ⑤买多少·最多持几只 → ⑥成本与资金 → ⑦参数搜索空间），**段 ≠ 存储块**。🔴 `entryRule` 一块**同时承载第 ①③⑤⑥ 段** ⇒ 整块降级 `raw` 会**同时影响四段**；`raw` 原文靠 `SKETCH_BLOCK_HOME_SEGMENT` **只在归属段展示一次**（其余段给一句指路，不重复贴 JSON）。🔴 **改段数必须同步查 5 处**：`SKETCH_SEGMENTS` / `SKETCH_SEGMENT_REQUIRED` / `SKETCH_BLOCK_HOME_SEGMENT` / `CandidateSketchCard#SEGMENT_READONLY`（`Record<SketchSegmentKey,…>` 有**穷尽性检查**，缺键 `tsc` 直接报 TS2741 —— **这是防线不是障碍**）/ `CandidateSketchFields` 的 `statuses[]` **下标**（①→0 … ⑦→6）+ 测试的段顺序断言。🔴 **转正必填 = 10 项**（`entryRule.event` / `timing` / `observationWindow` 3 格 / `trigger` / `quantityMethod` / `lotSize` / `sizingMethod` / `maxPositions` / `initialCapital` / 六项费率）—— **写必填性前必须去校验器里数**；🔴 **`exitRule` 不是转正必填**（`definitionValidation` 只校验 `exit.rules`「是数组」、全文无「至少一条」⇒ **禁再产出「出场规则至少一条」类缺口**；曾据字段名编造出该必填，已核实纠正）。缺口**单一建模** = `SketchValidation.gapDetails` 为源、`gaps` 只是它的标签投影（不得两套说法）；gap label 已全压到 3~8 字。`SKETCH_SEGMENT_REQUIRED` **单列成表**以获**穷尽性检查**（新增段漏写必填性会编译失败）。成本预设 `candidateSketchCostPreset.ts` **只覆盖七项费率 + 每手股数、绝不动 `maxPositions`**，且**只有用户显式点「套用」才写入**（预设 ≠ 隐式默认值；「Promote 不补默认值」约束的是转换器、不是界面）。
- **缺口必须「说清差哪一项」**（C.4）：三通道 = `errors`（阻保存）/ `gaps`（转正必填未填，**不阻保存**）/ `warnings`（能过但结果变，**不阻断保存、不阻断转正**）。🔴 `SketchGap` 增 `anchors`（机器可读落点），**与 `label` 在同一 `gap(...)` 调用点配对** ⇒ 物理上不可能「清单说 A、高亮落在 B」；`SketchSegmentStatus.gaps` 是本段切片；界面落点判据**唯一** = `missingAt(segment, anchor)` 只读 `statuses[].gaps[].anchors` —— 🔴 **禁再另立一张必填表**（必漂移）。🔴 **缺口清单必须显示在编辑器里**（此前只在只读卡片 `CandidateSketchCard` 列出 ⇒ 用户「永远还差一箱」却看不到落点）。🔴 词表选项若「**选了必然被转正拒掉**」，用 `SketchOption.disabled` **置灰 + 写明服务端错误码 + 配自失效测试**，**禁从词表删除**（对表测试是漂移哨兵，删掉会掩盖服务端矛盾）。🔴 写字段语义说明前**先去权威实现读它怎么算**（`NEXT_TRADING_DAY` = 条件满足后**再顺延一个交易日**，不是「信号在 T+1」）。
- ⚠️ **两层运算符表示**：表单与 `ResearchConditionSet` 用**符号**（`>=`），`StrategyDefinition.entry.conditions` 用**长名**（`GREATER_THAN_OR_EQUAL`），靠 `CONDITION_OPERATOR_MAP` 对齐（探针两层各断言一次）。
- ⚠️ `entryRule.extra.position.maxSinglePosition` 与 `riskRule.maxPositionWeight` **不能同时声明**（转换器报「重复声明同一事实，只能二选一」）。
- **结果「矩阵视图」**（RESEARCH-007.2 · 纯 `client/**`）：结果页签**默认矩阵**；**归组靠 `name`（T+d + 桶）+ `target`（权威）**，决策日须一致 ⇒ **改名会让分析脱离矩阵**（进「未归类」并带原因，不静默丢弃）；不产生新统计量、显著性基准是「全样本」（非相邻桶）、小样本不判显著。

## 🔴 长表分页与矩阵首屏限流（RESEARCH-006.5 · 纯 `client/**`）

- 🔴 **「页面打不开」先分四条路**：**① 编译错 ② 接口挂 ③ 渲染崩 ④ 体感卡**。2026-09-13 实查 `/research/240002`：①②③ **全被实测排除**（页面与本轮改动模块 `curl` 全 200；`getExperiment` 200 + 154,576 字节、**连续 10 次复测全 200**；真实数据跑 `runToVm`/`buildMatrix*`/`summarizeRows` **均不抛**），真因是 **④ —— 首屏并发把页面堵住 ~10s**。**把它当 bug 去翻 errant 字段会完全跑偏。**
- **真因量化**：结果页签默认 `matrix`，默认族（`BARE × return_5`）= **30 格** ⇒ `useQueries` **并发 30 个 `getAnalysisResults`**；交错 3 轮实测单次 **~1.4s**、**30 并发 ~9.6~10.6s**（≈7×，**远超 2× 噪声阈值**）。叠加「分析」表**平铺 180 行**（实测逐 Run：`540001`=**180**，`510001`=29，其余 ≤7）。
- 🔴 **`useQueries` 的并发数 = 用户可见等待时间**：凡 `xxx.map(…)` 形态的 `useQueries`，先问「**最坏情况下 N 是多少**」。
- **修法（已落地）**：
  1. **分页纯函数层** `client/src/components/research/clientPagination.ts`（`totalPagesOf` / `clampPage` / `paginate` / `pageRangeLabel`；`DEFAULT_PAGE_SIZE=20`）。🔴 **复用既有 `PaginationBar` / `common/DataTable`，禁新建分页组件**。
  2. `ResearchDetail.tsx` 三张长表接分页：Run 表 / **分析表（主犯）** / 结果页「逐分析」按钮组。
  3. `ResearchMatrixView.tsx` **首屏限流**：纯函数 `selectFetchCells` + 常量 `MATRIX_INITIAL_FETCH = 12`（在 `researchMatrix.ts`）⇒ 首屏只取 12 格，其余用户点「**载入其余 N 格**」补齐；切口径/切族**自动回保守首屏**。**效果 ≈2.2×（~9.6–10.6s → ~4.5–4.7s）**。
- 🔴 **分页两条硬性质（必须写成测试）**：
  - **越界页码一律夹取、绝不返回空页** —— 删行 / 调大每页条数后旧 `page` 越界，直接 `slice` 得**空数组** ⇒「表突然空白」的**假空态**；**夹取后页码必须回写 state**。
  - **空集合 `totalPages` 恒 = 1**（与 `PaginationBar` 的 `Math.max(1,…)` **同源**；禁两处各自 `|| 1`）。切 Run / 改过滤词须**自动回第 1 页**。
- 🔴 **限流 ≠ 截断**：首屏只取前 N 格时，未取格**必须**沿用矩阵既有「**缺格不隐藏**」纪律显示「结果加载中…」，**不得静默丢弃**。
- **验收路径**（本机无 `agent-browser`、仓库无 jsdom ⇒ 禁写浏览器截图）：`tsc --noEmit` → `vitest run tests/client/` → **真实数据端到端**（真 tRPC 取 180 条 → 分页拼回 **不重不漏** + 越界夹取非空页）→ `vite build`。

## 🔴 已知地雷（已查实 · 未修 · 全部须单独排期，改 `server/**` 杀在途 Run）

- 🔴 **连接池 `maxIdle === connectionLimit` ⇒ `idleTimeout: 60_000` 是死配置**（2026-09-13 实查；证据见 `2026-09-13.md`）：mysql2 仅在 `maxIdle < connectionLimit` 才启动空闲回收，`getConnection()` 直 pop 无存活探测 ⇒ 死连接原样发出 → `read ECONNRESET` → Drizzle `Failed query: …`。症状 = Strategy Editor「保存失败」（`saveVersion` 事务内校验读，无 `withReadRetry`）。区分「瞬时 vs 数据问题」：裸 SQL / live server 同路径复测。修法：① `maxIdle < connectionLimit`；② 只读路径复用 `withReadRetry`。
- 🔴 **`ENTRY_TIMING_TO_EXECUTION.SAME_CLOSE` 自相矛盾**（2026-09-13 实查；`definitionBuild.ts:87-96` vs `definitionValidation.ts:705-722`）：该值映射成 `signalTiming=T_CLOSE` + `executionTiming=T_CLOSE`，被 **L6 直接拒绝**（`SIGNAL_EXECUTION_TIMING_CONFLICT`）⇒ 词表里存在「**选了就必然在转正时失败**」的选项。**临时处理**：前端已置灰（`SketchOption.disabled`）+ 写明 L6 码与替代项 + 自失效测试。**修法** = 二选一：① 从 `ENTRY_TIMING_TO_EXECUTION` 删该键（前端对表哨兵会先红，须同步）；② 或让 L6 接受「同 bar 收盘信号 + 收盘成交」（须先论证该口径是否真实可交易）。
- 🔴 **`OR` / `NOT` 在转正时被静默压成 AND**（2026-09-13 实查；`definitionBuild.ts#buildConditions`）：它把所有条件组**扁平化**进 `ConditionDefinition[]`，而该结构（`definition.ts:408-419`）**没有逻辑运算符字段** ⇒ `entry.conditions` 实际是**全部 AND**；草稿写「或」**不报错、不留痕迹，策略却被改成另一个意思**（真实转换器取证：OR 版与 AND 版产出的 conditions **逐字节相同**）。前端已加 `warnings` 通道。**修法** = 给 `ConditionDefinition` 加逻辑位（或改成嵌套组）。
- 🔴 **`ConditionDefinition.value` 无算术 ⇒「相对事件日回撤 X%」表达不了**（2026-09-13 实查）：`valueType` 只有 `CONSTANT`/`FIELD_REFERENCE`/`PARAMETER_REFERENCE`、**没有算式** ⇒ `prefix.rd0.close * (1 − 0.05)` 写不出来；界面已如实说明并给替代路径（用首板日开/高/低/收做**价格锚点**，或把幅度**做成参数**），**禁提供必然被转正拒掉的选项**。**最小扩展** = 加「条件右值表达式」或派生字段（如 `bar.drawdownFromEventClose`）。
- 🔴 **界面「运行策略」必然 0 执行**（2026-09-13 实查）：`closedLoopRunInputSchema`（15 字段）**没有 `researchDataset`**（其中的 `datasetVersion` 只是谱系标签、不加载数据）⇒ 路由器 `loopRun` 只填 `evaluationInput`/`lifecycle` ⇒ 装配层不注册 `data` 执行器 ⇒ 门禁 1 发 `CL_DATA_NOT_INJECTED`、其余 13 阶段 `CL_UPSTREAM_BLOCKED` ⇒ **恒为 executed=0**。设计侧明说「从 UI 发起的运行必然如此，不是缺陷」（`RESEARCH-002-report.md:1018/1479`）。🔴 **禁为消除该阻塞而伪造/合成 dataset**；真修法 = **路由器层**解析 `datasetVersionId` → 真实 `ResearchDataset`（`buildResearchDataset`/`readRowsStreaming`）注入 `wiringInputs`，**装配层零改动**；且须排在数据域 G0 认证之后（否则首阻塞只是推后成 `CL_DATASET_GATE_NOT_PASS`）。
  - ⚠️ **判别口径：这是「观感」不是「故障」（2026-09-13 13:55 实查）** —— 用户报「运行策略按钮**卡住**」时，**不要**去查超时 / 死锁 / 未实现：实测 dev server `GET /` 200/**7ms**、`readiness` 200/**3.5ms**、`loopRun` 与前端逐字段相同的请求体 **6ms** 返回 `status=NO_STAGE_EXECUTED`（未填日期则 2ms 被 zod 拒 `startDate/endDate 必填`），`buildClosedLoopRunViewModel` 解析成功 ⇒ **整链无任何卡点**。真实感观 = 点完得到一张「已执行 0 / 阻塞 14 / 首阻塞 `CL_DATA_NOT_INJECTED`」的表（用户已裁定现象为「结果出来了但全是 0 / BLOCKED」）。🔴 **先问清是「转圈不恢复」还是「有结果但全 0」再动手**；后者属本条、只登记不改代码。证据 `docs/evidence/_probe_looprun_hang.mts` / `_probe_looprun_ui.mts`（重跑须在项目根目录）。
- 🔴 **`dataHealth.recertify` 不是零副作用端点**（2026-09-13 03:20 落地）：本仓**唯一**会让服务端执行外部脚本的 tRPC 端点 —— 实际跑 `scripts/step12_certify_gate.mjs`（**≈85 s**、加载 TiDB、并**重写被 git 跟踪的** `docs/researchReadyGate/research_ready_gate.json`）。⇒ 禁在用户正做研究/跑 Run 时自动或误触；它与页面「重读快照」（`overview.refetch()`，只读文件、零 DB）**不是同一件事**，改文案时不得再混称「刷新」。该端点**只重跑那条脚本**，判定逻辑仍 100% 在脚本里（服务端零复制）；失败/超时/产物不合法 ⇒ `ok:false` 且 `snapshot` 恒 null（**禁**改成像「回退到上一次快照」那样粉饰）。
- ⚠️ **生产读路径 `strategyPersistence/db.ts#loadProjections` 无重试**（2026-09-12 登记）：跨境空闲连接复用会 `read ECONNRESET`，用户打开带溯源的策略页时溯源区可能读失败；最小改法 = 复用既有 `withReadRetry`。同属上条连接池地雷家族。
- ⚠️ **`saveVersion` 注释声称绑定校验与写入「同一事务」但实际不是**（2026-09-13 附带审计发现）：`DbDatasetRegistry` 走池根 `getDb()`、**不是**事务的 `tx` ⇒ 校验读在**另一条物理连接**上、不在事务快照内，「校验─提交残留窗口」比注释声称的更大（低优先级，未修）。

## 🔴 运行工作台「等很久」的真实账（2026-09-13 实查 · 全链证据）

> 起因：用户报「运行策略**会等很久**，然后报 `Failed query: … from liquidity_daily … query: 7.969s`」。
> 证据簇 `docs/evidence/` 的 `perf` 节（7 个探针，重跑须在项目根目录）。

**一、这类报错先判「SQL 慢」还是「连接层」**（判据，勿凭感觉）：
- 拿报错原文里的**列序 + where 形状**去代码里定位唯一调用点（本次 = `datasetRegistry/db.ts#fetchLiquidityForSymbolsInRange`）；
- 裸连接直跑同一语句：本次 **250ms 成功**（走唯一键 `uq_liquidity_daily_security_date` 的 `Batch_Point_Get`）⇒ **SQL 无罪**；
- ⚠️ **`query: 7.969s` 这个数字是「排队 + 执行」的总和，不是执行时间**。它出现在 `liquidity_daily`（901.5 万行）上最容易误导人以为「表太大」。

**二、🔴 单次性能采样**不可信**（本次最大的教训）**：
- `_probe_bandwidth.mts` **单次**采样得出「并发 3.45× 惩罚」，据此我一度写下「跨境链路反并行」的结论；
- `_probe_concurrency_interleaved.mts` **交错 5 轮**（c=1→2→4→1→2→4…，消除时段漂移）= 1406 / 1268 / 1355ms ⇒ **惩罚 0.96×，根本不存在**；
- 同一 c=1 在不同时刻实测 **1208~2847ms（1.5~2.4× 波动）**。⇒ **改性能结论前必须交错重复 ≥3 轮取中位**；单次差值 <2× 一律视为噪声。

**三、真实耗时账（390002 窗口 = 2024-09-01~2026-08-31 / 484 交易日 / 5,604 标的 / 23,978 事件 / 1,543,082 行）**：
| 段 | 实测 | 全窗外推 |
|---|---|---|
| 涨停候选（`fetchLimitUpCandidateBars`，`select *` + 谓词 + ORDER BY） | **5,615ms / 30 交易日**（9,991 行） | **≈129s / 23 片** |
| Phase2 定向取数（`fetchBarsForSymbolsInRange`，400 只 × 30 日） | **4.5~6.5s** | 按片数 × 批数叠加 |
| `loadTradingDays` | 382ms | — |
- ⇒ **「等很久」= 分钟级，是真实工作量的必然结果，不是 bug**。它是**同步 HTTP 请求**（`loopRun` 直到全部跑完才返回）⇒ 前端只能干等。
- 🔴 **`compress` 必须保持开启**：实测 3130ms vs 8039ms（**2.57×**），是本题最大的单点杠杆。禁为「简化」关掉。

**四、SQL 形状仍是可优化项**（登记，未改）：
- `fetchLimitUpCandidateBars` 用 `db.select()`（**全列 30+ 字段**）+ `ORDER BY tradeDate, stockCode`：本次实测 `select *` 4824ms vs 显式 9 列 4411ms —— ⚠️ **但这是单次采样，差 8.6% 属噪声，不足以支撑「换成显式列就能提速」**。若真要优化，须按第二条的判据重测。
- 更实的方向是**减搬运行数**（`LIMIT_UP_CANDIDATE_SQL_PREDICATE` 收紧 / 让 ORDER BY 走索引），而非减列。

**五、前端体验（`client/**`，未改）**：当前 `loopRun` 是**一次性长请求**，无进度、无阶段回显 ⇒ 分钟级等待期间界面无任何反馈。可选改善 = 改异步作业 + 轮询（对齐 `dataset_build_job` 既有模式），但**那是架构改动、属单独排期**。


## 🔴 运行工作台必须「优先直读已绑定数据集」（2026-09-13 修复 · 定案）

> 起因：用户「**我明明是设置了数据集，并且数据集中已经有了基础的数据可以支持策略运行，为什么又要去日线行情表中去查，这是完全不合理的**」。
> 证据簇 `docs/evidence/` 的 `datasetdirect` 节（5 个探针）。**用户指控 100% 成立。**

**一、问题的真实形态（比用户描述更严重）**：
1. 数据**已完整落库**：`ds_*` 五表按 390002 计数 = 23,978 + 503,538 + 471,816 + 471,816 + 71,934 = **1,543,082**（与 `dataset_version.totalRows` 逐字一致）；`prefix` 含 **503,538 行 OHLCV**；
2. 策略**已显式绑定**：3 份策略文档全部含 `definition.datasets[PRIMARY].datasetVersionId = 390002`（兜底 doc 级 `document.datasetVersionId`）；
3. 但运行时**完全无视**：`assemble.ts` 无条件 `buildResearchDataset(窗口 = 前端填的日期)` ⇒ 从零重算（**两条报错的共同来源**）；
4. 为何不合理：违反铁律「Dataset 唯一坐标 = `datasetVersionId`」；重建应视为**缓存未命中**而非默认路径；另有三宗罪 —— **分钟级等待 / 链路抖动（这正是那次 `liquidity_daily` 报错暴露的）/ 产物可能与已认证 READY 版本漂移**。

**二、修复（本次）**：
- 新增 `server/runWorkbenchAssembly/datasetFromRegistry.ts`：给定 `datasetVersionId` → 经 **Dataset Registry 既有只读接口**（`DbDatasetRegistry.getVersionById` / `getDefinitionById` + `DbDatasetDataReader`）投影为 `ResearchDataset`。**不新增第二套读取实现、不写 SQL、不直连物理表。**
- `assemble.ts` 改为 `resolveDataset()`：**`prefer-registry`（默认）优先直读**；直读失败（未绑定 / 非 READY / 体系不支持 / 超护栏 / DB 不可用）才回落重建，**且回落原因如实写进 `assembly.datasetSourceNote`**（`LoopRunAssemblyError` 之外的其他错误一律上抛，不把 bug 伪装成「直读不可用」）。
- `researchRunRouter.ts` 从策略文档提取 PRIMARY 坐标（`primaryDatasetVersionIdOf`）传入；前端 `ClosedLoopRunResultPanel` 新增「直读已绑定数据集 / 从零重建」标识徽章 + 回落原因横幅。
- 新增契约字段：`assembly.datasetSource`（`registry`|`rebuild`）/ `datasetSourceNote` / `datasetVersionId`（`shared/researchContracts.ts` 同步）。

**三、实测效果（真实 DB，`_probe_runworkbench_dataset_source.mts`）**：
| 路径 | 来源 | 耗时 | 行数 |
|---|---|---|---|
| 带绑定 id=390002 | **registry** ✅ | **6.2s** | 23,978（= 库内逐字一致） |
| 无绑定 | rebuild（原因如实） | 60.6s | 96,912 |
| 不存在的 id | rebuild + `REGISTRY_VERSION_NOT_FOUND` | — | 96,912 |
- ⇒ **直读比重建快 ~10×**（6.2s vs 60.6s），且不再触碰 `stock_daily_prices` / `liquidity_daily`。

**四、投影口径（🔴 改这里前必读，否则会静默错）**：
- `ds_*` 是**事件级窗口**（`relativeDay ∈ [-pre, +post]`），与 `ResearchDataset` 的**逐日全市场面板**形状不同。桥**每事件恰产出一行**（`tradeDate = event.tradeDate`，OHLCV 取 `prefix` 的 **rd=0** 行）—— rd<0 是过去特征、rd>0 是未来信息，**都不构成决策日行**（否则 `(tradeDate, securityId)` 唯一键必破）。
- 🔴 **`post`（rd≥1）不并入 rows**（未来信息，逐日 PIT 面板禁止混入）；桥在 `gateNotes` 标注 **`POST_WINDOW_NOT_PROJECTED`**。需要 T+N 窗口撮合的策略**必须**走重建路径。
- Registry 未落库的列（`securityType` / `st` / `industryName` / `lifecycleVerdict` / `corporateActions` / `indexClose`）一律**忠实「未知」**（`UNKNOWN` / null / 0 / `{}`），**不猜不填零**；逐项进 `knowledge`。
- `datasetVersion` 由 `computeDatasetVersion(request, universeDefinition, rows)` 对**本次投影内容**重算 ⇒ 与 `bindResearchDataset` 的 `asOf === tradeDate` / 排序唯一 / `universeDefinition.days` 升序 / `dataSnapshot.request.start|endDate` 存在 四项强校验自洽。**装配层必须把同一份 dataset 对象同时喂给 `experimentConfig` 与 `inputs`**（`assertDatasetVersionConsistent` 要求两者 `datasetVersion` 相等）。
- 🔴 **只读性能（实测拆分的定案值，勿凭感觉改）**：事件分页 `limit=5000`（5.3s，优于 2000 的 8.8s 与 10000 的 7.9s）；rd=0 批读 `batch=1000 / conc=池上限`（1.4s）。**并发用池上限而非工具默认 8** —— 本桥批读是完全独立的只读语句，实测 conc 8→16 有 1.5~2.4× 收益。改这些常量前须按「交错重复 ≥3 轮」判据重测。



