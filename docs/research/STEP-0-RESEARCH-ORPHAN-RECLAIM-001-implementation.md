# STEP 0 实施报告 · 研究链清障与可观测（RESEARCH-ORPHAN-RECLAIM-001）

> 日期：2026-09-17。序号：`9av`（原 `9h` 追踪项，本轮完成）。
> 承接：`docs/research/RESEARCH-PATTERN-LOOP-AUDIT-001.md`（提问研究全链审计）§7 的 STEP 0。
> 范围：**只做清障 + 可观测**，不含 STEP A/B/C/D（条件→信号桥、评价/参数统一、模式声明库、体验收口）。
> 零迁移、零新依赖、零新表；`server/**` 571 → **573** 文件（+2 新增源文件）。

---

## 1. 一句话结论

**「改 `server/**` 必须先零在途」这条前置条件已达成，且是靠产品代码自己达成的** —— boot 钩子 `reclaimOrphanResearchWork()` 在热重启后自动把历史孤儿 `research_analysis 270008` 收敛为 `CANCELLED`，同时**正确保留了用户的合法未执行草稿** `research_run 630002`。

同时纠正了审计报告一处**事实性错误**（详见 §3），并精确化了「在途」判据（详见 §4）。

---

## 2. 做了什么（三节对应审计报告 §7 的 0-1 / 0-2 / 0-3）

### 2.1 0-1 收敛残骸 —— **实测后改判，只收敛真孤儿**

| 对象 | 审计报告初判 | **实查事实** | 处置 |
|---|---|---|---|
| `research_run 630002` | 「PENDING 残骸，须收敛」 | `inputSnapshot = NULL` / `startedAt = NULL` / `hasExecLog = 0`；所属实验 `360002` = **DRAFT**，`sampleCount = NULL` ⇒ **从未进入执行** | 🔴 **不收敛，原样保留** |
| `research_analysis 630001`（父＝630002） | 同上 | 父 Run 是未执行草稿 ⇒ 非孤儿 | 保留 |
| `research_analysis 270008`（父＝`330003`） | 同上 | 父 Run `330003` = **FAILED**（2026-09-11 14:58），自己停在 PENDING 至今、`resultRows = 0` ⇒ **「父终态、子未终态」的真孤儿** | ✅ 收敛为 `CANCELLED` |

**收敛由产品代码完成，不是脚本代劳**：本轮改 `server/**` 触发 `tsx watch` 热重启 ⇒ `server/_core/index.ts` 的 boot 钩子执行 ⇒ 实测 `research_analysis` 状态分布由 `{COMPLETED:322, PENDING:2}` 变为 `{CANCELLED:1, COMPLETED:322, PENDING:1}`。
（探针 `docs/evidence/_probe_inflight_state.mts` / `_probe_orphan_detail.mts`，输出均已落盘。）

### 2.2 0-2 孤儿回收钩子 —— **两道防线，含源头修复**

**① 源头（`server/researchEngine/engine.ts`，2 处 catch + 1 个新私有方法）**

根因：`run()`（`:418` 附近）与 `runIncremental()`（`:648` 附近）的失败收敛路径**只写 Run 的 `FAILED`，从不收敛子 Analysis**。异常终止后留下「父终态、子未终态」的自相矛盾状态 —— 它对内污染状态计数（`research_analysis` 永久显示有 PENDING），对外让 UI 表现为「永远在做」，且**没有任何产品入口能纠正**。

修法：新增 `private async settleAbandonedAnalyses(runId)`，在 Run 收敛为终态后把该 Run 下仍处 `RUNNING` / `PENDING` 的分析一并置 `CANCELLED`（`COMPLETED` / `FAILED` 一律不动），并 `console.warn` 如实记录收敛条数。两个入口共用同一方法 ⇒ **不再产生新孤儿**。

- 为什么置 `CANCELLED` 而非 `FAILED`：这些分析**根本没轮到自己执行**（或执行到一半被中断），不属于「这条分析自己算错了」；两者都在 `RUNNABLE_ANALYSIS_STATUSES` 内可重跑，`CANCELLED` 语义更准。原因由父 Run 的 `errorCode` / `errorMessage` 承载（`research_analysis` 表无该列，**不造第二处记录**）。
- 位置放在两处 catch 的**最末**（Experiment 状态处理之后）：本方法是「尽力而为」，即便它抛错，Run / Experiment 既有语义已完成。

**② 回收（`server/researchEngine/reclaim.ts`，新文件，唯一实现）**

| 判据 | 动作 | 为什么 |
|---|---|---|
| 父 Run 已终态（`COMPLETED`/`FAILED`/`CANCELLED`）且终止时间早于 `now - 30min` | 子 Analysis → `CANCELLED` | **「父终态子未终态」是唯一硬证据孤儿**；30 分钟缓冲期用于隔离「刚失败、用户正要点重跑」的时序竞争 |
| 父 Run 不存在（零 FK，父行被删不级联） | 子 Analysis → `CANCELLED` | 同上（父已不在，子行无所依附） |
| 父 Run `RUNNING` 且 `startedAt` 早于 `now - 12h` | Run → `FAILED` + `errorCode=RUN_ORPHANED` + 子分析收敛 + Experiment 回滚 `FAILED`（**仅当该实验下再无其它 `RUNNING` Run**） | 执行者进程已不存在（正常 Run 为分钟级；`tsx watch` 热重启留下此类残骸） |
| 🔴 父 Run `PENDING` | **一律不动**，并把「未执行草稿」如实回报进 `skippedUnexecutedRuns` | 两种合法含义：① 已建计划未执行（`inputSnapshot`/`startedAt` 皆空）；② 增量批次跑完但仍有未完成分析。**回收它们会破坏用户合法数据** |
| 父 Run 无任何时间基准 | 跳过 | 诚实：不敢回收 |

**与 `9h` 原建议的关系**：`9h` 给了两个候选判据（① 任何 `RUNNING` 即孤儿 ② 复用 dataset 侧 10 分钟停更阈值）。本轮取**第三条路**——保留「停更」思路但把阈值抬到 12 小时（研究 Run 无心跳列、无法区分「长跑」与「死了」，宁晚不误杀），并**新增 `9h` 未考虑的形态**：「父终态子未终态」（此形态与 Run 自身是否 RUNNING 无关，是实测现场真正存在的那一个）。

**③ 挂载（`server/_core/index.ts`）**：在 `reclaimOrphanBuildJobs()` 之后以同样的「`void` 异步 + 逐条日志 + `catch` 兜底」形态挂载，**不阻塞服务启动**；日志分三类（收敛 Run / 收敛分析 / **保留草稿**），第三类必须打印 ⇒ 保留决策**不静默**。

### 2.3 0-3 研究链体检端点（**只读**）

- 实现：`server/researchChainHealth.ts#describeResearchChainHealth(experimentId)`；端点：`researchRun.chainHealth`（`publicProcedure`，`.output(researchChainHealthSchema)`）。
- 契约：`shared/researchContracts.ts` 新增 4 个 schema（counts / experiment / latestRun / health）。
- 口径锚点全部取**实查 `information_schema`** 的真实列名（`research_analysis.runId` / `research_result.analysisId` / 各表 `experimentId`），未凭记忆写 SQL。
- 唯一例外登记（文件头已写明）：本模块直接下发聚合 SQL，不经 Repository 契约 —— 契约无 count 能力，逐表 `list()` 全量再 `.length` 会把 `research_result` 整表拉进内存。**边界：只做计数与状态分组，不含任何领域判定。**
- 输出 `gaps`：只依赖「计数是否为 0」与「是否存在未终态」，**不引入新阈值** ⇒ 不会与 planner / engine 既有判定分歧。

---

## 3. 🔴 事实纠正：审计报告把「用户草稿」误判成「残骸」

审计报告 §3.2 的 P1-2 原文：

> 研究 Run 侧仍无孤儿回收（§44.5 `9h` 未做）…… 残骸 `630001@630002`（09-16 15:59）与 `270008@330003`

**实测推翻**：`630002` 的 `inputSnapshot` 与 `startedAt` **皆为空**，所属实验 `360002` 为 `DRAFT` ⇒ 它从来**没有进入过执行**，是用户在 09-16 手工建的一个研究草稿（实验名「首板后 5 日区间内震荡 → T+10 收益」）。

**为什么会误判**：初版仅按「`status ∈ {PENDING, RUNNING}`」判定在途（`_probe_inflight_state.mts` 的口径），把「未执行草稿」与「执行中被杀」混为一类。按那个口径去收敛，就会把用户的合法研究数据写成 `FAILED`。

**教训（已写进 `PROJECT_RULES.md`）**：**探针把两类东西算成一类时，先看有没有能区分的列**。本例的区分列一直存在 —— `inputSnapshotJson` 只在首次执行时落定（schema 注释早已写明），是一个「免费的真值」。**审计结论必须能解释每一行数据的来路，而不是只解释它们的计数。**

---

## 4. 「在途」判据精确化（同步更新 `PROJECT_RULES.md`）

旧表述：「`server/**` 改动会杀死在途 Run ⇒ 动手前必须零 `RUNNING`/`QUEUED`/`PENDING`」。

**代码依据**：`engine.ts` 在**全部校验通过之后**才置 `RUNNING`；`runIncremental` 另有 `RUN_ALREADY_RUNNING` 守卫 ⇒ **`PENDING` 恒等于「尚未进入执行」**，热重启**杀不到它**。

⇒ 新口径：**在途 = `RUNNING`**（唯一）。「零在途才能改 `server/**`」= **零 `RUNNING`**。

这不只是措辞问题：旧口径会让人在「只有 PENDING 草稿」时误判成「不能动手」，进而**去写库收敛合法草稿**（正是审计初稿差点犯的错）。

---

## 5. 验收（五层证据）

| 层 | 命令 / 判据 | 结果 |
|---|---|---|
| 1 类型 | `node node_modules/typescript/bin/tsc --noEmit` | **exit 0，零错误** |
| 2 聚焦单测 | `vitest run tests/server/researchEngine/reclaim.test.ts` | **8 / 8 通过**（覆盖 ①终态过缓冲 ②缓冲期内不收敛 ③**PENDING 草稿必须保留** ④RUNNING 未超阈值不动 ⑤RUNNING 超阈值全链收敛 ⑥幂等 ⑦阈值全关零写入） |
| 3 全量单测 | `vitest run`（250 files） | **8 failed / 17 failed tests**；本轮涉及文件（reclaim / engine / chainHealth / researchRunRouter / contracts）**零失败** |
| 4 前端构建 | `vite build` | **成功**，3034 modules，16.21s（`dist/` 未被 git 跟踪 ⇒ 零污染） |
| 5 live 真库 | `researchRun.chainHealth` HTTP GET（superjson 包裹） | **200**，见下表 |

**第 3 层的定性**（不只看计数）：失败文件 8 个，其中 7 个为既有的「外部真实资源依赖」类（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`）；第 8 个 `tests/server/researchCore/candidates.updateBoundary.test.ts` 的失败原因是 `RESEARCH_CANDIDATE_IMMUTABLE_FIELDS` 现有 **7** 项、测试仍期望 **6** 项（差的就是 `9at` 新增的 `sourceResearchPlanId`）。

**归属判据（非推断）**：本轮改动文件集合（`find -newermt "2026-09-17 11:55"`）**不含**该测试文件（mtime **2026-09-13**），也不含其依赖常量文件 `server/researchCore/candidates.ts`（mtime **2026-09-17 00:53**，早于本会话）。⇒ **归因为 `9at` 遗留的契约测试未同步，本轮零新增失败。**

**第 5 层实测输出**：

| 实验 | 计数（questions/plans/hypotheses/runs/analyses/results/findings/conclusions/candidates） | 状态分布 | `gaps` |
|---|---|---|---|
| `240002`（正式，COMPLETED） | 0 / 0 / 0 / **9** / **256** / **4725** / **13** / **8** / **9** | run `{FAILED:1, COMPLETED:8}`；analysis `{CANCELLED:1, COMPLETED:255}` | ①②③（无 question/plan/hypothesis —— 该实验走人工建分析路径） |
| `360002`（草稿，DRAFT） | 0 / 0 / **1** / **1** / **1** / **0** / 0 / 0 / 0 | run `{PENDING:1}`；analysis `{PENDING:1}` | ① ② ⑤「有 1 条分析但零结果行 ⇒ 从未真正产出结果」+ ⚠️ 未终态分析 1 条（并声明草稿保留） |
| `999999`（不存在） | 全 0 | `{}` | `experiment: null` + 「实验不存在」 —— **不伪造空链** |

其中 `240002` 的 `analysisByStatus.CANCELLED = 1` 就是被回收的 `270008`（**端点读数与回收动作对得上**，互为证据）。

---

## 6. 改动清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `server/researchEngine/reclaim.ts` | 🆕 新增 | 孤儿回收唯一实现（双判据 + 如实回报保留项 + `describeOrphanReclaim`） |
| `server/researchChainHealth.ts` | 🆕 新增 | 研究链体检（只读聚合，文件头登记唯一例外） |
| `tests/server/researchEngine/reclaim.test.ts` | 🆕 新增 | 8 个判据单测（纯逻辑，零 DB） |
| `server/researchEngine/engine.ts` | ✏️ 修改 | 新增 `settleAbandonedAnalyses`；两处 catch 接线（**源头修复**） |
| `server/researchEngine/index.ts` | ✏️ 修改 | barrel 导出 `./reclaim` |
| `server/_core/index.ts` | ✏️ 修改 | boot 挂载 `reclaimOrphanResearchWork`（三类日志，含「保留草稿」） |
| `server/researchRunRouter.ts` | ✏️ 修改 | 新增 `chainHealth` procedure（`.output()` 校验）+ 2 处 import |
| `shared/researchContracts.ts` | ✏️ 修改 | 新增 4 个体检 schema（契约唯一来源） |
| `tests/server/researchEngine/engine.test.ts` | ✏️ 修改 | **跟随行为变更**更新 1 处断言（`PENDING` → `CANCELLED`）+ 标题与注释 |
| `.workbuddy/memory/PROJECT_RULES.md` | ✏️ 修改 | 运行纪律段更新（两侧兜底 + 在途判据 + 回收判据），纯 CRLF 保持，前缀逐字节未动 |

**`server/**` 文件数**：571 → **573**（判据 `find server -type f | wc -l`）。

---

## 7. 未做 / 明确边界

| 项 | 状态 | 说明 |
|---|---|---|
| STEP A（条件 → 回测信号桥） | ⬜ 未做 | 审计报告 P0-1，登记为 `9aw` |
| STEP B（评价/绩效/参数统一到闭环口径 + 接 4 个 notWired 阶段） | ⬜ 未做 | 审计报告 P0-2 / P0-3，登记为 `9ax` |
| STEP C（交易模式单一声明库 Pattern SoT） | ⬜ 未做 | **用户最终目标的落点**，登记为 `9ay` |
| STEP D（`OR`/`NOT` 响亮拒绝、模式库页面、冷算 stale-while-revalidate） | ⬜ 未做 | 登记为 `9az` |
| 「父 Run 无时间基准 ⇒ 跳过」分支的真库验证 | ⚠️ 未覆盖 | 内存仓储的 `create` 恒盖 `createdAt`，构造不出三项皆空的行；该分支只有代码审查级证据 |
| `candidates.updateBoundary.test.ts` 的过期断言 | ⚠️ **本轮不修** | 属 `9at` 遗留（`sourceResearchPlanId` 未同步），修它需确认 `RESEARCH_006.1 §7.1` 的原意，**不属 STEP 0 范围**，已如实登记 |
| 前端展示 `chainHealth` | ⬜ 未做 | 本轮只做只读端点；页面接入属 STEP D 的「模式库/体检页面」 |

---

## 8. 下一步（建议顺序）

1. **STEP A（`9aw`）** —— 打通「条件 → 回测信号」：这是「研究发现 ≠ 回测所跑」的根因，用户目标的**必要前提**。已定决策：无法映射的条件**响亮抛错**（不静默回落默认配方）。
2. **STEP C（`9ay`）** —— 交易模式单一声明库：让「AI/vibecoding 加一种模式 = 1 个声明文件」成立，直指用户「分析研究模块过于复杂」的诉求。
3. **STEP B（`9ax`）** —— 评价/绩效/参数统一（已定决策：参数空间从策略文档 `document.parameters` 派生）。
4. **STEP D（`9az`）** —— 收口。
