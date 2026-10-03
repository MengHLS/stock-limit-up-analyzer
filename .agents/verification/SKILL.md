---
name: verification-agent
description: 用 Before vs After 对比判断重构是否保持原有行为；发现变化必须分类为 Expected / Unexpected / Unknown，禁止把 Unexpected 判为正常。
---

# Verification Agent Skill

> 目标：**判断重构是否保持原有行为。** 这是重构任务的唯一验收闸门。
> 先读仓库根 `AGENTS.md` §2（不变量）——验证项就是不变量的逐条核对。

## 1. 核心方法

```text
Before
  vs
After
```

- **Prior**：在改动前的 commit / stash / 副本上采集「行为指纹」。
- **Post**：在改动后采集**同样输入下的同样指纹**。
- **同输入**：能复现的实验/回测，必须用**完全相同的输入**（同一 `datasetVersionId`、同一 `decisionOffsetDays`、同一 `parameterSet`、同一 seed）跑两边。

## 2. 至少检查项

| # | 检查项 | 判据 |
|---|---|---|
| 1 | **API 行为** | tRPC 端点的输入/输出 schema、错误码、必填字段不变 |
| 2 | **核心函数结果** | 关键纯函数（决策 / 指纹 / 指标）输出逐字段相等 |
| 3 | **Dataset 坐标** | `datasetVersionId` 语义不变；label 与坐标的关系不变（label 仍仅展示） |
| 4 | **PIT** | `rd≤0` / `rd≥1` 结构分界不变；未声明 `usesForwardData` 时 `rd≥1` 仍被拒绝 |
| 5 | **StrategyVersion** | 版本不可变；指纹（行为级 + 文档级）不变；`FIXED/TUNABLE/DERIVED` 解析语义不变 |
| 6 | **Backtest metrics** | `canonicalMetrics()` 输出不变；`equityDigest` / `tradeDigest` **逐字节**比对 |
| 7 | **Paper Trading state** | 账户状态字段 / 推进语义不变 |
| 8 | **相关测试** | 失败集**不新增**（允许继承改动前的已有失败） |

## 3. 可重复实验 / 回测

优先使用**相同输入执行 Before/After 对比**：

- 回测：同一 `datasetVersionId` + 同一策略版本 + 同一参数集 ⇒ 比对 `canonicalMetrics` 全字段 + `equityDigest` + `tradeDigest`。
- 独立实验：同一 `ExperimentDefinition` + 同一 Dataset 版本 ⇒ 比对 `result.json` / 样本账（`eligible + excluded === candidate`）。
- 决策：同一 context + 同一 `StrategyVersion` ⇒ 比对 `StrategyDecision` 全字段。

对比产出的**差异必须落盘**（不要只看终端），便于复核。

## 4. 变化分类（强制）

发现结果变化时**必须**分类，逐条列出：

```text
Expected    预期内变化（重构目标本身就是要改的，且已获授权）
Unexpected  预期外变化（不该变的变了 ⇒ 视为回归）
Unknown     无法判定（缺输入 / 缺基线 / 不可复现 ⇒ 如实登记，不得猜）
```

🔴 **禁止自行把 `Unexpected` 变化判定为「正常」。** 只能：回退该改动 / 报告并等待裁定。
🔴 `Unknown` 也**不能**当作通过；必须写明「为什么无法判定」与「需要什么才能判定」。

## 5. 工具

```bash
git stash / git worktree add <path> HEAD     # 取 Before 副本（不要污染工作区）
pnpm exec vitest run <路径>                   # 目标测试
pnpm run test:changed                         # 增量
pnpm run check                                # tsc --noEmit
node scripts/checkEolDrift.mjs --strict       # 行尾哨兵（必须 0）
```

- 需要比对的产物写到仓外 `_scratch\`，不要留在仓库。
- 定位差异时用「路径 + 符号名」，行号只作辅助。

## 6. 输出模板

```text
Verification Target       被验证的改动 / Scope
Baseline Reference        Before 的 commit / stash / 工作区快照
Inputs                    两侧完全相同的输入（列出坐标）
Checks                    逐条检查项 + 结果（PASS / FAIL）
Diffs                     Expected / Unexpected / Unknown 三分类
Verdict                   PASS（行为一致） / FAIL（存在 Unexpected） / INCONCLUSIVE（存在 Unknown）
Evidence                  证据文件路径 / 命令
Next Step                 交回 Refactoring Agent / 报告用户
```