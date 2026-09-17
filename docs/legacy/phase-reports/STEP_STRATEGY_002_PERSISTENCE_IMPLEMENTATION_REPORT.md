# STEP STRATEGY-002 — Strategy 持久化与 CRUD 闭环实现报告

> 日期：2026-09-09
> 状态：**完成**（Strategy Definition: PARTIAL → **READY**，此处 READY 仅指 Definition + Persistence + Versioning CRUD 真实完成）

---

## 1. Executive Summary

STEP STRATEGY-002 的目标已达成：`StrategyDefinition` 从「内存中的声明式对象」升级为「可持久化、可读取、可版本化、可追溯的正式领域实体」。

完整闭环已验证（真实 TiDB，无 mock）：

```text
Frontend Strategy Editor → StrategyDocument → Validate → StrategyService
    → StrategyRepository → Database → Restart → Load → StrategyDocument
```

版本闭环：

```text
Strategy V1.0.0 → createVersion → V1.1.0 → Persist → Load V1.0.0 + Load V1.1.0（旧版本不被修改）
```

关键成果：

- **数据库**：新增 `strategies` + `strategy_versions` 两张表，唯一约束 `(strategyId, version)` 兜底并发与不可变。
- **Repository**：`StrategyRepository` 契约 + `DbStrategyRepository`（真实 DB）+ `InMemoryStrategyRepository`（单测）。
- **Service**：`StrategyService`（create/save/load/list/delete/createVersion/listVersions/loadVersion），复用 STEP-001 的 `createStrategyDocument` / `cloneStrategyDocument` / `bumpStrategyVersion`，不重新实现 semver。
- **Router**：`research.strategy.{create,save,load,list,delete,createVersion,loadVersion,listVersions}` 八端点。
- **Frontend**：解除「保存 / 保存新版本」禁用态，接通真实 save / createVersion 链路；新增最小策略列表（Load 进编辑器）。
- **验收**：真实 TiDB E2E 全 PASS（重启往返 + 版本往返 + 幂等 + 不可变 + 指纹完整性）。

---

## 2. STEP-001 Findings Revalidated

审计结论（`server/research/strategySchema/` + `drizzle/schema.ts` + `server/research/` + `server/routers.ts` + `client/src/pages/StrategyEditor.tsx`）复核如下：

| STEP-001 已具备 | 状态 |
|---|---|
| StrategyDocument（§16 全字段本体） | ✅ 存在（types.ts，recordKind/recordVersion/fingerprint + 全字段） |
| Strategy Schema / Validate | ✅ 存在（validate.ts，结构化 issue + assert） |
| Serialize / Deserialize + canonical JSON + SHA256 fingerprint | ✅ 存在（serialize.ts，deserialize 含指纹复核） |
| Compare（strategiesDeepEqual / compareStrategyDocuments / classifyRequiredBumpKind） | ✅ 存在（compare.ts） |
| Semantic Version（bumpStrategyVersion + bump 语义闸门） | ✅ 存在（version.ts + map.ts cloneStrategyDocument） |
| StrategyVersionRecord（§17 九项追溯） | ✅ 存在（types.ts + map.ts createStrategyVersionRecord） |
| Strategy Editor（可视化 + JSON 双模式） | ✅ 存在（StrategyEditor.tsx + strategyAdapter.ts） |
| validate / bump / compare API | ✅ 存在（researchRouter.ts） |

**STEP-001 缺失项（本 STEP 补齐）**：`strategies` 表、`strategy_versions` 表、`StrategyRepository`、`StrategyService`、CRUD Router、Frontend Save/Load、版本持久化——全部在本 STEP 落地。

审计中未发现 strategies / strategy_versions 表，未发现 StrategyRepository / StrategyService，未发现 save/load API（saveDisabled = true 硬编码），**无部分实现可复用**，按规范全新设计（复用 STEP-001 纯函数，不重复造版本模型）。

---

## 3. Database Design

两个逻辑实体，复用 STEP-001 `StrategyVersionRecord`，**不另造第二套版本模型**（§4.2/§5）。

### 3.1 `strategies`（策略逻辑实体）

| 列 | 类型 | 说明 |
|---|---|---|
| id | int PK auto | 自增主键 |
| strategyId | varchar(64) UNIQUE | 策略稳定身份 |
| name | varchar(128) | 策略名（不进版本指纹） |
| latestVersion | varchar(32) | 最新版本号（冗余列，权威值在 strategy_versions） |
| status | varchar(32) DEFAULT 'Draft' | 生命周期状态（lifecycle 层维护，本层透传） |
| createdAt / updatedAt | timestamp | 时间戳 |

### 3.2 `strategy_versions`（不可变版本）

| 列 | 类型 | 说明 |
|---|---|---|
| id | int PK auto | 自增主键 |
| strategyId | varchar(64) | 所属策略 |
| version | varchar(32) | major.minor.patch |
| strategyDocumentJson | longtext | `serializeStrategyDocument(document)`（§16 本体） |
| versionRecordJson | longtext | `serializeStrategyVersionRecord(record)`（§17 九项追溯完整快照） |
| fingerprint | varchar(64) | **StrategyDocument.fingerprint**（内容指纹，幂等/不可变判定键） |
| datasetVersion | varchar(96) | rd-…（冗余查询列） |
| universeId | varchar(128) | 冗余查询列 |
| codeVersion | varchar(64) | composeCodeVersion 产物 |
| createdAt | timestamp | 版本创建时间 |

- **不可变 + 并发兜底**：`UNIQUE(strategyId, version)`。
- **Immutable**：无 UPDATE 入口，改内容必须新建版本（§18）。

---

## 4. Repository

`server/research/strategyPersistence/contract.ts` 定义接口；`db.ts` 真实 DB 实现；`inMemory.ts` 单测实现。

- `saveStrategy`：upsert（strategyId 已存在则更新 name/latestVersion/status）。
- `getStrategy` / `listStrategies` / `deleteStrategy`（级联删版本）。
- `saveVersion`：幂等三态 `inserted | idempotent-skip | conflict`（§19）。
- `getVersion` / `listVersions`（版本号语义降序）/ `getLatestVersion`（`compareStrategyVersions` 语义比较，非 createdAt）。

**并发兜底**：`saveVersion` 先查后插；唯一约束冲突（`ER_DUP_ENTRY` 1062）时重新判定幂等 vs 冲突（§19「数据库唯一约束最终兜底」）。

**指纹验证**（§6）：读取经 `deserializeStrategyVersionRecord` / `deserializeStrategyDocument`，重算指纹，篡改即抛错（不静默接受）。

---

## 5. Service

`server/research/strategyPersistence/service.ts` 的 `StrategyService`：

- **create**：strategyId 必须不存在 → 创建策略 + 第一条版本。
- **save**：幂等；strategyId 不存在等价 create；同 version 不同 fingerprint → 拒绝（immutable）。
- **load / loadVersion / list / listVersions / delete**。
- **createVersion**：复用 `cloneStrategyDocument`（含 bump 语义闸门）+ `bumpStrategyVersion` + `classifyRequiredBumpKind`；bump 缺省自动判定（none→minor，结构→major，参数/文本→minor）。

**后端权威重算**：wire 输入的 fingerprint 不可信，落库前一律 `createStrategyDocument` 重组装（重算指纹 + 全字段校验）。

**注入式元数据**：`codeVersion` / `createdAt` 由入口注入（风格对齐 experimentLineage），Service 不读文件系统。

---

## 6. Router

`server/researchRouter.ts` 增加 8 端点（沿用现有 `publicProcedure` 架构，非机械照抄）：

```text
research.strategy.create / save / load / list / delete / createVersion / loadVersion / listVersions
```

- 输入经 zod（`shared/researchContracts.ts`）形态校验 → `StrategyService` → 领域校验（`createStrategyDocument`）→ `Repository` → DB（§11 正确链路，无 router→DB 直落）。
- `codeVersion` 模块加载时 `composeCodeVersion(package.json)` 解析一次注入。

---

## 7. Frontend

`client/src/pages/StrategyEditor.tsx` + `client/src/components/strategy/StrategyHeader.tsx`：

- 解除「保存 / 保存新版本」禁用态，接通 `save` / `createVersion` mutation；成功后以后端重组装 document 回填（version/fingerprint 权威）。
- 新增最小策略列表（Strategy ID / Name / Latest Version / Status / Updated At + 加载按钮），点击 Load 载入编辑器。
- 「运行」仍为 Phase 6 结构预留禁用态（本 STEP 不实现 Research Run，§13）。

---

## 8. Versioning

复用 STEP-001 语义闸门（§9），未重新实现 semver：

- 结构变化（rules/universe/datasetVersion/executionAssumptions/recipe/参数 schema 本体）→ **major**；
- 参数 defaultValue / 文本变化 → 至少 **minor**；
- `createVersion` 显式 bump 不足 → 闸门拒绝（`bumpCoversChange`）。

E2E 实证：参数默认值变化 → `1.0.0 → 1.1.0`；entryRules 结构变化 → `1.0.0 → 2.0.0`。

---

## 9. Fingerprint Integrity

- `save(document)` → `createStrategyDocument`（canonical 序列化）→ `computeStrategyDocumentFingerprint`（SHA256）→ DB。
- 读取 → `deserializeStrategyDocument`（结构校验 → 指纹复核）→ 不一致即 **LOAD FAIL**（§6）。
- E2E 实证：restart 前后 fingerprint 一致；旧版本 V1 fingerprint 在 V1.1 创建后保持不变。

---

## 10. Idempotency

- 同一 `strategyId + version + fingerprint` 重复保存 → `idempotent-skip`，不产生重复版本（§19）。
- 同一 `strategyId + version` 不同 fingerprint → `conflict` 拒绝（§7/§18）。
- E2E 实证：两次 save 幂等；同版本不同内容 save 拒绝（"策略版本不可变"）。

---

## 11. Tests

| 套件 | 结果 |
|---|---|
| `server/research/strategyPersistence/strategyPersistence.test.ts` | **12/12 通过**（Repository 契约逻辑 + Service 编排：幂等/冲突/不可变/排序/createVersion major/minor/闸门/九项追溯） |
| `server/researchContracts.test.ts` | **13/13 通过**（含新增 CRUD 端点注册守卫） |
| `server/research/strategySchema/strategySchema.test.ts` | 28/28 通过（无回归） |

覆盖 §20 要求：Repository（save/load/list/delete/saveVersion/loadVersion/listVersions/duplicate save/fingerprint mismatch/immutable version）、Service（create/save/load/createVersion/version validation）、Router（注册守卫 + E2E 真实链路）。

---

## 12. Real DB E2E

`scripts/stepStrategy002E2E.mts`（真实 TiDB，`import "dotenv/config"`）完整通过：

```text
create                     ✅  strategyId=e2e-strategy-…, version=1.0.0
save-idempotent-1 / 2      ✅  幂等
load-before-restart        ✅  fingerprint 一致
load-after-restart         ✅  新 Repository/Service 实例，matchesOriginal=true（重启持久化）
createVersion-minor        ✅  1.0.0 → 1.1.0
listVersions               ✅  [1.1.0, 1.0.0]
v1-unchanged               ✅  旧版本 fingerprint 不变（immutable）
immutability-reject        ✅  同版本不同内容被拒绝
cleanup                    ✅  deleted
E2E RESULT: PASS
```

验证了 §16（重启持久化 + fingerprint 全一致）、§17（版本往返，两版本并存，旧版本不被修改）、§18（immutability）、§19（幂等 + 唯一约束兜底）。

---

## 13. Files Changed

**新增**：

- `drizzle/0026_strategy_persistence.sql` — migration
- `server/research/strategyPersistence/contract.ts` / `inMemory.ts` / `db.ts` / `service.ts` / `index.ts`
- `server/research/strategyPersistence/strategyPersistence.test.ts`
- `scripts/applyStrategyPersistence.mjs` — migration 应用脚本
- `scripts/stepStrategy002E2E.mts` — 真实 DB E2E

**修改**：

- `drizzle/schema.ts` — 新增 strategies / strategy_versions 表定义
- `server/research/index.ts` — 导出 strategyPersistence
- `server/researchRouter.ts` — 8 个 CRUD 端点
- `shared/researchContracts.ts` — save/id/loadVersion/createVersion 输入契约
- `server/researchContracts.test.ts` — CRUD 端点注册守卫
- `server/db.ts` — **getDb 修复**（见 §14）
- `client/src/pages/StrategyEditor.tsx` — Save/Load/CreateVersion + 策略列表
- `client/src/components/strategy/StrategyHeader.tsx` — 解除禁用态

---

## 14. Migration

- `drizzle/0026_strategy_persistence.sql`：`CREATE TABLE IF NOT EXISTS strategies` + `strategy_versions` + 唯一约束 `uq_strategy_versions_id_version`。
- 应用：`node scripts/applyStrategyPersistence.mjs`（幂等，6 条语句），已验证 `strategiesTable=true`、`strategyVersionsTable=true`、`uniqueIndexPresent=true`。

**附带修复（记录）**：`server/db.ts#getDb` 原实现 `drizzle(process.env.DATABASE_URL)` 会把 URL 里的 `ssl={"rejectUnauthorized":true}` 误当 mysql2 的 SSL profile 名（`Unknown SSL profile`），且 `URL.searchParams` 会丢失 JSON 双引号导致 JSON.parse 失败。已最小修复为「从原始字符串按 `ssl={...}` 提取 + drizzle config 形式连接」，这是本 STEP 持久化验收的硬前置（否则 DbStrategyRepository 无法连接 TiDB）。修复向后兼容（无 ssl 参数时行为不变）。

---

## 15. Remaining Gaps

- **§12 Dataset Binding（设计选择）**：`datasetId` / `datasetFingerprint` 未加入 `StrategyDocument`。理由：`datasetVersion` 本身内容寻址（`rd-<builder>-<rowSchema>-<16hex>`），内含版本指纹；`datasetId = DS-<datasetVersion>` 可确定性派生，冗余存储反易漂移；`datasetFingerprint` 已存在于 researchRuns/researchDatasets 层。修改 StrategyDocument 会连锁影响前端 adapter + 序列化指纹 + compare + validate + STEP-001 单测，违反 §5「不破坏现有 StrategyDocument」。故本 STEP 只做最小必要设计，`strategy_versions.datasetVersion` 已满足「版本可靠引用 datasetVersion」的追溯要求。
- **生命周期状态持久化**：`strategies.status` 已建列（默认 Draft），但 lifecycle 状态机（C-21.1）的持久化不在本 STEP 范围；状态目前由前端/lifecycle 层维护，本层只透传。
- **Research Run 绑定**：§13 只保证 Strategy Version 有稳定身份（strategyId + version + fingerprint），未实现完整 Research Run 编排。
- **并行开发环境提示**：本会话运行期间观察到仓库存在其他并行 agent 的未提交改动（如 firstBoardPullback 半成品、researchDataset preview universeFilter 类型不一致），导致 `tsc --noEmit` 全量检查与 `researchContracts.test.ts` 在会话中途出现**与 STEP-002 无关的临时失败**；删除 tsbuildinfo 后重跑，本 STEP 相关测试全绿。这些属其他模块工作，未在本 STEP 越级处理。

---

## 16. STEP-003 Recommendation

STEP-002 已达成「Strategy 能不能保存？」。建议 STEP-003 严格按既定节奏推进「什么叫首板？」：

```text
STEP-001  Strategy 能不能定义？ ✅
STEP-002  Strategy 能不能保存？ ✅
STEP-003  什么叫「首板」？    ← 下一个
```

建议 STEP-003 聚焦：把「首板」定义成**第一个机器可计算 Event**（基于 `limit_up_records` / `stock_daily_prices` 的历史数据，识别每只股票「首个涨停板」事件，输出 `(securityId, firstBoardDate)` 或等价事件序列）。本 STEP 已为此预留了「首板回踩不破首板开盘价」的占位声明式 StrategyDocument（E2E 中用于验证 create/save/load/version，未实现交易逻辑）。此时 Strategy 持久化已就绪，STEP-003 产出的首板事件可直接作为 `StrategyDocument.universe/entryRules` 的输入绑定，无需再补持久化基础设施。
