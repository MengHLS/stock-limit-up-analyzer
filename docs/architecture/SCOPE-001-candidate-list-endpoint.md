# SCOPE-001 — 候选列表只读端点（PD-03 前置 Architecture Scope）

> 日期 2026-10-03 · 作者 **Architecture Agent** · 上游 `docs/product/SPEC-003-PD03-candidate-list.md` §9
> 模式 `SCOPE ONLY`（本文件**只出边界与方案**，不改任何代码；实现须另立阶段）
> 输出格式对齐 `.agents/architecture/SKILL.md` §5（Current Architecture / Dependency Map / Legacy Paths / Problems / Proposed Refactor / Scope / Risk / Test Plan）

---

## 1. Current Architecture（现状）

```text
tRPC: strategyDomain.strategyCandidate.*            （server/strategyDomainRouter.ts:126 挂载）
  └─ createDefaultStrategyCandidateRouter({ codeVersion })   server/research/strategyCandidate/router.ts:231
       ├─ get                (publicProcedure)   → service.get(candidateId)
       ├─ update             (adminProcedure)    → service.update(...)
       ├─ transition         (adminProcedure)    → service.transition(...)
       ├─ promote            (adminProcedure)    → service.promote(...)   ← 唯一转正入口
       └─ getVersionProvenance (publicProcedure)
                    ↓
       service.ts  →  candidateRepository.ts#createDbResearchCandidateRepository()
                    ├─ getById(id)
                    ├─ list(filter)      ← 🔴 能力已存在，仅未暴露
                    ├─ update(id, patch)
                    ├─ setSourceDatasetDivergenceReason(id, reason)
                    └─ delete(id)
                    ↓
       drizzle/schema.ts#researchStrategyCandidate   （表在，无需 DDL）
```

**前端现状**：详情页 `client/src/pages/candidates/StrategyCandidateDetail.tsx`（路由 `/candidates/:candidateId`，走 `strategyDomain.strategyCandidate.get`）；**无列表页**。

## 2. Dependency Map（依赖）

| 方向 | 对象 | 说明 |
|---|---|---|
| 被依赖 | `research/candidateRepository.ts#list` + `ResearchCandidateListFilter` | 过滤能力已具备 |
| 被依赖 | `drizzle/schema.ts#researchStrategyCandidate` | 表已存在 |
| 被依赖 | `toTrpcError`（`candidateRepositoryErrors`） | 错误码映射既有 |
| 依赖 | `shared/**` 契约（candidate 相关） | **新增 list item 契约需落在既有契约文件** |
| 消费者（新增） | 新增前端列表页 | 只读消费 |
| 不可依赖 | `strategyPersistence/**` 写路径 | 只读边界 |

## 3. Legacy Paths（本次涉及的遗留物）

| 遗留物 | 位置 | 处置 |
|---|---|---|
| `ResearchCandidateListFilter.experimentId` / `conclusionId` | `server/research/candidateRepository.ts:60-61` | 🔴 **保留但不得进入新端点 input 契约**（旧链遗留列，PD-02 已裁定该链路退役） |
| `sourceCandidateId` / `sourceConclusionId` | candidate 行内遗留列 | 列表**不展示、不过滤** |
| 旧候选列表路由 | 已随 `RESEARCH-EXPERIMENT-003` 移除 | **不恢复**；新列表页是新路由，不复用旧语义 |

## 4. Problems（要解决的问题）

1. Candidate 是 ③→④ 交接物，但**无列表入口** ⇒ 用户无法回答「我发现了哪些候选」。
2. 仓储已有 `list(filter)`，能力**躺在数据层未暴露**。
3. 存在「来源 Dataset」与「执行绑定 Dataset」分歧（`sourceDatasetDivergenceReason`），列表若只显示一个坐标会**误导**。

## 5. Proposed Refactor（方案）

**方案 A（推荐）：新增一个只读 procedure，复用既有仓储 `list`。**

```text
strategyDomain.strategyCandidate.list   (publicProcedure, 只读)
  input : { status?, sourceDatasetVersionId?, limit?, order? }
  output: candidateListRowSchema.array()      // 轻量行，不含三套规则 JSON
```

- 不改仓储、不改表、不改既有 procedure。
- 列表行**必须**带 `hasSourceDatasetDivergence: boolean`（由 `sourceDatasetDivergenceReason != null` 派生），供前端显示分歧标记。

**方案 B（不推荐）**：复用 `get` 逐条拉取 ⇒ N 次查询 + 大载荷，且 `get` 返回 experiment/conclusion 摘要（旧链结构）。

**契约落点**：新增 schema 与既有 candidate 契约**同文件同源**（`shared/researchContracts.ts` 或 `server/research/strategyCandidate/types.ts`，按既有 zod+TS 同源纪律）；TS 类型由 `z.infer` 派生，**禁止手抄两份**。

## 6. Scope（允许改 / 不允许改）

| 允许 | 不允许 |
|---|---|
| ✅ `server/research/strategyCandidate/router.ts` 新增 `list` procedure | ❌ 改 `get` / `update` / `transition` / `promote` 的签名与行为 |
| ✅ 既有契约文件新增 list item schema | ❌ 新建表 / 改 DB / 新 migration |
| ✅ 前端新增列表页 + 路由 + 侧栏入口 | ❌ 复用旧 Research 路由语义 |
| ✅ 复用 `components/common/**` | ❌ 引入 `experimentId` / `conclusionId` 作为筛选 |
| ✅ 新增测试（只读端点） | ❌ 放宽 `legacyFreeProductionChain.test.ts` 等边界 Gate |

## 7. Risk（风险）

| 风险 | 等级 | 处置 |
|---|---|---|
| zod `.output()` 闭集与 `shared/**` 不同步 ⇒ **生产 tRPC 拒值** | **高** | 契约同源 + 测试锁；本仓已多次踩到 |
| 列表载荷过大（候选含 `parameterSpace` / entry/filter/exit/risk 四套 JSON） | 中 | 方案 A 只返回轻量行；完整定义走 `get` |
| 用「来源 Dataset」冒充「执行 Dataset」 | 中 | 强制 `hasSourceDatasetDivergence` + 前端标记 |
| 误把遗留列固化进新 API | 中 | §3 明确禁止进入 input 契约 |
| 边界 Gate 回归 | 中 | 实现后必须跑 `legacyFreeProductionChain.test.ts` |

## 8. Test Plan

| 项 | 内容 |
|---|---|
| 新增单测 | `list` 的空结果 / 默认排序 / `status` 过滤 / `sourceDatasetVersionId` 过滤 / limit 截断 |
| 契约测试 | 输出 schema 与 TS 类型同源（`z.infer`），`hasSourceDatasetDivergence` 派生正确 |
| 边界 Gate | `pnpm exec vitest run tests/server/research/legacyFreeProductionChain.test.ts`（7 用例）保持通过 |
| 既有回归 | `strategyCandidate` 既有 5 个 procedure 的测试不回归 |
| 类型 | `pnpm run check` 0 错 |
| 行尾 | `node scripts/checkEolDrift.mjs --strict` = 0 |

**Scope 结论**：`READY for Implementation`（零 DDL、零迁移、单端点新增、既有能力复用）。

---

## 9. 实现前修正（2026-10-03，实测）

🔴 **§5 方案 A 低估了一层**：`StrategyCandidateService` 接口**没有 `list`** —— 只有
`get` / `update` / `transition` / `promote` / `getVersionProvenance`（`service.ts:205-231`）。
因此实际改动面应为 **3 层**，而非 1 层：

| 层 | 需要新增 |
|---|---|
| 仓储 | ❌ 不用改（`list(filter)` 已存在） |
| **Service** | ➕ `StrategyCandidateService.list(filter)` 接口 + `createStrategyCandidateService` 实现（映射为轻量行） |
| **Router** | ➕ `list` procedure |
| 契约 | ➕ 输入 + 输出 schema（zod + `z.infer` 同源） |

结论仍为 `READY for Implementation`（依旧零 DDL / 零迁移），但**工作量与风险比 §7 估计略高**：
Service 层新增只读方法需要保持与既有 `get` 相同的错误映射（`toTrpcError`）与权限口径。