# P1-T1 G0 gate 固化 — 验收记录

> 任务：G0 gate 固化（废除 `researchReady = dataScope.every(PASS)` 语义）
> 状态：VALIDATED | 日期：2026-09-09 | Gate：G0

## 1. 目标

把认证脚本的最终判定从「数据域 PASS → researchReady=true」修正为「数据域 PASS → 仅 dataFoundationReady(G0)=true」，`researchReady` 改为只指 G4（真实研究 E2E）。

## 2. 改动内容

### 2.1 核心脚本（scripts/step12_certify_gate.mjs）

最终判定段从单一 `researchReady = dataChecks.every(PASS)` 改为分层 Gate：

```js
const dataFoundationReady = dataChecks.every((c) => c.status === "PASS"); // G0
const researchReady = g4.status === "PASS";   // 只指 G4
const productionReady = g5.status === "PASS"; // 只指 G5
```

新增 G1~G5 真实探测（查库，不 hardcode 结果）：
- G1：industry `securityId` NULL 数 + `effectiveFrom` 是否单点
- G2：`research_datasets` 表存在性 + 行数
- G3：backtest_runs 运行产物（退出策略能力由 P3-T1 完成）
- G4：`research_runs` 行数
- G5：4 张持久化表存在性

### 2.2 消费方同步

- `shared/dataHealthContracts.ts`：新增 `gateLevelSchema`/`GATE_LEVEL_STATUSES`，扩展 `researchReadyGateFileSchema` 与 `dataHealthOverviewSchema` 透传 `gates`/`dataFoundationReady`/`productionReady`。
- `server/dataHealth.ts`：`buildDataHealthOverview` 透传新字段。
- `server/researchRunRouter.ts`：修正 reason 文案（区分「G0 未 PASS」与「G1~G3 未建设」）。
- `client/src/pages/DataHealth.tsx`：RESEARCH_READY=FALSE 硬提示改为分层语义展示（含 G0~G5 状态徽章）。

### 2.3 Gate Change Proposal

`docs/RESEARCH_GATE_SPECIFICATION.md` §7 新增 GCP-001（废除语义膨胀）+ GCP-002（单脚本改造决策）。

## 3. 真实数据运行结果

```
dataFoundationReady: true    (G0 = 15 项 dataScope 全 PASS)
researchReady: false          (G4 = research_runs=0 → GAP)
productionReady: false        (G5 = 持久化表缺失 → GAP)
gates: G0=PASS, G1=GAP, G2=GAP, G3=GAP, G4=GAP, G5=GAP
```

G1~G5 的 GAP reason（真实查库）：
- G1：industry securityId 5212/5212 行 NULL
- G2：research_datasets 表不存在
- G3：baseline 仅 BUY 无 SELL
- G4：research_runs = 0
- G5：strategy_versions/paper_trades/trade_journal_entries/experiment_artifacts 表缺失

## 4. 验收逐项判定

| # | 验收标准 | 结果 |
|---|---------|------|
| 1 | G0 独立判定 JSON | PASS |
| 2 | researchReady ≠ dataScope PASS | PASS |
| 3 | 分层 gates + 诚实 GAP reason | PASS |
| 4 | 可复现（同输入同输出） | PASS |
| 5 | 相关测试通过 | PASS（dataHealth 13 + researchContracts 12） |
| 6 | tsc 无错误 | PASS |

## 5. 附带修复（预先存在 bug）

1. `DOMAIN_SPEC.C` coverageSources `targetKey` 从 `distinctSecurityIds` 改为 `minDistinctEventSecurities`（check#6 threshold 实际键名）。
2. `DOMAIN_SPEC.D` 覆盖率主口径收敛为 AF（CA 事件态表覆盖目标是「AF−容差」动态值，无法用静态 threshold 表达）。

## 6. 结论

P1-T1 达到 VALIDATED：真实 TiDB 运行 + 分层判定正确 + 两次运行一致 + 相关测试全绿 + 类型安全。`RESEARCH_READY` 语义已从「数据地基」正确降级为「G4 研究就绪」，后续按 PHASE 1~3 依次建设 G1/G2/G3。
