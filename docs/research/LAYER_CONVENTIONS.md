# Research 层约定（从 `.workbuddy/memory/MEMORY.md` 迁出）

> 迁出原因：MEMORY.md 超注入上限被截断。本文件承载 Research 层全部「不照做就会出错」的约定；
> MEMORY.md 只留指针。改动本层代码前**必须**先读本文件。

## RESEARCH-001 —— research 核心表与领域层

- 10 张**单数** `research_*` 表（迁移 `0031_research_core.sql`），领域层 `server/researchCore/`。
- ⚠️ 与遗留**复数**表（`research_experiments` / `research_runs` / `research_datasets` = STEP 6.x）**仅差一个 `s`**，极易误引 → 靠 schema 块注释 + `docs/research/RESEARCH-001-AUDIT.md §4` 消歧。
- 零 DB 外键；`server/researchCore/` **不并入 barrel**（避免把研究层拖进通用依赖图）。

## RESEARCH-002 —— researchEngine 分层

- `server/researchEngine/` + `researchEngineRouter.ts`（已注册 `appRouter.researchEngine`）。
- 分层：`engine → datasetReader → analyses/registry → analyses/* → metrics → conclusion`，**禁合并为单文件**。

### 🔴 视界陷阱（最容易搞错的一条）

- `future_return_*` / `high_return_*` / `low_return_*` 来自 **path（视界 1..20）**；
- `max_return_*` / `max_drawdown_*` / `is_breakout_*` / `days_to_breakout_*` 来自 **outcome（仅视界 {5,10,20}）**；
- 两者**视界集合不同** ⇒ 附加指标必须**按变量目录过滤后再请求**，不能一把梭。
- ⚠️ 测试夹具**必须与真实 Dataset 同构**：曾因夹具放宽掩盖 2 个真缺陷，**不要改回去**。

### 失败语义

- `runIdentified` 之后的任何失败都必须落 Run `FAILED` + `errorCode`；
- `startedAt` 空/非空用于区分「**预检拒绝**」vs「**执行中崩溃**」；
- **无法归因时绝不改写状态**；分组 < 2 不产出 `SPREAD` / `STABILITY_RATIO`；
- `conclusion.evidence` **两分支必须同形**（单一入口 `buildEvidence()`；`primary: null` = 「无主分析」，不是键缺失）。

## RESEARCH-002A —— 维护层

`server/researchEngine/maintenance.ts` + Router（维护端点全部 `adminProcedure`）。

- 🔴 **条件组号必须连续 `0..n-1`**：`researchCore/conditions.ts#assertConditionSet` 校验，写库路径 `repository/db.ts#replaceForAnalysis` **真会拒收**；组内 `sortOrder` 只要求唯一、不要求连续。
  - 前端 `conditionGroupsToPayload` 必须按**有效组**重排 + 组内 `sortOrder` 紧凑 —— 否则「整组未填」的空组会造成组号断号被拒。
  - {新建 / 编辑} 共用**同一载荷构造器**，往返（payload ↔ 表单）必须幂等。
- **「改口径」= 让旧产物失效**（不是静默替换）：守卫 → 替换 → 删旧结果 + 删失效结论 + Analysis/Run **回退 `PENDING`**；
  - 回退 PENDING 复用既有 `RUN_NOT_PENDING` 前置**恰好放行重跑**，故**禁新增重跑入口**；
  - `RUNNING` 时删父行会产**幽灵行** → 一律 `DELETE_CONFLICT`（tRPC `CONFLICT`）拒绝。
- 🔴 **`research_conclusion` 无 `runId`** ⇒ 归属只能从 `evidence` 提取 `analysisId`（`primaryAnalysis` ∪ `contributingAnalyses` ∪ 旧键 `analyses`）**求交**判定；
  - **提不出 id 绝不删除**，并计入 `unattributedConclusions` 如实回显；
  - 形状不认识 → 返回空数组，**禁 `?? 0` 兜底**（会把「不知道」伪装成「没有」）。
- **前端破坏性操作**：`ConfirmDeleteButton` **不做数据推断**，后果由调用方按后端语义给出、删完回显服务端**真实计数**；
  - `updateExperiment` schema **无 `datasetVersionId` 键** —— 数据集创建即冻结，换数据集 = 新建实验。

## 前端工作台（仅消费侧）

- `client/src/adapters/researchEngineAdapter.ts` 是**唯一展示契约层**。
- 三条「不造假」铁律：
  1. 单位**判不出就返回 `NUMBER`**，不猜；
  2. `metricValue = null` 渲染 `—`，**不伪装 0**；
  3. 分组表**逐指标**保留各自分母。
- **展示层能做什么（2026-09-12 RESEARCH-007 定的边界）：可以做恒等变形，不可以做估计。**
  - ✅ **可以**：从已落库数值**无损还原**某个量 —— 如 `estimateExcludedGroupMean` 用
    `n_all·M_all = n_c·M_c + n_rest·M_rest` 反推条件分析缺的「对照组」均值。
    均值可以、胜率也可以（它就是 0/1 的均值）；但**必须在 UI 上标注来源**（图上标「（反推）」、
    tooltip 写明「由全样本与条件组反推」），**实测样本与推导值视觉上不得混同**。
  - ❌ **不可以**：任何需要**假设或估计**的推导。中位数、标准差、分位数是非线性统计量，
    反推就是估计 ⇒ 一律返回 `null`（宁可缺数，也不给可疑数）。
  - ❌ **不可以**：**重算引擎口径**。典型反例：按「结果值最大/最小」自行挑顶底档 ——
    引擎的 `SPREAD_TOP_BOTTOM` 是**末档 − 首档**，两者会打架，页面随即自相矛盾。
    **能搬运就不要重算**；口径文案（`differenceDefinition` / `spreadDefinition`）一律原样展示。
- **图形纪律**（同上）：图**独立成图**，不塞进表格单元格 —— 单元格里的条 ~72px 宽、1.5px 高，
  且随表格横向滚动整体跑出视口（2026-09-12 曾因 `anchor = min(value, 0)` 之后算
  `value − anchor`，把**所有负值条压成 0.8% 宽**，见 RESEARCH-007）。
- **图的形态必须匹配横轴语义**（2026-09-12 RESEARCH-008 补）：`volume_ratio_1d..5d` 这类
  「同一变量、不同滞后日」的结果，横轴是**时间** ⇒ 走折线（`VariableSeriesChart`），
  **不能套分组条形图**（会把「逐日衰减」拍成一堆并列类别）。三条固定要求：
  ① **基准线画在语义基准上** —— 量比的「持平」是 **1 倍**而不是 0（由 `FAMILY_BASELINE` 承载）；
  基准画错，全正序列里「缩量」与「放量」看上去都「远高于基准」，方向信息直接丢失；收益类才是 0；
  ② **典型值与均值同时画** —— 本数据集量比序列偏度 11.7~28.2、峰度 262~1,217，均值全程 > 1
  而中位数 T+3 起 < 1（**方向相反**）⇒ 只给一个数字等于替读者做了一次未经说明的口径选择；
  偏度超阈值时图上直接提示「以中位数为准」；
  ③ **不用涨红跌绿** —— 这里的取值是成交量倍数 / 分布中心，不是价格涨跌，套涨跌色会被读成方向性涨跌。
  序列识别（`buildVariableSeries`）**不硬凑**：族不一致 / 变量名不是滞后族 / 混入分组维度 /
  滞后重复，一律返回 `null`（宁可不出图，也不乱出）。注意它与 `HEADLINE_DIMENSION_KEYS`
  对 `variable` 的排斥**不冲突** —— 仍然不生成「顶底差」结论，只是换一种呈现方式。
  **横轴强制含 0 + `0` 参考线**是硬要求，否则「−0.5%」可能比「+0.4%」的条更长，方向直接读反。
  ⚠️ 组件内的几何计算**必须有断言**：纯函数单测（adapter 层）覆盖不到它 —— 上面那个 bug
  正是「三个纪律都写了、断言一个没有」的产物。
- 枚举用 `as const satisfies` 镜像后端。`ResearchEngineRunResult` 为**扁平**结构。
- tRPC 条件 schema 的 `value: z.unknown()` 是**必填键** ⇒ `IS_NULL` 必须显式发 `value: null`。

## RESEARCH-002B —— 增量补跑（`engine.runIncremental` / `researchEngine.runIncremental`）

背景：Run 一旦 `COMPLETED`，双侧 `RUN_NOT_PENDING` 守卫（前端 `RunEngineButton.tsx#executable`、后端 `engine.ts`）使「运行引擎」恒灰；而「新建 Run 重跑」走不通（分析挂 `runId`、无继承、`updateAnalysis` 白名单不含 `runId`）⇒ **给已完成 Run 补跑新增分析必须走 `runIncremental`**。另注：`createRun` **只创建不执行**，且**无任何后台 worker/cron 消费 PENDING Run** ⇒ 空 Run 永不自己出结果。

- 🔴 **增量必须复用 Run 冻结基准**（`inputSnapshot` 的 `datasetVersionId` + 日期窗口），并断言 `basis.datasetVersionId === experiment.datasetVersionId`，否则 `DATASET_VERSION_DRIFT`。
  - 依据：`sampleSet.ts#buildSampleSet` **不按条件过滤事件** —— 事件集只由「datasetVersionId + 日期窗口」决定、分析变量仅作**投影列** ⇒ 增量**并上**新变量**不改变样本集**（新老数字可比）。
- 🔴 **增量不得生成结论**，理由**可证明**：`AnalysisSummary`（effect/pValue/tStat/…）**未落库**、`diagnostics` 明确不写 `result_json` ⇒ **无法重建被跳过分析的历史摘要**。返回 `conclusionId: null` + `conclusionSkippedReason`（常量 `INCREMENTAL_CONCLUSION_SKIPPED_REASON`），UI 必须显式提示。
- 🔴 **`inputSnapshot` 不可变**（RESEARCH-001 定死「执行时落定、事后不得修改」）⇒ 增量事实**只能**追加进 `research_run.executionLogJson`（migration `0032`），**禁改写快照**。
- **批次号规则**（`nextExecutionSequence`）：`max(sequence)+1`；**日志空但快照存在 ⇒ 2**（批次 1 已被历史整轮执行占用、**不 backfill**）；两者皆无 ⇒ 1。
- **可跑状态** = `PENDING | FAILED | CANCELLED`（`RUNNABLE_ANALYSIS_STATUSES` 前后端同源）；`allCompleted ? COMPLETED : PENDING` 决定 Run 终态。
- **刻意保留**：删分析后日志里的悬空 `analysisId` **不清理**（append-only 历史事实纪律，`maintenance.ts#deleteOneAnalysis` 有注释）。
- **共用核心**：`engine.ts` 的 `buildCatalog`/`loadConditionSets`/`resolveAnalyses`/`executeAnalyses` 由 `run()` 与 `runIncremental()` 共用 —— 改执行路径**必须同时验证两条**（`server/researchEngine` + `researchCore` 234 例是回归护栏）。
- 复现：`node scripts/applyResearchRunExecutionLog.mjs` + `npx vitest run server/researchCore/executionLog.test.ts server/researchEngine/engineIncremental.test.ts server/researchEngineRouter.test.ts client/src/components/research/incrementalRunForm.test.ts`。

## RESEARCH-002C —— 批量建分析（矩阵 / 标准套件 / 跨实验模板）

背景：`createAnalysis` 端点**一次只收一个**分析、前端特征/目标/视界均**单选**，建完还要**单独点「补跑」** ⇒ 组合类研究（5 特征 × 3 视界 + 1 稳定性 × 3 维度）现状 = N 轮往返 + N 次补跑。本段解决「建分析的重复劳动」，**只创建、不自动补跑**。

- 🔴 **三条路线共用同一条落库路径**：`createAnalysesBatch`。标准套件**不另写生成逻辑**（只是「用预设值填矩阵表单」，交给**同一个** `expandAnalysisMatrix`）；模板展开（`applyAnalysisTemplate`）也调 `createAnalysesBatch` ⇒ 预检/回显/补偿**自动继承**，**禁**在模板侧另写一套。
- 🔴 **预检整批拒绝、不产半成品**：`assertBatchCreateItems` 在**写库前**跑 `preflightBatchCreateItems`；不通过即 `BATCH_VALIDATION_FAILED`、**一个都不建**（消息含「未创建任何分析」+ 前 10 项）。**禁**「边建边发现错」。
- 🔴 **执行期部分失败如实回显 + 补偿删除**：失败项**先删条件再删分析**（零 FK 不依赖级联）；补偿再失败则追加「⚠️ 回滚该项失败」，**禁静默吞掉**。`created` 每项保证「有 id 就能跑」。
- 🔴 **条件结构合法性唯一权威 = `assertConditionSet`**（由 `conditions.replaceForAnalysis` 写入时执行）。批量路径**只做预检级「有没有条件」判断**（`fieldName.trim() !== ""`），**禁**重造第二份结构校验。
- **模板 = 头 + 明细两表**（`research_analysis_template` / `_item`，migration `0033`）：明细需确定性顺序、头表需唯一约束（名字用于不歧义引用）。**唯一例外**是明细**条件**用 `conditionsJson`（配置快照，不索引不约束）；**展开成真分析时条件仍写 `research_analysis_condition` 关系表** ⇒ **口径不降级**。
- **上限**：服务端 `MAX_BATCH_CREATE_ITEMS = 200`（权威）；前端 `MAX_BATCH_ITEMS = 200` 只是**显示用副本**（客户端**禁** import 服务端常量，会把服务端拖进 bundle，项目有泄漏检查）。
- 🔴 **领域错误必须走 `toTrpcError`**：新增端点时，只能在 catch 里 `toTrpcError(e)`，或显式 `toTrpcError(new ResearchEngineError(...))`。**直接 `throw` 领域错误不改 tRPC code**（会一律落 `INTERNAL_SERVER_ERROR`；本段 3 个模板端点就踩过这个坑）。
- **端点**：`createAnalyses`(admin) / `listAnalysisTemplates`(**public**) / `createAnalysisTemplate`(admin) / `deleteAnalysisTemplate`(admin) / `applyAnalysisTemplate`(admin)。`createAnalysisItemSchema` **单建与批量共用**（禁两处 schema 漂移）。
- **第五条路线 —— 例子（RESEARCH-005 补）**：内置示例（`ANALYSIS_EXAMPLES`，与单建弹窗「从例子开始」**同一份**）→ `applyAnalysisExample`（表单状态）→ `formStateToBatchItem`（`analysisBatchForm.ts`，`BatchItemDraft`）→ `createAnalysesBatch`，于是「示例建的分析」与「手动填表建的分析」**逐字段同源**。
  - `formStateToBatchItem` **禁另造「表单 → 载荷」口径**：一律复用 `toAnalysisConfig` / `conditionGroupsToPayload` / `suggestAnalysisName`。
  - ⚠️ `MATRIX_ANALYSIS_TYPES` 排除 `SEGMENT_RELATION` 的**理由只约束矩阵展开**（一排窗参数铺开 N 项 = N 个相同配置）；卡片上明写两个窗的**单条示例**不受此限。
  - 模板名有**唯一索引**（`research_analysis_template_name_unique`）⇒ 「存为模板」前先按已加载的模板名判重并置灰按钮，**不靠撞库报错**兜底。
  - 示例卡上那行摘要来自 `describeBatchItem(draft)`，从 `BatchItemDraft` **反推**而非抄示例声明 ⇒ 显示的一定是**会落库的内容**。
  - 示例是「点一下直接建」（不趟预览清单）⇒ 卡片自身必须摊开口径（类型 / 变量 / 条件 / 目标），否则等于「点了不知道建了什么」。
- 复现：`node scripts/applyResearchAnalysisTemplate.mjs` + `npx vitest run server/researchEngine/batchCreate.test.ts server/researchCore/repository/inMemory.test.ts server/researchEngineRouter.test.ts client/src/components/research/analysisBatchForm.test.ts`。

## RESEARCH-002A · D 段 —— 闭环装配层（`server/research/closedLoopWiring/`）

- **14 阶段装配声明表（`requirements.ts`）是唯一权威**：每个「未装配」阶段必须写明**缺什么 + 为什么现在不装配 + 真实入口坐标**（测试断言 reason 长度 > 40，拒绝「暂未实现」式占位）。
- 已装配 **6**：`data`（投影注入的真实 `ResearchDataset`，**不构建**）/ `research` / `strategy` / `backtest` / `evaluation` / `finalize`（编排器内置路径，无需注册）。
  留白 **8**：`optimization` / `robustness` / `oos` / `overfitting` / `regime` / `paper` / `review` / `discipline`（`regime` 最易补齐）。
- 🔴 **入参来源语义**：`satisfyVia: ClosedLoopInputSource[]` = **来源之间 OR、来源内 AND**。
  `ClosedLoopInputSource = { inputs?: keyof ClosedLoopWiringInputs[]; artifacts?: ClosedLoopWiringArtifactKey[] }`。
  **曾误写成「来源内也 OR」** ⇒ `research` 只要拿到 `dataset` 产物、即使缺三件入参也被注册，到运行期才抛 `CL_WIRING_INPUT_MISSING`（**把「缺配置」伪装成「执行失败」**）。改契约时**必须双向**测（有产物缺入参 / 有入参缺产物）。
- **只为「真的能跑」的阶段注册执行器** ⇒ `stageRunners` 表本身就是一句实话；缺前置产物抛 `ClosedLoopWiringError`（`CL_WIRING_ARTIFACT_MISSING` / `CL_WIRING_INPUT_MISSING`）**响亮失败**，**绝不返回占位摘要**。
- ⚠️ **覆盖率探测的边界**：`assessClosedLoopWiringCoverage` 判的是「`wired` ∧ **闭包入参**可得」，**不含**编排器对 `ClosedLoopStageInputById`（同链**前驱产出**交接）的要求 → 后者以 `stages[].blocked` 为准（`CL_MISSING_UPSTREAM_HANDOFF`）。别把 `coveredStages` 当「一定会 EXECUTED」。
- **`researchRun.readiness`**：`executorBound` **真实探测**（与 `loopRun` 共用同一探测函数），零入参下 `coveredStages=[] ⇒ executorBound=false ⇒ canRun=false`（不冒充 READY）。
- **`researchRun.loopRun`**（mutation，**无状态**：不写库、不落 run 记录）：`createClosedLoopWiring(inputs,{requested})` → `runClosedLoop`。两条防伪绑定：
  1. `evaluationInput` **必须与** `backtestSummarySeed` 成对（`backtestFingerprint` 只取 `seed.fingerprint`，不接受调用方另填）⇒ `CL_MISSING_UPSTREAM_HANDOFF` 在该端点下**不可达**；
  2. `backtestSummarySeed` 与链内 `backtest` **互斥**（冲突即 `BAD_REQUEST`，**不静默丢种子**）。
- ⚠️ **`shared/researchContracts.ts` 内 schema 声明顺序 = 依赖顺序**：前向引用会 TS2448 且**静默挡住全库**；`shared/datasetRegistryContracts.ts` 依赖它 ⇒ 该文件处于中间态时**所有引 datasetRegistry 的脚本 import 期崩溃**（`Cannot access 'x' before initialization`）。编辑务必一次成型。
- 新状态字符串必须登记到 `client/src/lib/status.ts`（§12 全站唯一状态色来源），否则**静默回退 neutral**。

## ⚠️ 已知既有测试失败（禁为过测试而改快照/改期望）

`docs/researchReadyGate/research_ready_gate.json` 现为 `researchReady=true`（capturedAt `2026-09-09T15:07:48Z`；G0/G2/G4 PASS，G1/G3/G5 GAP）→ 由此产生 **1 例既有失败**：

| 测试 | 断言 | 实际 |
|---|---|---|
| `dataHealth.test.ts` | `G4 = GAP` / `researchReady=false` | 快照为 `PASS` / `true` |

**处置纪律**：先裁定「把认证结果**重认证回 FALSE**，还是**更新测试期望**」，**不得**为了让测试变绿而改快照或改断言。
（原先并列的 `researchRunRouter.test.ts` 一例已随 D 段消解：readiness 改为真实探测后该文件重写为 17 例，含一例显式**漂移探测器**——断言 `researchReady=true` + `verdict=EXECUTOR_NOT_BOUND`，失败即提示应同步更新 ROADMAP 而非改回断言。）
另：`researchRunRouter.ts` 的 `executorBound = false` 硬编码**已消除**（D 段）。
