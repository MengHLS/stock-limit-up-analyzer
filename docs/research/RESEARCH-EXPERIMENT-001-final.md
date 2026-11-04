# RESEARCH-EXPERIMENT-001 — 独立研究实验体系 + AI 接入规范（最终报告）

> 单一最终报告（规格 §20 要求只生成这一个文件）。
> 交付物：契约 `shared/researchExperimentsContracts.ts` · 域层 `server/researchExperiments/**` ·
> 实验根目录 `research-experiments/**` · 前端 `client/src/pages/researchExperiments/**` ·
> AI 接入文档 `docs/research/EXPERIMENT-CODE-SPEC.md`。
> 完成日期：2026-09-20 · 计算口径版本：`1.0.0`

---

## 1. 当前旧 Research 架构（审计实测，不采信任何历史报告）

| 目录 | 事实 |
| --- | --- |
| `server/researchCore/` | RESEARCH-001 领域层 + Repository（唯一权威枚举 `types.ts`、`repository/{contract,db,inMemory,errors}`） |
| `server/researchEngine/` | RESEARCH-002 执行引擎（`engine.ts` 编排、`analyses/registry.ts` 派发、`planner/moduleRegistry.ts` 方法注册、`datasetReader.ts` **Research 侧唯一 Dataset 读取层**） |
| `server/research/` | STEP 6.x 遗留链路 + 量化算子库（约 200 文件） |
| `server/researchDataset/` | STEP 12.6 遗留数据集构建（`builder.ts#buildResearchDataset`、`pullback.ts`、`version.ts`） |
| `server/datasetRegistry/` | DATASET-001/002/003 新架构（`plugins.ts` 插件注册表、`query.ts` 只读读取层、`ds_first_limit_pullback_*` 五表） |
| `server/researchReadyGate/` | **不存在** —— 「就绪门」是 `server/dataHealth` 读取的 JSON 证据 |

旧链路形态固定为 `Research → Analysis → Finding → Conclusion`，实体落在
`research_experiment / research_run / research_analysis / research_result / research_finding / research_conclusion`
（**单数**表名）；另有 STEP 6.x 的**复数**表名一套，两套并存、互不引用。

**tRPC 约定（实测原文）**：`server/_core/trpc.ts` 导出 `router / publicProcedure / protectedProcedure / adminProcedure`；
领域码跨边界用 `[DOMAIN_CODE] message` 前缀（`server/research/strategyCandidate/router.ts#withDomainCode`），
消费端只认 `client/src/adapters/*#readRpcDomainCode` 那一套；
`server/routers.ts` 聚合子 router = **import 一行 + `appRouter` 一行**。

**既有注册表范式**：`ResearchModuleRegistry`（`planner/moduleRegistry.ts`）+
**显式清单**（`patternLibrary/patterns/index.ts`）。全仓 `import.meta.glob` **0 处**，
无任何业务注册表用 `fs` 做发现（`docs/research/PLAN-STRATEGY-MODULE-EXTENSION-001.md` 明文约定）。

**Dataset 侧的两个身份别混**：Registry 的 `dataset_version.id`（坐标）vs 研究域的
`computeDatasetVersion` 内容指纹（`rd-1.0.0-1-<sha256前16>`）；`securityId`（身份，`sec_<uuid>`）
vs `code`（当日生效代码）是两个键域，`ds_*` 表只有 `symbol`。

---

## 2. 新 Experiment 架构

```
research-experiments/                    实验根目录（与 client/ server/ 平级）
  ├── manifest.ts                        显式清单（服务端发现，唯一人工注册点 1）
  ├── template/                          模板（experiment.ts / result.ts / page.tsx / README.md）
  └── first-board-pullback/entry-day/    完整可运行示例（真实数据）

shared/researchExperimentsContracts.ts   唯一契约（wire schema + 作者契约类型）
server/researchExperiments/              域层（types / errors / registry / datasetPort / runner / defaults / router）
client/src/researchExperiments/          页面契约 + 页面注册表（唯一人工注册点 2）
client/src/pages/researchExperiments/    通用外壳（列表 / 详情 Run / 通用降级渲染器）
```

**隔离事实（可断言，不是注释）**：

- 新体系**不 import** 任何旧 Research 链路实体（`server/researchCore` / `researchEngine/finding` 等）；
- 源码里**不出现** `analysisId` / `findingIds` / `conclusionId` / `candidateId` 字段声明，
  也不出现旧表名字面量 —— 由 `tests/server/researchExperiments/manifest.test.ts` 按
  **结构形态**（字段声明 / 字符串字面量）扫描 `server/researchExperiments` +
  `shared/researchExperimentsContracts.ts` + `research-experiments` 三处；
- Experiment **不依赖 Strategy**（`grep` 后确认新体系零 `strategy*` 依赖）。

---

## 3. Contract

唯一契约文件 `shared/researchExperimentsContracts.ts`（七节 + 作者契约第八节）：

```
ExperimentDescriptor        元数据 + parameters[] + datasetRequirement + pageKey/pageTitle
ExperimentDatasetRequirement  datasetCode / requiredColumns{events,feature,observation} /
                             prefixRelativeDays / postRelativeDays / decisionOffsetDays /
                             usesForwardData / forwardDataPurpose
ExperimentDefinition        descriptor + resultSchema(zod) + run(context)
ExperimentRunContext        descriptor / parameters / dataset(取数句柄) / log()
ExperimentResultPayload     sampleSummary(必填) + tables/statistics/distributions/comparisons/charts/customPayload
ExperimentRunOutcome        runStatus + descriptor + execution + result|null + error|null
```

**为什么作者契约放 `shared` 而不是 `server`**：实验目录层级不固定（模板 2 层、示例 3 层），
相对路径 import 会因**复制目录**而 `TS2307`（本会话真实踩到一次）；改走 `@shared` 别名后
与目录深度无关 —— 这是「复制模板即可用」的前提。

**注册期元数据校验**（`validateExperimentDescriptor`，9 条，全部有单测）：
id 形态 / version / source / pageKey 非空；参数 code 唯一；非必填必有默认值；
ENUM 必有非空 allowedValues 且默认值在其中；非 ENUM 不得声明 allowedValues；
`bounds.min ≤ bounds.max`；`datasetCode` 合 Dataset 命名规范（复用既有正则）；
相对日方向（prefix ≤ 0 / post ≥ 1）；post 非空 ⇒ `usesForwardData`；`usesForwardData` ⇒ 用途非空；
至少声明一个要读的列。

---

## 4. Directory structure

见 §2。逐文件职责：

| 文件 | 行数级 | 职责 |
| --- | --- | --- |
| `shared/researchExperimentsContracts.ts` | ~700 | 契约唯一来源（zod + TS 类型 + 作者契约） |
| `server/researchExperiments/types.ts` | ~30 | 服务端统一类型入口（薄转出，指向 shared） |
| `server/researchExperiments/errors.ts` | ~45 | `ExperimentError` + `experimentAssert` + `toExperimentError` |
| `server/researchExperiments/registry.ts` | ~190 | `ExperimentRegistry` + `validateExperimentDescriptor` |
| `server/researchExperiments/datasetPort.ts` | ~420 | Registry 桥：列投影 / 相对日白名单 / PIT 闸门 / 视界校验 / 版本准入 |
| `server/researchExperiments/runner.ts` | ~470 | Runner：load→validate→resolve→execute→capture |
| `server/researchExperiments/defaults.ts` | ~110 | 真实装配（惰性单例，唯一出现 DB 的地方） |
| `server/researchExperiments/router.ts` | ~140 | tRPC 四端点（zero-write） |
| `server/researchExperiments/index.ts` | ~50 | barrel |
| `research-experiments/manifest.ts` | ~30 | 显式清单 |
| `research-experiments/template/{experiment,result}.ts + page.tsx` | ~340 | 真实可复制模板（`usesForwardData: false`） |
| `research-experiments/first-board-pullback/entry-day/*` | ~640 | 完整示例（4 文件） |
| `client/src/researchExperiments/{contract,pages,index}.ts` | ~110 | 页面契约 + 注册表 |
| `client/src/pages/researchExperiments/{ExperimentList,ExperimentDetail,GenericResultView,index}` | ~1,000 | 通用外壳 |

---

## 5. Runner

```
load(registry.require) → validate(参数+默认值归并) → resolve dataset(版本事实 / READY / 代码匹配 / 视界)
→ execute(definition.run(context)) → capture result(信封 + customPayload schema + 样本账)
→ capture error → return execution metadata
```

**Runner 不理解任何实验业务**（没有分支判断「这个实验要什么」）。它只做七件事，
实验只写 `run()`。

### 5.1 两类失败，两条出口（本轮最刻意的设计）

| 何时 | 例子 | 出口 |
| --- | --- | --- |
| **执行前**可判定 | 未注册 / 参数越界 / 版本不存在 / 非 READY / 代码不匹配 / 相对日超视界 | **抛领域错误** → tRPC 错误（`[CODE] …`） |
| **执行中**才发生 | `run()` 抛异常 / `customPayload` 不符 schema / 样本账不平 | **返回 `FAILED` outcome**（`result: null` + `error` + 完整执行事实） |

理由：前者是「这次请求不成立」（调用方参数问题）；后者是**执行事实**，
页面必须能同时看到「哪个版本 / 什么参数 / 跑了多久 / 失败码 / 跑到哪一步」。

### 5.2 执行元数据（`execution`）

`startedAt / finishedAt / durationMs / resolvedParameters / logs(≤200) / datasetFacts`，
其中 `datasetFacts` 含 `datasetTotalEvents / eventCount / prefixRowCount / postRowCount /
maxPostRelativeDayRead / decisionOffsetDays / forwardDataRead` —— 全部是**实际读到的量**，
不是表级 COUNT，因此「读了什么」可复核。

---

## 6. Dataset contract

实验**拿不到 DB**。三步结构约束：

1. **声明**（`datasetRequirement.requiredColumns` / `prefixRelativeDays` / `postRelativeDays`）；
2. **调用**（`context.dataset.events() / feature(rd) / observation(rd)`）；
3. **约束**：
   - `buildColumnSelection` 只 SELECT 清单里的列 ⇒ 未声明的列在 `values` 里**不存在**；
   - 未声明的相对日调用即抛 `EXPERIMENT_DATASET_REQUIREMENT_INVALID`；
   - 声明了**不存在**的列 ⇒ 当场抛 `EXPERIMENT_METADATA_INVALID`
     （防止 Drizzle 把写错的列静默变 `null`）；
   - 🔴 下推的列 = **骨架列 ∪ 声明列**，骨架列复用既有唯一权威
     `server/researchEngine/columnProjection.ts#STRUCTURAL_COLUMNS`（本轮为复用把它 `export` 出去）。

### 6.1 真库 E2E 抓到的真实缺陷（本会话最有价值的发现）

第一版跑真库时：`prefixRowCount = 0 / postRowCount = 0`，全部样本以
`MISSING_EVENT_DAY_BAR` 被剔除。根因是**列投影把身份列裁掉了**：

```
只 SELECT 声明的列 ⇒ 领域映射器回来的 eventId = undefined
⇒ 按 20000 个 undefined 的 eventId 批量取行情 ⇒ 恒 0 行
```

- 这个缺陷**单测发现不了**：内存读取层（`InMemoryResearchDatasetReader`）**不实现列裁剪**，
  传不传 `columns` 返回值都一样 —— 单测 62/62 全绿而真机全空，正是「单测证明进程内行为对，
  真机证明往返后仍对」的教科书案例；
- 修法：新增 `ROLE_SKELETON_COLUMNS`（复用 `STRUCTURAL_COLUMNS` + 本契约承诺的
  `tradeDate` / `symbol`），下推列 = 骨架 ∪ 声明；
- 回归守卫：`tests/server/researchExperiments/datasetPort.test.ts` 新增一例，
  **用记录器断言下推查询的 `columns` 必须含骨架列**（这是唯一能拦住该类缺陷的判据形态）。

---

## 7. Result contract

- **信封**（`metadata` / `parameters` / `sampleSummary` / `tables` / `statistics` /
  `distributions` / `comparisons` / `charts` / `customPayload`）由平台 schema 统一校验；
- **`customPayload`** 由实验自己的 `resultSchema` 校验 —— 两层都过才算成功；
- `metadata` 与 `parameters` **由 Runner 填**（实验无法谎报坐标）；
- **数值「算不出就是 `null`」**：`statistics[].value` / `cell` 均允许 `null`，**禁 0 兜底**；
- 🔴 **样本账强制平**：`eligible + excluded === candidate` 且 `Σ excludedByReason === excluded`，
  否则 `EXPERIMENT_RESULT_INVALID`。这是「样本为什么变少」的唯一诊断线索；
- 结果结构**不强制**任何字段（除三者），实验按研究问题自选 —— 规格 §6 的明确要求。

---

## 8. Page contract

```ts
interface ExperimentPageProps { descriptor: ExperimentDescriptor; outcome: ExperimentRunOutcome | null }
```

- 平台负责：元数据 / Dataset 版本选择器 / 参数表单（由参数定义自动渲染）/ 运行动作 /
  执行状态与元数据 / 错误状态 / 加载态；
- 页面负责：结果怎么画（自定义表格 / 图表 / 比较 / 解释 / 样本详情 / 研究说明）；
- 🔴 **页面不自己发请求**（执行入口服务端只有一套），**不 import `experiment.ts` 或
  `server/**` 运行时**（有静态测试扫描 `page.tsx` 的运行时 import）；
- `pageKey` 未注册 ⇒ **不白屏**，降级到 `GenericExperimentResult` 并明确提示。

---

## 9. AI 接入文档

`docs/research/EXPERIMENT-CODE-SPEC.md`（A~O 全 15 节，规格 §8 逐条对应），
包含：实验定义与新旧对比、目录结构、文件命名规则、契约逐字段参考、Dataset 使用与
**真实可用列清单**、PIT / `decisionOffsetDays` 规则（含身份 ≠ 代码的桥接要求）、
参数定义与两级校验规则、Result Schema 四纪律、Page Contract 与主题/配色纪律、
注册机制、**错误码全集**、两类失败出口、测试与验收四层、12 条禁止事项、
示例概览、放入项目的步骤与 14 条交付前自检清单。

**自足性判据**：文档只引用「契约文件 + 模板 + 示例」三处代码位置，不要求阅读仓库其他部分。

---

## 10. Template

`research-experiments/template/`（4 文件，**真实可运行代码**，非伪代码）：
只读 `events` + `prefix(rd=0)`，按 `groupBy`（ENUM：`boardType` / `market`）统计事件数与占比；
`usesForwardData: false`（最安全的起点）；参数含一个 ENUM + 一个 INT（含 bounds）；
结果含表格 / 统计量 / 柱状图 / `customPayload`。README 给出 4 步开始清单与 7 条复制后自检。

---

## 11. Example（真实数据、真实计算）

`research-experiments/first-board-pullback/entry-day/`：

| 项 | 内容 |
| --- | --- |
| 研究问题 | 首板后第 T+k 个交易日开盘入场、持有到 T+exit 收盘，不同 k 的基础统计 |
| 参数 | `entryDays`(INT_LIST, 默认 [1..5]) / `exitRelativeDay`(INT, 默认 5) / `maxEvents`(INT, 默认 2000) |
| Dataset 声明 | `first_limit_pullback`；`postRelativeDays [1..20]`；`usesForwardData: true`；`decisionOffsetDays: null` |
| 样本单位 | （事件 × 入场日）一次可评估的入场机会 |
| 真实运行（v2 数据集 · maxEvents=400） | T+1：**399 样本 / 平均 +4.6126% / 中位 +2.4404% / 胜率 57.89% / 平均入场位置 +1.5802% / 平均最大不利偏移 −6.8407%** |
| 刻意不做 | 不排序、不评级、不给「最佳入场日」（同一份数据上挑最优 = 样本内选择） |

它演示了规格 §7 允许的**每一种**页面能力，并把两条偏差如实登记进结果
（数据可得性选择偏差、持有期不等长）。

口径微调（本轮自查发现）：`entryDay === exitRelativeDay` **合法**（当日开盘买入、
当日收盘卖出），只有 `entryDay > exitRelativeDay` 才拒；最大不利偏移**含入场日当日**
（否则该入场日区间为空、指标恒「无数据」，看起来像数据问题而其实是口径问题）。
两处均已写进代码注释与 README。

---

## 12. Auto discovery

**两级显式注册**（规格 §11 明确允许「最小 Registry」）：

```
research-experiments/manifest.ts                 ← 服务端发现：+1 行 import + 1 行数组项
client/src/researchExperiments/pages.ts          ← 前端页面：+1 行 pageKey → 组件
```

- **不改核心引擎**：没有 switch/case，`server/routers.ts` 一次挂好对所有实验通用；
- **禁用文件系统发现**的理由：全仓 `import.meta.glob` = 0 处、既有注册表（`patternLibrary`）
  也是显式清单，且本会话新增一条静态测试**把「无 glob / 无目录扫描 / 无文件 IO」
  变成可断言的事实**；
- 两级注册的一致性由测试**双向**钉住（清单里的每个 `pageKey` 必须有页面；
  注册表里不允许指向不存在实验的条目）。

---

## 13. Frontend

| 路由 | 页面 |
| --- | --- |
| `/research-experiments` | 实验列表（名称 / id / 版本 / 数据集 / 参数数 / 打开） |
| `/research-experiments/:group/:key` | 详情 + 运行（元数据 / Dataset 版本选择 / 参数表单 / 运行按钮 / 执行元数据 / 结果） |

- 侧栏新增「研究 → **独立实验**」（与既有「研究实验 = /research」并存、名称刻意区分）；
- **坐标进 URL**：`?datasetVersionId=…` 是唯一权威（刷新 / 分享 / 后退都不丢坐标），
  默认选中最新 READY 版本；
- **pending 换文案**：`正在运行实验…（读真实 Dataset 并全量计算，可能需要 10~60 秒）`
  （规格外但符合 `.workbuddy/memory/MEMORY.md` 的硬规则：长请求按钮 pending 必须换文案）；
- **如实告知不落库**：明确写出「本体系不新增数据库表，刷新后需重跑；Dataset 坐标在 URL 里不会丢」。

---

## 14. Tests

| 层 | 内容 | 结果 |
| --- | --- | --- |
| Contract Test | 元数据 10 组 + 注册表 4 组 + 参数 4 组 + 结果 3 组 | **23/23 PASS** |
| Dataset 桥 | 版本事实 / 列投影即声明 / 骨架列下推**回归守卫** / 相对日白名单 / PIT 闸门 / 惰性缓存 | **10/10 PASS** |
| Runner | load / validate（5 例）/ execute（3 例）/ capture error（3 例） | **12/12 PASS** |
| Router | 注册守卫 / 读端点 / admin 鉴权 / 领域码可抠 | **9/9 PASS** |
| 清单 ⇄ 前端注册表 + 边界 | 双向一致 + 旧结构零耦合 + 无 glob/无目录扫描 + 页面不引 server | **9/9 PASS** |
| 小计（新增） | 5 个文件 | **63/63 PASS** |
| 全量 vitest | 295 文件 / 4982 例 | **7 失败文件 / 16 失败例 = 与既有基线逐项一致 ⇒ 零新增** |
| `tsc --noEmit` | 全仓 | **0 error** |
| `vite build` | 生产构建 | **exit 0**（36.27 s） |

### 14.1 真实 Dataset E2E（`docs/evidence/_e2e_research_experiments.mts`）

走 `appRouter.createCaller`（不是 Service 直调），只读选取 READY 版本（390002 v2 / 23978 事件），
执行真实实验两次 + 三个负例：

```
真实 Dataset → tRPC → Runner → Registry 桥 → ds_* 五表 → 真实计算 → 结果信封 → zod 复核
```

**28 PASS / 0 FAIL**，关键数字：

- 墙钟 19.3 s，runner 自报 17.4 s；
- `eventCount = 20000`（触平台安全阀）/ `prefixRowCount = 20000` / `postRowCount = 100000`
  / `maxPostRelativeDayRead = 5` / `forwardDataRead = true`；
- 样本账：候选 100000 = 入池 1996 + 剔除 98004（`MAX_EVENTS_LIMIT: 98000` +
  `MISSING_INTERMEDIATE_BAR: 3` + `INVALID_ENTRY_OPEN: 1`），**原因合计 = excludedCount**；
- **确定性**：同输入第二次执行，结果指纹（canonical JSON，7,479 字节）**逐字节相等**；
- **零写入**：24 张严格守恒表 Δ = 0，且三个负例各自前后行数完全一致（失败路径什么都没写）。

### 14.2 前端可达性冒烟（`docs/evidence/_probe_research_experiments_frontend.mjs`）

无头 Edge + CDP，逐段量 DOM：**23 PASS / 0 FAIL**。
判据含：列表页真实实验名/id/版本/数据集声明/详情链接 + 侧栏 29 项含「独立实验」；
详情页元数据/参数表单 3 个输入/版本选择器回显真实 `v2 · id=390002 · READY`；
**点击运行**（真实 mutation）→ pending 文案变化 → 结果页挂载
`data-experiment-page="first-board-pullback/entry-day"`、3 张表、**2 张 recharts 图**、
样本口径（含中文剔除原因）、执行元数据；不存在的实验显示
`EXPERIMENT_NOT_FOUND` 结构化错误态；控制台无 `No procedure found on path`。

**探针判据自身的一处纠正**（按纪律先定性再改判据）：第一版把「侧栏没有『独立实验』」判成 FAIL，
定性后发现是**视口**问题 —— `Sidebar collapsible="icon"` 在默认 800×600 下折叠成图标态，
文字标签不进 `innerText`；设 1440×900 后实测该导航项一直在（29 项中第 7 项）。
已把原因写进探针注释与本节。

---

## 15. DB impact

| 项 | 结论 |
| --- | --- |
| 新增表 | **0** |
| migration | **0**（`drizzle/meta/_journal.json` 仍 24 条，最后一条 `0023_security_identity_unification`，未动） |
| `db:push` / `drizzle-kit generate` | **未执行** |
| 写口 | **0**（router 只有 3 query + 1 mutation，mutation 是「请求内计算」，无落库） |
| 真库验收 | 24 张严格守恒表 Δ = 0（含 `dataset_*` / `ds_*` 五表 / `research_*` / `parameter_search_*` / `oos_*` / `walk_forward_*` / `strategies`） |

「不新增表」的兑现方式：执行是**请求内计算**（与 `researchEngine.runEngine` 同形），
结果通过返回值交付；代价是**刷新后需重跑**（已在页面如实告知，见 §17）。

---

## 16. Strategy impact

| 项 | 结论 |
| --- | --- |
| Strategy Core | **未改**（零文件改动） |
| Parameter Search / Backtest / OOS / Walk-Forward / Robustness | **未改** |
| 唯一对既有 `server/**` 的改动 | `server/researchEngine/columnProjection.ts`：把 `STRUCTURAL_COLUMNS` 由 `const` 改为 `export const`（**纯导出**，运行时行为零变化）——目的是让新体系复用既有唯一权威，而不是复制第二份骨架列清单 |
| `server/routers.ts` | 新增 1 个 import + 1 个路由项（`researchExperiments`） |
| 回归证据 | 全量 vitest 失败文件集合 = 既有基线（7 文件 / 16 例），**零新增** |

---

## 17. Remaining limitations（如实登记，不写成「已解决」）

1. **结果不落库**：零新表 ⇒ 刷新页面需重跑。Dataset 坐标在 URL 里（不丢），但结果本身不持久化。
   若将来要留档，需先裁定「复用既有语义相容 JSON 列」还是新开表（后者要手工 migration 纪律）。
2. **注册不是文件系统发现**：新增实验要在 `manifest.ts` 与 `pages.ts` **各加一行**。
   规格 §11 允许最小 Registry，且这是仓库既有约定（无 glob / 无目录扫描）；但仍不是「放进去就发现」。
3. **事件扫描安全阀 20000**：数据集 23978 事件时会被截断（已如实进 `execution` 与 `notes`）。
   读全量事件有固定成本（约 10 s，跨境 TiDB 分页），且**先读后切** ——
   实验自己的 `maxEvents` 只减少计算量、不减少读取量。
4. **`postRelativeDays` 是静态声明**：示例声明 `[1..20]`（与当前数据集 `postWindowDays=20` 一致）。
   若数据集视界扩大，需同步改声明（否则 `EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE` —— 刻意不夹取）。
5. **边界测试只扫 `.ts` / `.tsx`**：`.md` 里刻意保留 `findingIds` 等词作为「禁止事项」说明，
   因此扫描范围排除文档（否则判据命中的是否定式说明，证明不了任何事）。
6. **通用降级渲染器不渲染 `customPayload`**：只渲染信封通用字段；实验自有结构只有其页面能画。
7. **`id` / `createdAt` 等物理列仍可被声明**：列校验只保证「真实存在」，不限制「该不该读」。
   若要禁止，需再加一层列语义白名单（本期未做）。
8. **未做性能优化**：跨入境 TiDB 的读取串行执行（同一相对日一次批量），大样本下会线性变慢。

---

## 18. `RESEARCH-EXPERIMENT-002` 阶段需要处理的旧 Research 依赖

1. **旧链路收敛策略**：`/research`（旧工作台）与 `/research-experiments`（新体系）两套入口
   需用户裁定最终形态（并存？迁移？旧链路只读保留？）。本期按规格 §14 **只并存、不动旧链路**。
2. **研究问题 → 实验的桥**：`research_question` / `research_plan`（PLANNER-001）目前只驱动旧链路；
   是否要让它「一键生成一个独立实验的骨架」（plan → experiment 目录草稿）需先定准入纪律
   （谁审、改哪两行注册、生成物是否入仓）。
3. **结果持久化的取舍**：若要留档，先评估「复用既有 JSON 列」（项目已有
   `parameter_search_result.reproductionJson` 这类先例）vs 新表 + 手工 migration。
4. **AI 生成物的准入检查器**：`EXPERIMENT-CODE-SPEC.md` 现在是**人读规范**；
   002 可考虑把其中的「交付前自检清单」做成**可执行检查器**（或 skill），
   让外部 AI 生成的实验在注册前自动过一遍。
5. **骨架列清单的单一来源**：本轮为复用以 `export` 方式共享
   `STRUCTURAL_COLUMNS`；若 002 再引入第三个消费方，应评估把它上移到 `shared` 或
   独立原子模块（避免再次「import 既有文件只为拿常量」）。
6. **`decisionOffsetDays` 的语义统一**：示例取 `null`（样本资格不用未来价格）；
   若实验开始用 rd ∈ [1,d] 做入池条件，需要把「信息边界」写进结果并在页面上强提示
   （旧链路已有 `DECISION_OFFSET_CONFLICT` 类纪律可参考）。
7. **旧链路的 Analysis/Finding/Conclusion 与新结果的对照**：目前两套完全隔离（刻意）；
   若用户要求「同一个研究同时看到两种视角」，只允许做**可选适配层**，不得改本契约（规格 §14）。

---

## 附：完成标准逐条核对（规格 §21）

| 条件 | 状态 | 证据 |
| --- | --- | --- |
| 独立 Experiment Contract | ✅ | `shared/researchExperimentsContracts.ts`（§D 节） |
| 独立 Experiment directory | ✅ | `research-experiments/`（含 template 与示例） |
| Experiment Runner | ✅ | `server/researchExperiments/runner.ts`（runner.test 12/12） |
| Dataset integration | ✅ | `datasetPort.ts` 复用 `ResearchDatasetReader`（真库 E2E 28/28） |
| PIT compliance | ✅ | `usesForwardData` 结构闸门 + 声明期拒绝 + 相对日白名单（单测 4 例） |
| Result schema | ✅ | 信封 zod + 实验自有 schema + 样本账断言 |
| 独立 Page contract | ✅ | `client/src/researchExperiments/contract.ts` |
| Experiment frontend entry | ✅ | `/research-experiments`（CDP 冒烟 23/23） |
| AI 接入文档 | ✅ | `docs/research/EXPERIMENT-CODE-SPEC.md`（A~O） |
| Template | ✅ | `research-experiments/template/`（4 文件真实代码） |
| 完整 Example | ✅ | `first-board-pullback/entry-day/`（真实数据） |
| 真实 Dataset E2E | ✅ | `docs/evidence/_e2e_research_experiments.mts`（28/28，含确定性复跑） |
| frontend smoke | ✅ | `docs/evidence/_probe_research_experiments_frontend.mjs`（23/23） |
| TypeScript/build/test | ✅ | tsc 0 error / vite build exit 0 / 新增 63/63 / 全量零新增 |
| 无旧 Research 删除 | ✅ | 旧链路零改动（唯一 server 改动是纯导出） |
| 无 Strategy 回归 | ✅ | Strategy Core 零改动 + 全量失败集合与基线一致 |
| ROADMAP 已登记 | ✅ | §44.5 `9ce`（见下） |
| 单一最终报告 | ✅ | 本文件 |
