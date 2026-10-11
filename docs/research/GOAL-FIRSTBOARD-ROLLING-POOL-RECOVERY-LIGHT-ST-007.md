# GOAL · 首板滚动池破位修复比较：保留数据集，轻量 ST 排查

目标标识：`FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007`。

## 1. 用户目标与已确认决定

继续原 004 滚动池策略，回答：**破位后继续观察修复，能否比永久停买更好地捕获右尾？现有因子排序相对随机是否有增益？** 本轮交付实际账户结果，不再把研究扩展成 ST 数据治理任务。

用户已经确认：

- “先不用重建了，这种数据很少，我觉得影响不大”。沿用 `datasetVersionId=780004`，不新建、不回填、不重建。
- “st稍微检查一下就行，不要跑偏了”。只使用项目已有历史 ST 记录，不采购、不新增外部数据源，不重新做全量来源审计。
- “允许未知参与，仅排除已有记录中的 ST（探索性研究）”。**这是本轮明确授权的资格政策变化**：UNKNOWN 可参与，但绝不能伪装为已验证 NORMAL。

本轮标记为 `EXPLORATORY / KNOWN_ST_ONLY`。保留原 004 严格模式及其历史预注册；007 是显式政策变体，不能覆盖旧 Run 或把原严格模式改成宽松默认。既有历史标签并未证明当时可知，结果不作为严格 PIT、OOS、模拟交易或实盘验证。

## 2. 最小范围与开工读取

第一件事 `git status --porcelain`，记录 HEAD 与当前工作区，不 reset/stash/覆盖/提交并发改动。按 AGENTS 读取基线、CHANGE-AUDIT，以及研究、策略、数据库规则；涉及执行契约时读 EXECUTION-FLOW E-94/E-95 与 CONTRACT-MAP C-100/C-101。

必读业务文件：

1. `docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md` 与 `PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`。
2. `docs/research/RESULT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md`，只取已有数据、候选和性能结论，不重做 006。
3. `docs/research/DECISION-FIRSTBOARD-ROLLING-POOL-KEEP-DATASET-780004.md`，以其最新用户决定及本文件为准。
4. `research-experiments/first-board-pullback/rolling-pool-recovery-st/{experiment,result}.ts`；`research-experiments/shared/rollingPoolRecovery/{entry,stGate}.ts`。
5. `server/securityStatus/{persistence,timeline,types}.ts`、`server/research/simulator/{types,validate,engine}.ts` 的直接相关符号；`tests/tools/rollingPoolRecoveryStRun.mts`。

本轮只做显式 ST 政策适配、必要执行契约兼容、测试、运行和报告。**不修 builder、不改 poolStIndex、不重构其他领域，不新增因子，不调买点或退出阈值，不新建第二套策略或撮合实现。**

## 3. 冻结价格规则、账户与比较

| 项 | 本轮口径 |
|---|---|
| 数据与对象 | Dataset 780004；现有主板首板、事件日筛选及上市龄 ≥365 自然日口径，不重新筛整库 |
| 决策窗口 | 2024-01-02 至 2025-09-30，已有探索窗口；不是新增 OOS |
| A | `A_STRICT_20`：原观察规则，首次可靠破位后永久停买；名称中的 STRICT 指价格规则，不代表本轮 ST 来源严格 |
| B | `B_RECOVERY_20`：破位后继续观察，按既有五日综合修复证据触发；未破位分支与 A 相同 |
| 买入期限 | 确认日最晚 rd19，实际买入最晚 rd20；不加 T+40 入场组 |
| 再入场 | 全部平仓后有新的合法信号可再次参与；不重置首板锚点、期限或历史状态，不持仓加仓 |
| 排序 | preReturn10 降序 Top3；既有破平键；观察分只形成买点，不参与排序 |
| 账户 | 初始 100,000；最多持仓 5；每日最多新买 2；每笔预算为决策日收盘**当前总权益 ×20%**，受现金和整手约束 |
| 退出 | 原冻结 Runner 版本 3600005 / T74；沿用原成本、退出和再入场记账，不修改策略版本 |
| SMOKE | 两组各 R +2 个固定种子 Random，共 6 账户 |
| STUDY | 两组各 R +20 个固定种子 Random，共 42 账户；同 i 同 seed `20261010+i`，最多完整跑一次 |

复用 `evaluateRecoveryDaysFor`、池构造、权威装配入口和 `runTradeSimulation`。不复制价格求值器；不把原始 328/1,300 候选当成成交数。Random 与 R 使用同日同资格候选宇宙和原选中人数规则，不改变既有随机实现。

## 4. 轻量 ST 检查：明确身份、允许未知、保留真实状态

新增显式政策标识，例如 `KNOWN_ST_ONLY_EXPLORATORY`，政策版本 `recovery-known-st-only/1.0.0`。参数缺省仍为原严格政策。将本轮选择、来源指纹、记录覆盖、已知局限写入 frozen-config 和结果。

在运行端一次性读取已有 `research_security_status_history` 的 ST 维度，以及所需证券身份映射；通过已有运行端口/桥接注入研究层，实验作者函数不直连 SQL。使用有效区间和日期对应的证券身份，不能用今天名称判断历史，也不能用行情涨跌停字段冒充 ST 状态。

| 读取结果 | 确认日收盘 | 真实买入前 | 审计状态 |
|---|---|---|---|
| 已有历史记录明确标记该时点为 ST / *ST | 不进入排序候选 | 拒单 | ST；保留来源、证据指纹 |
| 有明确正常记录 | 可以参与 | 可以执行 | NORMAL |
| 无记录、身份无法解析或证据不能判断 | 可以参与 | 可以执行 | **UNKNOWN，且注明本轮允许未知** |

上表的身份缺口指 **ST 来源映射**缺口；真正的交易证券身份、价格和订单坐标仍须满足原执行约束。不得凭空生成 securityId，或把交易身份无法解析也视为可成交。

已有 BaoStock 合并 ST 区间可作为本轮“历史标签排查”依据；不把它升级为严格 PIT 证据，不伪造 availableAsOf、不修改 availability/confidence，不把缺席派生成 NORMAL。边界/重叠无法判断则 UNKNOWN，并按用户选择放行。

检查时点仍分开：确认日 15:00 只决定当日资格；成交日 09:15 按当日已有历史状态复查。次日状态不得反向影响前日排名。首次、重试、再次入场、R 和 Random 均走相同政策。ST 拒单必须发生在扣现金、成本、建仓和成功入场计数之前，不自动递补第四名。已持仓后成为 ST 不新增买入，退出继续原规则。

**实现注意：** 当前 `runTradeSimulation` 即使 `allowed=true`，仍会拒绝 `status=UNKNOWN`，且收尾断言 FILLED 必须 NORMAL。因此必须最小兼容用户确认的显式政策：在既有执行资格配置中增加可选未知处理声明，缺省 REJECT；只有明确声明本轮允许 UNKNOWN，且判决 allowed=true 时才放行 UNKNOWN。ST 始终拒绝，即使错误返回 allowed=true。同步校验、逐笔审计和收尾断言，保留真实 UNKNOWN 状态。**禁止通过把 UNKNOWN 改写 NORMAL、移除整个执行闸门或另开模拟器路径解决。**

原 `evaluateStGate` 的严格契约 1.1.0 保持不变；轻量政策属于另一个有版本的资格决策。价格状态求值不受 ST 政策驱动，不因 ST/UNKNOWN 抹掉观察历史。按现有版本机制记录新计算/配置身份，不用同一冻结配置冒充两种结果。

原严格模式的 `stSummary.blocked`、`providerVerifiable` 和预检查不可原样作为轻量模式前置条件：本轮保留 UNKNOWN 计数和未核验事实，但按显式政策判断是否可参与。缺状态不再暂停全部账户；不得把严格 provider 的 verifiable 标记伪造为 true 来开跑。当前 null-provider 的早诊断仅保留在原严格模式；轻量模式使用真实载入的历史标签索引，即使部分或全部查不到也如实记 UNKNOWN。

ST 排查取样只需覆盖：区间内已知 ST、区间外 UNKNOWN、无记录 UNKNOWN、确认日非 ST 而成交日已知 ST、平仓后再入场遇 ST。用少量真实记录核对，加合成样例锁定行为即可。**不再生成 50 万格清单、不采购、不补 22,041 格，不把缺口比例作为本轮开跑门槛。**

## 5. 验证与运行顺序

### 5.1 实施和测试

先完成适配与必要兼容，再运行类型检查、直接相关测试及 `test:changed`。新增行为至少锁定：

- 原严格缺省、原无闸门调用与既有已锁定交易/权益行为不变，不修改既有断言来通过测试。
- 显式轻量模式 UNKNOWN 能在真实撮合链成交，并保留 UNKNOWN 审计；缺省严格 UNKNOWN 仍拒单。
- 两种模式已知 ST 均零买入；隔夜 ST、重试和再次入场均能真实拒单；拒单现金/仓位/成本/成功入场次数不变。
- A/B 价格触发集合不受 ST 政策改变；已知 ST 过滤发生在 R/Random 候选资格处；成交前变化不回写排名。
- 仓位使用同日当前权益快照；不得固定为初始资金的 20%。

读取新代码前后指纹，测试用固定输入。运行命令：`pnpm run check`、`pnpm exec vitest run <实际受影响路径>`、`pnpm run test:changed`、`node scripts/checkEolDrift.mjs --strict`。已有失败单独列明；新增失败必须修复。保留既有 CRLF；禁止全仓格式化。

### 5.2 先 6 账户 SMOKE，再一次 42 账户 STUDY

调整原运行工具，显式传入本轮政策并使用新的输出目录；示例接口为 `--st-policy known-st-only`，执行方实现参数验证后在结果中给出**实际可运行命令**，不能仅写不存在的命令。

沿用 `tests/tools/rollingPoolRecoveryStRun.mts` 与平台既有 runner/startRun，不能另外手工模拟账户。新增 Run 和产物，不覆盖 `_scratch/fbp4` 的历史交付。

1. 测试通过后跑一次 SMOKE，确认 6 账户真实进入撮合；已知 ST 买入为 0、UNKNOWN 放行可追溯、仓位/成本/重入账目正确。
2. SMOKE 工程条件通过，即按同一配置启动一次 STUDY，42 账户使用相同输入快照。收益差不作为是否继续 STUDY 的判断条件。
3. STUDY 无论正负，完整交付后停止。不挑种子、不重新调分数/窗口、不扩跑 200 账户。

SMOKE 不持久化；STUDY 的正常新 Run 元数据及产物存储使用既有 startRun/artifactStorage。此处允许标准研究 Run 的应用层写入，**不授权直接 SQL 回填历史、批量写生产状态、DDL/migration 或新 Dataset 构建**。

## 6. 性能与现有数据局限

同一输入的事件、行情、ST 索引、A/B 价格证据共享读入；42 账户只重复必要的账户撮合，不能每账户重新扫库。006 已实测 rd1..41 与 rd1..80 买点候选等价，可复用其读取经验；收益退出与估值仍使用所需 post80，**不能把买点窗口当完整执行窗口**。

优先减少往返和重复载入，不为证明提速再跑一个全量旧版本。若 SMOKE/STUDY 共用缓存，缓存键包括实际 Dataset、字段、代码、政策和来源指纹；只使用经 Dataset 端口合法读取的数据，不以原始 SQL 绕过正式读取链。数据变化时失效。报告读库/候选求值/撮合/统计耗时、查询数、读取行数及总墙钟时间；不承诺一定几分钟。

沿用现有 post80 与已知状态/执行字段局限。只增加必要的观测：未平仓、实际缺执行 bar、不可卖、尾部截断/延长持有暴露，以及已有记录能识别的持仓转 ST。区分真实交易亏损与数据造成的不可判定；不按理论 rd94/95 自动阻断或自动重建。

如果实际缺数据使退出、估值或指标无法完整计算，交付已完成结果并标记 `DATA_LIMITED`，不得静默强平、补最后价、删除样本或把截断结果标为完整验证。是否重建不由执行方决定。

## 7. 结果必须回答的问题

沿用 004 预注册的右尾目标与统计方法，新增政策预注册在收益可见前落盘。主要回答：

1. B 比 A 多捕获了哪些原本破位后会错过的锚点？新增修复交易的 ≥20%/50%/100% 右尾、均值和左尾怎样？
2. B_R 对 A_R 的主靶效应及既有配对日期块 bootstrap；样本不足则报告无法判断，不因结果改阈值。
3. 各组 R 相对 20 个 Random 的差值、分布和位置；区别“买点规则的作用”与“preReturn10 排序的作用”。
4. 当前权益复合收益、最大回撤、真实成交数、唯一股票/锚点数、首次与再次入场、容量拒单、年度分层；Runner 贡献不可观测则明确未测。
5. 轻量 ST 检查读了多少记录、排除了多少候选/真实买单、UNKNOWN 参与与成交数；这些数字是来源覆盖与政策描述，不是另一个优化目标。

参数、排名并列、随机种子、成本与唯一指标出口不变。满足原主靶判据也只能给探索性结论，因为本轮接受了 UNKNOWN、使用历史标签与旧 Dataset 局限。

## 8. 交付与停止条件

交付 `PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md`、`RESULT-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md`，以及新 Run ID、实际命令、配置/来源指纹、测试、性能、A/B/R/Random 矩阵和现有研究产物。不要重复生成已存在的 006 来源审计。

终态：`EXPLORATORY_COMPLETED`（42 账户及统计完成）、`SMOKE_ENGINEERING_FAILED`（工程自检未通过）、`DATA_LIMITED`（实际执行数据不足）、`EXECUTION_FAILED`（其他实际失败）。不能把旧 `ST_COVERAGE_BLOCKED` 当成新轻量模式必然终点，也不能把研究失败默认为策略无效。

停止条件限于实际工程失败、非法资金/仓位、已知 ST 买入、冻结价格/排序/退出漂移、真实执行数据无法支持指标等。未知 ST 状态本身不是停止条件，这是用户已确认的本轮政策。

按 AGENTS 更新 CHANGE-AUDIT。若新增执行配置契约/入口，同步 CONTRACT-MAP、EXECUTION-FLOW、SYSTEM-BASELINE 与 manifest，版本接续真实基线，不覆盖并发文档。报告契约/DB/执行影响，并区分预先存在失败。

**本文件是给其他模型的执行指令，本轮文档作者未实施代码、未跑回测、未连库。**
