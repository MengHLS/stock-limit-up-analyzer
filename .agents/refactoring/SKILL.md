---
name: refactoring-agent
description: 在 Architecture Agent 已确定的 Scope 内执行小步重构，先建立测试基线，再改代码，最后验证行为一致。
---

# Refactoring Agent Skill

> 前置：必须已有 Architecture Agent 输出的 **Scope + Risk + Test Plan**。
> 先读仓库根 `AGENTS.md` §2（不变量）与 §3（修改原则）。

## 1. 执行流程

```text
Read
 ↓
Baseline
 ↓
Impact Analysis
 ↓
Refactor
 ↓
Test
 ↓
Fix
 ↓
Verification
 ↓
Report
```

## 2. Read

- 读目标模块 + 直接上游/下游 + 相关 `shared/**` 契约。
- 确认**工作区状态**：`git status --porcelain`（本仓库常有未提交改动 / 并发会话）。
- 确认你改的是**哪一份代码**（工作区 ≠ HEAD 时先声明）。

## 3. Baseline（改动前必须做）

**先跑相关测试，并记录基线**：

```text
测试数量      =
通过数量      =
失败数量      =
已存在失败    =  逐条列出（文件 + 用例名 + 原因）
```

命令：

```bash
pnpm exec vitest run <相关路径>      # 目标模块测试
pnpm run test:changed                # 增量（git 改动 → 反向依赖图）
pnpm run check                       # tsc --noEmit（必须 0 错）
```

> ⚠️ 全量 `pnpm test` 只在验收/合并前跑。全量含离线**恒红**文件（环境依赖 + 已知失效用例），
> 判据是「**零新增失败文件**」，不是「全绿」。
> ⚠️ 记录**改动前**的失败集；不要把自己引入的失败混进「已有失败」。

## 4. Refactor

**只允许修改 Architecture Agent 确定的 Scope。**

优先选择：

- 提取重复逻辑
- 降低耦合
- 明确接口（显式入参 / 显式返回，不用隐式全局）
- 消除 legacy 依赖
- 提升类型安全
- 拆分过大模块
- 删除**已确认**无用代码

禁止：

- ❌ 顺手改无关模块 / 顺手格式化（**禁 `prettier --write`**）
- ❌ 一次删除大量 legacy
- ❌ 为通过测试而修改测试
- ❌ 绕开 `shared/**` 契约另立口径
- ❌ 修改数据库 schema / migration（需要时走 `.agents/database/SKILL.md`）

## 5. Scope 越界处理

如果发现**必须**修改 Scope 外代码：

1. **先停下**，不要直接改；
2. 报告：为什么必须在 Scope 外改 / 不改会怎样 / 影响面；
3. 得到确认后再继续。

同样适用于：发现不变量会被破坏、发现测试本身是错的、发现需要 DB 变更。

## 6. Test

至少运行：

- **单元测试**（目标函数/模块）
- **目标模块测试**（`tests/**` 镜像目录）
- **必要的集成测试**（跨域边界 / tRPC 端到端，如适用）

新增/改变行为时**必须新增测试**；边界守卫测试（`*Boundary.test.ts` / `importBoundary.test.ts`）**只允许加强，不允许放松**。

## 7. Fix

- 失败**先判断是代码错还是测试错**；认为测试错必须先说明理由。
- 修一次、跑一次，不要「全改完再跑」。
- 每处字符串替换必须 `assert count == 1`（防止误伤同名字符串）。

## 8. Verification

交棒给 `.agents/verification/SKILL.md` 做 **Before vs After** 行为一致性验证。
重构任务的完成判据是「**行为不变 + 测试不退化**」，不是「测试通过」。

## 9. Report

```text
Task
Baseline Version
Scope（实际改了哪些文件）
Baseline 测试结果（改动前）
Changes
Test 结果（改动后：文件数/用例数/失败集差异）
Verification（Expected / Unexpected / Unknown）
Remaining Risks
Next Step
```