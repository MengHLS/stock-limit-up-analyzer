# P3-T3 验收 — 移除/降级 legacyTransactionSimulator 桥接

> 状态：VALIDATED | 日期：2026-09-09

## 验收标准（MASTER_PRODUCT_ROADMAP）

> 移除/降级 `legacyTransactionSimulator` 桥接。

**结论**：legacy 模拟器已**降级**为「research-only 显式出口」（非移除——研究下行风险报表仍有意依赖它，
因为其「资金循环 + 逐笔退出」语义与生产引擎 hold-while-selected 退出不同，见 `legacyTransactionSimulator.ts`
头部注释 + `engineNonEquivalence.test.ts` 可执行断言）。

## 降级后的边界（唯一出口 + 白名单）

`RESEARCH_LEGACY_SIMULATION_SOURCE`（`server/research/legacyTransactionSimulator.ts`）是 legacy 交易模拟器
`simulateRealisticTPlus1ToTPlus2` 在全 codebase 的**唯一合法出口**，仅被 3 个 research-only 模块引用：

| 引用点 | 位置 | 用途 | 是否生产路径 |
|--------|------|------|-------------|
| `downsideRisk.ts`（5 处默认 `source`） | buildExperiments / buildExperimentsWithWindowWeights / buildFactorAblations 等 | 下行风险研究实验段模拟 | 否（research-only） |
| `overfittingGuard.ts`（2 处默认 `simulate`） | runCostSensitivity / runMonkeyBenchmark | 成本敏感性 / 打地鼠基准 | 否（research-only） |
| `leaderCandidates.ts:1038` | `buildLeaderCandidateBacktest` 的 `includeResearch=true` 且无 override 兜底 | 研究报表 realisticSimulation 兜底 | 否（仅研究分支） |

**生产路径铁律**（已固化）：`getLeaderCandidateBacktest`（db.ts:2005）→ `runLeaderCandidateStrategyBacktest`
传 `includeResearch=false` + `realisticSimulationOverride`（Strategy Engine 产出），**不进入** legacy 兜底分支，
legacy 模拟器调用 = 0。任何把研究默认来源替换为引擎 Adapter 的「伪等价」会被 `engineNonEquivalence.test.ts` 拦截。

## 状态

VALIDATED（降级已完成：唯一出口 + 白名单边界注释 + 生产路径调用=0 + 等价性断言锁定；
遗留的「默认参数改显式必传」不作为本任务范围——现有注入点设计已满足可追溯/可审计要求）。

## 验证

- `grep -rn "RESEARCH_LEGACY_SIMULATION_SOURCE" server/`：仅 4 文件（含定义），3 个 research-only 引用点，0 个生产 router。
- `server/research/engineNonEquivalence.test.ts` 可执行断言锁定「legacy ≠ 生产引擎」。
- `server/engine` + `server/strategy` 117 测试全绿。
