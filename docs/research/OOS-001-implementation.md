# OOS-001 — Out-of-Sample Validation 完整实现（最终报告）

> **编号**：`9bv`　**基线影响**：`v1.2.0` → **`v1.3.0`**（minor）
> **完成时间**：2026-09-19 20:50 GMT+8
> **本报告是本任务**唯一**交付报告（规格 §21）。**

---

## 1. Executive Summary

### 1.1 做了什么

把**某次参数搜索冻结下来的那组候选参数**，放到**它没参与过的数据窗口**上
**真实重跑回测**并**重算 canonical 指标**，给出样本内外逐项对照，**全部落库可追溯**。

链条（规格给出的目标闭环，已完整跑通）：

```text
Parameter Search Result
  → 冻结候选参数（源 Search Run + parameterHash，服务端重算 hash 复核）
  → 确定 OOS 数据窗口（oosStart > searchEnd，默认禁止重叠）
  → 使用相同 Strategy / Dataset 定义（继承源 Run 坐标，不用 latest）
  → 在 OOS 数据上真实执行 Backtest（复用唯一权威 backtestBridge）
  → Canonical Metrics（必须重算，不是复制源结果）
  → OOS Result 持久化（两表，0 FK）
  → IS / OOS 对照（六项 + 三项派生）
```

**核心原则落地**：`IS / Search 用于发现参数；OOS 只用于验证，不能再次调参` ——
这条原则在产品里不是注释，而是**三层结构事实**：
契约层（创建入参只有 4 个键、**没有放参数值的位置**）、
持久化层（`resolvedParameterSetJson` 写入即冻结，`ON DUPLICATE KEY UPDATE` 集合不含它）、
执行层（执行时只用那一份冻结参数集，且**复核**其 `parameterHash`）。

### 1.2 为什么是「并列新增」而不是改 `robustness/**` 或复用既有 OOS 模块

**与 `searchRobustness/**`（上一轮 `9bu`）的关系是「并列且语义相反」**：

| 维度 | `searchRobustness/**`（`9bu`） | `oosValidation/**`（本轮 `9bv`） |
|---|---|---|
| 问的问题 | 「同一份结果**邻域**稳不稳？」 | 「换到**没见过**的数据上**还成立吗**？」 |
| 是否重跑回测 | ❌ **零重跑、零指标重算** | ✅ **必须重跑 + 必须重算** |
| 数据 | 冻结的 Search 结果（**原地**） | **新的 OOS 窗口**（与 IS 不重叠） |
| 静态守卫方向 | import **黑名单**（禁 `backtest` / `strategyEvaluation` / …） | import **必含清单**（必须出现 `createStrategyBacktestBridge` + `projectCanonicalMetrics`） |

🔴 **守卫方向镜像相反是本轮最重要的架构判据**：把实现从一域搬到另一域，
会让**对侧**测试立刻变红。因此本域**不允许**放进 `searchRobustness/**`（规格 §2 明文要求）。

**与仓库既有四套 OOS 模块的关系是「不重复实现，只补上可执行 + 可追溯」**：

| 既有模块 | STEP | 与本域差别 |
|---|---|---|
| `research/trainValidationOos.ts` | 6.4 | 纯模型，**不可执行、不落库** |
| `research/validationSelection.ts` | 6.4 | `FrozenOosCandidate` = **进程内计划候选** |
| `research/oosEvaluation.ts` | 6.4 | 文件头自述「**不实现任何回测 / 交易**」 |
| `research/oosIsolation/**` | 19 (C-19.2) | **记录 / 检查层**，无重跑语义 |

本域与它们的**根本差别四条**：① Run 身份与状态机；② 参数冻结**可复核**；
③ **真进闭环重跑**；④ **落库可追溯**。这四条边界已写进 `server/research/oosValidation/index.ts` 文件头。

### 1.3 验收数字（全部实测）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0 error**（7 轮验证，含 router 接线 / 重命名 / 前端面板 / DOM 锚点各一次） |
| 新增单测 | **65/65 PASS**（域 `oosValidation.test.ts` 51 + 静态守卫 `oosValidationBoundary.test.ts` 14） |
| 全量 `vitest run` | 失败文件 **8 → 8 零新增**；失败用例 **17 → 17 零新增**；`oosValidation` **零命中** |
| `npx vite build` | **成功**（3041 modules / 17.81 s） |
| 真实 E2E 阶段一 | **2/2 PASS**（真实 2×2 参数搜索，回测耗时 **42 s**） |
| 真实 E2E 阶段二 | **12/12 PASS**（创建 + 真重跑 37 s + 幂等复核） |
| 跨进程二次独立重跑 | **12/12 PASS**（逐项复现 ⇒ 确定性） |
| 前端可达性（量 DOM） | **`pass=true`**、0 page error、深链无需点击即自渲染 |
| migration | 首跑 **2 executed** / 次跑 **0 executed + 2 skipped**（幂等）、`fk=0`、`altered=[]` |
| `node scripts/checkEolDrift.mjs` | **0 漂移** |

### 1.4 一句话结论

**「搜索出来的参数，拿到没见过的时间段上还能不能打」这个问题，现在有一个可执行、
可复核、可追溯、且不允许偷偷调参的答案 —— 并且这个答案确实是重跑出来的，不是抄来的。**

---

## 2. 规格 21 节逐条落点

| 规格节 | 要求 | 落点 |
|---|---|---|
| §2 与 Robustness 边界 | Robustness 零重跑；OOS **必须**重跑；禁实现进 `searchRobustness/**` | `oosValidation/**` 独立目录；守卫**镜像**（黑名单 vs 必含清单），`oosValidationBoundary.test.ts` 钉死 |
| §3 Phase A 先审计不直接编码 | 先读真实代码 | 读既有四套 OOS 模块 + `parameterSearch` 全套读函数 + `backtestBridge` + `drizzle/schema.ts`；用只读探针 `_probe_oos_source_scan.mts` 实测扫全库 |
| §4 OOS Run 必须回答 10 问 | 10 项保存 | `oos_validation_run` 32 列逐项承载（见 §7 表） |
| §5 参数冻结 | 禁搜索 / 禁调参 / 禁重选 / 禁用当前版本重新解释 / 禁从当前 Schema 重推；**信息不足 ⇒ 显式失败** | 契约 4 键无参数值位置；`freeze.ts` 重算 `computeParameterHash` 复核；`OOS_FROZEN_SNAPSHOT_MALFORMED` / `OOS_SOURCE_*` 响亮拒绝 |
| §6 窗口不重叠 | `oosStart > searchEnd`，`oosStart < oosEnd` | `window.ts#assertOosWindowIsolated` 五条判定顺序 |
| §7 Dataset 语义 | 优先复用 DatasetVersion + oosWindow | 继承源 Run 的 `datasetVersionId`（**唯一权威坐标**）；`datasetVersionLabel` 仅展示 |
| §8 Strategy 语义 | 用冻结 StrategyVersion，不得用 latest，须记 `strategyVersionId` + definition fingerprint | `definitionFingerprint.ts` 创建时冻结、执行时**复核**（`OOS_STRATEGY_DEFINITION_DRIFT`） |
| §9 真进 Runtime → Canonical Metrics | **必须重算** | `executor.ts` 经 `createStrategyBacktestBridge` + `projectCanonicalMetrics`（守卫**必含清单**钉死） |
| §10 IS/OOS 对照 | 六项 + Derived；**不定义「优秀 / 最优 / 推荐」** | `comparison.ts#buildOosComparison`；措辞守卫 |
| §11 OOS 只消费 Search Result | 不修改源 | 真实 E2E 对源三表做**表级 digest** 三次采样，逐字节相等 |
| §12 状态机 | 五态；非法迁移响亮拒绝；同态幂等；**COMPLETED 不允许再次执行** | `run.ts#canTransitionOosRun`（复用 `PARAMETER_SEARCH_RUN_TRANSITIONS`）+ `assertOosRunCanExecute` |
| §13 持久化 | 手工 SQL migration、幂等、0 FK、不改历史数据、禁 `db:push` / `drizzle-kit generate` | `drizzle/0043_oos_validation.sql` + `scripts/applyOosValidation.mjs` |
| §14 API | 6 端点，复用现有 router，**create 与 start 必须分开** | `server/paramSearchRouter.ts` +6 端点，零新 router |
| §15 前端 | 在现有 Parameter Search 页面体系增加 OOS 入口；**禁 best/optimal/winner/recommend** | `client/src/components/oos/OosValidationPanel.tsx` 挂 `/parameter-search` |
| §16 安全边界测试 T1~T7 | 逐条 | 见 §12 |
| §17 真实 E2E | 真实 Search → 真实 Combination → 真实 OOS → 真实 Dataset → 真实 Backtest → 真实 TiDB；禁 mock | 见 §11（12/12 PASS） |
| §18 测试与回归 | 6 项 | 见 §1.3 |
| §19 禁止扩大范围 | 9 项范围外 | 见 §14 |
| §20 完成标准 | 9 项 | 见 §16 |
| §21 只提交一个报告；不创建 OOS-002 | — | 本文件；**未创建 OOS-002** |

---

## 3. Existing Code Reuse（收敛而非新建）

| 能力 | 唯一权威（复用，未重写） |
|---|---|
| 回测执行 | `server/research/strategyEvaluation/backtestBridge.ts#createStrategyBacktestBridge` |
| 指标读数 | `server/research/parameterSearch/searchResult.ts#projectCanonicalMetrics` |
| IS 冻结副本 | `server/research/parameterSearch/executor.ts#toResultView` |
| 状态机迁移表 | `server/research/parameterSearch/searchRun.ts#PARAMETER_SEARCH_RUN_TRANSITIONS` |
| 候选身份哈希 | `server/research/parameterSearch/parameterHash.ts#computeParameterHash` |
| 策略定义指纹 | `server/strategyCore/fingerprint.ts#computeDefinitionFingerprint` |
| canonical 序列化 | `server/researchDataset/version.ts#canonicalStringify` |
| 错误类型 | `server/research/experimentValidation`（`ResearchValidationError`） |
| 数值守卫 | `server/research/parameterSearch/persistence.ts#finiteOrNull` |
| 数据窗口读取 | `server/research/parameterSearch/persistence.ts#readDatasetVersionWindow` |

**未新建（刻意）**：❌ 第二套回测引擎 ❌ 第二套 canonicalMetrics ❌ 第二个 `paramSearch` router
❌ 第二套状态机（`OOS_VALIDATION_RUN_STATUSES = PARAMETER_SEARCH_RUN_STATUSES`，**同词表**）
❌ 第二张迁移表。

**命名不遮蔽（本轮实建踩到并消除）**：ESM `export *` 的同名导出会**静默遮蔽**。
三处已改名并加注释：`FrozenCandidateSnapshot`（原 `FrozenOosCandidate`，与 `validationSelection.ts` 同名）、
`oosFingerprintOf`（2 处同名）、`oosCalendarDaysBetween`（1 处同名）。
该纪律由 `oosValidationBoundary.test.ts` 的**命名不遮蔽守卫**（比对 `server/**` + `shared/**` 顶层导出名）钉住。

---

## 4. Domain Model

```
OosFrozenCandidateSnapshot   ← 冻结的候选（源 Run 坐标 + parameterHash + 参数值 + 组合序号）
OosSourceCoordinates         ← 源 Run 的坐标快照（strategyId/Version/VersionId/Dataset/窗口/口径）
IsMetricsSnapshot            ← IS 六项读数 + metricsSource + 年化基数
OosRunView                   ← Run 视图（32 列投影，含 notes / errorCode）
OosResultView                ← Result 视图（IS 六项 + OOS 六项 + comparison + 指纹）
OosExecutionOutcome          ← start 的返回（executed 布尔 + result|null）★ 幂等的表达
```

**枚举**：`OOS_VALIDATION_RUN_STATUSES = PARAMETER_SEARCH_RUN_STATUSES`（复用，同词表）、
`OOS_VALIDATION_RESULT_STATUSES = ["SUCCEEDED","FAILED"]`、`OOS_METRICS_SOURCES = ["canonical","evaluators"]`。

**版本自述**（不写死数字）：
`OOS_METRICS_VERSION = "canonicalMetrics@" + BACKTEST_ANNUALIZATION_DAYS + "d"`（实测译为 `canonicalMetrics@252d`）、
`OOS_ENGINE_VERSION = "strategy-core/1.0.0"`、`OOS_VALIDATION_RUN_ID_PREFIX = "OOSV"`。

---

## 5. Input Contract（冻结与「禁调参」的落地）

```ts
export const createOosValidationInputSchema = z.object({
  sourceSearchRunId: z.string().min(1),
  parameterHash: z.string().min(1),      // 要验证的冻结候选（源 Run 内的组合身份）
  oosWindow: oosWindowSchema,            // { startDate, endDate }
  metricsVersion: z.string().min(1).optional(),
});
```

🔴 **只有 4 个键，且没有放参数值的位置。** 这是规格 §5 在**契约层**的落地：
让「顺手传一组更好的参数」**在类型层面就无处可写**。
UI 侧由 DOM 探针实测「创建区块内 `<input>` **恰为 4 个**」作为同一命题的**另一层证据**。

**执行时如何拿到参数值**：服务端从**源组合行**读出参数值 → **重算 `computeParameterHash`** →
与请求里的 `parameterHash` 逐字节比对（E2E 判据 V2 实测两侧都是
`5b1c7ff9c1be5856fa18d4059d99d3c461dcd7b031abca14c8f89cfe49bfab76`）。
冻结信息不足（组合不存在 / hash 不匹配 / 快照 JSON 非法）⇒ **显式失败**，
**绝不**回读**当前**策略版本「补全」参数（规格 §5/§9）。

---

## 6. Window Isolation（规格 §6）

`window.ts#assertOosWindowIsolated({ searchWindow, oosWindow, datasetWindow })` 的**判定顺序**：

| # | 判定 | 领域码 |
|---|---|---|
| 1 | 形态（字段齐全、`YYYY-MM-DD`、真实业务日） | `OOS_WINDOW_INVALID` |
| 2 | 自身合法（`oosStart <= oosEnd`） | `OOS_WINDOW_INVALID` |
| 3 | **源窗口**合法（`searchStart <= searchEnd`） | `OOS_SEARCH_WINDOW_INVALID` |
| 4 | 不重叠（`oosStart > searchEnd`） | `OOS_WINDOW_OVERLAP` |
| 5 | 落在数据集可用区间内 | `OOS_WINDOW_OUT_OF_DATASET_RANGE` |

⚠️ 判定 3 的**领域码是参数化的**（`assertWindowWellFormed(..., code)`）——
首版把源窗口倒挂也报成 `OOS_WINDOW_INVALID`，会让「问题出在源窗口」被读成「问题出在 OOS 窗口」。
单测抓到这个自相矛盾并已修。

真实 E2E 实测判定 4 的输出：
> 窗口隔离通过：search window = `2025-01-02..2025-02-28`，oos window = `2025-03-01..2025-04-30`
> （间隔 1 个日历日，`oosStart(2025-03-01) > searchEnd(2025-02-28)`）。
> OOS 窗口落在数据集可用窗口 `2024-09-01..2026-09-01` 内。

---

## 7. Database（规格 §13）

### 7.1 两张新表

| 表 | 列数 | 角色 | 索引 |
|---|---|---|---|
| `oos_validation_run` | **32** | Run 头：源坐标 + 冻结候选身份 + 策略 / 数据集快照 + 定义指纹 + **IS / OOS 双窗口** + 冻结参数集 + 固定坐标 + 口径 / 引擎版本 + 状态 + 时间戳 | `uq_..._run_id (oosRunId)` UNIQUE · `idx_..._source` · `idx_..._created` · `idx_..._status` |
| `oos_validation_result` | **41** | 结果：**IS 六项冻结副本** + **OOS 六项重跑读数** + 两侧口径来源与年化基数 + `comparisonJson` + 撮合 / 评估指纹 + 状态 | `uq_..._candidate (oosRunId, sourceParameterHash)` UNIQUE · `idx_..._run` · `idx_..._status` |

### 7.2 规格 §4 的「十个问题」→ 存储落点

| # | 问题 | 落点 |
|---|---|---|
| 1 | 源 Search Run | `sourceSearchRunId` |
| 2 | 源组合身份 | `sourceParameterHash`（UNIQUE 维度之一）+ `sourceCombinationIndex` |
| 3 | 策略身份 | `strategyId` / `strategyVersion` / `strategyVersionId` |
| 4 | 数据集坐标 | `datasetVersionId`（**权威**）+ `datasetVersionLabel`（仅展示） |
| 5 | 被验证的参数集 | `resolvedParameterSetJson`（**写入即冻结**） |
| 6 | 搜索快照 | `searchSnapshotJson` + `searchSnapshotFingerprint` + `fixedCoordinatesJson` + `executionPolicyVersion` + `evaluationConfigFingerprint` |
| 7 | 冻结策略定义指纹 | `strategyDefinitionFingerprint` |
| 8 | 口径 / 引擎版本 | `metricsVersion` / `engineVersion` |
| 9 | 执行结果 | `oos_validation_result`（六项 + 口径来源 + 撮合指纹） |
| 10 | 状态与时间 | `status` / `createdAt` / `startedAt` / `completedAt` + `runFingerprint` |

### 7.3 约束遵守（全部实测）

- **0 FK**：两张新表 0 个外键；全库 FK 总数仍为 **0**（apply 脚本断言 `fk=0`）。
- **零 DML / 零 ALTER / 零 DROP**：`drizzle/0043_oos_validation.sql` 只有两条
  `CREATE TABLE IF NOT EXISTS`；apply 脚本剥注释后只允许 `CREATE TABLE`，
  出现 `INSERT/UPDATE/DELETE` / `DROP` / `MODIFY` / `CHANGE COLUMN` / `RENAME` / `TRUNCATE` 即失败
  ⇒ 「不改任何历史行」是**可静态断言**的事实。
- **幂等**：`-- @guard: table` × 2 → 首跑 **2 executed**；次跑 **0 executed + 2 skipped**、`pass=true`。
- **真库比对**：既有 **20 张**邻接表列签名**逐表完全一致**；`ALTERED_TABLES = {}`（本轮**零 ALTER**）。
- **禁 `db:push` / `drizzle-kit generate` 已遵守**：`drizzle/meta/_journal.json` 仍止于 0023，未改动。
- 🔴 **写入即冻结**：`resolvedParameterSetJson` / `searchSnapshotJson` 的
  `ON DUPLICATE KEY UPDATE` 集合中**不含**它们（规格 §5 在持久化层的落地）。

---

## 8. API（规格 §14）

`server/paramSearchRouter.ts` **同域扩 6 端点，零新 router**：

| 端点 | 语义 | 是否写 |
|---|---|---|
| `paramSearch.createOosRun` | 只冻结配置，**不执行** | 写（便宜） |
| `paramSearch.listOosRuns` | 列表（可选按源 Run 过滤 + 分页） | 只读 |
| `paramSearch.getOosRun` | Run 详情 + Result（一次查询给全） | 只读 |
| `paramSearch.startOosRun` | **真实重跑**；`COMPLETED` 时幂等返回 | 写（昂贵，分钟级） |
| `paramSearch.cancelOosRun` | 取消（`COMPLETED` / `CANCELLED` 拒绝） | 写 |
| `paramSearch.getOosResult` | 只取 Result | 只读 |

🔴 **`create` 与 `start` 必须分开**（规格 §14 明文）：契约里就是两个入参
（`createOosValidationInputSchema` vs `oosValidationRunIdInputSchema`）⇒ 「创建即执行」在类型层不可表达。

---

## 9. Execution Flow

见架构文档 `EXECUTION-FLOW.md#E-91`（同步新增）。关键跳：

```text
createOosRun
  ├ 读源 Run / 组合 / 结果（只读）
  ├ 重算 parameterHash 复核（V2）
  ├ 校验源 Run COMPLETED ∧ 有结果 ∧ 选中组合 metricsSource=canonical
  ├ 策略定义指纹冻结 + 数据集窗口读取
  ├ 窗口隔离五判定
  └ 落 oos_validation_run（status = CREATED，**此时还没有跑任何回测**）

startOosRun
  ├ assertOosRunCanExecute（COMPLETED ⇒ 响亮拒绝；RUNNING ⇒ 响亮拒绝）
  ├ 状态 CREATED → RUNNING
  ├ 复核策略定义指纹（漂移 ⇒ OOS_STRATEGY_DEFINITION_DRIFT）
  ├ createStrategyBacktestBridge → 在 OOS 窗口真实执行
  ├ projectCanonicalMetrics（重算）
  ├ buildOosComparison（六项 delta/ratio + 三项派生）
  ├ upsertOosValidationResult
  └ Run → COMPLETED
```

---

## 10. Frontend（规格 §15）

`client/src/components/oos/OosValidationPanel.tsx`（约 600 行）挂在 `/parameter-search`
（**与 `SearchRobustnessPanel` 同一页、语义正好相反**，代码注释里写明了这一点）。

**面板内容**：
- 创建区：4 个输入位（源 Run / `parameterHash` / OOS 起 / OOS 止）+「冻结配置（不执行）」按钮；
  说明文字明确写出「界面上没有任何可以填参数值的位置」；
- Run 列表：`oosRunId` / 源 Search Run / OOS 窗口 / 策略身份 / 状态（中文标签，文本优先）；
- 详情：**六项冻结坐标** + 冻结参数集 + 固定坐标 + 运行内容指纹 + 时间线；
- **IS × OOS 逐项对照表**（6 行 × 5 列：指标 / IS / OOS / `OOS−IS` / `OOS/IS`）
  + 三项派生（收益退化 / 回撤变化 / 交易笔数变化）+ 三处读数来源 + 对照是否成立；
- 「执行样本外验证」: pending 时文案变为**「正在样本外真实重跑（分钟级）…」**（长请求必须换文案）；
- **深链 `?oosRunId=`**：直接用 URL 打开即自动选中该 Run。

**纪律**：不出现「最佳 / 最优 / 推荐 / winner / best / optimal」（源码扫描守卫钉住）；
`null`（算不出来）显示「—」而非 `0`。

---

## 11. Real E2E Evidence（规格 §17，禁 mock）

**构造**（`docs/evidence/_e2e_oos_validation.mts`，约 700 行，五模式 `search`/`oos`/`full`/`verify`/`clean`）：

| 项 | 值 |
|---|---|
| 自建策略版本 | `oos1-e2e-mu8dg1qj@1.0.0`（克隆 `cand-360001@1.0.0` + 把 `cond-2` 右值改成 `max_volume_ratio` 参数引用） |
| 源 Search Run | `PSRUN-20260919-3fa7305e`（真实 2×2 搜索，**真跑回测 42 s**） |
| 数据集坐标 | `datasetVersionId = 390002`（label `v2`，可用窗口 `2024-09-01..2026-09-01`） |
| IS 窗口 | `2025-01-02 .. 2025-02-28` |
| OOS 窗口 | `2025-03-01 .. 2025-04-30` |
| 被验证候选 | 组合 #1（`ORDER BY tradeCount DESC` ⇒ 8 笔），`max_volume_ratio = 1` |
| `parameterHash` | `5b1c7ff9c1be5856fa18d4059d99d3c461dcd7b031abca14c8f89cfe49bfab76` |

⚠️ **构造上的一个真实教训**：仓库**全部 11 个既有策略版本**的 `ruleGraphRefs` **全为空**
（只读探针 `_probe_oos_source_scan.mts` 实测），因此**任何既有版本建搜索都被拒**
（`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`）⇒ 必须自建「含参数引用」的策略版本。
这不是本任务的缺陷，是 PARAMETER-002 已登记的结构性事实。

### 11.1 十二条判据（**12/12 PASS**）

| 判据 | 断言 | 实测 |
|---|---|---|
| V1 | OOS Run 绑定真实源 Search Run | `sourceSearchRunId = PSRUN-20260919-3fa7305e` |
| V2 | 源组合 `parameterHash` 与**现在重算**结果逐字节相等 | 库内 = 重算 = `5b1c7ff9…ab76` |
| V3 | 冻结参数集与源组合参数语义逐字节相等 | `{"max_volume_ratio":1}` |
| V4 | `strategyVersionId` 继承源 Run 身份（**非 latest**） | `oos1-e2e-mu8dg1qj@1.0.0`，指纹 `c93801ff…4cce` |
| V5 | `datasetVersionId` 继承源 Run 的 Dataset 坐标 | OOS = 源 = `390002`，label `v2` |
| V6 | 窗口隔离：`oosStart > searchEnd`（默认禁重叠） | `2025-01-02..2025-02-28` → `2025-03-01..2025-04-30` |
| V7 | OOS 读数是本次**真跑**产物（`oosMetricsSource = canonical`） | `status=SUCCEEDED`，`backtestFingerprint = 0c94868c…52cb` |
| V8 | OOS 是**在不同数据上重跑**（撮合指纹不同） | 源 `edfb2bc3…6912` **≠** OOS `0c94868c…52cb` |
| V8b | OOS 读数与 IS 读数不同 | 差异项 = 收益 / 年化 / 回撤 / 笔数 / 盈亏比 |
| V9a | **创建阶段**未改动源三表 | digest(`run/combination/result`) = `7abdb690/26fc7cb6/b74772d3` |
| V9b | **执行阶段**未改动源三表（同一 digest） | 同上，**逐字节相同** |
| V10 | `COMPLETED` 后再次执行 ⇒ 幂等 | `executed=false`；指纹首次 = 再次 = `14d571b7…` |

### 11.2 真实读数（这是本任务要交的东西）

| 指标 | 样本内 IS | 样本外 OOS | `OOS − IS` | `OOS / IS` |
|---|---|---|---|---|
| 总收益率 % | **−10.36** | **+7.30** | `+17.657` | `×-0.70` |
| 年化收益率 % | −54.50 | +54.18 | `+108.679` | `×-0.99` |
| 最大回撤幅度 % | 10.54 | 3.99 | `-6.553` | `×0.38` |
| 完成交易数 | 8 笔 | 2 笔 | `-6` | `×0.25` |
| 胜率 % | 50.00 | 50.00 | `0` | `×1.00` |
| 盈亏比 | 0.172 | 3.179 | `+3.007` | `×18.49` |

派生：收益退化（`IS − OOS`）= `-17.657 %`；回撤变化（`OOS − IS`）= `-6.553 %`；
交易笔数变化 = `-6` 笔；`comparable = true`；`comparableCount = 6 / 6`。

### 11.3 🔴 一个必须讲清楚的判据设计

**「真在不同数据上重跑」的主判据是「撮合指纹差异」，不是「指标差异」。**
原因：`tradeCount = 0` 时两侧指标**天然全相等**（都是 0 / 0 / 0），
若用「指标不同」判定重跑，会把「零成交的重跑」误判成「压根没重跑」。
首版 E2E 正是取到了 `max_volume_ratio = 0.05` 的**零成交**组合，V8 因此假失败 ⇒
改为 ① 按 `tradeCount DESC` 取候选；② 主判据改为 `backtestFingerprint` 差异；
③ 另加 V8b 处理「两侧零成交」时如实标注「本次对照无成交信息」。

---

## 12. Tests（规格 §16 T1~T7）

`tests/server/research/oosValidation/oosValidation.test.ts` — **51 例**：

| 组 | 例数 | 覆盖 |
|---|---|---|
| T1 参数冻结 | 10 | hash 复核相等 / 不等 / 缺失 / 非法 JSON / 非标量值 / 冻结快照不可变 … |
| T2 接口层无参数位 | 2 | `createOosValidationInputSchema` 键集合**恰为 4**、无 `parameters` 类键 |
| T4 窗口隔离 | 10 | 五条判定 + 边界（相等 / 倒挂 / 越界 / 非业务日） |
| T5 canonical | 3 | 非 canonical ⇒ 拒绝；`NOT_AVAILABLE` 不被顶替 |
| T6 确定性 | 5 | 同输入 ⇒ 同 `runFingerprint` / `resultFingerprint` |
| T7 串线 | 4 | `oosRunId × sourceSearchRunId` 交叉不一致 = 0 |
| §12 状态机 | 6 | 五态合法迁移 + 非法迁移拒绝 + `COMPLETED` 不可再执行 |
| §10 对照 | 8 | `IS = 0 ⇒ ratio = null`、`comparable = isAvailable ∧ count > 0`、`null ≠ 0` |
| §8 指纹 | 4 | 冻结 / 复核 / 漂移检测 |

`tests/server/research/oosValidation/oosValidationBoundary.test.ts` — **14 例**（静态守卫）：

| 守卫 | 内容 |
|---|---|
| 写点白名单 | `oosValidation/**` 只允许写 `oosValidationRun` / `oosValidationResult`（**词边界正则**，避开 `updateOosValidationRun(` 这类函数名误判） |
| 源只读白名单 | 对 `parameter_search_*` 只允许只读调用 |
| **必含清单** | 必须 import `createStrategyBacktestBridge` + `projectCanonicalMetrics`（「真重跑 + 真重算」的结构证据） |
| 措辞守卫 | 源码不得出现「最佳 / 最优 / 推荐 / winner / best / optimal」 |
| **命名不遮蔽** | 本域顶层导出名与 `server/**` + `shared/**` 无同名冲突 |

合计 **65/65 PASS**。

---

## 13. Known Risks

1. 🔴 **`averageWin` / `averageLoss` 两侧都拿不到**。规格 §10 列了这两项，但源 canonical 面与
   OOS 重算面**均不产出** ⇒ 恒为 `null`。**如实留空、不补值、不算替代量**。
   已在 `shared/oosValidationContracts.ts:91` 与 `system-manifest.yaml#oos.knownRisks` 登记。
2. ⚠️ **`datasetVersionId` 可空**：源 Run 若走「回落重建」路径会得到 `null`，
   此时**口径与正常路径不同**（只继承 `boards` / `excludeSt`）⇒ 表里保留 `NULL` 而不是编一个坐标。
   下游读 `datasetVersionLabel` 时须知道「label 仅展示，不是权威坐标」。
3. ⚠️ **IS 侧读数是「当时的冻结副本」**：若源 Search 结果本身口径有问题，
   OOS 不会「纠正」它 —— 本域的职责不是重算 IS。两侧口径来源（`isMetricsSource` / `oosMetricsSource`）
   在 UI 与契约里都明示。
4. ⚠️ **策略层仍无独立未来函数防护**：`LeakageGuard` 对配方特征恒通过
   （`recipeRegistryAtoms.ts#samePointAvailability` 恒置 `1990-01-01`），安全全靠数据层 PIT。
   本域**未改变**这一事实，`oosValidation` 不声称「OOS 窗口自动保证无泄漏」。
5. ⚠️ **单 Run 单候选**：一次 OOS Run 只验证**一个**候选（`parameterHash`）。
   这不是缺陷，是刻意的 —— 一次验证一个假设，避免「批量比一比挑最好的」滑回参数择优。
6. ⚠️ **前端首次加载慢**：`/parameter-search` 页同时挂 3 块面板，dev **冷启**下 OOS 列表查询
   需 ~20 s 落地（热态 6 s ⇒ 是 Vite 冷编译，不是查询慢）。生产构建不受此影响。

---

## 14. Deferred Items / 范围外（规格 §19）

**本轮明确未做**（不是遗漏，是范围约束）：

- ❌ Walk-Forward 编排（下一阶段 `WALK-FORWARD-001` 由上层决定是否启动）
- ❌ Paper Trading / Live Trading / Broker 对接
- ❌ 自动策略推荐 / 自动参数选择 / 多策略排名
- ❌ 新引擎 / 第二套回测 / 第二套指标口径
- ❌ Robustness-002 / 多维 Robustness
- ❌ 改动任何历史 Search Result / Backtest Run
- ❌ 性能优化（一行未碰）

**下一步建议**：本域已把「IS/OOS 单窗口验证」做成可执行、可追溯的一环；
若要继续，自然的下一站是 **Walk-Forward（多窗口滚动）** —— 但那需要上层明确启动。

---

## 15. Architecture Baseline Changes

基线 `v1.2.0` → **`v1.3.0`**（minor：新增 Domain 模块 + 2 表 + 1 契约 + 6 端点 + 1 前端面板，
既有执行链与核心契约**零破坏**）。已同步 9 份架构文档：

| 文档 | 更新 |
|---|---|
| `SYSTEM-BASELINE.md` | 版本行 + §5 OOS 行 + **新增「OOS-001 增量」节** |
| `system-manifest.yaml` | `oos` 域（sourcePaths / entryPoints / persistence / router / contract / tests / knownRisks） |
| `DOMAIN-MAP.md` | §15 OOS-001 增量（含与 §7 的并列对照表） |
| `DATA-FLOW.md` | 新增 OOS-001 数据流（含「唯一反向边 = 零」） |
| `EXECUTION-FLOW.md` | **新增 E-91**（OOS 执行链 + 镜像守卫说明 + 可达性总表） |
| `DATABASE-MAP.md` | **D-92**（两表 32/41 列 + 约束遵守） |
| `CONTRACT-MAP.md` | **C-92**（契约纪律 6 条） |
| `DEPENDENCY-MAP.md` | 新增 5 条边 + **镜像边** + **写入面白名单** + 命名不遮蔽纪律 |
| `CHANGE-AUDIT.md` | 新增 `2026-09-19 · OOS-001` 条目 |

**ROADMAP 三件套**：§44 覆盖式（只保留最近 1 条「上轮实查」，旧条目零改写）、
§44.5 队列（新增 `9bv.` 已完成项）、§47 append-only → `ROADMAP-CHANGELOG.md`。
编号取号依据 = **台账行**「已用至 `9bv` ⇒ 下一个未占用 = `9bw`」（**非「末条 +1」**）。

---

## 16. 完成标准自评（规格 §20）

| # | 标准 | 自评 | 依据 |
|---|---|---|---|
| 1 | **数据隔离**：OOS 窗口与 IS 不重叠且校验 | ✅ | V6 + `window.ts` 五判定 + 单测 T4（10 例） |
| 2 | **参数冻结**：只认源 Run + hash，复核，不足即失败 | ✅ | V2/V3 + 单测 T1（10 例）+ 契约 4 键 |
| 3 | **真正重跑**：真进闭环，不是复制也不是缩放 | ✅ | V7/V8（**撮合指纹差异**主判据）+ 守卫**必含清单** |
| 4 | **Canonical Metrics**：必须重算 | ✅ | `oosMetricsSource = canonical` + 单测 T5 |
| 5 | **持久化可追溯**：两表 + 指纹 + 幂等 | ✅ | 两表 32/41 列 + V10 幂等 + migration 幂等实测 |
| 6 | **不污染源**：源三表逐字节不变 | ✅ | V9a/V9b 表级 digest 三次采样相同 |
| 7 | **确定性**：同输入同输出 | ✅ | V10 指纹一致 + 跨进程二次独立重跑 12/12 + 单测 T6 |
| 8 | **前端**：可达、可深链、无结论性措辞 | ✅ | DOM 探针 `pass=true`、深链自渲染、措辞守卫 |
| 9 | **真实 E2E**：真实数据 / 真实回测 / 真实库，禁 mock | ✅ | 阶段一 2/2、阶段二 12/12、跨进程重跑 12/12 |

**9/9 达成。** 规格 §19 的 9 项范围外约束**全部遵守**；§21「只提交一个报告」「不创建 OOS-002」**已遵守**。

---

## 附：本任务交付物清单

### 生产代码

| 路径 | 说明 |
|---|---|
| `server/research/oosValidation/{types,window,freeze,gate,comparison,run,definitionFingerprint,persistence,executor,index}.ts` | 域层 10 文件 |
| `shared/oosValidationContracts.ts` | 契约（zod + `z.infer` 同文件） |
| `drizzle/0043_oos_validation.sql` | 手工幂等 migration（两条 `CREATE TABLE IF NOT EXISTS`） |
| `scripts/applyOosValidation.mjs` | 幂等应用脚本（`-- @guard:` + 零 DML 静态断言 + 列签名比对） |
| `client/src/components/oos/OosValidationPanel.tsx` | 前端面板 |
| `server/paramSearchRouter.ts` | +6 端点（零新 router） |
| `drizzle/schema.ts` | +2 表 |
| `client/src/pages/ParameterSearch.tsx` | 挂载面板 |

### 测试

| 路径 | 例数 |
|---|---|
| `tests/server/research/oosValidation/oosValidation.test.ts` | 51 |
| `tests/server/research/oosValidation/oosValidationBoundary.test.ts` | 14 |

### 证据（`docs/evidence/`，已登记 `README.md`）

| 路径 | 说明 |
|---|---|
| `_e2e_oos_validation.mts` | 真实 E2E 探针（五模式） |
| `_e2e_oos_validation.search.out.txt` | 阶段一日志（2/2 PASS） |
| `_e2e_oos_validation.oos.out.txt` | 阶段二日志（12/12 PASS） |
| `_e2e_oos_validation.rerun.out.txt` | 跨进程二次独立重跑（12/12 PASS） |
| `_e2e_oos_validation.clean.out.json` / `.clean.out.txt` / `.state.json` | 归零阶段的结构化结论与日志（`clean` 模式按模式落盘，**不再覆盖**主阶段结论） / 跨阶段交接坐标 |
| `_probe_oos_source_scan.mts` + `.out.json` | 只读源数据探查 |
| `_probe_oos_dom.mjs` + `.out.json` | 前端可达性探针（量 DOM） |
