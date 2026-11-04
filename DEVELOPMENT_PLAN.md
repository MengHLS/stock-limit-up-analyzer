# stock-limit-up-analyzer · 迭代开发排期与分工清单（DEVELOPMENT PLAN）

> **依据 / 引用**：`ROADMAP.md`（QUANT RESEARCH MASTER CONTROL SPEC V2）是唯一 Master Control Spec，本清单是其 **§48「后续迭代开发路线」** 的可执行任务化视图——**不得定义任何 ROADMAP 之外的状态、规则或阶段**。状态集合唯一出处：ROADMAP §7（7 态）。
> **范围注**：本清单覆盖 §48 P0~P3（数据/编码/认证/端到端）。**前端研究链路 UI（P4 / FE-0~FE-9）不在本清单内**——其范围、职责、依赖、工作量、完成标准与插入节点见 **ROADMAP §48.4**（12:59 已补全规格表），FE 骨架线自 FE-0（tRPC 前置）后与 P0/P1/P2 并行，真实数据联调线按对应里程碑对齐。
> **路线图引用点**：§8 Master Roadmap（STEP 12→12.5→12.6→13→…→25）；§13 Research Readiness Certification（17 项 PASS 才 `RESEARCH_READY=TRUE`）；§30 并行开发规则（BaoStock 单 Session：`G→C+E→D` 强制串行）；§32/§45 Entry/Exit 实例化；§37 最终状态模型（禁止跳跃）；§38 当前阶段执行优先级；§39（`RESEARCH_READY=FALSE` 期间可编码、禁止正式策略结论）；§44 项目真实状态映射；§47 更新记录（append-only）；§48 后续迭代开发路线（P0→P1→P2→P3）。
> **当前快照**（§44，最后实查 2026-09-07 12:40）：gate **PASS 12 / PENDING 5 / FAIL 0** → `RESEARCH_READY = FALSE`。
> **创建**：2026-09-07 12:50 GMT+8。复杂度/窗口均为**计划级估算**，认领后以真实证据校准。

---

## 1. 路线图阶段目标与里程碑（引用 §48.1/§48.2）

```text
P0 数据回填收尾 ── P0-1 C+E 收尾 → P0-2 D 全量 → P0-3 G 质量修复 → P0-4 H gate 重跑+阈值修正
                                                                        ↓ 数据域 dataScope 全 PASS
P1 数据域认证 ── P1-1 STEP 12.5 VALIDATED → P1-2 STEP 12.6 DATA_READY+VALIDATED → P1-3 STEP 13 VALIDATED
                                                                        ↓ RESEARCH_READY = TRUE（允许正式策略结论 §39）
P2 研究链编码补齐（7 组编码缺口，可与 P0/P1 并行，§39 编码先于数据）
P3 端到端验证 ── 真数据跑通「主观规则→回测→评价→优化→稳健→OOS→过拟合→模拟→复盘」全闭环（依赖 P1+P2）
```

| 里程碑 | 对应阶段 | 目标 | 完成标志（Gate） | 当前状态 |
|---|---|---|---|---|
| **M0 数据可信** | P0 完成 | 历史数据地基全部就位且可判定 | gate 17 项中 **dataScope 项全 PASS**（§48 P0-4）+ R1/R3 处置落地 | 🔄 C+E 运行中 |
| **M1 研究就绪** | P1-1→P1-2 | 12.5/12.6 真数据认证通过 | gate 全 17 项 PASS（含 Research Dataset，§13/§45.2）→ `RESEARCH_READY = TRUE` | ⏳ BLOCKED（等 P0） |
| **M2 引擎认证** | P1-3 | STEP 13 真数据 Candidate Run 可复现 | STEP 13 VALIDATED（§45.3）→ 此后才允许正式策略结论（§39） | ⏳ BLOCKED（等 P1-2） |
| **M3 编码补齐** | P2 完成 | 编码链缺口清零 | 7 组缺口全部 `CODE_READY`（tsc + 单测基线 ≥777 零回归） | 🔄 可并行开工 |
| **M4 生产闭环** | P3 完成 | 全闭环端到端可复现 | §37 状态链逐级推进至 `PRODUCTION_READY` | ❌ 未开始 |

> **口径备注**：§48 P0-4 验收文字提到 `RESEARCH_READY=TRUE`，按其**流程图**与 §45.3 语义，正式宣布落在 §13 全 17 项 PASS（含 Research Dataset 认证 = P1-2 完成后）；P0-4 只交付「dataScope 数据域全 PASS + 修正 R1/R3」。执行时以此口径为准，避免提前宣布。

---

## 2. 复杂度分级口径（估计划分，认领后校准）

| 级别 | 含义（单执行 agent 工作量 + 认知广度） | 参照 |
|---|---|---|
| **S** | 单点小改：脚本补丁 / 单域口径修正 / 一次性回填桥接 / 声明类改动 | ≤ 0.5 agent-日 |
| **M** | 单域独立模块：新建目录约 1.5~2.5k 行 + 20~40 单测 + tsc/全量回归复核 | ≈ 0.5~1 agent-日（对照 C-17.2/C-18.1/C-21.1 同期交付量） |
| **L** | 跨模块编排 / 多依赖整合 / 真实接线 | 1~2 agent-日 |
| **XL** | 全链端到端 / 多 agent 协同 | ≥ 2 agent-日 |

> 数据回填任务的 agent 操作量普遍为 S/M，但受 **BaoStock 单 Session 串行（§30）+ TiDB 远端写入**约束，需单列 **wall-clock 等待**（表格「复杂度」列用 `agent X / 等待 Y` 表示）。

---

## 3. P0 数据回填收尾（优先级 P0）

> 映射 TASK_TRACKING：D-C/D-E（收尾）、D-D（排队）、D-G（Exit 剩余）、D-H（Exit 剩余）。**串行纪律**：BaoStock 独占，`P0-1 → P0-2` 禁止并发（§30）；P0-3/P0-4 写 DB 不同表、无 BaoStock 竞争，可与 P0-1 并行推进。

| ID | 目标（做什么） | 验收标准（完成标志） | 复杂度 | 关联模块 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| **P0-1** | C+E 全量回填收尾：`research_security_status_history`（SUSPENSION+ST 事件态）与 `liquidity_daily` 全市场 5,552 股（2019+ 窗口）补完并做质量判定 | ① liquidity distinct securityCode **≥5000**（gate #9 阈值）且全市场跑完，failed 由 resume 兜底；② status 事件态覆盖全市场有停牌/ST 的股票（口径按 R1/P0-4a 修正后判定）；③ 回填日志 `scripts/_ce_full_backfill.log` 与 DB 实查一致 | agent **M** / 等待 **~10h**（8 股/min，预计 22:00 前） | `scripts/backfillStatusLiquidity.ts`（BaostockSession 驻留）、`scripts/providers/baostock_probe.py`、表 `research_security_status_history`/`liquidity_daily` | —（独占 BaoStock） | 🔄 运行中（task `319415`，12:07 起） |
| **P0-2** | D 全量回填：`corporate_actions`（分红/送转/配股/拆合股）+ `adjustment_factors`（复权因子）从小样本（240/271）扩到全市场 | ① CA distinct securityCode **≥5000**（gate #10）；② Adj **≥5000**（gate #11）；③ 复权因子区间无重叠（PIT）、单位归一正确 | agent **S/M** / 等待 **~8-12h**（串行，C+E 后） | `scripts/backfillCorporateActionsBaostock.ts`（`--phase=both`，checkpoint resume）、表 `corporate_actions`/`adjustment_factors` | **P0-1**（§30 串行，完成通知后手动启动） | ⏳ 排队中 |
| **P0-3a** | G `industry_assignments` securityId 桥接回填：5,212 行 NULL → code→`research_securities` 填 canonical identity（§6 身份铁律） | securityId 非 NULL **100%**、无孤儿引用；D-G identity 校验通过、gate #7 保持 PASS | **S** | `scripts/backfillIndustry.ts`、表 `industry_assignments`/`research_securities` | —（写 DB 不同表，可与 P0-1 并行） | ❌ 未开始 |
| **P0-3b** | G effectiveFrom 口径声明：BaoStock 仅「当前」行业快照、无历史轨迹 → 显式声明 CONDITIONAL GAP（当前快照口径，历史 asOf 用 retrievedAt 近似） | 在 researchDataset policy 的 industry evidence 与 §44.1 备注中显式声明；H gate 对该项给明确 PENDING/CONDITIONAL 语义，**不静默 PASS** | **S** | `server/researchDataset/policy.ts`、`server/historicalState/reconstruct.ts`（行业 PIT 处理） | —（可与 P0-1 并行） | ❌ 未开始 |
| **P0-4a** | gate #6 口径修正（**R1**）：status 表仅事件态（SUSPENSION+ST），LISTING/DELISTING 由 `research_securities.listedDate/delistedDate` 提供 → 修正阈值为「事件态股票覆盖」或改查 securities LISTING 边界 | #6 语义明确、判定确定性（不再因阈值 5500 不合理而永远 PENDING）；与 reconstruct（STEP 12.5）口径一致 | **M** | `scripts/step12_certify_gate.mjs`、`server/historicalState/reconstruct.ts` | P0-1 完成（需全量事件态实况） | ❌ 未开始 |
| **P0-4b** | Cross-domain 对账（**R3**）：OHLCV 5,796 股 vs securities 5,552（~235 差异，疑含 BJ/退市/代码变更）逐类澄清 | 差异来源明确（分类列明细）；gate #12 Historical Universe 重建语义确认；预期差异在 gate 注明豁免口径 | **M** | `scripts/step12_certify_gate.mjs`、临时对账脚本、表 `stock_daily_prices`/`research_securities`/`research_security_identifier_history` | P0-1 完成 | ❌ 未开始 |
| **P0-4c** | H gate 重跑 + 判定：输出 `research_ready_gate.json` | gate **dataScope 项全 PASS**（§48 P0-4）；触发 P1；正式 `RESEARCH_READY=TRUE` 待 P1-2 后按 §13 宣布（见 §1 口径备注） | **M** | `scripts/step12_certify_gate.mjs`、`docs/researchReadyGate/research_ready_gate.json` | P0-1/P0-2/P0-3/P0-4a/P0-4b | ❌ 未开始 |

---

## 4. P1 数据域认证（优先级 P1，BLOCKED 于 P0 全完成）

> 对应 TASK_TRACKING：C-12.5.1/2、C-12.6.1/2、C-13.1/2/3 的 **VALIDATED 认证通道**（代码均已 `CODE_READY`，此处只做真数据认证，§0.2 禁止越级）。

| ID | 目标 | 验收标准 | 复杂度 | 关联模块 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| **P1-1** | STEP 12.5 认证：真数据全量跑 PIT/反泄漏抽样审计 | 抽样审计 gate **PASS**（无 look-ahead、无 survivorship 泄漏）；任意 `(security,date)` 可答 §11 十问；状态 `VALIDATED` | **M** | `server/historicalState/`（reconstruct + audit/）、CLI `scripts/runStep125PitAudit.mts`（`--data-ready`）、证据 `docs/researchReadyGate/` | M0（P0 全完成） | ⏳ BLOCKED |
| **P1-2** | STEP 12.6 认证：正式构建 Research Dataset | 产出确定性 `dataset_version` + `data_snapshot` + 9 类 policy（§12）；构建 gate **PASS**、coverageGaps 空或如实 CONDITIONAL GAP；状态 `DATA_READY + VALIDATED` | **M** | `server/researchDataset/`（builder/validate/version/universe/assemble/policy/versionSnapshot）、CLI `scripts/runStep126BuildDataset.mts`、证据报告 | P1-1 | ⏳ BLOCKED |
| **P1-3** | STEP 13 认证 + Experiment Registry 真实接线：真实数据 Candidate Run 端到端复现；runner 入口注入 `composeCodeVersion` + 谱系 context（§28 15 字段） | 同 datasetVersion 两次 Candidate Run 结果一致（确定性）；§28 谱系齐备；状态 `VALIDATED` → **此后允许正式策略结论**（§39） | **M/L**（含 runner 接线） | `server/research/`（datasetAccess/signalEngine/experimentLineage）、`server/research/run*`（接线点） | P1-2（`RESEARCH_READY=TRUE`） | ⏳ BLOCKED |

---

## 5. P2 研究链编码补齐（优先级 P2，与 P0/P1 并行，§39 解耦）

> 目标统一：达 `CODE_READY`（代码 + 单测 + tsc/回归零冲突），`VALIDATED` 待数据链就绪后认证。
> **复用纪律（沿既有差距判定模式，见 §47 各 C-任务记录）**：`server/research/` 存量已有 legacy STEP 6 族实现——`walkForward.ts`/`walkForwardService.ts`、`trainValidationOos.ts`/`oosEvaluation.ts`/`validationSelection.ts`、`overfittingAssessment.ts`/`pbo.ts`/`parameterStability.ts`、`stochasticRobustness/`、`framework/` 等。执行者**必须先实查**：能 import 只读复用的不重写；真实缺口才新建；按证据升级状态（§42.13 禁止「代码存在即自动 VALIDATED」）。

| ID | 目标 | 验收标准（CODE_READY 完成标志） | 复杂度 | 关联模块（建议新目录/存量参照） | 依赖 |
|---|---|---|---|---|---|
| **C-19.1** | WFO/OOS 滚动窗口划分：Train→Optimize→Freeze→Test→Move Window 三段编排 | 交易日锚定窗口；与 C-17.2 边界清晰（本任务为三段 WFO，非「逐窗搜索+跨窗一致」）；单测覆盖三段 + 窗口移动；tsc 干净 | **M** | 新 `server/research/walkForwardRun/`；参照 `rollingOptimization/windows.ts`（不 import）、存量 `walkForward.ts`（哲学复用） | C-17.2（已完成） |
| **C-19.2** | 样本内/外隔离与记录：**OOS 禁止参与参数优化**（铁律 §21） | OOS 全程不触达优化路径（单测守卫）；保存 window id/train/test/params/result/metrics；单测 + tsc 干净 | **M** | 续 `walkForwardRun/`；参照存量 `trainValidationOos.ts`/`oosEvaluation.ts` | C-19.1 |
| **C-20.1** | Overfitting 正式判定：PBO + Parameter Sensitivity | PBO 计算确定性；识别「回测好但泛化差」；单测 + tsc 干净 | **M** | 新 `server/research/overfitting20/`；存量 `pbo.ts`/`overfittingAssessment.ts`/`parameterStability.ts` 需差距判定（不盲写） | C-18.1（已完成）、C-19.2 |
| **C-20.2** | Overfitting 补充：Factor Ablation / Perturbation Test / OOS Degradation | 与 C-18.1 扰动器复用边界清晰；单测 + tsc 干净 | **M** | 续 `overfitting20/` | C-20.1 |
| **C-18.2** | Robustness 剩余：Monte Carlo / Bootstrap / Trade Order Randomization | 每轴确定性可复现（seedable）；接 robustness 可加轴扩展槽；单测 + tsc 干净 | **M** | `server/research/robustness/`（扩展）；存量 `stochasticRobustness/` 差距判定 | C-18.1（已完成） |
| **C-22.1** | Market Regime 体系：Trend/Volatility/Liquidity/Breadth/Sentiment/Index State/Limit-up Env | regime 标签确定性；接入 C-16.3 assessed 扩展槽、解除 experimentLineage `REGIME_NOT_ASSESSED` 占位（旧记录处置需谨慎）；单测 + tsc 干净 | **M/L**（7 维度面宽） | 新 `server/research/regime22/`；消费 C-12.6.1 Research Dataset 行域 + F 指数 | C-15.1（已完成） |
| **C-23.1** | Paper Trading 模拟账户与持仓：Signal/Position/Execution/Risk/Capital/Cost 贴近实盘 | 记录 paper run/strategy version/dataset/order/execution/position/PnL；单测 + tsc 干净 | **M** | 新 `server/research/paperTrading23/`；复用 C-14.1 simulator、C-14.2/14.3 声明层、C-16.1 曲线 | C-14.3（已完成）、C-16.3（已完成） |
| **C-23.2** | Paper Trading 闭环：信号→订单→成交→持仓→PnL 全链路 | 与真实交易成本/执行一致（复用 C-14 链）；全链路记录；单测 + tsc 干净 | **M** | 续 `paperTrading23/` | C-23.1 |
| **C-24.1** | Trading Review 交易日志：Journal/Planned vs Actual/Deviation/Reason/Emotion/Rule Violation/Post-review | 字段模型 + 记录能力；单测 + tsc 干净 | **M** | 新 `server/research/review24/`；与 C-23.2 PaperRun 记录衔接 | C-23.2 |
| **C-24.2** | 纪律反馈分析：回答「为何违规/哪些错误重复/哪类策略执行最差/哪些环境易错」（§26） | 分析产出可审计；单测 + tsc 干净 | **M** | 续 `review24/` | C-24.1 |
| **C-25.1** | Production Quant Platform 闭环整合：Data→Research→Strategy→Backtest→Evaluation→Optimization→Robustness→OOS→Overfitting→Regime→Paper→Review→Discipline | 端到端可走通「主观规则→可执行规则」；各环节产物可审计；单测 + tsc 干净 | **L** | `server/research/` 总编排（facade + run 接线）；依赖各子模块出口 | C-21.1（已完成）、C-22.1、C-24.2 |

---

## 6. P3 端到端验证（依赖 P1 + P2，优先级 P3）

| ID | 目标 | 验收标准 | 复杂度 | 关联模块 | 依赖 |
|---|---|---|---|---|---|
| **P3-0** | 全链引擎真数据认证：用真实 datasetVersion 依次驱动 simulator→performance→tradeQuality→search→robustness→WFO→overfitting→paper 记录 | 将已 `CODE_READY` 的 C-14~C-24 各任务按真实运行证据升级 `VALIDATED`（§0.2，逐级不跳） | **XL**（多 agent 分工） | `server/research/**`、`server/researchDataset/` | P1（RESEARCH_READY=TRUE）+ P2 |
| **P3-1** | 端到端场景：用户一个主观交易模式 → 程序化规则 → 选历史区间 → 全流程 → 复盘纪律 | 一条策略全链路**可复现**（固定 datasetVersion+strategyVersion+codeVersion）；每环节可审计记录（ExperimentRegistry/TradeSimulationRun/EvaluationRun/RobustnessRun/RollingOptimizationRun/PaperRun） | **L** | 全链 | P1 + P2 |
| **P3-2** | 状态链推进：§37 `DATA_TRUSTWORTHY→…→PRODUCTION_READY` 逐级验收 | 逐级附 Gate 证据；产出最终交付报告 + ROADMAP §44 覆盖式更新 | **M** | ROADMAP.md、`docs/researchReadyGate/` | P3-0/P3-1 |

---

## 7. 排期与分工总表（供直接排期）

> 角色约定：**数据链 agent**＝BaoStock 独占回填 + DB 校验/认证（串行）；**research-dev agent**＝P2/P3 编码（多实例并行；共享统一出口 `server/research/index.ts` 合入需串行，合入后必须 `tsc --noEmit` + 全量 vitest 复核，防 DEFAULT_LOT_SIZE 式出口冲突重演）；**协调者**＝复核证据、合并出口、更新 TASK_TRACKING §5 / ROADMAP §44 / **§47（正文现位于根目录 `ROADMAP-CHANGELOG.md`，2026-09-13 起独立成文）**。

| 批次 | 任务 | 建议分工 | 启动条件 | 预估窗口 |
|---|---|---|---|---|
| 0（进行中） | P0-1 C+E 收尾（后台） | 数据链 agent | 已启动（task `319415`） | ~10h（至今日 22:00 前后）；**期间禁止任何 BaoStock 任务** |
| 1（可立即开工，4 agent 并行） | C-19.1 / C-18.2 / C-22.1 / C-23.1 | research-dev ×4 | 依赖已 CODE_READY（C-17.2/C-18.1/C-15.1/C-14.3+C-16.3） | 各 ~0.5~1 agent-日 |
| 2（批次 1 部分完成即开） | C-19.2 / C-23.2；P0-3a、P0-3b（G 修复） | research-dev ×2 + 数据链 agent | C-19.1/C-23.1 完成；P0-3 无 BaoStock 竞争可随时 | ~0.5~1 agent-日 |
| 3 | C-20.1 / C-24.1；**P0-2 D 启动** | research-dev ×2 + 数据链 agent | C-19.2/C-23.2 完成；D 需 **P0-1 完成通知后手动启动**（§30） | 编码 ~0.5~1 日；D wall-clock ~8-12h |
| 4 | C-20.2 / C-24.2 | research-dev ×2 | C-20.1/C-24.1 完成 | ~0.5~1 agent-日 |
| 5 | C-25.1 | research-dev ×1（或 2 协同） | C-22.1 + C-24.2 完成（C-21.1 已就绪） | ~1~2 agent-日 |
| 6（M0 后） | P0-4a → P0-4b → P0-4c | 协调者 + 数据链 agent | P0-1/P0-2/P0-3 完成 | ~0.5~1 日 |
| 7（M0 后串行） | P1-1 → P1-2 → P1-3 | 认证 agent + 协调者 | P0-4c 数据域全 PASS | 各 ~0.5~1 日 |
| 8（M1+M2 后） | P3-0/P3-1/P3-2 | 多 research-dev + 协调者 | P1-3 + P2（含 C-25.1）完成 | 1~3 日 |

> 编码链（批次 1~5）不受数据链（批次 0/6/7）阻塞（§39）；若批次 1~5 先于数据链完成，符合预期——编码早达 `CODE_READY`，VALIDATED 待 M0/M1 后汇合。

---

## 8. 风险登记与处置映射（§48.3 R1–R5）

| # | 风险 | 处置任务 | 触发时点 | 责任人 |
|---|---|---|---|---|
| R1 | gate #6 阈值 5500 不合理（status 仅事件态） | **P0-4a** 修正口径 | P0-4a 启动（P0-1 完成后） | 协调者 |
| R2 | G 行业 effectiveFrom 单点、无历史轨迹 | **P0-3b** 声明 CONDITIONAL GAP（当前快照口径） | P0-3b 随时 | 数据链 agent |
| R3 | OHLCV 5,796 股 > securities 5,552（~235 差异） | **P0-4b** cross-domain 对账 | P0-4b 启动 | 数据链 agent |
| R4 | BaoStock 单 Session 串行（§30） | 批次纪律：P0-2 启动不得早于 P0-1 完成；P2 编码不触碰 BaoStock | 全程 | 协调者 |
| R5 | C+E 回填进程跨会话不可控 | 以 **DB 写入增长**判断存活（勿信进程视图）；resume 幂等断点无损 | P0-1 全程 | 数据链 agent |

---

## 9. 维护规则（每次改动对齐标准）

1. **状态**只用 ROADMAP §7 七态（`DESIGN/CODE_READY/DATA_READY/VALIDATED/RESEARCH_READY/PRODUCTION_READY/BLOCKED`），升级证据要求同 TASK_TRACKING §0.2；「进行中/未开始」是进度词，不是状态值。
2. 任务状态以 **TASK_TRACKING.md** 为准（追踪视图），本清单侧重排期/分工/验收；两文档 ID 互通（D-\*/C-\* 与 P0-x/P1-x/P2/P3 映射见 §3~§6 各表「依赖/关联模块」）。
3. 每次实质推进（认领、状态升级、批次变化）：TASK_TRACKING §5 append 一条；数据/研究链变化同步 ROADMAP §44 覆盖式更新 + **`ROADMAP-CHANGELOG.md`（原 §47）append**。
4. P2 各 agent 交付后统一收口动作：`npx vitest run server/research server/researchDataset server/backtest`（当前基线 777 例零回归）+ `tsc --noEmit` exit 0 + `server/research/index.ts` 出口查重。
5. 复杂度/窗口为计划估算，认领后按真实证据回填校准并留痕。
