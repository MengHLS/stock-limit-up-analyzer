# STRATEGY-003 差异报告（STEP 1–5 交付物）

> 任务：STRATEGY-003 — Strategy Domain Model & Persistence Architecture
> 审计时间：2026-09-12 15:30–15:50 GMT+8
> 证据口径：**真实 TiDB 实查（information_schema + 行数）> 真实代码坐标（文件:行）> 文档**
> 本轮状态：**只读审计，未改动任何生产代码 / 未执行任何 DDL / 未写入任何数据**

---

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 现状判定 | Strategy Definition + Versioning **CODE_READY**（STEP-001）、Persistence + CRUD **CODE_READY**（STRATEGY-002）；本任务目标域模型 **PARTIAL** |
| 真实 DB | `strategies`（**0 行** / 7 列）、`strategy_versions`（**0 行** / 10 列）——**仅 2 张表**，目标 7 表中 5 张不存在 |
| 迁移风险 | **极低**：两表零数据，`ALTER TABLE ADD COLUMN` 无回填、无兼容转换 |
| 最大缺口 | ① Entry/Exit/Execution 仍是 **flat `DeclaredRule[]`**（无 event / window / conditions / trigger / signalTiming vs executionTiming 分离）；② 无 `parameter_role`（FIXED/TUNABLE/DERIVED）；③ 无 `parent_version_id`；④ **无 Look-Ahead 静态校验**；⑤ 无 5 张结构化辅助表；⑥ **无「按指定版本 clone」语义** |
| 最大风险 | `strategy_versions.versionRecordJson` **内嵌了一份完整 strategy 副本** ⇒ 与 `strategyDocumentJson` 形成双份定义（SoT 唯一性必须显式裁定） |
| 建议 | 按 §7 设计**增量演进**（不重命名既有列、不新建并行领域模块），分 STEP 6–15 落地；**3 项设计口子需用户裁定**（见 §13） |

---

## 1. §45 十三问逐条回答

| # | 问题 | 证据化回答 |
|---|---|---|
| 1 | 当前 `strategies` 是什么结构？ | 真实 DB 7 列：`id(PK)` / `strategyId varchar(64) UNIQUE` / `name varchar(128)` / `latestVersion varchar(32)` / `status varchar(32) DEFAULT 'Draft'` / `createdAt` / `updatedAt(ON UPDATE)`。索引 4 项（PRIMARY + unique(strategyId) + idx(strategyId) + idx(createdAt)）。**0 行**。定义：`drizzle/0026_strategy_persistence.sql:6-20`、`drizzle/schema.ts:486-498` |
| 2 | 当前 `strategy_versions` 是什么结构？ | 真实 DB 10 列：`id(PK)` / `strategyId` / `version varchar(32)` / `strategyDocumentJson longtext` / `versionRecordJson longtext` / `fingerprint varchar(64)` / `datasetVersion varchar(96)` / `universeId varchar(128)` / `codeVersion varchar(64)` / `createdAt`；`UNIQUE(strategyId,version)`。**0 行**。定义：`drizzle/0026_strategy_persistence.sql:22-39`、`drizzle/schema.ts:517-539` |
| 3 | 当前 Definition 是什么格式？ | `StrategyDocument`（`server/research/strategySchema/types.ts:228-265`）：`recordKind/recordVersion` + §16 全字段（strategyId/version/name/description/universe/**entryRules/exitRules(positionSizing)/riskRules**/parameters/datasetVersion/executionAssumptions/recipe/metadata/fingerprint）。规则为 **flat `DeclaredRule`**（id/kind/description/field/operator/operand/note，`types.ts:88-101`）；`parameters` 为 `ResearchParameterSchema`（name/type/required/defaultValue/min/max，**无 role**） |
| 4 | 是否已有 Entry / Exit / Parameter？ | **名似而实异**：`entryRules`/`exitRules` 只是「人类可读 + 可选 field/operator/operand」的声明清单，**无 event / observationWindow / conditions / trigger**；参数**无 `parameter_role`**。执行假设已有 `executionModel`（`NEXT_OPEN` 等 5 值白名单）+ `backtestConfig` + `costModel`，但**无 signalTiming / executionTiming 分离** |
| 5 | 当前 Research 如何读取 Strategy？ | **不读**。Research Engine 输入边界是 `datasetVersionId` + 变量集（`research_run.inputSnapshotJson` 实证：只有 `datasetVersionId/datasetCode/variables/analysisTypes`）。`research_strategy_candidate.strategyDefinitionId` 是对 `strategies.strategyId` 的**软引用（varchar，无 FK）**，**0 行**；遗留复数 `research_experiments.strategyId/strategyVersion` 是**自由文本冗余列**（无外键） |
| 6 | 当前 Backtest 如何读取 Strategy？ | **走另一套**。`server/strategy/strategyBacktest.ts:28-30` 依赖 `strategyRegistry` + `registerBuiltInStrategies()`（`server/strategy/strategies/leaderCandidateBaseline.ts`），**完全不 import `StrategyDocument`**；`StrategyConfig`（`server/strategy/contract.ts`）与 `StrategyDocument` 是两套类型 |
| 7 | 哪些代码可以复用？ | ① `canonicalStringify`（`server/researchDataset/version.ts`）+ sha256 指纹范式；② `strategySchema/{version,compare,map,serialize,validate}.ts`（semver / bump 闸门 / canonical / 指纹复核）；③ `strategyPersistence/{contract,db,service,inMemory}.ts`（幂等三态 + ER_DUP_ENTRY 1062 兜底）；④ `server/researchRouter.ts:83-154` strategy router（10 端点）；⑤ `ResearchValidationResult/Issue` 校验体系（`server/research/experimentValidation.ts`） |
| 8 | 哪些代码需要修改？ | ① `strategySchema/types.ts`（+富模型类型）；② 新增 definition 校验（含 look-ahead）+ 指纹；③ `strategySchema/map.ts`（+ clone-by-version / v1 派生视图）；④ `strategyPersistence/{contract,db,inMemory,service}.ts`（+5 表读写 + parent + clone）；⑤ `server/researchRouter.ts`（+cloneVersion / loadVersion 富返回）；⑥ `drizzle/schema.ts` + 新 migration + apply 脚本 |
| 9 | 哪些 DB 变化必须 Migration？ | `strategies` 加列（description / strategyType / currentVersionId）；`strategy_versions` 加列（parentVersionId / status / description / updatedAt）+ 2 索引；**新建 5 表** `strategy_parameters` / `strategy_entry_rules` / `strategy_exit_rules` / `strategy_execution_rules` / `strategy_version_datasets` |
| 10 | 是否存在旧 Strategy 模型？ | **存在，且是两套并存**：治理型（`StrategyDocument`，本任务对象）与**执行配方型**（`server/strategy/contract.ts` + `registry.ts` + `strategies/leaderCandidateBaseline.ts` + `strategyBacktest.ts`，5 个内置策略）；另有 `client/src/lib/firstBoard.ts` 首板过滤工具。二者**互不引用** |
| 11 | 是否存在重复 Source of Truth？ | **存在 1 处真实重复**：`strategy_versions.versionRecordJson` 内嵌 `strategy`（= `strategyDocumentJson` 的完整副本，`types.ts:308`），且读取路径以 `versionRecordJson` 为权威（`db.ts:201`）；另 `strategies.latestVersion` 是对 `strategy_versions` 的**冗余可变列**（`service.ts:199-208` 每次写入重算） |
| 12 | 是否存在未来数据引用风险？ | **是，且完全无防线**。`strategySchema/validate.ts` 只校验结构/类型/一致性（错误码仅 `STRATEGY_ID_EMPTY`/`STRATEGY_ID_MISMATCH`/`STRATEGY_MISSING` 等），**无任何 T/T+1 时序校验**。当前 `executionModel="NEXT_OPEN"` 靠约定而非校验 |
| 13 | 是否存在 Strategy Version 可变问题？ | 内容层面**不可变已成立**（UNIQUE(strategyId,version) + 同版本不同指纹 → conflict 拒绝，`db.ts:144-154`；**无 UPDATE 入口**）。但缺 ① `parent_version_id`（演进关系不可追溯）；② `status`（无生命周期列，`strategies.status` 无法表达「某版本已发布」）；③ `updatedAt` |

---

## 2. 现状架构（真实）

```
server/research/strategySchema/     ← STEP-001 / C-15.1 领域（CODE_READY，28 例）
    types.ts       StrategyDocument(§16 flat) + StrategyVersionRecord(§17 九项追溯)
    validate.ts    validateStrategyDocument / validateStrategyVersionRecord
    serialize.ts   canonical JSON + sha256（compute*Fingerprint / serialize / deserialize 复核）
    version.ts     semver parse/format/compare/bump
    compare.ts     compareStrategyDocuments / classifyRequiredBumpKind
    map.ts         createStrategyDocument / cloneStrategyDocument / createStrategyVersionRecord

server/research/strategyPersistence/  ← STRATEGY-002 持久化（CODE_READY，12 例）
    contract.ts    StrategyRepository（保存实体 / 版本幂等三态）
    db.ts          DbStrategyRepository（drizzle + strategies/strategy_versions）
    inMemory.ts    InMemoryStrategyRepository（契约逻辑测试用）
    service.ts     StrategyService（create/save/load/createVersion/list/delete）
    index.ts

server/researchRouter.ts:83-154      ← research.strategy.* 10 端点（create/save/load/list/delete/
                                        createVersion/loadVersion/listVersions/validate/bump/compare）

server/research/lifecycle/           ← C-21.1 生命周期状态机（八态，30 例）
    STRATEGY_LIFECYCLE_STATUSES = Draft→Research→Candidate→Validated→Paper→Approved→Production→Retired

client/src/adapters/strategyAdapter.ts + pages/StrategyEditor.tsx  ← FE-4（9 例）

【旁路】server/strategy/  ← 执行配方型策略（registry + leaderCandidateBaseline + strategyBacktest），
                            与 StrategyDocument 零交集；client/src/lib/firstBoard.ts 同理
```

**真实 DB 快照（2026-09-12 15:40 实查）**

| 表 | 行数 | 列数 | 关键约束 |
|---|---|---|---|
| `strategies` | **0** | 7 | UNIQUE(strategyId) |
| `strategy_versions` | **0** | 10 | UNIQUE(strategyId, version) |
| `research_strategy_candidate` | **0** | 14 | 软引用 strategyId（无 FK） |
| `strategy_parameters` / `_entry_rules` / `_exit_rules` / `_execution_rules` / `_version_datasets` | — | — | **不存在** |

---

## 3. 差异矩阵（SPEC 目标 vs 现状 → 处置）

| SPEC 目标 | 现状 | 处置 |
|---|---|---|
| `strategies.code` | `strategyId`（varchar 64，业务键） | **复用，不改名**（改名会连带 FE 契约 / 3 模块 / 现有测试） |
| `strategies.strategy_type` | 无 | **新增列**（varchar 32 NULL，本任务只落结构，不做枚举强校验） |
| `strategies.description` | 无 | **新增列** |
| `strategies.current_version_id` | `latestVersion varchar(32)` | **新增 `currentVersionId int NULL`（权威），`latestVersion` 降级为派生冗余列** |
| `strategies.status`（DRAFT/RESEARCHING/ACTIVE/ARCHIVED） | `status DEFAULT 'Draft'` + C-21.1 已有八态 | **复用 C-21.1 八态**（禁另造枚举，SPEC §6 明确要求兼容既有状态） |
| `strategy_versions.definition_json` | `strategyDocumentJson`（NOT NULL，canonical） | **同一列，不改名**；domain 层以 `definition` 语义暴露（映射登记见 §6） |
| `strategy_versions.definition_hash` | `fingerprint`（sha256 of canonical） | **同一列，不改名**（语义完全等价） |
| `strategy_versions.parent_version_id` | 无 | **新增列**（int NULL → 自引用 strategy_versions.id） |
| `strategy_versions.status` | 无 | **新增列**（varchar 32 DEFAULT 'Draft'，复用 C-21.1 八态） |
| `strategy_versions.description` / `updated_at` | 无 | **新增列**（updatedAt 唯一合法用途 = 状态迁移时间；**内容仍禁 UPDATE**） |
| `strategy_parameters`（含 `parameter_role`） | 无表；参数内嵌 JSON，无 role | **新建表**，`UNIQUE(strategyVersionId, code)` |
| `strategy_entry_rules` / `strategy_exit_rules` | 无表；flat `DeclaredRule[]` | **新建表**（从富 Entry/Exit 派生） |
| `strategy_execution_rules` | 无表；`executionAssumptions` 内嵌 | **新建表**，1:1 `UNIQUE(strategyVersionId)` |
| `strategy_version_datasets` | 无表；仅 `datasetVersion` 单值列 | **新建表**（role PRIMARY/VALIDATION/OOS） |
| Entry 富模型（event / observationWindow / conditions / trigger） | `entryRules: DeclaredRule[]` | **新增富类型**（`EntryDefinition`） |
| Exit 富模型（type/trigger/threshold/priority/enabled） | `exitRules: DeclaredRule[]` | **新增富类型**（`ExitDefinition.rules[]`） |
| Position（sizingMethod/positionRatio/maxPositions/maxExposure/maxSinglePosition） | `positionSizing` union 3 值 | **扩展**（保留 3 值兼容，新增 sizingMethod 覆盖 4 值） |
| Risk（stopLoss/maxDrawdown/maxExposure/…） | `riskRules: DeclaredRule[]` | **扩展**（`RiskDefinition` 结构化，`riskRules` 保留为派生视图） |
| Execution（signalTiming vs executionTiming / priceType / lotSize / slippage / commission） | 无 timing 分离；有 `executionModel`+`costModel` | **新增**（`ExecutionDefinition`；`executionModel` 由 timing 对派生，保证同源） |
| `ParameterDefinition.parameter_role`（FIXED/TUNABLE/DERIVED） | 无 | **新增**（本次只落字段 + 校验，**不实现 Parameter Search**） |
| Look-Ahead 静态校验（§28） | **完全缺失** | **新增** `INVALID_FUTURE_REFERENCE` 等错误码 |
| Clone by version（§26） | 只有「基于 latest 打 patch」（`createVersion`） | **新增 `cloneVersion(strategyId, fromVersion)`**，复制 Definition + 参数 + 规则 + Dataset 绑定 + `parentVersionId` |
| Canonical Source of Truth（§46） | 双份（JSON + versionRecord 内嵌副本） | **裁定并显式化**（见 §6） |

---

## 4. 关键发现（含真实缺陷与风险）

| ID | 级别 | 发现 | 影响 |
|---|---|---|---|
| **F1** | 🔴 高 | `versionRecordJson` 内嵌完整 `strategy` 副本，与 `strategyDocumentJson` 重复；读取路径实际以 `versionRecordJson` 为权威（`db.ts:201,227`），而列表/摘要读 `strategyDocumentJson` 同表的兄弟列 | SoT 不唯一；两份若因任何写入 bug 漂移，读取侧无法发现（各自指纹都自洽） |
| **F2** | 🟠 中 | `strategy_versions` 缺 `parent_version_id` / `status` | 版本演进链不可追溯；「某版本是否已发布」无法表达；§8 不可变原则只有内容层、无状态层 |
| **F3** | 🟠 中 | 无 Look-Ahead 静态校验（§28） | 危险定义（T 日出信号却引用 T+1 close）会一路存到回测才暴露 |
| **F4** | 🟠 中 | 无「按指定版本 clone」；`createVersion` 恒基于 **latest** | 无法从历史版本分叉；Clone 不复制 dataset bindings（因无该表） |
| **F5** | 🟡 低 | `strategies.latestVersion` 是冗余可变列，由 `service.ts:200-202` 每次重算 upsert | 极端并发/失败下可能与 `strategy_versions` 漂移；无一致性审计 |
| **F6** | 🟡 低 | `strategies.strategyId` 上 **两个索引**（`strategies_strategyId_unique` + `idx_strategies_strategy_id`） | 冗余，纯空间开销 |
| **F7** | 🟡 低 | 两套「策略」概念并存（治理型 `StrategyDocument` vs 执行配方型 `server/strategy/`），互不引用 | §35 要求：**不大规模重构**，记录兼容问题 + 最小兼容层 |
| **F8** | ℹ️ 观察 | `research_strategy_candidate.strategyDefinitionId` 软引用、0 行、无转正链路 | 属 RESEARCH 侧，本任务不实现（§34 边界） |
| **F9** | 🔴 环境 | `research_run.id=330003` 状态 **RUNNING**，`startedAt=2026-09-11T06:58:22Z`，**停更 ≈24.5h**；`research_experiment` 同况 | 即 ROADMAP 队列 **9h（RESEARCH-002D）** 未落地的后果（热重启杀死在途 Run → 永久 RUNNING）。**与本任务无关，但意味着：任何时候改 `server/**` 都会热重启（`tsx watch`），在途 Run 会被杀** ⇒ 实施期须避免用户正在跑研究 |
| **F10** | 🟡 低 | `drizzle/meta/_journal.json` ≤0023、snapshot ≤0015，migration SQL 已到 0033 | **禁 `npm run db:push` / `drizzle-kit generate`**；本任务沿用「手写 SQL + 幂等 apply 脚本」（PROJECT_RULES 强制） |

---

## 5. 领域边界确认（SPEC §3 / §33 / §34 / §35）

- **Strategy 负责**：身份 / 版本 / 规则 / 参数定义 / Dataset **默认绑定** / 不可变 / 校验 / 指纹 —— 本任务范围。
- **Strategy 不负责**：Research 结果、统计量、Sharpe/Alpha/IC/WinRate/MaxDD、Backtest 结果、Parameter Search、Robustness、OOS、Walk-Forward、Simulation 结果 —— 本任务**不实现**，只保证它们未来能凭 `strategyVersionId` 拿到完整 Definition。
- **Dataset 边界**：只建立**引用**（`strategy_version_datasets`），**不复制数据、不建 Dataset 表、不重写 Builder、不改 `ds_*` 物理结构**。
- **Backtest 边界**：**不重构** `server/strategy/`；本次只在报告登记 F7 兼容问题；最小兼容层 = `StrategyDocument.executionAssumptions.executionModel` → 既有 `ExecutionModelId` 白名单（已对齐，无需改动）。

---

## 6. 🔴 Source of Truth 裁定（SPEC §46）

**裁定（推荐方案）**

```text
Strategy（身份/状态/当前版本）        → strategies            【唯一权威】
StrategyVersion（版本快照/演进/状态）  → strategy_versions     【唯一权威】
完整 StrategyDefinition 快照          → strategy_versions.strategyDocumentJson
                                        （物理列名不变；domain 层以 definition 语义暴露，
                                         等价于 SPEC 的 definition_json）
Definition Fingerprint（SHA-256）      → strategy_versions.fingerprint
                                        （等价于 SPEC 的 definition_hash）
Parameter metadata（可查询投影）        → strategy_parameters
Entry / Exit / Execution（可查询投影）  → strategy_entry_rules / _exit_rules / _execution_rules
Dataset 绑定（引用）                   → strategy_version_datasets
```

**三条一致性铁律（写入时由代码保证，读取时由审计脚本保证）**

1. **Canonical = `strategyDocumentJson`**（含富 Definition）。5 张辅助表是**派生投影**，任何读取方若需权威语义必须回到 canonical；辅助表只服务「按参数/规则/角色查询」。
2. **同一事务内写入**：canonical + 5 张投影 + 指纹，任一步失败整体回滚（不允许「JSON 有、投影缺」）。
3. **漂移即响亮失败**：`verifyStrategyDomainModel.mts` 逐版本重算「canonical → 期望投影」并逐行比对辅助表；不一致即 FAIL（不静默、不自动修复）。

**F1 处置**：`versionRecordJson` 的 `strategy` 内嵌副本**保留**（§17 九项追溯的既有契约、有测试与消费者），但在**反序列化后立即断言** `versionRecord.strategy.fingerprint === row.fingerprint === strategyDocumentJson 重算指纹`，把「双份」降级为**可检测的冗余**；不新增第三次副本。

---

## 7. 设计提案（Domain / DB / Repository / Service / API）

### 7.1 Domain（新增富模型，`schemaVersion` 与「strategy version」严格区分 —— SPEC §30）

```ts
StrategyDefinition {                    // schemaVersion: "1.0"
  schemaVersion, entry, exit, position, risk, execution, parameters
}
EntryDefinition  { event{type,params?}, window{start,end,unit}, conditions[], trigger{type,params?} }
Condition        { field, operator, value, valueType }   // CONSTANT | FIELD_REFERENCE | PARAMETER_REFERENCE
ExitDefinition   { rules[] }  → ExitRule { type, trigger, threshold, unit, condition?, parameter?, priority, enabled }
PositionDefinition { sizingMethod, positionRatio?, maxPositions?, maxExposure?, maxSinglePosition? }
RiskDefinition   { maxPositions?, maxExposure?, maxSinglePosition?, stopLoss?, maxDrawdown?, 扩展槽 }
ExecutionDefinition { signalTiming, executionTiming, priceType, quantityMethod?, lotSize,
                      slippageModel?, commissionModel?, executionConstraints? }
ParameterDefinition { code, name, dataType, parameterRole(FIXED|TUNABLE|DERIVED),
                      defaultValue, min?, max?, step?, unit?, description?, required }
```

**不进独立表**（SPEC §39）：Position / Risk / Condition / Trigger 全部留在 JSON。**不写死事件类型**（SPEC §10.1）：`event.type` / `trigger.type` 用**白名单常量数组 + 扩展位**，未知值报 `UNKNOWN_EVENT_TYPE` 而非结构拒绝。

### 7.2 DB（Migration `drizzle/0034_strategy_domain_model.sql`）

```sql
-- strategies：+3 列
ALTER TABLE `strategies`
  ADD COLUMN `description` varchar(512) NULL,
  ADD COLUMN `strategyType` varchar(32) NULL,
  ADD COLUMN `currentVersionId` int NULL;

-- strategy_versions：+4 列 +2 索引
ALTER TABLE `strategy_versions`
  ADD COLUMN `parentVersionId` int NULL,
  ADD COLUMN `status` varchar(32) NOT NULL DEFAULT 'Draft',
  ADD COLUMN `description` varchar(512) NULL,
  ADD COLUMN `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
CREATE INDEX idx_strategy_versions_parent ON `strategy_versions` (`parentVersionId`);
CREATE INDEX idx_strategy_versions_status ON `strategy_versions` (`status`);

-- 5 张辅助表（CREATE TABLE IF NOT EXISTS），主键 int AUTO_INCREMENT，
-- 每表带 `strategyVersionId int`（权威）+ `strategyId varchar(64)`（冗余，便于直查，避免 JOIN）
-- strategy_parameters        UNIQUE(strategyVersionId, code)
-- strategy_entry_rules       UNIQUE(strategyVersionId, ruleId)
-- strategy_exit_rules        UNIQUE(strategyVersionId, ruleId)
-- strategy_execution_rules   UNIQUE(strategyVersionId)
-- strategy_version_datasets  UNIQUE(strategyVersionId, datasetId, datasetVersion, role)
```

> ⚠️ 列名**不改**：`strategyDocumentJson` / `fingerprint` 保持（改名会连带 FE 契约 + 3 模块 + 既有测试，收益仅「名字好看」；语义映射已在 §6 登记）。
> 零数据 ⇒ 无回填、无兼容转换、无 truncate 风险（SPEC §38 自动满足）。

### 7.3 Repository（SPEC §24：**扩展现有实现，不新建 7 个 Repository**）

扩展现有 `StrategyRepository` 契约 + `DbStrategyRepository` + `InMemoryStrategyRepository`：
- 写入：`saveVersion` 扩展为「canonical + 5 表投影 + parent/status/description」**同一逻辑事务**（先 canonical 后投影，失败抛错并补偿删除）；
- 读取：`getVersion` 返回 `{ document, versionRecord, parameters[], entryRules[], exitRules[], executionRule, datasetBindings[] }`（SPEC §32：**调用方一次拿全，不需要手工拼装**）；
- 新增：`cloneVersion`（见 §7.5）、`listVersionDatasets`。

### 7.4 Service / API

| 能力 | 落点 | 说明 |
|---|---|---|
| CreateStrategy / CreateStrategyVersion / Get* / List* | 已有（`StrategyService` + `researchRouter.ts:83-154`） | **不重写，只做兼容升级**（SPEC §25） |
| **CloneStrategyVersion** | 新增 `service.cloneVersion` | 按 (strategyId, fromVersion) 复制 |
| **ValidateStrategyVersion** | 已有 `validate` + 新增 `validateVersion(id, version)` | 读库 → 校验（含 look-ahead） |
| **GetStrategyVersion 富返回** | `loadVersion` 返回完整 Definition + Parameters + Rules + Execution + Dataset Bindings | SPEC §32 |
| API 形态 | **tRPC 路径不变**（`research.strategy.*`），**不引入 REST 路径** | SPEC §31「优先兼容当前项目已有 Router」 |

### 7.5 版本不可变 + Clone（SPEC §8 / §26）

- 不变式：`status ∈ {Draft…Retired}` 且内容一律禁 UPDATE；仅 `status`（+ `updatedAt`）可迁移，迁移须留痕（现状由 C-21.1 ledger 承担，本任务**不重复实现**）。
- `cloneVersion(strategyId, fromVersion, opts)`：复制 Definition / Parameters / Entry / Exit / Execution / Dataset Bindings → 新版本号（`parentVersionId` = 源行 `id`）→ **重算指纹** → 幂等（同内容 → `idempotent-skip`）/ 冲突（同版本号不同内容 → 拒绝）。

---

## 8. Validation 设计（SPEC §27 / §28）

| 组 | 检查 |
|---|---|
| Definition | `schemaVersion` 存在且在白名单；`entry/exit/position/risk/execution/parameters` 齐备 |
| Parameter | `code` 唯一；`defaultValue` 类型匹配 `dataType`；`min <= max`；`step > 0`；**`parameterRole="TUNABLE"` 必须有 `min`/`max`** |
| Entry | `window.start <= window.end`；`unit` 白名单（默认 `TRADING_DAY`）；`operator` 白名单；`valueType` 白名单；`FIELD_REFERENCE`/`PARAMETER_REFERENCE` 必须可解析（引用的参数 code 存在） |
| Exit | `type` 白名单；`holdingDays > 0`；`threshold` 与 `unit` 配对；`priority` 集内唯一 |
| Execution | `signalTiming` / `executionTiming` 白名单；`lotSize > 0`；**timing 对 ↔ priceType 一致性** |
| **Look-Ahead（新增）** | ① `signalTiming = T_CLOSE` ⇒ 禁止任何引用 T+1 及以后 bar / 未来收益 / 未来结果的 `FIELD_REFERENCE`；② `FIELD_REFERENCE` 走**白名单前缀**（`event.*` / `bar(rd<=0).*` / `path.*`）而非黑名单；③ `trigger = NEXT_TRADING_DAY` 必须与 `executionTiming = T_PLUS_1_*` 一致；违者 `INVALID_FUTURE_REFERENCE` |
| 诚实边界 | 只做**声明层静态**检查；无法证明运行期无泄漏 —— 报告显式声明，不冒充已解决 |

---

## 9. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 改 `server/**` 会热重启 `tsx watch`，杀死在途研究 Run（F9 已发生 1 次） | 🔴 | 实施前确认无在途 Run；分批小步改；改后立即 `tsc --noEmit` |
| 双份定义漂移（F1） | 🟠 | §6 三条铁律 + 漂移审计脚本 |
| 富模型引入后与 `closedLoopWiring/executors.ts`、`lifecycle/`、FE adapter 的兼容 | 🟠 | **纯新增**富字段（v1 字段保留为派生视图），既有消费者零改动；仅**新增**校验 |
| 5 张辅助表与 canonical 不一致 | 🟠 | 同事务写入 + 逐版本比对审计 |
| `drizzle/meta` 停维护（F10） | 🟡 | 手写 SQL + 幂等 apply 脚本（既定流程） |
| 既有 79 例测试（28+12+9+30）回归 | 🟡 | 只增不改；全量 vitest 与基线逐项比对 |

---

## 10. 被否决的替代方案

| 方案 | 否决理由 |
|---|---|
| **A. 另建独立 `strategyDefinition` 表 + 新领域模块，与 `StrategyDocument` 并存** | 双 SoT（§46 明禁）；`closedLoopWiring` / `lifecycle` / FE adapter / 4 个测试文件全要改；收益仅「命名对齐」 |
| **B. 把 Position / Risk / Condition / Trigger 全部规范化建表** | §39 明禁；查询变多表 JOIN（§40 明禁「不必要的复杂 JOIN」） |
| **C. 重命名物理列 `strategyDocumentJson → definitionJson`、`fingerprint → definitionHash`** | 破坏 10 列既有表 + `db.ts`/`serialize.ts`/FE 契约，收益仅「名字好看」；改为 domain 层语义命名 + 本报告登记映射 |
| **D. 新建 7 个 Repository（SPEC §24 字面）** | 违反 §24 后半句（「不要为了形式主义重复建立 Repository」）；扩展现有契约更小、更一致 |
| **E. 一次性重构 `server/strategy/` 使 legacy 策略迁入 `StrategyDocument`** | §35/§43 明禁（禁止为了新模型重写整个 Backtest）；只登记 F7 兼容问题 |

---

## 11. 实施计划（STEP 6–15）与验收判据

| STEP | 内容 | 验收判据 |
|---|---|---|
| 6 | 设计兼容 Migration（`0034` + `applyStrategyDomainModel.mjs`） | apply 脚本 `--check` 幂等；`information_schema` 断言全 PASS；`--dry-run` 只读 |
| 7 | Domain Model（`definition.ts` + 类型 + 书签） | `tsc --noEmit` exit 0 |
| 8 | Persistence（5 表读写 + 同事务投影 + 富读取） | 单测：5 表落库/读取/唯一约束；canonical↔投影一致 |
| 9 | Definition Hash（canonical + sha256，复用 `canonicalStringify`） | **同 Definition → 同 Hash**；任一实质字段变 → Hash 变（逐字段参数化用例） |
| 10 | Validation（含 Look-Ahead） | 非法参数 / 非法窗口 / 非法执行规则 / 未来引用 各有用例；合法样例零误报 |
| 11 | Version Clone（+parent +5 表复制 + 重算指纹） | 复制完整、`parent_version_id` 正确、同内容幂等、同版本冲突拒绝 |
| 12 | 测试补充（SPEC §36 全覆盖清单） | 新增例全过；既有 79 例零改动通过 |
| 13 | **真实 TiDB 验证**（`scripts/verifyStrategyDomainModel.mts`） | Migration → Create → Version → Save → Read → Clone → Validate → Verify Hash 全链；**7 表实查**（SPEC §42） |
| 14 | Regression（`npx tsc --noEmit` + 全量 `vitest`） | 失败集合与既有基线**逐项一致** |
| 15 | 最终报告 `docs/strategy/STRATEGY-003-report.md`（18 节）+ ROADMAP §6/§8/§9 | 报告齐备；§47 追加带时间戳条目 |

**不得标记 COMPLETE 的硬条件**（SPEC §41/§48）：Migration + Domain + Persistence + Validation + Tests + **Real TiDB** + Regression 全绿。仅编译通过不算。

---

## 12. 本任务边界（不做）

❌ Strategy Editor 完整 UI ❌ Research 页面 ❌ Parameter Search ❌ Backtest ❌ Evaluation ❌ Robustness ❌ OOS ❌ Walk-Forward ❌ Simulation ❌ 重构整个项目 ❌ 修改 Dataset Registry ❌ 删除旧 Dataset / 旧 Strategy 数据 ❌ 为迁移遗留策略重写 Backtest

---

## 13. ⚠️ 待用户裁定（3 项，直接影响实施形态）

| # | 事项 | 建议（推荐） | 若选另一条路的代价 |
|---|---|---|---|
| **D1** | Definition 演进方式：在 `strategyDocumentJson` 内以**富模型 v2 + v1 派生视图**演进，还是另建并行领域模块 | **在既有文档内演进**（v1 字段保留为派生视图，既有 79 例零改动） | 并行模块 ⇒ 双 SoT、4 个模块 + FE 连带改 |
| **D2** | 物理列名：`strategyDocumentJson` / `fingerprint` 是否改名为 `definitionJson` / `definitionHash` | **不改名**，domain 层用 `definition` 语义 + 报告登记映射 | 改名 ⇒ 改 3 模块 + FE 契约 + 迁移列名，收益仅命名对齐 |
| **D3** | 版本状态枚举：SPEC 建议 `DRAFT/RESEARCHING/ACTIVE/ARCHIVED` | **复用 C-21.1 八态**（Draft→…→Retired），`strategy_versions.status` DEFAULT 'Draft' | 另造枚举 ⇒ 与 C-21.1 生命周期双轨冲突（SPEC §6 明令兼容既有状态） |

---

## 14. 本轮变更声明

- **代码改动：0 个文件**（`server/**`、`client/**`、`shared/**`、`drizzle/**` 均未改动）
- **DB 变更：0**（未执行任何 DDL / DML）
- **只读产物**：本报告 + 3 个临时探针（`_strategy003_probe{,2,3}.mjs` + 对应 `.out.txt`，可随时删除）
- **遗留提示（与本任务无关）**：`research_run.id=330003` 自 2026-09-11 06:58Z 起永久 `RUNNING`（ROADMAP 队列 9h / RESEARCH-002D 未落地），当前无产品级恢复入口
