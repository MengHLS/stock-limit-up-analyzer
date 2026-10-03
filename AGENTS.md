# AGENTS.md — 项目级 Coding Agent 总规则

> 本文件是 `stock-limit-up-analyzer` 仓库**唯一的总规则入口**，适用于在本仓库工作的所有 Coding Agent（Codex / Claude Code / Cursor / WorkBuddy 等）。
> 与既有文档的关系：本文件**只定义规则与边界**；架构事实见 `docs/architecture/**`；Agent 作业细则见 `docs/architecture/AGENT-GUIDE.md`；工程细则见 `.workbuddy/memory/PROJECT_RULES.md`（⚠️ 该目录已 untrack + gitignore，**只在本地磁盘存在**，`git clone` 后没有）。
> 建立时间：2026-10-03（任务 `CODE-AGENT-INFRA-001`）。**本文件不改变任何业务代码、数据库 schema 或 migration。**

---

## 0. 开工前默认读取顺序

```text
1. AGENTS.md                                   ← 本文件（规则与边界）
2. docs/architecture/SYSTEM-BASELINE.md        ← 当前架构基线（总入口）
3. docs/architecture/ARCHITECTURE.md           ← 当前实际架构（与实际代码同步）
4. docs/architecture/CHANGE-AUDIT.md           ← 上一次发生了什么
5. 当前任务相关的 docs/architecture 地图
   （MODULE-MAP / LEGACY-MAP / DOMAIN-MAP / DATA-FLOW / EXECUTION-FLOW /
     DEPENDENCY-MAP / CONTRACT-MAP / DATABASE-MAP）
6. 当前任务相关代码 + 直接上游/下游（只取直接依赖与直接消费者）
7. 必要时：docs/INDEX.md 找文档入口
```

按任务类型的最小必读集（与 `docs/architecture/AGENT-GUIDE.md` §1 一致）：

| 任务类型 | 必读 |
|---|---|
| 改某 Domain 逻辑 | `DOMAIN-MAP.md` 该节 + `DEPENDENCY-MAP.md` |
| 改数据结构 / 新表 | `DATABASE-MAP.md` + §4 数据库规则 |
| 改契约 / 指标 | `CONTRACT-MAP.md` |
| 改执行链 / 回测 | `EXECUTION-FLOW.md` |
| 改前端 | `SYSTEM-BASELINE.md` 前后端边界一节 |
| 查「现在到底是什么状态」 | `SYSTEM-BASELINE.md` + 真实库**只读**探针 |

🔴 **开工第一件事**：`git status --porcelain`。本仓库长期存在**未提交的工作区改动**（含并发会话）⇒ 先确认「你审计/修改的是哪一份代码」。
🔴 **定位一律用「路径 + 符号名」**（例如 `server/strategyCore/runtime.ts#StrategyRuntime.evaluate`），**行号只作辅助**——本仓库 `server/**` 处于高频编辑状态，行号会漂移，对不上**不算 drift**。

---

## 1. 项目定位

这是一个**个人 A 股量化策略研究平台**（从「涨停/连板分析应用」演进而来）。完整研究链路：

```text
Dataset
→ Research
→ Strategy
→ Parameter Search
→ Backtest
→ Evaluation
→ Robustness
→ OOS
→ WFA（Walk-Forward）
→ Paper Trading
→ Production
```

- **技术栈**：React 19 · Vite 7 · TypeScript 5.9（strict）· Express 4 · tRPC 11 · Drizzle ORM（mysql2 / TiDB）· Vitest 2 · pnpm。
- **唯一 Master Control**：`ROADMAP.md`（§44 覆盖式状态区 / §44.5 队列 / §47 append-only）。
- **最终目标**：把主观交易经验 → 明确规则 → 程序化策略 → 历史验证 → 参数优化 → 稳健性/OOS → 模拟交易 → 交易纪律，形成**可信、可复现**的闭环。
- **当前现实**：闭环编排器声明 14 阶段，实际执行器只装配 `data / research / strategy / backtest / evaluation` 等子集；`Robustness / OOS / WFA / Overfitting` 各自有**独立 tRPC 路由**（技术预览口径）。**可达性以代码与 `docs/architecture/EXECUTION-FLOW.md` 为准，不以路线图名称为准。**

---

## 2. 核心原则（不变量）

> **纯代码重构不得改变下列任何一项。** 这些是「研究结果可复现、可对比」的前提。

| # | 不变量 | 含义 |
|---|---|---|
| I-1 | **Dataset 语义** | 事件定义、相对日窗口、五表分层、筛选口径的**构建时固化**不可后改 |
| I-2 | **`datasetVersionId`** | 运行时**唯一**数据集坐标（bigint）；`datasetVersion` label / 内容寻址串**仅展示** |
| I-3 | **`decisionOffsetDays`** | 决策/判定日必须**显式声明**；老数据集上引用观察日条件会被**响亮拒绝**（`OBSERVATION_WITHOUT_DECISION_DAY`），这是刻意行为 |
| I-4 | **PIT（Point-In-Time）** | 结构级防线：`prefix`(rd≤0) ↔ `post`(rd≥1) 在 t 日分界；未声明 `usesForwardData` 时读 `rd≥1` 直接抛错 |
| I-5 | **StrategyVersion** | 不可变版本 + semver + 行为指纹；改内容**只能**走 `applyDefinitionChange()` → 新版本 |
| I-6 | **RuleGraph / Strategy Core 语义** | `server/strategyCore/**` 是策略语义**唯一权威**；legacy `StrategyDefinition` 降级为存储编码 |
| I-7 | **FIXED / TUNABLE / DERIVED** | 参数角色划分与解析语义不可改；`derivedFrom` 无求值器属**已知缺口**，不是「自由发挥」的空间 |
| I-8 | **Backtest metrics** | `canonicalMetrics()` 是**唯一指标出口**；Evaluation 在已有 canonical 时不得重算重叠指标 |
| I-9 | **Paper Trading state** | 模拟账户状态、前向纸面语义不可被重构悄悄改写 |
| I-10 | **已验证策略行为** | 已被真实 Run / 测试锁定的策略行为（含 `equityDigest` / `tradeDigest`）不得变化 |

**冲突时的证据优先级**（`ROADMAP` §3）：**真实 DB 状态 > 实际运行结果 > 实际代码 > 自动化测试 > 文档 > 设计假设**。
发现「文档说 A / 代码是 B」⇒ 标 `BASELINE_DRIFT` → 修正**文档**（不改代码）→ 记录原因 → 再继续。

---

## 3. 修改原则

### 优先（做）

- **小步重构**、**最小 Scope**、**保持行为一致**
- **增加测试**（新增行为必须有测试锁）
- **降低耦合**、**消除重复**、**明确模块边界**
- 提取重复逻辑 / 明确接口 / 消除 legacy 依赖 / 提升类型安全 / 拆分过大模块 / 删除**已确认**无用代码

### 禁止（不做）

- ❌ 无理由重写整个模块
- ❌ 一次删除大量 legacy
- ❌ 修改与任务无关的模块
- ❌ **为通过测试而修改测试**（测试是行为契约；要改先说明为什么测试错了）
- ❌ 通过**数据库结构修改**解决普通代码问题
- ❌ 新建第二套 SoT（第二套 `backtestCore/**`、第二套 `canonicalMetrics`、第二套 Dataset 坐标）
- ❌ 绕过 Strategy Core 新开 legacy execution path

### 依赖方向

领域依赖**只允许单向向下**：`Dataset → Research → Strategy → Parameter Search → Backtest → Evaluation → Robustness/OOS/WFA → Simulation/Paper → Production`。
**反向依赖 = 架构违规**。已有静态守卫测试（`*Boundary.test.ts` / `legacyFreeProductionChain.test.ts`）钉住多条边 —— 不要为了「方便」把它们改松。

---

## 4. 数据库规则

**未经明确授权，禁止**：

- ❌ 执行 `pnpm run db:push`（= `drizzle-kit generate && drizzle-kit migrate`，**当前不可用**：journal 止 `0023` / snapshot 止 `0015`）
- ❌ `drizzle-kit generate` / 手写或修改 `drizzle/meta/_journal.json`（属伪造）
- ❌ 修改历史 migration
- ❌ 删除生产数据 / 批量生产数据修改
- ❌ `DROP TABLE` / `DROP COLUMN` / `TRUNCATE`
- ❌ 增加**不必要**的外键（当前全库 **0 FK**，跨表一律软引用 `id`，由应用层保证）

**允许（默认只读）**：schema inspection · `SELECT` · migration inspection · 依赖分析 · SQL draft · migration validation。

- ✅ migration 必须**显式**：手写 SQL（`-- @guard:` 幂等守卫）+ 专用 `scripts/apply*.mjs|mts` 旁路执行；`applySqlMigration.mjs` 是通用幂等执行器。
- ✅ 幂等判据：apply 两次 ⇒ 第二次 `0 executed / N skipped`。
- ✅ 数据库变更**必须先报告影响**（见 `.agents/database/SKILL.md` 的输出模板），**等待明确授权后才执行危险操作**。

---

## 5. Agent 权限

### 可以（无需额外授权）

- 阅读代码 / 搜索依赖 / 修改代码 / 增加测试 / 执行测试 / 修复测试失败
- 创建与更新**文档**（架构地图、审计记录）
- 运行**只读**探针（`SELECT`、schema 检查）

### 不得自行决定（必须停下并报告）

- 修改核心业务口径 / 研究定义
- 修改历史数据 / 回填历史 Run
- 删除重要架构模块
- 改变策略逻辑（`RuleGraph` 语义、特征定义、执行语义）
- 修改数据库 migration 历史 / 执行 DDL / DML 批量写
- 绕过 Strategy Core 新增策略执行路径
- 把「未装配」阶段改成**静默 success**（必须保持如实 `BLOCKED` / `CL_RUNNER_NOT_INJECTED`）

遇到上述情况：**停止 → 输出影响分析 → 等用户裁定**。

---

## 6. 工程铁律（本机实测）

| # | 规则 |
|---|---|
| 1 | 🔴 **禁跑 `pnpm run format`**（`prettier --write .` 会把 CRLF 文件整体翻成 LF，产生巨量无意义 diff）。本仓库**禁用 `prettier --write`**。 |
| 2 | 🔴 **新文件一律 LF**；改「已跟踪且为 CRLF」的文件后，收尾必须保持该文件 CRLF（不要被工具翻成 LF）。收尾跑 `node scripts/checkEolDrift.mjs --strict`，**必须 0**。 |
| 3 | 🔴 **日常测试用 `pnpm run test:changed`**（git 改动 → 反向依赖图 → 只跑受影响测试）；全量 `pnpm test` 只在**验收 / 合并前**跑一次。全量含**恒红文件**（离线环境依赖 + 已知失效用例），跑它只会把「零新增失败文件」退化成人工比对。 |
| 4 | 🔴 **类型检查判据 = `pnpm run check`（`tsc --noEmit`）必须 0 错**。 |
| 5 | 端口一律以**启动日志实际打印**的为准（Windows 上 `3000` 可能落在保留端口段而 `EACCES`，dev server 会静默回落到相邻端口）。 |
| 6 | 不要在 npm 脚本里写前置环境变量赋值（`NODE_ENV=x tsx ...`）—— Windows `cmd.exe` 会报错；运行模式由 `server/_core/env.ts#resolveRuntimeNodeEnv` 运行时判定。 |
| 7 | 长任务输出**落盘再读**，**禁接管道**（EPIPE 会中止脚本）。 |
| 8 | 一次性脚本 / 探针写到仓外 `_scratch\` 或 `scripts/_scratch/`（后者已 gitignore）；**不要把临时文件留在仓库根**。 |
| 9 | `.workbuddy/**` 已 untrack + gitignore ⇒ **禁止 `git add -f`**。跨机协作只能靠 `docs/**`。 |
| 10 | `client/**` 不得 import `server/**` 的**运行时值**（只允许 `import type`）；口径函数必须落 `shared/`。 |

### 常用命令

```bash
pnpm run check                 # tsc --noEmit（必须 0 错）
pnpm run test:changed          # 增量测试（日常默认）
pnpm exec vitest run <path>    # 单文件 / 单模块
pnpm test                      # 全量（仅验收）
pnpm run docs:tests            # 重新生成 docs/testing/**（生成物禁手改）
node scripts/checkEolDrift.mjs --strict
```

---

## 7. 专业化 Skill（`.agents/`）

按任务类型选择对应 Skill，先读 SKILL.md 再动手：

| Skill | 何时使用 |
|---|---|
| [`.agents/architecture/SKILL.md`](.agents/architecture/SKILL.md) | 分析模块 / 调用关系 / 依赖 / legacy / 最小重构边界（**默认只分析不改码**） |
| [`.agents/refactoring/SKILL.md`](.agents/refactoring/SKILL.md) | 在已确定 Scope 内执行重构（Baseline → Refactor → Test → Verify） |
| [`.agents/verification/SKILL.md`](.agents/verification/SKILL.md) | 判断重构是否保持原有行为（Before vs After） |
| [`.agents/database/SKILL.md`](.agents/database/SKILL.md) | schema / migration / SQL 检查与变更影响评估（**默认只读**） |
| [`.agents/strategy/SKILL.md`](.agents/strategy/SKILL.md) | Strategy Core / RuleGraph / 参数角色 / 版本化演进 |
| [`.agents/research/SKILL.md`](.agents/research/SKILL.md) | Dataset → Experiment → Run → Finding → Conclusion → Candidate → Strategy 演进 |

推荐流水线：**Architecture Agent → Refactoring Agent → Verification Agent**。

---

## 8. 任务报告格式（建议）

```text
1.  Task
2.  Baseline Version          ← 你读取的是哪个版本
3.  Relevant Domains
4.  Pre-existing Facts        ← 来自 Baseline / 实查
5.  Changes
6.  Contract Impact
7.  DB Impact
8.  Execution Impact
9.  Tests
10. Baseline Update           ← 更新了哪些基线文件
11. Remaining Risks
12. Next Step
```

**完成任务后**（`docs/architecture/AGENT-GUIDE.md` §5）：

| 变更类型 | 必须做的事 |
|---|---|
| 只有实现细节变化 | 只更新 `docs/architecture/CHANGE-AUDIT.md` |
| Domain 状态跃迁 / 新增 entry point / 新增 contract | `CHANGE-AUDIT.md` + `SYSTEM-BASELINE.md` + `system-manifest.yaml`（minor） |
| 触发 `GLOBAL AUDIT REQUIRED` 任一条 | 全局审计 + 更新**全部**基线文件（major） |

---

## 9. 完成定义（Definition of Done）

一个任务只有同时满足下列条件才算完成：

1. ✅ `pnpm run check` 0 错
2. ✅ 受影响测试通过（`pnpm run test:changed` 或显式路径），**零新增失败文件**
3. ✅ `node scripts/checkEolDrift.mjs --strict` = 0
4. ✅ 行为一致性已验证（不变量 §2 未被破坏）；不涉及行为变化的任务需说明「为什么不可能影响行为」
5. ✅ 契约 / 数据库 / execution 影响已报告
6. ✅ baseline 文档按 §8 规则更新
7. ✅ 报告写完（§8 格式）

---

## 10. 本文件的维护

- 本文件由 `CODE-AGENT-INFRA-001` 建立。新增/修改规则时**先合并，不覆盖**。
- 若本文件与 `docs/architecture/**` 冲突：**架构事实以 `docs/architecture/**` + 代码为准**，本文件只保留规则。
- 若发现本文件描述的规则与 `.workbuddy/memory/PROJECT_RULES.md` 冲突：以**更严格**的一条为准，并把差异登记到 `docs/architecture/CHANGE-AUDIT.md`。