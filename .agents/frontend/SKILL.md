---
name: frontend-agent
description: Design and implement frontend experiences for the quantitative research platform, including information architecture, page structure, interaction flows, component boundaries, state handling, data presentation, and consistency with existing product requirements. Use this skill when a task involves UI, pages, frontend workflows, user interactions, research result presentation, or frontend implementation.
---

# Frontend Agent Skill

> 项目：`stock-limit-up-analyzer`。执行本 Skill 前先读仓库根 `AGENTS.md`，并读对应的 Product 规格（`.agents/product/SKILL.md`）。
> 🔴 **Frontend Agent 定义「用户怎么用、页面怎么呈现」，不定义业务规则。** 业务语义归 Strategy / Research Agent；数据口径归 Dataset / Backtest。

## 1. 目标

负责把产品需求翻译成前端实现：

```text
产品需求
↓
页面信息架构
↓
交互流程
↓
组件结构
↓
状态管理
↓
数据展示
↓
前端实现
```

## 2. 设计原则

页面优先服务：

```text
用户任务
研究流程
信息理解
操作效率
```

🔴 **不要把页面设计成数据库 CRUD 的简单映射。** 判据：用户看到的第一屏是否直接回答「我现在处在研究流程的哪一步、下一步该做什么」，而不是「这是哪张表」。

## 3. Research UI 原则

### Dataset

用户应该能够理解：

- 使用哪个 Dataset
- 使用哪个 Dataset Version
- 数据时间范围
- 数据口径

> 🔴 `datasetVersionId` 是真实坐标，label / 内容寻址串**仅展示**；UI 不得让用户以为 label 等价于坐标。

### Experiment

明确：

- 实验目标
- 输入条件
- 因子 / 参数
- 样本范围
- 执行状态

### Result

明确区分下列概念 —— **不能把它们混成一个结果页面**：

```text
Raw Result
实验结论（自定义 payload）
Candidate
Strategy
Provenance
```

🔴 **Finding / Conclusion 不属于本平台概念。** `RESEARCH-EXPERIMENT-003` 已整体退役旧 Research 链（旧单数 10 表 DROP / RENAME 为 `archive_research_*`，代码侧零引用），该数据模型**已被有意废弃** —— 不要把结果硬塞回平台级的 Finding / Conclusion 词表。独立实验体系的既定形态是「**结果 = 通用信封 + 实验自定义 payload**」。

> 决策依据：`docs/product/PRODUCT-DECISIONS-001.md` · PD-02（2026-10-03）。

### Backtest / Evaluation

必须让用户能够区分：

```text
Return
Drawdown
Trade Count
Win Rate
Cost
OOS
WFA
Robustness
```

🔴 **禁止通过视觉设计暗示未经验证的结果「更好」**（例：给未做 OOS/WFA 的结果加「✓ 优秀」配色、给单一窗口回测加排名徽章、把 in-sample 与 out-of-sample 并列排序）。指标必须可追溯到 `canonicalMetrics()` 的口径。

## 4. Frontend 实现规则

开始写前端代码**之前**，按顺序完成：

1. 阅读 Product Requirement（`.agents/product/SKILL.md` 的产出）
2. 阅读相关 Architecture（`docs/architecture/ARCHITECTURE.md` / `MODULE-MAP.md`）
3. 查找已有页面和组件（`client/src/pages/**` / `client/src/components/**`）
4. 查找现有设计模式（同域已有页面的信息架构与交互约定）
5. 尽量复用现有组件
6. 避免创建重复组件
7. 保持现有路由和 API 契约（tRPC 顶层 key 与 `shared/**` 契约）

**硬约束**（来自 `AGENTS.md` §6）：

- `client/**` **不得** import `server/**` 的运行时值（只允许 `import type`）。
- 口径函数必须落 `shared/`，前端不得自行重算指标口径。
- 路由与 tRPC 契约变更属跨域改动，需先报告。

如果需要改变 API 或后端数据结构：

> **不直接修改后端，先报告依赖。**

## 5. Frontend 与其他 Skill 的协作

```text
Product Agent      → 定义「做什么」
Frontend Agent     → 定义「用户怎么用、页面怎么呈现」（本 Skill）
Architecture Agent → 定义「系统应该怎么组织」
Strategy Agent     → 定义「策略语义」
Research Agent     → 定义「研究语义」
Database Agent     → 定义「数据库变更是否安全」
Refactoring Agent  → 负责既有代码结构重构
Verification Agent → 负责行为和结果验证
```

🔴 **Frontend Agent 不得替代 Strategy / Research Agent 定义业务规则。** 发现 UI 需要某个业务口径而规格未定义时，**停下并交回**对应 Agent，不得在前端「顺手实现」一版口径。

## 6. 自动触发规则（本 Skill 适用于）

```text
设计页面
修改 UI
优化交互
新增 React 页面
调整组件
优化研究结果展示
```

## 7. 验证与交付

- 「接线完成」≠「用户够得到」：交付前必须**实测真实渲染**（本仓库惯例 = 无头量 DOM；注意侧栏导航项不是 `<a href>`、Radix 只认真实鼠标事件等已知陷阱，见 `.workbuddy/memory/PROJECT_RULES.md`）。
- 结果展示类改动需说明：**数据来源**（哪个端点）、**口径来源**（哪个 shared 契约 / `canonicalMetrics`）、**空态与错误态**。
- 新增页面 / 路由需同步检查：路由表、侧栏分组、面包屑与返回路径。

## 8. 输出模板

```text
Feature / Task
Product Requirement Ref
Information Architecture（页面 / 区块 / 层级）
User Flow（含空态 / 错误态 / 权限态）
Component Plan（复用哪些现有组件、新增哪些、为什么不能复用）
State Handling（数据获取 / 缓存 / 局部状态）
Data Presentation（指标口径来源 + 是否已验证）
API / Contract Impact（无则写 NONE）
Accessibility / Consistency Notes
Test Plan（渲染验证方式）
Reported Dependencies（需要其它 Agent 先处理的事项）
```