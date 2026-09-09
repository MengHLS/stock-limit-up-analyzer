# MASTER ROADMAP STATUS REPORT（第一版）

> 生成时间：**2026-09-07 13:08 GMT+8**
> 依据：真实 DB 实查（13:08 只读快照）＋ 实际代码 + `docs/researchReadyGate/research_ready_gate.json`（12:39）＋ ROADMAP.md §44/§47/§48 ＋ TASK_TRACKING.md ＋ DEVELOPMENT_PLAN.md。
> 原则：**证据优先级 = 真实 DB > 运行结果 > 代码 > 测试 > 文档 > 假设**（§3/§36）。本报告所有数字以本次实查为准，不以历史文档为准。
> 治理结论：**项目已有完整治理体系（ROADMAP V2 §0-48 + TASK_TRACKING + DEVELOPMENT_PLAN + §48.4 前端路线），本次按「升级而非重建」原则执行 Spec V1 对齐，未创建第二套冲突体系。**

---

## 1. Project Overall Status（项目总状态）

**`RESEARCH_READY = FALSE`** —— 处于「数据回填收尾 + 编码已就绪」的中期阶段。

- **数据链**：核心数据域 A/B/F/G 已就绪，C+E 回填运行中（~25%），D 排队；gate 判定 PASS 12 / PENDING 5 / FAIL 0。
- **编码链**：研究引擎 STEP 12.5 ~ 18 / 21 已全部 `CODE_READY`（`server/research/` 26,938 行 + `researchDataset/` + `historicalState/`，单测基线 777 全过）；剩余 7 个编码缺口（C-18.2/19/20/22/23/24/25）。
- **前端链**：12 页 legacy（5,098 行），研究链路 UI 未实现（FE-0~FE-9 规格已定、未开工）。
- **审计链**：docs/ 已有 PHASE0~STEP10 + STEP12.5~12.6 + WORK A~H 全套审计报告；STEP 12 认证 gate 脚本就绪（`scripts/step12_certify_gate.mjs`）。

一句话：**引擎代码已基本就绪，唯一硬阻塞是历史数据回填收尾（C+E → D → gate 认证）。**

---

## 2. Current Phase（当前阶段）

- **主阶段**：P0 数据回填收尾（ROADMAP §48.1）
- **并行阶段**：P2 研究链编码补齐（§39 解耦，编码先于数据）+ P4 前端骨架线（§48.4，自 FE-0 后并行）
- 里程碑：M0 数据可信（P0 dataScope 全 PASS）→ M1 `RESEARCH_READY=TRUE` → M2 STEP 13 VALIDATED → M3 编码补齐 → M4 生产闭环（DEVELOPMENT_PLAN §1）

---

## 3. Current STEP（当前 STEP）

- **数据链推进点**：STEP 12（Historical Data Foundation）收尾 —— 具体在 P0-1（C+E 全量回填）进行中，P0-2（D 全量）排队。
- **编码链推进点**：STEP 12.5~18/21 已 `CODE_READY`；下一批编码 = P2 七缺口（C-19.1/C-18.2/C-22.1/C-23.1 可立即并行）。

---

## 4. STEP 12 Status（历史数据域 7 态模型）

| 域 | 表 | 行数 | 覆盖 | 状态 |
|---|---|---|---|---|
| A OHLCV | stock_daily_prices | 8,891,118 | 5796 股 / 1863/1863 交易日 FULL / 缺口 0 / 重复 0 | **DATA_READY** |
| B Security Master | research_securities | 5,552 | 含退市股（anti-survivorship）FULL | **DATA_READY** |
| B Identifier | research_security_identifier_history | 5,552 | 一一对应 FULL | **DATA_READY** |
| C Status | research_security_status_history | 7,125 | 617 股事件段（回填中） | **CODE_READY** |
| D CA + Adj | corporate_actions + adjustment_factors | 240 + 271 | 19/20 股小样本（未启动全量） | **CODE_READY** |
| E Liquidity | liquidity_daily | 3,087,475 | 1,424 股（回填中，13:08 活跃） | **CODE_READY** |
| F Index | index_master + index_daily | 8 + 7,452 | 4 核心指数 2019-2026 FULL | **DATA_READY** |
| G Industry | industry_assignments | 5,212 | 83 行业；340 无行业=真实退市/ST | **DATA_READY**（identity/PIT 待修） |
| H Gate | — | — | PASS 12 / PENDING 5 / FAIL 0 | **CODE_READY**（`RESEARCH_READY=FALSE`） |

> **两处数据质量待办（未变）**：① G `industry_assignments.securityId` 全 5,212 行 NULL（违反 §6 身份铁律，需 code→securities 桥接回填）；② G `effectiveFrom` 单点 `2026-08-31`（BaoStock 仅当前快照，历史轨迹缺失 → 声明 CONDITIONAL GAP）。

---

## 5. Frontend Status（前端状态）

- **现状**：`client/src/pages/` 12 页 / 5,098 行，**全部 legacy**（涨停复盘/大盘/情绪/龙头/组合回测/纸面交易/上传/录入/同步/预警/日志），无研究链路 UI。
- **技术栈**：React 19 + Vite 7 + tRPC 11 + Tailwind 4 + recharts + radix + wouter + tanstack-query（**非 Vue**，Spec §8「沿用已有栈」）。
- **关键缺口（R6）**：后端研究链路已 `CODE_READY` 但 **tRPC 未暴露**（appRouter 仅 auth/limitUp/image/operationLog/watchlist/market/sector/sentiment/system，无 research/historicalState/researchDataset）。
- **规格状态**：§48.4 已定 FE-0~FE-9（含职责/工作量/Exit/插入节点，12:59 补全）；Spec V1 F1-F7 交叉视图映射已补（§48.4）。
- **阶段**：P4（前端研究链路 UI）——**未开始**，FE-0 tRPC 为 P0 硬前置。

---

## 6. Backend Status（后端状态）

- **研究引擎**：`server/research/` 26,938 行 + `server/researchDataset/` + `server/historicalState/`，STEP 12.5~18/21 全部 `CODE_READY`，单测 41 文件 **777 全过**、tsc 干净。
- **已就绪模块**：historicalState（asOf 查询 + PIT 审计）、researchDataset（构建器 + policy 9 类 + 版本快照）、datasetAccess/signalEngine/experimentLineage（STEP 13）、simulator/costModel/executionConstraints（STEP 14）、strategySchema（STEP 15）、performanceMetrics/riskAdjustedMetrics/tradeQualityMetrics（STEP 16）、parameterSearch/rollingOptimization（STEP 17）、robustness（STEP 18）、lifecycle（STEP 21）。
- **未暴露**：以上研究能力均未通过 tRPC 暴露给前端（R6）。
- **legacy 边界**：`server/backtest/`（STEP 8）、`server/paperTrading.ts` 为 legacy 工具，与研究链路口径分离（§44.4）。

---

## 7. Data Status（数据状态）

- **FULL**：A OHLCV（8.89M 行）、B（5552 全量）、F Index（7452）、G Industry（5212）。
- **回填中**：C Status（7,125 行/617 股）、E Liquidity（3,087,475 行/1,424 股），task `319415`（单 Python 驻留会话，12:07 起，13:08 实测 ~15 股/min，较旧模式 8/min 提速）。
- **未启动**：D CA（240/19 股）+ Adj（271/20 股），C+E 完成后串行启动（BaoStock 单 Session 约束 §30）。
- **对账待澄清（R3）**：OHLCV 5796 股 > securities 5552 股（~235 只差异，含 BJ/退市）。
- **gate**：PASS 12 / PENDING 5（#6 Status 617 股 / #9 Liquidity 1,424 股 / #10 CA 19 股 / #11 Adj 20 股 / #12 Universe）。

---

## 8. Research Status（研究状态）

- **状态**：`CODE_READY`（编码就绪），**未 `RESEARCH_READY`**（§39 硬门槛未过）。
- STEP 13 引擎（framework + datasetAccess + signalEngine + experimentLineage）已 CODE_READY，但**正式策略结论仍被禁止**，须等 `RESEARCH_READY=TRUE`（P1 认证完成）。
- Experiment Registry（§28）已 CODE_READY（15 字段谱系 + codeVersion 注入式）。

---

## 9. Validation Status（验证状态）

- 全部研究/回测/评价/优化/稳健性模块均 `CODE_READY`（单测通过），但 **`VALIDATED` 全部等待数据链就绪**（§0.2 禁止越级：代码存在 ≠ VALIDATED）。
- PIT/反泄漏抽样审计（`historicalState/audit/`）已 CODE_READY，真实 DB smoke gate=INCONCLUSIVE（dataReady=false）。

---

## 10. Audit Status（审计状态）

- **独立审计报告齐全**：docs/ 含 PHASE0 源码审计、PHASE1 STEP2~5 多轮开发/审计/复审计、STEP6/9/10/12.5/12.6、WORK A~H 全套。
- **STEP 12 认证 gate**：脚本就绪，当前判定 `RESEARCH_READY=FALSE`（PASS 12/PENDING 5）。
- **Master Auditor 角色**：审计与认证分离，开发不自我认证（§0「Master Auditor 是独立裁判」）。
- **待审计**：P0-4 H gate 重跑 + P1 数据域认证（12.5/12.6/13 VALIDATED）。

---

## 11. Completed Tasks（已完成任务）

**数据链（G1）**：
- D-A OHLCV 收尾 ✅（8,891,118 行 FULL）
- D-B Security Master ✅（5552 全量）
- D-F Index ✅（7452 全量）
- D-G Industry ✅（5212 行，余 identity/PIT 两待办 → P0-3）

**编码链（G2，均 CODE_READY）**：
- STEP 12.5：C-12.5.1（asOf 查询层）、C-12.5.2（PIT 审计）
- STEP 12.6：C-12.6.1（数据集构建器）、C-12.6.2（policy + 版本快照）
- STEP 13：C-13.1（dataset 访问层）、C-13.2（signal/candidate）、C-13.3（experiment lineage）
- STEP 14：C-14.1（交易模拟）、C-14.2（成本模型）、C-14.3（执行约束）
- STEP 15：C-15.1（策略 Schema + 版本化）
- STEP 16：C-16.1（收益/风险/回撤）、C-16.2（风险调整）、C-16.3（交易质量）
- STEP 17：C-17.1（Grid/Random）、C-17.2（Rolling）
- STEP 18：C-18.1（鲁棒性四轴）
- STEP 21：C-21.1（生命周期状态机）

共 **29 项编码任务中 22 项 CODE_READY**（剩余 7 项 P2 缺口）。

---

## 12. In Progress Tasks（进行中任务）

| 任务 | 状态 | 说明 |
|---|---|---|
| P0-1 C+E 全量回填 | 🔄 运行中 | task `319415`，E 1,424 股/C 617 股（13:08），~15 股/min，预计今晚完成 |
| P0-2 D 全量回填 | ⏳ 排队 | C+E 完成后手动串行启动 |

---

## 13. Ready Tasks（可立即开工的 READY 任务）

| 任务 | 依赖 | 优先级 | 说明 |
|---|---|---|---|
| **FE-0 研究链路 tRPC 暴露** | 无（§39 编码先于数据） | **P0** | 前端全部页面的硬前置；解除 R6 |
| **C-19.1 WFO 三段编排** | C-17.2 ✅ | P2 | 可并行 |
| **C-18.2 MC/Bootstrap** | C-18.1 ✅ | P2 | 可并行 |
| **C-22.1 Market Regime** | C-15.1 ✅ | P2 | 可并行 |
| **C-23.1 Paper Trading** | C-14.3 ✅ | P2 | 可并行 |

> 上述 5 项依赖均已 CODE_READY，**互不冲突，可立即并行**（DEVELOPMENT_PLAN 批次 1 已排 C-19.1/C-18.2/C-22.1/C-23.1）。

---

## 14. Blocked Tasks（阻塞任务）

| 任务 | 阻塞原因 | 解除条件 |
|---|---|---|
| P0-2 D 全量 | BaoStock 单 Session（C+E 独占中） | C+E 完成 |
| P1-1 STEP 12.5 VALIDATED | 依赖 A~H 全 DATA_READY | C+E + D 完成 |
| P1-2 STEP 12.6 DATA_READY+VALIDATED | 依赖 P1-1 | P1-1 完成 |
| P1-3 STEP 13 VALIDATED | 依赖 `RESEARCH_READY=TRUE` | P1-2 完成 |
| FE-2~FE-9 真实数据联调 | 依赖 FE-0 + 对应后端认证 | 骨架线不受阻，联调线等 P0/P1/P2 |

---

## 15. Critical Issues（关键阻塞 / CRITICAL）

| # | 问题 | 影响 | 处置 |
|---|---|---|---|
| R1 | gate #6 Status 阈值 5500 不合理（status 仅事件态，非全市场 LISTING） | gate #6 永远 PENDING，阻塞 `RESEARCH_READY=TRUE` | P0-4 修正 gate #6 口径 |
| R6 | 研究链路 tRPC 未暴露 | 前端无法消费任何研究能力 | **FE-0（P0）立即落地** |
| R2 | G 行业历史轨迹缺失（effectiveFrom 单点） | 历史 asOf(T) 行业只能近似 | 声明 CONDITIONAL GAP；严格 PIT 另寻历史源 |
| R3 | OHLCV 5796 > securities 5552 对账 | 数据对账待澄清 | P0-4 cross-domain 对账 |

---

## 16. High Issues（高优先级 / HIGH）

| # | 问题 | 处置 |
|---|---|---|
| R4 | BaoStock 单 Session 串行（C+E→D ~10h+） | 维持串行；编码任务不受此约束可并行 |
| R5 | C+E 回填进程跨会话不可控 | 以 DB 写入为准判存活；resume 幂等断点无损 |
| R7 | legacy 页面与研究链路两套口径并存 | 新页面标注口径；长期收敛 legacy |
| G-待办 | industry_assignments.securityId 全 NULL | P0-3 code→securities 桥接回填 |

---

## 17. Dependency Graph（依赖图）

```text
数据链（串行为主，BaoStock §30）
  A OHLCV ✅ ─┐
  B Master ✅ ─┤
  F Index  ✅ ─┼─→ G ✅ ─→ C+E 🔄 ─→ D ⏳ ─→ H Gate ─→ RESEARCH_READY
  G 行业   ✅ ─┘            (task 319415)
                                        ↓
STEP 12.5 (CODE_READY) ─→ STEP 12.6 (CODE_READY) ─→ STEP 13 (CODE_READY)
                                        ↓（P1 认证后）
STEP 14~18/21 (均 CODE_READY) ──→ P2 七缺口（C-19/20/18.2/22/23/24/25，可并行）
                                        ↓
P3 端到端验证 ──→ 生产闭环

前端（横向贯穿，不等待后端全完成）
  FE-0 tRPC（P0 前置）
     ├─ FE-1 数据健康看板（骨架线可先做）
     ├─ FE-2 asOf / FE-3 数据集 / FE-4 策略编辑（早于研究引擎联调）
     └─ FE-5~FE-9 研究/回测/纪律（晚于研究引擎，对应 P1/P2 里程碑）
```

---

## 18. Frontend Roadmap（前端路线）

**权威执行清单 = §48.4 FE-0~FE-9**（Spec V1 F1-F7 为交叉视图，映射见 §48.4）：

| 任务 | 范围 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|
| FE-0 | 研究链路 tRPC 暴露（server 侧） | **P0** | M | — |
| FE-1 | 数据域健康看板（gate 17 项 + RESEARCH_READY 灯） | P0 | M | FE-0 |
| FE-2 | asOf(T) 历史状态查询器（十问） | P0 | M | FE-0 + 数据域 |
| FE-3 | 数据集构建器（datasetVersion/policy） | P1 | M | FE-0 + 12.6 |
| FE-4 | 策略编辑器 + 运行工作台 | P1 | L | FE-0 + STEP 13 |
| FE-5 | 绩效仪表盘（Equity/DD/Trade/指标） | P2 | L | FE-0 + C-14/16 |
| FE-6 | 参数搜索 + 鲁棒性 UI | P2 | L | FE-0 + C-17/18 |
| FE-7 | WFO/OOS + 过拟合判定 UI | P2 | M/L | FE-0 + C-19/20 |
| FE-8 | Regime + 报告导出 UI | P3 | M | FE-0 + C-22/23 |
| FE-9 | 复盘纪律 + 生产闭环 UI | P3 | L | FE-0 + C-24/25 |

---

## 19. Next Parallel Tasks（下一批可并行任务）

**批次 1（立即并行，依赖均已 CODE_READY）**：
1. **FE-0 tRPC 暴露**（P0，前端前置，解除 R6）
2. C-19.1 WFO 三段编排
3. C-18.2 MC/Bootstrap
4. C-22.1 Market Regime
5. C-23.1 Paper Trading

**约束**：BaoStock 串行链（C+E→D）不可并行；P0/P1 数据认证依赖数据链完成。

---

## 20. Next Critical Path（关键路径）

```text
当前关键路径（决定 RESEARCH_READY=TRUE 的最长链）：
  C+E 回填（~4,128 股，今晚） → D 全量（~8-12h） → G 质量修复 → H gate 重跑
  → P1-1 12.5 认证 → P1-2 12.6 认证 → P1-3 13 认证 → RESEARCH_READY=TRUE
```

- 编码链（P2 七缺口 + FE-0）不在关键路径上，可全程并行推进。
- 前端骨架线（FE-1~FE-9 组件）自 FE-0 后即可并行，不被数据链阻塞。

---

## 21. Immediate Next Action（立即下一步）

**最高优先级 READY 任务 = FE-0（研究链路 tRPC 暴露）**，理由：
1. 它是全部前端工作（FE-1~FE-9 / F1-F7）的 P0 硬前置，当前唯一「做了能立刻解锁一整条链」的任务；
2. 依赖已满足（后端 research/historicalState/researchDataset 均 CODE_READY），无 BaoStock/数据链冲突，纯 server 侧增量；
3. 解除 R6（前端无法消费研究能力的根本阻塞）。

**执行计划（FE-0）**：
- 新增 `research` / `historicalState` / `researchDataset` 三个 tRPC router（查询 + 命令）；
- 契约类型下沉 `shared/`；`client/src/lib/trpc.ts` 可类型安全调用；
- 契约单测 + `tsc --noEmit` 干净。

**同时可并行**：C-19.1 / C-18.2 / C-22.1 / C-23.1 四编码缺口（DEVELOPMENT_PLAN 批次 1）。

**数据链**：不干预 C+E 回填（task `319415` 运行中）；完成后手动启动 D 全量。

---

### 附：本次治理对齐记录（Spec V1 → 现有 V2）

| 维度 | Spec V1 建议 | 项目实际 | 处置 |
|---|---|---|---|
| 技术栈 | Vue 3 + Element Plus + Pinia | React 19 + Vite 7 + tRPC 11 + Tailwind + recharts | 沿用 React（§8「不得无理由替换」） |
| 任务状态模型 | 10 态（BACKLOG/READY/…/CLOSED/DEFERRED） | 7 态（§7）+ 策略 8 态（§23） | 沿用 7 态（§32「不要混用」） |
| 前端任务分解 | F1-F7 + FRONTEND-001~024 | FE-0~FE-9（§48.4） | 以 FE-0~FE-9 为权威，F1-F7 映射见 §48.4 |
| Frontend 现状假设 | 「NOT IMPLEMENTED」 | 12 页 legacy 已存在 | 不重置，壳上增量 |
