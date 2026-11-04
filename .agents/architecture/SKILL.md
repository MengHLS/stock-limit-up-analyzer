---
name: architecture-agent
description: 分析本仓库模块边界、调用关系、依赖方向与 legacy 路径，并输出最小重构方案。默认只分析，不修改代码。
---

# Architecture Agent Skill

> 项目：`stock-limit-up-analyzer`。执行本 Skill 前先读仓库根 `AGENTS.md`。
> **默认行为：只分析，不修改代码。** 需要落地重构时，交棒给 `.agents/refactoring/SKILL.md`。

## 1. 职责链

```text
代码
 ↓
模块
 ↓
调用关系
 ↓
依赖关系
 ↓
Legacy
 ↓
问题
 ↓
最小重构边界
```

## 2. 执行步骤

1. **读目标模块**：通读入口文件与 barrel（`index.ts`），确认对外导出面。
2. **查调用方**（consumers）：`rg -n "<符号名>" server client tests shared`；区分「生产可达」与「仅测试可达」。
3. **查被调用方**（dependencies）：读目标模块的 import，区分运行时 import 与 `import type`。
4. **查类型依赖**：`shared/**` 契约、领域类型、tRPC 输入/输出 schema。
5. **查数据库依赖**：涉及的表、仓储、写入口（对照 `docs/architecture/DATABASE-MAP.md`）。
6. **查测试**：`tests/**` 镜像结构；确认是契约测试、边界守卫测试还是纯单测。
7. **查 legacy 路径**：对照 `docs/architecture/LEGACY-MAP.md`；确认哪些是「在产 legacy」、哪些是「仅测试 / 死代码」。
8. **分析重复实现**：同一口径是否有多处实现（例如第二套 metrics / 第二套 Dataset 坐标 / 第二套 canonical）。
9. **判断架构边界**：依赖方向是否单向向下；是否存在跨域反向依赖或 barrel 隐性加载。
10. **输出重构方案**：给出**最小** Scope 与验证方式，不做无关改动。

## 3. 项目权威入口（先看这些，不要按目录名猜）

| 领域 | 权威位置 |
|---|---|
| 策略语义 | `server/strategyCore/**`（唯一语义权威） |
| 执行 / 成本 / 持仓 | `server/backtest/**`（事实上的 Backtest Core） |
| 指标 | `server/backtest/backtestResult.ts#canonicalMetrics`（唯一指标出口） |
| Dataset | `server/datasetRegistry/**`（`dataset_version.id` 为坐标） |
| 闭环执行链 | `server/research/closedLoop/**` + `server/research/closedLoopWiring/**` |
| 独立研究实验 | `research-experiments/**` + `server/researchExperiments/**` |
| 策略存储编码 | `server/research/strategySchema/**` |
| 策略持久化 | `server/research/strategyPersistence/**` |
| 组合根 / 装配 | `server/routers.ts`、`server/researchRunRouter.ts` |
| 架构事实 | `docs/architecture/SYSTEM-BASELINE.md`、`ARCHITECTURE.md`、`MODULE-MAP.md`、`DEPENDENCY-MAP.md` |

## 4. 硬约束

- **禁止凭目录名判断模块状态**：必须由**实际调用关系**判定（`CORE` / `ACTIVE` / `LEGACY` / `TRANSITION` / `UNKNOWN`）。
- **禁止自己重新定义项目架构**：架构以 `SYSTEM-BASELINE.md` + 实际代码为准。
- **禁止为了让文档显得正确而修改代码**；发现冲突标 `BASELINE_DRIFT`。
- 定位一律用「**路径 + 符号名**」，行号只作辅助。
- 领域依赖**只允许单向向下**；发现反向依赖或跨域写入口时**必须报告**，不要顺手重构。
- 分析阶段**不改代码、不改数据库、不新增 migration**。

## 5. 输出模板

```text
Current Architecture      当前模块的真实结构（入口 / 分层 / 对外导出）
Dependency Map            依赖（被谁调用 / 调用谁；运行时 vs 仅类型）
Legacy Paths              命中的 legacy 路径 + 可达性证据
Problems                  问题（重复实现 / 反向依赖 / 隐性加载 / 边界模糊）
Proposed Refactor         建议的重构方向（最小 Scope）
Scope                     明确列出「允许改」与「不许改」的文件/模块
Risk                      行为风险、契约风险、DB 风险、并发风险
Test Plan                 需要跑/需要加的测试（含 Before/After 判据）
```

## 6. 交棒条件

只有在 **Scope 已明确 / 不变量已登记 / Test Plan 已写出** 三项齐备时，才允许交棒给 Refactoring Agent。
否则输出「Blocked + 缺什么」。