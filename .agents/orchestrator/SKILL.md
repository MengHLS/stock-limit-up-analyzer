---
name: orchestrator-agent
description: Goal 驱动的任务编排协议。读取 Codex Goal 与当前任务状态（.agent/task-state.yaml），建立执行 Pipeline，判断 READY 阶段，按对应专业 Skill 的规则执行、验证、更新状态，并在 Goal 仍 active 且无 blocker / NEEDS_HUMAN 时自动继续，直到 COMPLETE / BLOCKED / NEEDS_HUMAN。Use this skill when a Codex Goal is active, or when the user asks to implement, complete, finish, or continuously advance a multi-stage feature or engineering task.
---

# Orchestrator Agent Skill —— Goal 驱动编排协议

> 项目：`stock-limit-up-analyzer`。执行本文件前先读仓库根 `AGENTS.md`、`ROADMAP.md`、`docs/architecture/SYSTEM-BASELINE.md`、`ARCHITECTURE.md`、`CHANGE-AUDIT.md`，再读取当前任务相关的架构地图与专业 Skill。
> 🔴 **Orchestrator 负责「怎么推进」，不负责重新定义「什么是对的」。** 产品语义、架构边界、策略语义、研究口径、数据库安全和验证判据分别归对应 Skill 与权威文档；冲突时必须停下并进入 `NEEDS_HUMAN`。
> 🔴 **Orchestrator 不把 Skill 当工具函数调用。Skill 是工作规则；Codex 是执行主体。Orchestrator 只负责：识别阶段 · 选择规则 · 检查前置条件 · 判断是否继续 · 判断是否停止。**

## 1. 核心模型

```text
Codex Goal
    ↓
Orchestration Protocol（本文件）
    ↓
当前任务状态（.agent/task-state.yaml）
    ↓
选择下一阶段
    ↓
按对应 Skill 的规则执行（Codex 执行，不是「调用」某个 Skill）
    ↓
测试 / 验证
    ↓
更新状态
    ↓
继续 Goal
```

这是一个**单一 Codex 执行主体 + 多套工作规则**的模型，不是「Skill 调用 Skill」的框架：

- **Orchestrator（本文件）**：决定「现在该做什么、按哪套规则做、做到什么程度算完、下一步是什么」。
- **专业 Skill（`.agents/*/SKILL.md`）**：只定义各自那一层「怎么做才算对」的工作规则。
- **Codex**：唯一执行主体；读取本协议 + 对应 Skill 的规则，然后自己执行、测试、验证。

> ⚠️ 禁止任何虚假调用机制：`call_skill()` / `invoke_skill()` / `run_skill()` / `dispatch_skill()` / 任何「Skill 句柄」都是**不存在的概念**。所谓「进入 PRODUCT 阶段」= Codex 按 `.agents/product/SKILL.md` 的规则工作，而不是调用一个函数。

## 2. 强制边界

Orchestrator **不得**：

- 自行改变 Strategy 规则、Research 定义、Dataset 语义、PIT 语义、Backtest 口径或 Paper Trading 状态语义。
- 执行数据库危险操作（`DROP`、批量生产数据修改、历史 migration 修改、生产 schema 变更等）。
- 绕过 `server/strategyCore/**` 新增策略执行路径。
- 把未装配、未验证、`UNKNOWN`、测试失败或 `BLOCKED` 的阶段标记为 `COMPLETE`。
- 为了继续推进而跳过验证、隐藏 blocker、放宽边界测试或扩大 Goal。
- 未经用户明确要求重做已 `COMPLETE` 的阶段（返工必须由用户明确授权并新建阶段记录）。
- 创建第二套长期任务状态 SoT：`.agent/task-state.yaml` 只描述**当前 Goal 的过程状态**，长期状态载体仍是 `ROADMAP.md` / `ROADMAP-CHANGELOG.md`。
- 覆盖或回滚工作区中与当前 Goal 无关的既有改动（本仓库长期存在并发会话的未提交改动）。
- 自行创建 / 激活 Goal，或在没有 Goal 的情况下假装按 Goal 推进。

如果任务与 `AGENTS.md` §2 不变量冲突，必须标记冲突并停止，不得默默修改语义。

## 3. 开工前读取顺序

```text
 1. AGENTS.md
 2. ROADMAP.md
 3. docs/architecture/SYSTEM-BASELINE.md
 4. docs/architecture/ARCHITECTURE.md
 5. docs/architecture/CHANGE-AUDIT.md
 6. .agent/task-state.yaml（若存在）
 7. 当前任务相关架构地图
 8. 当前阶段对应的 .agents/*/SKILL.md
 9. 当前任务相关代码 + 直接上下游
10. git status --porcelain
```

按需：

- Dataset / Experiment / Run / Candidate → 先读 Research Skill。
- Strategy / RuleGraph / 参数 / 版本 → 先读 Strategy Skill。
- schema / migration / SQL → 先读 Database Skill；默认只读。
- 页面 / 交互 / 数据展示 → 先读 Product Skill，再读 Frontend Skill。
- 模块边界 / legacy / 大重构 → 先读 Architecture Skill。
- 任何实际代码修改完成后 → **必须**进入 Verification。

## 4. Goal 启动协议

### 4.1 建议使用 /goal

用户输入完整目标后，Codex **应建议**使用：

```text
/goal <objective>
```

但**不要自行创建或激活一个不存在的 Goal**。若当前环境不支持 Goal，退化为「用户在同一线程逐段推进」，不得伪造 Goal 状态。

### 4.2 Goal 必须包含的要素

```text
目标（objective）
完成条件（Definition of Done）
验证方式（verification）
约束（constraints）
Scope / Non-goals
停止条件（stop conditions）
```

### 4.3 推荐 Goal 模板

```text
/goal 完成 <目标>，
直到达到明确的可验证完成条件；
过程中遵守项目 AGENTS.md、
保持既有业务语义和测试正确性，
遇到业务语义变化、危险数据库操作、
无法解释的结果变化或缺失产品决策时停止并报告。
```

### 4.4 启动检查

- 已确认 Goal 是否 active。
- 已完成 §3 读取顺序。
- 已建立或恢复 `.agent/task-state.yaml`。
- 已建立 Pipeline（见 §7）。
- 若环境不支持 Goal：只在最终报告中说明，不升级软件、不改系统配置、不伪造 Goal。

## 5. 任务状态文件 `.agent/task-state.yaml`

### 5.1 定位

- **只描述当前 Goal** 的执行过程状态。
- **不保存长期业务知识**；不替代 `AGENTS.md`；不替代 `ROADMAP.md`。
- **不保存模型内部推理**；只记录可核对的事实（阶段、状态、证据、下一步）。
- 每个 Goal 开始时初始化；每个重要阶段完成后更新；允许每个 Goal 覆盖更新。

### 5.2 格式

```yaml
goal:
  id: ""
  title: ""
  mode: SAFE_PIPELINE
  status: ACTIVE

stages: {}

current_stage: ""

completed: []

blocked: []

needs_human: []

last_action: ""

last_verification: ""

next_action: ""
```

说明：

- `goal.status` ∈ `ACTIVE` / `COMPLETE` / `BLOCKED` / `NEEDS_HUMAN`（**Goal 级**状态，区别于阶段级状态）。
- `stages` 是「阶段名 → 阶段状态」的映射，阶段状态见 §6.2。
- `current_stage` 指向当前 `IN_PROGRESS` / `READY` 阶段。
- `completed` / `blocked` / `needs_human` 是阶段名列表。
- `last_action` / `last_verification` / `next_action` 是简短事实记录，不是推理日志。

### 5.3 维护规则

- 阶段转换必须**同时**更新 `stages` / `current_stage` / `completed`（或 `blocked` / `needs_human`）。
- 与 `ROADMAP` 冲突时以 `ROADMAP` + 代码 + 实查为准（证据优先级见 `AGENTS.md` §2）。
- 该文件**不参与业务逻辑**，任何 `server/**` / `client/**` 代码都不得读取它。

## 6. 标准阶段与状态

### 6.1 标准阶段

支持以下标准阶段（**不是每个任务都执行全部**）：

```text
PRODUCT
RESEARCH
STRATEGY
ARCHITECTURE
FRONTEND
BACKEND
INTEGRATION
REFACTORING
VERIFICATION
FINAL
```

另有**横切 Gate**（不是 Pipeline 阶段，不单独占用 `stages` 主链，但可阻断任何阶段）：

```text
DATABASE     ← 只读默认；危险操作 → NEEDS_HUMAN
```

### 6.2 阶段状态

统一状态：

```text
PENDING
READY
IN_PROGRESS
COMPLETE
BLOCKED
NEEDS_HUMAN
```

### 6.3 合法转换

只有以下转换合法：

```text
PENDING      → READY
READY        → IN_PROGRESS
IN_PROGRESS  → COMPLETE
IN_PROGRESS  → BLOCKED
IN_PROGRESS  → NEEDS_HUMAN
BLOCKED      → READY
NEEDS_HUMAN  → READY
```

禁止：

```text
COMPLETE → IN_PROGRESS
PENDING  → IN_PROGRESS
READY    → COMPLETE
```

例外：**用户明确要求返工**时，`COMPLETE → IN_PROGRESS` 允许，但必须新建阶段记录或明确标注「用户授权返工」，不得静默重开。

阶段的 `COMPLETE` 是进入下一阶段的门禁，不是口头进度。

## 7. 建立 Pipeline

先根据 Goal 建立**实际需要**的阶段链，再执行。**不要机械执行所有阶段。**

### 7.1 典型 Pipeline

新页面 / 产品功能：

```text
PRODUCT
→ FRONTEND
→ ARCHITECTURE
→ BACKEND
→ INTEGRATION
→ REFACTORING
→ VERIFICATION
→ FINAL
```

新策略：

```text
PRODUCT
→ RESEARCH
→ STRATEGY
→ ARCHITECTURE
→ BACKEND
→ INTEGRATION
→ VERIFICATION
→ FINAL
```

单纯重构：

```text
ARCHITECTURE
→ REFACTORING
→ VERIFICATION
→ FINAL
```

研究能力：

```text
RESEARCH
→ STRATEGY（涉及策略语义时）
→ ARCHITECTURE
→ BACKEND
→ INTEGRATION
→ VERIFICATION
→ FINAL
```

数据库工作：

```text
DATABASE（默认只读）
→ PRODUCT / RESEARCH / STRATEGY / ARCHITECTURE（按影响域）
→ 影响报告 + 授权门
→ BACKEND
→ INTEGRATION
→ VERIFICATION
→ FINAL
```

### 7.2 裁剪规则

- 阶段可以跳过，但必须写明**跳过理由**、依赖与风险。
- 不得把未知阶段静默当作 `COMPLETE`。
- 任何阶段内的代码修改，最终都必须经过 `VERIFICATION`。
- Pipeline 变更必须写回 `.agent/task-state.yaml` 并在汇报中说明。

## 8. 阶段 → Skill 路由表

| 阶段 | 依据的 Skill 规则 | 典型产出 |
|---|---|---|
| `PRODUCT` | `.agents/product/SKILL.md` | Product Requirement / 验收标准 / Non-goals |
| `RESEARCH` | `.agents/research/SKILL.md` | Dataset 坐标、实验口径、provenance 设计 |
| `STRATEGY` | `.agents/strategy/SKILL.md` | 策略契约与影响评估（RuleGraph / 参数角色 / 版本指纹） |
| `ARCHITECTURE` | `.agents/architecture/SKILL.md` | 现状、Scope、Risk、Test Plan（默认只分析） |
| `FRONTEND` | `.agents/frontend/SKILL.md` | 页面 / 组件 / 状态实现方案 |
| `BACKEND` | `architecture` + `strategy` / `research` / `database` 规则（按语义域） | 领域内最小实现 |
| `INTEGRATION` | 上游各 Skill 规则 + 本协议 | 跨层接通、契约对齐、端到端可用 |
| `REFACTORING` | `.agents/refactoring/SKILL.md` | 已确认 Scope 内的行为不变重构 |
| `VERIFICATION` | `.agents/verification/SKILL.md` | Before / After 验证结论（Expected / Unexpected / Unknown） |
| `FINAL` | 本协议 | 最终报告 + 状态收口 |
| （横切）`DATABASE` | `.agents/database/SKILL.md` | 只读发现或变更影响报告；危险操作 → `NEEDS_HUMAN` |

路由原则：

1. 需求未明确 → `PRODUCT` 先定义。
2. 界面要落地 → `FRONTEND` 参与。
3. 涉及策略语义 → `STRATEGY` 先裁定。
4. 涉及研究语义 → `RESEARCH` 先裁定。
5. 模块边界或依赖不清 → `ARCHITECTURE` 先分析。
6. 涉及数据库 → `DATABASE` 先评估；危险操作必须进入 `NEEDS_HUMAN`。
7. 实现完成 → `REFACTORING` 仅在确有结构问题时进入。
8. 代码变化完成 → `VERIFICATION` 是强制闸门。

## 9. READY 判定

一个阶段只有在以下条件**全部**满足时才是 `READY`：

- Goal、Scope、Non-goals 已明确。
- 无未处理的 `NEEDS_HUMAN` 或 blocker。
- 必需的上游阶段已 `COMPLETE`。
- 已读取对应 Skill 与其要求的基线资料。
- 输入坐标、契约、依赖和工作区状态已确认。
- 不触犯 `AGENTS.md` §2 不变量。
- 与当前工作区中其他改动不存在无法解释的冲突。

不满足任一项：阶段保持 `PENDING`，或标记 `BLOCKED` / `NEEDS_HUMAN` 并说明缺少什么。

## 10. 阶段执行协议

每个阶段统一执行：

1. 记录阶段开始前的状态、Git 状态与证据基线。
2. 按对应 Skill 的规则读取、产出和禁止项工作。
3. 明确本阶段输入与预期产物。
4. 只在本阶段 Scope 内执行。
5. 记录证据、命令、结果与未决项。
6. 如发生代码修改，运行对应测试并进入 `VERIFICATION`。
7. 检查阶段完成条件，更新 `.agent/task-state.yaml`。
8. 仅在重要阶段完成后按 §14 最小增量同步 `ROADMAP`。
9. 判断下一阶段是否 `READY`；可以则立即继续。

汇报只在「阶段完成、阶段阻塞、需要人工决策、最终完成」四类节点输出（见 §13）。

## 11. 阶段完成条件

阶段只有**同时**满足以下条件才能标记 `COMPLETE`：

```text
代码 / 文档修改完成
+ 相关测试通过
+ 没有未解释的失败
+ 没有超出 Scope
+ 没有违反 AGENTS.md
+ 需要代码变更时 Verification 通过
```

如果 Verification 含 `Unexpected` 或 `Unknown`，不得标记 `COMPLETE`；必须修复、回退或进入 `NEEDS_HUMAN`。

## 12. Goal 激活后的行为与自动继续

### 12.1 不主动结束线程

Goal active 时，**不要完成一个阶段就主动结束线程**。每个阶段完成后：

```text
1. 验证
2. 更新 .agent/task-state.yaml
3. 判断下一阶段
4. 如果下一阶段 READY，继续执行
5. 如果没有 READY 阶段，重新检查 Goal
6. 只有满足最终完成条件才停止
```

### 12.2 自动继续原则

自动继续只针对：

- 已定义 Goal
- 已明确 Scope
- 风险可控
- 有验证路径
- 不需要人工业务决策

### 12.3 不得继续猜测的情况

```text
业务语义不明确
产品需求冲突
Strategy 规则不明确
Research 口径冲突
数据库危险修改
测试结果无法解释
回测结果出现无法解释的变化
```

这些情况：`NEEDS_HUMAN`，并停止 Goal。

### 12.4 Goal 不是无限自动化

Goal 的目标是「持续推进到可验证的结束状态」，**不是无限修改代码**。每次迭代必须检查：

```text
是否还有未完成阶段？
是否有 blocker？
是否需要人工决策？
是否已满足完成条件？
```

达到最终完成条件 → `COMPLETE`；否则继续。

## 13. 进度报告

Goal 持续执行期间，只在以下节点报告：

### Stage Complete

```text
当前阶段
已完成
测试
下一阶段
```

### Blocked

```text
阻塞原因
已完成部分
需要什么
```

### Needs Human

```text
需要人工决定的问题
可选方案
影响范围
```

### Final

最终报告（见 §24）。

**不要每执行一个命令都向用户发送消息。**

## 14. 检查点与 ROADMAP 同步

### 14.1 每个重要阶段完成后

更新 `.agent/task-state.yaml`。

### 14.2 ROADMAP 只在必要时更新

`ROADMAP.md` 是唯一 Master Control，当前实际规则是：

- §44：覆盖式真实状态，只保留最近一条「上轮实查」。
- §44.5：**未完成**队列，只记录尚未完成且需要排队的事项。
- §47：append-only 更新记录；正文已迁至 `ROADMAP-CHANGELOG.md`。
- 替换 §44 时，旧状态必须原样归档到 `ROADMAP-CHANGELOG.md`，不得丢失历史。
- 已完成任务不新增到 §44.5。

**ROADMAP 只记录项目级事实，不记录每一步内部执行日志。** 每完成一个重要阶段，最小增量记录：Task / Stage / Status / Completed Work / Tests / Next Stage / Blocker。只更新必要位置，禁止重写整个 ROADMAP。仅内部半步骤未形成阶段结论时，不制造 ROADMAP 噪音。

## 15. Verification Gate

任何代码修改完成后，必须进入 `VERIFICATION`。

Verification 不只是运行测试，还要检查：

```text
行为一致性
业务语义
API 契约
Dataset 坐标
PIT
StrategyVersion
decisionOffsetDays
Backtest
Paper Trading
```

如果纯重构没有业务变化，应尽可能证明：

```text
Before ≈ After
```

如果结果变化，必须分类：

```text
Expected
Unexpected
Unknown
```

`Unexpected` / `Unknown` 不得自动标记 `COMPLETE`。

## 16. Database Gate

只要任务进入 `DATABASE`：

默认：

```text
READ ONLY
```

以下必须进入 `NEEDS_HUMAN`：

- `DROP` / `TRUNCATE` / `DROP COLUMN`
- 生产数据批量修改
- 历史 migration 修改
- schema 破坏性变更
- 不可逆数据库操作
- `pnpm run db:push` / `drizzle-kit generate` / 伪造 `_journal.json`

允许默认执行：schema inspection · `SELECT` · migration inspection · 依赖分析 · SQL draft · migration validation。

## 17. Strategy / Research Gate

如果任务涉及 **Strategy**，必须确认：

```text
Strategy
StrategyVersion
RuleGraph
FIXED / TUNABLE / DERIVED
PIT
```

如果任务涉及 **Research**，必须确认：

```text
Dataset
datasetVersionId
Experiment
Run
实验结论（自定义 payload）
Candidate
provenance
```

不允许为了实现功能而偷偷改变这些语义。语义变化 = `NEEDS_HUMAN`。
（注：`Finding` / `Conclusion` **不属本平台概念**，见 PD-02。）

## 18. Git 安全

当前仓库存在其他会话在途修改。因此 Orchestrator：

禁止：

```text
git add .
git commit
git reset --hard
git clean -fd
```

除非用户明确授权。**不得清理其他会话产生的 working tree 修改。** 只允许针对本 Goal 明确涉及的文件做最小改动，且不 `commit`、不 `stage` 其他会话的文件。

## 19. 与现有 Skills 的协作

保持现有 Skill 不变。Orchestrator 只决定：

```text
当前需要 Product 规则        → Codex 按 product-agent 规则执行
当前需要 Frontend 规则       → Codex 按 frontend-agent 规则执行
当前需要 Architecture 规则   → Codex 按 architecture-agent 规则执行
……
```

Skill 本身仍然是**规则**，Codex 是实际执行者。Orchestrator 不替它们做业务判断。

## 20. 实际工作模式（示例）

当用户说：

```text
/goal 完成 Runner 研究页面并接入现有 Research → Strategy 流程。
```

Codex 应自动：

```text
 1. 读取 AGENTS.md
 2. 读取 .agent/task-state.yaml
 3. 建立 Pipeline
 4. PRODUCT
 5. FRONTEND
 6. RESEARCH / STRATEGY（按需）
 7. ARCHITECTURE
 8. BACKEND
 9. INTEGRATION
10. REFACTORING（按需）
11. VERIFICATION
12. FINAL
```

中间**不要求**用户逐阶段发送「继续 / 继续 / 继续」。只要：Goal 仍 active · 当前线程允许继续 · 没有 blocker · 没有 `NEEDS_HUMAN`，就继续推进。

## 21. Goal 完成判断

只有同时满足：

```text
功能完成
+ 测试通过
+ Verification 通过
+ Scope 未越界
+ 没有未解释 blocker
+ 没有违反 AGENTS.md
```

才标记：

```text
COMPLETE
```

## 22. BLOCKED 处理

只有依赖**外部条件**、而非语义决策问题时，才使用 `BLOCKED`：

```text
API 不存在
数据库字段不存在
测试环境损坏
依赖模块尚未完成
外部数据 / 权限尚未就绪
```

`BLOCKED` 记录必须包含：

```text
Blocker
Affected Stage
Required Condition
Suggested Resolution
```

不得假装 `COMPLETE`；不得把测试失败直接归因于环境，必须有证据。

## 23. Scope 控制

每个任务必须保持 Goal / Scope / Non-goals。如果下一步与 Goal 没有直接关系：

- 不得自动开始。
- 记录为候选后续任务。
- 只有用户明确扩大 Scope 后才能进入。

发现必须越界修改时，先停下并报告：为什么必须改、不改会怎样、影响面、替代方案。

## 24. 最终报告

任务完成：

```text
# GOAL FINAL

## Goal
目标。

## Pipeline
实际执行阶段。

## Completed
完成内容。

## Changed
修改文件。

## Tests
测试结果。

## Verification
验证结果。

## Blockers
如果存在。

## Needs Human
如果存在。

## ROADMAP
更新情况。

## Result
COMPLETE / BLOCKED / NEEDS_HUMAN
```

中途停止：

```text
# GOAL BLOCKED

## Completed
已完成阶段。

## Current Stage
当前阶段。

## Blocker
阻塞原因。

## Required Decision
需要人工决定的内容。

## Next Action
解除阻塞后的下一步。
```

`NEEDS_HUMAN` 时使用同构结构，并把 `Required Decision` 写清，不得代替用户做业务语义选择。

## 25. 最终检查清单

- [ ] Goal / Scope / Non-goals 未被静默扩大。
- [ ] `.agent/task-state.yaml` 与实际阶段状态一致。
- [ ] 所有实际代码修改都经过 `VERIFICATION`。
- [ ] 相关测试通过，失败集无新增，未解释失败为 0。
- [ ] `pnpm run check` 与 `node scripts/checkEolDrift.mjs --strict` 已按任务要求执行。
- [ ] 契约 / DB / execution / 不变量影响已报告。
- [ ] 没有危险数据库操作、历史 migration 修改或业务语义越权。
- [ ] ROADMAP / CHANGE-AUDIT 已按实际影响最小更新。
- [ ] 最终状态为 `COMPLETE`、`BLOCKED` 或 `NEEDS_HUMAN`，不存在 `UNKNOWN` 被当作完成。
