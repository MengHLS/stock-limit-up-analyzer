# PLAN · 首板滚动池 ST 执行修复与分阶段复验

目标标识：FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005

## 1. 用户授权与交付方式

用户要求：给出修复方案，调用 **DeepSeek Harness 桌面应用**执行修复；由 Codex 独立检查，通过后再调用该应用执行实验。沿用现有项目、004研究及预注册，不重新设计策略。

第一阶段只修复代码、测试与文档，交付后停在 `READY_FOR_CODEX_REVIEW`。不要自动进入真实收益实验。第二阶段须收到 Codex 在本桌面会话发送的明确复验指令；用户已授权这一先后顺序，无须重复索要修复或常规实验许可。

工作目录：`C:/work/sourcecode/stock-limit-up-analyzer`。读取当前工作区；先 `git status --porcelain`。大量未提交改动是既有基线，禁止reset、stash、覆盖、提交他人改动。每个修改文件先在 `scripts/_scratch/recovery-st-fix005/before/` 留存副本、SHA256和行尾记录。实现写入只有一个负责人，禁止多个会话/子代理并发写同一文件。

## 2. 已确认的问题与修复范围

证据见 [004审计第9节](AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md#9-执行结果复核2026-10-11)。问题不是缺少纯函数闸门，而是两个具体实现缺陷。

### F1：PRE_FILL尚未真正取消买单

路径：`research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts#run` → `buildSourceRun` → `server/research/simulator/engine.ts#runTradeSimulation`。

目前确认日NORMAL可进入计划；候选阶段预计算的PRE_FILL仅参与覆盖统计和事后审计。执行投影仍为 `st=UNKNOWN`，无法保证隔夜转ST的订单取消。

要求：

1. 确认日资格与排序只使用确认日收盘已可知的信息。维持原Top3、Random种子、日买入数、持仓限制、当日权益仓位及二次入场规则。
2. 经现有权威撮合链在实际买单执行前检查成交日状态；ST或UNKNOWN必须拒绝，发生在现金、持仓、成本、成功入场次数更新之前。卖出和已有持仓的退出规则不受新增买入限制影响。
3. 不能在前日排序时利用次日ST结论提前删股票，并让原第4名替补；预计算的次日覆盖检查可作为研究可运行性校验，但不能改变前日候选排名或Random抽样。
4. 采用最小的显式、可选执行资格接口/输入；由研究装配层注入证据，纯撮合层不反向import `research-experiments/**`，不直连数据库。缺省不启用的新接口必须保持001/002/003及正式策略历史行为一致。
5. 不能通过事后删交易、改收益、把ST写成停牌、修改涨停字段或另造撮合循环解决。禁止函数进入持久化JSON；输入证据、资格政策版本及指纹须可审计。
6. 实际拒单产物记录股票、锚点、账户、计划/实际检查日期、状态、原因、provider、来源指纹；真实成交ST审计必须断言全部NORMAL，否则整轮失败，不得只把false记入CSV继续报告收益。

### F2：区间判断使用午夜而非检查时刻

路径：`research-experiments/shared/rollingPoolRecovery/stGate.ts#evaluateStGate`。

目前区间比较使用 `instantKey(query.tradeDate)`，但可知性比较使用 `query.effectiveAt`。已复现：09:00失效的NORMAL在09:15仍被放行；08:00生效的NORMAL在09:15反被拒绝。

要求：用真正 `effectiveAt` 判定有效区间与可知性，保持既有契约“生效含、失效含”；日期形式的effectiveFrom表示当地00:00，日期形式effectiveTo应覆盖该完整日期，明确该归一化规则。精确时间不扩展到整日。统一时区为中国市场当地时间；无效日期/不支持的时间格式不得字典序误放行。保留UNKNOWN失败关闭及不伪造NORMAL的规则，不擅自放宽证据强度或无界NORMAL要求。

### F3：文档与诊断收口

纠正README、日志中“候选必须两个时点NORMAL才生成意图”等超出实现的叙述，明确确认日排序与成交前拒单的分工。更新真实接口对应的架构地图、CHANGE-AUDIT；新增平台契约/入口时同步SYSTEM-BASELINE、system-manifest版本与实际调用链。

若provider明确缺失，提供尽早的诚实诊断，不为再次证明同一缺口重复扫描全量post80；未扫描的候选数和覆盖分母应为null/未测，禁止伪造0。仍保留目标要求的缺口产物及 `ST_COVERAGE_BLOCKED`，不可伪装成收益研究完成。

## 3. 第一阶段验收

新增测试必须使用 **真实 `runTradeSimulation`** 或经过同一装配/撮合路径的合成fixture，而不仅检查 `gate.buyAllowed`：

| 场景 | 必须证明 |
|---|---|
| 确认日NORMAL、成交日ST | 已选买单真实被拒；不扣款、不建仓、不计成功次数 |
| 成交日UNKNOWN | 同上且保留UNKNOWN拒单原因 |
| 首次成交后全平、再出新信号，次日ST | 二次入场被拒；历史已完成交易保留 |
| R与Random | 使用同一成交前政策，账户状态独立 |
| 第1名隔夜ST、第4名正常 | 第1名拒单，不使用次日事实补选第4名 |
| 两时点均可靠NORMAL | 真实买卖、成本和权益路径正常 |
| 持有中变ST | 不增加买入；原退出订单仍可按既有规则执行 |
| 未提供可选接口 | 同输入旧路径tradeDigest、equityDigest及canonicalMetrics完全一致 |
| 日内与日期边界 | 09:00到期/08:00生效/精确端点/日期终点/隔夜/availableAsOf过晚均按冻结语义 |

执行 `pnpm run check`、目标测试及受影响回归（默认test:changed，必要时显式列出路径）；长输出落盘。已有失败先在修改前同工作区复现，不能归因给HEAD或凭记忆断言恒红。禁止改测试来掩盖失败。

执行 `node scripts/checkEolDrift.mjs --strict`。既有其他会话 `_scratch/overlap/probe01_db_state.mjs` 为CRLF，若仍存在只单独披露，不修改它、不扩大忽略；本任务新增LF，已跟踪CRLF修改后保持CRLF。严格检查因此非0时不得声称全仓绿。

交付 `RESULT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md`，包括修改前后证据、文件/符号、测试命令与退出码、Expected/Unexpected/Unknown差异、契约/DB/执行影响、数据Gate剩余条件。阶段终态 `READY_FOR_CODEX_REVIEW` 或明确 `FIX_FAILED`。**第一阶段不跑真实SMOKE/STUDY、不构建Dataset、不写数据库。**

## 4. Codex验收后的第二阶段

收到明确复验指令后，重新读取004目标、审计修订节、预注册和FIX-005结果；先核对代码、输入指纹及只读状态。当前默认provider无可靠历史NORMAL/ST来源，代码修复不等于数据已满足。

1. 调用004运行工具的SMOKE模式一次，先完成只读前置/资格/行情尾部检查。合法矩阵未产出时报告 `ST_COVERAGE_BLOCKED` 或具体行情Gate；不反复重跑同一缺口，不创建空仓收益研究冒充完成。
2. 仅当可靠ST覆盖、事件日主板非ST/非次新资格、执行行情字段及尾部覆盖均满足，才能完成6账户SMOKE。新修复规则不可借用旧规则“post80零暴露”来推断尾部足够；理论rd94/95及无法卖出尾部检查必须保持。
3. SMOKE工程验收和同输入性能等价对照通过后，使用既有startRun入口运行一次42账户STUDY并生成004结果。这是用户已授权的常规新实验及产物持久化；禁止覆盖历史Run。
4. 缺数据时输出按两组冻结价格候选、确认日/预成交检查时点去重的最小补数清单与来源要求；说明哪些可现有服务只读满足，哪些需要新数据引入。禁止把无ST记录推成NORMAL、修改retrievedAt或批量填IMMEDIATE。
5. Dataset windows续跑索引未初始化、poolStIndex无区间NORMAL默认等更大缺陷单列；本修复不顺手修改构建口径或历史Dataset780004。DDL、历史/批量数据回填、新Dataset构建仍需具体影响报告及单独授权，当前实验授权不自动涵盖这些写入。

不得调整A/B规则、T+20、五日综合分、排序因子、TopK、Runner、成本、seed、主指标、bootstrap及停止判据；研究结果无论好坏只完整跑一次。性能没有真实基准时不得承诺提速。BLOCKED表示尚无收益结果，不能称策略无效或任务全部完成。
