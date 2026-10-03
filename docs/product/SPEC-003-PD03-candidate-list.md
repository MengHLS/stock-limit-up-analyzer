# SPEC-003 — 候选（Candidate）列表（PD-03）

> 日期 2026-10-03 · 状态 **🔶 待 Architecture Scope 复核**（Scope 草案见 §9）· 上游 `PRODUCT-DECISIONS-001.md` PD-03
> 归属：Architecture Agent（端点 Scope）→ Frontend Agent（列表页）
> ⚠️ 与 PD-01 / PD-04 不同：本项**需要新增一个只读端点**，因此必须先过 Architecture Scope。

---

## 1. Problem

Candidate 是 ③研究 → ④策略 的**交接物**，但当前**没有列表入口**：

| 能力 | 现状（实查） |
|---|---|
| 详情页 | ✅ `client/src/pages/candidates/StrategyCandidateDetail.tsx`（路由 `/candidates/:candidateId`） |
| 列表页 | ❌ **不存在** |
| 唯一入口 | 从策略详情页的**溯源面板**点进去 ⇒ 用户无法回答「我到底发现了哪些候选」 |
| 旧列表路由 | ❌ 已随 `RESEARCH-EXPERIMENT-003` 整体移除（`/research*` `/findings*` `/conclusions*` `/candidates` 列表） |

## 2. User Goal

在③研究阶段出口能**浏览我产出的候选**，判断哪些值得转正为策略，并一键进入详情 / 转正。

## 3. User Flow

```text
③ 研究实验（跑完一个 Run）
   ↓  产出 Candidate（既有路径，不改）
候选列表 /candidates（新增）
   ↓  按「状态 / 来源 Dataset 版本」筛选；点击行
候选详情 /candidates/:candidateId（已存在，不改）
   ↓  CandidateLifecycleActions（REVIEW / ACCEPTED / REJECTED / ARCHIVED）
   ↓  PromoteCandidateDialog（唯一转正入口，已存在，不改）
④ 策略（新的 StrategyVersion）
```

## 4. Inputs / Outputs

| | 内容 |
|---|---|
| Inputs | 筛选：`status`（REVIEW / ACCEPTED / REJECTED / ARCHIVED / CONVERTED）· `sourceDatasetVersionId` |
| Outputs | 候选列表行（轻量字段）→ 跳详情；转正仍走既有 `PromoteCandidateDialog` |

**列表行字段（最小集）**：`id` · `name` · `status` · `sourceDatasetVersionId` · `strategyDefinitionId`（若有）· `createdAt` · `updatedAt`

## 5. Business Rules

| # | 规则 |
|---|---|
| 1 | **只读列表**；任何写操作仍只经既有 `update` / `transition` / `promote` |
| 2 | 筛选维度**只允许** `status` 与 `sourceDatasetVersionId`；🔴 **禁止**用 `experimentId` / `conclusionId`（旧链遗留列）做筛选 |
| 3 | 列表**不返回**完整候选定义（避免大载荷）；完整定义由详情端点的 `get` 提供 |
| 4 | 🔴 必须区分「**来源** Dataset 版本」与「**执行绑定** Dataset 版本」：存在 `sourceDatasetDivergenceReason` 的候选必须在列表上有可见标记 |
| 5 | 不恢复被 003 移除的旧 Research 路由与语义 |
| 6 | 转正唯一入口不变：`strategyCandidate.promote`（adminProcedure） |

## 6. Acceptance Criteria（逐条可测）

| # | 判据 |
|---|---|
| AC-1 | 存在可达的候选列表页，列出候选行并可跳转详情 |
| AC-2 | 支持按 `status` 与 `sourceDatasetVersionId` 筛选 |
| AC-3 | 存在来源/执行绑定分歧的候选，在列表上有可见标记 |
| AC-4 | 空态文案说明「候选来自研究实验的产出」，并给出进入 `/research-experiments` 的跳转 |
| AC-5 | 列表页**不含**任何写操作按钮（写操作只在详情页） |
| AC-6 | 端点用 zod `.output()` 收口；`shared/**` 契约与 zod 闭集同步（不同步会导致生产 tRPC 拒值） |
| AC-7 | `pnpm run check` 0 错；`legacyFreeProductionChain` 等边界 Gate 不回归 |

## 7. Non-goals

- ❌ 批量操作 ❌ 跨实验候选对比 ❌ 新建表 / 改 DB
- ❌ 修改候选的写入语义（`update` / `transition` / `promote` 一律不动）
- ❌ 使用 `experimentId` / `conclusionId` 等旧链遗留列
- ❌ 恢复 `/findings*` `/conclusions*` 等已退役路由（见 PD-02）

## 8. Risks

| 风险 | 处置 |
|---|---|
| 用「来源 Dataset」当「执行 Dataset」展示 ⇒ 用户误判策略跑在哪一版数据上 | 规则 4 + AC-3 强制显示分歧标记 |
| 候选总数极少（**< 10**）时列表收益低 | PD-03 已登记重评触发条件 |
| 列表载荷过大（候选含 `parameterSpace` / 三套规则 JSON） | 规则 3：列表只返回最小字段集，完整定义走 `get` |

---

## 9. 前置：Architecture Scope（草案，待复核）

### 9.1 需要新增的契约面

| 项 | 内容 |
|---|---|
| Procedure | `strategyDomain.strategyCandidate.list`（只读 · `publicProcedure`，与既有 `get` 同权限口径） |
| Input | `{ status?: CandidateStatus; sourceDatasetVersionId?: number; limit?: number; order?: "asc" \| "desc" }` |
| Output | `{ items: CandidateListRow[]; total?: number }`；`CandidateListRow` = `id` / `name` / `status` / `sourceDatasetVersionId` / `strategyDefinitionId` / `createdAt` / `updatedAt` / `hasSourceDatasetDivergence: boolean` |
| 契约落点 | 与既有 candidate 契约同源（`shared/researchContracts.ts` 或 `server/research/strategyCandidate/types.ts`，**由 Architecture 复核后定**）；TS 类型由 zod `z.infer` 派生，禁止手抄两份 |

### 9.2 Blast Radius（实测）

| 层 | 现状 | 本次是否改动 |
|---|---|---|
| 仓储 | ✅ `ResearchStrategyCandidateRepository.list(filter)` **已存在**（`server/research/candidateRepository.ts:90`） | ❌ 不改 |
| 过滤类型 | ✅ `ResearchCandidateListFilter` 已存在（含 `status` / `sourceDatasetVersionId` / `limit` / `order`） | ❌ 不改 |
| Router | `strategyCandidate` 现仅 `get` / `update` / `transition` / `promote` / `getVersionProvenance` | ➕ 新增 `list` |
| 表 | `research_strategy_candidate` 存在 | ❌ 不改 |
| DB / migration | — | ❌ **零 DDL / 零 DML / 零 migration** |
| 前端 | 详情页 + `PromoteCandidateDialog` 已存在可复用 | ➕ 新增列表页 + 路由 |

### 9.3 边界约束（不得违反）

1. **只读**：新端点不得触达 `strategyPersistence` 的写路径 / 不得修改任何行。
2. **契约闭集同步**：`.output()` 的 zod 闭集必须与 `shared/**` 同步，否则生产 tRPC 会拒值（本仓库已多次踩到）。
3. 🔴 **不使用旧链遗留列**：`experimentId` / `conclusionId` 虽在 filter 类型里，但**不得**出现在新端点的 input 契约中（避免把已退役结构固化进新 API）。
4. **不改既有 procedure 签名**；新增不破坏既有消费者（`StrategyCandidateDetail` 的 `get`）。
5. 现有边界 Gate（`tests/server/research/legacyFreeProductionChain.test.ts`）必须保持通过。

### 9.4 交付顺序

```text
Architecture Agent：确认 §9.1 的契约落点与字段集 → 出正式 Scope
        ↓
Frontend Agent：列表页 + 路由 + 筛选 + 空态（复用 common/* 组件）
        ↓
Verification Agent：Before/After（仅新增只读端点，判据 = 既有 procedure 输出不变 + 边界 Gate 不回归）
```