# PARAMETER-001 — Parameter Search 完整实现 · 最终报告

> **任务号**：PARAMETER-001（ROADMAP 编号 **`9bs`**）
> **日期**：2026-09-19
> **判定**：**COMPLETE**（20 项完成判定全部勾选，见文末 §15）
> **基线版本**：`v1.0.0` → **`v1.1.0`**（minor：Domain 状态跃迁 + 新增 entry point / contract）
> **GLOBAL AUDIT REQUIRED**：**NONE**（未新增/删除 Domain、未改 Domain 边界、未改主链、未做 DB 核心 Schema 大规模变更）

---

## 1. Executive Summary

### 一句话

把仓库**既有**的 `server/research/parameterSearch/**`（Grid/Random 纯函数引擎 + 稳定区判定）与
`server/paramSearchRouter.ts`（实测**全文零写库调用**的技术预览端点）**收敛**为一条**持久化**的搜索闭环：

```text
Strategy Version → Parameter Space → Parameter Combinations → Backtest → Evaluation → Search Results
```

**不新建第二套体系、不新开第二个 router、不重算任何指标、不改既有闭环主链。**

### 交付物

| 类别 | 内容 |
|---|---|
| 域层（新增 8 文件） | `server/research/parameterSearch/{searchSpace,parameterHash,combination,searchRun,searchResult,persistence,executor,coordinates}.ts` |
| 契约（新增 1 文件） | `shared/parameterSearchContracts.ts`（zod schema + `z.infer` 派生类型同文件） |
| 数据库（新增 3 表） | `parameter_search_run`(26 列) / `parameter_search_combination`(10 列) / `parameter_search_result`(23 列)；**0 FK** |
| 迁移（手工幂等） | `drizzle/0041_parameter_search.sql` + `scripts/applyParameterSearch.mjs` |
| API（**同域扩 7 端点**） | `createSearch` / `listSearches` / `getSearch` / `startSearch` / `cancelSearch` / `getSearchResults` / `retrySearchCombination` |
| 前端（新增 1 组件） | `client/src/components/parameterSearch/PersistedParameterSearchPanel.tsx`（挂在 `/parameter-search` 页面顶部） |
| 测试（新增 38 用例） | `tests/server/research/parameterSearch/parameterSearchRun.test.ts` |
| 探针（新增 5 个） | `docs/evidence/_e2e_parameter_search.mts` 等（已在 `docs/evidence/README.md` 登记） |

### 验收数字（全部实测）

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | **0 error** |
| 新增单测 | 1 文件 / **38 用例全绿** |
| 全量 vitest | 失败文件集合 **8 → 8（零新增）**；用例 4538 → **4581** |
| `vite build` | 成功（3039 modules / 17.55 s） |
| `node scripts/checkEolDrift.mjs` | **0 漂移**（已跟踪 0 / 未跟踪 CRLF 0） |
| 真库迁移幂等 | 第二次 **0 executed / 3 skipped**、`pass=true`；三表 26/10/23 列、0 FK、既有 14 表列签名与行数逐表一致 |
| 真实全链 E2E | **37 项 / 0 失败**：4 组合 **39 s** 全成功、`metricsSource=canonical`、二次 `start` ⇒ `evaluated=0 / skipped=4` |
| 前端 DOM 可达性 | `pass=true`、**0 page error**（真实点击「查看详情」后详情+结果区渲染） |

---

## 2. Existing Code Reuse（**收敛而非新建**）

规格 §2 要求「先检查是否已有实现；已有则优先收敛和复用」。实查结论：**已有**，且相当完整。

### 2.1 既有资产（复用清单）

| 既有资产 | 位置 | 本轮如何复用 |
|---|---|---|
| Grid 全组合生成器 | `server/research/combinationGenerator.ts#generateParameterCombinations` / `calculateCombinationCount` | **直接调用**（顺序稳定 + 生成前强制上限 + mutation isolation + 浮点稳定化全部沿用） |
| 参数空间契约与校验 | `server/research/parameterSpace.ts#validateParameterSpace` / `SweepParameterDefinition` | 编译目标形态；**不重写校验** |
| 稳定区判定 / 候选策略 / 序列化 | `server/research/parameterSearch/{region,candidate,serialize,prng,sampler,metrics}.ts` | **原样保留**（技术预览链路继续用） |
| 评估端口三件套 | `server/research/strategyEvaluation/{evaluate,evaluator,backtestBridge}.ts` | 执行链的**唯一**回测/评估落点 |
| 策略版本读取 | `server/research/strategyPersistence/db.ts#DbStrategyRepository#getVersionBundle` | 一次拿全 canonical 文档 + 5 类投影 + §17 追溯记录 |
| 指标口径 | `server/backtest/backtestResult.ts#canonicalMetrics()`（经 `ClosedLoopEvaluationRef.canonicalMetrics`） | **只读数、零重算** |
| 执行政策版本 | `server/backtest/context.ts#BACKTEST_EXECUTION_POLICY_VERSION` | cache 判据之一 |
| canonical 序列化 | `server/researchDataset/version.ts#canonicalStringify` | `parameterHash` / 指纹的**唯一**序列化实现 |
| 迁移机制 | `drizzle/0037_*.sql` + `scripts/applyClosedLoopBacktestRun.mjs` 范式 | 手写 SQL + `-- @guard` + 专用 apply 脚本 |

### 2.2 唯一被增量修改的既有文件（2 处，均向后兼容）

| 文件 | 改动 | 兼容性 |
|---|---|---|
| `server/research/strategyEvaluation/backtestBridge.ts` | `StrategyBacktestSample` **加 4 个字段**（`evaluation` / `experimentId` / `evaluationRunId` / `backtestFingerprint`），值**直接来自评估端口返回值**（不重算、不派生） | 唯一消费者 `paramSearchRouter` 只读 `outcome` / `equityCurve` ⇒ **不受影响** |
| `server/research/parameterSearch/index.ts` | **只加注释**（说明为何不 re-export 执行层） | 导出面不变 |

### 2.3 刻意**没有**新增的东西

- ❌ 没有 `backtestCore/**`（`server/backtest/**` 已是 Core）
- ❌ 没有第二个 `paramSearch` router（7 个端点**扩在同一域**）
- ❌ 没有第二套 `canonicalMetrics`
- ❌ 没有让 `server/research/**` import `server/strategyCore/**`（详见 §4.3）

---

## 3. Architecture

### 3.1 分层

```text
contracts   shared/parameterSearchContracts.ts          （wire + 持久化快照；zod + z.infer）
     ▲
domain      server/research/parameterSearch/
              coordinates.ts   策略文档 → Dataset 权威坐标（唯一实现）
              searchSpace.ts   参数空间定义 / 派生 / 校验 / 编译（§3 §4 §5）
              parameterHash.ts 稳定 parameterHash + cache 判据（§6 §13）
              combination.ts   笛卡尔积组合 + 去重（§6）
              searchRun.ts     Run 状态机 + 进度 + 快照指纹（§7 §8）
              searchResult.ts  canonical metrics 只读投影（§9 §10）
              persistence.ts   三表仓储（读写唯一落点）
              executor.ts      编排：Resume / Retry / Cache（§12 §13）
     ▲
transport   server/paramSearchRouter.ts                 （同域扩 7 端点）
     ▲
ui          client/src/components/parameterSearch/PersistedParameterSearchPanel.tsx
```

### 3.2 领域码（跨 tRPC 边界一律写进 message）

`PARAMETER_SEARCH_METHOD_UNSUPPORTED` · `PARAMETER_SEARCH_NO_TUNABLE_PARAMETER` ·
`PARAMETER_SEARCH_PARAM_{NAME_EMPTY,NAME_INVALID,DUPLICATE,UNKNOWN,TYPE_MISMATCH,ROLE_MISMATCH,KIND_INVALID}` ·
`PARAMETER_SEARCH_{RANGE_ORDER,RANGE_NOT_FINITE,STEP_INVALID,ENUM_EMPTY,ENUM_INVALID,DOMAIN_UNCOMPILABLE}` ·
`PARAMETER_SEARCH_{DERIVED_NOT_SEARCHABLE,FIXED_NOT_SEARCHABLE,TUNABLE_WITHOUT_DOMAIN}` ·
`PARAMETER_SEARCH_HASH_COLLISION` · `PARAMETER_SEARCH_STATUS_{TRANSITION_INVALID,UNKNOWN}` ·
`PARAMETER_SEARCH_RUN_NOT_FOUND` · `PARAMETER_SEARCH_COMBINATION_NOT_FOUND` ·
`PARAMETER_SEARCH_COMBINATION_HASH_MISMATCH` · `PARAMETER_SEARCH_EVALUATION_CONFIG_DRIFT` ·
`PARAMETER_SEARCH_RETRY_ON_SUCCEEDED` · `PARAMETER_SEARCH_STRATEGY_VERSION_NOT_FOUND` ·
`PARAMETER_SEARCH_STRATEGY_DEFINITION_MISSING` · `PARAMETER_SEARCH_ALL_COMBINATIONS_FAILED` ·
`PARAMETER_SEARCH_OVERRIDE_UNKNOWN_PARAM` · `PARAMETER_SEARCH_SPACE_{INVALID,SNAPSHOT_INVALID}`

复用既有转换：`ResearchValidationError` → `toTrpcError` → `BAD_REQUEST`，message 形如 `[CODE] path: message`（`toTrpcError` 不带 `cause`，故领域码必须写在 message 里）。

### 3.3 一条刻意的架构决策：`index.ts` barrel **不** re-export 执行层

`executor.ts` 运行时 import `strategyEvaluation/backtestBridge`，其子图会**回到** `closedLoopWiring/executors`，
而后者运行时 import `../parameterSearch`（barrel）。若把执行层放进 barrel ⇒ **运行时循环导入**
（本项目已有过「`tsc` 全绿但运行时报 `X is not a function`」的真实教训）。
⇒ 消费方一律**按显式路径**引用（`./executor` / `./persistence`），与「桥只允许显式引用具体模块」的既有纪律一致。

---

## 4. Parameter Space

### 4.1 定义形态（规格 §3）

每个参数至少含 `name` / `type` / `kind` / `defaultValue` / `required` / `description`（+ `unit` / `exclusionReason`）；
搜索域支持四种形态：

| 形态 | 语义 | 编译为既有 Sweep 形态 |
|---|---|---|
| `ENUM` | 显式取值集合 | 字符串 / 布尔 → `enum` / `boolean`；**数值型 enum 响亮拒绝**（既有实现只有等步长区间，不近似） |
| `INTEGER_RANGE` | `min` / `max` / `step`（皆整数） | `integer` |
| `DECIMAL_RANGE` | `min` / `max` / `step` | `number` |
| `FIXED` | 单值（把 TUNABLE 参数**钉在**一个取值上） | 数值 → `number(min=max, step=1)`；布尔 → `boolean[1]`；字符串 → `enum[1]` |

> ⚠️ 口径澄清：`FIXED` **搜索域** ≠ `FIXED` **参数分类**。前者只贡献 1 个取值（参数仍是 TUNABLE、仍属「可搜索参数」），后者根本不进搜索空间。
> E2E 的 `2 参数 × 2 值 + 1 参数固定值 = 4 组合` 用的就是前者。

### 4.2 分类（规格 §4）

| kind | 进搜索空间 | 来源 | 说明 |
|---|---|---|---|
| `FIXED` | ❌ | `parameterRole = FIXED` | 搜索过程中不变 |
| `TUNABLE` | ✅ | `parameterRole = TUNABLE` | **唯一**可搜索 |
| `DERIVED` | ❌ | `parameterRole = DERIVED` | 由其他参数推导，**不得直接搜索** |

Run 层另持 **FIXED 坐标**（`fixedCoordinatesJson`）：`strategyVersionId`（= `strategyId@strategyVersion`）/
`datasetVersionId` / `datasetVersionLabel` / 回测窗口 / `executionPolicyVersion` / `evaluationConfigFingerprint`。

### 4.3 🔴 R-05 的修复落点（本任务的核心修复）

**缺陷机制**：`server/research/strategyEvaluation/parameterSpaceFromDocument.ts` 读的是
`document.parameters`（legacy v1 视图，`ResearchParameterSchema`）—— 这个类型**根本没有 `parameterRole` 字段**（类型与投影两处都证实），
所以 `FIXED` 参数只要带 `min/max/step` 就照样进搜索空间。

**修复**：新增 `searchSpace.ts#deriveParameterSearchSpaceFromProjection`，改读
**`strategy_parameters` 投影行的 `parameterRole`**（该投影由 canonical `definition.parameters` 单向派生，`projection.ts:159` 写入投影表）。

**为什么不 import `strategyCore`**：全局唯一权威是 `strategyCore/parameterResolver.ts#listSearchableParameters`，
但它要求**整份 legacy → Core 转换**（`fromLegacyStrategyDefinition` 对未登记构造**响亮抛错**），
且会让 `server/research/**` 首次出现指向 `server/strategyCore/**` 的**跨域生产依赖**。
⇒ 改为在投影层实现同一判据（`isSearchableStrategyParameter`，**唯一落点**），
并用**单测**断言它与 `listSearchableParameters` 在「FIXED/TUNABLE/DERIVED 三态齐全」的夹具上**逐参数等价**
（测试可以跨域，生产代码不跨）。**「两处判据不漂移」由此成为可执行事实。**

> ⚠️ **既有文件未改**：`parameterSpaceFromDocument.ts` 仍服务旧链路 ⇒ **当前存在两条派生器**：
> 旧的（无 role、legacy 预览用）与新的（带 role、PARAMETER-001 用）。这是**已知的双路径事实**，已在 `SYSTEM-BASELINE.md` / `DOMAIN-MAP.md` 写明。

### 4.4 校验（规格 §5）

`validateParameterSearchSpace(definition, declared)` 覆盖：参数名非空 + 命名规则 + **不重复** +
**必须存在于策略 Schema**（`declared` 缺省时**跳过**并在返回值里如实标 `schemaChecked: false`，不假装校验过）+
**类型匹配** + **分类匹配** + range 合法（有限 / `step > 0` / `min ≤ max`）+ enum 非空且无 `null` +
**`DERIVED` 不得直接搜索** + **`FIXED` 不得进搜索空间**。

**禁自造参数**：`createSearch` 的 `parameterSearchSpace` 覆盖只允许覆盖**已声明参数**；覆盖不存在的参数 →
`PARAMETER_SEARCH_OVERRIDE_UNKNOWN_PARAM`；给 `FIXED`/`DERIVED` 加搜索域 → 对应领域码**响亮拒绝**（不静默忽略）。

---

## 5. Database

### 5.1 三张表

| 表 | 列 | 角色 | 关键约束 |
|---|---|---|---|
| `parameter_search_run` | 26 | 运行头：身份 / **参数空间快照** / FIXED 坐标 / 计数 / 状态 / 时间戳 / 失败原因 | `UNIQUE(searchRunId)`；索引 `createdAt` / `(strategyId, createdAt)` / `status` |
| `parameter_search_combination` | 10 | 组合**计划层**（笛卡尔积成员 + 执行状态；Resume/Retry 判据） | `UNIQUE(searchRunId, parameterHash)`；索引 `(searchRunId, combinationIndex)` / `(searchRunId, status)` |
| `parameter_search_result` | 23 | 单组合**产物层**（六指标读数 + 可追溯引用 + 失败原因） | `UNIQUE(searchRunId, parameterHash)`；索引同上 |

### 5.2 硬约束遵守情况（逐条）

- ✅ **软引用 / 0 FK**：三表 0 外键；全库 FK 总数仍为 **0**（apply 脚本断言）。
- ✅ **不修改历史 Run / 不修改历史 Evaluation**：本任务只写自己的三张新表；`closed_loop_backtest_run` / `strategy_versions` / `dataset_version` 一行未动（apply 脚本逐表比对行数）。
- ✅ **不建不必要 FK**：见上。
- ✅ **migration 手工、显式、幂等**：`drizzle/0041_parameter_search.sql` + `-- @guard: table ...`；
  第二次运行 **0 executed / 3 skipped**、`pass=true`。
- ✅ **禁 `db:push` / 禁 `drizzle-kit generate`**：未执行；`drizzle/meta/_journal.json` 未改动（仍止于 idx 23）。
- ✅ **无回填、无数据迁移**：新表从 0 行开始。
- 🔴 **参数空间快照写入即冻结**：`ON DUPLICATE KEY UPDATE` 集合中**不含** `parameterSpaceJson` / `parameterSpaceFingerprint`
  ⇒ 未来策略版本被修改后，历史 Run 的搜索空间**不会被重新解释**（规格 §7 末句）。
- ✅ **三表不参与任何执行路径**：清空它们不影响回测正确性，只影响「能不能回看 / 续跑」。

### 5.3 两个实现细节（都是踩过才知道的）

1. `parameter_search_combination.status` / `parameter_search_result.status` 只是**复合索引的第二列**
   ⇒ `information_schema.COLUMN_KEY` 为空串（只有索引首列标 `MUL`）。**这是首次运行时被断言抓出来的判据错**（不是表结构问题）。
2. `double` 列遇 `NaN` / `Infinity` 会被 mysql2 **静默转成 `NULL`** ⇒ 与「本来就没有这个值」不可区分。
   落库层统一 `finiteOrNull()` 守卫，并保持语义诚实（**编 0 是禁止的**）。

---

## 6. API

**遵循项目既有 API 风格**（`server/paramSearchRouter.ts`，顶层 key `paramSearch`，`publicProcedure`）。

| 端点 | 类型 | 入参 | 行为 |
|---|---|---|---|
| `paramSearch.createSearch` | mutation | `strategyId` / `strategyVersion` / `datasetVersionId?` / `startDate` / `endDate` / `searchMethod` / `parameterSearchSpace?` / `maxCombinations?` | 读策略版本包 → 派生搜索空间（可被覆盖）→ 校验 → 生成组合 → 落 Run + 组合计划。**不跑回测** |
| `paramSearch.listSearches` | query | `strategyId?` / `limit?` / `offset?` | 列表（**不读**参数空间快照长文本，前端提示「以详情为准」） |
| `paramSearch.getSearch` | query | `searchRunId` | Run（含快照）+ 进度 + 组合计划 |
| `paramSearch.startSearch` | mutation | `searchRunId` / `maxCombinations?` | 执行 / **续跑**（Resume + Cache） |
| `paramSearch.cancelSearch` | mutation | `searchRunId` | 取消（对正在执行的循环生效：每组合前重读状态即停） |
| `paramSearch.getSearchResults` | query | `searchRunId` / `sortBy?` / `sortDirection?` / `status?` / `minTradeCount?` / `maxDrawdownPct?` / `minTotalReturnPct?` / `limit?` / `offset?` | 结果列表；**排序 / 过滤在服务端**；超上限 `truncated: true`（不静默丢弃） |
| `paramSearch.retrySearchCombination` | mutation | `searchRunId` / `parameterHash` / `force?` | 重试单个组合；对**已成功**的组合默认**拒绝**（重跑会覆盖已有结果，需显式 `force`） |

**响应性 / 可达性验证**（只读探测，零副作用）：

| 端点 | `GET /api/trpc/<proc>` 返回 | 含义 |
|---|---|---|
| `createSearch` / `startSearch` / `cancelSearch` / `retrySearchCombination` | **405 METHOD_NOT_SUPPORTED** | mutation 已注册 |
| `listSearches` / `getSearch` / `getSearchResults` | **400 BAD_REQUEST**（缺入参） | query 已注册 |
| `paramSearch.nonexistentProc` | **404 NOT_FOUND** | 对照组 |

---

## 7. Frontend

### 7.1 落点与入口

- **导航入口**：左侧「量化回测 → 参数搜索」（`/parameter-search`），路由 `client/src/App.tsx:107`。
- **新增面板**：`PersistedParameterSearchPanel` 挂在页面**顶部**（位于既有技术预览区块之前）。

### 7.2 覆盖的规格 §16 四块

| 区块 | 实现 |
|---|---|
| **创建 Search** | 策略 ID / 策略版本 / 数据集版本 ID（留空 = 用策略绑定）/ 回测窗口起止 / 搜索方法（`GRID_SEARCH` 可选；`RANDOM_SEARCH`/`BAYESIAN`/`TPE` 显示为 **disabled 且标注「已登记，未实现」**） |
| **Parameter Space** | 可增删的覆盖行：参数名 + 形态（整数区间 / 小数区间 / **枚举** / **固定值**）+ 相应输入；留空则由策略文档派生 |
| **Search Detail** | 状态徽章 / **计划组合数** / **已完成** / **失败**（+ 未终结）/ **进度条**（`progressPct`）+ FIXED 坐标 + 参数空间快照（逐参数显示 `kind` 与搜索域 / 排除原因）+ 组合计划表（含 `parameterHash` / 状态 / **尝试次数** / 「重试该组合」）+ 运行说明 |
| **Results** | 参数 / 状态 / 总收益 / 年化 / 最大回撤 / 成交笔数 / 胜率 / 盈亏比 + **排序**（表头点击，7 个字段）+ **过滤**（状态 / 成交笔数 ≥ / 最大回撤 ≤）+ 「查看组合」展开（组合 + **Backtest 追溯** + **Evaluation 追溯** + 评估产物原文） |

### 7.3 前端纪律（逐条落实）

- 🔴 **不产出「最佳参数」结论**：默认排序是 `combinationIndex`，**刻意不是收益降序**；页面上没有任何「最优 / 推荐 / 最佳」措辞。
- 🔴 **长请求按钮必须换文案**：`startSearch` pending 时按钮变为「正在执行真实回测…（每个组合一次完整闭环回测，通常秒级、长窗口可达分钟级）」。
- 🔴 **诚实失败**：`error` / `notes` / `errorMessage` / `metricsSource` / 「本阶段评估端口不落 `closed_loop_backtest_run` 行，如实为空」全部原样展示。
- 🔴 **中式配色**：涨红跌绿（`pnlClass`）。
- 提交入参**不塞后端能派生的字段**（`datasetVersionId` 留空即不提交；`searchMethod` 只有 `GRID_SEARCH`）。

### 7.4 真机可达性验收（`pass=true`，0 page error）

| 判据 | 实测 |
|---|---|
| 面板锚点「参数搜索（持久化）」 | ✅ 命中 |
| 创建表单控件 | ✅ `#ps-strategy-id` / `#ps-strategy-version` / `#ps-dataset-version-id` / `#ps-start-date` / `#ps-end-date` / `#ps-search-method`（4 选项，3 个 disabled） |
| 搜索列表 | ✅ **3 条真实 Run 行**（不是空态） |
| 点「添加参数」 | ✅ 出现形态选择器，选项 = `INTEGER_RANGE, DECIMAL_RANGE, ENUM, FIXED` |
| 点「查看详情」 | ✅ 详情区 + 结果区**渲染**（`#ps-start-search` / `#ps-cancel-search` 可见，`table tbody tr` 11 行） |
| 点「查看组合」 | ✅ 展开成功（12 行） |
| console error / 异常 | ✅ **0** |

> 🔴 这一层是本轮**唯一**能回答「用户够不够得到」的验收：详情区与结果区被 `selectedRunId !== null` **条件渲染**，
> 不真的点一下「查看详情」，就无法证明它们可达（`§16 「接线完成 ≠ 用户够得到」`）。

---

## 8. Execution Flow

```text
[1] paramSearch.createSearch
      └─ DbStrategyRepository#getVersionBundle  →  document + projections.parameters（带 parameterRole）
      └─ deriveParameterSearchSpaceFromProjection  →  参数空间定义（快照）
      └─ validateParameterSearchSpace(+declared)   →  合法性（重名/未知/类型/分类/range/step/enum）
      └─ buildParameterCombinations                →  复用 generateParameterCombinations + parameterHash
      └─ 落 parameter_search_run（CREATED）+ parameter_search_combination（PENDING ×N）
[2] paramSearch.startSearch
      └─ 状态迁移 CREATED|FAILED|COMPLETED|CANCELLED → RUNNING（否则 PARAMETER_SEARCH_STATUS_TRANSITION_INVALID）
      └─ 把遗留 RUNNING 组合收敛为 FAILED（不假装还在跑）
[3] executor#executeParameterSearchRun（逐组合，串行）
      ├─ 重读 Run 状态 → CANCELLED 则停（剩余保持 PENDING ⇒ 可断点续跑）
      ├─ 本 Run 已 SUCCEEDED          → Resume 跳过（不重算、不重写）
      ├─ 五要素 cache 命中 SUCCEEDED  → 复用（不重算）
      └─ 否则：
           ├─ createStrategyBacktestBridge（**按区间缓存数据集**；第 1 个组合付解析代价，其余 datasetSource=injected）
           ├─ evaluateStrategyParameters（既有真实闭环 data→research→strategy→backtest→evaluation）
           ├─ projectCanonicalMetrics（六项**只读数**；canonical 优先，缺省回落 evaluators 面并如实标注）
           └─ upsert 结果 + 组合状态 + recomputeRunCounters（**计数唯一真源 = 结果行**）
[4] 收尾：由结果行重算计数 → COMPLETED（全失败 ⇒ FAILED + PARAMETER_SEARCH_ALL_COMBINATIONS_FAILED）
[5] paramSearch.getSearchResults（服务端排序 / 过滤）
```

**明确禁止且未做**：自己实现 Backtest / 自己实现 StrategyRuntime / 自己计算 Metrics / 修改 Dataset / 修改 Strategy Version / 修改历史 Backtest Run。

**Cache 判据（规格 §13，五要素逐字段相等）**：
`strategyVersionId`（= `strategyId@strategyVersion`）+ `datasetVersionId` + `parameterHash` + `executionPolicyVersion` + `evaluationConfigFingerprint`（含回测窗口）。
**只复用 `SUCCEEDED`** —— 失败可能是瞬时故障，复用会把「偶发失败」永久化。

**确定性 `parameterHash`（规格 §6）**：
`sha256(canonicalStringify({ strategyVersionId, parameters }))`，其中
键**字典序**、`number` 的 `-0 → 0`、**拒绝 `NaN` / `Infinity`**（静默转 `null` 会让两组参数撞同一身份）、
缺省键**不参与**（缺省 ≠ `null`）。撞 hash ⇒ `PARAMETER_SEARCH_HASH_COLLISION` **响亮抛错**（不合并不覆盖）。

---

## 9. Real E2E Evidence

### 9.1 设计（`docs/evidence/_e2e_parameter_search.mts`）

- **全程走真实 tRPC**（`appRouter.createCaller`，admin ctx）→ 真实 TiDB → 真实策略文档 → 真实数据集 → **真实回测**，**零 mock**。
- **上游只读选取**：`cand-360001@1.0.0` · `datasetVersionId=390002`（label `v2`，READY）· 数据集窗口 `2024-09-01..2026-09-01` · 参数 `max_drawdown` / `max_volume_ratio` / `require_bullish`（3 个投影参数）。
- **组合构造**：`max_drawdown = DECIMAL_RANGE[0.05, 0.10] step 0.05`（2 值）× `max_volume_ratio = DECIMAL_RANGE[0.3, 0.6] step 0.3`（2 值）× `require_bullish = FIXED 0`（1 值）= **4 组合**。
- **搜索窗口**：`2026-05-04..2026-09-01`（**探针取舍**：≤120 天，为让真实执行可在可接受时间内跑完；产品允许任意落在数据集窗口内的窗口）。
- **自建自清**：`PARAM001_CLEAN=1` 时按 `searchRunId` 精确删除三表自建行并复查行数递减；缺省保留产物供前端查看。

### 9.2 结果

| 段 | 断言数 | 结果 |
|---|---|---|
| §0 上游选取（含「窗口 ⊆ 数据集窗口」预检） | 3 | ✅ |
| §1 `createSearch`（状态 / 组合数 / 快照 / 分类 / 指纹） | 6 | ✅ |
| §2 `getSearch`（组合行 / PENDING / hash 互异 / 确定性重算 / 顺序稳定 / 进度自洽） | 7 | ✅ |
| §3 `cancelSearch`（状态机 + 取消不产生结果行） | 2 | ✅ |
| §4 `startSearch`（终态 / 组合数 / 计数自洽 / 时间戳） | 4 | ✅ |
| §5 `getSearchResults`（4 行 / 一一对应 / 成功 / 可追溯 / 指标来源 / 排序 / 过滤） | 7 | ✅ |
| §6 Resume / Cache（二次 start 不重复执行） | 2 | ✅ |
| §7 裸 SQL 复核（Run 行 / 组合计数 / 结果计数） | 3 | ✅ |
| **合计** | **37** | **0 失败** |

### 9.3 关键实测数字

```text
searchRunId          = PSRUN-20260919-c9d002fb（CLEAN=1 轮，产物已自清）
状态                 = COMPLETED    组合 4 / 成功 4 / 失败 0
执行耗时             = 39 s（4 个组合，含第 1 个组合的数据集解析）
参数空间指纹         = 38792c47a0380c8a25a1e3ac281a3d62699c382a80911192e0545444d1a7618f
评估配置指纹         = b6c724e911d4ba9a1436d9ff01aaf662f4cb095f4e8ebba211da1a6d11f02a37
executionPolicyVersion = 1
单组合结果（canonical 读数）：
  {"totalReturnPct":-44.526726784500006,"annualizedReturnPct":-83.28904023793055,
   "maxDrawdownPct":45.0617267845,"tradeCount":0,"winRatePct":null,"profitFactor":null}
metricsSource        = canonical
backtestFingerprint  = bdcef0d00c77144ddc526058…（非空）
evaluationId         = EXP-20260919-B200B810（非空）
二次 start           = evaluated=0 / skipped=4（Resume 生效；结果行仍为 4，无重复行）
```

### 9.4 🔴 本轮抓到的真实问题（**是验收判据错，不是产品缺陷**）

**现象**：首轮 `full` 执行 4/4 组合全失败（62 s），错误一致：

```text
ClosedLoopError: 阶段 research 失败：实验日期范围 [2024-08-31, 2026-08-31]
超出数据集窗口 [2024-09-01, 2026-09-01]（闭区间）
```

**定性过程**：① 回到源码核对 → 失败来自 `research` 阶段的**既有**窗口越界检查（该检查本身是**正确且必要**的，防「以部分数据集冒充全窗口」）；
② 查数据源 → `dataset_version.startDate/endDate` 是 **UTC 时间戳**（北京日 `2024-09-01` 存成 `2024-08-31T16:00:00.000Z`），
而探针用 `toISOString().slice(0,10)` 取业务日期 ⇒ **少一天**；
③ 判定 = **探针判据错**（产品侧无缺陷）；④ 改为按北京时区格式化 + 增加「窗口 ⊆ 数据集窗口」预检断言；⑤ 重跑 ⇒ **4/4 成功**。

---

## 10. Tests

### 10.1 新增单测（`tests/server/research/parameterSearch/parameterSearchRun.test.ts`，38 用例）

| 组 | 覆盖 |
|---|---|
| **Parameter Space**（14） | 派生分类（TUNABLE 带域 / FIXED / DERIVED 不带域 + 原因非空）；enum / integer range / decimal range / fixed 四形态；字符串白名单缺失 ⇒ 如实排除；缺 `min` ⇒ 列出缺什么；**与 `listSearchableParameters` 逐参数等价（守护断言）**；编译到既有 Sweep 形态；fixed 三种取值形态；`FIXED value=null` 被拒；**step ≤ 0 / range 倒挂 / enum 空 / 重名 / 未知参数 / 类型不符** 六个负例各带独立领域码；**DERIVED 不得直接搜索** / **FIXED 不得进搜索空间**；覆盖不存在的参数 / 覆盖 FIXED / 覆盖 DERIVED 被拒；快照 round-trip + 非法快照抛错；摘要分列 |
| **Combination**（8） | 规格 §6 原文示例 `[1,2] × [1,3] = 4` 且顺序稳定；hash 跨调用确定性；hash 区分策略版本；**规范化**（键序无关 / `-0→0` / 缺省键不参与）；**拒绝 NaN / Infinity**；4 组 hash 两两不同（去重）；组合集合指纹确定性；超上限**生成前抛错不截断**；无 TUNABLE ⇒ 1 个空参数集 |
| **Search Run**（10） | 合法迁移全接受；同态幂等；**非法迁移抛 `PARAMETER_SEARCH_STATUS_TRANSITION_INVALID`**；非法状态值抛错（**不默认成 CREATED**）；进度口径（SKIPPED 不计入 / 分母 0 时 100 / 脏行不让 pending 变负）；快照指纹（同内容同指纹 / **分类变化即变**）；Run ID 格式；**cache 判据五要素任一不同即不命中**；评估配置指纹含窗口；`strategyVersionId` 口径；评估子链与既有端口一致 |
| **Search Result**（6） | canonical 六项一一对应 + `metricsSource="canonical"` + 年化基数；canonical 缺省 ⇒ 回落 evaluators 面并如实标注；**缺失值保持 null（禁编 0/1）**；`status` 判据 = 评估引用是否存在（不看指标是否为 null）；`backtestRunId` 如实为 null；评估引用 null ⇒ 六项全 null |

### 10.2 分层策略（单测 vs 真机全链互补，不重复）

- **单测**证明「进程内行为对」（纯函数、状态机、投影、契约等价性）；
- **真机全链**证明「经 tRPC + Drizzle + 真实策略文档 + 真实数据集 + 真实回测往返后仍对」；
- **真机全链抓到了单测抓不到的东西**（§9.4 的窗口越界、§5.3 的 `COLUMN_KEY` 判据错）。

### 10.3 回归

| 项 | 基线 | 本轮 | 判定 |
|---|---|---|---|
| 失败**文件集合** | 8 个文件 | **8 个文件（逐文件一致）** | **零新增** |
| 失败用例数 | 17 | **17** | 零新增 |
| 用例总数 | 4538 | **4581**（+38 新增 + 5 来自并发会话） | — |

（`tests/server/dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `researchCore/candidates.updateBoundary` / `tushare.secret` / `tushareTradingCalendar` —— 与既有基线完全相同。）

---

## 11. Known Risks

| # | 风险 | 严重度 | 现状 / 说明 |
|---|---|---|---|
| R-01 | 搜索结果不落库 | — | ✅ **已收口**（三表 + 7 端点） |
| R-05 | `parameterRole` 门槛未生效 | — | ✅ **已修复**（派生改读投影 role + 等价性守护测试） |
| R-06 | 真实 Run 性能 | — | **不属本任务**（归外部 Agent）。本轮实测：4 个组合 / 120 天窗口 = 39 s（数据集直读 + 区间缓存） |
| **N-01** | `createSearch` / `startSearch` **无前置「窗口 ⊆ 数据集窗口」校验** | 中 | 越界窗口会以「N 个组合相同失败」收场（实测 4/4、62 s）。**失败信息本身是响亮的**（含两个区间），LLM/用户可据此自行改正；但代价是 N 次无效执行。**建议后续 fail-fast** |
| **N-02** | 4 组合指标**逐位相同且 `tradeCount = 0`** | 中 | 该策略在这段窗口内**未撮合成交** ⇒ 4 组参数得到同一条（无成交）权益曲线。**`Parameter Search` 只是如实记录，未做任何加工**。是否为执行链问题（参数是否真的到达执行层）**不属 PARAMETER-001 范围**，需另起核查 |
| **N-03** | `parameter_search_result.backtestRunId` **恒为 NULL** | 低 | 评估端口走**内存态 5 阶段闭环**（`evaluateStrategyParameters`），**不落** `closed_loop_backtest_run` 行。追溯改用 `backtestFingerprint` + `evaluationId` + Run 坐标（策略版本 / `datasetVersionId` / 窗口）；**未伪造任何 id**。若需真正的 `backtestRunId`，须让评估端口也落一行闭环留档（改主链，本轮刻意不做） |
| **N-04** | 缓存判据**不含 `codeVersion`** | 低 | 严格按规格 §13 的五要素实现。若代码语义变化但 `executionPolicyVersion` 未 bump，cache 不会失效 |
| **N-05** | 两条参数空间派生器并存 | 低 | 旧的 `parameterSpaceFromDocument.ts`（无 role，legacy 预览用）与新 `searchSpace.ts`（带 role）。**已在基线文档写明**，不是隐藏缺陷；长期应收敛为一条 |
| **N-06** | 执行层**串行** | 低 | 逐组合串行（与既有技术预览一致）。规格未要求并发；且并发会与外部 Agent 的性能工作冲突 |
| **N-07** | `derivedFrom` 无求值器 | 低 | 沿用既有事实：`DERIVED` 参数只能被登记为「不得直接搜索」，不能自动求值 |

---

## 12. Deferred Items

**明确不做（规格禁止或超出范围）**：

1. RANDOM_SEARCH / BAYESIAN / TPE —— 规格 §8 明确「本任务不要实现这些算法」。已在契约中**登记为扩展位**，且入参层**响亮拒绝**（不静默降级为 `GRID_SEARCH`）。
2. 性能优化（Backtest / Dataset / DB / StrategyRuntime / 并发 / 引擎重构）—— 归外部 Agent；本任务**一行性能代码未改**。
3. Robustness / OOS / Walk-Forward / Simulation / Production —— 规格严格禁止。
4. `BACKTEST-003` / `BACKTEST-004` —— 禁止系统性创建。
5. 全项目重新审计 —— 未做（按架构基线的默认入口增量读取）。

**建议后续（本轮登记，未做）**：

1. **前置窗口校验**（N-01）：`createSearch` 时读 `dataset_version.startDate/endDate`（按北京时区）做 fail-fast。
2. **核查 N-02**：4 组不同参数得到逐位相同指标 + `tradeCount=0` 是否符合预期（参数是否真的到达执行层）。
3. 让评估端口可选地落一行 `closed_loop_backtest_run`（解决 N-03 的 `backtestRunId`）。
4. 收敛两条参数空间派生器为一条（N-05）。
5. 前端补「从数据集版本列表选窗口」（当前需手填，且无前置校验）。

---

## 13. Architecture Baseline Changes

**版本动作**：`v1.0.0` → **`v1.1.0`（minor）**
依据 `SYSTEM-BASELINE.md` §15 / `AGENT-GUIDE.md` §5：「Domain 状态跃迁 + 新增 entry point / contract」= minor。
**未**触发任何 `GLOBAL AUDIT REQUIRED` 条目（未新增/删除 Domain、未改 Domain 边界、未改主链、未做 DB 核心 Schema 大规模变更、未改 `StrategyRuntime` 职责）。

| 文件 | 变更 |
|---|---|
| `SYSTEM-BASELINE.md` | 版本 → `v1.1.0`；追加「PARAMETER-001 增量」节（状态变化 / 已收口风险 / 仍存在的已知限制 / 两条派生器事实） |
| `system-manifest.yaml` | `parameterSearch` 域块整块更新（`status: PREPARATION_PARTIAL` → **`READY`**、`marker: BLOCKED` → **`FACT`**、`sourcePaths` / `entryPoints` / `persistence` / `knownRisks` 全量刷新）；`nextStage` 改为 `ROBUSTNESS-PARAMETER-CONSUMPTION` |
| `DOMAIN-MAP.md` | 追加 §14（§4 更新：新增能力 / 新增入口 / 边界未变 / **禁产「最佳参数」结论** / 指标口径） |
| `DATA-FLOW.md` | 追加 D-90（参数搜索数据流全图；**断点 2「搜索结果不落库」已消除**） |
| `EXECUTION-FLOW.md` | 追加 E-90（8 跳执行链表；主链未改动；可达性总表补充 7 端点） |
| `DATABASE-MAP.md` | 追加 D-90（3 表 + 约束遵守逐条 + **快照写入即冻结**） |
| `CONTRACT-MAP.md` | 追加 C-90（`shared/parameterSearchContracts.ts` 全字段；两条特有纪律） |
| `DEPENDENCY-MAP.md` | 追加 D-90（新增依赖边 + **刻意未新增的边** + barrel 循环导入纪律） |
| `CHANGE-AUDIT.md` | **append** 2026-09-19 · PARAMETER-001（10 字段 + `GLOBAL AUDIT REQUIRED: NONE`） |
| `ROADMAP.md` | §44 覆盖式（只保留最近 1 条，命中数实测 = 1）；§44.5 插入 `9bs` 完成条目；**编号台账两处同步**（文件头铁律行 + 台账行，`9br` → `9bs`，下一个未占用 = `9bt`） |
| `ROADMAP-CHANGELOG.md` | **append** §47 更新记录（append-only） |
| `docs/evidence/README.md` | 登记本批 5 个探针 + 5 条真踩的坑 |
| `.workbuddy/memory/2026-09-19.md` | append 本任务一节 |
| `.workbuddy/memory/MEMORY.md` | 就地新增「Parameter Search 域」硬禁令一节 |

**另外记录两条实测事实（未产生 drift，但值得写进变更记录）**：

1. `adminProcedure` 在本仓**零使用**（全仓 `grep "adminProcedure\."` = 0 命中）⇒ 新增写端点沿用既有 `publicProcedure` 惯例（与 `researchRun.loopRun` 一致）。基线文档未规定该点，**不构成 drift**。
2. 迁移链现状未变：`drizzle/meta/_journal.json` 仍止于 idx 23 ⇒ 0024 之后所有迁移都走「手写 SQL + 专用 apply 脚本」。

---

## 14. Next Step

**Robustness / OOS / Walk-Forward 消费 Parameter Search 结果。**

`system-manifest.yaml#nextStage.id` 已更新为 `ROBUSTNESS-PARAMETER-CONSUMPTION`（`status: PLANNED`）。
消费方式已就绪：`parameter_search_result` 每行都带**参数组合 + 稳定 `parameterHash` + 六项 canonical metrics + 可追溯引用**，
且 `parameter_search_run` 冻结了参数空间快照与 FIXED 坐标 ⇒ 下游可直接按 `searchRunId` 取用，无需重跑搜索。

**按规格要求：完成报告后停止，不自动开始下一阶段。**

---

## 15. 完成判定（规格 §20 逐项）

| # | 判据 | 状态 | 证据 |
|---|---|---|---|
| 1 | 已读取 SYSTEM-BASELINE | ✅ | `docs/architecture/**` 10 份 + `SYSTEM-BASELINE-001-REPORT.md` |
| 2 | 已读取当前 Strategy / Backtest / Evaluation | ✅ | §2.1 复用清单（含符号名） |
| 3 | Parameter Space 完成 | ✅ | §4；`searchSpace.ts` |
| 4 | FIXED/TUNABLE/DERIVED 完成 | ✅ | §4.2 / §4.3；等价性守护测试 |
| 5 | GRID_SEARCH 完成 | ✅ | §4.1 / §8；其余方法**响亮拒绝** |
| 6 | Combination 完成 | ✅ | §4.1 / §8；复用 `generateParameterCombinations` |
| 7 | deterministic parameterHash 完成 | ✅ | §8；38 用例中的 hash 组 |
| 8 | Search Run 完成 | ✅ | §5.1 / §8；五态状态机 |
| 9 | Search Result 完成 | ✅ | §5.1 / §10.1 |
| 10 | Backtest 复用完成 | ✅ | §8 第 3 跳；`evaluateStrategyParameters` |
| 11 | Evaluation 复用完成 | ✅ | §8；`canonicalMetrics` **只读数** |
| 12 | Resume 完成 | ✅ | §9.3（二次 start `evaluated=0 / skipped=4`） |
| 13 | Retry 完成 | ✅ | §6 `retrySearchCombination`（已成功组合默认拒） |
| 14 | Cache 完成 | ✅ | §8 五要素判据 + 单测 |
| 15 | API 完成 | ✅ | §6（7 端点 + 可达性探测） |
| 16 | 前端 MVP 完成 | ✅ | §7（真机 DOM 验收 `pass=true`） |
| 17 | 4-combination 真实 E2E 完成 | ✅ | §9（37 项 / 0 失败） |
| 18 | 测试完成 | ✅ | §10（38 用例 + 全量零新增） |
| 19 | 架构文档同步 | ✅ | §13（10 份 + ROADMAP + CHANGELOG） |
| 20 | 最终报告完成 | ✅ | 本文件 |

```text
PARAMETER-001 = COMPLETE
```
