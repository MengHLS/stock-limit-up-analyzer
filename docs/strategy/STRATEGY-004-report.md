# STRATEGY-004 实施报告 — Strategy ↔ Dataset Registry 绑定对齐与引用完整性

> 任务：把 New Strategy 的 Dataset 绑定从「`rd-…` 字符串格式校验」升级为「以 Dataset Registry 的
> `dataset_version.id` 为权威坐标的真实引用完整性」，并暴露 STRATEGY-003 已完成但未暴露的 Domain 能力。
> 状态：**COMPLETE**（§14 四项验收清单 Architecture / Integrity / API / Frontend / Compatibility 全部 PASS）。
> 日期：2026-09-12 GMT+8。
> 前置：`AUDIT-DRS-001-EVIDENCE.md`（只读联合审计；本次 STEP 由其实查结论「当前唯一根断点 = Strategy ⇄ Dataset Registry 的 Dataset 版本标识不接头」直接发起）。
> 纪律声明：本 STEP **不产出任何策略结论**；`RESEARCH_READY` 结论未变（代码存在 ≠ VALIDATED ≠ Research Ready）。本 STEP 的 VALIDATED 仅指「Dataset 绑定引用完整性 + 跨模块坐标」这一**工程属性**已用真实 DB / 真实 tRPC 双证。

---

## 1. 修改文件清单

### 1.1 新增（6）

| # | 文件 | 作用 |
|---|---|---|
| 1 | `drizzle/0035_strategy_dataset_binding_version_id.sql` | Migration：`strategy_versions` + `strategy_version_datasets` 各加 `datasetVersionId bigint NULL` + 各一索引；含 `-- @guard:` 指令供 apply / verify 解析 |
| 2 | `scripts/applyStrategyDatasetBindingVersionId.mjs` | 幂等 apply / `--dry-run` / `--check`（`information_schema` 断言 2 列 + 2 索引） |
| 3 | `scripts/verifyStrategyDatasetBinding.mts` | **真实 TiDB + 真实 tRPC 全链验证**（101 检查项；含非法引用矩阵、多绑定、legacy 分支、清理回基线） |
| 4 | `scripts/verifyStrategyDatasetBindingUi.mts` | **前端验收等价验证**（46 检查项；组件真实数据源 + 真实判定函数 + 真实 adapter 往返 + 真实 TiDB） |
| 5 | `server/research/strategyPersistence/datasetBindingValidation.ts` | 引用完整性唯一实现（纯判定 + 只读端口 + 三类错误码） |
| 6 | `server/research/strategyPersistence/datasetBindingValidation.test.ts` | 25 例（A 判定 / B 收集 / C 去重与断言 / D 写入门禁 / E 多绑定规则） |

### 1.2 修改（21）

| # | 文件 | 变更要点 |
|---|---|---|
| 7 | `drizzle/schema.ts` | `strategyVersions` / `strategyVersionDatasets` 增列 + 索引 |
| 8 | `scripts/verifyStrategyDomainModel.mts` | STRATEGY-003 验证脚本的裸 SQL 投影读取补上新列（**测试夹具对齐，非产品逻辑**） |
| 9 | `server/research/strategyPersistence/contract.ts` | `StrategyVersionSummary` 增 `datasetVersionId: number \| null`；`saveVersion` 注释写明同事务校验 |
| 10 | `server/research/strategyPersistence/db.ts` | 构造器注入只读端口（默认 `DbDatasetRegistry`）；`saveVersion` 事务内先断言绑定；落库 / 读回 / 摘要映射新列 |
| 11 | `server/research/strategyPersistence/inMemory.ts` | 增 `EMPTY_DATASET_VERSION_REFERENCE_PORT`（**恒失败端口**，宁可失败不静默通过）；`saveVersion` 同样断言 |
| 12 | `server/research/strategyPersistence/index.ts` | 导出 `./datasetBindingValidation` |
| 13 | `server/research/strategyPersistence/service.ts` | `toPatch` / `patchToInput` 透传坐标；**修正 `patchToInput` 的 v1 视图透传缺陷**（见 §10.3） |
| 14 | `server/research/strategyPersistence/strategyDomainPersistence.test.ts` | 投影字段形状契约断言补 `datasetVersionId` |
| 15 | `server/research/strategySchema/compare.ts` | `isMajorChangePath` 增 `datasetVersionId`（坐标变化 = 结构变化 → major） |
| 16 | `server/research/strategySchema/definition.ts` | `StrategyDatasetBinding` 增 `datasetVersionId?`；新增 `STRATEGY_DATASET_VERSION_LABEL_RE` / `isValidDatasetVersionId`；绑定归一化排序键扩为四元组 |
| 17 | `server/research/strategySchema/definitionValidation.ts` | 绑定校验改为「坐标 / legacy 二选一」；去重键含坐标；新增 `isStrategyDatasetVersionLabel`（**排除 `rd-…`**，禁止 label 与 legacy 互相冒充） |
| 18 | `server/research/strategySchema/legacyViews.ts` | `deriveLegacyViews` 由 PRIMARY 绑定单向派生 `datasetVersionId` |
| 19 | `server/research/strategySchema/map.ts` | `alignDefinitionViews` 增坐标双向一致性（冲突 → `SCHEMA_DEFINITION_DATASET_VERSION_ID_MISMATCH`；PRIMARY 是 legacy 却声明坐标也拒绝）；clone / create 路径复制坐标 |
| 20 | `server/research/strategySchema/projection.ts` | 投影行增 `datasetVersionId`；`verifyStrategyProjections` 键字段与比较字段纳入坐标 |
| 21 | `server/research/strategySchema/strategyDefinition.test.ts` | 结构校验表 +2 负例；新增 `D2. Dataset 绑定坐标（STRATEGY-004）` 7 例 |
| 22 | `server/research/strategySchema/types.ts` | `StrategyDocument` 增 `datasetVersionId?`（含「由 PRIMARY 单向派生」的注释纪律） |
| 23 | `server/research/strategySchema/validate.ts` | 新增 `checkDatasetCoordinate`（坐标 / legacy 二选一）；视图一致性比对坐标；派生 universeId 接受 label 或 `rd-…` 后缀 |
| 24 | `server/researchRouter.ts` | 4 个写端点收紧为 `adminProcedure`；新增 5 个端点（详见 §2） |
| 25 | `shared/researchContracts.ts` | 新增 `strategyCloneVersionInputSchema` / `strategySetVersionStatusInputSchema` |
| 26 | `client/src/adapters/strategyAdapter.ts` | `StrategyViewModel` 增 `datasetVersionId`；双向无损映射（null 时**不下发键**） |
| 27 | `client/src/components/strategy/StrategyBasicInfo.tsx` | **Dataset 数据源整体切到 Dataset Registry**（详见 §7） |

### 1.3 本次新增的文档

| 文件 | 说明 |
|---|---|
| `docs/strategy/STRATEGY-004-report.md` | 本报告 |
| `ROADMAP.md` | §44 覆盖式更新（新「最后实查」+ 旧条降级为「此前实查」）+ §47 append-only 追加一条 |

---

## 2. API 变更（SPEC §2.1 D / §10）

### 2.1 `research.strategy.*` 端点表（变更后）

| 端点 | 类型 | 变更 | 实现 |
|---|---|---|---|
| `validate` | mutation | 不变 | 纯领域校验 |
| `bump` | mutation | 不变 | semver 推进 |
| `compare` | mutation | 不变 | 文档比较 |
| `create` | mutation | 🔴 **`publicProcedure` → `adminProcedure`** | `StrategyService.create` |
| `save` | mutation | 🔴 **`publicProcedure` → `adminProcedure`** | `StrategyService.save` |
| `load` | query | 不变（public，读） | `StrategyService.load` |
| `list` | query | 不变（public，读） | `StrategyService.list` |
| `delete` | mutation | 🔴 **`publicProcedure` → `adminProcedure`** | `StrategyService.delete` |
| `createVersion` | mutation | 🔴 **`publicProcedure` → `adminProcedure`** | `StrategyService.createVersion` |
| `loadVersion` | query | 不变（public，读） | `StrategyService.loadVersion` |
| `listVersions` | query | 不变（public，读） | `StrategyService.listVersions` |
| **`loadBundle`** | query | 🆕 public（读） | `StrategyService.loadBundle`（STRATEGY-003 已实现） |
| **`getVersionBundle`** | query | 🆕 public（读） | **同实现别名**（Repository 契约命名） |
| **`validateVersion`** | query | 🆕 public（读） | `StrategyService.validateVersion` |
| **`cloneVersion`** | mutation | 🆕 **admin** | `StrategyService.cloneVersion` |
| **`setVersionStatus`** | mutation | 🆕 **admin** | `StrategyService.setVersionStatus` |

**权限纪律**：**写操作 → `adminProcedure`；读操作不扩大权限**（保持 `publicProcedure`）。`getVersionBundle` 与 `loadBundle` 刻意使用**同一 Service 方法**（不做第二套实现），返回结构逐字段相同 —— 已用指纹相等断言锁定。

### 2.2 新增传输层 schema（`shared/researchContracts.ts`）

```ts
strategyCloneVersionInputSchema    // { strategyId, fromVersion, targetVersion?, bump?, description?(≤512), status? }
strategySetVersionStatusInputSchema // { strategyId, version, status: 8 态字面量 }
```

### 2.3 新增稳定错误码（对外契约）

| 错误码 | 触发条件 |
|---|---|
| `DATASET_VERSION_NOT_FOUND` | `dataset_version.id` 不存在（或已被删除） |
| `DATASET_VERSION_NOT_READY` | 行存在但 `status ≠ READY`（`DRAFT` / `BUILDING` / `FAILED`） |
| `DATASET_BINDING_INVALID` | 行存在且 READY，但绑定语义冲突（label ≠ Registry `version` / `datasetId` 不属该版本 / 坐标形态非法） |

抛出载体为 `StrategyDatasetBindingError`（`code` = 首条 issue 的错误码，`issues` = **全部**问题，绝不只报第一条）。经 tRPC 传输时外层是 `TRPCError`（`code = INTERNAL_SERVER_ERROR`），原始错误在 `cause` 链上 —— 验证脚本按此穿透提取。

---

## 3. DB Migration

| 项 | 内容 |
|---|---|
| 文件 | `drizzle/0035_strategy_dataset_binding_version_id.sql` |
| 目标 | `strategy_versions.datasetVersionId`（bigint NULL）<br>`strategy_version_datasets.datasetVersionId`（bigint NULL）<br>`idx_strategy_versions_dataset_version_id`<br>`idx_strategy_version_datasets_version_id` |
| 幂等机制 | SQL 内 `-- @guard: column\|index <table>.<name>` 指令；apply 脚本解析后向 `information_schema.COLUMNS` / `STATISTICS` 查询，命中即跳过该 DDL |
| 执行方式 | `scripts/applyStrategyDatasetBindingVersionId.mjs`（支持 `--dry-run` / `--check`） |
| **实跑证据** | ① `--dry-run` → 4 条语句待执行；② apply → 4 条全部执行成功；③ `--check` → `{"pass": true, "failures": []}`；④ **二次 apply → 4 条全部 `skipped`（幂等成立）** |
| 回填 | **无需回填** —— 执行前 `strategy_versions` / `strategy_version_datasets` **均为 0 行**（实查） |
| 表结构来源 | `drizzle/schema.ts`（唯一权威），**未使用** `drizzle-kit generate` / `npm run db:push`（该仓库自 0024 起 journal / snapshot 停维护） |

⚠️ **未加外键**（项目全局约定）：跨模块引用完整性由**应用层 + 同一事务内校验**承担，见 §4.3 的诚实边界登记。

---

## 4. 新旧绑定模型对比（SPEC §3 / §4）

### 4.1 对比表

| 维度 | 旧模型（STRATEGY-003 及以前） | 新模型（STRATEGY-004） |
|---|---|---|
| 跨模块坐标 | `datasetVersion = "rd-1.0.0-1-cffc2a0e66efbf0b"`（内容寻址串） | **`datasetVersionId = 390002`（`dataset_version.id`）** |
| `datasetVersion` 字段语义 | 唯一引用标识 | **降级为显示 / 快照 label**（`v1` / `v2`） |
| 校验方式 | 正则 `/^rd-\d+\.\d+\.\d+-\d+-[0-9a-f]{16}$/` 格式校验 | **查 Dataset Registry**：存在 ∧ `status = READY` ∧ label 一致 ∧ `datasetId` 属于该版本 |
| 与 Research 的 Dataset 是否同源 | ❌ 否（Research 消费的 `v1`/`v2` 在旧模型下**根本无法通过校验**） | ✅ 是（同一 `dataset_version.id`） |
| 校验时机 | 领域文档校验（无 IO） | **持久化事务内**（与写入同一一致性边界） |
| 失败语义 | `SCHEMA_DEFINITION_DATASET_VERSION_INVALID`（格式错） | 三类结构化引用错误码（见 §2.3） |
| 非法引用是否可能落库 | ✅ 可能（任何形状合法的 `rd-…` 均可落库） | ❌ 不可能（事务回滚，零行写入） |
| legacy `rd-…` 分支 | 唯一路径 | **保留为兼容分支**：无坐标 ⇒ 不做 DB 校验、显式标注「未校验」、坐标列落 `NULL`；且 label 与 `rd-…` **禁止互相冒充** |

### 4.2 单向派生链（不新增第二套 SoT）

```
Canonical:  definition.datasets[PRIMARY].datasetVersionId        ← 权威
                          │ 单向派生（fillOrCheck，冲突则响亮报错）
                          ▼
doc 级镜像:  StrategyDocument.datasetVersionId                   ← 兼容视图
                          │ 单向派生
                          ▼
投影表:      strategy_version_datasets.datasetVersionId          ← 查询投影
             strategy_versions.datasetVersionId
```

方向铁律不变：**`Canonical → Projection` 单向**；新增列全部是派生视图，`Projection → Canonical` 仍然被禁止（`verifyStrategyProjections` 会把漂移报成 `SCHEMA_DEFINITION_VIEW_DRIFT`）。**未修改** `StrategyDefinition` / `StrategyDocument` 的 Canonical 结构与 `Canonical → Projection` 方向本身。

### 4.3 事务与诚实边界

`DbStrategyRepository#saveVersion` 的事务体顺序：

```
BEGIN
  assertStrategyDatasetBindings(collectStrategyDatasetBindingRequests(document), datasetRegistry)  ← 引用完整性
  INSERT strategy_versions (…, datasetVersion, datasetVersionId, …)
  writeProjections(…)  ← canonical 与 5 类投影同事务
COMMIT
```

- ✅ 不存在「Strategy 保存成功但 Dataset Binding 实际无效」；
- ✅ 不再存在「校验通过后、写入前」的时间窗（校验在事务内）；
- ⚠️ **诚实登记的残留**：项目约定不加外键，因此无法用数据库层阻止「**校验后、提交前**另一个事务删除该 `dataset_version`」。这是应用层一致性的已知残留窗口，已在 `db.ts` 源码注释里显式写明，**不静默**。

---

## 5. 真实 TiDB 验证结果（SPEC §12）

脚本：`scripts/verifyStrategyDatasetBinding.mts` — **101 检查项 / 0 失败 / VERDICT=PASS**，**连跑两次结果完全一致**（可复现）。

### 5.1 前置事实（实查，非报告）

| 事实 | 实测值 |
|---|---|
| `dataset_definition` | 1 行：`id = 120001` / `datasetCode = first_limit_pullback` / `name = 首板回踩` |
| `dataset_version` | 2 行：`390001 → v1 / READY`、`390002 → v2 / READY` |
| 非 READY 版本 | **0 行**（⚠️ 影响 §6.2 的方法论，见下） |
| 基线行数 | `strategies` / `strategy_versions` / 5 张投影表 **全部 0 行** |

### 5.2 Migration 断言

`0035` 的 4 条 `@guard` 指令全部命中 `information_schema`：2 列 + 2 索引。

### 5.3 正向：坐标绑定的创建 → 落库 → 读回

创建 `Dataset = first_limit_pullback` / `Version = v2` / `datasetVersionId = 390002` / `Role = PRIMARY`：

| 断言层 | 结果 |
|---|---|
| 真实 tRPC `create` / `save`(×2 幂等) / `load` / `list` / `listVersions` / `loadVersion` / `loadBundle` / `getVersionBundle` / `validateVersion` | 全部 PASS（`save` 两次不产生重复版本；`getVersionBundle` 与 `loadBundle` 指纹一致） |
| 裸 SQL：`strategy_versions.datasetVersionId` | `= 390002` ✅ |
| 裸 SQL：`strategy_versions.datasetVersion`（label 快照） | `= "v2"` ✅ |
| 裸 SQL：**`JOIN dataset_version`** | `version = "v2"` ∧ **`status = "READY"`** ✅ |
| 裸 SQL：**`JOIN dataset_definition`** | `datasetCode = "first_limit_pullback"` ✅ |
| 裸 SQL：`strategy_version_datasets` 投影 | 1 行，`datasetId` / `datasetVersion=v2` / `datasetVersionId=390002` / `role=PRIMARY` ✅；`JOIN dataset_version` → `v2` / `READY` ✅ |
| 投影漂移 | `validateVersion.projectionDrifts` 长度 0 ✅ |

**§12 要求的三段链路已完整闭环**：`Strategy Version → datasetVersionId = 390002 → dataset_version → version = v2 → status = READY`。

### 5.4 坐标随版本演进正确继承

| 路径 | 结果 |
|---|---|
| `cloneVersion`（1.0.0 → 2.0.0，重复调用 → `idempotent-skip`） | 新版本与投影**均带 `datasetVersionId = 390002`** ✅ |
| `createVersion`（改参数默认值 → 语义闸门判定 major → 3.0.0） | 产物与投影坐标仍为 `390002`；`parentVersionId` 指向 2.0.0 行 ✅ |
| `setVersionStatus`（Draft → Research） | 落库生效且**内容指纹不变**（`status` 是唯一可变列）✅ |

### 5.5 多绑定规则（SPEC §9 末项）

`PRIMARY(390002/v2) + VALIDATION(390001/v1) + OOS(390001/v1)`：领域校验通过 → 落库 3 行 → 裸 SQL 断言 role↔坐标映射正确、**三个目标版本全部 READY** → `validateVersion` 全量校验 PASS。

> 📌 归一化顺序是 `(role, datasetId, datasetVersion, datasetVersionId)` **升序**，因此是 `OOS < PRIMARY < VALIDATION`（字典序），**不是** role 白名单序。初版断言按白名单序写错，已按真实归一化口径修正 —— 记录在此以免后续重复踩。

### 5.6 清理

脚本 `finally` 内逆序级联删除 + **启动时自愈清理 `s004-%` 残留**；执行后 7 张表**全部回到基线 0 行**，无残留，`dataset_definition` / `dataset_version` 行数**全程未变**。

---

## 6. 非法引用测试结果（SPEC §9）

全部为真实 TiDB + 真实 tRPC（例外项已显式标注方法论）。每条用例使用**独立 `strategyId`**，除断言错误码外**同时断言零写入**（`strategies` / `strategy_versions` / 投影表三处计数均为 0 ⇒ 同事务回滚成立）。

| # | 场景 | 期望错误码 | 实测 | 零写入 |
|---|---|---|---|---|
| 6.1 | `datasetVersionId = 999999999`（不存在） | `DATASET_VERSION_NOT_FOUND` | ✅ 通过（真实 tRPC） | ✅ |
| 6.2a | `status = DRAFT` | `DATASET_VERSION_NOT_READY` | ✅ 通过 | ✅ |
| 6.2b | `status = BUILDING` | `DATASET_VERSION_NOT_READY` | ✅ 通过 | ✅ |
| 6.2c | `status = FAILED` | `DATASET_VERSION_NOT_READY` | ✅ 通过 | ✅ |
| 6.3 | 交叉绑定：坐标指向 `first_limit_pullback` 的 v2，`datasetId` 写 `second_board_pullback` | `DATASET_BINDING_INVALID` | ✅ 通过（真实 tRPC） | ✅ |
| 6.4 | label 与 Registry 不一致：`id = 390002` 却写 `datasetVersion = "v1"` | `DATASET_BINDING_INVALID` | ✅ 通过（真实 tRPC） | ✅ |
| 6.5 | 坐标形态非法：`datasetVersionId = 0` | 领域层 `SCHEMA_DEFINITION_DATASET_VERSION_ID_INVALID`（**分层拒绝**，早于引用校验） | ✅ 通过 | ✅ |
| 6.6 | 声明坐标却把 `rd-…` 当 label（label 与 legacy 互相冒充） | 拒绝（`SCHEMA_DEFINITION_DATASET_VERSION_INVALID`） | ✅ 通过 | — |
| 6.7 | 两个 `PRIMARY` binding | 领域层拒绝（PRIMARY 唯一） | ✅ 通过 | ✅ |
| 6.8 | `cloneVersion` 源版本不存在 | 失败，无静默兜底 | ✅ 通过 | — |

### 6.2 方法论披露（重要，不隐瞒）

真实库当前**只有 READY 版本**（`390001` / `390002`），且 SPEC §8 **禁止修改 Dataset**（`dataset_version` 等表）。因此 `DATASET_VERSION_NOT_READY` 的三条用例在**只读端口**这一已文档化的接缝上做 `status` 覆盖：校验门读到的仍是真实行的 `id` / `datasetId` / `version`，**只有 `status` 被替换**；端口查询调用以 `390002` 真实坐标发起（脚本已断言）。

**未修改 Dataset 的复核**：场景前后逐行比对 `dataset_version`（`id:datasetId:version:status` 四元组序列**完全一致**），且 `dataset_definition` / `dataset_version` 行数未变。

**未来的加强路径**：待真实存在非 READY 版本（如某次构建正在 `BUILDING`）时，可用同一脚本改为直接引用真实行，无需改代码结构。

---

## 7. 前端验证结果（SPEC §11）

### 7.1 变更摘要

`client/src/components/strategy/StrategyBasicInfo.tsx`：

- **删除** `trpc.researchDataset.list`（旧 `research_datasets` 表与 Dataset Registry **不是同一套坐标**）；
- 改为 `trpc.datasetRegistry.listDefinitions` / `getDefinition({ definitionId })` / `getVersion({ datasetVersionId })` —— **与 Research 的 `CreateExperimentDialog` 完全同源**；
- 两级选择器：数据集定义 → 数据集版本；
- **只允许 READY**：判定复用 `isUsableVersionStatus`（`client/src/components/research/createExperimentForm.ts`，与 Research 同一处口径，其注明「与后端断言同源」）；
- 非 READY 版本**显示但 `disabled`**（写明状态 + 「不可用于策略绑定」），而非藏起来（避免困惑）或放过去（避免白跑一次）；
- 选择结果写入：`datasetVersionId = entry.id`（权威坐标）、`datasetVersion = entry.version`（label）、`universeId = research-dataset:<label>`（派生）、人类可读 `universeDescription`；
- **重新打开回显**：用已保存坐标反查 `getVersion` → 得到 `datasetId` → 定位所属定义 → 显示当前选中项；坐标不属于任何可见版本时有显式的「当前引用 · 已不在该版本清单中」占位项；
- 切换到另一个 Dataset 定义时**清空旧坐标**（避免把上一个数据集的版本带过去）。

### 7.2 验收方法与结果

⚠️ **本执行环境无法启动 Chromium**：`agent-browser open about:blank` 与 `/strategy-editor` 均**挂起无输出**（已 `TaskStop` 中止），且仓库未安装 `jsdom` / `@testing-library`、安装被沙箱禁止。因此在**不降低证据强度**的前提下改用四项等价验证，全部真实执行：

脚本：`scripts/verifyStrategyDatasetBindingUi.mts` — **46 检查项 / 0 失败 / VERDICT=PASS**。

| SPEC §11 判据 | 验证方式 | 结果 |
|---|---|---|
| 选择器必须来自 Dataset Registry | 静态断言组件代码**不再含** `researchDataset`/`trpc.researchDataset`（去注释后判定），且含 `datasetRegistry.listDefinitions/getDefinition/getVersion` | ✅ |
| 能看到 `first_limit_pullback` | 真实 tRPC `datasetRegistry.listDefinitions` → 命中 `first_limit_pullback (id=120001)` | ✅ |
| 能看到 `v1` / `v2` | 真实 tRPC `getDefinition({definitionId:120001})` → 版本清单 `390001(v1,READY)` / `390002(v2,READY)` | ✅ |
| 只能选 READY | 用**组件真实导入的** `isUsableVersionStatus` 判定：`READY` → true（正例，排除空转）；`DRAFT`/`BUILDING`/`FAILED`/`""`/`"ready"`/`"READY "` → 全部 false；且组件对非 READY 渲染 `disabled`（源码断言） | ✅ |
| 重新打开后正确回读 | 真实落库文档 → `strategyToViewModel` → `datasetVersionId = 390002` / `datasetVersion = "v2"` / `universeId` 派生一致；→ `viewModelToStrategy` → 真实 tRPC `save` → 真实 tRPC `load` → adapter 回显仍 `390002` | ✅ |
| Dataset Version ID 与后端一致 | 裸 SQL 读 `strategy_versions.datasetVersionId` = **UI 回显值**；`JOIN dataset_version` → `version = "v2"` **= UI label**、`status = READY` ⇒ **UI / 后端 / DB 三方一致** | ✅ |
| legacy 分支不破 | `datasetVersionId === null` 时 wire **不含该键**（后端 legacy 分支才成立）；保存后重新打开仍为 `null`、label 原样保留 | ✅ |

**未采用的验证手段（如实登记）**：真实浏览器渲染截图。**「tsc + 单测过了」不等于「画对了」** —— 但本 STEP 的验收对象是**数据源与坐标正确性**（而非视觉），且上述四项均为真实数据链路证据。若用户希望实机确认，请在本机浏览器打开 `http://localhost:3000/strategy-editor`（开发服务器已在 3000 端口监听，实测 HTTP 200）。

---

## 8. 全量测试结果（SPEC §13）

| 关卡 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | **exit 0** ✅ |
| 范围套件 | `npx vitest run server/research/strategySchema server/research/strategyPersistence server/datasetRegistry` | **17 文件 / 408 例全过** ✅ |
| STRATEGY-003 全链回归 | `npx tsx scripts/verifyStrategyDomainModel.mts` | **89/89 PASS** ✅ |
| STRATEGY-004 全链 | `npx tsx scripts/verifyStrategyDatasetBinding.mts` | **101/101 PASS**（连跑两次一致）✅ |
| 前端验收 | `npx tsx scripts/verifyStrategyDatasetBindingUi.mts` | **46/46 PASS** ✅ |
| Dataset 一致性 | `npx tsx scripts/verifyDatasetConsistency.mts` | **PASS**（两次构建 diff 为空）✅ |
| 全量单测 | `npx vitest run` | **217 文件 / 3460 例 / 15 失败 / 7 文件**（见下） |

### 8.1 15 个失败的归属（零新增失败）

失败集合：

| 文件 | 例数 | 性质 |
|---|---|---|
| `server/dataHealth.test.ts` | 1 | 既有证据快照期望（`G4` 期望值）—— §44 **早已登记**「仍 1 例失败且未修」，属数据域治理独立遗留 |
| `server/image.uploadAndRecognize.test.ts` | 1 | 源码字符串断言（测试期望在某文件文本里搜到 `syncUploadedDatePrices`）—— 陈旧测试 |
| `server/limitUp.test.ts` | 1 | 真实库前置数据 |
| `server/limitUp.watch.test.ts` | 4 | 真实库 watch 状态 |
| `server/marketData.test.ts` | 4 | 真实库写入路径 |
| `server/tushare.secret.test.ts` | 1 | 缺 `TUSHARE_TOKEN` 环境变量 |
| `server/tushareTradingCalendar.test.ts` | 3 | 外部 API 网络超时（5s timeout） |

**三重证据证明与本 STEP 无关**：

1. **导入依赖**：逐一检查上述 7 个文件，**无一个** import `strategy*` / `datasetRegistry` / `researchRouter` / `research/` 下的任何模块；
2. **跨会话基线一致**：`ROADMAP.md §47` 中**相邻的独立会话**在本轮之前记录的全量结果同样是「**217 文件 / 3460 例 / 15 失败 / 7 文件**」并判定「与既有基线逐项一致 ⇒ 零新增失败」——总数与文件数**完全相同**；
3. **失败原因**：全部是「真实 DB 前置状态 / 外部 API / 环境变量 / 陈旧断言」四类环境性原因，无一与 Dataset 坐标或 Strategy 写入门禁相关。

### 8.2 已知的脚本级失败（未修，且不应由本 STEP 修）

`scripts/verifyDatasetRegistryRead.mts` **FAIL**：断言 `v2 eventCount === 10240`，实测 `23978`。

- 该脚本是 DATASET-002.3 的只读 smoke 探针，**硬编码**了当时的绝对计数（10,240 / 206,408 / 30,720）；
- `dataset_version.totalEvents` 早在 STRATEGY-004 开始**之前**就是 `23978`（本 STEP 第一次只读探测即读到该值，**先于任何写入**）；
- 属 **Dataset 模块**的文件，SPEC §8 明令禁止改动 ⇒ **未修**，仅登记。

---

## 9. Legacy 未修改证明

| 检查 | 结果 |
|---|---|
| `git status --porcelain -- server/strategy` | **无输出**（相对 HEAD 完全一致） |
| `find server/strategy -newermt "2026-09-12 17:20"` | **空**（STRATEGY-004 工作窗口内零改动） |
| `server/strategy/` 下是否新增文件 | 否 |
| Migration 是否触碰 legacy 表 | 否（`0035` 只动 `strategy_versions` / `strategy_version_datasets`） |
| legacy `rd-…` 兼容逻辑是否被删除 | **否** —— 分支保留且被测试覆盖（§6 legacy 用例、§5.4、§7.2） |

**SPEC §8 明令禁改、本 STEP 未触碰**：`server/strategy`（legacy）、`leaderCandidateBaselineStrategy`、`paramSearch`、`walkForward`、legacy backtest / Executor / Parameter Search / OOS / Walk-Forward / Simulation。

---

## 10. Dataset / Research 未修改证明

### 10.1 机器可核证据

| 检查 | 结果 |
|---|---|
| `git diff --stat -- server/researchEngine` | **空**（内容与 HEAD 逐字节一致） |
| `find server/datasetRegistry server/strategy server/researchEngine server/researchCore.ts -newermt "2026-09-12 17:20"` | **空**（窗口内零改动） |
| `server/researchEngine` / `server/researchCore` 是否被本 STEP 修改 | 否 |
| `server/datasetRegistry/` 下的工作区改动 | 存在，但**全部来自更早的 DATASET-* STEP**（`git diff --stat` 显示 13 文件 / +3431-492），**不在本 STEP 窗口内**，与本 STEP 无关 |
| Dataset 四表行数与内容 | `dataset_definition` / `dataset_version` / `dataset_build_job` / `ds_*` —— **本 STEP 全程未写入**；验证脚本前后复核行数与 `dataset_version` **逐行四元组**完全一致 |
| `research_result` / `research_conclusion` | 表定义与数据**未改动**；本 STEP 未新增任何 Research 侧列（SPEC §7：**不做 Research → Strategy**） |
| Dataset Registry 行为回归 | `server/datasetRegistry` 测试 **8 文件全部通过**（含 `registry` 47 例 / `router` 31 例 / `runner` 12 例 / `query` 13 例等）；`verifyDatasetConsistency.mts` PASS |

### 10.2 ⚠️ 并行会话披露（避免归属混淆）

本仓库**当前有并行会话**在改动前端研究分析（`client/src/components/research/GroupMetricChart.tsx` 等「反推对照组」工作）与新增一次性脚本（`scripts/_oneoff_*.mts`，创建于 17:58 / 17:59）。**这些均非本 STEP 所改**，本报告不主张其归属，也不触碰其文件。STRATEGY-003 期间同样出现过「首次 tsc 报 `GroupMetricChart.tsx` 错、随后自行消失」的现象，原因即为此。

**本 STEP 收尾时再次复现该现象（如实记录）**：18:05 的一次 `tsc --noEmit` 报 `client/src/components/research/VariableSeriesChart.tsx(169,62) TS2322`（recharts 自定义 tick 的已知坑）—— 该文件是**并行会话 18:03 新建的未跟踪文件**（`?? ` / mtime 18:03），而本 STEP 的四个代表文件 mtime 均为 17:29~17:30。18:06 复核 **`tsc --noEmit` exit 0**（对方已修）。⇒ **该瞬时错误与本 STEP 无关**，且本 STEP 的 17:58 全量 tsc 即为 exit 0。

### 10.3 顺带修掉的一个真实缺陷（属 Strategy 模块内部，非跨模块违规）

**缺陷**：`StrategyService#patchToInput`（供 `createVersion` 的 bump 语义闸门构造候选文档）在**传入新 `definition`** 时仍把 base 的 v1 视图（`entryRules` / `exitRules` / `riskRules` / `positionSizing` / `parameters`）透传下去；而 `cloneStrategyDocument` 的既有契约明写「传入新 definition 时，v1 视图必须由它重新派生 —— 因此不再透传 base / patch 的视图字段」。两者**相反** ⇒ 只要 definition 变更了任一视图，组装层 `alignDefinitionViews` 就报 `SCHEMA_DEFINITION_VIEW_CONFLICT` ⇒ **`createVersion(带 definition)` 恒失败**（STRATEGY-003 的验证脚本未覆盖该路径，故此前未被发现）。

**触发方式**：本 STEP 的 SPEC §10 要求「必须验证 `createVersion` 真实走 tRPC → Service → Repository → TiDB」，真实执行时暴露。

**修复**：`patchToInput` 在 `patch.definition !== undefined` 时**不下发视图键**，由组装层从新 definition 单向派生 —— 与 `cloneStrategyDocument` 严格对齐。**未改变 clone / bump 的语义**（`cloneStrategyDocument` 一行未动），只修正了「候选文档的构造口径」。

---

## 11. 剩余下一阶段断点（诚实登记）

| # | 断点 | 严重度 | 说明 / 建议 |
|---|---|---|---|
| 1 | `dataset_version` **无「非 READY」真实样本** | 中 | `DATASET_VERSION_NOT_READY` 的行级验证目前依赖只读端口覆盖。待出现真实 `DRAFT`/`BUILDING`/`FAILED` 版本时改用真实行复核（脚本结构无需改） |
| 2 | **无外键 ⇒ 校验─提交间的应用层残留窗口** | 低-中 | 无法阻止「校验通过后、提交前另一事务删除该 `dataset_version`」。已在 `db.ts` 注释登记。若未来放宽「不加 FK」约定，这是首个应加的约束 |
| 3 | **Research → Strategy 未连接** | 高（下一 STEP 的核心） | `research_run` / `research_analysis` / `research_result` 仍**零 strategy 列**。Research 的结论无法回挂到具体 Strategy Version —— 本 STEP SPEC §7 明确禁止实施，留作下一阶段 |
| 4 | **`research_result` / `research_conclusion` 无 `strategyVersionId`** | 高 | 与 #3 同源；且据 `AUDIT-DRS-001`，此类改动需与 Research Engine 一同设计（不可只加列） |
| 5 | Strategy 侧**无「按 Dataset 反查策略」能力** | 低 | 新增了 `idx_strategy_versions_dataset_version_id`，索引已就位但**尚无查询端点**（避免超范围实现） |
| 6 | `verifyDatasetRegistryRead.mts` 陈旧基线 | 低 | 硬编码 10,240 事件 vs 现实 23,978 ⇒ FAIL。属 Dataset 模块（SPEC §8 禁改），建议由 Dataset 侧维护者改为「动态读取 `totalEvents` 或仅断言 > 0」 |
| 7 | 前端**无组件级渲染测试** | 低 | 仓库缺 `jsdom` / `@testing-library`，且沙箱禁止安装 ⇒ `StrategyBasicInfo` 的行为只能靠「真实判定函数 + 真实数据源 + 真实 adapter 往返」等价验证（§7.2）。若未来引入前端测试环境，应补组件级用例 |
| 8 | `dataHealth.test.ts` 1 例失败 | 低（独立遗留） | §44 早已登记「未修」，属数据域治理（认证快照 vs 期望值），与本 STEP 无关 |
| 9 | 本机**无法运行浏览器自动化** | 低 | `agent-browser` 启动 Chromium 挂起（沙箱）；相邻会话独立复现同一现象 |

**建议的下一 STEP（仅供参考，未执行）**：打通 **Research → Strategy** 的方向性引用（让 `research_result` / `research_conclusion` 能归属到具体 `strategyVersionId`），或补齐 **Strategy 按 Dataset 坐标反查**的只读查询端点。**本 STEP 完成后停止，等待下一步指令。**

---

## 附：验收清单对照（SPEC §14）

| 清单 | 判据 | 结论 |
|---|---|---|
| **Architecture** | `datasetVersionId = dataset_version.id` 为唯一跨模块坐标；未建第二套 Dataset Version ID；未复制 Registry 版本表；v1/v2 仅为 label；`Canonical → Projection` 方向未变 | ✅ PASS |
| **Integrity** | 保存前查 `dataset_version` 且必须 `READY`；三类错误码齐备；无「只校验格式」「自动创建 / 自动补 Dataset」「绕过 Registry」 | ✅ PASS |
| **API** | 新增 5 端点全部可用；写操作 → `adminProcedure`；读操作未扩大权限；13 端点真实走 tRPC → Service → Repository → TiDB | ✅ PASS |
| **Frontend** | 选择器来自 Dataset Registry；可见 `first_limit_pullback` / `v1` / `v2`；仅 READY 可选；重新打开正确回显；坐标与后端一致 | ✅ PASS（等价验证，方法见 §7.2） |
| **Compatibility** | legacy `rd-…` 分支保留且未被删除；legacy 绑定落库 `datasetVersionId = NULL`；未破 STRATEGY-003 全链（89/89） | ✅ PASS |

**STRATEGY-004 = COMPLETE**
