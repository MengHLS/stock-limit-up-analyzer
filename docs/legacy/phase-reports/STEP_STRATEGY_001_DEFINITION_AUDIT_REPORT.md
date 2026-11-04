# STEP STRATEGY-001 — Strategy Definition 能力审计报告

> 审计日期：2026-09-09
> 审计范围：策略「定义 / 保存 / 版本化 / 读取」基础能力（不进入 Backtest / Parameter Search / WFO / OOS / Paper Trading）
> 最终判定：**PARTIAL**

---

## 1. Executive Summary

**结论：当前系统「定义 / Schema / 版本化（领域模型层）」已完整 CODE_READY，但「保存 / 读取 / 版本化持久化」这一闭环缺失。**

一句话回答 §10 的核心问题——「当前系统是否已经具备正式定义第一条 Strategy 的基础能力？」：

> **PARTIAL。** 系统已经具备**内存中**定义、校验、序列化、比较、版本化一条正式量化策略的全部能力（`server/research/strategySchema/`，CODE_READY，28 单测），前后端也通过 tRPC 打通了 validate / bump / compare / lifecycle 等无状态端点。但**缺少 Strategy Repository 与 `strategies` / `strategy_versions` 持久化表**——一条策略无法「保存到数据库、重启后读取、跨版本追溯」。因此「定义」成立，「保存 / 读取 / 版本化」尚不成立，整体判定 **PARTIAL**（非 READY，亦非 BLOCKED）。

关键证据链：

| 维度 | 状态 | 证据 |
|---|---|---|
| Strategy Definition（声明式本体） | ✅ READY | `server/research/strategySchema/types.ts#StrategyDocument`（§16 全字段） |
| Strategy Schema（结构化校验） | ✅ READY | `strategySchema/validate.ts`（字段齐备 / semver / datasetVersion / universe 派生一致性等全量 issue） |
| Strategy Version（语义版本） | ✅ READY（领域层） | `strategySchema/version.ts` + `StrategyVersionRecord`（§17 九项追溯）+ `cloneStrategyDocument` bump 闸门 |
| Strategy Service（编排层） | ❌ MISSING | 无 strategyService（仅有 experimentService / runService / sweepService） |
| Strategy Router（CRUD） | 🟡 PARTIAL | `researchRouter.ts` 仅有 `strategy.validate/bump/compare` + `lifecycle.describe/transition`（全部无状态），无 create / save / load / list / delete |
| Strategy Repository / 持久化 | ❌ MISSING | 无 `strategies` / `strategy_versions` 表；`persistence/db.ts` 只有 Experiment / Run / SweepBatch 三套 Repository |
| Strategy Editor（前端） | 🟡 PARTIAL | UI 完整（可视化 + JSON + 版本 diff + 生命周期），但「保存 / 保存新版本 / 运行」按钮后端未暴露 → 禁用态 |
| Dataset Binding | 🟡 PARTIAL | `StrategyDocument.datasetVersion`（仅字符串）；`research_runs` 表已有 datasetId / datasetVersion / datasetFingerprint |
| Research Run Binding | 🟡 PARTIAL | `research_experiments`（strategyId/strategyVersion 冗余列 + snapshotJson 权威）+ `research_runs`（experimentId + 三 dataset 字段） |
| Hardcoded Strategy | ⚠️ 存在 | legacy「龙头候选」5 策略 + 首板过滤工具，尚未迁移到正式 StrategySchema |

**本 STEP 未做任何代码修改**（按 §7 / §11 纪律：审计 → 复用 → 发现 GAP → 最小修复 → 报告；本 STEP 的 GAP 均为「持久化层」，属 STRATEGY-002 范围，不属「最小基础修复」，故 DEFERRED）。

---

## 2. Existing Strategy Architecture

项目存在**三套并存的「策略」概念**，必须区分，否则会把「代码存在」误判为「能力就绪」：

### 2.1 正式 Strategy Definition（STEP 15 / C-15.1，权威）

位置：`server/research/strategySchema/`（types / version / validate / serialize / compare / map / index）

- **`StrategyDocument`**（§16 策略本体，不可变 / 可序列化 / 确定性）：
  - 身份：`strategyId` / `version`（严格 semver `x.y.z`）/ `name` / `description`
  - 规则：`universe` / `entryRules[]` / `exitRules[]` / `positionSizing` / `riskRules[]`（均为**声明式描述符**，声明不执行）
  - 参数空间：`parameters`（`ResearchParameterSchema`）
  - 数据集绑定：`datasetVersion`（`rd-<builder>-<rowSchema>-<sha16>` 内容寻址格式）
  - 执行假设：`executionAssumptions`（`backtestConfig` + `costModel` 六字段 + `executionModel` 白名单）
  - 执行配方引用：`recipe`（可选，C-13.2 `Strategy13` 的可序列化面）
  - 元数据 / 指纹：`metadata` / `fingerprint`（sha256，除指纹外全字段 canonical JSON 摘要）
- **`StrategyVersionRecord`**（§17 版本追溯九项）：`strategy`（本体快照）/ `parameterSet` / `datasetVersion` / `universeId` / `backtestConfig` / `costModel` / `executionModel` / `codeVersion` / `createdAt`
- **版本操作**：`bumpStrategyVersion`（patch/minor/major）+ `cloneStrategyDocument`（bump 语义闸门：结构变→major、参数/文本变→至少 minor）+ `compareStrategyDocuments` / `strategiesDeepEqual`
- **序列化**：`serializeStrategyDocument` / `deserializeStrategyDocument`（canonical JSON + 指纹完整性复核，防篡改）

**状态：CODE_READY**（28 单测全过，`tsc --noEmit` 干净）。**范围克制（文件头注释明确声明）：不实现执行引擎 / 生命周期状态机（C-21.1）/ 优化（C-17）/ DB 持久化。**

### 2.2 Research Strategy Definition（STEP 6.1）

位置：`server/research/strategyContract.ts` + `server/research/registry.ts`

- `ResearchStrategyDefinition`：元数据 + 参数 schema（不含评分 / 信号 / 成交逻辑）
- `ResearchStrategyRegistry`：**in-memory 单例**（`researchStrategyRegistry`），以 `strategyId@version` 为键，`registerBuiltInResearchStrategies` 幂等注册

### 2.3 Legacy Production Strategy Engine（STEP 5，未迁移）

位置：`server/strategy/`（contract / registry / adapter / strategies/leaderCandidateBaseline）

- `Strategy` 契约：策略是**纯函数**（`evaluate(context) → StrategyDecision` → `Signal`）
- `StrategyRegistry`：in-memory 单例（`strategyRegistry`），唯一内置策略 `leader-candidate-baseline`
- 与 §2.1 是**两种不同模型**：§2.1 是「声明式文档」，§2.3 是「可执行配方」

> 三者关系：`StrategyDocument.recipe`（§2.1）通过 `strategy13ToRecipeRef` 把 §2.3 可执行配方「提炼为可序列化引用」嵌入本体；可执行实例仍由调用方按 `recipeId` 持有。§2.2 是「研究层元数据视角」。**但三者均无 DB 持久化。**

---

## 3. Strategy Definition Capability Matrix

以 `StrategyDocument`（正式声明式本体）为准，逐项判定：

| Capability | Status | Evidence |
|---|---|---|
| Universe | **AVAILABLE** | `StrategyUniverse`（universeId + members + 派生一致性校验：`research-dataset:<datasetVersion>` 与 datasetVersion 交叉一致） |
| Event | **AVAILABLE** | `DeclaredRule` kind=`"event"`（事件规则描述符，声明式；执行引擎不在本体层） |
| Feature | **AVAILABLE** | `recipe.featureVersions[]`（C-13.2 `FeatureVersionRef`：featureId → version，升序）+ `rankingConfig` / `selectionConfig` 快照 |
| Signal | **AVAILABLE** | `recipe`（signalEngine 可序列化面：`point` / `signalFrequency` / `signalDescription`）+ legacy `StrategySignal`（contract.ts） |
| Entry | **AVAILABLE** | `entryRules: DeclaredRule[]`（声明式；id 集内唯一 + kind/operator 白名单 + description 必填） |
| Exit | **AVAILABLE** | `exitRules: DeclaredRule[]`（同上） |
| Position Sizing | **AVAILABLE** | `positionSizing`：`equal-weight` / `fixed-fraction` / `rank-weighted` 三态判别联合 |
| Risk | **AVAILABLE** | `riskRules: DeclaredRule[]`（如 max 持仓 / 止损 / 单日亏损闸门 / 最大回撤） |
| Execution | **AVAILABLE** | `executionAssumptions.executionModel`（`NEXT_OPEN` / `NEXT_CLOSE` / `VWAP_PROXY` / `LIMIT_PRICE` / `next-open` 白名单）+ `backtestConfig` |
| Cost | **AVAILABLE** | `executionAssumptions.costModel`（commissionRate / stampDutyRate / transferFeeRate / slippageBps / lotSize / minCommission 六字段） |
| Constraints | **PARTIAL** | 约束声明模型存在于**兄弟模块** C-14.3 `executionConstraints`（16 类 EXCON_* 校验 + 17 轴能力矩阵），但**未嵌入 StrategyDocument**——本体只携带 executionModel 白名单，不携带完整约束声明 |

> 说明：所有「声明式规则」字段遵循「**声明不执行**」纪律——`DeclaredRule.description` 是唯一完整人类可读语义，`kind/field/operator/operand` 是机器可读结构化片段，供比较 / 指纹 / 未来执行器引用。因此「AVAILABLE」指「策略定义层已能结构化承载该概念」，不等同于「执行引擎已实现该能力」。

---

## 4. Strategy Version Capability

**领域模型层：AVAILABLE。持久化层：MISSING。**

### 4.1 已具备（区分 Strategy 与 Strategy Version）

```text
Strategy           →  strategyId
Strategy Version   →  version（严格 semver x.y.z，兼容 §17 V1.0/V1.1/V2.0 语义）
```

- `bumpStrategyVersion`：`patch` / `minor` / `major` 纯函数递增
- `cloneStrategyDocument`：**bump 语义闸门**——结构/破坏性变化（rules / universe / datasetVersion / executionAssumptions / recipe / 参数 schema 本体）强制 major；参数 defaultValue / 文本变化至少 minor；bump 级别不足响亮抛错
- `StrategyVersionRecord`（§17 九项追溯）：`strategy` / `parameterSet` / `datasetVersion` / `universeId` / `backtestConfig` / `costModel` / `executionModel` / `codeVersion` / `createdAt`，顶层追溯字段与 strategy 内对应字段交叉一致校验
- `compareStrategyDocuments`：字段级 diff（added/removed/changed + 路径定位），忽略 version / fingerprint 派生字段

### 4.2 GAP

- **无 `strategy_versions` 表**，`StrategyVersionRecord` 只存在于内存 / 测试代码，无法跨进程持久化与检索。
- `strategyId` / `strategyVersion` 仅在 `research_experiments` / `research_experiment_batches` 中以「冗余列」存在（权威值在 snapshotJson 内），**并非独立的策略版本实体**。

---

## 5. Dataset Binding Capability

**PARTIAL。**

### 5.1 已具备

```text
Strategy  (StrategyDocument.datasetVersion, rd-… 内容寻址)
    ↓  (字符串引用，非 DB 外键)
Research Dataset
```

- `StrategyDocument.datasetVersion`：`rd-<builder>-<rowSchema>-<sha256 前 16 hex>` 格式，validator 强制校验（`isValidDatasetVersionFormat`）。
- `research_runs` 表已具备完整三字段：`datasetId`（`DS-<datasetVersion>`）/ `datasetVersion` / `datasetFingerprint`（见 `drizzle/schema.ts:363` + `0025_research_runs_dataset.sql`）。

### 5.2 GAP

- `StrategyDocument` **只有 `datasetVersion`，缺 `datasetId` / `datasetFingerprint`** 两个字段。
- 目前不是 `Strategy → DB Query`（不存在策略表），而是 `Strategy（纯内存对象）→ 字符串 datasetVersion`。无 DB 级 join。

---

## 6. Research Run Binding Capability

**PARTIAL。**

目标链路：

```text
Strategy → Strategy Version → Research Run
```

### 6.1 已落地

```text
research_experiments  (strategyId + strategyVersion 冗余列 + snapshotJson 权威)
        ↓ experimentId
research_runs         (runId + experimentId + datasetId + datasetVersion + datasetFingerprint)
```

- `research_runs` 表字段：`runId` / `experimentId` / `status` / `datasetId` / `datasetVersion` / `datasetFingerprint` / `resultJson` / `error` / `startedAt` / `finishedAt` / `createdAt`（`drizzle/schema.ts:363`）。
- `DbResearchRunRepository`（`persistence/db.ts:112`）已实现 `saveRun` / `getRun` / `listRuns` 真实落库。

### 6.2 GAP

- **`research_runs` 通过 `experimentId` 间接关联策略**，无 `strategyId` / `strategyVersion` 直连列；`strategyId` / `strategyVersion` 只在 `research_experiments` 上（冗余列，权威在 snapshotJson）。
- `codeVersion` / `parameters` 不在 `research_runs` 表上（在 experiment snapshot / lineage 内）。
- 因**无 `strategies` / `strategy_versions` 表**，上述 `strategyId` / `strategyVersion` 是「自由文本冗余列」而非受约束的外键，无法保证引用的策略版本真实存在。
- 本 STEP 不负责实现 Research Run（§5 明确），以上仅记录 GAP。

---

## 7. Frontend Capability

| 能力 | UI 存在 | API 存在 | 数据库存在 | 真实保存存在 |
|---|---|---|---|---|
| Strategy Editor | ✅ `client/src/pages/StrategyEditor.tsx`（可视化 + JSON 双模式） | ✅ `research.strategy.validate` | ❌ | ❌ |
| Strategy List | ❌ 无列表页（仅研究策略目录 `researchRun.catalog.list` 返回 built-in 元数据） | 🟡 `researchRun.catalog.list` | ❌ | ❌ |
| Strategy Detail | ✅ 编辑器即详情（`strategyAdapter` wire↔ViewModel 无损往返） | ✅ validate/compare | ❌ | ❌ |
| Save | ✅ 按钮存在但**禁用**（代码注释：「保存 / 保存新版本 / 运行 端点后端尚未暴露 → 禁用态 + tooltip」） | ❌ 无 save 端点 | ❌ | ❌ |
| Version | ✅ 版本化 Tab（bump + 字段级 diff） | ✅ `strategy.bump` / `strategy.compare`（无状态） | ❌ | ❌ |
| Run | ✅ 运行工作台 Tab + `researchRun.readiness`（只读 BLOCKED） | 🟡 `researchRun.readiness` | ❌ | ❌ |

关键证据：

- `client/src/adapters/strategyAdapter.ts`：`strategyToViewModel` / `viewModelToStrategy` 无损往返，`RULE_PRESETS`（入场/退出/风险 26 条中文预设）+ `RULE_FIELD_LABELS` 字段中文化。
- `client/src/pages/StrategyEditor.tsx`：`TEMPLATE_DOCUMENT`（硬编码「涨停候选基线」示例策略）+ 三 Tab（编辑器 / 版本化 / 生命周期 / 运行工作台）。
- **判定**：UI 与「校验/比较/版本推进」的前后端链路是真实连通的（FE-4 端到端 smoke 6 项全过），但「保存 / 读取 / 版本化持久化」全链路**未落地**——按钮存在不代表功能完成（§6 明确要求）。

---

## 8. Hardcoded Strategy Audit

**存在显著的历史硬编码策略逻辑，尚未迁移到正式 StrategySchema。**

### 8.1 「龙头候选」5 策略（legacy，生产路径在用）

| 文件 | 内容 | 是否正式 Strategy Engine | 可复用性 | 是否应迁移 |
|---|---|---|---|---|
| `server/strategy/strategies/leaderCandidateBaseline.ts` | 龙头候选「原始评分」baseline 策略（BUY/SELL 意图，featureMode/exitMode） | ✅ 属 `server/strategy/`（可执行 Strategy 模型，非 strategySchema） | 高（唯一已迁移到 Strategy 契约的策略） | 应迁移为 StrategyDocument.recipe |
| `server/leaderCandidates.ts` | 龙头候选评分 + 历史回测（`buildLeaderCandidates` / `buildLeaderCandidateBacktest`，含 5 策略组合 `baseline/riskPenalty/hardFilter/qualityBlend/qualityGate`） | ❌ legacy 业务层 | 中 | 评分逻辑应下沉为 FeatureProvider |
| `server/leaderCandidateStrategyBacktest.ts` | 生产回测服务（`runLeaderCandidateStrategyBacktest` / `runLeaderCandidateResearchReport`） | ❌ legacy 生产入口 | 中 | 应桥接 strategySchema |
| `server/downsideRisk.ts` / `factorScore.ts` / `factorCombination.ts` | 下行风险 / 因子评分 / 因子组合逻辑 | ❌ legacy 评分层 | 中 | 应抽象为 Feature / 评估模块 |

调用路径（生产）：`routers → db.getLeaderCandidateBacktest → runLeaderCandidateStrategyBacktest → buildLeaderCandidateBacktest`（`server/db.ts:2005`）。这是当前唯一「真实跑通」的生产回测链路，但**与正式 StrategyDefinition 完全解耦**——它用的是 §2.3 的 `Strategy` 可执行模型，不经过 §2.1 的 `StrategyDocument`。

### 8.2 「首板」概念

- `client/src/lib/firstBoard.ts`：`filterFirstBoardRecords` / `getPreviousRecordedDate`——**首板过滤工具函数（前端）**，非策略。
- `server/leaderCandidates.ts:578`：`if (boards === 1) riskTags.push("首板待晋级确认")`——首板仅作为风险标签，非独立策略。
- **「首板回踩策略」不存在**（符合本 STEP「不要开发」的要求，也确认了当前没有该硬编码策略）。

### 8.3 判定

- 上述硬编码逻辑**不属于正式 Strategy Engine（strategySchema）**，是**独立的 legacy 生产路径**。
- 可复用性：评分/因子逻辑可抽象为 Feature；龙头 baseline 可迁移为 StrategyDocument.recipe。
- **是否应迁移：是**（DEFERRED，属 STRATEGY-002 之后的数据/策略迁移任务，非本 STEP 范围）。

---

## 9. Minimal Changes Made

**本次未做任何代码修改。**（audit-only）

理由（§8 / §11）：

1. 本 STEP 的 DoD 只要求「明确回答 READY / PARTIAL / BLOCKED 并给出证据」，不要求实现。
2. 发现的 GAP 均为**持久化层**（Strategy Repository / Service / CRUD Router / `strategies` 表 / 前端 save 解锁），属于「扩展整个策略系统」级别的改动，**不是 §8 定义的「最小基础修复」**。
3. §11 明令「不要为了让本 STEP 看起来完成而大量写代码」「完成后停止，不要自动进入 STEP STRATEGY-002」。

| 候选修改 | 是否现在修改 | 判定 |
|---|---|---|
| 新增 `strategies` / `strategy_versions` 表 + StrategyRepository | ❌ | **DEFERRED**（STRATEGY-002 首要任务） |
| StrategyService（save/load/list/createVersion 编排） | ❌ | **DEFERRED** |
| Strategy CRUD Router（create/save/load/list/delete） | ❌ | **DEFERRED** |
| 前端「保存 / 保存新版本 / 运行」端点解锁 | ❌ | **DEFERRED** |
| `StrategyDocument` 补 `datasetId` / `datasetFingerprint` 字段 | ❌ | **DEFERRED**（可并入 STRATEGY-002） |
| legacy 龙头策略迁移到 StrategySchema | ❌ | **DEFERRED** |

---

## 10. Deferred Gaps

按优先级列出，全部留待后续 STEP：

| # | GAP | 阻塞点 | 建议归属 |
|---|---|---|---|
| 1 | **无 Strategy Repository / `strategies` + `strategy_versions` 表** | 策略无法持久化，重启即失 | STRATEGY-002（P0） |
| 2 | **无 Strategy Service** | 无 save/load/list/createVersion 编排 | STRATEGY-002（P0） |
| 3 | **无 Strategy CRUD Router** | 前端无法保存/读取 | STRATEGY-002（P0） |
| 4 | **前端 Save/Run 端点未暴露（按钮禁用）** | 无法真实保存/运行 | STRATEGY-002（P0） |
| 5 | `StrategyDocument` 缺 `datasetId` / `datasetFingerprint`（仅 `datasetVersion`） | §4 要求可保存三字段 | STRATEGY-002（P1） |
| 6 | `research_runs` 无 `strategyId` / `strategyVersion` 直连列（靠 experimentId 间接） | §5 链路不完整 | STRATEGY-002 / 后续 Run 端点 STEP |
| 7 | legacy「龙头候选」5 策略未迁移到 StrategySchema | 双模型并存，策略治理无法统一 | 策略迁移 STEP（STRATEGY-003+） |
| 8 | `StrategyLifecycleLedger` / `ResearchStrategyRegistry` / `StrategyRegistry` 均为 in-memory | 生命周期/注册状态重启丢失 | STRATEGY-002（P1） |

---

## 11. Risks

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | **双策略模型并存**（声明式 `StrategyDocument` vs 可执行 `Strategy`） | 概念混淆，未来「定义一条策略」到底用哪套易误判 | 明确 `StrategyDocument` 为权威，`recipe` 承载可执行引用；迁移 legacy 策略 |
| R2 | **legacy 硬编码策略在生产路径运行，但脱离策略治理** | 无版本追溯 / 无生命周期 / 无 dataset 绑定 | 迁移到 StrategySchema + 生命周期状态机 |
| R3 | **in-memory 注册表 / 生命周期账本重启即失** | 策略与生命周期状态无法持久 | 补 DB Repository |
| R4 | **`RESEARCH_READY = TRUE` 但策略持久化缺失** | 可能误以为「能正式定义策略」=「能跑策略结论」 | 严格区分「技术预览」与「研究结论」（§39） |
| R5 | **无 `strategies` 表 → `strategyId/strategyVersion` 是自由文本冗余列** | 无外键约束，引用悬空风险 | 建表 + 外键/唯一约束 |

---

## 12. Recommendation for STEP STRATEGY-002

**STRATEGY-002 应聚焦「策略持久化与 CRUD 闭环」**，把 PARTIAL 提升为 READY，具体任务：

1. **建表**：`strategies`（strategyId PK + 最新版本 + 内容 JSON + fingerprint）+ `strategy_versions`（strategyId + version 联合唯一 + StrategyVersionRecord JSON + createdAt/codeVersion）。
2. **StrategyRepository**：`DbStrategyRepository`（save / load / loadVersion / list / listVersions），复用 `serializeStrategyDocument` / `deserializeStrategyDocument` 的 canonical + 指纹复核，保证「落库即校验、读库即复核」。
3. **StrategyService**：save（upsert，幂等按 fingerprint）/ load / list / createVersion（复用 `cloneStrategyDocument` bump 闸门）。
4. **Strategy CRUD Router**：`research.strategy.save / load / list / createVersion / delete`，把前端「保存 / 保存新版本」按钮从禁用态解锁。
5. **Dataset 绑定补全**：`StrategyDocument` 增 `datasetId` / `datasetFingerprint`（或引入 dataset 绑定记录），并让 `research_runs` 直连 `strategyId` / `strategyVersion`。
6. **明确「定义第一条真实策略」的验收**：以「首板回踩」为第一条真实策略，走「定义 → 保存 → 版本化 → 读取 → （后续 STEP）回测」完整链路验收。

**完成标准（STRATEGY-002 的 DoD）**：一条 StrategyDocument 能从「前端定义 → 后端 save → DB 落库 → 重启读取 → createVersion → listVersions」全链路无损往返，且 fingerprint / 版本追溯一致。

---

## 附：判定依据（DoD）

> **当前系统是否已经具备正式定义第一条 Strategy 的基础能力？**

**PARTIAL。**

- ✅ **已具备**：声明式 `StrategyDocument` 定义 + 全字段 Schema 校验 + 序列化/反序列化 + 比较 + semver 版本化（`StrategyVersionRecord` §17 九项追溯）+ 前端可视化编辑器 + 无状态 validate/bump/compare 前后端端点。
- ❌ **缺失**：Strategy Repository / Service / CRUD Router / `strategies`+`strategy_versions` 持久化表 / 前端 save-run 端点——「保存 / 读取 / 版本化持久化」闭环未落地。

证据均来自真实代码与真实 DB Schema（非文档假设），符合 Evidence Hierarchy（真实 DB > 代码 > 测试 > 文档）。
