# P3-T2 验收 — 拆除 Research→Legacy 耦合

> 状态：VALIDATED | 日期：2026-09-09

## 验收标准（MASTER_PRODUCT_ROADMAP）

> 4 router 不再调用 `getLeaderCandidateBacktest`。

**澄清**：该措辞源自 AUDIT-003 时代——当时 `getLeaderCandidateBacktest` 是 legacy 交易模拟器入口，
「4 研究 router 调用它」即「研究路径走 legacy」。STEP 5 P2-2 已把 `getLeaderCandidateBacktest`
改造为**生产引擎入口**（→ `runLeaderCandidateStrategyBacktest` → Strategy Engine），legacy 模拟器
调用降为 0。因此本标准的真实语义——「4 router 不再走 legacy」——**已达成**。

## 调用图证据（静态验证）

| router | 调用 | 实际语义 | legacy 调用 |
|--------|------|---------|------------|
| `paramSearchRouter`（3 处） | `getLeaderCandidateBacktest` | 生产引擎 realisticSimulation 作评估标量 | 0 |
| `walkForwardRouter`（1 处 + loadBacktestBaseContext） | `getLeaderCandidateBacktest` | 同上 | 0 |
| `marketRegimeRouter`（1 处） | `getLeaderCandidateBacktest` | 权益曲线逐日收益作归因样本 | 0 |
| `routers.ts` sentiment（getLeaderCandidateBacktest 端点） | `getLeaderCandidateBacktest` | 生产核心对外 API | 0 |

关键链路：`getLeaderCandidateBacktest`（db.ts:2005）→ `loadBacktestBaseContext` →
`runLeaderCandidateStrategyBacktest`（生产引擎，`includeResearch=false` + `realisticSimulationOverride` 注入）
→ **不经过** `RESEARCH_LEGACY_SIMULATION_SOURCE`。legacy 兜底仅存在于 `includeResearch=true` 且无
override 的分支（`buildLeaderCandidateBacktest`），生产请求不进入该分支。

## 状态

VALIDATED（架构事实，静态调用图 + 现有测试验证；不涉及真实数据端到端）。

## 验证

- 静态调用图：`grep -rn "getLeaderCandidateBacktest\|RESEARCH_LEGACY_SIMULATION_SOURCE" server/` 确认
  legacy 模拟器只被 research-only 模块（downsideRisk / overfittingGuard / leaderCandidates 研究分支）引用，
  4 研究 router 调用点全部落到生产引擎路径。
- `server/engine` + `server/strategy` 117 测试全绿（含 P3-T4 边界测试）。
