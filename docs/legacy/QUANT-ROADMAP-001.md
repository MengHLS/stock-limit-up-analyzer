# QUANT-ROADMAP-001 — 量化系统执行路线图（已被取代）

> ⚠️ **已取代（superseded）**：本文件于 2026-09-09 13:43 被 Master Directive 的产品化体系取代。
> 新权威文件：
> - `docs/PRODUCT_GAP_MATRIX.md`（差距矩阵）
> - `docs/MASTER_PRODUCT_ROADMAP.md`（PHASE 0-13 主路线图）
> - `docs/MASTER_TASK_TRACKING.md`（6 态任务追踪）
> - `docs/RESEARCH_GATE_SPECIFICATION.md`（6 级 Gate）
> - `docs/FINAL_PRODUCT_ACCEPTANCE_CRITERIA.md`（Q1-Q20 验收）
> - `FINAL_PRODUCTIZATION_STATUS_REPORT.md`（状态报告）
>
> 本文件保留为历史证据（不得删除），但**不再作为任务执行依据**。

> 版本：v1.0 | 建立日期：2026-09-09 | 状态：SUPERSEDED
> 输入：`AUDIT-003_FULL_QUANT_SYSTEM_MASTER_AUDIT.md`
> 性质：**唯一**任务执行路线图（task + status + gate + dependency + execution order + evidence）。
> 取代：`ROADMAP.md` 中 §44-§47 的「任务跟踪」职责（ROADMAP.md 降级为规格/铁律参考，见 §10）。

---

## 0. 文档身份与唯一性声明

1. 本文件是 `stock-limit-up-analyzer` 项目**唯一**的任务执行路线图。
2. 所有任务的创建、状态变更、依赖调整、Gate 判定、Evidence 存档，**只**在本文件内登记。
3. 本文件采用 **append-only** 更新记录（§9），历史条目禁止删改。
4. 任务状态一律使用 §2 的 6 态模型，**禁止使用 `DONE`**。
5. `CODE_READY` 与 `VALIDATED` 严格分离（§2.3），二者之间必须经过 `REAL_DATA_SMOKE`。

---

## 1. 输入：AUDIT-003 关键结论（证据驱动）

以下结论全部来自 2026-09-09 独立直连 TiDB 实查 + 源码审计（非引用旧文档）。这是本路线图的问题源。

| # | 结论 | 证据 |
|---|------|------|
| A1 | `RESEARCH_READY=true` 是语义膨胀 | `scripts/step12_certify_gate.mjs` L369-370：`researchReady = dataChecks.every(PASS)`，15 项全 `dataScope:true` → 只认证「数据地基」，非「可做正式研究」 |
| A2 | 研究链零真实执行 | `research_experiments=0`、`research_runs=0`、`backtest_runs=1`（实查） |
| A3 | 研究/策略/纸面/日志无持久化 | `strategy_versions`/`paper_trades`/`trade_journal_entries`/`research_datasets`/`experiment_artifacts` 5 表 ER_NO_SUCH_TABLE（实查） |
| A4 | Industry 无历史 PIT | `industry_assignments` 5,212 行，`securityId` 全 NULL，`effectiveFrom` 单点 2026-08-31（实查） |
| A5 | 生产引擎无退出策略 | `server/strategy/strategies/leaderCandidateBaseline.ts` L87 只产 `action:"BUY"`（`toBuySignal`），无 SELL → 胜率/回撤/盈亏失真 |
| A6 | Research→Legacy 耦合 | `getLeaderCandidateBacktest` 被 `paramSearchRouter`/`walkForwardRouter`/`marketRegimeRouter`/`paperTrading`/`engine/adapter`/`engine/execution` + `research/legacyTransactionSimulator` 调用 |
| A7 | 测试以 synthetic fixture 为主 | research 44 测试文件、1,104 测试案例（grep 计数）；真实数据 E2E = **0** |
| A8 | 44 个 research 模块全 CODE_READY 未 VALIDATED | 29 子模块（signalEngine/costModel/parameterSearch/rollingOptimization/robustness/stochasticRobustness/walkForwardRun/oosIsolation/overfittingDetection/…）50,537 行代码，无真实数据跑出的实验 |

---

## 2. 任务状态模型（6 态，废除 DONE）

### 2.1 状态机

```
PLANNED
   ↓  开始实现
IMPLEMENTING
   ↓  代码完成 + 单元测试通过（含 synthetic fixture）
CODE_READY
   ↓  对真实 DB / 真实数据跑通最小闭环（smoke，无崩溃、输出可读）
REAL_DATA_SMOKE
   ↓  验收标准逐项通过 + 证据可复现（同输入 → 同输出）
VALIDATED
   ↓  通过所属 Phase Gate，证据冻结存档
CERTIFIED
```

### 2.2 各状态定义

| 状态 | 定义 | 进入条件 | 退出条件 |
|------|------|---------|---------|
| `PLANNED` | 已登记，需求/验收标准明确 | 任务登记入本文件 | 开始写代码/改数据 |
| `IMPLEMENTING` | 正在实现 | 明确 start | 代码完成 + 单测通过 |
| `CODE_READY` | 代码/脚本完成，单测通过 | 单测通过（可 synthetic fixture） | 对真实数据跑通 smoke |
| `REAL_DATA_SMOKE` | 真实数据最小闭环跑通 | 无崩溃、输出可读、有 smoke 日志 | 验收标准逐项通过 |
| `VALIDATED` | 真实数据 + 验收逐项通过 + 可复现 | 同输入同输出，证据落盘 | 通过 Phase Gate |
| `CERTIFIED` | 通过 Gate，证据冻结存档 | Gate 判定 PASS | （终态，进入下一阶段） |

### 2.3 铁律：CODE_READY ≠ VALIDATED

- `CODE_READY` 只证明「代码存在 + 单元测试通过」，单元测试可能用 synthetic fixture。
- `VALIDATED` 必须「真实数据 + 验收标准逐项通过 + 可复现证据」。
- **禁止**从 `CODE_READY` 直接跳 `VALIDATED`；必须经过 `REAL_DATA_SMOKE`。
- 已存在但无真实数据运行的模块，一律标记 `CODE_READY`，**不是** `VALIDATED`。

### 2.4 回退与阻塞

- 真实数据 smoke 失败 → 回退 `IMPLEMENTING`（保留失败日志为证据）。
- 依赖未满足 → 任务保持 `PLANNED`（由依赖关系决定，非独立状态）。
- 阻塞原因登记到本文件 §5 依赖表备注列，不单独造 `BLOCKED` 状态。

---

## 3. Phase Gate 模型（G0~G5）

把 AUDIT-003 的「分层 Gate」建议落地为 6 级 Gate。**跨阶段开发禁止**（§7）。

```
G0 DATA_FOUNDATION_READY      数据地基就绪（现有 dataScope 15 项独立判定）
        ↓
G1 HISTORICAL_STATE_READY     历史状态就绪（Industry PIT 等逐时点可重建）
        ↓
G2 RESEARCH_DATASET_READY     研究数据集就绪（datasetVersion 可复现 + policy 冻结）
        ↓
G3 RESEARCH_ENGINE_READY      研究引擎就绪（生产引擎完整生命周期 + 去 legacy 耦合）
        ↓
G4 RESEARCH_READY             正式研究就绪（真实 E2E + OOS 隔离 + overfitting）
        ↓
G5 PRODUCTION_READY           生产级就绪（持久化 + 前端真实标注 + SOP）
```

每个 Gate 的三要素：

| Gate | 入口条件（进入该阶段） | 退出条件（CERTIFIED 门槛） | 出口证据（存证目录） |
|------|----------------------|---------------------------|---------------------|
| G0 | 任务登记完成 | 本阶段全部任务 CERTIFIED | `docs/quantRoadmap/evidence/G0/` |
| G1 | G0 PASS | Industry 历史 PIT 重建 + 覆盖报告 | `docs/quantRoadmap/evidence/G1/` |
| G2 | G1 PASS | datasetVersion 同输入两次构建一致 + 9 项 policy 冻结 | `docs/quantRoadmap/evidence/G2/` |
| G3 | G2 PASS | 生产引擎 BUY+SELL 完整 + legacy 耦合拆除 + 边界条件全验证 | `docs/quantRoadmap/evidence/G3/` |
| G4 | G3 PASS | 真实数据全链路 E2E + OOS 冻结 + overfitting 指标 + regime 真实数据 | `docs/quantRoadmap/evidence/G4/` |
| G5 | G4 PASS | 持久化 3 表 + 前端标注 + 策略研究 SOP | `docs/quantRoadmap/evidence/G5/` |

> **Gate 语义铁律**：`RESEARCH_READY` 从现在起**只**指 G4 通过，不再等于「数据域 PASS」。数据域 PASS 只是 G0。

---

## 4. 问题 → 任务映射总表

来源标记：`P0-*`/`P1-*`/`P2-*`/`P3-*` = AUDIT-003 问题清单编号；`A*` = §1 证据编号；`NEW` = 用户本次新增要求。

| Task | 任务 | 源 | 所属 Gate | 依赖 (blockedBy) | 当前状态 | 验收证据（VALIDATED 需产出） |
|------|------|-----|-----------|------------------|---------|------------------------------|
| **T00.1** | 重构 certify gate 为分层 G0~G5，废除「RESEARCH_READY=dataScope 全 PASS」语义 | P0-1 / A1 | G0（meta） | — | PLANNED | 新 gate 脚本输出 6 级独立判定；`RESEARCH_READY` 仅映射 G4 |
| **T00.2** | 落地 6 态任务状态模型 + 唯一 roadmap 维护规则（本文件） | NEW | G0（meta） | — | PLANNED | 状态机文档 + 唯一性/append-only 规则生效 |
| **T00.3** | 建立真实数据 E2E smoke 基线 harness（最小闭环：signal→order→fill→PnL） | P0-4 / A7 | G0（meta） | — | PLANNED | harness 可对真实 DB 跑通，输出 smoke 日志 |
| **T01.1** | 将现有 dataScope 15 项判定固化为 G0 gate（独立于研究 gate） | P0-1 / A1 | G0 | T00.1 | PLANNED | G0 gate 输出 JSON，15 项逐项 PASS/PENDING/FAIL |
| **T01.2** | Data Foundation 版本号 + 快照存证（dataSnapshot 可复现） | P0-1 | G0 | T01.1 | PLANNED | 快照 JSON 冻结，重复运行一致 |
| **T02.1** | Industry 历史 PIT 重建（补全 `securityId` 关联 + 历史 `effectiveFrom/effectiveTo` 区间） | P0-2 / A4 | G1 | T01.2 | PLANNED | `industry_assignments` 补全 securityId 且 effectiveFrom 非单点，覆盖 2019~2026 |
| **T02.2** | Industry Historical Coverage 报告（可用区间 / PIT 成立性 / 哪些研究允许用 / 哪些禁止） | P0-2 / A4 | G1 | T02.1 | PLANNED | 报告落盘，明确「当前快照」vs「历史 PIT」边界 |
| **T02.3** | 冻结 Historical State 版本 | P0-2 | G1 | T02.2 | PLANNED | Historical State 快照 JSON 冻结 |
| **T03.1** | `research_datasets` 表持久化（datasetVersion/dataSnapshot/universe/policy） | P1-4 / A3 | G2 | T02.3 | PLANNED | 迁移脚本 + 表可写读 + 至少 1 个真实 dataset 落库 |
| **T03.2** | 同输入两次构建一致性验证（datasetVersion A = B，rows/universe/policy/snapshot 全一致） | AUDIT§5 | G2 | T03.1 | PLANNED | 两次构建 hash 一致，diff 为空 |
| **T03.3** | 冻结 9 项 policy（universe / PIT / survivorship / CA / adjustment / industry / liquidity / calendar / knowledge） | P1-4 | G2 | T03.2 | PLANNED | 9 项 policy 各一份冻结文档 + 版本号 |
| **T04.1** | 生产引擎退出策略接入（baseline 从只产 BUY → BUY+SELL 完整生命周期） | P0-3 / A5 | G3 | T03.3 | PLANNED | baseline 可产 SELL；胜率/回撤/盈亏按完整生命周期重算 |
| **T04.2** | 拆除 Research→Legacy 耦合（paramSearch/walkForward/marketRegime/paper 4 router 改走生产引擎） | P1-1 / A6 | G3 | T04.1 | PLANNED | 4 router 不再调用 `getLeaderCandidateBacktest`；调用图无 legacy 依赖 |
| **T04.3** | 移除/降级 `legacyTransactionSimulator` 桥接 | P1-2 / A6 | G3 | T04.2 | PLANNED | bridge 删除或显式降级为兼容层，研究链不经过它 |
| **T04.4** | 回测引擎边界条件全验证（T+1 / 涨停不可成交 / 跌停不可成交 / 停牌 / 滑点 / 手续费 / 印花税 / Lot Size / 资金冻结 / 现金 / 持仓 / 退出 / 最大持有天数 / 止损 / 止盈 / 公司行为） | P2-1 | G3 | T04.1 | PLANNED | 每项边界条件真实数据用例 + 断言通过 |
| **T05.1** | 研究链真实数据 smoke + 全链路 E2E（signal→order→fill→portfolio→PnL）跑通 | P0-4 / A2 / A8 | G4 | T04.2, T04.3, T04.4 | PLANNED | 真实数据跑出 ≥1 个 `research_runs` 记录，E2E 输出可读 |
| **T05.2** | OOS 隔离冻结 + WFO 实际窗口划分 + 污染检测（OOS 不参与优化/排序/选择） | P2-2 | G4 | T05.1 | PLANNED | 窗口图 + 冻结参数清单 + 污染检测 0 命中 |
| **T05.3** | Overfitting 指标落地（PBO / 参数敏感度 / factor ablation / OOS degradation / Stable Region） | P2-3 | G4 | T05.1 | PLANNED | 输出 Stable Region 而非「收益最高参数」；PBO 值 + ablation 结果落盘 |
| **T05.4** | Market Regime 真实数据接入（禁止「涨停数量代替 Breadth」「0 代替缺失」） | P2-4 | G4 | T05.1 | PLANNED | 7 类 regime 指标来源标注真实数据/缺失，无 0 冒充 |
| **T06.1** | `strategy_versions` 持久化 + Strategy Contract/Version 唯一 | P1-5 / A3 | G5 | T05.x 全 | PLANNED | 策略版本落库，contract 唯一性断言 |
| **T06.2** | `paper_trades` 持久化（signal→order→fill→position→PnL→journal→review，planned vs actual 可追踪） | P1-3 / A3 | G5 | T05.x 全 | PLANNED | 纸面交易全链路落库，planned vs actual 可查 |
| **T06.3** | `trade_journal_entries` 持久化（review / discipline） | P1-3 / A3 | G5 | T05.x 全 | PLANNED | 日志落库 + review 可回读 |
| **T06.4** | 前端标注真实数据 / 技术预览 / legacy / 空壳（4 类，禁止混淆） | P3-1 | G5 | T06.1, T06.2, T06.3 | PLANNED | 每个页面/模块显式标注类别 |
| **T06.5** | 策略研究 SOP 落地（端到端操作流程：假设→universe→entry→exit→position→risk→execution→baseline→param search→robustness→WFO→OOS→overfitting→regime→paper→review→decision） | AUDIT§17 | G5 | T06.1 | PLANNED | SOP 文档 + 与前端流程一一对应 |

**任务总数：24**（Phase 0 = 3，Phase 1 = 2，Phase 2 = 3，Phase 3 = 3，Phase 4 = 4，Phase 5 = 4，Phase 6 = 5）。

---

## 5. 依赖关系（DAG）

### 5.1 依赖图（文本）

```
T00.1 ──→ T01.1 ──→ T01.2 ──→ T02.1 ──→ T02.2 ──→ T02.3 ──→ T03.1 ──→ T03.2 ──→ T03.3
T00.2 ──（并行）                                        └──（G0 gate）    └──（G1）      └──（G2）
T00.3 ──（并行）

T03.3 ──→ T04.1 ──┬──→ T04.2 ──→ T04.3 ──────────────┐
                   └──→ T04.4 ─────────────────────────┤
                                                       └──→ T05.1 ──┬──→ T05.2
T04.2 ──→ T04.3                                         (G3 gate)      ├──→ T05.3
                                                                      └──→ T05.4
T05.1 ──→ T05.2 / T05.3 / T05.4  ──(G4 gate)──→ T06.1 ──┬──→ T06.2
                                                          ├──→ T06.3
                                                          ├──→ T06.4
                                                          └──→ T06.5
```

### 5.2 依赖矩阵（blockedBy）

| Task | blockedBy | 关键链说明 |
|------|-----------|-----------|
| T00.1/2/3 | — | 三者可并行 |
| T01.1 | T00.1 | gate 分层是 G0 固化的前提 |
| T01.2 | T01.1 | 快照依赖 G0 判定 |
| T02.1 | T01.2 | industry 重建依赖地基冻结 |
| T02.2 | T02.1 | 覆盖报告依赖重建结果 |
| T02.3 | T02.2 | 冻结依赖报告定稿 |
| T03.1 | T02.3 | dataset 依赖历史状态就绪 |
| T03.2 | T03.1 | 一致性验证依赖表落地 |
| T03.3 | T03.2 | policy 冻结依赖可复现性验证 |
| T04.1 | T03.3 | 引擎依赖 dataset 就绪 |
| T04.2 | T04.1 | 去耦合依赖生产引擎先有完整生命周期 |
| T04.3 | T04.2 | 移除 bridge 依赖去耦合完成 |
| T04.4 | T04.1 | 边界条件验证依赖退出策略就位 |
| T05.1 | T04.2, T04.3, T04.4 | 真实 smoke 依赖引擎全就绪 |
| T05.2/3/4 | T05.1 | 优化/OOS/overfitting/regime 依赖真实运行产出 |
| T06.1 | T05.2, T05.3, T05.4 | 生产依赖 G4 认证 |
| T06.2/3/4 | T06.1 | 生产持久化 + 前端标注依赖策略版本唯一 |
| T06.5 | T06.1 | SOP 依赖策略版本唯一 |

---

## 6. 执行顺序与并行规则

### 6.1 阶段执行顺序（严格串行）

```
Phase 0 (meta)  →  Phase 1 (G0)  →  Phase 2 (G1)  →  Phase 3 (G2)
→  Phase 4 (G3)  →  Phase 5 (G4)  →  Phase 6 (G5)
```

**阶段之间严格串行**：前一阶段 Gate PASS（该阶段全部任务 CERTIFIED）才进入下一阶段。

### 6.2 阶段内并行

| 阶段 | 可并行组 |
|------|---------|
| Phase 0 | T00.1 ∥ T00.2 ∥ T00.3（全并行） |
| Phase 1 | T01.1 ∥（T01.2 依赖 T01.1，故串行） |
| Phase 2 | 严格串行（T02.1→T02.2→T02.3） |
| Phase 3 | 严格串行（T03.1→T03.2→T03.3） |
| Phase 4 | T04.2（依赖 T04.1）与 T04.4（依赖 T04.1）在 T04.1 完成后**可并行** |
| Phase 5 | T05.1 完成后，T05.2 ∥ T05.3 ∥ T05.4（三路并行） |
| Phase 6 | T06.1 完成后，T06.2 ∥ T06.3 ∥ T06.4 ∥ T06.5（四路并行） |

### 6.3 并行判定规则

1. 两任务 `blockedBy` 均已满足（前驱 CERTIFIED）。
2. 两任务修改的文件/表**不重叠**（避免写冲突）。
3. 两任务不在同一 Gate 的关键路径上互相依赖。
4. 数据回填类任务（BaoStock 单会话约束）**永远串行**（见 MEMORY.md 数据源战略）。

---

## 7. 跨阶段禁止规则（硬性）

1. **禁止跨阶段开发**：G0 未 PASS 前，不得开始 G1/G2/G3/G4/G5 的任何实现。
2. **禁止提前写码**：任务状态未到 `IMPLEMENTING`，不得提交实现代码（可做设计/草案）。
3. **禁止 CODE_READY 冒充 VALIDATED**：无真实数据 smoke 的任务，一律停在 `CODE_READY`。
4. **禁止 mock/synthetic 冒充真实研究结果**：正式策略结论必须来自真实数据 E2E（G4 之后）。
5. **禁止为让 Gate PASS 而修改数据语义**：数据缺口必须登记为 P0/P1，不能改 threshold 绕过。
6. **禁止跳过 Evidence**：每个任务 `VALIDATED→CERTIFIED` 必须产出 §8 规定证据并落盘。
7. 例外：若发现 P0 数据缺陷（如 industry PIT），可提前**审计**（只读），但**修复实现**仍须在对应阶段进行。

---

## 8. Validation Evidence 规范

### 8.1 证据目录约定

```
docs/quantRoadmap/evidence/<TaskID>/
├── evidence.json       # 结构化证据（状态、输入、输出、hash、capturedAt）
├── smoke.log           # REAL_DATA_SMOKE 的真实数据运行日志
├── acceptance.md       # 验收标准逐项判定（PASS/FAIL + 证据指针）
└── raw/                # 原始输出（dataset diff、边界条件断言结果、E2E PnL 等）
```

### 8.2 每个状态必须产出的证据

| 状态跃迁 | 必须证据 |
|---------|---------|
| `CODE_READY` | 单测通过输出（可 synthetic fixture，需注明 fixture 来源） |
| `REAL_DATA_SMOKE` | 真实 DB 运行日志（`smoke.log`），无崩溃、输出可读、含行数/区间 |
| `VALIDATED` | `acceptance.md` 逐项 PASS + 可复现证据（同输入两次输出 hash 一致） |
| `CERTIFIED` | `evidence.json` 冻结 + Gate 判定记录 |

### 8.3 evidence.json 最小字段

```json
{
  "taskId": "T04.1",
  "status": "CERTIFIED",
  "capturedAt": "ISO8601",
  "inputHash": "sha256(输入快照)",
  "outputHash": "sha256(输出快照)",
  "realData": true,
  "reproducible": true,
  "gate": "G3",
  "acceptanceRef": "acceptance.md"
}
```

---

## 9. 唯一 Roadmap 维护规则（append-only）

1. 本文件是唯一任务执行路线图；禁止在别处另立并行 roadmap。
2. **更新记录**（§11）append-only：每次变更追加一行，带时间戳，禁止删改历史行。
3. **任务表**（§4）为覆盖式更新：任务状态/依赖变更时，直接改 §4 对应行，同时在 §11 追加变更日志。
4. **Gate 状态**：每阶段 PASS 时，在 §10 登记 Gate 通过记录 + 证据目录路径。
5. **证据目录** `docs/quantRoadmap/evidence/` 只增不改（同任务重跑生成新 hash 版本）。
6. 状态变更必须经 §2.3 铁律校验：`CODE_READY → VALIDATED` 必须有 `REAL_DATA_SMOKE` 证据，否则拒绝变更。

---

## 10. 与 ROADMAP.md / AUDIT-003 的关系

| 文件 | 角色 | 是否唯一 |
|------|------|---------|
| `QUANT-ROADMAP-001.md`（本文件） | **唯一**任务执行路线图（task/status/gate/dependency/order/evidence） | ✅ 唯一 |
| `ROADMAP.md` | 规格/铁律参考（§0-43 铁律、Evidence Hierarchy、PIT/Survivorship 铁律、状态模型定义） | 参考（§44-47 跟踪职责已迁移至此） |
| `AUDIT-003_..._AUDIT.md` | 审计证据输入（问题清单来源） | 历史输入 |

> 说明：`ROADMAP.md` 的 §0-43 铁律仍然有效（正确性 > 真实性 > PIT > 可复现性 等），但**任务跟踪**、**Gate 判定**、**Evidence 存档**自此由本文件接管。若后续需要，可在 `ROADMAP.md` 顶部加一行指向本文件。

---

## 11. 更新记录（append-only）

| 时间 | 变更 | 说明 |
|------|------|------|
| 2026-09-09 13:32 | 建立本文件 | 接收 AUDIT-003，24 任务 / 6 Gate / 6 态模型 / 依赖 DAG / 证据规范落地 |

---

## 附录 A：证据快照（2026-09-09 实查）

| 项 | 值 |
|----|----|
| OHLCV 行数 / 股票数 | 8,891,500 / 5,796 |
| securities 行数（含退市） | 5,552（退市 337） |
| status history 行数 / 事件态覆盖 | 10,373 / 1,830 |
| corporate_actions / adjustment_factors | 31,641 / 31,337（覆盖 4,824 / 5,025） |
| liquidity 行数 / 股票数 | 9,015,158 / 5,131 |
| industry_assignments | 5,212 行，securityId 全 NULL，effectiveFrom 单点 2026-08-31 |
| research 运行产物 | research_experiments=0, research_runs=0, backtest_runs=1 |
| 缺失表 | strategy_versions / paper_trades / trade_journal_entries / research_datasets / experiment_artifacts |
| research 测试 | 44 测试文件，1,104 测试案例（grep），真实 E2E=0 |
| 生产基线 | leaderCandidateBaseline 只产 BUY，无 SELL |

> 说明：本附录数字为 2026-09-09 实查快照，随任务推进在对应 Gate 证据目录更新，不覆盖本快照。
