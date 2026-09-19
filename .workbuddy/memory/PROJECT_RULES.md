

## 🔴 MEMORY.md 细则下移（2026-09-19 · OOS-001 `9bv` 轮）

> 触发：`MEMORY.md` 再次超注入上限。以下为**从 MEMORY.md 迁出的完整细则**；MEMORY.md 只留 1 行指针。
> 检索：`grep "细则下移" .workbuddy/memory/PROJECT_RULES.md`。

### 页面 · 完整细则

- 侧栏高亮 = **分段精确匹配 + 取最长命中**（`AppShell.tsx#isPathActive`，禁 `startsWith`）。**首页入口 = 左上角网站标题**（`data-slot="sidebar-home-link"`）⇒ 站在 `/` 侧栏**零高亮**。
- 首页 = `client/src/pages/Dashboard.tsx`：四指数迷你卡（各 **120 交易日**）+ 共享分类轴两联图（右轴**仅成交额**）+ 连板梯队「高度 × 网格」+ 题材热力图。
- 梯队「高度」= **「若该股本日涨停会达到的连板数」**（断板 +1；**首板未续也 +1**）⇒ 唯一实现 `shared/ladderHeight.ts`（**口径函数须落 `shared/`**）；折叠是**组内**的（`LADDER_GROUP_VISIBLE_ROWS=3`）；行序按题材当日热力降序（`shared/sectorHeatOrder.ts`，缺热度 -1）。⚠️ `limit_up_records.boardCount` 基本全 NULL ⇒ **不可作真源**。
- 生成物禁手改：`darkCompatibility.css` / `favicon.svg`。运算符两形只在 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 译；**免责声明不得删**。
- 🔴 **CDP 五坑**：① 兼听 `requestWillBeSent` ② toast 每 400ms 轮询（4s 消失）③ 模板串正则 `\s` 被吃（用 `includes`）④ Radix / 受控控件只认真实鼠标 ⑤ 端口**实测空闲**。DOM 锚点必须**页面主体唯一长锚点**（禁侧栏短词）。
- 🔴 **静态标题锚点 ≠ 数据到位**：面板一出现就点会点在 `加载中…` 上（假失败）⇒ 必须等**目标数据行数 > 0**；深链也要等**元素计数**达标。⚠️ 同页挂多面板时查询落地可能 **~20 s**（dev 冷编译；热态 6 s）⇒ 预算放宽 + **点不中就一直重试**；pass 表达式取**已达标那一步**快照，**不能取第一帧**。

### Strategy Core · 完整细则

- Core 唯一入口 = `server/strategyCore/`（`StrategyRuntime.evaluate(version, parameterSet, context)` → `StrategyDecision`）= **语义**权威；legacy `StrategyDefinition` 降为**存储编码**，靠 `adapters/legacyDefinition.ts` **双向**翻译（指纹逐字节相等，有测试）。
- `WINDOW` 只考虑「当前决策日及之前」（更晚进 `futureSkipped`）；`updateVersionDefinition()` 恒抛 `VERSION_IMMUTABLE`，改内容只能 `applyDefinitionChange()` → 新版本；事件判定由运行方注入（`context.resolveEvent`），**未注入即抛错**。
- Definition 内不得出现 Dataset / 引擎坐标（`DATASET_BINDING_IN_DEFINITION_FORBIDDEN`）；`datasetVersionId` 只允许在 `StrategyRunSnapshot.datasetReference`。
- 特征 `availability` 是**相对当前 bar** 的声明（`usesForwardData` 必须 false、`dataThroughRelativeDay ≤ 0`）；`usesForwardData=true` **无法注册**。
- ⚠️ `bar.<派生字段>` 经 `DERIVED_BAR_FIELD_TO_FEATURE_ID` 映射为特征 id ⇒ 改桥接表必须同查 3 处：`ruleGraph.collectRuleFeatureReferences` / `fieldReference.parseCoreFieldReference` / `featureRegistry`。
- ⚠️ 可用派生 bar 字段**仅 5 个**：`volumeRatio` / `haircutFromEventLow` / `isBullish` / `momentumFromEventClose`（+ 涨跌幅）；`bar.haircutFromEventLow = (o0 − low)/o0` ⇒ `≤ 0` 即「守线」。
- ✅ **ARCH-002 已接产**：经 `assemble.ts#assembleStrategySide` 的 `Strategy13.signalBuilder` 注入槽接入；留档 `closed_loop_backtest_run.resultJson.strategyRun`（**零 schema 变更**）。
- 🔴 **legacy 与 Core 语义不同** ⇒ **历史回测数字不可直接对比**：legacy 门槛型配方**逐日看当天门槛、满足即出信号**；Core 按 `observationWindow` + `trigger`，`FIRST_VALID_DAY` 只在**首个成立日**出信号。
- ⚠️ 仍在：**N-03**（阈值型出场 —— TAKE_PROFIT/STOP_LOSS/TIME_EXIT —— 仍只在 `exitRules` 声明）、**N-04**（`ALL_DAYS` legacy 不可表达）。

### Backtest · 完整细则

- 年化口径唯一 = **252 交易日/年**（`backtest/backtestResult.ts#BACKTEST_ANNUALIZATION_DAYS`），**必须复用** `shared/quant-stats#annualizedReturnFromEquityCurve`（`n = 权益点数 − 1`）。别再写 244。
- `maxDrawdownPct` = **正数幅度**；**逐点 `drawdownPct` 才是有符号（≤0）**。**算式形式也算口径**：`(end/start − 1)×100` 与 `((end − start)/start)×100` 浮点不同 ⇒ 跨模块统一必须**连算式一起**。
- canonical 唯一面 = `canonicalMetrics()`；`ClosedLoopEvaluationRef` 带 `canonicalMetrics` / `metricsSource` / `annualizationBasis`。**`NOT_AVAILABLE` 不得被评估器数值顶替**。
- `server/backtest/**` 就是事实上的 **Backtest Core**（`simulator/engine.ts#runTradeSimulation` 全量复用其 portfolio / position / execution / cost）⇒ **禁新建 `backtestCore/**`**。`backtest/engine.ts#runBacktestEngine2` 生产不可达（仅测试引用，**规格要求不删**）。
- 留档写入**必须重试**（长算期间不碰 DB ⇒ 结束时单次 `insert` 必失败；判据 = 紧随 SELECT 首发也失败、**重试即成功**）。已有界重试 ≤3 次（best-effort、**不抛**）；长算探针应支持 `XXX_VERIFY_ONLY=1` 只读复核模式。
- ⚠️ 探针读 `resultJson` 拿到的是**字符串** ⇒ 必须 `JSON.parse` 兜住。
- ✅ **真实 Run 耗时与窗口无关**（3 个月 593.3 s / 1 个月 616.4 s）⇒ **别用缩小窗口当加速手段**。
- ⚠️ `BACKTEST_EXECUTION_POLICY_VERSION = 1`（`backtest/context.ts`）= T+1 + 拦涨停买 + 拦跌停卖 + 停牌拒单不顺延 + `zeroVolumePolicy=REJECT`；历史 6 条留档跑在 v0，未回填。
- ⚠️ `positionSizing` **已生效**（`simulator/plan.ts#applyPositionSizing`，一律 `min(...)` **只收窄不放大**）；`signalTiming` / `executionTiming` / `priceReference` 不在支持集 ⇒ 装配层**响亮抛错**。

### Parameter Search · 完整细则

- 参数「声明在 schema 里」≠「决策引擎会读它」。唯一判据 = `strategyCore/ruleGraph.ts#collectRuleParameterReferences`；引用为 0 时极端取值给出**逐字节相同的权益曲线**。⚠️ **实测：仓库全部 11 个既有策略版本的 `ruleGraphRefs` 全为空** ⇒ 搜历史候选（`cand-3600xx`）**必被拒**（`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`）⇒ 要真搜参数必须**自建含参数引用的新版本**（右值写参数 code、`valueType=PARAMETER_REFERENCE`）。
- **顺序纪律：`派生 → 覆盖 → 死参数剥离 → 校验`**。显式覆盖**能**把死参数塞回搜索空间 ⇒ `PARAMETER_SEARCH_OVERRIDE_ON_UNREFERENCED_PARAMETER`。⚠️ **左值必须同量纲**（比值参数配 `bar.volumeRatio`，**不是** `bar.volume`）。
- role 真源 = `strategy_parameters` 投影（`parameterRole`），**不是** `document.parameters` ⇒ 两条派生器：`parameterSpaceFromDocument.ts`（旧 = `LEGACY/PREVIEW`，消费者 = 技术预览 + 闭环 `optimization`）与 `searchSpace.ts#deriveParameterSearchSpaceFromProjection`（**唯一**用于持久化搜索）。
- **「谁能被搜索」唯一落点 = `searchSpace.ts#isSearchableStrategyParameter`**（`role === "TUNABLE"`）；**不 import** `server/strategyCore`，**由单测断言与 `listSearchableParameters` 等价**。
- `parameterHash` **拒绝 NaN/Infinity**；撞 hash **响亮抛错**。**Run 计数唯一真源 = 结果行重算**（`recomputeRunCounters`）。
- **`parameterSearch/index.ts` 刻意不 re-export 执行层** —— 因为执行层运行时 import 的评估端口子图会**回到** `closedLoopWiring/executors`（它又 import 本 barrel）⇒ 形成**运行时循环导入**。
- ⚠️ ESM `export *` **同名静默遮蔽** ⇒ 新增跨模块导出前先查 `server/**` + `shared/**` 顶层同名（已有守卫测试，本轮实建踩到 3 处）。
- ⚠️ `adminProcedure` **全仓零使用**（实测 0 命中）⇒ 新增写端点沿用 `publicProcedure`。
- ⚠️ `dataset_version.startDate/endDate` 是 **UTC 时间戳** ⇒ 取业务日期**必须按北京时区**（`toISOString().slice(0,10)` 会少一天）。`createSearch` 有**前置窗口校验**（按**北京业务日**）⇒ `PARAMETER_SEARCH_WINDOW_OUT_OF_DATASET_RANGE`。
- ⚠️ 三表（26/10/23 列、0 FK、快照写入即冻结）；迁移 = `0041_parameter_search.sql` + `applyParameterSearch.mjs`。**遗留**：`backtestRunId` 恒 NULL（评估端口走内存态闭环）。
- ⚠️ 必须走 `createStrategyDocumentFromDefinition` 构造文档；手改 `definition` 会触发 `SCHEMA_DEFINITION_VIEW_CONFLICT` / `_VIEW_DRIFT`。

### 性能 · 完整细则

- 真实 Run 三个分母：`optimization` **92.83%** · 数据集装载 **2.61%** · 写库 **3.36%** · 主链 **0.97%**；DB 往返仅 **61** 次（无 N+1）。全文 = `docs/parameter/PARAMETER-001-PRE-PROFILE.md`。
- **根因 = `optimization` 的样本窗口取数据集整窗（484 决策日）而非运行窗口** ⇒ **9.28×**。**DEFECT-1 已定位未修**（改它会改 `optimizationRef`）。
- **定义指纹必须缓存**：已改 `runtime.ts#definitionFingerprintCache`（WeakMap，**逐字节等价**）⇒ **2.07×**。
- **搜索边际成本 ≈ 2,500 ms/组**（用户窗口 57 日）⇒ 1000 组串行 ≈ 42 min；数据集必须**一次装载多组复用**。
- 实测耗时：2×2 参数搜索 **42 s**；单次 OOS 真重跑 **37 s**。
- 插桩开关 `PARAM_PROFILE=1`（**默认关**）；探针必须 `process.exit()` 收尾。


### MEMORY.md 细则下移 · 第二批（环境 / 页面 / Strategy 审计 / Baseline 状态）

- 行尾唯一依据 = **HEAD blob**：`git hash-object` ≠ `git rev-parse HEAD:<f>` 而 `git diff-files` 为空 ⇒ 漂移看不见。
- 首页 = `client/src/pages/Dashboard.tsx`：四指数迷你卡（各 **120 交易日**）+ 共享分类轴两联图（右轴**仅成交额**）+ 连板梯队「高度 × 网格」+ 题材热力图。
- 梯队「高度」= **「若该股本日涨停会达到的连板数」**（断板 +1；**首板未续也 +1**）⇒ 唯一实现 `shared/ladderHeight.ts`；折叠是**组内**的（`LADDER_GROUP_VISIBLE_ROWS=3`）；行序按题材当日热力降序（`shared/sectorHeatOrder.ts`，缺热度 -1）。⚠️ `limit_up_records.boardCount` 基本全 NULL ⇒ **不可作真源**。
- one-off 脚本写仓外 `C:\work\sourcecode\_scratch\`；报告 `docs/research/`、探针 `docs/evidence/`（须登记 `README.md`，只准 `.mts/.mjs/.log/.json/.md/.txt`；收尾 `ls docs/evidence/*.py` 应为空）。
- 运行时回落重建时 `datasetVersionId = null` 且**只继承 boards/excludeSt** ⇒ 口径与正常路径不同。
- `strategy_versions.codeVersion` 实测 **11/11 = `1.0.0+gunknown`**；`closed_loop_backtest_run` 无 `parameterSet` / `codeVersion` / `engineVersion` / `seed` / `Universe` / `startedAt`。
- ✅ 各域状态：Dataset/Research/Strategy/Backtest/Lifecycle/MarketRegime = **READY**；Parameter Search = 已持久化；Evaluation = **PARTIAL**；Robustness + `searchRobustness` = FACT；**OOS + `oosValidation` = FACT（已落库）**；Simulation = FACT；**Production = PLANNED**。闭环 14 阶段**实装 8**。
- ⚠️ DB 事实：真实库 **63** 张基表、**0 外键**；**drizzle 发布链路自 0024 停摆** ⇒ `db:push` 不可用，只能手写 SQL + `scripts/apply*.mjs`。
- ⚠️ 探针读 `resultJson` 拿到的是**字符串** ⇒ 必须 `JSON.parse` 兜住。
- ⚠️ ESM `export *` **同名静默遮蔽**（本轮实建踩到 3 处）⇒ 新增跨模块导出前先查 `server/**` + `shared/**` 顶层同名（已有守卫测试）。
- ⚠️ 三表（26/10/23 列、0 FK、快照写入即冻结）；迁移 = `0041_parameter_search.sql` + `applyParameterSearch.mjs`。**遗留**：`backtestRunId` 恒 NULL（评估端口走内存态闭环）。
- ⚠️ 稳健性 / OOS 迁移：`0042_search_robustness.sql` + `applySearchRobustness.mjs`（含 `parameter_search_run` 补两列，历史行 `NULL` = 未验证）；`0043_oos_validation.sql` + `applyOosValidation.mjs`（两表 32/41 列）。均为 `-- @guard:` 幂等 + 零 DML 静态断言。
- ✅ 前端双面板：`SearchRobustnessPanel`（深链 `?robRunId=`；矩阵**不用颜色表达好坏**）与 `OosValidationPanel`（深链 `?oosRunId=`）同挂 `/parameter-search`；探针开关 `ROBUSTNESS001_KEEP=1`/`_CLEAN_ONLY=1`、`OOS001_MODE=search|oos|full|verify|clean` + `OOS001_KEEP=1`。
- ✅ 真实 Run 耗时与**窗口无关**（3 个月 593.3 s / 1 个月 616.4 s）；2×2 参数搜索 **42 s**；单次 OOS 真重跑 **37 s**。插桩 `PARAM_PROFILE=1`（**默认关**）；探针必须 `process.exit()` 收尾。
