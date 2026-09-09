# QUANT MASTER AUDIT REPORT — AUDIT-001（首次）

> Auditor：QUANT MASTER AUDITOR（独立 · 只读） ｜ Master Control：ROADMAP.md V2（§44 为开发者维护状态，本次审计不修改业务代码/DB/Schema/ROADMAP）

---

## 1. Audit Timestamp

`2026-09-06 20:45 GMT+8`（DB 实测窗口 20:35–20:45；gate 复跑 20:45；tsc 20:41；行业日志实测至 20:43:37）

## 2. Current Project Stage

- 主推进阶段：**STEP 12 — Historical Data Foundation（WORK A–H）**，其中 A/B/F 已达 DATA_READY；G（Industry）**正在回填运行中**；C/D/E 未全量；H（Gate）`RESEARCH_READY=FALSE`。
- STEP 12.5 / 12.6：**DESIGN（全仓无实现代码）**。
- STEP 13–25：代码层 CODE_READY（engine/strategy/risk/features/data/research 多轮独立审计 PASS 的历史证据），数据链 BLOCKED。

## 3. Overall Status

`DATA PARTIAL — 研究链 BLOCKED`。无 CRITICAL；存在 3 项 HIGH（均阻塞 STEP 12.5 准入）。

## 4. Research Ready

**FALSE**（gate 实测：17 项 = 11 PASS / 6 PENDING / 0 FAIL；§27 五 Gate 未全 PASS）

## 5. Production Ready

**FALSE**（RESEARCH_READY 未达成，生产审计未启动）

## 6. Gate Status

| Gate | 判定 | 依据 |
|---|---|---|
| DATA_GATE | **PENDING** | C/D/E/G 未全量（gate #6/7/9/10/11 PENDING） |
| IDENTITY_GATE | **PENDING** | B 域 1:1 且无 code reuse（PASS 证据），但 A-B 跨域 universe 错配（见 F-001） |
| PIT_GATE | PASS | identifier/status 区间重叠 0（gate #13 实测）；行业历史语义见 F-002 |
| SURVIVORSHIP_GATE | PASS | 337 退市股入 master；抽样确认退市股价格保留至退市前 |
| RESEARCH_DATASET_GATE | **BLOCKED** | STEP 12.6 未实现（DESIGN） |
| BACKTEST_GATE | CODE_READY→数据链 BLOCKED | engine 经 STEP2–5 独立审计 PASS；真实研究数据未接入 |
| STRATEGY/OPTIMIZATION/OOS/OVERFITTING/PAPER/PRODUCTION | CODE_READY→数据链 BLOCKED | 代码与测试存在；正式研究未启动 |

## 7. Data Audit（八域 A–H，真实 DB 实测）

实测库：TiDB Cloud `VWwjFDE663Dhej4TohVzPQ`（只读 SQL，`stock_daily_prices` 等 11 表）

| 域 | 表 | 实测值 | 判定 |
|---|---|---|---|
| A OHLCV | stock_daily_prices | **8,891,118 行**；5,796 只（.SH 2,411/.SZ 3,039/.BJ 346）；1,863 个交易日；2019-01-02→2026-09-04；重复键 0、周末交易日 0、关键字段 null 0 | DATA_READY |
| B Master | research_securities | 5,552 只（SH 2,463/SZ 3,089；退市 337）| DATA_READY |
| B Identifier | research_security_identifier_history | 5,552 行（与 securities 1:1；securityId 多 code=0、code 复用=0）| DATA_READY |
| C Status | research_security_status_history | 211 行 / 22 证券（SUSPENSION 204 + ST 7；effectiveFrom 1999-05→2025-11）| CODE_READY（未全量）|
| D CA | corporate_actions | 240 行 / 19 证券（dividend 220 / bonus_issue 10 / transfer 10）| CODE_READY（未全量）|
| D Adj | adjustment_factors | 271 行 / 20 证券（1991-04→2026-08）| CODE_READY（未全量）|
| E Liquidity | liquidity_daily | 104,929 行 / 54 证券（1992-03-31→2026-09-04）| CODE_READY（未全量）|
| F Index | index_master + index_daily | 4 核心指数 × 1,863 交易日，7,452 行 | DATA_READY |
| G Industry | industry_assignments | **1,674 行**（gate 20:45）；**全部 effectiveFrom=2026-08-31、effectiveTo=NULL（单日快照）** | CODE_READY（回填中 ~30%）|
| H Gate | step12_certify_gate.mjs | 复跑 20:45：11 PASS / 6 PENDING / 0 FAIL | `RESEARCH_READY=FALSE` |

A 域专项质量：5 只活跃股 2024 起各 400 行抽样 → OHLC 约束违反 0、负值 0、零价 0。
退市股反生存者抽样（去后缀修正后）：000418.SZ(2019-06 退) 价格至 2019-05-07；002477.SZ 价格至 2019-10-15（2019-10-16 退）；002018.SZ 至 2019-10-31（11-01 退）→ **退市前最后交易日数据保留**。个别样本退市前 1–6 周无行（000418 等），疑似退市整理期停牌，需后续按停牌区间交叉核验（MEDIUM 跟进项）。

## 8. Identity Audit

- identifier_history 与 securities 1:1；无 securityId 多 code；无 code 复用实例（SQL：`GROUP BY securityCode HAVING COUNT(DISTINCT securityId)>1` = 空）。
- **A-B 跨域不一致（F-001）**：OHLCV 含北交所 346 只，Security Master 无任何 BJ（exchange 仅 SH/SZ）；同时 master 有 ~102 只（SH 52/SZ 50）在价格表无对应行（多为 2019 前退市，需逐一核验）。
- securities master 无证券名称字段 → 更名历史不可重建（F-005）。
- 代码格式双轨：identifier 无后缀 6 位码 vs prices/liquidity/industry 带交易所后缀 vs master 无 code 仅 securityId（F-006）。

## 9. PIT Audit

- gate #13：identifier 区间重叠 0、status 区间重叠 0 → PASS。
- 行业域 PIT 语义缺口（F-002）：`industry_assignments` 全部行 effectiveFrom=2026-08-31 且 effectiveTo=NULL。含义：**2026-08-31 之前任意 asOf 日期查询行业均无结果**。代码注释诚实标注为 CONDITIONAL GAP（BaoStock 仅提供当前行业），未伪造历史，但当前 gate 阈值（5000 只即 PASS）不校验历史深度——行业「覆盖 5000」≠「历史行业可用」。
- C 域现状以停牌/ST 区间为主，区间无重叠；未见 LISTED/DELISTED 状态类型（全量回填后需补齐上市/退市状态点）。

## 10. Survivorship Audit

- securities master 含 **337 只退市股**（gate #14 PASS，阈值仅 1）。
- 抽样实证：2019–2026 年退市股在 stock_daily_prices 保留至退市前最后交易日（见 §7）。
- 结论：**反生存者数据存在性 PASS**（抽样置信 HIGH，全覆盖置信 MEDIUM — 尚未做逐股「上市日→退市日区间行级覆盖」全量认证，列入 F-004）。

## 11. Research Dataset Audit

- 不存在 Research Dataset 层；Raw→Canonical→Historical State→Research Dataset 的中间层（12.5/12.6）**未编码（DESIGN）**。
- 已有可复用资产：server/data（canonical/validate/boardRules）、server/research（Experiment/Snapshot/Fingerprint/WFO/PBO/OOS）为 12.6 提供了大半能力。
- dataset_version / snapshot / universe / PIT policy / survivorship policy / corporate action policy 均未实例化 → RESEARCH_DATASET_GATE BLOCKED。

## 12. Backtest Audit

- 生产核心 server/engine（T+1、确定性、会计恒等、无未来函数）经 STEP2 三轮独立审计、STEP5 FINAL 独立审计 **PASS**；risk/strategy 层独立审计 PASS。
- 真实研究数据未接入 → 回测「能否可信运行于真实数据」**未验证（数据链 BLOCKED）**，维持 CODE_READY。
- 已知非阻塞技术债（历次审计记录，本次复核未变）：realisticBacktest 语义变更已完成、成本口径统一；残余 P3 见历史报告。

## 13. Strategy Audit

- 契约层 contract/registry + 首条生产策略 leader-candidate-baseline 已迁移并经独立审计 PASS（确定性/版本化/纯函数）。
- 其余策略为 legacy（CODE_READY）；真实数据集上的可复现执行未启动。

## 14. Optimization Audit

- Sweep（STEP 6.3）仅排序无自动选优；Validation 唯一 Selection Authority（6.4/6.5-FIX-1）——OOS 未参与优化，结构上无污染。
- 真实参数优化未启动（无真实数据集），无样本内过拟合可判。

## 15. Robustness Audit

- 代码层能力齐全（消融/敏感性/打地鼠/DSR/PSR/Bootstrap/成本敏感性）。真实数据未运行 → PARTIAL（诚实标注）。

## 16. OOS Audit

- WFO/OOS 基础设施独立审计 PASS（Train 真实参与、Validation 唯一选优、OOS 冻结隔离）。数据集未认证 → 端到端 OOS 结论不可用。

## 17. Overfitting Audit

- PBO（CSCV）+ PSR/DSR 代码存在；无真实数据结论。PARTIAL。

## 18. Reproducibility Audit

- 研究层快照/指纹/版本冻结机制完备（策略版本、CostModel、参数、split 均冻结）；端到端复现缺「认证数据集」一环 → PARTIAL。

## 19. Critical Findings

无（本审计未发现 CRITICAL；一旦发现立即 RESEARCH_READY=FALSE）。

## 20. High Findings

见 §22 F-001 / F-002 / F-003（均 OPEN + Blocking=YES）。

## 21. Medium / Low Findings

F-004（MEDIUM，gate 口径缺口）、F-005（MEDIUM，无名称字段）、F-006（LOW，代码格式双轨）、F-007（LOW，审计工具面限制）。

## 22. Findings（统一格式）

---

**F-001**
- Finding：A 域（OHLCV universe）与 B 域（Security Master）不一致：价格表含北交所 .BJ 346 只（master 无 BJ）；master 另有约 102 只（SH 52/SZ 50）在价格表无行。
- Severity：HIGH
- Evidence：DB SQL 实测 20:35 — `suffix_hist: SH 2411/SZ 3039/BJ 346 (total 5796)`；`securities exchange: SH 2463/SZ 3089`；价格表与 identifier 的交集差（1464? 以计数差 5796 vs 5552 为证，方向双向）。
- Impact：若研究 universe 以 master 构建，346 只北交所（涨停/波动 30% 制度股）永久缺席；若以价格表构建，master-only 股（2019 前退市）与身份映射不完整。STEP 12.5 的 asOf 股票池重建将产生系统性偏差。
- Root Cause：A 域来自 Tushare（含 BJ），B 域来自 BaoStock（无 BJ），两源 universe 未做一致性收敛。
- Status：OPEN
- Blocking：YES（IDENTITY_GATE / STEP 12.5 Entry）
- Required Action：① 决定 BJ 纳入与否（纳入：补 BJ 进 securities master + identifier；不纳入：从研究 universe 显式剔除并文档化）；② 对「master-only 102 只」逐只核验（应为 2019 前退市，若在 2019–2026 仍有交易则属 A 域缺口）。
- Verification：重跑交叉计数 `price codes NOT IN identifier` 与 `identifier NOT IN price codes` 均为 0（或 policy 显式豁免）；gate 增加 A-B universe 一致性 check。

---

**F-002**
- Finding：行业域为「当前分类快照」：1,674 行全部 effectiveFrom=2026-08-31、effectiveTo=NULL；历史行业（asOf<2026-08-31）为空。gate 阈值只数证券数（5000），不校验历史深度——行业域一旦「覆盖 5000」即被 gate 记 PASS，易被误读为「历史行业完备」。
- Severity：HIGH
- Evidence：`SELECT MIN/MAX(effectiveFrom), COUNT(effectiveTo) FROM industry_assignments` = 2026-08-31/2026-08-31/0；backfillIndustry.ts 头注释自述「当前证监会行业分类快照…历史行业缺失是 CONDITIONAL GAP」；gate TH `industryCoverMin=5000`。
- Impact：任何需要「某股 T 日行业」的因子/中性化/分组在 2026-08-31 前无法实现；若策略研究在 2019–2025 区间运行，行业信息缺失将静默降级为空 → 中性化与行业分组结论不可信。
- Root Cause：BaoStock 不提供历史行业区间；设计决策「不伪造历史归属」正确，但缺显式的历史行业 policy 与 gate 口径修正。
- Status：OPEN
- Blocking：YES（行业参与历史研究的任何用例；STEP 12.5 industry 重建）
- Required Action：① 明确 policy：恒定行业假设（取当前分类回溯全历史）or 引入历史行业源（申万/东财历史行业）or 行业仅限 2026-08-31 后；② 把 policy 写入 ROADMAP §15 与 12.6 数据集 spec；③ gate #7 增加「行业历史语义」标注，避免 5000 记 PASS 被高估。
- Verification：12.6 Research Dataset spec 中含 industry policy；gate 输出 detail 明确历史深度。

---

**F-003**
- Finding：BaoStock 并发访问违规与串行链失效：C+E 回填日志 19:37 终止于 progress 80/5552，含 28 次 `baostock query failed: 用户未登录`；当前 G（行业）仍在运行（20:43:37 仍在写，~1,502/5,552 处理），C+E/D 排队。此前编排器进程（PID 6111）已随会话清理，nohup 子进程跨会话存活不可靠。
- Severity：HIGH
- Evidence：`status_liquidity_full_20260906.log`（mtime 19:37）尾部 `[failed] ... 用户未登录` ×28 + `[progress 80/5552]`；`industry_full_20260906.log` mtime 20:43:37 持续增长（ok=1411+empty=91）；ROADMAP §44.3/44.5 记录编排器死亡、改手动链。
- Impact：并发 BaoStock 会话使 C+E 整段失败（写入几乎为 0，liquidity 54 只未增），若反复发生会拖垮 STEP 12 收尾；进程存活依赖脆弱，回填链可能静默中断。
- Root Cause：BaoStock 单账号单活跃会话硬约束未被运行时强制；编排器进程生命周期与 WorkBuddy 会话绑定，跨 turn 存活无保障。
- Status：OPEN
- Blocking：YES（C/E 域进度；§30 串行规则执行）
- Required Action：① G 结束前禁止启动 C+E/D（本轮审计不干预运行中 G）；② C+E 启动方式改为可靠长驻（系统计划任务/自动化或前台后台任务并保持会话）；③ C+E 增加启动时 BaoStock 会话占用探测（若已有活跃会话则拒绝启动并等待），把「用户未登录」变成启动前检查而非运行中失败。
- Verification：C+E 全量运行期间 industry log 无新写入（无并发）；C+E log 零 `用户未登录`。

---

**F-004**
- Finding：Research Ready Gate（17 项）是「计数/结构型」门，不校验域内质量与历史深度：不查 OHLC 数值约束全量、不查逐股×(上市-退市) 行级覆盖率、不查行业历史深度、不查 CA/adj 事件日期一致性。
- Severity：MEDIUM
- Evidence：gate 脚本 SQL 全部为 COUNT/日期 min/max/分组；TH 仅行数/天数/重叠数；行业仅 5000。
- Impact：gate PASS 与「研究可用」之间仍有缝隙（e.g. 某股缺整段价格但天数仍 FULL）。
- Root Cause：门禁优先保证「全量存在」，质量门禁粒度不足。
- Status：OPEN（ACCEPTED as scope until 12.6）
- Blocking：NO（12.6 前补齐即可）
- Required Action：12.6 Research Dataset Certification 把质量断言（OHLC 约束、行级覆盖率、行业 asOf 语义）纳入认证项。
- Verification：12.6 认证报告含上述断言结果。

---

**F-005**
- Finding：securities master 无证券名称字段，历史更名（如 000001 平安银行多次更名）不可从研究域重建；名称目前来自 legacy 记录「最新名称」路径。
- Severity：MEDIUM
- Evidence：`research_securities` 列清单（id/securityId/securityType/exchange/currency/country/status/listedDate/delistedDate/createdAt/updatedAt）无 name；ROADMAP §6 要求处理 name change。
- Impact：展示/匹配标签无法 asOf 化；不进入价量因子则研究影响有限。
- Root Cause：数据模型以 securityId 为身份，名称视为标签未建模。
- Status：OPEN（P3 级研究影响）
- Blocking：NO
- Required Action：若展示层需要历史名称，增加 name 历史表（announcement 驱动的名称映射），否则在 ROADMAP 明确「名称非研究字段」。
- Verification：文档化决策 +（如做）名称表 with effective range。

---

**F-006**
- Finding：跨表代码格式双轨：identifier_history.securityCode=无后缀 6 位；stock_daily_prices/liquidity_daily/industry_assignments.securityCode=带后缀（.SH/.SZ/.BJ）；securities master 无 code 字段（仅 securityId+exchange）。
- Severity：LOW
- Evidence：DB 列实测（information_schema + 抽样值）；A-B 关联必须经 identifier 中间映射。
- Impact：STEP 12.5 实现若忘记规范化会产生静默失配（本审计抽样即曾因无后缀查询返回 0）；映射逻辑集中即可控。
- Root Cause：各域由不同脚本/源写入，未统一 code 语义。
- Status：OPEN（P3）
- Blocking：NO
- Required Action：12.5 identity 层提供唯一 normalize 函数 + 单元测试（suffix/none/baostock sh.sz 前缀）。
- Verification：12.5 的 asOf 抽样对正常/退市/新上市股均能取到价格。

---

**F-007**
- Finding：审计工具面限制——本会话内 tasklist/wmic/PowerShell 均无法取得回填 python 进程命令行，PID 5291 未在 tasklist 命中；以「日志 mtime 持续增长 + DB 计数递增 + gate industry 999→1674」三角验证确认 G 存活，但 PID 级证据缺失。
- Severity：LOW
- Evidence：`tasklist //FI "PID eq 5291"` 空；PowerShell Get-CimInstance 输出为空；industry log 20:43:37 持续写入。
- Impact：运行时任务监控需改换可靠渠道（专用会话/日志探针）。
- Root Cause：环境进程枚举受限。
- Status：ACCEPTED
- Blocking：NO
- Required Action：后续审计在能枚举进程的会话执行；或依赖日志+DB 双探针。
- Verification：无。

---

## 23. Blocking Issues

1. **B1** — Gate 6/17 PENDING：C status 22/5,500；G industry 1,674/5,552（运行中）；E liquidity 54/5,000；D CA 19 + adj 20/5,000。
2. **B2** — A-B universe 不一致（BJ 346 单向缺口 + ~102 master-only），阻塞 IDENTITY_GATE / STEP 12.5（F-001）。
3. **B3** — 行业域历史语义缺口，需研究口径决策（F-002）。
4. **B4** — BaoStock 串行链执行脆弱：已发生 28 次并发「用户未登录」，编排器不跨会话存活（F-003）。
5. **B5** — STEP 12.5/12.6 为 DESIGN（无代码），是 STEP 13 前置硬门槛。

## 24. Recommended Actions（按优先级）

1. 不干预运行中的 G 回填；G 完成后手动串行启动 C+E（前置：BaoStock 会话空闲探测）→ 再 D。
2. 全量完成后重跑 gate（H）→ 预期 PASS 数上升，但行业/CA/adj 语义判定需人工复核（F-002/F-004）。
3. 决策 A-B universe 收敛与 BJ 政策（F-001）。
4. 起草 STEP 12.5/12.6 实现任务（identity normalize + asOf 层 + Research Dataset spec 含 PIT/Survivorship/CA/industry policy）。
5. 推进 ROADMAP §44/§47 由开发 Agent 按实际 DB 更新（本审计不改写开发者状态区）。

## 25. Next Audit Trigger

- G 回填完成 / C+E 或 D 全量回填后（数据面变化）；
- 任一域状态向 DATA_READY/VALIDATED 迁移时；
- STEP 12.5 或 12.6 首次代码落地时；
- 或按宪章 §11 任一触发条件命中时。

---

## 附：AUDIT EVIDENCE MATRIX

| Domain | Claim | Evidence | Status | Confidence |
|---|---|---|---|---|
| OHLCV | 2019-01-02→2026-09-04 全覆盖 | DB count/days/gate#3 | PASS | HIGH |
| OHLCV | 重复/周末/null=0 | gate#15 + 约束索引证据(历次) | PASS | HIGH |
| OHLCV | HLOC 数值健康 | 5 股×400 行抽样=0 违规 | PASS | MEDIUM(抽样) |
| Survivorship | 退市股价格保留至退市前 | 7 只退市股抽样 | PASS | MEDIUM(抽样) |
| Identity | identifier 1:1、无 code reuse | SQL 聚合 | PASS | HIGH |
| Identity | A-B universe 一致 | suffix/exchange 计数 | FAIL | HIGH |
| Industry | 全市场覆盖 | 1,674/5,552 运行中 | PENDING | HIGH |
| Industry | 历史 asOf 可用 | 全行 effectiveFrom=2026-08-31 | FAIL | HIGH |
| PIT | identifier/status 区间重叠=0 | gate#13 | PASS | HIGH |
| Status/Liq/CA/Adj | 全量存在 | 计数 22/54/19/20 | PENDING | HIGH |
| Backtest/Research 引擎 | 无未来函数/确定性 | STEP2-6 历次独立审计+测试 765+ | PASS | HIGH(代码) |
| Runtime | G 回填进程存活 | 日志 mtime+DB 递增 | PASS | MEDIUM(无 PID) |
| Reproducibility | 研究快照/冻结机制 | 代码+测试 | PASS | HIGH(代码) |
| STEP 12.5/12.6 | 存在实现 | 全仓 grep asOf/historicalState（20:45 快照）| FAIL(无) → 20:46+ 出现雏形(未认证) | HIGH |

---

## Addendum A（20:50 追加）— 审计窗口内的并行开发活动

- 审计进行期间（20:46–20:48），并行开发 Agent 新建 `server/historicalState/`：`db.ts`(266 行)/`mappers.ts`(226)/`reconstruct.ts`(380)/`types.ts`(263)（含 index.ts 可能仍在写入），`git status` 显示 **untracked**。
- 头部注释显示其意图与设计纪律：`resolveSecurityHistoricalState(input, tradeDate, options)` 为对任意 (security,date) 的 asOf(T) 纯函数；显式区分 `asOf=null 全知视角（仅调试）` vs 研究口径必传 asOf；code 归属 helper（isCodeOwnedBySecurityAt）处理代码复用；行业走 retrievedAt PIT、重叠即抛错；公司行为用 announcementDate 判定可知性。
- 设计方向与本次审计的 F-001/F-002/F-006 高度相关（代码格式双轨、行业 asOf 语义、code reuse），**尚未经独立审计**。
- 审计结论维持：截至 20:45 快照 STEP 12.5 = DESIGN；20:46+ = CODE_IN_PROGRESS(未认证)。**下次审计触发（立即）**：该目录稳定后做 12.5 专项审计（asOf/PIT/反泄漏/格式桥接/真实 DB 抽样）。
