# `docs/quantRoadmap/` —— G0–G5 研究认证程序（第一轮，2026-09-09）

> **这是什么**：`docs/RESEARCH_GATE_SPECIFICATION.md` 定义的 G0–G5 分层 Gate 程序的**第一轮落地记录**。
> 11 个任务（P1-T1…P3-T4）每个一条：**任务号 / Gate / 状态 / 日期 / 结论 / 证据路径**。
> 本文件是**索引**，不替代各任务目录下的 `acceptance.md` 与 `evidence.json`
> —— 后两者是本目录的**强制布局**（见 `docs/RESEARCH_GATE_SPECIFICATION.md` §证据目录约定）。
>
> **结论口径**：`VALIDATED` = 真实数据 + 可复现 + 逐项验收通过；`CODE_READY` = 代码/单测就绪但未接真实数据
> （铁律：`CODE_READY ≠ VALIDATED`）；`PARTIAL` = 子交付物部分 BLOCKED。

---

## 1. 任务索引（11 项）

| # | 任务 | Gate | 状态 | 日期 | 一句话结论 | 证据 |
|---|---|---|---|---|---|---|
| 1 | **P1-T1** G0 gate 固化 | G0 | `VALIDATED` | 2026-09-09 | 废除 `researchReady = dataScope.every(PASS)` 语义，`researchReady` 只指 G4；新增 G1~G5 真实查库探测 | [acceptance](evidence/G0/P1-T1/acceptance.md) · [evidence.json](evidence/G0/P1-T1/evidence.json) |
| 2 | **P1-T2** Data Foundation 版本快照冻结 | G0 | `VALIDATED` | 2026-09-09 | G0 15 项全 PASS；`snapshots/data-foundation-v1.json` 的 `fingerprint` 连续 3 次一致（剔除 `capturedAt`） | [acceptance](evidence/G0/P1-T2/acceptance.md) · [evidence.json](evidence/G0/P1-T2/evidence.json) |
| 3 | **P1-T3** Industry securityId 关联回填 | G1 | `VALIDATED` | 2026-09-09 | `industry_assignments.securityId` **5212/5212** 全回填（NULL 5212→0）；歧义 0 / 孤儿 0 / 重跑 `affectedRows=0` | [acceptance](evidence/G1/P1-T3/acceptance.md) · [evidence.json](evidence/G1/P1-T3/evidence.json) |
| 4 | **P1-T4** Industry 历史 PIT 重建 + 覆盖报告 | G1 | `PARTIAL` | 2026-09-09 | 覆盖报告 `VALIDATED`；**历史 PIT 重建 `BLOCKED`**（无免费稳定历史源，`effectiveFrom` 仍单点 `2026-08-31`）⇒ 不伪造历史归属 | [acceptance](evidence/G1/P1-T4/acceptance.md) · [evidence.json](evidence/G1/P1-T4/evidence.json) |
| 5 | **P2-T1** `research_datasets` 表持久化 | G2 | `VALIDATED` | 2026-09-09 | 18 列落库 + 幂等；真实构建 `rowCount = 20391`。**附带修复**：缺 TRADING 维度致 `universe=0`（新增 `backfillTradingStatus.mjs` 补 5552 条） | [acceptance](evidence/G2/P2-T1/acceptance.md) · [evidence.json](evidence/G2/P2-T1/evidence.json) |
| 6 | **P2-T2** 同输入两次构建一致性 | G2 | `VALIDATED` | 2026-09-09 | 两次串行构建 `datasetVersion` / `rowsFingerprint` / `policySetFingerprint` / `rowCount` / `memberDayCount` / `gate` **全等**（纯函数 + 键字典序序列化） | [acceptance](evidence/G2/P2-T2/acceptance.md) · [evidence.json](evidence/G2/P2-T2/evidence.json) |
| 7 | **P2-T3** 9 项 policy 冻结 | G2 | `VALIDATED` | 2026-09-09 | 9 类 policy 顺序与 `RESEARCH_DATASET_POLICY_ORDER` 完全一致；`policySetFingerprint = 8ee5e42b4d96094e` 两次构建一致 | [acceptance](evidence/G2/P2-T3/acceptance.md) · [evidence.json](evidence/G2/P2-T3/evidence.json) |
| 8 | **P3-T1** 生产引擎退出策略接入（BUY → BUY+SELL） | G3 | `CODE_READY` | 2026-09-09 | `exitMode: "hold-while-selected" \| "none"`，默认前者；synthetic 端到端跑出 closed trade。**未接真实数据** | [acceptance](evidence/G3/P3-T1/acceptance.md) · [evidence.json](evidence/G3/P3-T1/evidence.json) |
| 9 | **P3-T2** 拆除 Research → Legacy 耦合 | G3 | `VALIDATED` | 2026-09-09 | 4 个研究 router 全部走生产引擎，legacy 模拟器调用 **= 0**（静态调用图 + 现有测试） | [acceptance](evidence/G3/P3-T2/acceptance.md) · [evidence.json](evidence/G3/P3-T2/evidence.json) |
| 10 | **P3-T3** 移除/降级 `legacyTransactionSimulator` 桥接 | G3 | `VALIDATED` | 2026-09-09 | **降级**（非移除）为 research-only 唯一出口：仅 3 个 research-only 模块引用，生产 router **0**；`engineNonEquivalence.test.ts` 锁定「legacy ≠ 生产引擎」 | [acceptance](evidence/G3/P3-T3/acceptance.md) · [evidence.json](evidence/G3/P3-T3/evidence.json) |
| 11 | **P3-T4** 回测边界条件全验证 | G3 | `CODE_READY` | 2026-09-09 | 18 用例逐项断言（T+1 / 涨跌停 / 停牌 / 滑点 / 费用 / 资金 / 退出覆盖）；**4 项显式 `KNOWN_GAP`**：K1 止损止盈、K2 复权、K3 一字板封死、K4 板块 limitRules 未注入 | [acceptance](evidence/G3/P3-T4/acceptance.md) · [evidence.json](evidence/G3/P3-T4/evidence.json) |

**汇总**：`VALIDATED` 8 项 · `PARTIAL` 1 项（P1-T4）· `CODE_READY` 2 项（P3-T1 / P3-T4）；
Gate 维度：G0 2/2 PASS、G1 1/2（历史 PIT BLOCKED）、G2 3/3、G3 2/4 CODE_READY。
🔴 **这些状态是 2026-09-09 的快照**：G1/G2/G3 的后续进展见 `ROADMAP.md` §44 与 `docs/architecture/SYSTEM-BASELINE.md`（勿以本页为当前状态）。

## 2. 冻结文档与报告

| 文档 | 说明 |
|---|---|
| [`reports/research-dataset-policies.md`](reports/research-dataset-policies.md) | **FROZEN v1.0**：9 类 dataset policy 的权威口径（value 派生规则 + 铁律 + 校验四层 + 版本）。权威源码 `server/researchDataset/policy.ts`，一致性校验 `policyValidate.ts`；修改语义必须走 Gate Change Proposal |
| [`reports/industry-historical-coverage.md`](reports/industry-historical-coverage.md) | Industry 历史覆盖报告（G1 维度）：当前快照 AVAILABLE / 历史 PIT CONDITIONAL / 允许与禁止边界 / 解锁路径 |

## 3. 数据快照

| 文件 | 说明 |
|---|---|
| `snapshots/data-foundation-v1.json` | Data Foundation 冻结快照（G0 15 项判定 + `fingerprint = 781854d0…b8edb8`）；被 P1-T2 作为 G2 追溯基线 |

## 4. 目录约定（改本目录前必读）

```
docs/quantRoadmap/
├── README.md                        ← 本文件（索引）
├── evidence/<Gate>/<TaskID>/
│   ├── evidence.json                机器可读：状态 / 输入输出 hash / capturedAt / realData / reproducible
│   ├── acceptance.md                验收逐项判定（人读）
│   └── raw/                         原始输出（按需）
├── reports/                         冻结口径与覆盖报告
└── snapshots/                       版本化数据快照
```

- Gate 定义与判定规则：`docs/RESEARCH_GATE_SPECIFICATION.md`（**ACTIVE**）。
- 本目录**不含**任何策略结论、最佳参数或收益承诺（只含工程认证事实）。
- ⚠️ 本目录的 `acceptance.md` **不得**被合并或删除 —— 它们是上述 §证据目录约定 的实例；
  需要一览时读本 `README.md`。
