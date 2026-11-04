# MASTER TASK TRACKING — 主任务追踪清单

> 版本：v1.0 | 日期：2026-09-09 | 状态：ACTIVE
> 性质：**唯一**任务追踪清单，取代 `TASK_TRACKING.md`（旧 7 态/C-task 视图）与 `QUANT-ROADMAP-001.md`。
> 路线图：`docs/MASTER_PRODUCT_ROADMAP.md`（PHASE 0-13）。

---

## 0. 状态模型（唯一权威）

### 0.1 6 态生命周期 + 终态

```
PLANNED → IMPLEMENTING → CODE_READY → REAL_DATA_SMOKE → VALIDATED → CERTIFIED
                                                          ↘ REJECTED（终态：废弃）
```

| 状态 | 定义 | 进入条件 |
|------|------|---------|
| `PLANNED` | 已登记，验收标准明确 | 任务入表 |
| `IMPLEMENTING` | 实现中 | 开始写码/改数据 |
| `CODE_READY` | 代码完成 + 单测通过 | 单测通过（可 synthetic fixture） |
| `REAL_DATA_SMOKE` | 真实数据最小闭环跑通 | 无崩溃、输出可读、有 smoke 日志 |
| `VALIDATED` | 真实数据 + 验收逐项通过 + 可复现 | 同输入同输出、证据落盘 |
| `CERTIFIED` | 通过 Phase Gate + 证据冻结 | Gate 判定 PASS |
| `REJECTED` | 终态：废弃/不采纳 | 判定后 |

`BLOCKED` = **依赖标志**（非状态），用于标记任务被前置阻塞，解除后回到原状态。

### 0.2 铁律

1. **`CODE_READY ≠ VALIDATED`**：代码存在 + 单测通过 ≠ 真实数据验证；二者之间必须过 `REAL_DATA_SMOKE`。
2. **禁止 `DONE`**：终态用 `CERTIFIED`（要求证据冻结）或 `REJECTED`。
3. **禁止跳跃**：`CODE_READY` 不得直接标 `VALIDATED`/`CERTIFIED`。
4. **证据优先**：真实 DB > 运行结果 > 代码 > 测试 > 文档 > 假设。
5. 已存在但无真实数据运行的模块，一律 `CODE_READY`，不是 `VALIDATED`。

### 0.3 与旧口径的映射（兼容说明）

| 本表 6 态 | 旧 ROADMAP §7 七态 | Master Directive §42 列表 |
|-----------|-------------------|---------------------------|
| PLANNED | DESIGN | TODO / READY |
| IMPLEMENTING | （无对应，指推进中） | IN_PROGRESS |
| CODE_READY | CODE_READY | CODE_READY / TESTED |
| REAL_DATA_SMOKE | （新增硬门槛） | （无对应） |
| VALIDATED | VALIDATED | VALIDATED |
| CERTIFIED | RESEARCH_READY / PRODUCTION_READY（Gate 层） | DONE |
| REJECTED | （无） | REJECTED |
| BLOCKED（标志） | BLOCKED | BLOCKED |

---

## 1. 任务总表

> 状态初值：PHASE 0 任务 `CERTIFIED`（本次已交付）；其余 `PLANNED`。
> 来源：`P0-*` = Gap Matrix 硬门槛；`A*` = AUDIT-003 证据；`D*` = Directive 章节。

| Task | 任务 | Phase | 优先级 | 依赖 | 状态 | 验收证据 |
|------|------|-------|--------|------|------|---------|
| P0-T1 | Product Gap Matrix 建立 | 0 | P0 | — | CERTIFIED | `docs/PRODUCT_GAP_MATRIX.md` |
| P0-T2 | Master Product Roadmap 建立 | 0 | P0 | — | CERTIFIED | `docs/MASTER_PRODUCT_ROADMAP.md` |
| P0-T3 | Master Task Tracking 建立 | 0 | P0 | — | CERTIFIED | 本文件 |
| P0-T4 | Research Gate Spec 建立 | 0 | P0 | — | CERTIFIED | `docs/RESEARCH_GATE_SPECIFICATION.md` |
| P0-T5 | 状态报告建立 | 0 | P0 | P0-T1~T4 | CERTIFIED | `FINAL_PRODUCTIZATION_STATUS_REPORT.md` |
| P1-T1 | G0 gate 固化（废除 researchReady=dataScope 语义） | 1 | P0 | P0-T4 | VALIDATED | `docs/quantRoadmap/evidence/G0/P1-T1/`（A1） |
| P1-T2 | Data Foundation 版本快照冻结 | 1 | P0 | P1-T1 | VALIDATED | fingerprint 可复现（3 次一致） |
| P1-T3 | Industry `securityId` 关联回填 | 1 | P0 | P1-T2 | VALIDATED | securityId 非 NULL（5212/5212，0 孤儿） |
| P1-T4 | Industry 历史 PIT 重建 + 覆盖报告 | 1 | P0 | P1-T3 | PARTIAL | 覆盖报告 VALIDATED；历史 PIT BLOCKED（无历史源 CONDITIONAL） |
| P2-T1 | `research_datasets` 表持久化 | 2 | P0 | P1-T4 | VALIDATED | 表落库(18列) + 20391 行真实 dataset（A3） |
| P2-T2 | 同输入两次构建一致性验证 | 2 | P0 | P2-T1 | VALIDATED | datasetVersion 两次一致 diff 为空 |
| P2-T3 | 9 项 policy 冻结 | 2 | P0 | P2-T2 | VALIDATED | 9 policy 冻结文档 + 版本 + 校验 |
| P3-T1 | 生产引擎退出策略（BUY+SELL） | 3 | P0 | P2-T3 | CODE_READY | baseline 可产 SELL（A5） |
| P3-T2 | 拆除 Research→Legacy 耦合 | 3 | P1 | P3-T1 | VALIDATED | 4 router 已走生产引擎，legacy 调用=0（A6） |
| P3-T3 | 移除 legacyTransactionSimulator 桥接 | 3 | P1 | P3-T2 | VALIDATED | bridge 降级为 research-only 唯一出口（非移除） |
| P3-T4 | 回测边界条件全验证 | 3 | P1 | P3-T1 | CODE_READY | 12 项边界逐项验证（8 覆盖 + 4 KNOWN_GAP） |
| P4-T1 | 定义 FIRST_FORMAL_STRATEGY（等用户规则） | 4 | P0 | P3 全 | PLANNED | 策略 V1 机器可计算 |
| P4-T2 | `strategy_versions` 持久化 | 4 | P1 | P4-T1 | PLANNED | 表落库 + version 唯一 |
| P5-T1 | Baseline Backtest 跑通 | 5 | P0 | P4-T2 | PLANNED | 真实 PnL + 指标 |
| P6-T1 | Parameter Search（稳定区域） | 6 | P1 | P5-T1 | PLANNED | Stable Region + 表面 |
| P7-T1 | Robustness 四轴 + MC/Bootstrap | 7 | P1 | P6-T1 | PLANNED | 扰动分布 + 尾部风险 |
| P8-T1 | WFO/OOS 三段 + 冻结 + 污染检测 | 8 | P1 | P7-T1 | PLANNED | 窗口保存 + 0 污染 |
| P9-T1 | Overfitting 指标（PBO/ablation/Stable Region） | 9 | P1 | P8-T1 | PLANNED | verdict + PBO 值 |
| P10-T1 | Market Regime 真实数据 | 10 | P2 | P9-T1 | PLANNED | 7 类指标真实标注 |
| P11-T1 | `paper_trades` 持久化 + 全链路 | 11 | P2 | P9-T1 | PLANNED | planned vs actual |
| P12-T1 | `trade_journal_entries` 持久化 | 12 | P2 | P11-T1 | PLANNED | review 可回读 |
| P12-T2 | Discipline 评分 | 12 | P2 | P12-T1 | PLANNED | 纪律评分闭环 |
| P13-T1 | 真实研究 E2E 认证（research_runs ≥1） | 13 | P0 | PHASE 5~10 | PLANNED | 真实 Experiment→Run→Verdict |
| P13-T2 | 前端四类标注 | 13 | P2 | P13-T1 | PLANNED | 每页标注类别 |
| P13-T3 | 策略研究 SOP + 用户手册 | 13 | P2 | P13-T1 | PLANNED | SOP + Manual 落盘 |
| P13-T4 | 安全/性能/监控/幂等审计 | 13 | P2 | P13-T1 | PLANNED | 审计报告 |

**任务总数：31**（PHASE 0=5，1=4，2=3，3=4，4=2，5~10 各 1，11=1，12=2，13=4）。

---

## 2. 并行规则

- **可并行组**：P1-T1∥P1-T2（串行）；P3-T2∥P3-T4（P3-T1 完成后）；PHASE 5~10 严格串行（研究链依赖）。
- **BaoStock 回填类**：永远串行（单会话约束）。
- **跨 Phase 禁止**：前 Phase Gate 未 PASS，不得开始后 Phase 实现（可只读审计）。

---

## 3. 更新记录（append-only）

| 时间 | 变更 | 说明 |
|------|------|------|
| 2026-09-09 13:43 | 建立 | 31 任务 / 6 态模型 / 映射旧口径 |
| 2026-09-09 20:40 | P1-T1 → VALIDATED | G0 gate 固化完成：分层 Gate G0~G5 落地，researchReady 降级为 G4 语义；真实 TiDB 运行 + 两次可复现 + dataHealth/researchContracts 25 测试全绿 + tsc 通过；GCP-001/002 记录；附带修复 DOMAIN_SPEC C/D 两处 coverage 口径 bug |
| 2026-09-09 20:52 | P1-T2/T3 → VALIDATED，P1-T4 → PARTIAL | P1-T2 冻结 Data Foundation v1（fingerprint `781854d0…b8`，3 次可复现）；P1-T3 回填 industry.securityId 5212/5212（0 歧义 0 孤儿，幂等）；P1-T4 覆盖报告 VALIDATED（历史 PIT CONDITIONAL，BaoStock 无历史 / Tushare 5000 积分受限 / akshare 未装） |
| 2026-09-09 22:12 | P3-T1 → CODE_READY | 生产引擎退出策略接入：leaderCandidateBaseline 增 exitMode（hold-while-selected/none，默认 hold-while-selected），持仓不再入选候选池即产 SELL；生产配置 `LEADER_CANDIDATE_PRODUCTION_EXIT_MODE` + research 参数 schema 暴露 exitMode。端到端（synthetic fixture）跑出 closed trade（BUY→SELL 生命周期）。99 strategy/engine 测试 + 1104 research 测试全绿；tsc 干净。真实数据验证留待 P5-T1（CODE_READY≠VALIDATED） |
| 2026-09-09 23:10 | DS-V2-FINAL 收口（P13-T1 证据推进，状态仍 PLANNED） | Research Dataset 产品化 + 集成 11 STEP 全完成：FE-3 产品化（capability/preview/certify 三面板）、Research Run 强绑定（migration 0025 三列）、真实 E2E（`rd-1.0.0-1-fd1c487f2fe19e27` CERTIFIED researchSafe=true，Run 落库）、gate 刷新（`RESEARCH_READY=TRUE`，G2/G4 翻 PASS）、4 份 spec 文档。**注**：`research_runs ≥1` 证据已满足，但 P13-T1 依赖 PHASE 5~10 正式研究链（仍 PLANNED），故状态不提前翻转；本 STEP 仅推进数据/认证证据，不动 P13-T1 状态 |

