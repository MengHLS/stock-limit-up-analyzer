# stock-limit-up-analyzer 硬禁令索引

> **压缩索引**；🔴 **唯一细则源 = `.workbuddy/memory/PROJECT_RULES.md`**（末章「MEMORY.md 原文下移」= 旧全文 8439 字符，**零丢失**）。动手前读本文 + 当日日报，再按章名 grep。

## 三门
1. 🔴 改 `server/**` 会热重启并**杀死在途 Run**（在途 = `RUNNING`；`PENDING` + 空 `inputSnapshot` 的草稿**禁收敛**）⇒ 用户在用页面时禁改 server、禁跑重库脚本。改 `client/**` 只走 HMR。
2. 🔴 禁 `install` / 新依赖 / `prettier --write` / `db:push` / `drizzle-kit generate` / 手写 `_journal.json`。
3. 🔴 **同一文件的多处编辑必须串行** —— 并行两个 `Edit` ⇒ 后写覆盖先写、前者**静默丢失**（09-19 真踩）。

## 环境 / 工具
- 端口只认启动日志（4000 常被占 ⇒ 实测 **4001/4002**；残留无头 Chrome 会「TCP 通但 fetch 失败」）；探端点用 Node `fetch`。
- 沙箱 Bash 缺 coreutils（见用户级记忆）；`git`/`node` 不认 `/c/...` ⇒ 传 `C:/...`；Win stdout 常不返回 ⇒ 落盘用 Python 读。
- 🔴 **长任务输出禁接管道**（EPIPE ⇒ 脚本中止并清空自身留档）；后台用 `run_in_background` + 读 `.out.txt`。
- 🔴 改文件 = Python bytes + `os.replace` + 回读。测试基线 = **8 失败文件 / 17 用例**（判据 = 失败**文件集合**）。
- 🔴 行尾禁按清单判 ⇒ 先跑 `scripts/checkEolDrift.mjs`，唯一依据 = **HEAD blob**。纯 CRLF 仅 3 文件：`PROJECT_RULES.md`、`App.tsx`、`AppShell.tsx`。
- ✅ 前端验收 = 无头 Chrome + Node `WebSocket` 直连 CDP 量 DOM；端口**实测空闲**、输出**必须落盘**。
- one-off 脚本写仓外 `_scratch\`；报告 `docs/research/`、探针 `docs/evidence/`（**须登记 `README.md`**）。🔴 `client/**` 只禁 import `server/**` **运行时值**；`@shared/*` 允许。

## 总控
- `ROADMAP.md` 唯一 Master Control（§44 覆盖式 / §44.5 队列 / §47 append-only → `ROADMAP-CHANGELOG.md`）；仅 `RESEARCH_READY=TRUE` 允许策略结论。
- 🔴 取号真源 = 「编号台账」行（**禁「末条 +1」**）；**文件头铁律行 + 台账行两处同步**；**取号前先对远端**。现用至 `9br` ⇒ 下一个 `9bs`。
- 🔴 分叉合流：`ls-remote` → `fetch` → `merge --no-ff`；文档冲突**两侧都保留**；丢文件 `git ls-files -d -z | xargs -0 git checkout --`。

## 领域口径
- 四条最易踩：① 评估端口 = `server/research/strategyEvaluation/`（唯一），主输出字段 **`evaluation`**；**`dataReady: true` 必须显式传**（`runAudit.ts:74` 缺省 false ⇒ 否则 `INCONCLUSIVE`）；② 交易日历唯一来源 = `index_daily`（**停更 ⇒ 静默 no-op 却报成功**，补数须 `--force`）；③ `/backtest` **并存两套交易语义**（快照 = 等权；顶层 = 固定 100 股）⇒ **禁加 cap**；④ **止损三落点互不相通**（`realisticBacktest.ts` / `paperTrading.ts` / `server/engine/**` **完全不执行**）。
- 事项闭环：`todo_delegate_status = idle` ⇒ 无 dispatch id ⇒ 用 `todo_add_comment`+`todo_transition`。

## 页面
- 🔴 侧栏高亮 = **分段精确匹配 + 取最长命中**（`AppShell.tsx#isPathActive`，禁 `startsWith`，详情页点亮父项）。**首页 `/` 入口 = 左上角网站标题**（`9bm`；锚点 `data-slot="sidebar-home-link"`），「复盘分析」组**不再单列「首页」** ⇒ 站在 `/` 侧栏**零高亮**。探针 `_probe_sidebar_active_highlight.mjs`。
- 🔴 首页 = `client/src/pages/Dashboard.tsx`：四指数迷你卡（各 **120 交易日**）+ 共享分类轴两联图（右轴**仅成交额**）+ 连板梯队「**高度 × 网格**」+ 题材热力图。
- 🔴 梯队「高度」= **「若该股本日涨停会达到的连板数」**（断板 +1；**首板未续也 +1**）⇒ 唯一实现 `shared/ladderHeight.ts`（🔴 `client/**` 禁 import `server/**` 运行时值 ⇒ 口径函数须落 `shared/`）。折叠是**组内**的（`LADDER_GROUP_VISIBLE_ROWS=3`）。梯队行内与热力图行序均按**题材当日热力**降序（`shared/sectorHeatOrder.ts`，缺热度 **-1**）。⚠️ `limit_up_records.boardCount` 基本全 NULL ⇒ **不可作真源**。
- 🔴 生成物禁手改：`darkCompatibility.css` / `favicon.svg`。运算符两形只在 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 译；**免责声明不得删**。
- 🔴 **「接线完成」≠「用户够得到」** ⇒ 交付前必须无头量 DOM；长请求按钮**必须换文案**；`Link` 包 `Button` 须 `<Button asChild><Link>`。
- 🔴 **CDP 五坑**：兼听 `requestWillBeSent`；toast 高频轮询；模板串正则 `\s` 被吃（用 `includes`）；Radix/受控控件只认真实鼠标；端口**实测空闲**。

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

## Backtest 口径与留档（BACKTEST-002 收尾二实查 2026-09-19，`9br`）
- 🔴 **年化口径唯一 = 252 交易日/年**（`server/backtest/backtestResult.ts#BACKTEST_ANNUALIZATION_DAYS`），且**必须复用** `shared/quant-stats#annualizedReturnFromEquityCurve`（`n = 权益点数 − 1`）。全项目既有口径都是 252（`performanceMetrics` / `riskAdjustedMetrics` / `marketRegime` / `engine/performance` / `overfittingGuard` / `downsideRisk`）—— 别再写 244。
- 🔴 **`maxDrawdownPct` = 正数幅度**（`max((peak−equity)/peak)×100`），与 `performanceMetrics.analyzeDrawdown.depthPct` / calmar 同口径；**逐点 `drawdownPct` 才是有符号（≤0）的水下深度**，两者是不同量。
- 🔴 **算式形式也算口径**：`(end/start − 1) × 100` 与 `((end − start)/start) × 100` 代数等价但**浮点不同** ⇒ 同一量会变成两个 double（实测 `5.3` vs `5.299999999999994`）。跨模块「唯一口径」必须连算式一起统一。
- 🔴 **canonical 唯一面 = `canonicalMetrics()`**：闭环 `evaluation` 的 5 个重叠标量（totalReturn / cagr / maxDrawdown / winRate / profitFactor）+ `completedTradeCount` 取它；`ClosedLoopEvaluationRef` 新增 `canonicalMetrics` / `metricsSource`（`"canonical"` | `"evaluators"`）/ `annualizationBasis`。**`NOT_AVAILABLE` 不得被评估器数值顶替**。
- 🔴 **留档写入必须重试**：一次真实 Run 计算 **593~627 s** 期间不碰 DB ⇒ 结束时池中连接已被链路静默重置 ⇒ **单次 `insert` 必然失败**（判据 = 紧随的只读 SELECT 首发也失败、**重试即成功**）。`researchRunRouter#persistClosedLoopBacktestRun` 已改**有界重试 ≤3 次**（仍 best-effort、**不抛**）。⚠️ 别改成「失败即抛」——那会把「历史列表少一条」升级成「回测结果丢失」。
- ⚠️ **真实 Run 耗时与请求窗口无关**：3 个月窗口 593.3 s、1 个月窗口 616.4 s ⇒ 瓶颈在**数据集装载**（112,920 行），不在决策日扫描。**别再用缩小窗口当加速手段**。
- ⚠️ **41× 慢的主因未定位**：Core 单次求值实测 ≈381 µs（`docs/evidence/_probe_core_eval_perf.mts`）⇒ 135,504 次 ≈ 52 s，**只占 8.7%**；主因在数据集读取 / 逐日框架层。**PARAMETER-001 前必须先做阶段级 profile**。
- ⚠️ **探针读 `closed_loop_backtest_run.resultJson` 拿到的是字符串**（不是已解析对象）⇒ 判空会得到假失败；用 JSON.parse 兜住。长算探针应支持 `BT002_VERIFY_ONLY=1` 只读复核模式（避免为修判据再付 10 分钟）。
- ⚠️ **`str.replace` 无断言会静默 no-op**：改文件时每处替换都要 `assert count == 1`（本轮 3 处因缩进不匹配静默失败，导致探针出现重复块 + 作用域崩溃）。
