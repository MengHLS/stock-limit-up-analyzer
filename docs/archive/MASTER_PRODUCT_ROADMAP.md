# MASTER PRODUCT ROADMAP — 产品主路线图

> 版本：v1.0 | 日期：2026-09-09 | 状态：ACTIVE
> 性质：**唯一**产品执行路线图（PHASE 0-13），取代 `QUANT-ROADMAP-001.md` 与 `ROADMAP.md` §44-47 的跟踪职责。
> 依据：`AUDIT-003` + `docs/PRODUCT_GAP_MATRIX.md`（证据驱动）。
> 铁律参考：`ROADMAP.md` §0-43（正确性优先级、Evidence Hierarchy、PIT/Survivorship 铁律）仍有效。

---

## 0. 路线图总览

### 0.1 PHASE 与 Gate 映射

```
PHASE 0  Audit Freeze            （本次交付）
PHASE 1  Data Certification      → G0 DATA_FOUNDATION_READY + G1 HISTORICAL_STATE_READY
PHASE 2  Research Dataset        → G2 RESEARCH_DATASET_READY
PHASE 3  Research Engine         → G3 RESEARCH_ENGINE_READY
PHASE 4  First Strategy          （依赖 G3）
PHASE 5  Baseline                （依赖 PHASE 4）
PHASE 6  Optimization            （依赖 PHASE 5）
PHASE 7  Robustness              （依赖 PHASE 6）
PHASE 8  WFO / OOS               （依赖 PHASE 7）
PHASE 9  Overfitting             （依赖 PHASE 8）
PHASE 10 Regime                  （依赖 PHASE 9）
PHASE 11 Paper Trading           （依赖 PHASE 9，横向）
PHASE 12 Review / Discipline     （依赖 PHASE 11）
PHASE 13 Production Loop         → G4 RESEARCH_READY + G5 PRODUCTION_READY
```

> **Gate 语义铁律**：`RESEARCH_READY` 只指 G4 通过；`PRODUCTION_READY` 只指 G5 通过。数据域 PASS 只是 G0。Gate 定义见 `docs/RESEARCH_GATE_SPECIFICATION.md`。

### 0.2 状态模型

任务状态统一用 `docs/MASTER_TASK_TRACKING.md` 的 6 态模型：
`PLANNED → IMPLEMENTING → CODE_READY → REAL_DATA_SMOKE → VALIDATED → CERTIFIED`（+ `REJECTED`；`BLOCKED`=依赖标志）。
**禁止使用 `DONE`**。`CODE_READY ≠ VALIDATED`（中间必须过 `REAL_DATA_SMOKE`）。

---

## 1. PHASE 0 — Audit Freeze ✅（本次已完成）

- **Goal**：审计 + Gap 分析 + Roadmap/Task/Gate 重构，产出状态报告，冻结基线。
- **Inputs**：AUDIT-003 + 全量源码 + TiDB 实查 + git 安全扫描。
- **Tasks**：P0-T1 Gap Matrix / P0-T2 Roadmap / P0-T3 Task Tracking / P0-T4 Gate Spec / P0-T5 Status Report。
- **Acceptance Criteria**：5 份文档落盘 + P0 硬门槛清单导出 + 状态报告回答 §60 十问。
- **Evidence**：`docs/PRODUCT_GAP_MATRIX.md`、`docs/RESEARCH_GATE_SPECIFICATION.md`、`FINAL_PRODUCTIZATION_STATUS_REPORT.md`。
- **Output**：本路线图 + 任务追踪 + 状态报告。
- **Status**：`CERTIFIED`（本次交付即 Phase 0 出口）。

---

## 2. PHASE 1 — Data Certification（G0 + G1）

- **Goal**：把「数据地基」与「历史状态」分层认证；补 Industry PIT 缺口。
- **Inputs**：现有数据域（OHLCV/security/identifier/status/index/liquidity/CA/AF 已 FULL）。
- **Tasks**：
  | Task | 说明 | 状态 | 依赖 |
  |------|------|------|------|
  | P1-T1 | G0 gate 固化：dataScope 15 项独立判定，废除 `researchReady=dataScope.every(PASS)` | VALIDATED | P0-T4 |
  | P1-T2 | Data Foundation 版本快照冻结（dataSnapshot 可复现） | VALIDATED | P1-T1 |
  | P1-T3 | Industry `securityId` 关联回填（code→securities 桥接） | VALIDATED | P1-T2 |
  | P1-T4 | Industry 历史 PIT 重建 + Historical Coverage 报告 | PARTIAL | P1-T3 |
- **Acceptance Criteria**：G0 gate 输出独立判定；industry securityId 非 NULL 且 effectiveFrom 非单点；覆盖报告明确「可用区间/PIT 成立性/哪些研究允许用」。
- **Evidence**：`docs/quantRoadmap/evidence/G0/`、`G1/`。
- **Risks**：BaoStock 仅当前行业快照，历史 PIT 需另寻历史源 → 可能 `CONDITIONAL`（诚实标注，不伪造 PASS）。
- **Status**：`PARTIAL`（P1-T1/T2/T3 VALIDATED；P1-T4 覆盖报告 VALIDATED + 历史 PIT CONDITIONAL）。

---

## 3. PHASE 2 — Research Dataset（G2）

- **Goal**：研究数据集可持久化、可复现、policy 冻结。
- **Tasks**：
  | Task | 说明 | 状态 | 依赖 |
  |------|------|------|------|
  | P2-T1 | `research_datasets` 表持久化（datasetVersion/fingerprint/snapshot/policy） | PLANNED | P1-T4 |
  | P2-T2 | 同输入两次构建一致性验证（version A = B，diff 为空） | PLANNED | P2-T1 |
  | P2-T3 | 冻结 9 项 policy（universe/PIT/survivorship/CA/adj/industry/liquidity/calendar/knowledge） | PLANNED | P2-T2 |
- **Acceptance Criteria**：≥1 个真实 dataset 落库 + hash 可复现 + 9 项 policy 冻结。
- **Evidence**：`docs/quantRoadmap/evidence/G2/`。
- **Status**：`PLANNED`。

---

## 4. PHASE 3 — Research Engine（G3）

- **Goal**：唯一生产引擎 + 完整生命周期 + 去 legacy 耦合。
- **Tasks**：
  | Task | 说明 | 状态 | 依赖 |
  |------|------|------|------|
  | P3-T1 | 生产引擎退出策略接入（baseline BUY → BUY+SELL） | CODE_READY | P2-T3 |
  | P3-T2 | 拆除 Research→Legacy 耦合（paramSearch/walkForward/marketRegime/paper 改走生产引擎） | PLANNED | P3-T1 |
  | P3-T3 | 移除/降级 `legacyTransactionSimulator` 桥接 | PLANNED | P3-T2 |
  | P3-T4 | 回测边界条件全验证（T+1/涨跌停/停牌/滑点/费用/资金/退出/止损/止盈/公司行为） | PLANNED | P3-T1 |
- **Acceptance Criteria**：baseline 可产 SELL；4 router 不再调用 `getLeaderCandidateBacktest`；边界条件逐项真实数据断言通过。
- **Evidence**：`docs/quantRoadmap/evidence/G3/`。
- **Status**：`P3-T1 CODE_READY`（退出策略 hold-while-selected 接入；synthetic 端到端跑通 BUY→SELL 生命周期；真实数据验证留待 P5-T1）；P3-T2/T3/T4 未开始。

---

## 5. PHASE 4 — First Strategy

- **Goal**：选定并定义 FIRST_FORMAL_STRATEGY（用户真实交易模式）。
- **Tasks**：
  | Task | 说明 | 状态 | 依赖 |
  |------|------|------|------|
  | P4-T1 | 定义 FIRST_FORMAL_STRATEGY（涨停/首板/连板/龙头/次日延续之一；**等待用户填写规则，不编造**） | PLANNED | P3 全 |
  | P4-T2 | `strategy_versions` 持久化 + Contract/Version 唯一 | PLANNED | P4-T1 |
- **Acceptance Criteria**：策略 V1 机器可计算 + 版本化 + 可审计；禁止覆盖历史版本。
- **Risks**：用户规则未定义时，建 Strategy Template 等待填写，不擅自发明。
- **Status**：`PLANNED`。

---

## 6. PHASE 5 — Baseline

- **Goal**：固定参数跑通 Baseline Backtest。
- **Tasks**：P5-T1 Baseline Backtest（固定 dataset/strategy/params/capital/position/execution/slippage/fees/universe/time）。
- **Acceptance Criteria**：真实数据跑出 Baseline PnL + 指标；先 Baseline 后优化（禁反序）。
- **Status**：`PLANNED`。

---

## 7. PHASE 6 — Optimization

- **Goal**：参数搜索输出稳定区域，非收益尖峰。
- **Tasks**：P6-T1 Parameter Search（Grid/Random + Rolling）+ 参数表面/稳定区域/敏感度。
- **Acceptance Criteria**：输出 Stable Region；单尖峰触发 OVERFIT_RISK 标记。
- **Status**：`PLANNED`。

---

## 8. PHASE 7 — Robustness

- **Goal**：扰动稳健性验证。
- **Tasks**：P7-T1 四轴扰动（参数/成本/滑点/执行）+ Trade Order Monte Carlo/Bootstrap。
- **Acceptance Criteria**：收益/回撤分布 + 尾部风险 + 亏损概率。
- **Status**：`PLANNED`。

---

## 9. PHASE 8 — WFO / OOS

- **Goal**：严格 Train→Optimize→Freeze→OOS。
- **Tasks**：P8-T1 WFO 三段编排 + OOS 参数冻结 + 窗口保存 + 污染检测。
- **Acceptance Criteria**：OOS 不参与优化/排序/选择；每个 Window 保存 ID/Train/OOS/BestParams/OOS Metrics。
- **Status**：`PLANNED`。

---

## 10. PHASE 9 — Overfitting

- **Goal**：量化过拟合风险。
- **Tasks**：P9-T1 PBO/Deflated Sharpe/factor ablation/OOS degradation/Stable Region。
- **Acceptance Criteria**：输出 ROBUST/PROMISING/CONDITIONAL/INCONCLUSIVE/OVERFIT/REJECTED verdict；证据不足给 INCONCLUSIVE，不强行 LOW。
- **Status**：`PLANNED`。

---

## 11. PHASE 10 — Regime

- **Goal**：市场环境分析（真实数据）。
- **Tasks**：P10-T1 Market Regime（Bull/Bear/Sideways + 波动率 + 流动性 + Index Trend/Breadth/Liquidity）。
- **Acceptance Criteria**：无 Breadth/Sentiment 数据时标注 NOT ASSESSED，不用 0 冒充。
- **Status**：`PLANNED`。

---

## 12. PHASE 11 — Paper Trading

- **Goal**：正式研究通过后进入纸面交易。
- **Tasks**：P11-T1 `paper_trades` 持久化 + signal/entry/position/stop/take-profit/exit/reason + 理论 vs 实际模拟成交。
- **Acceptance Criteria**：planned vs actual 可追踪。
- **Status**：`PLANNED`。

---

## 13. PHASE 12 — Review / Discipline

- **Goal**：复盘 + 交易纪律量化。
- **Tasks**：P12-T1 `trade_journal_entries` 持久化；P12-T2 Discipline 评分（Strategy Return / Theoretical Return / Execution Loss / Discipline Score）。
- **Acceptance Criteria**：回答「是否按策略执行/是否违反止损/是否情绪影响」。
- **Status**：`PLANNED`。

---

## 14. PHASE 13 — Production Loop（G4 + G5）

- **Goal**：真实 E2E 认证 + 生产化。
- **Tasks**：
  | Task | 说明 | 状态 | 依赖 |
  |------|------|------|------|
  | P13-T1 | 真实研究 E2E 跑通（Hypothesis→Strategy→Dataset→Baseline→…→Verdict，`research_runs` ≥1） | PLANNED | PHASE 5~10 |
  | P13-T2 | 前端标注真实/预览/legacy/空壳 | PLANNED | P13-T1 |
  | P13-T3 | 策略研究 SOP + 用户手册（`docs/QUANT_STRATEGY_RESEARCH_SOP.md`、`docs/FINAL_PRODUCT_USER_MANUAL.md`） | PLANNED | P13-T1 |
  | P13-T4 | 安全/性能/监控/幂等/错误恢复审计 | PLANNED | P13-T1 |
- **Acceptance Criteria**：§51 Q1-Q20 全 YES 或明确 NOT READY；完整闭环可复现。
- **Status**：`PLANNED`。

---

## 15. 关键路径

```
当前关键路径（决定 RESEARCH_READY 的最长链）：
  G0 固化 → Industry PIT 修复（G1）→ research_datasets 持久化（G2）
  → 生产引擎退出策略 + 去 legacy（G3）→ FIRST_STRATEGY 定义
  → Baseline → Optimization → Robustness → WFO/OOS → Overfitting → Verdict
  → 真实 E2E（G4）→ Paper/Review/Discipline → 生产（G5）
```

> 注：数据回填（09-07 的 C+E/D）已在 09-09 前完成（liquidity 9.01M / CA 31,641 / AF 31,337 全 FULL）。当前硬阻塞：Industry 历史 PIT 缺失（securityId 已 100% 回填，但 effectiveFrom 单点，历史行业无免费源 → CONDITIONAL）+ 生产引擎退出策略（BUY-only）+ 研究链真实执行（research_runs=0）。

---

## 16. 更新记录（append-only）

| 时间 | 变更 | 说明 |
|------|------|------|
| 2026-09-09 13:43 | 建立 | 依据 Master Directive + AUDIT-003 + Gap Matrix，PHASE 0-13 落地 |
| 2026-09-09 21:46 | PHASE 2 → VALIDATED | P2-T1/T2/T3 完成：`research_datasets` 表持久化（18 列）+ 真实 dataset 20391 行 + 两次构建 diff 为空 + 9 policy 冻结；附带修复 G1 TRADING 维度缺失（backfillTradingStatus.mjs 派生 5552 条） |
| 2026-09-09 22:12 | P3-T1 → CODE_READY | 生产引擎退出策略接入：leaderCandidateBaseline 增 exitMode（hold-while-selected/none），持仓不再入选候选池即产 SELL；生产配置 + research 参数 schema 暴露 exitMode；synthetic 端到端跑出 closed trade（BUY→SELL）；真实数据验证留待 P5-T1 |
| 2026-09-09 22:26 | P3-T2/T3 → VALIDATED，P3-T4 → CODE_READY | P3-T2 确认 4 研究 router 已走生产引擎（legacy 调用=0）；P3-T3 legacy 降级为 research-only 唯一出口；P3-T4 新增 edgeCases.test.ts 18 用例逐项验证 12 项边界（8 覆盖 + 4 KNOWN_GAP：止损止盈/除权/一字板/板块limitRules未注入） |
| 2026-09-09 23:10 | DS-V2-FINAL：G2 增强 + G4 证据推进 | Research Dataset 产品化与集成收口：FE-3 产品化（capability 10 维度/preview/certify 三态）+ Research Run 强绑定（migration 0025 三列）+ 真实 E2E（`rd-1.0.0-1-fd1c487f2fe19e27` CERTIFIED researchSafe=true，Run 落库）+ gate 刷新（`RESEARCH_READY=TRUE`，G2/G4 翻 PASS）。P13-T1 的 `research_runs≥1` 证据已满足，但 PHASE 5~10 正式研究链仍 PLANNED，P13-T1 状态不提前翻转 |
