# GOAL · 首板滚动池历史 ST 数据就绪核查与接入方案

目标标识：FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006

## 1. 用户目标与本轮终点

沿用现有 004 首板滚动池研究：主板、事件日非 ST、非次新；T+20 内入场；破位后继续观察修复；允许平仓后再次入场；观察证据负责买点、因子负责排序；按当日权益比例计算仓位。不要重新设计策略。

用户已要求下一步执行指令。本轮执行**只读核查、实际补数清单生成、数据接入与构建索引修复影响方案**。不是又一次收益实验。完成后用户应能明确决定：是否已有足够可信的数据、需要补什么、哪些代码要改、是否必须新建 Dataset、工作量多大。

终态只允许：

- `READY_FOR_IMPLEMENTATION_REVIEW`：已有来源足以满足要求，已给出可执行的接入/修复方案，尚未接入或写库。
- `NEEDS_DATA_DECISION`：现有来源不足，已完成实际清单与具体补数方案，等待数据来源/范围裁定。
- `READINESS_AUDIT_BLOCKED`：某项检查客观无法完成，保留已经完成的证据并明确缺口。不能把尚未产出的清单说成已完成。

**本轮不调用 SMOKE/STUDY，不写数据库，不构建新 Dataset，不修改核心业务/研究口径。**只读探针、局部取样、测试夹具和文档无需再次索要许可；历史回填、DDL、新数据源付费采购、新 Dataset 构建以及策略/状态判定口径改变不在本轮授权内。

## 2. 当前事实与必须读取的文件

工作目录：`C:/work/sourcecode/stock-limit-up-analyzer`。第一件事 `git status --porcelain`，记录 HEAD 和实际工作区；大量并发改动不能 reset、stash、覆盖或提交。

按 AGENTS 读取基线、实际架构与 CHANGE-AUDIT，然后读取相关 DATABASE-MAP、CONTRACT-MAP、EXECUTION-FLOW 与 `.agents/research/SKILL.md`、`.agents/database/SKILL.md`。有文档/代码漂移，记录 BASELINE_DRIFT 后纠正文档，不为对齐文档改代码。

本任务依据：

1. `docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`
2. `docs/research/PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`
3. `docs/research/AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`，特别是 §9。
4. `docs/research/PLAN-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md`
5. `docs/research/RESULT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md`
6. `docs/research/RESULT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005-REVERIFY.md`
7. `docs/research/AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md` §6。

最新复验：Dataset `780004`；扫描 58,983 事件，主窗口内 19,510 事件；ST provider 缺失；未读 post、未撮合，SMOKE exit 3。6 个产物均为诊断，尚无收益矩阵。2,378/2,827、948 格等数值是此前 S1 审计证据，须与本轮重新核查的数值分开。

关键路径与符号（只取直接上游/下游）：

- `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts#resolveStatusProvider`、`#run`、`#createStExecutionEligibilityGate`
- `research-experiments/shared/rollingPoolRecovery/entry.ts#evaluateRecoveryDaysFor` 及 `stGate.ts#evaluateStGate`
- `server/securityStatus/{types,pointInTime,timeline,persistence,baostockStatus}.ts`
- `server/datasetRegistry/builder.ts#buildEvents`、`#buildWindowsAndOutcomes`、windows 续跑分支；`db.ts#loadSecurityIndexes`、`#resolveStSync`
- `server/runWorkbenchAssembly/poolStIndex.ts#createPoolStIndexFromRows` 及直接消费者。

## 3. S1：重新核查已有数据与读取链

使用只读 SELECT/schema inspection，沿既有 Security Master、身份历史和交易日历解析。不能使用股票当前名称判定历史 ST，也不能把同代码跨证券身份混在一起。

交付一张来源与覆盖表，每个来源至少记录：

| 项 | 要回答的问题 |
|---|---|
| 来源与访问方式 | 真实表/API/缓存/本地文件在哪里？谁写、谁读？ |
| 历史范围 | 覆盖哪些证券、日期、状态变化？包含退市、改名和摘帽吗？ |
| 状态维度 | 是否明确区分 ST/NORMAL 与停牌、上市、退市？ |
| 时间证据 | effectiveFrom/To、公告发布时间、availableAsOf、retrievedAt 各自是什么？哪些实际缺失？ |
| 穷尽性 | 来源是否保证指定证券/时间段完整？依据是什么？无记录可否推出非 ST？ |
| 信任度 | 证据、指纹与 confidence 如何形成？冲突和缺口如何处理？ |
| 使用边界 | 当前严格契约可直接使用、需授权后派生，还是不能用于历史买入判定？ |

重新核对旧 S1 的 availability、NORMAL、身份覆盖及矛盾行情格统计；报告查询条件、时间范围、分母、来源和执行时间。不要把 UNKNOWN 与已核验 ST 合并，也不要把旧统计冒充新探针。

优先核查项目已有来源。需要外部查证时使用权威来源的文档或少量只读样例，不付费、不批量采集、不把样例可获取解释为全市场历史覆盖。

## 4. S2：实际生成最小状态需求与缺口清单

不能只写“下一步生成清单”。本阶段必须真正产生本地清单和统计。

沿用 Dataset 780004、004 A/B 冻结价格规则与权威共享求值器，在**不生成买单、不撮合、不计算收益**的诊断脚本中枚举原始价格信号。价格状态与 ST 买入资格分离；允许在 provider 缺失时读取诊断所需行情，**不允许**因此把 UNKNOWN 改成 NORMAL 或绕过正式实验门禁。

复用已有 Dataset 端口、池构造、价格求值器、日期映射与排序资格口径，不手写第二套价格信号规则。若不能直接复用现有接口，先给出最小接口提取方案；不要复制大段实验实现。其他不依赖该接口的核查继续做。

分别输出：

1. **事件资格需求**：主板、事件日 ST、上市龄的来源核对；事件日非 ST 不能代表成交日仍非 ST。
2. **买入资格需求**：两组原始价格候选的确认日收盘、实际拟成交日前检查时点；首次、重试、二次入场共用。日期必须来自真实交易日历/现有映射，不能自然日加一。
3. **观察日需求**：列明严格规则实际消费哪些观察日状态；与买入时点需求分账，防止误把全部 post80 当成必需数据。

对全部原始价格候选建立覆盖需求，不只取当前 Top3：确认日 ST 剔除会改变可排序候选，Random 也需要同一合法候选宇宙。该清单是资格检查所需的保守集合，**不是最终交易清单**。

`required-status-checks.csv` 至少包含：group、anchorEventId、symbol、securityId（不可解析则留空并给原因）、eventDate、checkDate、timepoint、effectiveAt、checkPurpose、candidateRelativeDay、currentOutcome、reason、source、evidenceFingerprint。输出去重后的 `status-gap-requests.csv`（证券身份/股票代码＋日期＋时点），另保存需求到组/锚点的映射，避免去重后丢失可追溯性。

必须报告：事件数、唯一证券数、原始需求数、去重需求数、日期范围、NORMAL/ST/UNKNOWN 分账及缺口原因。未扫描字段保持 null，不能以 0 代替；未知处不能写猜测值。

## 5. S3：NORMAL 证据与 provider 接入设计

不能强行要求每只股票每天新增一行。可以评估“可信初始状态 + 完整历史变更/公告 + 覆盖证明”重建显式、有界状态区间的可行性；但这是**待审核协议**，不能在本轮直接改变现有状态语义。

平台现有契约要求 NORMAL 有明确证据，无记录不等于 NORMAL。若提出派生 NORMAL，必须给出覆盖证明、来源缺失识别、可知性与版本化方案，说明与当前显式记录契约如何兼容。完全没有覆盖依据的证券仍为 UNKNOWN。

禁止把 2026 年 retrievedAt 改成 2024/2025 年公告时间；禁止批量改 availability 为 IMMEDIATE；禁止用未来的状态变化或事后摘帽信息为历史买入提供当时不可知的证据。NORMAL、ST、*ST 的维度与原有执行政策分开。

provider 方案应说明：批量载入/查询入口、身份映射、区间索引、实际时点比较、来源指纹、可知性、冲突优先级、未知原因、缓存失效和契约版本。仅返回 NORMAL/ST/UNKNOWN 判决，不能重新实现价格规则或撮合。已有严格 ST 闸门保持不变；确认日排序与次日拒单不能串用未来信息。

本轮提供接口设计、合成样例和测试验收清单，**不直接把真实 provider 接进正式实验**。

## 6. S4：构建索引与池化状态缺陷的修复影响方案

针对两项已有代码证据，给出可审核的最小修复边界，不直接修改业务实现：

1. windows 续跑跳过 buildEvents，因而证券状态索引可能未预热。方案要确保首次构建、events 续跑、windows 续跑及边界早返回均具有一致的索引前置条件，并保持事件/窗口断点与幂等逻辑。
2. poolStIndex 无区间默认 NORMAL。列出直接消费者、现有测试契约、对旧策略/数据集的影响；不能全局一行改成 UNKNOWN 而不评估已有行为。考虑显式版本/政策与严格研究路径，避免悄悄改变旧 Run。

逐项解释受影响字段：ST、涨跌停价格规则、停牌、上市龄、可买/可卖标志。948 格只是历史审计样例，不等于948笔交易；修复前先复现并分辨证据质量。

提出 meaningful 测试：新建与 windows 断点续跑输出等价；隔夜转 ST；无覆盖 UNKNOWN；可靠 NORMAL；停牌/上市龄索引不退化；旧路径缺省行为与已验证指纹不变。只补新行为测试，不能放松既有断言掩盖口径变化。

Dataset 780004 不得原地改写。明确判断是否必须新版本、需重建哪些层、预计数据规模与耗时、如何与旧输入对账。尾部 post80 与理论 rd94/95 单列：先说明如何检查实际执行尾部需求，不能直接把94/95设成新数据定义，也不能借旧规则零暴露推断新规则足够。

## 7. 性能与执行纪律

- 不运行 SMOKE/STUDY，不做 bootstrap 或收益计算。
- 先读元数据和状态小表，再按需求枚举行情；价格诊断一次批量扫描，各组复用，不按候选逐笔远程查询。
- 只读必要相对日；缩短读取范围前证明与原价格规则等价，不能为提速漏掉锚点/观察需求。不要机械重复加载 post80。
- 中间缓存按 datasetVersionId、读取列/相对日、日期范围、规则/输入指纹标识；身份、日历、源数据变化则失效。不得复用坐标不一致的缓存。
- 长输出先落盘，禁接管道；记录各阶段耗时、查询/行数和缓存命中。30–60秒给一次简短状态；不要主会话长时间阻塞等待子代理。
- 诊断脚本、清单和原始样例放 `scripts/_scratch/st-data-readiness006/`（已忽略）；docs只保存必要汇总、文件路径与SHA，不把完整数据库导出写进跟踪目录。不输出凭据。
- 如需修改/提取代码，先明确范围与授权边界；本轮允许临时只读脚本和文档，不默认允许业务实现变更。禁止 formatter、migration生成、db:push、历史回填。

## 8. 必须交付与完成标准

交付：

1. `docs/research/RESULT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md`：来源实查、需求/缺口真实统计、输入与证据指纹、执行耗时、未完成项、终态。
2. `docs/research/IMPACT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md`：provider、构建索引、池化状态与 Dataset 的分项实施方案，按影响排序，不把它们合成无边界大重写。
3. 本地实际 `required-status-checks.csv`、`status-gap-requests.csv`、映射与日志；报告引用路径、SHA与行数。清单无法生成时明确缺失的接口/数据并给出最小补救方案，不声称完成。
4. 如果需数据库变更，影响报告必须包含 Reason、Affected Tables、Compatibility、Migration Plan、Rollback Plan、Validation；可以给SQL草案，不执行。先判断现有表与接口是否足够。
5. 列出可单独审批的具体动作：来源/范围/成本、新增或派生行数、修改文件和契约、新Dataset必要性、验证命令、停止条件。不要只写“等待授权”。

只读与文档变更不会改变业务行为，说明这一事实，不重复跑全量测试。检查新文件 LF，按项目规则运行严格行尾检查并如实披露原有 CRLF 探针。有接口/测试代码提取时再运行类型与相关测试，并按基线规则登记。更新 CHANGE-AUDIT；本轮无架构版本跃迁。

最终报告用普通语言先回答：**现在到底缺的是数据、证据、适配器还是构建逻辑？已有来源能解决多少？最小下一步具体要做什么？**有证据才下结论。交付后停止，不自动接入、写库、重建或发起收益研究。
