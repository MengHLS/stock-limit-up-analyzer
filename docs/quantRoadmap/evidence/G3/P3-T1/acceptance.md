# P3-T1 验收 — 生产引擎退出策略接入（baseline BUY → BUY+SELL）

> 状态：CODE_READY | 日期：2026-09-09

## 验收标准（MASTER_TASK_TRACKING）

| 项 | 验收要求 | 结果 | 证据 |
|----|---------|------|------|
| 1 | baseline 可产 SELL 信号 | ✅ PASS | `leaderCandidateBaselineStrategy.evaluate` 产出 `action:"SELL"`（hold-while-selected） |
| 2 | 退出策略可配置 | ✅ PASS | `exitMode: "hold-while-selected" \| "none"`，默认 hold-while-selected |
| 3 | 生产引擎 BUY→SELL 完整生命周期 | ✅ PASS | 端到端测试跑出 closed trade（entryTime=D2, exitTime=D3, openAtEnd=false） |
| 4 | 确定性 / PIT 安全 / 无候选日不强制清仓 | ✅ PASS | 单测锁定「无候选日 → 持仓不变」「退出判断不受 maxSignals 截断」 |

## 关键实现

### 1. 退出信号（策略层）

`server/strategy/strategies/leaderCandidateBaseline.ts`：
- 新增 `LeaderCandidateExitMode = "hold-while-selected" | "none"` 类型。
- `LeaderCandidateBaselineConfig` 增 `exitMode` 字段（默认 `"hold-while-selected"`）。
- 新增 `buildHoldWhileSelectedExitSignals(openPositionSymbols, filteredCandidates, signalTime)`：
  - desired = 经过 minScore / featureMode 过滤后的候选池（**不受 maxSignals 截断**）；
  - 持仓中不在 desired 的证券 → SELL（symbol 升序确定性排序）；
  - 无持仓返回空。
- `evaluate` 改造：解构 `context.portfolio`，`signals = [...sellSignals, ...buySignals]`（sell 在前 buy 在后，对齐 planDecisionDay）。
- **无候选日**（`candidates.length === 0`）→ `emptyDecision`（不强制清仓），与 research simulator `planDecisionDay` 语义一致。

### 2. 生产配置

`server/leaderCandidateStrategyBacktest.ts`：
- 新增 `LEADER_CANDIDATE_PRODUCTION_EXIT_MODE = "hold-while-selected"`。
- `buildProductionLeaderCandidateStrategyConfig` 返回 `exitMode` 显式声明。

### 3. 研究参数 schema

`server/research/adapter.ts`：
- `buildLeaderCandidateBaselineResearchDefinition` 参数 schema 增 `exitMode`（defaultValue `"hold-while-selected"`，allowedValues 两值）。

## 退出策略语义（与 legacy 的区别）

| 维度 | legacy 模拟器（research-only） | 新引擎 baseline（生产） |
|------|------------------------------|------------------------|
| 退出规则 | 开盘止损 / 动态止盈回撤 / 强势续持 / 最多持有 N 日 | hold-while-selected（持仓不再入选候选池即卖出） |
| 资金循环 | 是（平仓释放现金） | 是（SELL 释放现金，引擎 sell 在前 buy 在后） |
| 无退出信号 | — | 持有到期末按市价估值（openAtEnd） |

二者**仍然不等价**（退出规则不同），`engineNonEquivalence.test.ts` 继续锁定非等价契约。

## 验证

- `tsc --noEmit` exit 0（无类型错误）。
- `server/strategy/` + `server/engine/` = 99 测试全绿（含新增 7 个退出策略单测 + 3 个端到端用例）。
- `server/research/` = 44 文件 1104 测试全绿（`experimentPersistence.test.ts` 参数集断言同步 `exitMode` 默认值）。
- 端到端（synthetic fixture）：A 在 E1 涨停买入（E2 开盘），E2 断板 → SELL（E3 开盘卖出），产出 `openAtEnd=false` 的 closed trade，`completedTradeCount ≥ 1`。

## 状态口径（诚实标注）

- 本次为 **CODE_READY**：代码 + 单测 + synthetic 端到端跑通「BUY → SELL 生命周期」。
- **非 VALIDATED**：未用真实 DB 数据跑通（真实数据验证由 P5-T1 Baseline Backtest 承担）。
- 已知限制：`portfolio.sell` 清仓时 `trade.reason` 硬编码 `null`，退出原因未传递到 Trade（留待 P3-T4 边界验证时审视）。
