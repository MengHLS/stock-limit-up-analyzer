# STEP DATASET-003A — 多数据集架构 + 版本/数据集删除能力

**任务代号**：DATASET-003A
**状态**：`COMPLETE`
**日期**：2026-09-10
**依赖**：DATASET-001（Registry + 独立物理表）、DATASET-002.2（只读契约/查询/路由）、DATASET-002.3（前端 MVP）、DATASET-002.4A（生命周期状态机）、DATASET-002.4B（真实构建执行器 + 旧构建簇整合）

---

## 1. 需求原文与澄清

> 「目前系统只支持对单个数据集的后继版本进行增删，而我的需求是：支持构建多个不同的数据集，且每个数据集各自拥有多个版本；同时目前缺少对数据集版本的管理能力，需要补充对数据集版本的删除功能，以及对整个数据集的删除功能。请完善相关设计，明确数据结构、接口和管理逻辑，使其能够区分并管理多个数据集及其各自的版本，并支持对数据集版本和数据集本身的删除操作。」

经澄清确认两条关键设计口径：

| 决策点 | 用户选择 | 含义 |
| --- | --- | --- |
| 多数据集构建方式 | **每个数据集独立表结构与构建逻辑** | 拒绝「模板复用 / 一套表结构打天下」；每个 `datasetCode` 自带物理表 DDL + IO + 构建器 |
| 删除语义 | **删版本 = 删数据（保留表结构）；删数据集 = 删表结构 + 数据** | 版本是「数据的切面」，表结构属数据集身份；删数据集连表结构一并删除 |

---

## 2. 问题定位（改造前）

| 缺口 | 事实 |
| --- | --- |
| 只有一个数据集 | `dataset_definition` 仅 1 行（`first_limit_pullback`）；Router 未暴露「新建数据集」端点 |
| 构建能力被硬编码 | `runner.ts` 直接 `new DbDatasetBuildIO()` + `new FirstLimitPullbackDatasetBuilder(io, …)`，`datasetCode` 无法区分 |
| 表结构硬编码 | 物理表名/DDL 只存在于 migration 0028 与 drizzle schema，无「按数据集声明表结构」的抽象 |
| 无法删除版本 | 无 `deleteVersion`：既无物理行清理，也无作业/版本记录删除 |
| 无法删除数据集 | 无 `deleteDefinition`：无法级联清理，更无法 DROP 物理表 |
| 前端无管理入口 | `/datasets` 只读；无「新建数据集」「删除版本」「删除数据集」 |

---

## 3. 架构设计

### 3.1 插件化（多数据集的核心）

```
dataset_definition.datasetCode
        │
        ▼
DatasetPluginRegistry  ──get(datasetCode)──▶  DatasetPlugin
                                                 ├─ physicalTables:  DDL 声明（表名由 code 派生注入）
                                                 ├─ createIO():     该数据集自己的读写 IO
                                                 └─ createBuilder(): 该数据集自己的构建器
```

- **核心零硬编码**：`Registry / Lifecycle / Runner / Router / Query` 一律经注册表查找，不出现任何 `datasetCode` 字面量分支。
- **未注册 = 诚实失败**：`BUILDER_NOT_REGISTERED`（稳定错误码），不静默回退、不冒充构建成功。
- **DDL 自包含**：`CREATE TABLE IF NOT EXISTS` 内联列定义（不用 `CREATE TABLE … LIKE 模板表`，避免「删表后无法重建」）。DDL 依据真实 `SHOW CREATE TABLE` 结果编写，与 migration 0028 结构一致。
- **表名不可注入**：表名只由 `datasetCode + role` 经命名规范派生；`assertSafeTableName` 做反解一致校验，拒绝任何外部表名字符串。

### 3.2 数据结构（无新增物理表）

DATASET-003A **不新增任何表、不改动 migration 0028 / schema.ts**，完全复用 DATASET-001 的 Registry 三实体：

| 实体 | 作用 | 与多数据集的关系 |
| --- | --- | --- |
| `dataset_definition` | 数据集身份（`dataset_code` 唯一 + 显式落库 4 个物理表名） | 一行 = 一个数据集 |
| `dataset_version` | 逻辑版本（`(dataset_id, version)` 唯一） | 一数据集 → N 版本，物理表共享 |
| `dataset_build_job` | 构建作业 | 挂在版本上 |

**关键纪律**：一个数据集 = 一组**固定物理表**（`ds_{code}_{role}`）。多版本靠 `datasetVersionId` 列隔离，**禁止**「一版一表」（v1/v2 各建一套表）。

### 3.3 删除语义

| 操作 | 物理数据 | 表结构 | 作业 | 版本记录 | 定义记录 |
| --- | --- | --- | --- | --- | --- |
| `deleteVersion(id)` | 删该版本行 | **保留** | 删该版本全部作业 | 删该版本 | 保留 |
| `deleteDefinition(id)` | 删全部版本行 | **DROP 全部表** | 删全部作业 | 删全部版本 | 删定义 |

**顺序纪律**（保证中途失败不产生「记录已删但数据残留」或反向残留）：
- 删版本：守卫 → 清数据 → 删作业 → 删版本记录；
- 删数据集：守卫 → 逐版本（清数据 → 删作业 → 删版本记录）→ DROP 表 → 删定义。

**守卫**：任一名下版本存在 `RUNNING` 作业 → 拒绝（`VERSION_HAS_RUNNING_JOB` / `DEFINITION_HAS_RUNNING_JOB`），要求先取消或等待结束。

**幂等与诚实**：
- `DROP TABLE IF EXISTS` 幂等；DROP 后用 `SHOW TABLES LIKE` 复核 `dropped=true`；
- 表不存在 → 清理统计返回 `deleted=0 / tableMissing=true`（诚实 0，不冒充）；
- 分批 `DELETE … LIMIT 5000` 循环，避免跨境 TiDB 长事务。

---

## 4. 接口（tRPC）

| 端点 | 类型 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- | --- |
| `listDatasetPlugins` | query | — | `{ plugins: DatasetPluginListItem[] }` | 已注册构建插件（前端据此判定可构建性、展示物理表） |
| `createDatasetDefinition` | admin mutation | `{ datasetCode, name, datasetType, description? }` | `DatasetDefinitionListItem`（含 `buildable`） | 插件已注册时**同时建表**（先建表后落库） |
| `deleteDatasetVersion` | admin mutation | `{ datasetVersionId }` | `DeleteDatasetVersionResult` | 删数据 + 作业 + 版本；**保留表结构** |
| `deleteDatasetDefinition` | admin mutation | `{ definitionId, confirmDatasetCode }` | `DeleteDatasetDefinitionResult` | 级联 + **DROP 表**；`confirmDatasetCode` 强二次确认 |

错误码映射（`mapLifecycleErrorToTrpc`）：

| 领域错误码 | tRPC code |
| --- | --- |
| `BUILDER_NOT_REGISTERED` | `PRECONDITION_FAILED` |
| `VERSION_HAS_RUNNING_JOB` / `DEFINITION_HAS_RUNNING_JOB` / `DEFINITION_ALREADY_EXISTS` | `CONFLICT` |
| `INVALID_DATASET_CODE` | `BAD_REQUEST` |
| `VERSION_NOT_FOUND` / `DEFINITION_NOT_FOUND` | `NOT_FOUND` |

**入参安全**：
- `datasetCodeSchema` = 形态正则（`^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`）+ 禁止模式复检（`_v\d+$` / `_\d+$` / 环境名 / UUID）；
- 常量与 `server/datasetRegistry/naming.ts` **同源共享**（`DATASET_CODE_PATTERN` / `DATASET_CODE_FORBIDDEN_PATTERNS`），前后端零漂移；
- 契约单测额外固化 5 条：`first_limit_pullback_v1` / `first_limit_pullback_001` 等必须被拒。

---

## 5. 变更清单

### 5.1 后端新增

| 文件 | 内容 |
| --- | --- |
| `server/datasetRegistry/plugins.ts` | `DatasetPhysicalTableSpec` / `DatasetPlugin` / `DatasetPluginRegistry`（register/get/has/list/unregister）；`firstLimitPullbackPlugin`（三表 DDL 自包含）；`resolvePluginTables`；`createDefaultPluginRegistry` / `defaultDatasetPluginRegistry` |
| `server/datasetRegistry/physicalTables.ts` | `DatasetPhysicalStore` 接口 + `DbDatasetPhysicalStore`（ensureTables / purgeVersionRows / dropTables）+ `InMemoryDatasetPhysicalStore`（测试替身，复现真实编排语义）；`assertSafeTableName` / `resolveDefinitionTables` / `isTableMissingError` |
| `server/datasetRegistry/testHelpers.ts` | `makeFakeIO` / `makeFakeBuilder` / `makeTestPlugin` / `makeTestPluginRegistry` / `makeTestService` / `makeNoopRunner` / `makeTestRouter`（测试共享替身，避免跨文件重复装配） |
| `server/datasetRegistry/plugins.test.ts` | 8 例 |
| `server/datasetRegistry/physicalTables.test.ts` | 9 例（含 3 类表名注入攻击防护断言） |

### 5.2 后端修改

| 文件 | 变更 |
| --- | --- |
| `lifecycle.ts` | +5 错误码：`BUILDER_NOT_REGISTERED` / `VERSION_HAS_RUNNING_JOB` / `DEFINITION_HAS_RUNNING_JOB` / `INVALID_DATASET_CODE` / `DEFINITION_ALREADY_EXISTS` |
| `registry.ts` | Repo 契约 +4 方法（`deleteDefinition` / `deleteVersion` / `deleteJobsByVersion` / `getRunningJobForDefinition`）；`InMemoryDatasetRegistry` 实现之；Options +`plugins` / `physicalStore`；Service +`isBuildable` / `requirePlugin` / `requirePhysicalStore` / `deleteVersion` / `deleteDefinition`；`createDefinition` 建表先于落库 + 显式表名必须等于派生值；`createJob` / `startJob` 前置 `requirePlugin` |
| `db.ts` | `DbDatasetRegistry` 实现 4 个 delete 方法（`deleteJobsByVersion` 返回真实删除条数） |
| `runner.ts` | 移除 `DatasetBuilderFactory` / `DefaultDatasetBuilderFactory` / `io` / `factory` 依赖；Deps 改为 `{ repo, service, plugins }`；`execute` 按 `definition.datasetCode` 解析插件（`plugin.createIO()` + `plugin.createBuilder(io, { batchSize })`）；**插件解析置于 `markBuilding` 之后**（保证「执行尝试」必反映到版本态，失败可落 FAILED） |
| `query.ts` | `toDefinitionListItem(d, buildable)`；`DatasetQueryService` 构造第 3 参 `isBuildable`；`getVersionCounts` 包 try/catch（表不存在返回 0，而非 500） |
| `router.ts` | +4 端点；错误码映射扩展；Deps +`pluginRegistry` / `physicalStore`；默认实例注入真实实现 |
| `naming.ts` | 改为复用 shared 常量（字段名统一为 `pattern`） |
| `index.ts` | +`export * from "./plugins"` / `"./physicalTables"` |

### 5.3 契约与测试

| 文件 | 变更 |
| --- | --- |
| `shared/datasetRegistryContracts.ts` | +`DATASET_CODE_PATTERN` / `DATASET_CODE_FORBIDDEN_PATTERNS` / `datasetCodeSchema`（含 `.superRefine`）；`DatasetDefinitionListItem.buildable`；+`createDatasetDefinitionInputSchema` / `deleteDatasetDefinitionInputSchema` / `deleteDatasetVersionInputSchema` / `DatasetPluginListItem` / `DatasetPluginListResult` / `DeleteDatasetDefinitionResult` / `DeleteDatasetVersionResult` |
| `server/datasetRegistry/{registry,router,runner}.test.ts` | 新增 `DATASET-003A` 用例组；改用 `testHelpers` 统一装配 |
| `shared/datasetRegistryContracts.test.ts` | +「多数据集与删除入参契约」5 例 |

### 5.4 前端

| 文件 | 变更 |
| --- | --- |
| `components/datasetRegistry/CreateDatasetDialog.tsx` | **新增**：新建数据集（code/name/type/description）；实时展示「已实现构建 / 暂无构建实现」由 `listDatasetPlugins` 权威给出；导出 `validateDatasetCodeInput` 纯函数 |
| `components/datasetRegistry/DeleteDatasetVersionDialog.tsx` | **新增**：删除版本（勾选二次确认） |
| `components/datasetRegistry/DeleteDatasetDialog.tsx` | **新增**：删除数据集（**手工输入 datasetCode** 二次确认）；导出 `isDeleteDatasetConfirmed` 纯函数 |
| `components/datasetRegistry/datasetManagement.test.ts` | **新增**：8 例（code 校验 6 + 删除确认 2） |
| `components/datasetRegistry/index.ts` | barrel 导出 3 个新组件 |
| `components/datasetRegistry/VersionListTable.tsx` | 行级「删除版本」图标按钮 |
| `components/datasetRegistry/DatasetListTable.tsx` | 未注册插件的定义加「待实现」徽标（`buildable=false`） |
| `pages/datasets/DatasetList.tsx` | 页头 + 空态「新建数据集」入口；创建后跳转详情 |
| `pages/datasets/DatasetDetail.tsx` | 页头 + 「删除数据集」；**构建能力门禁**：`buildable=false` 时隐藏构建入口并显示琥珀色说明条 |
| `pages/datasets/VersionDetail.tsx` | 控制条右侧 + 「删除版本」；`buildable=false` 时构建控制条替换为说明条（仍可删版本） |

### 5.5 验证脚本

| 文件 | 内容 |
| --- | --- |
| `scripts/verifyDataset003a.mts` | **新增**：真实 TiDB 端到端 8 阶段验证（运行时注册探针插件，自带 DDL + 自有构建器） |

---

## 6. 验证

### 6.1 静态与单测

| 项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **exit 0** |
| 目标测试套件（15 文件） | **190 / 190 全过** |
| `npm run build` | **PASS**（vite 2969 modules；esbuild `dist/index.js` 1.3mb） |
| 全量 `npx vitest run` | 2576 过 / 16 失败 — **失败文件与本任务零交集**（8 个既有环境性失败：Tushare token 缺失、真实 DB 状态断言、图片识别依赖、researchRunRouter 口径；已 grep 确认这 8 个文件对 `datasetRegistry` 零引用） |

目标套件明细（15 文件 / 190 例）：

```
lifecycle 13 | registry 35 | router 29 | runner 9 | query 13 | builder 5
detection 9  | path 7     | naming 6  | db?     | plugins 8 | physicalTables 9
shared/datasetRegistryContracts 21
client adapter 15 | BuildVersionDialog 3 | datasetManagement 8
```

### 6.2 真实 TiDB 端到端（`scripts/verifyDataset003a.mts`）

**44 项断言全部 ✅，exit 0，零残留。** 8 个阶段：

| 阶段 | 覆盖点 | 关键真实证据 |
| --- | --- | --- |
| 1 只读基线 | `first_limit_pullback` 快照 | `id=1 versions=3 rows=257164` |
| 2 未注册插件 | 可登记 / 不可构建 / 不建表 | `ds_verify003a_nobuilder_event` **不存在**；`createJob` → `BUILDER_NOT_REGISTERED` |
| 3 第二数据集 | 独立表结构 + 防注入 | 3 张 `ds_verify003a_probe_*` 真实建立；重复 code → `DEFINITION_ALREADY_EXISTS`；显式外部表名 → `INVALID_DATASET_CODE` 且未落库 |
| 4 多版本构建 | 每数据集独立构建逻辑 | v1 4 行 / v2 5 行（窗口 4 / 5 交易日），均由**探针插件自己的构建器**写入**自己的 event 表**；`first_limit_pullback` 表零写入 |
| 5 删版本 | 删数据 + 保留表结构 | `purgedRows=4`；v1 行=0；**3 张表仍存在**；v2 行=5 未变；重复删 → `VERSION_NOT_FOUND` |
| 6 RUNNING 守卫 | 删版本/删数据集均拒绝 | `VERSION_HAS_RUNNING_JOB` / `DEFINITION_HAS_RUNNING_JOB`；守卫拒绝后数据集与表完好 |
| 7 删数据集 | DROP 表 + 级联 | `versionsDeleted=1 purgedRows=5 jobsDeleted=2`；3 表 `dropped=true` 且真实不存在；定义记录消失；**同 code 可重建并再次 DROP 干净** |
| 8 回归确认 | 既有数据集未被触碰 | `first_limit_pullback` 版本数 3、行数 257164、表全在 |

> 阶段 4 首次运行时出现一次**时序竞态假失败**：runner 收尾顺序是 `completeJob → markReady`，两次跨境往返之间版本仍为 `BUILDING`。已改为「等作业 COMPLETED **且** 版本 READY」双条件，重跑全绿。此为**验证脚本的观测缺陷**，非产品缺陷。

---

## 7. 设计取舍与诚实边界

| 取舍 | 理由 |
| --- | --- |
| 不新增表、不改 migration | 复用 DATASET-001 三实体已足够表达「多数据集 × 多版本」；减少 schema 变动风险 |
| `CREATE TABLE` 内联列定义，不用 `LIKE 模板表` | 模板表被 DROP 后无法重建；自包含 DDL 使「删数据集 → 同 code 重建」闭环成立 |
| 插件解析置于 `markBuilding` **之后** | 保持「DRAFT→FAILED 不合法」的状态机纪律；任何执行尝试都先留下 BUILDING 痕迹，失败可落 FAILED 可重试，不留「作业 FAILED 但版本仍 DRAFT」的不一致观感 |
| 未注册插件的定义允许「登记 + 管版本」 | 用户需要能预先登记数据集身份；但构建入口前后端**双双拒绝**（前端隐藏 + 后端 `BUILDER_NOT_REGISTERED`），不做「乐观放行」 |
| 删数据集必须回传 `confirmDatasetCode` | 破坏性操作，防误删；前端对应要求**手工输入** code |
| `DatasetPhysicalStore` 提供内存实现 | 让「保留表结构 vs DROP 表」的删除语义在无 DB 环境可被真实验证（断言真实调用序列与状态变化，非 mock 冒名） |
| `DbDatasetBuildIO` 仍与 `first_limit_pullback` 表绑定 | 这是**正确**的：IO 属于各数据集自己的插件。第二个数据集必须提供自己的 IO/构建器 —— 本次验证正是用探针插件证明了这条路径成立 |

**诚实边界（未做，明确不冒充）**：
- 未实现第二个**生产级**数据集插件（仅验证脚本内的探针插件）—— 新数据集需要真实业务语义时再实现并注册；
- 未做「批量删除多个版本 / 归档后删除」等编排；
- DELETE 走 `LIMIT 5000` 分批但在单一请求内串行完成，超大版本删除是长请求（未来可考虑异步作业化）。

---

## 8. 风险

| 风险 | 等级 | 说明与缓解 |
| --- | --- | --- |
| 跨境 TiDB 往返延迟 | 中 | 删版本/删数据集为同步长请求；已分批 DELETE。若未来单数据集行数达千万级，建议改异步作业 |
| `del.isPending` 期间用户重复点击 | 低 | 前端按钮 disabled；后端幂等（重复删 → `*_NOT_FOUND`） |
| 探针插件与生产插件同表名冲突 | 低 | 表名由 `datasetCode` 派生，探针 code `verify003a_probe` 与生产 code 天然隔离 |
| `DROP TABLE` 不可逆 | 中 | 双重确认（前端手工输入 code + 后端比对落库值）；守卫阻断运行中数据集 |
| `tsconfig` 排除 `*.test.ts` | 低 | `tsc` 只覆盖生产代码（既有约定）；测试正确性由 vitest 转译运行保证 |

---

## 9. 交付物

- `docs/step-dataset-003a-report.md`（本文件）
- `scripts/verifyDataset003a.mts`（可复跑的真实 TiDB 验证）
- ROADMAP §44.1 数据快照备注 + §47 更新记录

---

## 10. 状态判定

| 维度 | 判定 | 依据 |
| --- | --- | --- |
| 代码 | ✅ `CODE_READY` | `tsc` exit 0；190/190 目标测试；build PASS |
| 数据 | ✅ 无快照变更 | 验证用临时数据集已全部清理；`first_limit_pullback` 行数/版本/表零变化 |
| 验证 | ✅ `VALIDATED`（本任务范围） | 真实 TiDB 44/44 断言通过，含 DROP 表后真实复核表不存在 |
| 后续 | DATASET-003B 不自行启动 | 如需第二生产数据集插件，另立任务 |
