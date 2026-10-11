# GOAL · Event-State Long 正式执行一致性收口

> 目标标识：`EVENT-STATE-LONG-EXECUTION-PARITY-001`
> 状态：**待执行规格**。创建此文档不代表已经启动 Goal、改动策略或获得数据库写入授权。
> 前置分析：[项目与最新研究复核](PROJECT-REVIEW-NEXT-STEPS-20261010.md)，2026-10-10，HEAD `f8b6810` 加当时工作区；执行时重新确认实际版本。

## 1. 目标与完成边界

将已研究的 Event-State Long 固定配置，经 **Strategy Core → 正式装配 → 交易模拟 → canonical 指标 → 正式留档** 完整运行，证明定义、执行和证据一致，形成其他机器也能复现的交付物。

完成必须同时证明：正式入口可装配；被执行的配置等于本文件 §3；候选、交易和日权益差异均有解释；结果使用权威指标；新运行证据可追溯；用户能看到后续验证 FAIL 与当前核验状态。

**成功标准是执行一致性，不是收益提高。**工程核验通过也不代表投资验证通过，不能据此自动转为 Paper / Approved / Production。

## 2. 启动指令与授权

用户可以把下面整段作为新模型的任务指令：

```text
/goal 请在 stock-limit-up-analyzer 仓库执行
docs/research/GOAL-EVENT-STATE-LONG-EXECUTION-PARITY-001.md。

授权按该文档 §3 的固定研究配置完成代码修复与正式执行一致性验证；
需要改变策略内容时，授权通过既有不可变版本流程创建修正版，保留 3600006；
授权通过既有业务端口新增必要的实验证据、策略版本及正式 Run 留档，
新增记录和新版本必需的生命周期操作必须在执行前报告影响并留下审计。
不授权修改或回填历史记录、不授权 DDL、migration 修改、批量生产数据写入、
已有账户状态修改或资金交易。

按阶段持续推进，完成一个阶段后继续下一阶段；
若必须改变冻结业务口径、扩展数据库结构或实施文档范围外的操作，
先完成可独立推进的工作，再报告具体差异和需要裁定的事项。
本轮完成边界为正式执行一致性；经济价值验证与前向观察只登记后续任务。
```

这是**供用户发送的授权模板**，文件内的模板本身不构成授权。执行模型以实际收到的用户指令为准：

- 收到完整启动指令或等效明确授权：在上述范围内持续执行，不重复索取同一授权。
- 只有一般“执行此文档”、没有明确策略内容 / 新记录写入授权：先完成只读核验、代码与测试、内存修正版和影响报告；将具体新版本与写入清单准备好，再在必要的持久化步骤申请明确授权。
- 不具备 `/goal` 工具的模型按同样阶段工作并记录进度，不伪造工具调用。

## 3. 冻结的目标配置

这是**待复现的研究定义**。内容与 3600006 不同的部分必须通过新版本表达；禁止把旧版本悄悄解释成下列配置。

| 项 | 固定目标 |
|---|---|
| 来源 | `event-state-long-maxamp5-top3@1.0.0`，版本行 `3600006`；其原内容和历史指纹保留 |
| Dataset | `780004` 为历史复现；`780005` 为后续验证复现。复用既有数据集，不修改构建口径 |
| 事件 / 判定 | 既有首板事件；rd15 收盘决策，显式保留判定日坐标 |
| 因子 | `maxAmp5@1.0.0`，rd11–15 五个日振幅的最大值，`amp(rd)=(high-low)/close(rd-1)`；复用 Core 权威定义 |
| 排序 / 选择 | 同一决策日升序，Top3；破平使用现有确定性规则并披露边界并列规模 |
| 入场 | rd15 收盘信号 → 下一交易日开盘；涨停、停牌、无量等可成交约束由现有执行层处理 |
| 仓位 | 初始资本固定比例 `1/180`，最多 180 个持仓；使用既有 FIXED_RATIO / FIXED_FRACTION 等价实现，不按当日权益复利 |
| 候选退出 | `candidateExitPolicy=DISABLED`；排名变化不触发卖出 |
| 持有 / 出场 | 无止损、无止盈、无 runner；40 交易日 TIME_EXIT，遵循平台“收盘触发、下一交易日开盘成交”语义；不可卖继续按现有退出机制重估 |
| 末端 | 遵循平台未平仓 mark-to-market 口径；与研究 close 出场 / rd80 强制结算差异单列，不伪造成交 |
| 资金 / 成本 | 初始资本 1,000,000；佣金 0.00025、滑点 7.5bps/边、印花税 0、过户费 0、最低佣金 0、lotSize 100。此配置用于复现，不称真实账户费率 |
| 历史区间 | 780004：2019-01-03～2026-01-28；780005：2026-01-29～2026-10-09。使用实际可用日历并报告首尾边界 |

**决策窗与执行行情覆盖分开处理：**策略观察窗保持 rd15；持仓执行需要后续行情。研究 harness 曾使用 cursor `{15,79}` 加 rd15 决策谓词，这只是待核映射证据，不能直接把策略观察窗扩大到 rd79，也不能让后续 bar 参与决策。

历史数值仅作诊断锚点：780004 报告 +53.88% / MDD −18.08%；780005 报告 −7.54% / MDD −13.33%、468 笔、Stage 1 FAIL。它们不是必须凑齐的验收数字，任何修正另存结果并解释原因。

## 4. 最小范围与权威入口

执行前先 `git status --porcelain`，记录 HEAD、相关文件差异摘要和已有工作；定位统一使用“路径 + 符号名”。保留其他会话未提交内容，按需读取直接上下游。

必读顺序：AGENTS → SYSTEM-BASELINE → ARCHITECTURE → CHANGE-AUDIT → 本任务相关 DOMAIN / DEPENDENCY / CONTRACT / EXECUTION / DATABASE 地图。执行阶段读取对应 `.agents/{orchestrator,architecture,strategy,research,refactoring,verification,database}/SKILL.md`；涉及界面时再读 frontend。

| 任务 | 首先检查的入口 |
|---|---|
| 特征与策略语义 | `server/strategyCore/featureRegistry.ts#makeEventStateAmplitudeFeatures`、`runtime.ts#StrategyRuntime.evaluate` |
| 配方与装配 | `server/research/recipeRegistry.ts#resolveStrategyRecipe`、`server/runWorkbenchAssembly/assemble.ts#assembleStrategySide`、`#mapDeclaredPositionSizing` |
| 数据覆盖 | `server/runWorkbenchAssembly/datasetFromRegistry.ts#buildEventWindowDatasetCursorFromRegistry`、`#createEventWindowDatasetCursor` |
| 正式运行 | `server/researchRunRouter.ts` 的 loopRun 入口；`closedLoopWiring/executors.ts#createStreamingClosedLoopWiring`；`research/simulator/cursorEngine.ts` |
| 仓位与指标 | `server/backtest/context.ts#mapPositionSizing`、`backtestResult.ts#canonicalMetrics`、`shared/quant-stats.ts#sharpeRatio`、`research/riskAdjustedMetrics/analyze.ts` |
| 不可变版本 | `server/strategyCore/version.ts#applyDefinitionChange`；既有 strategyPersistence 服务 / 仓储 |
| 溯源与留档 | `server/researchExperiments/strategyBridgeRouter.ts` 既有证据桥；`server/researchRunRouter.ts#persistClosedLoopBacktestRun`；`server/artifactStorage/**` |

上述是查找起点，执行模型需核当前签名与调用关系，不能照旧行号拼接口。

本任务范围外：新因子、过滤器、TopN/持有期/阈值/权重搜索；经济价值研究；容量优化；Paper/Production；历史 Run 修复；全仓重构；补齐全部闭环阶段；新表与 migration。需要新增最小执行契约时先说明影响，遵守项目授权边界。

## 5. 执行阶段与门禁

按 SAFE_PIPELINE 推进；专业 Skill 是规则，不是工具。当前 `.agent/task-state.yaml` 可能属于其他 Goal，先确认归属与并发情况，不能直接覆盖仍在使用的状态。长期任务事实归 ROADMAP，审计归 CHANGE-AUDIT。

### S1 · 重现现状与确定差异（ARCHITECTURE / RESEARCH）

只读取得当前 3600006 文档、指纹、Dataset 状态、provenance、正式 Run；调用实际配方解析和正式装配，复核 `RECIPE_NOT_REGISTERED` 是否仍存在。读取关键 harness，与 §3 逐字段比较，不以之前的 DB 快照代替本轮实查。

在结果报告建立差异表：字段、存储值、研究值、正式执行值、权威代码、目标值、修复方式、验收证据。覆盖配方、仓位、候选退出、决策窗、执行行情、出场、末端、成本、指标。

**完成条件：**每个差异已有具体定位与最小修复边界；冻结项无 UNKNOWN；已有相关实验与修复清查完毕。若临时 harness / 缓存缺失，登记不可用来源，从正式定义与可读 Dataset 复现，不编造历史产物。

### S2 · 修正声明与正式执行链（STRATEGY / BACKEND）

复用 Core 的 maxAmp5 和正式决策路径，补齐必要配方装配；保持 PIT、相对日身份和已有策略行为。将 §3 配置形成可审查修正版，执行实际 canonical 校验器。内容变化通过不可变新版本流程表达，保留来源与谱系。

执行行情覆盖须支持持仓、拒单顺延与期末状态，决策仍只能读 rd15 及之前。最小修复影响其他策略时补回归证明，不改变全局默认值来迁就本策略。

**完成条件：**实际装配函数成功；输出策略来源为 Core；运行配置逐字段等于 §3；所有声明有消费者或明确报错；取得新版本内容差异和指纹。缺写入授权时先保留内存 / 文件草稿。

### S3 · 小范围行为核验（VERIFICATION）

先用 fixture 和有界真实片段验证：rd15 限定与未来 bar 污染；振幅链式前收；并列排序；整手预算；初始资本 1/180 与等权现金预算的区别；排名变化不卖出；40 日触发与次日开盘；涨停/停牌/无量拒买；跌停拒卖后的重估；期末未平仓；同股票多事件与已有仓位。

对拍顺序：候选身份/分数 → Top3 → 下单/拒单 → 成交日期/价/量/费用 → 每日现金/持仓/权益。研究参考必须复用权威特征和现有回测原语；可以做薄适配和对拍工具，不新建另一套生产执行器。

**完成条件：**离散身份、数量、日期、拒单原因一致；浮点误差容限在看结果前声明并说明源头；不能以放宽容限隐藏账本差异。列出出场时点、整手、候选预筛等旧研究差异的归因，未解释差异为 0。重复 fixture / 同一有界片段结果确定。

### S4 · 正式复现与证据留档（INTEGRATION）

S3 通过后，默认对 780004 / 780005 **各运行一次固定配置**。只为技术失败重试或确有未解释差异复跑，不开展参数变体。长任务日志落盘，不接输出管道；检查已有在途任务与服务使用情况，避免代码热重启杀死 Run。

通过正式装配入口执行并走既有持久化端口；复现工具进入可版本管理位置。每条 Run 留存：真实代码版本、相关未提交代码摘要/内容指纹、Dataset 坐标、策略版本和文档指纹、完整配置、候选/交易/权益摘要及可取回产物、费用和未平仓状态。

provenance 只能指向真实证据：若既有桥要求独立实验 Run，使用最小复现入口产生真实 Run，再复用证据桥。历史报告文件不能冒充实验 Run，也不能给 3600006 回填一条伪来源。新版本的工程复现证据和原研究来源分别如实登记。

**完成条件：**新记录有可查询 ID；实际采用的策略版本和配置可验证；产物可取回；不依赖 `%TEMP%` 或未跟踪 harness 才能重建；既有记录的内容/指纹未变。无法合法接上 provenance 时给出具体契约缺口，保持阶段未完成。

### S5 · 指标统一与差异解释（VERIFICATION）

总收益、回撤、年化等重叠指标由 canonicalMetrics 输出；Sharpe/Sortino 用现有权威风险指标函数，252 交易日，披露无风险利率、权益起点及未平仓口径。

另存“旧报告 / 正式新结果 / 差异原因”表。对收益和交易集合变化做归因；只有获得完整旧权益/交易产物时才能声称逐笔等价。旧产物不足时明确报告验证强度，只以 S3 的直接对拍证明执行语义，不声称全历史逐笔一致。

**完成条件：**无第二套指标公式；指标单位、符号与不可用值一致；差异可定位；780005 原 Stage 1 FAIL、独立性假定及已见样本限制仍可见。工程 PASS 不改变投资结论。

### S6 · 状态呈现与交付（FRONTEND / FINAL）

在既有策略/验证入口明确呈现：旧版本生命周期、后续研究 FAIL、修正版及正式核验结果。通过现有状态和证据结构表达；状态更新使用合法生命周期入口。需要超出本轮授权变更旧版本状态时，提交具体方案，不自行更新。

**完成条件：**用户能从策略入口到达新 Run 与证据；没有把正式复现 PASS 呈现为 OOS PASS；界面变化经过实际渲染验收。更新 ROADMAP 当前区、CHANGE-AUDIT 与必要基线，输出最终报告与后续队列。

## 6. 交付物与总验收

结果汇总统一写入 `docs/research/RESULT-EVENT-STATE-LONG-EXECUTION-PARITY-001.md`，包含：基线、差异表、实际 Pipeline、修正版内容、授权来源/写入清单、Run/产物索引、对拍结果、canonical 指标、旧结果差异、风险与下一步。

可复现代码、必要 fixture、配置和产物索引进版本管理；大数据与敏感连接信息按现有 artifact 规则保存。临时探针放 gitignore 的 `scripts/_scratch/`，不能作为唯一交付证据。

- `pnpm run check` = 0；受影响测试零新增失败；行尾严格检查 = 0。
- 新行为有有效测试锁，已有边界守卫不放松；全量仅在验收/合并前按项目规则运行。
- 旧策略/旧 Run/旧 Dataset 无内容变化；无 migration 或 Schema 变化。
- 正式装配不报未注册配方；执行快照与 §3 一致；S3 未解释差异 = 0。
- 两数据集正式结果已留档且可重建；代码坐标不能只记录 `gunknown` 或 HEAD 而忽略实际工作区。
- Contract / DB / Execution 影响和 baseline 更新已报告；有授权的写入逐项对账。
- 最终状态：全部满足才为 COMPLETE；有未完成门禁则输出 BLOCKED / NEEDS_HUMAN、已完成项和唯一下一动作。

前次行尾检查有一项既有 `_scratch/overlap/probe01_db_state.mjs` CRLF。执行时重新核查、明确归属；不能隐藏全仓失败，也不能借本任务覆盖其他会话文件。

## 7. 停止规则

以下情况先输出具体影响与替代方案：冻结因子/事件/TopN/持有期必须变化；原数据集语义需要更改；历史记录需回填；需要 DDL/migration/批量写；正式 Core 无法承载而要开另一条执行路径；现有授权不足以创建新记录。

代码或文档 drift 可在既有范围内纠正并审计后继续。新测试失败先定位原因；不改测试契约来通过。每个阶段完成且下一阶段 READY 时自动继续；“收益不好”不是工程任务中止或调参的理由。

## 8. 后续任务队列（本轮只登记）

| 顺序 | 下一目标 | 启动条件 | 必须先明确 |
|---|---|---|---|
| B | maxAmp5 是否优于“降低市场暴露＋现金” | 本目标 COMPLETE | 对照规则、事前判据、真实费用、Alpha 置信区间与自相关处理；780005 已被看过，新增对照仅为事后诊断 |
| C | 冻结策略的前向观察 | B 有增量价值证据，且用户批准观察方案 | 未见样本边界、计划资金、运行日历、费用与成交约束、停止规则；优先无资金交易的前向观察 |

已有 NB-RANDOM-002、失败过滤、三尺度与宽度研究的问题不重复开实验。完成本目标后只给 B 的最小预注册任务建议，等待用户选择；不自动启动 B/C。
